import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

export async function guestDownloadsBrowserCheck({
  worker,
  base,
  albumId,
  cookie,
}) {
  const baseUrl = new URL(base);
  const secure = baseUrl.protocol === 'https:';
  const cookieName = secure ? '__Host-kino_guest' : 'kino_guest';
  const browser = await chromium.launch({ headless: true });
  let stopServer;

  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      acceptDownloads: true,
    });
    await context.addCookies([
      {
        name: cookieName,
        value: cookie,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
        secure,
      },
    ]);

    const page = await context.newPage();
    const bridgeErrors = [];
    const downloadResponses = [];
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    // A real loopback HTTP response is required for native attachment persistence.
    const server = createServer(async (incoming, outgoing) => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(',') : value);
        }
        headers.set('cf-connecting-ip', '198.51.100.93');
        const method = incoming.method ?? 'GET';
        const url = new URL(incoming.url ?? '/', base);
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
        if (
          url.pathname.startsWith('/api/guest/photos/') &&
          url.pathname.includes('/downloads/original')
        ) {
          downloadResponses.push({
            status: response.status,
            size: body.byteLength,
            sha256: createHash('sha256').update(body).digest('hex'),
            contentDisposition: response.headers.get('content-disposition'),
            contentType: response.headers.get('content-type'),
          });
        }
        const responseHeaders = Object.fromEntries(response.headers.entries());
        delete responseHeaders['transfer-encoding'];
        outgoing.writeHead(response.status, responseHeaders);
        outgoing.end(body);
      } catch (error) {
        bridgeErrors.push(
          error instanceof Error ? error.message : String(error),
        );
        outgoing.writeHead(502);
        outgoing.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(baseUrl.port), baseUrl.hostname, resolve);
    });
    stopServer = () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );

    await page.goto(
      new URL('/guest/albums/' + encodeURIComponent(albumId), base).toString(),
      { waitUntil: 'networkidle' },
    );

    const panel = page.getByTestId('guest-downloads-panel');
    await expect(panel).toBeVisible();
    const photo = page.getByTestId('guest-download-photo').first();
    await expect(photo).toBeVisible();
    const originalLink = photo.getByTestId('guest-download-original');
    await expect(originalLink).toBeVisible();

    const href = await originalLink.getAttribute('href');
    assert.ok(href, 'The original download link has an href');
    const hrefUrl = new URL(href, base);
    assert.equal(hrefUrl.origin, baseUrl.origin);
    assert.match(
      hrefUrl.pathname,
      /^\/api\/guest\/photos\/[0-9a-f-]+\/versions\/[0-9a-f-]+\/downloads\/original$/i,
    );

    const filename = await originalLink.getAttribute('download');
    assert.ok(filename, 'The original download link names its file');
    assert.ok(
      (await panel.locator('img').count()) === 0,
      'Download-only panel does not render photos inline',
    );

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    assert.ok(
      dimensions.scrollWidth <= dimensions.clientWidth,
      'The 375px guest download page does not overflow horizontally',
    );

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      originalLink.click(),
    ]);
    assert.equal(download.suggestedFilename(), filename);
    const downloadedPath = await download.path();
    assert.ok(downloadedPath, 'Chromium saved a native download file');
    assert.ok(
      (await stat(downloadedPath)).size > 0,
      'The native download contains the original file bytes',
    );
    assert.equal(downloadResponses.length, 1);
    assert.equal(downloadResponses[0].status, 200);
    assert.equal((await stat(downloadedPath)).size, downloadResponses[0].size);
    assert.equal(
      createHash('sha256')
        .update(await readFile(downloadedPath))
        .digest('hex'),
      downloadResponses[0].sha256,
    );
    assert.ok(downloadResponses[0].size > 0);
    assert.match(
      downloadResponses[0].contentDisposition ?? '',
      /^attachment;/i,
    );
    assert.match(
      downloadResponses[0].contentType ?? '',
      /^image\/(jpeg|png|webp)$/i,
    );

    const screenshotPath = resolve('.local/guest-downloads-mobile.png');
    await mkdir(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await page.getByRole('button', { name: '登出訪客選片' }).click();
    await expect(
      page.getByRole('heading', { name: '您已登出訪客選片' }),
    ).toBeVisible();
    await expect(panel).toHaveCount(0);
    assert.ok(
      !(await page.locator('body').innerText()).includes(filename),
      'Logout clears the private filename from the page',
    );
    assert.ok(
      !(await context.cookies()).some((entry) => entry.name === cookieName),
      'Logout clears the guest session cookie',
    );
    assert.deepEqual(bridgeErrors, []);
    assert.deepEqual(pageErrors, []);

    await context.close();
    return {
      viewport: '375x812',
      photoFilename: filename,
      downloadedFilename: download.suggestedFilename(),
      downloadStatus: downloadResponses[0].status,
      screenshotPath,
      loggedOut: true,
    };
  } finally {
    await browser.close();
    await stopServer?.();
  }
}
