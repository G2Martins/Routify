"""
POST /route — Rota A* com pesos LIA
Recebe origem/destino (lat/lon), retorna polyline otimizada pelo modelo LIA.
"""
import asyncio
import math
import logging
import time
from datetime import datetime
from typing import List, Tuple, Optional

import networkx as nx
import osmnx as ox
import numpy as np
from fastapi import APIRouter, Request, HTTPException, Security
from pydantic import BaseModel, ConfigDict, Field

import tomtom
import trajeto
import usage
from openapi import erro
from seguranca import Limitador, ip_cliente, limitar

# Contrato de features da LIA 2.0 — compartilhado com predict.py e espelhando
# ml/features.py.
import lia_inference as lia_inf
from graph_enrichment import NON_DRIVABLE_HIGHWAYS, valor_highway
from lia_inference import BRASILIA_TZ

router = APIRouter(prefix="/route", tags=["Roteamento"], dependencies=[Security(usage.bearer)])

logger = logging.getLogger(__name__)

class Coordenada(BaseModel):
    model_config = ConfigDict(extra='forbid')
    lat: float = Field(..., description="Latitude (WGS84)", ge=-90, le=90, examples=[-15.7939])
    lon: float = Field(..., description="Longitude (WGS84)", ge=-180, le=180, examples=[-47.8828])


class RouteInput(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={"examples": [{
        "origem": {"lat": -15.7939, "lon": -47.8828},
        "destino": {"lat": -15.8339, "lon": -48.0569},
        "referencia_tomtom": False,
    }]})
    origem: Coordenada = Field(..., description="Ponto de partida. A API faz o snap para o nó navegável mais próximo.")
    destino: Coordenada = Field(..., description="Ponto de chegada.")
    # ETA de referência da TomTom (Routing, trânsito ao vivo). Opcional porque
    # gasta cota a cada rota — o app liga quando quer mostrar a comparação.
    referencia_tomtom: bool = Field(
        False, description="Legado: o ETA da TomTom já vem pela fusão. Só tem efeito se o painel ADM desligar a fusão.")


class IncidenteRota(BaseModel):
    tipo: str = Field(..., description="Categoria da TomTom (ex.: Congestionamento, Obras, Acidente).")
    descricao: Optional[str] = Field(None, description="Texto do incidente (pt-PT, como a TomTom devolve).")
    atraso_seg: Optional[int] = Field(None, description="Atraso estimado pela TomTom, em segundos.")
    interdicao: bool = Field(False, description="Via fechada. Arestas interditadas saem do A*.")
    lat: float
    lon: float


class TomTomResumo(BaseModel):
    """O que a TomTom acrescentou à rota. degradado=True: rota só com a LIA."""
    ativo: bool = Field(..., description="Há chaves TomTom configuradas.")
    degradado: bool = Field(..., description="Rota calculada só com a LIA (sem chave, cota esgotada ou TomTom fora).")
    vias_atualizadas: int = Field(0, description="Vias monitoradas do corredor lidas ao vivo (Flow Segment Data).")
    arestas_interditadas: int = Field(0, description="Arestas do grafo bloqueadas por interdição no corredor.")
    interdicoes_na_rota: int = Field(0, description="Interdições que ainda tocam a rota escolhida.")
    incidentes: List[IncidenteRota] = Field([], description="Incidentes próximos à rota.")
    referencia_tempo_seg: Optional[int] = Field(None, description="ETA da TomTom com trânsito para o trajeto da LIA (reconstruído na fusão); fora da malha, para a rota da própria TomTom.")
    referencia_atraso_seg: Optional[int] = Field(None, description="Atraso por trânsito segundo a TomTom.")
    referencia_sem_transito_seg: Optional[int] = Field(None, description="ETA da TomTom sem trânsito.")
    referencia_distancia_km: Optional[float] = Field(None, description="Distância da rota da TomTom.")


class AlternativaRota(BaseModel):
    fonte: str = Field(..., description='"lia" ou "tomtom".')
    polyline: List[List[float]]
    tempo_seg: int = Field(..., description="Tempo estimado (misto LIA × TomTom) da alternativa.")
    distancia_km: float


class RouteOutput(BaseModel):
    polyline: List[List[float]] = Field(..., description="Pontos [lat, lon] seguindo a geometria real das vias.")
    tempo_total_seg: int = Field(..., description="Tempo estimado da rota exibida: LIA onde há cobertura, TomTom nas lacunas (ver fusão).")
    distancia_km: float
    via_principal: str = Field(..., description="Via com maior extensão na rota.")
    modelo_utilizado: str = Field(..., description="Versão da LIA (ex.: lia_2.1).")
    nos_visitados: int = Field(..., description="Nós do grafo na rota.")

    # --- Instrumentação para validação da tese (TCC 2) ---
    # A rota de menor distância é o "vetor estático" que o artigo afirma superar.
    # Calculá-la na mesma requisição permite comparar as duas decisões sob as
    # mesmas condições de tráfego.
    tempo_rota_curta_seg: Optional[int] = Field(
        None, description="Tempo previsto da rota de menor distância (baseline estático da tese).")
    distancia_rota_curta_km: Optional[float] = None
    rotas_diferentes: Optional[bool] = Field(None, description="A LIA escolheu um caminho diferente do mais curto.")
    # Percentual das arestas da rota cujo peso veio do modelo/transferência.
    lia_cobertura_pct: Optional[float] = Field(
        None, description="% das arestas da rota com peso vindo da LIA (direto ou por transferência); o resto é heurística.")
    hora_partida: Optional[int] = Field(None, description="Hora local (Brasília) usada na previsão.")
    dia_semana: Optional[int] = Field(None, description="0 = segunda … 6 = domingo.")

    tomtom: Optional[TomTomResumo] = None

    # --- Fusão LIA × TomTom ---
    fonte_rota: str = Field("lia", description='Quem traçou a rota escolhida: "lia" (A* com pesos da LIA) ou "tomtom".')
    tempo_lia_seg: Optional[int] = Field(
        None, description="Tempo previsto pela LIA para a rota da LIA, com o atraso médio de semáforo (instrumentação da tese).")
    fora_da_malha: bool = Field(False, description="Origem/destino além da malha coberta (raio de 38 km); rota só da TomTom.")
    semaforos_na_rota: Optional[int] = Field(
        None, description="Cruzamentos com semáforo (OSM traffic_signals) na rota da LIA; entram no tempo com o atraso médio calibrado.")
    alternativa: Optional[AlternativaRota] = Field(None, description="A candidata não escolhida, para desenho tracejado.")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


PENALTY_NON_DRIVABLE_S = 1e9  # peso astronômico — A* nunca escolhe


# ⭐ PRIORITY 1.2: Validar Snap de Nó em Via Drivable
def is_edge_drivable(edge_data: dict) -> bool:
    """Verifica se aresta é dirigível."""
    hw = valor_highway(edge_data)
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


# Abaixo desta distância, a aresta é considerada o próprio trecho monitorado,
# não uma vizinha recebendo transferência.
DIST_VIA_PROPRIA_M = 50.0


def assign_lia_weights(model, encoder, profiles, G: nx.MultiDiGraph,
                       hora: int, dia_semana: int, recencia_cache=None,
                       transfer_confidence=None, contexto=None) -> dict:
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
    contexto: via → features da LIA 2.2 (ContextoAoVivo.para_requisicao), ou None.
    """
    arestas = list(G.edges(keys=True, data=True))
    if not arestas:
        return {'model': 0, 'transfer': 0, 'heuristic': 0, 'blocked': 0}

    conhecidas = set(encoder.classes_.tolist())
    ordem = lia_inf.ordem_features(model)
    IDX_VEL_LIVRE = ordem.index('velocidade_livre')

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
                lia_inf.montar_features(int(enc), hora, dia_semana, 0.0, perfis, recencia,
                                        contexto(via) if contexto else None, ordem),
                dtype=float,
            )

    linhas, indices, fontes = [], [], []
    resultado = {'model': 0, 'transfer': 0, 'heuristic': 0, 'blocked': 0}
    vel_tomtom = G.graph.get('vel_livre_tomtom')  # None = comportamento da tese (OSM)

    for i, (u, v, k, d) in enumerate(arestas):
        if valor_highway(d) in NON_DRIVABLE_HIGHWAYS:
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
            if fonte == 'model' and vel_tomtom and via in vel_tomtom:
                # Trecho monitorado: mesma velocidade livre do treino (TomTom), não
                # o limite de via do OSM (VEL_LIVRE_TOMTOM=1; ver ml/free_flow_speeds.py).
                vel_livre = vel_tomtom[via]
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


_limite_ip = Limitador(20)  # cada rota gasta Flow/Incidents/Routing da TomTom


def _via_principal(G: nx.MultiDiGraph, nos: List[int]) -> str:
    """Nome com mais metros na rota (não só nos primeiros trechos)."""
    metros: dict = {}
    for u, v in zip(nos[:-1], nos[1:]):
        dados = min(G[u][v].values(), key=lambda d: d.get('length', 0))
        nome = dados.get('name')
        nome = nome[0] if isinstance(nome, list) and nome else nome
        if isinstance(nome, str) and nome:
            metros[nome] = metros.get(nome, 0.0) + float(dados.get('length', 0) or 0)
    return max(metros, key=metros.get) if metros else "Via sem nome"


def _snap(request: Request, G: nx.MultiDiGraph, lat: float, lon: float) -> Tuple[int, float]:
    arvore = getattr(request.app.state, 'arvore_nos', None)
    if arvore is not None:
        return arvore.snap(lat, lon)
    no = find_nearest_drivable_node(G, lat, lon)  # sem árvore (testes, main.py antigo)
    return no, haversine_m(lat, lon, G.nodes[no]['y'], G.nodes[no]['x'])


@router.post(
    "",
    response_model=RouteOutput,
    summary="Calcular rota (LIA + A* + TomTom)",
    description=(
        "Rota mais rápida combinando a LIA com a TomTom. A LIA traça o A* com seus pesos; a TomTom "
        "atualiza as vias do corredor, remove interdições e propõe a própria rota. Cada candidata "
        "recebe um tempo misto: a parte coberta pela LIA vale pela LIA, o resto (lacunas do "
        "histórico) pela TomTom; vence a menor e a outra volta em `alternativa`. Fora da malha de "
        "38 km, a rota é só da TomTom. A rota de menor distância segue calculada para a tese. "
        "Token opcional: com ele, a rota entra no histórico de uso da conta (coordenadas "
        "arredondadas em ~110 m). Limite: 20 rotas/min por IP."
    ),
    responses={
        422: erro("Coordenadas fora da área atendida ou sem caminho entre os pontos.",
                  "Sem rota disponível entre origem e destino."),
        429: erro("Limite de rotas por minuto excedido.", "Muitas requisições. Tente de novo em instantes."),
    },
)
async def calculate_route(body: RouteInput, request: Request):
    limitar(_limite_ip, ip_cliente(request))
    inicio_req = time.perf_counter()
    # Usuário é opcional (rota anônima segue funcionando); com token válido, o
    # uso fica associado à conta para o painel ADM.
    sb = getattr(request.app.state, 'supabase', None)
    user_id = await usage.usuario_do_token_async(sb, request.headers.get('authorization'))
    request.state.user_id = user_id

    model = request.app.state.model
    encoder = request.app.state.encoder
    profiles = request.app.state.profiles
    G = request.app.state.graph
    version = request.app.state.model_version
    tt = getattr(request.app.state, 'tomtom', None)
    config = getattr(request.app.state, 'config', None)
    if config is not None:
        await config.atualizar(sb, tt)
    tt_ativo = tt is not None and tt.ativo
    rota_tomtom_ativa = tt_ativo and (config is None or bool(config['referencia_tomtom_ativa']))

    # Recência (razao_lag1/delta_min_lag1 — LIA 2.1).
    recencia_cache_obj = getattr(request.app.state, 'recencia_cache', None)
    if recencia_cache_obj is not None:
        recencia_cache_obj.refrescar_se_necessario(sb)
    # Contexto da LIA 2.2 (chuva/vizinhos/feriado); None com a LIA 2.1.
    contexto_obj = getattr(request.app.state, 'contexto', None)
    if contexto_obj is not None:
        await contexto_obj.atualizar_chuva()
    # Curva de confiança do Knowledge Transfer, calibrada com dados reais.
    transfer_confidence_obj = getattr(request.app.state, 'transfer_confidence', None)

    now = datetime.now(tz=BRASILIA_TZ)
    hora = now.hour
    dia_semana = now.weekday()
    origem = (body.origem.lat, body.origem.lon)
    destino = (body.destino.lat, body.destino.lon)

    orig_node, dist_orig = _snap(request, G, *origem)
    dest_node, dist_dest = _snap(request, G, *destino)
    fora_da_malha = max(dist_orig, dist_dest) > trajeto.LIMITE_SNAP_M
    logger.info(f"Snap: origem {orig_node} a {dist_orig:.0f} m, destino {dest_node} a {dist_dest:.0f} m")

    if not fora_da_malha and orig_node == dest_node:
        raise HTTPException(status_code=422, detail="Origem e destino são o mesmo ponto no grafo.")

    # TomTom sob demanda, em paralelo: recência ao vivo nas vias velhas do
    # corredor + interdições. A rota "de referência" (GET) só é pedida fora da
    # malha ou a pedido explícito; dentro da malha a fusão reconstrói a nossa rota.
    vias_atualizadas, incidentes_tt, referencia_tt = 0, [], None
    if tt_ativo:
        vias_atualizadas, incidentes_tt, referencia_tt = await _consultar_tomtom(
            tt, G, origem, destino, recencia_cache_obj,
            fora_da_malha or (body.referencia_tomtom and not rota_tomtom_ativa),
        )
    ref = referencia_tt or {}
    degradado = not tt_ativo or tt.pool.disponiveis('fluxo') == 0

    def resumo_tomtom(polyline, interdicoes, referencia) -> TomTomResumo:
        return TomTomResumo(
            ativo=tt_ativo,
            degradado=degradado,
            vias_atualizadas=vias_atualizadas,
            arestas_interditadas=len(bloqueadas),
            interdicoes_na_rota=interdicoes,
            incidentes=[IncidenteRota(**i) for i in tomtom.incidentes_na_rota(incidentes_tt, polyline)],
            referencia_tempo_seg=referencia.get('tempo_seg'),
            referencia_atraso_seg=referencia.get('atraso_seg'),
            referencia_sem_transito_seg=referencia.get('sem_transito_seg'),
            referencia_distancia_km=referencia.get('distancia_km'),
        )

    # --- Fora da malha: só a TomTom sabe traçar ---
    if fora_da_malha:
        bloqueadas = set()
        if not ref.get('polyline') or not ref.get('tempo_seg'):
            raise HTTPException(
                status_code=422,
                detail="Origem ou destino fora da área atendida pelo Routify (DF, raio de 38 km do Plano Piloto).",
            )
        resumo_tt = resumo_tomtom(ref['polyline'], 0, ref)
        request.state.degradado = degradado
        _registrar_rota(sb, user_id, body, version, hora, dia_semana, resumo_tt, inicio_req,
                        distancia_km=ref.get('distancia_km'), tempo_lia=None, tempo_curta=None,
                        rotas_diferentes=None, cobertura=0.0)
        return RouteOutput(
            polyline=ref['polyline'], tempo_total_seg=int(ref['tempo_seg']),
            distancia_km=ref.get('distancia_km') or 0.0, via_principal="Rota TomTom",
            modelo_utilizado=version, nos_visitados=0, lia_cobertura_pct=0.0,
            hora_partida=hora, dia_semana=dia_semana, tomtom=resumo_tt,
            fonte_rota='tomtom', fora_da_malha=True,
        )

    # Daqui até a chamada de fusão não há await: pesos (gravados no grafo
    # compartilhado), A*, baseline e resumos leem o grafo sem intercalar com
    # outra requisição. Depois do await, só valores já calculados.
    assign_lia_weights(
        model, encoder, profiles, G, hora, dia_semana,
        recencia_cache_obj, transfer_confidence_obj,
        contexto_obj.para_requisicao(now, recencia_cache_obj) if contexto_obj is not None else None,
    )
    atraso_sem = float(G.graph.get('atraso_semaforo_s', 0.0))

    # Heurística Haversine para A* (limite inferior: 30 m/s ≈ 108 km/h)
    def heuristic(u, v):
        return haversine_m(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']) / 30

    bloqueadas = tomtom.arestas_interditadas(G, incidentes_tt) if incidentes_tt else set()
    peso = (tomtom.peso_sem_interditadas(bloqueadas, PENALTY_NON_DRIVABLE_S, atraso_sem)
            if bloqueadas or atraso_sem else 'travel_time_lia')
    try:
        path_nodes = nx.astar_path(G, orig_node, dest_node, heuristic=heuristic, weight=peso)
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=422, detail="Sem rota disponível entre origem e destino.")
    except nx.NodeNotFound as e:
        raise HTTPException(status_code=422, detail=f"Nó não encontrado no grafo: {e}")

    polyline = montar_polyline(G, path_nodes)
    tempo_lia, distancia_total, cobertura_pct = _resumir_caminho(G, path_nodes)
    semaforos = trajeto.contar_semaforos(G, path_nodes)
    tempo_lia += atraso_sem * semaforos  # mesmo critério na baseline abaixo

    # --- Baseline da tese: rota de menor distância, sob as mesmas condições ---
    tempo_curta = dist_curta = None
    rotas_diferentes = None
    try:
        path_curta = nx.astar_path(
            G, orig_node, dest_node,
            heuristic=lambda u, v: haversine_m(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']),
            weight='length',
        )
        tempo_curta, dist_curta, _ = _resumir_caminho(G, path_curta)
        tempo_curta += atraso_sem * trajeto.contar_semaforos(G, path_curta)
        rotas_diferentes = path_curta != path_nodes
    except (nx.NetworkXNoPath, nx.NodeNotFound, KeyError) as e:
        logger.warning(f"Baseline de menor distância indisponível: {e}")

    via_principal = _via_principal(G, path_nodes)
    interdicoes = sum(
        1 for u, v in zip(path_nodes[:-1], path_nodes[1:])
        if any((u, v, k) in bloqueadas for k in G[u][v])
    )

    # --- Fusão: a TomTom reconstrói a rota da LIA e diz se há melhor ---
    fonte_rota, alternativa, tempo_exibido = 'lia', None, tempo_lia
    polyline_final, distancia_final, via_final = polyline, distancia_total, via_principal
    fusao = await tt.rota_reconstruida(polyline, trajeto.pontos_apoio(polyline)) if rota_tomtom_ativa else None
    nossa = (fusao or {}).get('nossa') or {}
    melhor = (fusao or {}).get('melhor')
    if nossa.get('tempo_seg'):
        fonte_rota, tempo_exibido, tempo_outra = trajeto.escolher(
            tempo_lia, cobertura_pct, float(nossa['tempo_seg']),
            float(melhor['tempo_seg']) if melhor and melhor.get('tempo_seg') and melhor.get('polyline') else None,
        )
        if fonte_rota == 'tomtom':
            alternativa = AlternativaRota(fonte='lia', polyline=polyline, tempo_seg=int(tempo_outra),
                                          distancia_km=round(distancia_total / 1000, 2))
            polyline_final, distancia_final = melhor['polyline'], melhor['distancia_km'] * 1000
            via_final = "Rota sugerida pela TomTom"
        elif tempo_outra is not None:
            alternativa = AlternativaRota(fonte='tomtom', polyline=melhor['polyline'], tempo_seg=int(tempo_outra),
                                          distancia_km=melhor['distancia_km'])
        ref = nossa  # ETA TomTom da própria rota da LIA (mesmo trajeto)

    logger.info(
        f"Rota ({fonte_rota}): {len(path_nodes)} nós, exibido {tempo_exibido:.0f}s (LIA {tempo_lia:.0f}s, "
        f"{semaforos} semáforos, TomTom {nossa.get('tempo_seg')}s), {distancia_final / 1000:.2f}km, "
        f"cobertura LIA {cobertura_pct:.0f}%"
        + (f" | menor distância: {tempo_curta:.0f}s" if tempo_curta is not None else " | sem baseline")
    )

    resumo_tt = resumo_tomtom(polyline_final, interdicoes, ref)
    request.state.degradado = degradado
    _registrar_rota(sb, user_id, body, version, hora, dia_semana, resumo_tt, inicio_req,
                    distancia_km=round(distancia_final / 1000, 2), tempo_lia=tempo_lia,
                    tempo_curta=tempo_curta, rotas_diferentes=rotas_diferentes, cobertura=cobertura_pct)

    return RouteOutput(
        polyline=polyline_final,
        tempo_total_seg=int(tempo_exibido),
        distancia_km=round(distancia_final / 1000, 2),
        via_principal=via_final,
        modelo_utilizado=version,
        nos_visitados=len(path_nodes),
        tempo_rota_curta_seg=int(tempo_curta) if tempo_curta is not None else None,
        distancia_rota_curta_km=round(dist_curta / 1000, 2) if dist_curta is not None else None,
        rotas_diferentes=rotas_diferentes,
        lia_cobertura_pct=round(cobertura_pct, 2),
        hora_partida=hora,
        dia_semana=dia_semana,
        tomtom=resumo_tt,
        fonte_rota=fonte_rota,
        tempo_lia_seg=int(tempo_lia),
        semaforos_na_rota=semaforos,
        alternativa=alternativa,
    )


def _registrar_rota(sb, user_id, body, version, hora, dia_semana, resumo_tt, inicio_req, *,
                    distancia_km, tempo_lia, tempo_curta, rotas_diferentes, cobertura) -> None:
    """Captura de uso (escrita pelo servidor; coordenadas arredondadas — LGPD)."""
    usage.registrar(sb, 'rotas_calculadas', {
        'user_id': user_id,
        'origem_lat': usage.arredondar(body.origem.lat),
        'origem_lon': usage.arredondar(body.origem.lon),
        'destino_lat': usage.arredondar(body.destino.lat),
        'destino_lon': usage.arredondar(body.destino.lon),
        'distancia_km': distancia_km,
        'tempo_lia_seg': int(tempo_lia) if tempo_lia is not None else None,
        'tempo_rota_curta_seg': int(tempo_curta) if tempo_curta is not None else None,
        'rotas_diferentes': rotas_diferentes,
        'lia_cobertura_pct': round(cobertura, 2),
        'modelo_versao': version,
        'hora_partida': hora,
        'dia_semana': dia_semana,
        'tomtom_ativo': resumo_tt.ativo,
        'tomtom_degradado': resumo_tt.degradado,
        'vias_atualizadas': resumo_tt.vias_atualizadas,
        'incidentes_na_rota': len(resumo_tt.incidentes),
        'interdicoes_na_rota': resumo_tt.interdicoes_na_rota,
        'referencia_tomtom_seg': resumo_tt.referencia_tempo_seg,
        'referencia_atraso_seg': resumo_tt.referencia_atraso_seg,
        'latencia_ms': int((time.perf_counter() - inicio_req) * 1000),
    })
