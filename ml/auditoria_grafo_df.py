"""Auditoria do grafo viário do Distrito Federal (lacunas de malha e buracos de dados da LIA).

Uso (dois passos; só o primeiro precisa do pyosmium, que não está no venv da API):

    # 1) lê o PBF (Geofabrik, Centro-Oeste) e grava fronteiras + vias dirigíveis do DF num cache
    <python com pyosmium> ml/auditoria_grafo_df.py extrair-pbf --pbf centro-oeste.osm.pbf --saida cache_pbf.pkl

    # 2) audita o grafo (venv da API: pandas/networkx/shapely/osmnx fixados) e grava ml/artifacts/auditoria_grafo_df.json
    apps/api/.venv/Scripts/python ml/auditoria_grafo_df.py auditar --pbf-cache cache_pbf.pkl [--sensores arq] [--nota-sensores "texto"]

O passo 2 sem `--pbf-cache` roda sem a cobertura do DF (item 6) e atribui cada trecho ao centro de RA mais
próximo (voronoi) no lugar dos polígonos do OSM. Só leitura: não altera grafo, banco nem código da API.

Definições (iguais às da API, `routers/route.py` + `graph_enrichment.py`):
  - "modelo": aresta a < 50 m de um sensor; "transfer": 50-500 m; "heurística" (buraco): > 500 m.
  - A API mede a distância do PONTO MÉDIO ENTRE OS NÓS da aresta (não da geometria). Aqui saem as duas
    medidas: `*_api` (regra da API) e `*_geom` (distância real da via, amostrada de 20 em 20 m).
  - km de via = linha central (a ida e a volta de uma rua de mão dupla contam uma vez só).
  - A região de cada trecho vem do polígono OSM da RA (admin_level=8 dentro do DF); fora do DF = Entorno (GO).
"""
import argparse
import json
import math
import pickle
import time
import unicodedata
from array import array
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

try:
    import networkx as nx
    import numpy as np
    import pandas as pd
    import pyproj
    import shapely
    from scipy import ndimage
    from shapely.geometry import LineString
    from shapely.ops import polygonize, transform as shp_transform, unary_union
    from sklearn.neighbors import BallTree
except ImportError:      # o passo extrair-pbf roda num Python só com pyosmium
    np = None

RAIZ = Path(__file__).resolve().parent.parent
ART = RAIZ / 'ml' / 'artifacts'

# ---------------------------------------------------------------- parâmetros
CENTRO = (-15.7939, -47.8828)           # Rodoviária (centro do grafo)
RAIO_GRAFO_M = 38_000.0                 # METADE DO LADO: graph_from_point(dist=38000) usa dist_type='bbox' (quadrado)
RAIO_MODELO_M = 50.0                    # DIST_VIA_PROPRIA_M da API
RAIO_TRANSFER_M = 500.0                 # RAIO_TRANSFER_M da API
ESP_GRAFO_M = 20.0                      # passo da amostragem ao longo das arestas
ESP_PBF_M = 50.0                        # passo da amostragem das vias do PBF
COBERTO_M = 25.0                        # via do PBF a <= 25 m de uma amostra do grafo = coberta
BORDA_FAIXA_M = 4_000.0                 # faixa de 4 km junto à borda da caixa: o corte derruba arestas inteiras
SNAP_ALERTA_M = 300.0
RAZAO_ALERTA = 2.0
ILHA_MIN_KM = 0.5
CELULA_M = 1000.0
CELULA_MIN_KM = 2.0
TOP_CELULAS = 40
SEMAFORO_ENCAIXE_M = 40.0               # raio de encaixe do semáforo no cruzamento (trajeto.py)
R_TERRA_M = 6_371_000.0

# caixa que contém o DF com folga (lon_min, lat_min, lon_max, lat_max)
CAIXA_DF = (-48.35, -16.10, -47.25, -15.45)

# highway que um carro usa e que o grafo pode ter (OSMnx 'drive' sem serviço); `service` fica à parte.
HW_DIRIGIVEL = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
                'living_street', 'road'}
HW_DIRIGIVEL |= {h + '_link' for h in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')}
SERVICO_FORA = {'alley', 'driveway', 'emergency_access', 'parking', 'parking_aisle', 'private', 'drive-through'}
GRUPOS_VIA = {   # igual a trajeto.GRUPOS_VIA
    'expressa': {'motorway', 'motorway_link', 'trunk', 'trunk_link'},
    'arterial': {'primary', 'primary_link', 'secondary', 'secondary_link'},
    'coletora': {'tertiary', 'tertiary_link'},
}
GRUPOS = ('expressa', 'arterial', 'coletora', 'local')
CLASSES = ('modelo', 'transfer', 'buraco')

# as 35 RAs: (numeral, nome, apelidos no OSM / em bairros_df.json)
RAS = [
    ('I', 'Plano Piloto', ['Brasília']), ('II', 'Gama', []), ('III', 'Taguatinga', []),
    ('IV', 'Brazlândia', []), ('V', 'Sobradinho', []), ('VI', 'Planaltina', []), ('VII', 'Paranoá', []),
    ('VIII', 'Núcleo Bandeirante', []), ('IX', 'Ceilândia', []), ('X', 'Guará', []), ('XI', 'Cruzeiro', []),
    ('XII', 'Samambaia', []), ('XIII', 'Santa Maria', []), ('XIV', 'São Sebastião', []),
    ('XV', 'Recanto das Emas', []), ('XVI', 'Lago Sul', []), ('XVII', 'Riacho Fundo', []),
    ('XVIII', 'Lago Norte', []), ('XIX', 'Candangolândia', []), ('XX', 'Águas Claras', []),
    ('XXI', 'Riacho Fundo II', []), ('XXII', 'Sudoeste e Octogonal', ['Sudoeste/Octogonal']),
    ('XXIII', 'Varjão', []), ('XXIV', 'Park Way', []), ('XXV', 'SCIA', ['SCIA/Estrutural', 'Estrutural']),
    ('XXVI', 'Sobradinho II', []), ('XXVII', 'Jardim Botânico', []), ('XXVIII', 'Itapoã', []),
    ('XXIX', 'SIA', []), ('XXX', 'Vicente Pires', []), ('XXXI', 'Fercal', []),
    ('XXXII', 'Sol Nascente/Pôr do Sol', ['Sol Nascente']), ('XXXIII', 'Arniqueira', []),
    ('XXXIV', 'Arapoanga', []), ('XXXV', 'Água Quente', []),
]
FORA_DF = 'Entorno (GO, fora do DF)'
SEM_RA = 'DF sem polígono de RA'
RA_NOMES = [n for _, n, _ in RAS] + [SEM_RA, FORA_DF]
I_SEM_RA, I_FORA = len(RAS), len(RAS) + 1
GO_ENTORNO = {'aguas lindas de goias', 'formosa', 'novo gama', 'santo antonio do descoberto'}

# zonas de atenção pedidas (círculos): nome, lat, lon, raio em km
ZONAS = [
    ('Plano Piloto, núcleo central (Rodoviária)', -15.7939, -47.8828, 3.0),
    ('Noroeste', -15.7506, -47.9126, 2.0),
    ('Sudoeste e Octogonal', -15.8002, -47.9244, 1.8),
    ('Aeroporto JK e entorno', -15.8717, -47.9188, 4.0),
    ('PAD-DF (assentamento dirigido, sudeste do DF)', -16.0064, -47.5567, 12.0),
]


def norm(s) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', str(s).lower()) if unicodedata.category(c) != 'Mn').strip()


def caixa_do_grafo():
    """(oeste, sul, leste, norte) que o OSMnx 1.9 usa em graph_from_point(dist, dist_type='bbox') (bbox_from_point)."""
    lat, lon = CENTRO
    d_lat = math.degrees(RAIO_GRAFO_M / 6_371_009.0)
    d_lon = d_lat / math.cos(math.radians(lat))
    return (lon - d_lon, lat - d_lat, lon + d_lon, lat + d_lat)


CAIXA_GRAFO = caixa_do_grafo()


# ======================================================================================================
# Passo 1: extrair do PBF (precisa de pyosmium; só tipos nativos no cache, sem numpy/shapely)
# ======================================================================================================
def extrair_pbf(pbf: str, saida: str) -> None:
    import osmium

    t0 = time.time()
    # --- 1) relações de fronteira: Distrito Federal (admin_level=4) e todas as de admin_level=8 (as RAs ficam aqui)
    rels = {}
    for r in osmium.FileProcessor(pbf, osmium.osm.RELATION):
        tg = r.tags
        if tg.get('boundary') != 'administrative':
            continue
        lvl, nome = tg.get('admin_level'), tg.get('name', '')
        if (lvl == '4' and nome == 'Distrito Federal') or lvl == '8':
            rels[r.id] = {'id': r.id, 'nome': nome, 'admin_level': lvl, 'wikidata': tg.get('wikidata'),
                          'membros': [(m.ref, m.role) for m in r.members if m.type == 'w']}
    ids_borda = {ref for r in rels.values() for ref, _ in r['membros']}
    print(f"relações de fronteira: {len(rels)} ({time.time() - t0:.1f}s)", flush=True)

    # --- 2) ways: membros das fronteiras + vias dirigíveis (e serviço) dentro da caixa do DF
    lon0, lat0, lon1, lat1 = CAIXA_DF

    class Lista(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.borda, self.vias, self.n = {}, [], 0

        def way(self, w):
            self.n += 1
            nos = w.nodes
            m = len(nos)
            if m < 2:
                return
            try:
                dentro = any(lon0 <= p.lon <= lon1 and lat0 <= p.lat <= lat1
                             for p in (nos[0], nos[m // 2], nos[m - 1]))
                if not dentro:
                    return
                tg = w.tags
                hw = tg.get('highway')
                eh_borda = w.id in ids_borda
                eh_via = hw in HW_DIRIGIVEL or hw == 'service'
                if not (eh_borda or eh_via):
                    return
                flat = array('d')
                for p in nos:
                    flat.append(p.lon)
                    flat.append(p.lat)
            except osmium.InvalidLocationError:
                return
            if eh_borda:
                self.borda[w.id] = flat
            if eh_via:
                self.vias.append({
                    'id': w.id, 'ts': int(w.timestamp.timestamp()), 'hw': hw, 'nome': tg.get('name'), 'ref': tg.get('ref'),
                    'acesso': tg.get('access'), 'moto': tg.get('motor_vehicle') or tg.get('motorcar'),
                    'area': tg.get('area'), 'servico': tg.get('service'), 'coords': flat})

    h = Lista()
    h.apply_file(pbf, locations=True)
    print(f"ways lidas: {h.n:,}; fronteira: {len(h.borda):,}; vias: {len(h.vias):,} ({time.time() - t0:.1f}s)", flush=True)

    cache = {'meta': {'pbf': Path(pbf).name, 'tamanho_bytes': Path(pbf).stat().st_size,
                      'extraido_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                      'caixa_df': CAIXA_DF},
             'relacoes': rels, 'borda': h.borda, 'vias': h.vias}
    with open(saida, 'wb') as f:
        pickle.dump(cache, f, protocol=4)
    print(f"cache gravado: {saida} ({Path(saida).stat().st_size / 1e6:.1f} MB; {time.time() - t0:.1f}s)")


# ======================================================================================================
# Passo 2: auditar
# ======================================================================================================
def r(x, n=1):
    if x is None:
        return None
    x = float(x)
    return None if (math.isnan(x) or math.isinf(x)) else round(x, n)


def pct(parte, total, n=1):
    return round(100.0 * float(parte) / float(total), n) if total else None


def hav_m(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(np.asarray(lon2) - lon1) / 2) ** 2
    return 2 * R_TERRA_M * np.arcsin(np.sqrt(a))


def arvore(lat, lon):
    return BallTree(np.radians(np.column_stack([lat, lon])), metric='haversine')


def dmin_m(arv, lat, lon):
    """Distância (m) e índice do vizinho mais próximo (haversine, mesma regra da API)."""
    d, i = arv.query(np.radians(np.column_stack([np.asarray(lat, float), np.asarray(lon, float)])), k=1)
    return d[:, 0] * R_TERRA_M, i[:, 0]


def classe_dist(d):
    """0 = modelo (< 50 m), 1 = transfer (50-500 m), 2 = heurística/buraco (> 500 m)."""
    return np.where(d < RAIO_MODELO_M, 0, np.where(d <= RAIO_TRANSFER_M, 1, 2)).astype(np.int8)


def idx_grupo(hw: str) -> int:
    for i, g in enumerate(GRUPOS[:3]):
        if hw in GRUPOS_VIA[g]:
            return i
    return 3


def amostrar(linhas, comp_m, esp):
    """Divide cada linha em pedaços de <= esp m. Devolve (índice da linha, lon, lat, peso em m) por pedaço."""
    comp_m = np.asarray(comp_m, float)
    k = np.maximum(1, np.ceil(comp_m / esp)).astype(np.int64)
    idx = np.repeat(np.arange(len(linhas)), k)
    j = np.arange(int(k.sum())) - np.repeat(np.cumsum(k) - k, k)
    frac = (j + 0.5) / np.repeat(k, k)
    xy = shapely.get_coordinates(shapely.line_interpolate_point(linhas[idx], frac, normalized=True))
    return idx, xy[:, 0], xy[:, 1], np.repeat(comp_m / k, k)


def rotulo_via(nome, ref, hw=None):
    return (ref or nome or f'(sem nome, {hw})').split(';')[0].strip()


def ponto_cardeal(dx, dy):
    nomes = ['leste', 'nordeste', 'norte', 'noroeste', 'oeste', 'sudoeste', 'sul', 'sudeste']
    return nomes[int(round(math.degrees(math.atan2(dy, dx)) / 45.0)) % 8]


# ---------------------------------------------------------------- entradas
def carregar_sensores(caminho):
    if caminho is None:
        p = ART / 'backup_20260923_vias_monitoradas.parquet'
        if p.exists():
            caminho = str(p)
        else:
            anterior = ART / 'auditoria_grafo_df.json'
            usados = (json.loads(anterior.read_text(encoding='utf-8')).get('sensores', {}).get('usados')
                      if anterior.exists() else None)
            if not usados:
                raise SystemExit('sem sensores: passe --sensores (parquet/json/csv com id_ponto, latitude, longitude)')
            return pd.DataFrame(usados), 'sensores do JSON anterior'
    ext = Path(caminho).suffix.lower()
    if ext == '.parquet':
        df = pd.read_parquet(caminho)
    elif ext == '.csv':
        df = pd.read_csv(caminho)
    else:
        dados = json.loads(Path(caminho).read_text(encoding='utf-8'))
        df = pd.DataFrame(dados['sensores'] if isinstance(dados, dict) else dados)
    if 'nome_via' not in df:
        df['nome_via'] = ''
    return df[['id_ponto', 'nome_via', 'latitude', 'longitude']].reset_index(drop=True), Path(caminho).name


def montar_poligono(rel, borda):
    """Polígono da relação (outer menos inner). None se faltar alguma way (relação fora da caixa do DF)."""
    ext, inn = [], []
    for w, papel in rel['membros']:
        if w not in borda:
            return None
        ln = LineString(np.frombuffer(borda[w], dtype='d').reshape(-1, 2))
        (inn if papel == 'inner' else ext).append(ln)
    if not ext:
        return None
    faces = list(polygonize(unary_union(ext)))
    if not faces:
        return None
    p = unary_union(faces)
    if inn:
        furos = list(polygonize(unary_union(inn)))
        if furos:
            p = p.difference(unary_union(furos))
    return p


def poligonos_df(cache):
    """(polígono do DF, lista alinhada a RAS com o polígono de cada RA, avisos)."""
    borda, avisos = cache['borda'], []
    df_rel = [x for x in cache['relacoes'].values() if x['admin_level'] == '4']
    df_poly = montar_poligono(df_rel[0], borda) if df_rel else None
    if df_poly is None:
        raise SystemExit('cache sem o polígono do Distrito Federal')
    alvo = {}
    for i, (_, nome, apel) in enumerate(RAS):
        for n in [nome] + apel:
            alvo[norm(n)] = i
    polys = [None] * len(RAS)
    for rel in cache['relacoes'].values():
        if rel['admin_level'] != '8' or norm(rel['nome']) not in alvo:
            continue
        p = montar_poligono(rel, borda)
        if p is None or not df_poly.contains(p.representative_point()):
            continue                       # homônimo de Goiás (Planaltina de Goiás, Varjão...) ou incompleto
        i = alvo[norm(rel['nome'])]
        if polys[i] is not None:
            avisos.append(f"RA duplicada no OSM: {rel['nome']} (relação {rel['id']}); mantida a primeira")
            continue
        polys[i] = p
    for i, p in enumerate(polys):
        if p is None:
            avisos.append(f"sem polígono OSM para a RA {RAS[i][1]}")
    return df_poly, polys, avisos


def atribuir_ra(lon, lat, polys, df_poly):
    """0..34 = RA (ordem de RAS); 35 = dentro do DF sem RA; 36 = fora do DF (Entorno)."""
    lon, lat = np.asarray(lon, float), np.asarray(lat, float)
    out = np.full(len(lon), I_FORA, dtype=np.int16)
    ids = [i for i, p in enumerate(polys) if p is not None]
    arv = shapely.STRtree([polys[i] for i in ids])
    qi, ti = arv.query(shapely.points(lon, lat), predicate='within')
    if len(qi):
        _, primeiro = np.unique(qi, return_index=True)       # ponto na divisa casa com 2: fica o primeiro
        out[qi[primeiro]] = np.asarray(ids)[ti[primeiro]]
    sobra = np.flatnonzero(out == I_FORA)
    if len(sobra):
        out[sobra[shapely.contains_xy(df_poly, lon[sobra], lat[sobra])]] = I_SEM_RA
    return out


def atribuir_ra_voronoi(lon, lat, lugares):
    """Sem polígonos: centro (bairros_df.json) mais próximo; cidade de Goiás = Entorno."""
    alvo = {}
    for i, (_, nome, apel) in enumerate(RAS):
        for n in [nome] + apel:
            alvo[norm(n)] = i
    cent, rot = [], []
    for p in lugares:
        n = norm(p['nome'])
        if p['tipo'] in ('city', 'town', 'village') and (n in alvo or n in GO_ENTORNO):
            cent.append((p['lat'], p['lon']))
            rot.append(alvo.get(n, I_FORA))
    cent = np.array(cent)
    _, i = dmin_m(arvore(cent[:, 0], cent[:, 1]), lat, lon)
    return np.array(rot, dtype=np.int16)[i]


def centros_das_ras(lugares):
    """Centro de cada RA em bairros_df.json (place city/town/village com o nome da RA); None se não achar."""
    por_nome = {}
    for p in lugares:
        if p['tipo'] in ('city', 'town', 'village'):
            por_nome.setdefault(norm(p['nome']), p)
    out = []
    for _, nome, apel in RAS:
        achou = next((por_nome[norm(n)] for n in [nome] + apel if norm(n) in por_nome), None)
        out.append(achou)
    return out


# ---------------------------------------------------------------- grafo -> arrays
def construir_grafo(G):
    c = SimpleNamespace()
    c.nos = list(G.nodes)
    pos = {n: i for i, n in enumerate(c.nos)}
    c.nlon = np.array([G.nodes[n]['x'] for n in c.nos], float)
    c.nlat = np.array([G.nodes[n]['y'] for n in c.nos], float)
    U, V, L, GRP, NOME, HW, GEO = [], [], [], [], [], [], []
    for u, v, d in G.edges(data=True):
        U.append(pos[u]); V.append(pos[v]); L.append(float(d.get('length') or 0.0))
        hw = d.get('highway')
        hw = (hw[0] if hw else '') if isinstance(hw, (list, tuple)) else (hw or '')
        nm = d.get('name')
        nm = (nm[0] if nm else '') if isinstance(nm, (list, tuple)) else (nm or '')
        HW.append(str(hw)); GRP.append(idx_grupo(str(hw))); NOME.append(str(nm)); GEO.append(d.get('geometry'))
    U, V, L, GRP = np.array(U), np.array(V), np.array(L), np.array(GRP)
    c.arestas_dirigidas, c.km_dirigido = len(U), float(L.sum()) / 1000

    # ida e volta de rua de mão dupla = 1 trecho (mesmo par de nós e comprimento a < 0,5 m)
    grupos = defaultdict(list)
    for i, (u, v) in enumerate(zip(U.tolist(), V.tolist())):
        grupos[(u, v) if u <= v else (v, u)].append(i)
    unica = np.zeros(len(U), bool)
    mult = np.ones(len(U), np.int64)          # arestas dirigidas que o trecho único representa (1 ou 2)
    for (a, b), idxs in grupos.items():
        if len(idxs) == 1 or a == b:
            unica[idxs] = True
            continue
        livres = [i for i in idxs if U[i] == b]
        for i in (i for i in idxs if U[i] == a):
            unica[i] = True
            par = next((j for j in livres if abs(L[i] - L[j]) < 0.5), None)
            if par is not None:
                livres.remove(par)
                mult[i] += 1
        for j in livres:
            unica[j] = True
    ue = np.flatnonzero(unica)
    c.e_mult = mult[ue]
    c.e_u, c.e_v, c.e_len, c.e_grp = U[ue], V[ue], L[ue], GRP[ue]
    c.e_nome = [NOME[i] for i in ue]
    c.e_hw = [HW[i] for i in ue]
    # ponto médio ENTRE OS NÓS: o que a API usa (graph_enrichment._midpoints)
    c.e_mlat = (c.nlat[c.e_u] + c.nlat[c.e_v]) / 2
    c.e_mlon = (c.nlon[c.e_u] + c.nlon[c.e_v]) / 2
    linhas = np.empty(len(ue), dtype=object)
    for k, i in enumerate(ue):
        g = GEO[i]
        linhas[k] = g if g is not None else LineString([(c.nlon[U[i]], c.nlat[U[i]]), (c.nlon[V[i]], c.nlat[V[i]])])
    c.e_linha = linhas
    c.e_com_geometria = np.array([GEO[i] is not None for i in ue])
    return c


def conectividade(G, c):
    """SCC principal, categoria de cada nó fora dela e agrupamentos (ilhas/armadilhas)."""
    nos = c.nos
    sccs = sorted(nx.strongly_connected_components(G), key=len, reverse=True)
    principal = sccs[0]
    c.n_scc = len(sccs)
    c.n_main = np.fromiter((n in principal for n in nos), bool, count=len(nos))

    def alcance(vizinhos):
        vistos, fila = set(principal), deque(principal)
        while fila:
            x = fila.popleft()
            for y in vizinhos(x):
                if y not in vistos:
                    vistos.add(y)
                    fila.append(y)
        return vistos
    de_main, para_main = alcance(G.successors), alcance(G.predecessors)
    # 1 armadilha (entra e não sai), 2 inalcançável (sai e não se chega), 3 ilha (nem um nem outro)
    cat = np.zeros(len(nos), np.int8)
    for i, n in enumerate(nos):
        if n not in principal:
            cat[i] = 1 if n in de_main else (2 if n in para_main else 3)
    c.n_cat = cat
    # nó sem saída útil (beco): um único vizinho, ida ou volta
    c.n_beco = np.zeros(len(nos), bool)
    for i, n in enumerate(nos):
        viz = set(G.successors(n)); viz.update(G.predecessors(n)); viz.discard(n)
        c.n_beco[i] = len(viz) == 1
    # agrupamentos de nós fora da SCC principal (mesma categoria, ligados entre si)
    c.n_cluster = np.full(len(nos), -1, np.int64)
    c.cluster_tipo = []
    pos = {n: i for i, n in enumerate(nos)}
    for k, nome in ((1, 'armadilha (entra e não sai)'), (2, 'inalcançável (sai, não se chega)'), (3, 'ilha')):
        sel = [nos[i] for i in np.flatnonzero(cat == k)]
        if not sel:
            continue
        H = G.subgraph(sel).to_undirected()
        for comp in nx.connected_components(H):
            cid = len(c.cluster_tipo)
            c.cluster_tipo.append(nome)
            c.n_cluster[[pos[n] for n in comp]] = cid
    return sccs


# ---------------------------------------------------------------- agregação por região
def resumo_regiao(c, ms, mn, msn=None, msg=None):
    w = c.s_w[ms]
    tot = float(w.sum())
    km = tot / 1000
    o = {'km_via': r(km, 1), 'nos': int(mn.sum()), 'pct_nos_scc': pct(c.n_main[mn].sum(), mn.sum())}
    becos = int(c.n_beco[mn].sum())
    o['becos'] = becos
    o['becos_por_km'] = r(becos / km, 2) if km else None
    if msn is not None:
        o['sensores'] = int(msn.sum())
    if msg is not None:
        o['semaforos'] = int(msg.sum())
        o['semaforos_encaixados_40m'] = int((c.sg_snap_m[msg] <= SEMAFORO_ENCAIXE_M).sum())
    for rot, cls in (('api', c.s_cls_api[ms]), ('geom', c.s_cls_geo[ms])):
        for k, nome in enumerate(CLASSES):
            o[f'pct_{nome}_{rot}'] = pct(w[cls == k].sum(), tot)
    o['km_buraco_api'] = r(w[c.s_cls_api[ms] == 2].sum() / 1000, 1)
    o['km_buraco_geom'] = r(w[c.s_cls_geo[ms] == 2].sum() / 1000, 1)
    # a API chama de heurística, mas há sensor a <= 500 m da geometria da via (efeito do ponto médio)
    o['km_buraco_api_recuperavel_pela_geometria'] = r(
        w[(c.s_cls_api[ms] == 2) & (c.s_cls_geo[ms] < 2)].sum() / 1000, 1)
    g = c.s_grp[ms]
    for i, nome in enumerate(GRUPOS):
        o[f'pct_{nome}'] = pct(w[g == i].sum(), tot)
    return o


# ---------------------------------------------------------------- snap + alcançabilidade
def snap_e_alcance(c, G, itens, d_para, d_da, rodo_idx):
    """itens: [{'nome','lat','lon',...}]. Snap no nó mais próximo + caminho mínimo de/para a Rodoviária."""
    lat = np.array([p['lat'] for p in itens]); lon = np.array([p['lon'] for p in itens])
    dn, ino = dmin_m(c.arv_nos, lat, lon)
    de, _ = dmin_m(c.arv_amostras, lat, lon)
    dm, _ = dmin_m(c.arv_nos_main, lat, lon)
    saida = []
    for p, dist_no, dist_via, dist_main, i in zip(itens, dn, de, dm, ino):
        no = c.nos[i]
        reta = float(hav_m(c.nlat[i], c.nlon[i], c.nlat[rodo_idx], c.nlon[rodo_idx])) / 1000
        ida, volta = d_para.get(no), d_da.get(no)            # ida = ponto -> Rodoviária; volta = Rodoviária -> ponto
        o = {'nome': p['nome'], 'lat': p['lat'], 'lon': p['lon'], 'no_osm': int(no),
             'snap_no_m': r(dist_no, 0), 'dist_via_m': r(dist_via, 0), 'no_na_scc_principal': bool(c.n_main[i]),
             'snap_no_scc_principal_m': r(dist_main, 0),
             'reta_ate_rodoviaria_km': r(reta, 2),
             'ida_km': r(ida / 1000, 2) if ida is not None else None,
             'volta_km': r(volta / 1000, 2) if volta is not None else None}
        o['razao_ida'] = r(ida / 1000 / reta, 2) if (ida is not None and reta >= 1.0) else None
        o['razao_volta'] = r(volta / 1000 / reta, 2) if (volta is not None and reta >= 1.0) else None
        alertas = []
        if dist_no > SNAP_ALERTA_M:
            alertas.append('snap > 300 m')
        if ida is None or volta is None:
            alertas.append('inalcançável' + ('' if ida is None and volta is None else ' (só ' + ('volta' if ida is None else 'ida') + ' falha)'))
        for rot in ('razao_ida', 'razao_volta'):
            if o[rot] is not None and o[rot] > RAZAO_ALERTA:
                alertas.append(f"{rot.replace('razao_', '')} {o[rot]}x a reta")
        o['alertas'] = alertas
        saida.append(o)
    return saida


# ---------------------------------------------------------------- buracos (grade de 1 km)
def grade_buracos(c, tr, tr_inv, sens_tree, sens_df):
    c.s_E, c.s_N = tr.transform(c.s_lon, c.s_lat)
    cx = np.floor(c.s_E / CELULA_M).astype(np.int64)
    cy = np.floor(c.s_N / CELULA_M).astype(np.int64)
    chave = cx * 100_000 + cy
    df = pd.DataFrame({'k': chave, 'w': c.s_w, 'dg': c.s_dgeo, 'api': c.s_cls_api, 'g': c.s_grp, 'ra': c.s_ra})
    df['buraco'] = np.where(df.dg > RAIO_TRANSFER_M, df.w, 0.0)
    df['heur_api'] = np.where(df.api == 2, df.w, 0.0)
    df['princ'] = np.where(df.g < 3, df.w, 0.0)
    ag = df.groupby('k').agg(km=('w', 'sum'), km_buraco=('buraco', 'sum'), km_heur_api=('heur_api', 'sum'),
                             km_princ=('princ', 'sum'), dmin=('dg', 'min'))
    for col in ('km', 'km_buraco', 'km_heur_api', 'km_princ'):
        ag[col] /= 1000
    dom = (df.groupby(['k', 'ra'])['w'].sum().reset_index().sort_values('w', ascending=False)
           .drop_duplicates('k').set_index('k')['ra'])
    ag['ra'] = dom.reindex(ag.index).astype(int)
    ag['cx'], ag['cy'] = ag.index // 100_000, ag.index % 100_000
    lon_c, lat_c = tr_inv.transform((ag.cx.values + 0.5) * CELULA_M, (ag.cy.values + 0.5) * CELULA_M)
    ag['lat'], ag['lon'] = lat_c, lon_c
    ag['estrita'] = (ag.km >= CELULA_MIN_KM) & (ag.dmin > RAIO_TRANSFER_M)

    nome_s = np.array(c.e_nome, dtype=object)[c.s_e]
    hw_s = np.array(c.e_hw, dtype=object)[c.s_e]
    pbf = getattr(c, 'pbf', None)          # com o PBF, as vias saem com ref/nome do OSM (o grafo enxuto não guarda ref)

    def detalhar(linha, pos):
        k = linha.name
        m = chave == k
        nomes = Counter()
        sem_nome_km = 0.0
        if pbf is not None:
            mp = (pbf.chave == k) & ~pbf.serv
            for rt, wv in zip(pbf.rot[mp], pbf.w[mp]):
                if rt.startswith('(sem nome'):
                    sem_nome_km += wv / 1000
                else:
                    nomes[rt] += wv
        else:
            for nm, hw, wv in zip(nome_s[m], hw_s[m], c.s_w[m]):
                if nm:
                    nomes[nm] += wv
                else:
                    sem_nome_km += wv / 1000
        vias = [f'{n} ({v / 1000:.1f} km)' for n, v in nomes.most_common(3)]
        # ponto sugerido: na via de maior classe presente, o trecho mais central entre todos os da célula
        g = c.s_grp[m]
        cand = np.flatnonzero(g == g.min())
        E, N, wv = c.s_E[m], c.s_N[m], c.s_w[m]
        custo = [(wv * np.hypot(E - E[j], N - N[j])).sum() for j in cand]
        j = cand[int(np.argmin(custo))]
        plat, plon = c.s_lat[m][j], c.s_lon[m][j]
        via_pt = nome_s[m][j] or f'({hw_s[m][j]} sem nome)'
        if pbf is not None:
            mp = np.flatnonzero((pbf.chave == k) & ~pbf.serv)
            if len(mp):
                q = mp[int(np.argmin(np.hypot(pbf.E[mp] - E[j], pbf.N[mp] - N[j])))]
                if np.hypot(pbf.E[q] - E[j], pbf.N[q] - N[j]) <= 60:
                    via_pt = pbf.rot[q]
        ds, si = dmin_m(sens_tree, [plat], [plon])
        return {
            'posicao': pos, 'ra': RA_NOMES[int(linha.ra)], 'celula_utm23s_km': [int(linha.cx), int(linha.cy)],
            'lat': r(linha.lat, 5), 'lon': r(linha.lon, 5), 'km_via': r(linha.km, 2),
            'km_vias_principais': r(linha.km_princ, 2), 'pct_heuristica_pela_api': pct(linha.km_heur_api, linha.km),
            'dist_min_ao_sensor_m': r(linha.dmin, 0), 'vias_principais': vias, 'km_sem_nome': r(sem_nome_km, 1),
            'ponto_sugerido': {'lat': r(plat, 6), 'lon': r(plon, 6), 'via': via_pt, 'classe': GRUPOS[int(g.min())]},
            'sensor_mais_proximo_do_ponto': {'id_ponto': int(sens_df.id_ponto.iloc[int(si[0])]), 'dist_m': r(ds[0], 0)}}

    no_df = ag.ra <= I_SEM_RA
    est = ag[ag.estrita & no_df]
    top = est.sort_values('km', ascending=False).head(TOP_CELULAS)
    top_pr = est[est.km_princ > 0].sort_values('km_princ', ascending=False).head(TOP_CELULAS)
    out = {
        'criterio': f'célula de {CELULA_M / 1000:.0f} km x {CELULA_M / 1000:.0f} km (UTM 23S, EPSG:31983) com >= {CELULA_MIN_KM} km de via '
                    f'do grafo e nenhum trecho a <= {RAIO_TRANSFER_M:.0f} m de um sensor (distância pela geometria)',
        'celulas_com_via': int(len(ag)), 'celulas_estritas_df': int(len(est)),
        'km_via_em_celulas_estritas_df': r(est.km.sum(), 1),
        'km_vias_principais_em_celulas_estritas_df': r(est.km_princ.sum(), 1),
        'top_celulas': [detalhar(row, i + 1) for i, (_, row) in enumerate(top.iterrows())],
        'top_celulas_por_vias_principais': [detalhar(row, i + 1) for i, (_, row) in enumerate(top_pr.iterrows())],
        'grade_colunas': ['cx', 'cy', 'lat', 'lon', 'km_via', 'km_buraco', 'km_vias_principais', 'dist_min_sensor_m', 'ra_idx'],
        'grade': [[int(x.cx), int(x.cy), r(x.lat, 4), r(x.lon, 4), r(x.km, 2), r(x.km_buraco, 2), r(x.km_princ, 2),
                   r(x.dmin, 0), int(x.ra)] for x in ag.itertuples()],
    }
    return out


# ---------------------------------------------------------------- cobertura do DF (PBF)
def selecionar_vias(cache):
    dirig, serv = [], []
    for v in cache['vias']:
        if v['area'] == 'yes' or str(v['acesso']).lower() in ('no', 'private') or str(v['moto']).lower() == 'no':
            continue                      # o grafo (OSMnx drive + access=no) também tira
        if v['hw'] == 'service':
            if v['servico'] not in SERVICO_FORA:
                serv.append(v)
        elif v['hw'] in HW_DIRIGIVEL:
            dirig.append(v)
    return dirig, serv


def dist_borda_caixa_m(lon, lat):
    """Distância (m) até a borda mais próxima da caixa do grafo; negativa fora dela."""
    oeste, sul, leste, norte = CAIXA_GRAFO
    kx = 111_195.0 * math.cos(math.radians(CENTRO[0]))
    return np.minimum.reduce([(lon - oeste) * kx, (leste - lon) * kx, (lat - sul) * 111_195.0, (norte - lat) * 111_195.0])


def cobertura_pbf(c, cache, df_poly, polys, lugares, tr, tr_inv, grafo_ts):
    dirig, serv = selecionar_vias(cache)
    vias = dirig + serv
    eh_serv = np.r_[np.zeros(len(dirig), bool), np.ones(len(serv), bool)]
    linhas = np.empty(len(vias), dtype=object)
    comp = np.empty(len(vias))
    for i, v in enumerate(vias):
        a = np.frombuffer(v['coords'], dtype='d').reshape(-1, 2)
        linhas[i] = LineString(a)
        comp[i] = hav_m(a[:-1, 1], a[:-1, 0], a[1:, 1], a[1:, 0]).sum()
    idx, lon, lat, w = amostrar(linhas, comp, ESP_PBF_M)
    dentro = shapely.contains_xy(df_poly, lon, lat)
    idx, lon, lat, w = idx[dentro], lon[dentro], lat[dentro], w[dentro]
    serv_s = eh_serv[idx]
    ra = atribuir_ra(lon, lat, polys, df_poly)
    d_graf, _ = dmin_m(c.arv_amostras, lat, lon)
    coberto = d_graf <= COBERTO_M
    db = dist_borda_caixa_m(lon, lat)
    fora_caixa = db < 0
    faixa = (db >= 0) & (db < BORDA_FAIXA_M)
    rot = np.array([rotulo_via(v['nome'], v['ref'], v['hw']) for v in vias], dtype=object)[idx]
    hw = np.array([v['hw'] for v in vias], dtype=object)[idx]
    ts_via = np.array([v.get('ts', 0) for v in vias])
    recente = (ts_via[idx] > grafo_ts) if grafo_ts else np.zeros(len(idx), bool)   # via editada no OSM depois do grafo
    E, N = tr.transform(lon, lat)
    km = lambda m: float(w[m].sum()) / 1000                          # noqa: E731
    base = ~serv_s

    def bloco(m):
        return {'km_pbf': r(km(m), 1), 'km_coberto': r(km(m & coberto), 1), 'pct_coberto': pct(km(m & coberto), km(m)),
                'km_fora_da_caixa': r(km(m & ~coberto & fora_caixa), 1),
                'km_faltando_na_faixa_de_4km_da_borda': r(km(m & ~coberto & faixa), 1),
                'km_faltando_no_interior': r(km(m & ~coberto & ~fora_caixa & ~faixa), 1),
                'dentro_da_caixa_km_em_vias_editadas_apos_o_grafo': r(km(m & ~coberto & ~fora_caixa & recente), 1)}
    out = {
        'fonte': {**cache['meta'], 'criterio_via_dirigivel':
                  'highway motorway..residential/living_street/road (+links) sem service/track/footway; sem access=no|private, '
                  'motor_vehicle=no, area=yes',
                  'criterio_coberta': f'amostra de {ESP_PBF_M:.0f} m da via do PBF a <= {COBERTO_M:.0f} m de alguma amostra '
                                      f'({ESP_GRAFO_M:.0f} m) de aresta do grafo',
                  'caixa_do_grafo_oeste_sul_leste_norte': [r(x, 4) for x in CAIXA_GRAFO],
                  'vias_pbf_dirigiveis': len(dirig), 'vias_pbf_servico': len(serv)},
        'df_dirigivel': bloco(base),
        'df_servico': {'km_pbf': r(km(serv_s), 1), 'km_sem_aresta_do_grafo_a_25m': r(km(serv_s & ~coberto), 1),
                       'nota': 'o grafo não tem service por construção; "sem aresta a 25 m" mede só o que não encosta em outra via'},
    }
    por_ra = []
    for i, (num, nome, _) in enumerate(RAS):
        m = base & (ra == i)
        if m.any():
            por_ra.append({'ra': num, 'nome': nome, **bloco(m)})
    m = base & (ra == I_SEM_RA)
    if m.any():
        por_ra.append({'ra': '-', 'nome': SEM_RA, **bloco(m)})
    out['por_ra'] = por_ra
    # vias que mais faltam
    falta = base & ~coberto
    falt = pd.DataFrame({'rot': rot[falta], 'w': w[falta], 'ra': ra[falta], 'fora': fora_caixa[falta], 'hw': hw[falta]})
    tot_rot = pd.Series(w[base], index=rot[base]).groupby(level=0).sum()
    g = falt.groupby('rot').agg(km=('w', 'sum'), hw=('hw', 'first'))
    g['fora_km'] = falt.assign(wf=np.where(falt.fora, falt.w, 0.0)).groupby('rot')['wf'].sum()
    g['ra'] = falt.groupby(['rot', 'ra'])['w'].sum().reset_index().sort_values('w', ascending=False) \
        .drop_duplicates('rot').set_index('rot')['ra'].map(lambda i: RA_NOMES[int(i)])
    g = g.sort_values('km', ascending=False).head(40)
    out['vias_que_mais_faltam'] = [
        {'via': k, 'km_faltando': r(row.km / 1000, 1), 'dos_quais_fora_da_caixa': r(row.fora_km / 1000, 1),
         'km_da_via_no_df': r(tot_rot.get(k, 0) / 1000, 1), 'classe_osm': row.hw, 'ra_principal': row.ra}
        for k, row in g.iterrows()]
    # vias (ways) com trecho faltando DENTRO da caixa: lista de trabalho com id do OSM e data da última edição
    fd = base & ~coberto & ~fora_caixa
    ids_via = np.array([v['id'] for v in vias])
    ft = pd.DataFrame({'v': idx[fd], 'w': w[fd], 'lat': lat[fd], 'lon': lon[fd], 'ra': ra[fd], 'faixa': faixa[fd]})
    gv = ft.groupby('v').agg(km=('w', 'sum'), lat=('lat', 'mean'), lon=('lon', 'mean'), faixa=('faixa', 'mean'),
                             ra=('ra', lambda x: x.mode().iloc[0])).sort_values('km', ascending=False).head(30)
    out['vias_faltando_dentro_da_caixa'] = [
        {'way_osm': int(ids_via[k]), 'via': rotulo_via(vias[k]['nome'], vias[k]['ref'], vias[k]['hw']), 'classe_osm': vias[k]['hw'],
         'km_faltando': r(row.km / 1000, 2), 'km_da_via': r(comp[k] / 1000, 2), 'ra': RA_NOMES[int(row.ra)],
         'lat': r(row.lat, 4), 'lon': r(row.lon, 4), 'pct_na_faixa_de_borda': r(100 * row.faixa, 0),
         'ultima_edicao': datetime.fromtimestamp(vias[k].get('ts', 0), timezone.utc).strftime('%Y-%m-%d'),
         'editada_apos_o_grafo': bool(grafo_ts and vias[k].get('ts', 0) > grafo_ts)} for k, row in gv.iterrows()]
    # áreas: células de 1 km com via faltando, agrupadas (8-vizinhança) dentro de cada RA
    lugares_cent = np.array([[p['lat'], p['lon']] for p in lugares])
    arv_lug = arvore(lugares_cent[:, 0], lugares_cent[:, 1])
    pol_cent = {i: shp_transform(tr.transform, p).centroid for i, p in enumerate(polys) if p is not None}
    areas = []
    for i in np.unique(ra[falta]):
        mi = falta & (ra == i)
        cxi = np.floor(E[mi] / 1000).astype(int)
        cyi = np.floor(N[mi] / 1000).astype(int)
        x0, y0 = cxi.min(), cyi.min()
        mat = np.zeros((cxi.max() - x0 + 1, cyi.max() - y0 + 1))
        np.add.at(mat, (cxi - x0, cyi - y0), w[mi] / 1000)
        lab, n = ndimage.label(mat >= 0.2, structure=np.ones((3, 3)))
        rot_i, w_i, E_i, N_i, fr_i = rot[mi], w[mi], E[mi], N[mi], fora_caixa[mi]
        lab_s = lab[cxi - x0, cyi - y0]
        for k in range(1, n + 1):
            ms = lab_s == k
            km_k = float(w_i[ms].sum()) / 1000
            if km_k < 3.0:
                continue
            ce, cn = float(np.average(E_i[ms], weights=w_i[ms])), float(np.average(N_i[ms], weights=w_i[ms]))
            clon, clat = tr_inv.transform(ce, cn)
            top_v = Counter()
            for a, b in zip(rot_i[ms], w_i[ms]):
                top_v[a] += b
            prox, ip = dmin_m(arv_lug, [clat], [clon])
            area = {'ra': RA_NOMES[int(i)], 'km_faltando': r(km_k, 1),
                    'pct_fora_da_caixa': pct(w_i[ms & fr_i].sum(), w_i[ms].sum()),
                    'lat': r(clat, 4), 'lon': r(clon, 4),
                    'dist_centro_km': r(float(hav_m(clat, clon, CENTRO[0], CENTRO[1])) / 1000, 1),
                    'perto_de': f"{lugares[int(ip[0])]['nome']} ({prox[0] / 1000:.1f} km)",
                    'vias': [f'{a} ({b / 1000:.1f} km)' for a, b in top_v.most_common(4)]}
            if int(i) in pol_cent:
                pc = pol_cent[int(i)]
                dx, dy = ce - pc.x, cn - pc.y
                area['posicao_na_ra'] = ponto_cardeal(dx, dy) if math.hypot(dx, dy) > 2500 else 'centro'
            areas.append(area)
    areas.sort(key=lambda a: -a['km_faltando'])
    out['areas_faltando'] = areas[:40]
    out['areas_faltando_total'] = len(areas)
    # estado para as zonas e para a grade de buracos (nomes das vias vêm do OSM, com ref)
    c.pbf = SimpleNamespace(lat=lat, lon=lon, w=w, coberto=coberto, serv=serv_s, rot=rot, ra=ra, fora=fora_caixa,
                            E=E, N=N, chave=np.floor(E / CELULA_M).astype(np.int64) * 100_000
                            + np.floor(N / CELULA_M).astype(np.int64))
    return out


def zonas(c, tem_pbf):
    out = []
    for nome, zlat, zlon, rkm in ZONAS:
        ms = hav_m(c.s_lat, c.s_lon, zlat, zlon) <= rkm * 1000
        mn = hav_m(c.nlat, c.nlon, zlat, zlon) <= rkm * 1000
        z = {'zona': nome, 'centro': [zlat, zlon], 'raio_km': rkm, **resumo_regiao(c, ms, mn)}
        if tem_pbf:
            p = c.pbf
            mp = hav_m(p.lat, p.lon, zlat, zlon) <= rkm * 1000
            base, falta = mp & ~p.serv, mp & ~p.serv & ~p.coberto
            z['pbf_km_dirigivel'] = r(p.w[base].sum() / 1000, 1)
            z['pbf_km_faltando_no_grafo'] = r(p.w[falta].sum() / 1000, 1)
            z['pbf_pct_coberto'] = pct(p.w[base & p.coberto].sum(), p.w[base].sum())
            z['pbf_km_servico'] = r(p.w[mp & p.serv].sum() / 1000, 1)
            z['pbf_km_servico_sem_aresta_do_grafo'] = r(p.w[mp & p.serv & ~p.coberto].sum() / 1000, 1)
            top = Counter()
            for rt, wv in zip(p.rot[falta], p.w[falta]):
                top[rt] += wv
            z['pbf_vias_que_faltam'] = [f'{a} ({b / 1000:.1f} km)' for a, b in top.most_common(6)]
        out.append(z)
    return out


# ---------------------------------------------------------------- saída
def limpar(o):
    if isinstance(o, dict):
        return {str(k): limpar(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [limpar(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if (math.isnan(o) or math.isinf(o)) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def escrever_json(caminho, obj):
    cmp_ = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))     # noqa: E731

    def rec(f, v, nivel):
        ind = '  ' * nivel
        if isinstance(v, dict) and v and nivel < 2:
            f.write('{\n')
            itens = list(v.items())
            for i, (k, x) in enumerate(itens):
                f.write(f'{ind}  {cmp_(k)}: ')
                rec(f, x, nivel + 1)
                f.write(',\n' if i < len(itens) - 1 else '\n')
            f.write(ind + '}')
        elif isinstance(v, list) and v and (all(isinstance(x, dict) for x in v)
                                            or (len(v) > 20 and all(isinstance(x, list) for x in v))):
            f.write('[\n')
            for i, x in enumerate(v):
                f.write(f'{ind}  {cmp_(x)}' + (',\n' if i < len(v) - 1 else '\n'))
            f.write(ind + ']')
        else:
            f.write(cmp_(v))
    with open(caminho, 'w', encoding='utf-8', newline='\n') as f:
        rec(f, limpar(obj), 0)
        f.write('\n')


# ======================================================================================================
def auditar(args):
    if np is None:
        raise SystemExit('faltam numpy/pandas/networkx/shapely/sklearn/scipy/pyproj: rode com apps/api/.venv/Scripts/python')
    t0 = time.time()

    def log(m):
        print(f"[{time.time() - t0:6.1f}s] {m}", flush=True)

    c = SimpleNamespace()
    # ------------------------------------------------ entradas
    with open(args.grafo, 'rb') as f:
        G = pickle.load(f)
    log(f"grafo: {G.number_of_nodes():,} nós, {G.number_of_edges():,} arestas ({G.graph.get('created_date')})")
    sens, fonte_sens = carregar_sensores(args.sensores)
    lugares = json.loads((ART / 'bairros_df.json').read_text(encoding='utf-8'))['lugares']
    marcos = json.loads((RAIZ / 'services' / 'collector' / 'pontos_df.json').read_text(encoding='utf-8'))
    sem = json.loads((ART / 'semaforos_osm_38km.json').read_text(encoding='utf-8'))['pontos']
    cache = pickle.load(open(args.pbf_cache, 'rb')) if args.pbf_cache else None
    try:   # data de criação do grafo (OSMnx grava 'AAAA-MM-DD HH:MM:SS'); vias editadas depois dela explicam parte do que falta
        grafo_ts = datetime.strptime(G.graph['created_date'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc).timestamp()
    except (KeyError, ValueError):
        grafo_ts = None
    tr = pyproj.Transformer.from_crs(4326, 31983, always_xy=True)
    tr_inv = pyproj.Transformer.from_crs(31983, 4326, always_xy=True)

    if cache:
        df_poly, polys, avisos_poly = poligonos_df(cache)
        log(f"polígonos OSM: DF + {sum(p is not None for p in polys)} RAs; avisos: {avisos_poly}")
    else:
        df_poly, polys, avisos_poly = None, [None] * len(RAS), ['sem --pbf-cache: regiões por voronoi dos centros de RA']

    def regiao(lon, lat):
        if cache:
            return atribuir_ra(lon, lat, polys, df_poly)
        return atribuir_ra_voronoi(lon, lat, lugares)

    # ------------------------------------------------ grafo -> arrays
    c.__dict__.update(construir_grafo(G).__dict__)
    sccs = conectividade(G, c)
    log(f"arestas únicas {len(c.e_u):,} ({c.km_dirigido:,.0f} km dirigidos); SCCs {c.n_scc:,}; "
        f"nós na SCC principal {100 * c.n_main.mean():.2f}%")
    idx, c.s_lon, c.s_lat, c.s_w = amostrar(c.e_linha, c.e_len, ESP_GRAFO_M)
    c.s_e = idx
    c.s_grp = c.e_grp[idx]
    log(f"amostras do grafo: {len(idx):,} ({c.s_w.sum() / 1000:,.0f} km de via)")

    # sensores
    sens_tree = arvore(sens.latitude.values, sens.longitude.values)
    c.e_dapi, _ = dmin_m(sens_tree, c.e_mlat, c.e_mlon)            # regra da API: ponto médio dos nós
    c.e_cls_api = classe_dist(c.e_dapi)
    c.s_cls_api = c.e_cls_api[idx]
    c.s_dgeo, c.s_sensor = dmin_m(sens_tree, c.s_lat, c.s_lon)     # distância real da via
    c.s_cls_geo = classe_dist(c.s_dgeo)
    c.arv_amostras = arvore(c.s_lat, c.s_lon)
    c.arv_nos = arvore(c.nlat, c.nlon)
    c.arv_nos_main = arvore(c.nlat[c.n_main], c.nlon[c.n_main])
    log("distâncias aos sensores e árvores prontas")

    # regiões
    c.s_ra = regiao(c.s_lon, c.s_lat)
    c.n_ra = regiao(c.nlon, c.nlat)
    sn_ra = regiao(sens.longitude.values, sens.latitude.values)
    sg = np.array(sem, float).reshape(-1, 2)
    c.sg_ra = regiao(sg[:, 1], sg[:, 0])
    c.sg_snap_m, _ = dmin_m(c.arv_nos, sg[:, 0], sg[:, 1])
    log("trechos, nós, sensores e semáforos atribuídos às regiões")

    # ------------------------------------------------ tabela por RA
    centros = centros_das_ras(lugares)
    caixa_poly = shapely.box(*CAIXA_GRAFO)
    ras_out = []
    for i, (num, nome, _) in enumerate(RAS):
        o = {'ra': num, 'nome': nome}
        if polys[i] is not None:
            a = shp_transform(tr.transform, polys[i]).area / 1e6
            o['area_km2'] = r(a, 1)
            o['pct_area_dentro_da_caixa_do_grafo'] = pct(
                shp_transform(tr.transform, polys[i].intersection(caixa_poly)).area / 1e6, a)
        o.update(resumo_regiao(c, c.s_ra == i, c.n_ra == i, sn_ra == i, c.sg_ra == i))
        if o.get('area_km2'):
            o['km_via_por_km2'] = r(o['km_via'] / o['area_km2'], 2)
        ras_out.append(o)
    no_df_s, no_df_n = c.s_ra <= I_SEM_RA, c.n_ra <= I_SEM_RA
    total_df = resumo_regiao(c, no_df_s, no_df_n, sn_ra <= I_SEM_RA, c.sg_ra <= I_SEM_RA)
    sem_ra = resumo_regiao(c, c.s_ra == I_SEM_RA, c.n_ra == I_SEM_RA, sn_ra == I_SEM_RA, c.sg_ra == I_SEM_RA)
    entorno = resumo_regiao(c, c.s_ra == I_FORA, c.n_ra == I_FORA, sn_ra == I_FORA, c.sg_ra == I_FORA)
    todo = resumo_regiao(c, np.ones(len(c.s_w), bool), np.ones(len(c.nos), bool),
                         np.ones(len(sens), bool), np.ones(len(sg), bool))
    # o que o log da API mostra: contagem de arestas DIRIGIDAS por fonte (modelo/transfer/heurística)
    n_dir = np.bincount(c.e_cls_api, weights=c.e_mult, minlength=3)
    km_dir = np.bincount(c.e_cls_api, weights=c.e_mult * c.e_len, minlength=3) / 1000
    todo['api_arestas_dirigidas'] = {
        'arestas': {k: int(v) for k, v in zip(CLASSES, n_dir)},
        'pct_das_arestas': {k: pct(v, n_dir.sum(), 2) for k, v in zip(CLASSES, n_dir)},
        'km_dirigido': {k: r(v, 1) for k, v in zip(CLASSES, km_dir)},
        'pct_do_km_dirigido': {k: pct(v, km_dir.sum(), 2) for k, v in zip(CLASSES, km_dir)},
        'nota': 'mesma contagem do log da API ("N de model, N de transfer, N heurística"); por km de via (linha central) o buraco é menor'}
    log("tabela por RA pronta")

    # ------------------------------------------------ ilhas e armadilhas (fora da SCC principal)
    cu, cv = c.n_cluster[c.e_u], c.n_cluster[c.e_v]
    K = len(c.cluster_tipo)
    km_cl = (np.bincount(cu[cu >= 0], weights=c.e_len[cu >= 0], minlength=K)
             + np.bincount(cv[(cv >= 0) & (cv != cu)], weights=c.e_len[(cv >= 0) & (cv != cu)], minlength=K)) / 1000
    nos_cl = np.bincount(c.n_cluster[c.n_cluster >= 0], minlength=K)
    grandes = np.flatnonzero(km_cl >= ILHA_MIN_KM)
    grandes = grandes[np.argsort(-km_cl[grandes])]
    ilhas = []
    for k in grandes:
        mn = c.n_cluster == k
        nomes = Counter()
        for e in np.flatnonzero((cu == k) | (cv == k)):
            nomes[c.e_nome[e] or f'({c.e_hw[e]} sem nome)'] += c.e_len[e]
        modo_ra = int(np.bincount(c.n_ra[mn]).argmax())
        borda_m = float(dist_borda_caixa_m(c.nlon[mn], c.nlat[mn]).min())
        ilhas.append({'tipo': c.cluster_tipo[k], 'km_via': r(km_cl[k], 2), 'nos': int(nos_cl[k]),
                      'dist_a_borda_da_caixa_m': r(borda_m, 0), 'provavel_corte_da_caixa': borda_m < 1000,
                      'lat': r(c.nlat[mn].mean(), 5), 'lon': r(c.nlon[mn].mean(), 5), 'ra': RA_NOMES[modo_ra],
                      'vias': [f'{n} ({v / 1000:.2f} km)' for n, v in nomes.most_common(3)]})
    por_tipo = {}
    for k in range(K):
        t = c.cluster_tipo[k]
        d = por_tipo.setdefault(t, {'agrupamentos': 0, 'nos': 0, 'km_via': 0.0, 'agrupamentos_ge_0_5km': 0})
        d['agrupamentos'] += 1; d['nos'] += int(nos_cl[k]); d['km_via'] += float(km_cl[k])
        d['agrupamentos_ge_0_5km'] += int(km_cl[k] >= ILHA_MIN_KM)
    for d in por_tipo.values():
        d['km_via'] = r(d['km_via'], 1)
    maior = sccs[0]
    ilhas_out = {
        'definicao': 'nó fora da maior SCC: armadilha = alcançável a partir dela mas sem volta; inalcançável = chega nela '
                     'mas ninguém chega nele; ilha = nem uma coisa nem outra. Agrupados por vizinhança; km = vias com um '
                     'extremo no agrupamento (linha central).',
        'nos_total': len(c.nos), 'nos_scc_principal': len(maior), 'pct_nos_scc_principal': pct(len(maior), len(c.nos), 2),
        'n_sccs': c.n_scc, 'por_tipo': por_tipo, 'agrupamentos_ge_0_5km': len(grandes), 'lista': ilhas[:120],
    }
    log(f"ilhas/armadilhas: {len(grandes)} agrupamentos >= {ILHA_MIN_KM} km")

    # ------------------------------------------------ snap + alcançabilidade
    rodo_idx = int(dmin_m(c.arv_nos, [CENTRO[0]], [CENTRO[1]])[1][0])
    rodo = c.nos[rodo_idx]
    d_da = nx.single_source_dijkstra_path_length(G, rodo, weight='length')                       # Rodoviária -> x
    d_para = nx.single_source_dijkstra_path_length(G.reverse(copy=False), rodo, weight='length')  # x -> Rodoviária
    itens_ra = []
    for i, (num, nome, _) in enumerate(RAS):
        p = centros[i]
        if p is not None:
            itens_ra.append({'nome': nome, 'lat': p['lat'], 'lon': p['lon'], 'ra': num, 'centro_fonte': f"bairros_df: {p['nome']}"})
        elif polys[i] is not None:
            pt = polys[i].representative_point()
            itens_ra.append({'nome': nome, 'lat': pt.y, 'lon': pt.x, 'ra': num, 'centro_fonte': 'ponto representativo do polígono'})
        else:
            itens_ra.append({'nome': nome, 'lat': float('nan'), 'lon': float('nan'), 'ra': num, 'centro_fonte': 'sem centro'})
    ok = [p for p in itens_ra if not math.isnan(p['lat'])]
    snap_ras = snap_e_alcance(c, G, ok, d_para, d_da, rodo_idx)
    ra_do_centro = regiao(np.array([p['lon'] for p in ok]), np.array([p['lat'] for p in ok]))
    for o, p, rc in zip(snap_ras, ok, ra_do_centro):
        o['ra'], o['centro_fonte'] = p['ra'], p['centro_fonte']
        o['centro_cai_em'] = RA_NOMES[int(rc)]
        if RA_NOMES[int(rc)] != p['nome']:
            o['alertas'].append(f"centro cai em {RA_NOMES[int(rc)]}")
    itens_marcos = [{'nome': m['nome'], 'lat': m['lat'], 'lon': m['lon']} for m in marcos]
    snap_marcos = snap_e_alcance(c, G, itens_marcos, d_para, d_da, rodo_idx)
    for o, m, rm in zip(snap_marcos, marcos, regiao(np.array([m['lon'] for m in marcos]), np.array([m['lat'] for m in marcos]))):
        o['id'], o['tipo'], o['ra'] = m['id'], m['tipo'], RA_NOMES[int(rm)]
    log("snap e alcançabilidade prontos")

    # ------------------------------------------------ sensores órfãos (sem via do grafo a <= 50 m)
    dsv, _ = dmin_m(c.arv_amostras, sens.latitude.values, sens.longitude.values)
    dcs = hav_m(sens.latitude.values, sens.longitude.values, CENTRO[0], CENTRO[1])
    orf = np.flatnonzero(dsv > RAIO_MODELO_M)
    # regra da API: só vira "modelo" a aresta cujo PONTO MÉDIO ENTRE OS NÓS fica a < 50 m do sensor
    dmid, _ = dmin_m(arvore(c.e_mlat, c.e_mlon), sens.latitude.values, sens.longitude.values)
    sem_modelo = np.flatnonzero(dmid >= RAIO_MODELO_M)
    sensores_out = {
        'fonte': fonte_sens, 'nota': args.nota_sensores, 'total': len(sens), 'orfaos_total': int(len(orf)),
        'definicao_orfao': f'nenhuma via do grafo a <= {RAIO_MODELO_M:.0f} m (nunca vira aresta "modelo")',
        'sem_aresta_modelo_total': int(len(sem_modelo)),
        'definicao_sem_aresta_modelo': 'o sensor está numa via do grafo, mas nenhum ponto médio de aresta fica a < 50 m dele '
                                       '(aresta longa): o dado só entra por transfer',
        'sem_aresta_modelo': [{'id_ponto': int(sens.id_ponto[k]), 'nome_via': str(sens.nome_via[k]), 'lat': r(sens.latitude[k], 6),
                               'lon': r(sens.longitude[k], 6), 'dist_ponto_medio_mais_proximo_m': r(dmid[k], 0),
                               'dist_via_grafo_m': r(dsv[k], 0), 'ra': RA_NOMES[int(sn_ra[k])]}
                              for k in sem_modelo[np.argsort(-dmid[sem_modelo])][:40]],
        'por_ra': [{'nome': RA_NOMES[i], 'sensores': int((sn_ra == i).sum())} for i in range(len(RA_NOMES)) if (sn_ra == i).any()],
        'orfaos': [{'id_ponto': int(sens.id_ponto[k]), 'nome_via': str(sens.nome_via[k]), 'lat': r(sens.latitude[k], 6),
                    'lon': r(sens.longitude[k], 6), 'dist_via_grafo_m': r(dsv[k], 0), 'dist_centro_km': r(dcs[k] / 1000, 1),
                    'ra': RA_NOMES[int(sn_ra[k])]} for k in orf[np.argsort(-dsv[orf])][:60]],
        'usados': [{'id_ponto': int(a), 'nome_via': str(b), 'latitude': float(la), 'longitude': float(lo)}
                   for a, b, la, lo in zip(sens.id_ponto, sens.nome_via, sens.latitude, sens.longitude)],
    }

    # ------------------------------------------------ cobertura do DF pelo PBF
    cobertura = None
    if cache:
        cobertura = cobertura_pbf(c, cache, df_poly, polys, lugares, tr, tr_inv, grafo_ts)
        log(f"cobertura do DF (PBF): {cobertura['df_dirigivel']}")

    # ------------------------------------------------ buracos (grade)
    buracos = grade_buracos(c, tr, tr_inv, sens_tree, sens)
    log(f"grade: {buracos['celulas_com_via']} células com via; {buracos['celulas_estritas_df']} estritas no DF")
    zonas_out = zonas(c, bool(cache))

    # ------------------------------------------------ montagem
    df_area = None
    if cache:
        a_df = shp_transform(tr.transform, df_poly).area / 1e6
        a_fora = shp_transform(tr.transform, df_poly.difference(caixa_poly)).area / 1e6
        df_area = {'km2': r(a_df, 1), 'fora_da_caixa_km2': r(a_fora, 1), 'pct_fora_da_caixa': pct(a_fora, a_df)}
    resumo = {
        'grafo': {'nos': len(c.nos), 'arestas_dirigidas': c.arestas_dirigidas, 'trechos_unicos': int(len(c.e_u)),
                  'km_dirigido': r(c.km_dirigido, 1), 'km_via': todo['km_via'], 'pct_nos_scc_principal': todo['pct_nos_scc'],
                  'becos': todo['becos'], 'becos_a_300m_da_borda_da_caixa': int((c.n_beco & (dist_borda_caixa_m(c.nlon, c.nlat) < 300)).sum()),
                  'caixa_oeste_sul_leste_norte': [r(x, 4) for x in CAIXA_GRAFO],
                  'lado_da_caixa_km': r(2 * RAIO_GRAFO_M / 1000, 0),
                  'arestas_com_geometria_pct': pct(c.e_com_geometria.sum(), len(c.e_u)),
                  'aresta_mais_longa_km': r(c.e_len.max() / 1000, 1)},
        'df_dentro_do_grafo': {k: total_df[k] for k in ('km_via', 'nos', 'pct_nos_scc', 'sensores', 'pct_modelo_api',
                                                         'pct_transfer_api', 'pct_buraco_api', 'pct_modelo_geom',
                                                         'pct_transfer_geom', 'pct_buraco_geom', 'km_buraco_api',
                                                         'km_buraco_geom', 'km_buraco_api_recuperavel_pela_geometria')},
        'entorno_go_dentro_do_grafo': {k: entorno[k] for k in ('km_via', 'nos', 'pct_buraco_api', 'pct_buraco_geom')},
        'snap': {'ras_acima_de_300m': [o['nome'] for o in snap_ras if o['snap_no_m'] > SNAP_ALERTA_M],
                 'marcos_acima_de_300m': [o['nome'] for o in snap_marcos if o['snap_no_m'] > SNAP_ALERTA_M]},
        'alcancabilidade': {'ras_com_alerta': [o['nome'] for o in snap_ras if any('alcan' in a or 'x a reta' in a for a in o['alertas'])],
                            'marcos_com_alerta': [o['nome'] for o in snap_marcos if any('alcan' in a or 'x a reta' in a for a in o['alertas'])]},
        'sensores_orfaos': int(len(orf)),
        'df_area': df_area,
        'df_vias_osm_vs_grafo': (cobertura['df_dirigivel'] if cobertura else None),
        'ilhas_e_armadilhas': {'agrupamentos_ge_0_5km': len(grandes), 'por_tipo': por_tipo},
        'buracos_grade': {k: buracos[k] for k in ('celulas_com_via', 'celulas_estritas_df', 'km_via_em_celulas_estritas_df',
                                                  'km_vias_principais_em_celulas_estritas_df')},
    }
    saida = {
        'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'script': 'ml/auditoria_grafo_df.py',
        'entradas': {
            'grafo': {'arquivo': Path(args.grafo).name, 'criado_em': G.graph.get('created_date'),
                      'atributos_aresta': list(G.graph.get('atributos_aresta', ((),))[0])},
            'sensores': fonte_sens, 'pbf': (cache['meta'] if cache else None),
            'ras_centros': 'ml/artifacts/bairros_df.json', 'marcos': 'services/collector/pontos_df.json',
            'semaforos': 'ml/artifacts/semaforos_osm_38km.json'},
        'parametros': {'esp_amostra_grafo_m': ESP_GRAFO_M, 'esp_amostra_pbf_m': ESP_PBF_M, 'raio_modelo_m': RAIO_MODELO_M,
                       'raio_transfer_m': RAIO_TRANSFER_M, 'snap_alerta_m': SNAP_ALERTA_M, 'coberto_m': COBERTO_M,
                       'meio_lado_da_caixa_m': RAIO_GRAFO_M, 'celula_m': CELULA_M, 'celula_min_km': CELULA_MIN_KM,
                       'regioes': 'polígonos OSM (relações admin_level=8 dentro do DF)' if cache else 'voronoi dos centros de RA',
                       'avisos_poligonos': avisos_poly},
        'resumo': resumo,
        'ras': ras_out,
        'total_df_no_grafo': total_df, 'df_sem_poligono_de_ra': sem_ra, 'entorno_go': entorno, 'grafo_inteiro': todo,
        'ilhas_scc': ilhas_out,
        'snap_ras': snap_ras, 'snap_marcos': snap_marcos,
        'rodoviaria': {'no_osm': int(rodo), 'lat': r(c.nlat[rodo_idx], 6), 'lon': r(c.nlon[rodo_idx], 6)},
        'zonas': zonas_out,
        'cobertura_df': cobertura,
        'buracos': buracos,
        'sensores': sensores_out,
        'regioes_nomes': RA_NOMES,
        'legenda': {
            'pct_modelo_api / pct_transfer_api / pct_buraco_api': '% do km de via (linha central) cuja aresta tem o ponto médio dos nós a '
                                                                  '< 50 m / 50-500 m / > 500 m de um sensor: a regra que a API aplica',
            'pct_*_geom': 'o mesmo, medindo da geometria da via (amostras de 20 m) até o sensor',
            'km_buraco_api_recuperavel_pela_geometria': 'km que a API trata como heurística mas têm sensor a <= 500 m pela geometria',
            'pct_nos_scc': '% dos nós da RA que estão na maior componente fortemente conexa do grafo',
            'becos_por_km': 'nós com um único vizinho (beco sem saída) por km de via',
            'snap_no_m': 'distância do ponto ao nó mais próximo do grafo; dist_via_m ao trecho mais próximo (amostras de 20 m)',
            'ida_km / volta_km': 'menor caminho por length: do ponto à Rodoviária / da Rodoviária ao ponto',
            'buracos.top_celulas': 'células de 1 km (>= 2 km de via, nenhum trecho a <= 500 m de sensor) por km de via; '
                                   'top_celulas_por_vias_principais ordena pelo km de via expressa+arterial+coletora',
            'cobertura_df': 'via dirigível do OSM (PBF) no DF comparada ao grafo; "caixa" = quadrado do grafo'},
        'limitacoes': [
            'km de via = linha central: ida e volta de rua de mão dupla contam 1 vez (km dirigido do grafo à parte).',
            'pct_*_api = regra da API (ponto médio entre os nós da aresta); pct_*_geom = distância da geometria (amostras de 20 m).',
            'o grafo é uma CAIXA de ~76 km de lado (OSMnx dist_type="bbox"), não um círculo de 38 km: cantos chegam a 53 km do centro.',
            'cobertura do DF compara o PBF de 2026-11-01 com o grafo de 2026-09-23: via nova do OSM aparece como faltando.',
            'via do PBF sem aresta a <= 25 m conta como faltando, mesmo se o OSMnx a tirou por ser ilha desconexa.',
            'service fica fora da conta (o grafo não tem); access=no/private e motor_vehicle=no também.',
            'cobertura por polígono OSM das RAs; trecho fora do DF entra em "Entorno (GO)".'],
    }
    escrever_json(args.saida, saida)
    log(f"gravado {args.saida} ({Path(args.saida).stat().st_size / 1e6:.2f} MB)")


# ======================================================================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('extrair-pbf', help='lê o PBF e grava o cache (precisa de pyosmium)')
    e.add_argument('--pbf', required=True)
    e.add_argument('--saida', required=True)
    a = sub.add_parser('auditar', help='audita o grafo e grava o JSON (venv da API)')
    a.add_argument('--grafo', default=str(ART / 'brasilia_graph_38km.pkl'))
    a.add_argument('--pbf-cache', default=None)
    a.add_argument('--sensores', default=None, help='parquet/json/csv com id_ponto, latitude, longitude '
                   '(padrão: backup parquet de vias_monitoradas; senão, os sensores do JSON anterior)')
    a.add_argument('--nota-sensores', default=None, help='texto livre gravado no JSON (de onde vieram/como foram conferidos os sensores)')
    a.add_argument('--saida', default=str(ART / 'auditoria_grafo_df.json'))
    args = ap.parse_args()
    if args.cmd == 'extrair-pbf':
        extrair_pbf(args.pbf, args.saida)
    else:
        auditar(args)


if __name__ == '__main__':
    main()
