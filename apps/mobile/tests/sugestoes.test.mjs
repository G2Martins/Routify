// npm test (de apps/mobile): node --experimental-strip-types --test, Node >= 22.6, sem dependências
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combinar } from '../src/lib/sugestoes.ts';

const api = (label, sublabel, lat, lon) => ({ label, sublabel, lat, lon, source: 'tomtom' });
const recente = (label, lat, lon) => ({ label, sublabel: 'Destino recente · há 40 dias', lat, lon, source: 'recente' });

// Resposta real da API para "park shopping" (2026-11-02) e o destino errado salvo no histórico em 09/2026.
const GUARA = api('Park Shopping', 'Guará', -15.83377, -47.95606);
const SAO_SEB = api('Park Shopping', 'São Sebastião · Quadra 307 Conjunto 5 14', -15.90079, -47.79023);
const TAG = api('Park Shopping', 'Taguatinga · Rua 36 Norte', -15.83299, -48.03549);

test('recente homônimo e longe do 1º da API vai depois dele, com o bairro à vista', () => {
  const r = combinar('Park Shopping', [recente('Park Shopping', -15.901, -47.790)], [GUARA, SAO_SEB, TAG]);
  assert.equal(r[0], GUARA);
  assert.equal(r[1].source, 'recente');
  assert.match(r[1].sublabel, /^São Sebastião/);
  assert.equal(r.length, 3); // o São Sebastião da API virou o recente (sem duplicar)
});

test('recente que é o próprio 1º lugar continua no topo e herda o bairro', () => {
  const r = combinar('park', [recente('Park Shopping', -15.8338, -47.9561)], [GUARA, SAO_SEB]);
  assert.equal(r[0].source, 'recente');
  assert.match(r[0].sublabel, /^Guará · Destino recente/);
  assert.deepEqual(r.slice(1), [SAO_SEB]);
});

test('recente sem homônimo segue antes da API (atalho do usuário)', () => {
  const casa = recente('Casa da Vó', -15.8, -48.1);
  const r = combinar('casa', [casa], [api('Casa Park', 'SIA', -15.82, -47.95)]);
  assert.equal(r[0], casa);
});

test('sem recentes ou sem termo devolve a lista da API como veio', () => {
  const itens = [GUARA, SAO_SEB];
  assert.equal(combinar('park', null, itens), itens);
  assert.equal(combinar('  ', [recente('Park Shopping', -15.9, -47.79)], itens), itens);
});

test('recente que não casa com o digitado fica de fora; limite respeitado', () => {
  const r = combinar('rodo', [recente('Park Shopping', -15.9, -47.79)], [GUARA, SAO_SEB, TAG], 2);
  assert.deepEqual(r, [GUARA, SAO_SEB]);
});
