import { z } from 'zod';
import {
  canonicalizePhotoFilename,
  VERSION_MATCH_LIMITS,
  type VersionMatchCandidate,
  type VersionMatchMode,
  type VersionMatchResult,
  type VersionMatchScope,
} from '../../../packages/domain/src/version-matching';
import {
  classifyIndexedVersionMatch,
  type IndexedVersionMatchSummary,
} from '../../../packages/domain/src/indexed-version-matching';
import { canonicalizeMatchingProfileFilename } from '../../../packages/domain/src/matching-profiles';
import {
  matchingProfileIdSchema,
  type MatchingProfileContext,
} from '../../../packages/contracts/src/matching-rules';
import type { AlbumMatchingProfile } from './matching-rule-filename-index';
import type { VersionCandidateSnapshot } from './version-match-candidates';
import { WorkspaceFailure } from './workspaces';

const PROFILE = 'default-v1' as const;
const modeSchema = z.enum(['off', 'manual', 'auto_filename', 'assisted']);
const evidenceSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(VERSION_MATCH_LIMITS.maxRawFilenameUtf16Length),
    sha256: z.string().regex(/^[a-f0-9]{64}$/iu),
    dimensions: z
      .object({
        width: z.number().int().positive().safe(),
        height: z.number().int().positive().safe(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const counterSchema = z.number().int().nonnegative().safe();
const albumMatchingProfileSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    projectRevision: z.number().int().min(1).max(2147483647),
    profile: matchingProfileIdSchema,
    ruleRevision: z.number().int().min(0).max(2147483647),
  })
  .strict();
const indexedSnapshotRowSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    mode: modeSchema,
    projectRevision: z.number().int().positive().safe(),
    albumRevision: z.number().int().positive().safe(),
    changeSequence: counterSchema,
    indexComplete: z.union([z.literal(0), z.literal(1)]),
    matchedPhotoCount: counterSchema,
    photoId: z.uuid().nullable(),
    historyVersionCount: counterSchema,
    invalidHashCount: counterSchema,
    invalidDimensionsCount: counterSchema,
    missingDimensionsCount: counterSchema,
    incompatibleDimensionsCount: counterSchema,
    exactVersionCount: counterSchema,
    exactVersionId: z.uuid().nullable(),
    pendingMatchCount: counterSchema,
    candidatePhotoId: z.uuid().nullable(),
    candidateHeadVersionId: z.uuid().nullable(),
    candidateHeadRevision: counterSchema.nullable(),
    candidateVersionId: z.uuid().nullable(),
    candidateFilename: z.string().nullable(),
    candidateSha256: z.string().nullable(),
    candidateWidth: z.number().nullable(),
    candidateHeight: z.number().nullable(),
  })
  .strict();

const profileAwareIndexedSnapshotRowSchema = indexedSnapshotRowSchema
  .extend({
    matchingProfile: matchingProfileIdSchema,
    ruleRevision: z.number().int().min(0).max(2147483647),
  })
  .strict();

const indexedSnapshotSql = `WITH scope AS (
  SELECT a.workspace_id AS workspaceId,a.project_id AS projectId,a.id AS albumId,
    p.versioning_mode AS mode,p.revision AS projectRevision,a.revision AS albumRevision,
    COALESCE((SELECT MAX(m.sequence) FROM album_matching_changes m
      WHERE m.album_id=a.id AND m.project_id=a.project_id
        AND m.workspace_id=a.workspace_id),0) AS changeSequence
  FROM albums a
  JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
  JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?1
  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2
    AND s.expiresAt>unixepoch('subsec')*1000
  WHERE a.id=?3 AND a.state NOT IN('archived','deleting','deleted')
    AND p.status NOT IN('archived','deleting','deleted')
), matching_sessions AS (
  SELECT u.id AS uploadSessionId,u.status AS status
  FROM scope
  JOIN matching_filename_index i
    ON i.workspace_id=scope.workspaceId AND i.project_id=scope.projectId
      AND i.album_id=scope.albumId AND i.profile=?4 AND i.is_invalid=0
  JOIN upload_sessions u ON u.id=i.upload_session_id
    AND u.workspace_id=scope.workspaceId AND u.project_id=scope.projectId
    AND u.album_id=scope.albumId
  WHERE i.canonical_basename COLLATE BINARY=?5 COLLATE BINARY
    AND i.canonical_extension COLLATE BINARY IS ?6 COLLATE BINARY
), matched_photos AS (
  SELECT p.id AS photoId
  FROM scope
  JOIN matching_sessions ms
  JOIN upload_completions c ON c.upload_session_id=ms.uploadSessionId
    AND c.workspace_id=scope.workspaceId AND c.project_id=scope.projectId
      AND c.album_id=scope.albumId
  JOIN photos p ON p.id=c.photo_id AND p.workspace_id=scope.workspaceId
    AND p.project_id=scope.projectId AND p.album_id=scope.albumId
  JOIN photo_versions v ON v.id=c.version_id AND v.photo_id=p.id
    AND v.workspace_id=p.workspace_id
  UNION
  SELECT p.id AS photoId
  FROM scope
  JOIN matching_sessions ms
  JOIN upload_version_completions c ON c.upload_session_id=ms.uploadSessionId
    AND c.workspace_id=scope.workspaceId AND c.project_id=scope.projectId
      AND c.album_id=scope.albumId
  JOIN photos p ON p.id=c.photo_id AND p.workspace_id=scope.workspaceId
    AND p.project_id=scope.projectId AND p.album_id=scope.albumId
  JOIN photo_versions v ON v.id=c.version_id AND v.photo_id=p.id
    AND v.workspace_id=p.workspace_id
), match_metrics AS (
  SELECT COUNT(*) AS matchedPhotoCount,
    CASE WHEN COUNT(*)=1 THEN MAX(photoId) ELSE NULL END AS photoId
  FROM matched_photos
), version_witnesses AS (
  SELECT c.version_id AS versionId,c.photo_id AS photoId,
    c.workspace_id AS workspaceId,c.project_id AS projectId,
    c.album_id AS albumId,u.id AS uploadSessionId,
    u.original_filename AS originalFilename
  FROM scope
  JOIN upload_completions c ON c.workspace_id=scope.workspaceId
    AND c.project_id=scope.projectId AND c.album_id=scope.albumId
  JOIN upload_sessions u ON u.id=c.upload_session_id
    AND u.workspace_id=scope.workspaceId
    AND u.project_id=scope.projectId AND u.album_id=scope.albumId
    AND u.original_filename IS NOT NULL
  UNION ALL
  SELECT c.version_id AS versionId,c.photo_id AS photoId,
    c.workspace_id AS workspaceId,c.project_id AS projectId,
    c.album_id AS albumId,u.id AS uploadSessionId,
    u.original_filename AS originalFilename
  FROM scope
  JOIN upload_version_completions c ON c.workspace_id=scope.workspaceId
    AND c.project_id=scope.projectId AND c.album_id=scope.albumId
  JOIN upload_sessions u ON u.id=c.upload_session_id
    AND u.workspace_id=scope.workspaceId
    AND u.project_id=scope.projectId AND u.album_id=scope.albumId
    AND u.original_filename IS NOT NULL
), coverage_counts AS (
  SELECT
    (SELECT COUNT(*) FROM scope x
      JOIN upload_sessions u ON u.workspace_id=x.workspaceId
        AND u.project_id=x.projectId AND u.album_id=x.albumId
      WHERE NOT EXISTS(SELECT 1 FROM matching_filename_index i
        WHERE i.upload_session_id=u.id AND i.profile=?4
          AND i.workspace_id=x.workspaceId AND i.project_id=x.projectId
          AND i.album_id=x.albumId)) AS missingSessions,
    (SELECT COUNT(*) FROM scope x
      JOIN matching_filename_index i ON i.workspace_id=x.workspaceId
        AND i.project_id=x.projectId AND i.album_id=x.albumId
        AND i.profile=?4 AND i.is_invalid=1
      JOIN upload_sessions u ON u.id=i.upload_session_id
        AND u.workspace_id=x.workspaceId AND u.project_id=x.projectId
        AND u.album_id=x.albumId
      WHERE u.status='reserved'
        OR EXISTS(SELECT 1 FROM upload_completions c
          WHERE c.upload_session_id=u.id)
        OR EXISTS(SELECT 1 FROM upload_version_completions c
          WHERE c.upload_session_id=u.id)) AS invalidSessions,
    (SELECT COUNT(*) FROM scope x
      JOIN photos p ON p.workspace_id=x.workspaceId
        AND p.project_id=x.projectId AND p.album_id=x.albumId
      JOIN photo_versions v ON v.photo_id=p.id
        AND v.workspace_id=p.workspace_id
      WHERE NOT EXISTS(SELECT 1 FROM version_witnesses vw
        WHERE vw.versionId=v.id AND vw.photoId=p.id
          AND vw.workspaceId=x.workspaceId AND vw.projectId=x.projectId
          AND vw.albumId=x.albumId)) AS unlinkedVersions,
    (SELECT COUNT(*) FROM scope x
      JOIN photos p ON p.workspace_id=x.workspaceId
        AND p.project_id=x.projectId AND p.album_id=x.albumId
      WHERE NOT EXISTS(SELECT 1 FROM photo_versions v
          WHERE v.photo_id=p.id AND v.workspace_id=p.workspace_id)
        OR NOT EXISTS(SELECT 1 FROM photo_version_heads h
          JOIN photo_versions hv ON hv.id=h.version_id
            AND hv.photo_id=p.id AND hv.workspace_id=p.workspace_id
          WHERE h.photo_id=p.id AND h.workspace_id=p.workspace_id
            AND h.project_id=p.project_id AND h.album_id=p.album_id
            AND h.revision>=0)) AS unreadyPhotos
  FROM scope
), coverage AS (
  SELECT missingSessions,invalidSessions,unlinkedVersions,unreadyPhotos,
    CASE WHEN missingSessions=0 AND invalidSessions=0
      AND unlinkedVersions=0 AND unreadyPhotos=0 THEN 1 ELSE 0 END
      AS indexComplete
  FROM coverage_counts
), history_metrics AS (
  SELECT COUNT(v.id) AS historyVersionCount,
    SUM(CASE WHEN v.id IS NOT NULL AND
      (typeof(v.source_hash_sha256)<>'text' OR length(v.source_hash_sha256)<>64
        OR v.source_hash_sha256 GLOB '*[^0-9a-fA-F]*')
      THEN 1 ELSE 0 END) AS invalidHashCount,
    SUM(CASE WHEN v.id IS NOT NULL AND v.width IS NOT NULL
      AND v.height IS NOT NULL AND
      (typeof(v.width)<>'integer' OR typeof(v.height)<>'integer'
        OR v.width<1 OR v.width>32768 OR v.height<1 OR v.height>32768
        OR v.width*v.height>80000000)
      THEN 1 ELSE 0 END) AS invalidDimensionsCount,
    SUM(CASE WHEN v.id IS NOT NULL AND
      (v.width IS NULL OR v.height IS NULL) THEN 1 ELSE 0 END)
      AS missingDimensionsCount,
    SUM(CASE WHEN v.id IS NOT NULL AND ?8 IS NOT NULL AND ?9 IS NOT NULL
      AND typeof(v.width)='integer' AND typeof(v.height)='integer'
      AND v.width BETWEEN 1 AND 32768 AND v.height BETWEEN 1 AND 32768
      AND v.width*v.height<=80000000
      AND (ABS((?8*1.0/?9)/(v.width*1.0/v.height)-1)>0.05
        OR ?8*1.0/v.width<0.5 OR ?8*1.0/v.width>2
        OR ?9*1.0/v.height<0.5 OR ?9*1.0/v.height>2)
      THEN 1 ELSE 0 END) AS incompatibleDimensionsCount,
    SUM(CASE WHEN v.id IS NOT NULL
      AND lower(v.source_hash_sha256)=?7 THEN 1 ELSE 0 END)
      AS exactVersionCount,
    CASE WHEN SUM(CASE WHEN v.id IS NOT NULL
      AND lower(v.source_hash_sha256)=?7 THEN 1 ELSE 0 END)=1
      THEN MAX(CASE WHEN v.id IS NOT NULL
        AND lower(v.source_hash_sha256)=?7 THEN v.id ELSE NULL END)
      ELSE NULL END AS exactVersionId
  FROM match_metrics m
  JOIN scope ON 1=1
  LEFT JOIN photos p ON p.id=m.photoId AND p.workspace_id=scope.workspaceId
    AND p.project_id=scope.projectId AND p.album_id=scope.albumId
  LEFT JOIN photo_versions v ON v.photo_id=p.id
    AND v.workspace_id=p.workspace_id
), aggregate_summary AS (
  SELECT scope.workspaceId,scope.projectId,scope.albumId,scope.mode,
    scope.projectRevision,scope.albumRevision,scope.changeSequence,
    coverage.indexComplete,match_metrics.matchedPhotoCount,match_metrics.photoId,
    CASE WHEN match_metrics.matchedPhotoCount=1
      THEN history_metrics.historyVersionCount ELSE 0 END AS historyVersionCount,
    CASE WHEN match_metrics.matchedPhotoCount=1
      THEN history_metrics.invalidHashCount ELSE 0 END AS invalidHashCount,
    CASE WHEN match_metrics.matchedPhotoCount=1
      THEN history_metrics.invalidDimensionsCount ELSE 0 END AS invalidDimensionsCount,
    CASE WHEN match_metrics.matchedPhotoCount=1
      THEN history_metrics.missingDimensionsCount ELSE 0 END AS missingDimensionsCount,
    CASE WHEN match_metrics.matchedPhotoCount=1
      THEN history_metrics.incompatibleDimensionsCount ELSE 0 END
      AS incompatibleDimensionsCount,
    CASE WHEN match_metrics.matchedPhotoCount=1
      THEN history_metrics.exactVersionCount ELSE 0 END AS exactVersionCount,
    CASE WHEN match_metrics.matchedPhotoCount=1
      THEN history_metrics.exactVersionId ELSE NULL END AS exactVersionId,
    (SELECT COUNT(*) FROM matching_sessions ms
      WHERE ms.status='reserved'
        AND NOT EXISTS(SELECT 1 FROM upload_completions c
          WHERE c.upload_session_id=ms.uploadSessionId)
        AND NOT EXISTS(SELECT 1 FROM upload_version_completions c
          WHERE c.upload_session_id=ms.uploadSessionId))
      AS pendingMatchCount
  FROM scope
  CROSS JOIN coverage
  CROSS JOIN match_metrics
  CROSS JOIN history_metrics
), head_data AS (
  SELECT p.id AS candidatePhotoId,h.version_id AS candidateHeadVersionId,
    h.revision AS candidateHeadRevision,v.id AS candidateVersionId,
    vw.originalFilename AS candidateFilename,
    v.source_hash_sha256 AS candidateSha256,
    v.width AS candidateWidth,v.height AS candidateHeight
  FROM scope
  CROSS JOIN match_metrics m
  JOIN photos p ON p.id=m.photoId AND p.workspace_id=scope.workspaceId
    AND p.project_id=scope.projectId AND p.album_id=scope.albumId
  LEFT JOIN photo_version_heads h ON h.photo_id=p.id
    AND h.workspace_id=scope.workspaceId AND h.project_id=scope.projectId
    AND h.album_id=scope.albumId
  LEFT JOIN photo_versions v ON v.id=h.version_id
    AND v.photo_id=p.id AND v.workspace_id=p.workspace_id
  LEFT JOIN version_witnesses vw ON vw.versionId=v.id
    AND vw.photoId=p.id AND vw.workspaceId=scope.workspaceId
    AND vw.projectId=scope.projectId AND vw.albumId=scope.albumId
  WHERE m.matchedPhotoCount=1
)
SELECT aggregate_summary.*,
  head_data.candidatePhotoId,head_data.candidateHeadVersionId,
  head_data.candidateHeadRevision,head_data.candidateVersionId,
  head_data.candidateFilename,head_data.candidateSha256,
  head_data.candidateWidth,head_data.candidateHeight
FROM aggregate_summary
LEFT JOIN head_data ON 1=1`;

function replaceSqlSeamOnce(
  sql: string,
  needle: string,
  replacement: string,
): string {
  const first = sql.indexOf(needle);
  if (first < 0 || sql.indexOf(needle, first + needle.length) >= 0)
    return unavailable();
  return sql.slice(0, first) + replacement + sql.slice(first + needle.length);
}

function replaceSqlSeamAll(
  sql: string,
  needle: string,
  replacement: string,
  expectedCount: number,
): string {
  const count = sql.split(needle).length - 1;
  if (count !== expectedCount) return unavailable();
  return sql.replaceAll(needle, replacement);
}

function buildMatchingProfileSnapshotSql(): string {
  let sql = replaceSqlSeamOnce(
    indexedSnapshotSql,
    'p.versioning_mode AS mode,p.revision AS projectRevision,a.revision AS albumRevision,',
    "p.versioning_mode AS mode,p.revision AS projectRevision,a.revision AS albumRevision,\n    COALESCE(h.profile,'default-v1') AS matchingProfile,\n    COALESCE(h.revision,0) AS ruleRevision,",
  );
  sql = replaceSqlSeamOnce(
    sql,
    'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id',
    'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id\n  LEFT JOIN project_matching_rule_heads h\n    ON h.project_id=p.id AND h.workspace_id=p.workspace_id',
  );
  sql = replaceSqlSeamOnce(
    sql,
    'scope.projectRevision,scope.albumRevision,scope.changeSequence,',
    'scope.projectRevision,scope.albumRevision,scope.changeSequence,\n    scope.matchingProfile,scope.ruleRevision,',
  );
  return replaceSqlSeamAll(
    sql,
    'matching_filename_index',
    'matching_profile_filename_keys',
    3,
  );
}

/** Same authorized query with opt-in profile keys and current rule-head facts. */
export const matchingProfileIndexedSnapshotSql =
  buildMatchingProfileSnapshotSql();

function unavailable(): never {
  throw new WorkspaceFailure('VERSION_MATCHING_UNAVAILABLE', 503);
}

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function resolutionStale(): never {
  throw new WorkspaceFailure('RESOLUTION_STALE', 409);
}

/** Indexed, bounded-row classifier read. It is advisory and grants no reservation authority. */
export class D1IndexedVersionMatchCandidates {
  constructor(
    private readonly db: D1Database,
    private readonly actorId: string,
    private readonly sessionId: string,
    private readonly matchingProfile?: AlbumMatchingProfile,
  ) {}

  async resolve(
    albumIdInput: string,
    evidenceInput: unknown,
  ): Promise<
    Readonly<{
      snapshot: VersionCandidateSnapshot;
      decision: VersionMatchResult;
    }>
  > {
    const albumId = z.uuid().safeParse(albumIdInput);
    if (!albumId.success) invalidInput();
    const evidence = evidenceSchema.safeParse(evidenceInput);
    if (!evidence.success) invalidInput();

    const profileContext =
      this.matchingProfile === undefined
        ? undefined
        : albumMatchingProfileSchema.safeParse(this.matchingProfile);
    if (profileContext !== undefined && !profileContext.success) invalidInput();
    const suppliedProfile = profileContext?.data;
    const canonical =
      suppliedProfile === undefined
        ? canonicalizePhotoFilename(evidence.data.filename)
        : canonicalizeMatchingProfileFilename(
            evidence.data.filename,
            suppliedProfile.profile,
          );
    const dimensions = evidence.data.dimensions;
    const querySql =
      suppliedProfile === undefined
        ? indexedSnapshotSql
        : matchingProfileIndexedSnapshotSql;
    let result: D1Result<unknown>;
    try {
      result = await this.db
        .prepare(querySql)
        .bind(
          this.actorId,
          this.sessionId,
          albumId.data,
          suppliedProfile?.profile ?? PROFILE,
          canonical?.basename ?? null,
          canonical?.extension ?? null,
          evidence.data.sha256.toLowerCase(),
          dimensions?.width ?? null,
          dimensions?.height ?? null,
        )
        .all<unknown>();
    } catch {
      return unavailable();
    }
    if (!result.success) return unavailable();
    if (result.results.length === 0)
      throw new WorkspaceFailure('NOT_FOUND', 404);
    if (result.results.length !== 1) return unavailable();

    let row: z.infer<typeof indexedSnapshotRowSchema>;
    let snapshotMatchingProfile: MatchingProfileContext | undefined;
    if (suppliedProfile === undefined) {
      const parsed = indexedSnapshotRowSchema.safeParse(result.results[0]);
      if (!parsed.success) return unavailable();
      row = parsed.data;
    } else {
      const parsed = profileAwareIndexedSnapshotRowSchema.safeParse(
        result.results[0],
      );
      if (!parsed.success) return unavailable();
      const profileRow = parsed.data;
      row = profileRow;
      if (
        profileRow.workspaceId !== suppliedProfile.workspaceId ||
        profileRow.projectId !== suppliedProfile.projectId ||
        profileRow.albumId !== suppliedProfile.albumId ||
        profileRow.albumId !== albumId.data ||
        profileRow.projectRevision !== suppliedProfile.projectRevision ||
        profileRow.matchingProfile !== suppliedProfile.profile ||
        profileRow.ruleRevision !== suppliedProfile.ruleRevision
      ) {
        resolutionStale();
      }
      snapshotMatchingProfile = {
        profile: profileRow.matchingProfile,
        ruleRevision: profileRow.ruleRevision,
      };
    }
    const canonicalizeCandidateFilename =
      suppliedProfile === undefined
        ? canonicalizePhotoFilename
        : (filename: string) =>
            canonicalizeMatchingProfileFilename(
              filename,
              suppliedProfile.profile,
            );
    const scope: VersionMatchScope = {
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      albumId: row.albumId,
    };

    const heads: Record<
      string,
      { versionId: string | null; revision: number | null }
    > = Object.create(null) as Record<
      string,
      { versionId: string | null; revision: number | null }
    >;
    const candidates: VersionMatchCandidate[] = [];
    let complete = row.indexComplete === 1;

    if (row.matchedPhotoCount === 1) {
      if (row.photoId === null || row.candidatePhotoId !== row.photoId) {
        complete = false;
      } else {
        heads[row.photoId] = {
          versionId: row.candidateHeadVersionId,
          revision: row.candidateHeadRevision,
        };
        const filename = row.candidateFilename;
        const sha256 = row.candidateSha256;
        const versionId = row.candidateVersionId;
        const headIsUsable =
          row.candidateHeadVersionId !== null &&
          row.candidateHeadRevision !== null &&
          row.candidateHeadVersionId === versionId &&
          filename !== null &&
          filename.length > 0 &&
          filename.length <= 255 &&
          canonicalizeCandidateFilename(filename) !== null &&
          sha256 !== null;
        if (!headIsUsable) {
          complete = false;
        } else {
          candidates.push({
            scope,
            photoId: row.photoId,
            versionId,
            filename,
            sha256,
            dimensions:
              row.candidateWidth === null || row.candidateHeight === null
                ? null
                : {
                    width: row.candidateWidth,
                    height: row.candidateHeight,
                  },
          });
        }
      }
    }

    const summary: IndexedVersionMatchSummary = complete
      ? {
          complete: true,
          matchedPhotoCount: row.matchedPhotoCount,
          photoId: row.photoId,
          historyVersionCount: row.historyVersionCount,
          invalidHashCount: row.invalidHashCount,
          invalidDimensionsCount: row.invalidDimensionsCount,
          missingDimensionsCount: row.missingDimensionsCount,
          incompatibleDimensionsCount: row.incompatibleDimensionsCount,
          exactVersionCount: row.exactVersionCount,
          pendingMatchCount: row.pendingMatchCount,
          exactVersionId: row.exactVersionId,
        }
      : {
          complete: false,
          matchedPhotoCount: 0,
          photoId: null,
          historyVersionCount: 0,
          invalidHashCount: 0,
          invalidDimensionsCount: 0,
          missingDimensionsCount: 0,
          incompatibleDimensionsCount: 0,
          exactVersionCount: 0,
          pendingMatchCount: row.pendingMatchCount,
          exactVersionId: null,
        };
    const snapshot: VersionCandidateSnapshot = {
      scope,
      mode: row.mode as VersionMatchMode,
      changeSequence: row.changeSequence,
      pendingUploads: [],
      projectRevision: row.projectRevision,
      ...(snapshotMatchingProfile === undefined
        ? {}
        : { matchingProfile: snapshotMatchingProfile }),
      albumRevision: row.albumRevision,
      candidates,
      candidatesTruncated: !complete,
      heads,
    };
    const decision = classifyIndexedVersionMatch({
      scope,
      mode: row.mode as VersionMatchMode,
      filename: evidence.data.filename,
      sha256: evidence.data.sha256,
      ...(dimensions === undefined ? {} : { dimensions }),
      summary,
    });
    return { snapshot, decision };
  }
}
