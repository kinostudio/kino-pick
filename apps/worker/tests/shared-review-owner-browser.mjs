import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { chromium, expect } from '@playwright/test';
import {
  createIndependentActiveAlbum,
  createThreeVisiblePhotos,
  exchangeFreshGuest,
  issueTwoUseInvite,
  ownerFetch,
} from './selection-limit-guest-browser.mjs';

const OWNER_SHARED_DOWNLOAD_PATH =
  /^\/api\/v1\/albums\/[^/]+\/shared-reviews\/[^/]+\/submissions\/[^/]+\/download$/;

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

async function requestInit(incoming, { browserOrigin, workerOrigin } = {}) {
  const method = incoming.method();
  const headers = await incoming.allHeaders();
  if (browserOrigin && workerOrigin) {
    if (headers.origin === browserOrigin) headers.origin = workerOrigin;
    if (headers.host === new URL(browserOrigin).host)
      headers.host = new URL(workerOrigin).host;
  }
  const init = { method, headers, redirect: 'manual' };
  if (method !== 'GET' && method !== 'HEAD')
    init.body = incoming.postDataBuffer() ?? undefined;
  return init;
}

async function addOwnerCookie(context, base, ownerCookie) {
  const match = /kino-owner\.session_token=([^;]+)/.exec(
    ownerCookieHeader(ownerCookie),
  );
  assert.ok(match, 'synthetic Owner session cookie is available');
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: match[1],
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    },
  ]);
}

async function routeWorker(page, worker) {
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const response = await worker.fetch(
      new Request(incoming.url(), await requestInit(incoming)),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

async function createOwnerDownloadProxy(worker, base) {
  const hopByHopHeaders = new Set([
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
  let browserOrigin = null;
  const workerOrigin = new URL(base).origin;
  const server = createServer(async (incoming, outgoing) => {
    const parsed = new URL(incoming.url ?? '/', 'http://127.0.0.1');
    if (
      incoming.method !== 'GET' ||
      !OWNER_SHARED_DOWNLOAD_PATH.test(parsed.pathname)
    ) {
      outgoing.writeHead(404);
      outgoing.end();
      return;
    }

    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined || hopByHopHeaders.has(name)) continue;
        headers.set(
          name,
          Array.isArray(value)
            ? value.join(name === 'cookie' ? '; ' : ', ')
            : value,
        );
      }
      if (browserOrigin && headers.get('origin') === browserOrigin)
        headers.set('origin', workerOrigin);
      const target = new URL(parsed.pathname + parsed.search, base);
      const response = await worker.fetch(
        new Request(target, { method: 'GET', headers, redirect: 'manual' }),
      );
      const responseHeaders = Object.fromEntries(response.headers.entries());
      for (const name of [
        'connection',
        'keep-alive',
        'proxy-connection',
        'te',
        'trailer',
        'transfer-encoding',
        'upgrade',
      ]) {
        delete responseHeaders[name];
      }
      outgoing.writeHead(response.status, responseHeaders);
      if (response.body)
        await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
    } catch {
      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(502, {
          'content-type': 'text/plain; charset=utf-8',
        });
        outgoing.end('Download proxy request failed');
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(
    address && typeof address === 'object',
    'download proxy binds to a random loopback port',
  );
  browserOrigin = 'http://127.0.0.1:' + address.port;
  return {
    origin: browserOrigin,
    close: async () => {
      const closed = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function openReviewPanel(page, base, projectId, albumName) {
  await page.goto(base + '/dashboard/projects/' + projectId, {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('button', { name: '審查挑片 ' + albumName, exact: true })
    .click();
  return page.getByTestId('shared-review-panel');
}

function auditQuery(db, eventId) {
  return db
    .prepare(
      'SELECT event_id,action,actor_type FROM audit_events WHERE event_id=?',
    )
    .bind(eventId)
    .first();
}

async function ownerSharedReview(worker, base, ownerCookie, albumId, reviewId) {
  const response = await ownerFetch({
    worker,
    base,
    ownerCookie,
    path: '/api/v1/albums/' + albumId + '/shared-reviews',
    method: 'GET',
  });
  assert.equal(
    response.status,
    200,
    'current Owner can read shared review list',
  );
  const body = await response.json();
  const review = body.reviews.find((entry) => entry.id === reviewId);
  assert.ok(review, 'current list contains the expected shared review');
  return review;
}

async function guestRequest(worker, base, guest, path, method, body) {
  return worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers: {
        Accept: 'application/json',
        Origin: new URL(base).origin,
        Cookie: guest.cookieName + '=' + guest.cookieValue,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual',
    }),
  );
}

async function submitTwoSharedPicks({
  worker,
  base,
  albumId,
  reviewId,
  photos,
  inviteA,
  inviteB,
}) {
  const guestA = await exchangeFreshGuest({
    worker,
    base,
    invite: inviteA,
    albumId,
    address: '198.51.100.211',
    label: 'shared review A',
  });
  const guestB = await exchangeFreshGuest({
    worker,
    base,
    invite: inviteB,
    albumId,
    address: '198.51.100.212',
    label: 'shared review B',
  });
  assert.notEqual(
    guestA.guestId,
    guestB.guestId,
    'two explicit invites issue distinct Guest identities',
  );

  const metadataPath =
    '/api/guest/albums/' + albumId + '/shared-reviews/' + reviewId;
  const firstMetadata = await guestRequest(
    worker,
    base,
    guestA,
    metadataPath,
    'GET',
  );
  assert.equal(
    firstMetadata.status,
    200,
    'first invited Guest can read shared metadata',
  );
  const initial = await firstMetadata.json();
  assert.equal(
    initial.guestId,
    guestA.guestId,
    'shared metadata exposes only the current Guest identity witness',
  );
  assert.equal(initial.roundNo, 1);
  assert.equal(initial.status, 'open');
  const secondMetadataResponse = await guestRequest(
    worker,
    base,
    guestB,
    metadataPath,
    'GET',
  );
  assert.equal(
    secondMetadataResponse.status,
    200,
    'second invited Guest can read shared metadata',
  );
  const secondMetadata = await secondMetadataResponse.json();
  assert.equal(secondMetadata.guestId, guestB.guestId);

  for (const [guest, guestId, photo, label] of [
    [guestA, initial.guestId, photos[0], 'A'],
    [guestB, secondMetadata.guestId, photos[1], 'B'],
  ]) {
    const response = await guestRequest(
      worker,
      base,
      guest,
      '/api/guest/albums/' +
        albumId +
        '/shared-reviews/' +
        reviewId +
        '/photos/' +
        photo.photoId +
        '/selection',
      'PUT',
      {
        requestId: randomUUID(),
        expectedGuestId: guestId,
        roundNo: initial.roundNo,
        versionId: photo.versionId,
        selected: true,
      },
    );
    assert.equal(
      response.status,
      200,
      'Guest ' + label + ' can add a pick through the shared selection route',
    );
  }

  const currentResponse = await guestRequest(
    worker,
    base,
    guestA,
    metadataPath,
    'GET',
  );
  assert.equal(currentResponse.status, 200);
  const current = await currentResponse.json();
  assert.equal(current.guestId, guestA.guestId);
  assert.equal(
    current.selectedCount,
    2,
    'both Guest writes share one selected set',
  );
  assert.equal(current.canSubmitNow, true);

  const submitted = await guestRequest(
    worker,
    base,
    guestA,
    metadataPath + '/submit',
    'POST',
    {
      requestId: randomUUID(),
      expectedGuestId: current.guestId,
      roundNo: current.roundNo,
      expectedRevision: current.revision,
    },
  );
  assert.ok(
    submitted.ok,
    'a member submits the shared set through the actual Guest endpoint',
  );
  const submissionResult = await submitted.json();
  assert.equal(submissionResult.submission.selectedCount, 2);

  const selectionResponse = await guestRequest(
    worker,
    base,
    guestA,
    metadataPath + '/selection',
    'GET',
  );
  assert.equal(
    selectionResponse.status,
    200,
    'member can read the shared selection page',
  );
  const selectionPage = await selectionResponse.json();
  assert.deepEqual(
    new Set(selectionPage.items.map((item) => item.photoId)),
    new Set([photos[0].photoId, photos[1].photoId]),
  );
  return { guestA, guestB, submission: submissionResult.submission };
}

export async function runSharedReviewOwnerBrowserChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  db,
  galleryFixture,
}) {
  const album = await createIndependentActiveAlbum({
    worker,
    base,
    ownerCookie,
    db,
    galleryFixture,
  });
  const albumRow = await db
    .prepare('SELECT name FROM albums WHERE id=?')
    .bind(album.albumId)
    .first();
  assert.ok(
    albumRow?.name,
    'synthetic active album remains in the fixture project',
  );
  const privatePicksBefore = await db
    .prepare('SELECT count(*) AS n FROM guest_selection_state WHERE album_id=?')
    .bind(galleryFixture.context.album.id)
    .first();
  const photos = await createThreeVisiblePhotos({
    db,
    galleryFixture,
    albumId: album.albumId,
  });
  const inviteA = await issueTwoUseInvite({
    worker,
    base,
    ownerCookie,
    projectId: album.projectId,
    albumId: album.albumId,
  });
  const inviteB = await issueTwoUseInvite({
    worker,
    base,
    ownerCookie,
    projectId: album.projectId,
    albumId: album.albumId,
  });

  const disabledCapability = await disabledWorker.fetch(
    new Request(new URL('/api/guest/shared-reviews/capabilities', base)),
  );
  assert.equal(disabledCapability.status, 200);
  assert.deepEqual(await disabledCapability.json(), { enabled: false });
  const disabledOwnerList = await ownerFetch({
    worker: disabledWorker,
    base,
    ownerCookie,
    path: '/api/v1/albums/' + album.albumId + '/shared-reviews',
    method: 'GET',
  });
  assert.equal(
    disabledOwnerList.status,
    503,
    'Owner shared-review routes stay unavailable while the flag is off',
  );

  const browser = await chromium.launch({ headless: true });
  let downloadProxy = null;
  const createAttempts = [];
  const reopenAttempts = [];
  const controls = {
    dropCreate: false,
    create401: false,
    create403: false,
    dropReopen: false,
    reopen401: false,
  };
  let holdNextReviewList = false;
  let releaseHeldReviewList = () => {};
  let resolveHeldReviewListCaptured = () => {};
  const heldReviewListGate = new Promise((resolve) => {
    releaseHeldReviewList = resolve;
  });
  const heldReviewListCaptured = new Promise((resolve) => {
    resolveHeldReviewListCaptured = resolve;
  });
  let heldReviewListBody = null;
  try {
    downloadProxy = await createOwnerDownloadProxy(worker, base);
    const disabledContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(disabledContext, base, ownerCookie);
    const disabledPage = await disabledContext.newPage();
    await routeWorker(disabledPage, disabledWorker);
    const disabledPanel = await openReviewPanel(
      disabledPage,
      base,
      album.projectId,
      albumRow.name,
    );
    await expect(
      disabledPanel.getByTestId('shared-review-unavailable'),
    ).toBeVisible();
    await expect(disabledPanel.getByTestId('shared-review-create')).toHaveCount(
      0,
    );
    await disabledContext.close();

    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(context, downloadProxy.origin, ownerCookie);
    const page = await context.newPage();
    const createPath = '/api/v1/albums/' + album.albumId + '/shared-reviews';
    const browserOrigin = new URL(downloadProxy.origin).origin;
    const workerOrigin = new URL(base).origin;

    await page.route(
      (url) =>
        !(
          url.origin === browserOrigin &&
          OWNER_SHARED_DOWNLOAD_PATH.test(url.pathname)
        ),
      async (route) => {
        const incoming = route.request();
        const url = new URL(incoming.url());
        const method = incoming.method();
        const isCreate = method === 'POST' && url.pathname === createPath;
        const isReopen =
          method === 'POST' &&
          url.pathname.startsWith(createPath + '/') &&
          url.pathname.endsWith('/reopen');
        const isReviewList = method === 'GET' && url.pathname === createPath;
        const attempts = isCreate
          ? createAttempts
          : isReopen
            ? reopenAttempts
            : null;
        let attempt = null;
        if (attempts) {
          attempt = {
            body: incoming.postData() ?? '',
            status: 0,
            responseBody: null,
            dropped: false,
          };
          attempts.push(attempt);
          const denyWith401 =
            (isCreate && controls.create401) ||
            (isReopen && controls.reopen401);
          const denyWithOwner403 = isCreate && controls.create403;
          if (denyWith401 || denyWithOwner403) {
            if (isCreate && controls.create401) controls.create401 = false;
            else if (isCreate) controls.create403 = false;
            else controls.reopen401 = false;
            const status = denyWithOwner403 ? 403 : 401;
            attempt.status = status;
            await route.fulfill({
              status,
              contentType: 'application/json',
              body: JSON.stringify({ error: { code: 'OWNER_REQUIRED' } }),
            });
            return;
          }
        }
        const target = new URL(url.pathname + url.search, base);
        const response = await worker.fetch(
          new Request(
            target,
            await requestInit(incoming, { browserOrigin, workerOrigin }),
          ),
        );
        if (attempt) {
          attempt.status = response.status;
          if (response.ok)
            attempt.responseBody = await response
              .clone()
              .json()
              .catch(() => null);
          if (
            (isCreate && controls.dropCreate) ||
            (isReopen && controls.dropReopen)
          ) {
            if (isCreate) controls.dropCreate = false;
            else controls.dropReopen = false;
            assert.ok(
              response.ok,
              'the worker committed before the browser response is dropped',
            );
            attempt.dropped = true;
            await route.abort('failed');
            return;
          }
        }
        const fulfilled = {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: Buffer.from(await response.arrayBuffer()),
        };
        if (isReviewList && holdNextReviewList) {
          holdNextReviewList = false;
          heldReviewListBody = JSON.parse(fulfilled.body.toString('utf8'));
          resolveHeldReviewListCaptured();
          await heldReviewListGate;
        }
        await route.fulfill(fulfilled);
      },
    );

    const panel = await openReviewPanel(
      page,
      downloadProxy.origin,
      album.projectId,
      albumRow.name,
    );
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('shared-review-title')).toBeVisible();
    await expect(
      panel.getByTestId('shared-review-invite-' + inviteA.inviteId),
    ).toBeVisible();
    await expect(
      panel.getByTestId('shared-review-invite-' + inviteB.inviteId),
    ).toBeVisible();
    await expect(panel.getByTestId('shared-review-empty')).toBeVisible();
    holdNextReviewList = true;
    await panel
      .getByRole('button', { name: '重新整理共用挑片審查', exact: true })
      .click();
    await heldReviewListCaptured;
    assert.equal(
      heldReviewListBody.reviews.length,
      0,
      'held Owner list is the pre-create snapshot',
    );

    const title = '共用挑片審查 ' + album.albumId.slice(0, 8);
    await panel.getByTestId('shared-review-title').fill(title);
    const minInput = panel.getByTestId('shared-review-minimum');
    const maxInput = panel.getByTestId('shared-review-maximum');
    const create = panel.getByTestId('shared-review-create');

    await minInput.fill('0');
    await expect(
      panel.getByTestId('shared-review-create-validation'),
    ).toContainText('1 到 100000');
    await expect(create).toBeDisabled();
    await minInput.fill('2');
    await maxInput.fill('1');
    await expect(
      panel.getByTestId('shared-review-create-validation'),
    ).toContainText('最高張數不可少於');
    await expect(create).toBeDisabled();
    await maxInput.fill('3');
    await panel.getByTestId('shared-review-invite-' + inviteA.inviteId).check();
    await panel.getByTestId('shared-review-invite-' + inviteB.inviteId).check();
    await expect(
      panel.getByTestId('shared-review-invite-selected-count'),
    ).toContainText('2');
    await expect(create).toBeEnabled();

    const nextPage = panel.getByRole('button', {
      name: '下一頁邀請',
      exact: true,
    });
    if (await nextPage.isVisible().catch(() => false)) {
      await nextPage.click();
      await expect(
        panel.getByTestId('shared-review-invite-selected-count'),
      ).toContainText('2');
      await panel
        .getByRole('button', { name: '上一頁邀請', exact: true })
        .click();
      await expect(
        panel.getByTestId('shared-review-invite-' + inviteA.inviteId),
      ).toBeChecked();
      await expect(
        panel.getByTestId('shared-review-invite-' + inviteB.inviteId),
      ).toBeChecked();
    }

    await create.click();
    let dialog = page.getByRole('dialog', { name: '確認建立共用挑片審查？' });
    const cancel = dialog.getByRole('button', { name: '取消' });
    const confirm = dialog.getByTestId('shared-review-confirm-create');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    assert.equal(
      createAttempts.length,
      0,
      'closing confirmation does not create a review',
    );

    await create.click();
    dialog = page.getByRole('dialog', { name: '確認建立共用挑片審查？' });
    await expect(
      dialog.getByText(/查看照片、挑片及提交仍依各自權限/),
    ).toBeVisible();
    await expect(
      dialog.getByText(/不會匯入私人挑片、星等或收藏/),
    ).toBeVisible();
    controls.dropCreate = true;
    await dialog.getByTestId('shared-review-confirm-create').click();
    await expect(
      panel.getByTestId('shared-review-pending-status'),
    ).toBeVisible();
    await expect(dialog).toHaveCount(0);
    assert.equal(createAttempts.length, 1);
    assert.ok(
      createAttempts[0].status >= 200 && createAttempts[0].status < 300,
    );
    assert.equal(createAttempts[0].dropped, true);
    const exactCreateBody = createAttempts[0].body;
    const createIntent = JSON.parse(exactCreateBody);
    assert.match(createIntent.requestId, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(
      createIntent.inviteIds,
      [inviteA.inviteId, inviteB.inviteId].sort(),
    );
    assert.equal(createIntent.minimum, 2);
    assert.equal(createIntent.maximum, 3);
    assert.equal(createIntent.confirmShared, true);

    const trigger = page.getByRole('button', {
      name: '審查挑片 ' + albumRow.name,
      exact: true,
    });
    await trigger.click();
    await expect(panel).toBeHidden();
    await trigger.click();
    await expect(panel).toBeVisible();
    await expect(
      panel.getByTestId('shared-review-pending-status'),
    ).toBeVisible();

    const persisted = await ownerFetch({
      worker,
      base,
      ownerCookie,
      path: createPath,
      method: 'GET',
    });
    assert.equal(persisted.status, 200);
    const persistedBody = await persisted.json();
    const createdReview = persistedBody.reviews.find(
      (review) => review.title === title,
    );
    assert.ok(
      createdReview,
      'dropped create already committed exactly one subject',
    );

    const guestFixture = await submitTwoSharedPicks({
      worker,
      base,
      albumId: album.albumId,
      reviewId: createdReview.id,
      photos,
      inviteA,
      inviteB,
    });

    controls.create401 = true;
    await panel.getByTestId('shared-review-retry-pending').click();
    await expect(panel.getByText(/重新登入後/)).toBeVisible();
    assert.equal(createAttempts.length, 2);
    assert.equal(createAttempts[1].status, 401);
    assert.equal(createAttempts[1].body, exactCreateBody);
    controls.create403 = true;
    await panel.getByTestId('shared-review-retry-pending').click();
    await expect(
      panel.getByTestId('shared-review-pending-status'),
    ).toBeVisible();
    await expect(
      panel.getByTestId('shared-review-retry-pending'),
    ).toBeVisible();
    assert.equal(createAttempts.length, 3);
    assert.equal(createAttempts[2].status, 403);
    assert.equal(createAttempts[2].body, exactCreateBody);
    await panel.getByTestId('shared-review-retry-pending').click();
    await expect(
      panel.getByTestId('shared-review-' + createdReview.id),
    ).toBeVisible();
    assert.equal(createAttempts.length, 4);
    assert.equal(createAttempts[3].body, exactCreateBody);
    assert.ok(
      createAttempts[3].status >= 200 && createAttempts[3].status < 300,
    );
    releaseHeldReviewList();
    await expect(
      panel.getByTestId('shared-review-' + createdReview.id),
    ).toBeVisible();
    await expect(panel.getByTestId('shared-review-empty')).toHaveCount(0);

    const createCommand = await db
      .prepare(
        'SELECT count(*) AS n FROM shared_review_owner_commands WHERE request_id=?',
      )
      .bind(createIntent.requestId)
      .first();
    assert.equal(createCommand.n, 1, 'exact replay keeps one Owner command');
    const createAudit = await auditQuery(
      db,
      createAttempts[0].responseBody.eventId,
    );
    assert.ok(createAudit);
    assert.equal(createAudit.action, 'shared_review.created');
    assert.equal(createAudit.actor_type, 'user');
    const createAuditCount = await db
      .prepare('SELECT count(*) AS n FROM audit_events WHERE event_id=?')
      .bind(createAttempts[0].responseBody.eventId)
      .first();
    assert.equal(
      createAuditCount.n,
      1,
      'exact replay keeps one creation event',
    );
    const ownerListAfterCreate = await ownerFetch({
      worker,
      base,
      ownerCookie,
      path: createPath,
      method: 'GET',
    });
    const listAfterCreate = await ownerListAfterCreate.json();
    assert.equal(
      listAfterCreate.reviews.filter((review) => review.id === createdReview.id)
        .length,
      1,
    );

    const reviewCard = panel.getByTestId('shared-review-' + createdReview.id);
    await expect(reviewCard.getByText('第 1 輪 · 已提交')).toBeVisible();
    await reviewCard
      .getByTestId('shared-review-history-toggle-' + createdReview.id)
      .click();
    const history = panel.getByTestId(
      'shared-review-history-' + createdReview.id,
    );
    const submissionCard = history.getByTestId(
      'shared-review-submission-' + guestFixture.submission.id,
    );
    await expect(submissionCard).toBeVisible();
    await expect(submissionCard.getByText(/第 1 輪提交 · 2 張/)).toBeVisible();

    await submissionCard
      .getByTestId('shared-review-detail-toggle-' + guestFixture.submission.id)
      .click();
    const detail = submissionCard.getByTestId(
      'shared-review-detail-' + guestFixture.submission.id,
    );
    await expect(detail.getByText(photos[0].filename)).toBeVisible();
    await expect(detail.getByText(photos[1].filename)).toBeVisible();
    await expect(detail.getByText(/版本 v1/).first()).toBeVisible();

    for (const format of ['csv', 'txt', 'json']) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        submissionCard
          .getByTestId(
            'shared-review-export-' + format + '-' + guestFixture.submission.id,
          )
          .click(),
      ]);
      assert.ok(download.suggestedFilename().endsWith('.' + format));
      const path = await download.path();
      assert.ok(path, format + ' attachment downloaded');
      const contents = await readFile(path, 'utf8');
      if (format === 'json') {
        const parsed = JSON.parse(contents);
        const encoded = JSON.stringify(parsed);
        assert.ok(encoded.includes(guestFixture.submission.id));
        assert.ok(encoded.includes(photos[0].filename));
        assert.ok(encoded.includes(photos[1].filename));
      } else {
        assert.ok(contents.includes(photos[0].filename));
        assert.ok(contents.includes(photos[1].filename));
      }
    }

    const reopen = reviewCard.getByTestId(
      'shared-review-reopen-' + createdReview.id,
    );
    await reopen.click();
    const reopenDialog = page.getByRole('dialog', {
      name: '確認重開共用挑片？',
    });
    await expect(
      reopenDialog.getByText(/具挑片權限的受邀客戶可共同修改/),
    ).toBeVisible();
    const reopenMin = reopenDialog.getByTestId('shared-review-reopen-minimum');
    const reopenMax = reopenDialog.getByTestId('shared-review-reopen-maximum');
    const cancelReopen = reopenDialog.getByRole('button', { name: '取消' });
    const confirmReopen = reopenDialog.getByTestId(
      'shared-review-confirm-reopen',
    );
    await expect(cancelReopen).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirmReopen).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(reopenMin).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirmReopen).toBeFocused();
    await reopenMin.fill('1');
    await reopenMax.fill('3');
    await page.keyboard.press('Escape');
    await expect(reopenDialog).toHaveCount(0);
    assert.equal(
      reopenAttempts.length,
      0,
      'canceling reopen confirmation is a no-op',
    );

    await reopen.click();
    const confirmedReopenDialog = page.getByRole('dialog', {
      name: '確認重開共用挑片？',
    });
    await confirmedReopenDialog
      .getByTestId('shared-review-reopen-minimum')
      .fill('1');
    await confirmedReopenDialog
      .getByTestId('shared-review-reopen-maximum')
      .fill('3');
    controls.dropReopen = true;
    await confirmedReopenDialog
      .getByTestId('shared-review-confirm-reopen')
      .click();
    await expect(
      panel.getByTestId('shared-review-pending-status'),
    ).toBeVisible();
    await expect(confirmedReopenDialog).toHaveCount(0);
    assert.equal(reopenAttempts.length, 1);
    assert.ok(
      reopenAttempts[0].status >= 200 && reopenAttempts[0].status < 300,
    );
    const exactReopenBody = reopenAttempts[0].body;
    const reopenIntent = JSON.parse(exactReopenBody);
    assert.match(reopenIntent.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(reopenIntent.expectedRoundNo, 1);
    assert.equal(reopenIntent.minimum, 1);
    assert.equal(reopenIntent.maximum, 3);
    assert.equal(reopenIntent.confirmShared, true);
    controls.reopen401 = true;
    await panel.getByTestId('shared-review-retry-pending').click();
    await expect(panel.getByText(/重新登入後/)).toBeVisible();
    assert.equal(reopenAttempts.length, 2);
    assert.equal(reopenAttempts[1].status, 401);
    assert.equal(reopenAttempts[1].body, exactReopenBody);
    await panel.getByTestId('shared-review-retry-pending').click();
    await expect(reviewCard.getByText('第 2 輪 · 進行中')).toBeVisible();
    await expect(reviewCard.getByText(/已選 2 張/)).toBeVisible();
    assert.equal(reopenAttempts.length, 3);
    assert.equal(reopenAttempts[2].body, exactReopenBody);
    assert.ok(
      reopenAttempts[2].status >= 200 && reopenAttempts[2].status < 300,
    );

    const reopenCommand = await db
      .prepare(
        'SELECT count(*) AS n FROM shared_review_owner_commands WHERE request_id=?',
      )
      .bind(reopenIntent.requestId)
      .first();
    assert.equal(
      reopenCommand.n,
      1,
      'exact reopen replay keeps one Owner command',
    );
    const reopenAudit = await auditQuery(
      db,
      reopenAttempts[0].responseBody.eventId,
    );
    assert.ok(reopenAudit);
    assert.equal(reopenAudit.action, 'shared_review.reopened');
    assert.equal(reopenAudit.actor_type, 'user');
    const reopenAuditCount = await db
      .prepare('SELECT count(*) AS n FROM audit_events WHERE event_id=?')
      .bind(reopenAttempts[0].responseBody.eventId)
      .first();
    assert.equal(reopenAuditCount.n, 1, 'exact replay keeps one reopen event');
    const currentReview = await ownerSharedReview(
      worker,
      base,
      ownerCookie,
      album.albumId,
      createdReview.id,
    );
    assert.equal(currentReview.roundNo, 2);
    assert.equal(currentReview.status, 'open');
    assert.equal(currentReview.minimum, 1);
    assert.equal(currentReview.maximum, 3);
    assert.equal(currentReview.selectedCount, 2);
    const currentListResponse = await ownerFetch({
      worker,
      base,
      ownerCookie,
      path: createPath,
      method: 'GET',
    });
    const currentList = await currentListResponse.json();
    assert.equal(
      currentList.reviews.filter((review) => review.id === createdReview.id)
        .length,
      1,
    );

    const oldHistoryResponse = await guestRequest(
      worker,
      base,
      guestFixture.guestA,
      '/api/guest/albums/' +
        album.albumId +
        '/shared-reviews/' +
        createdReview.id +
        '/selection',
      'GET',
    );
    assert.equal(oldHistoryResponse.status, 200);
    const currentSelection = await oldHistoryResponse.json();
    assert.equal(currentSelection.review.roundNo, 2);
    assert.deepEqual(
      new Set(currentSelection.items.map((item) => item.photoId)),
      new Set([photos[0].photoId, photos[1].photoId]),
      'reopen keeps the current shared selection set',
    );
    assert.equal(currentSelection.review.guestId, guestFixture.guestA.guestId);
    const privatePicksAfter = await db
      .prepare(
        'SELECT count(*) AS n FROM guest_selection_state WHERE album_id=?',
      )
      .bind(galleryFixture.context.album.id)
      .first();
    assert.equal(
      privatePicksAfter.n,
      privatePicksBefore.n,
      'shared review fixture leaves existing private picks unchanged',
    );
    const historyToggle = reviewCard.getByTestId(
      'shared-review-history-toggle-' + createdReview.id,
    );
    await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
    await historyToggle.click();
    await expect(
      history.getByTestId(
        'shared-review-submission-' + guestFixture.submission.id,
      ),
    ).toBeVisible();
    await expect(detail.getByText(photos[0].filename)).toBeVisible();

    const resubmittedResponse = await guestRequest(
      worker,
      base,
      guestFixture.guestA,
      '/api/guest/albums/' +
        album.albumId +
        '/shared-reviews/' +
        createdReview.id +
        '/submit',
      'POST',
      {
        requestId: randomUUID(),
        expectedGuestId: currentSelection.review.guestId,
        roundNo: currentSelection.review.roundNo,
        expectedRevision: currentSelection.review.revision,
      },
    );
    assert.ok(
      resubmittedResponse.ok,
      'current Guest resubmits the retained shared picks in round two',
    );
    const resubmitted = (await resubmittedResponse.json()).submission;
    assert.equal(resubmitted.roundNo, 2);
    assert.equal(resubmitted.selectedCount, 2);
    assert.notEqual(resubmitted.id, guestFixture.submission.id);

    await panel
      .getByRole('button', { name: '重新整理共用挑片審查', exact: true })
      .click();
    await expect(reviewCard.getByText('第 2 輪 · 已提交')).toBeVisible();
    await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
    await historyToggle.click();
    await expect(
      history.getByTestId('shared-review-submission-' + resubmitted.id),
    ).toBeVisible();
    await expect(history.getByText(/第 2 輪提交 · 2 張/)).toBeVisible();

    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      true,
      'Owner shared review UI does not overflow a 375px viewport',
    );
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/shared-review-owner-mobile.png',
      fullPage: true,
    });

    await context.close();
  } finally {
    releaseHeldReviewList();
    try {
      await browser.close();
    } finally {
      if (downloadProxy) await downloadProxy.close();
    }
  }
}
