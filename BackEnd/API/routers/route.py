"""
POST /route — Rota A* com pesos LIA
Recebe origem/destino (lat/lon), retorna polyline otimizada pelo modelo LIA.
"""
import math
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Tuple

import networkx as nx
import osmnx as ox
import numpy as np
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/route", tags=["Roteamento A*"])

BRASILIA_TZ = timezone(timedelta(hours=-3))

logger = logging.getLogger(__name__)


class Coordenada(BaseModel):
    lat: float = Field(..., description="Latitude", ge=-90, le=90)
    lon: float = Field(..., description="Longitude", ge=-180, le=180)


class RouteInput(BaseModel):
    origem: Coordenada
    destino: Coordenada


class RouteOutput(BaseModel):
    polyline: List[List[float]]
    tempo_total_seg: int
    distancia_km: float
    via_principal: str
    modelo_utilizado: str
    nos_visitados: int


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def lia_predict_edge(model, encoder, edge_data: dict, hora: int, dia_semana: int) -> float:
    """Prediz tempo de viagem para uma aresta do grafo OSM."""
    vel_livre = float(edge_data.get('speed_kph', 50) or 50)
    length_m = float(edge_data.get('length', 100) or 100)

    # Fallback: se não há id_ponto mapeado, usa heurística física
    id_ponto_raw = edge_data.get('id_ponto_supabase')
    if id_ponto_raw is None or id_ponto_raw not in encoder.classes_:
        # Heurística: tempo = distância / velocidade livre × fator horário
        fator = 1.5 if hora in {7, 8, 17, 18} else 1.0
        return (length_m / (vel_livre / 3.6)) * fator

    id_ponto_enc = int(encoder.transform([id_ponto_raw])[0])
    is_fim_semana = int(dia_semana >= 5)
    is_horario_pico = int(hora in {6, 7, 8, 17, 18, 19})

    features = [
        id_ponto_enc, hora, dia_semana, is_fim_semana, is_horario_pico,
        vel_livre,
        vel_livre, vel_livre, vel_livre, vel_livre,  # lags (fallback = velocidade livre)
        vel_livre, 5.0,                               # rolling mean/std
        length_m / (vel_livre / 3.6) if vel_livre > 0 else 60.0,  # lag_tempo_1h
        length_m / (vel_livre / 3.6) if vel_livre > 0 else 60.0,  # lag_tempo_24h
    ]
    pred = float(model.predict([features])[0])
    return max(1.0, pred)


def get_edge_name(G: nx.MultiDiGraph, u: int, v: int) -> str:
    edge_data = G.get_edge_data(u, v)
    if edge_data:
        for key_data in edge_data.values():
            name = key_data.get('name', '')
            if name and isinstance(name, str):
                return name
            if name and isinstance(name, list):
                return name[0]
    return "Via sem nome"


@router.post("/", response_model=RouteOutput)
async def calculate_route(body: RouteInput, request: Request):
    model = request.app.state.model
    encoder = request.app.state.encoder
    G = request.app.state.graph
    version = request.app.state.model_version

    # Contexto temporal atual (Brasília)
    now = datetime.now(tz=BRASILIA_TZ)
    hora = now.hour
    dia_semana = now.weekday()

    # Encontra nós mais próximos no grafo OSMnx
    try:
        orig_node = ox.nearest_nodes(G, body.origem.lon, body.origem.lat)
        dest_node = ox.nearest_nodes(G, body.destino.lon, body.destino.lat)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Coordenadas fora da área do grafo: {e}")

    if orig_node == dest_node:
        raise HTTPException(status_code=422, detail="Origem e destino são o mesmo ponto no grafo.")

    # Atribui peso LIA a todas as arestas
    for u, v, key, data in G.edges(keys=True, data=True):
        data['travel_time_lia'] = lia_predict_edge(model, encoder, data, hora, dia_semana)

    # Heurística Haversine para A* (distância euclidiana como lower bound)
    def heuristic(u, v):
        u_data = G.nodes[u]
        v_data = G.nodes[v]
        return haversine_m(
            u_data['y'], u_data['x'],
            v_data['y'], v_data['x'],
        ) / 30  # 30 m/s ≈ 108 km/h (upper bound de velocidade)

    # A* com peso LIA
    try:
        path_nodes = nx.astar_path(
            G,
            orig_node,
            dest_node,
            heuristic=heuristic,
            weight='travel_time_lia',
        )
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=422, detail="Sem rota disponível entre origem e destino.")
    except nx.NodeNotFound as e:
        raise HTTPException(status_code=422, detail=f"Nó não encontrado no grafo: {e}")

    # Monta polyline
    polyline = [[G.nodes[n]['y'], G.nodes[n]['x']] for n in path_nodes]

    # Calcula tempo total e distância
    tempo_total = 0.0
    distancia_total = 0.0
    for u, v in zip(path_nodes[:-1], path_nodes[1:]):
        edge = G.get_edge_data(u, v)
        if edge:
            first_edge = list(edge.values())[0]
            tempo_total += first_edge.get('travel_time_lia', 60.0)
            distancia_total += float(first_edge.get('length', 0))

    # Via principal = nome mais frequente no caminho
    via_names = []
    for u, v in zip(path_nodes[:10], path_nodes[1:11]):  # primeiros 10 arcos
        via_names.append(get_edge_name(G, u, v))
    via_principal = max(set(via_names), key=via_names.count) if via_names else "Rota Routify"

    logger.info(
        f"Rota calculada: {len(path_nodes)} nós, "
        f"{tempo_total:.0f}s, {distancia_total/1000:.2f}km"
    )

    return RouteOutput(
        polyline=polyline,
        tempo_total_seg=int(tempo_total),
        distancia_km=round(distancia_total / 1000, 2),
        via_principal=via_principal,
        modelo_utilizado=version,
        nos_visitados=len(path_nodes),
    )
