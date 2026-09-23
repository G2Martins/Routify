"""
Calibração da confiança de Knowledge Transfer — orientador, item 2.

MOTIVAÇÃO
---------
route.py usava uma confiança fixa por faixa de distância para arestas sem via
monitorada própria, mas com uma via vizinha dentro de 500m:

    confianca = 1.0 se dist < 200m, 0.8 se dist < 500m, senão 0.6

O orientador perguntou de onde vem o 80% — resposta honesta: não vem de lugar
nenhum, era palpite. Este script mede, com dados reais, o quanto duas vias
monitoradas realmente se parecem em função da distância entre elas, e usa essa
curva para substituir a constante por uma função justificada.

METODOLOGIA
-----------
Para cada par de vias monitoradas (A, B), comparamos o perfil histórico de
congestionamento de uma com o da outra, faixa a faixa de (hora, dia_semana).
Se A e B realmente têm padrões parecidos, o erro entre seus perfis deve ser
pequeno quando A e B estão perto, e crescer com a distância — é essa curva
erro-vs-distância que queremos medir.

Dois pontos de referência ancoram a curva:

  - erro a distância ~0 (via contra ela mesma): o piso — quanto uma via varia
    internamente entre metade dos dados e a outra (proxy: dispersão do
    próprio perfil, perfil_via_hora_dow_std).
  - erro do fallback global (usar a mediana da cidade inteira para aquele
    horário, em vez de qualquer vizinha): o teto — a partir de que distância
    "pegar emprestado de um vizinho" deixa de valer a pena frente a só usar a
    média da cidade, que é o fallback que já existe para arestas sem nenhuma
    via a 500m.

A confiança de transferência é definida como where entre esses dois âncoras
o erro medido naquela distância cai: confiança 1.0 no piso, confiança 0.0 no
teto (a partir daí, transferir é pior que o fallback global, então não
deveria haver transferência nenhuma).

Não retreina o modelo — a mudança é só na fórmula de decaimento usada em
route.py, então o resultado é imediatamente aplicável sem novo treino.
"""
import json
import logging
import os
import sys
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'artifacts')

# Distância máxima considerada. O corte atual de route.py é 500m; vamos até
# 1500m para enxergar a curva de queda além do que já se usa.
DIST_MAX_M = 1500.0
RAIO_TERRA_M = 6_371_000.0

# Bins de distância para agregar o erro (metros).
BINS_M = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1200, 1500]


def carregar_vias_monitoradas():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', 'services', 'collector', 'config', '.env'))
    from supabase import create_client
    sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY'))
    resp = sb.table('vias_monitoradas').select('id_ponto,latitude,longitude').execute()
    linhas = [v for v in resp.data if v.get('latitude') and v.get('longitude')]
    ids = np.array([v['id_ponto'] for v in linhas])
    coords_rad = np.radians(np.array([[v['latitude'], v['longitude']] for v in linhas]))
    logging.info(f"Vias monitoradas com coordenada: {len(ids)}")
    return ids, coords_rad


def distancia_par_a_par(coords_rad: np.ndarray) -> np.ndarray:
    """Matriz (N,N) de distância haversine em metros, vetorizada."""
    lat = coords_rad[:, 0][:, None]
    lon = coords_rad[:, 1][:, None]
    dlat = lat - lat.T
    dlon = lon - lon.T
    a = np.sin(dlat / 2) ** 2 + np.cos(lat) * np.cos(lat.T) * np.sin(dlon / 2) ** 2
    return 2 * RAIO_TERRA_M * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def montar_matriz_perfis(ids: np.ndarray, perfis: dict) -> tuple[np.ndarray, list]:
    """Matriz (N, 168) via x (hora,dia_semana) de perfil_via_hora_dow. NaN onde falta."""
    vhd = perfis['via_hora_dow']['perfil_via_hora_dow']
    colunas = [(h, d) for h in range(24) for d in range(7)]
    col_idx = {c: i for i, c in enumerate(colunas)}

    M = np.full((len(ids), len(colunas)), np.nan)
    id_to_row = {vid: i for i, vid in enumerate(ids)}

    for (via, hora, dow), valor in vhd.items():
        if via not in id_to_row:
            continue
        row = id_to_row[via]
        col = col_idx.get((int(hora), int(dow)))
        if col is not None:
            M[row, col] = valor

    cobertura = (~np.isnan(M)).mean() * 100
    logging.info(f"Matriz de perfis: {M.shape}, {cobertura:.1f}% das células preenchidas")
    return M, colunas


def erro_par_a_par(M: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Para cada par de vias, erro médio absoluto entre perfis nas faixas em
    comum, e nº de faixas em comum usadas (para descartar pares com pouca
    sobreposição — não dá pra confiar num erro calculado sobre 2 faixas só).
    """
    N, K = M.shape
    erro = np.full((N, N), np.nan)
    n_comum = np.zeros((N, N), dtype=int)

    valido = ~np.isnan(M)
    for i in range(N):
        vi = M[i]
        vi_valido = valido[i]
        diffs = np.abs(M - vi[None, :])  # (N, K)
        comum = valido & vi_valido[None, :]
        n_comum[i] = comum.sum(axis=1)
        with np.errstate(invalid='ignore'):
            soma = np.where(comum, diffs, 0).sum(axis=1)
        erro[i] = np.where(n_comum[i] > 0, soma / np.maximum(n_comum[i], 1), np.nan)

    return erro, n_comum


def run():
    t0 = time.time()
    logging.info("=" * 70)
    logging.info("CALIBRAÇÃO DA CONFIANÇA DE KNOWLEDGE TRANSFER")
    logging.info("=" * 70)

    ids, coords = carregar_vias_monitoradas()
    perfis = joblib.load(os.path.join(MODELS_DIR, 'lia_2.1_profiles.pkl'))

    dist = distancia_par_a_par(coords)
    M, colunas = montar_matriz_perfis(ids, perfis)
    erro, n_comum = erro_par_a_par(M)

    # Só pares com pelo menos 20 faixas (hora,dow) em comum — evita erro
    # calculado sobre poucochíssimas amostras.
    MIN_FAIXAS_COMUNS = 20
    np.fill_diagonal(dist, np.nan)  # exclui via contra ela mesma
    mask_valido = (n_comum >= MIN_FAIXAS_COMUNS) & ~np.isnan(erro) & (dist <= DIST_MAX_M)

    dist_flat = dist[mask_valido]
    erro_flat = erro[mask_valido]
    logging.info(f"Pares via-via válidos (≤{DIST_MAX_M:.0f}m, ≥{MIN_FAIXAS_COMUNS} faixas em comum): {len(dist_flat):,}")

    # --- Âncora do piso: dispersão interna média de uma via (proxy de "erro
    # zero" -- o quanto uma via varia dela mesma) ---
    piso = float(perfis['via_hora_dow']['perfil_via_hora_dow_std'].mean())

    # --- Âncora do teto: erro de usar o fallback global (perfil_hora_dow) em
    # vez de qualquer vizinha -- é o nível a partir do qual transferir deixa
    # de valer a pena frente ao que já se usa quando não há via nenhuma perto ---
    hd = perfis['hora_dow']  # Series (hora,dow) -> perfil_hora_dow
    g = perfis['global']
    erros_fallback = []
    for (via, hora, dow), valor in perfis['via_hora_dow']['perfil_via_hora_dow'].items():
        ref = hd.get((int(hora), int(dow)), g)
        erros_fallback.append(abs(valor - ref))
    teto = float(np.mean(erros_fallback))

    logging.info(f"Âncora piso  (dispersão interna média de uma via): {piso:.4f}")
    logging.info(f"Âncora teto  (erro do fallback global 'perfil_hora_dow'): {teto:.4f}")

    # --- Curva erro médio por bin de distância ---
    bins = np.array(BINS_M)
    idx_bin = np.digitize(dist_flat, bins) - 1
    resumo = []
    for b in range(len(bins) - 1):
        sel = idx_bin == b
        if sel.sum() == 0:
            continue
        media = float(np.mean(erro_flat[sel]))
        # Confiança: 1.0 no piso, 0.0 no teto, linear entre eles, sem extrapolar.
        confianca = np.clip((teto - media) / max(teto - piso, 1e-6), 0.0, 1.0)
        resumo.append({
            'faixa_m': f"{bins[b]:.0f}-{bins[b+1]:.0f}",
            'centro_m': (bins[b] + bins[b+1]) / 2,
            'n_pares': int(sel.sum()),
            'erro_medio': round(media, 4),
            'confianca_calibrada': round(float(confianca), 3),
        })

    logging.info("\n--- Curva erro x distância ---")
    logging.info(f"{'faixa (m)':>12} {'n pares':>8} {'erro médio':>11} {'confiança calibrada':>20}")
    for r in resumo:
        logging.info(f"{r['faixa_m']:>12} {r['n_pares']:>8} {r['erro_medio']:>11.4f} {r['confianca_calibrada']:>20.3f}")

    # --- Comparação com a constante antiga ---
    antiga = {'<200m': 1.0, '200-500m': 0.8, '>=500m (até 1500m aqui)': 0.6}
    logging.info("\n--- Constante antiga (route.py) vs. calibrada ---")
    for faixa, conf_antiga in antiga.items():
        logging.info(f"  {faixa}: antiga fixa = {conf_antiga}")

    # --- Regressão isotônica: a curva NÃO monotônica dos bins acima mostra
    # ruído real (proximidade geográfica não garante mesmo tipo de via — uma
    # expressa e uma residencial podem estar a 150m e se comportar bem
    # diferente). Um ajuste linear simples ignoraria isso. Isotônica força
    # só a propriedade que faz sentido fisicamente — confiança nunca cresce
    # com a distância — sem impor uma forma (linear/exponencial) arbitrária,
    # e usa todos os 10.528 pares brutos, não só as 17 médias por bin.
    conf_por_par = np.clip((teto - erro_flat) / max(teto - piso, 1e-6), 0.0, 1.0)
    iso = IsotonicRegression(y_min=0.0, y_max=1.0, increasing=False, out_of_bounds='clip')
    iso.fit(dist_flat, conf_por_par)

    grade_m = np.arange(0, DIST_MAX_M + 1, 10.0)
    grade_conf = iso.predict(grade_m)
    logging.info("\nCurva isotônica ajustada (amostras a cada 100m):")
    for d in range(0, int(DIST_MAX_M) + 1, 100):
        logging.info(f"  {d:>5}m -> confiança {float(iso.predict([d])[0]):.3f}")

    saida = {
        'metodologia': {
            'piso_dispersao_interna': piso,
            'teto_erro_fallback_global': teto,
            'dist_max_m': DIST_MAX_M,
            'min_faixas_comuns': MIN_FAIXAS_COMUNS,
            'n_pares_totais': int(len(dist_flat)),
            'metodo_ajuste': 'IsotonicRegression (sklearn), increasing=False — só impõe que a confiança não cresça com a distância',
        },
        'curva_erro_distancia_bins': resumo,
        'curva_isotonica_grade_10m': {
            'distancias_m': grade_m.tolist(),
            'confiancas': grade_conf.tolist(),
        },
        'constante_antiga': antiga,
    }
    out_path = os.path.join(MODELS_DIR, 'calibracao_transfer.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=2)
    logging.info(f"Resultado salvo em: {out_path}")

    # Modelo isotônico serializado — API usa direto, sem reimplementar a curva.
    modelo_path = os.path.join(MODELS_DIR, 'transfer_confidence_isotonic.pkl')
    joblib.dump(iso, modelo_path, compress=3)
    logging.info(f"Modelo isotônico salvo em: {modelo_path}")

    logging.info(f"Concluído em {time.time()-t0:.1f}s")
    return saida


if __name__ == '__main__':
    run()
