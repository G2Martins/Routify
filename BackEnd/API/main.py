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

import graph_enrichment
import recencia_cache
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
MODEL_VERSION = os.getenv('LIA_VERSION', 'lia_2.1')
GRAPH_CACHE = os.path.join(MODELS_DIR, 'brasilia_graph.graphml')

# ⭐ PRIORITY 1.1: Controle de Cache do Grafo (6 meses)
GRAPH_CACHE_MAX_DAYS = 180
GRAPH_CACHE_MIN_AGE_DAYS = 30

def is_cache_outdated(cache_path: str, max_days: int = 180) -> bool:
    """Verifica se cache do grafo está desatualizado."""
    if not os.path.exists(cache_path):
        return True

    cache_age_seconds = time.time() - os.path.getmtime(cache_path)
    cache_age_days = cache_age_seconds / (24 * 3600)

    is_old = cache_age_days > max_days
    if is_old:
        logging.warning(
            f"Cache com {cache_age_days:.1f} dias (máximo {max_days}). "
            f"Será atualizado no próximo reinício."
        )
    return is_old


def load_model_artifacts():
    model_path = os.path.join(MODELS_DIR, f'{MODEL_VERSION}.pkl')
    encoder_path = os.path.join(MODELS_DIR, f'{MODEL_VERSION}_encoder.pkl')
    meta_path = os.path.join(MODELS_DIR, f'{MODEL_VERSION}_metadata.json')
    # LIA 2.0: tabelas de perfil histórico. São parte do modelo — sem elas as
    # features de perfil ficariam vazias e a predição sairia fora da distribuição.
    profiles_path = os.path.join(MODELS_DIR, f'{MODEL_VERSION}_profiles.pkl')

    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"Modelo {model_path} não encontrado. "
            "Execute BackEnd/Treinamento_IA/train.py primeiro."
        )

    if not os.path.exists(profiles_path):
        raise FileNotFoundError(
            f"Perfis {profiles_path} não encontrados. O modelo LIA 2.0 depende "
            "deles para inferência. Execute BackEnd/Treinamento_IA/train.py "
            "para regerar, ou aponte LIA_VERSION para uma versão compatível."
        )

    model = joblib.load(model_path)
    encoder = joblib.load(encoder_path)
    profiles = joblib.load(profiles_path)
    with open(meta_path, 'r', encoding='utf-8') as f:
        metadata = json.load(f)

    rmse = (metadata.get('cv') or {}).get('modelo_rmse_seg', 'N/A')
    logging.info(f"Modelo {MODEL_VERSION} carregado — RMSE CV: {rmse}s")
    return model, encoder, profiles, metadata


def load_transfer_confidence():
    """Curva de confiança do Knowledge Transfer, calibrada com dados reais
    (calibrar_transfer.py, ver LIA_2.0_AUDITORIA_E_MUDANCAS.md seção 13).

    Substitui a constante fixa (1.0/0.8/0.6 por faixa de distância) — não
    tinha embasamento estatístico, era palpite. Se o artefato não existir
    (ex.: ambiente não rodou a calibração ainda), volta ao esquema fixo
    antigo em vez de falhar a subida do servidor.
    """
    path = os.path.join(MODELS_DIR, 'transfer_confidence_isotonic.pkl')
    if not os.path.exists(path):
        logging.warning(
            f"{path} não encontrado — usando confiança fixa antiga (1.0/0.8/0.6) "
            "como fallback. Rode Treinamento_IA/calibrar_transfer.py para gerar."
        )
        return None
    modelo = joblib.load(path)
    logging.info("Curva de confiança do transfer carregada (calibração isotônica)")
    return modelo


# Centro de Brasília (Plano Piloto). Raio configurável via env GRAPH_RADIUS_KM.
# Default 38km — cobre cidades-satélite e corredores historicamente
# congestionados usados na Fase 3 (EPTG, EPNB: Taguatinga, Samambaia, Águas
# Claras, Guará). O grafo de 15km (TCC 1) cobria só Plano Piloto/Lago/
# Sudoeste/Cruzeiro. Atenção: 38km tem pico de ~1,4GB de RAM ao carregar —
# reduzir aqui em ambientes com pouca memória.
BRASILIA_CENTER = (-15.793, -47.882)
BRASILIA_RADIUS_M = int(os.getenv('GRAPH_RADIUS_KM', '38')) * 1_000


NON_DRIVABLE_HIGHWAYS = {
    'footway', 'pedestrian', 'path', 'steps', 'cycleway',
    'bridleway', 'corridor', 'platform', 'track', 'construction',
    'proposed', 'raceway', 'busway', 'bus_guideway',
    # Rampas de escape existem só para veículo desgovernado; rota normal nunca
    # deve ser traçada por elas. 'dummy' são artefatos sem via correspondente.
    'escape', 'dummy',
}


def _hw_value(data: dict) -> str:
    hw = data.get('highway')
    if isinstance(hw, list):
        return (hw[0] if hw else '').lower()
    return (hw or '').lower()


def filter_drivable(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Remove edges não-drivable + nós isolados.

    Garante que ox.nearest_nodes não snap origem/destino para footway/calçada,
    causa-raiz de rotas que cortam quadras a pé.
    """
    edges_to_remove = [
        (u, v, k) for u, v, k, data in G.edges(keys=True, data=True)
        if _hw_value(data) in NON_DRIVABLE_HIGHWAYS
    ]
    for u, v, k in edges_to_remove:
        G.remove_edge(u, v, k)
    isolated = [n for n in G.nodes if G.degree(n) == 0]
    G.remove_nodes_from(isolated)
    logging.info(
        f"Grafo filtrado: removidas {len(edges_to_remove)} arestas não-drivable, "
        f"{len(isolated)} nós isolados. Restam {G.number_of_nodes()} nós, "
        f"{G.number_of_edges()} arestas."
    )
    return G


def load_graph() -> nx.MultiDiGraph:
    """Carrega ou baixa grafo OSM com controle inteligente de cache.

    ⭐ PRIORITY 1.1: Se cache > 180 dias, deleta e re-download.
    Previne uso de grafo obsoleto com ruas que não existem mais.
    """
    # Verificar se cache está expirado
    if is_cache_outdated(GRAPH_CACHE, GRAPH_CACHE_MAX_DAYS):
        if os.path.exists(GRAPH_CACHE):
            logging.info(
                f"Cache expirado ({GRAPH_CACHE_MAX_DAYS} dias). "
                f"Deletando para atualizar..."
            )
            os.remove(GRAPH_CACHE)

    if os.path.exists(GRAPH_CACHE):
        logging.info(f"Carregando grafo em cache: {GRAPH_CACHE}")
        t0 = time.time()
        G = ox.load_graphml(GRAPH_CACHE)
        cache_age_days = (time.time() - os.path.getmtime(GRAPH_CACHE)) / (24 * 3600)
        logging.info(
            f"Grafo lido do cache em {time.time()-t0:.1f}s "
            f"(cache com {cache_age_days:.1f} dias)"
        )
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
    G = filter_drivable(G)
    return G


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        logging.info("=== Startup: carregando artefatos LIA ===")
        t0 = time.time()
        model, encoder, profiles, metadata = load_model_artifacts()
        transfer_confidence = load_transfer_confidence()
        logging.info(f"Artefatos carregados em {time.time()-t0:.1f}s")

        logging.info("=== Startup: preparando grafo OSM ===")
        t0 = time.time()
        G = load_graph()
        logging.info(f"Grafo pronto em {time.time()-t0:.1f}s")

        # Enriquecimento: velocidade por aresta, coordenada e vínculo com a via
        # monitorada mais próxima. Feito uma vez aqui, não a cada requisição.
        logging.info("=== Startup: enriquecendo grafo ===")
        t0 = time.time()
        try:
            from supabase import create_client
            sb = create_client(str(os.getenv('SUPABASE_URL')), str(os.getenv('SUPABASE_KEY'))) \
                if os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_KEY') else None
        except Exception as e:
            logging.warning(f"Supabase indisponível no startup ({e})")
            sb = None

        graph_stats = graph_enrichment.enrich_graph(G, sb)
        logging.info(f"Grafo enriquecido em {time.time()-t0:.1f}s")

        if graph_stats['vinculadas_lia'] == 0:
            logging.warning(
                "NENHUMA aresta vinculada a via monitorada — o roteamento cairá "
                "100%% em heurística e a LIA não influenciará a rota."
            )

        # Cache de recência (razao_lag1/delta_min_lag1 — feature da LIA 2.1, ver
        # recencia_cache.py). Reusa o mesmo cliente `sb` do enriquecimento em vez
        # de abrir uma conexão nova. Populado já na subida para a primeira
        # requisição não pagar o custo do primeiro refresh.
        logging.info("=== Startup: populando cache de recência ===")
        t0 = time.time()
        recencia = recencia_cache.RecenciaCache()
        recencia.refrescar_se_necessario(sb)
        logging.info(f"Cache de recência pronto em {time.time()-t0:.1f}s")

        app.state.model = model
        app.state.encoder = encoder
        app.state.profiles = profiles
        app.state.metadata = metadata
        app.state.graph = G
        app.state.graph_stats = graph_stats
        app.state.model_version = MODEL_VERSION
        app.state.supabase = sb
        app.state.recencia_cache = recencia
        app.state.transfer_confidence = transfer_confidence

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


def _cv_metric(meta: dict, nome_2_0: str, nome_1_0: str | None = None):
    """Lê uma métrica de CV aceitando os dois formatos de metadata.

    LIA 1.0 gravava na raiz (cv_rmse_medio_seg); a 2.0 aninha sob 'cv'
    (cv.modelo_rmse_seg). Aceitar ambos evita que o dashboard fique vazio ao
    trocar LIA_VERSION entre as versões. nome_1_0=None para métricas que só
    existem na 2.0.
    """
    cv = meta.get("cv")
    if isinstance(cv, dict) and cv.get(nome_2_0) is not None:
        return cv[nome_2_0]
    return meta.get(nome_1_0) if nome_1_0 else None


@app.get("/health")
async def health():
    meta = app.state.metadata
    return {
        "status": "ok",
        "modelo_ativo": app.state.model_version,
        "cv_rmse_seg": _cv_metric(meta, "modelo_rmse_seg", "cv_rmse_medio_seg"),
        "dados_treino": meta.get("dados_treino"),
        "total_amostras_treino": meta.get("total_amostras"),
    }


@app.get("/metrics")
async def metrics():
    """Métricas reais para o DashboardScreen (substitui valores hardcoded)."""
    meta = app.state.metadata
    return {
        "modelo_ativo": app.state.model_version,
        "cv_rmse_seg": _cv_metric(meta, "modelo_rmse_seg", "cv_rmse_medio_seg"),
        "cv_mae_seg": _cv_metric(meta, "modelo_mae_seg", "cv_mae_medio_seg"),
        "n_pontos_monitorados": meta.get("n_pontos_monitorados"),
        "periodo_dados": f"{meta.get('periodo_inicio', '')} → {meta.get('periodo_fim', '')}",
        "total_amostras_treino": meta.get("total_amostras"),
        "feature_importance": meta.get("feature_importance", {}),
        # LIA 2.0: contexto novo que o dashboard pode exibir
        "cv_rmse_seg_baseline": _cv_metric(meta, "baseline_rmse_seg"),
        "pct_congestionado": meta.get("pct_congestionado"),
    }
