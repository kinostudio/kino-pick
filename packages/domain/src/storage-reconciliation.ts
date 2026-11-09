type InventoryObject = Readonly<{ key: string; bytes: number }>;
export type StorageInventorySnapshot = Readonly<{
  workspaceId: string;
  storageNodeId: string;
  revision: string;
  pendingWrites: boolean;
  objects: readonly InventoryObject[];
}>;
export type StorageInventoryPage = Readonly<{
  objects: readonly Readonly<{ key: string; size: number }>[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: readonly string[];
}>;
type Failure =
  | 'inventory_unavailable'
  | 'inventory_invalid'
  | 'pending_writes'
  | 'listing_unavailable'
  | 'listing_invalid'
  | 'scan_limit'
  | 'unexpected_object'
  | 'missing_object'
  | 'size_mismatch'
  | 'inventory_changed';
export type StorageReconciliationResult =
  | Readonly<{ status: 'blocked'; reason: Failure; readOnly: true }>
  | Readonly<{
      status: 'matched';
      workspaceId: string;
      storageNodeId: string;
      inventoryRevision: string;
      objectCount: number;
      confirmedBytes: number;
      pages: number;
      readOnly: true;
    }>;

// shortcut: bounded one-shot scans; larger inventories need persisted paged jobs.
const MAX_OBJECTS = 20_000;
const MAX_KEY_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

function inventory(
  snapshot: StorageInventorySnapshot,
  workspaceId: string,
  storageNodeId: string,
) {
  if (
    !snapshot ||
    snapshot.workspaceId !== workspaceId ||
    snapshot.storageNodeId !== storageNodeId ||
    typeof snapshot.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.revision) ||
    typeof snapshot.pendingWrites !== 'boolean' ||
    !Array.isArray(snapshot.objects) ||
    snapshot.objects.length > MAX_OBJECTS
  )
    return null;
  const objects = new Map<string, number>();
  const prefix = workspaceId + '/';
  let keyBytes = 0;
  let bytes = 0;
  for (const item of snapshot.objects) {
    if (!item || typeof item.key !== 'string' || item.key.length > 1024)
      return null;
    const encodedKeyBytes = encoder.encode(item.key).length;
    if (
      !item.key.startsWith(prefix) ||
      item.key.length <= prefix.length ||
      encodedKeyBytes > 1024 ||
      item.key.includes('..') ||
      /[%\\]/u.test(item.key) ||
      objects.has(item.key) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0
    )
      return null;
    keyBytes += encodedKeyBytes;
    bytes += item.bytes;
    if (keyBytes > MAX_KEY_BYTES || !Number.isSafeInteger(bytes)) return null;
    objects.set(item.key, item.bytes);
  }
  return {
    revision: snapshot.revision,
    pendingWrites: snapshot.pendingWrites,
    objects,
    bytes,
  };
}

/** Read-only capacity check, not an integrity check or permission to delete.
 * The server reader must include live upload grants/processing/deletion in pendingWrites.
 * A durable writer must CAS the returned inventory revision before persisting a receipt.
 */
export async function reconcileStorageInventory(input: {
  workspaceId: string;
  storageNodeId: string;
  readInventory: () => Promise<StorageInventorySnapshot>;
  listPage: (options: {
    prefix: string;
    limit: 1000;
    cursor?: string;
  }) => Promise<StorageInventoryPage>;
}): Promise<StorageReconciliationResult> {
  const { workspaceId, storageNodeId, readInventory, listPage } = input;
  if (
    typeof workspaceId !== 'string' ||
    typeof storageNodeId !== 'string' ||
    !UUID.test(workspaceId) ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(storageNodeId)
  )
    throw new TypeError('Invalid storage reconciliation scope');
  const blocked = (reason: Failure): StorageReconciliationResult => ({
    status: 'blocked',
    reason,
    readOnly: true,
  });
  const prefix = workspaceId + '/';
  let before;
  try {
    before = inventory(await readInventory(), workspaceId, storageNodeId);
  } catch {
    return blocked('inventory_unavailable');
  }
  if (!before) return blocked('inventory_invalid');
  if (before.pendingWrites) return blocked('pending_writes');
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  while (true) {
    if (pages === MAX_PAGES) return blocked('scan_limit');
    let page;
    try {
      page = await listPage({
        prefix,
        limit: 1000,
        ...(cursor === undefined ? {} : { cursor }),
      });
    } catch {
      return blocked('listing_unavailable');
    }
    pages++;
    if (
      !page ||
      !Array.isArray(page.objects) ||
      page.objects.length > 1000 ||
      typeof page.truncated !== 'boolean' ||
      (page.delimitedPrefixes !== undefined &&
        (!Array.isArray(page.delimitedPrefixes) ||
          page.delimitedPrefixes.length !== 0))
    )
      return blocked('listing_invalid');
    for (const item of page.objects) {
      if (
        !item ||
        typeof item.key !== 'string' ||
        !item.key.startsWith(prefix) ||
        item.key.length > 1024 ||
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        seen.has(item.key)
      )
        return blocked('listing_invalid');
      if (!before.objects.has(item.key)) return blocked('unexpected_object');
      if (before.objects.get(item.key) !== item.size)
        return blocked('size_mismatch');
      seen.add(item.key);
    }
    if (!page.truncated) break;
    if (
      typeof page.cursor !== 'string' ||
      page.cursor.length === 0 ||
      page.cursor.length > 4096 ||
      cursors.has(page.cursor)
    )
      return blocked('listing_invalid');
    cursor = page.cursor;
    cursors.add(cursor);
  }
  if (seen.size !== before.objects.size) return blocked('missing_object');
  let after;
  try {
    after = inventory(await readInventory(), workspaceId, storageNodeId);
  } catch {
    return blocked('inventory_unavailable');
  }
  if (!after) return blocked('inventory_invalid');
  if (
    after.pendingWrites ||
    after.revision !== before.revision ||
    after.objects.size !== before.objects.size
  )
    return blocked('inventory_changed');
  for (const [key, bytes] of before.objects)
    if (after.objects.get(key) !== bytes) return blocked('inventory_changed');
  return {
    status: 'matched',
    workspaceId,
    storageNodeId,
    inventoryRevision: before.revision,
    objectCount: seen.size,
    confirmedBytes: before.bytes,
    pages,
    readOnly: true,
  };
}
