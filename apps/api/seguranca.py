"""Guardas compartilhados da API: limite por janela deslizante, IP do cliente e
exigência de admin. Cliente é hostil por padrão — nada aqui confia em dado do
corpo da requisição para decidir quem é quem.
"""
import asyncio
import os
import time
from collections import defaultdict, deque
from typing import Dict

from fastapi import HTTPException, Request

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


def ip_cliente(request: Request) -> str:
    if CONFIAR_PROXY:
        encaminhado = request.headers.get('x-forwarded-for', '')
        if encaminhado:
            return encaminhado.split(',')[0].strip()[:64]
    return request.client.host if request.client else 'desconhecido'


async def exigir_admin(request: Request) -> str:
    """Dependência dos endpoints /admin: valida o JWT no Supabase Auth a cada
    chamada (sem cache — um admin rebaixado perde o acesso na hora) e exige
    app_metadata.role = admin. Devolve o user_id."""
    sb = getattr(request.app.state, 'supabase', None)
    auth = request.headers.get('authorization') or ''
    if sb is None:
        raise HTTPException(status_code=503, detail='Autenticação indisponível.')
    if not auth.lower().startswith('bearer ') or len(auth) > 4200:
        raise HTTPException(status_code=401, detail='Login necessário.')
    try:
        resp = await asyncio.to_thread(sb.auth.get_user, auth[7:].strip())
        user = resp.user if resp is not None else None
    except Exception:
        user = None
    if user is None:
        raise HTTPException(status_code=401, detail='Sessão inválida ou expirada.')
    if (getattr(user, 'app_metadata', None) or {}).get('role') != 'admin':
        raise HTTPException(status_code=403, detail='Acesso restrito a administradores.')
    request.state.user_id = str(user.id)
    return str(user.id)


def auditar(sb, ator: str, acao: str, alvo: str | None = None, detalhes: dict | None = None) -> None:
    """Trilha de auditoria de ações feitas pela API (best-effort: falha ao gravar
    não desfaz a ação já feita). Ações de banco auditam dentro da própria RPC."""
    usage.registrar(sb, 'admin_auditoria', {
        'ator': ator, 'acao': acao, 'alvo': alvo, 'detalhes': detalhes or {},
    })
