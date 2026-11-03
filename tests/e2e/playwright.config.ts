import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, comSessao } from './tests/helpers';

// Só o processo principal avisa (os workers herdam TEST_WORKER_INDEX).
if (!comSessao && !process.env.TEST_WORKER_INDEX) {
  console.warn(
    '\nAVISO: sem E2E_EMAIL/E2E_PASSWORD. O mapa e a busca pela interface ficam atrás do login e serão PULADOS (ver README).\n',
  );
}

export default defineConfig({
  testDir: './tests',
  // Produção compartilhada com limite por IP (/route 20/min, /search 90/min): um worker, em série.
  workers: 1,
  fullyParallel: false,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: path.join(__dirname, 'playwright-report'), open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
