# STATE — Routify

**Última revisão:** 2026-09-23 (noite)

Plano da fase: [2026-09-23-plano-fase-final.md](2026-09-23-plano-fase-final.md) · Pesquisa de traçado/contexto/APIs: [research/2026-09-23-tracado-contexto-apis.md](research/2026-09-23-tracado-contexto-apis.md)

## Onde estamos

| Fase | Estado |
| --- | --- |
| F0 Fundação / F0.5 Banca | feitas (rascunho da banca entregue) |
| F2 TomTom sob demanda | feita |
| F3 Captura de uso | feita; migrations 1–3 aplicadas pelo dono em 2026-09-23 |
| F7 Plataforma unificada + design | **feita no código**: paleta da logo + linguagem Valerium nos dois apps, login refeito, sessão única (cookie) app ↔ `/admin`, item "Painel ADM" por role, auto-sugestão nova. Falta validação visual do dono |
| F8 Ações ADM | feita; migration 4 (`admin_actions`) aplicada via MCP em 2026-09-23 |
| F9 Segurança | parcial: rate limit por IP, auditoria append-only, anti-corrida, `extra=forbid` em todos os corpos, feedback único. Falta: CSP/headers no deploy, suíte `tests/security/`, trava de login por (e-mail, IP), sessão ociosa |
| F10 Deploy (AWS + Hostinger + Actions) | **no ar em 2026-09-23**: front na Hostinger (SSL ativo) + API na EC2 t3.small (Caddy/Let's Encrypt, ufw, systemd sem root, LIA 2.2). Validado de fora: CORS só do front, rota e busca pelo HTTPS público ([deploy.md](../docs/core/deploy.md)). Falta: GitHub Actions |
| F12 LIA 2.2 (contexto) | **feita**: vizinhos + chuva + feriado, mesmo código no treino e na API; padrão da API; estresse treino × produção versionado |
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

- **Rota "pela LIA"** (pedido do dono): o app não mostra provedor; quando a rota do trânsito ao vivo vence, o selo é "Trânsito ao vivo" e a via é o nome real. O crédito "Trânsito © TomTom · Tempo: Open-Meteo" fica no rodapé do mapa (termos da TomTom e licença CC BY do Open-Meteo).
- Busca ranqueada na API (marco, aglomeração, distância, casamento de nome) + bairro no rótulo; categoria em português no selo.
- Combustível economizado por rota (Evans–Herman–Lam) no card, no Painel do usuário e no painel ADM (RPC `admin_economia_combustivel`).
- Contramão: checagem por trecho das duas rotas IESB → Elétrica Lara contra as arestas dirigidas do OSM não achou violação; aguardando print do trecho visto pelo dono.

- **Custo zero** (projeto acadêmico; termina em dez/2026): Hostinger com 1 site Node (Expo export em `/` + painel em `/admin`) e API na AWS plano Free, t3.small us-east-1, crédito de CPU Standard (~US$ 67 de US$ 100 até 31/12). HF Spaces fora (Docker exige PRO), Render/Koyeb fora (512 MB).
- **LIA 2.1 da tese = modelo do Pedro** (manual). Optuna testado e não adotado. **LIA 2.2** (2.1 + contexto) = padrão da API: RMSE 40,88 → 40,27 s (5/5 folds), MAE 14,51 → 14,44 s (3/5), estresse em `lia_2.2_estresse.json`. Chuva ausente → 0; incidente não vira feature (sem histórico).
- Grafo enxuto em pickle: API de 1,65 GB para 0,79 GB de RAM, sem mudar a rota (mesma via e distância no teste).
- Isotônica do transfer regravada com sklearn 1.8 (mesma curva, diferença 0,0 numa grade de 1 m): sumiu o `InconsistentVersionWarning`.
- Senha vazada (HIBP) do Supabase é só no plano Pro: mitigar com política de senha + checagem k-anônima no cadastro (backlog).

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

1. Pool de 39 chaves × ToS §14.2 — declarar na tese.
2. 473 rotas anônimas de teste da calibração (2026-09-23 04:12–05:15 UTC) em `rotas_calculadas`: apagar? (aguarda OK).

## Próximos passos

- [ ] Deploy contínuo (GitHub Actions): build do front em runner Linux + deploy da API por SSH.
- [ ] Dono: validar visualmente app + painel em produção.
- [ ] Recalibrar semáforo em horário comercial (a calibração atual foi de madrugada).
- [ ] Velocidade livre por classe de via (viés β ≈ 22,9 s/km) e depois recalibrar δ.
- [ ] Figura 1 com a LIA 2.2 (opcional: a tese cita a 2.1).
- [ ] Snap na aresta (em vez do nó) para eliminar o conector.
- [ ] F9 restante (CSP, suíte de segurança, trava de login, sessão ociosa) → F10 deploy.

## Checklist do orientador (texto final)

- [x] Gráfico MAE/RMSE LIA 1.0 → 2.0 → 2.1 × baseline (`fig1`; números finais dependem do re-run)
- [x] Curva isotônica confiança × distância (`fig2`) + ressalva do recorte
- [x] Limitações e trabalhos futuros — **atualizar:** o semáforo agora tem tratamento calibrado; a fusão com a TomTom cobre as lacunas
- [x] Diagrama de arquitetura (`docs/core/architecture.md`) + versão viva no painel — **atualizar** com a fusão
- [x] "Erro médio" = RMSE; coluna MAE na Tabela 1
- [ ] Equipe revisar/reescrever o rascunho e declarar o uso de IA
