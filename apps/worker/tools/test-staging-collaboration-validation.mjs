import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import ts from 'typescript';
import { applyMigration } from '../tests/apply-migration.mjs';
import { pngFixture } from '../tests/image-fixtures.mjs';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import {
  guestPermissionNames,
  guestPermissionBit,
} from '../../../packages/contracts/src/guest-access.ts';
import { STAGING_GUEST_SCOPE as scope } from '../src/staging-guest-scope.ts';

const FOREIGN_ALBUM_ID = randomUUID();
const configPath = 'wrangler.collaboration-validation.jsonc';
const parsed = ts.parseConfigFileTextToJson(
  configPath,
  await readFile(configPath, 'utf8'),
);
if (parsed.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'),
  );
const cfg = parsed.config;
const origin = cfg.vars.APP_URL;
const bundle = resolve(
  '.local/collaboration-validation-build/staging-collaboration-validation-worker.js',
);
const owner = randomUUID();
const ownerSessionId = 'OAuthMixedCase_' + randomUUID().replaceAll('-', '');
const ownerToken = randomBytes(32).toString('hex');
const authSecret = randomBytes(48).toString('base64url');
const bindings = {
  ...cfg.vars,
  BETTER_AUTH_SECRET: authSecret,
  GITHUB_CLIENT_ID: 'native-collaboration-test-client',
  GITHUB_CLIENT_SECRET: randomBytes(32).toString('hex'),
  R2_ACCOUNT_ID: cfg.account_id,
  R2_ACCESS_KEY_ID: 'native-test-access',
  R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
  IMAGES: {},
};
const DB_NAME = 'staging-collaboration-native';
function spec(name, overrides = {}, omit = []) {
  const env = { ...bindings, ...overrides };
  for (const flag of omit) delete env[flag];
  return {
    name,
    modules: true,
    scriptPath: bundle,
    compatibilityDate: '2026-10-23',
    compatibilityFlags: ['nodejs_compat'],
    bindings: env,
    d1Databases: { DB: DB_NAME },
    r2Buckets: { PRIMARY_STORAGE: DB_NAME },
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
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      spec('valid'),
      spec('missing-guest-flag', {}, ['STAGING_GUEST_VALIDATION']),
      spec('missing-collaboration-flag', {}, [
        'STAGING_COLLABORATION_VALIDATION',
      ]),
      spec('wrong-origin', { APP_URL: 'https://wrong-origin.example' }),
      spec('wrong-account', {
        R2_ACCOUNT_ID: '00000000000000000000000000000000',
      }),
      spec('wrong-bucket', { R2_BUCKET_NAME: 'not-the-staging-bucket' }),
      spec('production', { APP_ENV: 'production' }),
      spec('guest-tag-disabled', { GUEST_TAGS_ENABLED: 'false' }),
    ],
  }),
);
const db = await mf.getD1Database('DB', 'valid');
const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'valid');
const app = await mf.getWorker('valid');
const checks = [];
let ownerCookie;
const record = (name) => checks.push(name);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function request(path, method = 'GET', body, cookie, options = {}) {
  const headers = new Headers();
  if (!options.noOrigin) headers.set('Origin', options.origin ?? origin);
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cfWorker) headers.set('CF-Worker', 'internal.example');
  return mf.dispatchFetch(origin + path, {
    method,
    headers,
    redirect: 'manual',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function status(response, expected, label) {
  if (response.status !== expected) {
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    const code =
      typeof data?.error?.code === 'string' ? data.error.code : 'non-json';
    assert.equal(response.status, expected, label + ': ' + code);
  }
  return response;
}
async function json(response, expected, label) {
  await status(response, expected, label);
  return response.json();
}
function secureGuestCookie(header) {
  assert.match(header ?? '', /^__Host-kino_guest=[a-f0-9]{64};/);
  assert.match(header, /(?:^|;\s*)Path=\//);
  assert.match(header, /(?:^|;\s*)HttpOnly(?:;|$)/);
  assert.match(header, /(?:^|;\s*)SameSite=Lax(?:;|$)/);
  assert.match(header, /(?:^|;\s*)Secure(?:;|$)/);
  assert.doesNotMatch(header, /(?:^|;\s*)Domain=/i);
  return /^__Host-kino_guest=([a-f0-9]{64});/.exec(header)[1];
}
const guestCookie = (secret) => '__Host-kino_guest=' + secret;
const allPermissions = Object.fromEntries(
  guestPermissionNames.map((name) => [name, true]),
);
async function issueInvite(
  albumIds = [scope.albumId],
  permissions = allPermissions,
) {
  const requestId = randomUUID();
  const response = await request(
    '/api/v1/projects/' + scope.projectId + '/invites',
    'POST',
    {
      requestId,
      albumIds,
      accessMode: 'link_only',
      permissions,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      maxUses: 2,
    },
    ownerCookie,
  );
  return { requestId, response };
}
async function uploadPhoto() {
  const source = pngFixture();
  const checksum = sha256(source);
  const initRequestId = randomUUID();
  const init = await json(
    await request(
      '/api/v1/uploads/init',
      'POST',
      {
        requestId: initRequestId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        albumId: scope.albumId,
        originalFilename: 'collaboration-photo.png',
        expectedBytes: source.byteLength,
        contentType: 'image/png',
        sha256: checksum,
      },
      ownerCookie,
    ),
    201,
    'scoped upload init',
  );
  const uploadId = init.uploadSession.id;
  const recoveredUpload = await json(
    await request(
      '/api/v1/uploads/recovery/' + initRequestId,
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'scoped upload recovery',
  );
  assert.equal(recoveredUpload.uploadSession.id, uploadId);
  assert.equal(recoveredUpload.uploadSession.albumId, scope.albumId);
  await status(
    await request(
      '/api/v1/uploads/' + uploadId + '/authorize',
      'POST',
      { requestId: randomUUID() },
      ownerCookie,
    ),
    200,
    'scoped upload authorize',
  );
  const reserved = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(uploadId)
    .first();
  await storage.put(reserved.object_key, new Uint8Array(source), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: checksum,
  });
  const complete = await json(
    await request(
      '/api/v1/uploads/' + uploadId + '/complete',
      'POST',
      { requestId: randomUUID() },
      ownerCookie,
    ),
    200,
    'scoped upload complete',
  );
  const assetId = complete.completion.assetId;
  const processed = await runImageProcessingJob({
    jobId: assetId,
    jobs: new D1ImageProcessingRepository(db),
    objects: new R2ProcessingObjectStore(storage),
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processed.status, 'succeeded');
  const photo = await db
    .prepare(
      "SELECT p.id AS photoId,v.id AS versionId FROM photo_assets a JOIN photos p ON p.id=a.photo_id AND p.project_id=? AND p.album_id=? JOIN photo_versions v ON v.id=a.version_id AND v.photo_id=p.id WHERE a.id=? AND a.asset_kind='original'",
    )
    .bind(scope.projectId, scope.albumId, assetId)
    .first();
  const thumbnail = await db
    .prepare(
      "SELECT object_key,checksum_sha256,storage_node_id,state FROM photo_assets WHERE version_id=? AND asset_kind='thumbnail'",
    )
    .bind(photo.versionId)
    .first();
  assert.ok(photo?.photoId && photo?.versionId && thumbnail);
  return { photo, thumbnail, initRequestId };
}
async function foreignAsset(storageNodeId) {
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(
      FOREIGN_ALBUM_ID,
      scope.workspaceId,
      scope.projectId,
      'Foreign synthetic album',
    )
    .run();
  const foreignPhotoId = randomUUID();
  const foreignVersionId = randomUUID();
  const foreignAssetId = randomUUID();
  const checksum = 'a'.repeat(64);
  await db.batch([
    db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(
        foreignPhotoId,
        scope.workspaceId,
        scope.projectId,
        FOREIGN_ALBUM_ID,
        'foreign.png',
      ),
    db
      .prepare(
        "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,16,'image/png',1,1,'private')",
      )
      .bind(
        foreignVersionId,
        scope.workspaceId,
        foreignPhotoId,
        owner,
        checksum,
      ),
    db
      .prepare(
        "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,?,'thumbnail',?,16,'image/png',?,'private')",
      )
      .bind(
        foreignAssetId,
        scope.workspaceId,
        foreignPhotoId,
        foreignVersionId,
        storageNodeId,
        scope.workspaceId +
          '/' +
          scope.projectId +
          '/' +
          FOREIGN_ALBUM_ID +
          '/' +
          foreignPhotoId +
          '/thumbnail',
        checksum,
      ),
  ]);
  return {
    photoId: foreignPhotoId,
    versionId: foreignVersionId,
    assetId: foreignAssetId,
  };
}
const inviteTokenHash = (token) =>
  sha256('kino-pic:guest-invite-token:v1:' + token);
async function seedForeignInvite(token) {
  const inviteId = randomUUID();
  const mask =
    guestPermissionBit('can_view') |
    guestPermissionBit('can_select') |
    guestPermissionBit('can_submit');
  await db.batch([
    db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',NULL,?,?,?, ?,?)",
      )
      .bind(
        inviteId,
        scope.workspaceId,
        scope.projectId,
        inviteTokenHash(token),
        mask,
        Date.now() + 1800000,
        1,
        owner,
        ownerSessionId,
      ),
    db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, scope.workspaceId, scope.projectId, FOREIGN_ALBUM_ID),
    db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId),
  ]);
  return inviteId;
}

async function run() {
  const migrations = (await readdir('migrations'))
    .filter((name) => /^\d{4}.*\.sql$/u.test(name))
    .sort();
  assert.ok(migrations.length > 0, 'migration chain must not be empty');
  assert.deepEqual(
    migrations.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: migrations.length }, (_, index) => index + 1),
    'migration chain must be contiguous from 0001',
  );
  for (const name of migrations)
    await applyMigration(
      db,
      await readFile(resolve('migrations', name), 'utf8'),
    );
  record('full-' + migrations.length + '-migration-native-d1');

  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'native-collaboration-validation-only')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(ownerSessionId, ownerToken, owner, now + 3600000, now, now)
    .run();
  ownerCookie =
    '__Secure-kino-owner.session_token=' +
    encodeURIComponent(
      ownerToken + '.' + (await makeSignature(ownerToken, authSecret)),
    );
  await db
    .prepare(
      'INSERT INTO workspaces(id,name,owner_user_id,quota_bytes) VALUES(?,?,?,?)',
    )
    .bind(scope.workspaceId, 'Native collaboration fixture', owner, 9000000000)
    .run();
  await db
    .prepare(
      "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
    )
    .bind(scope.projectId, scope.workspaceId, 'Native collaboration fixture')
    .run();
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(
      scope.albumId,
      scope.workspaceId,
      scope.projectId,
      'Fixed synthetic album',
    )
    .run();

  const badProfiles = [
    'missing-guest-flag',
    'missing-collaboration-flag',
    'wrong-origin',
    'wrong-account',
    'wrong-bucket',
    'production',
    'guest-tag-disabled',
  ];
  for (const name of badProfiles) {
    const worker = await mf.getWorker(name);
    await status(
      await worker.fetch(new Request(origin + '/api/v1/invites/capabilities')),
      503,
      name + ' closed-profile',
    );
    record(name + '-closed');
  }
  await status(
    await app.fetch(new Request('https://foreign.example/')),
    403,
    'wrong Host origin',
  );
  record('wrong-origin-host-denied');

  await status(
    await request('/api/v1/invites/capabilities'),
    401,
    'Owner authentication required',
  );
  const ownerCapabilities = await json(
    await request(
      '/api/v1/invites/capabilities',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'authenticated Owner capabilities',
  );
  assert.equal(ownerCapabilities.validationScope.projectId, scope.projectId);
  assert.equal(ownerCapabilities.validationScope.albumId, scope.albumId);
  assert.deepEqual(
    [...ownerCapabilities.validationScope.permissionNames].sort(),
    Object.keys(allPermissions).sort(),
  );
  assert.deepEqual(
    [
      ownerCapabilities.issuanceEnabled,
      ownerCapabilities.exchangeEnabled,
      ownerCapabilities.selectionEnabled,
      ownerCapabilities.feedbackEnabled,
      ownerCapabilities.tagsEnabled,
      ownerCapabilities.historyEnabled,
      ownerCapabilities.downloadsEnabled,
      ownerCapabilities.commentsEnabled,
      ownerCapabilities.annotationsEnabled,
      ownerCapabilities.versionComparisonEnabled,
    ],
    [true, true, true, true, true, true, true, true, true, true],
  );
  record('owner-auth-and-scoped-collaboration-capabilities');

  for (const [path, label] of [
    ['/api/v1/projects/' + randomUUID(), 'foreign-project'],
    [
      '/api/v1/albums/' + FOREIGN_ALBUM_ID + '/selection-policy',
      'foreign-album-selection-policy',
    ],
    ['/api/v1/version-approvals/capabilities', 'adjacent-feature-route'],
  ]) {
    await status(
      await request(path, 'GET', undefined, ownerCookie),
      404,
      label,
    );
    record(label + '-denied');
  }

  const rejectedForeignInvite = await issueInvite([FOREIGN_ALBUM_ID]);
  await status(
    rejectedForeignInvite.response,
    409,
    'foreign album invite rejected',
  );
  assert.doesNotMatch(
    await rejectedForeignInvite.response.clone().text(),
    /[a-f0-9]{64}/,
  );
  record('owner-cannot-issue-foreign-album-invite');

  const beforeMultiInvite = await db
    .prepare('SELECT count(*) AS n FROM guest_invites WHERE created_by=?')
    .bind(owner)
    .first();
  const multiInvite = await issueInvite([scope.albumId, FOREIGN_ALBUM_ID]);
  await status(multiInvite.response, 409, 'multi-album invite rejected');
  assert.doesNotMatch(
    await multiInvite.response.clone().text(),
    /[a-f0-9]{64}/,
  );
  const afterMultiInvite = await db
    .prepare('SELECT count(*) AS n FROM guest_invites WHERE created_by=?')
    .bind(owner)
    .first();
  assert.equal(afterMultiInvite.n, beforeMultiInvite.n);
  record('multi-album-invite-rejected-without-write-or-secret-leak');

  const photo = await uploadPhoto();
  const validInviteRequest = await issueInvite();
  const validInvite = await json(
    validInviteRequest.response,
    200,
    'scoped collaboration invite',
  );
  assert.equal(validInvite.secretAvailable, true);
  assert.match(validInvite.token, /^[a-f0-9]{64}$/);
  const recoveredInvite = await json(
    await request(
      '/api/v1/invites/creation/' + validInviteRequest.requestId,
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'scoped invite recovery',
  );
  assert.equal(recoveredInvite.secretAvailable, false);
  assert.doesNotMatch(
    JSON.stringify(recoveredInvite),
    new RegExp(validInvite.token),
  );
  await status(
    await request(
      '/api/v1/invites/creation/' + randomUUID(),
      'GET',
      undefined,
      ownerCookie,
    ),
    404,
    'unknown invite recovery',
  );
  await status(
    await request(
      '/api/v1/uploads/recovery/' + randomUUID(),
      'GET',
      undefined,
      ownerCookie,
    ),
    404,
    'unknown upload recovery',
  );
  record('invite-and-upload-recovery-scoped-without-secret-replay');
  const expectedMask = guestPermissionNames.reduce(
    (mask, name) => mask | guestPermissionBit(name),
    0,
  );
  const storedInvite = await db
    .prepare('SELECT permissions_mask FROM guest_invites WHERE id=?')
    .bind(validInvite.invite.inviteId)
    .first();
  assert.equal(storedInvite.permissions_mask, expectedMask);
  record('all-supported-rights-issued-only-for-fixed-album');

  const noOrigin = await request(
    '/api/guest/exchange',
    'POST',
    {
      requestId: randomUUID(),
      token: validInvite.token,
      displayName: 'Native Guest',
    },
    undefined,
    { noOrigin: true },
  );
  await status(noOrigin, 403, 'missing Origin denied');
  const wrongOrigin = await request(
    '/api/guest/exchange',
    'POST',
    {
      requestId: randomUUID(),
      token: validInvite.token,
      displayName: 'Native Guest',
    },
    undefined,
    { origin: 'https://foreign.example' },
  );
  await status(wrongOrigin, 403, 'foreign Origin denied');
  assert.doesNotMatch(await noOrigin.clone().text(), /[a-f0-9]{64}/);
  assert.doesNotMatch(await wrongOrigin.clone().text(), /[a-f0-9]{64}/);

  const exchangeResponse = await request('/api/guest/exchange', 'POST', {
    requestId: randomUUID(),
    token: validInvite.token,
    displayName: 'Native Guest',
  });
  const exchange = await json(exchangeResponse, 200, 'Guest exchange');
  assert.equal(exchange.authenticated, true);
  assert.doesNotMatch(JSON.stringify(exchange), /token|secret|bearer/i);
  const guestSecret = secureGuestCookie(
    exchangeResponse.headers.get('set-cookie'),
  );
  assert.notEqual(guestSecret, validInvite.token);
  record('secure-guest-cookie-and-no-bearer-response-leak');

  const cfWorker = await request(
    '/api/guest/exchange',
    'POST',
    {
      requestId: randomUUID(),
      token: validInvite.token,
      displayName: 'Blocked Worker',
    },
    undefined,
    { cfWorker: true },
  );
  await status(cfWorker, 401, 'CF-Worker exchange denied');
  assert.doesNotMatch(await cfWorker.clone().text(), /[a-f0-9]{64}/);
  record('internal-worker-exchange-denied-without-secret-leak');

  for (const path of [
    '/api/guest/tags/capabilities',
    '/api/guest/feedback/capabilities',
    '/api/guest/history/capabilities',
    '/api/guest/version-comparison/capabilities',
    '/api/guest/comments/capabilities',
    '/api/guest/annotations/capabilities',
    '/api/guest/annotations/freehand-capabilities',
  ]) {
    const capability = await json(await request(path), 200, path);
    assert.equal(capability.enabled, true, path);
  }
  for (const path of [
    '/api/v1/photo-versions/capabilities',
    '/api/v1/version-uploads/capabilities',
    '/api/v1/versioning/capabilities',
    '/api/v1/comments/capabilities',
    '/api/v1/comment-processing/capabilities',
    '/api/v1/annotations/capabilities',
    '/api/v1/annotations/authoring/capabilities',
    '/api/v1/annotations/authoring/freehand-capabilities',
    '/api/v1/annotation-processing/capabilities',
    '/api/v1/owner-history/capabilities',
    '/api/v1/photographer-recommendations/capabilities',
  ]) {
    const capability = await json(
      await request(path, 'GET', undefined, ownerCookie),
      200,
      path,
    );
    assert.equal(capability.enabled, true, path);
  }
  const historyDocument = await request(
    '/guest/history?albumId=' + scope.albumId,
  );
  await status(historyDocument, 200, 'Guest history document is wired');
  assert.match(
    historyDocument.headers.get('content-type') ?? '',
    /text\/html/i,
  );
  assert.match(await historyDocument.text(), /id="root"/);
  await status(
    await request('/guest/history', 'POST'),
    404,
    'History document remains read-only',
  );
  await status(
    await request('/guest/history/other'),
    404,
    'No wider Guest page route',
  );
  record('selected-guest-owner-and-recommendation-capabilities-active');

  await status(
    await request('/api/guest/albums/' + scope.albumId + '/photos'),
    401,
    'Guest session required',
  );
  const gallery = await json(
    await request(
      '/api/guest/albums/' + scope.albumId + '/photos',
      'GET',
      undefined,
      guestCookie(guestSecret),
    ),
    200,
    'scoped Guest gallery',
  );
  assert.ok(gallery.photos.some((item) => item.id === photo.photo.photoId));
  assert.doesNotMatch(
    JSON.stringify(gallery),
    /objectKey|storageNodeId|checksum|sha256|assetId|bearer|sessionSecret/i,
  );
  const validAsset = await request(
    '/api/guest/photos/' +
      photo.photo.photoId +
      '/versions/' +
      photo.photo.versionId +
      '/assets/thumbnail',
    'GET',
    undefined,
    guestCookie(guestSecret),
  );
  await status(validAsset, 200, 'fixed album thumbnail');
  const assetBytes = Buffer.from(await validAsset.arrayBuffer());
  const storedThumbnail = await storage.get(photo.thumbnail.object_key);
  assert.ok(storedThumbnail);
  assert.deepEqual(
    assetBytes,
    Buffer.from(await storedThumbnail.arrayBuffer()),
  );
  assert.equal(sha256(assetBytes), photo.thumbnail.checksum_sha256);
  record('guest-auth-fixed-album-gallery-and-private-asset');

  const foreign = await foreignAsset(photo.thumbnail.storage_node_id);
  await status(
    await request(
      '/api/guest/albums/' + FOREIGN_ALBUM_ID + '/photos',
      'GET',
      undefined,
      guestCookie(guestSecret),
    ),
    404,
    'foreign album route',
  );
  const foreignAssetResponse = await request(
    '/api/guest/photos/' +
      foreign.photoId +
      '/versions/' +
      foreign.versionId +
      '/assets/thumbnail',
    'GET',
    undefined,
    guestCookie(guestSecret),
  );
  await status(foreignAssetResponse, 404, 'foreign asset row');
  assert.doesNotMatch(
    await foreignAssetResponse.clone().text(),
    new RegExp(foreign.photoId),
  );
  await status(
    await request(
      '/api/v1/albums/' + scope.albumId + '/photos',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'an unrelated album does not revoke the explicitly managed Owner album',
  );
  record('foreign-album-and-real-foreign-asset-denied');

  const foreignToken = randomBytes(32).toString('hex');
  const foreignInviteId = await seedForeignInvite(foreignToken);
  const foreignInviteBefore = await db
    .prepare('SELECT count(*) AS n FROM guest_sessions WHERE invite_id=?')
    .bind(foreignInviteId)
    .first();
  const foreignExchange = await request('/api/guest/exchange', 'POST', {
    requestId: randomUUID(),
    token: foreignToken,
    displayName: 'Foreign Guest',
  });
  await status(foreignExchange, 401, 'foreign invite exchange denied');
  assert.doesNotMatch(await foreignExchange.clone().text(), /[a-f0-9]{64}/);
  const foreignInviteAfter = await db
    .prepare('SELECT count(*) AS n FROM guest_sessions WHERE invite_id=?')
    .bind(foreignInviteId)
    .first();
  assert.equal(foreignInviteAfter.n, foreignInviteBefore.n);
  record('foreign-invite-denied-without-session-or-secret-leak');

  const logout = await request(
    '/api/guest/logout',
    'POST',
    { requestId: randomUUID() },
    guestCookie(guestSecret),
  );
  await status(logout, 200, 'scoped Guest logout');
  await status(
    await request(
      '/api/guest/albums/' + scope.albumId + '/photos',
      'GET',
      undefined,
      guestCookie(guestSecret),
    ),
    401,
    'revoked Guest session',
  );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  record('logout-revocation-and-foreign-key-check');

  const proof = {
    status: 'passed_local_staging_collaboration_validation',
    runtime: 'Miniflare native workerd with ephemeral D1 and R2',
    migrationCount: migrations.length,
    checks,
    activeProfileFlags: [
      ...new Set(
        Object.keys(cfg.vars).filter(
          (key) => key.endsWith('_ENABLED') && cfg.vars[key] === 'true',
        ),
      ),
    ].sort(),
    sourceHashes: {
      wrapper: sha256(
        await readFile('tools/staging-collaboration-validation-worker.ts'),
      ),
      boundary: sha256(await readFile('src/staging-collaboration-boundary.ts')),
      guestPermissions: sha256(
        await readFile('src/staging-guest-permissions.ts'),
      ),
      config: sha256(await readFile('src/config.ts')),
      inviteIssuance: sha256(await readFile('src/invite-issuance.ts')),
      guestExchange: sha256(await readFile('src/guest-exchange.ts')),
      index: sha256(await readFile('src/index.ts')),
      profile: sha256(await readFile(configPath)),
      nativeTest: sha256(
        await readFile('tools/test-staging-collaboration-validation.mjs'),
      ),
      bundle: sha256(await readFile(bundle)),
    },
    imageFixtures: 1,
    realOAuth: false,
    remoteCloudflare: false,
    hostedDeployment: false,
    browserOrPublicTLS: false,
  };
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/staging-collaboration-validation-local-proof.json',
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      status: proof.status,
      checks: checks.length,
      migrations: migrations.length,
      realOAuth: false,
      remoteCloudflare: false,
      hostedDeployment: false,
    }),
  );
}
try {
  await run();
} finally {
  await mf.dispose();
}
