<div align="center">

# Routify — API de Roteamento Preditivo

**FastAPI servindo a LIA + algoritmo A\* sobre OSMnx**

![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?style=flat-square&logo=fastapi&logoColor=white)
![XGBoost](https://img.shields.io/badge/XGBoost-3.2-FF6F00?style=flat-square)
![OSMnx](https://img.shields.io/badge/OSMnx-1.9-7B68EE?style=flat-square)
![NetworkX](https://img.shields.io/badge/NetworkX-3.6-FF6F00?style=flat-square)

</div>

---

**Última revisão:** 2026-11-02

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
├── trajeto.py           ← snap (BallTree de nós), semáforos, fusão LIA × TomTom
├── usage.py             ← captura de uso: JWT opcional → user_id, gravação fire-and-forget
├── seguranca.py         ← limitador (429 + Retry-After), IP do cliente, exigir_admin, auditoria
├── config_runtime.py    ← flags do painel ADM (kill switch TomTom, orçamento, chaves pausadas…)
├── openapi.py           ← textos do Swagger
├── tests/               ← pytest (rodar `pytest -q` nesta pasta)
├── routers/
│   ├── predict.py      ← POST /predict (inferência por segmento)
│   ├── route.py        ← POST /route (A* LIA + fusão TomTom)
│   ├── search.py       ← GET /search/places (autocomplete de endereços)
│   ├── eventos.py      ← POST /eventos (eventos do app, JWT obrigatório)
│   └── admin.py        ← /admin/tomtom (estado do pool, testar chave) — só admin
└── requirements.txt
```

As versões em `requirements.txt` são as **mesmas que treinaram o modelo** (ver comentário no topo do arquivo): os `.pkl` em `ml/artifacts/` são sensíveis à versão de xgboost, scikit-learn e pandas que os serializou. Não atualizar sem retreinar.

**Rode sempre no venv:** o Python global da máquina pode ter outras versões, e aí o modelo carrega diferente ou nem carrega. Isso já aconteceu: pandas 2.2 no global contra 3.0 no projeto.

---

## ⚙️ Setup local

```bash
cd apps/api
python -m venv .venv                                     # primeira vez
.venv/Scripts/python -m pip install --use-feature=truststore -r requirements.txt pytest
.venv/Scripts/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Pré-requisito:** modelo treinado existir em `../ml/artifacts/`:
`lia_2.3.pkl`, `_encoder.pkl`, `_profiles.pkl`, `_metadata.json` e `_vizinhos.json`, mais `feriados.json`
e `velocidade_livre_tomtom.json`.

**Modelo (`LIA_VERSION`, padrão `lia_2.3`):** a 2.3 é a 2.2 (2.1 + vizinhos, chuva, feriado) treinada com perfis
fora da amostra, recência envelhecida e early stopping no próprio treino (ver [ml/README](../../ml/README.md) e
`ml/artifacts/ablation_lia_2.3.json`). A tese cita a 2.1; rollback com `LIA_VERSION=lia_2.2`.

**Velocidade livre (`VEL_LIVRE_CALIBRADA`, padrão `1`):** a LIA foi treinada com a velocidade livre da TomTom, e o
limite do OSM é mais alto. Na subida, `graph_enrichment.calibrar_velocidade_livre` mede a razão TomTom/OSM na via
de cada sensor (mediana ≈ 0,88) e aplica um fator único a todas as arestas; nos trechos monitorados vale a da
TomTom. Um fator só não muda qual rota é a mais rápida. Contra a TomTom no mesmo trajeto, o viés caiu de −11,9%
para −0,2% (`ml/artifacts/experimento_velocidade_livre.json`). `VEL_LIVRE_CALIBRADA=0` volta ao limite do OSM
(números da Fase 3). `/health.velocidade_livre` diz qual está valendo.

**Velocidade livre por grupo de via (desde 2026-11-02):** `semaforos_calibracao.json` traz `fatores_velocidade_grupo`
(expressa 0,909, arterial 0,897, coletora 0,508, local 0,425), ajustados no nível da rota contra a TomTom sem trânsito
por `ml/calibrate_signals.py`. Ruas locais e coletoras levavam ≈ 2× o tempo do limite de via. Validação fora da amostra em
`ml/artifacts/ab_calibracao_grafo_2026-11-02.json`. `/health.velocidade_livre_fatores` mostra os fatores em uso.

**Prior de congestionamento (`PRIOR_CONGESTIONAMENTO`, padrão `corredor`):** aresta sem sensor em 500 m usava a mediana
histórica da razão no horário, que é 1,0 (fluxo livre) em 3 de cada 4 combinações hora × dia; a transferência encolhia
para 1,0. Agora as duas partem da lentidão que o modelo prevê no momento nos trechos monitorados (média harmônica
ponderada pelo tempo livre). `PRIOR_CONGESTIONAMENTO=perfil` volta ao comportamento da tese.

**Vias proibidas para carro:** o filtro `drive` do OSMnx 1.9 só tira `access=private`. Na carga do grafo saem também
`access=no` (condomínio fechado, alça fechada; 41 arestas) e os `busway`. Mudou o filtro, `VERSAO_FILTRO` muda e o
pickle enxuto é refeito uma vez a partir do GraphML (pico de ~1,3 GB: na EC2, gere localmente e copie o `.pkl`). A ordem das features vem do próprio modelo (`feature_names_in_`)
e a subida faz uma predição de teste: contrato treino × API quebrado derruba o startup,
não a primeira rota. Chuva ao vivo: previsão horária do [Open-Meteo](https://open-meteo.com)
(CC BY 4.0), cache de 15 min, ≤ 96 chamadas/dia; fora do ar → chuva 0.

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

Testes: `.venv/Scripts/python -m pytest -q` (o HTTP da TomTom é simulado; nenhuma chamada real).

| Variável | Padrão | Uso |
|---|---|---|
| `TRUST_PROXY` | `0` | `1` só atrás de um proxy nosso (Caddy/ALB). Aí o IP do limite vem do `X-Forwarded-For`; sem proxy, o cliente forjaria o IP |
| `GRAPH_RADIUS_KM` | `38` | raio do grafo. Entra no nome do cache (`brasilia_graph_38km.graphml`) |
| `REGISTRAR_USO` | `1` | `0` não grava `api_requisicoes`/`rotas_calculadas`: experimento local contra o banco de produção |

**Limites por janela deslizante (429 + `Retry-After`):**

| Rota | Limite |
|---|---|
| `/route` | 20/min por IP |
| `/search/places` | 90/min por IP |
| `/eventos` | 60/min por usuário |
| `/admin/tomtom` | 60/min por admin |
| teste de chave | 6/min por admin |

ponytail: os limites ficam em memória, 1 réplica.

### Captura de uso (LGPD)

A API grava o uso com a service_role (o cliente nunca escreve nessas tabelas). A gravação é fire-and-forget: falha no banco não derruba a requisição.

| Tabela | O quê | Quando |
|---|---|---|
| `api_requisicoes` | rota, método, status, latência, `user_id`, modo degradado | toda requisição (menos `/health`, `/docs`, `OPTIONS`) |
| `rotas_calculadas` | origem/destino **arredondados em 3 casas (~110 m)**, tempos LIA × menor distância, cobertura, flags TomTom | cada `/route` |
| `eventos_app` | `busca`, `rota_solicitada`, `navegacao_*`, `feedback` (sem coordenadas, sem texto de busca) | `POST /eventos` |

O `user_id` vem do JWT Supabase (`Authorization: Bearer`), validado em `sb.auth.get_user` com cache de 5 min. Token inválido ou ausente = anônimo em `/route` e `/search`; em `/eventos` = 401. Retenção: 90 dias (`pg_cron` diário).

**Chamada interna não é uso:** o comparador LIA × provedores (na própria EC2) chama `127.0.0.1:8000` com o
cabeçalho `X-Routify-Interno: 1`. Loopback + cabeçalho + sem `X-Forwarded-For` (o Caddy sempre põe um) = fora de
`api_requisicoes`, `rotas_calculadas` e `eventos_app`. A trilha de auditoria nunca é pulada (`tests/test_uso_interno.py`).

**Entrada hostil:** o 422 devolve só `loc`/`msg`/`type` (o padrão ecoava o valor, e um `NaN` virava 500); floats
recusam `NaN`/`Infinity` e têm teto.

---

## 🌍 Grafo OSM

**Primeira execução** baixa o grafo de Brasília via OSMnx (Overpass API). Pode levar alguns minutos dependendo do load do servidor Overpass compartilhado.

Centro: Plano Piloto. Raio configurável via env `GRAPH_RADIUS_KM` (o grafo atual em uso cobre ~38km, incluindo cidades-satélite e corredores historicamente congestionados como EPTG/EPNB — um raio menor reduz tempo de download e uso de RAM, mas perde essa cobertura).

Após o download, o grafo fica cacheado em `.graphml` em `ml/artifacts/`. Na primeira
leitura a API gera `brasilia_graph_38km.pkl`, uma cópia **enxuta** (só `x`/`y` nos nós e
`length`, `highway`, `name`, `geometry`, `maxspeed` nas arestas; o resto é metadado OSM
que ninguém lê). Medido em 2026-09-23:

| | GraphML | Pickle enxuto |
|---|---|---|
| leitura | 10,6 s | 1,3 s |
| RAM da API inteira | 1,65 GB | **0,79 GB** |

O pickle é refeito sozinho se o GraphML for mais novo ou se `ATRIBUTOS_ARESTA` (main.py) mudar.

---

## 🔌 Endpoints

### `GET /health`
Status básico da API e do modelo carregado, mais:
- `tomtom` — chaves configuradas e disponíveis por serviço (só contagens);
- `vias_monitoradas` — 0 significa Supabase indisponível na subida, rota em heurística;
- `supabase_configurado`;
- `recencia` — vias em cache e idade da última busca;
- `contexto` — horas de chuva em cache e quando atualizou (só na LIA 2.2).

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

`timestamp_brasilia` com offset (`Z`, `+00:00`) é convertido para Brasília; aceita 2000–2099. A leitura ao vivo
envelhece até o instante pedido e some acima de 24 h (vira o perfil); instante no passado não usa leitura ao vivo.
`razao_ultima_observacao` e `minutos_desde_ultima_observacao` vêm juntos ou não vêm.

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

Além da rota, a resposta traz `clima` (tempo em Brasília na partida — mesma chamada do Open-Meteo
que a LIA 2.2 já faz a cada 15 min — com o que ela considerou: chuva das 3 últimas horas e feriado) e
`economia` (combustível da rota e economia contra o caminho mais curto: litros = K1·km + K2·horas,
Evans–Herman–Lam; parâmetros e fontes em `ml/artifacts/consumo_combustivel.json`, que o `/metrics`
também expõe em `combustivel`). Quando a rota do trânsito ao vivo vence, `via_principal` é o nome real
da via (a polyline vai ao grafo) — nenhum rótulo de provedor chega ao app.

**Endpoint principal.** Faz o A\* com os pesos da LIA em cada aresta do grafo, numa única predição vetorizada. A rota da LIA é **fundida com a TomTom**: a TomTom reconstrói o mesmo trajeto, dá o ETA dele ao vivo e sugere outra rota se achar uma melhor.

**Request:**
```json
{
  "origem":  { "lat": -15.79, "lon": -47.88 },
  "destino": { "lat": -15.84, "lon": -47.92 },
  "referencia_tomtom": false
}
```

Campos extras são rejeitados (422). O ETA da TomTom vem sempre pela fusão, então `referencia_tomtom` só tem efeito se o painel ADM desligar a fusão.

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
    "referencia_sem_transito_seg": 790, "referencia_historico_seg": 980, "referencia_distancia_km": 13.39
  },

  "fonte_rota": "lia",
  "tempo_lia_seg": 1180,
  "semaforos_na_rota": 9,
  "fora_da_malha": false,
  "alternativa": { "fonte": "tomtom", "polyline": [["..."]], "tempo_seg": 1302, "distancia_km": 9.1 },
  "trafego": [0, 0, 1, 1, 2, null, 0]
}
```

**Fusão LIA × TomTom** (`trajeto.py`, 1 chamada de Routing por rota):
- **Tempo exibido** (`tempo_total_seg`) = cobertura × LIA + (1 − cobertura) × TomTom no mesmo trajeto. A LIA vale onde tem histórico; a TomTom cobre as lacunas.
- **Troca de rota:** a alternativa da TomTom só assume (`fonte_rota: "tomtom"`) se a própria TomTom a considerar ≥ 10% **e** ≥ 60 s mais rápida. A candidata não escolhida volta em `alternativa`, e o app a desenha tracejada.
- **Fora da malha** (ponto a mais de 600 m do grafo, uma caixa de ±38 km em volta do centro): a rota é só da TomTom (`fora_da_malha: true`).
- **Trânsito por trecho (`trafego`):** um nível por trecho da `polyline` (ponto i → i+1): 0 livre, 1 moderado, 2 lento, 3 parado, `null` sem dado. Na rota da LIA vem da razão prevista na aresta (só sensor e transferência); os buracos pegam as seções de trânsito da TomTom no mesmo lugar (`sectionType=traffic` na chamada da fusão, sem custo extra). Na rota da TomTom, as seções dela. O mapa pinta só os níveis 1–3 por cima do gradiente da rota.
- **Semáforos:** `tempo_lia_seg` e `tempo_rota_curta_seg` somam o atraso médio por semáforo cruzado. Os semáforos são as tags do OSM encaixadas no cruzamento; o atraso vem calibrado em `ml/artifacts/semaforos_calibracao.json` (ver `ml/calibrate_signals.py`). A soma é igual nas duas rotas, então a comparação da tese não fica enviesada.

`tempo_rota_curta_seg` … `dia_semana` são instrumentação da Fase 3 (validação da tese): a rota de
menor distância é calculada na mesma requisição, sob as mesmas condições,
para permitir comparação direta. O bloco `tomtom` diz o que a TomTom acrescentou;
`degradado: true` = rota só com a LIA (sem chave, cota esgotada ou TomTom fora do ar).

**Pipeline interno:**
1. **Snap** no nó mais próximo (`trajeto.ArvoreNos`: BallTree montada 1× na subida, não a cada chamada).
2. **TomTom sob demanda, em paralelo** (`_consultar_tomtom`):
   - Flow Segment Data em até 8 vias monitoradas do corredor com recência > 10 min; a leitura entra no cache de recência;
   - Incident Details do corredor (cache de 5 min);
   - fora da malha, também a rota da TomTom.
3. `assign_lia_weights` prevê a razão de congestionamento de **todas** as arestas numa chamada só (perfis por via + recência + transferência calibrada).
4. `nx.astar_path` com heurística Haversine. O peso soma o atraso de semáforo, e arestas interditadas pela TomTom saem do caminho por uma função de peso, sem mutar o grafo compartilhado.
5. `montar_polyline` segue a geometria real das vias. Baseline de menor distância e resumos são calculados **antes** de qualquer `await`, porque os pesos estão no grafo compartilhado.
6. **Fusão:** `tomtom.rota_reconstruida` com `supportingPoints` + `trajeto.escolher`.

Política de chaves, cotas e modo degradado: [docs/core/architecture.md](../../docs/core/architecture.md).

---

### `GET /admin/tomtom` · `POST /admin/tomtom/chaves/{id}/testar`

Só para admin: JWT validado a cada chamada, com `app_metadata.role = admin`.
- **Estado do pool** por chave: pausada, chamadas, falhas e cooldown por serviço. Mostra só o id, nunca o valor.
- **Teste de uma chave:** 1 chamada de Flow. É auditado.

As outras ações do painel (papel, bloqueio, avisos, flags) são RPCs `admin_*` no Supabase (`supabase/migrations/20260923020000_admin_actions.sql`). A API lê as flags de `config_runtime` a cada 30 s.

---

### `GET /search/places?q=...&limit=8[&lat=..&lon=..]`

Autocomplete: a base local (malha de ~38 mil vias do DF, com cache de 1 h, as 602 localidades de
`ml/artifacts/bairros_df.json`: regiões, bairros, superquadras, e ~1.700 pontos de interesse do OSM em
`ml/artifacts/pois_df.json`: estações de metrô, terminais, shoppings, hospitais, universidades, parques,
atrações, com os nomes alternativos) e a TomTom Search (typeahead,
20 resultados, cache 24 h) rodam em paralelo e são **juntadas e ranqueadas numa lista só**
(`ranquear()` em `routers/search.py`). O Nominatim só entra se o ranking final tiver menos de
3 resultados e a consulta, 4+ letras (a política da OSMF proíbe autocomplete).

Bateria de pontos famosos (`scripts/bateria_busca.py`, 79 lugares de `services/collector/pontos_df.json`, 5 jeitos
de digitar cada um): em 2026-11-02 a produção achava 72,7% entre as 5 primeiras e só 49,6% das estações de
metrô; daí o índice de pontos do OSM (`ml/extrair_pois_osm.py`) e a variante sem "df"/"brasília" no fim
("hospital de base do df"). Depois disso, na produção: 94,7% entre as 5 primeiras, 84,8% em 1º, 99,3% das
estações, nenhum ponto sem acerto, mediana de 504 ms. Dados do OSM: © contribuidores do OpenStreetMap, ODbL.

Entende a consulta: acento e caixa não importam, "sqs308" = "sqs 308", siglas do DF (EPTG, EPIA, Eixão,
UnB, Rodoviária, HBDF…; tabela `APELIDOS`) viram uma 2ª consulta com o nome por extenso, e erro de
digitação de 1 letra ("shoping") ainda casa. A malha usa regex (`imatch`) para ignorar acento; se o
PostgREST recusar o operador, ela recua para `ILIKE` por 10 min (aviso no log).

Por que ranquear na API: a TomTom dá nota ~0,99 para tudo que contém o texto — em "park shopping"
vinha primeiro uma loja de São Sebastião. Sinais usados:
- casamento de nome: igual > começa com > termos no nome > aproximado (erro de digitação) > termos só no
  endereço (sem termo nenhum = fora);
- marco (shopping, aeroporto, universidade, hospital…) sobe quando o nome bate forte ou a categoria foi
  digitada; a categoria em português conta como nome (a TomTom devolve o aeroporto sem a palavra
  "Aeroporto" e o shopping com ela: "Shopping Conjunto Nacional" também é "Conjunto Nacional");
- aglomeração (vários resultados com o nome no mesmo ponto = o lugar de verdade) só conta para quem é o nome;
- distância de `lat`/`lon` (quem busca; o app manda o outro ponto da rota) ou do centro, com teto de 15 km;
- corte relativo (ruído muito atrás do melhor sai) e deduplicação: mesmo lugar por outra fonte, sub-ponto,
  loja ou setor a menos de 250 m de um marco que já entrou, mesma via em outro trecho (a menos de 1,5 km ou no
  mesmo bairro) e no máximo 3 resultados com o mesmo nome.

**Response:**
```json
[
  { "label": "Park Shopping", "sublabel": "Guará", "lat": -15.834, "lon": -47.956, "source": "tomtom", "categoria": "Shopping" }
]
```
`categoria` também pode ser `Região` ou `Bairro` (localidades do OSM, `source: "malha"`). Consulta só de
pontuação devolve `[]` sem gastar cota. Limite de 90/min por IP (429 com `Retry-After`).

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

O `Dockerfile` copia só os artefatos da lista de permissão do `.dockerignore` (LIA 2.2 + 2.1 de rollback, contexto, calibrações, grafo). Fora o Supabase (enriquecimento e recência), TomTom e Open-Meteo, não há dependência externa em runtime.

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
