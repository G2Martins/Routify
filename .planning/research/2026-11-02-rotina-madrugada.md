# Rotina de validação da LIA, madrugada de 2026-11-02

**Última revisão:** 2026-11-02

De hora em hora até as 09:30 e, a pedido do dono, a cada 30 min até as 23h: a tarefa do Windows roda
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
