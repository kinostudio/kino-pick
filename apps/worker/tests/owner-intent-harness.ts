// Test entry helper only. The deployable Worker never imports this module.
import { z } from 'zod';
import type { Scope } from '../../../packages/domain/src';
import { D1UploadRepository, expireDueReservations } from '../src/uploads';
import { D1ProcessingReviewRepository } from '../src/processing-review';
import { R2StorageAdapter } from '../src/r2-storage';
import {
  R2ProcessingReviewStore,
  type ReviewOutputSlot,
} from '../src/processing-review-storage';
import { WorkspaceFailure } from '../src/workspaces';

const base = {
  actorId: z.uuid(),
  sessionId: z.string().min(1),
  requestId: z.uuid(),
  interleave: z.boolean().default(false),
  dropAfterFence: z.boolean().default(false),
  adapterNodeId: z.string().min(1).max(255).default('primary'),
};
const inputSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('system.expire'),
      adapterNodeId: z.string().min(1).max(255).default('primary'),
      cutoffMs: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('upload.cancelled'),
      uploadSessionId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ...base,
      operation: z.literal('processing.abandoned'),
      photoId: z.uuid(),
      versionId: z.uuid(),
      expectedLeaseEpoch: z.number().int().nonnegative(),
      confirmAbandon: z.literal(true),
    })
    .strict(),
]);
export async function ownerIntentHarness(
  request: Request,
  env: Env & { INTENT_HOOK?: Fetcher },
) {
  const input = inputSchema.parse(await request.json());
  if (input.operation === 'system.expire')
    return Response.json(
      await expireDueReservations(
        env.DB,
        input.cutoffMs,
        new R2StorageAdapter(env.PRIMARY_STORAGE, input.adapterNodeId),
      ),
    );
  const dropAfterFence = input.dropAfterFence;
  const beforeFence = async () => {
    if (!input.interleave) return;
    if (!env.INTENT_HOOK) throw new Error('MISSING_TEST_INTENT_HOOK');
    const response = await env.INTENT_HOOK.fetch(
      new Request('https://test-only.invalid/before-fence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: input.operation,
          actorId: input.actorId,
          requestId: input.requestId,
        }),
      }),
    );
    if (!response.ok) throw new Error('TEST_INTENT_INTERLEAVE_FAILED');
  };
  class UploadStore extends R2StorageAdapter {
    override async fenceIfAbsent(
      scope: Scope,
      key: string,
      uploadSessionId: string,
    ) {
      await beforeFence();
      const result = await super.fenceIfAbsent(scope, key, uploadSessionId);
      if (dropAfterFence) throw new Error('TEST_PHYSICAL_RESULT_LOST');
      return result;
    }
  }
  class ReviewStore extends R2ProcessingReviewStore {
    override async fenceBoth(slots: readonly ReviewOutputSlot[]) {
      await beforeFence();
      const result = await super.fenceBoth(slots);
      if (dropAfterFence) throw new Error('TEST_PHYSICAL_RESULT_LOST');
      return result;
    }
  }
  try {
    if (input.operation === 'upload.cancelled') {
      const result = await new D1UploadRepository(
        env.DB,
        input.actorId,
        input.sessionId,
        new UploadStore(env.PRIMARY_STORAGE, input.adapterNodeId),
        { versionUploadsEnabled: true },
      ).cancel(input.uploadSessionId, { requestId: input.requestId });
      return Response.json({ uploadSession: result });
    }
    const result = await new D1ProcessingReviewRepository(
      env.DB,
      new ReviewStore(env.PRIMARY_STORAGE),
      input.actorId,
      input.sessionId,
    ).abandon(input.photoId, input.versionId, {
      requestId: input.requestId,
      expectedLeaseEpoch: input.expectedLeaseEpoch,
      confirmAbandon: true,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof WorkspaceFailure)
      return Response.json(
        { error: { code: error.code } },
        { status: error.status },
      );
    return Response.json(
      { error: { code: 'OWNER_INTENT_TEST_FAILED' } },
      { status: 503 },
    );
  }
}
