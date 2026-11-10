<div align="center">

# Routify — API de Roteamento Preditivo

**FastAPI servindo a LIA + algoritmo A\* sobre OSMnx**

![FastAPI](https://img.shields.io/badge/FastAPI-0.136-009688?style=flat-square&logo=fastapi&logoColor=white)
![XGBoost](https://img.shields.io/badge/XGBoost-3.2-FF6F00?style=flat-square)
![OSMnx](https://img.shields.io/badge/OSMnx-1.9-7B68EE?style=flat-square)
![NetworkX](https://img.shields.io/badge/NetworkX-3.6-FF6F00?style=flat-square)

</div>

---

**Última revisão:** 2026-11-09

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
│   ├── planejar.py     ← POST /route/horarios (planejar saída: mesmo trajeto, vários horários)
│   ├── search.py       ← GET /search/places (autocomplete de endereços)
│   ├── eventos.py      ← POST /eventos (eventos do app, JWT obrigatório)
│   ├── mfa.py          ← POST /mfa/codigos-recuperacao e /mfa/recuperar (verificação em duas etapas)
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
| `/route/horarios` | 10/min por IP |
| `/search/places` | 90/min por IP |
| `/eventos` | 60/min por usuário |
| `/trafego/agora` | 30/min por IP |
| `/mfa/codigos-recuperacao` | 5/h por usuário |
| `/mfa/recuperar` | 5 a cada 15 min por usuário e 20 por IP |
| antes de validar o token no Auth | 60/min por IP (`/admin`, `/mfa`) e 120/min por IP (`/eventos`) |
| `/admin/tomtom` | 60/min por admin |
| teste de chave | 6/min por admin |

**Tetos da TomTom (auditoria de 2026-11-03, M2):** além dos 120/min do pool (`tomtom_orcamento_min`), cada serviço
gasta no máximo 1/31 da cota mensal do pool por dia UTC (`COTA_MES_POR_CHAVE` em `tomtom.py`; o Flow fica com os 15%
que o coletor deixa) e cada IP faz no máximo 400 buscas com TomTom por dia (`TOMTOM_POR_IP_DIA` em
`routers/search.py`). Passou do teto, a resposta sai sem a TomTom (busca só local, rota só LIA); o painel mostra
"hoje X de Y" por serviço em `/admin/operacao`.

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
- `tomtom` — só `ativo` (TomTom ligada ou não). O tamanho do pool e as chaves livres por serviço ficam em
  `GET /admin/saude` (mesmo corpo, só admin; auditoria de 2026-11-03, B2), que o painel consulta;
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

### `GET /trafego/agora`
Trânsito agora nos pontos monitorados (tela "Trânsito agora" do app): previsão da LIA para este instante em cada ponto
(com a leitura mais recente como feature, igual à rota), nível 0 livre … 3 parado (a mesma régua do mapa,
`lia_inference.nivel_da_razao`), há quantos minutos veio a última leitura e o nome da via (da aresta do OSM ligada ao
ponto), do mais lento para o mais livre, com um resumo por nível. Uma chamada só do modelo para todos os pontos e 60 s
de cache; sem TomTom e sem dado pessoal. Público, 30/min por IP.

### `POST /mfa/codigos-recuperacao` · `POST /mfa/recuperar`
Códigos de recuperação da verificação em duas etapas (o Supabase Auth não tem os seus).
- **Gerar** exige JWT de sessão **aal2** e um fator TOTP verificado (só a senha não cria código para desligar o 2º
  fator). Devolve 10 códigos `XXXX-XXXX-XXXX-XXXX` (80 bits cada), uma única vez; os anteriores deixam de valer.
- **Recuperar** aceita a sessão aal1 (senha certa) + `{"codigo": "…"}` (corpo estrito; hífens e minúsculas tanto
  faz). Código válido → remove os fatores TOTP pela API admin do Auth, apaga os códigos restantes e responde
  `{"ok": true, "fatores_removidos": n}`. O Supabase encerra as sessões da conta: o app pede para entrar de novo
  só com a senha. Errado ou já usado → 400.
- O banco guarda só `sha256(user_id:código)` em `mfa_codigos_recuperacao` (RLS sem policy; migration
  `20261102030000_mfa_codigos_recuperacao.sql`). Uso único pelo `UPDATE … WHERE usado_em IS NULL`. Se o Auth falhar
  depois de aceitar o código, ele volta a valer. Geração, uso e tentativa recusada vão para `admin_auditoria`, sem IP.

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
- **Snap com vários candidatos** (`SNAP_CANDIDATOS=4` liga; padrão 1 = só o nó mais próximo, até o A/B de dia
  útil): o nó mais perto de um ponto costuma ser o da pista errada de uma via dupla, e chega-se a ele com um retorno.
  Com k > 1, os k nós mais próximos de cada ponta (até 100 m além do mais perto) entram num A* só
  (`trajeto.astar_multi`), cada um com o custo da ligação a pé (metros ÷ 1,4 m/s), e o melhor par sai exato.
  Também honra as conversões proibidas quando elas estão ligadas. No grafo real, 25 das 30 viagens do comparador
  mudam (várias só nos nós das pontas; Parque de Águas Claras → Rodoviária 19,4 → 17,7 km), por +0,1 s por rota.
- **Conversões proibidas do OSM** (`RESTRICOES_CONVERSAO=1` liga; **desligado por padrão** até o A/B de dia útil): o
  OSMnx ignora as relações `type=restriction` (no_left_turn, only_straight_on, no_u_turn…). `ml/restricoes_conversao.py`
  as mapeia offline em 1.260 triplas proibidas (u → via → w) em 808 cruzamentos (`restricoes_conversao_38km.json`).
  Na rota, se o caminho livre fizer uma, o `trajeto.astar_com_restricoes` refaz o A* com estado (nó, anterior) só nos
  cruzamentos com restrição; a baseline de menor distância segue a mesma regra. Sem caminho legal, fica o livre (aviso
  no log). No grafo real, 7 das 30 viagens do comparador violavam (Plano → Taguatinga inclusive); as 7 saíram legais,
  com +0,2 a +2,4% de tempo e ~0,2 s a mais por rota. Pesquisa: `.planning/research/2026-11-02-restricoes-conversao.md`.
- **Sensores virtuais** (`SENSORES_VIRTUAIS=1` liga; **desligado por padrão**): na subida, `graph_enrichment.pontos_virtuais` marca 1 ponto por célula de ~1 km com via principal (expressa > arterial > coletora) e nenhum sensor a 500 m (1.627 pontos). Por rota, até 3 deles no corredor são lidos no Flow da TomTom, com cache de 15 min, na mesma rodada paralela das vias velhas. A razão medida vira o peso das arestas do trecho que a TomTom mediu, só no sentido medido e só onde a aresta estava na heurística (`lia_source: virtual`, `trajeto.aplicar_leituras_virtuais`). Mexe na escolha do caminho e na cor do trecho; o tempo exibido nos buracos já vinha da TomTom pela fusão. `tomtom.sensores_virtuais` conta as leituras usadas. Dois A/B no mesmo instante, em 10 viagens pelos maiores buracos (`scripts/ab_rotas.py` + `scripts/viagens_buracos.json`; resultado em `ml/artifacts/ab_sensores_virtuais_2026-11-02.json`), ambos no feriado de 2026-11-02:
  - às 14h30 não houve diferença mensurável;
  - no pico das 18h12, com os buracos quase livres (a TomTom só 2–9% acima do tempo sem trânsito), o Flow leu fluxo livre e deixou a LIA até 19 s mais otimista em 5 viagens. Nenhum traçado mudou, e o MAPE no mesmo trajeto foi de 11,5% para 11,8%.
  Liga só depois de um A/B em dia útil com trânsito nos buracos.
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

### `POST /route/horarios`

**Planejar saída:** o tempo previsto do **mesmo trajeto** em várias horas de partida, e a mais rápida
(`routers/planejar.py`). Não chama a TomTom (zero cota) e não grava origem nem destino. Limite: 10/min por IP.

**Request** (corpo estrito, `extra="forbid"`):
```json
{
  "origem":  { "lat": -15.7939, "lon": -47.8828 },
  "destino": { "lat": -15.8339, "lon": -48.0569 },
  "inicio": "2026-11-04T06:00:00-03:00",
  "passo_min": 30,
  "janelas": 12
}
```

- `origem` e `destino`: dentro da caixa do DF (lat −16,10 a −15,45; lon −48,35 a −47,25), sem `NaN` nem `Infinity`.
  Ponto a mais de 600 m da malha dá 422, porque aqui não há rota da TomTom.
- `inicio` (opcional): a primeira saída, de agora a 7 dias à frente; sem fuso = Brasília. Padrão: agora, arredondado
  para os próximos 5 min.
- `passo_min`: de 15 a 120 (padrão 30). `janelas`: de 2 a 24 saídas (padrão 12).

**Response:**
```json
{
  "horarios": [
    { "saida": "2026-11-04T06:00:00-03:00", "tempo_seg": 1352 },
    { "saida": "2026-11-04T06:30:00-03:00", "tempo_seg": 1410 }
  ],
  "melhor": 0,
  "distancia_km": 23.84,
  "tempo_livre_seg": 1340,
  "lia_cobertura_pct": 94.17,
  "mesmo_trajeto": true,
  "modelo_utilizado": "lia_2.3"
}
```

**Como sai o número:**

1. O caminho é o A\* do `/route` para a primeira saída: snap no maior componente, `assign_lia_weights` no grafo
   inteiro, atraso de semáforo e de cruzamento no peso, conversões proibidas quando ligadas. Sem leitura ao vivo do
   corredor, sem interdições e sem fusão.
2. Para cada saída, a LIA prevê a razão das vias monitoradas na hora e no dia da saída, numa chamada só ao modelo
   (vias × saídas). Cada aresta segue a regra do `assign_lia_weights` (sensor, transferência e o prior `corredor`
   recalculado para aquela saída), mais os atrasos de cruzamento do `/route`. Na primeira saída, o tempo é o
   `tempo_lia_seg` do `/route` no mesmo instante (teste de paridade em `tests/test_planejar.py`).
3. **Recência no futuro:** vale a regra do `/predict` (`recencia_no_instante`). A leitura ao vivo envelhece até a
   saída e some acima de 24 h; aí vale o perfil + 24 h de defasagem. A LIA 2.3 foi treinada com a recência envelhecida
   de 15 a 480 min, então desconta sozinha a leitura velha. Os vizinhos só entram se a leitura ainda caberia na janela
   de 60 min na hora da saída.

**Simplificação (`mesmo_trajeto: true`):** o A\* não é refeito por saída; no pico, outro caminho pode ser mais rápido.
`tempo_livre_seg` é o mesmo trajeto com razão 1,0, mais os atrasos.

**Latência medida local** (grafo de 38 km, LIA 2.3, sem rede, 4 viagens):

- total de ~0,85 a 1,1 s com 12 saídas e de ~1,0 a 1,25 s com 24;
- ~0,63 s é o `assign_lia_weights`, o mesmo custo do `/route`;
- o A\* leva de 0,01 a 0,25 s, e a previsão das saídas ~0,2 s (12) ou ~0,37 s (24);
- a 1ª chamada depois da subida soma ~0,4 s (cache `_pesos_fixos` e aquecimento).

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
3 resultados e a consulta, 4+ letras (a política da OSMF proíbe autocomplete), ou se a consulta tem número de casa
e nada casou com ele ("Avenida Pau Brasil 14": a TomTom quase não tem número no DF, o OSM tem). Com `addressdetails`,
o rótulo vira "Rua, número" e o prédio vai para baixo; a via sem o número segue logo depois do endereço exato.

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
pontuação devolve `[]` sem gastar cota. Limite de 90/min por IP (429 com `Retry-After`); depois de 400 buscas
no dia, o IP segue só com a base local (sem TomTom); a bateria de validação no loopback (`X-Routify-Interno`) fica fora desse teto.

### `POST /search/recentes`
Confere até 10 destinos do histórico (`{"recentes": [{"label", "lat", "lon"}]}`, corpo estrito, só dentro do DF). Para cada
um devolve `lat`, `lon`, `area` (a região administrativa que contém o ponto, pelos polígonos do OSM em
`ml/artifacts/ras_df.json`) e `corrigido`. Se o nome é de um marco do OSM com dono único (`pois_df.json`) e o ponto salvo
está a mais de 3 km dele, a coordenada vira a do marco: um "Park Shopping" salvo em São Sebastião (POI homônimo da
TomTom, escolhido com o ranking antigo) volta para o ParkShopping do Guará. Rótulo já desambiguado pelo app
("Park Shopping · São Sebastião") não casa e fica. Sem TomTom e sem gravar nada; 90/min por IP.

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

Textos, grupos e parâmetros do Swagger ficam em `openapi.py`; exemplos e descrições dos campos ficam nos modelos Pydantic de cada router. Para testar rotas com login, cole o `access_token` da sessão Supabase em **Authorize** (não fica salvo: `persistAuthorization` desligado). `/admin/*` e `/mfa/*` ficam fora do Swagger público (auditoria de 2026-11-03, B3) e estão descritos neste README. O tempo de cada fase do `/route` fica só no log (`| ms prep=… snap=…`).

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
