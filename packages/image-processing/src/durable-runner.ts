import {
  MAX_IMAGE_HEADER_BYTES,
  inspectImageHeader,
} from '../../contracts/src/image-metadata.ts';
import type {
  ImageProcessingAdapter,
  ImageProcessingInput,
  ImageProcessingResult,
  Scope,
} from '../../domain/src/index.ts';

import { isProcessingRecipe, processingSourceLimit } from './recipes.ts';

export const DURABLE_IMAGE_PROCESSOR_VERSION = 'local-sharp-0.35.5-v1';
export const MAX_DURABLE_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_DURABLE_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_DURABLE_TOTAL_OUTPUT_BYTES = 16 * 1024 * 1024;

const MAX_INPUT_DIMENSION = 32_768;
const MAX_INPUT_PIXELS = 80_000_000;
const OUTPUT_EDGE_LIMITS = {
  thumbnail: 320,
  preview: 2_048,
} as const;

export type DurableImageOutputKind = 'thumbnail' | 'preview';

export type DurableImageExpectedSource = ImageProcessingInput['expected'];

export type DurableImageOutputSlot = Readonly<{
  kind: DurableImageOutputKind;
  key: string;
  maxBytes: number;
}>;

/** A claim represents a D1 lease and quota reservations already acquired atomically. */
export type ProcessingJobClaim = Readonly<{
  jobId: string;
  leaseToken: string;
  leaseEpoch: number;
  scope: Scope;
  photoId: string;
  versionId: string;
  sourceKey: string;
  expected: DurableImageExpectedSource;
  processorVersion: string;
  outputs: readonly DurableImageOutputSlot[];
}>;

export type ProcessedOutputMetadata = Readonly<{
  kind: DurableImageOutputKind;
  mime: 'image/jpeg';
  bytes: number;
  sha256: string;
  width: number;
  height: number;
}>;

export interface ProcessingJobStore {
  /** Returns null when the job is absent, complete, or held by another live lease. */
  claim(jobId: string): Promise<ProcessingJobClaim | null>;
  /** Must reject once this claim's token/epoch is no longer the current lease. */
  assertLease(claim: ProcessingJobClaim): Promise<void>;
  /** Atomically records both verified assets and converts the existing reservations. */
  complete(
    claim: ProcessingJobClaim,
    outputs: readonly ProcessedOutputMetadata[],
  ): Promise<void>;
  /** Must be conditional on this claim's current token/epoch and must not release quota. */
  fail(
    claim: ProcessingJobClaim,
    reason: 'PROCESSING_CONTENT_INVALID' | 'PROCESSING_IO_UNCERTAIN',
    review: boolean,
  ): Promise<void>;
}

export interface ProcessingObjectStore {
  read(scope: Scope, key: string, maxBytes: number): Promise<Uint8Array>;
  /** A key is immutable: this method creates it or reports that it already exists. */
  putIfAbsent(
    scope: Scope,
    key: string,
    bytes: Uint8Array,
    mime: 'image/jpeg',
  ): Promise<'created' | 'exists'>;
}

export type DurableImageProcessingStatus =
  'succeeded' | 'busy' | 'needs_review' | 'retryable' | 'lease_lost';

export type DurableImageProcessingOutcome = Readonly<{
  status: DurableImageProcessingStatus;
}>;

type PreparedOutput = ProcessedOutputMetadata &
  Readonly<{ key: string; content: Uint8Array }>;

class InvalidProcessingContentError extends Error {
  constructor() {
    super('PROCESSING_CONTENT_INVALID');
    this.name = 'InvalidProcessingContentError';
  }
}

const INVALID_PROCESSOR_CODES = new Set([
  'invalid_input',
  'source_too_large',
  'source_size_mismatch',
  'source_hash_mismatch',
  'source_mime_mismatch',
  'source_dimensions_mismatch',
  'source_dimensions_out_of_range',
  'unsupported_format',
  'animated_image',
  'invalid_image',
  'output_too_large',
  'output_verification_failed',
  'output_invalid',
  'source_decode_mismatch',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasLeaseLostCode(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (
    error.code === 'PROCESSING_LEASE_LOST' ||
    error.message === 'PROCESSING_LEASE_LOST'
  );
}

function isInvalidProcessorError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  return (
    typeof error.code === 'string' && INVALID_PROCESSOR_CODES.has(error.code)
  );
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sameScope(left: unknown, right: Scope): boolean {
  if (!isRecord(left)) return false;
  return (
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.albumId === right.albumId
  );
}

function copyClaim(claim: ProcessingJobClaim): ProcessingJobClaim {
  return {
    ...claim,
    scope: { ...claim.scope },
    expected: { ...claim.expected },
    outputs: claim.outputs.map((output) => ({ ...output })),
  };
}

function assertClaimIsUsable(
  claim: ProcessingJobClaim,
  requestedJobId: string,
): void {
  if (
    claim.jobId !== requestedJobId ||
    typeof claim.leaseToken !== 'string' ||
    claim.leaseToken.length === 0 ||
    !Number.isSafeInteger(claim.leaseEpoch) ||
    claim.leaseEpoch < 0 ||
    typeof claim.photoId !== 'string' ||
    claim.photoId.length === 0 ||
    typeof claim.versionId !== 'string' ||
    claim.versionId.length === 0 ||
    typeof claim.sourceKey !== 'string' ||
    claim.sourceKey.length === 0 ||
    !isProcessingRecipe(claim.processorVersion)
  ) {
    throw new InvalidProcessingContentError();
  }

  if (
    typeof claim.scope.workspaceId !== 'string' ||
    claim.scope.workspaceId.length === 0 ||
    typeof claim.scope.projectId !== 'string' ||
    claim.scope.projectId.length === 0 ||
    typeof claim.scope.albumId !== 'string' ||
    claim.scope.albumId.length === 0
  ) {
    throw new InvalidProcessingContentError();
  }

  const expected = claim.expected;
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(expected.mime) ||
    !positiveInteger(expected.bytes) ||
    expected.bytes > processingSourceLimit(claim.processorVersion) ||
    !validSha256(expected.sha256) ||
    !positiveInteger(expected.width) ||
    !positiveInteger(expected.height) ||
    expected.width > MAX_INPUT_DIMENSION ||
    expected.height > MAX_INPUT_DIMENSION ||
    expected.width * expected.height > MAX_INPUT_PIXELS
  ) {
    throw new InvalidProcessingContentError();
  }

  if (!Array.isArray(claim.outputs) || claim.outputs.length !== 2) {
    throw new InvalidProcessingContentError();
  }
  const kinds = new Set<DurableImageOutputKind>();
  const keys = new Set<string>([claim.sourceKey]);
  for (const output of claim.outputs) {
    if (
      (output.kind !== 'thumbnail' && output.kind !== 'preview') ||
      typeof output.key !== 'string' ||
      output.key.length === 0 ||
      !positiveInteger(output.maxBytes) ||
      output.maxBytes > MAX_DURABLE_OUTPUT_BYTES ||
      kinds.has(output.kind) ||
      keys.has(output.key)
    ) {
      throw new InvalidProcessingContentError();
    }
    kinds.add(output.kind);
    keys.add(output.key);
  }
  if (!kinds.has('thumbnail') || !kinds.has('preview')) {
    throw new InvalidProcessingContentError();
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const snapshot = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    snapshot.buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function matchesExpectedSource(
  source: unknown,
  expected: DurableImageExpectedSource,
): boolean {
  if (!isRecord(source)) return false;
  return (
    source.mime === expected.mime &&
    source.bytes === expected.bytes &&
    source.sha256 === expected.sha256 &&
    source.width === expected.width &&
    source.height === expected.height
  );
}

async function prepareOutputs(
  value: unknown,
  claim: ProcessingJobClaim,
): Promise<readonly PreparedOutput[]> {
  if (!isRecord(value)) throw new InvalidProcessingContentError();
  if (
    value.processorVersion !== claim.processorVersion ||
    !isProcessingRecipe(value.processorVersion) ||
    !sameScope(value.scope, claim.scope) ||
    value.photoId !== claim.photoId ||
    value.versionId !== claim.versionId ||
    !matchesExpectedSource(value.source, claim.expected) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length !== 2
  ) {
    throw new InvalidProcessingContentError();
  }

  const artifacts: readonly unknown[] = value.artifacts;
  const slotsByKind = new Map<DurableImageOutputKind, DurableImageOutputSlot>();
  for (const slot of claim.outputs) slotsByKind.set(slot.kind, slot);
  const seen = new Set<DurableImageOutputKind>();
  const prepared: PreparedOutput[] = [];
  let totalBytes = 0;

  for (const artifact of artifacts) {
    if (!isRecord(artifact)) throw new InvalidProcessingContentError();
    const kind = artifact.kind;
    if (kind !== 'thumbnail' && kind !== 'preview') {
      throw new InvalidProcessingContentError();
    }
    const slot = slotsByKind.get(kind);
    if (!slot || seen.has(kind)) throw new InvalidProcessingContentError();

    if (
      !(artifact.bytes instanceof Uint8Array) ||
      artifact.mime !== 'image/jpeg' ||
      !positiveInteger(artifact.width) ||
      !positiveInteger(artifact.height) ||
      artifact.width > OUTPUT_EDGE_LIMITS[kind] ||
      artifact.height > OUTPUT_EDGE_LIMITS[kind] ||
      !validSha256(artifact.sha256)
    ) {
      throw new InvalidProcessingContentError();
    }

    const content = new Uint8Array(artifact.bytes);
    if (
      content.byteLength === 0 ||
      content.byteLength > slot.maxBytes ||
      content.byteLength > MAX_DURABLE_OUTPUT_BYTES
    ) {
      throw new InvalidProcessingContentError();
    }
    totalBytes += content.byteLength;
    if (totalBytes > MAX_DURABLE_TOTAL_OUTPUT_BYTES) {
      throw new InvalidProcessingContentError();
    }

    let dimensions: { width: number; height: number };
    try {
      dimensions = inspectImageHeader(
        content.subarray(0, MAX_IMAGE_HEADER_BYTES),
        'image/jpeg',
        content.byteLength,
      );
    } catch {
      throw new InvalidProcessingContentError();
    }
    if (
      dimensions.width !== artifact.width ||
      dimensions.height !== artifact.height
    ) {
      throw new InvalidProcessingContentError();
    }

    const sha256 = await sha256Hex(content);
    if (sha256 !== artifact.sha256) throw new InvalidProcessingContentError();

    prepared.push({
      kind,
      key: slot.key,
      mime: 'image/jpeg',
      bytes: content.byteLength,
      sha256,
      width: dimensions.width,
      height: dimensions.height,
      content,
    });
    seen.add(kind);
  }

  if (!seen.has('thumbnail') || !seen.has('preview')) {
    throw new InvalidProcessingContentError();
  }

  return prepared.sort((left, right) =>
    left.kind === right.kind ? 0 : left.kind === 'thumbnail' ? -1 : 1,
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function processingInput(
  claim: ProcessingJobClaim,
  sourceBytes: Uint8Array,
): ImageProcessingInput {
  return {
    scope: { ...claim.scope },
    photoId: claim.photoId,
    versionId: claim.versionId,
    sourceBytes: new Uint8Array(sourceBytes),
    expected: { ...claim.expected },
  };
}

async function recordFailure(
  claim: ProcessingJobClaim,
  jobs: ProcessingJobStore,
  error: unknown,
  maxTransientAttempts = Number.POSITIVE_INFINITY,
): Promise<DurableImageProcessingOutcome> {
  if (hasLeaseLostCode(error)) return { status: 'lease_lost' };

  const invalid =
    error instanceof InvalidProcessingContentError ||
    isInvalidProcessorError(error);
  const review = invalid || claim.leaseEpoch >= maxTransientAttempts;
  try {
    await jobs.fail(
      claim,
      invalid ? 'PROCESSING_CONTENT_INVALID' : 'PROCESSING_IO_UNCERTAIN',
      review,
    );
  } catch (failureError) {
    if (hasLeaseLostCode(failureError)) return { status: 'lease_lost' };
    return { status: 'retryable' };
  }

  return { status: review ? 'needs_review' : 'retryable' };
}

/**
 * Runs one leased image job. Reservations are owned by the job store and are
 * deliberately retained on every failure; only complete() may convert them.
 */
export async function runImageProcessingJob(input: {
  jobId: string;
  jobs: ProcessingJobStore;
  objects: ProcessingObjectStore;
  processor: ImageProcessingAdapter;
  maxTransientAttempts?: number;
}): Promise<DurableImageProcessingOutcome> {
  if (
    input.maxTransientAttempts !== undefined &&
    (!Number.isInteger(input.maxTransientAttempts) ||
      input.maxTransientAttempts < 1 ||
      input.maxTransientAttempts > 10)
  )
    throw new RangeError('INVALID_PROCESSING_ATTEMPT_LIMIT');
  let claimed: ProcessingJobClaim | null;
  try {
    claimed = await input.jobs.claim(input.jobId);
  } catch (error) {
    return { status: hasLeaseLostCode(error) ? 'lease_lost' : 'retryable' };
  }
  if (!claimed) return { status: 'busy' };

  // Snapshot the D1 claim before the first storage/processor await that uses it.
  let claim: ProcessingJobClaim;
  try {
    claim = copyClaim(claimed);
  } catch {
    return recordFailure(
      claimed,
      input.jobs,
      new InvalidProcessingContentError(),
    );
  }

  let phase = 'claim_validation';
  try {
    assertClaimIsUsable(claim, input.jobId);
    await input.jobs.assertLease(claim);

    phase = 'source_read';
    const source = await input.objects.read(
      claim.scope,
      claim.sourceKey,
      claim.expected.bytes,
    );
    if (
      !(source instanceof Uint8Array) ||
      source.byteLength !== claim.expected.bytes ||
      source.byteLength > MAX_DURABLE_SOURCE_BYTES
    ) {
      throw new InvalidProcessingContentError();
    }

    await input.jobs.assertLease(claim);
    let result: ImageProcessingResult;
    try {
      phase = 'transform';
      result = await input.processor.process(processingInput(claim, source));
    } catch (error) {
      if (isInvalidProcessorError(error)) {
        throw new InvalidProcessingContentError();
      }
      throw error;
    }

    phase = 'output_validation';
    const outputs = await prepareOutputs(result, claim);
    const metadata: ProcessedOutputMetadata[] = [];

    for (const output of outputs) {
      phase = output.kind + '_lease';
      await input.jobs.assertLease(claim);
      phase = output.kind + '_write';
      const created = await input.objects.putIfAbsent(
        claim.scope,
        output.key,
        output.content,
        output.mime,
      );
      if (created !== 'created' && created !== 'exists') {
        throw new Error('PROCESSING_IO_UNCERTAIN');
      }

      phase = output.kind + '_readback';
      const storedBytes = await input.objects.read(
        claim.scope,
        output.key,
        output.bytes,
      );
      if (
        !(storedBytes instanceof Uint8Array) ||
        storedBytes.byteLength !== output.bytes
      ) {
        throw new InvalidProcessingContentError();
      }
      const storedSnapshot = new Uint8Array(storedBytes);
      if (
        (await sha256Hex(storedSnapshot)) !== output.sha256 ||
        !equalBytes(storedSnapshot, output.content)
      ) {
        throw new InvalidProcessingContentError();
      }

      metadata.push({
        kind: output.kind,
        bytes: output.bytes,
        mime: output.mime,
        width: output.width,
        height: output.height,
        sha256: output.sha256,
      });
    }

    await input.jobs.assertLease(claim);
    phase = 'complete';
    await input.jobs.complete(claim, metadata);
    return { status: 'succeeded' };
  } catch (error) {
    // Only fixed stages and categories: provider errors may contain private request data.
    console.warn(
      'IMAGE_PROCESSING_FAILED',
      phase,
      error instanceof Error &&
        /Too many subrequests|Too many API requests/i.test(error.message)
        ? 'SUBREQUEST_LIMIT'
        : 'PROCESSING_FAILURE',
    );
    return recordFailure(claim, input.jobs, error, input.maxTransientAttempts);
  }
}
