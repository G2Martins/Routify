"""Sensores virtuais: pontos nos buracos de dados, leitura da TomTom no corredor e peso do trecho medido."""
import asyncio

import networkx as nx
import pytest

import graph_enrichment as ge
import tomtom
import trajeto


def _grafo():
    G = nx.MultiDiGraph()
    # Avenida (arterial) longe de qualquer sensor, em 3 nós; rua local; outra avenida ao lado de um sensor.
    for n, (lat, lon) in {1: (-15.900, -48.000), 2: (-15.900, -47.995), 3: (-15.900, -47.990),
                          4: (-15.905, -48.000), 7: (-15.800, -47.900), 8: (-15.800, -47.895)}.items():
        G.add_node(n, y=lat, x=lon)
    G.add_edge(1, 2, highway='primary', length=540.0, speed_kph=50.0, travel_time_lia=40.0, lia_source='heuristic')
    G.add_edge(2, 3, highway='primary', length=540.0, speed_kph=50.0, travel_time_lia=40.0, lia_source='heuristic')
    G.add_edge(3, 2, highway='primary', length=540.0, speed_kph=50.0, travel_time_lia=40.0, lia_source='heuristic')
    G.add_edge(1, 4, highway='residential', length=560.0, speed_kph=30.0, travel_time_lia=70.0, lia_source='heuristic')
    G.add_edge(7, 8, highway='primary', length=540.0, speed_kph=50.0, travel_time_lia=40.0, lia_source='model')
    return G


def test_ponto_virtual_so_em_via_principal_longe_de_sensor():
    pontos = ge.pontos_virtuais(_grafo(), {101: (-15.8001, -47.8975)})
    assert pontos and all(p < 0 for p in pontos)                       # ids negativos: não colidem com sensores
    assert all(abs(lat + 15.900) < 0.002 for lat, _ in pontos.values())  # só a avenida sem sensor
    assert ge.pontos_virtuais(_grafo(), {}) == {}


def test_leitura_vale_so_no_trecho_medido_no_sentido_medido_e_onde_nao_havia_dado():
    G = _grafo()
    arvore = trajeto.ArvoreNos(G)
    trecho = [(-15.900, -48.000), (-15.900, -47.995), (-15.900, -47.990)]   # 1 -> 2 -> 3
    mudadas = trajeto.aplicar_leituras_virtuais(G, arvore, [(0.5, trecho), (None, trecho), (0.4, [])])
    assert mudadas == 2
    assert G.edges[1, 2, 0]['lia_source'] == G.edges[2, 3, 0]['lia_source'] == 'virtual'
    assert G.edges[1, 2, 0]['lia_razao'] == 0.5 and G.edges[1, 2, 0]['travel_time_lia'] > 40.0  # metade da velocidade
    assert G.edges[3, 2, 0]['lia_source'] == 'heuristic'                 # o outro sentido não foi medido
    assert G.edges[1, 4, 0]['lia_source'] == 'heuristic'
    G.edges[7, 8, 0]['lia_source'] = 'model'
    assert trajeto.aplicar_leituras_virtuais(G, arvore, [(0.3, [(-15.8, -47.9), (-15.8, -47.895)])]) == 0  # sensor real vence


def test_trecho_de_fluxo_le_as_coordenadas_e_ignora_lixo():
    fsd = {'coordinates': {'coordinate': [{'latitude': -15.9, 'longitude': -48.0}, {'latitude': 'x'}, {'longitude': 1}]}}
    assert tomtom.trecho_de_fluxo(fsd) == [(-15.9, -48.0)]
    assert tomtom.trecho_de_fluxo(None) == [] and tomtom.trecho_de_fluxo({}) == []


def test_consulta_do_corredor_le_o_ponto_virtual_e_devolve_razao_e_trecho():
    pytest.importorskip('osmnx')
    pytest.importorskip('supabase')
    import httpx
    from routers import route
    route._cache_virtuais = tomtom.CacheTTL(60, max_itens=16)
    G = nx.MultiDiGraph()
    G.graph['vias_monitoradas'] = {}
    G.graph['pontos_virtuais'] = {-1: (-15.80, -47.85), -2: (-15.95, -47.60)}   # o 2º está fora do corredor

    def handler(req):
        if 'flowSegmentData' in req.url.path:
            return httpx.Response(200, json={'flowSegmentData': {
                'currentSpeed': 30, 'freeFlowSpeed': 60,
                'coordinates': {'coordinate': [{'latitude': -15.80, 'longitude': -47.851}, {'latitude': -15.80, 'longitude': -47.849}]}}})
        if 'incidentDetails' in req.url.path:
            return httpx.Response(200, json={'incidents': []})
        return httpx.Response(404)

    cli = tomtom.TomTomClient([{'id': 'k1', 'key': 'chave-falsa'}], transport=httpx.MockTransport(handler))

    async def rodar():
        try:
            return await route._consultar_tomtom(cli, G, (-15.80, -47.90), (-15.80, -47.80), None, False)
        finally:
            await cli.fechar()
    _, _, _, leituras = asyncio.run(rodar())
    assert leituras == [(0.5, [(-15.80, -47.851), (-15.80, -47.849)])]
