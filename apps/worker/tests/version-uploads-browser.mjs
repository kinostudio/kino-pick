import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { AwsV4Signer } from 'aws4fetch';
import { chromium, expect } from '@playwright/test';
import { pngFixture } from './image-fixtures.mjs';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';

function cookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  const token = match?.[1] ?? ownerCookie;
  assert.ok(
    token,
    'The version upload browser check requires the Owner cookie',
  );
  return 'kino-owner.session_token=' + token;
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
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
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(document?.status(), 200);
  await expect(
    page.getByRole('heading', { name: projectName, exact: true }),
  ).toBeVisible();
  const galleryButton = page.getByRole('button', {
    name: '開啟相簿 ' + albumName,
    exact: true,
  });
  await expect(galleryButton).toBeVisible();
  const cardTestId = await galleryButton
    .locator('xpath=ancestor::li[1]')
    .getAttribute('data-testid');
  assert.ok(cardTestId?.startsWith('album-card-'));
  await galleryButton.click();
  assert.equal(
    new URL(page.url()).searchParams.get('albumId'),
    cardTestId.slice('album-card-'.length),
  );
  const previewButton = page.getByRole('button', {
    name: '開啟照片預覽：' + filename,
    exact: true,
  });
  await expect(previewButton).toBeVisible();
  await previewButton.click();
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

async function assertMobileWidth(page, label) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    sizes.scrollWidth <= sizes.clientWidth,
    label +
      ' overflows 375px (' +
      sizes.scrollWidth +
      ' > ' +
      sizes.clientWidth +
      ')',
  );
}

async function createBaseline({
  worker,
  base,
  cookie,
  db,
  storage,
  workspaceId,
  owner,
}) {
  async function send(method, path, body) {
    const headers = {
      Cookie: cookie,
      Origin: base,
      Accept: 'application/json',
    };
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return worker.fetch(new Request(new URL(path, base), init));
  }

  const projectName = 'Version upload browser ' + randomUUID();
  const projectResponse = await send('POST', '/api/v1/projects', {
    requestId: randomUUID(),
    workspaceId,
    name: projectName,
  });
  const projectBody = await projectResponse.json();
  assert.equal(projectResponse.status, 201, JSON.stringify(projectBody));
  const project = projectBody.project;
  assert.equal(project?.workspaceId, workspaceId);
  assert.equal(project?.versioningMode, 'manual');

  const albumName = 'Version upload browser album ' + randomUUID();
  const albumResponse = await send(
    'POST',
    '/api/v1/projects/' + project.id + '/albums',
    { requestId: randomUUID(), name: albumName },
  );
  const albumBody = await albumResponse.json();
  assert.equal(albumResponse.status, 201, JSON.stringify(albumBody));
  const album = albumBody.album;
  assert.ok(album?.id);

  const bytes = pngFixture();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const originalFilename = 'version-upload-browser-v1.png';
  const initResponse = await send('POST', '/api/v1/uploads/init', {
    requestId: randomUUID(),
    workspaceId,
    projectId: project.id,
    albumId: album.id,
    originalFilename,
    expectedBytes: bytes.byteLength,
    contentType: 'image/png',
    sha256,
  });
  const initBody = await initResponse.json();
  assert.equal(initResponse.status, 201, JSON.stringify(initBody));
  const uploadSession = initBody.uploadSession;
  assert.ok(uploadSession?.id);

  const authorizationResponse = await send(
    'POST',
    '/api/v1/uploads/' + uploadSession.id + '/authorize',
    { requestId: randomUUID() },
  );
  const authorizationBody = await authorizationResponse.json();
  assert.equal(
    authorizationResponse.status,
    200,
    JSON.stringify(authorizationBody),
  );
  assert.equal(
    authorizationBody?.uploadAuthorization?.contentLength,
    bytes.byteLength,
  );

  const keyRow = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(uploadSession.id)
    .first();
  assert.ok(keyRow?.object_key);
  const put = await storage.put(keyRow.object_key, new Uint8Array(bytes), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: Buffer.from(sha256, 'hex'),
  });
  assert.ok(put);

  const completeResponse = await send(
    'POST',
    '/api/v1/uploads/' + uploadSession.id + '/complete',
    { requestId: randomUUID() },
  );
  const completeBody = await completeResponse.json();
  assert.equal(completeResponse.status, 200, JSON.stringify(completeBody));
  const baseline = completeBody.completion;
  assert.equal(baseline?.status, 'completed');
  assert.equal(baseline?.versionNo, undefined);
  assert.ok(baseline?.photoId);
  assert.ok(baseline?.versionId);
  assert.ok(baseline?.assetId);

  const jobs = new D1ImageProcessingRepository(db);
  const objects = new R2ProcessingObjectStore(storage);
  const processed = await runImageProcessingJob({
    jobId: baseline.assetId,
    jobs,
    objects,
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processed.status, 'succeeded');

  const head = await db
    .prepare(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
    )
    .bind(baseline.photoId)
    .first();
  assert.deepEqual(head, { version_id: baseline.versionId, revision: 0 });

  const projectRow = await db
    .prepare('SELECT versioning_mode FROM projects WHERE id=?')
    .bind(project.id)
    .first();
  assert.equal(projectRow?.versioning_mode, 'manual');

  const ownerRow = await db
    .prepare('SELECT owner_user_id FROM workspaces WHERE id=?')
    .bind(workspaceId)
    .first();
  assert.equal(ownerRow?.owner_user_id, owner);

  return {
    projectId: project.id,
    projectName,
    albumId: album.id,
    albumName,
    photoId: baseline.photoId,
    version1Id: baseline.versionId,
    originalFilename,
  };
}

async function makeOwnerBrowser({
  browser,
  worker,
  base,
  ownerCookie,
  actorId,
  storage,
  db,
}) {
  const cookie = cookieHeader(ownerCookie);
  const secure = new URL(base).protocol === 'https:';
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: cookie.slice('kino-owner.session_token='.length),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure,
    },
  ]);

  const page = await context.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  const observations = {
    apiRequests: [],
    capabilityReads: [],
    initRequests: [],
    authorizeRequests: [],
    completionRequests: [],
    recoveryReads: [],
    pageErrors: [],
    bridgeErrors: [],
  };
  let dropNextSuccessfulCompletionResponse = false;
  let putCount = 0;
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
            'Access-Control-Allow-Origin': base,
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
        accessKeyId: 'synthetic-test-access-key',
        secretAccessKey: 'synthetic-test-secret-key-never-for-production',
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
      assert.equal(session?.original_filename, 'version-upload-browser-v2.png');
      assert.equal(session?.expected_bytes, bytes.byteLength);
      assert.equal(session?.content_type, headers['content-type']);
      assert.equal(
        session?.sha256_hex,
        createHash('sha256').update(bytes).digest('hex'),
      );
      const stored = await storage.put(objectKey, bytes, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: headers['content-type'] },
        sha256: Buffer.from(checksum, 'base64'),
      });
      assert.ok(
        stored,
        'Create-only upload must store one exact original object',
      );
      putCount++;
      await route.fulfill({
        status: 200,
        headers: {
          'Access-Control-Allow-Origin': base,
          'Access-Control-Expose-Headers': 'ETag',
        },
        body: '',
      });
      return;
    }

    const method = incoming.method();
    const requestBody = incoming.postData() ?? '';
    const isApi = url.pathname.startsWith('/api/');
    const record = {
      method,
      pathname: url.pathname,
      search: url.search,
      requestBody,
      status: 0,
      responseBody: null,
      dropped: false,
    };
    let kind = null;
    if (
      method === 'GET' &&
      url.pathname === '/api/v1/version-uploads/capabilities'
    )
      kind = 'capability';
    else if (method === 'POST' && url.pathname.endsWith('/versions/init'))
      kind = 'init';
    else if (
      method === 'POST' &&
      url.pathname.startsWith('/api/v1/uploads/') &&
      url.pathname.endsWith('/authorize')
    )
      kind = 'authorize';
    else if (
      method === 'POST' &&
      url.pathname.startsWith('/api/v1/photos/') &&
      url.pathname.includes('/versions/') &&
      url.pathname.endsWith('/complete')
    )
      kind = 'complete';
    else if (
      method === 'GET' &&
      url.pathname.endsWith('/versions/uploads/recovery')
    )
      kind = 'recovery';

    const headers = await incoming.allHeaders();
    if (method === 'POST' && ['init', 'authorize', 'complete'].includes(kind))
      assert.equal(headers['x-kino-expected-actor'], actorId);
    headers['cf-connecting-ip'] = '198.51.100.97';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD')
      init.body = incoming.postDataBuffer() ?? undefined;

    let response;
    try {
      response = await worker.fetch(new Request(incoming.url(), init));
    } catch (error) {
      if (isApi) {
        observations.bridgeErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
      await route.abort('failed');
      return;
    }

    const responseBytes = Buffer.from(await response.arrayBuffer());
    record.status = response.status;
    record.responseBody = parseJson(responseBytes);
    if (isApi) observations.apiRequests.push(record);
    if (kind === 'capability') observations.capabilityReads.push(record);
    if (kind === 'init') observations.initRequests.push(record);
    if (kind === 'authorize') observations.authorizeRequests.push(record);
    if (kind === 'complete') observations.completionRequests.push(record);
    if (kind === 'recovery') observations.recoveryReads.push(record);

    if (
      kind === 'complete' &&
      response.ok &&
      dropNextSuccessfulCompletionResponse
    ) {
      dropNextSuccessfulCompletionResponse = false;
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
    putCount: () => putCount,
    dropNextSuccessfulCompletionResponse() {
      dropNextSuccessfulCompletionResponse = true;
    },
    async close() {
      await context.close();
    },
  };
}

async function assertPrivateV2AndV1Head({
  db,
  photoId,
  version1Id,
  uploadSessionId,
}) {
  const head = await db
    .prepare(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
    )
    .bind(photoId)
    .first();
  assert.deepEqual(head, { version_id: version1Id, revision: 0 });

  const versionRows = await db
    .prepare(
      'SELECT id,version_no,parent_version_id,status,source_hash_sha256,byte_size,mime,width,height FROM photo_versions WHERE photo_id=? ORDER BY version_no',
    )
    .bind(photoId)
    .all();
  assert.equal(versionRows.results.length, 2);
  assert.deepEqual(versionRows.results[0], {
    id: version1Id,
    version_no: 1,
    parent_version_id: null,
    status: 'private',
    source_hash_sha256: versionRows.results[0].source_hash_sha256,
    byte_size: versionRows.results[0].byte_size,
    mime: 'image/png',
    width: 1,
    height: 1,
  });
  const v2 = versionRows.results[1];
  assert.equal(v2?.version_no, 2);
  assert.equal(v2?.parent_version_id, version1Id);
  assert.equal(v2?.status, 'private');
  assert.equal(v2?.mime, 'image/png');
  assert.equal(v2?.width, 1);
  assert.equal(v2?.height, 1);

  const completion = await db
    .prepare(
      'SELECT upload_session_id,photo_id,version_no,parent_version_id,change_type,change_note,labels_json,actual_bytes,content_type,sha256_hex,image_width,image_height FROM upload_version_completions WHERE upload_session_id=?',
    )
    .bind(uploadSessionId)
    .first();
  assert.equal(completion?.photo_id, photoId);
  assert.equal(completion?.version_no, 2);
  assert.equal(completion?.parent_version_id, version1Id);
  assert.equal(completion?.change_type, 'replace_current');
  assert.equal(completion?.change_note, 'Browser acceptance replacement');
  assert.deepEqual(JSON.parse(completion?.labels_json ?? '[]'), [
    'browser',
    'acceptance',
  ]);
  assert.equal(completion?.actual_bytes, pngFixture().byteLength);
  assert.equal(completion?.content_type, 'image/png');

  const target = await db
    .prepare(
      'SELECT photo_id,parent_version_id,expected_revision,captured_versioning_mode,change_type,change_note,labels_json FROM upload_version_targets WHERE upload_session_id=?',
    )
    .bind(uploadSessionId)
    .first();
  assert.deepEqual(target, {
    photo_id: photoId,
    parent_version_id: version1Id,
    expected_revision: 0,
    captured_versioning_mode: 'manual',
    change_type: 'replace_current',
    change_note: 'Browser acceptance replacement',
    labels_json: '["browser","acceptance"]',
  });

  const photoCount = await db
    .prepare('SELECT count(*) AS n FROM photos WHERE id=?')
    .bind(photoId)
    .first();
  assert.equal(photoCount?.n, 1);
  return v2;
}

export async function runVersionUploadsBrowserChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  owner,
  db,
  storage: suppliedStorage,
  galleryFixture,
}) {
  const storage = suppliedStorage ?? galleryFixture?.storage;
  assert.ok(worker);
  assert.ok(disabledWorker);
  assert.ok(ownerCookie);
  assert.ok(owner);
  assert.ok(db);
  assert.ok(
    storage,
    'The gallery fixture must include its private test R2 bucket',
  );
  const cookie = cookieHeader(ownerCookie);
  const workspaceId = galleryFixture?.context?.workspace?.id;
  assert.ok(workspaceId, 'A gallery fixture workspace is required');
  const ownerRow = await db
    .prepare('SELECT owner_user_id FROM workspaces WHERE id=?')
    .bind(workspaceId)
    .first();
  assert.equal(ownerRow?.owner_user_id, owner);

  const baseline = await createBaseline({
    worker,
    base,
    cookie,
    db,
    storage,
    workspaceId,
    owner,
  });

  const disabledCapabilityResponse = await disabledWorker.fetch(
    new Request(new URL('/api/v1/version-uploads/capabilities', base), {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(disabledCapabilityResponse.status, 200);
  assert.deepEqual(await disabledCapabilityResponse.json(), { enabled: false });

  const browser = await chromium.launch({ headless: true });
  try {
    const disabled = await makeOwnerBrowser({
      browser,
      worker: disabledWorker,
      base,
      ownerCookie,
      actorId: owner,
      storage,
      db,
    });
    try {
      const page = disabled.page;
      const dialog = await openPhoto({
        page,
        base,
        projectId: baseline.projectId,
        projectName: baseline.projectName,
        albumName: baseline.albumName,
        filename: baseline.originalFilename,
      });
      assert.equal(await dialog.isVisible(), true);
      const uploadPanel = page.locator('[data-photo-version-upload-panel]');
      await expect(uploadPanel).toBeVisible();
      await expect(uploadPanel.getByText('版本上傳目前未開放。')).toBeVisible();
      await expect(uploadPanel.locator('input[type="file"]')).toHaveCount(0);
      await expect(
        uploadPanel.getByRole('button', {
          name: /建立版本工作並上傳|接續同一版本工作/,
        }),
      ).toHaveCount(0);
      await expect
        .poll(() => disabled.observations.capabilityReads.length)
        .toBeGreaterThan(0);
      assert.deepEqual(disabled.observations.capabilityReads[0]?.responseBody, {
        enabled: false,
      });
      await assertMobileWidth(page, 'Disabled version upload panel');
    } finally {
      await disabled.close();
    }

    const enabled = await makeOwnerBrowser({
      browser,
      worker,
      base,
      ownerCookie,
      actorId: owner,
      storage,
      db,
    });
    try {
      const page = enabled.page;
      await openPhoto({
        page,
        base,
        projectId: baseline.projectId,
        projectName: baseline.projectName,
        albumName: baseline.albumName,
        filename: baseline.originalFilename,
      });
      const uploadPanel = page.locator('[data-photo-version-upload-panel]');
      await expect(uploadPanel).toBeVisible();
      await expect(
        uploadPanel.getByRole('heading', { name: '建立照片版本' }),
      ).toBeVisible();
      await expect
        .poll(() => enabled.observations.capabilityReads.length)
        .toBeGreaterThan(0);
      assert.equal(
        enabled.observations.capabilityReads[0]?.responseBody?.enabled,
        true,
      );

      const operation = uploadPanel.getByLabel('版本操作', { exact: true });
      await expect(operation).toHaveValue('new_retouch');
      await expect(operation.locator('option')).toHaveCount(2);
      await operation.selectOption('replace_current');
      const replacementConfirm =
        '我確認這是取代目前照片版本的明確操作，並了解舊版本會保留且不會自動成為目前版本。';
      const confirmation = uploadPanel.getByLabel(replacementConfirm, {
        exact: true,
      });
      await expect(confirmation).toBeVisible();
      await confirmation.check();
      await uploadPanel
        .getByLabel('版本說明', { exact: true })
        .fill('Browser acceptance replacement');
      await uploadPanel
        .getByLabel('標籤（每行或逗號分隔，最多 16 個）', { exact: true })
        .fill('browser,acceptance');

      const original = pngFixture();
      const fileInput = uploadPanel.getByLabel('原始照片', { exact: true });
      await fileInput.setInputFiles({
        name: 'version-upload-browser-v2.png',
        mimeType: 'image/png',
        buffer: original,
      });
      await expect(uploadPanel.getByText(/照片檢查完成/)).toBeVisible();
      const submit = uploadPanel.getByRole('button', {
        name: '建立版本工作並上傳',
        exact: true,
      });
      await expect(submit).toBeEnabled();
      enabled.dropNextSuccessfulCompletionResponse();
      await submit.click();
      await expect
        .poll(() =>
          enabled.observations.completionRequests.some(
            (record) => record.dropped,
          ),
        )
        .toBe(true);
      await expect(
        uploadPanel.getByText(/工作編號與請求內容已保留/),
      ).toBeVisible();

      const journal = await page.evaluate(() =>
        Object.entries(localStorage).filter(([key]) =>
          key.startsWith('kino-pic:version-upload-journal:v1:'),
        ),
      );
      assert.equal(journal.length, 1);
      const envelope = JSON.parse(journal[0][1]);
      assert.equal(envelope.items.length, 1);
      const savedItem = envelope.items[0];
      assert.ok(savedItem?.uploadSessionId);
      assert.ok(savedItem?.authorizeBody?.requestId);
      assert.ok(savedItem?.completeBody?.requestId);
      const forbiddenJournalValues =
        /https?:|blob:|previewUrl|cookie|authorization|objectKey|signedUrl/i;
      assert.equal(forbiddenJournalValues.test(journal[0][1]), false);

      const initRequest = enabled.observations.initRequests[0];
      assert.ok(initRequest);
      const initBodyText = initRequest.requestBody;
      const initBody = JSON.parse(initBodyText);
      assert.equal(initRequest.status, 201);
      assert.equal(initBody.originalFilename, 'version-upload-browser-v2.png');
      assert.equal(initBody.expectedCurrentVersionId, baseline.version1Id);
      assert.equal(initBody.expectedRevision, 0);
      assert.equal(initBody.changeType, 'replace_current');
      assert.equal(initBody.changeNote, 'Browser acceptance replacement');
      assert.deepEqual(initBody.labels, ['browser', 'acceptance']);
      assert.equal(initBody.confirm, true);
      assert.equal(Object.hasOwn(initBody, 'photoId'), false);
      const initResponse = initRequest.responseBody;
      const uploadSessionId = initResponse?.uploadSession?.id;
      assert.ok(uploadSessionId);
      assert.equal(savedItem.uploadSessionId, uploadSessionId);
      assert.equal(savedItem.initBody.requestId, initBody.requestId);

      assert.equal(enabled.observations.authorizeRequests.length, 1);
      assert.equal(enabled.putCount(), 1);
      const completedRequests = enabled.observations.completionRequests;
      assert.equal(completedRequests.length, 2);
      assert.equal(completedRequests[0]?.status, 409);
      assert.equal(completedRequests[1]?.status, 200);
      assert.equal(completedRequests[1]?.dropped, true);
      const exactCompleteBody = completedRequests[1]?.requestBody;
      assert.ok(exactCompleteBody);
      assert.deepEqual(JSON.parse(exactCompleteBody), savedItem.completeBody);

      await page.reload({ waitUntil: 'domcontentloaded' });
      const restoredDialog = await openPhoto({
        page,
        base,
        projectId: baseline.projectId,
        projectName: baseline.projectName,
        albumName: baseline.albumName,
        filename: baseline.originalFilename,
      });
      const restoredPanel = page.locator('[data-photo-version-upload-panel]');
      await expect(
        restoredPanel.getByText('接續已保存的版本工作'),
      ).toBeVisible();
      await restoredPanel
        .getByLabel('原始照片', { exact: true })
        .setInputFiles({
          name: 'version-upload-browser-v2.png',
          mimeType: 'image/png',
          buffer: original,
        });
      await expect(
        restoredPanel.getByText(/原檔大小、格式、雜湊及尺寸均符合/),
      ).toBeVisible();
      await restoredPanel
        .getByRole('button', { name: '接續同一版本工作', exact: true })
        .click();
      await expect
        .poll(() => enabled.observations.completionRequests.length)
        .toBe(3);
      await expect
        .poll(() => enabled.observations.completionRequests[2]?.status)
        .toBe(200);
      const replay = enabled.observations.completionRequests[2];
      assert.ok(replay);
      assert.equal(replay.requestBody, exactCompleteBody);
      assert.equal(replay.dropped, false);
      assert.ok(
        enabled.observations.recoveryReads.some((record) =>
          record.search.includes('requestId=' + initBody.requestId),
        ),
      );

      await expect(page.getByText(/版本已建立並送入背景處理/)).toBeVisible();
      await expect(restoredDialog).toBeVisible();
      await expect(
        restoredPanel.getByRole('button', {
          name: '接續同一版本工作',
          exact: true,
        }),
      ).toHaveCount(0);

      const actualHead = await db
        .prepare(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
        )
        .bind(baseline.photoId)
        .first();
      assert.deepEqual(actualHead, {
        version_id: baseline.version1Id,
        revision: 0,
      });
      const versionUploadTarget = await db
        .prepare(
          'SELECT upload_session_id FROM upload_version_targets WHERE upload_session_id=?',
        )
        .bind(uploadSessionId)
        .first();
      assert.ok(versionUploadTarget?.upload_session_id);
      const v2 = await assertPrivateV2AndV1Head({
        db,
        photoId: baseline.photoId,
        version1Id: baseline.version1Id,
        uploadSessionId,
      });
      assert.equal(v2?.status, 'private');
      const objectRow = await db
        .prepare(
          "SELECT object_key FROM photo_assets WHERE version_id=? AND asset_kind='original'",
        )
        .bind(v2.id)
        .first();
      assert.ok(objectRow?.object_key);
      const storedObject = await storage.get(objectRow.object_key);
      assert.ok(storedObject);
      assert.deepEqual(Buffer.from(await storedObject.arrayBuffer()), original);
      await assertMobileWidth(page, 'Completed version upload panel');

      assert.equal(
        enabled.observations.initRequests.length,
        1,
        'The exact journal intent must not create another version reservation',
      );
      assert.equal(
        new Set(
          enabled.observations.initRequests.map(
            (record) => JSON.parse(record.requestBody).requestId,
          ),
        ).size,
        1,
      );
      assert.deepEqual(enabled.observations.bridgeErrors, []);
      assert.deepEqual(enabled.observations.pageErrors, []);
    } finally {
      await enabled.close();
    }
  } finally {
    await browser.close();
  }
}
