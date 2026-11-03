"""POST /route/horarios ("Planejar saída") num grafo de 4 nós com modelos de mentira: validação do corpo,
limite por IP, a conta das saídas, sanidade (hora congestionada demora mais), recência que envelhece com a
antecedência e paridade com o /route. Sem rede, sem TomTom, sem o grafo de 1 GB.

Pula sem osmnx (routers/route.py importa) ou pandas (perfis), como os demais testes do /route no CI enxuto.
"""
import json
import logging
import math
import os
from datetime import datetime, timedelta

import numpy as np
import pytest

pytest.importorskip('osmnx')
pd = pytest.importorskip('pandas')

import networkx as nx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.exceptions import RequestValidationError  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import contexto  # noqa: E402
import lia_inference as lia  # noqa: E402
import recency_cache  # noqa: E402
import seguranca  # noqa: E402
import trajeto  # noqa: E402
from lia_inference import BRASILIA_TZ  # noqa: E402
from routers import planejar, route  # noqa: E402

ARTEFATOS = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml', 'artifacts'))
ORIGEM = {'lat': -15.80012, 'lon': -47.90034}   # ~40 m do nó 1
DESTINO = {'lat': -15.82688, 'lon': -47.90021}  # ~15 m do nó 4
ATRASO_SEMAFORO = 8.0


# --- Dublês --------------------------------------------------------------------------------------
class _Encoder:
    classes_ = np.array([1, 2, 3])

    def transform(self, ids):
        return np.array([list(self.classes_).index(i) for i in ids])


class _Modelo:
    """Base: colunas lidas pelo NOME (ordem errada quebra o teste). Sem contexto (LIA 2.1)."""
    feature_names_in_ = np.array(lia.LIA_FEATURE_ORDER)

    def col(self, X, nome):
        return np.asarray(X, dtype=float)[:, list(self.feature_names_in_).index(nome)]


class _Constante(_Modelo):
    def __init__(self, valor):
        self.valor = valor

    def predict(self, X):
        return np.full(len(X), self.valor)


class _Pico(_Modelo):
    """Lento às 7h e às 8h, quase livre no resto."""

    def predict(self, X):
        hora = self.col(X, 'hora')
        return np.where((hora >= 7) & (hora <= 8), 0.4, 0.9)


class _Recencia(_Modelo):
    """Leitura fresca (< 2 h) manda; velha, vale o perfil (o que o XGBoost aprendeu em grandes linhas)."""

    def predict(self, X):
        fresca = self.col(X, 'delta_min_lag1') < math.log1p(120)
        return np.where(fresca, self.col(X, 'razao_lag1'), self.col(X, 'perfil_via_hora_dow'))


class _SensivelAOrdem(_Modelo):
    """0,5 + 0,4·sen(X·w), w distinto por coluna (com contexto, LIA 2.2+): qualquer coluna trocada muda tudo."""
    feature_names_in_ = np.array(lia.LIA_FEATURE_ORDER + contexto.CONTEXT_FEATURES)

    def predict(self, X):
        w = np.linspace(0.01, 0.21, len(self.feature_names_in_))
        return 0.5 + 0.4 * np.sin(np.nan_to_num(np.asarray(X, dtype=float), nan=0.0) @ w)


class _SemTomTom:
    def __getattr__(self, nome):
        raise AssertionError(f'o planejamento não pode chamar a TomTom ({nome})')


def _perfis(via=0.9, vhd=(), vh=None, hd=None, glob=0.95):
    """Perfis no formato do treino (pandas, índices nomeados), com a cascata a cobrir os buracos."""
    nomes3 = ['id_ponto', 'hora', 'dia_semana']
    tab = pd.DataFrame([list(chave) + list(valores) for chave, valores in vhd],
                       columns=nomes3 + ['perfil_via_hora_dow', 'perfil_via_hora_dow_std', 'perfil_via_hora_dow_n']
                       ).set_index(nomes3)

    def serie(d, nomes):
        s = pd.Series(list((d or {}).values()), index=pd.MultiIndex.from_tuples(list((d or {}).keys()), names=nomes),
                      dtype=float)
        return s

    vias = pd.Series(via if isinstance(via, dict) else {1: via, 2: via, 3: via}, dtype=float)
    vias.index.name = 'id_ponto'
    return {'via_hora_dow': tab, 'via_hora': serie(vh, ['id_ponto', 'hora']), 'via': vias,
            'hora_dow': serie(hd, ['hora', 'dia_semana']), 'global': glob}


def _grafo(prior='corredor'):
    """1 →(sensor da via 1) 2 →(transferência da via 2, a 200 m) 3 →(sem sensor) 4, ~1 km por trecho; semáforo no 3."""
    G = nx.MultiDiGraph()
    for n, lat in ((1, -15.8000), (2, -15.8090), (3, -15.8180), (4, -15.8270)):
        G.add_node(n, y=lat, x=-47.9000)
    G.add_edge(1, 2, length=1000.0, highway='primary', speed_kph=50.0, id_ponto_lia=1, dist_lia_m=10.0)
    G.add_edge(2, 3, length=1000.0, highway='primary', speed_kph=40.0, id_ponto_lia=2, dist_lia_m=200.0)
    G.add_edge(3, 4, length=1000.0, highway='residential', speed_kph=30.0)
    G.nodes[3]['highway'] = 'traffic_signals'
    trajeto.marcar_semaforos(G)
    G.graph.update(prior_congestionamento=prior, atraso_semaforo_s=ATRASO_SEMAFORO)
    return G


def _contexto(tmp_path):
    viz = tmp_path / 'viz.json'
    viz.write_text(json.dumps({'janela_min': 60, 'vizinhos': {'1': [2, 3], '2': [1], '3': [1]}}))
    fer = tmp_path / 'fer.json'
    fer.write_text(json.dumps({'feriados': []}))
    ctx = contexto.ContextoAoVivo(str(viz), str(fer))
    ctx._proxima = float('inf')  # nunca chama o Open-Meteo
    return ctx


def _recencia():
    rc = recency_cache.RecenciaCache()
    rc._ultima_busca = float('inf')  # nunca consulta o banco
    return rc


def _app(modelo=None, G=None, perfis=None, ctx=None):
    app = FastAPI()
    app.include_router(planejar.router)
    app.add_exception_handler(RequestValidationError, seguranca.erro_de_validacao)  # igual ao main.py
    G = G if G is not None else _grafo()
    st = app.state
    st.model, st.encoder, st.profiles, st.model_version = modelo or _Constante(0.5), _Encoder(), perfis or _perfis(), 'lia_falsa'
    st.graph, st.arvore_nos = G, trajeto.ArvoreNos(G)
    st.recencia_cache, st.contexto, st.supabase, st.transfer_confidence = _recencia(), ctx, None, None
    st.tomtom = _SemTomTom()
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _limite_limpo(monkeypatch):
    monkeypatch.setattr(planejar, '_limite_ip', seguranca.Limitador(10))


def _post(cli, **extra):
    return cli.post('/route/horarios', json={'origem': ORIGEM, 'destino': DESTINO, **extra})


def _amanha(hora):
    return (datetime.now(BRASILIA_TZ) + timedelta(days=1)).replace(hour=hora, minute=0, second=0, microsecond=0)


# --- Corpo estrito e limites -----------------------------------------------------------------------
@pytest.mark.parametrize('extra', [
    {'referencia_tomtom': True},                                   # campo extra no topo
    {'origem': {**ORIGEM, 'alt': 1}},                              # campo extra no ponto
    {'origem': {'lat': -23.5505, 'lon': -46.6333}},                # São Paulo: fora do DF
    {'destino': {'lat': -15.80, 'lon': -46.90}},                   # a leste da caixa do DF (GO)
    {'passo_min': 14}, {'passo_min': 121}, {'passo_min': 30.5},
    {'janelas': 1}, {'janelas': 25},
    {'inicio': 'amanhã cedo'},
    {'inicio': (datetime.now(BRASILIA_TZ) - timedelta(hours=1)).isoformat()},
    {'inicio': (datetime.now(BRASILIA_TZ) + timedelta(days=8)).isoformat()},
    {'inicio': '0001-01-01T00:00:00+09:00'},                        # extremo: 422, não 500 na conversão de fuso
])
def test_corpo_invalido_da_422(extra):
    assert _post(_app(), **extra).status_code == 422


@pytest.mark.parametrize('texto', [
    '{"origem":{"lat":NaN,"lon":-47.9},"destino":{"lat":-15.82,"lon":-47.9}}',
    '{"origem":{"lat":-15.8,"lon":Infinity},"destino":{"lat":-15.82,"lon":-47.9}}',
])
def test_nan_e_infinito_dao_422_e_nao_500(texto):
    r = _app().post('/route/horarios', content=texto, headers={'Content-Type': 'application/json'})
    assert r.status_code == 422


def test_ponto_no_df_mas_longe_da_malha_e_mesmo_ponto_dao_422():
    cli = _app()
    longe = _post(cli, destino={'lat': -15.60, 'lon': -47.60})
    assert longe.status_code == 422 and 'fora da área' in longe.json()['detail']
    assert _post(cli, destino=ORIGEM).status_code == 422


def test_limite_de_10_por_minuto_por_ip_com_retry_after():
    cli = _app()
    assert all(_post(cli).status_code == 200 for _ in range(10))
    r = _post(cli)
    assert r.status_code == 429 and int(r.headers['Retry-After']) >= 1


# --- Contrato e conta ------------------------------------------------------------------------------
def test_contrato_saidas_espacadas_e_primeira_arredondada_para_5_min():
    j = _post(_app(), passo_min=15, janelas=5).json()
    saidas = [datetime.fromisoformat(h['saida']) for h in j['horarios']]
    assert len(saidas) == 5 and j['mesmo_trajeto'] is True and j['modelo_utilizado'] == 'lia_falsa'
    assert all(s.utcoffset() == timedelta(hours=-3) for s in saidas)
    assert all(b - a == timedelta(minutes=15) for a, b in zip(saidas, saidas[1:]))
    agora = datetime.now(BRASILIA_TZ)
    assert saidas[0].minute % 5 == 0 and agora - timedelta(minutes=1) <= saidas[0] <= agora + timedelta(minutes=5)
    assert j['distancia_km'] == 3.0 and j['lia_cobertura_pct'] == pytest.approx(66.67, abs=0.01)
    tempos = [h['tempo_seg'] for h in j['horarios']]
    assert j['melhor'] == int(np.argmin(tempos)) and all(t >= j['tempo_livre_seg'] for t in tempos)


@pytest.mark.parametrize('prior', ['corredor', 'perfil'])
def test_conta_de_cada_saida_bate_com_a_mao(prior):
    """Razão 0,5 em toda via monitorada. Corredor: a transferência encolhe para o prior (0,5, do único sensor) e a
    aresta sem sensor herda o prior. Perfil: a transferência encolhe para 1,0 com confiança 0,8 (200 m, degrau) e a
    aresta sem sensor pega a mediana global (0,95, perfis vazios). + 1 semáforo."""
    j = _post(_app(G=_grafo(prior), perfis=_perfis(via={})), inicio=_amanha(6).isoformat(), janelas=3).json()
    r_transf, r_sem = (0.5, 0.5) if prior == 'corredor' else (0.5 * 0.8 + 0.2, 0.95)
    esperado = (1000 * 3.6 / (50 * 0.5) + 1000 * 3.6 / (40 * r_transf) + 1000 * 3.6 / (30 * r_sem) + ATRASO_SEMAFORO)
    assert [h['tempo_seg'] for h in j['horarios']] == [round(esperado)] * 3
    assert j['tempo_livre_seg'] == round(1000 * 3.6 / 50 + 1000 * 3.6 / 40 + 1000 * 3.6 / 30 + ATRASO_SEMAFORO)


def test_hora_congestionada_demora_mais_e_nao_e_a_melhor():
    j = _post(_app(modelo=_Pico()), inicio=_amanha(5).isoformat(), passo_min=60, janelas=6).json()
    t = {datetime.fromisoformat(h['saida']).hour: h['tempo_seg'] for h in j['horarios']}
    assert min(t[7], t[8]) > max(t[5], t[6], t[9], t[10])
    assert datetime.fromisoformat(j['horarios'][j['melhor']]['saida']).hour not in (7, 8)


def test_leitura_ao_vivo_envelhece_ate_a_saida():
    """Congestionamento AGORA (razão 0,3 na via 1) pesa nas saídas próximas e some quando a leitura, vista da
    saída, passa de 2 h (regra do /predict). Perfil constante: só a recência muda entre as saídas. Passo de 90 min:
    longe do limiar de 120 (a 1ª saída pode estar até 59 s no passado)."""
    cli = _app(modelo=_Recencia())
    cli.app.state.recencia_cache.registrar(1, 0.3)
    t = [h['tempo_seg'] for h in _post(cli, passo_min=90, janelas=4).json()['horarios']]
    assert t[0] == t[1] > t[2] == t[3]


def test_primeira_saida_reproduz_o_tempo_da_lia_do_route(tmp_path, monkeypatch):
    """Paridade: no instante dos pesos, a conta por saída é a do assign_lia_weights + atrasos (tempo_lia_seg do
    /route), com recência, contexto, velocidade livre da TomTom e o modelo sensível à ordem das colunas."""
    t0 = datetime(2026, 11, 9, 8, 10, tzinfo=BRASILIA_TZ)  # segunda, 8h10
    monkeypatch.setattr(recency_cache, '_agora_utc', lambda: t0)  # idade da leitura igual nos dois caminhos
    for prior in ('corredor', 'perfil'):
        G = _grafo(prior)
        G.graph['vel_livre_tomtom'] = {1: 63.0}
        modelo, enc = _SensivelAOrdem(), _Encoder()
        perfis = _perfis(vhd=[((1, 8, 0), (0.7, 0.1, 9))], vh={(2, 8): 0.8}, hd={(8, 0): 0.85})
        rc, ctx = _recencia(), _contexto(tmp_path)
        rc.mesclar({1: (0.4, t0 - timedelta(minutes=20)), 2: (0.6, t0 - timedelta(minutes=50))})
        route.assign_lia_weights(modelo, enc, perfis, G, 8, 0, rc, None, ctx.para_requisicao(t0, rc))
        nos = planejar._caminho(G, 1, 4)
        tempos, _ = planejar.tempos_por_saida(modelo, enc, perfis, G, nos, [t0, t0 + timedelta(hours=3)], t0, rc,
                                              None, ctx)
        tempo_lia = route._resumir_caminho(G, nos)[0] + ATRASO_SEMAFORO * trajeto.contar_semaforos(G, nos)
        assert tempos[0] == pytest.approx(tempo_lia, rel=1e-9), prior
        assert tempos[1] != pytest.approx(tempos[0], rel=1e-6)  # outra hora, outra previsão


def test_perfis_vetorizados_iguais_ao_lookup_perfis():
    """A cópia vetorizada da cascata (2 ms × 80 ms) tem de dar o mesmo que lia_inference.lookup_perfis, inclusive
    com NaN no meio, faixa sem amostra e via que os perfis não conhecem."""
    perfis = _perfis(via={1: 0.9, 2: np.nan},
                     vhd=[((1, 8, 0), (0.7, np.nan, 9)), ((2, 8, 0), (np.nan, 0.2, 4)), ((3, 8, 0), (0.6, 0.1, np.nan))],
                     vh={(1, 8): 0.85, (3, 8): np.nan}, hd={(8, 0): 0.88})
    casos = [(perfis, [1, 2, 3, 4], h, d) for h, d in ((8, 0), (8, 1), (9, 0))]
    real = os.path.join(ARTEFATOS, 'lia_2.3_profiles.pkl')
    if os.path.exists(real):  # .pkl fora do git: confere nos perfis de verdade quando estão na máquina
        joblib = pytest.importorskip('joblib')
        p = joblib.load(real)
        casos += [(p, list(p['via'].index[:200]) + [999999], h, d) for h, d in ((8, 1), (3, 6))]
    for p, vias, h, d in casos:
        esperado = [[lia.lookup_perfis(p, v, h, d)[c] for c in planejar.PERFIS] for v in vias]
        np.testing.assert_array_equal(planejar._perfis_da_hora(p, vias, h, d), np.array(esperado, dtype=float))


def test_log_nao_tem_coordenadas(caplog):
    caplog.set_level(logging.INFO)
    assert _post(_app()).status_code == 200
    assert 'Horários' in caplog.text
    assert not any(c in caplog.text for c in ('15.80012', '47.90034', '15.82688', '47.90021'))
