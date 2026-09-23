"""
Contrato de inferência da LIA 2.0 — fonte única de verdade.

Espelha ml/features.py. Qualquer mudança na ordem das
features, na cascata de perfis ou na fórmula de conversão precisa acontecer nos
dois lados; caso contrário o modelo recebe as colunas trocadas e devolve valores
plausíveis mas errados, sem erro nenhum.

O modelo prevê RAZÃO DE CONGESTIONAMENTO (velocidade_atual / velocidade_livre),
não segundos. A razão é adimensional, então a mesma predição serve para arestas
de qualquer comprimento — basta converter com tempo_de_razao().

RECÊNCIA (razao_lag1, delta_min_lag1)
--------------------------------------
Adicionada em 18/08/2026 depois do benchmark XGBoost vs. LSTM (ver
LIA_2.0_AUDITORIA_E_MUDANCAS.md seção 11): a vantagem que o LSTM aparentava ter
vinha quase inteira de enxergar a última observação real da via, não da
arquitetura recorrente. Dar essa mesma informação ao XGBoost fechou a diferença
(RMSE 41,0s vs 41,5s do LSTM), sem GPU e treinando 3,4x mais rápido.

Ao contrário dos perfis (agregados fixos, vêm do artefato .pkl), a recência
muda a cada ciclo de coleta — por isso não é passada como parâmetro estático:
route.py e predict.py consultam recency_cache.py, que mantém em memória a
observação mais recente de cada via, com TTL curto. Quando não há observação
disponível (via nova, cache ainda não populado, Supabase fora do ar),
recencia_fallback() assume o perfil histórico da faixa com defasagem de 24h —
o modelo aprendeu que um delta grande desconta razao_lag1, então o efeito
prático é cair de volta no perfil, que já era o comportamento antes desta
mudança.
"""
import math
from typing import Dict, List, Optional

HORARIOS_PICO = {6, 7, 8, 17, 18, 19}

# Ordem EXATA de features.FEATURE_COLS
# (BASE_FEATURES + PROFILE_FEATURES + RECENCY_FEATURES).
LIA_FEATURE_ORDER = [
    'id_ponto_enc', 'hora', 'dia_semana', 'hora_sin', 'hora_cos',
    'is_fim_semana', 'is_horario_pico', 'velocidade_livre',
    'perfil_via_hora_dow', 'perfil_via_hora', 'perfil_via', 'perfil_hora_dow',
    'perfil_via_hora_dow_std', 'perfil_via_hora_dow_n',
    'razao_lag1', 'delta_min_lag1',
]

RAZAO_MIN = 0.05
RAZAO_MAX = 1.0

# Ausência de dado de recência: assume a última observação como tendo 24h de
# idade. Mesma transformação log1p usada no treino (features.py).
DELTA_MIN_FALLBACK = 24 * 60


def delta_min_para_feature(minutos: float) -> float:
    """log1p dos minutos decorridos — mesma transformação do treino.

    Comprime a cauda longa de gaps (a coleta é intermitente; p99 do intervalo
    real chega a ~1.400 min) sem descartar a informação, ao contrário da
    reindexação para frequência fixa que quebrou a Fase 0.
    """
    return math.log1p(max(minutos, 0.0))


def recencia_fallback(perfis_linha: dict) -> Dict[str, float]:
    """Recência para quando não há observação recente disponível.

    razao_lag1 usa o próprio perfil histórico da faixa — o melhor palpite sem
    dado ao vivo, e o mesmo valor que a LIA 2.0 (sem recência) já usava.
    delta_min_lag1 assume 24h de defasagem, para o modelo tratar essa
    informação como pouco confiável.
    """
    return {
        'razao_lag1': perfis_linha['perfil_via_hora_dow'],
        'delta_min_lag1': delta_min_para_feature(DELTA_MIN_FALLBACK),
    }


def _get_escalar(serie, chave, default: float) -> float:
    """Lê um escalar de uma Series com MultiIndex.

    Series.get() com tupla pode devolver uma sub-Series em vez de escalar quando
    a chave é parcial, então validamos o tipo antes de aceitar o valor.
    """
    try:
        v = serie.get(chave)
    except (KeyError, TypeError):
        return default
    if v is None:
        return default
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    return default if v != v else v  # NaN → default


def lookup_perfis(profiles: dict, id_ponto, hora: int, dia_semana: int) -> dict:
    """Reproduz features.apply_profiles() para uma única linha.

    Mesma cascata do treino: (via,hora,dow) → (via,hora) → (via) → (hora,dow)
    → mediana global. Uma via desconhecida cai no perfil global do horário — é
    isso que sustenta o knowledge transfer para arestas não monitoradas.
    """
    g = float(profiles['global'])

    p_hd = _get_escalar(profiles['hora_dow'], (hora, dia_semana), g)

    if id_ponto is None:
        p_v = p_vh = p_vhd = p_hd
        return {
            'perfil_via_hora_dow': p_vhd,
            'perfil_via_hora': p_vh,
            'perfil_via': p_v,
            'perfil_hora_dow': p_hd,
            'perfil_via_hora_dow_std': 0.0,
            'perfil_via_hora_dow_n': 0,
        }

    p_v = _get_escalar(profiles['via'], id_ponto, p_hd)
    p_vh = _get_escalar(profiles['via_hora'], (id_ponto, hora), p_v)

    p_vhd, p_std, p_n = p_vh, 0.0, 0
    try:
        linha = profiles['via_hora_dow'].loc[(id_ponto, hora, dia_semana)]
        v = float(linha['perfil_via_hora_dow'])
        if v == v:  # não-NaN
            p_vhd = v
        s = float(linha['perfil_via_hora_dow_std'])
        p_std = 0.0 if s != s else s
        p_n = int(linha['perfil_via_hora_dow_n'])
    except (KeyError, TypeError, ValueError):
        pass  # faixa sem amostra — a cascata já cobriu com p_vh

    return {
        'perfil_via_hora_dow': p_vhd,
        'perfil_via_hora': p_vh,
        'perfil_via': p_v,
        'perfil_hora_dow': p_hd,
        'perfil_via_hora_dow_std': p_std,
        'perfil_via_hora_dow_n': p_n,
    }


def montar_features(id_ponto_enc: int, hora: int, dia_semana: int,
                    vel_livre: float, perfis_linha: dict,
                    recencia: Optional[dict] = None) -> List[float]:
    """recencia: {'razao_lag1':.., 'delta_min_lag1':..} já transformada (ver
    delta_min_para_feature). Se None, usa recencia_fallback(perfis_linha).
    """
    linha = {
        'id_ponto_enc': id_ponto_enc,
        'hora': hora,
        'dia_semana': dia_semana,
        'hora_sin': math.sin(2 * math.pi * hora / 24),
        'hora_cos': math.cos(2 * math.pi * hora / 24),
        'is_fim_semana': int(dia_semana >= 5),
        'is_horario_pico': int(hora in HORARIOS_PICO),
        'velocidade_livre': vel_livre,
        **perfis_linha,
        **(recencia if recencia is not None else recencia_fallback(perfis_linha)),
    }
    return [float(linha[c]) for c in LIA_FEATURE_ORDER]


def clamp_razao(razao: float) -> float:
    return min(max(razao, RAZAO_MIN), RAZAO_MAX)


def tempo_de_razao(length_m: float, vel_livre: float, razao: float) -> float:
    """Converte razão de congestionamento em segundos para uma aresta concreta.

    A LIA 1.0 previa segundos de um trecho monitorado (45m a 22km conforme o
    ponto) e reaproveitava esse número em arestas OSM de outro tamanho. Aqui o
    comprimento entra explicitamente, então a predição transfere corretamente.
    """
    vel_efetiva = max(vel_livre * clamp_razao(razao), 1.0)  # km/h
    return max(1.0, length_m / (vel_efetiva / 3.6))


def prever_razao(model, encoder, profiles, id_ponto, hora: int,
                 dia_semana: int, vel_livre: float,
                 recencia: Optional[dict] = None) -> float:
    """Prediz a razão de congestionamento para (via, horário, dia).

    recencia: ver montar_features(). Omitir cai no fallback conservador —
    compatível com modelos treinados sem RECENCY_FEATURES (a chave só é usada
    se o próprio modelo tiver sido treinado com ela).
    """
    if id_ponto is not None and id_ponto in encoder.classes_:
        id_ponto_enc = int(encoder.transform([id_ponto])[0])
    else:
        id_ponto_enc = 0
        id_ponto = None

    perfis_linha = lookup_perfis(profiles, id_ponto, hora, dia_semana)
    features = montar_features(id_ponto_enc, hora, dia_semana, vel_livre, perfis_linha, recencia)
    return clamp_razao(float(model.predict([features])[0]))
