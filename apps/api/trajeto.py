"""Snap no grafo, semáforos e fusão LIA × TomTom.

A LIA só enxerga bem onde há histórico (vias monitoradas e vizinhas por
transferência); no resto o peso é heurística de velocidade livre — um "buraco"
temporal/espacial. A TomTom vê trânsito ao vivo em toda a malha.

Fusão (1 chamada de Routing por rota): a TomTom reconstrói a rota da LIA
(supportingPoints) e devolve o ETA dela sob trânsito ao vivo, mais uma
alternativa só se achar rota melhor. O tempo exibido mistura as duas visões
pela cobertura da LIA; a rota da TomTom só vence com ganho claro.
"""
import json
import logging
import os
from typing import List, Optional, Sequence, Tuple

import networkx as nx
import numpy as np
from sklearn.neighbors import BallTree

logger = logging.getLogger(__name__)

RAIO_TERRA_M = 6_371_000.0
LIMITE_SNAP_M = 600.0  # além disso = fora da malha (rota da TomTom). 400 m tirava o Aeroporto (496 m), corredor da Fase 3
MAX_PONTOS_APOIO = 100  # supportingPoints por chamada (a geometria vem inteira de volta)
MARGEM_REL = 0.10  # a rota da TomTom precisa ser >= 10% mais rápida…
MARGEM_ABS_S = 60.0  # …e ganhar pelo menos 1 min, para trocar a da LIA


class ArvoreNos:
    """BallTree (haversine) dos nós do grafo, montada uma vez na subida."""

    def __init__(self, G: nx.MultiDiGraph):
        self.nos = np.array(list(G.nodes))
        coords = np.array([[G.nodes[n]['y'], G.nodes[n]['x']] for n in self.nos])
        self._arvore = BallTree(np.radians(coords), metric='haversine')

    def snap(self, lat: float, lon: float) -> Tuple[int, float]:
        """Nó mais próximo e a distância até ele, em metros."""
        dist, idx = self._arvore.query(np.radians([[lat, lon]]), k=1)
        return int(self.nos[idx[0][0]]), float(dist[0][0] * RAIO_TERRA_M)


def _haversine_m(a: Sequence[float], b: Sequence[float]) -> float:
    la1, lo1, la2, lo2 = map(np.radians, (a[0], a[1], b[0], b[1]))
    h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return float(2 * RAIO_TERRA_M * np.arcsin(np.sqrt(h)))


def pontos_apoio(polyline: List[List[float]], passo_m: float = 150.0,
                 maximo: int = MAX_PONTOS_APOIO) -> List[List[float]]:
    """Pontos a cada ~passo_m ao longo da rota (sempre com início e fim), no
    máximo `maximo` — o que a TomTom precisa para reconstruir o mesmo trajeto."""
    if len(polyline) < 2:
        return list(polyline)
    saida, acumulado = [polyline[0]], 0.0
    for anterior, atual in zip(polyline, polyline[1:]):
        acumulado += _haversine_m(anterior, atual)
        if acumulado >= passo_m:
            saida.append(atual)
            acumulado = 0.0
    if saida[-1] != polyline[-1]:
        saida.append(polyline[-1])
    if len(saida) > maximo:
        passo = (len(saida) - 1) / (maximo - 1)
        saida = [saida[round(i * passo)] for i in range(maximo)]
    return saida


# --- Semáforos ---------------------------------------------------------------
SNAP_SEMAFORO_M = 40.0  # semáforo na linha de retenção → cruzamento logo à frente


def carregar_semaforos_osm(caminho: str, centro: Tuple[float, float], raio_m: int) -> List[List[float]]:
    """Pontos highway=traffic_signals do OSM na área do grafo (cache em JSON).

    A simplificação do OSMnx apaga os nós de semáforo que ficam no meio da
    aresta, antes do cruzamento (no DF: 114 de 423 sobravam no grafo). Baixa uma
    vez pelo Overpass, como o próprio grafo; sem rede, segue só com as tags.
    """
    if os.path.exists(caminho):
        with open(caminho, encoding='utf-8') as f:
            return json.load(f).get('pontos') or []
    # Consulta direta ao Overpass (o features_from_point do OSMnx 1.9 quebra quando
    # o endpoint de status não responde — UnboundLocalError em _get_overpass_pause).
    import httpx
    consulta = (f'[out:json][timeout:90];node["highway"="traffic_signals"]'
                f'(around:{raio_m},{centro[0]},{centro[1]});out;')
    for url in ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'):
        try:
            r = httpx.post(url, data={'data': consulta}, timeout=120, headers={'User-Agent': 'Routify-TCC/1.0'})
            if r.status_code != 200:
                continue
            pontos = [[round(e['lat'], 7), round(e['lon'], 7)]
                      for e in r.json().get('elements', []) if e.get('type') == 'node']
        except Exception as e:
            logger.warning(f"Overpass {url} indisponível ({type(e).__name__})")
            continue
        with open(caminho, 'w', encoding='utf-8') as f:
            json.dump({'fonte': 'OpenStreetMap (ODbL) highway=traffic_signals', 'consulta': consulta,
                       'pontos': pontos}, f)
        return pontos
    logger.warning("Semáforos do OSM indisponíveis — só as tags do grafo")
    return []


def marcar_semaforos(G: nx.MultiDiGraph, arvore: Optional['ArvoreNos'] = None,
                     pontos_osm: Sequence[Sequence[float]] = ()) -> int:
    """Marca `highway=traffic_signals` nos nós sinalizados (tag do grafo + pontos
    do OSM encaixados no cruzamento a até 40 m) e `semaforo=1` nas arestas que
    chegam neles. Devolve quantos cruzamentos sinalizados há."""
    sinalizados = {n for n, d in G.nodes(data=True) if d.get('highway') == 'traffic_signals'}
    if arvore is not None:
        for lat, lon in pontos_osm:
            no, dist = arvore.snap(lat, lon)
            if dist <= SNAP_SEMAFORO_M:
                sinalizados.add(no)
    for n in sinalizados:
        G.nodes[n]['highway'] = 'traffic_signals'
    for _u, v, d in G.edges(data=True):
        d['semaforo'] = 1 if v in sinalizados else 0
    return len(sinalizados)


def carregar_atraso_semaforo(caminho: str) -> float:
    """Atraso médio por semáforo (s), calibrado contra a TomTom em
    ml/calibrate_signals.py. Sem o artefato, 0 (comportamento antigo)."""
    if not os.path.exists(caminho):
        logger.warning(f"{os.path.basename(caminho)} ausente — sem atraso de semáforo (rode ml/calibrate_signals.py)")
        return 0.0
    with open(caminho, encoding='utf-8') as f:
        atraso = float(json.load(f).get('atraso_por_semaforo_seg') or 0.0)
    logger.info(f"Atraso médio por semáforo: {atraso:.1f} s (calibrado)")
    return max(atraso, 0.0)


def contar_semaforos(G: nx.MultiDiGraph, nos: List[int]) -> int:
    return sum(1 for v in nos[1:] if G.nodes[v].get('highway') == 'traffic_signals')


# --- Fusão ---------------------------------------------------------------------
def tempo_misto(tempo_lia_s: float, cobertura_pct: float, tempo_tomtom_s: Optional[float]) -> float:
    """A fração da rota coberta pela LIA vale pela LIA; o resto, pela TomTom."""
    if not tempo_tomtom_s:
        return tempo_lia_s
    c = min(max(cobertura_pct / 100.0, 0.0), 1.0)
    return c * tempo_lia_s + (1.0 - c) * tempo_tomtom_s


def escolher(tempo_lia_s: float, cobertura_pct: float,
             eta_tt_nossa: Optional[float], eta_tt_melhor: Optional[float]) -> Tuple[str, float, Optional[float]]:
    """Decide entre a rota da LIA e a alternativa da TomTom.

    Devolve (fonte, tempo da escolhida, tempo da outra). A alternativa recebe a
    mesma calibração LIA/TomTom observada na rota da LIA (mesmo corredor, agora),
    e só vence se a própria TomTom a considerar claramente mais rápida — a LIA
    tem a palavra onde enxerga; a TomTom decide quando a LIA está cega.
    """
    misto = tempo_misto(tempo_lia_s, cobertura_pct, eta_tt_nossa)
    if not eta_tt_nossa or not eta_tt_melhor:
        return 'lia', misto, None
    misto_melhor = eta_tt_melhor * (misto / eta_tt_nossa)
    ganho_claro = (eta_tt_melhor <= eta_tt_nossa * (1 - MARGEM_REL)
                   and misto - misto_melhor >= MARGEM_ABS_S)
    return ('tomtom', misto_melhor, misto) if ganho_claro else ('lia', misto, misto_melhor)


if __name__ == '__main__':
    # Autoteste da regra de decisão e da amostragem (sem grafo).
    assert escolher(700, 100, 875, None) == ('lia', 700, None)  # cobertura total: vale a LIA
    assert escolher(700, 0, 875, None) == ('lia', 875, None)  # sem cobertura: vale a TomTom
    fonte, t, alt = escolher(710, 67, 875, 700)  # TomTom 20% mais rápida e ganha > 60 s
    assert fonte == 'tomtom' and alt - t >= MARGEM_ABS_S
    assert escolher(710, 67, 875, 840)[0] == 'lia'  # só 4% melhor: fica a LIA
    assert escolher(600, 50, None, None) == ('lia', 600, None)  # TomTom fora do ar
    linha = [[-15.79 - i * 0.001, -47.88] for i in range(500)]  # ~55 km em linha
    apoio = pontos_apoio(linha)
    assert len(apoio) <= MAX_PONTOS_APOIO and apoio[0] == linha[0] and apoio[-1] == linha[-1]
    print('trajeto ok')
