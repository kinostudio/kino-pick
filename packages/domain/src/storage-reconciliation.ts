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
export type NodeStorageInventorySnapshot = Readonly<{
  scope: 'node';
  storageNodeId: string;
  revision: string;
  pendingWrites: boolean;
  objects: readonly InventoryObject[];
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
type Blocked = Readonly<{ status: 'blocked'; reason: Failure; readOnly: true }>;
type Matched = Readonly<{
  status: 'matched';
  storageNodeId: string;
  inventoryRevision: string;
  objectCount: number;
  confirmedBytes: number;
  pages: number;
  readOnly: true;
}>;
export type StorageReconciliationResult =
  Blocked | (Matched & Readonly<{ workspaceId: string }>);
export type NodeStorageReconciliationResult =
  Blocked | (Matched & Readonly<{ scope: 'node' }>);

// shortcut: bounded one-shot scans; larger inventories need persisted paged jobs.
const MAX_OBJECTS = 20_000;
const MAX_KEY_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

function inventory(
  snapshot: StorageInventorySnapshot | NodeStorageInventorySnapshot,
  workspaceId: string | null,
  storageNodeId: string,
) {
  if (
    !snapshot ||
    (workspaceId === null
      ? !('scope' in snapshot) ||
        snapshot.scope !== 'node' ||
        'workspaceId' in snapshot
      : !('workspaceId' in snapshot) ||
        snapshot.workspaceId !== workspaceId ||
        'scope' in snapshot) ||
    snapshot.storageNodeId !== storageNodeId ||
    typeof snapshot.revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.revision) ||
    typeof snapshot.pendingWrites !== 'boolean' ||
    !Array.isArray(snapshot.objects) ||
    snapshot.objects.length > MAX_OBJECTS
  )
    return null;
  const objects = new Map<string, number>();
  const prefix = workspaceId === null ? '' : workspaceId + '/';
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
async function reconcileInventory(input: {
  workspaceId: string | null;
  storageNodeId: string;
  readInventory: () => Promise<
    StorageInventorySnapshot | NodeStorageInventorySnapshot
  >;
  listPage: (options: {
    limit: 1000;
    cursor?: string;
  }) => Promise<StorageInventoryPage>;
}): Promise<Blocked | Matched> {
  const { workspaceId, storageNodeId, readInventory, listPage } = input;
  const blocked = (reason: Failure): Blocked => ({
    status: 'blocked',
    reason,
    readOnly: true,
  });
  const prefix = workspaceId === null ? '' : workspaceId + '/';
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
    storageNodeId,
    inventoryRevision: before.revision,
    objectCount: seen.size,
    confirmedBytes: before.bytes,
    pages,
    readOnly: true,
  };
}

function validNode(storageNodeId: string) {
  return (
    typeof storageNodeId === 'string' &&
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(storageNodeId)
  );
}

/** Exact workspace prefix scan; it cannot establish a whole-node inventory. */
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
    !UUID.test(workspaceId) ||
    !validNode(storageNodeId)
  )
    throw new TypeError('Invalid storage reconciliation scope');
  const result = await reconcileInventory({
    workspaceId,
    storageNodeId,
    readInventory,
    listPage: (options) => listPage({ prefix: workspaceId + '/', ...options }),
  });
  return result.status === 'matched' ? { ...result, workspaceId } : result;
}

/** Whole private bucket scan; the server must bind listPage to the exact node without a prefix. */
export async function reconcileNodeStorageInventory(input: {
  storageNodeId: string;
  readInventory: () => Promise<NodeStorageInventorySnapshot>;
  listPage: (options: {
    limit: 1000;
    cursor?: string;
  }) => Promise<StorageInventoryPage>;
}): Promise<NodeStorageReconciliationResult> {
  const { storageNodeId, readInventory, listPage } = input;
  if (!validNode(storageNodeId))
    throw new TypeError('Invalid node reconciliation scope');
  const result = await reconcileInventory({
    workspaceId: null,
    storageNodeId,
    readInventory,
    listPage,
  });
  return result.status === 'matched' ? { ...result, scope: 'node' } : result;
}
