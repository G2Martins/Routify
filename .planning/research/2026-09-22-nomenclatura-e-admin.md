# Nomenclatura do monorepo + escopo do Admin

**Última revisão:** 2026-09-22 · Status: **proposta — aguardando OK** (a renomeação toca todos os caminhos; executar num commit só, antes do Admin)

## 1. Nomenclatura

### Problemas da estrutura atual

| Problema | Exemplo |
|---|---|
| Caixa misturada | `BackEnd/`, `FrontEnd/`, `API/`, `Docs/` × `routers/`, `services/` |
| Idioma misturado | `Servidor/`, `Treinamento_IA/`, `recencia_cache.py`, `calibrar_transfer.py` × `graph_enrichment.py`, `routers/` |
| Nome que engana | `Servidor/` é o **coletor** (não serve nada); `models/` é a camada de banco no coletor e são os artefatos de ML no treino |
| Fora do padrão da ferramenta | `sql/` solto, em vez de `supabase/migrations/` (padrão do Supabase CLI) |
| Config compartilhada por acidente | a API lê o `.env` do coletor (`../../Servidor/config/.env`) |

### Proposta

Regra: **pastas em inglês, minúsculas**; módulos Python em `snake_case` inglês; conceitos da tese (LIA, recência) seguem no código e na doc. **Identificadores dentro dos arquivos não mudam**: funções e variáveis em português ficam como estão, porque renomeá-las é churn sem ganho e quebraria trechos citados no texto.

```
routify/
├── apps/
│   ├── api/                ← BackEnd/API              FastAPI + LIA (inferência, A*, TomTom)
│   ├── mobile/             ← FrontEnd                 Expo — visão do usuário (mobile + web)
│   └── admin/              ← novo                     Next.js — visão ADM
├── services/
│   └── collector/          ← BackEnd/Servidor         coletor TomTom (pausado)
├── ml/                     ← BackEnd/Treinamento_IA   pipeline de treino
│   └── artifacts/          ← Treinamento_IA/models    modelos, metadata JSON, grafo
├── supabase/
│   └── migrations/         ← BackEnd/sql              DDL versionada
├── docs/                   ← Docs
├── .github/  .planning/  CLAUDE.md  README.md
```

| Hoje | Proposto |
|---|---|
| `BackEnd/API/recencia_cache.py` | `apps/api/recency_cache.py` |
| `BackEnd/Servidor/models/db_manager.py` | `services/collector/db.py` |
| `BackEnd/Servidor/services/traffic_collector.py` | `services/collector/traffic_collector.py` |
| `BackEnd/Servidor/services/map_extractor.py` | `services/collector/map_extractor.py` |
| `BackEnd/Treinamento_IA/otimizar_hiperparametros.py` | `ml/tune_hyperparams.py` |
| `BackEnd/Treinamento_IA/calibrar_transfer.py` | `ml/calibrate_transfer.py` |
| `BackEnd/Treinamento_IA/validar_fase3.py` | `ml/external_validation.py` |
| `BackEnd/Treinamento_IA/figuras_tcc.py` | `ml/thesis_figures.py` |
| `BackEnd/sql/001_route_history.sql` | `supabase/migrations/20260427000000_route_history.sql` |
| `BackEnd/sql/002_validacao_tese.sql` | `supabase/migrations/20260907000000_thesis_validation.sql` |
| `BackEnd/Servidor/config/.env` (lido pela API) | `apps/api/.env` próprio (+ `.env.example`) |

Os demais ficam como estão: `main.py`, `graph_enrichment.py`, `lia_inference.py`, `tomtom.py`, `routers/`, `silver.py`, `features.py`, `train.py`, `benchmark_lstm_xgboost.py`.

### Impacto (o commit de renomeação cobre tudo)

- **Imports e caminhos:**
  - `import recencia_cache` passa a `recency_cache` (main, route, testes);
  - `MODELS_DIR` passa a `ml/artifacts`;
  - caminho das chaves em `tomtom.py`;
  - `sys.path` do coletor e do `external_validation.py`;
  - `Dockerfile`, systemd `.service`, workflows do CI, script de figuras.
- **`.gitignore`:** os padrões `BackEnd/...` viram `apps/...`, `ml/artifacts/*.pkl` etc.
- **Docs:** READMEs, CLAUDE.md, `docs/core/architecture.md`.
- **Arquivos locais fora do git:**
  - são eles: `.pkl`, `.graphml`, parquet, `.env`, `tomtom_keys.json`, `node_modules`;
  - **precisam ser movidos à mão** em cada máquina;
  - movo os desta máquina; o Pedro move os dele (os artefatos da LIA 2.1 estão com ele).
- **Histórico:** o `git mv` preserva o histórico (detecção de renomeação).
- **Verificação:** pytest + `tsc` + import da API verdes antes do commit.

## 2. Admin — escopo atualizado (pedido de 2026-09-22)

App `apps/admin` (Next.js, design Valerium: tokens, shadcn, `ChartContainer` + Recharts). Tudo que o orientador pediu para o texto vira **acompanhamento vivo** no Admin.

| Página | Conteúdo | Fonte | Depende do Supabase? |
|---|---|---|---|
| **LIA — desempenho e benchmarks** | fig. 1–4 interativas (MAE/RMSE × baseline, calibração isotônica, LSTM × XGBoost, congestionamento); histórico de treinos; erro real em produção (feedback × previsto); LIA × TomTom ao longo do tempo (validação externa contínua); cobertura LIA e taxa de modo degradado | JSONs de `ml/artifacts` via API; tabela `lia_treinos`; `rotas_calculadas` | só as séries em produção |
| **Arquitetura viva** | diagrama interativo (React Flow) dos fluxos App → API → cache de recência / pool TomTom / LIA → Supabase / TomTom / Nominatim, mais o fluxo de treino (silver → features → train → artefatos → API). Cada nó mostra status ao vivo (API no ar, banco alcançável, chaves por serviço, idade do cache, versão do modelo); clique abre os detalhes | `/health` + endpoint admin | não |
| **Uso da plataforma** | buscas/rotas por hora e dia, usuários ativos, funil (busca → rota → navegação → feedback), top corredores agregados | `api_requisicoes`, `eventos_app`, `rotas_calculadas` | sim |
| **Data Quality** | frescor por via, lacunas, nulos/outliers, duplicatas, cobertura hora×dia, tamanho das tabelas | views `dq_*` | sim |
| **Erros e TomTom** | erros agrupados por fingerprint; chamadas, cooldowns e cota por chave/serviço (só ids) | `erros_api`, `tomtom_chamadas` | sim |
| **Usuários e auditoria** | cadastros, ativos, bloqueio; log append-only das ações ADM | `auth.users` (RPC admin), `audit_log` | sim |

**Ordem sugerida:**
1. Renomeação.
2. Admin com **LIA** + **Arquitetura viva**, que funcionam mesmo com o banco pausado.
3. Restaurar o Supabase.
4. Captura de uso (abaixo).
5. Páginas de Uso, Data Quality, Erros e Usuários.

### Captura de uso (F3) — desenho

Tudo escrito **pelo servidor** (cliente hostil):

| Tabela | Escrita por | Conteúdo |
|---|---|---|
| `api_requisicoes` | middleware da API | rota, status, latência, usuário (uuid ou nulo), versão do modelo, degradado, nº de chamadas TomTom — sem coordenadas |
| `rotas_calculadas` | `/route` | origem/destino **arredondados a 3 casas (~110 m)**, tempo LIA, tempo menor distância, referência TomTom, cobertura, incidentes, degradado |
| `eventos_app` | `POST /eventos` (JWT, Pydantic estrito, rate-limit) | tipos fixos: `busca`, `rota_solicitada`, `navegacao_iniciada`, `navegacao_concluida`, `feedback` |
| `lia_treinos` | `train.py` ao terminar | versão, data, MAE/RMSE geral e congestionado, baseline, hash dos hiperparâmetros |

- **`route_history`** continua sendo o histórico pessoal (RLS por dono).
- **LGPD:**
  - consentimento na tela Privacy + opt-out;
  - bruto guardado por 90 dias (`pg_cron`), agregados diários permanentes;
  - ADM nunca vê a trilha individual.
- **Leitura só com `app_metadata.role = 'admin'`** (RLS + checagem na API).
