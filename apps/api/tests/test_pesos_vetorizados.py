"""assign_lia_weights vetorizado (2026-11-03) contra a implementação por aresta que ele substituiu, num grafo
aleatório com todas as famílias de aresta (modelo, transferência, heurística, bloqueada, via desconhecida, sem
comprimento/velocidade). O resultado tem que ser idêntico bit a bit: mesmos tempos, fontes e razões. No grafo real
(233.237 arestas, LIA 2.3) a mesma comparação deu 0 diferenças em 4 cenários e 2× menos tempo."""
import random
from datetime import datetime

import networkx as nx
import numpy as np
import pytest

import lia_inference as lia_inf
import recency_cache
from routers import route
from routers.route import (DIST_VIA_PROPRIA_M, NON_DRIVABLE_HIGHWAYS, PENALTY_NON_DRIVABLE_S,  # noqa: F401
                           _confianca_transfer, logger, valor_highway)
from test_lia_caca_erros import _contexto, _Encoder, _ModeloSensivelAOrdem, _perfis




class _ModeloPorLinha(_ModeloSensivelAOrdem):
    """Mesma função, linha a linha. O XGBoost real prevê cada linha sozinha (soma das folhas, árvore a árvore),
    então o lote não muda o resultado; já o produto matricial (BLAS) do fake original varia no último bit com o
    tamanho do lote, e o vetorizado manda menos linhas (só as combinações distintas)."""

    def predict(self, X):
        w = np.linspace(0.01, 0.21, len(self.feature_names_in_))
        X = np.nan_to_num(np.asarray(X, dtype=float), nan=0.0)
        return np.array([0.5 + 0.4 * np.sin(sum(float(x) * float(p) for x, p in zip(linha, w))) for linha in X])


# Referência: a implementação por aresta até 2026-11-02 (commit 24a77a6), copiada sem mudanças.
def _referencia(model, encoder, profiles, G: nx.MultiDiGraph,
                       hora: int, dia_semana: int, recencia_cache=None,
                       transfer_confidence=None, contexto=None) -> dict:
    """Atribui `travel_time_lia` a todas as arestas, em uma única predição.

    Substitui o laço que chamava o modelo aresta por aresta. Como `hora` e
    `dia_semana` são iguais para toda a requisição, o perfil histórico varia
    apenas por via — então basta consultar os perfis uma vez por via monitorada
    (≤630) e replicar para as arestas vinculadas. razao_lag1/delta_min_lag1
    (LIA 2.1) seguem o mesmo raciocínio: são por via, não por aresta.

    Depende de graph_enrichment.enrich_graph() ter rodado na subida do servidor:
    sem `id_ponto_lia` e `speed_kph` nas arestas, tudo cai na heurística e o A*
    volta a ser roteamento por distância.

    recencia_cache: instância de recencia_cache.RecenciaCache, ou None. Se None
    (modelo sem essa feature, ou cache indisponível), cada via cai no fallback
    de lia_inference.montar_features() — equivalente ao comportamento da LIA 2.0.
    contexto: via → features da LIA 2.2 (ContextoAoVivo.para_requisicao), ou None.
    """
    arestas = list(G.edges(keys=True, data=True))
    if not arestas:
        return {'model': 0, 'transfer': 0, 'heuristic': 0, 'blocked': 0}

    conhecidas = set(encoder.classes_.tolist())
    ordem = lia_inf.ordem_features(model)
    IDX_VEL_LIVRE = ordem.index('velocidade_livre')

    # Razão de congestionamento de referência para arestas SEM via monitorada
    # em 500 m. Vem do nível global da cascata de perfis — a mediana observada
    # na cidade inteira para este horário e dia.
    #
    # Antes usava-se um fator fixo (1.5 em 7/8/17/18h, 1.0 no resto), o que
    # criava dois esquemas de peso incompatíveis: o modelo devolvia lentidão
    # medida (mediana 1,14x às 8h) enquanto a heurística impunha 1,5x. Uma via
    # monitorada parecia 32% mais barata só pelo esquema de peso, e o A* dava
    # voltas para passar por ela. Fora do pico o viés se invertia. O fator fixo
    # também errava por omissão: 19h tem lentidão real (1,15x) e recebia 1,0.
    razao_global = lia_inf.clamp_razao(
        lia_inf.lookup_perfis(profiles, None, hora, dia_semana)['perfil_hora_dow']
    )
    # PRIOR_CONGESTIONAMENTO=corredor (main.py): a mediana acima é 1,0 (fluxo livre) em 3 de cada 4
    # combinações hora × dia, porque a razão concentra massa em 1. Para somar tempo, o que vale é a
    # média: o prior passa a ser a lentidão que o modelo prevê AGORA nos trechos monitorados (média
    # harmônica ponderada pelo tempo livre). Vale para as arestas sem sensor e é o alvo para onde a
    # transferência encolhe com a distância (antes: 1,0, mais livre que o sensor e que a cidade).
    prior_vivo = G.graph.get('prior_congestionamento') == 'corredor'
    heuristicas = []  # (índice, comprimento, vel. livre): no modo corredor, o prior só sai depois da predição

    # --- Template por via, não por aresta ---
    # Fixados hora e dia_semana, a única feature que varia entre arestas da
    # mesma via é velocidade_livre. Montar uma linha-modelo por via e só
    # substituir essa posição evita 22 mil chamadas a encoder.transform().
    vias_usadas = sorted({
        d.get('id_ponto_lia') for _, _, _, d in arestas
        if d.get('id_ponto_lia') is not None
    } & conhecidas)

    templates = {}
    if vias_usadas:
        encodados = encoder.transform(vias_usadas)  # uma chamada, vetorizada
        for via, enc in zip(vias_usadas, encodados):
            perfis = lia_inf.lookup_perfis(profiles, via, hora, dia_semana)
            recencia = recencia_cache.get(via) if recencia_cache is not None else None
            templates[via] = np.asarray(
                lia_inf.montar_features(int(enc), hora, dia_semana, 0.0, perfis, recencia,
                                        contexto(via) if contexto else None, ordem),
                dtype=float,
            )

    linhas, indices, fontes = [], [], []
    resultado = {'model': 0, 'transfer': 0, 'heuristic': 0, 'blocked': 0}
    vel_tomtom = G.graph.get('vel_livre_tomtom')  # None = comportamento da tese (OSM)

    for i, (u, v, k, d) in enumerate(arestas):
        if valor_highway(d) in NON_DRIVABLE_HIGHWAYS:
            d['travel_time_lia'] = PENALTY_NON_DRIVABLE_S
            d['lia_source'] = 'blocked'
            resultado['blocked'] += 1
            continue

        vel_livre = float(d.get('speed_kph') or 50.0)
        if vel_livre <= 0:
            vel_livre = 50.0
        length_m = float(d.get('length') or 100.0)

        via = d.get('id_ponto_lia')
        tpl = templates.get(via) if via is not None else None
        if tpl is not None:
            dist = float(d.get('dist_lia_m') or 0.0)
            fonte = 'model' if dist < DIST_VIA_PROPRIA_M else 'transfer'
            if fonte == 'model' and vel_tomtom and via in vel_tomtom:
                # Trecho monitorado: mesma velocidade livre do treino (TomTom), não
                # o limite de via do OSM (VEL_LIVRE_CALIBRADA, padrão; ver ml/free_flow_speeds.py).
                vel_livre = vel_tomtom[via]
            linha = tpl.copy()
            linha[IDX_VEL_LIVRE] = vel_livre
            linhas.append(linha)
            indices.append(i)
            fontes.append((fonte, dist, vel_livre, length_m))
            resultado[fonte] += 1
        else:
            # Sem via monitorada em 500 m: adota a razão global do horário.
            # Mesma fórmula do ramo do modelo, então as duas famílias de aresta
            # ficam comparáveis e o A* não é enviesado por escolha de esquema.
            if prior_vivo:
                heuristicas.append((i, length_m, vel_livre))
                resultado['heuristic'] += 1
                continue
            d['travel_time_lia'] = lia_inf.tempo_de_razao(length_m, vel_livre, razao_global)
            d['lia_source'] = 'heuristic'
            d['lia_razao'] = round(razao_global, 4)
            resultado['heuristic'] += 1

    # --- Uma única chamada ao modelo para todas as arestas vinculadas ---
    prior = razao_global
    if linhas:
        razoes = np.clip(
            model.predict(np.vstack(linhas)),
            lia_inf.RAZAO_MIN, lia_inf.RAZAO_MAX,
        )
        if prior_vivo:
            eh_modelo = np.array([f[0] == 'model' for f in fontes])
            if eh_modelo.any():
                t_livre = np.array([f[3] / max(f[2], 1.0) for f in fontes])[eh_modelo]  # ∝ tempo livre
                prior = float(lia_inf.clamp_razao(t_livre.sum() / (t_livre / razoes[eh_modelo]).sum()))

        # Confiança da transferência, vetorizada: quanto mais longe a via de
        # referência, mais a razão volta para fluxo livre (1.0).
        dists = np.array([f[1] for f in fontes])
        eh_transfer = np.array([f[0] == 'transfer' for f in fontes])
        conf = _confianca_transfer(dists, transfer_confidence)
        conf = np.where(eh_transfer, conf, 1.0)
        razoes = razoes * conf + (prior if prior_vivo else 1.0) * (1.0 - conf)

        for idx, razao, (fonte, _, vel_livre, length_m) in zip(indices, razoes, fontes):
            _, _, _, d = arestas[idx]
            d['travel_time_lia'] = lia_inf.tempo_de_razao(length_m, vel_livre, float(razao))
            d['lia_source'] = fonte
            d['lia_razao'] = round(float(razao), 4)

    for i, length_m, vel_livre in heuristicas:
        d = arestas[i][3]
        d['travel_time_lia'] = lia_inf.tempo_de_razao(length_m, vel_livre, prior)
        d['lia_source'] = 'heuristic'
        d['lia_razao'] = round(prior, 4)

    logger.info(
        f"Pesos atribuídos (prior {'corredor' if prior_vivo else 'perfil'} {prior:.3f}): "
        f"{resultado['model']:,} do modelo, "
        f"{resultado['transfer']:,} de transfer, "
        f"{resultado['heuristic']:,} heurística, "
        f"{resultado['blocked']:,} bloqueadas"
    )
    return resultado


def _grafo(semente: int) -> nx.MultiDiGraph:
    rnd = random.Random(semente)
    G = nx.MultiDiGraph()
    G.graph['vel_livre_tomtom'] = {1: 47.3, 3: 61.0}
    for i in range(400):
        u, v = rnd.randrange(80), rnd.randrange(80)
        d = {'highway': rnd.choice(['primary', 'secondary', 'residential', 'footway', ['primary', 'trunk']]),
             'speed_kph': rnd.choice([None, 0, 30, 40.0, 50, 60, 80]),
             'length': rnd.choice([None, 0, 12.5, 80.0, 333.3, 1200.0])}
        via = rnd.choice([None, None, 1, 2, 3, 99])
        if via is not None:
            d['id_ponto_lia'] = via
            d['dist_lia_m'] = rnd.choice([None, 0.0, 10.0, 49.9, 50.0, 200.0, 480.0])
        G.add_edge(u, v, **d)
    return G


@pytest.mark.parametrize('prior', ['corredor', 'perfil'])
@pytest.mark.parametrize('semente', [1, 2, 3])
def test_vetorizado_igual_a_referencia_bit_a_bit(semente, prior, tmp_path, monkeypatch):
    modelo, enc, perfis = _ModeloPorLinha(), _Encoder(), _perfis()
    rc = recency_cache.RecenciaCache()
    rc._ultima_busca = float('inf')
    rc.registrar(1, 0.6)
    # Relógio parado: a idade da leitura (delta_min) muda entre as duas rodadas e o fake é contínuo.
    agora = recency_cache._agora_utc()
    monkeypatch.setattr(recency_cache, '_agora_utc', lambda: agora)
    ctx = _contexto(tmp_path).para_requisicao(datetime(2026, 11, 2, 8, tzinfo=lia_inf.BRASILIA_TZ), rc)
    resultados = []
    for funcao in (_referencia, route.assign_lia_weights):
        G = _grafo(semente)
        G.graph['prior_congestionamento'] = prior
        contagem = funcao(modelo, enc, perfis, G, 8, 0, rc, None, ctx)
        arestas = [(d.get('travel_time_lia'), d.get('lia_source'), d.get('lia_razao')) for _, _, _, d in G.edges(keys=True, data=True)]
        resultados.append((contagem, arestas))
    (c_ref, a_ref), (c_novo, a_novo) = resultados
    assert c_novo == c_ref and all(c_ref[f] > 0 for f in ('model', 'transfer', 'heuristic', 'blocked'))
    assert a_novo == a_ref


def test_segunda_chamada_reseta_o_que_a_requisicao_anterior_marcou(tmp_path):
    """Sensores virtuais marcam arestas (lia_source='virtual'); a rota seguinte volta ao estado do modelo."""
    modelo, enc, perfis = _ModeloPorLinha(), _Encoder(), _perfis()
    ctx = _contexto(tmp_path).para_requisicao(datetime(2026, 11, 2, 8, tzinfo=lia_inf.BRASILIA_TZ), None)
    G = _grafo(7)
    route.assign_lia_weights(modelo, enc, perfis, G, 8, 0, None, None, ctx)
    antes = [(d['travel_time_lia'], d['lia_source']) for _, _, _, d in G.edges(keys=True, data=True)]
    for _, _, _, d in list(G.edges(keys=True, data=True))[:50]:
        d['lia_source'], d['travel_time_lia'] = 'virtual', 1.0
    route.assign_lia_weights(modelo, enc, perfis, G, 8, 0, None, None, ctx)
    assert [(d['travel_time_lia'], d['lia_source']) for _, _, _, d in G.edges(keys=True, data=True)] == antes
