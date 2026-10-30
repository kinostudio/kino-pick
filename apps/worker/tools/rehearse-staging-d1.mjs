import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

// Local rehearsal only; remote application is a separate explicitly scoped step.
assert.deepEqual(process.argv.slice(2), ['--local-only']);
const root = fileURLToPath(new URL('../', import.meta.url));
assert.equal(resolve('.').toLowerCase(), resolve(root).toLowerCase());
const sha = (value) => createHash('sha256').update(value).digest('hex');
const preflight = JSON.parse(
  await readFile('.local/staging-r2-current.json', 'utf8'),
);
assert.equal(preflight.accountId, 'd3e930465c0df7e89b35de3ca65ea36a');
assert.equal(preflight.databaseId, 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d');
assert.ok(
  resolve(preflight.backup).startsWith(resolve('.local') + '/') ||
    resolve(preflight.backup).startsWith(resolve('.local') + '\\'),
);
const backup = await readFile(preflight.backup);
assert.equal(sha(backup), preflight.backupSha256);
const files = (await readdir('migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
assert.equal(files.length, 54);
assert.equal(files.at(-1), '0054_version_approvals.sql');
const manifest = Object.fromEntries(
  await Promise.all(
    files.map(async (name) => [
      name,
      sha(await readFile(join('migrations', name))),
    ]),
  ),
);
const dir = resolve('.local/staging-r2-rehearsal-' + randomUUID());
await mkdir(dir);
const commands = [];
const proof = {
  status: 'in_progress',
  localOnly: true,
  remoteWrites: false,
  directory: dir,
  backupSha256: sha(backup),
  migrationHashes: manifest,
  commands,
};
const cfgA = join(dir, 'source', 'wrangler.jsonc'),
  cfgB = join(dir, 'restore', 'wrangler.jsonc');
for (const [config, name] of [
  [cfgA, 'source'],
  [cfgB, 'restore'],
]) {
  await mkdir(resolve(config, '..'), { recursive: true });
  await writeFile(
    config,
    JSON.stringify(
      {
        name: 'kino-pick-rehearsal-' + name,
        compatibility_date: '2026-10-23',
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'kino-pick-rehearsal-' + name,
            database_id: randomUUID(),
            migrations_dir: resolve('migrations'),
          },
        ],
      },
      null,
      2,
    ),
  );
}
function run(label, args, expectedError) {
  assert.ok(args.includes('--local'));
  assert.ok(!args.includes('--remote'));
  const record = {
    label,
    expectedError: expectedError ?? null,
    exitCode: null,
  };
  commands.push(record);
  process.stdout.write('local rehearsal: ' + label + '\n');
  try {
    const output = execFileSync(
      process.execPath,
      [resolve('node_modules/wrangler/bin/wrangler.js'), ...args],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      },
    );
    record.exitCode = 0;
    if (expectedError) throw new Error('Expected native guard denial');
    return output;
  } catch (error) {
    if (record.exitCode === 0) throw error;
    record.exitCode = error.status ?? -1;
    const output = String(error.stdout ?? '') + String(error.stderr ?? '');
    if (expectedError && output.includes(expectedError)) return output;
    throw new Error('Local rehearsal command failed: ' + label);
  }
}
const execute = (label, config, args, error) =>
  run(
    label,
    ['d1', 'execute', 'DB', '--config', config, '--local', ...args],
    error,
  );
async function exported(label, config, path) {
  run(label, [
    'd1',
    'export',
    'DB',
    '--config',
    config,
    '--local',
    '--output',
    path,
  ]);
  return readFile(path);
}
function snapshot(sql) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(sql.toString('utf8'));
    const names = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((row) => row.name)
      .filter((name) => !name.startsWith('_') && !name.startsWith('sqlite_'));
    const tables = {};
    for (const name of names) {
      const rows = db
        .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
        .all();
      tables[name] = {
        count: rows.length,
        hash: sha(
          rows
            .map((row) =>
              JSON.stringify(
                Object.fromEntries(
                  Object.keys(row)
                    .sort()
                    .map((key) => [key, row[key]]),
                ),
              ),
            )
            .sort()
            .join('\n'),
        ),
      };
    }
    const schema = db
      .prepare(
        'SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name',
      )
      .all()
      .filter(
        (row) => !row.name.startsWith('_') && !row.name.startsWith('sqlite_'),
      )
      .map((row) => ({ ...row }));
    return {
      tables,
      schema,
      foreignKeys: db
        .prepare('PRAGMA foreign_key_check')
        .all()
        .map((row) => ({ ...row })),
      ownerCount: db
        .prepare('SELECT count(*) AS n FROM owners WHERE enabled=1')
        .get().n,
      bootstrapCount: db
        .prepare('SELECT count(*) AS n FROM owner_bootstrap')
        .get().n,
      migrationCount: db
        .prepare('SELECT count(*) AS n FROM d1_migrations')
        .get().n,
    };
  } finally {
    db.close();
  }
}
try {
  execute('restore-empty-remote-backup', cfgA, ['--file', preflight.backup]);
  run('apply-54-migrations', [
    'd1',
    'migrations',
    'apply',
    'DB',
    '--config',
    cfgA,
    '--local',
  ]);
  execute('apply-owner-proposal-locally', cfgA, [
    '--file',
    resolve('.local/staging-owner-bootstrap.sql'),
  ]);
  const beforeSql = await exported(
    'export-migrated-owner-fixture',
    cfgA,
    join(dir, 'migrated.sql'),
  );
  const before = snapshot(beforeSql);
  assert.equal(before.migrationCount, 54);
  assert.equal(before.ownerCount, 1);
  assert.equal(before.bootstrapCount, 1);
  assert.equal(before.foreignKeys.length, 0);
  execute(
    'reject-second-owner-bootstrap',
    cfgA,
    ['--file', resolve('.local/staging-owner-bootstrap.sql')],
    'BOOTSTRAP_CLOSED',
  );
  execute(
    'reject-audit-rewrite',
    cfgA,
    [
      '--command',
      "UPDATE audit_events SET action='owner.signed_in' WHERE event_id='bootstrap'",
    ],
    'APPEND_ONLY_AUDIT',
  );
  const guarded = snapshot(
    await exported(
      'export-after-guard-denials',
      cfgA,
      join(dir, 'guarded.sql'),
    ),
  );
  assert.deepEqual(guarded, before);
  execute('restore-populated-fixture-in-second-d1', cfgB, [
    '--file',
    join(dir, 'migrated.sql'),
  ]);
  const restoredSql = await exported(
    'export-second-d1',
    cfgB,
    join(dir, 'restored.sql'),
  );
  const restored = snapshot(restoredSql);
  assert.deepEqual(restored, before);
  for (const file of files)
    assert.equal(sha(await readFile(join('migrations', file))), manifest[file]);
  proof.status = 'passed_local_rehearsal';
  proof.tableCount = Object.keys(before.tables).length;
  proof.migrationCount = before.migrationCount;
  proof.ownerCount = before.ownerCount;
  proof.foreignKeyViolations = before.foreignKeys.length;
  proof.restoreCanonicalParity = true;
  proof.migratedSqlSha256 = sha(beforeSql);
  proof.restoredSqlSha256 = sha(restoredSql);
  await writeFile(
    '.local/staging-r2-rehearsal-current.json',
    JSON.stringify(
      { ...proof, completedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      status: proof.status,
      migrations: 54,
      tables: proof.tableCount,
      foreignKeys: 0,
      restoreCanonicalParity: true,
      remoteWrites: false,
    }),
  );
} catch (error) {
  proof.status = 'failed';
  proof.reason = error.message;
  throw error;
} finally {
  await writeFile(
    join(dir, 'proof.json'),
    JSON.stringify(proof, null, 2) + '\n',
  );
}
