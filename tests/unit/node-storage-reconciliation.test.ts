import { describe, expect, it, vi } from 'vitest';
import {
  reconcileNodeStorageInventory,
  reconcileStorageInventory,
  type NodeStorageInventorySnapshot,
  type StorageInventoryPage,
  type StorageInventorySnapshot,
} from '../../packages/domain/src/storage-reconciliation';

const firstWorkspace = '11111111-1111-4111-8111-111111111111';
const secondWorkspace = '22222222-2222-4222-8222-222222222222';
const firstKey = firstWorkspace + '/photos/a.jpg';
const secondKey = secondWorkspace + '/photos/b.jpg';
const fence = secondWorkspace + '/fence';
const system = '_kino/system/storage-policy.json';
function snapshot(
  objects: NodeStorageInventorySnapshot['objects'],
  changes: Partial<NodeStorageInventorySnapshot> = {},
): NodeStorageInventorySnapshot {
  return {
    scope: 'node',
    storageNodeId: 'primary',
    revision: 'a'.repeat(64),
    pendingWrites: false,
    objects,
    ...changes,
  };
}
function run(
  before: NodeStorageInventorySnapshot,
  pages: StorageInventoryPage[],
  after = before,
) {
  const readInventory = vi
    .fn()
    .mockResolvedValueOnce(before)
    .mockResolvedValueOnce(after);
  const listPage = vi.fn();
  for (const page of pages) listPage.mockResolvedValueOnce(page);
  return {
    result: reconcileNodeStorageInventory({
      storageNodeId: 'primary',
      readInventory,
      listPage,
    }),
    readInventory,
    listPage,
  };
}

describe('Whole-node registered-object reconciliation', () => {
  it('checks all workspaces and every declared system object with no prefix argument', async () => {
    const inventory = snapshot([
      { key: firstKey, bytes: 2 },
      { key: secondKey, bytes: 3 },
      { key: fence, bytes: 0 },
      { key: system, bytes: 4 },
    ]);
    const scan = run(inventory, [
      {
        objects: [{ key: firstKey, size: 2 }],
        truncated: true,
        cursor: 'opaque+/=',
      },
      {
        objects: [
          { key: secondKey, size: 3 },
          { key: fence, size: 0 },
          { key: system, size: 4 },
        ],
        truncated: false,
      },
    ]);
    expect(await scan.result).toEqual({
      status: 'matched',
      scope: 'node',
      storageNodeId: 'primary',
      inventoryRevision: 'a'.repeat(64),
      objectCount: 4,
      confirmedBytes: 9,
      pages: 2,
      readOnly: true,
    });
    expect(scan.listPage.mock.calls).toEqual([
      [{ limit: 1000 }],
      [{ limit: 1000, cursor: 'opaque+/=' }],
    ]);
    expect(scan.readInventory).toHaveBeenCalledTimes(2);
  });

  it('does not accept a workspace snapshot as global evidence', async () => {
    const before = {
      workspaceId: firstWorkspace,
      storageNodeId: 'primary',
      revision: 'a'.repeat(64),
      pendingWrites: false,
      objects: [],
    } as unknown as NodeStorageInventorySnapshot;
    const scan = run(before, []);
    expect(await scan.result).toMatchObject({
      status: 'blocked',
      reason: 'inventory_invalid',
    });
    expect(scan.listPage).not.toHaveBeenCalled();
  });

  it('does not accept global evidence under the workspace interface', async () => {
    const inventory = {
      ...snapshot([]),
      workspaceId: firstWorkspace,
    } as unknown as StorageInventorySnapshot;
    const listPage = vi.fn();
    const result = await reconcileStorageInventory({
      workspaceId: firstWorkspace,
      storageNodeId: 'primary',
      readInventory: async () => inventory,
      listPage,
    });
    expect(result).toMatchObject({
      status: 'blocked',
      reason: 'inventory_invalid',
    });
    expect(listPage).not.toHaveBeenCalled();
  });

  it.each([secondKey, system, 'unregistered-prefix/file.jpg'])(
    'blocks an undeclared physical object: %s',
    async (key) => {
      const scan = run(snapshot([]), [
        { objects: [{ key, size: 0 }], truncated: false },
      ]);
      expect(await scan.result).toMatchObject({
        status: 'blocked',
        reason: 'unexpected_object',
      });
    },
  );

  it('requires zero-byte immutable fences to exist rather than omitting them', async () => {
    const scan = run(
      snapshot([
        { key: firstKey, bytes: 3 },
        { key: fence, bytes: 0 },
      ]),
      [{ objects: [{ key: firstKey, size: 3 }], truncated: false }],
    );
    expect(await scan.result).toMatchObject({
      status: 'blocked',
      reason: 'missing_object',
    });
  });

  it('rejects changed cross-workspace inventory or pending writes before or after listing', async () => {
    const before = snapshot([{ key: firstKey, bytes: 3 }]);
    const pages = [{ objects: [{ key: firstKey, size: 3 }], truncated: false }];
    for (const after of [
      snapshot(before.objects, { revision: 'b'.repeat(64) }),
      snapshot(before.objects, { pendingWrites: true }),
      snapshot([{ key: secondKey, bytes: 3 }]),
    ])
      expect(await run(before, pages, after).result).toMatchObject({
        status: 'blocked',
        reason: 'inventory_changed',
      });
    const pending = run(snapshot([], { pendingWrites: true }), []);
    expect(await pending.result).toMatchObject({
      status: 'blocked',
      reason: 'pending_writes',
    });
    expect(pending.listPage).not.toHaveBeenCalled();
  });

  it('rejects wrong sizes, duplicate pages and delimiter aggregates', async () => {
    const before = snapshot([{ key: firstKey, bytes: 3 }]);
    for (const page of [
      { objects: [{ key: firstKey, size: 4 }], truncated: false },
      {
        objects: [
          { key: firstKey, size: 3 },
          { key: firstKey, size: 3 },
        ],
        truncated: false,
      },
      {
        objects: [],
        truncated: false,
        delimitedPrefixes: [firstWorkspace + '/'],
      },
    ])
      expect((await run(before, [page]).result).status).toBe('blocked');
  });

  it('retains total-byte and combined-key bounds across workspace prefixes', async () => {
    const before = snapshot([
      { key: firstKey, bytes: Number.MAX_SAFE_INTEGER },
      { key: secondKey, bytes: 1 },
    ]);
    const scan = run(before, []);
    expect(await scan.result).toMatchObject({
      status: 'blocked',
      reason: 'inventory_invalid',
    });
    expect(scan.listPage).not.toHaveBeenCalled();
  });

  it('rejects scope mismatch and invalid node identity before external IO', async () => {
    const scan = run(snapshot([], { storageNodeId: 'oracle-vm' }), []);
    expect(await scan.result).toMatchObject({
      status: 'blocked',
      reason: 'inventory_invalid',
    });
    const readInventory = vi.fn();
    const listPage = vi.fn();
    await expect(
      reconcileNodeStorageInventory({
        storageNodeId: '../primary',
        readInventory,
        listPage,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(readInventory).not.toHaveBeenCalled();
  });
});
