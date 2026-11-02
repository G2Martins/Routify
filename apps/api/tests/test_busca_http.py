"""GET /search/places pelo HTTP (TestClient): contrato, validação, limite por IP, fontes que caem e a
política do Nominatim. Sem rede: Supabase, TomTom e Nominatim são fakes (busca_fakes.py).
Rodar a partir de apps/api: `pytest -q`.
"""
import pytest

from busca_fakes import SbFalso, TomTomFalso, cand, cliente
from routers import search
from seguranca import Limitador
from tomtom import CENTRO_BRASILIA

CHAVES = {'label', 'sublabel', 'lat', 'lon', 'source', 'categoria', 'id_ponto'}

PARK = {'park shopping': [
    cand('Park Shopping', 'SHOPPING_CENTER', 'Guará', -15.83377, -47.95606),
    cand('Park Shopping', 'SHOPPING_CENTER', 'São Sebastião', -15.90079, -47.79023),
    cand('Lacoste Park Shopping', 'SHOP', 'Guará', -15.83370, -47.95244),
]}


@pytest.fixture(autouse=True)
def _estado_limpo(monkeypatch):
    monkeypatch.setattr(search, '_limite_ip', Limitador(90))
    monkeypatch.setattr(search, '_regex_pausado_ate', 0.0)
    monkeypatch.setattr(search, '_cache_malha', search.CacheTTL(3600, max_itens=512))
    monkeypatch.setattr(search, '_cache_nominatim', search.CacheTTL(3600, max_itens=64))
    # Os pontos de interesse do OSM (pois_df.json) têm teste próprio: aqui só as fontes remotas e a malha.
    monkeypatch.setattr(search, '_pontos', lambda *a, **k: [])
    search._bairro_proximo.cache_clear()


@pytest.fixture
def nominatim(monkeypatch):
    """Troca o Nominatim por um fake que conta as chamadas (a rede nunca é tocada)."""
    chamadas = []

    async def falso(q, limite):
        chamadas.append(q)
        return [{'label': 'Torre de TV', 'sublabel': 'Brasília, DF', 'lat': -15.7904, 'lon': -47.8939, 'score': 0.5}]

    monkeypatch.setattr(search, '_nominatim', falso)
    return chamadas


def _get(cli, q, **params):
    return cli.get('/search/places', params={'q': q, **params})


def test_contrato_campos_e_fontes():
    cli = cliente(SbFalso(), TomTomFalso(PARK))
    r = _get(cli, 'park shopping', limit=6, lat=-15.90, lon=-47.78)
    assert r.status_code == 200
    saida = r.json()
    assert all(set(x) == CHAVES for x in saida)
    assert {x['source'] for x in saida} <= {'malha', 'tomtom', 'nominatim'}
    assert [x['label'] for x in saida] == ['Park Shopping', 'Park Shopping']   # a loja que cita o shopping saiu
    assert saida[0]['sublabel'] == 'São Sebastião' and saida[0]['categoria'] == 'Shopping'   # quem busca está lá


def test_resposta_mistura_malha_localidade_e_tomtom():
    cli = cliente(SbFalso(), TomTomFalso({'sqs 308': [cand('SQS 308', None, 'Plano Piloto de Brasília', -15.8144, -47.9059, 'Street')]}))
    saida = _get(cli, 'SQS308').json()
    assert [(x['label'], x['source']) for x in saida][0][0] == 'SQS 308'   # sigla colada vira "sqs 308"
    saida = _get(cli, 'ceilandia').json()
    assert (saida[0]['label'], saida[0]['categoria'], saida[0]['source']) == ('Ceilândia', 'Região', 'malha')


def test_limit_e_respeitado():
    muitos = {'rua': [cand(f'Rua {i}', None, f'Bairro {i}', -15.80 - i * 0.01, -47.90, 'Street') for i in range(10)]}
    assert len(_get(cliente(None, TomTomFalso(muitos)), 'rua', limit=3).json()) == 3


@pytest.mark.parametrize('params', [
    {'q': 'a'},                                # 1 caractere
    {'q': 'x' * 121},                          # além do máximo
    {'q': 'park', 'limit': 0},
    {'q': 'park', 'limit': 16},
    {'q': 'park', 'lat': -10.0, 'lon': -47.9},  # fora do DF
    {'q': 'park', 'lat': -15.8, 'lon': -50.0},
])
def test_parametros_invalidos_sao_422(params):
    assert cliente(SbFalso(), TomTomFalso()).get('/search/places', params=params).status_code == 422


def test_so_pontuacao_nao_gasta_fonte_nenhuma(nominatim):
    sb, tt = SbFalso(), TomTomFalso()
    r = _get(cliente(sb, tt), ' %_ -- ')
    assert (r.status_code, r.json()) == (200, [])
    assert sb.consultas == [] and tt.chamadas == [] and nominatim == []


def test_consulta_enorme_nao_derruba():
    r = _get(cliente(SbFalso(), TomTomFalso()), 'a ' * 60)
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_limite_por_ip_429_com_retry_after(monkeypatch):
    monkeypatch.setattr(search, '_limite_ip', Limitador(2))
    cli = cliente(SbFalso(), TomTomFalso())
    assert [_get(cli, 'park').status_code for _ in range(2)] == [200, 200]
    r = _get(cli, 'park')
    assert r.status_code == 429 and int(r.headers['Retry-After']) >= 1


def test_tomtom_que_quebra_nao_derruba_a_malha():
    cli = cliente(SbFalso(), TomTomFalso(erro=RuntimeError('boom')))
    r = _get(cli, 'sqs 308')
    assert r.status_code == 200 and [x['label'] for x in r.json()] == ['SQS 308']


def test_malha_que_quebra_nao_derruba_a_tomtom():
    class SbQuebrado(SbFalso):
        def table(self, nome):
            raise ConnectionError('Supabase fora')

    cli = cliente(SbQuebrado(), TomTomFalso(PARK))
    assert [x['label'] for x in _get(cli, 'park shopping').json()][0] == 'Park Shopping'


def test_texto_vai_normalizado_para_a_tomtom_e_o_vies_junto():
    tt = TomTomFalso()
    _get(cliente(None, tt), 'Park-Shopping', lat=-15.9, lon=-47.8)
    assert tt.chamadas == ['park shopping'] and tt.pertos == [(-15.9, -47.8)]
    tt2 = TomTomFalso()
    _get(cliente(None, tt2), 'park shopping')
    assert tt2.pertos == [CENTRO_BRASILIA]


def test_tomtom_recebe_sigla_colada_como_foi_digitada():
    # a TomTom indexa "W3 Norte" e "SQS 308": letra+número separados só valem no ranking local
    for digitado, enviado in [('W3 Sul', 'w3 sul'), ('SQS308', 'sqs308'), ('Qd 5 Águas', 'quadra 5 aguas')]:
        tt = TomTomFalso()
        _get(cliente(None, tt), digitado)
        assert tt.chamadas == [enviado], digitado


def test_apelido_consulta_a_tomtom_duas_vezes_e_acha_a_rodoviaria():
    rodo = cand('Rodoviária do Plano Piloto', 'PARK_RECREATION_AREA', 'Plano Piloto de Brasília', -15.7938, -47.8836)
    tt = TomTomFalso({'rodoviaria do plano piloto': [rodo]})
    saida = _get(cliente(None, tt), 'Rodoviária').json()   # digitada sozinha e com acento
    assert tt.chamadas == ['rodoviaria', 'rodoviaria do plano piloto']
    assert [x['label'] for x in saida] == ['Rodoviária do Plano Piloto']


# --- Nominatim: sempre por último ------------------------------------------------

def test_nominatim_nao_e_chamado_com_tres_resultados_bons(nominatim):
    tres = {'park shopping': [cand('Park Shopping', 'SHOPPING_CENTER', b, la, lo)
                              for b, la, lo in [('Guará', -15.83, -47.95), ('Taguatinga', -15.83, -48.04), ('São Sebastião', -15.90, -47.79)]]}
    assert len(_get(cliente(SbFalso(), TomTomFalso(tres)), 'park shopping').json()) == 3
    assert nominatim == []


def test_nominatim_entra_quando_sobram_menos_de_tres_e_a_consulta_tem_4_letras(nominatim):
    saida = _get(cliente(SbFalso(), TomTomFalso()), 'torre de tv').json()
    assert nominatim == ['torre de tv']
    assert [(x['label'], x['source']) for x in saida] == [('Torre de TV', 'nominatim')]


def test_nominatim_entra_mesmo_com_lixo_fuzzy_da_tomtom(nominatim):
    # 5 resultados da TomTom que não casam com nada do digitado: o ranking os descarta, e o
    # último recurso tem de ter a vez (antes o 5 >= 3 bloqueava o Nominatim e a lista vinha vazia)
    lixo = {'torre de tv': [cand(f'Banco {i}', 'BANK', f'B{i}', -15.80 - i * 0.01, -47.90) for i in range(5)]}
    saida = _get(cliente(SbFalso(), TomTomFalso(lixo)), 'torre de tv').json()
    assert nominatim == ['torre de tv'] and [x['source'] for x in saida] == ['nominatim']


def test_nominatim_nao_e_chamado_para_consulta_curta(nominatim):
    assert _get(cliente(None, TomTomFalso()), 'zzz').json() == [] and nominatim == []


def test_sem_supabase_nem_tomtom_so_resta_o_nominatim(nominatim):
    saida = _get(cliente(None, None), 'torre de tv').json()
    assert [x['source'] for x in saida] == ['nominatim']
