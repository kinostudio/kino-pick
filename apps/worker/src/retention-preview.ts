import { z } from 'zod';
import {
  defaultRetentionPolicy,
  planRetention,
  type RetentionAlbumEvidence,
  type RetentionPolicy,
} from '../../../packages/domain/src/retention';
import { WorkspaceFailure } from './workspaces';

// Read-only retention dry run. Nothing here deletes, schedules or persists
// anything: automatic cleanup stays OFF, and the plan is always dryRun.
export const DEFAULT_IDLE_DAYS = 90;
export const MIN_IDLE_DAYS = 7;
export const MAX_IDLE_DAYS = 3650;
const ALBUM_LIMIT = 500;

const idleDaysSchema = z.coerce
  .number()
  .int()
  .min(MIN_IDLE_DAYS)
  .max(MAX_IDLE_DAYS);
const uuidSchema = z.uuid();

type AlbumRow = {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  state: RetentionAlbumEvidence['state'];
  is_pinned: number;
  legal_hold: number;
  bytes: number;
  asset_count: number;
  version_count: number;
  last_viewed_ms: number | null;
  blockers: string | null;
  album_days: number | null;
  cleanup_enabled: number | null;
  settings_revision: number | null;
  custom_link_active: number;
};
type WorkspaceRow = { quota_bytes: number };
type UsageRow = { used: number; reserved: number };

/** undefined means "use each album's own setting" (default 90 days). */
export function parseIdleDays(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const parsed = idleDaysSchema.safeParse(raw);
  if (!parsed.success) throw new WorkspaceFailure('INVALID_INPUT', 400);
  return parsed.data;
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}

export async function retentionPreview(
  db: D1Database,
  ownerId: string,
  workspaceId: string,
  idleDays: number | null,
  nowMs: number = Date.now(),
) {
  const parsedWorkspace = uuidSchema.safeParse(workspaceId);
  if (!parsedWorkspace.success)
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  const workspace = await db
    .prepare(
      'SELECT quota_bytes FROM workspaces WHERE id=? AND owner_user_id=?',
    )
    .bind(parsedWorkspace.data, ownerId)
    .first<WorkspaceRow>();
  if (!workspace) throw new WorkspaceFailure('NOT_FOUND', 404);
  const albums = await db
    .prepare(
      // One pass per workspace for every aggregate. The previous per-album
      // correlated subqueries re-evaluated the global blocker view for each
      // album and read ~77k rows per call, exhausting the D1 daily read quota.
      `WITH ws_albums AS (
         SELECT a.id,a.project_id,a.name,a.created_at,a.state,a.is_pinned,a.legal_hold
         FROM albums a WHERE a.workspace_id=? ORDER BY a.created_at,a.id LIMIT ?),
       live AS (
         SELECT p.album_id,x.id,x.version_id,x.byte_size
         FROM photos p JOIN photo_assets x ON x.photo_id=p.id AND x.workspace_id=p.workspace_id
         WHERE p.workspace_id=? AND p.album_id IN (SELECT id FROM ws_albums)
           AND NOT EXISTS(SELECT 1 FROM manual_album_deletion_items i WHERE i.asset_id=x.id AND i.status='reclaimed')),
       sizes AS (
         SELECT album_id,sum(byte_size) AS bytes,count(DISTINCT id) AS asset_count,count(DISTINCT version_id) AS version_count
         FROM live GROUP BY album_id),
       blocks AS MATERIALIZED (
         SELECT b.album_id,group_concat(DISTINCT b.blocker) AS blockers
         FROM manual_album_deletion_blockers b WHERE b.album_id IN (SELECT id FROM ws_albums) GROUP BY b.album_id),
       links AS (
         SELECT DISTINCT ia.album_id FROM guest_invites i JOIN guest_invite_albums ia ON ia.invite_id=i.id
           LEFT JOIN invite_expiry_modes m ON m.invite_id=i.id
         WHERE i.workspace_id=? AND i.expires_at_ms>? AND COALESCE(m.mode,'custom')='custom'
           AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id))
       SELECT a.id,a.project_id,a.name,a.created_at,a.state,a.is_pinned,a.legal_hold,
         COALESCE(z.bytes,0) AS bytes,COALESCE(z.asset_count,0) AS asset_count,COALESCE(z.version_count,0) AS version_count,
         h.last_valid_viewed_at_ms AS last_viewed_ms,b.blockers AS blockers,
         s.inactive_days AS album_days,s.cleanup_enabled AS cleanup_enabled,s.revision AS settings_revision,
         (l.album_id IS NOT NULL) AS custom_link_active
       FROM ws_albums a
         LEFT JOIN sizes z ON z.album_id=a.id
         LEFT JOIN blocks b ON b.album_id=a.id
         LEFT JOIN links l ON l.album_id=a.id
         LEFT JOIN album_human_activity h ON h.album_id=a.id
         LEFT JOIN album_retention_settings s ON s.album_id=a.id
       ORDER BY a.created_at,a.id`,
    )
    .bind(
      parsedWorkspace.data,
      ALBUM_LIMIT + 1,
      parsedWorkspace.data,
      parsedWorkspace.data,
      nowMs,
    )
    .all<AlbumRow>();
  // Same ledger as quota admission and manual deletion (reclaimed bytes are
  // subtracted there), so deleted albums no longer count as used space.
  const usage = await db
    .prepare(
      `SELECT u.used_bytes AS used,
         u.reserved_bytes + COALESCE((SELECT sum(c.pending_bytes) FROM storage_pending_derivative_capacity c WHERE c.workspace_id=u.workspace_id),0) AS reserved
       FROM workspace_storage_usage u WHERE u.workspace_id=?`,
    )
    .bind(parsedWorkspace.data)
    .first<UsageRow>();
  if (!usage)
    throw new WorkspaceFailure('RETENTION_INVENTORY_UNAVAILABLE', 503);

  const rows = albums.results.slice(0, ALBUM_LIMIT);
  const inventoryComplete = albums.results.length <= ALBUM_LIMIT;
  const blockersByAlbum = new Map<string, string[]>();
  const evidence: RetentionAlbumEvidence[] = rows.map((row) => {
    const blockers = row.blockers ? row.blockers.split(',') : [];
    blockersByAlbum.set(row.id, blockers);
    return {
      workspaceId: parsedWorkspace.data,
      projectId: row.project_id,
      albumId: row.id,
      createdAt: row.created_at,
      publishedAt: null,
      lastValidViewedAt: isoOrNull(row.last_viewed_ms),
      lastStateChangedAt: null,
      bytes: row.bytes,
      assetCount: row.asset_count,
      versionCount: row.version_count,
      cleanupAllowed: true,
      pinned: row.is_pinned === 1 || blockers.includes('DELETE_PROTECTED'),
      legalHold: row.legal_hold === 1,
      projectProtected: false,
      retentionExcluded: false,
      preservationRequested: row.custom_link_active === 1,
      activeUpload: false,
      activeProcessing: false,
      activeDelivery: false,
      workflowBusy:
        blockers.includes('DELETE_CONTENT_BUSY') ||
        blockers.includes('DELETE_ACTIVE_REVIEW'),
      hasBlockingReferences: blockers.includes('DELETE_SHARED_REFERENCE'),
      referencesVerified: true,
      activityEvidenceVerified: true,
      state: row.state,
    };
  });
  // The caller's switch is always OFF; "enabled" below only lets the pure
  // planner list who WOULD qualify. The plan is dryRun and is never executed.
  // Each album uses its own inactive days unless idleDays overrides them; the
  // planner takes one policy, so albums are planned per inactive-days group.
  const daysOf = (row: AlbumRow) =>
    idleDays ?? row.album_days ?? DEFAULT_IDLE_DAYS;
  const groups = new Map<number, RetentionAlbumEvidence[]>();
  rows.forEach((row, index) => {
    const days = daysOf(row);
    const list = groups.get(days) ?? [];
    list.push(evidence[index]!);
    groups.set(days, list);
  });
  const now = new Date(nowMs).toISOString();
  const candidateAlbumIds: string[] = [];
  const excluded: { albumId: string; reasons: readonly string[] }[] = [];
  const blockedReasons = new Set<string>();
  let estimatedBytes = 0;
  let minAlbumAgeDays = defaultRetentionPolicy.minAlbumAgeDays;
  for (const [days, albumsInGroup] of groups) {
    const policy: RetentionPolicy = {
      ...defaultRetentionPolicy,
      enabled: true,
      mode: 'retention_only',
      inactiveDays: days,
    };
    minAlbumAgeDays = policy.minAlbumAgeDays;
    let plan: ReturnType<typeof planRetention>;
    try {
      plan = planRetention({
        workspaceId: parsedWorkspace.data,
        now,
        policy,
        metrics: {
          confirmedBytes: usage.used,
          reservedBytes: usage.reserved,
          quotaBytes: workspace.quota_bytes,
          healthy: true,
          observedAt: now,
        },
        albums: albumsInGroup,
        inventoryComplete,
      });
    } catch (error) {
      if (error instanceof RangeError)
        throw new WorkspaceFailure('RETENTION_INVENTORY_UNAVAILABLE', 503);
      throw error;
    }
    candidateAlbumIds.push(...plan.candidateAlbumIds);
    estimatedBytes += plan.estimatedBytes;
    for (const item of plan.excluded)
      excluded.push({ albumId: item.albumId, reasons: item.reasons });
    for (const reason of plan.blockedReasons) blockedReasons.add(reason);
  }
  return {
    dryRun: true as const,
    autoCleanup: 'off' as const,
    policy: {
      mode: 'retention_only' as const,
      source:
        idleDays === null ? ('album_settings' as const) : ('override' as const),
      inactiveDays: idleDays,
      minAlbumAgeDays,
    },
    metrics: {
      confirmedBytes: usage.used,
      reservedBytes: usage.reserved,
      quotaBytes: workspace.quota_bytes,
    },
    plan: {
      dryRun: true as const,
      candidateAlbumIds,
      estimatedBytes,
      blockedReasons: [...blockedReasons],
      inventoryComplete,
      excluded,
    },
    albums: rows.map((row) => ({
      albumId: row.id,
      name: row.name,
      state: row.state,
      bytes: row.bytes,
      lastValidViewedAt: isoOrNull(row.last_viewed_ms),
      blockers: blockersByAlbum.get(row.id) ?? [],
      inactiveDays: daysOf(row),
      settingsSource:
        row.settings_revision === null
          ? ('default' as const)
          : ('album' as const),
      settingsRevision: row.settings_revision ?? 0,
      cleanupEnabled: row.cleanup_enabled === 1,
      customLinkActive: row.custom_link_active === 1,
    })),
  };
}
