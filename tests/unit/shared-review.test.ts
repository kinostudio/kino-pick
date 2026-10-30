import { describe, expect, it } from 'vitest';
import {
  createSharedReviewSchema,
  setSharedReviewSelectionSchema,
  submitSharedReviewSchema,
  guestSharedReviewMetadataSchema,
} from '../../packages/contracts/src/shared-review';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('explicit shared selection boundary', () => {
  it('requires confirmation, unique member invitations and coherent bounds', () => {
    const base = {
      requestId: id,
      title: '  共用第一輪  ',
      inviteIds: [other],
      minimum: 1,
      maximum: 30,
      confirmShared: true,
    };
    expect(createSharedReviewSchema.parse(base).title).toBe('共用第一輪');
    for (const change of [
      { confirmShared: false },
      { confirmShared: undefined },
      { inviteIds: [] },
      { inviteIds: [other, other] },
      { minimum: 31 },
      { title: '\u202eunsafe' },
      { workspaceId: id },
    ])
      expect(
        createSharedReviewSchema.safeParse({ ...base, ...change }).success,
      ).toBe(false);
  });
  it('binds shared writes to a round and requires exact submit revision without accepting item lists', () => {
    const pick = {
      expectedGuestId: other,
      requestId: id,
      roundNo: 1,
      versionId: other,
      selected: true,
    };
    expect(setSharedReviewSelectionSchema.safeParse(pick).success).toBe(true);
    for (const change of [
      { roundNo: 0 },
      { expectedGuestId: undefined },
      { expectedGuestId: id + other },
      { roundNo: undefined },
      { guestId: id },
      { selected: 'true' },
    ])
      expect(
        setSharedReviewSelectionSchema.safeParse({ ...pick, ...change })
          .success,
      ).toBe(false);
    const submit = {
      requestId: id,
      expectedGuestId: other,
      roundNo: 2,
      expectedRevision: 7,
    };
    expect(submitSharedReviewSchema.safeParse(submit).success).toBe(true);
    expect(
      submitSharedReviewSchema.safeParse({
        ...submit,
        expectedGuestId: undefined,
      }).success,
    ).toBe(false);
    expect(
      submitSharedReviewSchema.safeParse({ ...submit, items: [] }).success,
    ).toBe(false);
    expect(
      submitSharedReviewSchema.safeParse({
        ...submit,
        expectedRevision: undefined,
      }).success,
    ).toBe(false);
  });
  it('prevents count disclosure without select and submit eligibility without its independent right', () => {
    const base = {
      id,
      albumId: other,
      guestId: id,
      title: '共用輪次',
      roundNo: 1,
      revision: 2,
      status: 'open',
      minimum: 1,
      maximum: 30,
      canSelect: false,
      canSubmit: true,
      canView: false,
      canSubmitNow: true,
      selectedCount: null,
      submittedAt: null,
    };
    expect(guestSharedReviewMetadataSchema.safeParse(base).success).toBe(true);
    expect(
      guestSharedReviewMetadataSchema.safeParse({ ...base, selectedCount: 2 })
        .success,
    ).toBe(false);
    expect(
      guestSharedReviewMetadataSchema.safeParse({
        ...base,
        canSelect: true,
        selectedCount: 2,
      }).success,
    ).toBe(true);
    expect(
      guestSharedReviewMetadataSchema.safeParse({ ...base, canSubmit: false })
        .success,
    ).toBe(false);
    expect(
      guestSharedReviewMetadataSchema.safeParse({
        ...base,
        status: 'submitted',
      }).success,
    ).toBe(false);
  });
});
