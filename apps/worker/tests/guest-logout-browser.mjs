import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

export async function guestLogoutBrowser({
  worker,
  base,
  ownerCookie,
  guestSecret,
  requestId,
  albumId,
}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: 'kino_guest',
        value: guestSecret,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
      },
      {
        name: 'kino-owner.session_token',
        value: ownerCookie,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    let dropped = false;
    await page.route('**/*', async (route) => {
      const incoming = route.request(),
        method = incoming.method();
      const response = await worker.fetch(
        new Request(incoming.url(), {
          method,
          headers: await incoming.allHeaders(),
          ...(method !== 'GET' && method !== 'HEAD'
            ? { body: incoming.postDataBuffer() ?? undefined }
            : {}),
          redirect: 'manual',
        }),
      );
      if (
        new URL(incoming.url()).pathname === '/api/guest/logout' &&
        !dropped
      ) {
        assert.equal(response.status, 200);
        dropped = true;
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await page.goto(base + '/dashboard', { waitUntil: 'networkidle' });
    const execute = () =>
      page.evaluate(async (id) => {
        try {
          return (
            await fetch('/api/guest/logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ requestId: id }),
            })
          ).status;
        } catch {
          return 0;
        }
      }, requestId);
    assert.equal(await execute(), 0);
    assert.ok(
      (await context.cookies()).some((cookie) => cookie.name === 'kino_guest'),
    );
    assert.equal(
      await page.evaluate(
        async (id) => (await fetch(`/api/guest/albums/${id}/access`)).status,
        albumId,
      ),
      401,
    );
    assert.equal(await execute(), 200);
    assert.ok(
      !(await context.cookies()).some((cookie) => cookie.name === 'kino_guest'),
    );
    assert.ok(
      (await context.cookies()).some(
        (cookie) => cookie.name === 'kino-owner.session_token',
      ),
    );
    assert.equal(
      await page.evaluate(async () => (await fetch('/api/v1/me')).status),
      200,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
