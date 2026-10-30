import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AwsV4Signer } from 'aws4fetch';
import { chromium, expect } from '@playwright/test';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { pngFixture } from './image-fixtures.mjs';

const journalPrefix = 'kino-pic:resolved-upload-journal:v1:';
const accessKeyId = 'synthetic-test-access-key';
const secretAccessKey = 'synthetic-test-secret-key-never-for-production';
const mobileScreenshotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.local',
  'assisted-candidate-catalog-mobile.png',
);

function cookieHeader(value) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/u.exec(value);
  const token = match?.[1] ?? value;
  assert.ok(token, 'A current Owner cookie is required');
  return 'kino-owner.session_token=' + token;
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function addOwnerCookie(context, base, ownerCookie) {
  const token = cookieHeader(ownerCookie).slice(
    'kino-owner.session_token='.length,
  );
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: token,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(base).protocol === 'https:',
    },
  ]);
}

async function assertMobileWidth(page, label) {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(
    width.scroll <= width.client,
    label + ' overflows 375px (' + width.scroll + ' > ' + width.client + ')',
  );
}

async function openAlbumUpload(page, base, fixture, heading) {
  const document = await page.goto(
    base + '/dashboard/projects/' + encodeURIComponent(fixture.project.id),
    { waitUntil: 'networkidle' },
  );
  assert.equal(document?.status(), 200);
  await expect(
    page.getByRole('heading', { name: fixture.project.name, exact: true }),
  ).toBeVisible();
  const card = page.getByTestId('album-card-' + fixture.album.id);
  await expect(card).toBeVisible();
  await card
    .getByRole('button', {
      name: '上傳照片 ' + fixture.album.name,
      exact: true,
    })
    .click();
  const panel = page.getByTestId('resolved-upload');
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: heading, exact: true }),
  ).toBeVisible();
  return panel;
}

async function readJournal(page) {
  return page.evaluate(
    (prefix) =>
      Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)),
    journalPrefix,
  );
}

function assertJournalHasNoCapabilities(entries) {
  const forbidden =
    /https?:|blob:|previewUrl|cookie|authorization|objectKey|signedUrl|x-amz-signature/i;
  for (const [, value] of entries)
    assert.equal(
      forbidden.test(value),
      false,
      'The journal must not store signed capabilities',
    );
}

export async function runAssistedCandidateCatalogBrowserChecks({
  worker,
  legacyWorker,
  defaultWorker,
  base,
  ownerCookie,
  owner,
  db,
  storage,
  fixture,
}) {
  assert.ok(worker && legacyWorker && defaultWorker && base && owner && db);
  assert.ok(storage && fixture?.project?.id && fixture?.album?.id);
  assert.ok(fixture.finalPhotoId && fixture.currentVersionId);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  const observations = {
    apiRequests: [],
    catalogRequests: [],
    previewRequests: [],
    reservationRequests: [],
    authorizeRequests: [],
    completionRequests: [],
    pageErrors: [],
    bridgeErrors: [],
    signedBrowserR2Puts: 0,
  };
  let dropNextReservationResponse = false;
  let spoofNextMe = false;
  let heldCatalog = null;
  let page;

  function armCatalogHold() {
    let seenResolve;
    let releaseResolve;
    const seen = new Promise((resolve) => {
      seenResolve = resolve;
    });
    const gate = new Promise((resolve) => {
      releaseResolve = resolve;
    });
    heldCatalog = { seenResolve, gate };
    return { seen, release: () => releaseResolve() };
  }

  await addOwnerCookie(context, base, ownerCookie);
  page = await context.newPage();
  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (
      url.origin !== new URL(base).origin &&
      !url.hostname.endsWith('.r2.cloudflarestorage.com')
    ) {
      await route.continue();
      return;
    }

    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      if (incoming.method() === 'OPTIONS') {
        const requestedHeaders =
          (await incoming.allHeaders())['access-control-request-headers'] ??
          'content-type,if-none-match,x-amz-checksum-sha256';
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': new URL(base).origin,
            'Access-Control-Allow-Methods': 'PUT',
            'Access-Control-Allow-Headers': requestedHeaders,
            'Access-Control-Max-Age': '600',
          },
          body: '',
        });
        return;
      }

      assert.equal(url.protocol, 'https:');
      assert.equal(incoming.method(), 'PUT');
      const headers = await incoming.allHeaders();
      assert.equal(headers.cookie, undefined);
      assert.equal(headers.authorization, undefined);
      assert.equal(headers['x-kino-expected-actor'], undefined);
      const bytes = incoming.postDataBuffer();
      assert.ok(bytes);
      const checksum = createHash('sha256').update(bytes).digest('base64');
      assert.equal(headers['x-amz-checksum-sha256'], checksum);
      assert.equal(headers['if-none-match'], '*');

      const signature = url.searchParams.get('X-Amz-Signature');
      assert.ok(signature);
      url.searchParams.delete('X-Amz-Signature');
      const signed = await new AwsV4Signer({
        url: url.toString(),
        method: 'PUT',
        service: 's3',
        region: 'auto',
        accessKeyId,
        secretAccessKey,
        datetime: url.searchParams.get('X-Amz-Date'),
        signQuery: true,
        allHeaders: true,
        headers: {
          'Content-Type': headers['content-type'],
          'Content-Length': String(bytes.byteLength),
          'If-None-Match': '*',
          'x-amz-checksum-sha256': checksum,
        },
      }).sign();
      assert.equal(
        signed.url.searchParams.get('X-Amz-Signature'),
        signature,
        'The R2 capability must bind the bytes and headers actually sent',
      );

      const objectKey = decodeURIComponent(url.pathname)
        .split('/')
        .slice(2)
        .join('/');
      const session = await db
        .prepare(
          'SELECT u.original_filename,u.expected_bytes,p.content_type,p.sha256_hex FROM upload_sessions u JOIN upload_specs p ON p.upload_session_id=u.id WHERE u.object_key=?',
        )
        .bind(objectKey)
        .first();
      assert.ok(session);
      assert.equal(session.expected_bytes, bytes.byteLength);
      assert.equal(session.content_type, headers['content-type']);
      assert.equal(session.sha256_hex, sha256(bytes));
      const stored = await storage.put(objectKey, new Uint8Array(bytes), {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: headers['content-type'] },
        sha256: Buffer.from(checksum, 'base64'),
      });
      assert.ok(stored);
      observations.signedBrowserR2Puts++;
      await route.fulfill({
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': new URL(base).origin,
          'Access-Control-Expose-Headers': 'ETag',
        },
        body: '',
      });
      return;
    }

    const method = incoming.method();
    const pathname = url.pathname;
    const requestBody = incoming.postData() ?? '';
    const record = {
      method,
      pathname,
      search: url.search,
      requestBody,
      status: 0,
      responseBody: null,
      dropped: false,
    };
    if (pathname === '/api/v1/me' && spoofNextMe) {
      spoofNextMe = false;
      const fake = Buffer.from(
        JSON.stringify({ actor: { id: randomUUID() } }),
        'utf8',
      );
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: fake,
      });
      return;
    }

    const isApi = pathname.startsWith('/api/');
    let kind = null;
    if (
      method === 'POST' &&
      pathname.startsWith('/api/v1/albums/') &&
      pathname.endsWith('/upload-resolution')
    )
      kind = 'preview';
    else if (
      method === 'GET' &&
      pathname.startsWith('/api/v1/albums/') &&
      pathname.endsWith('/upload-candidates')
    )
      kind = 'catalog';
    else if (
      method === 'POST' &&
      pathname.startsWith('/api/v1/albums/') &&
      pathname.endsWith('/resolved-uploads')
    )
      kind = 'reservation';
    else if (
      method === 'POST' &&
      pathname.startsWith('/api/v1/uploads/') &&
      pathname.endsWith('/authorize')
    )
      kind = 'authorize';
    else if (
      method === 'POST' &&
      pathname.startsWith('/api/v1/uploads/') &&
      pathname.endsWith('/complete')
    )
      kind = 'new-photo-complete';
    else if (
      method === 'POST' &&
      pathname.startsWith('/api/v1/photos/') &&
      pathname.includes('/versions/') &&
      pathname.endsWith('/complete')
    )
      kind = 'version-complete';

    const headers = await incoming.allHeaders();
    if (
      [
        'preview',
        'catalog',
        'reservation',
        'authorize',
        'new-photo-complete',
        'version-complete',
      ].includes(kind)
    )
      assert.equal(headers['x-kino-expected-actor'], owner);
    headers['cf-connecting-ip'] = '198.51.100.99';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD')
      init.body = incoming.postDataBuffer() ?? undefined;

    let response;
    try {
      response = await worker.fetch(new Request(incoming.url(), init));
    } catch (error) {
      if (isApi)
        observations.bridgeErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      await route.abort('failed');
      return;
    }

    const responseBytes = Buffer.from(await response.arrayBuffer());
    record.status = response.status;
    record.responseBody = parseJson(responseBytes);
    if (isApi) observations.apiRequests.push(record);
    if (kind === 'preview') observations.previewRequests.push(record);
    if (kind === 'catalog') {
      observations.catalogRequests.push(record);
      if (heldCatalog) {
        const hold = heldCatalog;
        heldCatalog = null;
        hold.seenResolve(record);
        await hold.gate;
      }
    }
    if (kind === 'reservation') observations.reservationRequests.push(record);
    if (kind === 'authorize') observations.authorizeRequests.push(record);
    if (kind === 'new-photo-complete' || kind === 'version-complete')
      observations.completionRequests.push(record);

    if (
      kind === 'reservation' &&
      response.status === 201 &&
      dropNextReservationResponse
    ) {
      dropNextReservationResponse = false;
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

  const widthCheck = async (label) => assertMobileWidth(page, label);
  const openPanel = (heading) => openAlbumUpload(page, base, fixture, heading);
  const firstPassFile = pngFixture();
  const testName = 'assisted-catalog-final-page.png';
  const chooseFile = async (panel, bytes = firstPassFile) => {
    await panel.getByTestId('resolved-upload-file').setInputFiles({
      name: testName,
      mimeType: 'image/png',
      buffer: bytes,
    });
    await expect(panel.getByText(/原始尺寸 1 × 1/u)).toBeVisible();
  };
  const startPreview = async (panel) => {
    const before = observations.previewRequests.length;
    await panel.getByTestId('resolved-upload-preview').click();
    await expect
      .poll(() => observations.previewRequests.length)
      .toBe(before + 1);
    await expect(panel.getByTestId('assisted-catalog')).toBeVisible();
    await expect(
      panel.getByTestId('assisted-catalog-item').first(),
    ).toBeVisible();
    await expect(
      panel.getByTestId('resolved-upload-decision-label'),
    ).toHaveText('請選擇上傳目標');
    assert.ok(
      observations.previewRequests.at(-1)?.responseBody?.catalogCursor,
      'Assisted preview returns a signed initial cursor',
    );
  };
  const pageToFinalCandidate = async (panel) => {
    const next = panel.getByTestId('assisted-catalog-next');
    const pageLabel = panel.getByText(/第 \d+ 頁 · \d+ 個目標/u);
    let transitions = 0;
    while (await next.isEnabled()) {
      assert.ok(transitions < 50, 'Catalog paging must remain bounded');
      const currentPageMatch = /^第 (\d+) 頁/u.exec(
        await pageLabel.innerText(),
      );
      assert.ok(currentPageMatch, 'The current catalog page must be visible');
      const expectedPageNumber = Number(currentPageMatch[1]) + 1;
      const before = observations.catalogRequests.length;
      await next.click();
      await expect
        .poll(() => observations.catalogRequests.length)
        .toBe(before + 1);
      await expect(
        panel.getByText(
          new RegExp('^第 ' + expectedPageNumber + ' 頁 · \\d+ 個目標$', 'u'),
        ),
      ).toBeVisible();
      await expect(
        panel.getByTestId('assisted-catalog-item').first(),
      ).toBeVisible();
      const itemCount = await panel
        .getByTestId('assisted-catalog-item')
        .count();
      assert.ok(itemCount > 0 && itemCount <= 24);
      await widthCheck('Assisted candidate page ' + (transitions + 2));
      transitions++;
    }
    assert.ok(
      transitions >= 40,
      'All 1,001 candidates must require bounded pages',
    );
    const finalRow = panel.locator(
      '[data-testid="assisted-catalog-item"][data-candidate-id="' +
        fixture.finalPhotoId +
        '"]',
    );
    await expect(finalRow).toHaveCount(1);
    await expect(finalRow).toContainText(fixture.finalFilename);
    const finalItem = finalRow.locator(
      'input[type="radio"][value="' + fixture.finalPhotoId + '"]',
    );
    await finalItem.check();
    await expect(panel.getByTestId('assisted-catalog-selected')).toContainText(
      fixture.finalFilename,
    );
    await expect(
      panel.getByTestId('resolved-upload-decision-label'),
    ).toHaveText('將建立私有版本');
    return finalItem;
  };

  try {
    const panel = await openPanel('依檔名解析上傳');
    await chooseFile(panel);
    await startPreview(panel);
    const initialPreview = observations.previewRequests.at(-1)?.responseBody;
    const firstPage = observations.catalogRequests.at(-1)?.responseBody;
    assert.ok(initialPreview?.catalogCursor);
    assert.ok(firstPage?.items?.length > 0 && firstPage.items.length <= 24);
    const firstPageCursor = initialPreview.catalogCursor;
    const firstPageCatalogRequests = observations.catalogRequests.length;
    await panel.getByTestId('assisted-catalog-next').click();
    await expect
      .poll(() => observations.catalogRequests.length)
      .toBe(firstPageCatalogRequests + 1);
    await expect(panel.getByText(/第 2 頁/u)).toBeVisible();
    const pageTwoRow = panel.getByTestId('assisted-catalog-item').first();
    const pageTwoPhotoId = await pageTwoRow.getAttribute('data-candidate-id');
    assert.ok(pageTwoPhotoId);
    const pageTwoRadio = pageTwoRow.locator('input[type="radio"]');
    await pageTwoRadio.check();
    const versionKind = panel.locator(
      'input[type="radio"][value="new_version"]',
    );
    const photoKind = panel.locator('input[type="radio"][value="new_photo"]');
    await expect(versionKind).toBeChecked();
    await expect(pageTwoRadio).toBeChecked();
    await expect(
      panel.getByTestId('resolved-upload-decision-label'),
    ).toHaveText('將建立私有版本');
    await photoKind.check();
    await expect(photoKind).toBeChecked();
    await expect(pageTwoRadio).not.toBeChecked();
    await expect(
      panel.getByTestId('resolved-upload-decision-label'),
    ).toHaveText('將建立新照片');
    await versionKind.check();
    await expect(versionKind).toBeChecked();
    await expect(pageTwoRadio).toBeChecked();
    await expect(
      panel.getByTestId('resolved-upload-decision-label'),
    ).toHaveText('將建立私有版本');
    const pageTwoSelection = await panel
      .getByTestId('assisted-catalog-selected')
      .innerText();
    const returnToFirstRequests = observations.catalogRequests.length;
    await panel.getByTestId('assisted-catalog-first').click();
    await expect
      .poll(() => observations.catalogRequests.length)
      .toBe(returnToFirstRequests + 1);
    await expect(panel.getByText(/第 1 頁/u)).toBeVisible();
    assert.equal(
      await panel.getByTestId('assisted-catalog-selected').innerText(),
      pageTwoSelection,
    );
    assert.equal(
      observations.catalogRequests.at(-1)?.search,
      '?cursor=' + encodeURIComponent(firstPageCursor),
    );
    assert.equal(
      await panel
        .locator(
          '[data-testid="assisted-catalog-item"][data-candidate-id="' +
            pageTwoPhotoId +
            '"]',
        )
        .count(),
      0,
      'The page-two selection is not rendered as if it were on page one',
    );
    await widthCheck('Return to first catalog page with selection preserved');
    await pageToFinalCandidate(panel);

    const previous = panel.getByTestId('assisted-catalog-previous');
    assert.equal(await previous.isEnabled(), true);
    const priorPageRequestCount = observations.catalogRequests.length;
    await previous.click();
    await expect
      .poll(() => observations.catalogRequests.length)
      .toBe(priorPageRequestCount + 1);
    await expect(panel.getByTestId('assisted-catalog-selected')).toContainText(
      fixture.finalFilename,
    );
    assert.ok(
      (await panel.getByTestId('assisted-catalog-item').count()) <= 24,
      'The selected target stays visible in its separate summary while paging away',
    );
    await widthCheck('Selected candidate while paging away');

    const hold = armCatalogHold();
    const next = panel.getByTestId('assisted-catalog-next');
    await next.click();
    const heldRecord = await hold.seen;
    assert.equal(heldRecord.method, 'GET');
    const heldUrl = new URL(base + heldRecord.pathname + heldRecord.search);
    assert.deepEqual([...heldUrl.searchParams.keys()], ['cursor']);
    spoofNextMe = true;
    hold.release();
    await expect(panel.getByTestId('assisted-catalog-error')).toContainText(
      '身分或相簿權限已變更',
    );
    await expect(panel.getByTestId('assisted-catalog-item')).toHaveCount(0);
    await expect(panel.getByTestId('assisted-catalog-selected')).toHaveCount(0);
    await widthCheck('Late Owner callback privacy');
    assert.equal(observations.bridgeErrors.length, 0);

    // Reload restores the actual Owner and starts a fresh scoped catalog. The
    // previous late response cannot repopulate the cleared selection.
    const freshPanel = await openPanel('依檔名解析上傳');
    await chooseFile(freshPanel);
    await startPreview(freshPanel);
    await pageToFinalCandidate(freshPanel);
    const selectedRadio = freshPanel.locator(
      '[data-testid="assisted-catalog-item"][data-candidate-id="' +
        fixture.finalPhotoId +
        '"] input[type="radio"][value="' +
        fixture.finalPhotoId +
        '"]',
    );
    assert.equal(await selectedRadio.isChecked(), true);
    await freshPanel.screenshot({ path: mobileScreenshotPath });
    await freshPanel.getByTestId('resolved-upload-reserve').click();
    const dialog = freshPanel.getByTestId('resolved-upload-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(fixture.finalFilename);
    await expect(dialog).toContainText('父版本固定為該照片的目前版本');
    await widthCheck('Explicit selected-head confirmation');
    const firstReservationBodyBefore = observations.reservationRequests.length;
    dropNextReservationResponse = true;
    await dialog.getByTestId('resolved-upload-confirm').click();
    await expect
      .poll(() => observations.reservationRequests.length)
      .toBe(firstReservationBodyBefore + 1);
    const lost = observations.reservationRequests.at(-1);
    assert.ok(lost);
    assert.equal(lost.status, 201);
    assert.equal(lost.dropped, true);
    const lostBody = JSON.parse(lost.requestBody);
    assert.equal(lostBody.choice.kind, 'new_version');
    assert.equal(lostBody.choice.photoId, fixture.finalPhotoId);
    assert.equal(lostBody.choice.parentVersionId, fixture.currentVersionId);
    assert.equal(lost.responseBody?.target?.photoId, fixture.finalPhotoId);
    assert.equal(
      lost.responseBody?.target?.parentVersionId,
      fixture.currentVersionId,
    );
    const uploadSessionId = lost.responseBody?.uploadSession?.id;
    assert.ok(uploadSessionId);
    await expect(freshPanel.getByTestId('resolved-upload-retry')).toBeVisible();

    const beforeReload = await readJournal(page);
    assert.equal(beforeReload.length, 1);
    assertJournalHasNoCapabilities(beforeReload);
    const journalEnvelope = JSON.parse(beforeReload[0][1]);
    assert.deepEqual(journalEnvelope.items[0]?.reservationBody, lostBody);
    assert.equal(journalEnvelope.items[0]?.reservation, null);
    await page.reload({ waitUntil: 'networkidle' });
    const recoveredPanel = await openPanel('已保存的解析上傳工作');
    await recoveredPanel.getByTestId('resolved-upload-file').setInputFiles({
      name: testName,
      mimeType: 'image/png',
      buffer: firstPassFile,
    });
    await expect(recoveredPanel.getByText(/原始尺寸 1 × 1/u)).toBeVisible();
    const retry = recoveredPanel.getByTestId('resolved-upload-retry');
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect
      .poll(() => observations.reservationRequests.length)
      .toBe(firstReservationBodyBefore + 2);
    const replay = observations.reservationRequests.at(-1);
    assert.ok(replay);
    assert.equal(replay.status, 201);
    assert.equal(replay.dropped, false);
    assert.deepEqual(JSON.parse(replay.requestBody), lostBody);
    assert.equal(replay.responseBody?.uploadSession?.id, uploadSessionId);
    assert.deepEqual(replay.responseBody?.target, lost.responseBody?.target);

    await expect.poll(() => observations.authorizeRequests.length).toBe(1);
    await expect.poll(() => observations.signedBrowserR2Puts).toBe(1);
    await expect
      .poll(() =>
        observations.completionRequests.some(
          (record) =>
            record.pathname.includes('/versions/') && record.status === 200,
        ),
      )
      .toBe(true);
    const completion = await db
      .prepare(
        'SELECT upload_session_id,photo_id,version_id,version_no,parent_version_id,change_type,asset_id,actual_bytes,content_type,sha256_hex,image_width,image_height FROM upload_version_completions WHERE upload_session_id=?',
      )
      .bind(uploadSessionId)
      .first();
    assert.ok(completion);
    assert.equal(completion.photo_id, fixture.finalPhotoId);
    assert.equal(completion.parent_version_id, fixture.currentVersionId);
    assert.equal(completion.change_type, 'new_retouch');
    assert.equal(completion.actual_bytes, firstPassFile.byteLength);
    assert.equal(completion.content_type, 'image/png');
    assert.equal(completion.sha256_hex, sha256(firstPassFile));
    assert.equal(completion.image_width, 1);
    assert.equal(completion.image_height, 1);

    const asset = await db
      .prepare(
        "SELECT object_key FROM photo_assets WHERE version_id=? AND asset_kind='original'",
      )
      .bind(completion.version_id)
      .first();
    assert.ok(asset?.object_key);
    const storedOriginal = await storage.get(asset.object_key);
    assert.ok(storedOriginal);
    assert.deepEqual(
      Buffer.from(await storedOriginal.arrayBuffer()),
      firstPassFile,
    );

    const processed = await runImageProcessingJob({
      jobId: completion.asset_id,
      jobs: new D1ImageProcessingRepository(db),
      objects: new R2ProcessingObjectStore(storage),
      processor: new LocalSharpImageProcessor(),
    });
    assert.equal(processed.status, 'succeeded');
    const processing = await db
      .prepare('SELECT status FROM image_processing_jobs WHERE id=?')
      .bind(completion.asset_id)
      .first();
    assert.deepEqual(processing, { status: 'succeeded' });
    const derivatives = await db
      .prepare(
        "SELECT asset_kind FROM photo_assets WHERE version_id=? AND asset_kind IN('preview','thumbnail') ORDER BY asset_kind",
      )
      .bind(completion.version_id)
      .all();
    assert.deepEqual(
      derivatives.results.map((row) => row.asset_kind),
      ['preview', 'thumbnail'],
    );

    const head = await db
      .prepare(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(fixture.finalPhotoId)
      .first();
    assert.deepEqual(head, {
      version_id: fixture.currentVersionId,
      revision: 0,
    });
    const journalAfter = await readJournal(page);
    assertJournalHasNoCapabilities(journalAfter);
    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
    assert.deepEqual(
      observations.catalogRequests
        .map((record) => {
          const url = new URL(base + record.pathname + record.search);
          return [...url.searchParams.keys()];
        })
        .every((keys) => keys.length === 1 && keys[0] === 'cursor'),
      true,
    );
    for (const record of observations.catalogRequests) {
      const response = record.responseBody;
      assert.ok(response?.items?.length <= 24);
      assert.equal(
        JSON.stringify(response).includes(sha256(firstPassFile)),
        false,
      );
      assert.equal(JSON.stringify(response).includes(secretAccessKey), false);
    }
    await widthCheck('Completed Assisted upload');
    return {
      mobileOverflow: false,
      selectedHeadVisibleWhilePaging: true,
      confirmationCaptured: true,
      lostReservationReplayVerified: true,
      signedBrowserR2Puts: observations.signedBrowserR2Puts,
      processedVersionStatus: processing.status,
      processedVersionId: completion.version_id,
      mobileScreenshotPath,
    };
  } finally {
    await context.close();
    await browser.close();
  }
}
