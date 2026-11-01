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
systemctl daemon-reload
systemctl enable routify-collector >/dev/null
systemctl restart routify-collector
sleep 5
systemctl --no-pager --lines=0 status routify-collector | head -5
echo "ok: acompanhe com  journalctl -u routify-collector -f  (1º ciclo leva ~6 min; depois 1 a cada ~43 min)"
