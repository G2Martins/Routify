"""
Enriquecimento do grafo OSM — executado UMA vez, na subida do servidor.

Resolve três lacunas que faziam a LIA não participar do roteamento:

  1. Nenhuma aresta tinha `speed_kph`, então velocidade_livre caía sempre no
     default de 50 km/h.
  2. Nenhuma aresta tinha coordenada (`x`/`y` só existem em nós), então o
     Knowledge Transfer nunca disparava — o guard de latitude falhava e tudo
     caía na heurística.
  3. Nenhuma aresta tinha `id_ponto_supabase`, então o caminho do modelo direto
     nunca disparava.

Com os três defeitos somados, o peso de toda aresta virava
`comprimento × constante`, o que torna o A* matematicamente equivalente a
roteamento por distância — exatamente o baseline que o trabalho pretende superar.

Sobre a seção 5.2 do artigo (busca PostGIS): a busca espacial é feita aqui com
um BallTree local em vez de PostGIS. O motivo é que o conjunto monitorado tem
apenas 630 pontos — cabe inteiro em memória, e o casamento das 73 mil arestas
resolve em milissegundos sem nenhuma ida ao banco. Uma consulta PostGIS por
aresta seria justamente o padrão que inviabilizava a requisição. O raio de 500 m
e a semântica de "vizinho monitorado mais próximo" são os mesmos que o artigo
descreve.
"""
import logging
import math
from typing import Optional, Tuple

import numpy as np
import osmnx as ox
from sklearn.neighbors import BallTree

RAIO_TRANSFER_M = 500.0
RAIO_TERRA_M = 6_371_000.0


# Velocidades de fallback por tipo de via (km/h), para categorias sem nenhuma
# aresta com maxspeed declarado no OSM. Valores típicos de via urbana brasileira.
VELOCIDADE_PADRAO = {
    'motorway': 100, 'motorway_link': 60,
    'trunk': 80, 'trunk_link': 50,
    'primary': 60, 'primary_link': 40,
    'secondary': 60, 'secondary_link': 40,
    'tertiary': 40, 'tertiary_link': 30,
    'residential': 30, 'living_street': 20,
    'unclassified': 30, 'road': 30, 'service': 20,
}
VELOCIDADE_FALLBACK = 40


def _parse_maxspeed(valor) -> Optional[float]:
    """Extrai km/h de um valor OSM de maxspeed.

    O campo vem como '60', '60 km/h', '30 mph', ou lista quando a via tem
    múltiplos trechos. Valores não numéricos ('signals', 'none') viram None.
    """
    if valor is None:
        return None
    if isinstance(valor, (list, tuple)):
        # Via com trechos de limites diferentes: adota o menor, conservador.
        vals = [v for v in (_parse_maxspeed(x) for x in valor) if v is not None]
        return min(vals) if vals else None
    if isinstance(valor, (int, float)):
        return float(valor) if valor > 0 else None

    texto = str(valor).strip().lower()
    numero = ''.join(c for c in texto if c.isdigit() or c == '.')
    if not numero:
        return None
    try:
        v = float(numero)
    except ValueError:
        return None
    if v <= 0:
        return None
    return v * 1.60934 if 'mph' in texto else v


def _highway_principal(valor) -> str:
    """OSM permite lista em `highway`; adota o primeiro para classificar."""
    if isinstance(valor, (list, tuple)):
        return str(valor[0]) if valor else ''
    return str(valor or '')


def add_edge_speeds(G) -> int:
    """Preenche `speed_kph` em todas as arestas.

    Substitui ox.add_edge_speeds, que falha nesta combinação de versões
    (osmnx 1.9.3 + pandas 3.0) ao tentar reprocessar valores já numéricos.

    Estratégia, a mesma do osmnx: usa maxspeed quando declarado; senão imputa
    pela média observada naquele tipo de via neste grafo; e só recorre à tabela
    fixa quando o tipo não tem nenhuma amostra.
    """
    observadas: dict = {}
    for _, _, d in G.edges(data=True):
        v = _parse_maxspeed(d.get('maxspeed'))
        if v is not None:
            observadas.setdefault(_highway_principal(d.get('highway')), []).append(v)

    media_por_tipo = {k: sum(vs) / len(vs) for k, vs in observadas.items()}

    preenchidas = 0
    for _, _, d in G.edges(data=True):
        v = _parse_maxspeed(d.get('maxspeed'))
        if v is None:
            hw = _highway_principal(d.get('highway'))
            v = media_por_tipo.get(hw) or VELOCIDADE_PADRAO.get(hw, VELOCIDADE_FALLBACK)
        d['speed_kph'] = float(v)
        preenchidas += 1

    logging.info(
        f"  speed_kph: {preenchidas:,} arestas "
        f"({len(observadas)} tipos com maxspeed declarado no OSM)"
    )
    return preenchidas


def fetch_monitored_points(sb) -> Tuple[np.ndarray, np.ndarray]:
    """Busca as vias monitoradas UMA vez. Devolve (ids, coords_radianos).

    A versão anterior refazia esta consulta a cada aresta, sem cache.
    """
    if sb is None:
        logging.warning("Sem cliente Supabase — grafo ficará sem vínculo às vias monitoradas")
        return np.array([]), np.zeros((0, 2))

    try:
        resp = sb.table('vias_monitoradas').select('id_ponto, latitude, longitude').execute()
    except Exception as e:
        # Já aconteceu neste projeto: o free tier do Supabase pausa sozinho após
        # inatividade. Sem isso, a subida do servidor derrubava com uma exceção
        # não tratada em vez de subir em modo degradado (100% heurística).
        logging.error(f"Falha ao buscar vias_monitoradas ({e}) — grafo sem vínculo à LIA")
        return np.array([]), np.zeros((0, 2))

    linhas = resp.data or []

    ids, coords = [], []
    for v in linhas:
        lat, lon = v.get('latitude'), v.get('longitude')
        if lat is None or lon is None:
            continue
        ids.append(v['id_ponto'])
        coords.append((math.radians(float(lat)), math.radians(float(lon))))

    logging.info(f"Vias monitoradas carregadas: {len(ids)}")
    return np.array(ids), np.array(coords) if coords else np.zeros((0, 2))


def _midpoints(G) -> Tuple[list, np.ndarray]:
    """Coordenada representativa de cada aresta: ponto médio entre seus nós.

    Precisão suficiente para uma busca de raio 500 m; usar a geometria completa
    só mudaria o resultado em arestas muito longas e curvas.
    """
    chaves, coords = [], []
    for u, v, k in G.edges(keys=True):
        nu, nv = G.nodes[u], G.nodes[v]
        try:
            lat = (float(nu['y']) + float(nv['y'])) / 2.0
            lon = (float(nu['x']) + float(nv['x'])) / 2.0
        except (KeyError, TypeError, ValueError):
            continue
        chaves.append((u, v, k))
        coords.append((math.radians(lat), math.radians(lon)))
    return chaves, np.array(coords) if coords else np.zeros((0, 2))


def enrich_graph(G, sb, raio_m: float = RAIO_TRANSFER_M) -> dict:
    """Anexa speed_kph, coordenada e vínculo à via monitorada mais próxima.

    Idempotente: rodar duas vezes no mesmo grafo produz o mesmo resultado.
    Devolve estatísticas de cobertura para log e para a Tabela 2 do artigo.
    """
    total = G.number_of_edges()
    logging.info(f"Enriquecendo grafo ({total:,} arestas)...")

    # --- 1. Velocidade livre por aresta ---
    com_speed = add_edge_speeds(G)

    # --- 2. Coordenada da aresta ---
    chaves, coords_arestas = _midpoints(G)
    for (u, v, k), (rlat, rlon) in zip(chaves, coords_arestas):
        d = G.edges[u, v, k]
        d['mid_y'] = math.degrees(rlat)
        d['mid_x'] = math.degrees(rlon)
    logging.info(f"  coordenada: {len(chaves):,}/{total:,} arestas")

    # --- 3. Vínculo com a via monitorada mais próxima ---
    ids_vias, coords_vias = fetch_monitored_points(sb)

    vinculadas = 0
    if len(ids_vias) > 0 and len(chaves) > 0:
        arvore = BallTree(coords_vias, metric='haversine')
        dist_rad, idx = arvore.query(coords_arestas, k=1)
        dist_m = dist_rad[:, 0] * RAIO_TERRA_M
        idx = idx[:, 0]

        for (u, v, k), i, dm in zip(chaves, idx, dist_m):
            d = G.edges[u, v, k]
            if dm <= raio_m:
                d['id_ponto_lia'] = int(ids_vias[i])
                d['dist_lia_m'] = float(dm)
                vinculadas += 1
            else:
                d.pop('id_ponto_lia', None)
                d.pop('dist_lia_m', None)
    else:
        logging.warning("  sem vias monitoradas — nenhum vínculo criado")

    cobertura = vinculadas / total * 100 if total else 0.0
    logging.info(
        f"  vínculo LIA: {vinculadas:,}/{total:,} arestas ({cobertura:.1f}%) "
        f"dentro de {raio_m:.0f}m"
    )

    return {
        'arestas': total,
        'com_speed_kph': com_speed,
        'com_coordenada': len(chaves),
        'vinculadas_lia': vinculadas,
        'cobertura_pct': round(cobertura, 2),
        'raio_m': raio_m,
        'vias_monitoradas': int(len(ids_vias)),
    }
