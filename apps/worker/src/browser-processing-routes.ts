import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { browserFirstProcessor } from './browser-processing';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store';
import { configuration, type WorkerEnv } from './config';
import { D1ImageProcessingRepository } from './processing-jobs';
import { storageBucketForNode } from './private-storage';
import {
  enqueueImageProcessing,
  hostedImageProcessingLeaseMs,
  hostedProcessingAttempts,
  processCloudflareImages,
  processingOverloadBackoffSeconds,
} from './cloudflare-processing';

async function fallbackToCloudflare(
  env: WorkerEnv,
  workspaceId: string,
  jobId: string,
  delaySeconds = 0,
) {
  if (!(await enqueueImageProcessing(env, workspaceId, jobId, delaySeconds)))
    await processCloudflareImages(env, workspaceId, jobId);
}

type Environment = {
  Bindings: WorkerEnv;
  Variables: { ownerId: string; sessionId: string };
};
export const browserProcessingRoutes = new Hono<Environment>();
export const BROWSER_DERIVATIVES_PATH =
  /^\/api\/v1\/uploads\/[0-9a-f-]{36}\/browser-derivatives$/iu;
// Limit client-buffer copies; the durable storage reservation keeps its existing ceiling.
const MAX_BODY_BYTES = 4 * 1024 * 1024 + 512 * 1024 + 65536;
export const browserDerivativesBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: { code: 'BODY_TOO_LARGE' } }, 413),
});

browserProcessingRoutes.post(
  '/api/v1/uploads/:uploadSessionId/browser-derivatives',
  async (c) => {
    if (
      c.req.header('Origin') !== configuration(c.env).origin ||
      c.req.header('X-Kino-Expected-Actor') !== c.get('ownerId') ||
      c.req.header('X-Kino-Expected-Session') !== c.get('sessionId')
    )
      return c.json({ error: { code: 'OWNER_IDENTITY_CHANGED' } }, 403);
    const parsed = z.uuid().safeParse(c.req.param('uploadSessionId'));
    if (!parsed.success || new URL(c.req.url).search)
      return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
    try {
      // The completion supplies the exact immutable version; clients never choose an asset/key.
      const scope = await c.env.DB.prepare(
        `WITH completed AS (
          SELECT workspace_id,project_id,album_id,photo_id,version_id,asset_id,actor_id
            FROM upload_completions WHERE upload_session_id=?
          UNION ALL
          SELECT workspace_id,project_id,album_id,photo_id,version_id,asset_id,actor_id
            FROM upload_version_completions WHERE upload_session_id=?
        ) SELECT a.id AS job_id,a.workspace_id,a.checksum_sha256,j.status FROM completed u
        JOIN owners o ON o.user_id=u.actor_id AND o.enabled=1
        JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
        JOIN workspaces w ON w.id=u.workspace_id AND w.owner_user_id=o.user_id
        JOIN projects p ON p.id=u.project_id AND p.workspace_id=w.id AND p.status NOT IN('archived','deleting','deleted')
        JOIN albums al ON al.id=u.album_id AND al.project_id=p.id AND al.workspace_id=w.id AND al.state NOT IN('archived','deleting','deleted')
        JOIN photos ph ON ph.id=u.photo_id AND ph.workspace_id=w.id AND ph.project_id=p.id AND ph.album_id=al.id
        JOIN photo_assets a ON a.id=u.asset_id AND a.workspace_id=w.id AND a.photo_id=ph.id AND a.version_id=u.version_id AND a.asset_kind='original' AND a.state='private'
        JOIN image_processing_jobs j ON j.id=a.id AND j.recipe='browser-first-jpeg-82-v1'
        WHERE u.actor_id=?`,
      )
        .bind(parsed.data, parsed.data, c.get('sessionId'), c.get('ownerId'))
        .first<{
          job_id: string;
          workspace_id: string;
          checksum_sha256: string;
          status: string;
        }>();
      if (!scope) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      c.header('Cache-Control', 'private, no-store');
      if (scope.status === 'succeeded') return c.json({ status: 'succeeded' });
      if (
        configuration(c.env).CLOUDFLARE_IMAGE_PROCESSING_ENABLED !== 'true' ||
        !c.env.IMAGES
      )
        return c.json({ error: { code: 'PROCESSING_UNAVAILABLE' } }, 503);
      if (c.req.header('Content-Type') === 'application/json') {
        const body = z
          .object({ fallback: z.literal(true) })
          .strict()
          .safeParse(await c.req.json());
        if (!body.success)
          return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
        c.executionCtx.waitUntil(
          fallbackToCloudflare(c.env, scope.workspace_id, scope.job_id).catch(
            () => console.error('BROWSER_PROCESSING_FALLBACK_FAILED'),
          ),
        );
        return c.json({ status: 'fallback' });
      }
      if (!c.req.header('Content-Type')?.startsWith('multipart/form-data;'))
        return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
      const form = await c.req.formData();
      const entries = [...form.entries()];
      if (
        entries.length !== 3 ||
        form.getAll('sourceSha256').length !== 1 ||
        form.get('sourceSha256') !== scope.checksum_sha256 ||
        form.getAll('thumbnail').length !== 1 ||
        form.getAll('preview').length !== 1 ||
        entries
          .filter(([key]) => key !== 'sourceSha256')
          .some(
            ([key, file]) =>
              !['thumbnail', 'preview'].includes(key) ||
              !(file instanceof File) ||
              file.type !== 'image/jpeg' ||
              file.size < 1 ||
              file.size > (key === 'thumbnail' ? 512 * 1024 : 4 * 1024 * 1024),
          )
      )
        return c.json({ error: { code: 'INVALID_INPUT' } }, 400);
      const jobs = new D1ImageProcessingRepository(c.env.DB, {
        processorVersion: 'browser-first-jpeg-82-v1',
        leaseDurationMs: c.env.IMAGE_PROCESSING_QUEUE
          ? hostedImageProcessingLeaseMs
          : 600_000,
      });
      const node = await jobs.jobStorageNode(scope.job_id);
      if (!node) return c.json({ error: { code: 'NOT_FOUND' } }, 404);
      const objects = new R2ProcessingObjectStore(
        storageBucketForNode(c.env, node),
      );
      const result = await runImageProcessingJob({
        jobId: scope.job_id,
        jobs,
        maxTransientAttempts: c.env.IMAGE_PROCESSING_QUEUE
          ? hostedProcessingAttempts
          : 3,
        objects,
        processor: browserFirstProcessor(
          c.env.DB,
          c.env.IMAGES,
          scope.job_id,
          objects,
          {
            thumbnail: new Uint8Array(
              await (form.get('thumbnail') as File).arrayBuffer(),
            ),
            preview: new Uint8Array(
              await (form.get('preview') as File).arrayBuffer(),
            ),
          },
        ),
      });
      // A rejected client result is never promoted; the durable job stays recoverable.
      if (result.status === 'retryable' || result.status === 'lease_lost') {
        c.executionCtx.waitUntil(
          fallbackToCloudflare(
            c.env,
            scope.workspace_id,
            scope.job_id,
            processingOverloadBackoffSeconds,
          ).catch(() => console.error('BROWSER_PROCESSING_FALLBACK_FAILED')),
        );
      }
      return c.json({ status: result.status });
    } catch {
      console.error('BROWSER_PROCESSING_UNAVAILABLE');
      return c.json({ error: { code: 'PROCESSING_UNAVAILABLE' } }, 503);
    }
  },
);
