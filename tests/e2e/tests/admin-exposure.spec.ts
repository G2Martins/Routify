import { test, expect } from '@playwright/test';
import { API_URL, BASE_URL, nota } from './helpers';

// Textos que só existem dentro do painel ADM (Sidebar.tsx).
const PAINEL = /Arquitetura viva|Qualidade dos dados|LIA × provedores|Uso da plataforma|Seções do painel/;
const ROTAS = ['/admin', '/admin/usuarios', '/admin/operacao', '/admin/auditoria', '/admin/status/externo'];
// Desde 2026-11-03 (auditoria de segurança): sem sessão de admin, /admin responde igual a um endereço que não existe.
const INEXISTENTE = '/esta-pagina-nao-existe-e2e';

test.describe('4. Exposição do painel ADM', () => {
  for (const rota of ROTAS) {
    test(`GET ${rota} sem sessão responde como endereço inexistente (404)`, async ({ request }) => {
      // Sem seguir redirecionamento: um 307 para o login já denunciaria que o painel existe.
      const r = await request.get(`${BASE_URL}${rota}`, { maxRedirects: 0 });
      const base = await request.get(`${BASE_URL}${INEXISTENTE}`, { maxRedirects: 0 });
      nota(`admin ${rota}`, `${r.status()} (inexistente: ${base.status()})`);
      expect(r.status(), `status de ${rota}`).toBe(404);
      expect(r.status()).toBe(base.status());
      expect(PAINEL.test(await r.text()), '404 com conteúdo do painel').toBe(false);
    });
  }

  test('no navegador, /admin sem cookie não mostra nada do painel', async ({ page }) => {
    const r = await page.goto('/admin');
    nota('admin-final', `${r?.status()} ${page.url()}`);
    expect(r?.status()).toBe(404);
    await expect(page.getByText(PAINEL)).toHaveCount(0);
  });

  test('API: GET /admin/tomtom sem token é recusado (401/403)', async ({ request }) => {
    const r = await request.get(`${API_URL}/admin/tomtom`);
    nota('api-admin', `${r.status()}`);
    expect([401, 403]).toContain(r.status());
  });
});
