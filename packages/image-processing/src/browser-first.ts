import { z } from 'zod';
import type {
  ImageProcessingAdapter,
  ImageProcessingInput,
  ImageProcessingResult,
  ProcessedImageArtifact,
} from '../../domain/src/index.ts';
import {
  inspectImageHeader,
  MAX_IMAGE_HEADER_BYTES,
} from '../../contracts/src/image-metadata.ts';
import { CloudflareImagesProcessor, privateJpeg } from './cloudflare-images.ts';
import { isAnimatedOrMultiImage } from './image-container.ts';

export const BROWSER_FIRST_PROCESSOR_VERSION = 'browser-first-jpeg-82-v1';
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ARTIFACT_BYTES = 16 * 1024 * 1024;
const dimension = z.number().int().positive().max(32768);
const inputSchema = z
  .object({
    scope: z
      .object({ workspaceId: z.uuid(), projectId: z.uuid(), albumId: z.uuid() })
      .strict(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    sourceBytes: z.instanceof(Uint8Array),
    expected: z
      .object({
        mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        bytes: z.number().int().positive().max(MAX_SOURCE_BYTES),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        width: dimension,
        height: dimension,
      })
      .strict(),
  })
  .strict();

export type BrowserFirstDerivatives = Readonly<{
  thumbnail: Uint8Array;
  preview: Uint8Array;
}>;
type SnapshotInput = Omit<ImageProcessingInput, 'sourceBytes'> & {
  sourceBytes: Uint8Array<ArrayBuffer>;
};
type SnapshotDerivatives = Readonly<{
  thumbnail: Uint8Array<ArrayBuffer>;
  preview: Uint8Array<ArrayBuffer>;
}>;
type ExistingSnapshotDerivatives = {
  -readonly [Kind in keyof SnapshotDerivatives]?: SnapshotDerivatives[Kind];
};

export class BrowserFirstImageProcessingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'BrowserFirstImageProcessingError';
    this.code = code;
  }
}

function fail(code: string): never {
  throw new BrowserFirstImageProcessingError(code);
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function hash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function tiffOrientation(tiff: Uint8Array): number | undefined {
  if (tiff.byteLength < 8) return undefined;
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!littleEndian && !(tiff[0] === 0x4d && tiff[1] === 0x4d))
    return undefined;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  if (view.getUint16(2, littleEndian) !== 42) return undefined;
  const directory = view.getUint32(4, littleEndian);
  if (directory + 2 > tiff.byteLength) return undefined;
  const count = view.getUint16(directory, littleEndian);
  if (count > 128 || directory + 2 + count * 12 > tiff.byteLength)
    return undefined;
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12;
    if (
      view.getUint16(entry, littleEndian) === 0x0112 &&
      view.getUint16(entry + 2, littleEndian) === 3 &&
      view.getUint32(entry + 4, littleEndian) === 1
    ) {
      const orientation = view.getUint16(entry + 8, littleEndian);
      return orientation >= 1 && orientation <= 8 ? orientation : undefined;
    }
  }
  return undefined;
}

function jpegExifOrientation(bytes: Uint8Array): number {
  bytes = bytes.subarray(0, MAX_IMAGE_HEADER_BYTES);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.byteLength && bytes[offset] === 0xff) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (
      marker === 0x01 ||
      (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    if (offset + 2 > bytes.byteLength) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) break;
    const payload = bytes.subarray(offset + 2, offset + length);
    if (
      marker === 0xe1 &&
      payload.length >= 14 &&
      payload[0] === 0x45 &&
      payload[1] === 0x78 &&
      payload[2] === 0x69 &&
      payload[3] === 0x66 &&
      payload[4] === 0 &&
      payload[5] === 0
    ) {
      return tiffOrientation(payload.subarray(6)) ?? 1;
    }
    offset += length;
  }
  return 1;
}

function expectedArtifactSize(
  sourceWidth: number,
  sourceHeight: number,
  edge: number,
) {
  const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
  const sourceShortEdge = Math.min(sourceWidth, sourceHeight);
  const outputLongEdge = Math.min(edge, sourceLongEdge);
  const outputShortEdge = Math.max(
    1,
    Math.round((sourceShortEdge * outputLongEdge) / sourceLongEdge),
  );
  return { outputLongEdge, outputShortEdge };
}

function artifactDimensionsMatch(
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  edge: number,
): boolean {
  const { outputLongEdge, outputShortEdge } = expectedArtifactSize(
    sourceWidth,
    sourceHeight,
    edge,
  );
  const outputLong = Math.max(width, height);
  const outputShort = Math.min(width, height);
  const sourceIsLandscape = sourceWidth > sourceHeight;
  const sourceIsPortrait = sourceHeight > sourceWidth;
  return (
    outputLong === outputLongEdge &&
    Math.abs(outputShort - outputShortEdge) <= 1 &&
    width <= sourceWidth &&
    height <= sourceHeight &&
    (!sourceIsLandscape || width > height) &&
    (!sourceIsPortrait || height > width) &&
    (sourceWidth !== sourceHeight || width === height)
  );
}

/** Browser-first policy version, including its explicit Cloudflare fallback path. */
export class BrowserFirstImageProcessor implements ImageProcessingAdapter {
  private readonly cloudflare: CloudflareImagesProcessor;

  constructor(
    private readonly images: ImagesBinding,
    private readonly derivatives?: BrowserFirstDerivatives,
    private readonly existingDerivatives?: Partial<BrowserFirstDerivatives>,
  ) {
    this.cloudflare = new CloudflareImagesProcessor(images);
  }

  async process(input: ImageProcessingInput): Promise<ImageProcessingResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success || input.sourceBytes.byteLength > MAX_SOURCE_BYTES)
      fail('invalid_input');

    const data = parsed.data!;
    const snapshot: SnapshotInput = {
      scope: { ...data.scope },
      photoId: data.photoId,
      versionId: data.versionId,
      sourceBytes: new Uint8Array(data.sourceBytes),
      expected: { ...data.expected },
    };

    const existing = this.snapshotExistingDerivatives();

    if (existing?.thumbnail && existing.preview) {
      const { sourceWidth, sourceHeight } = await this.validateSource(snapshot);
      return {
        processorVersion: BROWSER_FIRST_PROCESSOR_VERSION,
        scope: snapshot.scope,
        photoId: snapshot.photoId,
        versionId: snapshot.versionId,
        source: snapshot.expected,
        artifacts: await this.validateDerivatives(
          {
            thumbnail: existing.thumbnail,
            preview: existing.preview,
          },
          sourceWidth,
          sourceHeight,
        ),
      };
    }

    if (!this.derivatives && !existing)
      return this.withBrowserProfile(snapshot);

    const rawDerivatives = this.derivatives
      ? [this.derivatives.thumbnail, this.derivatives.preview]
      : [];
    const derivativeBytes = rawDerivatives.map((bytes) =>
      bytes instanceof Uint8Array ? bytes.byteLength : 0,
    );
    const derivativesWithinBudget =
      !!this.derivatives &&
      rawDerivatives.every((bytes) => bytes instanceof Uint8Array) &&
      derivativeBytes.every(
        (size, index) =>
          size > 0 && size <= (index === 0 ? 512 * 1024 : 4 * 1024 * 1024),
      ) &&
      derivativeBytes[0]! + derivativeBytes[1]! <= MAX_TOTAL_ARTIFACT_BYTES;
    const derivatives = derivativesWithinBudget
      ? {
          thumbnail: new Uint8Array(rawDerivatives[0]!),
          preview: new Uint8Array(rawDerivatives[1]!),
        }
      : null;

    const { sourceWidth, sourceHeight } = await this.validateSource(snapshot);
    let result: ImageProcessingResult;
    if (!derivatives) {
      result = await this.withBrowserProfile(snapshot);
    } else {
      try {
        result = {
          processorVersion: BROWSER_FIRST_PROCESSOR_VERSION,
          scope: snapshot.scope,
          photoId: snapshot.photoId,
          versionId: snapshot.versionId,
          source: snapshot.expected,
          artifacts: await this.validateDerivatives(
            derivatives,
            sourceWidth,
            sourceHeight,
          ),
        };
      } catch {
        // Client derivative failures are recoverable through the explicit CF profile fallback.
        result = await this.withBrowserProfile(snapshot);
      }
    }

    if (!existing) return result;
    const artifacts = new Map(
      result.artifacts.map((artifact) => [artifact.kind, artifact.bytes]),
    );
    const thumbnail = existing.thumbnail ?? artifacts.get('thumbnail');
    const preview = existing.preview ?? artifacts.get('preview');
    if (!thumbnail || !preview) fail('output_verification_failed');
    const merged: SnapshotDerivatives = {
      thumbnail: existing.thumbnail ?? new Uint8Array(thumbnail),
      preview: existing.preview ?? new Uint8Array(preview),
    };
    return {
      ...result,
      artifacts: await this.validateDerivatives(
        merged,
        sourceWidth,
        sourceHeight,
      ),
    };
  }

  private snapshotExistingDerivatives():
    ExistingSnapshotDerivatives | undefined {
    if (!this.existingDerivatives) return undefined;
    const snapshot: ExistingSnapshotDerivatives = {};
    for (const kind of ['thumbnail', 'preview'] as const) {
      const bytes = this.existingDerivatives[kind];
      if (bytes !== undefined) {
        if (!(bytes instanceof Uint8Array)) fail('output_verification_failed');
        snapshot[kind] = new Uint8Array(bytes);
      }
    }
    return snapshot;
  }

  private async withBrowserProfile(
    input: ImageProcessingInput,
  ): Promise<ImageProcessingResult> {
    const result = await this.cloudflare.process(input);
    return {
      ...result,
      processorVersion: BROWSER_FIRST_PROCESSOR_VERSION,
    };
  }

  private async validateSource(
    input: SnapshotInput,
  ): Promise<{ sourceWidth: number; sourceHeight: number }> {
    const { sourceBytes, expected } = input;
    if (sourceBytes.byteLength !== expected.bytes) fail('source_size_mismatch');
    if ((await hash(sourceBytes)) !== expected.sha256)
      fail('source_hash_mismatch');

    let header: { width: number; height: number };
    try {
      header = inspectImageHeader(
        sourceBytes.subarray(0, MAX_IMAGE_HEADER_BYTES),
        expected.mime,
        sourceBytes.byteLength,
      );
    } catch {
      fail('source_header_invalid');
    }
    if (header.width !== expected.width || header.height !== expected.height)
      fail('source_dimensions_mismatch');
    if (isAnimatedOrMultiImage(sourceBytes, expected.mime))
      fail('animated_image');

    let info: ImageInfoResponse;
    try {
      info = await this.images.info(stream(sourceBytes));
    } catch {
      fail('source_decode_mismatch');
    }
    const orientation =
      expected.mime === 'image/jpeg' ? jpegExifOrientation(sourceBytes) : 1;
    const displayWidth =
      orientation >= 5 && orientation <= 8 ? header.height : header.width;
    const displayHeight =
      orientation >= 5 && orientation <= 8 ? header.width : header.height;
    const infoMatchesRaw =
      'width' in info &&
      info.width === header.width &&
      info.height === header.height;
    const infoMatchesDisplay =
      'width' in info &&
      info.width === displayWidth &&
      info.height === displayHeight;
    if (
      !('width' in info) ||
      info.format !== expected.mime ||
      info.fileSize !== sourceBytes.byteLength ||
      (!infoMatchesRaw && !infoMatchesDisplay)
    )
      fail('source_decode_mismatch');

    return { sourceWidth: displayWidth, sourceHeight: displayHeight };
  }

  private async validateDerivatives(
    derivatives: SnapshotDerivatives,
    sourceWidth: number,
    sourceHeight: number,
  ): Promise<ProcessedImageArtifact[]> {
    const sizes = [
      derivatives.thumbnail.byteLength,
      derivatives.preview.byteLength,
    ];
    if (
      sizes.some((size) => size < 1 || size > MAX_ARTIFACT_BYTES) ||
      sizes[0]! + sizes[1]! > MAX_TOTAL_ARTIFACT_BYTES
    )
      fail('output_verification_failed');

    const artifacts: ProcessedImageArtifact[] = [];
    for (const [kind, edge, bytes] of [
      ['thumbnail', 320, derivatives.thumbnail],
      ['preview', 2048, derivatives.preview],
    ] as const) {
      let output: Uint8Array<ArrayBuffer>;
      let header: { width: number; height: number };
      try {
        output = privateJpeg(bytes);
        header = inspectImageHeader(
          output.subarray(0, MAX_IMAGE_HEADER_BYTES),
          'image/jpeg',
          output.byteLength,
        );
      } catch {
        fail('output_verification_failed');
      }

      let info: ImageInfoResponse;
      try {
        info = await this.images.info(stream(output));
      } catch {
        fail('output_verification_failed');
      }
      if (
        !('width' in info) ||
        info.format !== 'image/jpeg' ||
        info.fileSize !== output.byteLength ||
        info.width !== header.width ||
        info.height !== header.height ||
        !artifactDimensionsMatch(
          info.width,
          info.height,
          sourceWidth,
          sourceHeight,
          edge,
        )
      )
        fail('output_verification_failed');

      artifacts.push({
        kind,
        bytes: output,
        mime: 'image/jpeg',
        width: info.width,
        height: info.height,
        sha256: await hash(output),
      });
    }
    return artifacts;
  }
}
