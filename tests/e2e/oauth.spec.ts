import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { login, origin } from '../helpers/browser';
const headers = { Origin: origin };
async function workspace(page: import('@playwright/test').Page, name: string) {
  const response = await page.request.post('/api/v1/workspaces', {
    headers,
    data: { name, requestId: crypto.randomUUID() },
  });
  expect(response.status()).toBe(201);
  return z
    .object({ workspace: z.object({ id: z.uuid() }) })
    .parse(await response.json()).workspace;
}
async function boundRows(page: import('@playwright/test').Page) {
  await expect(
    page.getByRole('heading', { name: '帳號與登入方式', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('已綁定', { exact: true })).toHaveCount(2);
  await expect(
    page.getByRole('button', { name: /綁定 (Google|GitHub)/ }),
  ).toHaveCount(0);
}
test('GitHub-only account can create workspace and link Google without changing identity', async ({
  page,
}) => {
  await login(page, 'c', 'github');
  const before = await (await page.request.get('/api/v1/me')).json();
  expect(before.actor.provider).toBe('github');
  const w = await workspace(page, 'GitHub 工作室');
  await page.getByRole('link', { name: '帳號與登入方式', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '綁定 Google', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '綁定 GitHub', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '綁定 Google', exact: true }).click();
  await expect(page).toHaveURL('/dashboard/account?notice=linked');
  await boundRows(page);
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    before.actor.id,
  );
  await page.goto('/dashboard');
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await login(page, 'c', 'google');
  expect(
    (
      await (
        await page.request.get(`/api/v1/projects?workspaceId=${w.id}`)
      ).json()
    ).workspace.id,
  ).toBe(w.id);
});
test('Google → explicit GitHub linking → GitHub login retains the same workspace and profile identity', async ({
  page,
}) => {
  await login(page, 'd', 'google');
  const id = (await (await page.request.get('/api/v1/me')).json()).actor.id;
  const w = await workspace(page, '雙來源同身分工作室');
  await page.goto('/dashboard/account');
  await page.getByRole('button', { name: '綁定 GitHub', exact: true }).click();
  await expect(page).toHaveURL('/dashboard/account?notice=linked');
  await boundRows(page);
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    id,
  );
  expect(
    (await page.context().cookies()).some((c) => c.name === 'kino-link-intent'),
  ).toBe(false);
  await page.screenshot({
    path: '.local/oauth-account-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.local/oauth-account-mobile.png',
    fullPage: true,
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await login(page, 'd', 'github');
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    id,
  );
  expect(
    (
      await (
        await page.request.get(`/api/v1/projects?workspaceId=${w.id}`)
      ).json()
    ).workspace.id,
  ).toBe(w.id);
  expect(
    (await page.request.post('/auth/link/github', { headers })).status(),
  ).toBe(409);
  expect(
    (await page.request.post('/auth/link/twitter', { headers })).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post('/auth/link/google', {
        headers: { Origin: 'https://attacker.example' },
      })
    ).status(),
  ).toBe(403);
});
test('link conflict and exchanged actor mismatch do not merge distinct platform accounts', async ({
  page,
}) => {
  await login(page, 'a', 'google');
  const id = (await (await page.request.get('/api/v1/me')).json()).actor.id;
  await page.goto('/dashboard/account');
  await page
    .context()
    .addCookies([
      { name: 'fixture-user', value: 'c', url: 'http://127.0.0.1:54329' },
    ]);
  await page.getByRole('button', { name: '綁定 GitHub', exact: true }).click();
  await expect(page).toHaveURL('/dashboard/account?error=link_failed');
  await expect(
    page.getByRole('alert').filter({ hasText: '綁定未完成' }),
  ).toBeVisible();
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    id,
  );
  await expect(
    page.getByRole('button', { name: '綁定 GitHub', exact: true }),
  ).toBeVisible();
  // Even a provider-side valid code yielding a different user must not switch accounts.
  await page.context().addCookies([
    { name: 'fixture-user', value: 'a', url: 'http://127.0.0.1:54329' },
    { name: 'fixture-link-switch', value: 'c', url: 'http://127.0.0.1:54329' },
  ]);
  await page.getByRole('button', { name: '綁定 GitHub', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  expect(
    (await page.context().cookies()).some((c) => c.name === 'kino-link-intent'),
  ).toBe(false);
  await page.context().clearCookies({ name: 'fixture-link-switch' });
  await login(page, 'a', 'google');
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    id,
  );
  await page.goto(
    '/auth/link/callback?code=untrusted&next=https://attacker.example',
  );
  await expect(page).toHaveURL('/dashboard/account?error=link_failed');
  expect((await (await page.request.get('/api/v1/me')).json()).actor.id).toBe(
    id,
  );
});
test('Google-only deployment hides GitHub and leaves manual linking closed', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3103/login');
  await expect(
    page.getByRole('button', { name: '使用 Google 登入', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '使用 GitHub 登入', exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post('http://127.0.0.1:3103/auth/github', {
        headers: { Origin: 'http://127.0.0.1:3103' },
      })
    ).status(),
  ).toBe(503);
  expect(
    (
      await page.request.post('/auth/github', {
        headers: { Origin: 'https://attacker.example' },
      })
    ).status(),
  ).toBe(403);
  const denied = await page.request.post(
    'http://127.0.0.1:3103/auth/link/google',
    { headers: { Origin: 'http://127.0.0.1:3103' } },
  );
  expect(denied.status()).toBe(503);
  expect((await denied.json()).error.code).toBe('LINKING_DISABLED');
});
