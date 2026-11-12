import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getUploadIdentity,
  UploadProtocolError,
  UploadRequestError,
} from '../../apps/web/target-ui/upload-client';

const actorId = '11111111-1111-4111-8111-111111111111';
const opaqueSessionId = 'session:opaque-value/not-a-uuid';

function stubResponse(body: string, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function stubJson(body: unknown, status = 200) {
  return stubResponse(JSON.stringify(body) ?? 'null', status);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getUploadIdentity', () => {
  it('requests the current same-origin identity and returns only its public fields', async () => {
    const controller = new AbortController();
    const fetchMock = stubJson({
      actor: { id: actorId, email: 'private@example.invalid' },
      role: 'owner',
      sessionId: opaqueSessionId,
      accessToken: 'private-token',
      cookie: 'private-cookie',
      sourceSecret: 'private-source-secret',
    });

    await expect(getUploadIdentity(controller.signal)).resolves.toEqual({
      actorId,
      sessionId: opaqueSessionId,
    });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe('/api/v1/me');
    expect(call?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    expect(call?.[1]?.headers).toEqual({ Accept: 'application/json' });
    expect(call?.[1]).not.toHaveProperty('body');
  });

  it('accepts the maximum opaque session id length', async () => {
    const sessionId = 's'.repeat(512);
    stubJson({ actor: { id: actorId }, role: 'owner', sessionId });

    await expect(getUploadIdentity()).resolves.toEqual({ actorId, sessionId });
  });

  const invalidBodies: Array<{ label: string; body: unknown }> = [
    {
      label: 'missing actor',
      body: { role: 'owner', sessionId: opaqueSessionId },
    },
    {
      label: 'invalid actor UUID',
      body: {
        actor: { id: 'not-a-uuid' },
        role: 'owner',
        sessionId: opaqueSessionId,
      },
    },
    {
      label: 'missing session id',
      body: { actor: { id: actorId }, role: 'owner' },
    },
    {
      label: 'empty session id',
      body: { actor: { id: actorId }, role: 'owner', sessionId: '' },
    },
    {
      label: 'overlong session id',
      body: {
        actor: { id: actorId },
        role: 'owner',
        sessionId: 's'.repeat(513),
      },
    },
    {
      label: 'non-string session id',
      body: { actor: { id: actorId }, role: 'owner', sessionId: 12 },
    },
    {
      label: 'missing role',
      body: { actor: { id: actorId }, sessionId: opaqueSessionId },
    },
    {
      label: 'non-owner role',
      body: {
        actor: { id: actorId },
        role: 'guest',
        sessionId: opaqueSessionId,
      },
    },
  ];

  it.each(invalidBodies)('fails closed for $label', async ({ body }) => {
    stubJson(body);

    await expect(getUploadIdentity()).rejects.toBeInstanceOf(
      UploadProtocolError,
    );
  });

  it('preserves API error status and code without exposing other response fields', async () => {
    stubJson(
      {
        error: { code: 'AUTH_REQUIRED' },
        accessToken: 'private-token',
        cookie: 'private-cookie',
        sessionId: 'private-session-value',
      },
      401,
    );

    const error = await getUploadIdentity().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UploadRequestError);
    expect(error).toMatchObject({
      name: 'UploadRequestError',
      status: 401,
      code: 'AUTH_REQUIRED',
      message: 'AUTH_REQUIRED',
    });
    expect(JSON.stringify(error)).not.toContain('private-token');
    expect(JSON.stringify(error)).not.toContain('private-cookie');
    expect(JSON.stringify(error)).not.toContain('private-session-value');
  });

  it('rejects a successful response with malformed JSON', async () => {
    stubResponse('{ malformed json');

    await expect(getUploadIdentity()).rejects.toBeInstanceOf(
      UploadProtocolError,
    );
  });
});

describe('transient identity retry', () => {
  const okBody = () =>
    new Response(
      JSON.stringify({
        actor: { id: actorId },
        role: 'owner',
        sessionId: opaqueSessionId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  const unavailable = () =>
    new Response(JSON.stringify({ error: { code: 'SERVICE_NOT_READY' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a transient 503 with backoff past the D1 window and returns the identity', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(okBody());
    vi.stubGlobal('fetch', fetchMock);
    const result = getUploadIdentity();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9000);
    await expect(result).resolves.toEqual({
      actorId,
      sessionId: opaqueSessionId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) expect(call[0]).toBe('/api/v1/me');
  });

  it('never retries a non-transient answer such as 401', async () => {
    const fetchMock = stubJson(
      { error: { code: 'AUTH_REQUIRED' }, detail: 'private' },
      401,
    );
    await expect(getUploadIdentity()).rejects.toBeInstanceOf(
      UploadRequestError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after three attempts and surfaces the last 503', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => unavailable());
    vi.stubGlobal('fetch', fetchMock);
    const result = getUploadIdentity();
    const assertion = expect(result).rejects.toBeInstanceOf(UploadRequestError);
    await vi.advanceTimersByTimeAsync(11000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry after the caller aborts', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      return unavailable();
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getUploadIdentity(controller.signal)).rejects.toBeInstanceOf(
      UploadRequestError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
