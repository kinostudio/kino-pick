import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import {
  guestFavoriteRequestSchema,
  guestFavoriteResultSchema,
  guestFavoritePageSchema,
  guestRatingRequestSchema,
  guestRatingResultSchema,
  guestRatingPageSchema,
  guestFeedbackPhotoIdsSchema,
} from '../../../packages/contracts/src/guest-feedback';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const canRateBit = guestPermissionBit('can_rate');
const canFavoriteBit = guestPermissionBit('can_favorite');

type GuestScope = {
  id: string;
  guest_id: string;
  invite_id: string;
  workspace_id: string;
  project_id: string;
};

type FeedbackReadRow = {
  authorizedCount: number;
  requestedCount: number;
  matchedCount: number;
  photoId: string | null;
  matchedPhotoId: string | null;
  position: number | null;
  valueState: number | null;
  versionId: string | null;
  updatedAt: string | null;
};

function feedbackReadSql(
  stateTable: 'guest_rating_state' | 'guest_favorite_state',
  valueColumn: 'stars' | 'favored',
) {
  return [
    'WITH authorized AS (',
    '  SELECT s.id AS session_id,g.id AS guest_id,i.id AS invite_id,',
    '    i.workspace_id AS workspace_id,i.project_id AS project_id,ia.album_id AS album_id',
    '  FROM guest_sessions s',
    '  JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
    '  JOIN guest_invites i ON i.id=s.invite_id',
    '  JOIN guest_invite_seals seal ON seal.invite_id=i.id',
    '  JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id',
    '    AND ia.project_id=i.project_id AND ia.album_id=?',
    '  JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id',
    "    AND a.project_id=i.project_id AND a.state='active'",
    '  JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
    "    AND p.status NOT IN('archived','deleting','deleted')",
    '  JOIN workspaces w ON w.id=i.workspace_id',
    '  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
    '  WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
    "    AND s.expires_at_ms>unixepoch('subsec')*1000",
    "    AND i.expires_at_ms>unixepoch('subsec')*1000",
    '    AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)',
    '    AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)',
    '), requested AS (',
    '  SELECT CAST(key AS INTEGER) AS position,CAST(value AS TEXT) AS photo_id',
    '  FROM json_each(?)',
    '), state_rows AS (',
    '  SELECT r.position,r.photo_id,p.id AS matched_photo_id,',
    '    st.' +
      valueColumn +
      ' AS value_state,st.last_version_id AS version_id,',
    '    CASE WHEN st.photo_id IS NULL THEN NULL',
    "      ELSE strftime('%Y-%m-%dT%H:%M:%fZ',st.updated_at_ms/1000.0,'unixepoch') END AS updated_at",
    '  FROM requested r CROSS JOIN authorized a',
    '  LEFT JOIN photos p ON p.id=r.photo_id AND p.workspace_id=a.workspace_id',
    '    AND p.project_id=a.project_id AND p.album_id=a.album_id',
    '  LEFT JOIN ' + stateTable + ' st ON st.invite_id=a.invite_id',
    '    AND st.guest_id=a.guest_id AND st.album_id=a.album_id AND st.photo_id=p.id',
    '), summary AS (',
    '  SELECT (SELECT count(*) FROM authorized) AS authorized_count,',
    '    (SELECT count(*) FROM requested) AS requested_count,',
    '    (SELECT count(*) FROM state_rows WHERE matched_photo_id IS NOT NULL) AS matched_count',
    ')',
    'SELECT summary.authorized_count AS authorizedCount,',
    '  summary.requested_count AS requestedCount,summary.matched_count AS matchedCount,',
    '  state_rows.photo_id AS photoId,state_rows.matched_photo_id AS matchedPhotoId,',
    '  state_rows.position AS position,state_rows.value_state AS valueState,',
    '  state_rows.version_id AS versionId,state_rows.updated_at AS updatedAt',
    'FROM summary LEFT JOIN state_rows ON 1=1 ORDER BY state_rows.position',
  ].join('\n');
}

export class D1GuestFeedbackRepository {
  constructor(private db: D1Database) {}

  async setRating(
    secret: string | null,
    albumId: string,
    photoId: string,
    input: unknown,
  ) {
    const album = zUuid(albumId);
    const photo = zUuid(photoId);
    const request = guestRatingRequestSchema.parse(input);
    const result = await this.set(
      secret,
      album,
      photo,
      request.requestId,
      request.versionId,
      'rating',
      request.stars,
      JSON.stringify({ versionId: request.versionId, stars: request.stars }),
      canRateBit,
    );
    return guestRatingResultSchema.parse(result);
  }

  async setFavorite(
    secret: string | null,
    albumId: string,
    photoId: string,
    input: unknown,
  ) {
    const album = zUuid(albumId);
    const photo = zUuid(photoId);
    const request = guestFavoriteRequestSchema.parse(input);
    const result = await this.set(
      secret,
      album,
      photo,
      request.requestId,
      request.versionId,
      'favorite',
      request.favored ? 1 : 0,
      JSON.stringify({
        versionId: request.versionId,
        favored: request.favored,
      }),
      canFavoriteBit,
    );
    return guestFavoriteResultSchema.parse(result);
  }

  async readRatings(
    secret: string | null,
    albumId: string,
    photoIdsInput: string[],
  ) {
    const album = zUuid(albumId);
    const photoIds = guestFeedbackPhotoIdsSchema.parse(photoIdsInput);
    const rows = await this.read(
      secret,
      album,
      photoIds,
      'guest_rating_state',
      'stars',
      canRateBit,
    );
    const summary = rows[0];
    if (
      !summary ||
      summary.authorizedCount !== 1 ||
      summary.requestedCount !== photoIds.length ||
      summary.matchedCount !== photoIds.length
    )
      throw new GuestAccessDenied();
    const items = rows
      .filter((row) => row.matchedPhotoId !== null)
      .map((row) => ({
        photoId: row.photoId,
        stars: row.valueState,
        versionId: row.versionId,
        updatedAt: row.updatedAt,
      }));
    return guestRatingPageSchema.parse({ items });
  }

  async readFavorites(
    secret: string | null,
    albumId: string,
    photoIdsInput: string[],
  ) {
    const album = zUuid(albumId);
    const photoIds = guestFeedbackPhotoIdsSchema.parse(photoIdsInput);
    const rows = await this.read(
      secret,
      album,
      photoIds,
      'guest_favorite_state',
      'favored',
      canFavoriteBit,
    );
    const summary = rows[0];
    if (
      !summary ||
      summary.authorizedCount !== 1 ||
      summary.requestedCount !== photoIds.length ||
      summary.matchedCount !== photoIds.length
    )
      throw new GuestAccessDenied();
    const items = rows
      .filter((row) => row.matchedPhotoId !== null)
      .map((row) => ({
        photoId: row.photoId,
        favored: row.valueState === 1,
        versionId: row.versionId,
        updatedAt: row.updatedAt,
      }));
    return guestFavoritePageSchema.parse({ items });
  }

  private async set(
    secret: string | null,
    albumId: string,
    photoId: string,
    requestId: string,
    versionId: string,
    kind: 'rating' | 'favorite',
    value: number | null,
    payload: string,
    permissionBit: number,
  ): Promise<unknown> {
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const session = await this.db
      .prepare(
        'SELECT s.id,s.guest_id,s.invite_id,i.workspace_id,i.project_id ' +
          'FROM guest_sessions s JOIN guest_invites i ON i.id=s.invite_id ' +
          'WHERE s.secret_hash=?',
      )
      .bind(secretHash)
      .first<GuestScope>();
    if (!session) throw new GuestAccessDenied();

    try {
      await this.db
        .prepare(
          [
            'INSERT OR IGNORE INTO guest_feedback_commands(',
            'id,guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,',
            'album_id,photo_id,version_id,kind,value_integer,payload_json',
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ].join(' '),
        )
        .bind(
          crypto.randomUUID(),
          session.guest_id,
          session.invite_id,
          session.id,
          secretHash,
          requestId,
          session.workspace_id,
          session.project_id,
          albumId,
          photoId,
          versionId,
          kind,
          value,
          payload,
        )
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('GUEST_ACCESS_REQUIRED'))
        throw new GuestAccessDenied();
      if (message.includes('REQUEST_ID_CONFLICT'))
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (message.includes('INVALID_TIMESTAMP'))
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      throw new WorkspaceFailure('GUEST_FEEDBACK_UNAVAILABLE', 503);
    }

    const result = await this.db
      .prepare(
        [
          'SELECT r.result_json',
          'FROM guest_feedback_commands c',
          'JOIN guest_feedback_results r ON r.command_id=c.id AND r.kind=c.kind',
          'JOIN guest_sessions s ON s.id=? AND s.guest_id=c.guest_id',
          '  AND s.invite_id=c.invite_id AND s.secret_hash=?',
          '  AND c.session_id=s.id AND c.secret_hash=s.secret_hash',
          'JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
          'JOIN guest_invites i ON i.id=c.invite_id AND i.workspace_id=c.workspace_id',
          '  AND i.project_id=c.project_id',
          'JOIN guest_invite_seals seal ON seal.invite_id=i.id',
          'JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=c.workspace_id',
          '  AND ia.project_id=c.project_id AND ia.album_id=c.album_id',
          'JOIN albums a ON a.id=c.album_id AND a.workspace_id=c.workspace_id',
          "  AND a.project_id=c.project_id AND a.state='active'",
          'JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id',
          "  AND p.status NOT IN('archived','deleting','deleted')",
          'JOIN workspaces w ON w.id=c.workspace_id',
          'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
          'JOIN photos ph ON ph.id=c.photo_id AND ph.workspace_id=c.workspace_id',
          '  AND ph.project_id=c.project_id AND ph.album_id=c.album_id',
          'JOIN photo_versions v ON v.id=c.version_id AND v.workspace_id=c.workspace_id',
          '  AND v.photo_id=c.photo_id',
          'WHERE c.guest_id=? AND c.request_id=? AND c.workspace_id=? AND c.project_id=?',
          '  AND c.album_id=? AND c.photo_id=? AND c.version_id=? AND c.kind=?',
          '  AND c.value_integer IS ? AND c.payload_json=?',
          "  AND (i.permissions_mask & ?)=? AND s.expires_at_ms>unixepoch('subsec')*1000",
          "  AND i.expires_at_ms>unixepoch('subsec')*1000",
          '  AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations ir WHERE ir.invite_id=i.id)',
          '  AND NOT EXISTS(SELECT 1 FROM guest_session_revocations sr WHERE sr.session_id=s.id)',
        ].join(' '),
      )
      .bind(
        session.id,
        secretHash,
        session.guest_id,
        requestId,
        session.workspace_id,
        session.project_id,
        albumId,
        photoId,
        versionId,
        kind,
        value,
        payload,
        permissionBit,
        permissionBit,
      )
      .first<{ result_json: string }>();
    if (!result) throw new GuestAccessDenied();
    try {
      return JSON.parse(result.result_json) as unknown;
    } catch {
      throw new WorkspaceFailure('GUEST_FEEDBACK_UNAVAILABLE', 503);
    }
  }

  private async read(
    secret: string | null,
    albumId: string,
    photoIds: string[],
    stateTable: 'guest_rating_state' | 'guest_favorite_state',
    valueColumn: 'stars' | 'favored',
    permissionBit: number,
  ): Promise<FeedbackReadRow[]> {
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const rows = await this.db
      .prepare(feedbackReadSql(stateTable, valueColumn))
      .bind(
        albumId,
        secretHash,
        permissionBit,
        permissionBit,
        JSON.stringify(photoIds),
      )
      .all<FeedbackReadRow>();
    return rows.results;
  }
}

function zUuid(value: string) {
  return z.uuid().parse(value);
}
