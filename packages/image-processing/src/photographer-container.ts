import {
  hasSignature,
  supportedFormatForMime,
  parsePhotographerXmp,
  invalidPhotographerXmp,
  MAX_EMBEDDED_XMP_BYTES,
  MAX_PHOTOGRAPHER_METADATA_SOURCE_BYTES,
  PhotographerMetadataError,
  type PhotographerMetadataResult,
} from './photographer-xmp';

export type PhotographerMetadataSource = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const be32 = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0);
const le32 = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);

/** Container-only metadata scan. No pixel decode, network fetch, or Sharp dependency.
 * The uploaded original's immutable witness and image validation belong to the caller.
 * Payload chunks are skipped by offset; metadata reads are bounded independently of pixels.
 */
export async function extractPhotographerContainerMetadata(
  source: PhotographerMetadataSource,
  mime: string,
): Promise<PhotographerMetadataResult> {
  const format = supportedFormatForMime(mime);
  if (!format) return { status: 'unsupported_format' };
  if (
    !Number.isSafeInteger(source.size) ||
    source.size < 12 ||
    source.size > MAX_PHOTOGRAPHER_METADATA_SOURCE_BYTES
  )
    throw new PhotographerMetadataError('source_too_large');
  let reads = 0,
    bytesRead = 0;
  const read = async (offset: number, length: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      offset + length > source.size ||
      ++reads > 256 ||
      (bytesRead += length) > 2 * MAX_EMBEDDED_XMP_BYTES
    )
      throw new PhotographerMetadataError('invalid_image');
    const bytes = await source.read(offset, length);
    if (bytes.byteLength !== length)
      throw new PhotographerMetadataError('invalid_image');
    return bytes;
  };
  if (!hasSignature(await read(0, 12), format))
    throw new PhotographerMetadataError('source_mime_mismatch');
  let packet: Uint8Array | null = null;
  let invalid = false;
  const accept = (value: Uint8Array) => {
    if (packet !== null) invalid = true;
    else packet = value;
  };
  const acceptCompressed = async (value: Uint8Array) => {
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new Uint8Array(value));
        controller.close();
      },
    }).pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_EMBEDDED_XMP_BYTES) {
          invalid = true;
          await reader.cancel();
          return;
        }
        parts.push(next.value);
      }
      const output = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
      }
      accept(output);
    } catch {
      invalid = true;
    } finally {
      reader.releaseLock();
    }
  };
  if (format === 'jpeg') {
    let offset = 2;
    while (offset < source.size) {
      const marker = await read(offset, 2);
      if (marker[0] !== 255)
        throw new PhotographerMetadataError('invalid_image');
      if (marker[1] === 255) {
        offset++;
        continue;
      }
      if (marker[1] === 0xda || marker[1] === 0xd9) break;
      if (marker[1] === 0x01) {
        offset += 2;
        continue;
      }
      if (
        marker[1] === 0 ||
        marker[1] === 0xd8 ||
        (marker[1]! >= 0xd0 && marker[1]! <= 0xd7)
      )
        throw new PhotographerMetadataError('invalid_image');
      const lengthBytes = await read(offset + 2, 2);
      const length = lengthBytes[0]! * 256 + lengthBytes[1]!;
      if (length < 2 || offset + 2 + length > source.size)
        throw new PhotographerMetadataError('invalid_image');
      if (marker[1] === 0xe1 && length > 2) {
        const payload = await read(offset + 4, length - 2);
        const standard = 'http://ns.adobe.com/xap/1.0/\0';
        const extended = 'http://ns.adobe.com/xmp/extension/\0';
        if (ascii(payload.subarray(0, standard.length)) === standard)
          accept(payload.subarray(standard.length));
        else if (ascii(payload.subarray(0, extended.length)) === extended)
          invalid = true;
      }
      offset += 2 + length;
    }
  } else if (format === 'png') {
    let offset = 8;
    while (offset < source.size) {
      const header = await read(offset, 8);
      const length = be32(header.subarray(0, 4));
      const kind = ascii(header.subarray(4));
      if (offset + 12 + length > source.size)
        throw new PhotographerMetadataError('invalid_image');
      if (kind === 'acTL')
        throw new PhotographerMetadataError('animated_image');
      if (kind === 'iTXt' || kind === 'zTXt') {
        // Read only the keyword before deciding to read an XMP packet.
        const prefix = await read(offset + 8, Math.min(length, 80));
        const end = prefix.indexOf(0);
        if (
          end >= 0 &&
          ascii(prefix.subarray(0, end)) === 'XML:com.adobe.xmp'
        ) {
          if (length > MAX_EMBEDDED_XMP_BYTES) invalid = true;
          else {
            const payload = await read(offset + 8, length);
            if (kind === 'zTXt') {
              if (payload[end + 1] !== 0) invalid = true;
              else await acceptCompressed(payload.subarray(end + 2));
            } else if (
              ![0, 1].includes(payload[end + 1]!) ||
              payload[end + 2] !== 0
            )
              invalid = true;
            else {
              const languageEnd = payload.indexOf(0, end + 3);
              const translatedEnd =
                languageEnd < 0 ? -1 : payload.indexOf(0, languageEnd + 1);
              if (translatedEnd < 0) invalid = true;
              else if (payload[end + 1] === 1)
                await acceptCompressed(payload.subarray(translatedEnd + 1));
              else accept(payload.subarray(translatedEnd + 1));
            }
          }
        }
      }
      offset += 12 + length;
      if (kind === 'IEND') break;
    }
  } else {
    const riff = await read(0, 12);
    if (le32(riff.subarray(4, 8)) + 8 !== source.size)
      throw new PhotographerMetadataError('invalid_image');
    let offset = 12;
    while (offset < source.size) {
      const header = await read(offset, 8);
      const kind = ascii(header.subarray(0, 4));
      const length = le32(header.subarray(4));
      if (offset + 8 + length + (length % 2) > source.size)
        throw new PhotographerMetadataError('invalid_image');
      if (kind === 'ANIM' || kind === 'ANMF')
        throw new PhotographerMetadataError('animated_image');
      if (kind === 'XMP ') {
        if (length > MAX_EMBEDDED_XMP_BYTES) invalid = true;
        else if (length === 0) invalid = true;
        else accept(await read(offset + 8, length));
      }
      offset += 8 + length + (length % 2);
    }
  }
  return invalid
    ? invalidPhotographerXmp(format)
    : parsePhotographerXmp(format, packet);
}
