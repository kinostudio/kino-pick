import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  unlink,
  link,
  symlink,
  mkdir,
  readdir,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeLocalImageProcessingResult } from '../../packages/image-processing/src/local-output';
import type { ImageProcessingResult } from '../../packages/domain/src';

const fault = vi.hoisted(() => ({ failNextStagedWrite: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const file = await fs.open(...args);
      if (
        fault.failNextStagedWrite &&
        String(args[0]).includes('.kino-stage-')
      ) {
        fault.failNextStagedWrite = false;
        file.writeFile = async () => {
          await file.write(new Uint8Array([0]), 0, 1, 0);
          throw new Error('SIMULATED_DISK_FULL');
        };
      }
      return file;
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  fault.failNextStagedWrite = false;
  for (const root of roots.splice(0)) {
    if (!root.startsWith(path.join(os.tmpdir(), 'kino-image-output-')))
      throw new Error('UNSAFE_TEST_CLEANUP');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const outputRoot = await mkdtemp(
    path.join(os.tmpdir(), 'kino-image-output-'),
  );
  roots.push(outputRoot);
  const bytes = new Uint8Array([1, 2, 3]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  // Writer tests exercise persistence only; these are deliberately not image fixtures.
  const result: ImageProcessingResult = {
    processorVersion: 'test-writer-v1',
    scope: {
      workspaceId: randomUUID(),
      projectId: randomUUID(),
      albumId: randomUUID(),
    },
    photoId: randomUUID(),
    versionId: randomUUID(),
    source: { mime: 'image/png', bytes: 3, sha256, width: 1, height: 1 },
    artifacts: ['thumbnail', 'preview'].map((kind) => ({
      kind: kind as 'thumbnail' | 'preview',
      bytes,
      mime: 'image/jpeg',
      width: 1,
      height: 1,
      sha256,
    })),
  };
  return { outputRoot, jobId: randomUUID(), result };
}

describe('local processing create-once output (not a storage authorization)', () => {
  it('publishes verified files and an identical manifest on retry', async () => {
    const input = await fixture();
    const first = await writeLocalImageProcessingResult(input);
    const second = await writeLocalImageProcessingResult(input);
    expect(second).toEqual(first);
    const manifest = JSON.parse(
      await readFile(path.join(first.directory, 'manifest.json'), 'utf8'),
    );
    expect(manifest.expected).toEqual(input.result.source);
    expect(
      manifest.artifacts.map((item: { filename: string }) => item.filename),
    ).toEqual(['thumbnail.jpg', 'preview.jpg']);
    expect(await readFile(path.join(first.directory, 'thumbnail.jpg'))).toEqual(
      Buffer.from([1, 2, 3]),
    );
  });
  it('refuses reused job identity or processor without overwriting', async () => {
    const input = await fixture();
    const first = await writeLocalImageProcessingResult(input);
    const before = await readFile(path.join(first.directory, 'manifest.json'));
    await expect(
      writeLocalImageProcessingResult({
        ...input,
        result: { ...input.result, versionId: randomUUID() },
      }),
    ).rejects.toThrow('LOCAL_OUTPUT_CONFLICT');
    await expect(
      writeLocalImageProcessingResult({
        ...input,
        result: { ...input.result, processorVersion: 'other-v1' },
      }),
    ).rejects.toThrow('LOCAL_OUTPUT_CONFLICT');
    expect(await readFile(path.join(first.directory, 'manifest.json'))).toEqual(
      before,
    );
  });
  it('snapshots caller buffers before the first async write', async () => {
    const input = await fixture();
    const pending = writeLocalImageProcessingResult(input);
    input.result.artifacts[0]!.bytes.fill(9);
    input.outputRoot = path.join(input.outputRoot, 'changed');
    const output = await pending;
    expect(
      await readFile(path.join(output.directory, 'thumbnail.jpg')),
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(await readFile(path.join(output.directory, 'preview.jpg'))).toEqual(
      Buffer.from([1, 2, 3]),
    );
  });
  it('keeps an interrupted staged write out of final paths and permits the exact retry', async () => {
    const input = await fixture();
    fault.failNextStagedWrite = true;
    await expect(writeLocalImageProcessingResult(input)).rejects.toThrow(
      'SIMULATED_DISK_FULL',
    );
    const directory = path.join(input.outputRoot, input.jobId);
    expect(await readdir(directory)).toEqual([]);
    const recovered = await writeLocalImageProcessingResult(input);
    expect(recovered.manifest.jobId).toBe(input.jobId);
    expect((await readdir(directory)).sort()).toEqual([
      'intent.json',
      'manifest.json',
      'preview.jpg',
      'thumbnail.jpg',
    ]);
  });
  it('recovers known staging links after publication and ignores unpublished partial staging files', async () => {
    const input = await fixture();
    const directory = path.join(input.outputRoot, input.jobId);
    await mkdir(directory);
    const partialName = `.kino-stage-intent.json-${randomUUID()}`;
    await writeFile(path.join(directory, partialName), 'partial');
    const first = await writeLocalImageProcessingResult(input);
    const stagedLink = path.join(
      directory,
      `.kino-stage-thumbnail.jpg-${randomUUID()}`,
    );
    await link(path.join(directory, 'thumbnail.jpg'), stagedLink);
    await expect(writeLocalImageProcessingResult(input)).resolves.toEqual(
      first,
    );
    await expect(readFile(stagedLink)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await readFile(path.join(directory, partialName), 'utf8')).toBe(
      'partial',
    );
  });
  it('concurrent matching publishers all succeed and leave one immutable output set', async () => {
    const input = await fixture();
    const outputs = await Promise.all(
      Array.from({ length: 12 }, () => writeLocalImageProcessingResult(input)),
    );
    for (const output of outputs) expect(output).toEqual(outputs[0]);
    expect((await readdir(outputs[0]!.directory)).sort()).toEqual([
      'intent.json',
      'manifest.json',
      'preview.jpg',
      'thumbnail.jpg',
    ]);
  });
  it('resumes a matching partial run, and its intent blocks a different source', async () => {
    const input = await fixture();
    const first = await writeLocalImageProcessingResult(input);
    await unlink(path.join(first.directory, 'manifest.json'));
    await unlink(path.join(first.directory, 'preview.jpg'));
    await expect(
      writeLocalImageProcessingResult({
        ...input,
        result: { ...input.result, photoId: randomUUID() },
      }),
    ).rejects.toThrow('LOCAL_OUTPUT_CONFLICT');
    await expect(
      readFile(path.join(first.directory, 'manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(path.join(first.directory, 'preview.jpg')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await writeLocalImageProcessingResult(input)).manifest).toEqual(
      first.manifest,
    );
  });
  it('does not repair or overwrite a corrupted artifact silently', async () => {
    const input = await fixture();
    const first = await writeLocalImageProcessingResult(input);
    await writeFile(
      path.join(first.directory, 'thumbnail.jpg'),
      new Uint8Array([9, 9, 9]),
    );
    await expect(writeLocalImageProcessingResult(input)).rejects.toThrow(
      'LOCAL_OUTPUT_CONFLICT',
    );
    expect(await readFile(path.join(first.directory, 'thumbnail.jpg'))).toEqual(
      Buffer.from([9, 9, 9]),
    );
  });
  it('rejects redirected job directories and hard-linked artifacts', async () => {
    const input = await fixture();
    const redirected = await fixture();
    await symlink(
      redirected.outputRoot,
      path.join(input.outputRoot, input.jobId),
      'junction',
    );
    await expect(writeLocalImageProcessingResult(input)).rejects.toThrow(
      'LOCAL_OUTPUT_CONFLICT',
    );
    await expect(
      readFile(path.join(redirected.outputRoot, 'manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const normal = await fixture();
    const first = await writeLocalImageProcessingResult(normal);
    await unlink(path.join(first.directory, 'thumbnail.jpg'));
    const outsideFile = path.join(normal.outputRoot, 'untouched.bin');
    await writeFile(outsideFile, new Uint8Array([1, 2, 3]));
    await link(outsideFile, path.join(first.directory, 'thumbnail.jpg'));
    await expect(writeLocalImageProcessingResult(normal)).rejects.toThrow(
      'LOCAL_OUTPUT_CONFLICT',
    );
    expect(await readFile(outsideFile)).toEqual(Buffer.from([1, 2, 3]));
  });
  it('rejects unsafe IDs, duplicate kinds, oversized dimensions and wrong hashes before writes', async () => {
    const input = await fixture();
    await expect(
      writeLocalImageProcessingResult({ ...input, jobId: '../escape' }),
    ).rejects.toThrow();
    const thumbnail = input.result.artifacts[0]!;
    for (const artifacts of [
      [thumbnail, thumbnail],
      [{ ...thumbnail, width: 321 }, input.result.artifacts[1]!],
      [{ ...thumbnail, sha256: '0'.repeat(64) }, input.result.artifacts[1]!],
    ]) {
      await expect(
        writeLocalImageProcessingResult({
          ...input,
          result: { ...input.result, artifacts },
        }),
      ).rejects.toThrow();
    }
    await expect(
      readFile(path.join(input.outputRoot, input.jobId, 'manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
