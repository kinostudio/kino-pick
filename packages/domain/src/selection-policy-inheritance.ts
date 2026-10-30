import { z } from 'zod';
import { selectionBoundsSchema } from '../../contracts/src/selection-policy';

const persistedPolicy = selectionBoundsSchema.safeExtend({
  revision: z.number().int().positive(),
});

export const selectionPolicyInheritanceInputSchema = z
  .object({
    project: persistedPolicy.nullable(),
    album: z
      .union([
        persistedPolicy,
        z
          .object({
            mode: z.literal('inherit'),
            revision: z.number().int().positive(),
          })
          .strict(),
      ])
      .nullable(),
  })
  .strict();

export type SelectionPolicyInheritanceInput = z.infer<
  typeof selectionPolicyInheritanceInputSchema
>;

/** Resolve one consistent database snapshot; this function grants no authority. */
export function resolveSelectionPolicyInheritance(
  input: SelectionPolicyInheritanceInput,
) {
  const { project, album } = selectionPolicyInheritanceInputSchema.parse(input);
  const override = album?.mode === 'private' ? album : null;
  const source = override ? 'album' : project ? 'project' : 'system';
  const effective = override ?? project;
  return {
    minimum: effective?.minimum ?? 1,
    // An explicit unlimited album override must not fall through to the project.
    maximum: effective ? effective.maximum : null,
    mode: 'private' as const,
    source,
    // Retain both epochs, including hidden defaults, for source-transition CAS.
    projectRevision: project?.revision ?? 0,
    albumRevision: album?.revision ?? 0,
  };
}
