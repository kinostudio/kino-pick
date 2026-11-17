import type { ImageProcessingAdapter } from '../../../packages/domain/src';
import {
  BrowserFirstImageProcessor,
  type BrowserFirstDerivatives,
} from '../../../packages/image-processing/src/browser-first';
import type { ProcessingObjectStore } from '../../../packages/image-processing/src/durable-runner';

/** Reuse already-verified immutable slots when a previous attempt stopped mid-write. */
export function browserFirstProcessor(
  db: D1Database,
  images: ImagesBinding,
  jobId: string,
  objects: ProcessingObjectStore,
  derivatives?: BrowserFirstDerivatives,
): ImageProcessingAdapter {
  return {
    async process(input) {
      const rows = await db
        .prepare(
          `SELECT o.kind,o.object_key FROM image_processing_outputs o
        JOIN image_processing_jobs j ON j.id=o.job_id AND j.status='running' AND j.lease_epoch>1 AND j.recipe='browser-first-jpeg-82-v1'
        JOIN photo_assets a ON a.id=j.id AND a.asset_kind='original' AND a.state='private'
        JOIN photos p ON p.id=a.photo_id AND p.workspace_id=a.workspace_id
        WHERE j.id=? AND p.workspace_id=? AND p.project_id=? AND p.album_id=? AND p.id=? AND a.version_id=?`,
        )
        .bind(
          jobId,
          input.scope.workspaceId,
          input.scope.projectId,
          input.scope.albumId,
          input.photoId,
          input.versionId,
        )
        .all<{ kind: 'thumbnail' | 'preview'; object_key: string }>();
      if (!rows.success || rows.results.length > 2)
        throw new Error('PROCESSING_OUTPUTS_UNAVAILABLE');
      const existing: { thumbnail?: Uint8Array; preview?: Uint8Array } = {};
      for (const slot of rows.results) {
        if (
          !['thumbnail', 'preview'].includes(slot.kind) ||
          existing[slot.kind]
        )
          throw new Error('PROCESSING_OUTPUTS_UNAVAILABLE');
        try {
          existing[slot.kind] = await objects.read(
            input.scope,
            slot.object_key,
            8388608,
          );
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.message !== 'PROCESSING_OBJECT_MISSING'
          )
            throw error;
        }
      }
      return new BrowserFirstImageProcessor(
        images,
        derivatives,
        Object.keys(existing).length ? existing : undefined,
      ).process(input);
    },
  };
}
