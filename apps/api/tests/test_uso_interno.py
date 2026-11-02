"""Chamadas internas (comparador na EC2) ficam fora da captura de uso; a auditoria não."""
from types import SimpleNamespace

import usage


def _req(host='127.0.0.1', **headers):
    return SimpleNamespace(client=SimpleNamespace(host=host), headers={k.lower(): v for k, v in headers.items()})


def test_so_loopback_sem_proxy_e_com_cabecalho_e_interna():
    assert usage.requisicao_interna(_req(**{'X-Routify-Interno': '1'}))
    assert usage.requisicao_interna(_req('::1', **{'X-Routify-Interno': '1'}))
    assert not usage.requisicao_interna(_req())                                  # sem cabeçalho
    assert not usage.requisicao_interna(_req('203.0.113.9', **{'X-Routify-Interno': '1'}))
    # Veio pelo Caddy (mesmo de loopback): é usuário de fora tentando se passar por interno.
    assert not usage.requisicao_interna(_req(**{'X-Routify-Interno': '1', 'X-Forwarded-For': '203.0.113.9'}))


class _SB:
    def __init__(self):
        self.tabelas = []

    def table(self, nome):
        self.tabelas.append(nome)
        return SimpleNamespace(insert=lambda linha: SimpleNamespace(execute=lambda: None))


def test_interna_pula_uso_mas_nunca_a_auditoria():
    sb = _SB()
    usage.marcar_interna(True)
    try:
        for t in ('api_requisicoes', 'rotas_calculadas', 'eventos_app', 'admin_auditoria'):
            usage.registrar(sb, t, {})
    finally:
        usage.marcar_interna(False)
    assert sb.tabelas == ['admin_auditoria']
    usage.registrar(sb, 'rotas_calculadas', {})
    assert sb.tabelas == ['admin_auditoria', 'rotas_calculadas']
