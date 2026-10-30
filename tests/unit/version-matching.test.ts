import { describe, expect, it } from 'vitest';
import {
  canonicalizePhotoFilename,
  matchPhotoVersion,
  VERSION_MATCH_LIMITS,
  type VersionMatchCandidate,
  type VersionMatchingInput,
} from '../../packages/domain/src/version-matching';

const scope = {
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  albumId: 'album-1',
} as const;
const dimensions = { width: 3000, height: 2000 } as const;
const oldHash = 'a'.repeat(64);
const newHash = 'b'.repeat(64);

function candidate(
  overrides: Partial<VersionMatchCandidate> = {},
): VersionMatchCandidate {
  return {
    scope,
    photoId: 'photo-1',
    versionId: 'version-1',
    filename: 'portrait.jpg',
    sha256: oldHash,
    dimensions,
    ...overrides,
  };
}

function classify(overrides: Partial<VersionMatchingInput> = {}) {
  const input: VersionMatchingInput = {
    scope,
    mode: 'auto_filename',
    filename: 'portrait.jpg',
    sha256: newHash,
    dimensions,
    candidates: [candidate()],
    ...overrides,
  };
  return matchPhotoVersion(input);
}

describe('photo version filename matching', () => {
  it('normalizes NFC and surrounding whitespace without mutating the original filename', () => {
    const filename = '  cafe\u0301.jpg  ';
    const input = {
      scope,
      mode: 'auto_filename',
      filename,
      sha256: newHash,
      dimensions,
      candidates: [candidate({ filename: 'café.jpg' })],
    } satisfies VersionMatchingInput;

    expect(matchPhotoVersion(input)).toMatchObject({
      outcome: 'new_version',
      photoId: 'photo-1',
    });
    expect(input.filename).toBe(filename);
    expect(canonicalizePhotoFilename(filename)).toEqual({
      basename: 'café',
      extension: 'jpg',
    });
  });

  it('bounds raw and trimmed filenames by UTF-16 code units', () => {
    const rawAtLimit = ' '.repeat(1024 - 'name.jpg'.length) + 'name.jpg';
    expect(rawAtLimit.length).toBe(1024);
    expect(canonicalizePhotoFilename(rawAtLimit)).toEqual({
      basename: 'name',
      extension: 'jpg',
    });
    expect(canonicalizePhotoFilename(' '.repeat(1025) + 'name.jpg')).toBeNull();

    expect(canonicalizePhotoFilename('a'.repeat(255))?.basename).toHaveLength(
      255,
    );
    expect(canonicalizePhotoFilename('a'.repeat(256))).toBeNull();
    expect(canonicalizePhotoFilename('😀'.repeat(128))).toBeNull();
  });
  it('rejects paths, control characters, malformed hashes, and invalid dimensions', () => {
    for (const filename of [
      '/portrait.jpg',
      '..\\portrait.jpg',
      'portrait\u0000.jpg',
    ])
      expect(classify({ filename })).toMatchObject({
        outcome: 'requires_review',
        reason: 'invalid_filename',
      });

    expect(classify({ sha256: 'not-a-sha256' })).toMatchObject({
      outcome: 'requires_review',
      reason: 'invalid_sha256',
    });
    for (const invalidDimensions of [
      { width: 0, height: 20 },
      { width: 1.5, height: 20 },
      { width: 32769, height: 1 },
      { width: Number.NaN, height: 20 },
    ])
      expect(classify({ dimensions: invalidDimensions })).toMatchObject({
        outcome: 'requires_review',
        reason: 'invalid_dimensions',
      });
  });

  it('keeps known extensions distinct unless JPG/JPEG equivalence is enabled', () => {
    expect(
      classify({
        filename: 'portrait.jpeg',
        candidates: [candidate({ filename: 'portrait.jpg' })],
      }),
    ).toMatchObject({ outcome: 'new_photo', reason: 'no_filename_match' });

    expect(
      classify({
        filename: 'portrait.jpeg',
        candidates: [candidate({ filename: 'portrait.jpg' })],
        options: { allowJpgJpegEquivalence: true },
      }),
    ).toMatchObject({ outcome: 'new_version', photoId: 'photo-1' });

    expect(
      classify({
        filename: 'portrait.png',
        candidates: [candidate({ filename: 'portrait.jpg' })],
        options: { allowJpgJpegEquivalence: true },
      }),
    ).toMatchObject({ outcome: 'new_photo' });
  });

  it('uses case-sensitive comparison by default and an explicit locale when requested', () => {
    expect(
      classify({
        filename: 'Image.jpg',
        candidates: [candidate({ filename: 'image.jpg' })],
      }),
    ).toMatchObject({ outcome: 'new_photo' });
    expect(
      classify({
        filename: 'Image.jpg',
        candidates: [candidate({ filename: 'image.jpg' })],
        options: { caseSensitive: false },
      }),
    ).toMatchObject({ outcome: 'new_version' });

    expect(
      classify({
        filename: 'I.jpg',
        candidates: [candidate({ filename: 'ı.jpg' })],
        options: { caseSensitive: false },
      }),
    ).toMatchObject({ outcome: 'new_photo' });
    expect(
      classify({
        filename: 'I.jpg',
        candidates: [candidate({ filename: 'ı.jpg' })],
        options: { caseSensitive: false, locale: 'tr' },
      }),
    ).toMatchObject({ outcome: 'new_version' });
  });

  it('strips recognized edit/version suffixes only when explicitly enabled', () => {
    for (const suffix of [
      '_edited',
      '_retouched',
      '_edit',
      '-edit',
      '_v2',
      '-v19',
    ]) {
      expect(
        classify({
          filename: 'portrait' + suffix + '.jpg',
          candidates: [candidate({ filename: 'portrait.jpg' })],
        }),
      ).toMatchObject({ outcome: 'new_photo' });
      expect(
        classify({
          filename: 'portrait' + suffix + '.jpg',
          candidates: [candidate({ filename: 'portrait.jpg' })],
          options: { stripRecognizedSuffixes: true },
        }),
      ).toMatchObject({ outcome: 'new_version' });
    }
  });

  it('matches only exact workspace, project, and album scope', () => {
    const changedScopes = [
      { ...scope, workspaceId: 'another-workspace' },
      { ...scope, projectId: 'another-project' },
      { ...scope, albumId: 'another-album' },
    ];
    for (const changedScope of changedScopes)
      expect(
        classify({
          candidates: [candidate({ scope: changedScope, sha256: newHash })],
        }),
      ).toMatchObject({ outcome: 'new_photo', reason: 'no_filename_match' });
  });

  it('deduplicates version rows by logical photo and identifies exact hash versions', () => {
    expect(
      classify({
        sha256: oldHash,
        candidates: [
          candidate(),
          candidate({ versionId: 'version-2', sha256: newHash }),
        ],
      }),
    ).toEqual({
      outcome: 'duplicate',
      reason: 'exact_hash_match',
      photoId: 'photo-1',
      versionId: 'version-1',
    });
    expect(
      classify({
        sha256: oldHash,
        candidates: [
          candidate(),
          candidate({ versionId: 'version-2', sha256: oldHash }),
        ],
      }),
    ).toEqual({
      outcome: 'duplicate',
      reason: 'exact_hash_match',
      photoId: 'photo-1',
      versionId: null,
    });
  });

  it('requires review when multiple logical photos share a filename, even with an exact hash', () => {
    expect(
      classify({
        sha256: oldHash,
        candidates: [
          candidate(),
          candidate({ photoId: 'photo-2', versionId: 'version-2' }),
        ],
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'ambiguous_filename_match',
      photoId: null,
    });
  });
  it('uses oriented dimensions and reviews large scale, aspect, or rotation changes', () => {
    expect(
      classify({
        dimensions: { width: 6000, height: 4000 },
      }),
    ).toMatchObject({ outcome: 'new_version' });
    for (const changedDimensions of [
      { width: 9000, height: 6000 },
      { width: 3000, height: 3000 },
      { width: 2000, height: 3000 },
    ])
      expect(
        classify({
          dimensions: changedDimensions,
        }),
      ).toMatchObject({
        outcome: 'requires_review',
        reason: 'dimension_change_requires_review',
      });
  });

  it('requires dimensions for changed content and rejects malformed candidate metadata', () => {
    expect(classify({ dimensions: null })).toMatchObject({
      outcome: 'requires_review',
      reason: 'missing_dimension_evidence',
    });
    expect(
      classify({
        candidates: [candidate({ dimensions: null })],
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'missing_dimension_evidence',
    });
    expect(
      classify({
        candidates: [candidate({ dimensions: { width: 0, height: 200 } })],
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'invalid_candidate_dimensions',
    });
    expect(
      classify({
        candidates: [candidate({ sha256: 'bad-hash' })],
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'invalid_candidate_sha256',
    });
  });

  it('keeps changed assisted matches pending an explicit choice', () => {
    expect(
      classify({
        mode: 'assisted',
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'assisted_choice_required',
      photoId: 'photo-1',
    });
  });

  it('does no implicit matching in off/manual modes', () => {
    for (const mode of ['off', 'manual'] as const)
      expect(
        classify({
          mode,
          sha256: oldHash,
          candidates: [candidate({ filename: '/malformed-candidate.jpg' })],
        }),
      ).toEqual({
        outcome: 'new_photo',
        reason: 'matching_disabled',
        photoId: null,
        versionId: null,
      });
  });

  it('fails closed for truncated or over-limit candidate sets', () => {
    expect(
      classify({
        candidates: [candidate()],
        candidatesTruncated: true,
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'candidate_limit_exceeded',
    });

    const tooManyCandidates = Array.from(
      { length: VERSION_MATCH_LIMITS.maxCandidates + 1 },
      (_, index) =>
        candidate({
          photoId: 'photo-' + index,
          versionId: 'version-' + index,
        }),
    );
    expect(
      classify({
        candidates: tooManyCandidates,
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'candidate_limit_exceeded',
    });

    const exactlyAtLimit = Array.from(
      { length: VERSION_MATCH_LIMITS.maxCandidates },
      (_, index) => candidate({ filename: 'other-' + index + '.jpg' }),
    );
    expect(
      classify({
        candidates: exactlyAtLimit,
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'candidate_limit_exceeded',
    });
    expect(
      classify({
        candidates: exactlyAtLimit,
        candidatesTruncated: false,
      }),
    ).toMatchObject({
      outcome: 'new_photo',
      reason: 'no_filename_match',
    });
  });
});

describe('explicit JPEG extension aliases', () => {
  it('aliases uppercase and mixed extension case without folding the basename', () => {
    const options = { allowJpgJpegEquivalence: true };
    expect(canonicalizePhotoFilename('Portrait.JPG', options)).toEqual(
      canonicalizePhotoFilename('Portrait.JpEg', options),
    );
    expect(canonicalizePhotoFilename('Portrait.JPG', options)).not.toEqual(
      canonicalizePhotoFilename('portrait.jpeg', options),
    );
    expect(canonicalizePhotoFilename('Portrait.JPG')).not.toEqual(
      canonicalizePhotoFilename('Portrait.JPEG'),
    );
  });
});
