#!/usr/bin/env bash
# Empacota o front para UM site Node na Hostinger: o painel Next (apps/admin) com o
# export web do Expo (apps/mobile) no public/ — a raiz serve o app, /admin o painel
# (mesmo domínio, um cookie de sessão; ver apps/admin/next.config.ts).
#
# Uso:  API_URL=https://api.seu-dominio scripts/empacotar-front.sh /caminho/front.tar.gz
#
# Supabase: o Expo lê apps/mobile/.env (URL + chave publishable, públicas por natureza).
# No Next, NEXT_PUBLIC_* vêm das variáveis do site na Hostinger (valem no build de lá).
# Nunca entra no pacote: .env*, node_modules, .next.
set -euo pipefail
: "${API_URL:?defina API_URL, ex.: https://api-routify.exemplo.com}"
: "${1:?informe o arquivo de saída .tar.gz (fora do repo)}"
raiz="$(cd "$(dirname "$0")/.." && pwd)"
saida="$1"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cd "$raiz/apps/mobile"
rm -rf dist
# --clear: o cache do Metro guarda os EXPO_PUBLIC_* já inlinados do dev (localhost).
EXPO_PUBLIC_API_URL="$API_URL" EXPO_PUBLIC_ADMIN_URL=/admin npx expo export --platform web --clear
if ! grep -rqsF "$API_URL" dist/_expo || grep -rqs "localhost:8000\|localhost:3000" dist/_expo; then
  echo "ERRO: o bundle ainda aponta para localhost (API_URL não entrou)" >&2
  exit 1
fi

tar -C "$raiz/apps/admin" --exclude=./node_modules --exclude=./.next --exclude='./.env*' \
    --exclude=./tsconfig.tsbuildinfo --exclude=./public -cf - . | tar -C "$stage" -xf -
mkdir -p "$stage/public"
cp -r dist/. "$stage/public/"
rm -rf dist
tar -C "$stage" -czf "$saida" .
echo "Pacote: $saida ($(du -h "$saida" | cut -f1))"
