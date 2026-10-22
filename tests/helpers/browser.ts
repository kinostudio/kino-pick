import { expect, type Page } from '@playwright/test';
export const origin = 'http://127.0.0.1:3100';
export async function login(page: Page, who: 'a' | 'b' = 'a') {
  if (who === 'b')
    await page
      .context()
      .addCookies([
        { name: 'fixture-user', value: 'b', url: 'http://127.0.0.1:54329' },
      ]);
  await page.goto('/login');
  await page.getByRole('button', { name: '使用 Google 登入' }).click();
  await expect(page).toHaveURL('/dashboard');
  await expect(page.getByRole('heading', { name: '攝影工作台' })).toBeVisible();
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    who === 'b'
      ? '22222222-2222-4222-8222-222222222222'
      : '11111111-1111-4111-8111-111111111111',
  );
}
