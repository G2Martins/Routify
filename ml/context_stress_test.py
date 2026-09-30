"""
Estresse treino × produção da LIA 2.2: 2.1 e 2.2 treinadas no fold 5 do
TimeSeriesSplit (mesmos hiperparâmetros) e avaliadas na validação com as
entradas degradadas que a API vê sem a coleta contínua:

  fresco            como no treino (leitura da via e dos vizinhos recentes)
  sem vizinhos      via lida agora, nenhum vizinho nos últimos 60 min
  chuva NaN / 0     Open-Meteo fora do ar (a API manda 0; NaN mostra por quê)
  tudo velho        fora do corredor: recência = perfil com 24 h, sem vizinhos

Saída: artifacts/lia_2.2_estresse.json (fonte dos números da tese).
Uso: python context_stress_test.py   (pede silver + backup de vias em artifacts/)
"""
import json
import logging
import math
import os
import tempfile

import numpy as np
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit

import features as feat
import train

CENARIOS = {
    'fresco': {},
    'sem_vizinhos': {'sem_viz': True},
    'chuva_zero': {'chuva': 0.0},
    'chuva_nan': {'chuva': np.nan},
    'tudo_velho': {'velho': True, 'sem_viz': True},
    'tudo_velho_chuva_nan': {'velho': True, 'sem_viz': True, 'chuva': np.nan},
}


def degradar(v, velho=False, sem_viz=False, chuva=None):
    v = v.copy()
    if velho:
        v['razao_lag1'] = v['perfil_via_hora_dow']
        v['delta_min_lag1'] = math.log1p(24 * 60)
    if sem_viz:
        v['vizinhos_razao'] = np.nan
        v['vizinhos_n'] = 0
    if chuva is not None:
        v['chuva_mm'] = chuva
        v['chuva_3h_mm'] = chuva
    return v


def main():
    logging.basicConfig(level=logging.WARNING)
    df = feat.load_latest_silver()
    df, _ = feat.encode_id_ponto(df, os.path.join(tempfile.gettempdir(), 'routify_enc_estresse.pkl'))
    df = feat.add_recency_features(feat.build_base(df))
    with open(os.path.join(feat.MODELS_DIR, 'lia_2.2_vizinhos.json'), encoding='utf-8') as f:
        viz = {int(k): v for k, v in json.load(f)['vizinhos'].items()}
    df = feat.add_context_features(df, viz)

    tr_idx, val_idx = list(TimeSeriesSplit(n_splits=train.N_SPLITS).split(df))[-1]
    perfis = feat.build_profiles(df.iloc[tr_idx])
    tr = feat.apply_profiles(df.iloc[tr_idx].copy(), perfis)
    val = feat.apply_profiles(df.iloc[val_idx].copy(), perfis)
    y_tr, y_val = tr[feat.TARGET_COL], val[feat.TARGET_COL]
    tempo = val['tempo_viagem_segundos'].values

    saida = {
        'descricao': __doc__.strip().splitlines()[0],
        'fold': train.N_SPLITS,
        'val_periodo': [str(val['data_hora_brasilia'].min()), str(val['data_hora_brasilia'].max())],
        'pct_linhas_sem_vizinho_recente': round(float((df['vizinhos_n'] == 0).mean() * 100), 2),
        'pct_linhas_com_chuva': round(float((df['chuva_mm'] > 0).mean() * 100), 2),
        'cenarios': {},
    }
    modelos = {}
    for nome, com_ctx in (('lia_2.1', False), ('lia_2.2', True)):
        cols = feat.feature_cols(com_ctx)
        m = xgb.XGBRegressor(**train.XGB_PARAMS_MANUAL)
        m.fit(tr[cols], y_tr, eval_set=[(val[cols], y_val)], verbose=False)
        modelos[nome] = (m, cols)

    for cen, kw in CENARIOS.items():
        v = degradar(val, **kw)
        saida['cenarios'][cen] = {}
        for nome, (m, cols) in modelos.items():
            r = train._metricas(y_val, np.clip(m.predict(v[cols]), 0.05, 1.0), tempo)
            saida['cenarios'][cen][nome] = {'rmse_seg': round(r['rmse_seg'], 4), 'mae_seg': round(r['mae_seg'], 4)}
        print(cen, saida['cenarios'][cen])

    with open(os.path.join(feat.MODELS_DIR, 'lia_2.2_estresse.json'), 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=2)


if __name__ == '__main__':
    main()
