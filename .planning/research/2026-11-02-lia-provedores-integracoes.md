# LIA 2.3, comparação com provedores, caça a erros e integrações

**Última revisão:** 2026-11-02

Continuação de [2026-11-01-analise-melhorias-e-testes.md](2026-11-01-analise-melhorias-e-testes.md). Pedido do dono:
melhorar a LIA e deixá-la na melhor configuração, caçar erros nela, comparar com outros provedores no painel ADM,
melhorar o auto-sugest e levantar integrações novas. Números citados aqui vêm dos artefatos versionados em
`ml/artifacts/` (chave entre parênteses).

## 1. LIA 2.3: o que mudou e por quê

Três problemas de método, medidos na revisão de 2026-11-01 e confirmados na ablação (`ablation_lia_2.3.json`):

1. **Perfis in-sample.** O perfil histórico de cada linha de treino incluía o próprio alvo dela. O modelo aprendia a
   confiar demais no perfil. Correção: perfis fora da amostra no treino (8 blocos de dias; `features.apply_profiles_oof`).
2. **Recência sempre fresca no treino.** Nos dias cheios a última leitura tinha ~8 min; em produção, com a coleta a
   cada 43 min, chega com 0–48 min (mais quando a partida é no futuro). A LIA 2.2 virava "só perfil" acima de ~20 min.
   Correção: metade das linhas de treino com a recência envelhecida em 15–480 min (`features.envelhecer_recencia`).
3. **Early stopping na validação da CV.** A parada escolhia pelo mesmo conjunto que depois era medido (otimista).
   Correção: parada no último 10% do próprio treino; o modelo final usa a mediana das paradas da CV (600 árvores).

Ablação nos mesmos 5 folds, com as features da 2.2 (RMSE / MAE em segundos por trecho):

| Variante | Fresca | Leitura 15 min | 30 min | 60 min | 120 min |
|---|---|---|---|---|---|
| 2.2 (reproduz o metadata: 40,27) | 40,27 / 14,44 | 44,5 | 52,5 | 56,7 | 61,3 |
| + early stopping interno | 40,63 / 14,22 | 44,7 | 52,2 | 55,9 | 61,2 |
| + perfis OOF | 35,30 / 13,10 | 39,7 | 51,4 | 57,1 | 67,5 |
| **2.3** (+ recência envelhecida) | **35,48 / 13,31** | **38,5** | **43,8** | **47,2** | 61,5 |
| Persistência (repetir a última leitura) | 39,96 / 12,04 | 46,7 | 64,8 | 88,0 | 128,9 |

Leitura para a banca: com leitura de poucos minutos a persistência é difícil de bater (ganha no MAE). Isso não é a
produção. Em toda idade realista da leitura a 2.3 ganha dela com folga, e o RMSE geral cai 12% contra a 2.2.

**Teste definitivo, em dezembro:** `ml/avaliar_fora_do_tempo.py` mede 2.2 × 2.3 × persistência só nas leituras
coletadas depois de 2026-11-02 (nenhum modelo as viu). Precisa de `silver.py` e `fetch_contexto.py --fim <data>` antes.

## 2. Velocidade livre na escala da TomTom

A LIA foi treinada com a velocidade livre da TomTom (feature e denominador do alvo); a rota usava o limite do OSM,
mais alto. Experimento na API local, 14 corredores, contra a TomTom no MESMO trajeto, madrugada de 02/11
(`experimento_velocidade_livre.json`):

| Configuração | Viés mediano | MAPE | Dentro de ±20% |
|---|---|---|---|
| LIA 2.2 + limite do OSM (produção até 02/11) | −11,9% | 16,1% | 9 de 14 |
| LIA 2.2 + fator por classe de via | −9,4% | 17,6% | 9 de 14 |
| LIA 2.2 + fator único 0,883 | −2,2% | 13,6% | 11 de 14 |
| **LIA 2.3 + fator único** | **−0,2%** | **10,2%** | **13 de 14** |

- O fator é a mediana de `freeFlowSpeed TomTom / limite OSM` na aresta mais próxima de cada um dos 529 pontos medidos.
- Fator por classe foi rejeitado: desacelerar só as arteriais empurra o A* para ruas menores que a TomTom avalia como
  bem piores (Lago Norte → SCS: 778 s → 1.581 s). Um fator único muda a escala sem mudar a rota.
- Primeira tentativa media também as ruas a até 30 m do sensor: elas herdavam a velocidade da arterial (fator 1,2 em
  `residential`) e o MAPE piorou para 23%. A medida usa só a via do próprio sensor.
- Limitação: madrugada de feriado (via livre). O comparador da EC2 mede o dia inteiro.

## 3. Caça a erros (agente dedicado, 2026-11-02)

Bugs confirmados e corrigidos no mesmo dia, cada um com teste de regressão em `apps/api/tests/test_lia_caca_erros.py`:

| Bug | Efeito | Correção |
|---|---|---|
| `/predict` ignorava o offset do `timestamp_brasilia` | `…20:30Z` virava 20h (certo: 17h); razão 0,9976 × 0,8349 | converte para Brasília |
| `/predict` sem horizonte | leitura de agora valia para daqui a 7 ou 28 dias | recência envelhece até o instante; some acima de 24 h; passado não usa leitura ao vivo |
| NaN no corpo | 500 (o 422 ecoava `input: nan` e a serialização estourava) | handler de 422 sem eco do valor |
| `Infinity` aceito | 200 com `velocidade_prevista_kmh: null` | `allow_inf_nan=False` e tetos |
| timestamp ano 1 | 500 (`OverflowError`) | 422 fora de 2000–2099 |
| override de recência pela metade | razão sozinha assumia leitura de 0 min | os dois campos vêm juntos |
| clima velho | Open-Meteo fora do ar mantinha o último tempo para sempre | descarta após 3 h |
| heurística do A* | 30 m/s fixos; arestas de 110 km/h a violavam | divide pela maior velocidade do grafo |
| `maxspeed` "50;60" | virava 5060 km/h (latente) | menor número |
| recência sem teto | a API serviu leitura de julho com delta de 100 dias | teto de 24 h |

Riscos que ficaram no backlog (com motivo):
- **`/route` bloqueia o event loop** (~2 s de CPU por rota; `/health` levou 3,5 s durante uma rota). Jogar o A* numa
  thread criaria corrida, porque os pesos são mutados no próprio grafo; pede pesos por requisição ou cache por
  (hora, dia, ciclo).
- **Ponto único no boot:** se o Supabase falhar na subida, a LIA fica fora até reiniciar e o `/health` segue "ok".
- **`LIMITE_LINHAS_BUSCA=2000`** no cache de recência provavelmente vira 1.000 pelo `max_rows` do PostgREST (não medido).
- **Pontos facultativos** (24/12, 31/12) não entram como feriado.

## 4. Provedores para comparar (pesquisa de termos e cotas)

| Provedor | Trânsito ao vivo | Custo zero | Termos (benchmark, guardar, lado a lado) | Decisão |
|---|---|---|---|---|
| TomTom Routing | sim | já temos | termos atrás de login; mesma família de dados do rótulo da LIA | referência (não independente) |
| OSRM público | não | sem chave, ≤ 1 req/s, uso razoável | nada contra; política FOSSGIS não lida (anti-bot) | entra (tempo de mapa) |
| Mapbox `driving-traffic` | sim | 100 mil/mês | ToS sem cláusula de benchmark achada | entra quando o dono criar o token (`MAPBOX_TOKEN`) |
| OpenRouteService | não | 2.000/dia com conta | atribuição; resultados CC-BY (resumo) | opcional (`ORS_API_KEY`) |
| Valhalla (FOSSGIS/Stadia) | só pago | — | Stadia proíbe benchmark e cache | fora |
| HERE v8 | sim | pede cobrança | AUP proíbe benchmark | fora |
| Google Routes | sim | billing obrigatório | proíbe guardar e usar em ML | fora |
| Azure Maps | sim | 1.000/mês, assinatura | proíbe exibir sobre mapa de terceiros | fora |

Em qualquer provedor: atribuição na página e nada de ETA de terceiro na tese sem conferir os termos de novo.

## 5. Integrações para enriquecer a LIA (ranking ganho/esforço)

1. **Calendário escolar SEEDF + UnB** (PDF, ~30 datas à mão): flag dia letivo/recesso. Melhor ganho/esforço; entra
   na LIA 2.4 com os dados de novembro.
2. **INMET** (estações A001, A042, A045–A047 no DF): chuva medida no lugar da modelada (Open-Meteo/ERA5). O dado
   horário parece exigir token (não confirmado); o ZIP anual sai em lote.
3. **DER-DF Fluxo Veicular** (dados.df.gov.br, CC-BY, 15 min × trecho, 2018–jul/2026): volume, não só velocidade;
   serve para pesar as horas e corrigir o viés de cobertura do dataset. Esforço médio-alto (casar trecho por rodovia+km).
4. **PRF/DATATRAN**: acidentes nas BRs do DF (o urbano já vem da TomTom Incidents).
5. **ANP**: preço semanal do combustível para a estimativa de economia (sem efeito na LIA).
6. Descartados ou pós-TCC: SEMOB/DFTrans (sem GTFS; GPS ao vivo sem licença), Waze for Cities (só órgão público),
   Google Popular Times (viola ToS), DETRAN-DF (acidentes sem coordenada), eventos (sem agenda estruturada).

## 6. Tarde de 2026-11-02: outros provedores além do OSM e o grafo

Pedido do dono: usar outros provedores além do OpenStreetMap, ver o que as APIs novas acrescentam e ajustar o grafo se ele estiver ruim.

**O que entrou (no ar desde 12:23 e, a busca, depois da bateria):**

| Fonte | O que dá | Uso |
|---|---|---|
| TomTom `computeTravelTimeFor=all` | `historicTrafficTravelTimeInSeconds`: o ETA só pelo histórico da TomTom, no mesmo trajeto da LIA (fusão) e na rota dela | comparador e painel (`admin_provedores_historicos`). É o equivalente da LIA na TomTom, sem chamada extra |
| Mapbox `driving-traffic` | `duration_typical`: trânsito típico do horário | comparador e painel, ao lado do `duration` ao vivo |
| OSM (Geofabrik) | ~1.700 pontos de interesse do DF (metrô, terminais, shoppings, hospitais, universidades, parques, atrações) com nomes alternativos | busca local (`pois_df.json`); a TomTom não tinha a maioria das estações |

O comparador também deixou de gravar a linha `tomtom` sem o tempo sem trânsito: a chamada não pedia `computeTravelTimeFor=all` (0 de 304 linhas tinham o campo).

**Descartado ou adiado:**
- *Mapbox `annotations=maxspeed/speed` para preencher o grafo:* derivar dado de mapa de uma API comercial para guardar no nosso grafo esbarra nos termos de uso (e não casa com a ODbL do OSM). Fica só para comparar.
- *Mapbox Search/Geocoding:* o resultado não pode ser guardado e o ganho sobre TomTom + OSM local seria pequeno.
- *Restrições de conversão (`restriction` do OSM):* exigem grafo por aresta. Evidência: em Plano → Taguatinga a rota da LIA termina num retorno pela Avenida Comercial que a TomTom não aceita (reconstrução ×1,23 em todas as rodadas). Backlog, junto do snap com vários candidatos em via dupla.

**O que estava ruim no grafo e foi corrigido:**
1. Velocidade livre das ruas locais e coletoras: ≈ 2× o tempo do limite de via. Fatores por grupo ajustados no nível da rota contra a TomTom sem trânsito (`semaforos_calibracao.json`).
2. Aresta sem sensor nascia em fluxo livre: o perfil global é uma mediana, 1,0 em 75% das combinações hora × dia. Agora parte da lentidão prevista no momento (`PRIOR_CONGESTIONAMENTO=corredor`).
3. `access=no` (condomínio fechado, alça fechada): 41 arestas que o filtro `drive` do OSMnx 1.9 deixava passar.
4. Heurística do A*: o limite de velocidade não incluía a velocidade livre da TomTom dos trechos monitorados.

**Diagnóstico que não deu em correção:** os corredores com pouco traçado em comum (Cruzeiro → Asa Norte, Parque da Cidade → Torre, Lago Norte → SCS, Ceilândia) não têm via faltando nem sentido errado no grafo. A diferença vem da escolha de rota (pesos) e, no Parque da Cidade, do ponto de origem dentro do parque, a 341 m da rede de carros.

**Bateria de busca em produção** (79 pontos famosos × 5 jeitos de digitar, `scripts/bateria_busca.py`): top 5 de 72,7% para 94,7%, top 1 de 58,7% para 84,8%, estações de metrô de 49,6% para 99,3%, nenhum ponto sem acerto, mediana de 515 → 504 ms. Sobram: erros de digitação em palavra curta de via da malha ("eixo rodoviraio"), lugares que nem o OSM nem a TomTom têm com esse nome (Águas Claras Shopping, "Museu Nacional da República") e artefatos do gabarito (Eixão, UnB e parques: o centro do polígono fica longe da entrada que a busca devolve).

**Grafo do DF inteiro e buracos de dados (14h–14h30).** A auditoria por região administrativa (`ml/auditoria_grafo_df.py`) mostrou que o grafo é uma caixa de ±38 km, com 79% da área e 92,2% das vias do DF, e que 83,2% dos km de via não têm sensor a 500 m (20 das 35 RAs sem nenhum). Ela achou bolsões de mão única em São Sebastião, Sobradinho e no Lago Norte, onde a origem caía num nó sem saída. Correção: o snap só usa o maior componente fortemente conexo (no ar às 14:20). Para os buracos, a fusão já punha o tempo da TomTom e as seções de trânsito dela. O que faltava era a escolha do caminho enxergar lentidão ali. Entraram os **sensores virtuais**: 1 ponto por célula de ~1 km com via principal e sem sensor, até 3 lidos por rota no Flow (cache de 15 min), aplicados só no trecho e no sentido medidos. A/B no mesmo instante, em 10 viagens pelos maiores buracos (feriado, 14h30), saiu igual nos dois lados: LIA × TomTom no mesmo trajeto −6,6%/13,2% × −6,6%/13,3%, exibido × rota da TomTom −2,2%/5,4% nos dois, traçado 66,2% nos dois. As leituras chegaram (2–3 por rota, 12–165 arestas), mas com pouco trânsito a razão medida fica perto da prevista. Um 2º A/B, no pico do fim do feriado (18h12), achou os buracos quase livres (TomTom 2–9% acima do tempo sem trânsito). O Flow nos pontos virtuais leu fluxo livre e deixou a LIA até 19 s mais otimista em 5 das 10 viagens, sem mudar nenhum traçado: LIA × TomTom no mesmo trajeto −8,1%/11,5% × −8,1%/11,8%, exibido × rota da TomTom −2,1%/5,6% × −2,3%/5,7% (`ml/artifacts/ab_sensores_virtuais_2026-11-02.json`). Um ponto do Flow não enxerga os atrasos de cruzamento que a rota inteira da TomTom soma, e o prior `corredor` já punha alguma lentidão nesses trechos. Decisão: fica no código, **desligado por padrão** (`SENSORES_VIRTUAIS=1` liga), até um A/B em dia útil com trânsito nos buracos.

## 7. Noite de 2026-11-02: LIA 2.4 candidata e testes contínuos na AWS

**Dados novos não bastam ainda.** A coleta da EC2 tinha 17.010 linhas em 27 ciclos às 20h (630 pontos), todas do
feriado: 1,1% do dataset e um dia atípico. Entrar com elas só mudaria os folds.

**Candidata testada: pesos por período.** Hipótese: o viés de cobertura (23% das linhas às 21h, fim de semana com
1/8 do volume) tira peso dos picos. `train.py --pesos-periodo ALFA` pesa cada linha por (média das células / linhas
da célula)^ALFA, célula = (hora, fim de semana). O treino agora mede o erro por período (pico da manhã e da tarde de
dia útil, dia útil, noite, madrugada, dia de fim de semana), com a leitura fresca e com a de 30 min, perto da
produção. Ablação nos mesmos 5 folds (`ml/ablation_lia_2_4.py` → `ml/artifacts/ablation_lia_2.4.json`):

| Variante | RMSE / MAE (s) | Pico da tarde, dia útil: viés / MAE (s) | Leitura de 30 min: RMSE / MAE (s) |
|---|---|---|---|
| 2.3 | 35,48 / 13,31 | −11,3 / 34,4 | 43,75 / 16,94 |
| +pesos 0,5 | 35,88 / 14,00 | −11,5 / 35,7 | 44,39 / 17,73 |
| +pesos 1 | 35,19 / 13,57 | −10,1 / 34,6 | 44,04 / 17,41 |

Rejeitada: o viés do pico da tarde fica em −10 a −11 s por trecho em todas as variantes e o cenário de produção
(leitura de 30 min) piora. O achado que fica para a tese: **a LIA subestima o pico da tarde de dia útil já no
treino** (viés −11,3 s com leitura fresca, mesma direção da produção no feriado). Com leitura fresca a persistência
ganha nesse período (MAE 28,9 × 34,4 s); com 30 min a LIA ganha (42,0 × 56,1 s). Pesos de amostragem não mexem nisso,
então o viés não vem da proporção de linhas. Suspeitas (não testadas): a recência não acompanha a subida do pico e o
perfil usa a mediana. Próximos candidatos (dezembro, com semanas de dia útil coletadas a cada 43 min): dados novos
primeiro; depois tendência da recência (duas últimas leituras) e perfil por quantil no pico.

**Testes contínuos na AWS** (no ar desde 20:50, `docs/core/deploy.md` §1.1): a rotina de validação deixou o PC e
virou `routify-rotina.service`, disparada pelo fim de cada rodada do comparador (8 por dia, picos inclusos), sem
gasto extra de TomTom. O A/B dos sensores virtuais roda sozinho nos picos de dia útil (07:40, 08:40, 17:40 e 18:40),
com o braço B só de pé durante a medida, até 2026-11-13. Teste às 20:55: B subiu no sandbox, 10 viagens, JSON gravado.
