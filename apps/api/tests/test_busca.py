"""Ranking do autocomplete (routers/search.py): caso real "park shopping" (2026-09-23)."""
import asyncio

from routers import search
from tomtom import CENTRO_BRASILIA

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

    asyncio.run(search._malha(_Sb(), 'eptg%_x qd 5', 6))
    assert padroes == ['%eptg%x%quadra%5%']


def test_categoria_conta_como_nome_do_marco():
    # A TomTom devolve o aeroporto sem a palavra "Aeroporto" no nome.
    cands = [_cand('Internacional de Brasília-Presidente Juscelino Kubitschek', 'AIRPORT', 'Lago Sul', 0.9, -15.8711, -47.9186),
             _cand('Primavia - Aeroporto', None, 'Lago Sul', 0.95, -15.84, -47.88)]
    saida = search.ranquear('aeroporto', cands, CENTRO_BRASILIA, 2)
    assert saida[0]['categoria_codigo'] == 'AIRPORT'
    assert search.rotulo(saida[0]).startswith('Aeroporto Internacional de Brasília')
