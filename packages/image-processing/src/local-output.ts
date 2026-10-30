import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  localImageProcessingManifestSchema,
  type LocalImageProcessingManifest,
} from '../../contracts/src/image-processing.ts';
import type { ImageProcessingResult } from '../../domain/src/index.ts';

const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

function conflict(): never {
  throw new Error('LOCAL_OUTPUT_CONFLICT');
}

async function unlinkStagingIfPresent(filename: string) {
  try {
    await unlink(filename);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
  }
}

/** Create-once local artifacts. A manifest is published only after both files verify.
 * This is not a D1/R2 transaction and grants no gallery or delivery authorization.
 */
export async function writeLocalImageProcessingResult(input: {
  outputRoot: string;
  jobId: string;
  result: ImageProcessingResult;
}): Promise<{ directory: string; manifest: LocalImageProcessingManifest }> {
  const jobId = z.uuid().parse(input.jobId);
  const outputRoot = z.string().min(1).parse(input.outputRoot);
  if (input.result.artifacts.length !== 2) conflict();
  const manifest = localImageProcessingManifestSchema.parse({
    schemaVersion: 1,
    jobId,
    processorVersion: input.result.processorVersion,
    scope: input.result.scope,
    photoId: input.result.photoId,
    versionId: input.result.versionId,
    expected: input.result.source,
    artifacts: input.result.artifacts.map((artifact) => ({
      ...artifact,
      bytes: artifact.bytes.byteLength,
      filename: `${artifact.kind}.jpg`,
    })),
  });
  // Copy only after size validation, before the first filesystem await.
  const artifacts = input.result.artifacts.map((artifact) => ({
    ...artifact,
    bytes: Buffer.from(artifact.bytes),
  }));
  // Validate the entire result before touching disk, including declared hashes.
  for (const artifact of artifacts) {
    if (digest(artifact.bytes) !== artifact.sha256) conflict();
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(outputRoot, { recursive: true });
  const root = await realpath(outputRoot);
  const directory = path.join(root, jobId);
  await mkdir(directory, { recursive: true });
  const directoryStat = await lstat(directory);
  if (
    directoryStat.isSymbolicLink() ||
    !directoryStat.isDirectory() ||
    (await realpath(directory)) !== directory
  )
    conflict();

  async function checkExisting(filename: string, bytes: Uint8Array) {
    const destination = path.join(directory, filename);
    const stat = await lstat(destination);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      stat.size !== bytes.byteLength ||
      (await realpath(destination)) !== destination
    )
      conflict();
    const file = await open(destination, constants.O_RDONLY);
    try {
      const openedStat = await file.stat();
      if (!openedStat.isFile() || openedStat.size !== bytes.byteLength)
        conflict();
      const existing = await file.readFile();
      if (!existing.equals(Buffer.from(bytes))) conflict();
      // Recover a crash after atomic publication but before unlinking its staging name.
      // Only remove recognized staging links to this already-verified exact inode.
      if (openedStat.nlink > 1) {
        const prefix = `.kino-stage-${filename}-`;
        for (const name of await readdir(directory)) {
          if (
            !name.startsWith(prefix) ||
            !z.uuid().safeParse(name.slice(prefix.length)).success
          )
            continue;
          const stagedPath = path.join(directory, name);
          const staged = await lstat(stagedPath).catch((error: unknown) => {
            if (
              error instanceof Error &&
              'code' in error &&
              error.code === 'ENOENT'
            )
              return null;
            throw error;
          });
          if (
            staged?.isFile() &&
            !staged.isSymbolicLink() &&
            staged.ino === openedStat.ino &&
            staged.dev === openedStat.dev
          )
            await unlinkStagingIfPresent(stagedPath);
        }
      }
      if ((await file.stat()).nlink !== 1) conflict();
    } finally {
      await file.close();
    }
  }

  async function createOrVerify(filename: string, bytes: Uint8Array) {
    const destination = path.join(directory, filename);
    const stagedPath = path.join(
      directory,
      `.kino-stage-${filename}-${randomUUID()}`,
    );
    const file = await open(stagedPath, 'wx', 0o600);
    try {
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        // Hard-link publication is atomic and fails if any destination already exists.
        await link(stagedPath, destination);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        )
          throw error;
        await checkExisting(filename, bytes);
      }
    } finally {
      await unlinkStagingIfPresent(stagedPath);
    }
    await checkExisting(filename, bytes);
  }

  // A published manifest must already match, before a reused ID can write anything.
  try {
    await checkExisting('manifest.json', manifestBytes);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
  }
  // Bind the job before the first artifact, including after an interrupted run.
  await createOrVerify('intent.json', manifestBytes);
  for (const artifact of artifacts)
    await createOrVerify(`${artifact.kind}.jpg`, artifact.bytes);
  await createOrVerify('manifest.json', manifestBytes);
  return { directory, manifest };
}
