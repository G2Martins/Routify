// npm test (de apps/mobile): node --experimental-strip-types --test, Node >= 22.6, sem dependências
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escolhaPadrao, ganhoMin, hhmm, horarioImporta, janelaDe, mensagemDeErro, periodoValido, proximosDias, resumoMelhor } from '../src/lib/planejar.ts';

const h = (hora, min) => ({ saida: `2026-11-03T${hora}:00-03:00`, tempo_seg: Math.round(min * 60) });
const resposta = (horarios, melhor) => ({
  horarios, melhor, distancia_km: 23.8, tempo_livre_seg: 1340, lia_cobertura_pct: 94, mesmo_trajeto: true, modelo_utilizado: 'lia_2.3',
});

test('hora de Brasília lida direto do ISO da API, sem o fuso do aparelho', () => {
  assert.equal(hhmm('2026-11-03T07:30:00-03:00'), '07:30');
  assert.equal(hhmm('2026-11-03T23:05:00.250000-03:00'), '23:05');
});

test('frase compara a saída mais rápida com a mais lenta', () => {
  const r = resposta([h('07:30', 18), h('08:00', 24), h('08:30', 30.2), h('09:00', 22)], 0);
  assert.equal(resumoMelhor(r), '12 min a menos que às 08:30.');
  assert.equal(ganhoMin(r), 12);
  assert.equal(horarioImporta(r), true);
});

test('menos de 2 min de diferença: o horário não importa, e a frase diz em uma linha', () => {
  const r = resposta([h('22:15', 22.4), h('22:45', 23), h('23:15', 23.6)], 0);
  assert.equal(horarioImporta(r), false);
  assert.equal(resumoMelhor(r), 'Tanto faz o horário: ~22 min saindo entre 22:15 e 23:15.');
});

const em = (s) => new Date(`${s}-03:00`);

test('a janela do período começa na próxima meia hora de hoje e nunca no passado', () => {
  assert.deepEqual(janelaDe('2026-11-09', 'manha', em('2026-11-09T10:10:00')), { inicio: '2026-11-09T10:30:00-03:00', janelas: 3 });
  assert.deepEqual(janelaDe('2026-11-09', 'manha', em('2026-11-09T02:00:00')), { inicio: '2026-11-09T06:00:00-03:00', janelas: 12 });
  assert.equal(janelaDe('2026-11-09', 'manha', em('2026-11-09T11:40:00')), null); // sobra menos de 2 saídas
  assert.equal(janelaDe('2026-11-09', 'manha', em('2026-11-09T15:00:00')), null);
  assert.deepEqual(janelaDe('2026-11-10', 'noite', em('2026-11-09T15:00:00')), { inicio: '2026-11-10T18:00:00-03:00', janelas: 10 });
});

test('o padrão é uma janela útil: de madrugada espera a manhã, tarde da noite vai para o dia seguinte', () => {
  assert.deepEqual(escolhaPadrao(em('2026-11-09T02:00:00')), { dia: '2026-11-09', periodo: 'manha' });
  assert.deepEqual(escolhaPadrao(em('2026-11-09T11:40:00')), { dia: '2026-11-09', periodo: 'tarde' });
  assert.deepEqual(escolhaPadrao(em('2026-11-09T17:40:00')), { dia: '2026-11-09', periodo: 'noite' });
  assert.deepEqual(escolhaPadrao(em('2026-11-09T22:40:00')), { dia: '2026-11-10', periodo: 'manha' });
});

test('os dias seguem Brasília mesmo quando em UTC já é amanhã', () => {
  const dias = proximosDias(em('2026-11-09T22:40:00')); // 01:40 UTC do dia 10
  assert.equal(dias.length, 7);
  assert.deepEqual(dias.slice(0, 3), [
    { chave: '2026-11-09', rotulo: 'Hoje' },
    { chave: '2026-11-10', rotulo: 'Amanhã' },
    { chave: '2026-11-11', rotulo: 'qua 11' },
  ]);
});

test('trocar de dia mantém o período se ele ainda valer', () => {
  const agora = em('2026-11-09T15:00:00');
  assert.equal(periodoValido('2026-11-10', 'manha', agora), 'manha');
  assert.equal(periodoValido('2026-11-09', 'manha', agora), 'tarde');
});

test('erros: 429, 422 com o texto da API, 422 de validação e o resto', () => {
  assert.match(mensagemDeErro(429, { detail: 'Muitas requisições.' }), /Aguarde um minuto/);
  assert.equal(mensagemDeErro(422, { detail: 'Sem rota disponível entre origem e destino.' }), 'Sem rota disponível entre origem e destino.');
  assert.equal(mensagemDeErro(422, { detail: [{ loc: ['body', 'origem', 'lat'] }] }), 'Escolha origem e destino dentro do Distrito Federal.');
  assert.match(mensagemDeErro(500, null), /Tente de novo/);
});
