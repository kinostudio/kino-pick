import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyProductionR2Manifest } from './copy-production-r2.mjs';

const sourceBucket = 'kino-pick-staging-d3e93046';
const targetBucket = 'kino-pick-production';
const fenceMime = 'application/x-kino-pic-upload-fence';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mapKey = (bucket, key) => bucket + '\u0000' + key;

test('checkpoints immutable assets and zero-byte upload fences without overwrites', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kino-r2-copy-selfcheck-'));
  try {
    const stateDirectory = path.join(root, 'snapshot');
    const backupDirectory = path.join(root, 'objects');
    const assetBytes = Buffer.from('verified-photo-bytes');
    const existingBytes = Buffer.from('already-copied-photo');
    const assetKey = 'workspace/project/album/photo/original.jpg';
    const existingKey = 'workspace/project/album/photo-2/original.jpg';
    const fenceKey = 'workspace/project/album/upload-session/original';
    const fenceId = 'upload-session';
    const stored = new Map([
      [
        mapKey(sourceBucket, assetKey),
        { bytes: assetBytes, mime: 'image/jpeg' },
      ],
      [
        mapKey(sourceBucket, existingKey),
        { bytes: existingBytes, mime: 'image/jpeg' },
      ],
      [
        mapKey(targetBucket, existingKey),
        { bytes: existingBytes, mime: 'image/jpeg' },
      ],
      [
        mapKey(sourceBucket, fenceKey),
        {
          bytes: Buffer.alloc(0),
          mime: fenceMime,
          kinoUploadFence: fenceId,
        },
      ],
    ]);
    const puts = [];
    const request = async ({ client, bucket, key, method, headers, body }) => {
      const id = mapKey(bucket, key);
      if (method === 'GET') {
        const item = stored.get(id);
        if (!item) return new Response(null, { status: 404 });
        return new Response(item.bytes, {
          status: 200,
          headers: {
            'Content-Length': String(item.bytes.byteLength),
            'Content-Type': item.mime,
            'x-amz-checksum-sha256':
              item.checksum ??
              Buffer.from(digest(item.bytes), 'hex').toString('base64'),
            ...(item.kinoUploadFence
              ? { 'x-amz-meta-kinouploadfence': item.kinoUploadFence }
              : {}),
          },
        });
      }
      assert.equal(method, 'PUT');
      assert.equal(headers?.['If-None-Match'], '*');
      puts.push({ bucket, key, client });
      if (stored.has(id)) return new Response(null, { status: 412 });
      const bytes = Buffer.from(body);
      assert.equal(
        headers['x-amz-checksum-sha256'],
        Buffer.from(digest(bytes), 'hex').toString('base64'),
      );
      stored.set(id, {
        bytes,
        mime: headers['Content-Type'],
        checksum: headers['x-amz-checksum-sha256'],
        ...(headers['x-amz-meta-kinoUploadFence']
          ? { kinoUploadFence: headers['x-amz-meta-kinoUploadFence'] }
          : {}),
      });
      return new Response(null, { status: 200 });
    };
    const manifest = {
      version: 1,
      mode: 'initial-non-overwrite-copy-checkpoint',
      accountId: 'd3e930465c0df7e89b35de3ca65ea36a',
      sourceBucket,
      targetBucket,
      sourceSqlSha256: 'a'.repeat(64),
      migrationCount: 67,
      activeAssets: [
        {
          assetId: 'photo-a',
          assetKind: 'original',
          objectKey: assetKey,
          byteSize: assetBytes.byteLength,
          mime: 'image/jpeg',
          sha256: digest(assetBytes),
        },
        {
          assetId: 'photo-b',
          assetKind: 'original',
          objectKey: existingKey,
          byteSize: existingBytes.byteLength,
          mime: 'image/jpeg',
          sha256: digest(existingBytes),
        },
      ],
      uploadFences: [
        {
          uploadSessionId: fenceId,
          objectKey: fenceKey,
          reason: 'cancel',
          actorType: 'user',
          byteSize: 0,
          mime: fenceMime,
        },
      ],
      aggregates: {},
    };

    const first = await copyProductionR2Manifest({
      manifest,
      sourceClient: 'source-client',
      targetClient: 'target-client',
      stateDirectory,
      backupDirectory,
      request,
    });
    assert.deepEqual(
      {
        copiedAssets: first.copiedAssets,
        matchingAssets: first.matchingAssets,
        copiedFences: first.copiedFences,
        matchingFences: first.matchingFences,
        overwrittenObjects: first.overwrittenObjects,
        deletedObjects: first.deletedObjects,
      },
      {
        copiedAssets: 1,
        matchingAssets: 1,
        copiedFences: 1,
        matchingFences: 0,
        overwrittenObjects: 0,
        deletedObjects: 0,
      },
    );
    assert.deepEqual(
      puts.map(({ bucket, key }) => [bucket, key]),
      [
        [targetBucket, assetKey],
        [targetBucket, fenceKey],
      ],
    );
    assert.equal(
      stored.get(mapKey(targetBucket, assetKey)).bytes.equals(assetBytes),
      true,
    );
    assert.equal(
      stored.get(mapKey(targetBucket, fenceKey)).bytes.byteLength,
      0,
    );
    assert.equal(stored.get(mapKey(targetBucket, fenceKey)).mime, fenceMime);
    assert.equal(
      stored.get(mapKey(targetBucket, fenceKey)).kinoUploadFence,
      fenceId,
    );
    assert.equal(
      stored.get(mapKey(targetBucket, fenceKey)).checksum,
      Buffer.from(digest(Buffer.alloc(0)), 'hex').toString('base64'),
    );

    const resumed = await copyProductionR2Manifest({
      manifest,
      sourceClient: 'source-client',
      targetClient: 'target-client',
      stateDirectory,
      backupDirectory,
      request,
    });
    assert.equal(resumed.copiedAssets, 0);
    assert.equal(resumed.matchingAssets, 2);
    assert.equal(resumed.copiedFences, 0);
    assert.equal(resumed.matchingFences, 1);
    assert.equal(puts.length, 2);

    stored.set(mapKey(targetBucket, existingKey), {
      bytes: Buffer.from('already-copied-photx'),
      mime: 'image/jpeg',
    });
    await assert.rejects(
      copyProductionR2Manifest({
        manifest: { ...manifest, sourceSqlSha256: 'b'.repeat(64) },
        sourceClient: 'source-client',
        targetClient: 'target-client',
        stateDirectory: path.join(root, 'mismatch-snapshot'),
        backupDirectory: path.join(root, 'mismatch-objects'),
        request,
      }),
      (error) =>
        error?.code === 'R2_ASSET_CHECKSUM_METADATA_MISMATCH' ||
        error?.code === 'R2_ASSET_SHA256_MISMATCH',
    );
    assert.equal(puts.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
