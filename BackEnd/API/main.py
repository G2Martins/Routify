"""
Routify API — FastAPI
Endpoints:
  POST /route   → A* com pesos LIA
  POST /predict → Inferência LIA por ponto
  GET  /health  → Status da API e modelo carregado
  GET  /metrics → Métricas reais para o Dashboard
"""
import os
import json
import logging
from contextlib import asynccontextmanager

import time
import traceback

import joblib
import osmnx as ox
import networkx as nx
import numpy as np
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import predict, route, search

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# OSMnx imprime cada request HTTP (Overpass) no console — sem isso parece travado
ox.settings.log_console = True
ox.settings.use_cache = True
ox.settings.timeout = 300  # 5min por request Overpass

MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', 'Treinamento_IA', 'models')
MODEL_VERSION = os.getenv('LIA_VERSION', 'lia_1.0')
GRAPH_CACHE = os.path.join(MODELS_DIR, 'brasilia_graph.graphml')


def load_model_artifacts():
    model_path = os.path.join(MODELS_DIR, f'{MODEL_VERSION}.pkl')
    encoder_path = os.path.join(MODELS_DIR, f'{MODEL_VERSION}_encoder.pkl')
    meta_path = os.path.join(MODELS_DIR, f'{MODEL_VERSION}_metadata.json')

    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Modelo {model_path} não encontrado. "
            "Execute BackEnd/Treinamento_IA/train.py primeiro."
        )

    model = joblib.load(model_path)
    encoder = joblib.load(encoder_path)
    with open(meta_path, 'r', encoding='utf-8') as f:
        metadata = json.load(f)

    logging.info(f"Modelo {MODEL_VERSION} carregado — RMSE CV: {metadata.get('cv_rmse_medio_seg', 'N/A')}s")
    return model, encoder, metadata


# Centro de Brasília (Plano Piloto). Raio configurável via env GRAPH_RADIUS_KM.
# Default 15km cobre Plano Piloto + Lago + Sudoeste + Cruzeiro (suficiente pra TCC 1).
# Aumentar pra 30km cobre Taguatinga/Águas Claras mas dobra o tempo de download.
BRASILIA_CENTER = (-15.793, -47.882)
BRASILIA_RADIUS_M = int(os.getenv('GRAPH_RADIUS_KM', '15')) * 1_000


def load_graph() -> nx.MultiDiGraph:
    if os.path.exists(GRAPH_CACHE):
        logging.info(f"Carregando grafo em cache: {GRAPH_CACHE}")
        t0 = time.time()
        G = ox.load_graphml(GRAPH_CACHE)
        logging.info(f"Grafo lido do cache em {time.time()-t0:.1f}s")
    else:
        logging.info(
            f"Baixando grafo OSM (centro {BRASILIA_CENTER}, raio {BRASILIA_RADIUS_M/1000:.0f}km) — "
            "Overpass API. Pode levar 2-10min dependendo da rede e do servidor."
        )
        logging.info("Acompanhe progresso (cada linha 'request' = 1 chamada Overpass):")
        t0 = time.time()
        try:
            G = ox.graph_from_point(
                BRASILIA_CENTER,
                dist=BRASILIA_RADIUS_M,
                network_type="drive",
                simplify=True,
            )
        except Exception as e:
            logging.error(f"Falha ao baixar grafo: {e}")
            logging.error(traceback.format_exc())
            raise
        logging.info(f"Download concluído em {time.time()-t0:.1f}s. Salvando cache...")
        os.makedirs(MODELS_DIR, exist_ok=True)
        ox.save_graphml(G, GRAPH_CACHE)
        logging.info(f"Grafo salvo em cache: {GRAPH_CACHE}")

    logging.info(f"Grafo carregado: {G.number_of_nodes()} nós, {G.number_of_edges()} arestas")
    return G


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        logging.info("=== Startup: carregando artefatos LIA ===")
        t0 = time.time()
        model, encoder, metadata = load_model_artifacts()
        logging.info(f"Artefatos carregados em {time.time()-t0:.1f}s")

        logging.info("=== Startup: preparando grafo OSM ===")
        t0 = time.time()
        G = load_graph()
        logging.info(f"Grafo pronto em {time.time()-t0:.1f}s")

        app.state.model = model
        app.state.encoder = encoder
        app.state.metadata = metadata
        app.state.graph = G
        app.state.model_version = MODEL_VERSION

        logging.info("=== Routify API pronta ===")
    except Exception as e:
        logging.error(f"FALHA NO STARTUP: {e}")
        logging.error(traceback.format_exc())
        raise
    yield


app = FastAPI(
    title="Routify API",
    description="Motor de roteamento preditivo com IA (LIA)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Em produção, restringir ao domínio do app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(predict.router)
app.include_router(route.router)
app.include_router(search.router)


@app.get("/health")
async def health():
    meta = app.state.metadata
    return {
        "status": "ok",
        "modelo_ativo": app.state.model_version,
        "cv_rmse_seg": meta.get("cv_rmse_medio_seg"),
        "dados_treino": meta.get("dados_treino"),
        "total_amostras_treino": meta.get("total_amostras"),
    }


@app.get("/metrics")
async def metrics():
    """Métricas reais para o DashboardScreen (substitui valores hardcoded)."""
    meta = app.state.metadata
    # Valores calculados a partir do modelo — dashboard mostrará stats do treino
    return {
        "modelo_ativo": app.state.model_version,
        "cv_rmse_seg": meta.get("cv_rmse_medio_seg"),
        "cv_mae_seg": meta.get("cv_mae_medio_seg"),
        "n_pontos_monitorados": meta.get("n_pontos_monitorados"),
        "periodo_dados": f"{meta.get('periodo_inicio', '')} → {meta.get('periodo_fim', '')}",
        "total_amostras_treino": meta.get("total_amostras"),
        "feature_importance": meta.get("feature_importance", {}),
    }
