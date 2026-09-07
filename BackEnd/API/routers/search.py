"""
GET /search/places — Autocomplete de locais.

Fonte primária: malha_completa (~38k vias do DF). Rápida, local, consistente.
Fallback: Nominatim (OSM) — só se malha_completa retornou poucos resultados.
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
    source: str  # "malha" | "nominatim"
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


@router.get("/places", response_model=List[PlaceSuggestion])
async def autocomplete(
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

    # 2. Nominatim — só se malha trouxe pouco (<3) ou nenhum casamento exato
    if len(sugestoes) < 3:
        remaining = max(0, limit - len(sugestoes))
        if remaining > 0:
            try:
                async with httpx.AsyncClient(timeout=4.0) as client:
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
                            label = (item.get('display_name') or '').split(',')[0].strip()
                            if not label or label.lower() in nomes_vistos:
                                continue
                            nomes_vistos.add(label.lower())
                            sugestoes.append(PlaceSuggestion(
                                label=label,
                                sublabel=(item.get('display_name') or '')[:120],
                                lat=float(item['lat']),
                                lon=float(item['lon']),
                                source='nominatim',
                            ))
            except Exception as e:
                logger.warning(f"Falha Nominatim: {e}")

    return sugestoes[:limit]
