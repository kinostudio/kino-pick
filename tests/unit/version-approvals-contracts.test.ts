import { describe, expect, it } from 'vitest';
import {
  createVersionApprovalRequestSchema,
  guestVersionApprovalConfirmationResultSchema,
  guestVersionApprovalConfirmationSchema,
  guestVersionApprovalListSchema,
  guestVersionApprovalRequestSchema,
  ownerVersionApprovalListSchema,
  ownerVersionApprovalResultSchema,
  versionApprovalRequestSchema,
  versionApprovalsCapabilitiesSchema,
} from '../../packages/contracts/src/version-approvals';

const makeId = (sequence: number) =>
  '00000000-0000-4000-8000-' + String(sequence).padStart(12, '0');
const ownerId = makeId(1);
const guestId = makeId(2);
const inviteId = makeId(3);
const otherInviteId = makeId(4);
const workspaceId = makeId(5);
const projectId = makeId(6);
const albumId = makeId(7);
const photoId = makeId(8);
const versionId = makeId(9);
const requestId = makeId(10);
const approvalRequestId = makeId(11);
const eventId = 'evt_version_approval_1';
const occurredAt = '2026-10-29T10:00:00.000Z';

const createBody = {
  requestId,
  expectedOwnerId: ownerId,
  expectedHead: { versionId, revision: 4 },
  inviteIds: [inviteId],
  confirm: true,
};

const request = {
  id: approvalRequestId,
  workspaceId,
  projectId,
  albumId,
  photoId,
  versionId,
  versionNo: 2,
  headRevision: 4,
  inviteIds: [inviteId],
  status: 'open' as const,
  createdAt: occurredAt,
  confirmedAt: null,
};

const guestRequest = {
  id: approvalRequestId,
  photoId,
  versionId,
  versionNo: 2,
  headRevision: 4,
  isCurrent: true,
  status: 'open' as const,
  createdAt: occurredAt,
  confirmedAt: null,
};

describe('exact-version approval contracts', () => {
  it('requires a confirmed Owner command, exact head revision, and a bounded unique sealed invite set', () => {
    expect(createVersionApprovalRequestSchema.parse(createBody)).toEqual(
      createBody,
    );

    const caseVariant = inviteId.toUpperCase();
    expect(
      createVersionApprovalRequestSchema.parse({
        ...createBody,
        inviteIds: [caseVariant, otherInviteId],
      }).inviteIds,
    ).toEqual([inviteId, otherInviteId]);

    for (const change of [
      { confirm: false },
      { expectedOwnerId: undefined },
      { expectedHead: { versionId, revision: -1 } },
      { expectedHead: { versionId, revision: Number.MAX_SAFE_INTEGER + 1 } },
      { inviteIds: [] },
      {
        inviteIds: Array.from({ length: 25 }, (_, index) =>
          makeId(100 + index),
        ),
      },
      { inviteIds: [inviteId, caseVariant] },
      { inviteIds: [inviteId, 'not-a-uuid'] },
      { extra: 'not accepted' },
      { inviteIds: undefined },
    ]) {
      expect(
        createVersionApprovalRequestSchema.safeParse({
          ...createBody,
          ...change,
        }).success,
      ).toBe(false);
    }

    expect(
      createVersionApprovalRequestSchema.safeParse({
        ...createBody,
        expectedHead: { versionId, revision: 2, extra: true },
      }).success,
    ).toBe(false);
  });

  it('keeps Owner command results immutable and fresh read projections scoped', () => {
    expect(versionApprovalRequestSchema.parse(request)).toEqual(request);
    expect(
      versionApprovalRequestSchema.safeParse({
        ...request,
        status: 'confirmed',
      }).success,
    ).toBe(false);
    expect(
      versionApprovalRequestSchema.safeParse({
        ...request,
        status: 'confirmed',
        confirmedAt: occurredAt,
      }).success,
    ).toBe(true);
    expect(
      versionApprovalRequestSchema.safeParse({
        ...request,
        versionNo: 0,
      }).success,
    ).toBe(false);
    expect(
      versionApprovalRequestSchema.safeParse({
        ...request,
        headRevision: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
    expect(
      versionApprovalRequestSchema.safeParse({
        ...request,
        isCurrent: true,
      }).success,
    ).toBe(false);
    expect(
      versionApprovalRequestSchema.safeParse({
        ...request,
        secret: 'must never cross the DTO boundary',
      }).success,
    ).toBe(false);

    expect(
      ownerVersionApprovalResultSchema.safeParse({
        requestId,
        request,
        eventId,
        occurredAt,
      }).success,
    ).toBe(true);
    expect(
      ownerVersionApprovalResultSchema.safeParse({
        requestId,
        request,
        eventId: '',
        occurredAt,
      }).success,
    ).toBe(false);

    expect(
      ownerVersionApprovalListSchema.safeParse({
        requests: [{ ...request, isCurrent: false }],
        nextCursor: otherInviteId,
      }).success,
    ).toBe(true);
    expect(
      ownerVersionApprovalListSchema.safeParse({
        requests: [{ ...request, isCurrent: 'stale' }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });

  it('returns only the fixed target to Guests and rejects peer identities or invitation membership', () => {
    expect(guestVersionApprovalRequestSchema.parse(guestRequest)).toEqual(
      guestRequest,
    );
    expect(
      guestVersionApprovalRequestSchema.safeParse({
        ...guestRequest,
        inviteIds: [inviteId],
      }).success,
    ).toBe(false);
    for (const field of [
      'guestId',
      'sessionId',
      'confirmedByGuestId',
      'secret',
    ]) {
      expect(
        guestVersionApprovalRequestSchema.safeParse({
          ...guestRequest,
          [field]: guestId,
        }).success,
      ).toBe(false);
    }
    expect(
      guestVersionApprovalRequestSchema.safeParse({
        ...guestRequest,
        isCurrent: false,
      }).success,
    ).toBe(true);
    expect(
      guestVersionApprovalRequestSchema.safeParse({
        ...guestRequest,
        versionNo: 0,
      }).success,
    ).toBe(false);
    expect(
      guestVersionApprovalRequestSchema.safeParse({
        ...guestRequest,
        status: 'confirmed',
      }).success,
    ).toBe(false);
    expect(
      guestVersionApprovalRequestSchema.safeParse({
        ...guestRequest,
        status: 'confirmed',
        confirmedAt: occurredAt,
      }).success,
    ).toBe(true);

    expect(
      guestVersionApprovalListSchema.parse({
        requests: [guestRequest],
        nextCursor: otherInviteId,
      }).requests,
    ).toHaveLength(1);
    expect(
      guestVersionApprovalListSchema.safeParse({
        requests: Array.from({ length: 25 }, (_, index) => ({
          ...guestRequest,
          id: makeId(200 + index),
        })),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      guestVersionApprovalListSchema.safeParse({
        requests: [guestRequest],
        nextCursor: 'not-a-uuid',
      }).success,
    ).toBe(false);
    expect(
      guestVersionApprovalListSchema.safeParse({
        requests: [guestRequest],
      }).success,
    ).toBe(false);
  });

  it('binds Guest confirmation to its live identity and immutable receipt scope', () => {
    const confirmBody = { requestId, expectedGuestId: guestId, confirm: true };
    expect(guestVersionApprovalConfirmationSchema.parse(confirmBody)).toEqual(
      confirmBody,
    );
    for (const invalid of [
      { ...confirmBody, confirm: false },
      { ...confirmBody, inviteIds: [inviteId] },
      { ...confirmBody, secret: 'not a client field' },
      { requestId, confirm: true },
    ]) {
      expect(
        guestVersionApprovalConfirmationSchema.safeParse(invalid).success,
      ).toBe(false);
    }

    const result = {
      requestId,
      approvalRequestId,
      guestId,
      photoId,
      versionId,
      versionNo: 2,
      headRevision: 4,
      recorded: true,
      eventId,
      occurredAt,
    };
    expect(guestVersionApprovalConfirmationResultSchema.parse(result)).toEqual(
      result,
    );
    expect(
      guestVersionApprovalConfirmationResultSchema.safeParse({
        ...result,
        eventId: null,
      }).success,
    ).toBe(false);
    expect(
      guestVersionApprovalConfirmationResultSchema.safeParse({
        ...result,
        recorded: false,
        eventId: null,
      }).success,
    ).toBe(true);
    expect(
      guestVersionApprovalConfirmationResultSchema.safeParse({
        ...result,
        isCurrent: true,
      }).success,
    ).toBe(false);
    expect(
      guestVersionApprovalConfirmationResultSchema.safeParse({
        ...result,
        secret: 'must not be returned',
      }).success,
    ).toBe(false);
  });

  it('keeps the public capability response minimal and strict', () => {
    expect(versionApprovalsCapabilitiesSchema.parse({ enabled: true })).toEqual(
      { enabled: true },
    );
    expect(
      versionApprovalsCapabilitiesSchema.safeParse({
        enabled: false,
        inviteIds: [inviteId],
      }).success,
    ).toBe(false);
  });
});
