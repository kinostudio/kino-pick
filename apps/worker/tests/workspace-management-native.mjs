import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { D1ContentRepository } from '../src/content.ts';
import { deleteEmptyProject } from '../src/project-deletion.ts';
import { D1WorkspaceManagementRepository } from '../src/workspace-management.ts';
import { D1WorkspaceRepository } from '../src/workspaces.ts';
import { applyMigration } from './apply-migration.mjs';

const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'workspace-management-native',
        modules: true,
        script:
          'export default {fetch(){return new Response(null,{status:404})}}',
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: { DB: 'workspace-management-native' },
      },
    ],
  }),
);

const code = (error) => {
  if (error && typeof error === 'object' && 'code' in error) return error.code;
  return error instanceof Error ? error.message : String(error);
};
const check = async (label, action) => {
  await action();
  process.stdout.write(`passed: ${label}\n`);
};

try {
  const db = await mf.getD1Database('DB', 'workspace-management-native');
  const migrations = (await readdir(resolve('apps/worker/migrations')))
    .filter(
      (name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 73,
    )
    .sort();
  assert.equal(
    migrations.length,
    73,
    'apply the exact 0001-0073 migration set',
  );
  for (const migration of migrations) {
    await applyMigration(
      db,
      await readFile(resolve('apps/worker/migrations', migration), 'utf8'),
    );
  }

  const actor = randomUUID();
  const session = `Native.Workspace.${randomUUID()}`;
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(actor, `workspace-management-${randomUUID()}`)
    .run();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(session, randomUUID(), actor, now + 3_600_000, now, now)
    .run();

  const workspaces = new D1WorkspaceRepository(db, actor, session);
  const content = new D1ContentRepository(db, actor, session);
  const manager = new D1WorkspaceManagementRepository(db, actor, session);
  const primary = await workspaces.create({
    name: 'Workspace before rename',
    requestId: randomUUID(),
  });
  const occupied = await workspaces.create({
    name: 'Already in use',
    requestId: randomUUID(),
  });

  await check('owner session and workspace scope are required', async () => {
    await assert.rejects(
      new D1WorkspaceManagementRepository(db, actor, 'missing-session').rename(
        primary.id,
        {
          name: 'Rejected',
          expectedName: primary.name,
          requestId: randomUUID(),
        },
      ),
      (error) => String(code(error)).includes('OWNER_REQUIRED'),
    );
    await db
      .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
      .bind(actor)
      .run();
    await assert.rejects(
      manager.rename(primary.id, {
        name: 'Rejected',
        expectedName: primary.name,
        requestId: randomUUID(),
      }),
      (error) => String(code(error)).includes('OWNER_REQUIRED'),
    );
    await db
      .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
      .bind(actor)
      .run();
    await assert.rejects(
      manager.rename(randomUUID(), {
        name: 'Rejected',
        expectedName: primary.name,
        requestId: randomUUID(),
      }),
      (error) => String(code(error)).includes('NOT_FOUND'),
    );
  });

  await check(
    'rename CAS, duplicate name, and replay are enforced',
    async () => {
      await assert.rejects(
        manager.rename(primary.id, {
          name: 'Rejected',
          expectedName: 'stale name',
          requestId: randomUUID(),
        }),
        (error) => String(code(error)).includes('CONCURRENT_MODIFICATION'),
      );
      await assert.rejects(
        manager.rename(primary.id, {
          name: occupied.name,
          expectedName: primary.name,
          requestId: randomUUID(),
        }),
        (error) => String(code(error)).includes('WORKSPACE_NAME_CONFLICT'),
      );
      const requestId = randomUUID();
      const input = {
        name: 'Renamed workspace',
        expectedName: primary.name,
        requestId,
      };
      const first = await manager.rename(primary.id, input);
      const replay = await manager.rename(primary.id, input);
      assert.deepEqual(replay, first);
      assert.equal(first.name, input.name);
      assert.equal(first.ownerUserId, actor);
      assert.equal(first.role, 'workspace_owner');
      assert.equal(
        Number(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE action='workspace.renamed' AND request_id=?",
              )
              .bind(requestId)
              .first()
          ).n,
        ),
        1,
      );
    },
  );

  await check(
    'request IDs cannot cross existing command namespaces',
    async () => {
      const requestId = randomUUID();
      await workspaces.create({ name: 'Namespace source', requestId });
      await assert.rejects(
        manager.rename(primary.id, {
          name: 'Namespace collision',
          expectedName: 'Renamed workspace',
          requestId,
        }),
        (error) => String(code(error)).includes('REQUEST_ID_CONFLICT'),
      );
    },
  );

  const nonempty = await workspaces.create({
    name: 'Nonempty workspace',
    requestId: randomUUID(),
  });
  const nonemptyProject = await content.createProject({
    workspaceId: nonempty.id,
    name: 'Active project',
    requestId: randomUUID(),
  });
  await check('workspace deletion rejects an active project', async () => {
    await assert.rejects(
      manager.delete(nonempty.id, {
        expectedName: nonempty.name,
        requestId: randomUUID(),
      }),
      (error) => String(code(error)).includes('WORKSPACE_NOT_EMPTY'),
    );
    assert.equal(
      (
        await db
          .prepare('SELECT status FROM projects WHERE id=?')
          .bind(nonemptyProject.id)
          .first()
      ).status,
      'draft',
    );
  });

  const emptyable = await workspaces.create({
    name: 'Workspace with history',
    requestId: randomUUID(),
  });
  const deletedProject = await content.createProject({
    workspaceId: emptyable.id,
    name: 'Deleted project history',
    requestId: randomUUID(),
  });
  await deleteEmptyProject(db, actor, session, deletedProject.id, {
    confirmationName: deletedProject.name,
    expectedRevision: deletedProject.revision,
    requestId: randomUUID(),
  });

  await check(
    'deleted project history permits workspace tombstone',
    async () => {
      const requestId = randomUUID();
      const deleted = await manager.delete(emptyable.id, {
        expectedName: emptyable.name,
        requestId,
      });
      const replay = await manager.delete(emptyable.id, {
        expectedName: emptyable.name,
        requestId,
      });
      assert.deepEqual(deleted, replay);
      assert.equal(deleted.id, emptyable.id);
      assert.equal(deleted.name, emptyable.name);
      assert.ok(deleted.deletedAtMs > 0);
      assert.equal(
        (
          await db
            .prepare('SELECT status FROM projects WHERE id=?')
            .bind(deletedProject.id)
            .first()
        ).status,
        'archived',
      );
    },
  );

  await check(
    'tombstoned workspace is hidden and cannot regain projects',
    async () => {
      const listed = await workspaces.list();
      assert.ok(
        !listed.workspaces.some((workspace) => workspace.id === emptyable.id),
      );
      await assert.rejects(content.listProjects(emptyable.id), (error) =>
        String(code(error)).includes('NOT_FOUND'),
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO projects(id,workspace_id,name) VALUES(?,?,'Direct insert')",
          )
          .bind(randomUUID(), emptyable.id)
          .run(),
        /NOT_FOUND/u,
      );
      await assert.rejects(
        db
          .prepare("UPDATE projects SET status='draft' WHERE id=?")
          .bind(deletedProject.id)
          .run(),
        /NOT_FOUND/u,
      );
      assert.equal(
        Number(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE workspace_id=? AND action='workspace.deleted'",
              )
              .bind(emptyable.id)
              .first()
          ).n,
        ),
        1,
      );
    },
  );
} finally {
  await mf.dispose();
}
