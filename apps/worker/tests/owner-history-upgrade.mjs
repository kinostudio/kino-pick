import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const EXPECTED_PRODUCT_TABLES = 118;
const HISTORY_INDEXES = Object.freeze({
  audit_owner_history_workspace_time: [
    ['workspace_id', false],
    ['occurred_at_utc', true],
    ['event_id', true],
  ],
  audit_owner_history_project_time: [
    ['workspace_id', false],
    ['project_id', false],
    ['occurred_at_utc', true],
    ['event_id', true],
  ],
  audit_owner_history_album_time: [
    ['workspace_id', false],
    ['album_id', false],
    ['occurred_at_utc', true],
    ['event_id', true],
  ],
  audit_owner_history_photo_time: [
    ['workspace_id', false],
    ['photo_id', false],
    ['occurred_at_utc', true],
    ['event_id', true],
  ],
  audit_owner_history_version_time: [
    ['workspace_id', false],
    ['version_id', false],
    ['occurred_at_utc', true],
    ['event_id', true],
  ],
  audit_owner_history_action_time: [
    ['workspace_id', false],
    ['action', false],
    ['occurred_at_utc', true],
    ['event_id', true],
  ],
  audit_owner_history_workspace_rowid: [['workspace_id', false]],
});
const EXPECTED_INDEX_NAMES = Object.keys(HISTORY_INDEXES).sort();

function encodeDatabaseValue(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint')
    return { type: 'bigint', value: value.toString() };
  if (Buffer.isBuffer(value))
    return { type: 'blob', base64: value.toString('base64') };
  if (value instanceof ArrayBuffer)
    return {
      type: 'blob',
      base64: Buffer.from(value).toString('base64'),
    };
  if (ArrayBuffer.isView(value))
    return {
      type: 'blob',
      base64: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString('base64'),
    };
  if (Array.isArray(value)) return value.map(encodeDatabaseValue);
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, encodeDatabaseValue(value[key])]),
    );
  return value;
}

function canonicalRow(row) {
  return JSON.stringify(
    Object.keys(row)
      .sort(compareText)
      .map((key) => [key, encodeDatabaseValue(row[key])]),
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function quoteIdentifier(value) {
  return '"' + value.replaceAll('"', '""') + '"';
}

async function productTableNames(db) {
  const result = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  assert.equal(result.success, true, 'Could not list pre-upgrade tables');
  return result.results
    .map((row) => String(row.name))
    .filter(
      (name) =>
        !name.startsWith('sqlite_') &&
        !name.startsWith('_') &&
        name !== 'd1_migrations',
    )
    .sort(compareText);
}

async function productTableSnapshot(db, tableNames) {
  const entries = [];
  let rowCount = 0;
  let byteCount = 0;
  for (const tableName of tableNames) {
    const result = await db
      .prepare('SELECT * FROM ' + quoteIdentifier(tableName))
      .all();
    assert.equal(result.success, true, 'Could not read table ' + tableName);
    const rows = result.results.map(canonicalRow).sort(compareText);
    const bytes = Buffer.from(rows.join('\n'), 'utf8');
    rowCount += rows.length;
    byteCount += bytes.byteLength;
    entries.push([
      tableName,
      {
        rowCount: rows.length,
        byteCount: bytes.byteLength,
        sha256: sha256(bytes),
      },
    ]);
  }
  return {
    tables: Object.fromEntries(entries),
    rowCount,
    byteCount,
    contentHash: sha256(JSON.stringify(entries)),
  };
}

async function sqliteSequenceSnapshot(db) {
  const result = await db
    .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
    .all();
  assert.equal(result.success, true, 'Could not read sqlite_sequence');
  return result.results.map((row) => [String(row.name), String(row.seq)]);
}

async function schemaObjects(db) {
  const result = await db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN('table','index','trigger','view') ORDER BY type,name",
    )
    .all();
  assert.equal(result.success, true, 'Could not read sqlite schema');
  return result.results
    .filter(
      (row) =>
        !String(row.name).startsWith('sqlite_') &&
        !String(row.name).startsWith('_') &&
        row.name !== 'd1_migrations',
    )
    .map((row) => ({
      type: String(row.type),
      name: String(row.name),
      table: row.tbl_name === null ? null : String(row.tbl_name),
      sql: row.sql === null ? null : String(row.sql),
    }))
    .sort(
      (left, right) =>
        compareText(left.type, right.type) ||
        compareText(left.name, right.name),
    );
}

async function auditTriggerSql(db) {
  const result = await db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='audit_events' ORDER BY name",
    )
    .all();
  assert.equal(result.success, true, 'Could not read audit_events triggers');
  const triggers = result.results.map((row) => ({
    name: String(row.name),
    sql: String(row.sql),
  }));
  assert.ok(
    triggers.some((trigger) => trigger.name === 'audit_no_update'),
    'The append-only audit update trigger must exist before migration 0048',
  );
  assert.ok(
    triggers.some((trigger) => trigger.name === 'audit_no_delete'),
    'The append-only audit delete trigger must exist before migration 0048',
  );
  return triggers;
}

async function foreignKeyCheck(db) {
  const result = await db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(result.success, true, 'Could not check foreign keys');
  return result.results;
}

function executableIndexMigration(source48) {
  assert.equal(typeof source48, 'string');
  assert.ok(source48.trim(), 'Migration 0048 source must be non-empty');
  const executable = source48
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trim().startsWith('--'))
    .join(' ');
  const statements = executable
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(
    statements.length,
    EXPECTED_INDEX_NAMES.length,
    '0048 must contain only the seven expected additive index statements',
  );
  const names = statements.map((statement) => {
    const match =
      /^CREATE\s+INDEX\s+([a-z_][a-z0-9_]*)\s+ON\s+audit_events\s*\([\s\S]*\)$/iu.exec(
        statement,
      );
    assert.ok(
      match,
      '0048 may contain only CREATE INDEX statements on audit_events',
    );
    return match[1];
  });
  assert.deepEqual(names.sort(compareText), EXPECTED_INDEX_NAMES);
  return executable;
}

async function indexColumns(db, name) {
  const result = await db.prepare("PRAGMA index_xinfo('" + name + "')").all();
  assert.equal(result.success, true, 'Could not inspect index ' + name);
  return result.results
    .filter((row) => Number(row.key) === 1)
    .sort((left, right) => Number(left.seqno) - Number(right.seqno))
    .map((row) => [String(row.name), Number(row.desc) === 1]);
}

async function queryPlan(db, sql, bindings, label) {
  const result = await db
    .prepare('EXPLAIN QUERY PLAN ' + sql)
    .bind(...bindings)
    .all();
  assert.equal(result.success, true, 'Could not explain ' + label);
  const details = result.results.map((row) => String(row.detail));
  return details;
}

async function assertIndexedPlan(db, sql, bindings, indexName, label) {
  const details = await queryPlan(db, sql, bindings, label);
  assert.ok(
    details.some((detail) => detail.includes(indexName)),
    label + ' must use ' + indexName + ': ' + details.join(' | '),
  );
  assert.ok(
    !details.some((detail) => /USE TEMP B-TREE/i.test(detail)),
    label + ' must not sort into a temporary B-tree: ' + details.join(' | '),
  );
  return details;
}

async function assertWorkspaceRowidSeek(db) {
  const sql =
    'SELECT e.rowid FROM audit_events AS e INDEXED BY audit_owner_history_workspace_rowid ' +
    'WHERE e.workspace_id=? ORDER BY e.rowid DESC LIMIT 1';
  const bindings = ['11111111-1111-4111-8111-111111111111'];
  const details = await assertIndexedPlan(
    db,
    sql,
    bindings,
    'audit_owner_history_workspace_rowid',
    'workspace snapshot high-water query',
  );
  assert.ok(
    !details.some((detail) => /\bSCAN\s+e\b/i.test(detail)),
    'Workspace snapshot high-water query must seek within its workspace index: ' +
      details.join(' | '),
  );

  let result;
  try {
    result = await db
      .prepare('EXPLAIN ' + sql)
      .bind(...bindings)
      .all();
  } catch {
    // Some D1 adapters expose QUERY PLAN but not raw EXPLAIN bytecode.
    return { details, bytecodeVerified: false };
  }
  if (!result.success || !result.results.length)
    return { details, bytecodeVerified: false };
  const opcodes = result.results.map((row) => String(row.opcode));
  assert.ok(
    opcodes.some((opcode) =>
      /^(?:SeekGE|SeekGT|SeekLE|SeekLT|SeekRowid|SeekScan|Last|IdxGE|IdxGT|IdxLE|IdxLT)$/u.test(
        opcode,
      ),
    ),
    'Workspace snapshot high-water query should seek to a bounded index position: ' +
      opcodes.join(', '),
  );
  assert.ok(
    !opcodes.some((opcode) =>
      /^(?:SorterOpen|SorterInsert|Sort)$/u.test(opcode),
    ),
    'Workspace snapshot high-water query must not sort its result',
  );
  return { details, bytecodeVerified: true };
}

/**
 * Apply the index-only 0048 migration to a populated 0047 D1 fixture and prove
 * that existing product rows, AUTOINCREMENT state, audit guards, and foreign
 * key integrity are preserved while every Owner-history access index is present.
 */
export async function verifyOwnerHistoryUpgrade({ db, source48 }) {
  assert.ok(db, 'Owner history upgrade requires an isolated D1 database');
  const executable = executableIndexMigration(source48);
  const tablesBefore = await productTableNames(db);
  assert.equal(
    tablesBefore.length,
    EXPECTED_PRODUCT_TABLES,
    '0047 fixture must contain all 118 existing product tables',
  );
  const dataBefore = await productTableSnapshot(db, tablesBefore);
  const sequencesBefore = await sqliteSequenceSnapshot(db);
  const triggersBefore = await auditTriggerSql(db);
  const schemaBefore = await schemaObjects(db);
  const foreignKeysBefore = await foreignKeyCheck(db);
  assert.deepEqual(
    foreignKeysBefore,
    [],
    '0047 fixture must have no foreign-key violations before migration 0048',
  );

  const preexistingIndexes = schemaBefore
    .filter((object) => object.type === 'index')
    .map((object) => object.name)
    .filter((name) => EXPECTED_INDEX_NAMES.includes(name));
  assert.deepEqual(
    preexistingIndexes,
    [],
    'Owner history indexes must be introduced by migration 0048',
  );

  await db.exec(executable);

  const tablesAfter = await productTableNames(db);
  assert.deepEqual(
    tablesAfter,
    tablesBefore,
    'Migration 0048 must not add, remove, or rename product tables',
  );
  const dataAfter = await productTableSnapshot(db, tablesBefore);
  assert.deepEqual(
    dataAfter,
    dataBefore,
    'Migration 0048 must preserve every pre-existing product row byte-for-byte',
  );
  assert.deepEqual(
    await sqliteSequenceSnapshot(db),
    sequencesBefore,
    'Migration 0048 must not change sqlite_sequence',
  );
  const triggersAfter = await auditTriggerSql(db);
  assert.deepEqual(
    triggersAfter,
    triggersBefore,
    'Migration 0048 must preserve every audit_events trigger definition',
  );
  assert.deepEqual(
    await foreignKeyCheck(db),
    [],
    'Migration 0048 must leave zero foreign-key violations',
  );

  const schemaAfter = await schemaObjects(db);
  const addedIndexes = schemaAfter
    .filter(
      (object) =>
        object.type === 'index' &&
        !schemaBefore.some(
          (previous) =>
            previous.type === 'index' && previous.name === object.name,
        ),
    )
    .map((object) => object.name)
    .sort(compareText);
  assert.deepEqual(
    addedIndexes,
    EXPECTED_INDEX_NAMES,
    'Migration 0048 must add exactly the seven Owner history indexes',
  );
  const schemaAfterExceptNewIndexes = schemaAfter.filter(
    (object) =>
      object.type !== 'index' || !EXPECTED_INDEX_NAMES.includes(object.name),
  );
  assert.deepEqual(
    schemaAfterExceptNewIndexes,
    schemaBefore,
    'Migration 0048 may not change existing schema objects',
  );

  for (const [name, columns] of Object.entries(HISTORY_INDEXES)) {
    assert.deepEqual(
      await indexColumns(db, name),
      columns,
      name + ' columns and sort directions must match the query plan contract',
    );
  }

  const workspacePlan = await assertIndexedPlan(
    db,
    'SELECT event_id FROM audit_events WHERE workspace_id=? AND occurred_at_utc>=? AND occurred_at_utc<? ORDER BY occurred_at_utc DESC,event_id DESC LIMIT ?',
    [
      '11111111-1111-4111-8111-111111111111',
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T00:00:00.000Z',
      25,
    ],
    'audit_owner_history_workspace_time',
    'workspace/time history page query',
  );
  const photoPlan = await assertIndexedPlan(
    db,
    'SELECT event_id FROM audit_events WHERE workspace_id=? AND photo_id=? AND rowid<=? AND occurred_at_utc>=? AND occurred_at_utc<? ORDER BY occurred_at_utc DESC,event_id DESC LIMIT ?',
    [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '9223372036854775807',
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T00:00:00.000Z',
      25,
    ],
    'audit_owner_history_photo_time',
    'workspace/photo history page query',
  );
  const rowidSeek = await assertWorkspaceRowidSeek(db);

  return {
    preservedProductTables: tablesBefore.length,
    preservedProductRows: dataBefore.rowCount,
    preservedCanonicalBytes: dataBefore.byteCount,
    preservedContentSha256: dataBefore.contentHash,
    preservedTableHashes: Object.keys(dataBefore.tables).length,
    preservedSqliteSequences: sequencesBefore.length,
    auditTriggersUnchanged: true,
    ownerHistoryIndexes: EXPECTED_INDEX_NAMES,
    workspaceTimePlanIndexed: true,
    workspaceTimePlan: workspacePlan,
    scopedPhotoPlanIndexed: true,
    scopedPhotoPlan: photoPlan,
    workspaceRowidSeekIndexed: true,
    workspaceRowidSeekPlan: rowidSeek.details,
    workspaceRowidSeekBytecodeVerified: rowidSeek.bytecodeVerified,
    foreignKeyViolations: 0,
  };
}
