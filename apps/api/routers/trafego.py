"""
GET /trafego/agora — trânsito agora nos pontos monitorados (tela "Trânsito agora" do app).

Para cada ponto: a previsão da LIA para este instante (com a leitura mais recente como feature, igual à rota), o
nível 0–3 da mesma régua da rota, há quanto tempo veio a última leitura e o nome da via (da aresta do OSM ligada ao
ponto). Sem TomTom e sem dado pessoal; uma chamada só do modelo para todos os pontos e 60 s de cache, então o custo
não cresce com o número de pessoas olhando.
"""
import math
import time
from datetime import datetime
from typing import Dict, Optional

import numpy as np
from fastapi import APIRouter, Request

import lia_inference as lia_inf
from lia_inference import nivel_da_razao
from openapi import erro
from seguranca import Limitador, ip_cliente, limitar

router = APIRouter(prefix="/trafego", tags=["Roteamento"])

TTL_S = 60.0
_limite_ip = Limitador(30)
_cache: dict = {'t': -math.inf, 'dados': None}


def nomes_das_vias(G) -> Dict[int, str]:
    """Nome de cada ponto monitorado: o da aresta mais próxima ligada a ele (só arestas com nome)."""
    melhor: Dict[int, tuple] = {}
    for _, _, d in G.edges(data=True):
        via, nome = d.get('id_ponto_lia'), d.get('name')
        if via is None or not nome:
            continue
        nome = nome[0] if isinstance(nome, list) else nome
        dist = float(d.get('dist_lia_m') or 0.0)
        if via not in melhor or dist < melhor[via][0]:
            melhor[via] = (dist, str(nome)[:80])
    return {via: nome for via, (_, nome) in melhor.items()}


def calcular(state, agora: Optional[datetime] = None) -> dict:
    G = state.graph
    vias = G.graph.get('vias_monitoradas') or {}
    encoder, model, profiles = state.encoder, state.model, state.profiles
    recencia = getattr(state, 'recencia_cache', None)
    contexto = getattr(state, 'contexto', None)
    agora = agora or datetime.now(lia_inf.BRASILIA_TZ)
    hora, dia = agora.hour, agora.weekday()
    ctx = contexto.para_requisicao(agora, recencia) if contexto is not None else None
    vel_tomtom = G.graph.get('vel_livre_tomtom') or {}
    if 'nomes_vias' not in G.graph:
        G.graph['nomes_vias'] = nomes_das_vias(G)
    nomes = G.graph['nomes_vias']

    conhecidas = set(encoder.classes_.tolist())
    ids = sorted(v for v in vias if v in conhecidas)
    if not ids:
        return {'atualizado_em': agora.isoformat(timespec='seconds'), 'pontos': [], 'resumo': {}}
    ordem = lia_inf.ordem_features(model)
    leituras = {v: (recencia.get(v) if recencia is not None else None) for v in ids}
    linhas = [lia_inf.montar_features(int(enc), hora, dia, float(vel_tomtom.get(v, 50.0)),
                                      lia_inf.lookup_perfis(profiles, v, hora, dia), leituras[v],
                                      ctx(v) if ctx else None, ordem)
              for v, enc in zip(ids, encoder.transform(ids))]
    razoes = np.clip(model.predict(np.asarray(linhas, dtype=float)), lia_inf.RAZAO_MIN, lia_inf.RAZAO_MAX)

    pontos, resumo = [], {'livre': 0, 'moderado': 0, 'lento': 0, 'parado': 0}
    rotulos = ('livre', 'moderado', 'lento', 'parado')
    for v, r in zip(ids, razoes.tolist()):
        nivel = nivel_da_razao(r)
        resumo[rotulos[nivel]] += 1
        leitura = leituras[v]
        idade = round(math.expm1(leitura['delta_min_lag1'])) if leitura and leitura.get('delta_min_lag1') is not None else None
        lat, lon = vias[v]
        pontos.append({'id': int(v), 'lat': round(float(lat), 5), 'lon': round(float(lon), 5), 'nome': nomes.get(v),
                       'razao': round(r, 3), 'nivel': nivel, 'leitura_ha_min': idade})
    pontos.sort(key=lambda p: p['razao'])
    return {'atualizado_em': agora.isoformat(timespec='seconds'), 'modelo': getattr(state, 'model_version', None),
            'pontos': pontos, 'resumo': resumo}


@router.get(
    "/agora",
    summary="Trânsito agora nos pontos monitorados",
    description="Previsão da LIA para este instante em cada ponto monitorado (razão velocidade atual / livre, "
                "nível 0 livre … 3 parado), a idade da última leitura e o nome da via; do mais lento para o mais "
                "livre. Atualiza a cada 60 s. Público, sem dado pessoal. Limite: 30/min por IP.",
    responses={429: erro("Limite por IP excedido.", "Muitas requisições. Tente de novo em instantes.")},
)
async def transito_agora(request: Request):
    limitar(_limite_ip, ip_cliente(request))
    agora = time.monotonic()
    if _cache['dados'] is None or agora - _cache['t'] >= TTL_S:
        _cache['dados'], _cache['t'] = calcular(request.app.state), agora
    return _cache['dados']
