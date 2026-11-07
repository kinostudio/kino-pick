import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractCaptureMetadata } from '../../packages/image-processing/src/capture-metadata';
import { readOwnerCaptureMetadata } from '../../apps/worker/src/capture-metadata';
import type { WorkerEnv } from '../../apps/worker/src/config';

const captureServiceMocks = vi.hoisted(() => ({
  bucket: { head: vi.fn(), get: vi.fn() },
  ownerAsset: vi.fn(),
}));

vi.mock('../../apps/worker/src/private-storage', () => ({
  storageBucketForNode: () => captureServiceMocks.bucket,
}));

vi.mock('../../apps/worker/src/gallery', () => ({
  D1GalleryRepository: class {
    asset() {
      return captureServiceMocks.ownerAsset();
    }
  },
}));

const concat = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

function makeTiff(littleEndian = true) {
  const bytes = new Uint8Array(280);
  const view = new DataView(bytes.buffer);
  bytes.set(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, 8, littleEndian);
  view.setUint16(8, 3, littleEndian);

  const writeEntry = (
    offset: number,
    tag: number,
    type: number,
    count: number,
    value: number,
  ) => {
    view.setUint16(offset, tag, littleEndian);
    view.setUint16(offset + 2, type, littleEndian);
    view.setUint32(offset + 4, count, littleEndian);
    if (type === 3 && count === 1)
      view.setUint16(offset + 8, value, littleEndian);
    else view.setUint32(offset + 8, value, littleEndian);
  };

  writeEntry(10, 0x0110, 2, 9, 144);
  writeEntry(22, 0x8769, 4, 1, 52);
  writeEntry(34, 0x8825, 4, 1, 224);
  view.setUint32(46, 0, littleEndian);
  view.setUint16(52, 6, littleEndian);
  writeEntry(54, 0xa434, 2, 14, 156);
  writeEntry(66, 0x829d, 5, 1, 176);
  writeEntry(78, 0x829a, 5, 1, 184);
  writeEntry(90, 0x8827, 3, 1, 200);
  writeEntry(102, 0x927c, 7, 4, 0xdeadbeef);
  writeEntry(114, 0xa431, 2, 11, 192);
  view.setUint32(126, 0, littleEndian);

  bytes.set(new TextEncoder().encode('Nikon Z8\0'), 144);
  bytes.set(new TextEncoder().encode('NIKKOR 24-70\0'), 156);
  view.setUint32(176, 28, littleEndian);
  view.setUint32(180, 10, littleEndian);
  view.setUint32(184, 1, littleEndian);
  view.setUint32(188, 125, littleEndian);
  bytes.set(new TextEncoder().encode('SN-1234567\0'), 192);
  view.setUint16(224, 1, littleEndian);
  writeEntry(226, 0x0002, 5, 3, 248);
  view.setUint32(238, 0, littleEndian);
  view.setUint32(248, 47, littleEndian);
  view.setUint32(252, 1, littleEndian);
  view.setUint32(256, 37, littleEndian);
  view.setUint32(260, 1, littleEndian);
  view.setUint32(264, 12, littleEndian);
  view.setUint32(268, 1, littleEndian);
  return bytes;
}

function jpegWithExif(tiff: Uint8Array) {
  const payload = concat(new TextEncoder().encode('Exif\0\0'), tiff);
  const segmentLength = payload.length + 2;
  return concat(
    new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      segmentLength >> 8,
      segmentLength & 0xff,
    ]),
    payload,
    new Uint8Array([0xff, 0xda, 0, 2]),
  );
}

function pngWithExif(tiff: Uint8Array) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = concat(
    new Uint8Array([
      tiff.length >>> 24,
      tiff.length >>> 16,
      tiff.length >>> 8,
      tiff.length,
      0x65,
      0x58,
      0x49,
      0x66,
    ]),
    tiff,
    new Uint8Array(4),
  );
  return concat(
    signature,
    chunk,
    new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]),
  );
}

function webpWithExif(tiff: Uint8Array) {
  const payload = concat(new TextEncoder().encode('Exif\0\0'), tiff);
  const paddedLength = payload.length + (payload.length % 2);
  const chunk = concat(
    new TextEncoder().encode('EXIF'),
    new Uint8Array([
      payload.length & 0xff,
      (payload.length >>> 8) & 0xff,
      (payload.length >>> 16) & 0xff,
      payload.length >>> 24,
    ]),
    payload,
    paddedLength === payload.length ? new Uint8Array() : new Uint8Array(1),
  );
  const riffSize = 4 + chunk.length;
  return concat(
    new TextEncoder().encode('RIFF'),
    new Uint8Array([
      riffSize & 0xff,
      (riffSize >>> 8) & 0xff,
      (riffSize >>> 16) & 0xff,
      riffSize >>> 24,
    ]),
    new TextEncoder().encode('WEBP'),
    chunk,
  );
}

const makeSource = (bytes: Uint8Array) => ({
  size: bytes.length,
  read: async (offset: number, length: number) =>
    bytes.slice(offset, offset + length),
});

const captureScope = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  project_id: '22222222-2222-4222-8222-222222222222',
  album_id: '33333333-3333-4333-8333-333333333333',
};

const capturePhotoId = '44444444-4444-4444-8444-444444444444';
const captureVersionId = '55555555-5555-4555-8555-555555555555';
const captureOwnerId = '66666666-6666-4666-8666-666666666666';
const captureSessionId = '77777777-7777-4777-8777-777777777777';

function serviceFixture(
  bytes: Uint8Array,
  mime: 'image/jpeg' | 'image/png' | 'image/webp',
  rangeMode: 'honor' | 'ignore' = 'honor',
) {
  const checksum = createHash('sha256').update(bytes).digest();
  const cancelled: ReturnType<typeof vi.fn>[] = [];
  const arrayBuffer = vi.fn(async () => bytes.buffer);
  captureServiceMocks.ownerAsset.mockResolvedValue(captureScope);
  captureServiceMocks.bucket.head.mockResolvedValue({
    etag: 'capture-fixture-etag',
    size: bytes.length,
    checksums: { sha256: checksum },
    httpMetadata: { contentType: mime },
  });
  captureServiceMocks.bucket.get.mockImplementation(async (_key, options) => {
    const range = (options as { range: { offset: number; length: number } })
      .range;
    const chunk =
      rangeMode === 'honor'
        ? bytes.slice(range.offset, range.offset + range.length)
        : bytes;
    const cancel = vi.fn();
    cancelled.push(cancel);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        cancel();
      },
    });
    return {
      etag: 'capture-fixture-etag',
      size: bytes.length,
      range: rangeMode === 'honor' ? range : undefined,
      body,
      arrayBuffer,
    };
  });
  const sourceRow = {
    object_key: 'private/originals/capture-fixture.jpg',
    storage_node_id: 'primary',
    byte_size: bytes.length,
    mime,
    checksum_sha256: checksum.toString('hex'),
    ...captureScope,
  };
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => sourceRow }),
      }),
    },
  } as unknown as WorkerEnv;
  return { env, cancelled, arrayBuffer };
}

beforeEach(() => {
  captureServiceMocks.bucket.head.mockReset();
  captureServiceMocks.bucket.get.mockReset();
  captureServiceMocks.ownerAsset.mockReset();
});

describe('bounded capture metadata extraction', () => {
  for (const [format, bytes] of [
    ['jpeg', jpegWithExif(makeTiff())],
    ['png', pngWithExif(makeTiff())],
    ['webp', webpWithExif(makeTiff())],
    ['big-endian jpeg', jpegWithExif(makeTiff(false))],
  ] as const) {
    it(`reads only camera fields from ${format} EXIF`, async () => {
      const mime = format.endsWith('jpeg') ? 'image/jpeg' : `image/${format}`;
      const metadata = await extractCaptureMetadata(makeSource(bytes), mime);
      expect(metadata).toEqual({
        cameraModel: 'Nikon Z8',
        lensModel: 'NIKKOR 24-70',
        fNumber: 2.8,
        exposureSeconds: 1 / 125,
        iso: 200,
      });
      expect(Object.keys(metadata).sort()).toEqual([
        'cameraModel',
        'exposureSeconds',
        'fNumber',
        'iso',
        'lensModel',
      ]);
      expect(JSON.stringify(metadata)).not.toContain('SN-1234567');
      expect(JSON.stringify(metadata)).not.toContain('deadbeef');
      expect(JSON.stringify(metadata)).not.toContain('47');
    });
  }

  it('returns missing fields without inventing values when EXIF is absent', async () => {
    const jpeg = new Uint8Array(12).fill(0);
    jpeg.set([0xff, 0xd8, 0xff, 0xd9]);
    expect(
      await extractCaptureMetadata(makeSource(jpeg), 'image/jpeg'),
    ).toEqual({
      cameraModel: null,
      lensModel: null,
      fNumber: null,
      exposureSeconds: null,
      iso: null,
    });
  });

  it('rejects a short range response and mismatched MIME signature', async () => {
    const bytes = jpegWithExif(makeTiff());
    await expect(
      extractCaptureMetadata(
        { size: bytes.length, read: async () => new Uint8Array(1) },
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ code: 'invalid_image' });
    await expect(
      extractCaptureMetadata(makeSource(bytes), 'image/png'),
    ).rejects.toMatchObject({ code: 'source_mime_mismatch' });
  });

  it('rejects oversized sources before issuing a range read', async () => {
    let reads = 0;
    await expect(
      extractCaptureMetadata(
        {
          size: 64 * 1024 * 1024 + 1,
          read: async () => {
            reads++;
            return new Uint8Array();
          },
        },
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ code: 'source_too_large' });
    expect(reads).toBe(0);
  });

  it('bounds adversarial JPEG marker walks', async () => {
    let reads = 0;
    const source = {
      size: 10000,
      read: async (offset: number, length: number) => {
        reads++;
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index++) {
          const position = offset + index;
          bytes[index] =
            position === 0
              ? 0xff
              : position === 1
                ? 0xd8
                : position % 2
                  ? 0xd0
                  : 0xff;
        }
        return bytes;
      },
    };
    await expect(
      extractCaptureMetadata(source, 'image/jpeg'),
    ).rejects.toMatchObject({
      code: 'invalid_image',
    });
    expect(reads).toBeLessThanOrEqual(2048);
  });
});

describe('capture metadata storage reads', () => {
  it('withholds extracted metadata when Owner access changes during storage IO', async () => {
    const bytes = jpegWithExif(makeTiff());
    const { env } = serviceFixture(bytes, 'image/jpeg');
    captureServiceMocks.ownerAsset
      .mockResolvedValueOnce(captureScope)
      .mockRejectedValueOnce(new Error('AUTH_REQUIRED'));
    await expect(
      readOwnerCaptureMetadata(
        env,
        captureOwnerId,
        captureSessionId,
        capturePhotoId,
        captureVersionId,
      ),
    ).rejects.toThrow('AUTH_REQUIRED');
    expect(captureServiceMocks.ownerAsset).toHaveBeenCalledTimes(2);
    expect(captureServiceMocks.bucket.get).toHaveBeenCalledTimes(1);
  });

  it('coalesces byte-wise JPEG parsing into one bounded window', async () => {
    const bytes = jpegWithExif(makeTiff());
    const { env, cancelled, arrayBuffer } = serviceFixture(bytes, 'image/jpeg');
    await expect(
      readOwnerCaptureMetadata(
        env,
        captureOwnerId,
        captureSessionId,
        capturePhotoId,
        captureVersionId,
      ),
    ).resolves.toEqual({
      cameraModel: 'Nikon Z8',
      lensModel: 'NIKKOR 24-70',
      fNumber: 2.8,
      exposureSeconds: 1 / 125,
      iso: 200,
    });
    expect(captureServiceMocks.bucket.get).toHaveBeenCalledTimes(1);
    expect(captureServiceMocks.bucket.get).toHaveBeenCalledWith(
      'private/originals/capture-fixture.jpg',
      {
        range: { offset: 0, length: bytes.length },
        onlyIf: { etagMatches: 'capture-fixture-etag' },
      },
    );
    expect(cancelled[0]).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('fails closed on dispersed ranges after eight physical reads', async () => {
    const chunkLength = 64 * 1024;
    const chunkSpan = chunkLength + 12;
    const chunks = 9;
    const bytes = new Uint8Array(8 + chunks * chunkSpan);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < chunks; index++) {
      const offset = 8 + index * chunkSpan;
      view.setUint32(offset, chunkLength, false);
      bytes.set(new TextEncoder().encode('IDAT'), offset + 4);
    }
    const { env, arrayBuffer } = serviceFixture(bytes, 'image/png');
    await expect(
      readOwnerCaptureMetadata(
        env,
        captureOwnerId,
        captureSessionId,
        capturePhotoId,
        captureVersionId,
      ),
    ).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE' });
    const calls = captureServiceMocks.bucket.get.mock.calls as Array<
      [string, { range: { offset: number; length: number } }]
    >;
    expect(calls).toHaveLength(8);
    expect(
      calls.reduce((total, [, options]) => total + options.range.length, 0),
    ).toBe(256 * 1024);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('cancels an oversized response when storage ignores the requested range', async () => {
    const bytes = new Uint8Array(64 * 1024);
    bytes.set([0xff, 0xd8, 0xff, 0xd9]);
    const { env, cancelled, arrayBuffer } = serviceFixture(
      bytes,
      'image/jpeg',
      'ignore',
    );
    await expect(
      readOwnerCaptureMetadata(
        env,
        captureOwnerId,
        captureSessionId,
        capturePhotoId,
        captureVersionId,
      ),
    ).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE' });
    expect(cancelled[0]).toHaveBeenCalledTimes(1);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
