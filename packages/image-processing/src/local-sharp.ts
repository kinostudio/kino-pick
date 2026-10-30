import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { ImageProcessingAdapter } from '../../domain/src/index.ts';

export const LOCAL_SHARP_PROCESSOR_VERSION = 'local-sharp-0.35.5-v1';

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_INPUT_PIXELS = 80_000_000;
const MAX_INPUT_SIDE = 32_768;
const THUMBNAIL_EDGE = 320;
const PREVIEW_EDGE = 2_048;

const acceptedMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);
const uuidSchema = z.uuid();

const localImageProcessingInputSchema = z
  .object({
    scope: z
      .object({
        workspaceId: uuidSchema,
        projectId: uuidSchema,
        albumId: uuidSchema,
      })
      .strict(),
    photoId: uuidSchema,
    versionId: uuidSchema,
    sourceBytes: z.instanceof(Uint8Array),
    expected: z
      .object({
        mime: acceptedMimeSchema,
        bytes: z.number().int().positive().max(MAX_SOURCE_BYTES),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        width: z.number().int().positive().max(MAX_INPUT_SIDE),
        height: z.number().int().positive().max(MAX_INPUT_SIDE),
      })
      .strict(),
  })
  .strict();

export type LocalImageProcessingScope = {
  workspaceId: string;
  projectId: string;
  albumId: string;
};

export type LocalImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type LocalImageProcessingInput = {
  scope: LocalImageProcessingScope;
  photoId: string;
  versionId: string;
  sourceBytes: Uint8Array;
  expected: {
    mime: LocalImageMime;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  };
};

export type LocalImageArtifact = {
  kind: 'thumbnail' | 'preview';
  bytes: Uint8Array;
  mime: 'image/jpeg';
  width: number;
  height: number;
  sha256: string;
};

export type LocalImageProcessingResult = {
  processorVersion: string;
  scope: LocalImageProcessingScope;
  photoId: string;
  versionId: string;
  source: {
    mime: LocalImageMime;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  };
  artifacts: [LocalImageArtifact, LocalImageArtifact];
};

export type LocalImageProcessingErrorCode =
  | 'invalid_input'
  | 'source_too_large'
  | 'source_size_mismatch'
  | 'source_hash_mismatch'
  | 'source_mime_mismatch'
  | 'source_dimensions_mismatch'
  | 'source_dimensions_out_of_range'
  | 'unsupported_format'
  | 'animated_image'
  | 'invalid_image'
  | 'output_too_large'
  | 'output_verification_failed';

export class LocalImageProcessingError extends Error {
  readonly code: LocalImageProcessingErrorCode;

  constructor(code: LocalImageProcessingErrorCode, message: string) {
    super(message);
    this.name = 'LocalImageProcessingError';
    this.code = code;
  }
}

type PixelImage = {
  data: Buffer;
  width: number;
  height: number;
  channels: 3;
};

type EncodedArtifact = {
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
};

const decoderOptions = {
  failOn: 'warning' as const,
  limitInputPixels: MAX_INPUT_PIXELS,
  limitInputChannels: 5,
  sequentialRead: true,
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function mimeForSharpFormat(
  format: string | undefined,
): LocalImageMime | undefined {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

function hasExpectedSignature(
  bytes: Uint8Array,
  mime: LocalImageMime,
): boolean {
  switch (mime) {
    case 'image/jpeg':
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case 'image/webp':
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
  }
}

function chunkType(bytes: Uint8Array, offset: number, value: string): boolean {
  return (
    bytes[offset] === value.charCodeAt(0) &&
    bytes[offset + 1] === value.charCodeAt(1) &&
    bytes[offset + 2] === value.charCodeAt(2) &&
    bytes[offset + 3] === value.charCodeAt(3)
  );
}

function containsAnimatedPngChunk(bytes: Uint8Array): boolean {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0, false);
    const isEnd = chunkType(bytes, offset + 4, 'IEND');
    if (chunkType(bytes, offset + 4, 'acTL')) return true;
    if (length > bytes.length - offset - 12) return false;
    offset += length + 12;
    if (isEnd) return false;
  }
  return false;
}

function containsAnimatedWebpChunk(bytes: Uint8Array): boolean {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset + 4,
      4,
    ).getUint32(0, true);
    if (chunkType(bytes, offset, 'ANIM') || chunkType(bytes, offset, 'ANMF'))
      return true;
    if (
      chunkType(bytes, offset, 'VP8X') &&
      length >= 1 &&
      (bytes[offset + 8]! & 0x02) !== 0
    ) {
      return true;
    }
    if (length > bytes.length - offset - 8) return false;
    offset += 8 + length + (length % 2);
  }
  return false;
}

function containsMultipleJpegImages(bytes: Uint8Array): boolean {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xda || marker === 0xd9)
      return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return false;
    if (
      marker === 0xe2 &&
      length >= 6 &&
      bytes[offset + 2] === 0x4d &&
      bytes[offset + 3] === 0x50 &&
      bytes[offset + 4] === 0x46 &&
      bytes[offset + 5] === 0x00
    ) {
      return true;
    }
    offset += length;
  }
  return false;
}

function isAnimatedOrMultiImage(
  bytes: Uint8Array,
  mime: LocalImageMime,
): boolean {
  if (mime === 'image/png') return containsAnimatedPngChunk(bytes);
  if (mime === 'image/webp') return containsAnimatedWebpChunk(bytes);
  return containsMultipleJpegImages(bytes);
}

function assertDimensionsInRange(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_INPUT_SIDE ||
    height > MAX_INPUT_SIDE ||
    width * height > MAX_INPUT_PIXELS
  ) {
    throw new LocalImageProcessingError(
      'source_dimensions_out_of_range',
      'Image dimensions exceed the supported limits',
    );
  }
}

function parseInput(input: unknown): LocalImageProcessingInput {
  const parsed = localImageProcessingInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new LocalImageProcessingError(
      'invalid_input',
      'Image processing input is invalid',
    );
  }
  return parsed.data;
}

async function readSourceMetadata(source: Buffer) {
  try {
    return await sharp(source, decoderOptions).metadata();
  } catch {
    throw new LocalImageProcessingError(
      'invalid_image',
      'Image decoder rejected the source image',
    );
  }
}

async function decodePixels(source: Buffer): Promise<PixelImage> {
  try {
    const decoded = await sharp(source, decoderOptions)
      .rotate()
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (
      decoded.info.width < 1 ||
      decoded.info.height < 1 ||
      decoded.info.width > MAX_INPUT_SIDE ||
      decoded.info.height > MAX_INPUT_SIDE ||
      decoded.info.width * decoded.info.height > MAX_INPUT_PIXELS ||
      decoded.info.channels !== 3
    ) {
      throw new LocalImageProcessingError(
        'source_dimensions_out_of_range',
        'Decoded image dimensions exceed the supported limits',
      );
    }

    return {
      data: decoded.data,
      width: decoded.info.width,
      height: decoded.info.height,
      channels: 3,
    };
  } catch (error) {
    if (error instanceof LocalImageProcessingError) throw error;
    throw new LocalImageProcessingError(
      'invalid_image',
      'Image decoder rejected the source image',
    );
  }
}

async function encodeArtifact(
  pixels: PixelImage,
  edge: number,
): Promise<EncodedArtifact> {
  let bytes: Buffer;
  try {
    bytes = await sharp(pixels.data, {
      raw: {
        width: pixels.width,
        height: pixels.height,
        channels: pixels.channels,
      },
    })
      .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, chromaSubsampling: '4:2:0' })
      .toBuffer();
  } catch {
    throw new LocalImageProcessingError(
      'invalid_image',
      'Image encoder rejected the decoded pixels',
    );
  }

  if (bytes.length < 1 || bytes.length > MAX_OUTPUT_BYTES) {
    throw new LocalImageProcessingError(
      'output_too_large',
      'Generated image exceeds the output size limit',
    );
  }

  try {
    const metadata = await sharp(bytes, decoderOptions).metadata();
    const verifiedPixels = await sharp(bytes, decoderOptions)
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (
      metadata.format !== 'jpeg' ||
      (metadata.size !== undefined && metadata.size !== bytes.length) ||
      metadata.width !== verifiedPixels.info.width ||
      metadata.height !== verifiedPixels.info.height ||
      metadata.width === undefined ||
      metadata.height === undefined ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width > edge ||
      metadata.height > edge ||
      metadata.orientation !== undefined ||
      metadata.exif !== undefined ||
      metadata.icc !== undefined ||
      metadata.iptc !== undefined ||
      metadata.xmp !== undefined
    ) {
      throw new LocalImageProcessingError(
        'output_verification_failed',
        'Generated image metadata did not pass verification',
      );
    }

    if (metadata.width > pixels.width || metadata.height > pixels.height) {
      throw new LocalImageProcessingError(
        'output_verification_failed',
        'Generated image dimensions did not pass verification',
      );
    }

    return {
      bytes,
      width: metadata.width,
      height: metadata.height,
      sha256: sha256Hex(bytes),
    };
  } catch (error) {
    if (error instanceof LocalImageProcessingError) throw error;
    throw new LocalImageProcessingError(
      'output_verification_failed',
      'Generated image could not be reopened and verified',
    );
  }
}

export class LocalSharpImageProcessor implements ImageProcessingAdapter {
  async process(
    input: LocalImageProcessingInput,
  ): Promise<LocalImageProcessingResult> {
    const validatedInput = parseInput(input);

    if (validatedInput.sourceBytes.byteLength > MAX_SOURCE_BYTES) {
      throw new LocalImageProcessingError(
        'source_too_large',
        'Source image exceeds the input size limit',
      );
    }
    if (
      validatedInput.expected.bytes !== validatedInput.sourceBytes.byteLength
    ) {
      throw new LocalImageProcessingError(
        'source_size_mismatch',
        'Source image size does not match its expected value',
      );
    }

    // Copy once before hashing or parsing so every later check and native decode sees identical bytes.
    const sourceBytes = Buffer.from(validatedInput.sourceBytes);
    const { scope, photoId, versionId, expected } = validatedInput;
    const sourceSha256 = sha256Hex(sourceBytes);
    if (sourceSha256 !== expected.sha256) {
      throw new LocalImageProcessingError(
        'source_hash_mismatch',
        'Source image hash does not match its expected value',
      );
    }

    if (!hasExpectedSignature(sourceBytes, expected.mime)) {
      throw new LocalImageProcessingError(
        'source_mime_mismatch',
        'Source image signature does not match its MIME type',
      );
    }
    if (isAnimatedOrMultiImage(sourceBytes, expected.mime)) {
      throw new LocalImageProcessingError(
        'animated_image',
        'Animated and multi-image sources are not supported',
      );
    }

    // Reject implausible caller dimensions before asking the native decoder to inspect the header.
    assertDimensionsInRange(expected.width, expected.height);

    const metadata = await readSourceMetadata(sourceBytes);
    const actualMime = mimeForSharpFormat(metadata.format);
    if (actualMime === undefined) {
      throw new LocalImageProcessingError(
        'unsupported_format',
        'Source image format is not supported',
      );
    }
    if (actualMime !== expected.mime) {
      throw new LocalImageProcessingError(
        'source_mime_mismatch',
        'Decoded source format does not match its MIME type',
      );
    }

    const sourceWidth = metadata.width;
    const sourceHeight = metadata.height;
    if (sourceWidth === undefined || sourceHeight === undefined) {
      throw new LocalImageProcessingError(
        'invalid_image',
        'Source image dimensions could not be read',
      );
    }
    assertDimensionsInRange(sourceWidth, sourceHeight);
    if (metadata.pages !== undefined && metadata.pages !== 1) {
      throw new LocalImageProcessingError(
        'animated_image',
        'Animated and multi-image sources are not supported',
      );
    }
    if (expected.width !== sourceWidth || expected.height !== sourceHeight) {
      throw new LocalImageProcessingError(
        'source_dimensions_mismatch',
        'Source image dimensions do not match their expected values',
      );
    }

    const pixels = await decodePixels(sourceBytes);
    const [thumbnail, preview] = await Promise.all([
      encodeArtifact(pixels, THUMBNAIL_EDGE),
      encodeArtifact(pixels, PREVIEW_EDGE),
    ]);

    if (
      thumbnail.bytes.length + preview.bytes.length >
      MAX_TOTAL_OUTPUT_BYTES
    ) {
      throw new LocalImageProcessingError(
        'output_too_large',
        'Generated images exceed the combined output size limit',
      );
    }

    return {
      processorVersion: LOCAL_SHARP_PROCESSOR_VERSION,
      scope: { ...scope },
      photoId,
      versionId,
      source: {
        mime: actualMime,
        bytes: sourceBytes.byteLength,
        sha256: sourceSha256,
        width: sourceWidth,
        height: sourceHeight,
      },
      artifacts: [
        {
          kind: 'thumbnail',
          bytes: thumbnail.bytes,
          mime: 'image/jpeg',
          width: thumbnail.width,
          height: thumbnail.height,
          sha256: thumbnail.sha256,
        },
        {
          kind: 'preview',
          bytes: preview.bytes,
          mime: 'image/jpeg',
          width: preview.width,
          height: preview.height,
          sha256: preview.sha256,
        },
      ],
    };
  }
}
