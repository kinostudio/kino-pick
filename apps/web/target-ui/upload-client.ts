import { z } from 'zod';
import { uploadRecoverySchema } from '../../../packages/contracts/src/uploads';
import type { SupportedImageType } from './prepare-image';

export type InitUploadBody = Readonly<{
  workspaceId: string;
  projectId: string;
  albumId: string;
  originalFilename: string;
  expectedBytes: number;
  contentType: SupportedImageType;
  sha256: string;
  requestId: string;
}>;

export type UploadIdentity = Readonly<{
  actorId: string;
  sessionId: string;
}>;
export type UploadCapabilities = Readonly<{
  enabled: boolean;
  maxBrowserBytes: number;
  maxPixels: number;
  maxDimension: number;
}>;

export type UploadAuthorization = Readonly<{
  url: string;
  method: 'PUT';
  contentLength: number;
  expiresAt: string;
  headers: Readonly<Record<string, string>>;
}>;

export type UploadCompletion = Readonly<{
  status: 'completed' | 'needs_review';
  actualBytes: number;
}>;

export class UploadRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'UploadRequestError';
  }
}

export class UploadProtocolError extends Error {
  constructor(public readonly retryable = true) {
    super('UPLOAD_RESPONSE_UNCONFIRMED');
    this.name = 'UploadProtocolError';
  }
}

export class DirectUploadResponseError extends Error {
  constructor(public readonly status: number) {
    super('DIRECT_UPLOAD_FAILED');
    this.name = 'DirectUploadResponseError';
  }
}

const capabilitiesSchema = z.object({
  enabled: z.boolean(),
  maxBrowserBytes: z.number().int().positive().safe(),
  maxPixels: z.number().int().positive().safe(),
  maxDimension: z.number().int().positive().safe(),
});

const uploadIdentityEnvelopeSchema = z.object({
  actor: z.object({ id: z.uuid() }),
  role: z.literal('owner'),
  sessionId: z.string().min(1).max(512),
});
const uploadSessionEnvelopeSchema = z.object({
  uploadSession: z.object({
    id: z.uuid(),
    status: z.enum([
      'reserved',
      'cancelled',
      'expired',
      'completed',
      'needs_review',
    ]),
  }),
});

const authorizationEnvelopeSchema = z.object({
  uploadAuthorization: z.object({
    url: z.string().min(1),
    method: z.literal('PUT'),
    contentLength: z.number().int().positive().safe(),
    expiresAt: z.string().min(1),
    headers: z.record(z.string(), z.string()),
  }),
});

const completionEnvelopeSchema = z.object({
  completion: z.object({
    status: z.enum(['completed', 'needs_review']),
    actualBytes: z.number().int().nonnegative().safe(),
  }),
});

const requestIdBodySchema = z.object({ requestId: z.uuid() });
const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });

async function readResponseBody(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    throw new UploadRequestError(
      response.status,
      error.success ? error.data.error.code : 'UNKNOWN_ERROR',
    );
  }
  return body;
}

function parseResponse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UploadProtocolError();
  return parsed.data;
}

export async function getUploadCapabilities(
  signal?: AbortSignal,
  workspaceId?: string,
): Promise<UploadCapabilities> {
  const path = workspaceId
    ? '/api/v1/workspaces/' +
      encodeURIComponent(z.uuid().parse(workspaceId)) +
      '/upload-capabilities'
    : '/api/v1/uploads/capabilities';
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  return parseResponse(capabilitiesSchema, await readResponseBody(response));
}

async function postJson(path: string, body: unknown, expectedActorId?: string) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(expectedActorId
        ? { 'X-Kino-Expected-Actor': z.uuid().parse(expectedActorId) }
        : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return readResponseBody(response);
}

export async function reserveUpload(
  body: InitUploadBody,
  expectedActorId?: string,
) {
  const result = parseResponse(
    uploadSessionEnvelopeSchema,
    await postJson('/api/v1/uploads/init', body, expectedActorId),
  );
  return result.uploadSession;
}

export async function authorizeUpload(
  uploadSessionId: string,
  body: { requestId: string },
  expectedActorId?: string,
) {
  requestIdBodySchema.parse(body);
  const result = parseResponse(
    authorizationEnvelopeSchema,
    await postJson(
      `/api/v1/uploads/${encodeURIComponent(uploadSessionId)}/authorize`,
      body,
      expectedActorId,
    ),
  );
  return result.uploadAuthorization;
}

export async function completeUpload(
  uploadSessionId: string,
  body: { requestId: string },
  expectedActorId?: string,
) {
  requestIdBodySchema.parse(body);
  const result = parseResponse(
    completionEnvelopeSchema,
    await postJson(
      `/api/v1/uploads/${encodeURIComponent(uploadSessionId)}/complete`,
      body,
      expectedActorId,
    ),
  );
  return result.completion;
}

export async function cancelUpload(
  uploadSessionId: string,
  body: { requestId: string },
  expectedActorId?: string,
) {
  requestIdBodySchema.parse(body);
  const result = parseResponse(
    uploadSessionEnvelopeSchema,
    await postJson(
      `/api/v1/uploads/${encodeURIComponent(uploadSessionId)}/cancel`,
      body,
      expectedActorId,
    ),
  );
  return result.uploadSession;
}

export async function getUploadSession(uploadSessionId: string) {
  const response = await fetch(
    `/api/v1/uploads/${encodeURIComponent(uploadSessionId)}`,
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
  );
  const result = parseResponse(
    uploadSessionEnvelopeSchema,
    await readResponseBody(response),
  );
  return result.uploadSession;
}
export async function getUploadOwner(signal?: AbortSignal) {
  const response = await fetch('/api/v1/me', {
    credentials: 'same-origin',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  return parseResponse(
    z.object({ actor: z.object({ id: z.uuid() }) }),
    await readResponseBody(response),
  ).actor.id;
}
export async function getUploadIdentity(
  signal?: AbortSignal,
): Promise<UploadIdentity> {
  const response = await fetch('/api/v1/me', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  const identity = parseResponse(
    uploadIdentityEnvelopeSchema,
    await readResponseBody(response),
  );
  return { actorId: identity.actor.id, sessionId: identity.sessionId };
}
export async function getUploadRecovery(requestId: string) {
  const response = await fetch(
    `/api/v1/uploads/recovery/${encodeURIComponent(z.uuid().parse(requestId))}`,
    { credentials: 'same-origin', cache: 'no-store' },
  );
  return parseResponse(uploadRecoverySchema, await readResponseBody(response));
}

function isLoopbackHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  const parts = host.split('.');
  if (parts.length !== 4 || parts[0] !== '127') return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isAllowedUploadUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (
    url.protocol === 'https:' &&
    !url.port &&
    /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/i.test(url.hostname)
  )
    return true;
  const oracleBucketPath = '/kino-pick-overflow/';
  if (
    url.protocol === 'https:' &&
    !url.port &&
    url.hostname === 'drive.kinostudio.tw' &&
    url.pathname.startsWith(oracleBucketPath) &&
    url.pathname.length > oracleBucketPath.length
  )
    return true;
  const appIsLoopback = isLoopbackHostname(window.location.hostname);
  return (
    appIsLoopback &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    isLoopbackHostname(url.hostname)
  );
}

export async function putUploadFile(
  file: File,
  contentType: string,
  authorization: UploadAuthorization,
  signal?: AbortSignal,
) {
  // An interrupted PUT has an unknown server outcome. Callers must retain
  // their fixed upload intent and reconcile it before attempting new work.
  if (signal?.aborted)
    throw signal.reason ?? new DOMException('Upload interrupted', 'AbortError');
  if (
    !isAllowedUploadUrl(authorization.url) ||
    authorization.method !== 'PUT' ||
    authorization.contentLength !== file.size
  )
    throw new UploadProtocolError(false);
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new UploadProtocolError(false);
  if (expiresAt <= Date.now())
    throw new UploadRequestError(409, 'UPLOAD_AUTHORIZATION_EXPIRED');

  const headers = new Headers();
  for (const [name, value] of Object.entries(authorization.headers)) {
    const normalized = name.toLowerCase();
    if (normalized === 'content-length') continue;
    if (
      normalized === 'cookie' ||
      normalized === 'authorization' ||
      normalized === 'origin' ||
      normalized === 'host'
    )
      continue;
    headers.set(name, value);
  }
  if (headers.get('Content-Type') !== contentType)
    throw new UploadProtocolError(false);

  const response = await fetch(authorization.url, {
    method: 'PUT',
    headers,
    body: file,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new DirectUploadResponseError(response.status);
}
