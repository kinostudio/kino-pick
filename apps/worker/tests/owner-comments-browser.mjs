import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import {
  guestCommentResultSchema,
  guestCommentsPageSchema,
} from '../../../packages/contracts/src/guest-comments.ts';
import { ownerCommentResultSchema } from '../../../packages/contracts/src/owner-comments.ts';

export function ownerCookieValue(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return match?.[1] ?? ownerCookie;
}

export function guestCookieName(base) {
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

function ownerThreadPath(albumId, photoId, versionId) {
  return (
    '/api/v1/albums/' +
    encodeURIComponent(albumId) +
    '/photos/' +
    encodeURIComponent(photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/comment-threads'
  );
}

function guestThreadPath(albumId, photoId, versionId) {
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

export async function projectAndAlbumNames(db, albumId) {
  const row = await db
    .prepare(
      'SELECT a.name AS album_name,p.name AS project_name,p.id AS project_id FROM albums a JOIN projects p ON p.id=a.project_id WHERE a.id=?',
    )
    .bind(albumId)
    .first();
  assert.ok(row?.album_name, 'The isolated album should exist');
  assert.ok(row?.project_name, 'The isolated project should exist');
  assert.ok(row?.project_id, 'The isolated project id should exist');
  return {
    albumName: row.album_name,
    projectName: row.project_name,
    projectId: row.project_id,
  };
}

export async function createGuestParent({ guestWorker, base, fixture, body }) {
  const requestId = randomUUID();
  const response = await guestWorker.fetch(
    new Request(
      new URL(
        '/api/guest/albums/' +
          encodeURIComponent(fixture.albumId) +
          '/comments/commands',
        base,
      ),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: new URL(base).origin,
          Cookie: guestCookieName(base) + '=' + fixture.secretAuthor,
          'Content-Type': 'application/json',
          'cf-connecting-ip': '198.51.100.135',
        },
        body: JSON.stringify({
          requestId,
          expectedGuestId: fixture.authorGuestId,
          operation: 'create',
          targets: [{ photoId: fixture.photoId, versionId: fixture.versionId }],
          body,
        }),
        redirect: 'manual',
      },
    ),
  );
  const result = parseJson(await response.arrayBuffer());
  assert.equal(response.status, 200, 'A real Guest command creates the parent');
  guestCommentResultSchema.parse(result);
  assert.equal(result.operation, 'create');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].authorType, 'guest');
  assert.equal(result.items[0].parentCommentId, null);
  assert.equal(result.items[0].body, body);
  return result.items[0];
}

async function readGuestThread({
  guestWorker,
  base,
  fixture,
  secret,
  photoId = fixture.photoId,
  versionId = fixture.versionId,
  commentId,
}) {
  const url = new URL(
    guestThreadPath(fixture.albumId, photoId, versionId),
    base,
  );
  if (commentId) url.searchParams.set('commentId', commentId);
  const response = await guestWorker.fetch(
    new Request(url, {
      headers: {
        Accept: 'application/json',
        Cookie: guestCookieName(base) + '=' + secret,
        'cf-connecting-ip': '198.51.100.136',
      },
      redirect: 'manual',
    }),
  );
  const body = parseJson(await response.arrayBuffer());
  assert.equal(response.status, 200, 'The real Guest read should succeed');
  return guestCommentsPageSchema.parse(body);
}

export async function makeBrowserState({
  browser,
  worker,
  base,
  cookieName,
  cookieValue,
  kind,
  albumId,
  mutationSuffix = 'comment-replies',
}) {
  const secure = new URL(base).protocol === 'https:';
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure,
    },
  ]);
  const page = await context.newPage();
  const observations = {
    requests: [],
    ownerMutations: [],
    ownerThreadReads: [],
    guestThreadReads: [],
    pageErrors: [],
    bridgeErrors: [],
  };
  const mutationPath =
    '/api/v1/albums/' +
    encodeURIComponent(albumId) +
    '/' +
    mutationSuffix +
    '/commands';
  const guestPathPrefix =
    '/api/guest/albums/' + encodeURIComponent(albumId) + '/photos/';
  let sequence = 0;
  let dropNextSuccessfulOwnerMutation = false;
  let bootstrapRaceInjected = false;
  let nextHeldMutation = null;
  const heldMutations = [];

  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (url.origin !== new URL(base).origin) {
      await route.continue();
      return;
    }

    const method = incoming.method();
    const record = {
      sequence: ++sequence,
      method,
      pathname: url.pathname,
      search: url.search,
      status: 0,
      requestBody:
        method === 'GET' || method === 'HEAD'
          ? null
          : parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0)),
      responseBody: null,
      dropped: false,
    };
    const isOwnerMutation =
      kind === 'owner' && method === 'POST' && url.pathname === mutationPath;

    const headers = await incoming.allHeaders();
    headers['cf-connecting-ip'] = '198.51.100.137';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD')
      init.body = incoming.postDataBuffer() ?? undefined;

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
    record.status = response.status;
    record.responseBody = parseJson(responseBytes);
    observations.requests.push(record);
    if (isOwnerMutation) observations.ownerMutations.push(record);
    if (
      kind === 'owner' &&
      method === 'GET' &&
      url.pathname.endsWith('/comment-threads')
    )
      observations.ownerThreadReads.push(record);
    if (
      kind === 'guest' &&
      method === 'GET' &&
      url.pathname.startsWith(guestPathPrefix) &&
      url.pathname.endsWith('/comments')
    )
      observations.guestThreadReads.push(record);

    let held = null;
    if (isOwnerMutation && nextHeldMutation && response.ok) {
      held = nextHeldMutation;
      nextHeldMutation = null;
      held.record = record;
      await held.delivery;
    }

    if (isOwnerMutation && dropNextSuccessfulOwnerMutation && response.ok) {
      dropNextSuccessfulOwnerMutation = false;
      record.dropped = true;
      await route.abort('failed');
      return;
    }

    if (
      kind === 'owner' &&
      !bootstrapRaceInjected &&
      method === 'GET' &&
      url.pathname === '/api/v1/comments/capabilities'
    ) {
      bootstrapRaceInjected = true;
      // Actual Worker response is delayed while explicit headless lifecycle signals
      // invalidate an Owner-less bootstrap. A fresh bootstrap must recover it.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('pageshow'));
      });
    }

    const deliveryHeaders = Object.fromEntries(response.headers.entries());
    delete deliveryHeaders['content-length'];
    await route.fulfill({
      status: held?.transportStatus ?? response.status,
      headers: deliveryHeaders,
      body:
        held?.transportStatus === 401
          ? JSON.stringify({ error: { code: 'AUTH_REQUIRED' } })
          : responseBytes,
    });
    record.delivered = true;
  });

  return {
    context,
    page,
    observations,
    dropNextSuccessfulOwnerMutationResponse() {
      dropNextSuccessfulOwnerMutation = true;
    },
    holdNextSuccessfulOwnerMutationResponse() {
      assert.equal(nextHeldMutation, null);
      let releaseDelivery;
      let released = false;
      const held = {
        record: null,
        transportStatus: null,
        delivery: new Promise((resolve) => {
          releaseDelivery = resolve;
        }),
        release(transportStatus = null) {
          if (released) return;
          released = true;
          held.transportStatus = transportStatus;
          releaseDelivery();
        },
      };
      nextHeldMutation = held;
      heldMutations.push(held);
      return held;
    },
    async close() {
      heldMutations.forEach((held) => held.release());
      await context.close();
    },
  };
}

export async function openOwnerPhoto({
  page,
  base,
  projectId,
  projectName,
  albumName,
  filename,
}) {
  const response = await page.goto(
    new URL('/dashboard/projects/' + encodeURIComponent(projectId), base).href,
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(response?.status(), 200);
  await expect(
    page.getByRole('heading', { name: projectName, exact: true }),
  ).toBeVisible();
  const openAlbum = page.getByRole('button', {
    name: '開啟相簿 ' + albumName,
    exact: true,
  });
  const cardTestId = await openAlbum
    .locator('xpath=ancestor::li[1]')
    .getAttribute('data-testid');
  assert.ok(cardTestId?.startsWith('album-card-'));
  await openAlbum.click();
  assert.equal(
    new URL(page.url()).searchParams.get('albumId'),
    cardTestId.slice('album-card-'.length),
  );
  await page
    .getByRole('button', { name: '開啟照片預覽：' + filename, exact: true })
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
      name: filename,
      level: 3,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '關閉', exact: true }),
  ).toBeVisible();
  const panel = page.locator(
    'section[aria-label="照片留言討論串：' + filename + '"]',
  );
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText('攝影師帳號已確認', { exact: true }),
  ).toBeVisible();
  return { dialog, panel };
}

async function ensureSelectOption(panel, select, buttonName, value, label) {
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (values.includes(value)) return;
    const more = panel.getByRole('button', { name: buttonName, exact: true });
    await expect
      .poll(async () => {
        const current = await select
          .locator('option')
          .evaluateAll((options) => options.map((option) => option.value));
        return current.includes(value) || (await more.count()) === 1;
      })
      .toBe(true);
    const updated = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (updated.includes(value)) return;
    const before = updated.length;
    await expect(more).toBeVisible();
    await more.click();
    await expect
      .poll(() =>
        select.locator('option').evaluateAll((options) => options.length),
      )
      .toBeGreaterThan(before);
  }
  assert.fail(label + ' was not found after loading available pages');
}

export async function selectOwnerScope(panel, fixture) {
  const invite = panel.locator('#owner-comment-invite-' + fixture.albumId);
  await expect(invite).toBeEnabled();
  await ensureSelectOption(
    panel,
    invite,
    '載入更多邀請',
    fixture.authorInviteId,
    'The existing browser Guest invite',
  );
  await invite.selectOption(fixture.authorInviteId);
  const version = panel.locator('#owner-comment-version-' + fixture.albumId);
  await expect(version).toBeEnabled();
  await ensureSelectOption(
    panel,
    version,
    '載入更多版本',
    fixture.versionId,
    'The requested historical photo version',
  );
  await version.selectOption(fixture.versionId);
}

export async function ensureThreadBodyVisible(panel, body) {
  const bodyText = panel.getByText(body, { exact: true });
  const more = panel.getByRole('button', {
    name: '載入更多留言',
    exact: true,
  });
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    if ((await bodyText.count()) > 0) return;
    await expect
      .poll(
        async () => (await bodyText.count()) > 0 || (await more.count()) > 0,
      )
      .toBe(true);
    if ((await bodyText.count()) > 0) return;
    const before = await panel.locator('article').count();
    await more.click();
    await expect
      .poll(() => panel.locator('article').count())
      .toBeGreaterThan(before);
  }
  assert.fail(
    'The newly created Guest parent was not found in the thread pages',
  );
}

function ownerThreadReadFor(
  state,
  fixture,
  inviteId,
  commentId,
  afterSequence = 0,
) {
  return state.observations.ownerThreadReads.find((record) => {
    if (record.status !== 200 || record.sequence <= afterSequence) return false;
    const query = new URLSearchParams(record.search);
    return (
      record.pathname ===
        ownerThreadPath(fixture.albumId, fixture.photoId, fixture.versionId) &&
      query.get('inviteId') === inviteId &&
      query.get('commentId') === commentId &&
      record.responseBody?.items?.length === 1 &&
      record.responseBody.items[0]?.commentId === commentId
    );
  });
}

export async function waitForTargetOwnerRead(
  state,
  fixture,
  inviteId,
  commentId,
  afterSequence = 0,
) {
  await expect
    .poll(() =>
      Boolean(
        ownerThreadReadFor(state, fixture, inviteId, commentId, afterSequence),
      ),
    )
    .toBe(true);
  return ownerThreadReadFor(state, fixture, inviteId, commentId, afterSequence);
}

async function waitForOwnerMutation(state, requestId, operation, dropped) {
  await expect
    .poll(() =>
      state.observations.ownerMutations.some(
        (record) =>
          record.requestBody?.requestId === requestId &&
          record.requestBody?.operation === operation &&
          record.status === 200 &&
          record.dropped === dropped,
      ),
    )
    .toBe(true);
  return state.observations.ownerMutations.find(
    (record) =>
      record.requestBody?.requestId === requestId &&
      record.requestBody?.operation === operation &&
      record.status === 200 &&
      record.dropped === dropped,
  );
}

async function readOwnerCommandFootprint(db, ownerId, requestId, replyId) {
  const command = await db
    .prepare(
      'SELECT count(*) AS n FROM owner_comment_commands WHERE actor_id=? AND request_id=?',
    )
    .bind(ownerId, requestId)
    .first();
  const reply = await db
    .prepare('SELECT count(*) AS n FROM owner_comment_replies WHERE id=?')
    .bind(replyId)
    .first();
  const result = await db
    .prepare(
      'SELECT count(*) AS n FROM owner_comment_results WHERE actor_id=? AND request_id=?',
    )
    .bind(ownerId, requestId)
    .first();
  const change = await db
    .prepare(
      'SELECT count(*) AS n FROM owner_comment_changes WHERE actor_id=? AND request_id=?',
    )
    .bind(ownerId, requestId)
    .first();
  const threadChange = await db
    .prepare(
      "SELECT count(*) AS n FROM comment_thread_changes t JOIN owner_comment_changes c ON c.event_id=t.source_event_id WHERE c.actor_id=? AND c.request_id=? AND t.source_kind='owner'",
    )
    .bind(ownerId, requestId)
    .first();
  const audit = await db
    .prepare(
      'SELECT count(*) AS n FROM audit_events e JOIN owner_comment_changes c ON c.event_id=e.event_id WHERE c.actor_id=? AND c.request_id=? AND e.actor_id=?',
    )
    .bind(ownerId, requestId, ownerId)
    .first();
  return {
    commands: command?.n ?? null,
    replies: reply?.n ?? null,
    results: result?.n ?? null,
    changes: change?.n ?? null,
    threadChanges: threadChange?.n ?? null,
    audit: audit?.n ?? null,
  };
}

export async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    label +
      ' overflows the 375px viewport (' +
      dimensions.scrollWidth +
      ' > ' +
      dimensions.clientWidth +
      ')',
  );
}

export function itemRow(panel, authorTypeLabel, body) {
  const article = panel
    .getByRole('article', { name: authorTypeLabel })
    .filter({ hasText: body });
  return { article, row: article.locator('xpath=..') };
}

export async function openGuestPanel({
  page,
  base,
  albumId,
  fixture,
  currentVersionId,
}) {
  const response = await page.goto(
    new URL('/guest/albums/' + encodeURIComponent(albumId), base).href,
    { waitUntil: 'networkidle' },
  );
  assert.equal(response?.status(), 200);
  await expect(
    page.getByRole('heading', { name: /^Kino Pick (?:線上挑片|相簿)$/u }),
  ).toBeVisible();
  await page
    .getByRole('list', { name: '相簿照片列表' })
    .getByRole('button', {
      name: '檢視大圖 ' + fixture.filename,
      exact: true,
    })
    .click();
  await expect(
    page.locator('[role="dialog"][aria-modal="true"]'),
  ).toBeVisible();
  await page.getByTestId('guest-compare-open').click();
  await expect(page.getByTestId('guest-version-comparison')).toBeVisible();
  const before = page.getByTestId('compare-before');
  const after = page.getByTestId('compare-after');
  await expect
    .poll(() =>
      before
        .locator('option')
        .evaluateAll(
          (options) =>
            options.map((option) => option.value).filter(Boolean).length,
        ),
    )
    .toBeGreaterThan(2);
  const beforeOptions = await before
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => option.value).filter(Boolean),
    );
  const detourVersionId = beforeOptions.find(
    (candidate) =>
      candidate !== currentVersionId && candidate !== fixture.versionId,
  );
  assert.ok(
    detourVersionId,
    'A loaded third version permits selecting the requested historical version',
  );
  await before.selectOption(detourVersionId);
  await after.selectOption(fixture.versionId);
  await before.selectOption(currentVersionId);
  await expect(after).toHaveValue(fixture.versionId);
  const comments = page.getByTestId('guest-comments-panel');
  await expect(comments).toBeVisible();
  const replyItem = comments.getByTestId('comment-item-' + fixture.replyId);
  const more = comments.getByRole('button', {
    name: '載入更多留言',
    exact: true,
  });
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    if ((await replyItem.count()) > 0) break;
    await expect
      .poll(
        async () => (await replyItem.count()) > 0 || (await more.count()) > 0,
      )
      .toBe(true);
    if ((await replyItem.count()) > 0) break;
    const beforeCount = await comments
      .locator('[data-testid^="comment-item-"]')
      .count();
    await more.click();
    await expect
      .poll(() => comments.locator('[data-testid^="comment-item-"]').count())
      .toBeGreaterThan(beforeCount);
  }
  await expect(replyItem).toHaveCount(1);
  return comments;
}

async function assertPeerGuestReplyUi({
  browser,
  guestWorker,
  base,
  fixture,
  replyId,
  replyBody,
}) {
  const state = await makeBrowserState({
    browser,
    worker: guestWorker,
    base,
    cookieName: guestCookieName(base),
    cookieValue: fixture.secretPeer,
    kind: 'guest',
    albumId: fixture.albumId,
  });
  try {
    const comments = await openGuestPanel({
      page: state.page,
      base,
      albumId: fixture.albumId,
      fixture: { ...fixture, replyId },
      currentVersionId: fixture.currentVersionId,
    });
    const replyItem = comments.getByTestId('comment-item-' + replyId);
    await expect(replyItem).toBeVisible();
    await expect(
      comments.getByTestId('comment-author-type-' + replyId),
    ).toHaveText('攝影師回覆');
    await expect(replyItem.getByText(replyBody, { exact: true })).toBeVisible();
    await expect(comments.getByTestId('comment-edit-' + replyId)).toHaveCount(
      0,
    );
    await expect(comments.getByTestId('comment-delete-' + replyId)).toHaveCount(
      0,
    );
    await assertNoHorizontalOverflow(state.page, 'Peer Guest comments panel');
    assert.deepEqual(state.observations.bridgeErrors, []);
    assert.deepEqual(state.observations.pageErrors, []);
  } finally {
    await state.close();
  }
}

async function assertGuestScopeIsolation({
  guestWorker,
  base,
  fixture,
  replyId,
}) {
  const otherPage = await readGuestThread({
    guestWorker,
    base,
    fixture,
    secret: fixture.secretOtherInvite,
    commentId: replyId,
  });
  assert.equal(otherPage.guestId, fixture.otherGuestId);
  assert.equal(
    otherPage.items.some((item) => item.commentId === replyId),
    false,
  );
  const peerPage = await readGuestThread({
    guestWorker,
    base,
    fixture,
    secret: fixture.secretPeer,
    commentId: replyId,
  });
  assert.equal(peerPage.guestId, fixture.peerGuestId);
  const peerReply = peerPage.items.find((item) => item.commentId === replyId);
  assert.ok(peerReply);
  assert.equal(peerReply.authorType, 'owner');
  assert.equal(peerReply.parentCommentId, fixture.parentCommentId);
  assert.equal(peerReply.isMine, false);
  return { peerPage, otherPage };
}

async function countGuestMutation(db, requestId) {
  const row = await db
    .prepare(
      'SELECT count(*) AS n FROM guest_comment_commands WHERE request_id=?',
    )
    .bind(requestId)
    .first();
  return row?.n ?? null;
}

async function assertGuestCannotEditOwnerReply({
  guestWorker,
  base,
  fixture,
  replyId,
  revision,
  db,
}) {
  const requestId = randomUUID();
  const before = await readOwnerCommandFootprint(
    db,
    fixture.ownerId,
    fixture.replyCreateRequestId,
    replyId,
  );
  const response = await guestWorker.fetch(
    new Request(
      new URL(
        '/api/guest/albums/' +
          encodeURIComponent(fixture.albumId) +
          '/comments/commands',
        base,
      ),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: new URL(base).origin,
          Cookie: guestCookieName(base) + '=' + fixture.secretPeer,
          'Content-Type': 'application/json',
          'cf-connecting-ip': '198.51.100.138',
        },
        body: JSON.stringify({
          requestId,
          expectedGuestId: fixture.peerGuestId,
          operation: 'edit',
          commentId: replyId,
          expectedRevision: revision,
          body: 'Guest must not edit an Owner reply',
        }),
        redirect: 'manual',
      },
    ),
  );
  const body = parseJson(await response.arrayBuffer());
  assert.equal(response.status, 401);
  assert.equal(body?.error?.code, 'GUEST_ACCESS_REQUIRED');
  assert.equal(await countGuestMutation(db, requestId), 0);
  assert.deepEqual(
    await readOwnerCommandFootprint(
      db,
      fixture.ownerId,
      fixture.replyCreateRequestId,
      replyId,
    ),
    before,
  );
}

export async function runOwnerCommentsBrowserChecks({
  db,
  worker,
  guestWorker,
  base,
  ownerCookie,
  fixture,
  owner,
}) {
  assert.ok(
    ownerCookie,
    'The Owner browser check requires a live Owner cookie',
  );
  assert.ok(owner, 'The Owner browser check requires the Owner actor id');
  for (const key of [
    'albumId',
    'photoId',
    'versionId',
    'currentVersionId',
    'filename',
    'authorInviteId',
    'secretAuthor',
    'authorGuestId',
    'secretPeer',
    'peerGuestId',
    'secretOtherInvite',
    'otherGuestId',
  ])
    assert.ok(fixture?.[key], 'The Guest comments fixture provides ' + key);
  assert.ok(db && worker && guestWorker && base);

  const parentBody = 'Owner UI parent ' + randomUUID();
  const parent = await createGuestParent({
    guestWorker,
    base,
    fixture,
    body: parentBody,
  });
  const { albumName, projectName, projectId } = await projectAndAlbumNames(
    db,
    fixture.albumId,
  );
  const browser = await chromium.launch({ headless: true });
  let ownerState;
  try {
    ownerState = await makeBrowserState({
      browser,
      worker,
      base,
      cookieName: 'kino-owner.session_token',
      cookieValue: ownerCookieValue(ownerCookie),
      kind: 'owner',
      albumId: fixture.albumId,
    });
    const { page, observations } = ownerState;
    const opened = await openOwnerPhoto({
      page,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    const { panel } = opened;
    assert.ok(
      observations.requests.filter(
        (record) =>
          record.pathname === '/api/v1/comments/capabilities' &&
          record.status === 200,
      ).length >= 2,
      'blur/focus while the original capability response is delayed restarts bootstrap',
    );
    await selectOwnerScope(panel, fixture);
    await ensureThreadBodyVisible(panel, parentBody);

    const initialThreadRead = observations.ownerThreadReads.find((record) => {
      const query = new URLSearchParams(record.search);
      return (
        record.status === 200 &&
        record.pathname ===
          ownerThreadPath(
            fixture.albumId,
            fixture.photoId,
            fixture.versionId,
          ) &&
        query.get('inviteId') === fixture.authorInviteId &&
        record.responseBody?.items?.some(
          (item) => item.commentId === parent.commentId,
        )
      );
    });
    assert.ok(initialThreadRead);

    const replyBody =
      'Owner literal text <b>must stay text</b> & "quotes" ' + randomUUID();
    const guestParent = itemRow(panel, '訪客留言', parentBody);
    await guestParent.row
      .getByRole('button', { name: '回覆此留言', exact: true })
      .click();
    await panel
      .locator('#owner-comment-editor-' + fixture.albumId)
      .fill(replyBody);
    ownerState.dropNextSuccessfulOwnerMutationResponse();
    await panel.getByRole('button', { name: '送出回覆', exact: true }).click();

    await expect
      .poll(() =>
        observations.ownerMutations.some(
          (record) =>
            record.requestBody?.operation === 'reply' &&
            record.status === 200 &&
            record.dropped,
        ),
      )
      .toBe(true);
    const lostResponse = observations.ownerMutations.find(
      (record) =>
        record.requestBody?.operation === 'reply' &&
        record.status === 200 &&
        record.dropped,
    );
    assert.ok(lostResponse?.requestBody?.requestId);
    assert.equal(lostResponse.requestBody.inviteId, fixture.authorInviteId);
    assert.equal(lostResponse.requestBody.photoId, fixture.photoId);
    assert.equal(lostResponse.requestBody.versionId, fixture.versionId);
    assert.equal(lostResponse.requestBody.parentCommentId, parent.commentId);
    assert.equal(lostResponse.requestBody.body, replyBody);
    const createResult = ownerCommentResultSchema.parse(
      lostResponse.responseBody,
    );
    assert.equal(createResult.operation, 'reply');
    assert.equal(createResult.item.parentCommentId, parent.commentId);
    assert.equal(createResult.item.revision, 1);
    assert.equal(createResult.item.body, replyBody);
    const replyId = createResult.item.commentId;
    const createFootprint = await readOwnerCommandFootprint(
      db,
      owner,
      lostResponse.requestBody.requestId,
      replyId,
    );
    assert.deepEqual(createFootprint, {
      commands: 1,
      replies: 1,
      results: 1,
      changes: 1,
      threadChanges: 1,
      audit: 1,
    });
    const persistedCommand = await db
      .prepare(
        'SELECT request_json FROM owner_comment_commands WHERE actor_id=? AND request_id=?',
      )
      .bind(owner, lostResponse.requestBody.requestId)
      .first();
    assert.ok(persistedCommand?.request_json);
    assert.deepEqual(
      JSON.parse(persistedCommand.request_json),
      lostResponse.requestBody,
    );

    const journalKey =
      'kino-pic:owner-comments:v1:' + owner + ':' + fixture.albumId;
    const storedJournal = await page.evaluate((key) => {
      const value = sessionStorage.getItem(key);
      return value === null ? null : JSON.parse(value);
    }, journalKey);
    assert.ok(storedJournal);
    assert.equal(storedJournal.bodySha256?.length, 64);
    assert.deepEqual(
      Object.keys(storedJournal).sort(),
      [
        'actorId',
        'albumId',
        'bodySha256',
        'expectedParentRevision',
        'inviteId',
        'operation',
        'parentCommentId',
        'photoId',
        'requestId',
        'versionId',
      ].sort(),
    );
    const serializedJournal = JSON.stringify(storedJournal);
    assert.equal(serializedJournal.includes(replyBody), false);
    assert.equal(
      serializedJournal.includes(ownerCookieValue(ownerCookie)),
      false,
    );
    assert.equal(serializedJournal.includes(fixture.secretAuthor), false);
    assert.equal(serializedJournal.includes(fixture.secretPeer), false);
    await expect(
      panel.getByText(
        '尚無法確認操作結果；已保留相同操作編號與目標，請重試原操作。',
        { exact: true },
      ),
    ).toBeVisible();

    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/owner-comments-recovery-mobile.png',
      fullPage: false,
    });
    await assertNoHorizontalOverflow(
      page,
      'Owner comments panel before recovery',
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: albumName, exact: true }),
    ).toBeVisible();
    const reopened = await openOwnerPhoto({
      page,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    await selectOwnerScope(reopened.panel, fixture);
    const recoveryBody = reopened.panel.locator(
      '#owner-comment-recovery-' + fixture.albumId,
    );
    await expect(recoveryBody).toBeVisible();
    await expect(recoveryBody).toHaveValue('');
    await recoveryBody.fill(replyBody);
    await reopened.panel
      .getByRole('button', { name: '以相同操作重試', exact: true })
      .click();

    const replayRecord = await waitForOwnerMutation(
      ownerState,
      lostResponse.requestBody.requestId,
      'reply',
      false,
    );
    assert.deepEqual(replayRecord.requestBody, lostResponse.requestBody);
    const replayResult = ownerCommentResultSchema.parse(
      replayRecord.responseBody,
    );
    assert.deepEqual(replayResult, createResult);
    const replayRead = await waitForTargetOwnerRead(
      ownerState,
      fixture,
      fixture.authorInviteId,
      replyId,
      replayRecord.sequence,
    );
    assert.equal(replayRead.responseBody.items[0]?.body, replyBody);
    assert.equal(replayRead.sequence > replayRecord.sequence, true);
    await expect(
      reopened.panel.getByText(replyBody, { exact: true }),
    ).toBeVisible();
    await expect(
      reopened.panel.locator('b', { hasText: 'must stay text' }),
    ).toHaveCount(0);
    assert.deepEqual(
      await readOwnerCommandFootprint(
        db,
        owner,
        lostResponse.requestBody.requestId,
        replyId,
      ),
      createFootprint,
    );
    assert.equal(
      await page.evaluate((key) => sessionStorage.getItem(key), journalKey),
      null,
    );

    const editBody = 'Edited Owner text <i>still text</i> ' + randomUUID();
    const ownerReply = itemRow(reopened.panel, '攝影師回覆', replyBody);
    await expect(ownerReply.article).toBeVisible();
    await ownerReply.row
      .getByRole('button', { name: '編輯回覆', exact: true })
      .click();
    await reopened.panel
      .locator('#owner-comment-editor-' + fixture.albumId)
      .fill(editBody);
    await reopened.panel
      .getByRole('button', { name: '儲存回覆', exact: true })
      .click();
    await expect
      .poll(() =>
        observations.ownerMutations.some(
          (record) =>
            record.requestBody?.operation === 'edit_reply' &&
            record.status === 200 &&
            record.requestBody?.replyId === replyId,
        ),
      )
      .toBe(true);
    const editRecord = observations.ownerMutations.find(
      (record) =>
        record.requestBody?.operation === 'edit_reply' &&
        record.status === 200 &&
        record.requestBody?.replyId === replyId,
    );
    assert.equal(editRecord.requestBody.expectedRevision, 1);
    const editResult = ownerCommentResultSchema.parse(editRecord.responseBody);
    assert.equal(editResult.item.revision, 2);
    assert.equal(editResult.item.body, editBody);
    const editRead = await waitForTargetOwnerRead(
      ownerState,
      fixture,
      fixture.authorInviteId,
      replyId,
      editRecord.sequence,
    );
    assert.equal(editRead.sequence > editRecord.sequence, true);
    assert.equal(editRead.responseBody.items[0]?.revision, 2);
    await expect(
      reopened.panel.getByText(editBody, { exact: true }),
    ).toBeVisible();
    const editFootprint = await readOwnerCommandFootprint(
      db,
      owner,
      editRecord.requestBody.requestId,
      replyId,
    );
    assert.deepEqual(editFootprint, {
      commands: 1,
      replies: 1,
      results: 1,
      changes: 1,
      threadChanges: 1,
      audit: 1,
    });

    const peerScope = {
      ...fixture,
      parentCommentId: parent.commentId,
      ownerId: owner,
      replyCreateRequestId: lostResponse.requestBody.requestId,
    };
    const peerRead = await readGuestThread({
      guestWorker,
      base,
      fixture: peerScope,
      secret: fixture.secretPeer,
      commentId: replyId,
    });
    const peerReply = peerRead.items.find((item) => item.commentId === replyId);
    assert.ok(peerReply);
    assert.equal(peerReply.authorType, 'owner');
    assert.equal(peerReply.parentCommentId, parent.commentId);
    assert.equal(peerReply.isMine, false);
    assert.equal(peerReply.body, editBody);
    await assertGuestCannotEditOwnerReply({
      guestWorker,
      base,
      fixture: peerScope,
      replyId,
      revision: 2,
      db,
    });
    await assertPeerGuestReplyUi({
      browser,
      guestWorker,
      base,
      fixture: {
        ...fixture,
        parentCommentId: parent.commentId,
      },
      replyId,
      replyBody: editBody,
    });
    await assertGuestScopeIsolation({
      guestWorker,
      base,
      fixture: peerScope,
      replyId,
    });

    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await ensureThreadBodyVisible(reopened.panel, editBody);
    await reopened.panel
      .getByRole('button', { name: '刪除回覆', exact: true })
      .click();
    await expect(
      reopened.panel.getByText(
        '確認刪除此攝影師回覆？留言會保留刪除紀錄，文字將改為空白。',
        { exact: true },
      ),
    ).toBeVisible();
    await reopened.panel
      .getByRole('button', { name: '確認刪除回覆', exact: true })
      .click();
    await expect
      .poll(() =>
        observations.ownerMutations.some(
          (record) =>
            record.requestBody?.operation === 'delete_reply' &&
            record.status === 200 &&
            record.requestBody?.replyId === replyId,
        ),
      )
      .toBe(true);
    const deleteRecord = observations.ownerMutations.find(
      (record) =>
        record.requestBody?.operation === 'delete_reply' &&
        record.status === 200 &&
        record.requestBody?.replyId === replyId,
    );
    assert.equal(deleteRecord.requestBody.expectedRevision, 2);
    const deleteResult = ownerCommentResultSchema.parse(
      deleteRecord.responseBody,
    );
    assert.equal(deleteResult.item.state, 'deleted');
    assert.equal(deleteResult.item.body, null);
    assert.equal(deleteResult.item.revision, 3);
    const deleteRead = await waitForTargetOwnerRead(
      ownerState,
      fixture,
      fixture.authorInviteId,
      replyId,
      deleteRecord.sequence,
    );
    assert.equal(deleteRead.sequence > deleteRecord.sequence, true);
    assert.deepEqual(deleteRead.responseBody.items[0], deleteResult.item);
    await expect(
      reopened.panel
        .getByRole('article', { name: '攝影師回覆' })
        .filter({ hasText: /第 3 次修訂 · 回覆已刪除/u }),
    ).toBeVisible();
    await expect(
      reopened.panel.getByRole('button', { name: '編輯回覆', exact: true }),
    ).toHaveCount(0);
    await expect(
      reopened.panel.getByRole('button', { name: '刪除回覆', exact: true }),
    ).toHaveCount(0);
    assert.deepEqual(
      await readOwnerCommandFootprint(
        db,
        owner,
        deleteRecord.requestBody.requestId,
        replyId,
      ),
      {
        commands: 1,
        replies: 1,
        results: 1,
        changes: 1,
        threadChanges: 1,
        audit: 1,
      },
    );

    const afterDeletePeer = await readGuestThread({
      guestWorker,
      base,
      fixture: peerScope,
      secret: fixture.secretPeer,
      commentId: replyId,
    });
    const peerTombstone = afterDeletePeer.items.find(
      (item) => item.commentId === replyId,
    );
    assert.ok(peerTombstone);
    assert.equal(peerTombstone.authorType, 'owner');
    assert.equal(peerTombstone.isMine, false);
    assert.equal(peerTombstone.state, 'deleted');
    assert.equal(peerTombstone.body, null);

    // Both outcomes are delivery faults after real commits. Unknown A may be
    // explicitly abandoned, but its late success/401 must never alter pending B.
    for (const lateStatus of [200, 401]) {
      const bodyA = 'Late Owner A ' + lateStatus + ' ' + randomUUID();
      const bodyB = 'Current Owner B ' + lateStatus + ' ' + randomUUID();
      const submitBody = async (body) => {
        await ensureThreadBodyVisible(reopened.panel, parentBody);
        await itemRow(reopened.panel, '訪客留言', parentBody)
          .row.getByRole('button', { name: '回覆此留言', exact: true })
          .click();
        await reopened.panel
          .locator('#owner-comment-editor-' + fixture.albumId)
          .fill(body);
        await reopened.panel
          .getByRole('button', { name: '送出回覆', exact: true })
          .click();
      };
      const holdA = ownerState.holdNextSuccessfulOwnerMutationResponse();
      await submitBody(bodyA);
      await expect.poll(() => holdA.record?.status).toBe(200);
      const aRecord = holdA.record;
      await reopened.panel
        .getByRole('button', { name: '開始放棄待確認操作', exact: true })
        .click();
      await reopened.panel
        .getByRole('button', {
          name: '再次確認放棄（不會撤回遠端操作）',
          exact: true,
        })
        .click();
      const holdB = ownerState.holdNextSuccessfulOwnerMutationResponse();
      await submitBody(bodyB);
      await expect.poll(() => holdB.record?.status).toBe(200);
      const bRecord = holdB.record;
      const journalKey =
        'kino-pic:owner-comments:v1:' + owner + ':' + fixture.albumId;
      const rawB = await page.evaluate(
        (key) => sessionStorage.getItem(key),
        journalKey,
      );
      assert.equal(JSON.parse(rawB).requestId, bRecord.requestBody.requestId);
      const deliveredA = page.waitForResponse((response) => {
        const request = response.request();
        return (
          request.method() === 'POST' &&
          new URL(request.url()).pathname.endsWith(
            '/comment-replies/commands',
          ) &&
          request.postDataJSON()?.requestId === aRecord.requestBody.requestId
        );
      });
      holdA.release(lateStatus === 401 ? 401 : null);
      const deliveredResponse = await deliveredA;
      assert.equal(deliveredResponse.status(), lateStatus);
      assert.equal(await deliveredResponse.finished(), null);
      await expect.poll(() => aRecord.delivered === true).toBe(true);
      await page.waitForTimeout(100);
      assert.equal(
        await page.evaluate((key) => sessionStorage.getItem(key), journalKey),
        rawB,
      );
      await expect(
        reopened.panel.getByRole('button', { name: '傳送中…', exact: true }),
      ).toBeDisabled();
      holdB.release();
      const bRead = await waitForTargetOwnerRead(
        ownerState,
        fixture,
        fixture.authorInviteId,
        bRecord.responseBody.item.commentId,
        bRecord.sequence,
      );
      assert.equal(bRead.responseBody.items[0].body, bodyB);
      await expect
        .poll(() =>
          page.evaluate((key) => sessionStorage.getItem(key), journalKey),
        )
        .toBeNull();
      await expect(
        reopened.panel.getByText(bodyB, { exact: true }),
      ).toBeVisible();
      for (const record of [aRecord, bRecord]) {
        assert.equal(
          observations.ownerMutations.filter(
            (item) =>
              item.requestBody?.requestId === record.requestBody.requestId,
          ).length,
          1,
        );
        assert.deepEqual(
          await readOwnerCommandFootprint(
            db,
            owner,
            record.requestBody.requestId,
            record.responseBody.item.commentId,
          ),
          {
            commands: 1,
            replies: 1,
            results: 1,
            changes: 1,
            threadChanges: 1,
            audit: 1,
          },
        );
      }
    }
    await assertNoHorizontalOverflow(page, 'Owner comments panel after delete');
    await page.screenshot({
      path: '.local/owner-comments-mobile.png',
      fullPage: false,
    });
    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
  } finally {
    await ownerState?.close();
    await browser.close();
  }
}
