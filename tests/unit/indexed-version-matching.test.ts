import { describe, expect, it } from 'vitest';
import {
  canonicalizePhotoFilename,
  matchPhotoVersion,
  type VersionMatchCandidate,
  type VersionMatchDimensions,
  type VersionMatchMode,
  type VersionMatchResult,
  type VersionMatchScope,
  type VersionMatchingInput,
} from '../../packages/domain/src/version-matching';
import {
  classifyIndexedVersionMatch,
  type IndexedVersionMatchSummary,
} from '../../packages/domain/src/indexed-version-matching';

const scope: VersionMatchScope = {
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  albumId: 'album-1',
};
const dimensions: VersionMatchDimensions = { width: 3000, height: 2000 };
const oldHash = 'a'.repeat(64);
const newHash = 'b'.repeat(64);

type IndexedInput = Readonly<{
  scope: VersionMatchScope;
  mode: VersionMatchMode;
  filename: string;
  sha256: string;
  dimensions?: VersionMatchDimensions | null;
}>;

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

function sameCanonicalFilename(left: string, right: string): boolean {
  const canonicalLeft = canonicalizePhotoFilename(left);
  const canonicalRight = canonicalizePhotoFilename(right);
  return (
    canonicalLeft !== null &&
    canonicalRight !== null &&
    canonicalLeft.basename === canonicalRight.basename &&
    canonicalLeft.extension === canonicalRight.extension
  );
}

function sameScope(left: VersionMatchScope, right: VersionMatchScope): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.albumId === right.albumId
  );
}

function dimensionsCompatible(
  left: VersionMatchDimensions,
  right: VersionMatchDimensions,
): boolean {
  const leftAspect = left.width / left.height;
  const rightAspect = right.width / right.height;
  const relativeAspectDelta = Math.abs(leftAspect / rightAspect - 1);
  const widthScale = left.width / right.width;
  const heightScale = left.height / right.height;
  const withinScale = (scale: number): boolean => scale >= 0.5 && scale <= 2;
  return (
    relativeAspectDelta <= 0.05 &&
    withinScale(widthScale) &&
    withinScale(heightScale)
  );
}

function summaryFromValidHistory(
  input: IndexedInput,
  candidates: readonly VersionMatchCandidate[],
): IndexedVersionMatchSummary {
  const matchedRows = candidates.filter(
    (row) =>
      sameScope(row.scope, input.scope) &&
      sameCanonicalFilename(row.filename, input.filename),
  );
  const photoIds = new Set(matchedRows.map((row) => row.photoId));
  if (photoIds.size === 0)
    return {
      complete: true,
      matchedPhotoCount: 0,
      photoId: null,
      historyVersionCount: 0,
      invalidHashCount: 0,
      invalidDimensionsCount: 0,
      missingDimensionsCount: 0,
      incompatibleDimensionsCount: 0,
      exactVersionCount: 0,
      pendingMatchCount: 0,
      exactVersionId: null,
    };
  if (photoIds.size > 1)
    return {
      complete: true,
      matchedPhotoCount: photoIds.size,
      photoId: null,
      historyVersionCount: 0,
      invalidHashCount: 0,
      invalidDimensionsCount: 0,
      missingDimensionsCount: 0,
      incompatibleDimensionsCount: 0,
      exactVersionCount: 0,
      pendingMatchCount: 0,
      exactVersionId: null,
    };

  const photoId = photoIds.values().next().value;
  if (photoId === undefined) throw new Error('Expected a matched photo');
  const rows = matchedRows.filter((row) => row.photoId === photoId);
  const exactRows = rows.filter(
    (row) => row.sha256.toLowerCase() === input.sha256.toLowerCase(),
  );
  const validInputDimensions =
    input.dimensions === undefined || input.dimensions === null
      ? null
      : input.dimensions;
  return {
    complete: true,
    matchedPhotoCount: 1,
    photoId,
    historyVersionCount: rows.length,
    invalidHashCount: 0,
    invalidDimensionsCount: 0,
    missingDimensionsCount: rows.filter(
      (row) => row.dimensions === undefined || row.dimensions === null,
    ).length,
    incompatibleDimensionsCount:
      validInputDimensions === null
        ? 0
        : rows.filter((row) => {
            if (row.dimensions === undefined || row.dimensions === null)
              return false;
            return !dimensionsCompatible(validInputDimensions, row.dimensions);
          }).length,
    exactVersionCount: exactRows.length,
    pendingMatchCount: 0,
    exactVersionId:
      exactRows.length === 1 ? (exactRows[0]?.versionId ?? null) : null,
  };
}

function indexedResult(
  input: IndexedInput,
  summary: IndexedVersionMatchSummary,
): VersionMatchResult {
  return classifyIndexedVersionMatch({ ...input, summary });
}

function assertEquivalentToMaterializedMatcher(
  input: IndexedInput,
  candidates: readonly VersionMatchCandidate[],
): VersionMatchResult {
  const materializedInput: VersionMatchingInput = {
    ...input,
    candidates,
    candidatesTruncated: false,
  };
  const expected = matchPhotoVersion(materializedInput);
  const actual = indexedResult(
    input,
    summaryFromValidHistory(input, candidates),
  );
  expect(actual).toEqual(expected);
  return actual;
}

function emptySummary(
  overrides: Partial<IndexedVersionMatchSummary> = {},
): IndexedVersionMatchSummary {
  return {
    complete: true,
    matchedPhotoCount: 0,
    photoId: null,
    historyVersionCount: 0,
    invalidHashCount: 0,
    invalidDimensionsCount: 0,
    missingDimensionsCount: 0,
    incompatibleDimensionsCount: 0,
    exactVersionCount: 0,
    pendingMatchCount: 0,
    exactVersionId: null,
    ...overrides,
  };
}

describe('indexed photo version classification', () => {
  it('matches the materialized matcher for small complete valid histories', () => {
    const baseInput: IndexedInput = {
      scope,
      mode: 'auto_filename',
      filename: 'portrait.jpg',
      sha256: newHash,
      dimensions,
    };
    const cases: ReadonlyArray<
      Readonly<{
        name: string;
        input?: Partial<IndexedInput>;
        candidates: readonly VersionMatchCandidate[];
        expected: Pick<VersionMatchResult, 'outcome'>;
      }>
    > = [
      {
        name: 'no matching history',
        candidates: [candidate({ filename: 'another.jpg' })],
        expected: { outcome: 'new_photo' },
      },
      {
        name: 'one changed version',
        candidates: [candidate()],
        expected: { outcome: 'new_version' },
      },
      {
        name: 'several compatible versions',
        candidates: [
          candidate(),
          candidate({ versionId: 'version-2', sha256: 'c'.repeat(64) }),
          candidate({ versionId: 'version-3', sha256: oldHash.toUpperCase() }),
        ],
        input: { sha256: oldHash },
        expected: { outcome: 'duplicate' },
      },
      {
        name: 'duplicate hash across two versions of one photo',
        candidates: [
          candidate({ versionId: 'version-1', sha256: oldHash }),
          candidate({ versionId: 'version-2', sha256: oldHash }),
        ],
        input: { sha256: oldHash },
        expected: { outcome: 'duplicate' },
      },
      {
        name: 'compatible dimensions in assisted mode',
        candidates: [candidate()],
        input: { mode: 'assisted' },
        expected: { outcome: 'requires_review' },
      },
      {
        name: 'changed aspect ratio',
        candidates: [candidate()],
        input: { dimensions: { width: 3000, height: 3000 } },
        expected: { outcome: 'requires_review' },
      },
      {
        name: 'missing dimensions in an old version',
        candidates: [candidate({ dimensions: null })],
        expected: { outcome: 'requires_review' },
      },
      {
        name: 'exact duplicate with missing dimensions',
        candidates: [candidate({ dimensions: null, sha256: oldHash })],
        input: { sha256: oldHash },
        expected: { outcome: 'duplicate' },
      },
      {
        name: 'same immutable filename across a renamed photo history',
        candidates: [
          candidate({
            filename: 'portrait.jpg',
            versionId: 'original-version',
          }),
          candidate({
            filename: 'portrait.jpg',
            versionId: 'second-version',
            sha256: 'c'.repeat(64),
          }),
        ],
        input: { sha256: newHash },
        expected: { outcome: 'new_version' },
      },
      {
        name: 'ambiguous photos take priority over an exact hash',
        candidates: [
          candidate({ photoId: 'photo-1', sha256: oldHash }),
          candidate({
            photoId: 'photo-2',
            versionId: 'version-other-photo',
            sha256: oldHash,
          }),
        ],
        input: { sha256: oldHash },
        expected: { outcome: 'requires_review' },
      },
    ];

    for (const testCase of cases) {
      const result = assertEquivalentToMaterializedMatcher(
        { ...baseInput, ...testCase.input },
        testCase.candidates,
      );
      expect(result.outcome, testCase.name).toBe(testCase.expected.outcome);
    }
  });

  it('uses immutable version filenames when the mutable photo head was renamed', () => {
    const input: IndexedInput = {
      scope,
      mode: 'auto_filename',
      filename: 'portrait.jpg',
      sha256: newHash,
      dimensions,
    };
    const history = [
      candidate({ versionId: 'version-1', filename: 'portrait.jpg' }),
      candidate({
        versionId: 'version-2',
        filename: 'portrait.jpg',
        sha256: 'c'.repeat(64),
      }),
    ];
    // The current photo row may say retitled.jpg. The indexed history remains
    // anchored to each immutable version's original filename.
    expect(
      indexedResult(input, summaryFromValidHistory(input, history)),
    ).toMatchObject({ outcome: 'new_version', photoId: 'photo-1' });
  });

  it('classifies full histories above the old materialization limit', () => {
    const input: IndexedInput = {
      scope,
      mode: 'auto_filename',
      filename: 'portrait.jpg',
      sha256: newHash,
      dimensions,
    };
    const largeHistory = emptySummary({
      matchedPhotoCount: 1,
      photoId: 'photo-1',
      historyVersionCount: 1205,
    });
    expect(indexedResult(input, largeHistory)).toEqual({
      outcome: 'new_version',
      reason: 'unique_filename_hash_changed',
      photoId: 'photo-1',
      versionId: null,
    });

    const largeHistoryDuplicate = emptySummary({
      matchedPhotoCount: 1,
      photoId: 'photo-1',
      historyVersionCount: 1205,
      exactVersionCount: 1,
      exactVersionId: 'version-1205',
    });
    expect(
      indexedResult({ ...input, sha256: oldHash }, largeHistoryDuplicate),
    ).toEqual({
      outcome: 'duplicate',
      reason: 'exact_hash_match',
      photoId: 'photo-1',
      versionId: 'version-1205',
    });
  });

  it('keeps pending uploads scoped to outcomes they can block', () => {
    const noMatchInput: IndexedInput = {
      scope,
      mode: 'auto_filename',
      filename: 'portrait.jpg',
      sha256: newHash,
      dimensions,
    };
    expect(
      indexedResult(noMatchInput, emptySummary({ pendingMatchCount: 1 })),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'pending_upload_requires_review',
      photoId: null,
    });

    const matched = emptySummary({
      matchedPhotoCount: 1,
      photoId: 'photo-1',
      historyVersionCount: 1,
      pendingMatchCount: 1,
    });
    expect(indexedResult(noMatchInput, matched)).toMatchObject({
      outcome: 'requires_review',
      reason: 'pending_upload_requires_review',
      photoId: 'photo-1',
    });

    expect(
      indexedResult(
        { ...noMatchInput, sha256: oldHash },
        { ...matched, exactVersionCount: 1, exactVersionId: 'version-1' },
      ),
    ).toMatchObject({ outcome: 'duplicate', reason: 'exact_hash_match' });

    const ambiguousWithPending = emptySummary({
      matchedPhotoCount: 2,
      pendingMatchCount: 1,
    });
    expect(indexedResult(noMatchInput, ambiguousWithPending)).toMatchObject({
      outcome: 'requires_review',
      reason: 'ambiguous_filename_match',
    });

    expect(
      indexedResult(noMatchInput, {
        ...matched,
        missingDimensionsCount: 1,
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'missing_dimension_evidence',
    });
  });

  it('rejects invalid history evidence before duplicate resolution', () => {
    const input: IndexedInput = {
      scope,
      mode: 'auto_filename',
      filename: 'portrait.jpg',
      sha256: oldHash,
      dimensions,
    };
    const matched = emptySummary({
      matchedPhotoCount: 1,
      photoId: 'photo-1',
      historyVersionCount: 2,
      exactVersionCount: 1,
      exactVersionId: 'version-exact',
    });

    expect(
      indexedResult(input, {
        ...matched,
        invalidHashCount: 1,
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'invalid_candidate_sha256',
      photoId: 'photo-1',
    });

    expect(
      indexedResult(input, {
        ...matched,
        invalidDimensionsCount: 1,
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'invalid_candidate_dimensions',
      photoId: 'photo-1',
    });
  });

  it('requires complete index coverage before acting on aggregate matches', () => {
    const result = indexedResult(
      {
        scope,
        mode: 'auto_filename',
        filename: 'portrait.jpg',
        sha256: newHash,
        dimensions,
      },
      emptySummary({ complete: false }),
    );
    expect(result).toEqual({
      outcome: 'requires_review',
      reason: 'filename_index_not_ready',
      photoId: null,
      versionId: null,
    });
  });

  it('rejects untrusted, missing, unsafe, or incoherent summaries', () => {
    const input: IndexedInput = {
      scope,
      mode: 'auto_filename',
      filename: 'portrait.jpg',
      sha256: newHash,
      dimensions,
    };
    const validEmpty = emptySummary();
    const invalidSummaries: readonly unknown[] = [
      null,
      [],
      { ...validEmpty, extra: true },
      { ...validEmpty, complete: 'true' },
      { ...validEmpty, historyVersionCount: Number.MAX_SAFE_INTEGER + 1 },
      { ...validEmpty, pendingMatchCount: -1 },
      { ...validEmpty, matchedPhotoCount: 0, photoId: 'photo-1' },
      { ...validEmpty, matchedPhotoCount: 0, invalidHashCount: 1 },
      {
        ...validEmpty,
        matchedPhotoCount: 1,
        photoId: null,
        historyVersionCount: 1,
      },
      {
        ...validEmpty,
        matchedPhotoCount: 1,
        photoId: 'photo-1',
        historyVersionCount: 1,
        exactVersionCount: 1,
      },
      {
        ...validEmpty,
        matchedPhotoCount: 1,
        photoId: 'photo-1',
        historyVersionCount: 1,
        exactVersionCount: 2,
      },
      {
        ...validEmpty,
        matchedPhotoCount: 1,
        photoId: 'photo-1',
        historyVersionCount: 1,
        missingDimensionsCount: 1,
        incompatibleDimensionsCount: 1,
      },
      {
        ...validEmpty,
        matchedPhotoCount: 2,
        photoId: null,
        exactVersionCount: 1,
      },
    ];

    for (const summary of invalidSummaries)
      expect(
        classifyIndexedVersionMatch({
          ...input,
          summary: summary as IndexedVersionMatchSummary,
        }),
      ).toMatchObject({
        outcome: 'requires_review',
        reason: 'invalid_candidates',
      });
  });

  it('validates upload evidence before an incomplete-index reason', () => {
    expect(
      classifyIndexedVersionMatch({
        scope,
        mode: 'auto_filename',
        filename: '../portrait.jpg',
        sha256: newHash,
        dimensions,
        summary: emptySummary({ complete: false }),
      }),
    ).toMatchObject({
      outcome: 'requires_review',
      reason: 'invalid_filename',
    });
  });
});
