"""Atraso por cruzamento sem semáforo: marcação, contagem, tempo livre e peso do A*."""
import networkx as nx

import tomtom
import trajeto


def _grafo():
    """0 → 1 → 2 → 3, com 1 cruzamento comum (vizinho extra 9), 2 sinalizado (vizinho extra 8)
    e uma alça de via expressa chegando em 1."""
    G = nx.MultiDiGraph()
    for u, v, hw in ((0, 1, 'primary'), (1, 2, 'primary'), (2, 3, 'primary'),
                     (9, 1, 'residential'), (8, 2, 'residential'), (7, 1, 'motorway_link')):
        G.add_edge(u, v, highway=hw, length=500.0, speed_kph=50.0, travel_time_lia=40.0)
    G.nodes[2]['highway'] = 'traffic_signals'
    return G


def test_marca_cruzamento_local_e_arterial_e_poupa_via_expressa():
    G = _grafo()
    assert trajeto.marcar_cruzamentos(G) == 1  # só o nó 1: o 2 tem semáforo, o resto não cruza
    assert G[9][1][0]['cruzamento'] == 1 and G[9][1][0]['cruzamento_via'] == 0   # chega de rua local
    assert G[0][1][0]['cruzamento'] == 0 and G[0][1][0]['cruzamento_via'] == 1   # chega pela arterial
    assert G[7][1][0]['cruzamento'] == G[7][1][0]['cruzamento_via'] == 0        # alça de via expressa
    assert G[1][2][0]['cruzamento'] == G[1][2][0]['cruzamento_via'] == 0        # semáforo conta à parte


def test_contagem_tempo_livre_e_peso_do_astar():
    G = _grafo()
    trajeto.marcar_cruzamentos(G)
    trajeto.marcar_semaforos(G)
    caminho = [0, 1, 2, 3]
    assert trajeto.contar_cruzamentos(G, caminho) == 0           # o caminho só vem pela arterial
    assert trajeto.contar_cruzamentos(G, caminho, 'cruzamento_via') == 1
    assert trajeto.contar_cruzamentos(G, [9, 1, 2]) == 1         # entrando da rua local
    assert trajeto.contar_semaforos(G, caminho) == 1
    assert round(trajeto.tempo_livre_s(G, caminho)) == 108  # 3 × 500 m a 50 km/h
    peso = tomtom.peso_sem_interditadas(set(), 1e9, atraso_semaforo=20.0, atraso_cruzamento=7.0,
                                        atraso_cruzamento_via=2.0)
    assert peso(0, 1, G[0][1]) == 42.0 and peso(9, 1, G[9][1]) == 47.0
    assert peso(1, 2, G[1][2]) == 60.0 and peso(2, 3, G[2][3]) == 40.0


def test_snap_restrito_ao_maior_componente_nao_cai_em_bolsao_de_mao_unica():
    import networkx as nx
    G = nx.MultiDiGraph()
    for n, (lat, lon) in {1: (-15.80, -47.90), 2: (-15.80, -47.89), 3: (-15.81, -47.89), 9: (-15.8001, -47.9001)}.items():
        G.add_node(n, y=lat, x=lon)
    G.add_edges_from([(1, 2), (2, 3), (3, 1), (1, 9)])          # 9: só se entra (bolsão sem saída)
    maior = max(nx.strongly_connected_components(G), key=len)
    assert trajeto.ArvoreNos(G).snap(-15.8001, -47.9001)[0] == 9           # árvore completa: cai no bolsão
    assert trajeto.ArvoreNos(G, nos=maior).snap(-15.8001, -47.9001)[0] == 1  # restrita: cai no componente
