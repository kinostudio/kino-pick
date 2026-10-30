import {
  canonicalizePhotoFilename,
  type CanonicalPhotoFilename,
} from './version-matching';

export const MATCHING_PROFILE_IDS = Object.freeze([
  'default-v1',
  'rules-v1-001',
  'rules-v1-010',
  'rules-v1-011',
  'rules-v1-100',
  'rules-v1-101',
  'rules-v1-110',
  'rules-v1-111',
] as const);

export type MatchingProfileId = (typeof MATCHING_PROFILE_IDS)[number];

export type MatchingProfileRules = Readonly<{
  caseSensitive: boolean;
  allowJpgJpegEquivalence: boolean;
  stripRecognizedSuffixes: boolean;
}>;

export type MatchingProfile = Readonly<{
  id: MatchingProfileId;
  rules: MatchingProfileRules;
}>;

type RuleBits = '000' | '001' | '010' | '011' | '100' | '101' | '110' | '111';
type RuleKey = keyof MatchingProfileRules;

const RULE_KEYS: readonly RuleKey[] = Object.freeze([
  'caseSensitive',
  'allowJpgJpegEquivalence',
  'stripRecognizedSuffixes',
]);

function createProfile(id: MatchingProfileId, bits: RuleBits): MatchingProfile {
  return Object.freeze({
    id,
    rules: Object.freeze({
      caseSensitive: bits[0] !== '1',
      allowJpgJpegEquivalence: bits[1] === '1',
      stripRecognizedSuffixes: bits[2] === '1',
    }),
  });
}

export const MATCHING_PROFILES: readonly MatchingProfile[] = Object.freeze([
  createProfile('default-v1', '000'),
  createProfile('rules-v1-001', '001'),
  createProfile('rules-v1-010', '010'),
  createProfile('rules-v1-011', '011'),
  createProfile('rules-v1-100', '100'),
  createProfile('rules-v1-101', '101'),
  createProfile('rules-v1-110', '110'),
  createProfile('rules-v1-111', '111'),
]);

export function getMatchingProfile(input: unknown): MatchingProfile | null {
  if (typeof input !== 'string') return null;
  return MATCHING_PROFILES.find((profile) => profile.id === input) ?? null;
}

function readStrictRules(input: unknown): MatchingProfileRules | null {
  try {
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      return null;

    const prototype = Object.getPrototypeOf(input) as unknown;
    if (prototype !== Object.prototype && prototype !== null) return null;

    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== RULE_KEYS.length ||
      ownKeys.some(
        (key) => typeof key !== 'string' || !RULE_KEYS.includes(key as RuleKey),
      )
    )
      return null;

    const rules: Record<RuleKey, boolean> = Object.create(null) as Record<
      RuleKey,
      boolean
    >;
    for (const key of RULE_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'boolean'
      )
        return null;
      rules[key] = descriptor.value;
    }
    return Object.freeze(rules);
  } catch {
    return null;
  }
}

export function matchingProfileForRules(
  input: unknown,
): MatchingProfile | null {
  const rules = readStrictRules(input);
  if (!rules) return null;
  return (
    MATCHING_PROFILES.find(
      (profile) =>
        profile.rules.caseSensitive === rules.caseSensitive &&
        profile.rules.allowJpgJpegEquivalence ===
          rules.allowJpgJpegEquivalence &&
        profile.rules.stripRecognizedSuffixes === rules.stripRecognizedSuffixes,
    ) ?? null
  );
}

export function canonicalizeMatchingProfileFilename(
  filename: string,
  profile: MatchingProfileId,
): CanonicalPhotoFilename | null {
  const knownProfile = getMatchingProfile(profile);
  if (!knownProfile || typeof filename !== 'string') return null;
  return canonicalizePhotoFilename(filename, knownProfile.rules);
}
