"""
Routify API — FastAPI. Documentação interativa em /docs (Swagger) e /redoc;
textos em openapi.py.
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
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from dotenv import load_dotenv

# Credenciais locais (em produção vêm do ambiente). Antes dos imports que leem env.
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', 'services', 'collector', 'config', '.env'))

import config_runtime  # noqa: E402
import graph_enrichment  # noqa: E402
import openapi  # noqa: E402
import recency_cache  # noqa: E402
import tomtom  # noqa: E402
import trajeto  # noqa: E402
import usage  # noqa: E402
from routers import admin, eventos, predict, route, search  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# OSMnx imprime cada request HTTP (Overpass) no console — sem isso parece travado
ox.settings.log_console = True
ox.settings.use_cache = True
ox.settings.timeout = 300  # 5min por request Overpass

MODELS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'ml', 'artifacts')
MODEL_VERSION = os.getenv('LIA_VERSION', 'lia_2.1')
# O raio entra no nome: trocar GRAPH_RADIUS_KM não reaproveita um grafo menor em
# silêncio (o brasilia_graph.graphml antigo tinha ~15 km e não cobria Ceilândia).
GRAPH_CACHE = os.path.join(MODELS_DIR, f"brasilia_graph_{os.getenv('GRAPH_RADIUS_KM', '38')}km.graphml")

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
            f"Para atualizar, apague o arquivo e reinicie (a API baixa de novo)."
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
            "Execute ml/train.py primeiro."
        )

    if not os.path.exists(profiles_path):
        raise FileNotFoundError(
            f"Perfis {profiles_path} não encontrados. O modelo LIA 2.0 depende "
            "deles para inferência. Execute ml/train.py "
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
    (ml/calibrate_transfer.py, ver LIA_2.0_AUDITORIA_E_MUDANCAS.md seção 13).

    Substitui a constante fixa (1.0/0.8/0.6 por faixa de distância) — não
    tinha embasamento estatístico, era palpite. Se o artefato não existir
    (ex.: ambiente não rodou a calibração ainda), volta ao esquema fixo
    antigo em vez de falhar a subida do servidor.
    """
    path = os.path.join(MODELS_DIR, 'transfer_confidence_isotonic.pkl')
    if not os.path.exists(path):
        logging.warning(
            f"{path} não encontrado — usando confiança fixa antiga (1.0/0.8/0.6) "
            "como fallback. Rode ml/calibrate_transfer.py para gerar."
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


def filter_drivable(G: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Remove edges não-drivable + nós isolados.

    Garante que ox.nearest_nodes não snap origem/destino para footway/calçada,
    causa-raiz de rotas que cortam quadras a pé.
    """
    edges_to_remove = [
        (u, v, k) for u, v, k, data in G.edges(keys=True, data=True)
        if graph_enrichment.valor_highway(data) in graph_enrichment.NON_DRIVABLE_HIGHWAYS
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
    """Carrega o grafo OSM do cache (ou baixa na primeira vez e salva).

    Cache com mais de 180 dias só gera aviso: a troca é manual, para não mudar
    o grafo das métricas da tese sem ninguém saber.
    """
    # Grafo velho só gera aviso (is_cache_outdated loga): apagar sozinho trocaria
    # em silêncio o grafo das métricas da tese. Para atualizar, apague o arquivo.
    is_cache_outdated(GRAPH_CACHE, GRAPH_CACHE_MAX_DAYS)

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
        # Snap sem reconstruir a árvore de nós a cada requisição.
        arvore_nos = trajeto.ArvoreNos(G)
        # Semáforos (OSM traffic_signals) + atraso médio calibrado contra a TomTom.
        n_semaforos = trajeto.marcar_semaforos(G, arvore_nos, trajeto.carregar_semaforos_osm(
            os.path.join(MODELS_DIR, f'semaforos_osm_{BRASILIA_RADIUS_M // 1000}km.json'),
            BRASILIA_CENTER, BRASILIA_RADIUS_M))
        G.graph['atraso_semaforo_s'] = trajeto.carregar_atraso_semaforo(
            os.path.join(MODELS_DIR, 'semaforos_calibracao.json'))
        logging.info(f"{n_semaforos} cruzamentos com semáforo no grafo")
        # Experimento (desligado por padrão: muda os números da tese): velocidade
        # livre da TomTom nos trechos monitorados, a mesma do treino da LIA.
        if os.getenv('VEL_LIVRE_TOMTOM', '0') == '1':
            with open(os.path.join(MODELS_DIR, 'velocidade_livre_tomtom.json'), encoding='utf-8') as f:
                G.graph['vel_livre_tomtom'] = {int(k): float(v) for k, v in json.load(f)['pontos'].items()}
            logging.info(f"Velocidade livre da TomTom em {len(G.graph['vel_livre_tomtom'])} trechos monitorados")
        logging.info(f"Grafo enriquecido em {time.time()-t0:.1f}s")

        if graph_stats['vinculadas_lia'] == 0:
            logging.warning(
                "NENHUMA aresta vinculada a via monitorada — o roteamento cairá "
                "100%% em heurística e a LIA não influenciará a rota."
            )

        # Cache de recência (razao_lag1/delta_min_lag1 — feature da LIA 2.1, ver
        # recency_cache.py). Reusa o mesmo cliente `sb` do enriquecimento em vez
        # de abrir uma conexão nova. Populado já na subida para a primeira
        # requisição não pagar o custo do primeiro refresh.
        logging.info("=== Startup: populando cache de recência ===")
        t0 = time.time()
        recencia = recency_cache.RecenciaCache()
        recencia.refrescar_se_necessario(sb)
        logging.info(f"Cache de recência pronto em {time.time()-t0:.1f}s")

        app.state.model = model
        app.state.encoder = encoder
        app.state.profiles = profiles
        app.state.metadata = metadata
        app.state.graph = G
        app.state.arvore_nos = arvore_nos
        app.state.graph_stats = graph_stats
        app.state.model_version = MODEL_VERSION
        app.state.supabase = sb
        app.state.recencia_cache = recencia
        app.state.transfer_confidence = transfer_confidence
        # TomTom sob demanda (tomtom.py): sem chave, a API segue só com a LIA.
        app.state.tomtom = tomtom.criar_cliente()
        # Flags do painel ADM (kill switch, orçamento, chaves pausadas…) — config_runtime.py
        app.state.config = config_runtime.ConfigRuntime()
        await app.state.config.atualizar(sb, app.state.tomtom)

        logging.info("=== Routify API pronta ===")
    except Exception as e:
        logging.error(f"FALHA NO STARTUP: {e}")
        logging.error(traceback.format_exc())
        raise
    yield
    await app.state.tomtom.fechar()


app = FastAPI(
    title="Routify API",
    summary="Roteamento preditivo para Brasília/DF: LIA (XGBoost) + A* + TomTom sob demanda.",
    description=openapi.DESCRICAO,
    version="2.1.0",
    contact={"name": "Equipe Routify (TCC 2026)", "url": "https://github.com/G2Martins/Routify"},
    openapi_tags=openapi.TAGS,
    swagger_ui_parameters=openapi.SWAGGER_UI,
    lifespan=lifespan,
)

# Origens explícitas e sem credenciais: o app manda o JWT no header
# Authorization, não em cookie. Em deploy, CORS_ORIGINS (vírgula) sobrescreve.
CORS_ORIGINS = [o.strip() for o in os.getenv(
    'CORS_ORIGINS', 'http://localhost:8081,http://localhost:19006,http://localhost:3000'
).split(',') if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

# Sem log: health checks (o painel ADM consulta a cada poucos segundos) e docs.
ROTAS_SEM_LOG = {'/health', '/docs', '/redoc', '/openapi.json'}


@app.middleware("http")
async def registrar_requisicao(request: Request, call_next):
    """Toda requisição vira uma linha em api_requisicoes (sem query string: o
    texto buscado no autocomplete não é guardado)."""
    inicio = time.perf_counter()
    status, erro = 500, None
    try:
        resposta = await call_next(request)
        status = resposta.status_code
        # Headers básicos em toda resposta (CSP fica de fora: o Swagger carrega de CDN).
        resposta.headers.setdefault('X-Content-Type-Options', 'nosniff')
        resposta.headers.setdefault('X-Frame-Options', 'DENY')
        resposta.headers.setdefault('Referrer-Policy', 'no-referrer')
        return resposta
    except Exception as e:
        erro = type(e).__name__
        raise
    finally:
        if request.method != 'OPTIONS' and request.url.path not in ROTAS_SEM_LOG:
            usage.registrar(getattr(request.app.state, 'supabase', None), 'api_requisicoes', {
                'metodo': request.method,
                'rota': request.url.path[:120],
                'status': status,
                'latencia_ms': int((time.perf_counter() - inicio) * 1000),
                'user_id': getattr(request.state, 'user_id', None),
                'modelo_versao': getattr(request.app.state, 'model_version', None),
                'degradado': getattr(request.state, 'degradado', None),
                'erro': erro,
            })


app.include_router(predict.router)
app.include_router(route.router)
app.include_router(search.router)
app.include_router(eventos.router)
app.include_router(admin.router)


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


@app.get(
    "/health",
    tags=["Sistema"],
    summary="Saúde da API",
    description=(
        "Modelo carregado, estado do pool TomTom (**só contagens**: nunca ids nem chaves), "
        "vias monitoradas vinculadas ao grafo e cache de recência. "
        "`vias_monitoradas = 0` significa Supabase indisponível na subida (rota em heurística). "
        "O painel ADM consulta este endpoint para o status ao vivo."
    ),
    responses={200: {"content": {"application/json": {"example": {
        "status": "ok", "modelo_ativo": "lia_2.1", "cv_rmse_seg": 40.6942,
        "dados_treino": None, "total_amostras_treino": 1513194,
        "tomtom": {"ativo": True, "chaves": 39,
                   "disponiveis": {"fluxo": 39, "incidentes": 39, "busca": 39, "rota": 39}},
        "vias_monitoradas": 630, "supabase_configurado": True,
        "recencia": {"vias": 630, "mais_recente": "2026-07-20T02:56:00+00:00"},
    }}}}},
)
async def health():
    meta = app.state.metadata
    return {
        "status": "ok",
        "modelo_ativo": app.state.model_version,
        "cv_rmse_seg": _cv_metric(meta, "modelo_rmse_seg", "cv_rmse_medio_seg"),
        "dados_treino": meta.get("dados_treino"),
        "total_amostras_treino": meta.get("total_amostras"),
        # Só contagens — nunca ids nem valores de chave num endpoint público.
        "tomtom": app.state.tomtom.resumo(),
        "vias_monitoradas": app.state.graph_stats.get("vias_monitoradas"),
        "supabase_configurado": app.state.supabase is not None,
        "recencia": app.state.recencia_cache.resumo(),
        "semaforos": {"atraso_s": app.state.graph.graph.get('atraso_semaforo_s', 0.0)},
        "velocidade_livre": "tomtom" if app.state.graph.graph.get('vel_livre_tomtom') else "osm",
    }


@app.get(
    "/metrics",
    tags=["Sistema"],
    summary="Métricas do modelo carregado",
    description=(
        "Métricas de validação cruzada (TimeSeriesSplit, 5 folds) lidas do metadata versionado "
        "do modelo ativo: RMSE e MAE em segundos, baseline, período dos dados e importância das "
        "features. Alimenta o Painel do app."
    ),
)
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
