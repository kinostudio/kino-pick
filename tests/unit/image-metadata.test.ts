import { describe, expect, it } from 'vitest';
import {
  inspectImageHeader,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_HEADER_BYTES,
  MAX_IMAGE_PIXELS,
} from '../../packages/contracts/src/image-metadata';

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

// Small Chromium-generated files. Each fixture was decoded with createImageBitmap
// at authoring time and produced the dimensions asserted below.
const JPEG_2_BY_3 = fromBase64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCKABi3X//Z',
);
const PNG_2_BY_3 = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAFElEQVR4AWJ64KDwH4SZGKAAzgAAAAD///iS3awAAAAGSURBVAMAZV0EhSdAYxcAAAAASUVORK5CYII=',
);
const WEBP_EXTENDED_2_BY_3 = fromBase64(
  'UklGRk4AAABXRUJQVlA4WAoAAAAAAAAAAQAAAgAAVlA4IDAAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+6tR//NgVzXPv9/+8Z/uM/3Gf+7gAAAA=',
);

type ErrorCode =
  'IMAGE_HEADER_INVALID' | 'IMAGE_HEADER_LIMIT' | 'IMAGE_DIMENSIONS_EXCEEDED';

function expectErrorCode(run: () => unknown, code: ErrorCode): void {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).toMatchObject({ code, message: code });
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function uint16LE(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function uint32LE(value: number): Uint8Array {
  return Uint8Array.of(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

function uint32BE(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function makeJpegSof(width: number, height: number): Uint8Array {
  const segmentLength = 11;
  return Uint8Array.of(
    0xff,
    0xd8,
    0xff,
    0xc0,
    (segmentLength >>> 8) & 0xff,
    segmentLength & 0xff,
    8,
    (height >>> 8) & 0xff,
    height & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    1,
    1,
    0x11,
    0,
  );
}

function makeWebpChunk(type: string, payload: Uint8Array): Uint8Array {
  const padding = payload.length % 2;
  return concatBytes(
    ascii(type),
    uint32LE(payload.length),
    payload,
    new Uint8Array(padding),
  );
}

function makeWebp(chunk: Uint8Array): Uint8Array {
  const riffBodyLength = 4 + chunk.length;
  return concatBytes(
    ascii('RIFF'),
    uint32LE(riffBodyLength),
    ascii('WEBP'),
    chunk,
  );
}

function makeWebpVp8x(width: number, height: number): Uint8Array {
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  const payload = Uint8Array.of(
    0,
    0,
    0,
    0,
    widthMinusOne & 0xff,
    (widthMinusOne >>> 8) & 0xff,
    (widthMinusOne >>> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >>> 8) & 0xff,
    (heightMinusOne >>> 16) & 0xff,
  );
  return makeWebp(makeWebpChunk('VP8X', payload));
}

function makeWebpVp8(width: number, height: number): Uint8Array {
  const payload = concatBytes(
    Uint8Array.of(0, 0, 0, 0x9d, 0x01, 0x2a),
    uint16LE(width),
    uint16LE(height),
    Uint8Array.of(0, 0),
  );
  return makeWebp(makeWebpChunk('VP8 ', payload));
}

function makeWebpVp8l(width: number, height: number, version = 0): Uint8Array {
  const packed = (width - 1) | ((height - 1) << 14) | (version << 29);
  return makeWebp(
    makeWebpChunk('VP8L', concatBytes(Uint8Array.of(0x2f), uint32LE(packed))),
  );
}

function pngCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc ^= bytes[offset]!;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mutatePngIHDR(offset: number, value: number): Uint8Array {
  const png = PNG_2_BY_3.slice();
  png[offset] = value;
  png.set(uint32BE(pngCrc32(png, 12, 29)), 29);
  return png;
}

describe('bounded image-header inspection', () => {
  it.each([
    ['image/jpeg', JPEG_2_BY_3],
    ['image/png', PNG_2_BY_3],
    ['image/webp', WEBP_EXTENDED_2_BY_3],
  ])('reads real decodable %s fixture dimensions', (mime, bytes) => {
    expect(inspectImageHeader(bytes, mime, bytes.length)).toEqual({
      width: 2,
      height: 3,
    });
  });

  it('reads simple VP8 and VP8L WebP frame headers', () => {
    expect(inspectImageHeader(makeWebpVp8(2, 3), 'image/webp')).toEqual({
      width: 2,
      height: 3,
    });
    expect(inspectImageHeader(makeWebpVp8l(2, 3), 'image/webp')).toEqual({
      width: 2,
      height: 3,
    });
  });

  it('uses dimensions from an early JPEG header in a large-file prefix', () => {
    const prefix = new Uint8Array(MAX_IMAGE_HEADER_BYTES);
    prefix.set(JPEG_2_BY_3);
    expect(
      inspectImageHeader(prefix, 'image/jpeg', MAX_IMAGE_HEADER_BYTES + 4096),
    ).toEqual({ width: 2, height: 3 });
  });

  it('rejects unsupported MIME, MIME mismatch, and short magic prefixes', () => {
    expectErrorCode(
      () => inspectImageHeader(JPEG_2_BY_3, 'image/png'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(PNG_2_BY_3, 'image/webp'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(JPEG_2_BY_3, 'image/gif'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(Uint8Array.of(0xff, 0xd8, 0xff), 'image/jpeg'),
      'IMAGE_HEADER_INVALID',
    );
  });

  it('rejects invalid JPEG segment lengths, truncation, and SOS before SOF', () => {
    expectErrorCode(
      () =>
        inspectImageHeader(
          Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 0),
          'image/jpeg',
        ),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () =>
        inspectImageHeader(
          Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 1),
          'image/jpeg',
        ),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () =>
        inspectImageHeader(
          Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2),
          'image/jpeg',
        ),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(JPEG_2_BY_3.subarray(0, 3), 'image/jpeg'),
      'IMAGE_HEADER_INVALID',
    );

    const impossibleSegment = Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff);
    expectErrorCode(
      () =>
        inspectImageHeader(
          impossibleSegment,
          'image/jpeg',
          impossibleSegment.length,
        ),
      'IMAGE_HEADER_INVALID',
    );
  });

  it('bounds JPEG metadata scanning at MAX_IMAGE_HEADER_BYTES', () => {
    const prefix = new Uint8Array(MAX_IMAGE_HEADER_BYTES);
    prefix.set([0xff, 0xd8]);
    let offset = 2;
    for (let index = 0; index < 4; index++) {
      prefix.set([0xff, 0xe1, 0xff, 0xff], offset);
      offset += 65537;
    }

    expectErrorCode(
      () =>
        inspectImageHeader(prefix, 'image/jpeg', MAX_IMAGE_HEADER_BYTES + 4096),
      'IMAGE_HEADER_LIMIT',
    );
    expectErrorCode(
      () =>
        inspectImageHeader(
          new Uint8Array(MAX_IMAGE_HEADER_BYTES + 1),
          'image/jpeg',
        ),
      'IMAGE_HEADER_LIMIT',
    );
  });

  it('rejects PNG truncation, bad CRC, invalid IHDR values, and invalid type/depth pairs', () => {
    expectErrorCode(
      () => inspectImageHeader(PNG_2_BY_3.subarray(0, 32), 'image/png'),
      'IMAGE_HEADER_INVALID',
    );

    const badCrc = PNG_2_BY_3.slice();
    badCrc[29] = badCrc[29]! ^ 1;
    expectErrorCode(
      () => inspectImageHeader(badCrc, 'image/png'),
      'IMAGE_HEADER_INVALID',
    );

    const wrongType = PNG_2_BY_3.slice();
    wrongType[12] = 0;
    expectErrorCode(
      () => inspectImageHeader(wrongType, 'image/png'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(mutatePngIHDR(19, 0), 'image/png'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(mutatePngIHDR(25, 1), 'image/png'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(mutatePngIHDR(26, 1), 'image/png'),
      'IMAGE_HEADER_INVALID',
    );
  });

  it('rejects WebP RIFF/chunk length mismatches, truncation, and bad frame headers', () => {
    expectErrorCode(
      () =>
        inspectImageHeader(WEBP_EXTENDED_2_BY_3.subarray(0, 19), 'image/webp'),
      'IMAGE_HEADER_INVALID',
    );

    const badRiffLength = WEBP_EXTENDED_2_BY_3.slice();
    badRiffLength.set(uint32LE(badRiffLength.length), 4);
    expectErrorCode(
      () =>
        inspectImageHeader(badRiffLength, 'image/webp', badRiffLength.length),
      'IMAGE_HEADER_INVALID',
    );

    const badVp8xLength = makeWebpVp8x(2, 3);
    badVp8xLength.set(uint32LE(9), 16);
    expectErrorCode(
      () => inspectImageHeader(badVp8xLength, 'image/webp'),
      'IMAGE_HEADER_INVALID',
    );

    const badVp8Sync = makeWebpVp8(2, 3);
    badVp8Sync[23] = 0;
    expectErrorCode(
      () => inspectImageHeader(badVp8Sync, 'image/webp'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(makeWebpVp8l(2, 3, 1), 'image/webp'),
      'IMAGE_HEADER_INVALID',
    );
  });

  it('rejects zero and oversized dimensions and enforces the pixel cap', () => {
    expectErrorCode(
      () => inspectImageHeader(makeJpegSof(2, 0), 'image/jpeg'),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () =>
        inspectImageHeader(
          makeJpegSof(MAX_IMAGE_DIMENSION + 1, 1),
          'image/jpeg',
        ),
      'IMAGE_DIMENSIONS_EXCEEDED',
    );
    expectErrorCode(
      () => inspectImageHeader(makeJpegSof(10000, 8001), 'image/jpeg'),
      'IMAGE_DIMENSIONS_EXCEEDED',
    );
    expectErrorCode(
      () => inspectImageHeader(makeWebpVp8x(10000, 8001), 'image/webp'),
      'IMAGE_DIMENSIONS_EXCEEDED',
    );
    expectErrorCode(
      () => inspectImageHeader(makeWebpVp8l(16384, 16384), 'image/webp'),
      'IMAGE_DIMENSIONS_EXCEEDED',
    );

    expect(MAX_IMAGE_DIMENSION).toBe(32768);
    expect(MAX_IMAGE_PIXELS).toBe(80000000);
    expect(
      inspectImageHeader(makeJpegSof(MAX_IMAGE_DIMENSION, 1), 'image/jpeg'),
    ).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1 });
  });

  it('validates totalBytes and prefix-size arguments', () => {
    expectErrorCode(
      () =>
        inspectImageHeader(JPEG_2_BY_3, 'image/jpeg', JPEG_2_BY_3.length - 1),
      'IMAGE_HEADER_INVALID',
    );
    expectErrorCode(
      () => inspectImageHeader(JPEG_2_BY_3, 'image/jpeg', Number.NaN),
      'IMAGE_HEADER_INVALID',
    );
  });
});
