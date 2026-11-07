import { z } from 'zod';
import {
  extractCaptureMetadata,
  type CaptureMetadataSource,
} from '../../../packages/image-processing/src/capture-metadata';
import { D1GalleryRepository } from './gallery';
import { D1GuestGalleryRepository } from './guest-gallery';
import type { WorkerEnv } from './config';
import { storageBucketForNode, type StorageBucket } from './private-storage';
import { WorkspaceFailure } from './workspaces';

type CaptureMetadataBucket = Pick<StorageBucket, 'get' | 'head'>;
const CAPTURE_READ_WINDOW_BYTES = 32 * 1024;
const MAX_CAPTURE_PHYSICAL_READS = 8;
const MAX_CAPTURE_PHYSICAL_BYTES = 256 * 1024;

const sourceSchema = z
  .object({
    object_key: z.string().min(1),
    storage_node_id: z.string().min(1).max(128),
    byte_size: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    workspace_id: z.uuid(),
    project_id: z.uuid(),
    album_id: z.uuid(),
  })
  .strict();

async function sourceForAuthorizedAsset(
  env: WorkerEnv,
  photoId: string,
  versionId: string,
  scope: { workspace_id: string; project_id: string; album_id: string },
) {
  const row = await env.DB.prepare(
    `SELECT original.object_key,original.storage_node_id,original.byte_size,
      original.mime,original.checksum_sha256,p.workspace_id,p.project_id,p.album_id
    FROM photos p
    JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id
    JOIN photo_assets original ON original.version_id=v.id AND original.photo_id=p.id
      AND original.workspace_id=p.workspace_id AND original.asset_kind='original' AND original.state='private'
      AND original.byte_size=v.byte_size AND original.mime=v.mime
      AND original.checksum_sha256=v.source_hash_sha256
    JOIN albums al ON al.id=p.album_id AND al.workspace_id=p.workspace_id AND al.project_id=p.project_id
    JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id
    WHERE p.id=? AND v.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=?
      AND al.state NOT IN('deleting','deleted') AND pr.status NOT IN('deleting','deleted')`,
  )
    .bind(
      z.uuid().parse(photoId),
      z.uuid().parse(versionId),
      scope.workspace_id,
      scope.project_id,
      scope.album_id,
    )
    .first<Record<string, unknown>>();
  const source = sourceSchema.safeParse(row);
  if (!source.success) throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
  return source.data;
}

function sha256(bytes: ArrayBuffer | ArrayBufferView): string | null {
  const values =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from(values, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function captureRangeMatches(
  range: R2Range | undefined,
  offset: number,
  length: number,
  sourceSize: number,
) {
  if (!range) return true;
  if (!('offset' in range) || range.offset !== offset) return false;
  return 'length' in range && range.length !== undefined
    ? range.length === length
    : length === sourceSize - offset;
}

async function readBoundedCaptureBody(
  body: ReadableStream<Uint8Array>,
  expectedLength: number,
) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < expectedLength) {
      const part = await reader.read();
      if (part.done) break;
      if (part.value.byteLength > expectedLength - received)
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      chunks.push(part.value);
      received += part.value.byteLength;
    }
    if (received !== expectedLength)
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    const bytes = new Uint8Array(expectedLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function readVerifiedCaptureMetadata(
  env: WorkerEnv,
  source: Awaited<ReturnType<typeof sourceForAuthorizedAsset>>,
) {
  let storage: CaptureMetadataBucket;
  let head: R2Object | null;
  try {
    storage = storageBucketForNode(env, source.storage_node_id);
    head = await storage.head(source.object_key);
  } catch {
    throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
  }
  if (
    !head ||
    !head.etag ||
    head.size !== source.byte_size ||
    sha256(head.checksums.sha256 ?? new Uint8Array()) !==
      source.checksum_sha256 ||
    head.httpMetadata?.contentType !== source.mime
  )
    throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);

  let windowOffset = -1;
  let windowBytes = new Uint8Array();
  let physicalReads = 0;
  let physicalBytes = 0;
  const readWindow = async (offset: number) => {
    const length = Math.min(
      CAPTURE_READ_WINDOW_BYTES,
      source.byte_size - offset,
    );
    if (
      length < 1 ||
      physicalReads >= MAX_CAPTURE_PHYSICAL_READS ||
      physicalBytes + length > MAX_CAPTURE_PHYSICAL_BYTES
    )
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    physicalReads++;
    physicalBytes += length;
    let object: R2ObjectBody | R2Object | null;
    try {
      object = await storage.get(source.object_key, {
        range: { offset, length },
        onlyIf: { etagMatches: head.etag },
      });
    } catch {
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    }
    if (!object || !('body' in object))
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    if (
      object.etag !== head.etag ||
      object.size !== source.byte_size ||
      !captureRangeMatches(object.range, offset, length, source.byte_size)
    ) {
      await object.body.cancel().catch(() => undefined);
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    }
    try {
      windowBytes = await readBoundedCaptureBody(object.body, length);
      windowOffset = offset;
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    }
  };
  const input: CaptureMetadataSource = {
    size: source.byte_size,
    read: async (offset, length) => {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 1 ||
        offset + length > source.byte_size
      )
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      const bytes = new Uint8Array(length);
      let copied = 0;
      while (copied < length) {
        const position = offset + copied;
        if (
          position < windowOffset ||
          position >= windowOffset + windowBytes.byteLength
        )
          await readWindow(position);
        const windowPosition = position - windowOffset;
        const available = windowBytes.byteLength - windowPosition;
        if (available < 1) throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
        const count = Math.min(length - copied, available);
        bytes.set(
          windowBytes.subarray(windowPosition, windowPosition + count),
          copied,
        );
        copied += count;
      }
      return bytes;
    },
  };
  return extractCaptureMetadata(input, source.mime);
}

export async function readOwnerCaptureMetadata(
  env: WorkerEnv,
  ownerId: string,
  sessionId: string,
  photoId: string,
  versionId: string,
) {
  const repository = new D1GalleryRepository(env.DB, ownerId, sessionId);
  const access = await repository.asset(photoId, versionId, 'preview');
  const source = await sourceForAuthorizedAsset(
    env,
    photoId,
    versionId,
    access,
  );
  const metadata = await readVerifiedCaptureMetadata(env, source);
  await repository.asset(photoId, versionId, 'preview');
  return metadata;
}

export async function readGuestCaptureMetadata(
  env: WorkerEnv,
  guestSecret: string | null,
  photoId: string,
  versionId: string,
) {
  const repository = new D1GuestGalleryRepository(env.DB);
  const access = await repository.asset(
    guestSecret,
    photoId,
    versionId,
    'preview',
  );
  const source = await sourceForAuthorizedAsset(
    env,
    photoId,
    versionId,
    access,
  );
  const metadata = await readVerifiedCaptureMetadata(env, source);
  await repository.asset(guestSecret, photoId, versionId, 'preview');
  return metadata;
}
