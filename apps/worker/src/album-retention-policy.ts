import { z } from 'zod';
import {
  albumRetentionPolicySchema,
  albumRetentionShareProtectionSchema,
  updateAlbumRetentionPolicySchema,
} from '../../../packages/contracts/src/album-retention-policy';
import { WorkspaceFailure } from './workspaces';

type AlbumScope = {
  albumId: string;
  workspaceId: string;
  projectId: string;
  albumState: string;
  projectStatus: string;
};
type PolicyRow = {
  album_id: string;
  workspace_id: string;
  project_id: string;
  inactive_days: number;
  cleanup_allowed: number;
  revision: number;
};

function failure(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  const known: Array<[string, string, 400 | 403 | 404 | 409 | 503]> = [
    ['OWNER_REQUIRED', 'OWNER_REQUIRED', 403],
    ['NOT_FOUND', 'NOT_FOUND', 404],
    [
      'ALBUM_RETENTION_POLICY_REVISION_CONFLICT',
      'ALBUM_RETENTION_POLICY_REVISION_CONFLICT',
      409,
    ],
    [
      'ALBUM_RETENTION_POLICY_REVISION_EXHAUSTED',
      'ALBUM_RETENTION_POLICY_REVISION_EXHAUSTED',
      409,
    ],
    ['REQUEST_ID_CONFLICT', 'REQUEST_ID_CONFLICT', 409],
    ['RESOURCE_NOT_EDITABLE', 'RESOURCE_NOT_EDITABLE', 409],
    [
      'ALBUM_RETENTION_POLICY_CONFIGURATION_UNAVAILABLE',
      'ALBUM_RETENTION_POLICY_UNAVAILABLE',
      503,
    ],
    ['INVALID_TIMESTAMP', 'INVALID_INPUT', 400],
  ];
  for (const [needle, code, status] of known)
    if (message.includes(needle)) throw new WorkspaceFailure(code, status);
  throw new WorkspaceFailure('ALBUM_RETENTION_POLICY_UNAVAILABLE', 503);
}

function asPolicy(row: PolicyRow) {
  return albumRetentionPolicySchema.parse({
    albumId: row.album_id,
    revision: row.revision,
    cleanupAllowed: row.cleanup_allowed === 1,
    inactiveDays: row.inactive_days,
    automaticDeletionEnabled: false,
    dryRun: true,
  });
}

export class D1AlbumRetentionPolicyRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: string,
    private readonly session: string,
  ) {}

  private async assertCurrentOwner() {
    const row = await this.db
      .prepare(
        'SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id ' +
          "AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 " +
          'WHERE o.user_id=? AND o.enabled=1',
      )
      .bind(this.session, this.actor)
      .first();
    if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  private async album(albumId: string): Promise<AlbumScope> {
    const album = z.uuid().parse(albumId).toLowerCase();
    const row = await this.db
      .prepare(
        'SELECT a.id AS albumId,a.workspace_id AS workspaceId,a.project_id AS projectId,' +
          'a.state AS albumState,p.status AS projectStatus ' +
          'FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.owner_user_id=o.user_id ' +
          'JOIN albums a ON a.workspace_id=w.id ' +
          'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id ' +
          'WHERE o.user_id=? AND o.enabled=1 AND a.id=?',
      )
      .bind(this.session, this.actor, album)
      .first<AlbumScope>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    return row;
  }

  private async read(albumId: string): Promise<PolicyRow> {
    const row = await this.db
      .prepare(
        'SELECT effective.album_id,effective.workspace_id,effective.project_id,' +
          'effective.inactive_days,effective.cleanup_allowed,effective.revision ' +
          'FROM effective_album_retention_policy effective ' +
          'JOIN owners o ON o.enabled=1 AND o.user_id=? ' +
          'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.id=effective.workspace_id AND w.owner_user_id=o.user_id ' +
          'WHERE effective.album_id=?',
      )
      .bind(this.actor, this.session, albumId)
      .first<PolicyRow>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    return row;
  }

  async get(albumId: string) {
    const album = z.uuid().parse(albumId).toLowerCase();
    try {
      return asPolicy(await this.read(album));
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      return failure(error);
    }
  }

  async shareProtection(albumId: string) {
    const album = z.uuid().parse(albumId).toLowerCase();
    try {
      const scope = await this.album(album);
      // A link protects its album until expiry even before its first visit or after maxUses is reached.
      const row = await this.db
        .prepare(
          "WITH clock AS (SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS now_ms) " +
            'SELECT clock.now_ms,count(i.id) AS active_count,max(i.expires_at_ms) AS latest_expiry_ms ' +
            'FROM clock LEFT JOIN guest_invite_albums ia ON ia.album_id=?1 ' +
            'AND ia.workspace_id=?2 AND ia.project_id=?3 ' +
            'LEFT JOIN guest_invites i ON i.id=ia.invite_id AND i.workspace_id=?2 AND i.project_id=?3 ' +
            "AND i.expiry_mode='custom' AND i.expires_at_ms>clock.now_ms " +
            'AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id) ' +
            'GROUP BY clock.now_ms',
        )
        .bind(scope.albumId, scope.workspaceId, scope.projectId)
        .first<{
          now_ms: number;
          active_count: number;
          latest_expiry_ms: number | null;
        }>();
      if (!row)
        throw new WorkspaceFailure('ALBUM_RETENTION_POLICY_UNAVAILABLE', 503);
      await this.assertCurrentOwner();
      return albumRetentionShareProtectionSchema.parse({
        albumId: scope.albumId,
        evaluatedAt: new Date(row.now_ms).toISOString(),
        latestActiveCustomShareExpiresAt:
          row.latest_expiry_ms === null
            ? null
            : new Date(row.latest_expiry_ms).toISOString(),
        activeCustomShareCount: row.active_count,
        shareEvidenceVerified: true,
        automaticDeletionEnabled: false,
        dryRun: true,
      });
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      return failure(error);
    }
  }

  async set(albumId: string, input: unknown) {
    const album = z.uuid().parse(albumId).toLowerCase();
    const request = updateAlbumRetentionPolicySchema.parse(input);
    if (request.expectedOwnerId.toLowerCase() !== this.actor.toLowerCase())
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);

    try {
      const scope = await this.album(album);
      if (
        ['deleting', 'deleted'].includes(scope.albumState) ||
        ['deleting', 'deleted'].includes(scope.projectStatus)
      )
        throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);

      const payload = JSON.stringify({
        requestId: request.requestId.toLowerCase(),
        expectedOwnerId: request.expectedOwnerId.toLowerCase(),
        expectedRevision: request.expectedRevision,
        cleanupAllowed: request.cleanupAllowed,
        inactiveDays: request.inactiveDays,
      });
      await this.db
        .prepare(
          'INSERT OR IGNORE INTO album_retention_policy_commands(' +
            'id,actor_id,session_id,request_id,expected_owner_id,workspace_id,project_id,album_id,' +
            'expected_revision,inactive_days,cleanup_allowed,payload_json,created_at_ms' +
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          this.actor,
          this.session,
          request.requestId.toLowerCase(),
          request.expectedOwnerId.toLowerCase(),
          scope.workspaceId,
          scope.projectId,
          album,
          request.expectedRevision,
          request.inactiveDays,
          request.cleanupAllowed ? 1 : 0,
          payload,
          Date.now(),
        )
        .run();

      const row = await this.db
        .prepare(
          'SELECT r.result_json FROM album_retention_policy_commands c ' +
            'JOIN album_retention_policy_results r ON r.command_id=c.id ' +
            'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 ' +
            'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
            "AND s.expiresAt>unixepoch('subsec')*1000 " +
            'JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id ' +
            'JOIN albums a ON a.id=c.album_id AND a.workspace_id=w.id AND a.project_id=c.project_id ' +
            'WHERE c.actor_id=? AND c.request_id=? AND c.album_id=? AND c.payload_json=?',
        )
        .bind(
          this.session,
          this.actor,
          request.requestId.toLowerCase(),
          album,
          payload,
        )
        .first<{ result_json: string }>();
      if (!row) {
        const prior = await this.db
          .prepare(
            'SELECT 1 FROM album_retention_policy_commands WHERE actor_id=? AND request_id=?',
          )
          .bind(this.actor, request.requestId.toLowerCase())
          .first();
        if (prior) throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
        throw new WorkspaceFailure('ALBUM_RETENTION_POLICY_UNAVAILABLE', 503);
      }
      return albumRetentionPolicySchema.parse(
        JSON.parse(row.result_json) as unknown,
      );
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      return failure(error);
    }
  }
}
