import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_SHARP_PROCESSOR_VERSION,
  LocalImageProcessingError,
  LocalSharpImageProcessor,
  type LocalImageMime,
  type LocalImageProcessingInput,
} from '../../packages/image-processing/src/local-sharp';

const scope = {
  workspaceId: '12e67c3b-2a0b-4df8-a152-b83fcd687839',
  projectId: 'c9798708-00ae-423d-898f-0fdcb60d7034',
  albumId: 'f34e2070-8e54-4d23-b2e9-388ae0b8bc90',
};
const photoId = 'fae98f2d-9dc9-481c-b6da-cf79d089baba';
const versionId = 'adfb60ac-3108-4435-9469-0864c098ec55';

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function makeSource(
  format: 'jpeg' | 'png' | 'webp',
  width: number,
  height: number,
): Promise<Buffer> {
  const encoder = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 28, g: 112, b: 190 },
    },
  });
  if (format === 'jpeg') return encoder.jpeg().toBuffer();
  if (format === 'png') return encoder.png().toBuffer();
  return encoder.webp().toBuffer();
}

function makeInput(
  sourceBytes: Uint8Array,
  mime: LocalImageMime,
  width: number,
  height: number,
): LocalImageProcessingInput {
  return {
    scope: { ...scope },
    photoId,
    versionId,
    sourceBytes,
    expected: {
      mime,
      bytes: sourceBytes.byteLength,
      sha256: hash(sourceBytes),
      width,
      height,
    },
  };
}

async function expectProcessingError(
  run: () => Promise<unknown>,
  code: LocalImageProcessingError['code'],
): Promise<LocalImageProcessingError> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(LocalImageProcessingError);
  if (!(caught instanceof LocalImageProcessingError)) {
    throw new Error('Expected a LocalImageProcessingError');
  }
  expect(caught.code).toBe(code);
  return caught;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function corruptFirstPngIdat(source: Buffer): Buffer {
  const copy = Buffer.from(source);
  let offset = 8;
  while (offset + 12 <= copy.length) {
    const length = copy.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    const isIdat =
      copy.toString('ascii', typeOffset, typeOffset + 4) === 'IDAT';
    if (isIdat && length > 0) {
      copy.fill(0, dataOffset, crcOffset);
      copy.writeUInt32BE(
        crc32(copy.subarray(typeOffset, crcOffset)),
        crcOffset,
      );
      return copy;
    }
    offset = crcOffset + 4;
  }
  throw new Error('PNG fixture did not contain IDAT data');
}

describe('LocalSharpImageProcessor', () => {
  const processor = new LocalSharpImageProcessor();

  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)(
    'accepts a decoded %s source and returns stripped JPEG derivatives',
    async (format, mime) => {
      const source = await makeSource(format, 640, 480);
      const result = await processor.process(makeInput(source, mime, 640, 480));

      expect(result.processorVersion).toBe(LOCAL_SHARP_PROCESSOR_VERSION);
      expect(result.scope).toEqual(scope);
      expect(result.photoId).toBe(photoId);
      expect(result.versionId).toBe(versionId);
      expect(result.source).toEqual({
        mime,
        bytes: source.byteLength,
        sha256: hash(source),
        width: 640,
        height: 480,
      });
      expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
        'thumbnail',
        'preview',
      ]);

      for (const artifact of result.artifacts) {
        expect(artifact.mime).toBe('image/jpeg');
        expect(artifact.bytes.byteLength).toBeGreaterThan(0);
        expect(artifact.bytes.byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
        expect(artifact.sha256).toBe(hash(artifact.bytes));
        const metadata = await sharp(artifact.bytes).metadata();
        expect(metadata.format).toBe('jpeg');
        expect(metadata.width).toBe(artifact.width);
        expect(metadata.height).toBe(artifact.height);
        expect(metadata.exif).toBeUndefined();
        expect(metadata.icc).toBeUndefined();
        expect(metadata.iptc).toBeUndefined();
        expect(metadata.xmp).toBeUndefined();
      }
      expect(result.artifacts[0]).toMatchObject({ width: 320, height: 240 });
      expect(result.artifacts[1]).toMatchObject({ width: 640, height: 480 });
      expect(
        result.artifacts[0].bytes.byteLength +
          result.artifacts[1].bytes.byteLength,
      ).toBeLessThanOrEqual(16 * 1024 * 1024);
    },
  );

  it('validates expected byte count, SHA-256, MIME signature, dimensions, and scoped IDs', async () => {
    const source = await makeSource('jpeg', 48, 32);
    const input = makeInput(source, 'image/jpeg', 48, 32);

    await expectProcessingError(
      () =>
        processor.process({
          ...input,
          expected: { ...input.expected, bytes: input.expected.bytes + 1 },
        }),
      'source_size_mismatch',
    );
    await expectProcessingError(
      () =>
        processor.process({
          ...input,
          expected: { ...input.expected, sha256: '0'.repeat(64) },
        }),
      'source_hash_mismatch',
    );
    await expectProcessingError(
      () =>
        processor.process({
          ...input,
          expected: { ...input.expected, mime: 'image/png' },
        }),
      'source_mime_mismatch',
    );
    await expectProcessingError(
      () =>
        processor.process({
          ...input,
          expected: { ...input.expected, width: 49 },
        }),
      'source_dimensions_mismatch',
    );
    await expectProcessingError(
      () =>
        processor.process({
          ...input,
          scope: { ...scope, albumId: 'not-a-uuid' },
        }),
      'invalid_input',
    );
  });

  it('snapshots caller metadata and source bytes before asynchronous decoding', async () => {
    const source = await makeSource('jpeg', 64, 40);
    const input = makeInput(Buffer.from(source), 'image/jpeg', 64, 40);
    const expectedHash = hash(source);
    const pending = processor.process(input);

    input.scope.albumId = 'b8d394f7-0526-40be-9fe8-b69f28a81818';
    input.photoId = '581e2c82-430c-4b04-a3e1-55e2fb484a08';
    input.versionId = '2262f5b8-c9d3-4558-b845-e59c517d11f1';
    input.expected.mime = 'image/png';
    input.expected.sha256 = '0'.repeat(64);
    input.sourceBytes.fill(0);

    const result = await pending;
    expect(result.scope).toEqual(scope);
    expect(result.photoId).toBe(photoId);
    expect(result.versionId).toBe(versionId);
    expect(result.source.sha256).toBe(expectedHash);
    expect(result.source.mime).toBe('image/jpeg');
  });

  it('rejects extreme declared dimensions before invoking the decoder', async () => {
    const source = await makeSource('png', 16, 8);
    const input = makeInput(source, 'image/png', 16, 8);

    await expectProcessingError(
      () =>
        processor.process({
          ...input,
          expected: { ...input.expected, width: 32_768, height: 32_768 },
        }),
      'source_dimensions_out_of_range',
    );
  });

  it('requires full pixel decoding instead of accepting a metadata-only PNG', async () => {
    const valid = await makeSource('png', 24, 16);
    const metadataOnly = corruptFirstPngIdat(valid);
    await expect(sharp(metadataOnly).metadata()).resolves.toMatchObject({
      width: 24,
      height: 16,
      format: 'png',
    });

    const error = await expectProcessingError(
      () => processor.process(makeInput(metadataOnly, 'image/png', 24, 16)),
      'invalid_image',
    );
    expect(error.message).toBe('Image decoder rejected the source image');
    expect(error.message).not.toMatch(/vips|pngload|libpng/i);
  });

  it('auto-orients EXIF JPEG pixels and strips source metadata', async () => {
    const source = await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 3,
        background: { r: 190, g: 70, b: 40 },
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const result = await processor.process(
      makeInput(source, 'image/jpeg', 40, 20),
    );

    expect(result.source).toMatchObject({ width: 40, height: 20 });
    for (const artifact of result.artifacts) {
      expect(artifact.height).toBe(artifact.width * 2);
      const metadata = await sharp(artifact.bytes).metadata();
      expect(metadata.orientation).toBeUndefined();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
    }
    expect(
      result.artifacts.map(({ width, height }) => ({ width, height })),
    ).toEqual([
      { width: 20, height: 40 },
      { width: 20, height: 40 },
    ]);
  });

  it('rejects animated WebP before deriving a still image', async () => {
    const width = 8;
    const frameHeight = 6;
    const stacked = Buffer.alloc(width * frameHeight * 2 * 4);
    stacked.fill(255, 3, width * frameHeight * 4);
    const animated = await sharp(stacked, {
      raw: {
        width,
        height: frameHeight * 2,
        channels: 4,
        pageHeight: frameHeight,
      },
    })
      .webp({ delay: [80, 80], loop: 0 })
      .toBuffer();
    const metadata = await sharp(animated).metadata();
    expect(metadata.pages).toBeGreaterThan(1);

    await expectProcessingError(
      () =>
        processor.process(
          makeInput(animated, 'image/webp', width, frameHeight),
        ),
      'animated_image',
    );
  });

  it('keeps small images from being upscaled and enforces encoded output bounds', async () => {
    const tiny = await makeSource('webp', 24, 12);
    const tinyResult = await processor.process(
      makeInput(tiny, 'image/webp', 24, 12),
    );
    expect(
      tinyResult.artifacts.map(({ width, height }) => ({ width, height })),
    ).toEqual([
      { width: 24, height: 12 },
      { width: 24, height: 12 },
    ]);

    const width = 2_048;
    const height = 2_048;
    const randomPixels = Buffer.alloc(width * height * 3);
    let seed = 0x12345678;
    for (let index = 0; index < randomPixels.length; index += 1) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      randomPixels[index] = seed >>> 24;
    }
    const noisyPng = await sharp(randomPixels, {
      raw: { width, height, channels: 3 },
    })
      .png()
      .toBuffer();
    const boundedResult = await processor.process(
      makeInput(noisyPng, 'image/png', width, height),
    );

    expect(boundedResult.artifacts[0].width).toBeLessThanOrEqual(320);
    expect(boundedResult.artifacts[0].height).toBeLessThanOrEqual(320);
    expect(boundedResult.artifacts[1].width).toBeLessThanOrEqual(2_048);
    expect(boundedResult.artifacts[1].height).toBeLessThanOrEqual(2_048);
    expect(
      boundedResult.artifacts.every(
        (artifact) => artifact.bytes.byteLength <= 8 * 1024 * 1024,
      ),
    ).toBe(true);
    expect(
      boundedResult.artifacts[0].bytes.byteLength +
        boundedResult.artifacts[1].bytes.byteLength,
    ).toBeLessThanOrEqual(16 * 1024 * 1024);
  });
});
