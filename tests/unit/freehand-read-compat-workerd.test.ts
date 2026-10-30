import { createHash } from 'node:crypto';
import { Hono } from '../../apps/worker/node_modules/hono';
import {
  Miniflare,
  convertV4MiniflareOptions,
} from '../../apps/worker/node_modules/miniflare/dist/src/index.js';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { guestAnnotationRoutes } from '../../apps/worker/src/guest-annotation-routes';
import { ownerAnnotationAuthoringRoutes } from '../../apps/worker/src/owner-annotation-authoring-routes';
import { D1OwnerAnnotationsRepository } from '../../apps/worker/src/owner-annotations';
import { ownerAnnotationRoutes } from '../../apps/worker/src/owner-annotation-routes';
import {
  ANNOTATION_CLIENT_UPGRADE_REQUIRED,
  preflightFreehandAnnotationRead,
} from '../../apps/worker/src/freehand-read-compat';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';

const id = {
  owner: '11111111-1111-4111-8111-111111111111',
  ownerSession: '12121212-1212-4121-8121-121212121212',
  workspace: '22222222-2222-4222-8222-222222222222',
  project: '33333333-3333-4333-8333-333333333333',
  album: '44444444-4444-4444-8444-444444444444',
  invite1: '55555555-5555-4555-8555-555555555555',
  invite2: '56565656-5656-4565-8565-565656565656',
  photo: '66666666-6666-4666-8666-666666666666',
  version: '77777777-7777-4777-8777-777777777777',
  guest1: '88888888-8888-4888-8888-888888888888',
  session1: '99999999-9999-4999-8999-999999999999',
  guest2: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  session2: 'abababab-abab-4bab-8bab-abababababab',
  target: 'acacacac-acac-4cac-8cac-acacacacacac',
  race: 'adadadad-abab-4dad-8dad-adadadadadad',
};
const secret1 = 'a'.repeat(64);
const secret2 = 'b'.repeat(64);
const base = 'http://127.0.0.1:8787';
const path =
  '/api/guest/albums/' +
  id.album +
  '/photos/' +
  id.photo +
  '/versions/' +
  id.version +
  '/annotations';
const envBase = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  GUEST_EXCHANGE_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'false',
};

const schema = `
CREATE TABLE owners(user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
CREATE TABLE owner_sessions(id TEXT PRIMARY KEY, userId TEXT, expiresAt INTEGER);
CREATE TABLE workspaces(id TEXT PRIMARY KEY, owner_user_id TEXT);
CREATE TABLE projects(id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT);
CREATE TABLE albums(id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, state TEXT);
CREATE TABLE guest_invites(id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, permissions_mask INTEGER, created_by TEXT, expires_at_ms INTEGER);
CREATE TABLE guest_invite_seals(invite_id TEXT PRIMARY KEY);
CREATE TABLE guest_invite_albums(invite_id TEXT, workspace_id TEXT, project_id TEXT, album_id TEXT);
CREATE TABLE guest_sessions(id TEXT PRIMARY KEY, invite_id TEXT, guest_id TEXT, secret_hash TEXT, expires_at_ms INTEGER);
CREATE TABLE guest_identities(id TEXT PRIMARY KEY, invite_id TEXT);
CREATE TABLE guest_invite_revocations(invite_id TEXT PRIMARY KEY);
CREATE TABLE guest_session_revocations(session_id TEXT PRIMARY KEY);
CREATE TABLE photos(id TEXT PRIMARY KEY, workspace_id TEXT, project_id TEXT, album_id TEXT);
CREATE TABLE photo_versions(id TEXT PRIMARY KEY, workspace_id TEXT, photo_id TEXT);
CREATE VIEW guest_annotation_eligible_versions AS SELECT v.id AS version_id,v.photo_id,p.workspace_id,p.project_id,p.album_id FROM photo_versions v JOIN photos p ON p.id=v.photo_id;
CREATE VIEW guest_comment_eligible_versions AS SELECT v.id AS version_id,v.photo_id,p.workspace_id,p.project_id,p.album_id FROM photo_versions v JOIN photos p ON p.id=v.photo_id;
CREATE TABLE guest_annotations(id TEXT PRIMARY KEY,invite_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT,photo_id TEXT,version_id TEXT,author_guest_id TEXT,revision INTEGER,geometry_json TEXT,style_json TEXT,linked_comment_id TEXT,state TEXT,author_label TEXT,created_at_ms INTEGER,updated_at_ms INTEGER);
CREATE TABLE owner_annotations(id TEXT PRIMARY KEY,invite_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT,photo_id TEXT,version_id TEXT,author_user_id TEXT,revision INTEGER,geometry_json TEXT,style_json TEXT,linked_comment_id TEXT,state TEXT,author_label TEXT,created_at_ms INTEGER,updated_at_ms INTEGER);
CREATE TABLE guest_annotation_changes(seq INTEGER,guest_id TEXT,invite_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT,photo_id TEXT,version_id TEXT,annotation_id TEXT,operation TEXT,revision INTEGER);
CREATE TABLE owner_annotation_changes(seq INTEGER,actor_id TEXT,invite_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT,photo_id TEXT,version_id TEXT);
CREATE TABLE owner_annotation_processing_changes(seq INTEGER,invite_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT,photo_id TEXT,version_id TEXT);
CREATE TABLE owner_annotation_processing_states(annotation_id TEXT,invite_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT,photo_id TEXT,version_id TEXT,state TEXT,revision INTEGER,annotation_revision INTEGER,content_revision INTEGER,updated_at_ms INTEGER);
`;

let mf: Miniflare;
// The fixture wraps a partial D1 interface to inject a race.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let env: any;

const ownerApp = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { ownerId: string; sessionId: string };
}>();
ownerApp.use('*', async (c, next) => {
  c.set('ownerId', id.owner);
  c.set('sessionId', id.ownerSession);
  await next();
});
ownerApp.route('/', ownerAnnotationRoutes as never);
ownerApp.route('/', ownerAnnotationAuthoringRoutes as never);
const hashSecret = (secret: string) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');

async function run(sql: string, ...values: (string | number | null)[]) {
  return db
    .prepare(sql)
    .bind(...values)
    .run();
}

async function reset() {
  await db.exec(`
    DELETE FROM guest_annotations;
    DELETE FROM owner_annotations;
    DELETE FROM guest_annotation_changes;
    DELETE FROM owner_annotation_changes;
    DELETE FROM owner_annotation_processing_changes;
    DELETE FROM owner_annotation_processing_states;
    DELETE FROM guest_sessions;
    DELETE FROM guest_identities;
    DELETE FROM guest_invite_albums;
    DELETE FROM guest_invite_seals;
    DELETE FROM guest_invites;
    DELETE FROM owner_sessions;
    DELETE FROM owners;
    DELETE FROM photos;
    DELETE FROM photo_versions;
    DELETE FROM albums;
    DELETE FROM projects;
    DELETE FROM workspaces;
    DELETE FROM guest_invite_revocations;
    DELETE FROM guest_session_revocations;
  `);
  const expiry = Date.now() + 3_600_000;
  await run('INSERT INTO owners VALUES(?,1)', id.owner);
  await run(
    'INSERT INTO owner_sessions VALUES(?,?,?)',
    id.ownerSession,
    id.owner,
    expiry,
  );
  await run('INSERT INTO workspaces VALUES(?,?)', id.workspace, id.owner);
  await run(
    "INSERT INTO projects VALUES(?,?,'reviewing')",
    id.project,
    id.workspace,
  );
  await run(
    "INSERT INTO albums VALUES(?,?,?,'active')",
    id.album,
    id.workspace,
    id.project,
  );
  for (const [invite, guest, session, secret] of [
    [id.invite1, id.guest1, id.session1, secret1],
    [id.invite2, id.guest2, id.session2, secret2],
  ] as const) {
    await run(
      'INSERT INTO guest_invites VALUES(?,?,?,?,?,?)',
      invite,
      id.workspace,
      id.project,
      128,
      id.owner,
      expiry,
    );
    await run('INSERT INTO guest_invite_seals VALUES(?)', invite);
    await run(
      'INSERT INTO guest_invite_albums VALUES(?,?,?,?)',
      invite,
      id.workspace,
      id.project,
      id.album,
    );
    await run('INSERT INTO guest_identities VALUES(?,?)', guest, invite);
    await run(
      'INSERT INTO guest_sessions VALUES(?,?,?,?,?)',
      session,
      invite,
      guest,
      hashSecret(secret),
      expiry,
    );
  }
  await run(
    'INSERT INTO photos VALUES(?,?,?,?)',
    id.photo,
    id.workspace,
    id.project,
    id.album,
  );
  await run(
    'INSERT INTO photo_versions VALUES(?,?,?)',
    id.version,
    id.workspace,
    id.photo,
  );
  env = { ...envBase, DB: db };
}

const rect = (n = 0) => ({
  type: 'rectangle',
  coordinateSpace: 'normalized_1e6',
  x: 10_000 + n,
  y: 20_000 + n,
  width: 30_000,
  height: 40_000,
});
const freehand = (n = 0) => ({
  type: 'freehand',
  coordinateSpace: 'normalized_1e6',
  version: 1,
  points: [
    { x: n, y: n },
    { x: n + 1, y: n + 1 },
  ],
});

async function insertGuest(
  invite: string,
  guest: string,
  annotation: string,
  geometry: unknown,
  seq: number,
) {
  const created = Date.now() - 10_000 + seq;
  await run(
    'INSERT INTO guest_annotations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    annotation,
    invite,
    id.workspace,
    id.project,
    id.album,
    id.photo,
    id.version,
    guest,
    1,
    JSON.stringify(geometry),
    JSON.stringify({ color: 'amber' }),
    null,
    'open',
    guest === id.guest1 ? 'Guest One' : 'Guest Two',
    created,
    created,
  );
  await run(
    'INSERT INTO guest_annotation_changes VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    seq,
    guest,
    invite,
    id.workspace,
    id.project,
    id.album,
    id.photo,
    id.version,
    annotation,
    'create',
    1,
  );
}

async function insertOwner(
  invite: string,
  annotation: string,
  geometry: unknown,
) {
  const created = Date.now() - 5_000;
  await run(
    'INSERT INTO owner_annotations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    annotation,
    invite,
    id.workspace,
    id.project,
    id.album,
    id.photo,
    id.version,
    id.owner,
    1,
    JSON.stringify(geometry),
    JSON.stringify({ color: 'amber' }),
    null,
    'open',
    '攝影師',
    created,
    created,
  );
  await run(
    'INSERT INTO owner_annotation_changes VALUES(?,?,?,?,?,?,?,?)',
    1,
    id.owner,
    invite,
    id.workspace,
    id.project,
    id.album,
    id.photo,
    id.version,
  );
}

async function requestGuest(
  target: string,
  secret: string | null,
  database = db,
) {
  const headers = new Headers({ Accept: 'application/json' });
  if (secret !== null) headers.set('Cookie', 'kino_guest=' + secret);
  return guestAnnotationRoutes.fetch(
    new Request(new URL(target, base), { headers }),
    { ...envBase, DB: database },
  );
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status, await response.clone().text()).toBe(status);
  const body = await response.json();
  expect(body).toEqual({ error: { code } });
  expect(body).not.toHaveProperty('items');
  expect(body).not.toHaveProperty('nextCursor');
}

function racingDb() {
  let inserted = false;
  return {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      return {
        bind(...values: (string | number | null)[]) {
          const bound = statement.bind(...values);
          return {
            first: async (...args: unknown[]) => {
              const row = await bound.first(...args);
              if (!inserted && sql.includes('AS containsFreehand')) {
                inserted = true;
                await insertGuest(
                  id.invite1,
                  id.guest1,
                  id.race,
                  freehand(99),
                  2,
                );
              }
              return row;
            },
            all: (...args: unknown[]) => bound.all(...args),
            run: (...args: unknown[]) => bound.run(...args),
          };
        },
      };
    },
  };
}

describe('freehand read compatibility on isolated workerd D1', () => {
  beforeAll(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: 'freehand-read-compat-d1',
            modules: true,
            script:
              "export default { async fetch() { return new Response('ok'); } };",
            compatibilityDate: '2026-10-23',
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: { DB: 'freehand-read-compat-isolated' },
          },
        ],
      }),
    );
    db = await mf.getD1Database('DB', 'freehand-read-compat-d1');
    await db.exec(schema);
  });
  beforeEach(reset);
  afterAll(async () => {
    await mf?.dispose();
  });

  it('checks all authorized scopes and isolates shared-photo data by invite', async () => {
    await insertGuest(
      id.invite1,
      id.guest1,
      'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
      freehand(),
      1,
    );
    const input = {
      albumId: id.album,
      photoId: id.photo,
      versionId: id.version,
    };
    const guestOwn = await preflightFreehandAnnotationRead(db, {
      kind: 'guest-own',
      secretHash: hashSecret(secret1),
      ...input,
    });
    const guestShared = await preflightFreehandAnnotationRead(db, {
      kind: 'guest-shared',
      secretHash: hashSecret(secret1),
      ...input,
    });
    const ownerOwn = await preflightFreehandAnnotationRead(db, {
      kind: 'owner-own',
      ownerId: id.owner,
      sessionId: id.ownerSession,
      inviteId: id.invite1,
      ...input,
    });
    const ownerGuestList = await preflightFreehandAnnotationRead(db, {
      kind: 'owner-guest-list',
      ownerId: id.owner,
      sessionId: id.ownerSession,
      inviteId: id.invite1,
      ...input,
    });
    const otherGuest = await preflightFreehandAnnotationRead(db, {
      kind: 'guest-shared',
      secretHash: hashSecret(secret2),
      ...input,
    });
    const otherOwnerList = await preflightFreehandAnnotationRead(db, {
      kind: 'owner-guest-list',
      ownerId: id.owner,
      sessionId: id.ownerSession,
      inviteId: id.invite2,
      ...input,
    });
    expect(guestOwn).toMatchObject({
      kind: 'authorized',
      containsFreehand: true,
    });
    expect(guestShared).toMatchObject({
      kind: 'authorized',
      containsFreehand: true,
    });
    expect(ownerOwn).toMatchObject({
      kind: 'authorized',
      containsFreehand: false,
    });
    expect(ownerGuestList).toMatchObject({
      kind: 'authorized',
      containsFreehand: true,
    });
    expect(otherGuest).toMatchObject({
      kind: 'authorized',
      containsFreehand: false,
    });
    expect(otherOwnerList).toMatchObject({
      kind: 'authorized',
      containsFreehand: false,
    });
    await insertOwner(
      id.invite1,
      'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
      freehand(5),
    );
    expect(
      await preflightFreehandAnnotationRead(db, {
        kind: 'owner-own',
        ownerId: id.owner,
        sessionId: id.ownerSession,
        inviteId: id.invite1,
        ...input,
      }),
    ).toMatchObject({ kind: 'authorized', containsFreehand: true });
  });

  it('returns full-scope legacy 426 for later-page and targeted reads', async () => {
    const target = 'dededede-dede-4ded-8ded-dededededede';
    for (let n = 1; n <= 25; n += 1) {
      const annotation =
        n === 1
          ? target
          : String(n).padStart(8, '0') + '-0000-4000-8000-000000000001';
      await insertGuest(id.invite1, id.guest1, annotation, rect(n), n);
    }
    await insertGuest(
      id.invite1,
      id.guest1,
      'efefefef-efef-4fef-8fef-efefefefefef',
      freehand(50),
      26,
    );
    const normal = await requestGuest(path + '/own', secret1);
    await expectError(normal, 426, ANNOTATION_CLIENT_UPGRADE_REQUIRED);
    await expectError(
      await requestGuest(path + '/shared', secret1),
      426,
      ANNOTATION_CLIENT_UPGRADE_REQUIRED,
    );
    const targeted = await requestGuest(
      path + '/own?annotationId=' + target,
      secret1,
    );
    await expectError(targeted, 426, ANNOTATION_CLIENT_UPGRADE_REQUIRED);
  });

  it('does not expose another invite freehand in a legacy shared read', async () => {
    await insertGuest(
      id.invite1,
      id.guest1,
      'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0',
      freehand(60),
      1,
    );
    const input = {
      albumId: id.album,
      photoId: id.photo,
      versionId: id.version,
    };
    expect(
      await preflightFreehandAnnotationRead(db, {
        kind: 'guest-shared',
        secretHash: hashSecret(secret2),
        ...input,
      }),
    ).toMatchObject({ kind: 'authorized', containsFreehand: false });
    const response = await requestGuest(path + '/shared', secret2);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('returns 409 without partial content when the feed changes after preflight', async () => {
    await insertGuest(id.invite1, id.guest1, id.target, rect(), 1);
    const response = await requestGuest(
      path + '/own?annotationId=' + id.target,
      secret1,
      racingDb(),
    );
    await expectError(response, 409, 'ANNOTATION_HISTORY_CHANGED');
  });

  it('preserves Guest 401 and 400 status codes', async () => {
    await expectError(
      await requestGuest(path + '/own', null),
      401,
      'GUEST_ACCESS_REQUIRED',
    );
    await expectError(
      await requestGuest(path + '/own?cursor=one&cursor=two', secret1),
      400,
      'INVALID_INPUT',
    );
  });

  it('maps both Owner read routes to 426 and preserves 409', async () => {
    const ownerPath =
      '/api/v1/albums/' +
      id.album +
      '/photos/' +
      id.photo +
      '/versions/' +
      id.version +
      '/annotations?inviteId=' +
      id.invite1;
    const authorPath = ownerPath.replace(
      '/annotations?',
      '/annotations/owner?',
    );
    await insertGuest(
      id.invite1,
      id.guest1,
      'f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1',
      freehand(),
      1,
    );
    await insertOwner(
      id.invite1,
      'f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2',
      freehand(5),
    );
    await expectError(
      await ownerApp.fetch(new Request(new URL(ownerPath, base)), env),
      426,
      ANNOTATION_CLIENT_UPGRADE_REQUIRED,
    );
    await expectError(
      await ownerApp.fetch(new Request(new URL(authorPath, base)), env),
      426,
      ANNOTATION_CLIENT_UPGRADE_REQUIRED,
    );
    const conflictSpy = vi
      .spyOn(D1OwnerAnnotationsRepository.prototype, 'read')
      .mockRejectedValue(
        new WorkspaceFailure('ANNOTATION_HISTORY_CHANGED', 409),
      );
    try {
      await expectError(
        await ownerApp.fetch(new Request(new URL(ownerPath, base)), env),
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );
    } finally {
      conflictSpy.mockRestore();
    }
  });
});
