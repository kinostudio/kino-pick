import { describe, expect, it } from 'vitest';
import { projectOwnerHistoryDetails } from '../../apps/worker/src/owner-history-projection';

describe('album Owner feedback audit projection', () => {
  it('projects bounded freehand summaries and strips unrelated fields', () => {
    const after = {
      kind: 'annotation',
      scope: { kind: 'album', token: 'omit' },
      revision: 1,
      state: 'open',
      secret: 'omit',
      geometry: {
        type: 'freehand',
        coordinateSpace: 'normalized_1e6',
        version: 1,
        points: Array.from({ length: 200 }, (_, i) => ({ x: i, y: i })),
      },
    };
    const result = projectOwnerHistoryDetails(
      'owner.album_feedback_created',
      '{}',
      JSON.stringify(after),
    );
    expect(result.status).toBe('available');
    expect(result.after).toEqual({
      kind: 'annotation',
      scope: { kind: 'album' },
      revision: 1,
      state: 'open',
      geometry: { type: 'freehand', pointCount: 200 },
    });
    after.geometry.points[0]!.x = -1;
    expect(
      projectOwnerHistoryDetails(
        'owner.album_feedback_created',
        '{}',
        JSON.stringify(after),
      ).status,
    ).toBe('invalid');
  });
});
