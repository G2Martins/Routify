"""Guardas de admin, limitador, flags de runtime e regra de fusão LIA × TomTom."""
import asyncio
import types

import pytest
from fastapi import HTTPException

import config_runtime
import seguranca
import tomtom
import trajeto

CHAVES = [{'id': 'k1', 'key': 'SEGREDO-1'}, {'id': 'k2', 'key': 'SEGREDO-2'}]


def _request(auth=None, papel=None, erro=False):
    """Request mínimo com um Supabase falso: get_user devolve o papel pedido."""
    def get_user(_token):
        if erro:
            raise RuntimeError('token inválido')
        meta = {'role': papel} if papel else {}
        return types.SimpleNamespace(user=types.SimpleNamespace(id='u-1', app_metadata=meta))
    sb = types.SimpleNamespace(auth=types.SimpleNamespace(get_user=get_user))
    return types.SimpleNamespace(
        app=types.SimpleNamespace(state=types.SimpleNamespace(supabase=sb)),
        headers={'authorization': auth} if auth else {},
        state=types.SimpleNamespace(),
        client=types.SimpleNamespace(host='10.0.0.1'),
    )


def _status(coro):
    with pytest.raises(HTTPException) as e:
        asyncio.run(coro)
    return e.value.status_code


def test_exigir_admin_barra_sem_token_token_invalido_e_usuario_comum():
    assert _status(seguranca.exigir_admin(_request())) == 401
    assert _status(seguranca.exigir_admin(_request('Bearer x', erro=True))) == 401
    assert _status(seguranca.exigir_admin(_request('Bearer x', papel='usuario'))) == 403
    # Papel no corpo/headers não conta: só app_metadata do Auth.
    assert _status(seguranca.exigir_admin(_request('Bearer x'))) == 403


def test_exigir_admin_aceita_admin_e_marca_o_usuario():
    req = _request('Bearer x', papel='admin')
    assert asyncio.run(seguranca.exigir_admin(req)) == 'u-1'
    assert req.state.user_id == 'u-1'


def test_limitar_devolve_429_com_retry_after():
    lim = seguranca.Limitador(1, janela_s=60)
    seguranca.limitar(lim, 'ip')
    with pytest.raises(HTTPException) as e:
        seguranca.limitar(lim, 'ip')
    assert e.value.status_code == 429 and int(e.value.headers['Retry-After']) >= 1


def test_ip_cliente_ignora_x_forwarded_for_sem_proxy_confiavel(monkeypatch):
    monkeypatch.setattr(seguranca, 'CONFIAR_PROXY', False)
    req = _request()
    req.headers = {'x-forwarded-for': '1.2.3.4'}
    assert seguranca.ip_cliente(req) == '10.0.0.1'  # cliente não forja o IP


def test_config_runtime_pausa_chave_desliga_e_zera_cooldown():
    cli = tomtom.TomTomClient(CHAVES)
    cli.pool.falha('k1', 'fluxo', 'cota')
    assert cli.pool.disponiveis('fluxo') == 1

    cli.aplicar_config({**config_runtime.PADRAO, 'tomtom_chaves_pausadas': ['k2']})
    assert cli.pool.proxima('fluxo') is None  # k1 em cooldown, k2 pausada

    cli.aplicar_config({**config_runtime.PADRAO, 'tomtom_reset_em': '2026-09-23T10:00:00Z'})
    assert cli.pool.disponiveis('fluxo') == 2  # reset devolveu k1; k2 despausada

    cli.aplicar_config({**config_runtime.PADRAO, 'modo_so_lia': True})
    assert cli.ativo is False
    cli.aplicar_config({**config_runtime.PADRAO, 'tomtom_orcamento_min': 9999})
    assert cli.ativo is True and cli._orcamento.maximo == 600  # teto do painel
    asyncio.run(cli.fechar())


def test_estado_do_pool_nunca_expoe_o_valor_da_chave():
    cli = tomtom.TomTomClient(CHAVES)
    assert 'SEGREDO' not in repr(cli.estado())
    asyncio.run(cli.fechar())


def test_fusao_lia_decide_onde_enxerga_e_tomtom_so_troca_com_ganho_claro():
    # Tempo misto: cobertura da LIA vale pela LIA, o resto pela TomTom (mesma rota).
    assert trajeto.escolher(700, 100, 875, None) == ('lia', 700, None)
    assert trajeto.escolher(700, 0, 875, None) == ('lia', 875, None)
    # Alternativa 20% mais rápida segundo a TomTom → troca; 4% → mantém a LIA.
    fonte, tempo, outra = trajeto.escolher(710, 67, 875, 700)
    assert fonte == 'tomtom' and outra - tempo >= trajeto.MARGEM_ABS_S
    assert trajeto.escolher(710, 67, 875, 840)[0] == 'lia'
    assert trajeto.escolher(600, 50, None, None) == ('lia', 600, None)  # TomTom fora do ar


def test_peso_soma_atraso_de_semaforo_e_respeita_interdicao():
    import networkx as nx
    G = nx.MultiDiGraph()
    G.add_edge(1, 2, travel_time_lia=10, semaforo=1)
    G.add_edge(2, 3, travel_time_lia=10, semaforo=0)
    G.add_edge(1, 3, travel_time_lia=25, semaforo=0)
    # Sem semáforo, 1→2→3 (20 s) vence 1→3 (25 s); com 10 s por semáforo, inverte.
    assert nx.astar_path(G, 1, 3, weight=tomtom.peso_sem_interditadas(set())) == [1, 2, 3]
    assert nx.astar_path(G, 1, 3, weight=tomtom.peso_sem_interditadas(set(), atraso_semaforo=10)) == [1, 3]
    assert nx.astar_path(G, 1, 3, weight=tomtom.peso_sem_interditadas({(1, 3, 0)}, atraso_semaforo=10)) == [1, 2, 3]
