"""
Módulo de conexão com o Supabase.
Gerencie a comunicação com o banco de dados e as inserções em lote.
"""
import os
import logging
from typing import List, Tuple, Optional
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("SUPABASE_URL e SUPABASE_KEY devem estar definidas no .env")

_client: Optional[Client] = None

def get_client() -> Client:
    """Retorne a instância global do cliente Supabase."""
    global _client
    if _client is None:
        # Pylance fix: Forçamos o tipo para str para garantir a assinatura da função
        _client = create_client(str(SUPABASE_URL), str(SUPABASE_KEY))
    return _client

def is_malha_empty() -> bool:
    """Verifique se a tabela de malha completa (mapa bruto) está vazia."""
    try:
        client = get_client()
        # Pylance fix: Em vez de usar count='exact', limitamos a 1 registro e medimos o tamanho
        response = client.table('malha_completa').select('id_via').limit(1).execute()
        return len(response.data) == 0
    except Exception as e:
        logging.error(f"Erro ao verificar tabela malha_completa: {e}")
        raise

def is_vias_empty() -> bool:
    """Verifique se a tabela de vias monitoradas (IA) está vazia."""
    try:
        client = get_client()
        response = client.table('vias_monitoradas').select('id_ponto').limit(1).execute()
        return len(response.data) == 0
    except Exception as e:
        logging.error(f"Erro ao verificar tabela vias_monitoradas: {e}")
        raise

def insert_malha_batch(malha: List[dict]) -> None:
    """
    Insira os dados brutos do mapa em blocos de 1000 registros.
    Evite sobrecarga na API do Supabase.
    """
    try:
        client = get_client()
        chunk_size = 1000
        for i in range(0, len(malha), chunk_size):
            chunk = malha[i:i + chunk_size]
            # Pylance fix: O supabase-py v2+ dispara exceções nativamente em falhas de inserção
            client.table('malha_completa').insert(chunk).execute()
            
        logging.info(f"{len(malha)} segmentos brutos inseridos na malha_completa com sucesso.")
    except Exception as e:
        logging.error(f"Erro ao inserir malha bruta: {e}")
        raise

def insert_vias(vias: List[Tuple[str, float, float, Optional[str]]]) -> None:
    """Insira os pontos estratégicos filtrados para o monitoramento da TomTom."""
    registros = [{'nome_via': n, 'latitude': lat, 'longitude': lon, 'descricao': desc}
                 for n, lat, lon, desc in vias]
    try:
        client = get_client()
        client.table('vias_monitoradas').insert(registros).execute()
        logging.info(f"{len(registros)} pontos estratégicos inseridos em vias_monitoradas.")
    except Exception as e:
        logging.error(f"Erro ao inserir vias monitoradas: {e}")
        raise

def get_all_vias() -> List[Tuple[int, str, float, float]]:
    """Busque todos os pontos estratégicos ativos para a coleta de tráfego."""
    try:
        client = get_client()
        response = client.table('vias_monitoradas').select('id_ponto, nome_via, latitude, longitude').execute()
        return [(item['id_ponto'], item['nome_via'], float(item['latitude']), float(item['longitude']))
                for item in response.data]
    except Exception as e:
        logging.error(f"Erro ao buscar vias: {e}")
        raise

def insert_historico_batch(historico: List[Tuple[int, float, float, float, float]]) -> None:
    """Insira o histórico de tráfego coletado na TomTom em lote."""
    registros = [{'id_ponto': idp, 'velocidade_atual': va, 'velocidade_livre': vl,
                  'tempo_viagem_segundos': tv, 'confianca': conf}
                 for idp, va, vl, tv, conf in historico]
    try:
        client = get_client()
        client.table('historico_trafego').insert(registros).execute()
        logging.info(f"{len(registros)} registros preditivos inseridos no banco.")
    except Exception as e:
        logging.error(f"Erro ao inserir histórico: {e}")
        raise