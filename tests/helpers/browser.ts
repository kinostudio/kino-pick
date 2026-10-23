import { expect, type Page } from '@playwright/test';
export const origin = 'http://127.0.0.1:3100';
export async function login(
  page: Page,
  who: 'a' | 'b' | 'c' | 'd' = 'a',
  provider: 'google' | 'github' = 'google',
) {
  if (who !== 'a')
    await page
      .context()
      .addCookies([
        { name: 'fixture-user', value: who, url: 'http://127.0.0.1:54329' },
      ]);
  await page.goto('/login');
  await page
    .getByRole('button', {
      name: provider === 'github' ? '使用 GitHub 登入' : '使用 Google 登入',
    })
    .click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: '攝影工作台' })).toBeVisible();
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    {
      a: '11111111-1111-4111-8111-111111111111',
      b: '22222222-2222-4222-8222-222222222222',
      c: '44444444-4444-4444-8444-444444444444',
      d: '55555555-5555-4555-8555-555555555555',
    }[who],
  );
}
