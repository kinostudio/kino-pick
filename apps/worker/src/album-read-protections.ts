import { z } from 'zod';
import { albumReadProtectionCapability, type WorkerEnv } from './config';
import { WorkspaceFailure } from './workspaces';
import {
  captureAssetStreamDeadline,
  type AssetStreamDeadline,
} from './bounded-asset-stream';

const TTL_MS = 900_000;
const RENEW_BELOW_MS = 840_000;
const MUTATION_INTERVAL_MS = 60_000;
// shortcut: 1s between batch clock checks; slower batches fail closed.
const MIN_REMAINING_MS = 839_000;
const MAX_REVISION = 2_147_483_647;

const albumReadScopeSchema = z
  .object({
    workspace_id: z.uuid(),
    project_id: z.uuid(),
    album_id: z.uuid(),
  })
  .strict();

const UPDATE_SQL = `
  UPDATE album_read_protections
  SET renewed_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER),
      protected_until_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)+${TTL_MS},
      revision=revision+1
  WHERE album_id=? AND workspace_id=? AND project_id=?
    AND renewed_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER)-${MUTATION_INTERVAL_MS}
    AND protected_until_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER)+${RENEW_BELOW_MS}
    AND revision<2147483647
    AND EXISTS(
      SELECT 1 FROM albums a JOIN projects p
        ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      WHERE a.id=? AND a.workspace_id=? AND a.project_id=?
        AND a.state NOT IN('deleting','deleted')
        AND p.status NOT IN('deleting','deleted')
        AND NOT EXISTS(
          SELECT 1 FROM manual_album_deletion_jobs j
          WHERE j.album_id=a.id AND j.status='deleting'
        )
    )
`;

const INSERT_SQL = `
  INSERT INTO album_read_protections(
    album_id,workspace_id,project_id,renewed_at_ms,protected_until_ms,revision
  )
  SELECT ?,?,?,clock.now_ms,clock.now_ms+${TTL_MS},0
  FROM (SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms) clock
  WHERE NOT EXISTS(
    SELECT 1 FROM album_read_protections WHERE album_id=?
  )
    AND EXISTS(
      SELECT 1 FROM albums a JOIN projects p
        ON p.id=a.project_id AND p.workspace_id=a.workspace_id
      WHERE a.id=? AND a.workspace_id=? AND a.project_id=?
        AND a.state NOT IN('deleting','deleted')
        AND p.status NOT IN('deleting','deleted')
        AND NOT EXISTS(
          SELECT 1 FROM manual_album_deletion_jobs j
          WHERE j.album_id=a.id AND j.status='deleting'
        )
    )
`;

const SELECT_SQL = `
  SELECT r.album_id,r.workspace_id,r.project_id,r.renewed_at_ms,
         r.protected_until_ms,r.revision,
         CAST(unixepoch('subsec')*1000 AS INTEGER) AS db_now_ms,
         EXISTS(
           SELECT 1 FROM albums a JOIN projects p
             ON p.id=a.project_id AND p.workspace_id=a.workspace_id
           WHERE a.id=r.album_id AND a.workspace_id=r.workspace_id
             AND a.project_id=r.project_id
             AND a.state NOT IN('deleting','deleted')
             AND p.status NOT IN('deleting','deleted')
             AND NOT EXISTS(
               SELECT 1 FROM manual_album_deletion_jobs j
               WHERE j.album_id=a.id AND j.status='deleting'
             )
         ) AS scope_valid
  FROM album_read_protections r WHERE r.album_id=?
`;

const OBSERVE_SQL = `
  WITH clock AS (
    SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS db_now_ms
  )
  SELECT a.id AS album_id,a.workspace_id,a.project_id,clock.db_now_ms,
         r.album_id AS protection_album_id,
         r.workspace_id AS protection_workspace_id,
         r.project_id AS protection_project_id,
         r.renewed_at_ms,r.protected_until_ms,r.revision
  FROM clock
  CROSS JOIN albums a
  JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id
  JOIN workspaces w ON w.id=a.workspace_id
  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>clock.db_now_ms
  LEFT JOIN album_read_protections r
    ON r.album_id=a.id
  WHERE a.id=? AND a.workspace_id=? AND a.project_id=? AND o.user_id=?
    AND a.state NOT IN('deleting','deleted')
    AND p.status NOT IN('deleting','deleted')
    AND NOT EXISTS(
      SELECT 1 FROM manual_album_deletion_jobs j
      WHERE j.album_id=a.id AND j.status='deleting'
    )
`;

export type AlbumReadScope = {
  workspace_id: string;
  project_id: string;
  album_id: string;
};

type ProtectionRow = {
  album_id: unknown;
  workspace_id: unknown;
  project_id: unknown;
  renewed_at_ms: unknown;
  protected_until_ms: unknown;
  revision: unknown;
  db_now_ms: unknown;
  scope_valid: unknown;
};

type ObservationRow = {
  album_id: unknown;
  workspace_id: unknown;
  project_id: unknown;
  db_now_ms: unknown;
  protection_album_id: unknown;
  protection_workspace_id: unknown;
  protection_project_id: unknown;
  renewed_at_ms: unknown;
  protected_until_ms: unknown;
  revision: unknown;
};

function unavailable(): never {
  throw new WorkspaceFailure('ALBUM_READ_PROTECTION_UNAVAILABLE', 503);
}

function parseScope(value: unknown): AlbumReadScope {
  const result = albumReadScopeSchema.safeParse(value);
  if (!result.success) return unavailable();
  return result.data;
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function parseProtection(
  value: unknown,
  scope: AlbumReadScope,
): { protectedUntilMs: number; revision: number } {
  if (!value || typeof value !== 'object') return unavailable();
  const row = value as ProtectionRow;
  if (
    row.album_id !== scope.album_id ||
    row.workspace_id !== scope.workspace_id ||
    row.project_id !== scope.project_id ||
    row.scope_valid !== 1 ||
    !safeInteger(row.renewed_at_ms) ||
    !safeInteger(row.protected_until_ms) ||
    !safeInteger(row.revision) ||
    !safeInteger(row.db_now_ms) ||
    row.renewed_at_ms < 0 ||
    row.db_now_ms < 0 ||
    row.renewed_at_ms > row.db_now_ms ||
    row.protected_until_ms !== row.renewed_at_ms + TTL_MS ||
    row.revision < 0 ||
    row.revision > MAX_REVISION ||
    row.protected_until_ms < row.db_now_ms + MIN_REMAINING_MS
  ) {
    return unavailable();
  }
  return { protectedUntilMs: row.protected_until_ms, revision: row.revision };
}

export class D1AlbumReadProtections {
  constructor(private readonly db: D1Database) {}

  async acquire(
    input: AlbumReadScope,
  ): Promise<{ protectedUntilMs: number; revision: number }> {
    const scope = parseScope(input);
    if (
      !this.db ||
      typeof this.db.prepare !== 'function' ||
      typeof this.db.batch !== 'function'
    ) {
      return unavailable();
    }

    try {
      const results = await this.db.batch([
        this.db
          .prepare(UPDATE_SQL)
          .bind(
            scope.album_id,
            scope.workspace_id,
            scope.project_id,
            scope.album_id,
            scope.workspace_id,
            scope.project_id,
          ),
        this.db
          .prepare(INSERT_SQL)
          .bind(
            scope.album_id,
            scope.workspace_id,
            scope.project_id,
            scope.album_id,
            scope.album_id,
            scope.workspace_id,
            scope.project_id,
          ),
        this.db.prepare(SELECT_SQL).bind(scope.album_id),
      ]);
      if (
        !Array.isArray(results) ||
        results.length !== 3 ||
        results.some((result) => result.success !== true)
      ) {
        return unavailable();
      }
      const row = results[2]?.results?.[0];
      return parseProtection(row, scope);
    } catch {
      return unavailable();
    }
  }

  async observe(
    input: AlbumReadScope,
    actorInput: string,
    sessionInput: string,
  ): Promise<{
    workspaceId: string;
    projectId: string;
    albumId: string;
    observedAt: string;
    possibleActivityThroughAt: string | null;
    revision: number | null;
  }> {
    const scope = parseScope(input);
    const actor = z.string().min(1).max(256).safeParse(actorInput);
    const session = z.string().min(1).max(512).safeParse(sessionInput);
    if (!actor.success || !session.success) return unavailable();
    let row: ObservationRow | null;
    try {
      row = await this.db
        .prepare(OBSERVE_SQL)
        .bind(
          session.data,
          scope.album_id,
          scope.workspace_id,
          scope.project_id,
          actor.data,
        )
        .first<ObservationRow>();
    } catch {
      return unavailable();
    }
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (
      row.album_id !== scope.album_id ||
      row.workspace_id !== scope.workspace_id ||
      row.project_id !== scope.project_id ||
      !safeInteger(row.db_now_ms) ||
      row.db_now_ms < 0 ||
      row.db_now_ms > 8_640_000_000_000_000
    )
      return unavailable();
    const observedAt = new Date(row.db_now_ms).toISOString();
    if (row.protection_album_id === null) {
      if (
        row.protection_workspace_id !== null ||
        row.protection_project_id !== null ||
        row.renewed_at_ms !== null ||
        row.protected_until_ms !== null ||
        row.revision !== null
      )
        return unavailable();
      return {
        workspaceId: scope.workspace_id,
        projectId: scope.project_id,
        albumId: scope.album_id,
        observedAt,
        possibleActivityThroughAt: null,
        revision: null,
      };
    }
    if (
      row.protection_album_id !== scope.album_id ||
      row.protection_workspace_id !== scope.workspace_id ||
      row.protection_project_id !== scope.project_id ||
      !safeInteger(row.renewed_at_ms) ||
      !safeInteger(row.protected_until_ms) ||
      !safeInteger(row.revision) ||
      row.renewed_at_ms < 0 ||
      row.renewed_at_ms > row.db_now_ms ||
      row.protected_until_ms !== row.renewed_at_ms + TTL_MS ||
      row.protected_until_ms > 8_640_000_000_000_000 ||
      row.revision < 0 ||
      row.revision > MAX_REVISION
    )
      return unavailable();
    return {
      workspaceId: scope.workspace_id,
      projectId: scope.project_id,
      albumId: scope.album_id,
      observedAt,
      possibleActivityThroughAt: new Date(row.protected_until_ms).toISOString(),
      revision: row.revision,
    };
  }
}

export async function protectAlbumRead(
  env: WorkerEnv,
  scope: AlbumReadScope,
): Promise<AssetStreamDeadline | null> {
  if (!albumReadProtectionCapability(env)) return null;
  const deadline = captureAssetStreamDeadline();
  await new D1AlbumReadProtections(env.DB).acquire(scope);
  return deadline;
}
