"""Caça-erros da LIA (inferência local e em produção) — achados de 2026-11-02.

Sem rede, sem Supabase, sem TomTom. 13 testes nasceram como xfail documentando bugs
confirmados (fuso do timestamp, recência sem horizonte nem teto de idade, override pela
metade, NaN/Infinity virando 500, timestamp extremo, clima velho, heurística do A*,
maxspeed com vários valores); todos corrigidos no mesmo dia e agora são regressão.
Os demais são guardas: quebram se alguém regredir o contrato.

Roda no CI enxuto (só pytest/numpy/fastapi/httpx): o que precisa de osmnx, xgboost ou dos
.pkl (fora do git) pula sozinho.
"""
import asyncio
import json
import math
import os
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

import contexto
import lia_inference as lia
import recency_cache
import seguranca  # noqa: E402
from lia_inference import BRASILIA_TZ
from routers import predict

API = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RAIZ = os.path.abspath(os.path.join(API, '..', '..'))
ARTEFATOS = os.path.join(RAIZ, 'ml', 'artifacts')
CONTEXTO_VAZIO = {'vizinhos_razao': float('nan'), 'vizinhos_n': 0, 'chuva_mm': 0.0, 'chuva_3h_mm': 0.0, 'is_feriado': 0}


# --- Dublês (sem pandas/xgboost: o CI não instala) ------------------------------------------
class _Loc:
    def __init__(self, tabela):
        self._t = tabela

    def __getitem__(self, chave):
        return self._t[chave]  # KeyError quando a faixa não existe, como no pandas


class _Tabela:
    def __init__(self, linhas):
        self.loc = _Loc(linhas)


def _perfis():
    return {'global': 0.95, 'hora_dow': {(8, 0): 0.88}, 'via': {1: 0.9, 2: 0.9}, 'via_hora': {(1, 8): 0.85, (2, 8): 0.85},
            'via_hora_dow': _Tabela({(1, 8, 0): {'perfil_via_hora_dow': 0.8, 'perfil_via_hora_dow_std': 0.05,
                                                 'perfil_via_hora_dow_n': 10}})}


class _Encoder:
    classes_ = np.array([1, 2, 3])

    def transform(self, ids):
        return np.array([list(self.classes_).index(i) for i in ids])


class _Modelo:
    """Recência só vale se fresca (< 2 h); senão cai no perfil da faixa (o que o XGBoost real
    aprendeu em grandes linhas). Colunas lidas pelo NOME: errar a ordem quebra o teste."""
    feature_names_in_ = np.array(lia.LIA_FEATURE_ORDER + contexto.CONTEXT_FEATURES)

    def predict(self, X):
        X = np.asarray(X, dtype=float)
        i = {n: k for k, n in enumerate(self.feature_names_in_)}
        fresca = X[:, i['delta_min_lag1']] < math.log1p(120)
        return np.where(fresca, X[:, i['razao_lag1']], X[:, i['perfil_via_hora_dow']])


class _ModeloSensivelAOrdem(_Modelo):
    """f(X) = 0,5 + 0,4·sen(X·w), w distinto por coluna: qualquer coluna fora do lugar muda o resultado."""

    def predict(self, X):
        w = np.linspace(0.01, 0.21, len(self.feature_names_in_))
        return 0.5 + 0.4 * np.sin(np.nan_to_num(np.asarray(X, dtype=float), nan=0.0) @ w)


class _Constante(_Modelo):
    def __init__(self, valor):
        self.valor = valor

    def predict(self, X):
        return np.full(len(X), self.valor)


def _contexto(tmp_path, feriados=('2026-11-02',)):
    viz = tmp_path / 'viz.json'
    viz.write_text(json.dumps({'janela_min': 60, 'vizinhos': {'1': [2, 3], '2': [1], '3': [1]}}))
    fer = tmp_path / 'fer.json'
    fer.write_text(json.dumps({'feriados': [{'date': d, 'name': 'x'} for d in feriados]}))
    ctx = contexto.ContextoAoVivo(str(viz), str(fer))
    ctx._proxima = float('inf')  # nunca chama o Open-Meteo
    return ctx


@pytest.fixture
def ctx(tmp_path):
    return _contexto(tmp_path)


@pytest.fixture
def client(tmp_path):
    app = FastAPI()
    app.include_router(predict.router)
    app.add_exception_handler(RequestValidationError, seguranca.erro_de_validacao)  # igual ao main.py
    rc = recency_cache.RecenciaCache()
    rc._ultima_busca = float('inf')  # nunca consulta o banco
    st = app.state
    st.model, st.encoder, st.profiles, st.model_version = _Modelo(), _Encoder(), _perfis(), 'lia_falsa'
    st.recencia_cache, st.contexto, st.supabase = rc, _contexto(tmp_path), None
    return TestClient(app, raise_server_exceptions=False)


def _post(c, **extra):
    return c.post('/predict', json={'id_ponto': 1, 'velocidade_livre': 60.0, **extra})


def _post_bruto(c, texto):
    return c.post('/predict', content=texto, headers={'Content-Type': 'application/json'})


# =============================================================================================
# 1. Fuso e calendário
# =============================================================================================
def test_predict_sem_timestamp_usa_hora_de_brasilia_e_nao_a_do_processo(client, monkeypatch):
    """O padrão é datetime.now(tz=UTC-3) (predict.py:103, route.py:585): não depende do TZ do host."""
    class _Relogio(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 2, 1, 5, tzinfo=timezone.utc).astimezone(tz)  # 22:05 de domingo em Brasília

    monkeypatch.setattr(predict, 'datetime', _Relogio)
    j = _post(client).json()
    assert (j['hora'], j['dia_semana']) == (22, 6)


@pytest.mark.parametrize('ts, hora, dow', [
    ('2026-11-02T17:30:00', 17, 0),
    ('2026-11-02T17:30:00-03:00', 17, 0),
    ('2026-11-02T20:30:00Z', 17, 0),
    ('2026-11-02T20:30:00+00:00', 17, 0),
    ('2026-11-02T00:30:00+09:00', 12, 6),  # = domingo 12:30 em Brasília
])
def test_predict_timestamp_com_offset_vira_hora_de_brasilia(client, ts, hora, dow):
    j = _post(client, timestamp_brasilia=ts).json()
    assert (j['hora'], j['dia_semana']) == (hora, dow)


def test_feriado_segue_a_data_de_brasilia_perto_da_meia_noite(ctx):
    """22h30 de 02/11 em Brasília já é 03/11 em UTC: o feriado (Finados) tem de seguir a data local."""
    assert ctx.para_requisicao(datetime(2026, 11, 2, 22, 30, tzinfo=BRASILIA_TZ))(1)['is_feriado'] == 1
    assert ctx.para_requisicao(datetime(2026, 11, 1, 23, 30, tzinfo=BRASILIA_TZ))(1)['is_feriado'] == 0
    assert ctx.para_requisicao(datetime(2026, 11, 2, 0, 30, tzinfo=BRASILIA_TZ))(1)['is_feriado'] == 1


def test_feriados_versionados_cobrem_o_fim_de_2026_e_2027():
    caminho = os.path.join(ARTEFATOS, 'feriados.json')
    if not os.path.exists(caminho):
        pytest.skip('ml/artifacts/feriados.json ausente')
    f = contexto.carregar_feriados(caminho)
    for d in (date(2026, 11, 2), date(2026, 11, 15), date(2026, 11, 20), date(2026, 11, 30),  # 30/11 = distrital (Evangélico)
              date(2026, 12, 25), date(2027, 1, 1), date(2027, 4, 21), date(2027, 11, 30), date(2027, 12, 25)):
        assert d in f, d
    assert date(2026, 11, 3) not in f


def test_unidades_definem_tz_de_brasilia():
    """provisionar-ec2.sh (API), Dockerfile e a unit do coletor. A API não depende (usa UTC-3 explícito),
    mas o job da Fase 3 e qualquer datetime.now() ingênuo dependem."""
    for rel, trecho in (('apps/api/deploy/provisionar-ec2.sh', 'Environment=TZ=America/Sao_Paulo'),
                        ('apps/api/Dockerfile', 'ENV TZ=America/Sao_Paulo'),
                        ('services/collector/deploy/routify-collector.service', 'Environment=TZ=America/Sao_Paulo')):
        with open(os.path.join(RAIZ, *rel.split('/')), encoding='utf-8') as f:
            assert trecho in f.read(), rel


class _SB:
    """supabase falso: .table().select().order().limit().execute() → linhas fixas."""

    def __init__(self, linhas):
        self.linhas = linhas

    def table(self, _):
        return self

    def select(self, *_):
        return self

    def order(self, *_, **__):
        return self

    def limit(self, *_):
        return self

    def execute(self):
        return type('R', (), {'data': self.linhas})()


def test_data_hora_coleta_sem_fuso_do_banco_e_tratada_como_utc(monkeypatch):
    """historico_trafego.data_hora_coleta é `timestamp without time zone` (default CURRENT_TIMESTAMP, TimeZone=UTC).
    O silver.py faz to_datetime(utc=True); a API tem de ler igual (senão a idade da recência erra em 3 h)."""
    monkeypatch.setattr(recency_cache, '_agora_utc', lambda: datetime(2026, 11, 2, 4, 0, tzinfo=timezone.utc))
    rc = recency_cache.RecenciaCache()
    rc._buscar(_SB([{'id_ponto': 1, 'velocidade_atual': 30, 'velocidade_livre': 60, 'data_hora_coleta': '2026-11-02T03:25:57.04153'}]))
    g = rc.get(1)
    assert g['razao_lag1'] == 0.5
    assert math.expm1(g['delta_min_lag1']) == pytest.approx(34.05, abs=0.05)  # 03:25:57 UTC → 34 min antes das 04:00 UTC


# =============================================================================================
# 2. Contrato de features
# =============================================================================================
def test_saida_do_modelo_sempre_dentro_da_faixa_da_razao():
    for bruto in (7.0, 1.0129, -3.0, 0.0):
        r = lia.prever_razao(_Constante(bruto), _Encoder(), _perfis(), 1, 8, 0, 50.0, None, CONTEXTO_VAZIO)
        assert lia.RAZAO_MIN <= r <= lia.RAZAO_MAX
        t = lia.tempo_de_razao(500.0, 50.0, r)
        assert math.isfinite(t) and t >= 1.0


def test_modelo_real_bate_com_metadata_e_com_a_ordem_da_api():
    joblib = pytest.importorskip('joblib')
    pytest.importorskip('xgboost')
    caminho = os.path.join(ARTEFATOS, 'lia_2.2.pkl')
    if not os.path.exists(caminho):
        pytest.skip('lia_2.2.pkl fora do git')
    try:
        modelo = joblib.load(caminho)
    except Exception as e:  # lib de outra versão (o venv do repo é o certo)
        pytest.skip(f'pkl ilegível neste ambiente: {type(e).__name__}')
    with open(os.path.join(ARTEFATOS, 'lia_2.2_metadata.json'), encoding='utf-8') as f:
        meta = json.load(f)
    ordem = lia.ordem_features(modelo)
    assert ordem == meta['features'] == lia.LIA_FEATURE_ORDER + contexto.CONTEXT_FEATURES
    perfis = {'global': 1.0, 'hora_dow': {}, 'via': {}, 'via_hora': {}, 'via_hora_dow': _Tabela({})}
    linha = lia.montar_features(0, 8, 1, 50.0, lia.lookup_perfis(perfis, None, 8, 1), None,
                                {**CONTEXTO_VAZIO, 'vizinhos_razao': 0.9, 'vizinhos_n': 3}, ordem)
    assert len(linha) == len(ordem) == 21 and all(math.isfinite(x) for x in linha)


def test_ordem_das_features_e_calendario_espelham_ml_features():
    """lia_inference.py "espelha ml/features.py": lê as constantes do treino por AST (sem importar o ml/, que
    puxa pandas) e compara com as da API. Ordem trocada = o modelo recebe colunas trocadas e não dá erro."""
    import ast
    caminho = os.path.join(RAIZ, 'ml', 'features.py')
    with open(caminho, encoding='utf-8') as f:
        texto = f.read()
    consts = {}
    for no in ast.parse(texto).body:
        if isinstance(no, ast.Assign) and len(no.targets) == 1 and isinstance(no.targets[0], ast.Name):
            try:
                consts[no.targets[0].id] = ast.literal_eval(no.value)
            except ValueError:
                pass  # expressão que não é literal (ex.: FEATURE_COLS = A + B)
    assert consts['BASE_FEATURES'] + consts['PROFILE_FEATURES'] + consts['RECENCY_FEATURES'] == lia.LIA_FEATURE_ORDER
    assert consts['HORARIOS_PICO'] == lia.HORARIOS_PICO
    assert (lia.RAZAO_MIN, lia.RAZAO_MAX) == (0.05, 1.0) and 'clip(0.05, 1.0)' in texto
    assert 'np.log1p(delta_min.clip(lower=0))' in texto  # = lia.delta_min_para_feature


def test_pesos_do_route_concordam_com_o_predict(tmp_path):
    """O mesmo (via, hora, dia, recência, contexto) tem de dar a mesma razão em /route e em /predict.
    Modelo sensível à ordem das colunas: pega divergência de montagem entre os dois caminhos."""
    pytest.importorskip('osmnx')
    import networkx as nx
    from routers import route
    modelo, enc, perfis = _ModeloSensivelAOrdem(), _Encoder(), _perfis()
    rc = recency_cache.RecenciaCache()
    rc._ultima_busca = float('inf')
    rc.registrar(1, 0.6)
    G = nx.MultiDiGraph()
    G.add_edge(10, 11, length=500.0, highway='primary', speed_kph=50.0, id_ponto_lia=1, dist_lia_m=10.0)    # 'model'
    G.add_edge(11, 12, length=300.0, highway='primary', speed_kph=40.0, id_ponto_lia=2, dist_lia_m=200.0)   # 'transfer'
    ctx_via = _contexto(tmp_path).para_requisicao(datetime(2026, 11, 2, 8, tzinfo=BRASILIA_TZ), rc)
    route.assign_lia_weights(modelo, enc, perfis, G, 8, 0, rc, None, ctx_via)
    a, b = G.edges[10, 11, 0], G.edges[11, 12, 0]
    assert (a['lia_source'], b['lia_source']) == ('model', 'transfer')
    r1 = lia.prever_razao(modelo, enc, perfis, 1, 8, 0, 50.0, rc.get(1), ctx_via(1))
    assert a['lia_razao'] == pytest.approx(r1, abs=1e-4)
    r2 = lia.prever_razao(modelo, enc, perfis, 2, 8, 0, 40.0, rc.get(2), ctx_via(2))
    conf = float(route._confianca_transfer(200.0, None)[0])  # sem a curva isotônica: degrau 0,8
    assert b['lia_razao'] == pytest.approx(r2 * conf + (1 - conf), abs=1e-4)


def test_prior_corredor_aresta_sem_sensor_herda_a_lentidao_prevista_agora(tmp_path):
    """PRIOR_CONGESTIONAMENTO=corredor: heurística e alvo da transferência = média harmônica do modelo
    nos trechos monitorados (ponderada pelo tempo livre), não a mediana histórica (1,0 no perfil vazio)."""
    pytest.importorskip('osmnx')
    import networkx as nx
    from routers import route
    modelo, enc, perfis = _ModeloSensivelAOrdem(), _Encoder(), _perfis()
    rc = recency_cache.RecenciaCache()
    rc._ultima_busca = float('inf')
    rc.registrar(1, 0.6)
    G = nx.MultiDiGraph()
    G.graph['prior_congestionamento'] = 'corredor'
    G.add_edge(10, 11, length=500.0, highway='primary', speed_kph=50.0, id_ponto_lia=1, dist_lia_m=10.0)    # 'model'
    G.add_edge(11, 12, length=300.0, highway='primary', speed_kph=40.0, id_ponto_lia=2, dist_lia_m=200.0)   # 'transfer'
    G.add_edge(12, 13, length=400.0, highway='residential', speed_kph=30.0)                                  # sem sensor
    ctx_via = _contexto(tmp_path).para_requisicao(datetime(2026, 11, 2, 8, tzinfo=BRASILIA_TZ), rc)
    route.assign_lia_weights(modelo, enc, perfis, G, 8, 0, rc, None, ctx_via)
    a, b, c = G.edges[10, 11, 0], G.edges[11, 12, 0], G.edges[12, 13, 0]
    r1 = lia.prever_razao(modelo, enc, perfis, 1, 8, 0, 50.0, rc.get(1), ctx_via(1))
    r2 = lia.prever_razao(modelo, enc, perfis, 2, 8, 0, 40.0, rc.get(2), ctx_via(2))
    assert c['lia_source'] == 'heuristic' and c['lia_razao'] == pytest.approx(r1, abs=1e-4)  # um só trecho monitorado
    conf = float(route._confianca_transfer(200.0, None)[0])
    assert b['lia_razao'] == pytest.approx(r2 * conf + r1 * (1 - conf), abs=1e-4)
    assert c['travel_time_lia'] == pytest.approx(lia.tempo_de_razao(400.0, 30.0, r1), rel=1e-3)


def test_override_de_recencia_exige_razao_e_minutos(client):
    assert _post(client, razao_ultima_observacao=0.5).status_code == 422


# =============================================================================================
# 3. Recência
# =============================================================================================
def test_leitura_de_100_dias_nao_vira_recencia():
    rc = recency_cache.RecenciaCache()
    rc._dados[1] = (0.30, datetime.now(timezone.utc) - timedelta(days=100))
    assert rc.get(1) is None


def test_leitura_ao_vivo_nao_vale_para_daqui_a_sete_dias(client):
    client.app.state.recencia_cache.registrar(1, 0.30)  # congestionamento AGORA
    agora = datetime.now(BRASILIA_TZ).replace(tzinfo=None)
    r_agora = _post(client, timestamp_brasilia=agora.isoformat()).json()['razao_congestionamento']
    r_7d = _post(client, timestamp_brasilia=(agora + timedelta(days=7)).isoformat()).json()['razao_congestionamento']
    assert r_agora == pytest.approx(0.30, abs=1e-3)  # sanidade do dublê: recência fresca é usada
    assert r_7d != pytest.approx(0.30, abs=1e-3)


# =============================================================================================
# 4. Chuva (Open-Meteo)
# =============================================================================================
class _OpenMeteoOk:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        class _R:
            def raise_for_status(self):
                pass

            def json(self):
                return {'hourly': {'time': ['2026-11-02T10:00'], 'precipitation': [2.0]},
                        'current': {'temperature_2m': 24.0, 'weather_code': 63, 'precipitation': 2.0, 'is_day': 1,
                                    'wind_speed_10m': 10.0}}
        return _R()


class _OpenMeteoForaDoAr(_OpenMeteoOk):
    async def __aenter__(self):
        raise OSError('sem rede')


def test_open_meteo_fora_do_ar_manda_chuva_zero_e_nunca_nan(ctx, monkeypatch):
    """Falhou (ou nunca respondeu): chuva_mm = chuva_3h_mm = 0,0 (seco). O estresse treino × produção mostra que
    0 não muda o erro (RMSE 33,7259 = fresco) e que NaN piora (34,18)."""
    import httpx
    monkeypatch.setattr(httpx, 'AsyncClient', _OpenMeteoForaDoAr)
    ctx._proxima = 0.0
    asyncio.run(ctx.atualizar_chuva())
    c = ctx.para_requisicao(datetime(2026, 11, 2, 10, 20))(1)
    assert (c['chuva_mm'], c['chuva_3h_mm']) == (0.0, 0.0)
    assert ctx.clima(datetime(2026, 11, 2, 10, 20)) is None


def test_clima_velho_nao_e_servido_como_se_fosse_agora(ctx, monkeypatch):
    import httpx
    monkeypatch.setattr(httpx, 'AsyncClient', _OpenMeteoOk)
    ctx._proxima = 0.0
    asyncio.run(ctx.atualizar_chuva())
    assert ctx.clima(datetime(2026, 11, 2, 10, 20))['condicao'] == 'Chuva'
    ctx._proxima, ctx.chuva_em = 0.0, ctx.chuva_em - 3 * 86400  # 3 dias depois…
    monkeypatch.setattr(httpx, 'AsyncClient', _OpenMeteoForaDoAr)  # …e o Open-Meteo caiu
    asyncio.run(ctx.atualizar_chuva())
    assert ctx.clima(datetime(2026, 11, 5, 10, 20)) is None


# =============================================================================================
# 6. Endpoints: entradas de borda
# =============================================================================================
def test_predict_rejeita_campo_extra_via_desconhecida_e_numeros_invalidos(client):
    assert _post(client, extra=1).status_code == 422
    assert client.post('/predict', json={'id_ponto': 99999, 'velocidade_livre': 60}).status_code == 422
    for v in (0, -1):
        assert client.post('/predict', json={'id_ponto': 1, 'velocidade_livre': v}).status_code == 422
    assert _post(client, comprimento_m=0).status_code == 422


@pytest.mark.parametrize('ts', ['2099-12-31T23:59:59', '2020-01-01T08:00:00', '2026-11-02'])
def test_predict_aceita_passado_e_futuro_distante(client, ts):
    assert _post(client, timestamp_brasilia=ts).status_code == 200


def test_predict_nan_da_422_e_nao_500(client):
    assert _post_bruto(client, '{"id_ponto":1,"velocidade_livre":NaN}').status_code == 422


def test_route_nan_da_422_e_nao_500():
    pytest.importorskip('osmnx')
    from routers import route
    app = FastAPI()
    app.include_router(route.router)
    app.add_exception_handler(RequestValidationError, seguranca.erro_de_validacao)
    r = TestClient(app, raise_server_exceptions=False).post(
        '/route', content='{"origem":{"lat":NaN,"lon":-47.88},"destino":{"lat":-15.83,"lon":-48.05}}',
        headers={'Content-Type': 'application/json'})
    assert r.status_code == 422


def test_predict_infinito_e_rejeitado(client):
    assert _post_bruto(client, '{"id_ponto":1,"velocidade_livre":Infinity}').status_code == 422


def test_predict_timestamp_fora_da_faixa_da_422_e_nao_500(client):
    for ts in ('0001-01-01T00:00:00', '9999-12-31T23:59:59'):
        assert _post(client, timestamp_brasilia=ts).status_code == 422


# =============================================================================================
# Roteamento: A* e velocidade
# =============================================================================================
def test_heuristica_do_astar_e_limite_inferior_do_custo():
    pytest.importorskip('osmnx')
    import networkx as nx
    from routers import route
    G = nx.MultiDiGraph()
    G.add_edge(0, 1, speed_kph=110.0)
    G.add_edge(1, 2, speed_kph=40.0)
    custo_por_metro = lia.tempo_de_razao(1000.0, 110.0, 1.0) / 1000.0
    assert custo_por_metro >= 1.0 / route._vmax_ms(G)


def test_heuristica_cobre_trecho_monitorado_mais_rapido_que_o_grafo():
    # Trecho monitorado usa a velocidade livre da TomTom (120) no lugar da do grafo (fator por grupo baixa esta).
    pytest.importorskip('osmnx')
    import networkx as nx
    from routers import route
    G = nx.MultiDiGraph()
    G.add_edge(0, 1, speed_kph=88.0)
    G.graph['vel_livre_tomtom'] = {7: 120.0}
    assert route._vmax_ms(G) == pytest.approx(120.0 / 3.6)


def test_parse_maxspeed_com_varios_valores():
    pytest.importorskip('osmnx')
    from graph_enrichment import _parse_maxspeed
    assert _parse_maxspeed('50;60') == 50.0
    assert _parse_maxspeed("['60', '40']") == 40.0
