import { applyMigration } from './apply-migration.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeSignature } from 'better-auth/crypto';
import { chromium, expect } from '@playwright/test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { guestDownloadChecks } from './guest-downloads.mjs';

const temporary = await mkdtemp(
  join(tmpdir(), 'kino-version-approvals-browser-'),
);
const authSecret =
  'version-approvals-browser-isolated-secret-at-least-forty-characters';
const owner = randomUUID();
const ownerSessionId = randomUUID();
const ownerToken = randomUUID();
const bridgeErrors = [];
const deliveryResponses = [];
let worker;
let mf;

const server = createServer(async (incoming, outgoing) => {
  try {
    if (!worker) throw new Error('Isolated Miniflare Worker is not ready');
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (
        value !== undefined &&
        !['connection', 'content-length', 'host'].includes(name.toLowerCase())
      )
        headers.set(name, Array.isArray(value) ? value.join(',') : value);
    }
    headers.set('CF-Connecting-IP', '198.51.100.97');
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
      url.pathname.startsWith('/api/guest/albums/') &&
      url.pathname.includes('/deliveries/') &&
      url.pathname.includes('/assets/') &&
      url.pathname.endsWith('/download')
    ) {
      deliveryResponses.push({
        url: url.pathname + url.search,
        status: response.status,
        size: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
        contentType: response.headers.get('content-type'),
        contentDisposition: response.headers.get('content-disposition'),
      });
    }
    const responseHeaders = new Headers(response.headers);
    for (const name of [
      'connection',
      'content-length',
      'keep-alive',
      'transfer-encoding',
      'upgrade',
    ])
      responseHeaders.delete(name);
    outgoing.writeHead(
      response.status,
      Object.fromEntries(responseHeaders.entries()),
    );
    outgoing.end(body);
  } catch (error) {
    bridgeErrors.push(error instanceof Error ? error.message : String(error));
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  }
});

const port = await new Promise((resolvePort, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Loopback browser bridge did not receive a TCP port'));
      return;
    }
    resolvePort(address.port);
  });
});
const base = 'http://127.0.0.1:' + port;
const migrationDirectory = resolve('migrations');
const appBindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_SELECTION_ENABLED: 'true',
  GUEST_DOWNLOADS_ENABLED: 'true',
  GUEST_FEEDBACK_ENABLED: 'true',
  GUEST_SHARED_SELECTION_ENABLED: 'true',
  VERSION_APPROVALS_ENABLED: 'true',
  BETTER_AUTH_SECRET: authSecret,
  R2_ACCOUNT_ID: 'c'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-version-approvals-browser-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-never-for-production',
  R2_BUCKET_NAME: 'kino-version-approvals-browser-private',
};

function miniflareOptions(versionApprovalsEnabled, stateName) {
  return convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...appBindings,
          VERSION_APPROVALS_ENABLED: versionApprovalsEnabled ? 'true' : 'false',
          APPROVED_DELIVERIES_ENABLED: versionApprovalsEnabled
            ? 'true'
            : 'false',
        },
        d1Databases: { DB: 'version-approvals-browser-isolated' },
        r2Buckets: { PRIMARY_STORAGE: 'version-approvals-browser-isolated' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
      },
    ],
    d1Persist: join(temporary, 'd1-' + stateName),
    r2Persist: join(temporary, 'r2-' + stateName),
  });
}

function cookieParts(cookie) {
  const split = cookie.indexOf('=');
  assert.ok(split > 0);
  return { name: cookie.slice(0, split), value: cookie.slice(split + 1) };
}

async function browserContext(browser, cookie) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    acceptDownloads: true,
  });
  const { name, value } = cookieParts(cookie);
  await context.addCookies([
    {
      name,
      value,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  return { context, page };
}

async function openOwnerLightbox(page, fixture) {
  const document = await page.goto(
    base + '/dashboard/projects/' + encodeURIComponent(fixture.projectId),
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(document?.status(), 200);
  await expect(
    page.getByRole('heading', {
      name: 'Guest download fixture',
      exact: true,
    }),
  ).toBeVisible();
  const openAlbum = page
    .getByTestId('album-card-' + fixture.albumId)
    .getByRole('button', {
      name: '開啟相簿 Guest download album',
      exact: true,
    });
  await openAlbum.click();
  assert.equal(
    new URL(page.url()).searchParams.get('albumId'),
    fixture.albumId,
  );
  await page
    .getByRole('button', {
      name: '開啟照片預覽：' + fixture.sourceFilename,
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', {
      name: '相片詳情',
      level: 2,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('heading', {
      name: fixture.sourceFilename,
      level: 3,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '關閉', exact: true }),
  ).toBeVisible();
  return dialog;
}

async function openGuestLightbox(page, fixture) {
  const document = await page.goto(
    base + '/guest/albums/' + encodeURIComponent(fixture.albumId),
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(document?.status(), 200);
  await page
    .getByRole('button', {
      name: '檢視大圖 ' + fixture.sourceFilename,
      exact: true,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2').first()).toHaveText(fixture.sourceFilename);
  return dialog;
}

async function closeQuietly(value) {
  if (value) await value.close();
}

try {
  mf = new Miniflare(miniflareOptions(true, 'on'));
  const db = await mf.getD1Database('DB', 'app');
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  assert.ok(migrationFiles.includes('0054_version_approvals.sql'));
  for (const file of migrationFiles) {
    await applyMigration(
      db,
      (await readFile(join(migrationDirectory, file), 'utf8'))
        .split(/\r?\n/u)
        .filter((line) => line.trim() && !line.trim().startsWith('--'))
        .join(' '),
    );
  }

  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'version-approvals-browser-isolated-owner')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(ownerSessionId, ownerToken, owner, now + 3_600_000, now, now)
    .run();
  const ownerCookie =
    'kino-owner.session_token=' +
    encodeURIComponent(
      ownerToken + '.' + (await makeSignature(ownerToken, authSecret)),
    );
  worker = await mf.getWorker('app');
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const fixtureResult = await guestDownloadChecks({
    db,
    worker,
    request,
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    storage: await mf.getR2Bucket('PRIMARY_STORAGE', 'app'),
    fixtureOnly: true,
  });
  const fixture = fixtureResult.fixture;
  const headResponse = await request(
    '/api/v1/photos/' + fixture.photoId + '/versions',
    { headers: { Cookie: ownerCookie } },
  );
  const headPayload = await headResponse.json();
  assert.equal(
    headResponse.status,
    200,
    'Owner photo-version head API: ' + JSON.stringify(headPayload),
  );
  assert.equal(headPayload.photoId, fixture.photoId);
  assert.equal(headPayload.current.versionId, fixture.versionId);
  process.stdout.write(
    'passed: Owner photo-version head API returns the fixture current version\n',
  );
  const authorizedGuest = await fixture.createGuest(5);
  const originalAsset = await db
    .prepare(
      "SELECT id,byte_size,mime,checksum_sha256 FROM photo_assets WHERE version_id=? AND asset_kind='original'",
    )
    .bind(fixture.versionId)
    .first();
  assert.ok(originalAsset?.id && originalAsset.checksum_sha256);
  const pageErrors = [];

  const browser = await chromium.launch({ headless: true });
  let ownerContext;
  let guestContext;
  try {
    const ownerSession = await browserContext(browser, ownerCookie);
    ownerContext = ownerSession.context;
    const ownerPage = ownerSession.page;
    ownerPage.on('pageerror', (error) => pageErrors.push(error.message));
    const ownerDialog = await openOwnerLightbox(ownerPage, fixture);
    const ownerPanel = ownerPage.getByTestId('version-approvals-owner');
    await expect(ownerPanel).toBeVisible();
    await expect(ownerPanel).toContainText('選擇適用此相簿的有效邀請');
    const selectedInviteLabel = ownerPanel.locator('label').filter({
      hasText:
        '邀請 ' +
        authorizedGuest.inviteId.slice(0, 8) +
        '…' +
        authorizedGuest.inviteId.slice(-4),
    });
    await expect(selectedInviteLabel).toHaveCount(1);
    await selectedInviteLabel.getByRole('checkbox').check();
    await ownerPanel.getByLabel(/我確認要為/u).check();
    const createButton = ownerPanel.getByRole('button', {
      name: '建立確認請求',
      exact: true,
    });
    await expect(createButton).toBeEnabled();
    await createButton.click();
    await expect(
      ownerPanel.getByRole('status').filter({ hasText: '確認請求已建立' }),
    ).toBeVisible();

    const requestRow = await db
      .prepare(
        'SELECT id,version_id,head_revision FROM version_approval_requests WHERE photo_id=?',
      )
      .bind(fixture.photoId)
      .first();
    assert.ok(requestRow?.id);
    assert.equal(requestRow.version_id, fixture.versionId);
    assert.equal(requestRow.head_revision, 0);
    const requestMember = await db
      .prepare(
        'SELECT invite_id FROM version_approval_request_invites WHERE approval_request_id=?',
      )
      .bind(requestRow.id)
      .first();
    assert.equal(requestMember?.invite_id, authorizedGuest.inviteId);
    process.stdout.write(
      'passed: Owner Lightbox pins the current version to the selected invitation\n',
    );

    const guestSession = await browserContext(
      browser,
      'kino_guest=' + authorizedGuest.cookie,
    );
    guestContext = guestSession.context;
    const guestPage = guestSession.page;
    guestPage.on('pageerror', (error) => pageErrors.push(error.message));
    const initialReadPaths = [
      '/api/guest/feedback/capabilities',
      '/api/guest/albums/' + fixture.albumId + '/downloads',
      '/api/guest/albums/' + fixture.albumId + '/deliveries',
    ];
    const initialReadAttempts = new Map(
      initialReadPaths.map((path) => [path, 0]),
    );
    for (const path of initialReadPaths) {
      await guestPage.route(base + path, async (route) => {
        const attempt = initialReadAttempts.get(path) + 1;
        initialReadAttempts.set(path, attempt);
        if (attempt === 1) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'SERVICE_NOT_READY' } }),
          });
        } else await route.continue();
      });
    }
    const guestDialog = await openGuestLightbox(guestPage, fixture);
    await expect
      .poll(() => [...initialReadAttempts.values()])
      .toEqual([2, 2, 2]);
    await expect(
      guestPage.getByTestId('guest-download-photo').first(),
    ).toBeAttached();
    await expect(
      guestPage.getByTestId('approved-delivery-guest'),
    ).toContainText('目前沒有提供給此邀請的成品交付。');
    await expect(
      guestPage.getByText('訪客回饋暫時無法載入。', { exact: true }),
    ).toHaveCount(0);
    for (const path of initialReadPaths) await guestPage.unroute(base + path);
    process.stdout.write(
      'passed: Guest metadata reads recover once from transient503 without manual reload\n',
    );

    const guestPanel = guestPage.getByTestId('version-approvals-guest');
    await expect(guestPanel).toBeVisible();
    const guestItem = guestPanel.getByTestId('version-approvals-guest-item');
    await expect(guestItem).toHaveCount(1);
    await expect(guestItem).toContainText('版本 1');
    await expect(guestItem).toContainText('目前版本');
    const previewDisclosure = guestItem.locator('summary');
    await expect(previewDisclosure).toHaveText('查看指定版本預覽');
    await previewDisclosure.click();
    const versionPreview = guestItem.getByRole('img', {
      name: fixture.sourceFilename + '，版本 1',
      exact: true,
    });
    await expect(versionPreview).toBeVisible();
    await expect
      .poll(
        () =>
          versionPreview.evaluate((image) => {
            const element = image;
            return element.complete && element.naturalWidth > 0;
          }),
        { timeout: 15000 },
      )
      .toBe(true);
    const previewUrl = await versionPreview.getAttribute('src');
    assert.ok(previewUrl);
    assert.ok(
      new URL(previewUrl, base).pathname
        .toLowerCase()
        .includes('/versions/' + fixture.versionId.toLowerCase() + '/'),
      'Guest preview URL must name the request pinned version',
    );
    await guestItem
      .getByRole('checkbox', {
        name: '我已查看指定的第 1 版。',
        exact: true,
      })
      .check();
    const confirmButton = guestItem.getByRole('button', {
      name: '確認此固定版本',
      exact: true,
    });
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();
    await expect(guestPanel.getByRole('status')).toContainText(
      '固定版本的確認已記錄',
    );
    await expect(guestItem).toContainText('已有受邀訪客完成確認');

    const receipt = await db
      .prepare(
        'SELECT count(*) AS count FROM version_approval_receipts WHERE approval_request_id=?',
      )
      .bind(requestRow.id)
      .first();
    assert.equal(Number(receipt?.count), 1);
    const audit = await db
      .prepare(
        "SELECT count(*) AS count FROM audit_events WHERE action='version_approval.confirmed' AND actor_id=?",
      )
      .bind(authorizedGuest.guestId)
      .first();
    assert.equal(Number(audit?.count), 1);

    let failDeliveryReadOnce = true;
    await ownerPage.route('**/api/v1/albums/**', async (route) => {
      if (
        failDeliveryReadOnce &&
        route.request().method() === 'GET' &&
        new URL(route.request().url()).pathname.endsWith('/deliveries')
      ) {
        failDeliveryReadOnce = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'DELIVERY_UNAVAILABLE' } }),
        });
        return;
      }
      await route.continue();
    });
    const deliveryCapability = ownerPage.waitForResponse((response) => {
      return (
        new URL(response.url()).pathname === '/api/v1/deliveries/capabilities'
      );
    });
    await ownerPanel
      .getByRole('button', { name: '重新載入', exact: true })
      .click();
    await expect(
      ownerPanel.getByText('已有受邀訪客完成確認', { exact: false }),
    ).toBeVisible();
    assert.deepEqual(await (await deliveryCapability).json(), {
      enabled: true,
    });
    await expect(
      ownerPage.getByRole('button', { name: '重新載入交付狀態', exact: true }),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole('button', { name: '關閉', exact: true }),
    ).toBeEnabled();
    await expect(
      ownerPage.getByText('操作待確認', { exact: true }),
    ).toHaveCount(0);
    await ownerPage
      .getByRole('button', { name: '重新載入交付狀態', exact: true })
      .click();
    const ownerDeliveryPanel = ownerPage.getByTestId('approved-delivery-owner');
    await expect(ownerDeliveryPanel).toBeVisible();
    const deliveryRecipient = ownerDeliveryPanel.getByRole('checkbox').first();
    await expect(deliveryRecipient).toBeChecked();
    await deliveryRecipient.uncheck();
    await deliveryRecipient.check();
    await ownerDeliveryPanel
      .getByLabel(/將此已確認版本交付給本次指定客戶/u)
      .check();
    const publishDelivery = ownerDeliveryPanel.getByRole('button', {
      name: '交付已確認版本',
      exact: true,
    });
    await expect(publishDelivery).toBeEnabled();
    let failRecipientsOnce = true;
    await ownerPage.route('**/version-approvals/*/delivery', async (route) => {
      if (failRecipientsOnce && route.request().method() === 'POST') {
        failRecipientsOnce = false;
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'INVALID_DELIVERY_RECIPIENTS' },
          }),
        });
        return;
      }
      await route.continue();
    });
    await publishDelivery.click();
    await expect(
      ownerDeliveryPanel
        .getByRole('status')
        .filter({ hasText: '指定邀請已失效或不適用' }),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole('button', { name: '關閉', exact: true }),
    ).toBeEnabled();
    await expect(deliveryRecipient).toBeEnabled();
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='delivery.published'",
          )
          .first()
      ).n,
      0,
    );
    await deliveryRecipient.uncheck();
    await deliveryRecipient.check();
    await ownerDeliveryPanel
      .getByLabel(/將此已確認版本交付給本次指定客戶/u)
      .check();
    await expect(publishDelivery).toBeEnabled();
    await publishDelivery.click();
    await expect(ownerDeliveryPanel.getByRole('status')).toContainText(
      '已交付固定確認版本。',
    );
    await expect(ownerDeliveryPanel).toContainText('已交付');
    await ownerDeliveryPanel.screenshot({
      path: resolve('.local/approved-delivery-owner-mobile.png'),
    });

    const publication = await db
      .prepare(
        "SELECT event_id,after_json FROM audit_events WHERE action='delivery.published' AND actor_id=? AND photo_id=?",
      )
      .bind(owner, fixture.photoId)
      .first();
    assert.ok(publication?.event_id);
    const publishedManifest = JSON.parse(publication.after_json);
    assert.deepEqual(publishedManifest.inviteIds, [authorizedGuest.inviteId]);
    assert.equal(publishedManifest.item.asset.id, originalAsset.id);

    await guestDialog.getByRole('button', { name: '關閉預覽' }).click();
    await guestPage.reload({ waitUntil: 'networkidle' });
    const guestDeliveryPanel = guestPage.getByTestId('approved-delivery-guest');
    await expect(guestDeliveryPanel).toBeVisible();
    await expect(guestDeliveryPanel).toContainText('成品交付');
    await expect(guestDeliveryPanel).toContainText(fixture.sourceFilename);
    await expect(guestDeliveryPanel).toContainText('固定版本 1');
    const downloadLink = guestDeliveryPanel.getByRole('link', {
      name: '下載成品',
      exact: true,
    });
    const downloadHref = await downloadLink.getAttribute('href');
    assert.ok(downloadHref);
    const downloadUrl = new URL(downloadHref, base);
    assert.equal(downloadUrl.origin, base);
    assert.equal(
      downloadUrl.pathname,
      '/api/guest/albums/' +
        fixture.albumId +
        '/deliveries/' +
        publication.event_id +
        '/assets/' +
        originalAsset.id +
        '/download',
    );
    assert.match(
      downloadUrl.searchParams.get('requestId') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const previousDownloadCount = deliveryResponses.length;
    const [nativeDownload] = await Promise.all([
      guestPage.waitForEvent('download'),
      downloadLink.click(),
    ]);
    assert.equal(nativeDownload.suggestedFilename(), fixture.sourceFilename);
    const downloadedPath = await nativeDownload.path();
    assert.ok(downloadedPath, 'Chromium saved the delivered original file');
    const downloadedBytes = await readFile(downloadedPath);
    const downloadedSha = createHash('sha256')
      .update(downloadedBytes)
      .digest('hex');
    assert.equal(downloadedBytes.byteLength, originalAsset.byte_size);
    assert.equal(downloadedSha, originalAsset.checksum_sha256);
    assert.equal(deliveryResponses.length, previousDownloadCount + 1);
    const nativeResponse = deliveryResponses.at(-1);
    const nativeResponseUrl = new URL(nativeResponse.url, base);
    assert.equal(nativeResponseUrl.origin, base);
    assert.equal(nativeResponseUrl.pathname, downloadUrl.pathname);
    assert.match(
      nativeResponseUrl.searchParams.get('requestId') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.deepEqual(
      {
        status: nativeResponse.status,
        size: nativeResponse.size,
        sha256: nativeResponse.sha256,
        contentType: nativeResponse.contentType,
      },
      {
        status: 200,
        size: originalAsset.byte_size,
        sha256: originalAsset.checksum_sha256,
        contentType: originalAsset.mime,
      },
    );
    assert.equal(nativeResponse.sha256, downloadedSha);
    assert.match(nativeResponse.contentDisposition ?? '', /^attachment;/i);
    process.stdout.write(
      'passed: Owner publishes from the approved-delivery panel; Guest reloads and saves the exact original bytes\n',
    );
    process.stdout.write(
      'passed: Guest Lightbox views the pinned preview and confirms it; Owner sees confirmed\n',
    );
    await ownerDialog
      .getByRole('button', { name: '關閉', exact: true })
      .click();
  } finally {
    await closeQuietly(guestContext);
    await closeQuietly(ownerContext);
    await browser.close();
  }

  await mf.dispose();
  mf = new Miniflare(miniflareOptions(false, 'off'));
  worker = await mf.getWorker('app');
  const offDb = await mf.getD1Database('DB', 'app');
  for (const file of migrationFiles) {
    await applyMigration(
      offDb,
      await readFile(join(migrationDirectory, file), 'utf8'),
    );
  }
  await offDb
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'version-approvals-browser-isolated-owner')
    .run();
  const offNow = Date.now();
  await offDb
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(ownerSessionId, ownerToken, owner, offNow + 3_600_000, offNow, offNow)
    .run();
  const offFixtureResult = await guestDownloadChecks({
    db: offDb,
    worker,
    request: (path, init = {}) => mf.dispatchFetch(base + path, init),
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    storage: await mf.getR2Bucket('PRIMARY_STORAGE', 'app'),
    fixtureOnly: true,
  });
  const offFixture = offFixtureResult.fixture;
  const offGuest = offFixture.viewGuest;

  const offBrowser = await chromium.launch({ headless: true });
  let offOwnerContext;
  let offGuestContext;
  try {
    const ownerSession = await browserContext(offBrowser, ownerCookie);
    offOwnerContext = ownerSession.context;
    const ownerPage = ownerSession.page;
    ownerPage.on('pageerror', (error) => pageErrors.push(error.message));
    const ownerCapability = ownerPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/v1/version-approvals/capabilities';
    });
    await openOwnerLightbox(ownerPage, offFixture);
    const ownerCapabilityResponse = await ownerCapability;
    assert.deepEqual(await ownerCapabilityResponse.json(), { enabled: false });
    await expect(ownerPage.getByTestId('version-approvals-owner')).toHaveCount(
      0,
    );

    const guestSession = await browserContext(
      offBrowser,
      'kino_guest=' + offGuest.cookie,
    );
    offGuestContext = guestSession.context;
    const guestPage = guestSession.page;
    guestPage.on('pageerror', (error) => pageErrors.push(error.message));
    const guestCapability = guestPage.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/guest/version-approvals/capabilities';
    });
    await openGuestLightbox(guestPage, offFixture);
    const guestCapabilityResponse = await guestCapability;
    assert.deepEqual(await guestCapabilityResponse.json(), { enabled: false });
    await expect(guestPage.getByTestId('version-approvals-guest')).toHaveCount(
      0,
    );
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(bridgeErrors, []);
    process.stdout.write(
      'passed: local OFF hides Owner and Guest approval panels while capability reports disabled\n',
    );
  } finally {
    await closeQuietly(offGuestContext);
    await closeQuietly(offOwnerContext);
    await offBrowser.close();
  }
  process.stdout.write('Version approval focused browser checks passed: 5\n');
} finally {
  worker = undefined;
  if (mf) await mf.dispose();
  server.closeAllConnections?.();
  await new Promise((resolveClose) => server.close(resolveClose));
  const tempRoot = resolve(tmpdir());
  const tempPath = resolve(temporary);
  assert.ok(
    tempPath.startsWith(tempRoot + '\\') || tempPath.startsWith(tempRoot + '/'),
    'refusing to remove an isolated path outside the OS temp directory',
  );
  await rm(temporary, { recursive: true, force: true });
}
