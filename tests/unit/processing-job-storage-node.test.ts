import { describe, expect, it, vi } from 'vitest';
import { D1ImageProcessingRepository } from '../../apps/worker/src/processing-jobs';
import { D1ProcessingReviewRepository } from '../../apps/worker/src/processing-review';
import type { R2ProcessingReviewStore } from '../../apps/worker/src/processing-review-storage';

describe('processing job storage node lookup', () => {
  it('reads the original asset node without assuming the primary binding', async () => {
    const jobId = '00000000-0000-4000-8000-000000000001';
    const preparedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return {
          bind: vi.fn((value: string) => {
            expect(value).toBe(jobId);
            return {
              first: vi.fn(async () => ({ storage_node_id: 'oracle-vm' })),
            };
          }),
        };
      }),
    } as unknown as D1Database;

    await expect(
      new D1ImageProcessingRepository(db).jobStorageNode(jobId),
    ).resolves.toBe('oracle-vm');
    expect(preparedSql[0]).toContain(
      "JOIN photo_assets a ON a.id=j.id AND a.asset_kind='original' AND a.state='private'",
    );
    expect(preparedSql[0]).toContain(
      "JOIN storage_nodes n ON n.id=a.storage_node_id AND n.status='active'",
    );
  });

  it('routes review fencing through the node from its authorized source row', async () => {
    const ids = {
      job: '00000000-0000-4000-8000-000000000001',
      photo: '00000000-0000-4000-8000-000000000002',
      version: '00000000-0000-4000-8000-000000000003',
      workspace: '00000000-0000-4000-8000-000000000004',
      project: '00000000-0000-4000-8000-000000000005',
      album: '00000000-0000-4000-8000-000000000006',
    };
    const row = {
      id: ids.job,
      recipe: 'local-sharp-0.35.5-v1',
      status: 'needs_review',
      lease_epoch: 1,
      reason_code: 'PROCESSING_CONTENT_INVALID',
      reserved_bytes: 16777216,
      workspace_id: ids.workspace,
      project_id: ids.project,
      album_id: ids.album,
      storage_node_id: 'oracle-vm',
      node_status: 'active',
      album_state: 'active',
      project_state: 'active',
    };
    const slots = ['thumbnail', 'preview'].map((kind) => ({
      kind,
      object_key: `${ids.workspace}/${ids.project}/${ids.album}/${ids.job}/derived/local-sharp-0.35.5-v1/${kind}.jpg`,
    }));
    const preparedSql: string[] = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        preparedSql.push(sql);
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => row),
            all: vi.fn(async () => ({ results: slots })),
          })),
        };
      }),
    } as unknown as D1Database;
    const inspect = vi.fn(async () => 'missing' as const);
    const storageFor = vi.fn(
      () => ({ inspect }) as unknown as R2ProcessingReviewStore,
    );

    const preview = await new D1ProcessingReviewRepository(
      db,
      storageFor,
      '00000000-0000-4000-8000-000000000007',
      'session',
    ).preview(ids.photo, ids.version);

    expect(preview.outputs.map((output) => output.state)).toEqual([
      'missing',
      'missing',
    ]);
    expect(storageFor).toHaveBeenCalledWith('oracle-vm');
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(preparedSql[0]).toContain('a.storage_node_id');
    expect(preparedSql[0]).toContain('s.id=?');
    expect(preparedSql[0]).toContain("a.storage_node_id='primary'");
  });
});

describe('Owner exact-version Cloudflare processing retry target', () => {
  const photoId = '00000000-0000-4000-8000-000000000002';
  const versionId = '00000000-0000-4000-8000-000000000003';
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    workspace_id: '00000000-0000-4000-8000-000000000004',
    status: 'retryable',
    recipe: 'cloudflare-images-jpeg-82-v1',
    lease_epoch: 1,
    node_status: 'active',
    album_state: 'active',
    project_state: 'active',
  };
  function repository(result: unknown) {
    const bind = vi.fn(() => ({ first: async () => result }));
    const prepare = vi.fn((sql: string) => {
      expect(sql).toContain('owner_sessions');
      return { bind };
    });
    return {
      repo: new D1ProcessingReviewRepository(
        { prepare } as unknown as D1Database,
        {} as R2ProcessingReviewStore,
        'owner-identity',
        'current-session',
      ),
      prepare,
      bind,
    };
  }
  it('reuses Owner/session scope validation and returns only the recorded job', async () => {
    const { repo, prepare, bind } = repository(row);
    await expect(repo.retryTarget(photoId, versionId)).resolves.toEqual({
      jobId: row.id,
      workspaceId: row.workspace_id,
    });
    expect(bind).toHaveBeenCalledWith(
      'current-session',
      photoId,
      versionId,
      'owner-identity',
      1,
    );
    expect(prepare.mock.calls[0]?.[0]).toContain('w.owner_user_id=?');
    expect(prepare.mock.calls[0]?.[0]).toContain('s.expiresAt>');
  });
  it('rejects absent or foreign scope', async () => {
    await expect(
      repository(null).repo.retryTarget(photoId, versionId),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it.each([
    { status: 'running' },
    { status: 'needs_review' },
    { status: 'succeeded' },
    { status: 'abandoned' },
    { recipe: 'local-sharp-0.35.5-v1' },
    { lease_epoch: 3 },
    { node_status: 'inactive' },
    { album_state: 'archived' },
    { project_state: 'archived' },
  ])('does not restart an ineligible job %j', async (override) => {
    await expect(
      repository({ ...row, ...override }).repo.retryTarget(photoId, versionId),
    ).rejects.toMatchObject({ code: 'PROCESSING_RETRY_UNAVAILABLE' });
  });
});
