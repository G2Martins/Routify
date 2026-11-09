"""
Módulo responsável por consultar a API de Flow Segment Data da TomTom.
Implemente controle de velocidade (QPS), rotação inteligente de chaves
com cooldown persistente e armazenamento em lote.

Cota (docs.tomtom.com/pricing, lido em 2026-11-01): "free monthly requests
per API" — Flow Segment Data 20 mil/mês por chave. A API sob demanda
(apps/api/tomtom.py) usa o MESMO pool, então a cadência é dimensionada pela
cota com uma reserva pra API (ver intervalo_minutos) e o consumo é espalhado
por todas as chaves (round-robin a cada requisição bem-sucedida).
"""
import math
import os
import time
import json
import logging
from datetime import datetime, timezone
from typing import List, Tuple, Optional, Dict
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from dotenv import load_dotenv

import db as db_manager

load_dotenv(os.path.join('config', '.env'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Cota esgotada = janela rolante de 24h: a TomTom não expõe o horário do reset
# mensal e 1 tentativa por chave por dia custa quase nada. Mesma política da API.
SECONDS_PER_DAY = 86400
COOLDOWN_CHAVE_INVALIDA = 600   # 403 sem texto de cota: chave inválida/proibida
QPS_BACKOFF_SECONDS = 1.0
INTER_REQUEST_DELAY = 0.25
REQUEST_TIMEOUT = 10
# A TomTom devolve 429 tanto pra QPS quanto pra cota: até 3 seguidos = QPS
# (backoff curto na mesma chave); o 4º vira cota. Igual a apps/api/tomtom.py.
MAX_QPS_RETRIES_PER_KEY = 3

# Dimensionamento da cadência pela cota mensal (ver intervalo_minutos).
COTA_MENSAL_FLOW = int(os.getenv('COLETOR_COTA_MENSAL_CHAVE', '20000'))
RESERVA_API = float(os.getenv('COLETOR_RESERVA_API', '0.15'))
INTERVALO_PISO_MIN = 8   # cadência do dataset original; mais rápido que isso não ajuda o modelo

# TOMTOM_KEYS_FILE permite dar ao coletor um subconjunto do pool (a API lê a mesma variável).
ARQUIVO_CHAVES = os.getenv('TOMTOM_KEYS_FILE', os.path.join('config', 'tomtom_keys.json'))


def load_keys_from_json(filepath: str) -> List[dict]:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('tomtom_keys', [])
    except Exception as e:
        logging.error(f"Erro ao carregar o arquivo JSON de chaves: {e}")
        raise ValueError(f"Arquivo {filepath} ausente ou mal formatado.")


API_KEYS_DATA = load_keys_from_json(ARQUIVO_CHAVES)
if not API_KEYS_DATA:
    raise ValueError("Nenhuma chave encontrada no arquivo JSON.")


NOITE_HORAS, NOITE_INTERVALO_MIN = range(0, 5), 120  # 0h às 5h o trânsito é livre: persistência erra 1,6 s (nov/2026)


def intervalo_diurno(n_chaves: int, n_pontos: int, cota_mensal: int = COTA_MENSAL_FLOW,
                     reserva: float = RESERVA_API, dias_mes: int = 31) -> int:
    """Como intervalo_minutos, mas com 1 ciclo a cada 2 h de madrugada: o que sobra vai para as horas com trânsito.
    Mesma cota por dia. Com 39 chaves e 780 pontos: 46 min de dia, contra 53 min uniformes."""
    base = intervalo_minutos(n_chaves, n_pontos, cota_mensal, reserva, dias_mes)
    ciclos_dia = n_chaves * cota_mensal * (1.0 - reserva) / dias_mes / n_pontos
    noite_min = len(NOITE_HORAS) * 60
    ciclos_dia_util = ciclos_dia - noite_min / NOITE_INTERVALO_MIN
    if ciclos_dia_util <= 0 or base >= NOITE_INTERVALO_MIN:
        return base
    return max(INTERVALO_PISO_MIN, math.ceil((1440.0 - noite_min) / ciclos_dia_util))


def pular_na_madrugada(hora: int, minutos_desde_ultimo) -> bool:
    """De madrugada, só coleta se o último ciclo tiver 2 h (None = nunca coletou)."""
    return hora in NOITE_HORAS and minutos_desde_ultimo is not None and minutos_desde_ultimo < NOITE_INTERVALO_MIN - 1


def intervalo_minutos(n_chaves: int, n_pontos: int, cota_mensal: int = COTA_MENSAL_FLOW,
                      reserva: float = RESERVA_API, dias_mes: int = 31) -> int:
    """Menor intervalo entre ciclos (min) que cabe na cota mensal do pool.

    ciclos/dia = chaves × cota × (1 − reserva) / dias / pontos. Com 39 chaves,
    630 pontos, 20 mil/mês e 15% de reserva → 43 min. O teto (ceil) garante
    que o consumo diário nunca passa do orçamento; piso de 8 min.
    """
    if n_chaves <= 0 or n_pontos <= 0:
        raise ValueError("n_chaves e n_pontos precisam ser positivos")
    if not 0 <= reserva < 1:
        raise ValueError("reserva deve estar em [0, 1)")
    requisicoes_dia = n_chaves * cota_mensal * (1.0 - reserva) / dias_mes
    ciclos_dia = requisicoes_dia / n_pontos
    return max(INTERVALO_PISO_MIN, math.ceil(1440.0 / ciclos_dia))


class TrafficCollector:
    def __init__(self, api_keys_data: List[dict]):
        self.api_keys_data = api_keys_data
        self.current_key_index = 0
        self.base_url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json"

        # cooldown_until[key_id] = epoch em que a chave volta a ser elegível.
        # Estado persistente ENTRE chamadas de _fetch_tomtom_data e ENTRE pontos do ciclo.
        self.cooldown_until: Dict[str, float] = {}

        # Uso por chave desde o último envio: [chamadas, falhas, último status HTTP]. Vai para tomtom_uso_dia no
        # fim de cada ciclo (painel /admin/operacao compara com a cota mensal); só o id da chave sai daqui.
        self.uso: Dict[str, List[int]] = {}

        # Session HTTP única: reaproveita conexão TCP/TLS e evita vazamento de sockets
        # depois de milhares de requests por dia.
        self.session = requests.Session()
        retry_strategy = Retry(
            total=2,
            backoff_factor=0.5,
            status_forcelist=[500, 502, 503, 504],
            allowed_methods=["GET"],
            raise_on_status=False,
        )
        adapter = HTTPAdapter(
            pool_connections=4,
            pool_maxsize=4,
            max_retries=retry_strategy,
        )
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    def _contar(self, key_id: str, status: int) -> None:
        u = self.uso.setdefault(key_id, [0, 0, 0])
        u[0] += 1
        u[1] += int(status != 200)
        u[2] = status

    def _enviar_uso(self) -> None:
        """Manda o uso do ciclo para o banco. Nunca levanta: contagem não pode parar a coleta.
        Se o envio falhar, os contadores ficam para o próximo ciclo."""
        if not self.uso:
            return
        agora = time.time()
        linhas = [{'chave_id': k, 'servico': 'fluxo', 'chamadas': n, 'falhas': f, 'ultimo_status': st or None,
                   'cooldown_ate': (datetime.fromtimestamp(self.cooldown_until[k], tz=timezone.utc).isoformat()
                                    if self.cooldown_until.get(k, 0.0) > agora else None)}
                  for k, (n, f, st) in self.uso.items()]
        try:
            db_manager.registrar_uso_tomtom('coletor', linhas)
            self.uso = {}
        except Exception as e:
            logging.warning(f"Uso das chaves não gravado ({type(e).__name__}); vai no próximo ciclo.")

    def _key_at(self, idx: int) -> dict:
        return self.api_keys_data[idx]

    def _is_available(self, idx: int) -> bool:
        key_id = self._key_at(idx)['id']
        until = self.cooldown_until.get(key_id, 0.0)
        return time.time() >= until

    def _mark_exhausted(self, idx: int, cooldown_seconds: Optional[float] = None) -> None:
        """Marque a chave como indisponível por 24h (ou intervalo customizado)."""
        key_id = self._key_at(idx)['id']
        cd = cooldown_seconds if cooldown_seconds is not None else SECONDS_PER_DAY
        self.cooldown_until[key_id] = time.time() + cd
        proxima = datetime.fromtimestamp(self.cooldown_until[key_id], tz=timezone.utc)
        logging.warning(
            f"Chave [{key_id}] em cooldown por {cd/60:.1f} min "
            f"(volta a tentar após {proxima.isoformat()})."
        )

    def _next_available_index(self, start: int) -> Optional[int]:
        """Retorne o índice da próxima chave elegível a partir de `start`, ou None se todas estão em cooldown."""
        total = len(self.api_keys_data)
        for offset in range(total):
            idx = (start + offset) % total
            if self._is_available(idx):
                return idx
        return None

    def _advance_to_next_available(self) -> bool:
        """Avance current_key_index para a próxima chave elegível. Retorne False se todas estão em cooldown."""
        proximo = self._next_available_index((self.current_key_index + 1) % len(self.api_keys_data))
        if proximo is None:
            return False
        anterior = self._key_at(self.current_key_index)['id']
        self.current_key_index = proximo
        logging.warning(f"Rotacionando de [{anterior}] para [{self._key_at(proximo)['id']}].")
        return True

    def _ensure_current_is_available(self) -> bool:
        """Se a chave atual está em cooldown, salte para a próxima elegível."""
        if self._is_available(self.current_key_index):
            return True
        proximo = self._next_available_index(self.current_key_index)
        if proximo is None:
            return False
        self.current_key_index = proximo
        return True

    def _shortest_cooldown_remaining(self) -> float:
        """Retorne o menor tempo (segundos) que falta para qualquer chave sair do cooldown."""
        agora = time.time()
        tempos = [until - agora for until in self.cooldown_until.values() if until > agora]
        return min(tempos) if tempos else 0.0

    def _fetch_tomtom_data(self, lat: float, lon: float) -> Optional[dict]:
        """
        Tente buscar dados para um ponto. Pula chaves em cooldown.
        Retorna None se: todas as chaves estão indisponíveis, ou ponto inválido,
        ou erro persistente. NÃO hiberna o processo inteiro — apenas marca a
        chave problemática e segue, deixando o scheduler retomar no próximo ciclo.
        """
        if not self._ensure_current_is_available():
            espera = self._shortest_cooldown_remaining()
            logging.critical(
                f"Todas as {len(self.api_keys_data)} chaves em cooldown. "
                f"Próxima fica disponível em {espera/60:.1f} min. Pulando ponto."
            )
            return None

        tentativas_qps = 0

        while True:
            time.sleep(INTER_REQUEST_DELAY)

            key_entry = self._key_at(self.current_key_index)
            params = {'point': f"{lat},{lon}", 'key': key_entry['key']}

            try:
                response = self.session.get(self.base_url, params=params, timeout=REQUEST_TIMEOUT)
            except requests.exceptions.RequestException as e:
                self._contar(key_entry['id'], 0)
                logging.error(f"Falha de rede ao contatar a API da TomTom: {type(e).__name__}")
                return None

            status = response.status_code
            self._contar(key_entry['id'], status)

            if status == 200:
                try:
                    data = response.json()
                except ValueError:
                    logging.error(f"Resposta 200 com JSON inválido para ({lat},{lon}).")
                    return None
                segment = data.get('flowSegmentData', {})
                if 'currentSpeed' in segment:
                    # Round-robin: espalha o consumo da cota mensal por todas as chaves.
                    self.current_key_index = (self.current_key_index + 1) % len(self.api_keys_data)
                    return segment
                logging.error(f"Formato JSON inesperado retornado: {data}")
                return None

            if status in (403, 429):
                error_text = (response.text or "").lower()

                # 1) 429 = QPS até a 3ª vez seguida na mesma chave: backoff curto e repete.
                if status == 429 and tentativas_qps < MAX_QPS_RETRIES_PER_KEY:
                    tentativas_qps += 1
                    logging.warning(
                        f"HTTP 429 na chave [{key_entry['id']}] (QPS?). "
                        f"Backoff {QPS_BACKOFF_SECONDS}s (tentativa {tentativas_qps}/{MAX_QPS_RETRIES_PER_KEY})."
                    )
                    time.sleep(QPS_BACKOFF_SECONDS)
                    continue

                # 2) 4º 429 seguido, ou 403 falando de cota/créditos/conta = cota do mês
                #    esgotada → 24h rolante e rotaciona.
                exhausted_phrases = (
                    "over rate", "over quota", "quota", "limit exceeded",
                    "insufficientfunds", "credits", "account inactive",
                )
                if status == 429 or any(phrase in error_text for phrase in exhausted_phrases):
                    logging.warning(
                        f"Cota da chave [{key_entry['id']}] esgotada (HTTP {status}): {error_text[:200]}"
                    )
                    self._mark_exhausted(self.current_key_index)
                    tentativas_qps = 0
                    if not self._advance_to_next_available():
                        espera = self._shortest_cooldown_remaining()
                        logging.critical(
                            f"TODAS as {len(self.api_keys_data)} chaves esgotadas. "
                            f"Próxima volta em {espera/60:.1f} min. Pulando ponto."
                        )
                        return None
                    continue

                # 3) 403 sem texto de cota: chave inválida/proibida — 10 min e rotaciona.
                logging.error(
                    f"HTTP {status} em [{key_entry['id']}] no ponto ({lat},{lon}): "
                    f"{response.text[:300]}"
                )
                self._mark_exhausted(self.current_key_index, cooldown_seconds=COOLDOWN_CHAVE_INVALIDA)
                tentativas_qps = 0
                if not self._advance_to_next_available():
                    logging.critical("Todas as chaves em cooldown após erros de autorização. Pulando ponto.")
                    return None
                continue

            # Outros status (5xx já passou pelo Retry do adapter; aqui chegam erros não-recuperáveis)
            logging.error(f"Erro HTTP {status} no ponto ({lat},{lon}): {response.text[:300]}")
            return None

    def collect_for_all_vias(self, vias: List[Tuple[int, str, float, float]]) -> None:
        historico_batch = []
        try:
            for id_ponto, nome_via, lat, lon in vias:
                # Curto-circuito: se TODAS as chaves estão em cooldown, abortar o ciclo
                # inteiro em vez de iterar 600+ pontos só para logar "pulando".
                if self._next_available_index(self.current_key_index) is None:
                    espera = self._shortest_cooldown_remaining()
                    logging.critical(
                        f"Abortando ciclo: todas as chaves em cooldown. "
                        f"Próxima disponível em {espera/60:.1f} min. "
                        f"O scheduler tentará novamente no próximo intervalo."
                    )
                    break

                logging.info(f"Monitorando ponto ID {id_ponto} ({nome_via})...")
                segment_data = self._fetch_tomtom_data(lat, lon)

                if segment_data:
                    try:
                        historico_batch.append((
                            id_ponto,
                            int(float(segment_data['currentSpeed'])),
                            int(float(segment_data['freeFlowSpeed'])),
                            int(float(segment_data['currentTravelTime'])),
                            float(segment_data.get('confidence', 0.0)),
                        ))
                    except (ValueError, KeyError) as e:
                        logging.error(f"Falha ao processar os tipos de dados do segmento: {e}")
                        continue

        except KeyboardInterrupt:
            logging.warning("Interrupção manual detectada (Ctrl+C) durante a varredura das vias.")
            raise

        finally:
            try:
                if historico_batch:
                    logging.info(f"Salvando lote de {len(historico_batch)} registros capturados no banco...")
                    db_manager.insert_historico_batch(historico_batch)
                else:
                    logging.warning("Nenhum dado válido extraído neste ciclo para ser salvo.")
            finally:
                self._enviar_uso()


_collector_instance: Optional[TrafficCollector] = None


def get_collector() -> TrafficCollector:
    global _collector_instance
    if _collector_instance is None:
        _collector_instance = TrafficCollector(API_KEYS_DATA)
    return _collector_instance


def run_collection() -> None:
    try:
        vias = db_manager.get_all_vias()
        if not vias:
            logging.info("A tabela de vias monitoradas está vazia. Coleta abortada.")
            return

        collector = get_collector()
        collector.collect_for_all_vias(vias)
    except Exception as e:
        logging.exception(f"Erro crítico durante a execução do ciclo de coleta: {e}")
