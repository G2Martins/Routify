# CLAUDE.md — Routify

> **Spec viva.** Porta de entrada lida pelo agente toda sessão. Não duplica os docs profundos — **aponta** pra eles. Atualize quando uma regra, comando, módulo ou hurdle mudar.
>
> **Última revisão:** 2026-09-23
> **Estado/decisões:** [.planning/STATE.md](.planning/STATE.md) · **Análise da plataforma (fase final TCC 2):** [.planning/research/2026-09-22-analise-plataforma.md](.planning/research/2026-09-22-analise-plataforma.md)

---

## 1. O que é

TCC 2026 — **roteamento preditivo para Brasília/DF**. Um coletor puxou TomTom Traffic Flow pro Supabase desde 2026-04-27 (~630 pontos, de 8 em 8 min). O modelo **LIA** (XGBoost) prevê a razão de congestionamento (vel. atual / vel. livre, 0,05–1,0). A API FastAPI roteia com A* num grafo OSMnx de 38 km. O app Expo (mobile + web) é a visão do usuário. Equipe: G2Martins + Pedro Borges (ver README).

**Fase final:** plataforma para o usuário (uso e histórico de rotas) + **visão ADM** (data quality, buscas, erros, modelo — observabilidade). A coleta contínua será **parada**; o TomTom passa a ser chamado sob demanda, com rotação automática de chaves. Cliente é **hostil até prova em contrário** (§4).

## 2. Stack + Comandos

Python (API/Coletor/Treino) · FastAPI 0.136 · XGBoost 3.2 · OSMnx 1.9.3 · supabase-py 2.13 · httpx · Expo SDK 54 / RN 0.81 / React 19.1 / react-native-web · Next.js 16 + Recharts + React Flow (admin) · Supabase (Postgres + Auth + RLS + pg_cron) · TomTom (sob demanda). Ainda **sem** workspace JS (npm separado em `apps/mobile` e `apps/admin`) e **sem** lint.

Passo a passo pra subir tudo e testar as visões de usuário e ADM: [docs/core/rodar-local.md](docs/core/rodar-local.md).

```bash
# Python da API e do ml/ = SEMPRE o venv apps/api/.venv (versões fixadas; os .pkl dependem delas)
cd apps/api && .venv/Scripts/python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000   # API
cd apps/api && .venv/Scripts/python -m pytest -q                       # testes da API (HTTP da TomTom simulado)
cd ml && ../apps/api/.venv/Scripts/python calibrate_signals.py --api http://127.0.0.1:8000   # atraso de semáforo
cd services/collector && python main.py                                     # coletor TomTom (8 min) — será pausado
cd ml && ../apps/api/.venv/Scripts/python train.py --version lia_2.1 --skip-silver   # treino (sem --skip-silver puxa do Supabase)
cd ml && ../apps/api/.venv/Scripts/python thesis_figures.py                        # figuras do texto → docs/figuras/
cd ml && ../apps/api/.venv/Scripts/python publish_metrics.py                       # métricas da LIA → lia_treinos/lia_analises (painel ADM)
cd apps/mobile && npm run web                                             # ou android | ios (:8081)
cd apps/admin && npm run dev                                              # painel ADM (:3000), precisa de .env.local
```

CI (`.github/workflows/`):
- `ci.yml` — pytest + compileall + `tsc --noEmit` (mobile e admin) + `next build` + gitleaks;
- `docs-links.yml` — lychee, adaptado do tpotce;
- `supabase-keepalive.yml` — leitura diária pro plano free não pausar. Precisa dos secrets `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`.

## 3. Mapa de módulos

`(tcc2)` = veio da branch do Pedro; integrado ao `main` em 2026-09-22 (`0e066fb`, ver §6).

| Módulo | O quê | Doc |
|---|---|---|
| [apps/api/](apps/api/) | `GET /health`, `GET /metrics`, `POST /predict`, `POST /route` (A* por `travel_time_lia` + baseline de menor distância + bloco `tomtom`), `GET /search/places` (malha local → TomTom Search → Nominatim). `tomtom.py` (TomTom sob demanda: pool de chaves, recência ao vivo no corredor, interdições, ETA de referência). (tcc2) `recency_cache.py` (TTL 300 s, merge com a leitura ao vivo), `graph_enrichment.py` (BallTree, transfer ≤ 500 m), `lia_inference.py`; confiança calibrada em runtime = `transfer_confidence_isotonic.pkl`. **Captura de uso** (`usage.py`): middleware grava `api_requisicoes`; `/route` grava `rotas_calculadas` (coords arredondadas em 3 casas); `POST /eventos` (JWT obrigatório, 60/min por usuário) grava `eventos_app`; tudo fire-and-forget com service_role. CORS por allowlist (`CORS_ORIGINS`). **Fusão LIA × TomTom** (`trajeto.py`): a TomTom reconstrói a rota da LIA via `supportingPoints` (ETA ao vivo do mesmo trajeto + alternativa só se melhor); tempo = cobertura·LIA + resto·TomTom; fora da malha (snap > 600 m) a rota é da TomTom; atraso de semáforo calibrado (`semaforos_calibracao.json`). `seguranca.py` (limitador 429/Retry-After, `exigir_admin`), `config_runtime.py` (flags do painel), `routers/admin.py` (pool TomTom) | [README](apps/api/README.md), [architecture](docs/core/architecture.md) |
| [services/collector/](services/collector/) | Coletor TomTom Flow Segment Data v4 → `historico_trafego`; bootstrap de `malha_completa`/`vias_monitoradas`; rotação de chaves. (tcc2) job Fase 3 4×/dia + `deploy/` (systemd) | [README](services/collector/README.md) |
| [ml/](ml/) | `silver.py` (Supabase → parquet, **único** acesso ao banco) → `features.py` → `train.py` (TimeSeriesSplit, 5 folds). (tcc2) `tune_hyperparams.py` (Optuna), `calibrate_transfer.py`, `benchmark_lstm_xgboost.py`, `external_validation.py`. Artefatos em `models/` (`.pkl` gitignored, `.json` versionado) | [README](ml/README.md) |
| [supabase/migrations/](supabase/migrations/) | Única DDL versionada, em ordem: `20260427…_route_history` (`route_history`, `profiles`, trigger `handle_new_user`), (tcc2) `20260907…_thesis_validation`, `20260923000000_security_hardening` (RLS do dataset), `20260923010000_usage_tracking_admin` (uso, `is_admin()`, RPCs de leitura, views de qualidade no schema `painel`, `pg_cron`), `20260923020000_admin_actions` (RPCs de ação com trava anti-corrida + auditoria na mesma transação, `config_runtime`, `avisos_app`, feedback outlier, analytics k-anônimo) | [rodar-local §1](docs/core/rodar-local.md) |
| [apps/admin/](apps/admin/) | Painel ADM Next.js 16: visão geral, LIA (benchmarks), arquitetura viva (React Flow), uso, qualidade dos dados, usuários. Só chave publishable; acesso garantido no banco (RLS + RPC com `is_admin()`) | [README](apps/admin/README.md) |
| [apps/mobile/](apps/mobile/) | Expo: Login/Register → abas Mapa/Painel/Histórico/Perfil (EditProfile, Privacy); na web desktop usa `SideRail`. Auth, `profiles` e `route_history` vão **direto no Supabase**; rotas vão pela API (`EXPO_PUBLIC_API_URL`). Mapas: `react-native-maps` (nativo) / `leaflet` (web). Tema claro/escuro via `ThemeContext` | [README](apps/mobile/README.md) |

**Tabelas Supabase** (projeto `vwbnragsacjxxulxenvg`):

| Tabela | Conteúdo | Escreve → Lê |
|---|---|---|
| `historico_trafego` | séries TomTom — **dataset do TCC** | coletor → cache da API, `silver.py` |
| `vias_monitoradas` | ~630 pontos monitorados | coletor (1×) → coletor, startup da API |
| `malha_completa` | ~38 mil vias do DF | coletor (1×) → autocomplete |
| `route_history` | rotas do usuário + colunas de validação | app (RLS por dono) |
| `profiles` | nome, avatar, tema | trigger + app (RLS por dono) |
| `api_requisicoes` · `rotas_calculadas` · `eventos_app` | captura de uso (retenção 90 dias por `pg_cron`) | API (service_role) → painel ADM (RLS: só admin lê) |
| `lia_treinos` · `lia_analises` | métricas por versão da LIA + análises (calibração, benchmark) | `ml/publish_metrics.py` → painel ADM |
| `admin_auditoria` | trilha append-only de toda ação de admin (nem service_role altera/apaga) | RPCs `admin_*` e API → painel ADM |
| `config_runtime` · `avisos_app` | flags operacionais (kill switch TomTom, orçamento, chaves pausadas, modo só-LIA) · banner do app | RPCs `admin_*` → API (TTL 30 s) · app (policy de leitura dos vigentes) |

⚠️ As 3 primeiras **não têm DDL de criação no repo**; o RLS delas vem da migration de hardening (§5).

## 4. Regras SEMPRE-ATIVAS

- **Regra zero — nunca confiar no frontend.** Validação, RBAC, rate-limit e ownership ficam no servidor (API ou RLS). O front só esconde botão.
- **Defesa em profundidade** — 2+ camadas: Pydantic estrito (`extra="forbid"`) + JWT Supabase verificado na API + RLS + rate-limit + audit-log.
- **O dataset do TCC é sagrado.** `historico_trafego`, `vias_monitoradas` e `malha_completa` são a base da tese. Zero DELETE/TRUNCATE/DROP/UPDATE em massa sem backup + OK explícito. O MCP Supabase está com escrita liberada desde 2026-09-23 (pedido do dono): só aplicar arquivo versionado de `supabase/migrations/` (§6).
- **LGPD** — origem/destino do usuário é dado pessoal de localização. Exige consentimento (tela Privacy) e retenção definida. Analytics do ADM usa coordenadas arredondadas/agregadas; nunca exportar a trilha individual de alguém.
- **Número da tese vem de artefato versionado.** Toda métrica citada no texto aponta pra um `models/*.json` (chave exata). Nada de número digitado à mão.
- **Testes junto com a lógica** — pytest pra API, rotação de chaves e features; teste com DB real (projeto/branch de teste), sem mock de banco. Endpoint sensível ganha teste de segurança (IDOR, mass-assignment, rate-limit).
- **Docs vivas** — README por módulo + `docs/`, com `**Última revisão:** YYYY-MM-DD` no topo. Mudou comportamento → atualiza a doc no mesmo PR. Código ≠ doc → corrige a doc primeiro.
- **GSD** — discuss → plan → execute → verify. `.planning/STATE.md` atualizado ao fechar cada etapa.
- **Design** — segue a linguagem do Valerium: tokens HSL, paleta monocromática, zero hex literal em componente, gráficos com tokens `--chart-*`. Ref. (outra org, só leitura): `G:\1. Projetos\6. Grovic Data\Valerium-Portal\packages\ui\src\globals.css`, `docs/core/design-system.md` de lá e `Grovic-Components/`.
- **Segredos** — nunca commitar. `.env`, `tomtom_keys.json` e `.mcp.json` estão no gitignore; exemplos ficam em `*.example`. Nunca logar chave TomTom (logar só o id).
- **Caveman full + Ponytail full sempre** (plugins globais já ativos).
- **Commits sem co-author** — NUNCA adicionar `Co-Authored-By: Claude…` (nem trailer de atribuição ao assistente). Mensagem de commit = só conteúdo técnico.

## 5. Segurança — estado atual (dívida conhecida; resolver antes de deploy público)

- **Resolvido em 2026-09-23:**
  - CORS por allowlist (`CORS_ORIGINS`, sem credenciais);
  - JWT Supabase verificado na API (`usage.usuario_do_token`: opcional em `/route` e `/search`, obrigatório em `/eventos`);
  - papel ADM em `app_metadata.role` + `is_admin()` nas RPCs e policies;
  - rate limit por IP em `/route` (20/min) e `/search` (90/min), com 429 + `Retry-After`. O IP vem do `X-Forwarded-For` só com `TRUST_PROXY=1`;
  - ações de admin auditadas: RPC com advisory lock + intervalo mínimo + `admin_auditoria` append-only na mesma transação. Não rebaixa a si mesmo nem o último admin.
- **Ainda aberto:**
  - os limites ficam em memória: zeram em restart e não valem entre réplicas. Com mais de 1 réplica, mover pra tabela ou Redis;
  - `/route` e `/search` seguem aceitando chamada anônima (limitada por IP).
- `route_history` é 100% escrito pelo cliente, então os dados de validação da tese são corrompíveis. Alvo: a API persiste (service role) e o cliente só lê e dá feedback.
- **CONFIRMADO em 2026-09-23 (advisor nível ERROR):** `historico_trafego`, `vias_monitoradas` e `malha_completa` estão **sem RLS**, e o `anon` tem SELECT/INSERT/DELETE. Qualquer um com a chave pública do app lê e apaga o dataset via PostgREST.
  - Correção versionada em `supabase/migrations/20260923000000_security_hardening.sql`:
    - RLS sem policy + revoke nas 3 tabelas (API, coletor e ml usam service_role);
    - UPDATE de `route_history` restrito às colunas de feedback;
    - `handle_new_user` fora do `/rpc`.
  - **Status:** as migrations 1–3 foram aplicadas pelo dono em 2026-09-23 (o `publish_metrics.py` gravou; conferir o Advisor). **Pendente:** `20260923020000_admin_actions.sql`, sem a qual as ações do painel e a `config_runtime` dão 404. Como aplicar e como promover admin: [docs/core/rodar-local.md §1](docs/core/rodar-local.md).
- O papel ADM nunca pode ficar em coluna que o próprio usuário edita (`profiles` tem update pelo dono). Fica em `app_metadata.role`, que só o service role grava e já vem no JWT. Depois de promover, o usuário precisa sair e entrar de novo para o token trazer o papel.

## 6. Common Hurdles

- **Estrutura renomeada em 2026-09-22** — pastas em inglês e minúsculas:

  | Antes | Agora |
  |---|---|
  | `BackEnd/API` | `apps/api` |
  | `FrontEnd` | `apps/mobile` |
  | `BackEnd/Servidor` | `services/collector` (plano) |
  | `BackEnd/Treinamento_IA` | `ml` (artefatos em `ml/artifacts`) |
  | `BackEnd/sql` | `supabase/migrations` (nomes com timestamp) |
  | `Docs` | `docs` |

  Módulos renomeados: `recency_cache`, `tune_hyperparams`, `calibrate_transfer`, `external_validation` (antes `validar_fase3`), `thesis_figures`, `db` (antes `db_manager`, importado `as db_manager`). Identificadores Python em português ficaram como estavam.
  - **Arquivos fora do git** (`.env`, `tomtom_keys.json`, `.pkl`, `.graphml`, parquet, `node_modules`) precisam ser movidos à mão em cada máquina.
  - O `.env` e as chaves seguem em `services/collector/config/` e também são lidos pela API e pelo `ml/`. Em produção, a API usa variáveis de ambiente.
  - Não criar pasta nova com maiúscula ou em português.

- **Supabase do Routify = `vwbnragsacjxxulxenvg` — conferir o ref antes de conectar.** O `.mcp.json` original veio copiado de um projeto de outra organização, apontando pro banco dela (e era JSON inválido); corrigido em 2026-09-22. **Repo público:** não commitar ref, domínio ou token de infra de outra org.
- **MCP Supabase** = remoto HTTP + OAuth (`/mcp` → autenticar com a conta que tem acesso ao projeto).
  - O `.mcp.json` local está **sem** `read_only=true` desde 2026-09-23; o `.mcp.json.example` segue read-only.
  - Mudou a URL → o OAuth precisa ser refeito numa sessão **interativa**. Sessão não interativa não autentica, e aí o fallback é colar o arquivo no SQL Editor.
  - Nada de SQL fora de arquivo versionado. O SQL de promoção de admin (tem e-mails) fica em `supabase/.local/`, que é gitignored.
- **A branch `tcc2` (Pedro) era ÓRFÃ** — o commit raiz `aefb465` não tinha pai. Foi integrada em 2026-09-22 com enxerto temporário (`git replace --graft aefb465 66d30c0` → merge → `git replace -d`) no commit `0e066fb`, e agora o merge-base é `65b387a`. Commits novos do Pedro na `tcc2` mesclam normalmente. Nunca usar `--allow-unrelated-histories` (vira add/add em tudo). Regra pro time: branch nova sempre a partir de `main` atualizado, nunca de snapshot.
- **`.gitignore` do tcc2 ignora `*.md` exceto README** (notas internas ficam fora do repo). Exceções mantidas: `CLAUDE.md`, `docs/**/*.md`, `.planning/**/*.md`. Doc viva nova em outra pasta precisa de exceção.
- **`apps/mobile/src/lib/` sumia do git.** O `.gitignore` antigo tinha `lib/` (template Python) e engolia `api.ts`/`supabase.ts`/`responsive.ts`. Corrigido em `75c92d8`; hoje o ignore de `lib/` só vale dentro das pastas Python. O snapshot tcc2 não tem a pasta, então não builda sozinho; o tipo `RouteHistoryRow` do main não tem as colunas novas de validação.
- **Rotação de chaves TomTom (coletor):** o mesmo bug foi corrigido 2× em paralelo (main `d0fb247` × tcc2). No merge ficou a implementação do main: cooldown graduado (QPS 300 s, 403 desconhecido 600 s), `requests.Session` com retry e guard anti-sobreposição `coleta_protegida`. A cota esgotada usa a **janela rolante de 24 h** do Pedro (`SECONDS_PER_DAY`), porque o reset não está confirmado. Ao reaproveitar na API: extrair um módulo compartilhado, não copiar.
- **Cota free da TomTom é MENSAL e POR API** (pricing conferido em 2026-09-22): Flow 20 mil, Incidents 2,5 mil, Search 2,5 mil e Routing 20 mil por chave.
  - Por isso o cooldown em `tomtom.py` é por (chave, serviço).
  - A TomTom devolve **429 tanto pra QPS quanto pra cota**; 3 respostas 429 seguidas na mesma chave viram cota. Não dá pra confiar em frases de erro antigas ("Developer Over Qps").
  - O Incident Details não aceita `pt-BR`; usar `pt-PT`.
  - A confirmar no painel my.tomtom.com: se a conta nova não tem cota diária adicional.
- **Pool de 39 chaves × ToS TomTom §14.2** — os termos permitem suspender contas criadas pra obter requisições grátis adicionais. Declarar na tese como risco/limitação de protótipo acadêmico.
- **Flow Segment Data só existe na API Genesis v4** (`/traffic/services/4/flowSegmentData`). O traffic flow do Orbis v2 é só tiles. Incidents, Routing e Search já têm versão Orbis, mas o código usa as versões Genesis estáveis.
- **Nominatim: a política da OSMF proíbe autocomplete** e exige ≤ 1 req/s + cache. Por isso ele é o último elo da busca, com trava. Não mover pra frente da cadeia.
- **Supabase free pausa após ~7 dias sem requisição, e o domínio passa a dar NXDOMAIN** (aconteceu: a coleta parou em 19/07/2026 e em 2026-09-22 o host não resolvia).
  - Restaurar em Dashboard → projeto → Resume. A janela de restauração do free hoje é de 1 ano.
  - O free não tem backup automático: exportar (`supabase db dump`/parquet) depois de restaurar.
  - O keep-alive em `.github/workflows/supabase-keepalive.yml` evita a próxima pausa.
- **Convex não serve pra hospedar a API**: só roda JS/TS e o runtime Node limita memória a 512 MiB. Foi avaliado em 2026-09-22 (GrovOps usa Convex como backend próprio, não pra Python).
- **Ambiente Python:** os `.pkl` da LIA foram serializados com pandas 3.0 / xgboost 3.2 / scikit-learn 1.8 / numpy 2.4.
  - O Python global desta máquina tinha pandas 2.2 / xgboost 2.1 / sklearn 1.5. O modelo do Pedro nem carrega nele, e o retreino de 22/09 saiu com as libs erradas.
  - **Sempre usar `apps/api/.venv`** (API e `ml/`).
  - O pip atrás de antivírus que inspeciona HTTPS dá `CERTIFICATE_VERIFY_FAILED`: usar `--use-feature=truststore`, que usa os certificados do Windows. Nunca `--trusted-host`.
- **Modelos em `ml/artifacts/`:**
  - `lia_2.1*` = o modelo do Pedro (19/08, hiperparâmetros manuais), que bate com o `lia_2.1_metadata.json` versionado (RMSE 40,69 / MAE 14,62).
  - `lia_2.1_retreino_20260923*` = retreino com Optuna. Ficou pior em segundos (MAE 15,03) e foi feito no ambiente errado: **não usar na tese**.
  - Qual modelo a tese chama de "LIA 2.1" é decisão do grupo. Re-rodar `train.py` no venv antes dos números finais.
- **Grafo = `brasilia_graph_38km.graphml`** (97.739 nós; o raio vai no nome).
  - O `brasilia_graph.graphml` antigo tinha ~15 km e não cobria Ceilândia/Samambaia: o destino grudava na borda e o app ligava com linha reta ("rota por cima da parede").
  - Cache com mais de 180 dias só gera aviso; nunca é apagado sozinho, pra não trocar o grafo da tese.
- **Semáforos:** o OSMnx simplificado guarda só 114 de 423 semáforos do DF (os demais ficam na linha de retenção).
  - A API encaixa os pontos do OSM (`semaforos_osm_38km.json`) no cruzamento a ≤ 40 m, o que dá 271 cruzamentos.
  - O `features_from_point` do OSMnx 1.9 quebra (`UnboundLocalError`) quando o endpoint de status do Overpass falha, então o download é uma consulta direta ao Overpass com espelho.
- **Traçado:** o conector entre o ponto e a via é tracejado. A busca TomTom usa `entryPoints` (entrada do POI, não o centro do prédio). Backlog: snap na aresta em vez do nó.
- **Mapa da TomTom no app:** não usar o pool de 39 no navegador (a chave fica pública). Se quiser o estilo "night", usar 1 chave dedicada com restrição de domínio. Tiles do OSM/Esri continuam.
- **Login único app + painel:** o Expo web usa `createBrowserClient` (`@supabase/ssr`), que guarda a sessão em cookie, e o painel Next roda sob `/admin` lendo o mesmo cookie.
  - Em dev, `:8081` e `:3000` compartilham o cookie, porque cookie não separa porta.
  - Sem sessão, o painel manda para `NEXT_PUBLIC_APP_URL`.
  - O tema vai pelo cookie `routify-tema`.
- **Fase 3 do Pedro:** `ml/artifacts/fase3_comparacao.csv` (71 linhas, corredores fixos) agora é versionado. Mostra a LIA subestimando de dia (ex.: 682 s × TomTom 1.136 s).
- **Métricas pros gráficos da banca:**
  - A LIA 2.0 não tem CV persistido (proxy: `benchmark_lstm_vs_xgboost.json` → `xgboost.*`).
  - O `cv` da LIA 2.1 é anterior aos hiperparâmetros Optuna adotados, então re-rodar `train.py` antes dos números finais.
  - O "Erro médio" do resumo técnico (74,7 / 51,3 / 40,7 s) é **RMSE**, não MAE (MAE = 50,8 / 18,6 / 14,6).
- **Em runtime, a confiança do transfer vem de `transfer_confidence_isotonic.pkl`**, não do `.json` (que é só a saída legível). Sem o pkl, cai no fallback em degrau 1,0/0,8/0,6 (`route.py`).
  - A isotônica foi ajustada sobre a confiança **por par já recortada em [0, 1]**, e fica acima da confiança do erro médio das faixas (≈0,36 × 0 além de 600 m; ≈0,6–0,7 × 0,53 entre 100 e 500 m).
  - Está documentado como limitação em [docs/tcc/resultados-e-limitacoes.md](docs/tcc/resultados-e-limitacoes.md) §4. Não "corrigir" sem re-calibrar e re-treinar.
- **O job Fase 3** (`external_validation.py`, 07/12/18/22 h) usa o horário do processo, então o host precisa de `TZ=America/Sao_Paulo`. Pico de ~1,4 GB de RAM por execução.
- **Hospedagem (decidido 2026-09-22: dividir).** O plano Hostinger Business roda Node.js via Passenger, **sem Python**.
  - **Hostinger:** front web estático (Expo export) + admin Next.js.
  - **API FastAPI:** em host grátis com RAM suficiente. O grafo de 38 km + o modelo chegam a ~1,4 GB de pico. Render e Koyeb grátis têm só 512 MB, então só servem com o grafo enxugado. Candidatos (pesquisa de 2026-09-22):
    1. **Google Cloud Run** — memória configurável, escala a zero, cota grátis cobre uma demo; exige conta de faturamento. Cold start = carga do grafo, então pré-serializar o grafo em pickle.
    2. **Oracle Always Free** (ARM, 12 GB) — sem cold start, mas a própria Oracle admite falta de capacidade.
    3. **Azure for Students** — US$ 100 sem cartão.
    4. **Hugging Face Spaces** — 16 GB grátis, mas Docker no plano free está ambíguo na documentação: testar criando um Space.

    Medir o RSS real da API antes de escolher.
  - O deploy do Valerium é feito como 2 apps Node separados (API + dashboard), não 1 processo.

## 7. Antes de fechar qualquer fase

- [ ] Doc/README do módulo atualizado (data de revisão)
- [ ] Pydantic estrito · auth JWT · rate-limit · RLS · ownership em toda query por id
- [ ] Teste do golden path + erro; teste de segurança se o endpoint for sensível
- [ ] Números citados na tese batem com `models/*.json`
- [ ] Sem segredo nem `print` de dado sensível; `git status` sem `.env`/chaves
- [ ] `.planning/STATE.md` atualizado

## 8. Índice de navegação

- **Estado / decisões / próximos passos** → [.planning/STATE.md](.planning/STATE.md)
- **Análise da plataforma + roadmap** → [.planning/research/2026-09-22-analise-plataforma.md](.planning/research/2026-09-22-analise-plataforma.md)
- **Arquitetura (diagramas, rotação de chaves, busca)** → [docs/core/architecture.md](docs/core/architecture.md)
- **Texto do TCC — resultados, calibração, limitações (rascunho)** → [docs/tcc/resultados-e-limitacoes.md](docs/tcc/resultados-e-limitacoes.md) · figuras em [docs/figuras/](docs/figuras/)
- **READMEs** → [README.md](README.md) · [API](apps/api/README.md) · [Coletor](services/collector/README.md) · [ML](ml/README.md) · [App](apps/mobile/README.md)
- **Plano de trabalho do TCC** → [docs/](docs/) (PDFs)
- **Referências de padrão** (outra org, só leitura): `Valerium-Portal` (design/auth/deploy), `GrovOps` (observabilidade), `tpotce-TCC` (painel admin / data quality)
- **Memória cross-sessão** (auto-injetada) → `~/.claude/projects/.../memory/MEMORY.md`
