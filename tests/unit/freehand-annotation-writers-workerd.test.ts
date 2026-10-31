import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from '../../apps/worker/node_modules/hono';
import {
  Miniflare,
  convertV4MiniflareOptions,
} from '../../apps/worker/node_modules/miniflare/dist/src/index.js';
import { unstable_splitSqlQuery } from '../../apps/worker/node_modules/wrangler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guestAnnotationRoutes } from '../../apps/worker/src/guest-annotation-routes';
import { ownerAnnotationAuthoringRoutes } from '../../apps/worker/src/owner-annotation-authoring-routes';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../..');
const workerRoot = join(projectRoot, 'apps', 'worker');
const migrationDirectory = join(workerRoot, 'migrations');
const proposalPath = join(
  workerRoot,
  'migration-proposals',
  'annotation_freehand_geometry_v1.sql',
);
const migrationPath = join(
  migrationDirectory,
  '0058_annotation_freehand_geometry_v1.sql',
);
const temporaryRoot = resolve(tmpdir());
const base = 'http://127.0.0.1:8787';
const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  ownerSession: '12121212-1212-4121-8121-121212121212',
  workspace: '22222222-2222-4222-8222-222222222222',
  project: '33333333-3333-4333-8333-333333333333',
  album: '44444444-4444-4444-8444-444444444444',
  invite: '55555555-5555-4555-8555-555555555555',
  photo: '66666666-6666-4666-8666-666666666666',
  version: '77777777-7777-4777-8777-777777777777',
  guest: '88888888-8888-4888-8888-888888888888',
  guestSession: '99999999-9999-4999-8999-999999999999',
  uploadSession: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  original: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  otherIdentity: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
const guestSecret = 'f'.repeat(64);
const guestSecretHash = createHash('sha256')
  .update('kino-pic:guest-session:v1:' + guestSecret)
  .digest('hex');
const envBase = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  GUEST_EXCHANGE_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'false',
};

type AnnotationItem = {
  annotationId: string;
  photoId: string;
  versionId: string;
  revision: number;
  geometry: unknown;
  state: string;
};
type GuestResult = {
  requestId: string;
  operation: string;
  item: AnnotationItem;
};
type OwnerResult = {
  ownerId: string;
  requestId: string;
  operation: string;
  item: AnnotationItem & { inviteId: string; authorType: string };
};

let mf: Miniflare | undefined;
let db: D1Database;
let temporary: string | undefined;
let beforeMigrationGuestCapability: { status: number; body: unknown };
let beforeMigrationOwnerCapability: { status: number; body: unknown };

const ownerApp = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { ownerId: string; sessionId: string };
}>();
ownerApp.use('*', async (c, next) => {
  c.set('ownerId', ids.owner);
  c.set('sessionId', ids.ownerSession);
  await next();
});
ownerApp.route('/', ownerAnnotationAuthoringRoutes as never);

function validatedTemporaryPath() {
  assert.ok(temporary);
  const resolved = resolve(temporary);
  assert.equal(
    dirname(resolved),
    temporaryRoot,
    'D1 fixture directory must be a direct child of tmpdir()',
  );
  assert.match(
    basename(resolved),
    /^kino-freehand-writer-[A-Za-z0-9]+$/u,
    'D1 fixture directory must be this test run mkdtemp directory',
  );
  return resolved;
}

function migrationStatements(source: string) {
  const lines = source.split(/\r?\n/u);
  const statements: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    if (/^DROP TRIGGER\b/i.test(trimmed)) {
      assert.match(trimmed, /;$/u);
      statements.push(trimmed);
      continue;
    }
    if (/^CREATE TRIGGER\b/i.test(trimmed)) {
      const body = [line];
      let ended = false;
      for (index += 1; index < lines.length; index += 1) {
        const bodyLine = lines[index]!;
        body.push(bodyLine);
        if (/^END;\s*$/i.test(bodyLine.trim())) {
          ended = true;
          break;
        }
      }
      assert.ok(ended, 'migration trigger must end with a standalone END;');
      statements.push(body.join('\n'));
      continue;
    }
    assert.fail('unexpected numbered migration SQL statement');
  }
  return statements;
}

async function applyBaseline(database: D1Database) {
  const names = (await readdir(migrationDirectory))
    .filter(
      (name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 57,
    )
    .sort();
  assert.equal(names.length, 57);
  assert.deepEqual(
    names.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: 57 }, (_, index) => index + 1),
  );
  assert.equal(names.at(-1), '0057_album_activation_commands.sql');
  for (const name of names) {
    const source = await readFile(join(migrationDirectory, name), 'utf8');
    await database.batch(
      unstable_splitSqlQuery(source).map((statement) =>
        database.prepare(statement),
      ),
    );
  }
}

async function applyMigrationToTemporaryD1(database: D1Database) {
  const proposal = await readFile(proposalPath, 'utf8');
  assert.match(proposal, /REVIEW-ONLY PROPOSAL\. DO NOT APPLY/u);
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /Forward-only migration 0058/u);
  assert.doesNotMatch(migration, /^\s*(CREATE|ALTER|DROP)\s+TABLE\b/imu);
  const proposalStatements = migrationStatements(proposal);
  const statements = migrationStatements(migration);
  assert.deepEqual(statements, proposalStatements);
  assert.equal(statements.length, 4);
  assert.match(
    statements[0]!,
    /^DROP TRIGGER guest_annotation_command_guard;$/u,
  );
  assert.match(
    statements[1]!,
    /^CREATE TRIGGER guest_annotation_command_guard\b/u,
  );
  assert.match(
    statements[2]!,
    /^DROP TRIGGER owner_annotation_command_insert_guard;$/u,
  );
  assert.match(
    statements[3]!,
    /^CREATE TRIGGER owner_annotation_command_insert_guard\b/u,
  );
  await database.batch(
    statements.map((statement) => database.prepare(statement)),
  );
}

async function run(
  database: D1Database,
  sql: string,
  ...values: (string | number | null)[]
) {
  return database
    .prepare(sql)
    .bind(...values)
    .run();
}

async function seedExistingFullChainFixture(database: D1Database) {
  const now = Date.now();
  const sourceHash = 'b'.repeat(64);
  const previewHash = 'c'.repeat(64);
  const thumbnailHash = 'd'.repeat(64);
  const ownerSessionExpires = now + 3_600_000;
  const guestSessionExpires = now + 3_600_000;
  const inviteExpires = now + 30 * 86_400_000;

  await run(
    database,
    'INSERT INTO users(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
    ids.owner,
    'Fixture Owner',
    'owner@example.invalid',
    1,
    null,
    now,
    now,
  );
  await run(
    database,
    'INSERT INTO owners(id,user_id,enabled) VALUES(1,?,1)',
    ids.owner,
  );
  await run(
    database,
    'INSERT INTO owner_sessions(id,token,expiresAt,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    ids.ownerSession,
    'fixture-owner-token',
    ownerSessionExpires,
    ids.owner,
    now,
    now,
  );
  await run(
    database,
    'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
    ids.workspace,
    'Fixture',
    ids.owner,
  );
  await run(
    database,
    "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'uploading')",
    ids.project,
    ids.workspace,
    'Fixture project',
  );
  await run(
    database,
    "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    ids.album,
    ids.workspace,
    ids.project,
    'Fixture album',
  );
  await run(
    database,
    "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id,created_at_ms) VALUES(?,?,?,?,'link_only',NULL,128,?,NULL,?,?,?)",
    ids.invite,
    ids.workspace,
    ids.project,
    'e'.repeat(64),
    inviteExpires,
    ids.owner,
    ids.ownerSession,
    now,
  );
  await run(
    database,
    'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    ids.invite,
    ids.workspace,
    ids.project,
    ids.album,
  );
  await run(
    database,
    'INSERT INTO guest_invite_seals(invite_id,sealed_at_ms) VALUES(?,?)',
    ids.invite,
    now,
  );
  await run(
    database,
    'INSERT INTO guest_identities(id,invite_id,display_name,created_at_ms) VALUES(?,?,?,?)',
    ids.guest,
    ids.invite,
    'Fixture Guest',
    now,
  );
  await run(
    database,
    'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms,created_at_ms) VALUES(?,?,?,?,?,?)',
    ids.guestSession,
    ids.invite,
    ids.guest,
    guestSecretHash,
    guestSessionExpires,
    now,
  );

  const sourceObjectKey = [
    ids.workspace,
    ids.project,
    ids.album,
    ids.uploadSession,
    'original',
  ].join('/');
  const uploadPayloadJson = JSON.stringify({
    workspaceId: ids.workspace,
    projectId: ids.project,
    albumId: ids.album,
    originalFilename: 'fixture.png',
    expectedBytes: 100,
    contentType: 'image/png',
    sha256: sourceHash,
  });
  const uploadWorkflowPayloadJson = JSON.stringify({
    uploadSessionId: ids.uploadSession,
  });

  await run(
    database,
    'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    randomUUID(),
    'upload.reserved',
    uploadPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    ids.workspace,
    ids.project,
    ids.album,
    'primary',
    sourceObjectKey,
    'fixture.png',
    100,
    now,
  );
  await run(
    database,
    'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    randomUUID(),
    'upload.authorized',
    uploadWorkflowPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    now,
    now,
    now + 600_000,
    'image/png',
    sourceHash,
  );
  await run(
    database,
    'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,content_type,sha256_hex,actual_bytes,photo_id,version_id,asset_id,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    randomUUID(),
    'upload.completed',
    uploadWorkflowPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    now + 1,
    'image/png',
    sourceHash,
    100,
    ids.photo,
    ids.version,
    ids.original,
    10,
    10,
  );

  const processingStartedAt = Date.now();
  await run(
    database,
    "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=1,attempts=1,lease_until_ms=?,updated_at_ms=?,transition_id=? WHERE id=?",
    randomUUID(),
    processingStartedAt + 300_000,
    processingStartedAt,
    randomUUID(),
    ids.original,
  );
  const processingResult = JSON.stringify([
    {
      kind: 'thumbnail',
      bytes: 10,
      mime: 'image/jpeg',
      sha256: thumbnailHash,
      width: 10,
      height: 10,
    },
    {
      kind: 'preview',
      bytes: 20,
      mime: 'image/jpeg',
      sha256: previewHash,
      width: 10,
      height: 10,
    },
  ]);
  const processingFinishedAt = Date.now();
  await run(
    database,
    "UPDATE image_processing_jobs SET status='succeeded',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,reason_code=NULL,result_json=?,updated_at_ms=?,transition_id=? WHERE id=?",
    processingResult,
    processingFinishedAt,
    randomUUID(),
    ids.original,
  );
  const eligible = await database
    .prepare(
      'SELECT count(*) AS count FROM guest_annotation_eligible_versions WHERE version_id=?',
    )
    .bind(ids.version)
    .first<{ count: number }>();
  assert.equal(eligible?.count, 1);
}

const artifactTables = [
  'guest_annotation_commands',
  'owner_annotation_commands',
  'guest_annotations',
  'owner_annotations',
  'guest_annotation_changes',
  'owner_annotation_changes',
  'guest_annotation_results',
  'owner_annotation_results',
  'audit_events',
] as const;

async function artifactSnapshot(database: D1Database) {
  const snapshot: Record<string, string[]> = {};
  for (const table of artifactTables) {
    const rows = (
      await database
        .prepare('SELECT * FROM ' + table)
        .all<Record<string, unknown>>()
    ).results;
    snapshot[table] = rows
      .map((row) => JSON.stringify(Object.fromEntries(Object.entries(row))))
      .sort();
  }
  return snapshot;
}

function commandGeometry(shift = 0) {
  return {
    type: 'freehand',
    coordinateSpace: 'normalized_1e6',
    version: 1,
    points: [
      { x: 100 + shift, y: 200 },
      { x: 300 + shift, y: 400 },
      { x: 500 + shift, y: 600 },
    ],
  };
}

function guestCommand(requestId: string, expectedGuestId = ids.guest) {
  return {
    requestId,
    expectedGuestId,
    operation: 'create',
    photoId: ids.photo,
    versionId: ids.version,
    geometry: commandGeometry(),
    style: { color: 'amber' },
    commentId: null,
  };
}

function ownerCommand(requestId: string, expectedOwnerId = ids.owner) {
  return {
    requestId,
    expectedOwnerId,
    operation: 'create',
    inviteId: ids.invite,
    photoId: ids.photo,
    versionId: ids.version,
    geometry: commandGeometry(),
    style: { color: 'amber' },
    commentId: null,
  };
}

function requestGuest(command: unknown, freehandEnabled: boolean) {
  return guestAnnotationRoutes.fetch(
    new Request(
      new URL('/api/guest/albums/' + ids.album + '/annotations/commands', base),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: base,
          'Content-Type': 'application/json',
          Cookie: 'kino_guest=' + guestSecret,
        },
        body: JSON.stringify(command),
      },
    ),
    {
      ...envBase,
      FREEHAND_ANNOTATIONS_ENABLED: freehandEnabled ? 'true' : 'false',
      DB: db,
    } as never,
  );
}

function requestOwner(command: unknown, freehandEnabled: boolean) {
  return ownerApp.fetch(
    new Request(
      new URL(
        '/api/v1/albums/' + ids.album + '/annotations/owner/commands',
        base,
      ),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      },
    ),
    {
      ...envBase,
      FREEHAND_ANNOTATIONS_ENABLED: freehandEnabled ? 'true' : 'false',
      DB: db,
    } as never,
  );
}

function requestGuestFreehandCapability(freehandEnabled: boolean) {
  return guestAnnotationRoutes.fetch(
    new Request(new URL('/api/guest/annotations/freehand-capabilities', base)),
    {
      ...envBase,
      FREEHAND_ANNOTATIONS_ENABLED: freehandEnabled ? 'true' : 'false',
      DB: db,
    } as never,
  );
}

function requestOwnerFreehandCapability(freehandEnabled: boolean) {
  return ownerApp.fetch(
    new Request(
      new URL('/api/v1/annotations/authoring/freehand-capabilities', base),
    ),
    {
      ...envBase,
      FREEHAND_ANNOTATIONS_ENABLED: freehandEnabled ? 'true' : 'false',
      DB: db,
    } as never,
  );
}

async function assertApiError(
  response: Response,
  status: number,
  code: string,
) {
  const text = await response.text();
  expect(response.status, text).toBe(status);
  expect(JSON.parse(text)).toEqual({ error: { code } });
}

async function assertForeignKeysClean(database: D1Database) {
  const result = await database.prepare('PRAGMA foreign_key_check').all();
  expect(result.results).toEqual([]);
}

describe('actual Guest/Owner freehand writers on isolated workerd D1', () => {
  beforeAll(async () => {
    temporary = await mkdtemp(join(temporaryRoot, 'kino-freehand-writer-'));
    validatedTemporaryPath();
    mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: 'freehand-writer-isolated',
            modules: true,
            script:
              "export default { async fetch() { return new Response('ok'); } };",
            compatibilityDate: '2026-10-23',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: { DB: 'freehand-writer-isolated' },
          },
        ],
        d1Persist: join(temporary, 'd1'),
      }),
    );
    db = await mf.getD1Database('DB', 'freehand-writer-isolated');
    await applyBaseline(db);
    const guestBeforeProposal = await requestGuestFreehandCapability(true);
    beforeMigrationGuestCapability = {
      status: guestBeforeProposal.status,
      body: await guestBeforeProposal.json(),
    };
    const ownerBeforeProposal = await requestOwnerFreehandCapability(true);
    beforeMigrationOwnerCapability = {
      status: ownerBeforeProposal.status,
      body: await ownerBeforeProposal.json(),
    };
    await applyMigrationToTemporaryD1(db);
    await seedExistingFullChainFixture(db);
  }, 120_000);

  it('reports write readiness only after migration 0058 installs both exact D1 guard fingerprints', async () => {
    expect(beforeMigrationGuestCapability).toEqual({
      status: 200,
      body: { enabled: false },
    });
    expect(beforeMigrationOwnerCapability).toEqual({
      status: 200,
      body: { enabled: false },
    });

    const guestDisabled = await requestGuestFreehandCapability(false);
    expect(guestDisabled.status).toBe(200);
    expect(await guestDisabled.json()).toEqual({ enabled: false });
    const ownerDisabled = await requestOwnerFreehandCapability(false);
    expect(ownerDisabled.status).toBe(200);
    expect(await ownerDisabled.json()).toEqual({ enabled: false });

    const guestEnabled = await requestGuestFreehandCapability(true);
    expect(guestEnabled.status).toBe(200);
    expect(await guestEnabled.json()).toEqual({ enabled: true });
    const ownerEnabled = await requestOwnerFreehandCapability(true);
    expect(ownerEnabled.status).toBe(200);
    expect(await ownerEnabled.json()).toEqual({ enabled: true });
  });

  afterAll(async () => {
    if (mf) await mf.dispose();
    if (temporary) {
      const cleanupPath = validatedTemporaryPath();
      await rm(cleanupPath, { recursive: true, force: true });
    }
  });

  it('gates new strokes, replays the original request, rejects conflicts and preserves role/audit identity', async () => {
    const guestRequestId = randomUUID();
    const guestBody = guestCommand(guestRequestId);
    let snapshot = await artifactSnapshot(db);

    await assertApiError(
      await requestGuest(guestBody, false),
      409,
      'FREEHAND_ANNOTATIONS_DISABLED',
    );
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    const guestResponse = await requestGuest(guestBody, true);
    expect(guestResponse.status).toBe(200);
    const guestResult = (await guestResponse.json()) as GuestResult;
    expect(guestResult.requestId).toBe(guestRequestId);
    expect(guestResult.item.geometry).toEqual(commandGeometry());
    expect(guestResult.item.revision).toBe(1);
    snapshot = await artifactSnapshot(db);

    const guestRow = await db
      .prepare(
        'SELECT geometry_json,state,revision,last_session_id,last_request_id FROM guest_annotations WHERE id=?',
      )
      .bind(guestResult.item.annotationId)
      .first();
    expect(guestRow).toMatchObject({
      geometry_json: JSON.stringify(commandGeometry()),
      state: 'open',
      revision: 1,
      last_session_id: ids.guestSession,
      last_request_id: guestRequestId,
    });
    const guestChange = await db
      .prepare(
        'SELECT operation,revision,session_id,request_id,after_json FROM guest_annotation_changes WHERE annotation_id=? AND revision=1',
      )
      .bind(guestResult.item.annotationId)
      .first();
    expect(guestChange).toMatchObject({
      operation: 'create',
      revision: 1,
      session_id: ids.guestSession,
      request_id: guestRequestId,
    });
    expect(JSON.parse(String(guestChange?.after_json)).geometry).toEqual(
      commandGeometry(),
    );
    const guestAudit = await db
      .prepare(
        'SELECT actor_type,actor_id,guest_session_id,session_id,action,request_id FROM audit_events WHERE event_id=?',
      )
      .bind('guest-annotation:' + guestResult.item.annotationId + ':1')
      .first();
    expect(guestAudit).toEqual({
      actor_type: 'guest',
      actor_id: ids.guest,
      guest_session_id: ids.guestSession,
      session_id: null,
      action: 'annotation.created',
      request_id: guestRequestId,
    });
    const guestReceiptCount = await db
      .prepare(
        'SELECT count(*) AS count FROM guest_annotation_results WHERE request_id=?',
      )
      .bind(guestRequestId)
      .first<{ count: number }>();
    expect(guestReceiptCount?.count).toBe(1);

    const guestReplay = await requestGuest(guestBody, false);
    expect(guestReplay.status).toBe(200);
    expect(await guestReplay.json()).toEqual(guestResult);
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    await assertApiError(
      await requestGuest({ ...guestBody, geometry: commandGeometry(1) }, false),
      409,
      'REQUEST_ID_CONFLICT',
    );
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    await assertApiError(
      await requestGuest(guestCommand(randomUUID(), ids.otherIdentity), false),
      401,
      'GUEST_ACCESS_REQUIRED',
    );
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    const ownerRequestId = randomUUID();
    const ownerBody = ownerCommand(ownerRequestId);
    await assertApiError(
      await requestOwner(ownerBody, false),
      409,
      'FREEHAND_ANNOTATIONS_DISABLED',
    );
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    const ownerResponse = await requestOwner(ownerBody, true);
    expect(ownerResponse.status).toBe(200);
    const ownerResult = (await ownerResponse.json()) as OwnerResult;
    expect(ownerResult.requestId).toBe(ownerRequestId);
    expect(ownerResult.item.geometry).toEqual(commandGeometry());
    expect(ownerResult.item.revision).toBe(1);
    snapshot = await artifactSnapshot(db);

    const ownerRow = await db
      .prepare(
        'SELECT geometry_json,state,revision,created_session_id,last_request_id FROM owner_annotations WHERE id=?',
      )
      .bind(ownerResult.item.annotationId)
      .first();
    expect(ownerRow).toMatchObject({
      geometry_json: JSON.stringify(commandGeometry()),
      state: 'open',
      revision: 1,
      created_session_id: ids.ownerSession,
      last_request_id: ownerRequestId,
    });
    const ownerChange = await db
      .prepare(
        'SELECT operation,revision,session_id,request_id,after_json FROM owner_annotation_changes WHERE annotation_id=? AND revision=1',
      )
      .bind(ownerResult.item.annotationId)
      .first();
    expect(ownerChange).toMatchObject({
      operation: 'create',
      revision: 1,
      session_id: ids.ownerSession,
      request_id: ownerRequestId,
    });
    expect(JSON.parse(String(ownerChange?.after_json)).geometry).toEqual(
      commandGeometry(),
    );
    const ownerAudit = await db
      .prepare(
        'SELECT actor_type,actor_id,session_id,guest_session_id,action,request_id FROM audit_events WHERE event_id=?',
      )
      .bind('owner-annotation:' + ownerResult.item.annotationId + ':1')
      .first();
    expect(ownerAudit).toEqual({
      actor_type: 'user',
      actor_id: ids.owner,
      session_id: ids.ownerSession,
      guest_session_id: null,
      action: 'owner.annotation_created',
      request_id: ownerRequestId,
    });
    const ownerReceiptCount = await db
      .prepare(
        'SELECT count(*) AS count FROM owner_annotation_results WHERE request_id=?',
      )
      .bind(ownerRequestId)
      .first<{ count: number }>();
    expect(ownerReceiptCount?.count).toBe(1);

    const ownerReplay = await requestOwner(ownerBody, false);
    expect(ownerReplay.status).toBe(200);
    expect(await ownerReplay.json()).toEqual(ownerResult);
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    await assertApiError(
      await requestOwner({ ...ownerBody, geometry: commandGeometry(1) }, false),
      409,
      'REQUEST_ID_CONFLICT',
    );
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    await assertApiError(
      await requestOwner(ownerCommand(randomUUID(), ids.otherIdentity), false),
      409,
      'OWNER_IDENTITY_CHANGED',
    );
    expect(await artifactSnapshot(db)).toEqual(snapshot);

    await assertForeignKeysClean(db);
    // D1 rejects SQLite integrity_check; foreign_key_check and full artifact
    // snapshots above cover the integrity guarantees exposed by this binding.
  }, 120_000);
});
