# STATE — Routify

**Última revisão:** 2026-09-22

## Onde estamos

Fase final do TCC 2 — **F0 Fundação**.

- `tcc2` do Pedro integrada ao `main` (`0e066fb`). Python compila; `tsc --noEmit` do FrontEnd verde; a API importa. API e app **ainda não executados** end-to-end (faltam localmente os artefatos da LIA 2.1 — `lia_2.1*.pkl`, `transfer_confidence_isotonic.pkl`, grafo de 38 km — que estão com o Pedro).
- CLAUDE.md (spec viva), `.mcp.json` corrigido (projeto Supabase certo, read-only), `.mcp.json.example`.
- Análise completa: [research/2026-09-22-analise-plataforma.md](research/2026-09-22-analise-plataforma.md).

## ⚠️ Bloqueio: Supabase fora do ar

`vwbnragsacjxxulxenvg.supabase.co` não resolve no DNS (NXDOMAIN, 2026-09-22). O último dado é de **2026-07-19** (a coleta parou), e o projeto free provavelmente foi pausado por inatividade. **Restaurar pelo dashboard o quanto antes** (projeto free pausado tem prazo para restauração pelo painel). Enquanto isso: a API sobe em modo degradado (sem vínculo às vias → heurística) e o MCP não conecta.

Backup de segurança do dataset: o Pedro tem o parquet silver completo (1,5 mi linhas, usado na LIA 2.1) — **preservar**.

## Decisões tomadas (2026-09-22)

- Banco: só Supabase, sem MongoDB.
- MCP Supabase em `read_only=true` por padrão (dataset do TCC é sagrado).
- `tcc2` integrada; coletor = implementação do main + cota com janela rolante de 24 h (do Pedro).
- `.gitignore`: mantém "*.md só README" do Pedro, com exceções pra `CLAUDE.md`, `Docs/`, `.planning/`.
- Admin = app **Next.js separado** (`apps/admin`) com o design Valerium.
- Estrutura: **manter `BackEnd/` e `FrontEnd/`** + adicionar `apps/admin`.
- Hospedagem **dividida**: Hostinger (front web + admin) + host grátis pra API Python.
- Repo é **público**: nada de ref, domínio ou token de outra org nos docs.

## Decisões abertas

1. Host exato da API (medir o RSS antes).
2. Domínio do Routify / Resend (conta nova).
3. Plano do Supabase (free 500 MB × Pro) — relevante agora que o free pausou.
4. Cota free TomTom: diária ou mensal? (verificar no my.tomtom.com)

## Próximos passos

- [ ] **Restaurar o projeto Supabase** (dashboard) → depois autenticar o MCP.
- [ ] Via MCP (read-only): RLS das tabelas de tráfego, `pg_database_size`, contagem de `historico_trafego`.
- [ ] Exportar um snapshot de `vias_monitoradas` (630 linhas) pro repo, como fallback da API quando o Supabase cair.
- [ ] Rodar a API e o app com os artefatos da LIA 2.1 (smoke: `/health`, `/route`, login, histórico).

## Checklist do orientador (texto final)

- [ ] Gráfico MAE/RMSE LIA 1.0 → 2.0 → 2.1 × baseline
- [ ] Curva isotônica confiança × distância
- [ ] Limitações: semáforos não modelados; subestima congestionamento extremo → trabalhos futuros
- [ ] Diagrama de arquitetura (cache de recência, rotação de chaves, fallback da busca)
- [ ] Corrigir no texto: "Erro médio" = RMSE; acrescentar a coluna MAE
