// npm test (de apps/mobile): textos do detalhe de um ponto e a validação do arquivo de radares.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agruparPorNome, diaCurto, erroDoPonto, horaEDiaAgora, idadeLeitura, nomeDoPonto, razaoTxt } from '../src/lib/trafego.ts';
import { radaresNaRota, radaresValidos } from '../src/lib/radares.ts';

test('idade da leitura na maior unidade que faz sentido', () => {
  assert.equal(idadeLeitura(null), 'Sem leitura recente');
  assert.equal(idadeLeitura(12), 'Há 12 min');
  assert.equal(idadeLeitura(180), 'Há 3 h');
  assert.equal(idadeLeitura(4320), 'Há 3 dias');
});

test('razão com vírgula e nome de reserva', () => {
  assert.equal(razaoTxt(0.625), '0,63');
  assert.equal(nomeDoPonto({ nome: null, id: 7 }), 'Via monitorada 7');
});

test('hora e dia da semana em Brasília, com segunda = 0', () => {
  assert.deepEqual(horaEDiaAgora(new Date('2026-11-09T22:40:00-03:00')), { hora: 22, dia: 0 }); // já é terça em UTC
  assert.deepEqual(horaEDiaAgora(new Date('2026-11-08T01:00:00-03:00')), { hora: 1, dia: 6 });
});

test('dia do histórico sem passar pelo fuso do aparelho', () => {
  assert.equal(diaCurto('2026-11-08'), 'dom 08/11');
});

test('erros do detalhe', () => {
  assert.match(erroDoPonto(429), /Aguarde/);
  assert.match(erroDoPonto(404), /não existe/);
  assert.match(erroDoPonto(500), /agora/);
});

test('radares: descarta o que não é coordenada, limite inválido vira null, nome é cortado', () => {
  const longo = 'x'.repeat(200);
  const r = radaresValidos({
    radares: [
      { lat: -15.8, lon: -47.9, limite_kmh: 60, nome: null },
      { lat: 'a', lon: -47.9 },
      { lat: -15.8, lon: null },
      { lat: -15.7, lon: -47.8, limite_kmh: -1, nome: longo },
      null,
    ],
  });
  assert.deepEqual(r[0], { lat: -15.8, lon: -47.9, limite_kmh: 60, nome: null });
  assert.equal(r.length, 2);
  assert.equal(r[1].limite_kmh, null);
  assert.equal(r[1].nome.length, 80);
  assert.deepEqual(radaresValidos(null), []);
  assert.deepEqual(radaresValidos({ radares: 'x' }), []);
});

test('pontos com o mesmo nome viram um grupo, o pior primeiro', () => {
  const p = (id, nome, razao, nivel) => ({ id, nome, razao, nivel, lat: 0, lon: 0, leitura_ha_min: 5 });
  const g = agruparPorNome([p(1, 'Eixo', 0.7, 1), p(2, 'EPTG', 0.4, 2), p(3, 'Eixo', 0.6, 1), p(4, null, 0.8, 1)]);
  assert.deepEqual(g.map((x) => [x.nome, x.pontos.map((y) => y.id)]), [['EPTG', [2]], ['Eixo', [3, 1]], ['Via monitorada 4', [4]]]);
  assert.equal(g[1].razao.toFixed(2), '0.65');
});

test('radares na rota: só os da pista, na ordem do trajeto', () => {
  const rota = [[-15.8, -47.9], [-15.8, -47.89], [-15.79, -47.89]]; // ~1,07 km para leste, depois ~1,1 km para norte
  const radares = [
    { lat: -15.795, lon: -47.89005, limite_kmh: 60, nome: null }, // no 2º trecho, ~5 m
    { lat: -15.80005, lon: -47.895, limite_kmh: 80, nome: null }, // no 1º trecho, ~5 m
    { lat: -15.8004, lon: -47.897, limite_kmh: 50, nome: null }, // pista oposta, ~44 m: fora
    { lat: -15.7, lon: -47.8, limite_kmh: 40, nome: null }, // longe
  ];
  const achados = radaresNaRota(rota, radares);
  assert.deepEqual(achados.map((r) => r.limite_kmh), [80, 60]);
  assert.ok(Math.abs(achados[0].km - 0.535) < 0.02 && Math.abs(achados[1].km - 1.62) < 0.03);
  assert.deepEqual(radaresNaRota([[-15.8, -47.9]], radares), []);
});

