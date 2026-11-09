"""
Radares de velocidade do DF no OpenStreetMap → apps/mobile/public/radares_df.json

O DETRAN-DF só publica totais por região administrativa, sem coordenada; o OSM tem cada radar, com o limite na
maioria. O app busca o arquivo estático ao abrir o mapa, então isso não pesa na API nem no bundle.

    python scripts/radares_osm.py
"""
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

CONSULTA = ('[out:json][timeout:60];area["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"="BR-DF"]->.a;'
            '(node["highway"="speed_camera"](area.a);node["enforcement"="maxspeed"](area.a););out body;')
ESPELHOS = ('https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter')
SAIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'mobile', 'public', 'radares_df.json')


def _limite(tags: dict):
    v = str(tags.get('maxspeed', '')).split()[0] if tags.get('maxspeed') else ''
    return int(v) if v.isdigit() and 10 <= int(v) <= 130 else None


def baixar() -> list:
    erro = None
    for url in ESPELHOS:
        try:
            req = urllib.request.Request(url + '?' + urllib.parse.urlencode({'data': CONSULTA}),
                                         headers={'User-Agent': 'Routify-TCC/1.0 (academic project)'})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)['elements']
        except Exception as e:  # o próximo espelho tenta de novo
            erro = e
    raise SystemExit(f'Overpass indisponível: {erro}')


def main():
    radares = [{'lat': round(e['lat'], 6), 'lon': round(e['lon'], 6), 'limite_kmh': _limite(e.get('tags', {})),
                'nome': (e.get('tags', {}).get('name') or None)} for e in baixar()]
    assert radares and all(-16.2 < r['lat'] < -15.4 and -48.4 < r['lon'] < -47.2 for r in radares), 'fora do DF'
    os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump({'fonte': 'OpenStreetMap (ODbL)', 'gerado_em': datetime.now(timezone.utc).date().isoformat(),
                   'radares': radares}, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(radares)} radares, {sum(r["limite_kmh"] is not None for r in radares)} com limite')


if __name__ == '__main__':
    main()
