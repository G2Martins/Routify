# Routify — Painel ADM

**Última revisão:** 2026-11-03

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
| `NEXT_PUBLIC_API_URL` | API FastAPI: `/health` (público: no ar, modelo, recência), `/admin/saude` (o mesmo com o pool TomTom), `/admin/sistema` e `/admin/tomtom`, os três com o JWT da sessão |

Passo a passo completo com API e app: [docs/core/rodar-local.md](../../docs/core/rodar-local.md).

## Páginas

| Rota | Conteúdo | Fonte |
|---|---|---|
| `/` | KPIs de uso, rotas por dia/hora, endpoints, eventos, status da API | RPC `admin_resumo_uso` + `/admin/saude` |
| `/lia` | MAE/RMSE por versão × baseline, calibração isotônica, LSTM × XGBoost, congestionamento, estresse treino × produção da LIA 2.2, erro real em produção (com exclusão de outlier + motivo), histórico de versões. KPIs, baseline e destaque dos gráficos seguem a **versão ativa** (`/health` → `modelo_ativo`; se a API não responde, cai na LIA 2.1 e avisa) | `lia_treinos`, `lia_analises` (`estresse_lia22`), RPCs `admin_validacao_feedback` e `admin_feedback_excluir`, `/health` |
| `/provedores` | **LIA × provedores** (defesa do TCC), janela 7/30/90 dias: modelo ativo (receita, CV × persistência × perfil); KPIs contra a TomTom ao vivo (LIA no mesmo trajeto, Routify, OSRM e os opcionais que existirem); LIA × modelos históricos (ETA só pelo histórico da TomTom no mesmo trajeto e típico do Mapbox, pareados contra a TomTom ao vivo); tabela da última rodada por corredor com régua de desvio; viés mediano por hora; rotas reais (dispersão + viés por hora); ablação 2.2 → 2.3 com erro por idade da leitura; avaliação fora do tempo; Fase 3 histórica; metodologia e limitações | RPCs `admin_lia_vs_provedores` (migration `20261102000000_lia_vs_provedores.sql`; sem ela a página avisa e renderiza o resto) e `admin_provedores_historicos` (`20261102010000_provedores_historicos.sql`), `lia_treinos`, `lia_analises` (`ablation_lia_2_3`, `avaliacao_fora_do_tempo`, `fase3_comparacao`, `cobertura_dataset`) e `/health` |
| `/arquitetura` | diagrama vivo dos fluxos (rota, busca, treino, validação contínua, dados & auth) com status por componente | `/admin/saude` + sonda RPC |
| `/uso` | funil, mistura de fontes da busca, LIA × menor distância, hora × dia, mapa de calor k-anônimo (janela 7/30/90 dias) + últimas rotas, eventos e requisições | RPC `admin_analytics_uso`, `rotas_calculadas`, `eventos_app`, `api_requisicoes` |
| `/qualidade` | qualidade do dataset: nulos, outliers, duplicatas, cobertura hora × dia | RPC `admin_qualidade_dados` (views materializadas, pg_cron diário) |
| `/usuarios` | contas, papel, situação + menu de ações: promover/rebaixar, bloquear, encerrar sessões, exportar dados (JSON) e apagar dados (LGPD) | RPC `admin_usuarios` + RPCs `admin_*` |
| `/status` | status ao vivo a cada 30 s: API da LIA na EC2 (tempo de resposta, modelo, recência, chaves), banco (tamanho × 500 MB do plano grátis, conexões), coleta (último lote, linhas/h), comparador, site na Hostinger, máquina da API (CPU ocupada e roubada, memória, swap, disco, serviços), uso da API em 24 h, jobs do pg_cron e as páginas de status oficiais de Supabase, Hostinger, GitHub e AWS us-east-1 | RPC `admin_status_dados`, API `/health` (no ar e tempo de resposta), `/admin/saude` (chaves) e `/admin/sistema`, `./status/externo` (servidor do painel, URLs fixas) |
| `/operacao` | modos da API (kill switch TomTom, só LIA, rota TomTom na fusão, orçamento/min), pool de chaves (estado a cada 15 s, pausar, testar, zerar cooldowns), **uso real das chaves no mês** (coletor + API por serviço, projeção contra a cota, por chave), avisos do app, recalcular qualidade e expurgo | `config_runtime`, `avisos_app`, API `/admin/tomtom`, RPCs `admin_*` e `admin_tomtom_uso` |
| `/auditoria` | trilha de ações do ADM, 50 por página, filtro por ação e por quem fez | `admin_auditoria` |

### Notas da página `/provedores`

- **Séries pelos dados.** Os provedores dos gráficos e das tabelas saem do que a RPC devolve (`por_hora`, `vs_tomtom`, `provedores`): o Mapbox só aparece se o comparador tiver o token. Nomes de exibição, ordem e cores ficam em `src/lib/provedores.ts`; tracejado = provedor sem trânsito (`com_transito = false` no dado).
- **Tokens de gráfico.** `--chart-4` (violeta) e `--chart-5` (rosa) foram criados em `globals.css`, nos 3 blocos de tema.
- **Estado vazio honesto.** Cada seção diz o que falta (comparador sem rodadas, rotas reais sem referência, ablação ou fora do tempo não publicados). A ablação `--smoke` vem com aviso de que não é número de tese.
- **Nomes dos corredores.** A tabela guarda só o slug; `src/lib/provedores.ts` espelha `CORREDORES` de `services/collector/comparar_provedores.py`, e slug novo aparece como texto legível até o espelho ser atualizado.

## Modelo de segurança

- **Login:** Supabase email/senha, com a mesma conta do app (o login é no app). O `src/proxy.ts` renova a sessão a cada requisição; quem não pode ver o painel (sem sessão, sem papel admin, etapa 2 do MFA pendente) recebe o **mesmo 404** de um endereço que não existe, e `exigirAdmin()` faz o mesmo nas páginas (`src/lib/acesso.ts`): o painel não se anuncia. Cookie da sessão Secure em produção e com 30 dias (`src/lib/cookie.ts`, mesmas opções do app).
- **Papel:** admin = `app_metadata.role === 'admin'`. Só o banco (service_role) grava `app_metadata`, então ninguém se promove pelo app.
- **Checagem no servidor (`exigirAdmin`)** usa `getUser()`, que valida o token no Auth. É só UX: quem garante o acesso é o **banco**:
  - as tabelas de uso têm RLS de leitura admin;
  - as RPCs são `security definer` com checagem `is_admin()` e erro 42501 para quem não é admin.
- **Ações:** toda escrita é uma RPC `admin_*` (migration `20260923020000_admin_actions.sql`) que checa `is_admin()`, trava duplo envio e grava `admin_auditoria` na mesma transação; o que depende do processo da API (pool TomTom) vai para `/admin/*` com o JWT da sessão, validado a cada chamada. Sem UI otimista em ação destrutiva: espera a resposta e dá `router.refresh()`. Peças compartilhadas em `src/components/acoes.tsx` (`useAcao`, `ConfirmarDialog`, `Interruptor`) e o mapa de erros em `src/lib/erros.ts`.
- **Chaves:** o painel só tem a chave publishable, sem service_role.
- **Headers:** anti-clickjacking e `nosniff` em `next.config.ts`; CSP separada para o app (`/`, sem script inline) e o painel (`/admin`, com `'unsafe-inline'` pela hidratação do Next), em Report-Only até `CSP_ENFORCE=1`; `X-Robots-Tag: noindex` no `/admin`; sem otimizador de imagem (`images.unoptimized`). Nenhum `dangerouslySetInnerHTML`.
- **Supply-chain:** dependências instaladas com `npm install --save-exact --before=<data − 7 dias>`, sem versões recém-publicadas. TypeScript fixado em 5.9 (o 7.x ainda não é suportado pelo `next build`).
