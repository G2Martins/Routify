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

## ⚠️ Supabase restaurado (2026-09-23) — segurança pendente

- Projeto de volta no ar (resume + restauração concluída às 01:34 UTC).
- **Dados íntegros:** `historico_trafego` 1.513.828 linhas (2026-03-07 → 2026-07-20), `vias_monitoradas` 630, `malha_completa` 45.476, `route_history` 17, 2 usuários; 168 MB.
- **Crítico:** as 3 tabelas do dataset estão sem RLS, com o `anon` podendo SELECT/INSERT/DELETE.
  - Correção pronta em `supabase/migrations/20260923000000_security_hardening.sql`.
  - **Aplicar primeiro a `20260907000000_thesis_validation.sql`** (nunca aplicada: faltam colunas de validação + policy de UPDATE; o feedback do app falha).
- **Backup local bruto** das 3 tabelas em `ml/artifacts/backup_20260923_*.parquet` (fora do git).
- **Pendente no painel:**
  - secrets do keep-alive no GitHub (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`);
  - "Leaked password protection" (Auth).

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
