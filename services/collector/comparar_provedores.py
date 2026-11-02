"""
Comparador LIA × provedores → tabela comparacao_provedores (painel ADM, aba LIA × provedores)

Em horários fixos (timer systemd na EC2: picos e vale), pede a mesma viagem a
cada provedor e grava o ETA lado a lado. A referência é a TomTom com trânsito
ao vivo (a mesma da Fase 3); o OSRM não usa trânsito e mostra o "tempo de
mapa". A LIA vem da API de produção, chamada em 127.0.0.1 (sem passar pelo
Caddy): é o modelo que o usuário usa, não uma cópia local. Leve: só HTTP.

Também compara o TRAÇADO: `detalhes.traco_comum_tomtom_pct` é quanto da rota
de cada provedor coincide com a rota da TomTom (a até 40 m, nos dois sentidos).

    cd services/collector && .venv/bin/python comparar_provedores.py [--sem-gravar]

Provedores opcionais entram sozinhos quando a chave existe no config/.env:
ORS_API_KEY (OpenRouteService), MAPBOX_TOKEN (Mapbox driving-traffic).
"""
import argparse
import logging
import math
import os
import time
from datetime import datetime, timezone

import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
for _ruidoso in ('httpx', 'httpcore', 'urllib3'):
    logging.getLogger(_ruidoso).setLevel(logging.WARNING)

AQUI = os.path.dirname(os.path.abspath(__file__))
API_URL = os.getenv('ROUTIFY_API_INTERNA', 'http://127.0.0.1:8000')
TIMEOUT = 25
PAUSA_ENTRE_CORREDORES_S = 4  # /route aceita 20/min por IP; o OSRM público pede uso moderado
UA = {'User-Agent': 'Routify-TCC/1.0 (comparador academico; github.com/G2Martins)'}
TOLERANCIA_TRACO_M = 40.0

# (id, nome, origem (lat, lon), destino (lat, lon)). Os 11 primeiros são os pares
# da Fase 3 (ml/external_validation.py); os demais cobrem as voltas da tarde e as
# cidades-satélite mais distantes.
CORREDORES = [
    ('rodoviaria-aeroporto', 'Rodoviária → Aeroporto', (-15.7939, -47.8828), (-15.8697, -47.9172)),
    ('asanorte-asasul', 'Asa Norte → Asa Sul', (-15.7601, -47.8825), (-15.8267, -47.9218)),
    ('sudoeste-lagosul', 'Sudoeste → Lago Sul', (-15.7947, -47.9260), (-15.8360, -47.8620)),
    ('unb-esplanada', 'UnB → Esplanada dos Ministérios', (-15.7633, -47.8694), (-15.7995, -47.8640)),
    ('parque-torre', 'Parque da Cidade → Torre de TV', (-15.7986, -47.9019), (-15.7900, -47.8960)),
    ('lagonorte-scs', 'Lago Norte → Setor Comercial Sul', (-15.7333, -47.8869), (-15.7954555, -47.8934785)),
    ('cruzeiro-asanorte', 'Cruzeiro → Asa Norte', (-15.7897, -47.9370), (-15.7601, -47.8825)),
    ('guara-plano', 'Guará I → Plano Piloto (EPNB)', (-15.8302, -47.9756), (-15.7939, -47.8828)),
    ('taguatinga-plano', 'Taguatinga → Plano Piloto (EPTG)', (-15.8330, -48.0530), (-15.7939, -47.8828)),
    ('samambaia-plano', 'Samambaia → Plano Piloto (EPTG)', (-15.8580, -48.0760), (-15.7939, -47.8828)),
    ('aguasclaras-plano', 'Águas Claras → Plano Piloto (EPTG)', (-15.8340, -48.0270), (-15.7939, -47.8828)),
    ('plano-taguatinga', 'Plano Piloto → Taguatinga (EPTG, volta)', (-15.7939, -47.8828), (-15.8330, -48.0530)),
    ('plano-aguasclaras', 'Plano Piloto → Águas Claras (volta)', (-15.7939, -47.8828), (-15.8340, -48.0270)),
    ('ceilandia-plano', 'Ceilândia → Plano Piloto', (-15.8186, -48.1069), (-15.7939, -47.8828)),
    ('gama-plano', 'Gama → Plano Piloto', (-16.0175, -48.0645), (-15.7939, -47.8828)),
    ('sobradinho-plano', 'Sobradinho → Plano Piloto', (-15.6519, -47.7906), (-15.7939, -47.8828)),
]


def _resultado(tempo_s=None, distancia_km=None, erro=None, traco=None, **detalhes) -> dict:
    r = {'tempo_s': None if tempo_s is None else round(float(tempo_s), 1),
         'distancia_km': None if distancia_km is None else round(float(distancia_km), 3),
         'erro': None if erro is None else str(erro)[:300], 'detalhes': detalhes or None}
    if traco:
        r['_traco'] = traco  # [(lat, lon)], só em memória: sai antes de gravar
    return r


def _traco_geojson(coords):
    return [(float(c[1]), float(c[0])) for c in coords or []]


# --- Traçado -------------------------------------------------------------------
def _densificar(pts, passo_m: float, kx: float, ky: float):
    """[(lat, lon)] → pontos (x, y) em metros, um a cada `passo_m` ao longo do traçado."""
    out = []
    for (la1, lo1), (la2, lo2) in zip(pts, pts[1:]):
        x1, y1, x2, y2 = lo1 * kx, la1 * ky, lo2 * kx, la2 * ky
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) // passo_m))
        out += [(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n) for i in range(n)]
    if pts:
        out.append((pts[-1][1] * kx, pts[-1][0] * ky))
    return out


def sobreposicao_pct(a, b, tol_m: float = TOLERANCIA_TRACO_M):
    """% do comprimento do traçado `a` que passa a até `tol_m` do traçado `b` (WGS84 [(lat, lon)])."""
    if not a or not b or len(a) < 2 or len(b) < 2:
        return None
    ky = 111_320.0
    kx = ky * math.cos(math.radians(a[0][0]))
    grade: dict = {}
    for x, y in _densificar(b, 15.0, kx, ky):
        grade.setdefault((int(x // tol_m), int(y // tol_m)), []).append((x, y))
    amostra = _densificar(a, 25.0, kx, ky)
    t2, perto = tol_m * tol_m, 0
    for x, y in amostra:
        cx, cy = int(x // tol_m), int(y // tol_m)
        if any((x - px) ** 2 + (y - py) ** 2 <= t2
               for i in (-1, 0, 1) for j in (-1, 0, 1) for px, py in grade.get((cx + i, cy + j), ())):
            perto += 1
    return round(100.0 * perto / len(amostra), 1)


def traco_comum_pct(a, b):
    """Traçado em comum: o menor dos dois sentidos (rota mais curta contida na outra não conta como igual)."""
    ab, ba = sobreposicao_pct(a, b), sobreposicao_pct(b, a)
    return None if ab is None or ba is None else min(ab, ba)


# --- Provedores ----------------------------------------------------------------
def osrm(o, d, sessao=requests):
    """OSRM público (router.project-osrm.org): sem trânsito, uso moderado."""
    url = f'https://router.project-osrm.org/route/v1/driving/{o[1]},{o[0]};{d[1]},{d[0]}'
    r = sessao.get(url, params={'overview': 'simplified', 'geometries': 'geojson'}, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    rota = r.json()['routes'][0]
    return _resultado(rota['duration'], rota['distance'] / 1000,
                      traco=_traco_geojson((rota.get('geometry') or {}).get('coordinates')))


def openrouteservice(o, d, chave, sessao=requests):
    """OpenRouteService (chave grátis): perfil driving-car, sem trânsito ao vivo."""
    r = sessao.get('https://api.openrouteservice.org/v2/directions/driving-car',
                   params={'start': f'{o[1]},{o[0]}', 'end': f'{d[1]},{d[0]}'},
                   headers={**UA, 'Authorization': chave}, timeout=TIMEOUT)
    r.raise_for_status()
    f = r.json()['features'][0]
    s = f['properties']['summary']
    return _resultado(s['duration'], s['distance'] / 1000,
                      traco=_traco_geojson((f.get('geometry') or {}).get('coordinates')))


def mapbox(o, d, token, sessao=requests):
    """Mapbox Directions, perfil driving-traffic (trânsito ao vivo). Token público (pk.) serve."""
    url = f'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/{o[1]},{o[0]};{d[1]},{d[0]}'
    r = sessao.get(url, params={'access_token': token, 'overview': 'simplified', 'geometries': 'geojson'},
                   headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    rota = r.json()['routes'][0]
    return _resultado(rota['duration'], rota['distance'] / 1000,
                      traco=_traco_geojson((rota.get('geometry') or {}).get('coordinates')))


def tomtom(o, d, chave, sessao=requests):
    """TomTom Routing com trânsito ao vivo (referência, a mesma da Fase 3)."""
    url = f'https://api.tomtom.com/routing/1/calculateRoute/{o[0]},{o[1]}:{d[0]},{d[1]}/json'
    r = sessao.get(url, params={'key': chave, 'traffic': 'true', 'routeType': 'fastest'}, timeout=TIMEOUT)
    r.raise_for_status()
    rota = r.json()['routes'][0]
    s = rota['summary']
    traco = [(p['latitude'], p['longitude']) for perna in rota.get('legs') or [] for p in perna.get('points') or []]
    return _resultado(s['travelTimeInSeconds'], s['lengthInMeters'] / 1000, traco=traco,
                      sem_transito_s=s.get('noTrafficTravelTimeInSeconds'),
                      atraso_transito_s=s.get('trafficDelayInSeconds'))


def routify(o, d, sessao=requests) -> dict:
    """A API de produção. Devolve três linhas: a LIA pura (A* com a LIA), a rota
    exibida ao usuário (fusão LIA × TomTom) e o ETA da TomTom para o MESMO trajeto
    da LIA. Esta última é a comparação mais limpa: só muda o modelo de velocidade."""
    r = sessao.post(f'{API_URL}/route', json={'origem': {'lat': o[0], 'lon': o[1]},
                                              'destino': {'lat': d[0], 'lon': d[1]},
                                              'referencia_tomtom': True},
                    headers={**UA, 'X-Routify-Interno': '1'}, timeout=60)
    r.raise_for_status()
    j = r.json()
    alt = j.get('alternativa') or {}
    # Quando a rota exibida é a da TomTom, a da LIA vira a alternativa.
    lia_e_alternativa = j.get('fonte_rota') == 'tomtom' and alt.get('fonte') == 'lia'
    dist_lia = alt.get('distancia_km') if lia_e_alternativa else j.get('distancia_km')
    traco_lia = alt.get('polyline') if lia_e_alternativa else j.get('polyline')
    comum = dict(fonte_rota=j.get('fonte_rota'), cobertura_lia_pct=j.get('lia_cobertura_pct'),
                 modelo=j.get('modelo_utilizado'), hora=j.get('hora_partida'))
    fora = j.get('fora_da_malha') or not j.get('tempo_lia_seg')
    linhas = {
        'lia': _resultado(None if fora else j.get('tempo_lia_seg'), dist_lia,
                          'rota fora da malha da LIA' if fora else None,
                          traco=None if fora else [tuple(p) for p in traco_lia or []], **comum),
        'routify': _resultado(j.get('tempo_total_seg'), j.get('distancia_km'),
                              traco=[tuple(p) for p in j.get('polyline') or []], **comum),
    }
    tt = j.get('tomtom') or {}
    # Fora da malha a referência é a rota da própria TomTom, não o trajeto da LIA.
    if tt.get('referencia_tempo_seg') and not fora:
        linhas['tomtom_mesmo_trajeto'] = _resultado(
            tt['referencia_tempo_seg'], tt.get('referencia_distancia_km') or dist_lia,
            atraso_transito_s=tt.get('referencia_atraso_seg'),
            sem_transito_s=tt.get('referencia_sem_transito_seg'))
    return linhas


COM_TRANSITO = {'lia': True, 'routify': True, 'tomtom_mesmo_trajeto': True, 'tomtom': True,
                'mapbox': True, 'osrm': False, 'openrouteservice': False}


def _erro(e: Exception) -> str:
    """Só o tipo e o status: a mensagem do requests traz a URL, e a URL traz a chave."""
    resp = getattr(e, 'response', None)
    return f'HTTP {resp.status_code}' if resp is not None else type(e).__name__


def provedores() -> dict:
    """nome → função(o, d, sessao). TomTom usa o pool do coletor (nunca loga a chave)."""
    import random
    import traffic_collector as tc
    chaves = [c['key'] for c in tc.API_KEYS_DATA]
    p = {'osrm': osrm}
    if chaves:
        p['tomtom'] = lambda o, d, s: tomtom(o, d, random.choice(chaves), s)
    if os.getenv('ORS_API_KEY'):
        p['openrouteservice'] = lambda o, d, s: openrouteservice(o, d, os.environ['ORS_API_KEY'], s)
    if os.getenv('MAPBOX_TOKEN'):
        p['mapbox'] = lambda o, d, s: mapbox(o, d, os.environ['MAPBOX_TOKEN'], s)
    return p


def _anotar_traco(res: dict) -> None:
    """Põe em detalhes o traçado em comum com a rota da TomTom e tira os traçados da memória."""
    ref = (res.get('tomtom') or {}).get('_traco')
    for nome, r in res.items():
        traco = r.pop('_traco', None)
        if nome in ('tomtom', 'tomtom_mesmo_trajeto') or not ref or not traco:
            continue
        comum = traco_comum_pct(traco, ref)
        if comum is not None:
            r['detalhes'] = {**(r.get('detalhes') or {}), 'traco_comum_tomtom_pct': comum}


def rodada(corredores=CORREDORES, sessao=None, externos=None, pausa_s=PAUSA_ENTRE_CORREDORES_S) -> list:
    """Uma rodada: todos os corredores em todos os provedores. Falha vira linha com erro."""
    sessao = sessao or requests.Session()
    externos = provedores() if externos is None else externos
    agora = datetime.now(timezone.utc).isoformat(timespec='seconds')
    linhas = []
    for i, (cid, nome, o, d) in enumerate(corredores):
        res = {}
        try:
            res.update(routify(o, d, sessao))
        except Exception as e:
            res['lia'] = _resultado(erro=_erro(e))
        for nome_p, fn in externos.items():
            try:
                res[nome_p] = fn(o, d, sessao)
            except Exception as e:
                res[nome_p] = _resultado(erro=_erro(e))
        _anotar_traco(res)
        linhas += [{'rodada_em': agora, 'corredor': cid, 'provedor': p, 'com_transito': COM_TRANSITO[p], **r}
                   for p, r in res.items()]
        logging.info(f"{cid}: " + ' | '.join(
            (f"{p} {r['tempo_s']:.0f}s" if r['tempo_s'] else f"{p} {r['erro']}")
            + (f" ({(r.get('detalhes') or {})['traco_comum_tomtom_pct']:.0f}% traçado)"
               if 'traco_comum_tomtom_pct' in (r.get('detalhes') or {}) else '')
            for p, r in res.items()))
        if pausa_s and i < len(corredores) - 1:
            time.sleep(pausa_s)
    return linhas


def gravar(linhas: list) -> None:
    import db  # cliente service_role do coletor
    db.get_client().table('comparacao_provedores').insert(linhas).execute()
    logging.info(f'{len(linhas)} linhas gravadas em comparacao_provedores')


def main():
    ap = argparse.ArgumentParser(description='Comparador LIA × provedores (uma rodada)')
    ap.add_argument('--sem-gravar', action='store_true', help='só mostra, não grava no Supabase')
    ap.add_argument('--corredores', nargs='*', help='ids de CORREDORES (padrão: todos)')
    args = ap.parse_args()
    # Chaves opcionais (MAPBOX_TOKEN, ORS_API_KEY) moram no mesmo .env do coletor.
    from dotenv import load_dotenv
    load_dotenv(os.path.join(AQUI, 'config', '.env'))
    escolhidos = [c for c in CORREDORES if not args.corredores or c[0] in args.corredores]
    linhas = rodada(escolhidos)
    if not args.sem_gravar:
        gravar(linhas)


if __name__ == '__main__':
    main()
