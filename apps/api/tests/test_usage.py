"""Captura de uso (usage.py) e POST /eventos (routers/eventos.py)."""
import pytest
from pydantic import ValidationError

import usage
from routers.eventos import EventoInput
from seguranca import Limitador


class _AuthFalso:
    """Imita supabase.auth.get_user: token 'bom' é válido; conta as chamadas."""

    def __init__(self):
        self.chamadas = 0

    def get_user(self, token):
        self.chamadas += 1
        if token != 'bom':
            raise RuntimeError('token inválido')
        return type('R', (), {'user': type('U', (), {'id': 'uuid-1'})()})()


class _SbFalso:
    def __init__(self):
        self.auth = _AuthFalso()


@pytest.fixture(autouse=True)
def _limpa_cache():
    usage._cache_tokens.clear()


def test_arredonda_para_cerca_de_110_metros():
    assert usage.arredondar(-15.793812) == -15.794
    assert usage.arredondar(-47.88249) == -47.882


def test_token_valido_vira_user_id_e_fica_em_cache():
    sb = _SbFalso()
    assert usage.usuario_do_token(sb, 'Bearer bom') == 'uuid-1'
    assert usage.usuario_do_token(sb, 'Bearer bom') == 'uuid-1'
    assert sb.auth.chamadas == 1  # segunda vez veio do cache


def test_token_ausente_malformado_ou_invalido_e_anonimo():
    sb = _SbFalso()
    assert usage.usuario_do_token(sb, None) is None
    assert usage.usuario_do_token(sb, 'Basic abc') is None
    assert usage.usuario_do_token(sb, 'Bearer ' + 'x' * 5000) is None
    assert sb.auth.chamadas == 0  # nem chegou a consultar o Auth
    assert usage.usuario_do_token(sb, 'Bearer ruim') is None
    assert usage.usuario_do_token(None, 'Bearer bom') is None


def test_cache_guarda_hash_e_nunca_o_token():
    usage.usuario_do_token(_SbFalso(), 'Bearer bom')
    assert all('bom' not in chave for chave in usage._cache_tokens)


def test_evento_valido():
    ev = EventoInput(tipo='navegacao_iniciada', plataforma='web', dados={'distancia_km': 8.3, 'modelo': 'lia_2.1'})
    assert ev.tipo == 'navegacao_iniciada'


@pytest.mark.parametrize('payload', [
    {'tipo': 'hack'},                                            # tipo fora da lista
    {'tipo': 'busca', 'extra': 1},                               # mass assignment
    {'tipo': 'busca', 'dados': {'lat': -15.79}},                 # coordenada proibida
    {'tipo': 'busca', 'dados': {'aninhado': {'a': 1}}},          # só valores planos
    {'tipo': 'busca', 'dados': {'texto': 'x' * 201}},            # valor longo
    {'tipo': 'busca', 'dados': {f'k{i}': i for i in range(13)}},  # chaves demais
    {'tipo': 'busca', 'plataforma': 'desktop'},
])
def test_evento_invalido_e_rejeitado(payload):
    with pytest.raises(ValidationError):
        EventoInput(**payload)


def test_limite_por_usuario():
    limite = Limitador(2)
    assert limite.permitir('a') and limite.permitir('a')
    assert not limite.permitir('a')
    assert limite.permitir('b')  # cada usuário tem a própria janela
