"""
GET /search/places — Autocomplete de locais.

Cadeia (cada etapa só roda se a anterior trouxe < 3 resultados):
  1. malha_completa (~38k vias do DF) — rápida, local, consistente.
  2. TomTom Search v2 (typeahead, cache 24 h) — tolera erro de digitação e acha POI.
  3. Nominatim (OSM) — último recurso. A política da OSMF proíbe autocomplete e
     exige cache e ≤ 1 req/s; por isso fica no fim, com cache e trava de 1 s.
"""
import asyncio
import time
import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Query, Request, Security
from pydantic import BaseModel, Field

import usage
from seguranca import Limitador, ip_cliente, limitar
from tomtom import CacheTTL

router = APIRouter(prefix="/search", tags=["Autocomplete"], dependencies=[Security(usage.bearer)])
logger = logging.getLogger(__name__)

_cache_nominatim = CacheTTL(24 * 3600, max_itens=1024)
_ultima_nominatim = 0.0
# Autocomplete dispara a cada tecla (com debounce no app): folga para digitação
# normal, corta robô queimando a cota de Search da TomTom.
_limite_ip = Limitador(90)


class PlaceSuggestion(BaseModel):
    label: str = Field(..., description="Nome principal (via, lugar ou endereço).", examples=["EPTG"])
    sublabel: str = Field(..., description="Complemento: tipo de via ou endereço completo.", examples=["Via arterial"])
    lat: float
    lon: float
    source: str = Field(..., description='Origem da sugestão: "malha" | "tomtom" | "nominatim".', examples=["malha"])
    id_ponto: Optional[int] = Field(None, description="Id da via na malha local, quando source = malha.")


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
    return mapa.get((tipo_via or '').lower(), 'Via Brasília · DF')


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
                          'lat': float(item['lat']), 'lon': float(item['lon'])})
    _cache_nominatim.set(chave, itens)
    return itens


@router.get(
    "/places",
    response_model=List[PlaceSuggestion],
    summary="Autocomplete de endereços",
    description=(
        "Cadeia de fontes. Cada etapa só roda se a anterior trouxe menos de 3 resultados:\n\n"
        "1. `malha` — ~38 mil vias do DF no Supabase;\n"
        "2. `tomtom` — TomTom Search v2, com viés para Brasília e cache de 24 h;\n"
        "3. `nominatim` — OSM, último recurso, com cache e trava de 1 req/s "
        "(a política da OSMF proíbe autocomplete).\n\n"
        "O texto digitado **não** é gravado."
    ),
)
async def autocomplete(
    request: Request,
    q: str = Query(..., min_length=2, max_length=120, description="Texto digitado", examples=["eptg"]),
    limit: int = Query(8, ge=1, le=15, description="Máximo de sugestões."),
):
    limitar(_limite_ip, ip_cliente(request))
    sb = getattr(request.app.state, 'supabase', None)
    # Só associa a requisição à conta (api_requisicoes); o texto digitado não é gravado.
    request.state.user_id = await usage.usuario_do_token_async(sb, request.headers.get('authorization'))
    tt = getattr(request.app.state, 'tomtom', None)
    config = getattr(request.app.state, 'config', None)
    if config is not None:
        await config.atualizar(sb, tt)
    sugestoes: List[PlaceSuggestion] = []
    nomes_vistos: set = set()

    # 1. malha_completa (~38k vias locais — fonte primária)
    if sb is not None:
        # Curingas do usuário viram texto literal (sem "%%%%" varrendo a tabela).
        termo = q.replace('\\', '').replace('%', r'\%').replace('_', r'\_')
        try:
            response = await asyncio.to_thread(
                lambda: sb.table('malha_completa')
                .select('id_via, nome_via, tipo_via, latitude, longitude')
                .ilike('nome_via', f'%{termo}%')
                .limit(limit * 6)  # busca mais p/ deduplicar por nome
                .execute()
            )
            for row in response.data or []:
                nome = (row.get('nome_via') or '').strip()
                if not nome:
                    continue
                key = nome.lower()
                if key in nomes_vistos:
                    continue
                if row.get('latitude') is None or row.get('longitude') is None:
                    continue
                nomes_vistos.add(key)
                sugestoes.append(PlaceSuggestion(
                    label=nome,
                    sublabel=_via_sublabel(row.get('tipo_via')),
                    lat=float(row['latitude']),
                    lon=float(row['longitude']),
                    source='malha',
                    id_ponto=row.get('id_via'),
                ))
                if len(sugestoes) >= limit:
                    break
        except Exception as e:
            logger.warning(f"Falha ao consultar malha_completa: {e}")

    # 2. TomTom Search, 3. Nominatim — cada um só se ainda houver pouco (< 3)
    fontes = []
    if tt is not None and tt.ativo:
        fontes.append(('tomtom', tt.buscar))
    fontes.append(('nominatim', _nominatim))
    for fonte, buscar in fontes:
        restantes = limit - len(sugestoes)
        if len(sugestoes) >= 3 or restantes <= 0:
            break
        for item in await buscar(q, restantes):
            if item['label'].lower() in nomes_vistos:
                continue
            nomes_vistos.add(item['label'].lower())
            sugestoes.append(PlaceSuggestion(**item, source=fonte))

    return sugestoes[:limit]
