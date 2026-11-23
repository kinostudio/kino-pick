import { z } from 'zod';
import {
  uploadJournalKey,
  uploadJournalScopeSchema,
  type UploadJournalScope,
} from './upload-journal';

const envelope = z
  .object({
    version: z.literal(1),
    scope: uploadJournalScopeSchema,
    files: z
      .array(
        z
          .object({
            id: z.uuid(),
            key: z.string().min(1).max(2048),
            name: z.string().min(1).max(255),
            bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            state: z.enum(['pending', 'completed', 'skipped']),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/u)
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();

export type BatchFile = z.infer<typeof envelope>['files'][number];

export function batchKey(scope: UploadJournalScope) {
  return uploadJournalKey(scope) + ':folder';
}

export function encodeFolderBatch(
  scope: UploadJournalScope,
  files: BatchFile[],
) {
  return JSON.stringify(envelope.parse({ version: 1, scope, files }));
}

export function readFolderBatch(scope: UploadJournalScope) {
  const text = localStorage.getItem(batchKey(scope));
  if (text === null) return [];
  const batch = envelope.parse(JSON.parse(text));
  if (
    batchKey(batch.scope) !== batchKey(scope) ||
    new Set(batch.files.map((file) => file.id)).size !== batch.files.length ||
    new Set(batch.files.map((file) => file.key)).size !== batch.files.length ||
    batch.files.some((file) => file.state === 'completed' && !file.sha256)
  )
    throw new Error('Invalid saved folder batch');
  return batch.files;
}
