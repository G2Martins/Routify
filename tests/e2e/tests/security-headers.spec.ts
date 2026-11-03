import { test, expect } from '@playwright/test';
import { API_URL, nota } from './helpers';

type Headers = Record<string, string>;

// expect.soft: um header faltando não esconde os outros; o teste falha no fim listando tudo.
function conferir(h: Headers) {
  const hsts = h['strict-transport-security'];
  expect.soft(hsts, 'Strict-Transport-Security').toBeTruthy();
  expect.soft(Number(/max-age=(\d+)/i.exec(hsts ?? '')?.[1] ?? 0), 'HSTS max-age >= 1 ano').toBeGreaterThanOrEqual(31_536_000);
  expect.soft(h['x-content-type-options']?.toLowerCase(), 'X-Content-Type-Options').toBe('nosniff');
  expect.soft(h['referrer-policy'], 'Referrer-Policy').toBeTruthy();

  // frame-ancestors só vale em CSP aplicada: em Report-Only o navegador ignora a diretiva.
  const aplicada = h['content-security-policy'] ?? '';
  expect.soft(h['x-frame-options'] || /frame-ancestors/i.test(aplicada), 'X-Frame-Options ou frame-ancestors (CSP aplicada)').toBeTruthy();

  // A borda da Hostinger acrescenta `content-security-policy: upgrade-insecure-requests`; isso sozinho não conta.
  const csp = [h['content-security-policy'], h['content-security-policy-report-only']].map((v) => (v ?? '').replace(/upgrade-insecure-requests;?/i, '').trim());
  expect.soft(csp.some(Boolean), 'Content-Security-Policy(-Report-Only) além do upgrade-insecure-requests').toBe(true);
}

function imprimir(alvo: string, h: Headers) {
  const nomes = [
    'strict-transport-security',
    'x-content-type-options',
    'referrer-policy',
    'x-frame-options',
    'content-security-policy',
    'content-security-policy-report-only',
    'permissions-policy',
    'cross-origin-opener-policy',
  ];
  nota(`headers ${alvo}`, nomes.map((n) => `${n}: ${h[n] ?? '(ausente)'}`).join('\n'));
}

test.describe('3. Cabeçalhos de segurança', () => {
  test('front /', async ({ page }) => {
    const resp = await page.goto('/');
    const h = await resp!.allHeaders();
    imprimir('/', h);
    conferir(h);
  });

  test('API /health', async ({ request }) => {
    const resp = await request.get(`${API_URL}/health`);
    expect(resp.status()).toBe(200);
    const h = resp.headers();
    imprimir('API /health', h);
    conferir(h);
  });
});
