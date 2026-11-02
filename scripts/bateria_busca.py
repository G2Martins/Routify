"""
Bateria do auto-sugest com pontos famosos do DF (services/collector/pontos_df.json).

Para cada ponto e cada consulta que um usuário digitaria, chama GET /search/places e confere se
algum dos 5 primeiros resultados cai dentro do raio do ponto oficial (OSM). Roda em qualquer
lugar; na EC2, pelo loopback com X-Routify-Interno (fora da captura de uso e do limite público).
Só stdlib. Saída: JSON com o resultado por consulta e o resumo.

    python scripts/bateria_busca.py [--api http://127.0.0.1:8000] [--pausa 0.7] > resultado.json
"""
import argparse
import json
import math
import os
import time
import unicodedata
import urllib.parse
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PONTOS = os.path.join(RAIZ, 'services', 'collector', 'pontos_df.json')


def _dist_m(a, b):
    """Haversine em metros."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _norm(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()


def buscar(api, q, limite=5):
    url = f"{api}/search/places?{urllib.parse.urlencode({'q': q, 'limit': limite})}"
    req = urllib.request.Request(url, headers={'X-Routify-Interno': '1', 'User-Agent': 'routify-bateria'})
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=30) as r:
        dados = json.loads(r.read().decode('utf-8'))
    return dados, round((time.monotonic() - t0) * 1000)


def avaliar(ponto, q, resultados, ms):
    alvo = (ponto['lat'], ponto['lon'])
    raio = float(ponto.get('raio_m') or 500)
    rank, dist = None, None
    for i, r in enumerate(resultados, 1):
        d = _dist_m(alvo, (r['lat'], r['lon']))
        if d <= raio:
            rank, dist = i, round(d)
            break
    primeiro = resultados[0] if resultados else {}
    return {'ponto': ponto['id'], 'tipo': ponto.get('tipo'), 'consulta': q, 'rank': rank, 'dist_m': dist,
            'n': len(resultados), 'ms': ms,
            'top1': {k: primeiro.get(k) for k in ('label', 'sublabel', 'source', 'categoria')} if primeiro else None,
            'top1_dist_m': round(_dist_m(alvo, (primeiro['lat'], primeiro['lon']))) if primeiro else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', default=os.getenv('ROUTIFY_API_INTERNA', 'http://127.0.0.1:8000'))
    ap.add_argument('--pausa', type=float, default=0.7, help='s entre consultas (a busca aceita 90/min por IP)')
    ap.add_argument('--pontos', default=PONTOS)
    args = ap.parse_args()
    with open(args.pontos, encoding='utf-8') as f:
        pontos = json.load(f)
    linhas = []
    for p in pontos:
        for q in p.get('consultas') or [p['nome']]:
            try:
                dados, ms = buscar(args.api, q)
                linhas.append(avaliar(p, q, dados, ms))
            except Exception as e:
                linhas.append({'ponto': p['id'], 'tipo': p.get('tipo'), 'consulta': q, 'erro': type(e).__name__})
            time.sleep(args.pausa)
    validas = [l for l in linhas if 'erro' not in l]
    por_ponto = {}
    for l in validas:
        por_ponto.setdefault(l['ponto'], []).append(l['rank'])
    resumo = {
        'consultas': len(linhas), 'erros': len(linhas) - len(validas),
        'top1_pct': round(100 * sum(1 for l in validas if l['rank'] == 1) / max(len(validas), 1), 1),
        'top5_pct': round(100 * sum(1 for l in validas if l['rank']) / max(len(validas), 1), 1),
        'pontos': len(por_ponto),
        'pontos_sem_nenhum_acerto': sorted(p for p, rs in por_ponto.items() if not any(rs)),
        'ms_mediana': sorted(l['ms'] for l in validas)[len(validas) // 2] if validas else None,
    }
    print(json.dumps({'resumo': resumo, 'consultas': linhas}, ensure_ascii=False))


if __name__ == '__main__':
    main()
