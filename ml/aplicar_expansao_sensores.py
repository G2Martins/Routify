"""
Grava em vias_monitoradas os pontos novos de artifacts/proposta_expansao_sensores.json e refaz o backup de coordenadas.

Só INSERE (o dataset nunca é apagado) e é idempotente: pula candidato que já existe a menos de 50 m. O nome vem da via
mais próxima no grafo. A API só usa ponto que o modelo conhece, então nada muda na rota até o próximo treino; o coletor
passa a ler os pontos novos ao reiniciar, com a cadência refeita pela cota.

    cd apps/api && .venv/Scripts/python ../../ml/aplicar_expansao_sensores.py [--aplicar]
"""
import json
import math
import os
import pickle
import sys

import pandas as pd

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import silver  # noqa: E402

ARTEFATOS = os.path.join(AQUI, 'artifacts')
DESCRICAO = 'expansao-2026-11 (buraco de sensor)'


def dist_m(a, b):
    kx = 111320.0 * math.cos(math.radians(a[0]))
    return math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * 110540.0)


def main():
    aplicar = '--aplicar' in sys.argv
    with open(os.path.join(ARTEFATOS, 'proposta_expansao_sensores.json'), encoding='utf-8') as f:
        proposta = json.load(f)
    sb = silver.get_client()
    atuais = sb.table('vias_monitoradas').select('id_ponto, nome_via, latitude, longitude, descricao').execute().data
    coords = [(float(v['latitude']), float(v['longitude'])) for v in atuais]
    novos = [c for c in proposta['candidatos'] if all(dist_m((c['lat'], c['lon']), p) >= 50.0 for p in coords)]

    with open(os.path.join(ARTEFATOS, 'brasilia_graph_38km.pkl'), 'rb') as f:
        G = pickle.load(f)
    arestas = [((G.nodes[u]['y'] + G.nodes[v]['y']) / 2, (G.nodes[u]['x'] + G.nodes[v]['x']) / 2, d.get('name'))
               for u, v, d in G.edges(data=True) if d.get('name')]
    regs = []
    for c in novos:
        # ponytail: varredura O(arestas) por candidato; 150 pontos, uma vez só
        perto = min(arestas, key=lambda a: (a[0] - c['lat']) ** 2 + (a[1] - c['lon']) ** 2)
        nome = perto[2][0] if isinstance(perto[2], list) else perto[2]
        regs.append({'nome_via': str(nome)[:120], 'latitude': c['lat'], 'longitude': c['lon'], 'descricao': DESCRICAO})
    print(f'{len(atuais)} pontos hoje; {len(regs)} novos' + ('' if aplicar else ' (simulação: use --aplicar)'))
    if not aplicar:
        return
    if regs:
        sb.table('vias_monitoradas').insert(regs).execute()
    linhas = sb.table('vias_monitoradas').select('id_ponto, nome_via, latitude, longitude, descricao').execute().data
    assert len(linhas) >= len(atuais) + len(regs), 'releitura com menos linhas que o esperado'
    backup = os.path.join(ARTEFATOS, 'backup_20261109_vias_monitoradas.parquet')
    pd.DataFrame(linhas).to_parquet(backup, index=False)
    print(f'{len(linhas)} pontos agora; backup em {os.path.basename(backup)}')


if __name__ == '__main__':
    main()
