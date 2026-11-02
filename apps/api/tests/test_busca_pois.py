"""Pontos de interesse do OSM na busca (ml/artifacts/pois_df.json): o que a bateria de 2026-11-02 não achava."""
import time

import pytest

from routers import search

PERTO = search.CENTRO_BRASILIA


def _busca(q, limite=5):
    qn = search.normalizar(q)
    vs = search.variantes(qn)
    candidatos = search._lugares(vs, PERTO) + search._pontos(vs, PERTO)
    return search.ranquear(q, candidatos, PERTO, limite, vs)


@pytest.fixture(autouse=True)
def _pois_carregados():
    if not search._carregar_pois():
        pytest.skip('ml/artifacts/pois_df.json ausente')


@pytest.mark.parametrize('q, esperado', [
    ('estação galeria', 'Estação Galeria'),
    ('metro 112 sul', 'Estação 112 Sul'),
    ('112 sul metro', 'Estação 112 Sul'),
    ('estacao praca do relogio', 'Estação Praça do Relógio'),
    ('estacao concesionarias', 'Estação Concessionárias'),   # erro de digitação
])
def test_estacao_de_metro_aparece_primeiro(q, esperado):
    saida = _busca(q)
    assert saida and saida[0]['label'] == esperado and search.categoria(saida[0]) == 'Estação'


def test_nome_da_regiao_continua_sendo_a_regiao_e_nao_a_estacao():
    saida = _busca('guara')
    assert saida[0]['categoria_codigo'] == 'REGIAO'


def test_qualificador_df_no_fim_nao_zera_a_busca():
    assert search.variantes('hospital de base do df')[:2] == ['hospital de base do df', 'hospital de base']
    assert search.variantes('df') == ['df']                      # só o qualificador: fica como está
    assert _busca('hospital de base do df')[0]['label'] == 'Hospital de Base do Distrito Federal'


def test_custo_por_tecla_fica_baixo():
    t0 = time.perf_counter()
    for q in ('estacao', 'shopping', 'hospital regional', 'parque da cidade', 'torre de tv'):
        _busca(q)
    assert (time.perf_counter() - t0) / 5 < 0.25   # média por consulta, sem rede


def test_mesmas_palavras_em_outra_ordem_contam_como_nome_exato():
    perto = (-15.7956, -47.8920)
    longe = {'label': 'Shopping Pátio Brasil', 'lat': -15.96, 'lon': -47.95, 'score': 0.99, 'categoria_codigo': 'SHOPPING_CENTER'}
    certo = {'label': 'Pátio Brasil Shopping', 'lat': -15.7961, 'lon': -47.8920, 'score': 0.99, 'categoria_codigo': 'SHOPPING_CENTER'}
    assert search.ranquear('shopping patio brasil', [longe, certo], perto, 2)[0]['label'] == 'Pátio Brasil Shopping'


@pytest.mark.parametrize('q, esperado', [('torre de televisao', 'torre de tv'), ('memorial juscelino kubitschek', 'memorial jk')])
def test_apelido_por_extenso_vira_a_sigla_da_base(q, esperado):
    assert esperado in search.variantes(q)


@pytest.mark.parametrize('q, esperado', [
    ('estacao 102 sull', 'Estação 102 Sul'),
    ('estacao ceilandia nrte', 'Estação Ceilândia Norte'),
    ('stacao 108 sul', 'Estação 108 Sul'),
    ('hospital de bse', 'Hospital de Base do Distrito Federal'),
])
def test_um_erro_em_palavra_curta_ainda_acha(q, esperado):
    assert _busca(q)[0]['label'] == esperado


def test_erro_em_numero_nao_vira_outro_lugar():
    assert all(c['label'] != 'Estação 112 Sul' for c in _busca('estacao 113 sul'))


def test_bairro_no_fim_vira_variante_sem_ele():
    assert 'pier 21' in search.variantes('pier 21 lago sul')
    assert search.variantes('parque aguas claras') == ['parque aguas claras']   # sobraria 1 palavra: fica inteiro
    assert _busca('pier 21 lago sul')[0]['label'] == 'Pier 21'


def test_sobra_generica_nao_vira_variante():
    # Bateria de produção 2026-11-02: "hospital de taguatinga" virava "hospital de" e trazia o Hospital de Base.
    assert search.variantes('hospital de taguatinga') == ['hospital de taguatinga']
    assert search.variantes('hospital da asa norte') == ['hospital da asa norte']
    assert 'Hospital de Base' not in [c['label'] for c in _busca('hospital de taguatinga')][:1]
