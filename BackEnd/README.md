<div align="center">
  <img src="Servidor/Logo_Routify.png" alt="Routify Logo" width="350"/>

  # Routify - Back-End (Coleta + Treino + Roteamento)

  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/TomTom-E50000?style=for-the-badge&logo=tomtom&logoColor=white" alt="TomTom" />
  <img src="https://img.shields.io/badge/XGBoost-FF6F00?style=for-the-badge" alt="XGBoost" />
</div>

<br/>

## 🧠 Submódulos

| Pasta | README | Função |
|---|---|---|
| `Servidor/` | [Servidor/README.md](Servidor/README.md) | Coletor TomTom + extrator OSM (escreve no Supabase) |
| `Treinamento_IA/` | [Treinamento_IA/README.md](Treinamento_IA/README.md) | Pipeline Bronze→Silver→Features→XGBoost (gera `lia_*.pkl`) |
| `API/` | [API/README.md](API/README.md) | FastAPI servindo LIA + A\* (consumido pelo FrontEnd) |

## 🏗️ Arquitetura
```text
📦 BackEnd
 ┣ 📂 Servidor          # Coleta contínua (TomTom + OSM → Supabase)
 ┃ ┣ 📂 config          # .env.example + tomtom_keys.example.json
 ┃ ┣ 📂 deploy          # guia de deploy 24/7 (Oracle Cloud Free Tier)
 ┃ ┣ 📂 models          # db_manager.py
 ┃ ┣ 📂 services        # map_extractor.py + traffic_collector.py
 ┃ ┗ 📜 main.py         # coleta (8min) + validação Fase 3 (4x/dia)
 ┣ 📂 Treinamento_IA    # Pipeline ML
 ┃ ┣ 📜 silver.py       # Bronze→Silver (Parquet)
 ┃ ┣ 📜 features.py     # perfis históricos + recência + LabelEncoder
 ┃ ┣ 📜 train.py        # XGBoost + TimeSeriesSplit + MLflow
 ┃ ┣ 📜 otimizar_hiperparametros.py  # busca bayesiana (Optuna)
 ┃ ┣ 📜 calibrar_transfer.py         # confiança do Knowledge Transfer
 ┃ ┣ 📜 validar_fase3.py             # LIA vs. TomTom vs. menor distância
 ┃ ┗ 📂 models/         # lia_*.pkl, encoder, perfis, metadata, mlruns
 ┣ 📂 sql               # scripts para o Supabase SQL Editor
 ┗ 📂 API               # FastAPI
   ┣ 📜 main.py         # lifespan: carrega LIA + grafo OSM
   ┗ 📂 routers         # /predict + /route (A*) + /search (autocomplete)
```

## ⚡ Comandos Rápidos (TL;DR)

```bash
# 1. Coletor (popula histórico no Supabase, rodar contínuo)
cd BackEnd/Servidor && python main.py

# 2. Treinar LIA (após dados estarem no Supabase)
cd BackEnd/Treinamento_IA && pip install -r requirements.txt && python train.py

# 3. Subir API (após modelo treinado existir em Treinamento_IA/models/)
cd BackEnd/API && pip install -r requirements.txt && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

API disponível em http://localhost:8000 — Swagger UI: `/docs`.

## 🔄 Fluxo de Dados

```
TomTom + OSM ─► Servidor/main.py ─► Supabase (historico_trafego)
                                          │
                                          ▼
                              Treinamento_IA/train.py
                                          │
                                          ▼
                              models/lia_X.Y.pkl
                                          │
                                          ▼
                                   API/main.py
                                          │
                                          ▼
                                FrontEnd (mapa + rota)
```

## 🚨 Troubleshooting Geral

| Erro | Causa | Solução |
|---|---|---|
| `ModuleNotFoundError` em qualquer script | Venv errada ou dep faltando | `pip install -r requirements.txt` na pasta correspondente |
| `ModuleNotFoundError: 'src'` na API | Comando errado | Use `uvicorn main:app`, não `src.main:app` |
| `supabase.exceptions.AuthApiError` | Key/URL erradas | Conferir `Servidor/config/.env` — Supabase URL completa com `https://` |
| `429 Too Many Requests` (TomTom) | Cota da chave estourada | Adicionar chaves em `tomtom_keys.json` — pool rotaciona automático |
| Treino com `Shape X: (0, 14)` | Silver pegou poucos rows | `CHUNK_SIZE = 1000` em `silver.py`. Confirmar dados no Supabase |
| API trava em "Baixando grafo" | Overpass lento (não erro) | Aguardar 5-10min na 1ª vez. Cache em `brasilia_graph.graphml` |
| `KeyError: 'c'` no MLflow (Windows) | Path interpretado como URI scheme | Já corrigido com `Path(...).as_uri()` |
| `FileNotFoundError: lia_2.1.pkl` na API | Modelo não treinado | Rodar `Treinamento_IA/python train.py` antes |
| `Nominatim could not geocode... (Multi)Polygon` | `graph_from_place` falha | Já trocado para `graph_from_point` |
| CORS bloqueado no Expo Web | — | `CORSMiddleware` já libera `*` em dev |

## 🔌 Integração com FrontEnd

`FrontEnd/.env` precisa de:
```bash
EXPO_PUBLIC_API_URL=http://localhost:8000
```
Em mobile físico: trocar `localhost` pelo IP da máquina (`http://192.168.x.x:8000`).

<div align="center">
  <img src="Servidor/Logo_Routify.png" alt="Routify Logo" width="350"/>

 <i>Desenvolvido para o avanço em Cidades Inteligentes e Logística Preditiva.</i>
</div>
