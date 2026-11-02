# STATE — Routify

**Última revisão:** 2026-11-02

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
| F16 Grafo calibrado + prior de congestionamento + provedores além do OSM | **no ar desde 2026-11-02 12:23** (commit `3740695`): velocidade livre por grupo de via (expressa 0,909, arterial 0,897, coletora 0,508, local 0,425) e δ = 8,1 s; prior `corredor`; `access=no` fora do grafo; ETA histórico da TomTom e típico do Mapbox no comparador (+ RPC `admin_provedores_historicos`, aplicada pelo MCP); 14 viagens entre pontos famosos no comparador. A/B no mesmo instante: LIA × TomTom ao vivo nos corredores −9,1%/12,7% → −2,3%/8,7% (viés/MAPE), sorteadas −14,7%/18,7% → −3,3%/9,5% (`ab_calibracao_grafo_2026-11-02.json`). 1ª rodada em produção (12:31): corredores −2,5%/9,7%. Busca com ~1.700 pontos do OSM (`pois_df.json`): bateria de 79 pontos famosos em `scripts/bateria_busca.py` |
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
- [ ] Aurora `database-1` (não é do Routify): o dono pediu para apagar em 2026-11-02. O `claude-ops` não tem RDS; precisa de política temporária, que o próprio assistente remove no fim.
- [ ] **Dono:** console → conta → ativar o acesso de usuários IAM ao Billing (só o root faz).
- [ ] **Pedro:** 1º login (URL + senha temporária entregues pelo dono) → trocar senha → MFA → testar EC2 → Connect → Session Manager.
- [x] Merge de `coleta-aws-analise` em `main` + push (2026-11-02, CI verde).
- [x] Migration `20261102000000_lia_vs_provedores` aplicada pelo dono no SQL Editor (2026-11-02 ~10h); a rodada seguinte subiu as 1.440 linhas pendentes. Antes disso: O MCP recusou `apply_migration` e `execute_sql` de escrita (pedem confirmação interativa). Enquanto isso o comparador guarda as rodadas em `/var/lib/routify-comparador/comparacao_pendente.jsonl` na EC2, e a 1ª rodada depois da migration manda tudo.
- [x] Deploy da API (LIA 2.3 + velocidade calibrada) e do comparador (timer ligado, token do Mapbox num drop-in do systemd), 2026-11-02 02:23; front publicado na Hostinger; `publish_metrics.py` rodado (lia_2.3 + 7 análises).
- [x] Rotina de validação até 12h (tarefa do Windows `Routify - rotina de validacao da LIA`, de hora em hora, `scripts/rotina_validacao.py` → `services/collector/dados/rotina/`) e agente horário desta sessão revisando cada rodada; resumo em `.planning/research/2026-11-02-rotina-madrugada.md`.
- [ ] **Dono:** conferir no console que o RDS ficou vazio e o snapshot `database-1-final-2026-11-02` existe (o `claude-ops` não lê mais o RDS); apagar o snapshot se não quiser guardar.
- [ ] **Dono (opcional):** token grátis do Mapbox (`MAPBOX_TOKEN` no `.env` do coletor) para ter um 2º provedor com trânsito ao vivo.
- [ ] Dezembro: `silver.py` + `fetch_contexto.py --fim …` + `avaliar_fora_do_tempo.py` + `publish_metrics.py` → número final 2.2 × 2.3 × persistência em dados novos.
- [ ] Depois do deploy: procurar "imatch recusado" no log da API (busca da malha cai no ILIKE se o PostgREST recusar).
- [ ] LIA 2.4 (pós-novembro): calendário escolar SEEDF/UnB + dados de novembro; recalibrar o semáforo com a velocidade calibrada.
- [ ] Testes P0 da análise: limite por IP antes do auth em `/eventos` e `/admin`; TestClient HTTP (422 com NaN/extra/fora do DF, 429 com `Retry-After`, 401/403 do admin); contrato modelo ↔ metadata; migrations + RLS no CI (pgTAP).
- [ ] `route_history`: grant de INSERT por coluna + CHECKs (ou a API persiste).
- [ ] Backup semanal do dataset (Action com `pg_dump` cifrado).
- [ ] `/route` fora do event loop (cache dos pesos por hora/dia) — p95 e `/health` sob carga.
- [ ] Deploy contínuo (GitHub Actions): build do front em runner Linux + deploy da API por SSM.
- [ ] Dono: validar visualmente app + painel em produção.
- [x] Recalibrar semáforo em horário comercial (2026-11-02, 12h; o tempo sem trânsito da TomTom não depende da hora).
- [x] Velocidade livre por grupo de via e δ recalibrado (2026-11-02, 135 rotas, MAPE do tempo livre 20,5% → 10,4%; A/B em `ab_calibracao_grafo_2026-11-02.json`).
- [ ] Figura 1 com a LIA 2.2 (opcional: a tese cita a 2.1).
- [ ] Snap na aresta (em vez do nó) para eliminar o conector.
- [ ] F9 restante (CSP, suíte de segurança, trava de login, sessão ociosa).

## Checklist do orientador (texto final)

- [x] Gráfico MAE/RMSE LIA 1.0 → 2.0 → 2.1 × baseline (`fig1`; números finais dependem do re-run)
- [x] Curva isotônica confiança × distância (`fig2`) + ressalva do recorte
- [x] Limitações e trabalhos futuros — **atualizar:** o semáforo agora tem tratamento calibrado; a fusão com a TomTom cobre as lacunas; **incluir a cobertura temporal do dataset** (números de `cobertura_dataset.json`)
- [x] Diagrama de arquitetura (`docs/core/architecture.md`) + versão viva no painel — **atualizar** com a fusão e o coletor na EC2
- [x] "Erro médio" = RMSE; coluna MAE na Tabela 1
- [ ] Equipe revisar/reescrever o rascunho e declarar o uso de IA
