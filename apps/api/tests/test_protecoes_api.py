"""Proteções da auditoria de 2026-11-03: gravação de uso em executor próprio com fila limitada (M1) e coordenadas
da rota só no DF (M2)."""
import asyncio
import threading
import types

import pytest

import usage


def test_uso_vai_para_executor_proprio_e_fila_cheia_descarta(monkeypatch):
    liberar, nomes = threading.Event(), []

    def execute():
        nomes.append(threading.current_thread().name)
        liberar.wait(2)

    sb = types.SimpleNamespace(table=lambda t: types.SimpleNamespace(insert=lambda linha: types.SimpleNamespace(execute=execute)))
    monkeypatch.setattr(usage, '_vagas', threading.BoundedSemaphore(1))
    monkeypatch.setattr(usage, 'REGISTRAR_USO', True)

    async def rodar():
        usage.registrar(sb, 'eventos_app', {'n': 1})  # ocupa a única vaga (preso em execute)
        usage.registrar(sb, 'eventos_app', {'n': 2})  # fila cheia: descartado, sem esperar
        await asyncio.sleep(0.2)
        liberar.set()
        await asyncio.sleep(0.2)

    asyncio.run(rodar())
    assert len(nomes) == 1 and nomes[0].startswith('uso')


def test_rota_so_aceita_coordenadas_do_df():
    pytest.importorskip('osmnx')
    from pydantic import ValidationError
    from routers.route import RouteInput
    ok = {'origem': {'lat': -15.79, 'lon': -47.88}, 'destino': {'lat': -15.83, 'lon': -48.05}}
    RouteInput(**ok)
    for fora in ({'lat': 48.85, 'lon': 2.35}, {'lat': -23.55, 'lon': -46.63}, {'lat': -15.79, 'lon': -50.0}):
        with pytest.raises(ValidationError):
            RouteInput(**{**ok, 'destino': fora})


def test_busca_tomtom_tem_teto_por_ip_e_dia(monkeypatch):
    """Um IP só não gasta a cota de Search do pool: passou do teto, só a base local (auditoria M2)."""
    from routers import search
    monkeypatch.setattr(search, 'TOMTOM_POR_IP_DIA', 3)
    monkeypatch.setattr(search, '_tomtom_por_ip', {})
    assert [search.tomtom_liberado('1.2.3.4') for _ in range(4)] == [True, True, True, False]
    assert search.tomtom_liberado('5.6.7.8') is True
