# Restrições de conversão do OSM no grafo da API: medição e recomendação

**Última revisão:** 2026-11-02
**Script:** [ml/restricoes_conversao.py](../../ml/restricoes_conversao.py) · **Artefato:** [ml/artifacts/restricoes_conversao_38km.json](../../ml/artifacts/restricoes_conversao_38km.json) · **Estado:** [STATE.md](../STATE.md)

Pergunta do dono: as restrições de conversão do OSM (`type=restriction`, que o OSMnx ignora) explicam desvios como o de
Plano Piloto → Taguatinga (a TomTom reconstrói a rota da LIA com 28,2 km contra 23,4 km, ×1,20), e vale implementá-las?
Só pesquisa e dados: nada em `apps/api` foi alterado, nada foi commitado nem publicado.

## 1. Resposta curta

- **Explicam, e implementar vale.** 22,5% dos caminhos de menor tempo (18 de 80; IC 95% 14,7–32,8%) fazem pelo menos uma
  manobra que o OSM proíbe; nos 30 pares do comparador são 33,3%. Honrar as restrições custa pouco: mediana +0,18 km e
  +0,8% do tempo (máximo +4,4%), e todos os 18 caminhos acharam alternativa legal.
- **Plano → Taguatinga:** o caminho cruza uma restrição `no_left_turn` (relação 19263943) a 0,48 km do destino: o retorno
  da Avenida Central (EPTG, DF-085) para a Avenida Comercial, em (-15,833561; -48,057138). É o "retorno pela Avenida
  Comercial" das notas anteriores. Honrar custa +0,41 km no grafo; a TomTom cobra +4,8 km, leitura mais provável: ao
  reconstruir a polilinha ilegal pelos `supportingPoints` (mecanismo inferido, não observado). A rota própria da TomTom
  tem 24,18 km (+0,7 km sobre a da LIA): existe caminho legal quase do mesmo tamanho.
- **A produção confirma.** Dos 30 corredores do comparador (37 rodadas de 2026-11-02), os 3 com reconstrução da TomTom
  mais de 5% maior que a rota da LIA (×1,322, ×1,204, ×1,059) estão entre os 10 em que o caminho de teste cruza
  restrição (p = 0,03 se a marca fosse sorteio). Nos 20 corredores sem marca o maior desvio é ×1,025.
- **Não precisa de "grafo por aresta".** Basta guardar o nó anterior em 808 nós (0,83% do grafo): 1.799 estados, +3,2% de
  tempo no mesmo A*. A nota de 2026-11-02 que dizia que as restrições "exigem grafo por aresta" pode ser corrigida.
- **Complemento barato:** em 9 das 21 violações o retorno fica a até 1,5 km da origem ou do destino (via dupla). Escolher
  o nó entre os 4 mais próximos resolve 4 dos 18 caminhos sem restrição alguma, inclusive os 3 corredores com desvio
  > 5%. Os outros 14 só saem com a restrição.

## 2. O que foi feito

1. **Download** (Overpass, caixa exata do `graph_from_point(38 km)` + 0,002°): todas as relações `type~"^restriction"`,
   com as vias e os nós dos membros. 1.204 relações, 1.884 vias, 11.808 nós; base OSM de 2026-11-03T00:19Z. Bruto fora do
   repositório, lido como JSON não confiável. Todas as 1.204 têm `type=restriction` puro.
2. **Mapeamento** no GraphML de 38 km, filtrado como a API (`filter_drivable`, sem `access=no`): 97.711 nós, 233.237
   arestas, maior componente fortemente conexo 97.477 nós.
   - O `osmid` da aresta simplificada é `list(set(...))` (osmnx 1.9.3, `simplification.py:368`): **sem ordem**. "A
     aresta contém a via `from`" aceitaria arestas cuja cadeia só passa pela via. O `osmid` escolhe candidatas e a
     geometria decide (o vértice colado no nó `via` tem de ser vizinho dele na via do OSM). O `osmid` sozinho aceitaria 10
     arestas a mais; a geometria é barata e exata.
   - Restrições com `via` nó, para carro (`restriction`, `restriction:motorcar|motor_vehicle|vehicle`; `except` com carro
     fica de fora), sem condição de horário. `no_*` proíbe (u, via, w); `only_*` proíbe toda outra saída do `via` a
     partir daquela entrada.
   - Conferência geométrica do mapeamento (o giro da manobra bate com o nome?): `no_left_turn` 100%, `no_right_turn`
     100%, `no_straight_on` 100%, `only_left_turn` 100%, `only_straight_on` 99,4%, `no_u_turn` 90,6%, `only_right_turn`
     89,4% (o resto cai no limiar de 15°/135°; não olhei um a um).
   - Nenhuma tripla (u, via, w) é ambígua por aresta paralela, então o nó basta.
3. **Medição** em 80 pares: os 30 do comparador (`CORREDORES` + `CORREDORES_POI`) e 50 aleatórios no maior componente
   (semente 42, mínimo 3 km). Caminho = A* por tempo, com dois pesos: `tt_osm` (comprimento ÷ limite do OSM, o
   `travel_time` do OSMnx; calculado à mão porque o `ox.add_edge_speeds` quebra com o pandas 3) e `tt_cal` (os fatores de
   velocidade livre por grupo de via e o atraso de semáforo calibrados da API). A contagem é a mesma nos dois pesos (18 de
   80), com composição ligeiramente diferente. Em 24 dos 30 corredores o caminho de teste tem o comprimento do da produção (±1,5%); em
   `poi-eixaonorte-eixaosul` é o mesmo número (8,57 km).
4. **Validação contra a produção:** consulta SELECT somente leitura em `comparacao_provedores` (projeto conferido pela
   URL), com a razão (distância da reconstrução da TomTom ÷ distância da LIA) e o viés de tempo por corredor. O resumo
   fica no JSON (`validacao_producao`).

## 3. Quantas restrições o grafo honra

| Desfecho das 1.204 relações | Relações | % |
|---|---:|---:|
| Mapeadas (≥ 1 transição proibida) | 1.018 | 84,6 |
| Inócuas no grafo (mão única/filtrada, ou `only_*` redundante: a saída permitida é a única) | 87 | 7,2 |
| Via em via fora do grafo (não dirigível ou filtrada) | 27 | 2,2 |
| `via` caminho (várias vias encadeadas): fora do escopo | 17 | 1,4 |
| Condicionais no tempo: fora do escopo | 17 | 1,4 |
| `via` interno a aresta simplificada | 16 | 1,3 |
| `only_*` sem saída permitida no grafo | 13 | 1,1 |
| Malformadas | 7 | 0,6 |
| `via` fora da caixa | 2 | 0,2 |

As 1.018 mapeadas viram **1.260 transições proibidas em 808 nós**: `only_straight_on` 520, `no_left_turn` 260,
`only_right_turn` 142, `no_u_turn` 53, `no_right_turn` 28, `only_left_turn` 8, `no_straight_on` 7. As 17 condicionais são
na maioria faixas de pico (ex.: `no_right_turn @ (Mo-Fr 16:45-20:15)`), listadas no JSON com a regra e a posição; ligar
por horário de partida fica para depois.

## 4. Quanto as rotas violam

| Conjunto | Caminhos | Com manobra proibida | % (IC 95%) | Violações por 100 km |
|---|---:|---:|---|---:|
| Comparador | 30 | 10 | 33,3 (19,2–51,2) | 2,56 |
| Aleatórios | 50 | 8 | 16,0 (8,3–28,5) | 0,43 |
| **Todos** | **80** | **18** | **22,5 (14,7–32,8)** | **0,88** |

- 21 violações em 16 restrições distintas (pesos juntos: 42 ocorrências em 19). Tipos: `no_left_turn` 13, `only_straight_on`
  6, `only_right_turn` 2. Giro: 15 à esquerda e 6 retornos (≥ 135°). Os 4 pontos mais frequentes somam 17 das 42
  ocorrências.
- O comparador concentra o Plano Piloto (ramais do Eixão, CLN/CLS), por isso 33% contra 16% nos pares aleatórios.
- Pontos que mais aparecem (relação OSM): 4161143 `no_left_turn` S3 Oeste → SCS Quadra 1/2 (Rodoviária, 6 ocorrências);
  3539331 `no_left_turn` Via LJ2 → Av. Hélio Prates (Ceilândia, 4); 3539422 `no_left_turn` → SIA Trecho 2 (4);
  19263943 `no_left_turn` Av. Central → Av. Comercial (Taguatinga, 3); 3536828 `only_straight_on` CLN 105/106 → ramal do
  Eixão (3). Lista completa em `pontos_quentes`.
- **Honrar** (A* com estado `(nó, anterior)` nos nós com restrição), nos 18 caminhos: +0,18 km de mediana (média 0,21;
  máximo 0,73 km) e +0,8% do tempo (média 1,2%; máximo 4,4% em `poi-metroceilandia-hrt`). Nenhum ficou sem caminho.

## 5. Plano Piloto → Taguatinga

Caminho de teste (`tt_osm`): 22,58 km, 20,2 min (a produção mede 23,48 km de mediana; o peso `tt_cal` dá 24,45 km).

- **Onde cruza a restrição:** nó 2441788813, (-15,833561; -48,057138), a 22,1 km da origem e 0,48 km do destino (447 m em
  linha reta). Vem pela via 269913938 (Avenida Central, `secondary`, DF-085, `short_name=EPTG`, mão única) e entra no elo
  1278309657 (`secondary`, mão única, 39 m) com giro de -92°: `no_left_turn`, relação 19263943. É o retorno que leva da
  pista oeste para a leste. O destino cai na pista leste (nó a 37 m); o A* passa 447 m do destino e volta.
- Com `tt_cal` o caminho tem uma 2ª violação, perto da origem (relação 4161143, S3 Oeste → SCS Quadra 1/2).
- **Honrando:** +0,41 km (+1,8%), +2,7% do tempo. O desvio é um laço de 406 m (Avenida Central → C9 e C10 → Rua do Corpo
  de Bombeiros → Avenida Comercial Norte) que volta ao mesmo nó pela outra entrada e faz a manobra sem violar nada.
- **Só trocando o nó de origem/destino** entre os 4 mais próximos (caminhada somada de 146 m para 197 m): caminho legal e
  4,1% mais barato (`snap_alternativo`), do tamanho do vai-e-volta de 2 × 447 m (4,0% dos 22,58 km).
- **Produção (mediana de 36 rodadas):** LIA 23,48 km; reconstrução da TomTom 28,28 km (×1,204); rota própria da TomTom
  24,18 km; rota exibida 24,22 km, com 99,3% de traçado em comum com a TomTom (contra 66,6% da rota da LIA). A LIA fica
  25,6% abaixo do ETA da TomTom no mesmo trajeto. Leitura mais provável: a reconstrução paga +4,8 km para encaixar uma
  polilinha ilegal, enquanto o custo real de ser legal é de +0,4 a +0,7 km.

## 6. A produção confirma o mecanismo?

Corredores em que o caminho de teste cruza restrição (`tt_osm`), com a razão medida em produção:

| Corredor | Razão (TomTom reconstrói ÷ LIA) | Viés de tempo da LIA | Violações | Km produção / teste |
|---|---:|---:|---:|---|
| poi-eixaonorte-eixaosul | **1,322** | -36,4% | 2 | 8,57 / 8,57 |
| plano-taguatinga | **1,204** | -25,6% | 1 | 23,48 / 22,58 |
| lagonorte-scs | **1,059** | -23,9% | 2 | 10,25 / 9,62 |
| ceilandia-plano | 1,035 | -3,4% | 1 | 29,85 / 28,12 |
| poi-metroceilandia-hrt | 1,035 | -21,1% | 1 | 9,41 / 8,99 |
| poi-unb-aeroporto | 1,030 | -8,0% | 1 | 19,20 / 18,88 |
| asanorte-asasul | 1,026 | -21,7% | 1 | 10,97 / 10,97 |
| sudoeste-lagosul | 1,014 | -15,9% | 1 | 13,15 / 12,31 |
| poi-jkshopping-rodoviaria | 1,011 | -0,1% | 2 | 27,64 / 27,43 |
| rodoviaria-aeroporto | 0,998 | -0,8% | 1 | 12,93 / 13,10 |

- Razão mediana: 1,032 nos marcados e 0,999 nos 20 sem marca (Mann-Whitney unilateral p = 0,0002 com `tt_osm`; 0,0007 com
  `tt_cal`). O maior desvio sem marca é ×1,025 (`tt_cal`: ×1,035).
- Os 3 corredores com razão > 1,05 estão todos entre os 10 marcados (hipergeométrica p = 0,030).
- Viés de tempo da LIA contra a TomTom no mesmo trajeto: mediana -18,5% nos marcados e -3,0% nos demais (p = 0,009;
  `tt_cal`: -19,7% e -2,8%, p = 0,002). Não é causal por si só (`parque-torre`, sem marca, tem -23,7%), mas as
  reconstruções ilegais inflam o ETA da TomTom nesses corredores.
- Só nos 24 corredores com o mesmo comprimento da produção: 6 marcados e 2 não marcados com razão ≥ 1,01; 1 marcado
  (`rodoviaria-aeroporto`) e 15 não marcados com razão < 1,01 (Fisher unilateral p = 0,0013).
- A imitação da reconstrução (A* trecho a trecho pelos `supportingPoints`, cada ponto no nó do próprio caminho) **ordena**
  os corredores como a produção (Spearman ρ = 0,64, p = 0,0001; `tt_cal` ρ = 0,62), mas é só um piso: dá +0,4% a +4% onde
  a produção mede +20% a +32%, porque o OSM oferece alternativas legais curtas. Não prevê o tamanho do desvio da TomTom.
- É associação forte em 30 corredores, não prova causal. A prova é o antes e depois da implementação (seção 9, item 3).

## 7. Custo de honrar as restrições

| Opção | Tamanho | Observação |
|---|---|---|
| Nós com restrição | 808 (0,83% dos 97.711) | 1.260 triplas (u, via, w) |
| A* com estado `(nó, anterior)` só nesses nós | 1.799 estados (1,84% dos nós) | nada muda fora deles |
| Divisão de nós (1 cópia por entrada restrita) | 1.007 nós (1,03%) e 1.081 arestas (0,46%) | `nx.astar_path` intacto, mas origem/destino e todo mapeamento nó → polyline precisam voltar ao nó original |
| Grafo por aresta inteiro | 233.237 estados | desnecessário |

Tempo (80 pares, esta máquina): `nx.astar_path` 10,35 s (129 ms por rota); A* próprio sem restrição 15,20 s; com
restrição 15,68 s (+3,2%). O A* próprio em Python puro é ~47% mais lento que o do networkx. As rotas sem violação saem
idênticas e a rota com restrição nunca custa menos que a livre (conferido nos 80 pares).

## 8. O que mais explica o desvio

1. **A reconstrução amplifica (inferência).** A polilinha ilegal força a TomTom a procurar um retorno legal longe; a rota livre dela,
   sem polilinha, só custa +0,7 km. Com a LIA já legal, a polilinha passa a ser seguível.
2. **Snap em via dupla.** O nó mais próximo costuma ser o da pista errada e chega-se a ele com um retorno: 9 das 21
   violações ficam a ≤ 1,5 km de uma ponta. Escolher entre os 4 nós mais próximos (até 100 m além do mais perto; custo =
   tempo + metros a pé ÷ 1,4 m/s) tira a manobra proibida de 4 dos 18 caminhos, mediana -4,0% de custo: `poi-eixaonorte-eixaosul`
   (-6,1%), `plano-taguatinga` (-4,1%), `rodoviaria-aeroporto` (-4,0%) e `lagonorte-scs` (+7,8%). Os outros 14 só saem
   com a restrição. É o item "snap com vários candidatos em via dupla" do backlog.
3. **Resíduo de ×1,02 a ×1,035 sem explicação:** `poi-venancio-parqueaguasclaras` (1,025) e
   `poi-aguasclarasshopping-aeroporto` (1,023) não têm violação e o caminho de teste tem o comprimento da produção.
   Candidatos não medidos: restrições `via` caminho e condicionais, restrição que a TomTom tem e o OSM não, colagem do
   `supportingPoint` na pista vizinha.
4. Fora do escopo desta medição e sem relação com o OSM: o viés de tempo da LIA em corredores sem marca (`parque-torre`
   -23,7%, `poi-taguatingashopping-aguasclarasshopping` -19,9%).

## 9. Recomendação

**Implementar**, em duas camadas. A primeira corrige a legalidade em geral, a segunda tira o retorno na origem do problema.

1. **Restrições no A\*** (meio dia a 1 dia):
   - `apps/api/restricoes.py` com `carregar(json)` (triplas e nós-via do artefato) e o A* com estado `(nó, anterior)` desta
     medição, aceitando o `weight` por nome ou por função (a API já usa `peso_sem_interditadas`).
   - `routers/route.py`: manter `nx.astar_path`, checar o caminho contra as triplas (O(tamanho do caminho)) e só refazer com
     o A* restrito nos ~22% que violam. Aplicar também à baseline de menor distância, para as duas serem legais.
   - O pickle enxuto da API **não tem `osmid`** (`enxugar_grafo`), então o mapeamento fica offline: rodar o script e
     versionar o JSON, como os semáforos. Refazer sempre que o GraphML for refeito e a cada poucos meses para o OSM.
   - Sem o artefato, a API segue como hoje. Se o A* restrito não achar caminho, usar o livre e registrar um aviso (nenhum
     dos 80 pares caiu nisso).
   - Testes: grafo de brinquedo (como o `autoteste`), um caso "u→via→w proibido, desvio legal mais longo" e um teste de
     que a rota Plano → Taguatinga não contém a tripla 2441788813.
2. **Snap com vários candidatos** (item do backlog): origem e destino entre os 4 nós mais próximos, escolhendo o de menor
   tempo + caminhada, já com as restrições. Barato de testar com o comparador.
3. **Como medir o ganho** depois de subir: razão do comparador nos 3 corredores > 1,05 (alvo ≤ 1,03), traçado em comum
   com a rota própria da TomTom em `plano-taguatinga` (66,6% hoje), viés de tempo nos corredores marcados. Os números da
   tese em "LIA × TomTom no mesmo trajeto" mudam nesses corredores: documentar como correção de legalidade.
4. **Não fazer agora:** restrições condicionais por horário (17) e `via` caminho (17), 2,8% das relações. Dá para ligar as
   condicionais pelo horário de partida se o pico de dezembro mostrar desvio.

## 10. Limites do estudo

- Os caminhos são proxies da LIA (peso de velocidade livre, sem a razão de trânsito). Para os 24 corredores com mesmo
  comprimento da produção a aproximação é boa; para os pares aleatórios, só indica a ordem de grandeza.
- Não chamei a TomTom (sem gasto de cota): a ligação com a TomTom vem da tabela do comparador, de um único dia (2026-11-02,
  feriado de Finados; as 37 rodadas vão de 02:24 a 18:36 no horário local).
- 80 pares e 30 corredores: os intervalos são largos (IC 95% do 22,5%: 14,7–32,8%).
- O OSM pode ter restrição errada ou faltando; a TomTom não usa o OSM. A coerência geométrica do mapeamento (≥ 89% em
  todos os tipos) e a associação com a produção indicam que a maioria vale, mas não valida cada relação.
- A imitação da reconstrução é só um piso (seção 6).

## 11. Reproduzir

```bash
# 1) download para uma pasta vazia FORA do repo
apps/api/.venv/Scripts/python ml/restricoes_conversao.py baixar --saida <pasta_vazia>/restricoes_overpass.json
# 2) mapeamento + medição (modo isolado), ~2,5 min; --producao é opcional
apps/api/.venv/Scripts/python -I ml/restricoes_conversao.py medir --osm <pasta_vazia>/restricoes_overpass.json --producao <comparador.json>
apps/api/.venv/Scripts/python -I ml/restricoes_conversao.py autoteste
```

`<comparador.json>` = `{"corredores": {id: {"razao", "lia_km", "tt_recon_km", "tt_propria_km", "vies_tempo", "n"}}}`, medianas por
corredor de `comparacao_provedores` (provedores `lia`, `tomtom_mesmo_trajeto`, `tomtom`). Dados © contribuidores do
OpenStreetMap (ODbL).
