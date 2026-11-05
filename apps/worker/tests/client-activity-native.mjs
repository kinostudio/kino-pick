import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  D1ClientActivityRepository,
  clientActivityEnabled,
} from '../src/client-activity.ts';
import { GuestAccessDenied } from '../src/guest-access.ts';
import { D1GuestDownloadsRepository } from '../src/guest-downloads.ts';
import { D1ContentRepository } from '../src/content.ts';
import { D1UploadRepository } from '../src/uploads.ts';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2StorageAdapter } from '../src/r2-storage.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { pngFixture } from './image-fixtures.mjs';
import { applyMigration } from './apply-migration.mjs';

const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'client-activity-native',
        modules: true,
        script:
          'export default {fetch(){return new Response(null,{status:404})}}',
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: {
          DB: 'client-activity-current',
          OLD_DB: 'client-activity-old',
        },
        r2Buckets: { PRIMARY_STORAGE: 'client-activity-native' },
      },
    ],
  }),
);

const check = async (label, action) => {
  await action();
  process.stdout.write('passed: ' + label + '\n');
};
const count = async (db, table, where = '', ...values) =>
  Number(
    (
      await db
        .prepare('SELECT count(*) AS n FROM ' + table + where)
        .bind(...values)
        .first()
    ).n,
  );
const failureCode = (error) =>
  error && typeof error === 'object' && 'code' in error ? error.code : null;

try {
  const db = await mf.getD1Database('DB', 'client-activity-native');
  const oldDb = await mf.getD1Database('OLD_DB', 'client-activity-native');
  const bucket = await mf.getR2Bucket(
    'PRIMARY_STORAGE',
    'client-activity-native',
  );
  const env = {
    APP_ENV: 'production',
    APP_URL: 'https://client-activity.test',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  };

  await check(
    'background defaults on but missing 0063 fails closed',
    async () => {
      assert.equal(await clientActivityEnabled(env, oldDb), false);
    },
  );

  const migrations = (await readdir(resolve('apps/worker/migrations')))
    .filter(
      (name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 63,
    )
    .sort();
  assert.equal(migrations.length, 63);
  for (const migration of migrations) {
    const source = await readFile(
      resolve('apps/worker/migrations', migration),
      'utf8',
    );
    const { unstable_splitSqlQuery } = await import('wrangler');
    await db.batch(
      unstable_splitSqlQuery(source).map((statement) => db.prepare(statement)),
    );
  }
  const requiredGuard = await db
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='client_browse_events_insert_guard'",
    )
    .first();
  const rateIndex = await db
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type='index' AND name='client_browse_events_guest_rate'",
    )
    .first();
  assert.ok(requiredGuard?.sql && rateIndex?.sql);
  await db.exec('DROP TRIGGER client_browse_events_insert_guard');
  assert.equal(await clientActivityEnabled(env, db), false);
  await applyMigration(db, requiredGuard.sql);
  await db.exec('DROP INDEX client_browse_events_guest_rate');
  assert.equal(await clientActivityEnabled(env, db), false);
  await applyMigration(db, rateIndex.sql);
  assert.equal(await clientActivityEnabled(env, db), true);
  assert.equal(
    await clientActivityEnabled(
      { ...env, CLIENT_ACTIVITY_ENABLED: 'false' },
      db,
    ),
    false,
  );

  const ownerId = randomUUID();
  const ownerSessionId = 'Native.Activity.Owner.' + randomUUID().toUpperCase();
  const workspaceId = randomUUID();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(ownerId, 'client-activity-' + randomUUID())
    .run();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(ownerSessionId, randomUUID(), ownerId, now + 3_600_000, now, now)
    .run();
  await db
    .prepare(
      'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
    )
    .bind(ownerId, randomUUID(), ownerSessionId, 'Client activity', workspaceId)
    .run();
  const content = new D1ContentRepository(db, ownerId, ownerSessionId);
  const project = await content.createProject({
    workspaceId,
    name: 'Client activity fixture',
    requestId: randomUUID(),
  });
  const albumId = randomUUID();
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Client activity fixture','active')",
    )
    .bind(albumId, workspaceId, project.id)
    .run();

  const storage = new R2StorageAdapter(bucket);
  const uploads = new D1UploadRepository(db, ownerId, ownerSessionId, storage);
  const source = pngFixture();
  const sha256 = createHash('sha256').update(source).digest('hex');
  const upload = await uploads.reserve({
    workspaceId,
    projectId: project.id,
    albumId,
    originalFilename: 'client-activity.png',
    expectedBytes: source.byteLength,
    contentType: 'image/png',
    sha256,
    requestId: randomUUID(),
  });
  const credentials = {
    accountId: 'a'.repeat(32),
    accessKeyId: 'synthetic-only',
    secretAccessKey: 'synthetic-only-secret',
    bucketName: 'client-activity-native',
  };
  await uploads.authorize(upload.id, { requestId: randomUUID() }, credentials);
  const uploadRow = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(upload.id)
    .first();
  assert.ok(uploadRow?.object_key);
  await bucket.put(uploadRow.object_key, source, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: Buffer.from(sha256, 'hex'),
  });
  const completion = await uploads.complete(upload.id, {
    requestId: randomUUID(),
  });
  const processed = await runImageProcessingJob({
    jobId: completion.assetId,
    jobs: new D1ImageProcessingRepository(db),
    objects: new R2ProcessingObjectStore(bucket),
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processed.status, 'succeeded');

  const createGuest = async ({
    permissions = 1,
    sessionTtlMs = 3_000_000,
    inviteTtlMs = 3_600_000,
  } = {}) => {
    const inviteId = randomUUID();
    const guestId = randomUUID();
    const guestSessionId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const secretHash = createHash('sha256')
      .update('kino-pic:guest-session:v1:' + secret)
      .digest('hex');
    const inviteExpires = Date.now() + inviteTtlMs;
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        workspaceId,
        project.id,
        createHash('sha256').update(randomBytes(32)).digest('hex'),
        permissions,
        inviteExpires,
        ownerId,
        ownerSessionId,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, workspaceId, project.id, albumId)
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId)
      .run();
    await db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(guestId, inviteId, 'Native analytics guest')
      .run();
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(
        guestSessionId,
        inviteId,
        guestId,
        secretHash,
        Date.now() + sessionTtlMs,
      )
      .run();
    return {
      inviteId,
      guestId,
      guestSessionId,
      secret,
      secretHash,
    };
  };
  const guest = await createGuest();
  const repository = new D1ClientActivityRepository(db);
  const browserDigest = 'd'.repeat(64);
  const input = (viewId, digest = browserDigest) => ({
    viewId,
    browserDigest: digest,
    expectedActorId: guest.guestId,
    albumId,
    photoId: completion.photoId,
    versionId: completion.versionId,
    rawIp: '198.51.100.14',
  });

  await check('same event UUID races record one immutable event', async () => {
    const viewId = randomUUID();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.recordGuestView(guest.secret, input(viewId)),
      ),
    );
    assert.equal(outcomes.filter((result) => result.recorded).length, 1);
    assert.equal(outcomes.filter((result) => !result.recorded).length, 7);
    assert.equal(
      await count(db, 'client_browse_events', ' WHERE event_id=?', viewId),
      1,
    );
    assert.equal(
      await count(
        db,
        'client_album_browser_receipts',
        ' WHERE album_id=?',
        albumId,
      ),
      1,
    );
    assert.deepEqual(
      await repository.recordGuestView(guest.secret, input(viewId)),
      {
        recorded: false,
      },
    );
    await assert.rejects(
      repository.recordGuestView(guest.secret, input(viewId, 'e'.repeat(64))),
      (error) => failureCode(error) === 'CLIENT_ACTIVITY_IDEMPOTENCY_CONFLICT',
    );
  });

  await check(
    'Owner browse history is ordered and bounded to 24 rows',
    async () => {
      for (let index = 0; index < 26; index++)
        await repository.recordGuestView(guest.secret, input(randomUUID()));
      const first = await repository.listOwnerViews({
        ownerId,
        ownerSessionId,
        albumId,
      });
      assert.equal(first.items.length, 24);
      assert.ok(first.nextCursor);
      assert.equal(first.summary.visitCount, 27);
      assert.equal(first.summary.uniqueBrowserCount, 1);
      assert.equal(first.items[0]?.rawIp, '198.51.100.14');
      const second = await repository.listOwnerViews({
        ownerId,
        ownerSessionId,
        albumId,
        before: first.nextCursor,
      });
      assert.equal(second.items.length, 3);
      assert.equal(second.nextCursor, null);
      assert.equal(
        new Set([...first.items, ...second.items].map((item) => item.eventId))
          .size,
        27,
      );
    },
  );

  await check(
    'event and first-browser receipt roll back together on write failure',
    async () => {
      const viewId = randomUUID();
      const failedInput = input(viewId, 'f'.repeat(64));
      await db.exec(
        "CREATE TRIGGER client_activity_test_write_failure BEFORE INSERT ON client_album_browser_receipts BEGIN SELECT RAISE(ABORT,'INJECTED_CLIENT_ACTIVITY_WRITE_FAILURE'); END",
      );
      await assert.rejects(
        repository.recordGuestView(guest.secret, failedInput),
        (error) => failureCode(error) === 'CLIENT_ANALYTICS_UNAVAILABLE',
      );
      await db.exec('DROP TRIGGER client_activity_test_write_failure');
      assert.equal(
        await count(db, 'client_browse_events', ' WHERE event_id=?', viewId),
        0,
      );
      assert.equal(
        await count(
          db,
          'client_album_browser_receipts',
          ' WHERE album_id=? AND browser_digest=?',
          albumId,
          failedInput.browserDigest,
        ),
        0,
      );
    },
  );

  await check('same album browser receipt spans invitations', async () => {
    const otherGuest = await createGuest();
    const otherRepository = new D1ClientActivityRepository(db);
    assert.deepEqual(
      await otherRepository.recordGuestView(otherGuest.secret, {
        ...input(randomUUID()),
        expectedActorId: otherGuest.guestId,
      }),
      { recorded: true },
    );
    assert.equal(
      await count(
        db,
        'client_album_browser_receipts',
        ' WHERE album_id=? AND browser_digest=?',
        albumId,
        browserDigest,
      ),
      1,
    );
  });

  await check(
    'Guest download IP is retained and Owner-only projected',
    async () => {
      const downloadGuest = await createGuest({ permissions: 3 });
      const item = await new D1GuestDownloadsRepository(db).request(
        downloadGuest.secret,
        completion.photoId,
        completion.versionId,
        'preview',
      );
      const context = {
        requestId: item.requestId,
        guestId: item.guestId,
        guestSessionId: item.guestSessionId,
        inviteId: item.inviteId,
        workspaceId: item.workspaceId,
        projectId: item.projectId,
        albumId: item.albumId,
        photoId: item.photoId,
        versionId: item.versionId,
      };
      await repository.recordDownload(context, '203.0.113.25');
      await repository.recordDownload(context, '203.0.113.25');
      assert.equal(
        await count(
          db,
          'guest_download_ip_sidecars',
          ' WHERE request_id=?',
          item.requestId,
        ),
        1,
      );
      const page = await repository.listOwnerDownloads({
        ownerId,
        ownerSessionId,
        albumId,
      });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0]?.rawIp, '203.0.113.25');
      assert.equal(page.items[0]?.generated, false);
    },
  );

  await check(
    'revocation racing the write is rechecked inside the D1 batch',
    async () => {
      const raceGuest = await createGuest();
      const viewId = randomUUID();
      const raceDb = {
        prepare: (sql) => db.prepare(sql),
        batch: async (statements) => {
          await db
            .prepare(
              'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
            )
            .bind(raceGuest.guestSessionId, raceGuest.secretHash)
            .run();
          return db.batch(statements);
        },
      };
      await assert.rejects(
        new D1ClientActivityRepository(raceDb).recordGuestView(
          raceGuest.secret,
          {
            ...input(viewId),
            expectedActorId: raceGuest.guestId,
          },
        ),
        (error) => error instanceof GuestAccessDenied,
      );
      assert.equal(
        await count(db, 'client_browse_events', ' WHERE event_id=?', viewId),
        0,
      );
    },
  );

  await check(
    'unshared and foreign-tenant albums cannot record activity',
    async () => {
      const otherWorkspaceId = randomUUID();
      await db
        .prepare(
          'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
        )
        .bind(
          ownerId,
          randomUUID(),
          ownerSessionId,
          'Foreign activity fixture',
          otherWorkspaceId,
        )
        .run();
      const otherProject = await content.createProject({
        workspaceId: otherWorkspaceId,
        name: 'Foreign activity fixture',
        requestId: randomUUID(),
      });
      const foreignAlbumId = randomUUID();
      await db
        .prepare(
          "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Foreign activity fixture','active')",
        )
        .bind(foreignAlbumId, otherWorkspaceId, otherProject.id)
        .run();
      await assert.rejects(
        repository.recordGuestView(guest.secret, {
          ...input(randomUUID()),
          albumId: foreignAlbumId,
        }),
        (error) => error instanceof GuestAccessDenied,
      );
      await assert.rejects(
        repository.recordGuestView(guest.secret, {
          ...input(randomUUID()),
          albumId: randomUUID(),
        }),
        (error) => error instanceof GuestAccessDenied,
      );
    },
  );

  await check(
    'expired session and revoked invite stop new records',
    async () => {
      const expiredGuest = await createGuest({ sessionTtlMs: 500 });
      await new Promise((resolveWait) => setTimeout(resolveWait, 700));
      await assert.rejects(
        repository.recordGuestView(expiredGuest.secret, {
          ...input(randomUUID()),
          expectedActorId: expiredGuest.guestId,
        }),
        (error) => error instanceof GuestAccessDenied,
      );
      const revokedGuest = await createGuest();
      await db
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(revokedGuest.inviteId, ownerId, ownerSessionId)
        .run();
      await assert.rejects(
        repository.recordGuestView(revokedGuest.secret, {
          ...input(randomUUID()),
          expectedActorId: revokedGuest.guestId,
        }),
        (error) => error instanceof GuestAccessDenied,
      );
    },
  );

  await check(
    'session write admission caps at 120 events in five minutes',
    async () => {
      const alreadyWritten = await count(
        db,
        'client_browse_events',
        ' WHERE guest_session_id=?',
        guest.guestSessionId,
      );
      for (let index = alreadyWritten; index < 120; index++)
        await repository.recordGuestView(guest.secret, input(randomUUID()));
      assert.equal(
        await count(
          db,
          'client_browse_events',
          ' WHERE guest_session_id=?',
          guest.guestSessionId,
        ),
        120,
      );
      await assert.rejects(
        repository.recordGuestView(guest.secret, input(randomUUID())),
        (error) => failureCode(error) === 'CLIENT_ANALYTICS_UNAVAILABLE',
      );
      assert.equal(
        await count(
          db,
          'client_browse_events',
          ' WHERE guest_session_id=?',
          guest.guestSessionId,
        ),
        120,
      );
    },
  );

  await check('0063 keeps foreign keys clean', async () => {
    assert.deepEqual(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
      [],
    );
  });
} finally {
  await mf.dispose();
}
