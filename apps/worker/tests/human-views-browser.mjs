import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';

export async function humanViewBrowserChecks({
  worker,
  base,
  albumId,
  photoId,
  versionId,
  filename,
  projectId,
  ownerCookie,
  guestCookie,
}) {
  const browser = await chromium.launch({ headless: true });
  const posts = [],
    errors = [],
    guestPhotoMetadataReads = [],
    heldAssetPaths = [];
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
        method === 'GET' &&
        url.pathname === `/api/guest/albums/${albumId}/photos`
      )
        guestPhotoMetadataReads.push(url.pathname);
      if (
        holdImages &&
        url.pathname.startsWith('/api/') &&
        url.pathname.includes('/assets/')
      ) {
        heldAssetPaths.push(url.pathname);
        await new Promise((resolve) => held.add(resolve));
      }
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
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== new URL(base).origin) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
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
    holdImages = true;
    const openAlbum = owner.page
      .getByTestId('album-card-' + albumId)
      .getByRole('button', {
        name: '開啟相簿 Guest download album',
        exact: true,
      });
    await openAlbum.click();
    assert.equal(
      new URL(owner.page.url()).searchParams.get('albumId'),
      albumId,
    );
    const ownerGrid = owner.page.getByTestId('owner-gallery-photos');
    await expect(ownerGrid).toBeVisible();
    await expect(ownerGrid).toHaveAttribute('data-gallery-view', 'masonry');
    const ownerPhotoButton = ownerGrid.getByRole('button', {
      name: `開啟照片預覽：${filename}`,
      exact: true,
    });
    await expect(ownerPhotoButton).toBeVisible();
    const ownerImage = ownerPhotoButton.locator('img');
    await ownerImage.scrollIntoViewIfNeeded();
    await ownerPhotoButton.focus();
    await expect(ownerPhotoButton).toBeFocused();
    await expect
      .poll(() =>
        heldAssetPaths.includes(
          `/api/v1/photos/${photoId}/versions/${versionId}/assets/thumbnail`,
        ),
      )
      .toBe(true);
    const ownerBeforeModal = posts.length;
    await owner.page.evaluate(() => {
      const backgroundFocus = document.activeElement;
      const overlay = document.createElement('div');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'human-view-test-modal');
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.85)',
      });
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = '遮罩焦點';
      overlay.append(control);
      document.body.append(overlay);
      window.__humanViewTestModal = overlay;
      window.__humanViewBackgroundFocus = backgroundFocus;
      control.focus();
    });
    const modal = owner.page.getByRole('dialog', {
      name: 'human-view-test-modal',
    });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: '遮罩焦點' })).toBeFocused();
    release();
    await expect
      .poll(() =>
        ownerImage.evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
    await owner.page.waitForTimeout(1100);
    assert.equal(
      posts.length,
      ownerBeforeModal,
      'loaded background image under a modal does not renew activity',
    );
    await owner.page.evaluate(() => {
      window.__humanViewTestModal?.remove();
      window.__humanViewBackgroundFocus?.focus();
    });
    await expect(modal).toBeHidden();
    await expect
      .poll(() => posts.filter((p) => p.path.startsWith('/api/v1/')).length, {
        timeout: 10000,
      })
      .toBe(ownerBeforeModal + 1);
    const ownerPost = posts.at(-1);
    assert.equal(ownerPost.status, 200);
    assert.equal(ownerPost.result.recorded, true);
    assert.equal(ownerPost.request.photoId, photoId);
    assert.equal(ownerPost.request.versionId, versionId);
    await owner.context.close();

    const guest = await contextFor('kino_guest', guestCookie);
    holdImages = true;
    const before = posts.length;
    await guest.page.goto(base + '/guest/albums/' + albumId, {
      waitUntil: 'domcontentloaded',
    });
    const guestGrid = guest.page.getByRole('list', { name: '相簿照片列表' });
    await expect(guestGrid).toBeVisible();
    const guestPhotoButton = guestGrid.getByRole('button', {
      name: `檢視大圖 ${filename}`,
      exact: true,
    });
    await expect(guestPhotoButton).toBeVisible();
    await expect
      .poll(() => guestPhotoMetadataReads.length > 0, { timeout: 10000 })
      .toBe(true);
    assert.equal(
      posts.length,
      before,
      'raw Guest photo metadata does not renew activity',
    );
    const image = guestPhotoButton.locator('img');
    await image.waitFor({ state: 'attached' });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        heldAssetPaths.includes(
          `/api/guest/photos/${photoId}/versions/${versionId}/assets/thumbnail`,
        ),
      )
      .toBe(true);
    await guest.page.waitForTimeout(1100);
    assert.equal(
      posts.length,
      before,
      'an in-flight photo asset fetch does not renew activity',
    );
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
    await guestPhotoButton.click();
    const lightbox = guest.page.getByRole('dialog', { name: filename });
    await expect(lightbox).toBeVisible();
    const lightboxImage = lightbox.getByRole('img', { name: filename });
    await expect(lightboxImage).toBeVisible();
    await expect
      .poll(() =>
        lightboxImage.evaluate((img) => img.complete && img.naturalWidth > 0),
      )
      .toBe(true);
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
      ownerModalBackgroundExcludedUntilFocusReturns: true,
      ownerVisibleGridRecorded: true,
      guestRawMetadataExcluded: true,
      guestPendingAssetExcluded: true,
      guestHiddenSubsecondBlurExcluded: true,
      guestContinuousVisibleRecorded: true,
      guestLightboxFiveMinuteCooldownShared: true,
      controlledHeadlessVisibility: true,
    };
  } finally {
    release();
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
