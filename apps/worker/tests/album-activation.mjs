import { activateDraftAlbumFixture } from './activate-album-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { STAGING_GUEST_SCOPE as scope } from '../src/staging-guest-scope.ts';
import { applyMigration } from './apply-migration.mjs';

const base = scope.origin;
const workerScript = resolve(
  '.local/activation-validation-build/staging-upload-validation-worker.js',
);
const configPath = resolve('wrangler.activation-validation.jsonc');
const migrationPath = resolve('migrations/0057_album_activation_commands.sql');
const ownerId = randomUUID();
const sessionId = randomUUID();
const token = randomBytes(32).toString('hex');
const authSecret = 'activation-local-' + randomBytes(32).toString('hex');
const ownerSubject = 'album-activation-local-' + randomUUID();
const namespaceRequestId = randomUUID().toUpperCase();
const activationRequestId = randomUUID().toLowerCase();
const now = Date.now();
const activationPath = '/api/v1/albums/' + scope.albumId + '/activate';
const capabilityPath =
  '/api/v1/albums/' + scope.albumId + '/activation-capabilities';
const guestFlags = [
  'GUEST_INVITE_ISSUANCE_ENABLED',
  'GUEST_EXCHANGE_ENABLED',
  'GUEST_SELECTION_ENABLED',
  'GUEST_FEEDBACK_ENABLED',
  'GUEST_TAGS_ENABLED',
  'GUEST_HISTORY_ENABLED',
  'GUEST_DOWNLOADS_ENABLED',
  'GUEST_VERSION_COMPARISON_ENABLED',
  'GUEST_COMMENTS_ENABLED',
  'GUEST_ANNOTATIONS_ENABLED',
  'FREEHAND_ANNOTATIONS_ENABLED',
  'GUEST_SHARED_SELECTION_ENABLED',
];
const bindings = {
  APP_ENV: 'staging',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  CLIENT_ACTIVITY_ENABLED: 'false',
  CLOUDFLARE_IMAGE_PROCESSING_ENABLED: 'true',
  STAGING_UPLOAD_VALIDATION: 'true',
  STAGING_GUEST_VALIDATION: 'true',
  ALBUM_ACTIVATION_ENABLED: 'true',
  BETTER_AUTH_SECRET: authSecret,
  R2_ACCOUNT_ID: scope.accountId,
  R2_ACCESS_KEY_ID: 'activation-presence-only-test-key',
  R2_SECRET_ACCESS_KEY: 'activation-presence-only-test-secret',
  R2_BUCKET_NAME: scope.bucket,
  IMAGES: 'presence-only-synthetic-binding',
  ...Object.fromEntries(guestFlags.map((flag) => [flag, 'false'])),
};
const workerOptions = (name) => ({
  name,
  modules: true,
  scriptPath: workerScript,
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  bindings,
  d1Databases: { DB: 'album-activation-' + name },
  r2Buckets: { PRIMARY_STORAGE: 'album-activation-r2-' + name },
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
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: ['app', 'parity', 'rollback'].map(workerOptions),
  }),
);

const checks = [];
const signature = await makeSignature(token, authSecret);
const ownerCookie =
  '__Secure-kino-owner.session_token=' +
  encodeURIComponent(token + '.' + signature);
const run = (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .run();
const first = (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .first();

async function check(label, action) {
  await action();
  checks.push(label);
  process.stdout.write('passed: ' + label + '\n');
}
async function jsonAt(response, status, label) {
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  assert.equal(response.status, status, label + ': ' + JSON.stringify(value));
  return value;
}
async function errorAt(response, status, label) {
  const value = await jsonAt(response, status, label);
  assert.ok(
    value && typeof value === 'object' && value.error,
    label + ': error',
  );
  return value.error.code;
}
function headers(cookie = ownerCookie, origin = base) {
  return {
    ...(cookie ? { Cookie: cookie } : {}),
    Origin: origin,
    'Content-Type': 'application/json',
  };
}
function request(method, path, body, cookie = ownerCookie, origin = base) {
  return mf.dispatchFetch(base + path, {
    method,
    headers: headers(cookie, origin),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const activate = (body) => request('POST', activationPath, body);
const confirmed = (requestId, expectedRevision) => ({
  requestId,
  expectedRevision,
  confirmActivate: true,
});
const count = async (db, table, where = '', ...values) =>
  Number(
    (
      await first(
        db,
        'SELECT count(*) AS count FROM ' + table + where,
        ...values,
      )
    ).count,
  );
async function mustReject(action, label) {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, label + ': expected D1 rejection');
  return String(failure);
}
async function migrationFiles56() {
  const files = (await readdir(resolve('migrations')))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= 56)
    .sort();
  assert.equal(
    files.length,
    56,
    'expected the populated OLD56 migration chain',
  );
  assert.ok(files.includes('0056_processing_policy_and_retry_guards.sql'));
  return files;
}
async function applyOld56(db, files) {
  for (const file of files)
    await applyMigration(db, await readFile(join('migrations', file), 'utf8'));
}
async function seedFixedDraft(db) {
  await run(
    db,
    'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    ownerId,
    ownerSubject,
  );
  await run(
    db,
    'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    sessionId,
    token,
    ownerId,
    now + 3_600_000,
    now,
    now,
  );
  await run(
    db,
    'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
    scope.workspaceId,
    'Activation fixture',
    ownerId,
  );
  await run(
    db,
    'INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,?)',
    scope.projectId,
    scope.workspaceId,
    'Activation fixture project',
    'draft',
  );
  await run(
    db,
    'INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,?)',
    scope.albumId,
    scope.workspaceId,
    scope.projectId,
    'Activation fixture album',
    'draft',
  );
}
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
async function dataSnapshot(db) {
  const names = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
  ).results
    .map((row) => row.name)
    .filter(
      (name) =>
        !name.startsWith('sqlite_') &&
        !name.startsWith('_') &&
        name !== 'd1_migrations',
    );
  const tables = {};
  let rowsTotal = 0;
  for (const name of names) {
    const rows = (
      await db.prepare('SELECT * FROM ' + quote(name)).all()
    ).results
      .map((row) =>
        JSON.stringify(Object.fromEntries(Object.entries(row).sort())),
      )
      .sort();
    rowsTotal += rows.length;
    tables[name] = {
      count: rows.length,
      sha256: createHash('sha256').update(rows.join('\n')).digest('hex'),
    };
  }
  return { tables, rowsTotal };
}
function assertDataParity(before, after) {
  for (const [name, snapshot] of Object.entries(before.tables))
    assert.deepEqual(
      after.tables[name],
      snapshot,
      'changed existing table ' + name,
    );
  const addedTables = Object.keys(after.tables).filter(
    (name) => !(name in before.tables),
  );
  assert.deepEqual(addedTables, ['album_activation_commands']);
  assert.equal(after.tables.album_activation_commands.count, 0);
  assert.equal(after.rowsTotal, before.rowsTotal);
}
async function schemaSnapshot(db) {
  return (
    await db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all()
  ).results;
}
const schemaKey = (row) => row.type + ':' + row.name;
async function foreignKeyCheck(db) {
  return (await db.prepare('PRAGMA foreign_key_check').all()).results;
}
async function activationState(db) {
  return {
    album: await db
      .prepare(
        'SELECT id,name,state,revision,is_pinned,legal_hold FROM albums WHERE id=?',
      )
      .bind(scope.albumId)
      .first(),
    commands: await count(
      db,
      'album_activation_commands',
      ' WHERE album_id=?',
      scope.albumId,
    ),
    events: await count(
      db,
      'audit_events',
      " WHERE action='album.activated' AND album_id=?",
      scope.albumId,
    ),
  };
}

try {
  await readFile(workerScript);
  const migrationBytes = await readFile(migrationPath);
  const migrationSource = migrationBytes.toString('utf8');
  const oldFiles = await migrationFiles56();
  const appDb = await mf.getD1Database('DB', 'app');
  const parityDb = await mf.getD1Database('DB', 'parity');
  const rollbackDb = await mf.getD1Database('DB', 'rollback');

  for (const db of [appDb, parityDb, rollbackDb]) {
    await applyOld56(db, oldFiles);
    await seedFixedDraft(db);
  }

  await check(
    'OLD56 fixture is populated and cannot activate before 0057',
    async () => {
      assert.ok((await dataSnapshot(appDb)).rowsTotal >= 7);
      const capability = await jsonAt(
        await mf.dispatchFetch(base + capabilityPath, { headers: headers() }),
        200,
        'OLD56 capability',
      );
      assert.deepEqual(capability, { enabled: false });
      assert.deepEqual(await foreignKeyCheck(appDb), []);
    },
  );

  await check(
    'late 0057 failure rolls back schema and data on isolated D1',
    async () => {
      const beforeData = await dataSnapshot(rollbackDb);
      const beforeSchema = await schemaSnapshot(rollbackDb);
      const injected =
        migrationSource +
        '\nCREATE TABLE activation_rollback_sentinel(id TEXT PRIMARY KEY);\n' +
        "INSERT INTO activation_table_missing_for_failure(id) VALUES('late');\n";
      await mustReject(
        () => applyMigration(rollbackDb, injected),
        'injected final migration statement',
      );
      assert.deepEqual(await schemaSnapshot(rollbackDb), beforeSchema);
      assert.deepEqual(await dataSnapshot(rollbackDb), beforeData);
      assert.deepEqual(await foreignKeyCheck(rollbackDb), []);
    },
  );

  await check(
    'native 0057 upgrade preserves every OLD56 row hash and schema object',
    async () => {
      const beforeData = await dataSnapshot(parityDb);
      const beforeSchema = await schemaSnapshot(parityDb);
      await applyMigration(parityDb, migrationSource);
      assertDataParity(beforeData, await dataSnapshot(parityDb));
      const after = new Map(
        (await schemaSnapshot(parityDb)).map((row) => [schemaKey(row), row]),
      );
      for (const row of beforeSchema)
        assert.deepEqual(
          after.get(schemaKey(row)),
          row,
          'changed ' + schemaKey(row),
        );
      assert.ok(after.has('table:album_activation_commands'));
      assert.deepEqual(await foreignKeyCheck(parityDb), []);
    },
  );

  const beforeAppMigration = await dataSnapshot(appDb);
  await applyMigration(appDb, migrationSource);
  await check(
    'fixed-scope HTTPS capability opens only after 0057',
    async () => {
      const capability = await jsonAt(
        await mf.dispatchFetch(base + capabilityPath, { headers: headers() }),
        200,
        'activation capability',
      );
      assert.deepEqual(capability, { enabled: true });
      assertDataParity(beforeAppMigration, await dataSnapshot(appDb));
      assert.deepEqual(await foreignKeyCheck(appDb), []);
    },
  );

  await check(
    'unauthenticated, expired, foreign-origin and nonfixture access has no writes',
    async () => {
      const before = await activationState(appDb);
      await errorAt(
        await mf.dispatchFetch(base + capabilityPath),
        401,
        'anonymous Owner capability',
      );
      const expiredToken = randomBytes(32).toString('hex');
      const expiredAt = Date.now() - 60_000;
      await appDb
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          randomUUID(),
          expiredToken,
          ownerId,
          expiredAt,
          expiredAt - 1,
          expiredAt - 1,
        )
        .run();
      const expiredCookie =
        '__Secure-kino-owner.session_token=' +
        encodeURIComponent(
          expiredToken + '.' + (await makeSignature(expiredToken, authSecret)),
        );
      await errorAt(
        await mf.dispatchFetch(base + capabilityPath, {
          headers: headers(expiredCookie),
        }),
        401,
        'expired session',
      );
      // The same HTTPS URL with a foreign Origin is rejected before any D1 command.
      const foreignHeader = await mf.dispatchFetch(base + activationPath, {
        method: 'POST',
        headers: headers(ownerCookie, 'https://foreign-origin.invalid'),
        body: JSON.stringify(confirmed(randomUUID(), 1)),
      });
      assert.equal(foreignHeader.status, 403);
      const foreignUrl = await mf.dispatchFetch(
        'https://foreign-origin.invalid' + activationPath,
        {
          method: 'POST',
          headers: headers(ownerCookie, 'https://foreign-origin.invalid'),
          body: JSON.stringify(confirmed(randomUUID(), 1)),
        },
      );
      assert.equal(foreignUrl.status, 403);
      await errorAt(
        await mf.dispatchFetch(
          base + '/api/v1/albums/' + randomUUID() + '/activation-capabilities',
          { headers: headers() },
        ),
        404,
        'nonfixture album',
      );
      assert.deepEqual(await activationState(appDb), before);
    },
  );

  await check('confirmation and audit failure are atomic', async () => {
    const before = await activationState(appDb);
    await mustReject(
      () =>
        appDb
          .prepare(
            "UPDATE albums SET state='active',revision=revision+1 WHERE id=?",
          )
          .bind(scope.albumId)
          .run(),
      'raw draft-to-active update without an activation command',
    );
    await errorAt(
      await activate({
        requestId: randomUUID(),
        expectedRevision: 1,
        confirmActivate: false,
      }),
      400,
      'missing confirmation',
    );
    await applyMigration(
      appDb,
      'CREATE TRIGGER album_activation_test_audit_failure BEFORE INSERT ON audit_events ' +
        "WHEN NEW.action='album.activated' BEGIN SELECT RAISE(ABORT,'INJECTED_AUDIT_FAILURE'); END;",
    );
    const failed = await activate(confirmed(randomUUID(), 1));
    const detail = await failed.text();
    assert.ok(failed.status >= 500 && failed.status < 600, detail);
    await applyMigration(
      appDb,
      'DROP TRIGGER album_activation_test_audit_failure;',
    );
    assert.deepEqual(await activationState(appDb), before);
  });

  await check(
    'case-folded existing-command to activation collision is rejected',
    async () => {
      const project = await jsonAt(
        await request('POST', '/api/v1/projects', {
          workspaceId: scope.workspaceId,
          name: 'Namespace fixture',
          requestId: namespaceRequestId,
        }),
        201,
        'existing request command',
      );
      assert.ok(project.project?.id);
      const before = await activationState(appDb);
      const collision = await activate(
        confirmed(namespaceRequestId.toLowerCase(), 1),
      );
      assert.equal(collision.status, 409, await collision.text());
      assert.deepEqual(await activationState(appDb), before);
    },
  );

  let originalActivation;
  await check(
    'Owner API activates fixed draft with one complete audited revision',
    async () => {
      const result = await jsonAt(
        await activate(confirmed(activationRequestId, 1)),
        200,
        'activate album',
      );
      originalActivation = result;
      const album = result.album;
      assert.deepEqual(
        {
          id: album.id,
          workspaceId: album.workspaceId,
          projectId: album.projectId,
          name: album.name,
          state: album.state,
          isPinned: album.isPinned,
          legalHold: album.legalHold,
          revision: album.revision,
        },
        {
          id: scope.albumId,
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          name: 'Activation fixture album',
          state: 'active',
          isPinned: false,
          legalHold: false,
          revision: 2,
        },
      );
      assert.ok(Number.isFinite(Date.parse(album.createdAt)));
      const ledger = await appDb
        .prepare(
          'SELECT actor_id,request_id,session_id,workspace_id,project_id,album_id,expected_revision,confirm_activate FROM album_activation_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(ownerId, activationRequestId)
        .first();
      assert.deepEqual(ledger, {
        actor_id: ownerId,
        request_id: activationRequestId,
        session_id: sessionId,
        workspace_id: scope.workspaceId,
        project_id: scope.projectId,
        album_id: scope.albumId,
        expected_revision: 1,
        confirm_activate: 1,
      });
      const event = await appDb
        .prepare(
          'SELECT event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id,occurred_at_utc FROM audit_events WHERE event_id=?',
        )
        .bind('album-activation:' + ownerId + ':' + activationRequestId)
        .first();
      assert.ok(event);
      assert.equal(event.actor_type, 'user');
      assert.equal(event.actor_id, ownerId);
      assert.equal(event.session_id, sessionId);
      assert.equal(event.workspace_id, scope.workspaceId);
      assert.equal(event.project_id, scope.projectId);
      assert.equal(event.album_id, scope.albumId);
      assert.equal(event.action, 'album.activated');
      assert.equal(event.request_id, activationRequestId);
      assert.ok(Number.isFinite(Date.parse(event.occurred_at_utc)));
      assert.deepEqual(JSON.parse(event.after_json), album);
      assert.deepEqual(JSON.parse(event.before_json), {
        ...album,
        state: 'draft',
        revision: 1,
      });
      assert.equal(
        await count(appDb, 'audit_events', " WHERE action='album.activated'"),
        1,
      );
    },
  );

  await check(
    'exact replay returns its original receipt without duplicating audit',
    async () => {
      const replay = await jsonAt(
        await activate(confirmed(activationRequestId, 1)),
        200,
        'exact replay',
      );
      assert.deepEqual(replay, originalActivation);
      assert.equal(await count(appDb, 'album_activation_commands'), 1);
      assert.equal(
        await count(appDb, 'audit_events', " WHERE action='album.activated'"),
        1,
      );
    },
  );

  await check(
    'receipt remains historical after rename and protection; stale or changed commands fail',
    async () => {
      const renamed = await jsonAt(
        await request('PATCH', '/api/v1/albums/' + scope.albumId, {
          name: 'Renamed after activation',
          expectedRevision: 2,
          requestId: randomUUID(),
        }),
        200,
        'rename',
      );
      assert.equal(renamed.album.revision, 3);
      const protectedAlbum = await jsonAt(
        await request(
          'PATCH',
          '/api/v1/albums/' + scope.albumId + '/protection',
          {
            isPinned: true,
            legalHold: true,
            expectedRevision: 3,
            confirmUnprotect: false,
            requestId: randomUUID(),
          },
        ),
        200,
        'protection update',
      );
      assert.equal(protectedAlbum.album.revision, 4);
      const replay = await jsonAt(
        await activate(confirmed(activationRequestId, 1)),
        200,
        'historical replay',
      );
      assert.deepEqual(replay, originalActivation);
      assert.equal(replay.album.name, 'Activation fixture album');
      assert.equal(replay.album.revision, 2);
      assert.equal(replay.album.isPinned, false);
      assert.equal(replay.album.legalHold, false);

      const event = await appDb
        .prepare(
          'SELECT before_json,after_json,session_id,request_id FROM audit_events WHERE event_id=?',
        )
        .bind('album-activation:' + ownerId + ':' + activationRequestId)
        .first();
      assert.deepEqual(JSON.parse(event.after_json), originalActivation.album);
      assert.equal(JSON.parse(event.before_json).state, 'draft');
      assert.equal(event.session_id, sessionId);
      assert.equal(event.request_id, activationRequestId);

      for (const body of [
        confirmed(activationRequestId, 4),
        confirmed(randomUUID(), 2),
        confirmed(randomUUID(), 4),
      ]) {
        const response = await activate(body);
        assert.equal(response.status, 409, await response.text());
      }
      assert.equal(await count(appDb, 'album_activation_commands'), 1);
      assert.equal(
        await count(appDb, 'audit_events', " WHERE action='album.activated'"),
        1,
      );
    },
  );

  await check(
    'activation ledger is append-only and reciprocal case-fold namespace is enforced',
    async () => {
      assert.equal(
        await count(
          appDb,
          'request_commands',
          ' WHERE actor_id=? AND lower(request_id)=lower(?)',
          ownerId,
          activationRequestId,
        ),
        0,
      );
      const reverse = await request('POST', '/api/v1/projects', {
        workspaceId: scope.workspaceId,
        name: 'Reverse namespace fixture',
        requestId: activationRequestId.toUpperCase(),
      });
      assert.equal(reverse.status, 409, await reverse.text());

      const commandValues = [
        ownerId,
        activationRequestId,
        sessionId,
        scope.workspaceId,
        scope.projectId,
        scope.albumId,
        1,
        1,
        now,
      ];
      const mutations = [
        () =>
          appDb
            .prepare(
              'UPDATE album_activation_commands SET created_at_ms=created_at_ms+1 WHERE actor_id=? AND request_id=?',
            )
            .bind(ownerId, activationRequestId)
            .run(),
        () =>
          appDb
            .prepare(
              'DELETE FROM album_activation_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(ownerId, activationRequestId)
            .run(),
        () =>
          appDb
            .prepare(
              'INSERT OR REPLACE INTO album_activation_commands(actor_id,request_id,session_id,workspace_id,project_id,album_id,expected_revision,confirm_activate,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .bind(...commandValues)
            .run(),
      ];
      for (const [index, mutation] of mutations.entries())
        await mustReject(mutation, ['UPDATE', 'DELETE', 'REPLACE'][index]);
      assert.equal(await count(appDb, 'album_activation_commands'), 1);
    },
  );

  await check(
    'same fixed album under a foreign workspace owner is hidden',
    async () => {
      const foreignOwnerId = randomUUID();
      await appDb
        .prepare(
          'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          foreignOwnerId,
          'Foreign workspace owner',
          foreignOwnerId + '@activation.invalid',
          1,
          now,
          now,
        )
        .run();
      await appDb
        .prepare('UPDATE workspaces SET owner_user_id=? WHERE id=?')
        .bind(foreignOwnerId, scope.workspaceId)
        .run();
      await errorAt(
        await mf.dispatchFetch(base + capabilityPath, { headers: headers() }),
        404,
        'foreign workspace owner',
      );
      assert.equal(await count(appDb, 'album_activation_commands'), 1);
    },
  );

  await check(
    'legacy draft fixture helper uses one real activation command and audit',
    async () => {
      await appDb
        .prepare('UPDATE workspaces SET owner_user_id=? WHERE id=?')
        .bind(ownerId, scope.workspaceId)
        .run();
      const fixtureAlbumId = randomUUID();
      await appDb
        .prepare(
          "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Audited fixture helper','draft')",
        )
        .bind(fixtureAlbumId, scope.workspaceId, scope.projectId)
        .run();
      const fixtureActivation = await activateDraftAlbumFixture(
        appDb,
        fixtureAlbumId,
      );
      assert.equal(fixtureActivation.commandCount, 1);
      assert.equal(fixtureActivation.auditCount, 1);
    },
  );
  const [testBytes, bundleBytes, configBytes] = await Promise.all([
    readFile(resolve('tests/album-activation.mjs')),
    readFile(workerScript),
    readFile(configPath),
  ]);
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(
    resolve('.local/album-activation-local-proof.json'),
    JSON.stringify(
      {
        status: 'passed_isolated_album_activation',
        checks: checks.length,
        checkNames: checks,
        migration: {
          name: '0057_album_activation_commands.sql',
          sha256: createHash('sha256').update(migrationBytes).digest('hex'),
          old56MigrationCount: oldFiles.length,
          parity: 'all prior schema objects and table row hashes preserved',
          rollback:
            'late injected SQL failure left OLD56 schema, rows and FK state unchanged',
        },
        source: {
          testSha256: createHash('sha256').update(testBytes).digest('hex'),
          workerBundleSha256: createHash('sha256')
            .update(bundleBytes)
            .digest('hex'),
          activationConfigSha256: createHash('sha256')
            .update(configBytes)
            .digest('hex'),
        },
        runtime: {
          origin: base,
          mode: 'native isolated Miniflare workerd',
          d1: 'ephemeral fixture only',
          r2: 'ephemeral synthetic binding only',
          images: 'presence-only synthetic binding',
          oauth: 'not_checked',
          realCloudflare: false,
          deployed: false,
          guestFlags: 'off',
          customerData: false,
          remoteWrites: false,
        },
      },
      null,
      2,
    ) + '\n',
  );
  process.stdout.write(
    'passed: ' + checks.length + ' album activation groups\n',
  );
} finally {
  await mf.dispose();
}
