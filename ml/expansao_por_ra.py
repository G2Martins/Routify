"""
Pontos novos de coleta dentro de regiões administrativas escolhidas → vias_monitoradas (+ artifacts/proposta_pontos_ras.json)

A proposta de 2026-11-03 (proposta_expansao_sensores.py) ordena os buracos pelo tamanho e caiu quase toda em rodovias
longe das cidades. Aqui a escolha é por região: vias principais (motorway a tertiary) dentro do polígono da RA no OSM
(ras_df.json), a mais de 500 m de qualquer ponto já monitorado, uma por célula de ~1 km e no máximo `--por-ra` por região,
da via mais importante para a menos. Só INSERE; sem `--aplicar` é simulação.

    cd apps/api && .venv/Scripts/python ../../ml/expansao_por_ra.py --ras "Recanto das Emas,Park Way" [--por-ra 10] [--aplicar]
"""
import argparse
import ast
import json
import math
import os
import pickle
import sys

import pandas as pd
from shapely.geometry import Point, shape
from shapely.prepared import prep

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import silver  # noqa: E402

ARTEFATOS = os.path.join(AQUI, 'artifacts')
PRIORIDADE = {'motorway': 5, 'trunk': 4, 'primary': 3, 'secondary': 2, 'tertiary': 1}
RAIO_SEM_SENSOR_M, CELULA_M, ESPACO_M = 500.0, 1000.0, 1000.0


def dist_m(a, b):
    kx = 111320.0 * math.cos(math.radians(a[0]))
    return math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * 110540.0)


def classe(d):
    hw = d.get('highway')
    hw = hw[0] if isinstance(hw, list) else hw
    return PRIORIDADE.get(str(hw), 0)


def candidatos(G, poligono, ocupados, por_ra):
    area = prep(poligono)
    celulas = {}
    for u, v, d in G.edges(data=True):
        p = classe(d)
        if not p or not d.get('name'):
            continue
        lat, lon = (G.nodes[u]['y'] + G.nodes[v]['y']) / 2, (G.nodes[u]['x'] + G.nodes[v]['x']) / 2
        if not area.contains(Point(lon, lat)) or min((dist_m((lat, lon), o) for o in ocupados), default=1e9) < RAIO_SEM_SENSOR_M:
            continue
        cel = (round(lat * 110540.0 / CELULA_M), round(lon * 111320.0 * math.cos(math.radians(lat)) / CELULA_M))
        chave = (p, float(d.get('length') or 0.0))
        if cel not in celulas or chave > celulas[cel][0]:
            nome = d['name'][0] if isinstance(d['name'], list) else d['name']
            celulas[cel] = (chave, lat, lon, str(nome)[:120])
    escolhidos = []
    for (_, lat, lon, nome) in sorted(celulas.values(), key=lambda c: c[0], reverse=True):
        if all(dist_m((lat, lon), (e['latitude'], e['longitude'])) >= ESPACO_M for e in escolhidos):
            escolhidos.append({'nome_via': nome, 'latitude': round(lat, 6), 'longitude': round(lon, 6)})
        if len(escolhidos) >= por_ra:
            break
    return escolhidos


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ras', required=True)
    ap.add_argument('--por-ra', type=int, default=10)
    ap.add_argument('--aplicar', action='store_true')
    args = ap.parse_args()
    with open(os.path.join(ARTEFATOS, 'ras_df.json'), encoding='utf-8') as f:
        ras = {r['nome']: r for r in json.load(f)['ras']}
    pedidas = [n.strip() for n in args.ras.split(',') if n.strip()]
    faltam = [n for n in pedidas if n not in ras]
    assert not faltam, f'RA desconhecida: {faltam}'
    sb = silver.get_client()
    atuais = sb.table('vias_monitoradas').select('id_ponto, latitude, longitude').execute().data
    ocupados = [(float(v['latitude']), float(v['longitude'])) for v in atuais]
    with open(os.path.join(ARTEFATOS, 'brasilia_graph_38km.pkl'), 'rb') as f:
        G = pickle.load(f)

    proposta, regs = {}, []
    for nome in pedidas:
        geo = ras[nome]['geometria']
        poligono = shape(ast.literal_eval(geo) if isinstance(geo, str) else geo)
        novos = candidatos(G, poligono, ocupados + [(r['latitude'], r['longitude']) for r in regs], args.por_ra)
        proposta[nome] = novos
        regs += [{**r, 'descricao': f'expansao-2026-11 ({nome})'} for r in novos]
        print(f'{nome}: {len(novos)} pontos')
    with open(os.path.join(ARTEFATOS, 'proposta_pontos_ras.json'), 'w', encoding='utf-8') as f:
        json.dump({'regra': __doc__.strip().splitlines()[2], 'por_ra': args.por_ra, 'pontos_antes': len(atuais), 'ras': proposta},
                  f, ensure_ascii=False, indent=1)
    print(f'{len(atuais)} pontos hoje; {len(regs)} novos' + ('' if args.aplicar else ' (simulação: use --aplicar)'))
    if not args.aplicar or not regs:
        return
    sb.table('vias_monitoradas').insert(regs).execute()
    linhas = sb.table('vias_monitoradas').select('id_ponto, nome_via, latitude, longitude, descricao').execute().data
    assert len(linhas) >= len(atuais) + len(regs), 'releitura com menos linhas que o esperado'
    pd.DataFrame(linhas).to_parquet(os.path.join(ARTEFATOS, 'backup_20261109_vias_monitoradas.parquet'), index=False)
    print(f'{len(linhas)} pontos agora')


if __name__ == '__main__':
    main()
