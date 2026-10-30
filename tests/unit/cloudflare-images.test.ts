import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  CloudflareImagesProcessor,
  CLOUDFLARE_IMAGES_PROCESSOR_VERSION,
} from '../../packages/image-processing/src/cloudflare-images';
import type { ImageProcessingInput } from '../../packages/domain/src/index';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
async function fixture(rotate = false): Promise<ImageProcessingInput> {
  let encoder = sharp({
    create: { width: 1600, height: 900, channels: 3, background: '#267a95' },
  });
  if (rotate) encoder = encoder.withMetadata({ orientation: 6 });
  const bytes = await encoder.jpeg().toBuffer();
  return {
    scope: {
      workspaceId: '12e67c3b-2a0b-4df8-a152-b83fcd687839',
      projectId: 'c9798708-00ae-423d-898f-0fdcb60d7034',
      albumId: 'f34e2070-8e54-4d23-b2e9-388ae0b8bc90',
    },
    photoId: 'fae98f2d-9dc9-481c-b6da-cf79d089baba',
    versionId: 'adfb60ac-3108-4435-9469-0864c098ec55',
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
// Trusted decoder double exercises the adapter contract; never claimed as a Cloudflare runtime test.
function binding(override?: () => Response) {
  const info = vi.fn(async (s: ReadableStream<Uint8Array>) => {
    const bytes = Buffer.from(await new Response(s).arrayBuffer());
    const meta = await sharp(bytes).metadata();
    return {
      format: 'image/' + meta.format,
      fileSize: bytes.length,
      width: meta.width!,
      height: meta.height!,
    };
  });
  const input = vi.fn((s: ReadableStream<Uint8Array>) => ({
    transform(options: ImageTransform) {
      return {
        async output() {
          if (override) return { response: override };
          const source = Buffer.from(await new Response(s).arrayBuffer());
          const image = await sharp(source)
            .rotate()
            .resize(options.width, options.height, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .jpeg({ quality: 82, progressive: true })
            .withExif({ IFD0: { Copyright: 'PRIVATE AUTHOR' } })
            .toBuffer();
          // Place COM after all scan data too, so metadata stripping cannot stop at first SOS.
          const comment = Buffer.from([
            0xff,
            0xfe,
            0,
            9,
            ...Buffer.from('PRIVATE'),
          ]);
          const bytes = Buffer.concat([
            image.subarray(0, -2),
            comment,
            image.subarray(-2),
          ]);
          return {
            response: () =>
              new Response(bytes, {
                headers: { 'Content-Type': 'image/jpeg' },
              }),
          };
        },
      };
    },
  }));
  return {
    info,
    input,
    port: { info, input } as unknown as Pick<ImagesBinding, 'info' | 'input'>,
  };
}
describe('Cloudflare Images adapter boundary', () => {
  it('generates private display-oriented progressive JPEGs with distinct recipe and exact hashes', async () => {
    const b = binding(),
      source = await fixture(true);
    const result = await new CloudflareImagesProcessor(b.port).process(source);
    expect(result.processorVersion).toBe(CLOUDFLARE_IMAGES_PROCESSOR_VERSION);
    expect(result.scope).toEqual(source.scope);
    expect(result.source).toEqual(source.expected);
    expect(result.artifacts.map((a) => [a.kind, a.width, a.height])).toEqual([
      ['thumbnail', 180, 320],
      ['preview', 900, 1600],
    ]);
    for (const artifact of result.artifacts) {
      const metadata = await sharp(artifact.bytes).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
      expect(Buffer.from(artifact.bytes).includes(Buffer.from('PRIVATE'))).toBe(
        false,
      );
      expect(artifact.sha256).toBe(digest(artifact.bytes));
      await expect(
        sharp(artifact.bytes).raw().toBuffer(),
      ).resolves.toBeInstanceOf(Buffer);
    }
  });
  it('snapshots bytes and caller-owned identity before async work', async () => {
    const b = binding(),
      source = await fixture();
    const original = { ...source.scope };
    const promise = new CloudflareImagesProcessor(b.port).process(source);
    source.sourceBytes.fill(0);
    Object.assign(source.scope, { albumId: 'changed' });
    const result = await promise;
    expect(result.scope).toEqual(original);
  });
  it('rejects changed hash and dimensions before a transform', async () => {
    const b = binding(),
      source = await fixture();
    await expect(
      new CloudflareImagesProcessor(b.port).process({
        ...source,
        expected: { ...source.expected, sha256: '0'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'source_hash_mismatch' });
    await expect(
      new CloudflareImagesProcessor(b.port).process({
        ...source,
        expected: { ...source.expected, width: 1200 },
      }),
    ).rejects.toMatchObject({ code: 'source_dimensions_mismatch' });
    expect(b.input).not.toHaveBeenCalled();
  });
  it('rejects animation instead of silently publishing a first frame', async () => {
    const b = binding(),
      source = await fixture();
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const bytes = Buffer.concat([
      png.subarray(0, 33),
      Buffer.from([0, 0, 0, 0, ...Buffer.from('acTL'), 0, 0, 0, 0]),
      png.subarray(33),
    ]);
    await expect(
      new CloudflareImagesProcessor(b.port).process({
        ...source,
        sourceBytes: bytes,
        expected: {
          mime: 'image/png',
          bytes: bytes.length,
          sha256: digest(bytes),
          width: 2,
          height: 2,
        },
      }),
    ).rejects.toMatchObject({ code: 'animated_image' });
    expect(b.info).not.toHaveBeenCalled();
    expect(b.input).not.toHaveBeenCalled();
  });
  it('cancels overflowing output without returning partial artifacts', async () => {
    let canceled = false;
    const b = binding(
      () =>
        new Response(
          new ReadableStream({
            pull(c) {
              c.enqueue(new Uint8Array(1024 * 1024));
            },
            cancel() {
              canceled = true;
            },
          }),
          { headers: { 'Content-Type': 'image/jpeg' } },
        ),
    );
    await expect(
      new CloudflareImagesProcessor(b.port).process(await fixture()),
    ).rejects.toMatchObject({ code: 'output_too_large' });
    expect(canceled).toBe(true);
    expect(b.input).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed and failed output, including a lying length', async () => {
    for (const response of [
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      () => new Response('failed', { status: 503 }),
      () =>
        new Response('abc', {
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '4' },
        }),
    ]) {
      const b = binding(response);
      await expect(
        new CloudflareImagesProcessor(b.port).process(await fixture()),
      ).rejects.toMatchObject({ code: 'output_invalid' });
      expect(b.input).toHaveBeenCalledTimes(1);
    }
  });
  it('does not propagate provider errors or retry a quota failure', async () => {
    const b = binding();
    b.info.mockRejectedValue(new Error('SECRET provider request'));
    const processor = new CloudflareImagesProcessor(b.port);
    await expect(processor.process(await fixture())).rejects.toMatchObject({
      message: 'provider_or_image_rejected',
    });
    expect(b.info).toHaveBeenCalledTimes(1);
    expect(b.input).not.toHaveBeenCalled();
  });
});
