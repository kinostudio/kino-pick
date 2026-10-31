import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { D1PhotographerRecommendationsRepository } from '../src/photographer-recommendations.ts';
import { applyMigration } from './apply-migration.mjs';

const base = 'http://127.0.0.1:8797';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  PHOTOGRAPHER_RECOMMENDATIONS_ENABLED: 'true',
  BETTER_AUTH_SECRET: 'photographer-d1-guards-secret-at-least-forty-characters',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-only-test-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-only-test-secret',
  R2_BUCKET_NAME: 'photographer-d1-guards',
};
const worker = (name, database) => ({
  name,
  modules: true,
  scriptPath: resolve('apps/worker/.build/index.js'),
  compatibilityDate: '2026-10-23',
  compatibilityFlags: ['nodejs_compat'],
  bindings,
  d1Databases: { DB: database },
  r2Buckets: { PRIMARY_STORAGE: 'photographer-d1-guards-' + name },
  assets: {
    directory: resolve('apps/worker/.static'),
    binding: 'ASSETS',
    run_worker_first: true,
    routerConfig: {
      has_user_worker: true,
      invoke_user_worker_ahead_of_assets: true,
    },
  },
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      worker('current', 'photographer-current'),
      worker('old', 'photographer-old'),
    ],
  }),
);
const checks = [];
const check = async (label, action) => {
  await action();
  checks.push(label);
  process.stdout.write('passed: ' + label + '\n');
};
const first = (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .first();
const count = async (db, table, where = '', ...values) =>
  Number(
    (await first(db, 'SELECT count(*) AS n FROM ' + table + where, ...values))
      .n,
  );
async function expectCode(action, code, label) {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, label + ': expected rejection');
  assert.equal(failure.code, code, label + ': ' + String(failure));
  return failure;
}
async function expectSqlFailure(action, text, label) {
  await assert.rejects(
    action,
    (error) => {
      assert.match(String(error), new RegExp(text));
      return true;
    },
    label,
  );
}
async function applyFiles(db, files) {
  for (const file of files)
    await applyMigration(
      db,
      await readFile(resolve('apps/worker/migrations', file), 'utf8'),
    );
}
async function seedOwnerAndAlbum(db) {
  const ownerId = randomUUID().toLowerCase();
  const sessionId = randomUUID().toLowerCase();
  const workspaceId = randomUUID().toLowerCase();
  const projectId = randomUUID().toLowerCase();
  const albumId = randomUUID().toLowerCase();
  const secondAlbumId = randomUUID().toLowerCase();
  const workspaceRequestId = randomUUID().toLowerCase();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(ownerId, 'photographer-d1-' + randomUUID())
    .run();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(sessionId, randomUUID(), ownerId, now + 3_600_000, now, now)
    .run();
  await db
    .prepare(
      'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
    )
    .bind(
      ownerId,
      workspaceRequestId,
      sessionId,
      'Photographer D1 guards',
      workspaceId,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
    )
    .bind(projectId, workspaceId, 'Photographer D1 guards')
    .run();
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(albumId, workspaceId, projectId, 'Photographer D1 guards')
    .run();
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(secondAlbumId, workspaceId, projectId, 'Photographer D1 rollback')
    .run();
  return {
    ownerId,
    sessionId,
    workspaceId,
    projectId,
    albumId,
    secondAlbumId,
    workspaceRequestId,
  };
}

try {
  const files = (await readdir(resolve('apps/worker/migrations')))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  const currentFiles = files.filter((name) => Number(name.slice(0, 4)) <= 59);
  const oldFiles = files.filter((name) => Number(name.slice(0, 4)) <= 58);
  assert.equal(
    currentFiles.length,
    59,
    'expected full migration chain through 0059',
  );
  assert.equal(oldFiles.length, 58, 'expected old schema through 0058');
  assert.equal(currentFiles.at(-1), '0059_photographer_recommendations.sql');

  const db = await mf.getD1Database('DB', 'current');
  const oldDb = await mf.getD1Database('DB', 'old');
  await applyFiles(db, currentFiles);
  await applyFiles(oldDb, oldFiles);

  const fixture = await seedOwnerAndAlbum(db);
  const repo = new D1PhotographerRecommendationsRepository(
    db,
    fixture.ownerId,
    fixture.sessionId,
    true,
  );
  await check(
    '0059 capability requires the full table and guard set; 0058 reads fail closed',
    async () => {
      assert.equal(await repo.capability(), true);
      const oldOwner = await seedOwnerAndAlbum(oldDb);
      const oldRepo = new D1PhotographerRecommendationsRepository(
        oldDb,
        oldOwner.ownerId,
        oldOwner.sessionId,
        true,
      );
      assert.equal(await oldRepo.capability(), false);
      await expectCode(
        () => oldRepo.read(oldOwner.albumId),
        'PHOTOGRAPHER_RECOMMENDATIONS_UNAVAILABLE',
        'old-schema read',
      );
    },
  );

  await check(
    'current Owner session and live album scope are required',
    async () => {
      const page = await repo.read(fixture.albumId);
      assert.deepEqual(page.policy, {
        albumId: fixture.albumId,
        revision: 0,
        visible: false,
        minRating: null,
        allowedLabels: [],
        matchMode: 'any',
      });
      await expectCode(
        () =>
          new D1PhotographerRecommendationsRepository(
            db,
            randomUUID(),
            randomUUID(),
            true,
          ).read(fixture.albumId),
        'OWNER_REQUIRED',
        'foreign actor/session',
      );
      await expectCode(
        () => repo.read(randomUUID()),
        'NOT_FOUND',
        'unknown tenant resource',
      );
    },
  );

  let firstPolicy;
  await check('policy CAS, exact replay and no-op audit behavior', async () => {
    const intent = {
      requestId: randomUUID(),
      expectedRevision: 0,
      visible: true,
      minRating: 4,
      allowedLabels: ['red'],
    };
    firstPolicy = await repo.setPolicy(fixture.albumId, intent);
    assert.equal(firstPolicy.changed, true);
    assert.equal(firstPolicy.policy.revision, 1);
    assert.equal(firstPolicy.policy.matchMode, 'any');
    assert.deepEqual(
      await repo.setPolicy(fixture.albumId, intent),
      firstPolicy,
    );
    assert.equal(await count(db, 'photographer_recommendation_commands'), 1);
    assert.equal(await count(db, 'photographer_recommendation_results'), 1);
    assert.equal(
      await count(
        db,
        'audit_events',
        " WHERE action='album.photographer_recommendations.changed'",
      ),
      1,
    );
    const noOp = await repo.setPolicy(fixture.albumId, {
      ...intent,
      requestId: randomUUID(),
      expectedRevision: 1,
    });
    assert.equal(noOp.changed, false);
    assert.equal(noOp.eventId, null);
    assert.equal(noOp.policy.revision, 1);
    assert.equal(await count(db, 'photographer_recommendation_commands'), 2);
    assert.equal(await count(db, 'photographer_recommendation_results'), 2);
    assert.equal(
      await count(
        db,
        'audit_events',
        " WHERE action='album.photographer_recommendations.changed'",
      ),
      1,
    );
    await expectCode(
      () =>
        repo.setPolicy(fixture.albumId, { ...intent, requestId: randomUUID() }),
      'PHOTOGRAPHER_RECOMMENDATION_REVISION_CONFLICT',
      'stale policy revision',
    );
    await expectCode(
      () =>
        repo.setPolicy(fixture.albumId, {
          ...intent,
          requestId: randomUUID(),
          expectedRevision: 1,
          minRating: 3.5,
        }),
      'INVALID_INPUT',
      'non-integer policy rating',
    );
  });

  await check(
    'request IDs are rejected in both directions across Owner ledgers',
    async () => {
      await expectCode(
        () =>
          repo.setPolicy(fixture.albumId, {
            requestId: fixture.workspaceRequestId,
            expectedRevision: 1,
            visible: true,
            minRating: 3,
            allowedLabels: ['red'],
          }),
        'REQUEST_ID_CONFLICT',
        'legacy request ID reused by recommendation ledger',
      );
      const featureCommand = await first(
        db,
        'SELECT request_id FROM photographer_recommendation_commands WHERE id=?',
        firstPolicy.eventId,
      );
      assert.ok(featureCommand?.request_id);
      await expectSqlFailure(
        () =>
          db
            .prepare(
              'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
            )
            .bind(
              fixture.ownerId,
              featureCommand.request_id,
              fixture.sessionId,
              'Collision attempt',
              randomUUID(),
            )
            .run(),
        'REQUEST_ID_CONFLICT',
        'recommendation request ID reused by workspace ledger',
      );
    },
  );

  await check(
    'migration integer CHECKs reject fractional policy and photo ratings',
    async () => {
      const policyRequestId = randomUUID();
      const policyPayload = JSON.stringify({
        requestId: policyRequestId,
        expectedRevision: 0,
        visible: true,
        minRating: 4.5,
        allowedLabels: [],
      });
      const emptyPolicy = JSON.stringify({
        albumId: fixture.secondAlbumId,
        revision: 0,
        visible: false,
        minRating: null,
        allowedLabels: [],
        matchMode: 'any',
      });
      await expectSqlFailure(
        () =>
          db
            .prepare(
              'INSERT INTO photographer_recommendation_commands(' +
                'id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,' +
                'expected_revision,visible,min_rating,allowed_labels_json,payload_json,before_json,created_at_ms' +
                ") VALUES(?,?,?,?,?,?,?,?,0,1,4.5,'[]',?,?,?)",
            )
            .bind(
              randomUUID(),
              fixture.ownerId,
              fixture.sessionId,
              policyRequestId,
              'album.photographer_recommendations.set',
              fixture.workspaceId,
              fixture.projectId,
              fixture.secondAlbumId,
              policyPayload,
              emptyPolicy,
              Date.now(),
            )
            .run(),
        'CHECK constraint failed',
        'fractional min_rating native D1 check',
      );

      const photoId = randomUUID();
      const versionId = randomUUID();
      await db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          photoId,
          fixture.workspaceId,
          fixture.projectId,
          fixture.secondAlbumId,
          'numeric-check.png',
        )
        .run();
      await db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,?,?,17,'image/png',1,1,'private')",
        )
        .bind(
          versionId,
          fixture.workspaceId,
          photoId,
          fixture.ownerId,
          'a'.repeat(64),
        )
        .run();
      const photoRequestId = randomUUID();
      const photoPayload = JSON.stringify({
        requestId: photoRequestId,
        expectedRevision: 0,
        expectedHeadRevision: 0,
        versionId,
        ratingState: 'set',
        ratingValue: 3.5,
        labelState: 'inherit',
        labelValue: null,
        decision: 'inherit',
      });
      await expectSqlFailure(
        () =>
          db
            .prepare(
              'INSERT INTO photographer_recommendation_commands(' +
                'id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,version_id,' +
                'expected_revision,expected_head_revision,rating_state,rating_value,label_state,label_value,decision,' +
                'payload_json,before_json,created_at_ms' +
                ") VALUES(?,?,?,?,?,?,?,?,?,?,0,0,'set',3.5,'inherit',NULL,'inherit',?,?,?)",
            )
            .bind(
              randomUUID(),
              fixture.ownerId,
              fixture.sessionId,
              photoRequestId,
              'photo.photographer_metadata.set',
              fixture.workspaceId,
              fixture.projectId,
              fixture.secondAlbumId,
              photoId,
              versionId,
              photoPayload,
              '{}',
              Date.now(),
            )
            .run(),
        'CHECK constraint failed',
        'fractional rating_value native D1 check',
      );
    },
  );

  await check(
    'append-only ledgers reject mutation and audit injection rolls back the full batch',
    async () => {
      const policyCommand = await first(
        db,
        "SELECT id,request_id FROM photographer_recommendation_commands WHERE operation='album.photographer_recommendations.set' ORDER BY created_at_ms LIMIT 1",
      );
      const result = await first(
        db,
        'SELECT command_id FROM photographer_recommendation_results WHERE command_id=?',
        policyCommand.id,
      );
      await expectSqlFailure(
        () =>
          db
            .prepare(
              'UPDATE photographer_recommendation_commands SET payload_json=payload_json WHERE id=?',
            )
            .bind(policyCommand.id)
            .run(),
        'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_COMMAND',
        'command update guard',
      );
      await expectSqlFailure(
        () =>
          db
            .prepare(
              'DELETE FROM photographer_recommendation_results WHERE command_id=?',
            )
            .bind(result.command_id)
            .run(),
        'IMMUTABLE_PHOTOGRAPHER_RECOMMENDATION_RESULT',
        'result delete guard',
      );
      await db.exec(
        "CREATE TRIGGER photographer_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='album.photographer_recommendations.changed' BEGIN SELECT RAISE(ABORT,'INJECTED_PHOTOGRAPHER_AUDIT_FAILURE'); END",
      );
      const failedRequestId = randomUUID();
      await expectCode(
        () =>
          repo.setPolicy(fixture.secondAlbumId, {
            requestId: failedRequestId,
            expectedRevision: 0,
            visible: true,
            minRating: 2,
            allowedLabels: [],
          }),
        'PHOTOGRAPHER_RECOMMENDATIONS_UNAVAILABLE',
        'injected audit failure',
      );
      await db.exec('DROP TRIGGER photographer_test_audit_failure');
      assert.equal(
        await count(
          db,
          'photographer_recommendation_commands',
          ' WHERE request_id=?',
          failedRequestId,
        ),
        0,
      );
      assert.equal(await count(db, 'photographer_recommendation_results'), 2);
      assert.equal(
        await count(
          db,
          'audit_events',
          " WHERE action='album.photographer_recommendations.changed'",
        ),
        1,
      );
      assert.equal(
        await first(
          db,
          'SELECT album_id FROM album_photographer_recommendation_policy WHERE album_id=?',
          fixture.secondAlbumId,
        ),
        null,
      );
    },
  );

  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
  process.stdout.write(
    'passed: ' + checks.length + ' focused native D1 groups\n',
  );
} finally {
  await mf.dispose();
}
