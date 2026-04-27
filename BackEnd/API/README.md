<div align="center">

# Routify — API de Roteamento Preditivo

**FastAPI servindo a LIA + algoritmo A\* sobre OSMnx**

![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white)
![Uvicorn](https://img.shields.io/badge/Uvicorn-0.32-499848?style=flat-square)
![OSMnx](https://img.shields.io/badge/OSMnx-1.9-7B68EE?style=flat-square)
![NetworkX](https://img.shields.io/badge/NetworkX-3.4-FF6F00?style=flat-square)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white)

</div>

---

## 🎯 Função

Servir a **LIA** (modelo treinado em `../Treinamento_IA`) através de uma API REST, alimentando o algoritmo **A\*** com pesos de aresta dinâmicos para retornar rotas otimizadas.

A API é stateless do ponto de vista do cliente — modelo e grafo OSM são carregados **uma vez** no startup via `lifespan` e mantidos em `app.state`.

---

## 📂 Estrutura

```
BackEnd/API/
├── main.py             ← FastAPI app + lifespan (carrega modelo + grafo)
├── routers/
│   ├── __init__.py
│   ├── predict.py      ← POST /predict (inferência por segmento)
│   └── route.py        ← POST /route (A* com pesos LIA)
├── Dockerfile          ← imagem para Railway/Render
└── requirements.txt
```

---

## ⚙️ Setup local

```bash
cd BackEnd/API
pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

**Pré-requisito:** modelo treinado existir em `../Treinamento_IA/models/`:
- `lia_1.0.pkl`
- `lia_1.0_encoder.pkl`
- `lia_1.0_metadata.json`

Se não existirem, rode primeiro `cd ../Treinamento_IA && python train.py`.

---

## 🌍 Grafo OSM

**Primeira execução** baixa o grafo de Brasília via OSMnx (Overpass API). Pode levar **2-10 minutos** dependendo da rede e do load do Overpass.

Centro: **(-15.793, -47.882)** (Plano Piloto). Raio configurável via env:

```bash
# Default 15km — cobre Plano Piloto + Lago + Sudoeste + Cruzeiro
uvicorn main:app

# 30km — cobre também Taguatinga e Águas Claras (mais lento)
GRAPH_RADIUS_KM=30 uvicorn main:app
```

Após download, é cacheado em `../Treinamento_IA/models/brasilia_graph.graphml`. Próximas execuções carregam em ~5s.

---

## 🔌 Endpoints

### `GET /health`

Status básico — usado por health checks de Railway/Render.

```json
{
  "status": "ok",
  "modelo_ativo": "lia_1.0",
  "cv_rmse_seg": 72.6,
  "dados_treino": "Março-Abril 2026",
  "total_amostras_treino": 645000
}
```

---

### `GET /metrics`

Métricas reais para o `DashboardScreen` do app.

```json
{
  "modelo_ativo": "lia_1.0",
  "cv_rmse_seg": 72.6,
  "cv_mae_seg": 51.2,
  "n_pontos_monitorados": 602,
  "periodo_dados": "2026-03-01 → 2026-04-27",
  "total_amostras_treino": 645000,
  "feature_importance": {
    "id_ponto_enc": 0.31,
    "lag_vel_24h": 0.18,
    "...": "..."
  }
}
```

---

### `POST /predict`

Inferência LIA para **um único segmento** (debug / dashboards).

**Request:**
```json
{
  "id_ponto": 42,
  "hora": 18,
  "dia_semana": 2,
  "velocidade_livre": 60.0,
  "lag_vel_1h": 45.0,
  "lag_vel_24h": 50.0
}
```

Campos `lag_*` e `rolling_*` são **opcionais** — fallbacks usam `velocidade_livre` quando ausentes.

**Response:**
```json
{
  "tempo_viagem_segundos": 423.7,
  "modelo_versao": "lia_1.0"
}
```

---

### `POST /route`

**Endpoint principal.** Roteamento A\* com pesos da LIA aplicados a cada aresta do grafo.

**Request:**
```json
{
  "origem":  { "lat": -15.79, "lon": -47.88 },
  "destino": { "lat": -15.84, "lon": -47.92 }
}
```

**Response:**
```json
{
  "polyline": [[-15.79, -47.88], [-15.80, -47.89], "..."],
  "tempo_total_seg": 1247,
  "distancia_km": 8.3,
  "via_principal": "Eixo Monumental",
  "modelo_utilizado": "lia_1.0",
  "nos_visitados": 312
}
```

**Pipeline interno:**
1. `ox.nearest_nodes(G, lons, lats)` → mapeia (lat,lon) ao nó OSM mais próximo
2. Para cada aresta `(u,v)`, calcula `travel_time_lia` via predição LIA
3. `nx.astar_path` com heurística Haversine
4. Reconstrói polyline a partir das coordenadas dos nós

---

## 🐳 Docker

```bash
# Build (a partir da raiz do repo, para incluir os modelos)
cd BackEnd
docker build -f API/Dockerfile -t routify-api .

# Run
docker run -p 8000:8000 \
  -e LIA_VERSION=lia_1.0 \
  -e GRAPH_RADIUS_KM=15 \
  routify-api
```

**Importante:** o `Dockerfile` copia `../Treinamento_IA/models/lia_*.pkl` para dentro da imagem. Modelo viaja embutido — sem dependência externa.

---

## 🚀 Deploy

### Railway (recomendado)
1. `railway init` na pasta `BackEnd/API`
2. Adicionar `routify-api` como service
3. Variáveis: `LIA_VERSION`, `GRAPH_RADIUS_KM`
4. `railway up`

### Render
1. New Web Service → Docker
2. Root directory: `BackEnd/API`
3. Health check: `/health`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

> **Atenção:** o grafo OSM (~50-150MB) precisa estar acessível no container. Opções:
> - **A** (atual): grafo é baixado no primeiro startup e cacheado em volume persistente
> - **B**: copiar `brasilia_graph.graphml` no Dockerfile (build mais lento, startup instantâneo)

---

## 🔍 Logs e Debug

Startup verboso já habilitado:
```
=== Startup: carregando artefatos LIA ===
Modelo lia_1.0 carregado — RMSE CV: 72.6s
Artefatos carregados em 0.4s

=== Startup: preparando grafo OSM ===
Baixando grafo OSM (centro (-15.793, -47.882), raio 15km)...
[OSMnx] request to overpass-api.de/api/interpreter
Download concluído em 87.3s. Salvando cache...
Grafo carregado: 4823 nós, 12041 arestas

=== Routify API pronta ===
```

**Swagger UI:** http://localhost:8000/docs
**ReDoc:** http://localhost:8000/redoc

---

## 🚨 Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `ModuleNotFoundError: No module named 'src'` | Comando errado | Use `uvicorn main:app`, não `src.main:app` |
| `Nominatim could not geocode... to (Multi)Polygon` | `graph_from_place` falha | Já trocado para `graph_from_point` |
| `FileNotFoundError: lia_1.0.pkl` | Modelo não treinado | Rode `../Treinamento_IA/python train.py` antes |
| Startup trava em "Baixando grafo" | Overpass lento, não erro | Aguarde 5-10min na 1ª vez. Cache evita repetir |
| CORS bloqueado no Expo Web | — | `CORSMiddleware` já libera `*` em dev |
