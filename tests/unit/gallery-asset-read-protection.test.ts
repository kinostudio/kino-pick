import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { D1AlbumReadProtections } from '../../apps/worker/src/album-read-protections';
import {
  albumReadProtectionCapability,
  configuration,
  type WorkerEnv,
} from '../../apps/worker/src/config';
import { openGalleryAsset } from '../../apps/worker/src/gallery-asset';
import { GuestAccessDenied } from '../../apps/worker/src/guest-access';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';
import { D1GalleryRepository } from '../../apps/worker/src/gallery';
import { D1GuestGalleryRepository } from '../../apps/worker/src/guest-gallery';
import worker from '../../apps/worker/src/index';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../apps/worker/src/auth', () => ({
  createAuth: () => ({ api: { getSession } }),
}));

function fixture(enabled = true) {
  const scope = {
    workspace_id: randomUUID(),
    project_id: randomUUID(),
    album_id: randomUUID(),
  };
  const item = {
    ...scope,
    object_key: `${scope.workspace_id}/${scope.project_id}/${scope.album_id}/preview.jpg`,
    byte_size: 3,
    checksum_sha256: '00'.repeat(32),
    storage_node_id: 'primary',
  };
  const cancel = vi.fn();
  const object = {
    size: 3,
    checksums: { sha256: new ArrayBuffer(32) },
    httpMetadata: { contentType: 'image/jpeg' },
    body: new ReadableStream({ cancel }),
  } as unknown as R2ObjectBody;
  const get = vi.fn().mockResolvedValue(object);
  const env = {
    APP_ENV: 'local',
    APP_URL: 'http://127.0.0.1:8787',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
    ALBUM_READ_PROTECTION_ENABLED: enabled ? 'true' : 'false',
    PRIMARY_STORAGE: { get },
    DB: {},
  } as unknown as WorkerEnv;
  const acquire = vi
    .spyOn(D1AlbumReadProtections.prototype, 'acquire')
    .mockResolvedValue({ protectedUntilMs: Date.now() + 900_000, revision: 0 });
  return {
    scope,
    item,
    object,
    get,
    cancel,
    env,
    acquire,
    authorize: vi.fn().mockResolvedValue(item),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  getSession.mockReset();
});

describe('Authorized private asset read protection', () => {
  it('defaults OFF, preserving one existing authorization and no protection SQL', async () => {
    const f = fixture(false);
    delete f.env.ALBUM_READ_PROTECTION_ENABLED;
    expect(configuration(f.env).ALBUM_READ_PROTECTION_ENABLED).toBe('false');
    expect(albumReadProtectionCapability(f.env)).toBe(false);
    expect(await openGalleryAsset(f.env, f.authorize)).toBe(f.object);
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.get).toHaveBeenCalledTimes(1);
  });

  it('acquires before storage IO, reauthorizes after IO and protects before returning bytes', async () => {
    const f = fixture();
    const order: string[] = [];
    f.authorize.mockImplementation(async () => {
      order.push('authorize');
      return f.item;
    });
    f.acquire.mockImplementation(async () => {
      order.push('protect');
      return { protectedUntilMs: Date.now() + 900_000, revision: 0 };
    });
    f.get.mockImplementation(async () => {
      order.push('storage');
      return f.object;
    });
    const opened = await openGalleryAsset(f.env, f.authorize);
    expect(opened.size).toBe(f.object.size);
    expect(opened.body).not.toBe(f.object.body);
    expect(order).toEqual([
      'authorize',
      'protect',
      'storage',
      'authorize',
      'protect',
    ]);
    expect(f.acquire).toHaveBeenNthCalledWith(1, f.scope);
    expect(f.acquire).toHaveBeenNthCalledWith(2, f.scope);
    expect(f.cancel).not.toHaveBeenCalled();
    await opened.body.cancel();
  });

  it('does not open storage or write a protection after an unauthorized request', async () => {
    const f = fixture();
    f.authorize.mockRejectedValue(new GuestAccessDenied());
    await expect(openGalleryAsset(f.env, f.authorize)).rejects.toBeInstanceOf(
      GuestAccessDenied,
    );
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
  });

  it('fails before storage when protection persistence fails', async () => {
    const f = fixture();
    f.acquire.mockRejectedValue(
      new WorkspaceFailure('ALBUM_READ_PROTECTION_UNAVAILABLE', 503),
    );
    await expect(openGalleryAsset(f.env, f.authorize)).rejects.toMatchObject({
      code: 'ALBUM_READ_PROTECTION_UNAVAILABLE',
      status: 503,
    });
    expect(f.get).not.toHaveBeenCalled();
  });

  it('preserves the existing distinct Owner and Guest storage-open errors when OFF', async () => {
    const f = fixture(false);
    const failure = new Error('synthetic storage unavailable');
    f.get.mockRejectedValue(failure);
    await expect(openGalleryAsset(f.env, f.authorize)).rejects.toBe(failure);
    await expect(
      openGalleryAsset(f.env, f.authorize, { maskStorageErrors: true }),
    ).rejects.toMatchObject({ code: 'ASSET_UNAVAILABLE', status: 503 });
    expect(f.acquire).not.toHaveBeenCalled();
  });

  it('cancels unread bytes when authorization is revoked during storage IO', async () => {
    const f = fixture();
    f.authorize
      .mockResolvedValueOnce(f.item)
      .mockRejectedValueOnce(new GuestAccessDenied());
    await expect(openGalleryAsset(f.env, f.authorize)).rejects.toBeInstanceOf(
      GuestAccessDenied,
    );
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.acquire).toHaveBeenCalledTimes(1);
  });

  it('cancels when the authorized asset identity or scope changes', async () => {
    const f = fixture();
    f.authorize
      .mockResolvedValueOnce(f.item)
      .mockResolvedValueOnce({ ...f.item, album_id: randomUUID() });
    await expect(openGalleryAsset(f.env, f.authorize)).rejects.toMatchObject({
      code: 'ASSET_UNAVAILABLE',
    });
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.acquire).toHaveBeenCalledTimes(1);
  });

  it('cancels if the second protection fails or the album started deleting', async () => {
    const f = fixture();
    f.acquire
      .mockResolvedValueOnce({
        protectedUntilMs: Date.now() + 900_000,
        revision: 0,
      })
      .mockRejectedValueOnce(
        new WorkspaceFailure('ALBUM_READ_PROTECTION_UNAVAILABLE', 503),
      );
    await expect(openGalleryAsset(f.env, f.authorize)).rejects.toMatchObject({
      code: 'ALBUM_READ_PROTECTION_UNAVAILABLE',
    });
    expect(f.cancel).toHaveBeenCalledOnce();
  });

  it('retains size, checksum and mime rejection, canceling invalid objects', async () => {
    for (const change of [
      { size: 4 },
      { size: 8388609 },
      { checksums: {} },
      { httpMetadata: { contentType: 'text/plain' } },
    ]) {
      vi.restoreAllMocks();
      const f = fixture();
      f.get.mockResolvedValue({ ...f.object, ...change });
      await expect(openGalleryAsset(f.env, f.authorize)).rejects.toMatchObject({
        code: 'ASSET_UNAVAILABLE',
      });
      expect(f.cancel).toHaveBeenCalledOnce();
      expect(f.authorize).toHaveBeenCalledTimes(1);
    }
  });
});

describe('Actual Worker private asset routes with mocked repositories', () => {
  it.each(['owner', 'guest'] as const)(
    'keeps %s response bytes/headers and invokes the shared protection path',
    async (role) => {
      const f = fixture();
      f.get.mockResolvedValue({
        ...f.object,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0, 1, 2]));
            controller.close();
          },
        }),
      });
      const id = randomUUID();
      const sessionId = randomUUID();
      getSession.mockResolvedValue({
        user: { id },
        session: { id: sessionId },
      });
      const statement = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ user_id: id }),
      };
      f.env.DB = {
        prepare: vi.fn().mockReturnValue(statement),
      } as unknown as D1Database;
      const repository =
        role === 'owner' ? D1GalleryRepository : D1GuestGalleryRepository;
      const asset = vi
        .spyOn(repository.prototype, 'asset')
        .mockResolvedValue(f.item);
      const base = role === 'owner' ? '/api/v1' : '/api/guest';
      const response = await worker.fetch(
        new Request(
          `http://127.0.0.1:8787${base}/photos/${randomUUID()}/versions/${randomUUID()}/assets/preview`,
        ),
        f.env,
      );
      expect(response.status).toBe(200);
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array([0, 1, 2]),
      );
      expect(response.headers.get('Content-Type')).toBe('image/jpeg');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Content-Disposition')).toBe('inline');
      expect(asset).toHaveBeenCalledTimes(2);
      expect(f.acquire).toHaveBeenCalledTimes(2);
    },
  );

  it('retains Guest denial without reading storage or adding protection', async () => {
    const f = fixture();
    vi.spyOn(D1GuestGalleryRepository.prototype, 'asset').mockRejectedValue(
      new GuestAccessDenied(),
    );
    const response = await worker.fetch(
      new Request(
        `http://127.0.0.1:8787/api/guest/photos/${randomUUID()}/versions/${randomUUID()}/assets/thumbnail`,
      ),
      f.env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'GUEST_ACCESS_REQUIRED' },
    });
    expect(f.get).not.toHaveBeenCalled();
    expect(f.acquire).not.toHaveBeenCalled();
  });
});
