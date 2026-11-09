import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { unstable_splitSqlQuery } from 'wrangler';
import { applyMigration } from './apply-migration.mjs';
import { runInheritedShareApiChecks } from './inherited-share-api-checks.mjs';

const migrationLimit = 69;
const migration69Name = '0069_inherited_share_expiry.sql';
const base = 'http://127.0.0.1:8795';
const authSecret =
  'inherited-share-expiry-focused-isolated-secret-at-least-forty-characters';
const ownerId = randomUUID();
const ownerSessionId = randomUUID();
const workspaceId = randomUUID();
const projectId = randomUUID();
const historicalAlbumId = randomUUID();
const currentAlbumId = randomUUID();
const secondCurrentAlbumId = randomUUID();
const foreignOwnerId = randomUUID();
const foreignWorkspaceId = randomUUID();
const foreignProjectId = randomUUID();
const foreignAlbumId = randomUUID();
const legacyInviteId = randomUUID();
const legacyGuestId = randomUUID();
const legacyGuestSessionId = randomUUID();
const legacyGuestSecret = randomUUID().replaceAll('-', '').padEnd(64, 'a');
const legacyInviteTokenHash = createHash('sha256')
  .update('synthetic-schema69-legacy-custom-token')
  .digest('hex');
const legacyGuestSecretHash = createHash('sha256')
  .update(`kino-pic:guest-session:v1:${legacyGuestSecret}`)
  .digest('hex');
const oldAlbumCreatedAt = '2020-01-01T00:00:00.000Z';
const currentAlbumCreatedAt = new Date().toISOString();
const workerConfig = {
  name: 'app',
  modules: true,
  scriptPath: resolve('.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  outboundService: async () => new Response(null, { status: 503 }),
  bindings: {
    APP_ENV: 'local',
    APP_URL: base,
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    DIRECT_UPLOAD_ENABLED: 'false',
    GUEST_INVITE_ISSUANCE_ENABLED: 'true',
    INHERITED_SHARE_ISSUANCE_ENABLED: 'true',
    GUEST_EXCHANGE_ENABLED: 'true',
    ALBUM_ACTIVATION_ENABLED: 'true',
    ALBUM_RETENTION_POLICY_ENABLED: 'true',
    HUMAN_VIEW_TRACKING_ENABLED: 'true',
    BETTER_AUTH_SECRET: authSecret,
    R2_ACCOUNT_ID: 'a'.repeat(32),
    R2_ACCESS_KEY_ID: 'synthetic-test-access',
    R2_SECRET_ACCESS_KEY: 'synthetic-test-not-real-secret',
    R2_BUCKET_NAME: 'inherited-share-expiry-focused',
  },
  d1Databases: { DB: 'inherited-share-expiry-focused' },
  r2Buckets: { PRIMARY_STORAGE: 'inherited-share-expiry-focused' },
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
const disabledWorkerConfig = {
  ...workerConfig,
  name: 'inherited-share-expiry-disabled',
  bindings: {
    ...workerConfig.bindings,
    INHERITED_SHARE_ISSUANCE_ENABLED: 'false',
  },
};
const mf = new Miniflare(
  convertV4MiniflareOptions({ workers: [workerConfig, disabledWorkerConfig] }),
);

const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const canonicalRowsHash = (rows) =>
  createHash('sha256')
    .update(
      rows
        .map((row) =>
          JSON.stringify(
            Object.keys(row)
              .sort()
              .map((key) => [key, row[key]]),
          ),
        )
        .sort()
        .join('\n'),
    )
    .digest('hex');
const canonicalLfSha256 = (value) =>
  createHash('sha256')
    .update(value.toString('utf8').replace(/\r\n/gu, '\n'))
    .digest('hex');

async function migrationNamesThrough69() {
  const files = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= migrationLimit)
    .sort();
  const schema68 = files.filter((name) => Number(name.slice(0, 4)) <= 68);
  assert.equal(schema68.length, 68, 'expected the complete schema68 chain');
  assert.equal(
    files.length,
    69,
    'expected schema68 plus exactly one schema69 migration',
  );
  assert.equal(files[68], migration69Name);
  return files;
}

async function snapshotLegacyTables(db) {
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL " +
          "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' " +
          "AND name<>'d1_migrations' ORDER BY name",
      )
      .all()
  ).results.map((row) => row.name);

  const counts = await db.batch(
    tables.map((name) =>
      db.prepare(`SELECT count(*) AS n FROM ${quoteIdentifier(name)}`).bind(),
    ),
  );
  const snapshot = new Map();
  for (let index = 0; index < tables.length; index++) {
    const name = tables[index];
    const count = counts[index].results[0].n;
    const columns = (
      await db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all()
    ).results.map((column) => column.name);
    const rows = count
      ? (await db.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all())
          .results
      : [];
    snapshot.set(name, {
      columns,
      count,
      hash: canonicalRowsHash(rows),
    });
  }
  return snapshot;
}

async function assertLegacyTablesPreserved(db, before) {
  const afterTables = new Set(
    (
      await db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL " +
            "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' " +
            "AND name<>'d1_migrations' ORDER BY name",
        )
        .all()
    ).results.map((row) => row.name),
  );

  for (const [name, old] of before) {
    assert.ok(afterTables.has(name), `legacy table disappeared: ${name}`);
    const afterColumns = (
      await db.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all()
    ).results.map((column) => column.name);
    for (const column of old.columns)
      assert.ok(
        afterColumns.includes(column),
        `legacy column disappeared: ${name}.${column}`,
      );
    const selectedColumns = old.columns.map(quoteIdentifier).join(',');
    const rows = old.count
      ? (
          await db
            .prepare(`SELECT ${selectedColumns} FROM ${quoteIdentifier(name)}`)
            .all()
        ).results
      : [];
    assert.equal(rows.length, old.count, `legacy row count changed: ${name}`);
    assert.equal(
      canonicalRowsHash(rows),
      old.hash,
      `legacy row contents changed: ${name}`,
    );
  }
}

async function schemaSnapshot(db) {
  return (
    await db
      .prepare(
        'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ' +
          "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' " +
          "AND name<>'d1_migrations' ORDER BY type,name",
      )
      .all()
  ).results;
}

async function sequenceSnapshot(db) {
  const exists = await db
    .prepare(
      "SELECT 1 FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'",
    )
    .first();
  return exists
    ? (
        await db
          .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
          .all()
      ).results
    : [];
}

async function foreignKeySnapshot(db) {
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND sql IS NOT NULL " +
          "AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' " +
          "AND name<>'d1_migrations' ORDER BY name",
      )
      .all()
  ).results.map((row) => row.name);
  const entries = [];
  for (const table of tables) {
    const rows = (
      await db
        .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
        .all()
    ).results;
    entries.push(...rows.map((row) => ({ table, ...row })));
  }
  return entries;
}

try {
  const db = await mf.getD1Database('DB', workerConfig.name);
  const worker = await mf.getWorker(workerConfig.name);
  const disabledWorker = await mf.getWorker(disabledWorkerConfig.name);
  const files = await migrationNamesThrough69();
  const schema68Files = files.slice(0, 68);

  for (const name of schema68Files.slice(0, 4))
    await applyMigration(
      db,
      await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'),
    );

  const ownerToken = randomUUID();
  const now = Date.now();
  const ownerCookie =
    'kino-owner.session_token=' +
    encodeURIComponent(
      ownerToken + '.' + (await makeSignature(ownerToken, authSecret)),
    );
  await db.batch([
    db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
      )
      .bind(ownerId, randomUUID()),
    db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(ownerSessionId, ownerToken, ownerId, now + 3_600_000, now, now),
    db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(workspaceId, 'Synthetic inherited expiry', ownerId),
    db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(projectId, workspaceId, 'Synthetic inherited expiry'),
    db
      .prepare(
        'INSERT INTO albums(id,workspace_id,project_id,name,state,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        historicalAlbumId,
        workspaceId,
        projectId,
        'historical',
        'active',
        oldAlbumCreatedAt,
      ),
    db
      .prepare(
        'INSERT INTO albums(id,workspace_id,project_id,name,state,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        currentAlbumId,
        workspaceId,
        projectId,
        'current',
        'active',
        currentAlbumCreatedAt,
      ),
    db
      .prepare(
        'INSERT INTO albums(id,workspace_id,project_id,name,state,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        secondCurrentAlbumId,
        workspaceId,
        projectId,
        'current second',
        'active',
        currentAlbumCreatedAt,
      ),
  ]);
  await db.batch([
    db
      .prepare(
        'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(
        foreignOwnerId,
        'Synthetic foreign owner',
        foreignOwnerId + '@inherited-expiry.invalid',
        now,
        now,
      ),
    db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(foreignWorkspaceId, 'Synthetic other workspace', foreignOwnerId),
    db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(foreignProjectId, foreignWorkspaceId, 'Synthetic other project'),
    db
      .prepare(
        'INSERT INTO albums(id,workspace_id,project_id,name,state,created_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        foreignAlbumId,
        foreignWorkspaceId,
        foreignProjectId,
        'foreign',
        'active',
        currentAlbumCreatedAt,
      ),
  ]);
  for (const name of schema68Files.slice(4))
    await applyMigration(
      db,
      await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8'),
    );

  const customDeadline = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const guestSessionCreatedAt = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,? ,'link_only',NULL,1,?,NULL,?,?)",
      )
      .bind(
        legacyInviteId,
        workspaceId,
        projectId,
        legacyInviteTokenHash,
        customDeadline,
        ownerId,
        ownerSessionId,
      ),
    db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(legacyInviteId, workspaceId, projectId, historicalAlbumId),
    db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(legacyInviteId),
    db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(legacyGuestId, legacyInviteId, 'Synthetic legacy guest'),
    db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms,created_at_ms) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        legacyGuestSessionId,
        legacyInviteId,
        legacyGuestId,
        legacyGuestSecretHash,
        Math.min(customDeadline, guestSessionCreatedAt + 3_600_000),
        guestSessionCreatedAt,
      ),
  ]);

  const legacyTables = await snapshotLegacyTables(db);
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
    'schema68 fixture must be foreign-key clean before migration69',
  );

  const migration69Sql = await readFile(
    new URL('../migrations/' + migration69Name, import.meta.url),
    'utf8',
  );
  const schema68BeforeFailedBatch = await schemaSnapshot(db);
  const sequencesBeforeFailedBatch = await sequenceSnapshot(db);
  const foreignKeysBeforeFailedBatch = await foreignKeySnapshot(db);
  const failedBatchProbe = 'inherited_share_expiry_ddl_rollback_probe';
  await assert.rejects(
    () =>
      db.batch([
        ...unstable_splitSqlQuery(migration69Sql).map((sql) => db.prepare(sql)),
        db.prepare(
          `CREATE TABLE ${quoteIdentifier(failedBatchProbe)}(value INTEGER NOT NULL)`,
        ),
        db.prepare(
          `INSERT INTO ${quoteIdentifier(failedBatchProbe)}(value) VALUES(NULL)`,
        ),
      ]),
    /NOT NULL constraint failed/u,
    'the appended constraint error must occur after all migration69 statements',
  );
  assert.deepEqual(
    await schemaSnapshot(db),
    schema68BeforeFailedBatch,
    'failed migration69 batch must restore the exact schema68 objects',
  );
  assert.deepEqual(
    await sequenceSnapshot(db),
    sequencesBeforeFailedBatch,
    'failed migration69 batch must restore AUTOINCREMENT sequences',
  );
  assert.deepEqual(
    await foreignKeySnapshot(db),
    foreignKeysBeforeFailedBatch,
    'failed migration69 batch must restore schema68 foreign keys',
  );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
    'failed migration69 batch must leave no foreign-key violations',
  );
  await assertLegacyTablesPreserved(db, legacyTables);
  assert.equal(
    await db
      .prepare("SELECT 1 FROM sqlite_schema WHERE name=? AND type='table'")
      .bind(failedBatchProbe)
      .first(),
    null,
    'runtime NOT NULL failure must roll back its post-migration probe table',
  );

  await applyMigration(db, migration69Sql);

  await assertLegacyTablesPreserved(db, legacyTables);
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
    'schema69 must leave no foreign-key violations',
  );

  const legacyInvite = await db
    .prepare(
      'SELECT id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,expiry_mode,max_uses,created_by,owner_session_id,created_at_ms FROM guest_invites WHERE id=?',
    )
    .bind(legacyInviteId)
    .first();
  assert.equal(legacyInvite.expiry_mode, 'custom');
  assert.equal(legacyInvite.expires_at_ms, customDeadline);
  const legacyScope = await db
    .prepare(
      'SELECT invite_id,workspace_id,project_id,album_id,inherit_generation FROM guest_invite_albums WHERE invite_id=? AND album_id=?',
    )
    .bind(legacyInviteId, historicalAlbumId)
    .first();
  assert.equal(legacyScope.inherit_generation, null);
  const legacySession = await db
    .prepare(
      'SELECT id,invite_id,guest_id,secret_hash,expires_at_ms,created_at_ms FROM guest_sessions WHERE id=?',
    )
    .bind(legacyGuestSessionId)
    .first();
  assert.equal(legacySession.invite_id, legacyInviteId);
  assert.equal(legacySession.guest_id, legacyGuestId);

  const legacyExpiry = await db
    .prepare(
      'SELECT invite_id,workspace_id,project_id,album_id,expiry_mode,expires_at_ms,expiry_valid FROM effective_guest_invite_album_expiry WHERE invite_id=? AND workspace_id=? AND project_id=? AND album_id=?',
    )
    .bind(legacyInviteId, workspaceId, projectId, historicalAlbumId)
    .first();
  assert.equal(legacyExpiry.expiry_mode, 'custom');
  assert.equal(legacyExpiry.expires_at_ms, customDeadline);
  assert.equal(legacyExpiry.expiry_valid, 1);

  const seededStates = (
    await db
      .prepare(
        'SELECT album_id,workspace_id,project_id,generation,phase,expires_at_ms,inputs_json,last_transition_id FROM album_inherited_share_states ORDER BY album_id',
      )
      .all()
  ).results;
  assert.equal(
    seededStates.length,
    4,
    'migration must bootstrap each active album',
  );
  for (const state of seededStates) {
    assert.equal(state.generation, 1);
    assert.equal(state.phase, 'off');
    assert.equal(state.expires_at_ms, null);
    assert.match(state.last_transition_id, /^bootstrap:/u);
  }

  await assert.rejects(
    () =>
      db
        .prepare('UPDATE albums SET created_at=? WHERE id=?')
        .bind('2026-01-01T00:00:00.000Z', currentAlbumId)
        .run(),
    /IMMUTABLE_ALBUM_CREATED_AT/u,
  );
  await assert.rejects(
    () =>
      db
        .prepare(
          'INSERT OR REPLACE INTO albums(id,workspace_id,project_id,name,state,created_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          currentAlbumId,
          workspaceId,
          projectId,
          'replacement attempt',
          'active',
          currentAlbumCreatedAt,
        )
        .run(),
    /IMMUTABLE_ALBUM_ID/u,
  );

  await assert.rejects(
    () =>
      db
        .prepare(
          'UPDATE album_inherited_share_states SET generation=generation+1 WHERE album_id=?',
        )
        .bind(historicalAlbumId)
        .run(),
    /INHERITED_SHARE_TRANSITION_REQUIRED/u,
  );
  await assert.rejects(
    () =>
      db
        .prepare('DELETE FROM album_inherited_share_states WHERE album_id=?')
        .bind(historicalAlbumId)
        .run(),
    /IMMUTABLE_INHERITED_SHARE_STATE/u,
  );

  const next = await db
    .prepare(
      'SELECT album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json FROM next_album_inherited_share_state WHERE album_id=?',
    )
    .bind(historicalAlbumId)
    .first();
  const forgedEventId = randomUUID();
  await assert.rejects(
    () =>
      db
        .prepare(
          'INSERT INTO album_inherited_share_transitions(id,source_kind,source_id,album_id,workspace_id,project_id,prior_transition_id,generation,phase,expires_at_ms,inputs_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          `human:${forgedEventId}:${next.album_id}`,
          'human',
          forgedEventId,
          next.album_id,
          next.workspace_id,
          next.project_id,
          next.prior_transition_id,
          next.generation,
          next.phase,
          next.expires_at_ms,
          next.inputs_json,
        )
        .run(),
    /INHERITED_SHARE_CAUSE_REQUIRED/u,
  );

  const apiChecks = await runInheritedShareApiChecks({
    db,
    worker,
    disabledWorker,
    base,
    ownerId,
    ownerSessionId,
    ownerCookie,
    workspaceId,
    projectId,
    historicalAlbumId,
    currentAlbumId,
    secondCurrentAlbumId,
    foreignWorkspaceId,
    foreignProjectId,
    foreignAlbumId,
  });
  assert.equal(
    apiChecks.checks.length,
    12,
    'all 12 native API checks must run',
  );
  const foreignKeyViolations = (
    await db.prepare('PRAGMA foreign_key_check').all()
  ).results;
  assert.equal(foreignKeyViolations.length, 0);

  const nativeChecks = [
    '0069 DDL failure rolls back schema, AUTOINCREMENT sequences, and foreign keys',
    '0069 preserves legacy table columns and every preexisting row',
    'legacy custom invite, album scope, and Guest session remain valid',
    'every existing active album receives the initial inherited-expiry state',
    'album created-at edits and ID replacement are rejected',
    'direct inherited-state edits and forged transition causes are rejected',
    'foreign_key_check is empty after the migration and API checks',
  ];
  const checks = [...nativeChecks, ...apiChecks.checks];
  const sourcePaths = [
    '.build/index.js',
    'tests/inherited-share-expiry-focused.mjs',
    'tests/inherited-share-api-checks.mjs',
    'tests/apply-migration.mjs',
    'src/guest-expiry-sql.ts',
    'src/guest-access.ts',
    'src/guest-exchange.ts',
    'src/invite-issuance.ts',
    'src/invites.ts',
    'src/config.ts',
    'src/index.ts',
    '../../packages/contracts/src/guest-access.ts',
    '../../packages/contracts/src/invites.ts',
    '../../packages/domain/src/share-expiry.ts',
    '../../apps/web/target-ui/invite-create.tsx',
    '../../apps/web/target-ui/project-invites.tsx',
    '../../apps/web/target-ui/guest-expiry.tsx',
  ];
  const sourceFiles = {};
  for (const file of sourcePaths)
    sourceFiles[file] = canonicalLfSha256(await readFile(file));
  const sourceDigest = createHash('sha256');
  for (const [file, digest] of Object.entries(sourceFiles).sort(
    ([left], [right]) => left.localeCompare(right),
  ))
    sourceDigest.update(file + '\0' + digest + '\n');

  const migrationDigest = createHash('sha256');
  for (const name of files)
    migrationDigest
      .update(name + '\0')
      .update(
        (await readFile(resolve('migrations', name), 'utf8')).replace(
          /\r\n/gu,
          '\n',
        ),
      );
  const proof = {
    status: 'passed_native_inherited_share_expiry',
    schemaVersion: migrationLimit,
    migrationCount: files.length,
    latestMigration: files.at(-1),
    migrationsSha256: migrationDigest.digest('hex'),
    migrationDigestAlgorithm: 'SHA-256',
    migrationDigestFormat:
      'ascending migration filename + NUL + canonical LF SQL bytes',
    sourceSha256: sourceDigest.digest('hex'),
    sourceFiles,
    bundleSha256: sourceFiles['.build/index.js'],
    checks,
    nativeChecks,
    apiChecks: apiChecks.checks,
    notChecked: [
      ...new Set([
        ...apiChecks.notChecked,
        'hosted Cloudflare D1 or Worker behavior',
        'real OAuth provider authentication',
        'real Human photo-view ingestion',
        'production deployment',
      ]),
    ],
    checkCount: checks.length,
    syntheticOwner: true,
    realOAuth: false,
    remoteCloudflare: false,
    hostedDeployment: false,
    foreignKeyViolations: foreignKeyViolations.length,
    runtime: 'Miniflare native Worker with ephemeral D1 and R2',
  };
  await mkdir('.local', { recursive: true });
  await writeFile(
    '.local/inherited-share-expiry-proof.json',
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(
    `passed: schema 69 inherited-share migration and native checks (${proof.checkCount} named checks)`,
  );
} finally {
  await mf.dispose();
}
