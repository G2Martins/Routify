#!/usr/bin/env bash
# A/B no mesmo instante NA EC2 (routify-ab.service, nos picos de dia útil). A = API de produção (:8000);
# B = o mesmo código com UMA variável trocada (:8001), de pé só durante a medida. Variantes:
#   sensores  SENSORES_VIRTUAIS=1, nas 10 viagens pelos buracos de sensor (scripts/viagens_buracos.json)
#   restricoes RESTRICOES_CONVERSAO=1 (conversões proibidas do OSM), nas 30 viagens do comparador
#   lia24     LIA_VERSION=lia_2.4, nos 16 corredores do comparador
# Saída: $STATE_DIRECTORY/<variante>_<data>_<hora>.json (/var/lib/routify-ab). Depois de AB_ATE não roda
# mais (cota da TomTom: cada passada gasta Flow/Routing dos dois braços).
set -euo pipefail
RAIZ=/opt/routify
SAIDA=${STATE_DIRECTORY:-/var/lib/routify-ab}
if [ -n "${AB_ATE:-}" ] && [ "$(date +%F)" \> "$AB_ATE" ]; then echo "A/B encerrado em $AB_ATE"; exit 0; fi

for V in "$@"; do
  case $V in
    sensores) VAR=SENSORES_VIRTUAIS=1; VIAGENS=$RAIZ/scripts/viagens_buracos.json ;;
    restricoes) VAR=RESTRICOES_CONVERSAO=1; VIAGENS=todos ;;
    lia24)    VAR=LIA_VERSION=lia_2.4; VIAGENS= ;;
    *) echo "variante desconhecida: $V"; continue ;;
  esac
  [ "$V" != lia24 ] || [ -f "$RAIZ/ml/artifacts/lia_2.4.pkl" ] || { echo "$V: falta lia_2.4.pkl"; continue; }
  (cd "$RAIZ/apps/api" && exec env "$VAR" .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001 --no-access-log) &
  B=$!
  pronto=0
  for _ in $(seq 1 60); do
    if curl -sf -m 5 http://127.0.0.1:8001/health >/dev/null; then pronto=1; break; fi
    sleep 3
  done
  if [ $pronto = 1 ]; then
    (cd "$RAIZ/services/collector" && APIS="A=http://127.0.0.1:8000,B=http://127.0.0.1:8001" \
      .venv/bin/python ../../scripts/ab_rotas.py "$SAIDA/${V}_$(date +%F_%H%M).json" $VIAGENS) || echo "$V: A/B falhou"
  else
    echo "$V: B não subiu em 3 min"
  fi
  kill $B 2>/dev/null || true
  wait $B 2>/dev/null || true
done
