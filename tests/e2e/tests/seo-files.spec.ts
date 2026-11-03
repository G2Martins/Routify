import { test, expect } from '@playwright/test';
import { BASE_URL, nota } from './helpers';

// robots.txt, sitemap.xml e llms.txt estão sendo adicionados na noite de 2026-11-03. Enquanto derem 404 o teste é
// marcado como falha esperada (test.fail, decidido em tempo de execução): aparece na lista mas não fica vermelho, e o
// status vai nas anotações. Publicado o arquivo, o teste roda normal e exige 200, content-type e corpo certos.
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
      nota(`seo ${a.caminho}`, `${r.status()} ${tipo}${r.status() === 404 ? ' (falha esperada: ainda não publicado)' : ''}`);

      test.fail(r.status() === 404, `${a.caminho} ainda não está publicado (404)`);
      expect(r.status()).toBe(200);
      // Um 200 com HTML seria o fallback do app disfarçado de arquivo.
      expect(tipo).toMatch(a.tipo);
      expect(await r.text()).toMatch(a.corpo);
    });
  }
});
