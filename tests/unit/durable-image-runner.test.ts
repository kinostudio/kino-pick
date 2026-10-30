import { describe, expect, it } from 'vitest';
import type {
  ImageProcessingAdapter,
  ImageProcessingResult,
  ProcessedImageArtifact,
} from '../../packages/domain/src/index.ts';
import {
  DURABLE_IMAGE_PROCESSOR_VERSION,
  MAX_DURABLE_SOURCE_BYTES,
  runImageProcessingJob,
  type ProcessedOutputMetadata,
  type ProcessingJobClaim,
  type ProcessingJobStore,
  type ProcessingObjectStore,
} from '../../packages/image-processing/src/durable-runner.ts';

const jobId = '6c4d8e74-f643-4a82-8e70-51df0a568201';
const scope = {
  workspaceId: '8e9db6b7-e8e8-4860-8860-390260d3a001',
  projectId: '4b0f9d1d-b3f3-4bcb-9ef4-bbc86a53a002',
  albumId: 'bec86caf-9121-4f23-937c-a3dc1f7ba003',
};

function makeJpegHeader(width: number, height: number): Uint8Array {
  const component = [1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0];
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    17,
    8,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    3,
    ...component,
  ]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

type Fixture = {
  claim: ProcessingJobClaim;
  source: Uint8Array;
  thumbnail: ProcessedImageArtifact;
  preview: ProcessedImageArtifact;
  result: ImageProcessingResult;
};

async function makeFixture(): Promise<Fixture> {
  const source = makeJpegHeader(64, 32);
  const thumbnailBytes = makeJpegHeader(32, 16);
  const previewBytes = makeJpegHeader(64, 32);
  const expected = {
    mime: 'image/jpeg' as const,
    bytes: source.byteLength,
    sha256: await sha256Hex(source),
    width: 64,
    height: 32,
  };
  const claim: ProcessingJobClaim = {
    jobId,
    leaseToken: 'opaque-lease-token',
    leaseEpoch: 1,
    scope,
    photoId: '6633f33c-5c82-46c7-9ebd-fd8e5bc2a004',
    versionId: 'c7fb6c95-4669-4b6b-ae55-c84200e7a005',
    sourceKey: 'originals/photo/version/original.jpg',
    expected,
    processorVersion: DURABLE_IMAGE_PROCESSOR_VERSION,
    outputs: [
      {
        kind: 'preview',
        key: 'derived/photo/version/preview.jpg',
        maxBytes: 1024,
      },
      {
        kind: 'thumbnail',
        key: 'derived/photo/version/thumbnail.jpg',
        maxBytes: 1024,
      },
    ],
  };
  const thumbnail: ProcessedImageArtifact = {
    kind: 'thumbnail',
    bytes: thumbnailBytes,
    mime: 'image/jpeg',
    width: 32,
    height: 16,
    sha256: await sha256Hex(thumbnailBytes),
  };
  const preview: ProcessedImageArtifact = {
    kind: 'preview',
    bytes: previewBytes,
    mime: 'image/jpeg',
    width: 64,
    height: 32,
    sha256: await sha256Hex(previewBytes),
  };
  const result: ImageProcessingResult = {
    processorVersion: DURABLE_IMAGE_PROCESSOR_VERSION,
    scope,
    photoId: claim.photoId,
    versionId: claim.versionId,
    source: expected,
    artifacts: [thumbnail, preview],
  };
  return { claim, source, thumbnail, preview, result };
}

function copyClaim(claim: ProcessingJobClaim): ProcessingJobClaim {
  return {
    ...claim,
    scope: { ...claim.scope },
    expected: { ...claim.expected },
    outputs: claim.outputs.map((output) => ({ ...output })),
  };
}

type HarnessOptions = {
  assertLease?: (assertion: number) => Promise<void>;
  onPut?: (input: {
    scope: ProcessingJobClaim['scope'];
    key: string;
    bytes: Uint8Array;
    mime: 'image/jpeg';
    stored: Map<string, Uint8Array>;
  }) => Promise<'created' | 'exists'>;
  ignoreReadCap?: boolean;
};

function makeHarness(
  fixture: Fixture,
  options: HarnessOptions = {},
): {
  jobs: ProcessingJobStore;
  objects: ProcessingObjectStore;
  events: string[];
  stored: Map<string, Uint8Array>;
  completed: ProcessedOutputMetadata[][];
  failures: Array<{
    reason: 'PROCESSING_CONTENT_INVALID' | 'PROCESSING_IO_UNCERTAIN';
    review: boolean;
  }>;
  readLimits: Array<{ key: string; maxBytes: number }>;
} {
  const events: string[] = [];
  const stored = new Map<string, Uint8Array>([
    [fixture.claim.sourceKey, new Uint8Array(fixture.source)],
  ]);
  const completed: ProcessedOutputMetadata[][] = [];
  const failures: Array<{
    reason: 'PROCESSING_CONTENT_INVALID' | 'PROCESSING_IO_UNCERTAIN';
    review: boolean;
  }> = [];
  const readLimits: Array<{ key: string; maxBytes: number }> = [];
  let leaseAssertions = 0;

  const objects: ProcessingObjectStore = {
    async read(readScope, key, maxBytes) {
      expect(readScope).toEqual(scope);
      events.push(`read:${key}`);
      readLimits.push({ key, maxBytes });
      const bytes = stored.get(key);
      if (!bytes) throw new Error('OBJECT_NOT_FOUND');
      if (!options.ignoreReadCap && bytes.byteLength > maxBytes) {
        throw new Error('OBJECT_TOO_LARGE');
      }
      return new Uint8Array(bytes);
    },
    async putIfAbsent(putScope, key, bytes, mime) {
      events.push(`put:${key}`);
      expect(putScope).toEqual(scope);
      expect(mime).toBe('image/jpeg');
      if (options.onPut) {
        return options.onPut({
          scope: putScope,
          key,
          bytes: new Uint8Array(bytes),
          mime,
          stored,
        });
      }
      if (stored.has(key)) return 'exists';
      stored.set(key, new Uint8Array(bytes));
      return 'created';
    },
  };

  const jobs: ProcessingJobStore = {
    async claim(requestedJobId) {
      events.push('claim');
      if (requestedJobId !== fixture.claim.jobId) return null;
      return copyClaim(fixture.claim);
    },
    async assertLease(currentClaim) {
      leaseAssertions += 1;
      events.push(`assert:${leaseAssertions}`);
      expect(currentClaim.leaseToken).toBe(fixture.claim.leaseToken);
      await options.assertLease?.(leaseAssertions);
    },
    async complete(currentClaim, outputs) {
      events.push('complete');
      expect(currentClaim.leaseEpoch).toBe(fixture.claim.leaseEpoch);
      completed.push(outputs.map((output) => ({ ...output })));
    },
    async fail(_currentClaim, reason, review) {
      events.push(`fail:${reason}:${review}`);
      failures.push({ reason, review });
    },
  };

  return { jobs, objects, events, stored, completed, failures, readLimits };
}

function makeProcessor(
  result: ImageProcessingResult,
  events?: string[],
): ImageProcessingAdapter {
  return {
    async process() {
      events?.push('process');
      return result;
    },
  };
}

describe('durable image processing runner', () => {
  it('claims quota-backed work before reading and create-once publishing both outputs', async () => {
    const fixture = await makeFixture();
    const harness = makeHarness(fixture);
    const processor = makeProcessor(fixture.result, harness.events);

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor,
      }),
    ).resolves.toEqual({ status: 'succeeded' });

    const events = harness.events;
    expect(events[0]).toBe('claim');
    expect(events.at(-1)).toBe('complete');
    const sourceRead = events.indexOf(`read:${fixture.claim.sourceKey}`);
    const processed = events.indexOf('process');
    expect(sourceRead).toBeGreaterThan(0);
    expect(processed).toBeGreaterThan(sourceRead);
    let previous = processed;
    for (const key of [
      'derived/photo/version/thumbnail.jpg',
      'derived/photo/version/preview.jpg',
    ]) {
      const put = events.indexOf('put:' + key);
      const readback = events.indexOf('read:' + key);
      expect(put).toBeGreaterThan(previous);
      expect(readback).toBeGreaterThan(put);
      expect(
        events
          .slice(previous + 1, put)
          .some((event) => event.startsWith('assert:')),
      ).toBe(true);
      previous = readback;
    }
    expect(
      events
        .slice(previous + 1, -1)
        .some((event) => event.startsWith('assert:')),
    ).toBe(true);
    expect(harness.readLimits[0]).toEqual({
      key: fixture.claim.sourceKey,
      maxBytes: fixture.claim.expected.bytes,
    });
    expect(harness.completed).toEqual([
      [
        {
          kind: 'thumbnail',
          mime: 'image/jpeg',
          bytes: fixture.thumbnail.bytes.byteLength,
          sha256: fixture.thumbnail.sha256,
          width: fixture.thumbnail.width,
          height: fixture.thumbnail.height,
        },
        {
          kind: 'preview',
          mime: 'image/jpeg',
          bytes: fixture.preview.bytes.byteLength,
          sha256: fixture.preview.sha256,
          width: fixture.preview.width,
          height: fixture.preview.height,
        },
      ],
    ]);
    expect(harness.failures).toEqual([]);
  });

  it('returns busy when another worker owns the claim', async () => {
    const fixture = await makeFixture();
    const harness = makeHarness(fixture);
    const jobs: ProcessingJobStore = {
      ...harness.jobs,
      async claim() {
        harness.events.push('claim');
        return null;
      },
    };

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs,
        objects: harness.objects,
        processor: makeProcessor(fixture.result),
      }),
    ).resolves.toEqual({ status: 'busy' });
    expect(harness.events).toEqual(['claim']);
  });

  it('sends native decoder content failures to review instead of retrying them', async () => {
    const fixture = await makeFixture();
    const harness = makeHarness(fixture);
    const decoderFailure = Object.assign(
      new Error('Image decoder rejected the source image'),
      { code: 'invalid_image' },
    );
    const processor: ImageProcessingAdapter = {
      async process() {
        throw decoderFailure;
      },
    };

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor,
      }),
    ).resolves.toEqual({ status: 'needs_review' });
    expect(harness.failures).toEqual([
      { reason: 'PROCESSING_CONTENT_INVALID', review: true },
    ]);
    expect(harness.events.some((event) => event.startsWith('put:'))).toBe(
      false,
    );
  });

  it('recovers an unknown create response by adopting the exact deterministic key on retry', async () => {
    const fixture = await makeFixture();
    let firstPut = true;
    const harness = makeHarness(fixture, {
      async onPut({ key, bytes, stored }) {
        if (firstPut) {
          firstPut = false;
          stored.set(key, new Uint8Array(bytes));
          throw new Error('PUT_RESPONSE_LOST');
        }
        if (stored.has(key)) return 'exists';
        stored.set(key, new Uint8Array(bytes));
        return 'created';
      },
    });
    const processor = makeProcessor(fixture.result, harness.events);

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor,
      }),
    ).resolves.toEqual({ status: 'retryable' });
    expect(harness.failures).toEqual([
      { reason: 'PROCESSING_IO_UNCERTAIN', review: false },
    ]);

    const expectedThumbnail = new Uint8Array(fixture.thumbnail.bytes);
    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor,
      }),
    ).resolves.toEqual({ status: 'succeeded' });
    expect(harness.stored.get('derived/photo/version/thumbnail.jpg')).toEqual(
      expectedThumbnail,
    );
    expect(
      harness.events.filter(
        (event) => event === 'put:derived/photo/version/thumbnail.jpg',
      ),
    ).toHaveLength(2);
    expect(harness.completed).toHaveLength(1);
  });

  it('marks a corrupt preexisting deterministic output for review without overwriting it', async () => {
    const fixture = await makeFixture();
    const corrupt = new Uint8Array(fixture.thumbnail.bytes);
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 0xff;
    const harness = makeHarness(fixture);
    harness.stored.set('derived/photo/version/thumbnail.jpg', corrupt);

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor: makeProcessor(fixture.result),
      }),
    ).resolves.toEqual({ status: 'needs_review' });

    expect(harness.stored.get('derived/photo/version/thumbnail.jpg')).toEqual(
      corrupt,
    );
    expect(harness.stored.has('derived/photo/version/preview.jpg')).toBe(false);
    expect(harness.failures).toEqual([
      { reason: 'PROCESSING_CONTENT_INVALID', review: true },
    ]);
    expect(harness.completed).toEqual([]);
  });

  it('stops before the next output write when the lease is taken over', async () => {
    const fixture = await makeFixture();
    const harness = makeHarness(fixture, {
      async assertLease() {
        if (harness.stored.has('derived/photo/version/thumbnail.jpg'))
          throw new Error('PROCESSING_LEASE_LOST');
      },
    });

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor: makeProcessor(fixture.result),
      }),
    ).resolves.toEqual({ status: 'lease_lost' });

    expect(harness.stored.has('derived/photo/version/thumbnail.jpg')).toBe(
      true,
    );
    expect(harness.stored.has('derived/photo/version/preview.jpg')).toBe(false);
    expect(harness.failures).toEqual([]);
    expect(harness.events).not.toContain('complete');
  });

  it('does not read private source bytes after a claim immediately loses its lease', async () => {
    const fixture = await makeFixture();
    const harness = makeHarness(fixture, {
      async assertLease() {
        throw new Error('PROCESSING_LEASE_LOST');
      },
    });
    const result = await runImageProcessingJob({
      jobId: fixture.claim.jobId,
      jobs: harness.jobs,
      objects: harness.objects,
      processor: makeProcessor(fixture.result, harness.events),
    });
    expect(result.status).toBe('lease_lost');
    expect(
      harness.events.some(
        (event) =>
          event.startsWith('read:') ||
          event.startsWith('put:') ||
          event === 'process' ||
          event === 'complete',
      ),
    ).toBe(false);
    expect(harness.failures).toEqual([]);
  });

  it('rejects a source read that exceeds the claimed length or global cap before processing', async () => {
    const fixture = await makeFixture();
    const harness = makeHarness(fixture, { ignoreReadCap: true });
    harness.stored.set(
      fixture.claim.sourceKey,
      new Uint8Array(fixture.source.byteLength + 1),
    );
    const processor: ImageProcessingAdapter = {
      async process() {
        throw new Error('PROCESSOR_MUST_NOT_RUN');
      },
    };

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor,
      }),
    ).resolves.toEqual({ status: 'needs_review' });
    expect(harness.readLimits[0]).toEqual({
      key: fixture.claim.sourceKey,
      maxBytes: fixture.claim.expected.bytes,
    });
    expect(harness.events).not.toContain('process');

    const oversizedClaim = copyClaim(fixture.claim);
    Object.assign(oversizedClaim.expected, {
      bytes: MAX_DURABLE_SOURCE_BYTES + 1,
    });
    const oversizedFixture = { ...fixture, claim: oversizedClaim };
    const oversizedHarness = makeHarness(oversizedFixture);
    await expect(
      runImageProcessingJob({
        jobId: oversizedFixture.claim.jobId,
        jobs: oversizedHarness.jobs,
        objects: oversizedHarness.objects,
        processor: makeProcessor(fixture.result),
      }),
    ).resolves.toEqual({ status: 'needs_review' });
    expect(oversizedHarness.readLimits).toEqual([]);
  });

  it('rejects forged processor scope, hash, or JPEG dimensions before any output write', async () => {
    const fixture = await makeFixture();
    const forgedScope: ImageProcessingResult = {
      ...fixture.result,
      scope: { ...scope, albumId: '2dfe8c81-9246-4dfd-bbea-d319f348a006' },
    };
    const forgedHash: ImageProcessingResult = {
      ...fixture.result,
      artifacts: [
        { ...fixture.thumbnail, sha256: '0'.repeat(64) },
        fixture.preview,
      ],
    };
    const forgedDimensions: ImageProcessingResult = {
      ...fixture.result,
      artifacts: [
        { ...fixture.thumbnail, width: fixture.thumbnail.width + 1 },
        fixture.preview,
      ],
    };

    for (const forged of [forgedScope, forgedHash, forgedDimensions]) {
      const harness = makeHarness(fixture);
      await expect(
        runImageProcessingJob({
          jobId: fixture.claim.jobId,
          jobs: harness.jobs,
          objects: harness.objects,
          processor: makeProcessor(forged),
        }),
      ).resolves.toEqual({ status: 'needs_review' });
      expect(harness.events.some((event) => event.startsWith('put:'))).toBe(
        false,
      );
      expect(harness.failures).toEqual([
        { reason: 'PROCESSING_CONTENT_INVALID', review: true },
      ]);
    }
  });
});
