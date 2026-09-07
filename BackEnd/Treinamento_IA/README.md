<div align="center">

# Routify — Treinamento da LIA

**Pipeline Bronze → Silver → Features → XGBoost + MLflow**

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![XGBoost](https://img.shields.io/badge/XGBoost-3.2-FF6F00?style=flat-square)
![Optuna](https://img.shields.io/badge/Optuna-4.9-0083CC?style=flat-square)
![MLflow](https://img.shields.io/badge/MLflow-3.12-0194E2?style=flat-square&logo=mlflow&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-1.8-F7931E?style=flat-square&logo=scikit-learn&logoColor=white)

</div>

---

## 🎯 Objetivo

Treinar a **LIA** (*Logística de Inteligência Artificial*) — modelo que prevê a **razão de congestionamento** (`velocidade_atual / velocidade_livre`) de cada via monitorada, a partir dos dados coletados pelo `BackEnd/Servidor` no Supabase.

A saída é um conjunto de artefatos versionados (`lia_X.Y.pkl` + encoder + perfis + metadata) consumidos pela `BackEnd/API` para alimentar o algoritmo A\*.

> **Por que razão, e não segundos?** O tempo de viagem depende do comprimento
> do trecho; a razão de congestionamento é adimensional e a mesma predição
> serve arestas de qualquer tamanho — é o que permite treinar um único
> modelo para toda a malha viária.

---

## 🧱 Pipeline

```
   Supabase                  silver.py              features.py              train.py
   historico_trafego  ──▶  Bronze→Silver   ──▶   perfis + recência ──▶   XGBoost + CV
   (1,5M+ rows)            Parquet limpo        + LabelEncoder            ↓
                                                                    lia_2.1.pkl
                                                                    lia_2.1_encoder.pkl
                                                                    lia_2.1_profiles.pkl
                                                                    lia_2.1_metadata.json
                                                                    mlruns/
```

Cada `python train.py` executa as 3 etapas em sequência. **Silver não é
congelado** — recarrega 100% dos dados do Supabase a cada treino, garantindo
que novos dados entrem automaticamente. Use `--skip-silver` para reaproveitar
o Parquet já gerado (mais rápido, útil em iteração).

---

## 📂 Arquivos

| Arquivo | Função |
|---|---|
| `silver.py` | Pull do `historico_trafego` em chunks de 1k, conversão UTC→UTC-3, remoção de outliers, forward-fill limitado (32min), export Parquet |
| `features.py` | Perfis históricos por (via, hora, dia da semana) com cascata de fallback, feature de recência, LabelEncoder do `id_ponto` |
| `train.py` | `TimeSeriesSplit` (5 folds), MLflow logging, treino final em 100% dos dados, persistência |
| `otimizar_hiperparametros.py` | Busca bayesiana de hiperparâmetros (Optuna), reaproveitando a mesma validação de `train.py` |
| `calibrar_transfer.py` | Calibra a confiança do Knowledge Transfer (vias sem monitoramento direto) por regressão isotônica sobre pares reais |
| `validar_fase3.py` | Compara a rota da LIA, a de menor distância e a de uma referência externa (TomTom) para o mesmo par origem-destino |
| `requirements.txt` | Dependências Python |
| `models/` | (gitignored) Artefatos pesados |

---

## ⚙️ Setup

```bash
cd BackEnd/Treinamento_IA
pip install -r requirements.txt
```

**Pré-requisito:** `.env` em `../Servidor/config/.env` (copie de `.env.example` e preencha):
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

### Versão customizada / reaproveitando o Silver já baixado
```bash
python train.py --version lia_2.2 --skip-silver
```

### Etapas isoladas (debug)
```bash
python silver.py     # só atualiza Silver
```

### Calibração e otimização (opcionais, não bloqueiam a API)
```bash
python calibrar_transfer.py                          # recalibra a confiança do Knowledge Transfer
python otimizar_hiperparametros.py --n-trials 60      # busca bayesiana de hiperparâmetros
python validar_fase3.py                               # LIA vs. TomTom vs. menor distância
```

---

## 🔢 Features (16)

| Feature | Origem | Por quê |
|---|---|---|
| `id_ponto_enc` | `LabelEncoder` | Identidade do segmento |
| `hora` | `data_hora_brasilia.hour` | Padrão intradiário |
| `dia_semana` | `.dayofweek` | Seg-Sex vs Sáb-Dom |
| `hora_sin` / `hora_cos` | seno/cosseno da hora | Preserva ciclicidade (23h está perto de 0h) |
| `is_fim_semana` | `dow >= 5` | Comportamento diferente |
| `is_horario_pico` | `hora ∈ {6,7,8,17,18,19}` | Rush Brasília |
| `velocidade_livre` | direto da via | Limite teórico da via |
| `perfil_via_hora_dow` | mediana histórica (via, hora, dow) | Perfil mais específico disponível |
| `perfil_via_hora` | mediana histórica (via, hora) | Fallback quando falta amostra no nível acima |
| `perfil_via` | mediana histórica (via) | Fallback seguinte |
| `perfil_hora_dow` | mediana histórica (hora, dow) global | Fallback final — sustenta o Knowledge Transfer |
| `perfil_via_hora_dow_std` | dispersão da faixa | Sinaliza instabilidade da faixa ao modelo |
| `perfil_via_hora_dow_n` | nº de amostras da faixa | Sinaliza confiabilidade do perfil |
| `razao_lag1` | última observação real da via | Recência — ver nota abaixo |
| `delta_min_lag1` | minutos desde essa observação | Recência |

> **Recência (`razao_lag1`/`delta_min_lag1`):** validado em benchmark contra
> LSTM — essas duas features dão ao XGBoost acesso à mesma informação que
> uma rede recorrente teria por desenho (a observação mais recente da via),
> eliminando a vantagem que o LSTM tinha nesse quesito. Em produção, vêm de
> um cache com TTL (`API/recencia_cache.py`), não de um `shift()` sobre o
> dataset de treino — reproduzível na inferência, diferente dos `lag_*` da
> LIA 1.0, que só existiam no treino.

> Sem lags de série temporal (`shift`/`rolling`) como na LIA 1.0 — a
> arquitetura de perfis históricos não depende de espaçamento regular entre
> coletas, então não sofre com os buracos de coleta que quebravam os lags.

---

## 🏋️ Hiperparâmetros XGBoost

```python
XGB_PARAMS = {
    'n_estimators': 750,
    'max_depth': 8,
    'learning_rate': 0.0706,
    'subsample': 0.5207,
    'colsample_bytree': 0.5292,
    'min_child_weight': 16,
    'reg_alpha': 0.2846,
    'reg_lambda': 3.0032,
    'objective': 'reg:squarederror',
    'eval_metric': 'rmse',
    'early_stopping_rounds': 40,  # só durante CV
    'tree_method': 'hist',
    'random_state': 42,
}
```

Determinados por `otimizar_hiperparametros.py` (Optuna, amostrador TPE, poda
por mediana, 60 trials) — ganho de +2,2% no RMSE da razão de congestionamento
sobre os valores manuais anteriores. Para buscar de novo (ex. após acumular
mais dados), rode o script e confira se o ganho justifica atualizar aqui.

**Validação:** `TimeSeriesSplit(n_splits=5)` — sem vazamento de dados
futuros; os perfis históricos são recalculados dentro de cada fold, só com
dados de treino.
**Modelo final:** treinado em **100% dos dados**, sem `early_stopping_rounds`.

---

## 📊 MLflow

Visualizar runs:
```bash
mlflow ui --backend-store-uri "file:///<caminho-absoluto>/models/mlruns"
```

Métricas logadas por run: RMSE/MAE (em razão e em segundos, geral e só no
subconjunto congestionado), importância de cada feature, hiperparâmetros,
total de amostras, nº de pontos monitorados, período coberto.

---

## 🧭 Sobre o roadmap original (LSTM, K-Means)

O planejamento inicial deste ciclo previa duas evoluções que **não
seguiram como planejado**, por motivos testados e documentados, não por
abandono:

- **Migração para LSTM:** testada com benchmark controlado. Com a feature
  de recência adicionada, XGBoost e LSTM empatam — XGBoost treina ~3,4x mais
  rápido e dispensa GPU em produção. **Decisão: manter XGBoost.**
- **Interpolação temporal com K-Means:** implementada, mas a versão inicial
  reindexava cada via em intervalos fixos de 8 minutos, gerando dezenas de
  milhões de pontos sintéticos e destruindo a maior parte dos dados reais no
  processo. Removida — a arquitetura de perfis históricos não depende de
  espaçamento regular, então deixou de ser necessária.

---

## 🚨 Troubleshooting

**`KeyError: 'c'` no `mlflow.set_experiment`** — Path Windows interpretado como scheme. Já corrigido com `Path(...).as_uri()`.

**`Shape X: (0, N)` após features** — Silver pegou poucos rows (Supabase corta default em 1000/req). `CHUNK_SIZE = 1000` em `silver.py` já cobre isso via paginação — confirme que os dados existem no Supabase.

**Treino lento** — `tree_method='hist'` já está habilitado. Com GPU disponível (`device='cuda'`), o script detecta e usa automaticamente; sem GPU, cai para CPU sem erro.

**`optuna` não instalado** — `pip install -r requirements.txt` já inclui; se rodou antes de atualizar, `pip install optuna`.
