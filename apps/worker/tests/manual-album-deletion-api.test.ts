import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { test } from 'vitest';
import { D1ContentRepository } from '../src/content';
import { D1ManualAlbumDeletion } from '../src/manual-album-deletion';
import { R2StorageAdapter } from '../src/r2-storage';
import { D1GalleryRepository } from '../src/gallery';
import { deleteEmptyProject } from '../src/project-deletion';

test('manual cleanup reclaims actual private R2 payloads with resumable native ledger', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'manual-delete-api',
          modules: true,
          script:
            'export default {fetch(){return new Response(null,{status:404})}}',
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'manual-delete-api' },
          r2Buckets: { BUCKET: 'manual-delete-api' },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB', 'manual-delete-api');
    const bucket = (await mf.getR2Bucket(
      'BUCKET',
      'manual-delete-api',
    )) as unknown as R2Bucket;
    const files = (await readdir(resolve('apps/worker/migrations')))
      .filter((f) => /^\d{4}_.+\.sql$/u.test(f))
      .sort();
    const apply = async (file: string) =>
      db.batch(
        unstable_splitSqlQuery(
          await readFile(resolve('apps/worker/migrations', file), 'utf8'),
        ).map((sql) => db.prepare(sql)),
      );
    for (const file of files.filter((f) => f < '0037')) await apply(file);
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
      .bind(actor, randomUUID(), session, '真實清理', workspace)
      .run();
    const repo = new D1ContentRepository(db, actor, session);
    const project = await repo.createProject({
      workspaceId: workspace,
      name: '容量清理',
      requestId: randomUUID(),
    });
    const album = await repo.createAlbum(project.id, {
      name: '包含所有版本',
      requestId: randomUUID(),
    });
    const photo = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(photo, workspace, project.id, album.id, 'private-original.jpg')
      .run();
    let total = 0;
    const objects: Array<{
      key: string;
      bytes: Uint8Array;
      asset: string;
      version: string;
    }> = [];
    // Historical V1/V2 fixtures predate the guarded version-upload migration.
    // R2 bytes are real; processing result metadata below is deliberately synthetic.
    for (let v = 1; v <= 2; v++) {
      const version = randomUUID();
      const original = randomUUID(),
        bytes = new Uint8Array(2048).fill(v),
        digest = createHash('sha256').update(bytes).digest('hex');
      await db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,?,?,?,?,'image/jpeg',1,1,'private')",
        )
        .bind(version, workspace, photo, v, actor, digest, bytes.length)
        .run();
      const key = `${workspace}/${project.id}/${album.id}/${original}/original`;
      await bucket.put(key, bytes, {
        sha256: digest,
        httpMetadata: { contentType: 'image/jpeg' },
      });
      await db
        .prepare(
          "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'primary','original',?,?,'image/jpeg',?,'private')",
        )
        .bind(original, workspace, photo, version, key, bytes.length, digest)
        .run();
      objects.push({ key, bytes, asset: original, version });
      total += bytes.length;
      const outputs = await db
        .prepare(
          'SELECT kind,asset_id,object_key FROM image_processing_outputs WHERE job_id=? ORDER BY kind',
        )
        .bind(original)
        .all<{ kind: string; asset_id: string; object_key: string }>();
      const result = [];
      for (const output of outputs.results) {
        const data = new Uint8Array(1024 + objects.length * 257).fill(
          objects.length + 1,
        );
        const sha = createHash('sha256').update(data).digest('hex');
        await bucket.put(output.object_key, data, {
          sha256: sha,
          httpMetadata: { contentType: 'image/jpeg' },
        });
        result.push({
          kind: output.kind,
          bytes: data.length,
          mime: 'image/jpeg',
          sha256: sha,
          width: 1,
          height: 1,
        });
        objects.push({
          key: output.object_key,
          bytes: data,
          asset: output.asset_id,
          version,
        });
        total += data.length;
      }
      await db
        .prepare(
          "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=1,lease_until_ms=?,attempts=1,transition_id=?,updated_at_ms=? WHERE id=?",
        )
        .bind(
          randomUUID(),
          Date.now() + 120000,
          randomUUID(),
          Date.now(),
          original,
        )
        .run();
      await db
        .prepare(
          "UPDATE image_processing_jobs SET status='succeeded',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,result_json=?,transition_id=?,updated_at_ms=? WHERE id=?",
        )
        .bind(JSON.stringify(result), randomUUID(), Date.now(), original)
        .run();
    }
    for (const file of files.filter((f) => f >= '0037')) await apply(file);
    await db
      .prepare(
        'UPDATE workspace_storage_usage SET used_bytes=? WHERE workspace_id=?',
      )
      .bind(total, workspace)
      .run();
    await db
      .prepare("UPDATE storage_nodes SET used_bytes=? WHERE id='primary'")
      .bind(total)
      .run();
    const retainedKey = `${workspace}/${project.id}/${album.id}/permanent-upload-fence/original`;
    await bucket.put(retainedKey, new Uint8Array(), {
      customMetadata: { kinoUploadFence: 'permanent-upload-fence' },
      httpMetadata: { contentType: 'application/x-kino-pic-upload-fence' },
    });
    const unrelated = 'unrelated/private-original.jpg';
    await bucket.put(unrelated, 'keep');
    const service = new D1ManualAlbumDeletion(
      db,
      new R2StorageAdapter(bucket),
      actor,
      session,
    );
    const before = (
      await db
        .prepare('SELECT count(*) AS n FROM audit_events')
        .first<{ n: number }>()
    )?.n;
    const preview = await service.preview(album.id);
    assert.equal(preview.preview.assetCount, 6);
    assert.equal(preview.preview.totalBytes, total);
    assert.equal(preview.preview.versionCount, 2);
    assert.deepEqual(preview.preview.blockers, []);
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM audit_events')
          .first<{ n: number }>()
      )?.n,
      before,
    );
    for (const object of objects)
      assert.equal((await bucket.head(object.key))?.size, object.bytes.length);
    const body = {
      requestId: randomUUID(),
      expectedRevision: album.revision,
      confirmationName: album.name,
      inventoryCount: 6,
      bytesBefore: total,
      confirmPermanent: true,
    };
    await assert.rejects(
      new D1ManualAlbumDeletion(
        db,
        new R2StorageAdapter(bucket),
        randomUUID(),
        session,
      ).start(album.id, body),
      /NOT_FOUND/,
    );
    await assert.rejects(
      service.start(album.id, { ...body, bytesBefore: total + 1 }),
      /DELETION_INVENTORY_CHANGED/,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT state FROM albums WHERE id=?')
          .bind(album.id)
          .first<{ state: string }>()
      )?.state,
      'draft',
    );
    await db
      .prepare(
        "CREATE TRIGGER inject_reclaim_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='storage.asset_reclaimed' BEGIN SELECT RAISE(ABORT,'INJECTED_RECLAIM_AUDIT_FAILURE'); END",
      )
      .run();
    const stopped = await service.start(album.id, body);
    assert.equal(stopped.job?.failed, 1);
    assert.equal(stopped.job?.bytesReclaimed, 0);
    assert.equal(stopped.job?.status, 'deleting');
    assert.equal(
      (
        await db
          .prepare(
            'SELECT used_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace)
          .first<{ used_bytes: number }>()
      )?.used_bytes,
      total,
    );
    await assert.rejects(
      new D1GalleryRepository(db, actor, session).list(album.id),
      /NOT_FOUND/,
    );
    await db.prepare('DROP TRIGGER inject_reclaim_audit_failure').run();
    assert.ok(stopped.job);
    await service.advance(album.id, stopped.job.id);
    const done = await service.advance(album.id, stopped.job.id);
    assert.equal(done.job?.status, 'completed');
    assert.equal(done.job?.bytesReclaimed, total);
    assert.equal(done.job?.pending, 0);
    for (const object of objects) {
      const head = await bucket.head(object.key);
      assert.equal(head?.size, 0);
      assert.equal(head?.customMetadata?.kinoDeletionAsset, object.asset);
      assert.equal(
        await bucket.put(object.key, object.bytes, {
          onlyIf: { etagDoesNotMatch: '*' },
        }),
        null,
        'stale immutable PUT cannot resurrect payload',
      );
    }
    assert.equal((await bucket.head(retainedKey))?.size, 0);
    assert.equal(await (await bucket.get(unrelated))?.text(), 'keep');
    assert.equal(
      (
        await db
          .prepare(
            'SELECT used_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace)
          .first<{ used_bytes: number }>()
      )?.used_bytes,
      0,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT used_bytes FROM storage_nodes WHERE id='primary'")
          .first<{ used_bytes: number }>()
      )?.used_bytes,
      0,
    );
    await service.start(album.id, body);
    await service.advance(album.id, stopped.job.id);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='storage.asset_reclaimed'",
          )
          .first<{ n: number }>()
      )?.n,
      6,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM photo_assets')
          .first<{ n: number }>()
      )?.n,
      6,
    );
    assert.equal((await repo.listAlbums(project.id)).albums.length, 0);
    const projectIntent = {
      confirmationName: project.name,
      expectedRevision: project.revision,
      requestId: randomUUID(),
    };
    await deleteEmptyProject(db, actor, session, project.id, projectIntent);
    await deleteEmptyProject(db, actor, session, project.id, projectIntent);
    await assert.rejects(repo.getProject(project.id), /NOT_FOUND/);
    await assert.rejects(
      repo.archiveProject(project.id, {
        archived: false,
        expectedRevision: project.revision + 1,
        requestId: randomUUID(),
      }),
      /NOT_FOUND/,
    );
    assert.equal(
      (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
      0,
    );
    const hash = (text: string) =>
      createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
    await mkdir(resolve('.local'), { recursive: true });
    await writeFile(
      resolve('.local/manual-album-deletion-native-proof.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          status: 'passed_native_d1_r2_manual_deletion',
          targetSchemaVersion: 61,
          migration61Sha256: hash(
            await readFile(
              resolve('apps/worker/migrations/0061_manual_album_deletion.sql'),
              'utf8',
            ),
          ),
          runnerSha256: hash(
            await readFile(
              resolve('apps/worker/tests/manual-album-deletion-api.test.ts'),
              'utf8',
            ),
          ),
          sourceHashes: Object.fromEntries(
            await Promise.all(
              Object.entries({
                manualDeletion: 'manual-album-deletion.ts',
                r2Storage: 'r2-storage.ts',
                projectDeletion: 'project-deletion.ts',
                content: 'content.ts',
              }).map(async ([key, file]) => [
                key,
                hash(await readFile(resolve('apps/worker/src', file), 'utf8')),
              ]),
            ),
          ),
          assetCount: objects.length,
          versionCount: 2,
          payloadBytesBefore: total,
          payloadBytesAfter: 0,
          checks: [
            'preview-no-writes',
            'foreign-owner-denied',
            'changed-inventory-denied',
            'all-versions-and-derivatives',
            'r2-fence-after-ledger-failure-recovery',
            'private-assets-denied-during-deletion',
            'exactly-once-quota-and-audit',
            'stale-immutable-put-denied',
            'unrelated-object-and-upload-fence-preserved',
            'project-tombstone-after-album-cleanup',
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
