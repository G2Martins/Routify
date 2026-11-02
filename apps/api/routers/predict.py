"""
POST /predict — Inferência LIA por ponto

LIA 2.0: o modelo prevê RAZÃO DE CONGESTIONAMENTO (velocidade_atual /
velocidade_livre), não segundos. O tempo depende do comprimento do trecho, então
só é devolvido quando o cliente informa `comprimento_m`.

Os lags da 1.0 saíram do contrato: eles nunca existiram na inferência (o cliente
não tem como saber a velocidade de 24h atrás daquela via) e eram preenchidos com
valores fabricados.
"""
import math
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import lia_inference as lia_inf
from lia_inference import BRASILIA_TZ
from recency_cache import IDADE_MAX_RECENCIA_MIN
from openapi import erro

router = APIRouter(prefix="/predict", tags=["LIA"])


INSTANTE_MIN = datetime(2000, 1, 1, tzinfo=BRASILIA_TZ)
INSTANTE_MAX = datetime(2100, 1, 1, tzinfo=BRASILIA_TZ)
# Instante pedido até 5 min no passado ainda conta como "agora" (relógios e latência).
TOLERANCIA_PASSADO_MIN = 5.0


def recencia_no_instante(recencia, minutos_ate: float):
    """A leitura ao vivo vista do instante pedido.

    Futuro: envelhece pela distância até ele e some acima de 24 h (vira o
    fallback de perfil, o caso validado). Passado: some, porque a leitura de
    agora pode ser posterior ao instante (seria olhar o futuro).
    """
    if recencia is None or minutos_ate < -TOLERANCIA_PASSADO_MIN:
        return None
    idade = math.expm1(recencia['delta_min_lag1']) + max(minutos_ate, 0.0)
    if idade > IDADE_MAX_RECENCIA_MIN:
        return None
    return {**recencia, 'delta_min_lag1': math.log1p(idade)}


class PredictInput(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={"examples": [
        {"id_ponto": 42, "velocidade_livre": 60.0, "comprimento_m": 350.0},
    ]})
    id_ponto: int = Field(..., description="ID do ponto de monitoramento")
    velocidade_livre: float = Field(
        ..., gt=0, le=300, allow_inf_nan=False, description="Velocidade livre da via em km/h"
    )
    comprimento_m: Optional[float] = Field(
        None, gt=0, le=200_000, allow_inf_nan=False,
        description="Comprimento do trecho em metros. Se informado, o tempo de "
                    "viagem é calculado; caso contrário só a razão é retornada."
    )
    timestamp_brasilia: Optional[str] = Field(
        None, description="ISO datetime em UTC-3 (opcional; default = agora)"
    )
    # LIA 2.1 — override manual da recência (avançado/teste). Por padrão a API
    # busca a última observação real da via no cache ao vivo; informar estes
    # dois campos substitui essa busca. Os dois precisam vir juntos.
    razao_ultima_observacao: Optional[float] = Field(
        None, ge=0.05, le=1.0, allow_inf_nan=False,
        description="Override: razão da última observação real conhecida da via."
    )
    minutos_desde_ultima_observacao: Optional[float] = Field(
        None, ge=0, le=525_600, allow_inf_nan=False,
        description="Override: minutos desde razao_ultima_observacao (vem junto com ela)."
    )


class PredictOutput(BaseModel):
    id_ponto: int
    razao_congestionamento: float = Field(
        ..., description="velocidade_prevista / velocidade_livre (0.05 a 1.0)"
    )
    velocidade_prevista_kmh: float
    tempo_viagem_segundos: Optional[float] = Field(
        None, description="Só preenchido quando comprimento_m é informado"
    )
    modelo_versao: str
    hora: int
    dia_semana: int


@router.post(
    "",
    response_model=PredictOutput,
    summary="Prever congestionamento de um trecho",
    description=(
        "Inferência da LIA para **uma** via monitorada, na hora atual (ou em `timestamp_brasilia`). "
        "Devolve a razão de congestionamento e, se `comprimento_m` vier, o tempo de viagem. "
        "A recência vem do cache ao vivo; os campos `*_ultima_observacao` sobrescrevem (teste)."
    ),
    responses={422: erro("Via desconhecida pelo modelo ou corpo inválido.", "id_ponto 99999 não foi visto no treino")},
)
async def predict(body: PredictInput, request: Request):
    model = request.app.state.model
    encoder = request.app.state.encoder
    profiles = request.app.state.profiles
    version = request.app.state.model_version

    if body.id_ponto not in encoder.classes_:
        raise HTTPException(
            status_code=422,
            detail=f"id_ponto {body.id_ponto} não foi visto no treino. "
                   "Verificar tabela vias_monitoradas."
        )

    if body.timestamp_brasilia:
        try:
            dt = datetime.fromisoformat(body.timestamp_brasilia)
        except ValueError:
            raise HTTPException(
                status_code=422,
                detail="timestamp_brasilia inválido. Use ISO 8601, "
                       "ex: 2026-08-11T17:30:00"
            )
        # Com offset (Z, +00:00…), converte para Brasília; sem offset, já é Brasília.
        dt = dt.astimezone(BRASILIA_TZ) if dt.tzinfo else dt.replace(tzinfo=BRASILIA_TZ)
        if not (INSTANTE_MIN <= dt < INSTANTE_MAX):
            raise HTTPException(status_code=422, detail="timestamp_brasilia fora de 2000–2099.")
    else:
        dt = datetime.now(tz=BRASILIA_TZ)
    if (body.razao_ultima_observacao is None) != (body.minutos_desde_ultima_observacao is None):
        raise HTTPException(status_code=422, detail="razao_ultima_observacao e "
                            "minutos_desde_ultima_observacao vêm juntos.")
    # Minutos de agora até o instante pedido: a leitura ao vivo envelhece até ele.
    minutos_ate = (dt - datetime.now(tz=BRASILIA_TZ)).total_seconds() / 60.0

    hora = dt.hour
    dia_semana = dt.weekday()

    # LIA 2.1: recência (razao_lag1/delta_min_lag1). Override explícito tem
    # prioridade; senão busca no cache ao vivo (getattr por segurança, caso a
    # API esteja rodando com um modelo/main.py anterior a essa feature).
    if body.razao_ultima_observacao is not None:
        recencia = {
            'razao_lag1': body.razao_ultima_observacao,
            'delta_min_lag1': lia_inf.delta_min_para_feature(body.minutos_desde_ultima_observacao),
        }
    else:
        cache = getattr(request.app.state, 'recencia_cache', None)
        if cache is not None:
            cache.refrescar_se_necessario(getattr(request.app.state, 'supabase', None))
            # None → fallback em montar_features (perfil + 24 h de defasagem)
            recencia = recencia_no_instante(cache.get(body.id_ponto), minutos_ate)
        else:
            recencia = None

    contexto_obj = getattr(request.app.state, 'contexto', None)
    contexto = None
    if contexto_obj is not None:
        await contexto_obj.atualizar_chuva()
        # Vizinhos: só leituras que ainda estariam na janela no instante pedido;
        # instante passado não usa leitura ao vivo (ela pode ser posterior a ele).
        cache_viz = getattr(request.app.state, 'recencia_cache', None) if minutos_ate >= -TOLERANCIA_PASSADO_MIN else None
        contexto = contexto_obj.para_requisicao(dt, cache_viz, max(minutos_ate, 0.0))(body.id_ponto)

    razao = lia_inf.prever_razao(
        model, encoder, profiles,
        body.id_ponto, hora, dia_semana, body.velocidade_livre,
        recencia, contexto,
    )

    vel_prevista = body.velocidade_livre * razao
    tempo = (
        lia_inf.tempo_de_razao(body.comprimento_m, body.velocidade_livre, razao)
        if body.comprimento_m is not None else None
    )

    return PredictOutput(
        id_ponto=body.id_ponto,
        razao_congestionamento=round(razao, 4),
        velocidade_prevista_kmh=round(vel_prevista, 1),
        tempo_viagem_segundos=round(tempo, 1) if tempo is not None else None,
        modelo_versao=version,
        hora=hora,
        dia_semana=dia_semana,
    )
