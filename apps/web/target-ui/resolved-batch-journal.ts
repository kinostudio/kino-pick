import { z } from 'zod';
import { matchingProfileContextSchema } from '../../../packages/contracts/src/matching-rules';
import {
  resolvedUploadModeSchema,
  type ResolvedUploadFile,
} from '../../../packages/contracts/src/resolved-uploads';
import {
  decodeResolvedUploadJournal,
  encodeResolvedUploadJournal,
  resolvedUploadJournalItemSchema,
  resolvedUploadJournalScopeSchema,
  type ResolvedUploadJournalItem,
  type ResolvedUploadJournalScope,
} from './resolved-upload-journal';

const maxBrowserUploadBytes = 64 * 1024 * 1024;
const maxDescriptors = 1000;
const maxItemBytes = 65_536;
const maxManifestBytes = 1_048_576;
const maxAgeMs = 7 * 86_400_000;
const futureClockSkewMs = 60_000;
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const positiveProjectRevision = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647)
  .safe();

export type ResolvedBatchJournalErrorCode =
  | 'RESOLVED_BATCH_JOURNAL_INVALID'
  | 'RESOLVED_BATCH_JOURNAL_SCOPE_INVALID'
  | 'RESOLVED_BATCH_JOURNAL_EXPIRED'
  | 'RESOLVED_BATCH_JOURNAL_FUTURE'
  | 'RESOLVED_BATCH_JOURNAL_TOO_LARGE'
  | 'RESOLVED_BATCH_JOURNAL_DUPLICATE_ITEM'
  | 'RESOLVED_BATCH_JOURNAL_DUPLICATE_ORDINAL'
  | 'RESOLVED_BATCH_JOURNAL_DUPLICATE_REQUEST'
  | 'RESOLVED_BATCH_JOURNAL_DUPLICATE_SESSION'
  | 'RESOLVED_BATCH_JOURNAL_REVISION_CONFLICT'
  | 'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD'
  | 'RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION';

export class ResolvedBatchJournalError extends Error {
  constructor(public readonly code: ResolvedBatchJournalErrorCode) {
    super(code);
    this.name = 'ResolvedBatchJournalError';
  }
}

export const resolvedBatchJournalScopeSchema = resolvedUploadJournalScopeSchema;
export type ResolvedBatchJournalScope = ResolvedUploadJournalScope;

const capturedSessionIdSchema = z.string().min(1).max(512);

export const resolvedBatchPolicySchema = z
  .object({
    expectedMode: resolvedUploadModeSchema,
    projectRevision: positiveProjectRevision,
    matchingProfile: matchingProfileContextSchema.optional(),
  })
  .strict();
export type ResolvedBatchPolicy = z.infer<typeof resolvedBatchPolicySchema>;

export const resolvedBatchDescriptorSchema = z
  .object({
    id: z.uuid(),
    ordinal: z
      .number()
      .int()
      .min(0)
      .max(maxDescriptors - 1)
      .safe(),
    originalFilename: z
      .string()
      .min(1)
      .max(255)
      .refine(
        (value) =>
          value.trim().length > 0 && !/[\\/\u0000-\u001f\u007f]/u.test(value),
      ),
    expectedBytes: z
      .number()
      .int()
      .positive()
      .max(maxBrowserUploadBytes)
      .safe(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    lastModified: nonnegativeSafeInteger,
  })
  .strict();
export type ResolvedBatchDescriptor = z.infer<
  typeof resolvedBatchDescriptorSchema
>;

const descriptorListSchema = z
  .array(resolvedBatchDescriptorSchema)
  .max(maxDescriptors);

export const resolvedBatchManifestSchema = z
  .object({
    version: z.literal(1),
    scope: resolvedBatchJournalScopeSchema,
    queueId: z.uuid(),
    capturedSessionId: capturedSessionIdSchema,
    policy: resolvedBatchPolicySchema,
    revision: nonnegativeSafeInteger,
    createdAt: nonnegativeSafeInteger,
    savedAt: nonnegativeSafeInteger,
    descriptors: descriptorListSchema,
  })
  .strict();
export type ResolvedBatchManifest = z.infer<typeof resolvedBatchManifestSchema>;

export const resolvedBatchItemStateSchema = z.enum([
  'queued',
  'captured',
  'completed',
  // The controller may choose this only after a definitive server rejection,
  // never for a timeout, aborted transport or otherwise unknown outcome.
  'rejected',
  'needs_review',
  'cancelled',
]);

export const resolvedBatchItemEnvelopeSchema = z
  .object({
    version: z.literal(1),
    scope: resolvedBatchJournalScopeSchema,
    queueId: z.uuid(),
    capturedSessionId: capturedSessionIdSchema,
    policy: resolvedBatchPolicySchema,
    descriptor: resolvedBatchDescriptorSchema,
    revision: nonnegativeSafeInteger,
    state: resolvedBatchItemStateSchema,
    intent: resolvedUploadJournalItemSchema.nullable(),
    createdAt: nonnegativeSafeInteger,
    savedAt: nonnegativeSafeInteger,
  })
  .strict();
export type ResolvedBatchItemEnvelope = z.infer<
  typeof resolvedBatchItemEnvelopeSchema
>;

export type ResolvedBatchQueueSnapshot = Readonly<{
  manifest: ResolvedBatchManifest;
  items: readonly ResolvedBatchItemEnvelope[];
}>;

function fail(code: ResolvedBatchJournalErrorCode): never {
  throw new ResolvedBatchJournalError(code);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) fail('RESOLVED_BATCH_JOURNAL_INVALID');
  return result.data;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function sameScope(
  left: ResolvedBatchJournalScope,
  right: ResolvedBatchJournalScope,
) {
  return (
    left.actorId === right.actorId &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.albumId === right.albumId
  );
}

function samePolicy(left: ResolvedBatchPolicy, right: ResolvedBatchPolicy) {
  return (
    left.expectedMode === right.expectedMode &&
    left.projectRevision === right.projectRevision &&
    left.matchingProfile?.profile === right.matchingProfile?.profile &&
    left.matchingProfile?.ruleRevision ===
      right.matchingProfile?.ruleRevision &&
    Boolean(left.matchingProfile) === Boolean(right.matchingProfile)
  );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail('RESOLVED_BATCH_JOURNAL_INVALID');
    return encoded;
  }
  if (Array.isArray(value))
    return '[' + value.map((entry) => stableJson(entry)).join(',') + ']';
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + stableJson(record[key]));
  return '{' + fields.join(',') + '}';
}

function sameJson(left: unknown, right: unknown) {
  return stableJson(left) === stableJson(right);
}

function validateAge(createdAt: number, savedAt: number, now: number) {
  if (!Number.isSafeInteger(now) || now < 0)
    fail('RESOLVED_BATCH_JOURNAL_INVALID');
  if (createdAt > now + futureClockSkewMs || savedAt > now + futureClockSkewMs)
    fail('RESOLVED_BATCH_JOURNAL_FUTURE');
  if (createdAt > savedAt) fail('RESOLVED_BATCH_JOURNAL_INVALID');
  if (now - savedAt > maxAgeMs) fail('RESOLVED_BATCH_JOURNAL_EXPIRED');
}

function validateDescriptorOrder(
  descriptors: readonly ResolvedBatchDescriptor[],
) {
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const [index, descriptor] of descriptors.entries()) {
    const normalizedId = descriptor.id.toLowerCase();
    if (ids.has(normalizedId)) fail('RESOLVED_BATCH_JOURNAL_DUPLICATE_ITEM');
    if (ordinals.has(descriptor.ordinal))
      fail('RESOLVED_BATCH_JOURNAL_DUPLICATE_ORDINAL');
    if (descriptor.ordinal !== index)
      fail('RESOLVED_BATCH_JOURNAL_DUPLICATE_ORDINAL');
    ids.add(normalizedId);
    ordinals.add(descriptor.ordinal);
  }
}

function validateIntent(
  scope: ResolvedBatchJournalScope,
  descriptor: ResolvedBatchDescriptor,
  policy: ResolvedBatchPolicy,
  intent: ResolvedUploadJournalItem,
  now: number,
) {
  if (
    intent.id.toLowerCase() !== descriptor.id.toLowerCase() ||
    intent.fingerprint.originalFilename !== descriptor.originalFilename ||
    intent.reservationBody.file.originalFilename !==
      descriptor.originalFilename.trim() ||
    intent.fingerprint.expectedBytes !== descriptor.expectedBytes ||
    intent.reservationBody.file.expectedBytes !== descriptor.expectedBytes ||
    intent.fingerprint.contentType !== descriptor.contentType ||
    intent.reservationBody.file.contentType !== descriptor.contentType ||
    intent.reservationBody.expectedMode !== policy.expectedMode ||
    intent.reservationBody.expectedProjectRevision !== policy.projectRevision ||
    !samePolicy(
      {
        expectedMode: intent.reservationBody.expectedMode,
        projectRevision: intent.reservationBody.expectedProjectRevision,
        ...(intent.reservationBody.matchingProfile
          ? { matchingProfile: intent.reservationBody.matchingProfile }
          : {}),
      },
      policy,
    )
  )
    fail('RESOLVED_BATCH_JOURNAL_INVALID');

  const requestIds = [
    intent.reservationBody.requestId,
    intent.authorizeBody.requestId,
    intent.completeBody.requestId,
  ].map((requestId) => requestId.toLowerCase());
  if (new Set(requestIds).size !== requestIds.length)
    fail('RESOLVED_BATCH_JOURNAL_DUPLICATE_REQUEST');

  try {
    const encoded = encodeResolvedUploadJournal(scope, [intent], now);
    const decoded = decodeResolvedUploadJournal(encoded, scope, now);
    if (decoded.length !== 1 || !sameJson(decoded[0], intent))
      fail('RESOLVED_BATCH_JOURNAL_INVALID');
  } catch (error) {
    if (error instanceof ResolvedBatchJournalError) throw error;
    if (
      error instanceof Error &&
      error.message === 'RESOLVED_UPLOAD_JOURNAL_TOO_LARGE'
    )
      fail('RESOLVED_BATCH_JOURNAL_TOO_LARGE');
    fail('RESOLVED_BATCH_JOURNAL_INVALID');
  }
}

function validateManifest(input: unknown, now: number) {
  const manifest = parse(resolvedBatchManifestSchema, input);
  validateAge(manifest.createdAt, manifest.savedAt, now);
  validateDescriptorOrder(manifest.descriptors);
  return manifest;
}

function validateItemEnvelope(input: unknown, now: number) {
  const envelope = parse(resolvedBatchItemEnvelopeSchema, input);
  validateAge(envelope.createdAt, envelope.savedAt, now);
  if (envelope.intent)
    validateIntent(
      envelope.scope,
      envelope.descriptor,
      envelope.policy,
      envelope.intent,
      now,
    );

  const validState =
    (envelope.state === 'queued' && envelope.intent === null) ||
    (envelope.state === 'captured' &&
      envelope.intent !== null &&
      !envelope.intent.needsReview) ||
    (envelope.state === 'completed' &&
      envelope.intent !== null &&
      envelope.intent.reservation !== null &&
      !envelope.intent.needsReview) ||
    (envelope.state === 'rejected' &&
      envelope.intent !== null &&
      envelope.intent.reservation === null &&
      !envelope.intent.needsReview) ||
    (envelope.state === 'needs_review' &&
      envelope.intent !== null &&
      envelope.intent.needsReview) ||
    (envelope.state === 'cancelled' && envelope.intent === null);
  if (!validState) fail('RESOLVED_BATCH_JOURNAL_INVALID');
  return envelope;
}

export function validateResolvedBatchManifest(
  input: unknown,
  now = Date.now(),
) {
  return validateManifest(input, now);
}

export function validateResolvedBatchItemEnvelope(
  input: unknown,
  now = Date.now(),
) {
  return validateItemEnvelope(input, now);
}

export function resolvedBatchDescriptorForFile(input: {
  id: string;
  ordinal: number;
  file: Pick<File, 'name' | 'size' | 'type' | 'lastModified'>;
  contentType: ResolvedUploadFile['contentType'];
}): ResolvedBatchDescriptor {
  return parse(resolvedBatchDescriptorSchema, {
    id: input.id,
    ordinal: input.ordinal,
    originalFilename: input.file.name,
    expectedBytes: input.file.size,
    contentType: input.contentType,
    lastModified: input.file.lastModified,
  });
}

export function validateResolvedBatchQueue(
  manifestInput: unknown,
  itemInputs: readonly unknown[],
  now = Date.now(),
): ResolvedBatchQueueSnapshot {
  const manifest = validateManifest(manifestInput, now);
  if (itemInputs.length !== manifest.descriptors.length)
    fail('RESOLVED_BATCH_JOURNAL_INVALID');
  const items = itemInputs.map((input) => validateItemEnvelope(input, now));
  const descriptorsById = new Map(
    manifest.descriptors.map((descriptor) => [
      descriptor.id.toLowerCase(),
      descriptor,
    ]),
  );
  const seenItems = new Set<string>();
  const seenRequests = new Set<string>();
  const seenSessions = new Set<string>();

  for (const item of items) {
    const normalizedItemId = item.descriptor.id.toLowerCase();
    const descriptor = descriptorsById.get(normalizedItemId);
    if (
      !descriptor ||
      seenItems.has(normalizedItemId) ||
      !sameJson(descriptor, item.descriptor) ||
      !sameScope(item.scope, manifest.scope) ||
      item.queueId !== manifest.queueId ||
      item.capturedSessionId !== manifest.capturedSessionId ||
      !samePolicy(item.policy, manifest.policy)
    )
      fail('RESOLVED_BATCH_JOURNAL_SCOPE_INVALID');
    seenItems.add(normalizedItemId);

    const intent = item.intent;
    if (!intent) continue;
    for (const requestId of [
      intent.reservationBody.requestId,
      intent.authorizeBody.requestId,
      intent.completeBody.requestId,
    ]) {
      const normalizedRequestId = requestId.toLowerCase();
      if (seenRequests.has(normalizedRequestId))
        fail('RESOLVED_BATCH_JOURNAL_DUPLICATE_REQUEST');
      seenRequests.add(normalizedRequestId);
    }
    const sessionId = intent.reservation?.uploadSession.id;
    if (sessionId) {
      const normalizedSessionId = sessionId.toLowerCase();
      if (seenSessions.has(normalizedSessionId))
        fail('RESOLVED_BATCH_JOURNAL_DUPLICATE_SESSION');
      seenSessions.add(normalizedSessionId);
    }
  }
  if (seenItems.size !== descriptorsById.size)
    fail('RESOLVED_BATCH_JOURNAL_INVALID');
  return { manifest, items };
}

export function encodeResolvedBatchManifest(input: unknown, now = Date.now()) {
  const manifest = validateManifest(input, now);
  const text = JSON.stringify(manifest);
  if (byteLength(text) > maxManifestBytes)
    fail('RESOLVED_BATCH_JOURNAL_TOO_LARGE');
  return text;
}

export function decodeResolvedBatchManifest(
  text: string | null,
  expectedScope: ResolvedBatchJournalScope,
  now = Date.now(),
  expectedQueueId?: string,
): ResolvedBatchManifest | null {
  if (text === null) return null;
  if (text.length > maxManifestBytes || byteLength(text) > maxManifestBytes)
    fail('RESOLVED_BATCH_JOURNAL_TOO_LARGE');
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    fail('RESOLVED_BATCH_JOURNAL_INVALID');
  }
  const manifest = validateManifest(decoded, now);
  if (!sameScope(manifest.scope, expectedScope))
    fail('RESOLVED_BATCH_JOURNAL_SCOPE_INVALID');
  if (expectedQueueId !== undefined && manifest.queueId !== expectedQueueId)
    fail('RESOLVED_BATCH_JOURNAL_SCOPE_INVALID');
  return manifest;
}

export function encodeResolvedBatchItemEnvelope(
  input: unknown,
  now = Date.now(),
) {
  const envelope = validateItemEnvelope(input, now);
  const text = JSON.stringify(envelope);
  if (byteLength(text) > maxItemBytes) fail('RESOLVED_BATCH_JOURNAL_TOO_LARGE');
  return text;
}

export function decodeResolvedBatchItemEnvelope(
  text: string | null,
  expectedScope: ResolvedBatchJournalScope,
  expectedQueueId: string,
  expectedItemId: string,
  now = Date.now(),
): ResolvedBatchItemEnvelope | null {
  if (text === null) return null;
  if (text.length > maxItemBytes || byteLength(text) > maxItemBytes)
    fail('RESOLVED_BATCH_JOURNAL_TOO_LARGE');
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    fail('RESOLVED_BATCH_JOURNAL_INVALID');
  }
  const envelope = validateItemEnvelope(decoded, now);
  if (
    !sameScope(envelope.scope, expectedScope) ||
    envelope.queueId !== expectedQueueId ||
    envelope.descriptor.id !== expectedItemId
  )
    fail('RESOLVED_BATCH_JOURNAL_SCOPE_INVALID');
  return envelope;
}

function assertRevision(
  previousRevision: number,
  nextRevision: number,
  expected: number,
) {
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    previousRevision !== expected ||
    expected >= Number.MAX_SAFE_INTEGER ||
    nextRevision !== expected + 1
  )
    fail('RESOLVED_BATCH_JOURNAL_REVISION_CONFLICT');
}

export function assertResolvedBatchManifestTouch(
  previousInput: unknown,
  nextInput: unknown,
  expectedRevision: number,
  now = Date.now(),
) {
  const previous = validateManifest(previousInput, now);
  const next = validateManifest(nextInput, now);
  assertRevision(previous.revision, next.revision, expectedRevision);
  if (
    !sameScope(previous.scope, next.scope) ||
    previous.queueId !== next.queueId ||
    previous.capturedSessionId !== next.capturedSessionId ||
    !samePolicy(previous.policy, next.policy) ||
    previous.createdAt !== next.createdAt ||
    !sameJson(previous.descriptors, next.descriptors) ||
    next.savedAt < previous.savedAt
  )
    fail('RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD');
  return next;
}

function sameFrozenIntent(
  previous: ResolvedUploadJournalItem,
  next: ResolvedUploadJournalItem,
) {
  return (
    previous.id === next.id &&
    sameJson(previous.reservationBody, next.reservationBody) &&
    sameJson(previous.authorizeBody, next.authorizeBody) &&
    sameJson(previous.completeBody, next.completeBody) &&
    sameJson(previous.fingerprint, next.fingerprint)
  );
}

function reservationDidNotChange(
  previous: ResolvedUploadJournalItem,
  next: ResolvedUploadJournalItem,
) {
  return sameJson(previous.reservation, next.reservation);
}

function reservationWasAdded(
  previous: ResolvedUploadJournalItem,
  next: ResolvedUploadJournalItem,
) {
  return previous.reservation === null && next.reservation !== null;
}

export function assertResolvedBatchItemUpdate(
  previousInput: unknown,
  nextInput: unknown,
  expectedRevision: number,
  now = Date.now(),
) {
  const previous = validateItemEnvelope(previousInput, now);
  const next = validateItemEnvelope(nextInput, now);
  assertRevision(previous.revision, next.revision, expectedRevision);
  if (
    !sameScope(previous.scope, next.scope) ||
    previous.queueId !== next.queueId ||
    previous.capturedSessionId !== next.capturedSessionId ||
    !samePolicy(previous.policy, next.policy) ||
    !sameJson(previous.descriptor, next.descriptor) ||
    previous.createdAt !== next.createdAt ||
    next.savedAt < previous.savedAt
  )
    fail('RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD');

  const stateTransition = previous.state + '>' + next.state;
  if (
    ![
      'queued>queued',
      'queued>captured',
      'queued>cancelled',
      'captured>captured',
      'captured>completed',
      'captured>rejected',
      'rejected>rejected',
      'captured>needs_review',
      'completed>completed',
      'needs_review>needs_review',
      'cancelled>cancelled',
    ].includes(stateTransition)
  )
    fail('RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION');

  if (previous.state === 'queued') {
    if (next.state === 'queued' || next.state === 'cancelled') {
      if (previous.intent !== null || next.intent !== null)
        fail('RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD');
    } else if (
      next.state !== 'captured' ||
      previous.intent !== null ||
      next.intent === null ||
      next.intent.reservation !== null ||
      next.intent.needsReview
    ) {
      fail('RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION');
    }
    return next;
  }

  if (previous.state === 'captured') {
    const before = previous.intent;
    const after = next.intent;
    if (!before || !after || !sameFrozenIntent(before, after))
      fail('RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD');

    if (next.state === 'captured') {
      if (
        before.needsReview !== after.needsReview ||
        before.needsReview ||
        (!reservationDidNotChange(before, after) &&
          !reservationWasAdded(before, after))
      )
        fail('RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD');
    } else if (next.state === 'completed') {
      if (
        before.needsReview ||
        after.needsReview ||
        before.reservation === null ||
        !reservationDidNotChange(before, after)
      )
        fail('RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION');
    } else if (next.state === 'rejected') {
      if (
        before.reservation !== null ||
        after.reservation !== null ||
        before.needsReview ||
        after.needsReview
      )
        fail('RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION');
    } else if (next.state === 'needs_review') {
      if (
        before.needsReview ||
        !after.needsReview ||
        (!reservationDidNotChange(before, after) &&
          !reservationWasAdded(before, after))
      )
        fail('RESOLVED_BATCH_JOURNAL_INVALID_TRANSITION');
    }
    return next;
  }

  if (!sameJson(previous.intent, next.intent))
    fail('RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD');
  return next;
}

export function resolvedBatchJournalLimits() {
  return {
    maxDescriptors,
    maxItemBytes,
    maxManifestBytes,
    maxAgeMs,
    maxBrowserUploadBytes,
  } as const;
}
