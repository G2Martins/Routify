import gzip
import os

import coletar_gps_onibus as gps

AGORA = 1_800_000_000


def _veiculo(**kw):
    v = {'numero': '340995', 'horario': (AGORA - 30) * 1000, 'localizacao': {'latitude': -15.9, 'longitude': -48.1},
         'velocidade': {'valor': 32.5}, 'direcao': 26.56, 'valid': True}
    v.update(kw)
    return v


def test_filtra_posicao_invalida_velha_e_fora_do_df():
    dados = [{'operadora': {'sigla': 'HP'}, 'veiculos': [
        _veiculo(),
        _veiculo(valid=False),
        _veiculo(horario=(AGORA - 3600) * 1000),
        _veiculo(localizacao={'latitude': -23.5, 'longitude': -46.6}),
        _veiculo(velocidade={'valor': None}),
        _veiculo(velocidade={'valor': 400}),
    ]}]
    assert gps.linhas(dados, AGORA) == [(AGORA - 30, 'HP', '340995', -15.9, -48.1, 32.5, 27)]


def test_resposta_vazia_nao_quebra():
    assert gps.linhas(None, AGORA) == [] and gps.linhas([{'operadora': None, 'veiculos': None}], AGORA) == []


def test_grava_acumulando_no_mesmo_dia_e_poda_o_antigo(tmp_path):
    gps.gravar(str(tmp_path), [(1, 'A', '1', -15.9, -48.1, 10.0, 0)], '2026-11-09')
    gps.gravar(str(tmp_path), [(2, 'A', '1', -15.9, -48.1, 20.0, 0)], '2026-11-09')
    with gzip.open(tmp_path / '2026-11-09.csv.gz', 'rt', encoding='utf-8') as f:
        assert len(f.read().strip().splitlines()) == 2
    antigo = tmp_path / '2026-01-01.csv.gz'
    antigo.write_bytes(b'x')
    os.utime(antigo, (AGORA - 90 * 86400, AGORA - 90 * 86400))
    gps.podar(str(tmp_path), AGORA)
    assert not antigo.exists()
