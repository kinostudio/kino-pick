import { z } from 'zod';
import {
  photoDisplayLeaseRequestSchema,
  photoDisplayLeaseResultSchema,
  type PhotoDisplayLeaseRequest,
  type PhotoDisplayLeaseResult,
} from '../../../packages/contracts/src/photo-display-leases';
import { D1AlbumReadProtections } from './album-read-protections';
import { D1GalleryRepository } from './gallery';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { D1GuestGalleryRepository } from './guest-gallery';
import { guestScopeSql } from './human-views';
import { WorkspaceFailure } from './workspaces';

export const PHOTO_DISPLAY_FOR_MS = 600_000;
export const PHOTO_DISPLAY_MARGIN_MS = 60_000;

const uuidSchema = z.uuid();
const ownerSessionSchema = z.string().min(1).max(512);

type AuthorizationSource = {
  actorType: unknown;
  actorId: unknown;
  authorizationSessionId: unknown;
  ownerUserId: unknown;
  workspaceId: unknown;
  projectId: unknown;
  albumId: unknown;
  photoId: unknown;
  versionId: unknown;
  databaseNowMs: unknown;
  sessionExpiresAtMs: unknown;
  expiryMode?: unknown;
  inviteExpiresAtMs?: unknown;
  expiryValid?: unknown;
};

type AssetScope = {
  album_id: unknown;
  workspace_id: unknown;
  project_id: unknown;
};

type Authorization = {
  actorType: 'user' | 'guest';
  actorId: string;
  authorizationSessionId: string;
  ownerUserId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  versionId: string;
  databaseNowMs: number;
  authorizationExpiresAtMs: number;
};

type Identity =
  | {
      kind: 'owner';
      actorId: string;
      sessionId: string;
      albumId: string;
      request: PhotoDisplayLeaseRequest;
    }
  | {
      kind: 'guest';
      secret: string;
      secretHash: string;
      albumId: string;
      request: PhotoDisplayLeaseRequest;
    };

const ownerAuthorizationSql = `
  WITH clock AS (
    SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS databaseNowMs
  )
  SELECT 'user' AS actorType,owner.user_id AS actorId,session.id AS authorizationSessionId,
    workspace.owner_user_id AS ownerUserId,workspace.id AS workspaceId,
    project.id AS projectId,album.id AS albumId,photo.id AS photoId,?5 AS versionId,
    clock.databaseNowMs,session.expiresAt AS sessionExpiresAtMs
  FROM clock
  JOIN owners owner ON owner.user_id=?1 AND owner.enabled=1
  JOIN workspaces workspace ON workspace.owner_user_id=owner.user_id
  JOIN owner_sessions session ON session.userId=owner.user_id AND session.id=?2
    AND session.expiresAt>clock.databaseNowMs
  JOIN projects project ON project.workspace_id=workspace.id
    AND project.status NOT IN('deleting','deleted')
  JOIN albums album ON album.project_id=project.id AND album.workspace_id=workspace.id
    AND album.id=?3 AND album.state NOT IN('deleting','deleted')
  JOIN photos photo ON photo.id=?4 AND photo.workspace_id=workspace.id
    AND photo.project_id=project.id AND photo.album_id=album.id
  LIMIT 1
`;

const guestAuthorizationSql = `
  WITH clock AS (
    SELECT CAST(unixepoch('subsec')*1000 AS INTEGER) AS databaseNowMs
  ), authorized AS (${guestScopeSql})
  SELECT authorized.actorType,authorized.actorId,authorized.authorizationSessionId,
    authorized.ownerUserId,authorized.workspaceId,authorized.projectId,authorized.albumId,
    ?4 AS photoId,?5 AS versionId,clock.databaseNowMs,
    session.expires_at_ms AS sessionExpiresAtMs,
    expiry.expiry_mode AS expiryMode,expiry.expires_at_ms AS inviteExpiresAtMs,
    expiry.expiry_valid AS expiryValid
  FROM clock CROSS JOIN authorized
  JOIN guest_sessions session ON session.id=authorized.authorizationSessionId
    AND session.guest_id=authorized.actorId
  JOIN effective_guest_invite_album_expiry expiry
    ON expiry.invite_id=session.invite_id AND expiry.workspace_id=authorized.workspaceId
    AND expiry.project_id=authorized.projectId AND expiry.album_id=authorized.albumId
    AND expiry.expiry_valid=1
  LIMIT 1
`;

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('DISPLAY_LEASE_UNAVAILABLE', 503);
}

function ownerDenied(): never {
  throw new WorkspaceFailure('NOT_FOUND', 404);
}

function actorChanged(): never {
  throw new WorkspaceFailure('OWNER_IDENTITY_CHANGED', 409);
}

function guestDenied(): never {
  throw new GuestAccessDenied();
}

function parseUuid(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data.toLowerCase();
}

function parseRequest(
  input: PhotoDisplayLeaseRequest,
): PhotoDisplayLeaseRequest {
  const parsed = photoDisplayLeaseRequestSchema.safeParse(input);
  if (!parsed.success) invalidInput();
  return {
    ...parsed.data,
    documentId: parsed.data.documentId.toLowerCase(),
    photoId: parsed.data.photoId.toLowerCase(),
    versionId: parsed.data.versionId.toLowerCase(),
    expectedActorId: parsed.data.expectedActorId.toLowerCase(),
  };
}

function safeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function parseRow(
  row: AuthorizationSource,
  kind: Identity['kind'],
): Authorization {
  const actorId = uuidSchema.safeParse(row.actorId);
  const ownerUserId = uuidSchema.safeParse(row.ownerUserId);
  const workspaceId = uuidSchema.safeParse(row.workspaceId);
  const projectId = uuidSchema.safeParse(row.projectId);
  const albumId = uuidSchema.safeParse(row.albumId);
  const photoId = uuidSchema.safeParse(row.photoId);
  const versionId = uuidSchema.safeParse(row.versionId);
  if (
    row.actorType !== (kind === 'owner' ? 'user' : 'guest') ||
    !actorId.success ||
    typeof row.authorizationSessionId !== 'string' ||
    row.authorizationSessionId.length < 1 ||
    row.authorizationSessionId.length > 512 ||
    !ownerUserId.success ||
    !workspaceId.success ||
    !projectId.success ||
    !albumId.success ||
    !photoId.success ||
    !versionId.success ||
    !safeInteger(row.databaseNowMs) ||
    row.databaseNowMs < 0 ||
    !safeInteger(row.sessionExpiresAtMs) ||
    row.sessionExpiresAtMs <= row.databaseNowMs
  ) {
    return unavailable();
  }

  let authorizationExpiresAtMs = row.sessionExpiresAtMs;
  if (kind === 'guest') {
    if (
      row.expiryValid !== 1 ||
      (row.expiryMode !== 'custom' && row.expiryMode !== 'inherit_album') ||
      (row.inviteExpiresAtMs !== null && !safeInteger(row.inviteExpiresAtMs)) ||
      (row.expiryMode === 'custom' && !safeInteger(row.inviteExpiresAtMs))
    ) {
      return unavailable();
    }
    if (row.inviteExpiresAtMs !== null)
      authorizationExpiresAtMs = Math.min(
        authorizationExpiresAtMs,
        row.inviteExpiresAtMs as number,
      );
  }

  return {
    actorType: kind === 'owner' ? 'user' : 'guest',
    actorId: actorId.data.toLowerCase(),
    authorizationSessionId: row.authorizationSessionId,
    ownerUserId: ownerUserId.data.toLowerCase(),
    workspaceId: workspaceId.data.toLowerCase(),
    projectId: projectId.data.toLowerCase(),
    albumId: albumId.data.toLowerCase(),
    photoId: photoId.data.toLowerCase(),
    versionId: versionId.data.toLowerCase(),
    databaseNowMs: row.databaseNowMs,
    authorizationExpiresAtMs,
  };
}

function sameAuthorization(before: Authorization, after: Authorization) {
  return (
    before.actorType === after.actorType &&
    before.actorId === after.actorId &&
    before.authorizationSessionId === after.authorizationSessionId &&
    before.ownerUserId === after.ownerUserId &&
    before.workspaceId === after.workspaceId &&
    before.projectId === after.projectId &&
    before.albumId === after.albumId &&
    before.photoId === after.photoId &&
    before.versionId === after.versionId
  );
}

function sameAssetScope(
  asset: AssetScope,
  authorization: Authorization,
  albumId: string,
) {
  const assetAlbumId = uuidSchema.safeParse(asset.album_id);
  const assetWorkspaceId = uuidSchema.safeParse(asset.workspace_id);
  const assetProjectId = uuidSchema.safeParse(asset.project_id);
  if (
    !assetAlbumId.success ||
    !assetWorkspaceId.success ||
    !assetProjectId.success
  )
    return unavailable();
  return (
    assetAlbumId.data.toLowerCase() === albumId &&
    assetAlbumId.data.toLowerCase() === authorization.albumId &&
    assetWorkspaceId.data.toLowerCase() === authorization.workspaceId &&
    assetProjectId.data.toLowerCase() === authorization.projectId
  );
}

async function guestSecretHash(secret: string | null): Promise<string> {
  if (!secret) guestDenied();
  try {
    return await hashGuestSessionSecret(secret);
  } catch {
    guestDenied();
  }
}

export class D1PhotoDisplayLeases {
  private readonly protections: D1AlbumReadProtections;

  constructor(private readonly db: D1Database) {
    this.protections = new D1AlbumReadProtections(db);
  }

  async owner(
    actorInput: string,
    sessionInput: string,
    albumInput: string,
    input: PhotoDisplayLeaseRequest,
  ): Promise<PhotoDisplayLeaseResult> {
    const actorId = parseUuid(actorInput);
    const session = ownerSessionSchema.safeParse(sessionInput);
    if (!session.success) invalidInput();
    const albumId = parseUuid(albumInput);
    const request = parseRequest(input);
    if (request.expectedActorId !== actorId) actorChanged();
    return this.issue({
      kind: 'owner',
      actorId,
      sessionId: session.data,
      albumId,
      request,
    });
  }

  async guest(
    secret: string | null,
    albumInput: string,
    input: PhotoDisplayLeaseRequest,
  ): Promise<PhotoDisplayLeaseResult> {
    const albumId = parseUuid(albumInput);
    const request = parseRequest(input);
    if (!secret) guestDenied();
    const secretHash = await guestSecretHash(secret);
    return this.issue({ kind: 'guest', secret, secretHash, albumId, request });
  }

  private async authorize(identity: Identity): Promise<Authorization | null> {
    const sql =
      identity.kind === 'owner' ? ownerAuthorizationSql : guestAuthorizationSql;
    const bindings =
      identity.kind === 'owner'
        ? [
            identity.actorId,
            identity.sessionId,
            identity.albumId,
            identity.request.photoId,
            identity.request.versionId,
          ]
        : [
            identity.secretHash,
            identity.request.expectedActorId,
            identity.albumId,
            identity.request.photoId,
            identity.request.versionId,
          ];
    try {
      const asset =
        identity.kind === 'owner'
          ? await new D1GalleryRepository(
              this.db,
              identity.actorId,
              identity.sessionId,
            ).asset(
              identity.request.photoId,
              identity.request.versionId,
              'preview',
            )
          : await new D1GuestGalleryRepository(this.db).asset(
              identity.secret,
              identity.request.photoId,
              identity.request.versionId,
              'preview',
            );
      const row = await this.db
        .prepare(sql)
        .bind(...bindings)
        .first<AuthorizationSource>();
      if (!row) return null;
      const authorization = parseRow(row, identity.kind);
      if (
        authorization.albumId !== identity.albumId ||
        authorization.photoId !== identity.request.photoId ||
        authorization.versionId !== identity.request.versionId ||
        (identity.kind === 'owner' &&
          (authorization.actorId !== identity.actorId ||
            authorization.authorizationSessionId !== identity.sessionId ||
            authorization.ownerUserId !== identity.actorId)) ||
        (identity.kind === 'guest' &&
          authorization.actorId !== identity.request.expectedActorId)
      ) {
        return null;
      }
      return sameAssetScope(asset, authorization, identity.albumId)
        ? authorization
        : null;
    } catch (error) {
      if (error instanceof GuestAccessDenied) return null;
      if (error instanceof WorkspaceFailure) {
        if (error.code === 'NOT_FOUND') return null;
        if (error.code === 'DISPLAY_LEASE_UNAVAILABLE') throw error;
      }
      return unavailable();
    }
  }

  private async issue(identity: Identity): Promise<PhotoDisplayLeaseResult> {
    const denied = () =>
      identity.kind === 'owner' ? ownerDenied() : guestDenied();
    const before = await this.authorize(identity);
    if (!before) return denied();

    let protection: { protectedUntilMs: number };
    try {
      protection = await this.protections.acquire({
        workspace_id: before.workspaceId,
        project_id: before.projectId,
        album_id: before.albumId,
      });
    } catch {
      return unavailable();
    }

    const after = await this.authorize(identity);
    if (!after || !sameAuthorization(before, after)) return denied();
    if (after.databaseNowMs < before.databaseNowMs) return unavailable();

    const issuedAtMs = after.databaseNowMs;
    const displayForMs = Math.floor(
      Math.min(
        PHOTO_DISPLAY_FOR_MS,
        protection.protectedUntilMs - issuedAtMs - PHOTO_DISPLAY_MARGIN_MS,
        before.authorizationExpiresAtMs - issuedAtMs,
        after.authorizationExpiresAtMs - issuedAtMs,
      ),
    );
    if (
      !Number.isSafeInteger(protection.protectedUntilMs) ||
      displayForMs < 1_000 ||
      protection.protectedUntilMs <
        issuedAtMs + displayForMs + PHOTO_DISPLAY_MARGIN_MS
    ) {
      return unavailable();
    }

    const issuedAt = new Date(issuedAtMs);
    const protectedUntilAt = new Date(protection.protectedUntilMs);
    if (
      !Number.isFinite(issuedAt.getTime()) ||
      !Number.isFinite(protectedUntilAt.getTime())
    ) {
      return unavailable();
    }

    const result = photoDisplayLeaseResultSchema.safeParse({
      documentId: identity.request.documentId,
      albumId: after.albumId,
      photoId: after.photoId,
      versionId: after.versionId,
      issuedAt: issuedAt.toISOString(),
      protectedUntilAt: protectedUntilAt.toISOString(),
      displayForMs,
    });
    if (!result.success) return unavailable();
    return result.data;
  }
}
