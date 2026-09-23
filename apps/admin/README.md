# Routify — Painel ADM

**Última revisão:** 2026-09-23

Painel de observabilidade da plataforma e de acompanhamento da LIA. Next.js 16 (App Router) + Supabase (`@supabase/ssr`) + Recharts + React Flow, no design Valerium (papel claro, tokens HSL, Instrument Serif / IBM Plex).

## Rodar

```bash
npm install
cp .env.example .env.local   # preencha com as chaves PÚBLICAS (mesmas do app)
npm run dev                  # http://localhost:3000
```

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | chave publishable (nunca a service_role) |
| `NEXT_PUBLIC_API_URL` | API FastAPI, para o status ao vivo (`/health`) |

Passo a passo completo com API e app: [docs/core/rodar-local.md](../../docs/core/rodar-local.md).

## Páginas

| Rota | Conteúdo | Fonte |
|---|---|---|
| `/` | KPIs de uso, rotas por dia/hora, endpoints, eventos, status da API | RPC `admin_resumo_uso` + `/health` |
| `/lia` | MAE/RMSE por versão × baseline, calibração isotônica, LSTM × XGBoost, congestionamento, erro real em produção, histórico de versões | `lia_treinos`, `lia_analises`, RPC `admin_validacao_feedback` |
| `/arquitetura` | diagrama vivo dos fluxos (rota, busca, treino, dados & auth) com status por componente | `/health` + sonda RPC |
| `/uso` | últimas rotas (coordenadas ~110 m), eventos do app, requisições | `rotas_calculadas`, `eventos_app`, `api_requisicoes` |
| `/qualidade` | qualidade do dataset: nulos, outliers, duplicatas, cobertura hora × dia | RPC `admin_qualidade_dados` (views materializadas, pg_cron diário) |
| `/usuarios` | contas, papel, último login, nº de rotas | RPC `admin_usuarios` |

## Modelo de segurança

- **Login:** Supabase email/senha, com a mesma conta do app. O `src/proxy.ts` renova a sessão a cada requisição e manda quem não está logado para `/login`.
- **Papel:** admin = `app_metadata.role === 'admin'`. Só o banco (service_role) grava `app_metadata`, então ninguém se promove pelo app.
- **Checagem no servidor (`exigirAdmin`)** usa `getUser()`, que valida o token no Auth. É só UX: quem garante o acesso é o **banco**:
  - as tabelas de uso têm RLS de leitura admin;
  - as RPCs são `security definer` com checagem `is_admin()` e erro 42501 para quem não é admin.
- **Chaves:** o painel só tem a chave publishable, sem service_role.
- **Headers:** anti-clickjacking e `nosniff` em `next.config.ts`. Nenhum `dangerouslySetInnerHTML`.
- **Supply-chain:** dependências instaladas com `npm install --save-exact --before=<data − 7 dias>`, sem versões recém-publicadas. TypeScript fixado em 5.9 (o 7.x ainda não é suportado pelo `next build`).
