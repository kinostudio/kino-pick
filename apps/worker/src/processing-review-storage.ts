import { z } from 'zod';
import { PROCESSING_RECIPES } from '../../../packages/image-processing/src/recipes.ts';

const emptyHash =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const fenceMime = 'application/x-kino-pic-processing-fence';
const slotSchema = z
  .object({
    jobId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    recipe: z.enum(PROCESSING_RECIPES).default('local-sharp-0.35.5-v1'),
    kind: z.enum(['thumbnail', 'preview']),
    key: z.string(),
  })
  .strict()
  .refine(
    (slot) =>
      slot.key ===
      `${slot.workspaceId}/${slot.projectId}/${slot.albumId}/${slot.jobId}/derived/${slot.recipe}/${slot.kind}.jpg`,
  );
export type ReviewOutputSlot = z.input<typeof slotSchema>;
export type ReviewOutputState = 'missing' | 'fenced' | 'occupied' | 'unknown';
type ReviewBucket = Pick<R2Bucket, 'head' | 'put'>;

/** Trusted binding primitive only. Never expose client-chosen keys or treat it as quota-release authority. */
export class R2ProcessingReviewStore {
  private bucket: ReviewBucket;
  constructor(bucket: ReviewBucket) {
    this.bucket = bucket;
  }
  async inspect(value: ReviewOutputSlot): Promise<ReviewOutputState> {
    const slot = slotSchema.parse(value);
    try {
      const item = await this.bucket.head(slot.key);
      if (!item) return 'missing';
      const hash = item.checksums.sha256
        ? Array.from(new Uint8Array(item.checksums.sha256), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('')
        : null;
      return item.size === 0 &&
        hash === emptyHash &&
        item.httpMetadata?.contentType === fenceMime &&
        item.customMetadata?.kinoProcessingFence === slot.jobId &&
        item.customMetadata?.kinoProcessingKind === slot.kind
        ? 'fenced'
        : 'occupied';
    } catch {
      return 'unknown';
    }
  }
  async fence(value: ReviewOutputSlot): Promise<ReviewOutputState> {
    const slot = slotSchema.parse(value);
    try {
      const body = new Uint8Array();
      await this.bucket.put(slot.key, body, {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: fenceMime },
        customMetadata: {
          kinoProcessingFence: slot.jobId,
          kinoProcessingKind: slot.kind,
        },
        sha256: await crypto.subtle.digest('SHA-256', body),
      });
    } catch {
      // The PUT may have committed. Readback below resolves it if possible; never infer success from a timeout.
    }
    return this.inspect(slot);
  }
  async fenceBoth(values: readonly ReviewOutputSlot[]) {
    const slots = z.array(slotSchema).length(2).parse(values);
    const first = slots[0]!;
    if (
      new Set(slots.map((slot) => slot.kind)).size !== 2 ||
      slots.some(
        (slot) =>
          slot.jobId !== first.jobId ||
          slot.recipe !== first.recipe ||
          slot.workspaceId !== first.workspaceId ||
          slot.projectId !== first.projectId ||
          slot.albumId !== first.albumId,
      )
    )
      throw new Error('PROCESSING_OUTPUT_SCOPE_MISMATCH');
    const outputs: {
      kind: 'thumbnail' | 'preview';
      state: ReviewOutputState;
    }[] = [];
    for (const slot of slots)
      outputs.push({ kind: slot.kind, state: await this.fence(slot) });
    // This describes physical fences only. A future authorized SQL command must atomically release quota/audit.
    return {
      bothFenced: outputs.every((output) => output.state === 'fenced'),
      outputs,
    };
  }
}
