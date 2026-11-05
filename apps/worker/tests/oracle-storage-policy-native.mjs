import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigration } from './apply-migration.mjs';
import {
  readOraclePolicy,
  saveOraclePolicy,
} from '../src/oracle-storage-policy.ts';

const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'oracle-policy',
        modules: true,
        script:
          'export default {fetch(){return new Response(null,{status:404})}}',
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'oracle-policy' },
      },
    ],
  }),
);
try {
  const db = await mf.getD1Database('DB', 'oracle-policy');
  const owner = randomUUID(),
    session = randomUUID(),
    workspace = randomUUID();
  const env = {
    DB: db,
    APP_ENV: 'local',
    APP_URL: 'http://localhost:4196',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    ORACLE_STORAGE_ADMIN_USER_ID: owner,
  };
  await assert.rejects(
    () => readOraclePolicy(env, randomUUID()),
    (error) => error.code === 'NOT_FOUND',
  );
  const files = (await readdir(resolve('apps/worker/migrations')))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const file of files.filter((name) => Number(name.slice(0, 4)) <= 63))
    await applyMigration(
      db,
      await readFile(resolve('apps/worker/migrations', file), 'utf8'),
    );
  await assert.rejects(
    () => readOraclePolicy(env, owner),
    (error) => error.code === 'STORAGE_POLICY_UNAVAILABLE',
  );
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'oracle-policy-' + randomUUID())
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      session,
      randomBytes(32).toString('hex'),
      owner,
      now + 3600000,
      now,
      now,
    )
    .run();
  await db
    .prepare(
      'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
    )
    .bind(owner, randomUUID(), session, 'Oracle policy fixture', workspace)
    .run();
  const before = await db
    .prepare(
      'SELECT id,name,owner_user_id,quota_bytes FROM workspaces WHERE id=?',
    )
    .bind(workspace)
    .first();
  await applyMigration(
    db,
    await readFile(
      resolve('apps/worker/migrations/0064_oracle_storage_policy.sql'),
      'utf8',
    ),
  );
  assert.deepEqual(
    await db
      .prepare(
        'SELECT id,name,owner_user_id,quota_bytes FROM workspaces WHERE id=?',
      )
      .bind(workspace)
      .first(),
    before,
  );
  const initial = await readOraclePolicy(env, owner);
  assert.equal(initial.quotaGb, 30);
  assert.equal(initial.requestedEnabled, false);
  assert.equal(initial.effectiveEnabled, false);
  const intent = {
    requestId: randomUUID(),
    expectedRevision: 0,
    enabled: true,
    quotaGb: 30,
  };
  let result = await saveOraclePolicy(env, owner, session, intent);
  assert.equal(result.requestedEnabled, true);
  assert.equal(result.effectiveEnabled, false);
  assert.equal(result.revision, 1);
  const policyAudit = await db
    .prepare(
      "SELECT before_json,after_json FROM audit_events WHERE action='storage.oracle_policy_changed'",
    )
    .first();
  assert.equal(JSON.parse(policyAudit.before_json).requestedEnabled, 0);
  assert.equal(JSON.parse(policyAudit.after_json).requestedEnabled, 1);
  await saveOraclePolicy(env, owner, session, intent);
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action='storage.oracle_policy_changed'",
        )
        .first()
    ).n,
    1,
  );
  await assert.rejects(
    () => saveOraclePolicy(env, owner, session, { ...intent, quotaGb: 31 }),
    (error) => error.code === 'REQUEST_ID_CONFLICT',
  );
  await assert.rejects(
    () =>
      saveOraclePolicy(env, owner, session, {
        ...intent,
        requestId: randomUUID(),
      }),
    (error) => error.code === 'STORAGE_POLICY_CONFLICT',
  );
  await assert.rejects(() =>
    db
      .prepare(
        'UPDATE oracle_storage_policy SET quota_bytes=1000000000 WHERE id=1',
      )
      .run(),
  );
  result = await saveOraclePolicy(env, owner, session, {
    requestId: randomUUID(),
    expectedRevision: 1,
    enabled: true,
    quotaGb: 35,
  });
  assert.equal(result.quotaGb, 35);
  result = await saveOraclePolicy(env, owner, session, {
    requestId: randomUUID(),
    expectedRevision: 2,
    enabled: true,
    quotaGb: 30,
  });
  assert.equal(result.quotaGb, 30);
  await assert.rejects(
    () =>
      saveOraclePolicy(env, owner, 'invalid-session', {
        requestId: randomUUID(),
        expectedRevision: 3,
        enabled: true,
        quotaGb: 30,
      }),
    (error) => error.code === 'OWNER_REQUIRED',
  );
  await db
    .prepare(
      "INSERT INTO storage_nodes(id,provider,account_id,bucket_name,endpoint,credential_ref,status,priority,quota_bytes,used_bytes,reserved_bytes) VALUES('oracle-vm','s3','oracle','kino-pick-overflow','https://drive.kinostudio.tw','env:ORACLE_STORAGE','readonly',2,30000000000,20000000000,1000000000)",
    )
    .run();
  await assert.rejects(
    () =>
      saveOraclePolicy(env, owner, session, {
        requestId: randomUUID(),
        expectedRevision: 3,
        enabled: true,
        quotaGb: 20,
      }),
    (error) => error.code === 'STORAGE_POLICY_BELOW_USAGE',
  );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  console.log(
    'passed: native 0064 populated upgrade, 30GB dynamic policy, requested/effective separation, replay/CAS/ACL/audit/usage floor and FK',
  );
} finally {
  await mf.dispose();
}
