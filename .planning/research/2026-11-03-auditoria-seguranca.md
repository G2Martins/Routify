# Auditoria de segurança do Routify

**Última revisão:** 2026-11-03

> **Base:** `main` em `5ca6bfc` (o código mudou durante a auditoria; as linhas citadas foram conferidas nesse commit),
> catálogo vivo do Supabase (SQL só de leitura pelo MCP, 2026-11-03 ~01:40 UTC) e produção por HTTP (18 requisições:
> cabeçalhos do front e da API, `/admin` e sub-rotas, preflight de CORS de origem estranha, corpo de 70 KB,
> `/_next/image`, `/mfa/recuperar` e `/admin/sistema` sem token). Nada foi escrito no banco, sem fuzzing, nenhuma conta
> criada. Três dessas requisições viraram linha em `api_requisicoes` (404 `/nao-existe`, 401 `/mfa/recuperar`,
> 404 `/admin/sistema`, ~01:35–01:50 UTC): são desta auditoria.
>
> **Repo público:** este arquivo descreve caminhos de ataque ainda abertos. Commitar só depois das correções do grupo
> Alto (ou manter fora do git até lá). Hosts, IPs e ids de infraestrutura ficaram de fora de propósito.

Severidade: **Alto** = qualquer pessoa ou conta comum explora hoje, com dano grande; **Médio** = exige condição extra
(terceiro comprometido, admin mal-intencionado, carga sustentada) ou o dano é recuperável; **Baixo** = higiene,
vazamento de informação ou corrida sem impacto direto de segurança.

## Resumo

| ID | Sev. | Achado | Correção mínima |
|---|---|---|---|
| A1 | Alto | Qualquer conta enche os 500 MB do Supabase free (`route_history` sem teto) e o banco vira read-only: a coleta do dataset para | CHECK de tamanho + teto diário por conta; não logar 404 |
| A2 | Alto | As 5 contas do projeto são admin e nenhuma tem 2º fator; sem CAPTCHA | Rebaixar, ativar TOTP, depois tornar aal2 obrigatório para admin |
| M1 | Médio | 3–4 IPs travam o worker único da API (CPU do `/route` no event loop + executor do log de uso sem teto) | Semáforo global no `/route`, executor próprio e limitado para o log |
| M2 | Médio | Anônimo queima a cota da TomTom e põe todo mundo em modo degradado | Anônimo sem TomTom (ou sub-orçamento por IP), teto diário, caixa do DF |
| M3 | Médio | Mass assignment no INSERT de `route_history`: o cliente forja a "verdade" da validação da tese | Grant de INSERT só nas 20 colunas que o app usa + CHECK |
| M4 | Médio | HTML de terceiros (Iconify, atribuição do MapLibre) vira DOM na mesma origem do painel, com cookie de sessão legível por JS | Ícones offline, atribuição estática, CSP estrita no app |
| M5 | Médio | CSP só em Report-Only, sem relatório, com `'unsafe-inline'` em `script-src` | Duas políticas (app estrita, painel como hoje), em enforce |
| M6 | Médio | Rebaixar/banir admin não corta o acesso no banco até o JWT expirar | `is_admin()` confere `auth.users` e `auth.sessions` ao vivo |
| M7 | Médio | O dataset da tese pode ser apagado com a chave `service_role` da EC2; último backup de 23/09 | Revogar DELETE/TRUNCATE/UPDATE da `service_role` nas 3 tabelas + dump |
| M8 | Médio | Next 16.3.5 / sharp 0.35.4 com advisories críticos; otimizador de imagem aberto | `next@16.4.4` + `images.unoptimized` |
| B1–B11 | Baixo | Painel se anuncia, `/health` e Swagger falam demais, cookie, grants, duas corridas, e-mails, LGPD, SRI | Seção 1.3 |

## Status em 2026-11-03 ~00:15 (fim da noite)

Tudo abaixo está no `main` (CI verde em `b9bc933`), **sem deploy**: a produção ainda roda a API `24a77a6` e o front
das 22:10. Nada vale de verdade antes do deploy da API (primeiro), do front e das duas migrations.

| ID | Status | Onde |
|---|---|---|
| A1 | Código: 404/405 fora do log (API). Banco: CHECKs + teto de 300/dia **na migration não aplicada** | `e53f3f7`, `20261103020000` |
| A2 | **Dono**: rebaixar quem não precisa ser admin, TOTP + códigos em cada admin; depois `20261103030000` + `ADMIN_EXIGE_MFA=1` (API e painel já aceitam a flag) | `82f11db`, `8d89b8d` |
| M1 | Executor próprio de 2 threads com fila de 500 para o log de uso; teto global de 40 `/route`/min; pesos 2× mais rápidos e perfis em cache (−77 ms). Aberto: o `/route` ainda roda a CPU no event loop | `e53f3f7`, `fa9e9f2`, `b422b81` |
| M2 | Coordenadas só no DF; teto diário por serviço (1/31 da cota) e 400 buscas com TomTom por IP e dia | `e53f3f7`, `7336f96` |
| M3 | INSERT por coluna (20) + CHECKs **na migration não aplicada** | `82f11db` |
| M4 | Ícones offline (sem a API do Iconify); atribuição do MapLibre zerada no estilo, texto nosso. O MapLibre segue na 5.24 (a 6.x é ESM-only/WebGL2) | `1f9bb3f` |
| M5 | Duas políticas (app sem script inline; painel com `unsafe-inline`), Iconify fora do `connect-src`. **Segue Report-Only**: ligar `CSP_ENFORCE=1` depois de olhar o console em produção | `8d89b8d`, `1f9bb3f` |
| M6 | `is_admin()` lê `auth.users` ao vivo **na migration não aplicada** | `82f11db` |
| M7 | Revoke de UPDATE/DELETE/TRUNCATE da `service_role` no dataset **na migration não aplicada**; dump continua pendente | `82f11db` |
| M8 | Next 16.4.4, `images.unoptimized`, `npm audit` do painel limpo | `f977ea8`, `8d89b8d` |
| B1 | Painel atrás do mesmo 404 de rota inexistente (proxy, páginas e `status/externo`) | `8d89b8d` |
| B2 | `/health` sem o pool; painel lê `/admin/saude` | `454da32` |
| B3 | Swagger sem `persistAuthorization`; `/admin` e `/mfa` fora do schema. O Swagger UI segue do jsDelivr sem SRI (sem token salvo, sobra pouco) | `454da32` |
| B4 | Cookie Secure em https e 30 dias, nos 4 clientes. Sem prefixo `__Host-` (obrigaria todos a entrar de novo) | `454da32` |
| B5 | Grants **na migration não aplicada** (inclui `avisos_app` por coluna para o anônimo) | `82f11db`, `0ec6da6` |
| B6 | Trava por conta na geração dos códigos (teste prova 20 → 10 códigos) | `454da32` |
| B7 | Tempo livre por grupo lido antes do `await` | `454da32` |
| B8 | `Server-Timing` só em chamada interna | `454da32` |
| B9 | Templates sem `.Data.nome` **no repo**; o dono precisa colar de novo em Auth → Templates | `454da32` |
| B10 | Privacidade cita TomTom, ipapi.co e os provedores do mapa. Aberto: listas do painel com `user_id`, export com coordenada exata, retenção do `route_history` | `454da32` |
| B11 | SRI no CSS do Leaflet | `454da32` |

Ordem sugerida para a noite: A2 (passos 1–2, sem deploy) → M8 (bump de 5 min) → **uma** migration com A1 + M3 + M6
(+ A2 passo 3, depois que os admins tiverem TOTP) + M7 + B5 → API (M1, M2, B2, B3, B8) → front (M4, M5, seção 3).

## 1. Achados

### 1.1 Alto

#### A1 — Qualquer conta põe o banco em read-only e a coleta do dataset para

- **Onde:** `supabase/migrations/20260427000000_route_history.sql:10-16,40-42` e `20261102020000_mfa_aal2.sql:38-39`
  (o INSERT só exige `auth.uid() = user_id`; `polyline jsonb` e rótulos `text` sem limite);
  `apps/api/main.py:444,466-467` (toda requisição, inclusive 404, vira linha em `api_requisicoes`; só 4 caminhos
  ficam de fora) + `apps/api/usage.py:111`; `/eventos` com 60/min por conta e até 2 KB cada
  (`apps/api/routers/eventos.py:46`, `20260923010000_usage_tracking_admin.sql:71`).
- **Ataque:** crio uma conta pelo cadastro do app e, com a chave publishable e o meu JWT, faço `insert` direto no
  PostgREST em `route_history` com `polyline` de algumas centenas de KB de números aleatórios (não comprimem), em laço.
  Poucos milhares de inserts levam o banco de 174 MB aos 500 MB. Acima disso o Supabase free põe o projeto em
  **read-only**: o coletor da EC2 deixa de gravar `historico_trafego` (o dataset da tese), o app não grava histórico,
  a API não grava uso nem auditoria. Sem conta, o mesmo efeito vem mais devagar por um flood de GETs em caminhos
  inexistentes (nenhum limite) — e trava a API no caminho (M1). Com conta, `/eventos` dá ~180 MB/dia por conta.
- **Evidência:** `pg_constraint` de `route_history` só tem a FK (nenhum CHECK); `column_privileges`: `authenticated`
  com INSERT nas 27 colunas; `pg_database_size` = 174 MB; doc do Supabase: "Free Plan projects enter read-only mode
  when your database size exceeds 500 MB"; `api_requisicoes` tem 4.084 linhas, **3.667 são 404 de scanners**
  (`/.env`, `/.git/config`, `wp-*`, `/index.php`), desde 24/09. Hoje a maior `polyline` real tem 9,2 KB.
- **Correção mínima:**
  - migration: `check (jsonb_array_length(polyline) <= 5000 and pg_column_size(polyline) <= 262144)`,
    `char_length(...) <= 200` nos rótulos, `via_principal` e `modelo_versao`, faixas nos tempos; trigger
    `before insert` que recusa mais de ~300 linhas por `user_id` em 24 h (o índice `idx_route_history_user_created`
    já cobre a contagem);
  - API: não registrar 404/405 em `api_requisicoes`; limite barato por IP no middleware, antes do log (M1);
  - `/eventos`: teto diário por conta (ex.: `Limitador(1500, janela_s=86400)`);
  - o `admin_status_dados` novo já mede o tamanho contra os 500 MB: alertar a partir de 80%.

#### A2 — As 5 contas são admin e nenhuma tem 2º fator

- **Onde:** `20261102020000_mfa_aal2.sql:9-21,26-33` (`aal_ok()` é verdadeiro para quem não tem fator, então
  `is_admin()` aceita sessão só com senha); `apps/api/seguranca.py:127` (mesma regra); `apps/admin/src/lib/auth.ts:19-21`;
  o app chama `signInWithPassword` sem `captchaToken` (`apps/mobile/src/context/AuthContext.tsx:86`) e o login
  funciona em produção, logo o CAPTCHA do Auth está desligado; advisor `auth_leaked_password_protection` (WARN).
- **Ataque:** senha vazada, reusada ou pescada de qualquer uma das 5 contas = admin pleno direto no PostgREST, sem
  passar pelo painel: `admin_exportar_dados` devolve o histórico de qualquer usuário com coordenada exata e polyline,
  `admin_apagar_dados` apaga contas, `admin_definir_papel` promove uma conta do atacante (persistência),
  `admin_definir_config` desliga a TomTom.
- **Evidência:** consulta agregada em `auth.users`/`auth.mfa_factors` (sem PII): 5 usuários, 5 com
  `app_metadata.role = 'admin'`, 0 com fator TOTP verificado, 0 códigos de recuperação gerados.
- **Correção mínima (nesta ordem):**
  1. rebaixar quem não precisa (painel → Usuários), ficando 1–2 admins;
  2. cada admin ativa o TOTP e gera os códigos (Perfil → Segurança; `/mfa/*` já está em produção — 401 sem token);
  3. só então tornar aal2 obrigatório para admin nas três camadas: no `is_admin()`, papel admin **e**
     `auth.jwt()->>'aal' = 'aal2'` (sem a exceção "não tem fator"; junto com M6); no `exigir_admin`, tirar o
     `tem_mfa(user) and`; no painel, exigir `currentLevel === 'aal2'`. O `aal_ok()` continua valendo para usuário comum
     (`route_history`). Virar a regra antes do passo 2 tranca todos os admins fora (volta só pelo SQL Editor);
  4. Auth: CAPTCHA (Turnstile ou hCaptcha, grátis) em cadastro e login; senha mínima ≥ 10 no servidor. A proteção
     contra senha vazada (HaveIBeenPwned) é do plano Pro, segundo a doc — conferir.

### 1.2 Médio

#### M1 — 3–4 IPs travam o worker único da API

- **Onde:** `apps/api/routers/route.py:571` (20 rotas/min por IP), `:753-849` (pesos do grafo inteiro e dois A\* sem
  `await`, de propósito, para não intercalar escrita no grafo compartilhado); `apps/api/usage.py:111`
  (`run_in_executor(None, …)` fire-and-forget, fila sem teto), chamado por `main.py:467` em toda requisição. O mesmo
  executor padrão roda todo `asyncio.to_thread`: validação de token (`seguranca.py:107`, `usage.py:93`), malha da busca
  (`routers/search.py:557,572`), `config_runtime.py:39`, MFA (`routers/mfa.py:85,128,136`) e o envio de uso da TomTom.
- **Ataque:** (a) 3–4 IPs no limite do `/route` deixam o event loop ocupado quase o tempo todo (pesos 0,56–0,62 s +
  A\* até 0,8 s + baseline, por rota — números do commit `fa9e9f2`): `/health`, busca, login de admin e MFA esperam;
  (b) um flood de 404 (sem limite algum) empilha milhares de INSERTs no executor padrão (6 threads numa t3.small de
  2 vCPU); toda `to_thread`, inclusive a validação de token do `/admin` e do `/mfa`, entra na fila atrás deles, e a
  memória cresce até o `MemoryMax=1500M` reiniciar a API.
- **Evidência:** código acima; produção: `/route` p50 2,76 s e p95 35,9 s (`api_requisicoes`, 3 dias); o
  `planejar.py` em andamento (fora do git) soma outro `Limitador(10)` com o mesmo custo de CPU.
- **Correção mínima:** `asyncio.Semaphore(1)` (ou 2) em volta da parte de CPU do `/route` e do `/route/planejar`,
  com fila curta (ex.: 4 esperando) e 503 + `Retry-After` quando cheio; limite global por minuto além do por IP;
  executor próprio para o log (`ThreadPoolExecutor(max_workers=2)`) com contador de pendências que descarta acima de
  ~500; limite por IP no middleware para tudo (ex.: 300/min) antes do log; não registrar 404/405. O cache dos pesos
  por hora (backlog do STATE) resolve a raiz depois.

#### M2 — Anônimo queima a cota da TomTom e derruba o modo completo para todos

- **Onde:** `apps/api/tomtom.py:59,256,319` (um orçamento global de 120 chamadas/min para todos os serviços e todos
  os clientes; valor vivo em `config_runtime` = 120); `:393` (`rota_reconstruida`: 1 Routing por rota dentro da malha,
  sem cache); `:258` (Incidents com cache só por bbox, 5 min); `:259,427-439` (Search com cache por texto: texto novo =
  chamada nova); `routers/search.py:57` (90 buscas/min por IP); `routers/route.py:35-38` (`Coordenada` aceita o planeta;
  fora da malha a rota é da TomTom).
- **Ataque:** textos únicos no `/search` mais rotas com bbox variada no `/route`, de um ou dois IPs, consomem sozinhos o
  teto de 120/min: enquanto durar, todo usuário cai no modo degradado. Mantido, esgota a cota mensal do pool: Incidents
  e Search têm 2.500 por chave/mês (× 39 = 97.500), ou ~13,5 h no teto do orçamento. O `/health` público mostra a
  disponibilidade por serviço em tempo real, o que ajuda a medir o efeito (B2).
- **Correção mínima:** TomTom só para quem tem token válido (anônimo fica com LIA + base local) ou sub-orçamento por IP
  (ex.: 20 chamadas/min); teto diário por serviço no `_Orcamento` (cota mensal / 31 × 0,85, como o coletor já faz);
  caixa do DF + Entorno em `Coordenada` (reaproveitar os limites do `PontoDF` do `planejar.py`).

#### M3 — Mass assignment no INSERT de `route_history`

- **Onde:** `20260923000000_security_hardening.sql:21-22` travou só o UPDATE; o trigger de feedback único é
  `before update` (`20260923020000_admin_actions.sql:94`); `admin_validacao_feedback` (mesmo arquivo, `:468-488`) lê
  essas linhas para o "erro real em produção" do painel.
- **Ataque:** uma conta comum insere linhas com `tempo_total_seg`, `tempo_real_seg`, `feedback_em`, `created_at`,
  `eta_google_seg` e `feedback_excluido` à escolha: o erro da LIA "medido em produção" vira o que o atacante quiser.
  Apagar e reinserir a própria linha contorna o "feedback uma vez só".
- **Evidência:** `column_privileges` (vivo): INSERT de `authenticated` em `tempo_real_seg`, `feedback_em`,
  `feedback_excluido`, `feedback_excluido_motivo`, `eta_google_seg`, `created_at` e `id`. O app usa 20 colunas
  (`apps/mobile/src/screens/MapScreen.tsx:248-270`).
- **Correção mínima (na migration do A1):**
  `revoke insert on public.route_history from anon, authenticated;` e
  `grant insert (user_id, origem_label, origem_lat, origem_lon, destino_label, destino_lat, destino_lon, polyline,
  tempo_total_seg, distancia_km, via_principal, modelo_versao, tempo_rota_curta_seg, distancia_rota_curta_km,
  rotas_diferentes, lia_cobertura_pct, hora_partida, dia_semana, combustivel_economizado_l, minutos_economizados)
  on public.route_history to authenticated;` + CHECK de faixa em `tempo_real_seg`. A previsão continua escrita pelo
  cliente; o alvo do CLAUDE.md §5 (a API grava com `service_role` e o cliente só dá o feedback) fecha de vez.

#### M4 — HTML de terceiros vira DOM na mesma origem do painel

- **Onde:** `apps/mobile/src/components/Icon.tsx:21` (`@iconify/react` 5.2.1 no modo online: o SVG vem de
  `api.iconify.design`, `api.simplesvg.com` ou `api.unisvg.com` e entra por `dangerouslySetInnerHTML` sem sanitizar —
  `node_modules/@iconify/react/dist/iconify.js:1667`; o `cleanUpInnerHTML` só embrulha em Trusted Types);
  `apps/mobile/src/components/mapa/estiloMapa.ts:120` + `MapaVetorial.web.tsx:358` (as fontes do estilo da OpenFreeMap
  passam inteiras e o `AttributionControl` renderiza a atribuição HTML do TileJSON; maplibre-gl 5.24.0 é afetado por
  GHSA-jrc7-96c5-q579, bypass do `DOM.sanitize`, crítico, corrigido em 6.4.1); `apps/mobile/src/lib/supabase.ts:21` e
  `apps/admin/src/lib/supabase-navegador.ts:6` (`createBrowserClient`: cookie `httpOnly: false`, o mesmo no app e no
  `/admin`).
- **Ataque:** quem controlar a resposta de um desses 4 hosts (comprometimento, operador, CDN) injeta
  `<image href=x onerror=…>` ou `<details open ontoggle=…>`: o JS roda na origem do app, lê o cookie
  `sb-…-auth-token` (access e refresh token) e leva a sessão de qualquer usuário, inclusive admin. A CSP atual não
  barra (M5).
- **Evidência:** código citado; o bundle de produção busca ícones em `api.iconify.design` (não há `addCollection` nem
  modo offline); `npm audit` do app: `maplibre-gl` crítico; `@supabase/ssr` 0.12.7 `DEFAULT_COOKIE_OPTIONS`.
- **Correção mínima:** ícones offline (`addCollection` só com os ícones usados) e tirar os 3 hosts do `connect-src`;
  atribuição do mapa estática (remover o `AttributionControl` e escrever "© OpenFreeMap © OpenMapTiles ©
  OpenStreetMap · TomTom · Open-Meteo" num `Text`) ou subir o maplibre para ≥ 6.4.1 (major); CSP estrita no app (M5).

#### M5 — CSP só em Report-Only, sem relatório e com `'unsafe-inline'`

- **Onde:** `apps/admin/next.config.ts:35,61` (`script-src 'self' 'unsafe-inline'`; Report-Only salvo
  `CSP_ENFORCE=1`); nenhum `report-uri`/`report-to`, então as violações não chegam a ninguém. Em produção vêm
  `content-security-policy-report-only` (Next) e `content-security-policy: upgrade-insecure-requests` (borda da
  Hostinger).
- **Por que importa:** mesmo em enforce, `'unsafe-inline'` em `script-src` libera handler inline — exatamente o
  payload dos sinks do M4.
- **O que trava o enforce (conferido):** no painel, a hidratação do Next usa script inline (precisa de
  `'unsafe-inline'` ou nonce). No app (`/`), nada: o `index.html` de produção tem um só `<script src>` (o JSON-LD novo
  é bloco de dados e não é bloqueado); o bundle, os chunks do MapLibre e do Leaflet e o Iconify não têm `eval` nem
  `new Function` (o carregador de chunks do Expo usa `<script src>` na web); o worker do MapLibre é `blob:` (já
  permitido); o estilo inline (`expo-reset`, React Native Web, `divIcon`) fica em `style-src 'unsafe-inline'`.
- **Correção mínima:** duas regras em `headers()` — o Next aplica a última que casar com a mesma chave
  (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`, "Header Overriding
  Behavior"): primeiro `/:path*` com `script-src 'self'` (sem `'unsafe-inline'`), depois `/admin/:path*` com a política
  atual; as duas como `Content-Security-Policy`. Depois do deploy, `curl -I` em `/` e `/admin` para ver se a borda
  manteve o header, e a suíte `tests/e2e` (o `csp.spec.ts` já conta violações). Nonce no painel fica para depois (o
  `proxy.ts` pode gerá-lo; as páginas já são dinâmicas).

#### M6 — Rebaixar ou banir admin não vale no banco até o JWT expirar

- **Onde:** `20261102020000_mfa_aal2.sql:26-33` (`is_admin()` lê `app_metadata.role` do JWT);
  `20260923020000_admin_actions.sql:168,188` (rebaixar e banir apagam `auth.sessions`; o comentário supõe que basta).
- **Ataque:** um admin rebaixado ou banido (ou quem roubou o token dele) segue chamando `admin_*` pelo PostgREST até o
  `exp` (padrão 1 h): promove outra conta (`_admin_nao_eu` só barra a própria), exporta dados, apaga contas. A API já
  percebe (o `get_user` responde `session_not_found`); o banco não.
- **Evidência:** doc do Supabase: "There is no way to revoke a user's access token jwt until it expires" e "check
  that the `session_id` claim in the JWT corresponds to a row in the `auth.sessions` table".
- **Correção mínima (junto do A2):** `is_admin()` vira `security definer` e confere ao vivo —
  `exists (select 1 from auth.users u where u.id = auth.uid() and u.raw_app_meta_data->>'role' = 'admin' and
  (u.banned_until is null or u.banned_until <= now()))`
  `and exists (select 1 from auth.sessions s where s.id = (auth.jwt()->>'session_id')::uuid)`
  `and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'`; `revoke execute … from public, anon`; nas policies "Admin le",
  trocar `is_admin()` por `(select public.is_admin())` (uma avaliação por consulta, não por linha).

#### M7 — O dataset da tese pode ser apagado com a chave da EC2

- **Onde:** privilégios vivos da `service_role`: DELETE, TRUNCATE e UPDATE em `historico_trafego`, `vias_monitoradas`
  e `malha_completa`. A chave fica no `.env` da EC2, lido pela API (exposta à internet), pelo coletor, pelo comparador
  e pela rotina. Backup: só os parquets de 2026-09-23 (`ml/artifacts/backup_20260923_*.parquet`), anteriores à coleta
  nova; `STATE.md:101` ainda pendente.
- **Ataque:** qualquer RCE ou leitura de arquivo na API ou numa dependência dela (ou acesso à EC2) entrega a chave; um
  DELETE com filtro qualquer (ex.: `id_ponto=gte.0`) apaga o dataset. O free não tem backup nem PITR.
- **Correção mínima:** `revoke delete, truncate, update on public.historico_trafego, public.vias_monitoradas,
  public.malha_completa from service_role;` — o coletor só faz SELECT e INSERT (`services/collector/db.py:62,75,104`),
  a API e o `ml/` só leem; manutenção segue pelo SQL Editor (papel `postgres`). Mais o dump semanal cifrado do STATE.

#### M8 — Next 16.3.5 e sharp 0.35.4 com advisories críticos; otimizador de imagem aberto

- **Onde:** `apps/admin/package.json` e lock (`next` 16.3.5, `@img/sharp-linux-x64` 0.35.4, instalados por `npm ci`
  em `scripts/montar-front-linux.sh:16`); `next.config.ts` sem `images`, então `/_next/image` fica ativo.
- **Evidência:** `npm audit --omit=dev`: 11 advisories no `next`, 3 críticos — GHSA-2464-fhr4-w9xw (RCE no otimizador
  com SVG em Linux glibc, ≤ 16.4.0), GHSA-vcvr-r3jv-pc5j (`next/og`), GHSA-673q-mjm6-r5xr (`use cache`) — e `sharp`
  < 0.35.5 (librsvg). Produção: `GET /_next/image?url=/favicon.ico&w=64&q=75` → 200, `x-nextjs-cache: MISS`.
- **Por que Médio:** o painel não usa `next/image`, `next/og`, `use cache` nem Server Actions, não tem `remotePatterns`
  (o SSRF GHSA-cjq9-62q9-8jv4 não se aplica), e o otimizador recusa SVG sem `dangerouslyAllowSVG`
  (`node_modules/next/dist/server/image-optimizer.js:1107`); as origens são só arquivos locais. Não achei caminho de
  exploração, mas a superfície está aberta à internet e o conserto custa minutos.
- **Correção mínima:** `next@16.4.4` (o fix do `npm audit`; ≥ 16.4.1 cobre os três críticos e traz sharp ≥ 0.35.5) e
  `images: { unoptimized: true }` (o servidor passa a responder 404 em `/_next/image`, `next-server.js:198`); conferir
  com `curl` depois do deploy. No app, o resto do `npm audit` é ferramenta de build e dev (Expo CLI, metro, node-forge,
  shell-quote) e não vai para o bundle; o único de runtime é o `maplibre-gl` (M4).

### 1.3 Baixo

| ID | Achado | Onde / evidência | Correção mínima |
|---|---|---|---|
| B1 | O painel se anuncia | `/admin/*` anônimo → 307 (`apps/admin/src/proxy.ts:34`); sem papel → `/admin/sem-acesso` (`lib/auth.ts:21`); `status/externo/route.ts:53` → 403 JSON; `"/admin"` no bundle público (`scripts/empacotar-front.sh:35`) | Seção 3 |
| B2 | `/health` público mostra o pool TomTom (`chaves: 39`) e a disponibilidade por serviço — sinal para o ToS §14.2 e telemetria para quem ataca a cota (M2) | `apps/api/main.py:520`; conferido em produção | Público só `status` e `modelo_ativo`; o resto no `/admin/sistema`. O painel lê `/health` (`components/useSaude.ts:18`, `lib/saude.ts:9`): migrar junto |
| B3 | Swagger público com `persistAuthorization: True` (token colado fica no `localStorage` da origem da API) e Swagger UI de `cdn.jsdelivr.net/npm/swagger-ui-dist@5` (versão flutuante, sem SRI); `/admin/*` e `/mfa/*` documentados | `apps/api/openapi.py:64`, `main.py:423`; `/docs` e `/openapi.json` 200 em produção | Docs desligadas em produção (`docs_url=None, redoc_url=None, openapi_url=None` por env) ou `persistAuthorization: False` + `include_in_schema=False` em `/admin` e `/mfa` |
| B4 | Cookie de sessão sem `Secure`, `Max-Age` de 400 dias, sem prefixo `__Host-` (cookie tossing de outro subdomínio do mesmo domínio). `HttpOnly` é impossível com `createBrowserClient` | `@supabase/ssr` 0.12.7 `DEFAULT_COOKIE_OPTIONS`; `apps/mobile/src/lib/supabase.ts:21`, `apps/admin/src/lib/supabase-navegador.ts:6`, `lib/supabase.ts`, `proxy.ts` | `cookieOptions: { secure: true, maxAge: 2592000 }` nos 4 clientes (e, opcional, `name: '__Host-…'` idêntico nos 4; todos entram de novo) |
| B5 | Grants sobrando: `anon` e `authenticated` com TRUNCATE (ignora RLS; hoje inalcançável pelo PostgREST), REFERENCES e TRIGGER em `route_history` e `profiles`; `anon` com INSERT e DELETE nas duas e UPDATE em `profiles` (a RLS é a única camada); `avisos_app` entrega `criado_por` (uuid do admin) ao anônimo | `information_schema.role_table_grants` (vivo); `20260923020000_admin_actions.sql:61,72` | `revoke all on public.route_history, public.profiles from anon; revoke truncate, references, trigger on public.route_history, public.profiles from authenticated;` e, para `anon`, `grant select (id, mensagem, nivel, ativo, inicio, fim, criado_em) on public.avisos_app` no lugar do grant de tabela (o app ordena por `criado_em`) |
| B6 | Corrida: gerar códigos MFA apaga e insere em duas chamadas; duas gerações simultâneas deixam 20 códigos válidos (um lote nunca mostrado) | `apps/api/routers/mfa.py:81-82` | Uma RPC transacional (só `service_role`) que troca o lote |
| B7 | Corrida no grafo compartilhado: `tempo_livre_por_grupo` roda depois do `await` da fusão e escolhe a aresta paralela pelo `travel_time_lia` de outra requisição; o campo alimenta a calibração (`ml/calibrate_signals.py:88-98`) | `apps/api/routers/route.py:849` (await) e `:912` | Calcular antes do `await`, junto do `tempo_livre` |
| B8 | `Server-Timing` público no `/route` (tempo de cada fase): telemetria para calibrar o DoS do M1 | `apps/api/routers/route.py:651` | Só em chamada interna ou de admin; o log já tem os números |
| B9 | Os e-mails do Auth usam `{{ .Data.nome }}` (user_metadata livre no cadastro): cadastrar o e-mail de outra pessoa com um "nome" forjado põe texto do atacante num e-mail do remetente oficial. O comentário do template diz que o `html/template` escapa; sobra texto | `supabase/templates/confirmacao.html:37`, `recuperacao.html:38` | Tirar `.Data.nome` desses dois templates |
| B10 | LGPD: a Privacy diz "Nada é … compartilhado com terceiros", mas o fallback de localização manda o IP ao `ipapi.co`; o admin lê `rotas_calculadas` com `user_id` e `admin_exportar_dados` devolve coordenadas exatas; `route_history` sem retenção (itens #18/#19 da análise de 2026-11-01, ainda abertos) | `PrivacyScreen.tsx:99`, `mapa/geolocalizacao.ts:38`, `uso/page.tsx:58` | Citar o `ipapi.co` na Privacy ou tirar o fallback; listas sem `user_id`; job de retenção |
| B11 | CSS do Leaflet (mapa de reserva) do jsDelivr sem SRI | `apps/mobile/src/components/MapaLeaflet.web.tsx:26` | `integrity` como no MapLibre, ou servir local |

## 2. Conferido e OK

**API**
- Identidade: o JWT é validado no Supabase Auth (`get_user`) em toda chamada sensível; o `aal` só é lido depois
  (`seguranca.py:95-130`); papel lido do usuário vivo, não do token. Limite por IP antes de validar token em
  `/admin`, `/mfa` e `/eventos`.
- Sem IDOR: `user_id` sempre vem do token (`/route`, `/search`, `/eventos`, `/mfa`); nenhum endpoint recebe id de
  usuário; `/admin/*` exige admin e tem limite por admin; `/admin/sistema` lê só caminhos fixos de `/proc` e `/sys`.
- Entrada: `extra='forbid'` em todos os corpos (`RouteInput`/`Coordenada`, `PredictInput`, `EventoInput`,
  `RecuperarInput`); NaN, ±Infinity e `1e400` recusados pelos `ge`/`le` (testado com pydantic 2.12.5); `id_ponto`
  gigante dá 422 (testado); o 422 não ecoa o input (`seguranca.erro_de_validacao`).
- Injeção: a regex e o ILIKE da malha (`routers/search.py:509-551`) são montados só com `[a-z0-9]`/`[^\W_]` — nada
  do usuário vira operador ou curinga; o texto na URL da TomTom vai com `quote(safe='')`.
- SSRF: todos os hosts de saída são fixos (TomTom, Nominatim, Open-Meteo; Overpass só na subida; páginas de status do
  painel com URLs fixas e guarda `souAdmin`); o otimizador do Next não tem `remotePatterns`.
- CORS: allowlist sem credenciais; preflight de origem estranha em produção → 400 sem `Access-Control-Allow-Origin`.
- `X-Routify-Interno`: não dá para forjar pelo Caddy. Sem `trusted_proxies`, o Caddy sempre põe `X-Forwarded-For` com
  o IP do cliente, e o uvicorn (que confia em 127.0.0.1) troca `client.host` por esse IP — as duas condições de
  `usage.requisicao_interna` falham. E o efeito é só sair da captura de uso (`usage.py:108`): não fura limite nem
  auth. O braço B do A/B escuta em 127.0.0.1:8001.
- Borda: corpo > 64 KB → 413 em produção (testado); uvicorn só em 127.0.0.1; ufw + security group.
- Logs: `httpx`/`httpcore` em WARNING, uvicorn `--no-access-log`, só o id da chave TomTom em log, rotas sem coordenada.
- MFA: código de 80 bits, só o SHA-256 (por usuário) no banco, uso único atômico (`update … where usado_em is null`),
  5 tentativas/15 min por conta e 20 por IP, gerar exige aal2; `mfa_codigos_recuperacao` sem grant para anon e
  authenticated.

**Banco (catálogo vivo)**
- RLS ligada nas 16 tabelas de `public`; dataset, `mfa_codigos_recuperacao` e `tomtom_uso_dia` sem grant para anon e
  authenticated; as policies batem com as migrations.
- As 32 funções de `public` e `painel` têm `search_path=''`. As 23 RPCs `admin_*` são `security definer` e chamam
  `is_admin()` direto ou via `_admin_acao`; a única executável por `anon` é o próprio `is_admin()` (devolve falso). `registrar_tomtom_uso`,
  `expurgar_uso_antigo`, `handle_new_user` e `painel.atualizar_qualidade` não são executáveis por anon nem authenticated.
- Corridas nas RPCs: `_admin_acao` com advisory lock + reconferência + auditoria na mesma transação; mudança de papel e
  "último admin" com lock global; pausa de chave com `for update`.
- `admin_auditoria`: a `service_role` só tem INSERT e SELECT (append-only conferido).
- Sem buckets de Storage, sem `pg_graphql`, nenhuma tabela no Realtime; schema `painel` sem USAGE para anon e
  authenticated; `public` sem CREATE para eles.
- Advisor de segurança: INFO de RLS sem policy (intencional), WARN das RPCs definer (intencional, checam `is_admin()`)
  e a proteção contra senha vazada (A2).

**Painel e app**
- Painel: nenhum Server Action; um único route handler (`/admin/status/externo`), com guarda no servidor; só a chave
  publishable; dados por RLS/RPC; nenhum `dangerouslySetInnerHTML`; texto de usuário (`eventos_app.dados`, nome) sai
  escapado pelo React.
- App: `isAdmin` vem de `app_metadata`, que o usuário não edita (`AuthContext.tsx:112`); HTML dos marcadores só com
  tokens do tema; popups com texto fixo; sem WebView; sem redirect aberto (destinos fixos; `redirectTo` = origem
  atual); o bundle de produção não tem segredo (URL da API e chave publishable; nenhuma chave TomTom).
- Cabeçalhos em produção: HSTS (front e API), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, COOP; a API não manda `Server` (sobra `Via: 1.1 Caddy`).
- CI: `permissions` mínimas, sem `pull_request_target`; o artefato do build do front só leva valores públicos.

**OK hoje, frágil amanhã**
- `ip_cliente` usa o 1º item do `X-Forwarded-For` (`seguranca.py:76`): seguro porque o Caddy descarta o header do
  cliente. Com CDN ou `trusted_proxies`, vira forjável — usar o `client.host` que o uvicorn já resolve.
- Limites em memória: zeram no restart, e o `clear()` a 50 mil identificadores (`seguranca.py:46`) zera todo mundo
  (exige muitos IPs).

**Não verificável daqui (conferir no dashboard):** expiração do JWT, tamanho mínimo de senha no servidor, allowlist
de Redirect URLs, rate limits do Auth, "secure password change"; MFA nas contas de GitHub, Supabase, Hostinger e AWS
(quem entra nelas tem tudo). **Fora do escopo:** `apps/api/routers/planejar.py` (ainda fora do git; herda o M1), app
nativo, IAM da AWS.

## 3. Esconder o painel ADM

**Hoje (conferido em produção):**

| Quem | `/admin`, `/admin/usuarios`, `/admin/x` (inexistente) | `/qualquer-coisa` |
|---|---|---|
| anônimo | 307 → `/` (`proxy.ts:34`) | 404 |
| logado sem papel | 307 → `/admin/sem-acesso` ("Sua conta não tem o papel de administrador…") | 404 |
| sem papel em `GET /admin/status/externo` | 403 JSON "Acesso restrito a administradores." | — |

Além disso o bundle público do app tem o literal `"/admin"` (o `empacotar-front.sh` até confere que ele está lá), e a
API responde 401/403 em `/admin/*` e lista essas rotas no `/openapi.json`. Qualquer um distingue `/admin` de um caminho
qualquer, e o `tests/e2e/tests/admin-exposure.spec.ts` hoje aceita o 307. Esconder é defesa em profundidade, não
controle: quem barra é o `is_admin()` no banco — por isso A2 e M6 vêm antes.

**Opções**

- **A. 404 idêntico para quem não é admin, decidido no proxy.** O `proxy.ts` já chama `getUser()`; passa a conferir
  também papel e aal e, se faltar algo, faz `NextResponse.rewrite` para um caminho inexistente — o Next devolve o mesmo
  404 de qualquer rota desconhecida. `exigirAdmin()` chama `notFound()` no lugar dos dois `redirect`; sai
  `app/admin/sem-acesso/`; o route handler responde 404. *Prós:* 3 arquivos, mesmo domínio e mesmo cookie, nenhum
  segredo para guardar; saber o caminho deixa de ajudar. *Contras:* admin deslogado que abre `/admin` vê 404 (entra
  pelo app e clica em "Painel ADM" — o login já mora no app); os chunks em `/_next/static/chunks/app/admin/…` seguem
  públicos para quem souber a URL com hash (só código, nenhum dado).
- **B. Caminho secreto por rewrite** (`/<segredo>/*` → `/admin/*`, com `/admin` direto dando 404). O repo é público,
  então o segredo vive numa variável do build; os links do painel e o botão do app precisam dele — no
  `EXPO_PUBLIC_*` ele volta ao bundle público e a vantagem some. Mais peças (CI, rewrite + proxy) para continuar sendo
  obscuridade. Só faz sentido em cima de A.
- **C. Outro subdomínio para o painel.** O cookie é host-only, então quebra o login único, e a Hostinger tem 1 site só
  (custo zero). Descartada.
- **D. `basePath` do Next.** Vale para o app Next inteiro, inclusive o export do Expo servido de `public/` na raiz.
  Descartada.
- **E. Allowlist de IP no proxy.** O IP do dono muda (VPN, operadora) e o parceiro também usa o painel. Descartada.

**Recomendação: A**, com dois ajustes baratos:

1. `apps/admin/src/proxy.ts`:
   ```ts
   const { data: { user } } = await sb.auth.getUser();
   const { data: aal } = user ? await sb.auth.mfa.getAuthenticatorAssuranceLevel() : { data: null };
   const admin = user?.app_metadata?.role === 'admin' && !(aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2');
   // ponytail: o mesmo 404 de um caminho qualquer; é obscuridade — quem barra de fato é o is_admin() no banco.
   if (!admin) return NextResponse.rewrite(new URL('/_nao-existe', request.url));
   return response;
   ```
   Com o A2 adotado, trocar a condição de aal por `aal?.currentLevel === 'aal2'`.
2. `lib/auth.ts`: `notFound()` nos dois `redirect`; apagar `app/admin/sem-acesso/`; `status/externo/route.ts` → 404.
3. (Opcional) tirar o literal do bundle: o botão do app lê o destino de `app_metadata` (ex.: `painel: "/admin"`,
   gravado por `admin_definir_papel` ao promover), então só admin recebe o caminho, no próprio JWT; ajustar a
   conferência do `empacotar-front.sh:35-38`.
4. (Opcional) API: `exigir_admin` responde 404 a quem não é admin, e o Swagger sai do ar em produção (B3).
5. Não pôr `Disallow: /admin` no `robots.txt` (anunciaria a rota); o painel já tem `noindex`.

**Teste:** `curl -sI` anônimo (e com conta comum) em `/admin`, `/admin/usuarios`, `/admin/x` e `/nao-existe` deve
sair igual — status, `Content-Type` e `Vary`. Apertar o `admin-exposure.spec.ts` para exigir 404 idêntico ao de um
caminho inexistente.
