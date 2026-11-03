import { test, expect } from '@playwright/test';
import { comSessao, entrar, esperarApp, nota } from './helpers';

test.describe('1. App shell', () => {
  test('/ responde 200, tem título e não lança erro de página', async ({ page }) => {
    const erros: string[] = [];
    const ruido: string[] = []; // só informativo: ajuda a achar a causa quando algo quebra
    page.on('pageerror', (e) => erros.push(e.message));
    page.on('console', (m) => m.type() === 'error' && ruido.push(`console.error: ${m.text().slice(0, 200)}`));
    page.on('response', (r) => r.status() >= 400 && ruido.push(`HTTP ${r.status()}: ${r.url().slice(0, 120)}`));

    const resp = await page.goto('/');
    expect(resp?.status()).toBe(200);
    await expect(page).toHaveTitle(/\S/);
    nota('titulo', await page.title());

    // Sem sessão o RootNavigator mostra o login; com sessão, o mapa.
    await esperarApp(page);
    if (ruido.length) nota('ruido', ruido.join(' | '));
    expect(erros, 'erros não capturados na página (pageerror)').toEqual([]);
  });

  test('o título continua o do site depois que o app monta (não vira "Login"/"Mapa")', async ({ page }) => {
    // Com o documentTitle do React Navigation ligado, o <title> troca pelo nome da tela assim que o app monta.
    // Registra todo título que a página chegar a ter, para não depender do instante da leitura.
    await page.addInitScript(() => {
      const w = window as unknown as { __titulos: Set<string> };
      w.__titulos = new Set();
      setInterval(() => document.title && w.__titulos.add(document.title), 50);
    });
    await page.goto('/');
    await esperarApp(page);
    await page.waitForTimeout(1000); // deixa o efeito do NavigationContainer rodar
    const titulos = await page.evaluate(() => [...(window as unknown as { __titulos: Set<string> }).__titulos]);
    nota('titulos', JSON.stringify(titulos));
    expect(
      titulos.filter((t) => !/routify/i.test(t)),
      'títulos que não mencionam Routify',
    ).toEqual([]);
  });

  test('o mapa renderiza (canvas do MapLibre ou container do Leaflet) em até 20 s', async ({ page }) => {
    test.skip(!comSessao, 'O mapa fica atrás do login (RootNavigator). Defina E2E_EMAIL e E2E_PASSWORD.');
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));

    await entrar(page);
    const mapa = page.locator('canvas.maplibregl-canvas, .leaflet-container').first();
    await expect(mapa).toBeVisible({ timeout: 20_000 });
    nota('mapa', await mapa.evaluate((e) => `${e.tagName}.${e.className}`));
    expect(erros, 'erros não capturados na página (pageerror)').toEqual([]);
  });
});
