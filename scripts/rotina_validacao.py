"""
Rotina de validação da LIA em produção. Roda NA EC2, logo depois de cada rodada do comparador
(routify-comparador.service → OnSuccess/OnFailure → routify-rotina.service; 8 rodadas por dia,
picos inclusos — services/collector/deploy/routify-comparador.timer).

Cada execução:
  1. checagens contra 127.0.0.1 com X-Routify-Interno (fora da captura de uso): fuso do timestamp,
     NaN/Infinity/ano 1/override pela metade → 422, previsão na faixa, busca, erros no log da API
     desde a execução anterior, coletor vivo;
  2. lê o log da rodada do comparador que a disparou (LIA × TomTom no mesmo trajeto e contra a rota
     própria da TomTom, Mapbox, OSRM).
Grava em $STATE_DIRECTORY (/var/lib/routify-rotina): historico.jsonl (uma linha por execução) e
relatorio.md (tabela). Só stdlib. Como ver o relatório: docs/core/deploy.md §1.1.

    python3 scripts/rotina_validacao.py      # na EC2; sem o systemd, lê a rodada dos últimos 20 min
"""
import json
import os
import re
import statistics as st
import subprocess
import sys
from datetime import datetime, timedelta, timezone

SAIDA = os.getenv('STATE_DIRECTORY') or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                                     'services', 'collector', 'dados', 'rotina')
BRT = timezone(timedelta(hours=-3))

# Cada linha "CHECK nome valor" vira um item do relatório. DESDE = execução anterior (hora local).
SCRIPT = r'''
H=http://127.0.0.1:8000
cj(){ curl -s -m 25 -H 'X-Routify-Interno: 1' -H 'Content-Type: application/json' "$@"; }
cc(){ curl -s -o /dev/null -w '%{http_code}' -m 25 -H 'X-Routify-Interno: 1' -H 'Content-Type: application/json' "$@"; }
echo "CHECK fuso $(cj -X POST $H/predict -d '{"id_ponto":100,"velocidade_livre":60,"timestamp_brasilia":"2026-11-02T20:30:00Z"}' | grep -o '"hora":[0-9]*')"
echo "CHECK nan $(cc -X POST $H/predict -d '{"id_ponto":100,"velocidade_livre":NaN}')"
echo "CHECK infinito $(cc -X POST $H/predict -d '{"id_ponto":100,"velocidade_livre":Infinity}')"
echo "CHECK ano1 $(cc -X POST $H/predict -d '{"id_ponto":100,"velocidade_livre":60,"timestamp_brasilia":"0001-01-01T00:00:00"}')"
echo "CHECK override $(cc -X POST $H/predict -d '{"id_ponto":100,"velocidade_livre":60,"razao_ultima_observacao":0.5}')"
echo "CHECK predict $(cj -X POST $H/predict -d '{"id_ponto":100,"velocidade_livre":60}' | grep -o '"razao_congestionamento":[0-9.]*')"
echo "CHECK health $(curl -s -m 15 $H/health | tr -d '\n' | head -c 3000)"
echo "CHECK busca $(cj "$H/search/places?q=rodoviaria&limit=3" | grep -o '"label":"[^"]*"' | head -3 | tr '\n' ' ')"
echo "CHECK imatch $(journalctl -u routify-api --since "$DESDE" -o cat | grep -c 'imatch recusado')"
echo "CHECK erros_api $(journalctl -u routify-api --since "$DESDE" -o cat | grep -cE 'ERROR|Traceback')"
echo "CHECK coletor $(systemctl is-active routify-collector) $(journalctl -u routify-collector --since '-70 min' -o cat | grep -c 'inseridos')"
echo RODADA_INICIO
if [ -n "${MONITOR_INVOCATION_ID:-}" ]; then
  journalctl "_SYSTEMD_INVOCATION_ID=$MONITOR_INVOCATION_ID" -o cat
else
  journalctl -u routify-comparador --since '-20 min' -o cat
fi | grep -E ' - (INFO|WARNING) - ' | sed 's/^.* - \(INFO\|WARNING\) - //'
echo RODADA_FIM
'''


PROV = re.compile(r'(\w+) (?:(\d+)s(?: \((\d+)% tra.{1,2}ado\))?|([^|]+?))\s*(?:\||$)')


def ler_rodada(linhas: list) -> dict:
    """'corredor: lia 747s (69% traçado) | tomtom 1090s | ...' → {corredor: {provedor: (s, traco, erro)}}."""
    out = {}
    for l in linhas:
        if ':' not in l or 'Supabase' in l or 'gravadas' in l:
            continue
        cid, resto = l.split(':', 1)
        prov = {}
        for m in PROV.finditer(resto.strip()):
            nome, seg, traco, erro = m.groups()
            prov[nome] = (int(seg) if seg else None, int(traco) if traco else None, None if seg else (erro or '').strip())
        if prov:
            out[cid.strip()] = prov
    return out


def _na_faixa(texto: str) -> bool:
    m = re.search(r':\s*([0-9.]+)', texto)
    return bool(m) and 0.05 <= float(m.group(1)) <= 1.0


def avaliar(saida: str) -> dict:
    checks = dict(re.findall(r'^CHECK (\w+) ?(.*)$', saida, re.M))
    health = {}
    try:
        health = json.loads(checks.get('health') or '{}')
    except json.JSONDecodeError:
        pass
    rec = (health.get('recencia') or {}).get('mais_recente')
    idade = None
    if rec:
        idade = round((datetime.now(timezone.utc) - datetime.fromisoformat(rec)).total_seconds() / 60, 1)
    ok = {
        'api_ok': health.get('status') == 'ok',
        'velocidade_calibrada': health.get('velocidade_livre') == 'calibrada',
        'recencia_fresca': idade is not None and idade <= 60,
        'fuso': checks.get('fuso', '').endswith(':17'),
        'nan_422': checks.get('nan') == '422',
        'infinito_422': checks.get('infinito') == '422',
        'ano1_422': checks.get('ano1') == '422',
        'override_422': checks.get('override') == '422',
        'predict_na_faixa': _na_faixa(checks.get('predict', '')),
        'busca_responde': '"label"' in checks.get('busca', ''),
        'imatch_ok': checks.get('imatch', '0').strip() == '0',
        'sem_erro_no_log': checks.get('erros_api', '0').strip() == '0',
        'coletor_ativo': checks.get('coletor', '').startswith('active'),
    }
    bloco = saida.split('RODADA_INICIO', 1)[-1].split('RODADA_FIM', 1)[0].strip().splitlines()
    rodada = ler_rodada(bloco)

    def erro_pct(a, b):
        return 100.0 * (a - b) / b

    lia_trajeto = [erro_pct(p['lia'][0], p['tomtom_mesmo_trajeto'][0]) for p in rodada.values()
                   if p.get('lia', (None,))[0] and p.get('tomtom_mesmo_trajeto', (None,))[0]]
    resumo = {}
    for nome in ('lia', 'routify', 'osrm', 'mapbox'):
        e = [erro_pct(p[nome][0], p['tomtom'][0]) for p in rodada.values()
             if p.get(nome, (None,))[0] and p.get('tomtom', (None,))[0]]
        t = [p[nome][1] for p in rodada.values() if p.get(nome, (None, None))[1] is not None]
        if e:
            resumo[nome] = {'n': len(e), 'vies_mediano_pct': round(st.median(e), 1),
                            'mape_pct': round(st.mean(abs(x) for x in e), 1),
                            'traco_comum_pct': round(st.mean(t), 1) if t else None}
    return {'quando': datetime.now(BRT).isoformat(timespec='minutes'), 'modelo': health.get('modelo_ativo'),
            'rodada_resultado': os.getenv('MONITOR_SERVICE_RESULT'), 'checks': ok,
            'checks_falhos': [k for k, v in ok.items() if not v], 'recencia_idade_min': idade,
            'gravou_no_supabase': 'gravadas em comparacao_provedores' in saida,
            'pendentes': re.findall(r'(\d+) linhas esperam', saida)[-1:] or None,
            'corredores': len(rodada), 'lia_vs_tomtom_mesmo_trajeto': {
                'n': len(lia_trajeto), 'vies_mediano_pct': round(st.median(lia_trajeto), 1) if lia_trajeto else None,
                'mape_pct': round(st.mean(abs(x) for x in lia_trajeto), 1) if lia_trajeto else None},
            'vs_tomtom': resumo, 'rodada': rodada, 'bruto_checks': {k: v[:300] for k, v in checks.items() if k != 'health'}}


def relatorio(historico: list) -> str:
    linhas = ['# Rotina de validação da LIA em produção', '',
              'Gerado por `scripts/rotina_validacao.py` depois de cada rodada do comparador. Referência: TomTom com '
              'trânsito ao vivo. "Traçado" = % da rota igual à da TomTom (até 40 m, nos dois sentidos).', '',
              '| Quando | Modelo | Checagens | LIA × TomTom no mesmo trajeto (viés / MAPE) | LIA × rota da TomTom '
              '(viés / MAPE / traçado) | Mapbox × TomTom (viés / MAPE / traçado) | OSRM traçado | Recência | Supabase |',
              '|---|---|---|---|---|---|---|---|---|']
    for h in historico:
        mt, vt = h['lia_vs_tomtom_mesmo_trajeto'], h['vs_tomtom']
        f = lambda d, *k: ' / '.join('—' if (d or {}).get(x) is None else f"{d[x]}%" for x in k)
        falhos = h['checks_falhos']
        linhas.append(f"| {h['quando'][:16].replace('T', ' ')} | {h.get('modelo') or '—'} "
                      f"| {'ok' if not falhos else 'FALHOU: ' + ', '.join(falhos)} "
                      f"| {f(mt, 'vies_mediano_pct', 'mape_pct')} "
                      f"| {f(vt.get('lia'), 'vies_mediano_pct', 'mape_pct', 'traco_comum_pct')} "
                      f"| {f(vt.get('mapbox'), 'vies_mediano_pct', 'mape_pct', 'traco_comum_pct')} "
                      f"| {f(vt.get('osrm'), 'traco_comum_pct')} "
                      f"| {h['recencia_idade_min']} min | {'gravou' if h['gravou_no_supabase'] else 'pendente'} |")
    return '\n'.join(linhas) + '\n'


def main():
    os.makedirs(SAIDA, exist_ok=True)
    arq = os.path.join(SAIDA, 'historico.jsonl')
    historico = []
    if os.path.exists(arq):
        with open(arq, encoding='utf-8') as fh:
            historico = [json.loads(l) for l in fh if l.strip()]
    # Erros no log desde a execução anterior (8 rodadas por dia: até 4,5 h entre uma e outra).
    desde = datetime.fromisoformat(historico[-1]['quando']).strftime('%Y-%m-%d %H:%M:%S') if historico else '-70 min'
    try:
        saida = subprocess.run(['bash', '-c', SCRIPT], capture_output=True, text=True, timeout=240,
                               env={**os.environ, 'DESDE': desde}).stdout
        r = avaliar(saida)
    except Exception as e:  # registra a falha da própria rotina e segue na próxima rodada
        r = {'quando': datetime.now(BRT).isoformat(timespec='minutes'), 'erro_rotina': f'{type(e).__name__}: {e}'[:400],
             'checks': {}, 'checks_falhos': ['rotina'], 'lia_vs_tomtom_mesmo_trajeto': {}, 'vs_tomtom': {},
             'recencia_idade_min': None, 'gravou_no_supabase': False}
    historico.append(r)
    with open(arq, 'a', encoding='utf-8') as fh:
        fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    with open(os.path.join(SAIDA, 'relatorio.md'), 'w', encoding='utf-8') as fh:
        fh.write(relatorio(historico))
    print(json.dumps({k: r.get(k) for k in ('quando', 'modelo', 'checks_falhos', 'lia_vs_tomtom_mesmo_trajeto',
                                            'erro_rotina')}, ensure_ascii=True))
    return 0 if not r.get('checks_falhos') else 1


if __name__ == '__main__':
    sys.exit(main())
