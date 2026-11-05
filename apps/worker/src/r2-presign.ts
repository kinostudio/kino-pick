import { AwsV4Signer } from 'aws4fetch';

export type R2SignerCredentials = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}>;

export type S3SignerCredentials = Readonly<{
  endpoint: string;
  region: string;
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

const bucketNamePattern = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const objectKeyPattern =
  /^[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\/original$/;
const expectedSignedHeaders =
  'content-length;content-type;host;if-none-match;x-amz-checksum-sha256';

function validateUploadKey(objectKey: string) {
  if (!objectKeyPattern.test(objectKey) || objectKey.includes('..'))
    throw new Error('INVALID_OBJECT_KEY');
}

async function signPut(
  url: URL,
  region: string,
  credentials: Pick<S3SignerCredentials, 'accessKeyId' | 'secretAccessKey'>,
  grant: UploadGrant,
  signedHeadersError: string,
) {
  const checksum = sha256HexToBase64(grant.sha256Hex);
  const signer = new AwsV4Signer({
    url: url.toString(),
    method: 'PUT',
    service: 's3',
    region,
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
  if (
    signed.url.searchParams.get('X-Amz-SignedHeaders') !== expectedSignedHeaders
  )
    throw new Error(signedHeadersError);
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

// shortcut: DNS answers are not resolved, so callers must supply operator-owned endpoints; add a provider allowlist before exposing endpoint selection.
function publicS3Origin(endpoint: string) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('INVALID_S3_ENDPOINT');
  }

  const hostname = url.hostname.toLowerCase();
  const dnsHost =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const privateSuffixes = [
    'localhost',
    'local',
    'localdomain',
    'internal',
    'intranet',
    'private',
    'lan',
    'home',
    'home.arpa',
    'test',
    'example',
    'invalid',
    'onion',
  ];
  const privateName = privateSuffixes.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[?#]/.test(endpoint) ||
    url.pathname !== '/' ||
    (endpoint !== url.origin && endpoint !== `${url.origin}/`) ||
    !dnsHost.test(hostname) ||
    ipv4 ||
    privateName
  )
    throw new Error('INVALID_S3_ENDPOINT');
  return url;
}

export async function presignR2Put(
  credentials: R2SignerCredentials,
  grant: UploadGrant,
) {
  if (!/^[a-f0-9]{32}$/i.test(credentials.accountId))
    throw new Error('INVALID_R2_ACCOUNT_ID');
  if (!bucketNamePattern.test(credentials.bucketName))
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
  validateUploadKey(grant.objectKey);

  const encodedKey = grant.objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const url = new URL(
    `https://${credentials.accountId}.r2.cloudflarestorage.com/${credentials.bucketName}/${encodedKey}`,
  );
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));
  return signPut(
    url,
    'auto',
    credentials,
    grant,
    'R2_SIGNED_HEADERS_INCOMPLETE',
  );
}

export async function presignS3Put(
  credentials: S3SignerCredentials,
  grant: UploadGrant,
) {
  const endpoint = publicS3Origin(credentials.endpoint);
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(credentials.region))
    throw new Error('INVALID_S3_REGION');
  if (!bucketNamePattern.test(credentials.bucketName))
    throw new Error('INVALID_S3_BUCKET_NAME');
  if (!credentials.accessKeyId || !credentials.secretAccessKey)
    throw new Error('INVALID_S3_CREDENTIALS');
  if (
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
  validateUploadKey(grant.objectKey);

  const encodedKey = grant.objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  const url = new URL(
    `${endpoint.origin}/${credentials.bucketName}/${encodedKey}`,
  );
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));
  return signPut(
    url,
    credentials.region,
    credentials,
    grant,
    'S3_SIGNED_HEADERS_INCOMPLETE',
  );
}
