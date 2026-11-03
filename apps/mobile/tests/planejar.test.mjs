// npm test (de apps/mobile): node --experimental-strip-types --test, Node >= 22.6, sem dependências
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ganhoMin, hhmm, mensagemDeErro, resumoMelhor } from '../src/lib/planejar.ts';

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
  assert.equal(resumoMelhor(r), 'Saindo às 07:30 você gasta ~12 min a menos que às 08:30.');
  assert.equal(ganhoMin(r), 12);
});

test('menos de 1 min de diferença: o horário quase não muda (e nada fica em destaque)', () => {
  const r = resposta([h('22:15', 22.4), h('22:45', 22.5), h('23:15', 22.6)], 0);
  assert.equal(resumoMelhor(r), 'O horário quase não muda o tempo nesta janela: ~22 min em qualquer saída.');
  assert.equal(ganhoMin(r), 0);
});

test('erros: 429, 422 com o texto da API, 422 de validação e o resto', () => {
  assert.match(mensagemDeErro(429, { detail: 'Muitas requisições.' }), /Aguarde um minuto/);
  assert.equal(mensagemDeErro(422, { detail: 'Sem rota disponível entre origem e destino.' }), 'Sem rota disponível entre origem e destino.');
  assert.equal(mensagemDeErro(422, { detail: [{ loc: ['body', 'origem', 'lat'] }] }), 'Escolha origem e destino dentro do Distrito Federal.');
  assert.match(mensagemDeErro(500, null), /Tente de novo/);
});
