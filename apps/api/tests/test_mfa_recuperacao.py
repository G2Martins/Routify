"""POST /mfa/codigos-recuperacao e /mfa/recuperar pelo HTTP (TestClient), com um Supabase falso em memória:
quem pode gerar (aal2), o que fica no banco (só hash), uso único, limite por conta, código de outra conta,
corpo estrito e falha do Auth sem queimar o código. Rodar a partir de apps/api: `pytest -q`.
"""
import base64
import json
import re
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import mfa
from seguranca import Limitador

UID = '0b9f6c1e-6a52-4d4b-9a2a-3f1c2d4e5f60'
UID_2 = '7d1e2f3a-4b5c-4d6e-8f70-81a2b3c4d5e6'
FORMATO = re.compile(r'^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$')


def jwt(aal: str) -> str:
    """Token só com o claim aal (a identidade vem do get_user falso, como na API vem do Supabase Auth)."""
    corpo = base64.urlsafe_b64encode(json.dumps({'aal': aal}).encode()).decode().rstrip('=')
    return f'Bearer h.{corpo}.s'


class Consulta:
    """O pedaço do query builder do supabase-py que o router usa."""

    def __init__(self, sb, tabela):
        self.sb, self.t, self.op, self.vals, self.filtros = sb, tabela, None, None, []

    def insert(self, linhas):
        self.op, self.vals = 'insert', linhas
        return self

    def update(self, vals):
        self.op, self.vals = 'update', vals
        return self

    def delete(self):
        self.op = 'delete'
        return self

    def eq(self, col, v):
        self.filtros.append(lambda l: l.get(col) == v)
        return self

    def is_(self, col, v):
        assert v == 'null'
        self.filtros.append(lambda l: l.get(col) is None)
        return self

    def execute(self):
        linhas = self.sb.banco.setdefault(self.t, [])
        if self.op == 'insert':
            linhas.extend({'usado_em': None, **v} for v in self.vals)
            return SimpleNamespace(data=self.vals)
        alvo = [l for l in linhas if all(f(l) for f in self.filtros)]
        if self.op == 'update':
            for l in alvo:
                l.update(self.vals)
        else:
            self.sb.banco[self.t] = [l for l in linhas if l not in alvo]
        return SimpleNamespace(data=alvo)


class SbFalso:
    def __init__(self, fatores=('verified',)):
        self.uid = UID
        self.banco = {}
        self.fatores = [SimpleNamespace(id=f'f{i}', status=s) for i, s in enumerate(fatores)]
        self.removidos = []
        self.auth_fora = False
        self.auth = SimpleNamespace(get_user=self._get_user, admin=SimpleNamespace(mfa=SimpleNamespace(
            list_factors=lambda p: SimpleNamespace(factors=list(self.fatores)), delete_factor=self._apagar)))

    def _get_user(self, token):
        if 'invalido' in token:
            raise RuntimeError('jwt inválido')
        return SimpleNamespace(user=SimpleNamespace(id=self.uid, app_metadata={}, factors=list(self.fatores)))

    def _apagar(self, p):
        if self.auth_fora:
            raise RuntimeError('auth fora do ar')
        assert p['user_id'] == self.uid
        self.removidos.append(p['id'])
        self.fatores = [f for f in self.fatores if f.id != p['id']]

    def table(self, nome):
        return Consulta(self, nome)

    def codigos(self):
        return self.banco.get(mfa.TABELA, [])


@pytest.fixture
def auditoria(monkeypatch):
    feitos = []
    monkeypatch.setattr(mfa, 'auditar', lambda sb, ator, acao, alvo=None, detalhes=None: feitos.append((acao, detalhes)))
    return feitos


@pytest.fixture
def sb(monkeypatch):
    monkeypatch.setattr(mfa, '_limite_gerar', Limitador(5, janela_s=3600))
    monkeypatch.setattr(mfa, '_limite_conta', Limitador(5, janela_s=900))
    monkeypatch.setattr(mfa, '_limite_ip', Limitador(20, janela_s=900))
    return SbFalso()


def cliente(sb) -> TestClient:
    app = FastAPI()
    app.include_router(mfa.router)
    app.state.supabase = sb
    return TestClient(app)


def gerar(cli, aal='aal2'):
    return cli.post('/mfa/codigos-recuperacao', headers={'Authorization': jwt(aal)})


def recuperar(cli, codigo, aal='aal1'):
    return cli.post('/mfa/recuperar', headers={'Authorization': jwt(aal)}, json={'codigo': codigo})


def test_gerar_exige_login_sessao_aal2_e_mfa_ativo(sb, auditoria):
    cli = cliente(sb)
    assert cli.post('/mfa/codigos-recuperacao').status_code == 401
    assert cli.post('/mfa/codigos-recuperacao', headers={'Authorization': 'Bearer invalido'}).status_code == 401
    assert gerar(cli, 'aal1').status_code == 403  # só a senha não cria código para desligar o 2º fator
    sem_mfa = SbFalso(fatores=())
    assert gerar(cliente(sem_mfa), 'aal2').status_code == 409
    assert sb.codigos() == [] and sem_mfa.codigos() == []


def test_gerar_devolve_10_codigos_e_o_banco_guarda_so_o_hash(sb, auditoria):
    cli = cliente(sb)
    r = gerar(cli)
    assert r.status_code == 200
    codigos = r.json()['codigos']
    assert len(codigos) == 10 == len(set(codigos)) and all(FORMATO.match(c) for c in codigos)
    linhas = sb.codigos()
    assert len(linhas) == 10 and all(re.fullmatch(r'[0-9a-f]{64}', l['hash']) for l in linhas)
    texto = json.dumps(linhas)
    assert not any(c in texto or c.replace('-', '') in texto for c in codigos)
    # Gerar de novo invalida os antigos.
    novos = gerar(cli).json()['codigos']
    assert len(sb.codigos()) == 10
    assert recuperar(cli, codigos[0]).status_code == 400
    assert recuperar(cli, novos[0]).status_code == 200
    assert ('mfa_codigos_gerados', {'quantidade': 10}) in auditoria


def test_recuperar_remove_os_fatores_e_o_codigo_so_vale_uma_vez(sb, auditoria):
    cli = cliente(sb)
    codigo = gerar(cli).json()['codigos'][3]
    r = recuperar(cli, codigo.lower().replace('-', ' '))  # minúsculas e espaços também valem
    assert r.status_code == 200 and r.json() == {'ok': True, 'fatores_removidos': 1}
    assert sb.removidos == ['f0'] and sb.fatores == []
    assert sb.codigos() == []  # os que sobraram eram do 2º fator removido
    assert recuperar(cli, codigo).status_code == 400
    assert auditoria[-2:] == [('mfa_recuperacao', {'fatores_removidos': 1}), ('mfa_recuperacao_recusada', None)]
    assert all('ip' not in (d or {}) for _, d in auditoria)  # trilha append-only: sem IP (LGPD)


def test_codigo_de_outra_conta_nao_vale(sb, auditoria):
    cli = cliente(sb)
    codigo = gerar(cli).json()['codigos'][0]
    sb.uid = UID_2
    assert recuperar(cli, codigo).status_code == 400
    assert sb.removidos == []


def test_codigo_errado_400_e_depois_de_5_tentativas_429(sb, auditoria):
    cli = cliente(sb)
    gerar(cli)
    for _ in range(5):
        assert recuperar(cli, 'AAAA-AAAA-AAAA-AAAA').status_code == 400
    r = recuperar(cli, 'AAAA-AAAA-AAAA-AAAA')
    assert r.status_code == 429 and int(r.headers['Retry-After']) >= 1
    assert sb.removidos == []


@pytest.mark.parametrize('corpo', [
    {'codigo': 'AAAA-AAAA-AAAA-AAAA', 'user_id': UID_2},  # mass assignment
    {'codigo': 'AAAA-AAAA'},                              # curto demais
    {'codigo': 'AAAA-AAAA-AAAA-AAA;'},                    # caractere fora do formato
    {},
])
def test_corpo_estrito_422(sb, auditoria, corpo):
    r = cliente(sb).post('/mfa/recuperar', headers={'Authorization': jwt('aal1')}, json=corpo)
    assert r.status_code == 422


def test_falha_no_auth_devolve_o_codigo_para_tentar_de_novo(sb, auditoria):
    cli = cliente(sb)
    codigo = gerar(cli).json()['codigos'][0]
    sb.auth_fora = True
    assert recuperar(cli, codigo).status_code == 503
    assert all(l['usado_em'] is None for l in sb.codigos())
    sb.auth_fora = False
    assert recuperar(cli, codigo).status_code == 200
