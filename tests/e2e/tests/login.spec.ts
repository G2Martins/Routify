import { test, expect } from '@playwright/test';
import { esperarApp } from './helpers';

test.describe('7. Login e MFA', () => {
  test('a tela de login tem e-mail, senha e botão Entrar', async ({ page }) => {
    await page.goto('/');
    const email = page.getByLabel('E-mail', { exact: true });
    const senha = page.getByLabel('Senha', { exact: true });
    await expect(email).toBeVisible({ timeout: 20_000 });
    await expect(senha).toBeVisible();
    await expect(senha).toHaveAttribute('type', 'password'); // a senha não pode aparecer em texto
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('a tela de MFA não é alcançável sem sessão (nem pelos ?preview= de desenvolvimento)', async ({ page }) => {
    // ?preview=mfa e ?preview=mapa só existem em build de desenvolvimento (__DEV__); em produção têm de ser ignorados.
    for (const caminho of ['/', '/?preview=mfa', '/?preview=mapa']) {
      await page.goto(caminho);
      await esperarApp(page);
      await expect(page.getByLabel('E-mail', { exact: true }), `${caminho}: deveria cair no login`).toBeVisible();
      await expect(page.getByText('Confirme que é você.'), `${caminho}: tela de MFA`).toHaveCount(0);
      await expect(page.getByText('Etapa 2 de 2'), `${caminho}: tela de MFA`).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Para onde você vai?' }), `${caminho}: mapa sem sessão`).toHaveCount(0);
    }
  });
});
