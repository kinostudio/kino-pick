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
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { pngFixture } from './image-fixtures.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';

const temporary = await mkdtemp(
  join(tmpdir(), 'kino-version-approvals-head-switch-'),
);
const authSecret =
  'version-approvals-head-switch-isolated-secret-at-least-forty-characters';
const owner = randomUUID();
const ownerSessionId = randomUUID();
const ownerToken = randomUUID();
const pageErrors = [];
const bridgeErrors = [];
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
const bindings = {
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
  R2_ACCOUNT_ID: 'd'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-version-approvals-head-switch-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-never-for-production',
  R2_BUCKET_NAME: 'kino-version-approvals-head-switch-private',
};

function miniflareOptions() {
  return convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        d1Databases: { DB: 'version-approvals-head-switch-isolated' },
        r2Buckets: {
          PRIMARY_STORAGE: 'version-approvals-head-switch-isolated',
        },
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
    d1Persist: join(temporary, 'd1'),
    r2Persist: join(temporary, 'r2'),
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
  });
  const { name, value } = cookieParts(cookie);
  await context.addCookies([
    { name, value, url: base, httpOnly: true, sameSite: 'Lax' },
  ]);
  return { context, page: await context.newPage() };
}

async function openLightbox(page, fixture, ownerPage = false) {
  const route = ownerPage
    ? '/dashboard/projects/' + encodeURIComponent(fixture.projectId)
    : '/guest/albums/' + encodeURIComponent(fixture.albumId);
  const document = await page.goto(base + route, { waitUntil: 'networkidle' });
  assert.equal(document?.status(), 200);
  if (ownerPage)
    await expect(
      page.getByRole('heading', {
        name: 'Guest download fixture',
        exact: true,
      }),
    ).toBeVisible();
  await page
    .getByRole('button', {
      name: ownerPage
        ? '查看照片 Guest download album'
        : '檢視大圖 ' + fixture.sourceFilename,
      exact: true,
    })
    .click();
  if (ownerPage)
    await page
      .getByRole('button', {
        name: '開啟照片預覽：' + fixture.sourceFilename,
        exact: true,
      })
      .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2').first()).toHaveText(fixture.sourceFilename);
  return dialog;
}

async function jsonAt(response, status, label) {
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  assert.equal(response.status, status, label + ': ' + JSON.stringify(value));
  return value;
}

async function errorAt(response, status, code, label) {
  const value = await jsonAt(response, status, label);
  assert.deepEqual(value, { error: { code } }, label);
}

async function closeQuietly(value) {
  if (value) await value.close();
}

const count = async (db, table, where = '', ...values) => {
  const row = await db
    .prepare('SELECT count(*) AS count FROM ' + table + where)
    .bind(...values)
    .first();
  return Number(row.count);
};
const guestApprovalPath = (albumId, photoId) =>
  '/api/guest/albums/' + albumId + '/photos/' + photoId + '/version-approvals';
const guestConfirmPath = (albumId, photoId, approvalId) =>
  guestApprovalPath(albumId, photoId) + '/' + approvalId + '/confirm';
const guestPreviewPath = (photoId, versionId) =>
  '/api/guest/photos/' + photoId + '/versions/' + versionId + '/assets/preview';

try {
  mf = new Miniflare(miniflareOptions());
  const db = await mf.getD1Database('DB', 'app');
  const migrations = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  assert.ok(migrations.includes('0054_version_approvals.sql'));
  for (const file of migrations) {
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
    .bind(owner, 'version-approvals-head-switch-isolated-owner')
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
  const ownerHeaders = {
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
  };
  worker = await mf.getWorker('app');
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
  const fixtureResult = await guestDownloadChecks({
    db,
    worker,
    request,
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    storage,
    fixtureOnly: true,
  });
  const fixture = fixtureResult.fixture;
  const viewOnlyGuest = fixture.viewGuest;
  const compareGuest = await fixture.createGuest(2049);
  const v2Bytes = pngFixture();
  const v2Hash = createHash('sha256').update(v2Bytes).digest('hex');
  const v2Id = randomUUID();
  const v2 = await appendAuthorizedVersionFixture({
    db,
    owner,
    photoId: fixture.photoId,
    versionId: v2Id,
    parentVersionId: fixture.versionId,
    versionNo: 2,
    sha256: v2Hash,
    byteSize: v2Bytes.byteLength,
    mime: 'image/png',
    width: 1,
    height: 1,
  });
  assert.equal(v2.version_id, v2Id);
  await storage.put(v2.objectKey, new Uint8Array(v2Bytes), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: v2Hash,
  });
  const v2Processing = await runImageProcessingJob({
    jobId: v2.asset_id,
    jobs: new D1ImageProcessingRepository(db),
    objects: new R2ProcessingObjectStore(storage),
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(v2Processing.status, 'succeeded');
  const beforeHead = await request(
    '/api/v1/photos/' + fixture.photoId + '/versions',
    { headers: { Cookie: ownerCookie } },
  );
  const versions = await jsonAt(beforeHead, 200, 'Owner V1 head');
  assert.equal(versions.current.versionId, fixture.versionId);
  assert.equal(versions.current.revision, 0);

  const browser = await chromium.launch({ headless: true });
  let ownerContext;
  let viewContext;
  let compareContext;
  try {
    const ownerSession = await browserContext(browser, ownerCookie);
    ownerContext = ownerSession.context;
    const ownerPage = ownerSession.page;
    ownerPage.on('pageerror', (error) => pageErrors.push(error.message));
    const ownerDialog = await openLightbox(ownerPage, fixture, true);
    const ownerPanel = ownerPage.getByTestId('version-approvals-owner');
    await expect(ownerPanel).toBeVisible();
    await expect(ownerPanel).toContainText('選擇適用此相簿的有效邀請');
    const inviteLabel = (guest) =>
      ownerPanel.locator('label').filter({
        hasText:
          '邀請 ' + guest.inviteId.slice(0, 8) + '…' + guest.inviteId.slice(-4),
      });
    const viewLabel = inviteLabel(viewOnlyGuest);
    const compareLabel = inviteLabel(compareGuest);
    await expect(viewLabel).toHaveCount(1);
    await expect(compareLabel).toHaveCount(1);

    await viewLabel.getByRole('checkbox').check();
    await expect(ownerPanel.getByRole('status')).toContainText(
      '部分受邀客戶只能查看目前版本',
    );
    await expect(ownerPanel.getByRole('status')).toContainText('若照片先更新');
    await compareLabel.getByRole('checkbox').check();
    await ownerPanel.getByLabel(/我確認要為/u).check();
    await ownerPanel
      .getByRole('button', { name: '建立確認請求', exact: true })
      .click();
    await expect(ownerPanel).toContainText('確認請求已建立');

    const approval = await db
      .prepare(
        'SELECT id,version_id,version_no,head_revision FROM version_approval_requests WHERE photo_id=?',
      )
      .bind(fixture.photoId)
      .first();
    assert.ok(approval?.id);
    assert.equal(approval.version_id, fixture.versionId);
    assert.equal(Number(approval.version_no), 1);
    assert.equal(Number(approval.head_revision), 0);
    const members = await db
      .prepare(
        'SELECT invite_id FROM version_approval_request_invites WHERE approval_request_id=? ORDER BY invite_id',
      )
      .bind(approval.id)
      .all();
    assert.deepEqual(
      members.results.map((row) => row.invite_id),
      [viewOnlyGuest.inviteId, compareGuest.inviteId].sort(),
    );
    assert.equal(
      await count(
        db,
        'version_approval_receipts',
        ' WHERE approval_request_id=?',
        approval.id,
      ),
      0,
    );

    const viewSession = await browserContext(
      browser,
      'kino_guest=' + viewOnlyGuest.cookie,
    );
    viewContext = viewSession.context;
    const viewPage = viewSession.page;
    viewPage.on('pageerror', (error) => pageErrors.push(error.message));
    const viewDialog = await openLightbox(viewPage, fixture);
    const viewPanel = viewPage.getByTestId('version-approvals-guest');
    await expect(viewPanel).toBeVisible();
    const viewItem = viewPanel.getByTestId('version-approvals-guest-item');
    await expect(viewItem).toHaveCount(1);
    await expect(viewItem).toContainText('版本 1');
    await expect(viewItem).toContainText('目前版本');

    const compareSession = await browserContext(
      browser,
      'kino_guest=' + compareGuest.cookie,
    );
    compareContext = compareSession.context;
    const comparePage = compareSession.page;
    comparePage.on('pageerror', (error) => pageErrors.push(error.message));
    const compareDialog = await openLightbox(comparePage, fixture);
    const comparePanel = comparePage.getByTestId('version-approvals-guest');
    await expect(comparePanel).toBeVisible();
    const compareItemNow = comparePanel.getByTestId(
      'version-approvals-guest-item',
    );
    await expect(compareItemNow).toHaveCount(1);
    await expect(compareItemNow).toContainText('目前版本');

    const oldPreviewPath = guestPreviewPath(fixture.photoId, fixture.versionId);
    const currentViewPreview = await request(oldPreviewPath, {
      headers: { Cookie: 'kino_guest=' + viewOnlyGuest.cookie },
    });
    assert.equal(
      currentViewPreview.status,
      200,
      'View-only Guest can preview V1 while V1 is current',
    );
    assert.ok((await currentViewPreview.arrayBuffer()).byteLength > 0);
    const currentViewList = await jsonAt(
      await request(guestApprovalPath(fixture.albumId, fixture.photoId), {
        headers: { Cookie: 'kino_guest=' + viewOnlyGuest.cookie },
      }),
      200,
      'View-only Guest list while V1 is current',
    );
    assert.equal(currentViewList.requests.length, 1);
    assert.equal(currentViewList.requests[0].id, approval.id);
    assert.equal(currentViewList.requests[0].isCurrent, true);

    const switchResponse = await request(
      '/api/v1/photos/' + fixture.photoId + '/versions/set-current',
      {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedRevision: 0,
          expectedCurrentVersionId: fixture.versionId,
          versionId: v2Id,
          confirm: true,
        }),
      },
    );
    await jsonAt(switchResponse, 200, 'Owner switches head to V2');
    const head = await db
      .prepare(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(fixture.photoId)
      .first();
    assert.equal(head.version_id, v2Id);
    assert.equal(Number(head.revision), 1);
    assert.equal(
      await count(
        db,
        'version_approval_receipts',
        ' WHERE approval_request_id=?',
        approval.id,
      ),
      0,
      'Switching the head leaves the fixed V1 request unconfirmed',
    );

    const viewList = await jsonAt(
      await request(guestApprovalPath(fixture.albumId, fixture.photoId), {
        headers: { Cookie: 'kino_guest=' + viewOnlyGuest.cookie },
      }),
      200,
      'View-only Guest list after the head switches',
    );
    assert.deepEqual(viewList, { requests: [], nextCursor: null });
    await errorAt(
      await request(oldPreviewPath, {
        headers: { Cookie: 'kino_guest=' + viewOnlyGuest.cookie },
      }),
      401,
      'GUEST_ACCESS_REQUIRED',
      'View-only Guest historical V1 preview',
    );
    const deniedRequestId = randomUUID();
    await errorAt(
      await request(
        guestConfirmPath(fixture.albumId, fixture.photoId, approval.id),
        {
          method: 'POST',
          headers: {
            Cookie: 'kino_guest=' + viewOnlyGuest.cookie,
            Origin: base,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: deniedRequestId,
            expectedGuestId: viewOnlyGuest.guestId,
            confirm: true,
          }),
        },
      ),
      401,
      'GUEST_ACCESS_REQUIRED',
      'View-only Guest historical V1 confirmation',
    );
    assert.equal(
      await count(
        db,
        'version_approval_guest_commands',
        ' WHERE guest_id=? AND request_id=?',
        viewOnlyGuest.guestId,
        deniedRequestId,
      ),
      0,
    );
    assert.equal(
      await count(
        db,
        'version_approval_receipts',
        ' WHERE approval_request_id=?',
        approval.id,
      ),
      0,
    );

    const compareList = await jsonAt(
      await request(guestApprovalPath(fixture.albumId, fixture.photoId), {
        headers: { Cookie: 'kino_guest=' + compareGuest.cookie },
      }),
      200,
      'View-and-compare Guest list after the head switches',
    );
    assert.equal(compareList.requests.length, 1);
    assert.equal(compareList.requests[0].id, approval.id);
    assert.equal(compareList.requests[0].versionId, fixture.versionId);
    assert.equal(compareList.requests[0].versionNo, 1);
    assert.equal(compareList.requests[0].status, 'open');
    assert.equal(compareList.requests[0].isCurrent, false);
    const comparePreview = await request(oldPreviewPath, {
      headers: { Cookie: 'kino_guest=' + compareGuest.cookie },
    });
    assert.equal(comparePreview.status, 200);
    assert.equal(comparePreview.headers.get('content-type'), 'image/jpeg');
    assert.ok((await comparePreview.arrayBuffer()).byteLength > 0);

    await viewPanel
      .getByRole('button', { name: '重新載入', exact: true })
      .click();
    await expect(viewItem).toHaveCount(0);
    await expect(viewPanel).toContainText('目前沒有可確認的版本。');
    await expect(
      viewPanel.getByRole('button', {
        name: '確認此固定版本',
        exact: true,
      }),
    ).toHaveCount(0);

    await comparePanel
      .getByRole('button', { name: '重新載入', exact: true })
      .click();
    const compareItem = comparePanel.getByTestId(
      'version-approvals-guest-item',
    );
    await expect(compareItem).toHaveCount(1);
    await expect(compareItem).toContainText('版本 1');
    await expect(compareItem).toContainText('歷史版本');
    await expect(compareItem).toContainText('等待受邀訪客確認');
    await compareItem.locator('summary').click();
    const versionPreview = compareItem.getByRole('img', {
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
    const src = await versionPreview.getAttribute('src');
    assert.ok(src);
    assert.ok(
      new URL(src, base).pathname
        .toLowerCase()
        .includes('/versions/' + fixture.versionId.toLowerCase() + '/'),
      'Compare Guest preview stays pinned to V1',
    );
    await compareItem
      .getByRole('checkbox', {
        name: '我已查看指定的第 1 版。',
        exact: true,
      })
      .check();
    const confirm = compareItem.getByRole('button', {
      name: '確認此固定版本',
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(comparePanel).toContainText('固定版本的確認已記錄');
    await expect(compareItem).toContainText('已有受邀訪客完成確認');

    const receipt = await db
      .prepare(
        'SELECT guest_id,version_id,head_revision FROM version_approval_receipts WHERE approval_request_id=?',
      )
      .bind(approval.id)
      .first();
    assert.equal(receipt?.guest_id, compareGuest.guestId);
    assert.equal(receipt?.version_id, fixture.versionId);
    assert.equal(Number(receipt?.head_revision), 0);
    const finalHead = await db
      .prepare(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(fixture.photoId)
      .first();
    assert.equal(finalHead.version_id, v2Id);
    assert.equal(Number(finalHead.revision), 1);

    const ownerList = await jsonAt(
      await request(
        '/api/v1/albums/' +
          fixture.albumId +
          '/photos/' +
          fixture.photoId +
          '/version-approvals',
        { headers: { Cookie: ownerCookie } },
      ),
      200,
      'Owner list after Guest confirms historical V1',
    );
    assert.equal(ownerList.requests.length, 1);
    assert.equal(ownerList.requests[0].versionId, fixture.versionId);
    assert.equal(ownerList.requests[0].status, 'confirmed');
    assert.equal(ownerList.requests[0].isCurrent, false);
    await ownerPanel
      .getByRole('button', { name: '重新載入', exact: true })
      .click();
    await expect(ownerPanel).toContainText('已有受邀訪客完成確認');

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(bridgeErrors, []);
    process.stdout.write(
      'passed: view-only is blocked from historical V1; compare Guest confirms fixed V1 after V2 becomes current; Owner view-only warning is visible\n',
    );
    await viewDialog.getByRole('button', { name: '關閉預覽' }).click();
    await compareDialog.getByRole('button', { name: '關閉預覽' }).click();
    await ownerDialog
      .getByRole('button', { name: '關閉', exact: true })
      .click();
  } finally {
    await closeQuietly(compareContext);
    await closeQuietly(viewContext);
    await closeQuietly(ownerContext);
    await browser.close();
  }
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
