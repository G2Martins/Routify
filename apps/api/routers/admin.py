"""
/admin — ações do painel ADM que dependem do processo da API (pool TomTom em
memória). Ações só de banco são RPCs admin_* no Supabase (auditadas lá).

Guarda: JWT validado a cada chamada + app_metadata.role = admin (seguranca.py),
limite por admin e auditoria. Nunca expõe o valor de uma chave, só o id.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Security

import usage
from openapi import erro
from seguranca import Limitador, auditar, exigir_admin, limitar

router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Security(usage.bearer)])

_limite_leitura = Limitador(60)
_limite_teste = Limitador(6)  # cada teste gasta 1 requisição de Flow da chave
ID_CHAVE = re.compile(r'^[\w.-]{1,40}$')

ERROS = {
    401: erro("Sem token ou token inválido.", "Login necessário."),
    403: erro("Conta sem papel de administrador.", "Acesso restrito a administradores."),
    429: erro("Limite por administrador excedido.", "Muitas requisições. Tente de novo em instantes."),
}


def _cliente(request: Request):
    tt = getattr(request.app.state, 'tomtom', None)
    if tt is None:
        raise HTTPException(status_code=503, detail='Cliente TomTom indisponível.')
    return tt


@router.get(
    "/tomtom",
    summary="Estado do pool TomTom",
    description="Por chave (só o id): pausada, chamadas, falhas e cooldown por serviço; mais kill switch e orçamento.",
    responses=ERROS,
)
async def estado_tomtom(request: Request, admin_id: str = Depends(exigir_admin)):
    limitar(_limite_leitura, admin_id)
    tt = _cliente(request)
    config = getattr(request.app.state, 'config', None)
    if config is not None:
        await config.atualizar(getattr(request.app.state, 'supabase', None), tt)
    return {**tt.estado(), 'config': config.valores if config is not None else None}


@router.post(
    "/tomtom/chaves/{chave_id}/testar",
    summary="Testar uma chave TomTom",
    description="Faz 1 chamada de Flow Segment Data com a chave indicada e devolve status e latência. "
                "Gasta 1 requisição da cota dessa chave. Limite: 6 testes/min por admin.",
    responses={**ERROS, 404: erro("Id de chave inexistente.", "Chave não encontrada.")},
)
async def testar_chave(
    request: Request,
    chave_id: str = Path(..., max_length=40),
    admin_id: str = Depends(exigir_admin),
):
    limitar(_limite_teste, admin_id)
    if not ID_CHAVE.match(chave_id):
        raise HTTPException(status_code=404, detail='Chave não encontrada.')
    resultado = await _cliente(request).testar_chave(chave_id)
    if resultado is None:
        raise HTTPException(status_code=404, detail='Chave não encontrada.')
    auditar(getattr(request.app.state, 'supabase', None), admin_id, 'tomtom_testar_chave', chave_id,
            {'ok': resultado['ok'], 'status': resultado['status']})
    return resultado
