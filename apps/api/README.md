<div align="center">

# Routify — API de Roteamento Preditivo

**FastAPI servindo a LIA + algoritmo A\* sobre OSMnx**

![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?style=flat-square&logo=fastapi&logoColor=white)
![XGBoost](https://img.shields.io/badge/XGBoost-3.2-FF6F00?style=flat-square)
![OSMnx](https://img.shields.io/badge/OSMnx-1.9-7B68EE?style=flat-square)
![NetworkX](https://img.shields.io/badge/NetworkX-3.6-FF6F00?style=flat-square)

</div>

---

## 🎯 Função

Servir a **LIA** (modelo treinado em `../../ml`) através de uma API REST, alimentando o algoritmo **A\*** com pesos de aresta dinâmicos para retornar rotas otimizadas, e oferecer autocomplete de endereços para o app.

A API é stateless do ponto de vista do cliente — modelo, encoder, perfis e grafo OSM são carregados **uma vez** no startup via `lifespan` e mantidos em `app.state`.

---

## 📂 Estrutura

```
apps/api/
├── main.py             ← FastAPI app + lifespan (carrega modelo + grafo)
├── lia_inference.py     ← montagem de features, cascata de perfis, clamp da razão
├── graph_enrichment.py  ← liga o grafo OSM às vias monitoradas (BallTree)
├── recency_cache.py    ← cache TTL da última observação real por via
├── tomtom.py            ← TomTom sob demanda: pool de chaves, clientes, geometria
├── usage.py             ← captura de uso: JWT opcional → user_id, gravação fire-and-forget
├── tests/               ← pytest (rodar `pytest -q` nesta pasta)
├── routers/
│   ├── predict.py      ← POST /predict (inferência por segmento)
│   ├── route.py        ← POST /route (A* com pesos LIA)
│   ├── search.py       ← GET /search/places (autocomplete de endereços)
│   └── eventos.py      ← POST /eventos (eventos do app, JWT obrigatório)
└── requirements.txt
```

As versões em `requirements.txt` são as **mesmas que treinaram o modelo** (ver comentário no topo do arquivo) — os artefatos em `models/` são pickles sensíveis à versão de xgboost/scikit-learn/pandas que os serializou. Não atualizar sem retreinar.

---

## ⚙️ Setup local

```bash
cd apps/api
pip install -r requirements.txt

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Pré-requisito:** modelo treinado existir em `../ml/artifacts/`:
`lia_2.1.pkl`, `lia_2.1_encoder.pkl`, `lia_2.1_profiles.pkl`, `lia_2.1_metadata.json`.

Se não existirem, rode primeiro `cd ../../ml && python train.py`.

Também depende de `../services/collector/config/.env` (`SUPABASE_URL`/`SUPABASE_KEY`) — usado pelo enriquecimento do grafo, pelo cache de recência e pelo autocomplete.

**TomTom sob demanda** (opcional — sem chave, a API segue só com a LIA):

| Variável | Padrão | Uso |
|---|---|---|
| `TOMTOM_API_KEYS` | — | chaves separadas por vírgula (deploy/secrets). Tem precedência sobre o arquivo |
| `TOMTOM_KEYS_FILE` | `../services/collector/config/tomtom_keys.json` | mesmo formato do coletor (`{"tomtom_keys": [{"id", "key"}]}`) |
| `TOMTOM_MAX_CHAMADAS_MIN` | `120` | teto global de chamadas por minuto (proteção de cota) |
| `TOMTOM_ATIVO` | `1` | `0` desliga a integração |

| Variável | Padrão | Uso |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:8081,http://localhost:19006,http://localhost:3000` | origens liberadas (app web + painel ADM), separadas por vírgula. Sem credenciais: o JWT vai no header `Authorization` |

Testes: `pytest -q` (o HTTP da TomTom é simulado; nenhuma chamada real).

### Captura de uso (LGPD)

A API grava o uso com a service_role (o cliente nunca escreve nessas tabelas). A gravação é fire-and-forget: falha no banco não derruba a requisição.

| Tabela | O quê | Quando |
|---|---|---|
| `api_requisicoes` | rota, método, status, latência, `user_id`, modo degradado | toda requisição (menos `/health`, `/docs`, `OPTIONS`) |
| `rotas_calculadas` | origem/destino **arredondados em 3 casas (~110 m)**, tempos LIA × menor distância, cobertura, flags TomTom | cada `/route` |
| `eventos_app` | `busca`, `rota_solicitada`, `navegacao_*`, `feedback` (sem coordenadas, sem texto de busca) | `POST /eventos` |

O `user_id` vem do JWT Supabase (`Authorization: Bearer`), validado em `sb.auth.get_user` com cache de 5 min. Token inválido ou ausente = anônimo em `/route` e `/search`; em `/eventos` = 401. Retenção: 90 dias (`pg_cron` diário).

---

## 🌍 Grafo OSM

**Primeira execução** baixa o grafo de Brasília via OSMnx (Overpass API). Pode levar alguns minutos dependendo do load do servidor Overpass compartilhado.

Centro: Plano Piloto. Raio configurável via env `GRAPH_RADIUS_KM` (o grafo atual em uso cobre ~38km, incluindo cidades-satélite e corredores historicamente congestionados como EPTG/EPNB — um raio menor reduz tempo de download e uso de RAM, mas perde essa cobertura).

Após o download, o grafo fica cacheado em `.graphml` em `ml/artifacts/` — próximas execuções carregam em segundos. **Atenção:** o grafo de 38km ocupa ~1,4GB de RAM quando carregado; em máquinas/VMs com pouca memória, considere um raio menor.

---

## 🔌 Endpoints

### `GET /health`
Status básico da API e do modelo carregado, mais:
- `tomtom` — chaves configuradas e disponíveis por serviço (só contagens);
- `vias_monitoradas` — 0 significa Supabase indisponível na subida, rota em heurística;
- `supabase_configurado`;
- `recencia` — vias em cache e idade da última busca.

O painel ADM usa esse endpoint para o status ao vivo.

### `POST /eventos`
Eventos do app para a análise de uso. Exige JWT e aceita no máximo 60 por minuto por usuário (429 acima disso). O corpo é estrito (`extra="forbid"`):
- `tipo` ∈ `busca | rota_solicitada | navegacao_iniciada | navegacao_concluida | feedback`;
- `plataforma` ∈ `web | ios | android`;
- `dados` = dicionário plano, com até 12 chaves escalares. Chaves de coordenada são recusadas.

Responde `202`.

### `GET /metrics`
Métricas reais do modelo (usadas pelo `DashboardScreen` do app): RMSE de validação cruzada, número de vias monitoradas, importância de features.

---

### `POST /predict`

Inferência LIA para **um único segmento** (debug / dashboards). O modelo prevê a **razão de congestionamento** (`velocidade_atual / velocidade_livre`), não segundos diretamente — o tempo de viagem só é calculado se `comprimento_m` for informado.

**Request:**
```json
{
  "id_ponto": 42,
  "velocidade_livre": 60.0,
  "comprimento_m": 350.0
}
```

Campos opcionais avançados (`razao_ultima_observacao` + `minutos_desde_ultima_observacao`) permitem sobrescrever a busca automática de recência — uso principalmente de teste/debug.

**Response:**
```json
{
  "id_ponto": 42,
  "razao_congestionamento": 0.78,
  "velocidade_prevista_kmh": 46.8,
  "tempo_viagem_segundos": 26.9,
  "modelo_versao": "lia_2.1",
  "hora": 18,
  "dia_semana": 2
}
```

---

### `POST /route`

**Endpoint principal.** Roteamento A\* com pesos da LIA aplicados a cada aresta do grafo, numa única predição vetorizada (não aresta-por-aresta).

**Request:**
```json
{
  "origem":  { "lat": -15.79, "lon": -47.88 },
  "destino": { "lat": -15.84, "lon": -47.92 },
  "referencia_tomtom": false
}
```

Campos extras são rejeitados (422). `referencia_tomtom: true` pede também o ETA da TomTom com trânsito ao vivo (gasta 1 chamada de Routing).

**Response:**
```json
{
  "polyline": [[-15.79, -47.88], [-15.795, -47.885], "..."],
  "tempo_total_seg": 1247,
  "distancia_km": 8.3,
  "via_principal": "Eixo Monumental",
  "modelo_utilizado": "lia_2.1",
  "nos_visitados": 312,

  "tempo_rota_curta_seg": 1180,
  "distancia_rota_curta_km": 7.9,
  "rotas_diferentes": true,
  "lia_cobertura_pct": 74.5,
  "hora_partida": 18,
  "dia_semana": 2,

  "tomtom": {
    "ativo": true, "degradado": false,
    "vias_atualizadas": 6, "arestas_interditadas": 4, "interdicoes_na_rota": 0,
    "incidentes": [
      { "tipo": "Congestionamento", "descricao": "Trânsito parado", "atraso_seg": 213,
        "interdicao": false, "lat": -15.80, "lon": -47.89 }
    ],
    "referencia_tempo_seg": 1043, "referencia_atraso_seg": 163,
    "referencia_sem_transito_seg": 790, "referencia_distancia_km": 13.39
  }
}
```

`tempo_rota_curta_seg` … `dia_semana` são instrumentação da Fase 3 (validação da tese): a rota de
menor distância é calculada na mesma requisição, sob as mesmas condições,
para permitir comparação direta. O bloco `tomtom` diz o que a TomTom acrescentou;
`degradado: true` = rota só com a LIA (sem chave, cota esgotada ou TomTom fora do ar).

**Pipeline interno:**
1. `find_nearest_drivable_node` mapeia (lat,lon) ao nó navegável mais próximo
2. **TomTom sob demanda** (`_consultar_tomtom`, em paralelo): Flow Segment Data nas até 8 vias monitoradas do corredor com recência > 10 min (a leitura entra no cache de recência) + Incident Details do corredor (cache 5 min) + ETA de referência, se pedido
3. `assign_lia_weights` prevê a razão de congestionamento para **todas** as arestas do grafo numa única chamada ao modelo (perfis por via + recência + transferência de conhecimento calibrada para vias não monitoradas)
4. `nx.astar_path` com heurística Haversine; arestas sob interdição da TomTom saem do caminho por uma função de peso (o grafo compartilhado não é alterado)
5. `montar_polyline` traça a rota seguindo a geometria real das vias (não linha reta entre nós)

Política de chaves, cotas e modo degradado: [docs/core/architecture.md](../../docs/core/architecture.md).

---

### `GET /search/places?q=...&limit=8`

Autocomplete de endereços, em cadeia (cada etapa só roda se a anterior trouxe < 3 resultados):

1. `malha_completa` (~38 mil vias do DF) no Supabase — `source: "malha"`
2. TomTom Search v2 (typeahead, viés para Brasília, cache 24 h) — `source: "tomtom"`
3. Nominatim (OSM) — `source: "nominatim"`, último recurso, com cache e trava de 1 req/s (a política da OSMF proíbe autocomplete)

**Response:**
```json
[
  { "label": "EPTG", "sublabel": "Via arterial", "lat": -15.83, "lon": -48.05, "source": "malha", "id_ponto": 123 }
]
```

---

## 🐳 Docker

```bash
# Build (a partir da raiz do repo: a imagem leva apps/api + ml/artifacts)
docker build -f apps/api/Dockerfile -t routify-api .

# Run (credenciais por variável de ambiente — nunca dentro da imagem)
docker run -p 8000:8000 --env-file services/collector/config/.env \
  -e GRAPH_RADIUS_KM=38 \
  routify-api
```

O `Dockerfile` copia `../ml/artifacts/lia_*.pkl` para dentro da imagem — o modelo viaja embutido, sem dependência externa em runtime (além do Supabase, para enriquecimento do grafo e recência).

---

## 🔍 Logs e Debug

**Swagger UI:** <http://localhost:8000/docs> · **ReDoc:** <http://localhost:8000/redoc>

Textos, grupos e parâmetros do Swagger ficam em `openapi.py`; exemplos e descrições dos campos ficam nos modelos Pydantic de cada router. Para testar rotas com login, cole o `access_token` da sessão Supabase em **Authorize**.

---

## 🚨 Troubleshooting

| Erro | Causa | Solução |
|---|---|---|
| `ModuleNotFoundError: No module named 'src'` | Comando errado | Use `uvicorn main:app`, não `src.main:app` |
| `Nominatim could not geocode... to (Multi)Polygon` | `graph_from_place` falha | Já trocado para `graph_from_point` |
| `FileNotFoundError: lia_2.1.pkl` | Modelo não treinado | Rode `cd ../../ml && python train.py` antes |
| Startup demora minutos em "Baixando grafo" | Overpass compartilhado sob carga (cortesia de rate-limit do OSMnx, não erro) | Aguarde — cache evita repetir nas próximas execuções |
| `422` em `/predict` — "id_ponto não foi visto no treino" | Ponto não existe no encoder | Conferir `vias_monitoradas` no Supabase, ou retreinar |
| CORS bloqueado no Expo Web / painel | origem fora da allowlist | incluir a origem em `CORS_ORIGINS` |
| Log `Uso: falha ao gravar em …` | migration `20260923010000_usage_tracking_admin.sql` não aplicada | aplicar (ver [rodar-local](../../docs/core/rodar-local.md)); a rota funciona mesmo assim |
| RAM alta ao subir com grafo de 38km | Esperado — pico de ~1,4GB durante o carregamento do grafo | Reduzir `GRAPH_RADIUS_KM` em ambientes com pouca memória |
