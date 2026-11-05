import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, writeFile } from 'node:fs/promises';
import { test } from 'vitest';
import { R2StorageAdapter } from '../../apps/worker/src/r2-storage';
import {
  S3StorageBucket,
  type S3StorageCredentials,
} from '../../apps/worker/src/s3-storage-bucket';

const enabled = process.env.KINO_PICK_ORACLE_CLEANUP === 'true';
const proofPath =
  '.local/oracle-live-pipeline-4ec43921-00c3-457c-a4f2-de4d6007b853.json';
const credentialsPath = '.local/oracle-private/storage.json';
const journalPath = '.local/oracle-witness-cleanup.json';
const proofRunId = '4ec43921-00c3-457c-a4f2-de4d6007b853';
const proofSha256 =
  '0f5a2fbe9b6419c7951179f511c996a326f6708064eafb8885ec237c1ccd7a25';
const expectedBytes = 213_767;

type Scope = { workspaceId: string; projectId: string; albumId: string };
type Asset = {
  id: string;
  objectKey: string;
  bytes: number;
  sha256: string;
  kind: string;
  storageNodeId: string;
  state: string;
};
type PipelineProof = {
  status?: string;
  runId?: string;
  stage?: string;
  localD1Disposed?: boolean;
  remotePhotoCleanup?: boolean;
  actualUpload?: {
    scope?: Scope;
    status?: string;
    storageNodeId?: string;
    originalObjectKey?: string;
    completionAssetId?: string;
  };
  photoAssets?: Asset[];
  retainedRemotePhotoKeys?: string[];
  expectedDerivativeKeys?: string[];
};
type JournalAsset = Pick<Asset, 'id' | 'objectKey' | 'bytes' | 'sha256'> & {
  verified: boolean;
};
type Journal = {
  proofRunId: string;
  jobId: string;
  scope: Scope;
  expectedBytes: number;
  status: 'prepared' | 'in_progress' | 'passed';
  assets: JournalAsset[];
};

function requireProof(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function scopeOf(proof: PipelineProof): Scope {
  const scope = proof.actualUpload?.scope;
  requireProof(
    scope &&
      /^[0-9a-f-]{36}$/i.test(scope.workspaceId) &&
      /^[0-9a-f-]{36}$/i.test(scope.projectId) &&
      /^[0-9a-f-]{36}$/i.test(scope.albumId),
    'PROOF_SCOPE_INVALID',
  );
  return scope as Scope;
}

async function saveJournal(journal: Journal) {
  const temp = `${journalPath}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(journal, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temp, journalPath);
}

test.skipIf(!enabled)(
  'reclaims only the fixed synthetic Oracle pipeline witnesses to permanent fences',
  async () => {
    let phase = 'proof';
    try {
      const proofBytes = await readFile(proofPath);
      requireProof(
        createHash('sha256').update(proofBytes).digest('hex') === proofSha256,
        'PROOF_HASH_INVALID',
      );
      const proof = JSON.parse(proofBytes.toString('utf8')) as PipelineProof;
      const scope = scopeOf(proof);
      const assets = Array.isArray(proof.photoAssets) ? proof.photoAssets : [];
      const prefix = `${scope.workspaceId}/${scope.projectId}/${scope.albumId}/`;
      requireProof(
        proof.status === 'passed' &&
          proof.runId === proofRunId &&
          proof.stage === 'complete' &&
          proof.localD1Disposed === true &&
          proof.remotePhotoCleanup === false &&
          proof.actualUpload?.status === 'processed' &&
          proof.actualUpload?.storageNodeId === 'oracle-vm' &&
          assets.length === 3 &&
          JSON.stringify(assets.map((asset) => asset.kind).sort()) ===
            JSON.stringify(['original', 'preview', 'thumbnail']) &&
          assets.every(
            (asset) =>
              asset.storageNodeId === 'oracle-vm' &&
              asset.state === 'private' &&
              /^[0-9a-f-]{36}$/i.test(asset.id) &&
              Number.isSafeInteger(asset.bytes) &&
              asset.bytes > 0 &&
              /^[0-9a-f]{64}$/i.test(asset.sha256) &&
              asset.objectKey.length <= 1024 &&
              asset.objectKey.startsWith(prefix) &&
              !asset.objectKey.includes('..') &&
              !asset.objectKey.includes('%') &&
              !asset.objectKey.includes('\\'),
          ) &&
          assets.reduce((sum, asset) => sum + asset.bytes, 0) ===
            expectedBytes &&
          proof.actualUpload?.originalObjectKey ===
            assets.find((asset) => asset.kind === 'original')?.objectKey &&
          proof.actualUpload?.completionAssetId ===
            assets.find((asset) => asset.kind === 'original')?.id &&
          JSON.stringify(proof.retainedRemotePhotoKeys) ===
            JSON.stringify(assets.map((asset) => asset.objectKey)) &&
          JSON.stringify(proof.expectedDerivativeKeys) ===
            JSON.stringify(
              assets
                .filter((asset) => asset.kind !== 'original')
                .map((asset) => asset.objectKey),
            ),
        'PROOF_WITNESSES_INVALID',
      );

      phase = 'journal';
      let journal: Journal;
      try {
        const info = await lstat(journalPath);
        requireProof(info.isFile() && !info.isSymbolicLink(), 'JOURNAL_UNSAFE');
        journal = JSON.parse(await readFile(journalPath, 'utf8')) as Journal;
        requireProof(
          journal.proofRunId === proofRunId &&
            /^[0-9a-f-]{36}$/i.test(journal.jobId) &&
            JSON.stringify(journal.scope) === JSON.stringify(scope) &&
            journal.expectedBytes === expectedBytes &&
            ['prepared', 'in_progress', 'passed'].includes(journal.status) &&
            journal.assets.length === assets.length &&
            journal.assets.every(
              (item, index) =>
                item.id === assets[index]?.id &&
                item.objectKey === assets[index]?.objectKey &&
                item.bytes === assets[index]?.bytes &&
                item.sha256 === assets[index]?.sha256 &&
                typeof item.verified === 'boolean',
            ),
          'JOURNAL_MISMATCH',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        journal = {
          proofRunId,
          jobId: randomUUID(),
          scope,
          expectedBytes,
          status: 'prepared',
          assets: assets.map(({ id, objectKey, bytes, sha256 }) => ({
            id,
            objectKey,
            bytes,
            sha256,
            verified: false,
          })),
        };
        await saveJournal(journal);
      }

      phase = 'credentials';
      const credentials = JSON.parse(
        await readFile(credentialsPath, 'utf8'),
      ) as S3StorageCredentials;
      const bucket = new S3StorageBucket(credentials);
      const storage = new R2StorageAdapter(bucket, 'oracle-vm');
      journal.status = 'in_progress';
      await saveJournal(journal);

      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index]!;
        phase = 'fence';
        await storage.eraseAssetToFence(scope, asset, journal.jobId);
        phase = 'verify';
        const fence = await bucket.head(asset.objectKey);
        requireProof(
          fence?.size === 0 &&
            fence.httpMetadata?.contentType ===
              'application/x-kino-pic-deleted-asset' &&
            fence.customMetadata?.kinoDeletionAsset === asset.id &&
            fence.customMetadata?.kinoDeletionJob === journal.jobId,
          'FENCE_UNVERIFIED',
        );
        journal.assets[index]!.verified = true;
        journal.status = 'in_progress';
        await saveJournal(journal);
      }
      requireProof(
        journal.assets.every((asset) => asset.verified),
        'RECEIPT_INCOMPLETE',
      );
      journal.status = 'passed';
      await saveJournal(journal);
    } catch {
      throw new Error(`ORACLE_WITNESS_CLEANUP_FAILED:${phase}`);
    }
  },
  120_000,
);
