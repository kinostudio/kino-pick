import { describe, it, expect } from 'vitest';
import { envSchema } from '../../packages/contracts/src/index';
import { MemoryStorageAdapter } from '../../packages/storage/src/index';
const a = { workspaceId: 'a', projectId: 'p', albumId: 'l' };
describe('safe local configuration', () => {
  it('defaults retention to OFF/dry-run', () => {
    const env = envSchema.parse({});
    expect(env.STORAGE_AUTODELETE_ENABLED).toBe(false);
    expect(env.STORAGE_RETENTION_DRY_RUN).toBe(true);
  });
  it.each([
    { STORAGE_AUTODELETE_ENABLED: 'true' },
    { STORAGE_RETENTION_DRY_RUN: 'false' },
    { STORAGE_AUTODELETE_ENABLED: 'yes' },
    { APP_ENV: 'production' },
    { STORAGE_SOFT_QUOTA_BYTES: '-1' },
  ])('rejects unsafe or invalid config %o', (input) => {
    expect(envSchema.safeParse(input).success).toBe(false);
  });
});
describe('immutable isolated memory storage', () => {
  it('denies a different workspace, project and album', async () => {
    const store = new MemoryStorageAdapter();
    await store.put(a, 'k', new Uint8Array([1]), 'image/jpeg');
    for (const scope of [
      { ...a, workspaceId: 'b' },
      { ...a, projectId: 'b' },
      { ...a, albumId: 'b' },
    ]) {
      expect(await store.stat(scope, 'k')).toBeNull();
      await expect(store.read(scope, 'k')).rejects.toThrow('NOT_FOUND');
    }
  });
  it('cannot overwrite or mutate stored bytes through references', async () => {
    const store = new MemoryStorageAdapter();
    const bytes = new Uint8Array([1]);
    await store.put(a, 'k', bytes, 'image/jpeg');
    bytes[0] = 2;
    const read = await store.read(a, 'k');
    read[0] = 3;
    expect((await store.read(a, 'k'))[0]).toBe(1);
    await expect(store.put(a, 'k', bytes, 'image/jpeg')).rejects.toThrow(
      'IMMUTABLE',
    );
  });
  it('supports idempotent scoped deletion and refuses fake upload URLs', async () => {
    const store = new MemoryStorageAdapter();
    await store.put(a, 'k', new Uint8Array([1]), 'image/jpeg');
    await store.deleteObject({ ...a, workspaceId: 'b' }, 'k');
    expect(await store.stat(a, 'k')).not.toBeNull();
    await store.deleteObject(a, 'k');
    await store.deleteObject(a, 'k');
    expect(await store.stat(a, 'k')).toBeNull();
    await expect(store.presignUpload()).rejects.toThrow('NO_HTTP_UPLOAD');
  });
});
