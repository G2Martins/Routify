"""
Publica as métricas da LIA no Supabase para o painel ADM (tabelas lia_treinos e
lia_analises): o acompanhamento contínuo das figuras pedidas pelo orientador.

Lê só artefatos versionados em artifacts/*.json (número da tese vem de artefato)
e grava com o service_role do .env do coletor. Rodar depois de cada treino:

    python publish_metrics.py

Re-treinos extras entram sozinhos se salvos como artifacts/<versao>_retreino_<data>_metadata.json.
"""
import json
import os
import sys

from dotenv import load_dotenv
from supabase import create_client

AQUI = os.path.dirname(os.path.abspath(__file__))
ARTEFATOS = os.path.join(AQUI, 'artifacts')
load_dotenv(os.path.join(AQUI, '..', 'services', 'collector', 'config', '.env'))


def _json(nome):
    caminho = os.path.join(ARTEFATOS, nome)
    if not os.path.exists(caminho):
        return None
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def _linha_cv(versao, fonte, meta, cv, detalhes=None):
    """Linha de lia_treinos a partir de um metadata com bloco 'cv' (formato LIA 2.x)."""
    return {
        'versao': versao, 'validacao': 'temporal', 'fonte': fonte,
        'mae_seg': cv.get('modelo_mae_seg'), 'mae_seg_std': cv.get('modelo_mae_seg_std'),
        'rmse_seg': cv.get('modelo_rmse_seg'), 'rmse_seg_std': cv.get('modelo_rmse_seg_std'),
        'baseline_mae_seg': cv.get('baseline_mae_seg'), 'baseline_rmse_seg': cv.get('baseline_rmse_seg'),
        'rmse_congestionado_seg': cv.get('modelo_rmse_seg_congestionado'),
        'baseline_rmse_congestionado_seg': cv.get('baseline_rmse_seg_congestionado'),
        'total_amostras': meta.get('total_amostras'),
        'periodo_inicio': meta.get('periodo_inicio'), 'periodo_fim': meta.get('periodo_fim'),
        'detalhes': detalhes or {'pct_congestionado': meta.get('pct_congestionado')},
    }


def linhas_treinos():
    linhas = []
    cv21 = (_json('lia_2.1_metadata.json') or {}).get('cv', {})

    v10 = _json('lia_1.0_supabase_metadata.json')
    if v10:
        linhas.append({
            'versao': 'lia_1.0', 'validacao': 'nao_temporal', 'fonte': 'lia_1.0_supabase_metadata.json',
            'mae_seg': v10.get('cv_mae_medio_seg'), 'rmse_seg': v10.get('cv_rmse_medio_seg'),
            'rmse_seg_std': v10.get('cv_rmse_std_seg'), 'total_amostras': v10.get('total_amostras'),
            'periodo_inicio': v10.get('periodo_inicio'), 'periodo_fim': v10.get('periodo_fim'),
            'detalhes': {'nota': 'CV ordenada por via (não temporal) e alvo em segundos por trecho — não comparável.'},
        })

    bench = _json('benchmark_lstm_vs_xgboost.json')
    if bench:
        x = bench['xgboost']
        linhas.append({
            'versao': 'lia_2.0', 'validacao': 'temporal', 'fonte': 'benchmark_lstm_vs_xgboost.json › xgboost',
            'mae_seg': x['mae_seg_media'], 'mae_seg_std': x['mae_seg_std'],
            'rmse_seg': x['rmse_seg_media'], 'rmse_seg_std': x['rmse_seg_std'],
            'baseline_mae_seg': cv21.get('baseline_mae_seg'), 'baseline_rmse_seg': cv21.get('baseline_rmse_seg'),
            'total_amostras': (_json('lia_2.0_metadata.json') or {}).get('total_amostras'),
            'detalhes': {'nota': 'O metadata da 2.0 não persistiu o CV; números do benchmark (mesmos cortes temporais).'},
        })

    v21 = _json('lia_2.1_metadata.json')
    if v21:
        linhas.append(_linha_cv('lia_2.1', 'lia_2.1_metadata.json › cv', v21, cv21))

    for nome in sorted(os.listdir(ARTEFATOS)):
        if '_retreino_' in nome and nome.endswith('_metadata.json'):
            meta = _json(nome)
            linhas.append(_linha_cv(nome.replace('_metadata.json', ''), nome, meta, meta.get('cv', {})))
    return linhas


def main():
    url, chave = os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_KEY')
    if not url or not chave:
        sys.exit('SUPABASE_URL/SUPABASE_KEY ausentes (services/collector/config/.env).')
    sb = create_client(url, chave)

    treinos = linhas_treinos()
    sb.table('lia_treinos').upsert(treinos, on_conflict='versao').execute()

    analises = [{'chave': chave_analise, 'dados': dados} for chave_analise, dados in (
        ('calibracao_transfer', _json('calibracao_transfer.json')),
        ('benchmark_lstm_xgboost', _json('benchmark_lstm_vs_xgboost.json')),
    ) if dados]
    sb.table('lia_analises').upsert(analises, on_conflict='chave').execute()
    print(f"Publicado: {len(treinos)} versões ({', '.join(t['versao'] for t in treinos)}) e {len(analises)} análises.")


if __name__ == '__main__':
    main()
