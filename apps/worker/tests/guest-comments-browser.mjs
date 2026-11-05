import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const canSelectBit = 8;
const selectionTables = [
  'guest_selection_state',
  'guest_selection_commands',
  'guest_selection_results',
  'guest_selection_round_state',
  'guest_selection_submissions',
  'guest_selection_submission_items',
  'guest_selection_submission_results',
  'guest_selection_submission_seals',
];

function guestCookieName(base) {
  return new URL(base).protocol === 'https:'
    ? '__Host-kino_guest'
    : 'kino_guest';
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

function cookieNames(header) {
  return (header ?? '')
    .split(';')
    .map((part) => part.split('=', 1)[0]?.trim())
    .filter(Boolean)
    .sort();
}

function commentsPath(albumId, photoId, versionId) {
  return (
    '/api/guest/albums/' +
    encodeURIComponent(albumId) +
    '/photos/' +
    encodeURIComponent(photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/comments'
  );
}

function commandPath(albumId) {
  return (
    '/api/guest/albums/' + encodeURIComponent(albumId) + '/comments/commands'
  );
}

function guestSessionHash(secret) {
  return createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
}

async function createGuestBrowser({ browser, worker, base, albumId, secret }) {
  const cookieName = guestCookieName(base);
  const secure = new URL(base).protocol === 'https:';
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  const setGuestCookie = async (value) => {
    await context.addCookies([
      {
        name: cookieName,
        value,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
        secure,
      },
    ]);
  };
  await setGuestCookie(secret);

  const page = await context.newPage();
  const observations = {
    requests: [],
    capabilities: [],
    access: [],
    gallery: [],
    versions: [],
    comments: [],
    commentPosts: [],
    assets: [],
    pageErrors: [],
    bridgeErrors: [],
  };
  let sequence = 0;
  let dropNextCommentPost = false;
  let holdNextCommentPost = null;
  let deferNextCommentPost = null;

  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (url.origin !== new URL(base).origin) {
      await route.continue();
      return;
    }

    const method = incoming.method();
    const headers = await incoming.allHeaders();
    const cookieHeader = headers.cookie ?? '';
    headers['cf-connecting-ip'] = '198.51.100.119';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = incoming.postDataBuffer() ?? undefined;
    }

    const isCommentPost =
      method === 'POST' && url.pathname === commandPath(albumId);
    if (isCommentPost && deferNextCommentPost) {
      const deferred = deferNextCommentPost;
      deferNextCommentPost = null;
      deferred.resolveReceived(
        parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0)),
      );
      await deferred.release;
    }

    let response;
    try {
      response = await worker.fetch(new Request(incoming.url(), init));
    } catch (error) {
      observations.bridgeErrors.push(
        error instanceof Error ? error.message : String(error),
      );
      await route.abort('failed');
      return;
    }

    const responseBytes = Buffer.from(await response.arrayBuffer());
    const record = {
      sequence: ++sequence,
      method,
      pathname: url.pathname,
      search: url.search,
      status: response.status,
      body: parseJson(responseBytes),
      requestBody: parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0)),
      cookieNames: cookieNames(cookieHeader),
    };
    observations.requests.push(record);

    if (
      method === 'GET' &&
      url.pathname === '/api/guest/comments/capabilities'
    ) {
      observations.capabilities.push(record);
    }
    if (
      method === 'GET' &&
      url.pathname === '/api/guest/albums/' + albumId + '/access'
    ) {
      observations.access.push(record);
    }
    if (
      method === 'GET' &&
      url.pathname === '/api/guest/albums/' + albumId + '/photos'
    ) {
      observations.gallery.push(record);
    }
    if (
      method === 'GET' &&
      new RegExp(
        '^/api/guest/albums/' + albumId + '/photos/([^/]+)/versions$',
        'u',
      ).test(url.pathname)
    ) {
      observations.versions.push(record);
    }
    if (
      method === 'GET' &&
      new RegExp(
        '^/api/guest/albums/' +
          albumId +
          '/photos/([^/]+)/versions/([^/]+)/comments$',
        'u',
      ).test(url.pathname)
    ) {
      observations.comments.push(record);
    }

    const assetMatch =
      method === 'GET' &&
      /^\/api\/guest\/photos\/([^/]+)\/versions\/([^/]+)\/assets\/(thumbnail|preview)$/u.exec(
        url.pathname,
      );
    if (assetMatch) {
      observations.assets.push({
        pathname: url.pathname,
        photoId: assetMatch[1],
        versionId: assetMatch[2],
        kind: assetMatch[3],
        status: response.status,
        contentType: response.headers.get('content-type'),
        byteLength: responseBytes.byteLength,
        sha256: createHash('sha256').update(responseBytes).digest('hex'),
      });
    }

    if (isCommentPost) {
      observations.commentPosts.push(record);
      const hold = holdNextCommentPost;
      if (hold) holdNextCommentPost = null;
      if (hold) {
        hold.resolveCommitted(record);
        await hold.release;
        if (hold.dropAfterRelease && response.status === 200) {
          await route.abort('failed');
          return;
        }
      }
      if (dropNextCommentPost && response.status === 200) {
        dropNextCommentPost = false;
        await route.abort('failed');
        return;
      }
    }

    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBytes,
    });
  });

  return {
    context,
    page,
    observations,
    cookieName,
    setGuestCookie,
    dropNextCommentPost() {
      dropNextCommentPost = true;
    },
    holdNextCommentPost({ dropAfterRelease = false } = {}) {
      let resolveCommitted;
      let release;
      const committed = new Promise((resolve) => {
        resolveCommitted = resolve;
      });
      const waiting = new Promise((resolve) => {
        release = resolve;
      });
      holdNextCommentPost = {
        resolveCommitted,
        release: waiting,
        dropAfterRelease,
      };
      return { committed, release };
    },
    deferNextCommentPost() {
      let resolveReceived;
      let release;
      const received = new Promise((resolve) => {
        resolveReceived = resolve;
      });
      const waiting = new Promise((resolve) => {
        release = resolve;
      });
      deferNextCommentPost = { resolveReceived, release: waiting };
      return { received, release };
    },
    async close() {
      await context.close();
    },
  };
}

function targetPhotoButton(page, filename) {
  return page.getByRole('list', { name: '相簿照片列表' }).getByRole('button', {
    name: '檢視大圖 ' + filename,
    exact: true,
  });
}

function renderedCommentBody(page, commentId, body) {
  return page
    .getByTestId('comment-item-' + commentId)
    .locator('p.whitespace-pre-wrap')
    .getByText(body, { exact: true });
}

async function openGuestGallery(page, base, albumId) {
  const response = await page.goto(
    new URL('/guest/albums/' + encodeURIComponent(albumId), base).href,
    { waitUntil: 'networkidle' },
  );
  assert.equal(response?.status(), 200);
  await expect(
    page.getByRole('heading', { name: /^Kino Pick (?:線上挑片|相簿)$/u }),
  ).toBeVisible();
  const batchDisclosure = page.locator(
    'details.guest-batch-comment-disclosure',
  );
  if ((await batchDisclosure.getAttribute('open')) === null)
    await batchDisclosure.locator('summary').click();
  await expect(page.getByTestId('guest-batch-comment-composer')).toBeVisible();
}

async function openCommentPanel(page, filename, recovery = false) {
  const photoButton = targetPhotoButton(page, filename);
  await expect(photoButton).toBeVisible();
  await photoButton.click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2').first()).toHaveText(filename);
  const compareButton = page.getByTestId('guest-compare-open');
  await expect(compareButton).toBeVisible();
  await compareButton.click();
  await expect(page.getByTestId('guest-version-comparison')).toBeVisible();
  await expect(page.getByTestId('guest-comments-panel')).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByTestId('guest-comments-panel')
        .getByTestId(recovery ? 'comment-recovery-body' : 'comment-body')
        .count(),
    )
    .toBe(1);
  return dialog;
}

async function selectCommentComparisonPair(page, currentVersionId, versionId) {
  const before = page.getByTestId('compare-before');
  const after = page.getByTestId('compare-after');
  const beforeOptions = await before
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => option.value).filter(Boolean),
    );
  const detourVersionId = beforeOptions.find(
    (candidate) => candidate !== currentVersionId && candidate !== versionId,
  );
  assert.ok(
    detourVersionId,
    'A third loaded version lets the selectors form the requested historical pair',
  );
  await before.selectOption(detourVersionId);
  await after.selectOption(versionId);
  await before.selectOption(currentVersionId);
  await expect(before).toHaveValue(currentVersionId);
  await expect(after).toHaveValue(versionId);
}

async function waitForCommentPost(state, requestId, status = 200) {
  await expect
    .poll(
      () =>
        state.observations.commentPosts.filter(
          (item) =>
            item.requestBody?.requestId === requestId && item.status === status,
        ).length,
    )
    .toBeGreaterThan(0);
  return state.observations.commentPosts.find(
    (item) =>
      item.requestBody?.requestId === requestId && item.status === status,
  );
}

async function pageJson(page, pathname) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }, pathname);
}

async function workerCommand({ worker, base, albumId, secret, input }) {
  const cookieName = guestCookieName(base);
  return worker.fetch(
    new Request(new URL(commandPath(albumId), base), {
      method: 'POST',
      headers: {
        Origin: new URL(base).origin,
        Cookie: cookieName + '=' + secret,
        'Content-Type': 'application/json',
        'cf-connecting-ip': '198.51.100.120',
      },
      body: JSON.stringify(input),
      redirect: 'manual',
    }),
  );
}

async function tableCounts(db, tables) {
  const result = {};
  for (const table of tables) {
    const row = await db.prepare('SELECT count(*) AS n FROM ' + table).first();
    result[table] = row?.n ?? null;
  }
  return result;
}

async function commentCounts(db, guestId, requestId) {
  const [commands, results, changes, comments] = await Promise.all([
    db
      .prepare(
        'SELECT count(*) AS n FROM guest_comment_commands WHERE guest_id=? AND request_id=?',
      )
      .bind(guestId, requestId)
      .first(),
    db
      .prepare(
        'SELECT count(*) AS n FROM guest_comment_results WHERE guest_id=? AND request_id=?',
      )
      .bind(guestId, requestId)
      .first(),
    db
      .prepare(
        'SELECT count(*) AS n FROM guest_comment_changes WHERE guest_id=? AND request_id=?',
      )
      .bind(guestId, requestId)
      .first(),
    db
      .prepare(
        'SELECT count(*) AS n FROM guest_comments WHERE author_guest_id=? AND created_request_id=?',
      )
      .bind(guestId, requestId)
      .first(),
  ]);
  return {
    commands: commands?.n ?? null,
    results: results?.n ?? null,
    changes: changes?.n ?? null,
    comments: comments?.n ?? null,
  };
}

async function assertOnlyGuestCookies(observations, cookieName) {
  const browserCookieName = cookieName.startsWith('__Host-')
    ? '__Host-kino_browser'
    : 'kino_browser';
  for (const request of observations.requests.filter((item) =>
    item.pathname.startsWith('/api/'),
  )) {
    assert.deepEqual(
      request.cookieNames.filter((name) => name !== browserCookieName),
      [cookieName],
      'Same-origin Worker API requests carry only Guest authorization plus the anonymous browser counter',
    );
    assert.ok(request.cookieNames.length <= 2);
  }
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    'Guest comments and version comparison fit a 375px viewport',
  );
}

async function checkDisabledWorker({
  browser,
  disabledWorker,
  base,
  albumId,
  secret,
}) {
  assert.ok(disabledWorker);
  const state = await createGuestBrowser({
    browser,
    worker: disabledWorker,
    base,
    albumId,
    secret,
  });
  try {
    const response = await state.page.goto(
      new URL('/guest/albums/' + encodeURIComponent(albumId), base).href,
      { waitUntil: 'networkidle' },
    );
    assert.equal(response?.status(), 200);
    await expect
      .poll(() => state.observations.capabilities.length)
      .toBeGreaterThan(0);
    assert.equal(state.observations.capabilities.at(-1)?.body?.enabled, false);
    await expect(
      state.page.getByTestId('guest-batch-comment-composer'),
    ).toHaveCount(0);
    assert.equal(state.observations.comments.length, 0);
    assert.equal(state.observations.commentPosts.length, 0);
  } finally {
    await state.close();
  }
}

async function checkUnknownIntentRecovery({
  browser,
  worker,
  base,
  db,
  albumId,
  filename,
  secret,
  guestId,
}) {
  const state = await createGuestBrowser({
    browser,
    worker,
    base,
    albumId,
    secret,
  });
  try {
    await openGuestGallery(state.page, base, albumId);
    await openCommentPanel(state.page, filename);
    const body = 'Keep the original operation after a temporary 401.';
    state.dropNextCommentPost();
    await state.page.getByTestId('comment-body').fill(body);
    await state.page.getByTestId('comment-submit').click();
    await expect.poll(() => state.observations.commentPosts.length).toBe(1);
    const accepted = state.observations.commentPosts[0];
    assert.equal(accepted.status, 200);
    assert.equal(accepted.requestBody?.body, body);
    const requestId = accepted.requestBody?.requestId;
    assert.equal(typeof requestId, 'string');
    const commentId = accepted.body?.items?.[0]?.commentId;
    assert.equal(typeof commentId, 'string');
    await expect(state.page.getByTestId('comment-retry')).toBeVisible();
    assert.deepEqual(await commentCounts(db, guestId, requestId), {
      commands: 1,
      results: 1,
      changes: 1,
      comments: 1,
    });

    const owner = await db
      .prepare(
        'SELECT w.owner_user_id FROM workspaces w JOIN albums a ON a.workspace_id=w.id WHERE a.id=?',
      )
      .bind(albumId)
      .first();
    assert.ok(owner?.owner_user_id);
    await db
      .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
      .bind(owner.owner_user_id)
      .run();
    try {
      await state.page.getByTestId('comment-retry').click();
      await waitForCommentPost(state, requestId, 401);
    } finally {
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner.owner_user_id)
        .run();
    }

    await expect(
      state.page.locator('[role="dialog"][aria-modal="true"]'),
    ).toHaveCount(0);
    await expect(state.page.getByTestId('comment-body')).toHaveCount(0);
    await expect(state.page.getByTestId('comment-submit')).toHaveCount(0);
    const stored = await state.page.evaluate(() => {
      const entries = [];
      for (let index = 0; index < sessionStorage.length; index += 1) {
        const key = sessionStorage.key(index);
        if (key?.includes('kino-pic:guest-comments:pending:')) {
          entries.push(sessionStorage.getItem(key) ?? '');
        }
      }
      return entries.join('\n');
    });
    assert.ok(stored.includes(requestId));
    assert.equal(
      stored.includes(body),
      false,
      'Recovery storage contains metadata only',
    );

    await expect(
      state.page.getByText('此連結目前無法使用，請聯絡攝影師。', {
        exact: true,
      }),
    ).toBeVisible();
    await state.page
      .getByRole('button', { name: '重新載入', exact: true })
      .click();
    await openCommentPanel(state.page, filename, true);
    await expect(state.page.getByTestId('comment-recovery-body')).toBeVisible();
    await expect(state.page.getByTestId('comment-recovery-body')).toHaveValue(
      '',
    );
    await state.page.getByTestId('comment-recovery-body').fill(body);
    await state.page.getByTestId('comment-recovery-retry').click();
    await expect
      .poll(
        () =>
          state.observations.commentPosts.filter(
            (item) =>
              item.requestBody?.requestId === requestId && item.status === 200,
          ).length,
      )
      .toBe(2);
    const retries = state.observations.commentPosts.filter(
      (item) => item.requestBody?.requestId === requestId,
    );
    assert.equal(retries.length, 3);
    assert.deepEqual(retries[0].requestBody, retries[1].requestBody);
    assert.deepEqual(retries[0].requestBody, retries[2].requestBody);
    await expect(
      renderedCommentBody(state.page, commentId, body),
    ).toBeVisible();
    // A current read during reload can already display the body while the
    // original intent is still being authoritatively reconciled. Wait for the
    // recovery UI to settle before asserting durable journal removal.
    await expect(state.page.getByTestId('comment-recovery-body')).toHaveCount(
      0,
    );
    // Pending retry hides the recovery form before the authoritative receipt
    // clears its journal. Observe durable cleanup itself, not that UI transition.
    await expect
      .poll(() =>
        state.page.evaluate(
          (expectedRequestId) =>
            Array.from({ length: sessionStorage.length }, (_, index) =>
              sessionStorage.key(index),
            )
              .filter((key) =>
                key?.includes('kino-pic:guest-comments:pending:'),
              )
              .map((key) => sessionStorage.getItem(key) ?? '')
              .join('\n')
              .includes(expectedRequestId),
          requestId,
        ),
      )
      .toBe(false);
    assert.deepEqual(await commentCounts(db, guestId, requestId), {
      commands: 1,
      results: 1,
      changes: 1,
      comments: 1,
    });
    await assertOnlyGuestCookies(state.observations, state.cookieName);
  } finally {
    await state.close();
  }
}

async function checkSameGuestLateResponseRace({
  browser,
  worker,
  base,
  db,
  albumId,
  filename,
  secret,
  guestId,
}) {
  const state = await createGuestBrowser({
    browser,
    worker,
    base,
    albumId,
    secret,
  });
  try {
    await openGuestGallery(state.page, base, albumId);
    await openCommentPanel(state.page, filename);
    const bodyA =
      'Guest A operation completed before its response was delivered.';
    const holdA = state.holdNextCommentPost();
    await state.page.getByTestId('comment-body').fill(bodyA);
    await state.page.getByTestId('comment-submit').click();
    const acceptedA = await holdA.committed;
    assert.equal(acceptedA.status, 200);
    const requestIdA = acceptedA.requestBody.requestId;
    const commentIdA = acceptedA.body?.items?.[0]?.commentId;
    assert.equal(typeof commentIdA, 'string');
    assert.deepEqual(await commentCounts(db, guestId, requestIdA), {
      commands: 1,
      results: 1,
      changes: 1,
      comments: 1,
    });

    const beforeFocusReads = state.observations.comments.length;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await state.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await state.page.waitForTimeout(30);
    await state.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect
      .poll(() => state.observations.comments.length)
      .toBeGreaterThan(beforeFocusReads);
    await expect(
      renderedCommentBody(state.page, commentIdA, bodyA),
    ).toBeVisible();
    await expect(state.page.getByTestId('comment-abandon')).toBeVisible();
    const key =
      'kino-pic:guest-comments:pending:' +
      encodeURIComponent(albumId) +
      ':' +
      encodeURIComponent(guestId);
    const journalA = await state.page.evaluate(
      (storageKey) => sessionStorage.getItem(storageKey),
      key,
    );
    assert.ok(journalA?.includes(requestIdA));
    assert.equal(journalA.includes(bodyA), false);
    await state.page.getByTestId('comment-abandon').click();
    await state.page.getByTestId('comment-abandon-confirm').click();
    await expect(state.page.getByTestId('comment-body')).toBeVisible();
    await expect
      .poll(() =>
        state.page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key,
        ),
      )
      .toBeNull();

    const bodyB = 'Guest B operation must survive Guest A late success.';
    const holdB = state.holdNextCommentPost({ dropAfterRelease: true });
    await state.page.getByTestId('comment-body').fill(bodyB);
    await state.page.getByTestId('comment-submit').click();
    const acceptedB = await holdB.committed;
    assert.equal(acceptedB.status, 200);
    const requestIdB = acceptedB.requestBody.requestId;
    const commentIdB = acceptedB.body?.items?.[0]?.commentId;
    assert.equal(typeof commentIdB, 'string');
    assert.notEqual(requestIdB, requestIdA);
    assert.equal(acceptedB.requestBody.expectedGuestId, guestId);
    const journalB = await state.page.evaluate(
      (storageKey) => sessionStorage.getItem(storageKey),
      key,
    );
    assert.ok(journalB?.includes(requestIdB));
    assert.equal(journalB.includes(bodyB), false);

    const deliveredA = state.page.waitForResponse((response) => {
      if (
        response.request().method() !== 'POST' ||
        new URL(response.url()).pathname !== commandPath(albumId) ||
        response.status() !== 200
      ) {
        return false;
      }
      try {
        return response.request().postDataJSON()?.requestId === requestIdA;
      } catch {
        return false;
      }
    });
    holdA.release();
    await deliveredA;
    const journalAfterA = await state.page.evaluate(
      (storageKey) => sessionStorage.getItem(storageKey),
      key,
    );
    assert.ok(journalAfterA?.includes(requestIdB));
    assert.equal(journalAfterA.includes(bodyB), false);
    await expect(state.page.getByTestId('comment-body')).toHaveValue(bodyB);
    await expect(state.page.getByTestId('comment-retry')).toHaveCount(0);

    holdB.release();
    await expect(state.page.getByTestId('comment-retry')).toBeVisible();
    const journalAfterDrop = await state.page.evaluate(
      (storageKey) => sessionStorage.getItem(storageKey),
      key,
    );
    assert.ok(journalAfterDrop?.includes(requestIdB));
    assert.equal(journalAfterDrop.includes(bodyB), false);
    await state.page.getByTestId('comment-retry').click();
    await expect
      .poll(
        () =>
          state.observations.commentPosts.filter(
            (item) =>
              item.requestBody?.requestId === requestIdB && item.status === 200,
          ).length,
      )
      .toBe(2);
    const attemptsB = state.observations.commentPosts.filter(
      (item) => item.requestBody?.requestId === requestIdB,
    );
    assert.equal(attemptsB.length, 2);
    assert.deepEqual(attemptsB[0].requestBody, attemptsB[1].requestBody);
    assert.equal(attemptsB[0].body?.items?.length, 1);
    assert.equal(
      attemptsB[1].body?.items?.[0]?.commentId,
      attemptsB[0].body.items[0].commentId,
    );
    assert.deepEqual(await commentCounts(db, guestId, requestIdA), {
      commands: 1,
      results: 1,
      changes: 1,
      comments: 1,
    });
    assert.deepEqual(await commentCounts(db, guestId, requestIdB), {
      commands: 1,
      results: 1,
      changes: 1,
      comments: 1,
    });
    await expect(
      renderedCommentBody(state.page, commentIdA, bodyA),
    ).toBeVisible();
    await expect(
      renderedCommentBody(state.page, commentIdB, bodyB),
    ).toBeVisible();
    await expect
      .poll(() =>
        state.page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key,
        ),
      )
      .toBeNull();

    const oldUnauthorizedBody =
      'An old unauthorized response must not clear the newer operation.';
    const deferredA = state.deferNextCommentPost();
    await state.page.getByTestId('comment-body').fill(oldUnauthorizedBody);
    await state.page.getByTestId('comment-submit').click();
    const requestA = await deferredA.received;
    const requestIdOldA = requestA.requestId;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await state.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await state.page.waitForTimeout(30);
    await state.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(state.page.getByTestId('comment-abandon')).toBeVisible();
    await state.page.getByTestId('comment-abandon').click();
    await state.page.getByTestId('comment-abandon-confirm').click();
    await expect(state.page.getByTestId('comment-body')).toBeVisible();
    await expect
      .poll(() =>
        state.page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key,
        ),
      )
      .toBeNull();

    const bodyB2 = 'New accepted operation remains active during the old 401.';
    const holdB2 = state.holdNextCommentPost();
    await state.page.getByTestId('comment-body').fill(bodyB2);
    await state.page.getByTestId('comment-submit').click();
    const acceptedB2 = await holdB2.committed;
    const requestIdB2 = acceptedB2.requestBody.requestId;
    const commentIdB2 = acceptedB2.body?.items?.[0]?.commentId;
    assert.equal(typeof commentIdB2, 'string');
    assert.notEqual(requestIdB2, requestIdOldA);
    const journalB2 = await state.page.evaluate(
      (storageKey) => sessionStorage.getItem(storageKey),
      key,
    );
    assert.ok(journalB2?.includes(requestIdB2));
    assert.equal(journalB2.includes(bodyB2), false);

    const owner = await db
      .prepare(
        'SELECT w.owner_user_id FROM workspaces w JOIN albums a ON a.workspace_id=w.id WHERE a.id=?',
      )
      .bind(albumId)
      .first();
    assert.ok(owner?.owner_user_id);
    await db
      .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
      .bind(owner.owner_user_id)
      .run();
    try {
      const oldUnauthorizedResponse = state.page.waitForResponse((response) => {
        if (
          response.request().method() !== 'POST' ||
          new URL(response.url()).pathname !== commandPath(albumId) ||
          response.status() !== 401
        ) {
          return false;
        }
        try {
          return response.request().postDataJSON()?.requestId === requestIdOldA;
        } catch {
          return false;
        }
      });
      deferredA.release();
      await oldUnauthorizedResponse;
    } finally {
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner.owner_user_id)
        .run();
    }
    const oldUnauthorized = await waitForCommentPost(state, requestIdOldA, 401);
    assert.equal(oldUnauthorized.body?.error?.code, 'GUEST_ACCESS_REQUIRED');
    assert.deepEqual(await commentCounts(db, guestId, requestIdOldA), {
      commands: 0,
      results: 0,
      changes: 0,
      comments: 0,
    });
    await expect(state.page.getByTestId('comment-body')).toHaveValue(bodyB2);
    await expect(state.page.getByTestId('comment-retry')).toHaveCount(0);
    const stillPendingB2 = await state.page.evaluate(
      (storageKey) => sessionStorage.getItem(storageKey),
      key,
    );
    assert.ok(stillPendingB2?.includes(requestIdB2));
    assert.equal(stillPendingB2.includes(bodyB2), false);

    holdB2.release();
    await expect(
      renderedCommentBody(state.page, commentIdB2, bodyB2),
    ).toBeVisible();
    await expect
      .poll(() =>
        state.page.evaluate(
          (storageKey) => sessionStorage.getItem(storageKey),
          key,
        ),
      )
      .toBeNull();
    assert.deepEqual(await commentCounts(db, guestId, requestIdB2), {
      commands: 1,
      results: 1,
      changes: 1,
      comments: 1,
    });

    await assertOnlyGuestCookies(state.observations, state.cookieName);
    assert.deepEqual(state.observations.bridgeErrors, []);
    assert.deepEqual(state.observations.pageErrors, []);
  } finally {
    await state.close();
  }
}

async function checkRecoveryStorageGuards({
  browser,
  worker,
  base,
  db,
  albumId,
  filename,
  secret,
  guestId,
}) {
  const storageKey =
    'kino-pic:guest-comments:pending:' +
    encodeURIComponent(albumId) +
    ':' +
    encodeURIComponent(guestId);
  const beforeCommands = await db
    .prepare(
      'SELECT count(*) AS n FROM guest_comment_commands WHERE guest_id=?',
    )
    .bind(guestId)
    .first();

  const corruptState = await createGuestBrowser({
    browser,
    worker,
    base,
    albumId,
    secret,
  });
  try {
    await openGuestGallery(corruptState.page, base, albumId);
    await openCommentPanel(corruptState.page, filename);
    await corruptState.page.evaluate(
      ({ key, value }) => sessionStorage.setItem(key, value),
      {
        key: storageKey,
        value: '{"version":999,"body":"must not be replayed"}',
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    await corruptState.page.evaluate(() =>
      window.dispatchEvent(new Event('blur')),
    );
    await corruptState.page.waitForTimeout(30);
    await corruptState.page.evaluate(() =>
      window.dispatchEvent(new Event('focus')),
    );
    await expect(
      corruptState.page.getByTestId('comment-abandon'),
    ).toBeVisible();
    await expect(corruptState.page.getByTestId('comment-body')).toBeDisabled();
    await expect(
      corruptState.page.getByTestId('comment-submit'),
    ).toBeDisabled();
    assert.equal(corruptState.observations.commentPosts.length, 0);
    const retainedCorrupt = await corruptState.page.evaluate(
      (key) => sessionStorage.getItem(key),
      storageKey,
    );
    assert.ok(retainedCorrupt?.includes('must not be replayed'));
    await corruptState.page.getByTestId('comment-abandon').click();
    await corruptState.page.getByTestId('comment-abandon-confirm').click();
    await expect(corruptState.page.getByTestId('comment-body')).toBeEnabled();
    await expect
      .poll(() =>
        corruptState.page.evaluate(
          (key) => sessionStorage.getItem(key),
          storageKey,
        ),
      )
      .toBeNull();
    assert.equal(corruptState.observations.commentPosts.length, 0);
  } finally {
    await corruptState.close();
  }

  const quotaState = await createGuestBrowser({
    browser,
    worker,
    base,
    albumId,
    secret,
  });
  try {
    await openGuestGallery(quotaState.page, base, albumId);
    await openCommentPanel(quotaState.page, filename);
    await quotaState.page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Object.defineProperty(window, '__kinoOriginalCommentStorageSetItem', {
        configurable: true,
        value: original,
      });
      Object.defineProperty(Storage.prototype, 'setItem', {
        configurable: true,
        writable: true,
        value(key, value) {
          if (String(key).startsWith('kino-pic:guest-comments:pending:')) {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
          }
          return original.call(this, key, value);
        },
      });
    });
    try {
      const body = 'Do not send when retry metadata cannot be saved.';
      await quotaState.page.getByTestId('comment-body').fill(body);
      await quotaState.page.getByTestId('comment-submit').click();
      await expect(
        quotaState.page.getByText('工作階段儲存無法使用，留言尚未送出。', {
          exact: true,
        }),
      ).toBeVisible();
      assert.equal(quotaState.observations.commentPosts.length, 0);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_comment_commands WHERE guest_id=?',
            )
            .bind(guestId)
            .first()
        )?.n,
        beforeCommands?.n,
        'Quota failure did not guess success or write a command',
      );
    } finally {
      await quotaState.page.evaluate(() => {
        const original = window.__kinoOriginalCommentStorageSetItem;
        if (typeof original === 'function') {
          Object.defineProperty(Storage.prototype, 'setItem', {
            configurable: true,
            writable: true,
            value: original,
          });
        }
        delete window.__kinoOriginalCommentStorageSetItem;
      });
    }
  } finally {
    await quotaState.close();
  }
}

async function checkCommentPaginationWatermark({
  browser,
  worker,
  base,
  db,
  albumId,
  photoId,
  currentVersionId,
  filename,
  secret,
  guestId,
  inviteId,
}) {
  const existingThread = await db
    .prepare(
      'SELECT count(*) AS n FROM guest_comments WHERE invite_id=? AND photo_id=? AND version_id=?',
    )
    .bind(inviteId, photoId, currentVersionId)
    .first();
  const existingCount = existingThread?.n ?? 0;
  assert.ok(
    existingCount <= 22,
    'The paginated browser thread starts with at most 22 existing comments',
  );

  for (let index = 0; index < 25; index += 1) {
    const body = 'pagination fixture ' + String(index + 1).padStart(2, '0');
    const response = await workerCommand({
      worker,
      base,
      albumId,
      secret,
      input: {
        requestId: randomUUID(),
        expectedGuestId: guestId,
        operation: 'create',
        body,
        targets: [{ photoId, versionId: currentVersionId }],
      },
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.items?.length, 1);
    assert.equal(result.items[0].photoId, photoId);
    assert.equal(result.items[0].versionId, currentVersionId);
    assert.equal(result.items[0].body, body);
  }

  const expectedTotal = existingCount + 25;
  assert.ok(expectedTotal < 48);
  const readOnlyTables = [
    ...selectionTables,
    'guest_feedback_commands',
    'guest_feedback_results',
    'guest_rating_state',
    'guest_favorite_state',
    'guest_tag_labels',
    'guest_tag_commands',
    'guest_tag_results',
    'guest_tag_state',
  ];
  const commentLedgerTables = [
    'guest_comment_commands',
    'guest_comment_results',
    'guest_comment_changes',
    'guest_comments',
  ];
  const state = await createGuestBrowser({
    browser,
    worker,
    base,
    albumId,
    secret,
  });
  try {
    const initialReadOnlyCounts = await tableCounts(db, readOnlyTables);
    await openGuestGallery(state.page, base, albumId);
    await openCommentPanel(state.page, filename);
    await expect(state.page.getByTestId('compare-after')).toHaveValue(
      currentVersionId,
    );
    const threadPath = commentsPath(albumId, photoId, currentVersionId);
    const comments = state.page.locator('[data-testid^="comment-item-"]');
    const initialThreadPage = () =>
      state.observations.comments
        .filter(
          (item) =>
            item.status === 200 &&
            item.pathname === threadPath &&
            item.search === '',
        )
        .at(-1);
    await expect.poll(() => initialThreadPage() !== undefined).toBe(true);
    const firstPage = initialThreadPage();
    assert.equal(firstPage.body.items.length, 24);
    assert.equal(firstPage.body.guestId, guestId);
    assert.equal(typeof firstPage.body.nextCursor, 'string');
    const firstCursor = firstPage.body.nextCursor;
    await expect(comments).toHaveCount(24);
    await expect(state.page.getByTestId('comment-load-more')).toBeVisible();
    await state.page.getByTestId('comment-load-more').click();
    await expect(comments).toHaveCount(expectedTotal);
    await expect(state.page.getByTestId('comment-load-more')).toHaveCount(0);
    const firstNextPage = state.observations.comments.find(
      (item) =>
        item.pathname === threadPath &&
        new URLSearchParams(item.search).get('cursor') === firstCursor,
    );
    assert.equal(firstNextPage?.status, 200);
    assert.equal(firstNextPage.body.items.length, expectedTotal - 24);

    const secondReloadResponse = await state.page.reload({
      waitUntil: 'networkidle',
    });
    assert.equal(secondReloadResponse?.status(), 200);
    await expect(
      state.page.getByRole('heading', {
        name: /^Kino Pick (?:線上挑片|相簿)$/u,
      }),
    ).toBeVisible();
    await openCommentPanel(state.page, filename);
    await expect(state.page.getByTestId('compare-after')).toHaveValue(
      currentVersionId,
    );
    await expect(comments).toHaveCount(24);
    await expect(state.page.getByTestId('comment-load-more')).toBeVisible();
    const refreshedFirstPage = initialThreadPage();
    assert.equal(refreshedFirstPage.body.items.length, 24);
    const staleCursor = refreshedFirstPage.body.nextCursor;
    assert.equal(typeof staleCursor, 'string');

    const externalBody = 'Pagination watermark changed through the Worker.';
    const externalResponse = await workerCommand({
      worker,
      base,
      albumId,
      secret,
      input: {
        requestId: randomUUID(),
        expectedGuestId: guestId,
        operation: 'create',
        body: externalBody,
        targets: [{ photoId, versionId: currentVersionId }],
      },
    });
    assert.equal(externalResponse.status, 200);
    const externalResult = await externalResponse.json();
    assert.equal(externalResult.items?.length, 1);
    assert.equal(externalResult.items[0].body, externalBody);
    const commentsBeforeStaleRead = state.observations.comments.length;
    await state.page.getByTestId('comment-load-more').click();
    await expect(state.page.getByTestId('comment-reload')).toBeVisible();
    await expect(comments).toHaveCount(0);
    await expect(state.page.getByTestId('comment-load-more')).toHaveCount(0);
    await expect
      .poll(() =>
        state.observations.comments
          .slice(commentsBeforeStaleRead)
          .some(
            (item) =>
              item.status === 409 &&
              item.pathname === threadPath &&
              new URLSearchParams(item.search).get('cursor') === staleCursor &&
              item.body?.error?.code === 'COMMENT_HISTORY_CHANGED',
          ),
      )
      .toBe(true);
    const commentLedgerAfterExternalWrite = await tableCounts(
      db,
      commentLedgerTables,
    );

    const commentsBeforeExplicitReload = state.observations.comments.length;
    await state.page.getByTestId('comment-reload').click();
    await expect(comments).toHaveCount(24);
    await expect(state.page.getByTestId('comment-reload')).toHaveCount(0);
    const reloadedPage = state.observations.comments
      .slice(commentsBeforeExplicitReload)
      .find(
        (item) =>
          item.status === 200 &&
          item.pathname === threadPath &&
          item.search === '',
      );
    assert.ok(reloadedPage);
    assert.equal(reloadedPage.body.items.length, 24);
    assert.equal(typeof reloadedPage.body.nextCursor, 'string');
    assert.notEqual(reloadedPage.body.nextCursor, staleCursor);
    await state.page.getByTestId('comment-load-more').click();
    await expect(comments).toHaveCount(expectedTotal + 1);
    await expect(state.page.getByTestId('comment-load-more')).toHaveCount(0);
    assert.equal(state.observations.commentPosts.length, 0);
    assert.deepEqual(
      await tableCounts(db, readOnlyTables),
      initialReadOnlyCounts,
      'Comment reads do not write selection, feedback, rating, favorite, or tag state',
    );
    assert.deepEqual(
      await tableCounts(db, commentLedgerTables),
      commentLedgerAfterExternalWrite,
      'Cursor reads do not write comment commands, results, changes, or projections',
    );
    await assertOnlyGuestCookies(state.observations, state.cookieName);
    assert.deepEqual(state.observations.bridgeErrors, []);
    assert.deepEqual(state.observations.pageErrors, []);
  } finally {
    await state.close();
  }
}

export async function runGuestCommentsBrowserChecks({
  worker,
  base,
  db,
  disabledWorker,
  albumId,
  photoId,
  versionId,
  currentVersionId,
  filename,
  secretAuthor,
  secretPeer,
  secretOtherInvite,
  secretRecoveryBrowser,
  authorGuestId,
  peerGuestId,
  otherGuestId,
  recoveryBrowserGuestId,
  recoveryBrowserInviteId,
  authorInviteId,
  batchTargets,
}) {
  for (const value of [
    worker,
    base,
    db,
    albumId,
    photoId,
    versionId,
    currentVersionId,
    filename,
    secretAuthor,
    secretPeer,
    secretOtherInvite,
    secretRecoveryBrowser,
    authorGuestId,
    peerGuestId,
    otherGuestId,
    recoveryBrowserGuestId,
    recoveryBrowserInviteId,
    authorInviteId,
  ]) {
    assert.ok(value, 'The API fixture provides the browser comment inputs');
  }
  assert.ok(Array.isArray(batchTargets) && batchTargets.length === 24);

  const authorSession = await db
    .prepare(
      'SELECT i.permissions_mask FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id WHERE s.secret_hash=?',
    )
    .bind(guestSessionHash(secretAuthor))
    .first();
  assert.ok(authorSession);
  assert.equal(authorSession.permissions_mask & canSelectBit, 0);

  const browser = await chromium.launch({ headless: true });
  try {
    const state = await createGuestBrowser({
      browser,
      worker,
      base,
      albumId,
      secret: secretAuthor,
    });
    try {
      await openGuestGallery(state.page, base, albumId);
      await expect
        .poll(() =>
          state.observations.capabilities.some(
            (item) => item.status === 200 && item.body?.enabled === true,
          ),
        )
        .toBe(true);

      const batchCheckboxes = state.page.locator(
        '[data-testid^="batch-comment-toggle-"]',
      );
      await expect(batchCheckboxes).toHaveCount(24);
      const renderedTargetIds = await batchCheckboxes.evaluateAll((nodes) =>
        nodes.map((node) =>
          node
            .getAttribute('data-testid')
            ?.slice('batch-comment-toggle-'.length),
        ),
      );
      assert.equal(new Set(renderedTargetIds).size, 24);
      assert.deepEqual(
        new Set(renderedTargetIds),
        new Set(batchTargets.map((target) => target.photoId)),
        'The actual gallery shows the 24 actual ready photo targets from the API fixture',
      );
      const selectionBefore = await tableCounts(db, selectionTables);
      const targetByPhoto = new Map(
        batchTargets.map((target) => [
          target.photoId,
          target.photoId === photoId ? currentVersionId : target.versionId,
        ]),
      );
      for (const photoId of renderedTargetIds) {
        await state.page.getByTestId('batch-comment-toggle-' + photoId).check();
      }
      await expect(
        state.page.getByText('已選 24 / 24', { exact: true }),
      ).toBeVisible();
      const batchBody =
        'Independent batch comment from the real mobile gallery.';
      await state.page.getByTestId('batch-comment-body').fill(batchBody);
      await state.page.getByTestId('batch-comment-submit').click();
      await expect(
        state.page.getByTestId('batch-comment-confirm'),
      ).toBeVisible();
      await expect(
        state.page.getByText('確認要在 24 張照片新增留言'),
      ).toBeVisible();
      await state.page.getByTestId('batch-comment-confirm').click();
      await expect(
        state.page.getByText('已成功新增 24 則留言。'),
      ).toBeVisible();
      await expect.poll(() => state.observations.commentPosts.length).toBe(1);
      const batchRequest = state.observations.commentPosts[0];
      assert.equal(batchRequest.status, 200);
      assert.equal(batchRequest.requestBody.body, batchBody);
      assert.equal(batchRequest.requestBody.operation, 'create');
      assert.equal(batchRequest.requestBody.targets.length, 24);
      assert.equal(
        new Set(
          batchRequest.requestBody.targets.map((target) => target.photoId),
        ).size,
        24,
      );
      assert.deepEqual(
        batchRequest.requestBody.targets,
        renderedTargetIds.map((photoId) => ({
          photoId,
          versionId: targetByPhoto.get(photoId),
        })),
        'Batch submission uses only independently checked targets in DOM order',
      );
      const batchResult = batchRequest.body;
      assert.equal(batchResult?.items?.length, 24);
      assert.equal(
        new Set(batchResult.items.map((item) => item.photoId)).size,
        24,
      );
      assert.ok(
        batchResult.items.every(
          (item) => item.isMine && item.body === batchBody,
        ),
      );
      assert.deepEqual(await tableCounts(db, selectionTables), selectionBefore);
      assert.deepEqual(
        await commentCounts(
          db,
          authorGuestId,
          batchRequest.requestBody.requestId,
        ),
        { commands: 1, results: 1, changes: 24, comments: 24 },
      );

      await openCommentPanel(state.page, filename);
      const threadObservationStart = state.observations.comments.length;
      await selectCommentComparisonPair(
        state.page,
        currentVersionId,
        versionId,
      );
      await expect
        .poll(() =>
          state.observations.comments
            .slice(threadObservationStart)
            .some(
              (item) =>
                item.pathname === commentsPath(albumId, photoId, versionId) &&
                item.status === 200,
            ),
        )
        .toBe(true);
      await expect
        .poll(
          () =>
            state.observations.versions.filter((item) => item.status === 200)
              .length,
        )
        .toBeGreaterThan(0);
      const canvasImages = state.page
        .getByTestId('compare-canvas')
        .locator('img');
      await expect(canvasImages).toHaveCount(2);
      await expect
        .poll(() =>
          canvasImages.evaluateAll((nodes) =>
            nodes.every(
              (node) =>
                node instanceof HTMLImageElement &&
                node.complete &&
                node.naturalWidth > 0 &&
                node.naturalHeight > 0,
            ),
          ),
        )
        .toBe(true);
      for (const expectedVersionId of [currentVersionId, versionId]) {
        assert.ok(
          state.observations.assets.some(
            (asset) =>
              asset.photoId === photoId &&
              asset.versionId === expectedVersionId &&
              asset.kind === 'preview' &&
              asset.status === 200 &&
              asset.contentType === 'image/jpeg' &&
              asset.byteLength > 128,
          ),
          'The browser loaded a private R2 preview through the Guest Worker',
        );
      }
      await assertNoHorizontalOverflow(state.page);

      const literalBody =
        '<img src=x onerror="window.__guestCommentInjected=true"> browser literal';
      state.dropNextCommentPost();
      await state.page.getByTestId('comment-body').fill(literalBody);
      await state.page.getByTestId('comment-submit').click();
      await expect.poll(() => state.observations.commentPosts.length).toBe(2);
      const acceptedCreate = state.observations.commentPosts[1];
      assert.equal(acceptedCreate.status, 200);
      assert.equal(acceptedCreate.body?.items?.length, 1);
      const createRequestId = acceptedCreate.requestBody.requestId;
      const commentId = acceptedCreate.body.items[0].commentId;
      await expect(state.page.getByTestId('comment-retry')).toBeVisible();
      assert.deepEqual(
        await commentCounts(db, authorGuestId, createRequestId),
        { commands: 1, results: 1, changes: 1, comments: 1 },
      );
      await state.page.getByTestId('comment-retry').click();
      await expect.poll(() => state.observations.commentPosts.length).toBe(3);
      const createAttempts = state.observations.commentPosts.slice(1);
      assert.deepEqual(
        createAttempts[0].requestBody,
        createAttempts[1].requestBody,
      );
      assert.equal(createAttempts[1].status, 200);
      await expect(
        state.page
          .getByTestId('comment-item-' + commentId)
          .getByText(literalBody, {
            exact: true,
          }),
      ).toBeVisible();
      await expect(
        state.page.getByTestId('comment-item-' + commentId).locator('img'),
      ).toHaveCount(0);
      assert.equal(
        await state.page.evaluate(() => Boolean(window.__guestCommentInjected)),
        false,
        'User comment HTML remains literal text',
      );
      await mkdir('.local', { recursive: true });
      await state.page.screenshot({
        path: '.local/guest-comments-mobile.png',
      });

      const externalEdit = await workerCommand({
        worker,
        base,
        albumId,
        secret: secretAuthor,
        input: {
          requestId: randomUUID(),
          expectedGuestId: authorGuestId,
          commentId,
          expectedRevision: 1,
          operation: 'edit',
          body: 'A separate session edit makes the UI revision stale.',
        },
      });
      assert.equal(externalEdit.status, 200);
      await state.page.getByTestId('comment-edit-' + commentId).click();
      await state.page
        .getByTestId('comment-edit-body-' + commentId)
        .fill('Stale browser edit');
      await state.page.getByTestId('comment-edit-submit-' + commentId).click();
      await expect(state.page.getByTestId('comment-reload')).toBeVisible();
      await expect(state.page.getByTestId('comment-retry')).toHaveCount(0);
      const stalePost = state.observations.commentPosts.at(-1);
      assert.equal(stalePost?.status, 409);
      assert.equal(stalePost?.body?.error?.code, 'COMMENT_REVISION_CONFLICT');
      assert.equal(stalePost?.requestBody?.expectedRevision, 1);
      await state.page.getByTestId('comment-reload').click();
      await expect
        .poll(
          () =>
            state.observations.comments.filter((item) => item.status === 200)
              .length,
        )
        .toBeGreaterThan(1);
      await expect(state.page.getByTestId('comment-retry')).toBeVisible();
      await state.page.getByTestId('comment-retry').click();
      await expect.poll(() => state.observations.commentPosts.length).toBe(5);
      assert.equal(state.observations.commentPosts.at(-1)?.status, 409);
      assert.deepEqual(
        state.observations.commentPosts.at(-1)?.requestBody,
        stalePost?.requestBody,
        'Stale CAS retry reuses the exact captured request and UUID',
      );
      await state.page.getByTestId('comment-reload').click();
      await expect(
        state.page.getByTestId('comment-edit-' + commentId),
      ).toBeVisible();
      await state.page.getByTestId('comment-abandon').click();
      await state.page.getByTestId('comment-abandon-confirm').click();
      await expect(
        renderedCommentBody(
          state.page,
          commentId,
          'A separate session edit makes the UI revision stale.',
        ),
      ).toBeVisible();

      await state.page.getByTestId('comment-edit-' + commentId).click();
      await state.page
        .getByTestId('comment-edit-body-' + commentId)
        .fill('Edited by the browser author.');
      await state.page.getByTestId('comment-edit-submit-' + commentId).click();
      await expect(
        renderedCommentBody(
          state.page,
          commentId,
          'Edited by the browser author.',
        ),
      ).toBeVisible();
      await expect(
        state.page.getByTestId('comment-edit-' + commentId),
      ).toBeVisible();
      await state.page.getByTestId('comment-resolve-' + commentId).click();
      await expect(
        state.page
          .getByTestId('comment-item-' + commentId)
          .getByText('客戶已標記解決', { exact: true }),
      ).toBeVisible();
      await state.page.getByTestId('comment-edit-' + commentId).click();
      await state.page
        .getByTestId('comment-edit-body-' + commentId)
        .fill('Edited while retaining resolved status.');
      await state.page.getByTestId('comment-edit-submit-' + commentId).click();
      await expect(
        state.page
          .getByTestId('comment-item-' + commentId)
          .getByText('客戶已標記解決', { exact: true }),
      ).toBeVisible();
      await state.page.getByTestId('comment-reopen-' + commentId).click();
      await expect(
        state.page
          .getByTestId('comment-item-' + commentId)
          .getByText('客戶留言待處理', { exact: true }),
      ).toBeVisible();
      await state.page.getByTestId('comment-delete-' + commentId).click();
      await state.page
        .getByTestId('comment-delete-cancel-' + commentId)
        .click();
      await expect(
        state.page
          .getByTestId('comment-item-' + commentId)
          .getByText('Edited while retaining resolved status.', {
            exact: true,
          }),
      ).toBeVisible();
      await state.page.getByTestId('comment-delete-' + commentId).click();
      await state.page
        .getByTestId('comment-delete-confirm-' + commentId)
        .click();
      await expect(
        state.page
          .getByTestId('comment-item-' + commentId)
          .getByText('此留言已刪除', { exact: true }),
      ).toBeVisible();
      await expect(
        state.page.getByTestId('comment-edit-' + commentId),
      ).toHaveCount(0);
      const finalComment = await db
        .prepare('SELECT body,state,revision FROM guest_comments WHERE id=?')
        .bind(commentId)
        .first();
      assert.deepEqual(finalComment, {
        body: null,
        state: 'deleted',
        revision: 7,
      });

      await expect(state.page.getByTestId('comment-body')).toBeVisible();
      const lateCreateBody =
        'A delayed create response must not resurrect a deleted comment.';
      const lateCreate = state.holdNextCommentPost();
      await state.page.getByTestId('comment-body').fill(lateCreateBody);
      await state.page.getByTestId('comment-submit').click();
      const acceptedLateCreate = await lateCreate.committed;
      assert.equal(acceptedLateCreate.status, 200);
      const lateCreateRequestId = acceptedLateCreate.requestBody.requestId;
      const lateCreateCommentId =
        acceptedLateCreate.body?.items?.[0]?.commentId;
      assert.equal(typeof lateCreateCommentId, 'string');
      assert.deepEqual(
        await commentCounts(db, authorGuestId, lateCreateRequestId),
        { commands: 1, results: 1, changes: 1, comments: 1 },
      );

      const deleteBeforeCreateResponse = await workerCommand({
        worker,
        base,
        albumId,
        secret: secretAuthor,
        input: {
          requestId: randomUUID(),
          expectedGuestId: authorGuestId,
          commentId: lateCreateCommentId,
          expectedRevision: 1,
          operation: 'delete',
        },
      });
      assert.equal(deleteBeforeCreateResponse.status, 200);
      const deleteBeforeCreateBody = await deleteBeforeCreateResponse.json();
      assert.equal(deleteBeforeCreateBody.items?.[0]?.state, 'deleted');
      assert.equal(deleteBeforeCreateBody.items?.[0]?.body, null);
      lateCreate.release();

      const lateCreateThreadReadPath = commentsPath(
        albumId,
        photoId,
        versionId,
      );
      await expect
        .poll(() =>
          state.observations.comments.some(
            (item) =>
              item.status === 200 &&
              item.pathname === lateCreateThreadReadPath &&
              new URLSearchParams(item.search).get('commentId') ===
                lateCreateCommentId,
          ),
        )
        .toBe(true);
      const lateCreateItem = state.page.getByTestId(
        'comment-item-' + lateCreateCommentId,
      );
      await expect(
        lateCreateItem.getByText('此留言已刪除', { exact: true }),
      ).toBeVisible();
      await expect(
        renderedCommentBody(state.page, lateCreateCommentId, lateCreateBody),
      ).toHaveCount(0);
      assert.deepEqual(
        await db
          .prepare('SELECT body,state,revision FROM guest_comments WHERE id=?')
          .bind(lateCreateCommentId)
          .first(),
        { body: null, state: 'deleted', revision: 2 },
      );

      const delayed = state.holdNextCommentPost();
      const delayedBody = 'Accepted for guest A while guest B takes focus.';
      await state.page.getByTestId('comment-body').fill(delayedBody);
      await state.page.getByTestId('comment-submit').click();
      const heldResponse = await delayed.committed;
      assert.equal(heldResponse.status, 200);
      const delayedRequestId = heldResponse.requestBody.requestId;
      const delayedCommentId = heldResponse.body.items[0].commentId;
      const delayedMetadataKey =
        'kino-pic:guest-comments:pending:' +
        encodeURIComponent(albumId) +
        ':' +
        encodeURIComponent(authorGuestId);
      const delayedStored = await state.page.evaluate(
        (key) => sessionStorage.getItem(key),
        delayedMetadataKey,
      );
      assert.ok(delayedStored?.includes(delayedRequestId));
      assert.equal(delayedStored.includes(delayedBody), false);
      await state.setGuestCookie(secretPeer);
      await state.page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
      await expect
        .poll(() =>
          state.observations.access.some(
            (item) =>
              item.status === 200 && item.body?.access?.guestId === peerGuestId,
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          state.observations.comments.some(
            (item) => item.status === 200 && item.body?.guestId === peerGuestId,
          ),
        )
        .toBe(true);
      await expect(state.page.getByTestId('comment-body')).toHaveValue('');
      const delayedBrowserResponse = state.page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === 'POST' &&
          new URL(response.url()).pathname === commandPath(albumId) &&
          response.status() === 200
        );
      });
      delayed.release();
      await delayedBrowserResponse;
      await expect
        .poll(() =>
          state.page.evaluate(
            (key) => sessionStorage.getItem(key),
            delayedMetadataKey,
          ),
        )
        .toBeNull();
      await expect(
        state.page.getByTestId('comment-item-' + delayedCommentId),
      ).toBeVisible();
      await expect(
        state.page
          .getByTestId('comment-item-' + delayedCommentId)
          .getByText(delayedBody, { exact: true }),
      ).toBeVisible();
      await expect(
        state.page.getByTestId('comment-edit-' + delayedCommentId),
      ).toHaveCount(0);
      await expect(
        state.page.getByTestId('comment-delete-' + delayedCommentId),
      ).toHaveCount(0);
      const delayedAfterSwitch = await db
        .prepare(
          'SELECT author_guest_id,invite_id FROM guest_comments WHERE id=?',
        )
        .bind(delayedCommentId)
        .first();
      assert.equal(delayedAfterSwitch.author_guest_id, authorGuestId);
      assert.equal(delayedAfterSwitch.invite_id, authorInviteId);
      assert.deepEqual(
        await commentCounts(db, authorGuestId, delayedRequestId),
        { commands: 1, results: 1, changes: 1, comments: 1 },
      );

      const otherInviteResult = await pageJson(
        state.page,
        commentsPath(albumId, photoId, versionId),
      );
      await state.setGuestCookie(secretOtherInvite);
      const emptyOtherInvite = await pageJson(
        state.page,
        commentsPath(albumId, photoId, versionId),
      );
      assert.equal(emptyOtherInvite.status, 200);
      assert.deepEqual(emptyOtherInvite.body?.items, []);
      assert.equal(emptyOtherInvite.body?.guestId, otherGuestId);
      assert.equal(otherInviteResult.status, 200);
      assert.ok(otherInviteResult.body?.items?.length > 0);
      await state.setGuestCookie(secretPeer);

      const peerRead = await pageJson(
        state.page,
        commentsPath(albumId, photoId, versionId),
      );
      assert.equal(peerRead.status, 200);
      const peerDelayed = peerRead.body.items.find(
        (item) => item.commentId === delayedCommentId,
      );
      assert.ok(peerDelayed);
      assert.equal(peerDelayed.isMine, false);
      for (const item of peerRead.body.items) {
        assert.deepEqual(Object.keys(item).sort(), [
          'authorLabel',
          'authorType',
          'body',
          'commentId',
          'createdAt',
          'isMine',
          'parentCommentId',
          'photoId',
          'processing',
          'revision',
          'state',
          'updatedAt',
          'versionId',
        ]);
        assert.equal(Object.hasOwn(item, 'guestId'), false);
        assert.equal(Object.hasOwn(item, 'inviteId'), false);
        assert.equal(Object.hasOwn(item, 'authorGuestId'), false);
      }

      await assertOnlyGuestCookies(state.observations, state.cookieName);
      await assertNoHorizontalOverflow(state.page);
      assert.deepEqual(state.observations.bridgeErrors, []);
      assert.deepEqual(state.observations.pageErrors, []);
    } finally {
      await state.close();
    }

    await checkUnknownIntentRecovery({
      browser,
      worker,
      base,
      db,
      albumId,
      filename,
      secret: secretRecoveryBrowser,
      guestId: recoveryBrowserGuestId,
    });

    await checkRecoveryStorageGuards({
      browser,
      worker,
      base,
      db,
      albumId,
      filename,
      secret: secretRecoveryBrowser,
      guestId: recoveryBrowserGuestId,
    });

    await checkSameGuestLateResponseRace({
      browser,
      worker,
      base,
      db,
      albumId,
      filename,
      secret: secretAuthor,
      guestId: authorGuestId,
    });

    await checkDisabledWorker({
      browser,
      disabledWorker,
      base,
      albumId,
      secret: secretAuthor,
    });

    await checkCommentPaginationWatermark({
      browser,
      worker,
      base,
      db,
      albumId,
      photoId,
      currentVersionId,
      filename,
      secret: secretRecoveryBrowser,
      guestId: recoveryBrowserGuestId,
      inviteId: recoveryBrowserInviteId,
    });
  } finally {
    await browser.close();
  }
}
