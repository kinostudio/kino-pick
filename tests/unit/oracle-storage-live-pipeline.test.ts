import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { D1GalleryRepository } from '../../apps/worker/src/gallery';
import { D1ImageProcessingRepository } from '../../apps/worker/src/processing-jobs';
import type { D1UploadRepository } from '../../apps/worker/src/uploads';
import type { WorkerEnv } from '../../apps/worker/src/config';
import {
  readOraclePolicy,
  saveOraclePolicy,
} from '../../apps/worker/src/oracle-storage-policy';
import { storageBucketForNode } from '../../apps/worker/src/private-storage';
import { R2StorageAdapter } from '../../apps/worker/src/r2-storage';
import type { S3SignerCredentials } from '../../apps/worker/src/r2-presign';
import { R2ProcessingObjectStore } from '../../packages/image-processing/src/r2-processing-store';
import { runImageProcessingJob } from '../../packages/image-processing/src/durable-runner';
import { LocalSharpImageProcessor } from '../../packages/image-processing/src/local-sharp';

const endpoint = 'https://drive.kinostudio.tw';
const bucketName = 'kino-pick-overflow';
const region = 'us-east-1';
const r2QuotaBytes = 9_000_000_000;
const oracleQuotaBytes = 30_000_000_000;
const derivativeBudgetBytes = 16_777_216;
const maxUploadBytes = 5_363_466_240;
const secondR2ReservationBytes =
  r2QuotaBytes - 2 * derivativeBudgetBytes - maxUploadBytes;

type TestScope = {
  workspace: { id: string };
  project: { id: string };
  album: { id: string };
};

type AssetRow = {
  id: string;
  asset_kind: string;
  object_key: string;
  storage_node_id: string;
  byte_size: number;
  mime: string;
  checksum_sha256: string;
  state: string;
};

type LiveFixture = {
  db: D1Database;
  env: WorkerEnv;
  owner: string;
  session: string;
  repository: D1UploadRepository;
  createScope(label: string): Promise<TestScope>;
  reserve(scope: TestScope, expectedBytes: number): Promise<{ id: string }>;
  cancel(sessionId: string): Promise<unknown>;
  nodeCommitment(id: string): Promise<{ committedBytes: number }>;
  storageNodeFor(sessionId: string): Promise<{ storage_node_id: string }>;
  dispose(): Promise<void>;
};

function safeFailureCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'UNEXPECTED_FAILURE';
  const candidate = error as { code?: unknown; message?: unknown };
  for (const value of [candidate.code, candidate.message]) {
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(value))
      return value;
  }
  return 'UNEXPECTED_FAILURE';
}

test.skipIf(process.env.KINO_PICK_ORACLE_LIVE !== 'true')(
  'local D1 upload, Oracle processing and R2 reclamation stay node-aware',
  async () => {
    const runId = randomUUID();
    const proofPath = resolve('.local', `oracle-live-pipeline-${runId}.json`);
    const proof: Record<string, unknown> = {
      status: 'in_progress',
      runId,
      startedAt: new Date().toISOString(),
      mode: 'isolated Miniflare D1 and R2 plus real Oracle S3',
      hostedAcceptance: false,
      remotePhotoCleanup: false,
      retainedRemotePhotoKeys: [],
      localD1Disposed: false,
    };
    const persistProof = async () => {
      await mkdir(dirname(proofPath), { recursive: true });
      await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
    };
    let fixtureToDispose: LiveFixture | undefined;
    let failureCode: string | undefined;

    try {
      proof.stage = 'read_fixed_local_credentials';
      await persistProof();
      const raw = JSON.parse(
        await readFile('.local/oracle-private/storage.json', 'utf8'),
      ) as Record<string, unknown>;
      if (
        !raw ||
        raw.endpoint !== endpoint ||
        raw.region !== region ||
        raw.bucketName !== bucketName ||
        typeof raw.accessKeyId !== 'string' ||
        raw.accessKeyId.trim().length === 0 ||
        typeof raw.secretAccessKey !== 'string' ||
        raw.secretAccessKey.trim().length === 0
      )
        throw new Error('ORACLE_CREDENTIAL_FILE_INVALID');
      const credentials: S3SignerCredentials = {
        endpoint,
        region,
        bucketName,
        accessKeyId: raw.accessKeyId,
        secretAccessKey: raw.secretAccessKey,
      };
      proof.stage = 'create_isolated_native_database';
      await persistProof();
      const native =
        // @ts-expect-error The native admission fixture is JavaScript.
        await import('../../apps/worker/tests/oracle-storage-admission-native.mjs');
      const fixture = (await native.createOracleStorageAdmissionFixture({
        mockOracle: false,
        envOverrides: {
          ORACLE_STORAGE_ENDPOINT: endpoint,
          ORACLE_STORAGE_REGION: region,
          ORACLE_STORAGE_BUCKET: bucketName,
          ORACLE_STORAGE_ACCESS_KEY_ID: credentials.accessKeyId,
          ORACLE_STORAGE_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        },
      })) as LiveFixture;
      fixtureToDispose = fixture;
      proof.localDatabase = 'fresh Miniflare D1 with migrations 0001-0065';
      proof.primaryStorage = 'isolated Miniflare R2';
      proof.oracleStorage = 'real HTTPS S3';

      proof.stage = 'enable_local_policy_revision_1';
      const policy = await saveOraclePolicy(
        fixture.env,
        fixture.owner,
        fixture.session,
        {
          requestId: randomUUID(),
          expectedRevision: 0,
          enabled: true,
          quotaGb: 30,
        },
      );
      proof.oraclePolicy = {
        revision: policy.revision,
        quotaGb: policy.quotaGb,
        effectiveEnabled: policy.effectiveEnabled,
      };
      await persistProof();
      expect(policy.revision).toBe(1);
      expect(policy.quotaGb).toBe(30);
      expect(policy.effectiveEnabled).toBe(true);
      const currentPolicy = await readOraclePolicy(fixture.env, fixture.owner);
      expect(currentPolicy.revision).toBe(1);
      const oracleBucket = storageBucketForNode(fixture.env, 'oracle-vm');
      const policyObject = await oracleBucket.get(
        '_kino/system/storage-policy.json',
      );
      expect(policyObject).not.toBeNull();
      const remotePolicy = await policyObject!.json<{
        quotaBytes: number;
        revision: number;
      }>();
      expect(remotePolicy).toEqual({
        quotaBytes: oracleQuotaBytes,
        revision: 1,
      });
      proof.remotePolicyRevision = remotePolicy.revision;
      await persistProof();

      proof.stage = 'fill_primary_with_metadata_reservations';
      const r2FillA = await fixture.reserve(
        await fixture.createScope('live R2 fill A'),
        maxUploadBytes,
      );
      const r2FillB = await fixture.reserve(
        await fixture.createScope('live R2 fill B'),
        secondR2ReservationBytes,
      );
      const fullPrimary = await fixture.nodeCommitment('primary');
      expect(fullPrimary.committedBytes).toBe(r2QuotaBytes);
      expect((await fixture.storageNodeFor(r2FillA.id)).storage_node_id).toBe(
        'primary',
      );
      expect((await fixture.storageNodeFor(r2FillB.id)).storage_node_id).toBe(
        'primary',
      );
      proof.r2MetadataReservations = [
        { uploadSessionId: r2FillA.id, expectedBytes: maxUploadBytes },
        {
          uploadSessionId: r2FillB.id,
          expectedBytes: secondR2ReservationBytes,
        },
      ];
      proof.primaryCommittedBytes = fullPrimary.committedBytes;
      await persistProof();

      proof.stage = 'reserve_real_oracle_upload';
      const scope = await fixture.createScope('live VM upload');
      const width = 256;
      const height = 192;
      const pixels = Buffer.alloc(width * height * 3);
      let seed = 0x4b494e4f;
      for (let index = 0; index < pixels.length; index++) {
        seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
        pixels[index] = seed >>> 24;
      }
      const source = await sharp(pixels, {
        raw: { width, height, channels: 3 },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const sourceSha256 = createHash('sha256').update(source).digest('hex');
      const uploadIntent = {
        workspaceId: scope.workspace.id,
        projectId: scope.project.id,
        albumId: scope.album.id,
        originalFilename: 'oracle-live-pipeline.png',
        expectedBytes: source.byteLength,
        contentType: 'image/png',
        sha256: sourceSha256,
        requestId: randomUUID(),
      };
      const vmSession = await fixture.repository.reserve(uploadIntent);
      const vmNode = await fixture.storageNodeFor(vmSession.id);
      expect(vmNode.storage_node_id).toBe('oracle-vm');
      const original = await fixture.db
        .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
        .bind(vmSession.id)
        .first<{ object_key: string }>();
      if (!original?.object_key) throw new Error('UPLOAD_ORIGINAL_KEY_MISSING');
      proof.actualUpload = {
        uploadSessionId: vmSession.id,
        storageNodeId: vmNode.storage_node_id,
        scope: {
          workspaceId: scope.workspace.id,
          projectId: scope.project.id,
          albumId: scope.album.id,
        },
        originalObjectKey: original.object_key,
        originalBytes: source.byteLength,
        originalSha256: sourceSha256,
        status: 'reserved',
      };
      proof.retainedRemotePhotoKeys = [original.object_key];
      await persistProof();

      proof.stage = 'signed_put_and_complete';
      const authorization = await fixture.repository.authorize(
        vmSession.id,
        { requestId: randomUUID() },
        (nodeId: string) => {
          if (nodeId !== 'oracle-vm') throw new Error('UNEXPECTED_UPLOAD_NODE');
          return credentials;
        },
      );
      const putResponse = await fetch(authorization.url, {
        method: authorization.method,
        headers: {
          ...authorization.headers,
          'Content-Length': String(source.byteLength),
        },
        body: source,
        redirect: 'error',
      });
      proof.signedPutHttpStatus = putResponse.status;
      await putResponse.body?.cancel();
      if (putResponse.status !== 200)
        throw new Error('ORACLE_SIGNED_PUT_FAILED');
      (proof.actualUpload as Record<string, unknown>).status = 'uploaded';
      await persistProof();

      const completion = await fixture.repository.complete(vmSession.id, {
        requestId: randomUUID(),
      });
      const photo = await fixture.db
        .prepare(
          "SELECT p.id AS photoId,v.id AS versionId FROM photo_assets a JOIN photos p ON p.id=a.photo_id AND p.workspace_id=a.workspace_id AND p.project_id=? AND p.album_id=? JOIN photo_versions v ON v.id=a.version_id AND v.photo_id=p.id AND v.workspace_id=p.workspace_id WHERE a.id=? AND a.asset_kind='original'",
        )
        .bind(scope.project.id, scope.album.id, completion.assetId)
        .first<{ photoId: string; versionId: string }>();
      if (!photo?.photoId || !photo.versionId)
        throw new Error('UPLOAD_COMPLETION_SCOPE_MISSING');
      (proof.actualUpload as Record<string, unknown>).completionAssetId =
        completion.assetId;
      (proof.actualUpload as Record<string, unknown>).photoId = photo.photoId;
      (proof.actualUpload as Record<string, unknown>).versionId =
        photo.versionId;
      (proof.actualUpload as Record<string, unknown>).status = 'completed';
      const expectedOutputs = await fixture.db
        .prepare(
          'SELECT kind,object_key AS objectKey FROM image_processing_outputs WHERE job_id=? ORDER BY kind',
        )
        .bind(completion.assetId)
        .all<{ kind: string; objectKey: string }>();
      proof.expectedDerivativeKeys = expectedOutputs.results.map(
        (row) => row.objectKey,
      );
      proof.retainedRemotePhotoKeys = [
        original.object_key,
        ...expectedOutputs.results.map((row) => row.objectKey),
      ];
      await persistProof();

      proof.stage = 'process_on_oracle';
      const processing = await runImageProcessingJob({
        jobId: completion.assetId,
        jobs: new D1ImageProcessingRepository(fixture.db),
        objects: new R2ProcessingObjectStore(oracleBucket),
        processor: new LocalSharpImageProcessor(),
      });
      expect(processing.status).toBe('succeeded');
      const assets = (
        await fixture.db
          .prepare(
            'SELECT id,asset_kind,object_key,storage_node_id,byte_size,mime,checksum_sha256,state FROM photo_assets WHERE version_id=? ORDER BY asset_kind',
          )
          .bind(photo.versionId)
          .all<AssetRow>()
      ).results;
      expect(assets.map((asset) => asset.asset_kind).sort()).toEqual([
        'original',
        'preview',
        'thumbnail',
      ]);
      expect(
        assets.every(
          (asset) =>
            asset.storage_node_id === 'oracle-vm' && asset.state === 'private',
        ),
      ).toBe(true);
      for (const asset of assets) {
        const object = await oracleBucket.head(asset.object_key);
        expect(object?.size).toBe(asset.byte_size);
        expect(
          object?.checksums.sha256
            ? Buffer.from(object.checksums.sha256).toString('hex')
            : null,
        ).toBe(asset.checksum_sha256);
      }

      proof.stage = 'owner_gallery_private_preview_read';
      const gallery = new D1GalleryRepository(
        fixture.db,
        fixture.owner,
        fixture.session,
      );
      const galleryPage = await gallery.list(scope.album.id);
      expect(
        galleryPage.photos.some((entry) => entry.id === photo.photoId),
      ).toBe(true);
      const preview = await gallery.asset(
        photo.photoId,
        photo.versionId,
        'preview',
      );
      expect(preview.storage_node_id).toBe('oracle-vm');
      const privateStorage = new R2StorageAdapter(oracleBucket, 'oracle-vm');
      const previewBytes = await privateStorage.read(
        {
          workspaceId: scope.workspace.id,
          projectId: scope.project.id,
          albumId: scope.album.id,
        },
        preview.object_key,
      );
      const previewAsset = assets.find(
        (asset) => asset.asset_kind === 'preview',
      );
      if (!previewAsset) throw new Error('GALLERY_PREVIEW_ASSET_MISSING');
      expect(createHash('sha256').update(previewBytes).digest('hex')).toBe(
        previewAsset!.checksum_sha256,
      );
      proof.retainedRemotePhotoKeys = assets.map((asset) => asset.object_key);
      proof.photoAssets = assets.map((asset) => ({
        id: asset.id,
        kind: asset.asset_kind,
        objectKey: asset.object_key,
        storageNodeId: asset.storage_node_id,
        bytes: asset.byte_size,
        sha256: asset.checksum_sha256,
        state: asset.state,
      }));
      proof.ownerGalleryPreviewRetrieved = true;
      (proof.actualUpload as Record<string, unknown>).status = 'processed';
      await persistProof();

      proof.stage = 'reclaim_r2_and_check_captured_vm_node';
      await fixture.cancel(r2FillA.id);
      const reclaimedR2 = await fixture.nodeCommitment('primary');
      expect(reclaimedR2.committedBytes).toBe(
        secondR2ReservationBytes + derivativeBudgetBytes,
      );
      const nextR2Scope = await fixture.createScope('live R2 after reclaim');
      const nextR2Session = await fixture.reserve(nextR2Scope, 1);
      expect(
        (await fixture.storageNodeFor(nextR2Session.id)).storage_node_id,
      ).toBe('primary');
      const vmReplay = await fixture.repository.reserve(uploadIntent);
      expect(vmReplay.id).toBe(vmSession.id);
      expect((await fixture.storageNodeFor(vmSession.id)).storage_node_id).toBe(
        'oracle-vm',
      );
      await fixture.cancel(nextR2Session.id);
      await fixture.cancel(r2FillB.id);
      proof.r2Reclamation = {
        cancelledReservationId: r2FillA.id,
        nextNewUploadSessionId: nextR2Session.id,
        nextNewUploadStorageNodeId: 'primary',
        capturedVmSessionId: vmSession.id,
        replayedVmSessionId: vmReplay.id,
        capturedVmStorageNodeId: 'oracle-vm',
        remainingPrimaryCommittedBytes: reclaimedR2.committedBytes,
      };
      proof.stage = 'complete';
    } catch (error) {
      failureCode = safeFailureCode(error);
    }

    try {
      if (fixtureToDispose) {
        await fixtureToDispose.dispose();
        proof.localD1Disposed = true;
      }
    } catch {
      failureCode ??= 'LOCAL_D1_DISPOSE_FAILED';
    }
    proof.status = failureCode ? 'failed' : 'passed';
    proof.failureCode = failureCode;
    proof.completedAt = new Date().toISOString();
    await persistProof();
    if (failureCode)
      throw new Error(`ORACLE_LIVE_PIPELINE_FAILED:${failureCode}`);
  },
  240_000,
);
