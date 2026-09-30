#!/usr/bin/env bash
# Passo Linux do deploy do front: builda o painel Next (standalone) e monta a árvore
# que a Hostinger só RODA. O plano compartilhado não aguenta o build (limite LVE) e
# instala só dependencies, sem as devDeps do Tailwind. Binários nativos têm que ser
# de Linux, por isso este passo não roda no Windows.
#
# Uso (Linux x64 + Node 22), dentro da pasta extraída de scripts/empacotar-front.sh:
#   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
#   NEXT_PUBLIC_API_URL=https://api... NEXT_PUBLIC_APP_URL=/ bash montar-front-linux.sh /saida/front.tar.gz
set -euo pipefail
: "${NEXT_PUBLIC_SUPABASE_URL:?}" "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?}" "${NEXT_PUBLIC_API_URL:?}" "${NEXT_PUBLIC_APP_URL:?}"
: "${1:?informe o .tar.gz de saída}"
saida="$(realpath -m "$1")"
[ -f public/index.html ] || { echo "public/index.html ausente: rode scripts/empacotar-front.sh" >&2; exit 1; }

npm ci --ignore-scripts --no-audit --no-fund   # nenhuma dependência precisa de script de instalação
NEXT_TELEMETRY_DISABLED=1 npx next build

arv="$(mktemp -d)"
trap 'rm -rf "$arv"' EXIT
cp -a .next/standalone/. "$arv/"
cp -a .next/static "$arv/.next/static"
cp -a public "$arv/public"
cp deploy/index.js "$arv/index.js"
# O deploy por arquivo da Hostinger não aceita node_modules na raiz: vai à parte e o
# "build" de lá só copia. package.json mínimo: nada para o host instalar.
mv "$arv/node_modules" "$arv/prebuilt_node_modules"
cat > "$arv/package.json" <<'JSON'
{
  "name": "routify-front",
  "private": true,
  "main": "index.js",
  "engines": { "node": "22" },
  "scripts": {
    "build": "rm -rf node_modules && cp -a prebuilt_node_modules node_modules",
    "start": "node index.js"
  }
}
JSON
# Sem prefixo ./ nas entradas: com ./ a Hostinger responde 500 ao ler o pacote.
(cd "$arv" && tar -czf "$saida" $(ls -A))
echo "Pacote: $saida ($(du -h "$saida" | cut -f1))"
