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
| `NEXT_PUBLIC_API_URL` | API FastAPI: status ao vivo (`/health`) e pool TomTom (`/admin/tomtom`, com o JWT da sessão) |

Passo a passo completo com API e app: [docs/core/rodar-local.md](../../docs/core/rodar-local.md).

## Páginas

| Rota | Conteúdo | Fonte |
|---|---|---|
| `/` | KPIs de uso, rotas por dia/hora, endpoints, eventos, status da API | RPC `admin_resumo_uso` + `/health` |
| `/lia` | MAE/RMSE por versão × baseline, calibração isotônica, LSTM × XGBoost, congestionamento, erro real em produção (com exclusão de outlier + motivo), histórico de versões | `lia_treinos`, `lia_analises`, RPCs `admin_validacao_feedback` e `admin_feedback_excluir` |
| `/arquitetura` | diagrama vivo dos fluxos (rota, busca, treino, dados & auth) com status por componente | `/health` + sonda RPC |
| `/uso` | funil, mistura de fontes da busca, LIA × menor distância, hora × dia, mapa de calor k-anônimo (janela 7/30/90 dias) + últimas rotas, eventos e requisições | RPC `admin_analytics_uso`, `rotas_calculadas`, `eventos_app`, `api_requisicoes` |
| `/qualidade` | qualidade do dataset: nulos, outliers, duplicatas, cobertura hora × dia | RPC `admin_qualidade_dados` (views materializadas, pg_cron diário) |
| `/usuarios` | contas, papel, situação + menu de ações: promover/rebaixar, bloquear, encerrar sessões, exportar dados (JSON) e apagar dados (LGPD) | RPC `admin_usuarios` + RPCs `admin_*` |
| `/operacao` | modos da API (kill switch TomTom, só LIA, rota TomTom na fusão, orçamento/min), pool de chaves (estado a cada 15 s, pausar, testar, zerar cooldowns), avisos do app, recalcular qualidade e expurgo | `config_runtime`, `avisos_app`, API `/admin/tomtom`, RPCs `admin_*` |
| `/auditoria` | trilha de ações do ADM, 50 por página, filtro por ação e por quem fez | `admin_auditoria` |

## Modelo de segurança

- **Login:** Supabase email/senha, com a mesma conta do app. O `src/proxy.ts` renova a sessão a cada requisição e manda quem não está logado para `/login`.
- **Papel:** admin = `app_metadata.role === 'admin'`. Só o banco (service_role) grava `app_metadata`, então ninguém se promove pelo app.
- **Checagem no servidor (`exigirAdmin`)** usa `getUser()`, que valida o token no Auth. É só UX: quem garante o acesso é o **banco**:
  - as tabelas de uso têm RLS de leitura admin;
  - as RPCs são `security definer` com checagem `is_admin()` e erro 42501 para quem não é admin.
- **Ações:** toda escrita é uma RPC `admin_*` (migration `20260923020000_admin_actions.sql`) que checa `is_admin()`, trava duplo envio e grava `admin_auditoria` na mesma transação; o que depende do processo da API (pool TomTom) vai para `/admin/*` com o JWT da sessão, validado a cada chamada. Sem UI otimista em ação destrutiva: espera a resposta e dá `router.refresh()`. Peças compartilhadas em `src/components/acoes.tsx` (`useAcao`, `ConfirmarDialog`, `Interruptor`) e o mapa de erros em `src/lib/erros.ts`.
- **Chaves:** o painel só tem a chave publishable, sem service_role.
- **Headers:** anti-clickjacking e `nosniff` em `next.config.ts`. Nenhum `dangerouslySetInnerHTML`.
- **Supply-chain:** dependências instaladas com `npm install --save-exact --before=<data − 7 dias>`, sem versões recém-publicadas. TypeScript fixado em 5.9 (o 7.x ainda não é suportado pelo `next build`).
