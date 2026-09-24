"""Estimativa de combustível (combustivel.py) com os parâmetros versionados."""
import os

import pytest

import combustivel

P = combustivel.carregar(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'ml', 'artifacts',
                                      'consumo_combustivel.json'))


def test_calibracao_bate_cidade_e_estrada():
    # 1 km a 25 km/h (cidade) e a 90 km/h (estrada), em km/L
    assert 1 / combustivel.litros(P, 1, 3600 / 25) == pytest.approx(10.6, abs=0.2)
    assert 1 / combustivel.litros(P, 1, 3600 / 90) == pytest.approx(14.0, abs=0.1)


def test_rota_mais_rapida_e_pouco_mais_longa_economiza():
    e = combustivel.economia(P, km_rota=14.1, seg_rota=954, km_base=13.8, seg_base=1156)
    assert e['litros'] > 0 and e['minutos'] == pytest.approx(3.4, abs=0.1)
    assert e['reais'] == pytest.approx(e['litros'] * P['preco_litro_reais'], abs=0.01)


def test_sem_baseline_nao_inventa_numero():
    assert combustivel.economia(P, 10, 600, None, None) is None
    assert combustivel.economia(None, 10, 600, 9, 700) is None


def test_mais_longa_sem_ganho_de_tempo_aparece_negativa():
    assert combustivel.economia(P, km_rota=12, seg_rota=900, km_base=10, seg_base=900)['litros'] < 0


def test_caminho_curto_vai_para_a_escala_do_tempo_exibido():
    # LIA previu 1000 s na rota e 1100 s no caminho curto; o trânsito ao vivo levou a rota a 1300 s.
    assert combustivel.base_na_escala(1100, 1000, 1300) == pytest.approx(1430)
    assert combustivel.base_na_escala(None, 1000, 1300) is None
    assert combustivel.base_na_escala(900, 0, 1300) == 900
