import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  restoreProductionExport,
  summarizeProductionDatabase,
} from './rehearse-production-copy.mjs';
const root = new URL('../../../', import.meta.url);
const dir = new URL('../.local/owner-feedback-0071-20261116/', import.meta.url);
const sha = (value) => createHash('sha256').update(value).digest('hex');
let db, cloud;
try {
  const source = await readFile(new URL('restore72-after.sql', dir));
  const prior = JSON.parse(
    await readFile(
      new URL(
        'docs/releases/browser-first-0072-independent-restore.json',
        root,
      ),
    ),
  );
  assert.equal(sha(source), prior.restore72ExportSha256);
  db = restoreProductionExport(source.toString('utf8')).db;
  const before = summarizeProductionDatabase(db);
  assert.equal(before.productSchemaSha256, prior.schemaSha256After);
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
  const columns = Object.fromEntries(
    tables.map((name) => [
      name,
      db
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((c) => c.name),
    ]),
  );
  const rows = (database) =>
    Object.fromEntries(
      tables.map((name) => [
        name,
        database
          .prepare(
            `SELECT ${columns[name].map((c) => '"' + c + '"').join(',')} FROM "${name}"`,
          )
          .all()
          .map((r) => JSON.stringify(r))
          .sort(),
      ]),
    );
  const original = rows(db);
  const name = '0073_workspace_management.sql';
  const migration = await readFile(
    new URL('apps/worker/migrations/' + name, root),
  );
  db.exec('BEGIN');
  for (const sql of unstable_splitSqlQuery(migration.toString('utf8')))
    db.exec(sql);
  db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  db.exec('COMMIT');
  assert.deepEqual(rows(db), original);
  assert.equal(
    db
      .prepare(
        'SELECT count(*) n FROM workspaces WHERE deleted_at_ms IS NOT NULL',
      )
      .get().n,
    0,
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const after = summarizeProductionDatabase(db);
  const objectCount = db
    .prepare('SELECT name,tbl_name FROM sqlite_schema WHERE sql IS NOT NULL')
    .all()
    .filter(
      (r) =>
        ![r.name, r.tbl_name].some(
          (n) =>
            n === 'd1_migrations' ||
            n.startsWith('sqlite_') ||
            n.startsWith('_cf_'),
        ),
    ).length;
  const proof = {
    status: 'local_0073_parity_passed',
    migration: { name, sha256: sha(migration) },
    schemaSha256Before: before.productSchemaSha256,
    schemaSha256After: after.productSchemaSha256,
    productSchemaObjectCountAfter: objectCount,
    preExistingTableDataUnchanged: true,
    foreignKeyViolations: 0,
    cloudRestoreCompared: false,
  };
  if (process.argv.includes('--compare-cloud')) {
    const bytes = await readFile(new URL('restore73-after.sql', dir));
    cloud = restoreProductionExport(bytes.toString('utf8')).db;
    const summary = summarizeProductionDatabase(cloud);
    assert.equal(summary.productSchemaSha256, after.productSchemaSha256);
    assert.deepEqual(summary.tableHashes, after.tableHashes);
    assert.deepEqual(cloud.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(
      cloud.prepare('SELECT count(*) n FROM d1_migrations').get().n,
      73,
    );
    proof.cloudRestoreCompared = true;
    proof.status = 'independent_B_restore_0073_parity_passed';
    proof.restoreExportSha256 = sha(bytes);
  }
  await writeFile(
    new URL(
      'docs/releases/workspace-0073-' +
        (proof.cloudRestoreCompared
          ? 'independent-restore'
          : 'local-rehearsal') +
        '.json',
      root,
    ),
    JSON.stringify(proof, null, 2) + '\n',
  );
  console.log(proof.status);
} finally {
  db?.close();
  cloud?.close();
}
