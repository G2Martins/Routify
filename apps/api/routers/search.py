"""
GET /search/places — Autocomplete de locais.

Cadeia (cada etapa só roda se a anterior trouxe < 3 resultados):
  1. malha_completa (~38k vias do DF) — rápida, local, consistente.
  2. TomTom Search v2 (typeahead, cache 24 h) — tolera erro de digitação e acha POI.
  3. Nominatim (OSM) — último recurso. A política da OSMF proíbe autocomplete e
     exige cache e ≤ 1 req/s; por isso fica no fim, com cache e trava de 1 s.
"""
import os
import time
import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

from tomtom import CacheTTL

ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'services', 'collector', 'config', '.env')
load_dotenv(ENV_PATH)

router = APIRouter(prefix="/search", tags=["Autocomplete"])
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

_supabase: Optional[Client] = None

_cache_nominatim = CacheTTL(24 * 3600, max_itens=1024)
_ultima_nominatim = 0.0


def get_supabase() -> Optional[Client]:
    global _supabase
    if _supabase is None and SUPABASE_URL and SUPABASE_KEY:
        _supabase = create_client(str(SUPABASE_URL), str(SUPABASE_KEY))
    return _supabase


class PlaceSuggestion(BaseModel):
    label: str
    sublabel: str
    lat: float
    lon: float
    source: str  # "malha" | "tomtom" | "nominatim"
    id_ponto: Optional[int] = None


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


@router.get("/places", response_model=List[PlaceSuggestion])
async def autocomplete(
    request: Request,
    q: str = Query(..., min_length=2, max_length=120, description="Texto digitado"),
    limit: int = Query(8, ge=1, le=15),
):
    sugestoes: List[PlaceSuggestion] = []
    nomes_vistos: set = set()

    # 1. malha_completa (~38k vias locais — fonte primária)
    sb = get_supabase()
    if sb is not None:
        try:
            response = (
                sb.table('malha_completa')
                .select('id_via, nome_via, tipo_via, latitude, longitude')
                .ilike('nome_via', f'%{q}%')
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
    tt = getattr(request.app.state, 'tomtom', None)
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
