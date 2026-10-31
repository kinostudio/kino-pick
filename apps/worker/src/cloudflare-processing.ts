import { CloudflareImagesProcessor } from '../../../packages/image-processing/src/cloudflare-images.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { D1ImageProcessingRepository } from './processing-jobs.ts';
import { configuration, type WorkerEnv } from './config.ts';

/** Bounded durable outbox consumer. It never claims historical Sharp jobs. */
export async function processCloudflareImages(
  env: WorkerEnv,
  workspaceId?: string,
) {
  if (configuration(env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED !== 'true')
    return { status: 'disabled' as const, processed: 0 };
  if (!env.IMAGES) return { status: 'unavailable' as const, processed: 0 };
  const jobs = new D1ImageProcessingRepository(env.DB, {
    processorVersion: 'cloudflare-images-jpeg-82-v1',
  });
  const ids = await jobs.pending(1, workspaceId);
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
