import { describe, expect, it } from 'vitest';
import {
  canonicalizePhotoFilename,
  matchPhotoVersion,
  type VersionMatchCandidate,
} from '../../packages/domain/src/version-matching';
import {
  canonicalizeMatchingProfileFilename,
  getMatchingProfile,
  MATCHING_PROFILES,
  MATCHING_PROFILE_IDS,
  matchingProfileForRules,
  type MatchingProfileId,
} from '../../packages/domain/src/matching-profiles';

const scope = {
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  albumId: 'album-1',
} as const;
const dimensions = { width: 3000, height: 2000 } as const;

describe('immutable matching profiles', () => {
  it('registers all eight binary rule combinations bijectively', () => {
    const cases = [
      ['default-v1', '000', true, false, false],
      ['rules-v1-001', '001', true, false, true],
      ['rules-v1-010', '010', true, true, false],
      ['rules-v1-011', '011', true, true, true],
      ['rules-v1-100', '100', false, false, false],
      ['rules-v1-101', '101', false, false, true],
      ['rules-v1-110', '110', false, true, false],
      ['rules-v1-111', '111', false, true, true],
    ] as const;

    expect(MATCHING_PROFILES).toHaveLength(8);
    expect(MATCHING_PROFILE_IDS).toEqual(cases.map(([id]) => id));
    expect(Object.isFrozen(MATCHING_PROFILE_IDS)).toBe(true);
    expect(new Set(MATCHING_PROFILES.map((profile) => profile.id)).size).toBe(
      8,
    );
    for (const [id, , caseSensitive, jpgJpeg, stripSuffixes] of cases) {
      const profile = getMatchingProfile(id);
      expect(profile).not.toBeNull();
      expect(profile?.rules).toEqual({
        caseSensitive,
        allowJpgJpegEquivalence: jpgJpeg,
        stripRecognizedSuffixes: stripSuffixes,
      });
      expect(profile).toBe(matchingProfileForRules(profile?.rules));
    }
  });

  it('freezes the registry, profiles, and rule tuples', () => {
    expect(Object.isFrozen(MATCHING_PROFILES)).toBe(true);
    for (const profile of MATCHING_PROFILES) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.rules)).toBe(true);
    }
  });

  it('keeps default-v1 canonicalization identical to existing defaults', () => {
    for (const filename of [
      ' portrait.jpg ',
      'cafe\u0301.jpeg',
      'portrait.raw',
      'portrait/child.jpg',
      'portrait\u0000.jpg',
    ])
      expect(
        canonicalizeMatchingProfileFilename(filename, 'default-v1'),
      ).toEqual(canonicalizePhotoFilename(filename));
  });

  it('strictly rejects unknown IDs and rule objects with extra or invalid fields', () => {
    const defaultRules = {
      caseSensitive: true,
      allowJpgJpegEquivalence: false,
      stripRecognizedSuffixes: false,
    };
    expect(getMatchingProfile('rules-v1-000')).toBeNull();
    expect(getMatchingProfile({ id: 'default-v1' })).toBeNull();
    expect(getMatchingProfile(null)).toBeNull();
    expect(matchingProfileForRules(defaultRules)?.id).toBe('default-v1');

    for (const invalid of [
      null,
      [],
      {},
      { caseSensitive: true },
      { ...defaultRules, locale: 'en' },
      { ...defaultRules, regex: '.*' },
      { ...defaultRules, extra: false },
      { ...defaultRules, caseSensitive: 'true' },
      { ...defaultRules, allowJpgJpegEquivalence: 0 },
    ])
      expect(matchingProfileForRules(invalid)).toBeNull();

    const withSymbol = {
      ...defaultRules,
      [Symbol('extra')]: true,
    };
    expect(matchingProfileForRules(withSymbol)).toBeNull();

    const withGetter = Object.defineProperties(
      {},
      {
        caseSensitive: { enumerable: true, get: () => true },
        allowJpgJpegEquivalence: { enumerable: true, value: false },
        stripRecognizedSuffixes: { enumerable: true, value: false },
      },
    );
    expect(matchingProfileForRules(withGetter)).toBeNull();
  });

  it('uses deterministic Unicode case folding only for profiles that opt in', () => {
    expect(
      canonicalizeMatchingProfileFilename('ÄPFEL.jpg', 'default-v1'),
    ).not.toEqual(
      canonicalizeMatchingProfileFilename('äpfel.jpg', 'default-v1'),
    );
    expect(
      canonicalizeMatchingProfileFilename('ÄPFEL.jpg', 'rules-v1-100'),
    ).toEqual(canonicalizeMatchingProfileFilename('äpfel.jpg', 'rules-v1-100'));
    expect(
      canonicalizeMatchingProfileFilename('I.jpg', 'rules-v1-100'),
    ).not.toEqual(canonicalizeMatchingProfileFilename('ı.jpg', 'rules-v1-100'));
  });

  it('aliases only JPG and JPEG when enabled', () => {
    expect(
      canonicalizeMatchingProfileFilename('portrait.jpg', 'default-v1'),
    ).not.toEqual(
      canonicalizeMatchingProfileFilename('portrait.jpeg', 'default-v1'),
    );
    expect(
      canonicalizeMatchingProfileFilename('portrait.jpg', 'rules-v1-010'),
    ).toEqual(
      canonicalizeMatchingProfileFilename('portrait.jpeg', 'rules-v1-010'),
    );
    expect(
      canonicalizeMatchingProfileFilename('portrait.png', 'rules-v1-010'),
    ).not.toEqual(
      canonicalizeMatchingProfileFilename('portrait.jpeg', 'rules-v1-010'),
    );
  });

  it('strips at most one recognized terminal suffix and preserves unknown extensions', () => {
    expect(
      canonicalizeMatchingProfileFilename('scene_edited.jpg', 'rules-v1-001'),
    ).toEqual({ basename: 'scene', extension: 'jpg' });
    expect(
      canonicalizeMatchingProfileFilename(
        'scene_edited_v12.jpg',
        'rules-v1-001',
      ),
    ).toEqual({ basename: 'scene_edited', extension: 'jpg' });
    expect(
      canonicalizeMatchingProfileFilename('scene_edits.jpg', 'rules-v1-001'),
    ).toEqual({ basename: 'scene_edits', extension: 'jpg' });
    expect(
      canonicalizeMatchingProfileFilename('portrait.raw', 'rules-v1-111'),
    ).toEqual({ basename: 'portrait.raw', extension: null });
  });

  it('fails closed for invalid filenames and unknown runtime profile values', () => {
    expect(
      canonicalizeMatchingProfileFilename('/portrait.jpg', 'default-v1'),
    ).toBeNull();
    expect(
      canonicalizeMatchingProfileFilename(
        'portrait.jpg',
        'unknown-v2' as MatchingProfileId,
      ),
    ).toBeNull();
  });

  it('uses the selected profile with the existing ambiguity classifier', () => {
    const candidates: VersionMatchCandidate[] = [
      {
        scope,
        photoId: 'photo-1',
        versionId: 'version-1',
        filename: 'Portrait_edited.jpg',
        sha256: 'a'.repeat(64),
        dimensions,
      },
      {
        scope,
        photoId: 'photo-2',
        versionId: 'version-2',
        filename: 'portrait.jpeg',
        sha256: 'b'.repeat(64),
        dimensions,
      },
    ];
    const profile = getMatchingProfile('rules-v1-111');
    expect(profile).not.toBeNull();

    expect(
      matchPhotoVersion({
        scope,
        mode: 'auto_filename',
        filename: 'portrait_v2.jpg',
        sha256: 'c'.repeat(64),
        dimensions,
        candidates,
        candidatesTruncated: false,
        options: profile!.rules,
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'ambiguous_filename_match',
    });
  });
});

it('retains locale-free lowercase expansion without truncating a valid original filename', () => {
  const original = 'İ'.repeat(250) + '.png';
  expect(original.length).toBe(254);
  const canonical = canonicalizeMatchingProfileFilename(
    original,
    'rules-v1-100',
  );
  expect(canonical).toEqual({
    basename: ('i' + String.fromCodePoint(0x0307)).repeat(250),
    extension: 'png',
  });
  expect(canonical?.basename.length).toBe(500);
  expect(
    canonicalizeMatchingProfileFilename(original, 'default-v1')?.basename,
  ).toBe('İ'.repeat(250));
});
