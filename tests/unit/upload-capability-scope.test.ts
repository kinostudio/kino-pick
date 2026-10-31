import { afterEach, describe, expect, it, vi } from 'vitest';
import { getUploadCapabilities } from '../../apps/web/target-ui/upload-client';
import { prepareImage } from '../../apps/web/target-ui/prepare-image';
const workspaceId = 'bd927a6d-d5d3-4743-bbae-e4560cdda4c7';
const caps = {
  enabled: true,
  maxBrowserBytes: 16 * 1024 * 1024,
  maxPixels: 80000000,
  maxDimension: 32768,
};
afterEach(() => vi.unstubAllGlobals());
describe('workspace upload limits', () => {
  it('loads the exact workspace policy without caching or changing signal', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(caps)));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    expect(await getUploadCapabilities(signal, workspaceId)).toEqual(caps);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/uploads/capabilities?workspaceId=' + workspaceId,
      expect.objectContaining({
        signal,
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    );
  });
  it('preserves the unscoped compatibility call', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(caps)));
    vi.stubGlobal('fetch', fetchMock);
    await getUploadCapabilities();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/uploads/capabilities');
  });
  it('rejects an oversized Cloudflare source before reading image bytes', async () => {
    const source = { size: 17 * 1024 * 1024 } as File;
    await expect(prepareImage(source, caps)).rejects.toThrow('16 MiB');
  });
  it('retains the browser 64MiB ceiling even if server advertises more', async () => {
    const source = { size: 65 * 1024 * 1024 } as File;
    await expect(
      prepareImage(source, { ...caps, maxBrowserBytes: 128 * 1024 * 1024 }),
    ).rejects.toThrow('64 MiB');
  });
});
