"""
Combustível por rota — estimativa, não medição.

Modelo de Evans, Herman & Lam (1976): litros = K1·km + K2·horas. O termo do tempo
é o que o congestionamento cobra (motor ligado parado ou arrastando), então uma
rota mais rápida pode economizar mesmo sendo um pouco mais longa — e o contrário
também aparece, sem maquiagem. Parâmetros, calibração e fontes ficam versionados em
ml/artifacts/consumo_combustivel.json.
"""
import json
import os
from typing import Optional


def carregar(caminho: str) -> Optional[dict]:
    if not os.path.exists(caminho):
        return None
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def litros(p: dict, km: float, seg: float) -> float:
    return p['k1_litros_por_km'] * km + p['k2_litros_por_hora'] * seg / 3600.0


def base_na_escala(seg_curta_lia: Optional[float], seg_lia: float, seg_misto: float) -> Optional[float]:
    """Tempo do caminho mais curto na MESMA escala do tempo exibido. O exibido mistura a
    LIA com o trânsito ao vivo (mais realista, maior); o do caminho mais curto sai só da
    LIA. Comparar os dois direto fazia a rota da LIA parecer mais lenta e mais gastona.
    O fator misto/LIA observado na própria rota vale para o caminho mais curto (mesma
    hora, mesma região)."""
    if seg_curta_lia is None:
        return None
    return seg_curta_lia * (seg_misto / seg_lia) if seg_lia > 0 else seg_curta_lia


def economia(p: Optional[dict], km_rota: float, seg_rota: float,
             km_base: Optional[float], seg_base: Optional[float]) -> Optional[dict]:
    """Rota escolhida × caminho mais curto. Negativo = gasta mais para chegar antes."""
    if p is None or km_base is None or seg_base is None:
        return None
    rota = litros(p, km_rota, seg_rota)
    poupado = litros(p, km_base, seg_base) - rota
    return {
        'litros_rota': round(rota, 3),
        'litros': round(poupado, 3),
        'reais': round(poupado * p['preco_litro_reais'], 2),
        'co2_kg': round(poupado * p['co2_kg_por_litro'], 3),
        'minutos': round((seg_base - seg_rota) / 60.0, 1),
        'preco_litro_reais': p['preco_litro_reais'],
    }
