import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  extractPhotographerMetadata,
  PhotographerMetadataError,
  type PhotographerImageFormat,
} from '../../packages/image-processing/src/photographer-metadata';

const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/';
const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';

type TestImageFormat = PhotographerImageFormat;

async function makeBaseImage(format: TestImageFormat): Promise<Buffer> {
  const encoder = sharp({
    create: {
      width: 2,
      height: 3,
      channels: 3,
      background: { r: 28, g: 112, b: 190 },
    },
  });
  if (format === 'jpeg') return encoder.jpeg().toBuffer();
  if (format === 'png') return encoder.png().toBuffer();
  return encoder.webp().toBuffer();
}

function concatBytes(...parts: Uint8Array[]): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

function xmpPacket(content: string): string {
  return (
    '<?xpacket begin="\ufeff"?>' +
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    `<rdf:RDF xmlns:rdf="${RDF_NAMESPACE}">${content}</rdf:RDF>` +
    '</x:xmpmeta><?xpacket end="w"?>'
  );
}

function makeJpegWithXmp(source: Buffer, packet: string): Buffer {
  const namespace = Buffer.from(`${XMP_NAMESPACE}\0`, 'ascii');
  const xmp = Buffer.from(packet, 'utf8');
  const payload = concatBytes(namespace, xmp);
  const segmentLength = payload.length + 2;
  if (segmentLength > 0xffff) throw new Error('JPEG XMP fixture exceeds APP1');
  const segment = Buffer.alloc(payload.length + 4);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment.writeUInt16BE(segmentLength, 2);
  payload.copy(segment, 4);
  return concatBytes(source.subarray(0, 2), segment, source.subarray(2));
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

function makePngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(chunk.subarray(4, 8 + data.length)),
    8 + data.length,
  );
  return chunk;
}

function makePngWithXmp(source: Buffer, packet: string): Buffer {
  const data = concatBytes(
    Buffer.from('XML:com.adobe.xmp', 'ascii'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(packet, 'utf8'),
  );
  const chunk = makePngChunk('iTXt', data);
  const result = concatBytes(
    source.subarray(0, 33),
    chunk,
    source.subarray(33),
  );
  return result;
}

function makeWebpChunk(type: string, data: Uint8Array): Buffer {
  const padding = data.length % 2;
  const chunk = Buffer.alloc(8 + data.length + padding);
  chunk.write(type, 0, 4, 'ascii');
  chunk.writeUInt32LE(data.length, 4);
  Buffer.from(data).copy(chunk, 8);
  return chunk;
}

function makeWebpWithXmp(source: Buffer, packet: string): Buffer {
  const extendedHeader = Buffer.alloc(10);
  extendedHeader[0] = 0x04; // VP8X XMP metadata flag.
  extendedHeader.writeUIntLE(1, 4, 3); // Width 2, minus one.
  extendedHeader.writeUIntLE(2, 7, 3); // Height 3, minus one.

  const body = concatBytes(
    Buffer.from('WEBP', 'ascii'),
    makeWebpChunk('VP8X', extendedHeader),
    source.subarray(12),
    makeWebpChunk('XMP ', Buffer.from(packet, 'utf8')),
  );
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  return concatBytes(riff, body);
}

async function makeImageWithXmp(
  format: TestImageFormat,
  packet: string,
): Promise<Buffer> {
  const base = await makeBaseImage(format);
  switch (format) {
    case 'jpeg':
      return makeJpegWithXmp(base, packet);
    case 'png':
      return makePngWithXmp(base, packet);
    case 'webp':
      return makeWebpWithXmp(base, packet);
  }
}

function description(attributes: string, children = ''): string {
  return `<rdf:Description xmlns:xmp="${XMP_NAMESPACE}" ${attributes}>${children}</rdf:Description>`;
}

async function expectCode(
  work: Promise<unknown>,
  code: PhotographerMetadataError['code'],
): Promise<void> {
  await expect(work).rejects.toMatchObject({ code });
}

describe('extractPhotographerMetadata', () => {
  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)(
    'reads only embedded photographer XMP properties from a synthetic %s photo',
    async (format, mime) => {
      const privateMetadata =
        '<dc:creator>Private Photographer</dc:creator>' +
        '<exif:GPSLatitude>25.034</exif:GPSLatitude>' +
        '<exif:GPSLongitude>121.564</exif:GPSLongitude>';
      const packet = xmpPacket(
        `<rdf:Description xmlns:xmp="${XMP_NAMESPACE}" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/" xmp:Rating="4" xmp:Label="Red">${privateMetadata}</rdf:Description>`,
      );
      const source = await makeImageWithXmp(format, packet);
      const before = Buffer.from(source);
      const result = await extractPhotographerMetadata(source, mime);

      expect(result).toMatchObject({
        status: 'supported',
        format,
        packetStatus: 'present',
        rating: {
          status: 'value',
          value: 4,
          evidence: {
            storage: 'embedded-xmp',
            format,
            namespaceUri: XMP_NAMESPACE,
            property: 'xmp:Rating',
            serialization: 'attribute',
          },
        },
        label: {
          status: 'value',
          value: 'red',
          evidence: {
            storage: 'embedded-xmp',
            format,
            namespaceUri: XMP_NAMESPACE,
            property: 'xmp:Label',
            serialization: 'attribute',
          },
        },
      });
      expect(source).toEqual(before);
      const exposed = JSON.stringify(result);
      expect(exposed).not.toContain('GPS');
      expect(exposed).not.toContain('121.564');
      expect(exposed).not.toContain('Private Photographer');
    },
  );

  it.each([
    ['Red', 'red'],
    ['Yellow', 'yellow'],
    ['Green', 'green'],
    ['Blue', 'blue'],
    ['Purple', 'purple'],
  ] as const)(
    'maps only the exact Adobe label spelling %s',
    async (label, color) => {
      const source = await makeImageWithXmp(
        'jpeg',
        xmpPacket(description(`xmp:Label="${label}"`)),
      );
      const result = await extractPhotographerMetadata(source, 'image/jpeg');
      expect(result).toMatchObject({
        status: 'supported',
        label: { status: 'value', value: color },
      });
    },
  );

  it('reads namespaced element properties and XML character references', async () => {
    const packet = xmpPacket(
      `<rdf:Description xmlns:meta="${XMP_NAMESPACE}"><meta:Rating>\n  3&#x20; \n</meta:Rating><meta:Label>Bl&#117;e</meta:Label></rdf:Description>`,
    );
    const source = await makeImageWithXmp('jpeg', packet);
    const result = await extractPhotographerMetadata(source, 'image/jpeg');

    expect(result).toMatchObject({
      status: 'supported',
      packetStatus: 'present',
      rating: {
        status: 'value',
        value: 3,
        evidence: { property: 'xmp:Rating', serialization: 'element' },
      },
      label: {
        status: 'value',
        value: 'blue',
        evidence: { property: 'xmp:Label', serialization: 'element' },
      },
    });
  });

  it('keeps absent values distinct from explicit zero and empty clears', async () => {
    const missingSource = await makeImageWithXmp(
      'jpeg',
      xmpPacket(description('xmp:Label="Green"')),
    );
    const missing = await extractPhotographerMetadata(
      missingSource,
      'image/jpeg',
    );
    expect(missing).toMatchObject({
      status: 'supported',
      packetStatus: 'present',
      rating: { status: 'missing' },
      label: { status: 'value', value: 'green' },
    });

    const clearedSource = await makeImageWithXmp(
      'jpeg',
      xmpPacket(description('xmp:Rating="0" xmp:Label=""')),
    );
    const cleared = await extractPhotographerMetadata(
      clearedSource,
      'image/jpeg',
    );
    expect(cleared).toMatchObject({
      status: 'supported',
      rating: { status: 'cleared', evidence: { property: 'xmp:Rating' } },
      label: { status: 'cleared', evidence: { property: 'xmp:Label' } },
    });
  });

  it('preserves Lightroom rejected and unsupported fractional ratings without coercion', async () => {
    const rejectedSource = await makeImageWithXmp(
      'jpeg',
      xmpPacket(description('xmp:Rating="-1"')),
    );
    const rejected = await extractPhotographerMetadata(
      rejectedSource,
      'image/jpeg',
    );
    expect(rejected).toMatchObject({
      status: 'supported',
      rating: {
        status: 'rejected',
        evidence: { property: 'xmp:Rating' },
      },
    });

    const fractionalSource = await makeImageWithXmp(
      'jpeg',
      xmpPacket(description('xmp:Rating="3.5"')),
    );
    const fractional = await extractPhotographerMetadata(
      fractionalSource,
      'image/jpeg',
    );
    expect(fractional).toMatchObject({
      status: 'supported',
      rating: {
        status: 'unsupported',
        reason: 'non_integer_rating',
      },
    });
  });

  it('marks out-of-range values invalid and unknown label text unrecognized without echoing it', async () => {
    const unknownLabel = 'Client-Confidential-Label';
    const source = await makeImageWithXmp(
      'jpeg',
      xmpPacket(description(`xmp:Rating="6" xmp:Label="${unknownLabel}"`)),
    );
    const result = await extractPhotographerMetadata(source, 'image/jpeg');

    expect(result).toMatchObject({
      status: 'supported',
      rating: { status: 'invalid', reason: 'invalid_value' },
      label: { status: 'unrecognized', evidence: { property: 'xmp:Label' } },
    });
    expect(JSON.stringify(result)).not.toContain(unknownLabel);
  });

  it('marks repeated properties invalid instead of choosing one value', async () => {
    const source = await makeImageWithXmp(
      'jpeg',
      xmpPacket(description('xmp:Rating="2"') + description('xmp:Rating="5"')),
    );
    const result = await extractPhotographerMetadata(source, 'image/jpeg');
    expect(result).toMatchObject({
      status: 'supported',
      rating: {
        status: 'invalid',
        reason: 'duplicate_property',
        evidence: {
          property: 'xmp:Rating',
          serialization: 'multiple',
        },
      },
    });
  });

  it.each([
    [
      'DTD and entity declarations',
      '<!DOCTYPE x:xmpmeta [<!ENTITY rate "5">]>' +
        xmpPacket(description('xmp:Rating="&rate;"')),
    ],
    [
      'duplicate XML attributes',
      xmpPacket(
        `<rdf:Description xmlns:xmp="${XMP_NAMESPACE}" xmp:Rating="2" xmp:Rating="5"/>`,
      ),
    ],
    [
      'conflicting namespace bindings',
      xmpPacket(
        `<rdf:Description xmlns:xmp="${XMP_NAMESPACE}" xmp:Rating="5"><dc:description xmlns:dc="http://purl.org/dc/elements/1.1/"><xmp:Label xmlns:xmp="urn:private:other">Red</xmp:Label></dc:description></rdf:Description>`,
      ),
    ],
    [
      'nested RDF roots',
      xmpPacket(
        `<dc:description xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description xmlns:xmp="${XMP_NAMESPACE}" xmp:Rating="5"/></rdf:RDF></dc:description>`,
      ),
    ],
    [
      'unbound property prefixes',
      xmpPacket('<rdf:Description xmp:Rating="5"/>'),
    ],
    [
      'malformed processing instructions',
      '<??>' + xmpPacket(description('xmp:Rating="5"')),
    ],
    [
      'unknown entity references',
      xmpPacket(
        `<rdf:Description xmlns:xmp="${XMP_NAMESPACE}" xmp:Label="Red&custom;"/>`,
      ),
    ],
  ])('fails closed for %s', async (_name, packet) => {
    const source = await makeImageWithXmp('jpeg', packet);
    const result = await extractPhotographerMetadata(source, 'image/jpeg');
    expect(result).toMatchObject({
      status: 'supported',
      packetStatus: 'invalid',
      rating: { status: 'invalid', reason: 'invalid_packet', evidence: null },
      label: { status: 'invalid', reason: 'invalid_packet', evidence: null },
    });
  });

  it('marks non-scalar XMP property structures invalid', async () => {
    const packet = xmpPacket(
      `<rdf:Description xmlns:xmp="${XMP_NAMESPACE}"><xmp:Rating><rdf:Seq><rdf:li>5</rdf:li></rdf:Seq></xmp:Rating></rdf:Description>`,
    );
    const source = await makeImageWithXmp('jpeg', packet);
    const result = await extractPhotographerMetadata(source, 'image/jpeg');
    expect(result).toMatchObject({
      status: 'supported',
      packetStatus: 'present',
      rating: {
        status: 'invalid',
        reason: 'invalid_structure',
        evidence: { property: 'xmp:Rating', serialization: 'element' },
      },
    });
  });

  it('distinguishes absent embedded XMP and unsupported media formats', async () => {
    const source = await makeBaseImage('jpeg');
    const missing = await extractPhotographerMetadata(source, 'image/jpeg');
    expect(missing).toEqual({
      status: 'supported',
      format: 'jpeg',
      packetStatus: 'missing',
      rating: { status: 'missing' },
      label: { status: 'missing' },
    });

    await expect(makeBaseImage('jpeg')).resolves.toMatchObject({
      length: expect.any(Number),
    });
    const unsupported = await extractPhotographerMetadata(source, 'image/tiff');
    expect(unsupported).toEqual({ status: 'unsupported_format' });
  });

  it('rejects declared MIME mismatches and snapshots the immutable input bytes', async () => {
    const source = await makeImageWithXmp(
      'jpeg',
      xmpPacket(description('xmp:Rating="5"')),
    );
    await expectCode(
      extractPhotographerMetadata(source, 'image/png'),
      'source_mime_mismatch',
    );

    const snapshotInput = Buffer.from(source);
    const pending = extractPhotographerMetadata(snapshotInput, 'image/jpeg');
    snapshotInput.fill(0);
    const result = await pending;
    expect(result).toMatchObject({
      status: 'supported',
      rating: { status: 'value', value: 5 },
    });
  });
});
