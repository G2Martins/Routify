"""POST /search/recentes: área pela RA que contém o ponto e correção de destino salvo com nome de marco do OSM em
outro lugar (o "Park Shopping" de São Sebastião que voltava sempre nos recentes do dono)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import search

SAO_SEBASTIAO = {'label': 'Park Shopping', 'lat': -15.9008, 'lon': -47.7902}


def _cliente() -> TestClient:
    app = FastAPI()
    app.include_router(search.router)
    return TestClient(app)


def test_nome_de_marco_salvo_longe_vira_o_marco():
    r = search.conferir_recente(**SAO_SEBASTIAO)
    assert r['corrigido'] and r['area'] == 'Guará'
    assert abs(r['lat'] - -15.8332) < 0.002 and abs(r['lon'] - -47.9555) < 0.002


def test_rotulo_desambiguado_e_nome_sem_marco_ficam():
    escolhido = search.conferir_recente('Park Shopping · São Sebastião', -15.9008, -47.7902)
    assert not escolhido['corrigido'] and escolhido['area'] == 'São Sebastião'
    padaria = search.conferir_recente('Padaria do Zé', -15.80, -47.95)
    assert not padaria['corrigido'] and (padaria['lat'], padaria['lon']) == (-15.80, -47.95)


def test_area_pelo_poligono_nao_pelo_bairro_mais_proximo():
    """O bairro OSM mais próximo dava Candangolândia, Varjão e Vila da Telebrasília."""
    assert search.area_de(-15.8332, -47.9555) == 'Guará'
    assert search.area_de(-15.7206, -47.8858) == 'Lago Norte'
    assert search.area_de(-15.87, -47.9197) == 'Lago Sul'


def test_http_corpo_estrito_e_dentro_do_df():
    cli = _cliente()
    ok = cli.post('/search/recentes', json={'recentes': [SAO_SEBASTIAO]})
    assert ok.status_code == 200 and ok.json()[0]['corrigido'] is True
    assert cli.post('/search/recentes', json={'recentes': [SAO_SEBASTIAO], 'x': 1}).status_code == 422
    assert cli.post('/search/recentes', json={'recentes': [SAO_SEBASTIAO] * 11}).status_code == 422
    assert cli.post('/search/recentes', json={'recentes': [{**SAO_SEBASTIAO, 'lat': -23.55}]}).status_code == 422
