# STATE — Routify

**Última revisão:** 2026-09-23

## Onde estamos

Fase final do TCC 2.

| Fase | Estado |
|---|---|
| F0 Fundação | feita (banco restaurado; migrations pendentes, abaixo) |
| F0.5 Banca | entregue em rascunho (figuras, arquitetura, resultados) |
| F1 API segura | parcial: CORS allowlist + JWT verificado; falta rate-limit por cliente e `route_history` pela API |
| F2 TomTom sob demanda | feita e validada ao vivo (39 chaves) |
| F3 Observabilidade / captura de uso | código pronto (`usage.py`, `/eventos`, eventos no app); **grava depois da migration** |
| F5 Admin | `apps/admin` pronto (6 páginas, `tsc` + `next build` ok); precisa das migrations |
| F4 Auth + Resend · F6 Deploy | não iniciadas |

Verificado localmente em 2026-09-23:
- API sobe com LIA 2.1, 39 chaves e 630 vias;
- `/route` com TomTom: 8 vias atualizadas, 18 arestas interditadas, ETA de referência;
- `/eventos`: 401 sem token e 422 com campo extra; CORS recusa origem fora da lista;
- 37 testes pytest; `tsc` do mobile e do admin; `next build` do admin.

Retreino local da LIA 2.1 confirmou os números do Pedro: RMSE 40,92 × 40,69, MAE 15,03 × 14,62 (`ml/artifacts/lia_2.1_retreino_20260923_metadata.json`).

## ⚠️ Banco — aplicar (bloqueia captura de uso e painel)

Em ordem, todas idempotentes:
1. `20260907000000_thesis_validation.sql` (Pedro, nunca aplicada);
2. `20260923000000_security_hardening.sql` — RLS nas 3 tabelas do dataset. Hoje o `anon` lê e apaga;
3. `20260923010000_usage_tracking_admin.sql`.

Depois:
- promover os 2 admins (SQL em `supabase/.local/aplicar-2026-09-23.sql`, gitignored, já com as 3 migrations concatenadas);
- `python ml/publish_metrics.py`.

**Como aplicar:** o MCP Supabase está sem `read_only`, mas precisa de OAuth numa sessão interativa (`/mcp`). Alternativa: colar o arquivo no SQL Editor. Passo a passo em [docs/core/rodar-local.md](../docs/core/rodar-local.md).

Backup bruto das 3 tabelas em `ml/artifacts/backup_20260923_*.parquet` (1.513.828 / 630 / 45.476 linhas, fora do git).

**Pendente no painel do Supabase:**
- secrets do keep-alive no GitHub (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`);
- "Leaked password protection" (Auth).

## Decisões tomadas

- Banco: só Supabase, sem MongoDB.
- `tcc2` integrada; coletor = implementação do main + cota com janela rolante de 24 h.
- Estrutura `apps/` · `services/` · `ml/` · `supabase/` · `docs/` (2026-09-22).
- Admin = Next.js separado (`apps/admin`), design Valerium.
- Admin = `app_metadata.role`. As RPCs `security definer` checam `is_admin()`; o painel só tem a chave publishable.
- Captura de uso **pelo servidor** (service_role):
  - coordenadas arredondadas em 3 casas;
  - texto de busca nunca gravado;
  - retenção de 90 dias via `pg_cron`.
- Hospedagem dividida: Hostinger (front web + admin) + host grátis pra API Python. Candidato principal: AWS (t4g.small, créditos free). **Convex descartado** (sem Python, 512 MiB).
- TomTom sob demanda:
  - cooldown por (chave, serviço);
  - só interdição bloqueia aresta;
  - `referencia_tomtom` opcional.
- MCP Supabase com escrita liberada (2026-09-23, pedido do dono), só com arquivo versionado.
- Repo público: nada de ref, domínio ou token de outra org.

## Decisões abertas

1. Host da API: AWS × Cloud Run × Oracle Free × Azure for Students. Medir o RSS antes.
2. Domínio do Routify / Resend (conta nova).
3. Plano do Supabase (free com keep-alive × Pro).
4. Números finais da tese: re-rodar o CV da LIA 2.0/2.1 pós-Optuna (grupo/Pedro).
5. Pool de 39 chaves × ToS §14.2: manter só no protótipo e declarar na tese?
6. Commitar `lia_2.1_retreino_20260923_metadata.json`? Hoje entra como histórico no painel (`publish_metrics`).

## Próximos passos

- [ ] Aplicar as 3 migrations + promover admins + `publish_metrics.py` → conferir o Security Advisor sem ERROR.
- [ ] Testar ponta a ponta com o [rodar-local](../docs/core/rodar-local.md) (visão de usuário + ADM).
- [ ] UI: incidentes/interdições e ETA TomTom no `NavigationPanel` (tipos já no `MapScreen`).
- [ ] Texto de consentimento LGPD na tela Privacy (captura de uso + retenção de 90 dias).
- [ ] F1 restante: rate-limit por cliente em `/route`/`/search`; `route_history` gravado pela API.
- [ ] F4 Auth polida + Resend (SMTP custom no Supabase) → F6 Deploy (API na AWS, web + admin na Hostinger).

## Checklist do orientador (texto final)

- [x] Gráfico MAE/RMSE LIA 1.0 → 2.0 → 2.1 × baseline (`fig1`; números finais dependem do re-run)
- [x] Curva isotônica confiança × distância (`fig2`) + ressalva do recorte
- [x] Limitações e trabalhos futuros (rascunho, §6–7) + `fig4` do congestionamento
- [x] Diagrama de arquitetura (`docs/core/architecture.md`) + versão viva no painel ADM
- [x] "Erro médio" = RMSE; coluna MAE na Tabela 1
- [ ] Equipe revisar/reescrever o rascunho e declarar o uso de IA
