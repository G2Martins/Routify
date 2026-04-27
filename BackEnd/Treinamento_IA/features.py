"""
Feature Engineering para LIA
Lê o Parquet Silver mais recente e gera X, y prontos para treino.
Salva o LabelEncoder em models/ junto com o modelo.
"""
import os
import glob
import logging
import json
import numpy as np
import pandas as pd
import joblib
from sklearn.preprocessing import LabelEncoder

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')

# Coleta a cada ~8min → passos por hora ≈ 7.5, usamos 8 (conservador)
STEPS_PER_HOUR = 8
STEPS_PER_DAY = STEPS_PER_HOUR * 24       # 192
STEPS_PER_WEEK = STEPS_PER_DAY * 7        # 1344

ROLLING_6H = STEPS_PER_HOUR * 6           # 48 passos
MIN_PERIODS = 10

FEATURE_COLS = [
    'id_ponto_enc',
    'hora',
    'dia_semana',
    'is_fim_semana',
    'is_horario_pico',
    'velocidade_livre',
    'lag_vel_1h',
    'lag_vel_3h',
    'lag_vel_24h',
    'lag_vel_7d',
    'rolling_mean_6h',
    'rolling_std_6h',
    'lag_tempo_1h',
    'lag_tempo_24h',
]

TARGET_COL = 'tempo_viagem_segundos'


def load_latest_silver() -> pd.DataFrame:
    pattern = os.path.join(MODELS_DIR, 'silver_*.parquet')
    files = sorted(glob.glob(pattern), reverse=True)
    if not files:
        raise FileNotFoundError(
            "Nenhum Parquet Silver encontrado em models/. "
            "Execute silver.py primeiro."
        )
    path = files[0]
    logging.info(f"Carregando Silver: {path}")
    df = pd.read_parquet(path, engine='pyarrow')
    logging.info(f"Silver carregado: {len(df):,} registros, {df['id_ponto'].nunique()} pontos")
    return df


def encode_id_ponto(df: pd.DataFrame, encoder_path: str) -> tuple[pd.DataFrame, LabelEncoder]:
    enc = LabelEncoder()
    df['id_ponto_enc'] = enc.fit_transform(df['id_ponto'])
    joblib.dump(enc, encoder_path)
    logging.info(f"LabelEncoder salvo: {encoder_path} ({len(enc.classes_)} classes)")
    return df, enc


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    logging.info("Construindo features temporais...")

    # Garantir ordenação (já feita no Silver, mas defensive)
    df = df.sort_values(['id_ponto', 'data_hora_brasilia']).reset_index(drop=True)

    # Features temporais básicas
    dt = df['data_hora_brasilia'].dt
    df['hora'] = dt.hour
    df['dia_semana'] = dt.dayofweek  # 0=Seg, 6=Dom
    df['is_fim_semana'] = (df['dia_semana'] >= 5).astype(int)
    df['is_horario_pico'] = df['hora'].isin({6, 7, 8, 17, 18, 19}).astype(int)

    # Lags por ponto (groupby garante que lags não cruzam pontos diferentes)
    grp = df.groupby('id_ponto', sort=False)

    df['lag_vel_1h'] = grp['velocidade_atual'].shift(STEPS_PER_HOUR)
    df['lag_vel_3h'] = grp['velocidade_atual'].shift(STEPS_PER_HOUR * 3)
    df['lag_vel_24h'] = grp['velocidade_atual'].shift(STEPS_PER_DAY)
    df['lag_vel_7d'] = grp['velocidade_atual'].shift(STEPS_PER_WEEK)

    df['lag_tempo_1h'] = grp['tempo_viagem_segundos'].shift(STEPS_PER_HOUR)
    df['lag_tempo_24h'] = grp['tempo_viagem_segundos'].shift(STEPS_PER_DAY)

    # Rolling stats (tendência recente da via)
    df['rolling_mean_6h'] = (
        grp['velocidade_atual']
        .transform(lambda x: x.rolling(ROLLING_6H, min_periods=MIN_PERIODS).mean())
    )
    df['rolling_std_6h'] = (
        grp['velocidade_atual']
        .transform(lambda x: x.rolling(ROLLING_6H, min_periods=MIN_PERIODS).std())
    )

    # Dropar linhas com NaN nas features de lag (início de cada série)
    n_before = len(df)
    df = df.dropna(subset=FEATURE_COLS + [TARGET_COL]).reset_index(drop=True)
    dropped = n_before - len(df)
    logging.info(
        f"Removidas {dropped:,} linhas por NaN em lags "
        f"({dropped/n_before*100:.1f}% do total — esperado para início de séries)"
    )

    return df


def run(version: str = 'lia_1.0') -> tuple[pd.DataFrame, pd.DataFrame, pd.Series]:
    os.makedirs(MODELS_DIR, exist_ok=True)
    encoder_path = os.path.join(MODELS_DIR, f'{version}_encoder.pkl')

    df = load_latest_silver()
    df, enc = encode_id_ponto(df, encoder_path)
    df = build_features(df)

    X = df[FEATURE_COLS].copy()
    y = df[TARGET_COL].copy()

    # Stats finais
    logging.info("\n--- Dataset Final ---")
    logging.info(f"Shape X: {X.shape}")
    logging.info(f"Target — mean: {y.mean():.0f}s  std: {y.std():.0f}s  max: {y.max():.0f}s")
    logging.info(f"Features: {list(X.columns)}")

    # Salvar metadata parcial
    meta_path = os.path.join(MODELS_DIR, f'{version}_metadata.json')
    meta = {
        'versao': version.upper().replace('_', ' '),
        'features': list(X.columns),
        'total_amostras': int(len(X)),
        'target_mean_seg': round(float(y.mean()), 1),
        'target_std_seg': round(float(y.std()), 1),
    }
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    logging.info(f"Metadata parcial salva: {meta_path}")

    return df, X, y


if __name__ == '__main__':
    run()
