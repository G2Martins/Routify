"""
Módulo principal que orquestra todo o pipeline:
- Inicialize o banco de dados.
- Popule a tabela de vias se estiver vazia.
- Agende a coleta de tráfego a cada 10 minutos.
"""
import asyncio
import os
import sys
import time
import logging
import schedule
from dotenv import load_dotenv
import db as db_manager
import map_extractor
import traffic_collector

# Carregue as variáveis de ambiente do arquivo .env
load_dotenv(os.path.join('config', '.env'))

# Configure o logging para exibir informações no console
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# ml/ e apps/api/ ficam na raiz do repositório (este arquivo: services/collector/) —
# external_validation.py já assume rodar a partir de dentro de ml/, e
# ele mesmo insere apps/api/ no sys.path. Só falta o próprio ml/ aqui.
ML_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'ml')
sys.path.insert(0, ML_DIR)


def run_fase3_job() -> None:
    """Roda o experimento de validação (Fase 3) e acumula no CSV dele.

    Isolado num try/except: uma falha aqui (ex. TomTom fora do ar, grafo
    corrompido) não pode derrubar o loop principal do coletor de tráfego,
    que é a função crítica deste processo. Carrega grafo+modelo do zero a
    cada chamada (ver external_validation.montar_ambiente_lia) — o pico de RAM
    (~1,4GB) é só durante a execução; as referências saem de escopo ao
    terminar e a memória volta ao patamar baixo do coletor entre uma rodada
    e outra.
    """
    try:
        import external_validation
        asyncio.run(external_validation.run())
    except Exception as e:
        logging.exception(f"Fase 3 falhou nesta rodada (coletor de tráfego não é afetado): {e}")

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

    # Wrapper que impede ciclos sobrepostos: se um ciclo demora mais que o
    # intervalo (por ex. todas as chaves esgotadas), o próximo é pulado em
    # vez de ser enfileirado. Evita backlog crescente no scheduler.
    coleta_em_andamento = {'flag': False}

    def coleta_protegida():
        if coleta_em_andamento['flag']:
            logging.warning("Ciclo anterior ainda em execução. Pulando este disparo.")
            return
        coleta_em_andamento['flag'] = True
        try:
            traffic_collector.run_collection()
        finally:
            coleta_em_andamento['flag'] = False

    # Configure a coleta de tráfego para executar a cada 8 minutos
    schedule.every(8).minutes.do(coleta_protegida)

    # Fase 3 (validação LIA vs. TomTom vs. menor distância — ver
    # PLANO_EXECUCAO_TCC2.md e LIA_2.0_AUDITORIA_E_MUDANCAS.md seção 15):
    # horários fixos, não "a cada N horas", para garantir cobertura
    # deliberada de pico e fora de pico todo dia, em vez de um período fixo
    # que sempre bate nos mesmos horários do relógio por coincidência de
    # divisor. Horários em fuso do processo — se o host rodar em UTC,
    # ajustar (Brasília = UTC-3) ou configurar TZ=America/Sao_Paulo no
    # ambiente de execução.
    schedule.every().day.at("07:00").do(run_fase3_job)  # pico manhã
    schedule.every().day.at("12:00").do(run_fase3_job)  # fora de pico
    schedule.every().day.at("18:00").do(run_fase3_job)  # pico tarde
    schedule.every().day.at("22:00").do(run_fase3_job)  # fora de pico, noite

    # Execute uma coleta imediata ao iniciar o sistema
    coleta_protegida()

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