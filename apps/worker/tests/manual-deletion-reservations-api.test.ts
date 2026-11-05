import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import sharp from 'sharp';
import { test } from 'vitest';
import { D1ContentRepository } from '../src/content';
import { D1UploadRepository } from '../src/uploads';
import { R2StorageAdapter } from '../src/r2-storage';
import { D1ManualAlbumDeletion } from '../src/manual-album-deletion';
import { D1ImageProcessingRepository } from '../src/processing-jobs';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner';

test('0062 resolves genuine completed reservation history without weakening live work guards', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'effective-reservations',
          modules: true,
          script:
            'export default {fetch(){return new Response(null,{status:404})}}',
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'effective-reservations' },
          r2Buckets: { BUCKET: 'effective-reservations' },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB', 'effective-reservations');
    const bucket = (await mf.getR2Bucket(
      'BUCKET',
      'effective-reservations',
    )) as unknown as R2Bucket;
    const apply = async (file: string) =>
      db.batch(
        unstable_splitSqlQuery(
          await readFile(resolve('apps/worker/migrations', file), 'utf8'),
        ).map((s) => db.prepare(s)),
      );
    const files = (await readdir(resolve('apps/worker/migrations')))
      .filter((f) => /^\d{4}_.+\.sql$/u.test(f) && f < '0062')
      .sort();
    assert.equal(files.length, 61);
    for (const file of files) await apply(file);
    const actor = randomUUID(),
      session = randomUUID(),
      workspace = randomUUID();
    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
      )
      .bind(actor, randomUUID())
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        session,
        randomUUID(),
        actor,
        Date.now() + 3600000,
        Date.now(),
        Date.now(),
      )
      .run();
    await db
      .prepare(
        'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
      )
      .bind(actor, randomUUID(), session, '有效預留驗收', workspace)
      .run();
    const content = new D1ContentRepository(db, actor, session);
    const project = await content.createProject({
      workspaceId: workspace,
      name: '預留容量判定',
      requestId: randomUUID(),
    });
    const album = await content.createAlbum(project.id, {
      name: '真實上傳與縮圖',
      requestId: randomUUID(),
    });
    const storage = new R2StorageAdapter(bucket);
    const uploads = new D1UploadRepository(db, actor, session, storage, {
      versionUploadsEnabled: true,
    });
    const deletion = new D1ManualAlbumDeletion(db, storage, actor, session);
    const bytes = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 31, g: 91, b: 129 },
      },
    })
      .png()
      .toBuffer();
    const digest = createHash('sha256').update(bytes).digest('hex');
    const scope = {
      workspaceId: workspace,
      projectId: project.id,
      albumId: album.id,
    };
    const init = {
      ...scope,
      originalFilename: 'genuine.png',
      expectedBytes: bytes.length,
      contentType: 'image/png',
      sha256: digest,
    };
    const credentials = {
      accountId: 'a'.repeat(32),
      accessKeyId: 'synthetic-only',
      secretAccessKey: 'synthetic-only-secret',
      bucketName: 'effective-reservations',
    };
    const complete = async (id: string) => {
      await uploads.authorize(id, { requestId: randomUUID() }, credentials);
      const row = await db
        .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
        .bind(id)
        .first<{ object_key: string }>();
      assert.ok(row);
      assert.ok(
        await bucket.put(row.object_key, bytes, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          sha256: Buffer.from(digest, 'hex'),
        }),
      );
      const result = (await uploads.complete(id, {
        requestId: randomUUID(),
      })) as { photoId: string; versionId: string; assetId: string };
      const processed = await runImageProcessingJob({
        jobId: result.assetId,
        jobs: new D1ImageProcessingRepository(db),
        objects: new R2ProcessingObjectStore(bucket),
        processor: new LocalSharpImageProcessor(),
      });
      assert.equal(processed.status, 'succeeded');
      return result;
    };
    const original = await uploads.reserve({
      ...init,
      requestId: randomUUID(),
    });
    const v1 = await complete(original.id);
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM storage_reservations WHERE id=?')
          .bind(original.id)
          .first<{ n: number }>()
      )?.n,
      1,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT status FROM upload_sessions WHERE id=?')
          .bind(original.id)
          .first<{ status: string }>()
      )?.status,
      'reserved',
    );
    // The old blocker sees historical reservation rows even after real upload+Sharp success.
    assert.ok(
      (await deletion.preview(album.id)).preview.blockers.includes(
        'DELETE_CONTENT_BUSY',
      ),
    );

    type SchemaRow = {
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    };
    const beforeSchema: SchemaRow[] = (
      await db
        .prepare(
          'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',
        )
        .all<SchemaRow>()
    ).results;
    const tables = beforeSchema
      .filter((r) => r.type === 'table' && r.name !== '_cf_METADATA')
      .map((r) => r.name);
    const snapshot = async (): Promise<string[][]> =>
      Promise.all(
        tables.map(async (name) =>
          (
            await db
              .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
              .all()
          ).results
            .map((r: Record<string, unknown>) => JSON.stringify(r))
            .sort(),
        ),
      );
    const beforeRows = await snapshot();
    await apply('0062_manual_deletion_effective_reservations.sql');
    assert.deepEqual(await snapshot(), beforeRows);
    const afterSchema: SchemaRow[] = (
      await db
        .prepare(
          'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',
        )
        .all<SchemaRow>()
    ).results;
    const allowed = (r: SchemaRow) =>
      r.type === 'view' && r.name === 'manual_album_deletion_blockers';
    assert.deepEqual(
      afterSchema.filter(
        (r) =>
          !allowed(r) &&
          beforeSchema.some(
            (old) => old.name === r.name && old.type === r.type,
          ),
      ),
      beforeSchema.filter((r) => !allowed(r)),
    );
    assert.deepEqual(
      afterSchema
        .filter(
          (r) =>
            !beforeSchema.some(
              (old) => old.name === r.name && old.type === r.type,
            ),
        )
        .map((r) => [r.type, r.name]),
      [['view', 'pending_upload_storage_reservations']],
    );
    const oldBlocker = beforeSchema.find(allowed)!;
    const newBlocker = afterSchema.find(allowed)!;
    assert.equal(
      newBlocker.sql,
      oldBlocker.sql!.replace(
        'SELECT 1 FROM upload_sessions u JOIN storage_reservations r ON r.id=u.id WHERE u.album_id=a.id',
        'SELECT 1 FROM pending_upload_storage_reservations r WHERE r.album_id=a.id',
      ),
    );
    const pending = async (id: string) =>
      Number(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM pending_upload_storage_reservations WHERE id=?',
            )
            .bind(id)
            .first<{ n: number }>()
        )?.n,
      );
    assert.equal(await pending(original.id), 0);
    // Short-lived signed PUT authority remains a separate blocker, unchanged by0062.
    assert.ok(
      (await deletion.preview(album.id)).preview.blockers.includes(
        'DELETE_CONTENT_BUSY',
      ),
    );
    const head = await db
      .prepare(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(v1.photoId)
      .first<{ version_id: string; revision: number }>();
    assert.ok(head);
    const version = await uploads.reserveVersion(v1.photoId, {
      originalFilename: 'genuine-v2.png',
      expectedBytes: bytes.length,
      contentType: 'image/png',
      sha256: digest,
      requestId: randomUUID(),
      expectedRevision: head.revision,
      expectedCurrentVersionId: head.version_id,
      changeType: 'new_retouch',
      changeNote: 'Genuine V2',
      labels: [],
      confirm: true,
    });
    assert.equal(await pending(version.uploadSession.id), 1);
    await complete(version.uploadSession.id);
    assert.equal(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM upload_version_completions WHERE upload_session_id=?',
          )
          .bind(version.uploadSession.id)
          .first<{ n: number }>()
      )?.n,
      1,
    );
    assert.equal(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM upload_completions WHERE upload_session_id=?',
          )
          .bind(version.uploadSession.id)
          .first<{ n: number }>()
      )?.n,
      0,
    );
    assert.equal(await pending(version.uploadSession.id), 0);
    const pendingAlbum = await content.createAlbum(project.id, {
      name: '尚未完成上傳',
      requestId: randomUUID(),
    });
    assert.deepEqual(
      (await deletion.preview(pendingAlbum.id)).preview.blockers,
      [],
    );
    const live = await uploads.reserve({
      ...init,
      albumId: pendingAlbum.id,
      originalFilename: 'pending.png',
      requestId: randomUUID(),
    });
    assert.equal(await pending(live.id), 1);
    const preview = await deletion.preview(pendingAlbum.id);
    await assert.rejects(
      deletion.start(pendingAlbum.id, {
        confirmationName: pendingAlbum.name,
        expectedRevision: preview.album.revision,
        inventoryCount: preview.preview.assetCount,
        bytesBefore: preview.preview.totalBytes,
        requestId: randomUUID(),
        confirmPermanent: true,
      }),
      /DELETION_BLOCKED/,
    );
    await uploads.cancel(live.id, { requestId: randomUUID() });
    assert.equal(await pending(live.id), 0);
    assert.deepEqual(
      (await deletion.preview(pendingAlbum.id)).preview.blockers,
      [],
    );
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM storage_reservations WHERE id=?')
          .bind(live.id)
          .first<{ n: number }>()
      )?.n,
      1,
    );
    assert.equal(
      (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
      0,
    );
    const hash = (text: string) =>
      createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
    await mkdir(resolve('.local'), { recursive: true });
    await writeFile(
      resolve('.local/manual-deletion-reservations-native-proof.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: 'passed_native_effective_reservations_0062',
          sourceSchemaVersion: 61,
          targetSchemaVersion: 62,
          migration62Sha256: hash(
            await readFile(
              resolve(
                'apps/worker/migrations/0062_manual_deletion_effective_reservations.sql',
              ),
              'utf8',
            ),
          ),
          runnerSha256: hash(
            await readFile(
              resolve(
                'apps/worker/tests/manual-deletion-reservations-api.test.ts',
              ),
              'utf8',
            ),
          ),
          oldTableCount: tables.length,
          oldTablesPreserved: true,
          oldObjectsPreservedExcept: ['view:manual_album_deletion_blockers'],
          foreignKeyViolations: 0,
          genuineUpload: true,
          sharpProcessing: true,
          realR2: 'local Miniflare',
          grantExpiryAcceptance: 'not_checked_unexpired_grants_remain_blocked',
          checks: [
            'populated61-to62-rows-preserved',
            'exact-one-view-predicate-replaced',
            'real-v1-completed-history-excluded',
            'real-v2-completion-history-excluded',
            'real-unresolved-reservation-blocked',
            'real-cancelled-history-excluded',
            'unexpired-grant-protection-retained',
            'foreign-keys-zero',
          ],
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await mf.dispose();
  }
}, 120000);
