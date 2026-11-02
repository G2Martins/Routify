"""Comparador LIA × provedores: leitura de cada provedor, erro sem vazar chave, linhas da rodada."""
import requests

import comparar_provedores as cp

ROTA = {'tempo_lia_seg': 1500, 'tempo_total_seg': 1450, 'distancia_km': 21.3, 'fonte_rota': 'lia',
        'lia_cobertura_pct': 88.0, 'modelo_utilizado': 'lia_2.3', 'hora_partida': 18, 'alternativa': None,
        'tomtom': {'referencia_tempo_seg': 1600, 'referencia_atraso_seg': 300},
        'polyline': [[-15.8, -48.0], [-15.8, -47.98]]}


class _Resp:
    def __init__(self, dados, status=200, url=''):
        self._d, self.status_code, self.url = dados, status, url

    def json(self):
        return self._d

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f'{self.status_code} Client Error for url: {self.url}', response=self)


class _Sessao:
    def __init__(self, rotas):
        self.rotas, self.chamadas = rotas, []

    def _r(self, url, **kw):
        self.chamadas.append((url, kw))
        for trecho, resp in self.rotas.items():
            if trecho in url:
                return resp(url) if callable(resp) else resp
        raise AssertionError(f'URL inesperada: {url}')

    get = post = _r


def test_routify_devolve_lia_rota_exibida_e_tomtom_no_mesmo_trajeto():
    s = _Sessao({'8000/route': _Resp(ROTA)})
    r = cp.routify((-15.8, -48.0), (-15.79, -47.88), s)
    assert set(r) == {'lia', 'routify', 'tomtom_mesmo_trajeto'}
    assert (r['lia']['tempo_s'], r['lia']['distancia_km']) == (1500, 21.3)
    assert r['routify']['tempo_s'] == 1450 and r['tomtom_mesmo_trajeto']['tempo_s'] == 1600
    assert s.chamadas[0][1]['headers']['X-Routify-Interno'] == '1'


def test_quando_a_tomtom_vence_a_distancia_da_lia_vem_da_alternativa():
    rota = {**ROTA, 'fonte_rota': 'tomtom', 'alternativa': {'fonte': 'lia', 'distancia_km': 19.8}}
    r = cp.routify((0, 0), (1, 1), _Sessao({'8000/route': _Resp(rota)}))
    assert r['lia']['distancia_km'] == 19.8 and r['tomtom_mesmo_trajeto']['distancia_km'] == 19.8
    assert r['routify']['distancia_km'] == 21.3


def test_fora_da_malha_a_lia_fica_sem_tempo_e_sem_referencia_de_trajeto():
    for rota in ({**ROTA, 'tempo_lia_seg': None}, {**ROTA, 'fora_da_malha': True}):
        r = cp.routify((0, 0), (1, 1), _Sessao({'8000/route': _Resp(rota)}))
        assert r['lia']['tempo_s'] is None and 'fora da malha' in r['lia']['erro']
        assert 'tomtom_mesmo_trajeto' not in r


def test_cada_provedor_externo_le_tempo_e_distancia():
    s = _Sessao({
        'project-osrm': _Resp({'routes': [{'duration': 1200.44, 'distance': 20500}]}),
        'openrouteservice': _Resp({'features': [{'properties': {'summary': {'duration': 1250, 'distance': 20800}}}]}),
        'mapbox': _Resp({'routes': [{'duration': 1580, 'distance': 21100}]}),
        'tomtom': _Resp({'routes': [{'summary': {'travelTimeInSeconds': 1600, 'lengthInMeters': 21000,
                                                 'noTrafficTravelTimeInSeconds': 1250, 'trafficDelayInSeconds': 350}}]}),
    })
    o, d = (-15.8, -48.0), (-15.79, -47.88)
    assert cp.osrm(o, d, s)['tempo_s'] == 1200.4 and cp.osrm(o, d, s)['distancia_km'] == 20.5
    assert cp.openrouteservice(o, d, 'k', s)['distancia_km'] == 20.8
    assert cp.mapbox(o, d, 't', s)['tempo_s'] == 1580
    tt = cp.tomtom(o, d, 'k', s)
    assert tt['tempo_s'] == 1600 and tt['detalhes'] == {'sem_transito_s': 1250, 'atraso_transito_s': 350}


def test_erro_http_nunca_grava_a_url_com_a_chave():
    s = _Sessao({'8000/route': _Resp(ROTA),
                 'tomtom': lambda url: _Resp({}, 403, url)})
    externos = {'tomtom': lambda o, d, ses: cp.tomtom(o, d, 'SEGREDO123', ses)}
    linhas = cp.rodada(cp.CORREDORES[:1], sessao=s, externos=externos, pausa_s=0)
    tt = [l for l in linhas if l['provedor'] == 'tomtom'][0]
    assert tt['erro'] == 'HTTP 403' and tt['tempo_s'] is None
    assert 'SEGREDO123' not in repr(linhas)


def test_rodada_gera_uma_linha_por_provedor_com_a_marca_de_transito():
    s = _Sessao({'8000/route': _Resp(ROTA), 'project-osrm': _Resp({'routes': [{'duration': 900, 'distance': 15000}]})})
    linhas = cp.rodada(cp.CORREDORES[:2], sessao=s, externos={'osrm': cp.osrm}, pausa_s=0)
    assert len(linhas) == 2 * 4
    assert {l['rodada_em'] for l in linhas} == {linhas[0]['rodada_em']}
    assert all('_traco' not in l for l in linhas)  # traçado bruto nunca vai ao banco
    assert [l['tempo_s'] for l in linhas if l['provedor'] == 'osrm'] == [900, 900]
    assert {(l['provedor'], l['com_transito']) for l in linhas} == {
        ('lia', True), ('routify', True), ('tomtom_mesmo_trajeto', True), ('osrm', False)}


def test_provedores_opcionais_so_entram_com_chave(monkeypatch):
    monkeypatch.delenv('MAPBOX_TOKEN', raising=False)
    monkeypatch.delenv('ORS_API_KEY', raising=False)
    assert set(cp.provedores()) == {'osrm', 'tomtom'}
    monkeypatch.setenv('MAPBOX_TOKEN', 't')
    assert 'mapbox' in cp.provedores()


# --- Traçado ---------------------------------------------------------------------
LINHA = [(-15.8, -48.0 + i * 0.002) for i in range(11)]          # ~2,1 km para leste
PARALELA = [(-15.8 + 0.0018, lon) for _, lon in LINHA]            # ~200 m ao norte
METADE = LINHA[:6]


def test_sobreposicao_identica_paralela_e_parcial():
    assert cp.sobreposicao_pct(LINHA, LINHA) == 100.0
    assert cp.sobreposicao_pct(LINHA, PARALELA) == 0.0
    assert 45 <= cp.sobreposicao_pct(LINHA, METADE) <= 55       # metade de A está em B
    assert cp.sobreposicao_pct(METADE, LINHA) == 100.0          # B inteira está em A
    assert cp.traco_comum_pct(LINHA, METADE) == cp.sobreposicao_pct(LINHA, METADE)
    assert cp.sobreposicao_pct([], LINHA) is None and cp.traco_comum_pct(LINHA, [(0, 0)]) is None


def test_rodada_anota_o_traco_em_comum_com_a_tomtom():
    pontos_tt = [{'latitude': la, 'longitude': lo} for la, lo in LINHA]
    s = _Sessao({
        '8000/route': _Resp({**ROTA, 'polyline': [list(p) for p in LINHA]}),
        'tomtom': _Resp({'routes': [{'summary': {'travelTimeInSeconds': 300, 'lengthInMeters': 2100},
                                      'legs': [{'points': pontos_tt}]}]}),
        'project-osrm': _Resp({'routes': [{'duration': 250, 'distance': 2100,
                                           'geometry': {'coordinates': [[lo, la] for la, lo in PARALELA]}}]}),
    })
    externos = {'tomtom': lambda o, d, ses: cp.tomtom(o, d, 'k', ses), 'osrm': cp.osrm}
    linhas = {l['provedor']: l for l in cp.rodada(cp.CORREDORES[:1], sessao=s, externos=externos, pausa_s=0)}
    assert linhas['lia']['detalhes']['traco_comum_tomtom_pct'] == 100.0
    assert linhas['routify']['detalhes']['traco_comum_tomtom_pct'] == 100.0
    assert linhas['osrm']['detalhes']['traco_comum_tomtom_pct'] == 0.0
    assert 'traco_comum_tomtom_pct' not in (linhas['tomtom']['detalhes'] or {})
