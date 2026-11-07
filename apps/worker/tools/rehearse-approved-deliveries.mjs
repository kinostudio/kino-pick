import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  splitAndClassifyHostedBackupSql,
  snapshotDatabase,
} from './rehearse-hosted-d1-restore.mjs';
const mode = process.argv[2];
assert.ok(['--restore', '--verify-restore', '--adopt'].includes(mode));
const suppliedArgs = process.argv.slice(3);
const schemaArgs = suppliedArgs.filter((arg) => arg.startsWith('--schema='));
assert.ok(schemaArgs.length <= 1, 'Specify --schema at most once');
const schemaVersion = schemaArgs.length
  ? Number(schemaArgs[0].slice('--schema='.length))
  : 66;
assert.ok([66, 67].includes(schemaVersion), 'Schema must be 66 or 67');
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
  },
  67: {
    sourceSchemaVersion: 66,
    targetSchemaVersion: 67,
    migrationName: '0067_delivery_zip_tickets.sql',
  },
};
const profile = profiles[schemaVersion];
const { sourceSchemaVersion, targetSchemaVersion, migrationName } = profile;
const schemaTag = String(targetSchemaVersion).padStart(4, '0');
const restoreStatus = `passed_independent_${schemaTag}_restore_upgrade`;
const adoptionStatus = `passed_independent_${schemaTag}_restore_and_B_adoption`;
const beforeFile = `before${sourceSchemaVersion}.sql`;
const restoredFile = `restored${sourceSchemaVersion}.sql`;
const normalizedFile = `normalized${sourceSchemaVersion}.sql`;
const upgradedFile = `upgraded${targetSchemaVersion}.sql`;
const account = 'd3e930465c0df7e89b35de3ca65ea36a';
const source = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const statePath = resolve(
  `.local/approved-deliveries-${schemaTag}-current.json`,
);
const dir =
  mode === '--adopt'
    ? JSON.parse(await readFile(statePath, 'utf8')).directory
    : mode === '--verify-restore'
      ? resolve(positionalArgs[0])
      : resolve(`.local/approved-deliveries-${schemaTag}-${randomUUID()}`);
assert.ok(typeof dir === 'string' && dir.startsWith(resolve('.local') + sep));
assert.ok(
  new RegExp(`approved-deliveries-${schemaTag}-[a-f0-9-]{36}$`).test(dir),
);
const config = join(dir, 'source.json');
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
const migrationBytes = await readFile(join('migrations', migrationName));
const migration = {
  name: migrationName,
  sha256: hash(migrationBytes),
  canonicalSha256: hash(
    migrationBytes.toString('utf8').replaceAll('\r\n', '\n'),
  ),
};
function assertNextMigrationSequence(db) {
  const applied = db
    .prepare('SELECT name FROM d1_migrations ORDER BY id')
    .all()
    .map(({ name }) => name);
  assert.deepEqual(orderedMigrationNames, [...applied, migrationName]);
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
function schema(db) {
  return db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all()
    .map((row) => ({ ...row, sql: row.sql.replaceAll('\r\n', '\n') }));
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
function checkOld(before, after) {
  for (const [name, value] of Object.entries(before.snapshot.tableHashes))
    if (name !== 'd1_migrations')
      assert.deepEqual(
        after.snapshot.tableHashes[name],
        value,
        'Old product rows changed: ' + name,
      );
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
    const expected = new DatabaseSync(':memory:');
    expected.exec('PRAGMA foreign_keys=ON;' + before.sql);
    expected.exec(migrationBytes.toString('utf8'));
    const expectedSnapshot = snapshotDatabase(expected);
    checkOld(before, { db: expected, snapshot: expectedSnapshot });
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
          `upgrade-independent${targetSchemaVersion}`,
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
    if (!resume)
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
    const upgraded = resume
      ? await load(join(dir, upgradedFile))
      : await exportDb(
          id,
          upgradedFile,
          restoreConfig,
          `verify-independent${targetSchemaVersion}`,
        );
    assert.deepEqual(schema(upgraded.db), schema(expected));
    checkOld(before, upgraded);
    const ledger = upgraded.db
      .prepare('SELECT id,name FROM d1_migrations ORDER BY id')
      .all();
    assert.equal(ledger.length, targetSchemaVersion);
    assert.equal(ledger[targetSchemaVersion - 1].name, migrationName);
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
    const before = await load(join(dir, beforeFile));
    assert.equal(before.sha256, proof.backupSha256);
    assert.equal(
      before.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,
      sourceSchemaVersion,
    );
    assertNextMigrationSequence(before.db);
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
    cli(
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config],
      'adopt-source66',
    );
    const after = await exportDb(
      source,
      `source-after${targetSchemaVersion}.sql`,
      config,
      `verify-source${targetSchemaVersion}`,
    );
    assert.deepEqual(schema(after.db), schema(drill.db));
    checkOld(before, after);
    assert.deepEqual(
      after.db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
      drill.db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
    );
    const final = {
      ...proof,
      status: adoptionStatus,
      sourceAfterSha256: after.sha256,
      exactIndependentDrillParity: true,
      commands: [...proof.commands, ...commands],
    };
    await json(join(dir, 'adoption-proof.json'), final);
    await json(
      resolve(
        `../../docs/releases/approved-deliveries-${schemaTag}-restore.json`,
      ),
      final,
    );
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
