"""
Módulo responsável por consultar a API de Flow Segment Data da TomTom.
Implemente controle de velocidade (QPS), rotação inteligente de chaves e armazenamento em lote.
"""
import os
import time
import json
import logging
from typing import List, Tuple, Optional
import requests
from dotenv import load_dotenv

from models import db_manager

load_dotenv(os.path.join('config', '.env'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

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

    def _get_current_key(self) -> str:
        return self.api_keys_data[self.current_key_index]['key']

    def _get_current_key_id(self) -> str:
        return self.api_keys_data[self.current_key_index]['id']

    def _rotate_key(self) -> None:
        """
        Alterne para a próxima chave da lista num ciclo infinito (Circular).
        """
        chave_anterior = self._get_current_key_id()
        # O módulo (%) garante que ao chegar no final, ele volte para o índice 0 (Chave 1)
        self.current_key_index = (self.current_key_index + 1) % len(self.api_keys_data)
        nova_chave = self._get_current_key_id()
        logging.warning(f"Rotacionando da chave [{chave_anterior}] para a chave [{nova_chave}].")

    def _fetch_tomtom_data(self, lat: float, lon: float) -> Optional[dict]:
        tentativas_qps = 0
        chaves_esgotadas_neste_ciclo = 0
        total_chaves = len(self.api_keys_data)

        # Loop infinito até conseguir os dados (ou estourar o limite de QPS)
        while True:
            time.sleep(0.25)
           
            key = self._get_current_key()
            params = {
                'point': f"{lat},{lon}",
                'key': key
            }
           
            try:
                response = requests.get(self.base_url, params=params, timeout=10)
               
                if response.status_code == 200:
                    data = response.json()
                    segment = data.get('flowSegmentData', {})
                    if 'currentSpeed' in segment:
                        return segment
                    else:
                        logging.error(f"Formato JSON inesperado retornado: {data}")
                        return None
                       
                elif response.status_code in [403, 429]:
                    error_text = response.text.lower()
                   
                    if "over qps" in error_text:
                        if tentativas_qps < 3:
                            logging.warning("Limite de QPS atingido. Aguardando 1 segundo para tentar novamente.")
                            time.sleep(1)
                            tentativas_qps += 1
                            continue
                        else:
                            logging.error("Múltiplas falhas de QPS seguidas. Abortando ponto.")
                            return None
                           
                    elif any(phrase in error_text for phrase in ["over rate", "over quota", "limit exceeded", "insufficientfunds", "credits"]):
                        logging.warning(f"Cota da chave ID [{self._get_current_key_id()}] esgotada!")
                        chaves_esgotadas_neste_ciclo += 1
                       
                        # Verifica se o código já rodou por todas as chaves
                        if chaves_esgotadas_neste_ciclo >= total_chaves:
                            self.current_key_index = 0 # Força voltar para a Chave 1
                            logging.critical("TODAS AS CHAVES ESGOTADAS! Hibernando por 30 minutos antes de tentar a Chave 1 novamente...")
                            time.sleep(1800) # Dorme por 30 minutos
                            # Ao acordar, o 'continue' fará ele tentar a Chave 1.
                            # Se a Chave 1 falhar de novo, ele cai nesse IF novamente sem rodar pelas outras!
                            continue
                        else:
                            self._rotate_key()
                            tentativas_qps = 0
                            continue
                           
                    else:
                        logging.error(f"Erro 403 desconhecido no ponto ({lat},{lon}): {response.text}. Forçando rotação.")
                        chaves_esgotadas_neste_ciclo += 1
                       
                        if chaves_esgotadas_neste_ciclo >= total_chaves:
                            self.current_key_index = 0
                            logging.critical("TODAS AS CHAVES COM ERRO! Hibernando por 30 minutos...")
                            time.sleep(1800)
                            continue
                        else:
                            self._rotate_key()
                            tentativas_qps = 0
                            continue
                       
                else:
                    logging.error(f"Erro HTTP {response.status_code} no ponto ({lat},{lon}): {response.text}")
                    return None
                   
            except requests.exceptions.RequestException as e:
                logging.error(f"Falha de rede ao contatar a API da TomTom: {e}")
                return None

    def collect_for_all_vias(self, vias: List[Tuple[int, str, float, float]]) -> None:
        historico_batch = []
        try:
            for id_ponto, nome_via, lat, lon in vias:
                logging.info(f"Monitorando ponto ID {id_ponto} ({nome_via})...")
                segment_data = self._fetch_tomtom_data(lat, lon)
               
                if segment_data:
                    try:
                        historico_batch.append((
                            id_ponto,
                            int(float(segment_data['currentSpeed'])),
                            int(float(segment_data['freeFlowSpeed'])),
                            int(float(segment_data['currentTravelTime'])),
                            float(segment_data.get('confidence', 0.0))
                        ))
                    except (ValueError, KeyError) as e:
                        logging.error(f"Falha ao processar os tipos de dados do segmento: {e}")
                        continue
                       
        except KeyboardInterrupt:
            logging.warning("Interrupção manual detectada (Ctrl+C) durante a varredura das vias.")
            raise
           
        finally:
            if historico_batch:
                logging.info(f"Salvando lote de {len(historico_batch)} registros capturados com sucesso no banco...")
                db_manager.insert_historico_batch(historico_batch)
            else:
                logging.warning("Nenhum dado válido extraído neste ciclo para ser salvo.")

_collector_instance = None

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