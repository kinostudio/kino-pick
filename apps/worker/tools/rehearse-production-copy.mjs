import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  snapshotDatabase,
  splitAndClassifyHostedBackupSql,
} from './rehearse-hosted-d1-restore.mjs';

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(workerDirectory, 'migrations');
const expectedMigrationCount = 67;
const expectedLastMigration = '0067_delivery_zip_tickets.sql';

class RehearsalFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new RehearsalFailure(code);
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
  const serialized = rows.map((row) => JSON.stringify(canonical(row))).sort();
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

export function splitProductionExport(source) {
  requireCondition(typeof source === 'string', 'EXPORT_SQL_NOT_TEXT');
  let statements;
  try {
    statements = unstable_splitSqlQuery(source);
  } catch {
    throw new RehearsalFailure('EXPORT_SQL_SPLIT_FAILED');
  }
  requireCondition(Array.isArray(statements), 'EXPORT_SQL_SPLIT_FAILED');

  const counts = {
    PRAGMA: 0,
    'CREATE TABLE': 0,
    'INSERT INTO': 0,
    'DELETE FROM sqlite_sequence': 0,
    'CREATE INDEX': 0,
    'CREATE UNIQUE INDEX': 0,
    'CREATE VIEW': 0,
    'CREATE TRIGGER': 0,
  };
  const analyzeStatements = [];
  const normalizerStatements = [];
  for (const value of statements) {
    const statement = String(value).trim();
    if (!statement) continue;
    const head = stripLeadingComments(statement);
    if (/^ANALYZE\s+sqlite_schema\s*;?$/i.test(head)) {
      analyzeStatements.push(
        statement.endsWith(';') ? statement : statement + ';',
      );
    } else if (/^PRAGMA\b/i.test(head)) {
      requireCondition(
        /^PRAGMA\s+(?:foreign_keys\s*=\s*(?:0|OFF)|defer_foreign_keys\s*=\s*(?:1|ON|TRUE))\s*;?$/i.test(
          head,
        ),
        'EXPORT_SQL_UNSUPPORTED_PRAGMA',
      );
      counts.PRAGMA++;
    } else if (/^CREATE\s+TABLE\b/i.test(head)) {
      counts['CREATE TABLE']++;
    } else if (/^INSERT\s+INTO\b/i.test(head)) {
      counts['INSERT INTO']++;
    } else if (
      /^DELETE\s+FROM\s+(?:"sqlite_sequence"|\[sqlite_sequence\]|sqlite_sequence)\s*;?$/i.test(
        head,
      )
    ) {
      counts['DELETE FROM sqlite_sequence']++;
    } else if (/^CREATE\s+UNIQUE\s+INDEX\b/i.test(head)) {
      counts['CREATE UNIQUE INDEX']++;
    } else if (/^CREATE\s+INDEX\b/i.test(head)) {
      counts['CREATE INDEX']++;
    } else if (/^CREATE\s+VIEW\b/i.test(head)) {
      counts['CREATE VIEW']++;
    } else if (/^CREATE\s+TRIGGER\b/i.test(head)) {
      counts['CREATE TRIGGER']++;
    } else {
      const category =
        head
          .match(/^[A-Za-z]+(?:\s+[A-Za-z]+)?/)?.[0]
          ?.toUpperCase()
          .replace(/\s+/g, '_') ?? 'UNKNOWN';
      throw new RehearsalFailure('EXPORT_SQL_UNSUPPORTED_' + category);
    }
    if (!/^ANALYZE\s+sqlite_schema\s*;?$/i.test(head))
      normalizerStatements.push(
        statement.endsWith(';') ? statement : statement + ';',
      );
  }

  let normalized;
  try {
    normalized = splitAndClassifyHostedBackupSql(
      normalizerStatements.join('\n'),
      counts,
    );
  } catch (error) {
    const code =
      error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'UNKNOWN';
    throw new RehearsalFailure('EXPORT_SQL_REORDER_' + code);
  }

  return {
    sql:
      (analyzeStatements.length ? analyzeStatements.join('\n') + '\n' : '') +
      normalized.normalizedSql,
    statementCount: statements.filter((statement) => String(statement).trim())
      .length,
    statementCounts: {
      ...normalized.statementCounts,
      'ANALYZE sqlite_schema': analyzeStatements.length,
    },
  };
}

export function restoreProductionExport(source) {
  const split = splitProductionExport(source);
  const db = new DatabaseSync(':memory:');
  let phase = 'transaction';
  try {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
    db.exec('PRAGMA defer_foreign_keys=TRUE;');
    phase = 'normalized-sql';
    for (const statement of unstable_splitSqlQuery(split.sql)) {
      try {
        db.exec(statement);
      } catch {
        const head = stripLeadingComments(String(statement));
        const category =
          head
            .match(/^[A-Za-z]+(?:\s+[A-Za-z]+)?/)?.[0]
            ?.toUpperCase()
            .replace(/\s+/g, '_') ?? 'UNKNOWN';
        throw new RehearsalFailure('SQLITE_LOAD_' + category + '_FAILED');
      }
    }
    phase = 'integrity-check';
    const integrity = db.prepare('PRAGMA integrity_check').all();
    requireCondition(
      integrity.length === 1 && integrity[0].integrity_check === 'ok',
      'SQLITE_INTEGRITY_CHECK_FAILED',
    );
    phase = 'foreign-key-check';
    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    requireCondition(foreignKeys.length === 0, 'FOREIGN_KEY_CHECK_FAILED');
    phase = 'commit';
    db.exec('COMMIT;');
    return {
      db,
      ...split,
      integrityCheck: 'ok',
      foreignKeyViolations: foreignKeys.length,
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // Keep errors limited to the safe failure code below.
    }
    db.close();
    if (error instanceof RehearsalFailure) throw error;
    throw new RehearsalFailure(
      'SQLITE_' + phase.replace(/-/g, '_').toUpperCase() + '_FAILED',
    );
  }
}

function excludedMetadataName(name) {
  return (
    name === 'd1_migrations' ||
    name.startsWith('_cf_') ||
    name.startsWith('sqlite_')
  );
}

function sqliteSequenceRows(db) {
  const exists = db
    .prepare(
      "SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name='sqlite_sequence'",
    )
    .get().n;
  return Number(exists) === 0
    ? []
    : db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name').all();
}

function sqliteInternalTableHashes(db, names) {
  return Object.fromEntries(
    names
      .filter(
        (name) => name.startsWith('sqlite_') && name !== 'sqlite_sequence',
      )
      .sort()
      .map((name) => [
        name,
        canonicalHash(db.prepare('SELECT * FROM ' + sqlIdentifier(name)).all()),
      ]),
  );
}

export function summarizeProductionDatabase(db) {
  const genericSnapshot = snapshotDatabase(db);
  const names = db
    .prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name);
  const productTables = names.filter((name) => !excludedMetadataName(name));
  const tableHashes = {};
  let totalRows = 0;
  for (const name of productTables) {
    let tableHash = genericSnapshot.tableHashes[name];
    if (!tableHash) {
      const rows = db.prepare('SELECT * FROM ' + sqlIdentifier(name)).all();
      tableHash = canonicalHash(rows);
    }
    tableHashes[name] = tableHash;
    totalRows += tableHash.count;
  }

  const schemaRows = db
    .prepare(
      'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name',
    )
    .all()
    .filter(
      (row) =>
        !excludedMetadataName(row.name) && !excludedMetadataName(row.tbl_name),
    );
  const ledgerRows = db
    .prepare('SELECT * FROM d1_migrations ORDER BY id')
    .all();
  const sequenceRows = sqliteSequenceRows(db);
  const sqliteInternalTables = sqliteInternalTableHashes(db, names);

  return {
    tableCount: productTables.length,
    totalRows,
    tableHashes,
    productSchemaSha256: canonicalHash(schemaRows).sha256,
    productTableDataSha256: canonicalHash(
      productTables.map((table) => ({ table, ...tableHashes[table] })),
    ).sha256,
    migrationLedger: canonicalHash(ledgerRows),
    sqliteSequence: canonicalHash(sequenceRows),
    sqliteInternalTables,
    excludedProviderTables: names.filter((name) => name.startsWith('_cf_')),
  };
}

async function currentRepositoryMigrations() {
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  requireCondition(
    files.length === expectedMigrationCount &&
      files.at(-1) === expectedLastMigration,
    'REPOSITORY_SCHEMA_NOT_CURRENT_67',
  );
  const entries = await Promise.all(
    files.map(async (name) => ({
      name,
      sha256: sha256(await readFile(join(migrationDirectory, name))),
    })),
  );
  const migrationRows = entries.map(({ name, sha256 }) => ({ name, sha256 }));
  return {
    files: entries,
    migrationManifestSha256: canonicalHash(migrationRows).sha256,
  };
}

function validateMigrationLedger(db, migrations) {
  let columns;
  let rows;
  try {
    columns = db.prepare('PRAGMA table_info(d1_migrations)').all();
    rows = db.prepare('SELECT * FROM d1_migrations ORDER BY id').all();
  } catch {
    throw new RehearsalFailure('MIGRATION_LEDGER_UNAVAILABLE');
  }
  const columnNames = new Set(columns.map((row) => row.name));
  requireCondition(
    columnNames.has('id') && columnNames.has('name'),
    'MIGRATION_LEDGER_SCHEMA_UNSUPPORTED',
  );
  requireCondition(
    rows.length === expectedMigrationCount &&
      rows.every((row, index) => row.name === migrations.files[index].name),
    'MIGRATION_LEDGER_DOES_NOT_MATCH_CURRENT_67_REPOSITORY',
  );
  return canonicalHash(rows);
}

function parityEqual(left, right) {
  return (
    left.productSchemaSha256 === right.productSchemaSha256 &&
    JSON.stringify(left.tableHashes) === JSON.stringify(right.tableHashes) &&
    left.productTableDataSha256 === right.productTableDataSha256 &&
    JSON.stringify(left.migrationLedger) ===
      JSON.stringify(right.migrationLedger) &&
    JSON.stringify(left.sqliteSequence) ===
      JSON.stringify(right.sqliteSequence) &&
    JSON.stringify(left.sqliteInternalTables) ===
      JSON.stringify(right.sqliteInternalTables)
  );
}

function safeSnapshotSummary(snapshot) {
  const internalHashes = Object.entries(snapshot.sqliteInternalTables).map(
    ([table, hash]) => ({ table, ...hash }),
  );
  return {
    tableCount: snapshot.tableCount,
    totalRows: snapshot.totalRows,
    productSchemaSha256: snapshot.productSchemaSha256,
    productTableDataSha256: snapshot.productTableDataSha256,
    migrationLedger: snapshot.migrationLedger,
    sqliteSequence: snapshot.sqliteSequence,
    sqliteInternalMetadata: {
      tableCount: internalHashes.length,
      rowCount: internalHashes.reduce((sum, row) => sum + row.count, 0),
      sha256: canonicalHash(internalHashes).sha256,
    },
    excludedProviderMetadataTableCount: snapshot.excludedProviderTables.length,
  };
}

async function readExport(path) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw new RehearsalFailure('EXPORT_SQL_READ_FAILED');
  }
  const source = bytes.toString('utf8');
  requireCondition(
    Buffer.from(source, 'utf8').equals(bytes),
    'EXPORT_SQL_NOT_UTF8',
  );
  return { source, bytes };
}

async function writeNewOrVerify(path, bytes, label) {
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    return;
  } catch (error) {
    if (error?.code !== 'EEXIST')
      throw new RehearsalFailure(label + '_OUTPUT_WRITE_FAILED');
  }
  let existing;
  try {
    existing = await readFile(path);
  } catch {
    throw new RehearsalFailure(label + '_OUTPUT_READ_FAILED');
  }
  requireCondition(existing.equals(bytes), label + '_OUTPUT_COLLISION');
}

function parseArguments(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (
      ![
        '--source',
        '--compare',
        '--normalized-output',
        '--proof-output',
      ].includes(option) ||
      result[option]
    )
      throw new RehearsalFailure('USAGE');
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new RehearsalFailure('USAGE');
    result[option] = value;
  }
  requireCondition(
    Boolean(result['--source']) &&
      Boolean(result['--normalized-output']) &&
      Boolean(result['--proof-output']),
    'USAGE',
  );
  return {
    source: result['--source'],
    compare: result['--compare'],
    normalizedOutput: result['--normalized-output'],
    proofOutput: result['--proof-output'],
  };
}

async function inspectExport(path, migrations) {
  const file = await readExport(path);
  const restored = restoreProductionExport(file.source);
  try {
    const ledger = validateMigrationLedger(restored.db, migrations);
    const snapshot = summarizeProductionDatabase(restored.db);
    requireCondition(
      JSON.stringify(snapshot.migrationLedger) === JSON.stringify(ledger),
      'MIGRATION_LEDGER_SNAPSHOT_MISMATCH',
    );
    return {
      sqlSha256: sha256(file.bytes),
      bytes: file.bytes.byteLength,
      statementCount: restored.statementCount,
      statementCounts: restored.statementCounts,
      integrityCheck: restored.integrityCheck,
      foreignKeyViolations: restored.foreignKeyViolations,
      snapshot,
      normalizedSql: restored.sql,
    };
  } finally {
    restored.db.close();
  }
}

export async function rehearseProductionCopy({
  source,
  compare,
  normalizedOutput,
  proofOutput,
}) {
  const migrations = await currentRepositoryMigrations();
  const primary = await inspectExport(source, migrations);
  const secondary = compare ? await inspectExport(compare, migrations) : null;
  if (secondary)
    requireCondition(
      parityEqual(primary.snapshot, secondary.snapshot),
      'PRODUCT_COPY_PARITY_MISMATCH',
    );

  const outputPath = resolve(normalizedOutput);
  const proofPath = resolve(proofOutput);
  requireCondition(
    dirname(outputPath).toLowerCase() ===
      dirname(resolve(source)).toLowerCase() &&
      dirname(proofPath).toLowerCase() ===
        dirname(resolve(source)).toLowerCase() &&
      outputPath.toLowerCase() !== resolve(source).toLowerCase() &&
      proofPath.toLowerCase() !== resolve(source).toLowerCase() &&
      outputPath.toLowerCase() !== proofPath.toLowerCase() &&
      (!compare ||
        (outputPath.toLowerCase() !== resolve(compare).toLowerCase() &&
          proofPath.toLowerCase() !== resolve(compare).toLowerCase())),
    'NORMALIZED_EXPORT_MUST_STAY_WITH_PROTECTED_SOURCE',
  );
  await writeNewOrVerify(
    outputPath,
    Buffer.from(primary.normalizedSql),
    'NORMALIZED_EXPORT',
  );

  const primarySummary = { ...primary };
  delete primarySummary.normalizedSql;
  primarySummary.snapshot = safeSnapshotSummary(primary.snapshot);
  const result = {
    status: 'passed_local_production_copy_rehearsal',
    localOnly: true,
    sourceWrites: 0,
    schemaVersion: 67,
    sourceFile: primarySummary,
    repositoryMigrationCount: migrations.files.length,
    repositoryMigrationManifestSha256: migrations.migrationManifestSha256,
    normalizedExport: {
      file: basename(outputPath),
      bytes: Buffer.byteLength(primary.normalizedSql, 'utf8'),
      sha256: sha256(Buffer.from(primary.normalizedSql, 'utf8')),
    },
  };
  if (secondary) {
    const secondarySummary = { ...secondary };
    delete secondarySummary.normalizedSql;
    secondarySummary.snapshot = safeSnapshotSummary(secondary.snapshot);
    result.compareFile = secondarySummary;
    result.exactProductParity = true;
  }
  await writeNewOrVerify(
    proofPath,
    Buffer.from(JSON.stringify(result, null, 2) + '\n', 'utf8'),
    'PROOF',
  );
  return result;
}

async function main() {
  let phase = 'arguments';
  try {
    const options = parseArguments(process.argv.slice(2));
    phase = 'current-repository-schema';
    const result = await rehearseProductionCopy(options);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    const code =
      error instanceof RehearsalFailure ? error.code : 'UNEXPECTED_FAILURE';
    console.error(
      'Production-copy rehearsal failed during ' + phase + ' (' + code + ').',
    );
    return 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) process.exitCode = await main();
