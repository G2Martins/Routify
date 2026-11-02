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
        if j.get('fora_da_malha') or not tt.get('referencia_sem_transito_seg') or j.get('tempo_lia_seg') is None:
            continue
        # Distância da rota da LIA (se a TomTom venceu, a da LIA está em `alternativa`).
        km_lia = (j['alternativa'] or {}).get('distancia_km') if j.get('fonte_rota') == 'tomtom' else j['distancia_km']
        linhas.append({
            'semaforos': j.get('semaforos_na_rota') or 0,
            'cruzamentos': j.get('cruzamentos_na_rota') or 0,
            'cruzamentos_via': j.get('cruzamentos_via_na_rota') or 0,
            'tomtom_km': tt.get('referencia_distancia_km'),
            'lia_livre_s': j.get('tempo_livre_lia_seg'),
            'livre_por_grupo_s': j.get('tempo_livre_por_grupo_s') or {},
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
    base = np.array([l['lia_livre_s'] if l.get('lia_livre_s') else l['lia_s'] for l in linhas], dtype=float)
    y = np.array([l['tomtom_sem_transito_s'] for l in linhas], dtype=float) - base
    X = np.array([[l['semaforos'], l['cruzamentos'], l.get('cruzamentos_via', 0)] for l in linhas], dtype=float)
    (delta, delta_c, delta_cv), (ep_delta, ep_delta_c, ep_delta_cv), r2 = _ajustar(X, y)
    # Conferência: com um termo por km (viés de velocidade livre que ainda sobrar).
    (_, _, _, beta), (_, _, _, ep_beta), r2_km = _ajustar(
        np.column_stack([X, [l['km'] for l in linhas]]).astype(float), y)
    delta_bruto, delta_c_bruto, delta_cv_bruto = float(delta), float(delta_c), float(delta_cv)
    # Negativo ou absurdo não tem leitura física: limita a [0, 90] s e registra o bruto.
    delta = float(min(max(delta, 0.0), 90.0))
    delta_c = float(min(max(delta_c, 0.0), 60.0))
    delta_cv = float(min(max(delta_cv, 0.0), 60.0))
    mape = lambda r: float(np.mean(np.abs(r) / np.array([l['tomtom_sem_transito_s'] for l in linhas])) * 100)
    mape_sem_grupo = mape(y - X @ np.array([delta, delta_c, delta_cv]))
    mape_depois = mape_sem_grupo

    # Velocidade livre por grupo de via, no nível da rota: TomTom sem trânsito ≈ Σ g·tempo livre do grupo
    # + atrasos (mínimos quadrados não negativos). Fator novo do grupo = fator atual / g.
    grupos = ['expressa', 'arterial', 'coletora', 'local']
    fatores_grupo, ajuste_grupo = None, None
    if all(l.get('livre_por_grupo_s') for l in linhas):
        from scipy.optimize import nnls
        Tg = np.array([[l['livre_por_grupo_s'].get(g, 0.0) for g in grupos] for l in linhas], dtype=float)
        A = np.column_stack([Tg, X])
        tt = np.array([l['tomtom_sem_transito_s'] for l in linhas], dtype=float)
        coef, _ = nnls(A, tt)
        base = float(((saude.get('velocidade_livre_fatores') or {}).get('fator')) or 1.0)
        peso_grupo = Tg.sum(axis=0) / Tg.sum()  # fatia do tempo de cada grupo na amostra
        # Grupo com menos de 5% do tempo da amostra não tem fator próprio: fica o atual.
        fatores_grupo = {g: round(min(max(base / c, 0.3), 1.0), 3) if c > 0 and w >= 0.05 else base
                         for g, c, w in zip(grupos, coef[:4], peso_grupo)}
        resid = tt - A @ coef
        ajuste_grupo = {'multiplicador_tempo_por_grupo': {g: round(float(c), 3) for g, c in zip(grupos, coef[:4])},
                        'fatia_do_tempo_por_grupo': {g: round(float(w), 3) for g, w in zip(grupos, peso_grupo)},
                        'atraso_semaforo_seg': round(float(coef[4]), 2),
                        'atraso_cruzamento_local_seg': round(float(coef[5]), 2),
                        'atraso_cruzamento_arterial_seg': round(float(coef[6]), 2),
                        'mape_pct': round(float(np.mean(np.abs(resid) / tt) * 100), 1),
                        'fator_base': base}
        # Com os fatores por grupo, os atrasos aplicados são os do ajuste conjunto (não os da regressão sem grupos).
        delta, delta_c, delta_cv = (float(min(max(c, 0.0), cap)) for c, cap in zip(coef[4:7], (90.0, 60.0, 60.0)))
        mape_depois = float(np.mean(np.abs(resid) / tt) * 100)

    agora = datetime.now(timezone.utc)
    saida = {
        'atraso_por_semaforo_seg': round(delta, 2),
        'atraso_por_semaforo_bruto_seg': round(delta_bruto, 2),
        'erro_padrao_delta_seg': round(float(ep_delta), 2),
        'atraso_por_cruzamento_seg': round(delta_c, 2),
        'atraso_por_cruzamento_bruto_seg': round(delta_c_bruto, 2),
        'erro_padrao_delta_cruzamento_seg': round(float(ep_delta_c), 2),
        'atraso_por_cruzamento_via_seg': round(delta_cv, 2),
        'atraso_por_cruzamento_via_bruto_seg': round(delta_cv_bruto, 2),
        'erro_padrao_delta_cruzamento_via_seg': round(float(ep_delta_cv), 2),
        'rotas_descartadas_desvio_tomtom': len(desvios),
        'vies_por_km_seg': round(float(beta), 2),
        'erro_padrao_vies_por_km_seg': round(float(ep_beta), 2),
        'r2': round(float(r2), 3),
        'r2_com_km': round(float(r2_km), 3),
        'mape_antes_pct': round(mape(y), 1),
        'mape_depois_pct': round(mape_depois, 1),  # do modelo aplicado (com grupos, o ajuste conjunto)
        'mape_depois_sem_grupo_pct': round(mape_sem_grupo, 1),
        'cruzamentos_media_por_rota': round(float(X[:, 1].mean()), 2),
        'fatores_velocidade_grupo': fatores_grupo,
        'ajuste_por_grupo': ajuste_grupo,
        'n_rotas': len(linhas),
        'semaforos_media_por_rota': round(float(X[:, 0].mean()), 2),
        'metodo': ('OLS sem intercepto: (TomTom noTrafficTravelTime no mesmo trajeto − tempo livre da LIA) '
                   '~ δ·semáforos + δc·cruzamentos; semáforos = nós OSM highway=traffic_signals na rota; '
                   'cruzamentos = nós com 3+ vizinhos sem semáforo, fora de via expressa. β·km só como conferência.'),
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
          f"δc local = {delta_c:.1f} s (bruto {delta_c_bruto:.1f} ± {ep_delta_c:.1f}), "
          f"δc arterial = {delta_cv:.1f} s (bruto {delta_cv_bruto:.1f} ± {ep_delta_cv:.1f}), "
          f"β = {beta:.1f} s/km (conferência), R² = {r2:.2f}, n = {len(linhas)} → {destino}")
    print('Reinicie a API para aplicar.')


if __name__ == '__main__':
    main()
