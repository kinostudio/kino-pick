import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AwsV4Signer } from 'aws4fetch';
import { chromium, expect } from '@playwright/test';
import { pngFixture } from './image-fixtures.mjs';

const accessKeyId = 'synthetic-resolved-batch-access-key';
const secretAccessKey = 'synthetic-test-secret-never-for-production';

function cookieHeader(value) {
  if (value.startsWith('kino-owner.session_token=')) return value;
  return 'kino-owner.session_token=' + value;
}

function cookieToken(value) {
  return cookieHeader(value).slice('kino-owner.session_token='.length);
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function ownerRequest(
  worker,
  base,
  ownerCookie,
  owner,
  method,
  path,
  body,
) {
  const headers = {
    Accept: 'application/json',
    Cookie: cookieHeader(ownerCookie),
    ...(method === 'GET'
      ? {}
      : {
          Origin: new URL(base).origin,
          'Content-Type': 'application/json',
        }),
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

async function readBatchCapabilities(worker, base, ownerCookie) {
  return worker.fetch(
    new Request(new URL('/api/v1/resolved-batch-uploads/capabilities', base), {
      headers: { Cookie: cookieHeader(ownerCookie) },
    }),
  );
}

async function createProjectAlbum({
  worker,
  base,
  ownerCookie,
  owner,
  workspaceId,
  label,
}) {
  const projectName = 'Resolved batch ' + label + ' ' + randomUUID();
  const projectCreated = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    'POST',
    '/api/v1/projects',
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

  const configured = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    'PUT',
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning',
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

  const albumName = 'Resolved batch album ' + label + ' ' + randomUUID();
  const albumCreated = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    'POST',
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/albums',
    { requestId: randomUUID(), name: albumName },
  );
  assert.equal(
    albumCreated.response.status,
    201,
    JSON.stringify(albumCreated.value),
  );
  const album = albumCreated.value?.album;
  assert.ok(album?.id);
  return { projectId: project.id, projectName, albumId: album.id, albumName };
}

async function readMatchingRules(worker, base, ownerCookie, owner, projectId) {
  const result = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    'GET',
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/matching-rules',
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.value));
  return result.value;
}

async function changeMatchingProfile({
  worker,
  base,
  ownerCookie,
  owner,
  projectId,
  profile,
}) {
  const current = await readMatchingRules(
    worker,
    base,
    ownerCookie,
    owner,
    projectId,
  );
  const result = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    'PUT',
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/matching-rules',
    {
      requestId: randomUUID(),
      expectedProjectRevision: current.projectRevision,
      expectedRuleRevision: current.ruleRevision,
      profile,
      confirm: true,
    },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.value));
  assert.equal(result.value?.profile, profile);
  return result.value;
}

async function createPngPath(name, bytes) {
  const directory = resolve('.local', 'm3i5b-' + randomUUID());
  await mkdir(directory);
  const path = resolve(directory, name);
  await writeFile(path, bytes);
  return path;
}

async function readAlbumCounts(db, actorId, albumId) {
  const count = async (sql, ...values) =>
    Number(
      (
        await db
          .prepare(sql)
          .bind(...values)
          .first()
      )?.n ?? 0,
    );
  return {
    photos: await count(
      'SELECT count(*) AS n FROM photos WHERE album_id=?',
      albumId,
    ),
    sessions: await count(
      'SELECT count(*) AS n FROM upload_sessions WHERE actor_id=? AND album_id=?',
      actorId,
      albumId,
    ),
    reservations: await count(
      "SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND album_id=? AND operation='upload.reserved'",
      actorId,
      albumId,
    ),
    uniqueReservations: await count(
      "SELECT count(DISTINCT request_id) AS n FROM upload_requests WHERE actor_id=? AND album_id=? AND operation='upload.reserved'",
      actorId,
      albumId,
    ),
    completions: await count(
      'SELECT count(*) AS n FROM upload_completions c JOIN upload_sessions s ON s.id=c.upload_session_id WHERE s.actor_id=? AND s.album_id=?',
      actorId,
      albumId,
    ),
    heads: await count(
      'SELECT count(*) AS n FROM photo_version_heads h JOIN photos p ON p.id=h.photo_id WHERE p.album_id=?',
      albumId,
    ),
  };
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

async function addOwnerCookie(context, base, value) {
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: cookieToken(value),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(base).protocol === 'https:',
    },
  ]);
}

async function openProject(page, base, fixture) {
  const response = await page.goto(
    base + '/dashboard/projects/' + encodeURIComponent(fixture.projectId),
    { waitUntil: 'networkidle' },
  );
  assert.equal(response?.status(), 200);
  await expect(
    page.getByRole('heading', { name: fixture.projectName, exact: true }),
  ).toBeVisible();
}

async function openAlbumUpload(page, base, fixture, enabled) {
  const albumCard = page.getByTestId('album-card-' + fixture.albumId);
  await expect(albumCard).toBeVisible();
  await albumCard
    .getByRole('button', {
      name: '上傳照片 ' + fixture.albumName,
      exact: true,
    })
    .click();
  if (enabled) {
    const panel = page.getByTestId('resolved-batch-upload');
    await expect(panel).toBeVisible();
    return panel;
  }
  const panel = page.getByTestId('resolved-upload');
  await expect(panel).toBeVisible();
  return panel;
}

async function enterBatchStage(panel, files) {
  await panel.getByTestId('resolved-batch-mode').click();
  await panel.getByTestId('resolved-batch-files').setInputFiles(files);
  await expect(
    panel.getByText(
      '已選取 ' + files.length + ' 張。建立工作後仍須明確按下開始。',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  const create = panel.getByTestId('resolved-batch-create');
  await expect(create).toBeEnabled();
  return create;
}
function classify(method, pathname) {
  if (method === 'GET' && pathname === '/api/v1/me') return 'identity';
  if (
    method === 'GET' &&
    pathname === '/api/v1/resolved-batch-uploads/capabilities'
  )
    return 'batch-capability';
  if (method === 'GET' && pathname === '/api/v1/upload-resolution/capabilities')
    return 'resolver-capability';
  if (
    method === 'POST' &&
    pathname.startsWith('/api/v1/albums/') &&
    pathname.endsWith('/upload-resolution')
  )
    return 'preview';
  if (
    method === 'POST' &&
    pathname.startsWith('/api/v1/albums/') &&
    pathname.endsWith('/resolved-uploads')
  )
    return 'reservation';
  if (
    method === 'POST' &&
    pathname.startsWith('/api/v1/uploads/') &&
    pathname.endsWith('/authorize')
  )
    return 'authorize';
  if (
    method === 'POST' &&
    pathname.startsWith('/api/v1/uploads/') &&
    pathname.endsWith('/complete')
  )
    return 'complete';
  return null;
}

function safeResponseSummary(kind, body) {
  if (!body || typeof body !== 'object') return null;
  if (body.error?.code) return { errorCode: body.error.code };
  if (kind === 'batch-capability')
    return {
      enabled: body.enabled,
      maxFiles: body.maxFiles,
      pageSize: body.pageSize,
    };
  if (kind === 'preview')
    return {
      mode: body.mode,
      outcome: body.decision?.outcome,
      reason: body.decision?.reason,
    };
  if (kind === 'reservation')
    return {
      uploadSessionId: body.uploadSession?.id ?? null,
      target: body.target ?? null,
    };
  if (kind === 'complete')
    return {
      uploadSessionId: body.uploadSessionId ?? null,
      photoId: body.photoId ?? body.photo?.id ?? null,
      versionId: body.versionId ?? body.version?.id ?? null,
    };
  return null;
}

async function makeBrowserClient({
  browser,
  worker,
  base,
  ownerCookie,
  owner,
  db,
  storage,
}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await addOwnerCookie(context, base, ownerCookie);
  const observations = {
    apiRequests: [],
    capabilityReads: [],
    previewRequests: [],
    reservationRequests: [],
    authorizeRequests: [],
    completionRequests: [],
    signedPuts: [],
    pageErrors: [],
    bridgeErrors: [],
    latchedAutomaticWrites: [],
    identityWasSpoofed: false,
  };
  let dropNextReservationResponse = false;
  let retryLatch = false;
  let manualRetryReleased = false;
  let spoofNextIdentity = false;
  let identityReadsBeforeSpoof = null;
  let nextPutHold = null;
  let contextClosed = false;

  await context.route('**/*', async (route) => {
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
      if (retryLatch && !manualRetryReleased && incoming.method() === 'PUT') {
        observations.latchedAutomaticWrites.push({
          method: 'PUT',
          pathname: '/r2-upload',
        });
        await route.abort('failed');
        return;
      }
      try {
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
        const reserved = await db
          .prepare(
            'SELECT u.original_filename,u.expected_bytes,p.content_type,p.sha256_hex FROM upload_sessions u JOIN upload_specs p ON p.upload_session_id=u.id WHERE u.object_key=?',
          )
          .bind(objectKey)
          .first();
        assert.ok(reserved, 'The signed object key must have a reservation');
        assert.equal(reserved.expected_bytes, bytes.byteLength);
        assert.equal(reserved.content_type, headers['content-type']);
        assert.equal(reserved.sha256_hex, sha256(bytes));

        if (nextPutHold) {
          const hold = nextPutHold;
          nextPutHold = null;
          hold.seenResolve({ filename: reserved.original_filename });
          await hold.gate;
        }

        const stored = await storage.put(objectKey, new Uint8Array(bytes), {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: headers['content-type'] },
          sha256: Buffer.from(checksum, 'base64'),
        });
        assert.ok(
          stored,
          'The signed browser PUT must store one private original',
        );
        observations.signedPuts.push(reserved.original_filename);
        await route.fulfill({
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': new URL(base).origin,
            'Access-Control-Expose-Headers': 'ETag',
          },
          body: '',
        });
      } catch (error) {
        observations.bridgeErrors.push(
          error instanceof Error ? error.message : String(error),
        );
        await route.abort('failed');
      }
      return;
    }

    const method = incoming.method();
    const pathname = url.pathname;
    const kind = classify(method, pathname);
    const isApi = pathname.startsWith('/api/');
    const requestBody = incoming.postData() ?? '';
    const record = {
      method,
      pathname,
      search: url.search,
      requestBody,
      status: 0,
      responseSummary: null,
      dropped: false,
      identitySpoofed: false,
    };

    if (
      isApi &&
      kind &&
      ['preview', 'reservation', 'authorize', 'complete'].includes(kind)
    ) {
      const headers = await incoming.allHeaders();
      if (headers['x-kino-expected-actor'] !== owner) {
        observations.bridgeErrors.push(
          'Expected Owner header missing on ' + kind,
        );
        await route.abort('failed');
        return;
      }
    }

    if (
      isApi &&
      retryLatch &&
      !manualRetryReleased &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ) {
      observations.latchedAutomaticWrites.push({ method, pathname });
      await route.abort('failed');
      return;
    }

    let response;
    try {
      if (
        isApi &&
        kind === 'identity' &&
        (spoofNextIdentity || identityReadsBeforeSpoof === 0)
      ) {
        spoofNextIdentity = false;
        identityReadsBeforeSpoof = null;
        record.identitySpoofed = true;
        observations.identityWasSpoofed = true;
        response = Response.json({
          actor: { id: randomUUID() },
          role: 'owner',
          sessionId: 'synthetic-foreign-session',
        });
      } else {
        if (isApi && kind === 'identity' && identityReadsBeforeSpoof !== null)
          identityReadsBeforeSpoof -= 1;
        const headers = await incoming.allHeaders();
        headers['cf-connecting-ip'] = '198.51.100.97';
        const init = { method, headers, redirect: 'manual' };
        if (method !== 'GET' && method !== 'HEAD')
          init.body = incoming.postDataBuffer() ?? undefined;
        response = await worker.fetch(new Request(incoming.url(), init));
      }
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
    record.responseSummary = safeResponseSummary(
      kind,
      parseJson(responseBytes),
    );
    if (isApi) observations.apiRequests.push(record);
    if (kind === 'batch-capability') observations.capabilityReads.push(record);
    if (kind === 'preview') observations.previewRequests.push(record);
    if (kind === 'reservation') observations.reservationRequests.push(record);
    if (kind === 'authorize') observations.authorizeRequests.push(record);
    if (kind === 'complete') observations.completionRequests.push(record);

    if (
      kind === 'reservation' &&
      response.status === 201 &&
      dropNextReservationResponse
    ) {
      dropNextReservationResponse = false;
      retryLatch = true;
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
    newPage() {
      const page = context.newPage();
      return page.then((resolved) => {
        resolved.on('pageerror', (error) =>
          observations.pageErrors.push(error.message),
        );
        return resolved;
      });
    },
    observations,
    dropNextReservationResponse() {
      dropNextReservationResponse = true;
    },
    releaseManualRetry() {
      manualRetryReleased = true;
    },
    spoofNextIdentity() {
      spoofNextIdentity = true;
    },
    spoofIdentityAfterReads(readsBeforeSpoof) {
      if (!Number.isSafeInteger(readsBeforeSpoof) || readsBeforeSpoof < 0)
        throw new RangeError('readsBeforeSpoof must be a nonnegative integer');
      identityReadsBeforeSpoof = readsBeforeSpoof;
    },
    holdNextR2Put() {
      let seenResolve;
      let releaseResolve;
      const seen = new Promise((resolve) => {
        seenResolve = resolve;
      });
      const gate = new Promise((resolve) => {
        releaseResolve = resolve;
      });
      nextPutHold = { seenResolve, gate, releaseResolve };
      return { seen, release: () => releaseResolve() };
    },
    async close() {
      if (contextClosed) return;
      contextClosed = true;
      if (nextPutHold) {
        const hold = nextPutHold;
        nextPutHold = null;
        hold.seenResolve({ filename: 'closed' });
        hold.releaseResolve();
      }
      await context.close();
    },
  };
}

async function readBatchPointers(page) {
  return page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.endsWith(':batch:v1'))
      .map(([key, value]) => ({ key, value })),
  );
}

async function readBatchStoreCounts(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('kino-pic-resolved-batch-journal');
        request.onerror = () =>
          reject(request.error ?? new Error('IDB open failed'));
        request.onsuccess = () => {
          const database = request.result;
          if (
            !database.objectStoreNames.contains('manifests') ||
            !database.objectStoreNames.contains('items')
          ) {
            database.close();
            reject(new Error('Resolved batch stores are missing'));
            return;
          }
          const transaction = database.transaction(
            ['manifests', 'items'],
            'readonly',
          );
          const manifests = transaction.objectStore('manifests').count();
          const items = transaction.objectStore('items').count();
          transaction.oncomplete = () => {
            const result = {
              manifests: manifests.result,
              items: items.result,
            };
            database.close();
            resolve(result);
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error ?? new Error('IDB count failed'));
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error('IDB count aborted'));
          };
        };
      }),
    undefined,
  );
}

function requestIds(records) {
  return records.map((record) => JSON.parse(record.requestBody).requestId);
}

async function assertNoUploadWrites(observations, label) {
  assert.equal(
    observations.previewRequests.length,
    0,
    label + ' preview count',
  );
  assert.equal(
    observations.reservationRequests.length,
    0,
    label + ' reservation count',
  );
  assert.equal(
    observations.authorizeRequests.length,
    0,
    label + ' authorize count',
  );
  assert.equal(
    observations.completionRequests.length,
    0,
    label + ' completion count',
  );
  assert.equal(observations.signedPuts.length, 0, label + ' signed PUT count');
}

async function runResolvedBatchUploadBrowserChecks({
  enabledWorker,
  defaultWorker,
  base,
  ownerCookie,
  owner,
  db,
  storage,
  galleryFixture,
}) {
  assert.ok(enabledWorker);
  assert.ok(defaultWorker);
  assert.ok(base);
  assert.ok(ownerCookie);
  assert.ok(owner);
  assert.ok(db);
  assert.ok(storage);
  assert.ok(galleryFixture?.context?.workspace?.id);
  const browser = await chromium.launch({ headless: true });
  const clients = [];
  const result = {
    gateOffKeepsSingleWidget: false,
    pointerRaceSingleQueue: false,
    threeFileBatchCompleted: false,
    capturedReplayAfterPolicyChange: false,
    staleAdmissionBlocked: false,
    mismatchedIdentityBlocked: false,
  };
  try {
    const noSession = await defaultWorker.fetch(
      new Request(new URL('/api/v1/resolved-batch-uploads/capabilities', base)),
    );
    assert.equal(noSession.status, 401);

    const disabled = await readBatchCapabilities(
      defaultWorker,
      base,
      ownerCookie,
    );
    assert.equal(disabled.status, 200);
    assert.deepEqual(await disabled.json(), {
      enabled: false,
      maxFiles: 1000,
      pageSize: 24,
    });
    const enabled = await readBatchCapabilities(
      enabledWorker,
      base,
      ownerCookie,
    );
    assert.equal(enabled.status, 200);
    assert.deepEqual(await enabled.json(), {
      enabled: true,
      maxFiles: 1000,
      pageSize: 24,
    });

    const singleFixture = await createProjectAlbum({
      worker: defaultWorker,
      base,
      ownerCookie,
      owner,
      workspaceId: galleryFixture.context.workspace.id,
      label: 'single-gate-off',
    });
    const singleClient = await makeBrowserClient({
      browser,
      worker: defaultWorker,
      base,
      ownerCookie,
      owner,
      db,
      storage,
    });
    clients.push(singleClient);
    const singlePage = await singleClient.newPage();
    await openProject(singlePage, base, singleFixture);
    const singlePanel = await openAlbumUpload(
      singlePage,
      base,
      singleFixture,
      false,
    );
    await expect(singlePanel.getByTestId('resolved-upload-file')).toBeVisible();
    await expect(singlePage.getByTestId('resolved-batch-mode')).toHaveCount(0);
    await assertMobileWidth(singlePage, 'Batch gate off legacy single widget');
    result.gateOffKeepsSingleWidget = true;
    await singleClient.close();

    const fixture = await createProjectAlbum({
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      workspaceId: galleryFixture.context.workspace.id,
      label: 'three-file',
    });
    const before = await readAlbumCounts(db, owner, fixture.albumId);
    const client = await makeBrowserClient({
      browser,
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      db,
      storage,
    });
    clients.push(client);
    const pageA = await client.newPage();
    const pageB = await client.newPage();
    await Promise.all([
      openProject(pageA, base, fixture),
      openProject(pageB, base, fixture),
    ]);
    const panelA = await openAlbumUpload(pageA, base, fixture, true);
    const panelB = await openAlbumUpload(pageB, base, fixture, true);
    const names = [
      'batch-three-a.png',
      'batch-three-b.png',
      'batch-three-c.png',
    ];
    const bytes = pngFixture();
    const files = await Promise.all(
      names.map((name) => createPngPath(name, bytes)),
    );
    const createA = await enterBatchStage(panelA, files);
    const createB = await enterBatchStage(panelB, files);
    assert.deepEqual(await readAlbumCounts(db, owner, fixture.albumId), before);
    await assertNoUploadWrites(
      client.observations,
      'Selecting files must not create uploads',
    );

    await createA.click();
    await expect(panelA.getByTestId('resolved-batch-start')).toBeVisible();
    const pointerBeforeStaleCreate = await readBatchPointers(pageA);
    assert.equal(pointerBeforeStaleCreate.length, 1);
    const storeAfterCreateA = await readBatchStoreCounts(pageA);
    assert.deepEqual(storeAfterCreateA, { manifests: 1, items: 3 });

    await createB.click();
    await expect(
      panelB.getByText('批次記錄已在另一個分頁更新。請重新載入。', {
        exact: true,
      }),
    ).toBeVisible();
    const pointerAfterStaleCreate = await readBatchPointers(pageA);
    assert.deepEqual(pointerAfterStaleCreate, pointerBeforeStaleCreate);
    const storeAfterCreateB = await readBatchStoreCounts(pageA);
    assert.deepEqual(
      storeAfterCreateB,
      { manifests: 1, items: 3 },
      'A stale page must not create or replace a second queue',
    );
    assert.deepEqual(await readAlbumCounts(db, owner, fixture.albumId), before);
    await assertNoUploadWrites(
      client.observations,
      'Saving the batch list must not start uploads',
    );
    result.pointerRaceSingleQueue = true;

    const putHold = client.holdNextR2Put();
    await panelA.getByTestId('resolved-batch-start').click();
    const heldPut = await putHold.seen;
    assert.equal(heldPut.filename, names[0]);
    await expect(
      panelA.getByTestId('resolved-batch-active-upload'),
    ).toContainText('正在處理第 1 張：' + names[0]);
    assert.equal(client.observations.signedPuts.length, 0);
    assert.equal(client.observations.previewRequests.length, 1);
    assert.equal(client.observations.reservationRequests.length, 1);
    assert.equal(client.observations.authorizeRequests.length, 1);
    // The existing upload protocol reconciles completion before authorization
    // and again before PUT; both probes must retain the same immutable intent.
    const completionProbes = client.observations.completionRequests;
    assert.equal(completionProbes.length, 2);
    assert.equal(new Set(requestIds(completionProbes)).size, 1);
    assert.equal(
      new Set(completionProbes.map((record) => record.requestBody)).size,
      1,
    );

    const heldCounts = await readAlbumCounts(db, owner, fixture.albumId);
    for (const field of ['photos', 'completions', 'heads'])
      assert.equal(
        heldCounts[field],
        before[field],
        field + ' must remain unchanged before PUT',
      );
    assert.equal(heldCounts.sessions, before.sessions + 1);
    assert.equal(heldCounts.reservations, before.reservations + 1);
    assert.equal(heldCounts.uniqueReservations, before.uniqueReservations + 1);
    const heldSession = await db
      .prepare(
        'SELECT object_key FROM upload_sessions WHERE actor_id=? AND album_id=?',
      )
      .bind(owner, fixture.albumId)
      .first();
    assert.ok(heldSession);
    assert.equal(await storage.head(heldSession.object_key), null);

    await assertMobileWidth(pageA, 'Active three-file batch');
    putHold.release();

    await expect.poll(() => client.observations.signedPuts.length).toBe(3);
    await expect
      .poll(
        () =>
          client.observations.completionRequests.filter(
            (record) => record.status === 200,
          ).length,
      )
      .toBe(3);
    await expect(
      panelA
        .locator('[data-testid="resolved-batch-item"]')
        .filter({ hasText: '已完成' }),
    ).toHaveCount(3);
    assert.equal(client.observations.previewRequests.length, 3);
    assert.equal(
      client.observations.reservationRequests.filter(
        (record) => record.status === 201,
      ).length,
      3,
    );
    assert.equal(client.observations.authorizeRequests.length, 3);
    assert.equal(
      new Set(requestIds(client.observations.reservationRequests)).size,
      3,
    );
    assert.equal(
      new Set(requestIds(client.observations.authorizeRequests)).size,
      3,
    );
    assert.equal(
      new Set(requestIds(client.observations.completionRequests)).size,
      3,
    );
    assert.deepEqual(client.observations.signedPuts, names);
    assert.equal(client.observations.bridgeErrors.length, 0);
    assert.deepEqual(await readAlbumCounts(db, owner, fixture.albumId), {
      photos: 3,
      sessions: 3,
      reservations: 3,
      uniqueReservations: 3,
      completions: 3,
      heads: 3,
    });
    await assertMobileWidth(pageA, 'Completed three-file batch');
    result.threeFileBatchCompleted = true;
    await client.close();

    const replayFixture = await createProjectAlbum({
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      workspaceId: galleryFixture.context.workspace.id,
      label: 'captured-replay',
    });
    const replayClient = await makeBrowserClient({
      browser,
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      db,
      storage,
    });
    clients.push(replayClient);
    const replayPage = await replayClient.newPage();
    await openProject(replayPage, base, replayFixture);
    const replayPanel = await openAlbumUpload(
      replayPage,
      base,
      replayFixture,
      true,
    );
    const replayBytes = pngFixture();
    const replayFile = await createPngPath('batch-replay.png', replayBytes);
    const createReplay = await enterBatchStage(replayPanel, [replayFile]);
    await createReplay.click();
    await expect(replayPanel.getByTestId('resolved-batch-start')).toBeVisible();
    await assertNoUploadWrites(
      replayClient.observations,
      'Captured recovery fixture before Start',
    );

    replayClient.dropNextReservationResponse();
    await replayPanel.getByTestId('resolved-batch-start').click();
    await expect
      .poll(() =>
        replayClient.observations.reservationRequests.some(
          (record) => record.dropped,
        ),
      )
      .toBe(true);
    await expect(
      replayPanel
        .locator('[data-testid="resolved-batch-item"]')
        .filter({ hasText: '已保存原請求，等待接續' }),
    ).toBeVisible();
    const droppedReservation =
      replayClient.observations.reservationRequests.find(
        (record) => record.dropped,
      );
    assert.ok(droppedReservation);
    assert.equal(droppedReservation.status, 201);
    const capturedBody = JSON.parse(droppedReservation.requestBody);
    const acceptedSessionId =
      droppedReservation.responseSummary?.uploadSessionId;
    assert.ok(capturedBody.requestId);
    assert.ok(acceptedSessionId);
    assert.equal(replayClient.observations.latchedAutomaticWrites.length, 0);
    assert.equal(replayClient.observations.authorizeRequests.length, 0);
    assert.equal(replayClient.observations.signedPuts.length, 0);

    const changedRules = await changeMatchingProfile({
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      projectId: replayFixture.projectId,
      profile: 'rules-v1-001',
    });
    assert.equal(changedRules.profile, 'rules-v1-001');

    await replayPage.reload({ waitUntil: 'networkidle' });
    await openProject(replayPage, base, replayFixture);
    const restoredPanel = await openAlbumUpload(
      replayPage,
      base,
      replayFixture,
      true,
    );
    await expect(
      restoredPanel.getByTestId('resolved-batch-reselect'),
    ).toBeVisible();
    await restoredPanel
      .getByTestId('resolved-batch-reselect')
      .setInputFiles(replayFile);
    await expect(
      restoredPanel.getByText('已逐一比對批次原檔。尚未送出上傳工作。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      restoredPanel.getByTestId('resolved-batch-start'),
    ).toBeEnabled();
    assert.equal(replayClient.observations.latchedAutomaticWrites.length, 0);
    assert.equal(replayClient.observations.reservationRequests.length, 1);

    replayClient.releaseManualRetry();
    await restoredPanel.getByTestId('resolved-batch-start').click();
    await expect
      .poll(() => replayClient.observations.reservationRequests.length)
      .toBe(2);
    const replayedReservation =
      replayClient.observations.reservationRequests[1];
    assert.ok(replayedReservation);
    assert.equal(replayedReservation.status, 201);
    assert.deepEqual(
      JSON.parse(replayedReservation.requestBody),
      capturedBody,
      'Manual continuation must replay the exact accepted request body and UUID',
    );
    assert.equal(
      replayedReservation.responseSummary?.uploadSessionId,
      acceptedSessionId,
    );
    await expect
      .poll(() => replayClient.observations.signedPuts.length)
      .toBe(1);
    await expect
      .poll(
        () =>
          replayClient.observations.completionRequests.filter(
            (record) => record.status === 200,
          ).length,
      )
      .toBe(1);
    await expect(
      restoredPanel
        .locator('[data-testid="resolved-batch-item"]')
        .filter({ hasText: '已完成' }),
    ).toHaveCount(1);
    assert.equal(replayClient.observations.latchedAutomaticWrites.length, 0);
    assert.equal(replayClient.observations.bridgeErrors.length, 0);
    assert.deepEqual(await readAlbumCounts(db, owner, replayFixture.albumId), {
      photos: 1,
      sessions: 1,
      reservations: 1,
      uniqueReservations: 1,
      completions: 1,
      heads: 1,
    });
    await assertMobileWidth(replayPage, 'Reloaded captured batch continuation');
    result.capturedReplayAfterPolicyChange = true;

    const staleFixture = await createProjectAlbum({
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      workspaceId: galleryFixture.context.workspace.id,
      label: 'stale-policy',
    });
    const staleBefore = await readAlbumCounts(db, owner, staleFixture.albumId);
    const staleClient = await makeBrowserClient({
      browser,
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      db,
      storage,
    });
    clients.push(staleClient);
    const stalePage = await staleClient.newPage();
    await openProject(stalePage, base, staleFixture);
    const stalePanel = await openAlbumUpload(
      stalePage,
      base,
      staleFixture,
      true,
    );
    const staleFile = await createPngPath(
      'batch-stale-policy.png',
      pngFixture(),
    );
    const createStale = await enterBatchStage(stalePanel, [staleFile]);
    await createStale.click();
    await expect(stalePanel.getByTestId('resolved-batch-start')).toBeVisible();
    await assertNoUploadWrites(
      staleClient.observations,
      'Unstarted policy fixture',
    );
    await changeMatchingProfile({
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      projectId: staleFixture.projectId,
      profile: 'rules-v1-010',
    });
    await stalePanel.getByTestId('resolved-batch-start').click();
    await expect(
      stalePanel.getByText(
        '規則已變更，尚未開始的新工作已暫停；已保存的原請求仍保留。',
        { exact: true },
      ),
    ).toBeVisible();
    await assertNoUploadWrites(
      staleClient.observations,
      'Stale policy must stop unstarted admission',
    );
    assert.deepEqual(
      await readAlbumCounts(db, owner, staleFixture.albumId),
      staleBefore,
    );
    result.staleAdmissionBlocked = true;

    const identityFixture = await createProjectAlbum({
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      workspaceId: galleryFixture.context.workspace.id,
      label: 'identity-mismatch',
    });
    const identityBefore = await readAlbumCounts(
      db,
      owner,
      identityFixture.albumId,
    );
    const identityClient = await makeBrowserClient({
      browser,
      worker: enabledWorker,
      base,
      ownerCookie,
      owner,
      db,
      storage,
    });
    clients.push(identityClient);
    const identityPage = await identityClient.newPage();
    await openProject(identityPage, base, identityFixture);
    const identityPanel = await openAlbumUpload(
      identityPage,
      base,
      identityFixture,
      true,
    );
    const identityFilename = 'batch-identity-lost.png';
    const identityFile = await createPngPath(identityFilename, pngFixture());
    const createIdentityBatch = await enterBatchStage(identityPanel, [
      identityFile,
    ]);
    await createIdentityBatch.click();
    await expect(
      identityPanel.getByTestId('resolved-batch-start'),
    ).toBeVisible();
    const previousIdentityRow = identityPanel
      .locator('[data-testid="resolved-batch-item"]')
      .filter({ hasText: identityFilename });
    await expect(previousIdentityRow).toBeVisible();
    await assertNoUploadWrites(
      identityClient.observations,
      'Saving identity fixture metadata must not start uploads',
    );

    // The start preflight remains valid; the child's approved-session check
    // sees the changed Owner and must make the parent hide its cached rows.
    identityClient.spoofIdentityAfterReads(1);
    await identityPanel.getByTestId('resolved-batch-start').click();
    await expect
      .poll(() => identityClient.observations.identityWasSpoofed)
      .toBe(true);
    await expect(previousIdentityRow).toHaveCount(0);
    await assertNoUploadWrites(
      identityClient.observations,
      'Mismatched Owner identity must stop batch admission',
    );
    assert.equal(identityClient.observations.identityWasSpoofed, true);
    assert.equal((await readBatchPointers(identityPage)).length, 1);
    assert.deepEqual(
      await readAlbumCounts(db, owner, identityFixture.albumId),
      identityBefore,
    );
    await assertMobileWidth(identityPage, 'Mismatched Owner identity');
    result.mismatchedIdentityBlocked = true;

    assert.equal(
      clients.every((client) => client.observations.bridgeErrors.length === 0),
      true,
      'Browser proxy bridge must not hide runtime failures',
    );
    return result;
  } finally {
    for (const client of clients) await client.close();
    await browser.close();
  }
}

export { runResolvedBatchUploadBrowserChecks };
