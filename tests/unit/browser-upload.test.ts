import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const generate = vi.hoisted(() => vi.fn());
vi.mock('../../apps/web/target-ui/browser-image-processing', () => ({
  generateBrowserDerivatives: generate,
}));
import { completeUpload } from '../../apps/web/target-ui/upload-client';
const actor = '11111111-1111-4111-8111-111111111111';
const upload = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
let calls: { path: string; init: RequestInit }[];
let identityActor: string;
let derivativeStatus: number;
const original = new Blob(['original'], { type: 'image/jpeg' });
beforeEach(() => {
  calls = [];
  identityActor = actor;
  derivativeStatus = 200;
  generate.mockReset().mockResolvedValue({
    thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
    preview: new Blob(['preview'], { type: 'image/jpeg' }),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      if (path.endsWith('/complete'))
        return Response.json({
          completion: { status: 'completed', actualBytes: 8 },
        });
      if (path === '/api/v1/me')
        return Response.json({
          actor: { id: identityActor },
          role: 'owner',
          sessionId: 'synthetic-session',
        });
      return Response.json(
        { status: 'succeeded' },
        { status: derivativeStatus },
      );
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it('preserves original completion and sends derivatives bound to the current Owner session', async () => {
  expect(await completeUpload(upload, { requestId }, actor, original)).toEqual({
    status: 'completed',
    actualBytes: 8,
  });
  expect(
    new Headers(calls[0]!.init.headers).get('X-Kino-Browser-Processing'),
  ).toBe('1');
  const submitted = calls[2]!;
  expect(submitted.path).toBe(`/api/v1/uploads/${upload}/browser-derivatives`);
  expect(
    new Headers(submitted.init.headers).get('X-Kino-Expected-Session'),
  ).toBe('synthetic-session');
  expect([...(submitted.init.body as FormData).keys()]).toEqual([
    'sourceSha256',
    'thumbnail',
    'preview',
  ]);
  expect(await original.text()).toBe('original');
});

it('requests Cloudflare fallback if browser decoding fails, without replaying original completion', async () => {
  generate.mockRejectedValue(new Error('unsupported browser'));
  await completeUpload(upload, { requestId }, actor, original);
  expect(calls.filter((c) => c.path.endsWith('/complete'))).toHaveLength(1);
  expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ fallback: true });
});

it('does not submit derivatives for a switched identity or bypass a denied response', async () => {
  identityActor = '44444444-4444-4444-8444-444444444444';
  await completeUpload(upload, { requestId }, actor, original);
  expect(calls).toHaveLength(2);
  expect(generate).not.toHaveBeenCalled();
  calls = [];
  identityActor = actor;
  derivativeStatus = 403;
  await completeUpload(upload, { requestId }, actor, original);
  expect(calls).toHaveLength(3);
});

it('leaves legacy upload clients on their existing JSON completion path', async () => {
  await completeUpload(upload, { requestId }, actor);
  expect(calls).toHaveLength(1);
  expect(
    new Headers(calls[0]!.init.headers).has('X-Kino-Browser-Processing'),
  ).toBe(false);
  expect(generate).not.toHaveBeenCalled();
});
