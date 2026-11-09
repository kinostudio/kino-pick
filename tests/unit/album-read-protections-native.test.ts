import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { D1AlbumActivationRepository } from '../../apps/worker/src/album-activation';
import { D1AlbumReadProtections } from '../../apps/worker/src/album-read-protections';
import { D1ContentRepository } from '../../apps/worker/src/content';
import { D1ManualAlbumDeletion } from '../../apps/worker/src/manual-album-deletion';
import { R2StorageAdapter } from '../../apps/worker/src/r2-storage';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';

type NativeStatement = {
  bind(...values: (number | string | null)[]): NativeStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};
type NativeD1 = {
  batch(statements: NativeStatement[]): Promise<unknown>;
  prepare(sql: string): NativeStatement;
};
type NativeMiniflare = {
  getD1Database(binding: string, workerName: string): Promise<NativeD1>;
  getR2Bucket(binding: string, workerName: string): Promise<unknown>;
  dispose(): Promise<void>;
};

const workerRequire = createRequire(resolve('apps/worker/package.json'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare') as {
  Miniflare: new (options: unknown) => NativeMiniflare;
  convertV4MiniflareOptions: (options: unknown) => unknown;
};
const { unstable_splitSqlQuery } = workerRequire('wrangler') as {
  unstable_splitSqlQuery: (sql: string) => string[];
};

const workerName = 'album-read-protections-native';
const protectionTrigger = 'album_read_protections_update_guard';

test('native D1 read protection renews leases and blocks deletion without activity writes', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: workerName,
          modules: true,
          script:
            "export default { async fetch() { return new Response('ok'); } };",
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: workerName },
          r2Buckets: { BUCKET: workerName },
        },
      ],
    }),
  );

  try {
    const db = await mf.getD1Database('DB', workerName);
    const bucket = await mf.getR2Bucket('BUCKET', workerName);
    const files = (await readdir(resolve('apps/worker/migrations')))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    assert.equal(files.length, 69, 'fixture applies the complete schema 69');
    assert.equal(files.at(-1), '0069_inherited_share_expiry.sql');

    for (const file of files) {
      const sql = await readFile(
        resolve('apps/worker/migrations', file),
        'utf8',
      );
      await db.batch(
        unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)),
      );
    }

    const actor = randomUUID();
    const session = randomUUID();
    const workspaceId = randomUUID();
    const now = Date.now();
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
      .bind(session, randomUUID(), actor, now + 3_600_000, now, now)
      .run();
    await db
      .prepare(
        'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
      )
      .bind(
        actor,
        randomUUID(),
        session,
        'Read protection fixture',
        workspaceId,
      )
      .run();

    const dbBinding = db as unknown as ConstructorParameters<
      typeof D1ContentRepository
    >[0];
    const content = new D1ContentRepository(dbBinding, actor, session);
    const project = await content.createProject({
      workspaceId,
      name: 'Read protection fixture',
      requestId: randomUUID(),
    });
    const otherProject = await content.createProject({
      workspaceId,
      name: 'Read protection other project',
      requestId: randomUUID(),
    });
    const activation = new D1AlbumActivationRepository(
      dbBinding,
      actor,
      session,
    );
    const createActiveAlbum = async (name: string, projectId = project.id) => {
      const album = await content.createAlbum(projectId, {
        name,
        requestId: randomUUID(),
      });
      return activation.activate(album.id, {
        requestId: randomUUID(),
        expectedRevision: album.revision,
        confirmActivate: true,
      });
    };
    const leasedAlbum = await createActiveAlbum('Lease blocks deletion');
    const renewalAlbum = await createActiveAlbum('Lease renews independently');
    const expiredAlbum = await createActiveAlbum(
      'Expired lease allows deletion',
    );
    const deletedAlbum = await createActiveAlbum(
      'Deleted scope rejects acquire',
    );
    const otherProjectAlbum = await createActiveAlbum(
      'Other project album',
      otherProject.id,
    );

    const protections = new D1AlbumReadProtections(
      db as unknown as ConstructorParameters<typeof D1AlbumReadProtections>[0],
    );
    const scope = (albumId: string, projectId = project.id) => ({
      workspace_id: workspaceId,
      project_id: projectId,
      album_id: albumId,
    });
    const expectWorkspaceFailure = async (
      operation: Promise<unknown>,
      code: string,
      status: number,
    ) => {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof WorkspaceFailure);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
      });
    };
    const expectSqlFailure = async (
      operation: Promise<unknown>,
      expression: RegExp,
    ) => {
      await assert.rejects(
        operation,
        (error: unknown) =>
          error instanceof Error && expression.test(error.message),
      );
    };

    await expectWorkspaceFailure(
      protections.acquire(scope(leasedAlbum.id)),
      'ALBUM_READ_PROTECTION_UNAVAILABLE',
      503,
    );

    const proposal = await readFile(
      resolve(
        'apps/worker/migration-proposals/0071_album_read_protections.sql',
      ),
      'utf8',
    );
    await db.batch(
      unstable_splitSqlQuery(proposal).map((statement) =>
        db.prepare(statement),
      ),
    );
    assert.equal(
      await db
        .prepare('SELECT count(*) AS count FROM photos')
        .first<{ count: number }>()
        .then((row) => row?.count),
      0,
      'the guard fixture has no photo rows or R2 payloads',
    );

    const sideEffects = async () => {
      const audit = await db
        .prepare('SELECT count(*) AS count FROM audit_events')
        .first<{ count: number }>();
      const views = await db
        .prepare('SELECT count(*) AS count FROM human_photo_views')
        .first<{ count: number }>();
      const activity = await db
        .prepare(
          'SELECT album_id,workspace_id,project_id,last_valid_viewed_at_ms,view_event_id FROM album_human_activity ORDER BY album_id',
        )
        .all<Record<string, string | number>>();
      const albums = await db
        .prepare('SELECT id,state,revision FROM albums ORDER BY id')
        .all<{ id: string; state: string; revision: number }>();
      const retention = await db
        .prepare(
          'SELECT album_id,workspace_id,project_id,inactive_days,cleanup_allowed,revision,updated_at_ms FROM album_retention_policy_configurations ORDER BY album_id',
        )
        .all<Record<string, string | number>>();
      const jobs = await db
        .prepare('SELECT count(*) AS count FROM manual_album_deletion_jobs')
        .first<{ count: number }>();
      assert.ok(audit && views && jobs);
      return {
        audit: audit.count,
        views: views.count,
        activity: activity.results,
        albums: albums.results,
        retention: retention.results,
        jobs: jobs.count,
      };
    };
    const beforeAcquires = await sideEffects();
    const dbClock = async () => {
      const row = await db
        .prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms")
        .first<{ now_ms: number }>();
      assert.ok(row);
      return row.now_ms;
    };

    const beforeLease = await dbClock();
    const first = await protections.acquire(scope(leasedAlbum.id));
    const afterLease = await dbClock();
    assert.equal(first.revision, 0);
    assert.ok(first.protectedUntilMs >= beforeLease + 899_000);
    assert.ok(first.protectedUntilMs <= afterLease + 900_001);
    assert.deepEqual(await protections.acquire(scope(leasedAlbum.id)), first);
    assert.deepEqual(
      (
        await db
          .prepare(
            'SELECT blocker FROM manual_album_deletion_blockers WHERE album_id=? ORDER BY blocker',
          )
          .bind(leasedAlbum.id)
          .all<{ blocker: string }>()
      ).results.map(({ blocker }) => blocker),
      ['DELETE_ACTIVE_REVIEW'],
    );

    const secondAlbumLease = await protections.acquire(scope(renewalAlbum.id));
    assert.equal(secondAlbumLease.revision, 0);
    assert.notEqual(leasedAlbum.id, renewalAlbum.id);
    assert.deepEqual(
      (
        await db
          .prepare(
            'SELECT album_id,revision FROM album_read_protections WHERE album_id IN(?,?) ORDER BY album_id',
          )
          .bind(leasedAlbum.id, renewalAlbum.id)
          .all<{ album_id: string; revision: number }>()
      ).results,
      [
        { album_id: leasedAlbum.id, revision: 0 },
        { album_id: renewalAlbum.id, revision: 0 },
      ].sort((left, right) => left.album_id.localeCompare(right.album_id)),
    );
    await expectWorkspaceFailure(
      protections.acquire(scope(leasedAlbum.id, otherProject.id)),
      'ALBUM_READ_PROTECTION_UNAVAILABLE',
      503,
    );
    await expectWorkspaceFailure(
      protections.acquire({
        ...scope(leasedAlbum.id),
        workspace_id: randomUUID(),
      }),
      'ALBUM_READ_PROTECTION_UNAVAILABLE',
      503,
    );
    await expectWorkspaceFailure(
      protections.acquire(scope(randomUUID())),
      'ALBUM_READ_PROTECTION_UNAVAILABLE',
      503,
    );
    await expectWorkspaceFailure(
      protections.acquire(scope(otherProjectAlbum.id, project.id)),
      'ALBUM_READ_PROTECTION_UNAVAILABLE',
      503,
    );

    const row = await db
      .prepare(
        'SELECT album_id,workspace_id,project_id,renewed_at_ms,protected_until_ms,revision FROM album_read_protections WHERE album_id=?',
      )
      .bind(renewalAlbum.id)
      .first<{
        album_id: string;
        workspace_id: string;
        project_id: string;
        renewed_at_ms: number;
        protected_until_ms: number;
        revision: number;
      }>();
    assert.ok(row);
    await expectSqlFailure(
      db
        .prepare(
          'UPDATE album_read_protections SET renewed_at_ms=renewed_at_ms+1,protected_until_ms=protected_until_ms+1 WHERE album_id=?',
        )
        .bind(renewalAlbum.id)
        .run(),
      /ALBUM_READ_PROTECTION/u,
    );
    await expectSqlFailure(
      db
        .prepare(
          'UPDATE album_read_protections SET revision=revision+2 WHERE album_id=?',
        )
        .bind(renewalAlbum.id)
        .run(),
      /ALBUM_READ_PROTECTION/u,
    );
    await expectSqlFailure(
      db
        .prepare(
          'UPDATE album_read_protections SET project_id=? WHERE album_id=?',
        )
        .bind(randomUUID(), renewalAlbum.id)
        .run(),
      /ALBUM_READ_PROTECTION/u,
    );
    await expectSqlFailure(
      db
        .prepare('DELETE FROM album_read_protections WHERE album_id=?')
        .bind(renewalAlbum.id)
        .run(),
      /ALBUM_READ_PROTECTION_IMMUTABLE/u,
    );
    await expectSqlFailure(
      db
        .prepare(
          'INSERT OR REPLACE INTO album_read_protections(album_id,workspace_id,project_id,renewed_at_ms,protected_until_ms,revision) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          row.album_id,
          row.workspace_id,
          row.project_id,
          row.renewed_at_ms,
          row.protected_until_ms,
          row.revision,
        )
        .run(),
      /ALBUM_READ_PROTECTION/u,
    );

    const ageProtection = async (
      albumId: string,
      ageSql: string,
    ): Promise<void> => {
      const trigger = await db
        .prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?')
        .bind('trigger', protectionTrigger)
        .first<{ sql: string }>();
      assert.ok(trigger?.sql, 'the renewal guard exists before fixture aging');
      await db.prepare('DROP TRIGGER ' + protectionTrigger).run();
      try {
        await db.prepare(ageSql).bind(albumId).run();
      } finally {
        await db.prepare(trigger.sql).run();
      }
    };

    await ageProtection(
      renewalAlbum.id,
      "WITH clock AS (SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms) UPDATE album_read_protections SET renewed_at_ms=(SELECT now_ms FROM clock)-120000,protected_until_ms=(SELECT now_ms FROM clock)+780000 WHERE album_id=?",
    );
    const beforeRenewal = await db
      .prepare(
        'SELECT renewed_at_ms,protected_until_ms,revision FROM album_read_protections WHERE album_id=?',
      )
      .bind(renewalAlbum.id)
      .first<{
        renewed_at_ms: number;
        protected_until_ms: number;
        revision: number;
      }>();
    assert.ok(beforeRenewal);
    const renewal = await protections.acquire(scope(renewalAlbum.id));
    assert.equal(renewal.revision, beforeRenewal.revision + 1);
    assert.ok(
      renewal.protectedUntilMs > beforeRenewal.protected_until_ms + 100_000,
    );
    const afterRenewal = await db
      .prepare(
        'SELECT renewed_at_ms,protected_until_ms,revision FROM album_read_protections WHERE album_id=?',
      )
      .bind(renewalAlbum.id)
      .first<{
        renewed_at_ms: number;
        protected_until_ms: number;
        revision: number;
      }>();
    assert.ok(afterRenewal);
    assert.equal(afterRenewal.revision, renewal.revision);
    assert.ok(afterRenewal.renewed_at_ms >= beforeRenewal.renewed_at_ms);

    assert.deepEqual(await sideEffects(), beforeAcquires);

    const deletionStorage = new R2StorageAdapter(
      bucket as ConstructorParameters<typeof R2StorageAdapter>[0],
    );
    // shortcut: no pre-existing deleting job without photo rows; add a metadata fixture if acquire's existing-job gate becomes in-scope.
    const deletion = new D1ManualAlbumDeletion(
      db as unknown as ConstructorParameters<typeof D1ManualAlbumDeletion>[0],
      deletionStorage,
      actor,
      session,
    );
    assert.deepEqual(
      (await deletion.preview(leasedAlbum.id)).preview.blockers,
      ['DELETE_ACTIVE_REVIEW'],
    );
    await expectSqlFailure(
      deletion.start(leasedAlbum.id, {
        requestId: randomUUID(),
        expectedRevision: leasedAlbum.revision,
        confirmationName: leasedAlbum.name,
        inventoryCount: 0,
        bytesBefore: 0,
        confirmPermanent: true,
      }),
      /ALBUM_READ_PROTECTION_ACTIVE/u,
    );
    await expectSqlFailure(
      db
        .prepare(
          "UPDATE albums SET state='deleting',revision=revision+1 WHERE id=?",
        )
        .bind(leasedAlbum.id)
        .run(),
      /ALBUM_READ_PROTECTION_ACTIVE/u,
    );
    const blocked = await db
      .prepare('SELECT state,revision FROM albums WHERE id=?')
      .bind(leasedAlbum.id)
      .first<{ state: string; revision: number }>();
    assert.deepEqual(blocked, {
      state: leasedAlbum.state,
      revision: leasedAlbum.revision,
    });
    assert.equal(
      await db
        .prepare(
          'SELECT count(*) AS count FROM manual_album_deletion_jobs WHERE album_id=?',
        )
        .bind(leasedAlbum.id)
        .first<{ count: number }>()
        .then((result) => result?.count),
      0,
    );

    await protections.acquire(scope(expiredAlbum.id));
    await ageProtection(
      expiredAlbum.id,
      'UPDATE album_read_protections SET renewed_at_ms=0,protected_until_ms=900000 WHERE album_id=?',
    );
    assert.deepEqual(
      (
        await db
          .prepare(
            'SELECT blocker FROM manual_album_deletion_blockers WHERE album_id=? ORDER BY blocker',
          )
          .bind(expiredAlbum.id)
          .all<{ blocker: string }>()
      ).results,
      [],
    );
    assert.deepEqual(
      (await deletion.preview(expiredAlbum.id)).preview.blockers,
      [],
    );
    const deleted = await deletion.start(deletedAlbum.id, {
      requestId: randomUUID(),
      expectedRevision: deletedAlbum.revision,
      confirmationName: deletedAlbum.name,
      inventoryCount: 0,
      bytesBefore: 0,
      confirmPermanent: true,
    });
    assert.equal(deleted.job?.status, 'completed');
    const deletedState = await db
      .prepare('SELECT state FROM albums WHERE id=?')
      .bind(deletedAlbum.id)
      .first<{ state: string }>();
    assert.equal(deletedState?.state, 'deleted');
    await expectWorkspaceFailure(
      protections.acquire(scope(deletedAlbum.id)),
      'ALBUM_READ_PROTECTION_UNAVAILABLE',
      503,
    );
    const expiredDeletion = await deletion.start(expiredAlbum.id, {
      requestId: randomUUID(),
      expectedRevision: expiredAlbum.revision,
      confirmationName: expiredAlbum.name,
      inventoryCount: 0,
      bytesBefore: 0,
      confirmPermanent: true,
    });
    assert.equal(expiredDeletion.job?.status, 'completed');
    const expiredState = await db
      .prepare('SELECT state FROM albums WHERE id=?')
      .bind(expiredAlbum.id)
      .first<{ state: string }>();
    assert.equal(expiredState?.state, 'deleted');
  } finally {
    await mf.dispose();
  }
}, 60_000);
