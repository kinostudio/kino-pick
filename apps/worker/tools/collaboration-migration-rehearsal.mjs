import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unstable_splitSqlQuery } from 'wrangler';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const account = 'd3e930465c0df7e89b35de3ca65ea36a';
const sourceId = 'cdee0ac7-bf91-4852-9c17-a996c0b84f8d';
const baselineVersion = '0ff58553-e642-47f5-93dc-cbd2ae36ccd7';
const albumId = '613487da-e6ff-4ada-9b66-949f21fcfa2c';
const statePath = join(root, '.local/collaboration-0059-current.json');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const ident = (value) => '"' + value.replaceAll('"', '""') + '"';
const json = (path, value) =>
  writeFile(path, JSON.stringify(value, null, 2) + '\n');
const mode = process.argv[2];
assert.ok(
  ['--inspect-local-backup', '--rehearse-B-only', '--adopt-B-only'].includes(
    mode,
  ),
);
const protect = (path, directory = false) =>
  execFileSync(
    'icacls.exe',
    [
      path,
      '/inheritance:r',
      '/grant:r',
      process.env.USERDOMAIN +
        '\\' +
        process.env.USERNAME +
        (directory ? ':(OI)(CI)F' : ':(F)'),
      '*S-1-5-18:' + (directory ? '(OI)(CI)F' : '(F)'),
      '*S-1-5-32-544:' + (directory ? '(OI)(CI)F' : '(F)'),
    ],
    { stdio: 'pipe', windowsHide: true },
  );

/** Only the trusted, hash-pinned Wrangler export from the fixed B source is admitted.
 * Every table/index exists before data; every original audit trigger is restored afterwards.
 * This function is never used to import over an existing database.
 */
function normalize(source) {
  const groups = [[], [], [], [], []],
    counts = {};
  for (const statement of unstable_splitSqlQuery(source)) {
    const clean = statement
      .replace(/^(?:\s|--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*/u, '')
      .trim();
    if (!clean) continue;
    let slot, type;
    if (
      /^PRAGMA\s+(?:foreign_keys\s*=\s*(?:0|OFF)|defer_foreign_keys\s*=\s*(?:1|ON|TRUE))\s*;?$/i.test(
        clean,
      )
    ) {
      slot = 0;
      type = 'pragma';
      groups[slot].push('PRAGMA defer_foreign_keys=TRUE;');
    } else if (/^CREATE\s+TABLE\b/i.test(clean)) {
      slot = 1;
      type = 'table';
      groups[slot].push(statement);
    } else if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(clean)) {
      slot = 2;
      type = 'index';
      groups[slot].push(statement);
    } else if (
      /^INSERT\s+INTO\b/i.test(clean) ||
      /^DELETE\s+FROM\s+(?:"sqlite_sequence"|sqlite_sequence)\s*;?$/i.test(
        clean,
      )
    ) {
      slot = 3;
      type = 'data';
      groups[slot].push(statement);
    } else if (/^CREATE\s+(?:TRIGGER|VIEW)\b/i.test(clean)) {
      slot = 4;
      type = 'guard';
      groups[slot].push(statement);
    } else throw new Error('UNREVIEWED_BACKUP_STATEMENT');
    counts[type] = (counts[type] ?? 0) + 1;
  }
  assert.ok(counts.table >= 137 && counts.table <= 141);
  assert.ok(counts.data >= 100 && counts.data <= 20000);
  assert.ok(counts.guard >= 700 && counts.guard <= 1000);
  return {
    sql:
      groups
        .flat()
        .map((s) => s.trim().replace(/;?$/, ';'))
        .join('\n') + '\nPRAGMA foreign_key_check;\n',
    counts,
  };
}
function snapshot(sql, upgrades = []) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys=OFF;');
    db.exec(sql);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    if (upgrades.length) {
      db.exec('PRAGMA foreign_keys=ON;BEGIN;');
      for (const upgrade of upgrades) db.exec(upgrade);
      db.exec('COMMIT;');
    }
    const rows = {},
      counts = {};
    for (const { name } of db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all()) {
      const values = db.prepare('SELECT * FROM ' + ident(name)).all();
      counts[name] = values.length;
      rows[name] = hash(
        JSON.stringify(values.map((row) => JSON.stringify(row)).sort()),
      );
    }
    return {
      rows,
      counts,
      schema: db
        .prepare(
          "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE '_cf_%' ORDER BY type,name",
        )
        .all(),
      sequence: db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all(),
      fk: db.prepare('PRAGMA foreign_key_check').all(),
      ledger: db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),
      album: db
        .prepare(
          'SELECT workspace_id,project_id,state,revision FROM albums WHERE id=?',
        )
        .get(albumId),
      activationCommands: db
        .prepare('SELECT count(*) n FROM album_activation_commands')
        .get().n,
      activationAudits: db
        .prepare(
          "SELECT count(*) n FROM audit_events WHERE action='album.activated'",
        )
        .get().n,
    };
  } finally {
    db.close();
  }
}
function baseline(state) {
  assert.equal(state.ledger.length, 57);
  assert.equal(state.counts.workspaces, 1);
  assert.equal(state.counts.projects, 1);
  assert.equal(state.counts.albums, 1);
  assert.equal(state.counts.photos, 100);
  assert.equal(state.counts.photo_assets, 300);
  assert.equal(
    state.album.workspace_id,
    'bd927a6d-d5d3-4743-bbae-e4560cdda4c7',
  );
  assert.equal(state.album.project_id, '08954949-ae90-4353-be2f-ae4a8f40b78d');
  assert.equal(state.album.state, 'active');
  assert.equal(state.album.revision, 2);
  assert.equal(state.activationCommands, 1);
  assert.equal(state.activationAudits, 1);
  assert.deepEqual(state.fk, []);
}
function parity(before, after, ledgerExpected) {
  for (const [name, digest] of Object.entries(before.rows))
    if (name !== 'd1_migrations')
      assert.equal(after.rows[name], digest, 'old table changed: ' + name);
  const changedGuards = new Set([
    'guest_annotation_command_guard',
    'owner_annotation_command_insert_guard',
  ]);
  for (const object of before.schema)
    if (!changedGuards.has(object.name))
      assert.deepEqual(
        after.schema.find(
          (x) => x.type === object.type && x.name === object.name,
        ),
        object,
      );
  assert.deepEqual(
    after.sequence.filter((x) => x.name !== 'd1_migrations'),
    before.sequence.filter((x) => x.name !== 'd1_migrations'),
  );
  assert.deepEqual(after.album, before.album);
  assert.deepEqual(after.fk, []);
  assert.equal(after.ledger.length, ledgerExpected);
  assert.deepEqual(after.ledger.slice(0, 57), before.ledger);
  assert.equal(after.activationCommands, 1);
  assert.equal(after.activationAudits, 1);
}
async function api(path, init = {}) {
  assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, account);
  const config = await readFile(
    join(process.env.XDG_CONFIG_HOME, '.wrangler/config/default.toml'),
    'utf8',
  );
  const token = /oauth_token\s*=\s*"([^"]+)"/.exec(config)?.[1];
  assert.ok(token);
  const response = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' + account + path,
    {
      ...init,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.success)
    throw new Error('CLOUDFLARE_HTTP_' + response.status);
  return body.result;
}
async function runtime() {
  phase = 'runtime-settings';
  const settings = await api('/workers/scripts/kino-pic-staging/settings');
  assert.equal(settings.bindings.find((x) => x.name === 'DB').id, sourceId);
  assert.equal(
    settings.bindings.find((x) => x.name === 'PRIMARY_STORAGE').bucket_name,
    'kino-pick-staging-d3e93046',
  );
  const enabled = new Set([
    'DIRECT_UPLOAD_ENABLED',
    'CLOUDFLARE_IMAGE_PROCESSING_ENABLED',
    'ALBUM_ACTIVATION_ENABLED',
  ]);
  for (const binding of settings.bindings)
    if (binding.type === 'plain_text' && binding.name.endsWith('_ENABLED'))
      assert.equal(binding.text, enabled.has(binding.name) ? 'true' : 'false');
  phase = 'runtime-deployment';
  const deployment = (
    await api('/workers/scripts/kino-pic-staging/deployments')
  ).deployments[0];
  assert.equal(deployment.versions.length, 1);
  assert.equal(deployment.versions[0].version_id, baselineVersion);
  assert.equal(deployment.versions[0].percentage, 100);
  phase = 'runtime-entry';
  const entry = await api('/workers/scripts/kino-pic-staging/subdomain');
  assert.equal(entry.previews_enabled, false);
  return entry;
}
async function entry(enabled) {
  await api('/workers/scripts/kino-pic-staging/subdomain', {
    method: 'POST',
    body: JSON.stringify({ enabled, previews_enabled: false }),
  });
  const current = await api('/workers/scripts/kino-pic-staging/subdomain');
  assert.equal(current.enabled, enabled);
  assert.equal(current.previews_enabled, false);
}
let proof,
  phase = 'preflight',
  closed = false,
  applyAttempted = false;
function cli(label, args) {
  phase = label;
  const record = { label, exitCode: null };
  proof.commands.push(record);
  try {
    const output = execFileSync(
      process.execPath,
      [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 300000,
        windowsHide: true,
        stdio: 'pipe',
        env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
      },
    );
    record.exitCode = 0;
    return output;
  } catch {
    record.exitCode = 1;
    throw new Error('CLI_FAILED');
  }
}
async function config(path, id, name) {
  assert.ok(id !== sourceId || name === 'kino-pick-staging-d3e93046');
  await json(path, {
    name: 'kino-pick-migration-0059',
    account_id: account,
    compatibility_date: '2026-10-23',
    d1_databases: [
      {
        binding: 'DB',
        database_id: id,
        database_name: name,
        migrations_dir: join(root, 'migrations'),
      },
    ],
  });
  protect(path);
}
async function exported(label, cfg, name) {
  const path = join(proof.directory, name);
  cli(label, [
    'd1',
    'export',
    'DB',
    '--remote',
    '--config',
    cfg,
    '--output',
    path,
  ]);
  protect(path);
  const bytes = await readFile(path);
  return { path, sha256: hash(bytes), state: snapshot(bytes.toString('utf8')) };
}
try {
  const old = JSON.parse(
    await readFile(join(root, '.local/staging-0057-apply-proof.json'), 'utf8'),
  );
  assert.equal(old.status, 'passed_staging_0057_apply');
  const expected57 = snapshot(await readFile(old.afterBackup, 'utf8'));
  const migrations = (await readdir(join(root, 'migrations')))
    .filter((x) => /^005[89]_.*\.sql$/.test(x))
    .sort();
  assert.equal(migrations.length, 2);
  const upgrades = await Promise.all(
    migrations.map((name) => readFile(join(root, 'migrations', name), 'utf8')),
  );
  if (mode === '--inspect-local-backup') {
    const normalized = normalize(await readFile(old.afterBackup, 'utf8'));
    assert.deepEqual(snapshot(normalized.sql), expected57);
    console.log(
      JSON.stringify({
        status: 'passed_existing_57_backup_normalization',
        counts: normalized.counts,
        sourceWrites: 0,
      }),
    );
  } else if (mode === '--rehearse-B-only') {
    const previous = await runtime();
    proof = {
      status: 'started',
      accountId: account,
      sourceDatabaseId: sourceId,
      baselineVersion,
      previousPublic: previous.enabled,
      commands: [],
      migrationHashes: Object.fromEntries(
        migrations.map((name, i) => [name, hash(upgrades[i])]),
      ),
    };
    proof.directory = join(
      root,
      '.local',
      'collaboration-0059-' + randomUUID().slice(0, 8),
    );
    await mkdir(proof.directory);
    protect(proof.directory, true);
    proof.sourceConfig = join(proof.directory, 'source.json');
    await config(proof.sourceConfig, sourceId, 'kino-pick-staging-d3e93046');
    await json(statePath, proof);
    const before = await exported(
      'fresh-post-activation57-backup',
      proof.sourceConfig,
      'source57.sql',
    );
    baseline(before.state);
    assert.deepEqual(before.state.schema, expected57.schema);
    proof.beforeBackup = before.path;
    proof.beforeBackupSha256 = before.sha256;
    const normalized = normalize(await readFile(before.path, 'utf8'));
    assert.deepEqual(snapshot(normalized.sql), before.state);
    proof.reviewedBackupShape = normalized.counts;
    const localUpgrade = snapshot(normalized.sql, upgrades);
    parity(before.state, localUpgrade, 57);
    proof.localUpgradeParityPassed = true;
    const normalizedPath = join(proof.directory, 'source57-normalized.sql');
    await writeFile(normalizedPath, normalized.sql);
    protect(normalizedPath);
    proof.normalizedSha256 = hash(normalized.sql);
    const name = 'kino-pick-restore59-' + randomUUID().slice(0, 8);
    cli('create-new-independent-B-drill', [
      'd1',
      'create',
      name,
      '--config',
      proof.sourceConfig,
      '--update-config=false',
    ]);
    const target = (await api('/d1/database?per_page=100')).filter(
      (x) => x.name === name,
    );
    assert.equal(target.length, 1);
    proof.restoreDatabaseId = target[0].uuid;
    assert.notEqual(proof.restoreDatabaseId, sourceId);
    proof.restoreConfig = join(proof.directory, 'restore.json');
    await config(proof.restoreConfig, proof.restoreDatabaseId, name);
    await json(statePath, proof);
    const inventory = await api(
      '/d1/database/' + proof.restoreDatabaseId + '/query',
      {
        method: 'POST',
        body: JSON.stringify({
          sql: "SELECT count(*) n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
        }),
      },
    );
    assert.equal(inventory[0].results[0].n, 0);
    cli('restore-fresh57-to-new-empty-drill', [
      'd1',
      'execute',
      'DB',
      '--remote',
      '--config',
      proof.restoreConfig,
      '--file',
      normalizedPath,
      '--yes',
    ]);
    const restored = await exported(
      'readback-independent-restored57',
      proof.restoreConfig,
      'restored57.sql',
    );
    assert.deepEqual(restored.state, before.state);
    proof.restoreParityPassed = true;
    cli('upgrade-independent-drill59', [
      'd1',
      'migrations',
      'apply',
      'DB',
      '--remote',
      '--config',
      proof.restoreConfig,
    ]);
    const upgraded = await exported(
      'readback-independent-upgraded59',
      proof.restoreConfig,
      'restored59.sql',
    );
    parity(before.state, upgraded.state, 59);
    assert.equal(upgraded.state.counts.photographer_recommendation_commands, 0);
    proof.upgradedBackup = upgraded.path;
    proof.upgradedBackupSha256 = upgraded.sha256;
    proof.independentUpgradePassed = true;
    proof.status = 'passed_independent_0059_restore_upgrade';
    await json(statePath, proof);
    console.log(
      JSON.stringify({
        status: proof.status,
        sourceWrites: 0,
        restoreDatabaseId: proof.restoreDatabaseId,
        oldRowsPreserved: true,
        foreignKeyViolations: 0,
      }),
    );
  } else {
    proof = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(proof.status, 'passed_independent_0059_restore_upgrade');
    assert.equal(proof.accountId, account);
    assert.equal(proof.sourceDatabaseId, sourceId);
    assert.equal(
      hash(await readFile(proof.beforeBackup)),
      proof.beforeBackupSha256,
    );
    assert.equal(
      hash(await readFile(proof.upgradedBackup)),
      proof.upgradedBackupSha256,
    );
    assert.deepEqual(
      proof.migrationHashes,
      Object.fromEntries(
        migrations.map((name, i) => [name, hash(upgrades[i])]),
      ),
    );
    const ci = JSON.parse(
      await readFile(
        join(root, '.local/collaboration-release-ci-proof.json'),
        'utf8',
      ),
    );
    assert.equal(ci.status, 'completed');
    assert.equal(ci.conclusion, 'success');
    assert.equal(ci.headSha, process.env.KINO_PICK_RELEASE_SOURCE_SHA);
    assert.match(ci.headSha, /^[a-f0-9]{40}$/);
    assert.equal(
      execFileSync(
        'git',
        ['rev-parse', 'refs/heads/codex/cloudflare-b-deployment'],
        { cwd: resolve(root, '../..'), encoding: 'utf8' },
      ).trim(),
      ci.headSha,
    );
    const before = snapshot(await readFile(proof.beforeBackup, 'utf8'));
    baseline(before);
    const independent = snapshot(await readFile(proof.upgradedBackup, 'utf8'));
    parity(before, independent, 59);
    await runtime();
    await entry(false);
    closed = true;
    const fresh = await exported(
      'closed-fresh57-before-adoption',
      proof.sourceConfig,
      'source57-preapply.sql',
    );
    assert.deepEqual(fresh.state, before);
    applyAttempted = true;
    proof.sourceApplyAttempted = true;
    await json(statePath, proof);
    cli('adopt0058-and0059-B-staging-only', [
      'd1',
      'migrations',
      'apply',
      'DB',
      '--remote',
      '--config',
      proof.sourceConfig,
    ]);
    const after = await exported(
      'source59-after-adoption',
      proof.sourceConfig,
      'source59.sql',
    );
    parity(before, after.state, 59);
    for (const [name, digest] of Object.entries(independent.rows))
      if (name !== 'd1_migrations')
        assert.equal(after.state.rows[name], digest);
    assert.deepEqual(after.state.schema, independent.schema);
    assert.deepEqual(after.state.sequence, independent.sequence);
    assert.deepEqual(after.state.ledger, independent.ledger);
    await runtime();
    proof.status = 'passed_staging_0059_apply';
    proof.sourceSha = ci.headSha;
    proof.ciRunId = ci.runId;
    proof.afterBackup = after.path;
    proof.afterBackupSha256 = after.sha256;
    proof.migrationCount = 59;
    proof.foreignKeyViolations = 0;
    proof.oldProductTablesPreserved = Object.keys(before.rows).filter(
      (x) => x !== 'd1_migrations',
    ).length;
    proof.publicClosedDuringAdoption = true;
    if (proof.previousPublic) {
      await entry(true);
      closed = false;
    }
    await json(join(root, '.local/staging-0059-apply-proof.json'), proof);
    await json(statePath, proof);
    console.log(
      JSON.stringify({
        status: proof.status,
        migrationCount: 59,
        oldProductTablesPreserved: proof.oldProductTablesPreserved,
        ownerPilotRestored: proof.previousPublic,
      }),
    );
  }
} catch (failure) {
  const failureCode = /^[A-Z][A-Z0-9_]{2,80}$/.test(failure?.message ?? '')
    ? failure.message
    : failure?.code === 'ERR_ASSERTION'
      ? 'ASSERTION_FAILED'
      : 'SAFE_OPERATION_FAILURE';
  await json(join(root, '.local/collaboration-0059-last-failure.json'), {
    mode,
    phase,
    failureCode,
    sourceApplyAttempted: applyAttempted,
    publicClosed: closed,
  });
  if (proof) {
    proof.status = 'failed';
    proof.failedPhase = phase;
    proof.sourceApplyAttempted = applyAttempted;
    await json(statePath, proof);
    if (closed && !applyAttempted && proof.previousPublic) {
      try {
        await runtime();
        await entry(true);
        closed = false;
      } catch {}
    }
  }
  console.error(
    JSON.stringify({
      status: 'collaboration_migration_failed',
      failureCode,
      phase,
      sourceApplyAttempted: applyAttempted,
      publicClosed: closed,
      detailsWithheld: true,
    }),
  );
  process.exitCode = 1;
}
