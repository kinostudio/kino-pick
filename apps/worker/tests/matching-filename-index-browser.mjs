import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const INDEX_STATUS_PATH =
  /^\/api\/v1\/albums\/[^/]+\/matching-filename-index$/u;

function ownerCookieValue(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/u.exec(
    ownerCookie,
  );
  assert.ok(match, 'The browser fixture has an Owner session cookie');
  return decodeURIComponent(match[1]);
}

async function addOwnerCookie(context, origin, ownerCookie) {
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: ownerCookieValue(ownerCookie),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(origin).protocol === 'https:',
    },
  ]);
}

async function incomingBody(incoming) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

async function createWorkerProxy(worker, base) {
  const browserOrigin = { value: null };
  const workerOrigin = new URL(base).origin;
  let heldStatus = null;
  let activeHold = null;
  const observations = {
    requests: [],
    capabilities: [],
    statuses: [],
    advances: [],
    me: [],
    errors: [],
  };

  const server = createServer(async (incoming, outgoing) => {
    const parsed = new URL(incoming.url ?? '/', 'http://127.0.0.1');
    const method = incoming.method ?? 'GET';
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        headers.set(
          name,
          Array.isArray(value)
            ? value.join(name === 'cookie' ? '; ' : ', ')
            : value,
        );
      }
      if (browserOrigin.value && headers.get('origin') === browserOrigin.value)
        headers.set('origin', workerOrigin);
      headers.set('cf-connecting-ip', '198.51.100.93');
      const bytes = await incomingBody(incoming);
      const target = new URL(parsed.pathname + parsed.search, base);
      const response = await worker.fetch(
        new Request(target, {
          method,
          headers,
          ...(bytes ? { body: bytes } : {}),
          redirect: 'manual',
        }),
      );
      const responseHeaders = Object.fromEntries(response.headers.entries());
      for (const name of HOP_BY_HOP) delete responseHeaders[name];
      const record = {
        method,
        pathname: parsed.pathname,
        search: parsed.search,
        status: response.status,
        expectedActor: headers.get('x-kino-expected-actor'),
      };
      observations.requests.push(record);
      if (parsed.pathname === '/api/v1/matching-filename-index/capabilities')
        observations.capabilities.push(record);
      if (parsed.pathname === '/api/v1/me') observations.me.push(record);

      if (INDEX_STATUS_PATH.test(parsed.pathname) && method === 'GET') {
        const responseBytes = Buffer.from(await response.arrayBuffer());
        record.body = parseJson(responseBytes);
        observations.statuses.push(record);
        const hold = heldStatus;
        if (hold) {
          heldStatus = null;
          activeHold = hold;
          hold.capture(record);
          await hold.releasePromise;
          activeHold = null;
        }
        outgoing.writeHead(response.status, responseHeaders);
        outgoing.end(responseBytes);
        return;
      }

      if (INDEX_STATUS_PATH.test(parsed.pathname) && method === 'POST') {
        const requestBytes = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
        record.request = parseJson(requestBytes);
        record.requestText = requestBytes.toString('utf8');
        record.body = parseJson(Buffer.from(await response.arrayBuffer()));
        observations.advances.push(record);
        outgoing.writeHead(response.status, responseHeaders);
        outgoing.end(JSON.stringify(record.body));
        return;
      }

      const responseBytes = Buffer.from(await response.arrayBuffer());
      record.body = parseJson(responseBytes);
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(responseBytes);
    } catch (error) {
      observations.errors.push(
        error instanceof Error ? error.message : String(error),
      );
      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(502, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        outgoing.end('Matching filename index browser proxy failed');
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  browserOrigin.value = 'http://127.0.0.1:' + address.port;
  return {
    origin: browserOrigin.value,
    observations,
    holdNextStatus() {
      assert.equal(
        heldStatus,
        null,
        'Only one index status response can be held',
      );
      let capture;
      let release;
      const captured = new Promise((resolve) => {
        capture = resolve;
      });
      const releasePromise = new Promise((resolve) => {
        release = resolve;
      });
      heldStatus = { capture, release, releasePromise };
      return { captured, release };
    },
    async close() {
      heldStatus?.release();
      activeHold?.release();
      const closed = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.closeAllConnections?.();
      await closed;
    },
  };
}

function countLocator(panel, label) {
  return panel.locator('dl > div').filter({ hasText: label }).locator('dd');
}

async function openGallery(page, albumId, albumName) {
  const card = page.getByTestId('album-card-' + albumId);
  await expect(card).toBeVisible();
  await card
    .getByRole('button', { name: '查看照片 ' + albumName, exact: true })
    .click();
}

async function noMobileOverflow(page) {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    widths.scrollWidth <= widths.clientWidth,
    'Matching filename index overflows the 375px viewport: ' +
      JSON.stringify(widths),
  );
  return false;
}

export async function runMatchingFilenameIndexBrowserChecks({
  db,
  worker,
  disabledWorker,
  base,
  owner,
  ownerCookie,
  scope,
  blockerScope,
  expectedMissing,
}) {
  assert.equal(expectedMissing, 1);
  const browser = await chromium.launch({ headless: true });
  const proxy = await createWorkerProxy(worker, base);
  const disabledProxy = await createWorkerProxy(disabledWorker, base);
  let context;
  let disabledContext;
  let ownerNeedsRestore = false;
  try {
    disabledContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(disabledContext, disabledProxy.origin, ownerCookie);
    const disabledPage = await disabledContext.newPage();
    await disabledPage.goto(
      disabledProxy.origin + '/dashboard/projects/' + scope.project.id,
      { waitUntil: 'networkidle' },
    );
    await openGallery(disabledPage, scope.album.id, scope.album.name);
    await expect(
      disabledPage.getByTestId('matching-filename-index-panel'),
    ).toHaveCount(0);
    await expect
      .poll(() => disabledProxy.observations.capabilities.length)
      .toBe(1);
    assert.equal(disabledProxy.observations.capabilities[0].status, 200);
    assert.deepEqual(disabledProxy.observations.capabilities[0].body, {
      enabled: false,
    });
    assert.equal(disabledProxy.observations.statuses.length, 0);
    assert.equal(disabledProxy.observations.advances.length, 0);
    await disabledContext.close();
    disabledContext = null;

    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(context, proxy.origin, ownerCookie);
    const page = await context.newPage();
    page.on('pageerror', (error) =>
      proxy.observations.errors.push(error.message),
    );
    await page.goto(proxy.origin + '/dashboard/projects/' + scope.project.id, {
      waitUntil: 'networkidle',
    });
    await openGallery(page, scope.album.id, scope.album.name);

    const panel = page.getByTestId('matching-filename-index-panel');
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('heading', { name: '整理檔名比對資料', exact: true }),
    ).toBeVisible();
    await expect.poll(() => proxy.observations.capabilities.length).toBe(1);
    assert.equal(proxy.observations.capabilities[0].status, 200);
    assert.equal(proxy.observations.capabilities[0].expectedActor, owner);
    assert.deepEqual(proxy.observations.capabilities[0].body, {
      enabled: true,
    });
    await expect.poll(() => proxy.observations.statuses.length).toBe(1);
    const initialStatus = proxy.observations.statuses[0];
    assert.equal(initialStatus?.status, 200);
    assert.equal(initialStatus?.expectedActor, owner);
    assert.deepEqual(initialStatus?.body, {
      workspaceId: scope.workspace.id,
      projectId: scope.project.id,
      albumId: scope.album.id,
      profile: 'default-v1',
      indexedSessions: 30,
      missingSessions: expectedMissing,
      invalidSessions: 0,
      unlinkedVersions: 0,
      unreadyPhotos: 0,
      state: 'building',
    });
    await expect(countLocator(panel, '已索引工作階段')).toHaveText('30');
    await expect(countLocator(panel, '待建立工作階段')).toHaveText('1');
    await expect(
      panel.getByRole('button', { name: '建立下一批索引', exact: true }),
    ).toBeVisible();
    assert.equal(proxy.observations.advances.length, 0);

    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(
      panel.getByText('視窗重新取得焦點後，會重新載入索引狀態。'),
    ).toBeVisible();
    await expect(
      panel.getByText('待建立工作階段', { exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(countLocator(panel, '待建立工作階段')).toHaveText('1');
    await expect.poll(() => proxy.observations.statuses.length).toBe(2);

    const held = proxy.holdNextStatus();
    await panel
      .getByRole('button', { name: '重新整理索引狀態', exact: true })
      .click();
    const heldResponse = await held.captured;
    assert.equal(heldResponse.status, 200);
    assert.equal(heldResponse.expectedActor, owner);
    assert.equal(heldResponse.body.albumId, scope.album.id);
    await expect(
      panel.getByText('待建立工作階段', { exact: true }),
    ).toHaveCount(0);
    await db
      .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
      .bind(owner)
      .run();
    ownerNeedsRestore = true;
    held.release();
    await expect(panel.getByRole('alert')).toContainText(
      '管理者登入身分已變更或失效',
    );
    await expect(
      panel.getByText('待建立工作階段', { exact: true }),
    ).toHaveCount(0);
    await db
      .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
      .bind(owner)
      .run();
    ownerNeedsRestore = false;

    await panel
      .getByRole('button', { name: '重新整理索引狀態', exact: true })
      .click();
    await expect(countLocator(panel, '待建立工作階段')).toHaveText('1');
    const buildButton = panel.getByRole('button', {
      name: '建立下一批索引',
      exact: true,
    });
    await buildButton.click();
    await expect(
      panel.getByText('已就緒', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      panel.getByText(/實際比對仍會檢查完整歷史與上傳狀態/u),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: '建立下一批索引', exact: true }),
    ).toHaveCount(0);
    assert.equal(proxy.observations.advances.length, 1);
    assert.equal(proxy.observations.advances[0]?.status, 200);
    assert.equal(proxy.observations.advances[0]?.expectedActor, owner);
    assert.deepEqual(proxy.observations.advances[0]?.request, {});
    assert.equal(proxy.observations.advances[0]?.requestText, '{}');
    assert.equal(proxy.observations.advances[0]?.body.state, 'ready');
    await noMobileOverflow(page);
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/matching-filename-index-mobile.png',
    });

    await page
      .getByTestId('album-card-' + scope.album.id)
      .getByRole('button', {
        name: '收起照片 ' + scope.album.name,
        exact: true,
      })
      .click();
    await openGallery(page, blockerScope.album.id, blockerScope.album.name);
    const blockerPanel = page.getByTestId('matching-filename-index-panel');
    await expect(blockerPanel).toBeVisible();
    await expect(
      blockerPanel.getByRole('heading', {
        name: '整理檔名比對資料',
        exact: true,
      }),
    ).toBeVisible();
    await expect(blockerPanel.getByText(/索引目前受阻/u)).toBeVisible();
    await expect
      .poll(() =>
        proxy.observations.statuses.some(
          (record) => record.body?.albumId === blockerScope.album.id,
        ),
      )
      .toBe(true);
    await expect(countLocator(blockerPanel, '未連結版本')).toHaveText('1');
    await expect(countLocator(blockerPanel, '尚未就緒照片')).toHaveText('1');
    await expect(
      blockerPanel.getByRole('button', { name: '建立下一批索引', exact: true }),
    ).toHaveCount(0);
    const blockerStatus = proxy.observations.statuses.findLast(
      (record) => record.body?.albumId === blockerScope.album.id,
    );
    assert.equal(blockerStatus?.status, 200);
    assert.equal(blockerStatus?.expectedActor, owner);
    assert.deepEqual(blockerStatus?.body, {
      workspaceId: blockerScope.workspace.id,
      projectId: blockerScope.project.id,
      albumId: blockerScope.album.id,
      profile: 'default-v1',
      indexedSessions: 0,
      missingSessions: 0,
      invalidSessions: 0,
      unlinkedVersions: 1,
      unreadyPhotos: 1,
      state: 'blocked',
    });
    await noMobileOverflow(page);
    assert.deepEqual(proxy.observations.errors, []);

    return {
      disabledHidden: true,
      readyAfterOneBatch: true,
      batchPosts: proxy.observations.advances.length,
      mobileOverflow: false,
    };
  } finally {
    if (ownerNeedsRestore)
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner)
        .run();
    await context?.close();
    await disabledContext?.close();
    await proxy.close();
    await disabledProxy.close();
    await browser.close();
  }
}
