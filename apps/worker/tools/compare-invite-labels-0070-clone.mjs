import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  restoreProductionExport,
  summarizeProductionDatabase,
} from './rehearse-production-copy.mjs';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protectedDir = resolve(workerRoot, '.local/invite-labels-0070-20261116');
const beforePath = resolve(protectedDir, 'production69-before.sql');
const clonePath = resolve(protectedDir, 'restore70-after.sql');
const preflightPath = resolve(protectedDir, 'live69-preflight.json');
const bookmarkPath = resolve(protectedDir, 'live69-bookmark.json');
const proofPath = resolve(protectedDir, 'invite-labels-0070-clone-parity.json');
const migrationsDir = resolve(workerRoot, 'migrations');
const expected69 =
  '950084afeeb385a8ba2bbe1d471e75372bb9c9769058977b66390a9154383add';
const expected70 =
  '0c7ae219902d95f9868facc9cfb513679c825a173063a7bd74395bfef3110f95';
const expectedMigrationSha =
  '8bb44e926675e3e3ea0ec1fa759143b08b7f42ad2f2dadd36069c8045b1248fe';
const expectedNewObjects = [
  'table:guest_invite_labels',
  'trigger:guest_invite_labels_insert_guard',
  'trigger:guest_invite_labels_no_delete',
  'trigger:guest_invite_labels_no_update',
].sort();
let stage = 'initialize';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

function canonicalHash(rows) {
  const lines = rows.map((row) => JSON.stringify(canonical(row))).sort();
  return sha256(lines.join('\n'));
}

function excludedSchemaName(name) {
  return (
    name === 'd1_migrations' ||
    name.startsWith('_cf_') ||
    name.startsWith('sqlite_')
  );
}

function productSchema(db) {
  return db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
    )
    .all()
    .filter(
      (row) =>
        !excludedSchemaName(row.name) && !excludedSchemaName(row.tbl_name),
    );
}

function keyedSchema(rows) {
  return new Map(
    rows.map((row) => [
      `${row.type}\0${row.name}\0${row.tbl_name}`,
      JSON.stringify(canonical(row)),
    ]),
  );
}

function tableNames(snapshot) {
  return Object.keys(snapshot.tableHashes).sort();
}

function tableHashEntries(snapshot, names) {
  return names.map((table) => ({ table, ...snapshot.tableHashes[table] }));
}

async function readUtf8(path) {
  const bytes = await readFile(path);
  const text = bytes.toString('utf8');
  assert.ok(Buffer.from(text, 'utf8').equals(bytes));
  return { bytes, text };
}

async function writeProtectedOnce(path, bytes) {
  assert.equal(dirname(path), protectedDir);
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    assert.ok((await readFile(path)).equals(bytes));
  }
}

async function run() {
  stage = 'read-migration-manifest';
  const names = (await readdir(migrationsDir))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  assert.equal(names.length, 70);
  assert.equal(names[68], '0069_cover_settings.sql');
  assert.equal(names[69], '0070_invite_labels.sql');
  const migrationBytes = await readFile(join(migrationsDir, names[69]));
  assert.equal(sha256(migrationBytes), expectedMigrationSha);

  stage = 'read-readonly-preflight';
  const preflight = JSON.parse((await readUtf8(preflightPath)).text);
  assert.equal(Array.isArray(preflight), true);
  assert.equal(preflight.length, 3);
  assert.ok(preflight.every((entry) => entry.success === true));
  const preflightSchemaRows = preflight[0].results;
  const preflightLedgerNames = preflight[1].results.map((row) => row.name);
  const preflightSchema = preflightSchemaRows.filter(
    (row) => !excludedSchemaName(row.name) && !excludedSchemaName(row.tbl_name),
  );
  const preflightSchemaSha = canonicalHash(preflightSchema);
  assert.equal(preflightSchemaSha, expected69);
  assert.equal(preflightSchema.length, 1217);
  assert.deepEqual(preflightLedgerNames, names.slice(0, 69));
  assert.equal(preflight[2].results.length, 0);

  const bookmark = JSON.parse((await readUtf8(bookmarkPath)).text).bookmark;
  assert.equal(typeof bookmark, 'string');
  assert.ok(bookmark.length > 0);

  stage = 'restore-export-pair';
  const beforeFile = await readUtf8(beforePath);
  const cloneFile = await readUtf8(clonePath);
  const before = restoreProductionExport(beforeFile.text);
  const clone = restoreProductionExport(cloneFile.text);
  try {
    stage = 'compare-schema-and-ledger';
    const beforeSummary = summarizeProductionDatabase(before.db);
    const cloneSummary = summarizeProductionDatabase(clone.db);
    const beforeSchema = productSchema(before.db);
    const cloneSchema = productSchema(clone.db);
    const beforeSchemaMap = keyedSchema(beforeSchema);
    const cloneSchemaMap = keyedSchema(cloneSchema);
    assert.equal(beforeSummary.productSchemaSha256, expected69);
    assert.equal(beforeSchema.length, 1217);
    assert.equal(cloneSummary.productSchemaSha256, expected70);
    assert.equal(cloneSchema.length, 1221);
    assert.equal(cloneSummary.tableCount, 156);
    assert.equal(cloneSummary.tableHashes.guest_invite_labels.count, 0);

    for (const [key, value] of beforeSchemaMap)
      assert.equal(cloneSchemaMap.get(key), value);
    const newObjects = cloneSchema
      .filter(
        (row) =>
          !beforeSchemaMap.has(`${row.type}\0${row.name}\0${row.tbl_name}`),
      )
      .map((row) => `${row.type}:${row.name}`)
      .sort();
    assert.deepEqual(newObjects, expectedNewObjects);

    const beforeTables = tableNames(beforeSummary);
    const cloneTables = tableNames(cloneSummary);
    assert.equal(beforeSummary.tableCount, 155);
    assert.deepEqual(
      cloneTables,
      [...beforeTables, 'guest_invite_labels'].sort(),
    );
    for (const table of beforeTables)
      assert.deepEqual(
        cloneSummary.tableHashes[table],
        beforeSummary.tableHashes[table],
      );
    assert.equal(cloneSummary.totalRows, beforeSummary.totalRows);
    assert.equal(beforeSummary.totalRows, 8288);

    const beforeLedger = before.db
      .prepare('SELECT id,name FROM d1_migrations ORDER BY id')
      .all();
    const cloneLedger = clone.db
      .prepare('SELECT id,name FROM d1_migrations ORDER BY id')
      .all();
    assert.deepEqual(
      beforeLedger.map((row) => row.name),
      names.slice(0, 69),
    );
    assert.deepEqual(
      cloneLedger.map((row) => row.name),
      names,
    );
    assert.equal(beforeLedger.length, 69);
    assert.equal(cloneLedger.length, 70);

    stage = 'verify-integrity-and-write-proof';
    const beforeFk = before.db.prepare('PRAGMA foreign_key_check').all().length;
    const cloneFk = clone.db.prepare('PRAGMA foreign_key_check').all().length;
    assert.equal(beforeFk, 0);
    assert.equal(cloneFk, 0);
    const beforeIntegrity = before.db.prepare('PRAGMA integrity_check').all();
    const cloneIntegrity = clone.db.prepare('PRAGMA integrity_check').all();
    assert.equal(beforeIntegrity.length, 1);
    assert.equal(beforeIntegrity[0].integrity_check, 'ok');
    assert.equal(cloneIntegrity.length, 1);
    assert.equal(cloneIntegrity[0].integrity_check, 'ok');

    const oldTableHashes = tableHashEntries(beforeSummary, beforeTables);
    const proof = {
      status: 'passed_clone_export_parity_and_live69_read_only_preflight',
      localOnly: true,
      noCloudflareOrGitMutation: true,
      schema69: {
        export: basename(beforePath),
        exportSha256: sha256(beforeFile.bytes),
        productSchemaSha256: beforeSummary.productSchemaSha256,
        productSchemaObjectCount: beforeSchema.length,
        productTableCount: beforeSummary.tableCount,
        productRowCount: beforeSummary.totalRows,
        migrationCount: beforeLedger.length,
        lastMigration: beforeLedger.at(-1).name,
        foreignKeyViolations: beforeFk,
        integrityCheck: 'ok',
      },
      schema70Clone: {
        export: basename(clonePath),
        exportSha256: sha256(cloneFile.bytes),
        productSchemaSha256: cloneSummary.productSchemaSha256,
        productSchemaObjectCount: cloneSchema.length,
        productTableCount: cloneSummary.tableCount,
        productRowCount: cloneSummary.totalRows,
        migrationCount: cloneLedger.length,
        lastMigration: cloneLedger.at(-1).name,
        foreignKeyViolations: cloneFk,
        integrityCheck: 'ok',
        newObjects,
        sidecarRows: cloneSummary.tableHashes.guest_invite_labels.count,
        preExistingTables: {
          count: oldTableHashes.length,
          rows: oldTableHashes.reduce((sum, row) => sum + row.count, 0),
          sha256: canonicalHash(oldTableHashes),
          hashes: oldTableHashes,
          allEqualToSchema69Export: true,
        },
      },
      readOnlyLive69Preflight: {
        success: true,
        rawSchemaRowCount: preflightSchemaRows.length,
        productSchemaObjectCount: preflightSchema.length,
        productSchemaSha256: preflightSchemaSha,
        migrationCount: preflightLedgerNames.length,
        lastMigration: preflightLedgerNames.at(-1),
        foreignKeyViolations: preflight[2].results.length,
        timeTravelBookmarkPresent: true,
        timeTravelBookmarkSha256: sha256(bookmark),
      },
    };
    await writeProtectedOnce(
      proofPath,
      Buffer.from(JSON.stringify(proof, null, 2) + '\n', 'utf8'),
    );
    console.log(
      JSON.stringify({
        status: proof.status,
        schema69: {
          productSchemaSha256: proof.schema69.productSchemaSha256,
          objects: proof.schema69.productSchemaObjectCount,
          tables: proof.schema69.productTableCount,
          rows: proof.schema69.productRowCount,
          migrations: proof.schema69.migrationCount,
          fk: proof.schema69.foreignKeyViolations,
          integrity: proof.schema69.integrityCheck,
        },
        schema70Clone: {
          productSchemaSha256: proof.schema70Clone.productSchemaSha256,
          objects: proof.schema70Clone.productSchemaObjectCount,
          tables: proof.schema70Clone.productTableCount,
          rows: proof.schema70Clone.productRowCount,
          migrations: proof.schema70Clone.migrationCount,
          fk: proof.schema70Clone.foreignKeyViolations,
          integrity: proof.schema70Clone.integrityCheck,
          oldTableHashSha256: proof.schema70Clone.preExistingTables.sha256,
          oldTableCount: proof.schema70Clone.preExistingTables.count,
        },
        live69Preflight: proof.readOnlyLive69Preflight,
        proof: basename(proofPath),
      }),
    );
  } finally {
    before.db.close();
    clone.db.close();
  }
}

run().catch((error) => {
  const code =
    typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : 'LOCAL_COMPARISON_FAILED';
  const location = error?.stack
    ?.split('\n')
    .find((line) => line.includes('compare-invite-labels-0070-clone.mjs'))
    ?.match(/:(\d+):(\d+)\)?$/u);
  console.error(`${stage}:${code}${location ? `:line-${location[1]}` : ''}`);
  process.exitCode = 1;
});
