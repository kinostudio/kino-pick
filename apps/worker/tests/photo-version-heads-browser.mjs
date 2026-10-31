import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

function readOnlyJson(response) {
  return response.json().catch(() => null);
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
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: ownerCookieHeader(ownerCookie).slice(
        'kino-owner.session_token='.length,
      ),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure,
    },
  ]);

  const page = await context.newPage();
  const observations = {
    apiRequests: [],
    capabilityReads: [],
    versionReads: [],
    galleryReads: [],
    mutationAttempts: [],
    pageErrors: [],
    bridgeErrors: [],
  };
  let sequence = 0;
  let dropNextSuccessfulMutationResponse = false;
  let dropNextMutationBeforeWorker = false;
  let return401ForNextMutation = false;
  let versionReadBarrier = null;
  const versionPath = `/api/v1/photos/${photoId}/versions`;
  const mutationPath = `${versionPath}/set-current`;
  const galleryPath = `/api/v1/albums/${albumId}/photos`;

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
      requestBody: incoming.postData() ?? '',
      responseBody: null,
      dropped: false,
      droppedBeforeWorker: false,
    };
    const isMutation = method === 'POST' && url.pathname === mutationPath;
    if (isMutation) observations.mutationAttempts.push(record);

    if (isMutation && return401ForNextMutation) {
      return401ForNextMutation = false;
      record.status = 401;
      record.responseBody = { error: { code: 'OWNER_REQUIRED' } };
      observations.apiRequests.push(record);
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'private, no-store' },
        body: JSON.stringify(record.responseBody),
      });
      return;
    }

    if (isMutation && dropNextMutationBeforeWorker) {
      dropNextMutationBeforeWorker = false;
      record.droppedBeforeWorker = true;
      observations.apiRequests.push(record);
      await route.abort('failed');
      return;
    }

    const headers = await incoming.allHeaders();
    headers['cf-connecting-ip'] = '198.51.100.95';
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
    record.status = response.status;
    record.responseBody = parseJson(responseBytes);
    observations.apiRequests.push(record);

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
    if (
      method === 'GET' &&
      url.pathname === versionPath &&
      versionReadBarrier
    ) {
      const barrier = versionReadBarrier;
      versionReadBarrier = null;
      await barrier.promise;
    }

    if (isMutation && dropNextSuccessfulMutationResponse && response.ok) {
      dropNextSuccessfulMutationResponse = false;
      record.dropped = true;
      await route.abort('failed');
      return;
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
    dropNextSuccessfulMutationResponse() {
      dropNextSuccessfulMutationResponse = true;
    },
    dropNextMutationRequestBeforeWorker() {
      dropNextMutationBeforeWorker = true;
    },
    return401ForNextMutation() {
      return401ForNextMutation = true;
    },
    holdNextVersionRead() {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      const barrier = { promise, release };
      versionReadBarrier = barrier;
      return { release: () => barrier.release() };
    },
    async close() {
      await context.close();
    },
  };
}

async function projectAndAlbumNames(db, albumId) {
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

async function openPhoto({
  page,
  base,
  projectId,
  projectName,
  albumName,
  filename,
}) {
  const document = await page.goto(
    `${base}/dashboard/projects/${encodeURIComponent(projectId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(document?.status(), 200);
  await expect(
    page.getByRole('heading', { name: projectName, exact: true }),
  ).toBeVisible();
  const openGallery = page.getByRole('button', {
    name: '查看照片 ' + albumName,
    exact: true,
  });
  await expect(openGallery).toBeVisible();
  await openGallery.click();
  const openPreview = page.getByRole('button', {
    name: '開啟照片預覽：' + filename,
    exact: true,
  });
  await expect(openPreview).toBeVisible();
  await openPreview.click();
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
  return dialog;
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    `${label} overflows the 375px viewport (${dimensions.scrollWidth} > ${dimensions.clientWidth})`,
  );
}

async function currentHead(db, photoId) {
  return db
    .prepare(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
    )
    .bind(photoId)
    .first();
}

async function switchCurrentFromNode({
  worker,
  base,
  ownerCookie,
  photoId,
  expectedRevision,
  expectedCurrentVersionId,
  versionId,
}) {
  const intent = {
    requestId: randomUUID(),
    expectedRevision,
    expectedCurrentVersionId,
    versionId,
    confirm: true,
  };
  const response = await worker.fetch(
    new Request(
      new URL(`/api/v1/photos/${photoId}/versions/set-current`, base),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: ownerCookieHeader(ownerCookie),
          Origin: new URL(base).origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(intent),
        redirect: 'manual',
      },
    ),
  );
  const body = await readOnlyJson(response);
  return { response, body, intent };
}

export async function runPhotoVersionHeadsBrowserChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  albumId,
  photoId,
  neighborPhotoId,
  neighborVersionId,
  version1Id,
  version2Id,
  currentRevision,
  db,
}) {
  assert.ok(ownerCookie, 'The photo-version browser check requires Owner');
  assert.ok(
    neighborPhotoId && neighborVersionId,
    'A ready neighbor photo is required',
  );
  const { albumName, projectName, projectId } = await projectAndAlbumNames(
    db,
    albumId,
  );
  const beforeBrowser = await currentHead(db, photoId);
  assert.equal(beforeBrowser.version_id, version2Id);
  assert.equal(beforeBrowser.revision, currentRevision);

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
      const { page, observations } = disabled;
      await openPhoto({
        page,
        base,
        projectId,
        projectName,
        albumName,
        filename: 'versioned-fixture.jpg',
      });
      const panel = page.locator('section[aria-label="照片版本管理"]');
      await expect(panel).toBeVisible();
      await expect(panel.getByText('版本管理目前尚未開放。')).toBeVisible();
      await expect(
        panel.getByRole('button', { name: '設為目前版本' }),
      ).toHaveCount(0);
      await expect
        .poll(() => observations.capabilityReads.length)
        .toBeGreaterThan(0);
      assert.deepEqual(observations.capabilityReads[0]?.responseBody, {
        enabled: false,
      });
      assert.equal(observations.versionReads.length, 0);
      await assertNoHorizontalOverflow(page, 'Disabled version panel');
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
      await openPhoto({
        page,
        base,
        projectId,
        projectName,
        albumName,
        filename: 'versioned-fixture.jpg',
      });
      const dialog = page.getByRole('dialog');
      const panel = page.locator('section[aria-label="照片版本管理"]');
      await expect(
        panel.getByRole('heading', { name: '版本紀錄' }),
      ).toBeVisible();
      await expect
        .poll(() => observations.versionReads.length)
        .toBeGreaterThan(0);

      const firstCapability = observations.capabilityReads[0];
      const firstVersionRead = observations.versionReads[0];
      assert.ok(firstCapability);
      assert.ok(firstVersionRead);
      assert.equal(firstCapability.responseBody?.enabled, true);
      assert.ok(
        firstCapability.sequence < firstVersionRead.sequence,
        'The feature capability is checked before Owner version data',
      );
      assert.equal(firstVersionRead.status, 200);
      assert.equal(
        firstVersionRead.responseBody?.current?.versionId,
        version2Id,
      );
      assert.equal(
        firstVersionRead.responseBody?.current?.revision,
        currentRevision,
      );
      assert.equal(firstVersionRead.responseBody?.versions?.length, 24);
      assert.ok(firstVersionRead.responseBody?.nextCursor);

      const galleryBefore = observations.galleryReads.length;
      const galleryBody = observations.galleryReads[0]?.responseBody;
      assert.ok(
        galleryBody?.photos?.some((photo) => photo.id === neighborPhotoId),
      );
      const neighbor = galleryBody?.photos?.find(
        (photo) => photo.id === neighborPhotoId,
      );
      assert.equal(neighbor?.versionId, neighborVersionId);
      assert.ok(
        galleryBefore > 0,
        'The isolated album gallery should be loaded before opening the lightbox',
      );

      await mkdir('.local', { recursive: true });
      await page.screenshot({
        path: '.local/photo-version-heads-mobile.png',
        fullPage: true,
      });
      await assertNoHorizontalOverflow(page, 'Enabled version history');

      await panel.getByRole('button', { name: '載入更多版本' }).click();
      await expect
        .poll(() => observations.versionReads.length)
        .toBeGreaterThan(1);
      await expect(
        panel.getByRole('heading', { name: '第 1 版', exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole('heading', { name: '第 2 版', exact: true }),
      ).toBeVisible();
      const secondVersionRead = observations.versionReads.find(
        (entry) =>
          entry.status === 200 &&
          new URLSearchParams(entry.search).has('cursor'),
      );
      assert.ok(secondVersionRead);
      assert.ok(
        observations.capabilityReads.some(
          (entry) =>
            entry.sequence > firstVersionRead.sequence &&
            entry.sequence < secondVersionRead.sequence,
        ),
        'Load more checks capability before fetching the next page',
      );
      assert.equal(
        secondVersionRead.responseBody?.current?.versionId,
        version2Id,
      );
      assert.equal(
        secondVersionRead.responseBody?.current?.revision,
        currentRevision,
      );
      assert.equal(
        secondVersionRead.responseBody?.versions?.length,
        3,
        'The second cursor page contains the remaining three versions',
      );
      for (const versionId of [version1Id, version2Id]) {
        const item = secondVersionRead.responseBody?.versions?.find(
          (version) => version.id === versionId,
        );
        assert.equal(item?.processing, 'succeeded');
        assert.ok(item?.thumbnailUrl);
        assert.ok(item?.previewUrl);
      }

      const version1Heading = panel.getByRole('heading', {
        name: '第 1 版',
        exact: true,
      });
      const version1Card = version1Heading.locator('xpath=../../../..');
      await expect(version1Card.locator('img')).toBeVisible();
      const version2Heading = panel.getByRole('heading', {
        name: '第 2 版',
        exact: true,
      });
      const version2Card = version2Heading.locator('xpath=../../../..');
      await expect(
        version2Card.getByText('目前使用', { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole('button', { name: /上傳|比較/ }),
      ).toHaveCount(0);

      const previousButton = dialog.getByRole('button', { name: '上一張' });
      const nextButton = dialog.getByRole('button', { name: '下一張' });
      const closeButton = dialog.getByRole('button', { name: '關閉' });
      assert.equal(await closeButton.isEnabled(), true);
      const navigationBefore = [
        await previousButton.isEnabled(),
        await nextButton.isEnabled(),
      ];
      assert.ok(
        navigationBefore.some(Boolean),
        'The ready neighbor makes at least one navigation direction available before the switch',
      );

      const setVersion1 = version1Card.getByRole('button', {
        name: '設為目前版本',
      });
      await expect(setVersion1).toBeEnabled();

      // Escape and the explicit return button both cancel before any mutation.
      await setVersion1.click();
      await expect(
        version1Card.getByRole('button', { name: '確認切換' }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(
        version1Card.getByRole('button', { name: '確認切換' }),
      ).toHaveCount(0);
      await expect(dialog).toBeVisible();
      assert.equal(observations.mutationAttempts.length, 0);

      await version1Card.getByRole('button', { name: '設為目前版本' }).click();
      await version1Card.getByRole('button', { name: '返回' }).click();
      await expect(
        version1Card.getByRole('button', { name: '確認切換' }),
      ).toHaveCount(0);
      assert.equal(observations.mutationAttempts.length, 0);

      await version1Card.getByRole('button', { name: '設為目前版本' }).click();
      const confirmSwitch = version1Card.getByRole('button', {
        name: '確認切換',
      });
      await expect(confirmSwitch).toBeVisible();
      const titleBeforePending = await dialog
        .locator('h3.kino-photo-detail-filename')
        .textContent();
      assert.equal(titleBeforePending, 'versioned-fixture.jpg');
      enabled.dropNextSuccessfulMutationResponse();
      await confirmSwitch.click();
      await expect(
        panel.getByRole('button', { name: '重試同一操作' }),
      ).toBeVisible();

      assert.equal(observations.mutationAttempts.length, 1);
      const firstAttempt = observations.mutationAttempts[0];
      assert.ok(firstAttempt);
      assert.equal(firstAttempt.status, 200);
      assert.equal(firstAttempt.dropped, true);
      const exactBody = firstAttempt.requestBody;
      const firstIntent = JSON.parse(exactBody);
      assert.match(
        firstIntent.requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      assert.equal(firstIntent.expectedRevision, currentRevision);
      assert.equal(firstIntent.expectedCurrentVersionId, version2Id);
      assert.equal(firstIntent.versionId, version1Id);
      assert.equal(firstIntent.confirm, true);

      await expect(closeButton).toBeDisabled();
      await expect(previousButton).toBeDisabled();
      await expect(nextButton).toBeDisabled();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await expect(dialog.locator('h3.kino-photo-detail-filename')).toHaveText(
        titleBeforePending,
      );

      // A retry that returns 401 must retain the same complete request body.
      enabled.return401ForNextMutation();
      await panel.getByRole('button', { name: '重試同一操作' }).click();
      await expect(panel.getByText(/重新登入後請重試同一操作/)).toBeVisible();
      assert.equal(observations.mutationAttempts.length, 2);
      const unauthorizedRetry = observations.mutationAttempts[1];
      assert.ok(unauthorizedRetry);
      assert.equal(unauthorizedRetry.status, 401);
      assert.equal(unauthorizedRetry.requestBody, exactBody);
      await expect(closeButton).toBeDisabled();
      await expect(previousButton).toBeDisabled();
      await expect(nextButton).toBeDisabled();

      // Change the current head after the first commit, so the browser retry
      // receives an old idempotent result and must trust the fresh GET instead.
      const committedHead = await currentHead(db, photoId);
      assert.equal(committedHead.version_id, version1Id);
      assert.equal(committedHead.revision, currentRevision + 1);
      const intervening = await switchCurrentFromNode({
        worker,
        base,
        ownerCookie,
        photoId,
        expectedRevision: committedHead.revision,
        expectedCurrentVersionId: committedHead.version_id,
        versionId: version2Id,
      });
      assert.equal(intervening.response.status, 200);
      assert.equal(intervening.body?.changed, true);
      assert.equal(intervening.body?.current?.versionId, version2Id);
      assert.equal(intervening.body?.current?.revision, currentRevision + 2);

      await panel.getByRole('button', { name: '重試同一操作' }).click();
      await expect.poll(() => observations.mutationAttempts.length).toBe(3);
      await expect
        .poll(() => observations.mutationAttempts[2]?.status)
        .toBe(200);
      const replay = observations.mutationAttempts[2];
      assert.ok(replay);
      assert.equal(replay.status, 200);
      assert.equal(replay.requestBody, exactBody);
      assert.equal(replay.responseBody?.current?.versionId, version1Id);
      assert.equal(replay.responseBody?.current?.revision, currentRevision + 1);

      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect
        .poll(() => observations.galleryReads.length)
        .toBeGreaterThan(galleryBefore);
      const freshReads = observations.versionReads.filter(
        (entry) => entry.sequence > replay.sequence && entry.search === '',
      );
      assert.ok(
        freshReads.length > 0,
        'A fresh first-page read follows the replay',
      );
      const freshRead = freshReads[freshReads.length - 1];
      assert.equal(freshRead?.status, 200);
      assert.equal(freshRead?.responseBody?.current?.versionId, version2Id);
      assert.equal(
        freshRead?.responseBody?.current?.revision,
        currentRevision + 2,
      );
      const freshCapability = observations.capabilityReads.find(
        (entry) =>
          entry.sequence > replay.sequence &&
          entry.sequence < (freshRead?.sequence ?? 0),
      );
      assert.ok(
        freshCapability,
        'Reconciliation checks capability before current state',
      );
      const refreshedGallery = observations.galleryReads.at(-1)?.responseBody;
      const refreshedPhoto = refreshedGallery?.photos?.find(
        (photo) => photo.id === photoId,
      );
      assert.equal(refreshedPhoto?.versionId, version2Id);
      assert.deepEqual(observations.bridgeErrors, []);
      assert.deepEqual(observations.pageErrors, []);
      await assertNoHorizontalOverflow(page, 'Reconciled Owner gallery');

      // This request never reaches the Worker. A different Owner changes the
      // head before the exact retry, which must be treated as a definite CAS
      // rejection instead of an unresolved mutation.
      await page
        .getByRole('button', {
          name: '開啟照片預覽：versioned-fixture.jpg',
          exact: true,
        })
        .click();
      const conflictDialog = page.getByRole('dialog');
      const conflictPanel = page.locator('section[aria-label="照片版本管理"]');
      await expect(
        conflictPanel.getByRole('heading', { name: '版本紀錄' }),
      ).toBeVisible();
      const versionReadsBeforeConflict = observations.versionReads.length;
      await conflictPanel.getByRole('button', { name: '載入更多版本' }).click();
      await expect
        .poll(() => observations.versionReads.length)
        .toBeGreaterThan(versionReadsBeforeConflict);
      const conflictV1Card = conflictPanel
        .getByRole('heading', { name: '第 1 版', exact: true })
        .locator('xpath=../../../..');
      await expect(
        conflictV1Card.getByRole('button', { name: '設為目前版本' }),
      ).toBeEnabled();
      await conflictV1Card
        .getByRole('button', { name: '設為目前版本' })
        .click();
      const conflictConfirm = conflictV1Card.getByRole('button', {
        name: '確認切換',
      });
      await expect(conflictConfirm).toBeVisible();

      const pendingHead = await currentHead(db, photoId);
      assert.equal(pendingHead.version_id, version2Id);
      assert.equal(pendingHead.revision, currentRevision + 2);
      const conflictAttemptStart = observations.mutationAttempts.length;
      enabled.dropNextMutationRequestBeforeWorker();
      await conflictConfirm.click();
      await expect(
        conflictPanel.getByRole('button', { name: '重試同一操作' }),
      ).toBeVisible();
      const droppedBeforeCommit =
        observations.mutationAttempts[conflictAttemptStart];
      assert.ok(droppedBeforeCommit);
      assert.equal(droppedBeforeCommit.status, 0);
      assert.equal(droppedBeforeCommit.droppedBeforeWorker, true);
      const conflictExactBody = droppedBeforeCommit.requestBody;
      const conflictIntent = JSON.parse(conflictExactBody);
      assert.equal(conflictIntent.expectedRevision, currentRevision + 2);
      assert.equal(conflictIntent.expectedCurrentVersionId, version2Id);
      assert.equal(conflictIntent.versionId, version1Id);
      assert.equal(conflictIntent.confirm, true);

      const conflictPrevious = conflictDialog.getByRole('button', {
        name: '上一張',
      });
      const conflictNext = conflictDialog.getByRole('button', {
        name: '下一張',
      });
      const conflictClose = conflictDialog.getByRole('button', {
        name: '關閉',
      });
      await expect(conflictClose).toBeDisabled();
      await expect(conflictPrevious).toBeDisabled();
      await expect(conflictNext).toBeDisabled();

      const changedByOtherOwner = await switchCurrentFromNode({
        worker,
        base,
        ownerCookie,
        photoId,
        expectedRevision: pendingHead.revision,
        expectedCurrentVersionId: pendingHead.version_id,
        versionId: version1Id,
      });
      assert.equal(changedByOtherOwner.response.status, 200);
      assert.equal(changedByOtherOwner.body?.changed, true);
      assert.equal(changedByOtherOwner.body?.current?.versionId, version1Id);
      assert.equal(
        changedByOtherOwner.body?.current?.revision,
        currentRevision + 3,
      );

      const galleryBeforeConflictReconcile = observations.galleryReads.length;
      const heldRead = enabled.holdNextVersionRead();
      let casConflictAttempt;
      try {
        await conflictPanel
          .getByRole('button', { name: '重試同一操作' })
          .click();
        await expect
          .poll(() => observations.mutationAttempts.length)
          .toBe(conflictAttemptStart + 2);
        casConflictAttempt =
          observations.mutationAttempts[conflictAttemptStart + 1];
        assert.ok(casConflictAttempt);
        await expect.poll(() => casConflictAttempt.status).toBe(409);
        assert.equal(casConflictAttempt.status, 409);
        assert.equal(
          casConflictAttempt.responseBody?.error?.code,
          'PHOTO_VERSION_REVISION_CONFLICT',
        );
        assert.equal(casConflictAttempt.requestBody, conflictExactBody);
        await expect
          .poll(() =>
            observations.versionReads.some(
              (entry) =>
                entry.sequence > casConflictAttempt.sequence &&
                entry.search === '',
            ),
          )
          .toBe(true);
        const freshReadHeld = observations.versionReads.find(
          (entry) =>
            entry.sequence > casConflictAttempt.sequence && entry.search === '',
        );
        assert.equal(
          freshReadHeld?.responseBody?.current?.versionId,
          version1Id,
        );
        assert.equal(
          freshReadHeld?.responseBody?.current?.revision,
          currentRevision + 3,
        );
        await expect(
          conflictPanel.getByText(
            '操作未套用：目前版本已變更。正在重新讀取目前狀態。',
          ),
        ).toBeVisible();
        await expect(
          conflictPanel.getByRole('button', { name: '重試同一操作' }),
        ).toHaveCount(0);
        await expect(conflictClose).toBeDisabled();
        await expect(conflictPrevious).toBeDisabled();
        await expect(conflictNext).toBeDisabled();
      } finally {
        heldRead.release();
      }

      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect
        .poll(() => observations.galleryReads.length)
        .toBeGreaterThan(galleryBeforeConflictReconcile);
      const conflictFreshRead = observations.versionReads.find(
        (entry) =>
          entry.sequence > (casConflictAttempt?.sequence ?? 0) &&
          entry.search === '',
      );
      assert.equal(
        conflictFreshRead?.responseBody?.current?.versionId,
        version1Id,
      );
      assert.equal(
        conflictFreshRead?.responseBody?.current?.revision,
        currentRevision + 3,
      );
      const conflictFreshGallery =
        observations.galleryReads.at(-1)?.responseBody;
      const conflictFreshPhoto = conflictFreshGallery?.photos?.find(
        (photo) => photo.id === photoId,
      );
      assert.equal(conflictFreshPhoto?.versionId, version1Id);

      await page
        .getByRole('button', {
          name: '開啟照片預覽：versioned-fixture.jpg',
          exact: true,
        })
        .click();
      const unlockedDialog = page.getByRole('dialog');
      await expect(unlockedDialog).toBeVisible();
      await expect(
        unlockedDialog.getByRole('button', { name: '關閉' }),
      ).toBeEnabled();
      await unlockedDialog.getByRole('button', { name: '關閉' }).click();
      await expect(unlockedDialog).toHaveCount(0);
      assert.deepEqual(observations.bridgeErrors, []);
      assert.deepEqual(observations.pageErrors, []);
      await assertNoHorizontalOverflow(page, 'CAS conflict reconciliation');
    } finally {
      await enabled.close();
    }
  } finally {
    await browser.close();
  }
}
