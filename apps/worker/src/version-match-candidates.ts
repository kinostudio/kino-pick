import type { MatchingProfileContext } from '../../../packages/contracts/src/matching-rules';
import { z } from 'zod';
import {
  matchPhotoVersion,
  canonicalizePhotoFilename,
  VERSION_MATCH_LIMITS,
  type VersionMatchCandidate,
  type VersionMatchMode,
  type VersionMatchScope,
} from '../../../packages/domain/src/version-matching';
import { WorkspaceFailure } from './workspaces';

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

const snapshotRowSchema = z.object({
  rowKind: z.enum(['scope', 'version', 'pending']),
  changeSequence: z.number().int().nonnegative().safe(),
  pendingUploadId: z.uuid().nullable(),
  workspaceId: z.uuid(),
  projectId: z.uuid(),
  albumId: z.uuid(),
  mode: modeSchema,
  projectRevision: z.number().int().positive().safe(),
  albumRevision: z.number().int().positive().safe(),
  photoId: z.uuid().nullable(),
  versionId: z.uuid().nullable(),
  filename: z.string().nullable(),
  sha256: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  headVersionId: z.uuid().nullable(),
  headRevision: z.number().int().nonnegative().safe().nullable(),
});

export type VersionCandidateSnapshot = Readonly<{
  scope: VersionMatchScope;
  mode: VersionMatchMode;
  changeSequence: number;
  pendingUploads: readonly Readonly<{
    uploadSessionId: string;
    filename: string;
  }>[];
  projectRevision: number;
  matchingProfile?: MatchingProfileContext;
  albumRevision: number;
  candidates: readonly VersionMatchCandidate[];
  candidatesTruncated: boolean;
  heads: Readonly<
    Record<
      string,
      Readonly<{ versionId: string | null; revision: number | null }>
    >
  >;
}>;

// One statement binds authority, mode/revisions and candidate completeness to the
// same SQLite snapshot. Never filter by SQLite lower()/filename equality before
// the domain classifier: that would omit NFC and explicitly opted-in matches.
const snapshotSql = `WITH scope AS (
  SELECT a.workspace_id AS workspaceId,a.project_id AS projectId,a.id AS albumId,
    p.versioning_mode AS mode,p.revision AS projectRevision,a.revision AS albumRevision,
    COALESCE((SELECT MAX(m.sequence) FROM album_matching_changes m
      WHERE m.album_id=a.id AND m.project_id=a.project_id AND m.workspace_id=a.workspace_id),0) AS changeSequence
  FROM albums a
  JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
  JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?1
  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2
    AND s.expiresAt>unixepoch('subsec')*1000
  WHERE a.id=?3 AND a.state NOT IN('archived','deleting','deleted')
    AND p.status NOT IN('archived','deleting','deleted')
), entries AS (
  SELECT scope.*,'scope' AS rowKind,NULL AS photoId,NULL AS versionId,
    NULL AS filename,NULL AS sha256,NULL AS width,NULL AS height,
    NULL AS headVersionId,NULL AS headRevision,NULL AS pendingUploadId FROM scope
  UNION ALL
  SELECT scope.*,'version',p.id,v.id,
    COALESCE(
      (SELECT u.original_filename FROM upload_completions c
        JOIN upload_sessions u ON u.id=c.upload_session_id WHERE c.version_id=v.id),
      (SELECT u.original_filename FROM upload_version_completions c
        JOIN upload_sessions u ON u.id=c.upload_session_id WHERE c.version_id=v.id),
      p.original_filename),v.source_hash_sha256,v.width,v.height,
    h.version_id,h.revision,NULL
  FROM scope
  JOIN photos p ON p.workspace_id=scope.workspaceId
    AND p.project_id=scope.projectId AND p.album_id=scope.albumId
  LEFT JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id
  LEFT JOIN photo_version_heads h ON h.photo_id=p.id
    AND h.workspace_id=p.workspace_id AND h.project_id=p.project_id AND h.album_id=p.album_id
  UNION ALL
  SELECT scope.*,'pending',NULL,NULL,u.original_filename,NULL,NULL,NULL,NULL,NULL,u.id
  FROM scope JOIN upload_sessions u ON u.workspace_id=scope.workspaceId
    AND u.project_id=scope.projectId AND u.album_id=scope.albumId
  WHERE u.status='reserved'
    AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id)
    AND NOT EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=u.id)
)
SELECT * FROM entries
ORDER BY CASE WHEN rowKind='scope' THEN 0 ELSE 1 END,photoId,versionId,pendingUploadId
LIMIT ?4`;

/** Internal advisory read. Its result is NOT a reservation or upload authority. */
export class D1VersionMatchCandidates {
  constructor(
    private readonly db: D1Database,
    private readonly actorId: string,
    private readonly sessionId: string,
  ) {}

  async read(albumIdInput: string): Promise<VersionCandidateSnapshot> {
    const albumId = z.uuid().safeParse(albumIdInput);
    if (!albumId.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
    const result = await this.db
      .prepare(snapshotSql)
      .bind(
        this.actorId,
        this.sessionId,
        albumId.data,
        VERSION_MATCH_LIMITS.maxCandidates + 2,
      )
      .all<unknown>();
    if (!result.success)
      throw new WorkspaceFailure('VERSION_MATCHING_UNAVAILABLE', 503);
    if (result.results.length === 0)
      throw new WorkspaceFailure('NOT_FOUND', 404);
    const parsed = z.array(snapshotRowSchema).safeParse(result.results);
    if (!parsed.success)
      throw new WorkspaceFailure('VERSION_MATCHING_UNAVAILABLE', 503);
    const first = parsed.data[0];
    if (!first) throw new WorkspaceFailure('VERSION_MATCHING_UNAVAILABLE', 503);
    const scope = {
      workspaceId: first.workspaceId,
      projectId: first.projectId,
      albumId: first.albumId,
    };
    const candidates: VersionMatchCandidate[] = [];
    const heads: Record<
      string,
      { versionId: string | null; revision: number | null }
    > = Object.create(null) as Record<
      string,
      { versionId: string | null; revision: number | null }
    >;
    const dataRows = parsed.data.filter((row) => row.rowKind !== 'scope');
    const pendingUploads: { uploadSessionId: string; filename: string }[] = [];
    let incomplete = false;
    for (const row of dataRows.slice(0, VERSION_MATCH_LIMITS.maxCandidates)) {
      if (row.rowKind === 'pending') {
        if (row.pendingUploadId === null || row.filename === null)
          incomplete = true;
        else
          pendingUploads.push({
            uploadSessionId: row.pendingUploadId,
            filename: row.filename,
          });
        continue;
      }
      // A photo lacking a version must not become a false no-match decision.
      if (row.photoId === null) {
        incomplete = true;
        continue;
      }
      heads[row.photoId] = {
        versionId: row.headVersionId,
        revision: row.headRevision,
      };
      if (row.headVersionId === null || row.headRevision === null)
        incomplete = true;
      if (
        row.versionId === null ||
        row.filename === null ||
        row.sha256 === null
      ) {
        incomplete = true;
        continue;
      }
      candidates.push({
        scope,
        photoId: row.photoId,
        versionId: row.versionId,
        filename: row.filename,
        sha256: row.sha256,
        dimensions:
          row.width === null || row.height === null
            ? null
            : { width: row.width, height: row.height },
      });
    }
    return {
      scope,
      mode: first.mode,
      changeSequence: first.changeSequence,
      pendingUploads,
      projectRevision: first.projectRevision,
      albumRevision: first.albumRevision,
      candidates,
      candidatesTruncated:
        incomplete || dataRows.length > VERSION_MATCH_LIMITS.maxCandidates,
      heads,
    };
  }

  async resolve(albumId: string, evidenceInput: unknown) {
    const evidence = evidenceSchema.safeParse(evidenceInput);
    if (!evidence.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
    const snapshot = await this.read(albumId);
    let decision = matchPhotoVersion({
      ...snapshot,
      filename: evidence.data.filename,
      sha256: evidence.data.sha256,
      ...(evidence.data.dimensions === undefined
        ? {}
        : { dimensions: evidence.data.dimensions }),
    });
    // Once a unique logical photo is established by name, compare its full
    // immutable history. The current head can have a different upload filename
    // (and crop); filename filtering must not hide that dimension evidence.
    if (
      decision.outcome === 'new_version' ||
      (decision.outcome === 'requires_review' &&
        decision.reason === 'assisted_choice_required')
    ) {
      const photoId = decision.photoId;
      decision = matchPhotoVersion({
        ...snapshot,
        filename: evidence.data.filename,
        sha256: evidence.data.sha256,
        ...(evidence.data.dimensions === undefined
          ? {}
          : { dimensions: evidence.data.dimensions }),
        candidates: snapshot.candidates
          .filter((candidate) => candidate.photoId === photoId)
          .map((candidate) => ({
            ...candidate,
            filename: evidence.data.filename,
          })),
      });
    }
    if (
      snapshot.mode !== 'off' &&
      snapshot.mode !== 'manual' &&
      (decision.outcome === 'new_photo' ||
        decision.outcome === 'new_version' ||
        (decision.outcome === 'requires_review' &&
          decision.reason === 'assisted_choice_required'))
    ) {
      const incomingName = canonicalizePhotoFilename(evidence.data.filename);
      if (
        snapshot.pendingUploads.some((upload) => {
          const pendingName = canonicalizePhotoFilename(upload.filename);
          return (
            pendingName === null ||
            (incomingName !== null &&
              incomingName.basename === pendingName.basename &&
              incomingName.extension === pendingName.extension)
          );
        })
      ) {
        decision = {
          outcome: 'requires_review',
          reason: 'pending_upload_requires_review',
          photoId: decision.photoId,
          versionId: null,
        };
      }
    }
    return { snapshot, decision };
  }
}
