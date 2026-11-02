# Resultados, calibração e limitações — rascunho para o texto final

**Última revisão:** 2026-11-02

> **Status: rascunho.** Redigido com apoio de IA a partir dos artefatos versionados do repositório (`ml/artifacts/*.json`), para atender às recomendações do orientador sobre a seção de Resultados e Discussão. A equipe deve revisar, reescrever com a própria voz e declarar o uso de IA conforme as normas da instituição. Todo número abaixo aponta para a chave do JSON de origem; as figuras são geradas por `ml/thesis_figures.py` e se atualizam sozinhas quando os JSONs mudarem.

## 1. Métricas

O desempenho é medido em **segundos de tempo de viagem por trecho**. O modelo prevê a razão de congestionamento r = v<sub>atual</sub> / v<sub>livre</sub> ∈ [0,05; 1]; o tempo previsto é t̂ = L / (v<sub>livre</sub> · r̂), em que L é o comprimento real do trecho.

- **MAE** = (1/n) Σ |t<sub>i</sub> − t̂<sub>i</sub>| — erro típico, em segundos.
- **RMSE** = √[(1/n) Σ (t<sub>i</sub> − t̂<sub>i</sub>)²] — penaliza mais os erros grandes, que concentram-se justamente nos trechos congestionados.

Reportar as duas métricas mostra se um ganho vem de reduzir erros típicos (MAE) ou erros grandes (RMSE). A validação é **cruzada temporal** (TimeSeriesSplit, 5 folds): cada fold de validação é um período posterior ao de treino.

**Baseline histórico:** a mediana da razão observada para a mesma via, hora e dia da semana (com a cascata de generalização via+hora+dia → via+hora → via → hora+dia → global). É o que um sistema sem aprendizado de máquina faria com os mesmos dados.

> **Correção para o texto:** a coluna "Erro médio" do Resumo Técnico (74,7 / 51,3 / 40,7 s) corresponde ao **RMSE**. A Tabela 1 traz as duas métricas.

## 2. Evolução da LIA (Tabela 1, Figura 1)

**Tabela 1 — Erro na validação cruzada por versão**

| Versão | Validação | MAE (s) | RMSE (s) | RMSE × baseline | Fonte |
|---|---|---|---|---|---|
| LIA 1.0 | não temporal (inválida) | 50,8 | 74,7 | não comparável | `lia_1.0_supabase_metadata.json` › `cv_mae_medio_seg`, `cv_rmse_medio_seg` |
| Baseline histórico | temporal | 17,3 | 57,2 | — | `lia_2.1_metadata.json` › `cv.baseline_mae_seg`, `cv.baseline_rmse_seg` |
| LIA 2.0 | temporal | 18,6 | 51,4 | −10,1% | `benchmark_lstm_vs_xgboost.json` › `xgboost.mae_seg_media`, `rmse_seg_media` |
| LIA 2.1 | temporal | 14,6 | 40,7 | **−28,8%** | `lia_2.1_metadata.json` › `cv.modelo_mae_seg`, `cv.modelo_rmse_seg` |
| LIA 2.1 (reprodução) | temporal | 14,5 | 40,9 | −28,5% | `lia_2.1_repro_metadata.json` › `cv.modelo_mae_seg`, `cv.modelo_rmse_seg` |
| LIA 2.2 (+ contexto) | temporal | 14,4 | 40,3 | **−29,6%** | `lia_2.2_metadata.json` › `cv.modelo_mae_seg`, `cv.modelo_rmse_seg` |
| Persistência (repetir a última leitura) | temporal | 12,0 | 40,0 | −30,1% | `lia_2.3_metadata.json` › `cv.persistencia_mae_seg`, `cv.persistencia_rmse_seg` |
| LIA 2.3 (receita corrigida) | temporal | 13,3 | 35,5 | **−37,9%** | `lia_2.3_metadata.json` › `cv.modelo_mae_seg`, `cv.modelo_rmse_seg` |

![Figura 1](../figuras/fig1_erro_versoes.png)

*Figura 1 — MAE e RMSE da validação cruzada por versão da LIA, comparados ao baseline histórico (linha tracejada). Barras de erro: desvio padrão entre os 5 folds temporais.*

**Leitura.**
- **LIA 1.0 não é comparável.** A validação cruzada separava vias, e não períodos. Além disso, o alvo era o tempo de um trecho de comprimento fixo, e as features de defasagem eram fabricadas em produção.
- **LIA 2.0 reduz o RMSE em 10,1%, mas tem MAE 8,0% pior que o baseline.** Ela diminui os erros grandes sem melhorar o erro típico.
- **LIA 2.1 melhora as duas métricas** (MAE −15,3%, RMSE −28,8%). O ganho vem da feature de recência: a última observação real da via e o tempo decorrido desde ela.

**LIA 2.2 — ablação das features de contexto** *(2026-09-23)*.
- A 2.2 é a receita da 2.1 (mesmos hiperparâmetros manuais, mesmos folds) com 5 features a mais: congestionamento recente das 5 vias monitoradas mais próximas (≤ 3 km, janela de 60 min antes do instante), chuva da hora anterior e das 3 últimas horas (Open-Meteo) e feriado (BrasilAPI + distritais do DF). Regras em `apps/api/contexto.py`, o mesmo código no treino e na API.
- A comparação justa é com a **reprodução** da 2.1 no mesmo ambiente (`lia_2.1_repro`), não com o modelo original: a reprodução difere do original em +0,2 s no RMSE e −0,1 s no MAE, dentro do desvio entre folds (±5,5 s).
- **RMSE:** 40,88 → 40,27 s (−1,5%), menor nos **5 de 5 folds** (`cv_folds` dos dois metadados). RMSE no congestionado: 88,14 → 86,74 s.
- **MAE:** 14,51 → 14,44 s, mas menor em só 3 de 5 folds. Leitura: o contexto reduz os **erros grandes** (episódios de congestionamento), não o erro típico.
- **Estresse treino × produção** (`lia_2.2_estresse.json`, fold 5): sem coleta contínua, a API nem sempre tem vizinhos com leitura recente. Com leitura da via e dos vizinhos, a 2.2 ganha (RMSE 33,73 × 34,55 s). Com tudo velho (fora do corredor consultado na TomTom), também ganha (42,99 × 43,43 s). Com a via lida agora e **nenhum** vizinho recente, perde por pouco (34,88 × 34,55 s). Com chuva ausente enviada como NaN, perde (34,18 s); por isso a API manda 0.
- Decisão (2026-09-23): a 2.2 vira o padrão da API. Substituída pela 2.3 em 2026-11-02.

**LIA 2.3 — receita corrigida** *(2026-11-02; `ablation_lia_2.3.json`, uma mudança por vez nos mesmos 5 folds)*.
- **O baseline que faltava:** repetir a última leitura da via (persistência) tem RMSE 39,96 s e MAE 12,04 s, empatando com a 2.2 no RMSE e ganhando no MAE. Isso acontece porque, nos dias cheios, a última leitura tem ~8 min. Na API ela chega com 0–48 min (coleta a cada 43 min), e aí a persistência despenca: RMSE 64,8 s com leitura de 30 min e 88,0 s com 60 min.
- **Três correções de método:** (1) perfis históricos fora da amostra no treino (o perfil de cada linha incluía o próprio alvo); (2) metade do treino com a recência envelhecida (15–480 min), como ela chega na API; (3) early stopping no fim do próprio treino, e não na validação que depois é medida.
- **Efeito (RMSE em s, fresca / leitura de 30 min / 60 min):** 2.2 = 40,27 / 52,5 / 56,7; + perfis fora da amostra = 35,30 / 51,4 / 57,1; **2.3 = 35,48 / 43,8 / 47,2**; persistência = 39,96 / 64,8 / 88,0.
- Leitura: os perfis fora da amostra explicam o ganho com leitura fresca; o envelhecimento explica o ganho com a leitura como ela chega na API. Em toda idade realista a 2.3 ganha da persistência. Com leitura de poucos minutos, a persistência ainda ganha no MAE (12,04 × 13,31 s): declarar.
- **Velocidade livre:** a LIA aprende com a velocidade livre da TomTom, e a rota usava o limite do OSM, mais alto. Um fator único (0,883, mediana TomTom/OSM na via de cada sensor) leva o tempo da rota à escala da TomTom sem mudar a escolha de rota. Contra a TomTom no mesmo trajeto (14 corredores, madrugada): viés −11,9% → −0,2% e MAPE 16,1% → 10,2% (`experimento_velocidade_livre.json`).
- **Pendente para o texto final:** a avaliação fora do tempo (`avaliacao_fora_do_tempo.json`), em leituras de novembro que nenhum modelo viu, é o número que deve fechar a comparação 2.2 × 2.3 × persistência.

**Cuidados antes da versão final:**
- Os números da LIA 2.0 vêm do benchmark (XGBoost sem recência, mesmos cortes temporais), porque o `lia_2.0_metadata.json` não persistiu o CV.
- O CV da LIA 2.1 foi calculado antes da adoção dos hiperparâmetros otimizados pelo Optuna.
- Recomenda-se re-rodar `train.py` para as duas versões e regerar as figuras.

## 3. Benchmark LSTM × XGBoost (Figura 3)

![Figura 3](../figuras/fig3_benchmark_lstm_xgboost.png)

*Figura 3 — RMSE por fold temporal e tempo médio de treino por fold, para o XGBoost sem recência (LIA 2.0), o LSTM e o XGBoost com recência (LIA 2.1).*

| Modelo | RMSE médio (s) | MAE médio (s) | Treino por fold (s) |
|---|---|---|---|
| XGBoost sem recência | 51,4 | 18,6 | 4,0 |
| LSTM (janela de 6 passos, 10.833 parâmetros) | 41,5 | 17,2 | 9,4 |
| XGBoost + recência | 41,0 | 14,6 | 2,8 |

Fonte: `benchmark_lstm_vs_xgboost.json` (`rmse_seg_media`, `mae_seg_media`, `tempo_treino_s_media`, `n_parametros_lstm`).

A vantagem aparente do LSTM vinha do acesso à última observação real da via, não da captura de sazonalidade longa. Com a mesma informação (duas features de recência), o XGBoost empata no RMSE (41,0 × 41,5 s), vence no MAE (14,6 × 17,2 s) e treina em cerca de um terço do tempo. Pelo princípio da parcimônia, o XGBoost foi mantido em produção: não exige GPU nem runtime PyTorch no servidor. (Para registro honesto: o arquivo do LSTM é menor, 46 KB contra 1,35 MB do XGBoost.)

## 4. Estudo de caso — calibração da confiança do Knowledge Transfer (Figura 2)

Vias sem monitoramento herdam o padrão de congestionamento da via monitorada mais próxima, dentro de 500 m. A razão herdada é puxada para o fluxo livre conforme a confiança c(d):

r<sub>aresta</sub> = c(d) · r<sub>vizinha</sub> + (1 − c(d)) · 1

**Método** (`calibrate_transfer.py`):
- Foram comparados **10.528 pares** de vias monitoradas, medindo o erro entre seus perfis históricos em função da distância d.
- A confiança de cada par é (teto − erro) / (teto − piso), limitada a [0, 1]:
  - **piso** é a dispersão interna média de uma via (confiança 1);
  - **teto** é o erro de usar o fallback global (confiança 0).
- Uma regressão isotônica não crescente foi ajustada sobre os pares. Ela impõe só que a confiança não cresça com a distância, sem forma funcional arbitrária.

![Figura 2](../figuras/fig2_calibracao_transfer.png)

*Figura 2 — Confiança do Knowledge Transfer em função da distância: escala antiga (fixa), confiança do erro médio de cada faixa e curva calibrada por regressão isotônica.*

| Distância | Escala antiga | Escala calibrada | Diferença |
|---|---|---|---|
| 100 m | 1,0 | 0,708 | −29% |
| 200 m | 0,8 | 0,687 | −14% |
| 400 m | 0,8 | 0,646 | −19% |
| 500 m | 0,6 | 0,581 | −3% |

Fonte: `calibracao_transfer.json` › `curva_isotonica_grade_10m`, `constante_antiga`.

**Leitura.** A escala antiga era otimista em toda a faixa usada pela API: transferia mais padrão de congestionamento do que os dados sustentam.

**Ponto metodológico a registrar.** A curva foi ajustada sobre a confiança de cada par **já recortada em [0, 1]**, e a média de valores recortados fica acima do recorte da média. Por isso:
- Além de ~600 m, a curva fica em ~0,36, enquanto a confiança do erro médio das faixas é 0.
- Dentro do raio de 500 m o efeito é menor, mas existe: a média simples das faixas entre 100 e 500 m é ≈ 0,53, contra 0,58–0,71 da curva.

Vale citar como limitação da calibração, com ajuste futuro sobre os erros não recortados (ou sobre as faixas ponderadas pelo número de pares).

## 5. Validação externa (Fase 3)

A Fase 3 compara, para o mesmo par origem-destino e no mesmo instante:
- a rota da LIA;
- a rota de menor distância;
- a rota da TomTom Routing API com trânsito ao vivo.

**Tempo total de viagem.** A diferença entre o sistema e a TomTom é sistemática e proporcional à distância, mesmo sem congestionamento. Isso é atribuído à espera em cruzamentos semaforizados, que não é modelada.

**Redesenho da comparação.** Por isso, a comparação passou a isolar o **atraso por congestionamento**: o tempo previsto no pico menos o tempo previsto em horário de referência sem tráfego. A primeira rodada em pico real mostrou concordância direcional, com os corredores mais congestionados apresentando mais atraso nas duas fontes. A magnitude, porém, é subestimada pelo sistema nos casos mais congestionados.

**Continuidade após a parada do coletor.** O experimento rodava dentro do processo do coletor, que está sendo pausado. A API agora aceita `referencia_tomtom: true` no `POST /route` e devolve o ETA e o atraso da TomTom junto com a previsão da LIA. Assim, a comparação pode continuar acumulando amostras a partir do uso real.

## 6. Limitações conhecidas

1. **Semáforos e velocidade livre** *(números de 2026-09-23 em `ml/artifacts/semaforos_calibracao_2026-09-23.json`; atualização de 2026-11-02 em `ml/artifacts/semaforos_calibracao.json` e `ml/artifacts/ab_calibracao_grafo_2026-11-02.json`; a validar pelo grupo)*.
   - A soma de arestas não modela a espera em cruzamento semaforizado, o que gera viés proporcional à distância no tempo total (Fase 3). Por isso a validação externa usa o atraso por congestionamento, não o tempo absoluto.
   - **Tratamento implementado:**
     - semáforos do OSM (`highway=traffic_signals`, 423 no DF) encaixados no cruzamento do grafo (271 cruzamentos; a simplificação do OSMnx guardava só 114);
     - atraso médio por semáforo calibrado contra a TomTom no **mesmo trajeto** (reconstrução por `supportingPoints`), em 60 pares O-D sorteados com semente fixa;
     - OLS sem intercepto: `TomTom sem trânsito − LIA ≈ δ·semáforos + β·km`.
   - **Resultado:** δ = 22,9 s (erro-padrão 15,7 s), compatível com a faixa do HCM para LOS C (20–35 s), mas estatisticamente fraco. β = 22,9 s/km, com R² ≈ 0.
     - Leitura: a maior parte da diferença não vem dos semáforos. É um viés por quilômetro da **velocidade livre**.
     - Causa: na inferência, a API usa o limite de via do OSM (`speed_kph`) como velocidade livre, enquanto a LIA foi treinada com a velocidade livre da TomTom. O tempo da rota sai otimista.
     - Teste A/B com a velocidade livre da TomTom só nos trechos monitorados (`VEL_LIVRE_TOMTOM=1`), nos mesmos 60 pares: a LIA ficou 29,2% abaixo da TomTom, contra 29,7% na versão atual.
       - O ganho é desprezível porque esses trechos são poucos: o viés está nas arestas por transferência e heurística.
       - Próximo passo: calibrar a velocidade livre por classe de via.
   - **Atualização 2026-11-02 — velocidade livre por grupo de via:**
     - Método: `TomTom sem trânsito ≈ Σ g·(tempo livre do grupo) + δ·semáforos + atrasos de cruzamento`, mínimos quadrados não negativos no nível da rota, 135 rotas sorteadas (semente 42; 15 descartadas porque a TomTom desviou mais de 10% ao reconstruir o trajeto). Fator novo do grupo = fator atual / g.
     - Resultado (`fatores_velocidade_grupo`, `ajuste_por_grupo`): expressa 0,909, arterial 0,897, coletora 0,508, local 0,425 (sobre o limite de via do OSM); δ = 8,1 s por semáforo; MAPE do tempo livre na amostra de 20,5% para 10,4%.
     - Leitura: o viés estava nas ruas locais e coletoras, que levam ≈ 2× o tempo do limite de via (quebra-molas, rotatórias e cruzamentos embutidos). Expressas e arteriais quase não mudam. O atraso por cruzamento sem semáforo, colinear com o tempo das ruas locais, saiu ≈ 0.
     - Validação fora da amostra (`ab_calibracao_grafo_2026-11-02.json`, A/B/C no mesmo instante; feriado, ~12h): nos 16 corredores, LIA × TomTom ao vivo no mesmo trajeto foi de −9,1% de viés mediano e 12,7% de MAPE (produção) para −4,0% / 9,6% (grupos) e −2,3% / 8,7% (grupos + prior de congestionamento: aresta sem sensor parte da lentidão prevista agora nos trechos monitorados, não da mediana histórica do horário, que é 1,0 em 3 de cada 4 combinações hora × dia); em 40 rotas sorteadas com outra semente, de −14,7% / 18,7% para −6,4% / 10,7% e −3,3% / 9,5%. Amostra pequena (14–15 pares no mesmo trajeto) e um só horário.
   - **Restrições de conversão:** o OSMnx ignora as relações `restriction` do OSM e o snap pega a pista mais próxima de uma via dupla. Em Plano → Taguatinga a rota da LIA termina com um retorno pela Avenida Comercial que a TomTom não aceita; ao reconstruir o trajeto ela dá uma volta de 4,8 km (×1,23 na distância, em todas as rodadas). É o único corredor com desvio sistemático. Correção possível: grafo por aresta (restrições) ou snap com vários candidatos.
   - **Limitação da coleta:** a calibração foi feita de madrugada; repetir em horário comercial e estratificar por região.
2. **Subestimação em congestionamento extremo** (Figura 4).
   - No subconjunto congestionado (razão < 0,95; 17,1% das amostras), o RMSE da LIA 2.1 sobe de 40,7 s para 87,5 s (2,1×).
   - A vantagem sobre o baseline se mantém (123,7 s; −29,3%).
   - Causas prováveis:
     - desbalanceamento, já que 83% das amostras estão em fluxo livre;
     - perda quadrática, que puxa previsões para a média;
     - piso da razão em 0,05;
     - ausência de recência fresca em produção desde a parada da coleta, hoje mitigada pela consulta à TomTom sob demanda.
3. **Coleta não contínua e cobertura temporal enviesada** *(números em `ml/artifacts/cobertura_dataset.json`, gerado por `ml/dataset_coverage.py`)*.
   - A coleta foi de 07/03/2026 a 19/07/2026 (`periodo_inicio`, `periodo_fim`; 134 dias com coleta, 630 pontos, 1.513.824 linhas) e o projeto Supabase gratuito foi pausado por inatividade depois disso.
   - A cadência nominal era de 8 min, mas a cota do pool de chaves só sustentou o dia inteiro em **13 dias** (`n_dias_cheios`), que concentram **68,5%** das linhas (`pct_linhas_em_dias_cheios`). Nos demais, a mediana é de 4 ciclos por dia (`ciclos_por_dia_mediana`), sempre logo após 00:00 UTC: a hora 21h de Brasília tem 23,3% das linhas (`pct_hora_mais_coberta`) e o fim de semana tem 21% do volume de um dia útil (`razao_fim_de_semana_vs_dia_util`).
   - Consequência: os perfis por (ponto, hora, dia da semana) e o treino se apoiam em poucas datas por célula de pico, não capturam sazonalidade anual e ajudam a explicar a subestimativa diurna da Fase 3. A coleta foi retomada em 11/2026 com cadência dimensionada pela cota (1 ciclo a cada ~43 min, uniforme no dia), o que permite um retreino comparável (mesmos folds) ao fim do semestre.
4. **Proveniência das métricas.** A LIA 2.0 é reportada pelo benchmark. A 2.1 oficial é o modelo de 19/08 (hiperparâmetros manuais; o Optuna foi testado e não adotado) e a reprodução no ambiente atual fica a 0,2 s dela (seção 2).
5. **Contexto em produção (LIA 2.2).**
   - A chuva do treino vem da reanálise histórica do Open-Meteo e a da API vem da previsão para as horas passadas: fontes parecidas, não idênticas.
   - Sem coleta contínua, a feature de vizinhos só está fresca no corredor consultado sob demanda. No resto do grafo ela vai ausente, cenário em que a 2.2 empata ou perde por pouco (seção 2).
6. **Knowledge Transfer.**
   - Limitado a 500 m.
   - A curva calibrada tem o viés de recorte descrito na seção 4.
   - Vias além do raio usam só a mediana global do horário.
7. **Dependência de API comercial.**
   - A cota gratuita da TomTom é mensal e por API (Flow 20 mil, Incidents 2,5 mil, Search 2,5 mil, Routing 20 mil).
   - O sistema usa um pool de chaves com rotação automática. Os termos da TomTom (§14.2) permitem suspender contas criadas para obter requisições gratuitas adicionais, então o pool é um risco declarado, adequado apenas a um protótipo acadêmico.
8. **Cobertura.** O grafo é uma caixa de 76 × 76 km (OSMnx `dist_type=bbox`, ±38 km do centro): 79% da área do DF e 92,2% dos km dirigíveis do OSM no DF (`ml/artifacts/auditoria_grafo_df.json`). Ficam de fora 1.024 km, quase todos no leste de Planaltina e no sudeste do Paranoá. Os 630 pontos monitorados concentram-se em vias arteriais (motorway, trunk e primary) e no Plano Piloto (263): 83,2% dos km de via não têm sensor a menos de 500 m e 20 das 35 regiões administrativas não têm nenhum. Nesses buracos o tempo exibido usa a TomTom (fusão) e a cor do trânsito vem das seções de trânsito dela.
9. **Sem modo offline** (cache local de rota) neste ciclo.

![Figura 4](../figuras/fig4_erro_congestionamento.png)

*Figura 4 — RMSE da LIA 2.1 e do baseline histórico em todas as observações e apenas nos trechos congestionados.*

## 7. Trabalhos futuros

- **Semáforos:** implementado em 2026-09-23 (ver limitação 1). Falta repetir a calibração de dia, por região, e com a velocidade livre corrigida.
- **Velocidade livre na inferência:** usar a velocidade livre da TomTom (a do treino) também nas arestas por transferência, e calibrar a do OSM por classe de via.
- **Fusão LIA × TomTom:** implementada. A TomTom reconstrói a rota da LIA e mede o ETA ao vivo do mesmo trajeto, e o tempo exibido mistura as duas fontes pela cobertura da LIA. Avaliar o erro dessa estimativa contra o tempo real informado pelos usuários.
- **Features de contexto:** vizinhos, chuva e feriado implementados na LIA 2.2 (seção 2). Falta incidente ativo por perto, que não tem histórico no período do dataset.
- **Cauda de congestionamento:** ponderação das amostras congestionadas, perda quantílica (P90) ou modelo específico para razão < 0,5.
- **Coleta orientada por demanda:** persistir as leituras ao vivo da TomTom feitas durante o uso (com a fonte identificada) para re-treino, sem varredura contínua.
- **Incidentes como sinal calibrado:** hoje só a interdição bloqueia arestas; acidentes e obras poderiam virar penalidade aprendida.
- **Calibração do transfer** sem o viés de recorte (seção 4).
- **Operação:** hospedagem 24/7 da API, keep-alive do banco, modo offline e busca dedicada (por exemplo, ElasticSearch) se a escala exigir.
