import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';
import { ownerAnnotationCommandSchema } from '../../../packages/contracts/src/owner-annotation-authoring.ts';
import {
  assertNoHorizontalOverflow,
  makeBrowserState,
  ownerCookieValue,
  projectAndAlbumNames,
} from './owner-comments-browser.mjs';

const coordinateScale = 1_000_000;

function ownerCommandPath(albumId) {
  return (
    '/api/v1/albums/' +
    encodeURIComponent(albumId) +
    '/annotations/owner/commands'
  );
}

function ownerReadPath(fixture, versionId) {
  return (
    '/api/v1/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/photos/' +
    encodeURIComponent(fixture.photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/annotations/owner'
  );
}

function ownerJournalKey(ownerId, albumId) {
  return 'kino-pic:owner-annotations:v1:' + ownerId + ':' + albumId;
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

function addOwnerAnnotationTransport({ state, worker, base, albumId }) {
  const commandPath = ownerCommandPath(albumId);
  let dropNextSuccessful = false;
  let nextHeld = null;
  let customSequence = 0;
  const heldRequests = [];

  state.observations.ownerAnnotationCommandPath = commandPath;
  state.observations.ownerAnnotationMutations = [];

  state.page.route('**' + commandPath, async (route) => {
    const incoming = route.request();
    if (
      new URL(incoming.url()).origin !== new URL(base).origin ||
      incoming.method() !== 'POST'
    ) {
      await route.fallback();
      return;
    }

    let response;
    let responseBytes;
    const headers = await incoming.allHeaders();
    headers['cf-connecting-ip'] = '198.51.100.181';
    try {
      const init = { method: incoming.method(), headers, redirect: 'manual' };
      init.body = incoming.postDataBuffer() ?? undefined;
      response = await worker.fetch(new Request(incoming.url(), init));
      responseBytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      const record = {
        sequence: 1_000_000 + ++customSequence,
        method: incoming.method(),
        pathname: new URL(incoming.url()).pathname,
        search: new URL(incoming.url()).search,
        status: 0,
        requestBody: parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0)),
        responseBody: null,
        dropped: false,
        bridgeError: error instanceof Error ? error.message : String(error),
      };
      state.observations.requests.push(record);
      state.observations.ownerMutations.push(record);
      state.observations.ownerAnnotationMutations.push(record);
      state.observations.bridgeErrors.push(record.bridgeError);
      try {
        await route.abort('failed');
      } catch {
        record.deliveryError = 'The browser request had already ended';
      }
      return;
    }

    const record = {
      sequence: 1_000_000 + ++customSequence,
      method: incoming.method(),
      pathname: new URL(incoming.url()).pathname,
      search: new URL(incoming.url()).search,
      status: response.status,
      requestBody: parseJson(incoming.postDataBuffer() ?? Buffer.alloc(0)),
      responseBody: parseJson(responseBytes),
      dropped: false,
      held: false,
      delivered: false,
    };
    state.observations.requests.push(record);
    state.observations.ownerMutations.push(record);
    state.observations.ownerAnnotationMutations.push(record);

    if (nextHeld && response.ok) {
      const held = nextHeld;
      nextHeld = null;
      held.record = record;
      record.held = true;
      held.resolveSeen();
      await held.delivery;
    }

    if (dropNextSuccessful && response.ok) {
      dropNextSuccessful = false;
      record.dropped = true;
      record.deliveryOverride = 'test-only transport drop';
      try {
        await route.abort('failed');
      } catch {
        record.deliveryError = 'The browser request had already ended';
      }
      return;
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
    }
  });

  return {
    dropNextSuccessfulResponse() {
      dropNextSuccessful = true;
    },
    holdNextSuccessfulResponse() {
      assert.equal(
        nextHeld,
        null,
        'Only one Owner command response can be held',
      );
      let releaseDelivery;
      let resolveSeen;
      let released = false;
      const held = {
        record: null,
        delivery: new Promise((resolve) => {
          releaseDelivery = resolve;
        }),
        seen: new Promise((resolve) => {
          resolveSeen = resolve;
        }),
        resolveSeen,
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
      heldRequests.forEach((held) => held.release());
    },
  };
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

function activeCanvasFor(surface) {
  return surface
    .page()
    .locator('[role="dialog"][aria-modal="true"]')
    .getByTestId('annotation-canvas');
}

async function waitForOption(select, more, value, label) {
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    const options = await select
      .locator('option')
      .evaluateAll((entries) => entries.map((entry) => entry.value));
    if (options.includes(value)) return;
    await expect(more).toBeVisible();
    const before = options.length;
    await more.click();
    await expect
      .poll(() =>
        select.locator('option').evaluateAll((entries) => entries.length),
      )
      .toBeGreaterThan(before);
  }
  assert.fail(label + ' was not found after loading available pages');
}

async function selectOwnerScope(panel, fixture, versionId) {
  const invite = panel.getByTestId('owner-annotation-invite');
  const version = panel.getByTestId('owner-annotation-version');
  await waitForOption(
    invite,
    panel.getByTestId('owner-annotation-invites-more'),
    fixture.inviteId,
    'The fixture Owner invitation',
  );
  await invite.selectOption(fixture.inviteId);
  await expect(version).toBeEnabled();
  await waitForOption(
    version,
    panel.getByTestId('owner-annotation-versions-more'),
    versionId,
    'The fixture Owner photo version',
  );
  await version.selectOption(versionId);
  await expect(version).toHaveValue(versionId);
  return { invite, version };
}

function sourcePoint(point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  return {
    x: (x - point.painted.left) / point.painted.width,
    y: (y - point.painted.top) / point.painted.height,
  };
}

function normalizedPoint(point) {
  const source = sourcePoint(point);
  return {
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x: Math.round(source.x * coordinateScale),
    y: Math.round(source.y * coordinateScale),
  };
}

function normalizedRectangle(start, end) {
  const first = sourcePoint(start);
  const second = sourcePoint(end);
  const x1 = Math.round(first.x * coordinateScale);
  const y1 = Math.round(first.y * coordinateScale);
  const x2 = Math.round(second.x * coordinateScale);
  const y2 = Math.round(second.y * coordinateScale);
  return {
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

async function pointOnImage(editor, fractionX, fractionY) {
  const image = activeCanvasFor(editor).getByTestId('annotation-preview-image');
  await expect(image).toBeVisible();
  return image.evaluate(
    (element, fractions) => {
      if (!(element instanceof HTMLImageElement))
        throw new Error('The Owner annotation preview must be an image');
      if (element.naturalWidth < 1 || element.naturalHeight < 1)
        throw new Error('The Owner preview image is not decoded');
      const box = element.getBoundingClientRect();
      const viewport = element.closest('[role="application"]');
      if (!(viewport instanceof HTMLElement))
        throw new Error('The Owner preview is not inside a drawing canvas');
      const viewportBounds = viewport.getBoundingClientRect();
      const style = getComputedStyle(element);
      let painted = {
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      };
      if (style.objectFit === 'contain') {
        const scale = Math.min(
          box.width / element.naturalWidth,
          box.height / element.naturalHeight,
        );
        const width = element.naturalWidth * scale;
        const height = element.naturalHeight * scale;
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
        painted,
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

function assertVisiblePoint(point) {
  assert.ok(point.x >= point.viewport.left);
  assert.ok(point.x <= point.viewport.left + point.viewport.width);
  assert.ok(point.y >= point.viewport.top);
  assert.ok(point.y <= point.viewport.top + point.viewport.height);
}

async function drawPoint(editor, fractions) {
  const canvas = activeCanvasFor(editor);
  await editor.getByTestId('owner-annotation-tool-point').click();
  await canvas.scrollIntoViewIfNeeded();
  const point = await pointOnImage(editor, fractions.x, fractions.y);
  assertVisiblePoint(point);
  await editor.page().mouse.click(Math.round(point.x), Math.round(point.y));
  return normalizedPoint(point);
}

async function drawReverseRectangle(editor, from, to) {
  const canvas = activeCanvasFor(editor);
  await editor.getByTestId('owner-annotation-tool-rectangle').click();
  await canvas.scrollIntoViewIfNeeded();
  const start = await pointOnImage(editor, from.x, from.y);
  const end = await pointOnImage(editor, to.x, to.y);
  assertVisiblePoint(start);
  assertVisiblePoint(end);
  await editor.page().mouse.move(Math.round(start.x), Math.round(start.y));
  await editor.page().mouse.down();
  await editor.page().mouse.move(Math.round(end.x), Math.round(end.y), {
    steps: 8,
  });
  await editor.page().mouse.up();
  return normalizedRectangle(start, end);
}

async function waitForMutation(state, requestId, operation, afterIndex = 0) {
  await expect
    .poll(() =>
      state.observations.ownerAnnotationMutations
        .slice(afterIndex)
        .some(
          (record) =>
            record.requestBody?.requestId === requestId &&
            record.requestBody?.operation === operation &&
            record.status === 200,
        ),
    )
    .toBe(true);
  return state.observations.ownerAnnotationMutations
    .slice(afterIndex)
    .find(
      (record) =>
        record.requestBody?.requestId === requestId &&
        record.requestBody?.operation === operation &&
        record.status === 200,
    );
}

async function waitForOwnerPage(
  state,
  fixture,
  versionId,
  inviteId,
  annotationId,
  afterIndex = 0,
) {
  const path = ownerReadPath(fixture, versionId);
  await expect
    .poll(() =>
      state.observations.requests.slice(afterIndex).some((record) => {
        const query = new URLSearchParams(record.search);
        return (
          record.method === 'GET' &&
          record.pathname === path &&
          record.status === 200 &&
          query.get('inviteId') === inviteId &&
          (annotationId === undefined ||
            query.get('annotationId') === annotationId)
        );
      }),
    )
    .toBe(true);
  return state.observations.requests.slice(afterIndex).find((record) => {
    const query = new URLSearchParams(record.search);
    return (
      record.method === 'GET' &&
      record.pathname === path &&
      record.status === 200 &&
      query.get('inviteId') === inviteId &&
      (annotationId === undefined || query.get('annotationId') === annotationId)
    );
  });
}

async function waitForOperation(state, operation, annotationId, afterIndex) {
  const matchingOperation = () =>
    state.observations.ownerAnnotationMutations
      .slice(afterIndex)
      .filter(
        (record) =>
          record.requestBody?.operation === operation &&
          record.requestBody?.annotationId === annotationId &&
          record.status === 200,
      )
      .at(-1);
  await expect.poll(matchingOperation).toBeTruthy();
  return matchingOperation();
}

async function waitForOwnerRow(editor, annotationId, state, revision) {
  const row = editor.getByTestId('owner-annotation-item-' + annotationId);
  await expect(row).toBeVisible();
  await expect(row).toContainText('修訂 ' + revision);
  await expect(row).toContainText(state);
  return row;
}

async function captureVisibleAnnotation({
  page,
  editor,
  annotationId,
  expectedGeometry,
}) {
  const canvas = activeCanvasFor(editor);
  const image = activeCanvasFor(editor).getByTestId('annotation-preview-image');
  const mark = canvas.getByTestId('annotation-mark-' + annotationId);
  const rectangle = mark.locator('rect');

  await image.scrollIntoViewIfNeeded();
  await image.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest' }),
  );
  await expect
    .poll(() =>
      image.evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0 &&
          element.naturalHeight > 0,
      ),
    )
    .toBe(true);

  const imageVisibility = await image.evaluate((element) => {
    if (!(element instanceof HTMLImageElement))
      throw new Error(
        'The Owner annotation canvas must contain its decoded image',
      );
    const stage = element.closest('.kino-photo-detail-stage');
    const canvasElement = element.closest('[data-testid="annotation-canvas"]');
    const view = element.ownerDocument.defaultView;
    if (
      !(stage instanceof HTMLElement) ||
      !(canvasElement instanceof HTMLElement) ||
      !view
    )
      throw new Error(
        'The Owner annotation image must remain in the main photo stage',
      );
    const imageRect = element.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvasElement.getBoundingClientRect();
    const left = Math.max(imageRect.left, stageRect.left, 0);
    const top = Math.max(imageRect.top, stageRect.top, 0);
    const right = Math.min(imageRect.right, stageRect.right, view.innerWidth);
    const bottom = Math.min(
      imageRect.bottom,
      stageRect.bottom,
      view.innerHeight,
    );
    const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
    return {
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      imageRect: {
        left: imageRect.left,
        top: imageRect.top,
        right: imageRect.right,
        bottom: imageRect.bottom,
        width: imageRect.width,
        height: imageRect.height,
      },
      canvasRect: {
        left: canvasRect.left,
        top: canvasRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
      },
      visibleRatio: visibleArea / (imageRect.width * imageRect.height),
    };
  });
  assert.ok(imageVisibility.naturalWidth > 0);
  assert.ok(imageVisibility.naturalHeight > 0);
  assert.ok(
    imageVisibility.visibleRatio > 0.25,
    'The decoded main photo must be visible inside its stage and viewport',
  );

  await expect(mark).toBeVisible();
  await expect(rectangle).toHaveCount(1);
  const markerMetrics = await rectangle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const canvasElement = element.closest('[data-testid="annotation-canvas"]');
    const view = element.ownerDocument.defaultView;
    if (!(canvasElement instanceof HTMLElement) || !view)
      throw new Error('The saved rectangle must be inside the Owner canvas');
    const canvasRect = canvasElement.getBoundingClientRect();
    const stage = element.closest('.kino-photo-detail-stage');
    if (!(stage instanceof HTMLElement))
      throw new Error(
        'The saved rectangle must stay inside the main photo stage',
      );
    const stageRect = stage.getBoundingClientRect();
    const left = Math.max(rect.left, stageRect.left, 0);
    const top = Math.max(rect.top, stageRect.top, 0);
    const right = Math.min(rect.right, stageRect.right, view.innerWidth);
    const bottom = Math.min(rect.bottom, stageRect.bottom, view.innerHeight);
    const visibleArea = Math.max(0, right - left) * Math.max(0, bottom - top);
    const shapeArea = rect.width * rect.height;
    return {
      x: Number(element.getAttribute('x')),
      y: Number(element.getAttribute('y')),
      width: Number(element.getAttribute('width')),
      height: Number(element.getAttribute('height')),
      bounds: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      canvas: {
        left: canvasRect.left,
        top: canvasRect.top,
        width: canvasRect.width,
        height: canvasRect.height,
      },
      visibleRatio: visibleArea / shapeArea,
      stroke: getComputedStyle(element.parentElement).stroke,
    };
  });
  assert.deepEqual(
    {
      type: 'rectangle',
      coordinateSpace: 'normalized_1e6',
      x: markerMetrics.x,
      y: markerMetrics.y,
      width: markerMetrics.width,
      height: markerMetrics.height,
    },
    expectedGeometry,
    'The actual SVG rectangle must retain the saved normalized geometry',
  );
  assert.ok(markerMetrics.bounds.width > 8);
  assert.ok(markerMetrics.bounds.height > 8);
  assert.ok(
    markerMetrics.visibleRatio > 0.95,
    'The saved SVG rectangle must be visible inside the main photo stage',
  );
  assert.equal(markerMetrics.stroke, 'rgb(220, 38, 38)');

  const canvasPng = await canvas.screenshot({
    path: '.local/owner-annotation-authoring-canvas.png',
    animations: 'disabled',
  });
  const canvasImage = await sharp(canvasPng)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const scaleX = canvasImage.info.width / markerMetrics.canvas.width;
  const scaleY = canvasImage.info.height / markerMetrics.canvas.height;
  const left = Math.round(
    (markerMetrics.bounds.left - markerMetrics.canvas.left) * scaleX,
  );
  const top = Math.round(
    (markerMetrics.bounds.top - markerMetrics.canvas.top) * scaleY,
  );
  const width = Math.round(markerMetrics.bounds.width * scaleX);
  const height = Math.round(markerMetrics.bounds.height * scaleY);
  let redStrokePixels = 0;
  const isRed = (x, y) => {
    if (
      x < 0 ||
      y < 0 ||
      x >= canvasImage.info.width ||
      y >= canvasImage.info.height
    )
      return false;
    const offset = (y * canvasImage.info.width + x) * canvasImage.info.channels;
    const red = canvasImage.data[offset];
    const green = canvasImage.data[offset + 1];
    const blue = canvasImage.data[offset + 2];
    return red >= 150 && green <= 100 && blue <= 100;
  };
  for (let step = 1; step < 20; step += 1) {
    const x = Math.round(left + (width * step) / 20);
    const y = Math.round(top + (height * step) / 20);
    for (let offset = -3; offset <= 3; offset += 1) {
      if (isRed(x, top + offset) || isRed(x, top + height + offset))
        redStrokePixels += 1;
      if (isRed(left + offset, y) || isRed(left + width + offset, y))
        redStrokePixels += 1;
    }
  }
  assert.ok(
    redStrokePixels > 0,
    'The canvas screenshot must contain rendered red rectangle pixels',
  );
  await page.screenshot({
    path: '.local/owner-annotation-authoring-updated-mobile.png',
    fullPage: false,
    animations: 'disabled',
  });
}

async function readAnnotationFootprint(db, ownerId, annotationId) {
  const row = await db
    .prepare(
      'SELECT id,invite_id,album_id,photo_id,version_id,geometry_json,style_json,linked_comment_id,state,revision FROM owner_annotations WHERE id=?',
    )
    .bind(annotationId)
    .first();
  const changes = await db
    .prepare(
      'SELECT operation,revision,request_id FROM owner_annotation_changes WHERE actor_id=? AND annotation_id=? ORDER BY revision',
    )
    .bind(ownerId, annotationId)
    .all();
  return { row, changes: changes.results };
}

async function commandCount(db, ownerId, requestId) {
  const row = await db
    .prepare(
      'SELECT count(*) AS n FROM owner_annotation_commands WHERE actor_id=? AND request_id=?',
    )
    .bind(ownerId, requestId)
    .first();
  return Number(row?.n ?? 0);
}

export async function runOwnerAnnotationAuthoringBrowserChecks({
  db,
  worker,
  base,
  ownerCookie,
  fixture,
  owner,
}) {
  assert.ok(db && worker && base && fixture);
  assert.ok(
    ownerCookie,
    'Owner authoring browser checks need the Owner cookie',
  );
  assert.ok(owner, 'Owner authoring browser checks need the Owner id');
  for (const key of [
    'albumId',
    'projectId',
    'photoId',
    'versionId',
    'currentVersionId',
    'filename',
    'inviteId',
  ])
    assert.ok(fixture?.[key], 'The Owner authoring fixture provides ' + key);

  const { albumName, projectName, projectId } = await projectAndAlbumNames(
    db,
    fixture.albumId,
  );
  const browser = await chromium.launch({ headless: true });
  let ownerState;
  let transport;
  let heldCreate;
  try {
    ownerState = await makeBrowserState({
      browser,
      worker,
      base,
      cookieName: 'kino-owner.session_token',
      cookieValue: ownerCookieValue(ownerCookie),
      kind: 'owner',
      albumId: fixture.albumId,
      mutationSuffix: 'annotations/owner',
    });
    transport = addOwnerAnnotationTransport({
      state: ownerState,
      worker,
      base,
      albumId: fixture.albumId,
    });
    const { page, observations } = ownerState;
    const { dialog, panel } = await openOwnerPhoto({
      page,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    const { version } = await selectOwnerScope(
      panel,
      fixture,
      fixture.versionId,
    );
    const editor = panel.getByTestId('owner-annotation-editor');
    await expect(editor).toBeVisible();
    await expect(version).toHaveValue(fixture.versionId);
    const initialRead = await waitForOwnerPage(
      ownerState,
      fixture,
      fixture.versionId,
      fixture.inviteId,
    );
    assert.equal(initialRead.responseBody.ownerId, owner);
    assert.equal(initialRead.responseBody.inviteId, fixture.inviteId);
    assert.equal(initialRead.responseBody.photoId, fixture.photoId);
    assert.equal(initialRead.responseBody.versionId, fixture.versionId);
    assert.ok(
      initialRead.responseBody.items.every(
        (item) => item.authorType === 'owner' && item.canEdit === true,
      ),
      'The editor list contains only verified Owner-authored rows',
    );

    const image = activeCanvasFor(editor).getByTestId(
      'annotation-preview-image',
    );
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.naturalWidth > 0 &&
            element.naturalHeight > 0,
        ),
      )
      .toBe(true);
    const canvas = activeCanvasFor(editor);
    await expect(canvas).toBeVisible();
    const { invite } = await selectOwnerScope(
      panel,
      fixture,
      fixture.versionId,
    );
    await expect(invite).toHaveValue(fixture.inviteId);

    // A live canvas draft locks the gallery and scope selectors until it is
    // either saved into the journal or explicitly cancelled.
    const createGeometry = await drawPoint(editor, { x: 0.42, y: 0.36 });
    await expect(editor.getByTestId('owner-annotation-save')).toBeEnabled();
    await expect(version).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: '關閉', exact: true }),
    ).toBeDisabled();

    heldCreate = transport.holdNextSuccessfulResponse();
    await editor.getByTestId('owner-annotation-save').click();
    await heldCreate.seen;
    const heldRecord = heldCreate.record;
    assert.equal(heldRecord?.status, 200);
    assert.equal(heldRecord?.requestBody?.operation, 'create');
    assert.equal(heldRecord?.requestBody?.expectedOwnerId, owner);
    assert.equal(heldRecord?.requestBody?.inviteId, fixture.inviteId);
    assert.equal(heldRecord?.requestBody?.photoId, fixture.photoId);
    assert.equal(heldRecord?.requestBody?.versionId, fixture.versionId);
    assert.deepEqual(heldRecord?.requestBody?.geometry, createGeometry);
    ownerAnnotationCommandSchema.parse(heldRecord?.requestBody);
    const created = heldRecord?.responseBody?.item;
    assert.ok(created?.annotationId);
    assert.equal(created.authorType, 'owner');
    assert.equal(created.canEdit, true);
    assert.equal(created.revision, 1);

    const journalKey = ownerJournalKey(owner, fixture.albumId);
    const rawBeforeReload = await page.evaluate(
      (key) => window.sessionStorage.getItem(key),
      journalKey,
    );
    assert.ok(
      rawBeforeReload,
      'The full Owner command is persisted before network delivery',
    );
    const journalBeforeReload = JSON.parse(rawBeforeReload);
    assert.deepEqual(journalBeforeReload.command, heldRecord.requestBody);
    for (const privateValue of [
      ownerCookieValue(ownerCookie),
      fixture.guestSecret,
      fixture.peerGuestSecret,
      fixture.inviteToken,
      'previewUrl',
      'originalUrl',
      'photoBytes',
    ])
      if (privateValue)
        assert.equal(rawBeforeReload.includes(privateValue), false);

    // The Worker has committed the real command, but the browser response is
    // delayed across a full reload. The recovered retry must use the same UUID.
    await page.reload({ waitUntil: 'domcontentloaded' });
    heldCreate.release();
    await openOwnerPhoto({
      page,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    const reopenedPanel = page.getByTestId('owner-annotations-panel');
    await selectOwnerScope(reopenedPanel, fixture, fixture.versionId);
    const reopenedEditor = reopenedPanel.getByTestId('owner-annotation-editor');
    await expect(reopenedEditor).toBeVisible();
    await expect(
      reopenedEditor.getByTestId('owner-annotation-retry'),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      rawBeforeReload,
      'Reload restores the unchanged bodyless command metadata',
    );
    await expect(
      page.getByRole('button', { name: '關閉', exact: true }),
    ).toBeDisabled();
    const replayMutationStart = observations.ownerAnnotationMutations.length;
    const replayReadStart = observations.requests.length;
    await reopenedEditor.getByTestId('owner-annotation-retry').click();
    const replay = await waitForMutation(
      ownerState,
      heldRecord.requestBody.requestId,
      'create',
      replayMutationStart,
    );
    assert.deepEqual(replay.requestBody, heldRecord.requestBody);
    assert.equal(replay.responseBody.item.annotationId, created.annotationId);
    const currentRead = await waitForOwnerPage(
      ownerState,
      fixture,
      fixture.versionId,
      fixture.inviteId,
      created.annotationId,
      replayReadStart,
    );
    assert.equal(currentRead.responseBody.items.length, 1);
    assert.equal(currentRead.responseBody.items[0].revision, 1);
    await expect
      .poll(
        () =>
          page.evaluate(
            (key) => window.sessionStorage.getItem(key),
            journalKey,
          ),
        {
          message:
            'The journal is cleared only after the current Owner row is reread and consumed',
        },
      )
      .toBeNull();
    await expect(
      reopenedEditor.getByTestId(
        'owner-annotation-item-' + created.annotationId,
      ),
    ).toContainText('修訂 1');
    assert.equal(
      await commandCount(db, owner, heldRecord.requestBody.requestId),
      1,
      'The delayed replay creates one durable command row',
    );

    const createdRow = reopenedEditor.getByTestId(
      'owner-annotation-item-' + created.annotationId,
    );
    await createdRow
      .getByRole('button', { name: '編輯標記', exact: true })
      .click();
    await reopenedEditor
      .getByRole('button', { name: '紅色標記', exact: true })
      .click();
    const updateGeometry = await drawReverseRectangle(
      reopenedEditor,
      { x: 0.73, y: 0.69 },
      { x: 0.29, y: 0.31 },
    );
    const updateStart = observations.ownerAnnotationMutations.length;
    await reopenedEditor.getByTestId('owner-annotation-save').click();
    const update = await waitForOperation(
      ownerState,
      'update',
      created.annotationId,
      updateStart,
    );
    assert.ok(update, 'The actual Owner update command reached the Worker');
    assert.equal(update.requestBody.expectedRevision, 1);
    assert.deepEqual(update.requestBody.geometry, updateGeometry);
    assert.deepEqual(update.requestBody.style, { color: 'red' });
    assert.equal(update.requestBody.commentId, null);
    await waitForOwnerRow(reopenedEditor, created.annotationId, '待處理', 2);
    await mkdir('.local', { recursive: true });
    await assertNoHorizontalOverflow(page, 'Owner annotation authoring');
    await captureVisibleAnnotation({
      page,
      editor: reopenedEditor,
      annotationId: created.annotationId,
      expectedGeometry: updateGeometry,
    });

    const rowAfterUpdate = reopenedEditor.getByTestId(
      'owner-annotation-item-' + created.annotationId,
    );
    const resolveStart = observations.ownerAnnotationMutations.length;
    await rowAfterUpdate
      .getByRole('button', { name: '標記已處理', exact: true })
      .click();
    const resolve = await waitForOperation(
      ownerState,
      'resolve',
      created.annotationId,
      resolveStart,
    );
    assert.equal(resolve.requestBody.expectedRevision, 2);
    await waitForOwnerRow(reopenedEditor, created.annotationId, '已處理', 3);

    const resolvedRow = reopenedEditor.getByTestId(
      'owner-annotation-item-' + created.annotationId,
    );
    const reopenStart = observations.ownerAnnotationMutations.length;
    await resolvedRow
      .getByRole('button', { name: '重新開啟', exact: true })
      .click();
    const reopen = await waitForOperation(
      ownerState,
      'reopen',
      created.annotationId,
      reopenStart,
    );
    assert.equal(reopen.requestBody.expectedRevision, 3);
    await waitForOwnerRow(reopenedEditor, created.annotationId, '待處理', 4);

    const reopenedRow = reopenedEditor.getByTestId(
      'owner-annotation-item-' + created.annotationId,
    );
    const deleteStart = observations.ownerAnnotationMutations.length;
    await reopenedRow
      .getByRole('button', { name: '刪除標記', exact: true })
      .click();
    const remove = await waitForOperation(
      ownerState,
      'delete',
      created.annotationId,
      deleteStart,
    );
    assert.equal(remove.requestBody.expectedRevision, 4);
    const tombstone = await waitForOwnerRow(
      reopenedEditor,
      created.annotationId,
      '已刪除',
      5,
    );
    await expect(tombstone.getByRole('button')).toHaveCount(1);

    const footprint = await readAnnotationFootprint(
      db,
      owner,
      created.annotationId,
    );
    assert.equal(footprint.row?.invite_id, fixture.inviteId);
    assert.equal(footprint.row?.album_id, fixture.albumId);
    assert.equal(footprint.row?.photo_id, fixture.photoId);
    assert.equal(footprint.row?.version_id, fixture.versionId);
    assert.equal(footprint.row?.state, 'deleted');
    assert.equal(footprint.row?.revision, 5);
    assert.equal(footprint.row?.geometry_json, null);
    assert.equal(footprint.row?.style_json, null);
    assert.equal(footprint.row?.linked_comment_id, null);
    assert.deepEqual(
      footprint.changes.map((change) => [change.operation, change.revision]),
      [
        ['create', 1],
        ['update', 2],
        ['resolve', 3],
        ['reopen', 4],
        ['delete', 5],
      ],
    );

    // Rehydrate the same full command metadata after its successful history
    // has been reconciled. Disabling the real Owner row makes the next
    // authorization read fail through the Worker middleware; the Gallery must
    // hide its protected thumbnails, preview, and annotation canvas while
    // leaving this exact recovery record available for the same Owner later.
    await page.evaluate(
      ({ key, value }) => window.sessionStorage.setItem(key, value),
      { key: journalKey, value: rawBeforeReload },
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const { dialog: recoveryDialog, panel: recoveryPanel } =
      await openOwnerPhoto({
        page,
        base,
        projectId,
        projectName,
        albumName,
        filename: fixture.filename,
      });
    await selectOwnerScope(recoveryPanel, fixture, fixture.versionId);
    const recoveryEditor = recoveryPanel.getByTestId('owner-annotation-editor');
    await expect(recoveryEditor).toBeVisible();
    await expect(
      recoveryEditor.getByTestId('owner-annotation-retry'),
    ).toBeVisible();
    await expect(
      recoveryDialog.getByRole('button', { name: '關閉', exact: true }),
    ).toBeDisabled();
    const privateImageCount = await page
      .locator('img[src^="/api/v1/photos/"]')
      .count();
    assert.ok(
      privateImageCount > 0,
      'Protected images are visible before denial',
    );
    assert.equal(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      rawBeforeReload,
      'The restored pending intent is unchanged before the auth denial',
    );

    const denialStart = observations.requests.length;
    await db
      .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
      .bind(owner)
      .run();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await expect
      .poll(() =>
        observations.requests
          .slice(denialStart)
          .some(
            (record) =>
              record.status === 403 &&
              record.responseBody?.error?.code === 'OWNER_REQUIRED',
          ),
      )
      .toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('img[src^="/api/v1/photos/"]')).toHaveCount(0);
    assert.equal(
      await page.evaluate(
        (key) => window.sessionStorage.getItem(key),
        journalKey,
      ),
      rawBeforeReload,
      'A 403 clears private UI but preserves the exact recovery metadata',
    );
    assert.deepEqual(
      JSON.parse(
        await page.evaluate(
          (key) => window.sessionStorage.getItem(key),
          journalKey,
        ),
      ),
      JSON.parse(rawBeforeReload),
      'All fields in the full Owner command journal remain intact',
    );

    assert.equal(
      observations.ownerAnnotationMutations.filter(
        (record) => record.requestBody?.operation === 'create',
      ).length,
      2,
      'The held create and exact replay were both sent by the UI',
    );
    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
  } finally {
    try {
      transport?.releaseAll();
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner)
        .run();
    } finally {
      await ownerState?.close();
      await browser.close();
    }
  }
}
