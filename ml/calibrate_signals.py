"""
Calibra o atraso médio por semáforo contra a TomTom.

A soma de arestas da LIA não conta o tempo parado em cruzamento sinalizado. Para
N pares origem/destino sorteados (semente fixa → reprodutível), pede à API a rota
da LIA — a resposta já traz o ETA da TomTom *no mesmo trajeto* (fusão por
supportingPoints) — e ajusta, por mínimos quadrados sem intercepto:

    resíduo = TomTom_sem_trânsito − LIA  ≈  δ · semáforos  +  β · km

β absorve o viés de velocidade livre (limite de via do OSM × velocidade real),
para o δ não levar a culpa de tudo (regressão múltipla, não só semáforos).
Saída: ml/artifacts/semaforos_calibracao.json — a API lê na subida.

Uso (API rodando SEM calibração anterior, isto é, atraso atual = 0):
    python calibrate_signals.py --api http://127.0.0.1:8000 --n 60
Custo TomTom: por rota ~10 chamadas (Flow/Incidents do corredor + 1 Routing).
"""
import argparse
import json
import math
import os
import random
import time
from datetime import datetime, timezone

import httpx
import numpy as np

ARTIFACTS = os.path.join(os.path.dirname(__file__), 'artifacts')
CENTRO = (-15.793, -47.882)  # Plano Piloto — mesmo centro do grafo da API
RAIO_SORTEIO_KM = 25.0
PAUSA_S = 3.3  # a API limita 20 rotas/min por IP


def _ponto_aleatorio(rng: random.Random):
    r = RAIO_SORTEIO_KM * math.sqrt(rng.random())
    ang = rng.uniform(0, 2 * math.pi)
    dlat = (r / 111.32) * math.cos(ang)
    dlon = (r / (111.32 * math.cos(math.radians(CENTRO[0])))) * math.sin(ang)
    return CENTRO[0] + dlat, CENTRO[1] + dlon


def _km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def _ajustar(X: np.ndarray, y: np.ndarray):
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ coef
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1.0
    r2 = 1 - float(np.sum(resid ** 2)) / ss_tot
    gl = max(len(y) - X.shape[1], 1)
    sigma2 = float(np.sum(resid ** 2)) / gl
    ep = np.sqrt(np.diag(sigma2 * np.linalg.pinv(X.T @ X)))
    return coef, ep, r2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', default='http://127.0.0.1:8000')
    ap.add_argument('--n', type=int, default=60)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--saida', default=os.path.join(ARTIFACTS, 'semaforos_calibracao.json'),
                    help='outro caminho para experimentos (não sobrescreve o artefato oficial)')
    args = ap.parse_args()

    saude = httpx.get(f'{args.api}/health', timeout=30).json()
    if (saude.get('semaforos') or {}).get('atraso_s'):
        raise SystemExit('A API já aplica um atraso de semáforo. Remova ml/artifacts/semaforos_calibracao.json, '
                         'reinicie a API e rode de novo (senão o atraso entra duas vezes).')

    rng = random.Random(args.seed)
    linhas, chamadas = [], 0
    # Só chamadas à API contam no limite (sorteio fora da faixa de distância é
    # descartado de graça); ponto em lago/cerrado sai como fora da malha.
    while len(linhas) < args.n and chamadas < args.n * 4:
        o, d = _ponto_aleatorio(rng), _ponto_aleatorio(rng)
        if not 3.0 <= _km(o, d) <= 20.0:
            continue
        chamadas += 1
        try:
            r = httpx.post(f'{args.api}/route', timeout=120, json={
                'origem': {'lat': o[0], 'lon': o[1]}, 'destino': {'lat': d[0], 'lon': d[1]}})
        except httpx.HTTPError as e:
            print(f'  erro de rede: {type(e).__name__}')
            time.sleep(PAUSA_S)
            continue
        time.sleep(PAUSA_S)
        if r.status_code != 200:
            print(f'  rota recusada ({r.status_code})')
            continue
        j = r.json()
        tt = j.get('tomtom') or {}
        if j.get('fora_da_malha') or not tt.get('referencia_sem_transito_seg') or j.get('tempo_lia_seg') is None:
            continue
        # Distância da rota da LIA (se a TomTom venceu, a da LIA está em `alternativa`).
        km_lia = (j['alternativa'] or {}).get('distancia_km') if j.get('fonte_rota') == 'tomtom' else j['distancia_km']
        linhas.append({
            'semaforos': j.get('semaforos_na_rota') or 0,
            'km': km_lia,
            'lia_s': j['tempo_lia_seg'],
            'tomtom_sem_transito_s': tt['referencia_sem_transito_seg'],
            'tomtom_ao_vivo_s': tt.get('referencia_tempo_seg'),
            'cobertura_lia_pct': j.get('lia_cobertura_pct'),
        })
        print(f"  {len(linhas):>3}/{args.n}  {linhas[-1]['semaforos']:>2} semáforos  {km_lia:>5.1f} km  "
              f"LIA {j['tempo_lia_seg']:>5}s  TomTom s/ trânsito {tt['referencia_sem_transito_seg']:>5}s")

    if len(linhas) < 20:
        raise SystemExit(f'Só {len(linhas)} rotas válidas — pouco para calibrar.')

    X = np.array([[l['semaforos'], l['km']] for l in linhas], dtype=float)
    y = np.array([l['tomtom_sem_transito_s'] - l['lia_s'] for l in linhas], dtype=float)
    (delta, beta), (ep_delta, ep_beta), r2 = _ajustar(X, y)
    delta_bruto = float(delta)
    # Negativo ou absurdo não tem leitura física: limita a [0, 90] s e registra o bruto.
    delta = float(min(max(delta, 0.0), 90.0))

    agora = datetime.now(timezone.utc)
    saida = {
        'atraso_por_semaforo_seg': round(delta, 2),
        'atraso_por_semaforo_bruto_seg': round(delta_bruto, 2),
        'erro_padrao_delta_seg': round(float(ep_delta), 2),
        'vies_por_km_seg': round(float(beta), 2),
        'erro_padrao_vies_por_km_seg': round(float(ep_beta), 2),
        'r2': round(float(r2), 3),
        'n_rotas': len(linhas),
        'semaforos_media_por_rota': round(float(X[:, 0].mean()), 2),
        'metodo': ('OLS sem intercepto: (TomTom noTrafficTravelTime no mesmo trajeto − tempo LIA) '
                   '~ δ·semáforos + β·km; semáforos = nós OSM highway=traffic_signals na rota.'),
        'referencia_literatura': 'HCM: atraso de controle LOS B–C = 10–35 s/veículo; Webster d ≈ r²/2C.',
        'semente': args.seed,
        'velocidade_livre_api': saude.get('velocidade_livre', 'osm'),
        'gerado_em': agora.isoformat(),
        'hora_local_coleta': (agora.hour - 3) % 24,
        'amostras': linhas,
    }
    destino = args.saida
    os.makedirs(os.path.dirname(os.path.abspath(destino)), exist_ok=True)
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=2)
    print(f"\nδ = {delta:.1f} s/semáforo (bruto {delta_bruto:.1f} ± {ep_delta:.1f}), "
          f"β = {beta:.1f} s/km, R² = {r2:.2f}, n = {len(linhas)} → {destino}")
    print('Reinicie a API para aplicar.')


if __name__ == '__main__':
    main()
