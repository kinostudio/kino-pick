import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'vitest';
import { readImageProcessingPolicy } from '../../apps/worker/src/image-processing-policy';
import { D1WorkspaceRepository } from '../../apps/worker/src/workspaces';

const require = createRequire(resolve('apps/worker/package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { unstable_splitSqlQuery } = require('wrangler') as {
  unstable_splitSqlQuery(sql: string): string[];
};

test('new workspace policy is committed exactly once and older creates retain their original policy', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'workspace-default',
          modules: true,
          script: "export default {fetch(){return new Response('ok')}}",
          compatibilityDate: '2026-10-23',
          d1Databases: { DB: 'workspace-default' },
        },
      ],
    }),
  );
  try {
    const db = (await mf.getD1Database(
      'DB',
      'workspace-default',
    )) as D1Database;
    const migrations = 'apps/worker/migrations';
    for (const name of (await readdir(migrations))
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort()) {
      const sql = await readFile(resolve(migrations, name), 'utf8');
      await db.batch(
        unstable_splitSqlQuery(sql).map((part) => db.prepare(part)),
      );
    }
    const owner = randomUUID();
    const session = randomUUID();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
      )
      .bind(owner, 'synthetic-workspace-owner')
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,createdAt,updatedAt,expiresAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(session, randomUUID(), owner, now, now, now + 3600000)
      .run();
    const repository = new D1WorkspaceRepository(db, owner, session);
    const newCommand = { name: 'Browser default', requestId: randomUUID() };
    const workspace = await repository.create(newCommand, true);
    assert.deepEqual(await repository.create(newCommand, true), workspace);
    assert.deepEqual(
      await readImageProcessingPolicy(db, owner, session, workspace.id),
      {
        workspaceId: workspace.id,
        recipe: 'browser-first-jpeg-82-v1',
        revision: 1,
      },
    );
    const oldCommand = { name: 'Existing workspace', requestId: randomUUID() };
    const older = await repository.create(oldCommand);
    assert.deepEqual(await repository.create(oldCommand, true), older);
    assert.equal(
      (await readImageProcessingPolicy(db, owner, session, older.id)).revision,
      0,
    );
  } finally {
    await mf.dispose();
  }
}, 45_000);
