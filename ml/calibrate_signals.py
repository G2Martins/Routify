"""
Calibra o atraso médio por semáforo e a velocidade livre por grupo de via contra a TomTom.

A soma de arestas da LIA não conta o tempo parado em cruzamento sinalizado. Para
N pares origem/destino sorteados (semente fixa → reprodutível), pede à API a rota
da LIA — a resposta já traz o ETA da TomTom *no mesmo trajeto* (fusão por
supportingPoints) — e ajusta, por mínimos quadrados não negativos no nível da rota:

    TomTom_sem_trânsito  ≈  Σ g · tempo_livre_do_grupo  +  δ · semáforos  +  δc · cruzamentos

Os g (expressa, arterial, coletora, local) absorvem o viés de velocidade livre (limite de via
do OSM × velocidade real), para o δ não levar a culpa de tudo.
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
from scipy.optimize import nnls

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', default='http://127.0.0.1:8000')
    ap.add_argument('--n', type=int, default=60)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--saida', default=os.path.join(ARTIFACTS, 'semaforos_calibracao.json'),
                    help='outro caminho para experimentos (não sobrescreve o artefato oficial)')
    args = ap.parse_args()

    saude = httpx.get(f'{args.api}/health', timeout=30).json()
    if any((saude.get('semaforos') or {}).get(k) for k in ('atraso_s', 'atraso_cruzamento_s', 'atraso_cruzamento_via_s')):
        raise SystemExit('A API já aplica atrasos calibrados. Suba a API com SEM_ATRASO_CALIBRADO=1 e rode de novo '
                         '(senão o atraso entra duas vezes).')

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
        if (j.get('fora_da_malha') or not tt.get('referencia_sem_transito_seg') or j.get('tempo_lia_seg') is None
                or not j.get('tempo_livre_por_grupo_s')):
            continue
        # Distância da rota da LIA (se a TomTom venceu, a da LIA está em `alternativa`).
        km_lia = (j['alternativa'] or {}).get('distancia_km') if j.get('fonte_rota') == 'tomtom' else j['distancia_km']
        linhas.append({
            'semaforos': j.get('semaforos_na_rota') or 0,
            'cruzamentos': j.get('cruzamentos_na_rota') or 0,
            'cruzamentos_via': j.get('cruzamentos_via_na_rota') or 0,
            'tomtom_km': tt.get('referencia_distancia_km'),
            'lia_livre_s': j.get('tempo_livre_lia_seg'),
            'livre_por_grupo_s': j['tempo_livre_por_grupo_s'],
            'km': km_lia,
            'lia_s': j['tempo_lia_seg'],
            'tomtom_sem_transito_s': tt['referencia_sem_transito_seg'],
            'tomtom_ao_vivo_s': tt.get('referencia_tempo_seg'),
            'cobertura_lia_pct': j.get('lia_cobertura_pct'),
        })
        print(f"  {len(linhas):>3}/{args.n}  {linhas[-1]['semaforos']:>2} semáforos  {km_lia:>5.1f} km  "
              f"LIA {j['tempo_lia_seg']:>5}s  TomTom s/ trânsito {tt['referencia_sem_transito_seg']:>5}s")

    # A TomTom às vezes reconstrói o trajeto com desvio: aí o ETA dela não é do mesmo caminho.
    desvios = [l for l in linhas if l.get('tomtom_km') and l['km'] and abs(l['tomtom_km'] / l['km'] - 1) > 0.10]
    linhas = [l for l in linhas if l not in desvios]
    print(f'{len(desvios)} rotas fora: a TomTom desviou mais de 10% do trajeto da LIA')
    if len(linhas) < 20:
        raise SystemExit(f'Só {len(linhas)} rotas válidas — pouco para calibrar.')

    # Tempo livre da LIA (sem a razão prevista) quando a API informa: calibra a qualquer hora sem
    # misturar congestionamento. Sem ele, o tempo da LIA (calibração antiga, de madrugada).
    livre_lia = np.array([l['lia_livre_s'] if l.get('lia_livre_s') else l['lia_s'] for l in linhas], dtype=float)
    tt = np.array([l['tomtom_sem_transito_s'] for l in linhas], dtype=float)
    X = np.array([[l['semaforos'], l['cruzamentos'], l.get('cruzamentos_via', 0)] for l in linhas], dtype=float)
    mape_antes = float(np.mean(np.abs(tt - livre_lia) / tt) * 100)

    # Velocidade livre por grupo de via, no nível da rota: TomTom sem trânsito ≈ Σ g·tempo livre do grupo
    # + atrasos (mínimos quadrados não negativos). Fator novo do grupo = fator atual / g.
    grupos = ['expressa', 'arterial', 'coletora', 'local']
    Tg = np.array([[l['livre_por_grupo_s'].get(g, 0.0) for g in grupos] for l in linhas], dtype=float)
    A = np.column_stack([Tg, X])
    coef, _ = nnls(A, tt)
    base = float(((saude.get('velocidade_livre_fatores') or {}).get('fator')) or 1.0)
    peso_grupo = Tg.sum(axis=0) / Tg.sum()  # fatia do tempo de cada grupo na amostra
    # Grupo com menos de 5% do tempo da amostra não tem fator próprio: fica o atual.
    fatores_grupo = {g: round(min(max(base / c, 0.3), 1.0), 3) if c > 0 and w >= 0.05 else base
                     for g, c, w in zip(grupos, coef[:4], peso_grupo)}
    resid = tt - A @ coef
    mape_depois = float(np.mean(np.abs(resid) / tt) * 100)
    ajuste_grupo = {'multiplicador_tempo_por_grupo': {g: round(float(c), 3) for g, c in zip(grupos, coef[:4])},
                    'fatia_do_tempo_por_grupo': {g: round(float(w), 3) for g, w in zip(grupos, peso_grupo)},
                    'atraso_semaforo_seg': round(float(coef[4]), 2),
                    'atraso_cruzamento_local_seg': round(float(coef[5]), 2),
                    'atraso_cruzamento_arterial_seg': round(float(coef[6]), 2),
                    'mape_pct': round(mape_depois, 1),
                    'fator_base': base}
    # Atrasos aplicados: os do ajuste conjunto, limitados (negativo ou absurdo não tem leitura física).
    delta, delta_c, delta_cv = (float(min(max(c, 0.0), cap)) for c, cap in zip(coef[4:7], (90.0, 60.0, 60.0)))

    agora = datetime.now(timezone.utc)
    saida = {
        'atraso_por_semaforo_seg': round(delta, 2),
        'atraso_por_cruzamento_seg': round(delta_c, 2),
        'atraso_por_cruzamento_via_seg': round(delta_cv, 2),
        'rotas_descartadas_desvio_tomtom': len(desvios),
        'mape_antes_pct': round(mape_antes, 1),
        'mape_depois_pct': round(mape_depois, 1),
        'cruzamentos_media_por_rota': round(float(X[:, 1].mean()), 2),
        'fatores_velocidade_grupo': fatores_grupo,
        'ajuste_por_grupo': ajuste_grupo,
        'n_rotas': len(linhas),
        'semaforos_media_por_rota': round(float(X[:, 0].mean()), 2),
        'metodo': ('NNLS no nível da rota: TomTom noTrafficTravelTime no mesmo trajeto ≈ Σ g·(tempo livre do grupo de via) '
                   '+ δ·semáforos + δc·cruzamentos de rua local + δcv·cruzamentos de via arterial; '
                   'semáforos = nós OSM highway=traffic_signals na rota; '
                   'cruzamentos = nós com 3+ vizinhos sem semáforo, fora de via expressa.'),
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
    print(f"\nδ = {delta:.1f} s/semáforo, δc local = {delta_c:.1f} s, δc arterial = {delta_cv:.1f} s, "
          f"MAPE {mape_antes:.1f}% → {mape_depois:.1f}%, n = {len(linhas)} → {destino}")
    print('Reinicie a API para aplicar.')


if __name__ == '__main__':
    main()
