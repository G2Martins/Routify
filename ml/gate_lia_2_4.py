"""
Portão da LIA 2.4 → artifacts/gate_lia_2.4.json

A 2.4 é a receita da 2.3 treinada também com as leituras novas (coleta uniforme desde 2026-11-02). A CV não compara
versões com dados diferentes, então a decisão é fora do tempo: treina só com o que existia ANTES de cada janela e mede
nas mesmas linhas que a 2.3 de produção (treino até julho), com a recência como ela chega na API.

Regra, fixada antes de medir: a candidata só é adotada se ganhar da 2.3 em RMSE e em MAE nas duas janelas juntas e
não perder RMSE em nenhuma delas.

    cd ml
    ../apps/api/.venv/Scripts/python gate_lia_2_4.py
"""
import json
import logging
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

import features as feat
import train
from ablation_lia_2_3 import preparar

SAIDA = os.path.join(feat.MODELS_DIR, os.getenv('GATE_SAIDA', 'gate_lia_2.4.json'))
NOV = '2026-11-01'
JANELAS = (('dias_uteis', '2026-11-05', '2026-11-07'), ('fim_de_semana', '2026-11-07', '2026-11-09'))
IDADE_NORMAL_MAX_MIN = 180  # a 1ª leitura nova de cada via tem recência de julho: fora da operação normal
ARVORES = int(os.getenv('GATE_ARVORES', '600'))  # 600 = a 2.3; o treino final usa a mediana das paradas da CV (330 hoje)


def pesos_hora(df: pd.DataFrame) -> np.ndarray:
    """Equilibra (hora, fim de semana): 21h concentra 23% do dataset antigo. Peso limitado a [0,2; 5]."""
    chave = df['hora'].to_numpy() * 2 + (df['dia_semana'].to_numpy() >= 5)
    n = np.bincount(chave, minlength=48).astype(float)
    return np.clip(np.median(n[n > 0]) / n[chave], 0.2, 5.0)


VARIANTES = {
    'mesmo peso': lambda tr: None,
    'novembro peso 2': lambda tr: np.where(tr['data_hora_brasilia'] >= pd.Timestamp(NOV, tz=tr['data_hora_brasilia'].dt.tz), 2.0, 1.0),
    'hora equilibrada': pesos_hora,
}


def _metricas(y, p, t, rot) -> dict:
    tp = feat.razao_para_segundos(t, y, p)
    m = {'n': int(len(y)), 'rmse_seg': round(float(np.sqrt(np.mean((t - tp) ** 2))), 3),
         'mae_seg': round(float(np.mean(np.abs(t - tp))), 3), 'vies_seg': round(float(np.mean(tp - t)), 3), 'por_periodo': {}}
    for g in sorted(set(rot)):
        k = rot == g
        m['por_periodo'][g] = {'n': int(k.sum()), 'rmse_seg': round(float(np.sqrt(np.mean((t[k] - tp[k]) ** 2))), 2),
                               'mae_seg': round(float(np.mean(np.abs(t[k] - tp[k]))), 2)}
    return m


def main():
    logging.basicConfig(level=logging.WARNING)
    df = preparar()
    t = df['data_hora_brasilia']
    tz = t.dt.tz
    cols = feat.feature_cols(True)
    serie = feat.serie_observacoes(df)
    params = dict(train.PARAMS_POR_NOME['manual'], n_estimators=ARVORES)
    params.pop('early_stopping_rounds', None)
    if train.check_gpu_availability(False):
        params['device'] = 'cuda'
    m23 = joblib.load(os.path.join(feat.MODELS_DIR, 'lia_2.3.pkl'))
    p23 = joblib.load(os.path.join(feat.MODELS_DIR, 'lia_2.3_profiles.pkl'))

    res = {'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'silver_ate': str(t.max()),
           'regra': 'ganhar da 2.3 em RMSE e MAE nas janelas juntas e não perder RMSE em nenhuma', 'janelas': {}}
    soma = {}
    for nome, ini, fim in JANELAS:
        a, b = pd.Timestamp(ini, tz=tz), pd.Timestamp(fim, tz=tz)
        te_raw = df[(t >= a) & (t < b)]
        te_raw = te_raw[np.expm1(te_raw['delta_min_lag1'].to_numpy()) <= IDADE_NORMAL_MAX_MIN]
        rot = train.periodo(te_raw)
        y, tt = te_raw[feat.TARGET_COL].to_numpy(), te_raw['tempo_viagem_segundos'].to_numpy()
        ref = feat.apply_profiles(te_raw.copy(), p23)
        bloco = {'lia_2.3': _metricas(y, np.clip(m23.predict(ref[m23.get_booster().feature_names]), 0.05, 1.0), tt, rot),
                 'persistencia': _metricas(y, ref['razao_lag1'].to_numpy(), tt, rot),
                 'estatico': _metricas(y, np.ones(len(y)), tt, rot)}
        tr_raw = df[t < a]
        perfis = feat.build_profiles(tr_raw)
        tr = feat.envelhecer_recencia(feat.apply_profiles_oof(tr_raw), serie)
        te = feat.apply_profiles(te_raw.copy(), perfis)
        for v, peso in VARIANTES.items():
            m = xgb.XGBRegressor(**params).fit(tr[cols], tr[feat.TARGET_COL], sample_weight=peso(tr), verbose=False)
            bloco[v] = _metricas(y, np.clip(m.predict(te[cols]), 0.05, 1.0), tt, rot)
        res['janelas'][nome] = {'de': ini, 'ate': fim, 'n_treino': int(len(tr)), **bloco}
        for k, b_ in bloco.items():
            s = soma.setdefault(k, {'se': 0.0, 'ae': 0.0, 'n': 0})
            s['se'] += b_['rmse_seg'] ** 2 * b_['n']; s['ae'] += b_['mae_seg'] * b_['n']; s['n'] += b_['n']
        print(nome, {k: (b_['rmse_seg'], b_['mae_seg']) for k, b_ in bloco.items()}, flush=True)

    res['juntas'] = {k: {'n': s['n'], 'rmse_seg': round((s['se'] / s['n']) ** 0.5, 3), 'mae_seg': round(s['ae'] / s['n'], 3)} for k, s in soma.items()}
    base = res['juntas']['lia_2.3']
    aprovadas = [v for v in VARIANTES if res['juntas'][v]['rmse_seg'] < base['rmse_seg'] and res['juntas'][v]['mae_seg'] < base['mae_seg']
                 and all(res['janelas'][j][v]['rmse_seg'] <= res['janelas'][j]['lia_2.3']['rmse_seg'] for j in res['janelas'])]
    res['aprovadas'] = aprovadas
    res['escolhida'] = min(aprovadas, key=lambda v: res['juntas'][v]['rmse_seg']) if aprovadas else None
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print('juntas', res['juntas'], flush=True)
    print('escolhida:', res['escolhida'], flush=True)


if __name__ == '__main__':
    main()
