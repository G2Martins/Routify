"""
Módulo responsável por extrair a malha viária de Brasília via OSMnx.
Execute a carga bruta do mapa focando apenas no núcleo urbano do DF 
com sistema de resiliência e retentativas em múltiplos servidores.
"""
import logging
import time
import osmnx as ox
from osmnx import settings # Pylance fix: Importação direta do módulo de configurações
from shapely.geometry import LineString
import pandas as pd

# Atualização de Importação devido à nova arquitetura de pastas
from models import db_manager

# Configure o logging do seu sistema
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- CONFIGURAÇÕES CRÍTICAS DO OSMNX ---
settings.log_console = True 
settings.requests_timeout = 180  
settings.use_cache = True 
settings.overpass_rate_limit = False  

# Servidores espelho do OpenStreetMap para fugir do bloqueio de IP
SERVIDORES_OVERPASS = [
    "https://overpass-api.de/api",
    "https://lz4.overpass-api.de/api",
    "https://z.overpass-api.de/api",
    "https://overpass.kumi.systems/api"
]

# Defina as regiões específicas de estudo para otimizar o grafo
REGIOES_ALVO = [
    'Águas Claras, Distrito Federal, Brasil',
    'Plano Piloto, Distrito Federal, Brasil',
    'Taguatinga, Distrito Federal, Brasil',
    'Guará, Distrito Federal, Brasil',
    'Núcleo Bandeirante, Distrito Federal, Brasil',
    'Riacho Fundo, Distrito Federal, Brasil',
    'Samambaia, Distrito Federal, Brasil',
    'Ceilândia, Distrito Federal, Brasil',
    'Cruzeiro, Distrito Federal, Brasil',
    'Sudoeste, Distrito Federal, Brasil',
    'Octogonal, Distrito Federal, Brasil',
    'Setor de Indústria e Abastecimento, Distrito Federal, Brasil',
    'Vicente Pires, Distrito Federal, Brasil',
    'Lago Sul, Distrito Federal, Brasil',
    'Lago Norte, Distrito Federal, Brasil'
]

# Pylance fix: Adicionado type hint -> tuple para evitar falso positivo de NoReturn
def extract_and_process_brasilia_roads() -> tuple:
    """
    Baixe os grafos com rotação de servidores para evitar bloqueio de IP,
    combine os dados e aplique a amostragem estratégica para a IA.
    """
    logging.info("Iniciando extração segmentada da malha viária do DF via OSMnx.")
    lista_edges = []

    for regiao in REGIOES_ALVO:
        logging.info(f"Iniciando download da região: {regiao}...")
        sucesso = False
        tentativas = 0
        max_tentativas = 4 

        while not sucesso and tentativas < max_tentativas:
            try:
                # Rotaciona o servidor a cada tentativa para fugir do bloqueio de IP
                settings.overpass_endpoint = SERVIDORES_OVERPASS[tentativas % len(SERVIDORES_OVERPASS)]
                
                tentativas += 1
                if tentativas > 1:
                    logging.info(f"Tentativa {tentativas}/{max_tentativas} para {regiao} usando servidor alternativo ({settings.overpass_endpoint})...")
                
                grafo_regional = ox.graph_from_place(regiao, network_type='drive', simplify=True)
                edges_regional = ox.graph_to_gdfs(grafo_regional, nodes=False, edges=True)
                
                lista_edges.append(edges_regional)
                sucesso = True
                logging.info(f"Sucesso ao mapear a região: {regiao}!")
                
            except Exception as e:
                logging.warning(f"O servidor falhou ao responder para '{regiao}'. Erro: {e}")
                if tentativas < max_tentativas:
                    logging.info("Aguardando 5 segundos antes de trocar de servidor...")
                    time.sleep(5)
                else:
                    logging.error(f"Esgotadas as {max_tentativas} tentativas para {regiao}. O mapa ficará sem essa cidade.")

    if not lista_edges:
        raise ValueError("Nenhuma malha viária foi extraída com sucesso. Verifique a conexão com a internet.")

    logging.info("Consolidando grafos e removendo duplicatas nas fronteiras...")
    edges_consolidados = pd.concat(lista_edges, ignore_index=True)
    
    edges_consolidados['geom_wkt'] = edges_consolidados.geometry.apply(lambda g: g.wkt)
    edges = edges_consolidados.drop_duplicates(subset=['geom_wkt']).copy()
    edges = edges.drop(columns=['geom_wkt'])

    malha_bruta_dicts = []
    arteriais_brutas = {}

    logging.info("Extraindo coordenadas e classificando as vias consolidadas...")
    for _, row in edges.iterrows():
        nome_via = row.get('name', None)
        if isinstance(nome_via, list):
            nome_via = nome_via[0]
            
        if pd.isna(nome_via) or not nome_via:
            continue

        geometria = row.geometry
        if not isinstance(geometria, LineString):
            continue

        ponto_central = geometria.interpolate(0.5, normalized=True)
        lat = ponto_central.y
        lon = ponto_central.x
        tipo_via = row['highway'] if isinstance(row['highway'], str) else str(row['highway'])

        malha_bruta_dicts.append({
            'nome_via': str(nome_via),
            'tipo_via': tipo_via,
            'latitude': float(lat),
            'longitude': float(lon)
        })

        if tipo_via in ['motorway', 'trunk', 'primary']:
            if nome_via not in arteriais_brutas:
                arteriais_brutas[nome_via] = []
            arteriais_brutas[nome_via].append((lat, lon, tipo_via))

    vias_monitoradas_amostra = []
    for nome, segmentos in arteriais_brutas.items():
        segmentos_selecionados = segmentos[::6] 
        for lat, lon, tipo in segmentos_selecionados:
            vias_monitoradas_amostra.append((nome, lat, lon, f"Via expressa ({tipo})"))

    logging.info(f"Concluído: {len(malha_bruta_dicts)} segmentos brutos e {len(vias_monitoradas_amostra)} pontos para monitoramento gerados.")
    return malha_bruta_dicts, vias_monitoradas_amostra

def populate_vias() -> None:
    """
    Orquestre a carga de dados no banco verificando as tabelas.
    """
    malha_vazia = db_manager.is_malha_empty()
    monitoradas_vazia = db_manager.is_vias_empty()

    if not malha_vazia and not monitoradas_vazia:
        logging.info("As tabelas já estão populadas no Supabase. Puxando dados do banco.")
        return

    malha_bruta, vias_estrategicas = extract_and_process_brasilia_roads()

    if malha_vazia and malha_bruta:
        logging.info("Injetando malha_completa no banco de dados...")
        db_manager.insert_malha_batch(malha_bruta)

    if monitoradas_vazia and vias_estrategicas:
        logging.info("Injetando vias_monitoradas no banco de dados...")
        db_manager.insert_vias(vias_estrategicas)