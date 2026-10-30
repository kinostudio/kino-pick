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
