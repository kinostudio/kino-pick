import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import {
  assertNoHorizontalOverflow,
  makeBrowserState,
  ownerCookieValue,
  projectAndAlbumNames,
} from './owner-comments-browser.mjs';

function ownerAnnotationsPath(fixture, versionId, inviteId) {
  const url = new URLSearchParams({ inviteId });
  return (
    '/api/v1/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/photos/' +
    encodeURIComponent(fixture.photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/annotations?' +
    url.toString()
  );
}

async function waitForOptions(select, button, targetValue, label) {
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (values.includes(targetValue)) return;
    await expect
      .poll(async () => {
        const current = await select
          .locator('option')
          .evaluateAll((options) => options.map((option) => option.value));
        return current.includes(targetValue) || (await button.count()) === 1;
      })
      .toBe(true);
    const updated = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => option.value));
    if (updated.includes(targetValue)) return;
    const before = updated.length;
    await expect(button).toBeVisible();
    await button.click();
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

function annotationReadsFor(observations, fixture) {
  const prefix =
    '/api/v1/albums/' +
    encodeURIComponent(fixture.albumId) +
    '/photos/' +
    encodeURIComponent(fixture.photoId) +
    '/versions/';
  return observations.requests.filter(
    (record) =>
      record.pathname.startsWith(prefix) &&
      record.pathname.endsWith('/annotations'),
  );
}

function readForScope(observations, fixture, versionId, inviteId) {
  const expected = ownerAnnotationsPath(fixture, versionId, inviteId);
  const expectedPath = expected.slice(0, expected.indexOf('?'));
  return annotationReadsFor(observations, fixture).find((record) => {
    const query = new URLSearchParams(record.search);
    return (
      record.status === 200 &&
      record.method === 'GET' &&
      record.pathname === expectedPath &&
      query.get('inviteId') === inviteId
    );
  });
}

async function waitForOwnerRead(observations, fixture, versionId, inviteId) {
  await expect
    .poll(() =>
      Boolean(readForScope(observations, fixture, versionId, inviteId)),
    )
    .toBe(true);
  return readForScope(observations, fixture, versionId, inviteId);
}

async function ensureOwnerAnnotationVisible(panel, annotationId) {
  const item = panel.getByTestId('owner-annotation-item-' + annotationId);
  const more = panel.getByTestId('owner-annotation-more');
  // The API observation can settle before React commits the loaded first page.
  // Wait for the target row or its real pagination control before deciding the
  // selected scope has no more rows to load.
  await expect
    .poll(async () => (await item.count()) > 0 || (await more.count()) > 0, {
      timeout: 10_000,
    })
    .toBe(true);
  for (let pageIndex = 0; pageIndex < 250; pageIndex += 1) {
    if ((await item.count()) > 0) {
      await expect(item).toBeVisible();
      return item;
    }
    if ((await more.count()) === 0) break;
    const before = await panel
      .locator('[data-testid^="owner-annotation-item-"]')
      .count();
    await expect(more).toBeVisible();
    await more.click();
    await expect
      .poll(() =>
        panel.locator('[data-testid^="owner-annotation-item-"]').count(),
      )
      .toBeGreaterThan(before);
  }
  assert.fail(
    'Owner annotation ' + annotationId + ' was not in its selected scope',
  );
}

function assertOwnerResponsePrivate(record, fixture) {
  const serialized = JSON.stringify(record.responseBody);
  for (const value of [
    fixture.guestSecret,
    fixture.peerGuestSecret,
    fixture.inviteToken,
    'objectKey',
    'thumbnailUrl',
    'previewUrl',
    'originalUrl',
  ])
    assert.equal(serialized.includes(value), false);
}

async function readAnnotationLedgers(db) {
  return db
    .prepare(
      "SELECT (SELECT count(*) FROM guest_annotation_commands) AS commands,(SELECT count(*) FROM guest_annotations) AS annotations,(SELECT count(*) FROM guest_annotation_changes) AS changes,(SELECT count(*) FROM guest_annotation_results) AS results,(SELECT count(*) FROM audit_events WHERE action LIKE 'annotation.%') AS audit",
    )
    .first();
}

export async function runOwnerAnnotationsBrowserChecks({
  db,
  worker,
  base,
  ownerCookie,
  fixture,
  owner,
}) {
  assert.ok(
    ownerCookie,
    'Owner browser acceptance needs the real Owner cookie',
  );
  assert.ok(owner, 'Owner browser acceptance needs the Owner actor id');
  assert.ok(db && worker && base && fixture);
  for (const key of [
    'albumId',
    'projectId',
    'photoId',
    'versionId',
    'currentVersionId',
    'draftVersionId',
    'filename',
    'inviteId',
    'annotationId',
    'peerAnnotationId',
    'otherInviteId',
    'otherInviteAnnotationId',
    'guestSecret',
    'peerGuestSecret',
  ])
    assert.ok(fixture?.[key], 'The Owner annotation fixture provides ' + key);

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
      mutationSuffix: 'annotation-commands',
    });
    const { page, observations } = ownerState;
    const beforeLedgers = await readAnnotationLedgers(db);
    const { panel } = await openOwnerPhoto({
      page,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    const invite = panel.getByTestId('owner-annotation-invite');
    const version = panel.getByTestId('owner-annotation-version');
    await expect(invite).toHaveValue('');
    await expect(version).toHaveValue('');
    assert.equal(
      annotationReadsFor(observations, fixture).length,
      0,
      'No annotation read is sent until both the invitation and version scopes are selected',
    );

    const primaryInvite = panel.locator(
      '#owner-annotation-invite-' + fixture.albumId,
    );
    await waitForOptions(
      primaryInvite,
      panel.getByTestId('owner-annotation-invites-more'),
      fixture.inviteId,
      'The explicit annotation invitation',
    );
    await primaryInvite.selectOption(fixture.inviteId);
    await expect(version).toBeEnabled();
    await waitForOptions(
      version,
      panel.getByTestId('owner-annotation-versions-more'),
      fixture.currentVersionId,
      'The current Owner photo version',
    );
    await expect(version).toHaveValue(fixture.currentVersionId);
    const primaryVersion = panel.locator(
      '#owner-annotation-version-' + fixture.albumId,
    );
    await waitForOptions(
      primaryVersion,
      panel.getByTestId('owner-annotation-versions-more'),
      fixture.draftVersionId,
      'The private-ready Owner draft version',
    );
    await primaryVersion.selectOption(fixture.draftVersionId);
    const draftRead = await waitForOwnerRead(
      observations,
      fixture,
      fixture.draftVersionId,
      fixture.inviteId,
    );
    assert.deepEqual(draftRead.responseBody.items, []);
    assertOwnerResponsePrivate(draftRead, fixture);
    await expect(
      panel.getByTestId('owner-annotation-item-' + fixture.annotationId),
    ).toHaveCount(0);

    await waitForOptions(
      primaryVersion,
      panel.getByTestId('owner-annotation-versions-more'),
      fixture.versionId,
      'The retained Guest annotation version',
    );
    await primaryVersion.selectOption(fixture.versionId);
    const primaryRead = await waitForOwnerRead(
      observations,
      fixture,
      fixture.versionId,
      fixture.inviteId,
    );
    assert.equal(primaryRead.responseBody.inviteId, fixture.inviteId);
    assert.equal(primaryRead.responseBody.versionId, fixture.versionId);
    assertOwnerResponsePrivate(primaryRead, fixture);
    const authorItem = await ensureOwnerAnnotationVisible(
      panel,
      fixture.annotationId,
    );
    const peerItem = await ensureOwnerAnnotationVisible(
      panel,
      fixture.peerAnnotationId,
    );
    await expect(authorItem).toContainText(fixture.authorLabel);
    await expect(peerItem).toBeVisible();
    await expect(peerItem).toContainText(fixture.peerAuthorLabel);
    await expect(
      panel.getByTestId('owner-annotation-shape-' + fixture.annotationId),
    ).toBeVisible();
    await expect(
      panel.getByTestId('owner-annotation-shape-' + fixture.peerAnnotationId),
    ).toBeVisible();
    const preview = panel.getByTestId('owner-annotation-preview');
    await expect(preview).toBeVisible();
    const imageSize = await preview.evaluate((element) => {
      if (!(element instanceof HTMLImageElement)) return null;
      return {
        width: element.naturalWidth,
        height: element.naturalHeight,
      };
    });
    assert.ok(imageSize?.width > 0 && imageSize?.height > 0);
    const authorShape = panel.getByTestId(
      'owner-annotation-shape-' + fixture.annotationId,
    );
    const svgViewBox = await authorShape.evaluate(
      (element) => element.ownerSVGElement?.getAttribute('viewBox') ?? null,
    );
    assert.equal(svgViewBox, '0 0 1000000 1000000');
    const svg = panel.getByTestId('owner-annotation-overlay');
    await expect(svg).toBeVisible();
    const svgBox = await svg.boundingBox();
    assert.ok(svgBox?.width > 0 && svgBox.height > 0);
    assert.ok(
      Math.abs(
        svgBox.width / svgBox.height - imageSize.width / imageSize.height,
      ) < 0.02,
      'The Owner SVG source overlay retains the actual preview aspect ratio',
    );
    for (const forbiddenControl of [
      '編輯標記',
      '刪除標記',
      '標記已處理',
      '重新開啟',
      '新增標記',
    ])
      await expect(
        panel.getByRole('button', { name: forbiddenControl }),
      ).toHaveCount(0);
    for (const item of [authorItem, peerItem])
      await expect(item.getByRole('button')).toHaveCount(0);

    const authorVersion = primaryVersion;
    await authorVersion.selectOption(fixture.currentVersionId);
    await expect(
      panel.getByTestId('owner-annotation-shape-' + fixture.annotationId),
    ).toHaveCount(0);
    await expect(
      panel.getByTestId('owner-annotation-item-' + fixture.annotationId),
    ).toHaveCount(0);
    await authorVersion.selectOption(fixture.versionId);
    await expect(
      panel.getByTestId('owner-annotation-shape-' + fixture.annotationId),
    ).toBeVisible();

    const otherInvite = panel.locator(
      '#owner-annotation-invite-' + fixture.albumId,
    );
    await waitForOptions(
      otherInvite,
      panel.getByTestId('owner-annotation-invites-more'),
      fixture.otherInviteId,
      'The other invitation for the same photo',
    );
    await otherInvite.selectOption(fixture.otherInviteId);
    const otherVersion = panel.locator(
      '#owner-annotation-version-' + fixture.albumId,
    );
    await expect(otherVersion).toBeEnabled();
    await waitForOptions(
      otherVersion,
      panel.getByTestId('owner-annotation-versions-more'),
      fixture.versionId,
      'The other invitation version',
    );
    await otherVersion.selectOption(fixture.versionId);
    const isolatedRead = await waitForOwnerRead(
      observations,
      fixture,
      fixture.versionId,
      fixture.otherInviteId,
    );
    assert.deepEqual(
      isolatedRead.responseBody.items.map((item) => item.annotationId),
      [fixture.otherInviteAnnotationId],
      'An Owner must select one invitation and never merge its annotations with another',
    );
    for (const annotationId of [fixture.annotationId, fixture.peerAnnotationId])
      await expect(
        panel.getByTestId('owner-annotation-item-' + annotationId),
      ).toHaveCount(0);
    await expect(
      panel.getByTestId(
        'owner-annotation-shape-' + fixture.otherInviteAnnotationId,
      ),
    ).toBeVisible();
    assertOwnerResponsePrivate(isolatedRead, fixture);

    await otherInvite.selectOption(fixture.inviteId);
    const restoredVersion = panel.locator(
      '#owner-annotation-version-' + fixture.albumId,
    );
    await expect(restoredVersion).toBeEnabled();
    await restoredVersion.selectOption(fixture.versionId);
    await expect(
      panel.getByTestId('owner-annotation-shape-' + fixture.annotationId),
    ).toBeVisible();
    const readsBeforeLifecycle = annotationReadsFor(
      observations,
      fixture,
    ).length;
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('pageshow'));
    });
    await expect
      .poll(() => annotationReadsFor(observations, fixture).length)
      .toBeGreaterThan(readsBeforeLifecycle);
    await expect(
      panel.getByTestId('owner-annotation-shape-' + fixture.annotationId),
    ).toBeVisible();

    await assertNoHorizontalOverflow(page, 'Owner annotations panel');
    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
    const allAnnotationReads = annotationReadsFor(observations, fixture);
    assert.ok(allAnnotationReads.length > 0);
    assert.equal(
      allAnnotationReads.some((record) => record.method !== 'GET'),
      false,
      'Owner annotation browsing is readonly and performs no writes',
    );
    assert.equal(
      allAnnotationReads.some((record) =>
        record.responseBody?.items?.some((item) => item.canEdit !== false),
      ),
      false,
      'Every Owner annotation row is explicitly readonly',
    );
    assert.deepEqual(await readAnnotationLedgers(db), beforeLedgers);
    await page.setViewportSize({ width: 375, height: 812 });
    const ownerPreview = panel.getByTestId('owner-annotation-preview');
    await ownerPreview.scrollIntoViewIfNeeded();
    await expect(ownerPreview).toBeVisible();
    await expect(
      panel.getByTestId('owner-annotation-shape-' + fixture.annotationId),
    ).toBeVisible();
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/owner-annotations-mobile.png',
      fullPage: false,
    });
  } finally {
    await ownerState?.close();
    await browser.close();
  }
}
