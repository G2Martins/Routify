"""
Estado da máquina da API para o painel ADM (GET /admin/sistema, tela de status ao vivo): memória e swap, CPU
ocupada e CPU "roubada" pelo hipervisor (na t3 é o sinal de crédito de CPU esgotado), carga, disco, há quanto tempo a
máquina e a API estão de pé e quais serviços do Routify estão rodando agora. Só lê /proc, /sys e o disco; fora do
Linux (dev no Windows) os campos vêm None.

Serviço rodando = cgroup do systemd com processo (/sys/fs/cgroup/system.slice/<unidade>/cgroup.procs): funciona
para o usuário sem privilégio da API, sem D-Bus. Oneshots (comparador, rotina, A/B) só aparecem enquanto rodam.
"""
import asyncio
import os
import shutil
import time
from typing import Optional

INICIO_API = time.time()
UNIDADES = ('routify-api', 'routify-collector', 'routify-comparador', 'routify-rotina', 'routify-ab', 'caddy')
CGROUP = '/sys/fs/cgroup/system.slice'


def _ler(caminho: str) -> Optional[str]:
    try:
        with open(caminho, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return None


def meminfo(texto: str) -> dict:
    """MemTotal, MemAvailable, SwapTotal e SwapFree de /proc/meminfo, em MB."""
    v = {}
    for linha in texto.splitlines():
        nome, _, resto = linha.partition(':')
        if nome in ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree') and resto.split():
            v[nome] = int(resto.split()[0]) // 1024
    return v


def cpu(texto: str) -> tuple:
    """(total, ociosa, roubada) em jiffies da linha agregada `cpu` de /proc/stat."""
    campos = [int(x) for x in texto.splitlines()[0].split()[1:9]]
    campos += [0] * (8 - len(campos))
    # user nice system idle iowait irq softirq steal
    return sum(campos), campos[3] + campos[4], campos[7]


def janela_cpu(antes: str, depois: str) -> dict:
    """% de CPU ocupada e roubada entre duas leituras de /proc/stat."""
    t1, o1, r1 = cpu(antes)
    t2, o2, r2 = cpu(depois)
    dt = max(t2 - t1, 1)
    return {'ocupada_pct': round(100 * (dt - (o2 - o1)) / dt, 1), 'roubada_pct': round(100 * (r2 - r1) / dt, 1)}


def rodando(unidade: str, raiz: str = CGROUP) -> bool:
    procs = _ler(os.path.join(raiz, f'{unidade}.service', 'cgroup.procs'))
    return bool(procs and procs.strip())


async def coletar(janela_s: float = 0.5) -> dict:
    antes = _ler('/proc/stat')
    await asyncio.sleep(janela_s)
    depois = _ler('/proc/stat')
    mem = meminfo(_ler('/proc/meminfo') or '')
    uptime = _ler('/proc/uptime')
    rss = next((int(l.split()[1]) // 1024 for l in (_ler('/proc/self/status') or '').splitlines()
                if l.startswith('VmRSS:')), None)
    disco = shutil.disk_usage('/')
    try:
        carga = [round(x, 2) for x in os.getloadavg()]
    except (AttributeError, OSError):
        carga = None
    swappiness = _ler('/proc/sys/vm/swappiness')
    commit = _ler('/opt/routify/.commit')
    return {
        'cpu': janela_cpu(antes, depois) if antes and depois else None,
        'carga_1_5_15': carga,
        'memoria_mb': {'total': mem.get('MemTotal'), 'disponivel': mem.get('MemAvailable'),
                       'swap_total': mem.get('SwapTotal'),
                       'swap_usado': (mem['SwapTotal'] - mem['SwapFree']) if 'SwapTotal' in mem and 'SwapFree' in mem else None,
                       'api_rss': rss},
        'swappiness': int(swappiness) if swappiness and swappiness.strip().isdigit() else None,
        'disco_gb': {'total': round(disco.total / 1e9, 1), 'livre': round(disco.free / 1e9, 1)},
        'maquina_no_ar_h': round(float(uptime.split()[0]) / 3600, 1) if uptime else None,
        'api_no_ar_min': round((time.time() - INICIO_API) / 60, 1),
        'servicos': {u: rodando(u) for u in UNIDADES} if os.path.isdir(CGROUP) else None,
        'commit': commit.strip()[:40] if commit else None,
    }
