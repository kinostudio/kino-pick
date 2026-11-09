import { describe, expect, it, vi } from 'vitest';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';
import { D1RetentionAlbumFacts } from '../../apps/worker/src/retention-album-facts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const albumId = '33333333-3333-4333-8333-333333333333';
const observedAt = Date.parse('2026-11-09T00:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    albumId,
    projectId,
    state: 'active',
    revision: 2,
    policyRevision: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    publishedAtMs: observedAt - 86_400_000,
    lastValidViewedAtMs: null,
    auditEventCount: 8,
    stateEventCount: 2,
    createdStateEventCount: 1,
    scopedStateEventCount: 2,
    validStateEventCount: 2,
    currentStateEventCount: 1,
    lastStateChangedAt: '2026-11-08T00:00:00.000Z',
    humanFrontierVerified: 1,
    policyPresent: 1,
    inactiveDays: 45,
    cleanupAllowed: 0,
    bytes: 29,
    assetCount: 6,
    versionCount: 2,
    latestActiveCustomShareExpiresAtMs: observedAt + 60_000,
    activeCustomShareCount: 1,
    blockers: ['DELETE_PROTECTED'],
    ...overrides,
  };
}

function database(meta: Record<string, unknown>) {
  const statement = { bind: vi.fn().mockReturnThis() };
  let preparedSql = '';
  const prepare = vi.fn((sql: string) => {
    preparedSql = sql;
    return statement;
  });
  const db = {
    prepare,
    batch: vi.fn().mockResolvedValue([{ success: true, results: [meta] }]),
  };
  return {
    db: db as unknown as D1Database,
    statement,
    getSql: () => preparedSql,
  };
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    owner_authorized: 1,
    workspace_exists: 1,
    workspace_authorized: 1,
    observed_at_ms: observedAt,
    album_count: 1,
    audit_source_count: 8,
    asset_source_count: 6,
    version_source_count: 2,
    albums_json: JSON.stringify([row()]),
    ...overrides,
  };
}

describe('schema69 Owner retention album facts', () => {
  it('returns one bounded, database-timestamped source snapshot without planner flags', async () => {
    const { db, statement, getSql } = database(result());
    const snapshot = await new D1RetentionAlbumFacts(
      db,
      'owner',
      'session',
    ).read(workspaceId);

    expect(db.batch).toHaveBeenCalledTimes(1);
    expect(statement.bind).toHaveBeenCalledWith(
      'owner',
      'session',
      workspaceId,
    );
    expect(getSql()).toContain('LIMIT 101');
    expect(getSql()).toContain('audit_owner_history_album_time');
    expect(getSql()).toContain('manual_album_deletion_blockers');
    expect(getSql()).toContain('LIMIT 100001');
    const auditRowsSql = getSql().match(
      /album_audit_rows AS MATERIALIZED \(([\s\S]*?)\),\s*album_audit_summary/,
    )?.[1];
    expect(auditRowsSql).toContain('LIMIT 100001');
    expect(auditRowsSql).not.toMatch(/\bWHERE\b[\s\S]*\baction\b/);
    expect(snapshot).toEqual({
      workspaceId,
      observedAt: '2026-11-09T00:00:00.000Z',
      albums: [
        {
          workspaceId,
          albumId,
          projectId,
          state: 'active',
          revision: 2,
          policyRevision: 3,
          createdAt: '2026-10-01T00:00:00.000Z',
          publishedAt: '2026-11-08T00:00:00.000Z',
          lastValidViewedAt: null,
          lastStateChangedAt: '2026-11-08T00:00:00.000Z',
          inactiveDays: 45,
          cleanupAllowed: false,
          bytes: 29,
          assetCount: 6,
          versionCount: 2,
          latestActiveCustomShareExpiresAt: '2026-11-09T00:01:00.000Z',
          activeCustomShareCount: 1,
          blockers: ['DELETE_PROTECTED'],
        },
      ],
    });
    expect(snapshot.albums[0]).not.toHaveProperty('retentionExcluded');
    expect(snapshot.albums[0]).not.toHaveProperty('preservationRequested');
  });

  it('keeps tied event times and leaves incomplete or invalid history unknown', async () => {
    const tied = database(
      result({
        albums_json: JSON.stringify([
          row({
            stateEventCount: 3,
            scopedStateEventCount: 3,
            validStateEventCount: 3,
          }),
        ]),
      }),
    );
    const tiedSnapshot = await new D1RetentionAlbumFacts(
      tied.db,
      'owner',
      'session',
    ).read(workspaceId);
    expect(tiedSnapshot.albums[0]?.lastStateChangedAt).toBe(
      '2026-11-08T00:00:00.000Z',
    );

    const incomplete = database(
      result({
        albums_json: JSON.stringify([row({ createdStateEventCount: 0 })]),
      }),
    );
    const incompleteSnapshot = await new D1RetentionAlbumFacts(
      incomplete.db,
      'owner',
      'session',
    ).read(workspaceId);
    expect(incompleteSnapshot.albums[0]?.lastStateChangedAt).toBeNull();

    const invalidTime = database(
      result({
        albums_json: JSON.stringify([
          row({ lastStateChangedAt: '2026-11-10T00:00:00.000Z' }),
        ]),
      }),
    );
    const invalidTimeSnapshot = await new D1RetentionAlbumFacts(
      invalidTime.db,
      'owner',
      'session',
    ).read(workspaceId);
    expect(invalidTimeSnapshot.albums[0]?.lastStateChangedAt).toBeNull();
  });

  it('returns an empty album list for an authorized empty workspace', async () => {
    const { db } = database(
      result({
        album_count: 0,
        audit_source_count: 0,
        asset_source_count: 0,
        version_source_count: 0,
        albums_json: '[]',
      }),
    );
    await expect(
      new D1RetentionAlbumFacts(db, 'owner', 'session').read(workspaceId),
    ).resolves.toMatchObject({ workspaceId, albums: [] });
  });

  it('distinguishes expired authorization from a cross-owner workspace', async () => {
    const expired = database(
      result({ owner_authorized: 0, workspace_authorized: 0 }),
    );
    await expect(
      new D1RetentionAlbumFacts(expired.db, 'owner', 'session').read(
        workspaceId,
      ),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED', status: 403 });

    const foreign = database(result({ workspace_authorized: 0 }));
    await expect(
      new D1RetentionAlbumFacts(foreign.db, 'owner', 'session').read(
        workspaceId,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('refuses overflow, missing policy, and a corrupted human frontier', async () => {
    const overflow = database(result({ album_count: 101, albums_json: null }));
    await expect(
      new D1RetentionAlbumFacts(overflow.db, 'owner', 'session').read(
        workspaceId,
      ),
    ).rejects.toMatchObject({ code: 'RETENTION_FACTS_LIMIT', status: 503 });

    const auditOverflow = database(result({ audit_source_count: 100_001 }));
    await expect(
      new D1RetentionAlbumFacts(auditOverflow.db, 'owner', 'session').read(
        workspaceId,
      ),
    ).rejects.toMatchObject({
      code: 'RETENTION_FACTS_LIMIT',
      status: 503,
    });

    const missingPolicy = database(
      result({ albums_json: JSON.stringify([row({ policyPresent: 0 })]) }),
    );
    await expect(
      new D1RetentionAlbumFacts(missingPolicy.db, 'owner', 'session').read(
        workspaceId,
      ),
    ).rejects.toMatchObject({
      code: 'RETENTION_FACTS_UNAVAILABLE',
      status: 503,
    });

    const badFrontier = database(
      result({
        albums_json: JSON.stringify([row({ humanFrontierVerified: 0 })]),
      }),
    );
    await expect(
      new D1RetentionAlbumFacts(badFrontier.db, 'owner', 'session').read(
        workspaceId,
      ),
    ).rejects.toMatchObject({
      code: 'RETENTION_FACTS_UNAVAILABLE',
      status: 503,
    });
  });

  it('rejects malformed identifiers before database access', async () => {
    const { db } = database(result());
    await expect(
      new D1RetentionAlbumFacts(db, 'owner', 'session').read('invalid'),
    ).rejects.toBeInstanceOf(WorkspaceFailure);
    expect(db.batch).not.toHaveBeenCalled();
  });
});
