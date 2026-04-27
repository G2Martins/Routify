"""
GET /search/places — Autocomplete de locais.

Combina:
1. vias_monitoradas (Supabase) — vias do DF que o Routify monitora ativamente
2. Nominatim (OSM) — fallback genérico para endereços/POIs em Brasília

Retorna até 10 sugestões ordenadas: monitoradas primeiro (relevância LIA), depois Nominatim.
"""
import os
import logging
from typing import List, Optional

import httpx
from fastapi import APIRouter, Query
from pydantic import BaseModel
from supabase import create_client, Client
from dotenv import load_dotenv

ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'Servidor', 'config', '.env')
load_dotenv(ENV_PATH)

router = APIRouter(prefix="/search", tags=["Autocomplete"])
logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

_supabase: Optional[Client] = None


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
    source: str  # "monitorada" | "nominatim"
    id_ponto: Optional[int] = None


@router.get("/places", response_model=List[PlaceSuggestion])
async def autocomplete(
    q: str = Query(..., min_length=2, max_length=120, description="Texto digitado"),
    limit: int = Query(8, ge=1, le=15),
):
    sugestoes: List[PlaceSuggestion] = []

    # 1. Vias monitoradas (LIA tem cobertura preditiva)
    sb = get_supabase()
    if sb is not None:
        try:
            response = (
                sb.table('vias_monitoradas')
                .select('id_ponto, nome_via, latitude, longitude, regiao')
                .ilike('nome_via', f'%{q}%')
                .limit(limit)
                .execute()
            )
            for row in response.data or []:
                if row.get('latitude') is None or row.get('longitude') is None:
                    continue
                sugestoes.append(PlaceSuggestion(
                    label=row.get('nome_via') or 'Via monitorada',
                    sublabel=f"📍 {row.get('regiao') or 'Brasília'} · LIA monitora",
                    lat=float(row['latitude']),
                    lon=float(row['longitude']),
                    source='monitorada',
                    id_ponto=row.get('id_ponto'),
                ))
        except Exception as e:
            logger.warning(f"Falha ao consultar vias_monitoradas: {e}")

    # 2. Nominatim (OSM) — completar com endereços/POIs
    remaining = max(0, limit - len(sugestoes))
    if remaining > 0:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(
                    'https://nominatim.openstreetmap.org/search',
                    params={
                        'q': f"{q}, Brasília, DF, Brasil",
                        'format': 'json',
                        'limit': remaining,
                        'countrycodes': 'br',
                    },
                    headers={'User-Agent': 'Routify/1.0 TCC'},
                )
                if resp.status_code == 200:
                    for item in resp.json():
                        sugestoes.append(PlaceSuggestion(
                            label=(item.get('display_name') or '').split(',')[0],
                            sublabel=(item.get('display_name') or '')[:120],
                            lat=float(item['lat']),
                            lon=float(item['lon']),
                            source='nominatim',
                        ))
        except Exception as e:
            logger.warning(f"Falha Nominatim: {e}")

    return sugestoes[:limit]
