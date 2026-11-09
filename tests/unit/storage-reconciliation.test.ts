import { describe, expect, it, vi } from 'vitest';
import {
  reconcileStorageInventory,
  type StorageInventoryPage,
  type StorageInventorySnapshot,
} from '../../packages/domain/src/storage-reconciliation';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const storageNodeId = 'primary';
const revision = 'a'.repeat(64);
const nextRevision = 'b'.repeat(64);
const keyA = workspaceId + '/photos/a.jpg';
const keyB = workspaceId + '/photos/b.jpg';
const foreignKey = '22222222-2222-4222-8222-222222222222/photos/a.jpg';

function object(key: string, bytes: number) {
  return { key, bytes };
}

function snapshot(
  objects: StorageInventorySnapshot['objects'],
  overrides: Partial<StorageInventorySnapshot> = {},
): StorageInventorySnapshot {
  return {
    workspaceId,
    storageNodeId,
    revision,
    pendingWrites: false,
    objects,
    ...overrides,
  };
}

function malformedSnapshot(overrides: Record<string, unknown>) {
  return {
    ...snapshot([]),
    ...overrides,
  } as unknown as StorageInventorySnapshot;
}

function page(
  objects: StorageInventoryPage['objects'],
  truncated = false,
  cursor?: string,
): StorageInventoryPage {
  return { objects, truncated, ...(cursor === undefined ? {} : { cursor }) };
}

const blocked = (reason: string) => ({
  status: 'blocked',
  reason,
  readOnly: true,
});

describe('read-only storage inventory reconciliation', () => {
  it('rejects an input with a missing storage node before reading', async () => {
    let readCalls = 0;
    let listCalls = 0;
    const input: unknown = {
      workspaceId,
      readInventory: async () => {
        readCalls++;
        return snapshot([]);
      },
      listPage: async () => {
        listCalls++;
        return page([]);
      },
    };

    await expect(
      reconcileStorageInventory(
        input as Parameters<typeof reconcileStorageInventory>[0],
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(readCalls).toBe(0);
    expect(listCalls).toBe(0);
  });

  it.each([
    ['array workspace ID', malformedSnapshot({ workspaceId: [workspaceId] })],
    ['array revision', malformedSnapshot({ revision: [revision] })],
  ])('rejects non-string snapshot fields: %s', async (_name, value) => {
    let listCalls = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => value,
      listPage: async () => {
        listCalls++;
        return page([]);
      },
    });

    expect(result).toEqual(blocked('inventory_invalid'));
    expect(listCalls).toBe(0);
  });

  it('does not let input scope mutation change the scan target', async () => {
    const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
    const input: Parameters<typeof reconcileStorageInventory>[0] = {
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([object(keyA, 10)]),
      listPage: async (options) => {
        expect(options.prefix).toBe(workspaceId + '/');
        input.workspaceId = otherWorkspaceId;
        input.storageNodeId = 'archive';
        return page([{ key: keyA, size: 10 }]);
      },
    };

    const result = await reconcileStorageInventory(input);

    expect(
      result.status !== 'matched' ||
        (result.workspaceId === workspaceId &&
          result.storageNodeId === storageNodeId),
    ).toBe(true);
  });

  it('rejects an oversized expected key before UTF-8 encoding it', async () => {
    const longKey = workspaceId + '/' + 'x'.repeat(1025);
    const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');
    let result: Awaited<ReturnType<typeof reconcileStorageInventory>>;
    try {
      result = await reconcileStorageInventory({
        workspaceId,
        storageNodeId,
        readInventory: async () => snapshot([object(longKey, 10)]),
        listPage: async () => page([]),
      });
      expect(encodeSpy).not.toHaveBeenCalledWith(longKey);
    } finally {
      encodeSpy.mockRestore();
    }

    expect(result).toEqual(blocked('inventory_invalid'));
  });

  it('matches a stable two-page inventory and returns no object keys', async () => {
    const expected = [object(keyA, 10), object(keyB, 25)];
    let reads = 0;
    const requests: Array<{
      prefix: string;
      limit: 1000;
      cursor?: string;
    }> = [];
    const pages = [
      page([{ key: keyA, size: 10 }], true, 'next-page'),
      page([{ key: keyB, size: 25 }]),
    ];
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => {
        reads++;
        return snapshot(expected);
      },
      listPage: async (options) => {
        requests.push(options);
        const next = pages[requests.length - 1];
        if (!next) throw new Error('unexpected page request');
        return next;
      },
    });

    expect(result).toEqual({
      status: 'matched',
      workspaceId,
      storageNodeId,
      inventoryRevision: revision,
      objectCount: 2,
      confirmedBytes: 35,
      pages: 2,
      readOnly: true,
    });
    expect(reads).toBe(2);
    expect(requests).toEqual([
      { prefix: workspaceId + '/', limit: 1000 },
      { prefix: workspaceId + '/', limit: 1000, cursor: 'next-page' },
    ]);
    expect(JSON.stringify(result)).not.toContain(keyA);
    expect(JSON.stringify(result)).not.toContain(keyB);
  });

  it('blocks before listing while writes are pending', async () => {
    let listCalls = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () =>
        snapshot([object(keyA, 10)], { pendingWrites: true }),
      listPage: async () => {
        listCalls++;
        return page([{ key: keyA, size: 10 }]);
      },
    });

    expect(result).toEqual(blocked('pending_writes'));
    expect(listCalls).toBe(0);
  });

  it.each([
    [
      'foreign workspace',
      snapshot([], { workspaceId: '22222222-2222-4222-8222-222222222222' }),
    ],
    ['foreign storage node', snapshot([], { storageNodeId: 'archive' })],
  ])(
    'rejects a snapshot bound to a different scope: %s',
    async (_name, value) => {
      let listCalls = 0;
      const result = await reconcileStorageInventory({
        workspaceId,
        storageNodeId,
        readInventory: async () => value,
        listPage: async () => {
          listCalls++;
          return page([]);
        },
      });

      expect(result).toEqual(blocked('inventory_invalid'));
      expect(listCalls).toBe(0);
    },
  );

  it.each([
    [
      'revision changed',
      snapshot([object(keyA, 10)], { revision: nextRevision }),
    ],
    ['rows changed', snapshot([object(keyA, 10), object(keyB, 25)])],
    [
      'pending flag changed',
      snapshot([object(keyA, 10)], { pendingWrites: true }),
    ],
  ])('rejects a source change after scanning: %s', async (_name, after) => {
    let reads = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => {
        reads++;
        return reads === 1 ? snapshot([object(keyA, 10)]) : after;
      },
      listPage: async () => page([{ key: keyA, size: 10 }]),
    });

    expect(result).toEqual(blocked('inventory_changed'));
    expect(reads).toBe(2);
  });

  it.each([
    ['foreign expected prefix', [object(foreignKey, 10)]],
    ['duplicate expected key', [object(keyA, 10), object(keyA, 10)]],
    ['unsafe expected size', [object(keyA, Number.MAX_SAFE_INTEGER + 1)]],
    [
      'byte sum overflow',
      [
        object(keyA, Number.MAX_SAFE_INTEGER),
        object(keyB, Number.MAX_SAFE_INTEGER),
      ],
    ],
  ])('rejects invalid source inventory: %s', async (_name, objects) => {
    let listCalls = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot(objects),
      listPage: async () => {
        listCalls++;
        return page([]);
      },
    });

    expect(result).toEqual(blocked('inventory_invalid'));
    expect(listCalls).toBe(0);
  });

  it.each([
    [
      'workspace changed',
      snapshot([object(keyA, 10)], {
        workspaceId: '22222222-2222-4222-8222-222222222222',
      }),
    ],
    [
      'storage node changed',
      snapshot([object(keyA, 10)], { storageNodeId: 'archive' }),
    ],
  ])(
    'rejects a final snapshot with changed scope: %s',
    async (_name, after) => {
      let reads = 0;
      const result = await reconcileStorageInventory({
        workspaceId,
        storageNodeId,
        readInventory: async () => {
          reads++;
          return reads === 1 ? snapshot([object(keyA, 10)]) : after;
        },
        listPage: async () => page([{ key: keyA, size: 10 }]),
      });

      expect(result).toEqual(blocked('inventory_invalid'));
      expect(reads).toBe(2);
    },
  );

  it.each([
    ['missing object', page([]), 'missing_object'],
    ['unexpected object', page([{ key: keyB, size: 10 }]), 'unexpected_object'],
    ['size mismatch', page([{ key: keyA, size: 11 }]), 'size_mismatch'],
    [
      'duplicate listed object',
      page([
        { key: keyA, size: 10 },
        { key: keyA, size: 10 },
      ]),
      'listing_invalid',
    ],
    [
      'foreign listed prefix',
      page([{ key: foreignKey, size: 10 }]),
      'listing_invalid',
    ],
    [
      'unsafe listed size',
      page([{ key: keyA, size: Number.MAX_SAFE_INTEGER + 1 }]),
      'listing_invalid',
    ],
  ])('blocks on %s', async (_name, listed, reason) => {
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([object(keyA, 10)]),
      listPage: async () => listed,
    });

    expect(result).toEqual(blocked(reason));
  });

  it('rejects hidden delimited prefixes even with an empty inventory', async () => {
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([]),
      listPage: async () => ({
        ...page([]),
        delimitedPrefixes: [workspaceId + '/photos/'],
      }),
    });

    expect(result).toEqual(blocked('listing_invalid'));
  });

  it('rejects malformed delimited-prefix metadata', async () => {
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([]),
      listPage: async () =>
        ({
          ...page([]),
          delimitedPrefixes: 'not-an-array',
        }) as unknown as StorageInventoryPage,
    });

    expect(result).toEqual(blocked('listing_invalid'));
  });

  it('matches a flat listing when delimited prefixes are empty', async () => {
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([object(keyA, 10)]),
      listPage: async () => ({
        ...page([{ key: keyA, size: 10 }]),
        delimitedPrefixes: [],
      }),
    });

    expect(result).toMatchObject({
      status: 'matched',
      objectCount: 1,
      confirmedBytes: 10,
      pages: 1,
      readOnly: true,
    });
  });

  it.each([
    ['null page', null],
    ['missing objects', { truncated: false }],
    ['non-array objects', { objects: 'bad', truncated: false }],
    [
      'more than page limit',
      {
        objects: Array.from({ length: 1001 }, () => ({ key: keyA, size: 1 })),
        truncated: false,
      },
    ],
    ['invalid truncated flag', { objects: [], truncated: 'false' }],
    ['missing cursor', { objects: [], truncated: true }],
    ['empty cursor', { objects: [], truncated: true, cursor: '' }],
    [
      'oversized cursor',
      { objects: [], truncated: true, cursor: 'x'.repeat(4097) },
    ],
  ])('rejects malformed page data: %s', async (_name, malformed) => {
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([]),
      listPage: async () => malformed as StorageInventoryPage,
    });

    expect(result).toEqual(blocked('listing_invalid'));
  });

  it('rejects a repeated page cursor', async () => {
    let listCalls = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([]),
      listPage: async () => {
        listCalls++;
        return page([], true, 'same-cursor');
      },
    });

    expect(result).toEqual(blocked('listing_invalid'));
    expect(listCalls).toBe(2);
  });

  it('stops after 64 empty advancing pages', async () => {
    let listCalls = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([]),
      listPage: async () => {
        listCalls++;
        return page([], true, 'cursor-' + listCalls);
      },
    });

    expect(result).toEqual(blocked('scan_limit'));
    expect(listCalls).toBe(64);
  });

  it.each([
    ['initial inventory read', 'inventory_unavailable', 0],
    ['page listing', 'listing_unavailable', 1],
    ['final inventory read', 'inventory_unavailable', 1],
  ])('fails safely when %s fails', async (failure, reason, expectedLists) => {
    const secret = 'credential-do-not-return';
    let reads = 0;
    let listCalls = 0;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => {
        reads++;
        if (
          (failure === 'initial inventory read' && reads === 1) ||
          (failure === 'final inventory read' && reads === 2)
        )
          throw new Error(secret);
        return snapshot([object(keyA, 10)]);
      },
      listPage: async () => {
        listCalls++;
        if (failure === 'page listing') throw new Error(secret);
        return page([{ key: keyA, size: 10 }]);
      },
    });

    expect(result).toEqual(blocked(reason));
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(listCalls).toBe(expectedLists);
  });

  it('matches an empty inventory as a read-only capacity result', async () => {
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      readInventory: async () => snapshot([]),
      listPage: async () => page([]),
    });

    expect(result).toEqual({
      status: 'matched',
      workspaceId,
      storageNodeId,
      inventoryRevision: revision,
      objectCount: 0,
      confirmedBytes: 0,
      pages: 1,
      readOnly: true,
    });
    expect(result).not.toHaveProperty('cleanupEligible');
  });
});
