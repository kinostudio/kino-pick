import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { guestAnnotationJournalMetadataSchema } from '../../web/target-ui/guest-annotation-journal.ts';
import {
  assertNoHorizontalOverflow,
  guestCookieName,
  makeBrowserState,
} from './owner-comments-browser.mjs';

const coordinateScale = 1000000;
const guestViewPermission = 1;
const guestCompareVersionsPermission = 2048;

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

function ownAnnotationsPath(fixture, versionId) {
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

function sharedAnnotationsPath(fixture, versionId) {
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

function annotationCommandPath(fixture) {
  return (
    '/api/guest/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/annotations/commands'
  );
}

function normalizedPoint(x, y) {
  return {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: Math.round(x * coordinateScale),
    y: Math.round(y * coordinateScale),
  };
}

function makeReplacementJournal(metadata, geometry) {
  assert.equal(metadata.command.operation, 'create');
  const replacement = {
    ...metadata,
    command: {
      ...metadata.command,
      requestId: randomUUID(),
      geometry,
    },
  };
  guestAnnotationJournalMetadataSchema.parse(replacement);
  return replacement;
}

async function writeJournalRaw(page, key, raw) {
  await page.evaluate(
    ([storageKey, value]) => window.sessionStorage.setItem(storageKey, value),
    [key, raw],
  );
}

function sourcePointFromClient(point) {
  const clientX = Math.round(point.x);
  const clientY = Math.round(point.y);
  return {
    x: (clientX - point.painted.left) / point.painted.width,
    y: (clientY - point.painted.top) / point.painted.height,
  };
}

function assertPointInsideViewport(point) {
  assert.ok(point.x >= point.viewport.left);
  assert.ok(point.x <= point.viewport.left + point.viewport.width);
  assert.ok(point.y >= point.viewport.top);
  assert.ok(point.y <= point.viewport.top + point.viewport.height);
}

function expectedRectangle(first, second) {
  const sourceFirst = sourcePointFromClient(first);
  const sourceSecond = sourcePointFromClient(second);
  const x1 = Math.round(sourceFirst.x * coordinateScale);
  const y1 = Math.round(sourceFirst.y * coordinateScale);
  const x2 = Math.round(sourceSecond.x * coordinateScale);
  const y2 = Math.round(sourceSecond.y * coordinateScale);
  return {
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

async function comparisonOptionsDiagnostics({
  select,
  moreButton,
  comparison,
  state,
  fixture,
  targetValue,
  description,
}) {
  const [optionDetails, selectState, moreCount, moreState, panelText] =
    await Promise.all([
      select.locator('option').evaluateAll((options) =>
        options.map((option) => ({
          value: option.value,
          text: option.textContent?.trim() ?? '',
          disabled: option.disabled,
          selected: option.selected,
        })),
      ),
      select
        .evaluate((element) => ({
          disabled: element.disabled,
          value: element.value,
        }))
        .catch(() => null),
      moreButton.count(),
      moreButton
        .evaluate((element) => ({
          disabled: element.disabled,
          text: element.textContent?.trim() ?? '',
        }))
        .catch(() => null),
      comparison.innerText().catch(() => ''),
    ]);
  const versionsPath =
    '/api/guest/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/photos/' +
    encodeURIComponent(fixture.photoId) +
    '/versions';
  const versionReads = state.observations.requests
    .filter(
      (record) => record.method === 'GET' && record.pathname === versionsPath,
    )
    .map((record) => ({
      search: record.search,
      status: record.status,
      response:
        record.status >= 400
          ? record.responseBody
          : {
              albumId: record.responseBody?.albumId,
              photoId: record.responseBody?.photoId,
              head: record.responseBody?.head,
              currentVersion: record.responseBody?.currentVersion
                ? {
                    versionId: record.responseBody.currentVersion.versionId,
                    versionNo: record.responseBody.currentVersion.versionNo,
                    isCurrent: record.responseBody.currentVersion.isCurrent,
                  }
                : null,
              versions: Array.isArray(record.responseBody?.versions)
                ? record.responseBody.versions.map((version) => ({
                    versionId: version.versionId,
                    versionNo: version.versionNo,
                    isCurrent: version.isCurrent,
                  }))
                : null,
              nextCursorPresent:
                typeof record.responseBody?.nextCursor === 'string',
            },
    }));

  return {
    description,
    requestedVersionId: targetValue,
    fixturePermissionMask: fixture.permissionsMask,
    databasePermissionMask:
      state.observations.guestAnnotationPermissionMask ?? null,
    requiredPermissionMask:
      guestViewPermission | guestCompareVersionsPermission,
    options: optionDetails,
    select: selectState,
    moreButton: { count: moreCount, state: moreState },
    panelText: panelText.slice(0, 2000),
    versionReads,
    pageErrors: state.observations.pageErrors,
    bridgeErrors: state.observations.bridgeErrors,
  };
}

async function waitForOptions(
  select,
  moreButton,
  targetValue,
  description,
  diagnosticsInput,
) {
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (values.includes(targetValue)) return;
    const more = moreButton;
    try {
      await expect
        .poll(async () => {
          const current = await select
            .locator('option')
            .evaluateAll((options) => options.map((option) => option.value));
          return current.includes(targetValue) || (await more.count()) === 1;
        })
        .toBe(true);
    } catch (error) {
      const diagnostic = await comparisonOptionsDiagnostics({
        select,
        moreButton: more,
        ...diagnosticsInput,
        targetValue,
        description,
      });
      throw new Error(
        description +
          ' did not load its target option and has no load-more control. Diagnostic: ' +
          JSON.stringify(diagnostic),
        { cause: error },
      );
    }
    const updated = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (updated.includes(targetValue)) return;
    const before = updated.length;
    await expect(more).toBeVisible();
    await more.click();
    await expect
      .poll(() => select.locator('option').evaluateAll((items) => items.length))
      .toBeGreaterThan(before);
  }
  assert.fail(description + ' was not found after loading available pages');
}

async function openGuestPhoto(page, base, fixture) {
  const response = await page.goto(
    new URL('/guest/albums/' + encodeURIComponent(fixture.albumId), base).href,
    { waitUntil: 'domcontentloaded' },
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
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: fixture.filename, exact: true }),
  ).toBeVisible();
}

function activeCanvasFor(panel) {
  return panel
    .page()
    .locator('[role="dialog"][aria-modal="true"]')
    .getByTestId('annotation-canvas');
}

async function findPreviewImage(panel) {
  const canvas = activeCanvasFor(panel);
  await expect(canvas).toBeVisible();
  const image = canvas.getByTestId('annotation-preview-image');
  await expect(image).toBeVisible();
  return image;
}

async function pointOnImage(panel, fractionX, fractionY) {
  const image = await findPreviewImage(panel);
  await expect(image).toBeVisible();
  return image.evaluate(
    (element, fractions) => {
      const image = element;
      if (!(image instanceof HTMLImageElement))
        throw new Error('The annotation preview must be an image element');
      if (image.naturalWidth < 1 || image.naturalHeight < 1)
        throw new Error('The private preview image is not decoded');
      const box = image.getBoundingClientRect();
      const viewportElement = image.closest('[role="application"]');
      if (!(viewportElement instanceof HTMLElement))
        throw new Error(
          'The annotation preview must be inside its drawing viewport',
        );
      const viewportBounds = viewportElement.getBoundingClientRect();
      const style = getComputedStyle(image);
      let painted = {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      };
      if (style.objectFit === 'contain') {
        const scale = Math.min(
          box.width / image.naturalWidth,
          box.height / image.naturalHeight,
        );
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        painted = {
          left: box.left + (box.width - width) / 2,
          top: box.top + (box.height - height) / 2,
          width,
          height,
        };
      }
      return {
        x: painted.left + painted.width * fractions.x,
        y: painted.top + painted.height * fractions.y,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        painted,
        element: {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        },
        viewport: {
          left: viewportBounds.left,
          top: viewportBounds.top,
          width: viewportBounds.width,
          height: viewportBounds.height,
        },
      };
    },
    { x: fractionX, y: fractionY },
  );
}

async function currentRow(db, annotationId) {
  const row = await db
    .prepare(
      'SELECT id,invite_id,author_guest_id,photo_id,version_id,geometry_json,style_json,state,revision FROM guest_annotations WHERE id=?',
    )
    .bind(annotationId)
    .first();
  assert.ok(row, 'The expected annotation row must exist');
  return {
    ...row,
    geometry: row.geometry_json ? JSON.parse(row.geometry_json) : null,
    style: row.style_json ? JSON.parse(row.style_json) : null,
  };
}

async function annotationIdsForInvite(db, fixture, inviteId, versionId) {
  const rows = await db
    .prepare(
      'SELECT id FROM guest_annotations WHERE invite_id=? AND photo_id=? AND version_id=? ORDER BY created_at_ms,id',
    )
    .bind(inviteId, fixture.photoId, versionId)
    .all();
  return rows.results.map((row) => row.id);
}

async function assertPeerControlsAbsent(row) {
  for (const label of [
    '編輯標記',
    '標記已處理',
    '重新開啟',
    '刪除標記',
    '確認刪除標記',
  ])
    await expect(
      row.getByRole('button', { name: label, exact: true }),
    ).toHaveCount(0);
}

async function assertMarkerStroke(panel, annotationId) {
  const marker = activeCanvasFor(panel).getByTestId(
    'annotation-mark-' + annotationId,
  );
  await expect(marker).toBeVisible();
  const shape = marker.locator('ellipse, rect').first();
  const computed = await shape.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      vectorEffect: style.getPropertyValue('vector-effect').trim(),
      strokeWidth: Number.parseFloat(style.strokeWidth),
    };
  });
  assert.equal(
    computed.vectorEffect,
    'non-scaling-stroke',
    'The rendered SVG shape keeps a non-scaling stroke at the mobile viewport',
  );
  assert.ok(
    computed.strokeWidth >= 3,
    'The rendered SVG shape stroke stays at least 3 CSS pixels wide',
  );
}

function addAnnotationTransportControls({ state, worker, base, fixture }) {
  let dropNextSuccessful = false;
  let nextHeld = null;
  let customSequence = 0;
  state.observations.guestAnnotationCommandPath =
    annotationCommandPath(fixture);
  state.observations.guestAnnotationJournalKey =
    'kino-pic:guest-annotations:v1:' +
    fixture.authorGuestId +
    ':' +
    fixture.albumId;
  state.observations.guestAnnotationMutations = [];

  const actualFetch = async (incoming, pathname) => {
    const method = incoming.method();
    const headers = await incoming.allHeaders();
    const cookieNames = (headers.cookie ?? '')
      .split(';')
      .map((part) => part.split('=', 1)[0]?.trim())
      .filter(Boolean)
      .sort();
    headers['cf-connecting-ip'] = '198.51.100.174';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD')
      init.body = incoming.postDataBuffer() ?? undefined;
    const response = await worker.fetch(new Request(incoming.url(), init));
    const bytes = Buffer.from(await response.arrayBuffer());
    const record = {
      sequence: 1000000 + ++customSequence,
      method,
      pathname,
      search: new URL(incoming.url()).search,
      status: response.status,
      responseBody: parseJson(bytes),
      requestBody: parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0)),
      cookieNames,
      origin: headers.origin ?? null,
      dropped: false,
      held: false,
      delivered: false,
    };
    state.observations.requests.push(record);
    state.observations.guestAnnotationMutations.push(record);
    return { response, bytes, record };
  };

  const deliver = async (route, response, bytes, record, status) => {
    if (status === 'drop' && response.ok) {
      record.dropped = true;
      record.deliveryOverride = 'test-only transport drop';
      try {
        await route.abort('failed');
      } catch {
        record.deliveryError = 'The browser request had already ended';
      }
      return;
    }
    const deliveredStatus =
      typeof status === 'number' ? status : response.status;
    record.deliveryOverride =
      typeof status === 'number' ? 'test-only HTTP ' + status : null;
    const headers = Object.fromEntries(response.headers.entries());
    delete headers['content-length'];
    try {
      await route.fulfill({
        status: deliveredStatus,
        headers:
          deliveredStatus === 401
            ? { 'content-type': 'application/json; charset=utf-8' }
            : headers,
        body:
          deliveredStatus === 401
            ? JSON.stringify({ error: { code: 'GUEST_ACCESS_REQUIRED' } })
            : bytes,
      });
      record.delivered = true;
      record.deliveredStatus = deliveredStatus;
    } catch {
      record.deliveryError = 'The browser request had already ended';
    }
  };

  state.page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (
      url.origin !== new URL(base).origin ||
      incoming.method() !== 'POST' ||
      url.pathname !== annotationCommandPath(fixture)
    ) {
      await route.fallback();
      return;
    }

    let result;
    try {
      result = await actualFetch(incoming, url.pathname);
    } catch (error) {
      const record = {
        method: incoming.method(),
        pathname: url.pathname,
        search: url.search,
        requestBody: parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0)),
        status: 0,
        bridgeError: error instanceof Error ? error.message : String(error),
      };
      state.observations.guestAnnotationMutations.push(record);
      state.observations.requests.push(record);
      state.observations.bridgeErrors.push(record.bridgeError);
      try {
        await route.abort('failed');
      } catch {
        record.deliveryError = 'The browser request had already ended';
      }
      return;
    }
    if (dropNextSuccessful && result.response.ok) {
      dropNextSuccessful = false;
      await deliver(
        route,
        result.response,
        result.bytes,
        result.record,
        'drop',
      );
      return;
    }

    if (nextHeld && result.response.ok) {
      const held = nextHeld;
      nextHeld = null;
      held.record = result.record;
      held.resolveSeen();
      result.record.held = true;
      await held.delivery;
      try {
        await deliver(
          route,
          result.response,
          result.bytes,
          result.record,
          held.deliveryStatus,
        );
      } finally {
        held.resolveFinished();
      }
      return;
    }

    await deliver(route, result.response, result.bytes, result.record, null);
  });

  return {
    dropNextSuccessfulResponse() {
      dropNextSuccessful = true;
    },
    holdNextSuccessfulResponse() {
      assert.equal(nextHeld, null);
      let releaseDelivery;
      let resolveSeen;
      let resolveFinished;
      let released = false;
      const held = {
        record: null,
        deliveryStatus: null,
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
        release(deliveryStatus = null) {
          if (released) return;
          released = true;
          held.deliveryStatus = deliveryStatus;
          releaseDelivery();
        },
      };
      nextHeld = held;
      return held;
    },
    releaseHeldResponse() {
      nextHeld?.release();
    },
  };
}

async function requestGuestCommand({ worker, base, fixture, command }) {
  const cookie = guestCookieName(base) + '=' + fixture.secretAuthor;
  const response = await worker.fetch(
    new Request(new URL(annotationCommandPath(fixture), base), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Origin: new URL(base).origin,
        Cookie: cookie,
        'Content-Type': 'application/json',
        'cf-connecting-ip': '198.51.100.175',
      },
      body: JSON.stringify(command),
      redirect: 'manual',
    }),
  );
  return { response, body: parseJson(await response.arrayBuffer()) };
}

async function assertStorageBlocksReplacement({
  browser,
  worker,
  base,
  fixture,
  corrupt,
}) {
  const state = await makeBrowserState({
    browser,
    worker,
    base,
    cookieName: guestCookieName(base),
    cookieValue: fixture.secretAuthor,
    kind: 'guest',
    albumId: fixture.albumId,
  });
  const key =
    'kino-pic:guest-annotations:v1:' +
    fixture.authorGuestId +
    ':' +
    fixture.albumId;
  await state.page.addInitScript(
    ({ storageKey, corruptStorage }) => {
      if (corruptStorage) {
        window.sessionStorage.setItem(storageKey, '{not-json');
        return;
      }
      const originalGetItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name) {
        if (name === storageKey)
          throw new Error('sessionStorage is unavailable');
        return originalGetItem.call(this, name);
      };
    },
    { storageKey: key, corruptStorage: corrupt },
  );
  try {
    await openGuestPhoto(state.page, base, fixture);
    const panel = state.page.getByTestId('guest-annotations-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('alert')).toContainText('標註復原記錄');
    await expect(panel.getByTestId('annotation-tool-point')).toBeDisabled();
    assert.equal(
      state.observations.requests.some(
        (record) =>
          record.method === 'POST' &&
          record.pathname === annotationCommandPath(fixture),
      ),
      false,
      'A corrupt or unreadable session journal blocks replacement writes',
    );
    assert.deepEqual(state.observations.bridgeErrors, []);
    assert.deepEqual(state.observations.pageErrors, []);
  } finally {
    await state.close();
  }
}

async function waitForMutation(
  state,
  predicate,
  afterIndex = 0,
  description = 'Guest annotation command',
) {
  try {
    await expect
      .poll(() =>
        state.observations.guestAnnotationMutations.some(
          (record, index) => index >= afterIndex && predicate(record),
        ),
      )
      .toBe(true);
  } catch (error) {
    let panel = null;
    try {
      panel = await state.page
        .getByTestId('guest-annotations-panel')
        .evaluate((element) => ({
          text: element.innerText,
          alerts: Array.from(element.querySelectorAll('[role="alert"]')).map(
            (item) => item.innerText,
          ),
          statuses: Array.from(element.querySelectorAll('[role="status"]')).map(
            (item) => item.innerText,
          ),
          saveButtons: Array.from(
            element.querySelectorAll('[data-testid="annotation-save"]'),
          ).map((button) => ({
            disabled: button.disabled,
            text: button.innerText,
          })),
        }));
      panel.portalCanvas = await activeCanvasFor(
        state.page.getByTestId('guest-annotations-panel'),
      )
        .evaluate((canvas) => {
          const image = canvas.querySelector(
            '[data-testid="annotation-preview-image"]',
          );
          return {
            bounds: canvas.getBoundingClientRect().toJSON(),
            application: Boolean(canvas.querySelector('[role="application"]')),
            draftMark: Boolean(
              canvas.querySelector('[data-testid="annotation-draft-mark"]'),
            ),
            image:
              image instanceof HTMLImageElement
                ? {
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    rect: image.getBoundingClientRect().toJSON(),
                  }
                : null,
          };
        })
        .catch((canvasError) => ({ readError: String(canvasError) }));
    } catch (panelError) {
      panel = { readError: String(panelError) };
    }
    const commandPath = state.observations.guestAnnotationCommandPath;
    const recentRequests = state.observations.requests
      .filter((record) => record.pathname === commandPath)
      .slice(-8)
      .map((record) => ({
        method: record.method,
        pathname: record.pathname,
        status: record.status,
        requestBody: record.requestBody,
        cookieNames: record.cookieNames,
        origin: record.origin,
        responseBody: record.responseBody,
        dropped: record.dropped,
        held: record.held,
        deliveredStatus: record.deliveredStatus,
        deliveryOverride: record.deliveryOverride,
        bridgeError: record.bridgeError,
      }));
    const journal = await state.page
      .evaluate((key) => {
        const raw = window.sessionStorage.getItem(key);
        if (raw === null) return { present: false };
        try {
          const value = JSON.parse(raw);
          return {
            present: true,
            validJson: true,
            requestId: value?.command?.requestId ?? null,
            operation: value?.command?.operation ?? null,
            photoId: value?.command?.photoId ?? null,
            versionId: value?.command?.versionId ?? null,
            hasBody: Object.hasOwn(value?.command ?? {}, 'body'),
          };
        } catch {
          return { present: true, validJson: false };
        }
      }, state.observations.guestAnnotationJournalKey)
      .catch((journalError) => ({ readError: String(journalError) }));
    const diagnostic = {
      description,
      observedMutations: state.observations.guestAnnotationMutations.length,
      recentCommandRequests: recentRequests,
      panel,
      journal,
      pageErrors: state.observations.pageErrors,
      bridgeErrors: state.observations.bridgeErrors,
    };
    throw new Error(
      description +
        ' was not observed. Diagnostic: ' +
        JSON.stringify(diagnostic),
      { cause: error },
    );
  }
  return state.observations.guestAnnotationMutations.find(
    (record, index) => index >= afterIndex && predicate(record),
  );
}

async function waitForSharedRead(state, fixture, versionId, afterIndex = 0) {
  const prefix = sharedAnnotationsPath(fixture, versionId);
  const matches = (record, index) =>
    index >= afterIndex &&
    record.method === 'GET' &&
    record.pathname === prefix &&
    record.status === 200;
  await expect.poll(() => state.observations.requests.some(matches)).toBe(true);
  return state.observations.requests.find(matches);
}

async function waitForTargetedOwnRead(
  state,
  fixture,
  versionId,
  annotationId,
  afterIndex = 0,
) {
  const pathname = ownAnnotationsPath(fixture, versionId);
  const matches = (record, index) =>
    index >= afterIndex &&
    record.method === 'GET' &&
    record.pathname === pathname &&
    record.status === 200 &&
    new URLSearchParams(record.search).get('annotationId') === annotationId;
  await expect.poll(() => state.observations.requests.some(matches)).toBe(true);
  return state.observations.requests.find(matches);
}

async function openComparisonAfter(page, fixture, versionId, state) {
  await page.getByTestId('guest-compare-open').click();
  const comparison = page.getByTestId('guest-version-comparison');
  await expect(comparison).toBeVisible();
  const after = comparison.getByTestId('compare-after');
  const before = comparison.getByTestId('compare-before');
  const more = comparison.getByRole('button', {
    name: '載入更多版本',
    exact: true,
  });
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
      'A third loaded version is available so the requested After version can remain distinct',
    );
    await before.selectOption(replacementBefore);
    await expect(before).toHaveValue(replacementBefore);
  }
  await waitForOptions(after, more, versionId, 'The selected After version', {
    comparison,
    state,
    fixture,
  });
  await after.selectOption(versionId);
  assert.notEqual(
    await before.inputValue(),
    versionId,
    'The selected Before and After versions remain distinct',
  );
  await expect(after).toHaveValue(versionId);
  return comparison;
}

async function loadAllGuestVersions(comparison) {
  const after = comparison.getByTestId('compare-after');
  const more = comparison.getByTestId('compare-load-more');
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    if ((await more.count()) === 0) return;
    const before = await after
      .locator('option')
      .evaluateAll((options) => options.length);
    await more.click();
    await expect
      .poll(async () => {
        const count = await after
          .locator('option')
          .evaluateAll((options) => options.length);
        return count > before || (await more.count()) === 0;
      })
      .toBe(true);
  }
  assert.fail('All Guest versions should finish loading within twenty pages');
}

async function clickAnnotation(panel, fractions) {
  const canvas = activeCanvasFor(panel);
  await panel.getByTestId('annotation-tool-point').click();
  await canvas.scrollIntoViewIfNeeded();
  const point = await pointOnImage(panel, fractions.x, fractions.y);
  assertPointInsideViewport(point);
  await panel.page().mouse.click(Math.round(point.x), Math.round(point.y));
  return {
    expected: normalizedPoint(
      sourcePointFromClient(point).x,
      sourcePointFromClient(point).y,
    ),
    actual: point,
  };
}

async function drawReverseRectangle(panel, from, to) {
  const canvas = activeCanvasFor(panel);
  await panel.getByTestId('annotation-tool-rectangle').click();
  await canvas.scrollIntoViewIfNeeded();
  const start = await pointOnImage(panel, from.x, from.y);
  const end = await pointOnImage(panel, to.x, to.y);
  assertPointInsideViewport(start);
  assertPointInsideViewport(end);
  await panel.page().mouse.move(Math.round(start.x), Math.round(start.y));
  await panel.page().mouse.down();
  await panel.page().mouse.move(Math.round(end.x), Math.round(end.y), {
    steps: 8,
  });
  await panel.page().mouse.up();
  return expectedRectangle(start, end);
}

async function assertNoForbiddenGuestData(record, fixture) {
  const serialized = JSON.stringify(record.responseBody);
  for (const value of [
    fixture.secretAuthor,
    fixture.secretPeer,
    fixture.inviteToken,
    'objectKey',
    'previewUrl',
    'originalUrl',
    'commentBody',
  ])
    assert.equal(serialized.includes(value), false);
}

export async function runGuestAnnotationsBrowserChecks({
  db,
  worker,
  base,
  fixture: annotationChecks,
}) {
  assert.ok(db && worker && base);
  assert.equal(
    typeof annotationChecks?.createBrowserFixture,
    'function',
    'The accepted Guest API checks return a fresh real-session fixture factory',
  );
  const fixture = await annotationChecks.createBrowserFixture();
  for (const key of [
    'albumId',
    'photoId',
    'versionId',
    'currentVersionId',
    'draftVersionId',
    'permissionsMask',
    'filename',
    'authorInviteId',
    'authorGuestId',
    'secretAuthor',
    'peerGuestId',
    'secretPeer',
    'otherGuestId',
    'secretOtherInvite',
    'otherAuthorLabel',
    'annotationId',
    'peerAnnotationId',
    'otherInviteAnnotationId',
  ])
    assert.ok(fixture?.[key], 'The annotation fixture provides ' + key);

  const invitePermission = await db
    .prepare('SELECT permissions_mask FROM guest_invites WHERE id=?')
    .bind(fixture.authorInviteId)
    .first();
  assert.ok(invitePermission?.permissions_mask);
  assert.equal(
    Number(invitePermission.permissions_mask),
    fixture.permissionsMask,
  );
  const requiredComparisonPermissions =
    guestViewPermission | guestCompareVersionsPermission;
  assert.equal(
    Number(invitePermission.permissions_mask) & requiredComparisonPermissions,
    requiredComparisonPermissions,
    'The actual browser Guest invite has both view and compare permissions',
  );

  const portraitVersion = await db
    .prepare(
      'SELECT id,width,height FROM photo_versions WHERE photo_id=? AND version_no=2',
    )
    .bind(fixture.photoId)
    .first();
  assert.ok(portraitVersion?.id, 'The real V2 portrait fixture exists');
  assert.ok(
    Number(portraitVersion.height) > Number(portraitVersion.width),
    'The real V2 fixture has portrait source dimensions',
  );

  const browser = await chromium.launch({ headless: true });
  let authorState;
  let peerState;
  let otherState;
  try {
    authorState = await makeBrowserState({
      browser,
      worker,
      base,
      cookieName: guestCookieName(base),
      cookieValue: fixture.secretAuthor,
      kind: 'guest',
      albumId: fixture.albumId,
    });
    authorState.observations.guestAnnotationPermissionMask = Number(
      invitePermission.permissions_mask,
    );
    const transport = addAnnotationTransportControls({
      state: authorState,
      worker,
      base,
      fixture,
    });
    const { page, observations } = authorState;
    await openGuestPhoto(page, base, fixture);
    const dialog = page.getByRole('dialog');
    const thumbnailRail = dialog.getByRole('navigation', {
      name: '相簿照片縮圖列',
    });
    const inspectRail = () =>
      thumbnailRail.evaluate((rail) => {
        const dialog = rail.closest('.kino-photo-detail-dialog');
        const stage = dialog?.querySelector('.kino-photo-detail-stage');
        if (!(stage instanceof HTMLElement) || !(dialog instanceof HTMLElement))
          throw new Error('Guest filmstrip is missing its lightbox stage');
        const railBounds = rail.getBoundingClientRect();
        const stageBounds = stage.getBoundingClientRect();
        const style = getComputedStyle(rail);
        const number = (value) => Number.parseFloat(value) || 0;
        const contentLeft =
          railBounds.left +
          number(style.borderLeftWidth) +
          number(style.paddingLeft);
        const contentRight =
          railBounds.right -
          number(style.borderRightWidth) -
          number(style.paddingRight);
        const thumbnails = Array.from(rail.querySelectorAll('button')).map(
          (button) => {
            const bounds = button.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
            };
          },
        );
        const selected = rail.querySelector('button[aria-current="true"]');
        const selectedBounds = selected?.getBoundingClientRect();
        return {
          noOverlap: stageBounds.bottom <= railBounds.top + 1,
          rail: {
            top: railBounds.top,
            bottom: railBounds.bottom,
            height: railBounds.height,
            contentLeft,
            contentRight,
          },
          stage: {
            top: stageBounds.top,
            bottom: stageBounds.bottom,
            height: stageBounds.height,
          },
          thumbnailCount: thumbnails.length,
          thumbnailsFit: thumbnails.every(
            (bounds) =>
              bounds.left >= contentLeft - 1 &&
              bounds.right <= contentRight + 1,
          ),
          selectedVisible:
            selectedBounds !== undefined &&
            selectedBounds.left >= contentLeft - 1 &&
            selectedBounds.right <= contentRight + 1 &&
            selectedBounds.top >= railBounds.top - 1 &&
            selectedBounds.top < railBounds.bottom &&
            selectedBounds.bottom > railBounds.top,
          selectedBorder: selected
            ? getComputedStyle(selected).borderTopColor
            : null,
        };
      });

    const assertRailLayout = (layout, label) => {
      assert.equal(
        layout.noOverlap,
        true,
        label + ' keeps photo and rail separate',
      );
      assert.equal(
        layout.thumbnailsFit,
        true,
        label + ' fits thumbnails in rail width',
      );
      assert.equal(
        layout.selectedVisible,
        true,
        label + ' keeps selection visible',
      );
    };
    const assertFoldedRail = (folded, fullHeight, label) => {
      assert.ok(
        folded.rail.height / fullHeight > 0.3 &&
          folded.rail.height / fullHeight < 0.37,
        label + ' folded rail height is about one third of the full rail',
      );
      assertRailLayout(folded, label);
      assert.equal(folded.selectedBorder, 'rgb(226, 161, 74)');
    };

    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(async () => (await inspectRail()).thumbnailsFit)
      .toBe(true);
    const initialNarrowRail = await inspectRail();
    assertRailLayout(initialNarrowRail, 'The Guest 375px filmstrip');
    await page.setViewportSize({ width: 1280, height: 812 });
    await expect
      .poll(async () => (await inspectRail()).thumbnailsFit)
      .toBe(true);
    await dialog.locator('.kino-photo-detail-header').hover();
    await expect(thumbnailRail).toHaveCSS('opacity', '0.62');
    const foldedRail = await inspectRail();
    assertRailLayout(foldedRail, 'The Guest 1280px folded filmstrip');
    assert.equal(foldedRail.selectedBorder, 'rgb(226, 161, 74)');
    await thumbnailRail.hover({ position: { x: 20, y: 2 } });
    await expect(thumbnailRail).toHaveCSS('opacity', '1');
    const expandedRail = await inspectRail();
    assertRailLayout(expandedRail, 'The Guest 1280px expanded filmstrip');
    assert.ok(expandedRail.rail.height > foldedRail.rail.height * 2.8);
    assert.ok(expandedRail.stage.height < foldedRail.stage.height - 1);
    assert.ok(expandedRail.thumbnailCount >= initialNarrowRail.thumbnailCount);

    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(async () => (await inspectRail()).thumbnailsFit)
      .toBe(true);
    await thumbnailRail.hover({ position: { x: 20, y: 2 } });
    await expect(thumbnailRail).toHaveCSS('opacity', '1');
    const expandedNarrowRail = await inspectRail();
    assertRailLayout(expandedNarrowRail, 'The Guest 375px expanded filmstrip');
    await dialog.locator('.kino-photo-detail-header').hover();
    await expect(thumbnailRail).toHaveCSS('opacity', '0.62');
    const foldedNarrowRail = await inspectRail();
    assertFoldedRail(
      foldedNarrowRail,
      expandedNarrowRail.rail.height,
      'The Guest 375px filmstrip',
    );
    const selectedThumbnail = thumbnailRail.locator(
      'button[aria-current="true"]',
    );
    await selectedThumbnail.click({ position: { x: 20, y: 2 } });
    await dialog.locator('.kino-photo-detail-header').hover();
    await expect(thumbnailRail).toHaveCSS('opacity', '0.62');
    await expect(thumbnailRail).toHaveCSS('outline-style', 'none');
    const clickThenLeave = await inspectRail();
    assertFoldedRail(
      clickThenLeave,
      expandedNarrowRail.rail.height,
      'A pointer-focused Guest thumbnail folds after the pointer leaves',
    );
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(selectedThumbnail).toBeFocused();
    await expect(thumbnailRail.locator('button:focus-visible')).toHaveCount(1);
    await expect(thumbnailRail).toHaveCSS('outline-style', 'solid');
    await expect(thumbnailRail).toHaveCSS('opacity', '1');
    const keyboardFocusedRail = await inspectRail();
    assertRailLayout(
      keyboardFocusedRail,
      'The Guest keyboard-focused filmstrip',
    );
    assert.ok(
      keyboardFocusedRail.stage.height < clickThenLeave.stage.height - 1,
    );
    assert.ok(
      keyboardFocusedRail.thumbnailCount <= expandedRail.thumbnailCount,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await dialog.locator('.kino-photo-detail-header').hover();
    await selectedThumbnail.evaluate((button) => button.blur());
    await expect(thumbnailRail).toHaveCSS('opacity', '0.62');
    const reducedMotionRail = await inspectRail();
    assertFoldedRail(
      reducedMotionRail,
      expandedNarrowRail.rail.height,
      'The Guest reduced-motion filmstrip',
    );
    assert.equal(
      await thumbnailRail.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      ),
      '0s',
    );
    await thumbnailRail.hover({ position: { x: 20, y: 2 } });
    await expect(thumbnailRail).toHaveCSS('opacity', '1');
    assertRailLayout(await inspectRail(), 'The Guest reduced-motion hover');
    const currentPanel = page.getByTestId('guest-annotations-panel');
    await expect(currentPanel).toBeVisible();
    await expect(activeCanvasFor(currentPanel)).toBeVisible();
    const currentPageRead = await waitForSharedRead(
      authorState,
      fixture,
      fixture.currentVersionId,
    );
    assert.equal(
      currentPageRead.pathname,
      sharedAnnotationsPath(fixture, fixture.currentVersionId),
      'The Lightbox shared annotations reader binds to its selected current version',
    );
    assert.equal(currentPageRead.responseBody.guestId, fixture.authorGuestId);
    assert.deepEqual(currentPageRead.responseBody.items, []);
    assertNoForbiddenGuestData(currentPageRead, fixture);
    await assertNoHorizontalOverflow(page, 'Guest annotations Lightbox');

    const pointFractions = { x: 0.23, y: 0.41 };
    const expectedPoint = await clickAnnotation(currentPanel, pointFractions);
    const firstSaveIndex = observations.requests.length;
    await expect(currentPanel.getByTestId('annotation-save')).toBeEnabled();
    await currentPanel.getByTestId('annotation-save').click();
    const pointMutation = await waitForMutation(
      authorState,
      (record) =>
        record.requestBody?.operation === 'create' &&
        record.status === 200 &&
        record.requestBody?.versionId === fixture.currentVersionId,
      0,
      'The first current-version point create',
    );
    const pointItem = pointMutation.responseBody?.item;
    assert.ok(pointItem?.annotationId);
    assert.deepEqual(
      pointMutation.requestBody.geometry,
      expectedPoint.expected,
    );
    assert.ok(pointMutation.cookieNames?.includes(guestCookieName(base)));
    assert.equal(pointMutation.origin, new URL(base).origin);
    assert.equal(pointMutation.requestBody.photoId, fixture.photoId);
    assert.equal(pointMutation.requestBody.versionId, fixture.currentVersionId);
    const pointReceiptRead = await waitForTargetedOwnRead(
      authorState,
      fixture,
      fixture.currentVersionId,
      pointItem.annotationId,
      firstSaveIndex,
    );
    assert.equal(pointReceiptRead.responseBody.guestId, fixture.authorGuestId);
    assert.deepEqual(
      pointReceiptRead.responseBody.items.map((item) => item.annotationId),
      [pointItem.annotationId],
      'A create receipt is reconciled through an exact own-only target read',
    );
    const pointDbRow = await currentRow(db, pointItem.annotationId);
    assert.deepEqual(pointDbRow.geometry, expectedPoint.expected);
    assert.equal(pointDbRow.version_id, fixture.currentVersionId);
    await assertMarkerStroke(currentPanel, pointItem.annotationId);

    const rectangleExpected = await drawReverseRectangle(
      currentPanel,
      { x: 0.74, y: 0.76 },
      { x: 0.28, y: 0.24 },
    );
    await expect(currentPanel.getByTestId('annotation-save')).toBeEnabled();
    await currentPanel.getByTestId('annotation-save').click();
    const rectangleMutation = await waitForMutation(
      authorState,
      (record) =>
        record.requestBody?.operation === 'create' &&
        record.requestBody?.geometry?.type === 'rectangle' &&
        record.status === 200,
    );
    assert.deepEqual(rectangleMutation.requestBody.geometry, rectangleExpected);
    const rectangleItem = rectangleMutation.responseBody?.item;
    assert.ok(rectangleItem?.annotationId);
    const rectangleDbRow = await currentRow(db, rectangleItem.annotationId);
    assert.deepEqual(rectangleDbRow.geometry, rectangleExpected);
    await assertMarkerStroke(currentPanel, rectangleItem.annotationId);

    const keyboardCanvas = activeCanvasFor(currentPanel);
    const keyboardTarget = keyboardCanvas.locator('[role="application"]');
    await currentPanel.getByTestId('annotation-tool-point').click();
    await keyboardTarget.focus();
    await keyboardTarget.press('ArrowRight');
    await keyboardTarget.press('Shift+ArrowDown');
    await keyboardTarget.press('Enter');
    await expect(currentPanel.getByTestId('annotation-save')).toBeEnabled();
    await currentPanel.getByTestId('annotation-save').click();
    const keyboardMutation = await waitForMutation(
      authorState,
      (record) =>
        record.status === 200 &&
        record.requestBody?.operation === 'create' &&
        record.requestBody?.geometry?.type === 'point' &&
        record.requestBody?.versionId === fixture.currentVersionId &&
        record.requestBody?.requestId !== pointMutation.requestBody?.requestId,
    );
    assert.ok(Number.isInteger(keyboardMutation.requestBody.geometry.x));
    assert.ok(Number.isInteger(keyboardMutation.requestBody.geometry.y));
    assert.ok(keyboardMutation.requestBody.geometry.x >= 0);
    assert.ok(keyboardMutation.requestBody.geometry.x <= coordinateScale);
    assert.ok(keyboardMutation.requestBody.geometry.y >= 0);
    assert.ok(keyboardMutation.requestBody.geometry.y <= coordinateScale);
    assert.equal(
      (await currentRow(db, keyboardMutation.responseBody.item.annotationId))
        .version_id,
      fixture.currentVersionId,
    );

    const zoom = currentPanel.getByTestId('annotation-zoom');
    const panX = currentPanel.getByTestId('annotation-pan-x');
    const panY = currentPanel.getByTestId('annotation-pan-y');
    await zoom.focus();
    await zoom.press('End');
    await panX.focus();
    await panX.press('ArrowRight');
    await panY.focus();
    await panY.press('ArrowUp');
    await expect(zoom).toHaveValue('4');
    await expect(panX).toHaveValue('1');
    await expect(panY).toHaveValue('1');
    assert.deepEqual(
      (await currentRow(db, pointItem.annotationId)).geometry,
      expectedPoint.expected,
      'Zoom and pan preserve normalized source geometry',
    );
    const transformedExpected = await clickAnnotation(currentPanel, {
      x: 0.53,
      y: 0.5,
    });
    const transformedMutationStart =
      authorState.observations.guestAnnotationMutations.length;
    await expect(currentPanel.getByTestId('annotation-save')).toBeEnabled();
    await currentPanel.getByTestId('annotation-save').click();
    const transformedMutation = await waitForMutation(
      authorState,
      (record) =>
        record.status === 200 &&
        record.requestBody?.operation === 'create' &&
        record.requestBody?.geometry?.type === 'point' &&
        record.requestBody?.versionId === fixture.currentVersionId,
      transformedMutationStart,
      'A point drawn through the zoomed and panned image stage',
    );
    assert.deepEqual(
      transformedMutation.requestBody.geometry,
      transformedExpected.expected,
      'Zoomed and panned pointer coordinates match the painted source image',
    );
    const transformedItem = transformedMutation.responseBody?.item;
    assert.ok(transformedItem?.annotationId);
    const transformedRow = await currentRow(db, transformedItem.annotationId);
    assert.equal(transformedRow.version_id, fixture.currentVersionId);
    assert.deepEqual(transformedRow.geometry, transformedExpected.expected);
    await waitForTargetedOwnRead(
      authorState,
      fixture,
      fixture.currentVersionId,
      transformedItem.annotationId,
    );
    await expect(
      currentPanel.getByTestId(
        'annotation-item-' + transformedItem.annotationId,
      ),
    ).toBeVisible();
    await assertMarkerStroke(currentPanel, transformedItem.annotationId);
    await currentPanel.getByTestId('annotation-reset-view').click();

    // A pointer capture may continue outside the scroll clip. The rectangle
    // starts on the visible image and ends inside the canvas's logical bounds,
    // but beyond a temporary clipping ancestor; no draft or POST may result.
    const clippedSection = page
      .locator('[role="dialog"][aria-modal="true"]')
      .locator('.kino-photo-detail-stage');
    const clippedCanvas = activeCanvasFor(currentPanel);
    await currentPanel.getByTestId('annotation-tool-rectangle').click();
    await clippedCanvas.scrollIntoViewIfNeeded();
    const clippedStart = await pointOnImage(currentPanel, 0.42, 0.18);
    const clippedEnd = await pointOnImage(currentPanel, 0.58, 0.94);
    assertPointInsideViewport(clippedStart);
    assertPointInsideViewport(clippedEnd);
    const originalClipStyles = await clippedSection.evaluate((element) => ({
      maxHeight: element.style.maxHeight,
      overflow: element.style.overflow,
    }));
    try {
      const clippingEvidence = await clippedSection.evaluate(
        (element, endPoint) => {
          const canvas = element.querySelector(
            '[data-testid="annotation-canvas"]',
          );
          if (!(canvas instanceof HTMLElement))
            throw new Error('The clipping ancestor must contain the canvas');
          const sectionBounds = element.getBoundingClientRect();
          const canvasBounds = canvas.getBoundingClientRect();
          const maxHeight = Math.floor(endPoint.y - sectionBounds.top - 8);
          if (maxHeight <= 0)
            throw new Error(
              'The clipped endpoint must be below the ancestor top',
            );
          element.style.maxHeight = maxHeight + 'px';
          element.style.overflow = 'hidden';
          const clippedBounds = element.getBoundingClientRect();
          const viewportBounds = {
            width: window.innerWidth,
            height: window.innerHeight,
          };
          return {
            maxHeight,
            section: clippedBounds.toJSON(),
            canvas: canvasBounds.toJSON(),
            browserViewport: viewportBounds,
            endpointInsideLogicalCanvas:
              endPoint.y > canvasBounds.top && endPoint.y < canvasBounds.bottom,
            endpointInsideBrowserViewport:
              endPoint.x >= 0 &&
              endPoint.x < viewportBounds.width &&
              endPoint.y >= 0 &&
              endPoint.y < viewportBounds.height,
            endpointOutsideAncestorClip: endPoint.y > clippedBounds.bottom,
          };
        },
        { x: clippedEnd.x, y: clippedEnd.y },
      );
      assert.equal(
        clippingEvidence.endpointInsideLogicalCanvas,
        true,
        'The dragged endpoint stays inside the canvas logical rectangle',
      );
      assert.equal(
        clippingEvidence.endpointOutsideAncestorClip,
        true,
        'The ancestor clipping boundary hides the captured pointer endpoint',
      );
      assert.equal(
        clippingEvidence.endpointInsideBrowserViewport,
        true,
        'The clipped endpoint remains inside the browser viewport',
      );
      assert.ok(
        clippedStart.y < clippingEvidence.section.bottom,
        'The rectangle drag starts on the visible canvas',
      );
      const clippedStartHit = await page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          const viewport = document.querySelector(
            '[role="dialog"][aria-modal="true"] [data-testid="annotation-canvas"] [role="application"]',
          );
          return Boolean(hit && viewport?.contains(hit));
        },
        { x: clippedStart.x, y: clippedStart.y },
      );
      const clippedEndHit = await page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          const viewport = document.querySelector(
            '[role="dialog"][aria-modal="true"] [data-testid="annotation-canvas"] [role="application"]',
          );
          return Boolean(hit && viewport?.contains(hit));
        },
        { x: clippedEnd.x, y: clippedEnd.y },
      );
      assert.equal(clippedStartHit, true);
      assert.equal(clippedEndHit, false);

      const beforeClippedPointerPosts =
        observations.guestAnnotationMutations.length;
      await page.mouse.move(
        Math.round(clippedStart.x),
        Math.round(clippedStart.y),
      );
      await page.mouse.down();
      await page.mouse.move(
        Math.round(clippedEnd.x),
        Math.round(clippedEnd.y),
        {
          steps: 8,
        },
      );
      await page.mouse.up();
      await expect(
        activeCanvasFor(currentPanel).getByTestId('annotation-draft-mark'),
      ).toHaveCount(0);
      await expect(currentPanel.getByTestId('annotation-save')).toHaveCount(0);
      assert.equal(
        observations.guestAnnotationMutations.length,
        beforeClippedPointerPosts,
        'A pointer endpoint hidden by an ancestor clip creates no annotation POST',
      );
    } finally {
      await clippedSection.evaluate((element, styles) => {
        element.style.maxHeight = styles.maxHeight;
        element.style.overflow = styles.overflow;
      }, originalClipStyles);
    }
    await expect(clippedCanvas).toBeVisible();

    await openComparisonAfter(page, fixture, fixture.versionId, authorState);
    const comparisonPanel = page.getByTestId('guest-annotations-panel');
    await expect(comparisonPanel).toBeVisible();
    await expect(
      comparisonPanel.getByTestId('annotation-item-' + fixture.annotationId),
    ).toBeVisible();
    const historicPage = await waitForSharedRead(
      authorState,
      fixture,
      fixture.versionId,
    );
    assert.equal(historicPage.responseBody.guestId, fixture.authorGuestId);
    assert.deepEqual(
      historicPage.responseBody.items.map((item) => item.annotationId).sort(),
      [fixture.annotationId, fixture.peerAnnotationId].sort(),
      'A Guest shared page contains both same-invitation authors for the selected version',
    );
    const authorHistoricRow = historicPage.responseBody.items.find(
      (item) => item.annotationId === fixture.annotationId,
    );
    const peerHistoricRow = historicPage.responseBody.items.find(
      (item) => item.annotationId === fixture.peerAnnotationId,
    );
    assert.equal(authorHistoricRow?.isMine, true);
    assert.equal(authorHistoricRow?.authorLabel, fixture.authorLabel);
    assert.equal(peerHistoricRow?.isMine, false);
    assert.equal(peerHistoricRow?.authorLabel, fixture.peerAuthorLabel);
    const authorHistoricItem = comparisonPanel.getByTestId(
      'annotation-item-' + fixture.annotationId,
    );
    const peerHistoricItem = comparisonPanel.getByTestId(
      'annotation-item-' + fixture.peerAnnotationId,
    );
    await expect(authorHistoricItem).toContainText(fixture.authorLabel);
    await expect(
      authorHistoricItem.getByText('我', { exact: true }),
    ).toBeVisible();
    await expect(peerHistoricItem).toContainText(fixture.peerAuthorLabel);
    await expect(
      peerHistoricItem.getByText('同邀請客戶', { exact: true }),
    ).toBeVisible();
    await assertPeerControlsAbsent(peerHistoricItem);
    await expect(
      authorHistoricItem.getByRole('button', {
        name: '編輯標記',
        exact: true,
      }),
    ).toBeVisible();
    assertNoForbiddenGuestData(historicPage, fixture);

    await loadAllGuestVersions(page.getByTestId('guest-version-comparison'));
    const after = page.getByTestId('compare-after');
    const afterValues = await after
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    assert.equal(
      afterValues.includes(fixture.draftVersionId),
      false,
      'Guest comparison never exposes the private-ready unpublished version',
    );
    assert.ok(
      afterValues.includes(portraitVersion.id),
      'The actual V2 portrait is available in the Guest comparison versions',
    );
    await after.selectOption(portraitVersion.id);
    await expect(
      comparisonPanel.getByTestId('annotation-item-' + fixture.annotationId),
    ).toHaveCount(0);
    const portraitImage = await findPreviewImage(comparisonPanel);
    await expect(portraitImage).toBeVisible();
    await expect
      .poll(() =>
        portraitImage.evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.naturalWidth > 0 &&
            image.naturalHeight > image.naturalWidth,
        ),
      )
      .toBe(true);
    const portraitExpected = await clickAnnotation(comparisonPanel, {
      x: 0.38,
      y: 0.67,
    });
    await expect(comparisonPanel.getByTestId('annotation-save')).toBeEnabled();
    await comparisonPanel.getByTestId('annotation-save').click();
    const portraitMutation = await waitForMutation(
      authorState,
      (record) =>
        record.status === 200 &&
        record.requestBody?.operation === 'create' &&
        record.requestBody?.geometry?.type === 'point' &&
        record.requestBody?.versionId === portraitVersion.id,
    );
    assert.deepEqual(
      portraitMutation.requestBody.geometry,
      portraitExpected.expected,
      'Portrait marker coordinates use the source image dimensions',
    );
    const portraitItem = portraitMutation.responseBody?.item;
    assert.ok(portraitItem?.annotationId);
    const portraitRow = await currentRow(db, portraitItem.annotationId);
    assert.deepEqual(portraitRow.geometry, portraitExpected.expected);
    assert.equal(
      portraitRow.version_id,
      portraitVersion.id,
      'The marker remains attached to its selected portrait source version',
    );
    await after.selectOption(fixture.versionId);
    await expect(
      comparisonPanel.getByTestId('annotation-item-' + fixture.annotationId),
    ).toBeVisible();
    await expect(
      comparisonPanel.getByTestId(
        'annotation-item-' + portraitItem.annotationId,
      ),
    ).toHaveCount(0);

    await page.getByTestId('compare-close').click();
    const resizedPanel = page.getByTestId('guest-annotations-panel');
    await expect(resizedPanel).toBeVisible();
    const resizedCanvas = activeCanvasFor(resizedPanel);
    const initialCanvasWidth = (await resizedCanvas.boundingBox())?.width ?? 0;
    await page.setViewportSize({ width: 414, height: 896 });
    await expect
      .poll(async () => (await resizedCanvas.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initialCanvasWidth);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(async () =>
        Math.abs(
          ((await resizedCanvas.boundingBox())?.width ?? 0) -
            initialCanvasWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect(
      resizedPanel.getByTestId('annotation-item-' + pointItem.annotationId),
    ).toBeVisible();
    assert.deepEqual(
      (await currentRow(db, pointItem.annotationId)).geometry,
      expectedPoint.expected,
      'Viewport resizing preserves normalized source geometry',
    );

    // A successful Guest command whose response is lost remains the same local
    // intent across reload; replay is reconciled against the targeted current row.
    transport.dropNextSuccessfulResponse();
    const recoveryFractions = { x: 0.56, y: 0.63 };
    const recoveryExpected = await clickAnnotation(
      page.getByTestId('guest-annotations-panel'),
      recoveryFractions,
    );
    await expect(page.getByTestId('annotation-save')).toBeEnabled();
    await page.getByTestId('annotation-save').click();
    const droppedCreate = await waitForMutation(
      authorState,
      (record) => record.dropped && record.requestBody?.operation === 'create',
    );
    assert.equal(droppedCreate.status, 200);
    assert.deepEqual(
      droppedCreate.requestBody.geometry,
      recoveryExpected.expected,
    );
    const droppedAnnotationId = droppedCreate.responseBody?.item?.annotationId;
    assert.ok(droppedAnnotationId);
    await expect(page.getByTestId('annotation-retry')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openGuestPhoto(page, base, fixture);
    const restoredPanel = page.getByTestId('guest-annotations-panel');
    await expect(restoredPanel.getByTestId('annotation-retry')).toBeVisible();
    const storedJournal = await page.evaluate(
      (key) => {
        const raw = window.sessionStorage.getItem(key);
        return raw;
      },
      'kino-pic:guest-annotations:v1:' +
        fixture.authorGuestId +
        ':' +
        fixture.albumId,
    );
    assert.ok(
      storedJournal,
      'The bodyless recovery metadata survives a full reload',
    );
    for (const secret of [fixture.secretAuthor, fixture.inviteToken])
      assert.equal(storedJournal.includes(secret), false);
    const restoredMetadata = JSON.parse(storedJournal);
    const originalCommand = restoredMetadata.command;
    assert.equal(Object.hasOwn(originalCommand, 'body'), false);
    assert.deepEqual(originalCommand.geometry, recoveryExpected.expected);

    const deleteReceipt = await requestGuestCommand({
      worker,
      base,
      fixture,
      command: {
        requestId: randomUUID(),
        expectedGuestId: fixture.authorGuestId,
        operation: 'delete',
        annotationId: droppedAnnotationId,
        expectedRevision: 1,
      },
    });
    assert.equal(deleteReceipt.response.status, 200);
    assert.equal(deleteReceipt.body.item.state, 'deleted');
    const beforeRetryCounts = await db
      .prepare(
        'SELECT (SELECT count(*) FROM guest_annotation_commands WHERE guest_id=? AND invite_id=? AND request_id=?) AS create_commands,(SELECT count(*) FROM guest_annotation_results WHERE guest_id=? AND invite_id=? AND request_id=?) AS create_results,(SELECT count(*) FROM guest_annotation_changes WHERE annotation_id=?) AS changes',
      )
      .bind(
        fixture.authorGuestId,
        fixture.authorInviteId,
        originalCommand.requestId,
        fixture.authorGuestId,
        fixture.authorInviteId,
        originalCommand.requestId,
        droppedAnnotationId,
      )
      .first();
    await restoredPanel.getByTestId('annotation-retry').click();
    const replayedCreate = await waitForMutation(
      authorState,
      (record) =>
        record.requestBody?.requestId === originalCommand.requestId &&
        record.status === 200 &&
        !record.dropped,
    );
    assert.deepEqual(replayedCreate.requestBody, originalCommand);
    const targetedRead = await expect
      .poll(() =>
        observations.requests.find((record) => {
          if (
            record.method !== 'GET' ||
            record.pathname !==
              ownAnnotationsPath(fixture, fixture.currentVersionId) ||
            record.status !== 200
          )
            return false;
          return (
            new URLSearchParams(record.search).get('annotationId') ===
            droppedAnnotationId
          );
        }),
      )
      .toBeTruthy()
      .then(() =>
        observations.requests.find((record) => {
          if (
            record.method !== 'GET' ||
            record.pathname !==
              ownAnnotationsPath(fixture, fixture.currentVersionId) ||
            record.status !== 200
          )
            return false;
          return (
            new URLSearchParams(record.search).get('annotationId') ===
            droppedAnnotationId
          );
        }),
      );
    assert.equal(targetedRead.responseBody.items[0]?.state, 'deleted');
    assert.equal(targetedRead.responseBody.items[0]?.geometry, null);
    await expect(
      activeCanvasFor(restoredPanel).getByTestId(
        'annotation-mark-' + droppedAnnotationId,
      ),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          'kino-pic:guest-annotations:v1:' +
            fixture.authorGuestId +
            ':' +
            fixture.albumId,
        ),
      )
      .toBeNull();
    const afterRetryCounts = await db
      .prepare(
        'SELECT (SELECT count(*) FROM guest_annotation_commands WHERE guest_id=? AND invite_id=? AND request_id=?) AS create_commands,(SELECT count(*) FROM guest_annotation_results WHERE guest_id=? AND invite_id=? AND request_id=?) AS create_results,(SELECT count(*) FROM guest_annotation_changes WHERE annotation_id=?) AS changes',
      )
      .bind(
        fixture.authorGuestId,
        fixture.authorInviteId,
        originalCommand.requestId,
        fixture.authorGuestId,
        fixture.authorInviteId,
        originalCommand.requestId,
        droppedAnnotationId,
      )
      .first();
    assert.deepEqual(afterRetryCounts, beforeRetryCounts);
    assert.equal((await currentRow(db, droppedAnnotationId)).state, 'deleted');
    await assertNoHorizontalOverflow(page, 'Guest annotation recovery panel');

    // Lifecycle cancellation case: hiding the document aborts this active
    // panel request. A later route fulfillment only verifies cancellation
    // leaves a newer journal intact; it does not claim the panel consumed a
    // late response. Live response handling is covered by the cases below.
    transport.dropNextSuccessfulResponse();
    const beforeAbandonedCreate = observations.guestAnnotationMutations.length;
    const abandonedExpected = await clickAnnotation(restoredPanel, {
      x: 0.37,
      y: 0.58,
    });
    await restoredPanel.getByTestId('annotation-save').click();
    const abandonedCreate = await waitForMutation(
      authorState,
      (record) => record.dropped && record.requestBody?.operation === 'create',
      beforeAbandonedCreate,
    );
    assert.deepEqual(
      abandonedCreate.requestBody.geometry,
      abandonedExpected.expected,
    );
    await expect(restoredPanel.getByTestId('annotation-retry')).toBeVisible();

    const lateOriginal = transport.holdNextSuccessfulResponse();
    await restoredPanel.getByTestId('annotation-retry').click();
    await lateOriginal.seen;
    assert.equal(lateOriginal.record.status, 200);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(restoredPanel.getByTestId('annotation-retry')).toBeEnabled();
    await restoredPanel.getByTestId('annotation-abandon').click();
    const journalKey =
      'kino-pic:guest-annotations:v1:' +
      fixture.authorGuestId +
      ':' +
      fixture.albumId;
    await expect
      .poll(() =>
        page.evaluate((key) => sessionStorage.getItem(key), journalKey),
      )
      .toBeNull();

    const lateNewer = transport.holdNextSuccessfulResponse();
    const newerExpected = await clickAnnotation(restoredPanel, {
      x: 0.68,
      y: 0.46,
    });
    await restoredPanel.getByTestId('annotation-save').click();
    await lateNewer.seen;
    const newerJournalBeforeLateOriginal = await page.evaluate(
      (key) => sessionStorage.getItem(key),
      journalKey,
    );
    assert.ok(newerJournalBeforeLateOriginal);
    const newerMetadata = JSON.parse(newerJournalBeforeLateOriginal);
    assert.deepEqual(newerMetadata.command.geometry, newerExpected.expected);
    assert.equal(
      newerMetadata.command.requestId,
      lateNewer.record.requestBody.requestId,
    );
    assert.equal(newerMetadata.command.photoId, fixture.photoId);
    assert.equal(newerMetadata.command.versionId, fixture.currentVersionId);
    for (const secret of [fixture.secretAuthor, fixture.inviteToken])
      assert.equal(newerJournalBeforeLateOriginal.includes(secret), false);

    lateOriginal.release(401);
    await lateOriginal.finished;
    assert.ok(
      lateOriginal.record.deliveredStatus === 401 ||
        lateOriginal.record.deliveryError ===
          'The browser request had already ended',
      'The canceled request is either route-fulfilled or already ended',
    );
    assert.equal(
      lateOriginal.record.deliveryOverride,
      'test-only HTTP 401',
      'The cancellation case uses an explicit transport override, not native revocation',
    );
    assert.equal(
      await page.evaluate((key) => sessionStorage.getItem(key), journalKey),
      newerJournalBeforeLateOriginal,
      'A late response for the abandoned command leaves the newer journal intact',
    );
    assert.deepEqual(observations.bridgeErrors, []);

    lateNewer.release();
    await lateNewer.finished;
    const newerAnnotationId = lateNewer.record.responseBody?.item?.annotationId;
    assert.ok(newerAnnotationId);
    await expect
      .poll(() =>
        page.evaluate((key) => sessionStorage.getItem(key), journalKey),
      )
      .toBeNull();
    await expect(
      restoredPanel.getByTestId('annotation-item-' + newerAnnotationId),
    ).toBeVisible();
    const newerRow = await currentRow(db, newerAnnotationId);
    assert.deepEqual(newerRow.geometry, newerExpected.expected);
    assert.equal(newerRow.version_id, fixture.currentVersionId);

    // Live 200 response case: the actual panel send remains active while a
    // different valid full journal record replaces its raw slot. The Worker
    // still commits A and the panel still performs its targeted current read,
    // but the exact B bytes must survive and A must not merge into the view.
    const liveSuccessExpected = await clickAnnotation(restoredPanel, {
      x: 0.31,
      y: 0.33,
    });
    const liveSuccess = transport.holdNextSuccessfulResponse();
    await restoredPanel.getByTestId('annotation-save').click();
    await liveSuccess.seen;
    assert.equal(liveSuccess.record.status, 200);
    assert.deepEqual(
      liveSuccess.record.requestBody.geometry,
      liveSuccessExpected.expected,
    );
    const liveSuccessId = liveSuccess.record.responseBody?.item?.annotationId;
    assert.ok(liveSuccessId);
    const liveSuccessJournalRaw = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      journalKey,
    );
    assert.ok(liveSuccessJournalRaw);
    const liveSuccessMetadata = JSON.parse(liveSuccessJournalRaw);
    assert.deepEqual(
      liveSuccessMetadata.command,
      liveSuccess.record.requestBody,
    );
    const replacementAfterSuccess = makeReplacementJournal(
      liveSuccessMetadata,
      normalizedPoint(0.81, 0.18),
    );
    const replacementAfterSuccessRaw = JSON.stringify(replacementAfterSuccess);
    assert.notEqual(
      replacementAfterSuccess.command.requestId,
      liveSuccessMetadata.command.requestId,
    );
    for (const secret of [fixture.secretAuthor, fixture.inviteToken])
      assert.equal(replacementAfterSuccessRaw.includes(secret), false);
    await writeJournalRaw(page, journalKey, replacementAfterSuccessRaw);
    const beforeLiveSuccessReadIndex = observations.requests.length;
    liveSuccess.release();
    await liveSuccess.finished;
    assert.equal(liveSuccess.record.delivered, true);
    assert.equal(liveSuccess.record.deliveredStatus, 200);
    assert.equal(liveSuccess.record.deliveryError, undefined);
    const liveSuccessTargetedRead = await waitForTargetedOwnRead(
      authorState,
      fixture,
      fixture.currentVersionId,
      liveSuccessId,
      beforeLiveSuccessReadIndex,
    );
    assert.equal(
      new URLSearchParams(liveSuccessTargetedRead.search).get('annotationId'),
      liveSuccessId,
      'The live 200 panel response triggers its targeted current-row read',
    );
    assert.deepEqual(
      liveSuccessTargetedRead.responseBody.items.map(
        (item) => item.annotationId,
      ),
      [liveSuccessId],
    );
    const liveSuccessRow = await currentRow(db, liveSuccessId);
    assert.equal(liveSuccessRow.version_id, fixture.currentVersionId);
    assert.deepEqual(liveSuccessRow.geometry, liveSuccessExpected.expected);
    await expect(
      restoredPanel.getByTestId('annotation-item-' + liveSuccessId),
    ).toHaveCount(0);
    await expect(restoredPanel.getByRole('alert')).toContainText(
      '標註復原記錄內容無法驗證',
    );
    assert.equal(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      replacementAfterSuccessRaw,
      'A live 200 plus its targeted read cannot replace external B bytes',
    );

    // Live controlled 401 with raw B replacement: the Worker accepts A, but
    // the browser receives an explicit transport 401. It must not trigger a
    // targeted row read, merge A, or change B. This is separate from the
    // current-scope privacy-clear case below.
    await page.evaluate(
      (key) => window.sessionStorage.removeItem(key),
      journalKey,
    );
    const beforeLiveDeniedPageIndex = observations.requests.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openGuestPhoto(page, base, fixture);
    const liveDeniedPanel = page.getByTestId('guest-annotations-panel');
    await expect(liveDeniedPanel).toBeVisible();
    await waitForSharedRead(
      authorState,
      fixture,
      fixture.currentVersionId,
      beforeLiveDeniedPageIndex,
    );
    const liveDeniedExpected = await clickAnnotation(liveDeniedPanel, {
      x: 0.57,
      y: 0.36,
    });
    const liveDenied = transport.holdNextSuccessfulResponse();
    await liveDeniedPanel.getByTestId('annotation-save').click();
    await liveDenied.seen;
    assert.equal(liveDenied.record.status, 200);
    assert.deepEqual(
      liveDenied.record.requestBody.geometry,
      liveDeniedExpected.expected,
    );
    const liveDeniedId = liveDenied.record.responseBody?.item?.annotationId;
    assert.ok(liveDeniedId);
    const liveDeniedJournalRaw = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      journalKey,
    );
    assert.ok(liveDeniedJournalRaw);
    const liveDeniedMetadata = JSON.parse(liveDeniedJournalRaw);
    assert.deepEqual(liveDeniedMetadata.command, liveDenied.record.requestBody);
    const replacementAfterDenied = makeReplacementJournal(
      liveDeniedMetadata,
      normalizedPoint(0.17, 0.82),
    );
    const replacementAfterDeniedRaw = JSON.stringify(replacementAfterDenied);
    await writeJournalRaw(page, journalKey, replacementAfterDeniedRaw);
    const beforeLiveDeniedReadIndex = observations.requests.length;
    liveDenied.release(401);
    await liveDenied.finished;
    assert.equal(liveDenied.record.delivered, true);
    assert.equal(liveDenied.record.deliveredStatus, 401);
    assert.equal(liveDenied.record.deliveryOverride, 'test-only HTTP 401');
    assert.equal(liveDenied.record.deliveryError, undefined);
    await expect(liveDeniedPanel.getByRole('alert')).toContainText(
      '標註復原記錄內容無法驗證',
    );
    assert.equal(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      replacementAfterDeniedRaw,
    );
    assert.equal(
      observations.requests
        .slice(beforeLiveDeniedReadIndex)
        .some(
          (record) =>
            record.method === 'GET' &&
            record.pathname ===
              ownAnnotationsPath(fixture, fixture.currentVersionId) &&
            new URLSearchParams(record.search).get('annotationId') ===
              liveDeniedId,
        ),
      false,
      'A controlled 401 with replacement B does not trigger a targeted row read',
    );
    await expect(
      liveDeniedPanel.getByTestId('annotation-item-' + liveDeniedId),
    ).toHaveCount(0);
    const liveDeniedRow = await currentRow(db, liveDeniedId);
    assert.equal(liveDeniedRow.version_id, fixture.currentVersionId);
    assert.deepEqual(liveDeniedRow.geometry, liveDeniedExpected.expected);

    // A current-scope 401 without external B replacement invalidates the
    // shared Guest gallery identity, including the Lightbox, while retaining
    // the exact uncertain journal for recovery after reauthorization.
    await page.evaluate(
      (key) => window.sessionStorage.removeItem(key),
      journalKey,
    );
    const beforePrivateDeniedPageIndex = observations.requests.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openGuestPhoto(page, base, fixture);
    const privateDeniedPanel = page.getByTestId('guest-annotations-panel');
    await expect(privateDeniedPanel).toBeVisible();
    await waitForSharedRead(
      authorState,
      fixture,
      fixture.currentVersionId,
      beforePrivateDeniedPageIndex,
    );
    const privateDeniedExpected = await clickAnnotation(privateDeniedPanel, {
      x: 0.43,
      y: 0.71,
    });
    const privateDenied = transport.holdNextSuccessfulResponse();
    await privateDeniedPanel.getByTestId('annotation-save').click();
    await privateDenied.seen;
    assert.equal(privateDenied.record.status, 200);
    assert.deepEqual(
      privateDenied.record.requestBody.geometry,
      privateDeniedExpected.expected,
    );
    const privateDeniedId =
      privateDenied.record.responseBody?.item?.annotationId;
    assert.ok(privateDeniedId);
    const privateDeniedJournalRaw = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      journalKey,
    );
    assert.ok(privateDeniedJournalRaw);
    assert.deepEqual(
      JSON.parse(privateDeniedJournalRaw).command,
      privateDenied.record.requestBody,
    );
    const beforePrivateDeniedReadIndex = observations.requests.length;
    privateDenied.release(401);
    await privateDenied.finished;
    assert.equal(privateDenied.record.delivered, true);
    assert.equal(privateDenied.record.deliveredStatus, 401);
    assert.equal(privateDenied.record.deliveryOverride, 'test-only HTTP 401');
    assert.equal(privateDenied.record.deliveryError, undefined);
    await expect(
      page.getByRole('status').filter({
        hasText: '此連結目前無法使用，請聯絡攝影師。',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: '重新載入',
        exact: true,
      }),
    ).toBeVisible();
    await expect(privateDeniedPanel).toHaveCount(0);
    await expect(
      page.locator('[role="dialog"][aria-modal="true"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId('annotation-preview-image')).toHaveCount(0);
    assert.equal(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      privateDeniedJournalRaw,
      'The controlled current-scope 401 preserves the exact uncertain journal',
    );
    assert.equal(
      observations.requests
        .slice(beforePrivateDeniedReadIndex)
        .some(
          (record) =>
            record.method === 'GET' &&
            record.pathname ===
              ownAnnotationsPath(fixture, fixture.currentVersionId) &&
            new URLSearchParams(record.search).get('annotationId') ===
              privateDeniedId,
        ),
      false,
      'A 401 receipt is never followed by a targeted current-row read',
    );

    // Recheck the real Guest authorization, reopen the photo, then abandon
    // only after the gallery has restored access and the intent is visible.
    await page
      .getByRole('button', {
        name: '重新載入',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', { name: /^Kino Pick (?:線上挑片|相簿)$/u }),
    ).toBeVisible();
    await openGuestPhoto(page, base, fixture);
    const recoveredPrivateDeniedPanel = page.getByTestId(
      'guest-annotations-panel',
    );
    await expect(recoveredPrivateDeniedPanel).toBeVisible();
    await expect(
      recoveredPrivateDeniedPanel.getByTestId('annotation-abandon'),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      privateDeniedJournalRaw,
      'The retained journal is unchanged after authorization recheck and reopen',
    );
    await recoveredPrivateDeniedPanel.getByTestId('annotation-abandon').click();
    await expect
      .poll(() =>
        page.evaluate((key) => sessionStorage.getItem(key), journalKey),
      )
      .toBeNull();
    await expect(
      recoveredPrivateDeniedPanel.getByTestId(
        'annotation-item-' + privateDeniedId,
      ),
    ).toBeVisible();
    for (const annotationId of [liveSuccessId, liveDeniedId, privateDeniedId])
      assert.equal((await currentRow(db, annotationId)).state, 'open');

    const authorAnnotationIds = [
      pointItem.annotationId,
      rectangleItem.annotationId,
      keyboardMutation.responseBody.item.annotationId,
      portraitItem.annotationId,
      fixture.annotationId,
      droppedAnnotationId,
      abandonedCreate.responseBody.item.annotationId,
      newerAnnotationId,
      transformedItem.annotationId,
      liveSuccessId,
      liveDeniedId,
      privateDeniedId,
    ];
    const sharedPhotoInvites = [
      {
        secret: fixture.secretPeer,
        expectedGuestId: fixture.peerGuestId,
        inviteId: fixture.authorInviteId,
        kind: 'same-invitation-peer',
      },
      {
        secret: fixture.secretOtherInvite,
        expectedGuestId: fixture.otherGuestId,
        inviteId: fixture.otherInviteId,
        kind: 'other-invitation-guest',
      },
    ];
    for (const candidate of sharedPhotoInvites) {
      const state = await makeBrowserState({
        browser,
        worker,
        base,
        cookieName: guestCookieName(base),
        cookieValue: candidate.secret,
        kind: 'guest',
        albumId: fixture.albumId,
      });
      if (candidate.expectedGuestId === fixture.peerGuestId) peerState = state;
      else otherState = state;
      await openGuestPhoto(state.page, base, fixture);
      const panel = state.page.getByTestId('guest-annotations-panel');
      await expect(panel).toBeVisible();
      const currentSharedRead = await waitForSharedRead(
        state,
        fixture,
        fixture.currentVersionId,
      );
      assert.equal(
        currentSharedRead.responseBody.guestId,
        candidate.expectedGuestId,
      );
      const expectedCurrentIds = await annotationIdsForInvite(
        db,
        fixture,
        candidate.inviteId,
        fixture.currentVersionId,
      );
      assert.deepEqual(
        currentSharedRead.responseBody.items
          .map((item) => item.annotationId)
          .sort(),
        [...expectedCurrentIds].sort(),
        'Current Guest annotations are shared within exactly the selected invitation',
      );
      for (const annotation of currentSharedRead.responseBody.items)
        await expect(
          panel.getByTestId('annotation-item-' + annotation.annotationId),
        ).toBeVisible();
      assertNoForbiddenGuestData(currentSharedRead, fixture);
      if (candidate.kind === 'same-invitation-peer') {
        assert.ok(
          expectedCurrentIds.includes(pointItem.annotationId),
          'The current author point belongs to the same invitation shared scope',
        );
        const sharedAuthorCurrentRow =
          currentSharedRead.responseBody.items.find(
            (item) => item.annotationId === pointItem.annotationId,
          );
        assert.equal(sharedAuthorCurrentRow?.isMine, false);
        assert.equal(sharedAuthorCurrentRow?.authorLabel, fixture.authorLabel);
        const sharedAuthorCurrentItem = panel.getByTestId(
          'annotation-item-' + pointItem.annotationId,
        );
        await expect(sharedAuthorCurrentItem).toContainText(
          fixture.authorLabel,
        );
        await expect(
          sharedAuthorCurrentItem.getByText('同邀請客戶', { exact: true }),
        ).toBeVisible();
        await assertPeerControlsAbsent(sharedAuthorCurrentItem);
      } else {
        assert.deepEqual(expectedCurrentIds, []);
        for (const annotationId of authorAnnotationIds)
          await expect(
            panel.getByTestId('annotation-item-' + annotationId),
          ).toHaveCount(0);
        await expect(
          panel.getByTestId('annotation-item-' + fixture.peerAnnotationId),
        ).toHaveCount(0);
      }

      await openComparisonAfter(state.page, fixture, fixture.versionId, state);
      const historicPanel = state.page.getByTestId('guest-annotations-panel');
      await expect(historicPanel).toBeVisible();
      const historicSharedRead = await waitForSharedRead(
        state,
        fixture,
        fixture.versionId,
      );
      assert.equal(
        historicSharedRead.responseBody.guestId,
        candidate.expectedGuestId,
      );
      const expectedHistoricIds = await annotationIdsForInvite(
        db,
        fixture,
        candidate.inviteId,
        fixture.versionId,
      );
      assert.deepEqual(
        historicSharedRead.responseBody.items
          .map((item) => item.annotationId)
          .sort(),
        [...expectedHistoricIds].sort(),
        'Historical Guest annotations are shared within exactly the selected invitation',
      );
      for (const annotation of historicSharedRead.responseBody.items)
        await expect(
          historicPanel.getByTestId(
            'annotation-item-' + annotation.annotationId,
          ),
        ).toBeVisible();

      if (candidate.kind === 'same-invitation-peer') {
        assert.deepEqual(
          [...expectedHistoricIds].sort(),
          [fixture.annotationId, fixture.peerAnnotationId].sort(),
        );
        const sharedAuthorHistoricRow =
          historicSharedRead.responseBody.items.find(
            (item) => item.annotationId === fixture.annotationId,
          );
        const sharedPeerHistoricRow =
          historicSharedRead.responseBody.items.find(
            (item) => item.annotationId === fixture.peerAnnotationId,
          );
        assert.equal(sharedAuthorHistoricRow?.isMine, false);
        assert.equal(sharedAuthorHistoricRow?.authorLabel, fixture.authorLabel);
        assert.equal(sharedPeerHistoricRow?.isMine, true);
        assert.equal(
          sharedPeerHistoricRow?.authorLabel,
          fixture.peerAuthorLabel,
        );
        const sharedAuthorHistoricItem = historicPanel.getByTestId(
          'annotation-item-' + fixture.annotationId,
        );
        const sharedPeerHistoricItem = historicPanel.getByTestId(
          'annotation-item-' + fixture.peerAnnotationId,
        );
        await expect(sharedAuthorHistoricItem).toContainText(
          fixture.authorLabel,
        );
        await expect(
          sharedAuthorHistoricItem.getByText('同邀請客戶', { exact: true }),
        ).toBeVisible();
        await assertPeerControlsAbsent(sharedAuthorHistoricItem);
        await expect(sharedPeerHistoricItem).toContainText(
          fixture.peerAuthorLabel,
        );
        await expect(
          sharedPeerHistoricItem.getByText('我', { exact: true }),
        ).toBeVisible();
        await expect(
          sharedPeerHistoricItem.getByRole('button', {
            name: '編輯標記',
            exact: true,
          }),
        ).toBeVisible();
      } else {
        assert.deepEqual(expectedHistoricIds, [
          fixture.otherInviteAnnotationId,
        ]);
        const isolatedItem = historicSharedRead.responseBody.items.find(
          (item) => item.annotationId === fixture.otherInviteAnnotationId,
        );
        assert.equal(isolatedItem?.isMine, true);
        assert.equal(isolatedItem?.authorLabel, fixture.otherAuthorLabel);
        for (const annotationId of [
          ...authorAnnotationIds,
          fixture.peerAnnotationId,
        ])
          await expect(
            historicPanel.getByTestId('annotation-item-' + annotationId),
          ).toHaveCount(0);
        const isolatedRow = historicPanel.getByTestId(
          'annotation-item-' + fixture.otherInviteAnnotationId,
        );
        await expect(isolatedRow).toContainText(fixture.otherAuthorLabel);
        await expect(
          isolatedRow.getByText('我', { exact: true }),
        ).toBeVisible();
      }
      assertNoForbiddenGuestData(historicSharedRead, fixture);
      await assertNoHorizontalOverflow(
        state.page,
        'Invitation-shared Guest annotations',
      );
      assert.deepEqual(state.observations.bridgeErrors, []);
      assert.deepEqual(state.observations.pageErrors, []);
    }

    await page.setViewportSize({ width: 375, height: 812 });
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/guest-annotations-mobile.png',
      fullPage: false,
    });
    await assertStorageBlocksReplacement({
      browser,
      worker,
      base,
      fixture,
      corrupt: true,
    });
    await assertStorageBlocksReplacement({
      browser,
      worker,
      base,
      fixture,
      corrupt: false,
    });
    const guestCookie = {
      name: guestCookieName(base),
      value: fixture.secretPeer,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(base).protocol === 'https:',
    };
    const beforePeerIdentityRefresh = observations.requests.length;
    await authorState.context.addCookies([guestCookie]);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await expect
      .poll(() =>
        observations.requests.some(
          (record, index) =>
            index >= beforePeerIdentityRefresh &&
            record.method === 'GET' &&
            record.pathname ===
              sharedAnnotationsPath(fixture, fixture.currentVersionId) &&
            record.status === 200 &&
            record.responseBody?.guestId === fixture.peerGuestId,
        ),
      )
      .toBe(true);
    const peerIdentityPointRow = restoredPanel.getByTestId(
      'annotation-item-' + pointItem.annotationId,
    );
    const peerIdentityRectangleRow = restoredPanel.getByTestId(
      'annotation-item-' + rectangleItem.annotationId,
    );
    await expect(peerIdentityPointRow).toBeVisible();
    await expect(peerIdentityPointRow).toContainText(fixture.authorLabel);
    await expect(
      peerIdentityPointRow.getByText('同邀請客戶', { exact: true }),
    ).toBeVisible();
    await assertPeerControlsAbsent(peerIdentityPointRow);
    await expect(peerIdentityRectangleRow).toBeVisible();
    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
    assert.ok(
      observations.requests.some(
        (record) =>
          record.method === 'GET' &&
          record.pathname ===
            sharedAnnotationsPath(fixture, fixture.versionId) &&
          record.status === 200,
      ),
      'The actual Guest After preview reads the selected historical version scope',
    );
    return fixture;
  } finally {
    await peerState?.close();
    await otherState?.close();
    await authorState?.close();
    await browser.close();
  }
}
