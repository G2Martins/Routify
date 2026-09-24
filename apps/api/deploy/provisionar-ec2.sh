#!/usr/bin/env bash
# Provisiona a API numa EC2 Ubuntu 24.04 de 2 GB (t3.small, plano Free da AWS):
# swap, venv, serviço systemd sem root e Caddy com TLS automático (Let's Encrypt).
#
# Pré-requisitos no servidor (ver docs/core/deploy.md):
#   /opt/routify                             código (git archive do commit implantado)
#   /opt/routify/ml/artifacts                .pkl/.graphml (fora do git, via scp)
#   /opt/routify/services/collector/config   .env + tomtom_keys.json (o dono copia)
#
# Uso:  sudo API_DOMAIN=api.exemplo.com APP_ORIGIN=https://app.exemplo.com bash provisionar-ec2.sh
# Idempotente: rodar de novo só reinstala dependências e reinicia.
set -euo pipefail
: "${API_DOMAIN:?defina API_DOMAIN}" "${APP_ORIGIN:?defina APP_ORIGIN}"
RAIZ=/opt/routify
API="$RAIZ/apps/api"

# 2 GB de swap: folga para picos (pip, subida) numa máquina de 2 GB.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null; then
  apt-get update -q
  apt-get install -yq python3-venv debian-keyring debian-archive-keyring apt-transport-https curl gpg ufw
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi

id routify >/dev/null 2>&1 || useradd --system --home-dir "$RAIZ" --shell /usr/sbin/nologin routify
[ -d "$API/.venv" ] || python3 -m venv "$API/.venv"
"$API/.venv/bin/pip" install -q --upgrade pip
"$API/.venv/bin/pip" install -q -r "$API/requirements.txt"
chown -R routify:routify "$RAIZ"
chmod -R go-rwx "$RAIZ/services/collector/config"

cat > /etc/systemd/system/routify-api.service <<EOF
[Unit]
Description=Routify API (FastAPI + LIA)
After=network-online.target
Wants=network-online.target
# Sem as credenciais o serviço nem tenta subir (evita loop de restart recarregando o grafo).
ConditionPathExists=$RAIZ/services/collector/config/.env

[Service]
User=routify
WorkingDirectory=$API
Environment=TZ=America/Sao_Paulo
Environment=TRUST_PROXY=1
Environment=CORS_ORIGINS=$APP_ORIGIN
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=$API/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
# ~0,8 GB em uso; o teto protege o SO numa máquina de 2 GB.
MemoryMax=1500M
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
# Só os artefatos são graváveis (a API refaz o pickle do grafo quando precisa).
ReadWritePaths=$RAIZ/ml/artifacts

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$API_DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8000
	header {
		Strict-Transport-Security "max-age=63072000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
		-Server
	}
}
EOF

# Defesa em profundidade além do security group da AWS.
ufw allow OpenSSH >/dev/null && ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now routify-api >/dev/null
systemctl restart routify-api caddy
echo "ok: acompanhe com  journalctl -u routify-api -f"
