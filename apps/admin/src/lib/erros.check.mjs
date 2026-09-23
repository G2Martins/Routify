// Checagem do mapa de erros das ações do ADM. Rodar: node src/lib/erros.check.mjs (Node >= 22.18).
import assert from 'node:assert/strict';
import { faltaMigracao, mensagemErro } from './erros.ts';

assert.equal(mensagemErro({ code: '42501', message: 'acesso negado' }), 'Acesso negado.');
assert.equal(mensagemErro({ code: 'P0001', message: 'ação repetida — aguarde alguns segundos' }), 'Ação repetida — aguarde alguns segundos.');
assert.equal(mensagemErro({ code: 'P0002', message: 'usuário não encontrado' }), 'Usuário não encontrado.');
assert.equal(mensagemErro({ code: '22023', message: 'orçamento deve ser inteiro entre 1 e 600' }), 'Orçamento deve ser inteiro entre 1 e 600.');
assert.ok(faltaMigracao({ code: 'PGRST202' }) && faltaMigracao({ code: '42P01' }) && !faltaMigracao({ code: '42501' }));
assert.match(mensagemErro({ code: 'PGRST202' }), /20260923020000_admin_actions\.sql/);
assert.equal(mensagemErro({ status: 429, message: 'Muitas requisições.', retryAfter: '12' }), 'Muitas requisições. Tente de novo em 12 s.');
assert.match(mensagemErro({ status: 429, message: 'Muitas requisições.', retryAfter: null }), /1 minuto/);
assert.equal(mensagemErro({ status: 0 }), 'API fora do ar ou NEXT_PUBLIC_API_URL incorreta.');
console.log('erros.check: ok');
