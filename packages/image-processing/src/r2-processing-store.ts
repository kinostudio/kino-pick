import { z } from 'zod';
import type { Scope } from '../../domain/src/index.ts';
import type { ProcessingObjectStore } from './durable-runner.ts';

/** Used by the trusted Node runner through local bindings, not an original-file HTTP relay. */
export class R2ProcessingObjectStore implements ProcessingObjectStore {
  private bucket: Pick<R2Bucket, 'get' | 'head' | 'put'>;
  constructor(bucket: Pick<R2Bucket, 'get' | 'head' | 'put'>) {
    this.bucket = bucket;
  }
  private key(scope: Scope, key: string) {
    z.object({ workspaceId: z.uuid(), projectId: z.uuid(), albumId: z.uuid() })
      .strict()
      .parse(scope);
    if (
      !key.startsWith(
        `${scope.workspaceId}/${scope.projectId}/${scope.albumId}/`,
      ) ||
      key.includes('..') ||
      key.includes('%') ||
      key.includes('\\') ||
      key.length > 1024
    )
      throw new Error('PROCESSING_OBJECT_SCOPE_INVALID');
    return key;
  }
  async read(scope: Scope, key: string, maxBytes: number): Promise<Uint8Array> {
    z.number().int().min(1).max(67108864).parse(maxBytes);
    const object = await this.bucket.get(this.key(scope, key));
    if (!object) throw new Error('PROCESSING_OBJECT_MISSING');
    if (object.size > maxBytes) {
      await object.body.cancel();
      throw new Error('PROCESSING_OBJECT_LIMIT');
    }
    const reader = object.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error('PROCESSING_OBJECT_LIMIT');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  async putIfAbsent(
    scope: Scope,
    key: string,
    bytes: Uint8Array,
    mime: 'image/jpeg',
  ): Promise<'created' | 'exists'> {
    if (
      mime !== 'image/jpeg' ||
      bytes.byteLength < 1 ||
      bytes.byteLength > 8388608
    )
      throw new Error('PROCESSING_OBJECT_LIMIT');
    const body = new Uint8Array(bytes);
    const checksum = await crypto.subtle.digest('SHA-256', body);
    const object = await this.bucket.put(this.key(scope, key), body, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: mime },
      sha256: checksum,
    });
    return object ? 'created' : 'exists';
  }
}
