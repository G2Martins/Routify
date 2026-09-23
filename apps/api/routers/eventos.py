"""
POST /eventos — eventos de uso enviados pelo app (navegação, feedback, busca).

Login obrigatório (JWT Supabase), schema estrito, dados planos e pequenos, sem
coordenadas, e limite por usuário. A gravação é feita pelo servidor.
"""
import time
from collections import defaultdict, deque
from typing import Dict, Literal, Optional, Union

from fastapi import APIRouter, HTTPException, Request, Security
from pydantic import BaseModel, ConfigDict, Field, field_validator

import usage
from openapi import erro

router = APIRouter(prefix="/eventos", tags=["Uso"], dependencies=[Security(usage.bearer)])

CHAVES_PROIBIDAS = {'lat', 'lon', 'lng', 'latitude', 'longitude', 'coords', 'coordenadas', 'polyline'}
EVENTOS_POR_MINUTO = 60

Escalar = Union[str, int, float, bool, None]


class EventoInput(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={"examples": [
        {"tipo": "navegacao_iniciada", "plataforma": "web", "dados": {"distancia_km": 12.4, "via_principal": "EPTG"}},
    ]})

    tipo: Literal['busca', 'rota_solicitada', 'navegacao_iniciada', 'navegacao_concluida', 'feedback']
    plataforma: Optional[Literal['web', 'ios', 'android']] = None
    dados: Dict[str, Escalar] = Field(
        default_factory=dict, max_length=12,
        description="Até 12 chaves com valores escalares (texto ≤ 200). Coordenadas são recusadas.")

    @field_validator('dados')
    @classmethod
    def dados_planos_e_sem_localizacao(cls, dados: Dict[str, Escalar]) -> Dict[str, Escalar]:
        for chave, valor in dados.items():
            if len(chave) > 40 or chave.lower() in CHAVES_PROIBIDAS:
                raise ValueError(f"chave não permitida: {chave[:40]}")
            if isinstance(valor, str) and len(valor) > 200:
                raise ValueError(f"valor longo demais em {chave}")
        return dados


class LimitePorUsuario:
    """Janela deslizante de 60 s por usuário (memória do processo)."""

    def __init__(self, maximo: int):
        self.maximo = maximo
        self._janelas: Dict[str, deque] = defaultdict(deque)

    def permitir(self, usuario: str) -> bool:
        agora = time.monotonic()
        janela = self._janelas[usuario]
        while janela and agora - janela[0] > 60:
            janela.popleft()
        if len(janela) >= self.maximo:
            return False
        janela.append(agora)
        return True


_limite = LimitePorUsuario(EVENTOS_POR_MINUTO)


@router.post(
    "",
    status_code=202,
    summary="Registrar evento do app",
    description="Grava um evento de uso (service_role) para o painel ADM. Exige token; 60 eventos/min por usuário.",
    responses={
        202: {"content": {"application/json": {"example": {"ok": True}}}},
        401: erro("Sem token ou token inválido.", "Login necessário para registrar eventos."),
        429: erro("Limite de 60 eventos por minuto excedido.", "Muitos eventos em pouco tempo."),
    },
)
async def registrar_evento(body: EventoInput, request: Request):
    sb = getattr(request.app.state, 'supabase', None)
    user_id = await usage.usuario_do_token_async(sb, request.headers.get('authorization'))
    if user_id is None:
        raise HTTPException(status_code=401, detail="Login necessário para registrar eventos.")
    request.state.user_id = user_id
    if not _limite.permitir(user_id):
        raise HTTPException(status_code=429, detail="Muitos eventos em pouco tempo.")
    usage.registrar(sb, 'eventos_app', {
        'user_id': user_id, 'tipo': body.tipo, 'plataforma': body.plataforma, 'dados': body.dados,
    })
    return {'ok': True}
