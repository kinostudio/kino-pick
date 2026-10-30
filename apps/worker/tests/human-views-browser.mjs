import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';

export async function humanViewBrowserChecks({
  worker,
  base,
  albumId,
  projectId,
  ownerCookie,
  guestCookie,
}) {
  const browser = await chromium.launch({ headless: true });
  const posts = [],
    errors = [];
  let holdImages = false;
  const held = new Set();
  const release = () => {
    holdImages = false;
    for (const finish of held) finish();
    held.clear();
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', base);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (value !== undefined)
          headers.set(name, Array.isArray(value) ? value.join(',') : value);
      headers.set('CF-Connecting-IP', '198.51.100.91');
      const method = req.method ?? 'GET';
      if (
        holdImages &&
        url.pathname.startsWith('/api/') &&
        url.pathname.includes('/assets/')
      )
        await new Promise((resolve) => held.add(resolve));
      const response = await worker.fetch(
        new Request(url, {
          method,
          headers,
          redirect: 'manual',
          ...(method === 'GET' || method === 'HEAD'
            ? {}
            : { body: Buffer.concat(chunks) }),
        }),
      );
      const body = Buffer.from(await response.arrayBuffer());
      if (method === 'POST' && url.pathname.endsWith('/view-heartbeats'))
        posts.push({
          path: url.pathname,
          status: response.status,
          request: JSON.parse(Buffer.concat(chunks).toString()),
          result: JSON.parse(body.toString()),
        });
      const responseHeaders = Object.fromEntries(response.headers.entries());
      delete responseHeaders['transfer-encoding'];
      res.writeHead(response.status, responseHeaders);
      res.end(body);
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    const u = new URL(base);
    server.listen(Number(u.port), u.hostname, resolve);
  });
  async function contextFor(name, value) {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      { name, value, url: base, httpOnly: true, sameSite: 'Lax' },
    ]);
    await context.addInitScript(() => {
      window.__humanVisible = true;
      window.__humanFocused = true;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (window.__humanVisible ? 'visible' : 'hidden'),
      });
      Object.defineProperty(document, 'hasFocus', {
        configurable: true,
        value: () => window.__humanFocused,
      });
      window.__setHumanEnvironment = (visible, focused) => {
        window.__humanVisible = visible;
        window.__humanFocused = focused;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
      };
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    return { context, page };
  }
  try {
    // Owner management metadata alone is not a human photo view.
    const split = ownerCookie.indexOf('=');
    const owner = await contextFor(
      ownerCookie.slice(0, split),
      ownerCookie.slice(split + 1),
    );
    await owner.page.goto(base + '/dashboard/projects/' + projectId, {
      waitUntil: 'networkidle',
    });
    await owner.page.waitForTimeout(1100);
    assert.equal(posts.length, 0);
    await owner.page
      .getByTestId('album-card-' + albumId)
      .getByRole('button', {
        name: '查看照片 Guest download album',
        exact: true,
      })
      .click();
    const ownerImage = owner.page
      .locator('img[src*="/assets/thumbnail"]')
      .first();
    await ownerImage.scrollIntoViewIfNeeded();
    await expect
      .poll(() => posts.filter((p) => p.path.startsWith('/api/v1/')).length, {
        timeout: 10000,
      })
      .toBe(1);
    assert.equal(posts[0].status, 200);
    assert.equal(posts[0].result.recorded, true);
    await owner.context.close();

    const guest = await contextFor('kino_guest', guestCookie);
    holdImages = true;
    const before = posts.length;
    await guest.page.goto(base + '/guest/albums/' + albumId, {
      waitUntil: 'domcontentloaded',
    });
    const image = guest.page.locator('img[src*="/assets/thumbnail"]').first();
    await image.waitFor({ state: 'attached' });
    await image.scrollIntoViewIfNeeded();
    await guest.page.waitForTimeout(1100);
    assert.equal(posts.length, before, 'unloaded images must not count');
    await guest.page.evaluate(() => window.__setHumanEnvironment(false, false));
    release();
    await expect
      .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await guest.page.waitForTimeout(1100);
    assert.equal(posts.length, before, 'hidden loaded images must not count');
    await guest.page.evaluate(() => window.__setHumanEnvironment(true, true));
    await guest.page.waitForTimeout(650);
    assert.equal(posts.length, before, 'subsecond visibility must not count');
    await guest.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await guest.page.waitForTimeout(1100);
    assert.equal(
      posts.length,
      before,
      'blur must reset and cancel the visible timer',
    );
    await guest.page.evaluate(() => window.__setHumanEnvironment(true, true));
    await guest.page.waitForTimeout(650);
    assert.equal(
      posts.length,
      before,
      'visibility must be continuous after focus returns',
    );
    await expect.poll(() => posts.length, { timeout: 10000 }).toBe(before + 1);
    const guestPost = posts.at(-1);
    assert.equal(guestPost.status, 200);
    assert.equal(guestPost.result.recorded, true);
    assert.equal(guestPost.request.visibleForMs, 1000);
    await image.click();
    await guest.page.waitForTimeout(1200);
    assert.equal(
      posts.length,
      before + 1,
      'opening the same photo preview must share the album cooldown',
    );
    await guest.context.close();
    assert.deepEqual(errors, []);
    return {
      ownerManagementExcluded: true,
      ownerVisibleRecorded: true,
      guestUnloadedHiddenSubsecondBlurExcluded: true,
      guestContinuousVisibleRecorded: true,
      previewCooldownShared: true,
      controlledHeadlessVisibility: true,
    };
  } finally {
    release();
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
