import { describe, expect, it } from 'vitest';
import type {
  ImageProcessingAdapter,
  ImageProcessingInput,
  ImageProcessingResult,
  ProcessedImageArtifact,
} from '../../packages/domain/src/index.ts';
import {
  runImageProcessingJob,
  type ProcessedOutputMetadata,
  type ProcessingJobClaim,
  type ProcessingJobStore,
  type ProcessingObjectStore,
} from '../../packages/image-processing/src/durable-runner.ts';
import {
  isProcessingRecipe,
  processingSourceLimit,
} from '../../packages/image-processing/src/recipes.ts';

const LOCAL_RECIPE = 'local-sharp-0.35.5-v1';
const CLOUDFLARE_RECIPE = 'cloudflare-images-jpeg-82-v1';
const jobId = '6c4d8e74-f643-4a82-8e70-51df0a568201';
const scope = {
  workspaceId: '8e9db6b7-e8e8-4860-8860-390260d3a001',
  projectId: '4b0f9d1d-b3f3-4bcb-9ef4-bbc86a53a002',
  albumId: 'bec86caf-9121-4f23-937c-a3dc1f7ba003',
};

function makeJpegHeader(width: number, height: number): Uint8Array {
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
    1,
    0x11,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
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

async function makeFixture(processorVersion: string): Promise<Fixture> {
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
    processorVersion,
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
    processorVersion,
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

function makeHarness(fixture: Fixture): {
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

  const objects: ProcessingObjectStore = {
    async read(readScope, key, maxBytes) {
      expect(readScope).toEqual(scope);
      events.push('read:' + key);
      readLimits.push({ key, maxBytes });
      const bytes = stored.get(key);
      if (!bytes) throw new Error('OBJECT_NOT_FOUND');
      if (bytes.byteLength > maxBytes) throw new Error('OBJECT_TOO_LARGE');
      return new Uint8Array(bytes);
    },
    async putIfAbsent(putScope, key, bytes, mime) {
      events.push('put:' + key);
      expect(putScope).toEqual(scope);
      expect(mime).toBe('image/jpeg');
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
      events.push('assert');
      expect(currentClaim.leaseToken).toBe(fixture.claim.leaseToken);
    },
    async complete(_currentClaim, outputs) {
      events.push('complete');
      completed.push(outputs.map((output) => ({ ...output })));
    },
    async fail(_currentClaim, reason, review) {
      events.push('fail:' + reason);
      failures.push({ reason, review });
    },
  };

  return { jobs, objects, events, stored, completed, failures, readLimits };
}

function makeProcessor(
  result: ImageProcessingResult,
  events: string[],
  verifyInput?: (input: ImageProcessingInput) => void,
): ImageProcessingAdapter {
  return {
    async process(input) {
      events.push('process');
      verifyInput?.(input);
      return result;
    },
  };
}

describe('Cloudflare durable image processing runner', () => {
  it('runs and publishes outputs for a matching Cloudflare recipe claim', async () => {
    const fixture = await makeFixture(CLOUDFLARE_RECIPE);
    const harness = makeHarness(fixture);

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor: makeProcessor(fixture.result, harness.events),
      }),
    ).resolves.toEqual({ status: 'succeeded' });

    expect(harness.readLimits[0]).toEqual({
      key: fixture.claim.sourceKey,
      maxBytes: fixture.claim.expected.bytes,
    });
    expect(harness.completed).toHaveLength(1);
    expect(harness.completed[0]).toHaveLength(2);
    expect(harness.stored.get('derived/photo/version/thumbnail.jpg')).toEqual(
      fixture.thumbnail.bytes,
    );
    expect(harness.stored.get('derived/photo/version/preview.jpg')).toEqual(
      fixture.preview.bytes,
    );
    expect(harness.failures).toEqual([]);
  });

  it('rejects Sharp output for a Cloudflare recipe before publishing either output', async () => {
    const fixture = await makeFixture(CLOUDFLARE_RECIPE);
    const harness = makeHarness(fixture);
    const sharpResult: ImageProcessingResult = {
      ...fixture.result,
      processorVersion: LOCAL_RECIPE,
    };

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor: makeProcessor(sharpResult, harness.events),
      }),
    ).resolves.toEqual({ status: 'needs_review' });

    expect(harness.events).toContain('read:' + fixture.claim.sourceKey);
    expect(harness.events).not.toContain(
      'put:derived/photo/version/thumbnail.jpg',
    );
    expect(harness.events).not.toContain(
      'put:derived/photo/version/preview.jpg',
    );
    expect(harness.completed).toEqual([]);
    expect(harness.failures).toEqual([
      { reason: 'PROCESSING_CONTENT_INVALID', review: true },
    ]);
  });

  it('fails closed on an unsupported recipe before reading the object', async () => {
    const fixture = await makeFixture('future-unknown-recipe');
    const harness = makeHarness(fixture);

    expect(isProcessingRecipe(fixture.claim.processorVersion)).toBe(false);
    expect(() => processingSourceLimit(fixture.claim.processorVersion)).toThrow(
      'PROCESSING_RECIPE_UNSUPPORTED',
    );

    await expect(
      runImageProcessingJob({
        jobId: fixture.claim.jobId,
        jobs: harness.jobs,
        objects: harness.objects,
        processor: makeProcessor(fixture.result, harness.events),
      }),
    ).resolves.toEqual({ status: 'needs_review' });

    expect(harness.readLimits).toEqual([]);
    expect(harness.events).not.toContain('process');
    expect(harness.events.some((event) => event.startsWith('put:'))).toBe(
      false,
    );
    expect(harness.failures).toEqual([
      { reason: 'PROCESSING_CONTENT_INVALID', review: true },
    ]);
  });

  it('rejects Cloudflare sources above 16 MiB before read while retaining the 64 MiB Sharp capacity', async () => {
    const cloudflare = await makeFixture(CLOUDFLARE_RECIPE);
    const cloudflareOversized: Fixture = {
      ...cloudflare,
      claim: {
        ...cloudflare.claim,
        expected: {
          ...cloudflare.claim.expected,
          bytes: processingSourceLimit(CLOUDFLARE_RECIPE) + 1,
        },
      },
    };
    const cloudflareHarness = makeHarness(cloudflareOversized);

    await expect(
      runImageProcessingJob({
        jobId: cloudflareOversized.claim.jobId,
        jobs: cloudflareHarness.jobs,
        objects: cloudflareHarness.objects,
        processor: makeProcessor(cloudflare.result, cloudflareHarness.events),
      }),
    ).resolves.toEqual({ status: 'needs_review' });

    expect(cloudflareHarness.readLimits).toEqual([]);
    expect(cloudflareHarness.events).not.toContain('process');
    expect(cloudflareHarness.failures).toEqual([
      { reason: 'PROCESSING_CONTENT_INVALID', review: true },
    ]);

    const legacyLimit = processingSourceLimit(LOCAL_RECIPE);
    expect(legacyLimit).toBe(64 * 1024 * 1024);
    expect(processingSourceLimit(CLOUDFLARE_RECIPE)).toBe(16 * 1024 * 1024);

    const largeSource = new Uint8Array(
      processingSourceLimit(CLOUDFLARE_RECIPE) + 1,
    );
    largeSource.set(cloudflare.source);
    const expected = {
      ...cloudflare.claim.expected,
      bytes: largeSource.byteLength,
      sha256: await sha256Hex(largeSource),
    };
    const legacy: Fixture = {
      ...cloudflare,
      claim: {
        ...cloudflare.claim,
        processorVersion: LOCAL_RECIPE,
        expected,
      },
      source: largeSource,
      result: {
        ...cloudflare.result,
        processorVersion: LOCAL_RECIPE,
        source: expected,
      },
    };
    const legacyHarness = makeHarness(legacy);

    await expect(
      runImageProcessingJob({
        jobId: legacy.claim.jobId,
        jobs: legacyHarness.jobs,
        objects: legacyHarness.objects,
        processor: makeProcessor(
          legacy.result,
          legacyHarness.events,
          (input) => {
            expect(input.sourceBytes.byteLength).toBe(largeSource.byteLength);
          },
        ),
      }),
    ).resolves.toEqual({ status: 'succeeded' });

    expect(legacyHarness.readLimits[0]).toEqual({
      key: legacy.claim.sourceKey,
      maxBytes: largeSource.byteLength,
    });
    expect(legacyHarness.completed).toHaveLength(1);
    expect(legacyHarness.failures).toEqual([]);
  });
});
