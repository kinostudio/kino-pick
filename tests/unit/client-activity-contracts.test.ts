import { describe, expect, it, vi } from 'vitest';
import {
  clientActivityCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { clientActivityIp } from '../../apps/worker/src/client-ip';
import { D1ClientActivityRepository } from '../../apps/worker/src/client-activity';

function id() {
  return crypto.randomUUID();
}

function viewState(overrides: Record<string, unknown> = {}) {
  return {
    guestId: id(),
    guestSessionId: id(),
    inviteId: id(),
    workspaceId: id(),
    projectId: id(),
    albumId: id(),
    existingEventId: null,
    existingGuestId: null,
    existingGuestSessionId: null,
    existingInviteId: null,
    existingWorkspaceId: null,
    existingProjectId: null,
    existingAlbumId: null,
    existingPhotoId: null,
    existingVersionId: null,
    existingBrowserDigest: null,
    existingRawIp: null,
    ...overrides,
  };
}

function fakeDb(state: ReturnType<typeof viewState>, changes = [1, 1]) {
  const preparedSql: string[] = [];
  const spyDb = {
    prepare: vi.fn((sql: string) => {
      preparedSql.push(sql);
      return {
        bind: vi.fn(() => ({ first: vi.fn(async () => state) })),
      };
    }),
    batch: vi.fn(async (statements: unknown[]) => {
      expect(statements).toHaveLength(2);
      return changes.map((count) => ({
        meta: { changes: count },
        results: [],
      }));
    }),
  };
  return { db: spyDb as unknown as D1Database, spyDb, preparedSql };
}

describe('Client activity repository contracts', () => {
  it('defaults background collection on and keeps an explicit false override', () => {
    const env = {
      APP_ENV: 'production',
      APP_URL: 'https://client-activity.example',
      REGISTRATION_MODE: 'closed',
      STORAGE_AUTODELETE_ENABLED: 'false',
      STORAGE_RETENTION_DRY_RUN: 'true',
      MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    };
    expect(clientActivityCapability(env as unknown as WorkerEnv)).toBe(true);
    expect(
      clientActivityCapability({
        ...env,
        CLIENT_ACTIVITY_ENABLED: 'false',
      } as unknown as WorkerEnv),
    ).toBe(false);
  });

  it('accepts only validated Cloudflare IP metadata and returns null locally', () => {
    const trusted = new Request('https://client-activity.example', {
      headers: {
        'CF-Connecting-IP': '203.0.113.24',
        'X-Forwarded-For': '198.51.100.100',
      },
    });
    Object.defineProperty(trusted, 'cf', { value: {} });
    expect(clientActivityIp(trusted, false)).toBe('203.0.113.24');
    expect(clientActivityIp(trusted, true)).toBeNull();

    const forged = new Request('https://client-activity.example', {
      headers: { 'X-Forwarded-For': '203.0.113.24' },
    });
    Object.defineProperty(forged, 'cf', { value: {} });
    expect(clientActivityIp(forged, false)).toBeNull();
  });

  it('rejects malformed identifiers, digest, and raw IP before database access', async () => {
    const { db, spyDb } = fakeDb(viewState());
    const repository = new D1ClientActivityRepository(db);
    const input = {
      viewId: id(),
      browserDigest: 'a'.repeat(64),
      expectedActorId: id(),
      albumId: id(),
      photoId: id(),
      versionId: id(),
      rawIp: null,
    };

    await expect(
      repository.recordGuestView('a'.repeat(64), { ...input, viewId: 'bad' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      repository.recordGuestView('a'.repeat(64), {
        ...input,
        browserDigest: 'A'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      repository.recordGuestView('a'.repeat(64), {
        ...input,
        rawIp: 'not-an-ip',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(spyDb.prepare).not.toHaveBeenCalled();
    expect(spyDb.batch).not.toHaveBeenCalled();
  });

  it('inserts the event before its witness receipt in one D1 batch', async () => {
    const { db, spyDb, preparedSql } = fakeDb(viewState());
    const repository = new D1ClientActivityRepository(db);
    const input = {
      viewId: id(),
      browserDigest: 'b'.repeat(64),
      expectedActorId: id(),
      albumId: id(),
      photoId: id(),
      versionId: id(),
      rawIp: '192.0.2.4',
    };

    await expect(
      repository.recordGuestView('a'.repeat(64), input),
    ).resolves.toEqual({ recorded: true });

    expect(spyDb.batch).toHaveBeenCalledTimes(1);
    expect(spyDb.batch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(preparedSql[1]).toContain('INSERT INTO client_browse_events');
    expect(preparedSql[2]).toContain('FROM client_browse_events event');
    expect(preparedSql[2]).toContain('first_event_id');
  });

  it('does not insert another event for an already committed view UUID', async () => {
    const input = {
      viewId: id(),
      browserDigest: 'c'.repeat(64),
      expectedActorId: id(),
      albumId: id(),
      photoId: id(),
      versionId: id(),
      rawIp: '2001:db8::1',
    };
    const state = viewState({
      guestId: input.expectedActorId,
      albumId: input.albumId,
      existingEventId: input.viewId,
      existingGuestId: input.expectedActorId,
      existingAlbumId: input.albumId,
      existingPhotoId: input.photoId,
      existingVersionId: input.versionId,
      existingBrowserDigest: input.browserDigest,
    });
    Object.assign(state, {
      existingGuestSessionId: state.guestSessionId,
      existingInviteId: state.inviteId,
      existingWorkspaceId: state.workspaceId,
      existingProjectId: state.projectId,
    });
    const { db, spyDb } = fakeDb(state);
    const repository = new D1ClientActivityRepository(db);

    await expect(
      repository.recordGuestView('a'.repeat(64), input),
    ).resolves.toEqual({ recorded: false });
    expect(spyDb.batch).not.toHaveBeenCalled();
  });
});
