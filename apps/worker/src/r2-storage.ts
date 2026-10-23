import { z } from 'zod';
import type { Scope, StorageAdapter } from '../../../packages/domain/src/index';
const scopeSchema = z
  .object({ workspaceId: z.uuid(), projectId: z.uuid(), albumId: z.uuid() })
  .strict();
/** Low-level private storage, not an upload validation/authorization service. */
export class R2StorageAdapter implements StorageAdapter {
  private bucket: R2Bucket;
  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
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
}
