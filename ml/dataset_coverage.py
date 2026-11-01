"""
Cobertura temporal do dataset (historico_trafego) → artifacts/cobertura_dataset.json

Responde, com número versionado, "quanto do dia e da semana o dataset enxerga":
linhas por hora (Brasília), por dia da semana, por dia; quais dias foram
"cheios" (coleta o dia todo) e que fração das linhas vem deles. É o artefato
por trás da limitação de cobertura temporal da tese e da decisão de retomar a
coleta (ver .planning/research/2026-11-01-analise-melhorias-e-testes.md).

Lê o parquet silver mais novo (silver.py é o único acesso ao banco).

    cd ml && ../apps/api/.venv/Scripts/python dataset_coverage.py [--silver artifacts/silver_YYYYMMDD.parquet]
"""
import argparse
import glob
import json
import os
from datetime import datetime, timezone

import pandas as pd

AQUI = os.path.dirname(os.path.abspath(__file__))
ARTEFATOS = os.path.join(AQUI, 'artifacts')
SAIDA = os.path.join(ARTEFATOS, 'cobertura_dataset.json')
# Um ciclo completo tem ~630 linhas; 80 ciclos (≈ 1 a cada 18 min) = dia coberto de ponta a ponta.
LIMIAR_DIA_CHEIO = 50_000
DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom']


def silver_mais_novo() -> str:
    arquivos = sorted(glob.glob(os.path.join(ARTEFATOS, 'silver_*.parquet')))
    if not arquivos:
        raise SystemExit('nenhum silver_*.parquet em ml/artifacts — rode silver.py primeiro')
    return arquivos[-1]


def cobertura(df: pd.DataFrame, limiar_dia_cheio: int = LIMIAR_DIA_CHEIO) -> dict:
    """Agregados de cobertura. Puro: recebe o silver, devolve o dicionário do JSON."""
    ts = df['data_hora_brasilia']
    por_hora = df.groupby(ts.dt.hour).size()
    por_dow = df.groupby(ts.dt.dayofweek).size()
    por_dia = df.groupby(ts.dt.date).size()
    cheios = por_dia[por_dia >= limiar_dia_cheio]
    total = int(len(df))
    dias_calendario = (ts.max().date() - ts.min().date()).days + 1
    return {
        'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'periodo_inicio': ts.min().isoformat(),
        'periodo_fim': ts.max().isoformat(),
        'total_linhas': total,
        'pontos_distintos': int(df['id_ponto'].nunique()),
        'dias_calendario': int(dias_calendario),
        'dias_com_coleta': int(len(por_dia)),
        'limiar_dia_cheio_linhas': limiar_dia_cheio,
        'dias_cheios': [d.isoformat() for d in cheios.index],
        'n_dias_cheios': int(len(cheios)),
        'pct_linhas_em_dias_cheios': round(100.0 * float(cheios.sum()) / total, 1),
        'mediana_linhas_dia': int(por_dia.median()),
        'ciclos_por_dia_mediana': round(float(por_dia.median()) / max(df['id_ponto'].nunique(), 1), 1),
        'linhas_por_hora_brasilia': {int(h): int(n) for h, n in por_hora.items()},
        'pct_hora_mais_coberta': round(100.0 * float(por_hora.max()) / total, 1),
        'hora_mais_coberta': int(por_hora.idxmax()),
        'linhas_por_dia_semana': {DIAS_SEMANA[int(d)]: int(n) for d, n in por_dow.items()},
        'razao_fim_de_semana_vs_dia_util': round(
            float(por_dow.reindex([5, 6]).fillna(0).mean()) / max(float(por_dow.reindex(range(5)).fillna(0).mean()), 1.0), 3),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--silver', default=None, help='parquet silver (padrão: o mais novo em artifacts/)')
    ap.add_argument('--saida', default=SAIDA)
    args = ap.parse_args()
    caminho = args.silver or silver_mais_novo()
    df = pd.read_parquet(caminho, columns=['id_ponto', 'data_hora_brasilia'])
    resultado = {'silver': os.path.basename(caminho), **cobertura(df)}
    with open(args.saida, 'w', encoding='utf-8') as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in resultado.items() if not k.startswith('linhas_por')},
                     ensure_ascii=False, indent=2))
    print(f'-> {args.saida}')


if __name__ == '__main__':
    main()
