"""
GET /search/places — Autocomplete de locais.

Fontes, juntas e ranqueadas numa lista só (ranquear()):
  1. malha_completa (~38k vias do DF) — rápida e local; o bairro sai do lugar OSM
     mais próximo (ml/artifacts/bairros_df.json).
  2. TomTom Search v2 (typeahead, cache 24 h) — tolera erro de digitação e acha POI.
  3. Nominatim (OSM) — só se as duas acima trouxerem < 3. A política da OSMF proíbe
     autocomplete e exige cache e ≤ 1 req/s; por isso fica no fim, com trava de 1 s.

Por que ranquear aqui: a nota da TomTom sai ~0,99 para tudo que contém o texto
("Park Shopping" de São Sebastião, o shopping de verdade e as lojas dentro dele).
Os sinais que separam estão na resposta: o nome bate inteiro?, é um marco
(shopping, universidade…)?, há vários resultados com o nome no mesmo ponto
(aglomeração = o lugar de verdade)?, e quão longe está de quem busca.
"""
import asyncio
import json
import math
import os
import re
import time
import logging
import unicodedata
from typing import List, Optional, Tuple

import httpx
from fastapi import APIRouter, Query, Request, Security
from pydantic import BaseModel, Field

import usage
from seguranca import Limitador, ip_cliente, limitar
from tomtom import CENTRO_BRASILIA, CacheTTL

router = APIRouter(prefix="/search", tags=["Autocomplete"], dependencies=[Security(usage.bearer)])
logger = logging.getLogger(__name__)

_cache_nominatim = CacheTTL(24 * 3600, max_itens=1024)
_ultima_nominatim = 0.0
# Autocomplete dispara a cada tecla (com debounce no app): folga para digitação
# normal, corta robô queimando a cota de Search da TomTom.
_limite_ip = Limitador(90)

_BAIRROS_JSON = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml', 'artifacts', 'bairros_df.json')
_bairros: Optional[List[dict]] = None


class PlaceSuggestion(BaseModel):
    label: str = Field(..., description="Nome principal (via, lugar ou endereço).", examples=["Park Shopping"])
    sublabel: str = Field(..., description="Bairro · rua (ou tipo de via).", examples=["Guará · Estrada EPIA"])
    lat: float
    lon: float
    source: str = Field(..., description='Origem da sugestão: "malha" | "tomtom" | "nominatim".', examples=["malha"])
    categoria: Optional[str] = Field(None, description="Categoria em português para o ícone/selo.", examples=["Shopping"])
    id_ponto: Optional[int] = Field(None, description="Id da via na malha local, quando source = malha.")


# --- Ranking (funções puras — testadas em tests/test_busca.py) ------------------

# Só abreviações que NÃO são prefixo da palavra ("av" já casa "avenida" por prefixo).
ABREV = {'qd': 'quadra', 'cj': 'conjunto', 'lt': 'lote', 'pca': 'praca'}

# Marcos: o que alguém quer dizer ao digitar o nome (e não a loja que o cita).
MARCOS = {'SHOPPING_CENTER', 'AIRPORT', 'COLLEGE_UNIVERSITY', 'SCHOOL', 'HOSPITAL_POLYCLINIC',
          'RAILWAY_STATION', 'STADIUM', 'GOVERNMENT_OFFICE', 'TOURIST_ATTRACTION', 'MUSEUM',
          'PARK_RECREATION_AREA', 'EXHIBITION_CONVENTION_CENTER', 'THEATER', 'CINEMA'}

CATEGORIAS = {
    'SHOPPING_CENTER': 'Shopping', 'AIRPORT': 'Aeroporto', 'COLLEGE_UNIVERSITY': 'Universidade',
    'SCHOOL': 'Escola', 'HOSPITAL_POLYCLINIC': 'Hospital', 'RAILWAY_STATION': 'Estação',
    'PUBLIC_TRANSPORT_STOP': 'Parada', 'STADIUM': 'Estádio', 'GOVERNMENT_OFFICE': 'Órgão público',
    'TOURIST_ATTRACTION': 'Atração', 'MUSEUM': 'Museu', 'PARK_RECREATION_AREA': 'Parque',
    'EXHIBITION_CONVENTION_CENTER': 'Centro de eventos', 'THEATER': 'Teatro', 'CINEMA': 'Cinema',
    'RESTAURANT': 'Restaurante', 'CAFE_PUB': 'Café', 'SHOP': 'Loja', 'PETROL_STATION': 'Posto',
    'PHARMACY': 'Farmácia', 'HOTEL_MOTEL': 'Hotel', 'BANK': 'Banco', 'PLACE_OF_WORSHIP': 'Templo',
    'OPEN_PARKING_AREA': 'Estacionamento', 'PARKING_GARAGE': 'Estacionamento',
    'ELECTRIC_VEHICLE_STATION': 'Recarga', 'SPORTS_CENTER': 'Esporte', 'MARKET': 'Mercado',
}
TIPO_ENDERECO = {'Point Address', 'Address Range'}
PESO_KM = 0.04  # penalidade por km de quem busca: desempata homônimos, não esconde o longe


def normalizar(s: str) -> str:
    """Minúsculas, sem acento nem pontuação, abreviações comuns expandidas."""
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return ' '.join(ABREV.get(t, t) for t in re.findall(r'[a-z0-9]+', s))


def _km(a: dict, b: dict) -> float:
    dy = (a['lat'] - b['lat']) * 110.6
    dx = (a['lon'] - b['lon']) * 111.3 * math.cos(math.radians(a['lat']))
    return math.hypot(dx, dy)


def rotulo(c: dict) -> str:
    """Nome para exibir. ponytail: só o aeroporto volta a ter a palavra (é o caso visto; a
    TomTom não a guarda); estender a lista se aparecer outro marco "sem nome"."""
    if c.get('categoria_codigo') == 'AIRPORT' and 'aeroporto' not in normalizar(c['label']):
        return f"Aeroporto {c['label']}"
    return c['label']


def categoria(c: dict) -> str:
    if c.get('categoria_codigo') in CATEGORIAS:
        return CATEGORIAS[c['categoria_codigo']]
    if c.get('tipo') in TIPO_ENDERECO:
        return 'Endereço'
    if c.get('tipo') == 'Street' or c.get('fonte') == 'malha':
        return 'Via'
    return 'Lugar'


def ranquear(q: str, candidatos: List[dict], perto: Tuple[float, float], limite: int) -> List[dict]:
    """Ordena por casamento de nome, marco, aglomeração, distância e nota da fonte."""
    qn = normalizar(q)
    qt = qn.split()
    if not qt:
        return []
    tem_numero = any(t.isdigit() for t in qt)
    ref = {'lat': perto[0], 'lon': perto[1]}

    def casa(toks: List[str]) -> bool:  # cada termo digitado é prefixo de alguma palavra
        return all(any(t.startswith(x) for t in toks) for x in qt)

    avaliados = []
    for c in candidatos:
        nome = normalizar(c['label'])
        # A TomTom tira a palavra da categoria do nome ("Internacional de Brasília-Presidente
        # JK" é o AIRPORT): a categoria em português também conta como nome.
        cat = normalizar(CATEGORIAS.get(c.get('categoria_codigo'), ''))
        nomes = [nome] + ([f'{cat} {nome}'] if cat and cat not in nome.split() else [])
        tn = ' '.join(nomes).split()
        if casa(tn):
            base = 3.0 if qn in nomes else 2.2 if any(n.startswith(qn) for n in nomes) else 1.6
        elif casa(tn + normalizar(f"{c.get('sublabel', '')} {c.get('bairro') or ''}").split()):
            base = 0.6  # o texto bate só no endereço
        else:
            continue  # nada do que foi digitado (fuzzy da fonte): fora
        avaliados.append({**c, '_nome': nome, '_base': base, '_no_nome': base > 1.0})

    for c in avaliados:
        vizinhos = sum(1 for o in avaliados if o is not c and o['_no_nome'] and _km(c, o) < 0.4)
        c['_pontos'] = (
            c['_base'] + float(c.get('score') or 0.0)
            + (0.8 if c.get('categoria_codigo') in MARCOS else 0.0)
            + 0.25 * min(vizinhos, 4)
            - PESO_KM * _km(c, ref)
            + (1.0 if tem_numero and c.get('tipo') in TIPO_ENDERECO else 0.0)
        )
    avaliados.sort(key=lambda c: -c['_pontos'])
    # Com um resultado forte, o que ficou muito atrás é ruído (ex.: rua homônima em GO).
    corte = max(1.0, avaliados[0]['_pontos'] - 2.5) if avaliados else 0.0

    def repetido(o: dict, c: dict) -> bool:
        # Mesmo lugar por outra fonte, sub-ponto dele ("Park Shopping Brasília", o carregador
        # a 50 m do "Park Shopping") ou a mesma via em outro trecho do mesmo bairro.
        perto_mesmo = _km(o, c) < 0.3 and (o['_nome'] == c['_nome'] or c['_nome'].startswith(o['_nome'] + ' '))
        mesma_via = (o.get('tipo') == c.get('tipo') == 'Street' and o['_nome'] == c['_nome']
                     and o.get('bairro') == c.get('bairro'))
        return perto_mesmo or mesma_via

    saida: List[dict] = []
    for c in avaliados:
        if c['_pontos'] < corte or any(repetido(o, c) for o in saida):
            continue
        saida.append(c)
        if len(saida) >= limite:
            break
    return saida


# --- Fontes ---------------------------------------------------------------------

def _bairro_proximo(lat: float, lon: float, max_km: float = 3.0) -> Optional[str]:
    """Bairro/setor OSM mais próximo (602 pontos do DF). ponytail: ponto mais próximo,
    não polígono — erra perto de divisa; trocar por polígonos das RAs se incomodar."""
    global _bairros
    if _bairros is None:
        try:
            with open(_BAIRROS_JSON, encoding='utf-8') as f:
                _bairros = json.load(f)['lugares']
        except (OSError, ValueError, KeyError):
            _bairros = []
    alvo = {'lat': lat, 'lon': lon}
    melhor = min(_bairros, key=lambda b: _km(alvo, b), default=None)
    return melhor['nome'] if melhor is not None and _km(alvo, melhor) <= max_km else None


def _via_sublabel(tipo_via: Optional[str]) -> str:
    """Mapeia tipo OSM para descrição PT-BR amigável."""
    mapa = {
        'motorway': 'Via expressa',
        'trunk': 'Via arterial',
        'primary': 'Via principal',
        'secondary': 'Via secundária',
        'tertiary': 'Via terciária',
        'residential': 'Via residencial',
        'living_street': 'Via residencial',
        'service': 'Via de serviço',
        'unclassified': 'Via local',
    }
    return mapa.get((tipo_via or '').lower(), 'Via')


async def _malha(sb, q: str, limite: int) -> List[dict]:
    """Vias da malha local cujo nome contém os termos, na ordem digitada."""
    # [^\W_] = letra ou dígito (com acento): % e _ do usuário nunca viram curinga do ILIKE.
    termos = [ABREV.get(t, t) for t in re.findall(r'[^\W_]+', q.lower())]
    if not termos:
        return []
    padrao = '%' + '%'.join(termos) + '%'
    try:
        resp = await asyncio.to_thread(
            lambda: sb.table('malha_completa').select('id_via, nome_via, tipo_via, latitude, longitude')
            .ilike('nome_via', padrao).limit(limite * 6).execute()
        )
    except Exception as e:
        logger.warning(f"Falha ao consultar malha_completa: {e}")
        return []
    vistos, itens = set(), []
    for row in resp.data or []:
        nome = (row.get('nome_via') or '').strip()
        if not nome or row.get('latitude') is None or row.get('longitude') is None:
            continue
        lat, lon = float(row['latitude']), float(row['longitude'])
        bairro = _bairro_proximo(lat, lon)
        if (nome.lower(), bairro) in vistos:  # mesma rua em outro trecho; "Rua 1" de outra RA fica
            continue
        vistos.add((nome.lower(), bairro))
        itens.append({'label': nome, 'sublabel': ' · '.join(x for x in (bairro, _via_sublabel(row.get('tipo_via'))) if x),
                      'lat': lat, 'lon': lon, 'bairro': bairro, 'tipo': 'Street', 'score': 0.9,
                      'fonte': 'malha', 'id_ponto': row.get('id_via')})
    return itens


async def _nominatim(q: str, limite: int) -> List[dict]:
    """Nominatim com cache e trava de 1 req/s (política de uso da OSMF)."""
    global _ultima_nominatim
    chave = (' '.join(q.lower().split()), limite)
    em_cache = _cache_nominatim.get(chave)
    if em_cache is not None:
        return em_cache
    if time.monotonic() - _ultima_nominatim < 1.0:
        return []
    _ultima_nominatim = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(
                'https://nominatim.openstreetmap.org/search',
                params={
                    'q': f"{q}, Brasília, DF, Brasil",
                    'format': 'json',
                    'limit': limite,
                    'countrycodes': 'br',
                },
                headers={'User-Agent': 'Routify/1.0 TCC'},
            )
    except Exception as e:
        logger.warning(f"Falha Nominatim: {e}")
        return []
    if resp.status_code != 200:
        return []
    itens = []
    for item in resp.json():
        label = (item.get('display_name') or '').split(',')[0].strip()
        if label:
            itens.append({'label': label, 'sublabel': (item.get('display_name') or '')[:120],
                          'lat': float(item['lat']), 'lon': float(item['lon']), 'score': 0.5})
    _cache_nominatim.set(chave, itens)
    return itens


@router.get(
    "/places",
    response_model=List[PlaceSuggestion],
    summary="Autocomplete de endereços",
    description=(
        "Junta a malha local (~38 mil vias do DF) e a busca da TomTom (cache de 24 h) e ranqueia "
        "tudo junto: nome que bate inteiro > começo do nome > termos no nome > termos só no endereço; "
        "marcos (shopping, universidade, hospital…) sobem; vários resultados com o nome no mesmo "
        "ponto indicam o lugar de verdade; homônimos desempatam pela distância de `lat`/`lon` "
        "(quem busca) ou do centro de Brasília. O Nominatim só entra com menos de 3 resultados "
        "(a política da OSMF proíbe autocomplete).\n\nO texto digitado **não** é gravado."
    ),
)
async def autocomplete(
    request: Request,
    q: str = Query(..., min_length=2, max_length=120, description="Texto digitado", examples=["park shopping"]),
    limit: int = Query(8, ge=1, le=15, description="Máximo de sugestões."),
    lat: Optional[float] = Query(None, ge=-16.6, le=-15.0, description="Posição de quem busca (viés)."),
    lon: Optional[float] = Query(None, ge=-48.8, le=-46.8, description="Posição de quem busca (viés)."),
):
    limitar(_limite_ip, ip_cliente(request))
    sb = getattr(request.app.state, 'supabase', None)
    # Só associa a requisição à conta (api_requisicoes); o texto digitado não é gravado.
    request.state.user_id = await usage.usuario_do_token_async(sb, request.headers.get('authorization'))
    tt = getattr(request.app.state, 'tomtom', None)
    config = getattr(request.app.state, 'config', None)
    if config is not None:
        await config.atualizar(sb, tt)
    perto = (lat, lon) if lat is not None and lon is not None else CENTRO_BRASILIA

    async def _nada() -> List[dict]:
        return []

    locais, remotos = await asyncio.gather(
        _malha(sb, q, limit) if sb is not None else _nada(),
        # 20 = recall: com 10, lojas "...Aeroporto" empurravam o aeroporto para fora. Mesma chamada.
        tt.buscar(q, 20, perto) if tt is not None and tt.ativo else _nada(),
    )
    candidatos = locais + [dict(r, fonte='tomtom') for r in remotos]
    if len(candidatos) < 3:
        candidatos += [dict(r, fonte='nominatim') for r in await _nominatim(q, limit)]

    return [
        PlaceSuggestion(label=rotulo(c), sublabel=c.get('sublabel') or '', lat=c['lat'], lon=c['lon'],
                        source=c.get('fonte', 'tomtom'), categoria=categoria(c), id_ponto=c.get('id_ponto'))
        for c in ranquear(q, candidatos, perto, limit)
    ]
