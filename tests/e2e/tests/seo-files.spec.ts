import { test, expect } from '@playwright/test';
import { BASE_URL, nota } from './helpers';

// No ar desde 2026-11-03: 200, content-type e corpo certos (um 200 com HTML seria o fallback do app).
const ARQUIVOS = [
  { caminho: '/robots.txt', tipo: /^text\/plain/i, corpo: /user-agent/i },
  { caminho: '/sitemap.xml', tipo: /^(application|text)\/xml/i, corpo: /<(urlset|sitemapindex)/i },
  { caminho: '/llms.txt', tipo: /^text\/(plain|markdown)/i, corpo: /\S/ },
];

test.describe('8. Arquivos de SEO', () => {
  for (const a of ARQUIVOS) {
    test(`GET ${a.caminho}`, async ({ request }) => {
      const r = await request.get(`${BASE_URL}${a.caminho}`);
      const tipo = r.headers()['content-type'] ?? '';
      nota(`seo ${a.caminho}`, `${r.status()} ${tipo}`);
      expect(r.status()).toBe(200);
      expect(tipo).toMatch(a.tipo);
      expect(await r.text()).toMatch(a.corpo);
    });
  }
});
