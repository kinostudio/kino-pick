import { describe, expect, it } from 'vitest';
import {
  assertResolvedBatchItemUpdate,
  assertResolvedBatchManifestTouch,
  decodeResolvedBatchItemEnvelope,
  decodeResolvedBatchManifest,
  encodeResolvedBatchItemEnvelope,
  encodeResolvedBatchManifest,
  resolvedBatchJournalLimits,
  validateResolvedBatchQueue,
  type ResolvedBatchDescriptor,
  type ResolvedBatchItemEnvelope,
  type ResolvedBatchManifest,
  type ResolvedBatchPolicy,
  type ResolvedBatchJournalScope,
} from '../../apps/web/target-ui/resolved-batch-journal';
import { ResolvedBatchJournalError } from '../../apps/web/target-ui/resolved-batch-journal';
import type { ResolvedUploadJournalItem } from '../../apps/web/target-ui/resolved-upload-journal';

const uuid = (n: number) =>
  '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope: ResolvedBatchJournalScope = {
  actorId: uuid(1),
  workspaceId: uuid(2),
  projectId: uuid(3),
  albumId: uuid(4),
};
const queueId = uuid(50);
const capturedSessionId = 'opaque-owner-session: 7f4d / current';
const now = 1_800_000_000_000;
const profilePolicy: ResolvedBatchPolicy = {
  expectedMode: 'assisted',
  projectRevision: 9,
  matchingProfile: { profile: 'default-v1', ruleRevision: 0 },
};
const legacyPolicy: ResolvedBatchPolicy = {
  expectedMode: 'auto_filename',
  projectRevision: 9,
};

function descriptor(
  ordinal = 0,
  overrides: Partial<ResolvedBatchDescriptor> = {},
): ResolvedBatchDescriptor {
  return {
    id: uuid(1_000 + ordinal),
    ordinal,
    originalFilename: 'Portrait_EDIT.jpg',
    expectedBytes: 1024,
    contentType: 'image/jpeg',
    lastModified: 1_700_000_000_000 + ordinal,
    ...overrides,
  };
}

function manifest(
  descriptors: ResolvedBatchDescriptor[] = [descriptor()],
  policy: ResolvedBatchPolicy = profilePolicy,
): ResolvedBatchManifest {
  return {
    version: 1,
    scope,
    queueId,
    capturedSessionId,
    policy,
    revision: 0,
    createdAt: now - 1000,
    savedAt: now,
    descriptors,
  };
}

function intentFor(
  file: ResolvedBatchDescriptor,
  ordinal = file.ordinal,
  policy: ResolvedBatchPolicy = profilePolicy,
  reservation: ResolvedUploadJournalItem['reservation'] = null,
): ResolvedUploadJournalItem {
  const id = file.id;
  const profile = policy.matchingProfile
    ? { matchingProfile: policy.matchingProfile }
    : {};
  return {
    id,
    reservationBody: {
      requestId: uuid(10_000 + ordinal * 10),
      file: {
        originalFilename: file.originalFilename.trim(),
        expectedBytes: file.expectedBytes,
        contentType: file.contentType,
        sha256: 'a'.repeat(64),
        dimensions: { width: 2400, height: 3600 },
      },
      expectedChangeSequence: 27 + ordinal,
      expectedProjectRevision: policy.projectRevision,
      expectedMode: policy.expectedMode as 'assisted' | 'auto_filename',
      ...profile,
      choice: {
        kind: 'new_version',
        photoId: uuid(50_000 + ordinal),
        parentVersionId: uuid(60_000 + ordinal),
        expectedRevision: 4,
      },
      confirm: true,
    },
    reservation,
    authorizeBody: { requestId: uuid(20_000 + ordinal * 10) },
    completeBody: { requestId: uuid(30_000 + ordinal * 10) },
    fingerprint: {
      originalFilename: file.originalFilename,
      expectedBytes: file.expectedBytes,
      contentType: file.contentType,
      sha256: 'a'.repeat(64),
      dimensions: { width: 2400, height: 3600 },
    },
    needsReview: false,
  };
}

function reservationFor(
  file: ResolvedBatchDescriptor,
  ordinal = file.ordinal,
  policy: ResolvedBatchPolicy = profilePolicy,
) {
  return {
    uploadSession: {
      id: uuid(70_000 + ordinal),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      albumId: scope.albumId,
      originalFilename: file.originalFilename.trim(),
      expectedBytes: file.expectedBytes,
      reservedBytes: file.expectedBytes,
      status: 'reserved' as const,
      expiresAt: '2027-01-01T00:15:00.000Z',
      createdAt: '2027-01-01T00:00:00.000Z',
    },
    target: {
      kind: 'new_version' as const,
      photoId: uuid(50_000 + ordinal),
      parentVersionId: uuid(60_000 + ordinal),
      expectedRevision: 4,
      capturedVersioningMode: policy.expectedMode,
      changeType: 'new_retouch' as const,
    },
  };
}

function envelope(
  file: ResolvedBatchDescriptor,
  options: {
    state?: ResolvedBatchItemEnvelope['state'];
    policy?: ResolvedBatchPolicy;
    intent?: ResolvedUploadJournalItem | null;
    revision?: number;
    savedAt?: number;
  } = {},
): ResolvedBatchItemEnvelope {
  return {
    version: 1,
    scope,
    queueId,
    capturedSessionId,
    policy: options.policy ?? profilePolicy,
    descriptor: file,
    revision: options.revision ?? 0,
    state: options.state ?? 'queued',
    intent: options.intent ?? null,
    createdAt: now - 1000,
    savedAt: options.savedAt ?? now,
  };
}

function capturedEnvelope(
  file: ResolvedBatchDescriptor,
  policy: ResolvedBatchPolicy = profilePolicy,
  ordinal = file.ordinal,
): ResolvedBatchItemEnvelope {
  return envelope(file, {
    state: 'captured',
    policy,
    intent: intentFor(file, ordinal, policy),
  });
}

function expectCode(work: () => unknown, code: string) {
  try {
    work();
    expect.fail('expected journal validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ResolvedBatchJournalError);
    expect((error as ResolvedBatchJournalError).code).toBe(code);
  }
}

describe('resolved batch metadata journal codecs', () => {
  it('round-trips a strict manifest and one queued envelope per descriptor up to 1,000 items', () => {
    const descriptors = Array.from({ length: 1000 }, (_, ordinal) =>
      descriptor(ordinal, { originalFilename: 'scan-' + ordinal + '.jpg' }),
    );
    const value = manifest(descriptors);
    const encoded = encodeResolvedBatchManifest(value, now);
    const decodedManifest = decodeResolvedBatchManifest(
      encoded,
      scope,
      now,
      queueId,
    );
    const items = descriptors.map((entry) => envelope(entry));

    expect(decodedManifest).toEqual(value);
    expect(
      validateResolvedBatchQueue(decodedManifest, items, now).items,
    ).toHaveLength(1000);
    expect(Object.keys(descriptors[0] ?? {}).sort()).toEqual(
      [
        'contentType',
        'expectedBytes',
        'id',
        'lastModified',
        'ordinal',
        'originalFilename',
      ].sort(),
    );
    expect(encoded).not.toMatch(
      /"(?:sha256|requestId|file|blob|signedUrl|accessToken|secret)"\s*:/iu,
    );
  });

  it('round-trips a captured profile-aware intent while preserving the raw filename descriptor', () => {
    const file = descriptor(0, { originalFilename: ' Portrait_EDIT.jpg ' });
    const captured = capturedEnvelope(file);
    const encoded = encodeResolvedBatchItemEnvelope(captured, now);
    const decoded = decodeResolvedBatchItemEnvelope(
      encoded,
      scope,
      queueId,
      file.id,
      now,
    );
    const value = manifest([file]);

    expect(decoded).toEqual(captured);
    expect(decoded?.descriptor.originalFilename).toBe(' Portrait_EDIT.jpg ');
    expect(decoded?.intent?.reservationBody.file.originalFilename).toBe(
      'Portrait_EDIT.jpg',
    );
    expect(decoded?.intent?.reservationBody.matchingProfile).toEqual(
      profilePolicy.matchingProfile,
    );
    expect(validateResolvedBatchQueue(value, [captured], now).items[0]).toEqual(
      captured,
    );
    expect(encoded).not.toMatch(
      /https:|signedUrl|uploadAuthorization|rawBytes|accessToken/i,
    );
  });

  it('preserves legacy captured intents with matchingProfile absent', () => {
    const file = descriptor(0);
    const value = envelope(file, {
      state: 'captured',
      policy: legacyPolicy,
      intent: intentFor(file, 0, legacyPolicy),
    });
    const roundTrip = decodeResolvedBatchItemEnvelope(
      encodeResolvedBatchItemEnvelope(value, now),
      scope,
      queueId,
      file.id,
      now,
    );

    expect(roundTrip?.policy).toEqual(legacyPolicy);
    expect(roundTrip?.intent?.reservationBody).not.toHaveProperty(
      'matchingProfile',
    );
  });

  it('rejects extra fields, cross-scope records, and mismatched captured intent bindings', () => {
    const file = descriptor();
    expectCode(
      () =>
        encodeResolvedBatchManifest(
          { ...manifest(), signedUrl: 'https://r2.invalid/private' },
          now,
        ),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );
    expectCode(
      () =>
        encodeResolvedBatchManifest(
          {
            ...manifest(),
            descriptors: [{ ...file, file: { name: 'photo.jpg' } }],
          },
          now,
        ),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );
    expectCode(
      () =>
        encodeResolvedBatchItemEnvelope(
          { ...envelope(file), rawBytes: [1, 2, 3] },
          now,
        ),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );

    const changedScope = { ...scope, albumId: uuid(900) };
    const encoded = encodeResolvedBatchManifest(manifest([file]), now);
    expectCode(
      () => decodeResolvedBatchManifest(encoded, changedScope, now),
      'RESOLVED_BATCH_JOURNAL_SCOPE_INVALID',
    );
    expectCode(
      () => decodeResolvedBatchManifest(encoded, scope, now, uuid(999)),
      'RESOLVED_BATCH_JOURNAL_SCOPE_INVALID',
    );

    const wrongIntent = capturedEnvelope(file);
    if (wrongIntent.intent)
      wrongIntent.intent.reservationBody.file.expectedBytes += 1;
    expectCode(
      () => encodeResolvedBatchItemEnvelope(wrongIntent, now),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );
    const wrongPolicy = capturedEnvelope(file);
    wrongPolicy.policy = { ...profilePolicy, projectRevision: 10 };
    expectCode(
      () => encodeResolvedBatchItemEnvelope(wrongPolicy, now),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );
  });

  it('rejects duplicate descriptor IDs, ordinals, operation IDs, and reservation sessions', () => {
    const first = descriptor(0, {
      id: 'abcdefab-cdef-4abc-8abc-abcdefabcdef',
    });
    const second = descriptor(1, { id: first.id.toUpperCase() });
    expectCode(
      () => encodeResolvedBatchManifest(manifest([first, second]), now),
      'RESOLVED_BATCH_JOURNAL_DUPLICATE_ITEM',
    );

    const sameOrdinal = [first, descriptor(0, { id: uuid(1_001) })];
    expectCode(
      () => encodeResolvedBatchManifest(manifest(sameOrdinal), now),
      'RESOLVED_BATCH_JOURNAL_DUPLICATE_ORDINAL',
    );

    const files = [descriptor(0), descriptor(1)];
    const firstItem = capturedEnvelope(files[0]!);
    const secondItem = capturedEnvelope(files[1]!);
    if (firstItem.intent && secondItem.intent) {
      firstItem.intent.reservationBody.requestId =
        'abcdefab-cdef-4abc-8abc-abcdefabcdef';
      secondItem.intent.authorizeBody.requestId =
        'ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF';
    }
    expectCode(
      () =>
        validateResolvedBatchQueue(
          manifest(files),
          [firstItem, secondItem],
          now,
        ),
      'RESOLVED_BATCH_JOURNAL_DUPLICATE_REQUEST',
    );

    const duplicateWithinItem = capturedEnvelope(files[0]!);
    if (duplicateWithinItem.intent)
      duplicateWithinItem.intent.authorizeBody.requestId =
        duplicateWithinItem.intent.reservationBody.requestId.toUpperCase();
    expectCode(
      () => encodeResolvedBatchItemEnvelope(duplicateWithinItem, now),
      'RESOLVED_BATCH_JOURNAL_DUPLICATE_REQUEST',
    );

    const reservedFirst = intentFor(
      files[0]!,
      0,
      profilePolicy,
      reservationFor(files[0]!),
    );
    const reservedSecond = intentFor(
      files[1]!,
      1,
      profilePolicy,
      reservationFor(files[1]!),
    );
    if (reservedSecond.reservation && reservedFirst.reservation)
      reservedSecond.reservation.uploadSession.id =
        reservedFirst.reservation.uploadSession.id;
    expectCode(
      () =>
        validateResolvedBatchQueue(
          manifest(files),
          [
            envelope(files[0]!, { state: 'captured', intent: reservedFirst }),
            envelope(files[1]!, { state: 'captured', intent: reservedSecond }),
          ],
          now,
        ),
      'RESOLVED_BATCH_JOURNAL_DUPLICATE_SESSION',
    );
  });

  it('keeps each encoded item and the manifest within byte limits and fails closed on aged/future data', () => {
    const file = descriptor();
    const limits = resolvedBatchJournalLimits();
    expect(limits.maxDescriptors).toBe(1000);
    expect(limits.maxItemBytes).toBe(65_536);
    expect(limits.maxManifestBytes).toBe(1_048_576);
    expect(decodeResolvedBatchManifest(null, scope, now)).toBeNull();
    expectCode(
      () =>
        decodeResolvedBatchManifest(
          ' '.repeat(limits.maxManifestBytes + 1),
          scope,
          now,
        ),
      'RESOLVED_BATCH_JOURNAL_TOO_LARGE',
    );
    expectCode(
      () =>
        decodeResolvedBatchItemEnvelope(
          ' '.repeat(limits.maxItemBytes + 1),
          scope,
          queueId,
          file.id,
          now,
        ),
      'RESOLVED_BATCH_JOURNAL_TOO_LARGE',
    );

    const encoded = encodeResolvedBatchManifest(manifest([file]), now);
    expectCode(
      () =>
        decodeResolvedBatchManifest(encoded, scope, now + 7 * 86_400_000 + 1),
      'RESOLVED_BATCH_JOURNAL_EXPIRED',
    );
    expectCode(
      () => decodeResolvedBatchManifest(encoded, scope, now - 60_001),
      'RESOLVED_BATCH_JOURNAL_FUTURE',
    );
    expectCode(
      () => decodeResolvedBatchManifest('{', scope, now),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );
  });

  it('enforces per-item revision CAS, immutable captured bodies, and the allowed lifecycle', () => {
    const file = descriptor();
    const queued = envelope(file);
    const captured = envelope(file, {
      revision: 1,
      savedAt: now + 1,
      state: 'captured',
      intent: intentFor(file),
    });
    expect(assertResolvedBatchItemUpdate(queued, captured, 0, now + 1)).toEqual(
      captured,
    );

    const reservation = reservationFor(file);
    const reservedIntent = intentFor(file, 0, profilePolicy, reservation);
    const reserved = {
      ...captured,
      revision: 2,
      savedAt: now + 2,
      intent: reservedIntent,
    };
    expect(
      assertResolvedBatchItemUpdate(captured, reserved, 1, now + 2),
    ).toEqual(reserved);

    const completed = {
      ...reserved,
      revision: 3,
      savedAt: now + 3,
      state: 'completed' as const,
    };
    expect(
      assertResolvedBatchItemUpdate(reserved, completed, 2, now + 3),
    ).toEqual(completed);
    const changedCompletedReservation = {
      ...completed,
      revision: 4,
      savedAt: now + 4,
      intent: {
        ...reservedIntent,
        reservation: {
          ...reservation,
          uploadSession: { ...reservation.uploadSession, id: uuid(80_000) },
        },
      },
    };
    expectCode(
      () =>
        assertResolvedBatchItemUpdate(
          completed,
          changedCompletedReservation,
          3,
          now + 4,
        ),
      'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD',
    );

    const needsReview = {
      ...reserved,
      revision: 3,
      savedAt: now + 3,
      state: 'needs_review' as const,
      intent: { ...reservedIntent, needsReview: true },
    };
    expect(
      assertResolvedBatchItemUpdate(reserved, needsReview, 2, now + 3),
    ).toEqual(needsReview);

    const backwards = { ...reserved, savedAt: now - 1, revision: 3 };
    expectCode(
      () => assertResolvedBatchItemUpdate(reserved, backwards, 2, now + 3),
      'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD',
    );
    expectCode(
      () => assertResolvedBatchItemUpdate(reserved, needsReview, 1, now + 3),
      'RESOLVED_BATCH_JOURNAL_REVISION_CONFLICT',
    );

    const rewrite = {
      ...reserved,
      revision: 3,
      savedAt: now + 3,
      intent: {
        ...reservedIntent,
        reservationBody: {
          ...reservedIntent.reservationBody,
          choice: { kind: 'new_photo' as const },
        },
      },
    };
    expectCode(
      () => assertResolvedBatchItemUpdate(reserved, rewrite, 2, now + 3),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );

    const terminalReset = {
      ...needsReview,
      revision: 4,
      savedAt: now + 4,
      state: 'captured' as const,
      intent: { ...needsReview.intent, needsReview: false },
    };
    expectCode(
      () =>
        assertResolvedBatchItemUpdate(needsReview, terminalReset, 3, now + 4),
      'RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION',
    );

    const capturedCancel = {
      ...reserved,
      revision: 3,
      savedAt: now + 3,
      state: 'cancelled' as const,
    };
    expectCode(
      () => assertResolvedBatchItemUpdate(reserved, capturedCancel, 2, now + 3),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );

    const cancelled = {
      ...queued,
      revision: 1,
      savedAt: now + 1,
      state: 'cancelled' as const,
    };
    expect(
      assertResolvedBatchItemUpdate(queued, cancelled, 0, now + 1),
    ).toEqual(cancelled);
  });

  it('preserves terminal rejection metadata and rejects reserved intents, reactivation and target replacement', () => {
    const file = descriptor();
    const original = envelope(file, {
      revision: 1,
      savedAt: now + 1,
      state: 'captured',
      intent: intentFor(file),
    });
    const rejected = {
      ...original,
      revision: 2,
      savedAt: now + 2,
      state: 'rejected' as const,
    };
    expect(
      assertResolvedBatchItemUpdate(original, rejected, 1, now + 2),
    ).toEqual(rejected);
    expect(
      decodeResolvedBatchItemEnvelope(
        encodeResolvedBatchItemEnvelope(rejected, now + 2),
        scope,
        queueId,
        file.id,
        now + 2,
      ),
    ).toEqual(rejected);
    expectCode(
      () =>
        assertResolvedBatchItemUpdate(
          rejected,
          { ...rejected, revision: 3, savedAt: now + 3, state: 'captured' },
          2,
          now + 3,
        ),
      'RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION',
    );
    expectCode(
      () =>
        assertResolvedBatchItemUpdate(
          rejected,
          {
            ...rejected,
            revision: 3,
            savedAt: now + 3,
            intent: {
              ...rejected.intent!,
              reservationBody: {
                ...rejected.intent!.reservationBody,
                requestId: uuid(99_999),
              },
            },
          },
          2,
          now + 3,
        ),
      'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD',
    );
    const reserved = {
      ...original,
      intent: intentFor(file, 0, profilePolicy, reservationFor(file)),
    };
    expectCode(
      () => assertResolvedBatchItemUpdate(reserved, rejected, 1, now + 2),
      'RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION',
    );
    expectCode(
      () =>
        encodeResolvedBatchItemEnvelope(
          { ...rejected, intent: reserved.intent },
          now + 2,
        ),
      'RESOLVED_BATCH_JOURNAL_INVALID',
    );
  });

  it('allows bounded manifest CAS touches while freezing descriptors and policy immediately', () => {
    const first = descriptor(0);
    const previous = manifest([first]);
    const touched = {
      ...previous,
      revision: 1,
      savedAt: now + 1,
    };
    expect(
      assertResolvedBatchManifestTouch(previous, touched, 0, now + 1),
    ).toEqual(touched);

    const appended = descriptor(1, { originalFilename: 'second.png' });
    const append = {
      ...touched,
      descriptors: [first, appended],
    };
    expectCode(
      () => assertResolvedBatchManifestTouch(previous, append, 0, now + 1),
      'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD',
    );

    const policyChange = {
      ...touched,
      policy: { ...profilePolicy, projectRevision: 10 },
    };
    expectCode(
      () =>
        assertResolvedBatchManifestTouch(previous, policyChange, 0, now + 1),
      'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD',
    );

    const descriptorChange = {
      ...touched,
      descriptors: [descriptor(0, { originalFilename: 'renamed.jpg' })],
    };
    expectCode(
      () =>
        assertResolvedBatchManifestTouch(
          previous,
          descriptorChange,
          0,
          now + 1,
        ),
      'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD',
    );
  });
});
