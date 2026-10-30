import { describe, expect, it } from 'vitest';
import { resolveSelectionPolicyInheritance } from '../../packages/domain/src/selection-policy-inheritance';

const policy = (minimum: number, maximum: number | null, revision: number) => ({
  minimum,
  maximum,
  revision,
  mode: 'private' as const,
});

describe('project selection policy inheritance', () => {
  it('preserves the legacy missing-policy default', () => {
    expect(
      resolveSelectionPolicyInheritance({ project: null, album: null }),
    ).toEqual({
      minimum: 1,
      maximum: null,
      mode: 'private',
      source: 'system',
      projectRevision: 0,
      albumRevision: 0,
    });
  });
  it('inherits the whole project policy only without an album override', () => {
    const project = policy(3, 30, 4);
    expect(
      resolveSelectionPolicyInheritance({ project, album: null }),
    ).toMatchObject({
      minimum: 3,
      maximum: 30,
      source: 'project',
      projectRevision: 4,
    });
    expect(
      resolveSelectionPolicyInheritance({ project, album: policy(1, null, 2) }),
    ).toMatchObject({
      minimum: 1,
      maximum: null,
      source: 'album',
      projectRevision: 4,
      albumRevision: 2,
    });
  });
  it('keeps source and both revisions distinct across equal revision numbers', () => {
    const project = policy(2, 10, 1);
    const inherited = resolveSelectionPolicyInheritance({
      project,
      album: null,
    });
    const overridden = resolveSelectionPolicyInheritance({
      project,
      album: policy(2, 10, 1),
    });
    expect(inherited).not.toEqual(overridden);
    const changedDefault = resolveSelectionPolicyInheritance({
      project: policy(3, 20, 2),
      album: policy(2, 10, 1),
    });
    expect(changedDefault).toMatchObject({
      minimum: 2,
      maximum: 10,
      source: 'album',
      projectRevision: 2,
      albumRevision: 1,
    });
    expect(
      resolveSelectionPolicyInheritance({
        project: policy(3, 20, 2),
        album: null,
      }),
    ).toMatchObject({ minimum: 3, maximum: 20, source: 'project' });
  });
  it('retains the album epoch when explicitly returning to inheritance', () => {
    const inherited = resolveSelectionPolicyInheritance({
      project: policy(3, 30, 5),
      album: { mode: 'inherit', revision: 7 },
    });
    expect(inherited).toMatchObject({
      source: 'project',
      minimum: 3,
      maximum: 30,
      projectRevision: 5,
      albumRevision: 7,
    });
    expect(
      resolveSelectionPolicyInheritance({
        project: null,
        album: { mode: 'inherit', revision: 7 },
      }),
    ).toMatchObject({
      source: 'system',
      minimum: 1,
      maximum: null,
      albumRevision: 7,
    });
  });
  it('fails closed on malformed bounds rather than silently using defaults', () => {
    for (const invalid of [
      policy(0, 10, 1),
      policy(11, 10, 1),
      policy(1, 100001, 1),
      policy(1, null, -1),
      policy(1, null, 0),
    ]) {
      expect(() =>
        resolveSelectionPolicyInheritance({ project: invalid, album: null }),
      ).toThrow();
      expect(() =>
        resolveSelectionPolicyInheritance({
          project: policy(1, 10, 1),
          album: invalid,
        }),
      ).toThrow();
    }
  });
  it('does not mutate input snapshots when resolving changing defaults', () => {
    const project = Object.freeze(policy(2, 20, 1));
    const album = Object.freeze(policy(1, null, 3));
    const input = Object.freeze({ project, album });
    const result = resolveSelectionPolicyInheritance(input);
    result.minimum = 5;
    expect(album.minimum).toBe(1);
    expect(resolveSelectionPolicyInheritance(input).minimum).toBe(1);
  });
});
