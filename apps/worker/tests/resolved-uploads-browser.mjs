import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { AwsV4Signer } from 'aws4fetch';
import { chromium, expect } from '@playwright/test';
import { pngFixture } from './image-fixtures.mjs';

const journalPrefix = 'kino-pic:resolved-upload-journal:v1:';
const accessKeyId = 'synthetic-test-access-key';
const secretAccessKey = 'synthetic-test-secret-key-never-for-production';

function cookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  const token = match?.[1] ?? ownerCookie;
  assert.ok(token, 'A current Owner cookie is required for this browser check');
  return 'kino-owner.session_token=' + token;
}

function cookieInput({ ownerCookie, cookies }) {
  if (ownerCookie) return ownerCookie;
  if (typeof cookies === 'string') return cookies;
  if (typeof cookies?.headers === 'function') return cookies.headers();
  const token = cookies?.values?.get?.('kino-owner.session_token');
  if (token) return 'kino-owner.session_token=' + token;
  return '';
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function pngWithTextMetadata(source, text) {
  const type = Buffer.from('IEND', 'ascii');
  const iendTypeOffset = source.lastIndexOf(type);
  assert.ok(iendTypeOffset >= 4, 'The PNG fixture must end with IEND');
  const iendChunkOffset = iendTypeOffset - 4;
  const metadata = Buffer.concat([
    Buffer.from('Comment\0', 'latin1'),
    Buffer.from(text, 'latin1'),
  ]);
  return Buffer.concat([
    source.subarray(0, iendChunkOffset),
    pngChunk('tEXt', metadata),
    source.subarray(iendChunkOffset),
  ]);
}

async function ownerRequest(
  worker,
  base,
  ownerCookie,
  owner,
  path,
  method,
  body,
) {
  const headers = {
    Accept: 'application/json',
    Cookie: cookieHeader(ownerCookie),
    Origin: new URL(base).origin,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(method === 'PUT' ? { 'X-Kino-Expected-Actor': owner } : {}),
  };
  const response = await worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
  const value = await response.json().catch(() => null);
  return { response, value };
}

async function createProjectAlbum({
  worker,
  base,
  ownerCookie,
  owner,
  workspaceId,
}) {
  const projectName = 'Resolved upload browser ' + randomUUID();
  const projectCreated = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    '/api/v1/projects',
    'POST',
    { requestId: randomUUID(), workspaceId, name: projectName },
  );
  assert.equal(
    projectCreated.response.status,
    201,
    JSON.stringify(projectCreated.value),
  );
  const project = projectCreated.value?.project;
  assert.ok(project?.id);
  assert.equal(project.workspaceId, workspaceId);
  assert.equal(project.versioningMode, 'manual');

  const configured = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning',
    'PUT',
    {
      requestId: randomUUID(),
      expectedRevision: project.revision,
      mode: 'auto_filename',
      confirm: true,
    },
  );
  assert.equal(
    configured.response.status,
    200,
    JSON.stringify(configured.value),
  );
  assert.equal(configured.value?.mode, 'auto_filename');

  const albumName = 'Resolved upload browser album ' + randomUUID();
  const albumCreated = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/albums',
    'POST',
    { requestId: randomUUID(), name: albumName },
  );
  assert.equal(
    albumCreated.response.status,
    201,
    JSON.stringify(albumCreated.value),
  );
  const album = albumCreated.value?.album;
  assert.ok(album?.id);

  return {
    projectId: project.id,
    projectName,
    albumId: album.id,
    albumName,
  };
}

async function setProjectVersioningMode({
  worker,
  base,
  ownerCookie,
  owner,
  projectId,
  mode,
}) {
  const path =
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/versioning';
  const current = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    path,
    'GET',
  );
  assert.equal(current.response.status, 200, JSON.stringify(current.value));
  assert.notEqual(current.value?.mode, mode);
  const changed = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    path,
    'PUT',
    {
      requestId: randomUUID(),
      expectedRevision: current.value?.revision,
      mode,
      confirm: true,
    },
  );
  assert.equal(changed.response.status, 200, JSON.stringify(changed.value));
  assert.equal(changed.value?.mode, mode);
  assert.equal(changed.value?.changed, true);
  return changed.value;
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

async function openAlbumUpload({
  page,
  base,
  projectId,
  projectName,
  albumId,
  albumName,
  resolvedHeading = '依檔名解析上傳',
}) {
  const document = await page.goto(
    base + '/dashboard/projects/' + encodeURIComponent(projectId),
    { waitUntil: 'networkidle' },
  );
  assert.equal(document?.status(), 200);
  await expect(
    page.getByRole('heading', { name: projectName, exact: true }),
  ).toBeVisible();
  const albumCard = page.getByTestId('album-card-' + albumId);
  await expect(albumCard).toBeVisible();
  await albumCard
    .getByRole('button', { name: '上傳照片 ' + albumName, exact: true })
    .click();
  const panel = page.getByTestId('resolved-upload');
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: resolvedHeading, exact: true }),
  ).toBeVisible();
  return panel;
}

async function chooseAndPreview(panel, file, expectedOutcomeLabel) {
  await panel.getByTestId('resolved-upload-file').setInputFiles(file);
  await expect(panel.getByText(/原始尺寸 1 × 1/)).toBeVisible();
  await panel.getByTestId('resolved-upload-preview').click();
  await expect(
    panel.getByRole('heading', { name: expectedOutcomeLabel, exact: true }),
  ).toBeVisible();
}

async function confirmUpload(panel) {
  await panel.getByTestId('resolved-upload-reserve').click();
  const dialog = panel.getByTestId('resolved-upload-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('resolved-upload-confirm').click();
}

async function readResolvedJournal(page) {
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
      'The journal must not store capabilities',
    );
}

async function makeResolvedUploadBrowser({
  browser,
  worker,
  base,
  ownerCookie,
  actorId,
  storage,
  db,
}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await addOwnerCookie(context, base, ownerCookie);
  const page = await context.newPage();
  const observations = {
    apiRequests: [],
    capabilityReads: [],
    previewRequests: [],
    reservationRequests: [],
    authorizeRequests: [],
    completionRequests: [],
    pageErrors: [],
    bridgeErrors: [],
    putCount: 0,
  };
  let dropNextReservationResponse = false;
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
        'The signed grant must bind the bytes and headers actually sent',
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
      assert.ok(session, 'The signed key must refer to a reserved upload');
      assert.equal(session.expected_bytes, bytes.byteLength);
      assert.equal(session.content_type, headers['content-type']);
      assert.equal(session.sha256_hex, sha256(bytes));

      const stored = await storage.put(objectKey, new Uint8Array(bytes), {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: headers['content-type'] },
        sha256: Buffer.from(checksum, 'base64'),
      });
      assert.ok(
        stored,
        'The signed browser PUT must store one private original',
      );
      observations.putCount++;
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
    const isApi = pathname.startsWith('/api/');
    let kind = null;
    if (
      method === 'GET' &&
      pathname === '/api/v1/upload-resolution/capabilities'
    )
      kind = 'capability';
    else if (
      method === 'POST' &&
      pathname.startsWith('/api/v1/albums/') &&
      pathname.endsWith('/upload-resolution')
    )
      kind = 'preview';
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
        'reservation',
        'authorize',
        'new-photo-complete',
        'version-complete',
      ].includes(kind)
    )
      assert.equal(headers['x-kino-expected-actor'], actorId);
    headers['cf-connecting-ip'] = '198.51.100.97';
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
    if (kind === 'capability') observations.capabilityReads.push(record);
    if (kind === 'preview') observations.previewRequests.push(record);
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

  return {
    page,
    context,
    observations,
    dropNextReservationResponse() {
      dropNextReservationResponse = true;
    },
    async close() {
      await context.close();
    },
  };
}

function assertNoSecretQuery(records) {
  for (const record of records)
    assert.equal(
      record.search,
      '',
      'Owner API calls must not use query strings',
    );
}

async function assertStoredOriginal({
  db,
  storage,
  uploadSessionId,
  versionId,
  bytes,
}) {
  const asset = await db
    .prepare(
      "SELECT object_key FROM photo_assets WHERE version_id=? AND asset_kind='original'",
    )
    .bind(versionId)
    .first();
  assert.ok(asset?.object_key);
  const object = await storage.get(asset.object_key);
  assert.ok(object);
  assert.deepEqual(Buffer.from(await object.arrayBuffer()), bytes);
  const session = await db
    .prepare('SELECT id,status,expected_bytes FROM upload_sessions WHERE id=?')
    .bind(uploadSessionId)
    .first();
  assert.equal(session?.id, uploadSessionId);
  assert.equal(session?.status, 'reserved');
  assert.equal(session?.expected_bytes, bytes.byteLength);
  return asset.object_key;
}

export async function runResolvedUploadBrowserChecks({
  worker,
  base,
  ownerCookie,
  cookies,
  owner,
  db,
  storage: suppliedStorage,
  galleryFixture,
  workspaceId: suppliedWorkspaceId,
}) {
  const cookie = cookieInput({ ownerCookie, cookies });
  const storage = suppliedStorage ?? galleryFixture?.storage;
  const workspaceId =
    suppliedWorkspaceId ?? galleryFixture?.context?.workspace?.id;
  assert.ok(worker);
  assert.ok(base);
  assert.ok(cookie);
  assert.ok(owner);
  assert.ok(db);
  assert.ok(storage, 'The enabled worker must share the test R2 bucket');
  assert.ok(workspaceId, 'A current Owner workspace is required');
  const currentWorkspace = await db
    .prepare('SELECT owner_user_id FROM workspaces WHERE id=?')
    .bind(workspaceId)
    .first();
  assert.equal(currentWorkspace?.owner_user_id, owner);

  const capabilities = await worker.fetch(
    new Request(new URL('/api/v1/upload-resolution/capabilities', base), {
      headers: { Cookie: cookieHeader(cookie) },
    }),
  );
  assert.equal(capabilities.status, 200);
  assert.deepEqual(await capabilities.json(), { enabled: true });

  const fixture = await createProjectAlbum({
    worker,
    base,
    ownerCookie: cookie,
    owner,
    workspaceId,
  });
  const browser = await chromium.launch({ headless: true });
  let ownerBrowser;
  try {
    ownerBrowser = await makeResolvedUploadBrowser({
      browser,
      worker,
      base,
      ownerCookie: cookie,
      actorId: owner,
      storage,
      db,
    });
    const { page, observations } = ownerBrowser;

    let panel = await openAlbumUpload({
      page,
      base,
      ...fixture,
    });
    await expect
      .poll(() => observations.capabilityReads.length)
      .toBeGreaterThan(0);
    assert.equal(observations.capabilityReads[0]?.responseBody?.enabled, true);

    const original = pngFixture();
    const originalFilename = 'resolved-upload-browser-original.png';
    const originalHash = sha256(original);
    await chooseAndPreview(
      panel,
      { name: originalFilename, mimeType: 'image/png', buffer: original },
      '將建立新照片',
    );
    await expect.poll(() => observations.previewRequests.length).toBe(1);
    const firstPreview = observations.previewRequests[0];
    assert.ok(firstPreview);
    assert.equal(firstPreview.status, 200);
    assert.equal(firstPreview.search, '');
    const previewBody = JSON.parse(firstPreview.requestBody);
    assert.equal(previewBody.file.originalFilename, originalFilename);
    assert.equal(previewBody.file.sha256, originalHash);
    assert.deepEqual(previewBody.file.dimensions, { width: 1, height: 1 });
    assert.equal(firstPreview.responseBody?.mode, 'auto_filename');
    assert.equal(firstPreview.responseBody?.decision?.outcome, 'new_photo');
    assert.equal(firstPreview.responseBody?.candidatesTruncated, false);
    assert.equal(firstPreview.responseBody?.candidates?.length, 0);

    await assertMobileWidth(page, 'Resolved upload preview');
    ownerBrowser.dropNextReservationResponse();
    await confirmUpload(panel);
    await expect
      .poll(() =>
        observations.reservationRequests.some((record) => record.dropped),
      )
      .toBe(true);
    const lostReservation = observations.reservationRequests[0];
    assert.ok(lostReservation);
    assert.equal(lostReservation.status, 201);
    assert.equal(lostReservation.dropped, true);
    const lostBody = JSON.parse(lostReservation.requestBody);
    assert.equal(lostBody.choice.kind, 'new_photo');
    assert.equal(lostBody.file.sha256, originalHash);
    assert.equal(lostBody.expectedMode, 'auto_filename');
    assert.equal(lostReservation.responseBody?.target?.kind, 'new_photo');
    const lostSessionId = lostReservation.responseBody?.uploadSession?.id;
    assert.ok(lostSessionId);
    await expect(panel.getByTestId('resolved-upload-retry')).toBeVisible();

    const journalBeforeReload = await readResolvedJournal(page);
    assert.equal(journalBeforeReload.length, 1);
    assertJournalHasNoCapabilities(journalBeforeReload);
    const journalEnvelope = JSON.parse(journalBeforeReload[0][1]);
    assert.equal(journalEnvelope.items.length, 1);
    assert.equal(journalEnvelope.items[0]?.reservation, null);
    assert.deepEqual(journalEnvelope.items[0]?.reservationBody, lostBody);
    assert.equal(
      journalEnvelope.items[0]?.reservationBody?.requestId,
      lostBody.requestId,
    );
    await assertMobileWidth(page, 'Unknown reservation response');

    const modeChangedWhilePending = await setProjectVersioningMode({
      worker,
      base,
      ownerCookie: cookie,
      owner,
      projectId: fixture.projectId,
      mode: 'manual',
    });
    assert.equal(modeChangedWhilePending.mode, 'manual');
    assert.notEqual(
      modeChangedWhilePending.revision,
      lostBody.expectedProjectRevision,
      'The retry must replay after project versioning changed its revision',
    );

    await page.reload({ waitUntil: 'networkidle' });
    panel = await openAlbumUpload({
      page,
      base,
      resolvedHeading: '已保存的解析上傳工作',
      ...fixture,
    });
    await expect(panel.getByText(/相簿解析模式目前已停用/)).toBeVisible();
    await expect(panel.locator('h3')).toHaveText('已保存的解析上傳工作');
    await panel.getByTestId('resolved-upload-file').setInputFiles({
      name: originalFilename,
      mimeType: 'image/png',
      buffer: original,
    });
    await expect(panel.getByText(/原始尺寸 1 × 1/)).toBeVisible();
    const replayButton = panel.getByTestId('resolved-upload-retry');
    await expect(replayButton).toBeEnabled();
    await replayButton.click();

    await expect.poll(() => observations.reservationRequests.length).toBe(2);
    const replayedReservation = observations.reservationRequests[1];
    assert.ok(replayedReservation);
    assert.equal(replayedReservation.status, 201);
    assert.equal(replayedReservation.dropped, false);
    assert.deepEqual(
      JSON.parse(replayedReservation.requestBody),
      lostBody,
      'The reload retry must resend the exact reservation body and UUID',
    );
    assert.equal(
      replayedReservation.responseBody?.uploadSession?.id,
      lostSessionId,
    );
    assert.deepEqual(replayedReservation.responseBody?.target, {
      kind: 'new_photo',
    });

    await expect.poll(() => observations.authorizeRequests.length).toBe(1);
    await expect.poll(() => observations.putCount).toBe(1);
    await expect
      .poll(() =>
        observations.completionRequests.some((record) => record.status === 200),
      )
      .toBe(true);
    const firstPhotoCompletions = observations.completionRequests.filter(
      (record) => record.pathname.startsWith('/api/v1/uploads/'),
    );
    assert.ok(firstPhotoCompletions.some((record) => record.status === 200));
    assert.equal(observations.reservationRequests.length, 2);
    assert.equal(
      new Set(
        observations.reservationRequests.map(
          (record) => JSON.parse(record.requestBody).requestId,
        ),
      ).size,
      1,
    );

    const reservationRows = await db
      .prepare(
        "SELECT upload_session_id,payload_json,result_json FROM upload_requests WHERE actor_id=? AND request_id=? AND operation='upload.reserved'",
      )
      .bind(owner, lostBody.requestId)
      .all();
    assert.equal(reservationRows.results.length, 1);
    assert.equal(reservationRows.results[0]?.upload_session_id, lostSessionId);
    const capturedPayload = JSON.parse(
      reservationRows.results[0]?.payload_json,
    );
    assert.equal(capturedPayload.workspaceId, workspaceId);
    assert.equal(capturedPayload.projectId, fixture.projectId);
    assert.equal(capturedPayload.albumId, fixture.albumId);
    assert.equal(capturedPayload.originalFilename, originalFilename);
    assert.equal(capturedPayload.expectedBytes, original.byteLength);
    assert.equal(capturedPayload.contentType, 'image/png');
    assert.equal(capturedPayload.sha256, originalHash);
    assert.equal(Object.hasOwn(capturedPayload, 'versionTarget'), false);
    assert.deepEqual(capturedPayload.resolution, {
      expectedChangeSequence: lostBody.expectedChangeSequence,
      expectedProjectRevision: lostBody.expectedProjectRevision,
      expectedMode: lostBody.expectedMode,
      choice: lostBody.choice,
      dimensions: lostBody.file.dimensions,
      confirm: true,
    });
    assert.equal(
      JSON.parse(reservationRows.results[0]?.result_json)?.id,
      lostSessionId,
    );

    const firstCompletion = await db
      .prepare(
        'SELECT upload_session_id,photo_id,version_id,asset_id,actual_bytes,content_type,sha256_hex,image_width,image_height FROM upload_completions WHERE upload_session_id=?',
      )
      .bind(lostSessionId)
      .first();
    assert.ok(firstCompletion?.photo_id);
    assert.ok(firstCompletion?.version_id);
    assert.equal(firstCompletion?.upload_session_id, lostSessionId);
    assert.equal(firstCompletion?.actual_bytes, original.byteLength);
    assert.equal(firstCompletion?.content_type, 'image/png');
    assert.equal(firstCompletion?.sha256_hex, originalHash);
    assert.equal(firstCompletion?.image_width, 1);
    assert.equal(firstCompletion?.image_height, 1);
    const firstPhotoId = firstCompletion.photo_id;
    const firstVersionId = firstCompletion.version_id;
    await assertStoredOriginal({
      db,
      storage,
      uploadSessionId: lostSessionId,
      versionId: firstVersionId,
      bytes: original,
    });

    const firstHead = await db
      .prepare(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(firstPhotoId)
      .first();
    assert.deepEqual(firstHead, {
      version_id: firstVersionId,
      revision: 0,
    });
    const photoRows = await db
      .prepare('SELECT id,original_filename FROM photos WHERE album_id=?')
      .bind(fixture.albumId)
      .all();
    assert.equal(photoRows.results.length, 1);
    assert.deepEqual(photoRows.results[0], {
      id: firstPhotoId,
      original_filename: originalFilename,
    });

    await setProjectVersioningMode({
      worker,
      base,
      ownerCookie: cookie,
      owner,
      projectId: fixture.projectId,
      mode: 'auto_filename',
    });
    await page.reload({ waitUntil: 'networkidle' });
    panel = await openAlbumUpload({
      page,
      base,
      ...fixture,
    });

    const changedImage = pngWithTextMetadata(original, 'retouch-version-two');
    assert.notEqual(sha256(changedImage), originalHash);
    await chooseAndPreview(
      panel,
      {
        name: originalFilename,
        mimeType: 'image/png',
        buffer: changedImage,
      },
      '將建立私有版本',
    );
    await expect.poll(() => observations.previewRequests.length).toBe(2);
    const secondPreview = observations.previewRequests[1];
    assert.ok(secondPreview);
    assert.equal(secondPreview.status, 200);
    assert.equal(secondPreview.responseBody?.mode, 'auto_filename');
    assert.equal(secondPreview.responseBody?.decision?.outcome, 'new_version');
    assert.equal(secondPreview.responseBody?.decision?.photoId, firstPhotoId);
    const selectedCandidate = secondPreview.responseBody?.candidates?.find(
      (candidate) => candidate.photoId === firstPhotoId,
    );
    assert.equal(selectedCandidate?.currentVersionId, firstVersionId);
    assert.equal(selectedCandidate?.revision, 0);

    await assertMobileWidth(page, 'Resolved new-version preview');
    await confirmUpload(panel);
    await expect.poll(() => observations.reservationRequests.length).toBe(3);
    const secondReservation = observations.reservationRequests[2];
    assert.ok(secondReservation);
    assert.equal(secondReservation.status, 201);
    assert.equal(secondReservation.responseBody?.target?.kind, 'new_version');
    assert.equal(secondReservation.responseBody?.target?.photoId, firstPhotoId);
    assert.equal(
      secondReservation.responseBody?.target?.parentVersionId,
      firstVersionId,
    );
    assert.equal(
      secondReservation.responseBody?.target?.capturedVersioningMode,
      'auto_filename',
    );
    const secondReservationBody = JSON.parse(secondReservation.requestBody);
    assert.equal(secondReservationBody.choice.kind, 'new_version');
    assert.equal(
      secondReservation.responseBody?.target?.changeType,
      'new_retouch',
    );

    await expect.poll(() => observations.authorizeRequests.length).toBe(2);
    await expect.poll(() => observations.putCount).toBe(2);
    await expect
      .poll(() =>
        observations.completionRequests.some(
          (record) =>
            record.pathname.includes('/versions/') && record.status === 200,
        ),
      )
      .toBe(true);
    await expect(panel.getByText(/相簿仍顯示原目前版本/)).toBeVisible();

    const secondSessionId = secondReservation.responseBody?.uploadSession?.id;
    assert.ok(secondSessionId);
    const secondCompletion = await db
      .prepare(
        'SELECT upload_session_id,photo_id,version_id,version_no,parent_version_id,change_type,actual_bytes,content_type,sha256_hex,image_width,image_height FROM upload_version_completions WHERE upload_session_id=?',
      )
      .bind(secondSessionId)
      .first();
    assert.ok(secondCompletion);
    assert.equal(secondCompletion.photo_id, firstPhotoId);
    assert.equal(secondCompletion.version_no, 2);
    assert.equal(secondCompletion.parent_version_id, firstVersionId);
    assert.equal(secondCompletion.change_type, 'new_retouch');
    assert.equal(secondCompletion.actual_bytes, changedImage.byteLength);
    assert.equal(secondCompletion.content_type, 'image/png');
    assert.equal(secondCompletion.sha256_hex, sha256(changedImage));
    assert.equal(secondCompletion.image_width, 1);
    assert.equal(secondCompletion.image_height, 1);
    const capturedTarget = await db
      .prepare(
        'SELECT photo_id,parent_version_id,expected_revision,captured_versioning_mode,change_type,change_note,labels_json FROM upload_version_targets WHERE upload_session_id=?',
      )
      .bind(secondSessionId)
      .first();
    assert.deepEqual(capturedTarget, {
      photo_id: firstPhotoId,
      parent_version_id: firstVersionId,
      expected_revision: 0,
      captured_versioning_mode: 'auto_filename',
      change_type: 'new_retouch',
      change_note: '',
      labels_json: '[]',
    });
    const secondRequestId = secondReservationBody.requestId;
    const secondCanonicalRequest = await db
      .prepare(
        "SELECT payload_json FROM upload_requests WHERE actor_id=? AND request_id=? AND operation='upload.reserved'",
      )
      .bind(owner, secondRequestId)
      .first();
    assert.ok(secondCanonicalRequest?.payload_json);
    const secondCanonicalPayload = JSON.parse(
      secondCanonicalRequest.payload_json,
    );
    assert.deepEqual(secondCanonicalPayload.versionTarget, {
      photoId: firstPhotoId,
      parentVersionId: firstVersionId,
      expectedRevision: 0,
      changeType: 'new_retouch',
      changeNote: '',
      labels: [],
      confirm: true,
    });
    await assertStoredOriginal({
      db,
      storage,
      uploadSessionId: secondSessionId,
      versionId: secondCompletion.version_id,
      bytes: changedImage,
    });

    const finalHead = await db
      .prepare(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(firstPhotoId)
      .first();
    assert.deepEqual(
      finalHead,
      { version_id: firstVersionId, revision: 0 },
      'A resolved new version must not switch the gallery current head',
    );
    const gallery = await ownerRequest(
      worker,
      base,
      cookie,
      owner,
      '/api/v1/albums/' + encodeURIComponent(fixture.albumId) + '/photos',
      'GET',
    );
    assert.equal(gallery.response.status, 200, JSON.stringify(gallery.value));
    assert.equal(gallery.value?.photos?.length, 1);
    assert.equal(gallery.value?.photos?.[0]?.id, firstPhotoId);
    assert.equal(gallery.value?.photos?.[0]?.versionId, firstVersionId);

    const finalJournal = await readResolvedJournal(page);
    assertJournalHasNoCapabilities(finalJournal);
    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
    assertNoSecretQuery(observations.apiRequests);
    await assertMobileWidth(page, 'Resolved upload completion');

    return {
      projectId: fixture.projectId,
      albumId: fixture.albumId,
      photoId: firstPhotoId,
      initialVersionId: firstVersionId,
      secondVersionId: secondCompletion.version_id,
      lostReservationReplayVerified: true,
      signedBrowserR2Puts: observations.putCount,
      currentHeadPreserved: true,
    };
  } finally {
    await ownerBrowser?.close();
    await browser.close();
  }
}
