import { z } from 'zod';
import { canonicalizePhotoFilename } from '../../../packages/domain/src/version-matching';
import {
  matchingFilenameIndexStatusSchema,
  type MatchingFilenameIndexStatus,
} from '../../../packages/contracts/src/matching-filename-index';
import { WorkspaceFailure } from './workspaces';

const PROFILE = 'default-v1' as const;
const MAX_ADVANCE_SESSIONS = 24;

const snapshotRowSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    indexedSessions: z.number().int().nonnegative().safe(),
    missingSessions: z.number().int().nonnegative().safe(),
    invalidSessions: z.number().int().nonnegative().safe(),
    unlinkedVersions: z.number().int().nonnegative().safe(),
    unreadyPhotos: z.number().int().nonnegative().safe(),
  })
  .strict();

const sourceRowSchema = z
  .object({
    uploadSessionId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    originalFilename: z.string(),
  })
  .strict();

const snapshotSql = [
  'WITH scope AS (',
  '  SELECT a.workspace_id AS workspaceId,a.project_id AS projectId,a.id AS albumId',
  '  FROM albums a',
  '  JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id',
  '  JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?1',
  '  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
  '  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2',
  "    AND s.expiresAt>unixepoch('subsec')*1000",
  "  WHERE a.id=?3 AND a.state NOT IN('archived','deleting','deleted')",
  "    AND p.status NOT IN('archived','deleting','deleted')",
  ')',
  'SELECT scope.workspaceId,scope.projectId,scope.albumId,',
  '  (SELECT COUNT(*) FROM matching_filename_index i',
  '    WHERE i.workspace_id=scope.workspaceId AND i.project_id=scope.projectId',
  '      AND i.album_id=scope.albumId AND i.profile=?4) AS indexedSessions,',
  '  (SELECT COUNT(*) FROM upload_sessions u',
  '    WHERE u.workspace_id=scope.workspaceId AND u.project_id=scope.projectId',
  '      AND u.album_id=scope.albumId',
  '      AND NOT EXISTS(SELECT 1 FROM matching_filename_index i',
  '        WHERE i.upload_session_id=u.id AND i.profile=?4)) AS missingSessions,',
  '  (SELECT COUNT(*) FROM matching_filename_index i',
  '    JOIN upload_sessions u ON u.id=i.upload_session_id',
  '    WHERE i.workspace_id=scope.workspaceId AND i.project_id=scope.projectId',
  '      AND i.album_id=scope.albumId AND i.profile=?4 AND i.is_invalid=1',
  "      AND (u.status='reserved' OR EXISTS(SELECT 1 FROM upload_completions c",
  '        WHERE c.upload_session_id=u.id) OR EXISTS(',
  '        SELECT 1 FROM upload_version_completions c',
  '        WHERE c.upload_session_id=u.id))) AS invalidSessions,',
  '  (SELECT COUNT(*) FROM photo_versions v',
  '    JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id',
  '    WHERE p.workspace_id=scope.workspaceId AND p.project_id=scope.projectId',
  '      AND p.album_id=scope.albumId',
  '      AND NOT EXISTS(SELECT 1 FROM upload_completions c',
  '        WHERE c.version_id=v.id AND c.photo_id=p.id',
  '          AND c.workspace_id=scope.workspaceId AND c.project_id=scope.projectId',
  '          AND c.album_id=scope.albumId)',
  '      AND NOT EXISTS(SELECT 1 FROM upload_version_completions c',
  '        WHERE c.version_id=v.id AND c.photo_id=p.id',
  '          AND c.workspace_id=scope.workspaceId AND c.project_id=scope.projectId',
  '          AND c.album_id=scope.albumId)) AS unlinkedVersions,',
  '  (SELECT COUNT(*) FROM photos p',
  '    WHERE p.workspace_id=scope.workspaceId AND p.project_id=scope.projectId',
  '      AND p.album_id=scope.albumId',
  '      AND (NOT EXISTS(SELECT 1 FROM photo_versions v',
  '            WHERE v.photo_id=p.id AND v.workspace_id=p.workspace_id)',
  '        OR NOT EXISTS(SELECT 1 FROM photo_version_heads h',
  '          JOIN photo_versions hv ON hv.id=h.version_id',
  '            AND hv.photo_id=p.id AND hv.workspace_id=p.workspace_id',
  '          WHERE h.photo_id=p.id AND h.workspace_id=p.workspace_id',
  '            AND h.project_id=p.project_id AND h.album_id=p.album_id',
  '            AND h.revision>=0))) AS unreadyPhotos',
  'FROM scope',
].join('\n');

const sourceSelectionSql = [
  'SELECT u.id AS uploadSessionId,u.workspace_id AS workspaceId,',
  '  u.project_id AS projectId,u.album_id AS albumId,',
  '  u.original_filename AS originalFilename',
  'FROM upload_sessions u',
  'JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id',
  '  AND a.workspace_id=u.workspace_id AND a.id=?3',
  'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id',
  'JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?1',
  'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
  'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2',
  "  AND s.expiresAt>unixepoch('subsec')*1000",
  "WHERE a.state NOT IN('archived','deleting','deleted')",
  "  AND p.status NOT IN('archived','deleting','deleted')",
  '  AND NOT EXISTS(SELECT 1 FROM matching_filename_index i',
  '    WHERE i.upload_session_id=u.id AND i.profile=?4)',
  'ORDER BY u.id ASC LIMIT 24',
].join('\n');

const insertSql = [
  'INSERT INTO matching_filename_index(',
  '  upload_session_id,workspace_id,project_id,album_id,original_filename,',
  '  profile,canonical_basename,canonical_extension,is_invalid',
  ')',
  'SELECT u.id,u.workspace_id,u.project_id,u.album_id,u.original_filename,',
  '  ?6,?7,?8,?9',
  'FROM upload_sessions u',
  'JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id',
  '  AND a.workspace_id=u.workspace_id AND a.id=?4',
  'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id',
  'JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?10',
  'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
  'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?11',
  "  AND s.expiresAt>unixepoch('subsec')*1000",
  'WHERE u.id=?1 AND u.workspace_id=?2 AND u.project_id=?3 AND u.album_id=?4',
  '  AND u.original_filename=?5',
  "  AND a.state NOT IN('archived','deleting','deleted')",
  "  AND p.status NOT IN('archived','deleting','deleted')",
  'ON CONFLICT(upload_session_id,profile) DO NOTHING',
].join('\n');

const reservationInsertSql = [
  'INSERT INTO matching_filename_index(',
  '  upload_session_id,workspace_id,project_id,album_id,original_filename,',
  '  profile,canonical_basename,canonical_extension,is_invalid',
  ')',
  'SELECT u.id,u.workspace_id,u.project_id,u.album_id,u.original_filename,',
  '  ?5,?6,?7,?8',
  'FROM upload_sessions u',
  'JOIN workspaces w ON w.id=u.workspace_id AND w.owner_user_id=?1',
  'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
  'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2',
  "  AND s.expiresAt>unixepoch('subsec')*1000",
  'JOIN projects p ON p.id=u.project_id AND p.workspace_id=u.workspace_id',
  'JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id',
  '  AND a.workspace_id=u.workspace_id',
  'WHERE u.id=?3 AND u.actor_id=?1 AND u.original_filename=?4',
  "  AND a.state NOT IN('archived','deleting','deleted')",
  "  AND p.status NOT IN('archived','deleting','deleted')",
  'ON CONFLICT(upload_session_id,profile) DO NOTHING',
].join('\n');
function failUnavailable(): never {
  throw new WorkspaceFailure('MATCHING_INDEX_UNAVAILABLE', 503);
}

function failInvalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

export class D1MatchingFilenameIndex {
  constructor(
    private readonly db: D1Database,
    private readonly actorId: string,
    private readonly sessionId: string,
    private readonly enabled: boolean,
  ) {}

  private assertEnabled(): void {
    if (!this.enabled)
      throw new WorkspaceFailure('MATCHING_INDEX_DISABLED', 403);
  }

  private parseAlbumId(albumIdInput: string): string {
    const parsed = z.uuid().safeParse(albumIdInput);
    if (!parsed.success) failInvalidInput();
    return parsed.data;
  }

  async read(albumIdInput: string): Promise<MatchingFilenameIndexStatus> {
    this.assertEnabled();
    const albumId = this.parseAlbumId(albumIdInput);
    let result: D1Result<unknown>;
    try {
      result = await this.db
        .prepare(snapshotSql)
        .bind(this.actorId, this.sessionId, albumId, PROFILE)
        .all<unknown>();
    } catch {
      return failUnavailable();
    }
    if (!result.success) return failUnavailable();
    if (result.results.length === 0)
      throw new WorkspaceFailure('NOT_FOUND', 404);
    if (result.results.length !== 1) return failUnavailable();

    const parsedRow = snapshotRowSchema.safeParse(result.results[0]);
    if (!parsedRow.success) return failUnavailable();
    const row = parsedRow.data;
    const hasBlockers =
      row.invalidSessions > 0 ||
      row.unlinkedVersions > 0 ||
      row.unreadyPhotos > 0;
    const state =
      row.missingSessions > 0 ? 'building' : hasBlockers ? 'blocked' : 'ready';
    const status = matchingFilenameIndexStatusSchema.safeParse({
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      albumId: row.albumId,
      profile: PROFILE,
      indexedSessions: row.indexedSessions,
      missingSessions: row.missingSessions,
      invalidSessions: row.invalidSessions,
      unlinkedVersions: row.unlinkedVersions,
      unreadyPhotos: row.unreadyPhotos,
      state,
    });
    if (!status.success) return failUnavailable();
    return status.data;
  }

  async advance(albumIdInput: string): Promise<MatchingFilenameIndexStatus> {
    this.assertEnabled();
    const albumId = this.parseAlbumId(albumIdInput);
    let result: D1Result<unknown>;
    try {
      result = await this.db
        .prepare(sourceSelectionSql)
        .bind(this.actorId, this.sessionId, albumId, PROFILE)
        .all<unknown>();
    } catch {
      return failUnavailable();
    }
    if (!result.success) return failUnavailable();
    if (result.results.length > MAX_ADVANCE_SESSIONS) return failUnavailable();

    const sourceRows = z.array(sourceRowSchema).safeParse(result.results);
    if (!sourceRows.success) return failUnavailable();
    const statements = sourceRows.data.map((source) => {
      const canonical = canonicalizePhotoFilename(source.originalFilename);
      return this.db
        .prepare(insertSql)
        .bind(
          source.uploadSessionId,
          source.workspaceId,
          source.projectId,
          source.albumId,
          source.originalFilename,
          PROFILE,
          canonical?.basename ?? null,
          canonical?.extension ?? null,
          canonical === null ? 1 : 0,
          this.actorId,
          this.sessionId,
        );
    });

    if (statements.length > 0) {
      let outcomes: D1Result<unknown>[];
      try {
        outcomes = await this.db.batch(statements);
      } catch {
        return failUnavailable();
      }
      if (
        outcomes.length !== statements.length ||
        outcomes.some((outcome) => !outcome.success)
      )
        return failUnavailable();
    }

    return this.read(albumId);
  }
}

/** Build the immutable default-v1 key for a freshly inserted reservation in the same D1 batch. */
export function matchingFilenameIndexInsert(
  db: D1Database,
  actorId: string,
  sessionId: string,
  uploadSessionId: string,
  originalFilename: string,
): D1PreparedStatement {
  const canonical = canonicalizePhotoFilename(originalFilename);
  return db
    .prepare(reservationInsertSql)
    .bind(
      actorId,
      sessionId,
      uploadSessionId,
      originalFilename,
      PROFILE,
      canonical?.basename ?? null,
      canonical?.extension ?? null,
      canonical === null ? 1 : 0,
    );
}
