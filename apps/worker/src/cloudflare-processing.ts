import { z } from 'zod';
import { CloudflareImagesProcessor } from '../../../packages/image-processing/src/cloudflare-images.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { D1ImageProcessingRepository } from './processing-jobs.ts';
import { storageBucketForNode } from './private-storage.ts';
import { configuration, type WorkerEnv } from './config.ts';
import { browserFirstProcessor } from './browser-processing';

export const hostedImageProcessingLeaseMs = 15_000;
const browserProcessingGraceSeconds = 10;
const processingQueueJob = z
  .object({ workspaceId: z.uuid(), jobId: z.uuid() })
  .strict();

export async function enqueueImageProcessing(
  env: WorkerEnv,
  workspaceId: string,
  jobId: string,
  delaySeconds = 0,
) {
  if (!env.IMAGE_PROCESSING_QUEUE) return false;
  try {
    await env.IMAGE_PROCESSING_QUEUE.send(
      { workspaceId, jobId },
      { delaySeconds },
    );
    return true;
  } catch {
    console.error('IMAGE_PROCESSING_QUEUE_SEND_FAILED');
    return false;
  }
}

export async function consumeImageProcessingQueue(
  batch: MessageBatch<unknown>,
  env: WorkerEnv,
) {
  for (const message of batch.messages) {
    const input = processingQueueJob.safeParse(message.body);
    if (!input.success) {
      console.error('IMAGE_PROCESSING_QUEUE_INVALID_MESSAGE');
      message.ack();
      continue;
    }
    const { workspaceId, jobId } = input.data;
    const readCurrent = () =>
      env.DB.prepare(
        `SELECT j.status,j.lease_until_ms
         FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id
         WHERE j.id=? AND a.workspace_id=? AND j.recipe IN('browser-first-jpeg-82-v1','cloudflare-images-jpeg-82-v1')`,
      )
        .bind(jobId, workspaceId)
        .first<{ status: string; lease_until_ms: number | null }>();
    const actionable = (current: Awaited<ReturnType<typeof readCurrent>>) =>
      current && ['queued', 'running', 'retryable'].includes(current.status);
    let current = await readCurrent();
    if (!actionable(current)) {
      message.ack();
      continue;
    }
    if (!current?.lease_until_ms || current.lease_until_ms <= Date.now()) {
      const result = await processCloudflareImages(env, workspaceId, jobId);
      if (result.status === 'checked' && result.processed > 0) {
        message.ack();
        continue;
      }
      current = await readCurrent();
      if (!actionable(current)) {
        message.ack();
        continue;
      }
    }
    const delaySeconds = [2, 5, 10][Math.min(message.attempts - 1, 2)] ?? 10;
    const leaseSeconds = Math.ceil(
      ((current?.lease_until_ms ?? 0) - Date.now()) / 1000,
    );
    message.retry({
      delaySeconds: Math.max(
        delaySeconds,
        Math.min(hostedImageProcessingLeaseMs / 1000 + 1, leaseSeconds + 1),
      ),
    });
  }
}

/** Bounded durable outbox consumer. It never claims historical Sharp jobs. */
export async function processCloudflareImages(
  env: WorkerEnv,
  workspaceId?: string,
  jobId?: string,
) {
  if (configuration(env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED !== 'true')
    return { status: 'disabled' as const, processed: 0 };
  if (!env.IMAGES) return { status: 'unavailable' as const, processed: 0 };
  const leaseDurationMs = env.IMAGE_PROCESSING_QUEUE
    ? hostedImageProcessingLeaseMs
    : 600_000;
  const cloudflareJobs = new D1ImageProcessingRepository(env.DB, {
    leaseDurationMs,
    processorVersion: 'cloudflare-images-jpeg-82-v1',
  });
  const browserJobs = new D1ImageProcessingRepository(env.DB, {
    leaseDurationMs,
    processorVersion: 'browser-first-jpeg-82-v1',
  });
  let jobs = cloudflareJobs;
  let ids = await jobs.pending(1, workspaceId, jobId);
  if (!ids.length) {
    jobs = browserJobs;
    ids = await jobs.pending(1, workspaceId, jobId);
  }
  const results = [];
  for (const jobId of ids) {
    const nodeId = await jobs.jobStorageNode(jobId);
    if (!nodeId) continue;
    const objects = new R2ProcessingObjectStore(
      storageBucketForNode(env, nodeId),
    );
    results.push(
      await runImageProcessingJob({
        jobId,
        maxTransientAttempts: 3,
        jobs,
        objects,
        processor:
          jobs === browserJobs
            ? browserFirstProcessor(env.DB, env.IMAGES, jobId, objects)
            : new CloudflareImagesProcessor(env.IMAGES),
      }),
    );
  }
  return {
    status: 'checked' as const,
    processed: results.filter((x) => x.status === 'succeeded').length,
  };
}
export type CompletedUploadProcessingWake =
  | {
      kind: 'original';
      actorId: string;
      uploadSessionId: string;
    }
  | {
      kind: 'version';
      actorId: string;
      uploadSessionId: string;
      photoId: string;
    };

type WaitUntilContext = Pick<ExecutionContext, 'waitUntil'>;
type CompletionProcessingScope = {
  workspace_id: string;
  asset_id: string;
};

/** Wake only the immutable original/V2 completion's exact durable processing job. */
export function wakeCloudflareImagesForCompletedUpload(
  env: WorkerEnv,
  executionContext: WaitUntilContext,
  upload: CompletedUploadProcessingWake,
  preferBrowser = false,
): void {
  try {
    if (configuration(env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED !== 'true')
      return;
  } catch {
    console.error('CLOUDFLARE_PROCESSING_WAKE_FAILED');
    return;
  }

  executionContext.waitUntil(
    (async () => {
      try {
        const scope =
          upload.kind === 'version'
            ? await env.DB.prepare(
                'SELECT workspace_id,asset_id FROM upload_version_completions WHERE upload_session_id=? AND actor_id=? AND photo_id=?',
              )
                .bind(upload.uploadSessionId, upload.actorId, upload.photoId)
                .first<CompletionProcessingScope>()
            : await env.DB.prepare(
                'SELECT workspace_id,asset_id FROM upload_completions WHERE upload_session_id=? AND actor_id=?',
              )
                .bind(upload.uploadSessionId, upload.actorId)
                .first<CompletionProcessingScope>();
        if (!scope) {
          console.error('CLOUDFLARE_PROCESSING_WAKE_WITNESS_UNAVAILABLE');
          return;
        }
        let giveBrowserTime = false;
        if (preferBrowser) {
          const browserJob = await env.DB.prepare(
            "SELECT id FROM image_processing_jobs WHERE id=? AND recipe='browser-first-jpeg-82-v1'",
          )
            .bind(scope.asset_id)
            .first();
          giveBrowserTime = Boolean(browserJob);
        }
        if (
          await enqueueImageProcessing(
            env,
            scope.workspace_id,
            scope.asset_id,
            giveBrowserTime ? browserProcessingGraceSeconds : 0,
          )
        )
          return;
        if (giveBrowserTime) return;
        const result = await processCloudflareImages(
          env,
          scope.workspace_id,
          scope.asset_id,
        );
        if (result.status === 'unavailable')
          console.error('CLOUDFLARE_PROCESSING_WAKE_UNAVAILABLE');
      } catch {
        console.error('CLOUDFLARE_PROCESSING_WAKE_FAILED');
      }
    })(),
  );
}
