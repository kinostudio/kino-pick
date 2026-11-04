import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { test } from 'vitest';

test('0061 preserves populated schema60 and fences manual reclaim ledger atomically', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'manual-delete-schema',
          modules: true,
          script:
            'export default {fetch(){return new Response(null,{status:404})}}',
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'manual-delete-schema' },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB', 'manual-delete-schema');
    const apply = async (sql: string) =>
      db.batch(unstable_splitSqlQuery(sql).map((s) => db.prepare(s)));
    for (const file of (await readdir(resolve('apps/worker/migrations')))
      .filter((f) => /^\d{4}_.+\.sql$/u.test(f) && f < '0061')
      .sort())
      await apply(
        await readFile(resolve('apps/worker/migrations', file), 'utf8'),
      );
    const actor = randomUUID(),
      session = randomUUID(),
      workspace = randomUUID(),
      project = randomUUID(),
      album = randomUUID();
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
      .bind(actor, randomUUID(), session, 'Manual delete fixture', workspace)
      .run();
    await db
      .prepare(
        "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,'Manual delete fixture','draft')",
      )
      .bind(project, workspace)
      .run();
    await db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Manual delete fixture','active')",
      )
      .bind(album, workspace, project)
      .run();
    // Synthetic metadata, not physical R2 evidence; use the real processing transitions.
    for (let versionNo = 1; versionNo <= 2; versionNo++) {
      const photo = randomUUID();
      await db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          photo,
          workspace,
          project,
          album,
          'synthetic-ledger-' + versionNo + '.jpg',
        )
        .run();
      const version = randomUUID(),
        asset = randomUUID();
      await db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,?,?,?,17,'image/jpeg',1,1,'private')",
        )
        .bind(version, workspace, photo, 1, actor, 'b'.repeat(64))
        .run();
      await db
        .prepare(
          "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'primary','original',?,17,'image/jpeg',?,'private')",
        )
        .bind(
          asset,
          workspace,
          photo,
          version,
          `${workspace}/${project}/${album}/${asset}/original`,
          'b'.repeat(64),
        )
        .run();
      await db
        .prepare(
          'UPDATE workspace_storage_usage SET used_bytes=used_bytes+17 WHERE workspace_id=?',
        )
        .bind(workspace)
        .run();
      await db
        .prepare(
          "UPDATE storage_nodes SET used_bytes=used_bytes+17 WHERE id='primary'",
        )
        .run();
      const now = Date.now();
      await db
        .prepare(
          "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=1,lease_until_ms=?,attempts=1,transition_id=?,updated_at_ms=? WHERE id=?",
        )
        .bind(randomUUID(), now + 120000, randomUUID(), now, asset)
        .run();
      const result = JSON.stringify(
        ['thumbnail', 'preview'].map((kind) => ({
          kind,
          bytes: 5,
          mime: 'image/jpeg',
          sha256: 'c'.repeat(64),
          width: 1,
          height: 1,
        })),
      );
      await db
        .prepare(
          "UPDATE image_processing_jobs SET status='succeeded',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,result_json=?,transition_id=?,updated_at_ms=? WHERE id=?",
        )
        .bind(result, randomUUID(), Date.now(), asset)
        .run();
    }
    type SchemaRow = {
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    };
    const oldSchema: SchemaRow[] = (
      await db
        .prepare(
          'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',
        )
        .all<SchemaRow>()
    ).results;
    const tables = oldSchema
      .filter((r) => r.type === 'table' && r.name !== '_cf_METADATA')
      .map((r) => r.name);
    const rows = async (): Promise<string[][]> =>
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
    const before = await rows();
    await apply(
      await readFile(
        resolve('apps/worker/migrations/0061_manual_album_deletion.sql'),
        'utf8',
      ),
    );
    assert.deepEqual(await rows(), before);
    const afterSchema: SchemaRow[] = (
      await db
        .prepare(
          'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name',
        )
        .all<SchemaRow>()
    ).results;
    assert.deepEqual(
      afterSchema.filter((r) =>
        oldSchema.some((old) => old.name === r.name && old.type === r.type),
      ),
      oldSchema,
    );
    assert.equal(
      (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
      0,
    );
    assert.equal(
      (
        await db
          .prepare(
            'SELECT * FROM manual_album_deletion_blockers WHERE album_id=?',
          )
          .bind(album)
          .all()
      ).results.length,
      0,
    );
    const job = randomUUID();
    const insert = (
      id: string = job,
      sessionId: string = session,
      count = 6,
      bytes = 54,
    ) =>
      db
        .prepare(
          `INSERT INTO manual_album_deletion_jobs(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,expected_revision,confirmation_name,policy_snapshot,created_at_ms,inventory_count,bytes_before) VALUES(?,?,?,?,?,?,?,1,'Manual delete fixture',?,?,?,?)`,
        )
        .bind(
          id,
          actor,
          sessionId,
          randomUUID(),
          workspace,
          project,
          album,
          JSON.stringify({
            reason: 'manual',
            graceHours: 0,
            minimumRetentionDays: 0,
            confirmed: true,
          }),
          Date.now(),
          count,
          bytes,
        )
        .run();
    await assert.rejects(insert(randomUUID(), 'wrong'), /OWNER_REQUIRED/);
    await assert.rejects(
      insert(randomUUID(), session, 5),
      /DELETE_INVENTORY_CHANGED/,
    );
    await assert.rejects(
      db
        .prepare(
          "UPDATE albums SET state='deleting',revision=revision+1 WHERE id=?",
        )
        .bind(album)
        .run(),
      /INVALID_ALBUM_DELETE_TRANSITION/,
    );
    await db
      .prepare('UPDATE albums SET is_pinned=1 WHERE id=?')
      .bind(album)
      .run();
    await assert.rejects(insert(), /ALBUM_NOT_DELETABLE/);
    assert.equal(
      (
        await db
          .prepare(
            'SELECT blocker FROM manual_album_deletion_blockers WHERE album_id=?',
          )
          .bind(album)
          .first<{ blocker: string }>()
      )?.blocker,
      'DELETE_PROTECTED',
    );
    await db
      .prepare('UPDATE albums SET is_pinned=0 WHERE id=?')
      .bind(album)
      .run();
    await db
      .prepare(
        "CREATE TRIGGER fail_delete_start BEFORE INSERT ON audit_events WHEN NEW.action='album.deletion_started' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END",
      )
      .run();
    await assert.rejects(insert(), /AUDIT_FAILED/);
    assert.equal(
      (
        await db
          .prepare('SELECT state FROM albums WHERE id=?')
          .bind(album)
          .first<{ state: string }>()
      )?.state,
      'active',
    );
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM manual_album_deletion_items')
          .first<{ n: number }>()
      )?.n,
      0,
    );
    await db.prepare('DROP TRIGGER fail_delete_start').run();
    await insert();
    assert.equal(
      (
        await db
          .prepare('SELECT state FROM albums WHERE id=?')
          .bind(album)
          .first<{ state: string }>()
      )?.state,
      'deleting',
    );
    const items = (
      await db
        .prepare(
          'SELECT asset_id,byte_size FROM manual_album_deletion_items WHERE job_id=? ORDER BY asset_id',
        )
        .bind(job)
        .all<{ asset_id: string; byte_size: number }>()
    ).results;
    assert.equal(items.length, 6);
    const original = await db
      .prepare("SELECT * FROM photo_assets WHERE asset_kind='original' LIMIT 1")
      .first<{
        id: string;
        workspace_id: string;
        photo_id: string;
        version_id: string;
        object_key: string;
        checksum_sha256: string;
      }>();
    assert.ok(original);
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'primary','delivery',?,17,'image/jpeg',?,'private')",
        )
        .bind(
          randomUUID(),
          workspace,
          original.photo_id,
          original.version_id,
          original.object_key + '/late',
          original.checksum_sha256,
        )
        .run(),
      /ALBUM_DELETION_IN_PROGRESS/,
    );
    await assert.rejects(
      db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,2,?,?,?,17,'image/jpeg',1,1,'private')",
        )
        .bind(
          randomUUID(),
          workspace,
          original.photo_id,
          original.version_id,
          actor,
          'b'.repeat(64),
        )
        .run(),
      /ALBUM_DELETION_IN_PROGRESS/,
    );
    const update = (
      assetId: string,
      mode: 'fail' | 'reclaim',
      sessionId: string = session,
    ) =>
      db
        .prepare(
          `UPDATE manual_album_deletion_items SET attempts=attempts+1,status=?,last_error_code=?,fence_etag=?,verified_at_ms=?,execution_actor_id=?,execution_session_id=? WHERE job_id=? AND asset_id=? AND status='pending'`,
        )
        .bind(
          mode === 'reclaim' ? 'reclaimed' : 'pending',
          mode === 'fail' ? 'STORAGE_IO_UNCERTAIN' : null,
          mode === 'reclaim' ? 'verified-etag' : null,
          mode === 'reclaim' ? Date.now() : null,
          actor,
          sessionId,
          job,
          assetId,
        )
        .run();
    await assert.rejects(
      update(items[0]!.asset_id, 'reclaim', 'expired'),
      /INVALID_DELETE_ITEM_TRANSITION/,
    );
    await update(items[0]!.asset_id, 'fail');
    assert.equal(
      (
        await db
          .prepare(
            'SELECT used_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace)
          .first<{ used_bytes: number }>()
      )?.used_bytes,
      54,
    );
    await db
      .prepare(
        "CREATE TRIGGER fail_reclaim BEFORE INSERT ON audit_events WHEN NEW.action='storage.asset_reclaimed' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILED'); END",
      )
      .run();
    await assert.rejects(update(items[0]!.asset_id, 'reclaim'), /AUDIT_FAILED/);
    assert.equal(
      (
        await db
          .prepare(
            'SELECT used_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace)
          .first<{ used_bytes: number }>()
      )?.used_bytes,
      54,
    );
    await db.prepare('DROP TRIGGER fail_reclaim').run();
    const continuationSession = randomUUID();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        continuationSession,
        randomUUID(),
        actor,
        Date.now() + 3600000,
        Date.now(),
        Date.now(),
      )
      .run();
    await db
      .prepare('UPDATE owner_sessions SET expiresAt=0 WHERE id=?')
      .bind(session)
      .run();
    await assert.rejects(
      update(items[0]!.asset_id, 'reclaim'),
      /INVALID_DELETE_ITEM_TRANSITION/,
    );
    for (const item of items.slice(0, -1))
      await update(item.asset_id, 'reclaim', continuationSession);
    const last = items.at(-1)!;
    await db
      .prepare(
        "CREATE TRIGGER fail_delete_complete BEFORE INSERT ON audit_events WHEN NEW.action='album.deleted' BEGIN SELECT RAISE(ABORT,'COMPLETION_AUDIT_FAILED'); END",
      )
      .run();
    await assert.rejects(
      update(last.asset_id, 'reclaim', continuationSession),
      /COMPLETION_AUDIT_FAILED/,
    );
    assert.equal(
      (
        await db
          .prepare(
            'SELECT used_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace)
          .first<{ used_bytes: number }>()
      )?.used_bytes,
      last.byte_size,
    );
    assert.equal(
      (
        await db
          .prepare(
            'SELECT status FROM manual_album_deletion_items WHERE job_id=? AND asset_id=?',
          )
          .bind(job, last.asset_id)
          .first<{ status: string }>()
      )?.status,
      'pending',
    );
    await db.prepare('DROP TRIGGER fail_delete_complete').run();
    await update(last.asset_id, 'reclaim', continuationSession);
    assert.equal((await update(items[0]!.asset_id, 'reclaim')).meta.changes, 0);
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
    assert.deepEqual(
      await db
        .prepare(
          'SELECT status,bytes_reclaimed FROM manual_album_deletion_jobs WHERE id=?',
        )
        .bind(job)
        .first(),
      { status: 'completed', bytes_reclaimed: 54 },
    );
    assert.equal(
      (
        await db
          .prepare('SELECT state FROM albums WHERE id=?')
          .bind(album)
          .first<{ state: string }>()
      )?.state,
      'deleted',
    );
    await assert.rejects(
      db
        .prepare(
          "UPDATE albums SET state='active',revision=revision+1 WHERE id=?",
        )
        .bind(album)
        .run(),
      /INVALID_ALBUM_DELETE_TRANSITION/,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM photo_assets')
          .first<{ n: number }>()
      )?.n,
      6,
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM manual_album_deletion_jobs WHERE id=?')
        .bind(job)
        .run(),
      /IMMUTABLE_DELETE_JOB/,
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM manual_album_deletion_items WHERE job_id=?')
        .bind(job)
        .run(),
      /IMMUTABLE_DELETE_ITEM/,
    );
    assert.equal(
      (await db.prepare('PRAGMA foreign_key_check').all()).results.length,
      0,
    );
    // Empty albums also finish atomically without touching quota.
    const empty = randomUUID();
    await db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Empty fixture','draft')",
      )
      .bind(empty, workspace, project)
      .run();
    await db
      .prepare(
        `INSERT INTO manual_album_deletion_jobs(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,expected_revision,confirmation_name,policy_snapshot,created_at_ms,inventory_count,bytes_before) VALUES(?,?,?,?,?,?,?,1,'Empty fixture',?,?,0,0)`,
      )
      .bind(
        randomUUID(),
        actor,
        continuationSession,
        randomUUID(),
        workspace,
        project,
        empty,
        JSON.stringify({
          reason: 'manual',
          graceHours: 0,
          minimumRetentionDays: 0,
          confirmed: true,
        }),
        Date.now(),
      )
      .run();
    assert.equal(
      (
        await db
          .prepare('SELECT state FROM albums WHERE id=?')
          .bind(empty)
          .first<{ state: string }>()
      )?.state,
      'deleted',
    );
  } finally {
    await mf.dispose();
  }
}, 120000);
