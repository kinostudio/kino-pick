import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

export async function guestExchangeLostResponseBrowser({
  worker,
  base,
  token,
  requestId,
}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let dropped = false;
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const headers = await incoming.allHeaders();
      headers['cf-connecting-ip'] ??= '198.51.100.250';
      const response = await worker.fetch(
        new Request(incoming.url(), {
          method: incoming.method(),
          headers,
          ...(incoming.method() !== 'GET' && incoming.method() !== 'HEAD'
            ? { body: incoming.postDataBuffer() ?? undefined }
            : {}),
          redirect: 'manual',
        }),
      );
      if (
        new URL(incoming.url()).pathname === '/api/guest/exchange' &&
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
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    const execute = () =>
      page.evaluate(
        async ({ id, bearer }) => {
          try {
            return await fetch('/api/guest/exchange', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requestId: id,
                token: bearer,
                displayName: 'Lost response visitor',
              }),
            }).then((response) => response.status);
          } catch {
            return 0;
          }
        },
        { id: requestId, bearer: token },
      );
    assert.equal(await execute(), 0);
    assert.equal(
      (await context.cookies()).some((cookie) => cookie.name === 'kino_guest'),
      false,
    );
    assert.equal(await execute(), 401);
    assert.equal(
      (await context.cookies()).some((cookie) => cookie.name === 'kino_guest'),
      false,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
