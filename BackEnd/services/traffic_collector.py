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

# Atualização de Importação devido à nova arquitetura de pastas
from models import db_manager

load_dotenv(os.path.join('config', '.env'))

# Configure o logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def load_keys_from_json(filepath: str) -> List[dict]:
    """Leia o arquivo JSON e retorne a lista de chaves estruturadas."""
    try:
        # Puxa o arquivo assumindo que a pasta raiz do TCC está sendo executada
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('tomtom_keys', [])
    except Exception as e:
        logging.error(f"Erro ao carregar o arquivo JSON de chaves: {e}")
        raise ValueError(f"Arquivo {filepath} ausente ou mal formatado.")

# Extraia as chaves do arquivo JSON que deve estar na pasta config
API_KEYS_DATA = load_keys_from_json('config/tomtom_keys.json')
if not API_KEYS_DATA:
    raise ValueError("Nenhuma chave encontrada no arquivo JSON.")

class TrafficCollector:
    """
    Coletor de tráfego com controle de QPS e rotação automática de chaves baseadas em JSON.
    """
    def __init__(self, api_keys_data: List[dict]):
        self.api_keys_data = api_keys_data
        self.current_key_index = 0
        self.base_url = "https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json"

    def _get_current_key(self) -> str:
        """Retorne a string da chave atualmente em uso."""
        return self.api_keys_data[self.current_key_index]['key']

    def _get_current_key_id(self) -> str:
        """Retorne o ID da chave atualmente em uso para identificação nos logs."""
        return self.api_keys_data[self.current_key_index]['id']

    def _rotate_key(self) -> bool:
        """
        Alterne para a próxima chave da lista.
        Retorne True em caso de sucesso ou False se esgotarem as opções.
        """
        if self.current_key_index < len(self.api_keys_data) - 1:
            chave_anterior = self._get_current_key_id()
            self.current_key_index += 1
            nova_chave = self._get_current_key_id()
            logging.warning(f"Rotacionando da chave [{chave_anterior}] para a chave [{nova_chave}].")
            return True
        else:
            logging.error("Todas as chaves de API do arquivo JSON esgotaram a cota diária.")
            return False

    def _fetch_tomtom_data(self, lat: float, lon: float) -> Optional[dict]:
        """
        Faça a requisição à API TomTom.
        Trate ativamente os limites de QPS e de cota diária lendo o corpo do erro HTTP.
        """
        tentativas_chave = 0
        max_tentativas_chave = len(self.api_keys_data)
        tentativas_qps = 0

        while tentativas_chave < max_tentativas_chave:
            # Aguarde 0.25 segundos para garantir no máximo 4 requisições por segundo (Limite é 5 QPS)
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
                    
                    # Verifique se o erro é apenas excesso de velocidade (QPS)
                    if "over qps" in error_text:
                        if tentativas_qps < 3:
                            logging.warning("Limite de QPS atingido. Aguardando 1 segundo para tentar novamente.")
                            time.sleep(1)
                            tentativas_qps += 1
                            continue
                        else:
                            logging.error("Múltiplas falhas de QPS seguidas. Abortando ponto.")
                            return None
                            
                    # Verifique se o erro é o esgotamento da cota diária da chave 
                    # Lida com os alertas de "over quota" e "insufficientfunds" da TomTom
                    elif any(phrase in error_text for phrase in ["over rate", "over quota", "limit exceeded", "insufficientfunds", "credits"]):
                        logging.warning(f"Cota da chave ID [{self._get_current_key_id()}] esgotada! Iniciando rotação...")
                        if not self._rotate_key():
                            break
                        tentativas_chave += 1
                        tentativas_qps = 0
                        continue
                        
                    # Trate outros tipos de bloqueio 403 não mapeados rotacionando por precaução
                    else:
                        logging.error(f"Erro 403 desconhecido no ponto ({lat},{lon}): {response.text}. Forçando rotação.")
                        if not self._rotate_key():
                            break
                        tentativas_chave += 1
                        tentativas_qps = 0
                        continue
                        
                else:
                    logging.error(f"Erro HTTP {response.status_code} no ponto ({lat},{lon}): {response.text}")
                    return None
                    
            except requests.exceptions.RequestException as e:
                logging.error(f"Falha de rede ao contatar a API da TomTom: {e}")
                return None

        return None

    def collect_for_all_vias(self, vias: List[Tuple[int, str, float, float]]) -> None:
        """
        Itere sobre a lista de vias, extraia os dados e insira no banco em lote.
        """
        historico_batch = []
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

        if historico_batch:
            db_manager.insert_historico_batch(historico_batch)
            logging.info(f"Lote de {len(historico_batch)} registros inserido no banco de dados com sucesso.")
        else:
            logging.warning("Nenhum dado válido extraído neste ciclo.")

# Instancie o coletor globalmente para preservar o índice da chave ativa entre as execuções
_collector_instance = None

def get_collector() -> TrafficCollector:
    """Retorne a instância global do coletor."""
    global _collector_instance
    if _collector_instance is None:
        _collector_instance = TrafficCollector(API_KEYS_DATA)
    return _collector_instance

def run_collection() -> None:
    """
    Função acionada pelo agendador.
    Busque as vias ativas no banco e inicie o ciclo de coleta.
    """
    try:
        vias = db_manager.get_all_vias()
        if not vias:
            logging.info("A tabela de vias monitoradas está vazia. Coleta abortada.")
            return
        
        collector = get_collector()
        collector.collect_for_all_vias(vias)
    except Exception as e:
        logging.exception(f"Erro crítico durante a execução do ciclo de coleta: {e}")