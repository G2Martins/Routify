"""Conversões proibidas do OSM no A* (trajeto.astar_com_restricoes): desvia só da manobra vetada, respeita a
aproximação (a mesma saída vale vindo de outro lado), devolve None sem caminho legal, empata com o
networkx sem restrição e nunca devolve caminho que viole. O artefato real carrega com as contagens da medição."""
import os
import random

import networkx as nx
import pytest

import trajeto

ZERO = lambda u, v: 0.0  # heurística nula: A* vira Dijkstra, ótimo garantido


def cruzamento():
    """1 → 2 → 4 é a conversão à esquerda (20 s); legal: 1 → 2 → 3 → 4 (40 s) ou 1 → 5 → 4 (50 s)."""
    G = nx.MultiDiGraph()
    for u, v, t in [(1, 2, 10), (2, 4, 10), (2, 3, 10), (3, 4, 20), (1, 5, 25), (5, 4, 25), (6, 2, 5)]:
        G.add_edge(u, v, travel_time_lia=t, length=t)
    return G


def custo(G, nos, peso='travel_time_lia'):
    return sum(min(d[peso] for d in G[u][v].values()) for u, v in zip(nos, nos[1:]))


def test_desvia_so_da_conversao_proibida():
    G, proibidas = cruzamento(), {(1, 2): {4}}
    livre = nx.astar_path(G, 1, 4, heuristic=ZERO, weight='travel_time_lia')
    assert livre == [1, 2, 4] and trajeto.viola_conversao(livre, proibidas)
    assert trajeto.astar_com_restricoes(G, 1, 4, ZERO, 'travel_time_lia', proibidas) == [1, 2, 3, 4]
    # Vindo de 6 a mesma saída 2 → 4 é permitida.
    assert trajeto.astar_com_restricoes(G, 6, 4, ZERO, 'travel_time_lia', proibidas) == [6, 2, 4]


def test_sem_caminho_legal_devolve_none():
    G = nx.MultiDiGraph()
    G.add_edge(1, 2, travel_time_lia=1)
    G.add_edge(2, 4, travel_time_lia=1)
    assert trajeto.astar_com_restricoes(G, 1, 4, ZERO, 'travel_time_lia', {(1, 2): {4}}) is None


def test_peso_funcao_com_arestas_paralelas_como_no_networkx():
    G = cruzamento()
    G.add_edge(2, 3, travel_time_lia=1)  # paralela mais rápida: a função recebe {chave: atributos}
    peso = lambda u, v, paralelas: min(d['travel_time_lia'] for d in paralelas.values())
    assert trajeto.astar_com_restricoes(G, 1, 4, ZERO, peso, {(1, 2): {4}}) == [1, 2, 3, 4]
    assert custo(G, [1, 2, 3, 4]) == 31


@pytest.mark.parametrize('semente', range(5))
def test_grade_aleatoria_empata_sem_restricao_e_nunca_viola_com_restricao(semente):
    rnd = random.Random(semente)
    base = nx.grid_2d_graph(8, 8).to_directed()
    G = nx.MultiDiGraph()
    ids = {n: i for i, n in enumerate(base.nodes)}
    for u, v in base.edges:
        G.add_edge(ids[u], ids[v], travel_time_lia=rnd.uniform(1, 10))
    o, d = 0, len(ids) - 1
    ref = nx.astar_path(G, o, d, heuristic=ZERO, weight='travel_time_lia')
    sem = trajeto.astar_com_restricoes(G, o, d, ZERO, 'travel_time_lia', {})
    assert custo(G, sem) == pytest.approx(custo(G, ref))
    # Veta 30% das conversões do caminho ótimo e mais algumas ao acaso.
    proibidas = {}
    triplas = list(zip(ref, ref[1:], ref[2:])) + [(a, b, c) for a in G for b in G[a] for c in G[b] if c != a][:200]
    for a, b, c in rnd.sample(triplas, k=len(triplas) // 3):
        proibidas.setdefault((a, b), set()).add(c)
    legal = trajeto.astar_com_restricoes(G, o, d, ZERO, 'travel_time_lia', proibidas)
    if legal is not None:
        assert not trajeto.viola_conversao(legal, proibidas)
        assert legal[0] == o and legal[-1] == d
        assert custo(G, legal) >= custo(G, ref) - 1e-9


def test_artefato_real_carrega():
    caminho = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml', 'artifacts', 'restricoes_conversao_38km.json')
    proibidas = trajeto.carregar_conversoes_proibidas(caminho)
    assert sum(map(len, proibidas.values())) == 1260  # triplas únicas da medição de 2026-11-02
    assert len({via for _u, via in proibidas}) == 808
    assert all(isinstance(u, int) and isinstance(w, int) for (u, _v), ws in proibidas.items() for w in ws)
