"""Contrato treino × API das features de contexto da LIA 2.2 (contexto.py)."""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

import contexto
import lia_inference as lia
import recency_cache


@pytest.fixture
def ctx(tmp_path):
    viz = tmp_path / 'viz.json'
    viz.write_text(json.dumps({'janela_min': 60, 'vizinhos': {'1': [2, 3], '2': [1]}}))
    fer = tmp_path / 'fer.json'
    fer.write_text(json.dumps({'feriados': [{'date': '2026-09-07', 'name': 'Independência'}]}))
    return contexto.ContextoAoVivo(str(viz), str(fer))


def test_ordem_do_modelo_posiciona_contexto():
    ordem = lia.LIA_FEATURE_ORDER + contexto.CONTEXT_FEATURES
    modelo = type('M', (), {'feature_names_in_': ordem})()
    assert lia.ordem_features(modelo) == ordem
    perfis = lia.lookup_perfis({'global': 0.9, 'hora_dow': {}}, None, 8, 0)
    ctx_via = {'vizinhos_razao': 0.4, 'vizinhos_n': 2, 'chuva_mm': 1.5, 'chuva_3h_mm': 3.0, 'is_feriado': 1}
    linha = lia.montar_features(0, 8, 0, 50.0, perfis, None, ctx_via, ordem)
    assert linha[ordem.index('velocidade_livre')] == 50.0
    assert linha[-5:] == [0.4, 2.0, 1.5, 3.0, 1.0]
    with pytest.raises(KeyError):  # modelo pede contexto e ninguém mandou: falha alto
        lia.montar_features(0, 8, 0, 50.0, perfis, None, None, ordem)


def test_modelo_sem_nomes_usa_ordem_fixa():
    assert lia.ordem_features(object()) == lia.LIA_FEATURE_ORDER


def test_chuva_ausente_vira_zero_e_feriado_do_df(ctx):
    c = ctx.para_requisicao(datetime(2026, 4, 21, 8, 20))(1)
    assert (c['chuva_mm'], c['chuva_3h_mm']) == (0.0, 0.0)  # treino nunca viu NaN de chuva
    assert c['is_feriado'] == 1  # Fundação de Brasília (distrital), fora da BrasilAPI
    assert ctx.para_requisicao(datetime(2026, 9, 7, 8))(1)['is_feriado'] == 1
    assert ctx.para_requisicao(datetime(2026, 9, 8, 8))(1)['is_feriado'] == 0


def test_chuva_nunca_usa_rotulo_futuro(ctx):
    ctx.chuva = {datetime(2026, 3, 10, h): v for h, v in [(6, 1.0), (7, 2.0), (8, 4.0), (9, 99.0)]}
    c = ctx.para_requisicao(datetime(2026, 3, 10, 8, 20))(1)
    assert (c['chuva_mm'], c['chuva_3h_mm']) == (4.0, 7.0)


def test_vizinhos_so_contam_leituras_da_janela(ctx):
    rc = recency_cache.RecenciaCache()
    rc.registrar(2, 0.5)
    rc._dados[3] = (0.9, datetime.now(timezone.utc) - timedelta(hours=2))  # velha: fora dos 60 min
    c = ctx.para_requisicao(datetime(2026, 3, 10, 8), rc)(1)
    assert (c['vizinhos_razao'], c['vizinhos_n']) == (0.5, 1)
    sem = ctx.para_requisicao(datetime(2026, 3, 10, 8), rc)(99)  # via sem vizinhos no raio
    assert sem['vizinhos_n'] == 0 and sem['vizinhos_razao'] != sem['vizinhos_razao']  # NaN, como no treino


def test_open_meteo_fora_do_ar_nao_derruba_nem_martela(ctx, monkeypatch):
    chamadas = []

    class _Quebrado:
        def __init__(self, *a, **k):
            chamadas.append(1)

        async def __aenter__(self):
            raise OSError('sem rede')

        async def __aexit__(self, *a):
            return False

    import httpx
    monkeypatch.setattr(httpx, 'AsyncClient', _Quebrado)
    asyncio.run(ctx.atualizar_chuva())
    asyncio.run(ctx.atualizar_chuva())  # dentro do TTL: não tenta de novo
    assert len(chamadas) == 1 and ctx.chuva == {} and ctx.chuva_em is None
