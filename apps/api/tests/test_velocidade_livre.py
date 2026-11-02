"""Velocidade livre na escala da TomTom (VEL_LIVRE_CALIBRADA, padrão ligado)."""
import networkx as nx

import graph_enrichment as ge


def _grafo(tomtom=45.0, pontos=25):
    """Cada ponto: a própria primária a 5 m (OSM 60) e uma residencial a 20 m (OSM 30).
    Mais uma primária longe de tudo (OSM 80)."""
    G = nx.MultiDiGraph()
    for p in range(pontos):
        G.add_edge(4 * p, 4 * p + 1, highway='primary', speed_kph=60.0, id_ponto_lia=p, dist_lia_m=5.0)
        G.add_edge(4 * p + 2, 4 * p + 3, highway='residential', speed_kph=30.0, id_ponto_lia=p, dist_lia_m=20.0)
    G.add_edge(1000, 1001, highway='primary', speed_kph=80.0, id_ponto_lia=0, dist_lia_m=400.0)
    return G, {p: tomtom for p in range(pontos)}


def _vel(G, hw, dist):
    return sorted({d['speed_kph'] for _, _, d in G.edges(data=True) if d['highway'] == hw and d['dist_lia_m'] == dist})


def test_um_fator_medido_na_via_do_sensor_vale_para_todas_as_arestas():
    G, vel = _grafo()
    assert ge.calibrar_velocidade_livre(G, vel) == {'fator': 0.75, 'pontos': 25}
    # A residencial a 20 m não entra na medida, mas recebe o fator: a escala é uma só.
    assert _vel(G, 'primary', 5.0) == [45.0] and _vel(G, 'primary', 400.0) == [60.0]
    assert _vel(G, 'residential', 20.0) == [22.5]


def test_fator_nunca_acelera_tem_piso_e_e_idempotente():
    G, vel = _grafo(tomtom=300.0)
    assert ge.calibrar_velocidade_livre(G, vel)['fator'] == 1.0
    G, vel = _grafo(tomtom=6.0)
    assert ge.calibrar_velocidade_livre(G, vel)['fator'] == 0.4
    G, vel = _grafo()
    ge.calibrar_velocidade_livre(G, vel)
    ge.calibrar_velocidade_livre(G, vel)
    assert _vel(G, 'primary', 400.0) == [60.0]


def test_sem_ponto_medido_nada_muda():
    G, _ = _grafo()
    assert ge.calibrar_velocidade_livre(G, {}) == {'fator': 1.0, 'pontos': 0}
    assert _vel(G, 'primary', 400.0) == [80.0]
