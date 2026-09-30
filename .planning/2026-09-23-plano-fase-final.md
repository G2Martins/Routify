# Plano — plataforma unificada, ações ADM, segurança e deploy

**Última revisão:** 2026-09-23

## Decisões do dono (2026-09-23)

| Tema | Decisão |
| --- | --- |
| Arquitetura | **Mesmo domínio, login único.** App Expo em `/`, painel Next em `/admin`, mesma sessão Supabase por cookie. Só a role muda o que aparece. |
| Login | E-mail + senha agora, com a tela refeita no estilo Valerium. "Continuar com Google" fica no escopo, em backlog. Sem magic link. |
| Ações ADM | Todas: usuários, TomTom, dados e LIA, avisos e manutenção. Toda ação passa por checagem de role e rate limit no servidor e gera auditoria. |
| Acesso de infra do Claude | **Admin total**, escolha do dono. Mitigações obrigatórias: usuário IAM próprio (nunca a root), MFA na root, alarme de custo, credencial só em `~/.aws` e fora do repo. |
| Design | **Paleta = logo** (azul `#026BF8`, ciano `#059BC2`, teal `#09C6A4`, navy `#0F1F44`), nos modos claro e escuro. **Forma, tipografia e efeitos = Valerium:** Geist Sans/Mono, Kalam só em títulos, raio 8/12, sombras de cartão, botão outline que preenche no hover, escala 0,98 ao pressionar, entradas ease-out-expo, shimmer, grão 2% no claro, `prefers-reduced-motion`. |

## F7 — Plataforma unificada + login + design · ✅ código pronto (falta validação visual do dono)

**Tarefas:**
1. **Tokens da marca.** Tirados da logo, nos dois apps:
   - azul `#026BF8`, ciano `#059BC2`, teal `#09C6A4`, navy `#0F1F44`;
   - gradiente azul → ciano → teal como assinatura;
   - claro = neutro frio, escuro = tinta navy.
   - O tema é sincronizado entre app e painel pelo cookie `routify-tema`.
2. **Sessão única.** Na web, o Expo passa a usar `createBrowserClient` (`@supabase/ssr`), que guarda a sessão em cookie, e o painel lê o mesmo cookie. Em dev, `localhost:8081` e `:3000` já compartilham cookies, porque cookie não separa por porta.
3. **Painel sob `/admin`** (pasta `app/admin`), sem login próprio:
   - sem sessão → login do app (`NEXT_PUBLIC_APP_URL`);
   - sem role → "Sem acesso".
4. **Item "Painel ADM"** no SideRail e nas abas, só quando `app_metadata.role = admin`. É só UX: quem garante o acesso é o banco e a API.
5. **Login novo:**
   - layout dividido: marca à esquerda (gradiente + retícula de mapa animada), formulário à direita;
   - mostrar/ocultar senha, "esqueci a senha", mensagens de erro genéricas;
   - botão Google preparado atrás de uma flag, desligado.
6. **Efeitos (padrão Valerium):**
   - entradas de 600–900 ms com ease-out-expo;
   - micro-interações de 150–200 ms, com escala 0,98 ao pressionar;
   - skeleton com shimmer e elevação no hover;
   - respeita `prefers-reduced-motion`.

**Aceite:**
- entrar uma vez em `:8081` e abrir `:3000/admin` já logado;
- usuário comum não vê o item, e o `/admin` nega o acesso;
- `tsc` e `next build` passando.

## F8 — Ações do painel ADM (API `/admin/*`) · ✅ código pronto (falta aplicar a migration 4)

**Base (vale para todas as ações):**
- **Guard `exigir_admin`:** JWT → `auth.get_user` → `app_metadata.role`. A resposta é 401 sem token e 403 sem role.
- **Rate limit** por admin.
- **Auditoria:** tabela `admin_auditoria` (quem, ação, alvo, resumo, hash do IP, horário), só de inserção, com RLS de leitura para admin.
- **Contra corrida:** a ação recebe o estado-alvo (não é toggle), usa `unique` / `for update` nas linhas afetadas e pede confirmação digitada nas ações destrutivas.

**Ações:**

| Grupo | Ações |
| --- | --- |
| Usuários | promover/rebaixar (não rebaixa a si mesmo nem o último admin), bloquear/desbloquear, encerrar sessões, exportar dados (JSON), apagar dados (pedido LGPD) |
| TomTom | estado do pool por id, pausar/reativar chave, zerar cooldown, kill switch, orçamento por minuto, testar chave. Estado persistido em `config_runtime`, que a API relê com TTL e que sobrevive a restart |
| Dados e LIA | recalcular a qualidade agora, rodar o expurgo, recarregar a recência, marcar feedback como outlier (sai das métricas da tese) |
| Avisos | `avisos_app` (mensagem, nível, janela) lido pelo app; flags `referencia_tomtom` e `modo_so_lia` |

**Aceite:** pytest por ação, cobrindo: admin ok, usuário comum 403, sem token 401, IDOR, rate limit e auditoria gravada.

### F7+ (pedidos de 2026-09-23)

- **Auto-sugestão na busca de rota:**
  - com o campo em foco e vazio: destinos recentes do próprio usuário (`route_history`, RLS) + atalhos "Minha localização";
  - digitando: debounce de 250 ms, destaque do trecho encontrado, ícone da fonte, navegação por teclado (↑ ↓ Enter Esc) na web, skeleton enquanto carrega;
  - cancelar requisição obsoleta (AbortController).
- **Espaçamento e hierarquia (telas Painel, Perfil, Histórico, Mapa, Login):**
  - container com largura máxima (~1040 px) e escala de espaço 4/8/12/16/24/32/48;
  - cartões com borda + elevação no hover, grid responsivo de KPIs;
  - segmented control no lugar de pílulas de largura total.
- **Analytics de uso no painel:**
  - funil busca → rota → navegação iniciada → concluída;
  - fonte da sugestão escolhida e taxa de busca sem resultado (só contagens, **sem texto**);
  - vias/corredores mais usados;
  - mapa de calor de origens/destinos em grade de ~1 km, só com células de **≥ 3 usuários distintos** (k-anonimato, LGPD);
  - LIA × menor distância em produção.

## F9 — Segurança (padrões do Valerium) · 🟡 parcial (feito: 1, 4, 5, 6 em report-only, 7; falta: 2, 3 com testes, 8, 9)

Levantado no Valerium e adaptado. Lá é Hono/tRPC; aqui é FastAPI + Supabase.

1. **Rate limit:**
   - helper único `limitar(balde, identificador, janela, máximo, falha_fechada)` na API;
   - por IP em `/route` e `/search` (protege a cota TomTom), por usuário em `/eventos` e `/admin/*`;
   - resposta 429 com `Retry-After`;
   - **falha fechada** onde o recurso é caro ou sensível (admin, TomTom), aberta no resto;
   - armazenamento em memória por enquanto (1 réplica). Com mais de 1 réplica → tabela ou Redis.
2. **Login com trava por (e-mail, IP) + balde só por IP:**
   - a trava só por e-mail deixa um atacante bloquear a vítima;
   - a tentativa de login passa pela API (`POST /auth/login` → `auth.sign_in_with_password`), que registra `auth_tentativas` (service_role, RLS fechada).
   - Também: leaked password protection e rate limit de Auth no Supabase.
3. **IDOR:**
   - toda leitura/escrita por id filtra pelo dono **no servidor**;
   - quando não é o dono, a resposta é 404 (não 403: a existência já vaza informação);
   - o `user_id` sempre vem do JWT, nunca do corpo.
   - Teste por endpoint.
4. **Corpos estritos:** `extra="forbid"` em todo corpo (feito) + whitelist explícita de campos na escrita (nunca `**body`).
5. **Auditoria:** `admin_auditoria` append-only (RLS: select/insert, sem update/delete), helper `auditar()` best-effort, IP com hash + segredo.
6. **Headers/CSP no Next** (que também serve o export do Expo):
   - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`;
   - `connect-src` só API + Supabase + tiles;
   - HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` com geolocation=self (o app usa GPS);
   - COOP `same-origin-allow-popups` (para o Google OAuth futuro).
   - Primeiro em `Report-Only` atrás de uma flag. **Atenção:** a borda LiteSpeed da Hostinger sobrescreve o CSP (visto no Valerium) → conferir o header em produção.
7. **Corrida:**
   - ações por estado-alvo, `unique` + `on conflict` e intervalo mínimo por linha (`enforceMinInterval`);
   - feedback idempotente (`feedback_em` só grava se nulo);
   - teste de duplo envio.
8. **Sessão ociosa:** logout local após 30 min sem atividade, com aviso aos 25.
9. **Suíte `apps/api/tests/security/`:** idor, mass-assignment, rate-limit, parameter-pollution, xss (nas mensagens de aviso), idempotência.
10. **Callback OAuth (backlog Google):**
    - try/catch que nunca devolve 500 cru;
    - `redirectTo` sanitizado (anti open-redirect);
    - Site URL do Supabase = domínio de produção (incidente documentado no Valerium).

## F10 — Deploy (AWS + Hostinger) e GitHub Actions · ⏳ bloqueado (domínio + conta AWS)

- **AWS** (conta nova, créditos free):
  - usuário IAM `routify-claude` com AdministratorAccess + MFA na root + alarme de custo;
  - EC2 ARM com Docker rodando a API, HTTPS e `api.<domínio>`;
  - o RSS medido decide o tamanho da instância.
- **Hostinger:** um app Node = Next servindo `/admin` + o export web do Expo em `/` (fallback de SPA). Mesmo domínio → cookie único.
- **Actions:**
  - `deploy-api.yml`: imagem ARM → ECR → restart por SSM;
  - `deploy-web.yml` (modelo do `deploy-hostinger.yml` do Valerium):
    - build no runner, rsync por SSH com retry acima do ban do fail2ban;
    - `.env` em secret base64 + secrets discretos sobrepondo;
    - `tmp/restart.txt` no Passenger;
    - smoke test rodando no próprio servidor (a borda bloqueia o IP do runner);
    - protege `.next/static` antigo para não quebrar abas abertas;
  - `uptime.yml`: sonda a cada 15 min que abre/fecha uma issue "PROD DOWN";
  - environments com aprovação manual;
  - Dependabot + CodeQL.
- **Acesso do Claude:** profile `routify` no AWS CLI (`~/.aws`) + MCP da Hostinger.
- **Bloqueio:** falta o domínio do Routify.

## F11 — Traçado e fusão LIA × TomTom · ✅ feito e validado ao vivo

Ver [research/2026-09-23-tracado-contexto-apis.md](research/2026-09-23-tracado-contexto-apis.md):
- grafo de 38 km, conector tracejado, `entryPoints`;
- fusão por `supportingPoints`;
- semáforos do OSM + calibração;
- flag `VEL_LIVRE_TOMTOM` (experimento).

## Backlog

- "Continuar com Google": o dono cria o OAuth Client no Google Cloud; configurar o provider no Supabase + callback.
- Magic link / Resend (exige domínio verificado).
