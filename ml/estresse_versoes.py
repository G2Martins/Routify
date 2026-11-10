"""
Estresse treino × produção por versão → artifacts/estresse_versoes.json

Os modelos de produção (2.1 a 2.4), cada um com os próprios perfis e vizinhos, nas MESMAS leituras que nenhum deles viu
(a partir de `--desde`, depois do fim do treino da 2.4), com a entrada como chega na API e degradada:
  como_chega        leitura da via e dos vizinhos do jeito que a coleta entrega
  leitura_60/120    a leitura mais recente envelhecida (partida no futuro ou coleta atrasada)
  sem_vizinhos      nenhum vizinho com leitura nos últimos 60 min (fora do corredor consultado)
  chuva_zero        Open-Meteo fora do ar: a API manda 0
  tudo_velho        recência = perfil com 24 h e sem vizinhos: o pior caso de produção
Substitui, para o painel, o estresse 2.1 × 2.2 de context_stress_test.py, que treina receitas num fold.

    cd ml && ../apps/api/.venv/Scripts/python estresse_versoes.py --desde 2026-11-09
"""
import argparse
import json
import math
import os
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd

import features as feat
from avaliar_fora_do_tempo import IDADE_NORMAL_MAX_MIN, _bloco, preparar

VERSOES = ('lia_2.1', 'lia_2.2', 'lia_2.3', 'lia_2.4')
SAIDA = os.path.join(feat.MODELS_DIR, 'estresse_versoes.json')


def degradar(v: pd.DataFrame, velho=False, sem_viz=False, chuva=None) -> pd.DataFrame:
    v = v.copy()
    if velho:
        v['razao_lag1'] = v['perfil_via_hora_dow']
        v['delta_min_lag1'] = math.log1p(24 * 60)
    if sem_viz and 'vizinhos_razao' in v:
        v['vizinhos_razao'], v['vizinhos_n'] = np.nan, 0.0
    if chuva is not None and 'chuva_mm' in v:
        v['chuva_mm'], v['chuva_3h_mm'] = chuva, chuva
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--desde', default='2026-11-09')
    args = ap.parse_args()
    silver = feat.load_latest_silver()
    desde = pd.Timestamp(args.desde, tz=silver['data_hora_brasilia'].dt.tz)
    saida = {'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'desde': args.desde,
             'cenarios': ['como_chega', 'leitura_60min', 'leitura_120min', 'sem_vizinhos', 'chuva_zero', 'tudo_velho'],
             'versoes': {}, 'referencias': {}}
    linhas_ref = None
    for versao in VERSOES:
        df, meta = preparar(silver, versao)
        modelo = joblib.load(os.path.join(feat.MODELS_DIR, f'{versao}.pkl'))
        cols = meta['features']
        serie = feat.serie_observacoes(df)
        novos = df[df['data_hora_brasilia'] >= desde]
        normal = novos[np.expm1(novos['delta_min_lag1'].values) <= IDADE_NORMAL_MAX_MIN]
        chaves = set(zip(normal['id_ponto'], normal['data_hora_brasilia']))
        linhas_ref = chaves if linhas_ref is None else linhas_ref
        assert chaves == linhas_ref, 'as versões precisam medir as mesmas leituras'
        y, t = normal[feat.TARGET_COL].values, normal['tempo_viagem_segundos'].values
        bloco = {'como_chega': _bloco(y, modelo.predict(normal[cols]), t)}
        for idade in (60, 120):
            r, d = feat.recencia_envelhecida(normal, serie, idade)
            ok = ~np.isnan(r)
            if ok.sum() < 100:  # sem leitura tão antiga na série: o cenário não se aplica
                bloco[f'leitura_{idade}min'] = None
                continue
            v = normal.iloc[np.where(ok)[0]].copy()
            v['razao_lag1'], v['delta_min_lag1'] = r[ok], np.log1p(d[ok])
            v = degradar(v, sem_viz=idade > feat.ctx.JANELA_VIZINHOS_MIN)
            bloco[f'leitura_{idade}min'] = {**_bloco(v[feat.TARGET_COL].values, modelo.predict(v[cols]), v['tempo_viagem_segundos'].values), 'n': int(ok.sum())}
            if versao == VERSOES[-1]:
                saida['referencias'][f'persistencia_{idade}min'] = _bloco(v[feat.TARGET_COL].values, v['razao_lag1'].values, v['tempo_viagem_segundos'].values)
        for nome, kw in (('sem_vizinhos', {'sem_viz': True}), ('chuva_zero', {'chuva': 0.0}), ('tudo_velho', {'velho': True, 'sem_viz': True})):
            bloco[nome] = _bloco(y, modelo.predict(degradar(normal, **kw)[cols]), t)
        saida['versoes'][versao] = bloco
        saida['n_linhas'] = int(len(normal))
        saida['periodo'] = [str(normal['data_hora_brasilia'].min()), str(normal['data_hora_brasilia'].max())]
        if versao == VERSOES[-1]:
            saida['referencias']['persistencia'] = _bloco(y, normal['razao_lag1'].values, t)
            saida['referencias']['estatico'] = _bloco(y, np.ones(len(y)), t)
        print(versao, {k: (b['rmse_seg'], b['mae_seg']) for k, b in bloco.items() if b}, flush=True)
    with open(SAIDA, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    print('referencias', saida['referencias'], saida['n_linhas'], saida['periodo'])


if __name__ == '__main__':
    main()
