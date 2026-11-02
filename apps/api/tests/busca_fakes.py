"""Fakes do autocomplete (routers/search.py) — sem rede, sem Supabase, sem TomTom.

Importado pelos testes de busca (test_busca*.py). Rodar a partir de apps/api: `pytest -q`.
"""
import re
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import search

# Linhas no formato de malha_completa: (id_via, nome_via, tipo_via, latitude, longitude).
VIAS = [
    (1, 'Estrada Parque Taguatinga', 'trunk', -15.8236, -48.0240),
    (2, 'EPTG QE 1', 'secondary', -15.8074, -47.9874),
    (3, 'Marginal Sul EPTG', 'primary', -15.8236, -48.0245),
    (4, 'Avenida Hélio Prates', 'tertiary', -15.8330, -48.0430),
    (5, 'Eixo Rodoviário Norte', 'trunk', -15.7700, -47.8900),
    (6, 'SQS 308', 'residential', -15.8144, -47.9059),
    (7, 'W3 Sul', 'primary', -15.7969, -47.8914),
    (8, 'Estrada Parque Aeroporto', 'primary', -15.8715, -47.9223),
]


class SbFalso:
    """Só o que search._malha usa: table().select().filter()/ilike().limit().execute().

    A regex e o ILIKE rodam de verdade sobre as linhas (re.I), então o teste vê o que o
    Postgres veria. `regex_ok=False` imita o PostgREST recusando o operador imatch (erro no execute).
    """

    def __init__(self, linhas=VIAS, regex_ok=True):
        self.linhas = [dict(zip(('id_via', 'nome_via', 'tipo_via', 'latitude', 'longitude'), r)) for r in linhas]
        self.regex_ok = regex_ok
        self.consultas = []  # [('imatch' | 'ilike', padrão)]

    def table(self, nome):
        assert nome == 'malha_completa'
        return _Consulta(self)


class _Consulta:
    def __init__(self, sb):
        self.sb, self.regex, self.n, self.pred = sb, False, None, (lambda nome: True)

    def select(self, *_):
        return self

    def filter(self, _col, op, valor):
        assert op == 'imatch'
        self.sb.consultas.append(('imatch', valor))
        self.regex = True
        rx = re.compile(valor, re.I)
        self.pred = lambda nome: bool(rx.search(nome))
        return self

    def ilike(self, _col, padrao):
        self.sb.consultas.append(('ilike', padrao))
        rx = re.compile('^' + re.escape(padrao).replace('%', '.*') + '$', re.I)
        self.pred = lambda nome: bool(rx.match(nome))
        return self

    def limit(self, n):
        self.n = n
        return self

    def execute(self):
        if self.regex and not self.sb.regex_ok:
            raise RuntimeError('operator does not exist')
        return SimpleNamespace(data=[r for r in self.sb.linhas if self.pred(r['nome_via'])][:self.n])


class TomTomFalso:
    """TomTomClient.buscar sem rede: devolve `respostas[texto]` e guarda os textos pedidos."""
    ativo = True

    def __init__(self, respostas=None, erro=None):
        self.respostas, self.erro, self.chamadas, self.pertos = respostas or {}, erro, [], []

    async def buscar(self, q, limite=10, perto=None):
        self.chamadas.append(q)
        self.pertos.append(perto)
        if self.erro:
            raise self.erro
        return [dict(r) for r in self.respostas.get(q, [])]


def cand(nome, cod=None, bairro='Plano Piloto', lat=-15.79, lon=-47.88, tipo='POI', nota=0.99, sublabel=None):
    """Candidato no formato de TomTomClient.buscar."""
    return {'label': nome, 'sublabel': sublabel if sublabel is not None else bairro, 'bairro': bairro,
            'categoria_codigo': cod, 'score': nota, 'lat': lat, 'lon': lon, 'tipo': tipo, 'fonte': 'tomtom'}


def cliente(sb=None, tt=None):
    """TestClient de um app só com o router de busca (sem grafo, sem modelo, sem lifespan)."""
    app = FastAPI()
    app.include_router(search.router)
    app.state.supabase = sb
    app.state.tomtom = tt
    return TestClient(app)
