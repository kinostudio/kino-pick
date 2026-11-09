import { z } from 'zod';
import {
  reconcileNodeStorageInventory,
  type NodeStorageInventorySnapshot,
} from '../../../packages/domain/src/storage-reconciliation';
import { D1NodeStorageInventoryRepository } from './node-storage-inventory';
import { WorkspaceFailure } from './workspaces';

const integer = z.number().int().nonnegative().safe();
const clockSchema = z
  .object({ epoch: integer, now_ms: integer.positive() })
  .strict();
const receiptSchema = z
  .object({
    scope: z.literal('node'),
    id: z.uuid(),
    storage_node_id: z.literal('primary'),
    epoch: integer,
    inventory_revision: z.string().regex(/^[a-f0-9]{64}$/),
    object_count: integer.max(20_000),
    confirmed_bytes: integer,
    pages: integer.min(1).max(64),
    started_at_ms: integer.positive(),
    completed_at_ms: integer.positive(),
  })
  .strict();
const MAX_AGE_MS = 300_000;
type ListPage = Parameters<typeof reconcileNodeStorageInventory>[0]['listPage'];

/** Server-only durable primary-node evidence; it is not cleanup permission or activity coverage. */
export class D1NodeStorageReconciliationReceipts {
  private readonly inventory: D1NodeStorageInventoryRepository;

  constructor(
    private readonly db: D1Database,
    private readonly actor: string,
    private readonly session: string,
  ) {
    this.inventory = new D1NodeStorageInventoryRepository(db, actor, session);
  }

  private async clock() {
    try {
      const row = await this.db
        .prepare(
          "SELECT c.epoch,CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms " +
            'FROM owner_bootstrap b JOIN owners o ON o.id=1 AND o.user_id=b.user_id AND o.enabled=1 ' +
            'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
            'LEFT JOIN storage_inventory_clock c ON c.id=1 ' +
            "WHERE b.id=1 AND b.user_id=? AND s.expiresAt>unixepoch('subsec')*1000",
        )
        .bind(this.session, this.actor)
        .first();
      if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
      return clockSchema.parse(row);
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      throw new WorkspaceFailure('STORAGE_RECONCILIATION_UNAVAILABLE', 503);
    }
  }

  private async read(nodeId: string) {
    const before = await this.clock();
    const snapshot = await this.inventory.read(nodeId);
    const after = await this.clock();
    if (before.epoch !== after.epoch || after.now_ms < before.now_ms)
      throw new WorkspaceFailure('STORAGE_INVENTORY_CHANGED', 409);
    return { epoch: before.epoch, now: before.now_ms, snapshot };
  }

  async reconcile(storageNodeId: string, listPage: ListPage) {
    // Oracle's control objects are not yet registered by this source, so no global receipt can be issued.
    if (storageNodeId !== 'primary')
      throw new WorkspaceFailure('STORAGE_NODE_UNAVAILABLE', 503);
    let start: { epoch: number; now: number } | undefined;
    const result = await reconcileNodeStorageInventory({
      storageNodeId,
      listPage,
      readInventory: async () => {
        const read = await this.read(storageNodeId);
        start ??= { epoch: read.epoch, now: read.now };
        return read.snapshot satisfies NodeStorageInventorySnapshot;
      },
    });
    if (result.status === 'blocked') return result;
    if (!start) throw new Error('STORAGE_RECONCILIATION_START_MISSING');
    const id = crypto.randomUUID();
    try {
      const inserted = await this.db
        .prepare(
          'INSERT INTO node_storage_reconciliation_receipts ' +
            '(id,storage_node_id,actor_id,session_id,epoch,inventory_revision,object_count,confirmed_bytes,pages,started_at_ms) ' +
            'VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          storageNodeId,
          this.actor,
          this.session,
          start.epoch,
          result.inventoryRevision,
          result.objectCount,
          result.confirmedBytes,
          result.pages,
          start.now,
        )
        .run();
      if (inserted.success !== true)
        return { status: 'blocked', reason: 'receipt_unavailable' } as const;
      const receipt = await this.current(storageNodeId, id);
      if (!receipt)
        return { status: 'blocked', reason: 'receipt_changed' } as const;
      return { status: 'recorded', receipt, deletesData: false } as const;
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      return { status: 'blocked', reason: 'receipt_unavailable' } as const;
    }
  }

  async current(storageNodeId: string, id: string) {
    z.literal('primary').parse(storageNodeId);
    z.uuid().parse(id);
    const source = await this.read(storageNodeId);
    const raw = await this.db
      .prepare(
        "SELECT 'node' AS scope,id,storage_node_id,epoch,inventory_revision,object_count,confirmed_bytes,pages,started_at_ms,completed_at_ms " +
          'FROM node_storage_reconciliation_receipts WHERE id=? AND storage_node_id=?',
      )
      .bind(id, storageNodeId)
      .first();
    if (!raw) return null;
    const receipt = receiptSchema.parse(raw);
    const after = await this.clock();
    const bytes = source.snapshot.objects.reduce(
      (sum, object) => sum + object.bytes,
      0,
    );
    if (
      source.snapshot.pendingWrites ||
      receipt.epoch !== source.epoch ||
      receipt.inventory_revision !== source.snapshot.revision ||
      receipt.object_count !== source.snapshot.objects.length ||
      receipt.confirmed_bytes !== bytes ||
      receipt.object_count > receipt.pages * 1000 ||
      after.epoch !== source.epoch ||
      receipt.started_at_ms > receipt.completed_at_ms ||
      receipt.completed_at_ms > after.now_ms ||
      after.now_ms < source.now ||
      after.now_ms - receipt.started_at_ms > MAX_AGE_MS
    )
      return null;
    return receipt;
  }
}
