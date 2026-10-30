export type VersionMatchScope = Readonly<{
  workspaceId: string;
  projectId: string;
  albumId: string;
}>;

export type VersionMatchDimensions = Readonly<{
  width: number;
  height: number;
}>;

export type VersionMatchMode = 'off' | 'manual' | 'auto_filename' | 'assisted';

export type VersionMatchOptions = Readonly<{
  /** Defaults to true. Case-insensitive matching never uses the machine locale. */
  caseSensitive?: boolean;
  /** Used only for explicit case-insensitive matching. */
  locale?: string;
  /** Defaults to false; when enabled, .jpg and .jpeg compare as the same extension. */
  allowJpgJpegEquivalence?: boolean;
  /** Defaults to false; recognizes one terminal _edited, _retouched, _edit, or _vN/-vN suffix. */
  stripRecognizedSuffixes?: boolean;
}>;

export type VersionMatchCandidate = Readonly<{
  scope: VersionMatchScope;
  photoId: string;
  versionId: string;
  filename: string;
  sha256: string;
  /** Null or absent means dimension evidence is unavailable. */
  dimensions?: VersionMatchDimensions | null;
}>;

export type VersionMatchingInput = Readonly<{
  scope: VersionMatchScope;
  mode: VersionMatchMode;
  filename: string;
  sha256: string;
  /** Null or absent means dimension evidence is unavailable. */
  dimensions?: VersionMatchDimensions | null;
  candidates: readonly VersionMatchCandidate[];
  /** Set true when truncated; an exactly full set must set false to prove completeness. */
  candidatesTruncated?: boolean;
  options?: VersionMatchOptions;
}>;

export type CanonicalPhotoFilename = Readonly<{
  basename: string;
  extension: string | null;
}>;

export type VersionMatchResult =
  | Readonly<{
      outcome: 'new_photo';
      reason: 'matching_disabled' | 'no_filename_match';
      photoId: null;
      versionId: null;
    }>
  | Readonly<{
      outcome: 'new_version';
      reason: 'unique_filename_hash_changed';
      photoId: string;
      /** Allocated by the persistence adapter when it creates the version. */
      versionId: null;
    }>
  | Readonly<{
      outcome: 'duplicate';
      reason: 'exact_hash_match';
      photoId: string;
      /** Null when identical content exists in multiple versions of this photo. */
      versionId: string | null;
    }>
  | Readonly<{
      outcome: 'requires_review';
      reason:
        | 'invalid_input'
        | 'invalid_scope'
        | 'invalid_mode'
        | 'invalid_filename'
        | 'invalid_sha256'
        | 'invalid_dimensions'
        | 'invalid_options'
        | 'invalid_candidates'
        | 'invalid_candidate'
        | 'invalid_candidate_scope'
        | 'invalid_candidate_filename'
        | 'invalid_candidate_sha256'
        | 'invalid_candidate_dimensions'
        | 'conflicting_candidate_version'
        | 'filename_index_not_ready'
        | 'candidate_limit_exceeded'
        | 'ambiguous_filename_match'
        | 'missing_dimension_evidence'
        | 'dimension_change_requires_review'
        | 'pending_upload_requires_review'
        | 'assisted_choice_required';
      photoId: string | null;
      versionId: null;
    }>;

export const VERSION_MATCH_LIMITS = Object.freeze({
  maxCandidates: 1000,
  maxRawFilenameUtf16Length: 1024,
  maxTrimmedFilenameUtf16Length: 255,
  maxDimension: 32768,
  maxPixels: 80_000_000,
  maxAspectRatioRelativeDelta: 0.05,
  maxLinearScaleFactor: 2,
} as const);

const KNOWN_IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'tif',
  'tiff',
  'webp',
]);

type ResolvedOptions = Readonly<{
  caseSensitive: boolean;
  locale: string | null;
  allowJpgJpegEquivalence: boolean;
  stripRecognizedSuffixes: boolean;
}>;

type DimensionResult =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'valid'; value: VersionMatchDimensions }>;

type CandidateRecord = Readonly<{
  photoId: string;
  versionId: string;
  sha256: string;
  dimensions: DimensionResult;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isScope(value: unknown): value is VersionMatchScope {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.projectId) &&
    isNonEmptyString(value.albumId)
  );
}

function sameScope(left: VersionMatchScope, right: VersionMatchScope): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.albumId === right.albumId
  );
}

function resolveOptions(value: unknown): ResolvedOptions | null {
  if (!isRecord(value)) return null;

  const caseSensitive = value.caseSensitive ?? true;
  const allowJpgJpegEquivalence = value.allowJpgJpegEquivalence ?? false;
  const stripRecognizedSuffixes = value.stripRecognizedSuffixes ?? false;
  if (
    typeof caseSensitive !== 'boolean' ||
    typeof allowJpgJpegEquivalence !== 'boolean' ||
    typeof stripRecognizedSuffixes !== 'boolean'
  )
    return null;

  let locale: string | null = null;
  if (value.locale !== undefined) {
    if (typeof value.locale !== 'string' || value.locale.trim() === '')
      return null;
    try {
      const locales = Intl.getCanonicalLocales(value.locale);
      if (locales.length !== 1) return null;
      locale = locales[0] ?? null;
    } catch {
      return null;
    }
    if (locale === null) return null;
  }

  return {
    caseSensitive,
    locale,
    allowJpgJpegEquivalence,
    stripRecognizedSuffixes,
  };
}

function foldCase(value: string, options: ResolvedOptions): string {
  if (options.caseSensitive) return value;
  // toLowerCase is locale-independent; locale-specific behavior requires an explicit locale.
  return options.locale === null
    ? value.toLowerCase()
    : value.toLocaleLowerCase(options.locale);
}

function hasUnsafeFilenameCharacters(value: string): boolean {
  return (
    /[\\/:]/u.test(value) ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(
      value,
    )
  );
}

function removeRecognizedSuffix(
  stem: string,
  options: ResolvedOptions,
): string {
  if (!options.stripRecognizedSuffixes) return stem;

  const folded = foldCase(stem, options);
  for (const suffix of [
    '_edited',
    '_retouched',
    '_edit',
    '-edited',
    '-retouched',
    '-edit',
  ]) {
    if (folded.endsWith(suffix))
      return stem.slice(0, stem.length - suffix.length);
  }
  const versionSuffix = /(?:_|-)v[0-9]+$/u.exec(folded)?.[0];
  return versionSuffix === undefined
    ? stem
    : stem.slice(0, stem.length - versionSuffix.length);
}

function canonicalizeWithOptions(
  filename: unknown,
  options: ResolvedOptions,
): CanonicalPhotoFilename | null {
  if (typeof filename !== 'string') return null;
  if (filename.length > VERSION_MATCH_LIMITS.maxRawFilenameUtf16Length)
    return null;

  const normalized = filename.normalize('NFC');
  if (hasUnsafeFilenameCharacters(normalized)) return null;
  const trimmed = normalized.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > VERSION_MATCH_LIMITS.maxTrimmedFilenameUtf16Length ||
    trimmed === '.' ||
    trimmed === '..'
  )
    return null;

  const lastDot = trimmed.lastIndexOf('.');
  const possibleExtension = lastDot > 0 ? trimmed.slice(lastDot + 1) : '';
  const hasKnownExtension = KNOWN_IMAGE_EXTENSIONS.has(
    possibleExtension.toLowerCase(),
  );
  const extension = hasKnownExtension ? possibleExtension : null;
  let stem = hasKnownExtension ? trimmed.slice(0, lastDot) : trimmed;
  stem = removeRecognizedSuffix(stem, options);
  if (stem.length === 0) return null;

  let canonicalExtension =
    extension === null ? null : foldCase(extension, options);
  if (
    options.allowJpgJpegEquivalence &&
    (canonicalExtension?.toLowerCase() === 'jpg' ||
      canonicalExtension?.toLowerCase() === 'jpeg')
  )
    canonicalExtension = 'jpeg';

  return {
    basename: foldCase(stem, options),
    extension: canonicalExtension,
  };
}

/** NFC/trim canonicalization that never mutates the filename supplied by a caller. */
export function canonicalizePhotoFilename(
  filename: string,
  options: VersionMatchOptions = {},
): CanonicalPhotoFilename | null {
  const resolved = resolveOptions(options);
  return resolved === null ? null : canonicalizeWithOptions(filename, resolved);
}

function sameFilename(
  left: CanonicalPhotoFilename,
  right: CanonicalPhotoFilename,
): boolean {
  return left.basename === right.basename && left.extension === right.extension;
}

function parseDimensions(value: unknown): DimensionResult {
  if (value === undefined || value === null) return { kind: 'missing' };
  if (!isRecord(value)) return { kind: 'invalid' };

  const width = value.width;
  const height = value.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > VERSION_MATCH_LIMITS.maxDimension ||
    height > VERSION_MATCH_LIMITS.maxDimension ||
    width * height > VERSION_MATCH_LIMITS.maxPixels
  )
    return { kind: 'invalid' };

  return { kind: 'valid', value: { width, height } };
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/iu.test(value);
}

function normalizedSha256(value: string): string {
  return value.toLowerCase();
}

function dimensionsCompatible(
  left: VersionMatchDimensions,
  right: VersionMatchDimensions,
): boolean {
  // Compare encoded width/height as stored. No EXIF orientation parsing or
  // normalization is performed, so a width/height swap requires review.
  const leftAspect = left.width / left.height;
  const rightAspect = right.width / right.height;
  const relativeAspectDelta = Math.abs(leftAspect / rightAspect - 1);
  const widthScale = left.width / right.width;
  const heightScale = left.height / right.height;
  const withinScale = (scale: number): boolean =>
    scale >= 1 / VERSION_MATCH_LIMITS.maxLinearScaleFactor &&
    scale <= VERSION_MATCH_LIMITS.maxLinearScaleFactor;

  return (
    relativeAspectDelta <= VERSION_MATCH_LIMITS.maxAspectRatioRelativeDelta &&
    withinScale(widthScale) &&
    withinScale(heightScale)
  );
}

function review(
  reason: Extract<VersionMatchResult, { outcome: 'requires_review' }>['reason'],
  photoId: string | null = null,
): VersionMatchResult {
  return { outcome: 'requires_review', reason, photoId, versionId: null };
}

function sameDimensions(
  left: DimensionResult,
  right: DimensionResult,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== 'valid' || right.kind !== 'valid') return true;
  return (
    left.value.width === right.value.width &&
    left.value.height === right.value.height
  );
}

/**
 * Pure filename/hash/dimension classifier. It does not read or write storage,
 * allocate version numbers, switch the current head, or compare EXIF metadata.
 * The caller persists a decision only after its own transaction and auth checks.
 */
export function matchPhotoVersion(
  input: VersionMatchingInput,
): VersionMatchResult {
  const rawInput: unknown = input;
  if (!isRecord(rawInput)) return review('invalid_input');
  if (!isScope(rawInput.scope)) return review('invalid_scope');
  const scope = rawInput.scope;

  const mode = rawInput.mode;
  if (
    mode !== 'off' &&
    mode !== 'manual' &&
    mode !== 'auto_filename' &&
    mode !== 'assisted'
  )
    return review('invalid_mode');

  const options = resolveOptions(
    rawInput.options === undefined ? {} : rawInput.options,
  );
  if (options === null) return review('invalid_options');

  const filename = canonicalizeWithOptions(rawInput.filename, options);
  if (filename === null) return review('invalid_filename');
  if (!isSha256(rawInput.sha256)) return review('invalid_sha256');
  const sha256 = normalizedSha256(rawInput.sha256);
  const inputDimensions = parseDimensions(rawInput.dimensions);
  if (inputDimensions.kind === 'invalid') return review('invalid_dimensions');

  if (mode === 'off' || mode === 'manual')
    return {
      outcome: 'new_photo',
      reason: 'matching_disabled',
      photoId: null,
      versionId: null,
    };

  if (!Array.isArray(rawInput.candidates)) return review('invalid_candidates');
  if (
    rawInput.candidatesTruncated !== undefined &&
    typeof rawInput.candidatesTruncated !== 'boolean'
  )
    return review('invalid_candidates');
  if (rawInput.candidatesTruncated === true)
    return review('candidate_limit_exceeded');
  if (
    rawInput.candidates.length > VERSION_MATCH_LIMITS.maxCandidates ||
    (rawInput.candidates.length === VERSION_MATCH_LIMITS.maxCandidates &&
      rawInput.candidatesTruncated !== false)
  )
    return review('candidate_limit_exceeded');

  const matchingRows: CandidateRecord[] = [];
  for (const rawCandidate of rawInput.candidates as readonly unknown[]) {
    if (!isRecord(rawCandidate)) return review('invalid_candidate');
    if (!isScope(rawCandidate.scope)) return review('invalid_candidate_scope');
    if (!sameScope(rawCandidate.scope, scope)) continue;

    if (
      !isNonEmptyString(rawCandidate.photoId) ||
      !isNonEmptyString(rawCandidate.versionId)
    )
      return review('invalid_candidate');

    const candidateFilename = canonicalizeWithOptions(
      rawCandidate.filename,
      options,
    );
    if (candidateFilename === null) return review('invalid_candidate_filename');
    if (!sameFilename(candidateFilename, filename)) continue;

    if (!isSha256(rawCandidate.sha256))
      return review('invalid_candidate_sha256', rawCandidate.photoId);
    const candidateDimensions = parseDimensions(rawCandidate.dimensions);
    if (candidateDimensions.kind === 'invalid')
      return review('invalid_candidate_dimensions', rawCandidate.photoId);

    matchingRows.push({
      photoId: rawCandidate.photoId,
      versionId: rawCandidate.versionId,
      sha256: normalizedSha256(rawCandidate.sha256),
      dimensions: candidateDimensions,
    });
  }

  if (matchingRows.length === 0)
    return {
      outcome: 'new_photo',
      reason: 'no_filename_match',
      photoId: null,
      versionId: null,
    };

  const photos = new Map<string, CandidateRecord[]>();
  for (const row of matchingRows) {
    const rows = photos.get(row.photoId) ?? [];
    rows.push(row);
    photos.set(row.photoId, rows);
  }
  if (photos.size > 1) return review('ambiguous_filename_match');

  const entry = photos.entries().next().value as
    [string, CandidateRecord[]] | undefined;
  if (entry === undefined) return review('invalid_candidates');
  const [photoId, rows] = entry;

  const versions = new Map<string, CandidateRecord>();
  for (const row of rows) {
    const existing = versions.get(row.versionId);
    if (existing !== undefined) {
      if (
        existing.sha256 !== row.sha256 ||
        !sameDimensions(existing.dimensions, row.dimensions)
      )
        return review('conflicting_candidate_version', photoId);
      continue;
    }
    versions.set(row.versionId, row);
  }

  const exactVersions = [...versions.values()].filter(
    (version) => version.sha256 === sha256,
  );
  if (exactVersions.length > 0)
    return {
      outcome: 'duplicate',
      reason: 'exact_hash_match',
      photoId,
      versionId:
        exactVersions.length === 1
          ? (exactVersions[0]?.versionId ?? null)
          : null,
    };

  if (inputDimensions.kind !== 'valid')
    return review('missing_dimension_evidence', photoId);
  const knownDimensions = [...versions.values()].map(
    (version) => version.dimensions,
  );
  if (knownDimensions.some((value) => value.kind !== 'valid'))
    return review('missing_dimension_evidence', photoId);
  if (
    knownDimensions.some(
      (value) =>
        value.kind !== 'valid' ||
        !dimensionsCompatible(inputDimensions.value, value.value),
    )
  )
    return review('dimension_change_requires_review', photoId);

  if (mode === 'assisted') return review('assisted_choice_required', photoId);

  return {
    outcome: 'new_version',
    reason: 'unique_filename_hash_changed',
    photoId,
    versionId: null,
  };
}
