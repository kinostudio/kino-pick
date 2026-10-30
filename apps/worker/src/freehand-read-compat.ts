import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access.ts';

export const FREEHAND_ANNOTATION_READ_CAPABILITIES_HEADER =
  'X-Kino-Annotation-Read-Capabilities';
export const FREEHAND_ANNOTATION_READ_CAPABILITY = 'freehand-v1';
export const ANNOTATION_CLIENT_UPGRADE_REQUIRED =
  'ANNOTATION_CLIENT_UPGRADE_REQUIRED';

const capabilityTokenPattern = /^[a-z][a-z0-9-]{0,63}$/u;
const maxCapabilityHeaderLength = 256;

export type AnnotationReadCapability =
  typeof FREEHAND_ANNOTATION_READ_CAPABILITY;

export function parseAnnotationReadCapabilities(
  headerValue: string | null | undefined,
): ReadonlySet<AnnotationReadCapability> {
  if (
    typeof headerValue !== 'string' ||
    headerValue.length === 0 ||
    headerValue.length > maxCapabilityHeaderLength
  ) {
    return new Set();
  }

  const rawTokens = headerValue.split(',');
  if (
    rawTokens.length > 16 ||
    rawTokens.some((token) => !capabilityTokenPattern.test(token.trim()))
  ) {
    return new Set();
  }

  return new Set(
    rawTokens
      .map((token) => token.trim())
      .filter(
        (token): token is AnnotationReadCapability =>
          token === FREEHAND_ANNOTATION_READ_CAPABILITY,
      ),
  );
}

export function supportsFreehandAnnotationRead(
  headerValue: string | null | undefined,
): boolean {
  return parseAnnotationReadCapabilities(headerValue).has(
    FREEHAND_ANNOTATION_READ_CAPABILITY,
  );
}

const guestScopeSchema = z
  .object({
    kind: z.enum(['guest-own', 'guest-shared']),
    secretHash: z.string().regex(/^[0-9a-f]{64}$/u),
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
  })
  .strict();

const ownerScopeSchema = z
  .object({
    kind: z.enum(['owner-own', 'owner-guest-list']),
    ownerId: z.uuid(),
    sessionId: z.string().min(1).max(512),
    inviteId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
    versionId: z.uuid(),
  })
  .strict();

export type FreehandAnnotationReadScope =
  z.infer<typeof guestScopeSchema> | z.infer<typeof ownerScopeSchema>;

export type FreehandAnnotationReadPreflight =
  | { kind: 'denied' }
  | {
      kind: 'authorized';
      scopeKind: 'guest-own';
      containsFreehand: boolean;
      watermarks: { guest: number };
    }
  | {
      kind: 'authorized';
      scopeKind: 'guest-shared';
      containsFreehand: boolean;
      watermarks: { guest: number; owner: number; processing: number };
    }
  | {
      kind: 'authorized';
      scopeKind: 'owner-own';
      containsFreehand: boolean;
      watermarks: { owner: number };
    }
  | {
      kind: 'authorized';
      scopeKind: 'owner-guest-list';
      containsFreehand: boolean;
      watermarks: { guest: number; processing: number };
    };

type AuthorizedFreehandAnnotationReadPreflight = Extract<
  FreehandAnnotationReadPreflight,
  { kind: 'authorized' }
>;
type AnnotationReadWatermarkName = 'guest' | 'owner' | 'processing';
export type AnnotationReadWatermarks = Partial<
  Record<AnnotationReadWatermarkName, number>
>;

export class AnnotationClientUpgradeRequiredError extends Error {
  readonly code = ANNOTATION_CLIENT_UPGRADE_REQUIRED;

  constructor() {
    super(ANNOTATION_CLIENT_UPGRADE_REQUIRED);
    this.name = 'AnnotationClientUpgradeRequiredError';
  }
}

export function annotationReadWatermarksMatch(
  preflight: FreehandAnnotationReadPreflight,
  scopeKind: AuthorizedFreehandAnnotationReadPreflight['scopeKind'],
  pageWatermarks: Readonly<AnnotationReadWatermarks>,
): boolean {
  if (preflight.kind !== 'authorized' || preflight.scopeKind !== scopeKind)
    return false;

  const expected = preflight.watermarks;
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(pageWatermarks);
  if (expectedKeys.length !== actualKeys.length) return false;

  return expectedKeys.every((key) => {
    const expectedValue = Reflect.get(expected, key);
    const pageValue = Reflect.get(pageWatermarks, key);
    return (
      typeof pageValue === 'number' &&
      Number.isSafeInteger(pageValue) &&
      pageValue === expectedValue
    );
  });
}
export type AnnotationReadCompatibilityDecision =
  | { kind: 'denied' }
  | { kind: 'compatible' }
  | {
      kind: 'upgrade-required';
      code: typeof ANNOTATION_CLIENT_UPGRADE_REQUIRED;
    };

export function decideAnnotationReadCompatibility(
  supportsFreehand: boolean,
  preflight: FreehandAnnotationReadPreflight,
): AnnotationReadCompatibilityDecision {
  if (preflight.kind === 'denied') return { kind: 'denied' };
  if (!supportsFreehand && preflight.containsFreehand) {
    return {
      kind: 'upgrade-required',
      code: ANNOTATION_CLIENT_UPGRADE_REQUIRED,
    };
  }
  return { kind: 'compatible' };
}

export class FreehandAnnotationReadPreflightError extends Error {
  constructor() {
    super('Freehand annotation read compatibility preflight failed.');
    this.name = 'FreehandAnnotationReadPreflightError';
  }
}

type PreflightRow = {
  authorized: number;
  containsFreehand: number | null;
  guestWatermark: number | null;
  ownerWatermark: number | null;
  processingWatermark: number | null;
};

type SqlScope = {
  sql: string;
  bindings: readonly (string | number)[];
};

const canAnnotateBit = guestPermissionBit('can_annotate');

// These statements deliberately re-establish the existing reader authorization in
// the same SQL statement as the freehand check. The scope values are bound data;
// there are no caller-controlled SQL fragments.
const guestOwnPreflightSql = [
  'WITH authorized AS (',
  ' SELECT s.id AS sessionId,g.id AS guestId,i.id AS inviteId,',
  '   i.workspace_id AS workspaceId,i.project_id AS projectId,ia.album_id AS albumId',
  ' FROM guest_sessions s',
  ' JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
  ' JOIN guest_invites i ON i.id=s.invite_id',
  ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
  ' JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id',
  '   AND ia.project_id=i.project_id AND ia.album_id=?',
  ' JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id',
  "   AND a.project_id=i.project_id AND a.state='active'",
  ' JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
  "   AND p.status NOT IN('archived','deleting','deleted')",
  ' JOIN workspaces w ON w.id=i.workspace_id',
  ' JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
  ' WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
  "   AND s.expires_at_ms>unixepoch('subsec')*1000",
  "   AND i.expires_at_ms>unixepoch('subsec')*1000",
  '   AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)',
  '   AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)',
  '), authorized_version AS (',
  ' SELECT au.sessionId,au.guestId,au.inviteId,au.workspaceId,au.projectId,',
  '   au.albumId,p.id AS photoId,ev.version_id AS versionId',
  ' FROM authorized au',
  ' JOIN photos p ON p.id=? AND p.workspace_id=au.workspaceId',
  '   AND p.project_id=au.projectId AND p.album_id=au.albumId',
  ' JOIN guest_annotation_eligible_versions ev ON ev.photo_id=p.id',
  '   AND ev.version_id=? AND ev.workspace_id=p.workspace_id',
  '   AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
  ')',
  'SELECT',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN 1 ELSE 0 END AS authorized,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN CASE WHEN EXISTS(',
  '   SELECT 1 FROM authorized_version av',
  '   JOIN guest_annotations x ON x.invite_id=av.inviteId',
  '     AND x.workspace_id=av.workspaceId AND x.project_id=av.projectId',
  '     AND x.album_id=av.albumId AND x.photo_id=av.photoId',
  '     AND x.version_id=av.versionId AND x.author_guest_id=av.guestId',
  '   WHERE x.geometry_json IS NOT NULL',
  "     AND json_extract(x.geometry_json,'$.type')='freehand'",
  ' ) THEN 1 ELSE 0 END ELSE NULL END AS containsFreehand,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN COALESCE((',
  '   SELECT MAX(ch.seq) FROM guest_annotation_changes ch',
  '   JOIN authorized_version av ON ch.guest_id=av.guestId AND ch.invite_id=av.inviteId',
  '     AND ch.workspace_id=av.workspaceId AND ch.project_id=av.projectId',
  '     AND ch.album_id=av.albumId AND ch.photo_id=av.photoId',
  '     AND ch.version_id=av.versionId',
  ' ),0) ELSE NULL END AS guestWatermark,',
  ' NULL AS ownerWatermark, NULL AS processingWatermark',
].join('\n');

const guestSharedPreflightSql = [
  'WITH authorized AS (',
  ' SELECT s.id AS sessionId,g.id AS guestId,i.id AS inviteId,',
  '   i.workspace_id AS workspaceId,i.project_id AS projectId,ia.album_id AS albumId',
  ' FROM guest_sessions s',
  ' JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id',
  ' JOIN guest_invites i ON i.id=s.invite_id',
  ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
  ' JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id',
  '   AND ia.project_id=i.project_id AND ia.album_id=?',
  ' JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id',
  "   AND a.project_id=i.project_id AND a.state='active'",
  ' JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id',
  "   AND p.status NOT IN('archived','deleting','deleted')",
  ' JOIN workspaces w ON w.id=i.workspace_id',
  ' JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id',
  ' WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?',
  "   AND s.expires_at_ms>unixepoch('subsec')*1000",
  "   AND i.expires_at_ms>unixepoch('subsec')*1000",
  '   AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)',
  '   AND NOT EXISTS(SELECT 1 FROM guest_session_revocations r WHERE r.session_id=s.id)',
  '), authorized_version AS (',
  ' SELECT au.sessionId,au.guestId,au.inviteId,au.workspaceId,au.projectId,',
  '   au.albumId,p.id AS photoId,ev.version_id AS versionId',
  ' FROM authorized au',
  ' JOIN photos p ON p.id=? AND p.workspace_id=au.workspaceId',
  '   AND p.project_id=au.projectId AND p.album_id=au.albumId',
  ' JOIN guest_annotation_eligible_versions ev ON ev.photo_id=p.id',
  '   AND ev.version_id=? AND ev.workspace_id=p.workspace_id',
  '   AND ev.project_id=p.project_id AND ev.album_id=p.album_id',
  ')',
  'SELECT',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN 1 ELSE 0 END AS authorized,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN CASE WHEN',
  '   EXISTS(SELECT 1 FROM authorized_version av',
  '     JOIN guest_annotations x ON x.invite_id=av.inviteId',
  '       AND x.workspace_id=av.workspaceId AND x.project_id=av.projectId',
  '       AND x.album_id=av.albumId AND x.photo_id=av.photoId',
  '       AND x.version_id=av.versionId',
  '     WHERE x.geometry_json IS NOT NULL',
  "       AND json_extract(x.geometry_json,'$.type')='freehand')",
  '   OR EXISTS(SELECT 1 FROM authorized_version av',
  '     JOIN owner_annotations x ON x.invite_id=av.inviteId',
  '       AND x.workspace_id=av.workspaceId AND x.project_id=av.projectId',
  '       AND x.album_id=av.albumId AND x.photo_id=av.photoId',
  '       AND x.version_id=av.versionId',
  '     WHERE x.geometry_json IS NOT NULL',
  "       AND json_extract(x.geometry_json,'$.type')='freehand')",
  '   THEN 1 ELSE 0 END ELSE NULL END AS containsFreehand,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN COALESCE((',
  '   SELECT MAX(ch.seq) FROM guest_annotation_changes ch',
  '   JOIN authorized_version av ON ch.invite_id=av.inviteId',
  '     AND ch.workspace_id=av.workspaceId AND ch.project_id=av.projectId',
  '     AND ch.album_id=av.albumId AND ch.photo_id=av.photoId',
  '     AND ch.version_id=av.versionId',
  ' ),0) ELSE NULL END AS guestWatermark,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN COALESCE((',
  '   SELECT MAX(ch.seq) FROM owner_annotation_changes ch',
  '   JOIN authorized_version av ON ch.invite_id=av.inviteId',
  '     AND ch.workspace_id=av.workspaceId AND ch.project_id=av.projectId',
  '     AND ch.album_id=av.albumId AND ch.photo_id=av.photoId',
  '     AND ch.version_id=av.versionId',
  ' ),0) ELSE NULL END AS ownerWatermark,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized_version) THEN COALESCE((',
  '   SELECT MAX(ch.seq) FROM owner_annotation_processing_changes ch',
  '   JOIN authorized_version av ON ch.invite_id=av.inviteId',
  '     AND ch.workspace_id=av.workspaceId AND ch.project_id=av.projectId',
  '     AND ch.album_id=av.albumId AND ch.photo_id=av.photoId',
  '     AND ch.version_id=av.versionId',
  ' ),0) ELSE NULL END AS processingWatermark',
].join('\n');

const ownerGuestListPreflightSql = [
  'WITH requested AS (',
  ' SELECT ? AS actorId,? AS sessionId,? AS albumId,',
  '   ? AS photoId,? AS inviteId,? AS versionId',
  '), authorized AS (',
  ' SELECT o.user_id AS actorId,w.id AS workspaceId,',
  '   pr.id AS projectId,a.id AS albumId,i.id AS inviteId,',
  '   p.id AS photoId,v.id AS versionId',
  ' FROM requested req',
  ' JOIN owners o ON o.user_id=req.actorId AND o.enabled=1',
  ' JOIN owner_sessions s ON s.userId=o.user_id AND s.id=req.sessionId',
  "   AND s.expiresAt>unixepoch('subsec')*1000",
  ' JOIN workspaces w ON w.owner_user_id=o.user_id',
  ' JOIN albums a ON a.id=req.albumId AND a.workspace_id=w.id',
  "   AND a.state='active'",
  ' JOIN projects pr ON pr.id=a.project_id AND pr.workspace_id=w.id',
  "   AND pr.status NOT IN('archived','deleting','deleted')",
  ' JOIN photos p ON p.id=req.photoId AND p.workspace_id=w.id',
  '   AND p.project_id=pr.id AND p.album_id=a.id',
  ' JOIN guest_invites i ON i.id=req.inviteId AND i.workspace_id=w.id',
  '   AND i.project_id=pr.id AND i.created_by=o.user_id',
  ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
  ' JOIN guest_invite_albums ia ON ia.invite_id=i.id',
  '   AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id',
  '   AND ia.album_id=a.id',
  ' JOIN photo_versions v ON v.id=req.versionId',
  '   AND v.workspace_id=p.workspace_id AND v.photo_id=p.id',
  ')',
  'SELECT',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN 1 ELSE 0 END AS authorized,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN CASE WHEN EXISTS(',
  '   SELECT 1 FROM authorized auth',
  '   JOIN guest_annotations x ON x.invite_id=auth.inviteId',
  '     AND x.workspace_id=auth.workspaceId AND x.project_id=auth.projectId',
  '     AND x.album_id=auth.albumId AND x.photo_id=auth.photoId',
  '     AND x.version_id=auth.versionId',
  '   WHERE x.geometry_json IS NOT NULL',
  "     AND json_extract(x.geometry_json,'$.type')='freehand'",
  ' ) THEN 1 ELSE 0 END ELSE NULL END AS containsFreehand,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN COALESCE((',
  '   SELECT MAX(ch.seq) FROM guest_annotation_changes ch',
  '   JOIN authorized auth ON ch.invite_id=auth.inviteId',
  '     AND ch.workspace_id=auth.workspaceId AND ch.project_id=auth.projectId',
  '     AND ch.album_id=auth.albumId AND ch.photo_id=auth.photoId',
  '     AND ch.version_id=auth.versionId',
  ' ),0) ELSE NULL END AS guestWatermark,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN COALESCE((',
  '   SELECT MAX(ch.seq) FROM owner_annotation_processing_changes ch',
  '   JOIN authorized auth ON ch.invite_id=auth.inviteId',
  '     AND ch.workspace_id=auth.workspaceId AND ch.project_id=auth.projectId',
  '     AND ch.album_id=auth.albumId AND ch.photo_id=auth.photoId',
  '     AND ch.version_id=auth.versionId',
  ' ),0) ELSE NULL END AS processingWatermark,',
  ' NULL AS ownerWatermark',
].join('\n');
const ownerPreflightSql = [
  'WITH requested AS (',
  ' SELECT ? AS actorId,? AS sessionId,? AS albumId,',
  '   ? AS photoId,? AS inviteId,? AS versionId',
  '), authorized AS (',
  ' SELECT o.user_id AS actorId,w.id AS workspaceId,',
  '   pr.id AS projectId,a.id AS albumId,i.id AS inviteId,',
  '   p.id AS photoId,v.id AS versionId',
  ' FROM requested req',
  ' JOIN owners o ON o.user_id=req.actorId AND o.enabled=1',
  ' JOIN owner_sessions s ON s.userId=o.user_id AND s.id=req.sessionId',
  "   AND s.expiresAt>unixepoch('subsec')*1000",
  ' JOIN workspaces w ON w.owner_user_id=o.user_id',
  ' JOIN albums a ON a.id=req.albumId AND a.workspace_id=w.id',
  "   AND a.state='active'",
  ' JOIN projects pr ON pr.id=a.project_id AND pr.workspace_id=w.id',
  "   AND pr.status NOT IN('archived','deleting','deleted')",
  ' JOIN photos p ON p.id=req.photoId AND p.workspace_id=w.id',
  '   AND p.project_id=pr.id AND p.album_id=a.id',
  ' JOIN guest_invites i ON i.id=req.inviteId AND i.workspace_id=w.id',
  '   AND i.project_id=pr.id AND i.created_by=o.user_id',
  ' JOIN guest_invite_seals seal ON seal.invite_id=i.id',
  ' JOIN guest_invite_albums ia ON ia.invite_id=i.id',
  '   AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id',
  '   AND ia.album_id=a.id',
  ' JOIN photo_versions v ON v.id=req.versionId',
  '   AND v.workspace_id=p.workspace_id AND v.photo_id=p.id',
  ')',
  'SELECT',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN 1 ELSE 0 END AS authorized,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN CASE WHEN EXISTS(',
  '   SELECT 1 FROM authorized auth',
  '   JOIN owner_annotations x ON x.invite_id=auth.inviteId',
  '     AND x.author_user_id=auth.actorId AND x.workspace_id=auth.workspaceId',
  '     AND x.project_id=auth.projectId AND x.album_id=auth.albumId',
  '     AND x.photo_id=auth.photoId AND x.version_id=auth.versionId',
  '   WHERE x.geometry_json IS NOT NULL',
  "     AND json_extract(x.geometry_json,'$.type')='freehand'",
  ' ) THEN 1 ELSE 0 END ELSE NULL END AS containsFreehand,',
  ' CASE WHEN EXISTS(SELECT 1 FROM authorized) THEN COALESCE((',
  '   SELECT MAX(ch.seq) FROM owner_annotation_changes ch',
  '   JOIN authorized auth ON ch.actor_id=auth.actorId AND ch.invite_id=auth.inviteId',
  '     AND ch.workspace_id=auth.workspaceId AND ch.project_id=auth.projectId',
  '     AND ch.album_id=auth.albumId AND ch.photo_id=auth.photoId',
  '     AND ch.version_id=auth.versionId',
  ' ),0) ELSE NULL END AS ownerWatermark,',
  ' NULL AS guestWatermark, NULL AS processingWatermark',
].join('\n');

function parseScope(
  scopeInput: FreehandAnnotationReadScope,
): FreehandAnnotationReadScope | null {
  const parsed =
    typeof scopeInput === 'object' &&
    scopeInput !== null &&
    'kind' in scopeInput &&
    (scopeInput.kind === 'guest-own' || scopeInput.kind === 'guest-shared')
      ? guestScopeSchema.safeParse(scopeInput)
      : ownerScopeSchema.safeParse(scopeInput);
  return parsed.success ? parsed.data : null;
}

function statementFor(scope: FreehandAnnotationReadScope): SqlScope {
  switch (scope.kind) {
    case 'guest-own':
    case 'guest-shared':
      return {
        sql:
          scope.kind === 'guest-own'
            ? guestOwnPreflightSql
            : guestSharedPreflightSql,
        bindings: [
          scope.albumId,
          scope.secretHash,
          canAnnotateBit,
          canAnnotateBit,
          scope.photoId,
          scope.versionId,
        ],
      };
    case 'owner-own':
    case 'owner-guest-list':
      return {
        sql:
          scope.kind === 'owner-own'
            ? ownerPreflightSql
            : ownerGuestListPreflightSql,
        bindings: [
          scope.ownerId,
          scope.sessionId,
          scope.albumId,
          scope.photoId,
          scope.inviteId,
          scope.versionId,
        ],
      };
  }
}

function safeWatermark(value: number | null): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new FreehandAnnotationReadPreflightError();
  }
  return value;
}

/**
 * Performs an authorized, full-feed preflight with no cursor, annotationId or
 * page limit. This statement is separate from the subsequent page read: callers
 * must compare the returned watermark(s) with that read's watermark(s), and
 * discard/retry or fail closed if they differ. Do not treat this as a snapshot
 * guarantee or use it to replace the feed's existing authorization.
 */
export async function preflightFreehandAnnotationRead(
  db: D1Database,
  scopeInput: FreehandAnnotationReadScope,
): Promise<FreehandAnnotationReadPreflight> {
  const scope = parseScope(scopeInput);
  if (!scope) return { kind: 'denied' };

  const statement = statementFor(scope);
  let row: PreflightRow | null;
  try {
    row = await db
      .prepare(statement.sql)
      .bind(...statement.bindings)
      .first<PreflightRow>();
  } catch {
    throw new FreehandAnnotationReadPreflightError();
  }

  if (!row || (row.authorized !== 0 && row.authorized !== 1)) {
    throw new FreehandAnnotationReadPreflightError();
  }
  if (row.authorized === 0) return { kind: 'denied' };
  if (row.containsFreehand !== 0 && row.containsFreehand !== 1) {
    throw new FreehandAnnotationReadPreflightError();
  }

  switch (scope.kind) {
    case 'guest-own':
      return {
        kind: 'authorized',
        scopeKind: 'guest-own',
        containsFreehand: row.containsFreehand === 1,
        watermarks: { guest: safeWatermark(row.guestWatermark) },
      };
    case 'guest-shared':
      return {
        kind: 'authorized',
        scopeKind: 'guest-shared',
        containsFreehand: row.containsFreehand === 1,
        watermarks: {
          guest: safeWatermark(row.guestWatermark),
          owner: safeWatermark(row.ownerWatermark),
          processing: safeWatermark(row.processingWatermark),
        },
      };
    case 'owner-own':
      return {
        kind: 'authorized',
        scopeKind: 'owner-own',
        containsFreehand: row.containsFreehand === 1,
        watermarks: { owner: safeWatermark(row.ownerWatermark) },
      };
    case 'owner-guest-list':
      return {
        kind: 'authorized',
        scopeKind: 'owner-guest-list',
        containsFreehand: row.containsFreehand === 1,
        watermarks: {
          guest: safeWatermark(row.guestWatermark),
          processing: safeWatermark(row.processingWatermark),
        },
      };
  }
}
