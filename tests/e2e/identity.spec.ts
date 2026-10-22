import { test, expect, type Page } from '@playwright/test';
const origin = 'http://127.0.0.1:3100';
async function login(page: Page, who: 'a' | 'b' = 'a') {
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
test('PKCE fixture → profile → workspace → tenant/role isolation → logout', async ({
  page,
  browser,
}) => {
  await login(page);
  await page.getByLabel('工作空間名稱').fill('KINO 測試工作室');
  await page.getByRole('button', { name: '建立工作空間', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'KINO 測試工作室' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'KINO 測試工作室' }),
  ).toBeVisible();
  await page.screenshot({
    path: '.local/m1-dashboard-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.local/m1-dashboard-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const session = (await page.context().cookies()).find(
    (c) => c.name.includes('auth-token') && !c.name.includes('verifier'),
  );
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'auth-token',
  );
  const workspaces = await (
    await page.request.get('/api/v1/workspaces')
  ).json();
  const workspaceId = workspaces.workspaces[0].id;
  if (!session) throw new Error('Missing expected server session cookie');
  const forgedContext = await browser.newContext({ baseURL: origin });
  const stored = JSON.parse(
    Buffer.from(session.value.replace(/^base64-/, ''), 'base64url').toString(
      'utf8',
    ),
  );
  stored.access_token = stored.access_token.replace(
    /\.[^.]+$/,
    '.forged-signature',
  );
  await forgedContext.addCookies([
    {
      ...session,
      value:
        'base64-' + Buffer.from(JSON.stringify(stored)).toString('base64url'),
    },
  ]);
  expect((await forgedContext.request.get('/api/v1/me')).status()).toBe(401);
  await forgedContext.close();
  const ctxB = await browser.newContext({ baseURL: origin });
  const pageB = await ctxB.newPage();
  await login(pageB, 'b');
  expect(
    (await (await pageB.request.get('/api/v1/workspaces')).json()).workspaces,
  ).toEqual([]);
  const change = {
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'workspace_editor',
    status: 'active',
    requestId: crypto.randomUUID(),
  };
  const url = `/api/v1/workspaces/${workspaceId}/members`;
  expect(
    (
      await pageB.request.put(url, {
        headers: { Origin: origin },
        data: change,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put(url, { headers: { Origin: origin }, data: change })
    ).status(),
  ).toBe(200);
  expect(
    (await (await pageB.request.get('/api/v1/workspaces')).json()).workspaces[0]
      .role,
  ).toBe('workspace_editor');
  expect(
    (
      await page.request.put(url, {
        headers: { Origin: origin },
        data: {
          ...change,
          status: 'suspended',
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await (await pageB.request.get('/api/v1/workspaces')).json()).workspaces,
  ).toEqual([]);
  const input = { name: '重送測試', requestId: crypto.randomUUID() };
  const a = await page.request.post('/api/v1/workspaces', {
    headers: { Origin: origin },
    data: input,
  });
  const b = await page.request.post('/api/v1/workspaces', {
    headers: { Origin: origin },
    data: input,
  });
  expect(a.status()).toBe(201);
  expect(await b.json()).toEqual(await a.json());
  expect(
    (
      await page.request.post('/api/v1/workspaces', {
        headers: { Origin: origin },
        data: { ...input, name: '不同內容' },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post('/api/v1/workspaces', {
        headers: { Origin: 'https://attacker.example' },
        data: input,
      })
    ).status(),
  ).toBe(403);
  for (let i = 0; i < 24; i++)
    expect(
      (
        await page.request.post('/api/v1/workspaces', {
          headers: { Origin: origin },
          data: { name: '分頁測試 ' + i, requestId: crypto.randomUUID() },
        })
      ).status(),
    ).toBe(201);
  const first = await (await page.request.get('/api/v1/workspaces')).json();
  expect(first.workspaces).toHaveLength(24);
  expect(first.nextCursor).toBeTruthy();
  const second = await (
    await page.request.get(
      '/api/v1/workspaces?cursor=' + encodeURIComponent(first.nextCursor),
    )
  ).json();
  expect(second.workspaces).toHaveLength(2);
  expect(second.nextCursor).toBeNull();
  const allIds = [...first.workspaces, ...second.workspaces].map(
    (w: { id: string }) => w.id,
  );
  expect(new Set(allIds).size).toBe(26);
  expect(
    (await page.request.get('/api/v1/workspaces?cursor=invalid')).status(),
  ).toBe(400);
  await page.reload();
  await page.getByRole('link', { name: '下一頁工作空間' }).click();
  await expect(
    page.getByRole('heading', { name: 'KINO 測試工作室' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '登出', exact: true }).click();
  await expect(page).toHaveURL('/login');
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
  await page.goto('/dashboard');
  await expect(page).toHaveURL('/login');
  await ctxB.close();
});
test('untrusted callback cannot redirect outside configured app or authenticate', async ({
  page,
}) => {
  await page.goto(
    '/auth/callback?code=untrusted&next=https://attacker.example',
  );
  await expect(page).toHaveURL('/login?error=auth_failed');
  await expect(
    page.getByRole('alert').filter({ hasText: '登入未完成' }),
  ).toHaveText('登入未完成，請重新開始');
  expect((await page.request.get('/api/v1/me')).status()).toBe(401);
});

test('default disabled auth has no fake login button and fails closed', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:3101/login');
  await expect(page.getByRole('status')).toContainText('登入服務尚未設定');
  await expect(
    page.getByRole('button', { name: '使用 Google 登入' }),
  ).toHaveCount(0);
  const response = await page.request.post(
    'http://127.0.0.1:3101/auth/google',
    { headers: { Origin: 'http://127.0.0.1:3101' } },
  );
  expect(response.status()).toBe(503);
});
