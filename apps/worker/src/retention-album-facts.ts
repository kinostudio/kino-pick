import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';
import { storageAssetPhysicalBytesSql } from './storage-inventory';

const MAX_ALBUMS = 100;
// shortcut: cap source aggregation at 100,000 assets/versions per snapshot; page before raising this limit.
const MAX_SOURCE_ROWS = 100_000;
const UUID = z.uuid();
const utcText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const integer = z.number().int().nonnegative().safe();
const blocker = z.enum([
  'DELETE_PROTECTED',
  'DELETE_CONTENT_BUSY',
  'DELETE_ACTIVE_REVIEW',
  'DELETE_SHARED_REFERENCE',
]);

export type RetentionAlbumFact = Readonly<{
  workspaceId: string;
  albumId: string;
  projectId: string;
  state: 'draft' | 'active' | 'archived' | 'deleting' | 'deleted';
  revision: number;
  policyRevision: number;
  createdAt: string;
  publishedAt: string | null;
  lastValidViewedAt: string | null;
  inactiveDays: number;
  cleanupAllowed: boolean;
  bytes: number;
  assetCount: number;
  versionCount: number;
  latestActiveCustomShareExpiresAt: string | null;
  activeCustomShareCount: number;
  blockers: readonly z.infer<typeof blocker>[];
}>;

export type RetentionAlbumFactsSnapshot = Readonly<{
  workspaceId: string;
  observedAt: string;
  albums: readonly RetentionAlbumFact[];
}>;

const rowSchema = z
  .object({
    workspaceId: UUID,
    albumId: UUID,
    projectId: UUID,
    state: z.enum(['draft', 'active', 'archived', 'deleting', 'deleted']),
    revision: z.number().int().positive().safe(),
    policyRevision: z.number().int().min(0).max(2147483647),
    createdAt: utcText,
    publishedAtMs: integer.nullable(),
    lastValidViewedAtMs: integer.nullable(),
    humanFrontierVerified: z.union([z.literal(0), z.literal(1)]),
    policyPresent: z.union([z.literal(0), z.literal(1)]),
    inactiveDays: z.number().int().min(1).max(36_500).nullable(),
    cleanupAllowed: z.union([z.literal(0), z.literal(1)]).nullable(),
    bytes: integer,
    assetCount: integer,
    versionCount: integer,
    latestActiveCustomShareExpiresAtMs: integer.nullable(),
    activeCustomShareCount: integer,
    blockers: z.array(blocker),
  })
  .strict();

const resultSchema = z
  .object({
    owner_authorized: z.union([z.literal(0), z.literal(1)]),
    workspace_exists: z.union([z.literal(0), z.literal(1)]),
    workspace_authorized: z.union([z.literal(0), z.literal(1)]),
    observed_at_ms: integer,
    album_count: integer,
    asset_source_count: integer,
    version_source_count: integer,
    albums_json: z.string().nullable(),
  })
  .strict();

const sql = `
WITH
scope AS MATERIALIZED (
  SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS observed_at_ms,
    EXISTS(SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id
      WHERE o.user_id=?1 AND o.enabled=1 AND s.id=?2
        AND s.expiresAt>unixepoch('subsec')*1000) AS owner_authorized,
    EXISTS(SELECT 1 FROM workspaces w WHERE w.id=?3) AS workspace_exists,
    EXISTS(SELECT 1 FROM workspaces w JOIN owners o ON o.user_id=w.owner_user_id
      JOIN owner_sessions s ON s.userId=o.user_id
      WHERE w.id=?3 AND o.user_id=?1 AND o.enabled=1 AND s.id=?2
        AND s.expiresAt>unixepoch('subsec')*1000) AS workspace_authorized
),
target AS MATERIALIZED (
  SELECT a.id AS album_id,a.workspace_id,a.project_id,a.state,a.revision,a.created_at,
    c.album_id IS NOT NULL AS policy_present,c.revision AS policy_revision,c.inactive_days,c.cleanup_allowed,
    e.published_at_ms,h.last_valid_viewed_at_ms,h.view_event_id
  FROM scope s JOIN albums a ON a.workspace_id=?3
  JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
  LEFT JOIN album_retention_policy_configurations c ON c.album_id=a.id
    AND c.workspace_id=a.workspace_id AND c.project_id=a.project_id
  LEFT JOIN effective_album_inherited_share_expiry e ON e.album_id=a.id
    AND e.workspace_id=a.workspace_id AND e.project_id=a.project_id
  LEFT JOIN album_human_activity h ON h.album_id=a.id
    AND h.workspace_id=a.workspace_id AND h.project_id=a.project_id
  WHERE s.workspace_authorized=1
  ORDER BY a.id LIMIT 101
),
within_limit AS MATERIALIZED (
  SELECT album_count FROM (SELECT count(*) AS album_count FROM target)
  WHERE album_count<=100
),
asset_rows AS MATERIALIZED (
  SELECT t.album_id,a.id AS asset_id,a.version_id,
    ${storageAssetPhysicalBytesSql} AS bytes
  FROM within_limit x JOIN target t ON 1=1
  JOIN photos p ON p.album_id=t.album_id AND p.workspace_id=t.workspace_id
    AND p.project_id=t.project_id
  JOIN photo_assets a ON a.photo_id=p.id AND a.workspace_id=p.workspace_id
  LIMIT 100001
),
asset_summary AS (
  SELECT album_id,count(*) AS asset_count,sum(bytes) AS bytes
  FROM asset_rows GROUP BY album_id
),
version_rows AS MATERIALIZED (
  SELECT t.album_id,v.id AS version_id
  FROM within_limit x JOIN target t ON 1=1
  JOIN photos p ON p.album_id=t.album_id AND p.workspace_id=t.workspace_id
    AND p.project_id=t.project_id
  JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id
  LIMIT 100001
),
version_summary AS (
  SELECT album_id,count(*) AS version_count
  FROM version_rows GROUP BY album_id
),
last_human_event AS (
  SELECT t.album_id,
    (SELECT v.event_id FROM human_photo_views v
      WHERE v.workspace_id=t.workspace_id AND v.project_id=t.project_id
        AND v.album_id=t.album_id
      ORDER BY v.viewed_at_ms DESC,v.event_id DESC LIMIT 1) AS event_id,
    (SELECT max(v.viewed_at_ms) FROM human_photo_views v
      WHERE v.workspace_id=t.workspace_id AND v.project_id=t.project_id
        AND v.album_id=t.album_id) AS viewed_at_ms
  FROM target t
),
human_frontiers AS (
  SELECT t.album_id,
    CASE WHEN (h.album_id IS NULL AND e.viewed_at_ms IS NULL)
      OR (h.album_id IS NOT NULL AND h.last_valid_viewed_at_ms=e.viewed_at_ms
        AND h.view_event_id=e.event_id)
      THEN 1 ELSE 0 END AS verified,
    CASE WHEN h.last_valid_viewed_at_ms=e.viewed_at_ms
      AND h.view_event_id=e.event_id THEN h.last_valid_viewed_at_ms
      ELSE NULL END AS viewed_at_ms
  FROM target t LEFT JOIN album_human_activity h ON h.album_id=t.album_id
    AND h.workspace_id=t.workspace_id AND h.project_id=t.project_id
  LEFT JOIN last_human_event e ON e.album_id=t.album_id
),
share_summary AS (
  SELECT e.album_id,count(*) AS share_count,max(e.expires_at_ms) AS latest_expires_at_ms
  FROM target t JOIN effective_guest_invite_album_expiry e ON e.album_id=t.album_id
    AND e.workspace_id=t.workspace_id AND e.project_id=t.project_id
  JOIN guest_invites i ON i.id=e.invite_id AND i.workspace_id=e.workspace_id
    AND i.project_id=e.project_id
  JOIN guest_invite_seals seal ON seal.invite_id=i.id
  CROSS JOIN scope s
  WHERE e.expiry_mode='custom' AND e.expiry_valid=1
    AND typeof(e.expires_at_ms)='integer' AND e.expires_at_ms>s.observed_at_ms
    AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
  GROUP BY e.album_id
),
blocker_rows AS (
  SELECT DISTINCT t.album_id,b.blocker
  FROM target t JOIN manual_album_deletion_blockers b ON b.album_id=t.album_id
),
blocker_summary AS (
  SELECT album_id,json_group_array(blocker) AS blockers_json
  FROM (SELECT album_id,blocker FROM blocker_rows ORDER BY album_id,blocker)
  GROUP BY album_id
),
facts AS MATERIALIZED (
  SELECT t.album_id,t.project_id,t.state,t.revision,t.created_at,t.published_at_ms,
    h.viewed_at_ms AS last_valid_viewed_at_ms,h.verified AS human_frontier_verified,
    t.policy_present,t.policy_revision,t.inactive_days,t.cleanup_allowed,
    COALESCE(a.bytes,0) AS bytes,COALESCE(a.asset_count,0) AS asset_count,
    COALESCE(v.version_count,0) AS version_count,
    s.latest_expires_at_ms AS latest_active_custom_share_expires_at_ms,
    COALESCE(s.share_count,0) AS active_custom_share_count,
    COALESCE(b.blockers_json,'[]') AS blockers_json
  FROM target t
  LEFT JOIN asset_summary a ON a.album_id=t.album_id
  LEFT JOIN version_summary v ON v.album_id=t.album_id
  LEFT JOIN human_frontiers h ON h.album_id=t.album_id
  LEFT JOIN share_summary s ON s.album_id=t.album_id
  LEFT JOIN blocker_summary b ON b.album_id=t.album_id
)
SELECT s.owner_authorized,s.workspace_exists,s.workspace_authorized,s.observed_at_ms,
  (SELECT count(*) FROM target) AS album_count,
  (SELECT count(*) FROM asset_rows) AS asset_source_count,
  (SELECT count(*) FROM version_rows) AS version_source_count,
  CASE WHEN (SELECT count(*) FROM target)>100 THEN NULL
    ELSE COALESCE((SELECT json_group_array(json_object(
      'workspaceId',?3,'albumId',f.album_id,'projectId',f.project_id,'state',f.state,'revision',f.revision,
      'policyRevision',f.policy_revision,
      'createdAt',f.created_at,'publishedAtMs',f.published_at_ms,
      'lastValidViewedAtMs',f.last_valid_viewed_at_ms,
      'humanFrontierVerified',f.human_frontier_verified,'policyPresent',f.policy_present,
      'inactiveDays',f.inactive_days,'cleanupAllowed',f.cleanup_allowed,
      'bytes',f.bytes,'assetCount',f.asset_count,'versionCount',f.version_count,
      'latestActiveCustomShareExpiresAtMs',f.latest_active_custom_share_expires_at_ms,
      'activeCustomShareCount',f.active_custom_share_count,
      'blockers',json(f.blockers_json)
    )) FROM facts f),'[]') END AS albums_json
FROM scope s`;

const unavailable = () =>
  new WorkspaceFailure('RETENTION_FACTS_UNAVAILABLE', 503);

function toIso(value: number | null): string | null {
  if (value === null) return null;
  if (value > 8_640_000_000_000_000) throw unavailable();
  const result = new Date(value).toISOString();
  return result;
}

function parseCreatedAt(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || new Date(parsed).toISOString() !== value)
    throw unavailable();
  return value;
}

/** Read schema69 retention source facts for an authenticated workspace Owner. */
export class D1RetentionAlbumFacts {
  constructor(
    private readonly db: D1Database,
    private readonly actor: string,
    private readonly session: string,
  ) {}

  async read(workspaceId: string): Promise<RetentionAlbumFactsSnapshot> {
    const parsedWorkspace = UUID.safeParse(workspaceId);
    if (!parsedWorkspace.success)
      throw new WorkspaceFailure('INVALID_INPUT', 400);
    const workspace = parsedWorkspace.data.toLowerCase();
    try {
      const [result] = await this.db.batch([
        this.db.prepare(sql).bind(this.actor, this.session, workspace),
      ]);
      if (!result?.success || !Array.isArray(result.results))
        throw unavailable();
      const meta = resultSchema.safeParse(result.results[0]);
      if (!meta.success) throw unavailable();
      if (meta.data.owner_authorized !== 1)
        throw new WorkspaceFailure('OWNER_REQUIRED', 403);
      if (
        meta.data.workspace_exists !== 1 ||
        meta.data.workspace_authorized !== 1
      )
        throw new WorkspaceFailure('NOT_FOUND', 404);
      if (
        meta.data.album_count > MAX_ALBUMS ||
        meta.data.asset_source_count > MAX_SOURCE_ROWS ||
        meta.data.version_source_count > MAX_SOURCE_ROWS ||
        meta.data.albums_json === null
      )
        throw new WorkspaceFailure('RETENTION_FACTS_LIMIT', 503);
      const rawAlbums: unknown = JSON.parse(meta.data.albums_json);
      const parsedAlbums = z
        .array(rowSchema)
        .max(MAX_ALBUMS)
        .safeParse(rawAlbums);
      if (
        !parsedAlbums.success ||
        parsedAlbums.data.length !== meta.data.album_count
      )
        throw unavailable();
      const observedAt = toIso(meta.data.observed_at_ms)!;
      const observedAtMs = Date.parse(observedAt);
      const ids = new Set<string>();
      let assetCount = 0;
      let versionCount = 0;
      const albums = parsedAlbums.data.map((row): RetentionAlbumFact => {
        if (
          row.workspaceId !== workspace ||
          ids.has(row.albumId) ||
          row.humanFrontierVerified !== 1 ||
          row.policyPresent !== 1 ||
          row.inactiveDays === null ||
          row.cleanupAllowed === null
        )
          throw unavailable();
        ids.add(row.albumId);
        assetCount += row.assetCount;
        versionCount += row.versionCount;
        const createdAt = parseCreatedAt(row.createdAt);
        if (
          Date.parse(createdAt) > observedAtMs ||
          (row.publishedAtMs !== null &&
            row.publishedAtMs > meta.data.observed_at_ms) ||
          (row.lastValidViewedAtMs !== null &&
            row.lastValidViewedAtMs > meta.data.observed_at_ms) ||
          (row.activeCustomShareCount === 0 &&
            row.latestActiveCustomShareExpiresAtMs !== null) ||
          (row.activeCustomShareCount > 0 &&
            (row.latestActiveCustomShareExpiresAtMs === null ||
              row.latestActiveCustomShareExpiresAtMs <=
                meta.data.observed_at_ms))
        )
          throw unavailable();
        return {
          workspaceId: row.workspaceId,
          albumId: row.albumId,
          projectId: row.projectId,
          state: row.state,
          revision: row.revision,
          policyRevision: row.policyRevision,
          createdAt,
          publishedAt: toIso(row.publishedAtMs),
          lastValidViewedAt: toIso(row.lastValidViewedAtMs),
          inactiveDays: row.inactiveDays,
          cleanupAllowed: row.cleanupAllowed === 1,
          bytes: row.bytes,
          assetCount: row.assetCount,
          versionCount: row.versionCount,
          latestActiveCustomShareExpiresAt: toIso(
            row.latestActiveCustomShareExpiresAtMs,
          ),
          activeCustomShareCount: row.activeCustomShareCount,
          blockers: row.blockers,
        };
      });
      if (
        assetCount !== meta.data.asset_source_count ||
        versionCount !== meta.data.version_source_count
      )
        throw unavailable();
      return {
        workspaceId: workspace,
        observedAt,
        albums,
      };
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      throw unavailable();
    }
  }
}
