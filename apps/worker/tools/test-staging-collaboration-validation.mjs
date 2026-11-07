import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import ts from 'typescript';
import { applyMigration } from '../tests/apply-migration.mjs';
import { pngFixture } from '../tests/image-fixtures.mjs';
import { testApprovedDeliveries } from '../tests/approved-deliveries.mjs';
import { testCaptureMetadata } from '../tests/capture-metadata.mjs';
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
      spec('platform-admin', { ORACLE_STORAGE_ADMIN_USER_ID: owner }),
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
  if (options.expectedActor)
    headers.set('X-Kino-Expected-Actor', options.expectedActor);
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
async function uploadPhoto(target = scope) {
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
        projectId: target.projectId,
        albumId: target.albumId,
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
  assert.equal(recoveredUpload.uploadSession.albumId, target.albumId);
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
    .bind(target.projectId, target.albumId, assetId)
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
async function seedForeignInvite(
  token,
  target = { ...scope, albumId: FOREIGN_ALBUM_ID },
) {
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
        target.workspaceId,
        target.projectId,
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
      .bind(inviteId, target.workspaceId, target.projectId, target.albumId),
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
  const activityCapabilities = await json(
    await app.fetch(new Request(origin + '/api/client-activity/capabilities')),
    200,
    'background activity capabilities',
  );
  assert.equal(activityCapabilities.enabled, true);
  await status(
    await app.fetch(new Request(origin + '/api/v1/storage/oracle-policy')),
    401,
    'Oracle settings require Owner',
  );
  const platform = await mf.getWorker('platform-admin');
  const oraclePolicy = await json(
    await platform.fetch(
      new Request(origin + '/api/v1/storage/oracle-policy', {
        headers: { Cookie: ownerCookie },
      }),
    ),
    200,
    'platform Owner Oracle settings',
  );
  assert.equal(oraclePolicy.quotaGb, 30);
  assert.equal(oraclePolicy.effectiveEnabled, false);
  await status(
    await app.fetch(
      new Request(origin + '/api/v1/storage/oracle-policy', {
        headers: { Cookie: ownerCookie },
      }),
    ),
    404,
    'non-platform Owner Oracle settings denied',
  );
  const processingPath =
    '/api/v1/workspaces/' + scope.workspaceId + '/image-processing-policy';
  await status(
    await request(processingPath),
    401,
    'processing policy requires Owner',
  );
  const processingPolicy = await json(
    await request(processingPath, 'GET', undefined, ownerCookie),
    200,
    'scoped Owner processing policy',
  );
  assert.equal(processingPolicy.workspaceId, scope.workspaceId);
  assert.equal(typeof processingPolicy.processingEnabled, 'boolean');
  await status(
    await request(
      processingPath.replace(scope.workspaceId, randomUUID()),
      'GET',
      undefined,
      ownerCookie,
    ),
    404,
    'foreign workspace processing denied',
  );
  await status(
    await request(
      processingPath + '?workspaceId=' + randomUUID(),
      'GET',
      undefined,
      ownerCookie,
    ),
    404,
    'processing query scope injection denied',
  );
  const processingCommand = {
    requestId: randomUUID(),
    expectedRevision: processingPolicy.revision,
    recipe: processingPolicy.recipe,
  };
  const saveProcessing = (
    actor = owner,
    target = processingPath,
    requestOrigin = origin,
  ) =>
    request(target, 'POST', processingCommand, ownerCookie, {
      origin: requestOrigin,
      expectedActor: actor,
    });
  const savedProcessing = await json(
    await saveProcessing(),
    200,
    'Owner processing policy save',
  );
  assert.equal(savedProcessing.workspaceId, scope.workspaceId);
  assert.deepEqual(
    await json(await saveProcessing(), 200, 'processing policy exact replay'),
    savedProcessing,
  );
  await status(
    await saveProcessing(randomUUID()),
    409,
    'processing policy stale identity denied',
  );
  await status(
    await saveProcessing(owner, processingPath, 'https://foreign.example'),
    403,
    'processing policy foreign Origin denied',
  );
  await status(
    await saveProcessing(
      owner,
      processingPath.replace(scope.workspaceId, randomUUID()),
    ),
    404,
    'processing policy foreign workspace write denied',
  );
  record('oracle-policy-platform-only-and-background-activity-routing');

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
  assert.equal(ownerCapabilities.validationScope.passwordModes, true);
  record('owner-auth-and-scoped-collaboration-capabilities');

  // Exercise the deployed wrapper as well as product middleware; neither may pin new IDs to the fixture.
  const managedProject = (
    await json(
      await request(
        '/api/v1/projects',
        'POST',
        {
          workspaceId: scope.workspaceId,
          name: 'Managed Owner project',
          requestId: randomUUID(),
        },
        ownerCookie,
      ),
      201,
      'managed Owner project creation through profile',
    )
  ).project;
  const managedProjectRoot = '/api/v1/projects/' + managedProject.id;
  const emptyManagedAlbums = await json(
    await request(
      managedProjectRoot + '/albums',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'new managed project albums through profile',
  );
  assert.equal(emptyManagedAlbums.project.id, managedProject.id);
  assert.deepEqual(emptyManagedAlbums.albums, []);
  const managedAlbum = (
    await json(
      await request(
        managedProjectRoot + '/albums',
        'POST',
        {
          name: 'Managed Owner album',
          requestId: randomUUID(),
        },
        ownerCookie,
      ),
      201,
      'managed Owner album creation through profile',
    )
  ).album;
  const managedAlbumRoot = '/api/v1/albums/' + managedAlbum.id;
  const managedAlbums = await json(
    await request(
      managedProjectRoot + '/albums',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'managed album appears in project list',
  );
  assert.equal(managedAlbums.albums.length, 1);
  assert.equal(managedAlbums.albums[0].id, managedAlbum.id);
  const managedPreview = await json(
    await request(
      managedAlbumRoot + '/deletion',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'managed album deletion preview through profile',
  );
  assert.equal(managedPreview.album.id, managedAlbum.id);
  assert.equal(managedPreview.preview.assetCount, 0);
  assert.equal(managedPreview.preview.totalBytes, 0);
  assert.deepEqual(managedPreview.preview.blockers, []);
  assert.equal(managedPreview.job, null);
  const managedAlbumDelete = {
    requestId: randomUUID(),
    expectedRevision: managedPreview.album.revision,
    confirmationName: managedAlbum.name,
    inventoryCount: managedPreview.preview.assetCount,
    bytesBefore: managedPreview.preview.totalBytes,
    confirmPermanent: true,
  };
  await status(
    await request(managedAlbumRoot, 'DELETE', managedAlbumDelete, ownerCookie, {
      origin: 'https://foreign.example',
    }),
    403,
    'foreign Origin cannot start managed album deletion',
  );
  assert.equal(
    (
      await json(
        await request(
          managedAlbumRoot + '/deletion',
          'GET',
          undefined,
          ownerCookie,
        ),
        200,
        'foreign Origin deletion made no job',
      )
    ).job,
    null,
  );
  const managedDeletedAlbum = await json(
    await request(managedAlbumRoot, 'DELETE', managedAlbumDelete, ownerCookie),
    200,
    'managed album deletion through profile',
  );
  assert.equal(managedDeletedAlbum.job.status, 'completed');
  const managedCompletedJob = await json(
    await request(
      managedAlbumRoot + '/deletion',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'managed completed deletion remains readable',
  );
  assert.equal(managedCompletedJob.job.status, 'completed');
  assert.equal(managedCompletedJob.job.id, managedDeletedAlbum.job.id);
  const managedProjectDeleted = await json(
    await request(
      managedProjectRoot,
      'DELETE',
      {
        requestId: randomUUID(),
        confirmationName: managedProject.name,
        expectedRevision: managedProject.revision,
      },
      ownerCookie,
    ),
    200,
    'managed project deletion through profile',
  );
  assert.equal(managedProjectDeleted.deleted, true);
  assert.equal(managedProjectDeleted.id, managedProject.id);
  await status(
    await request(managedProjectRoot, 'GET', undefined, ownerCookie),
    404,
    'deleted managed project is no longer readable',
  );
  const collaborationProject = (
    await json(
      await request(
        '/api/v1/projects',
        'POST',
        {
          workspaceId: scope.workspaceId,
          name: 'Managed collaboration reads',
          requestId: randomUUID(),
        },
        ownerCookie,
      ),
      201,
      'managed collaboration project',
    )
  ).project;
  const collaborationAlbum = (
    await json(
      await request(
        '/api/v1/projects/' + collaborationProject.id + '/albums',
        'POST',
        {
          name: 'Managed collaboration reads',
          requestId: randomUUID(),
        },
        ownerCookie,
      ),
      201,
      'managed collaboration album',
    )
  ).album;
  const target = {
    ...scope,
    projectId: collaborationProject.id,
    albumId: collaborationAlbum.id,
  };
  await json(
    await request(
      '/api/v1/albums/' + target.albumId + '/activate',
      'POST',
      {
        requestId: randomUUID(),
        expectedRevision: collaborationAlbum.revision,
        confirmActivate: true,
      },
      ownerCookie,
    ),
    200,
    'activate managed collaboration fixture',
  );
  const managedPhoto = (await uploadPhoto(target)).photo;
  const invitationPath = '/api/v1/projects/' + target.projectId + '/invites';
  const managedInviteRequest = {
    requestId: randomUUID(),
    albumIds: [target.albumId],
    accessMode: 'link_only',
    permissions: allPermissions,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    maxUses: 10,
  };
  const managedIssued = await json(
    await request(invitationPath, 'POST', managedInviteRequest, ownerCookie),
    200,
    'managed Owner invitation issuance',
  );
  const managedInvite = managedIssued.invite.inviteId;
  const recoveredManaged = await json(
    await request(
      '/api/v1/invites/creation/' + managedInviteRequest.requestId,
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'managed exact invitation recovery',
  );
  assert.equal(recoveredManaged.invite.inviteId, managedInvite);
  assert.equal(recoveredManaged.secretAvailable, false);
  assert.doesNotMatch(
    JSON.stringify(recoveredManaged),
    new RegExp(managedIssued.token),
  );
  await status(
    await request(invitationPath, 'POST', managedInviteRequest, ownerCookie, {
      origin: 'https://foreign.example',
    }),
    403,
    'managed issuance rejects foreign Origin',
  );
  await status(
    await request(
      invitationPath,
      'POST',
      {
        ...managedInviteRequest,
        requestId: randomUUID(),
        albumIds: [scope.albumId],
      },
      ownerCookie,
    ),
    409,
    'managed issuance rejects cross-project album',
  );
  const otherInvite = await seedForeignInvite(
    randomBytes(32).toString('hex'),
    scope,
  );
  await status(
    await request(invitationPath),
    401,
    'managed invite read requires Owner',
  );
  const invitations = await json(
    await request(invitationPath, 'GET', undefined, ownerCookie),
    200,
    'managed invite read',
  );
  assert.deepEqual(
    invitations.invites.map((i) => i.id),
    [managedInvite],
  );
  await status(
    await request(invitationPath, 'POST', {}, ownerCookie),
    400,
    'managed issuance validates input',
  );
  const versions = await json(
    await request(
      '/api/v1/photos/' + managedPhoto.photoId + '/versions',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'managed version read',
  );
  assert.equal(versions.photoId, managedPhoto.photoId);
  assert.equal(versions.current.versionId, managedPhoto.versionId);
  const photoRoot =
    '/api/v1/albums/' +
    target.albumId +
    '/photos/' +
    managedPhoto.photoId +
    '/versions/' +
    managedPhoto.versionId;
  for (const suffix of [
    'comment-threads',
    'annotations',
    'annotations/owner',
  ]) {
    const readPath = photoRoot + '/' + suffix + '?inviteId=' + managedInvite;
    const page = await json(
      await request(readPath, 'GET', undefined, ownerCookie),
      200,
      'managed ' + suffix + ' read',
    );
    assert.equal(page.inviteId, managedInvite);
    await status(
      await request(
        photoRoot + '/' + suffix + '?inviteId=' + otherInvite,
        'GET',
        undefined,
        ownerCookie,
      ),
      404,
      'cross-album invite denied for ' + suffix,
    );
    await status(
      await request(readPath),
      401,
      'unauthenticated ' + suffix + ' denied',
    );
  }
  const managedExchangeResponse = await request('/api/guest/exchange', 'POST', {
    requestId: randomUUID(),
    token: managedIssued.token,
    displayName: 'Managed synthetic Guest',
  });
  const managedExchange = await json(
    managedExchangeResponse,
    200,
    'managed Guest exchange',
  );
  assert.equal(managedExchange.authenticated, true);
  const managedCookie = guestCookie(
    secureGuestCookie(managedExchangeResponse.headers.get('set-cookie')),
  );
  for (const suffix of ['', '/enter'])
    await status(
      await request('/guest/albums/' + target.albumId + suffix),
      200,
      'managed Guest entry page',
    );
  const managedGuestRoot = '/api/guest/albums/' + target.albumId;
  const managedPhotos = await json(
    await request(
      managedGuestRoot + '/photos',
      'GET',
      undefined,
      managedCookie,
    ),
    200,
    'managed Guest photo page',
  );
  assert.equal(managedPhotos.photos.length, 1);
  const selectedManaged = await json(
    await request(
      managedGuestRoot + '/photos/' + managedPhoto.photoId + '/selection',
      'PUT',
      {
        requestId: randomUUID(),
        selected: true,
        versionId: managedPhoto.versionId,
      },
      managedCookie,
    ),
    200,
    'managed Guest selection write',
  );
  assert.equal(selectedManaged.selected, true);
  const managedSelection = await json(
    await request(
      managedGuestRoot + '/selection',
      'GET',
      undefined,
      managedCookie,
    ),
    200,
    'managed Guest selection read',
  );
  assert.equal(managedSelection.selectedCount, 1);

  await status(
    await request(
      '/api/guest/photos/' +
        managedPhoto.photoId +
        '/versions/' +
        managedPhoto.versionId +
        '/assets/thumbnail',
      'GET',
      undefined,
      managedCookie,
    ),
    200,
    'managed Guest private thumbnail',
  );
  await status(
    await request(
      '/api/guest/albums/' + scope.albumId + '/photos',
      'GET',
      undefined,
      managedCookie,
    ),
    401,
    'managed Guest cannot access another project',
  );
  const secondAlbum = (
    await json(
      await request(
        '/api/v1/projects/' + target.projectId + '/albums',
        'POST',
        { name: 'Separate managed album', requestId: randomUUID() },
        ownerCookie,
      ),
      201,
      'second managed album',
    )
  ).album;
  await status(
    await request(
      '/api/v1/albums/' + secondAlbum.id + '/activate',
      'POST',
      {
        requestId: randomUUID(),
        expectedRevision: secondAlbum.revision,
        confirmActivate: true,
      },
      ownerCookie,
    ),
    200,
    'activate second managed album',
  );
  await status(
    await request(
      '/api/guest/albums/' + secondAlbum.id + '/photos',
      'GET',
      undefined,
      managedCookie,
    ),
    401,
    'same-project unshared album denied',
  );
  const downloadPermissions = Object.fromEntries(
    guestPermissionNames.map((name) => [
      name,
      name === 'can_download_original',
    ]),
  );
  const downloadIssued = await json(
    await request(
      invitationPath,
      'POST',
      {
        ...managedInviteRequest,
        requestId: randomUUID(),
        permissions: downloadPermissions,
      },
      ownerCookie,
    ),
    200,
    'managed download-only invitation',
  );
  const downloadExchange = await request('/api/guest/exchange', 'POST', {
    requestId: randomUUID(),
    token: downloadIssued.token,
    displayName: 'Download-only synthetic Guest',
  });
  await status(downloadExchange, 200, 'managed download-only exchange');
  const downloadCookie = guestCookie(
    secureGuestCookie(downloadExchange.headers.get('set-cookie')),
  );
  await status(
    await request(
      '/api/guest/photos/' +
        managedPhoto.photoId +
        '/versions/' +
        managedPhoto.versionId +
        '/downloads/original',
      'GET',
      undefined,
      downloadCookie,
    ),
    200,
    'managed original download does not require view',
  );
  await status(
    await request(
      managedGuestRoot + '/photos',
      'GET',
      undefined,
      downloadCookie,
    ),
    401,
    'download-only cannot view',
  );
  await status(
    await request(
      '/api/guest/photos/' +
        managedPhoto.photoId +
        '/versions/' +
        managedPhoto.versionId +
        '/assets/thumbnail',
      'GET',
      undefined,
      downloadCookie,
    ),
    401,
    'download-only cannot preview',
  );

  await testCaptureMetadata({
    db,
    request,
    owner,
    ownerCookie,
    storage,
    target,
  });
  await testApprovedDeliveries({
    request,
    db,
    owner,
    ownerCookie,
    target,
    photo: managedPhoto,
    nonmemberCookie: managedCookie,
  });

  const generatedRequest = {
    ...managedInviteRequest,
    requestId: randomUUID(),
    accessMode: 'generated_password',
  };
  const generatedIssued = await json(
    await request(invitationPath, 'POST', generatedRequest, ownerCookie),
    200,
    'managed generated-password invitation',
  );
  assert.equal(generatedIssued.secretAvailable, true);
  assert.match(generatedIssued.generatedPassword, /^[0-9]{5}$/);
  const generatedVerifier = await db
    .prepare(
      'SELECT i.access_mode,i.password_verifier FROM guest_invites i WHERE i.id=?',
    )
    .bind(generatedIssued.invite.inviteId)
    .first();
  assert.equal(generatedVerifier.access_mode, 'generated_password');
  assert.match(
    generatedVerifier.password_verifier,
    /^\$kino-scrypt\$v=1\$N=32768,r=8,p=3\$[a-f0-9]{32}\$[a-f0-9]{64}$/,
  );
  assert.notEqual(
    generatedVerifier.password_verifier,
    generatedIssued.generatedPassword,
  );
  const generatedRecovery = await json(
    await request(
      '/api/v1/invites/creation/' + generatedRequest.requestId,
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'managed generated-password recovery',
  );
  assert.equal(generatedRecovery.secretAvailable, false);
  assert.doesNotMatch(
    JSON.stringify(generatedRecovery),
    /"(?:token|generatedPassword|password)"\s*:/,
  );
  const wrongGeneratedPassword =
    generatedIssued.generatedPassword === '00000' ? '00001' : '00000';
  const generatedWrongRequestId = randomUUID();
  const generatedWrong = await request('/api/guest/exchange', 'POST', {
    requestId: generatedWrongRequestId,
    token: generatedIssued.token,
    displayName: 'Generated-password denial',
    password: wrongGeneratedPassword,
  });
  await status(generatedWrong, 401, 'generated-password denial');
  assert.equal(generatedWrong.headers.get('set-cookie'), null);
  const generatedSuccessRequestId = randomUUID();
  const generatedSuccess = await request('/api/guest/exchange', 'POST', {
    requestId: generatedSuccessRequestId,
    token: generatedIssued.token,
    displayName: 'Generated-password Guest',
    password: generatedIssued.generatedPassword,
  });
  assert.equal(
    (await json(generatedSuccess, 200, 'generated-password exchange'))
      .authenticated,
    true,
  );
  secureGuestCookie(generatedSuccess.headers.get('set-cookie'));

  const customPassword = randomBytes(24).toString('base64url');
  const customRequest = {
    ...managedInviteRequest,
    requestId: randomUUID(),
    accessMode: 'custom_password',
    password: customPassword,
  };
  const customIssued = await json(
    await request(invitationPath, 'POST', customRequest, ownerCookie),
    200,
    'managed custom-password invitation',
  );
  assert.equal(customIssued.secretAvailable, true);
  assert.equal(customIssued.generatedPassword, null);
  const customVerifier = await db
    .prepare(
      'SELECT i.access_mode,i.password_verifier FROM guest_invites i WHERE i.id=?',
    )
    .bind(customIssued.invite.inviteId)
    .first();
  assert.equal(customVerifier.access_mode, 'custom_password');
  assert.match(
    customVerifier.password_verifier,
    /^\$kino-scrypt\$v=1\$N=32768,r=8,p=3\$[a-f0-9]{32}\$[a-f0-9]{64}$/,
  );
  assert.notEqual(customVerifier.password_verifier, customPassword);
  const customRecovery = await json(
    await request(
      '/api/v1/invites/creation/' + customRequest.requestId,
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'managed custom-password recovery',
  );
  assert.equal(customRecovery.secretAvailable, false);
  assert.doesNotMatch(
    JSON.stringify(customRecovery),
    /"(?:token|generatedPassword|password)"\s*:/,
  );
  const customWrongRequestId = randomUUID();
  const customWrongPassword = randomBytes(24).toString('base64url');
  const customWrong = await request('/api/guest/exchange', 'POST', {
    requestId: customWrongRequestId,
    token: customIssued.token,
    displayName: 'Custom-password denial',
    password: customWrongPassword,
  });
  await status(customWrong, 401, 'custom-password denial');
  assert.equal(customWrong.headers.get('set-cookie'), null);
  const crossInviteRequestId = randomUUID();
  const crossInvitePassword = await request('/api/guest/exchange', 'POST', {
    requestId: crossInviteRequestId,
    token: generatedIssued.token,
    displayName: 'Cross-invite password denial',
    password: customPassword,
  });
  await status(crossInvitePassword, 401, 'cross-invite password denied');
  assert.equal(crossInvitePassword.headers.get('set-cookie'), null);
  const customSuccessRequestId = randomUUID();
  const customSuccess = await request('/api/guest/exchange', 'POST', {
    requestId: customSuccessRequestId,
    token: customIssued.token,
    displayName: 'Custom-password Guest',
    password: customPassword,
  });
  assert.equal(
    (await json(customSuccess, 200, 'custom-password exchange')).authenticated,
    true,
  );
  secureGuestCookie(customSuccess.headers.get('set-cookie'));

  const ownerPermits = await db
    .prepare(
      `SELECT count(*) AS permits,count(r.permit_id) AS released
       FROM kdf_permits p LEFT JOIN kdf_permit_releases r ON r.permit_id=p.id
       WHERE p.actor_id=? AND p.session_id=? AND p.request_id IN(?,?)`,
    )
    .bind(
      owner,
      ownerSessionId,
      generatedRequest.requestId,
      customRequest.requestId,
    )
    .first();
  assert.deepEqual([ownerPermits.permits, ownerPermits.released], [2, 2]);
  const guestPermits = await db
    .prepare(
      `SELECT count(*) AS permits,count(r.permit_id) AS released
       FROM guest_kdf_permits p LEFT JOIN guest_kdf_permit_releases r ON r.permit_id=p.id
       WHERE p.request_id IN(?,?,?,?,?)`,
    )
    .bind(
      generatedWrongRequestId,
      generatedSuccessRequestId,
      customWrongRequestId,
      crossInviteRequestId,
      customSuccessRequestId,
    )
    .first();
  assert.deepEqual([guestPermits.permits, guestPermits.released], [5, 5]);
  const logoutManaged = await request(
    '/api/guest/logout',
    'POST',
    { requestId: randomUUID() },
    downloadCookie,
  );
  await status(logoutManaged, 200, 'managed Guest logout');
  assert.match(logoutManaged.headers.get('set-cookie'), /Max-Age=0/);
  await status(
    await request(
      '/api/v1/invites/' + managedInvite + '/revoke',
      'POST',
      { requestId: randomUUID(), confirmRevoke: true },
      ownerCookie,
    ),
    200,
    'managed invitation revocation',
  );
  await status(
    await request(
      managedGuestRoot + '/photos',
      'GET',
      undefined,
      managedCookie,
    ),
    401,
    'managed revoked session denied',
  );
  await status(
    await request('/api/guest/exchange', 'POST', {
      requestId: randomUUID(),
      token: managedIssued.token,
      displayName: 'Revoked synthetic Guest',
    }),
    401,
    'managed revoked link denied',
  );
  // Inject a retired scope in the isolated fixture; this does not claim archive API acceptance.
  await db
    .prepare(
      "UPDATE projects SET status='archived',archived_from_status='draft' WHERE id=?",
    )
    .bind(target.projectId)
    .run();
  await status(
    await request(
      '/api/guest/logout',
      'POST',
      { requestId: randomUUID() },
      managedCookie,
    ),
    200,
    'managed Guest can logout after archived-state fixture and revocation',
  );
  const approvals = await json(
    await request(
      '/api/v1/version-approvals/capabilities',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'approval capability is available in the scoped B profile',
  );
  assert.equal(approvals.enabled, true);
  for (const path of [
    '/api/guest/version-approvals/capabilities',
    '/api/guest/shared-reviews/capabilities',
  ]) {
    const capability = await json(
      await request(path),
      200,
      'disabled Guest capability reports unavailable without error',
    );
    assert.equal(capability.enabled, path.includes('version-approvals'));
    await status(
      await request(path, 'POST', {}),
      404,
      'Guest capability does not grant a write route',
    );
  }
  record('managed-owner-create-read-and-manual-delete-through-profile');

  for (const [path, label] of [
    ['/api/v1/projects/' + randomUUID(), 'foreign-project'],
    [
      '/api/v1/albums/' + FOREIGN_ALBUM_ID + '/selection-policy',
      'foreign-album-selection-policy',
    ],
    ['/api/v1/version-approvals/commands', 'adjacent-feature-route'],
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
  await status(
    await request(
      '/api/v1/albums/' + FOREIGN_ALBUM_ID + '/photos',
      'GET',
      undefined,
      ownerCookie,
    ),
    404,
    'unmanaged foreign album remains denied to Owner',
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
      approvedDeliveryMigration: sha256(
        await readFile('migrations/0066_approved_deliveries.sql'),
      ),
      approvedDeliveryService: sha256(
        await readFile('src/approved-deliveries.ts'),
      ),
      approvedDeliveryRoutes: sha256(
        await readFile('src/approved-delivery-routes.ts'),
      ),
      approvedDeliveryTest: sha256(
        await readFile('tests/approved-deliveries.mjs'),
      ),
      deliveryZipMigration: sha256(
        await readFile('migrations/0067_delivery_zip_tickets.sql'),
      ),
      deliveryZipService: sha256(await readFile('src/delivery-zips.ts')),
      deliveryZipRoutes: sha256(await readFile('src/delivery-zip-routes.ts')),
      zipStream: sha256(await readFile('src/zip-stream.ts')),
      deliveryZipTest: sha256(await readFile('tests/delivery-zips.mjs')),
      deliveryNotifications: sha256(
        await readFile('src/delivery-notifications.ts'),
      ),
      deliveryNotificationRoutes: sha256(
        await readFile('src/delivery-notification-routes.ts'),
      ),
      deliveryNotificationsTest: sha256(
        await readFile('tests/delivery-notifications.mjs'),
      ),
      captureMetadata: sha256(await readFile('src/capture-metadata.ts')),
      captureMetadataRoutes: sha256(
        await readFile('src/capture-metadata-routes.ts'),
      ),
      captureMetadataTest: sha256(await readFile('tests/capture-metadata.mjs')),
      deliveryZipContract: sha256(
        await readFile('../../packages/contracts/src/delivery-zips.ts'),
      ),
      deliveryNotificationContract: sha256(
        await readFile(
          '../../packages/contracts/src/delivery-notifications.ts',
        ),
      ),
      captureMetadataContract: sha256(
        await readFile('../../packages/contracts/src/capture-metadata.ts'),
      ),
      captureMetadataImageProcessing: sha256(
        await readFile(
          '../../packages/image-processing/src/capture-metadata.ts',
        ),
      ),
      profile: sha256(await readFile(configPath)),
      nativeTest: sha256(
        await readFile('tools/test-staging-collaboration-validation.mjs'),
      ),
      bundle: sha256(await readFile(bundle)),
    },
    approvedDeliveries: true,
    imageFixtures: 3,
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
