import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  splitAndClassifyHostedBackupSql,
  snapshotDatabase,
} from './rehearse-hosted-d1-restore.mjs';
assert.equal(process.argv.length, 3);
assert.ok(
  ['--restore', '--resume-drill', '--adopt', '--verify-adoption'].includes(
    process.argv[2],
  ),
  'Explicit reviewed 0060 operation required',
);
const dir = resolve('.local/photo-pins-0060-20261105');
const account = 'd3e930465c0df7e89b35de3ca65ea36a';
const source = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const name = 'kino-pick-restore60-20261105';
const config = join(dir, 'drill.json');
const commands = [];
const hash = (v) => createHash('sha256').update(v).digest('hex');
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
    throw Error('CLI_FAILED_' + label);
  }
}
function normalize(sql) {
  const counts = {};
  for (const s of unstable_splitSqlQuery(sql)) {
    const head = s
      .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
      .trim();
    const type =
      /^(PRAGMA|CREATE UNIQUE INDEX|CREATE INDEX|CREATE TABLE|CREATE TRIGGER|CREATE VIEW|INSERT INTO|DELETE FROM sqlite_sequence)/i.exec(
        head,
      )?.[1];
    assert.ok(type, 'Unexpected backup statement');
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return splitAndClassifyHostedBackupSql(sql, counts).normalizedSql;
}
async function load(path) {
  const bytes = await readFile(path);
  const sql = normalize(bytes.toString('utf8'));
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;BEGIN;' + sql + ';COMMIT;');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  return { db, snapshot: snapshotDatabase(db), sha256: hash(bytes), sql };
}
async function exportDb(id, file, cfg, label) {
  const path = join(dir, file);
  cli(
    ['d1', 'export', id, '--remote', '--config', cfg, '--output', path],
    label,
  );
  return load(path);
}
function preserves(before, after) {
  for (const [table, rows] of Object.entries(before.snapshot.tableHashes)) {
    if (table !== 'd1_migrations')
      assert.deepEqual(
        after.snapshot.tableHashes[table],
        rows,
        'Changed old data: ' + table,
      );
  }
  const oldSchema = before.db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all();
  const newSchema = after.db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all();
  assert.deepEqual(
    newSchema.filter((r) =>
      oldSchema.some((o) => o.type === r.type && o.name === r.name),
    ),
    oldSchema,
  );
  const seq = before.db
    .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
    .all();
  const seqAfter = after.db
    .prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name')
    .all();
  assert.deepEqual(
    seqAfter.filter((r) => r.name !== 'd1_migrations'),
    seq.filter((r) => r.name !== 'd1_migrations'),
  );
  assert.equal(
    after.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,
    60,
  );
  assert.equal(
    after.db
      .prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
      .get().name,
    '0060_photo_pins.sql',
  );
}
const before = await load(join(dir, 'before.sql'));
assert.equal(
  before.db.prepare('SELECT count(*) n FROM d1_migrations').get().n,
  59,
);
try {
  if (
    process.argv.includes('--adopt') ||
    process.argv.includes('--verify-adoption')
  ) {
    const proof = JSON.parse(await readFile(join(dir, 'proof.json'), 'utf8'));
    assert.equal(proof.status, 'passed_independent_0060_restore_upgrade');
    assert.equal(proof.beforeSha256, before.sha256);
    const verifyOnly = process.argv.includes('--verify-adoption');
    const fresh = verifyOnly
      ? await load(join(dir, 'fresh-before-adopt.sql'))
      : await exportDb(
          source,
          'fresh-before-adopt.sql',
          'wrangler.collaboration-validation.jsonc',
          'fresh-before-adopt',
        );
    assert.deepEqual(
      fresh.snapshot,
      before.snapshot,
      'Live data changed; stop and rehearse a fresh snapshot',
    );
    if (!verifyOnly)
      cli(
        [
          'd1',
          'migrations',
          'apply',
          'DB',
          '--remote',
          '--config',
          'wrangler.collaboration-validation.jsonc',
        ],
        'adopt-source-0060',
      );
    const after = verifyOnly
      ? await load(join(dir, 'source-after60.sql'))
      : await exportDb(
          source,
          'source-after60.sql',
          'wrangler.collaboration-validation.jsonc',
          'readback-source60',
        );
    preserves(fresh, after);
    const drill = await load(join(dir, 'drill-after60.sql'));
    const withoutApplyTimestamp = (snapshot) => {
      const copy = structuredClone(snapshot);
      delete copy.tableHashes.d1_migrations;
      return copy;
    };
    assert.deepEqual(
      withoutApplyTimestamp(after.snapshot),
      withoutApplyTimestamp(drill.snapshot),
    );
    assert.deepEqual(
      after.db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
      drill.db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
    );
    await writeFile(
      join(dir, 'adoption-proof.json'),
      JSON.stringify(
        {
          status: 'passed_B_0060_adoption',
          accountId: account,
          sourceDatabaseId: source,
          beforeSha256: fresh.sha256,
          afterSha256: after.sha256,
          oldTablesPreserved: true,
          foreignKeyViolations: 0,
          commands,
        },
        null,
        2,
      ),
      { flag: 'wx' },
    );
    console.log(
      JSON.stringify({
        status: 'passed_B_0060_adoption',
        tables: after.snapshot.tableCount,
        rows: after.snapshot.totalRows,
        commands,
      }),
    );
  } else {
    const existing = JSON.parse(
      cli(
        [
          'd1',
          'list',
          '--json',
          '--config',
          'wrangler.collaboration-validation.jsonc',
        ],
        'list-B',
      ),
    );
    let id;
    if (process.argv.includes('--resume-drill')) {
      const target = JSON.parse(
        await readFile(join(dir, 'target.json'), 'utf8'),
      );
      assert.equal(target.accountId, account);
      assert.equal(target.name, name);
      id = target.databaseId;
      assert.notEqual(id, source);
      assert.equal(
        existing.filter(
          (d) => d.name === name && (d.uuid === id || d.id === id),
        ).length,
        1,
      );
    } else {
      assert.ok(
        !existing.some((d) => d.name === name),
        'Drill already exists; inspect saved state before resuming',
      );
      const created = cli(
        [
          'd1',
          'create',
          name,
          '--update-config=false',
          '--config',
          'wrangler.collaboration-validation.jsonc',
        ],
        'create-independent-drill',
      );
      const ids = [
        ...new Set(
          [
            ...created.matchAll(
              /["']?(?:database_id|databaseId|uuid)["']?\s*[:=]\s*["']?([0-9a-f-]{36})/gi,
            ),
          ].map((m) => m[1]),
        ),
      ];
      assert.equal(ids.length, 1);
      id = ids[0];
      assert.notEqual(id, source);
      assert.ok(!existing.some((d) => d.uuid === id || d.id === id));
      await writeFile(
        join(dir, 'target.json'),
        JSON.stringify({ accountId: account, databaseId: id, name }, null, 2),
        { flag: 'wx' },
      );
      await writeFile(
        config,
        JSON.stringify(
          {
            account_id: account,
            d1_databases: [
              {
                binding: 'DB',
                database_name: name,
                database_id: id,
                migrations_dir: resolve('migrations'),
              },
            ],
          },
          null,
          2,
        ),
        { flag: 'wx' },
      );
      const empty = JSON.parse(
        cli(
          [
            'd1',
            'execute',
            'DB',
            '--remote',
            '--config',
            config,
            '--json',
            '--command',
            "SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
          ],
          'verify-empty',
        ),
      );
      assert.equal(empty[0].results[0].n, 0);
      await writeFile(join(dir, 'normalized.sql'), before.sql, { flag: 'wx' });
      cli(
        [
          'd1',
          'execute',
          'DB',
          '--remote',
          '--config',
          config,
          '--file',
          join(dir, 'normalized.sql'),
          '--yes',
        ],
        'restore-new-drill',
      );
    }
    const restored = await exportDb(
      id,
      process.argv.includes('--resume-drill')
        ? 'drill-resume59.sql'
        : 'drill-restored59.sql',
      config,
      'readback-restored59',
    );
    assert.deepEqual(restored.snapshot, before.snapshot);
    cli(
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config],
      'upgrade-drill60',
    );
    const upgraded = await exportDb(
      id,
      'drill-after60.sql',
      config,
      'readback-upgraded60',
    );
    preserves(before, upgraded);
    const proof = {
      status: 'passed_independent_0060_restore_upgrade',
      accountId: account,
      sourceDatabaseId: source,
      restoreDatabaseId: id,
      beforeSha256: before.sha256,
      restoredSha256: restored.sha256,
      upgradedSha256: upgraded.sha256,
      migration60Sha256: hash(
        (await readFile('migrations/0060_photo_pins.sql', 'utf8')).replaceAll(
          '\r\n',
          '\n',
        ),
      ),
      restoreParityPassed: true,
      oldTablesPreserved: true,
      foreignKeyViolations: 0,
      oldTableHashes: before.snapshot.tableHashes,
      commands,
    };
    await writeFile(join(dir, 'proof.json'), JSON.stringify(proof, null, 2), {
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        status: proof.status,
        restoreDatabaseId: id,
        tables: before.snapshot.tableCount,
        rows: before.snapshot.totalRows,
        commands,
      }),
    );
  }
} catch (error) {
  await writeFile(
    join(dir, 'failure-' + Date.now() + '.json'),
    JSON.stringify(
      {
        status: 'failed',
        message: String(error.message).slice(0, 200),
        commands,
      },
      null,
      2,
    ),
  );
  console.error('0060 rehearsal stopped; private failure record saved.');
  process.exitCode = 1;
}
