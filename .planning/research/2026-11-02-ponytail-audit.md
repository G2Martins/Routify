# Auditoria ponytail (excesso de engenharia) — 2026-11-02

**Última revisão:** 2026-11-02

Pedido do dono: "rode um ponytail revisando todos os códigos". Agente só de leitura sobre `apps/api`, `apps/mobile/src`,
`apps/admin/src`, `services/collector`, `ml` e `scripts` (HEAD `ccb6919`). Verificação: grep de chamadores, lockfile do
app, `tsc --noEmit --noUnusedLocals`. Escopo: só o que dá para cortar; bugs e segurança ficam fora (2 bugs achados, abaixo).

## Aplicado (sem mudança de comportamento)

- `apps/api/main.py`: `numpy`, `pandas` e `GRAPH_CACHE_MIN_AGE_DAYS` sem uso.
- `apps/mobile/src/components/Icon.tsx`: `MaterialIcons` e `FontAwesome5` importados sem uso.
- **Bug:** `.dockerignore` só liberava a LIA 2.2/2.1, mas o padrão é a 2.3. A imagem Docker não subia
  (`FileNotFoundError` em `load_model_artifacts`) e também ficava sem `pois_df.json` e `consumo_combustivel.json`.
  A lista de permissão agora é a mesma dos arquivos que a API lê.

## Mantido de propósito

| Achado | Por quê |
|---|---|
| `CodigoOtp` (6 tiles e animações) para 1 `TextInput` | Pedido explícito do dono (animações de MFA/OTP no estilo Valerium) |
| Cometa na rota e contador animado do ETA | Pedido explícito ("visão bem premium" do mapa) |
| Fase 3 (`external_validation.py`, hook do coletor) | Reproduz o `fase3_comparacao.csv` citado na tese |
| Optuna (`tune_hyperparams.py`) | A tese diz "testado e não adotado"; o script reproduz a afirmação |
| Trava de 5 erros e 30 s na tela MFA | É UX, não segurança: o limite real está no Supabase Auth |

## Para o dono decidir (ganho estimado em linhas e dependências)

| # | Corte | Ganho | Risco |
|---|---|---|---|
| 1 | Fallback Leaflet do mapa web (sem WebGL): fica só o MapLibre. Hoje ele já está defasado e não recebe `trafego` | −336 linhas, −2 deps | Aparelho sem WebGL fica sem mapa |
| 2 | 3 deps do app sem nenhum import (`package.json:18,33,35`; `@react-navigation/elements` já vem com as abas) | −3 deps | Nenhum no bundle; mexe no lockfile |
| 3 | Rodízio de chaves TomTom escrito 2× (API e coletor) → 1 `KeyPool` compartilhado (o CLAUDE.md §6 já pede) | −90 | Refatoração em 2 serviços no ar |
| 4 | `ml/auditoria_grafo_df.py` (1.149 linhas, rodou 1×, JSON versionado): tirar o escritor de JSON feito à mão, as fontes de reserva e as constantes copiadas da API | −100 (ou arquivar) | Nenhum em produção |
| 5 | `Icon.tsx`: um caminho só com `@expo/vector-icons` (a web hoje busca SVG na rede via `@iconify/react`) | −85, −1 dep | Conferir o visual |
| 6 | Busca: fallback ILIKE + pausa de 10 min do `imatch` (a única "recusa" era queda de conexão, corrigida em `6596039`) | −70 com testes | Perde o plano B se o PostgREST mudar |
| 7 | `Dockerfile` e `.dockerignore`, fora do deploy real (systemd + Caddy) | −52 + seção do README | Perde o caminho Docker documentado |
| 8 | `calibrate_signals.py`: o OLS de 3 deltas, que o NNLS por grupo sobrescreve (R² 0,007 no artefato) | −30 | Nenhum em produção |
| 9 | `main.py`: `_cv_metric` com o formato da LIA 1.0 (que nem carrega) e a flag de experimento `VEL_LIVRE_TOMTOM` | −20 | Baixo |
| 10 | Duplicatas: `semaforos_calibracao.json` aberto 4×, haversine e raio da Terra em 5 módulos, `_resumo_rota` 2×, `_Orcamento` ≈ `seguranca.Limitador` | −75 | Baixo, muitos arquivos |
| 11 | `mlflow` no treino (grava sem leitor; as métricas já vão para `*_metadata.json` e `lia_treinos`) | −25, −1 dep | Nenhum |
| 12 | Provedor OpenRouteService no comparador (nunca ligado, sem chave) | −20 | Nenhum |
| 13 | `geolocalizacao.ts`: diagnóstico de falha, 3 provedores de IP (1 basta), `contextoSeguro` (`window.isSecureContext` já cobre) | −20 | Baixo |
| 14 | `/predict`: campos de override só exercitados em teste | −18 | Baixo |
| 15 | Knobs de env que ninguém define (`TOMTOM_MAX_CHAMADAS_MIN`, `TOMTOM_ATIVO` + `criar_cliente()`, `REGISTRAR_USO`) | −8 | Baixo |
| 16 | `referencia_tomtom` ("legado") no corpo de `/route`: só o comparador envia | −7 | Ajustar o comparador junto |
| 17 | Formatadores pt-BR à mão no app (já existe `fmt` com `Intl.NumberFormat`) | −6 | Baixo |
| 18 | `@xyflow/react` para 12 nós fixos na página de arquitetura | −1 dep | Visual da página |
| 19 | `scripts/rotina_validacao.py`: rotina de uma noite, amarrada a 2026-11-02 | −193 | Remover depois das 23h |

Total possível: cerca de −2.050 linhas e −9 deps; sem os itens de design e de tese, cerca de −1.300.

## Bug fora do escopo, registrado

- `ml/external_validation.py:109` usa `tomtom_keys[7]` fixo ("key_08"): quebra se o pool mudar de ordem.
