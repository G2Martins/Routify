# Rotina de validação da LIA, madrugada de 2026-11-02

**Última revisão:** 2026-11-02

De hora em hora até as 09:30 e, a pedido do dono, a cada 30 min (planejado até 23h, encerrado pelo dono às 18:56): a tarefa do Windows roda
`scripts/rotina_validacao.py` às :05 e :35 (checagens das correções da LIA em produção + uma rodada do comparador com
traçado) e o agente desta sessão revisa a rodada logo depois.
Tabela completa, com as rodadas manuais das 02:33 e 02:43: `services/collector/dados/rotina/relatorio.md` (fora do git).
Referência: TomTom com trânsito ao vivo. Viés / MAPE em %; traçado = % da rota igual à da TomTom.

## Registro por execução

| Revisão | Rodada | Checagens | LIA × TomTom no mesmo trajeto | LIA × rota da TomTom (viés / MAPE / traçado) | Mapbox × TomTom (viés / MAPE / traçado) | Ação |
|---|---|---|---|---|---|---|
| 03:20 | 03:06 | 14/14 ok, recência 4,3 min, 16/16 corredores, 576 linhas pendentes (sem a tabela) | −2,2 / 10,4 | −6,3 / 13,6 / 62 | +2,6 / 9,5 / 60 | Nenhuma. Nota de método: a LIA encaixa origem e destino no nó mais próximo, e a TomTom vai ao ponto exato; em destino grande (aeroporto) a rota e o tempo mudam (rota própria da TomTom 1.090 s × 746 s da TomTom no trajeto da LIA). Os parâmetros da TomTom são os mesmos nos dois lados (tráfego, carro, mais rápida, agora). |
| 04:20 | 04:06 | 14/14 ok, recência 40,1 min (coleta a cada 43 min), 16/16 corredores, 672 pendentes | −3,2 / 10,7 | −7,1 / 13,8 / 62 | −2,0 / 9,5 / 65 | Nenhuma. |
| 05:20 | 05:06 | 14/14 ok, recência 8,3 min, 16/16 corredores, 768 pendentes | −2,7 / 10,2 | −6,4 / 13,4 / 62 | −1,7 / 8,8 / 67 | Nenhuma. |
| 06:20 | 06:07 | 14/14 ok, recência 22,5 min, 16/16 corredores, 864 pendentes | −4,3 / 9,9 | −5,1 / 12,3 / 62 | +4,5 / 10,3 / 65 | Nenhuma. Início do dia: o viés no mesmo trajeto ficou mais negativo (−4,3 contra −2,2 a −3,2 de madrugada); acompanhar no pico das 07h e 08h. |
| 07:20 | 07:06 | 14/14 ok, recência 36,4 min, 16/16 corredores, 960 pendentes. **Viés passou do limite (−15,3%).** | −15,3 / 13,5 | −10,8 / 12,2 / 58 | +1,8 / 9,4 / 66 | Investigado nos dados da rodada (EC2), sem bug. (1) Corredores urbanos do Plano Piloto (Asa Norte → Asa Sul, Lago Norte → SCS, Plano → Taguatinga/Águas Claras, Cruzeiro) ficam 18–26% abaixo desde a madrugada, abaixo até do tempo SEM trânsito da TomTom (665 × 846 s): atrasos de cruzamento/tesourinha/rotatória que o fator único não cobre. (2) Manhã de Finados: a LIA trata feriado como trânsito leve, mas EPTG/Samambaia/Ceilândia/Águas Claras já rodam 15–25% acima do tempo livre na TomTom (ex.: Samambaia 2.286 × 1.870 s); os feriados do treino (abr–jun) não têm visita a cemitério. (3) Método: o `trafficDelayInSeconds` da TomTom veio 0 em todos, mesmo com o tempo ao vivo acima do sem trânsito; ele só conta incidentes. Congestionamento = tempo ao vivo − tempo sem trânsito; a Fase 3 usou o campo de incidente. Decisões para o dono, nada alterado. |
| 08:20 | 08:06 | 14/14 ok, recência 4,4 min, 16/16 corredores, 1.152 pendentes (inclui a rodada das 07:30 do timer) | −14,7 / 15,2 | −11,7 / 13,5 / 55 | −1,1 / 10,5 / 59 | Nenhuma: mesmo quadro das 07h, dentro dos limites. O OSRM, sem trânsito, também ficou abaixo da TomTom (−9,4%), e o Mapbox, com trânsito, concorda com ela (−1,1%): a TomTom está vendo congestionamento real que a LIA subestima. |
| 09:20 | 09:06 | 14/14 ok, recência 18,5 min, 16/16 corredores, 1.344 pendentes (inclui a rodada das 08:30 do timer) | −8,4 / 12,5 | −9,3 / 13,3 / 59 | +4,3 / 9,5 / 58 | Nenhuma: o pico passou e o viés voltou para dentro do limite. |
| 10:15 | — | Migration aplicada pelo dono no SQL Editor (o MCP recusou 3 vezes: a extensão do VS Code não exibe a confirmação). | — | — | — | Rodada manual: 96 linhas + 1.440 pendentes gravadas (1.536, 16 rodadas, 02:24–10:08). RPC do painel testada com token de admin simulado: LIA × TomTom no mesmo trajeto −9,0% / 12,5% (79% dentro de ±20%); Mapbox × TomTom +0,7% / 9,3%. |
| 10:33 | 10:06 | 13/14: **imatch_ok falhou** (1 recusa no dia, 10:05). Recência 32,4 min, 16/16 corredores | −14,3 / 17,5 | −11,3 / 14,4 / 62 | −1,1 / 7,6 / 59 | **Bug corrigido e no ar (`6596039`).** A causa não era o PostgREST recusar o `imatch`, e sim uma conexão ociosa com o Supabase que caiu (`RemoteProtocolError`); o ILIKE passou numa conexão nova e o código desligou a busca sem acento por 10 min. Agora só um erro respondido pelo PostgREST pausa a regex; queda de conexão tenta de novo. 2 testes novos (159 na API), deploy pela SSM, /health ok e "helio" → "Hélio". |
| 11:03 | 10:36 | 13/14: imatch_ok ainda falha só porque a janela de 70 min do log inclui a recusa das 10:05 (limpa a partir das 11:35). **Gravou no Supabase** (1ª rodada direto na tabela). Recência 16,2 min | −21,7 / 20,4 (n = 12) | −13,6 / 16,4 / 56 | −0,9 / 6,9 / 65 | Sem bug. Os 4 corredores sem LIA (Taguatinga, Samambaia, Águas Claras, Plano → Taguatinga) levaram `ConnectionError` entre 10:36:02 e 10:36:15: o restart do deploy da correção da busca foi às 10:36:00 e a API voltou às 10:36:18. Sem eles, sobram as rotas urbanas do Plano Piloto, que puxam o viés para baixo. As 4 linhas de erro ficam no banco, que é o registro honesto da falha. Lição: deploy fora das rodadas (:05 e :35). |
| 12:50 | 12:38 | 14/14 ok, recência 3,9 min, 30/30 trajetos (16 corredores + 14 viagens entre pontos famosos), gravou | −3,5 / 9,0 (n = 30) | −6,7 / 12,5 / 68 | +0,2 / 9,4 / 65 | 1ª rodada depois do deploy das 12:23 (`3740695`: velocidade livre por grupo de via, δ = 8,1 s, prior `corredor`, `access=no` fora do grafo; comparador com ETA histórico da TomTom e típico do Mapbox). As rodadas de 11:06, 11:36 e 12:06 ficaram sem linha (a sessão estava no deploy): 13–14/14, viés −9,4 a −16,0%, MAPE 14,0–20,0%. O contexto "corredores urbanos 18–26% abaixo" mudou: Asa Norte → Asa Sul −8%, Sudoeste → Lago Sul −3%, Cruzeiro → Asa Norte −4%. Seguem fora Parque → Torre −35% (origem dentro do parque, snap a 341 m), Lago Norte → SCS −23% e UnB → Esplanada +22%. Sem bug novo. |
| 13:54 | 13:08 e 13:38 | 14/14 ok nas duas, recência 30,1 e 14,2 min, 30/30 trajetos, gravou | −1,9 / 8,9 e −3,0 / 9,5 | −5,3 / 12,5 / 63 e −8,2 / 13,0 / 66 | −2,3 / 9,8 e −3,2 / 9,7 | Estável depois do deploy das 12:23: viés da LIA no mesmo trajeto entre −2% e −4%, MAPE < 10%, no nível do Mapbox. Sem bug novo. Mapa vetorial, trânsito por trecho e MFA prontos no código (`e5c2f2a`, `340bc81`), deploy aguardando o dono. |
| 14:35 | 14:08 | 14/14 ok, recência 6,5 min, 30/30 trajetos, gravou | −3,8 / 9,8 | −7,8 / 13,1 / 64 | −1,6 / 9,5 / 62 | Nenhuma. Routify (fusão) × rota da TomTom −4,9 / 11,2 / 68. Mapa vetorial, trânsito por trecho e MFA no ar às 14:02; snap só no maior componente fortemente conexo no ar às 14:20 (`ccb6919`). A rodada das 14:35 é a 1ª depois desse deploy. Sensores virtuais (`3c38c7c`) ficaram só no código: A/B no feriado sem ganho, novo A/B às 18:12. |
| 15:03 | 14:38 | 14/14 ok, recência 28,1 min, 30/30 trajetos, gravou | −4,2 / 10,0 | −8,7 / 13,2 / 67 | −0,8 / 9,0 / 62 | Nenhuma. 1ª rodada depois do snap no maior componente (14:20): nenhum trajeto mudou de tempo (> 15%). O traçado de Metrô Samambaia → Central pula 97 ↔ 3% de rodada em rodada também no Mapbox (90 ↔ 3%): a rota própria da TomTom alterna entre 2 caminhos (1.954 × ~1.900 s). É artefato da referência. |
| 15:33 | 15:08 | 14/14 ok, recência 12,1 min, 30/30 trajetos, gravou | −5,1 / 10,1 | −9,5 / 13,6 / 66 | +1,1 / 9,5 / 66 | Nenhuma. O viés no mesmo trajeto fica um pouco mais negativo à tarde (−3,8 → −4,2 → −5,1), dentro do limite: é o quadro já investigado (a LIA trata o feriado como trânsito leve). |
| 16:03 | 15:38 | 14/14 ok, recência 30,1 min, 30/30 trajetos, gravou | −5,7 / 10,3 | −10,2 / 13,6 / 66 | −0,2 / 8,8 / 72 | Nenhuma. Mesma deriva lenta da tarde (−5,1 → −5,7), dentro do limite. |
| 16:33 | 16:08 | 14/14 ok, recência 26,1 min, 30/30 trajetos, gravou | −5,0 / 10,3 | −10,6 / 13,6 / 65 | −2,3 / 9,4 / 68 | Nenhuma. Estável (viés entre −4 e −6% desde as 14h). |
| 17:03 | 16:38 | 14/14 ok, recência 10,2 min, 30/30 trajetos, gravou | −6,4 / 11,7 | −10,2 / 14,4 / 66 | +1,7 / 9,6 / 71 | Nenhuma. Começo do pico da tarde: viés e MAPE sobem um pouco (−5,0 → −6,4; 10,3 → 11,7), dentro do limite. O OSRM, sem trânsito, também fica mais abaixo da TomTom (−10,3%): congestionamento real, que a LIA vê só em parte. |
| 17:38 | 17:05 (sem rodada) e 17:38 | 17:05: a tarefa saiu na largada com `0xC000013A` (STATUS_CONTROL_C_EXIT, `^C` no `agendador.log`): console fechado ou Ctrl+C, não é bug; a das 17:35 rodou normal (resultado 0). 17:38: 14/14 ok, recência 4,4 min, 30/30 trajetos, gravou | −12,3 / 14,9 | −9,2 / 15,2 / 52 | +1,9 / 9,2 / 57 | Nenhuma: pico da tarde, perto do limite de viés (±15%) sem passar. O OSRM, sem trânsito, fica no mesmo lugar (−12,9%) e o Mapbox concorda com a TomTom (+1,9%): congestionamento real que a LIA vê só em parte (quadro já investigado; feriado tratado como trânsito leve). O traçado da LIA cai para 52% porque a TomTom desvia do trânsito; a rota exibida (fusão) fica em 65%, já que a fusão adota o desvio da TomTom quando ele é claramente mais rápido. |
| 18:08 | 18:08 | 14/14 ok, recência 8,2 min, 30/30 trajetos, gravou | −7,4 / 11,5 | −6,5 / 14,1 / 51 | +4,6 / 9,1 / 59 | Nenhuma. O pico alivia: viés no mesmo trajeto −12,3 → −7,4. A TomTom segue desviando do trânsito (traçado da LIA em 51%, o exibido em 63%). |
| 18:39 | 18:39 | 14/14 ok, recência 5,8 min, 30/30 trajetos, gravou | −7,4 / 11,0 | −5,5 / 14,0 / 52 | −1,8 / 10,8 / 57 | Nenhuma. Fim do pico estável. Às 18:12 o A/B dos sensores virtuais no pico não mostrou ganho: ficaram desligados por padrão no código (`1a79333`, sem deploy; produção nunca os teve). |

## Resumo do dia

O dono encerrou o dia às 18:56, depois da rodada das 18:39. O plano era ir até as 23h, então a noite ficou de fora. A tarefa do Windows foi desligada; o comparador da EC2 segue gravando no Supabase (8 rodadas por dia).

### Hora a hora (de `relatorio.md`)

n = 16 corredores até 12:06 (12 às 10:36) e 30 trajetos a partir das 12:38 (16 corredores + 14 viagens entre pontos famosos). A rodada das 17:05 não existe: a tarefa saiu na largada com `0xC000013A`.

| Hora | Checagens | Mesmo trajeto (viés / MAPE) | Rota da TomTom (viés / MAPE / traçado) | Mapbox × TomTom (viés / MAPE / traçado) | OSRM traçado | Recência | Supabase |
|---|---|---|---|---|---|---|---|
| 02:33 | ok | −1,9% / 10,2% | −5,3% / 13,6% / 62,1% | −0,4% / 9,4% / 63,7% | 64,8% | 3,5 min | pendente |
| 02:43 | ok | −0,9% / 11,0% | −5,3% / 13,7% / 62,1% | 2,7% / 9,0% / 63,7% | 64,8% | 2,9 min | pendente |
| 03:06 | ok | −2,2% / 10,4% | −6,3% / 13,6% / 62,1% | 2,6% / 9,5% / 60,4% | 64,8% | 4,3 min | pendente |
| 04:06 | ok | −3,2% / 10,7% | −7,1% / 13,8% / 62,1% | −2,0% / 9,5% / 65% | 64,8% | 40,1 min | pendente |
| 05:06 | ok | −2,7% / 10,2% | −6,4% / 13,4% / 62,1% | −1,7% / 8,8% / 66,7% | 64,8% | 8,3 min | pendente |
| 06:07 | ok | −4,3% / 9,9% | −5,1% / 12,3% / 61,6% | 4,5% / 10,3% / 65,3% | 63,5% | 22,5 min | pendente |
| 07:06 | ok | −15,3% / 13,5% | −10,8% / 12,2% / 57,7% | 1,8% / 9,4% / 66,2% | 58,9% | 36,4 min | pendente |
| 08:06 | ok | −14,7% / 15,2% | −11,7% / 13,5% / 54,6% | −1,1% / 10,5% / 59,1% | 56,9% | 4,4 min | pendente |
| 09:06 | ok | −8,4% / 12,5% | −9,3% / 13,3% / 58,5% | 4,3% / 9,5% / 58,4% | 59% | 18,5 min | pendente |
| 10:06 | falhou: imatch_ok | −14,3% / 17,5% | −11,3% / 14,4% / 62,4% | −1,1% / 7,6% / 59,4% | 52,6% | 32,4 min | pendente |
| 10:36 | falhou: imatch_ok | −21,7% / 20,4% | −13,6% / 16,4% / 56,1% | −0,9% / 6,9% / 65,1% | 52,6% | 16,2 min | gravou |
| 11:06 | falhou: imatch_ok | −9,7% / 15,1% | −11,4% / 14,4% / 63,9% | −0,2% / 8,3% / 54,8% | 52,6% | 30,3 min | gravou |
| 11:36 | ok | −16,0% / 20,0% | −11,7% / 14,8% / 64,2% | −3,3% / 9,1% / 58,8% | 53,2% | 30,4 min | gravou |
| 12:06 | ok | −9,4% / 14,0% | −11,8% / 14,7% / 67,3% | −2,4% / 8,3% / 58,8% | 55,9% | 14,4 min | gravou |
| 12:38 | ok | −3,5% / 9,0% | −6,7% / 12,5% / 68,3% | 0,2% / 9,4% / 64,5% | 64,8% | 3,9 min | gravou |
| 13:08 | ok | −1,9% / 8,9% | −5,3% / 12,5% / 62,6% | −2,3% / 9,8% / 64,0% | 62,0% | 30,1 min | gravou |
| 13:38 | ok | −3,0% / 9,5% | −8,2% / 13,0% / 65,6% | −3,2% / 9,7% / 67,7% | 66,2% | 14,2 min | gravou |
| 14:08 | ok | −3,8% / 9,8% | −7,8% / 13,1% / 63,8% | −1,6% / 9,5% / 61,6% | 62,0% | 6,5 min | gravou |
| 14:38 | ok | −4,2% / 10,0% | −8,7% / 13,2% / 67,0% | −0,8% / 9,0% / 62,4% | 64,8% | 28,1 min | gravou |
| 15:08 | ok | −5,1% / 10,1% | −9,5% / 13,6% / 65,6% | 1,1% / 9,5% / 66,1% | 64,3% | 12,1 min | gravou |
| 15:38 | ok | −5,7% / 10,3% | −10,2% / 13,6% / 65,7% | −0,2% / 8,8% / 72,2% | 67,0% | 30,1 min | gravou |
| 16:08 | ok | −5,0% / 10,3% | −10,6% / 13,6% / 65,0% | −2,3% / 9,4% / 67,9% | 66,5% | 26,1 min | gravou |
| 16:38 | ok | −6,4% / 11,7% | −10,2% / 14,4% / 66,0% | 1,7% / 9,6% / 71,1% | 66,0% | 10,2 min | gravou |
| 17:38 | ok | −12,3% / 14,9% | −9,2% / 15,2% / 52,0% | 1,9% / 9,2% / 57,1% | 60,9% | 4,4 min | gravou |
| 18:08 | ok | −7,4% / 11,5% | −6,5% / 14,1% / 50,6% | 4,6% / 9,1% / 59,4% | 59,2% | 8,2 min | gravou |
| 18:39 | ok | −7,4% / 11,0% | −5,5% / 14,0% / 52,2% | −1,8% / 10,8% / 57,4% | 61,6% | 5,8 min | gravou |

### Por período

| Período | Rodadas | Mesmo trajeto: viés / MAPE | Traçado da LIA | Mapbox × TomTom: viés / MAPE | Leitura |
|---|---|---|---|---|---|
| Madrugada (02:33–06:07) | 6 | −0,9 a −4,3 / 9,9–11,0 | 62% | −2,0 a +4,5 / 8,8–10,3 | Trânsito livre: a LIA fica perto da TomTom. |
| Pico da manhã (07:06–09:06) | 3 | −8,4 a −15,3 / 12,5–15,2 | 55–59% | −1,1 a +4,3 / 9,4–10,5 | A LIA subestima o pico (feriado tratado como trânsito leve). O OSRM, sem trânsito, também fica abaixo e o Mapbox concorda com a TomTom: o congestionamento é real. Os corredores urbanos do Plano ficam até abaixo do tempo sem trânsito da TomTom. |
| Fim da manhã, antes do deploy (10:06–12:06) | 5 | −9,4 a −21,7 / 14,0–20,4 | 56–67% | −3,3 a −0,2 / 6,9–9,1 | O mesmo viés urbano, agravado pela velocidade livre das ruas locais e coletoras (≈ 2× o tempo do limite de via). Às 10:36 a média é de 12 corredores: 4 caíram no restart do deploy da busca. |
| Almoço e tarde, depois do deploy das 12:23 (12:38–16:38) | 9 | −1,9 a −6,4 / 8,9–11,7 | 63–68% | −3,2 a +1,7 / 8,8–9,8 | Calibração por grupo de via e prior `corredor` no ar: viés de −2 a −6%, no nível do Mapbox. Medida pareada no mesmo conjunto: corredores −9,1%/12,7% → −2,3%/8,7% (`ml/artifacts/ab_calibracao_grafo_2026-11-02.json`), porque o conjunto de trajetos mudou às 12:38. |
| Pico da tarde (17:38–18:39) | 3 | −7,4 a −12,3 / 11,0–14,9 | 51–52% (exibido 63–66%) | −1,8 a +4,6 / 9,1–10,8 | Volta do feriadão. A LIA subestima de novo e a TomTom desvia do trânsito. A fusão adota o desvio quando ele é claramente mais rápido, por isso a rota exibida fica mais perto da TomTom que a da LIA. |
| Noite | — | — | — | — | Não coberta (dia encerrado às 18:56). |

### Achados

1. **Velocidade livre das ruas locais e coletoras** ≈ 2× o tempo do limite de via. Era a principal causa dos corredores urbanos 18–26% abaixo da TomTom (07h). Corrigido com fatores por grupo de via ajustados no nível da rota (12:23).
2. **Busca sem acento desligada por 10 min às 10:05.** Uma conexão ociosa com o Supabase caiu (`RemoteProtocolError`), e o código tratou a queda como recusa do `imatch`. Corrigido às 10:36.
3. **Picos:** a LIA subestima o congestionamento de feriado. O Mapbox concorda com a TomTom e o OSRM, sem trânsito, erra junto com a LIA. É limite do modelo (trata o feriado como trânsito leve) e não se corrige sem retreino: fica para a LIA 2.4, com os dados novos.
4. **Traçado de referência instável:** em algumas viagens a rota própria da TomTom alterna entre 2 caminhos de uma rodada para outra (Metrô Samambaia → Central: 97 ↔ 3% também no Mapbox). O traçado médio tem esse ruído.
5. **Snap no maior componente fortemente conexo** (14:20): nenhum trajeto mudou de tempo em mais de 15% na rodada seguinte, sem regressão.
6. **Sensores virtuais:** os dois A/B do feriado (14h30 e 18h12) não mostraram ganho. Com os buracos quase livres, o Flow leu fluxo livre e deixou a LIA até 19 s mais otimista. Ficam no código, desligados por padrão.
7. **Rodada das 17:05 perdida:** a tarefa saiu com `0xC000013A` (console fechado ou Ctrl+C). Não é bug do código.

### Correções no ar hoje

- 02:23: LIA 2.3, velocidade livre na escala da TomTom e 10 bugs da inferência (`661023e`, `7f270f4`).
- 10:36: queda de conexão não desliga mais a busca sem acento (`6596039`).
- 12:23: velocidade livre por grupo de via, δ = 8,1 s, prior `corredor`, `access=no` fora do grafo, ETA da TomTom quando a rota dela vence (`3740695`, `7d5bbfa`).
- 12:45 em diante: busca com ~1.700 pontos do OSM, qualificadores do DF e erros de digitação curtos (`8155758`, `d13e364`, `595fdaf`).
- 13:58 e 14:02: mapa vetorial, trânsito por trecho, MFA com aal2 e linguagem de auth do Valerium (`e5c2f2a`, `340bc81` + migration `20261102020000_mfa_aal2`).
- 14:20: snap de origem e destino só no maior componente fortemente conexo (`ccb6919`).

No `main` e fora da produção, sem efeito no ar: sensores virtuais desligados (`3c38c7c`, `1a79333`) e limpeza da auditoria ponytail (`0a27318`).

### Pendências

- **Dono:** decidir os cortes da auditoria ponytail (`.planning/research/2026-11-02-ponytail-audit.md`).
- **Dono:** conferir o snapshot do RDS, liberar o Billing para usuários IAM e acompanhar o 1º login do Pedro com MFA.
- LIA 2.4 (dezembro, com a coleta nova): pico e feriado são o maior erro restante.
- Restrições de conversão (retorno Plano → Taguatinga) e snap com vários candidatos em via dupla.
- Sensores virtuais: A/B em dia útil com trânsito nos buracos antes de ligar.
- Códigos de recuperação do MFA.
- `scripts/rotina_validacao.py` é de uma noite só: remover ou generalizar (item 19 da auditoria).
