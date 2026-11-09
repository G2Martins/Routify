"""GET /trafego/ponto/{id}: resumo do histórico, 404 para ponto desconhecido, limite por IP, falha do banco."""
from types import SimpleNamespace

import networkx as nx
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import trafego


class _Consulta:
    def __init__(self, linhas, falha=False):
        self.linhas, self.falha, self.lt_id = linhas, falha, None
        self.pedidos = []

    def table(self, _nome):
        return self

    def select(self, *_a):
        return self

    def eq(self, _c, _v):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.n = n
        return self

    def lt(self, _c, v):
        self.lt_id = v
        return self

    def execute(self):
        if self.falha:
            raise RuntimeError('fora do ar')
        pool = [r for r in self.linhas if self.lt_id is None or r['id_coleta'] < self.lt_id]
        self.pedidos.append(self.lt_id)
        self.lt_id = None
        return SimpleNamespace(data=pool[:self.n])


def _linhas(n=5):
    return [{'id_coleta': 1000 - i, 'velocidade_atual': 30.0 + i, 'velocidade_livre': 60.0, 'tempo_viagem_segundos': 100.0,
             'data_hora_coleta': f'2026-11-0{1 + i % 8}T1{i % 10}:00:00+00:00'} for i in range(n)]


@pytest.fixture
def cliente(monkeypatch):
    trafego._cache['dados'], trafego._cache['t'] = {'pontos': [{'id': 7, 'razao': 0.5, 'nivel': 2, 'leitura_ha_min': 12}]}, float('inf')
    monkeypatch.setattr(trafego, '_limite_ponto', trafego.Limitador(60))
    monkeypatch.setattr(trafego, '_cache_ponto', trafego.tomtom.CacheTTL(300, max_itens=16))
    G = nx.MultiDiGraph(vias_monitoradas={7: (-15.8, -47.9)}, nomes_vias={7: 'Eixo <b>Sul</b>'}, vel_livre_tomtom={7: 61.2})
    app = FastAPI()
    app.include_router(trafego.router)
    app.state.graph = G
    app.state.supabase = _Consulta(_linhas())
    return TestClient(app), app


def test_devolve_visao_geral_e_historico(cliente):
    c, _ = cliente
    r = c.get('/trafego/ponto/7')
    assert r.status_code == 200
    d = r.json()
    assert d['agora'] == {'razao': 0.5, 'nivel': 2, 'leitura_ha_min': 12} and d['vel_livre_kmh'] == 61.2
    h = d['historico']
    assert h['n_leituras'] == 5 and len(h['por_hora']) == 24 and len(h['por_dia_semana']) == 7
    assert sum(x['n'] for x in h['por_hora']) == 5
    assert h['ultimas'][0]['em'] >= h['ultimas'][-1]['em'], 'da mais nova para a mais antiga'
    assert all(0.05 <= x['razao'] <= 1.0 for x in h['ultimas'])
    assert 'user' not in str(d) and 'email' not in str(d)


def test_pagina_por_chave_sem_offset(cliente):
    c, app = cliente
    app.state.supabase = _Consulta(_linhas(1500))
    assert c.get('/trafego/ponto/7').json()['historico']['n_leituras'] == 1500
    assert app.state.supabase.pedidos == [None, 1000 - 999], 'segunda página parte da última chave vista'


def test_cache_nao_consulta_o_banco_de_novo(cliente):
    c, app = cliente
    c.get('/trafego/ponto/7')
    app.state.supabase = _Consulta([], falha=True)
    assert c.get('/trafego/ponto/7').status_code == 200


@pytest.mark.parametrize('rota,status', [('/trafego/ponto/999', 404), ('/trafego/ponto/0', 422), ('/trafego/ponto/abc', 422),
                                         ("/trafego/ponto/7%20or%201=1", 422)])
def test_ponto_invalido(cliente, rota, status):
    assert cliente[0].get(rota).status_code == status


def test_banco_fora_do_ar_nao_vaza_detalhe(cliente):
    c, app = cliente
    app.state.supabase = _Consulta([], falha=True)
    r = c.get('/trafego/ponto/7')
    assert r.status_code == 503 and 'fora do ar' not in r.text


def test_limite_por_ip(cliente, monkeypatch):
    c, _ = cliente
    monkeypatch.setattr(trafego, '_limite_ponto', trafego.Limitador(2))
    assert [c.get('/trafego/ponto/7').status_code for _ in range(3)] == [200, 200, 429]


def test_sem_leituras_devolve_listas_vazias():
    h = trafego.resumir_historico(pd.DataFrame())
    assert h['n_leituras'] == 0 and h['ultimas'] == [] and h['por_hora'][0]['razao'] is None
