import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ZipItem } from '../../packages/contracts/src/delivery-zips';
import { streamZip, zipEntryName } from '../../apps/worker/src/zip-stream';

const uuid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

function item(
  id: number,
  filename: string,
  bytes: Uint8Array,
  mime: ZipItem['mime'] = 'image/jpeg',
  hash = sha256(bytes),
): ZipItem {
  const photoId = uuid(id + 10);
  const versionNo = id;
  return {
    deliveryId: uuid(id),
    photoId,
    versionId: uuid(id + 20),
    versionNo,
    assetId: uuid(id + 30),
    filename,
    byteSize: bytes.byteLength,
    mime,
    sha256: hash,
    entryName: zipEntryName(id - 1, versionNo, photoId, filename, mime),
  };
}

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let error: unknown = null;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
    }
  } catch (caught) {
    error = caught;
  } finally {
    reader.releaseLock();
  }
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, error };
}

function hasSignature(bytes: Uint8Array, signature: number) {
  for (let offset = 0; offset <= bytes.length - 4; offset++) {
    if (
      new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(
        0,
        true,
      ) === signature
    )
      return true;
  }
  return false;
}

function readWithPythonZipfile(bytes: Uint8Array) {
  const script = [
    'import base64, io, json, sys, zipfile',
    'archive = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))',
    'print(json.dumps({"names": archive.namelist(), "contents": [base64.b64encode(archive.read(name)).decode("ascii") for name in archive.namelist()], "badFile": archive.testzip()}))',
  ].join('\n');
  const command = process.platform === 'win32' ? 'python' : 'python3';
  return new Promise<{
    names: string[];
    contents: string[];
    badFile: string | null;
  }>((resolve, reject) => {
    const child = spawn(command, ['-c', script], { stdio: 'pipe' });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    child.stdout.on('data', (chunk: Uint8Array) => output.push(chunk));
    child.stderr.on('data', (chunk: Uint8Array) => errors.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            Buffer.concat(errors).toString('utf8') ||
              `python zipfile exited ${String(code)}`,
          ),
        );
        return;
      }
      try {
        resolve(
          JSON.parse(Buffer.concat(output).toString('utf8')) as {
            names: string[];
            contents: string[];
            badFile: string | null;
          },
        );
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(Buffer.from(bytes));
  });
}

describe('delivery ZIP stream', () => {
  it('makes a Python-readable UTF-8 archive with distinct prefixed names and exact bytes', async () => {
    const firstBytes = new Uint8Array([0, 255, 18, 128, 10, 0, 65]);
    const secondBytes = new TextEncoder().encode('第二張照片\n原始bytes');
    const items = [
      item(1, 'session-a/同名.jpg', firstBytes),
      item(2, 'session-b/同名.png', secondBytes, 'image/png'),
    ];
    const archive = await readStream(
      streamZip(
        items,
        async (current) =>
          streamOf(current === items[0] ? firstBytes : secondBytes),
        async () => undefined,
      ),
    );
    expect(archive.error).toBeNull();

    const parsed = await readWithPythonZipfile(archive.bytes);
    expect(parsed.badFile).toBeNull();
    expect(parsed.names).toEqual(items.map((value) => value.entryName));
    expect(new Set(parsed.names).size).toBe(2);
    expect(
      parsed.contents.map((value) => Buffer.from(value, 'base64')),
    ).toEqual([Buffer.from(firstBytes), Buffer.from(secondBytes)]);
    expect(
      parsed.contents.map((value) => sha256(Buffer.from(value, 'base64'))),
    ).toEqual(items.map((value) => value.sha256));
  });

  it.each([
    ['source size', 'ZIP_SOURCE_SIZE_MISMATCH', 'overflow'],
    ['source SHA-256', 'ZIP_SOURCE_HASH_MISMATCH', 'hash'],
  ] as const)(
    'does not finish the central directory or authorize completion after a %s mismatch',
    async (_label, expectedError, mismatch) => {
      const bytes = new Uint8Array([1, 2, 3]);
      const entry = item(
        3,
        'mismatch.jpg',
        mismatch === 'overflow' ? new Uint8Array([1, 2]) : bytes,
        'image/jpeg',
        mismatch === 'hash' ? '0'.repeat(64) : undefined,
      );
      if (mismatch === 'overflow') entry.byteSize = 2;
      const beforeFinish = vi.fn(async () => undefined);
      const archive = await readStream(
        streamZip([entry], async () => streamOf(bytes), beforeFinish),
      );
      expect(archive.error).toMatchObject({ message: expectedError });
      expect(beforeFinish).not.toHaveBeenCalled();
      expect(hasSignature(archive.bytes, 0x02014b50)).toBe(false);
      expect(hasSignature(archive.bytes, 0x06054b50)).toBe(false);
    },
  );

  it('leaves the archive incomplete when the pre-finish authorization/audit rejects', async () => {
    const bytes = new Uint8Array([11, 12, 13]);
    const beforeFinish = vi.fn(async () => {
      throw new Error('AUDIT_NOT_COMMITTED');
    });
    const archive = await readStream(
      streamZip(
        [item(4, 'pending.jpg', bytes)],
        async () => streamOf(bytes),
        beforeFinish,
      ),
    );
    expect(archive.error).toMatchObject({ message: 'AUDIT_NOT_COMMITTED' });
    expect(beforeFinish).toHaveBeenCalledTimes(1);
    expect(hasSignature(archive.bytes, 0x02014b50)).toBe(false);
    expect(hasSignature(archive.bytes, 0x06054b50)).toBe(false);
  });

  it('cancels the upstream source when a streamed size exceeds the manifest', async () => {
    let cancelled = 0;
    const entry = item(5, 'large.jpg', new Uint8Array([1]));
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
      cancel() {
        cancelled++;
      },
    });
    const archive = await readStream(
      streamZip(
        [entry],
        async () => upstream,
        async () => undefined,
      ),
    );
    expect(archive.error).toMatchObject({
      message: 'ZIP_SOURCE_SIZE_MISMATCH',
    });
    expect(cancelled).toBe(1);
  });

  it('cancels a source whose read is stalled instead of waiting for generator return', async () => {
    let cancelled = 0;
    let sourceController!: ReadableStreamDefaultController<Uint8Array>;
    const beforeFinish = vi.fn(async () => undefined);
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
      cancel() {
        cancelled++;
      },
    });
    const reader = streamZip(
      [item(6, 'stalled.jpg', new Uint8Array([1]))],
      async () => source,
      beforeFinish,
    ).getReader();
    await reader.read();
    await reader.read();
    const pendingRead = reader.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancellation = reader.cancel();
    try {
      await expect.poll(() => cancelled, { timeout: 500 }).toBe(1);
    } finally {
      if (!cancelled) sourceController.close();
    }
    await cancellation;
    expect((await pendingRead).done).toBe(true);
    expect(beforeFinish).not.toHaveBeenCalled();
  });

  it('cancels a source opened after the downstream was cancelled', async () => {
    let releaseOpen!: (source: ReadableStream<Uint8Array>) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const openResult = new Promise<ReadableStream<Uint8Array>>((resolve) => {
      releaseOpen = resolve;
    });
    let cancelled = 0;
    const beforeFinish = vi.fn(async () => undefined);
    const reader = streamZip(
      [item(7, 'opening.jpg', new Uint8Array([1]))],
      async () => {
        signalStarted();
        return openResult;
      },
      beforeFinish,
    ).getReader();
    const pendingRead = reader.read();
    await started;
    const cancellation = reader.cancel();
    releaseOpen(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled++;
        },
      }),
    );
    await cancellation;
    expect(cancelled).toBe(1);
    expect((await pendingRead).done).toBe(true);
    expect(beforeFinish).not.toHaveBeenCalled();
  });

  it('keeps generated entry names path-free and within the UTF-8 byte limit', () => {
    const name = zipEntryName(
      7,
      12,
      uuid(99),
      '../folder\\' + '相'.repeat(120) + '.jpg',
      'image/jpeg',
    );
    expect(name).not.toMatch(/[\\/:\p{Cc}]/u);
    expect(name.startsWith('.')).toBe(false);
    expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(240);
  });
});
