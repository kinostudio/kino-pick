import {
  captureMetadataSchema,
  type CaptureMetadata,
} from '../../contracts/src/capture-metadata';
import {
  MAX_PHOTOGRAPHER_METADATA_SOURCE_BYTES,
  hasSignature,
  supportedFormatForMime,
} from './photographer-xmp';

export type CaptureMetadataSource = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

type ImageFormat = 'jpeg' | 'png' | 'webp';
type TiffEntry = { offset: number; type: number; count: number };

const MAX_EXIF_BYTES = 64 * 1024;
const MAX_CONTAINER_READS = 2048;
const MAX_CONTAINER_READ_BYTES = 128 * 1024;
const MAX_CONTAINER_CHUNKS = 4096;
const MAX_IFD_ENTRIES = 128;
const MAX_METADATA_TEXT_BYTES = 128;
const emptyMetadata = (): CaptureMetadata =>
  captureMetadataSchema.parse({
    cameraModel: null,
    lensModel: null,
    fNumber: null,
    exposureSeconds: null,
    iso: null,
  });

export class CaptureMetadataError extends Error {
  constructor(
    readonly code:
      'invalid_image' | 'source_too_large' | 'source_mime_mismatch',
  ) {
    super(code);
    this.name = 'CaptureMetadataError';
  }
}

function ascii(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

function parseTiff(payload: Uint8Array): CaptureMetadata {
  if (payload.length >= 6 && ascii(payload.subarray(0, 6)) === 'Exif\0\0')
    payload = payload.subarray(6);
  if (payload.length < 8) return emptyMetadata();

  const littleEndian = payload[0] === 0x49 && payload[1] === 0x49;
  if (!littleEndian && !(payload[0] === 0x4d && payload[1] === 0x4d))
    return emptyMetadata();
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  const hasRange = (offset: number, length: number) =>
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset + length <= payload.byteLength;
  const u16 = (offset: number) =>
    hasRange(offset, 2) ? view.getUint16(offset, littleEndian) : null;
  const u32 = (offset: number) =>
    hasRange(offset, 4) ? view.getUint32(offset, littleEndian) : null;

  if (u16(2) !== 42) return emptyMetadata();

  const directory = (offset: number): Map<number, TiffEntry> | null => {
    const count = u16(offset);
    if (count === null || count > MAX_IFD_ENTRIES) return null;
    if (!hasRange(offset + 2, count * 12 + 4)) return null;
    const entries = new Map<number, TiffEntry>();
    for (let index = 0; index < count; index++) {
      const entryOffset = offset + 2 + index * 12;
      const tag = u16(entryOffset);
      const type = u16(entryOffset + 2);
      const entryCount = u32(entryOffset + 4);
      if (tag === null || type === null || entryCount === null) return null;
      if (!entries.has(tag))
        entries.set(tag, { offset: entryOffset, type, count: entryCount });
    }
    return entries;
  };

  const dataOffset = (
    entry: TiffEntry,
    bytesPerValue: number,
    maxCount: number,
  ) => {
    if (entry.count < 1 || entry.count > maxCount) return null;
    const length = entry.count * bytesPerValue;
    if (!Number.isSafeInteger(length) || !hasRange(entry.offset + 8, 4))
      return null;
    if (length <= 4)
      return hasRange(entry.offset + 8, length) ? entry.offset + 8 : null;
    const offset = u32(entry.offset + 8);
    return offset !== null && hasRange(offset, length) ? offset : null;
  };

  const text = (entry: TiffEntry | undefined): string | null => {
    if (!entry || entry.type !== 2 || entry.count > MAX_METADATA_TEXT_BYTES)
      return null;
    const offset = dataOffset(entry, 1, MAX_METADATA_TEXT_BYTES);
    if (offset === null || !hasRange(offset, entry.count)) return null;
    let value = '';
    for (let index = 0; index < entry.count; index++) {
      const byte = payload[offset + index]!;
      if (byte === 0) break;
      if (byte < 0x20 || byte > 0x7e) return null;
      value += String.fromCharCode(byte);
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const unsigned = (entry: TiffEntry | undefined): number | null => {
    if (!entry || entry.count !== 1 || ![3, 4, 13].includes(entry.type))
      return null;
    const size = entry.type === 3 ? 2 : 4;
    const offset = dataOffset(entry, size, 1);
    if (offset === null) return null;
    return size === 2 ? u16(offset) : u32(offset);
  };

  const rational = (entry: TiffEntry | undefined): number | null => {
    if (!entry || entry.type !== 5 || entry.count !== 1) return null;
    const offset = dataOffset(entry, 8, 1);
    if (offset === null) return null;
    const numerator = u32(offset);
    const denominator = u32(offset + 4);
    if (
      numerator === null ||
      denominator === null ||
      numerator === 0 ||
      denominator === 0
    )
      return null;
    const value = numerator / denominator;
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  const firstIfdOffset = u32(4);
  if (firstIfdOffset === null) return emptyMetadata();
  const firstIfd = directory(firstIfdOffset);
  if (!firstIfd) return emptyMetadata();
  const exifIfdOffset = unsigned(firstIfd.get(0x8769));
  const exifIfd = exifIfdOffset === null ? null : directory(exifIfdOffset);
  const primaryIso = unsigned(exifIfd?.get(0x8827));
  const speedIso = unsigned(exifIfd?.get(0x8833));
  const iso = primaryIso ?? speedIso;

  return captureMetadataSchema.parse({
    cameraModel: text(firstIfd.get(0x0110)),
    lensModel: text(exifIfd?.get(0xa434)),
    fNumber: rational(exifIfd?.get(0x829d)),
    exposureSeconds: rational(exifIfd?.get(0x829a)),
    iso: iso !== null && iso > 0 ? iso : null,
  });
}

export async function extractCaptureMetadata(
  source: CaptureMetadataSource,
  mime: string,
): Promise<CaptureMetadata> {
  const format = supportedFormatForMime(mime) as ImageFormat | null;
  if (!format) throw new CaptureMetadataError('source_mime_mismatch');
  if (!Number.isSafeInteger(source.size) || source.size < 12)
    throw new CaptureMetadataError('invalid_image');
  if (source.size > MAX_PHOTOGRAPHER_METADATA_SOURCE_BYTES)
    throw new CaptureMetadataError('source_too_large');

  let reads = 0;
  let bytesRead = 0;
  const read = async (offset: number, length: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      offset + length > source.size ||
      ++reads > MAX_CONTAINER_READS ||
      (bytesRead += length) > MAX_CONTAINER_READ_BYTES
    )
      throw new CaptureMetadataError('invalid_image');
    const bytes = await source.read(offset, length);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length)
      throw new CaptureMetadataError('invalid_image');
    return bytes;
  };

  if (!hasSignature(await read(0, 12), format))
    throw new CaptureMetadataError('source_mime_mismatch');

  if (format === 'jpeg') {
    let offset = 2;
    for (let markers = 0; offset + 1 < source.size; markers++) {
      if (markers >= MAX_CONTAINER_CHUNKS)
        throw new CaptureMetadataError('invalid_image');
      const prefix = await read(offset, 1);
      if (prefix[0] !== 0xff) throw new CaptureMetadataError('invalid_image');
      let markerOffset = offset + 1;
      let markerByte = (await read(markerOffset, 1))[0]!;
      while (markerByte === 0xff) {
        markerOffset++;
        markerByte = (await read(markerOffset, 1))[0]!;
      }
      offset = markerOffset + 1;
      if (markerByte === 0xda || markerByte === 0xd9) break;
      if (markerByte === 0x01 || (markerByte >= 0xd0 && markerByte <= 0xd7))
        continue;
      if (markerByte === 0 || markerByte === 0xd8)
        throw new CaptureMetadataError('invalid_image');
      const lengthBytes = await read(offset, 2);
      const length = (lengthBytes[0]! << 8) | lengthBytes[1]!;
      if (length < 2 || offset + length > source.size)
        throw new CaptureMetadataError('invalid_image');
      const payloadOffset = offset + 2;
      const payloadLength = length - 2;
      if (markerByte === 0xe1 && payloadLength >= 6) {
        const prefixBytes = await read(payloadOffset, 6);
        if (ascii(prefixBytes) === 'Exif\0\0') {
          const tiffLength = payloadLength - 6;
          if (tiffLength === 0 || tiffLength > MAX_EXIF_BYTES)
            return emptyMetadata();
          return parseTiff(await read(payloadOffset + 6, tiffLength));
        }
      }
      offset += length;
    }
    return emptyMetadata();
  }

  if (format === 'png') {
    let offset = 8;
    for (let chunks = 0; offset + 12 <= source.size; chunks++) {
      if (chunks >= MAX_CONTAINER_CHUNKS)
        throw new CaptureMetadataError('invalid_image');
      const header = await read(offset, 8);
      const length = new DataView(
        header.buffer,
        header.byteOffset,
        header.byteLength,
      ).getUint32(0, false);
      const kind = ascii(header.subarray(4));
      if (offset + 12 + length > source.size)
        throw new CaptureMetadataError('invalid_image');
      if (kind === 'eXIf') {
        if (length === 0 || length > MAX_EXIF_BYTES + 6) return emptyMetadata();
        return parseTiff(await read(offset + 8, length));
      }
      offset += 12 + length;
      if (kind === 'IEND') break;
    }
    return emptyMetadata();
  }

  const riff = await read(0, 12);
  const riffSize = new DataView(
    riff.buffer,
    riff.byteOffset,
    riff.byteLength,
  ).getUint32(4, true);
  if (riffSize + 8 !== source.size)
    throw new CaptureMetadataError('invalid_image');
  let offset = 12;
  for (let chunks = 0; offset + 8 <= source.size; chunks++) {
    if (chunks >= MAX_CONTAINER_CHUNKS)
      throw new CaptureMetadataError('invalid_image');
    const header = await read(offset, 8);
    const kind = ascii(header.subarray(0, 4));
    const length = new DataView(
      header.buffer,
      header.byteOffset + 4,
      4,
    ).getUint32(0, true);
    const nextOffset = offset + 8 + length + (length % 2);
    if (nextOffset > source.size)
      throw new CaptureMetadataError('invalid_image');
    if (kind === 'EXIF') {
      if (length === 0 || length > MAX_EXIF_BYTES + 6) return emptyMetadata();
      return parseTiff(await read(offset + 8, length));
    }
    offset = nextOffset;
  }
  return emptyMetadata();
}
