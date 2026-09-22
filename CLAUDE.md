# CLAUDE.md — Routify

> **Spec viva.** Porta de entrada lida pelo agente toda sessão. Não duplica os docs profundos — **aponta** pra eles. Atualize quando uma regra, comando, módulo ou hurdle mudar.
>
> **Última revisão:** 2026-09-22
> **Estado/decisões:** [.planning/STATE.md](.planning/STATE.md) · **Análise da plataforma (fase final TCC 2):** [.planning/research/2026-09-22-analise-plataforma.md](.planning/research/2026-09-22-analise-plataforma.md)

---

## 1. O que é

TCC 2026 — **roteamento preditivo para Brasília/DF**. Um coletor puxou TomTom Traffic Flow pro Supabase desde 2026-04-27 (~630 pontos, de 8 em 8 min). O modelo **LIA** (XGBoost) prevê a razão de congestionamento (vel. atual / vel. livre, 0,05–1,0). A API FastAPI roteia com A* num grafo OSMnx de 38 km. O app Expo (mobile + web) é a visão do usuário. Equipe: G2Martins + Pedro Borges (ver README).

**Fase final:** plataforma para o usuário (uso e histórico de rotas) + **visão ADM** (data quality, buscas, erros, modelo — observabilidade). A coleta contínua será **parada**; o TomTom passa a ser chamado sob demanda, com rotação automática de chaves. Cliente é **hostil até prova em contrário** (§4).

## 2. Stack + Comandos

Python (API/Coletor/Treino) · FastAPI 0.136 · XGBoost 3.2 · OSMnx 1.9.3 · supabase-py 2.13 · Expo SDK 54 / RN 0.81 / React 19.1 / react-native-web · Supabase (Postgres + Auth + RLS). Ainda **sem** monorepo JS (npm no FrontEnd), **sem** testes e **sem** lint.

```bash
cd BackEnd/API && uvicorn main:app --reload --host 0.0.0.0 --port 8000   # API (carrega modelo + grafo no startup)
cd BackEnd/Servidor && python main.py                                     # coletor TomTom (8 min) — será pausado
cd BackEnd/Treinamento_IA && python train.py --version lia_2.1 --skip-silver   # treino (sem --skip-silver puxa do Supabase)
cd FrontEnd && npm run web                                                # ou android | ios
```

## 3. Mapa de módulos

`(tcc2)` = veio da branch do Pedro; integrado ao `main` em 2026-09-22 (`0e066fb`, ver §6).

| Módulo | O quê | Doc |
|---|---|---|
| [BackEnd/API/](BackEnd/API/) | `GET /health`, `GET /metrics`, `POST /predict`, `POST /route` (A* por `travel_time_lia` + baseline de menor distância), `GET /search/places` (autocomplete: `malha_completa` ILIKE → Nominatim se < 3 resultados). (tcc2) `recencia_cache.py` (TTL 300 s, últimas 2000 linhas de `historico_trafego`), `graph_enrichment.py` (BallTree, transfer ≤ 500 m), `lia_inference.py`; confiança calibrada em runtime = `transfer_confidence_isotonic.pkl` | [README](BackEnd/API/README.md) |
| [BackEnd/Servidor/](BackEnd/Servidor/) | Coletor TomTom Flow Segment Data v4 → `historico_trafego`; bootstrap de `malha_completa`/`vias_monitoradas`; rotação de chaves. (tcc2) job Fase 3 4×/dia + `deploy/` (systemd) | [README](BackEnd/Servidor/README.md) |
| [BackEnd/Treinamento_IA/](BackEnd/Treinamento_IA/) | `silver.py` (Supabase → parquet, **único** acesso ao banco) → `features.py` → `train.py` (TimeSeriesSplit, 5 folds). (tcc2) `otimizar_hiperparametros.py` (Optuna), `calibrar_transfer.py`, `benchmark_lstm_xgboost.py`, `validar_fase3.py`. Artefatos em `models/` (`.pkl` gitignored, `.json` versionado) | [README](BackEnd/Treinamento_IA/README.md) |
| [BackEnd/sql/](BackEnd/sql/) | Única DDL versionada: `001_route_history.sql` (`route_history`, `profiles`, trigger `handle_new_user`), (tcc2) `002_validacao_tese.sql` | — |
| [FrontEnd/](FrontEnd/) | Expo: Login/Register → abas Mapa/Painel/Histórico/Perfil (EditProfile, Privacy); na web desktop usa `SideRail`. Auth, `profiles` e `route_history` vão **direto no Supabase**; rotas vão pela API (`EXPO_PUBLIC_API_URL`). Mapas: `react-native-maps` (nativo) / `leaflet` (web). Tema claro/escuro via `ThemeContext` | [README](FrontEnd/README.md) |

**Tabelas Supabase** (projeto `vwbnragsacjxxulxenvg`):

| Tabela | Conteúdo | Escreve → Lê |
|---|---|---|
| `historico_trafego` | séries TomTom — **dataset do TCC** | coletor → cache da API, `silver.py` |
| `vias_monitoradas` | ~630 pontos monitorados | coletor (1×) → coletor, startup da API |
| `malha_completa` | ~38 mil vias do DF | coletor (1×) → autocomplete |
| `route_history` | rotas do usuário + colunas de validação | FrontEnd (RLS por dono) |
| `profiles` | nome, avatar, tema | trigger + FrontEnd (RLS por dono) |

⚠️ As 3 primeiras **não têm DDL nem RLS no repo** (§5).

## 4. Regras SEMPRE-ATIVAS

- **Regra zero — nunca confiar no frontend.** Validação, RBAC, rate-limit e ownership ficam no servidor (API ou RLS). O front só esconde botão.
- **Defesa em profundidade** — 2+ camadas: Pydantic estrito (`extra="forbid"`) + JWT Supabase verificado na API + RLS + rate-limit + audit-log.
- **O dataset do TCC é sagrado.** `historico_trafego`, `vias_monitoradas` e `malha_completa` são a base da tese. Zero DELETE/TRUNCATE/DROP/UPDATE em massa sem backup + OK explícito. O MCP Supabase fica em `read_only=true` por padrão (§6).
- **LGPD** — origem/destino do usuário é dado pessoal de localização. Exige consentimento (tela Privacy) e retenção definida. Analytics do ADM usa coordenadas arredondadas/agregadas; nunca exportar a trilha individual de alguém.
- **Número da tese vem de artefato versionado.** Toda métrica citada no texto aponta pra um `models/*.json` (chave exata). Nada de número digitado à mão.
- **Testes junto com a lógica** — pytest pra API, rotação de chaves e features; teste com DB real (projeto/branch de teste), sem mock de banco. Endpoint sensível ganha teste de segurança (IDOR, mass-assignment, rate-limit).
- **Docs vivas** — README por módulo + `Docs/`, com `**Última revisão:** YYYY-MM-DD` no topo. Mudou comportamento → atualiza a doc no mesmo PR. Código ≠ doc → corrige a doc primeiro.
- **GSD** — discuss → plan → execute → verify. `.planning/STATE.md` atualizado ao fechar cada etapa.
- **Design** — segue a linguagem do Valerium: tokens HSL, paleta monocromática, zero hex literal em componente, gráficos com tokens `--chart-*`. Ref. (outra org, só leitura): `G:\1. Projetos\6. Grovic Data\Valerium-Portal\packages\ui\src\globals.css`, `Docs/core/design-system.md` de lá e `Grovic-Components/`.
- **Segredos** — nunca commitar. `.env`, `tomtom_keys.json` e `.mcp.json` estão no gitignore; exemplos ficam em `*.example`. Nunca logar chave TomTom (logar só o id).
- **Caveman full + Ponytail full sempre** (plugins globais já ativos).
- **Commits sem co-author** — NUNCA adicionar `Co-Authored-By: Claude…` (nem trailer de atribuição ao assistente). Mensagem de commit = só conteúdo técnico.

## 5. Segurança — estado atual (dívida conhecida; resolver antes de deploy público)

- A API **não tem auth**, e o CORS usa `allow_origins=["*"]` + `allow_credentials=True` (combinação inválida pela spec) em [BackEnd/API/main.py](BackEnd/API/main.py). Não há rate-limit.
- `route_history` é 100% escrito pelo cliente, então os dados de validação da tese são corrompíveis. Alvo: a API persiste (service role) e o cliente só lê e dá feedback.
- O RLS das 3 tabelas de tráfego não está versionado, e o app usa anon key pública. Se o RLS estiver desligado, qualquer um lê/apaga o dataset via PostgREST. **Verificar primeiro** quando o MCP conectar.
- O papel ADM nunca pode ficar em coluna que o próprio usuário edita (`profiles` tem update pelo dono). Usar `app_metadata.role` (só o service role grava; já vem no JWT) + checagem na API e nas policies.

## 6. Common Hurdles

- **Supabase do Routify = `vwbnragsacjxxulxenvg` — conferir o ref antes de conectar.** O `.mcp.json` original veio copiado de um projeto de outra organização, apontando pro banco dela (e era JSON inválido); corrigido em 2026-09-22. **Repo público:** não commitar ref, domínio ou token de infra de outra org.
- **MCP Supabase** = remoto HTTP + OAuth (`/mcp` → autenticar com a conta que tem acesso ao projeto), em `read_only=true`. Pra aplicar migration: tirar `read_only=true` da URL, reconectar, aplicar um arquivo versionado de `BackEnd/sql/` e voltar ao read-only. Nada de SQL fora de arquivo versionado.
- **A branch `tcc2` (Pedro) era ÓRFÃ** — o commit raiz `aefb465` não tinha pai. Foi integrada em 2026-09-22 com enxerto temporário (`git replace --graft aefb465 66d30c0` → merge → `git replace -d`) no commit `0e066fb`, e agora o merge-base é `65b387a`. Commits novos do Pedro na `tcc2` mesclam normalmente. Nunca usar `--allow-unrelated-histories` (vira add/add em tudo). Regra pro time: branch nova sempre a partir de `main` atualizado, nunca de snapshot.
- **`.gitignore` do tcc2 ignora `*.md` exceto README** (notas internas ficam fora do repo). Exceções mantidas: `CLAUDE.md`, `Docs/**/*.md`, `.planning/**/*.md`. Doc viva nova em outra pasta precisa de exceção.
- **`FrontEnd/src/lib/` sumia do git.** O `.gitignore` antigo tinha `lib/` (template Python) e engolia `api.ts`/`supabase.ts`/`responsive.ts`. Corrigido em `75c92d8` (`BackEnd/**/lib/`). O snapshot tcc2 não tem a pasta, então não builda sozinho; o tipo `RouteHistoryRow` do main não tem as colunas novas de validação.
- **Rotação de chaves TomTom (coletor):** o mesmo bug foi corrigido 2× em paralelo (main `d0fb247` × tcc2). No merge ficou a implementação do main: cooldown graduado (QPS 300 s, 403 desconhecido 600 s), `requests.Session` com retry e guard anti-sobreposição `coleta_protegida`. A cota esgotada usa a **janela rolante de 24 h** do Pedro (`SECONDS_PER_DAY`), porque o reset não está confirmado. Ao reaproveitar na API: extrair um módulo compartilhado, não copiar.
- **Cota free da TomTom: diária ou mensal? NÃO verificado.** A página de pricing indica cota mensal por API; fontes antigas dizem 2.500/dia. Isso muda o cooldown em ~30×. Confirmar no dashboard my.tomtom.com antes de dimensionar.
- **ToS TomTom §14.2** — criar contas extras pra obter requisições grátis adicionais autoriza suspensão. O pool de chaves é um risco; documentar como limitação na tese.
- **Flow Segment Data só existe na API Genesis v1** (`/traffic/services/4/flowSegmentData`). O traffic flow do Orbis v2 é só tiles. Incidents, Routing e Search já têm versão Orbis.
- **O `Dockerfile` da API usa `LIA_VERSION=lia_1.0` como default** (o default do `main.py` é `lia_2.1`), então um deploy sobe o modelo velho em silêncio. Corrigir antes de deployar.
- **Métricas pros gráficos da banca:**
  - A LIA 2.0 não tem CV persistido (proxy: `benchmark_lstm_vs_xgboost.json` → `xgboost.*`).
  - O `cv` da LIA 2.1 é anterior aos hiperparâmetros Optuna adotados, então re-rodar `train.py` antes dos números finais.
  - O "Erro médio" do resumo técnico (74,7 / 51,3 / 40,7 s) é **RMSE**, não MAE (MAE = 50,8 / 18,6 / 14,6).
- **Em runtime, a confiança do transfer vem de `transfer_confidence_isotonic.pkl`**, não do `.json` (que é só a saída legível). Sem o pkl, cai no fallback em degrau 1,0/0,8/0,6 (`route.py`).
- **O job Fase 3** (`validar_fase3.py`, 07/12/18/22 h) usa o horário do processo, então o host precisa de `TZ=America/Sao_Paulo`. Pico de ~1,4 GB de RAM por execução.
- **Hospedagem (decidido 2026-09-22: dividir).** O plano Hostinger Business roda Node.js via Passenger, **sem Python**.
  - **Hostinger:** front web estático (Expo export) + admin Next.js.
  - **API FastAPI:** em host grátis com RAM suficiente. O grafo de 38 km + o modelo chegam a ~1,4 GB de pico, e o **Render grátis tem só 512 MB**: só serve com o grafo enxugado. O Hugging Face Spaces (16 GB) é o candidato. Medir o RSS real da API antes de escolher.
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
- **READMEs** → [README.md](README.md) · [BackEnd/README.md](BackEnd/README.md) · [API](BackEnd/API/README.md) · [Servidor](BackEnd/Servidor/README.md) · [Treinamento_IA](BackEnd/Treinamento_IA/README.md) · [FrontEnd](FrontEnd/README.md)
- **Plano de trabalho do TCC** → [Docs/](Docs/) (PDFs)
- **Referências de padrão** (outra org, só leitura): `Valerium-Portal` (design/auth/deploy), `GrovOps` (observabilidade), `tpotce-TCC` (painel admin / data quality)
- **Memória cross-sessão** (auto-injetada) → `~/.claude/projects/.../memory/MEMORY.md`
