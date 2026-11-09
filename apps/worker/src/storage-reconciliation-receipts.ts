import { z } from 'zod';
import {
  reconcileStorageInventory,
  type StorageInventorySnapshot,
} from '../../../packages/domain/src/storage-reconciliation';
import { D1StorageInventoryRepository } from './storage-inventory';
import { WorkspaceFailure } from './workspaces';

const integer = z.number().int().nonnegative().safe();
const clockSchema = z.object({ epoch: integer, now_ms: integer.positive() });
const receiptSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  storage_node_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  epoch: integer,
  inventory_revision: z.string().regex(/^[a-f0-9]{64}$/),
  object_count: integer.max(20_000),
  confirmed_bytes: integer,
  pages: integer.min(1).max(64),
  started_at_ms: integer.positive(),
  completed_at_ms: integer.positive(),
});
type Receipt = z.infer<typeof receiptSchema>;
type ListPage = Parameters<typeof reconcileStorageInventory>[0]['listPage'];
const MAX_AGE_MS = 300_000;

async function fencedRevision(epoch: number, revision: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([epoch, revision])),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** Internal server writer. Requires proposal0070; no HTTP endpoint or deletion grant. */
export class D1StorageReconciliationReceipts {
  private readonly inventory: D1StorageInventoryRepository;

  constructor(
    private readonly db: D1Database,
    private readonly actor: string,
    private readonly session: string,
  ) {
    this.inventory = new D1StorageInventoryRepository(db, actor, session);
  }

  private async clock() {
    try {
      const row = await this.db
        .prepare(
          "SELECT c.epoch,CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms " +
            'FROM owners o JOIN owner_sessions s ON s.userId=o.user_id ' +
            'LEFT JOIN storage_inventory_clock c ON c.id=1 ' +
            "WHERE o.user_id=? AND o.enabled=1 AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
        )
        .bind(this.actor, this.session)
        .first();
      if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
      return clockSchema.parse(row);
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      throw new WorkspaceFailure('STORAGE_RECONCILIATION_UNAVAILABLE', 503);
    }
  }

  private async read(workspaceId: string, storageNodeId: string) {
    const before = await this.clock();
    const snapshot = await this.inventory.read(workspaceId, storageNodeId);
    const revision = await fencedRevision(before.epoch, snapshot.revision);
    const after = await this.clock();
    if (before.epoch !== after.epoch || after.now_ms < before.now_ms)
      throw new WorkspaceFailure('STORAGE_INVENTORY_CHANGED', 409);
    return {
      epoch: before.epoch,
      now: before.now_ms,
      snapshot: { ...snapshot, revision } satisfies StorageInventorySnapshot,
    };
  }

  async reconcile(
    workspaceId: string,
    storageNodeId: string,
    listPage: ListPage,
  ) {
    let start: { epoch: number; now: number } | undefined;
    const result = await reconcileStorageInventory({
      workspaceId,
      storageNodeId,
      listPage,
      readInventory: async () => {
        const read = await this.read(workspaceId, storageNodeId);
        start ??= { epoch: read.epoch, now: read.now };
        return read.snapshot;
      },
    });
    if (result.status === 'blocked') return result;
    if (!start) throw new Error('STORAGE_RECONCILIATION_START_MISSING');
    const id = crypto.randomUUID();
    try {
      // The SQL guard repeats scope, pending-write, age and epoch checks atomically.
      await this.db
        .prepare(
          'INSERT INTO storage_reconciliation_receipts ' +
            '(id,workspace_id,storage_node_id,actor_id,session_id,epoch,inventory_revision,object_count,confirmed_bytes,pages,started_at_ms) ' +
            'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          workspaceId,
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
      const receipt = await this.current(workspaceId, storageNodeId, id);
      if (!receipt)
        return { status: 'blocked', reason: 'receipt_changed' } as const;
      return { status: 'recorded', receipt, deletesData: false } as const;
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      return { status: 'blocked', reason: 'receipt_unavailable' } as const;
    }
  }

  async current(workspaceId: string, storageNodeId: string, id: string) {
    z.uuid().parse(id);
    // A receipt never preserves access after an Owner/session/scope change.
    const source = await this.read(workspaceId, storageNodeId);
    const raw = await this.db
      .prepare(
        'SELECT id,workspace_id,storage_node_id,epoch,inventory_revision,object_count,confirmed_bytes,pages,started_at_ms,completed_at_ms ' +
          'FROM storage_reconciliation_receipts WHERE id=? AND workspace_id=? AND storage_node_id=?',
      )
      .bind(id, workspaceId, storageNodeId)
      .first();
    if (!raw) return null;
    const receipt: Receipt = receiptSchema.parse(raw);
    const after = await this.clock();
    if (
      source.snapshot.pendingWrites ||
      receipt.epoch !== source.epoch ||
      receipt.inventory_revision !== source.snapshot.revision ||
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
