import { D1AlbumReadProtections } from './album-read-protections';
import { albumReadProtectionCapability, type WorkerEnv } from './config';
import { storageBucketForNode } from './private-storage';
import { R2StorageAdapter } from './r2-storage';
import { WorkspaceFailure } from './workspaces';

type GalleryAsset = Readonly<{
  workspace_id: string;
  project_id: string;
  album_id: string;
  object_key: string;
  byte_size: number;
  checksum_sha256: string;
  storage_node_id: string;
}>;

const identity = [
  'workspace_id',
  'project_id',
  'album_id',
  'object_key',
  'byte_size',
  'checksum_sha256',
  'storage_node_id',
] as const;

/** A recent authorized read blocks cleanup; it is not proof of continuous human activity. */
export async function openGalleryAsset(
  env: WorkerEnv,
  authorize: () => Promise<GalleryAsset>,
  options: { maskStorageErrors?: boolean } = {},
): Promise<R2ObjectBody> {
  const item = await authorize();
  const protectedRead = albumReadProtectionCapability(env);
  const protections = new D1AlbumReadProtections(env.DB);
  const scope = {
    workspace_id: item.workspace_id,
    project_id: item.project_id,
    album_id: item.album_id,
  };
  if (protectedRead) await protections.acquire(scope);
  let object: R2ObjectBody;
  try {
    object = await new R2StorageAdapter(
      storageBucketForNode(env, item.storage_node_id),
      item.storage_node_id,
    ).open(
      {
        workspaceId: item.workspace_id,
        projectId: item.project_id,
        albumId: item.album_id,
      },
      item.object_key,
    );
  } catch (error) {
    if (options.maskStorageErrors)
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    throw error;
  }
  try {
    const checksum = object.checksums.sha256
      ? Array.from(new Uint8Array(object.checksums.sha256), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
      : null;
    if (
      object.size !== item.byte_size ||
      object.size > 8388608 ||
      checksum !== item.checksum_sha256 ||
      object.httpMetadata?.contentType !== 'image/jpeg'
    )
      throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
    if (protectedRead) {
      const current = await authorize();
      if (!identity.every((key) => current[key] === item[key]))
        throw new WorkspaceFailure('ASSET_UNAVAILABLE', 503);
      await protections.acquire(scope);
    }
    // Streams and decoded tabs can outlive this window; absence never proves inactivity.
    return object;
  } catch (error) {
    await object.body.cancel().catch(() => undefined);
    throw error;
  }
}
