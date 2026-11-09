import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'vitest';
import {
  reconcileNodeStorageInventory,
  reconcileStorageInventory,
  type NodeStorageInventorySnapshot,
  type StorageInventoryPage,
} from '../../packages/domain/src/storage-reconciliation';
import { D1ContentRepository } from '../../apps/worker/src/content';
import { D1AlbumRetentionPolicyRepository } from '../../apps/worker/src/album-retention-policy';
import { D1AlbumActivationRepository } from '../../apps/worker/src/album-activation';
import { D1InviteIssuance } from '../../apps/worker/src/invite-issuance';
import { D1InviteRepository } from '../../apps/worker/src/invites';
import { guestPermissionNames } from '../../packages/contracts/src/guest-access';
import { D1RetentionAlbumFacts } from '../../apps/worker/src/retention-album-facts';
import { D1ManualAlbumDeletion } from '../../apps/worker/src/manual-album-deletion';
import { R2StorageAdapter } from '../../apps/worker/src/r2-storage';
import { D1NodeStorageInventoryRepository } from '../../apps/worker/src/node-storage-inventory';
import { D1NodeStorageReconciliationReceipts } from '../../apps/worker/src/node-storage-reconciliation-receipts';
import { D1StorageInventoryRepository } from '../../apps/worker/src/storage-inventory';
import { D1StorageReconciliationReceipts } from '../../apps/worker/src/storage-reconciliation-receipts';
import {
  reconcilePrimaryStorageNode,
  recordPrimaryStorageReconciliation,
} from '../../apps/worker/src/storage-reconciliation';
import { WorkspaceFailure } from '../../apps/worker/src/workspaces';
import { D1UploadRepository } from '../../apps/worker/src/uploads';

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
    prefix?: string;
    limit: number;
    cursor?: string;
  }): Promise<NativeR2Page>;
  delete(key: string): Promise<void>;
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
    const secondPrimaryAssetId = randomUUID();
    const oracleKey = `${nodeIsolationWorkspaceId}/${isolationProject.id}/${isolationAlbum.id}/${oracleAssetId}/oracle-preview`;
    const secondPrimaryBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const secondPrimaryHash = createHash('sha256')
      .update(secondPrimaryBytes)
      .digest('hex');
    const secondPrimaryKey = `${nodeIsolationWorkspaceId}/${isolationProject.id}/${isolationAlbum.id}/${secondPrimaryAssetId}/primary-preview`;
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

    await bucket.put(secondPrimaryKey, secondPrimaryBytes, {
      sha256: secondPrimaryHash,
      httpMetadata: { contentType: 'image/jpeg' },
    });
    await db
      .prepare(
        "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'primary','thumbnail',?,?,'image/jpeg',?,'private')",
      )
      .bind(
        secondPrimaryAssetId,
        nodeIsolationWorkspaceId,
        oraclePhotoId,
        oracleVersionId,
        secondPrimaryKey,
        secondPrimaryBytes.byteLength,
        secondPrimaryHash,
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
      .bind(
        oracleNodeBytes.byteLength + secondPrimaryBytes.byteLength,
        nodeIsolationWorkspaceId,
      )
      .run();
    await db
      .prepare("UPDATE storage_nodes SET used_bytes=? WHERE id='primary'")
      .bind(primaryBytes + secondPrimaryBytes.byteLength)
      .run();
    await db
      .prepare("UPDATE storage_nodes SET used_bytes=? WHERE id='oracle-vm'")
      .bind(oracleNodeBytes.byteLength)
      .run();

    const inventoryDb = db as unknown as ConstructorParameters<
      typeof D1StorageInventoryRepository
    >[0];
    const primaryEnvironment = {
      PRIMARY_STORAGE: bucket,
    } as unknown as Parameters<typeof reconcilePrimaryStorageNode>[1];
    const inventory = new D1StorageInventoryRepository(
      inventoryDb,
      actor,
      ownerSession,
    );
    const nodeInventory = new D1NodeStorageInventoryRepository(
      inventoryDb,
      actor,
      ownerSession,
    );
    const readInventory = () => inventory.read(workspaceId, 'primary');
    const readNodeInventory = (): Promise<NodeStorageInventorySnapshot> =>
      nodeInventory.read('primary');
    const pageResult = (listed: NativeR2Page): StorageInventoryPage => ({
      objects: listed.objects.map(({ key, size }) => ({ key, size })),
      truncated: listed.truncated,
      ...(listed.cursor === undefined ? {} : { cursor: listed.cursor }),
      ...(listed.delimitedPrefixes === undefined
        ? {}
        : { delimitedPrefixes: listed.delimitedPrefixes }),
    });
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
      return pageResult(listed);
    };
    const listNodePage: Parameters<
      typeof reconcileNodeStorageInventory
    >[0]['listPage'] = async ({ cursor }) =>
      pageResult(
        await bucket.list({
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
    const primaryReceiptEnvironment = {
      PRIMARY_STORAGE: {
        list: ({ cursor }: { limit: 1000; cursor?: string }) =>
          bucket.list({
            limit: 2,
            ...(cursor === undefined ? {} : { cursor }),
          }),
      },
    } as unknown as Parameters<typeof recordPrimaryStorageReconciliation>[1];

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

    const protectedAlbum = await content.createAlbum(project.id, {
      name: 'Pinned retention source fixture',
      requestId: randomUUID(),
    });
    const activatedProtectedAlbum = await new D1AlbumActivationRepository(
      inventoryDb,
      actor,
      ownerSession,
    ).activate(protectedAlbum.id, {
      requestId: randomUUID(),
      expectedRevision: protectedAlbum.revision,
      confirmActivate: true,
    });
    await content.protectAlbum(protectedAlbum.id, {
      isPinned: true,
      legalHold: false,
      expectedRevision: activatedProtectedAlbum.revision,
      confirmUnprotect: false,
      requestId: randomUUID(),
    });
    const policyRepository = new D1AlbumRetentionPolicyRepository(
      inventoryDb,
      actor,
      ownerSession,
    );
    const initialPolicy = await policyRepository.get(protectedAlbum.id);
    await policyRepository.set(protectedAlbum.id, {
      requestId: randomUUID(),
      expectedOwnerId: actor,
      expectedRevision: initialPolicy.revision,
      inactiveDays: 45,
      cleanupAllowed: true,
    });
    const customShareExpiry = new Date(Date.now() + 3_600_000).toISOString();
    const share = await new D1InviteIssuance(
      {
        DB: inventoryDb,
        APP_ENV: 'local',
        APP_URL: 'http://127.0.0.1:8797',
        REGISTRATION_MODE: 'closed',
        STORAGE_AUTODELETE_ENABLED: 'false',
        STORAGE_RETENTION_DRY_RUN: 'true',
        MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
        GUEST_INVITE_ISSUANCE_ENABLED: 'true',
        BETTER_AUTH_SECRET:
          'synthetic-retention-source-fixture-at-least-forty-characters',
      } as unknown as ConstructorParameters<typeof D1InviteIssuance>[0],
      actor,
      ownerSession,
    ).create(project.id, {
      requestId: randomUUID(),
      albumIds: [protectedAlbum.id],
      accessMode: 'link_only',
      permissions: Object.fromEntries(
        guestPermissionNames.map((name) => [name, name === 'can_view']),
      ),
      expiresAt: customShareExpiry,
      maxUses: 1,
    });
    const factsDb = {
      prepare: inventoryDb.prepare.bind(inventoryDb),
      async batch(statements: D1PreparedStatement[]) {
        try {
          return await inventoryDb.batch(statements);
        } catch (error) {
          throw new WorkspaceFailure(
            'SYNTHETIC_D1_ERROR: ' +
              (error instanceof Error ? error.message : 'unknown'),
            503,
          );
        }
      },
    } as D1Database;
    const facts = new D1RetentionAlbumFacts(factsDb, actor, ownerSession);
    const beforeReads = await bookkeeping(workspaceId);
    const sourceSnapshot = await facts.read(workspaceId);
    assert.equal(sourceSnapshot.workspaceId, workspaceId);
    assert.equal(sourceSnapshot.albums.length, 2);
    const albumFacts = sourceSnapshot.albums.find(
      (item) => item.albumId === album.id,
    );
    assert.ok(albumFacts);
    assert.equal(albumFacts.bytes, primaryBytes);
    assert.equal(albumFacts.assetCount, primaryAssets.length);
    assert.equal(albumFacts.versionCount, 2);
    assert.equal(albumFacts.inactiveDays, 90);
    assert.equal(albumFacts.cleanupAllowed, false);
    assert.equal(albumFacts.lastValidViewedAt, null);
    assert.equal(albumFacts.activeCustomShareCount, 0);
    const pinnedFacts = sourceSnapshot.albums.find(
      (item) => item.albumId === protectedAlbum.id,
    );
    assert.ok(pinnedFacts);
    assert.equal(pinnedFacts.inactiveDays, 45);
    assert.equal(pinnedFacts.cleanupAllowed, true);
    assert.equal(pinnedFacts.policyRevision, initialPolicy.revision + 1);
    assert.ok(pinnedFacts.blockers.includes('DELETE_PROTECTED'));
    assert.equal(pinnedFacts.bytes, 0);
    assert.equal(pinnedFacts.activeCustomShareCount, 1);
    assert.equal(
      pinnedFacts.latestActiveCustomShareExpiresAt,
      customShareExpiry,
    );
    const otherFacts = await facts.read(nodeIsolationWorkspaceId);
    assert.equal(otherFacts.albums.length, 1);
    assert.equal(otherFacts.albums[0]?.albumId, isolationAlbum.id);
    assert.equal(
      otherFacts.albums[0]?.bytes,
      oracleNodeBytes.byteLength + secondPrimaryBytes.byteLength,
    );
    const serializedFacts = JSON.stringify(sourceSnapshot);
    assert.ok(primaryAssets.every(({ key }) => !serializedFacts.includes(key)));
    assert.ok(
      !serializedFacts.includes(actor) &&
        !serializedFacts.includes(ownerSession),
    );
    assert.ok(
      !serializedFacts.includes('activityEvidenceVerified') &&
        !serializedFacts.includes('healthy'),
    );
    await assert.rejects(
      facts.read(foreignWorkspaceId),
      (error: unknown) =>
        error instanceof WorkspaceFailure && error.status === 404,
    );
    await assert.rejects(
      new D1RetentionAlbumFacts(inventoryDb, actor, expiredSession).read(
        workspaceId,
      ),
      (error: unknown) =>
        error instanceof WorkspaceFailure && error.status === 403,
    );
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
    assert.deepEqual(primaryOnOracleWorkspace.objects, [
      { key: secondPrimaryKey, bytes: secondPrimaryBytes.byteLength },
    ]);
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
    await new D1InviteRepository(inventoryDb, actor, ownerSession).revoke(
      share.invite.inviteId,
      {
        requestId: randomUUID(),
        confirmRevoke: true,
      },
    );
    const revokedShareFacts = (await facts.read(workspaceId)).albums.find(
      (item) => item.albumId === protectedAlbum.id,
    );
    assert.ok(revokedShareFacts);
    assert.equal(revokedShareFacts.activeCustomShareCount, 0);
    assert.equal(revokedShareFacts.latestActiveCustomShareExpiresAt, null);
    let changedPolicy = await policyRepository.get(protectedAlbum.id);
    for (const inactiveDays of [46, 45]) {
      changedPolicy = await policyRepository.set(protectedAlbum.id, {
        requestId: randomUUID(),
        expectedOwnerId: actor,
        expectedRevision: changedPolicy.revision,
        inactiveDays,
        cleanupAllowed: true,
      });
    }
    const revertedPolicyFacts = (await facts.read(workspaceId)).albums.find(
      (item) => item.albumId === protectedAlbum.id,
    );
    assert.ok(revertedPolicyFacts);
    assert.equal(revertedPolicyFacts.inactiveDays, pinnedFacts.inactiveDays);
    assert.equal(revertedPolicyFacts.revision, pinnedFacts.revision);
    assert.equal(
      revertedPolicyFacts.policyRevision,
      pinnedFacts.policyRevision + 2,
    );

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

    // Apply proposal-only schema after all 69 product migrations; no ledger 70 is applied.
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
    const clock = await db
      .prepare('SELECT epoch FROM storage_inventory_clock WHERE id=1')
      .first<{ epoch: number }>();
    assert.ok(clock && clock.epoch >= 0);
    const beforeNodeReads = {
      firstWorkspace: await bookkeeping(workspaceId),
      secondWorkspace: await bookkeeping(nodeIsolationWorkspaceId),
    };
    const nodeSnapshot = await readNodeInventory();
    const expectedNodeObjects = [
      ...primaryAssets.map(({ key, bytes }) => ({
        key,
        bytes: bytes.byteLength,
      })),
      { key: secondPrimaryKey, bytes: secondPrimaryBytes.byteLength },
    ].sort((left, right) => left.key.localeCompare(right.key));
    assert.equal(nodeSnapshot.scope, 'node');
    assert.equal(nodeSnapshot.storageNodeId, 'primary');
    assert.equal(nodeSnapshot.pendingWrites, false);
    assert.deepEqual(
      [...nodeSnapshot.objects].sort((left, right) =>
        left.key.localeCompare(right.key),
      ),
      expectedNodeObjects,
    );
    assert.ok(
      nodeSnapshot.objects.every(({ key }) => key !== oracleKey),
      'the primary node manifest excludes assets registered to the Oracle node',
    );
    const nodeResult = await reconcileNodeStorageInventory({
      storageNodeId: 'primary',
      readInventory: readNodeInventory,
      listPage: listNodePage,
    });
    assert.deepEqual(nodeResult, {
      status: 'matched',
      scope: 'node',
      storageNodeId: 'primary',
      inventoryRevision: nodeSnapshot.revision,
      objectCount: expectedNodeObjects.length,
      confirmedBytes: primaryBytes + secondPrimaryBytes.byteLength,
      pages: 4,
      readOnly: true,
    });
    assert.deepEqual(
      await reconcilePrimaryStorageNode(
        inventoryDb,
        primaryEnvironment,
        actor,
        ownerSession,
      ),
      { ...nodeResult, pages: 1 },
    );
    assert.ok(
      expectedNodeObjects.every(
        ({ key }) => !JSON.stringify(nodeResult).includes(key),
      ),
      'the global reconciliation result does not expose object keys',
    );
    assert.deepEqual(
      {
        firstWorkspace: await bookkeeping(workspaceId),
        secondWorkspace: await bookkeeping(nodeIsolationWorkspaceId),
      },
      beforeNodeReads,
    );

    const nodeReceipts = new D1NodeStorageReconciliationReceipts(
      inventoryDb,
      actor,
      ownerSession,
    );
    const epochBeforeNodeReceipt = await db
      .prepare('SELECT epoch FROM storage_inventory_clock WHERE id=1')
      .first<{ epoch: number }>();
    assert.ok(epochBeforeNodeReceipt);
    const nodeReceiptResult = await recordPrimaryStorageReconciliation(
      inventoryDb,
      primaryReceiptEnvironment,
      actor,
      ownerSession,
    );
    assert.equal(nodeReceiptResult.status, 'recorded');
    if (nodeReceiptResult.status !== 'recorded')
      throw new Error('PRIMARY_NODE_RECEIPT_NOT_RECORDED');
    const nodeReceipt = nodeReceiptResult.receipt;
    assert.equal(nodeReceiptResult.deletesData, false);
    assert.deepEqual(
      Object.keys(nodeReceipt).sort(),
      [
        'completed_at_ms',
        'confirmed_bytes',
        'epoch',
        'id',
        'inventory_revision',
        'object_count',
        'pages',
        'scope',
        'started_at_ms',
        'storage_node_id',
      ].sort(),
    );
    assert.equal(nodeReceipt.scope, 'node');
    assert.equal(nodeReceipt.storage_node_id, 'primary');
    assert.equal(nodeReceipt.object_count, expectedNodeObjects.length);
    assert.equal(
      nodeReceipt.confirmed_bytes,
      primaryBytes + secondPrimaryBytes.byteLength,
    );
    assert.equal(nodeReceipt.pages, 4);
    assert.deepEqual(
      await nodeReceipts.current('primary', nodeReceipt.id),
      nodeReceipt,
    );
    assert.ok(
      expectedNodeObjects.every(
        ({ key }) => !JSON.stringify(nodeReceiptResult).includes(key),
      ),
      'the durable node receipt does not expose object keys',
    );
    const epochAfterNodeReceipt = await db
      .prepare('SELECT epoch FROM storage_inventory_clock WHERE id=1')
      .first<{ epoch: number }>();
    assert.equal(epochAfterNodeReceipt?.epoch, epochBeforeNodeReceipt.epoch);

    const nodeReceiptAudit = await db
      .prepare(
        'SELECT actor_type,actor_id,session_id,workspace_id,action,after_json,request_id FROM audit_events WHERE request_id=?',
      )
      .bind(nodeReceipt.id)
      .first<{
        actor_type: string;
        actor_id: string;
        session_id: string;
        workspace_id: string | null;
        action: string;
        after_json: string;
        request_id: string;
      }>();
    assert.ok(nodeReceiptAudit);
    assert.equal(nodeReceiptAudit.actor_type, 'user');
    assert.equal(nodeReceiptAudit.actor_id, actor);
    assert.equal(nodeReceiptAudit.session_id, ownerSession);
    assert.equal(nodeReceiptAudit.workspace_id, null);
    assert.equal(nodeReceiptAudit.action, 'storage.reconciled');
    assert.equal(nodeReceiptAudit.request_id, nodeReceipt.id);
    assert.deepEqual(JSON.parse(nodeReceiptAudit.after_json), {
      scope: 'node',
      storageNodeId: 'primary',
      epoch: nodeReceipt.epoch,
      inventoryRevision: nodeReceipt.inventory_revision,
      objectCount: nodeReceipt.object_count,
      confirmedBytes: nodeReceipt.confirmed_bytes,
      pages: nodeReceipt.pages,
      startedAtMs: nodeReceipt.started_at_ms,
      completedAtMs: nodeReceipt.completed_at_ms,
    });
    const afterNodeReceiptBookkeeping = {
      firstWorkspace: await bookkeeping(workspaceId),
      secondWorkspace: await bookkeeping(nodeIsolationWorkspaceId),
    };
    assert.equal(
      afterNodeReceiptBookkeeping.firstWorkspace.audit,
      beforeNodeReads.firstWorkspace.audit + 1,
    );
    assert.equal(
      afterNodeReceiptBookkeeping.secondWorkspace.audit,
      beforeNodeReads.secondWorkspace.audit + 1,
    );
    assert.deepEqual(
      {
        firstWorkspace: {
          ...afterNodeReceiptBookkeeping.firstWorkspace,
          audit: beforeNodeReads.firstWorkspace.audit,
        },
        secondWorkspace: {
          ...afterNodeReceiptBookkeeping.secondWorkspace,
          audit: beforeNodeReads.secondWorkspace.audit,
        },
      },
      beforeNodeReads,
    );

    const insertNodeReceipt = (
      id: string,
      overrides: {
        actor?: string;
        session?: string;
        epoch?: number;
        objectCount?: number;
        confirmedBytes?: number;
        startedAt?: number;
      } = {},
      replace = false,
    ) =>
      db
        .prepare(
          `INSERT${replace ? ' OR REPLACE' : ''} INTO node_storage_reconciliation_receipts ` +
            '(id,storage_node_id,actor_id,session_id,epoch,inventory_revision,object_count,confirmed_bytes,pages,started_at_ms) ' +
            'VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          'primary',
          overrides.actor ?? actor,
          overrides.session ?? ownerSession,
          overrides.epoch ?? nodeReceipt.epoch,
          nodeReceipt.inventory_revision,
          overrides.objectCount ?? nodeReceipt.object_count,
          overrides.confirmedBytes ?? nodeReceipt.confirmed_bytes,
          nodeReceipt.pages,
          overrides.startedAt ?? nodeReceipt.started_at_ms,
        )
        .run();
    await assert.rejects(insertNodeReceipt(nodeReceipt.id, {}, true));
    await assert.rejects(
      insertNodeReceipt(randomUUID(), {
        objectCount: nodeReceipt.object_count + 1,
      }),
    );
    await assert.rejects(
      insertNodeReceipt(randomUUID(), {
        confirmedBytes: nodeReceipt.confirmed_bytes + 1,
      }),
    );
    await assert.rejects(
      insertNodeReceipt(randomUUID(), { epoch: nodeReceipt.epoch + 1 }),
    );
    await assert.rejects(insertNodeReceipt(randomUUID(), { startedAt: 1 }));
    await assert.rejects(
      insertNodeReceipt(randomUUID(), { actor: randomUUID() }),
    );
    await assert.rejects(
      insertNodeReceipt(randomUUID(), { session: expiredSession }),
    );
    await assert.rejects(
      db
        .prepare(
          'UPDATE node_storage_reconciliation_receipts SET pages=pages WHERE id=?',
        )
        .bind(nodeReceipt.id)
        .run(),
    );
    await assert.rejects(
      db
        .prepare('DELETE FROM node_storage_reconciliation_receipts WHERE id=?')
        .bind(nodeReceipt.id)
        .run(),
    );
    const nodeReceiptRowCount = await db
      .prepare(
        'SELECT count(*) AS count FROM node_storage_reconciliation_receipts',
      )
      .first<{ count: number }>();
    assert.equal(nodeReceiptRowCount?.count, 1);
    assert.deepEqual(
      await nodeReceipts.current('primary', nodeReceipt.id),
      nodeReceipt,
    );

    const foreignWorkspaceOwner = await db
      .prepare('SELECT owner_user_id FROM workspaces WHERE id=?')
      .bind(foreignWorkspaceId)
      .first<{ owner_user_id: string }>();
    assert.equal(foreignWorkspaceOwner?.owner_user_id, foreignUserId);
    await expectFailure(
      new D1NodeStorageInventoryRepository(
        inventoryDb,
        foreignUserId,
        ownerSession,
      ).read('primary'),
      'OWNER_REQUIRED',
      403,
    );
    assert.deepEqual(
      await reconcilePrimaryStorageNode(
        inventoryDb,
        primaryEnvironment,
        foreignUserId,
        ownerSession,
      ),
      { status: 'blocked', reason: 'inventory_unavailable', readOnly: true },
    );

    const unregisteredKey = `${randomUUID()}/foreign/unregistered.jpg`;
    await bucket.put(unregisteredKey, new Uint8Array([7, 8, 9]));
    assert.deepEqual(
      await reconcileNodeStorageInventory({
        storageNodeId: 'primary',
        readInventory: readNodeInventory,
        listPage: listNodePage,
      }),
      { status: 'blocked', reason: 'unexpected_object', readOnly: true },
    );
    await bucket.delete(unregisteredKey);

    const uploadStorage = new R2StorageAdapter(
      bucket as unknown as ConstructorParameters<typeof R2StorageAdapter>[0],
    );
    const primaryUploads = new D1UploadRepository(
      inventoryDb,
      actor,
      ownerSession,
      uploadStorage,
      { chooseStorageNode: async () => 'primary' },
    );
    const uploadRequest = {
      workspaceId,
      projectId: project.id,
      albumId: album.id,
      originalFilename: 'inventory-reservation.jpg',
      expectedBytes: 2,
      contentType: 'image/jpeg',
      sha256: 'b'.repeat(64),
    };
    const beforeAbaSnapshot = await readNodeInventory();
    const beforeAbaLedger = await db
      .prepare(
        "SELECT n.used_bytes AS node_used,n.reserved_bytes AS node_reserved,u.used_bytes AS workspace_used,u.reserved_bytes AS workspace_reserved FROM storage_nodes n JOIN workspace_storage_usage u ON u.workspace_id=? WHERE n.id='primary'",
      )
      .bind(workspaceId)
      .first<{
        node_used: number;
        node_reserved: number;
        workspace_used: number;
        workspace_reserved: number;
      }>();
    assert.ok(beforeAbaLedger);
    assert.deepEqual(
      await nodeReceipts.current('primary', nodeReceipt.id),
      nodeReceipt,
    );
    const historicalPrimaryUpload = await primaryUploads.reserve({
      ...uploadRequest,
      requestId: randomUUID(),
    });
    await primaryUploads.cancel(historicalPrimaryUpload.id, {
      requestId: randomUUID(),
    });
    const afterAbaSnapshot = await readNodeInventory();
    assert.equal(afterAbaSnapshot.pendingWrites, false);
    assert.deepEqual(afterAbaSnapshot.objects, beforeAbaSnapshot.objects);
    assert.notEqual(afterAbaSnapshot.revision, beforeAbaSnapshot.revision);
    assert.deepEqual(
      await db
        .prepare(
          "SELECT n.used_bytes AS node_used,n.reserved_bytes AS node_reserved,u.used_bytes AS workspace_used,u.reserved_bytes AS workspace_reserved FROM storage_nodes n JOIN workspace_storage_usage u ON u.workspace_id=? WHERE n.id='primary'",
        )
        .bind(workspaceId)
        .first(),
      beforeAbaLedger,
    );
    const afterAbaClock = await db
      .prepare('SELECT epoch FROM storage_inventory_clock WHERE id=1')
      .first<{ epoch: number }>();
    assert.ok(afterAbaClock && afterAbaClock.epoch > nodeReceipt.epoch);
    assert.equal(await nodeReceipts.current('primary', nodeReceipt.id), null);

    const targetReservation = await primaryUploads.reserve({
      ...uploadRequest,
      requestId: randomUUID(),
    });
    assert.equal((await readNodeInventory()).pendingWrites, true);
    assert.deepEqual(
      await reconcileNodeStorageInventory({
        storageNodeId: 'primary',
        readInventory: readNodeInventory,
        listPage: listNodePage,
      }),
      { status: 'blocked', reason: 'pending_writes', readOnly: true },
    );
    await primaryUploads.cancel(targetReservation.id, {
      requestId: randomUUID(),
    });
    assert.equal((await readNodeInventory()).pendingWrites, false);

    const beforeDeletionNodeReceiptResult =
      await recordPrimaryStorageReconciliation(
        inventoryDb,
        primaryReceiptEnvironment,
        actor,
        ownerSession,
      );
    assert.equal(beforeDeletionNodeReceiptResult.status, 'recorded');
    if (beforeDeletionNodeReceiptResult.status !== 'recorded')
      throw new Error('PREDELETE_NODE_RECEIPT_NOT_RECORDED');
    const beforeDeletionNodeReceipt = beforeDeletionNodeReceiptResult.receipt;
    assert.deepEqual(
      await nodeReceipts.current('primary', beforeDeletionNodeReceipt.id),
      beforeDeletionNodeReceipt,
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
    assert.equal(
      await receipts.current(workspaceId, 'primary', nodeReceipt.id),
      null,
    );
    await assert.rejects(
      db
        .prepare(
          'INSERT INTO storage_reconciliation_receipts ' +
            '(id,workspace_id,storage_node_id,actor_id,session_id,epoch,inventory_revision,object_count,confirmed_bytes,pages,started_at_ms) ' +
            'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          nodeReceipt.id,
          workspaceId,
          'primary',
          actor,
          ownerSession,
          originalReceipt.receipt.epoch,
          originalReceipt.receipt.inventory_revision,
          originalReceipt.receipt.object_count,
          originalReceipt.receipt.confirmed_bytes,
          originalReceipt.receipt.pages,
          originalReceipt.receipt.started_at_ms,
        )
        .run(),
    );
    const replayedWorkspaceReceipt = await db
      .prepare(
        'SELECT count(*) AS count FROM storage_reconciliation_receipts WHERE id=?',
      )
      .bind(nodeReceipt.id)
      .first<{ count: number }>();
    assert.equal(replayedWorkspaceReceipt?.count, 0);

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
    assert.equal(
      await nodeReceipts.current('primary', beforeDeletionNodeReceipt.id),
      null,
    );

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
    assert.deepEqual(postCleanupUsage, {
      workspace_used: 0,
      node_used: secondPrimaryBytes.byteLength,
    });

    const beforeFinalRead = await bookkeeping(workspaceId);
    const reclaimedFacts = (await facts.read(workspaceId)).albums.find(
      (item) => item.albumId === album.id,
    );
    assert.ok(reclaimedFacts);
    assert.equal(reclaimedFacts.bytes, 0);
    assert.equal(reclaimedFacts.assetCount, primaryAssets.length);
    assert.equal(reclaimedFacts.versionCount, 2);
    assert.equal(reclaimedFacts.state, 'deleted');
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

    const beforeFinalNodeReads = {
      firstWorkspace: await bookkeeping(workspaceId),
      secondWorkspace: await bookkeeping(nodeIsolationWorkspaceId),
    };
    const finalNodeSnapshot = await readNodeInventory();
    const expectedRetainedNodeObjects = [
      ...primaryAssets.map(({ key }) => ({ key, bytes: 0 })),
      { key: secondPrimaryKey, bytes: secondPrimaryBytes.byteLength },
    ].sort((left, right) => left.key.localeCompare(right.key));
    assert.equal(finalNodeSnapshot.scope, 'node');
    assert.equal(finalNodeSnapshot.pendingWrites, false);
    assert.deepEqual(
      [...finalNodeSnapshot.objects].sort((left, right) =>
        left.key.localeCompare(right.key),
      ),
      expectedRetainedNodeObjects,
    );
    const finalNodeResult = await reconcileNodeStorageInventory({
      storageNodeId: 'primary',
      readInventory: readNodeInventory,
      listPage: listNodePage,
    });
    assert.deepEqual(finalNodeResult, {
      status: 'matched',
      scope: 'node',
      storageNodeId: 'primary',
      inventoryRevision: finalNodeSnapshot.revision,
      objectCount: expectedRetainedNodeObjects.length,
      confirmedBytes: secondPrimaryBytes.byteLength,
      pages: 4,
      readOnly: true,
    });
    assert.deepEqual(
      {
        firstWorkspace: await bookkeeping(workspaceId),
        secondWorkspace: await bookkeeping(nodeIsolationWorkspaceId),
      },
      beforeFinalNodeReads,
    );
    const retainedNodeReceiptResult = await recordPrimaryStorageReconciliation(
      inventoryDb,
      primaryReceiptEnvironment,
      actor,
      ownerSession,
    );
    assert.equal(retainedNodeReceiptResult.status, 'recorded');
    if (retainedNodeReceiptResult.status !== 'recorded')
      throw new Error('RECLAIMED_NODE_RECEIPT_NOT_RECORDED');
    assert.equal(
      retainedNodeReceiptResult.receipt.object_count,
      expectedRetainedNodeObjects.length,
    );
    assert.equal(
      retainedNodeReceiptResult.receipt.confirmed_bytes,
      secondPrimaryBytes.byteLength,
    );
    assert.equal(retainedNodeReceiptResult.receipt.pages, 4);
    assert.ok(
      retainedNodeReceiptResult.receipt.epoch > beforeDeletionNodeReceipt.epoch,
    );
    assert.deepEqual(
      await nodeReceipts.current(
        'primary',
        retainedNodeReceiptResult.receipt.id,
      ),
      retainedNodeReceiptResult.receipt,
    );
    assert.ok(
      expectedRetainedNodeObjects.every(
        ({ key }) => !JSON.stringify(retainedNodeReceiptResult).includes(key),
      ),
      'the reclaimed global receipt retains counts but no object keys',
    );

    // Synthetic corruption fixture: test projection integrity, not human-view authorization.
    const readTrigger = async (name: string) => {
      const row = await db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?",
        )
        .bind(name)
        .first<{ sql: string }>();
      assert.ok(row?.sql);
      return row.sql;
    };
    const insertViewGuard = await readTrigger('human_photo_view_insert_guard');
    const updateFrontierGuard = await readTrigger(
      'album_human_activity_update_guard',
    );
    const firstVersion = await db
      .prepare(
        'SELECT id FROM photo_versions WHERE photo_id=? ORDER BY version_no LIMIT 1',
      )
      .bind(photoId)
      .first<{ id: string }>();
    assert.ok(firstVersion);
    const viewClock = await db
      .prepare("SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms")
      .first<{ now_ms: number }>();
    assert.ok(viewClock);
    const lowerEvent = '00000000-0000-4000-8000-000000000001';
    const higherEvent = '00000000-0000-4000-8000-000000000002';
    await db.prepare('DROP TRIGGER human_photo_view_insert_guard').run();
    try {
      for (const eventId of [lowerEvent, higherEvent]) {
        await db
          .prepare(
            "INSERT INTO human_photo_views(event_id,request_id,actor_type,actor_id,authorization_session_id,workspace_id,project_id,album_id,photo_id,version_id,viewed_at_ms,visible_for_ms) VALUES(?,?,'user',?,?,?,?,?,?,?,?,1000)",
          )
          .bind(
            eventId,
            randomUUID(),
            actor,
            ownerSession,
            workspaceId,
            project.id,
            album.id,
            photoId,
            firstVersion.id,
            viewClock.now_ms,
          )
          .run();
      }
    } finally {
      await db.prepare(insertViewGuard).run();
    }
    const canonicalFrontier = await db
      .prepare(
        'SELECT view_event_id FROM album_human_activity WHERE album_id=?',
      )
      .bind(album.id)
      .first<{ view_event_id: string }>();
    assert.equal(canonicalFrontier?.view_event_id, higherEvent);
    assert.equal(
      (await facts.read(workspaceId)).albums.find(
        (item) => item.albumId === album.id,
      )?.lastValidViewedAt,
      new Date(viewClock.now_ms).toISOString(),
    );
    await assert.rejects(
      db
        .prepare(
          'UPDATE album_human_activity SET view_event_id=? WHERE album_id=?',
        )
        .bind(lowerEvent, album.id)
        .run(),
      /HUMAN_ACTIVITY_WITNESS_REQUIRED/,
    );
    await db.prepare('DROP TRIGGER album_human_activity_update_guard').run();
    try {
      await db
        .prepare(
          'UPDATE album_human_activity SET view_event_id=? WHERE album_id=?',
        )
        .bind(lowerEvent, album.id)
        .run();
      await assert.rejects(
        facts.read(workspaceId),
        (error: unknown) =>
          error instanceof WorkspaceFailure &&
          error.code === 'RETENTION_FACTS_UNAVAILABLE',
      );
    } finally {
      await db.prepare(updateFrontierGuard).run();
      await db
        .prepare(
          'UPDATE album_human_activity SET view_event_id=? WHERE album_id=?',
        )
        .bind(higherEvent, album.id)
        .run();
    }
    assert.ok(
      (await facts.read(workspaceId)).albums.find(
        (item) => item.albumId === album.id,
      )?.lastValidViewedAt,
    );
  } finally {
    await mf.dispose();
  }
}, 120_000);
