import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ORACLE_STORAGE_BUCKET,
  ORACLE_STORAGE_ENDPOINT,
  ORACLE_STORAGE_REGION,
  S3StorageBucket,
} from '../../apps/worker/src/s3-storage-bucket';

const credentials = {
  endpoint: ORACLE_STORAGE_ENDPOINT,
  region: ORACLE_STORAGE_REGION,
  bucketName: ORACLE_STORAGE_BUCKET,
  accessKeyId: 'ORACLE_ACCESS_KEY_TEST',
  secretAccessKey: 'ORACLE_SECRET_KEY_TEST',
} as const;
const prefix = '123e4567-e89b-12d3-a456-426614174000/';
const namespace = 'http://s3.amazonaws.com/doc/2006-03-01/';
const maxXmlBytes = 4 * 1024 * 1024;
const options = { prefix, limit: 10 } as const;

type ListedItem = { key: string; size: number };

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function listingXml(input: {
  prefix: string;
  maxKeys: number;
  objects?: ListedItem[];
  truncated?: boolean;
  continuationToken?: string;
  nextToken?: string;
}) {
  const objects = input.objects ?? [];
  return (
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="${namespace}">` +
    `<Name>${ORACLE_STORAGE_BUCKET}</Name><Prefix>${escapeXml(input.prefix)}</Prefix>` +
    `<EncodingType>url</EncodingType>` +
    (input.continuationToken === undefined
      ? ''
      : `<ContinuationToken>${escapeXml(input.continuationToken)}</ContinuationToken>`) +
    `<KeyCount>${objects.length}</KeyCount><MaxKeys>${input.maxKeys}</MaxKeys>` +
    `<IsTruncated>${input.truncated === true}</IsTruncated>` +
    objects
      .map(
        ({ key, size }) =>
          `<Contents><Key>${escapeXml(encodeURIComponent(key))}</Key><Size>${size}</Size></Contents>`,
      )
      .join('') +
    (input.nextToken === undefined
      ? ''
      : `<NextContinuationToken>${escapeXml(input.nextToken)}</NextContinuationToken>`) +
    '</ListBucketResult>'
  );
}

function requestFrom(input: RequestInfo | URL, init?: RequestInit) {
  return input instanceof Request ? input : new Request(input, init);
}

function mockFetch(...responses: Response[]) {
  const requests: Request[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(requestFrom(input, init));
      const response = responses.shift();
      if (!response) throw new Error('unexpected fetch');
      return response;
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return { requests, fetchMock };
}

function watchLogs() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  return () => [...warn.mock.calls, ...error.mock.calls, ...log.mock.calls];
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Oracle S3 ListObjectsV2 network boundary', () => {
  it('signs a fixed bucket GET and round-trips bounded query fields and opaque tokens', async () => {
    const token = 'cursor*+/=%&opaque';
    const nextToken = 'next+/=%&opaque';
    const key = `${prefix}a+b%=&.jpg`;
    const { requests, fetchMock } = mockFetch(
      new Response(
        listingXml({
          prefix,
          maxKeys: 7,
          objects: [{ key, size: 12 }],
          truncated: true,
          continuationToken: token,
          nextToken,
        }),
      ),
    );
    const page = await new S3StorageBucket(credentials).list({
      prefix,
      limit: 7,
      cursor: token,
    });

    expect(page).toEqual({
      objects: [{ key, size: 12 }],
      truncated: true,
      cursor: nextToken,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requests[0]!;
    const url = new URL(request.url);
    expect(request.method).toBe('GET');
    expect(request.redirect).toBe('manual');
    expect(request.cache).toBe('no-store');
    expect(request.headers.has('authorization')).toBe(true);
    expect(url.origin).toBe(ORACLE_STORAGE_ENDPOINT);
    expect(url.pathname).toBe(`/${ORACLE_STORAGE_BUCKET}/`);
    expect(url.search).toMatch(
      new RegExp(
        `^\\?list-type=2&encoding-type=url&prefix=${prefix.slice(0, -1)}%2F&max-keys=7&continuation-token=`,
      ),
    );
    expect(url.searchParams.get('list-type')).toBe('2');
    expect(url.searchParams.get('encoding-type')).toBe('url');
    expect(url.searchParams.get('prefix')).toBe(prefix);
    expect(url.searchParams.get('max-keys')).toBe('7');
    expect(url.searchParams.get('continuation-token')).toBe(token);
    expect(url.searchParams.has('delimiter')).toBe(false);
    expect(request.url).not.toContain(credentials.accessKeyId);
    expect(request.url).not.toContain(credentials.secretAccessKey);
  });

  it('accepts empty and multipage AWS XML and preserves one-time key decoding', async () => {
    const cursor = 'next+/=%&page';
    const firstKey = `${prefix}first.jpg`;
    const secondKey = `${prefix}snow +%&=.jpg`;
    const { requests } = mockFetch(
      new Response(listingXml({ prefix, maxKeys: 2 })),
      new Response(
        listingXml({
          prefix,
          maxKeys: 2,
          objects: [{ key: firstKey, size: 3 }],
          truncated: true,
          nextToken: cursor,
        }),
      ),
      new Response(
        listingXml({
          prefix,
          maxKeys: 2,
          objects: [{ key: secondKey, size: 5 }],
          continuationToken: cursor,
        }),
      ),
    );
    const bucket = new S3StorageBucket(credentials);

    await expect(bucket.list({ prefix, limit: 2 })).resolves.toEqual({
      objects: [],
      truncated: false,
    });
    const first = await bucket.list({ prefix, limit: 2 });
    expect(first).toEqual({
      objects: [{ key: firstKey, size: 3 }],
      truncated: true,
      cursor,
    });
    const second = await bucket.list({ prefix, limit: 2, cursor });
    expect(second).toEqual({
      objects: [{ key: secondKey, size: 5 }],
      truncated: false,
    });
    expect(requests).toHaveLength(3);
    expect(
      new URL(requests[2]!.url).searchParams.get('continuation-token'),
    ).toBe(cursor);
  });

  it('rejects invalid prefix, limit, and cursor before network access', async () => {
    const { fetchMock } = mockFetch();
    const bucket = new S3StorageBucket(credentials);
    for (const request of [
      { prefix: 'not-a-workspace/', limit: 10 },
      { prefix, limit: 0 },
      { prefix, limit: 10, cursor: '' },
    ])
      await expect(bucket.list(request)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects denied, partial, and redirected responses without logging provider content', async () => {
    const captureLogs = watchLogs();
    const redirected = new Response('PRIVATE_REDIRECT_BODY');
    Object.defineProperty(redirected, 'redirected', { value: true });
    for (const response of [
      new Response('PRIVATE_403_BODY', { status: 403 }),
      new Response('PRIVATE_206_BODY', { status: 206 }),
      new Response('PRIVATE_302_BODY', {
        status: 302,
        headers: { Location: 'https://outside.invalid/private' },
      }),
      redirected,
    ]) {
      const { requests, fetchMock } = mockFetch(response);
      await expect(
        new S3StorageBucket(credentials).list(options),
      ).rejects.toThrow(/^S3_STORAGE_LIST_FAILED$/u);
      expect(requests).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requests[0]!.redirect).toBe('manual');
    }
    const logged = JSON.stringify(captureLogs());
    expect(logged).not.toContain('PRIVATE_');
    expect(logged).not.toContain('outside.invalid');
    expect(logged).not.toContain(credentials.accessKeyId);
    expect(logged).not.toContain(credentials.secretAccessKey);
  });

  it('rejects malformed UTF-8 and oversized XML while cancelling each body', async () => {
    const malformedCancel = vi.fn();
    const declaredCancel = vi.fn();
    const streamedCancel = vi.fn();
    const malformed = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0xc3, 0x28]));
        },
        cancel: malformedCancel,
      }),
    );
    const declaredOversize = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel: declaredCancel,
      }),
      { headers: { 'content-length': String(maxXmlBytes + 1) } },
    );
    const streamedOversize = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(maxXmlBytes + 1));
        },
        cancel: streamedCancel,
      }),
    );
    const { fetchMock } = mockFetch(
      malformed,
      declaredOversize,
      streamedOversize,
    );
    const bucket = new S3StorageBucket(credentials);
    for (let index = 0; index < 3; index++)
      await expect(bucket.list(options)).rejects.toThrow(
        /^S3_STORAGE_LIST_FAILED$/u,
      );
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(malformedCancel).toHaveBeenCalled();
    expect(declaredCancel).toHaveBeenCalled();
    expect(streamedCancel).toHaveBeenCalled();
  });

  it('aborts stalled response headers and bodies at 15 seconds without waiting for cancellation', async () => {
    vi.useFakeTimers();
    const headerRequest: Request[] = [];
    let markHeadersStalled!: () => void;
    const headersStalled = new Promise<void>((resolve) => {
      markHeadersStalled = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const request = requestFrom(input, init);
        headerRequest.push(request);
        markHeadersStalled();
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => reject(new Error('PRIVATE_HEADER_ABORT')),
            { once: true },
          );
        });
      }),
    );
    const headerOperation = new S3StorageBucket(credentials).list(options);
    const headerRejection = expect(headerOperation).rejects.toThrow(
      /^S3_STORAGE_LIST_FAILED$/u,
    );
    await headersStalled;
    await vi.advanceTimersByTimeAsync(15_000);
    await headerRejection;
    expect(headerRequest[0]!.signal.aborted).toBe(true);

    let markBodyStalled!: () => void;
    const bodyStalled = new Promise<void>((resolve) => {
      markBodyStalled = resolve;
    });
    const bodyRequest: Request[] = [];
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'));
      },
      pull() {
        markBodyStalled();
        return new Promise<void>(() => {});
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        bodyRequest.push(requestFrom(input, init));
        return Promise.resolve(new Response(body));
      }),
    );
    const bodyOperation = new S3StorageBucket(credentials).list(options);
    const bodyRejection = expect(bodyOperation).rejects.toThrow(
      /^S3_STORAGE_LIST_FAILED$/u,
    );
    await bodyStalled;
    await vi.advanceTimersByTimeAsync(15_000);
    await bodyRejection;
    expect(bodyRequest[0]!.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });
});
