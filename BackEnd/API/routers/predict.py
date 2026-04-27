"""
POST /predict — Inferência LIA por ponto
Dado um id_ponto + contexto temporal, retorna tempo_viagem_segundos predito.
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, Field
import numpy as np

router = APIRouter(prefix="/predict", tags=["LIA Predict"])

BRASILIA_TZ = timezone(timedelta(hours=-3))

FEATURE_ORDER = [
    'id_ponto_enc',
    'hora',
    'dia_semana',
    'is_fim_semana',
    'is_horario_pico',
    'velocidade_livre',
    'lag_vel_1h',
    'lag_vel_3h',
    'lag_vel_24h',
    'lag_vel_7d',
    'rolling_mean_6h',
    'rolling_std_6h',
    'lag_tempo_1h',
    'lag_tempo_24h',
]


class PredictInput(BaseModel):
    id_ponto: int = Field(..., description="ID do ponto de monitoramento")
    velocidade_livre: float = Field(..., description="Velocidade livre da via em km/h")
    # Lags opcionais — se não informados usa médias históricas (fallback)
    lag_vel_1h: float = Field(None, description="Velocidade 1h atrás (km/h)")
    lag_vel_3h: float = Field(None, description="Velocidade 3h atrás (km/h)")
    lag_vel_24h: float = Field(None, description="Velocidade 24h atrás (km/h)")
    lag_vel_7d: float = Field(None, description="Velocidade 7 dias atrás (km/h)")
    rolling_mean_6h: float = Field(None, description="Média móvel 6h (km/h)")
    rolling_std_6h: float = Field(None, description="Desvio padrão 6h (km/h)")
    lag_tempo_1h: float = Field(None, description="Tempo viagem 1h atrás (seg)")
    lag_tempo_24h: float = Field(None, description="Tempo viagem 24h atrás (seg)")
    # Timestamp opcional — usa horário atual Brasília se não informado
    timestamp_brasilia: str = Field(None, description="ISO datetime em UTC-3 (opcional)")


class PredictOutput(BaseModel):
    id_ponto: int
    tempo_viagem_segundos: float
    modelo_versao: str
    hora: int
    dia_semana: int


@router.post("/", response_model=PredictOutput)
async def predict(body: PredictInput, request: Request):
    model = request.app.state.model
    encoder = request.app.state.encoder
    version = request.app.state.model_version

    # Encode id_ponto
    if body.id_ponto not in encoder.classes_:
        raise HTTPException(
            status_code=422,
            detail=f"id_ponto {body.id_ponto} não foi visto no treino. "
                   "Verificar tabela vias_monitoradas."
        )
    id_ponto_enc = int(encoder.transform([body.id_ponto])[0])

    # Contexto temporal
    if body.timestamp_brasilia:
        dt = datetime.fromisoformat(body.timestamp_brasilia)
    else:
        dt = datetime.now(tz=BRASILIA_TZ)

    hora = dt.hour
    dia_semana = dt.weekday()
    is_fim_semana = int(dia_semana >= 5)
    is_horario_pico = int(hora in {6, 7, 8, 17, 18, 19})

    # Fallback para lags não informados: usa velocidade_livre como aproximação
    vel_fallback = body.velocidade_livre
    tempo_fallback = (body.velocidade_livre / 3.6) if body.velocidade_livre > 0 else 60.0

    features = {
        'id_ponto_enc': id_ponto_enc,
        'hora': hora,
        'dia_semana': dia_semana,
        'is_fim_semana': is_fim_semana,
        'is_horario_pico': is_horario_pico,
        'velocidade_livre': body.velocidade_livre,
        'lag_vel_1h': body.lag_vel_1h if body.lag_vel_1h is not None else vel_fallback,
        'lag_vel_3h': body.lag_vel_3h if body.lag_vel_3h is not None else vel_fallback,
        'lag_vel_24h': body.lag_vel_24h if body.lag_vel_24h is not None else vel_fallback,
        'lag_vel_7d': body.lag_vel_7d if body.lag_vel_7d is not None else vel_fallback,
        'rolling_mean_6h': body.rolling_mean_6h if body.rolling_mean_6h is not None else vel_fallback,
        'rolling_std_6h': body.rolling_std_6h if body.rolling_std_6h is not None else 5.0,
        'lag_tempo_1h': body.lag_tempo_1h if body.lag_tempo_1h is not None else tempo_fallback,
        'lag_tempo_24h': body.lag_tempo_24h if body.lag_tempo_24h is not None else tempo_fallback,
    }

    X = [[features[f] for f in FEATURE_ORDER]]
    pred = float(model.predict(X)[0])
    pred = max(1.0, pred)  # nunca prever tempo negativo

    return PredictOutput(
        id_ponto=body.id_ponto,
        tempo_viagem_segundos=round(pred, 1),
        modelo_versao=version,
        hora=hora,
        dia_semana=dia_semana,
    )
