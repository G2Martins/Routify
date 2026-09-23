"""
POST /route — Rota A* com pesos LIA
Recebe origem/destino (lat/lon), retorna polyline otimizada pelo modelo LIA.
"""
import asyncio
import math
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Tuple, Optional

import networkx as nx
import osmnx as ox
import numpy as np
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import tomtom

# ⭐ PRIORITY 2: Imports para Knowledge Transfer
from supabase import create_client
import os
from dotenv import load_dotenv

# Contrato de features da LIA 2.0 — compartilhado com predict.py e espelhando
# ml/features.py.
import lia_inference as lia_inf

router = APIRouter(prefix="/route", tags=["Roteamento A*"])

BRASILIA_TZ = timezone(timedelta(hours=-3))

logger = logging.getLogger(__name__)

# ⭐ PRIORITY 2: Configurar Supabase para buscar vias próximas
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'services', 'collector', 'config', '.env')
load_dotenv(ENV_PATH)

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

def get_supabase_client():
    """Conexão com Supabase para queries."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    return create_client(str(SUPABASE_URL), str(SUPABASE_KEY))


# ⭐ PRIORITY 2: Buscar vias monitoradas próximas
def find_nearby_monitored_points(
    lat: float,
    lon: float,
    radius_m: float = 500,
    limit: int = 3
) -> List[dict]:
    """Busca vias monitoradas próximas usando distância Haversine.

    Retorna lista de dicts:
    [
        {'id_ponto': 42, 'nome_via': 'Esplanada...', 'distancia_m': 150},
        ...
    ]

    ⭐ PRIORITY 2: Usado para Knowledge Transfer em vias sem dados.
    """
    sb = get_supabase_client()
    if sb is None:
        return []

    try:
        # Buscar todas as vias monitoradas
        response = sb.table('vias_monitoradas').select(
            'id_ponto, nome_via, latitude, longitude'
        ).execute()

        vias = response.data or []

        # Calcular distância Haversine para cada uma
        nearby = []
        for via in vias:
            dist = haversine_m(
                lat, lon,
                float(via.get('latitude', 0)),
                float(via.get('longitude', 0))
            )

            if dist <= radius_m:
                nearby.append({
                    'id_ponto': via['id_ponto'],
                    'nome_via': via.get('nome_via', 'Via sem nome'),
                    'distancia_m': dist,
                    'lat': float(via['latitude']),
                    'lon': float(via['longitude']),
                })

        # Ordenar por distância
        nearby.sort(key=lambda x: x['distancia_m'])
        return nearby[:limit]

    except Exception as e:
        logger.warning(f"Erro ao buscar vias próximas: {e}")
        return []


class Coordenada(BaseModel):
    model_config = ConfigDict(extra='forbid')
    lat: float = Field(..., description="Latitude", ge=-90, le=90)
    lon: float = Field(..., description="Longitude", ge=-180, le=180)


class RouteInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    origem: Coordenada
    destino: Coordenada
    # ETA de referência da TomTom (Routing, trânsito ao vivo). Opcional porque
    # gasta cota a cada rota — o app liga quando quer mostrar a comparação.
    referencia_tomtom: bool = False


class IncidenteRota(BaseModel):
    tipo: str
    descricao: Optional[str] = None
    atraso_seg: Optional[int] = None
    interdicao: bool = False
    lat: float
    lon: float


class TomTomResumo(BaseModel):
    """O que a TomTom acrescentou à rota. degradado=True: rota só com a LIA."""
    ativo: bool
    degradado: bool
    vias_atualizadas: int = 0
    arestas_interditadas: int = 0
    interdicoes_na_rota: int = 0
    incidentes: List[IncidenteRota] = []
    referencia_tempo_seg: Optional[int] = None
    referencia_atraso_seg: Optional[int] = None
    referencia_sem_transito_seg: Optional[int] = None
    referencia_distancia_km: Optional[float] = None


class RouteOutput(BaseModel):
    polyline: List[List[float]]
    tempo_total_seg: int
    distancia_km: float
    via_principal: str
    modelo_utilizado: str
    nos_visitados: int

    # --- Instrumentação para validação da tese (TCC 2) ---
    # A rota de menor distância é o "vetor estático" que o artigo afirma superar.
    # Calculá-la na mesma requisição permite comparar as duas decisões sob as
    # mesmas condições de tráfego.
    tempo_rota_curta_seg: Optional[int] = None
    distancia_rota_curta_km: Optional[float] = None
    rotas_diferentes: Optional[bool] = None
    # Percentual das arestas da rota cujo peso veio do modelo/transferência.
    lia_cobertura_pct: Optional[float] = None
    hora_partida: Optional[int] = None
    dia_semana: Optional[int] = None

    tomtom: Optional[TomTomResumo] = None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


NON_DRIVABLE_HIGHWAYS = {
    'footway', 'pedestrian', 'path', 'steps', 'cycleway',
    'bridleway', 'corridor', 'platform', 'track',
}
PENALTY_NON_DRIVABLE_S = 1e9  # peso astronômico — A* nunca escolhe


def _highway_value(edge_data: dict) -> str:
    hw = edge_data.get('highway')
    if isinstance(hw, list):
        return (hw[0] if hw else '').lower()
    return (hw or '').lower()


# ⭐ PRIORITY 1.2: Validar Snap de Nó em Via Drivable
def is_edge_drivable(edge_data: dict) -> bool:
    """Verifica se aresta é dirigível."""
    hw = _highway_value(edge_data)
    return hw not in NON_DRIVABLE_HIGHWAYS


def is_node_drivable(G: nx.MultiDiGraph, node: int) -> bool:
    """Verifica se nó tem pelo menos uma aresta drivable saindo."""
    successors = list(G.successors(node))
    if not successors:
        return False

    for successor in successors:
        edge_data = G.get_edge_data(node, successor)
        if edge_data:
            # MultiDiGraph: pode ter múltiplas chaves
            for key_data in edge_data.values():
                if is_edge_drivable(key_data):
                    return True
    return False


def find_nearest_drivable_node(
    G: nx.MultiDiGraph,
    lat: float,
    lon: float,
    search_radius_m: float = 1000
) -> int:
    """Encontra nó mais próximo que está em via dirigível.

    Busca em raios crescentes: 100m → 200m → 500m → 1000m
    Se nada encontrar, retorna nó mais próximo original (fallback).

    ⭐ PRIORITY 1.2: Previne snap em footway/calçada.
    """
    # Primeiro, tenta nó mais próximo direto
    center_node = ox.nearest_nodes(G, lon, lat)

    if is_node_drivable(G, center_node):
        logger.debug(f"Node {center_node} é drivable (snap direto OK)")
        return center_node

    # Nó original não é dirigível, buscar alternativa
    logger.warning(
        f"Node {center_node} NÃO é drivable (em footway/pedestrian). "
        f"Buscando alternativa..."
    )

    # Pré-calcular distância a todos os nós
    for radius in [100, 200, 500, 1000]:
        candidates = []

        for node in G.nodes():
            node_lat = G.nodes[node]['y']
            node_lon = G.nodes[node]['x']
            dist = haversine_m(lat, lon, node_lat, node_lon)

            if dist <= radius and is_node_drivable(G, node):
                candidates.append((dist, node))

        if candidates:
            # Retornar o mais próximo drivable neste raio
            candidates.sort(key=lambda x: x[0])
            best_node = candidates[0][1]
            best_dist = candidates[0][0]
            logger.info(
                f"Node drivable encontrado a {best_dist:.0f}m "
                f"(ID: {best_node})"
            )
            return best_node

    # Fallback: usar nó original (último recurso)
    logger.error(
        f"Nenhum node drivable encontrado em {search_radius_m}m. "
        f"Usando {center_node} (WARNING: pode estar em footway)"
    )
    return center_node


def _confianca_transfer(dist_m, transfer_confidence=None) -> np.ndarray:
    """Confiança de Knowledge Transfer em função da distância, calibrada com
    dados reais (ml/calibrate_transfer.py — orientador, item 2).

    Antes: constante fixa por faixa (1.0 <200m, 0.8 200-500m, 0.6 ≥500m), sem
    embasamento — era palpite. Substituída por uma curva ajustada por
    regressão isotônica sobre o quanto vias monitoradas realmente se parecem
    em função da distância entre elas (ver LIA_2.0_AUDITORIA_E_MUDANCAS.md
    seção 13). Achado: o esquema antigo era otimista demais — a confiança real
    na faixa 100-500m fica entre 0,58 e 0,71, não os 0,8 assumidos.

    `transfer_confidence`: modelo IsotonicRegression carregado no startup
    (app.state.transfer_confidence). None (artefato ausente) cai no esquema
    fixo antigo, para não derrubar a API por falta desse arquivo específico.
    """
    dist_m = np.atleast_1d(np.asarray(dist_m, dtype=float))
    if transfer_confidence is not None:
        return np.clip(transfer_confidence.predict(dist_m), 0.0, 1.0)
    return np.where(dist_m < 200, 1.0, np.where(dist_m < 500, 0.8, 0.6))


def lia_predict_edge(model, encoder, profiles, edge_data: dict,
                     hora: int, dia_semana: int,
                     transfer_confidence=None) -> Tuple[float, str]:
    """Prediz tempo de viagem para uma aresta do grafo OSM com Knowledge Transfer.

    Retorna (tempo_segundos, source)
    source: 'model' | 'transfer' | 'heuristic' | 'blocked'

    LIA 2.0: o modelo devolve razão de congestionamento; a conversão para
    segundos usa o comprimento REAL da aresta. Todas as features vêm de dados
    que existem na inferência — a 1.0 fabricava os lags, que valiam 91,7% da
    importância do modelo, então operava fora da distribuição de treino.
    """
    # Aresta não-dirigível → peso astronômico.
    if _highway_value(edge_data) in NON_DRIVABLE_HIGHWAYS:
        return PENALTY_NON_DRIVABLE_S, 'blocked'

    vel_livre = float(edge_data.get('speed_kph', 50) or 50)
    length_m = float(edge_data.get('length', 100) or 100)
    if vel_livre <= 0:
        vel_livre = 50.0

    # Check 1: Via está no modelo?
    id_ponto_raw = edge_data.get('id_ponto_supabase')
    if id_ponto_raw is not None and id_ponto_raw in encoder.classes_:
        razao = lia_inf.prever_razao(
            model, encoder, profiles, id_ponto_raw, hora, dia_semana, vel_livre
        )
        return lia_inf.tempo_de_razao(length_m, vel_livre, razao), 'model'

    # Check 2: Tem via próxima monitorada? (Knowledge Transfer)
    edge_lat = edge_data.get('y')
    edge_lon = edge_data.get('x')

    if edge_lat is not None and edge_lon is not None:
        nearby_points = find_nearby_monitored_points(
            float(edge_lat), float(edge_lon), radius_m=500, limit=1
        )

        if nearby_points:
            nearby = nearby_points[0]
            transfer_via = nearby['id_ponto']
            transfer_dist = nearby['distancia_m']

            if transfer_via in encoder.classes_:
                # vel_livre é a da PRÓPRIA aresta, não a da via vizinha: herdamos
                # só o padrão de congestionamento, não a velocidade da via.
                razao = lia_inf.prever_razao(
                    model, encoder, profiles, transfer_via,
                    hora, dia_semana, vel_livre
                )

                # Quanto mais longe a via de referência, mais puxamos a razão de
                # volta para fluxo livre (1.0) — menos confiança, menos correção.
                confianca = float(_confianca_transfer(transfer_dist, transfer_confidence)[0])
                razao_ajustada = razao * confianca + 1.0 * (1 - confianca)

                logger.debug(
                    f"Transfer Learning: via {transfer_via} "
                    f"({nearby['nome_via']}) a {transfer_dist:.0f}m, "
                    f"razão {razao:.3f} → {razao_ajustada:.3f} "
                    f"(confiança {confianca:.1f})"
                )

                return lia_inf.tempo_de_razao(length_m, vel_livre, razao_ajustada), 'transfer'

    # Fallback 3: Heurística pura (sem IA)
    fator = 1.5 if hora in {7, 8, 17, 18} else 1.0
    heuristic_time = (length_m / (vel_livre / 3.6)) * fator

    logger.debug("Via não-monitorada, sem próxima: usando heurística")
    return heuristic_time, 'heuristic'


# Abaixo desta distância, a aresta é considerada o próprio trecho monitorado,
# não uma vizinha recebendo transferência.
DIST_VIA_PROPRIA_M = 50.0


def assign_lia_weights(model, encoder, profiles, G: nx.MultiDiGraph,
                       hora: int, dia_semana: int, recencia_cache=None,
                       transfer_confidence=None) -> dict:
    """Atribui `travel_time_lia` a todas as arestas, em uma única predição.

    Substitui o laço que chamava o modelo aresta por aresta. Como `hora` e
    `dia_semana` são iguais para toda a requisição, o perfil histórico varia
    apenas por via — então basta consultar os perfis uma vez por via monitorada
    (≤630) e replicar para as arestas vinculadas. razao_lag1/delta_min_lag1
    (LIA 2.1) seguem o mesmo raciocínio: são por via, não por aresta.

    Depende de graph_enrichment.enrich_graph() ter rodado na subida do servidor:
    sem `id_ponto_lia` e `speed_kph` nas arestas, tudo cai na heurística e o A*
    volta a ser roteamento por distância.

    recencia_cache: instância de recencia_cache.RecenciaCache, ou None. Se None
    (modelo sem essa feature, ou cache indisponível), cada via cai no fallback
    de lia_inference.montar_features() — equivalente ao comportamento da LIA 2.0.
    """
    arestas = list(G.edges(keys=True, data=True))
    if not arestas:
        return {'model': 0, 'transfer': 0, 'heuristic': 0, 'blocked': 0}

    conhecidas = set(encoder.classes_.tolist())
    IDX_VEL_LIVRE = lia_inf.LIA_FEATURE_ORDER.index('velocidade_livre')

    # Razão de congestionamento de referência para arestas SEM via monitorada
    # em 500 m. Vem do nível global da cascata de perfis — a mediana observada
    # na cidade inteira para este horário e dia.
    #
    # Antes usava-se um fator fixo (1.5 em 7/8/17/18h, 1.0 no resto), o que
    # criava dois esquemas de peso incompatíveis: o modelo devolvia lentidão
    # medida (mediana 1,14x às 8h) enquanto a heurística impunha 1,5x. Uma via
    # monitorada parecia 32% mais barata só pelo esquema de peso, e o A* dava
    # voltas para passar por ela. Fora do pico o viés se invertia. O fator fixo
    # também errava por omissão: 19h tem lentidão real (1,15x) e recebia 1,0.
    razao_global = lia_inf.clamp_razao(
        lia_inf.lookup_perfis(profiles, None, hora, dia_semana)['perfil_hora_dow']
    )

    # --- Template por via, não por aresta ---
    # Fixados hora e dia_semana, a única feature que varia entre arestas da
    # mesma via é velocidade_livre. Montar uma linha-modelo por via e só
    # substituir essa posição evita 22 mil chamadas a encoder.transform().
    vias_usadas = sorted({
        d.get('id_ponto_lia') for _, _, _, d in arestas
        if d.get('id_ponto_lia') is not None
    } & conhecidas)

    templates = {}
    if vias_usadas:
        encodados = encoder.transform(vias_usadas)  # uma chamada, vetorizada
        for via, enc in zip(vias_usadas, encodados):
            perfis = lia_inf.lookup_perfis(profiles, via, hora, dia_semana)
            recencia = recencia_cache.get(via) if recencia_cache is not None else None
            templates[via] = np.asarray(
                lia_inf.montar_features(int(enc), hora, dia_semana, 0.0, perfis, recencia),
                dtype=float,
            )

    linhas, indices, fontes = [], [], []
    resultado = {'model': 0, 'transfer': 0, 'heuristic': 0, 'blocked': 0}

    for i, (u, v, k, d) in enumerate(arestas):
        if _highway_value(d) in NON_DRIVABLE_HIGHWAYS:
            d['travel_time_lia'] = PENALTY_NON_DRIVABLE_S
            d['lia_source'] = 'blocked'
            resultado['blocked'] += 1
            continue

        vel_livre = float(d.get('speed_kph') or 50.0)
        if vel_livre <= 0:
            vel_livre = 50.0
        length_m = float(d.get('length') or 100.0)

        via = d.get('id_ponto_lia')
        tpl = templates.get(via) if via is not None else None
        if tpl is not None:
            dist = float(d.get('dist_lia_m') or 0.0)
            fonte = 'model' if dist < DIST_VIA_PROPRIA_M else 'transfer'
            linha = tpl.copy()
            linha[IDX_VEL_LIVRE] = vel_livre
            linhas.append(linha)
            indices.append(i)
            fontes.append((fonte, dist, vel_livre, length_m))
            resultado[fonte] += 1
        else:
            # Sem via monitorada em 500 m: adota a razão global do horário.
            # Mesma fórmula do ramo do modelo, então as duas famílias de aresta
            # ficam comparáveis e o A* não é enviesado por escolha de esquema.
            d['travel_time_lia'] = lia_inf.tempo_de_razao(length_m, vel_livre, razao_global)
            d['lia_source'] = 'heuristic'
            d['lia_razao'] = round(razao_global, 4)
            resultado['heuristic'] += 1

    # --- Uma única chamada ao modelo para todas as arestas vinculadas ---
    if linhas:
        razoes = np.clip(
            model.predict(np.vstack(linhas)),
            lia_inf.RAZAO_MIN, lia_inf.RAZAO_MAX,
        )

        # Confiança da transferência, vetorizada: quanto mais longe a via de
        # referência, mais a razão volta para fluxo livre (1.0).
        dists = np.array([f[1] for f in fontes])
        eh_transfer = np.array([f[0] == 'transfer' for f in fontes])
        conf = _confianca_transfer(dists, transfer_confidence)
        conf = np.where(eh_transfer, conf, 1.0)
        razoes = razoes * conf + (1.0 - conf)

        for idx, razao, (fonte, _, vel_livre, length_m) in zip(indices, razoes, fontes):
            _, _, _, d = arestas[idx]
            d['travel_time_lia'] = lia_inf.tempo_de_razao(length_m, vel_livre, float(razao))
            d['lia_source'] = fonte
            d['lia_razao'] = round(float(razao), 4)

    logger.info(
        f"Pesos atribuídos: {resultado['model']:,} do modelo, "
        f"{resultado['transfer']:,} de transfer, "
        f"{resultado['heuristic']:,} heurística, "
        f"{resultado['blocked']:,} bloqueadas"
    )
    return resultado


def montar_polyline(G: nx.MultiDiGraph, nos: List[int]) -> List[List[float]]:
    """Traça a rota seguindo a geometria real das vias.

    Ligar apenas os nós em linha reta ignora a curvatura: 46% das arestas têm
    geometria própria, com desvio de 28 m no p90 e até 2 km no extremo. No mapa
    isso aparece como a rota cortando quarteirões e atravessando edificações —
    o traçado estava errado, não o caminho escolhido.
    """
    pontos: List[List[float]] = []

    for u, v in zip(nos[:-1], nos[1:]):
        edge = G.get_edge_data(u, v)
        if not edge:
            continue

        # Entre arestas paralelas, o A* percorre a de menor peso.
        d = min(edge.values(), key=lambda x: x.get('travel_time_lia', float('inf')))
        geom = d.get('geometry')

        trecho: List[List[float]] = []
        if geom is not None:
            try:
                # LineString guarda (x, y) = (lon, lat); a polyline sai [lat, lon].
                trecho = [[float(y), float(x)] for x, y in geom.coords]
            except (AttributeError, TypeError, ValueError):
                trecho = []

        if not trecho:
            trecho = [
                [G.nodes[u]['y'], G.nodes[u]['x']],
                [G.nodes[v]['y'], G.nodes[v]['x']],
            ]
        # A geometria do OSM pode vir no sentido oposto ao da travessia.
        elif _dist_quadrada(trecho[0], G.nodes[u]) > _dist_quadrada(trecho[-1], G.nodes[u]):
            trecho.reverse()

        # Evita duplicar o nó compartilhado entre arestas consecutivas.
        pontos.extend(trecho[1:] if pontos else trecho)

    if not pontos and nos:
        pontos = [[G.nodes[n]['y'], G.nodes[n]['x']] for n in nos]

    return pontos


def _dist_quadrada(ponto: List[float], no: dict) -> float:
    """Distância ao quadrado em graus. Serve só para comparar extremidades."""
    return (ponto[0] - no['y']) ** 2 + (ponto[1] - no['x']) ** 2


def _resumir_caminho(G: nx.MultiDiGraph, nos: List[int]) -> Tuple[float, float, float]:
    """Soma tempo e distância de um caminho e mede a cobertura da LIA nele.

    Cobertura = fração das arestas cujo peso veio do modelo ou de transferência,
    e não da heurística. Serve para testar, na Fase 3, se rotas com mais
    cobertura preveem melhor o tempo real.
    """
    tempo = distancia = 0.0
    com_lia = arestas = 0

    for u, v in zip(nos[:-1], nos[1:]):
        edge = G.get_edge_data(u, v)
        if not edge:
            continue
        # Entre arestas paralelas, o A* percorre a de menor peso.
        d = min(edge.values(), key=lambda x: x.get('travel_time_lia', float('inf')))
        tempo += d.get('travel_time_lia', 60.0)
        distancia += float(d.get('length', 0))
        arestas += 1
        if d.get('lia_source') in ('model', 'transfer'):
            com_lia += 1

    cobertura = (com_lia / arestas * 100) if arestas else 0.0
    return tempo, distancia, cobertura


async def _consultar_tomtom(tt, G, origem, destino, recencia, com_referencia: bool):
    """Uma rodada paralela: fluxo nas vias velhas do corredor + incidentes
    (+ ETA de referência). Nunca levanta — falha vira modo degradado."""
    vias = G.graph.get('vias_monitoradas') or {}
    idade = recencia.idade_min if recencia is not None else (lambda _via: None)
    alvo = tomtom.selecionar_vias_corredor(vias, origem, destino, idade)

    tarefas = [tt.fluxo(*vias[v]) for v in alvo]
    tarefas.append(tt.incidentes(tomtom.bbox_corredor(origem, destino)))
    if com_referencia:
        tarefas.append(tt.rota_referencia(origem, destino))
    resultados = await asyncio.gather(*tarefas, return_exceptions=True)
    for r in resultados:
        if isinstance(r, Exception):
            logger.warning(f"TomTom: erro inesperado ({type(r).__name__})")
    resultados = [None if isinstance(r, Exception) else r for r in resultados]

    atualizadas = 0
    if recencia is not None:
        for via, fsd in zip(alvo, resultados):
            razao = tomtom.razao_de_fluxo(fsd)
            if razao is not None:
                recencia.registrar(via, razao)
                atualizadas += 1
    incidentes = resultados[len(alvo)] or []
    referencia = resultados[len(alvo) + 1] if com_referencia else None
    return atualizadas, incidentes, referencia


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


@router.post("", response_model=RouteOutput)
async def calculate_route(body: RouteInput, request: Request):
    model = request.app.state.model
    encoder = request.app.state.encoder
    profiles = request.app.state.profiles
    G = request.app.state.graph
    version = request.app.state.model_version

    # Recência (razao_lag1/delta_min_lag1 — LIA 2.1). Ausente em app.state se a
    # API estiver rodando com um main.py anterior a essa mudança: nesse caso o
    # comportamento cai para o fallback de montar_features() (perfil histórico),
    # equivalente ao que a LIA 2.0 sempre fez.
    recencia_cache_obj = getattr(request.app.state, 'recencia_cache', None)
    if recencia_cache_obj is not None:
        recencia_cache_obj.refrescar_se_necessario(getattr(request.app.state, 'supabase', None))

    # Curva de confiança do Knowledge Transfer, calibrada com dados reais
    # (orientador, item 2). None (main.py anterior) cai no esquema fixo antigo.
    transfer_confidence_obj = getattr(request.app.state, 'transfer_confidence', None)

    # Contexto temporal atual (Brasília)
    now = datetime.now(tz=BRASILIA_TZ)
    hora = now.hour
    dia_semana = now.weekday()

    # ⭐ PRIORITY 1.2: Encontra nós validando se são drivable
    try:
        # Em vez de nearest_nodes simples, usa validação drivable
        orig_node = find_nearest_drivable_node(G, body.origem.lat, body.origem.lon)
        dest_node = find_nearest_drivable_node(G, body.destino.lat, body.destino.lon)

        logger.info(
            f"Nós encontrados: origem={orig_node} "
            f"(lat={body.origem.lat:.4f}, lon={body.origem.lon:.4f}), "
            f"destino={dest_node} "
            f"(lat={body.destino.lat:.4f}, lon={body.destino.lon:.4f})"
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Erro ao processar coordenadas: {e}")

    if orig_node == dest_node:
        raise HTTPException(status_code=422, detail="Origem e destino são o mesmo ponto no grafo.")

    # TomTom sob demanda: recência ao vivo nas vias velhas do corredor +
    # interdições. Roda antes dos pesos para a LIA já usar a leitura fresca.
    tt = getattr(request.app.state, 'tomtom', None)
    tt_ativo = tt is not None and tt.ativo
    vias_atualizadas, incidentes_tt, referencia_tt = 0, [], None
    if tt_ativo:
        vias_atualizadas, incidentes_tt, referencia_tt = await _consultar_tomtom(
            tt, G, (body.origem.lat, body.origem.lon), (body.destino.lat, body.destino.lon),
            recencia_cache_obj, body.referencia_tomtom,
        )

    # Daqui até o return não há await: pesos (gravados no grafo compartilhado),
    # A* e resumo rodam sem intercalar com outra requisição.
    stats = assign_lia_weights(
        model, encoder, profiles, G, hora, dia_semana,
        recencia_cache_obj, transfer_confidence_obj,
    )
    model_count = stats['model']
    transfer_count = stats['transfer']
    heuristic_count = stats['heuristic']

    # Heurística Haversine para A* (distância euclidiana como lower bound)
    def heuristic(u, v):
        u_data = G.nodes[u]
        v_data = G.nodes[v]
        return haversine_m(
            u_data['y'], u_data['x'],
            v_data['y'], v_data['x'],
        ) / 30  # 30 m/s ≈ 108 km/h (upper bound de velocidade)

    # A* com peso LIA; via interditada (TomTom) sai do caminho
    bloqueadas = tomtom.arestas_interditadas(G, incidentes_tt) if incidentes_tt else set()
    try:
        path_nodes = nx.astar_path(
            G,
            orig_node,
            dest_node,
            heuristic=heuristic,
            weight=(tomtom.peso_sem_interditadas(bloqueadas, PENALTY_NON_DRIVABLE_S)
                    if bloqueadas else 'travel_time_lia'),
        )
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=422, detail="Sem rota disponível entre origem e destino.")
    except nx.NodeNotFound as e:
        raise HTTPException(status_code=422, detail=f"Nó não encontrado no grafo: {e}")

    polyline = montar_polyline(G, path_nodes)

    tempo_total, distancia_total, cobertura_pct = _resumir_caminho(G, path_nodes)

    # --- Baseline: rota de menor distância, sob as mesmas condições ---
    # É o "vetor estático" que o artigo afirma superar. Calculada aqui para que a
    # comparação fique registrada em route_history a cada requisição real.
    tempo_curta = dist_curta = None
    rotas_diferentes = None
    try:
        path_curta = nx.astar_path(
            G, orig_node, dest_node,
            heuristic=lambda u, v: haversine_m(
                G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']
            ),
            weight='length',
        )
        tempo_curta, dist_curta, _ = _resumir_caminho(G, path_curta)
        rotas_diferentes = path_curta != path_nodes
    except (nx.NetworkXNoPath, nx.NodeNotFound, KeyError) as e:
        # A rota principal já foi encontrada; falhar o baseline não deve
        # derrubar a requisição — apenas fica sem comparação.
        logger.warning(f"Baseline de menor distância indisponível: {e}")

    # Via principal = nome mais frequente no caminho
    via_names = []
    for u, v in zip(path_nodes[:10], path_nodes[1:11]):  # primeiros 10 arcos
        via_names.append(get_edge_name(G, u, v))
    via_principal = max(set(via_names), key=via_names.count) if via_names else "Rota Routify"

    logger.info(
        f"Rota calculada: {len(path_nodes)} nós, "
        f"{tempo_total:.0f}s, {distancia_total/1000:.2f}km, "
        f"cobertura LIA {cobertura_pct:.0f}%"
        + (
            f" | menor distância: {tempo_curta:.0f}s, {dist_curta/1000:.2f}km"
            f" ({'rotas diferentes' if rotas_diferentes else 'mesma rota'})"
            if tempo_curta is not None else " | sem baseline"
        )
    )

    ref = referencia_tt or {}
    resumo_tt = TomTomResumo(
        ativo=tt_ativo,
        degradado=not tt_ativo or tt.pool.disponiveis('fluxo') == 0,
        vias_atualizadas=vias_atualizadas,
        arestas_interditadas=len(bloqueadas),
        interdicoes_na_rota=sum(
            1 for u, v in zip(path_nodes[:-1], path_nodes[1:])
            if any((u, v, k) in bloqueadas for k in G[u][v])
        ),
        incidentes=[IncidenteRota(**i) for i in tomtom.incidentes_na_rota(incidentes_tt, polyline)],
        referencia_tempo_seg=ref.get('tempo_seg'),
        referencia_atraso_seg=ref.get('atraso_seg'),
        referencia_sem_transito_seg=ref.get('sem_transito_seg'),
        referencia_distancia_km=ref.get('distancia_km'),
    )

    return RouteOutput(
        polyline=polyline,
        tempo_total_seg=int(tempo_total),
        distancia_km=round(distancia_total / 1000, 2),
        via_principal=via_principal,
        modelo_utilizado=version,
        nos_visitados=len(path_nodes),
        tempo_rota_curta_seg=int(tempo_curta) if tempo_curta is not None else None,
        distancia_rota_curta_km=round(dist_curta / 1000, 2) if dist_curta is not None else None,
        rotas_diferentes=rotas_diferentes,
        lia_cobertura_pct=round(cobertura_pct, 2),
        hora_partida=hora,
        dia_semana=dia_semana,
        tomtom=resumo_tt,
    )
