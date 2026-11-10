# Fontes de dados para a LIA: o que serve no DF (2026-11-09)

**Última revisão:** 2026-11-09

Pergunta do dono: dá para aumentar as amostras da LIA de graça, no DF inteiro, até 13/11? Resposta curta: amostra com o
mesmo alvo (razão de velocidade) só vem da nossa coleta TomTom. O resto serve para validar.

| Fonte | O que dá | Decisão |
|---|---|---|
| TomTom Flow, 150 pontos novos (`proposta_expansao_sensores.json`) | mesmo alvo, em buracos de sensor | **adotar**: a cota por dia não muda, só a cadência (`intervalo_diurno`) |
| Fluxo DER-DF ([dataset](https://dados.df.gov.br/o/dados-abertos/v1.0/datasets/volume-diario-de-trafego-trechos-rodoviarios), CC-BY, mensal, até jul/2026) | contagem de 15 min em 93 trechos de rodovia distrital, sem velocidade nem coordenada | **validação**: `validacao_der.py`, r = 0,80 entre fluxo e lentidão por hora |
| GPS dos ônibus (SEMOB, `/service/gps/operacoes`, aberto, sem histórico) | posição e velocidade de ~1.800 veículos em todo o DF | **fora do escopo (2026-11-09)**: os sites do GDF (até `www.df.gov.br`) não respondem a IPs da AWS, e a coleta só rodava no PC do dono. O coletor foi removido; o que ele gravou ficou só em `services/collector/dados/gps` (gitignored). Ônibus para no ponto e usa faixa exclusiva: nunca seria alvo |
| Mapbox `driving-traffic` | ETA com trânsito no DF todo | **só comparar** (já no comparador). Os Product Terms são PDF e não confirmei se permitem treinar |
| Radares DETRAN-DF | 39 linhas por região, sem coordenada | **não serve**. Para o mapa usamos o OSM: 273 radares (`scripts/radares_osm.py`) |
| Infosimples (placas, multas) | dado pessoal | **não usar** (LGPD, sem utilidade aqui) |
| Portal dados.df.gov.br | não é CKAN: `/api/3/action/*` dá 404. A API é `/o/dados-abertos/v1.0/datasets` | nota técnica |

## Google Maps: plano de ação

Conclusão: **não montar coleta**. Conferido em 2026-11-09 sobre o que abriu; o texto integral dos termos não abriu nesta rodada.

- Crédito grátis: o de US$ 200 acabou em março/2025. Hoje há franquia mensal por SKU (Essentials 10 mil, Pro 5 mil,
  Enterprise 1 mil) ([FAQ](https://developers.google.cn/maps/billing-and-pricing/faq?authuser=3)). A pesquisa de 2026-11-02 registrou
  conta de faturamento obrigatória, ou seja, cartão do dono, o que conflita com o requisito de custo zero em caso de estouro.
- Guardar: os termos específicos só permitem cache temporário de latitude e longitude da Directions API, por até 30 dias
  ([Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)). Tabela no Supabase para treino não cabe nisso.
- Treinar: a pesquisa de 2026-11-02 registrou proibição de uso em ML; hoje só achei isso em fonte secundária. Com a regra de
  armazenamento acima, a conclusão não muda.

Se um dia valer a pena: comparar ao vivo, sem gravar a resposta, com chave restrita e teto de cota no console. Exige a conta
de faturamento do dono. Não entra antes da entrega.

## Efeito de mais dados na LIA

`gate_lia_2_4.py`: treinar também com novembro reduziu o erro fora do tempo em 7,4% (RMSE) e 11,5% (MAE) sobre a 2.3, com
só ~7 dias a mais de coleta uniforme. Pesar novembro ou equilibrar as horas não superou o peso igual. Repetir o portão quando
houver dias novos, com os 150 pontos incluídos (`backup_*_vias_monitoradas.parquet` precisa estar atualizado para o contexto).
