<div align="center">
  <img src="docs/Logo/Logo_Routify.png" alt="Routify" width="320"/>

  # Routify

  **Roteamento Logístico Preditivo para Brasília (DF)**

  *Trabalho de Conclusão de Curso — IESB — Engenharia da Computação*

  ![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
  ![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?style=flat-square&logo=fastapi&logoColor=white)
  ![XGBoost](https://img.shields.io/badge/XGBoost-3.2-FF6F00?style=flat-square)
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
- [LIA — A Inteligência Artificial](#-lia--a-inteligência-artificial)
- [Como Executar](#-como-executar)
- [Endpoints da API](#-endpoints-da-api)
- [Estado do projeto e próximos passos](#-estado-do-projeto-e-próximos-passos)
- [Equipe](#-equipe)

---

## 🎯 Visão Geral

**Routify** é um sistema de roteamento logístico **preditivo** para a malha viária do Distrito Federal. Diferente de aplicativos tradicionais que respondem ao tráfego *atual*, o Routify aprende padrões históricos (por via, horário e dia da semana) e **prevê** o quanto cada trecho está congestionado no momento da consulta.

O motor preditivo — **LIA** (*Logística de Inteligência Artificial*) — alimenta o algoritmo **A\*** com pesos de aresta calculados dinamicamente, retornando rotas que minimizam o tempo de viagem **previsto**, não a distância física.

### Por que isso importa?

- ✅ **Tráfego é cíclico**: padrões de segunda 8h ≠ sábado 22h. Perfis históricos por via/hora/dia capturam isso; roteamento por distância não.
- ✅ **Logística precisa de previsibilidade**: motoristas e operadores logísticos dependem de ETA confiável para planejamento de entregas.
- ✅ **Cidades Inteligentes**: dados estruturados de tráfego viabilizam políticas públicas baseadas em evidências.

---

## 🏗 Arquitetura

```mermaid
flowchart TB
    COL["services/collector/<br/>coleta TomTom a cada 8 min — pausada na fase final<br/>OSMnx: topologia da malha · Fase 3"] -->|INSERT| SB[("Supabase · Postgres<br/>malha_completa ~38k vias · vias_monitoradas ~630<br/>historico_trafego 1,5M+ linhas · route_history / profiles")]
    SB -->|SELECT em blocos| ML["ml/ — local<br/>silver → features → train (XGBoost + CV temporal)<br/>tune_hyperparams · calibrate_transfer"]
    ML -->|artefatos em ml/artifacts| API["apps/api/ — FastAPI<br/>modelo + grafo OSM em RAM<br/>/route (A* + LIA + TomTom sob demanda) · /predict · /search/places · /health"]
    TT["TomTom<br/>Flow · Incidents · Routing · Search"] <-->|sob demanda, pool de chaves| API
    API -->|HTTPS / JSON| APP["apps/mobile/ — Expo<br/>iOS · Android · Web"]
    APP -.->|Auth + histórico (RLS)| SB
```

Detalhe dos fluxos (cache de recência, rotação de chaves, busca de endereços): [docs/core/architecture.md](docs/core/architecture.md).

---

## 🛠 Stack Tecnológica

### Backend
| Camada | Tecnologia | Propósito |
|---|---|---|
| Coleta | Python + TomTom Flow Segment Data API | Telemetria de tráfego a cada 8 min, com pool de chaves rotativo |
| Topologia | OSMnx + Shapely + NetworkX | Malha viária como grafo, roteamento A* |
| Banco | Supabase (Postgres) | Persistência de séries temporais + auth do app |
| Pipeline ML | pandas + pyarrow | Bronze → Silver, engenharia de features |
| Modelo | XGBoost (via scikit-learn API) | Regressor da razão de congestionamento |
| Otimização | Optuna | Busca bayesiana de hiperparâmetros |
| Versionamento | MLflow | Tracking de runs, métricas, artefatos |
| API | FastAPI + Uvicorn | Serve predição, roteamento e autocomplete |

### Frontend
| Camada | Tecnologia |
|---|---|
| Framework | React Native + Expo (universal: iOS/Android/Web) |
| Linguagem | TypeScript |
| Navegação | React Navigation |
| Mapa Web | Leaflet |
| Mapa Native | react-native-maps |
| Auth | Supabase Auth (email/senha) |
| Geocoding | Backend próprio (`/search/places`), com Nominatim como fallback |

---

## 📂 Estrutura do Repositório

```
Routify/
├── apps/
│   ├── api/                       ← FastAPI: LIA + A* + TomTom sob demanda
│   │   ├── main.py                ← lifespan: carrega modelo + grafo
│   │   ├── lia_inference.py       ← features e cascata de perfis (espelha ml/features.py)
│   │   ├── graph_enrichment.py    ← liga o grafo às vias monitoradas
│   │   ├── recency_cache.py       ← última observação real por via
│   │   ├── tomtom.py              ← pool de chaves + clientes TomTom
│   │   ├── routers/               ← predict.py · route.py · search.py
│   │   ├── tests/                 ← pytest
│   │   └── requirements.txt
│   └── mobile/                    ← app universal Expo (iOS/Android/Web)
│       ├── src/                   ← components · context · screens · navigation · lib
│       ├── .env.example
│       └── package.json
├── services/
│   └── collector/                 ← coletor de tráfego (pausado na fase final)
│       ├── config/                ← .env.example + tomtom_keys.example.json
│       ├── deploy/                ← guia de deploy 24/7 (systemd)
│       ├── db.py                  ← acesso ao Supabase
│       ├── map_extractor.py       ← Overpass → malha_completa / vias_monitoradas
│       ├── traffic_collector.py   ← TomTom Flow → historico_trafego (rotação de chaves)
│       └── main.py                ← scheduler: coleta (8 min) + Fase 3 (4x/dia)
├── ml/                            ← pipeline de treino da LIA (local)
│   ├── silver.py · features.py · train.py
│   ├── tune_hyperparams.py        ← busca bayesiana (Optuna)
│   ├── calibrate_transfer.py      ← confiança do Knowledge Transfer
│   ├── benchmark_lstm_xgboost.py  ← LSTM × XGBoost
│   ├── external_validation.py     ← Fase 3: LIA × TomTom × menor distância
│   ├── thesis_figures.py          ← figuras do texto → docs/figuras/
│   └── artifacts/                 ← metadata JSON versionado; .pkl/.graphml/.parquet fora do git
├── supabase/migrations/           ← DDL versionada (rodar em ordem)
├── docs/                          ← arquitetura, texto do TCC, figuras, logo
├── .planning/                     ← estado e decisões (GSD)
├── .github/workflows/             ← CI, links da doc, keep-alive do Supabase
├── CLAUDE.md                      ← spec viva (porta de entrada)
└── README.md
```

> Os relatórios de auditoria técnica e o plano de execução do TCC 2 são
> markdown internos, não versionados neste repositório (ver `.gitignore`) —
> ficam só na máquina de quem os gerou.

---

## 🤖 LIA — A Inteligência Artificial

| Aspecto | Detalhe |
|---|---|
| Algoritmo | `XGBRegressor`, hiperparâmetros ajustados por busca bayesiana (Optuna) |
| Alvo | Razão de congestionamento (`velocidade_atual / velocidade_livre`), **não** segundos — independe do comprimento da via |
| Validação | `TimeSeriesSplit` (5 folds temporais) — sem vazamento de dados futuros |
| Perfis | Cascata por (via, hora, dia da semana) → (via, hora) → (via) → (hora, dia) → mediana global |
| Recência | Última observação real da via, via cache com TTL — dá ao XGBoost acesso à mesma informação que uma rede recorrente teria |
| Vias não monitoradas | Knowledge Transfer da via monitorada mais próxima (raio de 500m), com confiança calibrada por regressão isotônica sobre pares reais |
| Roteamento | A* (NetworkX) com peso de aresta = tempo inferido pela LIA, heurística Haversine |

### Sobre a migração para LSTM (não realizada)

O planejamento inicial do projeto previa migrar de XGBoost para uma rede LSTM neste ciclo. Um benchmark controlado mostrou que a vantagem do LSTM dependia inteiramente de acesso à última observação real da via — informação que passou a ser oferecida ao XGBoost como feature de recência. Sob essa condição os dois modelos empatam, e o XGBoost mantém vantagem prática (treina mais rápido, dispensa GPU em produção). **Decisão: manter XGBoost em produção.**

---

## 🚀 Como Executar

### Pré-requisitos
- Python **3.11**
- Node.js **18+** e npm
- Conta Supabase (URL + chave) — peça acesso ao projeto ou crie um novo e rode os scripts em `supabase/migrations/`
- Chaves TomTom (só necessárias para rodar o coletor — dá pra testar API e app sem elas, usando dados já existentes no Supabase)

---

### 1️⃣ Configurar credenciais

```bash
# Supabase + TomTom, usados pelo coletor, pelo treino e pela API
cd services/collector/config
cp .env.example .env                       # preencha SUPABASE_URL e SUPABASE_KEY
cp tomtom_keys.example.json tomtom_keys.json  # preencha com chave(s) da TomTom

# Frontend
cd ../../../apps/mobile
cp .env.example .env                       # preencha as 3 variáveis
```

No Supabase Dashboard → SQL Editor, rode nesta ordem:
```
supabase/migrations/20260427000000_route_history.sql
supabase/migrations/20260907000000_thesis_validation.sql
```

---

### 2️⃣ Coleta de dados (opcional para só testar o app)

```bash
cd services/collector
pip install -r requirements.txt
python main.py
```

Roda em loop: coleta de tráfego a cada 8 minutos, mais o experimento de
validação (Fase 3) 4x/dia. Ver `services/collector/deploy/README.md` para
colocar isso rodando 24/7 (guia para Oracle Cloud Free Tier).

---

### 3️⃣ Treinar a LIA

```bash
cd ml
pip install -r requirements.txt

python train.py
```

Gera em `artifacts/`: `lia_2.1.pkl`, `lia_2.1_encoder.pkl`, `lia_2.1_profiles.pkl`, `lia_2.1_metadata.json`.

Scripts complementares (opcionais, não bloqueiam a API):
```bash
python calibrate_transfer.py          # recalibra a confiança do Knowledge Transfer
python tune_hyperparams.py   # busca bayesiana de hiperparâmetros (Optuna)
python external_validation.py              # compara LIA vs. TomTom vs. menor distância
```

---

### 4️⃣ API FastAPI

```bash
cd apps/api
pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

**Pré-requisito:** modelo treinado em `../../ml/artifacts/` (passo anterior).

Primeira execução baixa o grafo OSM de Brasília (raio configurável via `GRAPH_RADIUS_KM`, default cobre até as cidades-satélite) — pode levar alguns minutos; fica cacheado em `.graphml` para as próximas.

**Testes rápidos:**
```bash
curl http://localhost:8000/health
curl http://localhost:8000/metrics

curl -X POST http://localhost:8000/route \
  -H "Content-Type: application/json" \
  -d '{"origem":{"lat":-15.79,"lon":-47.88},"destino":{"lat":-15.84,"lon":-47.92}}'
```

**Docs interativas:** http://localhost:8000/docs

---

### 5️⃣ App (Expo)

```bash
cd apps/mobile
npm install

npx expo start
```

- `w` → abre no navegador (web/Leaflet)
- `a` → Android (emulador ou app Expo Go)
- `i` → iOS (simulador ou app Expo Go)

Em dispositivo físico, troque `localhost` pelo IP da máquina em
`EXPO_PUBLIC_API_URL` (`apps/mobile/.env`).


### Problemas comuns

| Erro | Causa | Solução |
|---|---|---|
| `ModuleNotFoundError` | venv errada ou dependência faltando | `pip install -r requirements.txt` na pasta do módulo |
| `supabase.exceptions.AuthApiError` / host não resolve | URL/chave erradas ou projeto free pausado | conferir `services/collector/config/.env`; projeto pausado → Dashboard → Resume |
| `FileNotFoundError: lia_2.1.pkl` na API | modelo não treinado nesta máquina | `cd ml && python train.py` (ou copiar os artefatos para `ml/artifacts/`) |
| API trava em "Baixando grafo" | Overpass lento na 1ª execução | aguardar; fica em cache em `ml/artifacts/brasilia_graph.graphml` |
| `429` da TomTom | cota da chave esgotada | o pool rotaciona sozinho; ver `GET /health` › `tomtom` |
| `KeyError: 'c'` no MLflow (Windows) | caminho lido como esquema de URI | já corrigido com `Path(...).as_uri()` |

---

## 🗺 Endpoints da API

### `GET /health` · `GET /metrics`
Status da API e métricas reais do modelo carregado (usado pelo `DashboardScreen`).

### `POST /predict`
```json
{ "id_ponto": 42, "velocidade_livre": 60.0 }
```
→ `{ "razao_congestionamento": 0.78, "velocidade_prevista_kmh": 46.8, "modelo_versao": "lia_2.1", ... }`

### `POST /route`
```json
{ "origem": { "lat": -15.79, "lon": -47.88 }, "destino": { "lat": -15.84, "lon": -47.92 } }
```
→ `polyline`, `tempo_total_seg`, `distancia_km`, `via_principal`, mais os campos de instrumentação para a Fase 3 (`tempo_rota_curta_seg`, `rotas_diferentes`, `lia_cobertura_pct`).

### `GET /search/places?q=...`
Autocomplete de endereços — busca primeiro na malha viária local (Supabase), cai para Nominatim (OSM) só quando a busca local não é suficiente.

---

## 📊 Estado do projeto e próximos passos

O ciclo atual (TCC 2) concluiu: migração completa do modelo (LIA 1.0 → 2.1),
calibração estatística do Knowledge Transfer, otimização de hiperparâmetros,
correção de bugs reais (rota cruzando quarteirões, rotação de chaves da
TomTom), expansão de cobertura do grafo, e um primeiro experimento de
validação da hipótese central contra uma referência de tráfego externa
(Fase 3 — resultado preliminar, amostra ainda pequena).

**Em aberto para um próximo ciclo:**
- [ ] Offline-first no app (cache local de rota para tolerar perda de conectividade)
- [ ] Acumular mais rodadas da Fase 3 para validação estatisticamente robusta
- [ ] Hospedagem 24/7 do coletor (tentativa em Oracle Cloud Free Tier não concluída por falta de capacidade do provedor — ver `services/collector/deploy/README.md`)

---

## 👥 Equipe

| Nome | Papel |
|---|---|
| Pedro Borges Alves | Desenvolvimento (Backend, IA/LIA, infraestrutura de dados, Frontend) |
| Gustavo Martins Gripaldi | Desenvolvimento (Backend, IA/LIA, infraestrutura de dados, Frontend) |
| Prof. Marcelo Alves Farias | Orientador |

---

## 📄 Licença

Projeto acadêmico (TCC — IESB). Uso restrito a fins educacionais.

---

<div align="center">
  <img src="docs/Logo/Logo_Routify_icon.png" alt="Routify" width="80"/>

  <i>Brasília merece logística previsível.</i>
</div>
