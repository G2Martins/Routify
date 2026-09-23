"""
Captura de uso da plataforma (fase final do TCC 2).

Tudo é escrito pelo SERVIDOR com o service_role (cliente é hostil): o app
nunca insere direto em api_requisicoes / rotas_calculadas / eventos_app.
LGPD: coordenadas arredondadas a 3 casas (~110 m) antes de gravar; o banco
expurga o bruto após 90 dias (pg_cron, ver supabase/migrations).

A gravação é fire-and-forget num thread do executor: a resposta ao usuário
nunca espera o log, e banco fora do ar só vira aviso (com trava de 60 s).
"""
import asyncio
import hashlib
import logging
import time
from typing import Optional

logger = logging.getLogger(__name__)

TTL_TOKEN_S = 300
MAX_TOKENS_CACHE = 5000
_cache_tokens: dict = {}  # sha256(token) -> (user_id | None, expira_em)
_ultimo_aviso = 0.0


def arredondar(coord: float) -> float:
    """3 casas ≈ 110 m: dá para analisar corredores sem guardar a trilha exata de ninguém."""
    return round(float(coord), 3)


def usuario_do_token(sb, authorization: Optional[str]) -> Optional[str]:
    """user_id do JWT Supabase ('Bearer …'), validado no Supabase Auth. None se ausente/inválido.

    Cache de 5 min por hash do token (o token em si nunca fica em memória nem em log).
    """
    if sb is None or not authorization or not authorization.lower().startswith('bearer '):
        return None
    token = authorization[7:].strip()
    if not token or len(token) > 4096:
        return None
    chave = hashlib.sha256(token.encode()).hexdigest()
    agora = time.monotonic()
    em_cache = _cache_tokens.get(chave)
    if em_cache is not None and em_cache[1] > agora:
        return em_cache[0]
    try:
        resp = sb.auth.get_user(token)
        user_id = str(resp.user.id) if resp is not None and resp.user is not None else None
    except Exception:
        user_id = None  # expirado, revogado ou Auth fora do ar: trata como anônimo
    if len(_cache_tokens) >= MAX_TOKENS_CACHE:
        _cache_tokens.clear()
    _cache_tokens[chave] = (user_id, agora + TTL_TOKEN_S)
    return user_id


async def usuario_do_token_async(sb, authorization: Optional[str]) -> Optional[str]:
    """Versão não bloqueante: a validação no Auth é HTTP síncrono (supabase-py)."""
    if sb is None or not authorization:
        return None
    return await asyncio.to_thread(usuario_do_token, sb, authorization)


def _inserir(sb, tabela: str, linha: dict) -> None:
    global _ultimo_aviso
    try:
        sb.table(tabela).insert(linha).execute()
    except Exception as e:
        if time.monotonic() - _ultimo_aviso > 60:
            _ultimo_aviso = time.monotonic()
            logger.warning(f"Uso: falha ao gravar em {tabela} ({type(e).__name__}) — seguindo sem log")


def registrar(sb, tabela: str, linha: dict) -> None:
    """Grava em segundo plano; nunca levanta nem atrasa a resposta."""
    if sb is None:
        return
    try:
        asyncio.get_running_loop().run_in_executor(None, _inserir, sb, tabela, linha)
    except RuntimeError:
        _inserir(sb, tabela, linha)  # fora de event loop (scripts/testes)
