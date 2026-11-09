"""Rotação de chaves, classificação de 429/403 e cadência pela cota.

Rede e banco são simulados: nenhum teste chama a TomTom nem o Supabase.
Rodar: cd services/collector && python -m pytest -q tests
"""
import types

import pytest

import traffic_collector as tc

SEGMENTO = {'flowSegmentData': {'currentSpeed': 30, 'freeFlowSpeed': 60,
                                'currentTravelTime': 120, 'confidence': 0.9}}


def resposta(status, corpo='', json_=None):
    def _json():
        if json_ is None:
            raise ValueError('sem json')
        return json_
    return types.SimpleNamespace(status_code=status, text=corpo, json=_json)


def so_a_chave_1_falha(status, corpo):
    def get(url, params, timeout):
        if params['key'] == 'segredo1':
            return resposta(status, corpo)
        return resposta(200, json_=SEGMENTO)
    return get


@pytest.fixture
def coletor(monkeypatch):
    monkeypatch.setattr(tc.time, 'sleep', lambda s: None)
    return tc.TrafficCollector([{'id': f'k{i}', 'key': f'segredo{i}'} for i in range(1, 4)])


def test_chaves_vem_do_arquivo_apontado_por_env():
    assert [c['id'] for c in tc.API_KEYS_DATA] == ['k1', 'k2', 'k3']


# --- cadência pela cota -----------------------------------------------------

def test_intervalo_do_pool_atual():
    # 39 chaves × 20 mil/mês × 85% / 31 dias = 21.387 req/dia → 33,9 ciclos de 630 → 43 min
    assert tc.intervalo_minutos(39, 630, cota_mensal=20000, reserva=0.15) == 43


@pytest.mark.parametrize('n_chaves,n_pontos', [(1, 630), (5, 630), (39, 630), (39, 100), (200, 630), (3, 10)])
def test_intervalo_nunca_estoura_o_orcamento(n_chaves, n_pontos):
    minutos = tc.intervalo_minutos(n_chaves, n_pontos, cota_mensal=20000, reserva=0.15)
    orcamento_dia = n_chaves * 20000 * 0.85 / 31
    assert minutos >= tc.INTERVALO_PISO_MIN
    assert (1440 / minutos) * n_pontos <= orcamento_dia + 1e-9


def test_intervalo_rejeita_entrada_invalida():
    with pytest.raises(ValueError):
        tc.intervalo_minutos(0, 630)
    with pytest.raises(ValueError):
        tc.intervalo_minutos(39, 630, reserva=1.0)


def test_env_sobrepoe_a_cadencia_calculada(monkeypatch):
    import main
    monkeypatch.delenv('COLETOR_INTERVALO_MIN', raising=False)
    assert main.intervalo_coleta(39, 630) == 43
    monkeypatch.setenv('COLETOR_INTERVALO_MIN', '8')
    assert main.intervalo_coleta(39, 630) == 8


# --- rotação e classificação de erro ----------------------------------------

def test_sucesso_devolve_segmento_e_passa_a_chave(coletor):
    coletor.session.get = lambda url, params, timeout: resposta(200, json_=SEGMENTO)
    assert coletor._fetch_tomtom_data(-15.8, -47.9) == SEGMENTO['flowSegmentData']
    assert coletor.current_key_index == 1  # round-robin


def test_429_repetido_vira_cota_24h_e_rotaciona(coletor):
    chamadas = []

    def get(url, params, timeout):
        chamadas.append(params['key'])
        return so_a_chave_1_falha(429, 'Too Many Requests')(url, params, timeout)
    coletor.session.get = get

    assert coletor._fetch_tomtom_data(-15.8, -47.9) is not None
    assert chamadas.count('segredo1') == 1 + tc.MAX_QPS_RETRIES_PER_KEY  # QPS até a 3ª, cota na 4ª
    assert chamadas[-1] == 'segredo2'
    restante = coletor.cooldown_until['k1'] - tc.time.time()
    assert tc.SECONDS_PER_DAY - 5 < restante <= tc.SECONDS_PER_DAY


def test_403_sem_texto_de_cota_e_chave_invalida_10_min(coletor):
    coletor.session.get = so_a_chave_1_falha(403, 'Forbidden')
    assert coletor._fetch_tomtom_data(-15.8, -47.9) is not None
    restante = coletor.cooldown_until['k1'] - tc.time.time()
    assert tc.COOLDOWN_CHAVE_INVALIDA - 5 < restante <= tc.COOLDOWN_CHAVE_INVALIDA


def test_403_com_texto_de_cota_e_24h(coletor):
    coletor.session.get = so_a_chave_1_falha(403, 'Quota limit exceeded')
    coletor._fetch_tomtom_data(-15.8, -47.9)
    assert coletor.cooldown_until['k1'] - tc.time.time() > tc.SECONDS_PER_DAY - 5


def test_falha_de_rede_nao_queima_chave(coletor):
    def get(url, params, timeout):
        raise tc.requests.exceptions.ConnectionError('offline')
    coletor.session.get = get
    assert coletor._fetch_tomtom_data(-15.8, -47.9) is None
    assert coletor.cooldown_until == {}


def test_todas_em_cooldown_aborta_o_ciclo_sem_rede_nem_banco(coletor, monkeypatch):
    for i in range(3):
        coletor._mark_exhausted(i)
    chamou, gravou = [], []
    coletor.session.get = lambda url, params, timeout: chamou.append(1)
    monkeypatch.setattr(tc.db_manager, 'insert_historico_batch', lambda lote: gravou.append(lote))
    coletor.collect_for_all_vias([(1, 'Eixo', -15.8, -47.9), (2, 'EPTG', -15.8, -47.9)])
    assert chamou == [] and gravou == []


def test_lote_vai_pro_banco_uma_vez_com_tipos_inteiros(coletor, monkeypatch):
    coletor.session.get = lambda url, params, timeout: resposta(200, json_=SEGMENTO)
    gravou = []
    monkeypatch.setattr(tc.db_manager, 'insert_historico_batch', lambda lote: gravou.append(lote))
    coletor.collect_for_all_vias([(1, 'Eixo', -15.8, -47.9), (2, 'EPTG', -15.8, -47.9)])
    assert gravou == [[(1, 30, 60, 120, 0.9), (2, 30, 60, 120, 0.9)]]


def test_madrugada_economiza_para_o_dia():
    assert tc.intervalo_minutos(39, 780) == 53
    assert tc.intervalo_diurno(39, 780) == 46
    # A cota por dia não muda: ciclos de dia + 2,5 de madrugada cabem no orçamento.
    orcamento = 39 * 20000 * 0.85 / 31 / 780
    assert 19 * 60 / tc.intervalo_diurno(39, 780) + 2.5 <= orcamento
    assert tc.pular_na_madrugada(3, 46) and not tc.pular_na_madrugada(3, 125)
    assert not tc.pular_na_madrugada(3, None) and not tc.pular_na_madrugada(8, 1)

