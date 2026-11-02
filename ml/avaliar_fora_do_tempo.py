"""
Avaliação fora do tempo → artifacts/avaliacao_fora_do_tempo.json

Mede cada versão da LIA só nas leituras coletadas DEPOIS do treino (a coleta
voltou em 2026-11-02, a cada ~43 min e em todas as horas): dados que nenhum
modelo viu, com a recência chegando como chega na API. Compara, nas mesmas
linhas, com a persistência (repetir a última leitura) e o perfil puro.

    cd ml
    ../apps/api/.venv/Scripts/python silver.py                                  # puxa as leituras novas
    ../apps/api/.venv/Scripts/python fetch_contexto.py --fim AAAA-MM-DD         # chuva até a data
    ../apps/api/.venv/Scripts/python avaliar_fora_do_tempo.py --desde 2026-11-02 --versoes lia_2.2 lia_2.3
"""
import argparse
import json
import logging
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd

import features as feat
from train import _metricas

# Com a coleta a cada ~43 min, a leitura "fresca" já tem até ~43 min; as idades
# maiores simulam partidas no futuro.
IDADES_MIN = (60, 120, 240)
# A 1ª leitura nova de cada via tem recência de julho: fora da operação normal.
IDADE_NORMAL_MAX_MIN = 180


def _ler(versao: str, sufixo: str):
    caminho = os.path.join(feat.MODELS_DIR, f'{versao}{sufixo}')
    if sufixo.endswith('.json'):
        with open(caminho, encoding='utf-8') as f:
            return json.load(f)
    return joblib.load(caminho)


def preparar(silver: pd.DataFrame, versao: str):
    meta = _ler(versao, '_metadata.json')
    enc = _ler(versao, '_encoder.pkl')
    df = silver[silver['id_ponto'].isin(enc.classes_)].copy()
    df['id_ponto_enc'] = enc.transform(df['id_ponto'])
    df = feat.add_recency_features(feat.build_base(df))
    if meta.get('features_contexto'):
        viz = _ler(versao, '_vizinhos.json')
        df = feat.add_context_features(df, {int(p): v for p, v in viz['vizinhos'].items()})
    df = feat.apply_profiles(df, _ler(versao, '_profiles.pkl'))
    return df, meta


def _bloco(y, pred, t):
    m = _metricas(y, pred, t)
    return {'rmse_seg': round(m['rmse_seg'], 3), 'mae_seg': round(m['mae_seg'], 3)}


def avaliar(df: pd.DataFrame, meta: dict, modelo, desde: pd.Timestamp) -> dict:
    cols = meta['features']
    serie = feat.serie_observacoes(df)
    novos = df[df['data_hora_brasilia'] >= desde]
    idade_lag = np.expm1(novos['delta_min_lag1'].values)
    normal = novos[idade_lag <= IDADE_NORMAL_MAX_MIN]
    if normal.empty:
        raise SystemExit(f'nenhuma leitura nova em operação normal desde {desde}: rode silver.py')
    y, t = normal[feat.TARGET_COL].values, normal['tempo_viagem_segundos'].values
    pred = modelo.predict(normal[cols])
    out = {
        'n_linhas': int(len(normal)), 'n_descartadas_recencia_antiga': int(len(novos) - len(normal)),
        'periodo': [str(normal['data_hora_brasilia'].min()), str(normal['data_hora_brasilia'].max())],
        'idade_mediana_leitura_min': round(float(np.median(np.expm1(normal['delta_min_lag1']))), 1),
        'fresca': {'modelo': _bloco(y, pred, t),
                   'persistencia': _bloco(y, normal['razao_lag1'].values, t),
                   'perfil': _bloco(y, normal['perfil_via_hora_dow'].values, t)},
        'por_hora': [], 'por_idade': {},
    }
    for h, g in normal.assign(_p=pred).groupby('hora'):
        yy, tt = g[feat.TARGET_COL].values, g['tempo_viagem_segundos'].values
        out['por_hora'].append({'hora': int(h), 'n': int(len(g)),
                                'modelo': _bloco(yy, g['_p'].values, tt),
                                'persistencia': _bloco(yy, g['razao_lag1'].values, tt)})
    for idade in IDADES_MIN:
        r, d = feat.recencia_envelhecida(normal, serie, idade)
        ok = ~np.isnan(r)
        if ok.sum() < 100:
            continue
        v = normal.iloc[np.where(ok)[0]].copy()
        v['razao_lag1'], v['delta_min_lag1'] = r[ok], np.log1p(d[ok])
        if idade > feat.ctx.JANELA_VIZINHOS_MIN and 'vizinhos_razao' in v:
            v['vizinhos_razao'], v['vizinhos_n'] = np.nan, 0.0
        yy, tt = v[feat.TARGET_COL].values, v['tempo_viagem_segundos'].values
        out['por_idade'][str(idade)] = {'n': int(ok.sum()),
                                        'modelo': _bloco(yy, modelo.predict(v[cols]), tt),
                                        'persistencia': _bloco(yy, v['razao_lag1'].values, tt)}
    return out


def main():
    ap = argparse.ArgumentParser(description='LIA em dados coletados depois do treino')
    ap.add_argument('--desde', default='2026-11-02', help='primeiro dia (Brasília) da avaliação')
    ap.add_argument('--versoes', nargs='+', default=['lia_2.2', 'lia_2.3'])
    args = ap.parse_args()
    silver = feat.load_latest_silver()
    desde = pd.Timestamp(args.desde, tz=silver['data_hora_brasilia'].dt.tz)
    saida = {'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
             'desde': args.desde, 'versoes': {}}
    for versao in args.versoes:
        df, meta = preparar(silver, versao)
        fim_treino = pd.Timestamp(meta['periodo_fim'])
        if fim_treino >= desde:
            logging.warning(f'{versao}: treino vai até {fim_treino}, depois de --desde: NÃO é fora do tempo')
        saida['versoes'][versao] = {'fim_do_treino': str(fim_treino),
                                    **avaliar(df, meta, _ler(versao, '.pkl'), desde)}
        f = saida['versoes'][versao]['fresca']
        logging.info(f"{versao}: {saida['versoes'][versao]['n_linhas']:,} linhas | modelo {f['modelo']['rmse_seg']} s | "
                     f"persistência {f['persistencia']['rmse_seg']} s | perfil {f['perfil']['rmse_seg']} s")
    destino = os.path.join(feat.MODELS_DIR, 'avaliacao_fora_do_tempo.json')
    with open(destino, 'w', encoding='utf-8') as fh:
        json.dump(saida, fh, ensure_ascii=False, indent=2)
    logging.info(f'-> {destino}')


if __name__ == '__main__':
    main()
