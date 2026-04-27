<div align="center">

# Routify — Treinamento da LIA

**Pipeline Bronze → Silver → Features → XGBoost + MLflow**

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![XGBoost](https://img.shields.io/badge/XGBoost-2.1-FF6F00?style=flat-square)
![MLflow](https://img.shields.io/badge/MLflow-2.17-0194E2?style=flat-square&logo=mlflow&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-1.5-F7931E?style=flat-square&logo=scikit-learn&logoColor=white)

</div>

---

## 🎯 Objetivo

Treinar a **LIA** (*Logística Inteligente Adaptativa*) — modelo preditivo de tempo de viagem por segmento da malha viária do DF — a partir dos dados coletados pelo `BackEnd/Servidor` no Supabase.

A saída é um conjunto de artefatos versionados (`lia_X.Y.pkl`) consumidos pela `BackEnd/API` para alimentar o algoritmo A\*.

---

## 🧱 Pipeline

```
   Supabase                  silver.py              features.py              train.py
   historico_trafego  ──▶  Bronze→Silver   ──▶   14 features      ──▶   XGBoost + CV
   (700k+ rows)            Parquet limpo        + LabelEncoder            ↓
                                                                    lia_1.0.pkl
                                                                    lia_1.0_encoder.pkl
                                                                    lia_1.0_metadata.json
                                                                    mlruns/
```

Cada `python train.py` executa as 3 etapas em sequência. **Silver não é congelado** — recarrega 100% do Supabase a cada treino, garantindo que novos dados entrem automaticamente.

---

## 📂 Arquivos

| Arquivo | Função |
|---|---|
| `silver.py` | Pull do `historico_trafego` em chunks de 1k, conversão UTC→UTC-3, remoção de outliers, forward-fill, export Parquet |
| `features.py` | 14 features temporais + LabelEncoder do `id_ponto` |
| `train.py` | TimeSeriesSplit (5 folds), MLflow logging, treino final em 100% dos dados, persistência |
| `requirements.txt` | Dependências Python |
| `models/` | (gitignored) Artefatos pesados |

---

## ⚙️ Setup

```bash
cd BackEnd/Treinamento_IA
pip install -r requirements.txt
```

**Pré-requisito:** `.env` em `../Servidor/config/.env` com:
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=eyJ...
```

---

## ▶️ Execução

### Treino completo
```bash
python train.py
```

### Versão customizada
```bash
python train.py --version lia_1.1
```

### Etapas isoladas (debug)
```bash
python silver.py     # só atualiza Silver
python features.py   # só gera features (precisa de Silver atualizado)
```

---

## 🔢 Features (14)

| Feature | Origem | Importância |
|---|---|---|
| `hora` | `data_hora_brasilia.hour` | Padrão intradiário (rush vs noite) |
| `dia_semana` | `.dayofweek` | Seg-Sex vs Sab-Dom |
| `is_fim_semana` | `dow >= 5` | Comportamento muito diferente |
| `is_horario_pico` | `hora ∈ {6,7,8,17,18,19}` | Rush Brasília |
| `id_ponto_enc` | `LabelEncoder` | Identidade do segmento |
| `velocidade_livre` | direto da via | Limite teórico da via |
| `lag_vel_1h` | shift(8 passos) | Velocidade 1h atrás |
| `lag_vel_3h` | shift(24 passos) | Tendência média |
| `lag_vel_24h` | shift(192 passos) | Mesmo horário ontem |
| `lag_vel_7d` | shift(1344 passos) | Mesmo horário semana passada |
| `rolling_mean_6h` | rolling(48).mean() | Tendência recente |
| `rolling_std_6h` | rolling(48).std() | Variabilidade recente |
| `lag_tempo_1h` | shift(8 passos) | Tempo viagem 1h atrás |
| `lag_tempo_24h` | shift(192 passos) | Tempo viagem ontem |

> ℹ️ TomTom coleta a cada **8 minutos** → 1h = 8 passos, 24h = 192 passos, 7d = 1344 passos.

---

## 🏋️ Hiperparâmetros XGBoost

```python
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
    'early_stopping_rounds': 30,  # apenas durante CV
    'tree_method': 'hist',
    'random_state': 42,
}
```

**Validação:** `TimeSeriesSplit(n_splits=5)` — sem vazamento de dados futuros.
**Modelo final:** treinado em **100% dos dados**, sem `early_stopping_rounds`.

---

## 📊 MLflow

Visualizar runs:
```bash
mlflow ui --backend-store-uri "file:///<caminho-absoluto>/models/mlruns"
```

Métricas logadas por run:
- `cv_rmse_mean`, `cv_rmse_std`, `cv_mae_mean`
- `fold_{1..5}_rmse`, `fold_{1..5}_mae`
- `importance_{feature_name}` para cada uma das 14
- Hiperparâmetros, total de amostras, n° de pontos, período

---

## 🎯 Metas de Acurácia

| Versão | Meta CV RMSE | Estratégia |
|---|---|---|
| LIA 1.0 | < 120s | Baseline XGBoost com 2 meses |
| LIA 2.0 | < 90s | + dados, + Optuna, + eventos |
| LIA 3.0 | < 60s | LSTM com tensores Gold |

---

## 🚨 Troubleshooting

**`KeyError: 'c'` no `mlflow.set_experiment`** — Path Windows interpretado como scheme. Já corrigido com `Path(...).as_uri()`.

**`Shape X: (0, 14)` após features** — Silver pegou poucos rows (Supabase corta default em 1000/req). `CHUNK_SIZE = 1000` em `silver.py` resolve.

**Treino lento** — `tree_method='hist'` já está habilitado. Se precisar de GPU: trocar para `'gpu_hist'` e instalar `xgboost` com CUDA.
