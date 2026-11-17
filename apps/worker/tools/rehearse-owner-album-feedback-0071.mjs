import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  restoreProductionExport,
  summarizeProductionDatabase,
} from './rehearse-production-copy.mjs';
import { validateSchemaAdoptions } from '../../../tools/production-schema-adoptions.mjs';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(workerRoot, '../..');
const migrationDir = join(workerRoot, 'migrations');
const protectedDir = resolve(workerRoot, '.local/owner-feedback-0071-20261116');
const beforePath = resolve(protectedDir, 'production70-before.sql');
const afterPath = resolve(protectedDir, 'production71-after.sql');
const proofPath = resolve(
  protectedDir,
  'owner-album-feedback-0071-local-rehearsal.json',
);
const baselineSchema67 =
  '236e4c4de66717addef33329a04b596cd179adc1c163697be831903d7768d8a5';

let stage = 'initialize';

function need(ok, code) {
  if (!ok) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (value instanceof ArrayBuffer)
    return { blob: Buffer.from(value).toString('base64') };
  if (ArrayBuffer.isView(value))
    return {
      blob: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString('base64'),
    };
  if (typeof value === 'bigint') return { integer: value.toString() };
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
  return sha256(Buffer.from(lines.join('\n')));
}

function productSchema(db) {
  return db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
    )
    .all()
    .filter(
      (row) =>
        row.name !== 'd1_migrations' &&
        row.tbl_name !== 'd1_migrations' &&
        !row.name.startsWith('_cf_') &&
        !row.tbl_name.startsWith('_cf_') &&
        !row.name.startsWith('sqlite_') &&
        !row.tbl_name.startsWith('sqlite_'),
    );
}

function schemaMap(rows) {
  return new Map(
    rows.map((row) => [
      `${row.type}\0${row.name}\0${row.tbl_name}`,
      JSON.stringify(canonical(row)),
    ]),
  );
}

function addedSchemaObjects(before, after) {
  const old = schemaMap(before);
  return after.filter(
    (row) => !old.has(`${row.type}\0${row.name}\0${row.tbl_name}`),
  );
}

function oldTableSummary(snapshot, tableNames) {
  const entries = tableNames.map((table) => ({
    table,
    ...snapshot.tableHashes[table],
  }));
  return {
    tableCount: entries.length,
    rowCount: entries.reduce((sum, item) => sum + item.count, 0),
    sha256: canonicalHash(entries),
  };
}

function assertPreExistingTableParity(before, after, tableNames) {
  for (const table of tableNames) {
    const oldHash = before.tableHashes[table];
    need(after.tableHashes[table], 'PREEXISTING_TABLE_MISSING');
    need(
      after.tableHashes[table].count === oldHash.count &&
        after.tableHashes[table].sha256 === oldHash.sha256,
      'PREEXISTING_TABLE_DATA_CHANGED',
    );
  }
}

function selfTest() {
  const before = {
    tableHashes: { albums: { count: 2, sha256: 'a'.repeat(64) } },
  };
  const matching = {
    tableHashes: { albums: { count: 2, sha256: 'a'.repeat(64) } },
  };
  const changed = {
    tableHashes: { albums: { count: 2, sha256: 'b'.repeat(64) } },
  };
  assert.doesNotThrow(() =>
    assertPreExistingTableParity(before, matching, ['albums']),
  );
  assert.throws(
    () => assertPreExistingTableParity(before, changed, ['albums']),
    { code: 'PREEXISTING_TABLE_DATA_CHANGED' },
  );
  assert.throws(
    () => assertPreExistingTableParity(before, { tableHashes: {} }, ['albums']),
    { code: 'PREEXISTING_TABLE_MISSING' },
  );
}

function migrationLedger(db) {
  return db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all();
}

async function readExport(path) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    need(false, 'PROTECTED_EXPORT_READ_FAILED');
  }
  const sql = bytes.toString('utf8');
  need(Buffer.from(sql, 'utf8').equals(bytes), 'EXPORT_NOT_UTF8');
  return { bytes, sql, restored: restoreProductionExport(sql) };
}

async function writeProtectedOnce(bytes) {
  need(dirname(proofPath) === protectedDir, 'PROOF_PATH');
  try {
    await writeFile(proofPath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(proofPath);
    need(existing.equals(bytes), 'PROOF_DIFFERS_FROM_PRIOR_RUN');
  }
}

async function run() {
  stage = 'read-migration-chain';
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  need(names.length === 71, 'MIGRATION_CHAIN_NOT_71');
  need(
    names.every((name, index) => Number(name.slice(0, 4)) === index + 1),
    'MIGRATION_ORDER',
  );
  need(names[66] === '0067_delivery_zip_tickets.sql', 'MIGRATION_BASELINE');
  need(names[69] === '0070_invite_labels.sql', 'MIGRATION_0070_MISSING');
  need(/^0071_.+\.sql$/u.test(names[70]), 'MIGRATION_0071_MISSING');

  const migrationName = names[70];
  const migrationBytes = await readFile(join(migrationDir, migrationName));
  const migrationSql = migrationBytes.toString('utf8');
  need(
    Buffer.from(migrationSql, 'utf8').equals(migrationBytes),
    'MIGRATION_NOT_UTF8',
  );
  const statements = unstable_splitSqlQuery(migrationSql).filter((sql) =>
    String(sql).trim(),
  );
  need(statements.length > 0, 'MIGRATION_EMPTY');

  stage = 'verify-existing-schema70-adoption';
  const adoptions = JSON.parse(
    await readFile(
      resolve(repositoryRoot, 'docs/releases/production-schema-adoptions.json'),
      'utf8',
    ),
  );
  need(
    adoptions.baseline?.productSchemaSha256 === baselineSchema67,
    'ADOPTION_BASELINE',
  );
  const priorNames = names.slice(0, 70);
  const priorFileSha256 = {};
  for (const name of priorNames.slice(67))
    priorFileSha256[name] = sha256(await readFile(join(migrationDir, name)));
  const priorGate = validateSchemaAdoptions(adoptions, {
    names: priorNames,
    fileSha256: priorFileSha256,
    baselineSchemaSha256: baselineSchema67,
  });
  need(priorGate.expectedMigrationCount === 70, 'PRIOR_GATE_COUNT');
  need(priorGate.adoptedNames.at(-1) === names[69], 'PRIOR_GATE_0070');

  stage = 'restore-protected-exports';
  const beforeExport = await readExport(beforePath);
  const afterExport = await readExport(afterPath);
  const before = summarizeProductionDatabase(beforeExport.restored.db);
  const after = summarizeProductionDatabase(afterExport.restored.db);
  const beforeSchema = productSchema(beforeExport.restored.db);
  const afterSchema = productSchema(afterExport.restored.db);
  const beforeTables = Object.keys(before.tableHashes).sort();
  const afterTables = Object.keys(after.tableHashes).sort();
  const beforeLedger = migrationLedger(beforeExport.restored.db);
  const afterLedger = migrationLedger(afterExport.restored.db);
  need(
    beforeLedger.map((row) => row.name).join('\n') === priorNames.join('\n'),
    'BEFORE_LEDGER_70',
  );
  need(
    afterLedger.map((row) => row.name).join('\n') === names.join('\n'),
    'AFTER_LEDGER_71',
  );
  need(
    before.productSchemaSha256 === priorGate.expectedSchemaSha256,
    'BEFORE_SCHEMA_NOT_ADOPTED_70',
  );
  need(beforeExport.restored.foreignKeyViolations === 0, 'BEFORE_FOREIGN_KEYS');
  need(afterExport.restored.foreignKeyViolations === 0, 'AFTER_FOREIGN_KEYS');

  stage = 'run-0071-native-rehearsal';
  const db = beforeExport.restored.db;
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const statement of statements) db.exec(statement);
      db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(
        migrationName,
      );
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Keep the failure code safe; the in-memory database is discarded.
      }
      throw error;
    }

    stage = 'compare-clone-parity';
    const rehearsed = summarizeProductionDatabase(db);
    const rehearsedSchema = productSchema(db);
    const rehearsedTables = Object.keys(rehearsed.tableHashes).sort();
    need(
      JSON.stringify(afterLedger) === JSON.stringify(migrationLedger(db)),
      'AFTER_LEDGER_DIFFERS_FROM_NATIVE_REPLAY',
    );
    const beforeSchemaMap = schemaMap(beforeSchema);
    const afterSchemaMap = schemaMap(afterSchema);
    const rehearsedSchemaMap = schemaMap(rehearsedSchema);
    for (const [key, value] of beforeSchemaMap) {
      need(afterSchemaMap.get(key) === value, 'AFTER_OLD_SCHEMA_CHANGED');
      need(rehearsedSchemaMap.get(key) === value, 'LOCAL_OLD_SCHEMA_CHANGED');
    }
    need(
      canonicalHash(addedSchemaObjects(beforeSchema, afterSchema)) ===
        canonicalHash(addedSchemaObjects(beforeSchema, rehearsedSchema)),
      'NEW_SCHEMA_OBJECTS_DIFFER',
    );
    need(
      after.productSchemaSha256 === rehearsed.productSchemaSha256,
      'AFTER_SCHEMA_DIFFERS_FROM_NATIVE_REPLAY',
    );
    need(
      afterTables.join('\n') === rehearsedTables.join('\n'),
      'AFTER_TABLE_SET_DIFFERS_FROM_NATIVE_REPLAY',
    );
    assertPreExistingTableParity(before, after, beforeTables);
    need(
      Object.keys(after.tableHashes)
        .sort()
        .every(
          (table) =>
            after.tableHashes[table].count ===
              rehearsed.tableHashes[table].count &&
            after.tableHashes[table].sha256 ===
              rehearsed.tableHashes[table].sha256,
        ),
      'AFTER_TABLE_DATA_DIFFERS_FROM_NATIVE_REPLAY',
    );
    need(
      after.productTableDataSha256 === rehearsed.productTableDataSha256,
      'AFTER_DATA_DIGEST_DIFFERS_FROM_NATIVE_REPLAY',
    );
    need(
      JSON.stringify(after.sqliteSequence) ===
        JSON.stringify(rehearsed.sqliteSequence),
      'AFTER_SEQUENCE_DIFFERS_FROM_NATIVE_REPLAY',
    );
    need(
      beforeExport.restored.integrityCheck === 'ok' &&
        afterExport.restored.integrityCheck === 'ok',
      'EXPORT_INTEGRITY',
    );
    const fkViolations = db.prepare('PRAGMA foreign_key_check').all().length;
    need(fkViolations === 0, 'REHEARSAL_FOREIGN_KEYS');
    const integrity = db.prepare('PRAGMA integrity_check').all();
    need(
      integrity.length === 1 && integrity[0].integrity_check === 'ok',
      'REHEARSAL_INTEGRITY',
    );

    stage = 'write-safe-proof';
    const proof = {
      status: 'passed_local_0071_rehearsal_not_live_adoption',
      localOnly: true,
      inputs: {
        before70Sha256: sha256(beforeExport.bytes),
        before70Bytes: beforeExport.bytes.byteLength,
        after71Sha256: sha256(afterExport.bytes),
        after71Bytes: afterExport.bytes.byteLength,
      },
      migration: {
        sha256: sha256(migrationBytes),
        statementCount: statements.length,
      },
      schema70: {
        migrationCount: beforeLedger.length,
        productSchemaSha256: before.productSchemaSha256,
        productSchemaObjectCount: beforeSchema.length,
        preExistingTables: oldTableSummary(before, beforeTables),
        foreignKeyViolations: beforeExport.restored.foreignKeyViolations,
        integrityCheck: beforeExport.restored.integrityCheck,
      },
      schema71: {
        migrationCount: afterLedger.length,
        productSchemaSha256: after.productSchemaSha256,
        productSchemaObjectCount: afterSchema.length,
        productTableCount: after.tableCount,
        productRowCount: after.totalRows,
        productTableDataSha256: after.productTableDataSha256,
        preExistingTables: oldTableSummary(after, beforeTables),
        preExistingSchemaObjectCount: beforeSchema.length,
        addedSchemaObjectCount: addedSchemaObjects(beforeSchema, afterSchema)
          .length,
        cloneMatchesNativeReplay: true,
        foreignKeyViolations: fkViolations,
        integrityCheck: integrity[0].integrity_check,
      },
      releaseGate: {
        priorSchema70AdoptionValidated: true,
        newLiveAdoptionRecordWritten: false,
        liveD1ReadOrWrite: false,
        cloudflareOrGitMutation: false,
      },
    };
    const proofBytes = Buffer.from(JSON.stringify(proof, null, 2) + '\n');
    await writeProtectedOnce(proofBytes);
    console.log(
      JSON.stringify({
        status: proof.status,
        schema70: proof.schema70,
        schema71: proof.schema71,
        proofSha256: sha256(proofBytes),
      }),
    );
  } finally {
    beforeExport.restored.db.close();
    afterExport.restored.db.close();
  }
}

if (process.argv[2] === '--self-test') {
  try {
    selfTest();
    console.log('synthetic parity self-test passed');
  } catch (error) {
    const code =
      typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
        ? error.code
        : 'SELF_TEST_FAILED';
    console.error(`self-test:${code}`);
    process.exitCode = 1;
  }
} else {
  run().catch((error) => {
    const code =
      typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
        ? error.code
        : 'LOCAL_REHEARSAL_FAILED';
    console.error(`${stage}:${code}`);
    process.exitCode = 1;
  });
}
