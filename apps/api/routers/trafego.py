"""
GET /trafego/agora: trânsito agora nos pontos monitorados (tela "Trânsito" do app).
GET /trafego/ponto/{id}: visão geral e histórico de um ponto (painel lateral da mesma tela).

Para cada ponto: a previsão da LIA para este instante (com a leitura mais recente como feature, igual à rota), o
nível 0–3 da mesma régua da rota, há quanto tempo veio a última leitura e o nome da via (da aresta do OSM ligada ao
ponto). Sem TomTom e sem dado pessoal; uma chamada só do modelo para todos os pontos e 60 s de cache, então o custo
não cresce com o número de pessoas olhando.
"""
import asyncio
import logging
import math
import time
from datetime import datetime
from typing import Dict, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Path, Request

import lia_inference as lia_inf
import tomtom
from lia_inference import nivel_da_razao
from openapi import erro
from seguranca import Limitador, ip_cliente, limitar

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/trafego", tags=["Roteamento"])

TTL_S = 60.0
_limite_ip = Limitador(30)
_cache: dict = {'t': -math.inf, 'dados': None}
_limite_ponto = Limitador(60)
_cache_ponto = tomtom.CacheTTL(300, max_itens=1024)
PAGINA, MAX_PAGINAS = 1000, 8  # ~2.600 linhas por ponto hoje; o teto segura o custo se o histórico crescer
ULTIMOS_DIAS, ULTIMAS_LEITURAS = 14, 12


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


def _ler_historico(sb, id_ponto: int) -> pd.DataFrame:
    """Leituras do ponto, da mais nova para a mais antiga, por chave (OFFSET fundo estoura o timeout do Supabase)."""
    linhas, ultimo = [], None
    for _ in range(MAX_PAGINAS):
        q = (sb.table('historico_trafego').select('id_coleta, velocidade_atual, velocidade_livre, tempo_viagem_segundos, data_hora_coleta')
             .eq('id_ponto', id_ponto).order('id_coleta', desc=True).limit(PAGINA))
        if ultimo is not None:
            q = q.lt('id_coleta', ultimo)
        dados = q.execute().data or []
        linhas += dados
        if len(dados) < PAGINA:
            break
        ultimo = dados[-1]['id_coleta']
    return pd.DataFrame(linhas)


def _num(v, casas=3) -> Optional[float]:
    return None if v is None or pd.isna(v) else round(float(v), casas)


def resumir_historico(df: pd.DataFrame) -> dict:
    """Perfil por hora e por dia da semana (mediana da razão), últimos dias e últimas leituras, em hora de Brasília."""
    if df.empty:
        return {'n_leituras': 0, 'primeira_leitura': None, 'ultima_leitura': None,
                'por_hora': [{'hora': h, 'razao': None, 'n': 0} for h in range(24)],
                'por_dia_semana': [{'dia': d, 'razao': None, 'n': 0} for d in range(7)],
                'ultimos_dias': [], 'ultimas': []}
    d = df.copy()
    d['em'] = pd.to_datetime(d['data_hora_coleta'], utc=True, format='ISO8601').dt.tz_convert('America/Sao_Paulo')
    for c in ('velocidade_atual', 'velocidade_livre', 'tempo_viagem_segundos'):
        d[c] = pd.to_numeric(d[c], errors='coerce')
    d = d[(d['velocidade_livre'] > 0) & d['velocidade_atual'].notna()].sort_values('em')
    d['razao'] = (d['velocidade_atual'] / d['velocidade_livre']).clip(lia_inf.RAZAO_MIN, lia_inf.RAZAO_MAX)

    def perfil(chave, valores, nome):
        g = d.groupby(chave)['razao'].agg(['median', 'size'])
        return [{nome: int(v), 'razao': _num(g['median'].get(v)), 'n': int(g['size'].get(v, 0))} for v in valores]

    d['dia'] = d['em'].dt.strftime('%Y-%m-%d')
    dias = d.groupby('dia').agg(razao=('razao', 'mean'), vel=('velocidade_atual', 'mean'), n=('razao', 'size')).tail(ULTIMOS_DIAS)
    return {
        'n_leituras': int(len(d)),
        'primeira_leitura': d['em'].iloc[0].isoformat(timespec='minutes') if len(d) else None,
        'ultima_leitura': d['em'].iloc[-1].isoformat(timespec='minutes') if len(d) else None,
        'por_hora': perfil(d['em'].dt.hour, range(24), 'hora'),
        'por_dia_semana': perfil(d['em'].dt.dayofweek, range(7), 'dia'),
        'ultimos_dias': [{'dia': i, 'razao': _num(r.razao), 'vel_kmh': _num(r.vel, 1), 'n': int(r.n)} for i, r in dias.iterrows()],
        'ultimas': [{'em': r.em.isoformat(timespec='minutes'), 'vel_kmh': _num(r.velocidade_atual, 1),
                     'vel_livre_kmh': _num(r.velocidade_livre, 1), 'razao': _num(r.razao), 'tempo_s': _num(r.tempo_viagem_segundos, 0)}
                    for r in d.tail(ULTIMAS_LEITURAS).iloc[::-1].itertuples()],
    }


@router.get(
    "/ponto/{id_ponto}",
    summary="Visão geral e histórico de um ponto monitorado",
    description="Nível de agora (mesma previsão do `/trafego/agora`) e o histórico do banco: mediana da razão velocidade "
                "atual / livre por hora e por dia da semana, últimos 14 dias e últimas 12 leituras. Atualiza a cada 5 min. "
                "Público, sem dado pessoal. Limite: 60/min por IP.",
    responses={404: erro("Ponto não monitorado.", "Ponto não encontrado."),
               429: erro("Limite por IP excedido.", "Muitas requisições. Tente de novo em instantes."),
               503: erro("Banco indisponível.", "Histórico indisponível no momento.")},
)
async def detalhe_ponto(request: Request, id_ponto: int = Path(..., ge=1, le=2_000_000_000)):
    limitar(_limite_ponto, ip_cliente(request))
    st = request.app.state
    G = st.graph
    vias = G.graph.get('vias_monitoradas') or {}
    if id_ponto not in vias:
        raise HTTPException(status_code=404, detail="Ponto não encontrado.")
    guardado = _cache_ponto.get(id_ponto)
    if guardado is None:
        sb = getattr(st, 'supabase', None)
        if sb is None:
            raise HTTPException(status_code=503, detail="Histórico indisponível no momento.")
        try:
            df = await asyncio.to_thread(_ler_historico, sb, id_ponto)
        except Exception as e:  # o motivo fica no log; o cliente só precisa saber que não veio
            logger.warning(f"Histórico do ponto {id_ponto}: {type(e).__name__}")
            raise HTTPException(status_code=503, detail="Histórico indisponível no momento.")
        guardado = resumir_historico(df)
        _cache_ponto.set(id_ponto, guardado)
    agora = time.monotonic()
    if _cache['dados'] is None or agora - _cache['t'] >= TTL_S:
        _cache['dados'], _cache['t'] = calcular(st), agora
    ponto = next((p for p in _cache['dados']['pontos'] if p['id'] == id_ponto), None)
    lat, lon = vias[id_ponto]
    if 'nomes_vias' not in G.graph:
        G.graph['nomes_vias'] = nomes_das_vias(G)
    livre = (G.graph.get('vel_livre_tomtom') or {}).get(id_ponto)
    return {'id': id_ponto, 'nome': G.graph['nomes_vias'].get(id_ponto), 'lat': round(float(lat), 5), 'lon': round(float(lon), 5),
            'vel_livre_kmh': _num(livre, 1),
            'agora': {k: ponto[k] for k in ('razao', 'nivel', 'leitura_ha_min')} if ponto else None,
            'historico': guardado}
