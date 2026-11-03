#!/usr/bin/env bash
# Passo local do deploy do front (UM site Node na Hostinger: app em /, painel em /admin,
# mesmo domínio e um cookie de sessão). Gera o código do painel Next (apps/admin) com o
# export web do Expo (apps/mobile) em public/. O build do Next vem depois, em Linux:
# scripts/montar-front-linux.sh.
#
# Uso:  SITE_URL=https://seu-dominio API_URL=https://api.seu-dominio scripts/empacotar-front.sh /caminho/front-src.tar.gz
#
# Supabase: o Expo lê apps/mobile/.env (URL + chave publishable, públicas por natureza).
# Nunca entra no pacote: .env*, node_modules, .next.
#
# SEO (indexação): SITE_URL é a origem pública do site (só https, sem caminho). O repositório é público e não
# guarda o domínio: apps/mobile/public traz index.html (template do Expo), robots.txt, sitemap.xml, llms.txt e
# llms-full.txt com marcadores de origem e de data, trocados aqui. No fim, um teste confere o resultado.
set -euo pipefail
# Git Bash (Windows) converte valores que começam com "/" em caminho do Windows ao passar
# para o Node: "/admin" virava "C:/Program Files/Git/admin" dentro do bundle.
export MSYS_NO_PATHCONV=1
: "${API_URL:?defina API_URL, ex.: https://api-routify.exemplo.com}"
: "${SITE_URL:?defina SITE_URL, a origem pública do site, ex.: https://routify.exemplo.com (canonical, og:url, sitemap, llms.txt)}"
: "${1:?informe o arquivo de saída .tar.gz (fora do repo)}"
SITE_URL="${SITE_URL%/}"
if ! [[ "$SITE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "ERRO: SITE_URL deve ser só a origem em https, sem caminho (ex.: https://routify.exemplo.com): $SITE_URL" >&2
  exit 1
fi
raiz="$(cd "$(dirname "$0")/.." && pwd)"
saida="$1"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cd "$raiz/apps/mobile"
rm -rf dist
# --clear: o cache do Metro guarda os EXPO_PUBLIC_* já inlinados do dev (localhost).
EXPO_PUBLIC_API_URL="$API_URL" EXPO_PUBLIC_ADMIN_URL=/admin npx expo export --platform web --clear
if ! grep -rqsF "$API_URL" dist/_expo || ! grep -rqsE "[\"']/admin[\"']" dist/_expo \
   || grep -rqs "localhost:8000\|localhost:3000\|Program Files" dist/_expo; then
  echo "ERRO: API_URL/ADMIN_URL não entraram certos no bundle" >&2
  exit 1
fi

# SEO: o Expo copiou apps/mobile/public para dist/ e gravou o index.html pronto por cima do template.
lastmod="$(date -u +%F)"
for f in index.html robots.txt sitemap.xml llms.txt llms-full.txt; do
  [ -f "dist/$f" ] || { echo "ERRO: dist/$f ausente (veja apps/mobile/public)" >&2; exit 1; }
  sed -e "s|%SITE_URL%|$SITE_URL|g" -e "s|%LASTMOD%|$lastmod|g" "dist/$f" > "dist/$f.tmp"
  mv "dist/$f.tmp" "dist/$f"
done
SITE="$SITE_URL" node - <<'JS' || { echo "ERRO: SEO do pacote incompleto (veja apps/mobile/public)" >&2; exit 1; }
const fs = require('fs');
const site = process.env.SITE;
const erros = [];
const exige = (ok, msg) => { if (!ok) erros.push(msg); };

for (const f of ['og-image.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'favicon.ico'])
  exige(fs.existsSync(`dist/${f}`), `dist/${f} ausente`);
try { JSON.parse(fs.readFileSync('dist/manifest.webmanifest', 'utf8')); } catch (e) { erros.push(`manifest.webmanifest inválido: ${e.message}`); }

const texto = {};
for (const f of ['index.html', 'robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt']) {
  texto[f] = fs.readFileSync(`dist/${f}`, 'utf8');
  exige(!/%(SITE_URL|LASTMOD|LANG_ISO_CODE|WEB_TITLE)%/.test(texto[f]), `${f}: marcador sem troca`);
  exige(!/\/admin\b|painel\s+adm/i.test(texto[f]), `${f}: não pode citar o painel (o caminho dele não é anunciado)`);
}

const h = texto['index.html'];
const meta = (attr, nome) => (h.match(new RegExp(`<meta ${attr}="${nome}" content="([^"]*)"`)) || [])[1];
const titulo = (h.match(/<title>([^<]*)<\/title>/) || [])[1];
const desc = meta('name', 'description');
exige(/<html lang="pt-BR">/.test(h), 'html sem lang="pt-BR" (app.json › expo.web.lang)');
exige(h.includes(`<link rel="canonical" href="${site}/" />`), 'canonical ausente ou com outra origem');
exige(meta('property', 'og:url') === `${site}/`, 'og:url');
exige(meta('property', 'og:image') === `${site}/og-image.png` && meta('name', 'twitter:image') === `${site}/og-image.png`, 'og:image / twitter:image');
exige(titulo && meta('property', 'og:title') === titulo && meta('name', 'twitter:title') === titulo, '<title>, og:title e twitter:title diferentes');
exige(desc && desc.length <= 165 && meta('property', 'og:description') === desc && meta('name', 'twitter:description') === desc, 'description ausente, com mais de 165 caracteres ou diferente em og/twitter');
const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
exige(ld.length > 0, 'JSON-LD ausente');
for (const [, j] of ld) {
  try { JSON.parse(j); } catch (e) { erros.push(`JSON-LD inválido: ${e.message}`); }
}

exige(texto['robots.txt'].includes(`Sitemap: ${site}/sitemap.xml`) && !/^\s*disallow/im.test(texto['robots.txt']), 'robots.txt sem Sitemap ou com Disallow');
exige(texto['sitemap.xml'].includes(`<loc>${site}/</loc>`) && /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(texto['sitemap.xml']), 'sitemap.xml');
exige(texto['llms.txt'].startsWith('# Routify') && texto['llms.txt'].includes(`${site}/llms-full.txt`), 'llms.txt');
exige(texto['llms-full.txt'].startsWith('# ') && texto['llms-full.txt'].includes(`${site}/llms.txt`), 'llms-full.txt');

if (erros.length) {
  console.error(erros.map((e) => `ERRO SEO: ${e}`).join('\n'));
  process.exit(1);
}
console.log(`SEO ok: ${site} (título ${titulo.length} car., descrição ${desc.length} car.)`);
JS

tar -C "$raiz/apps/admin" --exclude=./node_modules --exclude=./.next --exclude='./.env*' \
    --exclude=./tsconfig.tsbuildinfo --exclude=./public -cf - . | tar -C "$stage" -xf -
mkdir -p "$stage/public"
cp -r dist/. "$stage/public/"
rm -rf dist
cp "$raiz/scripts/montar-front-linux.sh" "$stage/"
(cd "$stage" && tar -czf "$saida" $(ls -A))
echo "Pacote: $saida ($(du -h "$saida" | cut -f1))"
