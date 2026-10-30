import {
  matchPhotoVersion,
  type VersionMatchDimensions,
  type VersionMatchMode,
  type VersionMatchResult,
  type VersionMatchScope,
} from './version-matching';

export type IndexedVersionMatchSummary = Readonly<{
  /** True only when indexed filename coverage and full immutable history are complete. */
  complete: boolean;
  matchedPhotoCount: number;
  /** Set only when exactly one logical photo matches the canonical filename. */
  photoId: string | null;
  /** Complete immutable version count for the sole matched photo. */
  historyVersionCount: number;
  invalidHashCount: number;
  invalidDimensionsCount: number;
  missingDimensionsCount: number;
  incompatibleDimensionsCount: number;
  exactVersionCount: number;
  pendingMatchCount: number;
  /** Set only when exactly one history version has the incoming SHA-256. */
  exactVersionId: string | null;
}>;

type IndexedVersionMatchInput = Readonly<{
  scope: VersionMatchScope;
  mode: VersionMatchMode;
  filename: string;
  sha256: string;
  dimensions?: VersionMatchDimensions | null;
  summary: IndexedVersionMatchSummary;
}>;

const SUMMARY_FIELDS = new Set([
  'complete',
  'matchedPhotoCount',
  'photoId',
  'historyVersionCount',
  'invalidHashCount',
  'invalidDimensionsCount',
  'missingDimensionsCount',
  'incompatibleDimensionsCount',
  'exactVersionCount',
  'pendingMatchCount',
  'exactVersionId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

function parseSummary(value: unknown): IndexedVersionMatchSummary | null {
  if (!isRecord(value)) return null;

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== SUMMARY_FIELDS.size ||
    ownKeys.some((key) => typeof key !== 'string' || !SUMMARY_FIELDS.has(key))
  )
    return null;

  const complete = value.complete;
  const matchedPhotoCount = value.matchedPhotoCount;
  const photoId = value.photoId;
  const historyVersionCount = value.historyVersionCount;
  const invalidHashCount = value.invalidHashCount;
  const invalidDimensionsCount = value.invalidDimensionsCount;
  const missingDimensionsCount = value.missingDimensionsCount;
  const incompatibleDimensionsCount = value.incompatibleDimensionsCount;
  const exactVersionCount = value.exactVersionCount;
  const pendingMatchCount = value.pendingMatchCount;
  const exactVersionId = value.exactVersionId;

  if (
    typeof complete !== 'boolean' ||
    !isNonnegativeSafeInteger(matchedPhotoCount) ||
    (photoId !== null && !isNonEmptyString(photoId)) ||
    !isNonnegativeSafeInteger(historyVersionCount) ||
    !isNonnegativeSafeInteger(invalidHashCount) ||
    !isNonnegativeSafeInteger(invalidDimensionsCount) ||
    !isNonnegativeSafeInteger(missingDimensionsCount) ||
    !isNonnegativeSafeInteger(incompatibleDimensionsCount) ||
    !isNonnegativeSafeInteger(exactVersionCount) ||
    !isNonnegativeSafeInteger(pendingMatchCount) ||
    (exactVersionId !== null && !isNonEmptyString(exactVersionId))
  )
    return null;

  const summary: IndexedVersionMatchSummary = {
    complete,
    matchedPhotoCount,
    photoId,
    historyVersionCount,
    invalidHashCount,
    invalidDimensionsCount,
    missingDimensionsCount,
    incompatibleDimensionsCount,
    exactVersionCount,
    pendingMatchCount,
    exactVersionId,
  };

  if (summary.matchedPhotoCount === 0) {
    if (
      summary.photoId !== null ||
      summary.historyVersionCount !== 0 ||
      summary.invalidHashCount !== 0 ||
      summary.invalidDimensionsCount !== 0 ||
      summary.missingDimensionsCount !== 0 ||
      summary.incompatibleDimensionsCount !== 0 ||
      summary.exactVersionCount !== 0 ||
      summary.exactVersionId !== null
    )
      return null;
    return summary;
  }

  if (summary.matchedPhotoCount > 1) {
    if (
      summary.photoId !== null ||
      summary.historyVersionCount !== 0 ||
      summary.invalidHashCount !== 0 ||
      summary.invalidDimensionsCount !== 0 ||
      summary.missingDimensionsCount !== 0 ||
      summary.incompatibleDimensionsCount !== 0 ||
      summary.exactVersionCount !== 0 ||
      summary.exactVersionId !== null
    )
      return null;
    return summary;
  }

  if (
    summary.photoId === null ||
    summary.historyVersionCount < 1 ||
    summary.invalidHashCount > summary.historyVersionCount ||
    summary.exactVersionCount >
      summary.historyVersionCount - summary.invalidHashCount
  )
    return null;

  let unclassifiedDimensionCount =
    summary.historyVersionCount - summary.invalidDimensionsCount;
  if (unclassifiedDimensionCount < 0) return null;
  unclassifiedDimensionCount -= summary.missingDimensionsCount;
  if (unclassifiedDimensionCount < 0) return null;
  unclassifiedDimensionCount -= summary.incompatibleDimensionsCount;
  if (unclassifiedDimensionCount < 0) return null;

  if (
    (summary.exactVersionCount === 0 && summary.exactVersionId !== null) ||
    (summary.exactVersionCount === 1 && summary.exactVersionId === null) ||
    (summary.exactVersionCount > 1 && summary.exactVersionId !== null)
  )
    return null;

  return summary;
}

function review(
  reason: Extract<VersionMatchResult, { outcome: 'requires_review' }>['reason'],
  photoId: string | null = null,
): VersionMatchResult {
  return { outcome: 'requires_review', reason, photoId, versionId: null };
}

/**
 * Classifies a canonical filename against a complete indexed history summary.
 * The summary must come from the same authorized snapshot as its caller's
 * reservation checks; this pure function does not read storage or reserve a version.
 */
export function classifyIndexedVersionMatch(
  input: IndexedVersionMatchInput,
): VersionMatchResult {
  const validation = matchPhotoVersion({
    scope: input.scope,
    mode: input.mode,
    filename: input.filename,
    sha256: input.sha256,
    ...(input.dimensions === undefined ? {} : { dimensions: input.dimensions }),
    candidates: [],
    candidatesTruncated: false,
  });
  if (validation.outcome === 'requires_review') return validation;
  if (validation.reason === 'matching_disabled') return validation;

  const summary = parseSummary(input.summary);
  if (summary === null) return review('invalid_candidates');
  if (!summary.complete) return review('filename_index_not_ready');

  if (summary.invalidHashCount > 0)
    return review('invalid_candidate_sha256', summary.photoId);
  if (summary.invalidDimensionsCount > 0)
    return review('invalid_candidate_dimensions', summary.photoId);

  if (summary.matchedPhotoCount > 1) return review('ambiguous_filename_match');

  if (summary.matchedPhotoCount === 0) {
    if (summary.pendingMatchCount > 0)
      return review('pending_upload_requires_review');
    return {
      outcome: 'new_photo',
      reason: 'no_filename_match',
      photoId: null,
      versionId: null,
    };
  }

  if (summary.photoId === null) return review('invalid_candidates');

  if (summary.exactVersionCount > 0)
    return {
      outcome: 'duplicate',
      reason: 'exact_hash_match',
      photoId: summary.photoId,
      versionId:
        summary.exactVersionCount === 1 ? summary.exactVersionId : null,
    };

  if (input.dimensions === undefined || input.dimensions === null)
    return review('missing_dimension_evidence', summary.photoId);
  if (summary.missingDimensionsCount > 0)
    return review('missing_dimension_evidence', summary.photoId);
  if (summary.incompatibleDimensionsCount > 0)
    return review('dimension_change_requires_review', summary.photoId);
  if (summary.pendingMatchCount > 0)
    return review('pending_upload_requires_review', summary.photoId);
  if (input.mode === 'assisted')
    return review('assisted_choice_required', summary.photoId);

  return {
    outcome: 'new_version',
    reason: 'unique_filename_hash_changed',
    photoId: summary.photoId,
    versionId: null,
  };
}
