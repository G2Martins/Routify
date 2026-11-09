"""
Snap em nó × snap em aresta, no grafo real → artifacts/avaliacao_snap_aresta.json

Sem TomTom. Sorteia viagens entre pontos de interesse reais do DF (pois_df.json), atribui os pesos da LIA uma vez
(terça, 8h) e traça as duas formas sob o mesmo peso. Mede o que o usuário vê: tamanho do conector (linha reta entre
o ponto e a via), retorno na mesma via (u → v → u), conversões proibidas, e o custo de CPU.

    cd apps/api && .venv/Scripts/python ../../ml/avaliar_snap_aresta.py
"""
import json
import os
import random
import statistics as st
import sys
import time
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
API = os.path.normpath(os.path.join(AQUI, '..', 'apps', 'api'))
sys.path.insert(0, API)
os.chdir(API)

import networkx as nx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import lia_inference as lia_inf  # noqa: E402
import main  # noqa: E402
import trajeto  # noqa: E402
from routers import route  # noqa: E402

N = 300
SAIDA = os.path.join(AQUI, 'artifacts', 'avaliacao_snap_aresta.json')


def retornos(nos):
    return sum(1 for a, b, c in zip(nos, nos[1:], nos[2:]) if a == c)


def conector(p, ponto):
    return route.haversine_m(ponto[0], ponto[1], p[0], p[1])


def main_():
    with open(os.path.join(AQUI, 'artifacts', 'pois_df.json'), encoding='utf-8') as f:
        bruto = json.load(f)
    pois = bruto['pontos']
    pts = [(float(p['lat']), float(p['lon'])) for p in pois if p.get('lat') and p.get('lon')]
    with TestClient(main.app):
        s = main.app.state
        G, arv, arvore = s.graph, s.arvore_nos, s.arvore_arestas
        agora = datetime.now(lia_inf.BRASILIA_TZ)
        route.assign_lia_weights(s.model, s.encoder, s.profiles, G, 8, 1, s.recencia_cache, getattr(s, 'transfer_confidence', None),
                                 s.contexto.para_requisicao(agora, s.recencia_cache) if getattr(s, 'contexto', None) else None)
        vmax = route._vmax_ms(G)
        proibidas = G.graph.get('conversoes_proibidas') or {}
        rng = random.Random(42)
        linhas = []
        while len(linhas) < N:
            o, d = rng.choice(pts), rng.choice(pts)
            if route.haversine_m(*o, *d) < 800:
                continue
            no, dn = arv.snap(*o)
            nd, dd = arv.snap(*d)
            if max(dn, dd) > trajeto.LIMITE_SNAP_M or no == nd:
                continue
            h = lambda u, v: route.haversine_m(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']) / vmax
            t0 = time.perf_counter()
            try:
                caminho = nx.astar_path(G, no, nd, heuristic=h, weight='travel_time_lia')
            except nx.NetworkXNoPath:
                continue
            t_no = time.perf_counter() - t0
            ilegal_no = trajeto.viola_conversao(caminho, proibidas)
            poly_no = route.montar_polyline(G, caminho)
            t0 = time.perf_counter()
            pe, ps = arvore.candidatos(*o), arvore.candidatos(*d)
            tr = trajeto.tracar_por_arestas(G, pe, ps, vmax, 'travel_time_lia', proibidas)
            t_ar = time.perf_counter() - t0
            if tr is None:
                continue
            base = route.montar_polyline(G, tr.nos)
            poly_ar, _, _, m = route.juntar_pontas(G, tr, base, route.niveis_lia(G, tr.nos))
            _, dist_no, _ = route._resumir_caminho(G, caminho)
            _, dist_ar, _ = route._resumir_caminho(G, tr.nos)
            linhas.append({'conector_no_m': conector(poly_no[0], o) + conector(poly_no[-1], d),
                           'conector_aresta_m': conector(poly_ar[0], o) + conector(poly_ar[-1], d),
                           'retornos_no': retornos(caminho), 'retornos_aresta': retornos(tr.nos),
                           'ilegal_no': bool(ilegal_no), 'ilegal_aresta': bool(trajeto.viola_conversao(tr.nos, proibidas)),
                           'km_no': dist_no / 1000, 'km_aresta': (dist_ar + m) / 1000,
                           'ms_no': t_no * 1000, 'ms_aresta': t_ar * 1000})
    med = lambda k: round(st.median(x[k] for x in linhas), 1)
    res = {'n': len(linhas), 'conector_mediano_m': {'no': med('conector_no_m'), 'aresta': med('conector_aresta_m')},
           'conector_p90_m': {k: round(sorted(x[f'conector_{k}_m'] for x in linhas)[int(.9 * len(linhas))], 1) for k in ('no', 'aresta')},
           'rotas_com_retorno': {k: sum(x[f'retornos_{k}'] > 0 for x in linhas) for k in ('no', 'aresta')},
           'rotas_com_conversao_proibida': {k: sum(x[f'ilegal_{k}'] for x in linhas) for k in ('no', 'aresta')},
           'km_mediano': {'no': med('km_no'), 'aresta': med('km_aresta')}, 'ms_mediano': {'no': med('ms_no'), 'aresta': med('ms_aresta')}}
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print(json.dumps(res, ensure_ascii=False))


if __name__ == '__main__':
    main_()
