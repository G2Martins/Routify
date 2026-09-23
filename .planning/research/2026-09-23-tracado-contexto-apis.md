# Traçado, semáforos, contexto da LIA e APIs complementares

**Última revisão:** 2026-09-23 · consolida 4 pesquisas (com fontes) feitas nesta data.

## 1. Traçado "por cima da parede" — causas e correções

| # | Causa | Estado |
| --- | --- | --- |
| 1 | Grafo em cache era o antigo de ~15 km (34 mil nós); Ceilândia/Samambaia ficavam fora e o destino grudava na borda | **Corrigido:** `brasilia_graph_38km.graphml` (97.739 nós), raio no nome do arquivo |
| 2 | App ligava o ponto real ao cruzamento mais próximo com **reta sólida** (atravessava quadra) | **Corrigido:** conector fino tracejado ("a pé até a via"); linha sólida só na via |
| 3 | Busca da TomTom devolvia o centro do POI (dentro do prédio) | **Corrigido:** usa `entryPoints[0]` |
| 4 | Snap aceitava até 800 m | **Corrigido:** 400 m; além disso a rota é da TomTom |
| 5 | Snap no **nó** (cruzamento), não na aresta | Backlog: snap na aresta + trecho parcial (índice espacial de arestas; custa RAM) |

A geometria (`montar_polyline`) é idêntica à do Pedro — não havia terceiro bug.

## 2. Fusão LIA × TomTom (implementada)

1 chamada de Routing por rota, com `supportingPoints` = rota da LIA:
- `routes[0]` = a TomTom reconstrói **a nossa rota** e dá o ETA ao vivo dela (mesmo trajeto);
- `routes[1]` = alternativa, só se a TomTom achar melhor (`alternativeType=betterRoute`).

Tempo exibido = cobertura·LIA + (1−cobertura)·TomTom — a LIA vale onde enxerga, a TomTom cobre os buracos do histórico. A alternativa só vence com ganho ≥ 10 % **e** ≥ 60 s; a outra volta em `alternativa` e o mapa desenha tracejada. Fora da malha (snap > 400 m) a rota é só da TomTom. A instrumentação da tese (LIA × menor distância) segue intacta.

Teste real (Águas Claras → Ceilândia, 01h): LIA 710 s × TomTom 875 s no **mesmo** trajeto (sem trânsito: 901 s). A Fase 3 do Pedro mostra o mesmo de dia (Rodoviária → Aeroporto 11h: LIA 682 s × TomTom 1.136 s).

## 3. Semáforos

- A TomTom **não** expõe atraso por semáforo (Junction Analytics é produto pago de órgão público).
- Literatura (HCM/Webster): atraso de controle 10–35 s/veículo (LOS B–C); d ≈ r²/2C.
- OSM do DF: **423** semáforos (Overpass). O grafo simplificado só guardava 114 — os demais ficam na linha de retenção, antes do cruzamento. Agora: pontos do OSM encaixados no cruzamento a ≤ 40 m (`semaforos_osm_38km.json`).
- **Calibração com dado real** (`ml/calibrate_signals.py`): N rotas sorteadas (semente fixa), resíduo = TomTom sem trânsito − LIA no mesmo trajeto, OLS `δ·semáforos + β·km` (β absorve o viés de velocidade livre). Saída versionada `semaforos_calibracao.json`; a API aplica δ igual na rota da LIA e na baseline.
- Limitação: coletar também em horário diurno e estratificar por região; DF não publica tempos semafóricos (Detran-DF só por pedido).

## 4. RAG, harness, modelo semântico, MCP — o que vale para a LIA

- **Não fazer:** RAG sobre as leituras para o XGBoost; trocar por TabR/TabPFN; usar TimeGPT/Chronos/Lag-Llama em produção. Os perfis históricos + recência da LIA já são uma "recuperação analógica" tabular; os ganhos reportados nesses papers vêm, em boa parte, de XGBoost sem feature engineering.
- **Fazer (ordem):**
  1. Feature de vizinhos: razão dos k pontos monitorados mais próximos em t−1 (BallTree já existe) — maior evidência (DCRNN/Graph WaveNet). *Acurácia.*
  2. Chuva (Open-Meteo Archive, sem chave, cobre mar–jul/2026) + feriados (BrasilAPI) + incidente ativo por perto. *Acurácia.*
  3. Harness de avaliação: holdout temporal fixo nunca tunado, baselines (persistência, sazonal-ingênuo, média histórica), fatias por via/hora, saída em `artifacts/*.json` com hash do parquet. *Rigor.*
  4. Contrato de features: teste que garante `ml/features.py` ≡ `apps/api/lia_inference.py` (mata train-serve skew). *Rigor.*
  5. MCP Supabase **read-only** (schema `painel`, sem coordenadas cruas) para triagem de qualidade de dados pelo time. *Produto/indireto.*

## 5. Mapas da TomTom no app

Quota de tiles é a mais folgada (200 mil/mês por chave, bucket separado do tráfego). Mesmo assim: **manter OSM/Esri** e, se quiser o estilo "night" da TomTom, usar **1 chave dedicada com restrição de domínio**, nunca o pool de 39 (a chave no navegador é pública; um raspador queimaria as cotas escassas de Search/Incidents). Não fazer proxy de tiles pela API (RAM/banda do host).

## 6. APIs para compor os dados (prioridade)

| Fonte | Ganho | Custo |
| --- | --- | --- |
| Open-Meteo Archive (chuva horária) | feature de treino + inferência | grátis, sem chave |
| BrasilAPI feriados | feature de calendário | grátis |
| OSM traffic_signals | atraso de semáforo (feito) | grátis |
| SEMOB-DF GTFS | densidade de paradas por corredor | grátis |
| Mapbox (100 mil/mês) / Google Routes (10 mil/mês) / HERE (5 mil/mês) | segunda opinião de ETA na validação | tier grátis |
| Waze for Cities | alertas colaborativos | exige parceria com órgão público |

## 7. Pasta do Pedro × main

- Código de rota e grafo 38 km: iguais. Nada de código mais novo no lado dele.
- **Modelo:** o nosso `lia_2.1.pkl` era o retreino local com hiperparâmetros do Optuna, mas o `lia_2.1_metadata.json` tinha os números do modelo do Pedro. **Restaurado** o modelo do Pedro como `lia_2.1` (bate com o metadata; MAE 14,62 s × 15,03 s do retreino); o retreino ficou como `lia_2.1_retreino_20260923`.
- **Ambiente:** o Python global da máquina tinha pandas 2.2 / xgboost 2.1 / sklearn 1.5; o projeto fixa pandas 3.0 / xgboost 3.2 / sklearn 1.8 (o ambiente do Pedro). Criado `apps/api/.venv` com as versões fixadas — a API e o `ml/` devem rodar nele. O retreino de 22/09 foi feito no ambiente errado e não serve para a tese.
- Trazido: `fase3_comparacao.csv` (71 linhas de validação externa, agora versionado), `lia_2.0*`, `lia_1.0_supabase*`, parquets antigos (fora do git).
