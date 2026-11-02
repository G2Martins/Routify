"""Trânsito por trecho da rota: seções da TomTom, níveis da LIA alinhados ao traçado e buracos preenchidos."""
import networkx as nx
import pytest

import tomtom
import trajeto


def test_secoes_de_transito_da_tomtom_viram_nivel_por_trecho():
    rota = {'sections': [
        {'sectionType': 'TRAVEL_MODE', 'startPointIndex': 0, 'endPointIndex': 6},
        {'sectionType': 'TRAFFIC', 'startPointIndex': 1, 'endPointIndex': 3, 'magnitudeOfDelay': 2, 'simpleCategory': 'JAM'},
        {'sectionType': 'TRAFFIC', 'startPointIndex': 4, 'endPointIndex': 5, 'magnitudeOfDelay': 0, 'simpleCategory': 'ROAD_CLOSURE'},
        {'sectionType': 'TRAFFIC', 'startPointIndex': 'x', 'endPointIndex': 9, 'magnitudeOfDelay': 1},   # lixo: ignora
    ]}
    assert tomtom.niveis_trafego(rota, 7) == [0, 2, 2, 0, 3, 0]
    assert tomtom.niveis_trafego({}, 1) == []


def test_buraco_da_lia_pega_o_nivel_da_tomtom_no_mesmo_lugar():
    lia = [[-15.80, -47.90], [-15.80, -47.89], [-15.80, -47.88], [-15.80, -47.87]]
    tt = [[-15.80001, -47.90], [-15.80001, -47.89], [-15.80001, -47.88], [-15.80001, -47.87]]
    assert trajeto.preencher_com_tomtom(lia, [1, None, None], tt, [0, 3, 2]) == [1, 3, 2]
    longe = [[p[0] + 0.01, p[1]] for p in tt]                     # ~1,1 km ao norte: não é o mesmo lugar
    assert trajeto.preencher_com_tomtom(lia, [1, None, None], longe, [0, 3, 2]) == [1, None, None]
    assert trajeto.preencher_com_tomtom(lia, [1, None, None], None, None) == [1, None, None]


def test_niveis_da_lia_saem_alinhados_com_o_tracado():
    pytest.importorskip('osmnx')
    from shapely.geometry import LineString
    from routers import route
    G = nx.MultiDiGraph()
    G.add_node(1, x=-47.90, y=-15.80)
    G.add_node(2, x=-47.89, y=-15.80)
    G.add_node(3, x=-47.88, y=-15.80)
    G.add_edge(1, 2, geometry=LineString([(-47.90, -15.80), (-47.895, -15.801), (-47.89, -15.80)]),
               lia_source='model', lia_razao=0.5, travel_time_lia=10.0)
    G.add_edge(2, 3, lia_source='heuristic', lia_razao=0.9, travel_time_lia=10.0)
    pontos = route.montar_polyline(G, [1, 2, 3])
    niveis = route.niveis_lia(G, [1, 2, 3])
    assert len(niveis) == len(pontos) - 1 == 3
    assert niveis == [2, 2, None]                                 # heurística = sem dado
    assert [route.nivel_da_razao(r) for r in (0.95, 0.7, 0.5, 0.2)] == [0, 1, 2, 3]
