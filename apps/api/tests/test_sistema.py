"""GET /admin/sistema: leitura de /proc e /sys (amostras reais da EC2 de 2026-11-02) e a guarda de admin."""
import types

from fastapi import FastAPI
from fastapi.testclient import TestClient

import sistema
from routers import admin

MEMINFO = """MemTotal:        1953204 kB
MemFree:          142000 kB
MemAvailable:     950272 kB
SwapCached:        10000 kB
SwapTotal:       2097148 kB
SwapFree:        1984508 kB
"""
STAT_1 = "cpu  888321 46368 164145 689394480 82199 0 6649 1210647 0 0\ncpu0 1 2 3 4 5 6 7 8 0 0\n"
STAT_2 = "cpu  888421 46368 164165 689394600 82199 0 6649 1210707 0 0\ncpu0 1 2 3 4 5 6 7 8 0 0\n"


def test_meminfo_em_mb():
    assert sistema.meminfo(MEMINFO) == {'MemTotal': 1907, 'MemAvailable': 928, 'SwapTotal': 2047, 'SwapFree': 1937}


def test_janela_de_cpu_separa_ocupada_e_roubada():
    # 100 user + 20 system + 120 idle + 60 steal = 300 jiffies: 60% sem ociosidade, 20% roubados pelo hipervisor.
    assert sistema.janela_cpu(STAT_1, STAT_2) == {'ocupada_pct': 60.0, 'roubada_pct': 20.0}


def test_servico_rodando_pelo_cgroup(tmp_path):
    (tmp_path / 'routify-collector.service').mkdir()
    (tmp_path / 'routify-collector.service' / 'cgroup.procs').write_text('172192\n')
    (tmp_path / 'routify-comparador.service').mkdir()
    (tmp_path / 'routify-comparador.service' / 'cgroup.procs').write_text('')
    assert sistema.rodando('routify-collector', str(tmp_path)) is True
    assert sistema.rodando('routify-comparador', str(tmp_path)) is False  # oneshot parado
    assert sistema.rodando('routify-ab', str(tmp_path)) is False          # sem cgroup


def _app(papel):
    def get_user(_t):
        return types.SimpleNamespace(user=types.SimpleNamespace(id='u-1', app_metadata={'role': papel}, factors=[]))
    app = FastAPI()
    app.include_router(admin.router)
    app.state.supabase = types.SimpleNamespace(auth=types.SimpleNamespace(get_user=get_user))
    return TestClient(app)


def test_endpoint_so_para_admin_e_sem_quebrar_fora_do_linux():
    assert _app('admin').get('/admin/sistema').status_code == 401
    assert _app('usuario').get('/admin/sistema', headers={'Authorization': 'Bearer x'}).status_code == 403
    r = _app('admin').get('/admin/sistema', headers={'Authorization': 'Bearer x'})
    assert r.status_code == 200
    corpo = r.json()
    assert {'cpu', 'memoria_mb', 'disco_gb', 'servicos', 'api_no_ar_min'} <= set(corpo)
    assert corpo['disco_gb']['total'] > 0
