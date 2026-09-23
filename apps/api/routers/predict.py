"""
POST /predict — Inferência LIA por ponto

LIA 2.0: o modelo prevê RAZÃO DE CONGESTIONAMENTO (velocidade_atual /
velocidade_livre), não segundos. O tempo depende do comprimento do trecho, então
só é devolvido quando o cliente informa `comprimento_m`.

Os lags da 1.0 saíram do contrato: eles nunca existiram na inferência (o cliente
não tem como saber a velocidade de 24h atrás daquela via) e eram preenchidos com
valores fabricados.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import lia_inference as lia_inf
from lia_inference import BRASILIA_TZ
from openapi import erro

router = APIRouter(prefix="/predict", tags=["LIA"])


class PredictInput(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={"examples": [
        {"id_ponto": 42, "velocidade_livre": 60.0, "comprimento_m": 350.0},
    ]})
    id_ponto: int = Field(..., description="ID do ponto de monitoramento")
    velocidade_livre: float = Field(
        ..., gt=0, description="Velocidade livre da via em km/h"
    )
    comprimento_m: Optional[float] = Field(
        None, gt=0,
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
        None, ge=0.05, le=1.0,
        description="Override: razão da última observação real conhecida da via."
    )
    minutos_desde_ultima_observacao: Optional[float] = Field(
        None, ge=0,
        description="Override: minutos desde razao_ultima_observacao. "
                    "Ignorado se razao_ultima_observacao não for informado."
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
    else:
        dt = datetime.now(tz=BRASILIA_TZ)

    hora = dt.hour
    dia_semana = dt.weekday()

    # LIA 2.1: recência (razao_lag1/delta_min_lag1). Override explícito tem
    # prioridade; senão busca no cache ao vivo (getattr por segurança, caso a
    # API esteja rodando com um modelo/main.py anterior a essa feature).
    if body.razao_ultima_observacao is not None:
        recencia = {
            'razao_lag1': body.razao_ultima_observacao,
            'delta_min_lag1': lia_inf.delta_min_para_feature(
                body.minutos_desde_ultima_observacao or 0.0
            ),
        }
    else:
        cache = getattr(request.app.state, 'recencia_cache', None)
        if cache is not None:
            cache.refrescar_se_necessario(getattr(request.app.state, 'supabase', None))
            recencia = cache.get(body.id_ponto)  # None → fallback em montar_features
        else:
            recencia = None

    razao = lia_inf.prever_razao(
        model, encoder, profiles,
        body.id_ponto, hora, dia_semana, body.velocidade_livre,
        recencia,
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
