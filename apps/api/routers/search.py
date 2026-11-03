"""
GET /search/places — Autocomplete de locais.

Fontes, juntas e ranqueadas numa lista só (ranquear()):
  1. Base local do DF:
     - malha_completa (~38 mil vias; consulta ao Supabase com cache de 1 h; acento e caixa
       não importam; o bairro sai do lugar OSM mais próximo);
     - as 602 localidades do OSM em ml/artifacts/bairros_df.json (regiões administrativas,
       bairros, superquadras), em memória: "ceilandia", "asa norte", "sqs 308" saem daqui;
     - ~1.700 pontos de interesse do OSM em ml/artifacts/pois_df.json (estações de metrô, terminais,
       shoppings, hospitais, universidades, parques, atrações; ml/extrair_pois_osm.py), em memória,
       com os nomes alternativos do OSM: "estação galeria", "metrô 112 sul" saem daqui.
  2. TomTom Search v2 (typeahead, cache 24 h) — acha POI e tolera erro de digitação.
  3. Nominatim (OSM) — só se o ranking final trouxer < 3 resultados e a consulta tiver 4+
     letras. A política da OSMF proíbe autocomplete e exige cache e ≤ 1 req/s; por isso fica
     no fim, com trava de 1 s.

Por que ranquear aqui: a nota da TomTom sai ~0,99 para tudo que contém o texto
("Park Shopping" de São Sebastião, o shopping de verdade e as lojas dentro dele).
Os sinais que separam estão na resposta: o nome bate inteiro?, é um marco
(shopping, universidade…)?, há vários resultados com o nome no mesmo ponto
(aglomeração = o lugar de verdade)?, e quão longe está de quem busca.

Apelidos do DF (EPTG, EPIA, Eixão, UnB, Rodoviária, HBDF…) viram uma 2ª consulta com o nome
que a base usa (variantes()); erro de digitação de 1 letra ("shoping", "nacioal") e palavras
coladas ("parkshoping") ainda casam, com nota menor que o casamento exato.
"""
import asyncio
import json
import math
import os
import re
import time
import logging
import unicodedata
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

import httpx
import numpy as np
from fastapi import APIRouter, Query, Request, Security
from pydantic import BaseModel, ConfigDict, Field
from shapely.geometry import Point, shape
from shapely.prepared import prep

import usage
from openapi import erro
from seguranca import Limitador, ip_cliente, limitar
from tomtom import CENTRO_BRASILIA, CacheTTL

router = APIRouter(prefix="/search", tags=["Autocomplete"], dependencies=[Security(usage.bearer)])
logger = logging.getLogger(__name__)

_cache_nominatim = CacheTTL(24 * 3600, max_itens=1024)
_ultima_nominatim = 0.0
# A malha não muda (bootstrap único do coletor): 1 h de cache poupa o Supabase a cada tecla repetida.
_cache_malha = CacheTTL(3600, max_itens=512)
# Autocomplete dispara a cada tecla (com debounce no app): folga para digitação
# normal, corta robô queimando a cota de Search da TomTom.
_limite_ip = Limitador(90)
# Buscas na TomTom por IP e dia UTC (auditoria de 2026-11-03, M2). Passou disso, a busca segue só com a base local
# (malha, lugares, pontos de interesse). 400 ≈ 80 buscas digitadas por dia; IP de operadora (CGNAT) é dividido.
TOMTOM_POR_IP_DIA = 400
_tomtom_por_ip: dict = {}


def tomtom_liberado(ip: str) -> bool:
    dia = int(time.time() // 86400)
    reg = _tomtom_por_ip.get(ip)
    if reg is None or reg[0] != dia:
        if len(_tomtom_por_ip) > 50_000:  # teto de memória sob ataque de muitos IPs
            _tomtom_por_ip.clear()
        reg = _tomtom_por_ip[ip] = [dia, 0]
    reg[1] += 1
    return reg[1] <= TOMTOM_POR_IP_DIA

_BAIRROS_JSON = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml', 'artifacts', 'bairros_df.json')
_bairros: Optional[List[dict]] = None
_bairros_tok: List[List[str]] = []
_B_LAT = _B_LON = np.empty(0)
_RAS: List[Tuple[str, str]] = []  # (nome normalizado, nome) das cidades/vilas = regiões administrativas, maiores primeiro
_POIS_JSON = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml', 'artifacts', 'pois_df.json')
_RAS_JSON = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml', 'artifacts', 'ras_df.json')
_ras: Optional[list] = None  # (nome, caixa, polígono preparado) das 35 RAs
_marcos: Optional[Dict[str, dict]] = None  # nome compacto -> POI, só nomes de um POI só
_pois: Optional[List[dict]] = None
_pois_nomes: List[List[Tuple[str, List[str]]]] = []  # por ponto: (nome normalizado, palavras) de cada forma

LINHAS_MALHA = 150            # a malha tem ~8 trechos por via: 150 linhas dão ~20 nomes
_regex_pausado_ate = 0.0      # PostgREST recusou imatch: usa ILIKE (sem acento) até esta hora


class PlaceSuggestion(BaseModel):
    label: str = Field(..., description="Nome principal (via, lugar ou endereço).", examples=["Park Shopping"])
    sublabel: str = Field(..., description="Bairro · rua (ou tipo de via).", examples=["Guará · Estrada EPIA"])
    lat: float
    lon: float
    source: str = Field(..., description='Origem da sugestão: "malha" | "tomtom" | "nominatim".', examples=["malha"])
    categoria: Optional[str] = Field(None, description="Categoria em português para o ícone/selo.", examples=["Shopping"])
    id_ponto: Optional[int] = Field(None, description="Id da via na malha local, quando source = malha.")


# --- Normalização + apelidos (funções puras — testadas em tests/test_busca*.py) ---

# Só abreviações que NÃO são prefixo da palavra ("av" já casa "avenida" por prefixo).
ABREV = {'qd': 'quadra', 'cj': 'conjunto', 'lt': 'lote', 'pca': 'praca', 'pq': 'parque', 'st': 'setor'}

# O que as pessoas digitam -> como a base (malha / TomTom) escreve. Chave e valor já normalizados.
# Só entra o que foi conferido na malha (backup 2026-09-23) ou na TomTom (2026-11-02): a malha
# guarda "Estrada Parque Taguatinga", e a sigla só aparece em marginais e acessos.
# ponytail: tabela curada à mão; crescer conforme aparecer consulta sem resultado.
APELIDOS = {
    'eptg': 'estrada parque taguatinga',
    'epia': 'estrada parque industria e abastecimento',
    'epnb': 'estrada parque nucleo bandeirante',
    'epcl': 'estrada parque ceilandia',
    'epvp': 'estrada parque vicente pires',
    'epdb': 'estrada parque dom bosco',
    'epgu': 'estrada parque guara',
    'epjk': 'estrada parque juscelino kubitschek',
    'epct': 'estrada parque contorno',
    'epar': 'estrada parque aeroporto',
    'epig': 'estrada parque industrias graficas',
    'eixao': 'eixo rodoviario',
    'unb': 'universidade de brasilia',
    'rodoviaria': 'rodoviaria do plano piloto',
    'hbdf': 'hospital de base',
    'hran': 'hospital regional da asa norte',
    'hras': 'hospital regional da asa sul',
    'hrt': 'hospital regional de taguatinga',
    'hrc': 'hospital regional de ceilandia',
    'hrg': 'hospital regional do gama',
    'hmib': 'hospital materno infantil de brasilia',
    'hub': 'hospital universitario de brasilia',
    # A base (OSM e TomTom) escreve a sigla: "Torre de TV", "Memorial JK" (bateria de 2026-11-02).
    'televisao': 'tv',
    'juscelino kubitschek': 'jk',
    'kubitschek': 'jk',
    # Jeito de falar → nome que a base usa (bateria de 2026-11-03: as outras formas do mesmo ponto já acertavam).
    'igreja dom bosco': 'santuario dom bosco',
    'universitario unb': 'universitario de brasilia',
    'serejao taguatinga': 'estadio serejao',
    'agua claras': 'aguas claras',
    'planalto brasilia': 'palacio do planalto',
}

# Marcos: o que alguém quer dizer ao digitar o nome (e não a loja que o cita).
MARCOS = {'SHOPPING_CENTER', 'AIRPORT', 'COLLEGE_UNIVERSITY', 'SCHOOL', 'HOSPITAL_POLYCLINIC',
          'RAILWAY_STATION', 'STADIUM', 'GOVERNMENT_OFFICE', 'TOURIST_ATTRACTION', 'MUSEUM',
          'PARK_RECREATION_AREA', 'EXHIBITION_CONVENTION_CENTER', 'THEATER', 'CINEMA', 'REGIAO'}

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
CATEGORIAS['BUS_STATION'] = 'Terminal'  # código nosso (pontos do OSM): rodoviárias e terminais
MARCOS.add('BUS_STATION')
# Códigos nossos (localidades do OSM): só rotulam; não entram no nome do candidato.
CATEGORIAS_LOCAIS = {'REGIAO': 'Região', 'BAIRRO': 'Bairro'}
# Qualificador de lugar no fim da consulta ("hospital de base do df"): os nomes não o trazem.
# Fim que a base não traz: "museu nacional da republica", "terraco shopping sudoeste" (bateria de 2026-11-03).
QUALIFICADORES = {'df', 'bsb', 'brasilia', 'republica', 'sudoeste'}
LIGACOES = {'do', 'de', 'da', 'em', 'no', 'na'}
TIPO_ENDERECO = {'Point Address', 'Address Range'}
PREFIXO_GENERICO = {'SHOPPING_CENTER', 'STADIUM', 'AIRPORT'}
PESO_KM = 0.04          # penalidade por km de quem busca: desempata homônimos, não esconde o longe
KM_MAX_PENALIDADE = 15  # além disso é tudo "longe": um nome exato a 25 km não perde para um homônimo parcial


def _palavras(texto: str) -> List[List[str]]:
    """Palavras digitadas, cada uma quebrada em letras/números e com a abreviação expandida:
    'SQS308 Qd5' -> [['sqs', '308'], ['quadra', '5']]."""
    s = unicodedata.normalize('NFKD', texto or '').encode('ascii', 'ignore').decode().lower()
    return [[ABREV.get(t, t) for t in re.findall(r'[a-z]+|\d+', p)] for p in re.findall(r'[a-z0-9]+', s)]


def normalizar(s: str) -> str:
    """Minúsculas, sem acento nem pontuação, letras e números separados (sqs308 = sqs 308),
    abreviações comuns expandidas."""
    return ' '.join(t for p in _palavras(s) for t in p)


def texto_tomtom(q: str) -> str:
    """O que a TomTom recebe: as palavras como foram digitadas (sem acento, caixa nem pontuação),
    SEM separar letra de número. A TomTom indexa "W3 Norte"; "w 3 norte" a perderia."""
    s = unicodedata.normalize('NFKD', q or '').encode('ascii', 'ignore').decode().lower()
    return ' '.join(ABREV.get(w, w) for w in re.findall(r'[a-z0-9]+', s))


def variantes(qn: str) -> List[str]:
    """A consulta normalizada e, se ela cita um apelido do DF, o nome que a base usa (a original
    vem primeiro): 'eptg' -> ['eptg', 'estrada parque taguatinga']. Depois, a consulta sem o
    qualificador ou o bairro do fim ("hospital de base do df", "pier 21 lago sul"): os nomes da base
    não os trazem. Os apelidos vêm antes porque a malha e a 2ª consulta à TomTom usam a posição 1."""
    saida = [qn]
    texto = f' {qn} '
    for apelido, nome in APELIDOS.items():
        if f' {apelido} ' in texto and f' {nome} ' not in texto:
            v = texto.replace(f' {apelido} ', f' {nome} ', 1).strip()
            if v not in saida:
                saida.append(v)
    toks = qn.split()
    while len(toks) > 1 and toks[-1] in QUALIFICADORES:
        toks.pop()
        while len(toks) > 1 and toks[-1] in LIGACOES:
            toks.pop()
    reduzidas = [' '.join(toks)] if len(' '.join(toks)) >= 3 else []
    # Bairro/região no fim, só nome de lugar (sem número: "sqs 308" é endereço) e com 2+ palavras sobrando
    # ("parque aguas claras" continua inteiro).
    _carregar_bairros()
    fim = max((t for t in _bairros_tok if t and all(w.isalpha() for w in t)
               and len(t) < len(toks) - 1 and toks[-len(t):] == t), key=len, default=None)
    if fim:
        resto = toks[:-len(fim)]
        while resto and resto[-1] in LIGACOES:   # "hospital de [taguatinga]" -> "hospital": genérico demais
            resto = resto[:-1]
        if sum(1 for w in resto if w not in LIGACOES) >= 2:
            reduzidas.append(' '.join(resto))
    for v in reduzidas:
        if v not in saida:
            saida.append(v)
    return saida[:3]


def _km(a: dict, b: dict) -> float:
    dy = (a['lat'] - b['lat']) * 110.6
    dx = (a['lon'] - b['lon']) * 111.3 * math.cos(math.radians(a['lat']))
    return math.hypot(dx, dy)


def _perto(a: str, b: str, k: int) -> bool:
    """Distância de edição entre a e b (com troca de letras vizinhas, versão OSA) <= k?
    Sai assim que a linha inteira passa de k: quase toda comparação falha nas 2-3 primeiras letras."""
    if abs(len(a) - len(b)) > k:
        return False
    prev2, prev = [], list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                cur[j] = min(cur[j], prev2[j - 2] + 1)
        if min(cur) > k:
            return False
        prev2, prev = prev, cur
    return prev[-1] <= k


def _quase(x: str, t: str) -> bool:
    """x (5+ letras) é o começo de t com 1 erro de digitação (2 se x tem 12+)? A 1ª letra tem de
    bater: erro de digitação raramente cai nela, e isso poda quase todas as comparações."""
    k = 1 if len(x) < 12 else 2
    if x[0] != t[:1] or len(t) + k < len(x):
        return False
    return any(_perto(x, t[:n], k) for n in range(len(x) - 1, len(x) + 2))


def _casa(qt: List[str], toks: List[str], junto: str = '', curtos: bool = False) -> Optional[str]:
    """Todo termo digitado é começo de alguma palavra? 'exato', 'aprox' (algum termo com erro de
    digitação ou colado: parkshoping) ou None. `junto` = nome sem espaços, p/ consulta de 1 termo."""
    junto = junto if len(qt) == 1 else ''
    aprox, curto = False, False
    for x in qt:
        if any(t.startswith(x) for t in toks) or (len(x) >= 5 and junto.startswith(x)):
            continue
        if len(x) >= 5 and not x.isdigit() and (any(_quase(x, t) for t in toks) or (junto and _quase(x, junto))):
            aprox = True
            continue
        # Erro em palavra curta ou na 1ª letra ("sull", "nrte", "bse", "stacao"): uma só por consulta,
        # palavra inteira a 1 edição, nunca número, e o resto da consulta tem de casar. Só com `curtos`:
        # nos bairros e quadras um código difere do vizinho por uma letra (sqs/sqn, shis/shin).
        if curtos and len(qt) >= 2 and len(x) >= 3 and not x.isdigit() and not curto and any(
                len(t) >= 3 and _perto(x, t, 1) for t in toks):
            aprox = curto = True
            continue
        return None
    return 'aprox' if aprox else 'exato'


def rotulo(c: dict) -> str:
    """Nome para exibir. ponytail: só o aeroporto volta a ter a palavra (é o caso visto; a
    TomTom não a guarda); estender a lista se aparecer outro marco "sem nome"."""
    if c.get('categoria_codigo') == 'AIRPORT' and 'aeroporto' not in normalizar(c['label']):
        return f"Aeroporto {c['label']}"
    return c['label']


def categoria(c: dict) -> str:
    codigo = c.get('categoria_codigo')
    if codigo in CATEGORIAS:
        return CATEGORIAS[codigo]
    if codigo in CATEGORIAS_LOCAIS:
        return CATEGORIAS_LOCAIS[codigo]
    if c.get('tipo') in TIPO_ENDERECO:
        return 'Endereço'
    if c.get('tipo') == 'Street' or c.get('fonte') == 'malha':
        return 'Via'
    return 'Lugar'


def _nomes(c: dict, nome: str) -> List[str]:
    """Formas do nome que valem como "o nome". A TomTom tira a palavra da categoria do marco
    ("Internacional de Brasília-Presidente JK" é o AIRPORT) e a põe de prefixo em outros
    ("Shopping Conjunto Nacional" também é "Conjunto Nacional")."""
    cat = normalizar(CATEGORIAS.get(c.get('categoria_codigo'), ''))
    if not cat:
        return [nome]
    if cat not in nome.split():
        return [nome, f'{cat} {nome}']
    # Só nestes a palavra é genérica e cai na fala ("Hospital Lago Sul" é um hospital NO Lago Sul,
    # não o Lago Sul): shopping, estádio e aeroporto.
    if c.get('categoria_codigo') in PREFIXO_GENERICO and nome.startswith(cat + ' '):
        return [nome, nome[len(cat) + 1:]]
    return [nome]


def ranquear(q: str, candidatos: List[dict], perto: Tuple[float, float], limite: int,
             variantes: Optional[List[str]] = None) -> List[dict]:
    """Ordena por casamento de nome, marco, aglomeração, distância e nota da fonte.

    `variantes` = outras formas da mesma consulta (apelidos do DF, ver variantes()): vale a
    melhor nota entre elas.
    """
    qn = normalizar(q)
    if not qn:
        return []
    qs = [qn] + [v for v in (variantes or []) if v and v != qn]
    palavras_q = {t for v in qs for t in v.split()}
    tem_numero = any(t.isdigit() for t in qn.split())
    ref = {'lat': perto[0], 'lon': perto[1]}

    avaliados = []
    for c in candidatos:
        nome = normalizar(c['label'])
        nomes = _nomes(c, nome) + list(c.get('_nomes_extra', ()))  # alternativos do OSM (pontos de interesse)
        tn = ' '.join(nomes).split()
        junto = ''.join(nome.split())
        base = 0.0
        colados = [''.join(n.split()) for n in nomes]   # "parkshopping" é "park shopping" sem o espaço
        for v in qs:
            m = _casa(v.split(), tn, junto, curtos=True)
            if m == 'aprox':
                base = max(base, 1.2)
            elif m:
                vc = v.replace(' ', '')
                # Mesmas palavras em outra ordem também é o nome: "Pátio Brasil Shopping" = "Shopping Pátio Brasil".
                exato = v in nomes or vc in colados or any(sorted(v.split()) == sorted(n.split()) for n in nomes)
                comeca = any(n.startswith(v) for n in nomes) or any(n.startswith(vc) for n in colados)
                base = max(base, 3.6 if exato else 2.2 if comeca else 1.6)
        if base == 0.0:
            ender = tn + normalizar(f"{c.get('sublabel', '')} {c.get('bairro') or ''}").split()
            if any(_casa(v.split(), ender) for v in qs):
                base = 0.6  # o texto bate só no endereço
            else:
                continue  # nada do que foi digitado (fuzzy da fonte): fora
        cat = normalizar(CATEGORIAS.get(c.get('categoria_codigo'), ''))
        # Marco só pesa quando o NOME bate forte ("Ceilândia" não vira a escola que a cita) ou
        # quando a pessoa digitou a categoria ("hospital taguatinga").
        marco = c.get('categoria_codigo') in MARCOS
        bonus = 0.8 if marco and (base >= 2.2 or (cat and all(w in palavras_q for w in cat.split()))) else 0.0
        avaliados.append({**c, '_nome': nome, '_base': base, '_no_nome': base > 1.0, '_marco': marco, '_bonus': bonus})

    for c in avaliados:
        # Aglomeração só conta para quem É o nome (exato/começo): lojas que citam o shopping não
        # herdam o bônus de estar perto de outras lojas que o citam.
        vizinhos = (sum(1 for o in avaliados if o is not c and o['_no_nome']
                        and abs(o['lat'] - c['lat']) < 0.004 and _km(c, o) < 0.4)  # 0,004° ≈ 440 m: poda barata
                    if c['_base'] >= 2.2 else 0)
        c['_pontos'] = (
            c['_base'] + min(max(float(c.get('score') or 0.0), 0.0), 1.0) + c['_bonus']
            + 0.25 * min(vizinhos, 4)
            - PESO_KM * min(_km(c, ref), KM_MAX_PENALIDADE)
            + (1.0 if tem_numero and c.get('tipo') in TIPO_ENDERECO else 0.0)
        )
    avaliados.sort(key=lambda c: -c['_pontos'])
    # Com um resultado forte, o que ficou muito atrás é ruído (ex.: rua homônima em GO).
    corte = max(1.0, avaliados[0]['_pontos'] - 2.5) if avaliados else 0.0

    def repetido(o: dict, c: dict) -> bool:
        d = _km(o, c)
        mesmo = o['_nome'] == c['_nome']
        return (
            # Mesmo lugar por outra fonte ou sub-ponto dele ("Park Shopping Brasília", o carregador
            # a 50 m do "Park Shopping")...
            (d < 0.3 and (mesmo or c['_nome'].startswith(o['_nome'] + ' ')))
            or (mesmo and d < 0.6)
            # ...a mesma via em outro trecho (mesmo bairro, ou a menos de 1,5 km)...
            or (mesmo and o.get('tipo') == c.get('tipo') == 'Street' and (d < 1.5 or o.get('bairro') == c.get('bairro')))
            # ...ou o que é só parte do marco já escolhido (loja no shopping, setor do hospital).
            or (o['_marco'] and o['_base'] >= 2.2 and d < 0.25 and c['_base'] < 2.2)
        )

    saida: List[dict] = []
    for c in avaliados:
        if c['_pontos'] < corte:
            break  # lista ordenada: o resto é pior
        # No máximo 3 por nome: "W3 Sul" em 8 bairros não é lista, é a mesma via repetida.
        if any(repetido(o, c) for o in saida) or sum(o['_nome'] == c['_nome'] for o in saida) >= 3:
            continue
        saida.append(c)
        if len(saida) >= limite:
            break
    return saida


# --- Fontes ---------------------------------------------------------------------

def _carregar_bairros() -> List[dict]:
    """602 localidades do OSM, lidas uma vez. Falha de leitura = lista vazia (sem bairro, sem erro)."""
    global _bairros, _bairros_tok, _B_LAT, _B_LON, _RAS
    if _bairros is None:
        try:
            with open(_BAIRROS_JSON, encoding='utf-8') as f:
                lugares = json.load(f)['lugares']
            toks = [normalizar(b['nome']).split() for b in lugares]
            lat = np.array([b['lat'] for b in lugares], dtype=float)
            lon = np.array([b['lon'] for b in lugares], dtype=float)
            ras = sorted({(' '.join(t), b['nome']) for t, b in zip(toks, lugares) if b.get('tipo') in ('city', 'town')},
                         key=lambda r: -len(r[0]))
        except (OSError, ValueError, KeyError, TypeError):
            lugares, toks, lat, lon, ras = [], [], np.empty(0), np.empty(0), []
        _bairros, _bairros_tok, _B_LAT, _B_LON, _RAS = lugares, toks, lat, lon, ras
    return _bairros


@lru_cache(maxsize=8192)
def _bairro_proximo(lat: float, lon: float, max_km: float = 3.0) -> Optional[str]:
    """Bairro/setor OSM mais próximo (602 pontos do DF). ponytail: ponto mais próximo,
    não polígono — erra perto de divisa; trocar por polígonos das RAs se incomodar."""
    if not _carregar_bairros():
        return None
    dy = (_B_LAT - lat) * 110.6
    dx = (_B_LON - lon) * 111.3 * math.cos(math.radians(lat))
    d = np.hypot(dx, dy)
    i = int(d.argmin())
    return _bairros[i]['nome'] if d[i] <= max_km else None


def _carregar_ras() -> list:
    """Polígonos das 35 regiões administrativas (ml/extrair_ras_osm.py), lidos uma vez. Sem o arquivo: lista vazia."""
    global _ras
    if _ras is None:
        try:
            with open(_RAS_JSON, encoding='utf-8') as f:
                geoms = [(r['nome'], shape(r['geometria'])) for r in json.load(f)['ras']]
            _ras = [(nome, g.bounds, prep(g)) for nome, g in geoms]
        except (OSError, ValueError, KeyError, TypeError):
            _ras = []
    return _ras


@lru_cache(maxsize=8192)
def area_de(lat: float, lon: float) -> str:
    """Região administrativa que CONTÉM o ponto (polígono do OSM). O bairro mais próximo errava na divisa: o
    ParkShopping saía "Candangolândia", o Iguatemi "Varjão". Fora das RAs, o bairro mais próximo (ou '')."""
    for nome, (x0, y0, x1, y1), g in _carregar_ras():
        if x0 <= lon <= x1 and y0 <= lat <= y1 and g.contains(Point(lon, lat)):
            return nome
    return _bairro_proximo(lat, lon) or ''


def _regiao_de(nome_norm: str) -> str:
    """Região administrativa que o próprio nome cita ("Ceilândia Norte" -> Ceilândia); superquadra
    e comércio local -> Plano Piloto. Pelo nome, não pelo ponto mais próximo: a RA mais próxima de
    uma superquadra da Asa Sul era o Sudoeste."""
    texto = f' {nome_norm} '
    for ra_norm, ra in _RAS:
        if ra_norm != nome_norm and f' {ra_norm} ' in texto:
            return ra
    return 'Plano Piloto' if nome_norm.split()[0] in ('sqs', 'sqn', 'cls', 'cln') else ''


def _lugares(vs: List[str], perto: Tuple[float, float], maximo: int = 25) -> List[dict]:
    """Regiões administrativas, bairros e superquadras do OSM que casam com a consulta (sem rede).
    ponytail: foto de 2026-09-24; refazer com a consulta Overpass gravada no próprio JSON."""
    lugares = _carregar_bairros()
    qts = [v.split() for v in vs]
    achados = [(b, i) for i, (b, toks) in enumerate(zip(lugares, _bairros_tok))
               if any(_casa(qt, toks, ''.join(toks)) for qt in qts)]
    ref = {'lat': perto[0], 'lon': perto[1]}
    achados.sort(key=lambda bi: _km(ref, bi[0]))
    itens = []
    for b, i in achados[:maximo]:
        regiao = b.get('tipo') in ('city', 'town')
        pai = '' if regiao else _regiao_de(' '.join(_bairros_tok[i]))
        itens.append({'label': b['nome'], 'sublabel': pai, 'lat': b['lat'], 'lon': b['lon'],
                      'bairro': pai or None, 'tipo': 'Place', 'score': 0.9, 'fonte': 'malha',
                      'categoria_codigo': 'REGIAO' if regiao else 'BAIRRO'})
    return itens


def _carregar_pois() -> List[dict]:
    """Pontos de interesse do OSM (ml/extrair_pois_osm.py), lidos uma vez. Falha de leitura = lista vazia."""
    global _pois, _pois_nomes
    if _pois is None:
        try:
            with open(_POIS_JSON, encoding='utf-8') as f:
                pontos = json.load(f)['pontos']
            formas = [[(n, n.split()) for n in dict.fromkeys(normalizar(x) for x in [p['nome']] + p.get('nomes', [])) if n]
                      for p in pontos]
        except (OSError, ValueError, KeyError, TypeError):
            pontos, formas = [], []
        _pois, _pois_nomes = pontos, formas
    return _pois


def _pontos(vs: List[str], perto: Tuple[float, float], maximo: int = 25) -> List[dict]:
    """Pontos de interesse do OSM que casam com a consulta por qualquer forma do nome (sem rede).
    As outras formas vão em `_nomes_extra`, para o ranking valer o casamento por elas."""
    pontos = _carregar_pois()
    qts = [v.split() for v in vs]
    achados = [(p, fs) for p, fs in zip(pontos, _pois_nomes)
               if any(_casa(qt, toks, ''.join(toks), curtos=True) for _, toks in fs for qt in qts)]
    ref = {'lat': perto[0], 'lon': perto[1]}
    achados.sort(key=lambda pf: _km(ref, pf[0]))
    itens = []
    for p, fs in achados[:maximo]:
        bairro = area_de(round(p['lat'], 4), round(p['lon'], 4)) or None
        itens.append({'label': p['nome'], 'sublabel': bairro or '', 'lat': p['lat'], 'lon': p['lon'],
                      'bairro': bairro, 'tipo': 'POI', 'score': 0.9, 'fonte': 'malha',
                      'categoria_codigo': p['categoria_codigo'], '_nomes_extra': [n for n, _ in fs[1:]]})
    return itens


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


# O Postgres do Supabase não tem unaccent exposto no PostgREST; o jeito sem DDL é uma regex em
# que cada vogal vira a classe com as formas acentuadas (a caixa fica por conta do imatch).
_ACENTOS = {
    'a': 'aáàâãäAÁÀÂÃÄ', 'e': 'eéèêëEÉÈÊË', 'i': 'iíìîïIÍÌÎÏ', 'o': 'oóòôõöOÓÒÔÕÖ',
    'u': 'uúùûüUÚÙÛÜ', 'c': 'cçCÇ', 'n': 'nñNÑ',
}


# \s e não um espaço literal: na URL o espaço vira "+", e o PostgREST não precisa adivinhar.
SEPARADOR = r'[\s./-]*'


def _regex_palavra(tokens: List[str]) -> str:
    """Regex de UMA palavra digitada. Os tokens (sqs + 308) aceitam separador entre si ("SQS 308").
    Só entra [a-z0-9]: nada que o usuário digite vira operador de regex."""
    return SEPARADOR.join(''.join(f'[{_ACENTOS[ch]}]' if ch in _ACENTOS else ch for ch in t) for t in tokens)


def _itens_malha(rows: list) -> List[dict]:
    vistos, itens = set(), []
    for row in rows or []:
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


async def _consultar_malha(sb, palavras: List[List[str]], cru: Optional[str]) -> List[dict]:
    """Uma consulta à malha: regex sem acento; se o PostgREST a recusar, ILIKE como antes
    (`cru` = texto digitado; sem ele, só a regex é possível)."""
    global _regex_pausado_ate
    regex = '.*'.join(_regex_palavra(p) for p in palavras[:6])
    usar_regex = time.monotonic() >= _regex_pausado_ate
    chave = (usar_regex, regex if usar_regex else cru)
    em_cache = _cache_malha.get(chave)
    if em_cache is not None:
        return em_cache

    def consulta(com_regex: bool):
        t = sb.table('malha_completa').select('id_via, nome_via, tipo_via, latitude, longitude')
        if com_regex:
            t = t.filter('nome_via', 'imatch', regex)
        else:
            # [^\W_] = letra ou dígito (com acento): % e _ do usuário nunca viram curinga do ILIKE.
            termos = [ABREV.get(t_, t_) for t_ in re.findall(r'[^\W_]+', cru.lower())]
            t = t.ilike('nome_via', '%' + '%'.join(termos) + '%')
        return t.limit(LINHAS_MALHA).execute()

    resp, recusada = None, False
    if usar_regex:
        for tentativa in (1, 2):
            try:
                resp = await asyncio.to_thread(consulta, True)
                break
            except Exception as e:
                # Só um erro RESPONDIDO pelo PostgREST (APIError) diz que ele não aceita o imatch.
                # Queda de conexão (ex.: RemoteProtocolError numa conexão ociosa, visto em produção
                # em 2026-11-02) não diz nada sobre o operador: tenta de novo uma vez.
                recusada = type(e).__name__ == 'APIError'
                logger.warning(f"Malha: consulta por regex falhou ({type(e).__name__}); "
                               + ("tentando ILIKE" if recusada or tentativa == 2 else "tentando de novo"))
                if recusada:
                    break
    if resp is None:
        if cru is None or not re.findall(r'[^\W_]+', cru):
            return []
        try:
            resp = await asyncio.to_thread(consulta, False)
        except Exception as e:
            logger.warning(f"Falha ao consultar malha_completa: {type(e).__name__}")
            return []
        if recusada:  # o PostgREST recusou a regex e o ILIKE passou: sem imatch por 10 min
            _regex_pausado_ate = time.monotonic() + 600
            logger.warning("Malha: imatch recusado; busca da malha segue por ILIKE (sem acento) por 10 min")
    itens = _itens_malha(resp.data)
    _cache_malha.set(chave, itens)
    return itens


async def _malha(sb, q: str) -> List[dict]:
    """Vias da malha local cujo nome contém os termos, na ordem digitada (acento e caixa
    indiferentes), mais as do 1º apelido do DF quando a consulta cita um."""
    alts = [a for a in [_palavras(q)] + [_palavras(v) for v in variantes(normalizar(q))[1:2]] if a]
    if not alts:
        return []
    lotes = await asyncio.gather(*[_consultar_malha(sb, a, q if i == 0 else None) for i, a in enumerate(alts)])
    vistos, itens = set(), []
    for lote in lotes:
        for it in lote:
            chave = (it['label'].lower(), it['bairro'])
            if chave not in vistos:
                vistos.add(chave)
                itens.append(it)
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
        logger.warning(f"Falha Nominatim: {type(e).__name__}")
        return []
    if resp.status_code != 200:
        return []
    itens = []
    try:
        for item in resp.json():
            label = (item.get('display_name') or '').split(',')[0].strip()
            if label:
                itens.append({'label': label, 'sublabel': (item.get('display_name') or '')[:120],
                              'lat': float(item['lat']), 'lon': float(item['lon']), 'score': 0.5})
    except (ValueError, KeyError, TypeError, AttributeError):
        return []  # resposta torta não derruba o autocomplete (e não entra no cache)
    _cache_nominatim.set(chave, itens)
    return itens


def _lista(resultado, fonte: str) -> List[dict]:
    """Uma fonte que quebra vale lista vazia: as outras seguem respondendo."""
    if isinstance(resultado, BaseException):
        logger.warning(f"Busca: fonte '{fonte}' falhou ({type(resultado).__name__})")
        return []
    return resultado or []


@router.get(
    "/places",
    response_model=List[PlaceSuggestion],
    summary="Autocomplete de endereços",
    description=(
        "Junta a base local (malha de ~38 mil vias e 602 regiões/bairros/superquadras do DF), a busca "
        "da TomTom (cache de 24 h) e, em último caso, o Nominatim, e ranqueia tudo junto: nome que bate "
        "inteiro > começo do nome > termos no nome > termos só no endereço; marcos (shopping, "
        "universidade, hospital…) sobem; vários resultados com o nome no mesmo ponto indicam o lugar de "
        "verdade; homônimos desempatam pela distância de `lat`/`lon` (quem busca) ou do centro de "
        "Brasília. Acento e caixa não importam; siglas do DF (EPTG, EPIA, Eixão, UnB, HBDF…) e erro de "
        "digitação de uma letra são entendidos. Lojas dentro de um marco e a mesma via repetida saem. "
        "O Nominatim só entra com menos de 3 resultados e 4+ letras (a política da OSMF proíbe "
        "autocomplete).\n\nO texto digitado **não** é gravado."
    ),
)
async def autocomplete(
    request: Request,
    q: str = Query(..., min_length=2, max_length=120, description="Texto digitado", examples=["park shopping"]),
    limit: int = Query(8, ge=1, le=15, description="Máximo de sugestões."),
    lat: Optional[float] = Query(None, ge=-16.6, le=-15.0, description="Posição de quem busca (viés)."),
    lon: Optional[float] = Query(None, ge=-48.8, le=-46.8, description="Posição de quem busca (viés)."),
):
    ip = ip_cliente(request)
    limitar(_limite_ip, ip)
    qn = normalizar(q)
    if not qn:  # só pontuação/símbolo: nada a buscar, nem cota da TomTom a gastar
        return []
    sb = getattr(request.app.state, 'supabase', None)
    # Só associa a requisição à conta (api_requisicoes); o texto digitado não é gravado.
    request.state.user_id = await usage.usuario_do_token_async(sb, request.headers.get('authorization'))
    tt = getattr(request.app.state, 'tomtom', None)
    config = getattr(request.app.state, 'config', None)
    if config is not None:
        await config.atualizar(sb, tt)
    perto = (lat, lon) if lat is not None and lon is not None else CENTRO_BRASILIA
    vs = variantes(qn)

    async def _nada() -> List[dict]:
        return []

    # 20 = recall: com 10, lojas "...Aeroporto" empurravam o aeroporto para fora. Mesma chamada.
    # Sem acento nem pontuação: "Park-Shopping" e "park shopping" dividem o cache de 24 h (e a cota).
    # A bateria de validação (loopback interno) faz ~400 buscas de uma vez: fora do teto por IP.
    usar_tomtom = tt is not None and tt.ativo and (usage.requisicao_interna(request) or tomtom_liberado(ip))
    remotas = [tt.buscar(t, 20, perto) for t in [texto_tomtom(q)] + vs[1:2]] if usar_tomtom else []
    achados = await asyncio.gather(_malha(sb, q) if sb is not None else _nada(), *remotas, return_exceptions=True)
    locais = _lista(achados[0], 'malha')
    remotos = [r for a in achados[1:] for r in _lista(a, 'tomtom')]
    candidatos = locais + _lugares(vs, perto) + _pontos(vs, perto) + [dict(r, fonte='tomtom') for r in remotos]

    saida = ranquear(q, candidatos, perto, limit, vs)
    # Só conta o que sobrou do ranking: três resultados fuzzy da TomTom que não casam com nada
    # não impedem o último recurso. A trava de 1 s e o cache de 24 h seguem valendo.
    if len(saida) < 3 and len(qn) >= 4:
        extras = await _nominatim(q, limit)
        if extras:
            saida = ranquear(q, candidatos + [dict(r, fonte='nominatim') for r in extras], perto, limit, vs)

    return [
        PlaceSuggestion(label=rotulo(c), sublabel=c.get('sublabel') or '', lat=c['lat'], lon=c['lon'],
                        source=c.get('fonte', 'tomtom'), categoria=categoria(c), id_ponto=c.get('id_ponto'))
        for c in saida
    ]


# --- Destinos recentes ----------------------------------------------------------
# O histórico guarda nome + coordenada. Um destino errado salvo uma vez (2026-09: "Park Shopping" de São Sebastião,
# um POI homônimo da TomTom, com o ranking antigo) voltava para sempre nos recentes, sem bairro. Aqui cada recente
# ganha a RA que o contém e, se o nome é de um marco do OSM com dono único e o ponto salvo está a mais de 3 km dele,
# a coordenada vira a do marco. Rótulo já desambiguado pelo app ("Park Shopping · São Sebastião") não casa com o
# nome do marco e fica como está; 3 km evitam "corrigir" outra entrada do mesmo campus ou parque.

CORRIGE_ALEM_KM = 3.0


class RecenteInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    label: str = Field(..., min_length=1, max_length=300, description="Nome salvo no histórico.")
    lat: float = Field(..., ge=-16.6, le=-15.0)
    lon: float = Field(..., ge=-48.8, le=-46.8)


class RecentesInput(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={"examples": [
        {"recentes": [{"label": "Park Shopping", "lat": -15.9008, "lon": -47.7902}]}]})

    recentes: List[RecenteInput] = Field(..., max_length=10)


class RecenteConferido(BaseModel):
    lat: float
    lon: float
    area: str = Field(..., description="Região administrativa que contém o ponto ('' fora do DF).",
                      examples=["Guará"])
    corrigido: bool = Field(..., description="O nome é de um marco do OSM e o ponto salvo estava a mais de "
                                             "3 km dele: lat/lon passam a ser as do marco.")


def _marcos_por_nome() -> Dict[str, dict]:
    """Nome compacto ("parkshopping") -> POI do OSM, só para nomes (e apelidos) que um único POI usa."""
    global _marcos
    if _marcos is None:
        donos: Dict[str, list] = {}
        for p, formas in zip(_carregar_pois(), _pois_nomes):
            for nome in {n.replace(' ', '') for n, _ in formas}:
                donos.setdefault(nome, []).append(p)
        _marcos = {nome: ps[0] for nome, ps in donos.items() if len(ps) == 1}
    return _marcos


def conferir_recente(label: str, lat: float, lon: float) -> dict:
    marco = _marcos_por_nome().get(normalizar(label).replace(' ', ''))
    corrigido = marco is not None and _km({'lat': lat, 'lon': lon}, marco) > CORRIGE_ALEM_KM
    if corrigido:
        lat, lon = marco['lat'], marco['lon']
    return {'lat': lat, 'lon': lon, 'area': area_de(round(lat, 4), round(lon, 4)), 'corrigido': corrigido}


@router.post(
    "/recentes",
    response_model=List[RecenteConferido],
    summary="Conferir destinos recentes",
    description="Para cada destino do histórico (até 10): a região administrativa que contém o ponto e, quando o "
                "nome é de um marco conhecido (POI do OSM com nome único) e o ponto salvo está a mais de 3 km dele, "
                "a coordenada do marco. Sem TomTom e sem gravar nada. Limite: 90/min por IP (o mesmo da busca).",
    responses={429: erro("Limite por IP excedido.", "Muitas requisições. Tente de novo em instantes.")},
)
async def conferir_recentes(body: RecentesInput, request: Request):
    limitar(_limite_ip, ip_cliente(request))
    return [conferir_recente(r.label, r.lat, r.lon) for r in body.recentes]
