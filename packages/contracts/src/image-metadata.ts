/**
 * Bounded image-header inspection for upload validation.
 *
 * This reads only container/frame headers and does not decode pixels. It is
 * not a full image decoder or a security guarantee; callers should still use
 * a trusted decoder before processing or displaying uploaded image data.
 */

export const MAX_IMAGE_HEADER_BYTES = 262144;
export const MAX_IMAGE_PIXELS = 80000000;
export const MAX_IMAGE_DIMENSION = 32768;

export type ImageDimensions = { width: number; height: number };
export type ImageHeaderErrorCode =
  'IMAGE_HEADER_INVALID' | 'IMAGE_HEADER_LIMIT' | 'IMAGE_DIMENSIONS_EXCEEDED';

class ImageHeaderError extends Error {
  readonly code: ImageHeaderErrorCode;

  constructor(code: ImageHeaderErrorCode) {
    super(code);
    this.name = 'ImageHeaderError';
    this.code = code;
  }
}

function fail(code: ImageHeaderErrorCode): never {
  throw new ImageHeaderError(code);
}

function invalid(): never {
  return fail('IMAGE_HEADER_INVALID');
}

function headerLimit(): never {
  return fail('IMAGE_HEADER_LIMIT');
}

function ensurePrefixAvailable(
  bytes: Uint8Array,
  requiredEnd: number,
  totalBytes: number | undefined,
): void {
  if (totalBytes !== undefined && requiredEnd > totalBytes) invalid();
  if (requiredEnd > MAX_IMAGE_HEADER_BYTES) headerLimit();
  if (requiredEnd > bytes.length) {
    if (
      totalBytes !== undefined
        ? totalBytes > bytes.length
        : bytes.length === MAX_IMAGE_HEADER_BYTES
    ) {
      headerLimit();
    }
    invalid();
  }
}

function validateDimensions(width: number, height: number): ImageDimensions {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    invalid();
  }

  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    fail('IMAGE_DIMENSIONS_EXCEEDED');
  }

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount)) fail('IMAGE_DIMENSIONS_EXCEEDED');
  if (pixelCount > MAX_IMAGE_PIXELS) fail('IMAGE_DIMENSIONS_EXCEEDED');

  return { width, height };
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x10000 +
    bytes[offset + 3]! * 0x1000000
  );
}

function matchesAscii(
  bytes: Uint8Array,
  offset: number,
  value: string,
): boolean {
  if (offset < 0 || offset + value.length > bytes.length) return false;
  for (let index = 0; index < value.length; index++) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(
  bytes: Uint8Array,
  totalBytes: number | undefined,
): ImageDimensions {
  ensurePrefixAvailable(bytes, 2, totalBytes);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) invalid();

    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    ensurePrefixAvailable(bytes, offset + 1, totalBytes);

    const marker = bytes[offset]!;
    offset++;

    // TEM is the only standalone marker accepted before the first scan.
    if (marker === 0x01) continue;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (marker === 0xd9 || marker === 0xda || marker === 0x00) invalid();

    ensurePrefixAvailable(bytes, offset + 2, totalBytes);
    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength < 2) invalid();

    const segmentEnd = offset + segmentLength;
    if (totalBytes !== undefined && segmentEnd > totalBytes) invalid();
    ensurePrefixAvailable(bytes, segmentEnd, totalBytes);

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) invalid();

      const payloadOffset = offset + 2;
      const height = readUint16BE(bytes, payloadOffset + 1);
      const width = readUint16BE(bytes, payloadOffset + 3);
      const componentCount = bytes[payloadOffset + 5]!;
      if (componentCount === 0 || segmentLength !== 8 + componentCount * 3) {
        invalid();
      }

      return validateDimensions(width, height);
    }

    offset = segmentEnd;
  }

  if (
    (totalBytes !== undefined && totalBytes > bytes.length) ||
    bytes.length === MAX_IMAGE_HEADER_BYTES
  ) {
    headerLimit();
  }
  invalid();
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc ^= bytes[offset]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isValidPngBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return [1, 2, 4, 8, 16].includes(bitDepth);
    case 2:
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return [1, 2, 4, 8].includes(bitDepth);
    default:
      return false;
  }
}

function parsePng(
  bytes: Uint8Array,
  totalBytes: number | undefined,
): ImageDimensions {
  ensurePrefixAvailable(bytes, 33, totalBytes);

  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index++) {
    if (bytes[index] !== signature[index]) invalid();
  }

  if (readUint32BE(bytes, 8) !== 13 || !matchesAscii(bytes, 12, 'IHDR')) {
    invalid();
  }

  const expectedCrc = readUint32BE(bytes, 29);
  if (crc32(bytes, 12, 29) !== expectedCrc) invalid();

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);
  const bitDepth = bytes[24]!;
  const colorType = bytes[25]!;
  const compressionMethod = bytes[26]!;
  const filterMethod = bytes[27]!;
  const interlaceMethod = bytes[28]!;

  if (
    !isValidPngBitDepth(colorType, bitDepth) ||
    compressionMethod !== 0 ||
    filterMethod !== 0 ||
    (interlaceMethod !== 0 && interlaceMethod !== 1)
  ) {
    invalid();
  }

  return validateDimensions(width, height);
}

function parseWebp(
  bytes: Uint8Array,
  totalBytes: number | undefined,
): ImageDimensions {
  ensurePrefixAvailable(bytes, 12, totalBytes);
  if (!matchesAscii(bytes, 0, 'RIFF') || !matchesAscii(bytes, 8, 'WEBP')) {
    invalid();
  }

  const riffSize = readUint32LE(bytes, 4);
  if (riffSize < 4 || riffSize > 0xfffffff6 || riffSize % 2 !== 0) invalid();

  const riffEnd = riffSize + 8;
  if (totalBytes !== undefined && riffEnd > totalBytes) invalid();

  // WebP's first chunk carries either the canvas dimensions or the still frame.
  ensurePrefixAvailable(bytes, 20, totalBytes);
  const chunkTypeOffset = 12;
  const chunkSize = readUint32LE(bytes, 16);
  const payloadOffset = 20;
  const payloadEnd = payloadOffset + chunkSize;
  const chunkEnd = payloadEnd + (chunkSize % 2);
  if (chunkEnd > riffEnd) invalid();

  if (matchesAscii(bytes, chunkTypeOffset, 'VP8X')) {
    if (chunkSize !== 10) invalid();
    ensurePrefixAvailable(bytes, payloadEnd, totalBytes);

    const flags = bytes[payloadOffset]!;
    if ((flags & 0xc1) !== 0) invalid();
    if (
      bytes[payloadOffset + 1] !== 0 ||
      bytes[payloadOffset + 2] !== 0 ||
      bytes[payloadOffset + 3] !== 0
    ) {
      invalid();
    }

    const width =
      1 +
      bytes[payloadOffset + 4]! +
      bytes[payloadOffset + 5]! * 0x100 +
      bytes[payloadOffset + 6]! * 0x10000;
    const height =
      1 +
      bytes[payloadOffset + 7]! +
      bytes[payloadOffset + 8]! * 0x100 +
      bytes[payloadOffset + 9]! * 0x10000;
    return validateDimensions(width, height);
  }

  if (matchesAscii(bytes, chunkTypeOffset, 'VP8 ')) {
    if (chunkSize < 10) invalid();
    ensurePrefixAvailable(bytes, payloadOffset + 10, totalBytes);

    const frameTag =
      bytes[payloadOffset]! +
      bytes[payloadOffset + 1]! * 0x100 +
      bytes[payloadOffset + 2]! * 0x10000;
    const isKeyFrame = (frameTag & 1) === 0;
    const version = (frameTag >>> 1) & 0x07;
    if (
      !isKeyFrame ||
      version > 3 ||
      bytes[payloadOffset + 3] !== 0x9d ||
      bytes[payloadOffset + 4] !== 0x01 ||
      bytes[payloadOffset + 5] !== 0x2a
    ) {
      invalid();
    }

    const width = readUint16LEMasked(bytes, payloadOffset + 6);
    const height = readUint16LEMasked(bytes, payloadOffset + 8);
    return validateDimensions(width, height);
  }

  if (matchesAscii(bytes, chunkTypeOffset, 'VP8L')) {
    if (chunkSize < 5) invalid();
    ensurePrefixAvailable(bytes, payloadOffset + 5, totalBytes);
    if (bytes[payloadOffset] !== 0x2f) invalid();

    const packedDimensions = readUint32LE(bytes, payloadOffset + 1);
    const width = (packedDimensions & 0x3fff) + 1;
    const height = ((packedDimensions >>> 14) & 0x3fff) + 1;
    const version = packedDimensions >>> 29;
    if (version !== 0) invalid();

    return validateDimensions(width, height);
  }

  invalid();
}

function readUint16LEMasked(bytes: Uint8Array, offset: number): number {
  const value = bytes[offset]! + bytes[offset + 1]! * 0x100;
  return value & 0x3fff;
}

/**
 * Inspects JPEG, PNG, or WebP headers from a bounded prefix and returns its
 * encoded pixel dimensions. `totalBytes`, when provided, is the complete file
 * size and is used to reject impossible container or segment lengths.
 */
export function inspectImageHeader(
  bytes: Uint8Array,
  mime: string,
  totalBytes?: number,
): ImageDimensions {
  if (!(bytes instanceof Uint8Array)) invalid();
  if (bytes.length > MAX_IMAGE_HEADER_BYTES) headerLimit();
  if (bytes.length === 0) invalid();
  if (
    totalBytes !== undefined &&
    (!Number.isSafeInteger(totalBytes) ||
      totalBytes < 0 ||
      totalBytes < bytes.length)
  ) {
    invalid();
  }

  switch (mime) {
    case 'image/jpeg':
      return parseJpeg(bytes, totalBytes);
    case 'image/png':
      return parsePng(bytes, totalBytes);
    case 'image/webp':
      return parseWebp(bytes, totalBytes);
    default:
      invalid();
  }
}
