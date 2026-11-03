"""
Proposta (não aplicada) de pontos novos de coleta nos buracos de sensor da LIA → artifacts/proposta_expansao_sensores.json

83% dos km de via do DF não têm sensor a 500 m (auditoria_grafo_df.json): lá a rota usa heurística, prior do corredor
e a TomTom. Mais pontos no coletor viram, em dezembro, dados de treino da LIA nesses lugares, ao custo de ciclos mais
espaçados (a cota mensal de Flow é fixa). Este script só mede; incluir pontos é decisão do dono (vias_monitoradas é
base da tese).

Candidatos = células de ~1 km com via principal (expressa > arterial > coletora) e nenhum sensor a 500 m (a regra dos
sensores virtuais, graph_enrichment.pontos_virtuais). Ordem: grupo da via, depois o tamanho do buraco (distância ao
sensor mais perto); escolha gulosa com 2 km entre pontos. Para 50, 100 e 150 pontos: cadência nova do coletor
(traffic_collector.intervalo_minutos) e % dos km de via principal com sensor a 500 m.

    cd apps/api && .venv/Scripts/python ../../ml/proposta_expansao_sensores.py
"""
import json
import math
import logging
import os
import sys
from datetime import datetime, timezone

import numpy as np
from sklearn.neighbors import BallTree

logging.disable(logging.INFO)
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, 'apps', 'api'))
import main  # noqa: E402  (carrega o .env do coletor como a API)
import graph_enrichment  # noqa: E402
from trajeto import grupo_via  # noqa: E402

R = 6_371_000.0
PRIORIDADE = {'expressa': 3, 'arterial': 2, 'coletora': 1}
ESPACO_MIN_M = 2000.0


def intervalo_minutos(n_chaves: int, n_pontos: int, cota_mensal: int = 20000, reserva: float = 0.15,
                      dias_mes: int = 31, piso_min: int = 8) -> int:
    """Mesma conta de services/collector/traffic_collector.intervalo_minutos (lá o import lê o arquivo de chaves)."""
    ciclos_dia = n_chaves * cota_mensal * (1.0 - reserva) / dias_mes / n_pontos
    return max(piso_min, math.ceil(1440.0 / ciclos_dia))


def main_():
    G = main.load_graph()
    from supabase import create_client
    graph_enrichment.enrich_graph(G, create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY')))
    sensores = G.graph['vias_monitoradas']
    arv_s = BallTree(np.radians(np.array(list(sensores.values()), dtype=float)), metric='haversine')

    # Arestas de via principal: meio da aresta, comprimento e prioridade.
    meios, comp, prio = [], [], []
    for u, v, d in G.edges(data=True):
        hw = d.get('highway')
        p = PRIORIDADE.get(grupo_via(hw[0] if isinstance(hw, list) else (hw or '')), 0)
        if p:
            meios.append(((G.nodes[u]['y'] + G.nodes[v]['y']) / 2, (G.nodes[u]['x'] + G.nodes[v]['x']) / 2))
            comp.append(float(d.get('length') or 0.0))
            prio.append(p)
    meios, comp, prio = np.array(meios), np.array(comp), np.array(prio)
    dist_s = arv_s.query(np.radians(meios), k=1)[0][:, 0] * R
    km_total = comp.sum() / 1000

    # Uma candidata por célula de ~1 km sem sensor a 500 m (a aresta de maior prioridade, depois a mais longa).
    celulas = {}
    for i, (lat, lon) in enumerate(meios):
        if dist_s[i] <= 500:
            continue
        c = (int(lat * 111_320 // 1000), int(lon * 107_000 // 1000))
        chave = (prio[i], comp[i])
        if c not in celulas or chave > celulas[c][0]:
            celulas[c] = (chave, i)
    cand = sorted((i for _, i in celulas.values()), key=lambda i: (-prio[i], -dist_s[i]))

    escolhidos = []
    for i in cand:
        p = meios[i]
        if all(np.hypot((p[0] - meios[j][0]) * 110_574, (p[1] - meios[j][1]) * 107_000) >= ESPACO_MIN_M for j in escolhidos):
            escolhidos.append(i)
        if len(escolhidos) >= 150:
            break

    n_chaves, n_atual = 39, len(sensores)
    cenarios = []
    for n in (0, 50, 100, 150):
        novos = meios[escolhidos[:n]] if n else np.empty((0, 2))
        todos = np.vstack([np.array(list(sensores.values()), dtype=float), novos]) if n else np.array(list(sensores.values()), dtype=float)
        dist = BallTree(np.radians(todos), metric='haversine').query(np.radians(meios), k=1)[0][:, 0] * R
        cenarios.append({
            'pontos_novos': n,
            'pontos_total': n_atual + n,
            'cadencia_coletor_min': intervalo_minutos(n_chaves, n_atual + n),
            'pct_km_via_principal_com_sensor_500m': round(100 * comp[dist <= 500].sum() / 1000 / km_total, 1),
            'por_grupo_novos': {g: int(sum(1 for i in escolhidos[:n] if prio[i] == p)) for g, p in PRIORIDADE.items()},
        })
        print(f"+{n:>3} pontos: cadência {cenarios[-1]['cadencia_coletor_min']} min, "
              f"{cenarios[-1]['pct_km_via_principal_com_sensor_500m']}% dos km de via principal com sensor a 500 m")

    saida = {
        'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'aplicado': False,
        'regra': 'células de ~1 km com via principal sem sensor a 500 m; grupo da via, depois buraco maior; 2 km entre pontos',
        'km_via_principal': round(float(km_total), 1),
        'celulas_sem_sensor': len(celulas),
        'cenarios': cenarios,
        'candidatos': [{'lat': round(float(meios[i][0]), 6), 'lon': round(float(meios[i][1]), 6),
                        'grupo': next(g for g, p in PRIORIDADE.items() if p == prio[i]),
                        'buraco_m': int(dist_s[i])} for i in escolhidos],
    }
    destino = os.path.join(RAIZ, 'ml', 'artifacts', 'proposta_expansao_sensores.json')
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    print(f'-> {destino}')


if __name__ == '__main__':
    main_()
