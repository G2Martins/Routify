# STATE — Routify

**Última revisão:** 2026-11-03

Plano da fase: [2026-09-23-plano-fase-final.md](2026-09-23-plano-fase-final.md) · Pesquisa de traçado/contexto/APIs: [research/2026-09-23-tracado-contexto-apis.md](research/2026-09-23-tracado-contexto-apis.md) · **Análise de melhorias + estratégia de testes (2026-11-01):** [research/2026-11-01-analise-melhorias-e-testes.md](research/2026-11-01-analise-melhorias-e-testes.md) · **LIA 2.3, provedores, caça a erros, integrações (2026-11-02):** [research/2026-11-02-lia-provedores-integracoes.md](research/2026-11-02-lia-provedores-integracoes.md)

## Onde estamos

| Fase | Estado |
| --- | --- |
| F0 Fundação / F0.5 Banca | feitas (rascunho da banca entregue) |
| F2 TomTom sob demanda | feita |
| F3 Captura de uso | feita; migrations 1–3 aplicadas pelo dono em 2026-09-23 |
| F7 Plataforma unificada + design | **feita no código**: paleta da logo + linguagem Valerium nos dois apps, login refeito, sessão única (cookie) app ↔ `/admin`, item "Painel ADM" por role, auto-sugestão nova. Falta validação visual do dono |
| F8 Ações ADM | feita; migration 4 (`admin_actions`) aplicada via MCP em 2026-09-23 |
| F9 Segurança | parcial: rate limit por IP, auditoria append-only, anti-corrida, `extra=forbid` em todos os corpos, feedback único. **2026-11-01:** chave TomTom não vaza mais em log INFO (teste), uvicorn sem access log, Caddy com teto de corpo, `StartLimit*`. Falta: CSP/headers no deploy, suíte `tests/security/`, trava de login por (e-mail, IP), sessão ociosa, limite por IP antes do auth em `/eventos` e `/admin` |
| F10 Deploy (AWS + Hostinger + Actions) | **no ar desde 2026-09-23** (conferido em 2026-11-01: `/health` 200, LIA 2.2; front 200). Falta: GitHub Actions |
| F12 LIA 2.2 (contexto) | **feita**: vizinhos + chuva + feriado, mesmo código no treino e na API; padrão da API; estresse treino × produção versionado |
| F11 Traçado + fusão LIA × TomTom | **feita e validada ao vivo**: grafo 38 km, conector tracejado, `entryPoints`, fusão por `supportingPoints`, semáforos OSM (271 cruzamentos) + calibração |
| F13 Coleta na EC2 (cadência pela cota) | **no ar desde 2026-11-02 00:23 (Brasília)**: `routify-collector` ativo na EC2, 1º lote = 630 linhas de 630 pontos no banco, 36 MB de RAM, API seguiu 200. Cadência de 43 min: confirmar pelo intervalo entre o 1º e o 2º lote |
| F15 LIA 2.3 + LIA × provedores + caça a erros + auto-sugest | **código pronto e testado (2026-11-02)**: LIA 2.3 (CV 35,48 × 40,27 s), velocidade livre na escala da TomTom (viés −11,9% → −0,2% no mesmo trajeto), 10 bugs da inferência corrigidos com teste, auto-sugest reescrito (66 testes), comparador + timer, página `/admin/provedores`. **No ar desde 2026-11-02 02:23**: API com LIA 2.3 + velocidade calibrada, comparador com timer (8×/dia) e Mapbox, front com `/admin/provedores` e o auto-sugest novo, métricas publicadas. Migration `20261102000000_lia_vs_provedores` aplicada pelo dono no SQL Editor (2026-11-02 ~10h); 1.536 linhas de 16 rodadas gravadas |
| F16 Grafo calibrado + prior de congestionamento + provedores além do OSM | **no ar desde 2026-11-02 12:23** (commit `3740695`): velocidade livre por grupo de via (expressa 0,909, arterial 0,897, coletora 0,508, local 0,425) e δ = 8,1 s; prior `corredor`; `access=no` fora do grafo; ETA histórico da TomTom e típico do Mapbox no comparador (+ RPC `admin_provedores_historicos`, aplicada pelo MCP); 14 viagens entre pontos famosos no comparador. A/B no mesmo instante: LIA × TomTom ao vivo nos corredores −9,1%/12,7% → −2,3%/8,7% (viés/MAPE), sorteadas −14,7%/18,7% → −3,3%/9,5% (`ab_calibracao_grafo_2026-11-02.json`). 1ª rodada em produção (12:31): corredores −2,5%/9,7%. Busca com ~1.700 pontos do OSM (`pois_df.json`, no ar 12:45): bateria de 79 pontos famosos (`scripts/bateria_busca.py`) em produção de 72,7% para 94,7% no top 5 (metrô 49,6% → 99,3%), 0 pontos sem acerto, mediana 504 ms. Front com o cartão de modelos históricos no ar (12:49) |
| F17 Mapa premium + MFA + linguagem Valerium | **no ar desde 2026-11-02 14:02** (`e5c2f2a`, `340bc81`; API 13:58, front 14:02, migration aplicada pelo MCP com o OK do dono): mapa web vetorial (MapLibre 5.24 + OpenFreeMap, estilo recolorido com a paleta, satélite híbrido, prédios 3D, rota em gradiente com trânsito por trecho e animações; Leaflet de reserva sem WebGL); API devolve `trafego` por trecho (LIA onde há sensor, seções da TomTom nos buracos); verificação em duas etapas (TOTP) com aal2 no banco (`20261102020000_mfa_aal2.sql`, aplicada; conferido: admin sem fator segue admin, 4 policies com `aal_ok()`), na API e no painel; títulos só em Geist, `Surgir auth`, `CodigoOtp`. Testes: API 188, coletor 28, tsc app/painel 0, export web ok. Produção conferida: app 200, `/admin` 307, CSP com `worker-src blob:` e OpenFreeMap, bundle com o chunk do MapLibre, `/route` com `trafego` |
| F18 Grafo do DF inteiro + buracos de dados | **snap no maior componente no ar desde 2026-11-02 14:20** (`ccb6919`): auditoria por região administrativa (`ml/auditoria_grafo_df.py` → `auditoria_grafo_df.json`): o grafo é uma caixa de ±38 km com 79% da área e 92,2% das vias do DF; 83,2% dos km sem sensor a 500 m; 20 das 35 RAs sem sensor; bolsões de mão única em São Sebastião, Sobradinho e Lago Norte (origem/destino agora só no maior componente fortemente conexo). **Sensores virtuais no código, desligados por padrão** (`SENSORES_VIRTUAIS=1` liga): 1.627 pontos, até 3 leituras do Flow por rota. Dois A/B no feriado (14h30 e 18h12, 10 viagens pelos buracos, `ab_sensores_virtuais_2026-11-02.json`) sem ganho: com os buracos quase livres, o Flow leu fluxo livre e deixou a LIA até 19 s mais otimista, sem mudar traçado (MAPE no mesmo trajeto 11,5 → 11,8%). Ligar só com A/B em dia útil com trânsito nos buracos |
| F19 Testes contínuos na AWS + recuperação do MFA + LIA 2.4 candidata | **rotina e A/B no ar na EC2 desde 2026-11-02 20:50** (`ff110bf`): `routify-rotina.service` dispara ao fim de cada rodada do comparador (checagens da API + resumo da rodada, sem TomTom extra; teste às 20:54 ok) e `routify-ab.timer` roda o A/B dos sensores virtuais nos picos de dia útil até 13/11 (teste às 20:55: braço B subiu, 10 viagens, JSON gravado). **Códigos de recuperação do MFA** no código e testados (`ead633a`: 10 testes HTTP; migration `20261102030000` aplicada pelo MCP, RLS sem policy conferido); **deploy da API e do front espera o OK do dono** (o modo automático bloqueou). LIA 2.4 por pesos de período **rejeitada** (`ablation_lia_2.4.json`: viés do pico da tarde −11,3 → −10,1 s no melhor caso, pior com leitura de 30 min). Cortes da auditoria ponytail aplicados (#2, #8, #9, #11, #12, #13, #15). **Restrições de conversão do OSM** pesquisadas e no código atrás de flag (`RESTRICOES_CONVERSAO=1`; no grafo real, 7 de 30 viagens do comparador violavam e as 7 saíram legais com +0,2 a +2,4% de tempo), com variante `restricoes` no A/B da EC2 |
| F20 Noite de 2026-11-02 → 03: auditoria de segurança, telas novas, desempenho | **no código, testado e no GitHub (CI), sem deploy** (o modo automático bloqueia deploy e migration de produção). App: abas **Planejar saída** (`POST /route/horarios`) e **Trânsito agora** (`GET /trafego/agora`). Painel: **`/admin/status`** (banco, API na AWS, coletor, comparador, site, máquina da EC2 e as páginas de status de Supabase, Hostinger, GitHub e AWS, a cada 30 s), **uso real das chaves** por dia, serviço e origem (`tomtom_uso_dia`, migration aplicada) e teto do dia por serviço em `/admin/operacao`, erro por período, arquitetura atualizada. Desempenho: pesos da LIA vetorizados (bit a bit iguais, 2× mais rápidos), duas contagens O(E) a menos, perfis por hora em cache (−77 ms); Brasal → Park Shopping em 2,2 s. Os `/route` de 32–41 s vinham de build do front na EC2 (swap): o build saiu para o GitHub Actions. "Park Shopping" no lugar errado: destino salvo em 23/09 (São Sebastião) passava à frente do certo; `sugestoes.ts` corrigido (5 testes). Busca: 395 consultas, top 5 95,4%, top 1 84,3%. Segurança (auditoria em `research/2026-11-03-auditoria-seguranca.md`, **fora do git até o deploy**, repo público): painel atrás de um 404 idêntico ao de rota inexistente, CSP separada app × painel (ainda Report-Only), Next 16.4.4, ícones sem a API do Iconify, atribuição do mapa só com texto nosso (XSS do sanitizador do MapLibre 5), teto diário da TomTom por serviço (1/31 da cota) e 400 buscas com TomTom por IP e dia, teto global do `/route`, coordenadas só no DF, fila do log de uso limitada, `/health` sem o pool (detalhe em `/admin/saude`), Swagger sem token salvo e sem `/admin`/`/mfa`, `Server-Timing` só interno, cookie Secure de 30 dias, duas corridas (códigos MFA, tempo livre por grupo), e-mails do Auth sem o nome livre, Privacidade citando os terceiros reais, SRI no CSS do Leaflet. Migrations **escritas e não aplicadas**: `20261103020000` (grants, INSERT por coluna e CHECKs no `route_history`, teto de 300 rotas/dia, `is_admin()` ao vivo, dataset só cresce) e `20261103030000` (admin exige MFA). SEO: `llms.txt`, robots, sitemap, Open Graph, JSON-LD. Playwright: 27 testes contra produção (`tests/e2e`). Cobertura: proposta de +50/+100/+150 pontos de coleta (22,2% → 24,7/27,8/30,1% dos km de via principal com sensor; cadência 43 → 46/50/53 min), **não aplicada**. Snap com vários candidatos atrás de flag (`SNAP_CANDIDATOS`), no A/B de dia útil junto das restrições de conversão. Testes: API 268, coletor 32, app 10, tsc 0 nos dois apps |
| F14 Análise de melhorias + estratégia de testes | **entregue** (4 revisões: API/segurança, ML, front, DB/CI) com backlog priorizado e evidência arquivo:linha; artefato `cobertura_dataset.json` |

## Verificado nesta sessão (2026-11-01)

- Produção: `https://api-…/health` 200 (`modelo_ativo lia_2.2`, 39 chaves disponíveis em todos os serviços, recência mais recente 2026-10-31); front 200.
- **39/39 chaves TomTom respondem 200** (1 chamada de Flow por chave).
- Pricing (docs.tomtom.com/pricing): "Free monthly requests per API" — Flow Segment Data 20k, Incidents 2,5k, Routing 20k, Search 2,5k. A página não diz se é por conta ou por chave.
- Dataset (`ml/artifacts/cobertura_dataset.json`): 1.513.824 linhas, 2026-03-07 → 2026-07-19, 630 pontos, 134 dias com coleta. **13 dias cheios (≥ 50 mil linhas) concentram 68,5% das linhas**; mediana 2.561 linhas/dia (4 ciclos, logo após 00:00 UTC); a hora 21h (Brasília) tem 23,3% das linhas; fim de semana = 21% do volume de um dia útil.
- pytest API: **63 passed** (1 novo: `test_log_info_nao_contem_chave_nem_url`). Coletor: **17 passed**. `compileall` ok.
- SSH na porta 22 da API → `Connection timed out`: o security group tinha um IP antigo, e a VPN do dono sai por outro IP.

## Verificado em 2026-11-02 (deploy)

- `scripts/aws-bootstrap.sh` no CloudShell: porta 22 só para o IP de casa do dono; role `routify-ec2-ssm` associada (o agente só registrou depois de `snap restart`; health check a cada 5 min, sem erro); usuários IAM `pedro` (console + MFA obrigatória) e `claude-ops` (CLI, `RoutifyOperacaoCLI`) criados; 1 budget na conta.
- Código da branch `coleta-aws-analise` (`a716681`) extraído em `/opt/routify`; `instalar-ec2.sh` e `provisionar-ec2.sh` rodaram; `/health` público 200 (39 chaves, todas disponíveis).
- Journal rotacionado e limpo: 0 linhas com `key=` depois da coleta ligada.
- Profile `routify` = `user/claude-ops`: SSM Online, Run Command ok (`routify-collector`, `routify-api` e `caddy` ativos) e SSH por dentro do SSM ok, sem a porta 22 externa. Security group: 80/443 abertos, 22 só o IP de casa.
- `historico_trafego`: 630 linhas novas (630 pontos, `03:25:57` UTC), 0 inválidas; razão média 1,000 × 0,999 no histórico da mesma hora (0h de Brasília).

## Decisões tomadas (2026-11-02)

- **LIA 2.3 é o padrão da API** (rollback `LIA_VERSION=lia_2.2`): perfis fora da amostra, recência envelhecida, early stopping no próprio treino; modelo final com a mediana das paradas da CV (600 árvores). Evidência: `ablation_lia_2.3.json`.
- **Velocidade livre na escala da TomTom** por fator único (0,883), padrão ligado (`VEL_LIVRE_CALIBRADA=0` volta à Fase 3). Fator por classe rejeitado (muda as rotas). Evidência: `experimento_velocidade_livre.json`.
- **Comparador sem Valhalla** (termos do Stadia proíbem benchmark; o da FOSSGIS não foi lido) e sem HERE/Google/Azure (termos). Ficam TomTom (referência), OSRM e, com token, Mapbox.
- Chamada interna (loopback + `X-Routify-Interno` + sem `X-Forwarded-For`) fica fora da captura de uso; auditoria nunca.
- Aurora `database-1` (criado em 2026-11-01 23:12, sem uso no Routify): exclusão pedida pelo dono e executada com snapshot final `database-1-final-2026-11-02`. Verificado: nenhuma interface de rede do RDS restou na conta (instância apagada). Não verificado: o estado final do cluster e do snapshot (a liberação temporária de RDS no `claude-ops` já tinha sido removida).

## Decisões tomadas (2026-11-03, madrugada)

- **MapLibre 6 fica para depois:** a correção do XSS do sanitizador só saiu na 6.4.1, que é ESM-only e exige WebGL2. A brecha só passava pela atribuição das fontes; agora a de terceiros é zerada no estilo e o texto vem do nosso código (o `npm audit` segue apontando a 5.24).
- **Ícones da web em subconjunto offline** (`src/constants/icones.json`, 86 ícones, 44 KB) em vez das fontes do `@expo/vector-icons` (1,7 MB de fonte para 7 ícones MDI). Visual idêntico, zero requisição de ícone.
- **`/health` público mínimo:** sem o tamanho do pool nem as livres por serviço; o painel lê `/admin/saude`. Deploy da API **antes** do front, senão o painel mostra a API como fora do ar.
- **Push da noite inteira** feito com a auditoria fora do git: os commits descrevem as correções, não o passo a passo de ataque.

## Decisões tomadas (2026-11-02, noite)

- **Testes contínuos na AWS, não no PC:** a rotina de validação vai junto com as 8 rodadas diárias do comparador (que
  já cobrem os picos), sem rodada extra. Rodar a cada 30 min, como no feriado, gastaria por estimativa ~3× a reserva de Flow da API
  (15% do pool). O A/B dos picos tem data para parar (`AB_ATE`), pelo mesmo motivo.
- **LIA 2.4 não sai agora:** só um dia de dados novos (feriado), e a candidata sem dados novos (pesos por período)
  não corrigiu o viés do pico da tarde. A 2.3 segue padrão.
- **Códigos de recuperação do MFA feitos na API** (o Supabase Auth não tem): geração só em sessão aal2; uso em
  sessão aal1 remove o fator pela API admin; banco guarda só hash; auditoria sem IP (a trilha é append-only).

## Decisões tomadas (2026-11-01)

- **Coleta volta, na mesma EC2** (custo zero), com cadência pela cota mensal: 39 chaves × 20 mil × 85% / 31 dias / 630 pontos → **1 ciclo a cada 43 min** (~21 mil chamadas/dia). 15% do pool fica pra API sob demanda. `COLETOR_INTERVALO_MIN` força outro valor.
- Coletor espelha a API: 429 repetido (4×) = cota, 24 h fora; 403 sem texto de cota = chave inválida, 10 min; round-robin por chamada. Fase 3 vira opt-in (`COLETOR_FASE3`), desligada na EC2 (RAM).
- `TOMTOM_KEYS_FILE` no coletor (a API já tinha) permite separar o pool se a reserva de 15% não bastar.
- **Acesso do parceiro à AWS** = usuário IAM + MFA obrigatória + `ReadOnlyAccess` + política mínima (start/stop/reboot da instância, Session Manager, custo) — nunca Organizations/Identity Center (converte a conta em paga). Procedimento em `docs/core/deploy.md` §5.
- P0 de segurança aplicados sem esperar: `httpx`/`httpcore` em WARNING (a URL com `key=` ia pro log em INFO), `--no-access-log`, `request_body max_size 64KB`, `StartLimit*`; keep-alive do Supabase passa a ler `avisos_app` (a tabela antiga nega a chave pública).
- Dataset começa em **2026-03-07**, não 2026-04-27 (CLAUDE.md corrigido).

## Decisões abertas (do dono / grupo)

1. Pool de 39 chaves × ToS §14.2 — declarar na tese.
2. **Retreinar LIA 2.3 com os dados novos** em dez/2026? Precisa de ≥ 4 semanas de coleta uniforme (a cadência de 43 min dá ~33 observações/ponto/dia, em todas as horas).
3. `route_history` é 100% escrito pelo cliente, com INSERT sem restrição de coluna: travar colunas (grant por coluna + CHECK) ou mover a escrita pra API?
4. Backup do dataset fora do Supabase (o free não tem backup; só há parquets locais): onde e como (dump semanal cifrado)?
5. **Metodologia da avaliação (revisão de ML, 2026-11-01):** o baseline de persistência (`razao_lag1`) empata com a LIA 2.1 no RMSE (39,96 × 40,88 s) e ganha no MAE (12,04 × 14,51); o `early_stopping` usa o fold de validação (receita de produção = 41,64 s); perfis são in-sample. Com perfis OOF + recência envelhecida: 38,08 s. Decidir: (a) regerar métricas/figuras sem ES na validação e com persistência no `evaluate_cv`; (b) adotar OOF + envelhecimento como LIA 2.3 (confirmar em holdout); (c) como contar isso na tese. Números ainda não versionados (scratchpad) — nada entra no texto antes de virar JSON.
6. Rotacionar as 39 chaves TomTom? Elas podem estar no `journalctl` da EC2 (log INFO do httpx até 2026-11-01). O journal é legível só por root/adm; recomendação: limpar o journal, não rotacionar.

## Próximos passos

- [x] Bootstrap AWS (`scripts/aws-bootstrap.sh`) + deploy do coletor e da API (2026-11-02).
- [x] Profile `routify` configurado pelo dono e conferido (2026-11-02).
- [x] Aurora `database-1` (não é do Routify): apagado em 2026-11-02 com snapshot final, a pedido do dono (ver Decisões).
- [ ] **Dono:** console → conta → ativar o acesso de usuários IAM ao Billing (só o root faz).
- [ ] **Pedro:** 1º login (URL + senha temporária entregues pelo dono) → trocar senha → MFA → testar EC2 → Connect → Session Manager.
- [x] Merge de `coleta-aws-analise` em `main` + push (2026-11-02, CI verde).
- [x] Migration `20261102000000_lia_vs_provedores` aplicada pelo dono no SQL Editor (2026-11-02 ~10h); a rodada seguinte subiu as 1.440 linhas pendentes. Antes disso: O MCP recusou `apply_migration` e `execute_sql` de escrita (pedem confirmação interativa). Enquanto isso o comparador guarda as rodadas em `/var/lib/routify-comparador/comparacao_pendente.jsonl` na EC2, e a 1ª rodada depois da migration manda tudo.
- [x] Deploy da API (LIA 2.3 + velocidade calibrada) e do comparador (timer ligado, token do Mapbox num drop-in do systemd), 2026-11-02 02:23; front publicado na Hostinger; `publish_metrics.py` rodado (lia_2.3 + 7 análises).
- [x] Rotina de validação até 12h (tarefa do Windows `Routify - rotina de validacao da LIA`, de hora em hora, `scripts/rotina_validacao.py` → `services/collector/dados/rotina/`) e agente horário desta sessão revisando cada rodada; resumo em `.planning/research/2026-11-02-rotina-madrugada.md`. Estendida a cada 30 min à tarde e encerrada pelo dono às 18:56 (26 rodadas, 1 perdida às 17:05 por interrupção da tarefa); resumo do dia, por período, no mesmo arquivo.
- [ ] **Dono:** conferir no console que o RDS ficou vazio e o snapshot `database-1-final-2026-11-02` existe (o `claude-ops` não lê mais o RDS); apagar o snapshot se não quiser guardar.
- [x] Token grátis do Mapbox no comparador (drop-in do systemd na EC2, 2026-11-02).
- [ ] Dezembro: `silver.py` + `fetch_contexto.py --fim …` + `avaliar_fora_do_tempo.py` + `publish_metrics.py` → número final 2.2 × 2.3 × persistência em dados novos.
- [x] "imatch recusado" no log da API: 0 nas 26 rodadas de 2026-11-02; a rotina da EC2 segue conferindo a cada rodada.
- [ ] LIA 2.4 (dezembro): dados de novembro primeiro; depois tendência da recência e perfil por quantil no pico (a candidata por pesos de período foi rejeitada em 2026-11-02, `ablation_lia_2.4.json`); calendário escolar SEEDF/UnB. A/B na EC2 com `ab_ec2.sh lia24` antes de trocar o padrão.
- [ ] **Dono:** OK para o deploy da API (códigos de recuperação + cortes) e do front (telas de recuperação). Pacote do front pronto; depois, testar o fluxo de recuperação ponta a ponta com uma conta de teste.
- [x] Limite por IP antes de validar o token (`/eventos`, `/admin`, `/mfa`), com teste de que a tentativa barrada não chega ao Supabase Auth (2026-11-02).
- [ ] Testes P0 da análise: TestClient HTTP (422 com NaN/extra/fora do DF, 429 com `Retry-After`, 401/403 do admin); contrato modelo ↔ metadata; migrations + RLS no CI (pgTAP).
- [ ] `route_history`: grant de INSERT por coluna + CHECKs (ou a API persiste).
- [ ] Backup semanal do dataset (Action com `pg_dump` cifrado).
- [ ] `/route` fora do event loop (cache dos pesos por hora/dia) — p95 e `/health` sob carga.
- [ ] Deploy contínuo (GitHub Actions): build do front em runner Linux + deploy da API por SSM.
- [ ] Dono: validar visualmente app + painel em produção.
- [x] Recalibrar semáforo em horário comercial (2026-11-02, 12h; o tempo sem trânsito da TomTom não depende da hora).
- [x] Velocidade livre por grupo de via e δ recalibrado (2026-11-02, 135 rotas, MAPE do tempo livre 20,5% → 10,4%; A/B em `ab_calibracao_grafo_2026-11-02.json`).
- [ ] Figura 1 com a LIA 2.2 (opcional: a tese cita a 2.1).
- [ ] Snap na aresta (em vez do nó) para eliminar o conector; snap com vários candidatos (a pesquisa de restrições mostrou que resolve 4 de 18 caminhos ilegais e os 3 corredores com reconstrução > 5% maior).
- [ ] Restrições de conversão do OSM: código e testes prontos (`RESTRICOES_CONVERSAO=1`, desligado por padrão); A/B `restricoes` na EC2 nos picos de dia útil, nas 30 viagens do comparador. Ligar por padrão se o traçado em comum com a TomTom e a razão da reconstrução melhorarem sem piorar o ETA.
- [ ] Sensores virtuais: o A/B de dia útil roda sozinho na EC2 (`routify-ab.timer`, 07:40/08:40/17:40/18:40 até 13/11; JSONs em `/var/lib/routify-ab/`). Juntar as passadas e decidir; ligar em produção só com ganho.
- [ ] F9 restante (CSP, suíte de segurança, trava de login, sessão ociosa).
- [ ] **Dono (madrugada de 2026-11-03):** (1) OK para o deploy da API (`b9bc933` em diante) e depois do front; (2) aplicar `20261103020000_endurecimento_auditoria.sql` no SQL Editor; (3) decidir quem segue admin e rebaixar o resto (item A2 da auditoria local), cada admin ativa o MFA e gera os códigos; só então `20261103030000` + `ADMIN_EXIGE_MFA=1`; (4) colar de novo `confirmacao.html` e `recuperacao.html` em Auth → Templates; (5) política IAM de leitura de custo/métricas para o `claude-ops` (`deploy.md` §5.7) e decidir t3.medium ou crédito Unlimited; (6) variáveis `ROUTIFY_API_URL` e `ROUTIFY_SITE_URL` no GitHub (build do front no Actions); (7) `vm.swappiness=10` na EC2; (8) conta de teste para o Playwright (`E2E_EMAIL`/`E2E_PASSWORD`, sem admin e sem MFA); (9) decidir a expansão de sensores (`ml/artifacts/proposta_expansao_sensores.json`); (10) `CSP_ENFORCE=1` depois de conferir o console em produção.
- [ ] Atualizar o MapLibre para a 6.x (ESM-only, WebGL2) com teste visual; aí tirar o pino da atribuição.
- [ ] LGPD restante (B10): listas do painel sem `user_id`, `admin_exportar_dados` com coordenadas arredondadas, retenção do `route_history`.

## Checklist do orientador (texto final)

- [x] Gráfico MAE/RMSE LIA 1.0 → 2.0 → 2.1 × baseline (`fig1`; números finais dependem do re-run)
- [x] Curva isotônica confiança × distância (`fig2`) + ressalva do recorte
- [x] Limitações e trabalhos futuros — **atualizar:** o semáforo agora tem tratamento calibrado; a fusão com a TomTom cobre as lacunas; **incluir a cobertura temporal do dataset** (números de `cobertura_dataset.json`)
- [x] Diagrama de arquitetura (`docs/core/architecture.md`) + versão viva no painel — **atualizar** com a fusão e o coletor na EC2
- [x] "Erro médio" = RMSE; coluna MAE na Tabela 1
- [ ] Equipe revisar/reescrever o rascunho e declarar o uso de IA
