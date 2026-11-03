import { expect, test, type Page } from '@playwright/test';

// Os domínios de produção NÃO entram no repositório (público): vêm só do ambiente.
function exigir(nome: string): string {
  const v = process.env[nome]?.trim();
  if (!v) {
    throw new Error(
      `Variável de ambiente ${nome} ausente. Rode: BASE_URL=https://<front> API_URL=https://<api> npx playwright test (ver tests/e2e/README.md).`,
    );
  }
  return v.replace(/\/+$/, '');
}

export const BASE_URL = exigir('BASE_URL');
export const API_URL = exigir('API_URL');

// Opcional: conta de teste dedicada (sem 2FA, sem papel admin). Sem ela, o que fica atrás do login é pulado.
const EMAIL = process.env.E2E_EMAIL?.trim();
const SENHA = process.env.E2E_PASSWORD;
export const comSessao = !!(EMAIL && SENHA);

/** Registra no stdout e como anotação do teste (aparece no relatório HTML). */
export function nota(tipo: string, texto: string) {
  console.log(`[${tipo}] ${texto}`);
  test.info().annotations.push({ type: tipo, description: texto });
}

/** Espera o app montar: com sessão aparece o mapa (campo de destino), sem sessão o login. */
export async function esperarApp(page: Page) {
  const login = page.getByLabel('E-mail', { exact: true });
  const destino = page.getByRole('combobox', { name: 'Para onde você vai?' });
  await expect(login.or(destino)).toBeVisible({ timeout: 20_000 });
}

/** Login pela interface; devolve o campo de destino do mapa. Com `navegar: false` usa a página já aberta. */
export async function entrar(page: Page, { navegar = true } = {}) {
  if (!comSessao) throw new Error('entrar() precisa de E2E_EMAIL e E2E_PASSWORD.');
  if (navegar) await page.goto('/');
  await page.getByLabel('E-mail', { exact: true }).fill(EMAIL!);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  const destino = page.getByRole('combobox', { name: 'Para onde você vai?' });
  try {
    await expect(destino).toBeVisible({ timeout: 20_000 });
  } catch (e) {
    const alertas = await page.getByRole('alert').allInnerTexts();
    throw new Error(`Login não chegou ao mapa. Alertas na tela: ${JSON.stringify(alertas)}. ${(e as Error).message}`);
  }
  return destino;
}

/**
 * Coleta violações de CSP (o header está em Report-Only: nada é bloqueado, mas o navegador dispara
 * `securitypolicyviolation`). Complementa com as mensagens de console do Chromium, que também cobrem
 * workers. Chame antes do `goto`; a função devolvida lê o que foi coletado até agora.
 */
export async function coletarCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: object[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp.push({
        diretiva: e.effectiveDirective,
        bloqueado: e.blockedURI,
        origem: `${e.sourceFile}:${e.lineNumber}`,
        disposicao: e.disposition,
      });
    });
  });
  const doConsole = new Set<string>();
  const ouvir = (texto: string) => {
    // "frame-ancestors ... is ignored" em Report-Only é aviso do navegador, não violação.
    if (/Content Security Policy/i.test(texto) && /(Refused to|violates the following)/i.test(texto)) {
      doConsole.add(texto.slice(0, 300));
    }
  };
  page.on('console', (m) => ouvir(m.text()));
  page.on('worker', (w) => w.on('console', (m) => ouvir(m.text())));

  return async () => {
    const eventos = await page.evaluate(() => (window as unknown as { __csp?: object[] }).__csp ?? []);
    const agrupado = new Map<string, number>();
    for (const v of eventos as { diretiva: string; bloqueado: string; disposicao: string }[]) {
      const alvo = /^https?:|^wss?:/.test(v.bloqueado) ? new URL(v.bloqueado).origin : v.bloqueado || '(vazio)';
      const chave = `${v.diretiva} <- ${alvo}`;
      agrupado.set(chave, (agrupado.get(chave) ?? 0) + 1);
    }
    return {
      eventos: [...agrupado].map(([k, n]) => `${k} (${n}x)`),
      console: [...doConsole],
    };
  };
}
