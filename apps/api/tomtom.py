"""
TomTom sob demanda — complementa a LIA na hora da requisição.

Fase final do TCC 2: a coleta contínua parou. Em vez de varrer 630 pontos a
cada 8 min, a API consulta só o que a rota pede:

  - Flow Segment Data (v4): recência ao vivo das vias monitoradas do corredor
    origem→destino cuja última observação está velha. Mesma chamada
    (relative0/10) que gerou o dataset de treino — mesma distribuição.
  - Incident Details (v5): via interditada no corredor sai do A*; os demais
    incidentes voltam como alerta informativo.
  - Routing (v1, opcional): ETA de referência com trânsito ao vivo.
  - Search (v2): fallback do autocomplete, antes do Nominatim.

A cota free é mensal e POR API (docs.tomtom.com/pricing, set/2026): Flow 20k,
Incidents 2,5k, Search 2,5k, Routing 20k. Por isso o cooldown é por
(chave, serviço) — esgotar Incidents numa chave não tira o Flow dela.
Sem chave, todas em cooldown ou orçamento do minuto estourado = modo
degradado: a rota sai só com a LIA, nunca erro pro usuário.
"""
import json
import logging
import math
import os
import time
from collections import deque
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import quote

import httpx
import numpy as np

from lia_inference import RAZAO_MAX, RAZAO_MIN

logger = logging.getLogger(__name__)

BASE_URL = 'https://api.tomtom.com'
ARQUIVO_CHAVES = os.path.join(os.path.dirname(__file__), '..', '..', 'services', 'collector', 'config', 'tomtom_keys.json')
SERVICOS = ('fluxo', 'incidentes', 'busca', 'rota')

# Cooldown por (chave, serviço), em segundos. Cota: janela rolante de 24 h —
# com cota mensal, vira uma re-sondagem diária barata (1 chamada por chave).
COOLDOWN_COTA_S = 24 * 3600
COOLDOWN_QPS_S = 2
COOLDOWN_CHAVE_S = 600  # 403 sem texto de cota: chave inválida/proibida
# A TomTom devolve 429 tanto pra QPS quanto pra cota esgotada. Sem texto que
# desempate, 429 seguidos na mesma chave/serviço viram cota.
STRIKES_429_PARA_COTA = 3
PALAVRAS_COTA = ('quota', 'over rate', 'limit exceeded', 'insufficient', 'credits', 'inactive')

# Teto global de chamadas por minuto. Sem auth na API ainda, é o que impede um
# cliente hostil de queimar a cota do pool inteiro.
MAX_CHAMADAS_MIN = int(os.getenv('TOMTOM_MAX_CHAMADAS_MIN', '120'))
TIMEOUT_S = 4.0
TENTATIVAS = 3

CAMPOS_INCIDENTES = ('{incidents{type,geometry{type,coordinates},properties{iconCategory,'
                     'magnitudeOfDelay,events{description,code},from,to,length,delay}}}')
ICONE_INTERDICAO = 8
NOMES_INCIDENTE = {
    0: 'Desconhecido', 1: 'Acidente', 2: 'Neblina', 3: 'Condição perigosa', 4: 'Chuva',
    5: 'Gelo', 6: 'Congestionamento', 7: 'Faixa interditada', 8: 'Via interditada',
    9: 'Obras', 10: 'Vento', 11: 'Alagamento', 14: 'Veículo quebrado',
}
CENTRO_BRASILIA = (-15.793, -47.882)


def carregar_chaves() -> List[Dict[str, str]]:
    """TOMTOM_API_KEYS (vírgula — deploy/secrets) ou o tomtom_keys.json do coletor (dev)."""
    env = os.getenv('TOMTOM_API_KEYS', '').strip()
    if env:
        return [{'id': f'key_{i:02d}', 'key': k.strip()}
                for i, k in enumerate(env.split(','), 1) if k.strip()]
    try:
        with open(os.getenv('TOMTOM_KEYS_FILE', ARQUIVO_CHAVES), encoding='utf-8') as f:
            return [c for c in json.load(f).get('tomtom_keys', []) if c.get('id') and c.get('key')]
    except (OSError, ValueError) as e:
        logger.warning(f"TomTom: nenhuma chave carregada ({type(e).__name__})")
        return []


def classificar_erro(status: int, corpo: str) -> Optional[str]:
    """Motivo pelo qual a CHAVE deve sair do rodízio, ou None se o erro não é dela."""
    texto = (corpo or '').lower()
    if status in (403, 429) and any(p in texto for p in PALAVRAS_COTA):
        return 'cota'
    if status == 429 or 'qps' in texto:
        return 'qps'
    if status in (401, 403):
        return 'chave'
    return None


class KeyPool:
    """Rodízio de chaves com cooldown por (chave, serviço).

    Não é thread-safe por desenho: roda no event loop do worker e nenhum método
    faz await (mesmo raciocínio do RecenciaCache).
    """

    def __init__(self, chaves: Sequence[Dict[str, str]]):
        self._chaves = list(chaves)
        self._pos: Dict[str, int] = {}
        self._cooldown: Dict[Tuple[str, str], float] = {}
        self._strikes: Dict[Tuple[str, str], int] = {}
        self.chamadas = {c['id']: 0 for c in self._chaves}
        self.falhas = {c['id']: 0 for c in self._chaves}
        self.pausadas: set = set()  # ids pausados pelo painel ADM (config_runtime)

    @property
    def total(self) -> int:
        return len(self._chaves)

    def _livre(self, chave_id: str, servico: str, agora: float) -> bool:
        return chave_id not in self.pausadas and self._cooldown.get((chave_id, servico), 0.0) <= agora

    def disponiveis(self, servico: str) -> int:
        agora = time.time()
        return sum(self._livre(c['id'], servico, agora) for c in self._chaves)

    def proxima(self, servico: str) -> Optional[Dict[str, str]]:
        """Próxima chave livre pro serviço, em rodízio — espalha QPS e cota."""
        agora = time.time()
        n = len(self._chaves)
        inicio = self._pos.get(servico, 0)
        for passo in range(n):
            i = (inicio + passo) % n
            chave = self._chaves[i]
            if self._livre(chave['id'], servico, agora):
                self._pos[servico] = (i + 1) % n
                return chave
        return None

    def por_id(self, chave_id: str) -> Optional[Dict[str, str]]:
        return next((c for c in self._chaves if c['id'] == chave_id), None)

    def zerar(self) -> None:
        """Devolve todas as chaves ao rodízio (ação do painel ADM)."""
        self._cooldown.clear()
        self._strikes.clear()

    def estado(self) -> List[dict]:
        """Situação por chave para o painel — só ids e contadores, nunca o valor."""
        agora = time.time()
        return [{
            'id': c['id'],
            'pausada': c['id'] in self.pausadas,
            'chamadas': self.chamadas[c['id']],
            'falhas': self.falhas[c['id']],
            'servicos': {s: {
                'livre': self._cooldown.get((c['id'], s), 0.0) <= agora,
                'volta_em_s': max(0, int(self._cooldown.get((c['id'], s), 0.0) - agora)),
                'strikes': self._strikes.get((c['id'], s), 0),
            } for s in SERVICOS},
        } for c in self._chaves]

    def sucesso(self, chave_id: str, servico: str) -> None:
        self.chamadas[chave_id] += 1
        self._strikes.pop((chave_id, servico), None)

    def falha(self, chave_id: str, servico: str, motivo: str) -> None:
        self.chamadas[chave_id] += 1
        self.falhas[chave_id] += 1
        par = (chave_id, servico)
        if motivo == 'qps':
            self._strikes[par] = self._strikes.get(par, 0) + 1
            if self._strikes[par] >= STRIKES_429_PARA_COTA:
                motivo = 'cota'
        segundos = {'qps': COOLDOWN_QPS_S, 'cota': COOLDOWN_COTA_S, 'chave': COOLDOWN_CHAVE_S}[motivo]
        self._cooldown[par] = time.time() + segundos
        if motivo != 'qps':
            # Só o id — o valor da chave nunca vai pro log.
            logger.warning(f"TomTom: chave [{chave_id}] fora do rodízio de '{servico}' "
                           f"por {segundos / 3600:.1f} h ({motivo})")


class _Orcamento:
    """Janela deslizante de 60 s com teto de chamadas."""

    def __init__(self, maximo: int):
        self.maximo = maximo
        self._instantes: deque = deque()

    def permitir(self) -> bool:
        agora = time.monotonic()
        while self._instantes and agora - self._instantes[0] > 60:
            self._instantes.popleft()
        if len(self._instantes) >= self.maximo:
            return False
        self._instantes.append(agora)
        return True


class CacheTTL:
    """Dict com expiração e teto de itens (descarta o mais antigo)."""

    def __init__(self, ttl_s: float, max_itens: int = 512):
        self.ttl_s = ttl_s
        self.max_itens = max_itens
        self._dados: Dict = {}

    def get(self, chave):
        item = self._dados.get(chave)
        if item is None or item[0] < time.monotonic():
            return None
        return item[1]

    def set(self, chave, valor) -> None:
        if chave not in self._dados and len(self._dados) >= self.max_itens:
            self._dados.pop(next(iter(self._dados)))
        self._dados[chave] = (time.monotonic() + self.ttl_s, valor)


class TomTomClient:
    def __init__(self, chaves: Sequence[Dict[str, str]],
                 transport: Optional[httpx.AsyncBaseTransport] = None,
                 max_chamadas_min: int = MAX_CHAMADAS_MIN):
        self.pool = KeyPool(chaves)
        self._orcamento = _Orcamento(max_chamadas_min)
        self._http = httpx.AsyncClient(base_url=BASE_URL, timeout=TIMEOUT_S, transport=transport)
        self._cache_incidentes = CacheTTL(300)
        self._cache_busca = CacheTTL(24 * 3600, max_itens=2048)
        self.habilitado = True  # kill switch / modo só-LIA do painel ADM
        self._reset_aplicado = None

    @property
    def ativo(self) -> bool:
        return self.pool.total > 0 and self.habilitado

    def resumo(self) -> dict:
        return {'ativo': self.ativo, 'chaves': self.pool.total,
                'disponiveis': {s: self.pool.disponiveis(s) for s in SERVICOS}}

    def aplicar_config(self, cfg: dict) -> None:
        """Aplica as flags de config_runtime (ver config_runtime.py)."""
        self.habilitado = bool(cfg.get('tomtom_ativo', True)) and not cfg.get('modo_so_lia', False)
        try:
            self._orcamento.maximo = min(max(int(cfg.get('tomtom_orcamento_min') or MAX_CHAMADAS_MIN), 1), 600)
        except (TypeError, ValueError):
            pass
        self.pool.pausadas = {str(i) for i in (cfg.get('tomtom_chaves_pausadas') or [])}
        reset = cfg.get('tomtom_reset_em')
        if reset and reset != self._reset_aplicado:
            self.pool.zerar()
            self._reset_aplicado = reset

    def estado(self) -> dict:
        return {'habilitado': self.habilitado, 'orcamento_min': self._orcamento.maximo,
                'chamadas_ultimo_min': len(self._orcamento._instantes), 'chaves': self.pool.estado()}

    async def testar_chave(self, chave_id: str) -> Optional[dict]:
        """Uma chamada de Flow com a chave pedida (gasta 1 requisição da cota dela).
        None se o id não existe. Atualiza o rodízio com o resultado."""
        chave = self.pool.por_id(chave_id)
        if chave is None:
            return None
        inicio = time.perf_counter()
        try:
            resp = await self._http.get('/traffic/services/4/flowSegmentData/relative0/10/json',
                                        params={'point': '-15.793889,-47.882778', 'unit': 'kmph', 'key': chave['key']})
        except httpx.HTTPError as e:
            return {'ok': False, 'status': None, 'motivo': type(e).__name__, 'latencia_ms': None}
        latencia = int((time.perf_counter() - inicio) * 1000)
        if resp.status_code == 200:
            self.pool.sucesso(chave_id, 'fluxo')
            return {'ok': True, 'status': 200, 'motivo': None, 'latencia_ms': latencia}
        motivo = classificar_erro(resp.status_code, resp.text[:500])
        if motivo:
            self.pool.falha(chave_id, 'fluxo', motivo)
        return {'ok': False, 'status': resp.status_code, 'motivo': motivo, 'latencia_ms': latencia}

    async def fechar(self) -> None:
        await self._http.aclose()

    async def _get(self, servico: str, caminho: str, params: dict,
                   corpo: Optional[dict] = None) -> Optional[dict]:
        """GET (ou POST, se vier `corpo`) com rodízio de chaves e orçamento."""
        for _ in range(min(TENTATIVAS, max(self.pool.total, 1))):
            chave = self.pool.proxima(servico)
            if chave is None:
                return None  # todas em cooldown pra este serviço
            if not self._orcamento.permitir():
                logger.warning('TomTom: orçamento do minuto esgotado — modo degradado')
                return None
            try:
                consulta = {**params, 'key': chave['key']}
                resp = await (self._http.post(caminho, params=consulta, json=corpo) if corpo is not None
                              else self._http.get(caminho, params=consulta))
            except httpx.HTTPError as e:
                # Nunca logar str(e): a URL da requisição carrega a chave.
                logger.warning(f"TomTom {servico}: falha de rede ({type(e).__name__})")
                return None
            if resp.status_code == 200:
                self.pool.sucesso(chave['id'], servico)
                try:
                    return resp.json()
                except ValueError:
                    return None
            motivo = classificar_erro(resp.status_code, resp.text[:500])
            if motivo is None:
                self.pool.chamadas[chave['id']] += 1
                logger.warning(f"TomTom {servico}: HTTP {resp.status_code}")
                return None
            self.pool.falha(chave['id'], servico, motivo)
        return None

    async def fluxo(self, lat: float, lon: float) -> Optional[dict]:
        dados = await self._get('fluxo', '/traffic/services/4/flowSegmentData/relative0/10/json',
                                {'point': f'{lat:.6f},{lon:.6f}', 'unit': 'kmph'})
        return (dados or {}).get('flowSegmentData')

    async def incidentes(self, bbox: Tuple[float, float, float, float]) -> List[dict]:
        em_cache = self._cache_incidentes.get(bbox)
        if em_cache is not None:
            return em_cache
        dados = await self._get('incidentes', '/traffic/services/5/incidentDetails', {
            'bbox': ','.join(f'{x:.4f}' for x in bbox),
            'fields': CAMPOS_INCIDENTES,
            'language': 'pt-PT',  # pt-BR não consta na lista do Incident Details
            'timeValidityFilter': 'present',
        })
        if dados is None:
            return []  # falha não entra no cache
        lista = dados.get('incidents') or []
        self._cache_incidentes.set(bbox, lista)
        return lista

    async def rota_referencia(self, origem: Tuple[float, float],
                              destino: Tuple[float, float]) -> Optional[dict]:
        """Rota da TomTom com trânsito ao vivo: ETA + polilinha (a geometria já vem
        na resposta padrão). 1 chamada de Routing."""
        pontos = f'{origem[0]:.6f},{origem[1]:.6f}:{destino[0]:.6f},{destino[1]:.6f}'
        dados = await self._get('rota', f'/routing/1/calculateRoute/{pontos}/json', {
            'traffic': 'true', 'travelMode': 'car', 'routeType': 'fastest',
            'departAt': 'now', 'computeTravelTimeFor': 'all',
        })
        try:
            rota = dados['routes'][0]
            s = rota['summary']
        except (TypeError, KeyError, IndexError):
            return None
        polyline = [[p['latitude'], p['longitude']]
                    for leg in rota.get('legs') or [] for p in leg.get('points') or []
                    if 'latitude' in p and 'longitude' in p]
        return {
            'tempo_seg': s.get('travelTimeInSeconds'),
            'atraso_seg': s.get('trafficDelayInSeconds'),
            'sem_transito_seg': s.get('noTrafficTravelTimeInSeconds'),
            'distancia_km': round(float(s.get('lengthInMeters') or 0) / 1000, 2),
            'polyline': polyline,
        }

    async def rota_reconstruida(self, polyline: List[List[float]], pontos_apoio: List[List[float]]) -> Optional[dict]:
        """Uma chamada de Routing que (1) reconstrói a NOSSA rota na malha da TomTom,
        com o ETA dela sob trânsito ao vivo, e (2) devolve uma alternativa só se a
        TomTom achar rota melhor (alternativeType=betterRoute).

        routes[0] = nossa rota; routes[1] (se houver) = alternativa melhor.
        """
        origem, destino = polyline[0], polyline[-1]
        caminho = f'/routing/1/calculateRoute/{origem[0]:.6f},{origem[1]:.6f}:{destino[0]:.6f},{destino[1]:.6f}/json'
        dados = await self._get('rota', caminho, {
            'traffic': 'true', 'travelMode': 'car', 'routeType': 'fastest', 'departAt': 'now',
            'computeTravelTimeFor': 'all', 'maxAlternatives': 1, 'alternativeType': 'betterRoute',
            'minDeviationDistance': 0, 'minDeviationTime': 0,
        }, corpo={'supportingPoints': [{'latitude': p[0], 'longitude': p[1]} for p in pontos_apoio]})
        rotas = (dados or {}).get('routes') or []
        if not rotas:
            return None

        def extrair(rota: dict) -> dict:
            s = rota.get('summary') or {}
            return {
                'tempo_seg': s.get('travelTimeInSeconds'),
                'atraso_seg': s.get('trafficDelayInSeconds'),
                'sem_transito_seg': s.get('noTrafficTravelTimeInSeconds'),
                'distancia_km': round(float(s.get('lengthInMeters') or 0) / 1000, 2),
                'polyline': [[p['latitude'], p['longitude']]
                             for leg in rota.get('legs') or [] for p in leg.get('points') or []
                             if 'latitude' in p and 'longitude' in p],
            }
        return {'nossa': extrair(rotas[0]), 'melhor': extrair(rotas[1]) if len(rotas) > 1 else None}

    async def buscar(self, q: str, limite: int = 10,
                     perto: Optional[Tuple[float, float]] = None) -> List[dict]:
        """Busca com viés de posição (quem digita, ou o centro de Brasília). Devolve
        também tipo, nota, categoria e bairro: o ranking final é do routers/search.py,
        porque a nota da TomTom sai quase igual para tudo que contém o texto."""
        lat, lon = perto or CENTRO_BRASILIA
        norma = ' '.join(q.lower().split())
        chave = (norma, limite, round(lat, 2), round(lon, 2))  # ~1 km: o cache segue útil
        em_cache = self._cache_busca.get(chave)
        if em_cache is not None:
            return em_cache
        # safe='' codifica '/', '?' e '#': texto do usuário nunca vira caminho.
        dados = await self._get('busca', f'/search/2/search/{quote(norma, safe="")}.json', {
            'typeahead': 'true', 'limit': limite, 'countrySet': 'BR',
            'lat': lat, 'lon': lon, 'radius': 40_000, 'language': 'pt-BR',
        })
        if dados is None:
            return []
        resultados = []
        for r in dados.get('results') or []:
            # Entrada do lugar (na rua) quando houver; `position` é o centro do POI,
            # muitas vezes dentro do prédio — o snap no grafo caía atrás da quadra.
            entradas = r.get('entryPoints') or []
            pos = (entradas[0].get('position') if entradas else None) or r.get('position') or {}
            end = r.get('address') or {}
            poi = r.get('poi') or {}
            if pos.get('lat') is None or pos.get('lon') is None:
                continue
            nome = poi.get('name') or end.get('streetName') or end.get('freeformAddress')
            if not nome:
                continue
            codigos = [c.get('code') for c in poi.get('classifications') or [] if c.get('code')]
            codigos.sort(key=lambda c: c not in CODIGOS_MARCO)  # marco primeiro (estável)
            bairro = end.get('municipalitySubdivision') or end.get('municipality')
            rua = ' '.join(x for x in (end.get('streetName'), end.get('streetNumber')) if x)
            resultados.append({
                'label': str(nome)[:120],
                'sublabel': (' · '.join(x for x in (bairro, rua) if x and x != nome)
                             or str(end.get('freeformAddress') or ''))[:120],
                'lat': float(pos['lat']), 'lon': float(pos['lon']),
                'tipo': r.get('type'), 'score': float(r.get('score') or 0.0),
                'categoria_codigo': codigos[0] if codigos else None, 'bairro': bairro,
            })
        self._cache_busca.set(chave, resultados)
        return resultados


# Classificações que definem o lugar (a TomTom lista várias por POI).
CODIGOS_MARCO = {'SHOPPING_CENTER', 'AIRPORT', 'COLLEGE_UNIVERSITY', 'SCHOOL', 'HOSPITAL_POLYCLINIC',
                 'RAILWAY_STATION', 'PUBLIC_TRANSPORT_STOP', 'STADIUM', 'GOVERNMENT_OFFICE', 'MUSEUM'}


def criar_cliente() -> TomTomClient:
    chaves = [] if os.getenv('TOMTOM_ATIVO', '1') == '0' else carregar_chaves()
    logger.info(f"TomTom sob demanda: {len(chaves)} chave(s)"
                + ('' if chaves else ' — modo degradado (só LIA)'))
    return TomTomClient(chaves)


# ---------------------------------------------------------------------------
# Geometria (funções puras — testadas em tests/test_tomtom.py)
# ---------------------------------------------------------------------------

def razao_de_fluxo(fsd: Optional[dict]) -> Optional[float]:
    """Mesma definição do alvo de treino: velocidade atual / velocidade livre."""
    if not fsd:
        return None
    if fsd.get('roadClosure'):
        return RAZAO_MIN
    try:
        razao = float(fsd['currentSpeed']) / float(fsd['freeFlowSpeed'])
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return None
    return min(max(razao, RAZAO_MIN), RAZAO_MAX)


def _metros(lat, lon, lat0: float) -> Tuple[np.ndarray, np.ndarray]:
    """Projeção equirretangular local (m). Erro desprezível na escala do DF."""
    k = math.pi / 180.0 * 6_371_000.0
    return (np.asarray(lon, dtype=float) * k * math.cos(math.radians(lat0)),
            np.asarray(lat, dtype=float) * k)


def _dist_ponto_polilinha(px, py, lx, ly) -> np.ndarray:
    """Distância (m) de cada ponto P à polilinha L (broadcasting P×S)."""
    if len(lx) == 1:
        return np.hypot(px - lx[0], py - ly[0])
    ax, ay, dx, dy = lx[:-1], ly[:-1], np.diff(lx), np.diff(ly)
    comp2 = np.maximum(dx * dx + dy * dy, 1e-12)
    t = np.clip(((px[:, None] - ax) * dx + (py[:, None] - ay) * dy) / comp2, 0.0, 1.0)
    return np.min(np.hypot(px[:, None] - (ax + t * dx), py[:, None] - (ay + t * dy)), axis=1)


def selecionar_vias_corredor(vias: Dict[int, Tuple[float, float]],
                             origem: Tuple[float, float], destino: Tuple[float, float],
                             idade_min: Callable[[int], Optional[float]],
                             k: int = 8, buffer_m: float = 1500.0,
                             idade_max_min: float = 10.0) -> List[int]:
    """Vias monitoradas a até `buffer_m` da reta origem→destino com recência
    velha (ou nunca vista), espalhadas ao longo do corredor — no máximo k.

    ponytail: a reta é proxy da rota (ainda não calculada nesse ponto); rota
    muito sinuosa pode deixar via relevante fora do buffer.
    """
    if not vias or k <= 0:
        return []
    ids = list(vias)
    coords = np.array([vias[i] for i in ids], dtype=float)
    lat0 = (origem[0] + destino[0]) / 2
    px, py = _metros(coords[:, 0], coords[:, 1], lat0)
    lx, ly = _metros([origem[0], destino[0]], [origem[1], destino[1]], lat0)
    perto = _dist_ponto_polilinha(px, py, lx, ly) <= buffer_m
    dx, dy = lx[1] - lx[0], ly[1] - ly[0]
    t = ((px - lx[0]) * dx + (py - ly[0]) * dy) / max(dx * dx + dy * dy, 1e-12)

    velhas = []
    for via, ok, _ in sorted(zip(ids, perto, t), key=lambda x: x[2]):
        if not ok:
            continue
        idade = idade_min(int(via))
        if idade is None or idade > idade_max_min:
            velhas.append(int(via))
    if len(velhas) <= k:
        return velhas
    return [velhas[j] for j in np.unique(np.linspace(0, len(velhas) - 1, k).round().astype(int))]


def bbox_corredor(origem: Tuple[float, float], destino: Tuple[float, float],
                  margem_m: float = 1500.0, grade: float = 0.01) -> Tuple[float, float, float, float]:
    """bbox (minLon, minLat, maxLon, maxLat) do corredor, alinhada à grade de
    0,01° (~1 km) pra rotas vizinhas caírem na mesma chave de cache."""
    dlat = margem_m / 111_000
    dlon = margem_m / (111_000 * math.cos(math.radians((origem[0] + destino[0]) / 2)))
    baixo = lambda v: round(math.floor(v / grade) * grade, 4)  # noqa: E731
    cima = lambda v: round(math.ceil(v / grade) * grade, 4)  # noqa: E731
    return (baixo(min(origem[1], destino[1]) - dlon), baixo(min(origem[0], destino[0]) - dlat),
            cima(max(origem[1], destino[1]) + dlon), cima(max(origem[0], destino[0]) + dlat))


def _coords_incidente(inc: dict) -> Tuple[np.ndarray, np.ndarray]:
    """(lats, lons) da geometria GeoJSON do incidente ([lon, lat])."""
    geom = inc.get('geometry') or {}
    coords = geom.get('coordinates') or []
    if geom.get('type') == 'Point':
        coords = [coords]
    try:
        arr = np.asarray(coords, dtype=float).reshape(-1, 2)
    except (TypeError, ValueError):
        return np.array([]), np.array([])
    return arr[:, 1], arr[:, 0]


def _arestas_indexadas(G):
    """(chaves, pontos E×3×2) com (u, meio, v) × (lat, lon). Montado uma vez por grafo."""
    cache = G.graph.get('_tt_arestas')
    if cache is None:
        chaves, pontos = [], []
        for u, v, k, d in G.edges(keys=True, data=True):
            nu, nv = G.nodes[u], G.nodes[v]
            try:
                ul, uo, vl, vo = float(nu['y']), float(nu['x']), float(nv['y']), float(nv['x'])
            except (KeyError, TypeError, ValueError):
                continue
            chaves.append((u, v, k))
            pontos.append(((ul, uo), (d.get('mid_y', (ul + vl) / 2), d.get('mid_x', (uo + vo) / 2)), (vl, vo)))
        cache = G.graph['_tt_arestas'] = (chaves, np.asarray(pontos, dtype=float).reshape(-1, 3, 2))
    return cache


def arestas_interditadas(G, incidentes: Iterable[dict], tol_m: float = 20.0) -> Set[Tuple]:
    """Arestas cobertas por incidente de via interditada (iconCategory 8).

    Bloqueia quando 2 dos 3 pontos da aresta (início, meio, fim) estão a até
    tol_m da geometria do incidente. ponytail: bloqueia os dois sentidos da
    via — a TomTom nem sempre separa interdição por sentido.
    """
    fechados = [i for i in incidentes if (i.get('properties') or {}).get('iconCategory') == ICONE_INTERDICAO]
    if not fechados:
        return set()
    chaves, pontos = _arestas_indexadas(G)
    if not chaves:
        return set()
    margem = tol_m / 100_000 * 2  # graus, folga generosa pro pré-filtro
    bloqueadas: Set[Tuple] = set()
    for inc in fechados:
        lat, lon = _coords_incidente(inc)
        if lat.size == 0:
            continue
        na_caixa = ((pontos[:, :, 0] >= lat.min() - margem) & (pontos[:, :, 0] <= lat.max() + margem)
                    & (pontos[:, :, 1] >= lon.min() - margem) & (pontos[:, :, 1] <= lon.max() + margem))
        candidatas = np.flatnonzero(na_caixa.any(axis=1))
        if candidatas.size == 0:
            continue
        lat0 = float(lat.mean())
        lx, ly = _metros(lat, lon, lat0)
        c = pontos[candidatas]
        px, py = _metros(c[:, :, 0].ravel(), c[:, :, 1].ravel(), lat0)
        perto = (_dist_ponto_polilinha(px, py, lx, ly) <= tol_m).reshape(-1, 3)
        bloqueadas.update(chaves[candidatas[i]] for i in np.flatnonzero(perto.sum(axis=1) >= 2))
    return bloqueadas


def peso_sem_interditadas(bloqueadas: Set[Tuple], penalidade: float = 1e9, atraso_semaforo: float = 0.0):
    """Peso do A* que tira as arestas interditadas sem mutar o grafo
    compartilhado (networkx passa {chave: atributos} das arestas paralelas).
    Com atraso_semaforo > 0, soma o atraso médio ao chegar num cruzamento
    sinalizado (atributo `semaforo`, ver trajeto.marcar_semaforos)."""
    def peso(u, v, paralelas):
        return min(penalidade if (u, v, k) in bloqueadas
                   else d.get('travel_time_lia', 1.0) + atraso_semaforo * d.get('semaforo', 0)
                   for k, d in paralelas.items())
    return peso


def incidentes_na_rota(incidentes: Iterable[dict], polyline: List[List[float]],
                       tol_m: float = 60.0, max_itens: int = 10) -> List[dict]:
    """Incidentes a até tol_m da rota final — alerta pro usuário (interdição primeiro)."""
    if not polyline:
        return []
    rota = np.asarray(polyline, dtype=float)
    lat0 = float(rota[:, 0].mean())
    rx, ry = _metros(rota[:, 0], rota[:, 1], lat0)
    achados = []
    for inc in incidentes:
        lat, lon = _coords_incidente(inc)
        if lat.size == 0:
            continue
        ix, iy = _metros(lat, lon, lat0)
        if _dist_ponto_polilinha(ix, iy, rx, ry).min() > tol_m:
            continue
        p = inc.get('properties') or {}
        eventos = p.get('events') or []
        descricao = eventos[0].get('description') if eventos and isinstance(eventos[0], dict) else None
        atraso = p.get('delay')
        achados.append({
            'tipo': NOMES_INCIDENTE.get(p.get('iconCategory'), 'Incidente'),
            'descricao': str(descricao)[:200] if descricao else None,
            'atraso_seg': int(atraso) if isinstance(atraso, (int, float)) else None,
            'interdicao': p.get('iconCategory') == ICONE_INTERDICAO,
            'lat': float(lat[0]), 'lon': float(lon[0]),
        })
    achados.sort(key=lambda a: (not a['interdicao'], -(a['atraso_seg'] or 0)))
    return achados[:max_itens]
