import { describe, expect, it } from 'vitest';
import { D1PhotoDisplayLeases } from '../../apps/worker/src/photo-display-leases';
import { GuestAccessDenied } from '../../apps/worker/src/guest-access';
import { photoDisplayLeaseResultSchema } from '../../packages/contracts/src/photo-display-leases';

const now = 1_800_000_000_000;
const ownerId = '11111111-1111-4111-8111-111111111111';
const guestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const albumId = '44444444-4444-4444-8444-444444444444';
const photoId = '55555555-5555-4555-8555-555555555555';
const versionId = '66666666-6666-4666-8666-666666666666';
const documentId = '77777777-7777-4777-8777-777777777777';
const ownerSession = 'owner-session';
const guestSecret = 'a'.repeat(64);

const request = {
  documentId,
  photoId,
  versionId,
  expectedActorId: ownerId,
};

function ownerSource(overrides: Record<string, unknown> = {}) {
  return {
    actorType: 'user',
    actorId: ownerId,
    authorizationSessionId: ownerSession,
    ownerUserId: ownerId,
    workspaceId,
    projectId,
    albumId,
    photoId,
    versionId,
    databaseNowMs: now,
    sessionExpiresAtMs: now + 1_200_000,
    ...overrides,
  };
}

function guestSource(overrides: Record<string, unknown> = {}) {
  return {
    actorType: 'guest',
    actorId: guestId,
    authorizationSessionId: 'guest-session',
    ownerUserId: ownerId,
    workspaceId,
    projectId,
    albumId,
    photoId,
    versionId,
    databaseNowMs: now,
    sessionExpiresAtMs: now + 1_200_000,
    expiryMode: 'custom',
    inviteExpiresAtMs: now + 1_000_000,
    expiryValid: 1,
    ...overrides,
  };
}

function assetScope(overrides: Record<string, unknown> = {}) {
  return {
    album_id: albumId,
    workspace_id: workspaceId,
    project_id: projectId,
    ...overrides,
  };
}

function fakeDb(options: {
  authorizationRows: Array<unknown | null>;
  assetRows?: Array<unknown | null>;
  protectionNowMs?: number;
  protectedUntilMs?: number;
}) {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  let authorizationIndex = 0;
  let assetIndex = 0;
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement = { sql, values };
          statements.push(statement);
          return {
            sql,
            values,
            async first() {
              if (sql.includes('authorizationSessionId'))
                return options.authorizationRows[authorizationIndex++] ?? null;
              if (
                sql.includes('FROM photo_assets a') ||
                sql.includes('WITH guest_scope AS')
              )
                return (
                  (options.assetRows ?? [assetScope(), assetScope()])[
                    assetIndex++
                  ] ?? null
                );
              throw new Error('Unexpected SELECT in photo display lease mock');
            },
          };
        },
      };
    },
    async batch(batchStatements: Array<{ values: unknown[] }>) {
      const [album, workspace, project] = batchStatements[0]?.values ?? [];
      const dbNowMs = options.protectionNowMs ?? now;
      const protectedUntilMs = options.protectedUntilMs ?? dbNowMs + 900_000;
      return [
        { success: true, results: [] },
        { success: true, results: [] },
        {
          success: true,
          results: [
            {
              album_id: album,
              workspace_id: workspace,
              project_id: project,
              renewed_at_ms: protectedUntilMs - 900_000,
              protected_until_ms: protectedUntilMs,
              revision: 0,
              db_now_ms: dbNowMs,
              scope_valid: 1,
            },
          ],
        },
      ];
    },
  };
  return { db: db as unknown as D1Database, statements };
}

describe('single-photo display leases', () => {
  it('rejects malformed result timestamps and protection margins', () => {
    const result = {
      documentId,
      albumId,
      photoId,
      versionId,
      issuedAt: new Date(now).toISOString(),
      protectedUntilAt: new Date(now + 600_000).toISOString(),
      displayForMs: 600_000,
    };
    expect(photoDisplayLeaseResultSchema.safeParse(result).success).toBe(false);
    expect(
      photoDisplayLeaseResultSchema.safeParse({
        ...result,
        protectedUntilAt: '2026-02-30T25:61:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('caps Owner display at ten minutes and returns only the nonsecret DTO', async () => {
    const { db, statements } = fakeDb({
      authorizationRows: [
        ownerSource(),
        ownerSource({ databaseNowMs: now + 20 }),
      ],
    });
    const result = await new D1PhotoDisplayLeases(db).owner(
      ownerId,
      ownerSession,
      albumId,
      request,
    );

    expect(result).toEqual({
      documentId,
      albumId,
      photoId,
      versionId,
      issuedAt: new Date(now + 20).toISOString(),
      protectedUntilAt: new Date(now + 900_000).toISOString(),
      displayForMs: 600_000,
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'albumId',
        'displayForMs',
        'documentId',
        'issuedAt',
        'photoId',
        'protectedUntilAt',
        'versionId',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/secret|session|token|hash/i);
    expect(
      statements.every(
        ({ sql }) => !/human_photo_views|audit_events/i.test(sql),
      ),
    ).toBe(true);
    const writes = statements
      .map(({ sql }) => sql.trim())
      .filter((sql) => /^(INSERT|UPDATE|DELETE)/i.test(sql));
    expect(writes).toHaveLength(2);
    expect(writes.every((sql) => sql.includes('album_read_protections'))).toBe(
      true,
    );
    const gallerySql = statements.find(({ sql }) =>
      sql.includes('FROM photo_assets a'),
    )?.sql;
    expect(gallerySql).toContain("al.state NOT IN('deleting','deleted')");
    expect(gallerySql).not.toContain(
      "pr.status NOT IN('archived','deleting','deleted')",
    );
  });

  it('bounds duration by the later Guest invite expiry and uses the scoped expiry view', async () => {
    const guestRequest = { ...request, expectedActorId: guestId };
    const { db, statements } = fakeDb({
      authorizationRows: [
        guestSource({ inviteExpiresAtMs: now + 300_000 }),
        guestSource({
          databaseNowMs: now + 100,
          inviteExpiresAtMs: now + 45_100,
        }),
      ],
    });
    const result = await new D1PhotoDisplayLeases(db).guest(
      guestSecret,
      albumId,
      guestRequest,
    );

    expect(result.displayForMs).toBe(45_000);
    expect(
      statements.some(({ sql }) =>
        sql.includes('effective_guest_invite_album_expiry'),
      ),
    ).toBe(true);
  });

  it('uses the Guest session bound when inherited expiry is off', async () => {
    const guestRequest = { ...request, expectedActorId: guestId };
    const { db } = fakeDb({
      authorizationRows: [
        guestSource({ expiryMode: 'inherit_album', inviteExpiresAtMs: null }),
        guestSource({
          databaseNowMs: now + 100,
          expiryMode: 'inherit_album',
          inviteExpiresAtMs: null,
        }),
      ],
    });
    const result = await new D1PhotoDisplayLeases(db).guest(
      guestSecret,
      albumId,
      guestRequest,
    );
    expect(result.displayForMs).toBe(600_000);
  });

  it('rejects fewer than one second remaining and malformed expiry source', async () => {
    const short = fakeDb({
      authorizationRows: [
        ownerSource({ sessionExpiresAtMs: now + 999 }),
        ownerSource({ databaseNowMs: now + 1, sessionExpiresAtMs: now + 999 }),
      ],
    });
    await expect(
      new D1PhotoDisplayLeases(short.db).owner(
        ownerId,
        ownerSession,
        albumId,
        request,
      ),
    ).rejects.toMatchObject({ code: 'DISPLAY_LEASE_UNAVAILABLE', status: 503 });

    const malformed = fakeDb({
      authorizationRows: [
        guestSource({ expiryMode: 'custom', inviteExpiresAtMs: null }),
      ],
    });
    await expect(
      new D1PhotoDisplayLeases(malformed.db).guest(guestSecret, albumId, {
        ...request,
        expectedActorId: guestId,
      }),
    ).rejects.toMatchObject({ code: 'DISPLAY_LEASE_UNAVAILABLE', status: 503 });
  });

  it('rejects Owner identity changes and a nonmonotonic database clock', async () => {
    const mismatch = fakeDb({ authorizationRows: [] });
    await expect(
      new D1PhotoDisplayLeases(mismatch.db).owner(
        ownerId,
        ownerSession,
        albumId,
        {
          ...request,
          expectedActorId: guestId,
        },
      ),
    ).rejects.toMatchObject({ code: 'OWNER_IDENTITY_CHANGED', status: 409 });
    expect(mismatch.statements).toHaveLength(0);

    const backwardsClock = fakeDb({
      authorizationRows: [
        ownerSource({ databaseNowMs: now + 100 }),
        ownerSource(),
      ],
    });
    await expect(
      new D1PhotoDisplayLeases(backwardsClock.db).owner(
        ownerId,
        ownerSession,
        albumId,
        request,
      ),
    ).rejects.toMatchObject({ code: 'DISPLAY_LEASE_UNAVAILABLE', status: 503 });
  });

  it('rejects revocation, session changes, and scope changes after protection', async () => {
    const revoked = fakeDb({
      authorizationRows: [ownerSource()],
      assetRows: [assetScope(), null],
    });
    await expect(
      new D1PhotoDisplayLeases(revoked.db).owner(
        ownerId,
        ownerSession,
        albumId,
        request,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    const sessionChanged = fakeDb({
      authorizationRows: [
        ownerSource(),
        ownerSource({ authorizationSessionId: 'different-session' }),
      ],
    });
    await expect(
      new D1PhotoDisplayLeases(sessionChanged.db).owner(
        ownerId,
        ownerSession,
        albumId,
        request,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });

    const scopeChanged = fakeDb({
      authorizationRows: [
        ownerSource(),
        ownerSource({ workspaceId: '88888888-8888-4888-8888-888888888888' }),
      ],
      assetRows: [
        assetScope(),
        assetScope({ workspace_id: '88888888-8888-4888-8888-888888888888' }),
      ],
    });
    await expect(
      new D1PhotoDisplayLeases(scopeChanged.db).owner(
        ownerId,
        ownerSession,
        albumId,
        request,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('masks Guest actor mismatch and post-acquire revocation', async () => {
    const mismatch = fakeDb({ authorizationRows: [null] });
    await expect(
      new D1PhotoDisplayLeases(mismatch.db).guest(
        guestSecret,
        albumId,
        request,
      ),
    ).rejects.toBeInstanceOf(GuestAccessDenied);

    const revoked = fakeDb({
      authorizationRows: [guestSource()],
      assetRows: [assetScope(), null],
    });
    await expect(
      new D1PhotoDisplayLeases(revoked.db).guest(guestSecret, albumId, {
        ...request,
        expectedActorId: guestId,
      }),
    ).rejects.toBeInstanceOf(GuestAccessDenied);
  });

  it('rejects malformed authorization source without exposing its value', async () => {
    const malformed = fakeDb({
      authorizationRows: [ownerSource({ databaseNowMs: 'bad source' })],
    });
    await expect(
      new D1PhotoDisplayLeases(malformed.db).owner(
        ownerId,
        ownerSession,
        albumId,
        request,
      ),
    ).rejects.toMatchObject({ code: 'DISPLAY_LEASE_UNAVAILABLE', status: 503 });
  });
});
