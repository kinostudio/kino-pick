import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { test, expect } from 'vitest';
const userA = '11111111-1111-4111-8111-111111111111',
  userB = '22222222-2222-4222-8222-222222222222';
const wa = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  wb = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
test('migration executes with tenant RLS, safe defaults, composite FKs and no anonymous/writer grants', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create schema auth; create role anon; create role authenticated; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth, public to authenticated, anon; grant execute on function auth.uid() to authenticated;`,
    );
    await db.exec(
      await readFile(
        new URL(
          '../../packages/db/migrations/202610230001_foundation.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await db.exec(
      `insert into auth.users values('${userA}'),('${userB}'); insert into workspaces(id,owner_user_id,name) values('${wa}','${userA}','A'),('${wb}','${userB}','B'); insert into projects(id,workspace_id,name) values('${wa}','${wa}','A'),('${wb}','${wb}','B'); insert into albums(id,workspace_id,project_id,name) values('${wa}','${wa}','${wa}','A'),('${wb}','${wb}','${wb}','B'); insert into photos(workspace_id,project_id,album_id,original_filename,canonical_name) values('${wa}','${wa}','${wa}','A.jpg','A'),('${wb}','${wb}','${wb}','B.jpg','B');`,
    );
    await expect(
      db.exec(
        `insert into albums(workspace_id,project_id,name) values('${wa}','${wb}','cross')`,
      ),
    ).rejects.toThrow();
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`,
    );
    for (const table of ['workspaces', 'projects', 'albums', 'photos']) {
      const result = await db.query(
        `select ${table === 'workspaces' ? 'id' : 'workspace_id'} as workspace from ${table}`,
      );
      expect(result.rows).toEqual([{ workspace: wa }]);
    }
    expect(
      (
        await db.query(
          'select autodelete_enabled,retention_dry_run from workspaces',
        )
      ).rows,
    ).toEqual([{ autodelete_enabled: false, retention_dry_run: true }]);
    await expect(
      db.exec(
        `insert into projects(workspace_id,name) values('${wa}','forbidden')`,
      ),
    ).rejects.toThrow();
    await db.exec(
      `select set_config('request.jwt.claim.sub','${userB}',false);`,
    );
    expect((await db.query('select id from projects')).rows).toEqual([
      { id: wb },
    ]);
    await db.exec('set role anon');
    await expect(db.query('select * from photos')).rejects.toThrow();
    await db.exec(
      `reset role; insert into workspace_members values('${wb}','${userA}','retoucher','active'); set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false);`,
    );
    expect((await db.query('select id from workspaces')).rows).toHaveLength(2);
    await db.exec(
      `reset role; update workspace_members set status='suspended'; set role authenticated;`,
    );
    expect((await db.query('select id from workspaces')).rows).toEqual([
      { id: wa },
    ]);
  } finally {
    await db.close();
  }
}, 30000);
