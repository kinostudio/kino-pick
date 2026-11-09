import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'vitest';
import {
  reconcileStorageInventory,
  type StorageInventoryPage,
} from '../../packages/domain/src/storage-reconciliation';
import { D1ContentRepository } from '../../apps/worker/src/content';
import { D1ManualAlbumDeletion } from '../../apps/worker/src/manual-album-deletion';
import { R2StorageAdapter } from '../../apps/worker/src/r2-storage';
import { D1StorageInventoryRepository } from '../../apps/worker/src/storage-inventory';
import { D1StorageReconciliationReceipts } from '../../apps/worker/src/storage-reconciliation-receipts';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';

type NativeStatement = {
  bind(...values: (number | string | null | Uint8Array)[]): NativeStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};
type NativeD1 = {
  batch(statements: NativeStatement[]): Promise<unknown>;
  prepare(sql: string): NativeStatement;
};
type NativeR2Page = {
  objects: Array<{ key: string; size: number }>;
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
};
type NativeR2Head = {
  size: number;
  etag: string;
  checksums: { sha256?: ArrayBuffer };
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};
type NativeR2Bucket = {
  put(
    key: string,
    value: Uint8Array,
    options?: {
      sha256?: string;
      httpMetadata?: { contentType: string };
      customMetadata?: Record<string, string>;
      onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string };
    },
  ): Promise<unknown>;
  head(key: string): Promise<NativeR2Head | null>;
  list(options: {
    prefix: string;
    limit: number;
    cursor?: string;
  }): Promise<NativeR2Page>;
};
type NativeMiniflare = {
  getD1Database(binding: string, workerName: string): Promise<NativeD1>;
  getR2Bucket(binding: string, workerName: string): Promise<NativeR2Bucket>;
  dispose(): Promise<void>;
};

const workerRequire = createRequire(resolve('apps/worker/package.json'));
const { Miniflare, convertV4MiniflareOptions } = workerRequire('miniflare') as {
  Miniflare: new (options: unknown) => NativeMiniflare;
  convertV4MiniflareOptions: (options: unknown) => unknown;
};
const { unstable_splitSqlQuery } = workerRequire('wrangler') as {
  unstable_splitSqlQuery: (sql: string) => string[];
};

const workerName = 'storage-inventory-native';
const GB = 1_000_000_000;

test('D1 storage inventory matches native R2 before and after retained-asset reclamation', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: workerName,
          modules: true,
          script:
            "export default { async fetch() { return new Response('ok'); } };",
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: workerName },
          r2Buckets: { BUCKET: workerName },
        },
      ],
    }),
  );

  try {
    const db = await mf.getD1Database('DB', workerName);
    const bucket = await mf.getR2Bucket('BUCKET', workerName);
    const files = (await readdir(resolve('apps/worker/migrations')))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    assert.equal(files.length, 69, 'fixture applies the complete schema');
    assert.equal(files.at(-1), '0069_inherited_share_expiry.sql');

    const apply = async (file: string) =>
      db.batch(
        unstable_splitSqlQuery(
          await readFile(resolve('apps/worker/migrations', file), 'utf8'),
        ).map((sql) => db.prepare(sql)),
      );

    for (const file of files.filter((file) => file < '0037')) await apply(file);

    const actor = randomUUID();
    const ownerSession = randomUUID();
    const expiredSession = randomUUID();
    const workspaceId = randomUUID();
    const nodeIsolationWorkspaceId = randomUUID();
    const foreignUserId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const now = Date.now();

    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
      )
      .bind(actor, randomUUID())
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(ownerSession, randomUUID(), actor, now + 3_600_000, now, now)
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        expiredSession,
        randomUUID(),
        actor,
        now - 60_000,
        now - 120_000,
        now - 120_000,
      )
      .run();

    const createWorkspace = async (id: string, name: string) =>
      db
        .prepare(
          'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
        )
        .bind(actor, randomUUID(), ownerSession, name, id)
        .run();
    await createWorkspace(workspaceId, 'Storage inventory primary');
    await createWorkspace(
      nodeIsolationWorkspaceId,
      'Storage inventory node isolation',
    );

    await db
      .prepare(
        'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(
        foreignUserId,
        'Foreign fixture user',
        `foreign-${foreignUserId}@fixture.invalid`,
        now,
        now,
      )
      .run();
    await db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(foreignWorkspaceId, 'Foreign fixture workspace', foreignUserId)
      .run();

    const dbBinding = db as unknown as ConstructorParameters<
      typeof D1ContentRepository
    >[0];
    const content = new D1ContentRepository(dbBinding, actor, ownerSession);
    const project = await content.createProject({
      workspaceId,
      name: 'Primary storage fixture',
      requestId: randomUUID(),
    });
    const album = await content.createAlbum(project.id, {
      name: 'Reclaimed primary assets',
      requestId: randomUUID(),
    });
    const isolationProject = await content.createProject({
      workspaceId: nodeIsolationWorkspaceId,
      name: 'Oracle node fixture',
      requestId: randomUUID(),
    });
    const isolationAlbum = await content.createAlbum(isolationProject.id, {
      name: 'Oracle only',
      requestId: randomUUID(),
    });

    const photoId = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(photoId, workspaceId, project.id, album.id, 'source.jpg')
      .run();
    const oraclePhotoId = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(
        oraclePhotoId,
        nodeIsolationWorkspaceId,
        isolationProject.id,
        isolationAlbum.id,
        'oracle-only.jpg',
      )
      .run();
    type PhysicalAsset = {
      key: string;
      bytes: Uint8Array;
      assetId: string;
    };
    const primaryAssets: PhysicalAsset[] = [];
    let primaryBytes = 0;

    // Keep the established historical fixture setup before schema 37: real R2
    // payloads plus valid processing leases/results create all six asset rows.
    for (let versionNo = 1; versionNo <= 2; versionNo++) {
      const versionId = randomUUID();
      const originalAssetId = randomUUID();
      const originalBytes = new Uint8Array(2048).fill(versionNo);
      const originalHash = createHash('sha256')
        .update(originalBytes)
        .digest('hex');
      await db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,?,?,?,?,'image/jpeg',1,1,'private')",
        )
        .bind(
          versionId,
          workspaceId,
          photoId,
          versionNo,
          actor,
          originalHash,
          originalBytes.byteLength,
        )
        .run();
      const originalKey = `${workspaceId}/${project.id}/${album.id}/${originalAssetId}/original`;
      await bucket.put(originalKey, originalBytes, {
        sha256: originalHash,
        httpMetadata: { contentType: 'image/jpeg' },
      });
      await db
        .prepare(
          "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'primary','original',?,?,'image/jpeg',?,'private')",
        )
        .bind(
          originalAssetId,
          workspaceId,
          photoId,
          versionId,
          originalKey,
          originalBytes.byteLength,
          originalHash,
        )
        .run();
      primaryAssets.push({
        key: originalKey,
        bytes: originalBytes,
        assetId: originalAssetId,
      });
      primaryBytes += originalBytes.byteLength;

      const outputs = await db
        .prepare(
          'SELECT kind,asset_id,object_key FROM image_processing_outputs WHERE job_id=? ORDER BY kind',
        )
        .bind(originalAssetId)
        .all<{ kind: string; asset_id: string; object_key: string }>();
      const processingResult: Array<{
        kind: string;
        bytes: number;
        mime: string;
        sha256: string;
        width: number;
        height: number;
      }> = [];
      for (const output of outputs.results) {
        const derivativeBytes = new Uint8Array(
          1024 + primaryAssets.length * 257,
        ).fill(primaryAssets.length + 1);
        const derivativeHash = createHash('sha256')
          .update(derivativeBytes)
          .digest('hex');
        await bucket.put(output.object_key, derivativeBytes, {
          sha256: derivativeHash,
          httpMetadata: { contentType: 'image/jpeg' },
        });
        primaryAssets.push({
          key: output.object_key,
          bytes: derivativeBytes,
          assetId: output.asset_id,
        });
        primaryBytes += derivativeBytes.byteLength;
        processingResult.push({
          kind: output.kind,
          bytes: derivativeBytes.byteLength,
          mime: 'image/jpeg',
          sha256: derivativeHash,
          width: 1,
          height: 1,
        });
      }
      await db
        .prepare(
          "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=1,lease_until_ms=?,attempts=1,transition_id=?,updated_at_ms=? WHERE id=?",
        )
        .bind(
          randomUUID(),
          Date.now() + 120_000,
          randomUUID(),
          Date.now(),
          originalAssetId,
        )
        .run();
      await db
        .prepare(
          "UPDATE image_processing_jobs SET status='succeeded',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,result_json=?,transition_id=?,updated_at_ms=? WHERE id=?",
        )
        .bind(
          JSON.stringify(processingResult),
          randomUUID(),
          Date.now(),
          originalAssetId,
        )
        .run();
    }

    for (const file of files.filter((file) => file >= '0037'))
      await apply(file);

    const oracleNodeBytes = new Uint8Array([9, 8, 7, 6, 5]);
    const oracleNodeHash = createHash('sha256')
      .update(oracleNodeBytes)
      .digest('hex');
    await db
      .prepare(
        `INSERT INTO storage_nodes(
            id,provider,account_id,bucket_name,endpoint,credential_ref,status,
            priority,quota_bytes,used_bytes,reserved_bytes
          ) VALUES('oracle-vm','s3','native-fixture','kino-pick-overflow',
            'https://drive.kinostudio.tw','env:ORACLE_STORAGE','active',2,?,0,0)`,
      )
      .bind(30 * GB)
      .run();
    const oracleVersionId = randomUUID();
    const oracleAssetId = randomUUID();
    const oracleKey = `${nodeIsolationWorkspaceId}/${isolationProject.id}/${isolationAlbum.id}/${oracleAssetId}/oracle-preview`;
    await db
      .prepare(
        "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,?,?,?,'image/jpeg',1,1,'private')",
      )
      .bind(
        oracleVersionId,
        nodeIsolationWorkspaceId,
        oraclePhotoId,
        actor,
        oracleNodeHash,
        oracleNodeBytes.byteLength,
      )
      .run();
    await db
      .prepare(
        "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'oracle-vm','preview',?,?,'image/jpeg',?,'private')",
      )
      .bind(
        oracleAssetId,
        nodeIsolationWorkspaceId,
        oraclePhotoId,
        oracleVersionId,
        oracleKey,
        oracleNodeBytes.byteLength,
        oracleNodeHash,
      )
      .run();

    await db
      .prepare(
        'UPDATE workspace_storage_usage SET used_bytes=? WHERE workspace_id=?',
      )
      .bind(primaryBytes, workspaceId)
      .run();
    await db
      .prepare(
        'UPDATE workspace_storage_usage SET used_bytes=? WHERE workspace_id=?',
      )
      .bind(oracleNodeBytes.byteLength, nodeIsolationWorkspaceId)
      .run();
    await db
      .prepare("UPDATE storage_nodes SET used_bytes=? WHERE id='primary'")
      .bind(primaryBytes)
      .run();
    await db
      .prepare("UPDATE storage_nodes SET used_bytes=? WHERE id='oracle-vm'")
      .bind(oracleNodeBytes.byteLength)
      .run();

    const inventoryDb = db as unknown as ConstructorParameters<
      typeof D1StorageInventoryRepository
    >[0];
    const inventory = new D1StorageInventoryRepository(
      inventoryDb,
      actor,
      ownerSession,
    );
    const readInventory = () => inventory.read(workspaceId, 'primary');
    const listPage = async ({
      prefix,
      cursor,
    }: {
      prefix: string;
      limit: 1000;
      cursor?: string;
    }): Promise<StorageInventoryPage> => {
      const listed = await bucket.list({
        prefix,
        limit: 2,
        ...(cursor === undefined ? {} : { cursor }),
      });
      return {
        objects: listed.objects.map(({ key, size }) => ({ key, size })),
        truncated: listed.truncated,
        ...(listed.cursor === undefined ? {} : { cursor: listed.cursor }),
        ...(listed.delimitedPrefixes === undefined
          ? {}
          : { delimitedPrefixes: listed.delimitedPrefixes }),
      };
    };

    const expectFailure = async (
      operation: Promise<unknown>,
      code: string,
      status: number,
    ) => {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof WorkspaceFailure);
        assert.equal(error.code, code);
        assert.equal(error.status, status);
        return true;
      });
    };

    const bookkeeping = async (scopeId: string) => {
      const audit = await db
        .prepare('SELECT count(*) AS count FROM audit_events')
        .first<{ count: number }>();
      const usage = await db
        .prepare(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        )
        .bind(scopeId)
        .first<{ used_bytes: number; reserved_bytes: number }>();
      const nodes = await db
        .prepare(
          'SELECT id,used_bytes,reserved_bytes FROM storage_nodes ORDER BY id',
        )
        .all<{
          id: string;
          used_bytes: number;
          reserved_bytes: number;
        }>();
      const assets = await db
        .prepare('SELECT count(*) AS count FROM photo_assets')
        .first<{ count: number }>();
      const jobs = await db
        .prepare('SELECT count(*) AS count FROM manual_album_deletion_jobs')
        .first<{ count: number }>();
      const items = await db
        .prepare('SELECT count(*) AS count FROM manual_album_deletion_items')
        .first<{ count: number }>();
      assert.ok(audit && usage && assets && jobs && items);
      return {
        audit: audit.count,
        usage,
        nodes: nodes.results,
        assetCount: assets.count,
        deletionJobCount: jobs.count,
        deletionItemCount: items.count,
      };
    };

    const beforeReads = await bookkeeping(workspaceId);
    const primaryInventory = await inventory.read(workspaceId, 'primary');
    assert.equal(primaryInventory.workspaceId, workspaceId);
    assert.equal(primaryInventory.storageNodeId, 'primary');
    assert.equal(primaryInventory.pendingWrites, false);
    assert.deepEqual(
      primaryInventory.objects
        .map(({ key, bytes }) => ({ key, bytes }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      primaryAssets
        .map(({ key, bytes }) => ({ key, bytes: bytes.byteLength }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    );
    assert.equal(primaryInventory.objects.length, primaryAssets.length);

    const primaryResult = await reconcileStorageInventory({
      workspaceId,
      storageNodeId: 'primary',
      readInventory,
      listPage,
    });
    assert.deepEqual(primaryResult, {
      status: 'matched',
      workspaceId,
      storageNodeId: 'primary',
      inventoryRevision: primaryInventory.revision,
      objectCount: primaryAssets.length,
      confirmedBytes: primaryBytes,
      pages: 3,
      readOnly: true,
    });
    assert.ok(
      primaryAssets.every(
        ({ key }) => !JSON.stringify(primaryResult).includes(key),
      ),
      'the reconciliation result does not expose object keys',
    );

    const oracleInventory = await inventory.read(
      nodeIsolationWorkspaceId,
      'oracle-vm',
    );
    const primaryOnOracleWorkspace = await inventory.read(
      nodeIsolationWorkspaceId,
      'primary',
    );
    assert.deepEqual(oracleInventory.objects, [
      { key: oracleKey, bytes: oracleNodeBytes.byteLength },
    ]);
    assert.deepEqual(primaryOnOracleWorkspace.objects, []);
    assert.notEqual(
      oracleInventory.storageNodeId,
      primaryOnOracleWorkspace.storageNodeId,
    );

    await expectFailure(
      inventory.read(randomUUID(), 'primary'),
      'NOT_FOUND',
      404,
    );
    await expectFailure(
      inventory.read(workspaceId, 'unknown-node'),
      'NOT_FOUND',
      404,
    );
    await expectFailure(
      inventory.read(foreignWorkspaceId, 'primary'),
      'NOT_FOUND',
      404,
    );
    await expectFailure(
      new D1StorageInventoryRepository(
        inventoryDb,
        randomUUID(),
        ownerSession,
      ).read(workspaceId, 'primary'),
      'OWNER_REQUIRED',
      403,
    );
    await expectFailure(
      new D1StorageInventoryRepository(inventoryDb, actor, expiredSession).read(
        workspaceId,
        'primary',
      ),
      'OWNER_REQUIRED',
      403,
    );
    assert.deepEqual(await bookkeeping(workspaceId), beforeReads);

    for (const asset of primaryAssets) {
      const head = await bucket.head(asset.key);
      assert.equal(head?.size, asset.bytes.byteLength);
    }
    const assetRowsBefore = await db
      .prepare(
        "SELECT id,object_key,byte_size,checksum_sha256 FROM photo_assets WHERE workspace_id=? AND storage_node_id='primary' ORDER BY object_key",
      )
      .bind(workspaceId)
      .all<{
        id: string;
        object_key: string;
        byte_size: number;
        checksum_sha256: string;
      }>();
    assert.equal(assetRowsBefore.results.length, primaryAssets.length);

    // Exercise the proposal with real nonempty R2 inventory and the existing reclaim service.
    await db.batch(
      unstable_splitSqlQuery(
        await readFile(
          resolve(
            'apps/worker/migration-proposals/0070_storage_reconciliation.sql',
          ),
          'utf8',
        ),
      ).map((sql) => db.prepare(sql)),
    );
    const receipts = new D1StorageReconciliationReceipts(
      inventoryDb,
      actor,
      ownerSession,
    );
    const originalReceipt = await receipts.reconcile(
      workspaceId,
      'primary',
      listPage,
    );
    assert.equal(originalReceipt.status, 'recorded');
    if (originalReceipt.status !== 'recorded')
      throw new Error('NONEMPTY_RECEIPT_NOT_RECORDED');
    assert.equal(originalReceipt.receipt.object_count, primaryAssets.length);
    assert.equal(originalReceipt.receipt.confirmed_bytes, primaryBytes);
    assert.equal(originalReceipt.receipt.pages, 3);
    assert.deepEqual(
      await receipts.current(
        workspaceId,
        'primary',
        originalReceipt.receipt.id,
      ),
      originalReceipt.receipt,
    );

    const deletionDb = db as unknown as ConstructorParameters<
      typeof D1ManualAlbumDeletion
    >[0];
    const deletionStorage = new R2StorageAdapter(
      bucket as unknown as ConstructorParameters<typeof R2StorageAdapter>[0],
    );
    const deletion = new D1ManualAlbumDeletion(
      deletionDb,
      deletionStorage,
      actor,
      ownerSession,
    );
    let deletionResult = await deletion.start(album.id, {
      requestId: randomUUID(),
      expectedRevision: album.revision,
      confirmationName: album.name,
      inventoryCount: primaryAssets.length,
      bytesBefore: primaryBytes,
      confirmPermanent: true,
    });
    for (
      let attempts = 0;
      deletionResult.job?.status === 'deleting' &&
      attempts <= primaryAssets.length;
      attempts++
    ) {
      deletionResult = await deletion.advance(album.id, deletionResult.job.id);
    }
    assert.equal(deletionResult.job?.status, 'completed');
    assert.equal(deletionResult.job?.bytesReclaimed, primaryBytes);
    assert.equal(deletionResult.job?.pending, 0);

    const retainedAssetRows = await db
      .prepare(
        "SELECT id,object_key,byte_size,checksum_sha256 FROM photo_assets WHERE workspace_id=? AND storage_node_id='primary' ORDER BY object_key",
      )
      .bind(workspaceId)
      .all<{
        id: string;
        object_key: string;
        byte_size: number;
        checksum_sha256: string;
      }>();
    assert.deepEqual(retainedAssetRows.results, assetRowsBefore.results);
    const reclaimedItems = await db
      .prepare(
        "SELECT count(*) AS count FROM manual_album_deletion_items WHERE status='reclaimed'",
      )
      .first<{ count: number }>();
    assert.equal(reclaimedItems?.count, primaryAssets.length);
    for (const asset of primaryAssets) {
      const head = await bucket.head(asset.key);
      assert.equal(head?.size, 0);
      assert.equal(head?.customMetadata?.kinoDeletionAsset, asset.assetId);
    }
    const postCleanupUsage = await db
      .prepare(
        "SELECT u.used_bytes AS workspace_used,n.used_bytes AS node_used FROM workspace_storage_usage u JOIN storage_nodes n ON n.id='primary' WHERE u.workspace_id=?",
      )
      .bind(workspaceId)
      .first<{ workspace_used: number; node_used: number }>();
    assert.deepEqual(postCleanupUsage, { workspace_used: 0, node_used: 0 });

    const beforeFinalRead = await bookkeeping(workspaceId);
    const retainedInventory = await inventory.read(workspaceId, 'primary');
    assert.equal(retainedInventory.pendingWrites, false);
    assert.deepEqual(
      retainedInventory.objects
        .map(({ key, bytes }) => ({ key, bytes }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      primaryAssets
        .map(({ key }) => ({ key, bytes: 0 }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    );
    const retainedResult = await reconcileStorageInventory({
      workspaceId,
      storageNodeId: 'primary',
      readInventory: () => inventory.read(workspaceId, 'primary'),
      listPage,
    });
    assert.deepEqual(retainedResult, {
      status: 'matched',
      workspaceId,
      storageNodeId: 'primary',
      inventoryRevision: retainedInventory.revision,
      objectCount: primaryAssets.length,
      confirmedBytes: 0,
      pages: 3,
      readOnly: true,
    });
    assert.deepEqual(await bookkeeping(workspaceId), beforeFinalRead);
    assert.equal(
      await receipts.current(
        workspaceId,
        'primary',
        originalReceipt.receipt.id,
      ),
      null,
    );
    const reclaimedReceipt = await receipts.reconcile(
      workspaceId,
      'primary',
      listPage,
    );
    assert.equal(reclaimedReceipt.status, 'recorded');
    if (reclaimedReceipt.status !== 'recorded')
      throw new Error('RECLAIMED_RECEIPT_NOT_RECORDED');
    assert.equal(reclaimedReceipt.receipt.object_count, primaryAssets.length);
    assert.equal(reclaimedReceipt.receipt.confirmed_bytes, 0);
    assert.ok(reclaimedReceipt.receipt.epoch > originalReceipt.receipt.epoch);
  } finally {
    await mf.dispose();
  }
}, 120_000);
