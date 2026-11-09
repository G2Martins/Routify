# Testes ponta a ponta (Playwright)

**Última revisão:** 2026-11-09

Suíte que confere o produto **já implantado** (front na Hostinger + API na EC2). Não sobe nada local. Só Chromium. O repositório é público, então os domínios de produção **não** ficam aqui: vêm de variáveis de ambiente, e a suíte aborta com uma mensagem clara se faltarem.

## Como rodar

```bash
cd tests/e2e && npm ci && npx playwright install chromium && BASE_URL=... API_URL=... npx playwright test
```

| Variável | Obrigatória | O que é |
|---|---|---|
| `BASE_URL` | sim | origem do front, sem barra no fim (`https://…`) |
| `API_URL` | sim | origem da API, sem barra no fim (`https://…`) |
| `E2E_EMAIL` · `E2E_PASSWORD` | não | conta de teste dedicada (sem 2FA, sem papel admin). Sem elas, os testes atrás do login são **pulados** |

Úteis: `npx playwright test -g "CSP"` (um teste), `--headed` (ver o navegador), `npx playwright show-report` (relatório HTML em `playwright-report/`, com os valores impressos por cada teste nas anotações).

## O que cobre

| Arquivo | Testes |
|---|---|
| `app-shell.spec.ts` | 1. `/` dá 200, tem título e nenhum `pageerror`; o `<title>` não vira o nome da tela ("Login", "Mapa") depois que o app monta; o mapa (canvas do MapLibre ou container do Leaflet) renderiza em 20 s (com sessão) |
| `csp.spec.ts` | 2. zero eventos `securitypolicyviolation` na carga e numa busca. Imprime as diretivas violadas e as origens bloqueadas |
| `security-headers.spec.ts` | 3. HSTS, `nosniff`, Referrer-Policy, X-Frame-Options/frame-ancestors e CSP(-Report-Only) em `/` e em `API_URL/health`; imprime os valores |
| `admin-exposure.spec.ts` | 4. `/admin*` sem sessão não entrega o painel (redirecionamento ou 404 passam); a API recusa `/admin/tomtom` sem token |
| `search.spec.ts` | 5. "park shopping" → 1º resultado é o Park Shopping do Guará; "rodoviaria" → sugestão com "Rodoviária". Direto na API (sempre) e pela interface (com sessão) |
| `route-api.spec.ts` | 6. `GET /health` = ok; `POST /route` Brasal → Park Shopping: 200, 3,5–7 km, < 10 s |
| `login.spec.ts` | 7. tela de login com e-mail/senha; MFA inalcançável sem sessão (inclusive `?preview=mfa|mapa`, que só existem em build de desenvolvimento) |
| `responsivo.spec.ts` | Login, cadastro e todas as telas em 360, 390, 768 e 1366 px: nada fora da largura, alvo de toque ≥ 44 px, nenhum travessão. Fluxos em 390 px: Planejar (saída troca, janela sem madrugada), detalhe do ponto no Trânsito e radares lembrados depois de recarregar. **Com a API simulada**: não gasta TomTom nem limite por IP, e bloqueia escrita em `route_history` |
| `seo-files.spec.ts` | 8. `/robots.txt`, `/sitemap.xml`, `/llms.txt`: status, content-type e corpo |

## Leitura do resultado

- **Atrás do login.** O `RootNavigator` só mostra o mapa com sessão; sem ela aparece o login. Por isso o teste do mapa, a busca pela interface e a parte "mapa" da CSP só rodam com `E2E_EMAIL`/`E2E_PASSWORD`. Sem credenciais, a busca é conferida direto na API e, no teste de CSP, por um `fetch` de dentro da página (exercita `connect-src` e CORS a partir da origem do front).
- **Os testes não gravam dado de usuário.** Não escolhem sugestão nem calculam rota pela interface (isso criaria `route_history`). O único `POST /route` é o do teste 6, anônimo.
- **Falha esperada (`test.fail`).** Os arquivos de SEO dão 404 até serem publicados: enquanto isso o teste é marcado como falha esperada (a lista mostra `x`, mas conta como aprovado, e a anotação diz "falha esperada: ainda não publicado"). A marca é decidida em tempo de execução, só com status 404: publicado o arquivo, o teste passa a valer de verdade (status 200, content-type e corpo corretos) sem mexer no código.
- **CSP em Report-Only.** O navegador dispara o evento mesmo sem bloquear. O teste exige que a página venha com uma política com `default-src`; sem isso "zero violações" não provaria nada. A borda da Hostinger acrescenta `content-security-policy: upgrade-insecure-requests`, que não conta como política da aplicação.
- **API sem CSP.** `API_URL/health` não manda `Content-Security-Policy`. É lacuna de baixa gravidade (resposta JSON), mas o teste 3 a aponta. Correção de uma linha no Caddy: `header Content-Security-Policy "default-src 'none'; frame-ancestors 'none'"`.

## Cuidados com a produção

- Rodam em série (1 worker) para não estourar os limites por IP da API: `/route` 20/min e `/search` 90/min, compartilhados com usuários reais. Uma execução completa faz 1 `POST /route` e poucas buscas. Cada rota gasta cota da TomTom; não rode em laço.
- `retries: 1` e trace só na repetição (`test-results/`). `test-results/` e `playwright-report/` ficam fora do git: contêm os domínios.
- Não faz parte do CI (`.github/workflows/`): bate na produção.
