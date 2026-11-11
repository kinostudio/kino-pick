import { afterEach, describe, expect, it, vi } from 'vitest';
import gateway from '../../apps/gateway/src';
import { clientActivityIp } from '../../apps/worker/src/client-ip';
import { type WorkerEnv } from '../../apps/worker/src/config';
import worker from '../../apps/worker/src/index';
import { verifyProductionGatewayRequest } from '../../apps/worker/src/production-gateway';

const secret = 'a'.repeat(48);
const upstream = 'https://kino-pick-production.kino-pick-aaron2026.workers.dev';

function ingressRequest(path = '/api/test?keep=a%2Fb&x=1'): Request {
  return new Request(`https://pick.kinostudio.tw${path}`, {
    method: 'POST',
    headers: {
      Host: 'pick.kinostudio.tw',
      Cookie: 'session=private',
      'CF-Connecting-IP': '203.0.113.25',
      'CF-Worker': 'kinostudio.tw',
      'X-Kino-Gateway-IP': '198.51.100.77',
      'X-Kino-Gateway-Signature': 'spoofed',
      'X-Kino-Gateway-Other': 'spoofed',
    },
    body: 'album=private',
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('production pick gateway', () => {
  it('rejects unsigned production requests before database access', async () => {
    const db = { prepare: vi.fn(), batch: vi.fn() };
    const env = {
      APP_ENV: 'production',
      PRODUCTION_RELEASE_ENABLED: 'true',
      KINO_GATEWAY_SECRET: secret,
      DB: db,
    } as unknown as WorkerEnv;

    const response = await worker.fetch(
      new Request(`${upstream}/api/private`),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(404);
    expect(db.prepare).not.toHaveBeenCalled();
    expect(db.batch).not.toHaveBeenCalled();
  });

  it('streams the request to the fixed upstream and replaces spoofed gateway headers', async () => {
    let forwarded: Request | undefined;
    let init: RequestInit | undefined;
    const upstreamResponse = new Response('upstream body', {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        forwarded = input as Request;
        init = options;
        return upstreamResponse;
      }),
    );

    const response = await gateway.fetch(ingressRequest(), {
      KINO_GATEWAY_SECRET: secret,
    });

    expect(forwarded).toBeDefined();
    expect(forwarded!.url).toBe(`${upstream}/api/test?keep=a%2Fb&x=1`);
    expect(forwarded!.method).toBe('POST');
    expect(forwarded!.body).toBeInstanceOf(ReadableStream);
    expect(await forwarded!.text()).toBe('album=private');
    expect(forwarded!.headers.get('cookie')).toBe('session=private');
    expect(forwarded!.headers.get('cf-connecting-ip')).toBeNull();
    expect(forwarded!.headers.has('host')).toBe(false);
    expect(forwarded!.headers.get('x-kino-gateway-ip')).toBe('203.0.113.25');
    expect(forwarded!.headers.get('x-kino-gateway-other')).toBeNull();
    expect(forwarded!.headers.get('x-kino-gateway-signature')).not.toBe(
      'spoofed',
    );
    expect(init).toMatchObject({ redirect: 'manual', cache: 'no-store' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('upstream body');
  });

  it('rejects other hosts and missing secrets without fetching upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const wrongHost = new Request('https://example.com/api/test', {
      headers: {
        Host: 'example.com',
        'CF-Connecting-IP': '203.0.113.25',
      },
    });
    expect(
      (await gateway.fetch(wrongHost, { KINO_GATEWAY_SECRET: secret })).status,
    ).toBe(404);
    expect((await gateway.fetch(ingressRequest(), {})).status).toBe(503);
    expect(
      (
        await gateway.fetch(ingressRequest(), {
          KINO_GATEWAY_SECRET: 'too-short',
        })
      ).status,
    ).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies the signed request, restores the trusted IP, and strips gateway headers', async () => {
    let forwarded: Request | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        forwarded = input as Request;
        return new Response('ok');
      }),
    );

    await gateway.fetch(ingressRequest(), { KINO_GATEWAY_SECRET: secret });
    Object.defineProperty(forwarded!, 'cf', { value: { colo: 'TPE' } });
    const internal = await verifyProductionGatewayRequest(forwarded!, secret);

    expect(internal).not.toBeNull();
    expect(forwarded!.headers.get('cf-worker')).toBe('kinostudio.tw');
    expect(internal!.url).toBe(
      'https://pick.kinostudio.tw/api/test?keep=a%2Fb&x=1',
    );
    expect(internal!.headers.get('host')).toBe('pick.kinostudio.tw');
    expect(internal!.headers.has('cf-worker')).toBe(false);
    expect(internal!.body).toBeInstanceOf(ReadableStream);
    expect(internal!.bodyUsed).toBe(false);
    expect(internal!.headers.get('cf-connecting-ip')).toBe('203.0.113.25');
    expect(
      [...internal!.headers.keys()].some((name) =>
        name.startsWith('x-kino-gateway-'),
      ),
    ).toBe(false);
    expect(internal!.headers.get('cookie')).toBe('session=private');
    expect(clientActivityIp(internal!, false)).toBe('203.0.113.25');
  });

  it('rejects altered signatures, stale timestamps, and a non-upstream hostname', async () => {
    let forwarded: Request | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        forwarded = input as Request;
        return new Response('ok');
      }),
    );
    await gateway.fetch(ingressRequest(), { KINO_GATEWAY_SECRET: secret });

    const alteredHeaders = new Headers(forwarded!.headers);
    alteredHeaders.set('X-Kino-Gateway-Signature', '0'.repeat(64));
    const altered = new Request(forwarded!.url, {
      method: forwarded!.method,
      headers: alteredHeaders,
    });
    expect(await verifyProductionGatewayRequest(altered, secret)).toBeNull();
    expect(
      await verifyProductionGatewayRequest(forwarded!, 'b'.repeat(48)),
    ).toBeNull();

    const wrongPath = new Request(`${forwarded!.url}&extra=1`, {
      method: forwarded!.method,
      headers: forwarded!.headers,
    });
    expect(await verifyProductionGatewayRequest(wrongPath, secret)).toBeNull();

    const wrongMethod = new Request(forwarded!.url, {
      method: 'PUT',
      headers: forwarded!.headers,
    });
    expect(
      await verifyProductionGatewayRequest(wrongMethod, secret),
    ).toBeNull();

    const missingSignatureHeaders = new Headers(forwarded!.headers);
    missingSignatureHeaders.delete('X-Kino-Gateway-Signature');
    expect(
      await verifyProductionGatewayRequest(
        new Request(forwarded!.url, {
          method: forwarded!.method,
          headers: missingSignatureHeaders,
        }),
        secret,
      ),
    ).toBeNull();

    const staleHeaders = new Headers(forwarded!.headers);
    staleHeaders.set(
      'X-Kino-Gateway-Timestamp',
      String(Math.floor(Date.now() / 1000) - 31),
    );
    const stale = new Request(forwarded!.url, {
      method: forwarded!.method,
      headers: staleHeaders,
    });
    expect(await verifyProductionGatewayRequest(stale, secret)).toBeNull();

    const wrongHostname = new Request(
      forwarded!.url.replace('kino-pick-production.', 'wrong-worker.'),
      { method: forwarded!.method, headers: forwarded!.headers },
    );
    expect(
      await verifyProductionGatewayRequest(wrongHostname, secret),
    ).toBeNull();

    const wrongHostHeader = new Request(forwarded!.url, {
      method: forwarded!.method,
      headers: {
        ...Object.fromEntries(forwarded!.headers),
        Host: 'example.com',
      },
    });
    expect(
      await verifyProductionGatewayRequest(wrongHostHeader, secret),
    ).toBeNull();
  });
});
