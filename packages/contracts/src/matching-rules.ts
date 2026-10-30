import { z } from 'zod';
import {
  MATCHING_PROFILE_IDS,
  getMatchingProfile,
} from '../../domain/src/matching-profiles';
import { projectVersioningModeSchema } from './project-versioning';

const projectRevision = z.number().int().min(1).max(2147483647);
const ruleRevision = z.number().int().min(0).max(2147483647);
export const matchingProfileIdSchema = z.enum(MATCHING_PROFILE_IDS);
export const matchingProfileRulesSchema = z
  .object({
    caseSensitive: z.boolean(),
    allowJpgJpegEquivalence: z.boolean(),
    stripRecognizedSuffixes: z.boolean(),
  })
  .strict();
export const matchingProfileContextSchema = z
  .object({
    profile: matchingProfileIdSchema,
    ruleRevision,
  })
  .strict();
export const matchingRulesCapabilitiesSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export const projectMatchingRulesReadSchema = z
  .object({
    projectId: z.uuid(),
    workspaceId: z.uuid(),
    mode: projectVersioningModeSchema,
    projectRevision,
    profile: matchingProfileIdSchema,
    ruleRevision,
    rules: matchingProfileRulesSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const profile = getMatchingProfile(value.profile);
    if (
      !profile ||
      profile.rules.caseSensitive !== value.rules.caseSensitive ||
      profile.rules.allowJpgJpegEquivalence !==
        value.rules.allowJpgJpegEquivalence ||
      profile.rules.stripRecognizedSuffixes !==
        value.rules.stripRecognizedSuffixes
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Profile and rule tuple must agree',
      });
    }
  });
export const setProjectMatchingRulesSchema = z
  .object({
    requestId: z.uuid(),
    expectedProjectRevision: projectRevision,
    expectedRuleRevision: ruleRevision,
    profile: matchingProfileIdSchema,
    confirm: z.literal(true),
  })
  .strict();
export const setProjectMatchingRulesResultSchema = z
  .object({
    projectId: z.uuid(),
    workspaceId: z.uuid(),
    projectRevision,
    profile: matchingProfileIdSchema,
    ruleRevision,
    changed: z.boolean(),
    eventId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.changed !== (value.eventId !== null))
      context.addIssue({
        code: 'custom',
        message: 'Changed rules require exactly one audit event',
      });
  });
export type MatchingProfileContext = z.infer<
  typeof matchingProfileContextSchema
>;
export type ProjectMatchingRulesRead = z.infer<
  typeof projectMatchingRulesReadSchema
>;
export type SetProjectMatchingRules = z.infer<
  typeof setProjectMatchingRulesSchema
>;
export type SetProjectMatchingRulesResult = z.infer<
  typeof setProjectMatchingRulesResultSchema
>;

const safeCount = z.number().int().nonnegative().safe();
export const matchingRuleIndexStatusSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    projectRevision,
    profile: matchingProfileIdSchema,
    ruleRevision,
    indexedSessions: safeCount,
    missingSessions: safeCount,
    invalidSessions: safeCount,
    unlinkedVersions: safeCount,
    unreadyPhotos: safeCount,
    state: z.enum(['building', 'blocked', 'ready']),
  })
  .strict()
  .superRefine((value, context) => {
    const expected =
      value.missingSessions > 0
        ? 'building'
        : value.invalidSessions > 0 ||
            value.unlinkedVersions > 0 ||
            value.unreadyPhotos > 0
          ? 'blocked'
          : 'ready';
    if (
      value.state !== expected ||
      value.invalidSessions > value.indexedSessions
    )
      context.addIssue({
        code: 'custom',
        message: 'Index state must agree with scoped coverage counters',
      });
  });
export const advanceMatchingRuleIndexSchema = z
  .object({
    expectedProjectRevision: projectRevision,
    expectedRuleRevision: ruleRevision,
    profile: matchingProfileIdSchema,
  })
  .strict();
export type MatchingRuleIndexStatus = z.infer<
  typeof matchingRuleIndexStatusSchema
>;
export type AdvanceMatchingRuleIndex = z.infer<
  typeof advanceMatchingRuleIndexSchema
>;
