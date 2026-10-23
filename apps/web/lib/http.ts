import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { RepositoryError } from '@kino-pic/db';
import { isSameOriginMutation } from '@kino-pic/contracts';
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function requireOrigin(request: Request, appUrl: string) {
  if (!isSameOriginMutation(request, appUrl))
    throw new ApiError('FORBIDDEN_ORIGIN', 403, '請從本站重新操作');
}
export async function readJson(request: Request) {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new ApiError('INVALID_INPUT', 400, '需要 JSON 格式');
  // Enforce actual streamed body bytes, not an untrusted Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('INVALID_INPUT', 400, '缺少內容');
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError('PAYLOAD_TOO_LARGE', 413, '內容過長');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all)) as unknown;
  } catch {
    throw new ApiError('INVALID_INPUT', 400, 'JSON 格式錯誤');
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' },
  });
}
export function apiFailure(error: unknown) {
  const requestId = randomUUID();
  if (error instanceof ApiError)
    return json(
      { error: { code: error.code, message: error.message }, requestId },
      error.status,
    );
  if (error instanceof z.ZodError)
    return json(
      {
        error: { code: 'INVALID_INPUT', message: '資料格式不正確' },
        requestId,
      },
      400,
    );
  if (error instanceof RepositoryError) {
    const statuses: Record<string, number> = {
      AUTH_REQUIRED: 401,
      GOOGLE_IDENTITY_REQUIRED: 403,
      OAUTH_IDENTITY_REQUIRED: 403,
      IDENTITY_ALREADY_LINKED: 409,
      LINK_LIMIT_REACHED: 429,
      LINK_INTENT_INVALID: 400,
      LINK_NOT_VERIFIED: 403,
      INVALID_INPUT: 400,
      FORBIDDEN_SCOPE: 403,
      OWNER_ROLE_IMMUTABLE: 409,
      MEMBER_NOT_FOUND: 404,
      REQUEST_ID_CONFLICT: 409,
      WORKSPACE_LIMIT_REACHED: 409,
      CONCURRENT_MODIFICATION: 409,
      RESOURCE_NOT_EDITABLE: 409,
      PROTECTION_CONFIRMATION_REQUIRED: 409,
      NOT_FOUND: 404,
      RESOURCE_LIMIT_REACHED: 409,
    };
    return json(
      {
        error: {
          code: error.code,
          message: '無法完成此操作，請確認權限及資料',
        },
        requestId,
      },
      statuses[error.code] ?? 503,
    );
  }
  return json(
    {
      error: { code: 'SERVICE_UNAVAILABLE', message: '服務暫時無法使用' },
      requestId,
    },
    503,
  );
}
