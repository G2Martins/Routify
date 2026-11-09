"""Snap em aresta: a rota nasce na via, no sentido permitido, sem retorno nem contramão nas pontas."""
import networkx as nx
import pytest

import trajeto
from routers import route

KM_LAT = 1 / 110.54  # graus por km


def _grafo():
    """Avenida de pista dupla no sentido leste-oeste, com um retorno em cada ponta e uma rua de mão dupla ao sul.

        A ──pista norte (oeste→leste)──▶ B
        ▲                                 │
        └──pista sul (leste→oeste)────────┘
    """
    G = nx.MultiDiGraph()
    lat, sul = -15.80, -15.80 - 0.02 * KM_LAT
    G.add_node(1, y=lat, x=-47.90)
    G.add_node(2, y=lat, x=-47.89)
    G.add_node(3, y=sul, x=-47.89)
    G.add_node(4, y=sul, x=-47.90)
    for u, v, comp in ((1, 2, 1070.0), (2, 3, 22.0), (3, 4, 1070.0), (4, 1, 22.0)):
        G.add_edge(u, v, 0, length=comp, travel_time_lia=comp / 14.0, name=f'via {u}{v}', highway='primary', lia_source='model', lia_razao=1.0)
    return G


def test_nasce_na_projecao_e_nao_no_cruzamento():
    G = _grafo()
    arv = trajeto.ArvoreArestas(G)
    # A 300 m do nó 1, colado na pista norte.
    origem, destino = (-15.80, -47.8972), (-15.80, -47.8925)
    t = trajeto.tracar_por_arestas(G, arv.candidatos(*origem), arv.candidatos(*destino), 30.0, 'travel_time_lia')
    assert t is not None and t.direto, 'mesma pista, no sentido dela: não dá a volta na quadra'
    pts, niveis, tempo, metros = route.juntar_pontas(G, t, [], [])
    assert abs(pts[0][1] - origem[1]) < 1e-4 and abs(pts[-1][1] - destino[1]) < 1e-4
    assert len(niveis) == len(pts) - 1
    assert 450 < metros < 560 and tempo == pytest.approx(metros / 14.0)


def test_sentido_contrario_da_mao_unica_da_a_volta_e_nao_anda_na_contramao():
    G = _grafo()
    arv = trajeto.ArvoreArestas(G)
    # Destino atrás da origem na pista norte (mão única para leste): a pista norte não serve de atalho no contrafluxo.
    origem, destino = (-15.80, -47.8925), (-15.80, -47.8972)
    t = trajeto.tracar_por_arestas(G, [p for p in arv.candidatos(*origem) if (p.u, p.v) == (1, 2)],
                                   [p for p in arv.candidatos(*destino) if (p.u, p.v) == (1, 2)], 30.0, 'travel_time_lia')
    assert not t.direto and t.nos == [2, 3, 4, 1], 'só anda no sentido das arestas'
    pts, *_ = route.juntar_pontas(G, t, route.montar_polyline(G, t.nos), route.niveis_lia(G, t.nos))
    assert abs(pts[0][1] - origem[1]) < 1e-4 and abs(pts[-1][1] - destino[1]) < 1e-4


def test_escolhe_a_pista_certa_se_a_caminhada_compensa():
    """Ponto no canteiro: a pista sul (leste→oeste) leva direto ao destino a oeste, sem contornar o quarteirão."""
    G = _grafo()
    arv = trajeto.ArvoreArestas(G)
    meio = -15.80 - 0.01 * KM_LAT
    t = trajeto.tracar_por_arestas(G, arv.candidatos(meio, -47.8925), arv.candidatos(meio, -47.8972), 30.0, 'travel_time_lia')
    assert (t.entrada.u, t.entrada.v) == (3, 4) and t.direto


def test_conversao_proibida_vale_na_primeira_manobra():
    G = _grafo()
    G.add_node(5, y=-15.79, x=-47.89)
    G.add_edge(2, 5, 0, length=100.0, travel_time_lia=5.0, highway='primary')
    G.add_edge(5, 3, 0, length=100.0, travel_time_lia=50.0, highway='primary')
    arv = trajeto.ArvoreArestas(G)
    origem, destino = (-15.80, -47.8925), (-15.80 - 0.02 * KM_LAT, -47.8925)
    ent = [p for p in arv.candidatos(*origem) if (p.u, p.v) == (1, 2)]
    sai = [p for p in arv.candidatos(*destino) if (p.u, p.v) == (3, 4)]
    livre = trajeto.tracar_por_arestas(G, ent, sai, 30.0, 'travel_time_lia')
    assert livre.nos == [2, 3]
    vetado = trajeto.tracar_por_arestas(G, ent, sai, 30.0, 'travel_time_lia', {(1, 2): {3}})
    assert vetado.nos == [2, 5, 3], 'a manobra 1→2→3 está proibida logo na saída'


def test_meia_volta_so_em_rua_sem_saida():
    """1 → 2 → 1 → 3 é o mais barato no peso, mas meia-volta no meio da via não vale; em 2 há outra saída."""
    G = nx.MultiDiGraph()
    for n, (y, x) in {1: (-15.80, -47.90), 2: (-15.80, -47.89), 3: (-15.79, -47.90), 4: (-15.79, -47.89)}.items():
        G.add_node(n, y=y, x=x)
    for u, v, c in ((1, 2, 1.0), (2, 1, 1.0), (1, 3, 1.0), (2, 4, 50.0), (4, 3, 50.0)):
        G.add_edge(u, v, 0, travel_time_lia=c, length=100.0)
    h = lambda _n: 0.0
    assert trajeto.astar_multi(G, {2: 0.0}, {3: 0.0}, h, 'travel_time_lia', None, {2: 1}) == [2, 1, 3]
    assert trajeto.astar_multi(G, {2: 0.0}, {3: 0.0}, h, 'travel_time_lia', None, {2: 1}, sem_retorno=True) == [2, 4, 3]
    G.remove_edge(2, 4)  # agora 2 é sem saída: voltar é permitido
    assert trajeto.astar_multi(G, {2: 0.0}, {3: 0.0}, h, 'travel_time_lia', None, {2: 1}, sem_retorno=True) == [2, 1, 3]
    assert trajeto.tem_retorno([1, 2, 1]) and not trajeto.tem_retorno([1, 2, 3])


def test_trecho_da_aresta_fica_na_geometria():
    pts = [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
    assert trajeto.trecho_da_aresta(pts, 0.0, 1.0)[0] == [0.0, 0.0] and trajeto.trecho_da_aresta(pts, 0.0, 1.0)[-1] == [1.0, 1.0]
    meio = trajeto.trecho_da_aresta(pts, 0.25, 0.75)
    assert [0.0, 1.0] in meio and meio[0][0] == 0.0 and meio[-1][1] == 1.0
