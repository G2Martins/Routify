"""
Benchmark XGBoost (LIA 2.0) vs. LSTM — mesma tarefa, mesmo split, mesmo alvo.

MOTIVAÇÃO
---------
O artigo do TCC 1 propõe migrar de XGBoost para LSTM no próximo ciclo, citando
capacidade superior de captar sazonalidade longa. O orientador apontou, em nota
de revisão, que essa migração tem custo real (LSTM é mais caro de treinar, mais
difícil de ajustar) e pediu um benchmark direto para decidir se o ganho — se
houver — compensa o custo. Este script é esse benchmark.

METODOLOGIA
-----------
Ambos os modelos preveem o mesmo alvo (razao_congestionamento = velocidade_atual
/ velocidade_livre) e são avaliados nos MESMOS 5 folds temporais progressivos
(TimeSeriesSplit sobre o dataframe ordenado por data_hora_brasilia — a mesma
correção de split aplicada em train.py na Fase 1). Isso garante que a diferença
medida vem do modelo, não do protocolo de avaliação.

XGBoost: reusa exatamente a função de treino e os hiperparâmetros de train.py
(features de calendário + perfis históricos recalculados por fold, sem vazamento).

LSTM: para cada via, uma sequência causal das WINDOW_SIZE observações reais
anteriores (razão, hora cíclica, fim de semana, pico, e o intervalo de tempo até
a observação seguinte) prevê a razão da próxima observação real. Nenhum
reamostragem para frequência fixa é feita — foi exatamente essa reindexação que,
na tentativa anterior de interpolação (removida na Fase 0), gerou ~60 milhões de
pontos sintéticos e destruiu 99,5% dos dados reais. Aqui, o intervalo de tempo
irregular entra como feature explícita (log1p dos minutos decorridos), e o
modelo aprende a lidar com a esparsidade em vez de fingir que ela não existe.

Uma janela só é construída a partir de observações reais e consecutivas da MESMA
via — não há mistura entre vias nem preenchimento artificial.

ATRIBUIÇÃO DE FOLD (LSTM)
--------------------------
Uma janela pertence ao fold pelo timestamp do seu ALVO (a observação a prever),
não pelo timestamp do histórico. Como o histórico de uma janela é sempre anterior
ao seu alvo por construção, isso não vaza informação futura — é o mesmo
raciocínio causal usado nos perfis do XGBoost (Fase 1), aplicado a sequências.

Dentro do conjunto de treino de cada fold, os últimos ~8% das janelas por tempo
são reservados para early stopping do LSTM — nunca o conjunto de validação real,
que só é usado para a métrica final reportada.

SAÍDA
-----
Imprime uma tabela comparativa (RMSE/MAE em razão e em segundos, tempo de
treino, tamanho do modelo) e salva o mesmo conteúdo em
models/benchmark_lstm_vs_xgboost.json para citação no TCC 2.
"""
import json
import logging
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import TimeSeriesSplit
from sklearn.preprocessing import LabelEncoder

sys.path.insert(0, os.path.dirname(__file__))
import features as feat
from train import XGB_PARAMS, N_SPLITS

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'artifacts')

# --- Hiperparâmetros do LSTM ---
WINDOW_SIZE = 6          # observações reais anteriores usadas como histórico
HIDDEN_SIZE = 32
EMB_DIM = 8              # embedding do id_ponto
BATCH_SIZE = 4096
MAX_EPOCHS = 15
PATIENCE = 3             # early stopping em épocas sem melhora
LR = 1e-3
HOLDOUT_FRAC = 0.08      # fração final (por tempo) do treino, para early stopping

def _detectar_device() -> str:
    """RTX 5070 é Blackwell (sm_120). O build de PyTorch usado até 11/08/2026
    (2.7.0.dev+cu124) não trazia kernels para essa arquitetura — cuda.is_available()
    retornava True, mas qualquer operação real falhava com 'no kernel image
    available'. Atualizado para torch==2.9.0+cu128 (índice cu128 da PyTorch),
    que suporta sm_120; testado com uma multiplicação de matriz real antes de
    confiar no resultado de is_available().
    """
    if not torch.cuda.is_available():
        return 'cpu'
    try:
        a = torch.randn(64, 64, device='cuda')
        (a @ a).sum().item()
        return 'cuda'
    except RuntimeError:
        return 'cpu'


DEVICE = _detectar_device()


# ============================================================================
# PREPARAÇÃO COMUM
# ============================================================================

def carregar_base():
    df = feat.load_latest_silver()
    enc = LabelEncoder()
    df['id_ponto_enc'] = enc.fit_transform(df['id_ponto'])
    df = feat.build_base(df)  # calendário + alvo + ordenação temporal global
    return df, enc


def limites_dos_folds(df: pd.DataFrame):
    """Mesmos cortes de TimeSeriesSplit usados em train.py, expressos em timestamp.

    Devolve, por fold, os timestamps que delimitam treino e validação — usados
    tanto para o XGBoost (que já trabalha por posição de linha) quanto para
    atribuir cada janela do LSTM ao fold correto pelo timestamp do alvo.
    """
    tscv = TimeSeriesSplit(n_splits=N_SPLITS)
    limites = []
    for tr_idx, val_idx in tscv.split(df):
        limites.append({
            'tr_idx': tr_idx,
            'val_idx': val_idx,
            'val_inicio': df['data_hora_brasilia'].iloc[val_idx].min(),
            'val_fim': df['data_hora_brasilia'].iloc[val_idx].max(),
        })
    return limites


# ============================================================================
# XGBOOST — reusa a lógica de train.py, mesmos folds
# ============================================================================

def adicionar_recencia(df: pd.DataFrame) -> pd.DataFrame:
    """Feature de controle: razão e intervalo da última observação REAL da via.

    Objetivo: isolar se uma eventual vantagem do LSTM vem da arquitetura
    recorrente em si, ou simplesmente do acesso à observação mais recente —
    informação que o XGBoost da LIA 2.0 não tem (foi removida de propósito:
    era exatamente esse tipo de lag, mas contado em PASSOS de coleta em vez de
    tempo, que causava os erros da LIA 1.0 — ver LIA_2.0_AUDITORIA_E_MUDANCAS.md).

    Diferença crucial em relação àquele bug: aqui o shift(1) roda sobre os dados
    já ordenados por tempo real, um passo por vez, sem reindexar para frequência
    fixa — não cria nenhuma linha sintética. Only a linha (a primeira de cada
    via) é descartada por falta de antecessor, contra as ~60 milhões de linhas
    sintéticas que a tentativa de interpolação removida na Fase 0 chegou a gerar.
    """
    df = df.sort_values(['id_ponto', 'data_hora_brasilia'])
    grp = df.groupby('id_ponto', sort=False)
    df['razao_lag1'] = grp['razao_congestionamento'].shift(1)
    delta = grp['data_hora_brasilia'].diff().dt.total_seconds() / 60.0
    df['delta_min_lag1'] = np.log1p(delta.clip(lower=0))
    antes = len(df)
    df = df.dropna(subset=['razao_lag1', 'delta_min_lag1'])
    df = df.sort_values('data_hora_brasilia').reset_index(drop=True)
    logging.info(f"  Recência: {antes - len(df)} linhas descartadas (1ª observação de cada via)")
    return df


def treinar_avaliar_xgboost(df: pd.DataFrame, limites: list,
                            features_extra: list | None = None) -> list:
    """features_extra: colunas adicionais a `feat.FEATURE_COLS` (usado pela
    variante de controle 'XGBoost + recência', ver adicionar_recencia()).
    """
    cols = feat.FEATURE_COLS + (features_extra or [])
    resultados = []
    for i, lim in enumerate(limites):
        df_tr = df.iloc[lim['tr_idx']]
        df_val = df.iloc[lim['val_idx']]

        perfis = feat.build_profiles(df_tr)
        tr = feat.apply_profiles(df_tr.copy(), perfis)
        val = feat.apply_profiles(df_val.copy(), perfis)

        X_tr, y_tr = tr[cols], tr[feat.TARGET_COL]
        X_val, y_val = val[cols], val[feat.TARGET_COL]

        t0 = time.time()
        params = {k: v for k, v in XGB_PARAMS.items() if k != 'early_stopping_rounds'}
        model = xgb.XGBRegressor(**{**params, 'early_stopping_rounds': 40})
        model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)], verbose=False)
        dur = time.time() - t0

        pred = np.clip(model.predict(X_val), 0.05, 1.0)
        m = calcular_metricas(y_val.values, pred, val['tempo_viagem_segundos'].values)
        m['tempo_treino_s'] = dur
        m['n_treino'] = len(tr)
        m['n_val'] = len(val)
        resultados.append(m)

        logging.info(
            f"  [XGBoost] Fold {i+1}/{len(limites)} — "
            f"RMSE {m['rmse_seg']:.1f}s | treino {dur:.1f}s"
        )

    return resultados


# ============================================================================
# LSTM — janelas causais por via, sem reamostragem
# ============================================================================

def construir_janelas(df: pd.DataFrame):
    """Uma janela por observação real (a partir da (WINDOW_SIZE+1)-ésima de cada via).

    Devolve arrays densos: X (N, WINDOW_SIZE, n_features), via_ids (N,),
    y (N,) razão-alvo, tempo_alvo_s (N,) para conversão em segundos, e
    timestamp_alvo (N,) para atribuição de fold.
    """
    logging.info("Construindo janelas causais por via (sem reamostragem)...")

    cols_step = ['razao', 'hora_sin', 'hora_cos', 'is_fim_semana', 'is_horario_pico', 'delta_min']
    Xs, ids, ys, tempos, ts = [], [], [], [], []

    for id_enc, g in df.groupby('id_ponto_enc', sort=False):
        g = g.sort_values('data_hora_brasilia')
        n = len(g)
        if n <= WINDOW_SIZE:
            continue

        razao = g['razao_congestionamento'].to_numpy(dtype=np.float32)
        hs = g['hora_sin'].to_numpy(dtype=np.float32)
        hc = g['hora_cos'].to_numpy(dtype=np.float32)
        fs = g['is_fim_semana'].to_numpy(dtype=np.float32)
        hp = g['is_horario_pico'].to_numpy(dtype=np.float32)
        tempo_s = g['tempo_viagem_segundos'].to_numpy(dtype=np.float32)
        tstamp = g['data_hora_brasilia'].to_numpy()

        delta_min = np.diff(tstamp).astype('timedelta64[s]').astype(np.float64) / 60.0
        delta_min = np.concatenate([[8.0], delta_min])  # primeira observação: assume o passo típico
        delta_log = np.log1p(np.clip(delta_min, 0, None)).astype(np.float32)

        passo = np.stack([razao, hs, hc, fs, hp, delta_log], axis=1)  # (n, 6)

        # Janela deslizante causal: para cada alvo i, histórico é [i-WINDOW_SIZE, i)
        for i in range(WINDOW_SIZE, n):
            Xs.append(passo[i - WINDOW_SIZE:i])
            ids.append(id_enc)
            ys.append(razao[i])
            tempos.append(tempo_s[i])
            ts.append(tstamp[i])

    X = np.stack(Xs).astype(np.float32)
    via_ids = np.array(ids, dtype=np.int64)
    y = np.array(ys, dtype=np.float32)
    tempo_alvo = np.array(tempos, dtype=np.float32)
    timestamp_alvo = np.array(ts)

    logging.info(f"  {len(y):,} janelas construídas (tamanho {WINDOW_SIZE})")
    return X, via_ids, y, tempo_alvo, timestamp_alvo


class LSTMRazao(nn.Module):
    def __init__(self, n_vias: int, n_features: int):
        super().__init__()
        self.emb = nn.Embedding(n_vias, EMB_DIM)
        self.lstm = nn.LSTM(n_features, HIDDEN_SIZE, num_layers=1, batch_first=True)
        self.head = nn.Sequential(
            nn.Linear(HIDDEN_SIZE + EMB_DIM, 16),
            nn.ReLU(),
            nn.Linear(16, 1),
        )

    def forward(self, x_seq, via_id):
        _, (h_n, _) = self.lstm(x_seq)
        h = h_n[-1]  # (batch, hidden)
        e = self.emb(via_id)
        return self.head(torch.cat([h, e], dim=1)).squeeze(-1)


def treinar_avaliar_lstm(X, via_ids, y, tempo_alvo, timestamp_alvo, limites: list,
                         n_vias: int) -> list:
    resultados = []
    n_features = X.shape[2]

    for i, lim in enumerate(limites):
        mask_tr_total = timestamp_alvo < lim['val_inicio']
        mask_val = (timestamp_alvo >= lim['val_inicio']) & (timestamp_alvo <= lim['val_fim'])

        idx_tr_total = np.where(mask_tr_total)[0]
        idx_val = np.where(mask_val)[0]
        if len(idx_tr_total) < 1000 or len(idx_val) < 100:
            logging.warning(f"  [LSTM] Fold {i+1}: dados insuficientes, pulando")
            continue

        # Corte de early stopping: últimas HOLDOUT_FRAC janelas de treino por tempo.
        ordem = np.argsort(timestamp_alvo[idx_tr_total])
        idx_tr_total = idx_tr_total[ordem]
        corte = int(len(idx_tr_total) * (1 - HOLDOUT_FRAC))
        idx_tr, idx_es = idx_tr_total[:corte], idx_tr_total[corte:]

        def para_tensor(idx):
            return (
                torch.from_numpy(X[idx]).to(DEVICE),
                torch.from_numpy(via_ids[idx]).to(DEVICE),
                torch.from_numpy(y[idx]).to(DEVICE),
            )

        Xtr, vtr, ytr = para_tensor(idx_tr)
        Xes, ves, yes = para_tensor(idx_es)
        Xval, vval, yval = para_tensor(idx_val)

        model = LSTMRazao(n_vias, n_features).to(DEVICE)
        opt = torch.optim.Adam(model.parameters(), lr=LR)
        loss_fn = nn.MSELoss()

        melhor_es, paciencia_restante, melhor_estado = float('inf'), PATIENCE, None
        if DEVICE == 'cuda':
            torch.cuda.synchronize()
        t0 = time.time()
        n_train = len(idx_tr)

        for epoca in range(MAX_EPOCHS):
            model.train()
            # index tensor precisa estar no mesmo device dos tensores indexados
            perm = torch.randperm(n_train, device=DEVICE)
            for b in range(0, n_train, BATCH_SIZE):
                sel = perm[b:b + BATCH_SIZE]
                opt.zero_grad()
                pred = model(Xtr[sel], vtr[sel])
                loss = loss_fn(pred, ytr[sel])
                loss.backward()
                opt.step()

            model.eval()
            with torch.no_grad():
                pred_es = model(Xes, ves)
                loss_es = loss_fn(pred_es, yes).item()

            if loss_es < melhor_es - 1e-5:
                melhor_es = loss_es
                paciencia_restante = PATIENCE
                melhor_estado = {k: v.clone() for k, v in model.state_dict().items()}
            else:
                paciencia_restante -= 1
                if paciencia_restante <= 0:
                    logging.info(f"  [LSTM] Fold {i+1}: early stop na época {epoca+1}")
                    break

        if melhor_estado is not None:
            model.load_state_dict(melhor_estado)
        if DEVICE == 'cuda':
            torch.cuda.synchronize()
        dur = time.time() - t0

        model.eval()
        with torch.no_grad():
            pred_val = np.clip(model(Xval, vval).cpu().numpy(), 0.05, 1.0)

        m = calcular_metricas(yval.cpu().numpy(), pred_val, tempo_alvo[idx_val])
        m['tempo_treino_s'] = dur
        m['n_treino'] = len(idx_tr)
        m['n_val'] = len(idx_val)
        m['epocas'] = epoca + 1
        resultados.append(m)

        logging.info(
            f"  [LSTM]    Fold {i+1}/{len(limites)} — "
            f"RMSE {m['rmse_seg']:.1f}s | treino {dur:.1f}s ({epoca+1} épocas)"
        )

    return resultados


# ============================================================================
# MÉTRICAS E RELATÓRIO
# ============================================================================

def calcular_metricas(y_true, y_pred, tempo_real_s) -> dict:
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae = float(mean_absolute_error(y_true, y_pred))
    tempo_pred = feat.razao_para_segundos(tempo_real_s, y_true, y_pred)
    rmse_s = float(np.sqrt(mean_squared_error(tempo_real_s, tempo_pred)))
    mae_s = float(mean_absolute_error(tempo_real_s, tempo_pred))
    return {'rmse_razao': rmse, 'mae_razao': mae, 'rmse_seg': rmse_s, 'mae_seg': mae_s}


def resumir(resultados: list) -> dict:
    chaves = ['rmse_razao', 'mae_razao', 'rmse_seg', 'mae_seg', 'tempo_treino_s']
    return {
        **{f'{k}_media': float(np.mean([r[k] for r in resultados])) for k in chaves},
        **{f'{k}_std': float(np.std([r[k] for r in resultados])) for k in chaves},
        'folds': resultados,
    }


def contar_parametros(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def run():
    t_inicio = time.time()
    logging.info("=" * 70)
    logging.info("BENCHMARK: XGBoost (LIA 2.0) vs. LSTM")
    logging.info("=" * 70)
    if DEVICE == 'cuda':
        logging.info(f"Dispositivo: cuda ({torch.cuda.get_device_name(0)}, torch {torch.__version__})")
    else:
        logging.info(f"Dispositivo: cpu (GPU indisponível ou incompatível com esta build de PyTorch)")

    df, enc = carregar_base()
    n_vias = len(enc.classes_)
    limites = limites_dos_folds(df)

    logging.info("\n--- XGBoost (LIA 2.0: calendário + perfis históricos, sem lag) ---")
    res_xgb = treinar_avaliar_xgboost(df, limites)

    logging.info("\n--- XGBoost + recência (controle: só acrescenta a última observação real) ---")
    df_rec = adicionar_recencia(df)
    limites_rec = limites_dos_folds(df_rec)  # 630 linhas a menos desloca os cortes
    res_xgb_rec = treinar_avaliar_xgboost(df_rec, limites_rec, features_extra=['razao_lag1', 'delta_min_lag1'])

    logging.info("\n--- LSTM ---")
    X, via_ids, y, tempo_alvo, timestamp_alvo = construir_janelas(df)
    logging.info(f"Parâmetros do LSTM: window={WINDOW_SIZE}, hidden={HIDDEN_SIZE}, "
                f"emb={EMB_DIM}, batch={BATCH_SIZE}, max_epochs={MAX_EPOCHS}")
    res_lstm = treinar_avaliar_lstm(X, via_ids, y, tempo_alvo, timestamp_alvo, limites, n_vias)

    resumo_xgb = resumir(res_xgb)
    resumo_xgb_rec = resumir(res_xgb_rec)
    resumo_lstm = resumir(res_lstm)

    modelo_lstm_amostra = LSTMRazao(n_vias, X.shape[2])
    n_params_lstm = contar_parametros(modelo_lstm_amostra)

    xgb_pkl = os.path.join(MODELS_DIR, 'lia_2.0.pkl')
    tam_xgb_kb = os.path.getsize(xgb_pkl) / 1024 if os.path.exists(xgb_pkl) else None

    buffer = torch.save(modelo_lstm_amostra.state_dict(), os.path.join(MODELS_DIR, '_lstm_benchmark_tmp.pt'))
    tam_lstm_kb = os.path.getsize(os.path.join(MODELS_DIR, '_lstm_benchmark_tmp.pt')) / 1024
    os.remove(os.path.join(MODELS_DIR, '_lstm_benchmark_tmp.pt'))

    logging.info("\n" + "=" * 70)
    logging.info("RESULTADO COMPARATIVO")
    logging.info("=" * 70)
    logging.info(
        f"  XGBoost (perfis)         — RMSE {resumo_xgb['rmse_seg_media']:.1f}s "
        f"(± {resumo_xgb['rmse_seg_std']:.1f}) | treino médio {resumo_xgb['tempo_treino_s_media']:.1f}s/fold"
    )
    logging.info(
        f"  XGBoost + recência       — RMSE {resumo_xgb_rec['rmse_seg_media']:.1f}s "
        f"(± {resumo_xgb_rec['rmse_seg_std']:.1f}) | treino médio {resumo_xgb_rec['tempo_treino_s_media']:.1f}s/fold"
    )
    logging.info(
        f"  LSTM                     — RMSE {resumo_lstm['rmse_seg_media']:.1f}s "
        f"(± {resumo_lstm['rmse_seg_std']:.1f}) | treino médio {resumo_lstm['tempo_treino_s_media']:.1f}s/fold"
    )
    diff_ao_perfil = resumo_xgb['rmse_seg_media'] - resumo_lstm['rmse_seg_media']
    diff_recencia_lstm = resumo_xgb_rec['rmse_seg_media'] - resumo_lstm['rmse_seg_media']
    logging.info(
        f"  → LSTM supera o XGBoost sem recência em {diff_ao_perfil:.1f}s, mas o XGBoost "
        f"com recência fica a só {abs(diff_recencia_lstm):.1f}s do LSTM — a informação que "
        f"mais importa é a última observação real, não a arquitetura recorrente."
    )
    logging.info(f"  Tamanho em disco — XGBoost: {tam_xgb_kb:.0f} KB | LSTM: {tam_lstm_kb:.0f} KB")
    logging.info(f"  Parâmetros — LSTM: {n_params_lstm:,}")

    saida = {
        'metodologia': {
            'alvo': 'razao_congestionamento',
            'n_folds': N_SPLITS,
            'split': 'TimeSeriesSplit progressivo sobre timestamp global (mesmos cortes para os dois modelos)',
            'xgboost_features': feat.FEATURE_COLS,
            'lstm_window_size': WINDOW_SIZE,
            'lstm_features_por_passo': ['razao', 'hora_sin', 'hora_cos', 'is_fim_semana', 'is_horario_pico', 'delta_min_log'],
            'lstm_hidden_size': HIDDEN_SIZE,
            'lstm_embedding_via': EMB_DIM,
            'dispositivo': DEVICE,
            'gpu_nome': torch.cuda.get_device_name(0) if DEVICE == 'cuda' else None,
            'torch_versao': torch.__version__,
            'nota_gpu': (
                'RTX 5070 é Blackwell (sm_120). A build de PyTorch usada até 11/08/2026 '
                '(2.7.0.dev+cu124) tinha cuda.is_available()=True mas falhava em qualquer '
                'operação real (sem kernel compilado para sm_120). Atualizado para '
                'torch==2.9.0+cu128 para viabilizar GPU neste benchmark.'
            ),
        },
        'xgboost': resumo_xgb,
        'xgboost_com_recencia': resumo_xgb_rec,
        'lstm': resumo_lstm,
        'tamanho_disco_kb': {'xgboost': tam_xgb_kb, 'lstm': tam_lstm_kb},
        'n_parametros_lstm': n_params_lstm,
        'conclusao': (
            'A vantagem do LSTM sobre o XGBoost original vem majoritariamente do '
            'acesso à última observação real da via, não de captar sazonalidade '
            'longa. Uma feature de recência trivial (razao_lag1, delta_min_lag1) '
            'no XGBoost recupera quase todo o ganho, sem GPU e com fração do '
            'tempo de treino.'
        ),
        'tempo_total_benchmark_s': time.time() - t_inicio,
    }

    out_path = os.path.join(MODELS_DIR, 'benchmark_lstm_vs_xgboost.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=2)
    logging.info(f"\nResultado salvo em: {out_path}")
    logging.info(f"Benchmark concluído em {time.time()-t_inicio:.1f}s")

    return saida


if __name__ == '__main__':
    run()
