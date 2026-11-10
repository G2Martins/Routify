"""Ranking do autocomplete (routers/search.py): caso real "park shopping" (2026-09-23)."""
import asyncio

import pytest

from routers import search
from tomtom import CENTRO_BRASILIA


@pytest.fixture(autouse=True)
def _estado_limpo(monkeypatch):
    """A pausa da regex e o cache da malha são do processo: um teste não pode vazar para o outro."""
    monkeypatch.setattr(search, '_regex_pausado_ate', 0.0)
    monkeypatch.setattr(search, '_cache_malha', search.CacheTTL(3600, max_itens=512))

# Resposta real da TomTom (nota ~0,99 para todos): a 1ª era uma loja de São Sebastião.
PARK = [
    ('Park Shopping', 'SHOPPING_CENTER', 'São Sebastião', 0.99, -15.90079, -47.79023),
    ('Lacoste Park Shopping', 'SHOP', 'Guará', 0.99, -15.83370, -47.95244),
    ('Park Shopping', 'SHOPPING_CENTER', 'Guará', 0.99, -15.83377, -47.95606),
    ('Burger KING Park Shopping Brasília', 'RESTAURANT', 'Guará', 0.99, -15.83238, -47.95540),
    ('Scala Park Shopping', 'SHOP', 'Guará', 0.99, -15.83427, -47.95446),
    ("Bob's Park Shopping", 'RESTAURANT', 'Guará', 0.98, -15.83430, -47.95254),
    ('Giraffas', 'RESTAURANT', 'Sobradinho', 0.98, -15.75021, -47.74966),
    ('Park Shopping Brasília', 'ELECTRIC_VEHICLE_STATION', 'Guará', 0.98, -15.83361, -47.95550),
]


def _cand(nome, cod, bairro, nota, lat, lon, tipo='POI'):
    return {'label': nome, 'sublabel': bairro, 'bairro': bairro, 'categoria_codigo': cod, 'score': nota,
            'lat': lat, 'lon': lon, 'tipo': tipo, 'fonte': 'tomtom'}


def test_park_shopping_de_verdade_em_primeiro():
    saida = search.ranquear('park shopping', [_cand(*p) for p in PARK], CENTRO_BRASILIA, 6)
    assert [(c['label'], c['bairro']) for c in saida[:2]] == [('Park Shopping', 'Guará'), ('Park Shopping', 'São Sebastião')]
    nomes = [c['label'] for c in saida]
    assert 'Giraffas' not in nomes                 # fuzzy fora do assunto
    assert 'Park Shopping Brasília' not in nomes   # sub-ponto do mesmo lugar (carregador a 50 m)
    assert search.categoria(saida[0]) == 'Shopping'


def test_quem_busca_perto_desempata_homonimo():
    sao_sebastiao = (-15.90, -47.78)
    cands = [_cand('Park Shopping', 'SHOPPING_CENTER', 'Guará', 0.99, -15.83377, -47.95606),
             _cand('Park Shopping', 'SHOPPING_CENTER', 'São Sebastião', 0.99, -15.90079, -47.79023)]
    assert search.ranquear('park shopping', cands, sao_sebastiao, 2)[0]['bairro'] == 'São Sebastião'


def test_numero_digitado_prefere_endereco():
    cands = [_cand('Rua 12', None, 'Águas Claras', 0.95, -15.84, -48.02, tipo='Street'),
             _cand('Rua 12 5', None, 'Águas Claras', 0.90, -15.841, -48.021, tipo='Point Address')]
    assert search.ranquear('rua 12 5', cands, CENTRO_BRASILIA, 2)[0]['tipo'] == 'Point Address'


def test_normalizar_acento_pontuacao_abreviacao():
    assert search.normalizar('Av. Pau-Brasil, Qd 5 — Águas') == 'av pau brasil quadra 5 aguas'


def test_malha_nao_deixa_curinga_do_usuario():
    # Este fake só tem ILIKE: a consulta por regex falha e a malha recua para o ILIKE de antes.
    padroes = []

    class _Consulta:
        def select(self, *_):
            return self

        def ilike(self, _col, padrao):
            padroes.append(padrao)
            return self

        def limit(self, _):
            return self

        def execute(self):
            return type('R', (), {'data': []})()

    class _Sb:
        def table(self, _):
            return _Consulta()

    asyncio.run(search._malha(_Sb(), 'eptg%_x qd 5'))
    assert padroes == ['%eptg%x%quadra%5%']


def test_categoria_conta_como_nome_do_marco():
    # A TomTom devolve o aeroporto sem a palavra "Aeroporto" no nome.
    cands = [_cand('Internacional de Brasília-Presidente Juscelino Kubitschek', 'AIRPORT', 'Lago Sul', 0.9, -15.8711, -47.9186),
             _cand('Primavia - Aeroporto', None, 'Lago Sul', 0.95, -15.84, -47.88)]
    saida = search.ranquear('aeroporto', cands, CENTRO_BRASILIA, 2)
    assert saida[0]['categoria_codigo'] == 'AIRPORT'
    assert search.rotulo(saida[0]).startswith('Aeroporto Internacional de Brasília')


def test_endereco_com_numero_acha_o_predio_e_a_via():
    """Caso real de 2026-11-09: "Avenida Pau Brasil 14" voltava vazio (o 14 não está no nome de nada)."""
    via = {**_cand('Avenida Pau-Brasil', None, 'Taguatinga', 0.99, -15.835, -48.022, tipo='Street')}
    goias = {**_cand('Rua Pau Brasil', None, 'Valparaíso de Goiás · Rua Pau Brasil 14', 0.9, -16.07, -47.98, tipo='Point Address')}
    predio = {'label': 'Avenida Pau Brasil, 14', 'sublabel': 'Via Brisa · Águas Claras', 'bairro': 'Águas Claras',
              'tipo': 'Point Address', 'lat': -15.836, 'lon': -48.021, 'score': 0.5, 'fonte': 'nominatim'}
    saida = search.ranquear('Avenida Pau Brasil 14', [via, goias, predio], CENTRO_BRASILIA, 5)
    assert [c['label'] for c in saida][:2] == ['Avenida Pau Brasil, 14', 'Avenida Pau-Brasil']
    assert all(c['label'] != 'Rua Pau Brasil' for c in saida), 'outra rua, em Goiás'
    # Sem o número, a via segue em primeiro.
    assert search.ranquear('Avenida Pau Brasil', [via, goias], CENTRO_BRASILIA, 5)[0]['label'] == 'Avenida Pau-Brasil'

