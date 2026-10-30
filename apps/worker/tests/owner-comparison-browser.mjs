import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/u.exec(
    ownerCookie,
  );
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

async function readJson(response, expectedStatus) {
  const body = await response.json().catch(() => null);
  if (expectedStatus !== undefined) {
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
  }
  return body;
}

async function projectAndAlbumNames(db, albumId) {
  const row = await db
    .prepare(
      'SELECT a.name AS album_name,p.name AS project_name,p.id AS project_id FROM albums a JOIN projects p ON p.id=a.project_id WHERE a.id=?',
    )
    .bind(albumId)
    .first();
  assert.ok(row?.album_name);
  assert.ok(row?.project_name);
  assert.ok(row?.project_id);
  return {
    albumName: row.album_name,
    projectName: row.project_name,
    projectId: row.project_id,
  };
}

async function readHeadSnapshot(db, photoId) {
  const head = await db
    .prepare(
      'SELECT version_id,revision,last_command_id FROM photo_version_heads WHERE photo_id=?',
    )
    .bind(photoId)
    .first();
  assert.ok(head, 'The isolated photo must have a current version head');
  const [commands, events] = await Promise.all([
    db
      .prepare(
        'SELECT count(*) AS n FROM photo_version_head_commands WHERE photo_id=?',
      )
      .bind(photoId)
      .first(),
    db
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version_current_changed'",
      )
      .bind(photoId)
      .first(),
  ]);
  return {
    versionId: head.version_id,
    revision: Number(head.revision),
    lastCommandId: head.last_command_id,
    commandCount: Number(commands?.n ?? 0),
    changeEventCount: Number(events?.n ?? 0),
  };
}

async function ownerFetch({ worker, base, ownerCookie, path }) {
  return worker.fetch(
    new Request(new URL(path, base), {
      headers: { Cookie: ownerCookieHeader(ownerCookie) },
      redirect: 'manual',
    }),
  );
}

async function makeOwnerBrowser({
  browser,
  worker,
  base,
  ownerCookie,
  albumId,
  photoId,
}) {
  const secure = new URL(base).protocol === 'https:';
  const cookieHeader = ownerCookieHeader(ownerCookie);
  const cookieValue = cookieHeader.slice('kino-owner.session_token='.length);
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: cookieValue,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure,
    },
  ]);

  const page = await context.newPage();
  const versionPath = '/api/v1/photos/' + photoId + '/versions';
  const galleryPath = '/api/v1/albums/' + albumId + '/photos';
  const assetPattern = new RegExp(
    '^/api/v1/photos/' +
      photoId +
      '/versions/([^/]+)/assets/(thumbnail|preview)$',
    'u',
  );
  const observations = {
    requests: [],
    capabilityReads: [],
    versionReads: [],
    galleryReads: [],
    assets: [],
    headMutations: [],
    pageErrors: [],
    bridgeErrors: [],
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
    headers['cf-connecting-ip'] = '198.51.100.97';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = incoming.postDataBuffer() ?? undefined;
    }

    const record = {
      sequence: ++sequence,
      method,
      pathname: url.pathname,
      search: url.search,
      status: 0,
      responseBody: null,
    };
    const isHeadMutation =
      method !== 'GET' &&
      method !== 'HEAD' &&
      url.pathname === versionPath + '/set-current';
    if (isHeadMutation) observations.headMutations.push(record);

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

    const bytes = Buffer.from(await response.arrayBuffer());
    record.status = response.status;
    record.responseBody = parseJson(bytes);
    observations.requests.push(record);

    if (
      method === 'GET' &&
      url.pathname === '/api/v1/photo-versions/capabilities'
    ) {
      observations.capabilityReads.push(record);
    }
    if (method === 'GET' && url.pathname === versionPath) {
      observations.versionReads.push(record);
    }
    if (method === 'GET' && url.pathname === galleryPath) {
      observations.galleryReads.push(record);
    }
    const assetMatch = assetPattern.exec(url.pathname);
    if (method === 'GET' && assetMatch) {
      observations.assets.push({
        sequence: record.sequence,
        photoId,
        versionId: assetMatch[1],
        kind: assetMatch[2],
        status: response.status,
        contentType: response.headers.get('content-type'),
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      });
    }

    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: bytes,
    });
  });

  return {
    context,
    page,
    observations,
    async close() {
      await context.close();
    },
  };
}

async function openPhoto({
  page,
  base,
  projectId,
  projectName,
  albumName,
  filename,
}) {
  const document = await page.goto(
    base + '/dashboard/projects/' + encodeURIComponent(projectId),
    { waitUntil: 'networkidle' },
  );
  assert.equal(document?.status(), 200);
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
  await expect(dialog.locator('h2').first()).toHaveText(filename);
  return dialog;
}

export async function runOwnerComparisonBrowserChecks({
  worker,
  disabledWorker,
  base,
  owner,
  ownerCookie,
  ownerSessionId,
  albumId,
  photoId,
  version1Id,
  historicalVersionId,
  historicalVersionNo,
  currentRevision,
  db,
}) {
  assert.ok(ownerCookie, 'The focused browser test requires an Owner session');
  assert.ok(ownerSessionId);
  assert.ok(version1Id && historicalVersionId);
  assert.ok(Number.isSafeInteger(historicalVersionNo));

  const { albumName, projectName, projectId } = await projectAndAlbumNames(
    db,
    albumId,
  );
  const expectedHead = await readHeadSnapshot(db, photoId);
  assert.equal(expectedHead.versionId, version1Id);
  assert.equal(expectedHead.revision, currentRevision);

  const firstPageResponse = await ownerFetch({
    worker,
    base,
    ownerCookie,
    path: '/api/v1/photos/' + photoId + '/versions',
  });
  const firstPage = await readJson(firstPageResponse, 200);
  assert.deepEqual(firstPage.current, {
    versionId: version1Id,
    revision: currentRevision,
  });
  assert.equal(firstPage.currentVersion.id, version1Id);
  assert.equal(firstPage.currentVersion.processing, 'succeeded');
  assert.equal(firstPage.versions.length, 24);
  assert.ok(firstPage.nextCursor);
  const historicalVersion = firstPage.versions.find(
    (version) => version.id === historicalVersionId,
  );
  assert.equal(historicalVersion?.processing, 'succeeded');
  assert.ok(historicalVersion?.previewUrl);
  assert.equal(
    firstPage.versions.some((version) => version.id === version1Id),
    false,
    'The pinned current version is outside the first 24 history rows',
  );
  assert.equal(
    firstPage.currentVersion.previewUrl,
    '/api/v1/photos/' + photoId + '/versions/' + version1Id + '/assets/preview',
  );

  const previewAsset = await db
    .prepare(
      "SELECT checksum_sha256,byte_size,mime FROM photo_assets WHERE photo_id=? AND version_id=? AND asset_kind='preview'",
    )
    .bind(photoId, version1Id)
    .first();
  assert.ok(previewAsset?.checksum_sha256);
  assert.ok(Number(previewAsset.byte_size) > 0);
  const previewResponse = await ownerFetch({
    worker,
    base,
    ownerCookie,
    path: firstPage.currentVersion.previewUrl,
  });
  assert.equal(previewResponse.status, 200);
  assert.match(
    previewResponse.headers.get('content-type') ?? '',
    /^image\/jpeg/u,
  );
  const previewBytes = Buffer.from(await previewResponse.arrayBuffer());
  assert.equal(previewBytes.byteLength, Number(previewAsset.byte_size));
  assert.equal(sha256(previewBytes), previewAsset.checksum_sha256);

  const browser = await chromium.launch({ headless: true });
  try {
    const disabled = await makeOwnerBrowser({
      browser,
      worker: disabledWorker,
      base,
      ownerCookie,
      albumId,
      photoId,
    });
    try {
      const { page } = disabled;
      await openPhoto({
        page,
        base,
        projectId,
        projectName,
        albumName,
        filename: 'versioned-fixture.jpg',
      });
      await expect(
        page.getByTestId('owner-version-comparison-entry'),
      ).toHaveCount(0);
      assert.deepEqual(disabled.observations.headMutations, []);
    } finally {
      await disabled.close();
    }

    const enabled = await makeOwnerBrowser({
      browser,
      worker,
      base,
      ownerCookie,
      albumId,
      photoId,
    });
    try {
      const { page, observations } = enabled;
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const dialog = await openPhoto({
        page,
        base,
        projectId,
        projectName,
        albumName,
        filename: 'versioned-fixture.jpg',
      });
      const entry = page.getByTestId('owner-version-comparison-entry');
      await expect(entry).toBeVisible();
      await entry.click();

      const canvas = page.getByTestId('owner-compare-canvas');
      const pair = page.getByTestId('owner-version-comparison-pair');
      const versionSelect = page.getByTestId('owner-version-comparison-select');
      await expect(canvas).toBeVisible();
      await expect(pair).toContainText(`第 ${historicalVersionNo} 版`);
      await expect(pair).toContainText('第 1 版');
      await expect(versionSelect).toHaveValue(historicalVersionId);
      const comparisonLoadMore = page.getByTestId(
        'owner-version-comparison-load-more',
      );
      await expect(comparisonLoadMore).toBeVisible();

      const firstRead = observations.versionReads.find(
        (read) =>
          read.status === 200 &&
          !new URLSearchParams(read.search).has('cursor'),
      );
      assert.ok(
        firstRead,
        'Owner comparison must read the first pinned history page',
      );
      assert.equal(firstRead.responseBody?.currentVersion?.id, version1Id);
      assert.equal(
        firstRead.responseBody?.versions?.some(
          (version) => version.id === version1Id,
        ),
        false,
      );
      assert.equal(firstRead.responseBody?.versions?.length, 24);
      assert.ok(firstRead.responseBody?.nextCursor);
      assert.ok(
        firstRead.responseBody?.versions?.some(
          (version) => version.id === historicalVersionId,
        ),
        'The real processed comparison candidate is in page one while current remains pinned separately',
      );

      const expectedPreviewRows = await db
        .prepare(
          "SELECT version_id,checksum_sha256,byte_size FROM photo_assets WHERE photo_id=? AND asset_kind='preview' AND version_id IN (?,?)",
        )
        .bind(photoId, version1Id, historicalVersionId)
        .all();
      const previewByVersion = new Map(
        expectedPreviewRows.results.map((row) => [row.version_id, row]),
      );
      assert.equal(previewByVersion.size, 2);
      await expect
        .poll(
          () =>
            observations.assets.filter(
              (asset) =>
                asset.kind === 'preview' &&
                asset.status === 200 &&
                [version1Id, historicalVersionId].includes(asset.versionId),
            ).length,
        )
        .toBeGreaterThanOrEqual(2);
      for (const versionId of [version1Id, historicalVersionId]) {
        const responseAsset = observations.assets.find(
          (asset) =>
            asset.kind === 'preview' &&
            asset.status === 200 &&
            asset.versionId === versionId,
        );
        const expectedAsset = previewByVersion.get(versionId);
        assert.ok(
          responseAsset,
          'Owner comparison loads a processed private preview',
        );
        assert.ok(expectedAsset);
        assert.match(responseAsset.contentType ?? '', /^image\/jpeg/u);
        assert.equal(responseAsset.byteLength, Number(expectedAsset.byte_size));
        assert.equal(responseAsset.sha256, expectedAsset.checksum_sha256);
      }

      const slider = page.getByTestId('owner-compare-slider');
      const stage = page.getByTestId('owner-compare-slider-stage');
      await expect(slider).toBeVisible();
      await stage.scrollIntoViewIfNeeded();
      const initialSliderValue = Number(await slider.inputValue());
      const stageBounds = await stage.boundingBox();
      assert.ok(stageBounds && stageBounds.width > 0 && stageBounds.height > 0);
      await page.mouse.move(
        stageBounds.x + stageBounds.width * 0.25,
        stageBounds.y + stageBounds.height * 0.5,
      );
      await page.mouse.down();
      await page.mouse.move(
        stageBounds.x + stageBounds.width * 0.72,
        stageBounds.y + stageBounds.height * 0.5,
        { steps: 6 },
      );
      await page.mouse.up();
      await expect
        .poll(async () => Number(await slider.inputValue()))
        .not.toBe(initialSliderValue);

      const keyboardValue = Number(await slider.inputValue());
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(async () => Number(await slider.inputValue()))
        .toBe(Math.min(100, keyboardValue + 1));

      for (const mode of ['side', 'overlay', 'slider']) {
        const button = page.getByTestId(
          'owner-version-comparison-mode-' + mode,
        );
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(canvas).toBeVisible();
      }
      assert.deepEqual(observations.headMutations, []);
      assert.deepEqual(await readHeadSnapshot(db, photoId), expectedHead);

      await page.keyboard.press('Escape');
      await expect(canvas).toHaveCount(0);
      await expect(pair).toHaveCount(0);
      await expect(entry).toBeFocused();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      const openPreview = page.getByRole('button', {
        name: '開啟照片預覽：versioned-fixture.jpg',
        exact: true,
      });
      await openPreview.click();
      const reopenedEntry = page.getByTestId('owner-version-comparison-entry');
      await expect(reopenedEntry).toBeVisible();
      await reopenedEntry.click();
      await expect(canvas).toBeVisible();

      const ownerSession = await db
        .prepare('SELECT expiresAt FROM owner_sessions WHERE id=? AND userId=?')
        .bind(ownerSessionId, owner)
        .first();
      assert.ok(
        ownerSession,
        'The isolated Owner session exists before expiry',
      );
      await db
        .prepare('UPDATE owner_sessions SET expiresAt=? WHERE id=?')
        .bind(Date.now() - 1000, ownerSessionId)
        .run();

      const loadMore = page.getByTestId('owner-version-comparison-load-more');
      await expect(loadMore).toBeVisible();
      await loadMore.scrollIntoViewIfNeeded();
      await expect(loadMore).toBeEnabled();
      await loadMore.click();
      await expect
        .poll(
          () =>
            observations.requests.filter(
              (request) =>
                (request.pathname === '/api/v1/photo-versions/capabilities' ||
                  request.pathname ===
                    '/api/v1/photos/' + photoId + '/versions') &&
                request.status === 401,
            ).length,
        )
        .toBeGreaterThan(0);
      await expect(canvas).toHaveCount(0);
      await expect(pair).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('alert').first()).toBeVisible();
      await expect(
        page.getByRole('heading', { name: '照片', level: 4 }),
      ).toBeFocused();
      await expect(
        page.getByText('versioned-fixture.jpg', { exact: true }),
      ).toHaveCount(0);
      const privateImageSources = await page
        .locator('img')
        .evaluateAll((images) =>
          images
            .map((image) => image.currentSrc || image.src)
            .filter((src) =>
              /\/api\/v1\/photos\/[^/]+\/versions\/[^/]+\/assets\//u.test(src),
            ),
        );
      assert.deepEqual(privateImageSources, []);

      assert.deepEqual(observations.headMutations, []);
      assert.deepEqual(await readHeadSnapshot(db, photoId), expectedHead);
      assert.deepEqual(observations.bridgeErrors, []);
      assert.deepEqual(observations.pageErrors, []);
    } finally {
      await enabled.close();
    }
  } finally {
    await browser.close();
  }

  return {
    pageSize: firstPage.versions.length,
    currentVersionId: firstPage.currentVersion.id,
    historicalVersionId: historicalVersionId,
    processedPreviewCount: 2,
    headUnchanged: true,
    expiredSessionClearedComparison: true,
  };
}
