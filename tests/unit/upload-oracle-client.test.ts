import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  putUploadFile,
  UploadProtocolError,
  type UploadAuthorization,
} from '../../apps/web/target-ui/upload-client';

const objectKey =
  '3a21aa9e-82d2-4f5a-a71f-deb9dac86828/94abb620-6422-4e3d-9071-12f43394ac62/album/session/original';
const oracleUrl =
  'https://drive.kinostudio.tw/kino-pick-overflow/' +
  objectKey +
  '?X-Amz-Signature=synthetic';

function fixture(url = oracleUrl) {
  const file = new File(['synthetic photo'], 'photo.png', {
    type: 'image/png',
  });
  const authorization: UploadAuthorization = {
    url,
    method: 'PUT',
    contentLength: file.size,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(file.size),
      'x-amz-checksum-sha256': 'synthetic-checksum',
      Authorization: 'discard-auth',
      Cookie: 'discard-cookie',
      Origin: 'discard-origin',
      Host: 'discard-host',
    },
  };
  return { file, authorization };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Oracle direct upload client boundary', () => {
  it('PUTs to the fixed Oracle bucket and preserves direct-upload options', async () => {
    vi.stubGlobal('window', { location: { hostname: 'kino.example' } });
    const { file, authorization } = fixture();
    const controller = new AbortController();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await putUploadFile(file, 'image/png', authorization, controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, options] = fetchMock.mock.calls[0]!;
    expect(target).toBe(oracleUrl);
    expect(options).toMatchObject({
      method: 'PUT',
      body: file,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const headers = options?.headers as Headers;
    expect(headers.get('Content-Type')).toBe('image/png');
    expect(headers.get('x-amz-checksum-sha256')).toBe('synthetic-checksum');
    for (const name of [
      'Authorization',
      'Cookie',
      'Origin',
      'Host',
      'Content-Length',
    ])
      expect(headers.has(name)).toBe(false);
  });

  it.each([
    'https://drive.kinostudio.tw.evil.example/kino-pick-overflow/' + objectKey,
    'https://drive.kinostudio.tw/other-bucket/' + objectKey,
    'https://user@drive.kinostudio.tw/kino-pick-overflow/' + objectKey,
    oracleUrl + '#fragment',
    'https://drive.kinostudio.tw:8443/kino-pick-overflow/' + objectKey,
    'http://drive.kinostudio.tw/kino-pick-overflow/' + objectKey,
    'https://drive.kinostudio.tw/kino-pick-overflow/',
  ])('rejects an unauthorized Oracle URL without fetching: %s', async (url) => {
    vi.stubGlobal('window', { location: { hostname: 'kino.example' } });
    const { file, authorization } = fixture(url);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      putUploadFile(file, 'image/png', authorization),
    ).rejects.toBeInstanceOf(UploadProtocolError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps existing loopback uploads available', async () => {
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1' } });
    const { file, authorization } = fixture(
      'http://127.0.0.1:9000/local-bucket/' + objectKey,
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await putUploadFile(file, 'image/png', authorization);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
