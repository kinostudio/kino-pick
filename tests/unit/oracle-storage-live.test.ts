import { test, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { S3StorageBucket } from '../../apps/worker/src/s3-storage-bucket';
import { R2StorageAdapter } from '../../apps/worker/src/r2-storage';
import {
  presignS3Put,
  type S3SignerCredentials,
} from '../../apps/worker/src/r2-presign';

test.skipIf(process.env.KINO_PICK_ORACLE_LIVE !== 'true')(
  'real Oracle CORS allows only the approved website and blocks bucket administration',
  async () => {
    const origin = 'https://kino-pic-staging.kino-pick-aaron2026.workers.dev';
    const url =
      'https://drive.kinostudio.tw/kino-pick-overflow/_kino/cors-probe';
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers':
          'content-type,if-none-match,x-amz-checksum-sha256',
      },
      redirect: 'error',
    });
    expect([200, 204]).toContain(preflight.status);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    await preflight.body?.cancel();
    const denied = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://unapproved.invalid',
        'Access-Control-Request-Method': 'PUT',
      },
      redirect: 'error',
    });
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
    await denied.body?.cancel();
    const admin = await fetch(
      'https://drive.kinostudio.tw/kino-pick-overflow/?seaweedfs-quota=',
      { redirect: 'error' },
    );
    expect(admin.status).toBe(403);
    await admin.body?.cancel();
  },
);

test.skipIf(process.env.KINO_PICK_ORACLE_LIVE !== 'true')(
  'real Oracle TLS, signed upload, checksum, read and payload fence',
  async () => {
    const credentials: S3SignerCredentials = JSON.parse(
      await readFile('.local/oracle-private/storage.json', 'utf8'),
    );
    const bucket = new S3StorageBucket(credentials);
    const storage = new R2StorageAdapter(bucket, 'oracle-vm');
    const scope = {
      workspaceId: randomUUID(),
      projectId: randomUUID(),
      albumId: randomUUID(),
    };
    const session = randomUUID();
    const key = `${scope.workspaceId}/${scope.projectId}/${scope.albumId}/${session}/original`;
    const bytes = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#28534c' },
    })
      .png()
      .toBuffer();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const grant = await presignS3Put(credentials, {
      objectKey: key,
      bytes: bytes.length,
      contentType: 'image/png',
      sha256Hex: sha256,
      signedAtMs: Date.now(),
      expiresAtMs: Date.now() + 120000,
    });
    const response = await fetch(grant.url, {
      method: 'PUT',
      headers: { ...grant.headers, 'Content-Length': String(bytes.length) },
      body: bytes,
      redirect: 'error',
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();
    const inspected = await storage.inspectUpload(scope, key);
    expect(inspected?.bytes).toBe(bytes.length);
    expect(inspected?.sha256).toBe(sha256);
    expect(Buffer.from(await storage.read(scope, key))).toEqual(bytes);
    const anonymous = await fetch(
      `${credentials.endpoint}/${credentials.bucketName}/${key}`,
      { redirect: 'error' },
    );
    expect(anonymous.status).toBe(403);
    await anonymous.body?.cancel();
    await storage.eraseAssetToFence(
      scope,
      { id: randomUUID(), objectKey: key, bytes: bytes.length, sha256 },
      randomUUID(),
    );
    expect((await bucket.head(key))?.size).toBe(0);
    const late = await fetch(grant.url, {
      method: 'PUT',
      headers: { ...grant.headers, 'Content-Length': String(bytes.length) },
      body: bytes,
      redirect: 'error',
    });
    expect(late.status).toBe(412);
    await late.body?.cancel();
    await writeFile(
      '.local/oracle-live-storage-proof.json',
      JSON.stringify(
        {
          status: 'passed',
          at: new Date().toISOString(),
          node: 'oracle-vm',
          objectKey: key,
          bytes: bytes.length,
          sha256,
          signedPut: true,
          privateRead: true,
          anonymousDenied: true,
          checksum: true,
          payloadReclaimed: true,
          latePutFenced: true,
          scope: 'synthetic VM object only; no D1 or hosted app acceptance',
        },
        null,
        2,
      ),
    );
  },
  120000,
);
