import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';

// Explicit local operator command only. No remote binding, HTTP completion proof or native Worker import.
let platform;
try {
  const [confirm, limitArg, ...extra] = process.argv.slice(2);
  const limit = limitArg === undefined ? 5 : Number(limitArg);
  if (
    confirm !== '--run' ||
    extra.length ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('USAGE');
  platform = await getPlatformProxy({
    configPath: fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)),
    environment: '',
    persist: {
      path: fileURLToPath(new URL('../.wrangler/state/v3', import.meta.url)),
    },
    remoteBindings: false,
  });
  if (platform.env.APP_ENV !== 'local') throw new Error('LOCAL_ONLY');
  const jobs = new D1ImageProcessingRepository(platform.env.DB);
  const objects = new R2ProcessingObjectStore(platform.env.PRIMARY_STORAGE);
  const processor = new LocalSharpImageProcessor();
  const ids = await jobs.pending(limit);
  for (const jobId of ids) {
    const result = await runImageProcessingJob({
      jobId,
      jobs,
      objects,
      processor,
    });
    console.log(
      JSON.stringify({ jobId, status: result.status, localOnly: true }),
    );
    if (result.status !== 'succeeded' && result.status !== 'busy')
      process.exitCode = 1;
  }
  if (!ids.length)
    console.log(JSON.stringify({ status: 'no_pending_jobs', localOnly: true }));
} catch (error) {
  console.error(
    error instanceof Error && error.message === 'USAGE'
      ? 'Usage: pnpm image:process:pending:local --run [1-100]'
      : 'LOCAL_PROCESSING_RUN_FAILED',
  );
  process.exitCode = 1;
} finally {
  if (platform) await platform.dispose();
}
