import { expect, test, type Page } from '@playwright/test';
import { API_URL, comSessao, entrar, nota } from './helpers';

// Telas em 4 tamanhos, com a API simulada (nada de TomTom, nada de limite por IP) e sem gravar histórico. Confere o que
// quebra de novo sem ninguém ver: nada fora da largura da tela, alvo de toque ≥ 44 px e nenhum travessão na interface.

const TAMANHOS = [
  { nome: '360x740', width: 360, height: 740, toque: true },
  { nome: '390x844', width: 390, height: 844, toque: true },
  { nome: '768x1024', width: 768, height: 1024, toque: true },
  { nome: '1366x768', width: 1366, height: 768, toque: false },
];

const POLYLINE = Array.from({ length: 40 }, (_, i) => [-15.7939 - i * 0.001, -47.8828 - i * 0.0017]);
const PONTOS = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  lat: -15.79 - i * 0.002,
  lon: -47.88 - i * 0.002,
  nome: i % 2 ? `Via de teste ${i}` : null,
  razao: i < 6 ? 0.4 : 0.95,
  nivel: i < 6 ? 2 : 0,
  leitura_ha_min: 20,
}));

function horarios(corpo: { inicio: string; janelas: number }) {
  const lista = Array.from({ length: corpo.janelas }, (_, i) => ({
    saida: new Date(new Date(corpo.inicio).getTime() + i * 1_800_000 - 3 * 3_600_000).toISOString().slice(0, 19) + '-03:00',
    tempo_seg: 600 + (i === 2 ? 900 : i * 30),
    trafego: POLYLINE.slice(0, -1).map((_, k) => (i === 2 && k > 10 && k < 20 ? 3 : 0)),
  }));
  return { horarios: lista, melhor: 0, distancia_km: 5.1, tempo_livre_seg: 580, lia_cobertura_pct: 68, mesmo_trajeto: true, modelo_utilizado: 'lia_2.3', polyline: POLYLINE };
}

const detalhe = (id: number) => ({
  id,
  nome: `Via de teste ${id}`,
  lat: -15.79,
  lon: -47.88,
  vel_livre_kmh: 60,
  agora: { razao: 0.4, nivel: 2, leitura_ha_min: 20 },
  historico: {
    n_leituras: 1000,
    primeira_leitura: '2026-03-07T12:00:00-03:00',
    ultima_leitura: '2026-11-08T12:00:00-03:00',
    por_hora: Array.from({ length: 24 }, (_, hora) => ({ hora, razao: hora === 3 ? null : 0.8, n: hora === 3 ? 0 : 40 })),
    por_dia_semana: Array.from({ length: 7 }, (_, dia) => ({ dia, razao: 0.7, n: 140 })),
    ultimos_dias: [{ dia: '2026-11-08', razao: 0.7, vel_kmh: 42, n: 12 }],
    ultimas: [{ em: '2026-11-08T12:00:00-03:00', vel_kmh: 40, vel_livre_kmh: 60, razao: 0.67, tempo_s: 30 }],
  },
});

async function simularApi(page: Page) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route(`${API_URL}/**`, async (rota) => {
    const req = rota.request();
    if (req.method() === 'OPTIONS') return rota.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const json = (corpo: unknown, status = 200) => rota.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (u.pathname === '/route/horarios') return json(horarios(req.postDataJSON()));
    if (u.pathname === '/trafego/agora') return json({ atualizado_em: '2026-11-09T12:00:00-03:00', pontos: PONTOS, resumo: { livre: 24, moderado: 0, lento: 6, parado: 0 } });
    if (u.pathname.startsWith('/trafego/ponto/')) return json(detalhe(Number(u.pathname.split('/').pop())));
    if (u.pathname === '/search/places') return json([{ label: `Lugar ${u.searchParams.get('q')}`, sublabel: 'Plano Piloto', lat: -15.8, lon: -47.9, source: 'tomtom' }]);
    if (u.pathname === '/health') return json({ modelo_ativo: 'lia_2.3', status: 'ok' });
    if (u.pathname === '/metrics') return json({ modelo_ativo: 'lia_2.3', cv_rmse_seg: 35.5, cv_mae_seg: 13.3, cv_rmse_seg_baseline: 57.2, n_pontos_monitorados: 630, total_amostras_treino: 1510000, periodo_dados: '' });
    return json([]);
  });
  await page.route('**/radares_df.json', (rota) =>
    rota.fulfill({ contentType: 'application/json', body: JSON.stringify({ fonte: 'teste', gerado_em: '2026-11-09', radares: [{ lat: -15.8, lon: -47.9, limite_kmh: 60, nome: null }] }) }),
  );
  // Nunca grava histórico de verdade: a suíte roda contra a produção.
  await page.route(/rest\/v1\/route_history/, (r) => (r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 201, body: '' })));
}

/** O gráfico tem colunas estreitas de propósito: o alvo é ele inteiro, com setas de 44 px ao lado. */
async function auditar(page: Page, tela: string, toque: boolean) {
  const r = await page.evaluate(() => {
    const W = innerWidth;
    const visivel = (el: Element) => {
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) return false;
      for (let n: Element | null = el; n; n = n.parentElement) if (getComputedStyle(n).display === 'none') return false;
      return true;
    };
    const emRolagemX = (el: Element) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    // O brilho do esqueleto desliza por fora da própria caixa, recortado por ela.
    const emLoop = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) if (getComputedStyle(n).animationIterationCount === 'infinite') return true;
      return false;
    };
    const nome = (el: Element) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
    const fora: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.maplibregl-map,.leaflet-container,svg') || !visivel(el) || emRolagemX(el) || emLoop(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.right > W + 1 || b.left < -1) fora.push(nome(el));
    }
    const pequenos: string[] = [];
    for (const el of document.querySelectorAll('a,button,input,[role=button],[role=tab],[role=link],[role=checkbox],[role=menuitem],[role=option]')) {
      if (el.closest('.maplibregl-map,.leaflet-container') || !visivel(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 43.5 || b.height < 43.5) pequenos.push(`${nome(el)} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return { fora: [...new Set(fora)], pequenos: [...new Set(pequenos)], travessao: document.title.includes('—') || document.body.innerText.includes('—') };
  });
  nota(tela, JSON.stringify(r));
  expect(r.fora, `${tela}: fora da largura da tela`).toEqual([]);
  expect(r.travessao, `${tela}: travessão na interface`).toBe(false);
  if (toque) expect(r.pequenos, `${tela}: alvo de toque menor que 44 px`).toEqual([]);
}

for (const t of TAMANHOS) {
  test.describe(`Responsivo ${t.nome}`, () => {
    test.use({ viewport: { width: t.width, height: t.height }, hasTouch: t.toque, isMobile: t.toque && t.width < 800 });

    test('login e cadastro', async ({ page }) => {
      await simularApi(page);
      await page.goto('/');
      await expect(page.getByLabel('E-mail', { exact: true })).toBeVisible({ timeout: 20_000 });
      await auditar(page, 'login', t.toque);
      await page.getByText('Criar conta', { exact: true }).click();
      await expect(page.getByLabel('Nome', { exact: true })).toBeVisible();
      await auditar(page, 'cadastro', t.toque);
    });

    test('telas com sessão', async ({ page }) => {
      test.skip(!comSessao, 'Fica atrás do login. Defina E2E_EMAIL e E2E_PASSWORD.');
      await simularApi(page);
      await entrar(page);
      const aba = (nome: string) => (t.width >= 900 ? page.locator(`[aria-label="${nome}"]`).first() : page.getByRole('tab', { name: nome, exact: true }));
      await auditar(page, 'mapa', t.toque);
      for (const [nome, marca] of [
        ['Planejar', 'Planejar saída'],
        ['Trânsito', 'Trânsito agora'],
        ['Painel', 'Sua economia'],
        ['Histórico', 'Histórico'],
        ['Perfil', 'Conta'],
      ]) {
        await aba(nome).click();
        await expect(page.getByText(marca, { exact: true }).last()).toBeVisible();
        await auditar(page, nome, t.toque);
      }
      for (const [item, titulo] of [
        ['Editar perfil', 'Editar perfil'],
        ['Privacidade', 'Privacidade'],
        ['Segurança', 'Segurança'],
      ]) {
        await page.getByRole('button', { name: item, exact: true }).click();
        await expect(page.getByText(titulo, { exact: true }).last()).toBeVisible();
        await auditar(page, item, t.toque);
        await page.getByRole('button', { name: 'Voltar' }).last().click();
      }
    });
  });
}

test.describe('Fluxos', () => {
  test.skip(!comSessao, 'Ficam atrás do login. Defina E2E_EMAIL e E2E_PASSWORD.');
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Planejar: escolher a saída troca o destaque, com mapa e sem madrugada', async ({ page }) => {
    await simularApi(page);
    await entrar(page);
    await page.getByRole('tab', { name: 'Planejar', exact: true }).click();
    await expect(page.getByText('Planejar saída', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'De onde você sai?' }).last().fill('rodo');
    await page.getByRole('option').first().click();
    await expect(page.getByRole('option')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Para onde você vai?' }).last().fill('park');
    await page.getByRole('option').first().click();
    const grafico = page.getByTestId('grafico-colunas');
    await expect(grafico).toBeVisible();
    await expect(page.locator('canvas.maplibregl-canvas, .leaflet-container').last()).toBeVisible();
    const marcada = page.locator('[role=radio][aria-checked=true]');
    await expect(marcada).toHaveCount(1);
    const antes = await marcada.getAttribute('aria-label');
    await page.getByRole('button', { name: 'Próxima saída' }).click();
    await expect(marcada).not.toHaveAttribute('aria-label', antes!);
    const hora = Number((await marcada.getAttribute('aria-label'))!.match(/às (\d\d):/)![1]);
    expect(hora, 'a janela padrão não pode cair na madrugada').toBeGreaterThanOrEqual(6);
    await auditar(page, 'Planejar com resultado', true);
  });

  test('Trânsito: linha da lista abre o detalhe, e Esc fecha', async ({ page }) => {
    await simularApi(page);
    await entrar(page);
    await page.getByRole('tab', { name: 'Trânsito', exact: true }).click();
    await page.getByRole('button', { name: /Ver detalhes/ }).first().click();
    await expect(page.getByText('Razão por hora do dia', { exact: true })).toBeVisible();
    await auditar(page, 'Detalhe do ponto', true);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Razão por hora do dia', { exact: true })).toHaveCount(0);
  });

  test('Radares: desligar é lembrado depois de recarregar', async ({ page }) => {
    await simularApi(page);
    await entrar(page);
    await page.getByRole('button', { name: 'Ocultar radares' }).first().click();
    await expect(page.getByRole('button', { name: 'Mostrar radares' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mostrar radares' }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Mostrar radares' }).first().click(); // deixa como estava
    await expect(page.getByRole('button', { name: 'Ocultar radares' }).first()).toBeVisible();
  });
});
