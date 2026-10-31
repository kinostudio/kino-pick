import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { z } from 'zod';
import {
  guestAnnotationCommandSchema,
  guestAnnotationResultSchema,
  guestAnnotationsPageSchema,
} from '../../../packages/contracts/src/guest-annotations.ts';
import { guestSharedAnnotationsPageSchema } from '../../../packages/contracts/src/annotation-threads.ts';
import {
  ownerAnnotationProcessingCommandSchema,
  ownerAnnotationProcessingResultSchema,
} from '../../../packages/contracts/src/annotation-processing.ts';
import { ownerAnnotationsPageSchema } from '../../../packages/contracts/src/owner-annotations.ts';
import { annotationProcessingJournalMetadataSchema } from '../../web/target-ui/annotation-processing-journal.ts';
import {
  assertNoHorizontalOverflow,
  guestCookieName,
  makeBrowserState,
  ownerCookieValue,
  projectAndAlbumNames,
} from './owner-comments-browser.mjs';

const processingJournalEnvelopeSchema = z
  .object({
    version: z.literal(1),
    metadata: z.unknown(),
    status: z.enum(['ready', 'uncertain', 'conflict']),
  })
  .strict();

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

function parseProcessingJournalEnvelope(raw) {
  assert.equal(typeof raw, 'string');
  const envelope = processingJournalEnvelopeSchema.parse(JSON.parse(raw));
  return {
    version: envelope.version,
    metadata: annotationProcessingJournalMetadataSchema.parse(
      envelope.metadata,
    ),
    status: envelope.status,
  };
}

function ownerCommandPath(fixture) {
  return (
    '/api/v1/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/annotation-processing/commands'
  );
}

function ownerAnnotationsPath(fixture, versionId) {
  return (
    '/api/v1/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/photos/' +
    encodeURIComponent(fixture.photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/annotations'
  );
}

function guestCommandPath(fixture) {
  return (
    '/api/guest/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/annotations/commands'
  );
}

function guestOwnPath(fixture, versionId) {
  return (
    '/api/guest/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/photos/' +
    encodeURIComponent(fixture.photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/annotations/own'
  );
}

function guestSharedPath(fixture, versionId) {
  return (
    '/api/guest/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/photos/' +
    encodeURIComponent(fixture.photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/annotations/shared'
  );
}

function ownerTargetRead(record, fixture, annotationId) {
  const query = new URLSearchParams(record.search);
  return (
    record.method === 'GET' &&
    record.status === 200 &&
    record.pathname === ownerAnnotationsPath(fixture, fixture.versionId) &&
    query.get('inviteId') === fixture.inviteId &&
    query.get('annotationId') === annotationId &&
    !query.has('cursor')
  );
}

function ownerPageRead(
  record,
  fixture,
  inviteId = fixture.inviteId,
  versionId = fixture.versionId,
) {
  const query = new URLSearchParams(record.search);
  return (
    record.method === 'GET' &&
    record.status === 200 &&
    record.pathname === ownerAnnotationsPath(fixture, versionId) &&
    query.get('inviteId') === inviteId &&
    !query.has('annotationId')
  );
}

function ownerTargetReadForScope(
  record,
  fixture,
  inviteId,
  versionId,
  annotationId,
) {
  const query = new URLSearchParams(record.search);
  return (
    record.method === 'GET' &&
    record.status === 200 &&
    record.pathname === ownerAnnotationsPath(fixture, versionId) &&
    query.get('inviteId') === inviteId &&
    query.get('annotationId') === annotationId &&
    !query.has('cursor')
  );
}

function guestSharedRead(record, fixture) {
  return (
    record.method === 'GET' &&
    record.status === 200 &&
    record.pathname === guestSharedPath(fixture, fixture.versionId)
  );
}

function guestExactRead(record, pathname, annotationId) {
  const query = new URLSearchParams(record.search);
  return (
    record.method === 'GET' &&
    record.status === 200 &&
    record.pathname === pathname &&
    query.get('annotationId') === annotationId &&
    !query.has('cursor')
  );
}

function installProcessingTransport({ state, worker, base, fixture }) {
  const commandPath = ownerCommandPath(fixture);
  const heldRequests = [];
  let nextHeld = null;
  state.observations.processingMutations = [];

  state.page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (
      url.origin !== new URL(base).origin ||
      incoming.method() !== 'POST' ||
      url.pathname !== commandPath
    ) {
      await route.fallback();
      return;
    }

    const headers = await incoming.allHeaders();
    headers['cf-connecting-ip'] = '198.51.100.221';
    const requestBody = parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0));
    let response;
    try {
      const init = {
        method: incoming.method(),
        headers,
        redirect: 'manual',
        body: incoming.postDataBuffer() ?? undefined,
      };
      response = await worker.fetch(new Request(incoming.url(), init));
    } catch (error) {
      const record = {
        method: incoming.method(),
        pathname: url.pathname,
        search: url.search,
        requestBody,
        status: 0,
        responseBody: null,
        bridgeError: error instanceof Error ? error.message : String(error),
        delivered: false,
      };
      state.observations.requests.push(record);
      state.observations.ownerMutations.push(record);
      state.observations.processingMutations.push(record);
      state.observations.bridgeErrors.push(record.bridgeError);
      if (nextHeld) {
        const held = nextHeld;
        nextHeld = null;
        held.record = record;
        held.resolveSeen();
        held.resolveFinished();
      }
      try {
        await route.abort('failed');
      } catch {
        record.deliveryError = 'The browser request had already ended';
      }
      return;
    }

    const responseBytes = Buffer.from(await response.arrayBuffer());
    const record = {
      method: incoming.method(),
      pathname: url.pathname,
      search: url.search,
      requestBody,
      status: response.status,
      responseBody: parseJson(responseBytes),
      delivered: false,
      held: false,
    };
    state.observations.requests.push(record);
    state.observations.ownerMutations.push(record);
    state.observations.processingMutations.push(record);

    let held = null;
    if (nextHeld) {
      held = nextHeld;
      nextHeld = null;
      held.record = record;
      held.resolveSeen();
      if (response.ok) {
        record.held = true;
        await held.delivery;
      }
    }

    const deliveryHeaders = Object.fromEntries(response.headers.entries());
    delete deliveryHeaders['content-length'];
    try {
      await route.fulfill({
        status: response.status,
        headers: deliveryHeaders,
        body: responseBytes,
      });
      record.delivered = true;
    } catch {
      record.deliveryError = 'The browser request had already ended';
    } finally {
      held?.resolveFinished();
    }
  });

  return {
    holdNextSuccessfulResponse() {
      assert.equal(nextHeld, null);
      let releaseDelivery;
      let resolveSeen;
      let resolveFinished;
      let released = false;
      const held = {
        record: null,
        delivery: new Promise((resolve) => {
          releaseDelivery = resolve;
        }),
        seen: new Promise((resolve) => {
          resolveSeen = resolve;
        }),
        finished: new Promise((resolve) => {
          resolveFinished = resolve;
        }),
        resolveSeen,
        resolveFinished,
        release() {
          if (released) return;
          released = true;
          releaseDelivery();
        },
      };
      nextHeld = held;
      heldRequests.push(held);
      return held;
    },
    releaseAll() {
      for (const held of heldRequests) held.release();
    },
  };
}

async function selectPagedOption(panel, select, moreButton, value, label) {
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (values.includes(value)) {
      await select.selectOption(value);
      return;
    }
    await expect
      .poll(async () => {
        const current = await select
          .locator('option')
          .evaluateAll((options) => options.map((option) => option.value));
        return current.includes(value) || (await moreButton.count()) === 1;
      })
      .toBe(true);
    const updated = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (updated.includes(value)) {
      await select.selectOption(value);
      return;
    }
    const before = updated.length;
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    await expect
      .poll(() => select.locator('option').evaluateAll((items) => items.length))
      .toBeGreaterThan(before);
  }
  assert.fail(label + ' was not found after loading available pages');
}

async function openOwnerPhoto({
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
  await page
    .getByRole('button', { name: '查看照片 ' + albumName, exact: true })
    .click();
  await page
    .getByRole('button', { name: '開啟照片預覽：' + filename, exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2').first()).toHaveText('相片詳情');
  await expect(dialog.locator('.kino-photo-detail-metadata h3')).toHaveText(
    filename,
  );
  const panel = dialog.getByTestId('owner-annotations-panel');
  await expect(panel).toBeVisible();
  return { dialog, panel };
}

async function openGuestComparisonAfter(page, fixture, versionId) {
  await page.getByTestId('guest-compare-open').click();
  const comparison = page.getByTestId('guest-version-comparison');
  await expect(comparison).toBeVisible();
  const after = comparison.getByTestId('compare-after');
  const before = comparison.getByTestId('compare-before');
  const more = comparison.getByTestId('compare-load-more');
  const afterValues = await after
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  if (!afterValues.includes(versionId)) {
    const afterSelection = await after.inputValue();
    const beforeValues = await before
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    const replacementBefore = beforeValues.find(
      (candidate) =>
        candidate !== '' &&
        candidate !== versionId &&
        candidate !== afterSelection,
    );
    assert.ok(
      replacementBefore,
      'A third loaded Guest version keeps Before and the requested After version distinct',
    );
    await before.selectOption(replacementBefore);
    await expect(before).toHaveValue(replacementBefore);
  }

  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    const values = await after
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (values.includes(versionId)) break;
    await expect
      .poll(async () => {
        const current = await after
          .locator('option')
          .evaluateAll((options) => options.map((option) => option.value));
        return current.includes(versionId) || (await more.count()) === 1;
      })
      .toBe(true);
    const updated = await after
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (updated.includes(versionId)) break;
    const beforeCount = updated.length;
    await expect(more).toBeVisible();
    await more.click();
    await expect
      .poll(() => after.locator('option').evaluateAll((items) => items.length))
      .toBeGreaterThan(beforeCount);
  }
  const finalValues = await after
    .locator('option')
    .evaluateAll((options) => options.map((option) => option.value));
  assert.ok(
    finalValues.includes(versionId),
    'The historical annotation version is available in Guest comparison After options',
  );
  await after.selectOption(versionId);
  assert.notEqual(
    await before.inputValue(),
    versionId,
    'The requested Guest comparison After version remains distinct from Before',
  );
  await expect(after).toHaveValue(versionId);
  return comparison;
}

async function openGuestPhoto(page, base, fixture) {
  const response = await page.goto(
    new URL('/guest/albums/' + encodeURIComponent(fixture.albumId), base).href,
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(response?.status(), 200);
  await expect(page.getByRole('heading', { name: /客戶挑片/u })).toBeVisible();
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
  if (fixture.versionId !== fixture.currentVersionId)
    await openGuestComparisonAfter(page, fixture, fixture.versionId);
  await expect(page.getByTestId('guest-annotations-panel')).toBeVisible();
}

async function assertGuestProcessingStatusVisible(page, annotationId) {
  const panel = page.getByTestId('guest-annotations-panel');
  const row = panel.getByTestId('annotation-item-' + annotationId);
  const status = row.getByTestId('annotation-processing-' + annotationId);
  await status.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' }),
  );
  await expect(status).toHaveText('攝影師處理：已處理');
  await expect(status).toBeVisible();
  const visibility = await status.evaluate((element, expectedRowTestId) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const textRect = range.getBoundingClientRect();
    const clip = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const rect = ancestor.getBoundingClientRect();
      const clipsX = /^(auto|clip|hidden|scroll)$/u.test(style.overflowX);
      const clipsY = /^(auto|clip|hidden|scroll)$/u.test(style.overflowY);
      if (clipsX) {
        clip.left = Math.max(clip.left, rect.left);
        clip.right = Math.min(clip.right, rect.right);
      }
      if (clipsY) {
        clip.top = Math.max(clip.top, rect.top);
        clip.bottom = Math.min(clip.bottom, rect.bottom);
      }
    }
    const sampleX = (textRect.left + textRect.right) / 2;
    const sampleY = (textRect.top + textRect.bottom) / 2;
    let hitRow = document.elementFromPoint(sampleX, sampleY);
    while (hitRow && hitRow.getAttribute('data-testid') !== expectedRowTestId)
      hitRow = hitRow.parentElement;
    return {
      text: element.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
      textRect: {
        left: textRect.left,
        top: textRect.top,
        right: textRect.right,
        bottom: textRect.bottom,
        width: textRect.width,
        height: textRect.height,
      },
      clip,
      hitRowTestId: hitRow?.getAttribute('data-testid') ?? null,
    };
  }, 'annotation-item-' + annotationId);
  assert.equal(visibility.text, '攝影師處理：已處理');
  assert.ok(
    visibility.textRect.width > 0 && visibility.textRect.height > 0,
    'Resolved Guest processing status text has a rendered box',
  );
  assert.ok(
    visibility.textRect.left >= visibility.clip.left - 1 &&
      visibility.textRect.right <= visibility.clip.right + 1 &&
      visibility.textRect.top >= visibility.clip.top - 1 &&
      visibility.textRect.bottom <= visibility.clip.bottom + 1,
    'Resolved Guest processing status is inside all clipping ancestors: ' +
      JSON.stringify(visibility),
  );
  assert.equal(
    visibility.hitRowTestId,
    'annotation-item-' + annotationId,
    'Resolved Guest processing status is reachable by hit testing in its own row',
  );
}

async function selectOwnerScope(
  panel,
  fixture,
  inviteId = fixture.inviteId,
  versionId = fixture.versionId,
) {
  const invite = panel.getByTestId('owner-annotation-invite');
  const version = panel.getByTestId('owner-annotation-version');
  await expect(invite).toBeEnabled();
  await selectPagedOption(
    panel,
    invite,
    panel.getByTestId('owner-annotation-invites-more'),
    inviteId,
    'The processing fixture invitation',
  );
  await expect(version).toBeEnabled();
  await selectPagedOption(
    panel,
    version,
    panel.getByTestId('owner-annotation-versions-more'),
    versionId,
    'The processing fixture photo version',
  );
  await expect(panel.getByTestId('annotation-processing-panel')).toBeVisible();
  const row = panel.getByTestId(
    'annotation-processing-item-' + fixture.annotationId,
  );
  await expect(row).toBeVisible();
  return {
    invite,
    version,
    processing: panel.getByTestId('annotation-processing-panel'),
    row,
  };
}

function observationIndex(state, predicate, afterIndex = 0) {
  return state.observations.requests.findIndex(
    (record, index) => index >= afterIndex && predicate(record),
  );
}

async function waitForOwnerTargetRead(
  state,
  fixture,
  annotationId,
  afterIndex,
) {
  await expect
    .poll(() =>
      observationIndex(
        state,
        (record) => ownerTargetRead(record, fixture, annotationId),
        afterIndex,
      ),
    )
    .toBeGreaterThanOrEqual(0);
  return state.observations.requests[
    observationIndex(
      state,
      (record) => ownerTargetRead(record, fixture, annotationId),
      afterIndex,
    )
  ];
}

async function waitForOwnerScopePageRead(
  state,
  fixture,
  inviteId,
  versionId,
  afterIndex,
) {
  await expect
    .poll(() =>
      observationIndex(
        state,
        (record) => ownerPageRead(record, fixture, inviteId, versionId),
        afterIndex,
      ),
    )
    .toBeGreaterThanOrEqual(0);
  return state.observations.requests[
    observationIndex(
      state,
      (record) => ownerPageRead(record, fixture, inviteId, versionId),
      afterIndex,
    )
  ];
}

async function waitForOwnerPageRead(state, fixture, afterIndex) {
  return waitForOwnerScopePageRead(
    state,
    fixture,
    fixture.inviteId,
    fixture.versionId,
    afterIndex,
  );
}

async function waitForSharedRead(state, fixture, afterIndex) {
  await expect
    .poll(() =>
      observationIndex(
        state,
        (record) => guestSharedRead(record, fixture),
        afterIndex,
      ),
    )
    .toBeGreaterThanOrEqual(0);
  return state.observations.requests[
    observationIndex(
      state,
      (record) => guestSharedRead(record, fixture),
      afterIndex,
    )
  ];
}

async function waitForObservation(state, predicate, afterIndex) {
  await expect
    .poll(() => observationIndex(state, predicate, afterIndex))
    .toBeGreaterThanOrEqual(0);
  const index = observationIndex(state, predicate, afterIndex);
  return { index, record: state.observations.requests[index] };
}

async function waitForProcessingMutation(state, requestId, afterIndex) {
  await expect
    .poll(() =>
      state.observations.processingMutations.some(
        (record) =>
          record.requestBody?.requestId === requestId &&
          record.status === 200 &&
          state.observations.requests.indexOf(record) >= afterIndex,
      ),
    )
    .toBe(true);
  return state.observations.processingMutations.find(
    (record) =>
      record.requestBody?.requestId === requestId &&
      record.status === 200 &&
      state.observations.requests.indexOf(record) >= afterIndex,
  );
}

async function readGuestSourceSnapshot(db, annotationId) {
  const annotation = await db
    .prepare(
      'SELECT id,author_guest_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,author_label,geometry_json,style_json,linked_comment_id,state,revision,created_at_ms,updated_at_ms,last_session_id,last_request_id,last_command_id FROM guest_annotations WHERE id=?',
    )
    .bind(annotationId)
    .first();
  assert.ok(
    annotation,
    'The real Guest annotation remains in its source table',
  );
  const history = await db
    .prepare(
      'SELECT seq,request_id,operation,revision,occurred_at_ms,before_json,after_json FROM guest_annotation_changes WHERE annotation_id=? ORDER BY seq',
    )
    .bind(annotationId)
    .all();
  return { annotation, history: history.results };
}

async function processingFootprint(db, owner, requestId) {
  const rows = await db
    .prepare(
      'SELECT c.id,c.request_json,ch.revision AS processing_revision,ch.annotation_revision,ch.content_revision,r.command_id AS result_command_id,e.action AS audit_action FROM owner_annotation_processing_commands c JOIN owner_annotation_processing_changes ch ON ch.command_id=c.id JOIN owner_annotation_processing_results r ON r.command_id=c.id JOIN audit_events e ON e.event_id=ch.event_id WHERE c.actor_id=? AND c.request_id=?',
    )
    .bind(owner, requestId)
    .all();
  return rows.results;
}

async function sendGuestCommand({ guestWorker, base, fixture, command }) {
  const body = guestAnnotationCommandSchema.parse(command);
  const response = await guestWorker.fetch(
    new Request(new URL(guestCommandPath(fixture), base), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Origin: new URL(base).origin,
        'Content-Type': 'application/json',
        Cookie: guestCookieName(base) + '=' + fixture.secretAuthor,
        'cf-connecting-ip': '198.51.100.222',
      },
      body: JSON.stringify(body),
      redirect: 'manual',
    }),
  );
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const result = guestAnnotationResultSchema.parse(JSON.parse(text));
  assert.equal(Object.hasOwn(result.item, 'processing'), false);
  return result;
}

async function reloadGuestPhoto(state, base, fixture, afterIndex) {
  await state.page.reload({ waitUntil: 'domcontentloaded' });
  await openGuestPhoto(state.page, base, fixture);
  const record = await waitForSharedRead(state, fixture, afterIndex);
  const page = guestSharedAnnotationsPageSchema.parse(record.responseBody);
  assert.equal(page.guestId, fixture.authorGuestId);
  const item = page.items.find(
    (candidate) => candidate.annotationId === fixture.annotationId,
  );
  assert.ok(item, "The author's annotation remains in the Guest shared scope");
  await expect(
    state.page
      .getByTestId('guest-annotations-panel')
      .getByTestId('annotation-item-' + fixture.annotationId),
  ).toBeVisible();
  return { record, page, item };
}

async function reloadOwnerAnnotations(state, panel, fixture, annotationId) {
  const afterIndex = state.observations.requests.length;
  await panel.getByTestId('owner-annotation-reload').click();
  const record = await waitForOwnerPageRead(state, fixture, afterIndex);
  const page = ownerAnnotationsPageSchema.parse(record.responseBody);
  const item = page.items.find(
    (candidate) => candidate.annotationId === annotationId,
  );
  assert.ok(item, 'The selected Owner Guest page contains the target marker');
  await expect(
    panel.getByTestId('annotation-processing-item-' + annotationId),
  ).toBeVisible();
  return { record, item };
}

function assertPrivateDataAbsent(text, fixture, ownerCookie) {
  for (const secret of [
    fixture.secretAuthor,
    fixture.inviteToken,
    ownerCookieValue(ownerCookie),
    'guestSessionId',
    'last_session_id',
    'r2Key',
    'originalUrl',
    'mediaUrl',
  ]) {
    if (secret) assert.equal(text.includes(secret), false);
  }
}

export async function runAnnotationProcessingBrowserChecks({
  db,
  ownerWorker,
  guestWorker,
  base,
  ownerCookie,
  fixture,
  owner,
}) {
  assert.ok(db && ownerWorker && guestWorker && base && fixture);
  assert.ok(ownerCookie, 'The processing UI needs a real Owner session cookie');
  assert.ok(owner, 'The processing UI needs the Owner actor id');
  for (const key of [
    'albumId',
    'projectId',
    'photoId',
    'versionId',
    'filename',
    'inviteId',
    'annotationId',
    'authorGuestId',
    'secretAuthor',
  ])
    assert.ok(fixture[key], 'The processing browser fixture provides ' + key);
  assert.equal(fixture.versionId, fixture.versionId.toLowerCase());

  const { albumName, projectName, projectId } = await projectAndAlbumNames(
    db,
    fixture.albumId,
  );
  const browser = await chromium.launch({ headless: true });
  let ownerState;
  let guestState;
  let processingTransport;
  try {
    ownerState = await makeBrowserState({
      browser,
      worker: ownerWorker,
      base,
      cookieName: 'kino-owner.session_token',
      cookieValue: ownerCookieValue(ownerCookie),
      kind: 'owner',
      albumId: fixture.albumId,
      mutationSuffix: 'annotation-processing',
    });
    processingTransport = installProcessingTransport({
      state: ownerState,
      worker: ownerWorker,
      base,
      fixture,
    });
    const ownerPage = ownerState.page;
    const { panel } = await openOwnerPhoto({
      page: ownerPage,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    await selectOwnerScope(panel, fixture);
    const processingPanel = panel.getByTestId('annotation-processing-panel');
    const row = panel.getByTestId(
      'annotation-processing-item-' + fixture.annotationId,
    );
    await expect(row).toContainText('處理狀態：待處理');
    const initialOwnerRead = ownerState.observations.requests.find((record) =>
      ownerPageRead(record, fixture),
    );
    assert.ok(initialOwnerRead, 'The UI loads the selected Owner Guest page');
    const initialPage = ownerAnnotationsPageSchema.parse(
      initialOwnerRead.responseBody,
    );
    const initialItem = initialPage.items.find(
      (item) => item.annotationId === fixture.annotationId,
    );
    assert.ok(initialItem);
    assert.deepEqual(initialItem.processing, {
      state: 'open',
      revision: 0,
      annotationRevision: null,
      contentRevision: null,
      updatedAt: null,
      stale: false,
    });

    const sourceBeforeOwnerWrites = await readGuestSourceSnapshot(
      db,
      fixture.annotationId,
    );
    assert.equal(sourceBeforeOwnerWrites.annotation.revision, 1);
    const journalKey =
      'kino-pic:annotation-processing:v1:' + owner + ':' + fixture.albumId;
    const held = processingTransport.holdNextSuccessfulResponse();
    await processingPanel
      .getByTestId(
        'annotation-processing-state-in_progress-' + fixture.annotationId,
      )
      .click();
    await held.seen;
    const heldRecord = held.record;
    assert.ok(heldRecord);
    assert.equal(heldRecord.status, 200, 'The real Worker committed the state');
    const firstCommand = ownerAnnotationProcessingCommandSchema.parse(
      heldRecord.requestBody,
    );
    const firstReceipt = ownerAnnotationProcessingResultSchema.parse(
      heldRecord.responseBody,
    );
    assert.equal(firstCommand.expectedOwnerId, owner);
    assert.equal(firstCommand.operation, 'set_processing_state');
    assert.equal(firstCommand.inviteId, fixture.inviteId);
    assert.equal(firstCommand.photoId, fixture.photoId);
    assert.equal(firstCommand.versionId, fixture.versionId);
    assert.equal(firstCommand.annotationId, fixture.annotationId);
    assert.equal(firstCommand.expectedAnnotationRevision, 1);
    assert.equal(firstCommand.expectedProcessingRevision, 0);
    assert.equal(firstCommand.state, 'in_progress');
    assert.equal(firstReceipt.processing.state, 'in_progress');
    assert.equal(firstReceipt.processing.revision, 1);
    assert.equal(firstReceipt.processing.annotationRevision, 1);
    assert.equal(firstReceipt.processing.contentRevision, 1);
    assert.equal(firstReceipt.processing.stale, false);

    const rawBeforeReload = await ownerPage.evaluate(
      (key) => window.sessionStorage.getItem(key),
      journalKey,
    );
    assert.ok(
      rawBeforeReload,
      'The exact command metadata is saved before send',
    );
    const storedEnvelope = parseProcessingJournalEnvelope(rawBeforeReload);
    const metadata = storedEnvelope.metadata;
    assert.equal(storedEnvelope.status, 'ready');
    assert.deepEqual(metadata.command, firstCommand);
    assert.equal(metadata.ownerId, owner);
    assert.equal(metadata.albumId, fixture.albumId);
    assert.equal(metadata.expectedProcessing.revision, 0);
    assert.equal(Object.hasOwn(metadata, 'receipt'), false);
    assert.equal(Object.hasOwn(metadata.command, 'geometry'), false);
    assert.equal(Object.hasOwn(metadata.command, 'style'), false);
    assertPrivateDataAbsent(rawBeforeReload, fixture, ownerCookie);
    assert.equal(rawBeforeReload.includes('previewUrl'), false);
    assert.equal(rawBeforeReload.includes('result_json'), false);

    const sourceAfterHeldCommit = await readGuestSourceSnapshot(
      db,
      fixture.annotationId,
    );
    assert.deepEqual(
      sourceAfterHeldCommit,
      sourceBeforeOwnerWrites,
      'Owner processing changes do not mutate Guest geometry or history',
    );
    const processingAfterHeldCommit = await db
      .prepare(
        'SELECT state,revision,annotation_revision,content_revision FROM owner_annotation_processing_states WHERE annotation_id=?',
      )
      .bind(fixture.annotationId)
      .first();
    assert.deepEqual(processingAfterHeldCommit, {
      state: 'in_progress',
      revision: 1,
      annotation_revision: 1,
      content_revision: 1,
    });
    const firstFootprint = await processingFootprint(
      db,
      owner,
      firstCommand.requestId,
    );
    assert.equal(firstFootprint.length, 1);
    assert.deepEqual(JSON.parse(firstFootprint[0].request_json), firstCommand);
    assert.equal(firstFootprint[0].processing_revision, 1);
    assert.equal(firstFootprint[0].annotation_revision, 1);
    assert.equal(firstFootprint[0].content_revision, 1);
    assert.equal(firstFootprint[0].result_command_id, firstFootprint[0].id);
    assert.equal(
      firstFootprint[0].audit_action,
      'owner.annotation_processing_changed',
    );
    assert.equal(firstFootprint[0].request_json.includes('geometry'), false);
    assert.equal(firstFootprint[0].request_json.includes('style'), false);

    // The command is committed while its real 200 stays held. Reload destroys
    // the original component, then the retained metadata drives an exact replay.
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      ownerPage.getByRole('heading', { name: projectName, exact: true }),
    ).toBeVisible();
    held.release();
    await held.finished;
    await openOwnerPhoto({
      page: ownerPage,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    const reopenedScope = await selectOwnerScope(panel, fixture);
    const replayItem = panel.getByTestId(
      'annotation-processing-item-' + fixture.annotationId,
    );
    await expect(replayItem).toContainText('處理狀態：處理中');
    const reloadedProcessingPanel = panel.getByTestId(
      'annotation-processing-panel',
    );
    await expect(
      reloadedProcessingPanel.getByTestId('annotation-processing-retry'),
    ).toBeEnabled();
    const rawAfterReload = await ownerPage.evaluate(
      (key) => window.sessionStorage.getItem(key),
      journalKey,
    );
    const reloadedEnvelope = parseProcessingJournalEnvelope(rawAfterReload);
    assert.equal(reloadedEnvelope.version, storedEnvelope.version);
    assert.deepEqual(reloadedEnvelope.metadata, storedEnvelope.metadata);
    assert.deepEqual(
      reloadedEnvelope.metadata.command,
      storedEnvelope.metadata.command,
    );
    assert.deepEqual(
      reloadedEnvelope.metadata.expectedProcessing,
      storedEnvelope.metadata.expectedProcessing,
    );
    assert.ok(
      ['ready', 'uncertain'].includes(reloadedEnvelope.status),
      'Reload may preserve ready or mark an interrupted request uncertain, but cannot conflict or replace its metadata',
    );
    assertPrivateDataAbsent(rawAfterReload, fixture, ownerCookie);
    for (const forbidden of [
      'geometry',
      'style',
      'previewUrl',
      'result_json',
      'receipt',
    ])
      assert.equal(rawAfterReload.includes(forbidden), false);

    // The journal belongs to Owner + album, so changing the selected invite
    // must not expose or reconcile annotation A through invite B's same-photo
    // and same-version panel.
    assert.ok(fixture.otherInviteId && fixture.otherInviteAnnotationId);
    const mutationCountBeforeB =
      ownerState.observations.processingMutations.length;
    const bSwitchStartIndex = ownerState.observations.requests.length;
    await reopenedScope.invite.selectOption(fixture.otherInviteId);
    await expect(reopenedScope.version).toHaveValue(fixture.versionId);
    const bScopeRead = await waitForOwnerScopePageRead(
      ownerState,
      fixture,
      fixture.otherInviteId,
      fixture.versionId,
      bSwitchStartIndex,
    );
    const bScopePage = ownerAnnotationsPageSchema.parse(
      bScopeRead.responseBody,
    );
    assert.equal(bScopePage.inviteId, fixture.otherInviteId);
    assert.deepEqual(
      bScopePage.items.map((item) => item.annotationId),
      [fixture.otherInviteAnnotationId],
      'The actual Owner read for invite B contains only B-scoped annotations',
    );
    assert.deepEqual(bScopePage.items[0].processing, {
      state: 'open',
      revision: 0,
      annotationRevision: null,
      contentRevision: null,
      updatedAt: null,
      stale: false,
    });
    await expect(
      panel.getByTestId(
        'owner-annotation-item-' + fixture.otherInviteAnnotationId,
      ),
    ).toBeVisible();
    await expect(
      panel.getByTestId('owner-annotation-item-' + fixture.annotationId),
    ).toHaveCount(0);
    const bProcessingPanel = panel.getByTestId('annotation-processing-panel');
    await expect(
      bProcessingPanel.getByTestId(
        'annotation-processing-item-' + fixture.otherInviteAnnotationId,
      ),
    ).toHaveCount(0);
    await expect(
      bProcessingPanel.getByTestId(
        'annotation-processing-item-' + fixture.annotationId,
      ),
    ).toHaveCount(0);
    await expect(
      bProcessingPanel.locator('[data-testid^="annotation-processing-item-"]'),
    ).toHaveCount(0);
    const retryWhileBSelected = bProcessingPanel.getByTestId(
      'annotation-processing-retry',
    );
    await expect(retryWhileBSelected).toBeDisabled();
    await expect(bProcessingPanel).toContainText(
      '請切換回原邀請與照片版本後再重試。',
    );
    assert.equal(
      await ownerPage.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      rawAfterReload,
      'Selecting invite B preserves the rehydrated A journal bytes exactly',
    );
    assert.equal(
      ownerState.observations.processingMutations.length,
      mutationCountBeforeB,
      'Invite B cannot issue or retry invite A processing commands',
    );
    const bPhaseRequests =
      ownerState.observations.requests.slice(bSwitchStartIndex);
    assert.equal(
      bPhaseRequests.some(
        (record) =>
          record.method === 'POST' &&
          record.pathname === ownerCommandPath(fixture),
      ),
      false,
      'No processing POST is sent while invite B is selected',
    );
    assert.equal(
      bPhaseRequests.some((record) =>
        ownerTargetReadForScope(
          record,
          fixture,
          fixture.inviteId,
          fixture.versionId,
          fixture.annotationId,
        ),
      ),
      false,
      'No targeted read of annotation A is sent through invite B scope',
    );
    assert.equal(
      bPhaseRequests.some((record) => {
        const query = new URLSearchParams(record.search);
        return (
          record.method === 'GET' &&
          record.pathname ===
            ownerAnnotationsPath(fixture, fixture.versionId) &&
          query.has('annotationId')
        );
      }),
      false,
      'The mismatched B panel issues no targeted Guest source read',
    );

    const aSwitchBackStartIndex = ownerState.observations.requests.length;
    await reopenedScope.invite.selectOption(fixture.inviteId);
    await expect(reopenedScope.version).toHaveValue(fixture.versionId);
    const aScopeRead = await waitForOwnerScopePageRead(
      ownerState,
      fixture,
      fixture.inviteId,
      fixture.versionId,
      aSwitchBackStartIndex,
    );
    const aScopePage = ownerAnnotationsPageSchema.parse(
      aScopeRead.responseBody,
    );
    assert.ok(
      aScopePage.items.some(
        (item) => item.annotationId === fixture.annotationId,
      ),
    );
    await expect(
      panel.getByTestId('owner-annotation-item-' + fixture.annotationId),
    ).toBeVisible();
    const restoredProcessingPanel = panel.getByTestId(
      'annotation-processing-panel',
    );
    await expect(
      restoredProcessingPanel.getByTestId('annotation-processing-retry'),
    ).toBeEnabled();
    assert.equal(
      await ownerPage.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      rawAfterReload,
      'Returning to invite A restores the same rehydrated journal bytes without replacing them',
    );

    const replayPanel = restoredProcessingPanel;
    await expect(
      replayPanel.getByTestId('annotation-processing-retry'),
    ).toBeVisible();
    const replayStartIndex = ownerState.observations.requests.length;
    await replayPanel.getByTestId('annotation-processing-retry').click();
    const replayRecord = await waitForProcessingMutation(
      ownerState,
      firstCommand.requestId,
      replayStartIndex,
    );
    assert.deepEqual(replayRecord.requestBody, heldRecord.requestBody);
    assert.deepEqual(replayRecord.responseBody, heldRecord.responseBody);
    const replayMutationIndex =
      ownerState.observations.requests.indexOf(replayRecord);
    const receiptRead = await waitForOwnerTargetRead(
      ownerState,
      fixture,
      fixture.annotationId,
      replayMutationIndex + 1,
    );
    assert.ok(
      receiptRead.pathname.endsWith('/annotations'),
      'Receipt recovery reads the current Owner Guest annotation route',
    );
    assert.equal(receiptRead.pathname.includes('/annotations/owner'), false);
    const receiptPage = ownerAnnotationsPageSchema.parse(
      receiptRead.responseBody,
    );
    assert.equal(receiptPage.items.length, 1);
    assert.deepEqual(receiptPage.items[0].processing, firstReceipt.processing);
    await expect
      .poll(
        () =>
          ownerPage.evaluate(
            (key) => window.sessionStorage.getItem(key),
            journalKey,
          ),
        {
          timeout: 5000,
          message:
            'Wait for the panel to consume the successful targeted current read and clear its journal',
        },
      )
      .toBeNull();
    await expect(replayItem).toContainText('處理狀態：處理中');
    await expect(
      replayPanel.getByTestId('annotation-processing-retry'),
    ).toHaveCount(0);
    assert.deepEqual(
      await processingFootprint(db, owner, firstCommand.requestId),
      firstFootprint,
      'The exact retry returns one receipt without duplicating its audit or history',
    );
    assert.deepEqual(
      await readGuestSourceSnapshot(db, fixture.annotationId),
      sourceBeforeOwnerWrites,
      'The Owner receipt replay leaves Guest source and history unchanged',
    );

    guestState = await makeBrowserState({
      browser,
      worker: guestWorker,
      base,
      cookieName: guestCookieName(base),
      cookieValue: fixture.secretAuthor,
      kind: 'guest',
      albumId: fixture.albumId,
    });
    await openGuestPhoto(guestState.page, base, fixture);
    let sharedRead = await waitForSharedRead(guestState, fixture, 0);
    let sharedPage = guestSharedAnnotationsPageSchema.parse(
      sharedRead.responseBody,
    );
    let sharedItem = sharedPage.items.find(
      (item) => item.annotationId === fixture.annotationId,
    );
    assert.ok(sharedItem);
    assert.equal(sharedItem.isMine, true);
    assert.equal(sharedItem.processing.state, 'in_progress');
    assert.equal(sharedItem.processing.stale, false);
    const guestPanel = guestState.page.getByTestId('guest-annotations-panel');
    let guestRow = guestPanel.getByTestId(
      'annotation-item-' + fixture.annotationId,
    );
    await expect(guestRow).toContainText('攝影師處理：處理中');
    await expect(guestRow).not.toContainText('待重新確認');
    assertPrivateDataAbsent(
      JSON.stringify(sharedRead.responseBody),
      fixture,
      ownerCookie,
    );

    // Guest lifecycle revisions advance, but only geometry/content edits stale
    // the Owner's content watermark.
    const resolvedGuest = await sendGuestCommand({
      guestWorker,
      base,
      fixture,
      command: {
        requestId: randomUUID().toLowerCase(),
        expectedGuestId: fixture.authorGuestId,
        operation: 'resolve',
        annotationId: fixture.annotationId,
        expectedRevision: 1,
      },
    });
    assert.equal(resolvedGuest.item.state, 'resolved');
    assert.equal(resolvedGuest.item.revision, 2);
    const reopenedGuest = await sendGuestCommand({
      guestWorker,
      base,
      fixture,
      command: {
        requestId: randomUUID().toLowerCase(),
        expectedGuestId: fixture.authorGuestId,
        operation: 'reopen',
        annotationId: fixture.annotationId,
        expectedRevision: 2,
      },
    });
    assert.equal(reopenedGuest.item.state, 'open');
    assert.equal(reopenedGuest.item.revision, 3);
    const afterLifecycleSnapshot = await readGuestSourceSnapshot(
      db,
      fixture.annotationId,
    );
    assert.equal(
      afterLifecycleSnapshot.annotation.geometry_json,
      sourceBeforeOwnerWrites.annotation.geometry_json,
    );
    assert.equal(
      afterLifecycleSnapshot.annotation.style_json,
      sourceBeforeOwnerWrites.annotation.style_json,
    );
    assert.deepEqual(
      afterLifecycleSnapshot.history.slice(-2).map((entry) => entry.operation),
      ['resolve', 'reopen'],
    );

    let refreshedOwner = await reloadOwnerAnnotations(
      ownerState,
      panel,
      fixture,
      fixture.annotationId,
    );
    assert.equal(refreshedOwner.item.revision, 3);
    assert.equal(refreshedOwner.item.state, 'open');
    assert.equal(refreshedOwner.item.processing.state, 'in_progress');
    assert.equal(refreshedOwner.item.processing.annotationRevision, 1);
    assert.equal(refreshedOwner.item.processing.contentRevision, 1);
    assert.equal(
      refreshedOwner.item.processing.stale,
      false,
      'Guest resolve and reopen do not make an unchanged annotation body stale',
    );
    const lifecycleGuestStart = guestState.observations.requests.length;
    const lifecycleRead = await reloadGuestPhoto(
      guestState,
      base,
      fixture,
      lifecycleGuestStart,
    );
    assert.equal(lifecycleRead.item.state, 'open');
    assert.equal(lifecycleRead.item.processing.stale, false);
    await expect(
      guestState.page
        .getByTestId('guest-annotations-panel')
        .getByTestId('annotation-item-' + fixture.annotationId),
    ).not.toContainText('待重新確認');

    const sourceBeforeSecondOwnerWrite = await readGuestSourceSnapshot(
      db,
      fixture.annotationId,
    );
    const secondWriteStart = ownerState.observations.requests.length;
    await processingPanel
      .getByTestId(
        'annotation-processing-state-resolved-' + fixture.annotationId,
      )
      .click();
    await expect
      .poll(() =>
        ownerState.observations.processingMutations.some(
          (record) =>
            record.requestBody?.requestId !== firstCommand.requestId &&
            record.requestBody?.annotationId === fixture.annotationId &&
            record.requestBody?.state === 'resolved' &&
            record.status === 200 &&
            ownerState.observations.requests.indexOf(record) >=
              secondWriteStart,
        ),
      )
      .toBe(true);
    const secondRecord = ownerState.observations.processingMutations.find(
      (record) =>
        record.requestBody?.requestId !== firstCommand.requestId &&
        record.requestBody?.annotationId === fixture.annotationId &&
        record.requestBody?.state === 'resolved' &&
        record.status === 200 &&
        ownerState.observations.requests.indexOf(record) >= secondWriteStart,
    );
    const secondCommand = ownerAnnotationProcessingCommandSchema.parse(
      secondRecord.requestBody,
    );
    assert.equal(secondCommand.expectedAnnotationRevision, 3);
    assert.equal(secondCommand.expectedProcessingRevision, 1);
    const secondMutationIndex =
      ownerState.observations.requests.indexOf(secondRecord);
    const secondReceiptRead = await waitForOwnerTargetRead(
      ownerState,
      fixture,
      fixture.annotationId,
      secondMutationIndex + 1,
    );
    const secondReadPage = ownerAnnotationsPageSchema.parse(
      secondReceiptRead.responseBody,
    );
    assert.equal(secondReadPage.items[0].processing.state, 'resolved');
    assert.equal(secondReadPage.items[0].processing.revision, 2);
    assert.equal(secondReadPage.items[0].processing.annotationRevision, 3);
    assert.equal(secondReadPage.items[0].processing.contentRevision, 1);
    assert.equal(secondReadPage.items[0].processing.stale, false);
    assert.deepEqual(
      await readGuestSourceSnapshot(db, fixture.annotationId),
      sourceBeforeSecondOwnerWrite,
      'The Owner lifecycle state writes do not alter Guest geometry or history',
    );

    const sharedAfterResolvedStart = guestState.observations.requests.length;
    const guestAfterResolved = await reloadGuestPhoto(
      guestState,
      base,
      fixture,
      sharedAfterResolvedStart,
    );
    assert.equal(guestAfterResolved.item.processing.state, 'resolved');
    assert.equal(guestAfterResolved.item.processing.stale, false);

    const sourceBeforeContentEdit = await readGuestSourceSnapshot(
      db,
      fixture.annotationId,
    );
    const originalGeometry = JSON.parse(
      sourceBeforeContentEdit.annotation.geometry_json,
    );
    assert.equal(
      originalGeometry.type,
      'point',
      'The real Guest browser fixture starts with a point marker to edit',
    );
    assert.equal(sourceBeforeContentEdit.annotation.revision, 3);
    const editedGeometry = {
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: 510_000,
      y: 501_000,
    };
    const editedStyle = { color: 'blue' };
    const authorRow = guestPanel.getByTestId(
      'annotation-item-' + fixture.annotationId,
    );
    await expect(authorRow).toContainText('攝影師處理：已處理');
    await authorRow
      .getByRole('button', { name: '編輯標記', exact: true })
      .click();
    await guestPanel.getByTestId('annotation-tool-point').click();
    await guestPanel.getByRole('radio', { name: '藍色' }).check();
    const keyboardCanvas = guestPanel
      .page()
      .locator('[role="dialog"][aria-modal="true"]')
      .getByTestId('annotation-canvas')
      .locator('[role="application"]');
    await keyboardCanvas.focus();
    await keyboardCanvas.press('ArrowRight');
    await keyboardCanvas.press('Shift+ArrowDown');
    await keyboardCanvas.press('Enter');
    await expect(guestPanel.getByTestId('annotation-save')).toBeEnabled();
    const guestEditStartIndex = guestState.observations.requests.length;
    await guestPanel.getByTestId('annotation-save').click();
    const editMutation = await waitForObservation(
      guestState,
      (record) =>
        record.method === 'POST' &&
        record.pathname === guestCommandPath(fixture) &&
        record.status === 200 &&
        record.requestBody?.operation === 'update' &&
        record.requestBody?.annotationId === fixture.annotationId,
      guestEditStartIndex,
    );
    const editCommand = guestAnnotationCommandSchema.parse(
      editMutation.record.requestBody,
    );
    const editReceipt = guestAnnotationResultSchema.parse(
      editMutation.record.responseBody,
    );
    assert.equal(editCommand.expectedGuestId, fixture.authorGuestId);
    assert.equal(editCommand.expectedRevision, 3);
    assert.deepEqual(editCommand.geometry, editedGeometry);
    assert.deepEqual(editCommand.style, editedStyle);
    assert.equal(editCommand.commentId, null);
    assert.equal(editReceipt.requestId, editCommand.requestId);
    assert.equal(editReceipt.operation, 'update');
    assert.equal(editReceipt.item.annotationId, fixture.annotationId);
    assert.equal(editReceipt.item.revision, 4);
    assert.equal(editReceipt.item.state, 'open');
    assert.deepEqual(editReceipt.item.geometry, editedGeometry);
    assert.deepEqual(editReceipt.item.style, editedStyle);
    assert.equal(Object.hasOwn(editReceipt.item, 'processing'), false);

    const ownRead = await waitForObservation(
      guestState,
      (record) =>
        guestExactRead(
          record,
          guestOwnPath(fixture, fixture.versionId),
          fixture.annotationId,
        ),
      editMutation.index + 1,
    );
    const ownPage = guestAnnotationsPageSchema.parse(
      ownRead.record.responseBody,
    );
    assert.equal(ownPage.items.length, 1);
    assert.equal(ownPage.items[0].annotationId, fixture.annotationId);
    assert.equal(ownPage.items[0].revision, 4);
    assert.equal(Object.hasOwn(ownPage.items[0], 'processing'), false);
    const sharedTargetRead = await waitForObservation(
      guestState,
      (record) =>
        guestExactRead(
          record,
          guestSharedPath(fixture, fixture.versionId),
          fixture.annotationId,
        ),
      ownRead.index + 1,
    );
    assert.ok(
      editMutation.index < ownRead.index &&
        ownRead.index < sharedTargetRead.index,
      'The real update reconciles its own-only row before fetching the shared processing projection',
    );
    const sharedTargetPage = guestSharedAnnotationsPageSchema.parse(
      sharedTargetRead.record.responseBody,
    );
    assert.equal(sharedTargetPage.items.length, 1);
    const sharedTargetItem = sharedTargetPage.items[0];
    assert.equal(sharedTargetItem.annotationId, fixture.annotationId);
    assert.equal(sharedTargetItem.revision, 4);
    assert.deepEqual(sharedTargetItem.geometry, editedGeometry);
    assert.deepEqual(sharedTargetItem.style, editedStyle);
    assert.equal(sharedTargetItem.processing.state, 'resolved');
    assert.equal(sharedTargetItem.processing.revision, 2);
    assert.equal(sharedTargetItem.processing.annotationRevision, 3);
    assert.equal(sharedTargetItem.processing.contentRevision, 1);
    assert.equal(sharedTargetItem.processing.stale, true);
    assertPrivateDataAbsent(
      JSON.stringify(sharedTargetRead.record.responseBody),
      fixture,
      ownerCookie,
    );
    await expect(authorRow).toContainText('攝影師處理：已處理');
    await expect(authorRow).toContainText('標記內容已更新，待重新確認');
    await expect
      .poll(() =>
        guestState.page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          'kino-pic:guest-annotations:v1:' +
            fixture.authorGuestId +
            ':' +
            fixture.albumId,
        ),
      )
      .toBeNull();

    const sourceAfterContentEdit = await readGuestSourceSnapshot(
      db,
      fixture.annotationId,
    );
    assert.notEqual(
      sourceAfterContentEdit.annotation.geometry_json,
      sourceBeforeContentEdit.annotation.geometry_json,
    );
    assert.equal(sourceAfterContentEdit.annotation.revision, 4);
    assert.deepEqual(
      JSON.parse(sourceAfterContentEdit.annotation.geometry_json),
      editedGeometry,
    );
    assert.deepEqual(
      JSON.parse(sourceAfterContentEdit.annotation.style_json),
      editedStyle,
    );
    assert.equal(sourceAfterContentEdit.history.at(-1)?.operation, 'update');
    assert.equal(
      sourceAfterContentEdit.history.at(-1)?.request_id,
      editCommand.requestId,
    );

    refreshedOwner = await reloadOwnerAnnotations(
      ownerState,
      panel,
      fixture,
      fixture.annotationId,
    );
    assert.equal(refreshedOwner.item.revision, 4);
    assert.equal(refreshedOwner.item.processing.state, 'resolved');
    assert.equal(refreshedOwner.item.processing.revision, 2);
    assert.equal(refreshedOwner.item.processing.annotationRevision, 3);
    assert.equal(refreshedOwner.item.processing.contentRevision, 1);
    assert.equal(
      refreshedOwner.item.processing.stale,
      true,
      'A Guest geometry/content edit makes the acknowledged processing state stale',
    );
    await expect(
      panel.getByTestId('annotation-processing-item-' + fixture.annotationId),
    ).toContainText('客戶已更新標記');
    await expect(
      panel.getByTestId('annotation-processing-reack-' + fixture.annotationId),
    ).toBeVisible();
    const sharedAfterEditStart = guestState.observations.requests.length;
    const guestAfterEdit = await reloadGuestPhoto(
      guestState,
      base,
      fixture,
      sharedAfterEditStart,
    );
    assert.equal(guestAfterEdit.item.processing.stale, true);
    await expect(
      guestState.page
        .getByTestId('guest-annotations-panel')
        .getByTestId('annotation-item-' + fixture.annotationId),
    ).toContainText('標記內容已更新，待重新確認');

    const sourceBeforeReack = await readGuestSourceSnapshot(
      db,
      fixture.annotationId,
    );
    const reackStartIndex = ownerState.observations.requests.length;
    await panel
      .getByTestId('annotation-processing-reack-' + fixture.annotationId)
      .click();
    await expect
      .poll(() =>
        ownerState.observations.processingMutations.some(
          (record) =>
            record.requestBody?.annotationId === fixture.annotationId &&
            record.requestBody?.expectedProcessingRevision === 2 &&
            record.requestBody?.expectedAnnotationRevision === 4 &&
            record.requestBody?.state === 'resolved' &&
            record.status === 200 &&
            ownerState.observations.requests.indexOf(record) >= reackStartIndex,
        ),
      )
      .toBe(true);
    const reackRecord = ownerState.observations.processingMutations.find(
      (record) =>
        record.requestBody?.annotationId === fixture.annotationId &&
        record.requestBody?.expectedProcessingRevision === 2 &&
        record.requestBody?.expectedAnnotationRevision === 4 &&
        record.requestBody?.state === 'resolved' &&
        record.status === 200 &&
        ownerState.observations.requests.indexOf(record) >= reackStartIndex,
    );
    const reackCommand = ownerAnnotationProcessingCommandSchema.parse(
      reackRecord.requestBody,
    );
    const reackReceipt = ownerAnnotationProcessingResultSchema.parse(
      reackRecord.responseBody,
    );
    assert.equal(reackReceipt.processing.revision, 3);
    assert.equal(reackReceipt.processing.annotationRevision, 4);
    assert.equal(
      reackReceipt.processing.contentRevision,
      editReceipt.item.revision,
      'The reack watermark records the latest Guest create/update revision, not an edit count',
    );
    assert.equal(reackReceipt.processing.stale, false);
    const reackMutationIndex =
      ownerState.observations.requests.indexOf(reackRecord);
    const reackRead = await waitForOwnerTargetRead(
      ownerState,
      fixture,
      fixture.annotationId,
      reackMutationIndex + 1,
    );
    const reackPage = ownerAnnotationsPageSchema.parse(reackRead.responseBody);
    assert.deepEqual(reackPage.items[0].processing, reackReceipt.processing);
    await expect
      .poll(() =>
        ownerPage.evaluate((key) => sessionStorage.getItem(key), journalKey),
      )
      .toBeNull();
    await expect(
      panel.getByTestId('annotation-processing-item-' + fixture.annotationId),
    ).toContainText('處理狀態：已處理');
    await expect(
      panel.getByTestId('annotation-processing-reack-' + fixture.annotationId),
    ).toHaveCount(0);
    assert.deepEqual(
      await readGuestSourceSnapshot(db, fixture.annotationId),
      sourceBeforeReack,
      'Explicit Owner reack does not mutate Guest annotation geometry or history',
    );
    const reackFootprint = await processingFootprint(
      db,
      owner,
      reackCommand.requestId,
    );
    assert.equal(reackFootprint.length, 1);
    assert.deepEqual(JSON.parse(reackFootprint[0].request_json), reackCommand);
    assert.equal(reackFootprint[0].processing_revision, 3);
    assert.equal(reackFootprint[0].annotation_revision, 4);
    assert.equal(
      reackFootprint[0].content_revision,
      sourceAfterContentEdit.annotation.revision,
    );
    assert.equal(
      reackFootprint[0].audit_action,
      'owner.annotation_processing_changed',
    );

    await assertNoHorizontalOverflow(ownerPage, 'Owner processing panel');
    await assertNoHorizontalOverflow(
      guestState.page,
      'Guest shared processing status',
    );
    await mkdir('.local', { recursive: true });
    await ownerPage.screenshot({
      path: '.local/annotation-processing-owner-mobile.png',
      fullPage: true,
    });
    const finalGuestStart = guestState.observations.requests.length;
    const finalGuest = await reloadGuestPhoto(
      guestState,
      base,
      fixture,
      finalGuestStart,
    );
    assert.equal(finalGuest.item.processing.state, 'resolved');
    assert.equal(finalGuest.item.processing.stale, false);
    assert.equal(
      finalGuest.item.processing.contentRevision,
      editReceipt.item.revision,
    );
    await expect(
      guestState.page
        .getByTestId('guest-annotations-panel')
        .getByTestId('annotation-item-' + fixture.annotationId),
    ).toContainText('攝影師處理：已處理');
    await assertNoHorizontalOverflow(
      guestState.page,
      'Guest shared processing status after reack',
    );
    await assertGuestProcessingStatusVisible(
      guestState.page,
      fixture.annotationId,
    );
    await guestState.page.screenshot({
      path: '.local/annotation-processing-guest-mobile.png',
      fullPage: true,
    });
    assert.deepEqual(ownerState.observations.pageErrors, []);
    assert.deepEqual(guestState.observations.pageErrors, []);
    assert.deepEqual(ownerState.observations.bridgeErrors, []);
    assert.deepEqual(guestState.observations.bridgeErrors, []);
  } finally {
    processingTransport?.releaseAll();
    if (guestState) await guestState.close();
    if (ownerState) await ownerState.close();
    await browser.close();
  }
}
