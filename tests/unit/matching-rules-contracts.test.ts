import { describe, expect, it } from 'vitest';
import {
  matchingProfileContextSchema,
  matchingProfileIdSchema,
  matchingProfileRulesSchema,
  matchingRulesCapabilitiesSchema,
  projectMatchingRulesReadSchema,
  setProjectMatchingRulesResultSchema,
  setProjectMatchingRulesSchema,
} from '../../packages/contracts/src/matching-rules';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';

const profiles = [
  {
    id: 'default-v1',
    rules: {
      caseSensitive: true,
      allowJpgJpegEquivalence: false,
      stripRecognizedSuffixes: false,
    },
  },
  {
    id: 'rules-v1-001',
    rules: {
      caseSensitive: true,
      allowJpgJpegEquivalence: false,
      stripRecognizedSuffixes: true,
    },
  },
  {
    id: 'rules-v1-010',
    rules: {
      caseSensitive: true,
      allowJpgJpegEquivalence: true,
      stripRecognizedSuffixes: false,
    },
  },
  {
    id: 'rules-v1-011',
    rules: {
      caseSensitive: true,
      allowJpgJpegEquivalence: true,
      stripRecognizedSuffixes: true,
    },
  },
  {
    id: 'rules-v1-100',
    rules: {
      caseSensitive: false,
      allowJpgJpegEquivalence: false,
      stripRecognizedSuffixes: false,
    },
  },
  {
    id: 'rules-v1-101',
    rules: {
      caseSensitive: false,
      allowJpgJpegEquivalence: false,
      stripRecognizedSuffixes: true,
    },
  },
  {
    id: 'rules-v1-110',
    rules: {
      caseSensitive: false,
      allowJpgJpegEquivalence: true,
      stripRecognizedSuffixes: false,
    },
  },
  {
    id: 'rules-v1-111',
    rules: {
      caseSensitive: false,
      allowJpgJpegEquivalence: true,
      stripRecognizedSuffixes: true,
    },
  },
] as const;

const defaultRules = profiles[0].rules;

function readValue(
  profile: (typeof profiles)[number]['id'],
  rules: (typeof profiles)[number]['rules'],
) {
  return {
    projectId,
    workspaceId,
    mode: 'manual',
    projectRevision: 1,
    profile,
    ruleRevision: 0,
    rules,
  };
}

const setBody = {
  requestId,
  expectedProjectRevision: 1,
  expectedRuleRevision: 0,
  profile: 'default-v1',
  confirm: true,
};

describe('Matching rules contracts', () => {
  it('accepts exactly the finite eight profile IDs and their coherent rule tuples', () => {
    expect(profiles).toHaveLength(8);

    for (const profile of profiles) {
      expect(matchingProfileIdSchema.safeParse(profile.id).success).toBe(true);
      expect(
        projectMatchingRulesReadSchema.safeParse(
          readValue(profile.id, profile.rules),
        ).success,
      ).toBe(true);
    }

    expect(matchingProfileIdSchema.options).toEqual(
      profiles.map((profile) => profile.id),
    );
    for (const unknownProfile of [
      'rules-v1-000',
      'rules-v1-1000',
      'casefold-v2',
      { id: 'default-v1' },
      null,
    ]) {
      expect(matchingProfileIdSchema.safeParse(unknownProfile).success).toBe(
        false,
      );
    }
  });

  it('requires the strict three-boolean tuple and rejects profile/rule mismatches', () => {
    expect(matchingProfileRulesSchema.parse(defaultRules)).toEqual(
      defaultRules,
    );

    for (const field of [
      'caseSensitive',
      'allowJpgJpegEquivalence',
      'stripRecognizedSuffixes',
    ] as const) {
      expect(
        matchingProfileRulesSchema.safeParse({
          ...defaultRules,
          [field]: 'true',
        }).success,
      ).toBe(false);

      const missingField: Record<string, unknown> = { ...defaultRules };
      delete missingField[field];
      expect(matchingProfileRulesSchema.safeParse(missingField).success).toBe(
        false,
      );
    }

    for (const extra of [
      { locale: 'en' },
      { regex: '.*' },
      { arbitraryRule: true },
    ]) {
      expect(
        matchingProfileRulesSchema.safeParse({ ...defaultRules, ...extra })
          .success,
      ).toBe(false);
    }

    for (const profile of profiles) {
      expect(
        projectMatchingRulesReadSchema.safeParse({
          ...readValue(profile.id, profile.rules),
          rules: {
            ...profile.rules,
            caseSensitive: !profile.rules.caseSensitive,
          },
        }).success,
      ).toBe(false);
    }
  });

  it('strictly scopes profile context and bounds the rule revision', () => {
    expect(
      matchingProfileContextSchema.parse({
        profile: 'default-v1',
        ruleRevision: 0,
      }),
    ).toEqual({ profile: 'default-v1', ruleRevision: 0 });
    expect(
      matchingProfileContextSchema.parse({
        profile: 'rules-v1-111',
        ruleRevision: 2147483647,
      }),
    ).toEqual({ profile: 'rules-v1-111', ruleRevision: 2147483647 });

    for (const ruleRevision of [
      -1,
      1.5,
      2147483648,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
    ]) {
      expect(
        matchingProfileContextSchema.safeParse({
          profile: 'default-v1',
          ruleRevision,
        }).success,
      ).toBe(false);
    }

    for (const invalid of [
      { profile: 'rules-v1-000', ruleRevision: 0 },
      { profile: 'default-v1', ruleRevision: 0, locale: 'tr' },
      { profile: 'default-v1', ruleRevision: 0, regex: '.*' },
    ]) {
      expect(matchingProfileContextSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it('bounds project and rule revisions and keeps the read shape strict', () => {
    const valid = readValue('default-v1', defaultRules);
    expect(
      projectMatchingRulesReadSchema.parse({
        ...valid,
        projectRevision: 2147483647,
        ruleRevision: 2147483647,
      }),
    ).toMatchObject({
      projectRevision: 2147483647,
      ruleRevision: 2147483647,
    });

    for (const projectRevision of [
      0,
      -1,
      1.5,
      2147483648,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        projectMatchingRulesReadSchema.safeParse({
          ...valid,
          projectRevision,
        }).success,
      ).toBe(false);
    }
    for (const ruleRevision of [
      -1,
      1.5,
      2147483648,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        projectMatchingRulesReadSchema.safeParse({
          ...valid,
          ruleRevision,
        }).success,
      ).toBe(false);
    }

    expect(
      projectMatchingRulesReadSchema.safeParse({
        ...valid,
        rules: { ...defaultRules, locale: 'en' },
      }).success,
    ).toBe(false);
    expect(
      projectMatchingRulesReadSchema.safeParse({
        ...valid,
        privateData: 'must not be returned',
      }).success,
    ).toBe(false);
  });

  it('requires both expected revisions and explicit confirmation on set commands', () => {
    expect(setProjectMatchingRulesSchema.parse(setBody)).toEqual(setBody);

    for (const field of [
      'requestId',
      'expectedProjectRevision',
      'expectedRuleRevision',
      'profile',
      'confirm',
    ]) {
      const missingField: Record<string, unknown> = { ...setBody };
      delete missingField[field];
      expect(
        setProjectMatchingRulesSchema.safeParse(missingField).success,
      ).toBe(false);
    }

    for (const invalid of [
      { ...setBody, expectedProjectRevision: 0 },
      { ...setBody, expectedProjectRevision: 2147483648 },
      { ...setBody, expectedProjectRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...setBody, expectedRuleRevision: -1 },
      { ...setBody, expectedRuleRevision: 2147483648 },
      { ...setBody, expectedRuleRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...setBody, expectedRuleRevision: 0.5 },
      { ...setBody, profile: 'rules-v1-000' },
      { ...setBody, confirm: false },
      { ...setBody, confirm: undefined },
      { ...setBody, requestId: 'not-a-uuid' },
      { ...setBody, projectId },
      { ...setBody, workspaceId },
      { ...setBody, rules: defaultRules },
      { ...setBody, locale: 'en' },
      { ...setBody, regex: '.*' },
    ]) {
      expect(setProjectMatchingRulesSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it('ties changed results to exactly one audit event and no-op results to none', () => {
    const changed = {
      projectId,
      workspaceId,
      projectRevision: 2,
      profile: 'rules-v1-111',
      ruleRevision: 1,
      changed: true,
      eventId,
    };
    const unchanged = {
      ...changed,
      projectRevision: 1,
      profile: 'default-v1',
      ruleRevision: 0,
      changed: false,
      eventId: null,
    };

    expect(setProjectMatchingRulesResultSchema.parse(changed)).toEqual(changed);
    expect(setProjectMatchingRulesResultSchema.parse(unchanged)).toEqual(
      unchanged,
    );

    for (const invalid of [
      { ...changed, eventId: null },
      { ...changed, changed: false },
      { ...unchanged, eventId },
      { ...changed, eventId: 'not-a-uuid' },
      { ...changed, profile: 'rules-v1-000' },
      { ...changed, projectRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...changed, ruleRevision: Number.MAX_SAFE_INTEGER + 1 },
      { ...changed, requestId },
    ]) {
      expect(
        setProjectMatchingRulesResultSchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it('exposes only the matching-rules capability flag', () => {
    expect(matchingRulesCapabilitiesSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    });
    expect(matchingRulesCapabilitiesSchema.parse({ enabled: true })).toEqual({
      enabled: true,
    });
    expect(
      matchingRulesCapabilitiesSchema.safeParse({
        enabled: true,
        profile: 'default-v1',
      }).success,
    ).toBe(false);
  });
});
