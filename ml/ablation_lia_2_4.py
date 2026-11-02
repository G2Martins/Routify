"""
Ablação da LIA 2.4 → artifacts/ablation_lia_2.4.json

O erro de pico em produção (2026-11-02: LIA × TomTom no mesmo trajeto −12% no pico da tarde, −2 a −6%
fora dele) bate com o viés de cobertura do dataset: 23% das linhas às 21h, fim de semana com 1/8 do
volume (artifacts/cobertura_dataset.json). A 2.4 testa pesos por (hora, fim de semana) sobre a receita
da 2.3, nos MESMOS 5 folds e com os mesmos dados (sem novembro: um dia de feriado só mudaria os folds).

  2.3            receita da 2.3 (perfis OOF, recência envelhecida, early stopping interno)
  +pesos 0,5     peso = (média das células / linhas da célula) ** 0,5
  +pesos 1       peso = (média das células / linhas da célula) ** 1 (recortado em 0,1–10)

Além do erro geral, cada variante sai por período (pico de dia útil, dia, noite, madrugada, fim de
semana), com a leitura fresca e com a leitura de 30 min (perto da produção, coleta a cada 43 min).

    cd ml && ../apps/api/.venv/Scripts/python ablation_lia_2_4.py [--smoke]
"""
import argparse
import json
import logging
import os
import time
from datetime import datetime, timezone

import numpy as np

import features as feat
import train
from ablation_lia_2_3 import preparar

RECEITA_2_3 = dict(oof=True, envelhecer=True, es_interno=True)
VARIANTES = [
    ('2.3', dict(RECEITA_2_3)),
    ('+pesos 0,5', dict(RECEITA_2_3, alfa_pesos=0.5)),
    ('+pesos 1', dict(RECEITA_2_3, alfa_pesos=1.0)),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--smoke', action='store_true', help='150 mil linhas e 60 árvores: só testa o código')
    args = ap.parse_args()
    params = dict(train.XGB_PARAMS_MANUAL)
    if args.smoke:
        params['n_estimators'] = 60
    df = preparar(150_000 if args.smoke else 0)
    cols = feat.feature_cols(com_contexto=True)
    saida = {
        'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'smoke': args.smoke,
        'linhas': int(len(df)),
        'periodo': [str(df['data_hora_brasilia'].min()), str(df['data_hora_brasilia'].max())],
        'linhas_por_periodo': {str(k): int(v) for k, v in zip(*np.unique(train.periodo(df), return_counts=True))},
        'features': cols,
        'hiperparametros': {k: v for k, v in params.items() if k not in ('verbosity', 'device')},
        'variantes': [],
    }
    destino = os.path.join(feat.MODELS_DIR, 'ablation_lia_2.4_smoke.json' if args.smoke else 'ablation_lia_2.4.json')
    for nome, receita in VARIANTES:
        t0 = time.time()
        logging.info(f'===== variante {nome} {receita}')
        r = train.evaluate_cv(df, params, cols, **receita)
        saida['variantes'].append({
            'nome': nome, 'receita': receita,
            'cv': {k: round(v, 4) for k, v in r.items() if isinstance(v, float)},
            'por_idade': r['por_idade'], 'folds': r['folds'],
            'por_periodo': r['por_periodo'],
            f'por_periodo_recencia_{train.IDADE_PRODUCAO_MIN}min': r[f'por_periodo_recencia_{train.IDADE_PRODUCAO_MIN}min'],
            'segundos': round(time.time() - t0, 1),
        })
        with open(destino, 'w', encoding='utf-8') as f:
            json.dump(saida, f, ensure_ascii=False, indent=2)
    logging.info(f'-> {destino}')


if __name__ == '__main__':
    main()
