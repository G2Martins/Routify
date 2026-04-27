"""
Treinamento LIA — XGBoost + MLflow
Uso: python train.py [--version lia_1.0]

Fluxo completo:
  1. Roda silver.py para garantir dados atualizados
  2. Roda features.py para gerar X, y
  3. TimeSeriesSplit (5 folds) para avaliação
  4. Treina modelo final com 100% dos dados
  5. Salva lia_X.Y.pkl + metadata.json + MLflow experiment
"""
import os
import sys
import json
import logging
import argparse
from pathlib import Path
import numpy as np
import joblib
import mlflow
import mlflow.xgboost
import xgboost as xgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_squared_error, mean_absolute_error

# Adiciona o diretório pai ao path para importar silver e features
sys.path.insert(0, os.path.dirname(__file__))
import silver
import features as feat

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')

XGB_PARAMS = {
    'n_estimators': 500,
    'max_depth': 6,
    'learning_rate': 0.05,
    'subsample': 0.8,
    'colsample_bytree': 0.8,
    'min_child_weight': 5,
    'reg_alpha': 0.1,
    'reg_lambda': 1.0,
    'objective': 'reg:squarederror',
    'eval_metric': 'rmse',
    'early_stopping_rounds': 30,
    'tree_method': 'hist',  # rápido para CPU
    'random_state': 42,
    'verbosity': 0,
}

N_SPLITS = 5


def evaluate_cv(X, y, params: dict) -> tuple[list, list]:
    tscv = TimeSeriesSplit(n_splits=N_SPLITS)
    rmse_scores = []
    mae_scores = []

    logging.info(f"Iniciando TimeSeriesSplit ({N_SPLITS} folds)...")

    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_tr, X_val = X.iloc[train_idx], X.iloc[val_idx]
        y_tr, y_val = y.iloc[train_idx], y.iloc[val_idx]

        model = xgb.XGBRegressor(**params)
        model.fit(
            X_tr, y_tr,
            eval_set=[(X_val, y_val)],
            verbose=False,
        )

        pred = model.predict(X_val)
        rmse = np.sqrt(mean_squared_error(y_val, pred))
        mae = mean_absolute_error(y_val, pred)
        rmse_scores.append(rmse)
        mae_scores.append(mae)

        logging.info(
            f"  Fold {fold+1}/{N_SPLITS} — "
            f"train: {len(X_tr):,}  val: {len(X_val):,}  "
            f"RMSE: {rmse:.1f}s  MAE: {mae:.1f}s"
        )

    logging.info(
        f"CV RMSE: {np.mean(rmse_scores):.1f} ± {np.std(rmse_scores):.1f} seg"
    )
    logging.info(
        f"CV MAE:  {np.mean(mae_scores):.1f} ± {np.std(mae_scores):.1f} seg"
    )
    return rmse_scores, mae_scores


def train_final(X, y, params: dict) -> xgb.XGBRegressor:
    logging.info("Treinando modelo final com 100% dos dados...")

    # Para modelo final sem early stopping (sem validation set)
    final_params = {k: v for k, v in params.items()
                    if k != 'early_stopping_rounds'}

    model = xgb.XGBRegressor(**final_params)
    model.fit(X, y, verbose=50)
    return model


def run(version: str = 'lia_1.0'):
    os.makedirs(MODELS_DIR, exist_ok=True)

    # Passo 1: Atualiza Silver
    logging.info("=== Passo 1: Atualizando Silver ===")
    silver.run()

    # Passo 2: Gera features
    logging.info("=== Passo 2: Gerando features ===")
    df, X, y = feat.run(version=version)

    # Passo 3+4: MLflow experiment
    # Path Windows precisa virar file:/// URI senão MLflow parseia "C:" como scheme
    mlruns_path = Path(MODELS_DIR) / 'mlruns'
    mlruns_path.mkdir(parents=True, exist_ok=True)
    mlflow.set_tracking_uri(mlruns_path.as_uri())
    mlflow.set_experiment("LIA")

    run_name = version.upper().replace('_', ' ').replace('.', '_')

    with mlflow.start_run(run_name=run_name):
        mlflow.log_params(XGB_PARAMS)
        mlflow.log_param('n_splits_cv', N_SPLITS)
        mlflow.log_param('total_amostras', len(X))
        mlflow.log_param('n_features', X.shape[1])
        mlflow.log_param('n_pontos', df['id_ponto'].nunique())
        mlflow.log_param('periodo_inicio', str(df['data_hora_brasilia'].min()))
        mlflow.log_param('periodo_fim', str(df['data_hora_brasilia'].max()))

        # Validação cruzada
        rmse_scores, mae_scores = evaluate_cv(X, y, XGB_PARAMS)

        mlflow.log_metric('cv_rmse_mean', np.mean(rmse_scores))
        mlflow.log_metric('cv_rmse_std', np.std(rmse_scores))
        mlflow.log_metric('cv_mae_mean', np.mean(mae_scores))
        for i, (r, m) in enumerate(zip(rmse_scores, mae_scores)):
            mlflow.log_metric(f'fold_{i+1}_rmse', r)
            mlflow.log_metric(f'fold_{i+1}_mae', m)

        # Treino final
        final_model = train_final(X, y, XGB_PARAMS)

        # Feature importance
        importance = dict(zip(X.columns, final_model.feature_importances_))
        logging.info("Feature importance:")
        for feat_name, imp in sorted(importance.items(), key=lambda x: -x[1]):
            logging.info(f"  {feat_name}: {imp:.4f}")
            mlflow.log_metric(f'importance_{feat_name}', float(imp))

        # Salvar artefatos
        model_path = os.path.join(MODELS_DIR, f'{version}.pkl')
        joblib.dump(final_model, model_path, compress=3)
        logging.info(f"Modelo salvo: {model_path}")

        # Atualizar metadata com métricas finais
        meta_path = os.path.join(MODELS_DIR, f'{version}_metadata.json')
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)

        meta.update({
            'cv_rmse_medio_seg': round(float(np.mean(rmse_scores)), 1),
            'cv_rmse_std_seg': round(float(np.std(rmse_scores)), 1),
            'cv_mae_medio_seg': round(float(np.mean(mae_scores)), 1),
            'periodo_inicio': str(df['data_hora_brasilia'].min()),
            'periodo_fim': str(df['data_hora_brasilia'].max()),
            'n_pontos_monitorados': int(df['id_ponto'].nunique()),
            'feature_importance': {k: round(float(v), 4) for k, v in importance.items()},
        })

        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        logging.info(f"Metadata atualizada: {meta_path}")

        mlflow.log_artifact(model_path)
        mlflow.log_artifact(meta_path)
        mlflow.log_artifact(os.path.join(MODELS_DIR, f'{version}_encoder.pkl'))

    logging.info("=== Treinamento concluído ===")
    logging.info(f"Arquivos gerados em {MODELS_DIR}:")
    logging.info(f"  {version}.pkl")
    logging.info(f"  {version}_encoder.pkl")
    logging.info(f"  {version}_metadata.json")
    logging.info(f"  mlruns/ (MLflow UI: mlflow ui --backend-store-uri \"{mlruns_path.as_uri()}\")")

    cv_rmse = np.mean(rmse_scores)
    if cv_rmse > 120:
        logging.warning(
            f"CV RMSE {cv_rmse:.1f}s > 120s. Considere: mais dados, "
            "feature engineering adicional ou ajuste de hiperparâmetros."
        )
    else:
        logging.info(f"CV RMSE {cv_rmse:.1f}s — dentro da meta (< 120s) para LIA 1.0")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Treina o modelo LIA')
    parser.add_argument(
        '--version', default='lia_1.0',
        help='Versão do modelo (default: lia_1.0). Ex: lia_2.0'
    )
    args = parser.parse_args()
    run(version=args.version)
