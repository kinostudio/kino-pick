import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';
import { createHash } from 'node:crypto';
import { jpegFixture, pngFixture, webpFixture } from './image-fixtures.mjs';
const base = 'http://127.0.0.1:8798',
  owner = randomUUID(),
  sid = 'Opaque.Owner.Session.' + randomUUID().toUpperCase(),
  token = randomUUID();
const secret = 'photographer-routes-isolated-secret-at-least-forty-characters';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_DOWNLOADS_ENABLED: 'false',
  GUEST_SELECTION_ENABLED: 'true',
  PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
  BETTER_AUTH_SECRET: secret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-not-real-secret',
  R2_BUCKET_NAME: 'photographer-routes-isolated',
};
const worker = (name, exchange) => ({
  name,
  modules: true,
  scriptPath: resolve('.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  outboundService: async () =>
    new Response('Outbound blocked', { status: 503 }),
  bindings: { ...bindings, GUEST_EXCHANGE_ENABLED: exchange },
  d1Databases: { DB: 'photographer-routes-isolated' },
  r2Buckets: { PRIMARY_STORAGE: 'photographer-routes-isolated' },
  assets: {
    directory: resolve('.static'),
    binding: 'ASSETS',
    run_worker_first: true,
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  },
});
const processingWorker = (name, enabled) => ({
  ...worker(name, 'true'),
  bindings: {
    ...bindings,
    GUEST_EXCHANGE_ENABLED: 'true',
    PHOTO_VERSIONS_ENABLED: 'true',
    PHOTO_VERSION_UPLOADS_ENABLED: 'true',
    CLOUDFLARE_IMAGE_PROCESSING_ENABLED: enabled ? 'true' : 'false',
  },
  images: { binding: 'IMAGES' },
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      worker('app', 'true'),
      worker('disabled', 'false'),
      processingWorker('version-processing-enabled', true),
      processingWorker('version-processing-disabled', false),
    ],
  }),
);
try {
  const db = await mf.getD1Database('DB', 'app'),
    storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
  for (const name of (await readdir('migrations'))
    .filter((x) => /^\d{4}.*\.sql$/.test(x) && !x.startsWith('0059'))
    .sort())
    await applyMigration(db, await readFile('migrations/' + name, 'utf8'));
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'photographer-routes-focused')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(sid, token, owner, now + 3600000, now, now)
    .run();
  const cookie =
    'kino-owner.session_token=' +
    encodeURIComponent(token + '.' + (await makeSignature(token, secret)));
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const app = await mf.getWorker('app');
  const { fixture } = await guestDownloadChecks({
    db,
    storage,
    worker: app,
    request,
    owner,
    ownerSessionId: sid,
    ownerCookie: cookie,
    base,
    fixtureOnly: true,
  });
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
    'X-Kino-Expected-Session': sid,
  };
  let groups = 0;
  const call = async (path, status, body, method = 'PUT', extra = {}) => {
    const response = await request(path, {
      method: body === undefined ? 'GET' : method,
      headers: { ...headers, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(
      response.status,
      status,
      JSON.stringify({ phase: path, code: value?.error?.code }),
    );
    return value;
  };
  const callOnWorker = async (workerName, path, body, status) => {
    const target = await mf.getWorker(workerName);
    const response = await target.fetch(
      new Request(new URL(path, base), {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const value = await response.json();
    assert.equal(
      response.status,
      status,
      JSON.stringify({
        phase: path,
        worker: workerName,
        code: value?.error?.code,
      }),
    );
    return value;
  };
  const completeVersion = async (
    workerName,
    source,
    filename,
    contentType,
    photoId = fixture.photoId,
  ) => {
    const head = await db
      .prepare(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(photoId)
      .first();
    assert.ok(head?.version_id);
    const sha256 = createHash('sha256').update(source).digest('hex');
    const init = await callOnWorker(
      workerName,
      '/api/v1/photos/' + photoId + '/versions/init',
      {
        requestId: randomUUID(),
        originalFilename: filename,
        expectedBytes: source.byteLength,
        contentType,
        sha256,
        expectedRevision: head.revision,
        expectedCurrentVersionId: head.version_id,
        changeType: 'replace_current',
        changeNote: 'Processing wake route fixture',
        labels: [],
        confirm: true,
      },
      201,
    );
    const uploadSessionId = init.uploadSession.id;
    await callOnWorker(
      workerName,
      '/api/v1/uploads/' + uploadSessionId + '/authorize',
      { requestId: randomUUID() },
      200,
    );
    const upload = await db
      .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
      .bind(uploadSessionId)
      .first();
    assert.ok(upload?.object_key);
    await storage.put(upload.object_key, new Uint8Array(source), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType },
      sha256: Buffer.from(sha256, 'hex'),
    });
    const completionRequestId = randomUUID();
    const completion = await callOnWorker(
      workerName,
      '/api/v1/photos/' +
        photoId +
        '/versions/' +
        uploadSessionId +
        '/complete',
      { requestId: completionRequestId },
      200,
    );
    const witness = await db
      .prepare(
        'SELECT workspace_id,asset_id,version_id FROM upload_version_completions WHERE upload_session_id=? AND actor_id=? AND photo_id=?',
      )
      .bind(uploadSessionId, owner, photoId)
      .first();
    assert.ok(witness?.asset_id && witness?.version_id);
    assert.equal(completion.assetId, witness.asset_id);
    assert.equal(witness.workspace_id, fixture.workspaceId);
    assert.equal(witness.version_id, completion.versionId);
    return {
      witness,
      uploadSessionId,
      photoId,
      completionRequestId,
      completion,
    };
  };
  const completeOriginal = async (
    workerName,
    source,
    filename,
    contentType,
  ) => {
    const sha256 = createHash('sha256').update(source).digest('hex');
    const init = await callOnWorker(
      workerName,
      '/api/v1/uploads/init',
      {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        albumId: fixture.albumId,
        originalFilename: filename,
        expectedBytes: source.byteLength,
        contentType,
        sha256,
        requestId: randomUUID(),
      },
      201,
    );
    const uploadSessionId = init.uploadSession.id;
    await callOnWorker(
      workerName,
      '/api/v1/uploads/' + uploadSessionId + '/authorize',
      { requestId: randomUUID() },
      200,
    );
    const upload = await db
      .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
      .bind(uploadSessionId)
      .first();
    assert.ok(upload?.object_key);
    await storage.put(upload.object_key, new Uint8Array(source), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType },
      sha256: Buffer.from(sha256, 'hex'),
    });
    const completion = await callOnWorker(
      workerName,
      '/api/v1/uploads/' + uploadSessionId + '/complete',
      { requestId: randomUUID() },
      200,
    );
    const witness = await db
      .prepare(
        'SELECT workspace_id,asset_id,photo_id,version_id FROM upload_completions WHERE upload_session_id=? AND actor_id=?',
      )
      .bind(uploadSessionId, owner)
      .first();
    assert.ok(witness?.asset_id && witness?.photo_id && witness?.version_id);
    assert.equal(completion.completion.assetId, witness.asset_id);
    return { witness, uploadSessionId };
  };
  const processingStatus = async (jobId, terminal = false) => {
    let row;
    for (let attempt = 0; attempt < (terminal ? 400 : 1); attempt++) {
      row = await db
        .prepare(
          'SELECT status,reason_code FROM image_processing_jobs WHERE id=?',
        )
        .bind(jobId)
        .first();
      if (
        !terminal ||
        ['succeeded', 'failed', 'unsupported', 'needs_review'].includes(
          row?.status,
        )
      )
        return row;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return row;
  };
  const cap = '/api/v1/photographer-recommendations/capabilities';
  assert.deepEqual(await call(cap, 200), { enabled: false });
  const migration59 = (await readdir('migrations')).find((name) =>
    name.startsWith('0059'),
  );
  assert.ok(migration59);
  await applyMigration(db, await readFile('migrations/' + migration59, 'utf8'));
  assert.deepEqual(await call(cap, 200), { enabled: true });
  groups++;
  const photoPath =
    '/api/v1/photos/' + fixture.photoId + '/photographer-metadata';
  const policyPath =
    '/api/v1/albums/' + fixture.albumId + '/photographer-recommendations';
  const original = await call(photoPath, 200);
  assert.equal(original.photoId, fixture.photoId);
  assert.equal(original.source, null);
  groups++;
  const completed = await db
    .prepare(
      'SELECT upload_session_id,request_id FROM upload_completions WHERE photo_id=? AND version_id=?',
    )
    .bind(fixture.photoId, fixture.versionId)
    .first();
  assert.ok(completed);
  await call(
    '/api/v1/uploads/' + completed.upload_session_id + '/complete',
    200,
    { requestId: completed.request_id },
    'POST',
  );
  let automatic = original;
  for (let i = 0; i < 20 && automatic.source === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    automatic = await call(photoPath, 200);
  }
  assert.ok(
    automatic.source,
    'completion replay must wake actual metadata import',
  );
  assert.equal(automatic.source.mime, 'image/png');
  groups++;
  const importIntent = {
    requestId: randomUUID(),
    versionId: fixture.versionId,
    expectedRevision: automatic.revision,
  };
  const imported = await call(photoPath + '/import', 200, importIntent, 'POST');
  assert.equal(imported.photo.source.mime, 'image/png');
  assert.equal(imported.photo.rating.imported.state, 'imported');
  assert.equal(imported.photo.rating.imported.field.status, 'missing');
  assert.deepEqual(
    await call(photoPath + '/import', 200, importIntent, 'POST'),
    imported,
  );
  groups++;
  let page = await call(policyPath, 200);
  const policyIntent = {
    requestId: randomUUID(),
    expectedRevision: page.policy.revision,
    visible: true,
    minRating: 3,
    allowedLabels: ['red'],
  };
  const policy = await call(policyPath, 200, policyIntent);
  assert.deepEqual(await call(policyPath, 200, policyIntent), policy);
  groups++;
  let photo = await call(photoPath, 200);
  const setIntent = {
    requestId: randomUUID(),
    versionId: fixture.versionId,
    expectedRevision: photo.revision,
    expectedHeadRevision: photo.headRevision,
    rating: { state: 'set', value: 4 },
    label: { state: 'set', value: 'blue' },
    decision: 'inherit',
  };
  const updated = await call(photoPath, 200, setIntent);
  assert.equal(updated.photo.rating.effective, 4);
  assert.equal(updated.photo.label.effective, 'blue');
  assert.equal(updated.photo.decision.recommended, true);
  assert.deepEqual(await call(photoPath, 200, setIntent), updated);
  await call(photoPath, 409, { ...setIntent, requestId: randomUUID() });
  groups++;
  const guestHeaders = { Cookie: 'kino_guest=' + fixture.viewGuest.cookie };
  const guestPage = await request(
    '/api/guest/albums/' + fixture.albumId + '/photos',
    { headers: guestHeaders },
  );
  assert.equal(guestPage.status, 200);
  const guestJson = await guestPage.json();
  const guestPhoto = guestJson.photos.find((row) => row.id === fixture.photoId);
  assert.equal(guestPhoto.photographerRecommended, true);
  assert.equal(Object.hasOwn(guestPhoto, 'rating'), false);
  assert.equal(Object.hasOwn(guestPhoto, 'source'), false);
  const guestHidden = await call(policyPath, 200, {
    requestId: randomUUID(),
    expectedRevision: policy.policy.revision,
    visible: false,
    minRating: 3,
    allowedLabels: ['red'],
  });
  assert.equal(guestHidden.policy.visible, false);
  const hiddenJson = await (
    await request('/api/guest/albums/' + fixture.albumId + '/photos', {
      headers: guestHeaders,
    })
  ).json();
  assert.equal(
    hiddenJson.photos.find((row) => row.id === fixture.photoId)
      .photographerRecommended,
    false,
  );
  groups++;
  await call(photoPath, 403, { ...setIntent, requestId: randomUUID() }, 'PUT', {
    Origin: 'https://invalid.example',
  });
  assert.notEqual(sid.toLowerCase(), sid);
  await call(photoPath, 409, { ...setIntent, requestId: randomUUID() }, 'PUT', {
    'X-Kino-Expected-Session': sid.toLowerCase(),
  });
  await call('/api/v1/photos/' + randomUUID() + '/photographer-metadata', 404);
  await call(photoPath, 401, undefined, 'GET', { Cookie: '' });
  groups++;
  const counts = async () => ({
    ...(await db
      .prepare(
        "SELECT (SELECT count(*) FROM photographer_recommendation_commands) commands,(SELECT count(*) FROM audit_events WHERE action LIKE 'photo.photographer_metadata.%' OR action='album.photographer_recommendations.changed') audits",
      )
      .first()),
  });
  const before = await counts();
  await db.exec(
    "CREATE TRIGGER test_metadata_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action LIKE 'photo.photographer_metadata.%' BEGIN SELECT RAISE(ABORT,'INJECTED_METADATA_AUDIT_FAILURE'); END;",
  );
  photo = await call(photoPath, 200);
  await call(photoPath, 503, {
    ...setIntent,
    requestId: randomUUID(),
    expectedRevision: photo.revision,
    rating: { state: 'clear' },
    label: { state: 'clear' },
  });
  assert.deepEqual(await counts(), before);
  await db.exec('DROP TRIGGER test_metadata_audit_failure;');
  groups++;
  const asset = await db
    .prepare(
      "SELECT object_key FROM photo_assets WHERE photo_id=? AND version_id=? AND asset_kind='original'",
    )
    .bind(fixture.photoId, fixture.versionId)
    .first();
  await storage.put(asset.object_key, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: 'image/png' },
  });
  await call(
    photoPath + '/import',
    503,
    {
      requestId: randomUUID(),
      versionId: fixture.versionId,
      expectedRevision: photo.revision,
    },
    'POST',
  );
  assert.deepEqual(await counts(), before);
  groups++;
  const currentPolicy = await callOnWorker(
    'version-processing-enabled',
    '/api/v1/workspaces/' + fixture.workspaceId + '/image-processing-policy',
    undefined,
    200,
  );
  const cloudPolicy = await callOnWorker(
    'version-processing-enabled',
    '/api/v1/workspaces/' + fixture.workspaceId + '/image-processing-policy',
    {
      requestId: randomUUID(),
      expectedRevision: currentPolicy.revision,
      recipe: 'cloudflare-images-jpeg-82-v1',
    },
    200,
  );
  assert.equal(cloudPolicy.recipe, 'cloudflare-images-jpeg-82-v1');
  assert.equal(cloudPolicy.revision, currentPolicy.revision + 1);
  const oldVersion = await completeOriginal(
    'version-processing-disabled',
    pngFixture(),
    'wake-old-queued.png',
    'image/png',
  );
  assert.equal(
    (await processingStatus(oldVersion.witness.asset_id)).status,
    'queued',
  );
  const exactVersion = await completeVersion(
    'version-processing-enabled',
    jpegFixture(),
    'wake-exact-version.jpg',
    'image/jpeg',
    oldVersion.witness.photo_id,
  );
  assert.equal(
    (await processingStatus(exactVersion.witness.asset_id, true)).status,
    'succeeded',
  );
  assert.equal(
    (await processingStatus(oldVersion.witness.asset_id)).status,
    'queued',
    'version completion must not consume the older same-workspace job',
  );
  const outputSlots = (
    await db
      .prepare(
        'SELECT kind,object_key FROM image_processing_outputs WHERE job_id=? ORDER BY kind',
      )
      .bind(exactVersion.witness.asset_id)
      .all()
  ).results;
  assert.deepEqual(
    outputSlots.map((slot) => slot.kind),
    ['preview', 'thumbnail'],
  );
  for (const slot of outputSlots) assert.ok(await storage.get(slot.object_key));
  const derivativeAssets = (
    await db
      .prepare(
        'SELECT asset_kind,state,mime FROM photo_assets WHERE id IN(SELECT asset_id FROM image_processing_outputs WHERE job_id=?) ORDER BY asset_kind',
      )
      .bind(exactVersion.witness.asset_id)
      .all()
  ).results;
  assert.deepEqual(derivativeAssets, [
    { asset_kind: 'preview', state: 'private', mime: 'image/jpeg' },
    { asset_kind: 'thumbnail', state: 'private', mime: 'image/jpeg' },
  ]);
  const successAuditCount = async (versionId) =>
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action='processing.succeeded' AND photo_id=? AND version_id=?",
        )
        .bind(exactVersion.photoId, versionId)
        .first()
    ).n;
  const successAuditsBeforeReplay = await successAuditCount(
    exactVersion.witness.version_id,
  );
  assert.equal(successAuditsBeforeReplay, 1);
  assert.deepEqual(
    await callOnWorker(
      'version-processing-enabled',
      '/api/v1/photos/' +
        exactVersion.photoId +
        '/versions/' +
        exactVersion.uploadSessionId +
        '/complete',
      { requestId: exactVersion.completionRequestId },
      200,
    ),
    exactVersion.completion,
  );
  assert.equal(
    await successAuditCount(exactVersion.witness.version_id),
    successAuditsBeforeReplay,
    'completion replay must not duplicate the processing audit',
  );
  await callOnWorker(
    'version-processing-enabled',
    '/api/v1/photos/' +
      fixture.photoId +
      '/versions/' +
      exactVersion.uploadSessionId +
      '/complete',
    { requestId: exactVersion.completionRequestId },
    404,
  );
  assert.equal(
    (await processingStatus(exactVersion.witness.asset_id)).status,
    'succeeded',
  );
  assert.equal(
    (await processingStatus(oldVersion.witness.asset_id)).status,
    'queued',
    'a completion replay through another photo path must not process its job',
  );
  assert.equal(
    await successAuditCount(exactVersion.witness.version_id),
    successAuditsBeforeReplay,
  );
  groups++;
  const offVersion = await completeVersion(
    'version-processing-disabled',
    webpFixture(),
    'wake-off-version.webp',
    'image/webp',
    oldVersion.witness.photo_id,
  );
  assert.equal(
    (await processingStatus(offVersion.witness.asset_id)).status,
    'queued',
    'feature OFF must leave the completed version queued',
  );
  groups++;
  const oldOriginal = await completeOriginal(
    'version-processing-disabled',
    pngFixture(),
    'wake-normal-backlog.png',
    'image/png',
  );
  const newOriginal = await completeOriginal(
    'version-processing-enabled',
    pngFixture(),
    'wake-normal-exact.png',
    'image/png',
  );
  assert.equal(
    (await processingStatus(newOriginal.witness.asset_id, true)).status,
    'succeeded',
    'normal completion must use the shared exact-job wake',
  );
  assert.equal(
    (await processingStatus(oldVersion.witness.asset_id)).status,
    'queued',
  );
  assert.equal(
    (await processingStatus(offVersion.witness.asset_id)).status,
    'queued',
  );
  assert.equal(
    (await processingStatus(oldOriginal.witness.asset_id)).status,
    'queued',
  );
  groups++;
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  await writeFile(
    '.local/photographer-routes-focused-proof.json',
    JSON.stringify(
      {
        status: 'passed_isolated_photographer_routes',
        groups,
        migrations: 59,
        realOAuth: false,
        remoteProvider: false,
        workerBundleSha256: hash(await readFile('.build/index.js')),
        migration59Sha256: hash(await readFile('migrations/' + migration59)),
        runnerSha256: hash(
          await readFile('tests/photographer-routes-focused.mjs'),
        ),
        scope: 'fresh ephemeral native D1/R2 only',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'passed: ' + groups + ' isolated photographer route/R2/audit groups',
  );
} finally {
  await mf.dispose();
}
