"""
Fase 3 — Experimento de validação: LIA vs. TomTom Routing API vs. menor distância.

MOTIVAÇÃO
---------
A página 7 do artigo do TCC 1 afirma: "Comparado aos vetores estáticos, a
precisão conquistada já é formidavelmente superior, provando matematicamente a
tese base da pesquisa." Essa comparação nunca foi medida — este script é o que
a torna verdadeira ou a corrige.

Três rotas são calculadas para o mesmo par origem-destino, sob as mesmas
condições reais de tráfego:
  1. LIA (peso = razão de congestionamento prevista pelo modelo)
  2. Menor distância (o "vetor estático" que o artigo alega superar — já
     calculado dentro do próprio /route desde a Fase 2, sem custo extra)
  3. TomTom Routing API com tráfego ao vivo (referência externa)

RESTRIÇÃO METODOLÓGICA IMPORTANTE
----------------------------------
O TomTom Routing API com traffic=true reflete as condições de tráfego DO
MOMENTO DA CHAMADA — não existe modo "como estaria o trânsito nesta
terça-feira às 8h da semana passada". A LIA também usa datetime.now() para
decidir hora/dia_semana. Ou seja: NÃO dá para simular horários diferentes
artificialmente para os dois lados ao mesmo tempo.

Consequência de desenho: para comparar pico com fora-pico de verdade, este
script precisa ser executado de fato em horários diferentes, ao longo de
vários dias — não numa rodada só. Por isso os resultados são ACRESCENTADOS a
um CSV a cada execução (append, não overwrite), em vez de sobrescritos.
Rodar uma vez dá um sinal inicial rápido; rodar repetidas vezes ao longo de
semanas é o que dá poder estatístico real para separar pico de fora-pico.

Uma chave TomTom é reaproveitada do pool existente (Servidor/config/
tomtom_keys.json) — o volume desta análise é muito menor que a cota diária de
qualquer conta (2.500 req/dia), então uma chave sozinha basta.
"""
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import httpx
import osmnx as ox

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'API'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

MODELS_DIR = os.path.join(os.path.dirname(__file__), 'models')
API_DIR = os.path.join(os.path.dirname(__file__), '..', 'API')
GRAPH_PATH = os.path.join(MODELS_DIR, 'brasilia_graph.graphml')
TOMTOM_KEYS_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'Servidor', 'config', 'tomtom_keys.json'
)
OUT_CSV = os.path.join(MODELS_DIR, 'fase3_comparacao.csv')

BRASILIA_TZ = timezone(timedelta(hours=-3))

# Horário de referência "fora de pico" usado para isolar o atraso por
# congestionamento (ver rota_lia_offpeak). 14h de um dia útil: fora dos picos
# de manhã (7-9h) e final de tarde (17-19h), mas ainda um horário comum de
# tráfego normal — não o extremo artificial de rua vazia de madrugada.
HORA_REFERENCIA_OFFPEAK = 14

# Pares origem-destino, escolhidos para cobrir distâncias curtas/médias/longas
# e diferentes regiões dentro da cobertura atual do grafo (Plano Piloto, Lago
# Sul/Norte, Sudoeste, Cruzeiro — ver main.py). Coordenadas de landmarks já
# validadas em testes anteriores desta sessão.
#
# 19-24/08/2026: as 8 rotas originais ficam quase todas dentro do Plano Piloto
# e núcleos vizinhos — nenhuma delas mostrou congestionamento real nas duas
# primeiras rodadas (trafficDelayInSeconds = 0 quase sempre). Também eram
# pouco diversas em composição de via, o que impediu isolar a causa do gap de
# tempo-base (ver seção 15 do documento de auditoria — R² baixo tanto para
# "atraso por cruzamento" quanto para "déficit por km"). Os 3 pares abaixo
# testam corredores de cidade-satélite → Plano Piloto que atravessam vias
# historicamente congestionadas (EPTG, EPNB) — confirmado que essas vias
# existem no grafo com esses nomes antes de escolher as coordenadas. O
# destino é sempre a Rodoviária, mantido constante de propósito: isola o
# efeito do CORREDOR de origem, em vez de misturar variação de destino
# também.
# 4º elemento (opcional): palavras-chave de via para _composicao_vias() —
# confirma se a rota realmente atravessa o corredor esperado, e quanto da
# distância total está sobre ele. None = não verifica (par sem via-alvo óbvia).
PARES = [
    ('Rodoviária → Aeroporto', (-15.7939, -47.8828), (-15.8697, -47.9172), None),
    ('Asa Norte → Asa Sul', (-15.7601, -47.8825), (-15.8267, -47.9218), None),
    ('Sudoeste → Lago Sul', (-15.7947, -47.9260), (-15.8360, -47.8620), None),
    ('UnB → Esplanada dos Ministérios', (-15.7633, -47.8694), (-15.7995, -47.8640), None),
    ('Parque da Cidade → Torre de TV', (-15.7986, -47.9019), (-15.7900, -47.8960), None),
    ('Lago Norte (Iguatemi) → Setor Comercial Sul', (-15.7333, -47.8869), (-15.7954555, -47.8934785), None),
    ('Cruzeiro → Asa Norte', (-15.7897, -47.9370), (-15.7601, -47.8825), None),
    ('Guará I → Plano Piloto (centro, via EPNB)', (-15.8302, -47.9756), (-15.7939, -47.8828), ['NÚCLEO BANDEIRANTE', 'NUCLEO BANDEIRANTE', 'EPNB']),
    # --- Corredores de cidade-satélite, adicionados em 24/08/2026 ---
    ('Taguatinga Centro → Plano Piloto (via EPTG)', (-15.8330, -48.0530), (-15.7939, -47.8828), ['EPTG', 'PARQUE TAGUATINGA']),
    ('Samambaia → Plano Piloto (via EPTG)', (-15.8580, -48.0760), (-15.7939, -47.8828), ['EPTG', 'PARQUE TAGUATINGA']),
    ('Águas Claras → Plano Piloto (via EPTG)', (-15.8340, -48.0270), (-15.7939, -47.8828), ['EPTG', 'PARQUE TAGUATINGA']),
]


def carregar_chave_tomtom() -> str:
    with open(TOMTOM_KEYS_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data['tomtom_keys'][7]['key']  # key_08 — confirmada funcionando em 19/08/2026


def montar_ambiente_lia():
    """Carrega grafo + modelo + tudo que calculate_route() precisa, uma vez.

    Evita depender de um servidor uvicorn já estar de pé — o script é
    autocontido e reproduzível sozinho.
    """
    import main
    import graph_enrichment as ge
    import recencia_cache as rc
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', 'Servidor', 'config', '.env'))
    from supabase import create_client

    logging.info("Carregando grafo e modelo para o experimento...")
    G = main.filter_drivable(ox.load_graphml(GRAPH_PATH))
    sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY'))
    ge.enrich_graph(G, sb)

    model, encoder, profiles, metadata = main.load_model_artifacts()
    transfer_confidence = main.load_transfer_confidence()
    cache = rc.RecenciaCache()
    cache.refrescar_se_necessario(sb)

    class EstadoFalso:
        pass

    app = EstadoFalso()
    app.state = EstadoFalso()
    app.state.model = model
    app.state.encoder = encoder
    app.state.profiles = profiles
    app.state.metadata = metadata
    app.state.graph = G
    app.state.model_version = main.MODEL_VERSION
    app.state.supabase = sb
    app.state.recencia_cache = cache
    app.state.transfer_confidence = transfer_confidence

    req = EstadoFalso()
    req.app = app
    return req


def _composicao_vias(G, origem, destino, palavras_chave) -> dict:
    """Percentual da distância do caminho LIA sobre vias cujo nome bate com
    alguma palavra-chave (ex. EPTG, EPNB) — verifica o caminho INTEIRO, não só
    os primeiros trechos como `via_principal` (que só olha os 10 primeiros
    arcos e é enviesado para as ruas locais perto da origem).

    Reaproveita os pesos já atribuídos por calculate_route() nesta mesma
    requisição (assign_lia_weights mutou G in-place) — chamar logo depois de
    `await calculate_route(...)`, sobre o mesmo objeto de grafo.
    """
    import networkx as nx
    from routers.route import find_nearest_drivable_node, haversine_m

    orig_node = find_nearest_drivable_node(G, origem[0], origem[1])
    dest_node = find_nearest_drivable_node(G, destino[0], destino[1])
    path = nx.astar_path(
        G, orig_node, dest_node,
        heuristic=lambda u, v: haversine_m(
            G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']
        ) / 30,
        weight='travel_time_lia',
    )

    dist_total = 0.0
    dist_chave = 0.0
    nomes_no_caminho = set()
    for u, v in zip(path[:-1], path[1:]):
        edge = G.get_edge_data(u, v)
        if not edge:
            continue
        d = min(edge.values(), key=lambda x: x.get('travel_time_lia', float('inf')))
        comp = float(d.get('length', 0) or 0)
        dist_total += comp
        nome = d.get('name')
        if isinstance(nome, (list, tuple)):
            nome = nome[0] if nome else None
        if nome:
            nomes_no_caminho.add(str(nome))
            if any(p.upper() in str(nome).upper() for p in palavras_chave):
                dist_chave += comp

    pct = (dist_chave / dist_total * 100) if dist_total > 0 else 0.0
    return {
        'pct_distancia_via_alvo': round(pct, 1),
        'n_nos_caminho': len(path),
        'vias_no_caminho_amostra': '; '.join(sorted(nomes_no_caminho)[:6]),
    }


async def rota_lia_offpeak(req, origem, destino, hora_ref: int, dia_semana: int) -> dict:
    """Tempo LIA para o mesmo par O-D, simulando um horário de referência
    fora de pico — SEM recência (que reflete condições reais do momento da
    execução, não do horário simulado; usá-la aqui vazaria o congestionamento
    atual para dentro da baseline "sem pico" e invalidaria a comparação).

    Não serve para prever tempo absoluto de viagem fora de pico — serve só
    para isolar o atraso por congestionamento:

        atraso_lia = tempo_lia(agora) - tempo_lia(horário de referência)

    O viés sistemático de velocidade-base (sinalização/cruzamentos não
    modelados, ver seção 15 da auditoria) afeta os dois termos igual e se
    cancela na subtração — o resultado é comparável a trafficDelayInSeconds
    do TomTom sem herdar esse viés.
    """
    from routers.route import (
        assign_lia_weights, find_nearest_drivable_node, haversine_m, _resumir_caminho,
    )
    import networkx as nx

    app = req.app
    G = app.state.graph
    assign_lia_weights(
        app.state.model, app.state.encoder, app.state.profiles, G,
        hora_ref, dia_semana, recencia_cache=None,
        transfer_confidence=app.state.transfer_confidence,
    )
    orig_node = find_nearest_drivable_node(G, origem[0], origem[1])
    dest_node = find_nearest_drivable_node(G, destino[0], destino[1])
    path = nx.astar_path(
        G, orig_node, dest_node,
        heuristic=lambda u, v: haversine_m(
            G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']
        ) / 30,
        weight='travel_time_lia',
    )
    tempo, distancia, cobertura = _resumir_caminho(G, path)
    return {
        'tempo_seg': round(tempo),
        'distancia_km': round(distancia / 1000, 2),
        'cobertura_pct': round(cobertura, 1),
    }


async def rota_lia(req, origem, destino, palavras_chave_via=None) -> dict:
    from routers.route import calculate_route, RouteInput, Coordenada
    body = RouteInput(
        origem=Coordenada(lat=origem[0], lon=origem[1]),
        destino=Coordenada(lat=destino[0], lon=destino[1]),
    )
    r = await calculate_route(body, req)
    resultado = {
        'lia_tempo_seg': r.tempo_total_seg,
        'lia_distancia_km': r.distancia_km,
        'lia_cobertura_pct': r.lia_cobertura_pct,
        'menor_dist_tempo_seg': r.tempo_rota_curta_seg,
        'menor_dist_distancia_km': r.distancia_rota_curta_km,
        'rotas_diferentes': r.rotas_diferentes,
        'via_principal': r.via_principal,
    }
    if palavras_chave_via:
        resultado.update(_composicao_vias(req.app.state.graph, origem, destino, palavras_chave_via))
    return resultado


def rota_tomtom(chave: str, origem, destino) -> dict:
    """TomTom Routing API com tráfego ao vivo. Falha isolada não derruba o
    experimento inteiro — registra None e segue para o próximo par.
    """
    url = f"https://api.tomtom.com/routing/1/calculateRoute/{origem[0]},{origem[1]}:{destino[0]},{destino[1]}/json"
    try:
        r = httpx.get(url, params={'key': chave, 'traffic': 'true', 'routeType': 'fastest'}, timeout=20)
        r.raise_for_status()
        s = r.json()['routes'][0]['summary']
        return {
            'tomtom_tempo_seg': s['travelTimeInSeconds'],
            'tomtom_distancia_km': round(s['lengthInMeters'] / 1000, 2),
            'tomtom_atraso_transito_seg': s.get('trafficDelayInSeconds'),
            'tomtom_tempo_sem_transito_seg': s.get('noTrafficTravelTimeInSeconds'),
            'tomtom_erro': None,
        }
    except Exception as e:
        logging.warning(f"  TomTom falhou: {e}")
        return {
            'tomtom_tempo_seg': None, 'tomtom_distancia_km': None,
            'tomtom_atraso_transito_seg': None, 'tomtom_tempo_sem_transito_seg': None,
            'tomtom_erro': str(e)[:200],
        }


async def run():
    t0 = time.time()
    agora = datetime.now(tz=BRASILIA_TZ)
    logging.info("=" * 70)
    logging.info(f"FASE 3 — Comparação LIA vs. TomTom vs. menor distância")
    logging.info(f"Executado em: {agora:%Y-%m-%d %H:%M} (hora={agora.hour}, dia_semana={agora.weekday()})")
    logging.info("=" * 70)

    chave = carregar_chave_tomtom()
    req = montar_ambiente_lia()

    linhas = []
    for nome, origem, destino, palavras_chave in PARES:
        logging.info(f"\n{nome}")
        try:
            lia = await rota_lia(req, origem, destino, palavras_chave)
        except Exception as e:
            logging.error(f"  LIA falhou: {e}")
            continue
        tomtom = rota_tomtom(chave, origem, destino)
        time.sleep(0.3)  # cortesia com a API, nada a ver com o coletor

        # Atraso por congestionamento: compara VARIAÇÃO, não tempo absoluto.
        # Roda de novo depois do TomTom (que não depende de G) mas antes de
        # qualquer outra leitura de travel_time_lia, porque isto reatribui os
        # pesos do grafo para o horário de referência.
        try:
            offpeak = await rota_lia_offpeak(
                req, origem, destino, HORA_REFERENCIA_OFFPEAK, agora.weekday()
            )
            lia_atraso_congestionamento_seg = round(lia['lia_tempo_seg'] - offpeak['tempo_seg'])
        except Exception as e:
            logging.warning(f"  Referência fora de pico falhou: {e}")
            offpeak = {'tempo_seg': None, 'distancia_km': None, 'cobertura_pct': None}
            lia_atraso_congestionamento_seg = None

        linha = {
            'timestamp': agora.isoformat(),
            'hora': agora.hour,
            'dia_semana': agora.weekday(),
            'par': nome,
            'origem_lat': origem[0], 'origem_lon': origem[1],
            'destino_lat': destino[0], 'destino_lon': destino[1],
            **lia,
            **tomtom,
            'lia_tempo_offpeak_ref_seg': offpeak['tempo_seg'],
            'lia_atraso_congestionamento_seg': lia_atraso_congestionamento_seg,
        }
        linhas.append(linha)

        via_info = ""
        if palavras_chave:
            via_info = f" | via-alvo: {lia.get('pct_distancia_via_alvo', 0):.0f}% da distância"

        if tomtom['tomtom_tempo_seg']:
            diff_s = lia['lia_tempo_seg'] - tomtom['tomtom_tempo_seg']
            diff_pct = diff_s / tomtom['tomtom_tempo_seg'] * 100
            logging.info(
                f"  LIA {lia['lia_tempo_seg']}s | TomTom {tomtom['tomtom_tempo_seg']}s "
                f"| diferença {diff_s:+d}s ({diff_pct:+.1f}%) | "
                f"menor-distância {lia['menor_dist_tempo_seg']}s | "
                f"cobertura LIA {lia['lia_cobertura_pct']}%{via_info}"
            )
        else:
            logging.info(f"  LIA {lia['lia_tempo_seg']}s | TomTom indisponível para este par{via_info}")

        atraso_tt = tomtom.get('tomtom_atraso_transito_seg')
        if lia_atraso_congestionamento_seg is not None and atraso_tt is not None:
            logging.info(
                f"  ATRASO POR CONGESTIONAMENTO — LIA: {lia_atraso_congestionamento_seg:+d}s "
                f"(vs. referência {HORA_REFERENCIA_OFFPEAK}h) | TomTom: {atraso_tt:+d}s (agora vs. livre)"
            )

    df_rodada = pd.DataFrame(linhas)

    # Alinha por NOME de coluna em vez de anexar cru (mode='a'): o esquema
    # evolui entre rodadas (ex.: via_principal e as colunas de diagnóstico de
    # via só existem a partir de 24/08/2026) — um append ingênuo grava linhas
    # com largura diferente da do cabeçalho já escrito, corrompendo o CSV.
    # Já aconteceu uma vez (recuperado manualmente). pd.concat com
    # ignore_index alinha por nome, preenchendo NaN nas colunas que uma
    # rodada antiga não tinha, e reescreve o arquivo inteiro com um
    # cabeçalho único.
    if os.path.exists(OUT_CSV):
        hist_anterior = pd.read_csv(OUT_CSV)
        df_total = pd.concat([hist_anterior, df_rodada], ignore_index=True)
    else:
        df_total = df_rodada
    df_total.to_csv(OUT_CSV, index=False, encoding='utf-8')
    logging.info(f"\n{len(df_rodada)} linhas novas — {OUT_CSV} agora com {len(df_total)} linhas no total")

    # --- Resumo da rodada atual ---
    validos = df_rodada[df_rodada['tomtom_tempo_seg'].notna()]
    if len(validos) > 0:
        dif_pct = (validos['lia_tempo_seg'] - validos['tomtom_tempo_seg']) / validos['tomtom_tempo_seg'] * 100
        logging.info("\n--- Resumo desta rodada (tempo absoluto — contaminado por sinalização não modelada) ---")
        logging.info(f"Pares comparados: {len(validos)}/{len(df_rodada)}")
        logging.info(f"Diferença LIA vs. TomTom: média {dif_pct.mean():+.1f}%  |  mediana {dif_pct.median():+.1f}%")
        logging.info(f"|diferença| média: {dif_pct.abs().mean():.1f}%")

    # --- Resumo da rodada atual: ATRASO POR CONGESTIONAMENTO (a métrica que
    # importa — LIA nunca tentou prever tempo de sinal/cruzamento, só o quanto
    # o trânsito atual está atrasando em relação ao normal; TomTom expõe essa
    # mesma grandeza via trafficDelayInSeconds) ---
    validos_atraso = df_rodada[
        df_rodada['lia_atraso_congestionamento_seg'].notna()
        & df_rodada['tomtom_atraso_transito_seg'].notna()
    ]
    if len(validos_atraso) > 0:
        logging.info("\n--- Resumo desta rodada: ATRASO POR CONGESTIONAMENTO (LIA vs. TomTom) ---")
        for _, row in validos_atraso.iterrows():
            logging.info(
                f"  {row['par']}: LIA {row['lia_atraso_congestionamento_seg']:+.0f}s "
                f"| TomTom {row['tomtom_atraso_transito_seg']:+.0f}s"
            )
        erro_abs = (validos_atraso['lia_atraso_congestionamento_seg'] - validos_atraso['tomtom_atraso_transito_seg']).abs()
        logging.info(f"Erro absoluto médio (|LIA - TomTom|): {erro_abs.mean():.0f}s")

    # --- Histórico acumulado (todas as rodadas já rodadas até hoje) ---
    hist_validos = df_total[df_total['tomtom_tempo_seg'].notna()]
    if len(hist_validos) > 0:
        dif_hist = (hist_validos['lia_tempo_seg'] - hist_validos['tomtom_tempo_seg']) / hist_validos['tomtom_tempo_seg'] * 100
        logging.info(f"\n--- Acumulado em {OUT_CSV} ({df_total['timestamp'].nunique()} rodada(s)) ---")
        logging.info(f"Total de comparações válidas: {len(hist_validos)}")
        logging.info(f"|diferença| média (todas as rodadas): {dif_hist.abs().mean():.1f}%")

    hist_atraso = df_total[
        df_total.get('lia_atraso_congestionamento_seg', pd.Series(dtype=float)).notna()
        & df_total['tomtom_atraso_transito_seg'].notna()
    ] if 'lia_atraso_congestionamento_seg' in df_total.columns else df_total.iloc[0:0]
    if len(hist_atraso) >= 2:
        corr = hist_atraso['lia_atraso_congestionamento_seg'].corr(hist_atraso['tomtom_atraso_transito_seg'])
        erro_abs_hist = (hist_atraso['lia_atraso_congestionamento_seg'] - hist_atraso['tomtom_atraso_transito_seg']).abs()
        logging.info(f"\n--- Acumulado: ATRASO POR CONGESTIONAMENTO (n={len(hist_atraso)}) ---")
        logging.info(f"Correlação LIA vs. TomTom: r={corr:.3f}  (r²={corr**2:.3f})")
        logging.info(f"Erro absoluto médio: {erro_abs_hist.mean():.0f}s  |  mediana: {erro_abs_hist.median():.0f}s")

    logging.info(f"\nConcluído em {time.time()-t0:.1f}s")


if __name__ == '__main__':
    import asyncio
    import pandas as pd
    asyncio.run(run())
