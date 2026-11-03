import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, comSessao, entrar, nota } from './helpers';

type Sugestao = { label: string; sublabel: string; categoria?: string | null; source: string };

async function buscarNaApi(request: APIRequestContext, q: string) {
  // Mesma chamada que o autocomplete faz (AddressAutocomplete.tsx), sem viés de posição.
  const r = await request.get(`${API_URL}/search/places?q=${encodeURIComponent(q)}&limit=6`);
  expect(r.status()).toBe(200);
  const itens = (await r.json()) as Sugestao[];
  nota(`api-busca "${q}"`, itens.map((i) => `${i.label} | ${i.sublabel} | ${i.categoria ?? '-'} | ${i.source}`).join('\n'));
  return itens;
}

test.describe('5. Busca de lugares', () => {
  test('API: "park shopping" -> 1º resultado é o Park Shopping do Guará', async ({ request }) => {
    const [primeiro] = await buscarNaApi(request, 'park shopping');
    expect(primeiro?.label).toMatch(/park shopping/i);
    expect(primeiro?.sublabel).toContain('Guará');
  });

  test('API: "rodoviaria" -> alguma sugestão com "Rodoviária"', async ({ request }) => {
    const itens = await buscarNaApi(request, 'rodoviaria');
    expect(itens.some((i) => /rodoviária/i.test(i.label))).toBe(true);
  });

  test.describe('pela interface (precisa de sessão)', () => {
    test.skip(!comSessao, 'A busca fica atrás do login. Defina E2E_EMAIL e E2E_PASSWORD.');

    // Destinos recentes do usuário vêm antes dos resultados da API (combinar() no AddressAutocomplete):
    // o teste olha só as sugestões que não são "Destino recente".
    const sugestoes = (page: Page) =>
      page.getByRole('option').filter({ hasNotText: 'Destino recente' });

    test('"park shopping" -> 1ª sugestão é o Park Shopping do Guará', async ({ page }) => {
      const destino = await entrar(page);
      await destino.fill('park shopping');
      const primeira = sugestoes(page).first();
      await expect(primeira).toContainText('Park Shopping', { timeout: 15_000 });
      await expect(primeira).toContainText('Guará');
    });

    test('"rodoviaria" -> sugestão com "Rodoviária"', async ({ page }) => {
      const destino = await entrar(page);
      await destino.fill('rodoviaria');
      await expect(sugestoes(page).filter({ hasText: 'Rodoviária' }).first()).toBeVisible({ timeout: 15_000 });
    });
  });
});
