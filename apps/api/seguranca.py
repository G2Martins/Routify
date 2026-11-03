"""Guardas compartilhados da API: limite por janela deslizante, IP do cliente e
exigência de admin. Cliente é hostil por padrão — nada aqui confia em dado do
corpo da requisição para decidir quem é quem.
"""
import asyncio
import base64
import json
import os
import time
from collections import defaultdict, deque
from typing import Dict

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

import usage

# Só confia em X-Forwarded-For atrás de um proxy nosso (Caddy/ALB em produção);
# sem isso, qualquer cliente forja o IP e fura o limite.
CONFIAR_PROXY = os.getenv('TRUST_PROXY', '0') == '1'


class Limitador:
    """Janela deslizante por identificador (memória do processo).

    ponytail: vale para 1 réplica. Com mais de uma, trocar o armazenamento por
    tabela/Redis mantendo permitir()/espera_s().
    """

    def __init__(self, maximo: int, janela_s: float = 60.0):
        self.maximo = maximo
        self.janela_s = janela_s
        self._janelas: Dict[str, deque] = defaultdict(deque)

    def _limpar(self, janela: deque, agora: float) -> None:
        while janela and agora - janela[0] > self.janela_s:
            janela.popleft()

    def permitir(self, ident: str) -> bool:
        agora = time.monotonic()
        janela = self._janelas[ident]
        self._limpar(janela, agora)
        if len(janela) >= self.maximo:
            return False
        janela.append(agora)
        if len(self._janelas) > 50_000:  # teto de memória sob ataque de muitos IPs
            self._janelas.clear()
        return True

    def espera_s(self, ident: str) -> int:
        janela = self._janelas.get(ident)
        if not janela:
            return 0
        return max(1, int(self.janela_s - (time.monotonic() - janela[0])) + 1)


def limitar(limitador: Limitador, ident: str, detalhe: str = 'Muitas requisições. Tente de novo em instantes.') -> None:
    """429 com Retry-After quando o identificador estourou a janela."""
    if not limitador.permitir(ident):
        raise HTTPException(status_code=429, detail=detalhe,
                            headers={'Retry-After': str(limitador.espera_s(ident))})


async def erro_de_validacao(request: Request, exc) -> JSONResponse:
    """422 só com loc/msg/type. O padrão do FastAPI ecoa o `input`; um NaN ou
    Infinity ali estoura na serialização e o cliente ganhava um 500 à vontade."""
    return JSONResponse(status_code=422, content={'detail': [
        {'loc': [p if isinstance(p, (int, str)) else str(p) for p in e.get('loc', ())],
         'msg': str(e.get('msg', '')), 'type': str(e.get('type', ''))} for e in exc.errors()]})


def ip_cliente(request: Request) -> str:
    if CONFIAR_PROXY:
        encaminhado = request.headers.get('x-forwarded-for', '')
        if encaminhado:
            return encaminhado.split(',')[0].strip()[:64]
    return request.client.host if request.client else 'desconhecido'


def aal_do_token(token: str) -> str:
    """Claim `aal` do JWT. Só leitura do payload: chamar depois de validar o token no Supabase
    (get_user), nunca como prova de identidade."""
    try:
        payload = token.split('.')[1]
        return json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4))).get('aal') or 'aal1'
    except (IndexError, ValueError, AttributeError):
        return 'aal1'


async def usuario_autenticado(request: Request):
    """Valida o JWT no Supabase Auth a cada chamada (sem cache: conta rebaixada ou sessão encerrada
    perde o acesso na hora) e devolve (usuário, token). Base do /admin e das ações da própria conta (MFA)."""
    sb = getattr(request.app.state, 'supabase', None)
    auth = request.headers.get('authorization') or ''
    if sb is None:
        raise HTTPException(status_code=503, detail='Autenticação indisponível.')
    if not auth.lower().startswith('bearer ') or len(auth) > 4200:
        raise HTTPException(status_code=401, detail='Login necessário.')
    token = auth[7:].strip()
    try:
        resp = await asyncio.to_thread(sb.auth.get_user, token)
        user = resp.user if resp is not None else None
    except Exception:
        user = None
    if user is None:
        raise HTTPException(status_code=401, detail='Sessão inválida ou expirada.')
    return user, token


def tem_mfa(user) -> bool:
    """A conta tem um 2º fator (TOTP) verificado."""
    return any(getattr(f, 'status', None) == 'verified' for f in (getattr(user, 'factors', None) or []))


async def exigir_admin(request: Request) -> str:
    """Dependência dos endpoints /admin: exige app_metadata.role = admin. Devolve o user_id."""
    user, token = await usuario_autenticado(request)
    if (getattr(user, 'app_metadata', None) or {}).get('role') != 'admin':
        raise HTTPException(status_code=403, detail='Acesso restrito a administradores.')
    # Quem ativou a verificação em duas etapas precisa de sessão aal2 (mesma regra do aal_ok() no banco).
    if tem_mfa(user) and aal_do_token(token) != 'aal2':
        raise HTTPException(status_code=403, detail='Confirme o código da verificação em duas etapas.')
    request.state.user_id = str(user.id)
    return str(user.id)


def auditar(sb, ator: str, acao: str, alvo: str | None = None, detalhes: dict | None = None) -> None:
    """Trilha de auditoria de ações feitas pela API (best-effort: falha ao gravar
    não desfaz a ação já feita). Ações de banco auditam dentro da própria RPC."""
    usage.registrar(sb, 'admin_auditoria', {
        'ator': ator, 'acao': acao, 'alvo': alvo, 'detalhes': detalhes or {},
    })
