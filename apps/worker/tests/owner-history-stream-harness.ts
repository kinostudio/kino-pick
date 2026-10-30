// Test entry only. This module is never imported by the deployable Worker.
import { z } from 'zod';
import { D1OwnerHistoryRepository } from '../src/owner-history';
import type { WorkerEnv } from '../src/config';

const inputSchema = z
  .object({
    ownerId: z.uuid(),
    sessionId: z.string().min(1).max(512),
    workspaceId: z.uuid(),
    snapshotToken: z.string().min(1).max(8_192),
  })
  .strict();

type Operation = 'cancel' | 'revoke';
type StreamEnv = Pick<WorkerEnv, 'DB' | 'APP_ENV' | 'BETTER_AUTH_SECRET'>;

type AuditCountRow = {
  action: 'owner_history.export_started' | 'owner_history.export_completed';
  count: number;
};

function errorResponse(code: string, status: number) {
  return Response.json({ error: { code } }, { status });
}

async function generationAuditCounts(
  env: StreamEnv,
  input: z.infer<typeof inputSchema>,
  generationId: string,
) {
  const result = await env.DB.prepare(
    "SELECT action,COUNT(*) AS count FROM audit_events WHERE request_id=? AND actor_type='user' AND actor_id=? AND session_id=? AND workspace_id=? AND action IN('owner_history.export_started','owner_history.export_completed') GROUP BY action",
  )
    .bind(generationId, input.ownerId, input.sessionId, input.workspaceId)
    .all<AuditCountRow>();
  const counts = new Map(
    result.results.map((row) => [row.action, Number(row.count)]),
  );
  return {
    startedCount: counts.get('owner_history.export_started') ?? 0,
    completedCount: counts.get('owner_history.export_completed') ?? 0,
  };
}

export async function ownerHistoryStreamHarness(
  request: Request,
  env: StreamEnv,
  operation: Operation,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('INVALID_INPUT', 400);
  }

  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return errorResponse('INVALID_INPUT', 400);
  const input = parsed.data;

  try {
    const repository = new D1OwnerHistoryRepository(
      env.DB,
      input.ownerId,
      input.sessionId,
      z.string().min(32).parse(env.BETTER_AUTH_SECRET),
    );
    const response = await repository.export(input.workspaceId, {
      expectedOwnerId: input.ownerId,
      snapshotToken: input.snapshotToken,
      format: 'json',
    });
    const generationId = response.headers.get('X-Kino-History-Generation');
    if (
      response.status !== 200 ||
      !generationId ||
      !z.uuid().safeParse(generationId).success ||
      !response.body
    )
      return errorResponse('OWNER_HISTORY_STREAM_TEST_FAILED', 503);

    let interrupted = false;
    if (operation === 'cancel') {
      await response.body.cancel();
      interrupted = true;
    } else {
      const session = await env.DB.prepare(
        'SELECT expiresAt FROM owner_sessions WHERE id=? AND userId=?',
      )
        .bind(input.sessionId, input.ownerId)
        .first<{ expiresAt: number }>();
      if (!session)
        return errorResponse('OWNER_HISTORY_STREAM_TEST_FAILED', 503);

      const reader = response.body.getReader();
      let revokeSession = false;
      try {
        const header = await reader.read();
        if (
          header.done ||
          !header.value ||
          !new TextDecoder().decode(header.value).includes('"events":[')
        )
          return errorResponse('OWNER_HISTORY_STREAM_TEST_FAILED', 503);

        const firstPage = await reader.read();
        if (
          firstPage.done ||
          !firstPage.value ||
          !new TextDecoder().decode(firstPage.value).includes('"eventId"')
        )
          return errorResponse('OWNER_HISTORY_STREAM_TEST_FAILED', 503);

        const expired = await env.DB.prepare(
          'UPDATE owner_sessions SET expiresAt=0 WHERE id=? AND userId=? AND expiresAt=?',
        )
          .bind(input.sessionId, input.ownerId, session.expiresAt)
          .run();
        if (expired.meta.changes !== 1)
          return errorResponse('OWNER_HISTORY_STREAM_TEST_FAILED', 503);
        revokeSession = true;

        for (let index = 0; index < 16; index++) {
          try {
            const next = await reader.read();
            if (next.done) break;
          } catch {
            interrupted = true;
            break;
          }
        }
      } finally {
        let restoreFailed = false;
        if (revokeSession) {
          const restored = await env.DB.prepare(
            'UPDATE owner_sessions SET expiresAt=? WHERE id=? AND userId=? AND expiresAt=0',
          )
            .bind(session.expiresAt, input.sessionId, input.ownerId)
            .run();
          restoreFailed = restored.meta.changes !== 1;
        }
        if (!interrupted) {
          try {
            await reader.cancel();
          } catch {
            // The stream may already be closed or errored.
          }
        }
        reader.releaseLock();
        if (restoreFailed) throw new Error('OWNER_HISTORY_STREAM_TEST_FAILED');
      }
    }

    const counts = await generationAuditCounts(env, input, generationId);
    return Response.json({
      generationId,
      ...counts,
      interrupted,
    });
  } catch {
    return errorResponse('OWNER_HISTORY_STREAM_TEST_FAILED', 503);
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.search !== '' ||
      ![
        '/test-owner-history-stream/cancel',
        '/test-owner-history-stream/revoke',
      ].includes(url.pathname)
    )
      return errorResponse('NOT_FOUND', 404);
    if (request.method !== 'POST')
      return errorResponse('METHOD_NOT_ALLOWED', 405);
    if (
      env.APP_ENV !== 'local' ||
      !env.BETTER_AUTH_SECRET?.startsWith('synthetic')
    )
      return errorResponse('TEST_HARNESS_DISABLED', 404);

    return ownerHistoryStreamHarness(
      request,
      env,
      url.pathname.endsWith('/cancel') ? 'cancel' : 'revoke',
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
