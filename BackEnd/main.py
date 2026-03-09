"""
Módulo principal que orquestra todo o pipeline:
- Inicialize o banco de dados.
- Popule a tabela de vias se estiver vazia.
- Agende a coleta de tráfego a cada 10 minutos.
"""
import os
import time
import logging
import schedule
from dotenv import load_dotenv
from models import db_manager
from services import map_extractor
from services import traffic_collector

# Carregue as variáveis de ambiente do arquivo .env
load_dotenv(os.path.join('config', '.env'))

# Configure o logging para exibir informações no console
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    """
    Função principal do sistema.
    Execute a inicialização, a verificação da base de vias e o agendamento da coleta.
    """
    logging.info("Inicie o pipeline de coleta de dados com Supabase.")
    
    # Teste a conexão com o Supabase antes de prosseguir
    try:
        db_manager.get_all_vias()
        logging.info("Conexão com Supabase estabelecida com sucesso.")
    except Exception as e:
        logging.error(f"Falha na conexão com o Supabase: {e}")
        return

    # Popule a tabela de vias monitoradas caso esteja vazia
    map_extractor.populate_vias()

    # Configure a coleta de tráfego para executar a cada 10 minutos
    schedule.every(5).minutes.do(traffic_collector.run_collection)
    
    # Execute uma coleta imediata ao iniciar o sistema
    traffic_collector.run_collection()

    # Mantenha o programa em execução processando as tarefas agendadas
    while True:
        try:
            schedule.run_pending()
            time.sleep(1)
        except Exception as e:
            # Isole falhas sistêmicas para que o servidor não desligue
            logging.error(f"Falha inesperada no loop principal: {e}. Retomando processamento em 10 segundos.")
            time.sleep(10)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logging.info("Sistema interrompido manualmente pelo usuário.")
    except Exception as e:
        logging.exception(f"Erro fatal não tratado no sistema: {e}")