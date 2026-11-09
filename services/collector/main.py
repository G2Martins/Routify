"""
Módulo principal que orquestra todo o pipeline:
- Testa a conexão com o Supabase.
- Popula a malha/vias só se as tabelas estiverem vazias (import tardio do OSMnx).
- Agenda a coleta de tráfego com cadência dimensionada pela cota da TomTom
  (ou COLETOR_INTERVALO_MIN) e, opcionalmente, a Fase 3 (COLETOR_FASE3=1).
"""
import asyncio
import os
import sys
import time
import logging
import schedule
from datetime import datetime
from dotenv import load_dotenv
import db as db_manager
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

# Fase 3 carrega grafo + modelo (~1,4 GB de pico): opt-in. Fica desligada por
# padrão porque na EC2 de 2 GB ela roda ao lado da API (~0,8 GB).
FASE3_ATIVA = os.getenv('COLETOR_FASE3', '0') == '1'


def intervalo_coleta(n_chaves: int, n_pontos: int) -> int:
    """COLETOR_INTERVALO_MIN manda; sem ele, o menor intervalo que cabe na cota."""
    env = os.getenv('COLETOR_INTERVALO_MIN')
    if env:
        return max(1, int(env))
    return traffic_collector.intervalo_minutos(n_chaves, n_pontos)


def bootstrap_malha() -> None:
    """Popula malha_completa/vias_monitoradas só quando estão vazias.

    O import do map_extractor (OSMnx, pandas, shapely) fica aqui dentro: o host
    de produção só instala deploy/requirements-ec2.txt, sem essas libs.
    """
    if not db_manager.is_malha_empty() and not db_manager.is_vias_empty():
        logging.info("As tabelas da malha já estão populadas no Supabase.")
        return
    import map_extractor
    map_extractor.populate_vias()


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
        vias = db_manager.get_all_vias()
        logging.info(f"Conexão com Supabase estabelecida com sucesso ({len(vias)} vias monitoradas).")
    except Exception as e:
        logging.error(f"Falha na conexão com o Supabase: {e}")
        return

    # Popule a tabela de vias monitoradas caso esteja vazia
    bootstrap_malha()

    # Wrapper que impede ciclos sobrepostos: se um ciclo demora mais que o
    # intervalo (por ex. todas as chaves esgotadas), o próximo é pulado em
    # vez de ser enfileirado. Evita backlog crescente no scheduler.
    coleta_em_andamento = {'flag': False, 'ultimo': None}
    fixo = bool(os.getenv('COLETOR_INTERVALO_MIN'))

    def coleta_protegida():
        if coleta_em_andamento['flag']:
            logging.warning("Ciclo anterior ainda em execução. Pulando este disparo.")
            return
        agora = time.time()
        desde = None if coleta_em_andamento['ultimo'] is None else (agora - coleta_em_andamento['ultimo']) / 60
        if not fixo and traffic_collector.pular_na_madrugada(datetime.now().hour, desde):
            return
        coleta_em_andamento['flag'], coleta_em_andamento['ultimo'] = True, agora
        try:
            traffic_collector.run_collection()
        finally:
            coleta_em_andamento['flag'] = False

    n_chaves = len(traffic_collector.API_KEYS_DATA)
    intervalo = intervalo_coleta(n_chaves, max(len(vias), 1))
    if not fixo:
        intervalo = traffic_collector.intervalo_diurno(n_chaves, max(len(vias), 1))
    logging.info(
        f"Cadência: 1 ciclo a cada {intervalo} min (de madrugada, a cada {traffic_collector.NOITE_INTERVALO_MIN}) "
        f"com {n_chaves} chaves × {traffic_collector.COTA_MENSAL_FLOW}/mês, {len(vias)} pontos, "
        f"reserva de {traffic_collector.RESERVA_API:.0%} pra API"
        + (" (fixado por COLETOR_INTERVALO_MIN)" if os.getenv('COLETOR_INTERVALO_MIN') else "")
    )
    schedule.every(intervalo).minutes.do(coleta_protegida)

    # Fase 3 (validação LIA vs. TomTom vs. menor distância): horários fixos,
    # não "a cada N horas", para cobrir pico e fora de pico todo dia. Horários
    # no fuso do processo — o host precisa de TZ=America/Sao_Paulo.
    if FASE3_ATIVA:
        for hora in ("07:00", "12:00", "18:00", "22:00"):
            schedule.every().day.at(hora).do(run_fase3_job)
        logging.info("Fase 3 agendada (07h, 12h, 18h, 22h).")
    else:
        logging.info("Fase 3 desligada (COLETOR_FASE3=1 para ligar).")

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
