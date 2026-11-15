import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  restoreProductionExport,
  summarizeProductionDatabase,
} from './rehearse-production-copy.mjs';
import { validateSchemaAdoptions } from '../../../tools/production-schema-adoptions.mjs';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(workerRoot, '../..');
const protectedDir = resolve(workerRoot, '.local/invite-labels-0070-20261116');
const sourcePath = resolve(protectedDir, 'production69-before.sql');
const normalizedPath = resolve(protectedDir, 'normalized-before.sql');
const proofPathFor = (state) =>
  resolve(protectedDir, `invite-labels-0070-local-rehearsal-${state}-v2.json`);
const adoptionsPath = resolve(
  repositoryRoot,
  'docs/releases/production-schema-adoptions.json',
);
const migrationDir = join(workerRoot, 'migrations');
const baseline67 =
  '236e4c4de66717addef33329a04b596cd179adc1c163697be831903d7768d8a5';
const schema68 =
  '95d7a0e0c83be92d951163a7eb6ac9146b1b1648b49edf8f1b9e62525068a59d';
const schema69 =
  '950084afeeb385a8ba2bbe1d471e75372bb9c9769058977b66390a9154383add';
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

function excludedSchemaName(name) {
  return (
    name === 'd1_migrations' ||
    name.startsWith('_cf_') ||
    name.startsWith('sqlite_')
  );
}

function schemaCount(db) {
  return productSchema(db).length;
}

function keyedSchema(rows) {
  return new Map(
    rows.map((row) => [
      `${row.type}\0${row.name}\0${row.tbl_name}`,
      JSON.stringify(canonical(row)),
    ]),
  );
}

function dataTableNames(snapshot) {
  return Object.keys(snapshot.tableHashes).sort();
}

function summarizeExistingTableHashes(snapshot, tableNames) {
  const entries = tableNames.map((table) => ({
    table,
    ...snapshot.tableHashes[table],
  }));
  return {
    count: entries.length,
    rows: entries.reduce((sum, item) => sum + item.count, 0),
    sha256: canonicalHash(entries),
  };
}

async function writeProtectedOnce(path, bytes) {
  assert.equal(dirname(path), protectedDir);
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(path);
    assert.ok(
      existing.equals(bytes),
      'protected output differs from prior rehearsal',
    );
  }
}

async function run() {
  stage = 'enumerate-migrations';
  const names = (await readdir(migrationDir))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  assert.equal(names.length, 70, 'expected migrations 0001 through 0070');
  assert.ok(
    names.every((name, index) => Number(name.slice(0, 4)) === index + 1),
  );
  assert.equal(names[66], '0067_delivery_zip_tickets.sql');
  assert.equal(names[67], '0068_album_retention_settings.sql');
  assert.equal(names[68], '0069_cover_settings.sql');
  assert.equal(names[69], '0070_invite_labels.sql');

  const files = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        await readFile(join(migrationDir, name)),
      ]),
    ),
  );
  const fileHashes = Object.fromEntries(
    names.map((name) => [name, sha256(files.get(name))]),
  );

  const local = new DatabaseSync(':memory:');
  local.exec('PRAGMA foreign_keys=ON');
  const replayAnchors = {};
  let structuralAfterHash;
  let structuralAfterCount;
  try {
    stage = 'replay-migrations';
    for (const [index, name] of names.entries()) {
      local.exec(files.get(name).toString('utf8'));
      if (index === 66) {
        replayAnchors.schema67 = {
          sha256: canonicalHash(productSchema(local)),
          objectCount: schemaCount(local),
        };
        assert.equal(
          replayAnchors.schema67.sha256,
          baseline67,
          'schema67 local anchor',
        );
        assert.equal(replayAnchors.schema67.objectCount, 1203);
      } else if (index === 67) {
        replayAnchors.schema68 = {
          sha256: canonicalHash(productSchema(local)),
          objectCount: schemaCount(local),
        };
        assert.equal(
          replayAnchors.schema68.sha256,
          schema68,
          'schema68 local anchor',
        );
        assert.equal(replayAnchors.schema68.objectCount, 1209);
      } else if (index === 68) {
        replayAnchors.schema69 = {
          sha256: canonicalHash(productSchema(local)),
          objectCount: schemaCount(local),
        };
        assert.equal(
          replayAnchors.schema69.sha256,
          schema69,
          'schema69 local anchor',
        );
        assert.equal(replayAnchors.schema69.objectCount, 1217);
      } else if (index === 69) {
        structuralAfterHash = canonicalHash(productSchema(local));
        structuralAfterCount = schemaCount(local);
      }
    }
  } finally {
    local.close();
  }

  const sourceBytes = await readFile(sourcePath);
  stage = 'restore-production-export';
  const sourceSql = sourceBytes.toString('utf8');
  assert.ok(Buffer.from(sourceSql, 'utf8').equals(sourceBytes));
  const restored = restoreProductionExport(sourceSql);
  try {
    stage = 'write-normalized-before';
    const normalizedBytes = Buffer.from(restored.sql, 'utf8');
    await writeProtectedOnce(normalizedPath, normalizedBytes);

    stage = 'summarize-schema69-export';
    const migrationLedger = restored.db
      .prepare('SELECT id,name FROM d1_migrations ORDER BY id')
      .all();
    assert.equal(migrationLedger.length, 69);
    assert.deepEqual(
      migrationLedger.map((row) => row.name),
      names.slice(0, 69),
    );

    const before = summarizeProductionDatabase(restored.db);
    const beforeSchema = productSchema(restored.db);
    const beforeSchemaMap = keyedSchema(beforeSchema);
    const beforeTables = dataTableNames(before);
    assert.equal(before.productSchemaSha256, schema69);
    assert.equal(beforeSchema.length, 1217);
    assert.equal(restored.foreignKeyViolations, 0);
    const beforeTableHashes = summarizeExistingTableHashes(
      before,
      beforeTables,
    );

    const migrationSql = files.get(names[69]).toString('utf8');
    stage = 'validate-0070-ddl';
    const categories = unstable_splitSqlQuery(migrationSql)
      .map((statement) =>
        statement
          .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
          .trim(),
      )
      .filter(Boolean)
      .map((statement) => {
        const match = /^(PRAGMA|CREATE TABLE|CREATE TRIGGER)\b/iu.exec(
          statement,
        );
        assert.ok(
          match,
          'migration contains only PRAGMA, table, and trigger DDL',
        );
        return match[1].toUpperCase();
      });
    assert.deepEqual(categories.sort(), [
      'CREATE TABLE',
      'CREATE TRIGGER',
      'CREATE TRIGGER',
      'CREATE TRIGGER',
      'PRAGMA',
    ]);

    restored.db.exec('BEGIN IMMEDIATE');
    try {
      stage = 'apply-0070-locally';
      for (const statement of unstable_splitSqlQuery(migrationSql))
        restored.db.exec(statement);
      restored.db.exec('COMMIT');
    } catch (error) {
      restored.db.exec('ROLLBACK');
      throw error;
    }

    stage = 'compare-post-migration-state';
    const after = summarizeProductionDatabase(restored.db);
    const afterSchema = productSchema(restored.db);
    const afterSchemaMap = keyedSchema(afterSchema);
    const afterTables = dataTableNames(after);
    const newObjects = afterSchema
      .filter(
        (row) =>
          !beforeSchemaMap.has(`${row.type}\0${row.name}\0${row.tbl_name}`),
      )
      .map((row) => `${row.type}:${row.name}`)
      .sort();
    assert.deepEqual(newObjects, expectedNewObjects);
    for (const [key, value] of beforeSchemaMap)
      assert.equal(afterSchemaMap.get(key), value);
    assert.equal(
      afterSchemaMap.size,
      beforeSchemaMap.size + expectedNewObjects.length,
    );
    assert.equal(after.productSchemaSha256, structuralAfterHash);
    assert.equal(after.productSchemaSha256, canonicalHash(afterSchema));
    assert.equal(afterSchema.length, structuralAfterCount);

    const missingTables = beforeTables.filter(
      (table) => !after.tableHashes[table],
    );
    assert.deepEqual(missingTables, []);
    for (const table of beforeTables)
      assert.deepEqual(after.tableHashes[table], before.tableHashes[table]);
    const afterTableHashes = summarizeExistingTableHashes(after, beforeTables);
    assert.deepEqual(afterTableHashes, beforeTableHashes);
    assert.deepEqual(
      afterTables,
      [...beforeTables, 'guest_invite_labels'].sort(),
    );
    assert.equal(after.tableHashes.guest_invite_labels.count, 0);
    assert.equal(after.totalRows, before.totalRows);

    const fkViolations = restored.db
      .prepare('PRAGMA foreign_key_check')
      .all().length;
    assert.equal(fkViolations, 0);
    const integrity = restored.db.prepare('PRAGMA integrity_check').all();
    assert.equal(integrity.length, 1);
    assert.equal(integrity[0].integrity_check, 'ok');

    stage = 'verify-adoption-gate-and-write-artifacts';
    const adoptionRecord = JSON.parse(await readFile(adoptionsPath, 'utf8'));
    assert.equal(adoptionRecord.baseline.productSchemaSha256, baseline67);
    for (const index of [0, 1]) {
      assert.equal(
        adoptionRecord.adoptions[index].sha256,
        fileHashes[names[67 + index]],
      );
    }
    assert.equal(adoptionRecord.adoptions[0].schemaSha256After, schema68);
    assert.equal(
      adoptionRecord.adoptions[0].productSchemaObjectCountAfter,
      1209,
    );
    assert.equal(adoptionRecord.adoptions[1].schemaSha256After, schema69);
    assert.equal(
      adoptionRecord.adoptions[1].productSchemaObjectCountAfter,
      1217,
    );
    let gateValidation = null;
    let gateBlock = null;
    try {
      gateValidation = validateSchemaAdoptions(adoptionRecord, {
        names,
        fileSha256: fileHashes,
        baselineSchemaSha256: baseline67,
      });
    } catch (error) {
      if (error?.message !== 'ADOPTION_UNRECORDED_MIGRATION') throw error;
      gateBlock = error.message;
    }
    if (gateValidation) {
      assert.equal(gateValidation.expectedMigrationCount, 70);
      assert.equal(gateValidation.expectedSchemaSha256, structuralAfterHash);
      assert.deepEqual(gateValidation.adoptedNames, names.slice(67));
    } else {
      assert.equal(names.length, 70);
      assert.equal(adoptionRecord.adoptions.length, 2);
    }
    const gateState = gateValidation
      ? 'recorded-schema70'
      : 'unrecorded-schema70';
    const currentProofPath = proofPathFor(gateState);

    const proof = {
      status: 'passed_local_0070_rehearsal_not_live_adoption',
      localOnly: true,
      source: basename(sourcePath),
      sourceSha256: sha256(sourceBytes),
      sourceBytes: sourceBytes.byteLength,
      node: process.version,
      migration: {
        name: names[69],
        sha256: fileHashes[names[69]],
        statementCount: categories.length,
        statementCategories: categories.sort(),
      },
      anchors: {
        ...replayAnchors,
      },
      schema69ProductionExport: {
        migrationCount: migrationLedger.length,
        productSchemaSha256: before.productSchemaSha256,
        productSchemaObjectCount: beforeSchema.length,
        productTableCount: before.tableCount,
        productRowCount: before.totalRows,
        foreignKeyViolationsBefore: restored.foreignKeyViolations,
      },
      schema70AfterLocalApply: {
        productSchemaSha256: after.productSchemaSha256,
        productSchemaObjectCount: afterSchema.length,
        productTableCount: after.tableCount,
        productRowCount: after.totalRows,
        foreignKeyViolations: fkViolations,
        integrityCheck: 'ok',
        newObjects,
        existingSchemaObjectsUnchanged: beforeSchema.length,
        preExistingTableHashesUnchanged: beforeTableHashes,
        preExistingTableHashEntries: beforeTables.map((table) => ({
          table,
          ...before.tableHashes[table],
        })),
        sidecarRows: after.tableHashes.guest_invite_labels.count,
        matchesEmptyDatabaseMigrationReplay: true,
      },
      normalizedBefore: {
        file: basename(normalizedPath),
        bytes: normalizedBytes.byteLength,
        sha256: sha256(normalizedBytes),
      },
      releaseGate: {
        status: gateValidation
          ? 'manifest_valid_for_recorded_schema70_adoption'
          : 'blocked_unrecorded_schema70',
        reason: gateBlock,
        expectedMigrationCount: gateValidation?.expectedMigrationCount ?? 70,
        expectedSchemaSha256: gateValidation?.expectedSchemaSha256 ?? null,
        adoptedNames: gateValidation?.adoptedNames ?? null,
        adoptionRecordChanged: false,
        liveD1ReadOrWrite: false,
        cloudflareOrGitMutation: false,
      },
    };
    await writeProtectedOnce(
      currentProofPath,
      Buffer.from(JSON.stringify(proof, null, 2) + '\n', 'utf8'),
    );
    console.log(
      JSON.stringify({
        status: proof.status,
        schema69: proof.schema69ProductionExport,
        schema70: {
          productSchemaSha256:
            proof.schema70AfterLocalApply.productSchemaSha256,
          productSchemaObjectCount:
            proof.schema70AfterLocalApply.productSchemaObjectCount,
          preExistingTableHashesUnchanged:
            proof.schema70AfterLocalApply.preExistingTableHashesUnchanged,
          foreignKeyViolations:
            proof.schema70AfterLocalApply.foreignKeyViolations,
        },
        normalizedBefore: proof.normalizedBefore,
        releaseGate: proof.releaseGate,
        proof: basename(currentProofPath),
      }),
    );
  } finally {
    restored.db.close();
  }
}

run().catch((error) => {
  const safeCode =
    typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : 'LOCAL_REHEARSAL_FAILED';
  const location = error?.stack
    ?.split('\n')
    .find((line) => line.includes('rehearse-invite-labels-0070.mjs'))
    ?.match(/:(\d+):(\d+)\)?$/u);
  console.error(
    `${stage}:${safeCode}${location ? `:line-${location[1]}` : ''}`,
  );
  process.exitCode = 1;
});
