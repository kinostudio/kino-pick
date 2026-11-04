import { DatabaseSync } from 'node:sqlite';
import { Hono } from '../../apps/worker/node_modules/hono';
import { describe, expect, it } from 'vitest';
import type { WorkerEnv } from '../../apps/worker/src/config';
import {
  stagingCollaborationGuestRequestAllowed,
  stagingCollaborationOwnerScope,
} from '../../apps/worker/src/staging-collaboration-boundary';
import { STAGING_GUEST_SCOPE as scope } from '../../apps/worker/src/staging-guest-scope';

const owner = 'owner';
const project = '11111111-1111-4111-8111-111111111111';
const album = '22222222-2222-4222-8222-222222222222';
const otherProject = '33333333-3333-4333-8333-333333333333';
const otherAlbum = '44444444-4444-4444-8444-444444444444';
const photo = '55555555-5555-4555-8555-555555555555';
const upload = '66666666-6666-4666-8666-666666666666';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,owner_user_id TEXT);
    CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,status TEXT);
    CREATE TABLE albums(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,state TEXT);
    CREATE TABLE request_commands(actor_id TEXT,operation TEXT,resource_id TEXT,workspace_id TEXT,result_json TEXT);
    CREATE TABLE audit_events(project_id TEXT,action TEXT);
    CREATE TABLE photos(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,album_id TEXT);
    CREATE TABLE photo_versions(id TEXT,photo_id TEXT,workspace_id TEXT);
    CREATE TABLE upload_sessions(id TEXT PRIMARY KEY,actor_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT);
    CREATE TABLE upload_requests(actor_id TEXT,request_id TEXT,operation TEXT,upload_session_id TEXT);
    CREATE TABLE upload_version_targets(upload_session_id TEXT,photo_id TEXT);
  `);
  const run = (sql: string, ...bindings: Array<string | null>) =>
    sqlite.prepare(sql).run(...bindings);
  run('INSERT INTO workspaces VALUES(?,?)', scope.workspaceId, owner);
  run(
    'INSERT INTO projects VALUES(?,?,?)',
    scope.projectId,
    scope.workspaceId,
    'draft',
  );
  run(
    'INSERT INTO albums VALUES(?,?,?,?)',
    scope.albumId,
    scope.workspaceId,
    scope.projectId,
    'active',
  );
  run(
    'INSERT INTO projects VALUES(?,?,?)',
    project,
    scope.workspaceId,
    'draft',
  );
  run(
    'INSERT INTO albums VALUES(?,?,?,?)',
    album,
    scope.workspaceId,
    project,
    'draft',
  );
  run(
    'INSERT INTO request_commands VALUES(?,?,?,?,?)',
    owner,
    'project.created',
    project,
    scope.workspaceId,
    JSON.stringify({ id: project, workspaceId: scope.workspaceId }),
  );
  run(
    'INSERT INTO request_commands VALUES(?,?,?,?,?)',
    owner,
    'album.created',
    album,
    scope.workspaceId,
    JSON.stringify({
      id: album,
      workspaceId: scope.workspaceId,
      projectId: project,
    }),
  );
  run(
    'INSERT INTO photos VALUES(?,?,?,?)',
    photo,
    scope.workspaceId,
    project,
    album,
  );
  run(
    'INSERT INTO upload_sessions VALUES(?,?,?,?,?)',
    upload,
    owner,
    scope.workspaceId,
    project,
    album,
  );
  const db = {
    prepare(sql: string) {
      let bindings: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) {
          bindings = values;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...bindings) ?? null;
        },
      };
    },
  } as unknown as D1Database;
  const env = {
    DB: db,
    APP_ENV: 'staging',
    APP_URL: scope.origin,
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    STAGING_GUEST_VALIDATION: 'true',
    STAGING_COLLABORATION_VALIDATION: 'true',
    R2_ACCOUNT_ID: scope.accountId,
    R2_BUCKET_NAME: scope.bucket,
  } as unknown as WorkerEnv;
  const app = new Hono<{
    Bindings: WorkerEnv;
    Variables: { ownerId: string; sessionId: string };
  }>();
  app.use('*', async (c, next) => {
    c.set('ownerId', owner);
    c.set('sessionId', 'owner-session');
    return next();
  });
  app.use('*', stagingCollaborationOwnerScope);
  app.all('*', (c) => c.json({ admitted: true }));
  const request = (path: string, method = 'GET', body?: object) =>
    app.request(
      'https://example.test' + path,
      {
        method,
        ...(body
          ? {
              body: JSON.stringify(body),
              headers: { 'content-type': 'application/json' },
            }
          : {}),
      },
      env,
    );
  return { sqlite, run, request };
}

describe('managed Owner staging scopes', () => {
  it('admits creation, managed albums/photos/uploads and both existing and new resources', async () => {
    const f = fixture();
    try {
      for (const [path, method, body] of [
        ['/api/v1/projects', 'POST', { workspaceId: scope.workspaceId }],
        ['/api/v1/projects?workspaceId=' + scope.workspaceId, 'GET'],
        ['/api/v1/projects/' + project, 'GET'],
        ['/api/v1/projects/' + project + '/albums', 'POST', {}],
        ['/api/v1/projects/' + project + '/albums', 'GET'],
        ['/api/v1/albums/' + album + '/photos', 'GET'],
        ['/api/v1/albums/' + album + '/activate', 'POST', {}],
        ['/api/v1/photos/' + photo + '/pin', 'PUT', {}],
        ['/api/v1/uploads/' + upload + '/authorize', 'POST', {}],
        [
          '/api/v1/uploads/init',
          'POST',
          {
            workspaceId: scope.workspaceId,
            projectId: project,
            albumId: album,
          },
        ],
        ['/api/v1/albums/' + scope.albumId + '/photos', 'GET'],
        ['/api/v1/projects/' + project, 'DELETE', {}],
        ['/api/v1/albums/' + album, 'DELETE', {}],
        ['/api/v1/albums/' + album + '/deletion', 'GET'],
        ['/api/v1/albums/' + album + '/deletion/retry', 'POST', {}],
      ] as const) {
        expect((await f.request(path, method, body)).status, path).toBe(200);
      }
    } finally {
      f.sqlite.close();
    }
  });

  it('keeps unmanaged, wrong-actor, partial-result, tenant and Guest scopes closed', async () => {
    const f = fixture();
    try {
      f.run(
        'INSERT INTO projects VALUES(?,?,?)',
        otherProject,
        scope.workspaceId,
        'draft',
      );
      f.run(
        'INSERT INTO albums VALUES(?,?,?,?)',
        otherAlbum,
        scope.workspaceId,
        project,
        'draft',
      );
      expect((await f.request('/api/v1/projects/' + otherProject)).status).toBe(
        404,
      );
      expect(
        (await f.request('/api/v1/projects?workspaceId=' + scope.workspaceId))
          .status,
      ).toBe(404);
      expect(
        (await f.request('/api/v1/projects/' + project + '/albums')).status,
      ).toBe(404);
      expect(
        (await f.request('/api/v1/albums/' + otherAlbum + '/photos')).status,
      ).toBe(404);
      f.run(
        'UPDATE request_commands SET actor_id=? WHERE resource_id=?',
        'other-owner',
        project,
      );
      expect((await f.request('/api/v1/projects/' + project)).status).toBe(404);
      f.run(
        'UPDATE request_commands SET actor_id=?,result_json=? WHERE resource_id=?',
        owner,
        JSON.stringify({ id: project, workspaceId: otherProject }),
        project,
      );
      expect((await f.request('/api/v1/projects/' + project)).status).toBe(404);
      f.run(
        'UPDATE request_commands SET actor_id=?,result_json=NULL WHERE resource_id=?',
        owner,
        project,
      );
      expect((await f.request('/api/v1/projects/' + project)).status).toBe(404);
      expect(
        (
          await f.request('/api/v1/projects', 'POST', {
            workspaceId: otherProject,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await f.request(
            '/api/v1/projects/' + project + '/invites',
            'POST',
            {},
          )
        ).status,
      ).toBe(404);
      expect(
        stagingCollaborationGuestRequestAllowed(
          'GET',
          '/api/guest/albums/' + album + '/photos',
        ),
      ).toBe(false);
      f.run('UPDATE workspaces SET owner_user_id=?', 'other-owner');
      expect(
        (await f.request('/api/v1/albums/' + scope.albumId + '/photos')).status,
      ).toBe(404);
    } finally {
      f.sqlite.close();
    }
  });

  it('denies deleted resources except delete retries and never deletes the original acceptance scope', async () => {
    const f = fixture();
    try {
      expect(
        (await f.request('/api/v1/projects/' + scope.projectId, 'DELETE', {}))
          .status,
      ).toBe(404);
      expect(
        (await f.request('/api/v1/albums/' + scope.albumId, 'DELETE', {}))
          .status,
      ).toBe(404);
      expect(
        (
          await f.request(
            '/api/v1/albums/' + scope.albumId + '/deletion/retry',
            'POST',
            {},
          )
        ).status,
      ).toBe(404);
      f.run("UPDATE albums SET state='deleted' WHERE id=?", album);
      expect(
        (await f.request('/api/v1/albums/' + album + '/photos')).status,
      ).toBe(404);
      expect(
        (await f.request('/api/v1/albums/' + album, 'PATCH', {})).status,
      ).toBe(404);
      expect(
        (await f.request('/api/v1/albums/' + album, 'DELETE', {})).status,
      ).toBe(200);
      expect(
        (await f.request('/api/v1/albums/' + album + '/deletion')).status,
      ).toBe(200);
      expect(
        (
          await f.request(
            '/api/v1/albums/' + album + '/deletion/retry',
            'POST',
            {},
          )
        ).status,
      ).toBe(200);
      f.run("INSERT INTO audit_events VALUES(?,'project.deleted')", project);
      expect((await f.request('/api/v1/projects/' + project)).status).toBe(404);
      expect(
        (await f.request('/api/v1/projects/' + project + '/albums', 'POST', {}))
          .status,
      ).toBe(404);
      expect(
        (await f.request('/api/v1/projects/' + project, 'DELETE', {})).status,
      ).toBe(200);
    } finally {
      f.sqlite.close();
    }
  });
});
