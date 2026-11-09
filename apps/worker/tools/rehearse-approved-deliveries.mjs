import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  validateInheritedShare0069RestoreManifest,
  validateInheritedShare0069Schema,
} from '../../../tools/check-staging-collaboration-release.mjs';
import {
  splitAndClassifyHostedBackupSql,
  snapshotDatabase,
} from './rehearse-hosted-d1-restore.mjs';

const legacyColumns0069 = {
  guest_invites: [
    'id',
    'workspace_id',
    'project_id',
    'token_hash',
    'access_mode',
    'password_verifier',
    'permissions_mask',
    'expires_at_ms',
    'max_uses',
    'created_by',
    'owner_session_id',
    'created_at_ms',
  ],
  guest_invite_albums: ['invite_id', 'workspace_id', 'project_id', 'album_id'],
};
function sqlQuote(identifier) {
  return '"' + identifier.replaceAll('"', '""') + '"';
}
function legacyProjection(db, table, columns) {
  return db
    .prepare(
      'SELECT ' + columns.map(sqlQuote).join(',') + ' FROM ' + sqlQuote(table),
    )
    .all()
    .map((row) => JSON.stringify(row))
    .sort();
}
function legacyColumnDefinitions(db, table, columns) {
  const available = db
    .prepare('PRAGMA table_info(' + sqlQuote(table) + ')')
    .all();
  return columns.map((name) => {
    const column = available.find((entry) => entry.name === name);
    assert.ok(column, 'Legacy column missing: ' + table + '.' + name);
    return {
      name,
      type: column.type,
      notnull:
        table === 'guest_invites' && name === 'expires_at_ms'
          ? 0
          : column.notnull,
      dflt_value: column.dflt_value,
      pk: column.pk,
    };
  });
}
function foreignKeyDefinitions(db, table) {
  return db
    .prepare('PRAGMA foreign_key_list(' + sqlQuote(table) + ')')
    .all()
    .map(({ seq, table: target, from, to, on_update, on_delete, match }) => ({
      seq,
      table: target,
      from,
      to,
      on_update,
      on_delete,
      match,
    }))
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
}
function verifyLegacy0069(beforeDb, afterDb) {
  const oldExpiry = beforeDb
    .prepare('PRAGMA table_info("guest_invites")')
    .all()
    .find(({ name }) => name === 'expires_at_ms');
  const newExpiry = afterDb
    .prepare('PRAGMA table_info("guest_invites")')
    .all()
    .find(({ name }) => name === 'expires_at_ms');
  assert.equal(oldExpiry?.notnull, 1, 'Source invite expiry must be required');
  assert.equal(
    newExpiry?.notnull,
    0,
    'Inherited invite expiry must allow NULL',
  );
  for (const [table, columns] of Object.entries(legacyColumns0069)) {
    assert.deepEqual(
      legacyColumnDefinitions(afterDb, table, columns),
      legacyColumnDefinitions(beforeDb, table, columns),
      'Legacy columns changed: ' + table,
    );
    assert.deepEqual(
      legacyProjection(afterDb, table, columns),
      legacyProjection(beforeDb, table, columns),
      'Legacy rows changed: ' + table,
    );
  }
  for (const table of Object.keys(legacyColumns0069))
    assert.deepEqual(
      foreignKeyDefinitions(afterDb, table),
      foreignKeyDefinitions(beforeDb, table),
      'Legacy foreign keys changed: ' + table,
    );
  const legacyInviteCount = Number(
    afterDb.prepare('SELECT count(*) AS n FROM guest_invites').get().n,
  );
  const legacyInviteAlbumCount = Number(
    afterDb.prepare('SELECT count(*) AS n FROM guest_invite_albums').get().n,
  );
  assert.equal(
    Number(
      afterDb
        .prepare(
          "SELECT count(*) AS n FROM guest_invites WHERE expiry_mode<>'custom'",
        )
        .get().n,
    ),
    0,
    'Existing invites must keep custom expiry mode',
  );
  assert.equal(
    Number(
      afterDb
        .prepare(
          'SELECT count(*) AS n FROM guest_invite_albums WHERE inherit_generation IS NOT NULL',
        )
        .get().n,
    ),
    0,
    'Existing invite scopes must have no inherited generation',
  );
  return {
    legacyInviteColumnsPreserved: true,
    legacyScopeColumnsPreserved: true,
    legacyInviteModesVerified: true,
    legacyScopeGenerationsVerified: true,
    legacyInviteCount,
    legacyInviteAlbumCount,
  };
}
function checkOld(before, after, schemaVersion) {
  let legacy = null;
  if (schemaVersion === 69) {
    legacy = verifyLegacy0069(before.db, after.db);
    assert.deepEqual(
      after.db
        .prepare('SELECT * FROM d1_migrations ORDER BY id')
        .all()
        .slice(
          0,
          before.db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n,
        ),
      before.db.prepare('SELECT * FROM d1_migrations ORDER BY id').all(),
      'Existing migration ledger rows must be preserved exactly',
    );
  }
  for (const [name, value] of Object.entries(before.snapshot.tableHashes)) {
    if (name === 'd1_migrations') continue;
    if (schemaVersion === 69 && Object.hasOwn(legacyColumns0069, name))
      continue;
    assert.deepEqual(
      after.snapshot.tableHashes[name],
      value,
      'Old product rows changed: ' + name,
    );
  }
  assert.deepEqual(
    after.db
      .prepare(
        "SELECT name,seq FROM sqlite_sequence WHERE name<>'d1_migrations' ORDER BY name",
      )
      .all(),
    before.db
      .prepare(
        "SELECT name,seq FROM sqlite_sequence WHERE name<>'d1_migrations' ORDER BY name",
      )
      .all(),
  );
  return legacy;
}
const migrationTimeColumns = {
  album_retention_policy_configurations: 'updated_at_ms',
  album_inherited_share_transitions: 'created_at_ms',
};
const bootstrapTimeColumns = [
  {
    table: 'album_retention_policy_configurations',
    column: 'updated_at_ms',
  },
  { table: 'album_inherited_share_transitions', column: 'created_at_ms' },
];
function generatedMigrationTimestamp(db, table, column) {
  assert.equal(migrationTimeColumns[table], column);
  const quoted = sqlQuote(column);
  const result = db
    .prepare(
      `SELECT count(*) AS count,min(${quoted}) AS minimum,max(${quoted}) AS maximum,` +
        `sum(CASE WHEN typeof(${quoted})<>'integer' OR ${quoted}<=0 THEN 1 ELSE 0 END) AS invalid ` +
        `FROM ${sqlQuote(table)}`,
    )
    .get();
  assert.ok(result.count > 0, 'Migration timestamp batch must contain rows');
  assert.equal(
    result.invalid,
    0,
    'Migration timestamps must be positive integers',
  );
  assert.equal(
    result.minimum,
    result.maximum,
    'Each migration timestamp batch must have one SQL clock value',
  );
  return Number(result.minimum);
}
function sqliteClockMs(db) {
  const value = Number(
    db
      .prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms")
      .get().now_ms,
  );
  assert.ok(Number.isSafeInteger(value) && value > 0);
  return value;
}
function assertMigrationClockWindow(window) {
  const values = [
    window.beforeMs,
    window.policySeedMs,
    window.shareBootstrapMs,
    window.afterMs,
  ];
  assert.ok(values.every((value) => Number.isSafeInteger(value) && value > 0));
  assert.ok(
    window.beforeMs <= window.policySeedMs &&
      window.policySeedMs <= window.shareBootstrapMs &&
      window.shareBootstrapMs <= window.afterMs,
    'Generated migration timestamps must be ordered inside the SQL clock window',
  );
  assert.ok(
    window.afterMs - window.beforeMs <= 30 * 60 * 1000,
    'Migration clock window exceeds 30 minutes',
  );
  return window;
}
function migrationClockWindow(db, beforeMs, afterMs) {
  return assertMigrationClockWindow({
    beforeMs,
    afterMs,
    policySeedMs: generatedMigrationTimestamp(
      db,
      'album_retention_policy_configurations',
      'updated_at_ms',
    ),
    shareBootstrapMs: generatedMigrationTimestamp(
      db,
      'album_inherited_share_transitions',
      'created_at_ms',
    ),
  });
}
function migratedRows(db, table) {
  const rows = db.prepare('SELECT * FROM ' + sqlQuote(table)).all();
  const volatileColumn = {
    album_retention_policy_configurations: 'updated_at_ms',
    album_inherited_share_transitions: 'created_at_ms',
  }[table];
  if (volatileColumn)
    for (const row of rows) {
      assert.ok(
        Number.isSafeInteger(row[volatileColumn]) && row[volatileColumn] > 0,
        'Generated migration timestamp must be a positive integer: ' + table,
      );
      row[volatileColumn] = '<migration-time>';
    }
  return rows.map((row) => JSON.stringify(row)).sort();
}
function checkMigratedRows(expected, actual) {
  for (const state of [expected, actual]) {
    assertMigrationClockWindow(state.clockWindow);
    assert.deepEqual(
      migrationClockWindow(
        state.db,
        state.clockWindow.beforeMs,
        state.clockWindow.afterMs,
      ),
      state.clockWindow,
      'Clock receipts must match the original generated database values',
    );
  }
  for (const [name, value] of Object.entries(expected.snapshot.tableHashes)) {
    if (name !== 'd1_migrations')
      assert.deepEqual(
        name === 'album_retention_policy_configurations' ||
          name === 'album_inherited_share_transitions'
          ? migratedRows(actual.db, name)
          : actual.snapshot.tableHashes[name],
        name === 'album_retention_policy_configurations' ||
          name === 'album_inherited_share_transitions'
          ? migratedRows(expected.db, name)
          : value,
        'Migrated rows differ from the independently applied schema: ' + name,
      );
  }
  assert.deepEqual(
    actual.db
      .prepare(
        "SELECT name,seq FROM sqlite_sequence WHERE name<>'d1_migrations' ORDER BY name",
      )
      .all(),
    expected.db
      .prepare(
        "SELECT name,seq FROM sqlite_sequence WHERE name<>'d1_migrations' ORDER BY name",
      )
      .all(),
    'Migrated sequences differ from the independently applied schema',
  );
}
function inheritedShare0069SchemaRows(db, migrationSql) {
  const names = new Set(['guest_invite_albums']);
  for (const statement of unstable_splitSqlQuery(migrationSql)) {
    const clean = statement
      .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
      .trim();
    const match =
      /^CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\s+(\w+)\b/i.exec(
        clean,
      );
    if (match && match[1] !== 'kino_guest_invites_0069_copy')
      names.add(match[1]);
  }
  return db
    .prepare(
      "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .filter(({ name }) => names.has(name))
    .sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
    );
}
function verifyInheritedShare0069Schema(db, migrationSql, schemaVersion) {
  if (schemaVersion !== 69) return;
  validateInheritedShare0069Schema(
    inheritedShare0069SchemaRows(db, migrationSql),
    migrationSql,
  );
}
function inheritedStateBootstrap(db) {
  const totals = db
    .prepare(
      'SELECT (SELECT count(*) FROM albums) AS albums,' +
        '(SELECT count(*) FROM album_inherited_share_states) AS states,' +
        '(SELECT count(*) FROM album_inherited_share_transitions) AS transitions,' +
        "(SELECT count(*) FROM album_inherited_share_transitions WHERE source_kind='bootstrap') AS bootstraps",
    )
    .get();
  assert.ok(totals.albums > 0, 'Existing albums required for bootstrap proof');
  assert.equal(totals.states, totals.albums);
  assert.equal(totals.transitions, totals.albums);
  assert.equal(totals.bootstraps, totals.albums);
  const invalid = db
    .prepare(
      "SELECT count(*) AS n FROM albums a LEFT JOIN album_inherited_share_states s ON s.album_id=a.id AND s.workspace_id=a.workspace_id AND s.project_id=a.project_id LEFT JOIN album_inherited_share_transitions t ON t.id=s.last_transition_id WHERE s.album_id IS NULL OR s.generation<>1 OR t.id IS NULL OR t.source_kind<>'bootstrap' OR t.source_id<>a.id OR t.album_id<>a.id OR t.workspace_id<>a.workspace_id OR t.project_id<>a.project_id OR t.prior_transition_id IS NOT NULL OR t.generation<>s.generation OR t.phase<>s.phase OR t.expires_at_ms IS NOT s.expires_at_ms OR t.inputs_json<>s.inputs_json OR typeof(t.created_at_ms)<>'integer' OR t.created_at_ms<=0",
    )
    .get().n;
  assert.equal(
    invalid,
    0,
    'Every existing album needs an exact bootstrap state',
  );
  return Number(totals.albums);
}

function applyMigrationTransaction(db, sql) {
  db.exec('BEGIN;');
  try {
    db.exec(sql);
    db.exec('COMMIT;');
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  }
}

function verifyFinalLedger69(before, after, migrations) {
  const prefix = before
    .prepare('SELECT * FROM d1_migrations ORDER BY id')
    .all();
  const rows = after.prepare('SELECT * FROM d1_migrations ORDER BY id').all();
  const lastId = prefix.at(-1).id;
  assert.equal(
    before
      .prepare("SELECT seq FROM sqlite_sequence WHERE name='d1_migrations'")
      .get().seq,
    lastId,
  );
  assert.deepEqual(rows.slice(0, prefix.length), prefix);
  assert.deepEqual(
    rows.slice(prefix.length).map(({ id, name }) => [id, name]),
    migrations.map(({ name }, index) => [lastId + index + 1, name]),
  );
  assert.equal(
    after
      .prepare("SELECT seq FROM sqlite_sequence WHERE name='d1_migrations'")
      .get().seq,
    lastId + migrations.length,
  );
}

function assertRestoreIdentity69(
  proof,
  state,
  target,
  restoreConfig,
  directory,
) {
  assert.match(
    proof.restoreDatabaseId,
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
  );
  assert.notEqual(proof.restoreDatabaseId, proof.sourceDatabaseId);
  assert.deepEqual(state, {
    directory,
    restoreDatabaseId: proof.restoreDatabaseId,
    sourceDatabaseId: proof.sourceDatabaseId,
  });
  assert.equal(target.accountId, proof.accountId);
  assert.equal(target.databaseId, proof.restoreDatabaseId);
  assert.match(target.name, /^kino-pick-restore69-[a-f0-9]{8}$/);
  assert.deepEqual(restoreConfig, {
    account_id: proof.accountId,
    d1_databases: [
      {
        binding: 'DB',
        database_name: target.name,
        database_id: proof.restoreDatabaseId,
        migrations_dir: resolve('migrations'),
      },
    ],
  });
}

function expectedUpgrade(before, migrations, targetSchemaVersion) {
  const db = new DatabaseSync(':memory:');
  db.deserialize(before.db.serialize());
  db.exec('PRAGMA foreign_keys=ON;');
  const beforeMs = sqliteClockMs(db);
  for (const entry of migrations) applyMigrationTransaction(db, entry.sql);
  const afterMs = sqliteClockMs(db);
  return {
    db,
    snapshot: snapshotDatabase(db),
    ...(targetSchemaVersion === 69
      ? { clockWindow: migrationClockWindow(db, beforeMs, afterMs) }
      : {}),
  };
}

function schema(db) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => ({ ...row, sql: row.sql.replaceAll('\r\n', '\n') }));
}

function albumRetentionDefaults(db) {
  const albums = db.prepare('SELECT count(*) AS n FROM albums').get().n;
  const policies = db
    .prepare('SELECT count(*) AS n FROM album_retention_policy_configurations')
    .get().n;
  const invalid = db
    .prepare(
      'SELECT count(*) AS n FROM album_retention_policy_configurations WHERE inactive_days<>90 OR cleanup_allowed<>0 OR revision<>0 OR last_command_id IS NOT NULL',
    )
    .get().n;
  const effective = db
    .prepare('SELECT count(*) AS n FROM effective_album_retention_policy')
    .get().n;
  assert.ok(albums > 0, 'Existing album rows required for backfill proof');
  assert.equal(policies, albums, 'Every existing album needs a policy row');
  assert.equal(
    invalid,
    0,
    'Backfilled policies must default to 90 days and OFF',
  );
  assert.equal(
    effective,
    albums,
    'Every existing album needs an effective policy',
  );
  return albums;
}

async function runLocalSelfTest69() {
  const migrationFiles = (await readdir('migrations')).filter((name) =>
    /^\d+_.+\.sql$/.test(name),
  );
  const ordered = migrationFiles
    .map((name) => ({
      name,
      version: Number(name.slice(0, name.indexOf('_'))),
    }))
    .sort((left, right) => left.version - right.version);
  assert.deepEqual(
    ordered.map(({ version }) => version),
    Array.from({ length: 69 }, (_, index) => index + 1),
  );
  const migrations = await Promise.all(
    ordered.map(async ({ name, version }) => ({
      name,
      version,
      sql: (await readFile(join('migrations', name))).toString('utf8'),
    })),
  );
  const db = new DatabaseSync(':memory:');
  db.exec(
    'PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,applied_at INTEGER NOT NULL);',
  );
  const ledgerInsert = db.prepare(
    'INSERT INTO d1_migrations(id,name,applied_at) VALUES(?,?,?)',
  );
  for (const migration of migrations.slice(0, 67)) {
    applyMigrationTransaction(db, migration.sql);
    ledgerInsert.run(migration.version, migration.name, migration.version);
  }
  const now = sqliteClockMs(db);
  db.prepare(
    'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
  ).run('local-owner', 'Local owner', 'owner@example.invalid', 1, now, now);
  db.prepare('INSERT INTO owners(id,user_id,enabled) VALUES(1,?,1)').run(
    'local-owner',
  );
  db.prepare(
    'INSERT INTO owner_sessions(id,token,expiresAt,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
  ).run(
    'local-owner-session',
    'local-owner-token',
    now + 86_400_000,
    'local-owner',
    now,
    now,
  );
  db.prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)').run(
    'local-workspace',
    'Local workspace',
    'local-owner',
  );
  db.prepare(
    'INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,?)',
  ).run('local-project', 'local-workspace', 'Local project', 'draft');
  db.prepare(
    'INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,?)',
  ).run(
    'local-album',
    'local-workspace',
    'local-project',
    'Local album',
    'active',
  );
  const inviteExpiry = now + 300_000;
  db.prepare(
    'INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    'local-legacy-invite',
    'local-workspace',
    'local-project',
    'a'.repeat(64),
    'link_only',
    null,
    1,
    inviteExpiry,
    5,
    'local-owner',
    'local-owner-session',
  );
  db.prepare(
    'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
  ).run(
    'local-legacy-invite',
    'local-workspace',
    'local-project',
    'local-album',
  );
  db.prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)').run(
    'local-legacy-invite',
  );
  db.prepare(
    'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
  ).run('local-guest', 'local-legacy-invite', 'Local guest');
  db.prepare(
    'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
  ).run(
    'local-guest-session',
    'local-legacy-invite',
    'local-guest',
    'b'.repeat(64),
    inviteExpiry,
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM guest_invites').get().n,
    1,
  );
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM guest_invite_albums').get().n,
    1,
  );
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM guest_sessions').get().n,
    1,
  );

  const beforeDb = new DatabaseSync(':memory:');
  beforeDb.deserialize(db.serialize());
  const before = { db: beforeDb, snapshot: snapshotDatabase(beforeDb) };
  const policyMigration = migrations[67];
  assert.equal(
    policyMigration.name,
    '0068_album_retention_policy_configuration.sql',
  );
  const beforeMs = sqliteClockMs(db);
  applyMigrationTransaction(db, policyMigration.sql);
  ledgerInsert.run(
    policyMigration.version,
    policyMigration.name,
    policyMigration.version,
  );
  const policyDefaults = albumRetentionDefaults(db);
  assert.equal(policyDefaults, 1);
  const schemaAt68 = schema(db);
  const rowsAt68 = snapshotDatabase(db);
  const shareMigration = migrations[68];
  assert.equal(shareMigration.name, '0069_inherited_share_expiry.sql');
  assert.throws(
    () =>
      applyMigrationTransaction(
        db,
        shareMigration.sql +
          "\nINSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES('missing-invite','missing-workspace','missing-project','missing-album');",
      ),
    /INVALID_INVITE_EXPIRY/,
  );
  assert.deepEqual(
    schema(db),
    schemaAt68,
    'Failed 0069 transaction must roll back fully',
  );
  assert.deepEqual(
    snapshotDatabase(db),
    rowsAt68,
    'Every schema68 row and sequence must survive the failed69 transaction',
  );
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n,
    68,
  );
  assert.equal(
    db
      .prepare('PRAGMA table_info("guest_invites")')
      .all()
      .some(({ name }) => name === 'expiry_mode'),
    false,
  );

  const shareBeforeMs = sqliteClockMs(db);
  applyMigrationTransaction(db, shareMigration.sql);
  ledgerInsert.run(
    shareMigration.version,
    shareMigration.name,
    shareMigration.version,
  );
  const afterMs = sqliteClockMs(db);
  const actual = { db, snapshot: snapshotDatabase(db) };
  const legacyProof = checkOld(before, actual, 69);
  assert.deepEqual(legacyProof, {
    legacyInviteColumnsPreserved: true,
    legacyScopeColumnsPreserved: true,
    legacyInviteModesVerified: true,
    legacyScopeGenerationsVerified: true,
    legacyInviteCount: 1,
    legacyInviteAlbumCount: 1,
  });
  assert.equal(albumRetentionDefaults(db), 1);
  assert.equal(inheritedStateBootstrap(db), 1);
  verifyFinalLedger69(beforeDb, db, [policyMigration, shareMigration]);
  verifyInheritedShare0069Schema(db, shareMigration.sql, 69);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM guest_sessions').get().n,
    1,
  );
  assert.deepEqual(
    db
      .prepare('SELECT id,name FROM d1_migrations ORDER BY id DESC LIMIT 2')
      .all()
      .map((row) => ({ ...row })),
    [
      { id: 69, name: shareMigration.name },
      { id: 68, name: policyMigration.name },
    ],
  );
  const clockWindow = migrationClockWindow(db, beforeMs, afterMs);
  actual.clockWindow = clockWindow;
  assert.ok(clockWindow.policySeedMs <= shareBeforeMs);

  const expectedState = expectedUpgrade(
    before,
    [policyMigration, shareMigration],
    69,
  );
  const expected = expectedState.db;
  checkMigratedRows(expectedState, actual);
  assert.deepEqual(checkOld(before, expectedState, 69), legacyProof);
  verifyInheritedShare0069Schema(expected, shareMigration.sql, 69);
  const tampered = new DatabaseSync(':memory:');
  tampered.deserialize(db.serialize());
  tampered.exec(
    "UPDATE users SET name='unexpected change' WHERE id='local-owner'",
  );
  const tamperedState = {
    db: tampered,
    snapshot: snapshotDatabase(tampered),
    clockWindow,
  };
  assert.throws(
    () => checkMigratedRows(expectedState, tamperedState),
    /Migrated rows differ/,
  );
  tampered.exec(
    "UPDATE users SET name='Local owner' WHERE id='local-owner'; UPDATE d1_migrations SET applied_at=9999 WHERE id=1",
  );
  assert.throws(
    () =>
      checkOld(
        before,
        { db: tampered, snapshot: snapshotDatabase(tampered) },
        69,
      ),
    /migration ledger rows/,
  );
  tampered.close();
  const shiftedLedger = new DatabaseSync(':memory:');
  shiftedLedger.deserialize(db.serialize());
  shiftedLedger.exec(
    "UPDATE sqlite_sequence SET seq=1000 WHERE name='d1_migrations'",
  );
  assert.throws(() =>
    verifyFinalLedger69(beforeDb, shiftedLedger, [
      policyMigration,
      shareMigration,
    ]),
  );
  shiftedLedger.close();
  assert.throws(
    () =>
      checkMigratedRows(expectedState, {
        ...actual,
        clockWindow: { ...clockWindow, beforeMs: clockWindow.afterMs + 1 },
      }),
    /clock window/,
  );
  const restoreOnly = {
    status: 'passed_independent_0069_restore_upgrade',
    accountId: 'd3e930465c0df7e89b35de3ca65ea36a',
    sourceDatabaseId: 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d',
    restoreDatabaseId: '11111111-2222-4333-8444-555555555555',
  };
  const directory = resolve('.local/inherited-share-0069-identity-self-test');
  const identityState = {
    directory,
    restoreDatabaseId: restoreOnly.restoreDatabaseId,
    sourceDatabaseId: restoreOnly.sourceDatabaseId,
  };
  const identityTarget = {
    accountId: restoreOnly.accountId,
    databaseId: restoreOnly.restoreDatabaseId,
    name: 'kino-pick-restore69-abcdef12',
  };
  const identityConfig = {
    account_id: restoreOnly.accountId,
    d1_databases: [
      {
        binding: 'DB',
        database_name: identityTarget.name,
        database_id: identityTarget.databaseId,
        migrations_dir: resolve('migrations'),
      },
    ],
  };
  assertRestoreIdentity69(
    restoreOnly,
    identityState,
    identityTarget,
    identityConfig,
    directory,
  );
  assert.throws(() =>
    assertRestoreIdentity69(
      { ...restoreOnly, restoreDatabaseId: undefined },
      identityState,
      identityTarget,
      identityConfig,
      directory,
    ),
  );
  assert.throws(() =>
    assertRestoreIdentity69(
      restoreOnly,
      {
        ...identityState,
        restoreDatabaseId: '99999999-2222-4333-8444-555555555555',
      },
      identityTarget,
      identityConfig,
      directory,
    ),
  );
  assert.throws(() =>
    validateInheritedShare0069RestoreManifest(restoreOnly, []),
  );
  const clockResult = {
    success: true,
    results: [{ now_ms: 1234 }],
    meta: { rows_written: 0, changes: 0, changed_db: false },
  };
  assert.equal(parseDatabaseClock(JSON.stringify([clockResult])), 1234);
  for (const result of [
    { ...clockResult, success: false },
    { ...clockResult, results: [] },
    { ...clockResult, results: [{ now_ms: '1234' }] },
    { ...clockResult, results: [{ now_ms: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...clockResult, meta: { rows_written: 1 } },
    { ...clockResult, meta: { changed_db: true } },
  ])
    assert.throws(() => parseDatabaseClock(JSON.stringify([result])));
  assert.throws(
    () => parseDatabaseClock('not JSON'),
    /D1_CLOCK_QUERY_JSON_INVALID/,
  );
  db.close();
  beforeDb.close();
  expected.close();
  console.log(
    JSON.stringify({
      status: 'passed_local_inherited_share_rehearsal',
      checks: [
        'legacy-invite-scope-session',
        'migration69-rollback-keeps68',
        'schema-and-bootstrap',
        'restore-only-rejected',
        'non-clock-row-and-old-ledger-mutations-denied',
        'clock-window-required-before-projection',
        'read-only-database-clock-response-validation',
        'restore-identity-and-final-ledger-sequence',
      ],
      migrationTransactionScope: 'per_migration',
      rollbackAfter69FailureVerified: true,
      legacyInviteScopeSessionPreserved: true,
      schemaAndBootstrapVerified: true,
      readOnlyRestoreProofRejected: true,
      clockWindow,
    }),
  );
}

if (process.argv[2] === '--local-self-test') {
  assert.deepEqual(process.argv.slice(3), ['--schema=69']);
  await runLocalSelfTest69();
  process.exit(0);
}

const mode = process.argv[2];
assert.ok(['--restore', '--verify-restore', '--adopt'].includes(mode));
const suppliedArgs = process.argv.slice(3);
const schemaArgs = suppliedArgs.filter((arg) => arg.startsWith('--schema='));
assert.ok(schemaArgs.length <= 1, 'Specify --schema at most once');
const schemaVersion = schemaArgs.length
  ? Number(schemaArgs[0].slice('--schema='.length))
  : 66;
assert.ok(
  [66, 67, 68, 69].includes(schemaVersion),
  'Schema must be 66, 67, 68 or 69',
);
const positionalArgs = suppliedArgs.filter(
  (arg) => !arg.startsWith('--schema='),
);
assert.ok(positionalArgs.every((arg) => !arg.startsWith('--')));
assert.equal(
  positionalArgs.length,
  mode === '--verify-restore' ? 2 : 0,
  mode === '--verify-restore'
    ? '--verify-restore requires a directory and failed-command proof'
    : `${mode} does not accept positional arguments`,
);
const profiles = {
  66: {
    sourceSchemaVersion: 65,
    targetSchemaVersion: 66,
    migrationName: '0066_approved_deliveries.sql',
    directoryPrefix: 'approved-deliveries-0066',
    manifestPath: '../../docs/releases/approved-deliveries-0066-restore.json',
    adoptionLabel: 'adopt-source66',
  },
  67: {
    sourceSchemaVersion: 66,
    targetSchemaVersion: 67,
    migrationName: '0067_delivery_zip_tickets.sql',
    directoryPrefix: 'approved-deliveries-0067',
    manifestPath: '../../docs/releases/approved-deliveries-0067-restore.json',
    adoptionLabel: 'adopt-source66',
  },
  68: {
    sourceSchemaVersion: 67,
    targetSchemaVersion: 68,
    migrationName: '0068_album_retention_policy_configuration.sql',
    directoryPrefix: 'album-retention-policy-0068',
    manifestPath:
      '../../docs/releases/album-retention-policy-0068-restore.json',
    adoptionLabel: 'adopt-source67',
  },
  69: {
    sourceSchemaVersion: 67,
    targetSchemaVersion: 69,
    migrationName: '0069_inherited_share_expiry.sql',
    migrationNames: [
      '0068_album_retention_policy_configuration.sql',
      '0069_inherited_share_expiry.sql',
    ],
    directoryPrefix: 'inherited-share-0069',
    manifestPath: '../../docs/releases/inherited-share-0069-restore.json',
    adoptionLabel: 'adopt-source67',
  },
};
const profile = profiles[schemaVersion];
const { sourceSchemaVersion, targetSchemaVersion, migrationName } = profile;
const migrationNames = profile.migrationNames ?? [migrationName];
const schemaTag = String(targetSchemaVersion).padStart(4, '0');
const restoreStatus = `passed_independent_${schemaTag}_restore_upgrade`;
const adoptionStatus = `passed_independent_${schemaTag}_restore_and_B_adoption`;
const beforeFile = `before${sourceSchemaVersion}.sql`;
const restoredFile = `restored${sourceSchemaVersion}.sql`;
const normalizedFile = `normalized${sourceSchemaVersion}.sql`;
const upgradedFile = `upgraded${targetSchemaVersion}.sql`;
const account = 'd3e930465c0df7e89b35de3ca65ea36a';
const source = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const statePath = resolve(`.local/${profile.directoryPrefix}-current.json`);
const dir =
  mode === '--adopt'
    ? resolve(JSON.parse(await readFile(statePath, 'utf8')).directory)
    : mode === '--verify-restore'
      ? resolve(positionalArgs[0])
      : resolve(`.local/${profile.directoryPrefix}-${randomUUID()}`);
assert.ok(typeof dir === 'string' && dir.startsWith(resolve('.local') + sep));
assert.ok(new RegExp(`${profile.directoryPrefix}-[a-f0-9-]{36}$`).test(dir));
const config = join(dir, 'source.json');
const clocksFile = join(dir, 'migration-clocks.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const commands = [];
const migrationFiles = (await readdir('migrations')).filter((name) =>
  /^\d+_.+\.sql$/.test(name),
);
const migrationEntries = migrationFiles.map((name) => ({
  name,
  version: Number(name.slice(0, name.indexOf('_'))),
}));
assert.equal(
  new Set(migrationEntries.map(({ version }) => version)).size,
  migrationEntries.length,
  'Migration versions must be unique',
);
const orderedMigrationEntries = [...migrationEntries].sort(
  (left, right) => left.version - right.version,
);
assert.equal(orderedMigrationEntries.length, targetSchemaVersion);
assert.deepEqual(
  orderedMigrationEntries.map(({ version }) => version),
  Array.from({ length: targetSchemaVersion }, (_, index) => index + 1),
  'Migration versions must be contiguous from 1 through the selected target',
);
const orderedMigrationNames = orderedMigrationEntries.map(({ name }) => name);
const latestMigration = orderedMigrationEntries.at(-1);
assert.equal(
  latestMigration?.version,
  targetSchemaVersion,
  'Migration directory must end at the selected target schema',
);
assert.equal(
  latestMigration?.name,
  migrationName,
  'Selected target migration must be the final migration',
);
assert.deepEqual(
  orderedMigrationNames.slice(sourceSchemaVersion, targetSchemaVersion),
  migrationNames,
  'Selected migration chain must exactly bridge the source and target schemas',
);
const migrationChain = await Promise.all(
  migrationNames.map(async (name) => {
    const bytes = await readFile(join('migrations', name));
    return {
      name,
      bytes,
      sql: bytes.toString('utf8'),
      sha256: hash(bytes),
      canonicalSha256: hash(bytes.toString('utf8').replaceAll('\r\n', '\n')),
    };
  }),
);
const latestMigrationBytes = migrationChain.at(-1);
const migration = {
  name: latestMigrationBytes.name,
  sha256: latestMigrationBytes.sha256,
  canonicalSha256: latestMigrationBytes.canonicalSha256,
};
const migrationProofs = migrationChain.map(
  ({ name, sha256, canonicalSha256 }) => ({
    name,
    sha256,
    canonicalSha256,
  }),
);
function assertNextMigrationSequence(db) {
  const applied = db
    .prepare('SELECT name FROM d1_migrations ORDER BY id')
    .all()
    .map(({ name }) => name);
  assert.deepEqual(
    applied,
    orderedMigrationNames.slice(0, sourceSchemaVersion),
    'Source migration ledger must match its declared schema version',
  );
  assert.deepEqual(
    orderedMigrationNames,
    [...applied, ...migrationNames],
    'Migration ledger must have exactly the selected migration chain pending',
  );
}
function cli(args, label) {
  try {
    const out = execFileSync(
      process.execPath,
      ['node_modules/wrangler/bin/wrangler.js', ...args],
      {
        encoding: 'utf8',
        stdio: 'pipe',
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: account },
      },
    );
    commands.push({ label, exitCode: 0 });
    return out;
  } catch {
    commands.push({ label, exitCode: 1 });
    throw new Error('CLI_FAILED_' + label);
  }
}
function readDatabaseClock(configPath, label) {
  const output = cli(
    [
      'd1',
      'execute',
      'DB',
      '--remote',
      '--config',
      configPath,
      '--command',
      "SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms",
      '--json',
    ],
    label,
  );
  return parseDatabaseClock(output);
}
function parseDatabaseClock(output) {
  let payload;
  try {
    payload = JSON.parse(output.trim());
  } catch {
    throw new Error('D1_CLOCK_QUERY_JSON_INVALID');
  }
  const batches = Array.isArray(payload) ? payload : [payload];
  assert.equal(batches.length, 1, 'Expected one read-only D1 clock result');
  const batch = batches[0];
  assert.equal(batch.success, true, 'D1 clock query failed');
  assert.equal(batch.results?.length, 1, 'Expected one SQL clock row');
  assert.ok(
    batch.meta?.changed_db !== true &&
      (batch.meta?.changes ?? 0) === 0 &&
      (batch.meta?.rows_written ?? 0) === 0,
    'D1 clock query must remain read-only',
  );
  const value = batch.results[0].now_ms;
  assert.ok(Number.isSafeInteger(value) && value > 0);
  return value;
}
function normalized(sql) {
  const counts = {};
  for (const statement of unstable_splitSqlQuery(sql)) {
    const clean = statement
      .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
      .trim();
    const type =
      /^(PRAGMA|CREATE UNIQUE INDEX|CREATE INDEX|CREATE TABLE|CREATE TRIGGER|CREATE VIEW|INSERT INTO|DELETE FROM sqlite_sequence)/i.exec(
        clean,
      )?.[1];
    assert.ok(type, 'Unexpected export SQL');
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return splitAndClassifyHostedBackupSql(sql, counts).normalizedSql;
}
async function load(path) {
  const bytes = await readFile(path);
  const sql = normalized(bytes.toString('utf8'));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;BEGIN;' + sql + ';COMMIT;');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  return { db, sql, snapshot: snapshotDatabase(db), sha256: hash(bytes) };
}
async function exportDb(id, file, cfg, label) {
  cli(
    [
      'd1',
      'export',
      id,
      '--remote',
      '--config',
      cfg,
      '--output',
      join(dir, file),
    ],
    label,
  );
  return load(join(dir, file));
}
async function json(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}
function cfg(id, name) {
  assert.ok(id !== source || name === 'kino-pick-staging-d3e93046');
  return {
    account_id: account,
    d1_databases: [
      {
        binding: 'DB',
        database_name: name,
        database_id: id,
        migrations_dir: resolve('migrations'),
      },
    ],
  };
}
await mkdir(dir, { recursive: true });
if (process.platform === 'win32')
  execFileSync(
    'icacls.exe',
    [
      dir,
      '/inheritance:r',
      '/grant:r',
      process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)F',
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:(OI)(CI)F',
    ],
    { stdio: 'pipe', windowsHide: true },
  );
try {
  if (mode !== '--adopt') {
    const resume = mode === '--verify-restore';
    if (!resume)
      await writeFile(
        config,
        JSON.stringify(cfg(source, 'kino-pick-staging-d3e93046')),
        { flag: 'wx' },
      );
    const before = resume
      ? await load(join(dir, beforeFile))
      : await exportDb(
          source,
          beforeFile,
          config,
          `backup-source${sourceSchemaVersion}`,
        );
    assert.equal(
      before.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,
      sourceSchemaVersion,
    );
    assertNextMigrationSequence(before.db);
    const expectedDb = expectedUpgrade(
      before,
      migrationChain,
      targetSchemaVersion,
    );
    const expected = expectedDb.db;
    const legacyProof = checkOld(before, expectedDb, targetSchemaVersion);
    const existingAlbumCount =
      targetSchemaVersion >= 68 ? albumRetentionDefaults(expected) : null;
    const bootstrapAlbumCount =
      targetSchemaVersion === 69 ? inheritedStateBootstrap(expected) : null;
    verifyInheritedShare0069Schema(
      expected,
      migrationChain.at(-1).sql,
      targetSchemaVersion,
    );
    assert.deepEqual(expected.prepare('PRAGMA foreign_key_check').all(), []);
    const restoreConfig = join(dir, 'restore.json');
    let id;
    if (resume) {
      const target = JSON.parse(
        await readFile(join(dir, 'target.json'), 'utf8'),
      );
      assert.equal(target.accountId, account);
      assert.notEqual(target.databaseId, source);
      assert.match(target.databaseId, /^[a-f0-9-]{36}$/);
      assert.deepEqual(
        JSON.parse(await readFile(restoreConfig, 'utf8')),
        cfg(target.databaseId, target.name),
      );
      assert.deepEqual(
        JSON.parse(await readFile(config, 'utf8')),
        cfg(source, 'kino-pick-staging-d3e93046'),
      );
      const failed = JSON.parse(await readFile(positionalArgs[1], 'utf8'));
      assert.deepEqual(
        failed.commands.map((c) => c.label),
        [
          `backup-source${sourceSchemaVersion}`,
          `create-independent${targetSchemaVersion}-drill`,
          `restore-empty-independent${sourceSchemaVersion}`,
          `verify-independent${sourceSchemaVersion}`,
          ...(targetSchemaVersion === 69
            ? ['read-independent69-clock-before']
            : []),
          `upgrade-independent${targetSchemaVersion}`,
          ...(targetSchemaVersion === 69
            ? ['read-independent69-clock-after']
            : []),
          `verify-independent${targetSchemaVersion}`,
        ],
      );
      assert.ok(failed.commands.every((c) => c.exitCode === 0));
      commands.push(...failed.commands);
      id = target.databaseId;
    } else {
      let name =
        `kino-pick-restore${targetSchemaVersion}-` + randomUUID().slice(0, 8);
      const output = cli(
        ['d1', 'create', name, '--config', config],
        `create-independent${targetSchemaVersion}-drill`,
      );
      id = /"database_id"\s*:\s*"([a-f0-9-]{36})"/.exec(output)?.[1];
      assert.ok(id && id !== source, 'Independent database ID required');
      await json(restoreConfig, cfg(id, name));
      await json(join(dir, 'target.json'), {
        accountId: account,
        databaseId: id,
        name,
      });
      await writeFile(join(dir, normalizedFile), before.sql);
      cli(
        [
          'd1',
          'execute',
          'DB',
          '--remote',
          '--config',
          restoreConfig,
          '--file',
          join(dir, normalizedFile),
        ],
        `restore-empty-independent${sourceSchemaVersion}`,
      );
    }
    const restored = resume
      ? await load(join(dir, restoredFile))
      : await exportDb(
          id,
          restoredFile,
          restoreConfig,
          `verify-independent${sourceSchemaVersion}`,
        );
    assert.deepEqual(restored.snapshot, before.snapshot);
    assert.deepEqual(schema(restored.db), schema(before.db));
    const independentSamples =
      targetSchemaVersion === 69
        ? resume
          ? JSON.parse(await readFile(clocksFile, 'utf8')).independent
          : {}
        : null;
    if (!resume) {
      if (independentSamples) {
        independentSamples.beforeMs = readDatabaseClock(
          restoreConfig,
          'read-independent69-clock-before',
        );
        await json(clocksFile, { independent: independentSamples });
      }
      cli(
        [
          'd1',
          'migrations',
          'apply',
          'DB',
          '--remote',
          '--config',
          restoreConfig,
        ],
        `upgrade-independent${targetSchemaVersion}`,
      );
      if (independentSamples) {
        independentSamples.afterMs = readDatabaseClock(
          restoreConfig,
          'read-independent69-clock-after',
        );
        await json(clocksFile, { independent: independentSamples });
      }
    }
    const upgraded = resume
      ? await load(join(dir, upgradedFile))
      : await exportDb(
          id,
          upgradedFile,
          restoreConfig,
          `verify-independent${targetSchemaVersion}`,
        );
    assert.deepEqual(schema(upgraded.db), schema(expected));
    const upgradedLegacyProof = checkOld(before, upgraded, targetSchemaVersion);
    if (targetSchemaVersion === 69) {
      upgraded.clockWindow = migrationClockWindow(
        upgraded.db,
        independentSamples.beforeMs,
        independentSamples.afterMs,
      );
      assert.deepEqual(upgradedLegacyProof, legacyProof);
      checkMigratedRows(expectedDb, upgraded);
      verifyInheritedShare0069Schema(
        upgraded.db,
        migrationChain.at(-1).sql,
        targetSchemaVersion,
      );
      assert.equal(
        albumRetentionDefaults(upgraded.db),
        existingAlbumCount,
        'Independent restore must preserve all default retention policies',
      );
      assert.equal(
        inheritedStateBootstrap(upgraded.db),
        bootstrapAlbumCount,
        'Independent restore must preserve all inherited expiry bootstrap rows',
      );
    } else if (targetSchemaVersion === 68)
      assert.equal(
        albumRetentionDefaults(upgraded.db),
        existingAlbumCount,
        'Independent restore must backfill every prior album with defaults',
      );
    const ledger = upgraded.db
      .prepare('SELECT id,name FROM d1_migrations ORDER BY id')
      .all();
    assert.equal(ledger.length, targetSchemaVersion);
    assert.equal(ledger[targetSchemaVersion - 1].name, migrationName);
    if (targetSchemaVersion === 69) {
      verifyFinalLedger69(before.db, upgraded.db, migrationChain);
    }
    assert.deepEqual(
      ledger.slice(0, sourceSchemaVersion),
      before.db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
    );
    await json(join(dir, 'restore-proof.json'), {
      status: restoreStatus,
      accountId: account,
      sourceDatabaseId: source,
      restoreDatabaseId: id,
      sourceSchemaVersion,
      targetSchemaVersion,
      sourceWritesDuringRestore: 0,
      backupSha256: before.sha256,
      restoredSha256: restored.sha256,
      upgradedSha256: upgraded.sha256,
      migration,
      oldTablesPreserved: true,
      exactSchemaAndRowsMatchSource: true,
      foreignKeyViolations: 0,
      commandsAllSucceeded: true,
      ...(targetSchemaVersion === 68
        ? { policyDefaultsVerified: true, existingAlbumCount }
        : {}),
      ...(targetSchemaVersion === 69
        ? {
            migrations: migrationProofs,
            migrationTransactionScope: 'per_migration',
            ...legacyProof,
            policyDefaultsVerified: true,
            existingAlbumCount,
            inheritedStateBootstrapVerified: true,
            bootstrapTimeComparison: {
              mode: 'per_database_chain_window',
              columns: bootstrapTimeColumns,
              independent: upgraded.clockWindow,
            },
          }
        : {}),
      commands,
    });
    await json(statePath, {
      directory: dir,
      restoreDatabaseId: id,
      sourceDatabaseId: source,
    });
    console.log(
      JSON.stringify({
        status: restoreStatus,
        restoreDatabaseId: id,
        oldTables: before.snapshot.tableCount,
        oldRows: before.snapshot.totalRows,
        commands: commands.length,
      }),
    );
  } else {
    const proof = JSON.parse(
      await readFile(join(dir, 'restore-proof.json'), 'utf8'),
    );
    assert.equal(proof.status, restoreStatus);
    assert.equal(proof.accountId, account);
    assert.equal(proof.sourceDatabaseId, source);
    assert.equal(proof.sourceSchemaVersion, sourceSchemaVersion);
    assert.equal(proof.targetSchemaVersion, targetSchemaVersion);
    assert.notEqual(proof.restoreDatabaseId, source);
    assert.deepEqual(
      JSON.parse(await readFile(config, 'utf8')),
      cfg(source, 'kino-pick-staging-d3e93046'),
    );
    assert.deepEqual(proof.migration, migration);
    let originalClockSamples;
    if (targetSchemaVersion === 69) {
      assertRestoreIdentity69(
        proof,
        JSON.parse(await readFile(statePath, 'utf8')),
        JSON.parse(await readFile(join(dir, 'target.json'), 'utf8')),
        JSON.parse(await readFile(join(dir, 'restore.json'), 'utf8')),
        dir,
      );
      originalClockSamples = JSON.parse(await readFile(clocksFile, 'utf8'));
      assert.deepEqual(proof.migrations, migrationProofs);
      assert.equal(proof.migrationTransactionScope, 'per_migration');
      assert.equal(proof.legacyInviteColumnsPreserved, true);
      assert.equal(proof.legacyScopeColumnsPreserved, true);
      assert.equal(proof.legacyInviteModesVerified, true);
      assert.equal(proof.legacyScopeGenerationsVerified, true);
      assert.equal(proof.inheritedStateBootstrapVerified, true);
      assert.equal(proof.policyDefaultsVerified, true);
      assert.equal(proof.sourceWritesDuringRestore, 0);
      assert.equal(proof.foreignKeyViolations, 0);
      assert.equal(proof.exactIndependentDrillParity, undefined);
      for (const field of [
        'oldTablesPreserved',
        'exactSchemaAndRowsMatchSource',
        'commandsAllSucceeded',
      ])
        assert.equal(proof[field], true);
      assert.equal(
        proof.bootstrapTimeComparison?.mode,
        'per_database_chain_window',
      );
      assert.deepEqual(
        proof.bootstrapTimeComparison.columns,
        bootstrapTimeColumns,
      );
      assert.deepEqual(originalClockSamples.independent, {
        beforeMs: proof.bootstrapTimeComparison.independent.beforeMs,
        afterMs: proof.bootstrapTimeComparison.independent.afterMs,
      });
      assert.deepEqual(
        proof.commands.map(({ label, exitCode }) => [label, exitCode]),
        [
          'backup-source67',
          'create-independent69-drill',
          'restore-empty-independent67',
          'verify-independent67',
          'read-independent69-clock-before',
          'upgrade-independent69',
          'read-independent69-clock-after',
          'verify-independent69',
        ].map((label) => [label, 0]),
      );
      for (const field of ['legacyInviteCount', 'legacyInviteAlbumCount'])
        assert.ok(Number.isSafeInteger(proof[field]) && proof[field] >= 0);
    }
    const before = await load(join(dir, beforeFile));
    assert.equal(before.sha256, proof.backupSha256);
    if (targetSchemaVersion === 69) {
      const restored = await load(join(dir, restoredFile));
      assert.equal(restored.sha256, proof.restoredSha256);
      assert.deepEqual(restored.snapshot, before.snapshot);
      assert.deepEqual(schema(restored.db), schema(before.db));
      restored.db.close();
    }
    assert.equal(
      before.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,
      sourceSchemaVersion,
    );
    assertNextMigrationSequence(before.db);
    const expectedDb = expectedUpgrade(
      before,
      migrationChain,
      targetSchemaVersion,
    );
    const expected = expectedDb.db;
    const expectedLegacyProof = checkOld(
      before,
      expectedDb,
      targetSchemaVersion,
    );
    verifyInheritedShare0069Schema(
      expected,
      migrationChain.at(-1).sql,
      targetSchemaVersion,
    );
    const drill = await load(join(dir, upgradedFile));
    assert.equal(drill.sha256, proof.upgradedSha256);
    assert.equal(
      drill.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,
      targetSchemaVersion,
    );
    assert.equal(
      drill.db
        .prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
        .get().name,
      migrationName,
    );
    verifyInheritedShare0069Schema(
      drill.db,
      migrationChain.at(-1).sql,
      targetSchemaVersion,
    );
    assert.deepEqual(schema(drill.db), schema(expected));
    if (targetSchemaVersion >= 68)
      assert.equal(
        albumRetentionDefaults(drill.db),
        proof.existingAlbumCount,
        'Independent drill must preserve all default retention policies',
      );
    if (targetSchemaVersion === 69) {
      const samples = proof.bootstrapTimeComparison.independent;
      drill.clockWindow = migrationClockWindow(
        drill.db,
        samples.beforeMs,
        samples.afterMs,
      );
      assert.deepEqual(drill.clockWindow, samples);
      verifyFinalLedger69(before.db, drill.db, migrationChain);
      assert.deepEqual(
        expectedLegacyProof,
        Object.fromEntries(
          [
            'legacyInviteColumnsPreserved',
            'legacyScopeColumnsPreserved',
            'legacyInviteModesVerified',
            'legacyScopeGenerationsVerified',
            'legacyInviteCount',
            'legacyInviteAlbumCount',
          ].map((key) => [key, proof[key]]),
        ),
      );
      assert.deepEqual(
        checkOld(before, drill, targetSchemaVersion),
        Object.fromEntries(
          [
            'legacyInviteColumnsPreserved',
            'legacyScopeColumnsPreserved',
            'legacyInviteModesVerified',
            'legacyScopeGenerationsVerified',
            'legacyInviteCount',
            'legacyInviteAlbumCount',
          ].map((key) => [key, proof[key]]),
        ),
      );
      assert.equal(
        inheritedStateBootstrap(drill.db),
        proof.existingAlbumCount,
        'Independent drill must preserve inherited expiry bootstrap rows',
      );
      checkMigratedRows(expectedDb, drill);
    }
    const fresh = await exportDb(
      source,
      'fresh-before-adopt.sql',
      config,
      'fresh-source-parity',
    );
    assert.deepEqual(
      fresh.snapshot,
      before.snapshot,
      'Source changed; take and rehearse a fresh backup',
    );
    assert.deepEqual(schema(fresh.db), schema(before.db));
    assert.equal(
      fresh.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,
      sourceSchemaVersion,
    );
    assertNextMigrationSequence(fresh.db);
    let sourceSamples;
    if (targetSchemaVersion === 69) {
      sourceSamples = {
        beforeMs: readDatabaseClock(config, 'read-source69-clock-before'),
      };
      await json(clocksFile, {
        ...originalClockSamples,
        source: sourceSamples,
      });
    }
    cli(
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config],
      profile.adoptionLabel,
    );
    if (sourceSamples) {
      sourceSamples.afterMs = readDatabaseClock(
        config,
        'read-source69-clock-after',
      );
      await json(clocksFile, {
        ...originalClockSamples,
        source: sourceSamples,
      });
    }
    const after = await exportDb(
      source,
      `source-after${targetSchemaVersion}.sql`,
      config,
      `verify-source${targetSchemaVersion}`,
    );
    assert.deepEqual(schema(after.db), schema(drill.db));
    const adoptedLegacyProof = checkOld(before, after, targetSchemaVersion);
    if (targetSchemaVersion === 69) {
      after.clockWindow = migrationClockWindow(
        after.db,
        sourceSamples.beforeMs,
        sourceSamples.afterMs,
      );
      verifyFinalLedger69(before.db, after.db, migrationChain);
      assert.deepEqual(
        adoptedLegacyProof,
        Object.fromEntries(
          [
            'legacyInviteColumnsPreserved',
            'legacyScopeColumnsPreserved',
            'legacyInviteModesVerified',
            'legacyScopeGenerationsVerified',
            'legacyInviteCount',
            'legacyInviteAlbumCount',
          ].map((key) => [key, proof[key]]),
        ),
      );
      checkMigratedRows(drill, after);
      verifyInheritedShare0069Schema(
        after.db,
        migrationChain.at(-1).sql,
        targetSchemaVersion,
      );
      assert.equal(
        albumRetentionDefaults(after.db),
        proof.existingAlbumCount,
        'Adopted source must preserve all default retention policies',
      );
      assert.equal(
        inheritedStateBootstrap(after.db),
        proof.existingAlbumCount,
        'Adopted source must match inherited expiry bootstrap state',
      );
    } else if (targetSchemaVersion === 68)
      assert.equal(
        albumRetentionDefaults(after.db),
        proof.existingAlbumCount,
        'Adopted source must match the independent policy defaults',
      );
    assert.deepEqual(
      after.db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
      drill.db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
    );
    const final = {
      ...proof,
      status: adoptionStatus,
      sourceAfterSha256: after.sha256,
      ...(targetSchemaVersion === 69
        ? {
            independentDrillParityVerified: true,
            bootstrapTimeComparison: {
              mode: 'per_database_chain_window',
              columns: bootstrapTimeColumns,
              independent: drill.clockWindow,
              source: after.clockWindow,
            },
          }
        : { exactIndependentDrillParity: true }),
      commands: [...proof.commands, ...commands],
    };
    if (targetSchemaVersion === 69)
      validateInheritedShare0069RestoreManifest(final, migrationProofs);
    await json(join(dir, 'adoption-proof.json'), final);
    await json(resolve(profile.manifestPath), final);
    console.log(
      JSON.stringify({
        status: final.status,
        commands: final.commands.length,
        foreignKeyViolations: 0,
      }),
    );
  }
} catch (error) {
  await json(join(dir, 'failed-' + Date.now() + '.json'), {
    status: 'failed',
    reason: error instanceof Error ? error.message : 'unknown',
    commands,
  });
  console.error(error instanceof Error ? error.message : 'RESTORE_FAILED');
  process.exitCode = 1;
}
