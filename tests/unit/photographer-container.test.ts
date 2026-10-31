import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { extractPhotographerContainerMetadata } from '../../packages/image-processing/src/photographer-container';
import { extractPhotographerMetadata } from '../../packages/image-processing/src/photographer-metadata';

const packet =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="4" xmp:Label="Red"/></rdf:RDF></x:xmpmeta>';
const makeSource = (bytes: Uint8Array) => ({
  size: bytes.length,
  read: async (offset: number, length: number) =>
    bytes.slice(offset, offset + length),
});

describe('bounded Worker photographer metadata container reader', () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    it(`matches the existing trusted Sharp extractor for real ${format} container bytes`, async () => {
      const bytes = await sharp({
        create: { width: 8, height: 6, channels: 3, background: '#456' },
      })
        .withXmp(packet)
        .toFormat(format)
        .toBuffer();
      const mime = `image/${format}`;
      const parsed = await extractPhotographerContainerMetadata(
        makeSource(bytes),
        mime,
      );
      expect(parsed).toEqual(await extractPhotographerMetadata(bytes, mime));
      expect(parsed).toMatchObject({
        packetStatus: 'present',
        rating: { status: 'value', value: 4 },
        label: { status: 'value', value: 'red' },
      });
    });
    it(`preserves genuinely missing XMP for ${format}`, async () => {
      const bytes = await sharp({
        create: { width: 8, height: 6, channels: 3, background: '#456' },
      })
        .toFormat(format)
        .toBuffer();
      expect(
        await extractPhotographerContainerMetadata(
          makeSource(bytes),
          `image/${format}`,
        ),
      ).toMatchObject({
        packetStatus: 'missing',
        rating: { status: 'missing' },
        label: { status: 'missing' },
      });
    });
  }
  it('rejects a truncated range instead of silently importing empty fields', async () => {
    const bytes = await sharp({
      create: { width: 8, height: 6, channels: 3, background: '#456' },
    })
      .jpeg()
      .toBuffer();
    await expect(
      extractPhotographerContainerMetadata(
        { size: bytes.length, read: async () => new Uint8Array(1) },
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ code: 'invalid_image' });
  });
  it('rejects mismatched containers and oversized sources before metadata import', async () => {
    const bytes = new Uint8Array(32);
    await expect(
      extractPhotographerContainerMetadata(makeSource(bytes), 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'source_mime_mismatch' });
    await expect(
      extractPhotographerContainerMetadata(
        { size: 64 * 1024 * 1024 + 1, read: async () => bytes },
        'image/jpeg',
      ),
    ).rejects.toMatchObject({ code: 'source_too_large' });
  });
  it('bounds adversarial JPEG marker walks', async () => {
    let reads = 0;
    const source = {
      size: 10000,
      read: async (offset: number, length: number) => {
        reads++;
        const result = new Uint8Array(length).fill(255);
        if (offset === 0) {
          result[0] = 255;
          result[1] = 216;
          result[2] = 255;
        }
        return result;
      },
    };
    await expect(
      extractPhotographerContainerMetadata(source, 'image/jpeg'),
    ).rejects.toMatchObject({ code: 'invalid_image' });
    expect(reads).toBeLessThanOrEqual(256);
  });
});
