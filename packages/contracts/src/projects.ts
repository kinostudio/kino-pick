import { z } from 'zod';
import { roleSchema } from './identity';
// PostgreSQL char_length counts Unicode code points, including astral characters.
const name = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => [...value].length <= 160,
    'Name must contain at most 160 characters',
  );
const revision = z.number().int().positive().max(2147483647);
export const projectSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name,
  status: z.enum([
    'draft',
    'uploading',
    'selecting',
    'submitted',
    'retouching',
    'reviewing',
    'approved',
    'delivered',
    'archived',
  ]),
  versioningMode: z.enum(['off', 'manual', 'auto_filename', 'assisted']),
  revision,
  createdAt: z.iso.datetime({ offset: true }),
});
export const albumSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  name,
  state: z.enum(['draft', 'active', 'archived', 'deleting', 'deleted']),
  isPinned: z.boolean(),
  legalHold: z.boolean(),
  revision,
  createdAt: z.iso.datetime({ offset: true }),
});
export const createProjectSchema = z
  .object({ workspaceId: z.uuid(), name, requestId: z.uuid() })
  .strict();
export const createAlbumSchema = z
  .object({ name, requestId: z.uuid() })
  .strict();
export const renameContentSchema = z
  .object({ name, expectedRevision: revision, requestId: z.uuid() })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export type Album = z.infer<typeof albumSchema>;
export function canManageContent(role: z.infer<typeof roleSchema>): boolean {
  return (
    role === 'workspace_owner' ||
    role === 'workspace_editor' ||
    role === 'photographer'
  );
}

export const albumProtectionSchema = z
  .object({
    isPinned: z.boolean(),
    legalHold: z.boolean(),
    expectedRevision: revision,
    confirmUnprotect: z.boolean(),
    requestId: z.uuid(),
  })
  .strict();
