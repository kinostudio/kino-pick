import { z } from 'zod';
import type { Scope, StorageAdapter } from '../../../packages/domain/src/index';
import { MAX_IMAGE_HEADER_BYTES } from '../../../packages/contracts/src/image-metadata';
import type { StorageBucket } from './s3-storage-bucket';
const uploadFenceContentType = 'application/x-kino-pic-upload-fence';

function uploadFenceSessionId(item: R2Object): string | null {
  const uploadSessionId = item.customMetadata?.kinoUploadFence;
  return uploadSessionId &&
    item.size === 0 &&
    item.httpMetadata?.contentType === uploadFenceContentType
    ? uploadSessionId
    : null;
}

const scopeSchema = z
  .object({ workspaceId: z.uuid(), projectId: z.uuid(), albumId: z.uuid() })
  .strict();
/** Low-level private storage, not an upload validation/authorization service. */
export class R2StorageAdapter implements StorageAdapter {
  private bucket: StorageBucket;
  readonly storageNodeId: string;
  constructor(bucket: StorageBucket, storageNodeId = 'primary') {
    if (!storageNodeId) throw new Error('INVALID_STORAGE_NODE');
    this.bucket = bucket;
    this.storageNodeId = storageNodeId;
  }
  private key(scope: Scope, key: string) {
    scopeSchema.parse(scope);
    const prefix = `${scope.workspaceId}/${scope.projectId}/${scope.albumId}/`;
    if (
      !key.startsWith(prefix) ||
      key.length > 1024 ||
      key.includes('..') ||
      key.includes('%') ||
      key.includes('\\') ||
      !key.slice(prefix.length)
    )
      throw new Error('INVALID_OBJECT_SCOPE');
    return key;
  }
  async presignUpload(): Promise<never> {
    throw new Error('DIRECT_UPLOAD_SIGNER_NOT_CONFIGURED');
  }
  async putImmutable(
    scope: Scope,
    key: string,
    bytes: Uint8Array,
    mime: string,
  ) {
    const objectKey = this.key(scope, key);
    if (bytes.byteLength > 16 * 1024 * 1024)
      throw new Error('BOUNDED_WRITE_LIMIT');
    const result = await this.bucket.put(objectKey, bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: mime },
    });
    if (!result) throw new Error('IMMUTABLE_KEY_EXISTS');
  }
  async stat(scope: Scope, key: string) {
    const item = await this.bucket.head(this.key(scope, key));
    return item
      ? {
          bytes: item.size,
          mime: item.httpMetadata?.contentType ?? 'application/octet-stream',
        }
      : null;
  }

  async inspectUpload(scope: Scope, key: string) {
    const objectKey = this.key(scope, key);
    const item = await this.bucket.head(objectKey);
    if (!item) return null;
    const prefixLength = Math.min(item.size, MAX_IMAGE_HEADER_BYTES);
    const body =
      prefixLength > 0
        ? await this.bucket.get(objectKey, {
            range: { offset: 0, length: prefixLength },
          })
        : null;
    if (prefixLength > 0 && !body)
      throw new Error('UPLOAD_OBJECT_NOT_READABLE');
    const prefix = body
      ? new Uint8Array(await body.arrayBuffer())
      : new Uint8Array();
    const digest = item.checksums.sha256
      ? Array.from(new Uint8Array(item.checksums.sha256))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')
      : null;
    return {
      bytes: item.size,
      mime: item.httpMetadata?.contentType ?? 'application/octet-stream',
      sha256: digest,
      prefix,
      fence: uploadFenceSessionId(item),
    } as const;
  }

  /** Atomically fence an unused signed PUT key; a winning marker must remain forever. */
  async fenceIfAbsent(scope: Scope, key: string, uploadSessionId: string) {
    const objectKey = this.key(scope, key);
    const current = await this.bucket.head(objectKey);
    if (current)
      return uploadFenceSessionId(current) === uploadSessionId
        ? ('fenced' as const)
        : ('occupied' as const);
    const result = await this.bucket.put(objectKey, new Uint8Array(), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: uploadFenceContentType },
      customMetadata: { kinoUploadFence: uploadSessionId },
    });
    if (result) return 'fenced' as const;
    const winner = await this.bucket.head(objectKey);
    return winner && uploadFenceSessionId(winner) === uploadSessionId
      ? ('fenced' as const)
      : ('occupied' as const);
  }
  async open(scope: Scope, key: string) {
    const item = await this.bucket.get(this.key(scope, key));
    if (!item) throw new Error('NOT_FOUND');
    return item;
  }
  async read(scope: Scope, key: string) {
    const item = await this.open(scope, key);
    if (item.size > 16 * 1024 * 1024) throw new Error('BOUNDED_READ_LIMIT');
    return new Uint8Array(await item.arrayBuffer());
  }
  async deleteObject(): Promise<never> {
    throw new Error('DESTRUCTIVE_STORAGE_DISABLED');
  }

  /** Reclaim the payload without reopening an immutable key to stale signed PUTs. */
  async eraseAssetToFence(
    scope: Scope,
    asset: { id: string; objectKey: string; bytes: number; sha256: string },
    jobId: string,
  ) {
    z.uuid().parse(asset.id);
    z.uuid().parse(jobId);
    const key = this.key(scope, asset.objectKey);
    const isFence = (item: R2Object | null) =>
      item?.size === 0 &&
      item.httpMetadata?.contentType ===
        'application/x-kino-pic-deleted-asset' &&
      item.customMetadata?.kinoDeletionAsset === asset.id &&
      item.customMetadata?.kinoDeletionJob === jobId;
    const current = await this.bucket.head(key);
    if (isFence(current)) return current!.etag;
    if (!current || current.size !== asset.bytes)
      throw new Error('DELETION_OBJECT_MISMATCH');
    const checksum = current.checksums.sha256;
    if (!checksum || Buffer.from(checksum).toString('hex') !== asset.sha256)
      throw new Error('DELETION_CHECKSUM_MISMATCH');
    await this.bucket.put(key, new Uint8Array(), {
      onlyIf: { etagMatches: current.etag },
      httpMetadata: { contentType: 'application/x-kino-pic-deleted-asset' },
      customMetadata: { kinoDeletionAsset: asset.id, kinoDeletionJob: jobId },
    });
    const verified = await this.bucket.head(key);
    if (!isFence(verified)) throw new Error('DELETION_FENCE_UNVERIFIED');
    return verified!.etag;
  }
}

export function matchesSupportedImage(mime: string, prefix: Uint8Array) {
  if (mime === 'image/jpeg')
    return (
      prefix.length >= 3 &&
      prefix[0] === 0xff &&
      prefix[1] === 0xd8 &&
      prefix[2] === 0xff
    );
  if (mime === 'image/png')
    return (
      prefix.length >= 8 &&
      prefix[0] === 0x89 &&
      prefix[1] === 0x50 &&
      prefix[2] === 0x4e &&
      prefix[3] === 0x47 &&
      prefix[4] === 0x0d &&
      prefix[5] === 0x0a &&
      prefix[6] === 0x1a &&
      prefix[7] === 0x0a
    );
  return (
    mime === 'image/webp' &&
    prefix.length >= 12 &&
    String.fromCharCode(...prefix.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...prefix.slice(8, 12)) === 'WEBP'
  );
}
