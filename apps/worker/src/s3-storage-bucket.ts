import { AwsClient } from 'aws4fetch';

export type StorageBucket = Pick<R2Bucket, 'get' | 'head' | 'put'>;

export const ORACLE_STORAGE_ENDPOINT = 'https://drive.kinostudio.tw';
export const ORACLE_STORAGE_REGION = 'us-east-1';
export const ORACLE_STORAGE_BUCKET = 'kino-pick-overflow';

export type S3StorageCredentials = Readonly<{
  endpoint: string;
  region: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
}>;

type PutOptions = NonNullable<Parameters<R2Bucket['put']>[2]>;
type PutValue = Parameters<R2Bucket['put']>[1];
type R2Condition = R2GetOptions['onlyIf'];
type R2ConditionalFields = NonNullable<Exclude<R2Condition, Headers>>;

const knownMetadataNames = new Map([
  ['kinouploadfence', 'kinoUploadFence'],
  ['kinodeletionasset', 'kinoDeletionAsset'],
  ['kinodeletionjob', 'kinoDeletionJob'],
  ['kinoprocessingfence', 'kinoProcessingFence'],
  ['kinoprocessingkind', 'kinoProcessingKind'],
]);

function objectUrl(bucketName: string, key: string) {
  if (
    !key ||
    key.length > 1024 ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.includes('%') ||
    key.includes('\\')
  )
    throw new Error('S3_STORAGE_KEY_INVALID');
  const path = key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return `${ORACLE_STORAGE_ENDPOINT}/${bucketName}/${path}`;
}

function parseSize(value: string | null) {
  if (!value || !/^\d+$/.test(value))
    throw new Error('S3_STORAGE_SIZE_INVALID');
  const size = Number(value);
  if (!Number.isSafeInteger(size)) throw new Error('S3_STORAGE_SIZE_INVALID');
  return size;
}

function parseEtag(value: string | null) {
  if (!value || value.startsWith('W/'))
    throw new Error('S3_STORAGE_ETAG_MISSING');
  const etag =
    value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  if (!etag) throw new Error('S3_STORAGE_ETAG_MISSING');
  return { etag, httpEtag: value };
}

function parseChecksum(value: string | null): ArrayBuffer | undefined {
  if (!value) return undefined;
  let bytes: string;
  try {
    bytes = atob(value);
  } catch {
    throw new Error('S3_STORAGE_CHECKSUM_INVALID');
  }
  if (bytes.length !== 32) throw new Error('S3_STORAGE_CHECKSUM_INVALID');
  return Uint8Array.from(bytes, (byte) => byte.charCodeAt(0)).buffer;
}

function metadata(response: Response, key: string, size: number) {
  const { etag, httpEtag } = parseEtag(response.headers.get('etag'));
  const modified = response.headers.get('last-modified');
  const uploadedMs = modified ? Date.parse(modified) : Number.NaN;
  if (!Number.isFinite(uploadedMs))
    throw new Error('S3_STORAGE_LAST_MODIFIED_MISSING');

  const customMetadata: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    const prefix = 'x-amz-meta-';
    if (name.startsWith(prefix)) {
      const rawName = name.slice(prefix.length);
      customMetadata[knownMetadataNames.get(rawName) ?? rawName] = value;
    }
  });

  const httpMetadata: R2HTTPMetadata = {};
  const contentType = response.headers.get('content-type');
  const contentDisposition = response.headers.get('content-disposition');
  const contentEncoding = response.headers.get('content-encoding');
  const contentLanguage = response.headers.get('content-language');
  const cacheControl = response.headers.get('cache-control');
  const cacheExpiry = response.headers.get('expires');
  if (contentType) httpMetadata.contentType = contentType;
  if (contentDisposition) httpMetadata.contentDisposition = contentDisposition;
  if (contentEncoding) httpMetadata.contentEncoding = contentEncoding;
  if (contentLanguage) httpMetadata.contentLanguage = contentLanguage;
  if (cacheControl) httpMetadata.cacheControl = cacheControl;
  if (cacheExpiry) {
    const expiryMs = Date.parse(cacheExpiry);
    if (Number.isFinite(expiryMs))
      httpMetadata.cacheExpiry = new Date(expiryMs);
  }

  const sha256 = parseChecksum(response.headers.get('x-amz-checksum-sha256'));
  const checksums = {
    ...(sha256 ? { sha256 } : {}),
    toJSON: () => (sha256 ? { sha256 } : {}),
  } as R2Checksums;

  const writeHttpMetadata = (headers: Headers) => {
    if (contentType) headers.set('Content-Type', contentType);
    if (contentDisposition)
      headers.set('Content-Disposition', contentDisposition);
    if (contentEncoding) headers.set('Content-Encoding', contentEncoding);
    if (contentLanguage) headers.set('Content-Language', contentLanguage);
    if (cacheControl) headers.set('Cache-Control', cacheControl);
    if (cacheExpiry) headers.set('Expires', cacheExpiry);
  };

  return {
    key,
    version: response.headers.get('x-amz-version-id') ?? '',
    size,
    etag,
    httpEtag,
    uploaded: new Date(uploadedMs),
    checksums,
    httpMetadata,
    customMetadata,
    writeHttpMetadata,
  };
}

function conditionHeaders(condition: R2Condition | undefined) {
  const headers = new Headers();
  if (!condition) return headers;
  if (condition instanceof Headers) {
    for (const name of ['If-Match', 'If-None-Match']) {
      const value = condition.get(name);
      if (value) headers.set(name, value);
    }
    return headers;
  }
  const fields = condition as R2ConditionalFields;
  if (fields.uploadedBefore || fields.uploadedAfter)
    throw new Error('S3_STORAGE_CONDITION_UNSUPPORTED');
  if (fields.etagMatches) {
    const etag = fields.etagMatches;
    headers.set(
      'If-Match',
      etag === '*' || etag.startsWith('"') ? etag : `"${etag}"`,
    );
  }
  if (fields.etagDoesNotMatch) {
    const etag = fields.etagDoesNotMatch;
    headers.set(
      'If-None-Match',
      etag === '*' || etag.startsWith('"') ? etag : `"${etag}"`,
    );
  }
  return headers;
}

function rangeHeader(range: R2GetOptions['range']) {
  if (!range) return undefined;
  if (range instanceof Headers) return range.get('Range') ?? undefined;
  if ('suffix' in range) {
    if (!Number.isSafeInteger(range.suffix) || range.suffix < 1)
      throw new Error('S3_STORAGE_RANGE_INVALID');
    return `bytes=-${range.suffix}`;
  }
  const offset = range.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error('S3_STORAGE_RANGE_INVALID');
  if (range.length === undefined) return `bytes=${offset}-`;
  if (!Number.isSafeInteger(range.length) || range.length < 1)
    throw new Error('S3_STORAGE_RANGE_INVALID');
  return `bytes=${offset}-${offset + range.length - 1}`;
}

function totalSize(response: Response, requestedRange: string | undefined) {
  if (!requestedRange) return parseSize(response.headers.get('content-length'));
  if (response.status !== 206) throw new Error('S3_STORAGE_RANGE_IGNORED');
  const match = /^bytes \d+-\d+\/(\d+)$/.exec(
    response.headers.get('content-range') ?? '',
  );
  if (!match?.[1]) throw new Error('S3_STORAGE_RANGE_INVALID');
  return parseSize(match[1]);
}

async function bytesFromPutValue(value: PutValue) {
  if (value === null) return new Uint8Array();
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.byteLength);
    bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return bytes;
  }
  throw new Error('S3_STORAGE_BODY_UNSUPPORTED');
}

function bytesFromChecksum(value: string | ArrayBuffer | ArrayBufferView) {
  if (typeof value === 'string') throw new Error('S3_STORAGE_CHECKSUM_INVALID');
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('S3_STORAGE_CHECKSUM_INVALID');
}

async function discard(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // A failed response body must not hide the storage result.
  }
}

export class S3StorageBucket implements StorageBucket {
  private readonly client: AwsClient;
  private readonly bucketName: string;

  constructor(credentials: S3StorageCredentials) {
    if (
      credentials.endpoint !== ORACLE_STORAGE_ENDPOINT ||
      credentials.region !== ORACLE_STORAGE_REGION ||
      credentials.bucketName !== ORACLE_STORAGE_BUCKET ||
      !credentials.accessKeyId.trim() ||
      !credentials.secretAccessKey.trim()
    )
      throw new Error('ORACLE_STORAGE_CONFIG_INVALID');
    this.bucketName = credentials.bucketName;
    this.client = new AwsClient({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      service: 's3',
      region: credentials.region,
      retries: 0,
    });
  }

  private async request(
    key: string,
    method: string,
    headers = new Headers(),
    body?: BodyInit,
  ) {
    const url = objectUrl(this.bucketName, key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.client.fetch(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok && ![304, 404, 412].includes(response.status))
        console.warn('S3_STORAGE_HTTP_' + response.status);
      if (response.redirected) {
        await discard(response);
        throw new Error('S3_STORAGE_REDIRECT_REJECTED');
      }
      return response;
    } catch {
      throw new Error('S3_STORAGE_UNAVAILABLE');
    } finally {
      // Bound header wait without cutting off a slow private-file download.
      clearTimeout(timeout);
    }
  }

  async head(key: string): Promise<R2Object | null> {
    const response = await this.request(
      key,
      'HEAD',
      new Headers({ 'x-amz-checksum-mode': 'ENABLED' }),
    );
    if (response.status === 404) {
      await discard(response);
      return null;
    }
    if (!response.ok) {
      await discard(response);
      throw new Error('S3_STORAGE_REQUEST_FAILED');
    }
    return metadata(
      response,
      key,
      parseSize(response.headers.get('content-length')),
    ) as R2Object;
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    const headers = conditionHeaders(options?.onlyIf);
    headers.set('x-amz-checksum-mode', 'ENABLED');
    const range = rangeHeader(options?.range);
    if (options?.range instanceof Headers) {
      options.range.forEach((value, name) => headers.set(name, value));
    } else if (range) headers.set('Range', range);
    const response = await this.request(key, 'GET', headers);
    if ([304, 404, 412].includes(response.status)) {
      await discard(response);
      return null;
    }
    if (!response.ok) {
      await discard(response);
      throw new Error('S3_STORAGE_REQUEST_FAILED');
    }
    const object = metadata(response, key, totalSize(response, range));
    return {
      ...object,
      body: response.body ?? new ReadableStream(),
      get bodyUsed() {
        return response.bodyUsed;
      },
      arrayBuffer: () => response.arrayBuffer(),
      text: () => response.text(),
      json: <T>() => response.json<T>(),
      blob: () => response.blob(),
    } as R2ObjectBody;
  }

  async put(
    key: string,
    value: PutValue,
    options?: PutOptions,
  ): Promise<R2Object> {
    const bytes = await bytesFromPutValue(value);
    const headers = conditionHeaders(options?.onlyIf);
    const httpMetadata = options?.httpMetadata;
    const contentType =
      httpMetadata instanceof Headers
        ? httpMetadata.get('content-type')
        : httpMetadata?.contentType;
    if (contentType) headers.set('Content-Type', contentType);
    for (const [name, metadataValue] of Object.entries(
      options?.customMetadata ?? {},
    )) {
      if (!/^[a-z0-9-]+$/i.test(name))
        throw new Error('S3_STORAGE_METADATA_INVALID');
      headers.set(`x-amz-meta-${name}`, metadataValue);
    }
    if (options?.sha256) {
      const checksum = bytesFromChecksum(options.sha256);
      if (checksum.byteLength !== 32)
        throw new Error('S3_STORAGE_CHECKSUM_INVALID');
      headers.set(
        'x-amz-checksum-sha256',
        btoa(String.fromCharCode(...checksum)),
      );
    }
    const bodyBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(bodyBuffer).set(bytes);
    const response = await this.request(key, 'PUT', headers, bodyBuffer);
    if (response.status === 412) {
      await discard(response);
      // shortcut: Wrangler models put as non-null; remove this cast when conditional types are corrected.
      return null as unknown as R2Object;
    }
    if (!response.ok) {
      await discard(response);
      throw new Error('S3_STORAGE_REQUEST_FAILED');
    }
    await discard(response);
    const result = await this.head(key);
    if (!result) throw new Error('S3_STORAGE_WRITE_UNVERIFIED');
    return result;
  }
}
