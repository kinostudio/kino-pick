import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backupDirectory = join(
  workerDirectory,
  '.local',
  'hosted-100-backup-20261031',
);
const accountId = 'd3e930465c0df7e89b35de3ca65ea36a';
const sourceDatabaseId = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const restoreDatabaseName = 'kino-pick-restore100-20261031';
const workspaceId = 'bd927a6d-d5d3-4743-bbae-e4560cdda4c7';
const projectId = ['08954949', 'ae90', '4353', 'be2f', 'ae4a8f40b78d'].join(
  '-',
);
const albumId = '613487da-e6ff-4ada-9b66-949f21fcfa2c';
const backupSqlPath = join(backupDirectory, 'database.sql');
const backupProofPath = join(backupDirectory, 'backup-proof.json');
const restoreTargetPath = join(backupDirectory, 'restore-target.json');
const wranglerConfigPath = join(backupDirectory, 'restore-wrangler.json');
const normalizedBackupPath = join(backupDirectory, 'restore-normalized.sql');
const wranglerPath = join(
  workerDirectory,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const expectedStatementCounts = {
  PRAGMA: 1,
  'CREATE TABLE': 136,
  'INSERT INTO': 2784,
  'DELETE FROM sqlite_sequence': 1,
  'CREATE INDEX': 134,
  'CREATE UNIQUE INDEX': 18,
  'CREATE VIEW': 7,
  'CREATE TRIGGER': 726,
};

class SafeFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new SafeFailure(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonical(value) {
  if (value instanceof ArrayBuffer) {
    return { blob: Buffer.from(value).toString('base64') };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      blob: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString('base64'),
    };
  }
  if (typeof value === 'bigint') return { integer: value.toString() };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalHash(rows) {
  const serialized = rows
    .map((row) => JSON.stringify(canonical(row)))
    .sort(compareText);
  return {
    count: rows.length,
    sha256: sha256(Buffer.from(serialized.join('\n'))),
  };
}

function sqlIdentifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

function stripLeadingComments(statement) {
  return statement
    .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
    .trim();
}

function terminateStatement(statement) {
  const trimmed = statement.trim();
  return /;\s*$/.test(trimmed) ? trimmed : trimmed + ';';
}

export function splitAndClassifyHostedBackupSql(
  source,
  profileCounts = expectedStatementCounts,
) {
  requireCondition(typeof source === 'string', 'BACKUP_SQL_NOT_TEXT');
  let statements;
  try {
    statements = unstable_splitSqlQuery(source);
  } catch {
    fail('BACKUP_SQL_SPLIT_FAILED');
  }
  requireCondition(Array.isArray(statements), 'BACKUP_SQL_SPLIT_FAILED');

  const groups = {
    pragmas: [],
    tables: [],
    data: [],
    indexes: [],
    uniqueIndexes: [],
    views: [],
    triggers: [],
  };
  const statementCounts = {};

  for (const value of statements) {
    const statement = String(value).trim();
    if (!statement) continue;
    const head = stripLeadingComments(statement);

    if (/^PRAGMA\b/i.test(head)) {
      requireCondition(
        /^PRAGMA\s+(?:foreign_keys\s*=\s*(?:0|OFF)|defer_foreign_keys\s*=\s*(?:1|ON|TRUE))\s*;?$/i.test(
          head,
        ),
        'BACKUP_SQL_UNEXPECTED_PRAGMA',
      );
      groups.pragmas.push('PRAGMA defer_foreign_keys=TRUE;');
      statementCounts.PRAGMA = (statementCounts.PRAGMA ?? 0) + 1;
    } else if (/^CREATE\s+TABLE\b/i.test(head)) {
      groups.tables.push(terminateStatement(statement));
      statementCounts['CREATE TABLE'] =
        (statementCounts['CREATE TABLE'] ?? 0) + 1;
    } else if (/^INSERT\s+INTO\b/i.test(head)) {
      groups.data.push(terminateStatement(statement));
      statementCounts['INSERT INTO'] =
        (statementCounts['INSERT INTO'] ?? 0) + 1;
    } else if (
      /^DELETE\s+FROM\s+(?:"sqlite_sequence"|\[sqlite_sequence\]|sqlite_sequence)\s*;?$/i.test(
        head,
      )
    ) {
      groups.data.push(terminateStatement(statement));
      statementCounts['DELETE FROM sqlite_sequence'] =
        (statementCounts['DELETE FROM sqlite_sequence'] ?? 0) + 1;
    } else if (/^CREATE\s+UNIQUE\s+INDEX\b/i.test(head)) {
      groups.uniqueIndexes.push(terminateStatement(statement));
      statementCounts['CREATE UNIQUE INDEX'] =
        (statementCounts['CREATE UNIQUE INDEX'] ?? 0) + 1;
    } else if (/^CREATE\s+INDEX\b/i.test(head)) {
      groups.indexes.push(terminateStatement(statement));
      statementCounts['CREATE INDEX'] =
        (statementCounts['CREATE INDEX'] ?? 0) + 1;
    } else if (/^CREATE\s+VIEW\b/i.test(head)) {
      groups.views.push(terminateStatement(statement));
      statementCounts['CREATE VIEW'] =
        (statementCounts['CREATE VIEW'] ?? 0) + 1;
    } else if (/^CREATE\s+TRIGGER\b/i.test(head)) {
      groups.triggers.push(terminateStatement(statement));
      statementCounts['CREATE TRIGGER'] =
        (statementCounts['CREATE TRIGGER'] ?? 0) + 1;
    } else {
      fail('BACKUP_SQL_UNEXPECTED_STATEMENT');
    }
  }

  const types = Object.keys(profileCounts).sort(compareText);
  const actualCounts = Object.fromEntries(
    types.map((type) => [type, statementCounts[type] ?? 0]),
  );
  const expectedCounts = Object.fromEntries(
    types.map((type) => [type, profileCounts[type]]),
  );
  requireCondition(
    JSON.stringify(actualCounts) === JSON.stringify(expectedCounts),
    'BACKUP_SQL_STATEMENT_COUNTS_MISMATCH',
  );

  const normalizedSql = [
    ...groups.pragmas,
    ...groups.tables,
    ...groups.indexes,
    ...groups.uniqueIndexes,
    ...groups.data,
    ...groups.views,
    ...groups.triggers,
    'PRAGMA foreign_key_check;',
    '',
  ].join('\n');

  return {
    normalizedSql,
    statementCounts: actualCounts,
    statementCount: statements.length,
  };
}

/**
 * Reorders the fixed, trusted Wrangler D1 export so all tables are created
 * before data, indexes, views, and every trigger. It uses Wrangler's splitter,
 * replaces foreign_keys=OFF with D1-compatible deferred checks, and rejects
 * any statement types outside the reviewed backup shape.
 */
export function normalizeHostedBackupSql(source) {
  return splitAndClassifyHostedBackupSql(source).normalizedSql;
}

/** Only the reviewed empty-ledger 0057 upgrade of this fixed 100-photo snapshot. */
export function normalizeEmptyActivation57BackupSql(source) {
  return splitAndClassifyHostedBackupSql(source, {
    ...expectedStatementCounts,
    'CREATE TABLE': expectedStatementCounts['CREATE TABLE'] + 1,
    'INSERT INTO': expectedStatementCounts['INSERT INTO'] + 1,
    'CREATE TRIGGER': expectedStatementCounts['CREATE TRIGGER'] + 27,
  }).normalizedSql;
}

async function readProtectedFile(path, code) {
  try {
    return await readFile(path);
  } catch {
    fail(code);
  }
}

async function readProtectedJson(path, code) {
  const bytes = await readProtectedFile(path, code);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(code);
  }
}

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path, value, code, flag = undefined) {
  try {
    await writeFile(
      path,
      JSON.stringify(value, null, 2) + '\n',
      flag ? { encoding: 'utf8', flag } : 'utf8',
    );
  } catch {
    fail(code);
  }
}

async function writeOrVerifyText(path, text, code) {
  const expectedBytes = Buffer.from(text, 'utf8');
  if (await fileExists(path)) {
    const existing = await readProtectedFile(path, code);
    requireCondition(
      sha256(existing) === sha256(expectedBytes),
      'PROTECTED_OUTPUT_COLLISION',
    );
    return sha256(existing);
  }
  try {
    await writeFile(path, expectedBytes, { flag: 'wx' });
  } catch {
    fail(code);
  }
  return sha256(expectedBytes);
}

function openDatabaseFromNormalizedSql(sql) {
  let db;
  try {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON;');
    db.exec('BEGIN;');
    db.exec(sql);
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    requireCondition(
      foreignKeys.length === 0,
      'LOCAL_FOREIGN_KEY_CHECK_FAILED',
    );
    db.exec('COMMIT;');
    return db;
  } catch (error) {
    try {
      db?.exec('ROLLBACK;');
    } catch {
      // Preserve only a safe error code.
    }
    try {
      db?.close();
    } catch {
      // Preserve only a safe error code.
    }
    if (error instanceof SafeFailure) throw error;
    fail('LOCAL_SQLITE_LOAD_FAILED');
  }
}

export function snapshotDatabase(db) {
  let tableNames;
  let schemaRows;
  try {
    tableNames = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    schemaRows = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all();
  } catch {
    fail('LOCAL_SQLITE_SCHEMA_READ_FAILED');
  }

  const tableHashes = {};
  let totalRows = 0;
  for (const table of tableNames) {
    let rows;
    try {
      rows = db.prepare('SELECT * FROM ' + sqlIdentifier(table)).all();
    } catch {
      fail('LOCAL_SQLITE_TABLE_READ_FAILED');
    }
    const hash = canonicalHash(rows);
    tableHashes[table] = hash;
    totalRows += hash.count;
  }

  let sequenceRows = [];
  try {
    const sequenceExists = Number(
      db
        .prepare(
          "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'",
        )
        .get().n,
    );
    if (sequenceExists > 0) {
      sequenceRows = db
        .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
        .all();
    }
  } catch {
    fail('LOCAL_SQLITE_SEQUENCE_READ_FAILED');
  }

  const foreignKeyDefinitions = [];
  for (const table of tableNames) {
    try {
      const rows = db
        .prepare('PRAGMA foreign_key_list(' + sqlIdentifier(table) + ')')
        .all();
      foreignKeyDefinitions.push(...rows.map((row) => ({ table, ...row })));
    } catch {
      fail('LOCAL_SQLITE_FOREIGN_KEY_SCHEMA_READ_FAILED');
    }
  }

  return {
    tableCount: tableNames.length,
    totalRows,
    tableHashes,
    schemaSha256: canonicalHash(schemaRows).sha256,
    foreignKeySchemaSha256: canonicalHash(foreignKeyDefinitions).sha256,
    sqliteSequence: {
      count: sequenceRows.length,
      sha256: canonicalHash(sequenceRows).sha256,
    },
  };
}

function scopedCounts(db) {
  try {
    const ledger = Number(
      db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n,
    );
    const photos = Number(
      db
        .prepare(
          'SELECT count(*) AS n FROM photos WHERE workspace_id=? AND project_id=? AND album_id=?',
        )
        .get(workspaceId, projectId, albumId).n,
    );
    const assets = Number(
      db
        .prepare(
          'SELECT count(*) AS n FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE p.workspace_id=? AND p.project_id=? AND p.album_id=?',
        )
        .get(workspaceId, projectId, albumId).n,
    );
    const assetKinds = db
      .prepare(
        'SELECT a.asset_kind AS kind,count(*) AS n FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE p.workspace_id=? AND p.project_id=? AND p.album_id=? GROUP BY a.asset_kind ORDER BY a.asset_kind',
      )
      .all(workspaceId, projectId, albumId)
      .map((row) => ({ kind: row.kind, count: Number(row.n) }));

    return { ledger, photos, assets, assetKinds };
  } catch {
    fail('LOCAL_SCOPE_COUNTS_FAILED');
  }
}

function verifyScopedCounts(counts) {
  const kinds = Object.fromEntries(
    counts.assetKinds.map((entry) => [entry.kind, entry.count]),
  );
  requireCondition(
    counts.ledger === 56 &&
      counts.photos === 100 &&
      counts.assets === 300 &&
      kinds.original === 100 &&
      kinds.thumbnail === 100 &&
      kinds.preview === 100 &&
      Object.keys(kinds).length === 3,
    'SCOPED_COUNTS_MISMATCH',
  );
}

function makeWranglerConfig(databaseId = undefined) {
  const config = {
    name: restoreDatabaseName,
    compatibility_date: '2026-10-31',
    account_id: accountId,
    d1_databases: [],
  };
  if (databaseId) {
    config.d1_databases.push({
      binding: 'RESTORE_DB',
      database_name: restoreDatabaseName,
      database_id: databaseId,
    });
  }
  return JSON.stringify(config, null, 2) + '\n';
}

async function writeWranglerConfig(databaseId = undefined) {
  try {
    await writeFile(wranglerConfigPath, makeWranglerConfig(databaseId), 'utf8');
  } catch {
    fail('WRANGLER_CONFIG_WRITE_FAILED');
  }
}

function parseDatabaseList(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    fail('WRANGLER_DATABASE_LIST_INVALID');
  }

  const databases = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const id =
      typeof value.uuid === 'string'
        ? value.uuid
        : typeof value.database_id === 'string'
          ? value.database_id
          : null;
    const name =
      typeof value.name === 'string'
        ? value.name
        : typeof value.database_name === 'string'
          ? value.database_name
          : null;
    if (id && name) {
      databases.push({ id: id.toLowerCase(), name });
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(parsed);
  requireCondition(
    databases.every((entry) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        entry.id,
      ),
    ),
    'WRANGLER_DATABASE_LIST_INVALID',
  );
  return databases;
}

function parseCreatedDatabaseId(stdout) {
  const matches = [
    ...stdout.matchAll(
      /["']?(?:database_id|databaseId|uuid)["']?\s*[:=]\s*["']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})["']?/gi,
    ),
  ];
  const ids = [...new Set(matches.map((match) => match[1].toLowerCase()))];
  requireCondition(ids.length === 1, 'WRANGLER_CREATE_ID_UNPARSEABLE');
  return ids[0];
}

async function runWrangler(args, phase) {
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      execFile(
        process.execPath,
        [wranglerPath, ...args, '--config', wranglerConfigPath],
        {
          cwd: workerDirectory,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          timeout: 10 * 60 * 1000,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          // Keep complete output in memory only; Wrangler export output may
          // contain a signed download URL.
          resolvePromise({ stdout, stderr });
        },
      );
    });
  } catch {
    fail('WRANGLER_' + phase.toUpperCase() + '_FAILED');
  }
}

async function listDatabases() {
  const result = await runWrangler(['d1', 'list', '--json'], 'list');
  return parseDatabaseList(result.stdout);
}

function collectResultArrays(value, found = []) {
  if (Array.isArray(value)) {
    for (const child of value) collectResultArrays(child, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value.results)) found.push(value.results);
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'results') collectResultArrays(child, found);
  }
  return found;
}

function parseJson(stdout, code) {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    fail(code);
  }
}

function singleResultRow(payload, code) {
  const arrays = collectResultArrays(payload);
  requireCondition(arrays.length === 1 && arrays[0].length === 1, code);
  return arrays[0][0];
}

function readNumberField(row, field, code) {
  const value = row?.[field];
  const parsed = typeof value === 'number' ? value : Number(value);
  requireCondition(Number.isSafeInteger(parsed) && parsed >= 0, code);
  return parsed;
}

async function executeJson(command, phase) {
  const result = await runWrangler(
    [
      'd1',
      'execute',
      restoreDatabaseName,
      '--remote',
      '--command',
      command,
      '--json',
    ],
    phase,
  );
  return parseJson(
    result.stdout,
    'WRANGLER_' + phase.toUpperCase() + '_JSON_INVALID',
  );
}

function verifyRestoredTargetIdentity(databases, targetState) {
  const named = databases.filter((entry) => entry.name === restoreDatabaseName);
  requireCondition(named.length === 1, 'RESTORE_TARGET_NOT_UNIQUE');
  requireCondition(
    named[0].id === targetState.databaseId &&
      named[0].id !== sourceDatabaseId &&
      databases.filter((entry) => entry.id === named[0].id).length === 1,
    'RESTORE_TARGET_ID_MISMATCH',
  );
}

async function getOrCreateRestoreTarget() {
  let state = null;
  if (await fileExists(restoreTargetPath)) {
    state = await readProtectedJson(
      restoreTargetPath,
      'RESTORE_TARGET_STATE_INVALID',
    );
    requireCondition(
      state &&
        state.accountId === accountId &&
        state.databaseName === restoreDatabaseName &&
        state.createdByThisDrill === true &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          state.databaseId ?? '',
        ),
      'RESTORE_TARGET_STATE_INVALID',
    );
  }

  await writeWranglerConfig();
  const before = await listDatabases();
  if (!state) {
    requireCondition(
      !before.some((entry) => entry.name === restoreDatabaseName),
      'RESTORE_TARGET_NAME_ALREADY_EXISTS',
    );
    const created = await runWrangler(
      ['d1', 'create', restoreDatabaseName, '--update-config=false'],
      'create',
    );
    const databaseId = parseCreatedDatabaseId(created.stdout);
    requireCondition(
      databaseId !== sourceDatabaseId &&
        !before.some((entry) => entry.id === databaseId),
      'RESTORE_TARGET_ID_NOT_NEW',
    );
    state = {
      accountId,
      databaseId,
      databaseName: restoreDatabaseName,
      createdByThisDrill: true,
      createdAt: new Date().toISOString(),
    };
    try {
      await writeFile(
        restoreTargetPath,
        JSON.stringify(state, null, 2) + '\n',
        { flag: 'wx' },
      );
    } catch {
      fail('RESTORE_TARGET_STATE_WRITE_FAILED');
    }
  }

  const after = await listDatabases();
  verifyRestoredTargetIdentity(after, state);
  await writeWranglerConfig(state.databaseId);
  return state;
}

async function verifyRemoteTargetEmpty() {
  const result = await executeJson(
    "SELECT count(*) AS n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
    'empty_check',
  );
  const count = readNumberField(
    singleResultRow(result, 'RESTORE_TARGET_EMPTY_CHECK_FAILED'),
    'n',
    'RESTORE_TARGET_EMPTY_CHECK_FAILED',
  );
  requireCondition(count === 0, 'RESTORE_TARGET_NOT_EMPTY');
}

async function verifyRemoteRestoredCounts() {
  const query =
    'SELECT ' +
    '(SELECT count(*) FROM d1_migrations) AS ledger, ' +
    '(SELECT count(*) FROM photos WHERE workspace_id=' +
    "'" +
    workspaceId +
    "'" +
    ' AND project_id=' +
    "'" +
    projectId +
    "'" +
    ' AND album_id=' +
    "'" +
    albumId +
    "'" +
    ') AS photos, ' +
    '(SELECT count(*) FROM photo_assets a JOIN photos p ON p.id=a.photo_id WHERE p.workspace_id=' +
    "'" +
    workspaceId +
    "'" +
    ' AND p.project_id=' +
    "'" +
    projectId +
    "'" +
    ' AND p.album_id=' +
    "'" +
    albumId +
    "'" +
    ') AS assets';
  const result = await executeJson(query, 'restored_counts');
  const row = singleResultRow(result, 'RESTORED_COUNTS_INVALID');
  requireCondition(
    readNumberField(row, 'ledger', 'RESTORED_COUNTS_INVALID') === 56 &&
      readNumberField(row, 'photos', 'RESTORED_COUNTS_INVALID') === 100 &&
      readNumberField(row, 'assets', 'RESTORED_COUNTS_INVALID') === 300,
    'RESTORED_COUNTS_MISMATCH',
  );

  const foreignKeys = await executeJson(
    'PRAGMA foreign_key_check',
    'foreign_key_check',
  );
  const arrays = collectResultArrays(foreignKeys);
  requireCondition(
    arrays.length === 1 && arrays[0].length === 0,
    'REMOTE_FOREIGN_KEY_CHECK_FAILED',
  );
}

function timestampToken() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

async function exportRestoredDatabase() {
  const token = timestampToken();
  const exportedSqlPath = join(
    backupDirectory,
    'restore-export-' + token + '.sql',
  );
  requireCondition(
    !(await fileExists(exportedSqlPath)),
    'RESTORE_EXPORT_PATH_EXISTS',
  );
  await runWrangler(
    [
      'd1',
      'export',
      restoreDatabaseName,
      '--remote',
      '--skip-confirmation',
      '--output',
      exportedSqlPath,
    ],
    'export',
  );

  const exportedBytes = await readProtectedFile(
    exportedSqlPath,
    'RESTORE_EXPORT_MISSING',
  );
  let exportedSql;
  try {
    exportedSql = exportedBytes.toString('utf8');
    requireCondition(
      Buffer.from(exportedSql, 'utf8').equals(exportedBytes),
      'RESTORE_EXPORT_NOT_UTF8',
    );
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    fail('RESTORE_EXPORT_NOT_UTF8');
  }

  const normalized = splitAndClassifyHostedBackupSql(exportedSql);
  const normalizedExportPath = join(
    backupDirectory,
    'restore-export-normalized-' + token + '.sql',
  );
  const normalizedExportSha256 = await writeOrVerifyText(
    normalizedExportPath,
    normalized.normalizedSql,
    'RESTORE_NORMALIZED_EXPORT_WRITE_FAILED',
  );
  const db = openDatabaseFromNormalizedSql(normalized.normalizedSql);
  try {
    const snapshot = snapshotDatabase(db);
    const counts = scopedCounts(db);
    verifyScopedCounts(counts);
    return {
      exportedSqlPath,
      exportedSqlSha256: sha256(exportedBytes),
      exportedSqlBytes: exportedBytes.byteLength,
      normalizedExportSha256,
      statementCounts: normalized.statementCounts,
      statementCount: normalized.statementCount,
      snapshot,
      counts,
      db,
    };
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve only a safe error code.
    }
    if (error instanceof SafeFailure) throw error;
    fail('RESTORED_EXPORT_SQLITE_VALIDATION_FAILED');
  }
}

async function loadAndVerifyLocalBackup() {
  const [rawSqlBytes, proof] = await Promise.all([
    readProtectedFile(backupSqlPath, 'BACKUP_SQL_READ_FAILED'),
    readProtectedJson(backupProofPath, 'BACKUP_PROOF_READ_FAILED'),
  ]);
  requireCondition(
    proof &&
      proof.status === 'exported_not_restored' &&
      proof.databaseId === sourceDatabaseId &&
      proof.sha256 === sha256(rawSqlBytes) &&
      proof.bytes === rawSqlBytes.byteLength &&
      proof.aclProtected === true &&
      proof.containsSensitiveAuthData === true &&
      proof.r2ObjectsBackedUp === false &&
      proof.restoreVerified === false,
    'BACKUP_PROOF_MISMATCH',
  );

  let sourceSql;
  try {
    sourceSql = rawSqlBytes.toString('utf8');
    requireCondition(
      Buffer.from(sourceSql, 'utf8').equals(rawSqlBytes),
      'BACKUP_SQL_NOT_UTF8',
    );
  } catch (error) {
    if (error instanceof SafeFailure) throw error;
    fail('BACKUP_SQL_NOT_UTF8');
  }

  const normalized = splitAndClassifyHostedBackupSql(sourceSql);
  const normalizedSqlSha256 = await writeOrVerifyText(
    normalizedBackupPath,
    normalized.normalizedSql,
    'NORMALIZED_BACKUP_WRITE_FAILED',
  );
  const db = openDatabaseFromNormalizedSql(normalized.normalizedSql);
  try {
    const snapshot = snapshotDatabase(db);
    const counts = scopedCounts(db);
    verifyScopedCounts(counts);
    return {
      rawBackupSha256: sha256(rawSqlBytes),
      rawBackupBytes: rawSqlBytes.byteLength,
      normalizedSqlSha256,
      statementCounts: normalized.statementCounts,
      statementCount: normalized.statementCount,
      snapshot,
      counts,
      db,
    };
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve only a safe error code.
    }
    if (error instanceof SafeFailure) throw error;
    fail('LOCAL_BACKUP_VALIDATION_FAILED');
  }
}

function assertSnapshotsMatch(source, restored) {
  requireCondition(
    JSON.stringify(source.snapshot.tableHashes) ===
      JSON.stringify(restored.snapshot.tableHashes) &&
      source.snapshot.tableCount === restored.snapshot.tableCount &&
      source.snapshot.totalRows === restored.snapshot.totalRows &&
      source.snapshot.schemaSha256 === restored.snapshot.schemaSha256 &&
      source.snapshot.foreignKeySchemaSha256 ===
        restored.snapshot.foreignKeySchemaSha256 &&
      source.snapshot.sqliteSequence.count ===
        restored.snapshot.sqliteSequence.count &&
      source.snapshot.sqliteSequence.sha256 ===
        restored.snapshot.sqliteSequence.sha256 &&
      source.counts.ledger === restored.counts.ledger &&
      source.counts.photos === restored.counts.photos &&
      source.counts.assets === restored.counts.assets &&
      JSON.stringify(source.counts.assetKinds) ===
        JSON.stringify(restored.counts.assetKinds),
    'RESTORED_DATABASE_PARITY_FAILED',
  );
}

async function executeRestore() {
  let phase = 'preflight';
  let source = null;
  let restored = null;
  try {
    requireCondition(
      process.argv.length === 3 &&
        process.argv[2] === '--restore-synthetic-staging-only',
      'INVALID_ARGUMENTS',
    );
    requireCondition(
      !process.env.CLOUDFLARE_ACCOUNT_ID ||
        process.env.CLOUDFLARE_ACCOUNT_ID === accountId,
      'CLOUDFLARE_ACCOUNT_MISMATCH',
    );
    await access(wranglerPath, constants.R_OK).catch(() =>
      fail('WRANGLER_NOT_INSTALLED'),
    );

    source = await loadAndVerifyLocalBackup();
    phase = 'restore_target';
    const targetState = await getOrCreateRestoreTarget();
    await verifyRemoteTargetEmpty();

    phase = 'import';
    await runWrangler(
      [
        'd1',
        'execute',
        restoreDatabaseName,
        '--remote',
        '--file',
        normalizedBackupPath,
        '--yes',
      ],
      'import',
    );

    phase = 'remote_verify';
    await verifyRemoteRestoredCounts();

    phase = 'export';
    restored = await exportRestoredDatabase();

    phase = 'compare';
    assertSnapshotsMatch(source, restored);

    const proof = {
      status: 'passed_independent_synthetic_d1_restore',
      checkedAt: new Date().toISOString(),
      accountId,
      sourceDatabaseId,
      restoreDatabaseName,
      restoreDatabaseId: targetState.databaseId,
      backupSqlSha256: source.rawBackupSha256,
      backupSqlBytes: source.rawBackupBytes,
      normalizedSqlSha256: source.normalizedSqlSha256,
      restoredExportSha256: restored.exportedSqlSha256,
      restoredExportBytes: restored.exportedSqlBytes,
      restoredNormalizedSqlSha256: restored.normalizedExportSha256,
      statementCount: source.statementCount,
      statementCounts: source.statementCounts,
      tableCount: source.snapshot.tableCount,
      rowCount: source.snapshot.totalRows,
      tableHashes: source.snapshot.tableHashes,
      schemaSha256: source.snapshot.schemaSha256,
      foreignKeySchemaSha256: source.snapshot.foreignKeySchemaSha256,
      sqliteSequence: source.snapshot.sqliteSequence,
      ledgerEntries: source.counts.ledger,
      scopedPhotos: source.counts.photos,
      scopedAssets: source.counts.assets,
      scopedAssetKinds: source.counts.assetKinds,
      foreignKeyViolations: 0,
      sourceWrites: 0,
      sourceDeletes: 0,
      r2ObjectsBackedUp: false,
    };

    phase = 'proof';
    await writeJson(
      join(backupDirectory, 'restore-proof-' + timestampToken() + '.json'),
      proof,
      'RESTORE_PROOF_WRITE_FAILED',
      'wx',
    );
    console.log(
      JSON.stringify({
        status: proof.status,
        tableCount: proof.tableCount,
        rowCount: proof.rowCount,
        ledgerEntries: proof.ledgerEntries,
        scopedPhotos: proof.scopedPhotos,
        scopedAssets: proof.scopedAssets,
        backupSqlSha256: proof.backupSqlSha256,
        normalizedSqlSha256: proof.normalizedSqlSha256,
        restoredExportSha256: proof.restoredExportSha256,
        schemaSha256: proof.schemaSha256,
      }),
    );
    return 0;
  } catch (error) {
    const code =
      error instanceof SafeFailure ? error.code : 'UNEXPECTED_FAILURE';
    const failure = {
      status: 'failed',
      phase,
      code,
      checkedAt: new Date().toISOString(),
    };
    try {
      await writeJson(
        join(backupDirectory, 'restore-failure-' + timestampToken() + '.json'),
        failure,
        'FAILURE_LOG_WRITE_FAILED',
        'wx',
      );
    } catch {
      // Failed logs contain only safe error codes and aggregate phase names.
    }
    console.error(
      'Synthetic D1 restore failed at ' + phase + ' (' + code + ').',
    );
    return 1;
  } finally {
    try {
      source?.db?.close();
    } catch {
      // Nothing sensitive is emitted.
    }
    try {
      restored?.db?.close();
    } catch {
      // Nothing sensitive is emitted.
    }
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  process.exitCode = await executeRestore();
}
