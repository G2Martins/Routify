"""
Features de contexto da LIA 2.2 — UMA implementação, usada pelo treino
(ml/features.py importa este módulo) e pela API. Mesmo código dos dois lados
elimina por construção a divergência treino × produção.

  vizinhos_razao · vizinhos_n  congestionamento recente das vias monitoradas
                               mais próximas (k=5, ≤ 3 km), última leitura de
                               cada uma nos 60 min ANTES do instante previsto
  chuva_mm · chuva_3h_mm       chuva registrada na hora cheia anterior e nas 3
                               últimas horas (Open-Meteo; cada rótulo horário
                               H traz a chuva de H-1 a H — nada do futuro)
  is_feriado                   feriado nacional (BrasilAPI) + distritais do DF

Sem o dado: vizinhos vão como NaN/0 (o XGBoost aprendeu esse ramo nos 5,4%
de linhas sem vizinho recente, buracos da coleta); chuva vai como 0 (seco, a
moda). O treino nunca viu chuva ausente: NaN piora o erro (ml/context_stress_test.py).
"""
import json
import logging
import math
import os
import time
from datetime import date, datetime, timedelta
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

CONTEXT_FEATURES = ['vizinhos_razao', 'vizinhos_n', 'chuva_mm', 'chuva_3h_mm', 'is_feriado']

K_VIZINHOS = 5
RAIO_VIZINHOS_M = 3000.0
JANELA_VIZINHOS_MIN = 60.0
CENTRO_CHUVA = (-15.793, -47.882)  # ponto único (Plano Piloto) — ponytail: grade por região se a chuva local importar

# Distritais do DF (Lei Orgânica / Lei 963/1995) que a BrasilAPI (nacionais) não traz.
FERIADOS_DF = {'04-21': 'Fundação de Brasília', '11-30': 'Dia do Evangélico'}

RAIO_TERRA_M = 6_371_000.0


# --- Vizinhos --------------------------------------------------------------
def vizinhos_monitorados(coords: Dict[int, Tuple[float, float]], k: int = K_VIZINHOS,
                         raio_m: float = RAIO_VIZINHOS_M) -> Dict[int, List[int]]:
    """Para cada via monitorada, as k mais próximas (sem ela mesma) dentro do raio."""
    from sklearn.neighbors import BallTree
    ids = list(coords)
    if len(ids) < 2:
        return {i: [] for i in ids}
    pts = np.radians(np.array([coords[i] for i in ids], dtype=float))
    arvore = BallTree(pts, metric='haversine')
    dist, idx = arvore.query(pts, k=min(k + 1, len(ids)))
    saida = {}
    for linha, (ds, js) in enumerate(zip(dist, idx)):
        saida[ids[linha]] = [ids[j] for d, j in zip(ds, js)
                             if j != linha and d * RAIO_TERRA_M <= raio_m][:k]
    return saida


def media_vizinhos(razoes: Iterable[Optional[float]]) -> Tuple[float, int]:
    """(média das razões válidas, quantas). Nenhuma válida → (NaN, 0)."""
    validas = [float(r) for r in razoes if r is not None and r == r]
    return (float(np.mean(validas)), len(validas)) if validas else (float('nan'), 0)


# --- Chuva -----------------------------------------------------------------
def chuva_no_instante(horaria: Dict[datetime, float], instante: datetime) -> Tuple[float, float]:
    """(chuva do rótulo da hora cheia, soma dos 3 últimos rótulos) no horário local.

    `horaria`: {datetime local ingênuo na hora cheia: mm}. O rótulo H cobre H-1→H,
    então às 08:20 usa-se o rótulo 08:00 — só passado.
    """
    h = instante.replace(minute=0, second=0, microsecond=0, tzinfo=None)
    atual = horaria.get(h)
    ultimas = [horaria.get(h - timedelta(hours=i)) for i in range(3)]
    soma = float(sum(v for v in ultimas if v is not None)) if any(v is not None for v in ultimas) else float('nan')
    return (float(atual) if atual is not None else float('nan')), soma


def carregar_chuva_openmeteo(resposta: dict) -> Dict[datetime, float]:
    """Converte o JSON horário do Open-Meteo (timezone local) em {hora: mm}."""
    h = resposta.get('hourly') or {}
    return {datetime.fromisoformat(t): float(v) for t, v in zip(h.get('time', []), h.get('precipitation', []))
            if v is not None}


# --- Feriados --------------------------------------------------------------
def carregar_feriados(caminho: str) -> set:
    """Datas de feriado (nacionais do arquivo + distritais do DF nos mesmos anos)."""
    if not os.path.exists(caminho):
        return set()
    with open(caminho, encoding='utf-8') as f:
        dados = json.load(f)
    datas = {date.fromisoformat(d['date']) for d in dados.get('feriados', [])}
    for ano in {d.year for d in datas}:
        for mmdd in FERIADOS_DF:
            datas.add(date.fromisoformat(f'{ano}-{mmdd}'))
    return datas


def is_feriado(dia: date, feriados: set) -> int:
    return int(dia in feriados)


# --- Montagem --------------------------------------------------------------
def contexto_global(instante_local: datetime, chuva_horaria: Dict[datetime, float], feriados: set) -> Dict[str, float]:
    """Parte do contexto que vale para a cidade inteira no instante."""
    mm, mm3 = chuva_no_instante(chuva_horaria, instante_local)
    return {'chuva_mm': mm, 'chuva_3h_mm': mm3, 'is_feriado': is_feriado(instante_local.date(), feriados)}


def precisa_contexto(ordem_features: Sequence[str]) -> bool:
    return any(c in ordem_features for c in CONTEXT_FEATURES)


# --- Ao vivo (API) ---------------------------------------------------------
URL_PREVISAO = 'https://api.open-meteo.com/v1/forecast'
TTL_CHUVA_S = 15 * 60  # ≤ 96 chamadas/dia: longe do limite free do Open-Meteo (10 mil/dia)


class ContextoAoVivo:
    """Contexto da inferência com as mesmas regras do treino: chuva recente
    (previsão Open-Meteo, horas passadas), vizinhos (cache de recência da API,
    que recebe as leituras TomTom sob demanda) e feriados."""

    def __init__(self, caminho_vizinhos: str, caminho_feriados: str):
        with open(caminho_vizinhos, encoding='utf-8') as f:
            dados = json.load(f)
        self.vizinhos = {int(p): [int(q) for q in vs] for p, vs in dados['vizinhos'].items()}
        self.janela_min = float(dados.get('janela_min', JANELA_VIZINHOS_MIN))
        self.feriados = carregar_feriados(caminho_feriados)
        self.chuva: Dict[datetime, float] = {}
        self.chuva_em: Optional[float] = None
        self._proxima = 0.0

    async def atualizar_chuva(self) -> None:
        agora = time.time()
        if agora < self._proxima:
            return
        self._proxima = agora + TTL_CHUVA_S  # antes do await: 1 tentativa por janela, mesmo falhando
        try:
            import httpx
            async with httpx.AsyncClient(timeout=4) as cli:
                r = await cli.get(URL_PREVISAO, params={
                    'latitude': CENTRO_CHUVA[0], 'longitude': CENTRO_CHUVA[1], 'hourly': 'precipitation',
                    'past_days': 1, 'forecast_days': 1, 'timezone': 'America/Sao_Paulo'})
                r.raise_for_status()
                self.chuva = carregar_chuva_openmeteo(r.json())
                self.chuva_em = agora
        except Exception as e:
            logging.warning(f"Open-Meteo indisponível ({type(e).__name__}); chuva vai como 0")

    def para_requisicao(self, instante_local: datetime, recencia=None) -> Callable[[int], Dict[str, float]]:
        """Parte global calculada uma vez; devolve via → features de contexto."""
        base = contexto_global(instante_local, self.chuva, self.feriados)
        for k in ('chuva_mm', 'chuva_3h_mm'):
            if base[k] != base[k]:
                base[k] = 0.0

        def da_via(via: int) -> Dict[str, float]:
            razoes = [recencia.razao_recente(q, self.janela_min) for q in self.vizinhos.get(via, [])] \
                if recencia is not None else []
            m, n = media_vizinhos(razoes)
            return {**base, 'vizinhos_razao': m, 'vizinhos_n': n}
        return da_via

    def resumo(self) -> Dict[str, object]:
        return {
            'chuva_horas': len(self.chuva),
            'chuva_atualizada_em': datetime.fromtimestamp(self.chuva_em).astimezone().isoformat() if self.chuva_em else None,
            'feriados': len(self.feriados),
        }


if __name__ == '__main__':
    # Autoteste das regras (sem rede).
    coords = {1: (-15.80, -47.90), 2: (-15.801, -47.90), 3: (-15.90, -47.90)}
    viz = vizinhos_monitorados(coords, k=5, raio_m=3000)
    assert viz[1] == [2] and viz[3] == []  # 3 está a ~11 km: fora do raio
    assert media_vizinhos([0.5, None, float('nan'), 0.7]) == (0.6, 2)
    m, n = media_vizinhos([])
    assert n == 0 and m != m
    chuva = {datetime(2026, 3, 10, 6): 1.0, datetime(2026, 3, 10, 7): 2.0, datetime(2026, 3, 10, 8): 4.0,
             datetime(2026, 3, 10, 9): 99.0}
    assert chuva_no_instante(chuva, datetime(2026, 3, 10, 8, 20)) == (4.0, 7.0)  # nunca o rótulo 09:00
    assert math.isnan(chuva_no_instante({}, datetime(2026, 3, 10, 8))[0])
    fer = {date(2026, 4, 21)}
    assert is_feriado(date(2026, 4, 21), fer) == 1 and is_feriado(date(2026, 4, 22), fer) == 0
    print('contexto ok')
