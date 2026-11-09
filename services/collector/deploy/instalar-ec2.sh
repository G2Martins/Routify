#!/usr/bin/env bash
# Instala o coletor ao lado da API na EC2 (docs/core/deploy.md §1.1). Idempotente.
#
# Pré-requisitos (os mesmos da API):
#   /opt/routify                              código do commit implantado (git archive)
#   /opt/routify/services/collector/config    .env + tomtom_keys.json (o dono copia por scp)
#
# Uso:  sudo bash /opt/routify/services/collector/deploy/instalar-ec2.sh
set -euo pipefail
RAIZ=/opt/routify
COL="$RAIZ/services/collector"

[ -f "$COL/config/.env" ] || { echo "falta $COL/config/.env (scp do dono)"; exit 1; }
[ -f "$COL/config/tomtom_keys.json" ] || { echo "falta $COL/config/tomtom_keys.json (scp do dono)"; exit 1; }

id routify >/dev/null 2>&1 || useradd --system --home-dir "$RAIZ" --shell /usr/sbin/nologin routify
[ -d "$COL/.venv" ] || python3 -m venv "$COL/.venv"
"$COL/.venv/bin/pip" install -q --upgrade pip
"$COL/.venv/bin/pip" install -q -r "$COL/deploy/requirements-ec2.txt"
chown -R routify:routify "$COL"
chmod -R go-rwx "$COL/config"

install -m 0644 "$COL/deploy/routify-collector.service" /etc/systemd/system/routify-collector.service
# Comparador LIA × provedores: oneshot + timer (8 rodadas/dia). Só liga com COMPARADOR=1,
# depois que a migration 20261102000000_lia_vs_provedores criar a tabela.
install -m 0644 "$COL/deploy/routify-comparador.service" /etc/systemd/system/routify-comparador.service
install -m 0644 "$COL/deploy/routify-comparador.timer" /etc/systemd/system/routify-comparador.timer
install -m 0644 "$COL/deploy/routify-gps.service" /etc/systemd/system/routify-gps.service
install -m 0644 "$COL/deploy/routify-gps.timer" /etc/systemd/system/routify-gps.timer
# Rotina de validação: roda ao fim de cada rodada do comparador (OnSuccess/OnFailure), sem timer próprio.
install -m 0644 "$COL/deploy/routify-rotina.service" /etc/systemd/system/routify-rotina.service
# A/B nos picos de dia útil (scripts/ab_ec2.sh): só liga com AB=1; para sozinho na data AB_ATE da unit.
install -m 0644 "$COL/deploy/routify-ab.service" /etc/systemd/system/routify-ab.service
install -m 0644 "$COL/deploy/routify-ab.timer" /etc/systemd/system/routify-ab.timer
systemctl daemon-reload
if [ "${GPS:-0}" = 1 ]; then systemctl enable --now routify-gps.timer >/dev/null; fi
if [ "${COMPARADOR:-0}" = 1 ]; then systemctl enable --now routify-comparador.timer >/dev/null; echo "comparador: $(systemctl list-timers routify-comparador.timer --no-pager | sed -n 2p)"; fi
if [ "${AB:-0}" = 1 ]; then systemctl enable --now routify-ab.timer >/dev/null; echo "A/B: $(systemctl list-timers routify-ab.timer --no-pager | sed -n 2p)"; fi
systemctl enable routify-collector >/dev/null
systemctl restart routify-collector
sleep 5
systemctl --no-pager --lines=0 status routify-collector | head -5
echo "ok: acompanhe com  journalctl -u routify-collector -f  (1º ciclo leva ~6 min; depois 1 a cada ~43 min)"
