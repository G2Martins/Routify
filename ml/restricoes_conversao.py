"""Restrições de conversão do OSM (`type=restriction`) no grafo da API: quantas existem, quantas o grafo consegue
honrar e quanto as rotas de menor tempo as violam.

O OSMnx ignora essas relações: o A* da API pode virar à esquerda, ou fazer um retorno, onde o OSM (e a TomTom)
proíbem. Este script mede o tamanho do problema ANTES de alguém mexer na API. Só leitura: não altera grafo,
banco nem código da API. Leitura dos números: .planning/research/2026-11-02-restricoes-conversao.md.

Uso (venv da API). O download vai para FORA do repositório e é tratado como dado não confiável: lido só como
JSON, nunca executado, e o passo 2 roda em modo isolado (`-I`).

    # 1) baixa as relações da caixa do grafo (Overpass, espelhos em sequência) com as vias e nós dos membros
    apps/api/.venv/Scripts/python ml/restricoes_conversao.py baixar --saida <pasta_vazia_fora_do_repo>/restricoes_overpass.json

    # 2) mapeia nas arestas do grafo e mede nos 30 pares do comparador + 50 aleatórios (semente fixa) -> ml/artifacts/restricoes_conversao_38km.json
    apps/api/.venv/Scripts/python -I ml/restricoes_conversao.py medir --osm <pasta_vazia_fora_do_repo>/restricoes_overpass.json [--producao comparador.json]

    # autoteste (grafo de brinquedo, sem rede)
    apps/api/.venv/Scripts/python -I ml/restricoes_conversao.py autoteste

`--producao` (opcional) é um JSON {"corredores": {id: {"razao", "lia_km", "tt_recon_km", "tt_propria_km", "vies_tempo", "n"}}}
tirado de `comparacao_provedores` (uma consulta SELECT; razao = distância da reconstrução da TomTom no trajeto da
LIA / distância da LIA, mediana das rodadas). Sem ele a validação contra a produção é pulada.

Como o mapeamento é feito (grafo simplificado do OSMnx):
  - Só restrições com `via` NÓ. As de `via` caminho (várias vias encadeadas) são contadas e ficam de fora.
  - A aresta simplificada guarda `osmid` como lista SEM ordem (osmnx 1.9: `list(set(...))`). "A aresta contém a via
    `from`" não basta: a via pode estar no meio de uma cadeia que chega ao nó `via` por outra via. Por isso o
    `osmid` só escolhe candidatas; a geometria decide: o vértice da aresta colado no nó `via` tem de ser vizinho
    do `via` na lista de nós da via do OSM. `arestas_descartadas_pela_geometria` conta as que o osmid sozinho aceitaria.
  - `no_*`: proíbe (entrada u→via na via `from`, saída via→w na via `to`). `only_*`: toda outra saída do `via`
    a partir daquela entrada fica proibida. Valem só as que se aplicam a carro e não condicionais no tempo.
  - Peso dos caminhos: `tt_osm` = comprimento / velocidade do limite do OSM (o `travel_time` do OSMnx; calculado aqui
    porque o `ox.add_edge_speeds` quebra com o pandas 3, como a API já contornou) e `tt_cal` = o mesmo com os fatores
    de velocidade livre por grupo de via e o atraso de semáforo calibrados da API (o mais perto do peso da LIA que dá
    sem o modelo e o banco).
  - Honrar as restrições = A* com estado (nó, anterior) só nos nós que têm restrição (`astar_restrito`); o custo
    (nós-via, estados extras, divisão de nós, tempo) sai em `custo_exato`.
  - Reconstrução da TomTom (imitação, `reconstruir`): A* trecho a trecho entre os `supportingPoints` da rota
    (`trajeto.pontos_apoio`, os mesmos que a API manda), cada ponto colado no nó do próprio caminho, com e sem as
    restrições. É um PISO do desvio (o grafo do OSM acha alternativas legais curtas): ordena os corredores como a
    produção, mas não reproduz o tamanho do desvio da TomTom.
  - `snap_alternativo`: sem restrição nenhuma, trocar o nó de origem/destino entre os 4 mais perto já tira a manobra?

Dados © contribuidores do OpenStreetMap, licença ODbL.
"""
import argparse
import ast
import heapq
import json
import math
import random
import statistics
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ART = RAIZ / 'ml' / 'artifacts'
GRAFO = ART / 'brasilia_graph_38km.graphml'
SAIDA = ART / 'restricoes_conversao_38km.json'
sys.path.insert(0, str(RAIZ / 'apps' / 'api'))  # graph_enrichment e trajeto: o mesmo código da API

CENTRO = (-15.793, -47.882)  # BRASILIA_CENTER de apps/api/main.py
RAIO_M = 38_000
FOLGA_GRAUS = 0.002
ESPELHOS = ('https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter')
UA = {'User-Agent': 'Routify-TCC/1.0 (restricoes de conversao; pesquisa academica)'}
TIPOS_NO = {'no_left_turn', 'no_right_turn', 'no_straight_on', 'no_u_turn', 'no_entry', 'no_exit'}
TIPOS_ONLY = {'only_left_turn', 'only_right_turn', 'only_straight_on'}
CHAVES_CARRO = ('restriction:motorcar', 'restriction:motor_vehicle', 'restriction:vehicle', 'restriction')
CHAVES_CONDICIONAIS = ('restriction:conditional', 'restriction:motorcar:conditional',
                       'restriction:motor_vehicle:conditional', 'restriction:vehicle:conditional')
EXCETO_CARRO = {'motorcar', 'motor_vehicle', 'vehicle', 'car'}
TOL_GRAUS = 2e-6      # ~0,2 m: coordenadas do OSM e do GraphML têm 7 casas
MIN_ALEATORIO_M = 3_000
R_TERRA_M = 6_371_000.0
LIMITE_RAZAO = 1.05   # reconstrução da TomTom > 5% mais longa que a rota da LIA = "desvio" na validação
RAZAO_PERCEPTIVEL = 1.01  # limite (arbitrário) para chamar a razão de "alta" na tabela 2x2 do caminho igual ao da produção


# ----------------------------------------------------------------------------- download
def baixar(saida: Path) -> None:
    """Relações `type=restriction*` da caixa do grafo + vias e nós membros (`>`), num JSON fora do repo."""
    import httpx
    import osmnx as ox
    if RAIZ in saida.resolve().parents:
        raise SystemExit('--saida tem de ficar FORA do repositório (dado bruto do OSM, não versionar)')
    norte, sul, leste, oeste = ox.utils_geo.bbox_from_point(CENTRO, dist=RAIO_M)  # a caixa do graph_from_point
    s, w, n, e = sul - FOLGA_GRAUS, oeste - FOLGA_GRAUS, norte + FOLGA_GRAUS, leste + FOLGA_GRAUS
    consulta = (f'[out:json][timeout:240];relation["type"~"^restriction"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});'
                '(._;>;);out body;')
    for url in ESPELHOS:
        t0 = time.time()
        try:
            r = httpx.post(url, data={'data': consulta}, timeout=300, headers=UA)
            if r.status_code != 200:
                print(f'{url}: HTTP {r.status_code}', file=sys.stderr)
                continue
            dados = r.json()
        except Exception as ex:
            print(f'{url}: {type(ex).__name__}', file=sys.stderr)
            continue
        dados['consulta_routify'] = consulta
        dados['espelho_routify'] = url
        saida.parent.mkdir(parents=True, exist_ok=True)
        saida.write_text(json.dumps(dados, ensure_ascii=False), encoding='utf-8')
        cont = Counter(el.get('type') for el in dados.get('elements', []))
        print(f'{url}: {dict(cont)} em {time.time() - t0:.0f}s, base OSM {dados.get("osm3s", {}).get("timestamp_osm_base")}'
              f' -> {saida} ({saida.stat().st_size / 1e6:.1f} MB)')
        return
    raise SystemExit('nenhum espelho do Overpass respondeu')


def ler_overpass(caminho: Path):
    """JSON do Overpass -> (nós {id: (lat, lon)}, vias {id: [ids dos nós]}, relações, carimbo da base, tags das vias).
    Dado não confiável: só tipos simples são aceitos, o resto é ignorado."""
    dados = json.loads(Path(caminho).read_text(encoding='utf-8'))
    nos, vias, rels, tags_vias = {}, {}, [], {}
    for el in dados.get('elements', []):
        if not isinstance(el, dict) or not isinstance(el.get('id'), int):
            continue
        tipo, i = el.get('type'), el['id']
        tags = el.get('tags') if isinstance(el.get('tags'), dict) else {}
        if tipo == 'node' and all(isinstance(el.get(k), (int, float)) for k in ('lat', 'lon')):
            nos[i] = (float(el['lat']), float(el['lon']))
        elif tipo == 'way' and isinstance(el.get('nodes'), list):
            vias[i] = [n for n in el['nodes'] if isinstance(n, int)]
            tags_vias[i] = {str(k): str(v) for k, v in tags.items()}
        elif tipo == 'relation' and isinstance(el.get('members'), list):
            membros = [(m.get('type'), m['ref'], str(m.get('role') or '').strip().lower())
                       for m in el['members'] if isinstance(m, dict) and isinstance(m.get('ref'), int)]
            rels.append({'id': i, 'tags': {str(k): str(v) for k, v in tags.items()}, 'membros': membros})
    return nos, vias, rels, (dados.get('osm3s') or {}).get('timestamp_osm_base'), tags_vias


# ----------------------------------------------------------------------------- grafo
def carregar_grafo(caminho: Path):
    """GraphML como a API o deixa na subida (sem as vias não dirigíveis nem access=no), mas COM osmid/geometria,
    mais velocidades, semáforos e os dois pesos (`tt_osm`, `tt_cal`)."""
    import logging
    import osmnx as ox
    import graph_enrichment as ge
    import trajeto
    logging.getLogger().setLevel(logging.WARNING)
    G = ox.load_graphml(str(caminho))
    fora = [(u, v, k) for u, v, k, d in G.edges(keys=True, data=True)
            if ge.valor_highway(d) in ge.NON_DRIVABLE_HIGHWAYS or ge.acesso_proibido(d)]  # = main.filter_drivable
    G.remove_edges_from(fora)
    G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n) == 0])
    ge.add_edge_speeds(G)
    pontos = trajeto.carregar_semaforos_osm(str(ART / 'semaforos_osm_38km.json'), CENTRO, RAIO_M)
    trajeto.marcar_semaforos(G, trajeto.ArvoreNos(G), pontos)
    cal = json.loads((ART / 'semaforos_calibracao.json').read_text(encoding='utf-8'))
    fatores, atraso = cal['fatores_velocidade_grupo'], float(cal['atraso_por_semaforo_seg'])
    for _, _, d in G.edges(data=True):
        v = d['speed_kph']
        d['tt_osm'] = d['length'] / (v / 3.6)
        f = min(max(float(fatores.get(trajeto.grupo_via(trajeto._classe(d)), 1.0)), 0.3), 1.0)
        d['tt_cal'] = d['length'] / (max(10.0, v * f) / 3.6) + (atraso if d.get('semaforo') else 0.0)
    return G


def _osmids(d) -> set:
    o = d.get('osmid')
    return set(o) if isinstance(o, (list, tuple, set)) else {o}


def _vertice_vizinho(G, u, v, d, na_chegada: bool):
    """(lat, lon) do vértice da aresta u→v colado no nó do `via`: v na chegada, u na saída. Sem `geometry` é o
    outro nó da aresta; com ela, o 2º ou o penúltimo vértice, conforme a ponta que está no nó (a orientação
    da geometria bate com u→v nas 87.962 arestas com geometria deste grafo, mas não depende disso)."""
    colado, longe = (v, u) if na_chegada else (u, v)
    g = d.get('geometry')
    if g is None:
        n = G.nodes[longe]
        return n['y'], n['x']
    c, n = list(g.coords), G.nodes[colado]
    if u == v:
        x, y = c[-2] if na_chegada else c[1]
    else:
        primeiro_no_colado = (c[0][0] - n['x']) ** 2 + (c[0][1] - n['y']) ** 2 <= (c[-1][0] - n['x']) ** 2 + (c[-1][1] - n['y']) ** 2
        x, y = c[1] if primeiro_no_colado else c[-2]
    return y, x


def _vizinhos_na_via(nos_da_via, via, nos):
    """Coordenadas dos nós colados no `via` ao longo da via do OSM (None se a via não traz o nó)."""
    if not nos_da_via or via not in nos_da_via:
        return None
    viz = []
    for i, n in enumerate(nos_da_via):
        if n == via:
            viz += [nos[nos_da_via[j]] for j in (i - 1, i + 1) if 0 <= j < len(nos_da_via) and nos_da_via[j] in nos]
    return viz


def _casa(coord, viz) -> bool:
    return any(abs(coord[0] - a) <= TOL_GRAUS and abs(coord[1] - b) <= TOL_GRAUS for a, b in viz)


# ----------------------------------------------------------------------------- relações -> transições
def classificar(rel: dict):
    """(código da restrição que vale para carro, None) ou (None, motivo de ficar de fora)."""
    t = rel['tags']
    sufixo = t.get('type', '').partition(':')[2]  # '' em type=restriction; 'hgv' em type=restriction:hgv
    if sufixo and sufixo not in ('motorcar', 'motor_vehicle', 'vehicle'):
        return None, 'outro_veiculo'
    if any(k in t for k in ('day_on', 'day_off', 'hour_on', 'hour_off')):
        return None, 'condicional (horario)'
    valor = next((t[k] for k in CHAVES_CARRO if k in t), None)
    if valor is None:
        if any(k in t for k in CHAVES_CONDICIONAIS) or 'conditional' in t:
            return None, 'condicional (horario)'
        return None, 'outro_veiculo' if any(k.startswith('restriction:') for k in t) else 'sem_valor'
    if EXCETO_CARRO & {x.strip() for x in t.get('except', '').split(';')}:
        return None, 'exceto_carro'
    if valor not in TIPOS_NO | TIPOS_ONLY:
        return None, 'valor_desconhecido'
    return valor, None


def mapear(G, nos: dict, vias: dict, rels: list, caixa) -> tuple:
    """Relações -> transições proibidas. Devolve (restrições mapeadas, desfecho por relação, avisos). Cada restrição:
    {'relacao', 'restricao', 'via', 'pares': [(u, w)]}; a transição proibida é (u, via, w)."""
    sul, oeste, norte, leste = caixa
    no_grafo = Counter(o for _, _, d in G.edges(data=True) for o in _osmids(d))
    desfecho, avisos, mapeadas = Counter(), Counter(), []

    def candidatas(arestas, ids_via, via, entrada):
        """Arestas do `via` que pertencem a alguma das vias `ids_via` (osmid + vizinho geométrico)."""
        achadas, motivo = [], None
        for way in ids_via:
            viz = _vizinhos_na_via(vias.get(way), via, nos)
            if viz is None:
                motivo = 'via_nao_esta_na_via' if way in vias else 'via_sem_geometria'
                continue
            avisos['via_no_meio_da_via_from_ou_to'] += len(viz) >= 2
            for a, k, d in arestas:
                if way in _osmids(d):
                    ok = (_casa(_vertice_vizinho(G, a, via, d, True), viz) if entrada
                          else _casa(_vertice_vizinho(G, via, a, d, False), viz))
                    if ok:
                        achadas.append((a, k))
                    else:
                        avisos['arestas_descartadas_pela_geometria'] += 1
        return achadas, motivo

    for rel in rels:
        valor, motivo = classificar(rel)
        if valor is None:
            desfecho[motivo] += 1
            continue
        de = [r for t, r, p in rel['membros'] if p == 'from' and t == 'way']
        para = [r for t, r, p in rel['membros'] if p == 'to' and t == 'way']
        via_nos = [r for t, r, p in rel['membros'] if p == 'via' and t == 'node']
        if any(p == 'via' and t == 'way' for t, _, p in rel['membros']):
            desfecho['via_caminho (fora do escopo)'] += 1
            continue
        if len(via_nos) != 1 or not de or not para:
            desfecho['malformada'] += 1
            continue
        X = via_nos[0]
        if X not in G:
            ll = nos.get(X)
            if ll is None or not (sul <= ll[0] <= norte and oeste <= ll[1] <= leste):
                desfecho['via_fora_da_caixa'] += 1
            elif all(w in no_grafo for w in de + para):
                desfecho['via_interno_de_aresta (simplificado)'] += 1
            else:
                desfecho['via_em_via_fora_do_grafo (nao dirigivel/filtrada)'] += 1
            continue
        entradas = [(u, k, d) for u, _, k, d in G.in_edges(X, keys=True, data=True)]
        saidas = [(w, k, d) for _, w, k, d in G.out_edges(X, keys=True, data=True)]
        ins, m1 = candidatas(entradas, de, X, True)
        outs, m2 = candidatas(saidas, para, X, False)
        if m1 or m2:
            desfecho[m1 or m2] += 1
            continue
        u_turn_mesma_via = valor == 'no_u_turn' and set(de) == set(para)
        if valor in TIPOS_NO:
            pares = {(u, w) for u, _ in ins for w, _ in outs if not u_turn_mesma_via or u == w}
        else:
            if not outs:
                desfecho['only_sem_saida_permitida'] += 1
                continue
            ok = {w for w, _ in outs}
            pares = {(u, w) for u, _ in ins for w in G.successors(X) if w not in ok}
        if pares:
            desfecho['mapeada'] += 1
            mapeadas.append({'relacao': rel['id'], 'restricao': valor, 'via': X, 'pares': sorted(pares)})
        elif not ins:
            desfecho['inocua: sem aresta de entrada na via from (mao unica/filtrada)'] += 1
        elif not outs:
            desfecho['inocua: sem aresta de saida na via to (mao unica/filtrada)'] += 1
        elif valor in TIPOS_ONLY:
            desfecho['inocua: only_* redundante (a saida permitida e a unica no grafo)'] += 1
        else:
            desfecho['inocua: no_u_turn sem aresta de retorno (mao unica)'] += 1
    return mapeadas, desfecho, avisos


def angulo_graus(G, u, X, w) -> float:
    """Giro de quem vai u→X→w: negativo = esquerda, positivo = direita, ±180 = retorno."""
    a, b = next(iter(G[u][X].values())), next(iter(G[X][w].values()))
    la, lo = _vertice_vizinho(G, u, X, a, True)
    lb, lob = _vertice_vizinho(G, X, w, b, False)
    n = G.nodes[X]
    k = math.cos(math.radians(n['y']))
    d = math.degrees(math.atan2((lob - n['x']) * k, lb - n['y']) - math.atan2((n['x'] - lo) * k, n['y'] - la))
    return (d + 180) % 360 - 180


def consistencia_angulos(G, mapeadas) -> dict:
    """Confere o mapeamento pela geometria: a manobra proibida (no_*) ou permitida (only_*) tem de girar para o lado
    que o nome diz. Esquerda/direita a partir de 15°; reto até 45°; retorno a partir de 135°."""
    certo = {'no_left_turn': lambda a: a < -15, 'no_right_turn': lambda a: a > 15, 'no_straight_on': lambda a: abs(a) <= 45,
             'no_u_turn': lambda a: abs(a) >= 135, 'only_left_turn': lambda a: a < -15, 'only_right_turn': lambda a: a > 15,
             'only_straight_on': lambda a: abs(a) <= 45}
    tab = {}
    for r in mapeadas:
        t, X = r['restricao'], r['via']
        if t not in certo:
            continue
        if t.startswith('only_'):
            proibido = {}
            for u, w in r['pares']:
                proibido.setdefault(u, set()).add(w)
            pares = [(u, w) for u in proibido for w in G.successors(X) if w not in proibido[u]]
        else:
            pares = r['pares']
        for u, w in pares:
            c = tab.setdefault(t, [0, 0])
            c[0] += 1
            c[1] += certo[t](angulo_graus(G, u, X, w))
    return {t: {'pares': n, 'coerentes': k, 'pct': round(100 * k / n, 1)} for t, (n, k) in tab.items()}


# ----------------------------------------------------------------------------- caminhos
def haversine_m(la1, lo1, la2, lo2) -> float:
    p1, p2 = math.radians(la1), math.radians(la2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * R_TERRA_M * math.asin(math.sqrt(a))


def vmax_ms(G, peso: str) -> float:
    return max(d['length'] / d[peso] for _, _, d in G.edges(data=True) if d.get(peso) and d['length'] > 0)


def astar_restrito(G, s, t, peso: str, vmax: float, proibidas=frozenset(), vias=frozenset(), ant0=None):
    """A* como o da API, mas que não faz nenhuma manobra de `proibidas` {(u, via, w)}. O estado é (nó, anterior) só
    nos nós de `vias` (os que têm restrição); nos demais é o próprio nó. `ant0` = nó de onde se chegou em `s`
    (para encadear trechos). Devolve a lista de nós ou None."""
    ty, tx = G.nodes[t]['y'], G.nodes[t]['x']

    def h(n):
        return haversine_m(G.nodes[n]['y'], G.nodes[n]['x'], ty, tx) / vmax

    def estado(n, ant):
        return (n, ant) if n in vias else n

    ini = estado(s, ant0)
    custo, pai, cont = {ini: 0.0}, {ini: None}, 0
    fila = [(h(s), 0, ini, 0.0)]
    while fila:
        _, _, est, c = heapq.heappop(fila)
        if c > custo[est]:
            continue
        n, ant = est if isinstance(est, tuple) else (est, None)
        if n == t:
            caminho = []
            while est is not None:
                caminho.append(est[0] if isinstance(est, tuple) else est)
                est = pai[est]
            return caminho[::-1]
        for w, arestas in G[n].items():
            if (ant, n, w) in proibidas:
                continue
            novo = estado(w, n)
            cw = c + min(d[peso] for d in arestas.values())
            if cw < custo.get(novo, math.inf):
                custo[novo], pai[novo] = cw, est
                cont += 1
                heapq.heappush(fila, (cw + h(w), cont, novo, cw))
    return None


def resumo_caminho(G, caminho, peso):
    """(tempo, comprimento em m) pelas arestas de menor peso entre paralelas."""
    t = km = 0.0
    for u, v in zip(caminho, caminho[1:]):
        d = min(G[u][v].values(), key=lambda a: a[peso])
        t += d[peso]
        km += d['length']
    return t, km


def polyline_do_caminho(G, caminho, peso):
    """([[lat, lon]], [índice do nó do caminho mais perto de cada vértice]), seguindo a geometria das arestas
    (como routers/route.montar_polyline)."""
    pontos, no_de = [], []
    for k, (u, v) in enumerate(zip(caminho, caminho[1:])):
        d = min(G[u][v].values(), key=lambda a: a[peso])
        g = d.get('geometry')
        trecho = [[y, x] for x, y in g.coords] if g is not None else [[G.nodes[u]['y'], G.nodes[u]['x']], [G.nodes[v]['y'], G.nodes[v]['x']]]
        for j, p in enumerate(trecho):
            if pontos and j == 0:
                continue
            pontos.append(p)
            no_de.append(k if j <= (len(trecho) - 1) / 2 else k + 1)
    return pontos, no_de


def reconstruir(G, caminho, peso, vmax, proibidas=frozenset(), vias=frozenset()):
    """Imita a TomTom reconstruindo a rota pelos `supportingPoints` (trajeto.pontos_apoio, os da API): A* trecho a
    trecho entre os pontos de apoio, sem as manobras de `proibidas`. Cada ponto de apoio é colado no nó do PRÓPRIO
    caminho que está mais perto (a TomTom cola na via certa; colar no nó mais perto do grafo cai na pista ao lado
    e inventa voltas de km). Sem restrição o resultado é o próprio caminho; com ela, é o menor desvio legal que
    ainda passa por todos os pontos: um piso do que a TomTom faria. Devolve o comprimento em m ou None."""
    import trajeto
    pontos, no_de = polyline_do_caminho(G, caminho, peso)
    nos, j = [], 0
    for p in trajeto.pontos_apoio(pontos):
        while j < len(pontos) - 1 and pontos[j] != p:
            j += 1
        nos.append(caminho[no_de[j]])
    total, ant = 0.0, None
    for a, b in zip(nos, nos[1:]):
        if a == b:
            continue
        trecho = astar_restrito(G, a, b, peso, vmax, proibidas, vias, ant)
        if trecho is None:
            return None
        total += resumo_caminho(G, trecho, peso)[1]
        ant = trecho[-2]
    return total


def _nome(d) -> str:
    n = d.get('name') or d.get('ref') or d.get('highway') or '?'
    return ', '.join(map(str, n)) if isinstance(n, list) else str(n)


def violacoes(G, caminho, explica) -> list:
    """Manobras do caminho que o OSM proíbe: [{'via', 'lat', 'lon', 'de', 'para', 'km_da_origem', 'km_do_destino',
    'restricoes': [(relação, tipo)]}]."""
    acum = [0.0]
    for u, v in zip(caminho, caminho[1:]):
        acum.append(acum[-1] + min(G[u][v].values(), key=lambda a: a['tt_osm'])['length'])
    saida = []
    for i, (u, X, w) in enumerate(zip(caminho, caminho[1:], caminho[2:]), start=1):
        if (u, X, w) in explica:
            dn = min(G[u][X].values(), key=lambda a: a['tt_osm'])
            sn = min(G[X][w].values(), key=lambda a: a['tt_osm'])
            saida.append({'via': X, 'lat': round(G.nodes[X]['y'], 6), 'lon': round(G.nodes[X]['x'], 6),
                          'de': _nome(dn), 'para': _nome(sn), 'giro_graus': round(angulo_graus(G, u, X, w)),
                          'km_da_origem': round(acum[i] / 1000, 2),
                          'km_do_destino': round((acum[-1] - acum[i]) / 1000, 2), 'restricoes': explica[(u, X, w)]})
    return saida


def pares_do_comparador() -> list:
    """CORREDORES + CORREDORES_POI de services/collector/comparar_provedores.py, lidos do código sem importá-lo."""
    fonte = (RAIZ / 'services' / 'collector' / 'comparar_provedores.py').read_text(encoding='utf-8')
    saida = []
    for no in ast.parse(fonte).body:
        if isinstance(no, ast.Assign) and getattr(no.targets[0], 'id', None) in ('CORREDORES', 'CORREDORES_POI'):
            saida += [(i, nome, o, d) for i, nome, o, d in ast.literal_eval(no.value)]
    return saida


def pares_aleatorios(G, scc, n: int, semente: int) -> list:
    rng, nos, saida = random.Random(semente), sorted(scc), []
    while len(saida) < n:
        a, b = rng.sample(nos, 2)
        na, nb = G.nodes[a], G.nodes[b]
        if haversine_m(na['y'], na['x'], nb['y'], nb['x']) >= MIN_ALEATORIO_M:
            saida.append((f'aleatorio-{len(saida) + 1:02d}', f'nó {a} → nó {b}', (na['y'], na['x']), (nb['y'], nb['x'])))
    return saida


# ----------------------------------------------------------------------------- medição
def wilson(k: int, n: int, z: float = 1.96):
    """Intervalo de Wilson (%) de uma proporção k/n."""
    if not n:
        return None
    p, d = k / n, 1 + z * z / n
    c, h = (p + z * z / (2 * n)) / d, z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(100 * (c - h), 1), round(100 * (c + h), 1)]


def _resumo(linhas, grupo) -> dict:
    sel = [x for x in linhas if grupo is None or x['grupo'] == grupo]
    com = [x for x in sel if x['n_violacoes']]
    hon = [x for x in com if x.get('honrando')]
    inf = [x['reconstrucao_sim']['inflacao_restricao_pct'] for x in com if x.get('reconstrucao_sim')]
    km = sum(x['km'] for x in sel)
    return {'caminhos': len(sel), 'com_violacao': len(com), 'pct': round(100 * len(com) / max(len(sel), 1), 1),
            'ic95_pct': wilson(len(com), len(sel)), 'violacoes_totais': sum(x['n_violacoes'] for x in sel),
            'violacoes_por_100km': round(100 * sum(x['n_violacoes'] for x in sel) / max(km, 1), 2),
            'honrar_delta_km_mediana': round(statistics.median([x['honrando']['delta_km'] for x in hon]), 2) if hon else None,
            'honrar_delta_pct_tempo_mediana': round(statistics.median([x['honrando']['delta_pct_tempo'] for x in hon]), 2) if hon else None,
            'honrar_delta_pct_tempo_max': max((x['honrando']['delta_pct_tempo'] for x in hon), default=None),
            'reconstrucao_sim_inflacao_pct_mediana': round(statistics.median(inf), 2) if inf else None}


def medir_pares(G, arvore, pares, peso, explica, proibidas, nos_via) -> list:
    vmax = vmax_ms(G, peso)
    linhas = []
    for pid, nome, o, d, grupo in pares:
        s, ds = arvore.snap(*o)
        t, dt = arvore.snap(*d)
        if s == t:
            continue
        caminho = astar_restrito(G, s, t, peso, vmax)
        if caminho is None:
            continue
        tempo, comp = resumo_caminho(G, caminho, peso)
        viol = violacoes(G, caminho, explica)
        linha = {'id': pid, 'grupo': grupo, 'snap_origem_m': round(ds), 'snap_destino_m': round(dt),
                 'km': round(comp / 1000, 2), 'min': round(tempo / 60, 1), 'n_violacoes': len(viol)}
        if grupo == 'comparador':
            linha['nome'] = nome
        if viol:
            alt = astar_restrito(G, s, t, peso, vmax, proibidas, nos_via)
            if alt is not None:
                t2, c2 = resumo_caminho(G, alt, peso)
                linha['honrando'] = {'km': round(c2 / 1000, 2), 'min': round(t2 / 60, 1), 'delta_km': round((c2 - comp) / 1000, 2),
                                     'delta_pct_tempo': round(100 * (t2 / tempo - 1), 2),
                                     'violacoes': len(violacoes(G, alt, explica))}
            else:
                linha['honrando'] = None
            linha['violacoes'] = viol
        if grupo == 'comparador' or viol:
            livre, restrita = reconstruir(G, caminho, peso, vmax), reconstruir(G, caminho, peso, vmax, proibidas, nos_via)
            if livre and restrita:
                linha['reconstrucao_sim'] = {'livre_pct': round(100 * (livre / comp - 1), 2), 'restrita_pct': round(100 * (restrita / comp - 1), 2),
                                             'inflacao_restricao_pct': round(100 * (restrita / livre - 1), 2)}
        linhas.append(linha)
    return linhas


def snap_alternativo(G, scc, linhas, coords, peso, vmax, explica, k=4, folga_m=100.0) -> list:
    """Só a escolha do nó de origem/destino, SEM restrição no A*: entre os `k` nós do maior SCC mais perto de cada ponta
    (até `folga_m` além do mais perto) há combinação sem manobra proibida? Em via dupla o nó mais perto costuma ser da
    pista do outro lado, e chegar nele pede um retorno. Custo = tempo do caminho + metros até o nó / 1,4 m/s (a pé)."""
    import numpy as np
    ids = np.array(sorted(scc))
    xy = np.array([[G.nodes[n]['y'], G.nodes[n]['x']] for n in ids])

    def perto(lat, lon):
        p1, p2 = np.radians(lat), np.radians(xy[:, 0])
        a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(xy[:, 1] - lon) / 2) ** 2
        d = 2 * R_TERRA_M * np.arcsin(np.sqrt(a))
        o = np.argsort(d)[:k]
        return [(int(ids[i]), float(d[i])) for i in o if d[i] <= d[o[0]] + folga_m]

    saida = []
    for x in linhas:
        if not x['n_violacoes']:
            continue
        o, d = coords[x['id']]
        base = legal = None
        for s, ds in perto(*o):
            for t, dt in perto(*d):
                cam = astar_restrito(G, s, t, peso, vmax) if s != t else None
                if cam is None:
                    continue
                custo = resumo_caminho(G, cam, peso)[0] + (ds + dt) / 1.4
                n = len(violacoes(G, cam, explica))
                base = base or (custo, n, ds + dt)  # 1º par = (mais perto, mais perto) = o do A* normal
                if n == 0 and (legal is None or custo < legal[0]):
                    legal = (custo, ds + dt)
        saida.append({'id': x['id'], 'violacoes_no_snap_normal': base[1], 'legal_so_trocando_o_no': legal is not None,
                      'delta_pct_custo': round(100 * (legal[0] / base[0] - 1), 2) if legal else None,
                      'metros_ate_os_nos_no_snap_normal': round(base[2]),
                      'metros_ate_os_nos_escolhidos': round(legal[1]) if legal else None,
                      'honrando_restricao_delta_pct_tempo': (x.get('honrando') or {}).get('delta_pct_tempo')})
    return saida


def validar_producao(rodadas: dict, producao: dict) -> dict:
    """Compara, nos corredores do comparador, "o caminho de menor tempo cruza uma restrição do OSM" com o desvio que a
    TomTom de fato fez ao reconstruir a rota da LIA em produção (`razao`)."""
    from scipy.stats import fisher_exact, hypergeom, mannwhitneyu, spearmanr
    corr = producao['corredores']
    tabela = []
    for cid, p in corr.items():
        linha = {'id': cid, 'razao_producao': p['razao'], 'vies_tempo_producao': p.get('vies_tempo'), 'lia_km_producao': p['lia_km'],
                 'tt_propria_km': p.get('tt_propria_km')}
        for peso, linhas in rodadas.items():
            x = next((y for y in linhas if y['id'] == cid), None)
            if x:
                linha[peso] = {'km': x['km'], 'violacoes': x['n_violacoes'],
                               'sim_restrita_pct': (x.get('reconstrucao_sim') or {}).get('restrita_pct'),
                               'sim_inflacao_restricao_pct': (x.get('reconstrucao_sim') or {}).get('inflacao_restricao_pct')}
        tabela.append(linha)
    saida = {'corredores': tabela, 'limite_razao': LIMITE_RAZAO}
    for peso in rodadas:
        t = [x for x in tabela if peso in x]
        com = [x for x in t if x[peso]['violacoes']]
        sem = [x for x in t if not x[peso]['violacoes']]
        alto = [x for x in t if x['razao_producao'] > LIMITE_RAZAO]
        s = {'corredores': len(t), 'com_violacao': len(com), 'sem_violacao': len(sem),
             'razao_mediana_com_violacao': round(statistics.median([x['razao_producao'] for x in com]), 3) if com else None,
             'razao_mediana_sem_violacao': round(statistics.median([x['razao_producao'] for x in sem]), 3) if sem else None,
             'razao_maxima_sem_violacao': max((x['razao_producao'] for x in sem), default=None),
             f'corredores_com_razao_acima_{LIMITE_RAZAO}': [x['id'] for x in alto],
             'desses_com_violacao': sum(1 for x in alto if x[peso]['violacoes']),
             'vies_tempo_mediano_com_violacao': round(statistics.median([x['vies_tempo_producao'] for x in com]), 3) if com else None,
             'vies_tempo_mediano_sem_violacao': round(statistics.median([x['vies_tempo_producao'] for x in sem]), 3) if sem else None}
        if alto and com:  # chance de todos os desvios caírem entre os marcados, se a marca fosse sorteio
            k = sum(1 for x in alto if x[peso]['violacoes'])
            s['p_hipergeometrica_desvios_entre_os_marcados'] = round(float(hypergeom.sf(k - 1, len(t), len(com), len(alto))), 4)
        if com and sem:
            s['p_mannwhitney_razao_maior_nos_marcados'] = round(float(mannwhitneyu([x['razao_producao'] for x in com], [x['razao_producao'] for x in sem], alternative='greater').pvalue), 4)
            s['p_mannwhitney_vies_mais_negativo_nos_marcados'] = round(float(mannwhitneyu([x['vies_tempo_producao'] for x in com], [x['vies_tempo_producao'] for x in sem], alternative='less').pvalue), 4)
        sim = [(x['razao_producao'], x[peso]['sim_inflacao_restricao_pct']) for x in t if x[peso]['sim_inflacao_restricao_pct'] is not None]
        if len(sim) > 3:
            r = spearmanr([a for a, _ in sim], [b for _, b in sim])
            s['spearman_razao_x_inflacao_simulada'] = {'rho': round(float(r.statistic), 3), 'p': round(float(r.pvalue), 4), 'n': len(sim)}
        saida[peso] = s
    # só onde o caminho de teste tem o comprimento do da produção (±1,5%, em algum dos dois pesos): a marca é do mesmo caminho
    igual = []
    for x in tabela:
        melhor = min((p for p in rodadas if p in x), key=lambda p: abs(x[p]['km'] - x['lia_km_producao']), default=None)
        if melhor and abs(x[melhor]['km'] - x['lia_km_producao']) <= 0.015 * x['lia_km_producao']:
            igual.append((x['razao_producao'] >= RAZAO_PERCEPTIVEL, x[melhor]['violacoes'] > 0))
    n = Counter(igual)
    saida['caminho_igual_ao_da_producao'] = {
        'corredores': len(igual), 'tolerancia_km_pct': 1.5, 'razao_perceptivel': RAZAO_PERCEPTIVEL,
        'razao_alta_e_marcado': n[(True, True)], 'razao_alta_e_nao_marcado': n[(True, False)],
        'razao_baixa_e_marcado': n[(False, True)], 'razao_baixa_e_nao_marcado': n[(False, False)],
        'p_fisher_unilateral': round(float(fisher_exact([[n[(True, True)], n[(True, False)]], [n[(False, True)], n[(False, False)]]],
                                                        alternative='greater').pvalue), 4)}
    return saida


def custo_exato(G, proibidas, nos_via, tempos) -> dict:
    """Quanto custa honrar as restrições: estados do A* com (nó, anterior) só nos nós-via, ou cópias de nó."""
    por_entrada = Counter((u, X) for u, X, _ in proibidas)
    copias = len(por_entrada)
    arestas_novas = sum(G.out_degree(X) - n for (u, X), n in por_entrada.items())
    extras = sum(G.in_degree(X) for X in nos_via)
    N, E = G.number_of_nodes(), G.number_of_edges()
    return {'nos_via': len(nos_via), 'pct_dos_nos': round(100 * len(nos_via) / N, 3),
            'a_estrela_estados_com_anterior': extras, 'a_estrela_pct_de_estados': round(100 * extras / N, 3),
            'divisao_de_nos_copias': copias, 'divisao_de_nos_arestas_novas': arestas_novas,
            'divisao_pct_nos': round(100 * copias / N, 3), 'divisao_pct_arestas': round(100 * arestas_novas / E, 3),
            'tempo_80_pares_s': tempos}


def medir_tempos(G, arvore, pares, peso, proibidas, nos_via) -> dict:
    """Tempo de parede dos mesmos pares: nx.astar_path (o da API), o A* próprio sem restrição e com restrição."""
    import networkx as nx
    vmax = vmax_ms(G, peso)
    pontos = [(arvore.snap(*o)[0], arvore.snap(*d)[0]) for _, _, o, d, _ in pares]
    pontos = [(s, t) for s, t in pontos if s != t]

    def h(a, b):
        return haversine_m(G.nodes[a]['y'], G.nodes[a]['x'], G.nodes[b]['y'], G.nodes[b]['x']) / vmax

    tempos, igual = {}, True
    for nome, fn in (('nx_astar_path', lambda s, t: nx.astar_path(G, s, t, heuristic=h, weight=peso)),
                     ('astar_proprio_sem_restricao', lambda s, t: astar_restrito(G, s, t, peso, vmax)),
                     ('astar_proprio_com_restricao', lambda s, t: astar_restrito(G, s, t, peso, vmax, proibidas, nos_via))):
        t0 = time.perf_counter()
        caminhos = [fn(s, t) for s, t in pontos]
        tempos[nome] = round(time.perf_counter() - t0, 2)
        if nome == 'astar_proprio_sem_restricao':
            livres = caminhos
        if nome == 'astar_proprio_com_restricao':
            # sem violação o caminho é o mesmo; com restrição o custo nunca é menor que o livre
            for lv, rs in zip(livres, caminhos):
                cl, cr = resumo_caminho(G, lv, peso)[0], resumo_caminho(G, rs, peso)[0]
                igual &= cr >= cl - 1e-6 and (abs(cr - cl) < 1e-6 or any((a, b, c) in proibidas for a, b, c in zip(lv, lv[1:], lv[2:])))
    tempos['sobrecusto_pct_restricao_vs_sem'] = round(100 * (tempos['astar_proprio_com_restricao'] / tempos['astar_proprio_sem_restricao'] - 1), 1)
    tempos['coerente'] = bool(igual)
    return tempos


def trechos_por_via(G, caminho, peso, a, b) -> list:
    """['Nome (km)'] das arestas caminho[a:b+1], agrupando seguidas de mesmo nome."""
    saida = []
    for u, v in zip(caminho[a:b], caminho[a + 1:b + 1]):
        d = min(G[u][v].values(), key=lambda x: x[peso])
        n = _nome(d)
        if saida and saida[-1][0] == n:
            saida[-1][1] += d['length']
        else:
            saida.append([n, d['length']])
    return [f'{n} ({m / 1000:.2f} km)' for n, m in saida]


def bloco_plano_taguatinga(G, arvore, peso, explica, proibidas, nos_via, raw_tags, rels) -> dict:
    """O caso do relatório: caminho livre × honrando, a restrição violada (com as vias do OSM) e, se há uma só
    violação, o desvio local: o que o caminho livre faz na manobra e o que o honrando faz no lugar."""
    pid, nome, o, d = next(p for p in pares_do_comparador() if p[0] == 'plano-taguatinga')
    vmax = vmax_ms(G, peso)
    s, t = arvore.snap(*o)[0], arvore.snap(*d)[0]
    livre = astar_restrito(G, s, t, peso, vmax)
    hon = astar_restrito(G, s, t, peso, vmax, proibidas, nos_via)
    tl, kl = resumo_caminho(G, livre, peso)
    th, kh = resumo_caminho(G, hon, peso)
    por_id = {r['id']: r for r in rels}
    viol = violacoes(G, livre, explica)
    for v in viol:
        for rid, _ in v['restricoes']:
            v.setdefault('vias_osm', []).extend({p: {k: raw_tags.get(ref, {}).get(k) for k in ('name', 'highway', 'ref', 'oneway')}}
                                               for tp, ref, p in por_id[rid]['membros'] if tp == 'way')
    desvio = None
    if len(viol) == 1:
        i = livre.index(viol[0]['via'])  # nó da manobra proibida
        j = next(k for k, (x, y) in enumerate(zip(livre[::-1], hon[::-1])) if x != y)  # nós iguais no fim dos dois
        ih = hon.index(viol[0]['via'])
        desvio = {'livre': trechos_por_via(G, livre, peso, i - 1, i + 1),
                  'honrando (do nó da manobra até voltar a ele e fazer a manobra pela outra entrada)': trechos_por_via(G, hon, peso, ih, len(hon) - j),
                  'metros_do_desvio_honrando': round(sum(min(G[u][v].values(), key=lambda a: a[peso])['length']
                                                          for u, v in zip(hon[ih:len(hon) - j], hon[ih + 1:len(hon) - j + 1]))),
                  'distancia_do_no_ao_destino_m': round(haversine_m(G.nodes[viol[0]['via']]['y'], G.nodes[viol[0]['via']]['x'], *d))}
    return {'peso': peso, 'livre': {'km': round(kl / 1000, 2), 'min': round(tl / 60, 1), 'violacoes': viol},
            'honrando': {'km': round(kh / 1000, 2), 'min': round(th / 60, 1), 'delta_km': round((kh - kl) / 1000, 2),
                         'delta_pct_tempo': round(100 * (th / tl - 1), 2)}, 'desvio': desvio}


def medir(args) -> None:
    import networkx as nx
    import trajeto
    t0 = time.time()
    nos, vias, rels, carimbo, tags_vias = ler_overpass(args.osm)
    print(f'OSM: {len(rels)} relações, {len(vias)} vias, {len(nos)} nós (base {carimbo})')
    G = carregar_grafo(args.grafo)
    scc = max(nx.strongly_connected_components(G), key=len)
    arvore = trajeto.ArvoreNos(G, nos=scc)
    print(f'grafo: {G.number_of_nodes()} nós, {G.number_of_edges()} arestas, maior SCC {len(scc)} ({time.time() - t0:.0f}s)')

    ys = [d['y'] for _, d in G.nodes(data=True)]
    xs = [d['x'] for _, d in G.nodes(data=True)]
    mapeadas, desfecho, avisos = mapear(G, nos, vias, rels, (min(ys), min(xs), max(ys), max(xs)))
    proibidas, explica = set(), {}
    for r in mapeadas:
        for u, w in r['pares']:
            proibidas.add((u, r['via'], w))
            explica.setdefault((u, r['via'], w), []).append((r['relacao'], r['restricao']))
    nos_via = {X for _, X, _ in proibidas}
    avisos['triplas_com_aresta_paralela'] = sum(1 for u, X, w in proibidas if len(G[u][X]) > 1 or len(G[X][w]) > 1)
    por_tipo = Counter(r['restricao'] for r in mapeadas)
    condicionais = []
    for rel in rels:
        if classificar(rel)[1] == 'condicional (horario)':
            via = next((r for t, r, p in rel['membros'] if p == 'via' and t == 'node'), None)
            ll = nos.get(via) or (None, None)
            condicionais.append({'relacao': rel['id'], 'lat': ll[0], 'lon': ll[1],
                                 'regra': next((rel['tags'][k] for k in (*CHAVES_CONDICIONAIS, 'conditional') if k in rel['tags']), None)})
    angulos = consistencia_angulos(G, mapeadas)
    print('desfecho das relações:')
    for k, v in desfecho.most_common():
        print(f'  {v:5d}  {k}')
    print(f'avisos: {dict(avisos)}')
    print(f'mapeadas {len(mapeadas)} -> {len(proibidas)} transições proibidas em {len(nos_via)} nós-via; {dict(por_tipo)}')
    print('coerência geométrica (lado do giro x nome da restrição):', {t: v['pct'] for t, v in angulos.items()})

    pares = [(*p, 'comparador') for p in pares_do_comparador()] + \
            [(*p, 'aleatorio') for p in pares_aleatorios(G, scc, args.aleatorios, args.semente)]
    rodadas = {}
    for peso in ('tt_osm', 'tt_cal'):
        rodadas[peso] = medir_pares(G, arvore, pares, peso, explica, proibidas, nos_via)
        for grupo in ('comparador', 'aleatorio', None):
            r = _resumo(rodadas[peso], grupo)
            print(f'[{peso}] {grupo or "todos"}: {r["com_violacao"]}/{r["caminhos"]} caminhos com manobra proibida '
                  f'({r["pct"]}%, IC95 {r["ic95_pct"]}); honrar: mediana {r["honrar_delta_km_mediana"]} km / '
                  f'{r["honrar_delta_pct_tempo_mediana"]}% do tempo; reconstrução simulada +{r["reconstrucao_sim_inflacao_pct_mediana"]}% '
                  f'({time.time() - t0:.0f}s)')

    producao = json.loads(args.producao.read_text(encoding='utf-8')) if args.producao else None
    validacao = validar_producao(rodadas, producao) if producao else None
    if validacao:
        for peso in rodadas:
            print(f'[{peso}] produção:', json.dumps(validacao[peso], ensure_ascii=False))
    tempos = medir_tempos(G, arvore, pares, 'tt_osm', proibidas, nos_via)
    print('tempos (80 pares):', tempos)
    coords = {p[0]: (p[2], p[3]) for p in pares}
    snap_alt = snap_alternativo(G, scc, rodadas['tt_osm'], coords, 'tt_osm', vmax_ms(G, 'tt_osm'), explica)
    resolvidos = [x for x in snap_alt if x['legal_so_trocando_o_no']]
    todas = [v for x in rodadas['tt_osm'] for v in x.get('violacoes', [])]
    resumo_snap = {'caminhos_com_violacao': len(snap_alt), 'resolvidos_so_trocando_o_no': len(resolvidos),
                   'delta_pct_custo_mediana': round(statistics.median([x['delta_pct_custo'] for x in resolvidos]), 2) if resolvidos else None,
                   'violacoes_a_ate_1_5_km_de_uma_ponta': sum(1 for v in todas if min(v['km_da_origem'], v['km_do_destino']) <= 1.5),
                   'violacoes_total': len(todas)}
    print('snap alternativo:', resumo_snap)
    giros = Counter('retorno (giro >= 135 graus)' if abs(v['giro_graus']) >= 135 else 'esquerda' if v['giro_graus'] < -15
                    else 'direita' if v['giro_graus'] > 15 else 'reto' for v in todas)
    print('giro das violações (tt_osm):', dict(giros))
    quentes = Counter()
    info = {}
    for peso, linhas in rodadas.items():
        for x in linhas:
            for v in x.get('violacoes', []):
                for rid, tipo in v['restricoes']:
                    quentes[rid] += 1
                    info[rid] = {'relacao': rid, 'restricao': tipo, 'lat': v['lat'], 'lon': v['lon'], 'de': v['de'], 'para': v['para']}
    pt = {peso: bloco_plano_taguatinga(G, arvore, peso, explica, proibidas, nos_via, tags_vias, rels) for peso in rodadas}
    print('plano-taguatinga:', json.dumps(pt['tt_osm'], ensure_ascii=False)[:2500])

    resultado = {
        'gerado_em': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'fonte_osm': {'base_overpass': carimbo, 'licenca': 'ODbL (c) contribuidores do OpenStreetMap',
                      'bruto': 'fora do repositório (ml/restricoes_conversao.py baixar)'},
        'grafo': {'arquivo': args.grafo.name, 'nos': G.number_of_nodes(), 'arestas': G.number_of_edges(),
                  'maior_scc_nos': len(scc), 'filtro': 'vias não dirigíveis e access=no fora, como main.filter_drivable'},
        'relacoes': {'baixadas': len(rels), 'desfecho': dict(desfecho.most_common()), 'avisos': dict(avisos),
                     'condicionais_no_tempo (fora do escopo; o horario da partida da rota poderia ligar/desligar)': condicionais},
        'transicoes': {'restricoes_mapeadas': len(mapeadas), 'por_tipo': dict(por_tipo),
                       'triplas_proibidas': len(proibidas), 'nos_via': len(nos_via),
                       'coerencia_geometrica_do_mapeamento': angulos},
        'custo_exato': custo_exato(G, proibidas, nos_via, tempos),
        'medicao': {peso: {'resumo': {g or 'todos': _resumo(linhas, g) for g in ('comparador', 'aleatorio', None)}, 'caminhos': linhas}
                    for peso, linhas in rodadas.items()},
        'pontos_quentes': [{**info[rid], 'ocorrencias_em_160_caminhos': n} for rid, n in quentes.most_common(15)],
        'plano_taguatinga': pt,
        'giro_das_violacoes_tt_osm': dict(giros),
        'snap_alternativo': {'peso': 'tt_osm', 'resumo': resumo_snap, 'caminhos': snap_alt,
                             'regra': 'k=4 nós do maior SCC mais perto de cada ponta, até 100 m além do mais perto; A* sem restrição; custo = tempo + metros a pé / 1,4 m/s'},
        'validacao_producao': {'fonte': producao['fonte'], 'campos': producao['campos'], **validacao} if validacao else None,
        'parametros': {'semente': args.semente, 'aleatorios': args.aleatorios, 'min_aleatorio_m': MIN_ALEATORIO_M,
                       'pesos': {'tt_osm': 'comprimento / limite de velocidade do OSM',
                                 'tt_cal': 'fatores de velocidade livre por grupo de via + atraso de semáforo (semaforos_calibracao.json)'}},
        'restricoes': mapeadas,
    }
    _gravar(args.saida, resultado)
    print(f'gravado {args.saida} ({args.saida.stat().st_size / 1e3:.0f} KB) em {time.time() - t0:.0f}s')


def _gravar(caminho: Path, obj: dict) -> None:
    """JSON legível: indentado, mas cada restrição numa linha só."""
    partes = []
    for k, v in obj.items():
        if k == 'restricoes':
            corpo = ',\n'.join('  ' + json.dumps(r, ensure_ascii=False, separators=(',', ':')) for r in v)
            partes.append(f'"{k}": [\n{corpo}\n]')
        else:
            partes.append(f'"{k}": ' + json.dumps(v, ensure_ascii=False, indent=1, default=str))
    caminho.write_text('{\n' + ',\n'.join(partes) + '\n}\n', encoding='utf-8')


# ----------------------------------------------------------------------------- autoteste
def autoteste() -> None:
    """Cruzamento em X (4 braços A, B, C, D) com desvio A–E–C: confere mapeamento e A* com restrição."""
    import networkx as nx
    G = nx.MultiDiGraph()
    pos = {'X': (0, 0), 'A': (0, -.001), 'B': (0, .001), 'C': (.001, 0), 'D': (-.001, 0), 'E': (.0008, -.0012)}
    nome = {k: i + 1 for i, k in enumerate(pos)}  # ids de nó
    for k, (la, lo) in pos.items():
        G.add_node(nome[k], y=la, x=lo)
    vias_osm = {}
    for i, (a, b) in enumerate([('A', 'X'), ('X', 'B'), ('X', 'C'), ('X', 'D'), ('A', 'E'), ('E', 'C')]):
        wid = 100 + i
        vias_osm[wid] = [nome[a], nome[b]]
        for p, q in ((a, b), (b, a)):
            la = haversine_m(*pos[p], *pos[q])
            G.add_edge(nome[p], nome[q], osmid=wid, length=la, tt=la / 10)
    nos = {nome[k]: v for k, v in pos.items()}
    A, X, B, C, D, E = (nome[k] for k in 'AXBCDE')
    rel_no = {'id': 1, 'tags': {'type': 'restriction', 'restriction': 'no_left_turn'},
              'membros': [('way', 100, 'from'), ('node', X, 'via'), ('way', 102, 'to')]}
    rel_only = {'id': 2, 'tags': {'type': 'restriction', 'restriction': 'only_straight_on'},
                'membros': [('way', 100, 'from'), ('node', X, 'via'), ('way', 101, 'to')]}
    rel_hgv = {'id': 3, 'tags': {'type': 'restriction', 'restriction:hgv': 'no_left_turn'},
               'membros': [('way', 100, 'from'), ('node', X, 'via'), ('way', 103, 'to')]}
    caixa = (-1, -1, 1, 1)
    m, d, _ = mapear(G, nos, vias_osm, [rel_no], caixa)
    assert m[0]['pares'] == [(A, C)] and d['mapeada'] == 1, (m, d)
    assert -100 < angulo_graus(G, A, X, C) < -80, angulo_graus(G, A, X, C)  # A está a oeste, C ao norte: giro à esquerda
    assert consistencia_angulos(G, m)['no_left_turn']['coerentes'] == 1
    m, d, _ = mapear(G, nos, vias_osm, [rel_only], caixa)
    assert m[0]['pares'] == sorted([(A, C), (A, D), (A, A)]), m
    assert consistencia_angulos(G, m)['only_straight_on']['pct'] == 100.0
    m, d, _ = mapear(G, nos, vias_osm, [rel_hgv], caixa)
    assert not m and d['outro_veiculo'] == 1
    proib = {(A, X, C)}
    assert astar_restrito(G, A, C, 'tt', 10.0) == [A, X, C]
    assert astar_restrito(G, A, C, 'tt', 10.0, proib, {X}) == [A, E, C]
    assert astar_restrito(G, A, B, 'tt', 10.0, proib, {X}) == [A, X, B]
    assert astar_restrito(G, X, C, 'tt', 10.0, proib, {X}) == [X, C]  # saindo do nó-via não há "anterior"
    assert wilson(18, 80) == [14.7, 32.8], wilson(18, 80)
    print('restricoes_conversao ok')


def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='Restrições de conversão do OSM no grafo da API (só leitura).')
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('baixar', help='baixa as relações do Overpass')
    b.add_argument('--saida', type=Path, required=True)
    m = sub.add_parser('medir', help='mapeia no grafo e mede nos pares')
    m.add_argument('--osm', type=Path, required=True)
    m.add_argument('--grafo', type=Path, default=GRAFO)
    m.add_argument('--saida', type=Path, default=SAIDA)
    m.add_argument('--producao', type=Path, help='JSON do comparador em produção (ver o docstring)')
    m.add_argument('--semente', type=int, default=42)
    m.add_argument('--aleatorios', type=int, default=50)
    sub.add_parser('autoteste')
    a = ap.parse_args()
    {'baixar': lambda: baixar(a.saida), 'medir': lambda: medir(a), 'autoteste': autoteste}[a.cmd]()


if __name__ == '__main__':
    main()
