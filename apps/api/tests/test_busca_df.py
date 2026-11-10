"""Autocomplete do DF (routers/search.py): apelidos, acento, erro de digitação, localidades do OSM,
lojas dentro de marco, via repetida e a consulta à malha. Sem rede. Rodar a partir de apps/api: `pytest -q`.

Os nomes e coordenadas vêm de respostas reais da produção (2026-11-02) e da malha (backup 2026-09-23).
"""
import asyncio
import math
import re

import pytest

from busca_fakes import SbFalso, cand
from routers import search
from tomtom import CENTRO_BRASILIA


@pytest.fixture(autouse=True)
def _estado_limpo(monkeypatch):
    """Cache e pausa da regex são do processo: cada teste começa do zero."""
    monkeypatch.setattr(search, '_regex_pausado_ate', 0.0)
    monkeypatch.setattr(search, '_cache_malha', search.CacheTTL(3600, max_itens=512))
    monkeypatch.setattr(search, '_cache_nominatim', search.CacheTTL(3600, max_itens=64))
    search._bairro_proximo.cache_clear()


def _rank(q, cands, perto=CENTRO_BRASILIA, limite=6):
    return search.ranquear(q, cands, perto, limite, search.variantes(search.normalizar(q)))


def _nomes(saida):
    return [c['label'] for c in saida]


# --- normalização e apelidos ----------------------------------------------------

def test_normalizar_cola_letras_e_numeros():
    assert search.normalizar('SQS308') == 'sqs 308'
    assert search.normalizar('Qd5 Cj 2') == 'quadra 5 conjunto 2'
    assert search.normalizar('W3 Sul') == 'w 3 sul'
    assert search.normalizar('Pq. da Cidade') == 'parque da cidade'
    assert search.normalizar(' !!! %_ ') == ''


def test_variantes_traz_o_nome_que_a_base_usa():
    assert search.variantes('eptg') == ['eptg', 'estrada parque taguatinga']
    assert search.variantes('eptg qe 3') == ['eptg qe 3', 'estrada parque taguatinga qe 3']
    assert search.variantes('rodoviaria') == ['rodoviaria', 'rodoviaria do plano piloto']
    assert search.variantes('park shopping') == ['park shopping']
    # quem já digitou o nome por extenso não ganha "rodoviaria do plano piloto do plano piloto"
    assert search.variantes('rodoviaria do plano piloto') == ['rodoviaria do plano piloto']


def test_apelido_traz_a_estrada_pelo_nome_completo():
    cands = [
        cand('EPTG-Passarela Parque Águas', 'PARK_RECREATION_AREA', 'Taguatinga', -15.8227, -48.0224),
        {**cand('EPTG QE 1', None, 'Lúcio Costa', -15.8074, -47.9874, 'Street', 0.9), 'fonte': 'malha'},
        {**cand('Estrada Parque Taguatinga', None, 'Guará I', -15.8236, -48.0240, 'Street', 0.9), 'fonte': 'malha'},
    ]
    assert _nomes(_rank('eptg', cands))[0] == 'Estrada Parque Taguatinga'
    # sem o apelido a estrada nem aparece: "eptg" não é começo de nenhuma palavra do nome dela
    assert 'Estrada Parque Taguatinga' not in _nomes(search.ranquear('eptg', cands, CENTRO_BRASILIA, 6))


def test_rodoviaria_digitada_sozinha_acha_a_do_plano_piloto():
    cands = [cand('Rodoviária do Plano Piloto', 'PARK_RECREATION_AREA', 'Plano Piloto de Brasília', -15.7938, -47.8836)]
    assert _nomes(_rank('Rodoviária', cands)) == ['Rodoviária do Plano Piloto']


# --- erro de digitação ----------------------------------------------------------

@pytest.mark.parametrize('digitado,nome', [
    ('conjunto nacioal', 'Shopping Conjunto Nacional'),   # letra faltando
    ('shoping', 'Park Shopping'),                          # letra faltando
    ('parkshoping', 'Park Shopping'),                      # palavras coladas + letra faltando
    ('parkshopping', 'Park Shopping'),                     # só colado
    ('aeroproto', 'Aeroporto Internacional de Brasília'),  # letras trocadas
])
def test_erro_de_digitacao_ainda_casa(digitado, nome):
    cands = [cand(nome, 'SHOPPING_CENTER')]
    assert _nomes(_rank(digitado, cands)) == [nome]


def test_palavras_coladas_sem_erro_valem_como_nome_inteiro():
    shopping = cand('Park Shopping', 'SHOPPING_CENTER', 'Guará', -15.8338, -47.9561)
    loja = cand('Lacoste Park Shopping', 'SHOP', 'Guará', -15.8337, -47.9524)
    assert _nomes(_rank('parkshopping', [loja, shopping])) == ['Park Shopping']   # a loja só "contém" o texto
    # nome inteiro (mesmo colado) ganha de "começa com", ainda que o outro esteja bem mais perto
    longe = cand('Park Shopping', lat=-15.90, lon=-47.80)
    perto = cand('Park Shopping Sul', lat=-15.80, lon=-47.89)
    assert _nomes(_rank('parkshopping', [perto, longe]))[0] == 'Park Shopping'


def test_nome_exato_ganha_do_aproximado():
    cands = [cand('Iguatemy Brasília', lat=-15.76, lon=-47.88), cand('Iguatemi Brasília', lat=-15.76, lon=-47.88)]
    assert _nomes(_rank('iguatemi', cands)) == ['Iguatemi Brasília', 'Iguatemy Brasília']


def test_palavra_curta_nao_ganha_tolerancia():
    # 4 letras: "park" não vira "pork"; o fuzzy da TomTom não passa só por ter a mesma inicial
    assert _rank('park', [cand('Pork House'), cand('Perk Cafe')]) == []
    assert search._casa(['park'], ['pork']) is None and search._casa(['shoping'], ['shopping']) == 'aprox'
    assert not search._quase('hospital', 'cospital')  # a 1ª letra não muda


def test_acento_no_candidato_e_na_consulta():
    cands = [cand('Avenida Hélio Prates', None, 'Taguatinga', tipo='Street')]
    for q in ('helio prates', 'HÉLIO PRATES', 'Hélio Prates', 'av helio'):
        assert _nomes(_rank(q, cands)) == ['Avenida Hélio Prates'], q


# --- o que sobe e o que sai -----------------------------------------------------

def test_nome_de_regiao_nao_perde_para_escola_que_o_cita():
    # TomTom: tudo que contém "Ceilândia" nota ~0,99; a Região (OSM) tem de vir primeiro.
    regiao = search._lugares(['ceilandia'], CENTRO_BRASILIA)
    cands = regiao + [
        cand('ISB Escola de Beleza-Ceilândia', 'SCHOOL', 'Plano Piloto de Brasília', -15.7976, -47.8864),
        cand('Ced 15 de Ceilândia', 'SCHOOL', 'Plano Piloto de Brasília', -15.8000, -47.9002),
        cand('Administração Regional de Ceilândia', 'GOVERNMENT_OFFICE', 'Plano Piloto de Brasília', -15.7622, -47.8942),
    ]
    saida = _rank('ceilandia', cands)
    assert (saida[0]['label'], search.categoria(saida[0])) == ('Ceilândia', 'Região')
    # sem o nome por inteiro, a escola que cita a cidade não ganha bônus de "marco"
    assert saida[0]['_bonus'] > 0 and next(c for c in saida if c['label'].startswith('ISB'))['_bonus'] == 0


def test_lojas_dentro_do_shopping_saem_e_o_shopping_fica():
    shopping = cand('Shopping Conjunto Nacional', 'SHOPPING_CENTER', 'Asa Norte', -15.7909, -47.8835)
    lojas = [cand(n, c, 'Plano Piloto de Brasília', -15.7919, -47.8828) for n, c in [
        ('Dentalis - Conjunto Nacional', None), ('Coquetel (Conjunto Nacional)', 'SHOP'),
        ('Peixe na Rede Conjunto Nacional', 'RESTAURANT'), ("Bob's Shopping Conjunto Nacional Brasília", 'RESTAURANT')]]
    assert _nomes(_rank('conjunto nacional', [shopping] + lojas)) == ['Shopping Conjunto Nacional']
    # quem busca a LOJA acha a loja: o shopping não casa com o texto
    assert _nomes(_rank('dentalis', [shopping] + lojas)) == ['Dentalis - Conjunto Nacional']


def test_setores_do_hospital_saem_mas_outro_hospital_perto_fica():
    base = cand('Hospital de Base', 'HOSPITAL_POLYCLINIC', 'Plano Piloto de Brasília', -15.8000, -47.8901)
    setores = [cand(n, 'HOSPITAL_POLYCLINIC', 'Plano Piloto de Brasília', -15.7995, -47.8890,
                    sublabel=f'{n} - Hospital de Base do Distrito Federal')
               for n in ('CARDIOLOGIA', 'Psiquiatria', 'Unidade de Cuidados Paliativos')]
    assert _nomes(_rank('hospital de base', [base] + setores)) == ['Hospital de Base']
    # outro hospital a 150 m que também bate forte com o que foi digitado não é "parte" do primeiro
    outro = cand('Hospital Santa Lúcia', 'HOSPITAL_POLYCLINIC', 'Plano Piloto de Brasília', -15.8012, -47.8899)
    assert set(_nomes(_rank('hospital', [base, outro]))) == {'Hospital de Base', 'Hospital Santa Lúcia'}


def test_loja_colada_no_aeroporto_sai_mas_a_de_800_m_fica():
    # aqui o corte relativo não ajuda (a nota do aeroporto é só 1,4 acima): é a regra do "dentro do marco"
    aeroporto = cand('Internacional de Brasília-Presidente Juscelino Kubitschek', 'AIRPORT', 'Lago Sul', -15.8697, -47.9310)
    colada = cand('Primavia - Aeroporto', None, 'Lago Sul', -15.8710, -47.9294)       # ~200 m
    longe = cand('Drogaria Brasil Aeroporto', 'PHARMACY', 'Lago Sul', -15.8709, -47.9215)   # ~1,6 km
    saida = _nomes(_rank('aeroporto', [aeroporto, colada, longe]))
    assert saida[0].startswith('Internacional') and 'Primavia - Aeroporto' not in saida and 'Drogaria Brasil Aeroporto' in saida


def test_aglomeracao_so_conta_para_quem_e_o_nome():
    # 4 lojas que citam "sunrise" coladas umas nas outras não passam à frente do hotel que se chama Sunrise
    hotel = cand('Sunrise Hotel', 'HOTEL_MOTEL', 'Asa Sul', -15.82, -47.90)
    lojas = [cand(f'Loja do Sunrise {i}', 'SHOP', 'Asa Norte', -15.76 + i * 0.0002, -47.88) for i in range(4)]
    assert _nomes(_rank('sunrise', lojas + [hotel]))[0] == 'Sunrise Hotel'


def test_no_maximo_tres_vias_com_o_mesmo_nome_mesmo_longe_umas_das_outras():
    ruas = [{**cand('Rua 1', None, f'RA {i}', -15.70 - i * 0.05, -47.90 - i * 0.05, 'Street', 0.9), 'fonte': 'malha'} for i in range(6)]
    assert len(_rank('rua 1', ruas, limite=10)) == 3


def test_categoria_digitada_vale_como_marco():
    cands = [cand('Farmácia Hospital Taguatinga', 'PHARMACY', 'Taguatinga', -15.84, -48.05),
             cand('Hospital Regional de Taguatinga', 'HOSPITAL_POLYCLINIC', 'Taguatinga', -15.84, -48.04)]
    assert _nomes(_rank('hospital taguatinga', cands))[0] == 'Hospital Regional de Taguatinga'


def test_hospital_no_lago_sul_nao_e_o_lago_sul():
    cands = search._lugares(['lago sul'], CENTRO_BRASILIA) + [
        cand('Hospital Lago Sul', 'HOSPITAL_POLYCLINIC', 'Lago Sul', -15.8416, -47.8862),
        cand('Lago Sul', None, 'Lago Sul', -15.8404, -47.8868)]
    saida = _rank('lago sul', cands)
    assert (saida[0]['label'], search.categoria(saida[0])) == ('Lago Sul', 'Região')
    assert 'Hospital Lago Sul' not in _nomes(saida)[:1]
    # sozinho, o hospital continua achável: contém o texto, só não é "o nome"
    assert _nomes(_rank('lago sul', [cands[-2]])) == ['Hospital Lago Sul']


def test_mesma_via_repetida_vira_no_maximo_tres_trechos_afastados():
    # "w3 sul" voltava 8x a mesma avenida, uma por "bairro" (superquadra vizinha)
    trechos = [{**cand('W3 Sul', None, f'SQS {300 + i}', -15.797 - 0.004 * i, -47.891 - 0.004 * i, 'Street', 0.9),
                'fonte': 'malha'} for i in range(8)]
    saida = _rank('w3 sul', trechos)
    assert 1 < len(saida) <= 3
    for i, a in enumerate(saida):
        for b in saida[i + 1:]:
            assert search._km(a, b) >= 1.5


def test_mesmo_nome_a_menos_de_600_m_e_um_so():
    cands = [cand('Esplanada dos Ministérios', 'GOVERNMENT_OFFICE', lat=-15.7963, lon=-47.8751),
             cand('Esplanada dos Ministérios', None, lat=-15.7948, lon=-47.8718),   # 330 m do outro
             cand('Esplanada dos Ministérios', None, lat=-15.7880, lon=-47.9015)]   # 3 km: fica
    assert len(_rank('esplanada', cands)) == 2


def test_homonimo_longe_nao_perde_pela_distancia_sozinha():
    # a penalidade de distância para em 15 km: 25 km ou 40 km é tudo "longe"
    perto = cand('Park Shopping', 'SHOPPING_CENTER', lat=-15.80, lon=-47.89)
    longe = cand('Park Shopping', 'SHOPPING_CENTER', lat=-16.05, lon=-48.20)
    a, b = (search.ranquear('park shopping', [longe, perto], CENTRO_BRASILIA, 2)[0],
            search.ranquear('park shopping', [longe, perto], (-16.0, -48.1), 2)[0])
    assert (a['lat'], b['lat']) == (-15.80, -16.05)


# --- localidades do OSM (sem rede) ----------------------------------------------

def test_localidades_regiao_e_bairros_com_a_regiao_no_sublabel():
    achados = {(c['label'], c['categoria_codigo'], c['sublabel']) for c in search._lugares(['ceilandia'], CENTRO_BRASILIA)}
    assert ('Ceilândia', 'REGIAO', '') in achados
    assert ('Ceilândia Norte', 'BAIRRO', 'Ceilândia') in achados


def test_localidades_superquadra_fica_no_plano_piloto():
    (sqs,) = search._lugares(['sqs 308'], CENTRO_BRASILIA)
    assert (sqs['label'], sqs['sublabel'], sqs['fonte']) == ('SQS 308', 'Plano Piloto', 'malha')


def test_bairro_proximo_confere_com_a_varredura_linear():
    search._carregar_bairros()
    for lat, lon in [(-15.7940, -47.8828), (-15.8340, -48.0566), (-15.8715, -47.9223), (-15.9, -47.79), (-16.0, -48.2)]:
        alvo = {'lat': lat, 'lon': lon}
        melhor = min(search._bairros, key=lambda b: search._km(alvo, b))
        esperado = melhor['nome'] if search._km(alvo, melhor) <= 3.0 else None
        assert search._bairro_proximo(lat, lon) == esperado


# --- malha_completa -------------------------------------------------------------

def _malha(sb, q):
    return asyncio.run(search._malha(sb, q))


def test_malha_sem_acento_acha_nome_acentuado():
    sb = SbFalso()
    for q in ('helio prates', 'Hélio Prates', 'HELIO'):
        assert [i['label'] for i in _malha(sb, q)] == ['Avenida Hélio Prates'], q
    assert sb.consultas[0][0] == 'imatch'


def test_malha_sigla_cola_numero_e_acha_com_espaco():
    assert [i['label'] for i in _malha(SbFalso(), 'sqs308')] == ['SQS 308']
    assert [i['label'] for i in _malha(SbFalso(), 'w3')] == ['W3 Sul']


def test_malha_apelido_consulta_tambem_o_nome_completo():
    sb = SbFalso()
    nomes = {i['label'] for i in _malha(sb, 'EPTG')}
    assert nomes == {'EPTG QE 1', 'Marginal Sul EPTG', 'Estrada Parque Taguatinga'}
    assert len(sb.consultas) == 2   # uma para a sigla, outra para o nome por extenso
    assert _malha(SbFalso(), 'eixao')[0]['label'] == 'Eixo Rodoviário Norte'


def test_malha_cache_poupa_o_banco_na_mesma_consulta():
    sb = SbFalso()
    assert _malha(sb, 'sqs 308') == _malha(sb, 'SQS  308')
    assert len(sb.consultas) == 1


def test_malha_item_tem_bairro_e_tipo_da_via():
    (item,) = _malha(SbFalso(), 'sqs 308')
    assert item['fonte'] == 'malha' and item['tipo'] == 'Street' and item['id_ponto'] == 6
    assert item['sublabel'].endswith('Via residencial') and item['bairro'] == search._bairro_proximo(-15.8144, -47.9059)


def test_malha_volta_para_ilike_quando_o_postgrest_recusa_a_regex(caplog):
    sb = SbFalso(regex_ok=False)
    assert [i['label'] for i in _malha(sb, 'sqs 308')] == ['SQS 308']
    assert [op for op, _ in sb.consultas] == ['imatch', 'ilike']
    assert search._regex_pausado_ate > 0 and 'imatch recusado' in caplog.text
    sb.consultas.clear()
    _malha(sb, 'w3')   # na pausa nem tenta a regex
    assert [op for op, _ in sb.consultas] == ['ilike']


def test_queda_de_conexao_na_regex_tenta_de_novo_e_nao_desliga_o_imatch(caplog):
    sb = SbFalso(quedas=1)
    assert [i['label'] for i in _malha(sb, 'sqs 308')] == ['SQS 308']
    assert [op for op, _ in sb.consultas] == ['imatch', 'imatch']
    assert search._regex_pausado_ate == 0 and 'imatch recusado' not in caplog.text


def test_duas_quedas_seguidas_usam_ilike_so_nesta_consulta(caplog):
    sb = SbFalso(quedas=2)
    assert [i['label'] for i in _malha(sb, 'sqs 308')] == ['SQS 308']
    assert [op for op, _ in sb.consultas] == ['imatch', 'imatch', 'ilike']
    assert search._regex_pausado_ate == 0 and 'imatch recusado' not in caplog.text


def test_malha_banco_fora_do_ar_devolve_vazio():
    class SbQuebrado(SbFalso):
        def table(self, nome):
            raise ConnectionError('Supabase fora')

    assert _malha(SbQuebrado(), 'sqs 308') == []


def test_malha_regex_so_leva_o_que_o_usuario_digitou_em_letras_e_numeros():
    sb = SbFalso()
    _malha(sb, r'a.*(b|c)\ x%_ [z] sqs308')
    assert sb.consultas
    for _, regex in sb.consultas:
        sem_separador = regex.replace(search.SEPARADOR, '')   # o único \ que a regex pode ter é o nosso \s
        assert search.SEPARADOR in regex                       # "sqs308" levou o separador entre letras e número
        assert re.fullmatch(r'[A-Za-z0-9\[\]À-ÿ.*]*', sem_separador), regex
        assert not set(r'()|\%_') & set(sem_separador)      # nada de ( ) | \ % _ do usuário


def test_malha_ilike_nao_deixa_curinga_do_usuario():
    sb = SbFalso(regex_ok=False)
    _malha(sb, 'eptg%_x qd 5')
    assert ('ilike', '%eptg%x%quadra%5%') in sb.consultas


def test_malha_so_pontuacao_nao_consulta_nada():
    sb = SbFalso()
    assert _malha(sb, ' %_ -- ') == [] and sb.consultas == []


# --- Nominatim: resposta torta não derruba -------------------------------------

def test_nominatim_resposta_torta_vira_lista_vazia(monkeypatch):
    class Resp:
        status_code = 200

        def __init__(self, corpo):
            self._corpo = corpo

        def json(self):
            if isinstance(self._corpo, Exception):
                raise self._corpo
            return self._corpo

    def cliente_com(corpo):
        class Cli:
            def __init__(self, **_):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_):
                return False

            async def get(self, *_, **__):
                return Resp(corpo)
        return Cli

    for corpo in (ValueError('json inválido'), [{'display_name': 'Algo, DF'}], [{'display_name': 'Algo', 'lat': 'x', 'lon': 'y'}], {'erro': 1}):
        monkeypatch.setattr(search, '_ultima_nominatim', 0.0)
        monkeypatch.setattr(search.httpx, 'AsyncClient', cliente_com(corpo))
        assert asyncio.run(search._nominatim('algo longe', 5)) == []
    monkeypatch.setattr(search, '_ultima_nominatim', 0.0)
    monkeypatch.setattr(search.httpx, 'AsyncClient',
                        cliente_com([{'display_name': 'Torre de TV, Brasília, DF', 'lat': '-15.79', 'lon': '-47.89'}]))
    (item,) = asyncio.run(search._nominatim('torre', 5))
    assert item['label'] == 'Torre de TV' and math.isclose(item['lat'], -15.79)
    monkeypatch.setattr(search, '_ultima_nominatim', 0.0)
    monkeypatch.setattr(search.httpx, 'AsyncClient', cliente_com([{
        'display_name': 'Via Brisa, 14, Avenida Pau Brasil, Águas Claras, Distrito Federal', 'lat': '-15.836', 'lon': '-48.021',
        'address': {'building': 'Via Brisa', 'house_number': '14', 'road': 'Avenida Pau Brasil', 'suburb': 'Águas Claras'}}]))
    (item,) = asyncio.run(search._nominatim('avenida pau brasil 14', 5))
    assert item['label'] == 'Avenida Pau Brasil, 14' and item['sublabel'] == 'Via Brisa · Águas Claras' and item['tipo'] == 'Point Address'


def test_apelidos_de_marcos_da_bateria_de_2026_11_03():
    """Jeito de falar → nome que a base usa; a forma original continua sendo a 1ª variante."""
    from routers.search import normalizar, variantes
    casos = {
        'museu nacional da republica': 'museu nacional',
        'igreja dom bosco': 'santuario dom bosco',
        'hospital universitario unb': 'hospital universitario de brasilia',
        'serejao taguatinga': 'estadio serejao',
        'terraco shopping sudoeste': 'terraco shopping',
        'agua claras shopping': 'aguas claras shopping',
        'planalto brasilia': 'palacio do planalto',
    }
    for consulta, esperada in casos.items():
        v = variantes(normalizar(consulta))
        assert v[0] == normalizar(consulta) and esperada in v, (consulta, v)
