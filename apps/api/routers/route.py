"""
POST /route — Rota A* com pesos LIA
Recebe origem/destino (lat/lon), retorna polyline otimizada pelo modelo LIA.
"""
import asyncio
import math
import logging
import time
from datetime import datetime
from typing import Dict, List, Tuple, Optional

import networkx as nx
import osmnx as ox
import numpy as np
from fastapi import APIRouter, Request, HTTPException, Security
from pydantic import BaseModel, ConfigDict, Field

import combustivel
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
    """Ponto no DF e entorno (a mesma caixa da busca). Fora dela, 422 antes de qualquer chamada à TomTom
    (auditoria de 2026-11-03, M2: o planeta inteiro era aceito e virava rota de referência paga com a cota)."""
    model_config = ConfigDict(extra='forbid')
    lat: float = Field(..., description="Latitude (WGS84), dentro do DF e entorno", ge=-16.6, le=-15.0, examples=[-15.7939])
    lon: float = Field(..., description="Longitude (WGS84), dentro do DF e entorno", ge=-48.8, le=-46.8, examples=[-47.8828])


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
    sensores_virtuais: int = Field(0, description="Pontos sem sensor do corredor lidos na TomTom (sensores virtuais); "
                                   "o fluxo deles vira o peso do trecho medido, onde a LIA não tinha dado.")
    arestas_interditadas: int = Field(0, description="Arestas do grafo bloqueadas por interdição no corredor.")
    interdicoes_na_rota: int = Field(0, description="Interdições que ainda tocam a rota escolhida.")
    incidentes: List[IncidenteRota] = Field([], description="Incidentes próximos à rota.")
    referencia_tempo_seg: Optional[int] = Field(None, description="ETA da TomTom com trânsito para o trajeto da LIA (reconstruído na fusão); fora da malha, para a rota da própria TomTom.")
    referencia_atraso_seg: Optional[int] = Field(None, description="Atraso por trânsito segundo a TomTom.")
    referencia_sem_transito_seg: Optional[int] = Field(None, description="ETA da TomTom sem trânsito.")
    referencia_historico_seg: Optional[int] = Field(None, description="ETA da TomTom pelo histórico dela, sem a leitura ao vivo: o equivalente da LIA na TomTom.")
    referencia_distancia_km: Optional[float] = Field(None, description="Distância da rota da TomTom.")


class AlternativaRota(BaseModel):
    fonte: str = Field(..., description='"lia" ou "tomtom".')
    polyline: List[List[float]]
    tempo_seg: int = Field(..., description="Tempo estimado (misto LIA × TomTom) da alternativa.")
    distancia_km: float


class Clima(BaseModel):
    temperatura_c: Optional[float] = None
    condicao: str = Field(..., examples=["Parcialmente nublado"])
    codigo_wmo: Optional[int] = Field(None, description="Código WMO do Open-Meteo (ícone no app).")
    de_dia: bool = True
    vento_kmh: Optional[float] = None
    chuva_agora_mm: float = 0.0
    chuva_3h_mm: float = Field(0.0, description="Chuva das 3 últimas horas — feature da LIA 2.2.")
    feriado: bool = Field(False, description="Feriado hoje — feature da LIA 2.2.")


class Economia(BaseModel):
    litros_rota: float = Field(..., description="Combustível estimado da rota exibida (L).")
    litros: float = Field(..., description="Economia contra o caminho mais curto (L); negativo = gasta mais para chegar antes.")
    reais: float
    co2_kg: float
    minutos: float = Field(..., description="Minutos ganhos contra o caminho mais curto.")
    preco_litro_reais: float


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
    fora_da_malha: bool = Field(False, description="Origem/destino além da malha coberta (caixa de ±38 km em volta do Plano Piloto); rota só da TomTom.")
    semaforos_na_rota: Optional[int] = Field(
        None, description="Cruzamentos com semáforo (OSM traffic_signals) na rota da LIA; entram no tempo com o atraso médio calibrado.")
    cruzamentos_na_rota: Optional[int] = Field(
        None, description="Cruzamentos sem semáforo na rota da LIA (nó com 3+ vizinhos, fora de via expressa); entram no tempo com o atraso médio calibrado.")
    cruzamentos_via_na_rota: Optional[int] = Field(
        None, description="Cruzamentos sem semáforo chegando por via arterial (primária, secundária); atraso próprio.")
    tempo_livre_por_grupo_s: Optional[Dict[str, float]] = Field(
        None, description="Tempo livre da rota da LIA por grupo de via (expressa, arterial, coletora, local), sem atrasos. "
                          "Diagnóstico para calibrar a velocidade livre do grafo contra a TomTom.")
    tempo_livre_lia_seg: Optional[int] = Field(
        None, description="Tempo da rota da LIA em velocidade livre, sem a razão prevista, mais os atrasos de cruzamento. Diagnóstico: separa o erro de escala do erro de congestionamento.")
    alternativa: Optional[AlternativaRota] = Field(None, description="A candidata não escolhida, para desenho tracejado.")
    trafego: Optional[List[Optional[int]]] = Field(
        None, description="Trânsito por trecho da polyline (ponto i → i+1): 0 livre, 1 moderado, 2 lento, 3 parado, "
                          "null = sem dado. LIA onde há sensor; nos buracos, as seções de trânsito da TomTom (mesma "
                          "chamada da fusão). Rota da TomTom: as seções dela.")
    clima: Optional[Clima] = Field(None, description="Tempo em Brasília na partida (Open-Meteo) e o contexto que a LIA 2.2 usou.")
    economia: Optional[Economia] = Field(
        None, description="Combustível (Evans–Herman–Lam, ml/artifacts/consumo_combustivel.json) contra o caminho mais curto.")


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
    fixo = _pesos_fixos(G, encoder)
    if not fixo['dicts']:
        return {'model': 0, 'transfer': 0, 'heuristic': 0, 'blocked': 0}
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
    # PRIOR_CONGESTIONAMENTO=corredor (main.py): a mediana acima é 1,0 (fluxo livre) em 3 de cada 4
    # combinações hora × dia, porque a razão concentra massa em 1. Para somar tempo, o que vale é a
    # média: o prior passa a ser a lentidão que o modelo prevê AGORA nos trechos monitorados (média
    # harmônica ponderada pelo tempo livre). Vale para as arestas sem sensor e é o alvo para onde a
    # transferência encolhe com a distância (antes: 1,0, mais livre que o sensor e que a cidade).
    prior_vivo = G.graph.get('prior_congestionamento') == 'corredor'

    # --- Template por via, não por aresta ---
    # Fixados hora e dia_semana, a única feature que varia entre arestas da mesma via é
    # velocidade_livre. Uma linha-modelo por via; o modelo só vê as combinações (via, velocidade)
    # distintas (poucas mil) em vez de uma linha por aresta (dezenas de mil): a mesma linha dá a
    # mesma previsão, então o resultado é idêntico ao de antes e o /route fica ~5× mais rápido.
    vinc = fixo['vinculada']
    prior = razao_global
    razoes = np.empty(0)
    if vinc.any():
        # A cascata de perfis só muda com (hora, dia): 630 lookups custavam ~77 ms por rota. Guarda a referência dos
        # perfis junto, para outro modelo carregado não reaproveitar a lista (rollback de LIA_VERSION, testes).
        perfis_hora = fixo.setdefault('perfis_hora', {})
        guardado = perfis_hora.get((hora, dia_semana))
        if guardado is None or guardado[0] is not profiles:
            if len(perfis_hora) >= 32:  # /route/horarios pede várias horas; o resto vira a cada hora
                perfis_hora.clear()
            guardado = perfis_hora[(hora, dia_semana)] = (
                profiles, [lia_inf.lookup_perfis(profiles, via, hora, dia_semana) for via in fixo['vias']])
        templates = np.vstack([
            np.asarray(lia_inf.montar_features(
                int(enc), hora, dia_semana, 0.0, perfis,
                recencia_cache.get(via) if recencia_cache is not None else None,
                contexto(via) if contexto else None, ordem), dtype=float)
            for via, enc, perfis in zip(fixo['vias'], fixo['vias_cod'], guardado[1])
        ])
        via_idx, vel_v = fixo['via_idx'][vinc], fixo['vel'][vinc]
        chaves, volta = np.unique(np.column_stack([via_idx, vel_v]), axis=0, return_inverse=True)
        linhas = templates[chaves[:, 0].astype(int)]
        linhas[:, IDX_VEL_LIVRE] = chaves[:, 1]
        razoes = np.clip(model.predict(linhas), lia_inf.RAZAO_MIN, lia_inf.RAZAO_MAX)[volta.ravel()]

        eh_modelo = fixo['fonte'][vinc] == 'model'
        if prior_vivo and eh_modelo.any():
            t_livre = (fixo['comp'][vinc] / np.maximum(vel_v, 1.0))[eh_modelo]  # ∝ tempo livre
            prior = float(lia_inf.clamp_razao(t_livre.sum() / (t_livre / razoes[eh_modelo]).sum()))

        # Confiança da transferência, vetorizada: quanto mais longe a via de
        # referência, mais a razão volta para fluxo livre (1.0).
        conf = np.where(fixo['fonte'][vinc] == 'transfer',
                        _confianca_transfer(fixo['dist'][vinc], transfer_confidence), 1.0)
        razoes = razoes * conf + (prior if prior_vivo else 1.0) * (1.0 - conf)

    # Razão de cada aresta (vinculadas: modelo; sem sensor: prior) e tempo pela mesma fórmula de
    # lia_inf.tempo_de_razao, para as duas famílias ficarem comparáveis e o A* não se enviesar.
    razao_aresta = np.full(len(fixo['dicts']), prior if prior_vivo else razao_global)
    razao_aresta[vinc] = razoes
    vel_ef = np.maximum(fixo['vel'] * np.clip(razao_aresta, lia_inf.RAZAO_MIN, lia_inf.RAZAO_MAX), 1.0)
    tempos = np.maximum(1.0, fixo['comp'] / (vel_ef / 3.6))
    tempos[fixo['bloqueada']] = PENALTY_NON_DRIVABLE_S

    # Grava no grafo (reseta também o que a requisição anterior marcou, ex.: sensores virtuais).
    for d, t, r, fonte in zip(fixo['dicts'], tempos.tolist(), razao_aresta.tolist(), fixo['fonte']):
        d['travel_time_lia'] = t
        d['lia_source'] = fonte
        if fonte != 'blocked':
            d['lia_razao'] = round(r, 4)

    resultado = fixo['contagem']
    logger.info(
        f"Pesos atribuídos (prior {'corredor' if prior_vivo else 'perfil'} {prior:.3f}): "
        f"{resultado['model']:,} do modelo, "
        f"{resultado['transfer']:,} de transfer, "
        f"{resultado['heuristic']:,} heurística, "
        f"{resultado['blocked']:,} bloqueadas"
    )
    return dict(resultado)


def _pesos_fixos(G: nx.MultiDiGraph, encoder) -> dict:
    """O que não muda entre requisições, por aresta: fonte (modelo, transferência, heurística, bloqueada),
    via, comprimento, velocidade livre e distância até a via. Calculado na 1ª rota e guardado no grafo
    (só depende do enriquecimento da subida e do encoder do modelo carregado)."""
    # Sem G.number_of_edges(): num MultiDiGraph ele percorre o grafo todo (~130 ms por rota). As arestas não mudam
    # depois da subida, e um grafo novo (testes) traz o próprio G.graph, sem este cache.
    chave = (id(encoder), id(G.graph.get('vel_livre_tomtom')))
    fixo = G.graph.get('_pesos_fixos')
    if fixo is not None and fixo['chave'] == chave:
        return fixo
    conhecidas = set(encoder.classes_.tolist())
    vel_tomtom = G.graph.get('vel_livre_tomtom')  # None = comportamento da tese (OSM)
    dicts, fontes, vias, comp, vel, dist = [], [], [], [], [], []
    for _, _, _, d in G.edges(keys=True, data=True):
        dicts.append(d)
        vel_livre = float(d.get('speed_kph') or 50.0)
        if vel_livre <= 0:
            vel_livre = 50.0
        comp.append(float(d.get('length') or 100.0))
        via = d.get('id_ponto_lia')
        if valor_highway(d) in NON_DRIVABLE_HIGHWAYS:
            fonte, via = 'blocked', None
        elif via is not None and via in conhecidas:
            fonte = 'model' if float(d.get('dist_lia_m') or 0.0) < DIST_VIA_PROPRIA_M else 'transfer'
            if fonte == 'model' and vel_tomtom and via in vel_tomtom:
                # Trecho monitorado: mesma velocidade livre do treino (TomTom), não
                # o limite de via do OSM (VEL_LIVRE_CALIBRADA, padrão; ver ml/free_flow_speeds.py).
                vel_livre = vel_tomtom[via]
        else:
            fonte, via = 'heuristic', None
        fontes.append(fonte)
        vias.append(via)
        vel.append(vel_livre)
        dist.append(float(d.get('dist_lia_m') or 0.0))
    usadas = sorted({v for v in vias if v is not None})
    pos = {v: i for i, v in enumerate(usadas)}
    fonte_arr = np.array(fontes, dtype=object)
    fixo = {
        'chave': chave, 'dicts': dicts, 'fonte': fonte_arr, 'vias': usadas,
        'vias_cod': encoder.transform(usadas) if usadas else [],
        'via_idx': np.array([pos.get(v, -1) for v in vias], dtype=float),
        'vinculada': np.isin(fonte_arr, ['model', 'transfer']),
        'bloqueada': fonte_arr == 'blocked',
        'comp': np.array(comp), 'vel': np.array(vel), 'dist': np.array(dist),
        'contagem': {f: int((fonte_arr == f).sum()) for f in ('model', 'transfer', 'heuristic', 'blocked')},
    }
    G.graph['_pesos_fixos'] = fixo
    return fixo


def _trechos(G: nx.MultiDiGraph, nos: List[int]):
    """(pontos [lat, lon] no sentido da travessia, aresta usada) de cada aresta do caminho.

    Ligar apenas os nós em linha reta ignora a curvatura: 46% das arestas têm geometria própria,
    com desvio de 28 m no p90 e até 2 km no extremo. No mapa isso aparece como a rota cortando
    quarteirões e atravessando edificações — o traçado estava errado, não o caminho escolhido.
    """
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
            trecho = [[G.nodes[u]['y'], G.nodes[u]['x']], [G.nodes[v]['y'], G.nodes[v]['x']]]
        # A geometria do OSM pode vir no sentido oposto ao da travessia.
        elif _dist_quadrada(trecho[0], G.nodes[u]) > _dist_quadrada(trecho[-1], G.nodes[u]):
            trecho.reverse()
        yield trecho, d


def montar_polyline(G: nx.MultiDiGraph, nos: List[int]) -> List[List[float]]:
    """Traça a rota seguindo a geometria real das vias (ver _trechos)."""
    pontos: List[List[float]] = []
    for trecho, _ in _trechos(G, nos):
        # Evita duplicar o nó compartilhado entre arestas consecutivas.
        pontos.extend(trecho[1:] if pontos else trecho)
    if not pontos and nos:
        pontos = [[G.nodes[n]['y'], G.nodes[n]['x']] for n in nos]
    return pontos


nivel_da_razao = lia_inf.nivel_da_razao  # régua única: rota, mapa e /trafego/agora


def niveis_lia(G: nx.MultiDiGraph, nos: List[int]) -> List[Optional[int]]:
    """Nível de trânsito por trecho da polyline (ponto i -> i+1), alinhado com montar_polyline.
    Só onde a LIA tem dado (sensor ou transferência); aresta heurística = None (sem dado).
    Ler antes de qualquer await: os pesos ficam no grafo compartilhado entre requisições."""
    niveis: List[Optional[int]] = []
    for trecho, d in _trechos(G, nos):
        razao = d.get('lia_razao')
        nivel = (nivel_da_razao(float(razao))
                 if razao is not None and d.get('lia_source') in ('model', 'transfer', 'virtual') else None)
        niveis.extend([nivel] * (len(trecho) - 1))
    return niveis


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


# Sensores virtuais: até 3 pontos sem sensor por rota, cada leitura vale 15 min (cota do Flow).
K_VIRTUAIS = 3
# Snap com vários candidatos (SNAP_CANDIDATOS): cada nó entra no A* com o custo da ligação a pé até ele
# (regra da pesquisa de 2026-11-02, ml/restricoes_conversao.py › snap_alternativo).
VEL_LIGACAO_MS = 1.4
_cache_virtuais = tomtom.CacheTTL(15 * 60, max_itens=2048)


async def _ler_virtual(tt, ponto_id: int, lat: float, lon: float):
    em_cache = _cache_virtuais.get(ponto_id)
    if em_cache is not None:
        return em_cache
    fsd = await tt.fluxo(lat, lon)
    leitura = (tomtom.razao_de_fluxo(fsd), tomtom.trecho_de_fluxo(fsd))
    if leitura[0] is not None:
        _cache_virtuais.set(ponto_id, leitura)
    return leitura


async def _consultar_tomtom(tt, G, origem, destino, recencia, com_referencia: bool):
    """Uma rodada paralela: fluxo nas vias velhas do corredor + nos pontos sem sensor (sensores
    virtuais) + incidentes (+ ETA de referência). Nunca levanta — falha vira modo degradado."""
    vias = G.graph.get('vias_monitoradas') or {}
    idade = recencia.idade_min if recencia is not None else (lambda _via: None)
    alvo = tomtom.selecionar_vias_corredor(vias, origem, destino, idade)
    virtuais = G.graph.get('pontos_virtuais') or {}
    alvo_v = tomtom.selecionar_vias_corredor(virtuais, origem, destino, lambda _p: None, k=K_VIRTUAIS, buffer_m=1200.0)

    tarefas = [tt.fluxo(*vias[v]) for v in alvo]
    tarefas.append(tt.incidentes(tomtom.bbox_corredor(origem, destino)))
    if com_referencia:
        tarefas.append(tt.rota_referencia(origem, destino))
    tarefas += [_ler_virtual(tt, p, *virtuais[p]) for p in alvo_v]
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
    leituras = [r for r in resultados[len(alvo) + 1 + int(com_referencia):] if r and r[0] is not None]
    return atualizadas, incidentes, referencia, leituras


_limite_ip = Limitador(20)  # cada rota gasta Flow/Incidents/Routing da TomTom
# Teto de todas as chamadas externas somadas: a rota gasta ~1 s de CPU no único worker; poucos IPs no limite
# individual já travariam a API (auditoria de 2026-11-03, M1). Comparador e A/B (internos) ficam fora.
_limite_global = Limitador(40)


def _via_principal(G: nx.MultiDiGraph, nos: List[int]) -> str:
    """Nome com mais metros na rota (não só nos primeiros trechos)."""
    metros: dict = {}
    for u, v in zip(nos[:-1], nos[1:]):
        if u == v or v not in G[u]:  # nós do snap de uma polyline: só pares ligados contam
            continue
        dados = min(G[u][v].values(), key=lambda d: d.get('length', 0))
        nome = dados.get('name')
        nome = nome[0] if isinstance(nome, list) and nome else nome
        if isinstance(nome, str) and nome:
            metros[nome] = metros.get(nome, 0.0) + float(dados.get('length', 0) or 0)
    return max(metros, key=metros.get) if metros else "Via sem nome"


def _via_da_polyline(request: Request, G: nx.MultiDiGraph, polyline: List[List[float]]) -> Optional[str]:
    """Nome real da via principal de uma rota que não saiu do A* (trânsito ao vivo):
    cada ponto vai ao nó mais próximo e os trechos ligados somam metros por nome."""
    arvore = getattr(request.app.state, 'arvore_nos', None)
    if arvore is None or len(polyline) < 2:
        return None
    nos = [n for n, d in zip(*arvore.snap_varios(polyline)) if d <= trajeto.LIMITE_SNAP_M]
    nome = _via_principal(G, nos)
    return None if nome == "Via sem nome" else nome


def _vmax_ms(G) -> float:
    """Maior velocidade livre do grafo (m/s), calculada uma vez. A heurística do A*
    divide por ela para ser limite inferior do custo: com 30 m/s fixos, as arestas
    de 110 km/h a violavam e o A* podia devolver caminho até ~2% pior. Entra também a velocidade
    livre da TomTom dos trechos monitorados, que o tempo da LIA usa no lugar da do grafo."""
    if 'vmax_ms' not in G.graph:
        vels = [float(d.get('speed_kph') or 0.0) for _, _, d in G.edges(data=True)]
        vels += [float(v) for v in (G.graph.get('vel_livre_tomtom') or {}).values()]
        G.graph['vmax_ms'] = max(vels, default=108.0) / 3.6
    return G.graph['vmax_ms']


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
        "±38 km, a rota é só da TomTom. A rota de menor distância segue calculada para a tese. "
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
    if not usage.requisicao_interna(request):
        limitar(_limite_global, 'todas', 'Muitas rotas sendo calculadas agora. Tente de novo em instantes.')
    inicio_req = time.perf_counter()
    # Tempo por fase (ms) no log: a auditoria de latência de 2026-11-02 começou sem isso.
    etapas: Dict[str, float] = {}
    ultima = [inicio_req]

    def marca(nome: str) -> None:
        agora = time.perf_counter()
        etapas[nome] = (agora - ultima[0]) * 1000
        ultima[0] = agora

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
    clima = contexto_obj.clima(now) if contexto_obj is not None else None
    hora = now.hour
    dia_semana = now.weekday()
    origem = (body.origem.lat, body.origem.lon)
    destino = (body.destino.lat, body.destino.lon)

    marca('prep')
    orig_node, dist_orig = _snap(request, G, *origem)
    dest_node, dist_dest = _snap(request, G, *destino)
    marca('snap')
    fora_da_malha = max(dist_orig, dist_dest) > trajeto.LIMITE_SNAP_M
    logger.info(f"Snap: origem {orig_node} a {dist_orig:.0f} m, destino {dest_node} a {dist_dest:.0f} m")

    if not fora_da_malha and orig_node == dest_node:
        raise HTTPException(status_code=422, detail="Origem e destino são o mesmo ponto no grafo.")

    # TomTom sob demanda, em paralelo: recência ao vivo nas vias velhas do
    # corredor + interdições. A rota "de referência" (GET) só é pedida fora da
    # malha ou a pedido explícito; dentro da malha a fusão reconstrói a nossa rota.
    vias_atualizadas, incidentes_tt, referencia_tt, leituras_virtuais = 0, [], None, []
    if tt_ativo:
        vias_atualizadas, incidentes_tt, referencia_tt, leituras_virtuais = await _consultar_tomtom(
            tt, G, origem, destino, recencia_cache_obj,
            fora_da_malha or (body.referencia_tomtom and not rota_tomtom_ativa),
        )
    ref = referencia_tt or {}
    degradado = not tt_ativo or tt.pool.disponiveis('fluxo') == 0
    marca('tomtom')

    def resumo_tomtom(polyline, interdicoes, referencia) -> TomTomResumo:
        return TomTomResumo(
            ativo=tt_ativo,
            degradado=degradado,
            vias_atualizadas=vias_atualizadas,
            sensores_virtuais=len(leituras_virtuais),
            arestas_interditadas=len(bloqueadas),
            interdicoes_na_rota=interdicoes,
            incidentes=[IncidenteRota(**i) for i in tomtom.incidentes_na_rota(incidentes_tt, polyline)],
            referencia_tempo_seg=referencia.get('tempo_seg'),
            referencia_atraso_seg=referencia.get('atraso_seg'),
            referencia_sem_transito_seg=referencia.get('sem_transito_seg'),
            referencia_historico_seg=referencia.get('historico_seg'),
            referencia_distancia_km=referencia.get('distancia_km'),
        )

    # --- Fora da malha: só a TomTom sabe traçar ---
    if fora_da_malha:
        bloqueadas = set()
        if not ref.get('polyline') or not ref.get('tempo_seg'):
            raise HTTPException(
                status_code=422,
                detail="Origem ou destino fora da área atendida pelo Routify (caixa de ±38 km em volta do Plano Piloto).",
            )
        resumo_tt = resumo_tomtom(ref['polyline'], 0, ref)
        request.state.degradado = degradado
        _registrar_rota(sb, user_id, body, version, hora, dia_semana, resumo_tt, inicio_req,
                        distancia_km=ref.get('distancia_km'), tempo_lia=None, tempo_curta=None,
                        rotas_diferentes=None, cobertura=0.0)
        return RouteOutput(
            polyline=ref['polyline'], tempo_total_seg=int(ref['tempo_seg']),
            distancia_km=ref.get('distancia_km') or 0.0,
            via_principal=_via_da_polyline(request, G, ref['polyline']) or "Fora da área mapeada",
            modelo_utilizado=version, nos_visitados=0, lia_cobertura_pct=0.0,
            hora_partida=hora, dia_semana=dia_semana, tomtom=resumo_tt,
            fonte_rota='tomtom', fora_da_malha=True, clima=clima, trafego=ref.get('trafego'),
        )

    # Daqui até a chamada de fusão não há await: pesos (gravados no grafo
    # compartilhado), A*, baseline e resumos leem o grafo sem intercalar com
    # outra requisição. Depois do await, só valores já calculados.
    assign_lia_weights(
        model, encoder, profiles, G, hora, dia_semana,
        recencia_cache_obj, transfer_confidence_obj,
        contexto_obj.para_requisicao(now, recencia_cache_obj) if contexto_obj is not None else None,
    )
    # Sensores virtuais: o fluxo lido nos buracos vira o peso do trecho medido (antes do A*).
    arvore_snap = getattr(request.app.state, 'arvore_nos', None)
    if leituras_virtuais and arvore_snap is not None:
        mudadas = trajeto.aplicar_leituras_virtuais(G, arvore_snap, leituras_virtuais)
        logger.info(f"Sensores virtuais: {len(leituras_virtuais)} leituras, {mudadas} arestas")
    atraso_sem = float(G.graph.get('atraso_semaforo_s', 0.0))
    atraso_cruz = float(G.graph.get('atraso_cruzamento_s', 0.0))
    atraso_cruz_via = float(G.graph.get('atraso_cruzamento_via_s', 0.0))
    marca('pesos')

    # Heurística Haversine para A*: distância / maior velocidade do grafo = limite inferior
    vmax = _vmax_ms(G)

    def heuristic(u, v):
        return haversine_m(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']) / vmax

    bloqueadas = tomtom.arestas_interditadas(G, incidentes_tt) if incidentes_tt else set()
    peso = (tomtom.peso_sem_interditadas(bloqueadas, PENALTY_NON_DRIVABLE_S, atraso_sem, atraso_cruz, atraso_cruz_via)
            if bloqueadas or atraso_sem or atraso_cruz or atraso_cruz_via else 'travel_time_lia')
    proibidas = G.graph.get('conversoes_proibidas')
    k_snap = G.graph.get('snap_candidatos', 1)
    if k_snap > 1 and arvore_snap is not None:
        # Snap com vários candidatos: o nó mais perto pode ser o da pista errada de uma via dupla (chega-se a
        # ele com um retorno). Um A* só, de todos os candidatos de origem para todos os de destino.
        entrada = {n: d / VEL_LIGACAO_MS for n, d in arvore_snap.candidatos(*origem, k_snap)}
        saida = {n: d / VEL_LIGACAO_MS for n, d in arvore_snap.candidatos(*destino, k_snap)}
        cy = sum(G.nodes[n]['y'] for n in saida) / len(saida)
        cx = sum(G.nodes[n]['x'] for n in saida) / len(saida)
        raio = max(haversine_m(cy, cx, G.nodes[n]['y'], G.nodes[n]['x']) for n in saida)

        def h_multi(n):  # admissível para o conjunto: distância ao centro menos o raio dos candidatos
            return max(0.0, haversine_m(G.nodes[n]['y'], G.nodes[n]['x'], cy, cx) - raio) / vmax

        path_nodes = (trajeto.astar_multi(G, entrada, saida, h_multi, peso, proibidas)
                      or (trajeto.astar_multi(G, entrada, saida, h_multi, peso) if proibidas else None))
        if not path_nodes or len(path_nodes) < 2:
            raise HTTPException(status_code=422, detail="Sem rota disponível entre origem e destino.")
        orig_node, dest_node = path_nodes[0], path_nodes[-1]
    else:
        try:
            path_nodes = nx.astar_path(G, orig_node, dest_node, heuristic=heuristic, weight=peso)
        except nx.NetworkXNoPath:
            raise HTTPException(status_code=422, detail="Sem rota disponível entre origem e destino.")
        except nx.NodeNotFound as e:
            raise HTTPException(status_code=422, detail=f"Nó não encontrado no grafo: {e}")
    # Conversões proibidas do OSM (RESTRICOES_CONVERSAO=1): o A* restrito só roda quando o caminho
    # livre fez uma (~22% das rotas na medição de ml/restricoes_conversao.py).
    if proibidas and k_snap <= 1 and trajeto.viola_conversao(path_nodes, proibidas):
        legal = trajeto.astar_com_restricoes(G, orig_node, dest_node, heuristic, peso, proibidas)
        if legal:
            path_nodes = legal
        else:
            logger.warning("Nenhum caminho respeita as conversões proibidas: segue o caminho livre")

    marca('astar')
    polyline = montar_polyline(G, path_nodes)
    niveis = niveis_lia(G, path_nodes)  # antes do await da fusão (pesos no grafo compartilhado)
    tempo_lia, distancia_total, cobertura_pct = _resumir_caminho(G, path_nodes)
    semaforos = trajeto.contar_semaforos(G, path_nodes)
    cruzamentos = trajeto.contar_cruzamentos(G, path_nodes)
    cruzamentos_via = trajeto.contar_cruzamentos(G, path_nodes, 'cruzamento_via')
    atrasos = atraso_sem * semaforos + atraso_cruz * cruzamentos + atraso_cruz_via * cruzamentos_via
    tempo_livre = trajeto.tempo_livre_s(G, path_nodes) + atrasos
    # Também antes do await: entre arestas paralelas escolhe pelo travel_time_lia do grafo compartilhado, que outra
    # requisição reescreve durante a fusão (auditoria de 2026-11-03, B7; o campo alimenta calibrate_signals.py).
    livre_por_grupo = trajeto.tempo_livre_por_grupo(G, path_nodes)
    tempo_lia += atrasos  # mesmo critério na baseline abaixo

    # --- Baseline da tese: rota de menor distância, sob as mesmas condições ---
    tempo_curta = dist_curta = None
    rotas_diferentes = None
    try:
        h_dist = lambda u, v: haversine_m(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x'])
        path_curta = nx.astar_path(G, orig_node, dest_node, heuristic=h_dist, weight='length')
        if proibidas and trajeto.viola_conversao(path_curta, proibidas):  # baseline sob a mesma regra
            path_curta = trajeto.astar_com_restricoes(G, orig_node, dest_node, h_dist, 'length', proibidas) or path_curta
        tempo_curta, dist_curta, _ = _resumir_caminho(G, path_curta)
        tempo_curta += (atraso_sem * trajeto.contar_semaforos(G, path_curta)
                        + atraso_cruz * trajeto.contar_cruzamentos(G, path_curta)
                        + atraso_cruz_via * trajeto.contar_cruzamentos(G, path_curta, 'cruzamento_via'))
        rotas_diferentes = path_curta != path_nodes
    except (nx.NetworkXNoPath, nx.NodeNotFound, KeyError) as e:
        logger.warning(f"Baseline de menor distância indisponível: {e}")

    via_principal = _via_principal(G, path_nodes)
    interdicoes = sum(
        1 for u, v in zip(path_nodes[:-1], path_nodes[1:])
        if any((u, v, k) in bloqueadas for k in G[u][v])
    )

    marca('baseline')  # inclui os resumos do caminho
    # --- Fusão: a TomTom reconstrói a rota da LIA e diz se há melhor ---
    fonte_rota, alternativa, tempo_exibido, tempo_outra = 'lia', None, tempo_lia, None
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
            via_final = _via_da_polyline(request, G, melhor['polyline']) or via_principal
        elif tempo_outra is not None:
            alternativa = AlternativaRota(fonte='tomtom', polyline=melhor['polyline'], tempo_seg=int(tempo_outra),
                                          distancia_km=melhor['distancia_km'])
        ref = nossa  # ETA TomTom da própria rota da LIA (mesmo trajeto)
    # Buracos da LIA (sem sensor perto) pegam o trânsito que a TomTom vê no mesmo lugar.
    niveis = trajeto.preencher_com_tomtom(polyline, niveis, nossa.get('polyline'), nossa.get('trafego'))
    trafego_final = (melhor or {}).get('trafego') if fonte_rota == 'tomtom' else niveis
    marca('fusao')

    logger.info(
        f"Rota ({fonte_rota}): {len(path_nodes)} nós, exibido {tempo_exibido:.0f}s (LIA {tempo_lia:.0f}s, "
        f"{semaforos} semáforos, TomTom {nossa.get('tempo_seg')}s), {distancia_final / 1000:.2f}km, "
        f"cobertura LIA {cobertura_pct:.0f}%"
        + (f" | menor distância: {tempo_curta:.0f}s" if tempo_curta is not None else " | sem baseline")
        + " | ms " + ' '.join(f'{k}={v:.0f}' for k, v in etapas.items())
    )

    resumo_tt = resumo_tomtom(polyline_final, interdicoes, ref)
    request.state.degradado = degradado
    # Os dois lados na escala do tempo exibido (ver combustivel.base_na_escala).
    misto_nossa = tempo_exibido if fonte_rota == 'lia' or tempo_outra is None else tempo_outra
    economia = combustivel.economia(
        getattr(request.app.state, 'combustivel', None), distancia_final / 1000, tempo_exibido,
        dist_curta / 1000 if dist_curta is not None else None,
        combustivel.base_na_escala(tempo_curta, tempo_lia, misto_nossa))
    _registrar_rota(sb, user_id, body, version, hora, dia_semana, resumo_tt, inicio_req,
                    distancia_km=round(distancia_final / 1000, 2), tempo_lia=tempo_lia,
                    tempo_curta=tempo_curta, rotas_diferentes=rotas_diferentes, cobertura=cobertura_pct,
                    dist_curta=dist_curta, economia=economia)

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
        cruzamentos_na_rota=cruzamentos,
        cruzamentos_via_na_rota=cruzamentos_via,
        tempo_livre_por_grupo_s=livre_por_grupo,
        tempo_livre_lia_seg=int(tempo_livre),
        alternativa=alternativa,
        clima=clima,
        economia=economia,
        trafego=trafego_final,
    )


def _registrar_rota(sb, user_id, body, version, hora, dia_semana, resumo_tt, inicio_req, *,
                    distancia_km, tempo_lia, tempo_curta, rotas_diferentes, cobertura,
                    dist_curta=None, economia=None) -> None:
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
        'distancia_rota_curta_km': round(dist_curta / 1000, 2) if dist_curta is not None else None,
        'combustivel_rota_l': economia['litros_rota'] if economia else None,
        'combustivel_economizado_l': economia['litros'] if economia else None,
        'minutos_economizados': economia['minutos'] if economia else None,
    })
