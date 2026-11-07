import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import type { ZipItem } from '../../../packages/contracts/src/delivery-zips';

const utf8 = new TextEncoder();
function record(size: number, values: [number, number, 2 | 4][]) {
  const bytes = new Uint8Array(size),
    view = new DataView(bytes.buffer);
  for (const [offset, value, width] of values) {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  return bytes;
}
export function zipEntryName(
  index: number,
  version: number,
  photo: string,
  filename: string,
  mime: string,
) {
  const stem =
    filename
      .replace(/\.[^.]*$/u, '')
      .replace(/[\\/:*?"<>|\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, '_')
      .replace(/^\.+|[ .]+$/gu, '') || 'photo';
  let short = '';
  for (const character of stem) {
    if (utf8.encode(short + character).length > 180) break;
    short += character;
  }
  return `${String(index + 1).padStart(3, '0')}-v${version}-${photo.slice(0, 8)}-${short}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
}
/** ZIP STORE preserves original bytes. Only one source chunk and <=24 directory records are retained. */
export function streamZip(
  items: ZipItem[],
  open: (item: ZipItem) => Promise<ReadableStream<Uint8Array>>,
  beforeFinish: () => Promise<void>,
): ReadableStream<Uint8Array> {
  let cancelled = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  async function* chunks() {
    let offset = 0;
    const directory: Uint8Array[] = [];
    for (const item of items) {
      if (cancelled) return;
      const name = utf8.encode(item.entryName),
        start = offset;
      const header = record(30, [
        [0, 0x04034b50, 4],
        [4, 20, 2],
        [6, 0x808, 2],
        [8, 0, 2],
        [12, 33, 2],
        [26, name.length, 2],
      ]);
      const body = await open(item);
      if (cancelled) {
        await body.cancel();
        return;
      }
      const reader = body.getReader();
      activeReader = reader;
      let size = 0,
        crc = 0,
        complete = false;
      const sha = createHash('sha256');
      try {
        yield header;
        yield name;
        offset += header.length + name.length;
        for (;;) {
          const next = await reader.read();
          if (cancelled) return;
          if (next.done) break;
          size += next.value.byteLength;
          if (size > item.byteSize) throw new Error('ZIP_SOURCE_SIZE_MISMATCH');
          crc = crc32(next.value, crc);
          sha.update(next.value);
          offset += next.value.byteLength;
          yield next.value;
        }
        if (size !== item.byteSize || sha.digest('hex') !== item.sha256)
          throw new Error('ZIP_SOURCE_HASH_MISMATCH');
        complete = true;
      } finally {
        if (!complete) await reader.cancel().catch(() => undefined);
        activeReader = null;
        reader.releaseLock();
      }
      const descriptor = record(16, [
        [0, 0x08074b50, 4],
        [4, crc, 4],
        [8, size, 4],
        [12, size, 4],
      ]);
      yield descriptor;
      offset += 16;
      directory.push(
        record(46, [
          [0, 0x02014b50, 4],
          [4, 20, 2],
          [6, 20, 2],
          [8, 0x808, 2],
          [10, 0, 2],
          [14, 33, 2],
          [16, crc, 4],
          [20, size, 4],
          [24, size, 4],
          [28, name.length, 2],
          [42, start, 4],
        ]),
        name,
      );
    }
    // Authorization and generated audit must commit before an archive can be complete.
    if (cancelled) return;
    await beforeFinish();
    if (cancelled) return;
    const centralOffset = offset;
    for (const part of directory) {
      yield part;
      offset += part.length;
    }
    yield record(22, [
      [0, 0x06054b50, 4],
      [8, items.length, 2],
      [10, items.length, 2],
      [12, offset - centralOffset, 4],
      [16, centralOffset, 4],
    ]);
  }
  const iterator = chunks();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (cancelled) return;
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
        await iterator.return(undefined).catch(() => undefined);
      }
    },
    async cancel() {
      cancelled = true;
      // Unblock an in-flight read before the generator can enter its finally.
      await activeReader?.cancel();
      await iterator.return(undefined);
    },
  });
}
