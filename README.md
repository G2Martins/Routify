<div align="center">
  <img src="Docs/Logo/Logo_Routify.png" alt="Routify" width="320"/>

  # Routify

  **Roteamento Logístico Preditivo para Brasília (DF)**

  *Trabalho de Conclusão de Curso — Cidades Inteligentes & Logística Preditiva*

  ![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
  ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white)
  ![XGBoost](https://img.shields.io/badge/XGBoost-2.1-FF6F00?style=flat-square)
  ![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?style=flat-square&logo=react&logoColor=black)
  ![Expo](https://img.shields.io/badge/Expo-54-000020?style=flat-square&logo=expo&logoColor=white)
  ![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?style=flat-square&logo=supabase&logoColor=white)
  ![License](https://img.shields.io/badge/License-Acadêmico-blue?style=flat-square)
</div>

---

## 📌 Sumário

- [Visão Geral](#-visão-geral)
- [Arquitetura](#-arquitetura)
- [Stack Tecnológica](#-stack-tecnológica)
- [Estrutura do Repositório](#-estrutura-do-repositório)
- [Pipeline de Dados (Medallion)](#-pipeline-de-dados-medallion)
- [LIA — A Inteligência Artificial](#-lia--a-inteligência-artificial)
- [Como Executar](#-como-executar)
- [Roadmap](#-roadmap)
- [Equipe](#-equipe)

---

## 🎯 Visão Geral

**Routify** é um sistema de roteamento logístico **preditivo** para a malha viária do Distrito Federal. Diferente de aplicativos tradicionais que respondem ao tráfego *atual*, o Routify aprende padrões temporais (intradiários, semanais, sazonais) e **prevê** o tempo de viagem em cada arco da malha viária para o momento da consulta.

O motor preditivo — **LIA** (*Logística Inteligente Adaptativa*) — alimenta o algoritmo **A\*** com pesos de aresta calculados em tempo real, retornando rotas otimizadas que minimizam o tempo de viagem **previsto**, não o instantâneo.

### Por que isso importa?

- ✅ **Tráfego é cíclico**: padrões de segunda 8h ≠ sábado 22h. Modelos preditivos capturam isso; mapas reativos não.
- ✅ **Logística precisa de previsibilidade**: motoristas e operadores logísticos dependem de ETA confiável para planejamento de entregas.
- ✅ **Cidades Inteligentes**: dados estruturados de tráfego viabilizam políticas públicas baseadas em evidências.

---

## 🏗 Arquitetura

```
                 ┌─────────────────────────────────────┐
                 │        AWS EC2 (24/7)               │
                 │   BackEnd/Servidor/                 │
                 │   ─────────────────                 │
                 │   • TomTom Flow API (a cada 8 min)  │
                 │   • OSMnx (topologia)               │
                 │   • db_manager → Supabase           │
                 └─────────────────┬───────────────────┘
                                   │ INSERT
                                   ▼
                 ┌─────────────────────────────────────┐
                 │   Supabase (Postgres)               │
                 │   ─────────────────                 │
                 │   • malha_completa     (~38k vias)  │
                 │   • vias_monitoradas   (~600 pts)   │
                 │   • historico_trafego  (700k+ rows) │
                 └─────────────────┬───────────────────┘
                                   │ SELECT (chunks 1k)
                                   ▼
                 ┌─────────────────────────────────────┐
                 │   BackEnd/Treinamento_IA/   [local] │
                 │   ─────────────────                 │
                 │   1. silver.py    → Parquet limpo   │
                 │   2. features.py  → 14 features     │
                 │   3. train.py     → XGBoost + CV    │
                 │     ↓                                │
                 │   models/lia_1.0.pkl  +  encoder    │
                 │   models/lia_1.0_metadata.json      │
                 │   models/mlruns/ (MLflow)           │
                 └─────────────────┬───────────────────┘
                                   │ joblib.load
                                   ▼
                 ┌─────────────────────────────────────┐
                 │   BackEnd/API/      [Railway/Render]│
                 │   ─────────────────                 │
                 │   • FastAPI + lifespan              │
                 │   • Modelo embutido no container    │
                 │   • OSMnx graph cache (.graphml)    │
                 │   • POST /predict  → tempo segmento │
                 │   • POST /route    → A* com LIA     │
                 │   • GET  /metrics  → métricas reais │
                 └─────────────────┬───────────────────┘
                                   │ HTTPS / JSON
                                   ▼
                 ┌─────────────────────────────────────┐
                 │   FrontEnd (React Native + Expo)    │
                 │   ─────────────────                 │
                 │   • Universal App (iOS/Android/Web) │
                 │   • Web: Leaflet (CartoDB dark)     │
                 │   • Native: react-native-maps       │
                 │   • Geocoding: Nominatim            │
                 │   • LIAIndicator: animação 3 anéis  │
                 └─────────────────────────────────────┘
```

---

## 🛠 Stack Tecnológica

### Backend
| Camada | Tecnologia | Versão | Propósito |
|---|---|---|---|
| Coleta | Python + TomTom Flow API | — | Coleta de tráfego a cada 8 min |
| Topologia | OSMnx + Shapely | 1.9.3 | Extração de malha viária do OSM |
| Banco | Supabase (Postgres) | — | Persistência de séries temporais |
| Pipeline ML | pandas + pyarrow | 2.2 / 17.0 | Bronze→Silver, feature engineering |
| Modelo | XGBoost | 2.1 | Regressor de tempo de viagem |
| Versionamento | MLflow | 2.17 | Tracking de runs, métricas, artifacts |
| API | FastAPI + Uvicorn | 0.115 / 0.32 | Servir predição e roteamento |
| Roteamento | NetworkX (A\*) | 3.4 | Caminho mínimo com pesos LIA |

### Frontend
| Camada | Tecnologia | Versão |
|---|---|---|
| Framework | React Native + Expo | 0.81 / 54 |
| Linguagem | TypeScript | 5.9 |
| Navegação | React Navigation | 7.x |
| Mapa Web | Leaflet | 1.9.4 |
| Mapa Native | react-native-maps | 1.20 |
| Tiles | CartoDB Dark + OpenStreetMap | — |
| Geocoding | Nominatim (OSM, gratuito) | — |
| Localização | expo-location | 19 |

---

## 📂 Estrutura do Repositório

```
Routify/
├── BackEnd/
│   ├── Servidor/                    ← Coleta 24/7 em AWS EC2 (não modificar)
│   │   ├── config/
│   │   │   ├── .env                 ← SUPABASE_URL, SUPABASE_KEY
│   │   │   └── tomtom_keys.json     ← pool de chaves TomTom
│   │   ├── models/db_manager.py     ← bulk insert no Supabase
│   │   ├── services/
│   │   │   ├── map_extractor.py     ← Overpass → malha_completa
│   │   │   └── traffic_collector.py ← TomTom Flow → historico_trafego
│   │   ├── main.py                  ← scheduler (a cada 8 min)
│   │   └── requirements.txt
│   │
│   ├── Treinamento_IA/              ← Pipeline ML local
│   │   ├── silver.py                ← Bronze → Silver (rotina pré-treino)
│   │   ├── features.py              ← 14 features temporais + LabelEncoder
│   │   ├── train.py                 ← XGBoost + TimeSeriesSplit + MLflow
│   │   ├── models/                  ← (gitignored) artefatos pesados
│   │   │   ├── silver_YYYYMMDD.parquet
│   │   │   ├── lia_1.0.pkl
│   │   │   ├── lia_1.0_encoder.pkl
│   │   │   ├── lia_1.0_metadata.json
│   │   │   └── mlruns/
│   │   └── requirements.txt
│   │
│   └── API/                         ← FastAPI servindo LIA + A*
│       ├── main.py                  ← lifespan: carrega modelo + grafo
│       ├── routers/
│       │   ├── predict.py           ← POST /predict (segmento)
│       │   └── route.py             ← POST /route (A* com pesos LIA)
│       ├── Dockerfile
│       └── requirements.txt
│
├── FrontEnd/                        ← Universal App (iOS/Android/Web)
│   ├── src/
│   │   ├── components/
│   │   │   ├── LIAIndicator.tsx     ← animação 3 anéis (idle/thinking/done)
│   │   │   ├── MapComponent.web.tsx    ← Leaflet (dynamic import)
│   │   │   └── MapComponent.native.tsx ← react-native-maps
│   │   ├── screens/
│   │   │   ├── MapScreen.tsx        ← geocoding + chamada /route
│   │   │   ├── DashboardScreen.tsx  ← métricas reais via /metrics
│   │   │   └── ProfileScreen.tsx
│   │   ├── navigation/MainNavigator.tsx
│   │   └── constants/Colors.ts
│   ├── App.tsx
│   ├── app.json
│   └── package.json
│
├── Docs/
│   ├── Logo/                        ← Logo_Routify.png + ícone
│   └── Plano de Trabalho TCC.pdf
│
└── README.md                        ← este arquivo
```

---

## 🥉🥈🥇 Pipeline de Dados (Medallion)

| Camada | Onde | Conteúdo | Status |
|---|---|---|---|
| **Bronze** | Supabase `historico_trafego` | Raw TomTom (700k+ rows, mar-abr/2026) | ✅ Coletando ao vivo |
| **Silver** | `Treinamento_IA/silver.py` → Parquet | UTC→UTC-3, outliers removidos, forward-fill | ✅ Rotina pré-treino |
| **Gold** | (futuro) tensores LSTM | Features sequenciais para deep learning | ⏳ TCC 2 |

**Por que Silver é rotina e não fixo?** Cada `python train.py` recarrega 100% dos dados do Supabase. Novos registros entram automaticamente no próximo treino — LIA 2.0 não precisa de retrabalho.

---

## 🤖 LIA — A Inteligência Artificial

### LIA 1.0 — XGBoost (atual, TCC 1)

| Aspecto | Detalhe |
|---|---|
| Algoritmo | `XGBRegressor` |
| Dados | 100% de março+abril/2026 |
| Validação | TimeSeriesSplit (5 folds temporais) |
| Target | `tempo_viagem_segundos` |
| Meta CV RMSE | < 120s |
| Versionamento | MLflow + joblib (`lia_X.Y.pkl`) |

**14 features:**
```
hora, dia_semana, is_fim_semana, is_horario_pico,
id_ponto_enc (LabelEncoder), velocidade_livre,
lag_vel_1h, lag_vel_3h, lag_vel_24h, lag_vel_7d,
rolling_mean_6h, rolling_std_6h,
lag_tempo_1h, lag_tempo_24h
```

### Roadmap LIA

| Versão | Modelo | Dados | Meta CV RMSE | Quando |
|---|---|---|---|---|
| LIA 1.0 | XGBoost | mar-abr/2026 | < 120s | TCC 1 (atual) |
| LIA 2.0 | LightGBM + Optuna | + mai-jul/2026 + eventos | < 90s | 2S/2026 |
| LIA 3.0 | LSTM | tensores Gold | < 60s | TCC 2 |

### Identidade Visual

`LIAIndicator.tsx` exibe 3 estados:
- **idle** — anel azul estático com versão e RMSE
- **thinking** — pulsação azul animada (`Animated.loop`) durante chamada à API
- **done** — flash verde, retorna a idle após 3s

---

## 🚀 Como Executar

### Pré-requisitos
- Python **3.11**
- Node.js **20+** e npm
- Conta Supabase com tabelas populadas (ou acesso ao DB do projeto)
- Chaves TomTom (apenas para coleta — opcional para treino/API)

---

### 1️⃣ Coleta de Dados (rodando em EC2 24/7 — opcional local)

```bash
cd BackEnd/Servidor
pip install -r requirements.txt

# Configurar credenciais
echo "SUPABASE_URL=https://xxxxx.supabase.co" > config/.env
echo "SUPABASE_KEY=eyJ..." >> config/.env
# config/tomtom_keys.json com array de chaves

python main.py
```

---

### 2️⃣ Treinamento da LIA (local)

```bash
cd BackEnd/Treinamento_IA
pip install -r requirements.txt

python train.py
# ou: python train.py --version lia_1.1
```

Saída em `models/`:
- `silver_YYYYMMDD.parquet` (dataset limpo)
- `lia_1.0.pkl` (modelo)
- `lia_1.0_encoder.pkl` (LabelEncoder do `id_ponto`)
- `lia_1.0_metadata.json` (RMSE, features, período)
- `mlruns/` (MLflow tracking)

**Visualizar runs no MLflow UI:**
```bash
mlflow ui --backend-store-uri "file:///<caminho-completo>/models/mlruns"
# abre http://127.0.0.1:5000
```

---

### 3️⃣ API FastAPI (local)

```bash
cd BackEnd/API
pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

Primeira execução baixa o grafo OSM (~1-2min), salva em `models/brasilia_graph.graphml` e cacheia.

**Testes rápidos:**
```bash
curl http://localhost:8000/health
curl http://localhost:8000/metrics

curl -X POST http://localhost:8000/route \
  -H "Content-Type: application/json" \
  -d '{"origem":{"lat":-15.79,"lon":-47.88},"destino":{"lat":-15.84,"lon":-47.92}}'
```

**Docs interativas:** http://localhost:8000/docs (Swagger UI nativo do FastAPI).

---

### 4️⃣ Frontend (Expo)

```bash
cd FrontEnd
npm install

npx expo start
```

- Pressione `w` → abre web (Leaflet)
- Pressione `a` → abre Android (Expo Go)
- Pressione `i` → abre iOS (Expo Go)

A URL da API é controlada por `__DEV__` em `MapScreen.tsx` e `DashboardScreen.tsx`:
- Dev: `http://localhost:8000`
- Prod: `https://routify-api.railway.app` (ajustar no deploy)

---

## 🗺 Endpoints da API

### `GET /health`
Status da API e do modelo carregado.

### `GET /metrics`
Métricas reais para o `DashboardScreen` (RMSE, n° pontos, amostras, feature importance).

### `POST /predict`
```json
{
  "id_ponto": 42,
  "hora": 18,
  "dia_semana": 2
}
```
→ `{ "tempo_viagem_segundos": 423.7, "modelo_versao": "lia_1.0" }`

### `POST /route`
```json
{
  "origem": { "lat": -15.79, "lon": -47.88 },
  "destino": { "lat": -15.84, "lon": -47.92 }
}
```
→
```json
{
  "polyline": [[-15.79, -47.88], [...], [-15.84, -47.92]],
  "tempo_total_seg": 1247,
  "distancia_km": 8.3,
  "via_principal": "Eixo Monumental",
  "modelo_utilizado": "lia_1.0",
  "nos_visitados": 312
}
```

---

## 🚧 Roadmap

### TCC 1 (1S/2026) — em andamento

- [x] Bronze ao vivo (TomTom + OSMnx em EC2)
- [x] Silver pipeline (rotina pré-treino)
- [x] Feature engineering (14 features temporais)
- [x] LIA 1.0 (XGBoost + TimeSeriesSplit + MLflow)
- [x] API FastAPI + A* com pesos LIA
- [x] Frontend Universal (iOS/Android/Web)
- [x] LIAIndicator (animação 3 estados)
- [ ] Deploy API (Railway ou Render)
- [ ] Apresentação banca

### 2S/2026 — TCC 2

- [ ] Tabela `eventos_trafego` (TomTom Incidents API + Waze for Cities)
- [ ] Feature `has_nearby_incident` + `gravidade_incidente`
- [ ] LIA 2.0 (LightGBM + Optuna tuning + dados mai-jul)
- [ ] Camada Gold (tensores sequenciais)
- [ ] LIA 3.0 (LSTM)
- [ ] Comparativo com Google Maps / Waze (benchmark de banca)

---

## 👥 Equipe

| Nome | GitHub | Papel |
|---|---|---|
| Gustavo Martins | [@G2Martins](https://github.com/G2Martins) | Orquestração, ML, API, Frontend |
| (parceiro) | — | Coleta, infraestrutura |

---

## 📄 Licença

Projeto acadêmico (TCC). Uso restrito a fins educacionais.

---

<div align="center">
  <img src="Docs/Logo/Logo_Routify_icon.png" alt="Routify" width="80"/>

  <i>Brasília merece logística previsível.</i>
</div>
