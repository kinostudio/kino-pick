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
import { STAGING_GUEST_SCOPE as scope } from '../src/staging-guest-scope.ts';

const FOREIGN_ALBUM_ID = randomUUID();
const configPath = 'wrangler.guest-validation.jsonc';
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
  '.local/guest-validation-build/staging-guest-validation-worker.js',
);
const owner = randomUUID();
const ownerSessionId = randomUUID();
const ownerToken = randomBytes(32).toString('hex');
const authSecret = randomBytes(48).toString('base64url');
const bindings = {
  ...cfg.vars,
  BETTER_AUTH_SECRET: authSecret,
  GITHUB_CLIENT_ID: 'native-test-client',
  GITHUB_CLIENT_SECRET: randomBytes(32).toString('hex'),
  R2_ACCOUNT_ID: cfg.account_id,
  R2_ACCESS_KEY_ID: 'native-test-access',
  R2_SECRET_ACCESS_KEY: randomBytes(32).toString('hex'),
  IMAGES: {}, // Presence double only; LocalSharp does the actual fixture processing.
};
const DB_NAME = 'staging-guest-validation-native';
function spec(name, overrides = {}, omitFlag = false) {
  const env = { ...bindings, ...overrides };
  if (omitFlag) delete env.STAGING_GUEST_VALIDATION;
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
      spec('missing-flag', {}, true),
      spec('wrong-origin', { APP_URL: 'https://wrong-origin.example' }),
      spec('wrong-account', {
        R2_ACCOUNT_ID: '00000000000000000000000000000000',
      }),
      spec('wrong-bucket', { R2_BUCKET_NAME: 'not-the-staging-bucket' }),
      spec('production', { APP_ENV: 'production' }),
    ],
  }),
);
const db = await mf.getD1Database('DB', 'valid');
const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'valid');
const app = await mf.getWorker('valid');
const checks = [];
let ownerCookie;
const record = (name) => checks.push(name);

async function request(path, method = 'GET', body, cookie, options = {}) {
  const headers = new Headers();
  if (!options.noOrigin) headers.set('Origin', options.origin ?? origin);
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.cfWorker) headers.set('CF-Worker', 'internal.example');
  if (options.ip) headers.set('CF-Connecting-IP', options.ip);
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
async function guestDenied(response, expected = 401, label = 'Guest denial') {
  await status(response, expected, label);
  if (expected === 401)
    assert.deepEqual(await response.json(), {
      error: { code: 'GUEST_ACCESS_REQUIRED' },
    });
}
function secureCookie(header, name) {
  assert.match(header ?? '', new RegExp('^' + name + '=[a-f0-9]{64};'));
  assert.match(header, /(?:^|;\s*)Path=\//);
  assert.match(header, /(?:^|;\s*)HttpOnly(?:;|$)/);
  assert.match(header, /(?:^|;\s*)SameSite=Lax(?:;|$)/);
  assert.match(header, /(?:^|;\s*)Secure(?:;|$)/);
  assert.doesNotMatch(header, /(?:^|;\s*)Domain=/i);
  return new RegExp('^' + name + '=([a-f0-9]{64});').exec(header)[1];
}
const guestCookie = (secret) => '__Host-kino_guest=' + secret;
const permissions = {
  can_view: true,
  can_download_preview: false,
  can_download_original: false,
  can_select: true,
  can_rate: false,
  can_favorite: false,
  can_tag: false,
  can_annotate: false,
  can_comment: false,
  can_submit: true,
  can_view_own_history: false,
  can_compare_versions: false,
};
async function issueInvite(options = {}) {
  const body = {
    requestId: randomUUID(),
    albumIds: options.albumIds ?? [scope.albumId],
    accessMode: options.accessMode ?? 'link_only',
    permissions: options.permissions ?? permissions,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    maxUses: 2,
    ...(options.password === undefined ? {} : { password: options.password }),
  };
  const response = await request(
    '/api/v1/projects/' + scope.projectId + '/invites',
    'POST',
    body,
    ownerCookie,
  );
  return { response, body };
}
async function uploadPhoto(albumId, filename) {
  const source = pngFixture();
  const sha256 = createHash('sha256').update(source).digest('hex');
  const init = await json(
    await request(
      '/api/v1/uploads/init',
      'POST',
      {
        requestId: randomUUID(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        albumId,
        originalFilename: filename,
        expectedBytes: source.byteLength,
        contentType: 'image/png',
        sha256,
      },
      ownerCookie,
    ),
    201,
    'upload init',
  );
  const uploadId = init.uploadSession.id;
  await status(
    await request(
      '/api/v1/uploads/' + uploadId + '/authorize',
      'POST',
      {
        requestId: randomUUID(),
      },
      ownerCookie,
    ),
    200,
    'upload authorize',
  );
  const reserved = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(uploadId)
    .first();
  await storage.put(reserved.object_key, new Uint8Array(source), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256,
  });
  const completed = await json(
    await request(
      '/api/v1/uploads/' + uploadId + '/complete',
      'POST',
      {
        requestId: randomUUID(),
      },
      ownerCookie,
    ),
    200,
    'upload complete',
  );
  const assetId = completed.completion.assetId;
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
    .bind(scope.projectId, albumId, assetId)
    .first();
  const thumbnail = await db
    .prepare(
      "SELECT object_key,checksum_sha256,state FROM photo_assets WHERE version_id=? AND asset_kind='thumbnail'",
    )
    .bind(photo.versionId)
    .first();
  assert.ok(photo?.photoId && photo?.versionId && thumbnail);
  assert.equal(thumbnail.state, 'private');
  return { photo, thumbnail };
}
const tokenHash = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');
async function seedForeignInvite() {
  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  await db.batch([
    db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',NULL,521,?,?,?,?)",
      )
      .bind(
        id,
        scope.workspaceId,
        scope.projectId,
        tokenHash(token),
        Date.now() + 1800000,
        1,
        owner,
        ownerSessionId,
      ),
    db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(id, scope.workspaceId, scope.projectId, FOREIGN_ALBUM_ID),
    db.prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)').bind(id),
  ]);
  return { id, token };
}
async function counts(inviteId) {
  return db
    .prepare(
      'SELECT (SELECT count(*) FROM guest_sessions WHERE invite_id=?) AS sessions,(SELECT count(*) FROM guest_exchange_commands WHERE invite_id=?) AS exchanges,(SELECT count(*) FROM guest_identities WHERE invite_id=?) AS identities',
    )
    .bind(inviteId, inviteId, inviteId)
    .first();
}
async function exchange(invite, options = {}) {
  return request(
    '/api/guest/exchange',
    'POST',
    {
      requestId: options.requestId ?? randomUUID(),
      token: invite.token,
      displayName: 'Native Guest',
    },
    undefined,
    options,
  );
}

async function run() {
  const migrations = (await readdir('migrations'))
    .filter((name) => /^\d{4}.*\.sql$/u.test(name))
    .sort();
  assert.equal(migrations.length, 57);
  for (const name of migrations)
    await applyMigration(
      db,
      await readFile(resolve('migrations', name), 'utf8'),
    );
  record('full-57-migration-native-d1');

  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'native-guest-validation-only')
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
  await db.batch([
    db
      .prepare(
        'INSERT INTO workspaces(id,name,owner_user_id,quota_bytes) VALUES(?,?,?,?)',
      )
      .bind(scope.workspaceId, 'Native Guest fixture', owner, 9000000000),
    db
      .prepare(
        "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
      )
      .bind(scope.projectId, scope.workspaceId, 'Native Guest fixture'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(
        scope.albumId,
        scope.workspaceId,
        scope.projectId,
        'Fixed synthetic album',
      ),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(
        FOREIGN_ALBUM_ID,
        scope.workspaceId,
        scope.projectId,
        'Foreign album',
      ),
  ]);

  const capability = await json(
    await request(
      '/api/v1/invites/capabilities',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'Owner session',
  );
  assert.deepEqual(capability.validationScope, {
    projectId: scope.projectId,
    albumId: scope.albumId,
  });
  assert.deepEqual(
    [
      capability.issuanceEnabled,
      capability.exchangeEnabled,
      capability.selectionEnabled,
      capability.feedbackEnabled,
      capability.tagsEnabled,
    ],
    [true, true, true, false, false],
  );
  record('owner-capability-scope-and-flags');

  for (const name of [
    'missing-flag',
    'wrong-origin',
    'wrong-account',
    'wrong-bucket',
    'production',
  ]) {
    const worker = await mf.getWorker(name);
    assert.equal(
      (await worker.fetch(new Request(origin + '/'))).status,
      503,
      name,
    );
    record(name + '-config-closed');
  }
  assert.equal(
    (await app.fetch(new Request('https://foreign.example/'))).status,
    403,
  );
  assert.equal(
    (await request('/api/auth/sign-up/email', 'POST', {}, undefined)).status,
    404,
  );
  assert.equal(
    (await request('/guest/albums/' + scope.albumId + '/enter')).status,
    200,
  );
  assert.equal(
    (await request('/guest/albums/' + FOREIGN_ALBUM_ID + '/enter')).status,
    404,
  );
  record('wrong-host-registration-and-entry-denials');

  const photo = await uploadPhoto(scope.albumId, 'staging-guest-photo.png');
  const foreignPhoto = await uploadPhoto(
    FOREIGN_ALBUM_ID,
    'foreign-scope-photo.png',
  );
  record('native-r2-upload-localsharp-private-assets');

  for (const [options, label] of [
    [{ accessMode: 'generated_password' }, 'generated-password-denied'],
    [
      { accessMode: 'custom_password', password: 'synthetic only' },
      'custom-password-denied',
    ],
    [
      { permissions: { ...permissions, can_tag: true } },
      'unsupported-permission-denied',
    ],
    [{ albumIds: [FOREIGN_ALBUM_ID] }, 'foreign-album-invite-denied'],
  ]) {
    const before = await db
      .prepare('SELECT count(*) AS n FROM guest_invites WHERE created_by=?')
      .bind(owner)
      .first();
    const { response } = await issueInvite(options);
    assert.notEqual(response.status, 200, label);
    const after = await db
      .prepare('SELECT count(*) AS n FROM guest_invites WHERE created_by=?')
      .bind(owner)
      .first();
    assert.equal(after.n, before.n, label);
    record(label);
  }

  const { response: inviteResponse } = await issueInvite();
  const inviteBody = await json(inviteResponse, 200, 'link-only invite');
  assert.equal(inviteBody.secretAvailable, true);
  assert.match(inviteBody.token, /^[a-f0-9]{64}$/);
  const inviteId = inviteBody.invite.inviteId;
  const grant = await db
    .prepare(
      'SELECT i.access_mode,i.permissions_mask,count(a.album_id) AS albums,max(a.album_id) AS album_id FROM guest_invites i JOIN guest_invite_albums a ON a.invite_id=i.id WHERE i.id=? GROUP BY i.id',
    )
    .bind(inviteId)
    .first();
  assert.deepEqual(
    [grant.access_mode, grant.permissions_mask, grant.albums, grant.album_id],
    ['link_only', 521, 1, scope.albumId],
  );

  const invite = { inviteId, token: inviteBody.token };
  const before = await counts(inviteId);
  await status(
    await exchange(invite, { noOrigin: true }),
    403,
    'missing Origin',
  );
  await status(
    await exchange(invite, { origin: 'https://foreign.example' }),
    403,
    'foreign Origin',
  );
  await guestDenied(
    await exchange(invite, { cfWorker: true }),
    401,
    'CF-Worker',
  );
  assert.deepEqual(await counts(inviteId), before);

  const foreignInvite = await seedForeignInvite();
  const foreignCounts = await counts(foreignInvite.id);
  await guestDenied(
    await exchange(foreignInvite),
    401,
    'sealed foreign invite',
  );
  assert.deepEqual(await counts(foreignInvite.id), foreignCounts);
  record('origin-cf-worker-and-sealed-out-of-scope-denials');

  const exchangeRequestId = randomUUID();
  const exchangeResponse = await exchange(invite, {
    requestId: exchangeRequestId,
  });
  const exchangeBody = await json(exchangeResponse, 200, 'Guest exchange');
  assert.equal(exchangeBody.authenticated, true);
  const secret = secureCookie(
    exchangeResponse.headers.get('set-cookie'),
    '__Host-kino_guest',
  );
  await guestDenied(
    await exchange(invite, { requestId: exchangeRequestId }),
    401,
    'exact exchange replay',
  );
  assert.deepEqual(await counts(inviteId), {
    sessions: 1,
    exchanges: 1,
    identities: 1,
  });
  record('secure-cookie-and-exact-replay-denied');

  const gallery = await json(
    await request(
      '/api/guest/albums/' + scope.albumId + '/photos',
      'GET',
      undefined,
      guestCookie(secret),
    ),
    200,
    'Guest gallery',
  );
  assert.ok(gallery.photos.some((item) => item.id === photo.photo.photoId));
  assert.doesNotMatch(
    JSON.stringify(gallery),
    /objectKey|storageNodeId|checksum|sha256|assetId/u,
  );
  const asset = await request(
    '/api/guest/photos/' +
      photo.photo.photoId +
      '/versions/' +
      photo.photo.versionId +
      '/assets/thumbnail',
    'GET',
    undefined,
    guestCookie(secret),
  );
  await status(asset, 200, 'Guest private thumbnail');
  const bytes = Buffer.from(await asset.arrayBuffer());
  const stored = await storage.get(photo.thumbnail.object_key);
  assert.ok(stored);
  assert.deepEqual(bytes, Buffer.from(await stored.arrayBuffer()));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    photo.thumbnail.checksum_sha256,
  );
  await guestDenied(
    await request(
      '/api/guest/albums/' + FOREIGN_ALBUM_ID + '/photos',
      'GET',
      undefined,
      guestCookie(secret),
    ),
    404,
    'foreign album',
  );
  await guestDenied(
    await request(
      '/api/guest/photos/' +
        foreignPhoto.photo.photoId +
        '/versions/' +
        foreignPhoto.photo.versionId +
        '/assets/thumbnail',
      'GET',
      undefined,
      guestCookie(secret),
    ),
    404,
    'foreign asset route',
  );
  record('private-gallery-thumbnail-and-foreign-scope');

  await guestDenied(
    await request(
      '/api/guest/albums/' +
        scope.albumId +
        '/photos/' +
        photo.photo.photoId +
        '/tags',
      'PUT',
      { requestId: randomUUID(), tags: [] },
      guestCookie(secret),
    ),
    404,
    'unsupported tag write',
  );
  await status(
    await request(
      '/api/guest/albums/' + scope.albumId + '/selection',
      'DELETE',
      undefined,
      guestCookie(secret),
    ),
    405,
    'unsupported Guest method',
  );

  await status(
    await request(
      '/api/guest/albums/' +
        scope.albumId +
        '/photos/' +
        photo.photo.photoId +
        '/selection',
      'PUT',
      {
        requestId: randomUUID(),
        selected: true,
        versionId: photo.photo.versionId,
      },
      guestCookie(secret),
    ),
    200,
    'Guest selection',
  );
  await status(
    await request(
      '/api/guest/albums/' + scope.albumId + '/selection/submit',
      'POST',
      {
        requestId: randomUUID(),
        expectedRoundNo: 1,
        expectedRevision: 1,
      },
      guestCookie(secret),
    ),
    200,
    'Guest submission',
  );
  const submission = await db
    .prepare(
      'SELECT id FROM guest_selection_submissions WHERE invite_id=? AND album_id=?',
    )
    .bind(inviteId, scope.albumId)
    .first();
  assert.ok(submission?.id);
  assert.equal(
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM guest_selection_submission_items WHERE submission_id=?',
        )
        .bind(submission.id)
        .first()
    ).n,
    1,
  );
  record('Guest-selection-and-submission');

  const ownerSubs = await json(
    await request(
      '/api/v1/albums/' + scope.albumId + '/submissions',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'Owner submissions',
  );
  const same = ownerSubs.submissions.find((item) => item.id === submission.id);
  assert.equal(same.inviteId, inviteId);
  const beforeExport = await db
    .prepare(
      "SELECT count(*) AS n FROM audit_events WHERE action='download.generated'",
    )
    .first();
  const exported = await request(
    '/api/v1/albums/' +
      scope.albumId +
      '/submissions/' +
      submission.id +
      '/export?format=csv',
    'GET',
    undefined,
    ownerCookie,
  );
  await status(exported, 200, 'Owner export');
  assert.ok((await exported.text()).includes('staging-guest-photo.png'));
  const afterExport = await db
    .prepare(
      "SELECT count(*) AS n FROM audit_events WHERE action='download.generated'",
    )
    .first();
  assert.equal(afterExport.n, beforeExport.n + 1);
  record('Owner-same-submission-export-audited');

  const logout = await request(
    '/api/guest/logout',
    'POST',
    { requestId: randomUUID() },
    guestCookie(secret),
  );
  await status(logout, 200, 'Guest logout');
  assert.match(logout.headers.get('set-cookie') ?? '', /^__Host-kino_guest=;/u);
  await guestDenied(
    await request(
      '/api/guest/albums/' + scope.albumId + '/photos',
      'GET',
      undefined,
      guestCookie(secret),
    ),
    401,
    'revoked Guest session',
  );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  record('secure-logout-and-foreign-key-check');

  const proof = {
    status: 'passed_local_staging_guest_validation',
    runtime: 'Miniflare native workerd with ephemeral D1 and R2',
    migrationCount: migrations.length,
    checks,
    sourceSha256: createHash('sha256')
      .update(await readFile('tools/staging-guest-validation-worker.ts'))
      .digest('hex'),
    configSha256: createHash('sha256')
      .update(await readFile(configPath))
      .digest('hex'),
    bundleSha256: createHash('sha256')
      .update(await readFile(bundle))
      .digest('hex'),
    imageFixtures: 2,
    guestSubmissions: 1,
    realOAuth: false,
    remoteCloudflare: false,
    hostedDeployment: false,
    browserOrPublicTLS: false,
    trustedClientIpBehavior: 'not_checked',
    expiredInviteBehavior: 'not_checked',
  };
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/staging-guest-validation-local-proof.json',
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
