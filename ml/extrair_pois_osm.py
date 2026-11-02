"""
Pontos de interesse do DF para a busca da API (apps/api/routers/search.py), a partir de um recorte OSM
(.osm.pbf, ex.: Geofabrik centro-oeste): estações de metrô, terminais, shoppings, hospitais, universidades,
estádios, parques, atrações, órgãos públicos e aeroporto. Saída: ml/artifacts/pois_df.json.

Por quê: a bateria de 2026-11-02 (scripts/bateria_busca.py, 79 pontos famosos) achou só 49,6% das estações
de metrô entre as 5 primeiras sugestões. A TomTom não tem a maioria delas e a base local só tinha vias e
bairros. Os dados são do OSM, a mesma fonte do grafo.

Requer pyosmium (`pip install osmium`), fora do venv da API: roda aqui, não em produção.
    python ml/extrair_pois_osm.py centro-oeste-AAMMDD.osm.pbf

Dados © contribuidores do OpenStreetMap, licença ODbL (atribuição no app: "© OpenStreetMap").
"""
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone

import osmium

SAIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'artifacts', 'pois_df.json')
# Retângulo do DF (um pouco folgado): o grafo da API cobre 38 km em volta de Brasília.
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = -16.06, -15.49, -48.29, -47.30
CHAVES = ('railway', 'public_transport', 'station', 'amenity', 'shop', 'leisure', 'tourism', 'aeroway',
          'historic', 'boundary', 'office', 'building')
NOMES = ('name', 'name:pt', 'alt_name', 'short_name', 'official_name', 'old_name', 'loc_name')
TEMPLOS_MARCO = re.compile(r'^(catedral|santu[aá]rio|bas[ií]lica|ermida|mesquita|templo da legi[aã]o)', re.I)


def categoria(t: dict):
    """Código no padrão da TomTom (routers/search.py já sabe rotular e tratar como marco); None = fora."""
    if t.get('railway') == 'station' and (t.get('station') == 'subway' or t.get('subway') == 'yes'):
        return 'RAILWAY_STATION'
    if t.get('public_transport') == 'station' and t.get('subway') == 'yes':
        return 'RAILWAY_STATION'
    if t.get('amenity') == 'bus_station':
        return 'BUS_STATION'
    if t.get('shop') == 'mall':
        return 'SHOPPING_CENTER'
    if t.get('amenity') == 'hospital':
        return 'HOSPITAL_POLYCLINIC'
    if t.get('amenity') in ('university', 'college'):
        return 'COLLEGE_UNIVERSITY'
    if t.get('leisure') == 'stadium' or t.get('building') == 'stadium':
        return 'STADIUM'
    if t.get('aeroway') in ('aerodrome', 'terminal'):
        return 'AIRPORT'
    if t.get('tourism') == 'museum':
        return 'MUSEUM'
    if t.get('amenity') == 'theatre':
        return 'THEATER'
    if t.get('tourism') in ('attraction', 'zoo', 'theme_park', 'gallery', 'viewpoint') or t.get('historic') in ('monument', 'memorial'):
        return 'TOURIST_ATTRACTION'
    if t.get('amenity') == 'place_of_worship' and TEMPLOS_MARCO.match(t.get('name', '')):
        return 'TOURIST_ATTRACTION'
    if t.get('leisure') in ('park', 'nature_reserve') or t.get('boundary') == 'national_park':
        return 'PARK_RECREATION_AREA'
    if t.get('office') == 'government' or t.get('building') == 'government':
        return 'GOVERNMENT_OFFICE'
    if t.get('amenity') == 'marketplace':
        return 'MARKET'
    return None


def _norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', s).split())


def nomes(t: dict, cat: str) -> list:
    """Nome principal primeiro, depois os alternativos do OSM e, nas estações, as formas que se digita
    ("metrô 106 sul", "106 sul metrô"). O nome sem "Estação" fica de fora: "guará" é a região."""
    vistos, saida = set(), []
    for k in NOMES:
        for v in (t.get(k) or '').split(';'):
            v = v.strip()
            if v and _norm(v) not in vistos:
                vistos.add(_norm(v))
                saida.append(v)
    if cat == 'RAILWAY_STATION' and saida:
        base = re.sub(r'^(esta[cç][aã]o( de metr[oô])?|metr[oô])\s+', '', saida[0], flags=re.I).strip()
        base = re.sub(r'\s*\(.*\)$', '', base)
        formas = [f'Estação {base}', f'Metrô {base}', f'{base} Metrô', f'Estação de Metrô {base}']
        resto = [v for v in saida if _norm(v) != _norm(base)]
        saida, vistos = [], set()
        for v in formas + resto:
            if _norm(v) not in vistos:
                vistos.add(_norm(v))
                saida.append(v)
    return saida


def _dentro(lat, lon) -> bool:
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX


def _centro(pts):
    """Média dos vértices: no meio do objeto, não no canto do retângulo de um polígono em L."""
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else None


def extrair(pbf: str) -> list:
    pois, relacoes, vias_rel = [], {}, set()
    filtro = osmium.filter.KeyFilter(*CHAVES)
    for o in osmium.FileProcessor(pbf).with_locations().with_filter(filtro):
        t = {x.k: x.v for x in o.tags}
        if not t.get('name'):
            continue
        cat = categoria(t)
        if cat is None:
            continue
        if o.is_node():
            if not o.location.valid():
                continue
            c = (o.location.lat, o.location.lon)
            ident = f'node/{o.id}'
        elif o.is_way():
            pts = []
            for n in o.nodes:
                try:
                    if n.location.valid():
                        pts.append((n.location.lat, n.location.lon))
                except Exception:  # nó fora do recorte
                    pass
            c = _centro(pts)
            ident = f'way/{o.id}'
        else:  # relação: o centro sai das vias-membro, na 2ª passada
            membros = [m.ref for m in o.members if m.type == 'w']
            if membros:
                relacoes[o.id] = (t, cat, membros)
                vias_rel.update(membros)
            continue
        if c and _dentro(*c):
            pois.append({'t': t, 'cat': cat, 'c': c, 'osm': ident})
    if relacoes:
        pontos_via = {}
        for w in osmium.FileProcessor(pbf).with_locations():
            if w.is_way() and w.id in vias_rel:
                pts = []
                for n in w.nodes:
                    try:
                        if n.location.valid():
                            pts.append((n.location.lat, n.location.lon))
                    except Exception:
                        pass
                pontos_via[w.id] = pts
        for rid, (t, cat, membros) in relacoes.items():
            c = _centro([p for m in membros for p in pontos_via.get(m, [])])
            if c and _dentro(*c):
                pois.append({'t': t, 'cat': cat, 'c': c, 'osm': f'relation/{rid}'})
    saida, vistos = [], set()
    for p in pois:
        ns = nomes(p['t'], p['cat'])
        chave = (_norm(ns[0]), round(p['c'][0], 3), round(p['c'][1], 3))
        if chave in vistos:  # o mesmo lugar como nó e como polígono
            continue
        vistos.add(chave)
        saida.append({'nome': ns[0], 'nomes': ns[1:], 'categoria_codigo': p['cat'],
                      'lat': round(p['c'][0], 6), 'lon': round(p['c'][1], 6), 'osm': p['osm']})
    saida.sort(key=lambda x: (x['categoria_codigo'], _norm(x['nome'])))
    return saida


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    pbf = sys.argv[1]
    pontos = extrair(pbf)
    por_cat = {}
    for p in pontos:
        por_cat[p['categoria_codigo']] = por_cat.get(p['categoria_codigo'], 0) + 1
    doc = {'fonte': f'OpenStreetMap, recorte {os.path.basename(pbf)}', 'licenca': 'ODbL — © contribuidores do OpenStreetMap',
           'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
           'retangulo': [LAT_MIN, LAT_MAX, LON_MIN, LON_MAX], 'por_categoria': por_cat, 'pontos': pontos}
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=0)
    print(f'{len(pontos)} pontos -> {SAIDA}')
    print(json.dumps(por_cat, ensure_ascii=False))


if __name__ == '__main__':
    main()
