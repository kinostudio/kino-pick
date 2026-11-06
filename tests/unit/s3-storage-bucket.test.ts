import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORACLE_STORAGE_BUCKET,
  ORACLE_STORAGE_ENDPOINT,
  ORACLE_STORAGE_REGION,
  S3StorageBucket,
} from '../../apps/worker/src/s3-storage-bucket';
import { storageBucketForNode } from '../../apps/worker/src/private-storage';

const credentials = {
  endpoint: ORACLE_STORAGE_ENDPOINT,
  region: ORACLE_STORAGE_REGION,
  bucketName: ORACLE_STORAGE_BUCKET,
  accessKeyId: 'ORACLE_ACCESS_KEY_TEST',
  secretAccessKey: 'ORACLE_SECRET_KEY_TEST',
} as const;
const modified = 'Wed, 05 Nov 2026 12:00:00 GMT';
const checksumBytes = new Uint8Array(32).fill(0x5a);
const checksum = btoa(String.fromCharCode(...checksumBytes));

it('classifies a subrequest limit without exposing its private error text', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Too many subrequests; private-secret=NEVER_LOG_THIS');
      }),
    );
    await expect(
      new S3StorageBucket(credentials).get('_kino/system/storage-health.json'),
    ).rejects.toThrow('S3_STORAGE_UNAVAILABLE');
    expect(warning.mock.calls).toEqual([['S3_STORAGE_SUBREQUEST_LIMIT']]);
  } finally {
    warning.mockRestore();
  }
});

function storedObjectHeaders() {
  return new Headers({
    etag: '"actual-etag"',
    'content-length': '4',
    'content-type': 'image/jpeg',
    'last-modified': modified,
    'x-amz-checksum-sha256': checksum,
    'x-amz-meta-kinouploadfence': 'upload-session-1',
    'x-amz-meta-kinoprocessingfence': 'processing-job-1',
    'x-amz-meta-kinoprocessingkind': 'thumbnail',
  });
}

function mockFetch(...responses: Response[]) {
  const requests: Request[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(
        input instanceof Request ? input : new Request(input, init),
      );
      const response = responses.shift();
      if (!response) throw new Error('unexpected fetch');
      return response;
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return requests;
}

afterEach(() => vi.unstubAllGlobals());

describe('Oracle S3 storage bucket', () => {
  it('reads provider HEAD metadata and preserves real ETag and SHA-256', async () => {
    const requests = mockFetch(
      new Response(null, { headers: storedObjectHeaders() }),
    );
    const bucket = new S3StorageBucket(credentials);
    const object = await bucket.head('workspace/project/album/photo/original');

    expect(requests[0]!.method).toBe('HEAD');
    expect(requests[0]!.redirect).toBe('manual');
    expect(requests[0]!.headers.get('x-amz-checksum-mode')).toBe('ENABLED');
    expect(requests[0]!.url).toBe(
      `${ORACLE_STORAGE_ENDPOINT}/${ORACLE_STORAGE_BUCKET}/workspace/project/album/photo/original`,
    );
    expect(requests[0]!.url).not.toContain(credentials.accessKeyId);
    expect(object?.etag).toBe('actual-etag');
    expect(object?.httpEtag).toBe('"actual-etag"');
    expect(object?.checksums.sha256).toEqual(checksumBytes.buffer);
    expect(object?.customMetadata?.kinoUploadFence).toBe('upload-session-1');
    expect(object?.customMetadata?.kinoProcessingFence).toBe(
      'processing-job-1',
    );
    expect(object?.customMetadata?.kinoProcessingKind).toBe('thumbnail');
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
  });

  it('reads bounded ranges while reporting the source object size', async () => {
    const requests = mockFetch(
      new Response(new Uint8Array([0xff, 0xd8]), {
        status: 206,
        headers: new Headers({
          ...Object.fromEntries(storedObjectHeaders()),
          'content-length': '2',
          'content-range': 'bytes 0-1/4',
        }),
      }),
    );
    const object = await new S3StorageBucket(credentials).get(
      'workspace/project/album/photo/original',
      { range: { offset: 0, length: 2 } },
    );

    expect(requests[0]!.headers.get('range')).toBe('bytes=0-1');
    expect(requests[0]!.headers.get('x-amz-checksum-mode')).toBe('ENABLED');
    expect(object?.size).toBe(4);
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg');
    expect(object?.checksums.sha256).toEqual(checksumBytes.buffer);
    expect([...new Uint8Array(await object!.arrayBuffer())]).toEqual([
      0xff, 0xd8,
    ]);
  });

  it('writes conditional metadata and returns metadata confirmed by HEAD', async () => {
    const requests = mockFetch(
      new Response(null, { status: 200, headers: { etag: '"write-etag"' } }),
      new Response(null, { headers: storedObjectHeaders() }),
    );
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const result = await new S3StorageBucket(credentials).put(
      'workspace/project/album/photo/original',
      body,
      {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { kinoUploadFence: 'upload-session-1' },
        sha256: checksumBytes.buffer,
      },
    );

    expect(requests.map((request) => request.method)).toEqual(['PUT', 'HEAD']);
    expect(requests[0]!.headers.get('if-none-match')).toBe('*');
    expect(requests[0]!.headers.get('content-type')).toBe('image/jpeg');
    expect(requests[0]!.headers.get('x-amz-meta-kinouploadfence')).toBe(
      'upload-session-1',
    );
    expect(requests[0]!.headers.get('x-amz-checksum-sha256')).toBe(checksum);
    expect(result?.etag).toBe('actual-etag');
    expect(result?.checksums.sha256).toEqual(checksumBytes.buffer);
  });

  it('maps failed conditional writes to null and fails closed on missing checksums', async () => {
    const requests = mockFetch(
      new Response(null, { status: 412 }),
      new Response(null, {
        headers: new Headers({
          etag: '"no-checksum"',
          'content-length': '4',
          'last-modified': modified,
        }),
      }),
    );
    const bucket = new S3StorageBucket(credentials);
    const body = new Uint8Array([1, 2, 3, 4]);

    await expect(
      bucket.put('workspace/project/album/photo/original', body, {
        onlyIf: { etagMatches: 'prior-etag' },
      }),
    ).resolves.toBeNull();
    expect(requests[0]!.headers.get('if-match')).toBe('"prior-etag"');
    const withoutChecksum = await bucket.head(
      'workspace/project/album/photo/original',
    );
    expect(withoutChecksum?.checksums.sha256).toBeUndefined();
  });

  it('keeps primary available, requires exact Oracle config, and rejects unknown nodes', () => {
    const primary = {} as R2Bucket;
    const env = { PRIMARY_STORAGE: primary };
    expect(storageBucketForNode(env, 'primary')).toBe(primary);
    expect(() => storageBucketForNode(env, 'oracle-vm')).toThrow(
      'ORACLE_STORAGE_CONFIG_INVALID',
    );
    expect(() => storageBucketForNode(env, 'other')).toThrow(
      'STORAGE_NODE_UNAVAILABLE',
    );

    const configured = storageBucketForNode(
      {
        ...env,
        ORACLE_STORAGE_ENDPOINT: credentials.endpoint,
        ORACLE_STORAGE_REGION: credentials.region,
        ORACLE_STORAGE_BUCKET: credentials.bucketName,
        ORACLE_STORAGE_ACCESS_KEY_ID: credentials.accessKeyId,
        ORACLE_STORAGE_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      },
      'oracle-vm',
    );
    expect(configured).toBeInstanceOf(S3StorageBucket);
  });

  it('rejects endpoint and key path overrides without exposing credentials', async () => {
    expect(
      () =>
        new S3StorageBucket({
          ...credentials,
          endpoint: 'http://localhost:9000',
        }),
    ).toThrow('ORACLE_STORAGE_CONFIG_INVALID');
    const requests = mockFetch(new Response(null, { status: 404 }));
    const bucket = new S3StorageBucket(credentials);
    await expect(bucket.head('../secret')).rejects.toThrow(
      'S3_STORAGE_KEY_INVALID',
    );
    await expect(bucket.head('safe/key')).resolves.toBeNull();
    expect(requests[0]!.url).not.toContain(credentials.secretAccessKey);
  });
});

it('logs only the provider HTTP status without response content or credentials', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    mockFetch(new Response('private provider error body', { status: 503 }));
    await expect(
      new S3StorageBucket(credentials).get('_kino/system/storage-health.json'),
    ).rejects.toThrow('S3_STORAGE_REQUEST_FAILED');
    expect(warning.mock.calls).toEqual([['S3_STORAGE_HTTP_503']]);
  } finally {
    warning.mockRestore();
  }
});

it('rejects provider redirects without following them and retains 304 conditional reads', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    for (const status of [300, 301, 302, 303, 307, 308]) {
      const response = new Response('redirect body', {
        status,
        headers: { Location: 'https://outside.invalid/never-follow' },
      });
      const requests = mockFetch(response);
      await expect(
        new S3StorageBucket(credentials).get(
          '_kino/system/storage-health.json',
        ),
      ).rejects.toThrow('S3_STORAGE_UNAVAILABLE');
      expect(requests).toHaveLength(1);
      expect(requests[0]!.redirect).toBe('manual');
      expect(new URL(requests[0]!.url).origin).toBe(ORACLE_STORAGE_ENDPOINT);
      expect(response.bodyUsed).toBe(true);
    }
    const requests = mockFetch(new Response(null, { status: 304 }));
    await expect(
      new S3StorageBucket(credentials).get('_kino/system/storage-health.json', {
        onlyIf: { etagDoesNotMatch: 'current' },
      }),
    ).resolves.toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get('if-none-match')).toBe('"current"');
  } finally {
    warning.mockRestore();
  }
});
