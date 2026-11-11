import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { restoreProductionExport } from './rehearse-production-copy.mjs';

const ACCOUNT_ID = 'd3e930465c0df7e89b35de3ca65ea36a';
const SOURCE_BUCKET = 'kino-pick-staging-d3e93046';
const TARGET_BUCKET = 'kino-pick-production';
const SOURCE_SQL_RELATIVE = [
  '.local',
  'production-cutover-20261112',
  'staging67-source.sql',
];
const STATE_RELATIVE = [
  '.local',
  'production-cutover-20261112',
  'r2-copy-initial',
];
const FENCE_MIME = 'application/x-kino-pic-upload-fence';
const MAX_OBJECT_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const EXPECTED_MIGRATION_COUNT = 67;
const SOURCE_CREDENTIAL_FIELDS = [
  'R2_ACCESS_KEY_ID',
  'R2_ACCOUNT_ID',
  'R2_SECRET_ACCESS_KEY',
];
const TARGET_CREDENTIAL_FIELDS = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, '..');
const releaseRoot = path.resolve(workerDir, '..', '..');
const repoRoot = path.resolve(releaseRoot, '..', '..');
const sourceWorkerDir = path.join(repoRoot, 'apps', 'worker');
const sourceCredentialsPath = path.join(
  sourceWorkerDir,
  '.local',
  'staging-r2-secrets.json',
);
const targetCredentialsPath = path.join(
  releaseRoot,
  '.local',
  'production-r2-secrets.json',
);

class CopyFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'CopyFailure';
    this.code = code;
  }
}

function fail(code) {
  throw new CopyFailure(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const EMPTY_SHA256 = sha256(Buffer.alloc(0));

function canonicalJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function safeObjectKey(key) {
  requireCondition(
    typeof key === 'string' &&
      key.length > 0 &&
      Buffer.byteLength(key, 'utf8') <= 1024 &&
      !key.startsWith('/') &&
      !key.includes('..') &&
      !key.includes('%') &&
      !key.includes('\\') &&
      !/[\u0000-\u001f\u007f]/u.test(key) &&
      key.split('/').every((part) => part.length > 0),
    'OBJECT_KEY_INVALID',
  );
  return key;
}

function assetRow(row) {
  requireCondition(
    typeof row.id === 'string' &&
      row.id.length > 0 &&
      row.storage_node_id === 'primary' &&
      ['original', 'preview', 'thumbnail', 'delivery'].includes(
        row.asset_kind,
      ) &&
      Number.isSafeInteger(row.byte_size) &&
      row.byte_size > 0 &&
      row.byte_size <= MAX_OBJECT_BYTES &&
      typeof row.mime === 'string' &&
      ['image/jpeg', 'image/png', 'image/webp'].includes(row.mime) &&
      typeof row.checksum_sha256 === 'string' &&
      /^[0-9a-f]{64}$/.test(row.checksum_sha256),
    'ASSET_ROW_INVALID',
  );
  return {
    assetId: row.id,
    assetKind: row.asset_kind,
    objectKey: safeObjectKey(row.object_key),
    byteSize: row.byte_size,
    mime: row.mime,
    sha256: row.checksum_sha256,
  };
}

function queryOne(db, sql) {
  try {
    return db.prepare(sql).get();
  } catch {
    fail('SOURCE_SCHEMA_UNSUPPORTED');
  }
}

function queryAll(db, sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    fail('SOURCE_SCHEMA_UNSUPPORTED');
  }
}

function countByStatus(rows, allowedStatuses) {
  const result = Object.fromEntries(
    allowedStatuses.map((status) => [status, 0]),
  );
  for (const row of rows) {
    requireCondition(
      Object.hasOwn(result, row.status) &&
        Number.isSafeInteger(row.count) &&
        row.count >= 0,
      'SOURCE_STATUS_UNSUPPORTED',
    );
    result[row.status] += row.count;
  }
  return result;
}

export function buildProductionR2Manifest(db, sourceSqlSha256) {
  requireCondition(
    /^[0-9a-f]{64}$/.test(sourceSqlSha256),
    'SOURCE_SQL_HASH_INVALID',
  );

  const migrationCount = queryOne(
    db,
    'SELECT count(*) AS count FROM d1_migrations',
  )?.count;
  requireCondition(
    migrationCount === EXPECTED_MIGRATION_COUNT,
    'SOURCE_SCHEMA_NOT_CURRENT_67',
  );
  requireCondition(
    queryOne(
      db,
      "SELECT count(*) AS count FROM storage_nodes WHERE id='primary'",
    )?.count === 1,
    'PRIMARY_STORAGE_NODE_MISSING',
  );

  const deletion = queryOne(
    db,
    "SELECT (SELECT count(*) FROM manual_album_deletion_jobs WHERE status='deleting') AS active_jobs, " +
      "(SELECT count(*) FROM manual_album_deletion_items WHERE status='pending') AS pending_items, " +
      "(SELECT count(*) FROM manual_album_deletion_items WHERE status='reclaimed' AND storage_node_id='primary') AS reclaimed_items",
  );
  requireCondition(
    deletion.active_jobs === 0 && deletion.pending_items === 0,
    'PENDING_DELETION_STATE',
  );
  requireCondition(
    deletion.reclaimed_items === 0,
    'RECLAIMED_TOMBSTONES_UNSUPPORTED',
  );

  const rawAssets = queryAll(
    db,
    'SELECT id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256 ' +
      "FROM photo_assets WHERE storage_node_id='primary' ORDER BY object_key",
  );
  const activeAssets = rawAssets.map(assetRow);
  const assetKeys = new Set();
  for (const asset of activeAssets) {
    requireCondition(
      !assetKeys.has(asset.objectKey),
      'DUPLICATE_PRIMARY_OBJECT_KEY',
    );
    assetKeys.add(asset.objectKey);
  }

  const rawFences = queryAll(
    db,
    'SELECT f.upload_session_id,u.object_key AS session_object_key,f.object_key, ' +
      'f.reason,f.actor_type,u.status,u.storage_node_id ' +
      'FROM upload_key_fences f JOIN upload_sessions u ON u.id=f.upload_session_id ' +
      "WHERE u.storage_node_id='primary' ORDER BY f.object_key",
  );
  const uploadFences = rawFences.map((row) => {
    requireCondition(
      row.object_key === row.session_object_key &&
        ['cancelled', 'expired'].includes(row.status) &&
        ['cancel', 'expire'].includes(row.reason) &&
        ['user', 'system'].includes(row.actor_type),
      'UPLOAD_FENCE_ROW_INVALID',
    );
    requireCondition(
      !assetKeys.has(row.object_key),
      'UPLOAD_FENCE_ASSET_KEY_COLLISION',
    );
    safeObjectKey(row.object_key);
    return {
      uploadSessionId: row.upload_session_id,
      objectKey: row.object_key,
      reason: row.reason,
      actorType: row.actor_type,
      byteSize: 0,
      mime: FENCE_MIME,
      sha256: EMPTY_SHA256,
    };
  });

  const nonPrimary = queryOne(
    db,
    "SELECT count(*) AS count,coalesce(sum(byte_size),0) AS bytes FROM photo_assets WHERE storage_node_id<>'primary'",
  );
  const uploads = queryOne(
    db,
    "SELECT count(*) AS sessions,coalesce(sum(CASE WHEN status='reserved' THEN 1 ELSE 0 END),0) AS reserved_sessions," +
      "coalesce(sum(CASE WHEN status='reserved' THEN expected_bytes ELSE 0 END),0) AS reserved_expected_bytes " +
      'FROM upload_sessions',
  );
  const reservations = queryOne(
    db,
    'SELECT count(*) AS count,coalesce(sum(reserved_bytes),0) AS bytes FROM storage_reservations',
  );
  const liveAuthorizations = queryOne(
    db,
    "SELECT count(*) AS count FROM upload_authorizations WHERE expires_at_ms>CAST(unixepoch('subsec')*1000 AS INTEGER)",
  );
  const processingRows = queryAll(
    db,
    'SELECT status,count(*) AS count FROM image_processing_jobs GROUP BY status',
  );
  const processing = countByStatus(processingRows, [
    'queued',
    'running',
    'retryable',
    'needs_review',
    'succeeded',
    'unsupported',
  ]);

  const assetBytes = activeAssets.reduce((sum, row) => sum + row.byteSize, 0);
  requireCondition(
    Number.isSafeInteger(assetBytes),
    'PRIMARY_ASSET_TOTAL_UNSAFE',
  );
  return {
    version: 1,
    mode: 'initial-non-overwrite-copy-checkpoint',
    accountId: ACCOUNT_ID,
    sourceBucket: SOURCE_BUCKET,
    targetBucket: TARGET_BUCKET,
    sourceSqlSha256,
    migrationCount,
    activeAssets,
    uploadFences,
    aggregates: {
      primaryAssetCount: activeAssets.length,
      primaryAssetBytes: assetBytes,
      uploadFenceCount: uploadFences.length,
      nonPrimaryAssetCount: nonPrimary.count,
      nonPrimaryAssetBytes: nonPrimary.bytes,
      pendingSnapshotActivity: {
        sourceSnapshotFrozen: false,
        reservedUploadSessions: uploads.reserved_sessions,
        reservedUploadExpectedBytes: uploads.reserved_expected_bytes,
        totalUploadSessions: uploads.sessions,
        outstandingStorageReservations: reservations.count,
        outstandingStorageReservationBytes: reservations.bytes,
        liveUploadAuthorizations: liveAuthorizations.count,
        imageProcessingJobs: processing,
        activeDeletionJobs: deletion.active_jobs,
        pendingPrimaryDeletionItems: deletion.pending_items,
      },
      productionCutoverReady: false,
    },
    metadataPolicy: {
      assetContentTypeFromDatabase: true,
      otherAssetHttpAndCustomMetadataCopied: false,
      uploadFenceMimeSessionAndChecksumCopied: true,
    },
  };
}

function objectUrl(bucket, key) {
  requireCondition(
    bucket === SOURCE_BUCKET || bucket === TARGET_BUCKET,
    'BUCKET_NOT_ALLOWLISTED',
  );
  const encodedKey = safeObjectKey(key)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${bucket}/${encodedKey}`;
}

async function signedRequest({ client, bucket, key, method, headers, body }) {
  const requestHeaders = new Headers(headers);
  if (method === 'GET') requestHeaders.set('x-amz-checksum-mode', 'ENABLED');
  try {
    return await client.fetch(objectUrl(bucket, key), {
      method,
      headers: requestHeaders,
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    fail(method === 'PUT' ? 'R2_PUT_NETWORK_FAILED' : 'R2_GET_NETWORK_FAILED');
  }
}

async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Provider response bodies are never inspected or logged.
  }
}

async function readBoundedBody(response, expectedBytes) {
  const contentLength = response.headers.get('content-length');
  requireCondition(
    contentLength !== null &&
      /^\d+$/.test(contentLength) &&
      Number(contentLength) === expectedBytes,
    'R2_CONTENT_LENGTH_MISMATCH',
  );
  if (!response.body) {
    requireCondition(expectedBytes === 0, 'R2_BODY_MISSING');
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      total += chunk.length;
      if (total > expectedBytes || total > MAX_OBJECT_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Do not read or expose provider error bodies.
        }
        fail('R2_BODY_EXCEEDS_EXPECTED_SIZE');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof CopyFailure) throw error;
    fail('R2_BODY_READ_FAILED');
  } finally {
    reader.releaseLock();
  }
  requireCondition(total === expectedBytes, 'R2_BODY_SIZE_MISMATCH');
  return Buffer.concat(chunks, total);
}

function contentType(response) {
  return (
    response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase() ?? null
  );
}

async function fetchAsset(request, client, bucket, asset) {
  let response;
  try {
    response = await request({
      client,
      bucket,
      key: asset.objectKey,
      method: 'GET',
    });
  } catch {
    fail(bucket === SOURCE_BUCKET ? 'SOURCE_GET_FAILED' : 'TARGET_GET_FAILED');
  }
  return readAssetResponse(response, asset, bucket === TARGET_BUCKET);
}

function checksumBase64(hexDigest) {
  requireCondition(/^[0-9a-f]{64}$/.test(hexDigest), 'CHECKSUM_INVALID');
  return Buffer.from(hexDigest, 'hex').toString('base64');
}

async function readAssetResponse(response, asset, requireStoredChecksum) {
  try {
    requireCondition(
      !response.redirected && response.status === 200,
      'R2_GET_STATUS_UNEXPECTED',
    );
    requireCondition(
      contentType(response) === asset.mime,
      'R2_ASSET_MIME_MISMATCH',
    );
    const storedChecksum = response.headers.get('x-amz-checksum-sha256');
    if (requireStoredChecksum)
      requireCondition(
        storedChecksum === checksumBase64(asset.sha256),
        'R2_ASSET_CHECKSUM_METADATA_MISMATCH',
      );
    else if (storedChecksum !== null)
      requireCondition(
        storedChecksum === checksumBase64(asset.sha256),
        'R2_ASSET_CHECKSUM_METADATA_MISMATCH',
      );
    const bytes = await readBoundedBody(response, asset.byteSize);
    requireCondition(
      sha256(bytes) === asset.sha256,
      'R2_ASSET_SHA256_MISMATCH',
    );
    return bytes;
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
}

async function fetchFence(request, client, bucket, fence) {
  let response;
  try {
    response = await request({
      client,
      bucket,
      key: fence.objectKey,
      method: 'GET',
    });
  } catch {
    fail(
      bucket === SOURCE_BUCKET
        ? 'SOURCE_FENCE_GET_FAILED'
        : 'TARGET_FENCE_GET_FAILED',
    );
  }
  try {
    return await fetchFenceResponse(response, fence, bucket === TARGET_BUCKET);
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
}

async function writeBackup(backupDir, bytes, digest) {
  const filePath = path.join(backupDir, digest + '.bin');
  let current;
  try {
    const info = await lstat(filePath);
    requireCondition(
      info.isFile() && !info.isSymbolicLink(),
      'LOCAL_BACKUP_NOT_REGULAR_FILE',
    );
    current = await readFile(filePath);
  } catch (error) {
    if (error instanceof CopyFailure) throw error;
    if (error?.code !== 'ENOENT') fail('LOCAL_BACKUP_READ_FAILED');
  }
  if (current !== undefined) {
    requireCondition(
      sha256(current) === digest && current.equals(bytes),
      'LOCAL_BACKUP_MISMATCH',
    );
    return;
  }

  try {
    const handle = await open(filePath, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    fail('LOCAL_BACKUP_WRITE_FAILED');
  }
}

async function ensureManifestFile(directory, manifest) {
  const filePath = path.join(directory, 'manifest.json');
  const expected = canonicalJson(manifest);
  try {
    const existing = await readFile(filePath, 'utf8');
    requireCondition(existing === expected, 'LOCAL_MANIFEST_MISMATCH');
  } catch (error) {
    if (error instanceof CopyFailure) throw error;
    if (error?.code !== 'ENOENT') fail('LOCAL_MANIFEST_READ_FAILED');
    try {
      const handle = await open(filePath, 'wx', 0o600);
      try {
        await handle.writeFile(expected, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      fail('LOCAL_MANIFEST_WRITE_FAILED');
    }
  }
}

async function readCheckpoint(filePath, sourceSqlSha256) {
  try {
    const value = JSON.parse(await readFile(filePath, 'utf8'));
    requireCondition(
      isRecord(value) &&
        value.version === 1 &&
        value.sourceSqlSha256 === sourceSqlSha256 &&
        Array.isArray(value.verifiedAssetKeys) &&
        Array.isArray(value.verifiedFenceKeys),
      'LOCAL_CHECKPOINT_INVALID',
    );
    return {
      version: 1,
      sourceSqlSha256,
      verifiedAssetKeys: new Set(value.verifiedAssetKeys),
      verifiedFenceKeys: new Set(value.verifiedFenceKeys),
    };
  } catch (error) {
    if (error instanceof CopyFailure) throw error;
    if (error?.code === 'ENOENT') {
      return {
        version: 1,
        sourceSqlSha256,
        verifiedAssetKeys: new Set(),
        verifiedFenceKeys: new Set(),
      };
    }
    fail('LOCAL_CHECKPOINT_READ_FAILED');
  }
}

async function writeJsonAtomic(filePath, value) {
  const tempPath = filePath + '.' + randomUUID() + '.tmp';
  try {
    const handle = await open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(canonicalJson(value), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, filePath);
  } catch {
    try {
      await unlink(tempPath);
    } catch {
      // The temp file contains only local checkpoint metadata.
    }
    fail('LOCAL_CHECKPOINT_WRITE_FAILED');
  }
}

function keyDigest(key) {
  return sha256(Buffer.from(key, 'utf8'));
}

export async function copyProductionR2Manifest({
  manifest,
  sourceClient,
  targetClient,
  stateDirectory,
  backupDirectory,
  request = signedRequest,
}) {
  requireCondition(
    isRecord(manifest) &&
      manifest.version === 1 &&
      manifest.mode === 'initial-non-overwrite-copy-checkpoint' &&
      manifest.sourceBucket === SOURCE_BUCKET &&
      manifest.targetBucket === TARGET_BUCKET &&
      Array.isArray(manifest.activeAssets) &&
      Array.isArray(manifest.uploadFences),
    'COPY_MANIFEST_INVALID',
  );
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await ensureManifestFile(stateDirectory, manifest);

  const checkpointPath = path.join(stateDirectory, 'checkpoint.json');
  const checkpoint = await readCheckpoint(
    checkpointPath,
    manifest.sourceSqlSha256,
  );
  const assetKeys = new Set(checkpoint.verifiedAssetKeys);
  const fenceKeys = new Set(checkpoint.verifiedFenceKeys);
  let copiedAssets = 0;
  let matchingAssets = 0;
  let copiedFences = 0;
  let matchingFences = 0;
  let copiedAssetBytes = 0;

  const persistCheckpoint = () =>
    writeJsonAtomic(checkpointPath, {
      version: 1,
      sourceSqlSha256: manifest.sourceSqlSha256,
      verifiedAssetKeys: [...assetKeys].sort(),
      verifiedFenceKeys: [...fenceKeys].sort(),
    });

  for (const asset of manifest.activeAssets) {
    const sourceBytes = await fetchAsset(
      request,
      sourceClient,
      SOURCE_BUCKET,
      asset,
    );
    await writeBackup(backupDirectory, sourceBytes, asset.sha256);

    let destinationBytes = null;
    let response;
    try {
      response = await request({
        client: targetClient,
        bucket: TARGET_BUCKET,
        key: asset.objectKey,
        method: 'GET',
      });
    } catch {
      fail('TARGET_GET_FAILED');
    }
    requireCondition(!response.redirected, 'TARGET_GET_REDIRECT_REJECTED');
    if (response.status === 404) {
      await cancelBody(response);
      let putResponse;
      try {
        putResponse = await request({
          client: targetClient,
          bucket: TARGET_BUCKET,
          key: asset.objectKey,
          method: 'PUT',
          headers: {
            'If-None-Match': '*',
            'Content-Type': asset.mime,
            'x-amz-checksum-sha256': checksumBase64(asset.sha256),
          },
          body: sourceBytes,
        });
      } catch {
        fail('TARGET_PUT_FAILED');
      }
      const putStatus = putResponse.status;
      await cancelBody(putResponse);
      requireCondition(
        (putStatus >= 200 && putStatus < 300) ||
          putStatus === 409 ||
          putStatus === 412,
        'TARGET_PUT_STATUS_UNEXPECTED',
      );
      destinationBytes = await fetchAsset(
        request,
        targetClient,
        TARGET_BUCKET,
        asset,
      );
      copiedAssets += 1;
      copiedAssetBytes += destinationBytes.byteLength;
    } else if (response.status === 200) {
      try {
        destinationBytes = await readAssetResponse(response, asset, true);
      } catch (error) {
        await cancelBody(response);
        throw error;
      }
      requireCondition(
        sha256(destinationBytes) === asset.sha256,
        'TARGET_ASSET_MISMATCH',
      );
      matchingAssets += 1;
    } else {
      await cancelBody(response);
      fail('TARGET_GET_STATUS_UNEXPECTED');
    }
    requireCondition(
      destinationBytes.equals(sourceBytes),
      'TARGET_ASSET_MISMATCH',
    );
    assetKeys.add(keyDigest(asset.objectKey));
    await persistCheckpoint();
  }

  for (const fence of manifest.uploadFences) {
    const sourceBytes = await fetchFence(
      request,
      sourceClient,
      SOURCE_BUCKET,
      fence,
    );
    await writeBackup(backupDirectory, sourceBytes, sha256(sourceBytes));

    let response;
    try {
      response = await request({
        client: targetClient,
        bucket: TARGET_BUCKET,
        key: fence.objectKey,
        method: 'GET',
      });
    } catch {
      fail('TARGET_FENCE_GET_FAILED');
    }
    requireCondition(
      !response.redirected,
      'TARGET_FENCE_GET_REDIRECT_REJECTED',
    );
    if (response.status === 404) {
      await cancelBody(response);
      let putResponse;
      try {
        putResponse = await request({
          client: targetClient,
          bucket: TARGET_BUCKET,
          key: fence.objectKey,
          method: 'PUT',
          headers: {
            'If-None-Match': '*',
            'Content-Type': FENCE_MIME,
            'x-amz-meta-kinoUploadFence': fence.uploadSessionId,
            'x-amz-checksum-sha256': checksumBase64(EMPTY_SHA256),
          },
          body: sourceBytes,
        });
      } catch {
        fail('TARGET_FENCE_PUT_FAILED');
      }
      const putStatus = putResponse.status;
      await cancelBody(putResponse);
      requireCondition(
        (putStatus >= 200 && putStatus < 300) ||
          putStatus === 409 ||
          putStatus === 412,
        'TARGET_FENCE_PUT_STATUS_UNEXPECTED',
      );
      await fetchFence(request, targetClient, TARGET_BUCKET, fence);
      copiedFences += 1;
    } else if (response.status === 200) {
      try {
        await fetchFenceResponse(response, fence, true);
      } catch (error) {
        if (error instanceof CopyFailure) throw error;
        fail('TARGET_FENCE_MISMATCH');
      }
      matchingFences += 1;
    } else {
      await cancelBody(response);
      fail('TARGET_FENCE_GET_STATUS_UNEXPECTED');
    }
    fenceKeys.add(keyDigest(fence.objectKey));
    await persistCheckpoint();
  }

  return {
    copiedAssets,
    matchingAssets,
    verifiedAssets: copiedAssets + matchingAssets,
    copiedAssetBytes,
    copiedFences,
    matchingFences,
    verifiedFences: copiedFences + matchingFences,
    checkpointAssetCount: assetKeys.size,
    checkpointFenceCount: fenceKeys.size,
    overwrittenObjects: 0,
    deletedObjects: 0,
  };
}

async function fetchFenceResponse(response, fence, requireStoredChecksum) {
  try {
    requireCondition(
      !response.redirected && response.status === 200,
      'R2_FENCE_STATUS_UNEXPECTED',
    );
    requireCondition(
      contentType(response) === FENCE_MIME,
      'R2_FENCE_MIME_MISMATCH',
    );
    requireCondition(
      response.headers.get('x-amz-meta-kinouploadfence') ===
        fence.uploadSessionId,
      'R2_FENCE_METADATA_MISMATCH',
    );
    const storedChecksum = response.headers.get('x-amz-checksum-sha256');
    if (requireStoredChecksum)
      requireCondition(
        storedChecksum === checksumBase64(EMPTY_SHA256),
        'R2_FENCE_CHECKSUM_METADATA_MISMATCH',
      );
    else if (storedChecksum !== null)
      requireCondition(
        storedChecksum === checksumBase64(EMPTY_SHA256),
        'R2_FENCE_CHECKSUM_METADATA_MISMATCH',
      );
    const bytes = await readBoundedBody(response, 0);
    requireCondition(bytes.byteLength === 0, 'R2_FENCE_NOT_ZERO_BYTES');
    return bytes;
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
}

async function readCredentials(filePath, expectAccountId) {
  let content;
  try {
    const info = await lstat(filePath);
    requireCondition(
      info.isFile() && !info.isSymbolicLink(),
      'CREDENTIAL_FILE_INVALID',
    );
    content = await readFile(filePath, 'utf8');
  } catch {
    fail('CREDENTIAL_FILE_UNAVAILABLE');
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch {
    fail('CREDENTIAL_FILE_INVALID');
  }
  const expectedFields = expectAccountId
    ? SOURCE_CREDENTIAL_FIELDS
    : TARGET_CREDENTIAL_FIELDS;
  requireCondition(
    isRecord(value) &&
      JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify(expectedFields) &&
      (!expectAccountId || value.R2_ACCOUNT_ID === ACCOUNT_ID) &&
      typeof value.R2_ACCESS_KEY_ID === 'string' &&
      value.R2_ACCESS_KEY_ID.trim().length > 0 &&
      typeof value.R2_SECRET_ACCESS_KEY === 'string' &&
      value.R2_SECRET_ACCESS_KEY.trim().length > 0,
    'CREDENTIAL_FILE_INVALID',
  );
  return {
    accessKeyId: value.R2_ACCESS_KEY_ID,
    secretAccessKey: value.R2_SECRET_ACCESS_KEY,
  };
}

function makeClient(credentials) {
  return new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: 's3',
    region: 'auto',
    retries: 0,
  });
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

async function prepareProtectedState(sourceSqlSha256) {
  const cutoverDirectory = path.join(
    releaseRoot,
    ...SOURCE_SQL_RELATIVE.slice(0, 2),
  );
  const cutoverReal = await realpath(cutoverDirectory).catch(() =>
    fail('PROTECTED_SOURCE_DIRECTORY_UNAVAILABLE'),
  );
  const stateBase = path.join(releaseRoot, ...STATE_RELATIVE);
  await mkdir(stateBase, { recursive: true, mode: 0o700 }).catch(() =>
    fail('PROTECTED_STATE_DIRECTORY_UNAVAILABLE'),
  );
  const stateBaseReal = await realpath(stateBase).catch(() =>
    fail('PROTECTED_STATE_DIRECTORY_UNAVAILABLE'),
  );
  requireCondition(
    isWithin(cutoverReal, stateBaseReal),
    'PROTECTED_STATE_PATH_INVALID',
  );

  const stateDirectory = path.join(stateBaseReal, sourceSqlSha256);
  const backupDirectory = path.join(stateBaseReal, 'objects');
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 }).catch(() =>
    fail('PROTECTED_STATE_DIRECTORY_UNAVAILABLE'),
  );
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 }).catch(() =>
    fail('PROTECTED_STATE_DIRECTORY_UNAVAILABLE'),
  );
  const stateReal = await realpath(stateDirectory).catch(() =>
    fail('PROTECTED_STATE_PATH_INVALID'),
  );
  const backupReal = await realpath(backupDirectory).catch(() =>
    fail('PROTECTED_STATE_PATH_INVALID'),
  );
  requireCondition(
    isWithin(stateBaseReal, stateReal) && isWithin(stateBaseReal, backupReal),
    'PROTECTED_STATE_PATH_INVALID',
  );
  return { stateDirectory: stateReal, backupDirectory: backupReal };
}

async function writeProof(filePath, proof) {
  await writeJsonAtomic(filePath, proof);
}

async function runProductionCopy() {
  requireCondition(
    process.argv.slice(2).length === 1 &&
      process.argv[2] === '--copy-production',
    'USAGE_REQUIRES_COPY_PRODUCTION_FLAG',
  );

  let sourceSql;
  let sourceSqlBytes;
  const sourceSqlPath = path.join(releaseRoot, ...SOURCE_SQL_RELATIVE);
  try {
    sourceSqlBytes = await readFile(sourceSqlPath);
    sourceSql = sourceSqlBytes.toString('utf8');
  } catch {
    fail('SOURCE_SQL_UNAVAILABLE');
  }
  const sourceSqlSha256 = sha256(sourceSqlBytes);
  let restored;
  try {
    restored = restoreProductionExport(sourceSql);
  } catch {
    fail('SOURCE_SQL_RESTORE_FAILED');
  }

  try {
    const manifest = buildProductionR2Manifest(restored.db, sourceSqlSha256);
    const [sourceCredentials, targetCredentials] = await Promise.all([
      readCredentials(sourceCredentialsPath, true),
      readCredentials(targetCredentialsPath, false),
    ]);
    const state = await prepareProtectedState(sourceSqlSha256);
    const result = await copyProductionR2Manifest({
      manifest,
      sourceClient: makeClient(sourceCredentials),
      targetClient: makeClient(targetCredentials),
      ...state,
    });
    const proof = {
      version: 1,
      mode: manifest.mode,
      accountId: ACCOUNT_ID,
      sourceBucket: SOURCE_BUCKET,
      targetBucket: TARGET_BUCKET,
      sourceSqlSha256,
      manifestSha256: sha256(Buffer.from(canonicalJson(manifest), 'utf8')),
      schemaMigrationCount: manifest.migrationCount,
      copied: result,
      sourceSnapshot: manifest.aggregates,
      productionCutoverReady: false,
      destinationDeleteCount: 0,
      overwrittenObjectCount: 0,
    };
    await writeProof(path.join(state.stateDirectory, 'proof.json'), proof);
    console.log(JSON.stringify(proof));
  } finally {
    restored.db.close();
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runProductionCopy().catch((error) => {
    const code =
      typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
        ? error.code
        : 'UNEXPECTED_FAILURE';
    console.error('R2_COPY_FAILED ' + code);
    process.exitCode = 1;
  });
}
