import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { deliveryNotificationRoutes } from '../../apps/worker/src/delivery-notification-routes';
import { D1DeliveryNotifications } from '../../apps/worker/src/delivery-notifications';
import type { WorkerEnv } from '../../apps/worker/src/config';
import { hashGuestSessionSecret } from '../../apps/worker/src/guest-access';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwnerId = '12111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const foreignWorkspaceId = '23222222-2222-4222-8222-222222222222';
const albumId = '33333333-3333-4333-8333-333333333333';
const foreignAlbumId = '34333333-3333-4333-8333-333333333333';
const projectId = '44444444-4444-4444-8444-444444444444';
const inviteId = '55555555-5555-4555-8555-555555555555';
const otherInviteId = '56555555-5555-4555-8555-555555555555';
const guestId = '66666666-6666-4666-8666-666666666666';
const otherGuestId = '67666666-6666-4666-8666-666666666666';
const sessionId = '77777777-7777-4777-8777-777777777777';
const otherSessionId = '78777777-7777-4777-8777-777777777777';
const publishedId = '88888888-8888-4888-8888-888888888888';
const otherPublishedId = '89888888-8888-4888-8888-888888888888';
const revokedId = '99999999-9999-4999-8999-999999999999';
const otherRevokedId = '98999999-9999-4999-8999-999999999999';
const guestSecret = 'a'.repeat(64);
const otherGuestSecret = 'b'.repeat(64);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE owners(user_id TEXT PRIMARY KEY,enabled INTEGER);
    CREATE TABLE workspaces(id TEXT PRIMARY KEY,owner_user_id TEXT);
    CREATE TABLE owner_sessions(userId TEXT,id TEXT,expiresAt INTEGER);
    CREATE TABLE guest_sessions(id TEXT,guest_id TEXT,invite_id TEXT,secret_hash TEXT,expires_at_ms INTEGER);
    CREATE TABLE guest_identities(id TEXT,invite_id TEXT);
    CREATE TABLE guest_invites(id TEXT,workspace_id TEXT,project_id TEXT,created_by TEXT,permissions_mask INTEGER,expires_at_ms INTEGER);
    CREATE TABLE guest_invite_seals(invite_id TEXT);
    CREATE TABLE guest_invite_albums(invite_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT);
    CREATE TABLE albums(id TEXT,workspace_id TEXT,project_id TEXT,state TEXT);
    CREATE TABLE projects(id TEXT,workspace_id TEXT,status TEXT);
    CREATE TABLE guest_invite_revocations(invite_id TEXT);
    CREATE TABLE guest_session_revocations(session_id TEXT);
    CREATE TABLE audit_events(event_id TEXT,actor_type TEXT,actor_id TEXT,workspace_id TEXT,project_id TEXT,album_id TEXT,action TEXT,after_json TEXT,occurred_at_utc TEXT);
  `);
  const run = (sql: string, ...values: Array<string | number | null>) =>
    sqlite.prepare(sql).run(...values);
  const now = Date.now();
  run('INSERT INTO owners VALUES(?,1)', ownerId);
  run('INSERT INTO owners VALUES(?,1)', otherOwnerId);
  run('INSERT INTO workspaces VALUES(?,?)', workspaceId, ownerId);
  run('INSERT INTO workspaces VALUES(?,?)', foreignWorkspaceId, otherOwnerId);
  run(
    'INSERT INTO owner_sessions VALUES(?,?,?)',
    ownerId,
    sessionId,
    now + 60_000,
  );
  run('INSERT INTO projects VALUES(?,?,?)', projectId, workspaceId, 'active');
  run(
    'INSERT INTO albums VALUES(?,?,?,?)',
    albumId,
    workspaceId,
    projectId,
    'active',
  );
  run(
    'INSERT INTO albums VALUES(?,?,?,?)',
    foreignAlbumId,
    foreignWorkspaceId,
    '99999999-9999-4999-8999-999999999998',
    'active',
  );
  run(
    'INSERT INTO projects VALUES(?,?,?)',
    '99999999-9999-4999-8999-999999999998',
    foreignWorkspaceId,
    'active',
  );
  for (const [id, guest, permissions] of [
    [inviteId, guestId, 1],
    [otherInviteId, otherGuestId, 4],
  ] as const) {
    run(
      'INSERT INTO guest_invites VALUES(?,?,?,?,?,?)',
      id,
      workspaceId,
      projectId,
      ownerId,
      permissions,
      now + 60_000,
    );
    run('INSERT INTO guest_invite_seals VALUES(?)', id);
    run(
      'INSERT INTO guest_invite_albums VALUES(?,?,?,?)',
      id,
      workspaceId,
      projectId,
      albumId,
    );
    run('INSERT INTO guest_identities VALUES(?,?)', guest, id);
  }
  const insertSession = async () => {
    run(
      'INSERT INTO guest_sessions VALUES(?,?,?,?,?)',
      sessionId,
      guestId,
      inviteId,
      await hashGuestSessionSecret(guestSecret),
      now + 60_000,
    );
    run(
      'INSERT INTO guest_sessions VALUES(?,?,?,?,?)',
      otherSessionId,
      otherGuestId,
      otherInviteId,
      await hashGuestSessionSecret(otherGuestSecret),
      now + 60_000,
    );
  };
  const db = {
    prepare(sql: string) {
      let bindings: Array<string | number | null> = [];
      return {
        bind(...values: Array<string | number | null>) {
          bindings = values;
          return this;
        },
        async first<T>() {
          return (
            (sqlite.prepare(sql).get(...bindings) as T | undefined) ?? null
          );
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...bindings) as T[] };
        },
      };
    },
  } as unknown as D1Database;
  return { sqlite, db, run, insertSession };
}

function event(
  run: (sql: string, ...values: Array<string | number | null>) => unknown,
  eventId: string,
  action: string,
  occurredAt: string,
  after: Record<string, unknown> = {},
  scope = { workspaceId, projectId, albumId },
) {
  run(
    'INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?,?)',
    eventId,
    action.startsWith('version_approval') ? 'guest' : 'user',
    ownerId,
    scope.workspaceId,
    scope.projectId,
    scope.albumId,
    action,
    JSON.stringify(after),
    occurredAt,
  );
}

describe('delivery notification feeds', () => {
  it('keeps Owner confirmations and delivery notices within the authenticated workspace', async () => {
    const { db, run } = fixture();
    event(
      run,
      publishedId,
      'version_approval.confirmed',
      '2026-11-07T10:00:00.000Z',
    );
    event(
      run,
      otherPublishedId,
      'delivery.published',
      '2026-11-07T10:01:00.000Z',
    );
    event(run, revokedId, 'delivery.revoked', '2026-11-07T10:02:00.000Z');
    event(
      run,
      otherRevokedId,
      'delivery.published',
      '2026-11-07T10:03:00.000Z',
      {},
      { workspaceId: foreignWorkspaceId, projectId, albumId },
    );

    const service = new D1DeliveryNotifications(db);
    const feed = await service.ownerList(ownerId, sessionId, workspaceId);
    expect(feed.notifications.map((item) => item.kind)).toEqual([
      'delivery_withdrawn',
      'delivery_published',
      'approval_confirmed',
    ]);
    await expect(
      service.ownerList(ownerId, sessionId, foreignWorkspaceId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('shows only notices addressed to the current invite, including withdrawal without filenames or IDs', async () => {
    const { db, run, insertSession } = fixture();
    await insertSession();
    event(run, publishedId, 'delivery.published', '2026-11-07T10:00:00.000Z', {
      inviteIds: [inviteId],
      item: {
        photoId: 'asset-private-photo',
        versionId: 'asset-private-version',
        asset: {
          id: 'asset-private-id',
          filename: 'private-owner.jpg',
          objectKey: 'private/object/key',
        },
      },
      clientIp: '192.0.2.1',
      token: 'private-session-token',
    });
    event(run, revokedId, 'delivery.revoked', '2026-11-07T10:02:00.000Z', {
      deliveryId: publishedId,
    });
    event(
      run,
      otherPublishedId,
      'delivery.published',
      '2026-11-07T10:01:00.000Z',
      {
        inviteIds: [otherInviteId],
        item: {
          asset: {
            filename: 'other-guest.jpg',
            objectKey: 'foreign/object/key',
          },
        },
      },
    );
    event(run, otherRevokedId, 'delivery.revoked', '2026-11-07T10:03:00.000Z', {
      deliveryId: otherPublishedId,
    });

    const service = new D1DeliveryNotifications(db);
    const feed = await service.guestList(guestSecret, albumId);
    expect(feed.notifications.map((item) => item.kind)).toEqual([
      'delivery_withdrawn',
      'delivery_published',
    ]);
    expect(feed.notifications.map((item) => item.occurredAt)).toEqual([
      '2026-11-07T10:02:00.000Z',
      '2026-11-07T10:00:00.000Z',
    ]);
    expect(JSON.stringify(feed)).not.toMatch(
      /private-owner\.jpg|other-guest\.jpg|private\/object\/key|foreign\/object\/key|192\.0\.2\.1|private-session-token|asset-private|55555555|88888888|99999999/,
    );
    expect(
      (await service.guestList(otherGuestSecret, albumId)).notifications.map(
        (item) => item.occurredAt,
      ),
    ).toEqual(['2026-11-07T10:03:00.000Z', '2026-11-07T10:01:00.000Z']);
    await expect(
      service.guestList(guestSecret, foreignAlbumId),
    ).rejects.toThrow('GUEST_ACCESS_REQUIRED');
  });

  it('allows view-only and download-only invites, but rejects expired or revoked sessions', async () => {
    const { db, run, insertSession } = fixture();
    await insertSession();
    const service = new D1DeliveryNotifications(db);
    expect(
      (await service.guestList(guestSecret, albumId)).notifications,
    ).toEqual([]);
    expect(
      (await service.guestList(otherGuestSecret, albumId)).notifications,
    ).toEqual([]);

    run('UPDATE guest_sessions SET expires_at_ms=0 WHERE id=?', sessionId);
    await expect(service.guestList(guestSecret, albumId)).rejects.toThrow(
      'GUEST_ACCESS_REQUIRED',
    );
    run(
      'UPDATE guest_sessions SET expires_at_ms=? WHERE id=?',
      Date.now() + 60_000,
      sessionId,
    );
    run('INSERT INTO guest_session_revocations VALUES(?)', sessionId);
    await expect(service.guestList(guestSecret, albumId)).rejects.toThrow(
      'GUEST_ACCESS_REQUIRED',
    );
  });

  it('caps Owner and Guest feeds at the 24 newest notices', async () => {
    const { db, run, insertSession } = fixture();
    await insertSession();
    const firstAt = Date.parse('2026-11-07T09:00:00.000Z');
    for (let index = 0; index < 30; index++) {
      const eventId =
        '00000000-0000-4000-8000-' + index.toString(16).padStart(12, '0');
      event(
        run,
        eventId,
        'delivery.published',
        new Date(firstAt + index * 60_000).toISOString(),
        { inviteIds: [inviteId] },
      );
    }

    const service = new D1DeliveryNotifications(db);
    const [ownerFeed, guestFeed] = await Promise.all([
      service.ownerList(ownerId, sessionId, workspaceId),
      service.guestList(guestSecret, albumId),
    ]);
    const newest = Array.from({ length: 24 }, (_, index) =>
      new Date(firstAt + (29 - index) * 60_000).toISOString(),
    );
    expect(ownerFeed.notifications.map((item) => item.occurredAt)).toEqual(
      newest,
    );
    expect(guestFeed.notifications.map((item) => item.occurredAt)).toEqual(
      newest,
    );
  });

  it('returns feature-off before reading notification data', async () => {
    let databaseReads = 0;
    const env = {
      APP_ENV: 'local',
      APP_URL: 'http://127.0.0.1:8787',
      REGISTRATION_MODE: 'closed',
      STORAGE_AUTODELETE_ENABLED: 'false',
      STORAGE_RETENTION_DRY_RUN: 'true',
      MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
      PHOTO_VERSIONS_ENABLED: 'true',
      VERSION_APPROVALS_ENABLED: 'true',
      GUEST_DOWNLOADS_ENABLED: 'true',
      APPROVED_DELIVERIES_ENABLED: 'false',
    } as WorkerEnv;
    Object.defineProperty(env, 'DB', {
      get() {
        databaseReads++;
        throw new Error('feature-off notification route read D1');
      },
    });

    const [ownerResponse, guestResponse] = await Promise.all([
      deliveryNotificationRoutes.request(
        '/api/v1/workspaces/' + workspaceId + '/delivery-notifications',
        { method: 'GET' },
        env,
      ),
      deliveryNotificationRoutes.request(
        '/api/guest/albums/' + albumId + '/delivery-notifications',
        { method: 'GET' },
        env,
      ),
    ]);
    expect(ownerResponse.status).toBe(503);
    expect(guestResponse.status).toBe(503);
    await expect(ownerResponse.json()).resolves.toEqual({
      error: { code: 'DELIVERIES_DISABLED' },
    });
    await expect(guestResponse.json()).resolves.toEqual({
      error: { code: 'DELIVERIES_DISABLED' },
    });
    expect(databaseReads).toBe(0);
  });
});
