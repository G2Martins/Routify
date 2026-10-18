"""
Fase 3 (leve) — coleta de amostras LIA × TomTom × menor distância, pra rodar
em produção via cron, várias vezes por dia, sem carregar grafo/modelo de novo.

DIFERENÇA PARA external_validation.py
--------------------------------------
external_validation.py carrega o grafo + modelo no próprio processo (~1,4 GB
de RAM) — ok pra rodar local ou no coletor, mas arriscado rodar várias vezes
por dia na mesma EC2 que já serve a API (t3.small, 2 GB total, unidade
`routify-api` já com MemoryMax=1500M). Esta versão não carrega nada: chama a
própria API já no ar via HTTP (GET/POST comuns, igual o app faz) e a TomTom
Routing API direto — RAM e CPU desprezíveis, seguro pra chamar 10x/dia ao
lado da API de produção.

Em troca, não calcula o "atraso por congestionamento" simulando horário de
referência fora de pico (isso exige rodar a LIA com hora manipulada, só dá
pra fazer em processo — ver rota_lia_offpeak em external_validation.py). Não
é perda: coletando em 10 horários reais e variados por dia, ao longo de um
mês, a própria variação real de horário já cobre pico/fora-pico — é
exatamente a mesma lógica que motivou rodar em várias horas/dias desde o
início (ver docstring de external_validation.py).

Uso (local ou na EC2, API já rodando):
    python external_validation_cron.py --api http://127.0.0.1:8000

Agendamento: ver crontab em deploy/crontab_fase3.txt (10 horários/dia).
"""
import argparse
import csv
import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta

import httpx

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOMTOM_KEYS_PATH = os.path.join(SCRIPT_DIR, '..', 'services', 'collector', 'config', 'tomtom_keys.json')
OUT_CSV = os.path.join(SCRIPT_DIR, 'artifacts', 'fase3_comparacao_cron.csv')

BRASILIA_TZ = timezone(timedelta(hours=-3))

# Mesmos 11 pares já validados em external_validation.py — cobre distâncias
# curtas/médias/longas e os corredores de cidade-satélite (EPTG/EPNB).
PARES = [
    ('Rodoviária → Aeroporto', (-15.7939, -47.8828), (-15.8697, -47.9172)),
    ('Asa Norte → Asa Sul', (-15.7601, -47.8825), (-15.8267, -47.9218)),
    ('Sudoeste → Lago Sul', (-15.7947, -47.9260), (-15.8360, -47.8620)),
    ('UnB → Esplanada dos Ministérios', (-15.7633, -47.8694), (-15.7995, -47.8640)),
    ('Parque da Cidade → Torre de TV', (-15.7986, -47.9019), (-15.7900, -47.8960)),
    ('Lago Norte (Iguatemi) → Setor Comercial Sul', (-15.7333, -47.8869), (-15.7954555, -47.8934785)),
    ('Cruzeiro → Asa Norte', (-15.7897, -47.9370), (-15.7601, -47.8825)),
    ('Guará I → Plano Piloto (via EPNB)', (-15.8302, -47.9756), (-15.7939, -47.8828)),
    ('Taguatinga Centro → Plano Piloto (via EPTG)', (-15.8330, -48.0530), (-15.7939, -47.8828)),
    ('Samambaia → Plano Piloto (via EPTG)', (-15.8580, -48.0760), (-15.7939, -47.8828)),
    ('Águas Claras → Plano Piloto (via EPTG)', (-15.8340, -48.0270), (-15.7939, -47.8828)),
]

CSV_CAMPOS = [
    'timestamp', 'hora', 'dia_semana', 'par',
    'origem_lat', 'origem_lon', 'destino_lat', 'destino_lon',
    'lia_tempo_seg', 'lia_distancia_km', 'lia_cobertura_pct', 'lia_modelo',
    'menor_dist_tempo_seg', 'menor_dist_distancia_km', 'rotas_diferentes',
    'tomtom_tempo_seg', 'tomtom_distancia_km',
    'tomtom_atraso_transito_seg', 'tomtom_tempo_sem_transito_seg', 'tomtom_erro',
]


def carregar_chave_tomtom(caminho: str) -> str:
    with open(caminho, 'r', encoding='utf-8') as f:
        data = json.load(f)
    chaves = data['tomtom_keys']
    # Mesmo índice usado em external_validation.py (key_08) — já confirmada
    # funcionando; se o pool mudou de tamanho, cai pra primeira.
    idx = 7 if len(chaves) > 7 else 0
    return chaves[idx]['key']


def rota_lia(api_url: str, origem, destino) -> dict:
    """POST /route na API já rodando — mesma chamada que o app mobile faz."""
    try:
        r = httpx.post(
            f"{api_url}/route",
            json={'origem': {'lat': origem[0], 'lon': origem[1]}, 'destino': {'lat': destino[0], 'lon': destino[1]}},
            timeout=30,
        )
        r.raise_for_status()
        d = r.json()
        return {
            'lia_tempo_seg': d.get('tempo_total_seg'),
            'lia_distancia_km': d.get('distancia_km'),
            'lia_cobertura_pct': d.get('lia_cobertura_pct'),
            'lia_modelo': d.get('modelo_utilizado'),
            'menor_dist_tempo_seg': d.get('tempo_rota_curta_seg'),
            'menor_dist_distancia_km': d.get('distancia_rota_curta_km'),
            'rotas_diferentes': d.get('rotas_diferentes'),
        }
    except Exception as e:
        logging.error(f"  /route falhou: {e}")
        return {k: None for k in (
            'lia_tempo_seg', 'lia_distancia_km', 'lia_cobertura_pct', 'lia_modelo',
            'menor_dist_tempo_seg', 'menor_dist_distancia_km', 'rotas_diferentes',
        )}


def rota_tomtom(chave: str, origem, destino) -> dict:
    """TomTom Routing API com tráfego ao vivo — referência externa, igual
    external_validation.py. Falha isolada não derruba a coleta do par."""
    url = f"https://api.tomtom.com/routing/1/calculateRoute/{origem[0]},{origem[1]}:{destino[0]},{destino[1]}/json"
    try:
        r = httpx.get(url, params={'key': chave, 'traffic': 'true', 'routeType': 'fastest'}, timeout=20)
        r.raise_for_status()
        s = r.json()['routes'][0]['summary']
        return {
            'tomtom_tempo_seg': s['travelTimeInSeconds'],
            'tomtom_distancia_km': round(s['lengthInMeters'] / 1000, 2),
            'tomtom_atraso_transito_seg': s.get('trafficDelayInSeconds'),
            'tomtom_tempo_sem_transito_seg': s.get('noTrafficTravelTimeInSeconds'),
            'tomtom_erro': None,
        }
    except Exception as e:
        logging.warning(f"  TomTom falhou: {e}")
        return {
            'tomtom_tempo_seg': None, 'tomtom_distancia_km': None,
            'tomtom_atraso_transito_seg': None, 'tomtom_tempo_sem_transito_seg': None,
            'tomtom_erro': str(e)[:200],
        }


def run(api_url: str, tomtom_keys_path: str, out_csv: str):
    t0 = time.time()
    agora = datetime.now(tz=BRASILIA_TZ)
    logging.info("=" * 70)
    logging.info("FASE 3 (cron) — LIA (via API) × TomTom × menor distância")
    logging.info(f"Executado em: {agora:%Y-%m-%d %H:%M} (hora={agora.hour}, dia_semana={agora.weekday()})")
    logging.info("=" * 70)

    chave = carregar_chave_tomtom(tomtom_keys_path)

    linhas = []
    for nome, origem, destino in PARES:
        logging.info(nome)
        lia = rota_lia(api_url, origem, destino)
        tomtom = rota_tomtom(chave, origem, destino)
        time.sleep(0.3)  # cortesia com as duas APIs

        linha = {
            'timestamp': agora.isoformat(),
            'hora': agora.hour,
            'dia_semana': agora.weekday(),
            'par': nome,
            'origem_lat': origem[0], 'origem_lon': origem[1],
            'destino_lat': destino[0], 'destino_lon': destino[1],
            **lia,
            **tomtom,
        }
        linhas.append(linha)

        if lia['lia_tempo_seg'] and tomtom['tomtom_tempo_seg']:
            diff_pct = (lia['lia_tempo_seg'] - tomtom['tomtom_tempo_seg']) / tomtom['tomtom_tempo_seg'] * 100
            logging.info(
                f"  LIA {lia['lia_tempo_seg']}s | TomTom {tomtom['tomtom_tempo_seg']}s "
                f"({diff_pct:+.1f}%) | atraso TomTom {tomtom.get('tomtom_atraso_transito_seg')}s "
                f"| cobertura LIA {lia.get('lia_cobertura_pct')}%"
            )
        else:
            logging.info("  par incompleto (LIA ou TomTom falharam) — registrado mesmo assim")

    os.makedirs(os.path.dirname(out_csv), exist_ok=True)
    escreve_cabecalho = not os.path.exists(out_csv)
    with open(out_csv, 'a', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=CSV_CAMPOS)
        if escreve_cabecalho:
            w.writeheader()
        for linha in linhas:
            w.writerow(linha)

    validas = sum(1 for l in linhas if l['lia_tempo_seg'] and l['tomtom_tempo_seg'])
    logging.info(f"\n{len(linhas)} linhas gravadas ({validas} com LIA+TomTom válidos) em {out_csv}")
    logging.info(f"Concluído em {time.time()-t0:.1f}s")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Coleta leve da Fase 3, via HTTP, sem carregar grafo/modelo')
    parser.add_argument('--api', default='http://127.0.0.1:8000', help='URL base da API (default: localhost)')
    parser.add_argument('--tomtom-keys', default=TOMTOM_KEYS_PATH)
    parser.add_argument('--out', default=OUT_CSV)
    args = parser.parse_args()

    run(args.api, args.tomtom_keys, args.out)
