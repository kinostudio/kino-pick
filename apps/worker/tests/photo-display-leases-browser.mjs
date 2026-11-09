import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

export async function photoDisplayLeaseBrowserChecks({
  worker,
  base,
  ownerCookie,
  guestCookie,
  fixture,
}) {
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  let releaseHeldLease;
  try {
    for (const [role, cookie] of [
      ['owner', ownerCookie],
      ['guest', guestCookie],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
      });
      const separator = cookie.indexOf('=');
      await context.addCookies([
        {
          name: cookie.slice(0, separator),
          value: cookie.slice(separator + 1),
          url: base,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      const page = await context.newPage();
      let denyLeases = false,
        leaseCalls = 0,
        humanPosts = 0,
        navigations = 0;
      let leaseGate;
      await page.route('**/*', async (route) => {
        const incoming = route.request(),
          url = new URL(incoming.url());
        if (url.origin !== new URL(base).origin)
          return route.abort('blockedbyclient');
        if (url.pathname.endsWith('/view-heartbeats')) humanPosts++;
        if (url.pathname.endsWith('/display-leases')) {
          leaseCalls++;
          if (denyLeases)
            return route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({
                error: { code: 'DISPLAY_LEASE_UNAVAILABLE' },
              }),
            });
          if (leaseGate) await leaseGate;
        }
        const init = {
          method: incoming.method(),
          headers: await incoming.allHeaders(),
          redirect: 'manual',
        };
        if (!['GET', 'HEAD'].includes(init.method))
          init.body = incoming.postDataBuffer() ?? undefined;
        const response = await worker.fetch(new Request(incoming.url(), init));
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
      const path =
        role === 'owner'
          ? '/dashboard/projects/' +
            fixture.projectId +
            '?albumId=' +
            fixture.albumId
          : '/guest/albums/' + fixture.albumId;
      await page.goto(base + path, { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      const image = page
        .locator('img[data-kino-photo-id="' + fixture.photoId + '"]')
        .first();
      await expect.poll(() => leaseCalls).toBeGreaterThan(0);
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((img) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations++;
      });
      await page.evaluate(() => {
        window.__leaseDraftProbe = 'keep this synthetic draft';
        const original = Date.now;
        window.__restoreLeaseClock = () => {
          Date.now = original;
        };
        Date.now = () => original() + 700000;
      });
      denyLeases = true;
      await page.evaluate(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(image).toBeHidden();
      const afterHidden = humanPosts;
      await page.waitForTimeout(1200);
      assert.equal(
        humanPosts,
        afterHidden,
        'hidden leased photos do not create new human heartbeats',
      );
      const attempts = leaseCalls;
      denyLeases = false;
      leaseGate = new Promise((resolve) => {
        releaseHeldLease = resolve;
      });
      await page.evaluate(() => window.__restoreLeaseClock());
      await page.getByRole('button', { name: '重新連線', exact: true }).click();
      await expect.poll(() => leaseCalls).toBeGreaterThan(attempts);
      await expect(image).toBeHidden();
      releaseHeldLease();
      leaseGate = undefined;
      await expect(image).toBeVisible();
      assert.equal(
        await page.evaluate(() => window.__leaseDraftProbe),
        'keep this synthetic draft',
      );
      assert.equal(
        navigations,
        0,
        'reconnect never reloads or navigates the document',
      );
      checks.push(
        role +
          ': real private image/grant, clock-gap hide, failed renewal stays hidden, fresh reconnect without navigation',
      );
      await context.close();
    }
  } finally {
    releaseHeldLease?.();
    await browser.close();
  }
  return checks;
}
