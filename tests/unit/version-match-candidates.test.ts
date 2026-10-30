import { describe, expect, it } from 'vitest';
import { D1VersionMatchCandidates } from '../../apps/worker/src/version-match-candidates';

const albumId = '10000000-0000-4000-8000-000000000001';
const photoId = '20000000-0000-4000-8000-000000000001';
const versionId = '30000000-0000-4000-8000-000000000001';
const row = {
  rowKind: 'version',
  changeSequence: 7,
  pendingUploadId: null,
  workspaceId: '40000000-0000-4000-8000-000000000001',
  projectId: '50000000-0000-4000-8000-000000000001',
  albumId,
  mode: 'auto_filename',
  projectRevision: 3,
  albumRevision: 2,
  photoId,
  versionId,
  filename: 'portrait.JPG',
  sha256: 'a'.repeat(64),
  width: 300,
  height: 200,
  headVersionId: versionId,
  headRevision: 1,
};
const evidence = {
  filename: 'portrait.JPG',
  sha256: 'b'.repeat(64),
  dimensions: { width: 300, height: 200 },
};

// Only tests conversion/decision boundaries; real authorization/SQL is exercised
// separately in the workerd/D1 suite, not proven by this D1-shaped test double.
function repository(rows: readonly unknown[]) {
  let selectedLimit: unknown;
  const statement = {
    bind(...values: readonly unknown[]) {
      selectedLimit = values[3];
      return this;
    },
    async all() {
      return { success: true, results: rows };
    },
  };
  const db = {
    prepare() {
      return statement;
    },
  } as unknown as D1Database;
  return {
    repo: new D1VersionMatchCandidates(db, 'owner', 'session'),
    limit: () => selectedLimit,
  };
}

describe('version candidate snapshot conversion', () => {
  it('keeps a complete exactly-1000-version set and asks SQL for a sentinel', async () => {
    const { repo, limit } = repository(
      Array.from({ length: 1000 }, (_, i) => ({
        ...row,
        versionId: '30000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      })),
    );
    const { snapshot, decision } = await repo.resolve(albumId, evidence);
    expect(limit()).toBe(1002);
    expect(snapshot.candidates).toHaveLength(1000);
    expect(snapshot.candidatesTruncated).toBe(false);
    expect(decision.outcome).toBe('new_version');
    expect(snapshot.heads[photoId]).toEqual({ versionId, revision: 1 });
  });
  it('requires review rather than inferring no match beyond the bound', async () => {
    const { repo } = repository(
      Array.from({ length: 1001 }, (_, i) => ({
        ...row,
        versionId: '30000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'),
      })),
    );
    const { snapshot, decision } = await repo.resolve(albumId, {
      ...evidence,
      filename: 'other.JPG',
    });
    expect(snapshot.candidates).toHaveLength(1000);
    expect(snapshot.candidatesTruncated).toBe(true);
    expect(decision).toMatchObject({
      outcome: 'requires_review',
      reason: 'candidate_limit_exceeded',
    });
  });
  it('does not infer a new photo from incomplete version/head evidence', async () => {
    for (const incomplete of [
      { ...row, headVersionId: null, headRevision: null },
      { ...row, versionId: null, sha256: null, width: null, height: null },
    ]) {
      const { repo } = repository([incomplete]);
      expect((await repo.resolve(albumId, evidence)).decision.outcome).toBe(
        'requires_review',
      );
    }
  });
  it('represents an authorized empty album without inventing candidates', async () => {
    const { repo } = repository([
      {
        ...row,
        rowKind: 'scope',
        photoId: null,
        versionId: null,
        filename: null,
        sha256: null,
        width: null,
        height: null,
        headVersionId: null,
        headRevision: null,
      },
    ]);
    const { snapshot, decision } = await repo.resolve(albumId, evidence);
    expect(snapshot.candidates).toEqual([]);
    expect(snapshot.candidatesTruncated).toBe(false);
    expect(decision).toMatchObject({
      outcome: 'new_photo',
      reason: 'no_filename_match',
    });
  });
  it('never takes mode/options/candidates/scope from request evidence', async () => {
    const { repo } = repository([{ ...row, mode: 'manual' }]);
    for (const forged of [
      { mode: 'auto_filename' },
      { options: { caseSensitive: false } },
      { candidates: [] },
      { scope: { albumId } },
    ])
      await expect(
        repo.resolve(albumId, { ...evidence, ...forged }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await repo.resolve(albumId, evidence)).decision.reason).toBe(
      'matching_disabled',
    );
  });
  it('reviews a changed crop in a differently named current head of the matched logical photo', async () => {
    const changedHead = '30000000-0000-4000-8000-000000000002';
    const { repo } = repository([
      { ...row, headVersionId: changedHead, headRevision: 2 },
      {
        ...row,
        versionId: changedHead,
        filename: 'portrait_edit.JPG',
        sha256: 'c'.repeat(64),
        height: 100,
        headVersionId: changedHead,
        headRevision: 2,
      },
    ]);
    const result = await repo.resolve(albumId, evidence);
    expect(result.decision).toMatchObject({
      outcome: 'requires_review',
      reason: 'dimension_change_requires_review',
      photoId,
    });
    expect(result.snapshot.candidates[1]?.filename).toBe('portrait_edit.JPG');
  });
  it('detects identical content under a different version filename after identifying the logical photo', async () => {
    const otherVersion = '30000000-0000-4000-8000-000000000002';
    const { repo } = repository([
      row,
      {
        ...row,
        versionId: otherVersion,
        filename: 'portrait_edit.JPG',
        sha256: evidence.sha256,
      },
    ]);
    expect((await repo.resolve(albumId, evidence)).decision).toMatchObject({
      outcome: 'duplicate',
      reason: 'exact_hash_match',
      photoId,
      versionId: otherVersion,
    });
  });
  it('blocks a same-name pending reservation while allowing unrelated names and manual mode', async () => {
    const pending = {
      ...row,
      rowKind: 'pending',
      pendingUploadId: versionId,
      photoId: null,
      versionId: null,
      filename: evidence.filename,
      sha256: null,
      headVersionId: null,
      headRevision: null,
    };
    const blocked = await repository([row, pending]).repo.resolve(
      albumId,
      evidence,
    );
    expect(blocked.snapshot.changeSequence).toBe(7);
    expect(blocked.snapshot.pendingUploads).toHaveLength(1);
    expect(blocked.decision).toMatchObject({
      outcome: 'requires_review',
      reason: 'pending_upload_requires_review',
    });
    expect(
      (
        await repository([
          row,
          { ...pending, filename: 'other.jpg' },
        ]).repo.resolve(albumId, evidence)
      ).decision.outcome,
    ).toBe('new_version');
    expect(
      (
        await repository([
          { ...row, mode: 'manual' },
          { ...pending, mode: 'manual' },
        ]).repo.resolve(albumId, evidence)
      ).decision.reason,
    ).toBe('matching_disabled');
  });
  it('denies absent authorization rows and malformed database evidence', async () => {
    await expect(repository([]).repo.read(albumId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      repository([{ ...row, mode: 'unexpected' }]).repo.read(albumId),
    ).rejects.toMatchObject({ code: 'VERSION_MATCHING_UNAVAILABLE' });
    await expect(
      repository([row]).repo.read("' OR 1=1 --"),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
