"""
Feature Engineering para LIA 2.0
Lê o Parquet Silver mais recente e gera X, y prontos para treino.

MUDANÇA ESTRUTURAL vs LIA 1.0
------------------------------
LIA 1.0 usava lags sequenciais (shift(N)) e previa tempo absoluto em segundos.
Ambas as escolhas se mostraram inválidas:

  1. shift(N) conta COLETAS, não tempo. Com coleta intermitente (p95 de buraco =
     10,7h), o "lag_24h" media na prática 6,7 dias e o "lag_7d" media 74 dias.
  2. Os lags não existem na inferência da API — route.py os preenchia com valores
     fabricados. Como valiam 91,7% da importância do modelo, a predição em
     produção operava fora da distribuição de treino.
  3. O alvo em segundos é específico do comprimento do trecho monitorado (que
     varia de 45m a 22.854m entre pontos), então não transfere para arestas OSM
     de outro comprimento.

LIA 2.0 troca isso por:

  - ALVO: razão de congestionamento (velocidade_atual / velocidade_livre).
    Adimensional e independente de comprimento, então serve qualquer aresta:
        tempo_aresta = comprimento / (velocidade_livre * razão / 3.6)

  - FEATURES: perfis históricos por faixa de horário, em cascata
    (via,hora,dow) → (via,hora) → (via) → (hora,dow) global.
    Todas reproduzíveis na inferência a partir de (via, hora, dia_semana).
    Sem lags ⇒ sem NaN ⇒ aproveita 100% dos registros do Silver.

ANTI-VAZAMENTO
--------------
Os perfis são estatísticas agregadas do alvo. Calculá-los sobre o dataset inteiro
e depois validar vazaria futuro no passado. Por isso este módulo separa:

    build_profiles(df_treino)  -> tabelas de perfil
    apply_profiles(df, perfis) -> anexa as colunas

O train.py chama build_profiles() DENTRO de cada fold, só com dados de treino.
As tabelas do modelo final são salvas em models/{versao}_profiles.pkl para a API.
"""
import os
import sys
import glob
import logging
import json
import warnings
import numpy as np
import pandas as pd
import joblib
from sklearn.preprocessing import LabelEncoder

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'artifacts')

HORARIOS_PICO = {6, 7, 8, 17, 18, 19}

# Razão abaixo disto conta como congestionamento real (o resto é fluxo livre).
LIMIAR_CONGESTIONAMENTO = 0.95

# Features conhecidas no momento da inferência, sem nenhum valor fabricado.
BASE_FEATURES = [
    'id_ponto_enc',
    'hora',
    'dia_semana',
    'hora_sin',
    'hora_cos',
    'is_fim_semana',
    'is_horario_pico',
    'velocidade_livre',
]

# Perfis históricos — o "histórico de cada horário".
PROFILE_FEATURES = [
    'perfil_via_hora_dow',      # mediana da via naquele horário e dia da semana
    'perfil_via_hora',          # mediana da via naquele horário (qualquer dia)
    'perfil_via',               # mediana geral da via
    'perfil_hora_dow',          # mediana global do horário+dia — serve via nova
    'perfil_via_hora_dow_std',  # dispersão local: quão instável é essa faixa
    'perfil_via_hora_dow_n',    # nº de amostras que formaram o perfil
]

# Recência — a observação real mais recente da via, não um agregado.
# Validado no benchmark XGBoost vs. LSTM (18/08/2026, ver
# LIA_2.0_AUDITORIA_E_MUDANCAS.md seção 11): o LSTM só vencia o XGBoost original
# porque enxergava as últimas observações da via; o XGBoost não enxergava
# nenhuma. Dando essa mesma informação por aqui, o XGBoost empata com o LSTM
# (RMSE 41,0s vs 41,5s) treinando 3,4x mais rápido e sem precisar de GPU.
#
# Ao contrário dos PROFILE_FEATURES (agregados, recalculados por fold para não
# vazar), estas duas colunas são causais por construção — cada linha usa só a
# observação REAL imediatamente anterior daquela via, então não há risco de
# vazamento e o cálculo pode ser feito uma vez, fora do laço de folds.
RECENCY_FEATURES = [
    'razao_lag1',       # razão da observação real anterior da mesma via
    'delta_min_lag1',   # minutos até ela, em log1p (comprime a cauda de gaps)
]

FEATURE_COLS = BASE_FEATURES + PROFILE_FEATURES + RECENCY_FEATURES

# LIA 2.2 — contexto (vizinhos, chuva, feriado). As regras moram em
# apps/api/contexto.py, o MESMO módulo que a API usa na inferência.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'apps', 'api'))
import contexto as ctx  # noqa: E402

CONTEXT_FEATURES = ctx.CONTEXT_FEATURES


def feature_cols(com_contexto: bool = False) -> list:
    return FEATURE_COLS + (CONTEXT_FEATURES if com_contexto else [])


TARGET_COL = 'razao_congestionamento'


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


def build_base(df: pd.DataFrame) -> pd.DataFrame:
    """Calendário + alvo. Nada aqui depende de outras linhas, então é leak-free."""
    logging.info("Construindo features de calendário e alvo...")

    dt = df['data_hora_brasilia'].dt
    df['hora'] = dt.hour
    df['dia_semana'] = dt.dayofweek  # 0=Seg, 6=Dom
    df['is_fim_semana'] = (df['dia_semana'] >= 5).astype(int)
    df['is_horario_pico'] = df['hora'].isin(HORARIOS_PICO).astype(int)

    # Codificação cíclica: 23h e 0h passam a ser vizinhos.
    df['hora_sin'] = np.sin(2 * np.pi * df['hora'] / 24)
    df['hora_cos'] = np.cos(2 * np.pi * df['hora'] / 24)

    # Alvo. velocidade_livre > 0 já é garantido pelos filtros do silver.py.
    df[TARGET_COL] = df['velocidade_atual'] / df['velocidade_livre']
    df[TARGET_COL] = df[TARGET_COL].clip(0.05, 1.0)

    # Ordenação temporal GLOBAL — a validação cruzada divide por índice de linha,
    # então ordenar por id_ponto (como fazia a 1.0) transformava o TimeSeriesSplit
    # num split por via, com treino e validação no mesmo período.
    df = df.sort_values('data_hora_brasilia').reset_index(drop=True)

    return df


def add_recency_features(df: pd.DataFrame) -> pd.DataFrame:
    """Razão e intervalo da última observação REAL da via (não um agregado).

    Em produção, isso não pode vir do Silver — muda a cada ciclo de coleta
    (~8 min). A API mantém um cache próprio (apps/api/recency_cache.py) que busca
    a observação mais recente de cada via no Supabase. Aqui, para treino, é
    apenas um shift(1) por via sobre dados já ordenados por tempo real: NÃO
    reamostra para frequência fixa — foi exatamente essa reindexação que, na
    tentativa de interpolação removida na Fase 0, gerou ~60 milhões de pontos
    sintéticos e destruiu 99,5% dos dados reais.

    Descarta apenas a primeira observação de cada via (sem antecessor) — 630
    linhas de 1,5 milhão, desprezível.
    """
    logging.info("Adicionando features de recência (última observação real por via)...")

    df = df.sort_values(['id_ponto', 'data_hora_brasilia'])
    grp = df.groupby('id_ponto', sort=False)
    df['razao_lag1'] = grp[TARGET_COL].shift(1)
    delta_min = grp['data_hora_brasilia'].diff().dt.total_seconds() / 60.0
    df['delta_min_lag1'] = np.log1p(delta_min.clip(lower=0))

    antes = len(df)
    df = df.dropna(subset=RECENCY_FEATURES)
    logging.info(f"  {antes - len(df)} linhas descartadas (1ª observação de cada via)")

    # Volta à ordenação temporal global — add_recency_features reordenou por via.
    df = df.sort_values('data_hora_brasilia').reset_index(drop=True)
    return df


def carregar_coords_vias() -> dict:
    """Coordenadas das vias monitoradas (backup local de vias_monitoradas)."""
    arquivos = sorted(glob.glob(os.path.join(MODELS_DIR, 'backup_*_vias_monitoradas.parquet')), reverse=True)
    if not arquivos:
        raise FileNotFoundError('backup_*_vias_monitoradas.parquet ausente em ml/artifacts '
                                '(exporte vias_monitoradas do Supabase antes de treinar com contexto).')
    v = pd.read_parquet(arquivos[0], columns=['id_ponto', 'latitude', 'longitude']).dropna()
    return {int(r.id_ponto): (float(r.latitude), float(r.longitude)) for r in v.itertuples()}


def add_context_features(df: pd.DataFrame, vizinhos: dict) -> pd.DataFrame:
    """LIA 2.2: vizinhos, chuva e feriado (regras em apps/api/contexto.py).

    Vizinhos: para cada leitura de uma via, a última razão de cada uma das k vias
    vizinhas observada ESTRITAMENTE antes, até 60 min (merge_asof backward,
    allow_exact_matches=False) — causal por construção, como a recência.
    Chuva: rótulo da hora cheia (chuva de H-1 a H) + soma dos 3 últimos rótulos.
    """
    logging.info("Adicionando features de contexto (vizinhos, chuva, feriado)...")
    df = df.sort_values('data_hora_brasilia').reset_index(drop=True)
    t = df['data_hora_brasilia']
    janela = pd.Timedelta(minutes=ctx.JANELA_VIZINHOS_MIN)

    series = {p: g[['data_hora_brasilia', TARGET_COL]].rename(columns={TARGET_COL: 'r'})
              for p, g in df.groupby('id_ponto', sort=False)}
    k = ctx.K_VIZINHOS
    valores = np.full((len(df), k), np.nan)
    for p, idx in df.groupby('id_ponto', sort=False).indices.items():
        # .reset_index mantém o fuso (.values viraria UTC ingênuo e quebraria o merge).
        esquerda = pd.DataFrame({'data_hora_brasilia': t.iloc[idx].reset_index(drop=True), 'pos': idx})
        for j, q in enumerate(vizinhos.get(int(p), [])[:k]):
            direita = series.get(q)
            if direita is None:
                continue
            m = pd.merge_asof(esquerda, direita, on='data_hora_brasilia', direction='backward',
                              allow_exact_matches=False, tolerance=janela)
            valores[m['pos'].values, j] = m['r'].values
    n = np.sum(~np.isnan(valores), axis=1)
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)  # linha sem vizinho → NaN (média vazia)
        df['vizinhos_razao'] = np.nanmean(valores, axis=1)
    df['vizinhos_n'] = n.astype(float)

    # Chuva: série horária local (rótulo H = chuva de H-1 a H).
    with open(os.path.join(MODELS_DIR, 'chuva_brasilia.json'), encoding='utf-8') as f:
        horaria = ctx.carregar_chuva_openmeteo(json.load(f))
    s = pd.Series(horaria).sort_index()
    s = s.reindex(pd.date_range(s.index.min(), s.index.max(), freq='h'))
    s3 = s.rolling(3, min_periods=1).sum()
    hora_cheia = t.dt.tz_localize(None).dt.floor('h') if t.dt.tz is not None else t.dt.floor('h')
    df['chuva_mm'] = hora_cheia.map(s).astype(float)
    df['chuva_3h_mm'] = hora_cheia.map(s3).astype(float)

    feriados = ctx.carregar_feriados(os.path.join(MODELS_DIR, 'feriados.json'))
    df['is_feriado'] = hora_cheia.dt.date.map(lambda d: ctx.is_feriado(d, feriados)).astype(int)

    logging.info(
        f"  vizinhos com leitura recente: {(n > 0).mean() * 100:.1f}% das linhas (média {n[n > 0].mean():.1f}) | "
        f"chuva > 0 em {(df['chuva_mm'] > 0).mean() * 100:.1f}% | feriado em {df['is_feriado'].mean() * 100:.2f}%"
    )
    return df


def build_profiles(df_train: pd.DataFrame) -> dict:
    """Monta as tabelas de perfil histórico a partir de dados de TREINO apenas.

    Usa mediana em vez de média: 82,9% das amostras estão em fluxo livre e a
    cauda de congestionamento é longa, então a média seria puxada pelos extremos.
    """
    alvo = TARGET_COL

    vhd = (
        df_train.groupby(['id_ponto', 'hora', 'dia_semana'])[alvo]
        .agg(['median', 'std', 'size'])
        .rename(columns={
            'median': 'perfil_via_hora_dow',
            'std': 'perfil_via_hora_dow_std',
            'size': 'perfil_via_hora_dow_n',
        })
    )
    vh = (
        df_train.groupby(['id_ponto', 'hora'])[alvo]
        .median().rename('perfil_via_hora')
    )
    v = (
        df_train.groupby('id_ponto')[alvo]
        .median().rename('perfil_via')
    )
    hd = (
        df_train.groupby(['hora', 'dia_semana'])[alvo]
        .median().rename('perfil_hora_dow')
    )

    return {
        'via_hora_dow': vhd,
        'via_hora': vh,
        'via': v,
        'hora_dow': hd,
        'global': float(df_train[alvo].median()),
    }


def apply_profiles(df: pd.DataFrame, perfis: dict) -> pd.DataFrame:
    """Anexa as colunas de perfil, com cascata de fallback do específico ao geral.

    Uma via nunca vista cai em perfil_hora_dow — é isso que sustenta o knowledge
    transfer da API para arestas não monitoradas.
    """
    df = df.merge(perfis['via_hora_dow'], how='left',
                  left_on=['id_ponto', 'hora', 'dia_semana'], right_index=True)
    df = df.merge(perfis['via_hora'], how='left',
                  left_on=['id_ponto', 'hora'], right_index=True)
    df = df.merge(perfis['via'], how='left',
                  left_on='id_ponto', right_index=True)
    df = df.merge(perfis['hora_dow'], how='left',
                  left_on=['hora', 'dia_semana'], right_index=True)

    g = perfis['global']

    # Cascata: do mais geral para o mais específico, cada nível cobre o buraco do anterior.
    df['perfil_hora_dow'] = df['perfil_hora_dow'].fillna(g)
    df['perfil_via'] = df['perfil_via'].fillna(df['perfil_hora_dow'])
    df['perfil_via_hora'] = df['perfil_via_hora'].fillna(df['perfil_via'])
    df['perfil_via_hora_dow'] = df['perfil_via_hora_dow'].fillna(df['perfil_via_hora'])

    # std NaN = faixa com 1 só amostra ⇒ dispersão desconhecida, trata como 0.
    df['perfil_via_hora_dow_std'] = df['perfil_via_hora_dow_std'].fillna(0.0)
    df['perfil_via_hora_dow_n'] = df['perfil_via_hora_dow_n'].fillna(0).astype(int)

    return df


def razao_para_segundos(tempo_real_s, razao_real, razao_pred):
    """Converte erro na razão para erro em segundos, para leitura humana.

    Para comprimento e velocidade livre fixos, tempo ∝ 1/razão:
        tempo = L*3.6 / (razão * v_livre)
    logo tempo_pred = tempo_real * (razão_real / razão_pred).
    """
    razao_pred = np.clip(razao_pred, 0.05, 1.0)
    return tempo_real_s * (razao_real / razao_pred)


def run(version: str = 'lia_2.0', com_contexto: bool = False) -> tuple[pd.DataFrame, pd.Series]:
    """Prepara o dataset. Devolve (df completo, alvo).

    NÃO devolve X pronto: as features de perfil dependem do fold e são anexadas
    pelo train.py via build_profiles/apply_profiles.
    com_contexto: LIA 2.2 — também salva {version}_vizinhos.json, que a API usa
    para montar a MESMA feature de vizinhos na inferência.
    """
    os.makedirs(MODELS_DIR, exist_ok=True)
    encoder_path = os.path.join(MODELS_DIR, f'{version}_encoder.pkl')

    df = load_latest_silver()
    n_silver = len(df)

    df, enc = encode_id_ponto(df, encoder_path)
    df = build_base(df)
    df = add_recency_features(df)
    if com_contexto:
        vizinhos = ctx.vizinhos_monitorados(carregar_coords_vias())
        with open(os.path.join(MODELS_DIR, f'{version}_vizinhos.json'), 'w', encoding='utf-8') as f:
            json.dump({'k': ctx.K_VIZINHOS, 'raio_m': ctx.RAIO_VIZINHOS_M,
                       'janela_min': ctx.JANELA_VIZINHOS_MIN,
                       'vizinhos': {str(p): vs for p, vs in vizinhos.items()}}, f)
        df = add_context_features(df, vizinhos)

    if len(df) == 0:
        raise ValueError("Dataset vazio após preparação. Verifique o Silver.")

    y = df[TARGET_COL]
    congestionadas = (y < LIMIAR_CONGESTIONAMENTO).sum()

    logging.info("\n--- Dataset Final ---")
    logging.info(f"Registros: {len(df):,} (100.0% do Silver — nenhum descartado)")
    logging.info(f"Pontos: {df['id_ponto'].nunique()}")
    logging.info(f"Período: {df['data_hora_brasilia'].min()} → {df['data_hora_brasilia'].max()}")
    logging.info(
        f"Alvo (razão) — mediana: {y.median():.3f}  média: {y.mean():.3f}  mín: {y.min():.3f}"
    )
    logging.info(
        f"Congestionamento real (razão < {LIMIAR_CONGESTIONAMENTO}): "
        f"{congestionadas:,} ({congestionadas/len(df)*100:.1f}%) — "
        f"o restante está em fluxo livre"
    )
    logging.info(f"Features base: {BASE_FEATURES}")
    logging.info(f"Features de perfil (por fold): {PROFILE_FEATURES}")
    logging.info(f"Features de recência: {RECENCY_FEATURES}")

    meta_path = os.path.join(MODELS_DIR, f'{version}_metadata.json')
    meta = {
        'versao': version.upper().replace('_', ' '),
        'alvo': TARGET_COL,
        'alvo_descricao': 'velocidade_atual / velocidade_livre (adimensional, 0.05–1.0)',
        'features': feature_cols(com_contexto),
        'features_recencia': RECENCY_FEATURES,
        'features_contexto': CONTEXT_FEATURES if com_contexto else [],
        'total_amostras': int(len(df)),
        'registros_silver': int(n_silver),
        'aproveitamento_pct': round(len(df) / n_silver * 100, 1),
        'pct_congestionado': round(congestionadas / len(df) * 100, 1),
    }
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    logging.info(f"Metadata parcial salva: {meta_path}")

    return df, y


if __name__ == '__main__':
    run()
