import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { normalizeHostedBackupSql } from './rehearse-hosted-d1-restore.mjs';
const worker = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(worker, '.local');
const backup = join(local, 'hosted-100-backup-20261031');
const account = 'd3e930465c0df7e89b35de3ca65ea36a';
const source = 'kino-pick-staging-d3e93046',
  target = 'kino-pick-restore100-20261031';
const scope =
  'bd927a6d-d5d3-4743-bbae-e4560cdda4c7/08954949-ae90-4353-be2f-ae4a8f40b78d/613487da-e6ff-4ada-9b66-949f21fcfa2c/';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n');
const safeAssert = (c, s) => {
  if (!c) throw new Error(s);
};
let phase = 'preflight';
let restoreLock;
try {
  assert.deepEqual(process.argv.slice(2), ['--backup-restore-synthetic-only']);
  assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, account);
  const raw = await readFile(join(backup, 'database.sql'));
  const proof = await json(join(backup, 'backup-proof.json'));
  assert.equal(sha(raw), proof.sha256);
  const db = new DatabaseSync(':memory:');
  db.exec('BEGIN;');
  db.exec(normalizeHostedBackupSql(raw.toString('utf8')));
  db.exec('COMMIT;');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM d1_migrations').get().n,
    56,
  );
  const rows = db
    .prepare(
      'SELECT asset_kind,object_key,byte_size,mime,checksum_sha256,photo_id,version_id,storage_node_id FROM photo_assets ORDER BY object_key',
    )
    .all()
    .map((x) => ({ ...x }));
  assert.equal(rows.length, 300);
  assert.ok(
    rows.every(
      (r) =>
        r.object_key.startsWith(scope) &&
        r.storage_node_id === 'primary' &&
        r.byte_size > 0 &&
        r.byte_size <= 16 * 1024 * 1024 &&
        /^[a-f0-9]{64}$/.test(r.checksum_sha256),
    ),
  );
  assert.equal(new Set(rows.map((r) => r.object_key)).size, 300);
  const manifest = await json(join(local, 'hosted-upload-assets.json'));
  assert.deepEqual(
    rows.map((r) => JSON.stringify(r)).sort(),
    manifest
      .map((r) =>
        JSON.stringify(
          Object.fromEntries(Object.keys(rows[0]).map((k) => [k, r[k]])),
        ),
      )
      .sort(),
  );
  assert.equal(
    db
      .prepare('SELECT sum(reserved_bytes) AS n FROM workspace_storage_usage')
      .get().n,
    0,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM image_processing_jobs WHERE status<>'succeeded'",
      )
      .get().n,
    0,
  );
  db.close();
  restoreLock = await open(join(backup, 'r2-restore.lock'), 'wx');
  const cfg = process.env.XDG_CONFIG_HOME;
  assert.ok(cfg?.endsWith('kino-pic-wrangler-isolated-config'));
  const toml = await readFile(
    join(cfg, '.wrangler/config/default.toml'),
    'utf8',
  );
  const token = /oauth_token\s*=\s*"([^\"]+)"/.exec(toml)?.[1];
  assert.ok(token);
  const api = 'https://api.cloudflare.com/client/v4/accounts/' + account;
  async function request(tail, options = {}) {
    try {
      return await fetch(api + tail, {
        ...options,
        headers: { Authorization: 'Bearer ' + token, ...options.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error('CF_NETWORK_FAILED');
    }
  }
  async function data(tail, options = {}) {
    const r = await request(tail, options);
    let j;
    try {
      j = await r.json();
    } catch {
      throw new Error('CF_JSON_FAILED');
    }
    safeAssert(r.ok && j.success === true, 'CF_API_' + r.status);
    return j.result;
  }
  const owner = await data('');
  assert.equal(owner.id, account);
  const bucketTail = (b) => '/r2/buckets/' + b;
  const objectTail = (b, key) =>
    bucketTail(b) +
    '/objects/' +
    key.split('/').map(encodeURIComponent).join('/');
  async function bytes(r, n) {
    safeAssert(r.ok, 'R2_READ_' + r.status);
    const rd = r.body?.getReader();
    safeAssert(rd, 'R2_BODY_ABSENT');
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const v = await rd.read();
        if (v.done) break;
        size += v.value.length;
        if (size > n) {
          await rd.cancel();
          throw new Error('R2_SIZE_EXCEEDED');
        }
        chunks.push(Buffer.from(v.value));
      }
    } finally {
      rd.releaseLock();
    }
    safeAssert(size === n, 'R2_SIZE_MISMATCH');
    return Buffer.concat(chunks);
  }
  await data(bucketTail(source));
  phase = 'backup';
  await mkdir(join(backup, 'objects'), { recursive: true });
  let total = 0,
    count = 0;
  for (const row of rows) {
    const p = join(backup, 'objects', row.checksum_sha256 + '.bin');
    let content;
    try {
      content = await readFile(p);
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error('LOCAL_BACKUP_READ_FAILED');
      content = await bytes(
        await request(objectTail(source, row.object_key)),
        row.byte_size,
      );
      assert.equal(sha(content), row.checksum_sha256);
      await writeFile(p, content, { flag: 'wx' });
    }
    assert.equal(content.length, row.byte_size);
    assert.equal(sha(content), row.checksum_sha256);
    total += content.length;
    if (++count % 50 === 0)
      console.log('Backed up ' + count + '/300 synthetic objects');
  }
  await save(join(backup, 'r2-backup-manifest.json'), {
    accountId: account,
    sourceBucket: source,
    databaseSha256: proof.sha256,
    rows,
    totalBytes: total,
    completedAt: new Date().toISOString(),
  });
  phase = 'restore-target';
  const targetStatePath = join(backup, 'r2-restore-target.json');
  let state;
  try {
    state = await json(targetStatePath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('RESTORE_STATE_INVALID');
  }
  const exists = await request(bucketTail(target));
  if (!state) {
    safeAssert(exists.status === 404, 'RESTORE_BUCKET_ALREADY_EXISTS');
    await exists.body?.cancel();
    const created = await data('/r2/buckets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: target }),
    });
    assert.equal(created.name, target);
    state = {
      accountId: account,
      bucket: target,
      createdByThisDrill: true,
      createdAt: new Date().toISOString(),
    };
    await save(targetStatePath, state);
  } else {
    assert.equal(state.accountId, account);
    assert.equal(state.bucket, target);
    assert.equal(state.createdByThisDrill, true);
    safeAssert(exists.ok, 'RESTORE_BUCKET_MISSING');
    await exists.body?.cancel();
  }
  const managed = await data(bucketTail(target) + '/domains/managed');
  assert.equal(managed.enabled, false);
  const domains = await data(bucketTail(target) + '/domains/custom');
  assert.deepEqual(domains.domains, []);
  phase = 'restore-objects';
  count = 0;
  for (const row of rows) {
    const body = await readFile(
      join(backup, 'objects', row.checksum_sha256 + '.bin'),
    );
    assert.equal(sha(body), row.checksum_sha256);
    const prior = await request(objectTail(target, row.object_key));
    if (prior.status === 404) {
      await prior.body?.cancel();
      const put = await request(objectTail(target, row.object_key), {
        method: 'PUT',
        headers: {
          'Content-Type': row.mime,
          'Content-Length': String(body.length),
          'If-None-Match': '*',
        },
        body,
      });
      safeAssert(put.ok, 'R2_RESTORE_WRITE_' + put.status);
      await put.body?.cancel();
      const restored = await bytes(
        await request(objectTail(target, row.object_key)),
        row.byte_size,
      );
      assert.equal(sha(restored), row.checksum_sha256);
    } else {
      const restored = await bytes(prior, row.byte_size);
      assert.equal(sha(restored), row.checksum_sha256);
    }
    if (++count % 50 === 0)
      console.log('Restored and verified ' + count + '/300 synthetic objects');
  }
  const final = {
    status: 'passed_independent_private_r2_restore',
    checkedAt: new Date().toISOString(),
    accountId: account,
    sourceBucket: source,
    restoreBucket: target,
    objects: 300,
    totalBytes: total,
    databaseSha256: proof.sha256,
    manifestSha256: sha(
      await readFile(join(backup, 'r2-backup-manifest.json')),
    ),
    managedPublicAccess: false,
    customDomains: 0,
    sourceWrites: 0,
    sourceDeletes: 0,
    restoreDeletes: 0,
  };
  await save(join(backup, 'r2-restore-proof.json'), final);
  console.log(JSON.stringify(final));
} catch (error) {
  const location =
    /rehearse-hosted-r2-restore\.mjs:(\d+):(\d+)/
      .exec(error.stack ?? '')
      ?.slice(1)
      .join(':') ?? 'unknown';
  console.error('Safe diagnostic location ' + location);
  const reason =
    /no such (?:table|function|column): [A-Za-z0-9_.]+/.exec(
      error.message ?? '',
    )?.[0] ??
    /FOREIGN KEY constraint failed|CHECK constraint failed|UNIQUE constraint failed|syntax error|not authorized|too many levels of trigger recursion/.exec(
      error.message ?? '',
    )?.[0] ??
    error.code ??
    'unclassified';
  console.error('Safe diagnostic class ' + reason);
  await save(join(backup, 'r2-restore-failure.json'), {
    status: 'failed',
    phase,
    checkedAt: new Date().toISOString(),
  });
  console.error(
    'Synthetic backup/restore failed in phase ' +
      phase +
      '; provider output withheld.',
  );
  process.exitCode = 1;
} finally {
  if (restoreLock) {
    await restoreLock.close();
    await unlink(join(backup, 'r2-restore.lock'));
  }
}
