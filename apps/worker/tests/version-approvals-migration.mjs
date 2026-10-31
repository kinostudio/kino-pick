import { applyMigration } from './apply-migration.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeSignature } from 'better-auth/crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';
import { pngFixture } from './image-fixtures.mjs';

const base = 'http://127.0.0.1:8796';
const owner = randomUUID();
const ownerSessionId = randomUUID();
const ownerToken = randomUUID();
const authSecret =
  'version-approvals-migration-isolated-test-secret-at-least-forty-characters';
const temporary = await mkdtemp(join(tmpdir(), 'kino-version-approvals-'));
const migrationsDirectory = resolve('migrations');
const bindingValues = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_SELECTION_ENABLED: 'true',
  GUEST_DOWNLOADS_ENABLED: 'true',
  GUEST_FEEDBACK_ENABLED: 'true',
  GUEST_SHARED_SELECTION_ENABLED: 'true',
  VERSION_APPROVALS_ENABLED: 'false',
  BETTER_AUTH_SECRET: authSecret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-version-approval-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-never-for-production',
  R2_BUCKET_NAME: 'kino-version-approval-test-private',
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: bindingValues,
        d1Databases: { DB: 'version-approvals-isolated' },
        r2Buckets: { PRIMARY_STORAGE: 'version-approvals-isolated' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
      },
    ],
    d1Persist: join(temporary, 'd1'),
    r2Persist: join(temporary, 'r2'),
  }),
);

let passed = 0;
async function check(label, action) {
  await action();
  passed++;
  process.stdout.write('passed: ' + label + '\n');
}

const count = async (db, table, where = '', ...values) => {
  const sql = 'SELECT count(*) AS count FROM ' + table + where;
  const row = await db
    .prepare(sql)
    .bind(...values)
    .first();
  return Number(row.count);
};
const first = async (db, sql, ...values) =>
  db
    .prepare(sql)
    .bind(...values)
    .first();
async function expectD1Failure(action, code) {
  let failure;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'expected D1 operation to fail with ' + code);
  assert.match(String(failure), new RegExp(code));
}
const snapshot = async (db) => {
  const tables = [
    'version_approval_owner_commands',
    'version_approval_requests',
    'version_approval_request_invites',
    'version_approval_request_seals',
    'version_approval_owner_results',
    'version_approval_guest_commands',
    'version_approval_receipts',
    'version_approval_guest_results',
  ];
  const result = {};
  for (const table of tables) result[table] = await count(db, table);
  result.ownerAudit = await count(
    db,
    'audit_events',
    " WHERE action='version_approval.requested'",
  );
  result.guestAudit = await count(
    db,
    'audit_events',
    " WHERE action='version_approval.confirmed'",
  );
  return result;
};

function ownerCommand(db, values) {
  const requestId = values.requestId ?? randomUUID();
  const commandId = values.commandId ?? randomUUID();
  const resourceId = values.resourceId ?? randomUUID();
  const sessionId = values.sessionId ?? ownerSessionId;
  const inviteIds = values.inviteIds;
  const revision = values.revision;
  const versionId = values.versionId;
  const createdAt = values.createdAt ?? Date.now();
  const payload = JSON.stringify({
    requestId,
    expectedOwnerId: owner,
    expectedHead: { versionId, revision },
    inviteIds,
    confirm: true,
  });
  const statement = db.prepare(
    'INSERT INTO version_approval_owner_commands(' +
      'id,actor_id,expected_owner_id,session_id,request_id,workspace_id,' +
      'project_id,album_id,photo_id,version_id,head_revision,' +
      'request_resource_id,invite_ids_json,confirm,payload_json,created_at_ms' +
      ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
  );
  return {
    requestId,
    commandId,
    resourceId,
    statement: statement.bind(
      commandId,
      owner,
      owner,
      sessionId,
      requestId,
      values.workspaceId,
      values.projectId,
      values.albumId,
      values.photoId,
      versionId,
      revision,
      resourceId,
      JSON.stringify(inviteIds),
      payload,
      createdAt,
    ),
  };
}

function guestCommand(db, values) {
  const requestId = values.requestId ?? randomUUID();
  const commandId = values.commandId ?? randomUUID();
  const createdAt = values.createdAt ?? Date.now();
  const payload =
    values.payload ??
    JSON.stringify({
      requestId,
      expectedGuestId: values.guest.guestId,
      confirm: true,
    });
  const statement = db.prepare(
    'INSERT INTO version_approval_guest_commands(' +
      'id,guest_id,expected_guest_id,invite_id,session_id,request_id,' +
      'approval_request_id,workspace_id,project_id,album_id,photo_id,' +
      'version_id,head_revision,payload_json,created_at_ms' +
      ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  return {
    requestId,
    commandId,
    statement: statement.bind(
      commandId,
      values.guest.guestId,
      values.expectedGuestId ?? values.guest.guestId,
      values.guest.inviteId,
      values.sessionId ?? values.guest.sessionId,
      requestId,
      values.approvalRequestId,
      values.workspaceId,
      values.projectId,
      values.albumId,
      values.photoId,
      values.versionId,
      values.revision,
      payload,
      createdAt,
    ),
  };
}

try {
  const db = await mf.getD1Database('DB', 'app');
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  assert.ok(
    migrationFiles.includes('0054_version_approvals.sql'),
    'expected source-only migration 0054 to be present',
  );
  for (const file of migrationFiles) {
    const source = (await readFile(join(migrationsDirectory, file), 'utf8'))
      .split(/\r?\n/u)
      .filter((line) => line.trim() && !line.trim().startsWith('--'))
      .join(' ');
    await applyMigration(db, source);
  }
  await check(
    'native workerd D1 applies the full migration chain through 0054',
    async () => {
      const objects = await db
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type IN('table','trigger') AND name LIKE 'version_approval_%'",
        )
        .first();
      assert.ok(Number(objects.count) >= 40);
    },
  );

  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'version-approval-isolated-owner')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(ownerSessionId, ownerToken, owner, now + 3_600_000, now, now)
    .run();
  const ownerCookie =
    'kino-owner.session_token=' +
    encodeURIComponent(
      ownerToken + '.' + (await makeSignature(ownerToken, authSecret)),
    );
  const worker = await mf.getWorker('app');
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
  const fixtureResult = await guestDownloadChecks({
    db,
    worker,
    request,
    owner,
    ownerSessionId,
    ownerCookie,
    base,
    storage,
    fixtureOnly: true,
  });
  const fixture = fixtureResult.fixture;
  const initialGuest = await fixture.createGuest(2049);
  const revokedGuest = await fixture.createGuest(2049);
  const scope = {
    workspaceId: fixture.workspaceId,
    projectId: fixture.projectId,
    albumId: fixture.albumId,
    photoId: fixture.photoId,
  };

  const initialRequest = ownerCommand(db, {
    ...scope,
    versionId: fixture.versionId,
    revision: 0,
    inviteIds: [initialGuest.inviteId],
  });
  await initialRequest.statement.run();
  await check(
    'Owner command atomically creates sealed request, result, and audit',
    async () => {
      const requestRow = await first(
        db,
        'SELECT owner_id,version_id,head_revision,version_no FROM version_approval_requests WHERE id=?',
        initialRequest.resourceId,
      );
      assert.deepEqual(requestRow, {
        owner_id: owner,
        version_id: fixture.versionId,
        head_revision: 0,
        version_no: 1,
      });
      assert.equal(
        await count(
          db,
          'version_approval_request_invites',
          ' WHERE approval_request_id=?',
          initialRequest.resourceId,
        ),
        1,
      );
      assert.equal(
        await count(
          db,
          'version_approval_request_seals',
          ' WHERE approval_request_id=?',
          initialRequest.resourceId,
        ),
        1,
      );
      assert.equal(
        await count(
          db,
          'version_approval_owner_results',
          ' WHERE command_id=?',
          initialRequest.commandId,
        ),
        1,
      );
      assert.equal(
        await count(
          db,
          'audit_events',
          " WHERE event_id=? AND action='version_approval.requested'",
          initialRequest.commandId,
        ),
        1,
      );
    },
  );

  await check(
    'same-session exact Owner replay is ignored; changed body and session conflict',
    async () => {
      const before = await snapshot(db);
      await ownerCommand(db, {
        ...scope,
        requestId: initialRequest.requestId,
        resourceId: initialRequest.resourceId,
        versionId: fixture.versionId,
        revision: 0,
        inviteIds: [initialGuest.inviteId],
      }).statement.run();
      assert.deepEqual(await snapshot(db), before);

      const changed = ownerCommand(db, {
        ...scope,
        requestId: initialRequest.requestId,
        resourceId: initialRequest.resourceId,
        versionId: fixture.versionId,
        revision: 0,
        inviteIds: [initialGuest.inviteId, revokedGuest.inviteId],
      });
      await expectD1Failure(
        () => changed.statement.run(),
        'REQUEST_ID_CONFLICT',
      );

      const otherOwnerSessionId = randomUUID();
      const otherOwnerToken = randomUUID();
      const sessionNow = Date.now();
      await db
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          otherOwnerSessionId,
          otherOwnerToken,
          owner,
          sessionNow + 3_600_000,
          sessionNow,
          sessionNow,
        )
        .run();
      const changedSession = ownerCommand(db, {
        ...scope,
        requestId: initialRequest.requestId,
        resourceId: initialRequest.resourceId,
        sessionId: otherOwnerSessionId,
        versionId: fixture.versionId,
        revision: 0,
        inviteIds: [initialGuest.inviteId],
      });
      await expectD1Failure(
        () => changedSession.statement.run(),
        'REQUEST_ID_CONFLICT',
      );
    },
  );

  await check(
    'Owner audit failure rolls back command, request, membership, seal, and result',
    async () => {
      const failed = ownerCommand(db, {
        ...scope,
        versionId: fixture.versionId,
        revision: 0,
        inviteIds: [initialGuest.inviteId],
      });
      const before = await snapshot(db);
      await db.exec(
        "CREATE TRIGGER version_approval_test_fail_owner_audit BEFORE INSERT ON audit_events WHEN NEW.action='version_approval.requested' BEGIN SELECT RAISE(ABORT,'INJECTED_OWNER_AUDIT_FAILURE'); END",
      );
      try {
        await expectD1Failure(
          () => failed.statement.run(),
          'INJECTED_OWNER_AUDIT_FAILURE',
        );
      } finally {
        await db.exec('DROP TRIGGER version_approval_test_fail_owner_audit');
      }
      assert.deepEqual(await snapshot(db), before);
    },
  );

  const firstGuestCommand = guestCommand(db, {
    guest: initialGuest,
    approvalRequestId: initialRequest.resourceId,
    ...scope,
    versionId: fixture.versionId,
    revision: 0,
  });
  await check(
    'Guest audit failure rolls back command, receipt, result, and audit before exact retry',
    async () => {
      const before = await snapshot(db);
      await db.exec(
        "CREATE TRIGGER version_approval_test_fail_guest_audit BEFORE INSERT ON audit_events WHEN NEW.action='version_approval.confirmed' BEGIN SELECT RAISE(ABORT,'INJECTED_GUEST_AUDIT_FAILURE'); END",
      );
      try {
        await expectD1Failure(
          () => firstGuestCommand.statement.run(),
          'INJECTED_GUEST_AUDIT_FAILURE',
        );
      } finally {
        await db.exec('DROP TRIGGER version_approval_test_fail_guest_audit');
      }
      assert.deepEqual(await snapshot(db), before);
      await firstGuestCommand.statement.run();
      assert.equal(
        await count(
          db,
          'version_approval_receipts',
          ' WHERE approval_request_id=? AND guest_id=?',
          initialRequest.resourceId,
          initialGuest.guestId,
        ),
        1,
      );
      const result = await first(
        db,
        'SELECT result_json FROM version_approval_guest_results WHERE command_id=?',
        firstGuestCommand.commandId,
      );
      const parsed = JSON.parse(result.result_json);
      assert.equal(parsed.recorded, true);
      assert.equal(parsed.versionId, fixture.versionId);
      assert.equal(parsed.headRevision, 0);
      assert.equal(Object.hasOwn(parsed, 'isCurrent'), false);
    },
  );

  await check(
    'same-session exact Guest replay returns to the immutable result without new rows',
    async () => {
      const before = await snapshot(db);
      await guestCommand(db, {
        guest: initialGuest,
        approvalRequestId: initialRequest.resourceId,
        requestId: firstGuestCommand.requestId,
        ...scope,
        versionId: fixture.versionId,
        revision: 0,
      }).statement.run();
      assert.deepEqual(await snapshot(db), before);
      const conflictingPayload = guestCommand(db, {
        guest: initialGuest,
        approvalRequestId: initialRequest.resourceId,
        requestId: firstGuestCommand.requestId,
        payload: JSON.stringify({
          requestId: firstGuestCommand.requestId,
          expectedGuestId: initialGuest.guestId,
          confirm: false,
        }),
        ...scope,
        versionId: fixture.versionId,
        revision: 0,
      });
      await expectD1Failure(
        () => conflictingPayload.statement.run(),
        'REQUEST_ID_CONFLICT',
      );

      const alternateSessionId = randomUUID();
      await db
        .prepare(
          'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
        )
        .bind(
          alternateSessionId,
          initialGuest.inviteId,
          initialGuest.guestId,
          createHash('sha256').update(randomUUID()).digest('hex'),
          Date.now() + 300_000,
        )
        .run();
      const crossSessionReplay = guestCommand(db, {
        guest: initialGuest,
        sessionId: alternateSessionId,
        approvalRequestId: initialRequest.resourceId,
        requestId: firstGuestCommand.requestId,
        ...scope,
        versionId: fixture.versionId,
        revision: 0,
      });
      await expectD1Failure(
        () => crossSessionReplay.statement.run(),
        'REQUEST_ID_CONFLICT',
      );
    },
  );

  const nextBytes = pngFixture();
  const nextVersion = await appendAuthorizedVersionFixture({
    db,
    owner,
    photoId: fixture.photoId,
    sha256: createHash('sha256').update(nextBytes).digest('hex'),
    byteSize: nextBytes.byteLength,
    mime: 'image/png',
    width: 1,
    height: 1,
  });
  await storage.put(nextVersion.objectKey, new Uint8Array(nextBytes), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: createHash('sha256').update(nextBytes).digest(),
  });
  const processing = await runImageProcessingJob({
    jobId: nextVersion.asset_id,
    jobs: new D1ImageProcessingRepository(db),
    objects: new R2ProcessingObjectStore(storage),
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processing.status, 'succeeded');
  const headRequestId = randomUUID();
  const headPayload = JSON.stringify({
    requestId: headRequestId,
    expectedRevision: 0,
    expectedCurrentVersionId: fixture.versionId,
    versionId: nextVersion.version_id,
    confirm: true,
  });
  await db
    .prepare(
      'INSERT INTO photo_version_head_commands(' +
        'id,actor_id,session_id,request_id,operation,workspace_id,project_id,' +
        'album_id,photo_id,expected_revision,expected_current_version_id,' +
        'version_id,confirm,payload_json,created_at_ms' +
        ') VALUES(?,?,?,?,' +
        "'photo.version.current.set',?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      randomUUID(),
      owner,
      ownerSessionId,
      headRequestId,
      fixture.workspaceId,
      fixture.projectId,
      fixture.albumId,
      fixture.photoId,
      0,
      fixture.versionId,
      nextVersion.version_id,
      1,
      headPayload,
      Date.now(),
    )
    .run();

  await check(
    'requests and receipts stay pinned after the photo head changes',
    async () => {
      const head = await first(
        db,
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
        fixture.photoId,
      );
      assert.deepEqual(head, {
        version_id: nextVersion.version_id,
        revision: 1,
      });
      const pinned = await first(
        db,
        'SELECT version_id,head_revision,version_no FROM version_approval_requests WHERE id=?',
        initialRequest.resourceId,
      );
      assert.deepEqual(pinned, {
        version_id: fixture.versionId,
        head_revision: 0,
        version_no: 1,
      });
      const receipt = await first(
        db,
        'SELECT version_id,head_revision FROM version_approval_receipts WHERE approval_request_id=? AND guest_id=?',
        initialRequest.resourceId,
        initialGuest.guestId,
      );
      assert.deepEqual(receipt, {
        version_id: fixture.versionId,
        head_revision: 0,
      });
      const ownerReplayBefore = await snapshot(db);
      await ownerCommand(db, {
        ...scope,
        requestId: initialRequest.requestId,
        resourceId: initialRequest.resourceId,
        versionId: fixture.versionId,
        revision: 0,
        inviteIds: [initialGuest.inviteId],
      }).statement.run();
      await guestCommand(db, {
        guest: initialGuest,
        approvalRequestId: initialRequest.resourceId,
        requestId: firstGuestCommand.requestId,
        ...scope,
        versionId: fixture.versionId,
        revision: 0,
      }).statement.run();
      assert.deepEqual(await snapshot(db), ownerReplayBefore);

      const stale = ownerCommand(db, {
        ...scope,
        versionId: fixture.versionId,
        revision: 0,
        inviteIds: [initialGuest.inviteId],
      });
      await expectD1Failure(
        () => stale.statement.run(),
        'PHOTO_VERSION_REVISION_CONFLICT',
      );
    },
  );

  const nextRequest = ownerCommand(db, {
    ...scope,
    versionId: nextVersion.version_id,
    revision: 1,
    inviteIds: [initialGuest.inviteId],
  });
  await nextRequest.statement.run();
  await check(
    'new head starts with a separate unconfirmed request and no inherited receipt',
    async () => {
      assert.equal(
        await count(
          db,
          'version_approval_receipts',
          ' WHERE approval_request_id=?',
          nextRequest.resourceId,
        ),
        0,
      );
      const result = await first(
        db,
        'SELECT result_json FROM version_approval_owner_results WHERE command_id=?',
        nextRequest.commandId,
      );
      assert.equal(
        Object.hasOwn(JSON.parse(result.result_json).request, 'isCurrent'),
        false,
      );
    },
  );

  await check(
    'append-only ledgers reject update and delete across every approval relation',
    async () => {
      const invite = await first(
        db,
        'SELECT invite_id FROM version_approval_request_invites WHERE approval_request_id=?',
        initialRequest.resourceId,
      );
      const ownerResultId = initialRequest.commandId;
      const guestResultId = firstGuestCommand.commandId;
      const updateDeleteCases = [
        ['version_approval_owner_commands', 'id', initialRequest.commandId],
        ['version_approval_requests', 'id', initialRequest.resourceId],
        [
          'version_approval_request_invites',
          'approval_request_id',
          initialRequest.resourceId,
        ],
        [
          'version_approval_request_seals',
          'approval_request_id',
          initialRequest.resourceId,
        ],
        ['version_approval_owner_results', 'command_id', ownerResultId],
        ['version_approval_guest_commands', 'id', firstGuestCommand.commandId],
        [
          'version_approval_receipts',
          'approval_request_id',
          initialRequest.resourceId,
        ],
        ['version_approval_guest_results', 'command_id', guestResultId],
      ];
      for (const [table, column, value] of updateDeleteCases) {
        const whereValue =
          table === 'version_approval_request_invites'
            ? [value, invite.invite_id]
            : table === 'version_approval_receipts'
              ? [value, initialGuest.guestId]
              : [value];
        const where =
          table === 'version_approval_request_invites'
            ? ' WHERE approval_request_id=? AND invite_id=?'
            : table === 'version_approval_receipts'
              ? ' WHERE approval_request_id=? AND guest_id=?'
              : ' WHERE ' + column + '=?';
        await expectD1Failure(
          () =>
            db
              .prepare(
                'UPDATE ' + table + ' SET ' + column + '=' + column + where,
              )
              .bind(...whereValue)
              .run(),
          'IMMUTABLE_VERSION_APPROVAL',
        );
        await expectD1Failure(
          () =>
            db
              .prepare('DELETE FROM ' + table + where)
              .bind(...whereValue)
              .run(),
          'IMMUTABLE_VERSION_APPROVAL',
        );
      }
    },
  );

  await check(
    'REPLACE cannot overwrite an existing confirmation receipt or audit event',
    async () => {
      const receipt = await first(
        db,
        'SELECT * FROM version_approval_receipts WHERE approval_request_id=? AND guest_id=?',
        initialRequest.resourceId,
        initialGuest.guestId,
      );
      await expectD1Failure(
        () =>
          db
            .prepare(
              'INSERT OR REPLACE INTO version_approval_receipts(' +
                'approval_request_id,guest_id,invite_id,session_id,request_id,event_id,' +
                'workspace_id,project_id,album_id,photo_id,version_id,head_revision,' +
                'occurred_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              receipt.approval_request_id,
              receipt.guest_id,
              receipt.invite_id,
              receipt.session_id,
              receipt.request_id,
              receipt.event_id,
              receipt.workspace_id,
              receipt.project_id,
              receipt.album_id,
              receipt.photo_id,
              receipt.version_id,
              receipt.head_revision,
              receipt.occurred_at_utc,
            )
            .run(),
        'IMMUTABLE_VERSION_APPROVAL_RECEIPT',
      );
      const audit = await first(
        db,
        "SELECT rowid,* FROM audit_events WHERE action='version_approval.confirmed' AND request_id=?",
        firstGuestCommand.requestId,
      );
      await expectD1Failure(
        () =>
          db
            .prepare(
              'INSERT OR REPLACE INTO audit_events(' +
                'event_id,actor_type,actor_id,guest_session_id,session_id,' +
                'workspace_id,project_id,album_id,photo_id,version_id,action,' +
                'before_json,after_json,request_id,occurred_at_utc' +
                ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              audit.event_id,
              audit.actor_type,
              audit.actor_id,
              audit.guest_session_id,
              audit.session_id,
              audit.workspace_id,
              audit.project_id,
              audit.album_id,
              audit.photo_id,
              audit.version_id,
              audit.action,
              audit.before_json,
              audit.after_json,
              audit.request_id,
              audit.occurred_at_utc,
            )
            .run(),
        'APPEND_ONLY_AUDIT|IMMUTABLE_VERSION_APPROVAL_AUDIT',
      );
      const retained = await first(
        db,
        'SELECT rowid,* FROM audit_events WHERE event_id=?',
        audit.event_id,
      );
      assert.deepEqual(retained, audit);
    },
  );

  const secondRequest = ownerCommand(db, {
    ...scope,
    versionId: nextVersion.version_id,
    revision: 1,
    inviteIds: [revokedGuest.inviteId],
  });
  await secondRequest.statement.run();
  const revokedApproval = guestCommand(db, {
    guest: revokedGuest,
    approvalRequestId: secondRequest.resourceId,
    ...scope,
    versionId: nextVersion.version_id,
    revision: 1,
  });
  await revokedApproval.statement.run();
  await db
    .prepare(
      'INSERT INTO invite_revocation_commands(actor_id,request_id,session_id,invite_id,payload_json) VALUES(?,?,?,?,?)',
    )
    .bind(
      owner,
      randomUUID(),
      ownerSessionId,
      revokedGuest.inviteId,
      '{"confirmRevoke":true}',
    )
    .run();
  await check(
    'invite revocation blocks exact replay and fresh confirmation while preserving the receipt',
    async () => {
      const beforeReceipt = await first(
        db,
        'SELECT event_id,version_id,head_revision FROM version_approval_receipts WHERE approval_request_id=? AND guest_id=?',
        secondRequest.resourceId,
        revokedGuest.guestId,
      );
      assert.ok(beforeReceipt);
      const replay = guestCommand(db, {
        guest: revokedGuest,
        approvalRequestId: secondRequest.resourceId,
        requestId: revokedApproval.requestId,
        ...scope,
        versionId: nextVersion.version_id,
        revision: 1,
      });
      await expectD1Failure(
        () => replay.statement.run(),
        'GUEST_ACCESS_REQUIRED',
      );
      const fresh = guestCommand(db, {
        guest: revokedGuest,
        approvalRequestId: secondRequest.resourceId,
        ...scope,
        versionId: nextVersion.version_id,
        revision: 1,
      });
      await expectD1Failure(
        () => fresh.statement.run(),
        'GUEST_ACCESS_REQUIRED',
      );
      const afterReceipt = await first(
        db,
        'SELECT event_id,version_id,head_revision FROM version_approval_receipts WHERE approval_request_id=? AND guest_id=?',
        secondRequest.resourceId,
        revokedGuest.guestId,
      );
      assert.deepEqual(afterReceipt, beforeReceipt);
    },
  );

  process.stdout.write(
    'Version approval migration isolated native-D1 checks passed: ' +
      passed +
      '\n',
  );
} finally {
  await mf.dispose();
  const tempRoot = resolve(tmpdir());
  const tempPath = resolve(temporary);
  assert.ok(
    tempPath.startsWith(tempRoot + '\\') || tempPath.startsWith(tempRoot + '/'),
    'refusing to remove an isolated path outside the OS temp directory',
  );
  await rm(temporary, { recursive: true, force: true });
}
