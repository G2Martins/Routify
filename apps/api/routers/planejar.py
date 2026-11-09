"""
POST /route/horarios — "Planejar saída": quanto o MESMO trajeto leva em cada horário de partida.

Como sai o número
-----------------
1. O caminho é calculado UMA vez, para a primeira saída, como no /route: snap no maior componente,
   `assign_lia_weights` no grafo inteiro, A* com o atraso calibrado de semáforo/cruzamento no peso e as
   conversões proibidas (quando ligadas). Sem TomTom: nem leitura ao vivo do corredor, nem interdições, nem
   fusão. Não gasta cota.
2. Para cada saída, a LIA prevê a razão de congestionamento das vias monitoradas na hora e no dia da saída.
   É uma chamada só ao modelo, com as linhas (via × saída) empilhadas. O tempo de cada aresta segue a regra do
   `assign_lia_weights`:
   - sensor: a previsão;
   - transferência: a previsão encolhida para o prior pela confiança calibrada;
   - sem sensor a 500 m: o prior. No modo `corredor`, o prior é a média harmônica da previsão nos trechos
     monitorados da cidade NAQUELA saída.
   Por fim soma o mesmo atraso de semáforo/cruzamento do /route. Na primeira saída, a conta dá o tempo da LIA do
   /route para o mesmo instante (tests/test_planejar.py, paridade).

Simplificação declarada (`mesmo_trajeto: true`): o A* não é refeito por saída. Seriam 1 predição do grafo
inteiro + 1 A* por horário (~0,7 s cada, medido local; mais na t3.small). No pico, outro caminho pode ser
melhor; aqui vale o caminho escolhido para a primeira saída.

Recência no futuro
------------------
Saída futura não tem leitura ao vivo. Vale a regra do /predict (`predict.recencia_no_instante`): a última leitura
da via envelhece pela antecedência (idade agora + minutos até a saída). Acima de 24 h ela some, e o modelo cai no
perfil da faixa + 24 h de defasagem, o fallback validado. A LIA 2.3 foi treinada para isso: em metade das linhas,
a recência foi envelhecida de 15 a 480 min (`ml/features.py`, IDADES_RECENCIA_MIN, "mais quando a partida é no
futuro"). Ela desconta sozinha a leitura velha e pende para o perfil, sem regra extra aqui. Os vizinhos (LIA 2.2)
só entram se a leitura ainda caberia na janela de 60 min na hora da saída. Chuva e feriado seguem a data e a
hora da saída.
"""
import logging
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Dict, List, NamedTuple, Optional, Tuple

import networkx as nx
import numpy as np
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

import lia_inference as lia_inf
import tomtom
import trajeto
from graph_enrichment import NON_DRIVABLE_HIGHWAYS, valor_highway
from lia_inference import BRASILIA_TZ
from openapi import erro
from routers import route
from routers.predict import TOLERANCIA_PASSADO_MIN, recencia_no_instante
from seguranca import Limitador, ip_cliente, limitar

router = APIRouter(prefix="/route", tags=["Roteamento"])

logger = logging.getLogger(__name__)

# DF com folga (CAIXA_DF de ml/auditoria_grafo_df.py). Dentro dela, o snap ainda recusa o que fica além do grafo.
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = -16.10, -15.45, -48.35, -47.25
HORIZONTE = timedelta(days=7)
PERFIS = ('perfil_via_hora_dow', 'perfil_via_hora', 'perfil_via', 'perfil_hora_dow',
          'perfil_via_hora_dow_std', 'perfil_via_hora_dow_n')

_limite_ip = Limitador(10)  # cada pedido = 1 predição do grafo inteiro + 1 A* (CPU da t3.small)


class PontoDF(BaseModel):
    model_config = ConfigDict(extra='forbid')
    lat: float = Field(..., ge=LAT_MIN, le=LAT_MAX, allow_inf_nan=False, examples=[-15.7939])
    lon: float = Field(..., ge=LON_MIN, le=LON_MAX, allow_inf_nan=False, examples=[-47.8828])


class HorariosInput(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={"examples": [{
        "origem": {"lat": -15.7939, "lon": -47.8828},
        "destino": {"lat": -15.8339, "lon": -48.0569},
        "passo_min": 30,
        "janelas": 12,
    }]})
    origem: PontoDF = Field(..., description="Ponto de partida (dentro do DF).")
    destino: PontoDF = Field(..., description="Ponto de chegada (dentro do DF).")
    inicio: Optional[datetime] = Field(
        None, description="Primeira saída (ISO 8601; sem fuso = horário de Brasília), de agora a 7 dias à frente. "
                          "Padrão: agora, arredondado para os próximos 5 min.")
    passo_min: int = Field(30, ge=15, le=120, description="Minutos entre uma saída e a próxima.")
    janelas: int = Field(12, ge=2, le=24, description="Quantas saídas comparar.")


class Horario(BaseModel):
    saida: datetime = Field(..., description="Hora de partida (Brasília, com fuso).")
    tempo_seg: int = Field(..., description="Tempo previsto do trajeto saindo nessa hora.")
    trafego: Optional[List[Optional[int]]] = Field(
        None, description="Trânsito previsto por trecho da `polyline` nessa saída (ponto i → i+1): 0 livre, 1 moderado, "
                          "2 lento, 3 parado, null sem dado. Mesmo formato do `trafego` do /route.")


class HorariosOutput(BaseModel):
    horarios: List[Horario]
    polyline: List[List[float]] = Field(default_factory=list, description="Pontos [lat, lon] do trajeto, seguindo a geometria real das vias.")
    melhor: int = Field(..., description="Índice da saída mais rápida (no empate, a mais cedo).")
    distancia_km: float
    tempo_livre_seg: int = Field(..., description="Mesmo trajeto sem congestionamento (razão 1,0), com os atrasos de cruzamento.")
    lia_cobertura_pct: float = Field(..., description="% das arestas do trajeto com sensor ou transferência; o resto segue o prior.")
    mesmo_trajeto: bool = Field(True, description="Todas as saídas usam o caminho da primeira (o A* não é refeito por horário).")
    modelo_utilizado: str


class _Trecho(NamedTuple):
    fonte: str  # 'model' | 'transfer' | 'heuristic' | 'blocked', como no assign_lia_weights
    via: Optional[int]
    dist: float
    vel: float  # velocidade livre que entra no tempo (km/h)
    comprimento: float


def _trecho(d: dict, conhecidas: set, vel_tomtom: Optional[dict]) -> _Trecho:
    """Classifica a aresta com a regra de route._pesos_fixos, a do assign_lia_weights (o teste de paridade vigia
    a cópia). Só para as ~100-300 arestas do caminho: achar o índice delas no cache do grafo custaria mais."""
    vel = float(d.get('speed_kph') or 50.0)
    vel = vel if vel > 0 else 50.0
    comprimento = float(d.get('length') or 100.0)
    if valor_highway(d) in NON_DRIVABLE_HIGHWAYS:
        return _Trecho('blocked', None, 0.0, vel, comprimento)
    via = d.get('id_ponto_lia')
    if via is None or via not in conhecidas:
        return _Trecho('heuristic', None, 0.0, vel, comprimento)
    dist = float(d.get('dist_lia_m') or 0.0)
    fonte = 'model' if dist < route.DIST_VIA_PROPRIA_M else 'transfer'
    if fonte == 'model' and vel_tomtom and via in vel_tomtom:
        vel = vel_tomtom[via]
    return _Trecho(fonte, via, dist, vel, comprimento)


def _monitorados(fixo: dict) -> Dict[Tuple[int, float], float]:
    """Trechos 'model' do grafo inteiro por (via, vel. livre), com a soma do tempo livre: a base do prior `corredor`.
    Mesma linha, mesma previsão: a média harmônica por aresta vira uma por grupo. Lê a classificação estática que o
    assign_lia_weights já guardou (route._pesos_fixos), sem varrer o grafo de novo."""
    m = fixo['fonte'] == 'model'
    t_livre = (fixo['comp'][m] / np.maximum(fixo['vel'][m], 1.0)).tolist()
    grupos: Dict[Tuple[int, float], float] = {}
    for i, vel, t in zip(fixo['via_idx'][m].tolist(), fixo['vel'][m].tolist(), t_livre):
        chave = (fixo['vias'][int(i)], vel)
        grupos[chave] = grupos.get(chave, 0.0) + t
    return grupos


def _da_faixa(tabela, chave, nivel, vias: list) -> np.ndarray:
    """Valores de uma tabela de perfis (Series/DataFrame) na faixa `chave` do nível `nivel`, na ordem de `vias`.
    NaN onde a via não tem amostra (e em todas, se a faixa inteira não existe)."""
    try:
        fatia = tabela.xs(chave, level=nivel)
    except KeyError:
        fatia = tabela.iloc[:0].droplevel(nivel)
    return fatia.reindex(vias).to_numpy(dtype=float)


def _perfis_da_hora(profiles, vias: list, hora: int, dia: int) -> np.ndarray:
    """lia_inference.lookup_perfis de várias vias numa (hora, dia), vetorizado: 2 ms contra 80 ms de 630
    chamadas. Mesma cascata (via,hora,dow) → (via,hora) → (via) → (hora,dow) → global, como o
    features.apply_profiles do treino; o teste de paridade com lookup_perfis vigia a cópia. Colunas = PERFIS."""
    p_hd = lia_inf.lookup_perfis(profiles, None, hora, dia)['perfil_hora_dow']
    p_v = profiles['via'].reindex(vias).to_numpy(dtype=float)
    p_v = np.where(np.isnan(p_v), p_hd, p_v)
    p_vh = _da_faixa(profiles['via_hora'], hora, 'hora', vias)
    p_vh = np.where(np.isnan(p_vh), p_v, p_vh)
    vhd = _da_faixa(profiles['via_hora_dow'][['perfil_via_hora_dow', 'perfil_via_hora_dow_std', 'perfil_via_hora_dow_n']],
                    (hora, dia), ['hora', 'dia_semana'], vias)
    p_vhd = np.where(np.isnan(vhd[:, 0]), p_vh, vhd[:, 0])
    return np.column_stack([p_vhd, p_vh, p_v, np.full(len(vias), p_hd), np.nan_to_num(vhd[:, 1]), np.nan_to_num(vhd[:, 2])])


def _atrasos(G: nx.MultiDiGraph) -> Tuple[float, float, float]:
    return tuple(float(G.graph.get(k, 0.0)) for k in ('atraso_semaforo_s', 'atraso_cruzamento_s', 'atraso_cruzamento_via_s'))


def tempos_por_saida(model, encoder, profiles, G: nx.MultiDiGraph, nos: List[int], saidas: List[datetime],
                     agora: datetime, recencia=None, transfer_confidence=None,
                     contexto=None, niveis: Optional[List[List[Optional[int]]]] = None) -> Tuple[np.ndarray, float]:
    """(tempo previsto em s do caminho `nos` para cada instante de `saidas`, tempo livre do mesmo caminho).

    Uma chamada ao modelo para (via, vel. livre) × saídas; mesma conta do assign_lia_weights + atrasos do /route.
    As arestas são as que o A* percorreu (pesos atuais do grafo): ler antes de qualquer await.
    `niveis`, se vier, recebe o nível de trânsito de cada aresta do caminho, uma lista por saída.
    """
    ordem = lia_inf.ordem_features(model)
    i_vel = ordem.index('velocidade_livre')
    classes = encoder.classes_.tolist()
    conhecidas = set(classes)
    vel_tt = G.graph.get('vel_livre_tomtom')
    prior_vivo = G.graph.get('prior_congestionamento') == 'corredor'

    trechos = [_trecho(trajeto.aresta_usada(G, u, v), conhecidas, vel_tt) for u, v in zip(nos, nos[1:])]
    # O assign_lia_weights desta requisição acabou de validar esse cache; route._pesos_fixos de novo custaria
    # ~130 ms só na chave (G.number_of_edges() é O(arestas) no MultiDiGraph).
    grupos = _monitorados(G.graph.get('_pesos_fixos') or route._pesos_fixos(G, encoder)) if prior_vivo else {}
    chaves = list(dict.fromkeys([*grupos, *((t.via, t.vel) for t in trechos if t.via is not None)]))
    col = {k: j for j, k in enumerate(chaves)}
    vias = list(dict.fromkeys(v for v, _ in chaves))
    enc = dict(zip(vias, encoder.transform(vias))) if vias else {}
    rec = {v: recencia.get(v) for v in vias} if recencia is not None else {}

    linhas, globais = [], []
    for t in saidas:
        hora, dia = t.hour, t.weekday()
        minutos = (t - agora).total_seconds() / 60.0
        globais.append(lia_inf.clamp_razao(lia_inf.lookup_perfis(profiles, None, hora, dia)['perfil_hora_dow']))
        if not vias:
            continue
        perfis = _perfis_da_hora(profiles, vias, hora, dia)
        ctx = (contexto.para_requisicao(t, recencia if minutos >= -TOLERANCIA_PASSADO_MIN else None, max(minutos, 0.0))
               if contexto is not None else None)
        base = {v: np.asarray(lia_inf.montar_features(
                    int(enc[v]), hora, dia, 0.0, dict(zip(PERFIS, perfis[i])),
                    recencia_no_instante(rec.get(v), minutos), ctx(v) if ctx else None, ordem), dtype=float)
                for i, v in enumerate(vias)}
        for v, vel in chaves:
            linha = base[v].copy()
            linha[i_vel] = vel
            linhas.append(linha)
    R = (np.clip(model.predict(np.vstack(linhas)), lia_inf.RAZAO_MIN, lia_inf.RAZAO_MAX).reshape(len(saidas), len(chaves))
         if linhas else np.empty((len(saidas), 0)))

    t_grupo = np.array(list(grupos.values()), dtype=float)
    col_grupo = [col[k] for k in grupos]
    conf = np.ones(len(trechos))
    transf = [i for i, t in enumerate(trechos) if t.fonte == 'transfer']
    if transf:
        conf[transf] = route._confianca_transfer([trechos[i].dist for i in transf], transfer_confidence)
    a_sem, a_cruz, a_via = _atrasos(G)
    atrasos = (a_sem * trajeto.contar_semaforos(G, nos) + a_cruz * trajeto.contar_cruzamentos(G, nos)
               + a_via * trajeto.contar_cruzamentos(G, nos, 'cruzamento_via'))

    tempos = np.empty(len(saidas))
    for k in range(len(saidas)):
        prior = globais[k]
        if grupos:  # modo corredor com trechos monitorados: média harmônica ponderada pelo tempo livre
            prior = lia_inf.clamp_razao(float(t_grupo.sum() / (t_grupo / R[k, col_grupo]).sum()))
        alvo = prior if prior_vivo else 1.0  # para onde a transferência encolhe
        total = 0.0
        linha_niveis: List[Optional[int]] = []
        for t, c in zip(trechos, conf):
            if t.fonte == 'blocked':
                total += route.PENALTY_NON_DRIVABLE_S
                linha_niveis.append(None)
                continue
            razao = prior if t.fonte == 'heuristic' else float(R[k, col[(t.via, t.vel)]]) * c + alvo * (1.0 - c)
            total += lia_inf.tempo_de_razao(t.comprimento, t.vel, razao)
            linha_niveis.append(None if t.fonte == 'heuristic' else lia_inf.nivel_da_razao(razao))
        tempos[k] = total + atrasos
        if niveis is not None:
            niveis.append(linha_niveis)
    livre = sum(lia_inf.tempo_de_razao(t.comprimento, t.vel, 1.0) for t in trechos if t.fonte != 'blocked') + atrasos
    return tempos, livre


def _primeira_saida(inicio: Optional[datetime], agora: datetime) -> datetime:
    """Sem `inicio`: agora, arredondado para os próximos 5 min (rótulos redondos no app). Com `inicio`: de agora
    (5 min de tolerância de relógio) a 7 dias à frente; sem fuso = Brasília. Compara antes de converter: data
    extrema não estoura na conversão de fuso."""
    if inicio is None:
        base = agora.replace(second=0, microsecond=0)
        return base + timedelta(minutes=-base.minute % 5)
    dt = inicio if inicio.tzinfo else inicio.replace(tzinfo=BRASILIA_TZ)
    if not agora - timedelta(minutes=TOLERANCIA_PASSADO_MIN) <= dt <= agora + HORIZONTE:
        raise HTTPException(status_code=422, detail="inicio precisa estar entre agora e 7 dias à frente.")
    return dt.astimezone(BRASILIA_TZ)


def _tracar(G: nx.MultiDiGraph, pontas_o: list, pontas_d: list):
    """O mesmo traçado do /route (snap em aresta), com os atrasos no peso e as conversões proibidas. None sem pontas."""
    if not pontas_o or not pontas_d:
        return None
    a_sem, a_cruz, a_via = _atrasos(G)
    peso = (tomtom.peso_sem_interditadas(set(), route.PENALTY_NON_DRIVABLE_S, a_sem, a_cruz, a_via)
            if a_sem or a_cruz or a_via else 'travel_time_lia')
    return trajeto.tracar_por_arestas(G, pontas_o, pontas_d, route._vmax_ms(G), peso, G.graph.get('conversoes_proibidas'))


def _niveis_na_polyline(G: nx.MultiDiGraph, nos: List[int], por_aresta: List[Optional[int]], n_pontos: int) -> List[Optional[int]]:
    """Nível por aresta → nível por trecho da polyline. As pontas (pedaços de aresta fora de `nos`) herdam o nível
    da aresta vizinha do caminho: dá para pintar sem outra chamada ao modelo."""
    miolo: List[Optional[int]] = []
    for (trecho, _), nivel in zip(route._trechos(G, nos), por_aresta):
        miolo.extend([nivel] * (len(trecho) - 1))
    falta = max(0, n_pontos - 1 - len(miolo))
    primeiro, ultimo = (por_aresta[0], por_aresta[-1]) if por_aresta else (None, None)
    return [primeiro] * (falta // 2) + miolo + [ultimo] * (falta - falta // 2)


def _caminho(G: nx.MultiDiGraph, orig: int, dest: int) -> List[int]:
    """O A* do /route (heurística admissível, atrasos no peso, conversões proibidas se ligadas), sem interdições."""
    vmax = route._vmax_ms(G)

    def h(u, v):
        return route.haversine_m(G.nodes[u]['y'], G.nodes[u]['x'], G.nodes[v]['y'], G.nodes[v]['x']) / vmax

    a_sem, a_cruz, a_via = _atrasos(G)
    peso = (tomtom.peso_sem_interditadas(set(), route.PENALTY_NON_DRIVABLE_S, a_sem, a_cruz, a_via)
            if a_sem or a_cruz or a_via else 'travel_time_lia')
    try:
        nos = nx.astar_path(G, orig, dest, heuristic=h, weight=peso)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        raise HTTPException(status_code=422, detail="Sem rota disponível entre origem e destino.")
    proibidas = G.graph.get('conversoes_proibidas')
    if proibidas and trajeto.viola_conversao(nos, proibidas):
        nos = trajeto.astar_com_restricoes(G, orig, dest, h, peso, proibidas) or nos
    return nos


@router.post(
    "/horarios",
    response_model=HorariosOutput,
    summary="Planejar saída (mesmo trajeto, vários horários)",
    description=(
        "Tempo previsto pela LIA para o **mesmo trajeto** em várias horas de partida, e a mais rápida. O caminho é "
        "o A* do `/route` para a primeira saída (`mesmo_trajeto: true`: não é refeito por horário). Cada saída usa "
        "a previsão da LIA para aquela hora e dia da semana, numa chamada só ao modelo. A leitura ao vivo envelhece "
        "até a saída, como no `/predict`. Não chama a TomTom: sem trânsito ao vivo, interdições ou fusão. Não grava "
        "origem nem destino. Limite: 10 pedidos/min por IP."
    ),
    responses={
        422: erro("Corpo inválido, ponto fora do DF ou da malha, `inicio` fora da janela, ou sem caminho.",
                  "inicio precisa estar entre agora e 7 dias à frente."),
        429: erro("Limite de pedidos por minuto excedido.", "Muitas requisições. Tente de novo em instantes."),
    },
)
async def planejar_saida(body: HorariosInput, request: Request):
    limitar(_limite_ip, ip_cliente(request))
    t0 = time.perf_counter()
    st = request.app.state
    agora = datetime.now(tz=BRASILIA_TZ)
    primeira = _primeira_saida(body.inicio, agora)
    G = st.graph
    recencia = getattr(st, 'recencia_cache', None)
    if recencia is not None:
        recencia.refrescar_se_necessario(getattr(st, 'supabase', None))
    contexto_obj = getattr(st, 'contexto', None)
    if contexto_obj is not None:
        await contexto_obj.atualizar_chuva()
    transfer_confidence = getattr(st, 'transfer_confidence', None)

    orig, dist_orig = route._snap(request, G, body.origem.lat, body.origem.lon)
    dest, dist_dest = route._snap(request, G, body.destino.lat, body.destino.lon)
    if max(dist_orig, dist_dest) > trajeto.LIMITE_SNAP_M:
        raise HTTPException(status_code=422, detail="Origem ou destino fora da área atendida pelo Routify.")
    arvore = getattr(st, 'arvore_arestas', None)
    pontas_o = arvore.candidatos(body.origem.lat, body.origem.lon) if arvore is not None else []
    pontas_d = arvore.candidatos(body.destino.lat, body.destino.lon) if arvore is not None else []
    if orig == dest and (not pontas_o or route.haversine_m(body.origem.lat, body.origem.lon, body.destino.lat, body.destino.lon) < 30.0):
        raise HTTPException(status_code=422, detail="Origem e destino são o mesmo lugar.")

    # Daqui ao fim não há await: os pesos ficam no grafo compartilhado entre requisições (regra do /route).
    minutos = (primeira - agora).total_seconds() / 60.0
    rec_primeira = (SimpleNamespace(get=lambda via: recencia_no_instante(recencia.get(via), minutos))
                    if recencia is not None else None)
    route.assign_lia_weights(
        st.model, st.encoder, st.profiles, G, primeira.hour, primeira.weekday(), rec_primeira, transfer_confidence,
        contexto_obj.para_requisicao(primeira, recencia, max(minutos, 0.0)) if contexto_obj is not None else None,
    )
    t_pesos = time.perf_counter()
    tracado = _tracar(G, pontas_o, pontas_d)
    nos = tracado.nos if tracado is not None else _caminho(G, orig, dest)
    t_astar = time.perf_counter()
    _, distancia_m, cobertura = route._resumir_caminho(G, nos)
    polyline, t_pontas = route.montar_polyline(G, nos), 0.0
    if tracado is not None:
        polyline, _, t_pontas, m_pontas = route.juntar_pontas(G, tracado, polyline, route.niveis_lia(G, nos))
        distancia_m += m_pontas
        if distancia_m < route.DISTANCIA_MIN_M:
            raise HTTPException(status_code=422, detail="Origem e destino estão perto demais para traçar uma rota.")
    saidas = [primeira + timedelta(minutes=k * body.passo_min) for k in range(body.janelas)]
    niveis_arestas: List[List[Optional[int]]] = []
    tempos, livre = tempos_por_saida(st.model, st.encoder, st.profiles, G, nos, saidas, agora, recencia,
                                     transfer_confidence, contexto_obj, niveis_arestas)
    tempos, livre = tempos + t_pontas, livre + t_pontas
    trafego = [_niveis_na_polyline(G, nos, n, len(polyline)) for n in niveis_arestas]
    melhor = int(np.argmin(tempos))
    fim = time.perf_counter()
    # Sem coordenadas no log (LGPD): só tamanho, resultado e tempo por fase.
    logger.info(f"Horários: {len(nos)} nós, {len(saidas)} saídas de {body.passo_min} min, melhor #{melhor} | ms "
                f"pesos={(t_pesos - t0) * 1000:.0f} astar={(t_astar - t_pesos) * 1000:.0f} "
                f"saidas={(fim - t_astar) * 1000:.0f} total={(fim - t0) * 1000:.0f}")
    return HorariosOutput(
        horarios=[Horario(saida=s, tempo_seg=int(round(t)), trafego=n) for s, t, n in zip(saidas, tempos, trafego)],
        polyline=polyline,
        melhor=melhor,
        distancia_km=round(distancia_m / 1000, 2),
        tempo_livre_seg=int(round(livre)),
        lia_cobertura_pct=round(cobertura, 2),
        mesmo_trajeto=True,
        modelo_utilizado=st.model_version,
    )
