"""
Polígonos das regiões administrativas do DF (OSM, boundary=administrative + admin_level=8) → artifacts/ras_df.json

A busca rotulava o lugar pelo bairro OSM mais próximo (um ponto), que erra na divisa: o ParkShopping saía
"Candangolândia" e o Iguatemi, "Varjão". Com o polígono, o rótulo é a RA que contém o ponto. Uma consulta ao
Overpass (com espelho), polígonos simplificados a ~30 m. Dados © OpenStreetMap (ODbL).

    cd apps/api && .venv/Scripts/python ../../ml/extrair_ras_osm.py
"""
import json
import os
from datetime import datetime, timezone

import httpx
from shapely.geometry import LineString, mapping
from shapely.ops import polygonize, unary_union

CONSULTA = """[out:json][timeout:180];
rel["boundary"="administrative"]["admin_level"="4"]["name"="Distrito Federal"]->.df;
.df map_to_area->.a;
rel(area.a)["boundary"="administrative"]["admin_level"="8"];
out geom;"""
ESPELHOS = ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter')
DESTINO = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'artifacts', 'ras_df.json')


def baixar() -> dict:
    for url in ESPELHOS:
        try:
            r = httpx.post(url, data={'data': CONSULTA}, timeout=200, headers={'User-Agent': 'Routify-TCC/1.0'})
            if r.status_code == 200:
                return r.json()
            print(f'{url}: HTTP {r.status_code}')
        except httpx.HTTPError as e:
            print(f'{url}: {type(e).__name__}')
    raise SystemExit('Overpass fora do ar nos dois espelhos')


def poligono(rel: dict):
    """Junta os ways de borda (outer e inner) em faces e fica com as que caem dentro das bordas externas."""
    linhas = {'outer': [], 'inner': []}
    for m in rel.get('members', []):
        if m.get('type') == 'way' and m.get('geometry') and m.get('role') in linhas:
            linhas[m['role']].append(LineString([(p['lon'], p['lat']) for p in m['geometry']]))
    externo = unary_union(list(polygonize(unary_union(linhas['outer'])))) if linhas['outer'] else None
    if externo is None or externo.is_empty:
        return None
    if linhas['inner']:
        externo = externo.difference(unary_union(list(polygonize(unary_union(linhas['inner'])))))
    return externo.simplify(0.0003, preserve_topology=True)


def main():
    dados = baixar()
    ras = []
    for rel in dados.get('elements', []):
        nome = (rel.get('tags') or {}).get('name')
        geom = poligono(rel)
        if nome and geom is not None and not geom.is_empty:
            ras.append({'nome': nome, 'osm': f"relation/{rel['id']}", 'geometria': mapping(geom)})
    ras.sort(key=lambda r: r['nome'])
    saida = {'fonte': 'OpenStreetMap via Overpass', 'licenca': 'ODbL 1.0 — © OpenStreetMap contributors',
             'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'consulta': CONSULTA, 'ras': ras}
    with open(DESTINO, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(ras)} RAs -> {DESTINO} ({os.path.getsize(DESTINO) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
