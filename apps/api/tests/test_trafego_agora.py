"""GET /trafego/agora: previsão da LIA agora em cada ponto monitorado, régua 0–3 da rota, nome da via pela aresta
ligada, idade da leitura, do mais lento ao mais livre; cache de 60 s (uma chamada do modelo) e limite por IP."""
from datetime import datetime
from types import SimpleNamespace

import networkx as nx
from fastapi import FastAPI
from fastapi.testclient import TestClient

import lia_inference as lia
import recency_cache
from routers import trafego
from seguranca import Limitador
from test_lia_caca_erros import _contexto, _Encoder, _Modelo, _perfis


class _ModeloContado(_Modelo):
    chamadas = 0

    def predict(self, X):
        _ModeloContado.chamadas += 1
        return super().predict(X)


def _estado(tmp_path):
    G = nx.MultiDiGraph()
    G.add_edge(10, 11, id_ponto_lia=1, dist_lia_m=5.0, name='EPTG')
    G.add_edge(11, 12, id_ponto_lia=1, dist_lia_m=80.0, name='Marginal')
    G.add_edge(12, 13, id_ponto_lia=2, dist_lia_m=10.0, name=['Eixo Rodoviário Sul', 'Eixão'])
    G.graph['vias_monitoradas'] = {1: (-15.83, -48.03), 2: (-15.80, -47.89), 99: (-15.7, -47.8)}  # 99: o modelo não conhece
    rc = recency_cache.RecenciaCache()
    rc._ultima_busca = float('inf')
    rc.registrar(1, 0.30)  # parado agora na EPTG
    return SimpleNamespace(graph=G, encoder=_Encoder(), model=_ModeloContado(), profiles=_perfis(),
                           recencia_cache=rc, contexto=_contexto(tmp_path), model_version='lia_teste')


def test_pontos_do_mais_lento_ao_mais_livre_com_nome_e_idade(tmp_path):
    d = trafego.calcular(_estado(tmp_path), datetime(2026, 11, 3, 8, tzinfo=lia.BRASILIA_TZ))
    assert [p['id'] for p in d['pontos']] == [1, 2]  # 99 fora: o modelo não conhece
    eptg, eixao = d['pontos']
    assert eptg['nome'] == 'EPTG' and eptg['nivel'] == 3 and eptg['razao'] == 0.3 and eptg['leitura_ha_min'] == 0
    assert eixao['nome'] == 'Eixo Rodoviário Sul' and eixao['leitura_ha_min'] is None
    assert sum(d['resumo'].values()) == 2 and d['resumo']['parado'] == 1
    assert d['modelo'] == 'lia_teste'


def test_cache_de_60_s_e_limite_por_ip(tmp_path, monkeypatch):
    monkeypatch.setattr(trafego, '_cache', {'t': float('-inf'), 'dados': None})
    monkeypatch.setattr(trafego, '_limite_ip', Limitador(3))
    app = FastAPI()
    app.include_router(trafego.router)
    for k, v in vars(_estado(tmp_path)).items():
        setattr(app.state, k, v)
    cli = TestClient(app)
    _ModeloContado.chamadas = 0
    assert [cli.get('/trafego/agora').status_code for _ in range(3)] == [200, 200, 200]
    assert _ModeloContado.chamadas == 1  # uma predição em lote, servida do cache depois
    r = cli.get('/trafego/agora')
    assert r.status_code == 429 and int(r.headers['Retry-After']) >= 1
