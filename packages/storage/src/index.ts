import type { Scope, StorageAdapter } from '../../domain/src/index';
/** Isolated, immutable test storage. Does not issue HTTP upload grants. */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly objects = new Map<
    string,
    { data: Uint8Array; mime: string }
  >();
  private id(scope: Scope, key: string) {
    return JSON.stringify([
      scope.workspaceId,
      scope.projectId,
      scope.albumId,
      key,
    ]);
  }
  async put(scope: Scope, key: string, data: Uint8Array, mime: string) {
    const id = this.id(scope, key);
    if (this.objects.has(id)) throw new Error('IMMUTABLE_KEY_EXISTS');
    this.objects.set(id, { data: data.slice(), mime });
  }
  async presignUpload(): Promise<never> {
    throw new Error('MEMORY_STORAGE_HAS_NO_HTTP_UPLOAD');
  }
  async stat(scope: Scope, key: string) {
    const item = this.objects.get(this.id(scope, key));
    return item ? { bytes: item.data.byteLength, mime: item.mime } : null;
  }
  async read(scope: Scope, key: string) {
    const item = this.objects.get(this.id(scope, key));
    if (!item) throw new Error('NOT_FOUND');
    return item.data.slice();
  }
  async deleteObject(scope: Scope, key: string) {
    this.objects.delete(this.id(scope, key));
  }
}
