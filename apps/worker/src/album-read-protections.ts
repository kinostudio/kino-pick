import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';

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

type AlbumReadScope = {
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
}
