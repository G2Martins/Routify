"""Flags operacionais que o painel ADM muda sem redeploy (tabela config_runtime).

A API relê a cada 30 s no máximo; sem banco, segue com os padrões. Escrita só
pelas RPCs admin_* (auditadas no banco).
"""
import asyncio
import logging
import time

logger = logging.getLogger(__name__)

PADRAO = {
    'tomtom_ativo': True,
    'tomtom_orcamento_min': 120,
    'tomtom_chaves_pausadas': [],
    'tomtom_reset_em': None,
    'referencia_tomtom_ativa': True,
    'modo_so_lia': False,
}


class ConfigRuntime:
    TTL_S = 30.0

    def __init__(self):
        self.valores = dict(PADRAO)
        self._lido = float('-inf')
        self._ultimo_aviso = 0.0

    def __getitem__(self, chave):
        return self.valores[chave]

    async def atualizar(self, sb, tomtom_cliente=None) -> None:
        """Relê o banco se o TTL venceu e aplica no cliente TomTom."""
        if sb is None or time.monotonic() - self._lido < self.TTL_S:
            return
        self._lido = time.monotonic()
        try:
            linhas = await asyncio.to_thread(
                lambda: sb.table('config_runtime').select('chave,valor').execute().data)
            for linha in linhas or []:
                if linha.get('chave') in PADRAO:
                    self.valores[linha['chave']] = linha.get('valor')
        except Exception as e:
            if time.monotonic() - self._ultimo_aviso > 300:
                self._ultimo_aviso = time.monotonic()
                logger.warning(f"config_runtime indisponível ({type(e).__name__}) — usando os valores atuais")
        if tomtom_cliente is not None:
            tomtom_cliente.aplicar_config(self.valores)
