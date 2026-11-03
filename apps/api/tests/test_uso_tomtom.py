"""Uso real das chaves TomTom (tomtom_uso_dia): o pool conta por (chave, serviço), o envio zera, e um envio que
falha devolve os contadores para o próximo; o painel soma isso com o coletor."""
import asyncio
import types

import tomtom

CHAVES = [{'id': 'key_01', 'key': 'SEGREDO-1'}, {'id': 'key_02', 'key': 'SEGREDO-2'}]


def test_pool_conta_por_servico_e_leva_o_cooldown():
    pool = tomtom.KeyPool(CHAVES)
    pool.sucesso('key_01', 'fluxo')
    pool.sucesso('key_01', 'fluxo')
    pool.falha('key_02', 'rota', 'cota')
    pool.contar('key_01', 'busca', 500, True)
    linhas = {(l['chave_id'], l['servico']): l for l in pool.descarregar_uso()}
    assert linhas[('key_01', 'fluxo')] == {'chave_id': 'key_01', 'servico': 'fluxo', 'chamadas': 2, 'falhas': 0,
                                           'ultimo_status': 200, 'cooldown_ate': None}
    assert linhas[('key_02', 'rota')]['falhas'] == 1 and linhas[('key_02', 'rota')]['ultimo_status'] == 429
    assert linhas[('key_02', 'rota')]['cooldown_ate'] is not None  # cota: 24 h fora do rodízio
    assert linhas[('key_01', 'busca')]['ultimo_status'] == 500
    assert pool.descarregar_uso() == []  # zerou
    assert 'SEGREDO' not in repr(linhas)  # só o id da chave


class _Sb:
    def __init__(self, falhar=False):
        self.falhar, self.chamadas = falhar, []

    def rpc(self, nome, params):
        def execute():
            if self.falhar:
                raise RuntimeError('supabase fora')
            self.chamadas.append((nome, params))
        return types.SimpleNamespace(execute=execute)


def test_envio_manda_o_acumulado_como_api():
    sb, pool = _Sb(), tomtom.KeyPool(CHAVES)
    pool.sucesso('key_01', 'incidentes')
    asyncio.run(tomtom.enviar_uso(pool, sb))
    assert sb.chamadas[0][0] == 'registrar_tomtom_uso'
    assert sb.chamadas[0][1]['p_origem'] == 'api' and sb.chamadas[0][1]['p_linhas'][0]['chamadas'] == 1
    asyncio.run(tomtom.enviar_uso(pool, sb))
    assert len(sb.chamadas) == 1  # nada novo: não chama o banco


def test_envio_que_falha_devolve_os_contadores():
    pool = tomtom.KeyPool(CHAVES)
    pool.sucesso('key_01', 'fluxo')
    asyncio.run(tomtom.enviar_uso(pool, _Sb(falhar=True)))
    pool.sucesso('key_01', 'fluxo')
    linhas = pool.descarregar_uso()
    assert linhas[0]['chamadas'] == 2  # a do envio que falhou + a nova
