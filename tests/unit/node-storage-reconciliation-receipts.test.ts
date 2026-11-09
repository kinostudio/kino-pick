import { afterEach, describe, expect, it, vi } from 'vitest';
import { D1NodeStorageInventoryRepository } from '../../apps/worker/src/node-storage-inventory';
import { D1NodeStorageReconciliationReceipts } from '../../apps/worker/src/node-storage-reconciliation-receipts';
import type { NodeStorageInventorySnapshot } from '../../packages/domain/src/storage-reconciliation';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = '11111111-1111-4111-8111-111111111111/project/album/photo.jpg';
function fixture() {
  const state = {
    epoch: 1,
    now: 100_000_000,
    authorized: true,
    pending: false,
    stored: undefined as Record<string, unknown> | undefined,
  };
  const insert = vi.fn((values: unknown[]) => {
    const [
      receiptId,
      node,
      actor,
      session,
      epoch,
      revision,
      count,
      bytes,
      pages,
      started,
    ] = values;
    if (actor !== 'synthetic-owner' || session !== 'opaque-session-id')
      throw new Error('synthetic owner scope guard');
    if (epoch !== state.epoch || state.now - Number(started) > 300_000)
      throw new Error('synthetic SQL guard');
    state.stored = {
      scope: 'node',
      id: receiptId,
      storage_node_id: node,
      epoch,
      inventory_revision: revision,
      object_count: count,
      confirmed_bytes: bytes,
      pages,
      started_at_ms: started,
      completed_at_ms: state.now,
    };
    return { success: true };
  });
  const db = {
    prepare: vi.fn((sql: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: (...input: unknown[]) => {
          values = input;
          return statement;
        },
        first: async () => {
          if (sql.includes('SELECT c.epoch'))
            return state.authorized
              ? { epoch: state.epoch, now_ms: state.now }
              : null;
          if (sql.includes('FROM node_storage_reconciliation_receipts'))
            return state.stored &&
              state.stored.id === values[0] &&
              state.stored.storage_node_id === values[1]
              ? { ...state.stored }
              : null;
          throw new Error('unexpected synthetic query');
        },
        run: async () => insert(values),
      };
      return statement;
    }),
  } as unknown as D1Database;
  const inventory = vi
    .spyOn(D1NodeStorageInventoryRepository.prototype, 'read')
    .mockImplementation(
      async () =>
        ({
          scope: 'node',
          storageNodeId: 'primary',
          revision: (state.epoch === 1 ? 'a' : 'b').repeat(64),
          pendingWrites: state.pending,
          objects: [{ key, bytes: 3 }],
        }) satisfies NodeStorageInventorySnapshot,
    );
  const service = new D1NodeStorageReconciliationReceipts(
    db,
    'synthetic-owner',
    'opaque-session-id',
  );
  const listPage = vi
    .fn()
    .mockResolvedValue({ objects: [{ key, size: 3 }], truncated: false });
  return { state, insert, inventory, service, listPage, db };
}

afterEach(() => vi.restoreAllMocks());

describe('Durable whole-node reconciliation receipts', () => {
  it('records a global receipt and rechecks it without returning object keys', async () => {
    const f = fixture();
    const result = await f.service.reconcile('primary', f.listPage);
    expect(result.status).toBe('recorded');
    if (result.status !== 'recorded') throw new Error('receipt missing');
    expect(result.receipt).toMatchObject({
      scope: 'node',
      storage_node_id: 'primary',
      object_count: 1,
      confirmed_bytes: 3,
      pages: 1,
      started_at_ms: 100_000_000,
    });
    expect(result.deletesData).toBe(false);
    expect(JSON.stringify(result)).not.toContain(key);
    expect(await f.service.current('primary', result.receipt.id)).toEqual(
      result.receipt,
    );
    expect(f.insert).toHaveBeenCalledOnce();
  });

  it('does not record a filtered or mismatching physical list', async () => {
    const f = fixture();
    f.listPage.mockResolvedValue({
      objects: [{ key: 'unregistered/object', size: 3 }],
      truncated: false,
    });
    expect(await f.service.reconcile('primary', f.listPage)).toMatchObject({
      status: 'blocked',
      reason: 'unexpected_object',
    });
    expect(f.insert).not.toHaveBeenCalled();
  });

  it('does not report success when the write result is unconfirmed', async () => {
    const f = fixture();
    f.insert.mockReturnValue({ success: false });
    expect(await f.service.reconcile('primary', f.listPage)).toMatchObject({
      status: 'blocked',
      reason: 'receipt_unavailable',
    });
  });

  it('cannot refresh the scan start after spending longer than five minutes listing', async () => {
    const f = fixture();
    f.listPage.mockImplementation(async () => {
      f.state.now += 300_001;
      return { objects: [{ key, size: 3 }], truncated: false };
    });
    expect(await f.service.reconcile('primary', f.listPage)).toMatchObject({
      status: 'blocked',
      reason: 'receipt_unavailable',
    });
    expect(f.insert.mock.calls[0]?.[0][9]).toBe(100_000_000);
  });

  it('expires from start, including the exact five-minute boundary', async () => {
    const f = fixture();
    const result = await f.service.reconcile('primary', f.listPage);
    if (result.status !== 'recorded') throw new Error('receipt missing');
    f.state.now += 300_000;
    expect(
      await f.service.current('primary', result.receipt.id),
    ).not.toBeNull();
    f.state.now += 1;
    expect(await f.service.current('primary', result.receipt.id)).toBeNull();
  });

  it('rejects changed epochs and pending writes after issuance', async () => {
    const f = fixture();
    const result = await f.service.reconcile('primary', f.listPage);
    if (result.status !== 'recorded') throw new Error('receipt missing');
    f.state.epoch++;
    expect(await f.service.current('primary', result.receipt.id)).toBeNull();
    f.state.epoch--;
    f.state.pending = true;
    expect(await f.service.current('primary', result.receipt.id)).toBeNull();
  });

  it('reauthorizes after issuance and never restores access from the receipt', async () => {
    const f = fixture();
    const result = await f.service.reconcile('primary', f.listPage);
    if (result.status !== 'recorded') throw new Error('receipt missing');
    f.state.authorized = false;
    await expect(
      f.service.current('primary', result.receipt.id),
    ).rejects.toMatchObject({ code: 'OWNER_REQUIRED', status: 403 });
  });

  it('cannot accept a workspace receipt identifier as a node receipt', async () => {
    const f = fixture();
    expect(await f.service.current('primary', id)).toBeNull();
    expect(f.insert).not.toHaveBeenCalled();
  });

  it('refuses Oracle until its system objects have a trusted catalog', async () => {
    const f = fixture();
    await expect(
      f.service.reconcile('oracle-vm', f.listPage),
    ).rejects.toMatchObject({ code: 'STORAGE_NODE_UNAVAILABLE', status: 503 });
    expect(f.inventory).not.toHaveBeenCalled();
    expect(f.listPage).not.toHaveBeenCalled();
    expect(f.insert).not.toHaveBeenCalled();
  });
});
