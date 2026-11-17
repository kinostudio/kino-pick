import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  restoreProductionExport,
  summarizeProductionDatabase,
} from './rehearse-production-copy.mjs';
const root = new URL('../../../', import.meta.url);
const dir = new URL('../.local/owner-feedback-0071-20261116/', import.meta.url);
const cli = fileURLToPath(
  new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestUrl = new URL(
  'docs/releases/production-schema-adoptions.json',
  root,
);
const manifest = JSON.parse(await readFile(manifestUrl));
const names = [
  '0071_owner_album_feedback.sql',
  '0072_browser_first_processing.sql',
  '0073_workspace_management.sql',
];
const proofs = ['owner-feedback-0071', 'browser-first-0072', 'workspace-0073'];
function wrangler(args, log) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
  return writeFile(
    new URL(log, dir),
    result.stdout + '\n' + result.stderr,
  ).then(() => {
    assert.equal(result.status, 0, 'WRANGLER_FAILED_' + log);
    return result.stdout;
  });
}
for (let i = 0; i < names.length; i++) {
  const version = 71 + i,
    name = names[i];
  if (manifest.adoptions.some((entry) => entry.name === name)) continue;
  const proof = JSON.parse(
    await readFile(
      new URL('docs/releases/' + proofs[i] + '-independent-restore.json', root),
    ),
  );
  const migration = await readFile(
    new URL('apps/worker/migrations/' + name, root),
  );
  assert.equal(sha(migration), proof.migration.sha256);
  const cfg = JSON.parse(await readFile(new URL('live71.config.json', dir)));
  assert.equal(cfg.account_id, 'd3e930465c0df7e89b35de3ca65ea36a');
  assert.equal(
    cfg.d1_databases[0].database_id,
    '65d2286e-f2ac-4ad2-90e2-4b31e2f24251',
  );
  const migrationDir = new URL('live-only-' + version + '/', dir);
  await mkdir(migrationDir, { recursive: true });
  await writeFile(new URL(name, migrationDir), migration);
  cfg.d1_databases[0].migrations_dir = fileURLToPath(migrationDir);
  const config = fileURLToPath(
    new URL('adopt-live' + version + '.config.json', dir),
  );
  await writeFile(config, JSON.stringify(cfg));
  const beforeFile = fileURLToPath(
    new URL('adopt' + version + '-before.sql', dir),
  );
  await wrangler(
    [
      'd1',
      'export',
      'DB',
      '--remote',
      '--config',
      config,
      '--output',
      beforeFile,
    ],
    'adopt' + version + '-before-export.log',
  );
  const before = restoreProductionExport(await readFile(beforeFile, 'utf8')).db;
  const beforeSummary = summarizeProductionDatabase(before);
  assert.equal(beforeSummary.productSchemaSha256, proof.schemaSha256Before);
  assert.equal(
    before.prepare('SELECT count(*) n FROM d1_migrations').get().n,
    version - 1,
  );
  before.close();
  const bookmark = JSON.parse(
    await wrangler(
      ['d1', 'time-travel', 'info', 'DB', '--config', config, '--json'],
      'adopt' + version + '-bookmark.log',
    ),
  );
  assert.ok(typeof bookmark.bookmark === 'string' && bookmark.bookmark.length);
  await wrangler(
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config],
    'adopt' + version + '-apply.log',
  );
  const afterFile = fileURLToPath(
    new URL('adopt' + version + '-after.sql', dir),
  );
  await wrangler(
    [
      'd1',
      'export',
      'DB',
      '--remote',
      '--config',
      config,
      '--output',
      afterFile,
    ],
    'adopt' + version + '-after-export.log',
  );
  const after = restoreProductionExport(await readFile(afterFile, 'utf8')).db;
  const summary = summarizeProductionDatabase(after);
  assert.equal(summary.productSchemaSha256, proof.schemaSha256After);
  assert.equal(
    after.prepare('SELECT count(*) n FROM d1_migrations').get().n,
    version,
  );
  assert.deepEqual(after.prepare('PRAGMA foreign_key_check').all(), []);
  // Independent populated restore proves migration row preservation; live traffic may add rows during exports.
  assert.equal(proof.preExistingTableDataUnchanged, true);
  after.close();
  manifest.adoptions.push({
    name,
    sha256: sha(migration),
    databaseId: cfg.d1_databases[0].database_id,
    approvedBy:
      'user explicit 0071-0073 production migration instruction 2026-11-17',
    appliedAt: new Date().toISOString(),
    schemaSha256Before: proof.schemaSha256Before,
    schemaSha256After: proof.schemaSha256After,
    productSchemaObjectCountAfter: proof.productSchemaObjectCountAfter,
    localRehearsalSchemaSha256After: proof.schemaSha256After,
    timeTravelBookmarkBefore: bookmark.bookmark,
    preExistingTableDataUnchanged: true,
    dataParityMethod:
      'Independent populated restore preserves pre-existing rows; live schema and ledger match independently verified migration. Live exports include concurrent traffic and are not claimed row-identical.',
    foreignKeyViolations: 0,
    ledgerRecorded: true,
  });
  await writeFile(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
  console.log('VERIFIED_LIVE_SCHEMA_' + version);
}
