"""Uso das chaves no coletor (tomtom_uso_dia): conta cada resposta da TomTom por chave, envia no fim do ciclo como
'coletor', e nem o envio nem a contagem podem atrapalhar a coleta do dataset."""
import pytest

import traffic_collector as tc
from test_rotacao import SEGMENTO, coletor, resposta  # noqa: F401  (fixture)

VIAS = [(1, 'Eixo', -15.8, -47.9), (2, 'EPTG', -15.8, -47.9)]


def test_ciclo_conta_por_chave_e_envia_como_coletor(coletor, monkeypatch):  # noqa: F811
    respostas = iter([resposta(200, json_=SEGMENTO), resposta(429, 'rate'), resposta(200, json_=SEGMENTO)])
    coletor.session.get = lambda url, params, timeout: next(respostas)
    enviados = []
    monkeypatch.setattr(tc.db_manager, 'insert_historico_batch', lambda lote: None)
    monkeypatch.setattr(tc.db_manager, 'registrar_uso_tomtom', lambda origem, linhas: enviados.append((origem, linhas)))
    coletor.collect_for_all_vias(VIAS)
    assert enviados == [('coletor', [
        {'chave_id': 'k1', 'servico': 'fluxo', 'chamadas': 1, 'falhas': 0, 'ultimo_status': 200, 'cooldown_ate': None},
        {'chave_id': 'k2', 'servico': 'fluxo', 'chamadas': 2, 'falhas': 1, 'ultimo_status': 200, 'cooldown_ate': None},
    ])]
    assert coletor.uso == {}


def test_envio_que_falha_nao_para_a_coleta_e_fica_para_o_proximo_ciclo(coletor, monkeypatch):  # noqa: F811
    coletor.session.get = lambda url, params, timeout: resposta(200, json_=SEGMENTO)
    gravou = []
    monkeypatch.setattr(tc.db_manager, 'insert_historico_batch', lambda lote: gravou.append(lote))

    def fora(origem, linhas):
        raise RuntimeError('supabase fora')
    monkeypatch.setattr(tc.db_manager, 'registrar_uso_tomtom', fora)
    coletor.collect_for_all_vias(VIAS[:1])
    assert len(gravou) == 1  # o lote do dataset foi salvo
    assert coletor.uso == {'k1': [1, 0, 200]}


def test_falha_ao_salvar_o_lote_ainda_envia_o_uso_e_propaga_o_erro(coletor, monkeypatch):  # noqa: F811
    coletor.session.get = lambda url, params, timeout: resposta(200, json_=SEGMENTO)
    enviados = []

    def banco_fora(lote):
        raise RuntimeError('insert falhou')
    monkeypatch.setattr(tc.db_manager, 'insert_historico_batch', banco_fora)
    monkeypatch.setattr(tc.db_manager, 'registrar_uso_tomtom', lambda origem, linhas: enviados.append(origem))
    with pytest.raises(RuntimeError):
        coletor.collect_for_all_vias(VIAS[:1])
    assert enviados == ['coletor']


def test_falha_de_rede_conta_e_nao_loga_a_url_com_a_chave(coletor, caplog):  # noqa: F811
    def get(url, params, timeout):
        raise tc.requests.exceptions.ConnectionError(f"Max retries exceeded with url: /flow?key={params['key']}")
    coletor.session.get = get
    assert coletor._fetch_tomtom_data(-15.8, -47.9) is None
    assert coletor.uso == {'k1': [1, 1, 0]}
    assert 'segredo' not in caplog.text
