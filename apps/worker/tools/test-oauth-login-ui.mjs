import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';

/** Local UI fault injection only; successful capabilities/assets use the real Worker. */
export async function checkOAuthLoginUI(mf, origin) {
  let mode = 'hold';
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const failures = [];
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'GET') {
        response.writeHead(405).end();
        return;
      }
      if (request.url === '/api/oauth/providers') {
        if (mode === 'hold') await held;
        if (mode === 'failure') {
          response.writeHead(503, { 'Content-Type': 'application/json' });
          response.end('{"error":{"code":"INJECTED_CAPABILITY_FAILURE"}}');
          return;
        }
      }
      const result = await mf.dispatchFetch(origin + request.url);
      const body = Buffer.from(await result.arrayBuffer());
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(body);
    })().catch(() => {
      failures.push('Worker HTTP bridge failed');
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:' + address.port, {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      page.getByText('正在載入可用的登入方式…', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /使用 (Google|GitHub) 登入/ }),
    ).toHaveCount(0);
    release();
    mode = 'actual';
    await expect(
      page.getByRole('button', { name: '使用 GitHub 登入', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: '使用 Google 登入', exact: true }),
    ).toHaveCount(0);
    await context.close();
    mode = 'failure';
    const failedContext = await browser.newContext();
    const failedPage = await failedContext.newPage();
    await failedPage.goto('http://127.0.0.1:' + address.port, {
      waitUntil: 'domcontentloaded',
    });
    await expect(
      failedPage.getByText('目前無法確認可用的登入方式，請稍後重新整理。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      failedPage.getByRole('button', { name: /使用 (Google|GitHub) 登入/ }),
    ).toHaveCount(0);
    await failedContext.close();
    assert.deepEqual(failures, []);
    return [
      'oauth-ui-loading-closed',
      'oauth-ui-configured-provider-only',
      'oauth-ui-failure-closed',
    ];
  } finally {
    release();
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
