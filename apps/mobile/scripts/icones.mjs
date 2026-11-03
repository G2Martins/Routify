/**
 * Ícones do app web sem rede (auditoria de 2026-11-03, M4). O @iconify/react no modo online buscava o SVG em
 * api.iconify.design e o punha no innerHTML: quem controlasse a resposta rodava script no app. Agora o
 * @iconify/react/offline só desenha o que está em src/constants/icones.json, gerado aqui com os nomes
 * "set:ícone" escritos em App.tsx e src/.
 *
 *   node scripts/icones.mjs        # depois de usar um ícone novo (tests/icones.test.mjs acusa o que falta)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ARQUIVO = join(RAIZ, 'src', 'constants', 'icones.json');
const NOME = /['"`]((?:ion|mdi|material-symbols):[a-z0-9-]+)['"`]/g;

export function nomesUsados() {
  const fontes = readdirSync(join(RAIZ, 'src'), { recursive: true })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(RAIZ, 'src', f));
  const nomes = new Set();
  for (const f of [join(RAIZ, 'App.tsx'), ...fontes]) {
    for (const m of readFileSync(f, 'utf8').matchAll(NOME)) nomes.add(m[1]);
  }
  return [...nomes].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nomes = nomesUsados();
  const colecoes = [];
  for (const [prefixo, doSet] of Object.entries(Object.groupBy(nomes, (n) => n.split(':')[0]))) {
    const r = await fetch(`https://api.iconify.design/${prefixo}.json?icons=${doSet.map((n) => n.split(':')[1]).join(',')}`);
    if (!r.ok) throw new Error(`${prefixo}: HTTP ${r.status}`);
    const json = await r.json();
    if (json.not_found?.length) throw new Error(`${prefixo}: não existem ${json.not_found.join(', ')}`);
    colecoes.push(json);
  }
  writeFileSync(ARQUIVO, JSON.stringify(colecoes) + '\n');
  console.log(`${nomes.length} ícones -> ${ARQUIVO}`);
}
