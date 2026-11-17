import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import sharp from 'sharp';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';

const base = 'http://127.0.0.1:8799';
const ownerId = randomUUID();
const sessionId = randomUUID();
const sessionToken = randomUUID();
const authSecret = 'browser-processing-native-test-secret-long-enough';
const profile = 'browser-first-jpeg-82-v1';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_COMMENTS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  PHOTO_VERSION_UPLOADS_ENABLED: 'true',
  CLOUDFLARE_IMAGE_PROCESSING_ENABLED: 'true',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-browser-processing-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-browser-processing-secret-only',
  R2_BUCKET_NAME: 'browser-processing-native-private',
  BETTER_AUTH_SECRET: authSecret,
  GOOGLE_CLIENT_ID: 'local-google',
  GOOGLE_CLIENT_SECRET: 'fixture',
  GITHUB_CLIENT_ID: 'local-github',
  GITHUB_CLIENT_SECRET: 'fixture',
};

let stage = 'initialize';
let groups = 0;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function workerOptions() {
  return {
    name: 'app',
    modules: true,
    scriptPath: resolve('.build/index.js'),
    compatibilityDate: '2026-10-23',
    compatibilityFlags: ['nodejs_compat'],
    outboundService: async () =>
      new Response('Outbound blocked', { status: 503 }),
    bindings,
    d1Databases: { DB: 'browser-processing-native' },
    r2Buckets: { PRIMARY_STORAGE: 'browser-processing-native' },
    images: { binding: 'IMAGES' },
    assets: {
      directory: resolve('.static'),
      binding: 'ASSETS',
      run_worker_first: true,
      routerConfig: {
        has_user_worker: true,
        invoke_user_worker_ahead_of_assets: true,
      },
    },
  };
}

function ownerHeaders({
  origin = base,
  cookie = ownerCookie,
  actor = ownerId,
  session = sessionId,
} = {}) {
  return {
    Cookie: cookie,
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': actor,
    'X-Kino-Expected-Session': session,
  };
}

function browserHeaders(options = {}) {
  const headers = ownerHeaders(options);
  delete headers['Content-Type'];
  return headers;
}

const ownerCookie =
  'kino-owner.session_token=' +
  encodeURIComponent(
    sessionToken + '.' + (await makeSignature(sessionToken, authSecret)),
  );

async function expectJson(response, status, label) {
  let value;
  try {
    value = await response.json();
  } catch {
    const error = new Error(
      `${label}: expected JSON, received HTTP ${response.status} (${response.headers.get('content-type') ?? 'no content type'})`,
    );
    error.name = 'NativeResponseError';
    error.code = 'NATIVE_RESPONSE_INVALID';
    throw error;
  }
  assert.equal(
    response.status,
    status,
    `${label}: ${JSON.stringify({ code: value?.error?.code, status: response.status })}`,
  );
  return value;
}

async function expectStatus(response, status, label) {
  assert.equal(response.status, status, `${label}: HTTP ${response.status}`);
  await response.body?.cancel();
}

function appendDerivative(form, name, bytes) {
  form.append(name, new Blob([bytes], { type: 'image/jpeg' }), `${name}.jpg`);
}

function derivativeForm(sourceHash, thumbnail, preview) {
  const form = new FormData();
  form.append('sourceSha256', sourceHash);
  appendDerivative(form, 'thumbnail', thumbnail);
  appendDerivative(form, 'preview', preview);
  return form;
}

async function multipartRequest(mf, path, headers, form) {
  const encoded = new Request(new URL(path, base), {
    method: 'POST',
    headers,
    body: form,
  });
  return mf.dispatchFetch(encoded.url, {
    method: 'POST',
    headers: Object.fromEntries(encoded.headers),
    body: await encoded.arrayBuffer(),
  });
}

async function derivativeJpegs(source) {
  const [thumbnail, preview] = await Promise.all([
    sharp(source)
      .resize({
        width: 320,
        height: 320,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer(),
    sharp(source)
      .resize({
        width: 2048,
        height: 2048,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer(),
  ]);
  return { thumbnail, preview };
}

async function waitForJob(db, jobId, terminal = false) {
  const deadline = Date.now() + 12_000;
  let row;
  do {
    row = await db
      .prepare(
        'SELECT recipe,status,reason_code FROM image_processing_jobs WHERE id=?',
      )
      .bind(jobId)
      .first();
    if (
      row &&
      (!terminal ||
        ['succeeded', 'failed', 'unsupported', 'needs_review'].includes(
          row.status,
        ))
    )
      return row;
    await sleep(25);
  } while (Date.now() < deadline);
  return row;
}

async function derivativeAssetRows(db, versionId) {
  return (
    await db
      .prepare(
        `SELECT asset_kind,state,mime,byte_size,checksum_sha256,object_key
         FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview')
         ORDER BY asset_kind`,
      )
      .bind(versionId)
      .all()
  ).results;
}

async function createBrowserUpload({
  request,
  db,
  storage,
  fixture,
  source,
  filename,
  preferBrowser = true,
}) {
  const sourceHash = sha256(source);
  const init = await expectJson(
    await request('/api/v1/uploads/init', {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({
        requestId: randomUUID(),
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        albumId: fixture.albumId,
        originalFilename: filename,
        expectedBytes: source.byteLength,
        contentType: 'image/jpeg',
        sha256: sourceHash,
      }),
    }),
    201,
    'upload init',
  );
  const uploadId = init.uploadSession.id;
  await expectJson(
    await request(`/api/v1/uploads/${uploadId}/authorize`, {
      method: 'POST',
      headers: ownerHeaders(),
      body: JSON.stringify({ requestId: randomUUID() }),
    }),
    200,
    'upload authorize',
  );
  const upload = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=? AND actor_id=?')
    .bind(uploadId, ownerId)
    .first();
  assert.ok(upload?.object_key, 'authorized upload has a private R2 key');
  const put = await storage.put(upload.object_key, new Uint8Array(source), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/jpeg' },
    sha256: Buffer.from(sourceHash, 'hex'),
  });
  assert.ok(put, 'original bytes were written to the test R2 binding');

  const completionHeaders = ownerHeaders();
  if (preferBrowser) completionHeaders['X-Kino-Browser-Processing'] = '1';
  const completed = await expectJson(
    await request(`/api/v1/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: completionHeaders,
      body: JSON.stringify({ requestId: randomUUID() }),
    }),
    200,
    'upload complete',
  );
  const witness = await db
    .prepare(
      'SELECT asset_id,photo_id,version_id FROM upload_completions WHERE upload_session_id=? AND actor_id=?',
    )
    .bind(uploadId, ownerId)
    .first();
  assert.ok(
    witness?.asset_id && witness?.version_id,
    'completion has an owner witness',
  );
  assert.equal(completed.completion.assetId, witness.asset_id);
  const job = await waitForJob(db, witness.asset_id);
  assert.equal(job?.recipe, profile);
  if (preferBrowser) assert.equal(job.status, 'queued');
  return { uploadId, source, sourceHash, ...witness, job };
}

async function assertOriginalUnchanged(storage, db, upload) {
  const original = await db
    .prepare(
      "SELECT object_key,checksum_sha256,state FROM photo_assets WHERE id=? AND asset_kind='original'",
    )
    .bind(upload.asset_id)
    .first();
  assert.equal(original?.state, 'private');
  assert.equal(original?.checksum_sha256, upload.sourceHash);
  const object = await storage.get(original.object_key);
  assert.ok(object, 'private original remains in R2');
  const storedBytes = new Uint8Array(await object.arrayBuffer());
  assert.equal(sha256(storedBytes), upload.sourceHash);
  assert.equal(Buffer.compare(Buffer.from(storedBytes), upload.source), 0);
}

async function assertSuccessfulOutputs(storage, db, upload) {
  const job = await waitForJob(db, upload.asset_id, true);
  assert.equal(
    job?.status,
    'succeeded',
    `processing status: ${job?.reason_code}`,
  );
  const rows = await derivativeAssetRows(db, upload.version_id);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.asset_kind, row.state, row.mime]),
    [
      ['preview', 'private', 'image/jpeg'],
      ['thumbnail', 'private', 'image/jpeg'],
    ],
  );
  for (const row of rows) {
    const object = await storage.get(row.object_key);
    assert.ok(object, `${row.asset_kind} exists in private R2 storage`);
    const bytes = new Uint8Array(await object.arrayBuffer());
    assert.equal(bytes.byteLength, row.byte_size);
    assert.equal(sha256(bytes), row.checksum_sha256);
  }
  await assertOriginalUnchanged(storage, db, upload);
  return rows;
}

async function run() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({ workers: [workerOptions()] }),
  );
  try {
    const db = await mf.getD1Database('DB', 'app');
    const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
    const migrationNames = (await readdir('migrations'))
      .filter((name) => /^\d{4}.*\.sql$/u.test(name))
      .sort();
    assert.equal(migrationNames.at(-1)?.slice(0, 4), '0073');
    for (const name of migrationNames)
      await applyMigration(
        db,
        await readFile(resolve('migrations', name), 'utf8'),
      );
    const migration72 = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='image_processing_jobs'",
      )
      .first();
    assert.ok(
      migration72,
      'migration 0072 browser processing schema is present',
    );

    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
      )
      .bind(ownerId, 'browser-processing-native')
      .run();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(sessionId, sessionToken, ownerId, now + 3_600_000, now, now)
      .run();
    const worker = await mf.getWorker('app');
    const request = (path, init = {}) =>
      mf.dispatchFetch(new URL(path, base).toString(), init);
    const { fixture } = await guestDownloadChecks({
      db,
      worker,
      request,
      owner: ownerId,
      ownerSessionId: sessionId,
      ownerCookie,
      base,
      storage,
      fixtureOnly: true,
    });

    stage = 'profile-api';
    const policyPath = `/api/v1/workspaces/${fixture.workspaceId}/image-processing-policy`;
    const before = await expectJson(
      await request(policyPath, { headers: ownerHeaders() }),
      200,
      'read image processing policy',
    );
    const policy = await expectJson(
      await request(policyPath, {
        method: 'POST',
        headers: ownerHeaders(),
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedRevision: before.revision,
          recipe: profile,
        }),
      }),
      200,
      'set browser-first profile',
    );
    assert.equal(policy.recipe, profile);
    const capabilities = await expectJson(
      await request(
        `/api/v1/workspaces/${fixture.workspaceId}/upload-capabilities`,
        {
          headers: ownerHeaders(),
        },
      ),
      200,
      'browser-first upload capabilities',
    );
    assert.equal(capabilities.browserProcessing, true);
    assert.equal(capabilities.maxBrowserBytes, 16 * 1024 * 1024);
    groups += 1;

    const raw = randomBytes(640 * 480 * 3);
    const source = await sharp(raw, {
      raw: { width: 640, height: 480, channels: 3 },
    })
      .jpeg({ quality: 88 })
      .toBuffer();
    assert.ok(
      source.byteLength > 16 * 1024,
      'source exercises the full-size body path',
    );
    const derivatives = await derivativeJpegs(source);
    assert.ok(derivatives.thumbnail.byteLength <= 512 * 1024);
    assert.ok(derivatives.preview.byteLength <= 4 * 1024 * 1024);

    stage = 'browser-upload-success-and-guards';
    const primary = await createBrowserUpload({
      request,
      db,
      storage,
      fixture,
      source,
      filename: 'browser-processing-primary.jpg',
    });
    const uploadPath = `/api/v1/uploads/${primary.uploadId}/browser-derivatives`;
    const validForm = derivativeForm(
      primary.sourceHash,
      derivatives.thumbnail,
      derivatives.preview,
    );
    const wrongOrigin = await multipartRequest(
      mf,
      uploadPath,
      browserHeaders({ origin: 'http://wrong-origin.invalid' }),
      validForm,
    );
    await expectStatus(wrongOrigin, 403, 'wrong origin rejected');
    const wrongActor = await multipartRequest(
      mf,
      uploadPath,
      browserHeaders({ actor: randomUUID() }),
      validForm,
    );
    await expectStatus(wrongActor, 403, 'wrong actor rejected');
    const wrongSession = await multipartRequest(
      mf,
      uploadPath,
      browserHeaders({ session: randomUUID() }),
      validForm,
    );
    await expectStatus(wrongSession, 403, 'wrong expected session rejected');
    const noAuth = await multipartRequest(
      mf,
      uploadPath,
      browserHeaders({ cookie: '' }),
      validForm,
    );
    await expectStatus(noAuth, 401, 'missing Owner session rejected');
    const unknown = await multipartRequest(
      mf,
      `/api/v1/uploads/${randomUUID()}/browser-derivatives`,
      browserHeaders(),
      validForm,
    );
    await expectStatus(unknown, 404, 'unknown upload rejected');
    const mismatch = await multipartRequest(
      mf,
      uploadPath,
      browserHeaders(),
      derivativeForm(
        '0'.repeat(64),
        derivatives.thumbnail,
        derivatives.preview,
      ),
    );
    await expectJson(mismatch, 400, 'source hash mismatch rejected');
    assert.equal((await waitForJob(db, primary.asset_id))?.status, 'queued');
    assert.equal((await derivativeAssetRows(db, primary.version_id)).length, 0);
    const outputSlots = (
      await db
        .prepare(
          'SELECT object_key FROM image_processing_outputs WHERE job_id=?',
        )
        .bind(primary.asset_id)
        .all()
    ).results;
    assert.equal(outputSlots.length, 2);
    for (const slot of outputSlots)
      assert.equal(await storage.get(slot.object_key), null);
    await assertOriginalUnchanged(storage, db, primary);
    groups += 1;

    stage = 'body-and-file-limits';
    const singleFileLimit = await multipartRequest(
      mf,
      uploadPath,
      browserHeaders(),
      derivativeForm(
        primary.sourceHash,
        Buffer.alloc(512 * 1024 + 1),
        Buffer.from([0xff]),
      ),
    );
    await expectJson(singleFileLimit, 400, 'thumbnail above 512 KiB rejected');
    const previewFileLimit = await multipartRequest(
      mf,
      uploadPath,
      browserHeaders(),
      derivativeForm(
        primary.sourceHash,
        Buffer.from([0xff]),
        Buffer.alloc(4 * 1024 * 1024 + 1),
      ),
    );
    await expectJson(previewFileLimit, 400, 'preview above 4 MiB rejected');
    assert.equal((await waitForJob(db, primary.asset_id))?.status, 'queued');
    assert.equal((await derivativeAssetRows(db, primary.version_id)).length, 0);
    groups += 1;

    stage = 'browser-derivative-success';
    const validResult = await expectJson(
      await multipartRequest(mf, uploadPath, browserHeaders(), validForm),
      200,
      'browser derivatives accepted',
    );
    assert.deepEqual(validResult, { status: 'succeeded' });
    const primaryRows = await assertSuccessfulOutputs(storage, db, primary);
    const replay = await expectJson(
      await multipartRequest(mf, uploadPath, browserHeaders(), validForm),
      200,
      'completed browser derivative replay',
    );
    assert.deepEqual(replay, { status: 'succeeded' });
    assert.deepEqual(
      await derivativeAssetRows(db, primary.version_id),
      primaryRows,
    );
    groups += 2;

    stage = 'one-byte-invalid-derivative-fallback';
    const oneByte = await createBrowserUpload({
      request,
      db,
      storage,
      fixture,
      source,
      filename: 'browser-processing-one-byte.jpg',
    });
    const oneByteResult = await expectJson(
      await multipartRequest(
        mf,
        `/api/v1/uploads/${oneByte.uploadId}/browser-derivatives`,
        browserHeaders(),
        derivativeForm(
          oneByte.sourceHash,
          Buffer.from([0xff]),
          Buffer.from([0xff]),
        ),
      ),
      200,
      'one-byte derivatives pass multipart boundary and fall back',
    );
    assert.deepEqual(oneByteResult, { status: 'succeeded' });
    await assertSuccessfulOutputs(storage, db, oneByte);
    groups += 1;

    stage = 'client-derivative-boundaries';
    const maxPart = await createBrowserUpload({
      request,
      db,
      storage,
      fixture,
      source,
      filename: 'browser-processing-eight-mib.jpg',
    });
    const maxPartResult = await expectJson(
      await multipartRequest(
        mf,
        `/api/v1/uploads/${maxPart.uploadId}/browser-derivatives`,
        browserHeaders(),
        derivativeForm(
          maxPart.sourceHash,
          Buffer.alloc(512 * 1024),
          Buffer.alloc(4 * 1024 * 1024),
        ),
      ),
      200,
      '512 KiB thumbnail and 4 MiB preview boundary passes multipart validation',
    );
    assert.deepEqual(maxPartResult, { status: 'succeeded' });
    await assertSuccessfulOutputs(storage, db, maxPart);
    groups += 1;

    stage = 'exact-job-cloudflare-fallback';
    const queuedSibling = await createBrowserUpload({
      request,
      db,
      storage,
      fixture,
      source,
      filename: 'browser-processing-sibling.jpg',
    });
    const cloudflareUpload = await createBrowserUpload({
      request,
      db,
      storage,
      fixture,
      source,
      filename: 'browser-processing-cloudflare-fallback.jpg',
      preferBrowser: false,
    });
    const fallbackJob = await waitForJob(db, cloudflareUpload.asset_id, true);
    assert.equal(fallbackJob?.status, 'succeeded');
    assert.equal(
      (await waitForJob(db, queuedSibling.asset_id))?.status,
      'queued',
    );
    await assertSuccessfulOutputs(storage, db, cloudflareUpload);
    const siblingResult = await expectJson(
      await multipartRequest(
        mf,
        `/api/v1/uploads/${queuedSibling.uploadId}/browser-derivatives`,
        browserHeaders(),
        derivativeForm(
          queuedSibling.sourceHash,
          derivatives.thumbnail,
          derivatives.preview,
        ),
      ),
      200,
      'unrelated queued job remains independently processable',
    );
    assert.deepEqual(siblingResult, { status: 'succeeded' });
    await assertSuccessfulOutputs(storage, db, queuedSibling);
    groups += 1;

    console.log(
      JSON.stringify(
        {
          status: 'passed',
          migrationsThrough: '0073',
          groups,
          browserProfile: profile,
          sourceBytes: source.byteLength,
          sourceGreaterThan16KiB: source.byteLength > 16 * 1024,
          derivativeSizes: {
            thumbnail: derivatives.thumbnail.byteLength,
            preview: derivatives.preview.byteLength,
          },
          checks: {
            policyApi: true,
            directUploadAuthorizeR2CompleteQueued: true,
            browserDerivativeMultipartThreeParts: true,
            sourceHashMismatchNoDerivativeAssets: true,
            originalShaUnchanged: true,
            twoPrivateDerivativeAssets: true,
            exactReplayIdempotent: true,
            originActorSessionAuthAndUnknownUploadDenied: true,
            oneByteAnd512KiBThumbnail4MiBPreviewBoundaries: true,
            oversizedThumbnailAndPreviewRejected: true,
            seventeenMiBBodyLimit: 'validated by root Hono middleware check',
            invalidDerivativeCloudflareFallback: true,
            noBrowserHeaderUsesExactJobFallback: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await mf.dispose();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run().catch((error) => {
    const classification =
      typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
        ? error.code
        : error instanceof Error && /^[A-Za-z]+Error$/u.test(error.name)
          ? error.name.toUpperCase()
          : 'UNCLASSIFIED_ERROR';
    const safeMessage =
      error instanceof TypeError ||
      error?.name === 'NativeResponseError' ||
      error?.name === 'AssertionError'
        ? error.message.split('\n')[0].replace(/\s+/gu, ' ').slice(0, 200)
        : '';
    const sourceLine =
      error instanceof Error
        ? /browser-processing-native\.mjs:(\d+)/u.exec(error.stack ?? '')?.[1]
        : undefined;
    console.error(
      `browser-processing-native:${stage}:${classification}${sourceLine ? `:line${sourceLine}` : ''}${safeMessage ? `:${safeMessage}` : ''}`,
    );
    process.exitCode = 1;
  });
}
