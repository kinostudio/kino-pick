import { describe, expect, it } from 'vitest';
import {
  decodeGuestPermissions,
  guestAlbumAccessSchema,
} from '../../packages/contracts/src/guest-access';
import { createInviteSchema } from '../../packages/contracts/src/invites';
import { D1GuestAccessResolver } from '../../apps/worker/src/guest-access';
import { D1GuestExchange } from '../../apps/worker/src/guest-exchange';
import { D1InviteRepository } from '../../apps/worker/src/invites';
import {
  canonicalInviteCreationPayload,
  D1InviteIssuance,
} from '../../apps/worker/src/invite-issuance';
import { configuration, type WorkerEnv } from '../../apps/worker/src/config';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const PROJECT_ID = '00000000-0000-4000-8000-000000000003';
const ALBUM_A = '00000000-0000-4000-8000-000000000004';
const ALBUM_B = '00000000-0000-4000-8000-000000000005';
const INVITE_ID = '00000000-0000-4000-8000-000000000006';
const GUEST_ID = '00000000-0000-4000-8000-000000000007';
const SESSION_ID = '00000000-0000-4000-8000-000000000008';
const REQUEST_ID = '00000000-0000-4000-8000-000000000009';
const TOKEN = 'a'.repeat(64);
const SECRET = 'b'.repeat(64);
const DEADLINE = '2026-11-10T00:00:00.000Z';
const SESSION_DEADLINE = '2026-11-09T12:00:00.000Z';

type TestStatement = {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => TestStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{
    success: boolean;
    results: T[];
    meta: { changes: number };
  }>;
  run: () => Promise<{ success: boolean; meta: { changes: number } }>;
};

function testDatabase(options: {
  first?: (sql: string, values: unknown[]) => unknown;
  all?: (sql: string, values: unknown[]) => unknown[];
  batch?: (statements: TestStatement[]) => unknown[];
}) {
  const statements: TestStatement[] = [];
  const database = {
    prepare(sql: string) {
      const statement: TestStatement = {
        sql,
        values: [],
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async first<T>() {
          return (options.first?.(sql, statement.values) ?? null) as T | null;
        },
        async all<T>() {
          return {
            success: true,
            results: (options.all?.(sql, statement.values) ?? []) as T[],
            meta: { changes: 1 },
          };
        },
        async run() {
          return { success: true, meta: { changes: 1 } };
        },
      };
      statements.push(statement);
      return statement;
    },
    async batch(input: TestStatement[]) {
      return options.batch?.(input) ?? input.map(() => ({ success: true }));
    },
    withSession() {
      return database;
    },
  };
  return { db: database as unknown as D1Database, statements };
}

function workerEnv(overrides: Record<string, unknown> = {}) {
  return {
    APP_ENV: 'local',
    APP_URL: 'http://127.0.0.1:8787',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    BETTER_AUTH_SECRET: 'unit-test-secret-with-at-least-32-characters',
    ...overrides,
  } as unknown as WorkerEnv;
}

function inviteRequest(expiryMode: 'custom' | 'inherit_album' = 'custom') {
  return createInviteSchema.parse({
    requestId: REQUEST_ID,
    albumIds: [ALBUM_B, ALBUM_A],
    accessMode: 'link_only',
    ...(expiryMode === 'inherit_album' ? { expiryMode } : {}),
    permissions: decodeGuestPermissions(1),
    expiresAt: expiryMode === 'inherit_album' ? null : DEADLINE,
    maxUses: null,
  });
}

const albumRow = (
  expiryMode: 'custom' | 'inherit_album',
  inviteExpiresAt: string | null,
) => ({
  guestId: GUEST_ID,
  inviteId: INVITE_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  albumId: ALBUM_A,
  permissionsMask: 1,
  expiresAt: SESSION_DEADLINE,
  inviteExpiresAt,
  expiryMode,
});

describe('inherited-share core service wiring', () => {
  it('keeps custom canonical payload bytes and appends inherit_album after a null deadline', () => {
    const custom = canonicalInviteCreationPayload(PROJECT_ID, inviteRequest());
    const explicitCustom = createInviteSchema.parse({
      ...inviteRequest(),
      expiryMode: 'custom',
    });
    const inherited = canonicalInviteCreationPayload(
      PROJECT_ID,
      inviteRequest('inherit_album'),
    );
    const multiAlbum = createInviteSchema.parse({
      ...inviteRequest('inherit_album'),
      albumIds: Array.from(
        { length: 24 },
        (_, index) =>
          `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      ),
    });

    expect(canonicalInviteCreationPayload(PROJECT_ID, explicitCustom)).toBe(
      custom,
    );
    expect(custom).toBe(
      `{"projectId":"${PROJECT_ID}","albumIds":["${ALBUM_A}","${ALBUM_B}"],"accessMode":"link_only","permissionsMask":1,"expiresAtMs":${Date.parse(DEADLINE)},"maxUses":null}`,
    );
    expect(inherited).toBe(
      `{"projectId":"${PROJECT_ID}","albumIds":["${ALBUM_A}","${ALBUM_B}"],"accessMode":"link_only","permissionsMask":1,"expiresAtMs":null,"maxUses":null,"expiryMode":"inherit_album"}`,
    );
    expect(inherited.indexOf('"expiryMode"')).toBeGreaterThan(
      inherited.indexOf('"maxUses"'),
    );
    expect(multiAlbum.albumIds).toHaveLength(24);
    expect(
      JSON.parse(canonicalInviteCreationPayload(PROJECT_ID, multiAlbum))
        .albumIds,
    ).toHaveLength(24);
  });

  it('keeps Owner summaries legacy-shaped for custom rows and labels inherited rows', async () => {
    const custom = {
      id: ALBUM_A,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accessMode: 'link_only',
      expiryMode: 'custom',
      mask: 1,
      createdAt: DEADLINE,
      expiresAt: DEADLINE,
      revokedAt: null,
      sealed: 1,
      maxUses: null,
      issuedSessions: 0,
      albumsJson: '[]',
    };
    const inherited = {
      ...custom,
      id: INVITE_ID,
      expiryMode: 'inherit_album',
      expiresAt: null,
    };
    let listSql = '';
    const { db } = testDatabase({
      first(sql) {
        if (sql.includes('SELECT p.workspace_id'))
          return { workspace_id: WORKSPACE_ID };
        return { owner: 1 };
      },
      all(sql) {
        listSql = sql;
        return [custom, inherited];
      },
    });

    const page = await new D1InviteRepository(db, OWNER_ID, SESSION_ID).list(
      PROJECT_ID,
    );

    expect(page.invites).toHaveLength(2);
    expect(page.invites[0]).not.toHaveProperty('expiryMode');
    expect(page.invites[0]!.expiresAt).toBe(DEADLINE);
    expect(page.invites[1]).toMatchObject({
      id: INVITE_ID,
      expiryMode: 'inherit_album',
      expiresAt: null,
    });
    expect(listSql).toContain('i.expiry_mode AS expiryMode');
    expect(listSql).toContain('LIMIT 25');
  });

  it('returns the requested album effective deadline while preserving the custom access DTO', async () => {
    const rows = [
      albumRow('custom', DEADLINE),
      albumRow('inherit_album', null),
    ];
    const queries: string[] = [];
    const { db } = testDatabase({
      first(sql) {
        queries.push(sql);
        return rows.shift();
      },
    });
    const resolver = new D1GuestAccessResolver(db);

    const custom = await resolver.album(SECRET, ALBUM_A, 'can_view');
    const inherited = await resolver.album(SECRET, ALBUM_A, 'can_view');

    expect(custom).not.toHaveProperty('expiryMode');
    expect(custom).toMatchObject({
      inviteExpiresAt: DEADLINE,
      expiresAt: SESSION_DEADLINE,
    });
    expect(inherited).toMatchObject({
      expiryMode: 'inherit_album',
      inviteExpiresAt: null,
      expiresAt: SESSION_DEADLINE,
    });
    expect(guestAlbumAccessSchema.parse(inherited)).toEqual(inherited);
    expect(queries[0]).toContain('effective_guest_invite_album_expiry');
    expect(queries[0]).toContain('expiry.album_id=ia.album_id');
    expect(queries[0]).toContain('__guest_expiry.expiry_valid=1');
  });

  it('allows exchange when an exact active album scope has a valid inherited expiry', async () => {
    let inviteCommand: unknown[] | null = null;
    let exchangeSql = '';
    const now = Date.now();
    const { db } = testDatabase({
      first(sql) {
        if (sql.startsWith('SELECT id FROM guest_invites WHERE token_hash'))
          return { id: INVITE_ID };
        if (
          sql.startsWith(
            'SELECT request_commitment FROM guest_exchange_commands',
          )
        )
          return null;
        if (sql.startsWith('SELECT i.id,i.token_hash')) {
          exchangeSql = sql;
          return {
            id: INVITE_ID,
            token_hash: 'c'.repeat(64),
            access_mode: 'link_only',
            password_verifier: null,
            workspace_id: WORKSPACE_ID,
            project_id: PROJECT_ID,
            permissions_mask: 1,
            created_by: OWNER_ID,
            invite_album_count: 2,
            invite_album_id: ALBUM_B,
          };
        }
        if (sql.startsWith('SELECT c.id,c.invite_id')) {
          const values = inviteCommand ?? [];
          return {
            id: values[0],
            invite_id: values[1],
            request_commitment: values[4],
            session_id: values[6],
            session_secret_hash: values[7],
            expires_at_ms: now + 60_000,
            ttl_ms: 60_000,
          };
        }
        return null;
      },
      all(sql) {
        if (sql.startsWith('WITH clock(now_ms)'))
          return [
            {
              dimension: 'network',
              bucket_hash: 'x',
              window_started_at_ms: now,
              attempts: 1,
              attempt_limit: 20,
              updated_at_ms: now,
            },
            {
              dimension: 'invite_network',
              bucket_hash: 'y',
              window_started_at_ms: now,
              attempts: 1,
              attempt_limit: 5,
              updated_at_ms: now,
            },
            {
              dimension: 'invite',
              bucket_hash: 'z',
              window_started_at_ms: now,
              attempts: 1,
              attempt_limit: 50,
              updated_at_ms: now,
            },
          ];
        return [];
      },
      batch(statements) {
        inviteCommand = statements[1]?.values ?? null;
        return statements.map(() => ({ success: true }));
      },
    });
    const env = workerEnv({ DB: db, GUEST_EXCHANGE_ENABLED: 'true' });

    const result = await new D1GuestExchange(env).exchange(
      {
        requestId: REQUEST_ID,
        token: TOKEN,
        displayName: 'Local visitor',
      },
      '192.0.2.10',
    );

    expect(result.authenticated).toBe(true);
    expect(result.maxAge).toBe(60);
    expect(exchangeSql).toContain('effective_guest_invite_album_expiry');
    expect(exchangeSql).toContain('__guest_expiry.expiry_valid=1');
    expect(exchangeSql).not.toContain('i.expires_at_ms>');
    expect(exchangeSql).toContain('SELECT count(*) FROM guest_invite_albums');
  });

  it('keeps new inherited issuance off while exact recovery never returns the one-time secret', async () => {
    const value = inviteRequest('inherit_album');
    const payload = canonicalInviteCreationPayload(PROJECT_ID, value);
    const secret = 'unit-test-secret-with-at-least-32-characters';
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(
        JSON.stringify([
          'kino-pic:invite-create-request:v1',
          OWNER_ID,
          REQUEST_ID,
          payload,
          null,
        ]),
      ),
    );
    const prior = {
      inviteId: INVITE_ID,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      createdAt: DEADLINE,
      expiresAt: null,
      expiryMode: 'inherit_album',
      payload_json: payload,
      request_commitment: Buffer.from(signature).toString('hex'),
      albumCount: 2,
      albumId: ALBUM_B,
      token_hash: 'd'.repeat(64),
      password_verifier: null,
    };
    const { db } = testDatabase({
      first(sql) {
        if (sql.startsWith('SELECT c.invite_id AS inviteId')) return prior;
        return { owner: 1 };
      },
    });
    const env = workerEnv({
      DB: db,
      GUEST_INVITE_ISSUANCE_ENABLED: 'true',
      INHERITED_SHARE_ISSUANCE_ENABLED: 'false',
    });

    await expect(
      new D1InviteIssuance(env, OWNER_ID, SESSION_ID).create(PROJECT_ID, value),
    ).resolves.toMatchObject({
      secretAvailable: false,
      invite: { expiryMode: 'inherit_album', expiresAt: null },
    });
    expect(configuration(workerEnv()).INHERITED_SHARE_ISSUANCE_ENABLED).toBe(
      'false',
    );
  });

  it('rejects a new inherited issuance before KDF when the explicit flag is off', async () => {
    const statements: string[] = [];
    const { db } = testDatabase({
      first(sql) {
        statements.push(sql);
        return sql.startsWith('SELECT 1 FROM owners') ? { owner: 1 } : null;
      },
    });
    const env = workerEnv({
      DB: db,
      GUEST_INVITE_ISSUANCE_ENABLED: 'true',
      INHERITED_SHARE_ISSUANCE_ENABLED: 'false',
    });

    const error = await new D1InviteIssuance(env, OWNER_ID, SESSION_ID)
      .create(PROJECT_ID, inviteRequest('inherit_album'))
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(WorkspaceFailure);
    expect(error).toMatchObject({ code: 'FEATURE_UNAVAILABLE', status: 503 });
    expect(statements).toHaveLength(2);
    expect(statements.some((sql) => sql.includes('kdf_permits'))).toBe(false);
  });
});
