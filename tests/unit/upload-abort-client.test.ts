import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectUploadResponseError,
  putUploadFile,
  UploadProtocolError,
  UploadRequestError,
  type UploadAuthorization,
} from '../../apps/web/target-ui/upload-client';

const url =
  'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/private/original';
function fixture(): { file: File; authorization: UploadAuthorization } {
  const file = new File(['photo'], 'photo.png', { type: 'image/png' });
  return {
    file,
    authorization: {
      url,
      method: 'PUT',
      contentLength: file.size,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(file.size),
        Authorization: 'discard-auth',
        Cookie: 'discard-cookie',
        Origin: 'discard-origin',
        Host: 'discard-host',
      },
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('direct PUT interruption and existing transport boundaries', () => {
  it('preserves the existing call shape and private direct-upload options without a signal', async () => {
    const { file, authorization } = fixture();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await putUploadFile(file, 'image/png', authorization);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, options] = fetchMock.mock.calls[0]!;
    expect(target).toBe(url);
    expect(options).toMatchObject({
      method: 'PUT',
      body: file,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(options).not.toHaveProperty('signal');
    const headers = options?.headers as Headers;
    expect(headers.get('Content-Type')).toBe('image/png');
    for (const name of [
      'Authorization',
      'Cookie',
      'Origin',
      'Host',
      'Content-Length',
    ])
      expect(headers.has(name)).toBe(false);
  });

  it('forwards the exact signal and preserves an in-flight interruption as unknown outcome', async () => {
    const { file, authorization } = fixture();
    const before = JSON.stringify(authorization);
    const controller = new AbortController();
    const reason = new DOMException('Queue paused', 'AbortError');
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_target, options) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const pending = putUploadFile(
      file,
      'image/png',
      authorization,
      controller.signal,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(authorization)).toBe(before);
    expect(await file.text()).toBe('photo');
  });

  it('starts no network request when already interrupted', async () => {
    const { file, authorization } = fixture();
    const controller = new AbortController();
    const reason = new DOMException('Identity changed', 'AbortError');
    controller.abort(reason);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      putUploadFile(file, 'image/png', authorization, controller.signal),
    ).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retains expiry and content-type denials when a signal is supplied', async () => {
    const { file, authorization } = fixture();
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      putUploadFile(
        file,
        'image/png',
        { ...authorization, expiresAt: new Date(0).toISOString() },
        controller.signal,
      ),
    ).rejects.toMatchObject({
      code: 'UPLOAD_AUTHORIZATION_EXPIRED',
    } satisfies Partial<UploadRequestError>);
    await expect(
      putUploadFile(file, 'image/jpeg', authorization, controller.signal),
    ).rejects.toBeInstanceOf(UploadProtocolError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves response failure without retrying or changing the authorization', async () => {
    const { file, authorization } = fixture();
    const before = JSON.stringify(authorization);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      putUploadFile(
        file,
        'image/png',
        authorization,
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(DirectUploadResponseError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(authorization)).toBe(before);
  });
});
