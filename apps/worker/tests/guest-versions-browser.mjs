import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import sharp from 'sharp';

const canViewBit = 1;
const canSelectBit = 8;
const canCompareVersionsBit = 2048;
const guestMutationTables = [
  'guest_invite_revocations',
  'guest_session_revocations',
  'guest_logout_commands',
  'guest_exchange_commands',
  'guest_selection_state',
  'guest_selection_commands',
  'guest_selection_results',
  'guest_selection_round_state',
  'guest_selection_submissions',
  'guest_selection_submission_items',
  'guest_selection_submission_results',
  'guest_selection_submission_seals',
  'guest_feedback_commands',
  'guest_feedback_results',
  'guest_rating_state',
  'guest_favorite_state',
  'guest_tag_labels',
  'guest_tag_commands',
  'guest_tag_results',
  'guest_tag_state',
];

function guestCookieName(base) {
  return new URL(base).protocol === 'https:'
    ? '__Host-kino_guest'
    : 'kino_guest';
}

function guestSessionHash(secret) {
  return createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
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

function versionPath(albumId, photoId) {
  return (
    '/api/guest/albums/' +
    encodeURIComponent(albumId) +
    '/photos/' +
    encodeURIComponent(photoId) +
    '/versions'
  );
}

function assetPath(photoId, versionId, kind = 'preview') {
  return (
    '/api/guest/photos/' +
    encodeURIComponent(photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/assets/' +
    kind
  );
}

function assertProtectedVersionAssetUrls(version, pageUrl, photoId) {
  for (const kind of ['thumbnail', 'preview']) {
    const value = version[kind + 'Url'];
    assert.equal(typeof value, 'string');
    const url = new URL(value, pageUrl);
    assert.equal(url.origin, new URL(pageUrl).origin);
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.pathname, assetPath(photoId, version.versionId, kind));
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
}

async function createGuestBrowser({ browser, worker, base, albumId, secret }) {
  const secure = new URL(base).protocol === 'https:';
  const cookieName = guestCookieName(base);
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await context.addCookies([
    {
      name: cookieName,
      value: secret,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure,
    },
  ]);

  const page = await context.newPage();
  const observations = {
    requests: [],
    galleryReads: [],
    accessReads: [],
    capabilityReads: [],
    versionReads: [],
    assets: [],
    mutations: [],
    bridgeErrors: [],
    pageErrors: [],
  };
  let sequence = 0;

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
    headers['cf-connecting-ip'] = '198.51.100.101';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = incoming.postDataBuffer() ?? undefined;
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
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const record = {
      sequence: ++sequence,
      method,
      pathname: url.pathname,
      search: url.search,
      status: response.status,
      body: parseJson(responseBytes),
      contentType: response.headers.get('content-type'),
      cookieNames: cookieNames(cookieHeader),
    };
    observations.requests.push(record);

    if (
      method === 'GET' &&
      url.pathname === '/api/guest/version-comparison/capabilities'
    ) {
      observations.capabilityReads.push(record);
    }
    if (
      method === 'GET' &&
      url.pathname === '/api/guest/albums/' + albumId + '/access'
    ) {
      observations.accessReads.push(record);
    }
    if (
      method === 'GET' &&
      url.pathname === '/api/guest/albums/' + albumId + '/photos'
    ) {
      observations.galleryReads.push(record);
    }
    const versionReadMatch =
      method === 'GET' &&
      new RegExp(
        '^/api/guest/albums/' + albumId + '/photos/([^/]+)/versions$',
        'u',
      ).exec(url.pathname);
    if (versionReadMatch) {
      record.versionPhotoId = versionReadMatch[1];
      observations.versionReads.push(record);
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
        body: record.body,
      });
    }
    if (
      url.pathname.startsWith('/api/guest/') &&
      !['GET', 'HEAD'].includes(method)
    ) {
      observations.mutations.push({
        method,
        pathname: url.pathname,
        status: response.status,
      });
    }

    await route.fulfill({
      status: response.status,
      headers: responseHeaders,
      body: responseBytes,
    });
  });

  return {
    context,
    page,
    observations,
    cookieName,
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

async function openGuestLightbox(page, base, albumId, filename) {
  const document = await page.goto(
    base + '/guest/albums/' + encodeURIComponent(albumId),
    { waitUntil: 'networkidle' },
  );
  assert.equal(document?.status(), 200);
  await expect(page.getByRole('heading', { name: /客戶挑片/u })).toBeVisible();

  const openPhoto = targetPhotoButton(page, filename);
  await expect(openPhoto).toBeVisible();
  await openPhoto.click();

  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2').first()).toHaveText(filename);
  return dialog;
}

async function pageFetch(page, pathname) {
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
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body,
    };
  }, pathname);
}

async function photoVersionPage(db, secret) {
  const session = await db
    .prepare(
      'SELECT i.permissions_mask FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id WHERE s.secret_hash=?',
    )
    .bind(guestSessionHash(secret))
    .first();
  assert.ok(session, 'The fixture Guest session exists');
  return { permissionsMask: session.permissions_mask };
}

async function guestMutationSnapshot(db, albumId) {
  const counts = {};
  for (const table of guestMutationTables) {
    const row = await db
      .prepare('SELECT count(*) AS count FROM ' + table)
      .first();
    counts[table] = row?.count ?? null;
  }
  const events = await db
    .prepare(
      "SELECT count(*) AS count FROM audit_events WHERE actor_type='guest' AND album_id=?",
    )
    .bind(albumId)
    .first();
  counts.guestAuditEvents = events?.count ?? null;
  return counts;
}

async function readSliderStageState(page) {
  const stage = page.getByTestId('compare-slider-stage');
  return stage.evaluate((element) => {
    const range = document.querySelector('[data-testid="compare-slider"]');
    const images = element.querySelectorAll('img');
    const divider = element.querySelector(
      '[data-testid="compare-split-divider"]',
    );
    const handle = element.querySelector('[data-testid="compare-drag-handle"]');
    const stageRect = element.getBoundingClientRect();
    const centerPercent = (node) => {
      const rect = node.getBoundingClientRect();
      return (
        ((rect.left + rect.width / 2 - stageRect.left) / stageRect.width) * 100
      );
    };
    const style = getComputedStyle(element);
    return {
      rangeValue: Number(range?.value),
      baselinePosition: element.style
        .getPropertyValue('--guest-compare-split-position')
        .trim(),
      dividerCenterPercent: centerPercent(divider),
      handleCenterPercent: centerPercent(handle),
      afterClipExpression: images[1]?.style.clipPath ?? '',
      dividerExpression: divider?.parentElement?.style.left ?? '',
      touchAction: style.touchAction,
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      hintActive: element.getAttribute('data-hint-active'),
      hintClassActive: element.classList.contains(
        'guest-compare-slider-stage-hint',
      ),
      splitOffset: style
        .getPropertyValue('--guest-compare-split-offset')
        .trim(),
    };
  });
}

function assertSliderGeometryMatchesRange(state, expectedValue, tolerance) {
  assert.equal(state.rangeValue, expectedValue);
  assert.equal(Number.parseFloat(state.baselinePosition), expectedValue);
  assert.ok(
    state.afterClipExpression.includes('--guest-compare-split-position') &&
      state.afterClipExpression.includes('--guest-compare-split-offset'),
    'After clipping follows the live divider expression',
  );
  assert.ok(
    state.dividerExpression.includes('--guest-compare-split-position') &&
      state.dividerExpression.includes('--guest-compare-split-offset'),
    'The divider follows the same live split expression',
  );
  assert.ok(
    Math.abs(state.dividerCenterPercent - expectedValue) <= tolerance,
    'The divider remains aligned to the range value within the hint offset',
  );
  assert.ok(
    Math.abs(state.handleCenterPercent - state.dividerCenterPercent) <= 0.5,
    'The drag handle stays centered on the divider',
  );
}

async function assertSliderShowsPinnedVersions({
  page,
  photoId,
  beforeVersionId,
  afterVersionId,
}) {
  const stage = page.getByTestId('compare-slider-stage');
  const images = stage.locator('img');
  await expect(images).toHaveCount(2);
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
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

  const imageDetails = await images.evaluateAll((nodes) =>
    nodes.map((node) => ({
      alt: node.alt,
      url: new URL(node.src).href,
      naturalWidth: node.naturalWidth,
      naturalHeight: node.naturalHeight,
    })),
  );
  const versionIds = imageDetails.map((image) => {
    const url = new URL(image.url);
    assert.equal(url.origin, new URL(page.url()).origin);
    const match =
      /^\/api\/guest\/photos\/([^/]+)\/versions\/([^/]+)\/assets\/preview$/u.exec(
        url.pathname,
      );
    assert.ok(match, 'Slider uses a same-origin protected Guest preview');
    assert.equal(match[1], photoId);
    return match[2];
  });
  assert.deepEqual(
    versionIds,
    [beforeVersionId, afterVersionId],
    'The left and right image layers stay pinned to the selected Before and After versions',
  );
  assert.match(imageDetails[0].alt, /Before 版本/u);
  assert.match(imageDetails[1].alt, /After 版本/u);
  await expect(stage.getByText('BEFORE', { exact: true })).toBeVisible();
  await expect(stage.getByText('AFTER', { exact: true })).toBeVisible();

  const state = await readSliderStageState(page);
  assertSliderGeometryMatchesRange(state, state.rangeValue, 1.5);
  return { stage, images };
}

async function assertSliderShowsDistinctRenderedSides(stage) {
  const screenshot = await stage.screenshot();
  const { data, info } = await sharp(screenshot)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sample = (xRatio, yRatio) => {
    const x = Math.min(info.width - 1, Math.floor(info.width * xRatio));
    const y = Math.min(info.height - 1, Math.floor(info.height * yRatio));
    const start = (y * info.width + x) * info.channels;
    return Array.from(data.subarray(start, start + 3));
  };
  const left = sample(0.25, 0.5);
  const right = sample(0.75, 0.5);
  const distance = left.reduce(
    (total, channel, index) => total + Math.abs(channel - right[index]),
    0,
  );
  assert.ok(
    distance > 35,
    'The rendered left Before and right After sides contain distinct real preview pixels',
  );
}
async function assertOnlyGuestCookie(observations, expectedCookieName) {
  for (const request of observations.requests.filter((item) =>
    item.pathname.startsWith('/api/'),
  )) {
    assert.deepEqual(
      request.cookieNames,
      [expectedCookieName],
      'Same-origin API requests carry only the Guest cookie',
    );
  }
}

async function assertNoMobileOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    'Guest version comparison overflows the 375px viewport',
  );
}

async function assertCanvasUsesVersions({
  page,
  observations,
  photoId,
  expectedVersionIds,
}) {
  const canvas = page.getByTestId('compare-canvas');
  const images = canvas.locator('img');
  const comparison = page.getByTestId('guest-version-comparison');
  await expect(images).toHaveCount(2);
  await expect(comparison.locator('img')).toHaveCount(2);
  await expect(comparison.locator('a[href]')).toHaveCount(0);
  await expect
    .poll(() =>
      images.evaluateAll((nodes) =>
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

  const sources = await images.evaluateAll((nodes) =>
    nodes.map((node) => new URL(node.src).href),
  );
  const actualVersionIds = sources.map((source) => {
    const url = new URL(source);
    assert.equal(url.origin, new URL(page.url()).origin);
    const match =
      /^\/api\/guest\/photos\/([^/]+)\/versions\/([^/]+)\/assets\/preview$/u.exec(
        url.pathname,
      );
    assert.ok(match, 'Comparison canvas uses a protected Guest preview URL');
    assert.equal(match[1], photoId);
    return match[2];
  });
  assert.deepEqual(
    [...actualVersionIds].sort(),
    [...expectedVersionIds].sort(),
    'The canvas contains only the selected photo versions',
  );

  for (const versionId of expectedVersionIds) {
    assert.ok(
      observations.assets.some(
        (asset) =>
          asset.photoId === photoId &&
          asset.versionId === versionId &&
          asset.kind === 'preview' &&
          asset.status === 200 &&
          asset.contentType === 'image/jpeg' &&
          asset.byteLength > 128,
      ),
      'The selected private preview was served through the Worker/R2 gateway',
    );
  }
}

function assertPreviewRequestsBelongToPair(
  assets,
  photoId,
  expectedVersionIds,
) {
  const expected = new Set(expectedVersionIds);
  const requested = new Set(
    assets
      .filter((asset) => asset.photoId === photoId && asset.kind === 'preview')
      .map((asset) => asset.versionId),
  );
  for (const versionId of requested) {
    assert.ok(
      expected.has(versionId),
      'The browser requested no preview outside the currently selected pair',
    );
  }
}

async function assertGuestBrowserHasNoPii(state, secret, ids) {
  const serializedVersions = JSON.stringify(
    state.observations.versionReads.map((read) => read.body).filter(Boolean),
  );
  assert.equal(serializedVersions.includes(secret), false);
  for (const forbidden of [
    'email',
    'actorId',
    'userId',
    'oauthSubject',
    'changeNote',
  ]) {
    assert.equal(
      serializedVersions.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      'Guest version metadata does not expose ' + forbidden,
    );
  }

  const visibleText = await state.page.locator('main').innerText();
  assert.equal(visibleText.includes(secret), false);
  for (const id of ids.filter(Boolean)) {
    assert.equal(
      visibleText.includes(id),
      false,
      'The Guest UI does not display raw identifiers',
    );
  }
}

async function checkViewOnlyEntry({
  browser,
  worker,
  base,
  albumId,
  photoId,
  filename,
  secretViewOnly,
}) {
  const state = await createGuestBrowser({
    browser,
    worker,
    base,
    albumId,
    secret: secretViewOnly,
  });
  try {
    const dialog = await openGuestLightbox(state.page, base, albumId, filename);
    await expect
      .poll(() => state.observations.accessReads.length)
      .toBeGreaterThan(0);
    await expect(state.page.getByTestId('guest-compare-open')).toHaveCount(0);
    const denied = await pageFetch(state.page, versionPath(albumId, photoId));
    assert.equal(denied.status, 401);
    assert.equal(denied.body?.error?.code, 'GUEST_ACCESS_REQUIRED');
    assert.equal(await dialog.isVisible(), true);
    await assertOnlyGuestCookie(state.observations, state.cookieName);
  } finally {
    await state.close();
  }
}

async function checkCompareOnlyDenied({
  browser,
  worker,
  base,
  albumId,
  photoId,
  secretCompareOnly,
}) {
  const state = await createGuestBrowser({
    browser,
    worker,
    base,
    albumId,
    secret: secretCompareOnly,
  });
  try {
    const response = await state.page.goto(
      base + '/guest/albums/' + encodeURIComponent(albumId),
      { waitUntil: 'networkidle' },
    );
    assert.equal(response?.status(), 200);
    await expect(state.page.getByTestId('guest-compare-open')).toHaveCount(0);
    const denied = await pageFetch(state.page, versionPath(albumId, photoId));
    assert.equal(denied.status, 401);
    assert.equal(denied.body?.error?.code, 'GUEST_ACCESS_REQUIRED');
    await assertOnlyGuestCookie(state.observations, state.cookieName);
  } finally {
    await state.close();
  }
}

export async function runGuestVersionBrowserChecks({
  worker,
  base,
  db,
  albumId,
  photoId,
  filename,
  neighborPhotoId,
  neighborFilename,
  currentVersionId,
  latestVersionId,
  unpublishedVersionId,
  secretCompare,
  secretViewOnly,
  secretCompareOnly,
  revokeCompareAccess,
}) {
  assert.ok(neighborPhotoId && neighborFilename);
  assert.equal(typeof revokeCompareAccess, 'function');

  const [compareGrant, viewOnlyGrant, compareOnlyGrant] = await Promise.all([
    photoVersionPage(db, secretCompare),
    photoVersionPage(db, secretViewOnly),
    photoVersionPage(db, secretCompareOnly),
  ]);
  assert.equal(compareGrant.permissionsMask & canViewBit, canViewBit);
  assert.equal(
    compareGrant.permissionsMask & canCompareVersionsBit,
    canCompareVersionsBit,
  );
  assert.equal(
    compareGrant.permissionsMask & canSelectBit,
    0,
    'Version comparison is available without can_select',
  );
  assert.equal(viewOnlyGrant.permissionsMask & canViewBit, canViewBit);
  assert.equal(viewOnlyGrant.permissionsMask & canCompareVersionsBit, 0);
  assert.equal(compareOnlyGrant.permissionsMask & canViewBit, 0);
  assert.equal(
    compareOnlyGrant.permissionsMask & canCompareVersionsBit,
    canCompareVersionsBit,
  );

  const browser = await chromium.launch({ headless: true });
  try {
    const state = await createGuestBrowser({
      browser,
      worker,
      base,
      albumId,
      secret: secretCompare,
    });
    try {
      const dialog = await openGuestLightbox(
        state.page,
        base,
        albumId,
        filename,
      );
      const compareButton = state.page.getByTestId('guest-compare-open');
      await expect
        .poll(() => state.observations.capabilityReads.length)
        .toBe(1);
      await expect
        .poll(
          () =>
            state.observations.accessReads.filter(
              (read) =>
                read.status === 200 &&
                read.body?.access?.permissions?.can_view === true &&
                read.body?.access?.permissions?.can_compare_versions === true,
            ).length,
        )
        .toBeGreaterThanOrEqual(1);
      await expect(compareButton).toBeVisible();

      const targetPhotos = state.observations.galleryReads
        .filter((read) => read.status === 200)
        .flatMap((read) => read.body?.photos ?? []);
      assert.ok(
        targetPhotos.some((photo) => photo.id === photoId),
        'The fixture photo is present in the actual Guest gallery response',
      );
      assert.ok(
        targetPhotos.some((photo) => photo.id === neighborPhotoId),
        'The adjacent fixture photo is available for Lightbox arrow checks',
      );

      const beforeSnapshot = await guestMutationSnapshot(db, albumId);
      await compareButton.click();
      const comparison = state.page.getByTestId('guest-version-comparison');
      await expect(comparison).toBeVisible();
      await expect.poll(() => state.observations.versionReads.length).toBe(1);
      assert.equal(state.observations.versionReads[0]?.versionPhotoId, photoId);
      assert.equal(
        await dialog.locator('[role="dialog"]').count(),
        0,
        'Comparison stays inside the parent Lightbox dialog',
      );

      const firstRead = state.observations.versionReads[0];
      assert.ok(firstRead);
      assert.equal(firstRead.status, 200);
      const firstPage = firstRead.body;
      assert.ok(firstPage);
      assert.equal(firstPage.photoId, photoId);
      assert.equal(firstPage.albumId, albumId);
      assert.equal(firstPage.head.versionId, currentVersionId);
      assert.equal(firstPage.currentVersion.versionId, currentVersionId);
      assert.equal(firstPage.currentVersion.isCurrent, true);
      assert.ok(
        !firstPage.versions.some(
          (version) => version.versionId === currentVersionId,
        ),
        'The pinned current head sits outside the descending first page',
      );
      assert.equal(firstPage.versions.length, 24);
      assert.ok(firstPage.nextCursor);
      assert.ok(firstPage.nextCursor.length <= 512);
      assert.equal(firstPage.currentVersion.createdByLabel, '攝影師');
      assert.deepEqual(firstPage.currentVersion.labels, []);
      assertProtectedVersionAssetUrls(
        firstPage.currentVersion,
        state.page.url(),
        photoId,
      );
      for (const version of firstPage.versions) {
        assertProtectedVersionAssetUrls(version, state.page.url(), photoId);
      }
      assert.ok(
        firstPage.versions.some(
          (version) => version.versionId === latestVersionId,
        ),
      );
      assert.equal(
        firstPage.versions.some(
          (version) => version.versionId === unpublishedVersionId,
        ),
        false,
        'An unpublished ready V3 draft is absent from the version page',
      );
      assert.equal(
        state.observations.versionReads[0]?.search.includes('cursor='),
        false,
        'The comparison opens with one page and a separately pinned current version',
      );

      const before = state.page.getByTestId('compare-before');
      const after = state.page.getByTestId('compare-after');
      await expect(before).toHaveValue(latestVersionId);
      await expect(after).toHaveValue(currentVersionId);
      await expect(
        state.page.getByTestId('compare-mode-slider'),
      ).toHaveAttribute('aria-pressed', 'true');
      await assertCanvasUsesVersions({
        page: state.page,
        observations: state.observations,
        photoId,
        expectedVersionIds: [latestVersionId, currentVersionId],
      });
      assertPreviewRequestsBelongToPair(state.observations.assets, photoId, [
        latestVersionId,
        currentVersionId,
      ]);
      await assertNoMobileOverflow(state.page);

      const sliderStage = state.page.getByTestId('compare-slider-stage');
      const sliderHandle = state.page.getByTestId('compare-drag-handle');
      const sliderRange = state.page.getByTestId('compare-slider');
      await assertSliderShowsPinnedVersions({
        page: state.page,
        photoId,
        beforeVersionId: latestVersionId,
        afterVersionId: currentVersionId,
      });
      await state.page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(sliderStage).toHaveAttribute('data-hint-active', 'true');
      await expect(sliderHandle).toHaveAttribute('data-hint-active', 'true');
      const normalMotionStart = await readSliderStageState(state.page);
      assert.equal(normalMotionStart.touchAction, 'pan-y');
      assert.equal(
        normalMotionStart.animationName,
        'guest-compare-slider-wiggle',
      );
      await expect
        .poll(
          async () => {
            const current = await readSliderStageState(state.page);
            return (
              Math.abs(
                current.dividerCenterPercent -
                  normalMotionStart.dividerCenterPercent,
              ) > 0.5
            );
          },
          { timeout: 4500 },
        )
        .toBe(true);

      await state.page.emulateMedia({ reducedMotion: 'reduce' });
      await expect
        .poll(
          async () => (await readSliderStageState(state.page)).animationName,
        )
        .toBe('none');
      const reducedMotionStart = await readSliderStageState(state.page);
      await state.page.waitForTimeout(400);
      const reducedMotionEnd = await readSliderStageState(state.page);
      assert.equal(reducedMotionEnd.animationName, 'none');
      assert.ok(
        Math.abs(
          reducedMotionEnd.dividerCenterPercent -
            reducedMotionStart.dividerCenterPercent,
        ) < 0.2,
        'Reduced motion stops the idle divider hint',
      );
      assertSliderGeometryMatchesRange(reducedMotionEnd, 50, 0.5);
      await assertSliderShowsDistinctRenderedSides(sliderStage);

      await state.page.emulateMedia({ reducedMotion: 'no-preference' });
      await sliderStage.evaluate((element) => {
        element.addEventListener(
          'gotpointercapture',
          (event) => {
            element.dataset.pointerCaptureSeen = 'true';
            element.dataset.pointerCaptureId = String(event.pointerId);
          },
          true,
        );
        element.addEventListener(
          'pointermove',
          (event) => {
            if (event.buttons === 0) return;
            element.dataset.pointerMoveCaptured = String(
              element.hasPointerCapture(event.pointerId),
            );
            element.dataset.pointerMoveX = String(event.clientX);
            element.dataset.pointerMoveY = String(event.clientY);
          },
          true,
        );
      });
      await sliderStage.scrollIntoViewIfNeeded();
      const stageBox = await sliderStage.boundingBox();
      const handleBox = await sliderHandle.boundingBox();
      const viewport = await state.page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      assert.ok(stageBox && handleBox);
      const outsideX = Math.min(
        Math.ceil(stageBox.x + stageBox.width + 12),
        viewport.width - 2,
      );
      assert.ok(
        outsideX > stageBox.x + stageBox.width,
        'The 375px viewport has room to drag beyond the comparison stage',
      );
      const handleX = handleBox.x + handleBox.width / 2;
      const handleY = handleBox.y + handleBox.height / 2;
      await state.page.mouse.move(handleX, handleY);
      await state.page.mouse.down();
      await expect(sliderStage).toHaveAttribute('data-hint-active', 'false');
      await expect(sliderHandle).toHaveAttribute('data-hint-active', 'false');
      await expect
        .poll(() => sliderStage.getAttribute('data-pointer-capture-seen'))
        .toBe('true');
      await state.page.mouse.move(outsideX, stageBox.y + stageBox.height / 2, {
        steps: 5,
      });
      await expect
        .poll(() => sliderStage.getAttribute('data-pointer-move-captured'))
        .toBe('true');
      const capturedMove = await sliderStage.evaluate((element) => ({
        x: Number(element.dataset.pointerMoveX),
        y: Number(element.dataset.pointerMoveY),
      }));
      assert.ok(
        capturedMove.x > stageBox.x + stageBox.width,
        'Captured pointer movement continues outside the stage bounds',
      );
      await state.page.mouse.up();
      const pointerRangeValue = Number(await sliderRange.inputValue());
      assert.ok(
        pointerRangeValue >= 95,
        'Dragging beyond the right edge clamps the shared split to the right side',
      );
      const pointerState = await readSliderStageState(state.page);
      assertSliderGeometryMatchesRange(pointerState, pointerRangeValue, 0.5);
      assert.equal(pointerState.hintActive, 'false');
      assert.equal(pointerState.hintClassActive, false);
      assert.equal(pointerState.animationName, 'none');
      await state.page.waitForTimeout(350);
      const stoppedHintState = await readSliderStageState(state.page);
      assert.ok(
        Math.abs(
          stoppedHintState.dividerCenterPercent -
            pointerState.dividerCenterPercent,
        ) < 0.2,
        'The first pointer interaction stops the idle hint',
      );
      assertSliderGeometryMatchesRange(
        stoppedHintState,
        pointerRangeValue,
        0.5,
      );
      const latestVersion = firstPage.versions.find(
        (version) => version.versionId === latestVersionId,
      );
      assert.ok(latestVersion);
      assert.equal(latestVersion.createdByLabel, '攝影師');
      assert.ok(Array.isArray(latestVersion.labels));
      for (const version of [firstPage.currentVersion, latestVersion]) {
        const keys = Object.keys(version);
        assert.equal(
          keys.some((key) => /email|actor|user|subject|changeNote/iu.test(key)),
          false,
        );
      }

      const slider = state.page.getByTestId('compare-slider');
      await slider.press('Home');
      await expect(slider).toHaveValue('0');
      await slider.press('ArrowRight');
      await expect(slider).toHaveValue('1');
      await slider.press('Shift+ArrowRight');
      await expect(slider).toHaveValue('11');
      await assertSliderShowsPinnedVersions({
        page: state.page,
        photoId,
        beforeVersionId: latestVersionId,
        afterVersionId: currentVersionId,
      });
      assertSliderGeometryMatchesRange(
        await readSliderStageState(state.page),
        11,
        0.5,
      );
      await expect(dialog.locator('h2').first()).toHaveText(filename);
      await assertCanvasUsesVersions({
        page: state.page,
        observations: state.observations,
        photoId,
        expectedVersionIds: [latestVersionId, currentVersionId],
      });

      await state.page.getByTestId('compare-mode-side').click();
      const zoom = state.page.getByTestId('compare-zoom');
      await zoom.press('Home');
      for (let step = 0; step < 10; step += 1) {
        await zoom.press('ArrowRight');
      }
      await expect(zoom).toHaveValue('2');
      const panX = state.page.getByTestId('compare-pan-x');
      const panY = state.page.getByTestId('compare-pan-y');
      await expect(panX).toBeEnabled();
      await expect(panY).toBeEnabled();
      await panX.press('Home');
      await panX.press('ArrowRight');
      await panY.press('Home');
      await panY.press('ArrowRight');
      const synchronizedTransforms = await state.page
        .getByTestId('compare-canvas')
        .locator('img')
        .evaluateAll((images) => images.map((image) => image.style.transform));
      assert.equal(synchronizedTransforms.length, 2);
      assert.ok(
        synchronizedTransforms[0] &&
          synchronizedTransforms[0] === synchronizedTransforms[1],
        'Side-by-side zoom and pan stay synchronized across both previews',
      );
      await assertCanvasUsesVersions({
        page: state.page,
        observations: state.observations,
        photoId,
        expectedVersionIds: [latestVersionId, currentVersionId],
      });
      await assertNoMobileOverflow(state.page);

      await state.page.getByTestId('compare-mode-overlay').click();
      const opacity = state.page.getByTestId('compare-opacity');
      await opacity.press('End');
      await expect(opacity).toHaveValue('100');
      const blink = state.page.getByTestId('compare-blink');
      const overlayImages = state.page
        .getByTestId('compare-canvas')
        .locator('img');
      assert.deepEqual(
        await overlayImages.evaluateAll((images) =>
          images.map((image) => image.style.opacity),
        ),
        ['1', '1'],
      );
      await blink.click();
      await expect(blink).toHaveAttribute('aria-pressed', 'true');
      assert.deepEqual(
        await overlayImages.evaluateAll((images) =>
          images.map((image) => image.style.opacity),
        ),
        ['0', '1'],
      );
      await blink.click();
      await expect(blink).toHaveAttribute('aria-pressed', 'true');
      assert.deepEqual(
        await overlayImages.evaluateAll((images) =>
          images.map((image) => image.style.opacity),
        ),
        ['1', '0'],
      );
      await blink.click();
      await expect(blink).toHaveAttribute('aria-pressed', 'false');
      assert.deepEqual(
        await overlayImages.evaluateAll((images) =>
          images.map((image) => image.style.opacity),
        ),
        ['1', '1'],
      );
      await assertCanvasUsesVersions({
        page: state.page,
        observations: state.observations,
        photoId,
        expectedVersionIds: [latestVersionId, currentVersionId],
      });
      await assertNoMobileOverflow(state.page);

      const loadMore = state.page.getByTestId('compare-load-more');
      await expect(loadMore).toBeVisible();
      await loadMore.click();
      await expect.poll(() => state.observations.versionReads.length).toBe(2);
      const secondRead = state.observations.versionReads[1];
      assert.ok(secondRead);
      assert.equal(secondRead.status, 200);
      assert.ok(new URLSearchParams(secondRead.search).get('cursor'));
      assert.equal(secondRead.body?.head?.versionId, currentVersionId);
      assertProtectedVersionAssetUrls(
        secondRead.body.currentVersion,
        state.page.url(),
        photoId,
      );
      for (const version of secondRead.body.versions) {
        assertProtectedVersionAssetUrls(version, state.page.url(), photoId);
      }
      assert.deepEqual(
        secondRead.body?.versions?.map((version) => version.versionNo),
        [4, 2, 1],
      );
      await expect(after).toHaveValue(currentVersionId);

      const beforeValues = await before
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => option.value).filter(Boolean),
        );
      const afterValues = await after
        .locator('option')
        .evaluateAll((options) =>
          options.map((option) => option.value).filter(Boolean),
        );
      assert.equal(
        beforeValues.filter((value) => value === currentVersionId).length,
        0,
        'The Before selector keeps the selected After version distinct',
      );
      assert.equal(
        afterValues.filter((value) => value === currentVersionId).length,
        1,
        'The current V1 is merged only once after its history page loads',
      );
      assert.equal(
        [...afterValues].sort().join(','),
        [...new Set(afterValues)].sort().join(','),
        'Cursor merge deduplicates versions already pinned in the page',
      );
      assert.equal(beforeValues.includes(unpublishedVersionId), false);
      assert.equal(afterValues.includes(unpublishedVersionId), false);

      const secondPageV2 = secondRead.body.versions.find(
        (version) => version.versionNo === 2,
      );
      assert.ok(secondPageV2);
      assert.deepEqual(secondPageV2.labels, ['Retouched', 'Client approved']);
      const selectedPairAssetOffset = state.observations.assets.length;
      await before.selectOption(secondPageV2.versionId);
      await expect(before).toHaveValue(secondPageV2.versionId);
      const versionDetailsText = await comparison.innerText();
      assert.ok(versionDetailsText.includes('攝影師'));
      for (const label of secondPageV2.labels) {
        assert.ok(versionDetailsText.includes(label));
      }
      const displayedDates = await comparison
        .locator('time')
        .evaluateAll((times) =>
          times.map((time) => time.getAttribute('datetime')),
        );
      assert.ok(displayedDates.includes(secondPageV2.createdAt));
      assert.ok(
        versionDetailsText.includes(
          secondPageV2.width.toLocaleString('zh-TW') +
            ' × ' +
            secondPageV2.height.toLocaleString('zh-TW') +
            ' px',
        ),
      );
      assert.notEqual(
        secondPageV2.width * firstPage.currentVersion.height,
        firstPage.currentVersion.width * secondPageV2.height,
        'The fixture compares portrait V2 against landscape current V1',
      );
      await expect(
        comparison.getByText('兩個版本的尺寸或長寬比不同，請留意邊界裁切。', {
          exact: true,
        }),
      ).toBeVisible();
      const selectedImages = state.page
        .getByTestId('compare-canvas')
        .locator('img');
      assert.deepEqual(
        await selectedImages.evaluateAll((images) =>
          images.map((image) => getComputedStyle(image).objectFit),
        ),
        ['contain', 'contain'],
      );
      await state.page.getByTestId('compare-mode-side').click();
      const orientationTransforms = await selectedImages.evaluateAll((images) =>
        images.map((image) => image.style.transform),
      );
      assert.equal(orientationTransforms.length, 2);
      assert.ok(
        orientationTransforms[0] &&
          orientationTransforms[0] === orientationTransforms[1],
        'Portrait and landscape previews keep synchronized transforms side by side',
      );
      await state.page.getByTestId('compare-canvas').scrollIntoViewIfNeeded();
      await mkdir('.local', { recursive: true });
      await state.page.screenshot({
        path: '.local/guest-version-comparison-mobile.png',
      });
      await assertCanvasUsesVersions({
        page: state.page,
        observations: state.observations,
        photoId,
        expectedVersionIds: [secondPageV2.versionId, currentVersionId],
      });
      assertPreviewRequestsBelongToPair(
        state.observations.assets.slice(selectedPairAssetOffset),
        photoId,
        [secondPageV2.versionId, currentVersionId],
      );
      await assertNoMobileOverflow(state.page);

      for (const read of state.observations.versionReads) {
        for (const version of [
          ...(read.body?.currentVersion ? [read.body.currentVersion] : []),
          ...(read.body?.versions ?? []),
        ]) {
          assert.equal(version.createdByLabel, '攝影師');
          assert.equal(
            Object.keys(version).some((key) =>
              /email|actor|user|subject|changeNote/iu.test(key),
            ),
            false,
          );
        }
      }

      const unpublishedAsset = await pageFetch(
        state.page,
        assetPath(photoId, unpublishedVersionId, 'preview'),
      );
      assert.equal(unpublishedAsset.status, 401);
      assert.equal(
        unpublishedAsset.body?.error?.code,
        'GUEST_ACCESS_REQUIRED',
        'The generic protected asset route also denies the unpublished draft',
      );
      assert.equal(
        state.observations.assets.some(
          (asset) =>
            asset.photoId === photoId &&
            asset.versionId === unpublishedVersionId &&
            asset.kind === 'preview' &&
            asset.status === 200,
        ),
        false,
        'The unpublished V3 preview is never served',
      );
      await assertGuestBrowserHasNoPii(state, secretCompare, [
        photoId,
        neighborPhotoId,
        currentVersionId,
        latestVersionId,
        unpublishedVersionId,
      ]);
      await assertOnlyGuestCookie(state.observations, state.cookieName);
      assert.deepEqual(
        state.observations.mutations,
        [],
        'Version history and comparison UI remain read-only',
      );
      assert.deepEqual(state.observations.bridgeErrors, []);
      assert.deepEqual(state.observations.pageErrors, []);

      await checkViewOnlyEntry({
        browser,
        worker,
        base,
        albumId,
        photoId,
        filename,
        secretViewOnly,
      });
      await checkCompareOnlyDenied({
        browser,
        worker,
        base,
        albumId,
        photoId,
        secretCompareOnly,
      });

      await compareButton.focus();
      for (let step = 0; step < 32; step += 1) {
        await state.page.keyboard.press('Tab');
        const focusStayedInLightbox = await state.page.evaluate(() => {
          const dialog = document.querySelector(
            '[role="dialog"][aria-modal="true"]',
          );
          return dialog?.contains(document.activeElement) ?? false;
        });
        assert.equal(
          focusStayedInLightbox,
          true,
          'Tab navigation remains within the parent Lightbox focus trap',
        );
      }

      const afterSnapshot = await guestMutationSnapshot(db, albumId);
      assert.deepEqual(
        afterSnapshot,
        beforeSnapshot,
        'Guest selection, feedback, tags, logout and revocation ledgers are unchanged by comparison reads',
      );

      await state.page.keyboard.press('Escape');
      await expect(comparison).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(compareButton).toBeFocused();

      await revokeCompareAccess();
      await compareButton.click();
      await expect(comparison).toBeVisible();
      await expect.poll(() => state.observations.versionReads.length).toBe(3);
      const revokedRead = state.observations.versionReads[2];
      assert.ok(revokedRead);
      assert.equal(revokedRead.status, 401);
      assert.equal(revokedRead.body?.error?.code, 'GUEST_ACCESS_REQUIRED');
      await expect(comparison.getByRole('alert')).toContainText(
        '目前工作階段無法檢視這張照片的版本',
      );
      await expect(state.page.getByTestId('compare-canvas')).toHaveCount(0);
      await expect(state.page.getByTestId('compare-before')).toHaveCount(0);
      await expect(state.page.getByTestId('compare-mode-side')).toHaveCount(0);
      const revokedAsset = await pageFetch(
        state.page,
        assetPath(photoId, currentVersionId, 'preview'),
      );
      assert.equal(revokedAsset.status, 401);
      assert.equal(revokedAsset.body?.error?.code, 'GUEST_ACCESS_REQUIRED');
      await assertOnlyGuestCookie(state.observations, state.cookieName);

      await state.page.keyboard.press('Escape');
      await expect(comparison).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(compareButton).toBeFocused();
      await state.page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      assert.deepEqual(state.observations.bridgeErrors, []);
      assert.deepEqual(state.observations.pageErrors, []);
    } finally {
      await state.close();
    }
  } finally {
    await browser.close();
  }
}
