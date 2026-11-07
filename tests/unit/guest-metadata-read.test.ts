import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGuestMetadataRead } from '../../apps/web/target-ui/guest-metadata-read';

const albumId = '11111111-1111-4111-8111-111111111111';
const metadataPath = `/api/guest/albums/${albumId}/deliveries?cursor=recent`;
const eligiblePaths = [
  '/api/guest/feedback/capabilities',
  '/api/guest/deliveries/capabilities?enabled=1',
  `/api/guest/albums/${albumId}/access`,
  `/api/guest/albums/${albumId}/downloads`,
  `/api/guest/albums/${albumId}/deliveries?cursor=recent`,
  `/api/guest/albums/${albumId}/ratings`,
  `/api/guest/albums/${albumId}/favorites`,
];

afterEach(() => vi.unstubAllGlobals());

describe('fetchGuestMetadataRead', () => {
  it.each(eligiblePaths)(
    'recognizes eligible metadata path %s',
    async (path) => {
      const first = new Response('temporary', { status: 503 });
      const second = new Response('ok');
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchGuestMetadataRead(path)).resolves.toBe(second);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('retries a transient server response once, cancels its body, and preserves read options', async () => {
    let canceled = false;
    const first = new Response(
      new ReadableStream({
        cancel() {
          canceled = true;
        },
      }),
      { status: 503 },
    );
    const second = new Response('ok', { status: 200 });
    const controller = new AbortController();
    const headers = new Headers({ 'x-test': 'kept' });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchGuestMetadataRead(metadataPath, {
      method: 'GET',
      cache: 'reload',
      headers,
      credentials: 'include',
      signal: controller.signal,
      redirect: 'manual',
    });

    expect(response).toBe(second);
    expect(canceled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        method: 'GET',
        cache: 'no-store',
        headers,
        credentials: 'include',
        signal: controller.signal,
        redirect: 'manual',
      });
    }
  });

  it('retries a network TypeError once', async () => {
    const response = new Response('ok');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network failure'))
      .mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchGuestMetadataRead(metadataPath)).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the second failure after at most two attempts', async () => {
    const first = new Response('first failure', { status: 502 });
    const second = new Response('second failure', { status: 504 });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchGuestMetadataRead(metadataPath)).resolves.toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 429, 200])(
    'does not retry status %i or inspect its response body',
    async (status) => {
      const response = new Response('not the expected JSON contract', {
        status,
      });
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchGuestMetadataRead(metadataPath)).resolves.toBe(
        response,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['/api/guest/albums/not-a-uuid/access', undefined],
    [`/api/guest/albums/${albumId}/download`, undefined],
    [
      `/api/guest/photos/${albumId}/versions/${albumId}/downloads/original`,
      undefined,
    ],
    [`/api/owner/albums/${albumId}/access`, undefined],
    [`https://example.test/api/guest/albums/${albumId}/access`, undefined],
    [`/api/guest/albums/${albumId}/access#fragment`, undefined],
    [`/api/guest/albums/${albumId}/access`, { method: 'POST' }],
    [`/api/guest/albums/${albumId}/access`, { method: '' }],
  ])('passes through non-eligible request %s', async (path, init) => {
    const response = new Response('unavailable', { status: 503 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchGuestMetadataRead(path, init)).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(path, init);
  });

  it('does not retry when the signal is aborted after the first response', async () => {
    const controller = new AbortController();
    const first = new Response(
      new ReadableStream({
        cancel() {
          controller.abort();
        },
      }),
      { status: 503 },
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(first);
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      fetchGuestMetadataRead(metadataPath, { signal: controller.signal }),
    ).resolves.toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    new DOMException('Aborted', 'AbortError'),
    new TypeError('Aborted network'),
  ])(
    'propagates an aborted network request without retrying: %s',
    async (error) => {
      const controller = new AbortController();
      controller.abort();
      const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(error);
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        fetchGuestMetadataRead(metadataPath, { signal: controller.signal }),
      ).rejects.toBe(error);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
});
