import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARQUIVO, nomesUsados } from '../scripts/icones.mjs';

test('todo ícone escrito no app tem SVG em icones.json (a web não busca ícone na rede)', () => {
  const colecoes = JSON.parse(readFileSync(ARQUIVO, 'utf8'));
  const tem = new Set(colecoes.flatMap((c) => [...Object.keys(c.icons), ...Object.keys(c.aliases ?? {})].map((n) => `${c.prefix}:${n}`)));
  assert.deepEqual(nomesUsados().filter((n) => !tem.has(n)), [], 'falta ícone: rode node scripts/icones.mjs');
});
