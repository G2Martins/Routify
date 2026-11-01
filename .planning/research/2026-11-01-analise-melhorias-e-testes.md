# Análise — melhorias, estratégia de testes e coleta na AWS

**Última revisão:** 2026-11-01 · Base: `main` em `4351f4f`, produção viva (API/front), Supabase do projeto (só leitura), pricing da TomTom, 4 revisões delegadas por área (API/segurança, ML, front, banco/CI). Decisões registradas em [STATE.md](../STATE.md); procedimento de deploy e de acesso à AWS em [docs/core/deploy.md](../../docs/core/deploy.md).

## 1. Resumo executivo

1. **O dataset enxerga pouco do dia.** 1,51 M linhas entre 2026-03-07 e 2026-07-19, mas na mediana cada dia tem só **4 ciclos** (≈ 2.560 linhas) logo depois de 00:00 UTC; **13 dias "cheios" concentram 68,5% das linhas**, a hora 21h (Brasília) tem 23% e o fim de semana tem 21% do volume de um dia útil (`ml/artifacts/cobertura_dataset.json`). Isso ajuda a explicar a subestimativa diurna vista na Fase 3 (682 s × 1.136 s da TomTom) e é a razão técnica para **voltar a coletar** — com cadência que respeite a cota.
2. **Coleta volta na própria EC2, custo zero, 1 ciclo a cada 43 min.** A cota free da TomTom é mensal e por API (Flow 20 mil). 39 chaves × 20 mil × 85% / 31 dias / 630 pontos → 43 min, ~21 mil chamadas/dia, ~33 observações por ponto por dia **em todas as horas**. Código, 17 testes, unidade systemd e instalador prontos; **deploy bloqueado** porque o security group só libera o IP antigo do dono (seção 5).
3. **Vazamento real corrigido:** o `httpx` registrava em INFO a URL completa das chamadas à TomTom (`?key=…&point=lat,lon`) — chave no log e coordenada do usuário. Silenciado em `tomtom.py`, com teste de regressão; uvicorn sem access log; journal antigo da EC2 deve ser limpo.
4. **Maior risco à tese hoje:** `route_history` é escrito pelo cliente sem restrição de coluna (um usuário logado grava `tempo_real_seg`/`eta_google_seg` falsos ou milhares de linhas) e **não há backup do dataset** fora do Supabase free. Dois itens de 1–2 h cada.
5. **`/route` trava o event loop** (1,1–2,1 s de CPU por rota, medido): 2–3 IPs no limite congelam `/health` e `/search`. Cache dos pesos por (hora, dia) resolve.
6. **Risco de banca: o baseline da tese é fraco.** Reproduzindo o CV do repo (mesmos 5 folds), a **persistência** (prever `razao_lag1`, a última leitura da via) dá RMSE 39,96 s e MAE 12,04 s, contra 40,88 / 14,51 s da LIA 2.1 reportada; o "−28,8 %" é contra o perfil histórico (57,17 s). Além disso o `early_stopping` roda sobre o fold de validação (CV otimista): a receita de produção (600 árvores) dá 41,64 s. Com perfis fora da amostra (OOF) e recência envelhecida no treino, a LIA vai a 38,08 s e passa a ganhar da persistência também quando a leitura é velha (≥ 1 h: 54–58 s contra 89–148 s). Detalhes e artefatos propostos na seção 3.3; **números ainda não versionados** (scripts no scratchpad da sessão) — por isso não entram no texto da tese antes de virarem JSON.
7. Testes: API tem 63 (bons em geometria, pool, busca), **zero via HTTP**, zero no `ml/`, zero no front; coletor tinha zero → 17. Plano por camada na seção 4, com nomes e o que cada um afirma.
8. Acesso do parceiro à AWS: **usuário IAM + MFA obrigatória + política mínima + Session Manager**. Nunca Organizations/Identity Center (converte a conta Free em paga). Passo a passo em `deploy.md` §5.

## 2. Evidência: cobertura temporal do dataset

Fonte: `ml/dataset_coverage.py` sobre `silver_20260922.parquet` (= `historico_trafego`, 1.513.824 linhas, conferido com `count(*)` no banco).

| Métrica | Valor | Chave no JSON |
|---|---|---|
| Período | 2026-03-07 19:16 → 2026-07-19 21:33 (Brasília) | `periodo_inicio`, `periodo_fim` |
| Dias com coleta / calendário | 134 / 135 | `dias_com_coleta`, `dias_calendario` |
| Dias cheios (≥ 50 mil linhas) | 13 | `n_dias_cheios`, `dias_cheios` |
| Linhas vindas dos dias cheios | 68,5 % | `pct_linhas_em_dias_cheios` |
| Mediana de linhas por dia | 2.561 (≈ 4 ciclos de 630) | `mediana_linhas_dia`, `ciclos_por_dia_mediana` |
| Hora mais coberta | 21h (Brasília) = 23,3 % das linhas | `hora_mais_coberta`, `pct_hora_mais_coberta` |
| Fim de semana / dia útil | 0,21 | `razao_fim_de_semana_vs_dia_util` |

**Mecanismo provável.** Nos dias normais o pool rendia ~2.520 chamadas por dia, sempre entre 00:00 e 00:35 UTC (21h–21h35 em Brasília), e depois nada até o próximo reset — compatível com um limite diário por **conta** (não por chave) no modelo antigo da TomTom. Os dias cheios coincidem com dias em que o pool foi renovado. Hoje a página de preços fala em cota **mensal por API** e as 39 chaves respondem 200; o coletor novo assume 20 mil/mês por chave e deixa 15% de folga.

**Consequência para o modelo.** A LIA aprende o perfil por (ponto, hora, dia da semana) principalmente a partir de 13 dias — 10 deles de segunda a sexta. Picos de terça/quinta, sábados e domingos têm pouquíssimo suporte. Isso não invalida as métricas de CV (os folds são temporais e sofrem do mesmo viés), mas limita a generalização e precisa constar como limitação (`docs/tcc/resultados-e-limitacoes.md` §6).

**Projeção com a coleta nova.** 33 ciclos/dia × 630 pontos × 45 dias (até 15/12) ≈ **935 mil linhas uniformes no dia e na semana** — material para uma LIA 2.3 comparada à 2.2 nos mesmos folds (decisão aberta nº 2 do STATE).

## 3. Melhorias priorizadas

Severidade: **A** alta · M média · B baixa. "Feito" = nesta sessão.

### 3.1 API — segurança e confiabilidade

| # | Sev | Achado (evidência) | Correção | Estado |
|---|---|---|---|---|
| 1 | A | Chave TomTom e coordenadas no log INFO via `httpx` (`apps/api/tomtom.py`, `main.py:41-44`); access log do uvicorn grava `?q=&lat=&lon=` + IP | `httpx`/`httpcore` em WARNING; `--no-access-log`; `journalctl --vacuum` na EC2 | **Feito** (teste `test_log_info_nao_contem_chave_nem_url`) |
| 2 | A | `/route` faz pesos da LIA (loop em 233 mil arestas + predict) e dois A\* sem `await` — 1,1–2,1 s de CPU por rota (`routers/route.py:553,651-688`) | Cache dos pesos por (hora, dia, versão da recência); cálculo em thread **sem** gravar no grafo compartilhado | Backlog, 0,5 dia |
| 3 | M | Cota TomTom queimável por anônimo: orçamento só por minuto (120/min ≈ 172 mil/dia), `/search` com textos únicos fura o cache, `Coordenada` aceita o planeta inteiro (`tomtom.py:51-53`, `route.py:37-38`) | Teto diário por serviço; anônimo só LIA + cache; caixa DF + Entorno em `Coordenada` | Backlog, 2 h |
| 4 | M | `/eventos` e `/admin/*` validam o JWT no GoTrue **antes** de qualquer limite: tokens aleatórios ocupam as 6 threads do executor (`routers/eventos.py:66`, `seguranca.py:69-80`) | `limitar(_limite_ip, ip_cliente(request))` antes de `get_user` | Backlog, 30 min + teste |
| 5 | M | Toda requisição (até 404/429) vira INSERT em `api_requisicoes` por `run_in_executor` sem teto (`main.py:383-411`, `usage.py:184-191`) | Não registrar 404/405/429; executor próprio com fila limitada | Backlog, 1 h |
| 6 | M | Sem limite de corpo: 422 devolvia os 5 MB enviados; 200 MB estouram o `MemoryMax` | Caddy `request_body max_size 64KB` | **Feito** (`provisionar-ec2.sh`) |
| 7 | M | Supabase síncrono dentro do handler async, timeout padrão 120 s (`route.py:577`, `predict.py:121`, `recency_cache.py`) | `asyncio.to_thread` + `postgrest_client_timeout=5` | Backlog, 1 h |
| 8 | B | `/predict` sem limite por IP, aceita NaN (→ 500) e `1e308`; offset de fuso não convertido | `allow_inf_nan=False`, `le=`, `.astimezone(BRASILIA_TZ)` | Backlog, 1 h |
| 9 | B | Heurística do A\* assume 108 km/h; 76 arestas têm 110 km/h → rota até ~2 % subótima, e a tese afirma ótima (`route.py:659`) | `vmax = max(speed_kph)` na subida + teste de admissibilidade | Backlog, 30 min |
| 10 | B | `/health` sempre "ok": não mostra LIA sem vínculo, Supabase ausente, recência velha, pool vazio | Campo `degradado` com motivos | Backlog, 1 h |
| 11 | B | `TRUST_PROXY=1` pega o 1º item do `X-Forwarded-For`: seguro só porque o Caddy descarta o header do cliente; atrás de ALB/CDN vira forjável | `TRUST_PROXY=0` (uvicorn já resolve pelo `127.0.0.1`) ou pegar o último item | Backlog, 10 min |
| 12 | B | `auditar()` da API passa por `usage.registrar`: `REGISTRAR_USO=0` desliga a auditoria junto | Caminho próprio | Backlog, 20 min |

Confirmado como correto: JWT validado no GoTrue (sem `alg=none`), CORS por allowlist, `extra="forbid"` em todos os corpos, `user_id` sempre do token (sem IDOR), hosts externos fixos (sem SSRF), `ilike` só com `[^\W_]`.

### 3.2 Banco, dados e LGPD

| # | Sev | Achado | Correção | Esforço |
|---|---|---|---|---|
| 13 | A | `route_history`: INSERT sem restrição de coluna nem tamanho (só o UPDATE foi travado em `20260923000000_security_hardening.sql:21-22`). Usuário grava `tempo_real_seg`/`feedback_em`/`eta_google_seg` prontos (corrompe a validação da tese) ou milhares de linhas com `polyline` gigante (estoura os 500 MB do free). `DELETE`+`INSERT` contorna o trigger de feedback único | `revoke insert` + `grant insert (colunas legítimas)`; CHECK em tamanho de `polyline`/rótulos e faixa dos tempos. Alvo final: a API persiste e o cliente só lê | 1–2 h |
| 14 | A | **Sem backup do dataset** (Supabase free não tem; só parquets locais) | Action semanal: `pg_dump` das 3 tabelas → cifrado (`age`) → R2/B2/Drive. Repo é público: nunca artifact | 2 h |
| 15 | M | `anon` mantém todos os grants em `route_history`/`profiles`: RLS é a única barreira (regra "2+ camadas") | `revoke all … from anon`; `revoke truncate,references,trigger … from authenticated` | 20 min |
| 16 | M | `is_admin()` lê só o JWT: admin rebaixado/banido segue admin no banco até o `exp` (≤ 1 h); API enxerga a revogação, banco não | Em `_admin_acao`, reconferir `auth.users` (role e `banned_until`); opcional exigir `aal2` | 1 h |
| 17 | M | Append-only de `admin_auditoria` e do dataset é só `REVOKE` (`20260923020000_admin_actions.sql:31`); um `GRANT ALL` pelo dashboard desfaz | Trigger `BEFORE UPDATE OR DELETE OR TRUNCATE … raise exception` (com flag de sessão para manutenção) | 30 min |
| 18 | M | Painel lê `rotas_calculadas`/`api_requisicoes` com `select('*')` (`apps/admin/.../uso/page.tsx:58-60`): `user_id` + origem/destino a 110 m + hora = trilha individual, contra a promessa LGPD; `admin_exportar_dados` entrega coordenadas exatas | Listas sem `user_id`; export pelo próprio titular (RPC com `auth.uid()`) | 2 h |
| 19 | M | `route_history` sem retenção (coordenadas exatas e polyline para sempre); Privacy diz "nunca o ponto exato" (vale só para `rotas_calculadas`) | Job `pg_cron` que arredonda coordenadas e anula polyline/rótulos após 90 d; corrigir o texto da Privacy | 1 h |
| 20 | B | `avisos_app` entrega `criado_por` (uuid do admin) ao anônimo | `grant select (id, mensagem, nivel, inicio, fim)` | 10 min |
| 21 | B | As 3 tabelas do dataset **não têm DDL no repo**; `supabase db reset`/branch/CI falham | `supabase db dump --schema public` → `supabase/migrations/20260101000000_baseline_dataset.sql` (só as 3 tabelas) + `migration repair` | 1 h |
| 22 | B | Reaplicar a cadeia de migrations 2× falha (OUT params de `admin_usuarios`/`admin_validacao_feedback`, erro 42P13) | `drop function if exists` antes do `create` | 20 min |

### 3.3 ML e texto da tese

A revisão reproduziu o pipeline fora do repo e bateu o metadata (baseline 57,17/17,25; LIA 2.1 40,88/14,51). O que não está limpo é **metodologia de avaliação**, não vazamento de feature: `razao_lag1` é `shift(1)` por via, vizinhos/chuva são causais (`merge_asof` backward), `id_ponto_enc` é label encoding sem alvo, `velocidade_livre` é a `freeFlowSpeed` da TomTom. 82,7 % dos alvos são exatamente 1,0 (fluxo livre).

| # | Sev | Achado (evidência) | Correção | Esforço |
|---|---|---|---|---|
| 23 | A | **Baseline fraco.** Persistência (`razao_lag1`) = 39,96 s RMSE / 12,04 s MAE nos mesmos 5 folds; blend 50/50 = 40,19 / 13,25. A LIA 2.1 reportada = 40,88 / 14,51. O ganho da LIA aparece só quando a leitura envelhece (idade 60 min: perfil 64,1, persistência 89,0, LIA 58,4 s) | Pôr persistência e blend em `train.py::evaluate_cv` e no metadata; reportar a curva **erro × idade da informação** (`lia_idade_informacao.json`) — é o argumento da LIA | alto / P |
| 24 | A | **Early stopping no fold de validação** (`train.py:53,164`; também `context_stress_test.py:79`, `benchmark_lstm_xgboost.py:189`): `best_iteration` 63–242, mas o modelo final usa 600 árvores. Receita de produção: 41,64 s (fold 1: +1,94 s) | Tirar o ES da validação (ou validação interna), regerar JSONs e figuras; reportar o número da receita que vai pra produção | alto / P |
| 25 | A | **Perfis in-sample** (`train.py:154-155,235-238`): corr(perfil, alvo) 0,86–0,90 no treino × 0,78–0,81 na validação → modelo desalinhado. Com perfis OOF (8 blocos de datas) + recência envelhecida em 50 % das linhas (15–480 min): **38,08 s fresco** e −5 a −9 % sobre o perfil com leitura velha | Implementar em `features.py:262-328`; **confirmar em holdout intocado** (medido nos mesmos folds) | alto / M |
| 26 | A | Sem holdout: ES, Optuna (`tune_hyperparams.py:82`), hiperparâmetros e features foram escolhidos no mesmo CV; sem `gap` no `TimeSeriesSplit`; fold 1 treina com 6 datas | Holdout final = últimas ~15 % das datas; tuning aninhado; `gap=1 dia` (variação esperada ≤ ruído de semente, ±0,28 s) | alto / P |
| 27 | A | Cobertura temporal enviesada (seção 2): 13 dias cheios, células de pico com 2–11 datas, 6 de 168 células hora×dow vazias | Declarar em §6 das limitações (**feito**, com `cobertura_dataset.json`); coletar; LIA 2.3 em dez/2026 | artefato feito |
| 28 | M | Viés da rota: LIA 29–39 % abaixo da TomTom na Fase 3 (100 % das rodadas; IC [−40,0; −37,8]) — vem da velocidade livre OSM × TomTom por classe de via (`route.py:334,344-347`), não do erro por trecho | Calibrar `speed_kph` → velocidade livre TomTom por classe de via; recalibrar δ depois | alto / M |
| 29 | M | Isotônica do transfer mede similaridade de perfis, não erro de previsão; piso e teto são grandezas distintas (`calibrate_transfer.py:162-173`); `route.py:376` encolhe para 1,0 mas c=0 foi definido como `perfil_hora_dow`; texto diz "~600 m", a curva só estabiliza em ~800 m (0,58 em 600 m) | `validate_transfer.py` leave-one-point-out (c(d) × c=1 × c=0); encolher para `razao_global`; corrigir §4 do texto | médio-alto / M |
| 30 | M | Sem IC nem sementes: `ddof=0` (`train.py:190`), 1 semente; 2.1 × 2.2 com 5 folds nunca passa de p = 0,0625 no Wilcoxon. Reteste 3 sementes × 5 folds: 2.2 melhor em 14/15 pares, −0,60 s RMSE (ruído 0,28 s) | Bootstrap por dia, `ddof=1`, ≥ 3 sementes no metadata | médio / P |
| 31 | M | Linhagem incompleta no metadata: falta sha256 do silver, versões das libs, git SHA, `device` (GPU × CPU muda o resultado), datas/n/`best_iteration` por fold; `features.run` sobrescreve `{versão}_metadata.json` e o encoder (provável causa do CV perdido da 2.0) | Gravar linhagem em `train.py:300-312`; `features.run` sem efeito colateral | médio / P |
| 32 | M | Zero testes no `ml/` (`context_stress_test.py` é script sem assert; o autoteste de `contexto.py` fica fora do pytest). Nada compara features ou predição treino × API; `LIA_FEATURE_ORDER` e `lookup_perfis` duplicam `features.py` | `ml/tests/` (seção 4.4 P1) + `test_paridade_treino` em `apps/api/tests` | alto / M |
| 33 | M | Erro por hora/dow/ponto/decil de comprimento e curva de aprendizado não existem. Pico (06–09, 17–20 h) = 24,5 % das linhas e ~60 % do erro quadrático; às 17–20 h a LIA erra 73,0 s contra 55,8 da persistência | `curva_aprendizado.py` (treina com 10–100 % das **datas**, 3 sementes, holdout fixo, deriva março → meses) → `curva_aprendizado.json`; regra: RMSE cai > 2 % ao dobrar as datas ⇒ coleta vale; `erro_estratificado.json` | médio-alto / M |
| 34 | B | Docs desalinhadas: `hiperparametros_otimizados.json` diz "Adotar" e a tese diz não adotado; `ml/README.md` fala "sem lags" mas há `razao_lag1`; `resultados-e-limitacoes.md` cita 2.1 e a API serve 2.2 | Corrigir textos; nota 2.2 = 2.1 + contexto, 40,88 → 40,27 s (5/5 folds) | 30 min |

**Perguntas prováveis da banca → artefato que responde:** "e a persistência?" (item 23) · "sem leitura recente?" (curva de idade) · "ES e tuning no mesmo CV?" (holdout, item 26) · "generaliza a vias não monitoradas?" (CV por grupo de ponto + `validate_transfer`) · "erro por rota/km/hora?" (`erro_estratificado.json`) · "por que a rota sai 30–40 % abaixo da TomTom?" (item 28) · "deriva?" (treinar março, testar por mês).

**Coleta estratificada (opção).** Em vez de 43 min uniformes, concentrar em seg–sex 06–09 e 17–20 h + fins de semana (≈ 580 mil req/mês ≈ 29 chaves) ataca onde está 60 % do erro. Fica como opção: a uniforme corrige o viés de cobertura e é mais simples de defender; mudar depois que `curva_aprendizado.json` existir.

### 3.4 Front (app Expo + painel Next)

| # | Sev | Achado | Correção | Esforço |
|---|---|---|---|---|
| 27 | A | Sem GPS, a geolocalização cai em 4 serviços de IP de terceiros, sozinha, 800 ms depois de abrir o Mapa (`MapComponent.web.tsx:222-251`) — contradiz a Privacy | Apagar a cadeia; centro em Brasília; tirar do `connect-src` | 15 min |
| 28 | M | Cookie de sessão sem `Secure`, 400 dias (`lib/supabase.ts:21`, admin `supabase-navegador.ts:5`, `proxy.ts:19`) | `cookieOptions: {secure, maxAge: 604800}` nos 4 clientes | 15 min |
| 29 | M | "Esqueci a senha" não fecha: sem tela de nova senha nem `updateUser` (`LoginScreen.tsx:358-375`) | Tela NovaSenha + `auth.updateUser({password})` + "alterar senha" no Perfil | 2–3 h |
| 30 | M | CSP só Report-Only sem `report-uri`; `script-src 'unsafe-inline'`; CSS/imagens do jsDelivr sem SRI (`next.config.ts:34,57`, `MapComponent.web.tsx:29`) | `CSP_ENFORCE=1` no empacotador; Leaflet CSS local; `report-uri` | 2–3 h |
| 31 | M | LGPD self-service: aceite não é persistido (data/versão), sem "apagar meus dados"/excluir conta, e-mail de contato ausente | RPC `auth.uid()` para apagar; aceite em `profiles`; contato e prazo na Privacy | 0,5 dia |
| 32 | M | `proxy.ts` do painel só exige login; a role é checada por página (`exigirAdmin()`); página nova que esqueça fica só com RLS | Checar `app_metadata.role` no proxy; `cache()` em `exigirAdmin` | 1 h |
| 33 | B | Bundle: 4,1 MB em 19 TTFs do `@expo/vector-icons` carregados na web onde só o Iconify renderiza; logo de 733 kB; deps mortas | `Icon.web.tsx`/`Icon.native.tsx`; logo otimizado | 1–2 h |
| 34 | B | Contraste AA falha em `textSubtle` (2,99), `teal` (2,18), `warning`, `success` (`Theme.ts:120,131,149,152`) | Tokens propostos: `#657289`, `#9A5B00`, `#067A66` | 1 h |
| 35 | B | 15 `any`, `RouteHistoryRow` defasada (faltam 5 colunas), `fmtDuracao(659.6)` → "10 min 60 s" | `supabase gen types`; corrigir arredondamento | 2 h |

### 3.5 Infra, CI/CD e operação

| # | Sev | Achado | Correção | Esforço |
|---|---|---|---|---|
| 36 | A | Nenhum teste de migration/RLS automatizado; regressões das seções 3.2 passariam | Job `db` no CI: `supabase start` + `db reset` + pgTAP ("anon não lê `historico_trafego`", "A não lê `route_history` de B", "não-admin não executa `admin_*`") | 0,5 dia (depende do item 21) |
| 37 | M | CI instala deps ad hoc (Python 3.11, sem `requirements.txt`), prod é 3.12 / Node 22; `importorskip` pula testes em silêncio; sem cobertura, sem `pip-audit`/`npm audit`, sem lint | Instalar `requirements.txt` com cache; `pytest-cov --cov-fail-under`; `pip-audit`; `ruff` seleção mínima; Node 22 | 2 h |
| 38 | M | Sem deploy contínuo (STATE desde 09/2026); `npm`/`next build` rodam na EC2 ao lado do `.env` com service_role | `deploy.yml` com `workflow_dispatch`: front no runner → Hostinger CLI; API por OIDC + `aws ssm send-command` (sem porta 22 para o GitHub) | 0,5 dia |
| 39 | M | `provisionar-ec2.sh`: `Restart=always` sem `StartLimit*`; `chown -R routify` dá ao serviço a posse do código; `scp` como descrito não funciona (pasta 700) | `StartLimit*` (**feito**); doc do `scp` via `/tmp` + `install` (**feito**); código em root e só `ml/artifacts` gravável (backlog) | 30 min |
| 40 | B | `supabase-keepalive.yml` batia em `vias_monitoradas` (agora 401/403) e aceitava < 500 | `avisos_app?select=id&limit=1` e exigir 200 | **Feito** |
| 41 | B | Sem alarme de `CPUCreditBalance` (t3.small Standard cai para 20 % de CPU quando o crédito acaba) | Alarme CloudWatch gratuito | 15 min |
| 42 | B | `Dockerfile` não é usado e roda como root | Apagar ou `USER` + build no CI | 15 min |

## 4. Estratégia de testes

### 4.1 Princípios (por que assim)

1. **Teste junto da lógica, com rede e banco simulados por padrão** (CLAUDE.md §4). Determinismo e velocidade: a suíte da API roda em 6 s; a do coletor em 0,2 s. O HTTP externo entra por `httpx.MockTransport` (API) ou `session.get` substituído (coletor) — nunca `requests` de verdade.
2. **Pirâmide, não tabela.** Muitos unitários nas funções puras (ranking, fusão de tempos, cadência, geometria), alguns de integração via `TestClient` (middleware, 422/429/401/403 **reais**), poucos ponta a ponta (login → rota) e 1 de carga leve. Hoje a pirâmide não tem base no `ml/` e no front e não tem meio (zero teste via HTTP).
3. **Cliente hostil → suíte de segurança separada e nomeada** (`apps/api/tests/security/`): cada endpoint sensível tem IDOR, mass-assignment, rate-limit, payload fora da faixa e token inválido. O que não tem teste de segurança regride em silêncio (o item 1 da seção 3.1 só não foi pego porque o teste existente olhava WARNING).
4. **Número da tese é contrato.** Todo valor citado no texto vem de um `.json` versionado; um teste lê o `.md` e confere contra os JSON (`cv.modelo_rmse_seg`, `pct_linhas_em_dias_cheios`, …). Falha = texto desatualizado.
5. **Banco real sem mock, mas nunca o de produção:** migrations e RLS em Postgres efêmero (`supabase start` no CI) ou branch do Supabase; o dataset é sagrado.
6. **Propriedades em vez de exemplos** onde há invariante físico: razão em [0,05; 1,0], tempo ≥ comprimento/vmax, heurística admissível, consumo diário do coletor ≤ orçamento (já testado por `parametrize`; `hypothesis` só se a lista crescer).

### 4.2 Estado atual

| Módulo | Testes | Cobre | Não cobre |
|---|---|---|---|
| `apps/api` | **63** (6 arquivos) | pool/cooldown/classificação de erro da TomTom, orçamento, cache de incidentes, corredor/bbox/interdição, `_consultar_tomtom`, recência, ranking da busca, combustível, contexto 2.2, guardas de admin e limitador (com fakes), schema de eventos, **chave fora do log INFO** | nada via HTTP (`TestClient`), `assign_lia_weights`, `_resumir_caminho`, `lookup_perfis`/`prever_razao` com artefato real, `rota_reconstruida`, `buscar` (entryPoints), `RecenciaCache._buscar`, `ConfigRuntime`, `ip_cliente` com proxy |
| `services/collector` | **17** (novo) | `TOMTOM_KEYS_FILE`, cadência (valor atual, invariante de orçamento, entradas inválidas, override por env), sucesso + round-robin, 429×4 = cota 24 h, 403 = 10 min, 403 com texto de cota, falha de rede não queima chave, ciclo aborta sem rede/banco quando tudo está em cooldown, lote vai ao banco 1× com tipos certos | `map_extractor` (bootstrap), `db.py` (só com banco real) |
| `ml` | 0 | — | features (vazamento), silver (schema), metadata, reprodutibilidade, números da tese |
| `apps/mobile` / `apps/admin` | 0 (só `erros.check.mjs`, fora do CI) | — | lint, funções puras, portão do `/admin`, aceite de privacidade |
| Banco | 0 | — | RLS, grants por coluna, `admin_*`, append-only, `pg_cron` |

### 4.3 Feito nesta sessão

- `services/collector/tests/` (conftest sem segredo: chaves falsas em arquivo temporário, `supabase` stub quando não instalado) + job no CI.
- `apps/api/tests/test_tomtom.py::test_log_info_nao_contem_chave_nem_url` — regressão do vazamento.
- `ml/dataset_coverage.py` → artefato versionado para a limitação de cobertura.

### 4.4 Plano por camada (nome → afirma → por quê · esforço)

**P0 — segurança da API** (`apps/api/tests/security/`, ~0,5 dia)
- `test_eventos_e_admin_limitam_ip_antes_do_auth` → 1.000 tokens aleatórios geram ≤ N chamadas a `get_user` → fecha o item 4.
- `test_route_http_422_nan_extra_fora_do_df` → NaN, campo extra e coordenada fora do DF dão 422 (NaN hoje dá 500).
- `test_route_http_429_retry_after` → a 21ª rota do mesmo IP recebe 429 com `Retry-After`.
- `test_admin_http_401_403` → sem token, token inválido, usuário comum — via `TestClient`.
- `test_ip_cliente_xff_forjado_nao_muda_ip` → com `TRUST_PROXY`, header do cliente não altera o identificador.
- `test_middleware_headers_e_log_sem_query` → `nosniff`/`DENY`/`no-referrer` presentes; `api_requisicoes` sem query string.

**P1 — contrato modelo ↔ API ↔ tese** (`apps/api/tests/test_contrato_modelo.py`, `ml/tests/`, ~0,5 dia)
- `test_contrato_modelo_metadata` → `feature_names_in_` do `.pkl` == `metadata.features` (skip sem `.pkl`) → ordem trocada dá número plausível e errado.
- `test_prever_razao_em_limites` → 630 vias × 24 h × 7 dias ⇒ razão ∈ [0,05; 1,0].
- `test_lookup_perfis_cascata` → via desconhecida cai no perfil global do horário.
- `test_features_causais` → destruir a velocidade depois de t₀ não muda nenhuma feature ≤ t₀ (perturbação do futuro); permutar o alvo só no treino leva a validação ao acaso.
- `test_paridade_treino` → silver sintético (3 vias × 2 dias): `montar_features` da API reproduz `FEATURE_COLS` do treino linha a linha e a predição é idêntica; versão com contexto (vizinho lido 3 min antes, chuva fixa).
- `test_silver_schema` → `silver.clean()` em bronze sintético com outliers: colunas/dtypes, `datetime64[ns, UTC-03:00]`, ordem (ponto, tempo), razão ∈ [0,05; 1].
- `test_reprodutibilidade` → 5 mil linhas sintéticas, `n_jobs=1`, `random_state=42`, 2 execuções ⇒ predições idênticas.
- `test_numeros_da_tese_batem_com_json` → regex sobre `resultados-e-limitacoes.md` × `*_metadata.json` e `cobertura_dataset.json`.
- `test_metadata_chaves_obrigatorias` → `cv`, `cv_folds`, `features`, `periodo_*`, `versao`.

**P2 — integração** (`TestClient` + `MockTransport`, ~1 dia)
- `test_route_e2e_grafo_pequeno` → TomTom 500 ⇒ `degradado=True` e rota da LIA.
- `test_route_fora_da_malha_sem_tomtom_422`; `test_rota_reconstruida_nossa_e_melhor`; `test_buscar_entrypoint_marco_primeiro`; `test_recencia_timestamp_sem_fuso_vira_utc`.
- Coletor: `test_ciclo_completo_com_banco_falso` → 630 vias simuladas, 1 INSERT, round-robin cobre todas as chaves.

**P3 — propriedades** (`parametrize`, ~2 h)
- `test_heuristica_admissivel` → `vmax` ≥ todo `speed_kph` do grafo (**hoje falha**: 110 km/h).
- `test_tempo_de_razao_monotonico_limitado`; `test_pontos_apoio_max_100_extremos`; `test_tempo_misto_entre_lia_e_tomtom`.

**P4 — banco** (pgTAP no CI, ~0,5 dia após o baseline do dataset)
- `anon` não lê `historico_trafego`; `authenticated` A não lê `route_history` de B; não-admin não executa `admin_*`; `UPDATE` em `admin_auditoria` falha até para `service_role`; INSERT em `route_history` com `tempo_real_seg` preenchido falha (depois do item 13).

**P5 — front** (~1 dia)
- Lint: `npx expo lint` e `eslint-config-next` (os 17 `eslint-disable` do mobile apontam pra um linter inexistente).
- `node:test` nas funções puras extraídas: `trechosDestacados` (acento/caixa), `parseMinutosReais` ('1,5' → 90 s; 0/601/'abc' erram), `agregarHistorico` (só economia positiva), `deveReplanejar` (30 s/80 m), `fmtDuracao(659.6)`.
- Playwright: sem sessão `/admin` → `APP_URL`; usuário comum → `/admin/sem-acesso`; admin vê "Visão geral"; cadastro exige aceite; rota pronta com `/search` e `/route` mockados.

**P6 — carga leve** (`slow`, artefatos reais)
- `test_route_p95` → p95 < 2,5 s e `/health` concorrente < 200 ms — pega o event loop bloqueado (item 2).

### 4.5 CI alvo

| Job | Hoje | Alvo |
|---|---|---|
| `api` | pytest com deps ad hoc, Python 3.11 | `requirements.txt` + cache, Python 3.12, `--cov-fail-under=60`, `pip-audit`, `ruff --select E9,F63,F7,F82` |
| `coletor` | **pytest (novo)** | + `shellcheck deploy/*.sh` |
| `ml` | — | `pytest ml/tests` (sem `.pkl`: testes de contrato fazem skip explícito, não silencioso) |
| `db` | — | `supabase start` + `db reset` + `supabase test db` (pgTAP) |
| `frontend`/`admin` | `tsc`, `next build` | + `eslint`, `node:test`, `npm audit --omit=dev --audit-level=high`, Node 22 |
| `e2e` | — | Playwright contra `expo export` + Next local, rede mockada |
| `segredos` | gitleaks | mantém |
| `deploy` | — | `workflow_dispatch` + `environment: production` (seção 3.5, item 38) |

### 4.6 Banco real sem tocar em produção

Branch do Supabase (ou `supabase start` local) recebe as 7 migrations + o baseline do dataset com algumas centenas de linhas sintéticas; os testes de RLS rodam contra ela com JWTs de dois usuários e um admin. Nunca apontar a suíte para `vwbnragsacjxxulxenvg`.

## 5. Coleta na AWS, em paralelo com a API

**Desenho** (código em `services/collector/`, docs em `deploy.md` §1.1):

- Mesma EC2 (t3.small, 2 GB), segundo serviço `routify-collector`, usuário `routify`, `MemoryMax=300M`, hardening padrão, `ConditionPathExists` no `.env`, `StartLimit*`.
- Cadência pela cota: `intervalo_minutos(chaves, pontos)` → **43 min**; o teste `test_intervalo_nunca_estoura_o_orcamento` garante consumo diário ≤ orçamento para qualquer pool. `COLETOR_INTERVALO_MIN` força.
- Classificação de erro igual à da API (429×4 = cota 24 h; 403 = chave 10 min), round-robin por chamada; falha de rede não queima chave.
- Fase 3 opt-in e **desligada** na EC2 (grafo + modelo ≈ 1,4 GB não cabem ao lado da API).
- Pool compartilhado por arquivo; cooldowns independentes por processo. Se a reserva de 15 % não bastar para a API, `TOMTOM_KEYS_FILE` separa o pool.
- Venv mínimo (`deploy/requirements-ec2.txt`: requests, dotenv, schedule, supabase); OSMnx não é instalado (import tardio só no bootstrap).

**Estado:** código, testes (17), unidade, instalador e docs prontos. **SSH na EC2 deu `Connection timed out`:** o security group libera só o IP do dono em 2026-09 e o IP atual é outro; esta máquina não tem AWS CLI nem credencial, então o assistente não consegue abrir o SG. Passos para o dono em [STATE.md › Próximos passos](../STATE.md).

**Riscos:** (a) se a cota for por **conta** e não por chave, o pool rende 1/39 do previsto — o log mostra "Cota da chave esgotada" em cascata no mesmo dia; reduzir com `COLETOR_INTERVALO_MIN` e tratar na tese; (b) ToS §14.2 da TomTom (pool de 39 chaves) — declarar como limitação de protótipo acadêmico; (c) t3.small com crédito Standard: o coletor usa pouca CPU, mas somar alarme de `CPUCreditBalance`.

## 6. Acesso do parceiro à AWS

Resumo (passo a passo completo em `deploy.md` §5): ativar acesso de IAM ao Billing; criar role `routify-ec2-ssm` com `AmazonSSMManagedInstanceCore` e anexar à instância (Session Manager = shell sem SSH e sem IP no SG); criar usuário IAM `pedro` com console + senha temporária, `ReadOnlyAccess` + política `RoutifyOperacaoEC2` (start/stop/reboot só da instância, `ssm:StartSession`, custo, própria senha/MFA, **deny de tudo sem MFA**); entregar credenciais por canal seguro; colega configura MFA no 1º login. Nunca Organizations/Identity Center/Control Tower (conta Free vira paga). Revogar = desabilitar o console sign-in do usuário.

## 7. Decisões pedidas ao dono

1. Liberar o IP atual no SG (ou ativar o Session Manager) para o deploy do coletor — ou rodar você mesmo os 3 comandos do STATE.
2. Travar o INSERT de `route_history` por coluna agora (migration nova) ou mover a escrita para a API?
3. Onde guardar o backup semanal do dataset (R2/B2/Drive)?
4. Rotacionar as 39 chaves TomTom por causa do log antigo? Recomendação: limpar o journal (só root lê) e não rotacionar.
5. LIA 2.3 em dez/2026 com os dados novos: sim/não (define se o texto da tese ganha uma seção de "dados uniformes").
