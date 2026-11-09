"""
Preditor estático × LIA → artifacts/baseline_estatico.json

Fecha a lacuna da hipótese do TCC (a LIA estima o tempo melhor que o roteamento
estático?) nos dois níveis em que dá para medir:

1. Trecho: razão = 1 (fluxo livre) nos mesmos 5 folds da CV. É generoso com o
   estático: usa a velocidade livre da TomTom, não o limite de via do OSM.
2. Rota: `comparacao_provedores` do comparador da EC2. O OSRM é o roteador sem
   trânsito; TomTom e Mapbox, com trânsito, são as referências (o Mapbox não
   alimenta o treino). IC de 95% por bootstrap das rodadas, que não são independentes
   dentro de si.

    cd ml
    ../apps/api/.venv/Scripts/python baseline_estatico.py             # as duas partes
    ../apps/api/.venv/Scripts/python baseline_estatico.py --so-rotas  # só a parte 2, rápida
"""
import argparse
import json
import logging
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit

import features as feat
import silver
import train
from ablation_lia_2_3 import preparar

SAIDA = os.path.join(feat.MODELS_DIR, 'baseline_estatico.json')
# Os folds da tese vêm deste Silver; um Silver mais novo mudaria os cortes.
SILVER_TESE = 'silver_20260922.parquet'
FERIADOS = {'2026-11-02'}  # ponytail: único feriado em dia útil na janela; 15/11/2026 é domingo
PROVEDORES = ('lia', 'osrm', 'tomtom', 'mapbox', 'tomtom_mesmo_trajeto')


def trecho() -> dict:
    feat.load_latest_silver = lambda: pd.read_parquet(os.path.join(feat.MODELS_DIR, SILVER_TESE), engine='pyarrow')
    with open(os.path.join(feat.MODELS_DIR, 'lia_2.3_metadata.json'), encoding='utf-8') as f:
        meta = json.load(f)
    df = preparar()
    estatico, base, pers = [], [], []
    for tr, val in TimeSeriesSplit(n_splits=train.N_SPLITS).split(df):
        v = feat.apply_profiles(df.iloc[val].copy(), feat.build_profiles(df.iloc[tr]))
        y, t = v[feat.TARGET_COL].values, v['tempo_viagem_segundos'].values
        estatico.append(train._metricas(y, np.ones(len(y)), t))
        base.append(train._metricas(y, v['perfil_via_hora_dow'].values, t))
        pers.append(train._metricas(y, v['razao_lag1'].values, t))
        logging.info(f"fold {len(estatico)}: estático {estatico[-1]['rmse_seg']:.2f} s")

    # Mesmos folds da tese: as referências têm de reproduzir o metadata da 2.3.
    media = lambda lista, c: float(np.mean([d[c] for d in lista]))
    assert abs(media(base, 'rmse_seg') - meta['cv']['baseline_rmse_seg']) < 0.01, 'baseline não reproduz os folds'
    assert abs(media(pers, 'rmse_seg') - meta['cv']['persistencia_rmse_seg']) < 0.01, 'persistência não reproduz os folds'

    lia = [f['rmse_seg'] for f in meta['cv_folds']]
    rmse = [d['rmse_seg'] for d in estatico]
    return {
        'silver': SILVER_TESE,
        'previsao': 'razão = 1 (tempo = comprimento / velocidade livre da TomTom)',
        'rmse_seg': round(media(estatico, 'rmse_seg'), 4), 'rmse_seg_std': round(float(np.std(rmse)), 4),
        'mae_seg': round(media(estatico, 'mae_seg'), 4),
        'rmse_seg_congestionado': round(media(estatico, 'rmse_seg_congestionado'), 4),
        'lia_2_3_rmse_seg': meta['cv']['modelo_rmse_seg'], 'lia_2_3_mae_seg': meta['cv']['modelo_mae_seg'],
        'ganho_rmse_lia_pct': round((media(estatico, 'rmse_seg') - meta['cv']['modelo_rmse_seg']) / media(estatico, 'rmse_seg') * 100, 1),
        'folds_lia_melhor_rmse': int(sum(a < b for a, b in zip(lia, rmse))),
        'folds': [{'rmse_seg': round(d['rmse_seg'], 4), 'mae_seg': round(d['mae_seg'], 4)} for d in estatico],
    }


def _ler_comparador() -> pd.DataFrame:
    client = silver.get_client()
    linhas, inicio, passo = [], 0, 1000
    while True:
        r = (client.table('comparacao_provedores').select('rodada_em,corredor,provedor,tempo_s')
             .in_('provedor', list(PROVEDORES)).order('id').range(inicio, inicio + passo - 1).execute())
        linhas += r.data
        if len(r.data) < passo:
            break
        inicio += passo
    d = pd.DataFrame(linhas)
    d['tempo_s'] = pd.to_numeric(d['tempo_s'])
    p = d.pivot_table(index=['rodada_em', 'corredor'], columns='provedor', values='tempo_s').dropna().reset_index()
    t = pd.to_datetime(p['rodada_em'], utc=True).dt.tz_convert('America/Sao_Paulo')
    h, util = t.dt.hour, (t.dt.dayofweek < 5) & ~t.dt.strftime('%Y-%m-%d').isin(FERIADOS)
    p['periodo'] = np.select([util & h.between(6, 9), util & h.between(17, 19), util],
                             ['pico_manha_util', 'pico_tarde_util', 'fora_pico_util'], default='fds_feriado')
    return p


def _erro(p: pd.DataFrame, a: str, ref: str) -> pd.Series:
    return (p[a] - p[ref]) / p[ref] * 100


def _ic_diferenca(p: pd.DataFrame, ref: str, n: int = 2000) -> list:
    """IC 95% de MAPE(OSRM) − MAPE(LIA): positivo = a LIA erra menos. Reamostra rodadas inteiras."""
    dif = (_erro(p, 'osrm', ref).abs() - _erro(p, 'lia', ref).abs()).groupby(p['rodada_em']).agg(['sum', 'count'])
    rng = np.random.default_rng(42)
    i = rng.integers(0, len(dif), (n, len(dif)))
    medias = dif['sum'].values[i].sum(axis=1) / dif['count'].values[i].sum(axis=1)
    return [round(float(x), 1) for x in np.percentile(medias, [2.5, 97.5])]


def _bloco(p: pd.DataFrame) -> dict:
    b = {'n': int(len(p)), 'rodadas': int(p['rodada_em'].nunique()), 'corredores': int(p['corredor'].nunique())}
    for ref in ('tomtom', 'mapbox'):
        for a in ('lia', 'osrm'):
            b[f'mape_{a}_x_{ref}'] = round(float(_erro(p, a, ref).abs().mean()), 1)
            b[f'vies_{a}_x_{ref}'] = round(float(_erro(p, a, ref).median()), 1)
        b[f'ic95_ganho_lia_x_{ref}'] = _ic_diferenca(p, ref)
    b['mape_lia_x_tomtom_mesmo_trajeto'] = round(float(_erro(p, 'lia', 'tomtom_mesmo_trajeto').abs().mean()), 1)
    b['vies_lia_x_tomtom_mesmo_trajeto'] = round(float(_erro(p, 'lia', 'tomtom_mesmo_trajeto').median()), 1)
    b['mape_tomtom_x_mapbox'] = round(float(_erro(p, 'tomtom', 'mapbox').abs().mean()), 1)
    return b


def rota() -> dict:
    p = _ler_comparador()
    grupos = {'total': p, 'pico_util': p[p['periodo'].isin(['pico_manha_util', 'pico_tarde_util'])]}
    for nome in ('pico_manha_util', 'pico_tarde_util', 'fora_pico_util', 'fds_feriado'):
        grupos[nome] = p[p['periodo'] == nome]
    return {
        'fonte': 'comparacao_provedores (viagens com os 5 provedores na mesma rodada)',
        'periodo_inicio': str(p['rodada_em'].min()), 'periodo_fim': str(p['rodada_em'].max()),
        'definicao': 'MAPE e viés mediano do tempo total em %; ic95_ganho = MAPE(OSRM) − MAPE(LIA), positivo = LIA erra menos',
        'grupos': {k: _bloco(v) for k, v in grupos.items() if len(v)},
    }


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
    ap = argparse.ArgumentParser()
    ap.add_argument('--so-rotas', action='store_true', help='mantém a parte 1 do JSON existente')
    args = ap.parse_args()
    saida = {}
    if args.so_rotas:
        with open(SAIDA, encoding='utf-8') as f:
            saida = json.load(f)
    else:
        saida['trecho'] = trecho()
    saida['rota'] = rota()
    saida['gerado_em'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=2)
    logging.info(f'Gravado: {SAIDA}')
    print(json.dumps(saida, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
