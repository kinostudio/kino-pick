import { describe, expect, it } from 'vitest';
import { presignR2Put, presignS3Put } from '../../apps/worker/src/r2-presign';
import type { UploadGrant } from '../../apps/worker/src/r2-presign';

const signedAtMs = Date.UTC(2026, 10, 5, 12, 30, 0);
const grant: UploadGrant = {
  objectKey:
    '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/original',
  bytes: 123,
  contentType: 'image/jpeg',
  sha256Hex: 'a'.repeat(64),
  signedAtMs,
  expiresAtMs: signedAtMs + 300_000,
};
const s3Credentials = {
  endpoint: 'https://objectstorage.us-ashburn-1.oraclecloud.com',
  region: 'us-ashburn-1',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  bucketName: 'kino-private',
} as const;
const r2Credentials = {
  accountId: 'a'.repeat(32),
  accessKeyId: s3Credentials.accessKeyId,
  secretAccessKey: s3Credentials.secretAccessKey,
  bucketName: 'kino-private',
} as const;

describe('S3-compatible presigning', () => {
  it('uses AwsV4Signer for the exact path, region, expiry, and upload headers', async () => {
    const result = await presignS3Put(s3Credentials, grant);
    const url = new URL(result.url);

    expect(url.origin).toBe(s3Credentials.endpoint);
    expect(url.pathname).toBe(`/kino-private/${grant.objectKey}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIDEXAMPLE/20261105/us-ashburn-1/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;if-none-match;x-amz-checksum-sha256',
    );
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      'd8e7370892d0c785728d8226a5186fcd26b88f8ae15afaf1bc617b619d561716',
    );
    expect(result.contentLength).toBe(grant.bytes);
    const checksum = btoa(
      String.fromCharCode(...new Uint8Array(32).fill(0xaa)),
    );
    expect(result.headers).toEqual({
      'Content-Type': grant.contentType,
      'If-None-Match': '*',
      'x-amz-checksum-sha256': checksum,
    });

    const compatible = await presignS3Put(
      { ...s3Credentials, region: 'garage' },
      grant,
    );
    expect(new URL(compatible.url).searchParams.get('X-Amz-Credential')).toBe(
      'AKIDEXAMPLE/20261105/garage/s3/aws4_request',
    );
  });

  it('rejects non-HTTPS, non-origin, IP, and private endpoint names', async () => {
    for (const endpoint of [
      'http://s3.us-ashburn-1.oraclecloud.com',
      'https://user:secret@objectstorage.us-ashburn-1.oraclecloud.com',
      'https://objectstorage.us-ashburn-1.oraclecloud.com/bucket',
      'https://objectstorage.us-ashburn-1.oraclecloud.com?x=1',
      'https://objectstorage.us-ashburn-1.oraclecloud.com#x',
      'https://127.0.0.1',
      'https://10.0.0.1',
      'https://172.16.0.1',
      'https://192.168.1.2',
      'https://169.254.169.254',
      'https://[::1]',
      'https://[fe80::1]',
      'https://localhost',
      'https://storage.local',
      'https://storage.internal',
      'https://singlelabel',
    ]) {
      await expect(
        presignS3Put({ ...s3Credentials, endpoint }, grant),
      ).rejects.toThrow('INVALID_S3_ENDPOINT');
    }
  });

  it('rejects unsafe regions, object keys, checksums, lengths, MIME types, and expiries', async () => {
    for (const region of ['-private', '../1', '', 'r'.repeat(64)]) {
      await expect(
        presignS3Put({ ...s3Credentials, region }, grant),
      ).rejects.toThrow('INVALID_S3_REGION');
    }
    for (const objectKey of [
      '../one/two/three/original',
      'one/two/three/four/../../original',
      'one/two/three/four/preview',
      'one//three/four/original',
    ]) {
      await expect(
        presignS3Put(s3Credentials, { ...grant, objectKey }),
      ).rejects.toThrow('INVALID_OBJECT_KEY');
    }
    for (const sha256Hex of ['A'.repeat(64), '0'.repeat(63), 'z'.repeat(64)]) {
      await expect(
        presignS3Put(s3Credentials, { ...grant, sha256Hex }),
      ).rejects.toThrow('INVALID_UPLOAD_GRANT');
    }
    for (const bytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        presignS3Put(s3Credentials, { ...grant, bytes }),
      ).rejects.toThrow('INVALID_UPLOAD_GRANT');
    }
    await expect(
      presignS3Put(s3Credentials, { ...grant, contentType: 'image/gif' }),
    ).rejects.toThrow('INVALID_UPLOAD_GRANT');
    for (const durationMs of [999, 601_000]) {
      await expect(
        presignS3Put(s3Credentials, {
          ...grant,
          expiresAtMs: signedAtMs + durationMs,
        }),
      ).rejects.toThrow('INVALID_UPLOAD_GRANT_EXPIRY');
    }
  });

  it('preserves the R2 host, auto region, signature, and existing validation errors', async () => {
    const result = await presignR2Put(r2Credentials, grant);
    const url = new URL(result.url);

    expect(url.origin).toBe(
      `https://${r2Credentials.accountId}.r2.cloudflarestorage.com`,
    );
    expect(url.pathname).toBe(`/kino-private/${grant.objectKey}`);
    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      'AKIDEXAMPLE/20261105/auto/s3/aws4_request',
    );
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host;if-none-match;x-amz-checksum-sha256',
    );
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      'e75c5e890e80bf9a789b68fb6b227d4537cc62aa76f048e5b6aea28aa023f597',
    );
    await expect(
      presignR2Put({ ...r2Credentials, accountId: 'bad' }, grant),
    ).rejects.toThrow('INVALID_R2_ACCOUNT_ID');
    await expect(
      presignR2Put({ ...r2Credentials, bucketName: 'bad bucket' }, grant),
    ).rejects.toThrow('INVALID_R2_BUCKET_NAME');
    await expect(
      presignR2Put(r2Credentials, { ...grant, bytes: 0 }),
    ).rejects.toThrow('INVALID_UPLOAD_GRANT');
    await expect(
      presignR2Put(r2Credentials, {
        ...grant,
        expiresAtMs: signedAtMs + 601_000,
      }),
    ).rejects.toThrow('INVALID_UPLOAD_GRANT_EXPIRY');
    await expect(
      presignR2Put(r2Credentials, { ...grant, objectKey: 'bad/key' }),
    ).rejects.toThrow('INVALID_OBJECT_KEY');
  });
});
