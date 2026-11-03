"""
Códigos de recuperação da verificação em duas etapas (TOTP do Supabase Auth, que não tem os seus).
Sem eles, quem perdia o celular dependia de um admin apagar o fator no painel do Supabase.

  POST /mfa/codigos-recuperacao   sessão aal2 → 10 códigos novos, mostrados uma vez (os antigos deixam de valer)
  POST /mfa/recuperar             sessão aal1 (senha certa) + 1 código → remove os fatores TOTP da conta

Gerar exige aal2: só com a senha ninguém cria um código para desligar o 2º fator. O banco guarda só o
SHA-256 de cada código (80 bits aleatórios; força bruta offline inviável) em mfa_codigos_recuperacao, sem
policy: só a service_role lê (supabase/migrations/20261102030000_mfa_codigos_recuperacao.sql). Cada código
vale uma vez: o UPDATE com `usado_em is null` é a trava contra dois usos ao mesmo tempo. Remover um fator
verificado encerra as sessões da conta (Supabase): o app pede para entrar de novo só com a senha.
"""
import asyncio
import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Security
from pydantic import BaseModel, ConfigDict, Field

import usage
from openapi import erro
from seguranca import Limitador, aal_do_token, auditar, ip_cliente, limitar, tem_mfa, usuario_autenticado

router = APIRouter(prefix="/mfa", tags=["Conta"], dependencies=[Security(usage.bearer)])

TABELA = 'mfa_codigos_recuperacao'
QUANTOS = 10
ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # 32 símbolos, sem 0/O/1/I: fácil de ditar e de digitar

_limite_gerar = Limitador(5, janela_s=3600)
_limite_conta = Limitador(5, janela_s=900)   # tentativas de código por conta
_limite_ip = Limitador(20, janela_s=900)     # e por IP (várias contas do mesmo lugar)


class RecuperarInput(BaseModel):
    model_config = ConfigDict(extra='forbid', json_schema_extra={"examples": [{"codigo": "K7QM-2XRA-PZ9T-H4WE"}]})

    codigo: str = Field(min_length=16, max_length=24, pattern=r'^[A-Za-z0-9 -]+$',
                        description="Um dos 10 códigos, com ou sem hífens; maiúsculas e minúsculas tanto faz.")


def novo_codigo() -> str:
    """16 símbolos de 32 = 80 bits, em 4 grupos: XXXX-XXXX-XXXX-XXXX."""
    s = ''.join(secrets.choice(ALFABETO) for _ in range(16))
    return '-'.join(s[i:i + 4] for i in range(0, 16, 4))


def hash_codigo(user_id: str, codigo: str) -> str:
    limpo = ''.join(ch for ch in codigo.upper() if ch.isalnum())
    return hashlib.sha256(f'{user_id}:{limpo}'.encode()).hexdigest()


@router.post(
    "/codigos-recuperacao",
    summary="Gerar códigos de recuperação",
    description="Exige a verificação em duas etapas ativa e a sessão confirmada com o código (aal2). "
                "Devolve 10 códigos uma única vez; os anteriores deixam de valer. 5 gerações por hora.",
    responses={
        200: {"content": {"application/json": {"example": {"codigos": ["K7QM-2XRA-PZ9T-H4WE", "..."]}}}},
        401: erro("Sem token ou token inválido.", "Login necessário."),
        403: erro("Sessão sem a etapa 2 (aal1).", "Confirme o código da verificação em duas etapas."),
        409: erro("Conta sem verificação em duas etapas.", "Ative a verificação em duas etapas antes."),
        429: erro("Limite de gerações excedido.", "Muitas gerações de código em pouco tempo."),
    },
)
async def gerar_codigos(request: Request):
    user, token = await usuario_autenticado(request)
    uid = str(user.id)
    request.state.user_id = uid
    if not tem_mfa(user):
        raise HTTPException(status_code=409, detail='Ative a verificação em duas etapas antes.')
    if aal_do_token(token) != 'aal2':
        raise HTTPException(status_code=403, detail='Confirme o código da verificação em duas etapas.')
    limitar(_limite_gerar, uid, 'Muitas gerações de código em pouco tempo.')
    codigos = [novo_codigo() for _ in range(QUANTOS)]
    sb = request.app.state.supabase

    def gravar():
        sb.table(TABELA).delete().eq('user_id', uid).execute()
        sb.table(TABELA).insert([{'user_id': uid, 'hash': hash_codigo(uid, c)} for c in codigos]).execute()

    try:
        await asyncio.to_thread(gravar)
    except Exception:
        raise HTTPException(status_code=503, detail='Não foi possível gerar os códigos agora. Tente de novo.')
    auditar(sb, uid, 'mfa_codigos_gerados', alvo=uid, detalhes={'quantidade': QUANTOS})
    return {'codigos': codigos}


@router.post(
    "/recuperar",
    summary="Entrar com um código de recuperação",
    description="Com a senha já confirmada (sessão aal1) e um código válido, remove os fatores TOTP da conta e "
                "marca o código como usado. As sessões da conta são encerradas: entre de novo só com a senha e "
                "ative a verificação outra vez. 5 tentativas a cada 15 min por conta (20 por IP).",
    responses={
        200: {"content": {"application/json": {"example": {"ok": True, "fatores_removidos": 1}}}},
        400: erro("Código errado ou já usado.", "Código inválido ou já usado."),
        401: erro("Sem token ou token inválido.", "Login necessário."),
        429: erro("Muitas tentativas.", "Muitas tentativas. Tente de novo mais tarde."),
    },
)
async def recuperar(body: RecuperarInput, request: Request):
    user, _token = await usuario_autenticado(request)
    uid = str(user.id)
    request.state.user_id = uid
    limitar(_limite_ip, ip_cliente(request), 'Muitas tentativas. Tente de novo mais tarde.')
    limitar(_limite_conta, uid, 'Muitas tentativas. Tente de novo mais tarde.')
    sb = request.app.state.supabase
    h = hash_codigo(uid, body.codigo)

    def consumir() -> bool:
        r = (sb.table(TABELA).update({'usado_em': datetime.now(timezone.utc).isoformat()})
             .eq('user_id', uid).eq('hash', h).is_('usado_em', 'null').execute())
        return bool(r.data)

    def remover_fatores() -> int:
        fatores = sb.auth.admin.mfa.list_factors({'user_id': uid}).factors or []
        for f in fatores:
            sb.auth.admin.mfa.delete_factor({'id': f.id, 'user_id': uid})
        # Os códigos que sobraram eram desse 2º fator: ao ativar de novo, a pessoa gera outros.
        sb.table(TABELA).delete().eq('user_id', uid).execute()
        return len(fatores)

    try:
        valido = await asyncio.to_thread(consumir)
    except Exception:
        raise HTTPException(status_code=503, detail='Não foi possível conferir o código agora. Tente de novo.')
    # Auditoria sem IP: a trilha é append-only (nem a service_role apaga), e IP é dado pessoal.
    if not valido:
        auditar(sb, uid, 'mfa_recuperacao_recusada', alvo=uid)
        raise HTTPException(status_code=400, detail='Código inválido ou já usado.')
    try:
        n = await asyncio.to_thread(remover_fatores)
    except Exception:
        # Falha no Auth: o código volta a valer, para a pessoa tentar de novo sem perder um.
        await asyncio.to_thread(lambda: sb.table(TABELA).update({'usado_em': None}).eq('user_id', uid).eq('hash', h).execute())
        raise HTTPException(status_code=503, detail='Não foi possível remover a verificação agora. Tente de novo.')
    auditar(sb, uid, 'mfa_recuperacao', alvo=uid, detalhes={'fatores_removidos': n})
    return {'ok': True, 'fatores_removidos': n}
