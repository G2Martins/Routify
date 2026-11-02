"""
A/B no mesmo instante: duas ou mais APIs locais, viagem a viagem, contra a TomTom (ao vivo, sem trânsito e
histórico no MESMO trajeto, reconstruído pela fusão; e a rota própria da TomTom, com o traçado em comum).
Par descartado na comparação de mesmo trajeto se a TomTom desviou mais de 10% na distância.

Usado em 2026-11-02 na calibração por grupo de via (ml/artifacts/ab_calibracao_grafo_2026-11-02.json) e nos
sensores virtuais. Rode de services/collector (usa o comparador e o pool de chaves de lá):

    APIS="A=http://127.0.0.1:8011,B=http://127.0.0.1:8012" python ../../scripts/ab_rotas.py saida.json [viagens.json]

viagens.json = [[id, nome, [lat, lon], [lat, lon]], ...]; sem ele, os 16 corredores do comparador.
Exemplo de conjunto: scripts/viagens_buracos.json (as maiores lacunas de sensor da auditoria do grafo).
"""
import json, os, statistics, sys, time
sys.path.insert(0, '.')  # services/collector
import requests
import comparar_provedores as cp

APIS = dict(x.split('=', 1) for x in os.environ.get('APIS', 'A=http://127.0.0.1:8011,B=http://127.0.0.1:8012').split(','))
s = requests.Session()
tt_propria = cp.provedores()['tomtom']
pares = cp.CORREDORES if len(sys.argv) < 3 else [tuple(x) for x in json.load(open(sys.argv[2], encoding='utf-8'))]
out = []
for cid, nome, o, d in pares:
    linha = {'corredor': cid}
    try:
        ref = tt_propria(o, d, s)
    except Exception as e:
        ref = {}
    linha['tt_propria_s'] = ref.get('tempo_s')
    for k, api in APIS.items():
        try:
            r = s.post(f'{api}/route', json={'origem': {'lat': o[0], 'lon': o[1]}, 'destino': {'lat': d[0], 'lon': d[1]},
                                              'referencia_tomtom': True}, timeout=120)
            j = r.json()
            if r.status_code != 200:
                linha[k] = {'erro': r.status_code}; continue
        except Exception as e:
            linha[k] = {'erro': type(e).__name__}; continue
        tt = j.get('tomtom') or {}
        alt = j.get('alternativa') or {}
        lia_alt = j.get('fonte_rota') == 'tomtom' and alt.get('fonte') == 'lia'
        poly = alt.get('polyline') if lia_alt else j.get('polyline')
        linha[k] = {'lia_s': j.get('tempo_lia_seg'), 'livre_s': j.get('tempo_livre_lia_seg'),
                    'tt_vivo_s': tt.get('referencia_tempo_seg'), 'tt_livre_s': tt.get('referencia_sem_transito_seg'),
                    'tt_hist_s': tt.get('referencia_historico_seg'), 'fonte': j.get('fonte_rota'),
                    'exibido_s': j.get('tempo_total_seg'), 'km': alt.get('distancia_km') if lia_alt else j.get('distancia_km'),
                    'tt_km': tt.get('referencia_distancia_km'),
                    'traco_pct': cp.traco_comum_pct([tuple(p) for p in poly or []], ref['_traco']) if ref.get('_traco') else None}
    out.append(linha)
    print(json.dumps(linha, ensure_ascii=False), flush=True)
    time.sleep(3)

def erro(k, a, b, mesmo_trajeto=True):
    e = []
    for l in out:
        x = l.get(k) or {}
        va = x.get(a); vb = x.get(b) if b in x else l.get(b)
        if not va or not vb:
            continue
        # mesmo trajeto: a TomTom pode desviar ao reconstruir; descarta desvio > 10% na distância
        if mesmo_trajeto and x.get('km') and x.get('tt_km') and abs(x['tt_km'] / x['km'] - 1) > 0.10:
            continue
        e.append(100 * (va - vb) / vb)
    return (len(e), round(statistics.median(e), 1), round(statistics.mean(abs(v) for v in e), 1)) if e else None

resumo = {}
for k in APIS:
    tr = [l[k]['traco_pct'] for l in out if (l.get(k) or {}).get('traco_pct') is not None]
    resumo[k] = {'LIA x TomTom vivo (mesmo trajeto)': erro(k, 'lia_s', 'tt_vivo_s'),
                 'livre LIA x TomTom sem transito': erro(k, 'livre_s', 'tt_livre_s'),
                 'LIA x TomTom historico': erro(k, 'lia_s', 'tt_hist_s'),
                 'exibido x rota propria TomTom': erro(k, 'exibido_s', 'tt_propria_s', False),
                 'traco comum c/ TomTom (media %)': round(statistics.mean(tr), 1) if tr else None,
                 'rotas TomTom venceu': sum(1 for l in out if (l.get(k) or {}).get('fonte') == 'tomtom')}
print('(n, vies mediano %, MAPE %)')
print(json.dumps(resumo, ensure_ascii=False, indent=1))
json.dump({'resumo': resumo, 'linhas': out}, open(sys.argv[1], 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
