"""
Treinamento LIA 2.0 — XGBoost + MLflow
Uso: python train.py [--version lia_2.0] [--cpu] [--skip-silver]

Fluxo:
  1. silver.py — atualiza o Parquet a partir do Supabase
  2. features.py — calendário + alvo (razão de congestionamento)
  3. TimeSeriesSplit (5 folds) com perfis recalculados DENTRO de cada fold
  4. Baseline (perfil puro) medido nos mesmos folds, para provar o ganho do modelo
  5. Modelo final com 100% dos dados + perfis salvos para a API

MUDANÇAS vs LIA 1.0
-------------------
  - Alvo: razão de congestionamento em vez de segundos (independe do comprimento).
  - Sem lags: eles não existiam na inferência e a API os fabricava.
  - Ordenação temporal global antes do split. Na 1.0 o df vinha ordenado por
    id_ponto, então o "TimeSeriesSplit" separava VIAS, não períodos — treino e
    validação cobriam os mesmos meses.
  - Perfis calculados por fold: são estatísticas do alvo, então calculá-los sobre
    o dataset inteiro vazaria futuro no passado.
  - Métricas reportadas também no subconjunto congestionado: 83% dos dados estão
    em fluxo livre e diluiriam o erro que realmente importa.
"""
import os
import sys
import json
import logging
import argparse
import time
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
import mlflow
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_squared_error, mean_absolute_error

sys.path.insert(0, os.path.dirname(__file__))
import silver
import features as feat

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'artifacts')

_COMUNS = {
    'objective': 'reg:squarederror',
    'eval_metric': 'rmse',
    'early_stopping_rounds': 40,
    'tree_method': 'hist',   # 'gpu_hist' foi removido no XGBoost 3.x
    'random_state': 42,
    'verbosity': 0,
}

# Hiperparâmetros da LIA 2.1 da tese (modelo do Pedro, 19/08/2026 — bate com
# lia_2.1_metadata.json: RMSE 40,69 s / MAE 14,62 s). Padrão do treino.
XGB_PARAMS_MANUAL = {
    'n_estimators': 600,
    'max_depth': 7,
    'learning_rate': 0.05,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'min_child_weight': 10,
    'reg_alpha': 0.1,
    'reg_lambda': 1.0,
    **_COMUNS,
}

XGB_PARAMS_OPTUNA = {
    # Busca bayesiana (Optuna, 60 trials, TPE + poda por mediana) em 26/08/2026 —
    # ver tune_hyperparams.py. Ganhou +2,2% no RMSE da RAZÃO, mas no retreino de
    # 22/09 ficou PIOR em segundos (MAE 15,03 × 14,62 s), a unidade da tese:
    # testado e não adotado. Use --params optuna para reproduzir.
    'n_estimators': 750,
    'max_depth': 8,
    'learning_rate': 0.0706,
    'subsample': 0.5207,
    'colsample_bytree': 0.5292,
    'min_child_weight': 16,
    'reg_alpha': 0.2846,
    'reg_lambda': 3.0032,
    **_COMUNS,
}

XGB_PARAMS = XGB_PARAMS_MANUAL  # nome antigo (benchmark_lstm_xgboost.py importa)
PARAMS_POR_NOME = {'manual': XGB_PARAMS_MANUAL, 'optuna': XGB_PARAMS_OPTUNA}

N_SPLITS = 5


def check_gpu_availability(force_cpu: bool = False) -> bool:
    """XGBoost 3.x seleciona GPU via device='cuda', não mais por tree_method."""
    if force_cpu:
        logging.info("GPU desativada via --cpu")
        return False
    try:
        m = xgb.XGBRegressor(n_estimators=1, tree_method='hist', device='cuda')
        m.fit(np.array([[0.0], [1.0]]), np.array([0.0, 1.0]))
        logging.info("GPU disponível — usando device='cuda'")
        return True
    except Exception as e:
        logging.warning(f"GPU indisponível ({type(e).__name__}), seguindo em CPU: {e}")
        return False


def _metricas(y_true, y_pred, tempo_real_s, prefixo=''):
    """RMSE/MAE na razão + o equivalente em segundos, geral e só no congestionado."""
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)

    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    mae = float(mean_absolute_error(y_true, y_pred))

    t_pred = feat.razao_para_segundos(tempo_real_s, y_true, y_pred)
    rmse_s = float(np.sqrt(mean_squared_error(tempo_real_s, t_pred)))
    mae_s = float(mean_absolute_error(tempo_real_s, t_pred))

    mask = y_true < feat.LIMIAR_CONGESTIONAMENTO
    if mask.sum() > 0:
        rmse_cong = float(np.sqrt(mean_squared_error(y_true[mask], y_pred[mask])))
        rmse_s_cong = float(np.sqrt(mean_squared_error(
            np.asarray(tempo_real_s)[mask], np.asarray(t_pred)[mask]
        )))
    else:
        rmse_cong = rmse_s_cong = float('nan')

    return {
        f'{prefixo}rmse_razao': rmse,
        f'{prefixo}mae_razao': mae,
        f'{prefixo}rmse_seg': rmse_s,
        f'{prefixo}mae_seg': mae_s,
        f'{prefixo}rmse_razao_congestionado': rmse_cong,
        f'{prefixo}rmse_seg_congestionado': rmse_s_cong,
    }


def evaluate_cv(df: pd.DataFrame, params: dict, cols: list = None) -> dict:
    """CV temporal. Cada fold recalcula os perfis só com o seu treino."""
    cols = cols or feat.FEATURE_COLS
    tscv = TimeSeriesSplit(n_splits=N_SPLITS)
    resultados = {'modelo': [], 'baseline': []}

    logging.info(f"TimeSeriesSplit temporal ({N_SPLITS} folds)...")

    for fold, (tr_idx, val_idx) in enumerate(tscv.split(df)):
        df_tr = df.iloc[tr_idx]
        df_val = df.iloc[val_idx]

        # Perfis SÓ com treino — evita vazar futuro no passado.
        perfis = feat.build_profiles(df_tr)
        tr = feat.apply_profiles(df_tr.copy(), perfis)
        val = feat.apply_profiles(df_val.copy(), perfis)

        X_tr, y_tr = tr[cols], tr[feat.TARGET_COL]
        X_val, y_val = val[cols], val[feat.TARGET_COL]
        tempo_val = val['tempo_viagem_segundos'].values

        t0 = time.time()
        model = xgb.XGBRegressor(**params)
        model.fit(X_tr, y_tr, eval_set=[(X_val, y_val)], verbose=False)
        dur = time.time() - t0

        m_modelo = _metricas(y_val, model.predict(X_val), tempo_val)
        # Baseline: usar o perfil histórico diretamente como predição.
        m_base = _metricas(y_val, val['perfil_via_hora_dow'].values, tempo_val)

        resultados['modelo'].append(m_modelo)
        resultados['baseline'].append(m_base)

        logging.info(
            f"  Fold {fold+1}/{N_SPLITS} — treino {len(tr):,} → val {len(val):,} | "
            f"val de {df_val['data_hora_brasilia'].min():%d/%m} a "
            f"{df_val['data_hora_brasilia'].max():%d/%m} | "
            f"modelo RMSE {m_modelo['rmse_seg']:.1f}s vs baseline "
            f"{m_base['rmse_seg']:.1f}s | {dur:.1f}s"
        )

    def media(lista, chave):
        vals = [d[chave] for d in lista if not np.isnan(d[chave])]
        return float(np.mean(vals)) if vals else float('nan')

    resumo = {}
    for nome in ('modelo', 'baseline'):
        for chave in resultados[nome][0]:
            resumo[f'{nome}_{chave}'] = media(resultados[nome], chave)
            resumo[f'{nome}_{chave}_std'] = float(np.std(
                [d[chave] for d in resultados[nome] if not np.isnan(d[chave])]
            ))

    logging.info("")
    logging.info("--- Resultado da validação cruzada ---")
    logging.info(
        f"  Modelo   — RMSE {resumo['modelo_rmse_seg']:.1f}s "
        f"(± {resumo['modelo_rmse_seg_std']:.1f}) | "
        f"razão {resumo['modelo_rmse_razao']:.4f}"
    )
    logging.info(
        f"  Baseline — RMSE {resumo['baseline_rmse_seg']:.1f}s "
        f"(± {resumo['baseline_rmse_seg_std']:.1f}) | "
        f"razão {resumo['baseline_rmse_razao']:.4f}"
    )
    logging.info(
        f"  Só congestionado — modelo {resumo['modelo_rmse_seg_congestionado']:.1f}s "
        f"vs baseline {resumo['baseline_rmse_seg_congestionado']:.1f}s"
    )

    ganho = resumo['baseline_rmse_seg'] - resumo['modelo_rmse_seg']
    if ganho > 0:
        logging.info(
            f"  → O modelo supera o perfil puro em {ganho:.1f}s "
            f"({ganho/resumo['baseline_rmse_seg']*100:.1f}%)"
        )
    else:
        logging.warning(
            f"  → O perfil puro está {abs(ganho):.1f}s MELHOR que o modelo. "
            f"O XGBoost não está agregando valor sobre a média histórica."
        )

    # Por fold, para comparação pareada entre versões (mesmos folds nas duas).
    resumo['folds'] = [{'rmse_seg': round(m['rmse_seg'], 4), 'mae_seg': round(m['mae_seg'], 4),
                        'baseline_rmse_seg': round(b['rmse_seg'], 4)}
                       for m, b in zip(resultados['modelo'], resultados['baseline'])]
    return resumo


def train_final(df: pd.DataFrame, params: dict, cols: list = None):
    """Modelo final: perfis sobre 100% dos dados (viram artefato para a API)."""
    logging.info("Treinando modelo final com 100% dos dados...")
    cols = cols or feat.FEATURE_COLS

    perfis = feat.build_profiles(df)
    full = feat.apply_profiles(df.copy(), perfis)

    X, y = full[cols], full[feat.TARGET_COL]

    final_params = {k: v for k, v in params.items() if k != 'early_stopping_rounds'}
    model = xgb.XGBRegressor(**final_params)
    model.fit(X, y, verbose=False)

    return model, perfis, X


def run(version: str = 'lia_2.0', use_gpu: bool = True, skip_silver: bool = False,
        params_nome: str = 'manual', com_contexto: bool = False):
    os.makedirs(MODELS_DIR, exist_ok=True)
    params = dict(PARAMS_POR_NOME[params_nome])
    cols = feat.feature_cols(com_contexto)
    logging.info(f"Hiperparâmetros: {params_nome} | contexto (LIA 2.2): {com_contexto} | {len(cols)} features")

    logging.info("=== Hardware ===")
    if check_gpu_availability(force_cpu=not use_gpu):
        params['device'] = 'cuda'

    if skip_silver:
        logging.info("=== Passo 1: Silver reaproveitado (--skip-silver) ===")
    else:
        logging.info("=== Passo 1: Atualizando Silver ===")
        silver.run()

    logging.info("=== Passo 2: Preparando features ===")
    df, _ = feat.run(version=version, com_contexto=com_contexto)

    mlruns_path = Path(MODELS_DIR) / 'mlruns'
    mlruns_path.mkdir(parents=True, exist_ok=True)
    mlflow.set_tracking_uri(mlruns_path.as_uri())
    mlflow.set_experiment("LIA")

    logging.info("=== Passo 3: Validação cruzada temporal ===")
    resumo = evaluate_cv(df, params, cols)
    folds = resumo.pop('folds')

    logging.info("=== Passo 4: Modelo final ===")
    model, perfis, X_full = train_final(df, params, cols)

    importance = dict(zip(X_full.columns, model.feature_importances_))
    logging.info("Importância das features:")
    for nome, imp in sorted(importance.items(), key=lambda x: -x[1]):
        logging.info(f"  {nome}: {imp:.4f}")

    # --- Artefatos ---
    model_path = os.path.join(MODELS_DIR, f'{version}.pkl')
    joblib.dump(model, model_path, compress=3)
    logging.info(f"Modelo salvo: {model_path}")

    profiles_path = os.path.join(MODELS_DIR, f'{version}_profiles.pkl')
    joblib.dump(perfis, profiles_path, compress=3)
    logging.info(f"Perfis salvos: {profiles_path}")

    meta_path = os.path.join(MODELS_DIR, f'{version}_metadata.json')
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        meta = {'versao': version.upper().replace('_', ' ')}

    meta.update({
        'cv': {k: (round(v, 4) if isinstance(v, float) and not np.isnan(v) else None)
               for k, v in resumo.items()},
        'periodo_inicio': str(df['data_hora_brasilia'].min()),
        'periodo_fim': str(df['data_hora_brasilia'].max()),
        'n_pontos_monitorados': int(df['id_ponto'].nunique()),
        'feature_importance': {k: round(float(v), 4) for k, v in importance.items()},
        'hiperparametros': {'nome': params_nome,
                            **{k: v for k, v in params.items() if k not in ('verbosity', 'device')}},
        'com_contexto': com_contexto,
        'cv_folds': folds,
        'formula_inferencia': 'tempo_s = comprimento_m / (velocidade_livre_kmh * razao_prevista / 3.6)',
    })
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    logging.info(f"Metadata atualizada: {meta_path}")

    try:
        with mlflow.start_run(run_name=version.upper().replace('_', ' ')):
            mlflow.log_params({k: v for k, v in params.items()})
            mlflow.log_param('n_splits_cv', N_SPLITS)
            mlflow.log_param('total_amostras', len(df))
            mlflow.log_param('n_features', len(cols))
            mlflow.log_param('n_pontos', df['id_ponto'].nunique())
            mlflow.log_param('alvo', feat.TARGET_COL)
            for k, v in resumo.items():
                if isinstance(v, float) and not np.isnan(v):
                    mlflow.log_metric(k, v)
            for nome, imp in importance.items():
                mlflow.log_metric(f'importance_{nome}', float(imp))
            mlflow.log_artifact(model_path)
            mlflow.log_artifact(profiles_path)
            mlflow.log_artifact(meta_path)
            mlflow.log_artifact(os.path.join(MODELS_DIR, f'{version}_encoder.pkl'))
    except Exception as e:
        logging.error(f"MLflow falhou: {e}")
        logging.warning("Os artefatos em models/ foram salvos normalmente.")

    logging.info("")
    logging.info("=== Treinamento concluído ===")
    for arq in (f'{version}.pkl', f'{version}_encoder.pkl',
                f'{version}_profiles.pkl', f'{version}_metadata.json'):
        logging.info(f"  {arq}")

    return resumo


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Treina o modelo LIA 2.0')
    parser.add_argument('--version', default='lia_2.0',
                        help='Versão do modelo (default: lia_2.0)')
    parser.add_argument('--cpu', action='store_true',
                        help='Força treino em CPU')
    parser.add_argument('--skip-silver', action='store_true',
                        help='Reaproveita o Silver existente (pula o Supabase)')
    parser.add_argument('--params', choices=sorted(PARAMS_POR_NOME), default='manual',
                        help='manual = LIA 2.1 da tese (padrão); optuna = testado e não adotado')
    parser.add_argument('--contexto', action='store_true',
                        help='LIA 2.2: vizinhos, chuva e feriado (apps/api/contexto.py)')
    args = parser.parse_args()

    t0 = time.time()
    logging.info("=" * 70)
    logging.info("ROUTIFY — TREINAMENTO LIA 2.0")
    logging.info("=" * 70)

    run(version=args.version, use_gpu=not args.cpu, skip_silver=args.skip_silver,
        params_nome=args.params, com_contexto=args.contexto)

    logging.info("=" * 70)
    logging.info(f"Concluído em {time.time() - t0:.1f}s")
    logging.info("=" * 70)
