import { z } from 'zod';
import {
  ORACLE_STORAGE_BUCKET,
  ORACLE_STORAGE_ENDPOINT,
  S3StorageBucket,
} from './s3-storage-bucket';
import {
  oracleStorageCredentials,
  type PrivateStorageEnv,
} from './private-storage';
import { D1StorageReconciliationReceipts } from './storage-reconciliation-receipts';
import { WorkspaceFailure } from './workspaces';
import { D1NodeStorageInventoryRepository } from './node-storage-inventory';
import { D1NodeStorageReconciliationReceipts } from './node-storage-reconciliation-receipts';
import { reconcileNodeStorageInventory } from '../../../packages/domain/src/storage-reconciliation';

const nodeSchema = z.object({
  provider: z.enum(['r2', 's3']),
  account_id: z.string().min(1),
  bucket_name: z.string(),
  endpoint: z.string().nullable(),
  credential_ref: z.string(),
  status: z.enum(['active', 'readonly']),
});

/** Server-only entry point; listing targets come from guarded D1 identities and bindings. */
export async function reconcileWorkspaceStorage(
  db: D1Database,
  environment: PrivateStorageEnv,
  actor: string,
  session: string,
  workspaceId: string,
  storageNodeId: string,
) {
  const workspace = z.uuid().parse(workspaceId).toLowerCase();
  const nodeId = z.enum(['primary', 'oracle-vm']).parse(storageNodeId);
  const env = { ...environment };
  let listPage:
    Parameters<D1StorageReconciliationReceipts['reconcile']>[2] | undefined;
  return new D1StorageReconciliationReceipts(db, actor, session).reconcile(
    workspace,
    nodeId,
    async (options) => {
      if (options.prefix !== workspace + '/')
        throw new WorkspaceFailure('STORAGE_NODE_UNAVAILABLE', 503);
      if (listPage) return listPage(options);
      // Resolve after the first fenced inventory read, not before its epoch is captured.
      const node = nodeSchema.parse(
        await db
          .prepare(
            'SELECT n.provider,n.account_id,n.bucket_name,n.endpoint,n.credential_ref,n.status ' +
              'FROM storage_nodes n JOIN workspaces w ON w.id=? ' +
              'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 ' +
              'JOIN owner_sessions s ON s.userId=o.user_id ' +
              "WHERE n.id=? AND o.user_id=? AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
          )
          .bind(workspace, nodeId, actor, session)
          .first(),
      );
      if (nodeId === 'primary') {
        if (
          node.provider !== 'r2' ||
          node.account_id !== 'binding-account' ||
          node.bucket_name !== 'PRIMARY_STORAGE' ||
          node.credential_ref !== 'binding:PRIMARY_STORAGE' ||
          node.endpoint !== null
        )
          throw new WorkspaceFailure('STORAGE_NODE_UNAVAILABLE', 503);
        // The real R2 account/bucket behind this named binding is verified by deployment gates.
        listPage = (request) => env.PRIMARY_STORAGE.list(request);
        return listPage(options);
      }
      if (
        node.provider !== 's3' ||
        node.endpoint !== ORACLE_STORAGE_ENDPOINT ||
        node.bucket_name !== ORACLE_STORAGE_BUCKET ||
        node.credential_ref !== 'env:ORACLE_STORAGE'
      )
        throw new WorkspaceFailure('STORAGE_NODE_UNAVAILABLE', 503);
      const storage = new S3StorageBucket(oracleStorageCredentials(env));
      listPage = (request) => storage.list(request);
      return listPage(options);
    },
  );
}

/** Internal platform-Owner scan. A match is not a persisted receipt or cleanup grant. */
export async function reconcilePrimaryStorageNode(
  db: D1Database,
  environment: Pick<PrivateStorageEnv, 'PRIMARY_STORAGE'>,
  actor: string,
  session: string,
) {
  const bucket = environment.PRIMARY_STORAGE;
  const inventory = new D1NodeStorageInventoryRepository(db, actor, session);
  return reconcileNodeStorageInventory({
    storageNodeId: 'primary',
    readInventory: () => inventory.read('primary'),
    listPage: (options) => bucket.list(options),
  });
}

/** Writes primary-node evidence only after a trusted whole-bucket scan. */
export async function recordPrimaryStorageReconciliation(
  db: D1Database,
  environment: Pick<PrivateStorageEnv, 'PRIMARY_STORAGE'>,
  actor: string,
  session: string,
) {
  const bucket = environment.PRIMARY_STORAGE;
  return new D1NodeStorageReconciliationReceipts(db, actor, session).reconcile(
    'primary',
    (options) => bucket.list(options),
  );
}
