import type { ImageProcessingInput } from '../../domain/src/index.ts';

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

export function isAnimatedOrMultiImage(
  bytes: Uint8Array,
  mime: ImageProcessingInput['expected']['mime'],
): boolean {
  if (mime === 'image/png') return containsAnimatedPngChunk(bytes);
  if (mime === 'image/webp') return containsAnimatedWebpChunk(bytes);
  return containsMultipleJpegImages(bytes);
}
