import { describe, expect, it } from 'vitest';
import type { AnnotationGeometry } from '../../packages/contracts/src/annotation-geometry';
import { Hono } from '../../apps/worker/node_modules/hono';
import { guestAnnotationRoutes } from '../../apps/worker/src/guest-annotation-routes';
import { ownerAnnotationAuthoringRoutes } from '../../apps/worker/src/owner-annotation-authoring-routes';
import { canonicalAnnotationGeometryJson } from '../../apps/worker/src/freehand-canonical';

const base = 'http://127.0.0.1:8787';
const secret = 'a'.repeat(64);
const id = {
  owner: '11111111-1111-4111-8111-111111111111',
  ownerSession: '12121212-1212-4121-8121-121212121212',
  album: '44444444-4444-4444-8444-444444444444',
  invite: '55555555-5555-4555-8555-555555555555',
  photo: '66666666-6666-4666-8666-666666666666',
  version: '77777777-7777-4777-8777-777777777777',
  guest: '88888888-8888-4888-8888-888888888888',
  annotation: 'acacacac-acac-4cac-8cac-acacacacacac',
  guestRequest: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
  ownerRequest: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
};
const geometry = {
  type: 'freehand',
  coordinateSpace: 'normalized_1e6',
  version: 1,
  points: [
    { x: 100, y: 200 },
    { x: 300, y: 400 },
  ],
} satisfies AnnotationGeometry;
const guestCommand = {
  requestId: id.guestRequest,
  expectedGuestId: id.guest,
  operation: 'create',
  photoId: id.photo,
  versionId: id.version,
  geometry,
  style: { color: 'amber' },
  commentId: null,
} as const;
const ownerCommand = {
  requestId: id.ownerRequest,
  expectedOwnerId: id.owner,
  operation: 'create',
  inviteId: id.invite,
  photoId: id.photo,
  versionId: id.version,
  geometry,
  style: { color: 'amber' },
  commentId: null,
} as const;
const baseEnv = {
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

type Role = 'guest' | 'owner';
type DbCall = { sql: string; values: unknown[]; writes: number };
type FakeDbOptions = {
  role: Role;
  authorized?: boolean;
  existingRequest?: boolean;
  resultRow?: Record<string, unknown> | null;
  writeError?: Error;
};

function fakeDb(options: FakeDbOptions) {
  const calls: DbCall[] = [];
  const database = {
    prepare(sql: string) {
      const call: DbCall = { sql, values: [], writes: 0 };
      calls.push(call);
      return {
        bind(...values: unknown[]) {
          call.values = values;
          return {
            first: async function first<T>() {
              if (sql.includes('AS hasRequestId')) {
                if (options.role === 'owner') {
                  return {
                    scopeAuthorized: options.authorized === false ? 0 : 1,
                    hasRequestId: options.existingRequest ? 1 : 0,
                  } as T;
                }
                return options.authorized === false ||
                  !sql.includes('WHERE a.guest_id=?') ||
                  call.values.at(-1) !== id.guest
                  ? null
                  : ({
                      hasRequestId: options.existingRequest ? 1 : 0,
                    } as T);
              }
              if (sql.includes('SELECT r.result_json AS resultJson'))
                return (options.resultRow ?? null) as T | null;
              return null;
            },
            run: async function run() {
              call.writes += 1;
              if (options.writeError) throw options.writeError;
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db: database as unknown as D1Database, calls };
}

function guestResultRow(command: typeof guestCommand) {
  const timestamp = '2026-10-29T00:00:00.000Z';
  const result = {
    requestId: command.requestId,
    operation: 'create',
    item: {
      annotationId: id.annotation,
      photoId: command.photoId,
      versionId: command.versionId,
      revision: 1,
      geometry: JSON.parse(canonicalAnnotationGeometryJson(command.geometry)),
      style: { color: command.style.color },
      commentId: command.commentId,
      state: 'open',
      authorLabel: 'Guest One',
      isMine: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    occurredAt: timestamp,
  };
  return {
    resultJson: JSON.stringify(result),
    annotationId: id.annotation,
    photoId: command.photoId,
    versionId: command.versionId,
  };
}

function ownerResultRow(command: typeof ownerCommand) {
  const timestamp = '2026-10-29T00:00:00.000Z';
  const result = {
    ownerId: command.expectedOwnerId,
    requestId: command.requestId,
    operation: 'create',
    item: {
      annotationId: id.annotation,
      inviteId: command.inviteId,
      photoId: command.photoId,
      versionId: command.versionId,
      revision: 1,
      geometry: JSON.parse(canonicalAnnotationGeometryJson(command.geometry)),
      style: { color: command.style.color },
      commentId: command.commentId,
      state: 'open',
      authorType: 'owner',
      authorLabel: 'Photographer',
      canEdit: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    occurredAt: timestamp,
  };
  return {
    resultJson: JSON.stringify(result),
    annotationId: id.annotation,
    inviteId: command.inviteId,
    photoId: command.photoId,
    versionId: command.versionId,
  };
}

async function guestRequest(
  env: Record<string, unknown>,
  db: D1Database,
  command: unknown,
) {
  return guestAnnotationRoutes.fetch(
    new Request(
      base + '/api/guest/albums/' + id.album + '/annotations/commands',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: base,
          'Content-Type': 'application/json',
          Cookie: 'kino_guest=' + secret,
        },
        body: JSON.stringify(command),
      },
    ),
    { ...env, DB: db } as never,
  );
}

const ownerApp = new Hono<{
  Bindings: Record<string, unknown>;
  Variables: { ownerId: string; sessionId: string };
}>();
ownerApp.use('*', async (c, next) => {
  c.set('ownerId', id.owner);
  c.set('sessionId', id.ownerSession);
  await next();
});
ownerApp.route('/', ownerAnnotationAuthoringRoutes as never);

async function ownerRequest(
  env: Record<string, unknown>,
  db: D1Database,
  command: unknown,
) {
  return ownerApp.fetch(
    new Request(
      base + '/api/v1/albums/' + id.album + '/annotations/owner/commands',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      },
    ),
    { ...env, DB: db },
  );
}

describe.each(['guest', 'owner'] as const)(
  'freehand %s server write gate',
  (role) => {
    it('rejects a new command while OFF before an annotation command insert', async () => {
      const { db, calls } = fakeDb({ role, existingRequest: false });
      const response =
        role === 'guest'
          ? await guestRequest(baseEnv, db, guestCommand)
          : await ownerRequest(baseEnv, db, ownerCommand);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: 'FREEHAND_ANNOTATIONS_DISABLED' },
      });
      expect(
        calls.some((call) =>
          call.sql.includes('INSERT INTO ' + role + '_annotation_commands('),
        ),
      ).toBe(false);
    });

    it('routes an existing request ID through the immutable replay guard after OFF', async () => {
      const resultRow =
        role === 'guest'
          ? guestResultRow(guestCommand)
          : ownerResultRow(ownerCommand);
      const { db, calls } = fakeDb({
        role,
        existingRequest: true,
        resultRow,
      });
      const response =
        role === 'guest'
          ? await guestRequest(baseEnv, db, guestCommand)
          : await ownerRequest(baseEnv, db, ownerCommand);

      expect(response.status).toBe(200);
      const insert = calls.find((call) =>
        call.sql.includes('INSERT INTO ' + role + '_annotation_commands('),
      );
      expect(insert).toBeDefined();
      const canonicalGeometry = canonicalAnnotationGeometryJson(geometry);
      expect(insert?.values).toContain(canonicalGeometry);
      const canonicalRequest =
        role === 'guest'
          ? JSON.stringify({
              requestId: guestCommand.requestId,
              expectedGuestId: guestCommand.expectedGuestId,
              operation: guestCommand.operation,
              photoId: guestCommand.photoId,
              versionId: guestCommand.versionId,
              geometry: JSON.parse(canonicalGeometry),
              style: guestCommand.style,
              commentId: guestCommand.commentId,
            })
          : JSON.stringify({
              requestId: ownerCommand.requestId,
              expectedOwnerId: ownerCommand.expectedOwnerId,
              operation: ownerCommand.operation,
              inviteId: ownerCommand.inviteId,
              photoId: ownerCommand.photoId,
              versionId: ownerCommand.versionId,
              geometry: JSON.parse(canonicalGeometry),
              style: ownerCommand.style,
              commentId: ownerCommand.commentId,
            });
      expect(insert?.values).toContain(canonicalRequest);
    });

    it('passes an enabled local capability into the writer', async () => {
      const env = { ...baseEnv, FREEHAND_ANNOTATIONS_ENABLED: 'true' };
      const resultRow =
        role === 'guest'
          ? guestResultRow(guestCommand)
          : ownerResultRow(ownerCommand);
      const { db, calls } = fakeDb({ role, existingRequest: false, resultRow });
      const response =
        role === 'guest'
          ? await guestRequest(env, db, guestCommand)
          : await ownerRequest(env, db, ownerCommand);

      expect(response.status).toBe(200);
      expect(calls.some((call) => call.sql.includes('AS hasRequestId'))).toBe(
        false,
      );
    });

    it('preserves request ID conflicts through the original database guard', async () => {
      const changedGeometry = {
        ...geometry,
        points: [
          { x: 100, y: 200 },
          { x: 301, y: 400 },
        ],
      };
      const command =
        role === 'guest'
          ? { ...guestCommand, geometry: changedGeometry }
          : { ...ownerCommand, geometry: changedGeometry };
      const { db } = fakeDb({
        role,
        existingRequest: true,
        writeError: new Error('REQUEST_ID_CONFLICT'),
      });
      const response =
        role === 'guest'
          ? await guestRequest(baseEnv, db, command)
          : await ownerRequest(baseEnv, db, command);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: { code: 'REQUEST_ID_CONFLICT' },
      });
    });
  },
);

it('preserves Guest authentication errors while freehand is OFF', async () => {
  const { db } = fakeDb({ role: 'guest' });
  const response = await guestRequest(baseEnv, db, {
    ...guestCommand,
    expectedGuestId: id.owner,
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: { code: 'GUEST_ACCESS_REQUIRED' },
  });
});
