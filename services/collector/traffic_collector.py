"""
Módulo responsável por consultar a API de Flow Segment Data da TomTom.
Implemente controle de velocidade (QPS), rotação inteligente de chaves
com cooldown persistente e armazenamento em lote.
"""
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

# Cota esgotada = janela rolante de 24h (branch tcc2): o horário/periodicidade
# real do reset da TomTom não está confirmado (pricing indica cota mensal por
# API). 24h rolante garante que o reset já passou, seja qual for o horário.
# ponytail: se confirmar cota mensal, trocar por cooldown até o reset do mês.
SECONDS_PER_DAY = 86400
QPS_BACKOFF_SECONDS = 1.0
INTER_REQUEST_DELAY = 0.25
REQUEST_TIMEOUT = 10
MAX_QPS_RETRIES_PER_KEY = 3


def load_keys_from_json(filepath: str) -> List[dict]:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('tomtom_keys', [])
    except Exception as e:
        logging.error(f"Erro ao carregar o arquivo JSON de chaves: {e}")
        raise ValueError(f"Arquivo {filepath} ausente ou mal formatado.")


API_KEYS_DATA = load_keys_from_json('config/tomtom_keys.json')
if not API_KEYS_DATA:
    raise ValueError("Nenhuma chave encontrada no arquivo JSON.")


class TrafficCollector:
    def __init__(self, api_keys_data: List[dict]):
        self.api_keys_data = api_keys_data
        self.current_key_index = 0
        self.base_url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json"

        # cooldown_until[key_id] = epoch em que a chave volta a ser elegível.
        # Estado persistente ENTRE chamadas de _fetch_tomtom_data e ENTRE pontos do ciclo.
        self.cooldown_until: Dict[str, float] = {}

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
                logging.error(f"Falha de rede ao contatar a API da TomTom: {e}")
                return None

            status = response.status_code

            if status == 200:
                try:
                    data = response.json()
                except ValueError:
                    logging.error(f"Resposta 200 com JSON inválido para ({lat},{lon}).")
                    return None
                segment = data.get('flowSegmentData', {})
                if 'currentSpeed' in segment:
                    return segment
                logging.error(f"Formato JSON inesperado retornado: {data}")
                return None

            if status in (403, 429):
                error_text = (response.text or "").lower()

                # 1) Rate limit por segundo (QPS) — backoff curto, mesma chave
                if "over qps" in error_text or status == 429 and "qps" in error_text:
                    if tentativas_qps < MAX_QPS_RETRIES_PER_KEY:
                        tentativas_qps += 1
                        logging.warning(
                            f"QPS atingido na chave [{key_entry['id']}]. "
                            f"Backoff {QPS_BACKOFF_SECONDS}s (tentativa {tentativas_qps}/{MAX_QPS_RETRIES_PER_KEY})."
                        )
                        time.sleep(QPS_BACKOFF_SECONDS)
                        continue
                    # QPS persistente — trate como esgotamento curto (5 min) e rotacione
                    logging.error(f"QPS persistente em [{key_entry['id']}]. Cooldown curto de 5 min.")
                    self._mark_exhausted(self.current_key_index, cooldown_seconds=300)
                    tentativas_qps = 0
                    if not self._advance_to_next_available():
                        logging.critical("Todas as chaves em cooldown após QPS persistente. Pulando ponto.")
                        return None
                    continue

                # 2) Cota diária / créditos / conta — cooldown até reset diário UTC
                exhausted_phrases = (
                    "over rate", "over quota", "limit exceeded",
                    "insufficientfunds", "credits", "account inactive",
                )
                if any(phrase in error_text for phrase in exhausted_phrases):
                    logging.warning(f"Cota da chave [{key_entry['id']}] esgotada: {error_text[:200]}")
                    self._mark_exhausted(self.current_key_index)  # cooldown até 00:00 UTC
                    tentativas_qps = 0
                    if not self._advance_to_next_available():
                        espera = self._shortest_cooldown_remaining()
                        logging.critical(
                            f"TODAS as {len(self.api_keys_data)} chaves esgotadas. "
                            f"Próxima reset em {espera/60:.1f} min. Pulando ponto."
                        )
                        return None
                    continue

                # 3) 403/429 desconhecido — não banir a chave por tempo longo, mas registrar
                logging.error(
                    f"HTTP {status} desconhecido em [{key_entry['id']}] no ponto ({lat},{lon}): "
                    f"{response.text[:300]}"
                )
                self._mark_exhausted(self.current_key_index, cooldown_seconds=600)
                tentativas_qps = 0
                if not self._advance_to_next_available():
                    logging.critical("Todas as chaves em cooldown após erros desconhecidos. Pulando ponto.")
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
            if historico_batch:
                logging.info(f"Salvando lote de {len(historico_batch)} registros capturados no banco...")
                db_manager.insert_historico_batch(historico_batch)
            else:
                logging.warning("Nenhum dado válido extraído neste ciclo para ser salvo.")


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
