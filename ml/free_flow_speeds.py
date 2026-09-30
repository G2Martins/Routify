"""
Velocidade livre da TomTom por ponto monitorado → ml/artifacts/velocidade_livre_tomtom.json

A LIA foi treinada com `velocidade_livre` = freeFlowSpeed da TomTom de cada ponto
(é feature e é o denominador do alvo). Na rota, a API usava o limite de via do
OSM (`speed_kph`) no lugar — mais alto, deixando o tempo otimista. Este artefato
dá à API a mesma velocidade livre do treino para as arestas do próprio trecho
monitorado (flag VEL_LIVRE_TOMTOM=1 na API).

Uso:  python free_flow_speeds.py [--parquet artifacts/backup_20260923_historico_trafego.parquet]
"""
import argparse
import json
import os
from datetime import datetime, timezone

import pandas as pd

ARTIFACTS = os.path.join(os.path.dirname(__file__), 'artifacts')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--parquet', default=os.path.join(ARTIFACTS, 'backup_20260923_historico_trafego.parquet'))
    args = ap.parse_args()

    df = pd.read_parquet(args.parquet, columns=['id_ponto', 'velocidade_livre'])
    df = df[df['velocidade_livre'] > 0]
    por_ponto = df.groupby('id_ponto')['velocidade_livre'].agg(['median', 'count'])
    saida = {
        'descricao': 'Mediana da freeFlowSpeed (km/h) da TomTom por id_ponto, no dataset do TCC.',
        'fonte': os.path.basename(args.parquet),
        'leituras': int(len(df)),
        'gerado_em': datetime.now(timezone.utc).isoformat(),
        'pontos': {str(int(i)): round(float(r['median']), 1) for i, r in por_ponto.iterrows()},
        'leituras_por_ponto_min': int(por_ponto['count'].min()),
    }
    destino = os.path.join(ARTIFACTS, 'velocidade_livre_tomtom.json')
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    print(f"{len(saida['pontos'])} pontos · mediana geral {por_ponto['median'].median():.1f} km/h → {destino}")


if __name__ == '__main__':
    main()
