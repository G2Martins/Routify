"""TomTom sob demanda (tomtom.py) e merge da recência (recencia_cache.py).

Sem rede: o HTTP da TomTom é simulado com httpx.MockTransport. Rodar a
partir de BackEnd/API: `pytest -q`.
"""
import asyncio
import time
from datetime import timedelta

import httpx
import networkx as nx
import pytest

import recencia_cache
import tomtom


def _chaves(n):
    return [{'id': f'k{i}', 'key': f'SEGREDO{i}'} for i in range(n)]


def _cliente(handler, n_chaves=2, **kw):
    return tomtom.TomTomClient(_chaves(n_chaves), transport=httpx.MockTransport(handler), **kw)


def _rodar(cliente, coro_fn):
    async def _run():
        try:
            return await coro_fn(cliente)
        finally:
            await cliente.fechar()
    return asyncio.run(_run())


def _incidente(icone, coords):
    return {'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': coords},
            'properties': {'iconCategory': icone, 'delay': 120, 'events': [{'description': 'Via fechada'}]}}


def _grafo_linha():
    """1 — 2 — 3 em linha (≈107 m entre nós) e 4, 1,1 km ao norte de 2."""
    G = nx.MultiDiGraph()
    nos = {1: (-15.80, -47.900), 2: (-15.80, -47.899), 3: (-15.80, -47.898), 4: (-15.79, -47.899)}
    for n, (lat, lon) in nos.items():
        G.add_node(n, y=lat, x=lon)
    for u, v in [(1, 2), (2, 1), (2, 3), (3, 2), (2, 4), (4, 2)]:
        G.add_edge(u, v, travel_time_lia=10.0)
    return G


# --- pool de chaves ---------------------------------------------------------

def test_rodizio_e_cooldown_por_servico(monkeypatch):
    pool = tomtom.KeyPool(_chaves(2))
    assert [pool.proxima('fluxo')['id'] for _ in range(3)] == ['k0', 'k1', 'k0']
    pool.falha('k0', 'fluxo', 'chave')
    assert [pool.proxima('fluxo')['id'] for _ in range(2)] == ['k1', 'k1']
    assert pool.proxima('incidentes')['id'] == 'k0'  # cota/cooldown é por serviço
    agora = time.time()
    monkeypatch.setattr(tomtom.time, 'time', lambda: agora + tomtom.COOLDOWN_CHAVE_S + 1)
    assert pool.disponiveis('fluxo') == 2  # volta sozinha


def test_todas_em_cooldown_devolve_none():
    pool = tomtom.KeyPool(_chaves(2))
    pool.falha('k0', 'rota', 'cota')
    pool.falha('k1', 'rota', 'cota')
    assert pool.proxima('rota') is None


def test_429_seguidos_viram_cota_e_sucesso_zera():
    pool = tomtom.KeyPool(_chaves(1))
    for _ in range(tomtom.STRIKES_429_PARA_COTA - 1):
        pool.falha('k0', 'busca', 'qps')
    assert pool._cooldown[('k0', 'busca')] - time.time() <= tomtom.COOLDOWN_QPS_S
    pool.sucesso('k0', 'busca')
    pool.falha('k0', 'busca', 'qps')  # contagem recomeçou
    assert pool._cooldown[('k0', 'busca')] - time.time() <= tomtom.COOLDOWN_QPS_S
    for _ in range(tomtom.STRIKES_429_PARA_COTA - 1):
        pool.falha('k0', 'busca', 'qps')
    assert pool._cooldown[('k0', 'busca')] - time.time() > 3600


@pytest.mark.parametrize('status,corpo,esperado', [
    (403, 'Developer Over Qps', 'qps'),
    (403, 'Developer Over Rate', 'cota'),
    (429, '{"errorText": "Quota exceeded"}', 'cota'),
    (429, '', 'qps'),
    (403, 'Forbidden', 'chave'),
    (500, 'erro interno', None),
    (400, 'bad request', None),
])
def test_classificar_erro(status, corpo, esperado):
    assert tomtom.classificar_erro(status, corpo) == esperado


# --- cliente HTTP -----------------------------------------------------------

def test_cliente_troca_de_chave_quando_a_cota_acaba():
    usadas = []

    def handler(req):
        usadas.append(req.url.params['key'])
        if req.url.params['key'] == 'SEGREDO0':
            return httpx.Response(403, text='Developer Over Rate')
        return httpx.Response(200, json={'flowSegmentData': {'currentSpeed': 30, 'freeFlowSpeed': 60}})

    cli = _cliente(handler)
    fsd = _rodar(cli, lambda c: c.fluxo(-15.8, -47.9))
    assert tomtom.razao_de_fluxo(fsd) == 0.5
    assert usadas == ['SEGREDO0', 'SEGREDO1']
    assert cli.pool.disponiveis('fluxo') == 1 and cli.pool.disponiveis('incidentes') == 2


def test_erro_de_rede_nao_vaza_chave_no_log(caplog):
    def handler(req):
        raise httpx.ConnectError(f'falhou {req.url}', request=req)

    with caplog.at_level('WARNING'):
        assert _rodar(_cliente(handler), lambda c: c.fluxo(-15.8, -47.9)) is None
    assert 'SEGREDO' not in caplog.text


def test_orcamento_do_minuto_corta_chamadas():
    feitas = []

    def handler(req):
        feitas.append(1)
        return httpx.Response(200, json={'flowSegmentData': {'currentSpeed': 1, 'freeFlowSpeed': 2}})

    async def tres(c):
        return [await c.fluxo(-15.8, -47.9) for _ in range(3)]

    res = _rodar(_cliente(handler, max_chamadas_min=2), tres)
    assert res[2] is None and len(feitas) == 2


def test_incidentes_usam_cache():
    feitas = []

    def handler(req):
        feitas.append(req.url.params['bbox'])
        return httpx.Response(200, json={'incidents': [_incidente(8, [[-47.9, -15.8], [-47.899, -15.8]])]})

    bbox = tomtom.bbox_corredor((-15.80, -47.90), (-15.79, -47.88))

    async def duas(c):
        return await c.incidentes(bbox), await c.incidentes(bbox)

    a, b = _rodar(_cliente(handler), duas)
    assert a == b and len(a) == 1 and len(feitas) == 1


def test_busca_codifica_texto_do_usuario_no_caminho():
    caminhos = []

    def handler(req):
        caminhos.append(req.url.raw_path.decode())
        return httpx.Response(200, json={'results': [{
            'position': {'lat': -15.8, 'lon': -47.9},
            'address': {'freeformAddress': 'SQS 308, Brasília'},
            'poi': {'name': 'Igrejinha'},
        }]})

    res = _rodar(_cliente(handler), lambda c: c.buscar('../a/b?x#y', 3))
    assert res == [{'label': 'Igrejinha', 'sublabel': 'SQS 308, Brasília', 'lat': -15.8, 'lon': -47.9}]
    assert caminhos[0].startswith('/search/2/search/..%2Fa%2Fb%3Fx%23y.json')


# --- geometria ----------------------------------------------------------------

def test_razao_de_fluxo():
    assert tomtom.razao_de_fluxo({'currentSpeed': 30, 'freeFlowSpeed': 60}) == 0.5
    assert tomtom.razao_de_fluxo({'currentSpeed': 80, 'freeFlowSpeed': 60}) == tomtom.RAZAO_MAX
    assert tomtom.razao_de_fluxo({'currentSpeed': 1, 'freeFlowSpeed': 60}) == tomtom.RAZAO_MIN
    assert tomtom.razao_de_fluxo({'roadClosure': True, 'currentSpeed': 50, 'freeFlowSpeed': 60}) == tomtom.RAZAO_MIN
    assert tomtom.razao_de_fluxo({'currentSpeed': 30, 'freeFlowSpeed': 0}) is None
    assert tomtom.razao_de_fluxo(None) is None


def test_selecionar_vias_corredor():
    origem, destino = (-15.80, -47.90), (-15.80, -47.80)
    vias = {
        1: (-15.80, -47.89),   # na reta, observação velha
        2: (-15.80, -47.85),   # na reta, fresca → não gasta chamada
        3: (-15.85, -47.85),   # 5,5 km fora do buffer
        4: (-15.805, -47.81),  # 555 m da reta, nunca vista
    }
    idades = {1: 90.0, 2: 3.0}
    assert tomtom.selecionar_vias_corredor(vias, origem, destino, idades.get) == [1, 4]
    muitas = {i: (-15.80, -47.90 + i * 0.001) for i in range(50)}
    assert len(tomtom.selecionar_vias_corredor(muitas, origem, destino, lambda _: None, k=5)) == 5


def test_bbox_alinhada_a_grade_compartilha_cache():
    a = tomtom.bbox_corredor((-15.801, -47.901), (-15.790, -47.880))
    b = tomtom.bbox_corredor((-15.802, -47.899), (-15.791, -47.881))
    assert a == b
    min_lon, min_lat, max_lon, max_lat = a
    assert min_lon < -47.901 and max_lon > -47.880 and min_lat < -15.801 and max_lat > -15.790


def test_interdicao_bloqueia_so_o_trecho_coberto():
    G = _grafo_linha()
    coords = [[-47.9001, -15.80], [-47.8989, -15.80]]  # cobre 1–2
    assert tomtom.arestas_interditadas(G, [_incidente(8, coords)]) == {(1, 2, 0), (2, 1, 0)}
    # congestionamento não bloqueia: lentidão é papel da LIA + recência
    assert tomtom.arestas_interditadas(G, [_incidente(6, coords)]) == set()


def test_astar_desvia_da_interdicao():
    G = _grafo_linha()
    G.add_edge(1, 3, travel_time_lia=50.0)  # atalho mais caro que 1→2→3
    assert nx.astar_path(G, 1, 3, weight='travel_time_lia') == [1, 2, 3]
    assert nx.astar_path(G, 1, 3, weight=tomtom.peso_sem_interditadas({(1, 2, 0)})) == [1, 3]


def test_incidentes_na_rota_filtra_e_prioriza_interdicao():
    rota = [[-15.80, -47.900], [-15.80, -47.898]]
    perto = _incidente(6, [[-47.8990, -15.8003]])   # ~33 m
    longe = _incidente(1, [[-47.8990, -15.8100]])   # ~1,1 km
    fechado = _incidente(8, [[-47.8995, -15.8001]])  # ~11 m
    achados = tomtom.incidentes_na_rota([perto, longe, fechado], rota)
    assert [a['tipo'] for a in achados] == ['Via interditada', 'Congestionamento']
    assert achados[0]['interdicao'] and achados[0]['descricao'] == 'Via fechada'


# --- integração com o /route ------------------------------------------------

def test_consultar_tomtom_atualiza_recencia_e_devolve_incidentes_e_referencia():
    pytest.importorskip('osmnx')  # routers.route puxa osmnx/supabase (fora do CI mínimo)
    pytest.importorskip('supabase')
    from routers import route

    G = nx.MultiDiGraph()
    G.graph['vias_monitoradas'] = {1: (-15.80, -47.89), 2: (-15.80, -47.85), 3: (-15.90, -47.85)}

    def handler(req):
        if 'flowSegmentData' in req.url.path:
            return httpx.Response(200, json={'flowSegmentData': {'currentSpeed': 20, 'freeFlowSpeed': 80}})
        if 'incidentDetails' in req.url.path:
            return httpx.Response(200, json={'incidents': [_incidente(8, [[-47.86, -15.80], [-47.85, -15.80]])]})
        return httpx.Response(200, json={'routes': [{'summary': {
            'travelTimeInSeconds': 600, 'trafficDelayInSeconds': 60,
            'noTrafficTravelTimeInSeconds': 540, 'lengthInMeters': 5000}}]})

    rc = recencia_cache.RecenciaCache()
    atualizadas, incidentes, ref = _rodar(
        _cliente(handler),
        lambda c: route._consultar_tomtom(c, G, (-15.80, -47.90), (-15.80, -47.80), rc, True),
    )
    assert atualizadas == 2  # via 3 está fora do corredor
    assert rc.get(1)['razao_lag1'] == 0.25 and rc.get(3) is None
    assert len(incidentes) == 1
    assert ref == {'tempo_seg': 600, 'atraso_seg': 60, 'sem_transito_seg': 540, 'distancia_km': 5.0}


# --- recência ---------------------------------------------------------------

def test_recencia_ao_vivo_vence_o_banco_no_merge():
    rc = recencia_cache.RecenciaCache()
    rc.registrar(7, 0.4)
    assert rc.idade_min(7) < 1 and rc.get(7)['razao_lag1'] == 0.4
    antigo = recencia_cache._agora_utc() - timedelta(hours=2)
    rc.mesclar({7: (1.0, antigo), 8: (0.5, antigo)})
    assert rc.get(7)['razao_lag1'] == 0.4  # a leitura ao vivo é mais nova
    assert rc.get(8)['razao_lag1'] == 0.5
    assert rc.idade_min(99) is None


def test_recencia_sem_banco_nao_retenta_a_cada_requisicao():
    rc = recencia_cache.RecenciaCache()
    rc.refrescar_se_necessario(None)
    primeira = rc._ultima_busca
    rc.refrescar_se_necessario(None)
    assert rc._ultima_busca == primeira > 0
