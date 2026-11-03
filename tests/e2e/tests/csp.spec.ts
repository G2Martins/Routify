import { test, expect } from '@playwright/test';
import { API_URL, coletarCsp, comSessao, entrar, esperarApp, nota } from './helpers';

test('2. CSP: zero violações em / (carga + uma busca)', async ({ page }) => {
  const coleta = await coletarCsp(page);

  const resp = await page.goto('/');
  const headers = await resp!.headersArray();
  const politica = headers
    .filter((h) => /^content-security-policy(-report-only)?$/i.test(h.name) && /default-src/i.test(h.value))
    .map((h) => `${h.name}: ${h.value}`);
  nota('csp-header', politica.join(' || ') || '(nenhuma política com default-src)');
  // Sem política ativa, "zero violações" não prova nada.
  expect(politica, 'a página precisa vir com CSP (ou CSP-Report-Only) com default-src').not.toHaveLength(0);

  await esperarApp(page);
  if (comSessao) {
    // Com sessão: mapa (estilo, tiles, workers) e a busca pela interface.
    const destino = await entrar(page, { navegar: false });
    await expect(page.locator('canvas.maplibregl-canvas, .leaflet-container').first()).toBeVisible({ timeout: 20_000 });
    await destino.fill('park shopping');
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
  } else {
    // Sem sessão não há campo de busca (o app só mostra o login). A mesma chamada, de dentro da página,
    // exercita o connect-src e o CORS da API a partir da origem do front.
    const busca = await page.evaluate(async (api) => {
      try {
        const r = await fetch(`${api}/search/places?q=park%20shopping&limit=6`);
        return { status: r.status, itens: ((await r.json()) as unknown[]).length };
      } catch (e) {
        return { erro: String(e) };
      }
    }, API_URL);
    nota('busca-na-pagina', JSON.stringify(busca));
    expect(busca, 'busca feita de dentro da página (CORS + connect-src)').toMatchObject({ status: 200 });
  }
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});

  const { eventos, console: doConsole } = await coleta();
  nota('csp-violacoes', eventos.length ? eventos.join(' | ') : 'nenhuma');
  if (doConsole.length) nota('csp-console', doConsole.join(' | '));
  expect(eventos, 'securitypolicyviolation (diretiva <- origem bloqueada)').toEqual([]);
  expect(doConsole, 'mensagens de violação no console (inclui workers)').toEqual([]);
});
