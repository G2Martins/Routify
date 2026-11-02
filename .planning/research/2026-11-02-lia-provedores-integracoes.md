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
