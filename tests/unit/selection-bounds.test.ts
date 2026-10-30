import { describe, expect, it } from 'vitest';
import { ownerRoundReopenResultSchema } from '../../packages/contracts/src/owner-selection';
import { planSelectionBatch } from '../../packages/domain/src/selection-bounds';
import {
  selectionBoundsSchema,
  setSelectionPolicySchema,
} from '../../packages/contracts/src/selection-policy';

const photo = (id: string, versionId = 'v1') => ({ id, versionId });
describe('selection bounds planning', () => {
  it('clips new picks to remaining slots in visible order', () => {
    const photos = [photo('a'), photo('b'), photo('c')];
    const selected = new Map([['old', 'v1']]);
    expect(planSelectionBatch(photos, selected, 1, 2)).toEqual([photos[0]]);
    expect(selected.size).toBe(1);
    expect(planSelectionBatch(photos, selected, 1, null)).toEqual(photos);
  });
  it('allows version updates at or above the cap without consuming new slots', () => {
    const photos = [photo('new'), photo('same'), photo('changed', 'v2')];
    const selected = new Map([
      ['same', 'v1'],
      ['changed', 'v1'],
    ]);
    expect(planSelectionBatch(photos, selected, 2, 2)).toEqual([photos[2]]);
    expect(planSelectionBatch(photos, selected, 3, 2)).toEqual([photos[2]]);
    expect(planSelectionBatch(photos, selected, 2, 3)).toEqual([
      photos[0],
      photos[2],
    ]);
  });
  it('requires explicit confirmation, bounded integers and coherent min/max', () => {
    const base = {
      requestId: '11111111-1111-4111-8111-111111111111',
      expectedRevision: 0,
      minimum: 1,
      maximum: null,
      confirm: true,
    };
    expect(setSelectionPolicySchema.safeParse(base).success).toBe(true);
    for (const change of [
      { minimum: 0 },
      { minimum: 1.2 },
      { maximum: 100001 },
      { minimum: 3, maximum: 2 },
      { confirm: false },
      { confirm: undefined },
      { actorId: 'forged' },
    ])
      expect(
        setSelectionPolicySchema.safeParse({ ...base, ...change }).success,
      ).toBe(false);
    expect(
      selectionBoundsSchema.safeParse({
        minimum: 1,
        maximum: null,
        revision: 0,
        mode: 'shared',
      }).success,
    ).toBe(false);
  });
  it('accepts historical revision0 reopen results and new ready revision1 results only', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const result = {
      albumId: id,
      inviteId: id,
      guestId: id,
      roundNo: 2,
      status: 'open',
      reopenedAt: '2026-10-26T00:00:00.000Z',
      eventId: 'reopen:test',
    };
    for (const selectionRevision of [0, 1])
      expect(
        ownerRoundReopenResultSchema.safeParse({ ...result, selectionRevision })
          .success,
      ).toBe(true);
    expect(
      ownerRoundReopenResultSchema.safeParse({
        ...result,
        selectionRevision: 2,
      }).success,
    ).toBe(false);
  });
});
