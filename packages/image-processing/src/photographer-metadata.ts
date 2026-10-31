import sharp, { type Metadata } from 'sharp';
import {
  MAX_PHOTOGRAPHER_METADATA_SOURCE_BYTES,
  MAX_EMBEDDED_XMP_BYTES,
  PhotographerMetadataError,
  supportedFormatForMime,
  hasSignature,
  parsePhotographerXmp,
  invalidPhotographerXmp,
  type PhotographerMetadataResult,
} from './photographer-xmp';
export * from './photographer-xmp';
const MAX_IMAGE_SIDE = 32_768;
const MAX_IMAGE_PIXELS = 80_000_000;

export async function extractPhotographerMetadata(
  sourceBytes: Uint8Array,
  sourceMime: string,
): Promise<PhotographerMetadataResult> {
  if (!(sourceBytes instanceof Uint8Array) || typeof sourceMime !== 'string') {
    throw new PhotographerMetadataError('invalid_input');
  }
  if (sourceBytes.byteLength > MAX_PHOTOGRAPHER_METADATA_SOURCE_BYTES) {
    throw new PhotographerMetadataError('source_too_large');
  }

  const expectedFormat = supportedFormatForMime(sourceMime);
  if (expectedFormat === null) return { status: 'unsupported_format' };

  // Snapshot caller-owned bytes before any asynchronous native parsing.
  const source = Buffer.from(sourceBytes);
  if (!hasSignature(source, expectedFormat)) {
    throw new PhotographerMetadataError('source_mime_mismatch');
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(source, {
      failOn: 'warning',
      limitInputPixels: MAX_IMAGE_PIXELS,
      limitInputChannels: 5,
      sequentialRead: true,
    }).metadata();
  } catch {
    throw new PhotographerMetadataError('invalid_image');
  }

  if (metadata.format !== expectedFormat) {
    throw new PhotographerMetadataError('source_mime_mismatch');
  }
  if (metadata.pages !== undefined && metadata.pages !== 1) {
    throw new PhotographerMetadataError('animated_image');
  }
  const width = metadata.width;
  const height = metadata.height;
  if (
    width === undefined ||
    height === undefined ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new PhotographerMetadataError('invalid_image');
  }
  if (
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new PhotographerMetadataError('source_dimensions_out_of_range');
  }

  const xmpBytes = metadata.xmp;
  const xmpAsString = metadata.xmpAsString;
  if (xmpBytes === undefined && xmpAsString === undefined) {
    return {
      status: 'supported',
      format: expectedFormat,
      packetStatus: 'missing',
      rating: { status: 'missing' },
      label: { status: 'missing' },
    };
  }

  const packetBytes =
    xmpBytes === undefined
      ? Buffer.from(xmpAsString ?? '', 'utf8')
      : Buffer.from(xmpBytes);
  if (packetBytes.byteLength > MAX_EMBEDDED_XMP_BYTES)
    return parsePhotographerXmp(expectedFormat, packetBytes);
  if (xmpAsString !== undefined && xmpBytes !== undefined) {
    try {
      if (
        new TextDecoder('utf-8', { fatal: true }).decode(packetBytes) !==
        xmpAsString
      )
        return invalidPhotographerXmp(expectedFormat);
    } catch {
      return invalidPhotographerXmp(expectedFormat);
    }
  }
  return parsePhotographerXmp(expectedFormat, packetBytes);
}
