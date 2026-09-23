# STATE — Routify

**Última revisão:** 2026-09-23 (madrugada)

Plano da fase: [2026-09-23-plano-fase-final.md](2026-09-23-plano-fase-final.md) · Pesquisa de traçado/contexto/APIs: [research/2026-09-23-tracado-contexto-apis.md](research/2026-09-23-tracado-contexto-apis.md)

## Onde estamos

| Fase | Estado |
| --- | --- |
| F0 Fundação / F0.5 Banca | feitas (rascunho da banca entregue) |
| F2 TomTom sob demanda | feita |
| F3 Captura de uso | feita; migrations 1–3 aplicadas pelo dono em 2026-09-23 |
| F7 Plataforma unificada + design | **feita no código**: paleta da logo + linguagem Valerium nos dois apps, login refeito, sessão única (cookie) app ↔ `/admin`, item "Painel ADM" por role, auto-sugestão nova. Falta validação visual do dono |
| F8 Ações ADM | backend feito (RPCs + API `/admin`); UI em construção (agente); **migration 4 pendente** |
| F9 Segurança | parcial: rate limit por IP, auditoria append-only, anti-corrida, `extra=forbid` em todos os corpos, feedback único. Falta: CSP/headers no deploy, suíte `tests/security/`, trava de login por (e-mail, IP), sessão ociosa |
| F10 Deploy (AWS + Hostinger + Actions) | não iniciado — precisa de domínio + conta AWS |
| F11 Traçado + fusão LIA × TomTom | **feita e validada ao vivo**: grafo 38 km, conector tracejado, `entryPoints`, fusão por `supportingPoints`, semáforos OSM (271 cruzamentos) + calibração |

## Verificado nesta sessão

- API (venv com versões fixadas): 45 testes; subida com LIA 2.1 do Pedro, grafo 97.739 nós, 271 semáforos.
- Rotas reais:
  - Águas Claras → Ceilândia chega ao destino (antes grudava a 10 km);
  - destino em Goiás cai na rota da TomTom.
- Fusão: a TomTom reconstruiu a rota da LIA (11,03 km iguais). No mesmo trajeto: LIA 710 s × TomTom 875 s (sem trânsito, 901 s) — a diferença motivou o atraso de semáforo.
- Mobile `tsc` ok · admin `tsc` + `next build` ok (antes da UI de ações).
- Varredura de segredos (arquivos versionáveis + histórico): limpa. `.gitignore` passou a cobrir `*.pem`, `*.key`, `.aws/`, tfstate.

## Decisões tomadas (2026-09-23)

- Mesmo domínio e login único; admin via `app_metadata.role`; Google em backlog; sem magic link.
- **Paleta = logo; forma/tipografia/motion = Valerium** (Geist, Kalam só em títulos).
- Ações ADM = todas (usuários, TomTom, dados/LIA, avisos), como RPC com auditoria na mesma transação.
- Acesso de infra do Claude = admin total (com usuário IAM próprio, MFA na root, alarme de custo).
- Fusão LIA × TomTom:
  - a LIA decide onde enxerga;
  - a TomTom preenche lacunas e só troca a rota com ganho ≥ 10% e ≥ 60 s.
- Semáforo: atraso δ calibrado contra a TomTom (artefato versionado), aplicado igual na rota da LIA e na baseline.
- Tiles do mapa: continuam OSM/Esri; TomTom "night" só com chave dedicada e restrição de domínio.
- **`lia_2.1` = modelo do Pedro** (bate com o metadata versionado). O retreino de 22/09 foi para `lia_2.1_retreino_20260923` (ambiente errado; não usar na tese).
- API e `ml/` rodam em `apps/api/.venv` (pandas 3.0 / xgboost 3.2 / sklearn 1.8).
- RAG/TabR/TimeGPT: **não**. Próximas features: vizinhos, chuva, feriado, incidente; harness de avaliação; contrato de features.

## Decisões abertas (do dono / grupo)

1. Qual modelo é a "LIA 2.1" da tese: hiperparâmetros manuais (Pedro) × Optuna. Re-rodar `train.py` no venv antes dos números finais.
2. Domínio do Routify (bloqueia deploy, Resend e Google OAuth).
3. Host da API: AWS (créditos) — criar a conta.
4. Pool de 39 chaves × ToS §14.2 — declarar na tese.

## Próximos passos

- [ ] Dono: aplicar `20260923020000_admin_actions.sql`; validar visualmente app + painel (roteiro em [docs/core/rodar-local.md](../docs/core/rodar-local.md)).
- [ ] Recalibrar semáforo em horário comercial (a calibração atual foi de madrugada).
- [ ] Features de contexto na LIA (vizinhos t−1, Open-Meteo, BrasilAPI) + harness de avaliação + teste de contrato de features.
- [ ] Snap na aresta (em vez do nó) para eliminar o conector.
- [ ] F9 restante (CSP, suíte de segurança, trava de login, sessão ociosa) → F10 deploy.

## Checklist do orientador (texto final)

- [x] Gráfico MAE/RMSE LIA 1.0 → 2.0 → 2.1 × baseline (`fig1`; números finais dependem do re-run)
- [x] Curva isotônica confiança × distância (`fig2`) + ressalva do recorte
- [x] Limitações e trabalhos futuros — **atualizar:** o semáforo agora tem tratamento calibrado; a fusão com a TomTom cobre as lacunas
- [x] Diagrama de arquitetura (`docs/core/architecture.md`) + versão viva no painel — **atualizar** com a fusão
- [x] "Erro médio" = RMSE; coluna MAE na Tabela 1
- [ ] Equipe revisar/reescrever o rascunho e declarar o uso de IA
