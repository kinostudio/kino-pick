import { AwsV4Signer } from 'aws4fetch';

export type R2SignerCredentials = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}>;

export type UploadGrant = Readonly<{
  objectKey: string;
  bytes: number;
  contentType: string;
  sha256Hex: string;
  signedAtMs: number;
  expiresAtMs: number;
}>;

function sha256HexToBase64(hex: string) {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('INVALID_SHA256');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return btoa(String.fromCharCode(...bytes));
}

export async function presignR2Put(
  credentials: R2SignerCredentials,
  grant: UploadGrant,
) {
  if (!/^[a-f0-9]{32}$/i.test(credentials.accountId))
    throw new Error('INVALID_R2_ACCOUNT_ID');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(credentials.bucketName))
    throw new Error('INVALID_R2_BUCKET_NAME');
  if (
    !credentials.accessKeyId ||
    !credentials.secretAccessKey ||
    !Number.isSafeInteger(grant.bytes) ||
    grant.bytes <= 0 ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(grant.contentType) ||
    !/^[0-9a-f]{64}$/.test(grant.sha256Hex) ||
    !Number.isSafeInteger(grant.signedAtMs) ||
    !Number.isSafeInteger(grant.expiresAtMs)
  )
    throw new Error('INVALID_UPLOAD_GRANT');
  const expiresSeconds = Math.floor(
    (grant.expiresAtMs - grant.signedAtMs) / 1000,
  );
  if (expiresSeconds < 1 || expiresSeconds > 600)
    throw new Error('INVALID_UPLOAD_GRANT_EXPIRY');
  if (
    !/^[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/original$/.test(
      grant.objectKey,
    ) ||
    grant.objectKey.includes('..')
  )
    throw new Error('INVALID_OBJECT_KEY');

  const encodedKey = grant.objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const url = new URL(
    `https://${credentials.accountId}.r2.cloudflarestorage.com/${credentials.bucketName}/${encodedKey}`,
  );
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));
  const checksum = sha256HexToBase64(grant.sha256Hex);
  const signer = new AwsV4Signer({
    url: url.toString(),
    method: 'PUT',
    service: 's3',
    region: 'auto',
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    datetime: new Date(grant.signedAtMs)
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, ''),
    signQuery: true,
    // aws4fetch normally excludes Content-Length. allHeaders is required here:
    // Chromium supplies it from a Blob/File body even though JS cannot set it.
    allHeaders: true,
    headers: {
      'Content-Type': grant.contentType,
      'Content-Length': String(grant.bytes),
      'If-None-Match': '*',
      'x-amz-checksum-sha256': checksum,
    },
  });
  const signed = await signer.sign();
  const expectedSignedHeaders =
    'content-length;content-type;host;if-none-match;x-amz-checksum-sha256';
  if (
    signed.url.searchParams.get('X-Amz-SignedHeaders') !== expectedSignedHeaders
  )
    throw new Error('R2_SIGNED_HEADERS_INCOMPLETE');
  return {
    url: signed.url.toString(),
    expiresAt: new Date(grant.expiresAtMs).toISOString(),
    contentLength: grant.bytes,
    headers: {
      'Content-Type': grant.contentType,
      'If-None-Match': '*',
      'x-amz-checksum-sha256': checksum,
    },
  } as const;
}
