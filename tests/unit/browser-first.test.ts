import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { ImageProcessingInput } from '../../packages/domain/src/index';
import {
  BROWSER_FIRST_PROCESSOR_VERSION,
  BrowserFirstImageProcessor,
} from '../../packages/image-processing/src/browser-first';

const scope = {
  workspaceId: '12e67c3b-2a0b-4df8-a152-b83fcd687839',
  projectId: 'c9798708-00ae-423d-898f-0fdcb60d7034',
  albumId: 'f34e2070-8e54-4d23-b2e9-388ae0b8bc90',
};
const photoId = 'fae98f2d-9dc9-481c-b6da-cf79d089baba';
const versionId = 'adfb60ac-3108-4435-9469-0864c098ec55';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

async function sourceFixture(orientation?: 6): Promise<ImageProcessingInput> {
  let encoder = sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#267a95' },
  });
  if (orientation) encoder = encoder.withMetadata({ orientation });
  const bytes = await encoder.jpeg().toBuffer();
  return {
    scope: { ...scope },
    photoId,
    versionId,
    sourceBytes: bytes,
    expected: {
      mime: 'image/jpeg',
      bytes: bytes.length,
      sha256: digest(bytes),
      width: 1600,
      height: 900,
    },
  };
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#b47437' },
  })
    .jpeg({ quality: 82 })
    .toBuffer();
}

function withUnknownAppMetadata(bytes: Buffer): Buffer {
  const payload = Buffer.from('XMP-private');
  const length = payload.length + 2;
  const segment = Buffer.concat([
    Buffer.from([0xff, 0xe1, length >>> 8, length & 0xff]),
    payload,
  ]);
  return Buffer.concat([bytes.subarray(0, 2), segment, bytes.subarray(2)]);
}

async function derivatives(
  thumbnail: [number, number] = [320, 180],
  preview: [number, number] = [1600, 900],
  addMetadata = false,
) {
  const thumb = await jpeg(...thumbnail);
  const large = await jpeg(...preview);
  return {
    thumbnail: addMetadata ? withUnknownAppMetadata(thumb) : thumb,
    preview: addMetadata ? withUnknownAppMetadata(large) : large,
  };
}

function imagesBinding() {
  const info = vi.fn(async (input: ReadableStream<Uint8Array>) => {
    const bytes = Buffer.from(await new Response(input).arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    return {
      format: 'image/' + metadata.format,
      fileSize: bytes.length,
      width: metadata.width!,
      height: metadata.height!,
    };
  });
  const input = vi.fn((readable: ReadableStream<Uint8Array>) => ({
    transform(options: ImageTransform) {
      return {
        async output() {
          const bytes = Buffer.from(await new Response(readable).arrayBuffer());
          const output = await sharp(bytes)
            .rotate()
            .resize(options.width, options.height, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality: 82, progressive: true })
            .toBuffer();
          return {
            response: () =>
              new Response(output, {
                headers: { 'Content-Type': 'image/jpeg' },
              }),
          };
        },
      };
    },
  }));
  return {
    port: { info, input } as unknown as ImagesBinding,
    info,
    input,
  };
}

describe('Browser-first image adapter', () => {
  it('accepts correctly oriented derivatives and strips unknown APP metadata', async () => {
    const images = imagesBinding();
    const source = await sourceFixture(6);
    const provided = await derivatives([180, 320], [900, 1600], true);
    const result = await new BrowserFirstImageProcessor(
      images.port,
      provided,
    ).process(source);

    expect(result.processorVersion).toBe(BROWSER_FIRST_PROCESSOR_VERSION);
    expect(result.scope).toEqual(source.scope);
    expect(result.photoId).toBe(source.photoId);
    expect(result.versionId).toBe(source.versionId);
    expect(result.source).toEqual(source.expected);
    expect(
      result.artifacts.map(({ kind, width, height }) => [kind, width, height]),
    ).toEqual([
      ['thumbnail', 180, 320],
      ['preview', 900, 1600],
    ]);
    for (const artifact of result.artifacts) {
      expect(artifact.sha256).toBe(digest(artifact.bytes));
      expect(
        Buffer.from(artifact.bytes).includes(Buffer.from('XMP-private')),
      ).toBe(false);
      await expect(
        sharp(artifact.bytes).raw().toBuffer(),
      ).resolves.toBeInstanceOf(Buffer);
    }
    expect(images.info).toHaveBeenCalledTimes(3);
    expect(images.input).not.toHaveBeenCalled();
  });

  it('falls back to Cloudflare when client derivative dimensions are invalid', async () => {
    const images = imagesBinding();
    const source = await sourceFixture();
    const provided = await derivatives([319, 180]);
    const result = await new BrowserFirstImageProcessor(
      images.port,
      provided,
    ).process(source);

    expect(result.processorVersion).toBe(BROWSER_FIRST_PROCESSOR_VERSION);
    expect(
      result.artifacts.map(({ kind, width, height }) => [kind, width, height]),
    ).toEqual([
      ['thumbnail', 320, 180],
      ['preview', 1600, 900],
    ]);
    expect(images.input).toHaveBeenCalledTimes(2);
  });

  it('delegates missing derivatives to Cloudflare under the browser-first profile', async () => {
    const images = imagesBinding();
    const result = await new BrowserFirstImageProcessor(images.port).process(
      await sourceFixture(),
    );

    expect(result.processorVersion).toBe(BROWSER_FIRST_PROCESSOR_VERSION);
    expect(images.input).toHaveBeenCalledTimes(2);
  });

  it('preserves an existing immutable thumbnail during Cloudflare retry', async () => {
    const images = imagesBinding();
    const source = await sourceFixture();
    const backup = await new BrowserFirstImageProcessor(images.port).process(
      source,
    );
    const existingThumbnail = await jpeg(320, 180);
    const existingThumbnailHash = digest(existingThumbnail);
    const backupThumbnail = backup.artifacts.find(
      (artifact) => artifact.kind === 'thumbnail',
    );
    const backupPreview = backup.artifacts.find(
      (artifact) => artifact.kind === 'preview',
    );
    expect(backupThumbnail).toBeDefined();
    expect(backupPreview).toBeDefined();
    expect(existingThumbnailHash).not.toBe(backupThumbnail!.sha256);

    images.input.mockClear();
    const retried = await new BrowserFirstImageProcessor(
      images.port,
      undefined,
      { thumbnail: existingThumbnail },
    ).process(source);

    expect(
      retried.artifacts.find((artifact) => artifact.kind === 'thumbnail')
        ?.sha256,
    ).toBe(existingThumbnailHash);
    expect(
      retried.artifacts.find((artifact) => artifact.kind === 'preview')?.sha256,
    ).toBe(backupPreview!.sha256);
    expect(images.input).toHaveBeenCalledTimes(2);
  });

  it('uses a complete validated existing pair when Cloudflare is unavailable', async () => {
    const images = imagesBinding();
    const source = await sourceFixture();
    const existing = await derivatives();
    images.input.mockImplementation(() => {
      throw new Error('CLOUDFLARE_QUOTA_EXCEEDED');
    });

    const result = await new BrowserFirstImageProcessor(
      images.port,
      undefined,
      existing,
    ).process(source);

    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual([
      'thumbnail',
      'preview',
    ]);
    expect(images.input).not.toHaveBeenCalled();
    expect(images.info).toHaveBeenCalledTimes(3);
  });

  it('rejects an invalid existing immutable pair without Cloudflare replacement', async () => {
    const images = imagesBinding();
    const source = await sourceFixture();
    const existing = await derivatives();
    existing.thumbnail = Buffer.from('invalid-existing-thumbnail');
    images.input.mockImplementation(() => {
      throw new Error('CLOUDFLARE_QUOTA_EXCEEDED');
    });

    await expect(
      new BrowserFirstImageProcessor(images.port, undefined, existing).process(
        source,
      ),
    ).rejects.toMatchObject({ code: 'output_verification_failed' });
    expect(images.input).not.toHaveBeenCalled();
  });

  it('rejects a source hash mismatch without invoking Cloudflare fallback', async () => {
    const images = imagesBinding();
    const source = await sourceFixture();
    const provided = await derivatives();
    await expect(
      new BrowserFirstImageProcessor(images.port, provided).process({
        ...source,
        expected: { ...source.expected, sha256: '0'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'source_hash_mismatch' });

    expect(images.info).not.toHaveBeenCalled();
    expect(images.input).not.toHaveBeenCalled();
  });
});
