"""
Posições dos ônibus do DF (API aberta da SEMOB) → $STATE_DIRECTORY/AAAA-MM-DD.csv.gz

Único dado com velocidade independente da TomTom e presente nas regiões sem sensor. Serve para VALIDAR a LIA, não
como alvo de treino: ônibus para no ponto e usa faixa exclusiva, então a velocidade dele não é a do carro.
Licença não declarada na API: confirmar com a SEMOB antes de citar em texto. Só stdlib; roda a cada 2 min pelo
routify-gps.timer. Grava em disco, não no Supabase: ~50 MB/dia em bruto não cabem no plano grátis.

    STATE_DIRECTORY=/tmp/gps python coletar_gps_onibus.py
"""
import csv
import gzip
import json
import os
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

URL = 'https://www.sistemas.dftrans.df.gov.br/service/gps/operacoes'
BRASILIA = timezone(timedelta(hours=-3))
LAT, LON = (-16.1, -15.45), (-48.35, -47.25)
IDADE_MAX_S = 15 * 60
RETENCAO_DIAS = 60
DISCO_MIN_BYTES = 3 * 1024 ** 3  # abaixo disso não grava: a API e o coletor vêm primeiro


def linhas(dados: list, agora_s: float) -> list:
    """(horário em s, operadora, veículo, lat, lon, km/h, direção) das posições recentes e válidas no DF."""
    saida = []
    for op in dados or []:
        sigla = str((op.get('operadora') or {}).get('sigla') or '')[:10]
        for v in op.get('veiculos') or []:
            loc, vel, horario = v.get('localizacao') or {}, (v.get('velocidade') or {}).get('valor'), v.get('horario')
            lat, lon = loc.get('latitude'), loc.get('longitude')
            if not v.get('valid') or None in (lat, lon, vel, horario):
                continue
            if not (LAT[0] < lat < LAT[1] and LON[0] < lon < LON[1]) or not 0 <= vel <= 130:
                continue
            quando = horario / 1000
            if not -60 <= agora_s - quando <= IDADE_MAX_S:
                continue
            saida.append((int(quando), sigla, str(v.get('numero') or '')[:12], round(lat, 5), round(lon, 5), round(vel, 1), round(v.get('direcao') or 0)))
    return saida


def gravar(pasta: str, registros: list, hoje: str) -> None:
    with gzip.open(os.path.join(pasta, f'{hoje}.csv.gz'), 'at', encoding='utf-8', newline='') as f:
        csv.writer(f).writerows(registros)


def podar(pasta: str, agora_s: float) -> None:
    for nome in os.listdir(pasta):
        caminho = os.path.join(pasta, nome)
        if nome.endswith('.csv.gz') and agora_s - os.path.getmtime(caminho) > RETENCAO_DIAS * 86400:
            os.remove(caminho)


def main() -> int:
    pasta = os.environ.get('STATE_DIRECTORY', '/var/lib/routify-gps')
    os.makedirs(pasta, exist_ok=True)
    if shutil.disk_usage(pasta).free < DISCO_MIN_BYTES:
        print('disco abaixo do mínimo: nada gravado', file=sys.stderr)
        return 0
    req = urllib.request.Request(URL, headers={'User-Agent': 'Routify-TCC/1.0 (academic project)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        dados = json.load(r)
    agora = time.time()
    registros = linhas(dados, agora)
    gravar(pasta, registros, datetime.fromtimestamp(agora, BRASILIA).strftime('%Y-%m-%d'))
    podar(pasta, agora)
    print(f'{len(registros)} posições')
    return 0


if __name__ == '__main__':
    sys.exit(main())
