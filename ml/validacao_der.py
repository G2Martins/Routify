"""
Contagem de veículos do DER-DF × lentidão observada → artifacts/validacao_der.json

O DER publica fluxo de 15 em 15 min nas rodovias distritais (CC-BY), sem velocidade e sem coordenada, só o código do
trecho. Não vira amostra nem alvo; serve como checagem independente da TomTom: nas horas de dia útil em que passam mais
carros, o dataset mostra mais lentidão? Compara a cidade por hora, porque não há como casar trecho com sensor sem a
geometria do Sistema Rodoviário.

    cd ml && ../apps/api/.venv/Scripts/python validacao_der.py
"""
import csv
import io
import json
import os
import re
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

BASE = 'https://dados.df.gov.br'
DATASET = BASE + '/o/dados-abertos/v1.0/datasets/volume-diario-de-trafego-trechos-rodoviarios'
MESES = ('março', 'abril', 'maio', 'junho', 'julho')  # a janela do dataset original da LIA
AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, 'artifacts', 'validacao_der.json')
SILVER = os.path.join(AQUI, 'artifacts', 'silver_20260922.parquet')
UA = {'User-Agent': 'Routify-TCC/1.0 (academic project)'}


def _abrir(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180)


def fluxo_por_hora():
    with _abrir(DATASET) as r:
        recursos = json.load(r)['resourceDetails']
    alvo = [x for x in recursos if x.get('format') == 'CSV' and re.search(r'(' + '|'.join(MESES) + r')/2026', x.get('name', ''), re.I)]
    soma, linhas, trechos, dias = defaultdict(float), 0, set(), set()
    for x in alvo:
        with _abrir(BASE + x['downloadUrl']) as r:
            for ln in csv.DictReader(io.TextIOWrapper(r, encoding='utf-8-sig', newline='')):
                if ln.get('porte', '').strip().lower() != 'total':
                    continue
                d = date.fromisoformat(ln['dia'])
                if d.weekday() >= 5:
                    continue
                soma[int(ln['intervalo'][:2])] += float(ln['fluxo'] or 0)
                linhas += 1
                trechos.add(ln['trecho'])
                dias.add(d)
    return soma, {'recursos': [x['name'] for x in alvo], 'linhas_total': linhas, 'trechos': len(trechos), 'dias_uteis': len(dias)}


def main():
    fluxo, info = fluxo_por_hora()
    df = pd.read_parquet(SILVER, columns=['velocidade_atual', 'velocidade_livre', 'data_hora_brasilia'])
    df = df[df['velocidade_livre'] > 0]
    t = df['data_hora_brasilia']
    util = df[t.dt.dayofweek < 5]
    razao = (util['velocidade_atual'] / util['velocidade_livre']).clip(0.05, 1.0).groupby(util['data_hora_brasilia'].dt.hour).mean()
    horas = list(range(24))
    f = np.array([fluxo.get(h, 0.0) for h in horas]) / max(info['dias_uteis'], 1)
    lent = np.array([1.0 - razao.get(h, np.nan) for h in horas])
    ok = ~np.isnan(lent) & (f > 0)
    r = float(np.corrcoef(f[ok], lent[ok])[0, 1])
    saida = {'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'fonte': DATASET, 'licenca': 'CC-BY', **info,
             'r_fluxo_x_lentidao': round(r, 3),
             'nota': 'Dias úteis, cidade inteira por hora. Só rodovias distritais; a coleta TomTom da janela é enviesada para 21h.',
             'por_hora': [{'hora': h, 'fluxo_dia': round(float(f[h])), 'lentidao': None if np.isnan(lent[h]) else round(float(lent[h]), 4)} for h in horas]}
    with open(SAIDA, 'w', encoding='utf-8') as fp:
        json.dump(saida, fp, ensure_ascii=False, indent=1)
    print({k: saida[k] for k in ('trechos', 'dias_uteis', 'linhas_total', 'r_fluxo_x_lentidao')})
    print([(p['hora'], p['fluxo_dia'], p['lentidao']) for p in saida['por_hora'] if p['hora'] in (3, 7, 8, 12, 18, 21)])


if __name__ == '__main__':
    main()
