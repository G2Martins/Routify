"""
Pipeline Bronze → Silver
Executa ANTES de cada treinamento para garantir dados atualizados.
Saída: silver_YYYYMMDD.parquet em models/
"""
import os
import sys
import logging
import pandas as pd
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from supabase import create_client, Client

# Busca .env em ../Servidor/config/.env
ENV_PATH = os.path.join(os.path.dirname(__file__), '..', 'Servidor', 'config', '.env')
load_dotenv(ENV_PATH)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

BRASILIA_TZ = timezone(timedelta(hours=-3))
# Supabase PostgREST default db_max_rows = 1000. Chunks maiores são silenciosamente truncados.
CHUNK_SIZE = 1_000

OUTLIER_VEL_MIN = 1
OUTLIER_VEL_MAX = 200
OUTLIER_TEMPO_MAX = 7200  # 2 horas — acima disso é ruído
CONFIANCA_MIN = 0.3
FORWARD_FILL_LIMIT = 4  # máx 4 passos de 8min = 32min de preenchimento


def get_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("SUPABASE_URL e SUPABASE_KEY não encontradas. Verifique o .env em Servidor/config/")
        sys.exit(1)
    return create_client(str(SUPABASE_URL), str(SUPABASE_KEY))


def fetch_all_historico(client: Client) -> pd.DataFrame:
    logging.info(f"Buscando historico_trafego do Supabase (chunks de {CHUNK_SIZE})...")
    chunks = []
    offset = 0

    while True:
        response = (
            client.table('historico_trafego')
            .select('id_coleta, id_ponto, velocidade_atual, velocidade_livre, tempo_viagem_segundos, confianca, data_hora_coleta')
            .order('id_coleta')
            .range(offset, offset + CHUNK_SIZE - 1)
            .execute()
        )
        data = response.data
        if not data:
            break

        chunks.append(pd.DataFrame(data))
        offset += len(data)
        if offset % 10_000 == 0 or len(data) < CHUNK_SIZE:
            logging.info(f"  Carregados {offset:,} registros")

        if len(data) < CHUNK_SIZE:
            break

    if not chunks:
        logging.error("Nenhum dado encontrado em historico_trafego.")
        sys.exit(1)

    df = pd.concat(chunks, ignore_index=True)
    logging.info(f"Total bruto: {len(df):,} registros")
    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    initial = len(df)

    # Tipos
    df['data_hora_coleta'] = pd.to_datetime(df['data_hora_coleta'], utc=True)
    df['velocidade_atual'] = pd.to_numeric(df['velocidade_atual'], errors='coerce')
    df['velocidade_livre'] = pd.to_numeric(df['velocidade_livre'], errors='coerce')
    df['tempo_viagem_segundos'] = pd.to_numeric(df['tempo_viagem_segundos'], errors='coerce')
    df['confianca'] = pd.to_numeric(df['confianca'], errors='coerce')

    # UTC → Brasília (UTC-3)
    df['data_hora_brasilia'] = df['data_hora_coleta'].dt.tz_convert(BRASILIA_TZ)
    df = df.drop(columns=['data_hora_coleta'])

    # Outliers velocidade
    mask_vel = (
        (df['velocidade_atual'] >= OUTLIER_VEL_MIN) &
        (df['velocidade_atual'] <= OUTLIER_VEL_MAX) &
        (df['velocidade_livre'] >= OUTLIER_VEL_MIN) &
        (df['velocidade_livre'] <= OUTLIER_VEL_MAX)
    )
    df = df[mask_vel]
    logging.info(f"  Removidos {initial - len(df):,} por outlier de velocidade")

    # Outlier tempo
    n_before = len(df)
    df = df[df['tempo_viagem_segundos'] <= OUTLIER_TEMPO_MAX]
    df = df[df['tempo_viagem_segundos'] > 0]
    logging.info(f"  Removidos {n_before - len(df):,} por outlier de tempo")

    # Confiança baixa
    n_before = len(df)
    df = df[df['confianca'] >= CONFIANCA_MIN]
    logging.info(f"  Removidos {n_before - len(df):,} por confiança < {CONFIANCA_MIN}")

    # Ordenar por ponto + tempo (obrigatório para lags no features.py)
    df = df.sort_values(['id_ponto', 'data_hora_brasilia']).reset_index(drop=True)

    # Forward fill por ponto (nulos restantes após filtros)
    cols_fill = ['velocidade_atual', 'velocidade_livre', 'tempo_viagem_segundos', 'confianca']
    df[cols_fill] = (
        df.groupby('id_ponto')[cols_fill]
        .transform(lambda x: x.ffill(limit=FORWARD_FILL_LIMIT))
    )

    # Remover nulos remanescentes (início de séries curtas)
    n_before = len(df)
    df = df.dropna(subset=cols_fill)
    logging.info(f"  Removidos {n_before - len(df):,} por nulos não preenchíveis")

    logging.info(f"Silver final: {len(df):,} registros ({len(df)/initial*100:.1f}% do bruto)")
    return df


def save_parquet(df: pd.DataFrame) -> str:
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)

    date_str = datetime.now().strftime('%Y%m%d')
    path = os.path.join(models_dir, f'silver_{date_str}.parquet')

    df.to_parquet(path, index=False, engine='pyarrow')
    size_mb = os.path.getsize(path) / (1024 * 1024)
    logging.info(f"Parquet salvo: {path} ({size_mb:.1f} MB)")
    return path


def run():
    logging.info("=== Pipeline Silver iniciado ===")
    client = get_client()
    df = fetch_all_historico(client)
    df = clean(df)
    path = save_parquet(df)

    # Estatísticas para validação
    logging.info("\n--- Validação Silver ---")
    logging.info(f"Período: {df['data_hora_brasilia'].min()} → {df['data_hora_brasilia'].max()}")
    logging.info(f"Pontos únicos: {df['id_ponto'].nunique()}")
    logging.info(f"Nulos restantes:\n{df.isnull().sum()}")
    logging.info(f"Velocidade média: {df['velocidade_atual'].mean():.1f} km/h")
    logging.info(f"Tempo viagem médio: {df['tempo_viagem_segundos'].mean():.0f} seg")
    logging.info("=== Pipeline Silver concluído ===")

    return path


if __name__ == '__main__':
    run()
