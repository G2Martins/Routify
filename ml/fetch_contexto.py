"""
Baixa e versiona os dados de contexto da LIA 2.2 (reprodutível, sem chave):

  artifacts/chuva_brasilia.json   chuva horária (mm) no Plano Piloto — Open-Meteo
                                  Historical Weather API (ERA5/best match),
                                  fuso America/Sao_Paulo, cobrindo o dataset
  artifacts/feriados.json         feriados nacionais (BrasilAPI) dos anos pedidos;
                                  os distritais do DF entram em contexto.FERIADOS_DF

Uso: python fetch_contexto.py [--inicio 2026-03-01] [--fim 2026-07-31] [--anos 2026 2027]
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'api'))
from contexto import CENTRO_CHUVA  # noqa: E402

ARTIFACTS = os.path.join(os.path.dirname(__file__), 'artifacts')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--inicio', default='2026-03-01')
    ap.add_argument('--fim', default='2026-07-31')
    ap.add_argument('--anos', nargs='+', type=int, default=[2026, 2027])
    args = ap.parse_args()

    r = httpx.get('https://archive-api.open-meteo.com/v1/archive', timeout=60, params={
        'latitude': CENTRO_CHUVA[0], 'longitude': CENTRO_CHUVA[1],
        'start_date': args.inicio, 'end_date': args.fim,
        'hourly': 'precipitation', 'timezone': 'America/Sao_Paulo',
    })
    r.raise_for_status()
    chuva = r.json()
    horas = len(chuva['hourly']['time'])
    chovendo = sum(1 for v in chuva['hourly']['precipitation'] if v)
    with open(os.path.join(ARTIFACTS, 'chuva_brasilia.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'fonte': 'Open-Meteo Historical Weather API (CC BY 4.0) — https://open-meteo.com',
            'local': {'latitude': CENTRO_CHUVA[0], 'longitude': CENTRO_CHUVA[1], 'descricao': 'Plano Piloto'},
            'semantica': 'rótulo horário H = chuva acumulada de H-1 a H (mm), horário local',
            'baixado_em': datetime.now(timezone.utc).isoformat(),
            'hourly': {'time': chuva['hourly']['time'], 'precipitation': chuva['hourly']['precipitation']},
        }, f)
    print(f"chuva: {horas} horas ({args.inicio} → {args.fim}), {chovendo} com chuva")

    feriados = []
    for ano in args.anos:
        rf = httpx.get(f'https://brasilapi.com.br/api/feriados/v1/{ano}', timeout=30)
        rf.raise_for_status()
        feriados += [{'date': d['date'], 'name': d['name'], 'type': d.get('type')} for d in rf.json()]
    with open(os.path.join(ARTIFACTS, 'feriados.json'), 'w', encoding='utf-8') as f:
        json.dump({
            'fonte': 'BrasilAPI /api/feriados/v1 (nacionais) — distritais do DF em apps/api/contexto.py',
            'baixado_em': datetime.now(timezone.utc).isoformat(),
            'feriados': feriados,
        }, f, ensure_ascii=False, indent=1)
    print(f"feriados: {len(feriados)} nacionais em {args.anos}")


if __name__ == '__main__':
    main()
