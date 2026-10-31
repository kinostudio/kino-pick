import { CloudflareImagesProcessor } from '../../../packages/image-processing/src/cloudflare-images.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { D1ImageProcessingRepository } from './processing-jobs.ts';
import { configuration, type WorkerEnv } from './config.ts';

/** Bounded durable outbox consumer. It never claims historical Sharp jobs. */
export async function processCloudflareImages(
  env: WorkerEnv,
  workspaceId?: string,
  jobId?: string,
) {
  if (configuration(env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED !== 'true')
    return { status: 'disabled' as const, processed: 0 };
  if (!env.IMAGES) return { status: 'unavailable' as const, processed: 0 };
  const jobs = new D1ImageProcessingRepository(env.DB, {
    processorVersion: 'cloudflare-images-jpeg-82-v1',
  });
  const ids = await jobs.pending(1, workspaceId, jobId);
  const results = [];
  for (const jobId of ids)
    results.push(
      await runImageProcessingJob({
        jobId,
        maxTransientAttempts: 3,
        jobs,
        objects: new R2ProcessingObjectStore(env.PRIMARY_STORAGE),
        processor: new CloudflareImagesProcessor(env.IMAGES),
      }),
    );
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
