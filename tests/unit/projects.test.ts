import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ProjectRepository,
  RepositoryError,
} from '../../packages/db/src/index';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
} from '../../packages/db/src/workspace-cursor';
import {
  albumProtectionSchema,
  createProjectSchema,
  createAlbumSchema,
  renameContentSchema,
  canManageContent,
} from '../../packages/contracts/src/projects';
const actor = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'google' as const,
};
const workspaceId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const createdAt = '2026-10-23T12:00:00.123456+00:00';
const workspace = {
  id: workspaceId,
  owner_user_id: actor.id,
  name: 'Studio',
  quota_bytes: 8000000000,
  created_at: createdAt,
};
const project = {
  id: projectId,
  workspace_id: workspaceId,
  name: 'Campaign',
  status: 'draft',
  versioning_mode: 'manual',
  revision: 1,
  created_at: createdAt,
};
// A query-recording stub isolates repository mapping/pagination from SQL/RLS,
// which are exercised separately against the embedded PostgreSQL engine.
function repository(responses: unknown[]) {
  const queries: { table: string; query: ReturnType<typeof builder> }[] = [];
  function builder(data: unknown) {
    const result = Promise.resolve({ data, error: null });
    return Object.assign(result, {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnValue(result),
    });
  }
  const from = vi.fn((table: string) => {
    const query = builder(responses.shift());
    queries.push({ table, query });
    return query;
  });
  const db = { from } as unknown as ConstructorParameters<
    typeof ProjectRepository
  >[0];
  return { repo: new ProjectRepository(db, actor), queries, from };
}
describe('project/album contracts', () => {
  it('rejects scope/actor/state/policy overrides and requires a bounded expected revision', () => {
    const requestId = randomUUID();
    expect(
      createProjectSchema.parse({ workspaceId, name: '  Test  ', requestId })
        .name,
    ).toBe('Test');
    expect(
      createProjectSchema.safeParse({
        workspaceId,
        name: 'x',
        requestId,
        ownerUserId: actor.id,
      }).success,
    ).toBe(false);
    expect(
      createAlbumSchema.safeParse({ name: 'x', requestId, workspaceId })
        .success,
    ).toBe(false);
    expect(
      createAlbumSchema.safeParse({ name: 'x', requestId, projectId }).success,
    ).toBe(false);
    expect(
      createAlbumSchema.safeParse({ name: 'x', requestId, isPinned: true })
        .success,
    ).toBe(false);
    for (const expectedRevision of [undefined, 0, -1, 1.5, 2147483648])
      expect(
        renameContentSchema.safeParse({
          name: 'x',
          requestId,
          expectedRevision,
        }).success,
      ).toBe(false);
    expect(
      renameContentSchema.safeParse({
        name: 'x',
        expectedRevision: 1,
        requestId,
        state: 'deleted',
      }).success,
    ).toBe(false);
    expect(
      renameContentSchema.safeParse({
        name: ' '.repeat(12),
        expectedRevision: 1,
        requestId,
      }).success,
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({
        workspaceId,
        name: 'x'.repeat(161),
        requestId,
      }).success,
    ).toBe(false);
  });
  it('keeps the UI write-role predicate explicit', () => {
    for (const role of [
      'workspace_owner',
      'workspace_editor',
      'photographer',
    ] as const)
      expect(canManageContent(role)).toBe(true);
    expect(canManageContent('retoucher')).toBe(false);
  });
});
describe('project repository read boundaries', () => {
  it('returns exactly 24 projects and advances the tuple cursor without timestamp precision loss', async () => {
    const rows = Array.from({ length: 25 }, () => ({
      ...project,
      id: randomUUID(),
    }));
    const { repo, queries } = repository([workspace, rows]);
    const before = encodeWorkspaceCursor({ createdAt, id: projectId });
    const page = await repo.list(workspaceId, before);
    expect(page.projects).toHaveLength(24);
    expect(decodeWorkspaceCursor(page.nextCursor!)).toEqual({
      createdAt,
      id: rows[23]!.id,
    });
    expect(queries[1]!.table).toBe('projects');
    expect(queries[1]!.query.eq).toHaveBeenCalledWith(
      'workspace_id',
      workspaceId,
    );
    expect(queries[1]!.query.limit).toHaveBeenCalledWith(25);
    expect(queries[1]!.query.order.mock.calls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(queries[1]!.query.or).toHaveBeenCalledWith(
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${projectId})`,
    );
  });
  it('scopes albums to both workspace and project, with a terminal page returning null', async () => {
    const row = {
      id: randomUUID(),
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'Proofs',
      state: 'draft',
      is_pinned: false,
      legal_hold: false,
      revision: 1,
      created_at: createdAt,
    };
    const { repo, queries } = repository([project, workspace, [row]]);
    const page = await repo.listAlbums(projectId);
    expect(page.albums).toMatchObject([
      { id: row.id, workspaceId, projectId, revision: 1 },
    ]);
    expect(page.nextCursor).toBeNull();
    expect(queries[2]!.query.eq.mock.calls).toEqual([
      ['workspace_id', workspaceId],
      ['project_id', projectId],
    ]);
  });
  it('rejects inaccessible parents and revoked memberships before returning content', async () => {
    const missing = repository([null]);
    await expect(missing.repo.get(projectId)).rejects.toEqual(
      new RepositoryError('NOT_FOUND'),
    );
    const revoked = repository([
      { ...workspace, owner_user_id: randomUUID() },
      null,
    ]);
    await expect(revoked.repo.list(workspaceId)).rejects.toEqual(
      new RepositoryError('NOT_FOUND'),
    );
    expect(revoked.queries.map((item) => item.table)).toEqual([
      'workspaces',
      'workspace_members',
    ]);
    expect(revoked.queries[1]!.query.eq.mock.calls).toEqual([
      ['workspace_id', workspaceId],
      ['user_id', actor.id],
      ['status', 'active'],
    ]);
  });
  it('rejects invalid cursors before issuing a database query', async () => {
    const { repo, from } = repository([]);
    await expect(repo.list(workspaceId, 'bad;filter')).rejects.toThrow();
    await expect(repo.listAlbums(projectId, 'bad;filter')).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });
});

it('protection contract requires explicit booleans, confirmation and bounded CAS without scope overrides', () => {
  const body = {
    isPinned: true,
    legalHold: false,
    confirmUnprotect: false,
    expectedRevision: 1,
    requestId: randomUUID(),
  };
  expect(albumProtectionSchema.safeParse(body).success).toBe(true);
  for (const key of ['isPinned', 'legalHold', 'confirmUnprotect'] as const) {
    expect(
      albumProtectionSchema.safeParse({ ...body, [key]: 'false' }).success,
    ).toBe(false);
    expect(
      albumProtectionSchema.safeParse({ ...body, [key]: undefined }).success,
    ).toBe(false);
  }
  for (const expectedRevision of [0, -1, 1.5, 2147483648])
    expect(
      albumProtectionSchema.safeParse({ ...body, expectedRevision }).success,
    ).toBe(false);
  for (const key of ['workspaceId', 'state', 'actorId', 'autodeleteEnabled'])
    expect(
      albumProtectionSchema.safeParse({ ...body, [key]: true }).success,
    ).toBe(false);
});
