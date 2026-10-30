import { z } from 'zod';
import {
  MATCHING_PROFILES,
  canonicalizeMatchingProfileFilename,
} from '../../../packages/domain/src/matching-profiles';
import {
  advanceMatchingRuleIndexSchema,
  matchingProfileIdSchema,
  matchingRuleIndexStatusSchema,
  type MatchingRuleIndexStatus,
} from '../../../packages/contracts/src/matching-rules';
import { WorkspaceFailure } from './workspaces';

const revision = z.number().int().min(0).max(2147483647);
const contextSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    projectRevision: revision.min(1),
    profile: matchingProfileIdSchema,
    ruleRevision: revision,
  })
  .strict();
export type AlbumMatchingProfile = z.infer<typeof contextSchema>;
const anchorSchema = z
  .object({
    ownerAuthorized: z.union([z.literal(0), z.literal(1)]),
    workspaceId: z.uuid().nullable(),
    projectId: z.uuid().nullable(),
    albumId: z.uuid().nullable(),
    projectRevision: revision.min(1).nullable(),
    profile: matchingProfileIdSchema.nullable(),
    ruleRevision: revision.nullable(),
  })
  .passthrough();
const sourceSchema = contextSchema.extend({
  uploadSessionId: z.uuid(),
  originalFilename: z.string(),
});

const scopeSql = `WITH identity AS (
 SELECT EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
  AND s.id=?2 AND s.expiresAt>unixepoch('subsec')*1000
  WHERE o.user_id=?1 AND o.enabled=1) AS ownerAuthorized
),scope AS (
 SELECT a.workspace_id AS workspaceId,a.project_id AS projectId,a.id AS albumId,
  p.revision AS projectRevision,COALESCE(h.profile,'default-v1') AS profile,
  COALESCE(h.revision,0) AS ruleRevision
 FROM albums a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
 JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?1
 JOIN identity ON identity.ownerAuthorized=1
 LEFT JOIN project_matching_rule_heads h ON h.project_id=p.id AND h.workspace_id=p.workspace_id
 WHERE a.id=?3 AND a.state NOT IN('archived','deleting','deleted')
  AND p.status NOT IN('archived','deleting','deleted')
)`;
const contextSql =
  scopeSql +
  ' SELECT identity.ownerAuthorized,scope.* FROM identity LEFT JOIN scope ON 1=1';
const statusSql =
  scopeSql +
  ` SELECT identity.ownerAuthorized,scope.*,
 (SELECT COUNT(*) FROM matching_profile_filename_keys i WHERE i.workspace_id=scope.workspaceId AND i.project_id=scope.projectId AND i.album_id=scope.albumId AND i.profile=scope.profile) AS indexedSessions,
 (SELECT COUNT(*) FROM upload_sessions u WHERE u.workspace_id=scope.workspaceId AND u.project_id=scope.projectId AND u.album_id=scope.albumId AND NOT EXISTS(SELECT 1 FROM matching_profile_filename_keys i WHERE i.upload_session_id=u.id AND i.profile=scope.profile)) AS missingSessions,
 (SELECT COUNT(*) FROM matching_profile_filename_keys i JOIN upload_sessions u ON u.id=i.upload_session_id WHERE i.workspace_id=scope.workspaceId AND i.project_id=scope.projectId AND i.album_id=scope.albumId AND i.profile=scope.profile AND i.is_invalid=1 AND (u.status='reserved' OR EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id) OR EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.upload_session_id=u.id))) AS invalidSessions,
 (SELECT COUNT(*) FROM photo_versions v JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id WHERE p.workspace_id=scope.workspaceId AND p.project_id=scope.projectId AND p.album_id=scope.albumId AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.version_id=v.id AND c.photo_id=p.id AND c.workspace_id=p.workspace_id AND c.project_id=p.project_id AND c.album_id=p.album_id) AND NOT EXISTS(SELECT 1 FROM upload_version_completions c WHERE c.version_id=v.id AND c.photo_id=p.id AND c.workspace_id=p.workspace_id AND c.project_id=p.project_id AND c.album_id=p.album_id)) AS unlinkedVersions,
 (SELECT COUNT(*) FROM photos p WHERE p.workspace_id=scope.workspaceId AND p.project_id=scope.projectId AND p.album_id=scope.albumId AND (NOT EXISTS(SELECT 1 FROM photo_versions v WHERE v.photo_id=p.id AND v.workspace_id=p.workspace_id) OR NOT EXISTS(SELECT 1 FROM photo_version_heads h JOIN photo_versions v ON v.id=h.version_id AND v.photo_id=p.id AND v.workspace_id=p.workspace_id WHERE h.photo_id=p.id AND h.workspace_id=p.workspace_id AND h.project_id=p.project_id AND h.album_id=p.album_id AND h.revision>=0))) AS unreadyPhotos
 FROM identity LEFT JOIN scope ON 1=1`;
const sourcesSql =
  scopeSql +
  ` SELECT scope.*,u.id AS uploadSessionId,u.original_filename AS originalFilename FROM scope JOIN upload_sessions u ON u.workspace_id=scope.workspaceId AND u.project_id=scope.projectId AND u.album_id=scope.albumId WHERE NOT EXISTS(SELECT 1 FROM matching_profile_filename_keys i WHERE i.upload_session_id=u.id AND i.profile=scope.profile) ORDER BY u.id COLLATE BINARY LIMIT 24`;
function unavailable(): never {
  throw new WorkspaceFailure('MATCHING_RULES_UNAVAILABLE', 503);
}
function stale(): never {
  throw new WorkspaceFailure('MATCHING_RULES_REVISION_CONFLICT', 409);
}
function decodeContext(raw: unknown): AlbumMatchingProfile {
  const anchor = anchorSchema.safeParse(raw);
  if (!anchor.success) return unavailable();
  if (anchor.data.ownerAuthorized !== 1)
    throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  if (anchor.data.albumId === null)
    throw new WorkspaceFailure('NOT_FOUND', 404);
  const {
    workspaceId,
    projectId,
    albumId,
    projectRevision,
    profile,
    ruleRevision,
  } = anchor.data;
  const context = contextSchema.safeParse({
    workspaceId,
    projectId,
    albumId,
    projectRevision,
    profile,
    ruleRevision,
  });
  if (!context.success) return unavailable();
  return context.data;
}
function sameContext(
  a: AlbumMatchingProfile,
  b: AlbumMatchingProfile,
): boolean {
  return (
    a.workspaceId === b.workspaceId &&
    a.projectId === b.projectId &&
    a.albumId === b.albumId &&
    a.projectRevision === b.projectRevision &&
    a.profile === b.profile &&
    a.ruleRevision === b.ruleRevision
  );
}
async function rows(
  db: D1Database,
  sql: string,
  actorId: string,
  sessionId: string,
  albumId: string,
) {
  let result: D1Result<unknown>;
  try {
    result = await db.prepare(sql).bind(actorId, sessionId, albumId).all();
  } catch {
    return unavailable();
  }
  if (!result.success) return unavailable();
  return result.results;
}
export async function readAlbumMatchingProfile(
  db: D1Database,
  actorId: string,
  sessionId: string,
  albumIdInput: string,
): Promise<AlbumMatchingProfile> {
  const album = z.uuid().safeParse(albumIdInput);
  if (!album.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  const result = await rows(db, contextSql, actorId, sessionId, album.data);
  if (result.length !== 1) return unavailable();
  return decodeContext(result[0]);
}
function maintenanceInsert(
  db: D1Database,
  actorId: string,
  sessionId: string,
  source: z.infer<typeof sourceSchema>,
): D1PreparedStatement {
  const table =
    source.profile === 'default-v1'
      ? 'matching_filename_index'
      : 'matching_rule_filename_index';
  const canonical = canonicalizeMatchingProfileFilename(
    source.originalFilename,
    source.profile,
  );
  return db
    .prepare(
      `INSERT INTO ${table}(upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid)
 SELECT u.id,u.workspace_id,u.project_id,u.album_id,u.original_filename,?6,?7,?8,?9
 FROM upload_sessions u JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id AND a.workspace_id=u.workspace_id
 JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
 JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?10
 JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?11 AND s.expiresAt>unixepoch('subsec')*1000
 LEFT JOIN project_matching_rule_heads h ON h.project_id=p.id AND h.workspace_id=p.workspace_id
 WHERE u.id=?1 AND u.workspace_id=?2 AND u.project_id=?3 AND u.album_id=?4 AND u.original_filename=?5
 AND p.revision=?12 AND COALESCE(h.profile,'default-v1')=?6 AND COALESCE(h.revision,0)=?13
 AND a.state NOT IN('archived','deleting','deleted') AND p.status NOT IN('archived','deleting','deleted')
 ON CONFLICT(upload_session_id,profile) DO NOTHING`,
    )
    .bind(
      source.uploadSessionId,
      source.workspaceId,
      source.projectId,
      source.albumId,
      source.originalFilename,
      source.profile,
      canonical?.basename ?? null,
      canonical?.extension ?? null,
      canonical === null ? 1 : 0,
      actorId,
      sessionId,
      source.projectRevision,
      source.ruleRevision,
    );
}
export class D1MatchingRuleFilenameIndex {
  constructor(
    private readonly db: D1Database,
    private readonly actorId: string,
    private readonly sessionId: string,
    private readonly enabled: boolean,
  ) {}
  private check() {
    if (!this.enabled)
      throw new WorkspaceFailure('MATCHING_RULES_DISABLED', 403);
  }
  async read(albumIdInput: string): Promise<MatchingRuleIndexStatus> {
    this.check();
    const album = z.uuid().parse(albumIdInput);
    const result = await rows(
      this.db,
      statusSql,
      this.actorId,
      this.sessionId,
      album,
    );
    if (result.length !== 1) return unavailable();
    const context = decodeContext(result[0]);
    const raw = result[0] as Record<string, unknown>;
    const counts = z
      .object({
        indexedSessions: z.number().int().nonnegative().safe(),
        missingSessions: z.number().int().nonnegative().safe(),
        invalidSessions: z.number().int().nonnegative().safe(),
        unlinkedVersions: z.number().int().nonnegative().safe(),
        unreadyPhotos: z.number().int().nonnegative().safe(),
      })
      .safeParse(raw);
    if (!counts.success) return unavailable();
    const c = counts.data;
    return matchingRuleIndexStatusSchema.parse({
      ...context,
      ...c,
      state:
        c.missingSessions > 0
          ? 'building'
          : c.invalidSessions > 0 ||
              c.unlinkedVersions > 0 ||
              c.unreadyPhotos > 0
            ? 'blocked'
            : 'ready',
    });
  }
  async advance(
    albumIdInput: string,
    input: unknown,
  ): Promise<MatchingRuleIndexStatus> {
    this.check();
    const expected = advanceMatchingRuleIndexSchema.parse(input);
    const before = await this.read(albumIdInput);
    if (
      before.projectRevision !== expected.expectedProjectRevision ||
      before.ruleRevision !== expected.expectedRuleRevision ||
      before.profile !== expected.profile
    )
      stale();
    const selected = await rows(
      this.db,
      sourcesSql,
      this.actorId,
      this.sessionId,
      before.albumId,
    );
    const parsed = z.array(sourceSchema).max(24).safeParse(selected);
    if (!parsed.success) return unavailable();
    for (const source of parsed.data) if (!sameContext(source, before)) stale();
    if (parsed.data.length) {
      try {
        const result = await this.db.batch(
          parsed.data.map((source) =>
            maintenanceInsert(this.db, this.actorId, this.sessionId, source),
          ),
        );
        if (
          result.length !== parsed.data.length ||
          result.some((row) => !row.success)
        )
          return unavailable();
      } catch {
        return unavailable();
      }
    }
    const after = await this.read(albumIdInput);
    if (!sameContext(before, after)) stale();
    return after;
  }
}
/** One same-batch statement; only the currently selected nondefault profile can insert. */
export function matchingRuleFilenameIndexInsert(
  db: D1Database,
  actorId: string,
  sessionId: string,
  uploadSessionId: string,
  originalFilename: string,
): D1PreparedStatement {
  const supplied = MATCHING_PROFILES.filter(
    (profile) => profile.id !== 'default-v1',
  ).map((profile) => {
    const canonical = canonicalizeMatchingProfileFilename(
      originalFilename,
      profile.id,
    );
    return {
      profile: profile.id,
      basename: canonical?.basename ?? null,
      extension: canonical?.extension ?? null,
      invalid: canonical === null ? 1 : 0,
    };
  });
  return db
    .prepare(
      `INSERT INTO matching_rule_filename_index(upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid)
 SELECT u.id,u.workspace_id,u.project_id,u.album_id,u.original_filename,h.profile,json_extract(c.value,'$.basename'),json_extract(c.value,'$.extension'),json_extract(c.value,'$.invalid')
 FROM upload_sessions u JOIN albums a ON a.id=u.album_id AND a.project_id=u.project_id AND a.workspace_id=u.workspace_id
 JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
 JOIN project_matching_rule_heads h ON h.project_id=p.id AND h.workspace_id=p.workspace_id
 JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?1
 JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
 JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2 AND s.expiresAt>unixepoch('subsec')*1000
 JOIN json_each(?5) c ON json_extract(c.value,'$.profile')=h.profile
 WHERE u.id=?3 AND u.original_filename=?4 AND a.state NOT IN('archived','deleting','deleted') AND p.status NOT IN('archived','deleting','deleted')
 ON CONFLICT(upload_session_id,profile) DO NOTHING`,
    )
    .bind(
      actorId,
      sessionId,
      uploadSessionId,
      originalFilename,
      JSON.stringify(supplied),
    );
}
