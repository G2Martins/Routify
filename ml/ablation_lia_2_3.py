"""
Ablação da LIA 2.3 → artifacts/ablation_lia_2.3.json

Mede, nos MESMOS 5 folds temporais e com as features da 2.2 (contexto), o efeito
de cada mudança da receita, uma de cada vez:

  2.2           perfis in-sample, early stopping na validação (receita até a 2.2)
  +ES interno   early stopping no fim do próprio treino (a validação só mede)
  +perfis OOF   perfis fora da amostra nas linhas de treino
  2.3           + metade do treino com a recência envelhecida (15 a 480 min)

Cada variante reporta o erro com a recência fresca e envelhecida (15/30/60/120
min), ao lado da persistência e do perfil puro. É a tabela da tese e do painel.

    cd ml && ../apps/api/.venv/Scripts/python ablation_lia_2_3.py [--smoke]
"""
import argparse
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone

import features as feat
import train

VARIANTES = [
    ('2.2', dict(oof=False, envelhecer=False, es_interno=False)),
    ('+ES interno', dict(oof=False, envelhecer=False, es_interno=True)),
    ('+perfis OOF', dict(oof=True, envelhecer=False, es_interno=True)),
    ('2.3', dict(oof=True, envelhecer=True, es_interno=True)),
]


def preparar(linhas: int = 0):
    """Mesmo preparo do feat.run(com_contexto=True), sem gravar artefatos de versão."""
    df = feat.load_latest_silver()
    df, _ = feat.encode_id_ponto(df, os.path.join(tempfile.gettempdir(), 'routify_ablation_encoder.pkl'))
    df = feat.build_base(df)
    if linhas:
        df = df.iloc[:linhas].copy()
    df = feat.add_recency_features(df)
    df = feat.add_context_features(df, feat.ctx.vizinhos_monitorados(feat.carregar_coords_vias()))
    return df


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
        'features': cols,
        'hiperparametros': {k: v for k, v in params.items() if k != 'verbosity'},
        'variantes': [],
    }
    for nome, receita in VARIANTES:
        t0 = time.time()
        logging.info(f'===== variante {nome} {receita}')
        r = train.evaluate_cv(df, params, cols, **receita)
        saida['variantes'].append({
            'nome': nome, 'receita': receita,
            'cv': {k: round(v, 4) for k, v in r.items() if isinstance(v, float)},
            'por_idade': r['por_idade'], 'folds': r['folds'],
            'segundos': round(time.time() - t0, 1),
        })
        destino = os.path.join(feat.MODELS_DIR, 'ablation_lia_2.3_smoke.json' if args.smoke else 'ablation_lia_2.3.json')
        with open(destino, 'w', encoding='utf-8') as f:
            json.dump(saida, f, ensure_ascii=False, indent=2)
    logging.info(f'-> {destino}')


if __name__ == '__main__':
    main()
