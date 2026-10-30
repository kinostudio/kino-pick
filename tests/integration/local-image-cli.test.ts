import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { localImageProcessingManifestSchema } from '../../packages/contracts/src/image-processing';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const cli = path.join(projectRoot, 'packages/image-processing/src/cli.mjs');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(path.join(os.tmpdir(), 'kino-image-cli-')))
      throw new Error('UNSAFE_TEST_CLEANUP');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kino-image-cli-'));
  roots.push(root);
  const source = await sharp({
    create: { width: 48, height: 24, channels: 3, background: '#00aa88' },
  })
    .png()
    .toBuffer();
  const metadata = {
    scope: {
      workspaceId: randomUUID(),
      projectId: randomUUID(),
      albumId: randomUUID(),
    },
    photoId: randomUUID(),
    versionId: randomUUID(),
    expected: {
      mime: 'image/png',
      bytes: source.byteLength,
      sha256: createHash('sha256').update(source).digest('hex'),
      width: 48,
      height: 24,
    },
  };
  const sourceFile = path.join(root, 'private-source.png');
  const metadataFile = path.join(root, 'private-metadata.json');
  const outputRoot = path.join(root, 'processed');
  const jobId = randomUUID();
  await writeFile(sourceFile, source);
  await writeFile(metadataFile, JSON.stringify(metadata));
  const run = () =>
    spawnSync(
      process.execPath,
      [cli, metadataFile, sourceFile, outputRoot, jobId],
      { cwd: projectRoot, encoding: 'utf8', timeout: 30000 },
    );
  return {
    root,
    source,
    sourceFile,
    metadataFile,
    outputRoot,
    metadata,
    jobId,
    run,
  };
}

describe('local trusted image command, real Node/native decoding and filesystem', () => {
  it('processes a real image, persists checked JPEGs and replays without overwriting', async () => {
    const input = await fixture();
    const first = input.run();
    expect(first.error).toBeUndefined();
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      status: 'processed_locally',
      jobId: input.jobId,
      publishedToR2: false,
    });
    expect(first.stdout).not.toContain(input.metadata.photoId);
    const output = path.join(input.outputRoot, input.jobId);
    const manifestBytes = await readFile(path.join(output, 'manifest.json'));
    const manifest = localImageProcessingManifestSchema.parse(
      JSON.parse(manifestBytes.toString()),
    );
    for (const artifact of manifest.artifacts) {
      const bytes = await readFile(path.join(output, artifact.filename));
      const decoded = await sharp(bytes)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(decoded.info.width).toBe(48);
      expect(decoded.info.height).toBe(24);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        artifact.sha256,
      );
      expect(bytes.byteLength).toBe(artifact.bytes);
    }
    const retry = input.run();
    expect(retry.status, retry.stderr).toBe(0);
    expect(await readFile(path.join(output, 'manifest.json'))).toEqual(
      manifestBytes,
    );
    expect(await readFile(input.sourceFile)).toEqual(input.source);
    await writeFile(
      input.metadataFile,
      JSON.stringify({ ...input.metadata, versionId: randomUUID() }),
    );
    const conflict = input.run();
    expect(conflict.status).toBe(1);
    expect(conflict.stderr.trim()).toBe('LOCAL_IMAGE_PROCESSING_FAILED');
    expect(await readFile(path.join(output, 'manifest.json'))).toEqual(
      manifestBytes,
    );
  }, 30_000);
  it('rejects malformed bytes without output and suppresses source paths and decoder text', async () => {
    const input = await fixture();
    const source = Buffer.from('PRIVATE-SENTINEL-NOT-AN-IMAGE');
    await writeFile(input.sourceFile, source);
    await writeFile(
      input.metadataFile,
      JSON.stringify({
        ...input.metadata,
        expected: {
          ...input.metadata.expected,
          bytes: source.byteLength,
          sha256: createHash('sha256').update(source).digest('hex'),
        },
      }),
    );
    const failed = input.run();
    expect(failed.status).toBe(1);
    expect(failed.stdout).toBe('');
    expect(failed.stderr.trim()).toBe('LOCAL_IMAGE_PROCESSING_FAILED');
    expect(failed.stderr).not.toContain('PRIVATE-SENTINEL');
    expect(failed.stderr).not.toContain(input.root);
    await expect(
      readFile(path.join(input.outputRoot, input.jobId, 'manifest.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
