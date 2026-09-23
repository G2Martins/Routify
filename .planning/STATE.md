# STATE — Routify

**Última revisão:** 2026-09-22

## Onde estamos

Fase final do TCC 2.

- **F0 Fundação:** feita, exceto o banco (bloqueio abaixo).
- **F0.5 Banca:** entregue em rascunho.
- **F2 TomTom sob demanda:** implementada na branch `feat/tomtom-sob-demanda`.

Já no `main` (e no remoto):
- `tcc2` do Pedro integrada (`0e066fb`);
- CLAUDE.md, `.planning/`, `.mcp.json.example`.

Na branch `feat/tomtom-sob-demanda` (local, aguardando OK pra push/merge):
- `apps/api/tomtom.py` + integração no `/route` e no `/search/places`, com 24 testes pytest. Teste real com o pool de 39 chaves passou: fluxo, incidentes, busca e rota de referência.
- `thesis_figures.py` → 4 figuras em `docs/figuras/` (MAE/RMSE por versão, calibração isotônica, benchmark, congestionamento).
- `docs/core/architecture.md` (diagramas pedidos pelo orientador) e `docs/tcc/resultados-e-limitacoes.md` (rascunho do texto).
- CI: `ci.yml` (pytest, tsc, gitleaks), `docs-links.yml` (lychee, do tpotce), `supabase-keepalive.yml`.

**Não executado end-to-end:** o `/route` completo precisa dos artefatos da LIA 2.1 (com o Pedro) e do Supabase de volta.

## ⚠️ Bloqueio: Supabase pausado

`vwbnragsacjxxulxenvg.supabase.co` → NXDOMAIN. O último dado é de 2026-07-19; é o comportamento conhecido de projeto free pausado por inatividade.

**Ação do dono da conta:** Dashboard → projeto → Resume. A janela de restauração do free é de 1 ano.

Depois de restaurar:
- exportar backup (o free não tem backup automático);
- configurar os secrets `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` no GitHub (keep-alive).

O Pedro tem o parquet silver completo (1,5 mi linhas): **preservar como backup**.

## Decisões tomadas (2026-09-22)

- Banco: só Supabase, sem MongoDB.
- MCP Supabase em `read_only=true` por padrão.
- `tcc2` integrada; coletor = implementação do main + cota com janela rolante de 24 h.
- `.gitignore`: "*.md só README", com exceções pra `CLAUDE.md`, `docs/`, `.planning/`.
- Admin = Next.js separado (`apps/admin`), design Valerium. Estrutura renomeada para `apps/` · `services/` · `ml/` · `supabase/` · `docs/` (executada em 2026-09-22).
- Hospedagem dividida: Hostinger (front web + admin) + host grátis pra API Python.
- **Convex descartado pra API** (sem Python, 512 MiB).
- TomTom sob demanda:
  - cooldown por (chave, serviço), porque a cota é mensal e por API;
  - só interdição bloqueia aresta (lentidão é papel da LIA + recência);
  - `referencia_tomtom` é opcional por gastar cota.
- Repo é público: nada de ref, domínio ou token de outra org.

## Escopo novo do Admin (pedido de 2026-09-22)

- Página **LIA — desempenho e benchmarks** (acompanhamento contínuo das fig. 1–4, histórico de treinos, erro real em produção, LIA × TomTom).
- **Arquitetura viva** (diagrama interativo dos fluxos API/LIA/Supabase/TomTom, com status por nó).
- **Captura de uso** feita pelo servidor, com LGPD.

Detalhe e ordem: [research/2026-09-22-nomenclatura-e-admin.md](research/2026-09-22-nomenclatura-e-admin.md).

## Decisões abertas

0. **Renomeação do monorepo** (`apps/api`, `apps/mobile`, `apps/admin`, `services/collector`, `ml/`, `supabase/migrations/`, `docs/`) — proposta no doc acima, aguardando OK.
1. Host da API: **AWS com créditos Free Tier** (opção levantada pelo dono; regras de 2025+ em verificação) × Cloud Run × Oracle Free × Azure for Students. Medir o RSS antes.
2. Domínio do Routify / Resend (conta nova).
3. Plano do Supabase (free com keep-alive × Pro).
4. Números finais da tese: re-rodar o CV da LIA 2.0/2.1 (pós-Optuna) — decisão do grupo (Pedro).
5. Pool de 39 chaves × ToS §14.2: manter só no protótipo e declarar na tese?

## Próximos passos

- [ ] Restaurar o Supabase → autenticar o MCP (OAuth em sessão interativa, `/mcp`).
- [ ] Via MCP (read-only): RLS das tabelas de tráfego, `pg_database_size`.
- [ ] Snapshot de `vias_monitoradas` no repo (fallback da API sem banco).
- [ ] Rodar a API com os artefatos da LIA 2.1 e validar o `/route` com a TomTom ao vivo.
- [ ] UI: mostrar incidentes/interdições e ETA TomTom no `NavigationPanel` (tipos já no `MapScreen`).
- [ ] F1 API segura (JWT Supabase, CORS allowlist, rate-limit, `route_history` pela API).
- [ ] F3 Observabilidade → F4 Auth + Resend → F5 Admin → F6 Deploy.

## Checklist do orientador (texto final)

- [x] Gráfico MAE/RMSE LIA 1.0 → 2.0 → 2.1 × baseline (`fig1`; números finais dependem do re-run)
- [x] Curva isotônica confiança × distância (`fig2`) + ressalva do recorte
- [x] Limitações e trabalhos futuros (rascunho, §6–7) + `fig4` do congestionamento
- [x] Diagrama de arquitetura (`docs/core/architecture.md`)
- [x] "Erro médio" = RMSE; coluna MAE na Tabela 1
- [ ] Equipe revisar/reescrever o rascunho e declarar o uso de IA
