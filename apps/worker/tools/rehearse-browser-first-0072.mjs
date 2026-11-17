import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  restoreProductionExport,
  summarizeProductionDatabase,
} from './rehearse-production-copy.mjs';

const root = new URL('../../../', import.meta.url);
const protectedDir = new URL(
  '../.local/owner-feedback-0071-20261116/',
  import.meta.url,
);
const migrationName = '0072_browser_first_processing.sql';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const read = (name) => readFile(new URL(name, protectedDir));
const schemaRows = (db) =>
  db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
    )
    .all()
    .filter(
      (r) =>
        ![r.name, r.tbl_name].some(
          (n) =>
            n === 'd1_migrations' ||
            n.startsWith('sqlite_') ||
            n.startsWith('_cf_'),
        ),
    );
const allowedChanges = new Set([
  'table:image_processing_jobs',
  'table:image_processing_outputs',
  'table:workspace_image_processing_policies',
  'table:workspace_image_processing_policy_commands',
  'table:owner_external_intents',
  'table:processing_review_commands',
  'trigger:processing_original_outbox',
  'trigger:upload_processing_source_limit',
  'trigger:processing_job_insert_guard',
  'trigger:processing_job_transition_guard',
]);
let phase = 'read';
let beforeDb, cloudDb;
try {
  const mode = process.argv[2];
  assert.ok(['--local', '--compare-cloud'].includes(mode));
  const priorProof = JSON.parse(
    await readFile(
      new URL(
        'docs/releases/owner-feedback-0071-independent-restore.json',
        root,
      ),
      'utf8',
    ),
  );
  const beforeBytes = await read('production71-after.sql');
  assert.equal(sha(beforeBytes), priorProof.backup.after71Sha256);
  beforeDb = restoreProductionExport(beforeBytes.toString('utf8')).db;
  assert.equal(
    beforeDb.prepare('SELECT count(*) AS n FROM d1_migrations').get().n,
    71,
  );
  const before = summarizeProductionDatabase(beforeDb);
  assert.equal(before.productSchemaSha256, priorProof.schemaSha256After);
  const oldSchema = schemaRows(beforeDb);
  const migration = await readFile(
    new URL('../migrations/' + migrationName, import.meta.url),
  );
  phase = 'replay';
  beforeDb.exec('BEGIN IMMEDIATE');
  try {
    for (const sql of unstable_splitSqlQuery(migration.toString('utf8')))
      beforeDb.exec(sql);
    beforeDb
      .prepare('INSERT INTO d1_migrations(name) VALUES(?)')
      .run(migrationName);
    beforeDb.exec('COMMIT');
  } catch (error) {
    beforeDb.exec('ROLLBACK');
    throw error;
  }
  const after = summarizeProductionDatabase(beforeDb);
  assert.deepEqual(
    after.tableHashes,
    before.tableHashes,
    'all existing product table rows must remain exact',
  );
  assert.deepEqual(beforeDb.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(
    beforeDb.prepare('PRAGMA integrity_check').get().integrity_check,
    'ok',
  );
  const afterSchema = schemaRows(beforeDb);
  assert.equal(afterSchema.length, oldSchema.length);
  const newMap = new Map(
    afterSchema.map((r) => [r.type + ':' + r.name, r.sql]),
  );
  const changed = oldSchema
    .filter((r) => r.sql !== newMap.get(r.type + ':' + r.name))
    .map((r) => r.type + ':' + r.name);
  assert.ok(
    changed.every((key) => allowedChanges.has(key)),
    'unexpected schema object changed',
  );
  const proof = {
    capturedAtUtc: new Date().toISOString(),
    status: 'populated_0072_local_replay_not_live_adopted',
    accountId: priorProof.accountId,
    sourceDatabaseId: priorProof.sourceDatabaseId,
    restoreDatabaseId: priorProof.restoreDatabaseId,
    beforeSchemaVersion: 71,
    afterSchemaVersion: 72,
    migration: { name: migrationName, sha256: sha(migration) },
    schemaSha256Before: before.productSchemaSha256,
    schemaSha256After: after.productSchemaSha256,
    productSchemaObjectCountAfter: afterSchema.length,
    preExistingTableCount: before.tableCount,
    preExistingRowCount: before.totalRows,
    preExistingTableDataUnchanged: true,
    productTableDataSha256: after.productTableDataSha256,
    changedSchemaObjects: changed,
    foreignKeyViolations: 0,
    integrityCheck: 'ok',
    cloudRestoreCompared: false,
    AChanged: false,
  };
  if (mode === '--compare-cloud') {
    phase = 'cloud-compare';
    const cloudBytes = await read('restore72-after.sql');
    cloudDb = restoreProductionExport(cloudBytes.toString('utf8')).db;
    const cloud = summarizeProductionDatabase(cloudDb);
    assert.equal(
      cloudDb.prepare('SELECT count(*) AS n FROM d1_migrations').get().n,
      72,
    );
    assert.equal(cloud.productSchemaSha256, after.productSchemaSha256);
    assert.deepEqual(cloud.tableHashes, after.tableHashes);
    assert.deepEqual(schemaRows(cloudDb), afterSchema);
    assert.deepEqual(cloudDb.prepare('PRAGMA foreign_key_check').all(), []);
    proof.status = 'independent_B_restore_0072_parity_passed_not_live_adopted';
    proof.cloudRestoreCompared = true;
    proof.restore72ExportSha256 = sha(cloudBytes);
  }
  const target = new URL(
    'docs/releases/browser-first-0072-' +
      (mode === '--local' ? 'local-rehearsal' : 'independent-restore') +
      '.json',
    root,
  );
  await writeFile(target, JSON.stringify(proof, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: proof.status,
      tables: before.tableCount,
      rows: before.totalRows,
      foreignKeyViolations: 0,
      proof: fileURLToPath(target),
    }),
  );
} catch (error) {
  console.error(
    'BROWSER_FIRST_REHEARSAL_FAILED:' +
      phase +
      ':' +
      (error.code ?? 'ASSERTION'),
  );
  process.exitCode = 1;
} finally {
  beforeDb?.close();
  cloudDb?.close();
}
