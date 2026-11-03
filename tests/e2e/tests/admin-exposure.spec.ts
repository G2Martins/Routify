import { test, expect } from '@playwright/test';
import { API_URL, BASE_URL, esperarApp, nota } from './helpers';

// Textos que só existem dentro do painel ADM (Sidebar.tsx).
const PAINEL = /Arquitetura viva|Qualidade dos dados|LIA × provedores|Uso da plataforma|Seções do painel/;
const ROTAS = ['/admin', '/admin/usuarios', '/admin/operacao', '/admin/auditoria'];

test.describe('4. Exposição do painel ADM', () => {
  for (const rota of ROTAS) {
    test(`GET ${rota} sem sessão não entrega o painel`, async ({ request }) => {
      // Sem seguir redirecionamento: registra a resposta crua do servidor.
      const r = await request.get(`${BASE_URL}${rota}`, { maxRedirects: 0 });
      const status = r.status();
      const destino = r.headers()['location'];
      nota(`admin ${rota}`, `${status}${destino ? ` -> ${destino}` : ''} (${r.headers()['content-type'] ?? 'sem content-type'})`);

      if (status === 200) {
        // 200 só passa se não for o painel (ex.: a tela de login do app).
        expect(PAINEL.test(await r.text()), '200 com conteúdo do painel sem sessão').toBe(false);
      } else {
        expect([301, 302, 303, 307, 308, 401, 403, 404], `status inesperado em ${rota}`).toContain(status);
      }
    });
  }

  test('no navegador, /admin sem cookie termina fora do painel', async ({ page }) => {
    await page.goto('/admin');
    nota('admin-final', page.url());
    expect(new URL(page.url()).pathname.startsWith('/admin'), 'URL final ainda em /admin').toBe(false);
    await esperarApp(page);
    await expect(page.getByText(PAINEL)).toHaveCount(0);
  });

  test('API: GET /admin/tomtom sem token é recusado (401/403)', async ({ request }) => {
    const r = await request.get(`${API_URL}/admin/tomtom`);
    nota('api-admin', `${r.status()}`);
    expect([401, 403]).toContain(r.status());
  });
});
