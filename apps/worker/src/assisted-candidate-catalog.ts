import { z } from 'zod';
import {
  resolvedUploadCandidateSchema,
  type ResolvedUploadCandidate,
} from '../../../packages/contracts/src/resolved-uploads';
import {
  assistedCandidatePageSchema,
  type AssistedCandidatePage,
} from '../../../packages/contracts/src/assisted-candidate-catalog';
import {
  matchingProfileContextSchema,
  matchingProfileIdSchema,
  type MatchingProfileContext,
} from '../../../packages/contracts/src/matching-rules';
import type { VersionMatchCandidate } from '../../../packages/domain/src/version-matching';
import type { VersionCandidateSnapshot } from './version-match-candidates';
import { WorkspaceFailure } from './workspaces';

const PROFILE = 'default-v1' as const;
const PURPOSE = 'assisted_catalog_v1' as const;
const TTL_SECONDS = 900;
const MAX_CURSOR_LENGTH = 4096;
const nonnegativeSafeInteger = z.number().int().nonnegative().safe();
const positiveSafeInteger = z.number().int().positive().safe();
const filenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value === value.trim())
  .refine((value) => !/[\\/\u0000-\u001f\u007f]/u.test(value));
const claimsSchema = z
  .object({
    version: z.literal(1),
    purpose: z.literal(PURPOSE),
    ownerId: z.uuid(),
    sessionId: z.string().min(1).max(512),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    projectRevision: positiveSafeInteger,
    albumRevision: positiveSafeInteger,
    changeSequence: nonnegativeSafeInteger,
    profile: z.literal(PROFILE),
    matchingProfile: matchingProfileContextSchema.optional(),
    catalogId: z.uuid(),
    afterPhotoId: z.uuid().nullable(),
    issuedAt: nonnegativeSafeInteger,
    expiresAt: positiveSafeInteger,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.expiresAt !== value.issuedAt + TTL_SECONDS)
      context.addIssue({
        code: 'custom',
        message: 'Invalid assisted catalog expiry',
      });
  });
type Claims = z.infer<typeof claimsSchema>;
const encoder = new TextEncoder();

function unavailable(): never {
  throw new WorkspaceFailure('RESOLUTION_CATALOG_UNAVAILABLE', 503);
}

function invalidCursor(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function stale(): never {
  throw new WorkspaceFailure('RESOLUTION_CATALOG_STALE', 409);
}

function key(secret: string | undefined): Promise<CryptoKey> {
  if (!secret || secret.length < 32) return Promise.reject();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function message(payload: string): ArrayBuffer {
  const encoded = encoder.encode(
    'kino-pic:assisted-candidate-catalog:v1:' + payload,
  );
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes.buffer;
}

function ensureSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) unavailable();
}

function ensureEnabled(enabled: boolean): void {
  if (!enabled) throw new WorkspaceFailure('RESOLUTION_CATALOG_DISABLED', 403);
}

function assertSnapshot(snapshot: VersionCandidateSnapshot): void {
  if (
    snapshot.mode !== 'assisted' ||
    snapshot.candidatesTruncated ||
    !z.uuid().safeParse(snapshot.scope.workspaceId).success ||
    !z.uuid().safeParse(snapshot.scope.projectId).success ||
    !z.uuid().safeParse(snapshot.scope.albumId).success ||
    !positiveSafeInteger.safeParse(snapshot.projectRevision).success ||
    !positiveSafeInteger.safeParse(snapshot.albumRevision).success ||
    !nonnegativeSafeInteger.safeParse(snapshot.changeSequence).success ||
    (snapshot.matchingProfile !== undefined &&
      !matchingProfileContextSchema.safeParse(snapshot.matchingProfile).success)
  )
    throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);
}

async function sign(claims: Claims, secret: string): Promise<string> {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = await crypto.subtle.sign(
    'HMAC',
    await key(secret),
    message(payload),
  );
  const token = payload + '.' + Buffer.from(signature).toString('base64url');
  if (token.length > MAX_CURSOR_LENGTH) return unavailable();
  return token;
}

async function verify(token: string, secret: string): Promise<Claims> {
  if (token.length < 1 || token.length > MAX_CURSOR_LENGTH) invalidCursor();
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    parts.some((part) => !part || !/^[A-Za-z0-9_-]+$/u.test(part))
  )
    invalidCursor();
  const payload = Buffer.from(parts[0]!, 'base64url');
  const signature = Buffer.from(parts[1]!, 'base64url');
  if (
    signature.length !== 32 ||
    payload.toString('base64url') !== parts[0] ||
    signature.toString('base64url') !== parts[1]
  )
    invalidCursor();

  let validSignature: boolean;
  try {
    validSignature = await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      signature,
      message(parts[0]!),
    );
  } catch {
    return unavailable();
  }
  if (!validSignature) invalidCursor();

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(payload),
    );
  } catch {
    return invalidCursor();
  }
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) invalidCursor();
  const claims = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  if (claims.issuedAt > now || claims.expiresAt <= now) stale();
  return claims;
}

const identityAndScopeCtes = [
  'WITH identity AS (',
  '  SELECT CASE WHEN EXISTS(',
  '    SELECT 1 FROM owners o',
  '    JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2',
  "      AND s.expiresAt>unixepoch('subsec')*1000",
  '    WHERE o.user_id=?1 AND o.enabled=1',
  '  ) THEN 1 ELSE 0 END AS ownerAuthorized',
  '), scope AS (',
  '  SELECT a.workspace_id AS workspaceId,a.project_id AS projectId,',
  '    a.id AS albumId,p.versioning_mode AS mode,',
  '    p.revision AS projectRevision,a.revision AS albumRevision,',
  '    COALESCE((SELECT MAX(m.sequence) FROM album_matching_changes m',
  '      WHERE m.workspace_id=a.workspace_id AND m.project_id=a.project_id',
  '        AND m.album_id=a.id),0) AS changeSequence,',
  "    COALESCE(r.profile,'default-v1') AS matchingProfile,",
  '    COALESCE(r.revision,0) AS ruleRevision',
  '  FROM albums a',
  '  JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id',
  '  LEFT JOIN project_matching_rule_heads r ON r.project_id=p.id AND r.workspace_id=p.workspace_id',
  '  JOIN workspaces w ON w.id=a.workspace_id AND w.owner_user_id=?1',
  '  JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
  '  JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?2',
  "    AND s.expiresAt>unixepoch('subsec')*1000",
  "  WHERE a.id=?3 AND a.state NOT IN('archived','deleting','deleted')",
  "    AND p.status NOT IN('archived','deleting','deleted')",
  ')',
].join('\n');

const pageSql = [
  identityAndScopeCtes,
  ', page AS (',
  '  SELECT p.id AS photoId,h.version_id AS currentVersionId,',
  '    h.revision AS revision,',
  '    COALESCE((',
  '      SELECT u.original_filename FROM upload_completions c',
  '      JOIN upload_sessions u ON u.id=c.upload_session_id',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    ),(',
  '      SELECT u.original_filename FROM upload_version_completions c',
  '      JOIN upload_sessions u ON u.id=c.upload_session_id',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    )) AS filename,',
  '    (',
  '      SELECT COUNT(*) FROM upload_completions c',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    ) + (',
  '      SELECT COUNT(*) FROM upload_version_completions c',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    ) AS witnessCount',
  '  FROM scope',
  '  JOIN photos p ON p.workspace_id=scope.workspaceId',
  '    AND p.project_id=scope.projectId AND p.album_id=scope.albumId',
  '    AND p.id COLLATE BINARY > ?4 COLLATE BINARY',
  '  LEFT JOIN photo_version_heads h ON h.photo_id=p.id',
  '    AND h.workspace_id=scope.workspaceId AND h.project_id=scope.projectId',
  '    AND h.album_id=scope.albumId',
  '  ORDER BY p.id COLLATE BINARY',
  '  LIMIT 25',
  ')',
  'SELECT identity.ownerAuthorized,scope.workspaceId,scope.projectId,',
  '  scope.albumId,scope.mode,scope.projectRevision,scope.albumRevision,',
  '  scope.changeSequence,scope.matchingProfile,scope.ruleRevision,',
  '  page.photoId,page.currentVersionId,page.revision,',
  '  page.filename,page.witnessCount',
  'FROM identity',
  'LEFT JOIN scope ON 1=1',
  'LEFT JOIN page ON 1=1',
  'ORDER BY page.photoId COLLATE BINARY',
].join('\n');

const headSql = [
  identityAndScopeCtes,
  ', selected AS (',
  '  SELECT p.id AS photoId,h.version_id AS headVersionId,',
  '    h.revision AS headRevision,v.id AS versionId,',
  '    v.source_hash_sha256 AS sha256,v.width AS width,v.height AS height,',
  '    COALESCE((',
  '      SELECT u.original_filename FROM upload_completions c',
  '      JOIN upload_sessions u ON u.id=c.upload_session_id',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    ),(',
  '      SELECT u.original_filename FROM upload_version_completions c',
  '      JOIN upload_sessions u ON u.id=c.upload_session_id',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    )) AS filename,',
  '    (',
  '      SELECT COUNT(*) FROM upload_completions c',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    ) + (',
  '      SELECT COUNT(*) FROM upload_version_completions c',
  '      WHERE c.version_id=h.version_id AND c.workspace_id=scope.workspaceId',
  '        AND c.project_id=scope.projectId AND c.album_id=scope.albumId',
  '    ) AS witnessCount',
  '  FROM scope',
  '  LEFT JOIN photos p ON p.id=?4 AND p.workspace_id=scope.workspaceId',
  '    AND p.project_id=scope.projectId AND p.album_id=scope.albumId',
  '  LEFT JOIN photo_version_heads h ON h.photo_id=p.id',
  '    AND h.workspace_id=scope.workspaceId AND h.project_id=scope.projectId',
  '    AND h.album_id=scope.albumId',
  '  LEFT JOIN photo_versions v ON v.id=h.version_id',
  '    AND v.photo_id=p.id AND v.workspace_id=p.workspace_id',
  ')',
  'SELECT identity.ownerAuthorized,scope.workspaceId,scope.projectId,',
  '  scope.albumId,scope.mode,scope.projectRevision,scope.albumRevision,',
  '  scope.changeSequence,scope.matchingProfile,scope.ruleRevision,',
  '  selected.photoId,selected.headVersionId,',
  '  selected.headRevision,selected.versionId,selected.sha256,',
  '  selected.width,selected.height,selected.filename,selected.witnessCount',
  'FROM identity',
  'LEFT JOIN scope ON 1=1',
  'LEFT JOIN selected ON 1=1',
].join('\n');

const pageRowSchema = z
  .object({
    ownerAuthorized: z.union([z.literal(0), z.literal(1)]),
    workspaceId: z.uuid().nullable(),
    projectId: z.uuid().nullable(),
    albumId: z.uuid().nullable(),
    mode: z.enum(['off', 'manual', 'auto_filename', 'assisted']).nullable(),
    projectRevision: positiveSafeInteger.nullable(),
    albumRevision: positiveSafeInteger.nullable(),
    changeSequence: nonnegativeSafeInteger.nullable(),
    matchingProfile: matchingProfileIdSchema.nullable(),
    ruleRevision: nonnegativeSafeInteger.nullable(),
    photoId: z.uuid().nullable(),
    currentVersionId: z.uuid().nullable(),
    revision: nonnegativeSafeInteger.nullable(),
    filename: z.string().nullable(),
    witnessCount: nonnegativeSafeInteger.nullable(),
  })
  .strict();

const headRowSchema = z
  .object({
    ownerAuthorized: z.union([z.literal(0), z.literal(1)]),
    workspaceId: z.uuid().nullable(),
    projectId: z.uuid().nullable(),
    albumId: z.uuid().nullable(),
    mode: z.enum(['off', 'manual', 'auto_filename', 'assisted']).nullable(),
    projectRevision: positiveSafeInteger.nullable(),
    albumRevision: positiveSafeInteger.nullable(),
    changeSequence: nonnegativeSafeInteger.nullable(),
    matchingProfile: matchingProfileIdSchema.nullable(),
    ruleRevision: nonnegativeSafeInteger.nullable(),
    photoId: z.uuid().nullable(),
    headVersionId: z.uuid().nullable(),
    headRevision: nonnegativeSafeInteger.nullable(),
    versionId: z.uuid().nullable(),
    sha256: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    filename: z.string().nullable(),
    witnessCount: nonnegativeSafeInteger.nullable(),
  })
  .strict();

function assertCurrentIdentity(row: { ownerAuthorized: number }): void {
  if (row.ownerAuthorized !== 1)
    throw new WorkspaceFailure('RESOLUTION_CATALOG_OWNER_CHANGED', 403);
}

function scopeOf(row: {
  workspaceId: string | null;
  projectId: string | null;
  albumId: string | null;
  mode: string | null;
  projectRevision: number | null;
  albumRevision: number | null;
  changeSequence: number | null;
  matchingProfile: z.infer<typeof matchingProfileIdSchema> | null;
  ruleRevision: number | null;
}) {
  if (
    row.workspaceId === null ||
    row.projectId === null ||
    row.albumId === null ||
    row.mode === null ||
    row.projectRevision === null ||
    row.albumRevision === null ||
    row.changeSequence === null ||
    row.matchingProfile === null ||
    row.ruleRevision === null
  )
    throw new WorkspaceFailure('NOT_FOUND', 404);
  return {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    albumId: row.albumId,
    mode: row.mode,
    projectRevision: row.projectRevision,
    albumRevision: row.albumRevision,
    changeSequence: row.changeSequence,
    matchingProfile: row.matchingProfile,
    ruleRevision: row.ruleRevision,
  };
}

function matchingProfileMatches(
  expected: MatchingProfileContext | undefined,
  current: {
    matchingProfile: z.infer<typeof matchingProfileIdSchema>;
    ruleRevision: number;
  },
): boolean {
  if (expected === undefined) return current.matchingProfile === PROFILE;
  return (
    current.matchingProfile === expected.profile &&
    current.ruleRevision === expected.ruleRevision
  );
}

function assertClaimsContext(
  claims: Claims,
  actorId: string,
  sessionId: string,
  albumId: string,
): void {
  if (claims.ownerId !== actorId)
    throw new WorkspaceFailure('RESOLUTION_CATALOG_OWNER_CHANGED', 403);
  if (claims.sessionId !== sessionId || claims.albumId !== albumId) stale();
}

function validateFilename(value: string | null): string {
  const filename = filenameSchema.safeParse(value);
  if (!filename.success) return unavailable();
  return filename.data;
}

export class D1AssistedCandidateCatalog {
  constructor(
    private readonly db: D1Database,
    private readonly actorId: string,
    private readonly sessionId: string,
    private readonly secret: string | undefined,
    private readonly enabled: boolean,
  ) {}

  async start(snapshot: VersionCandidateSnapshot): Promise<string> {
    ensureEnabled(this.enabled);
    ensureSecret(this.secret);
    assertSnapshot(snapshot);
    if (!z.uuid().safeParse(this.actorId).success)
      throw new WorkspaceFailure('RESOLUTION_CATALOG_OWNER_CHANGED', 403);
    const session = z.string().min(1).max(512).safeParse(this.sessionId);
    if (!session.success) return unavailable();
    const now = Math.floor(Date.now() / 1000);
    const claims = claimsSchema.parse({
      version: 1,
      purpose: PURPOSE,
      ownerId: this.actorId,
      sessionId: session.data,
      workspaceId: snapshot.scope.workspaceId,
      projectId: snapshot.scope.projectId,
      albumId: snapshot.scope.albumId,
      projectRevision: snapshot.projectRevision,
      albumRevision: snapshot.albumRevision,
      changeSequence: snapshot.changeSequence,
      profile: PROFILE,
      ...(snapshot.matchingProfile === undefined
        ? {}
        : { matchingProfile: snapshot.matchingProfile }),
      catalogId: crypto.randomUUID(),
      afterPhotoId: null,
      issuedAt: now,
      expiresAt: now + TTL_SECONDS,
    });
    try {
      return await sign(claims, this.secret);
    } catch {
      return unavailable();
    }
  }

  async list(
    albumIdInput: string,
    cursorInput: string,
  ): Promise<AssistedCandidatePage> {
    ensureEnabled(this.enabled);
    ensureSecret(this.secret);
    const album = z.uuid().safeParse(albumIdInput);
    const cursor = z
      .string()
      .min(1)
      .max(MAX_CURSOR_LENGTH)
      .safeParse(cursorInput);
    if (!album.success || !cursor.success) invalidCursor();

    let claims: Claims;
    try {
      claims = await verify(cursor.data, this.secret);
    } catch (error) {
      if (error instanceof WorkspaceFailure) throw error;
      return unavailable();
    }
    assertClaimsContext(claims, this.actorId, this.sessionId, album.data);

    let result: D1Result<unknown>;
    try {
      result = await this.db
        .prepare(pageSql)
        .bind(
          this.actorId,
          this.sessionId,
          album.data,
          claims.afterPhotoId ?? '',
        )
        .all<unknown>();
    } catch {
      return unavailable();
    }
    if (
      !result.success ||
      result.results.length < 1 ||
      result.results.length > 25
    )
      return unavailable();
    const parsed = pageRowSchema.safeParse(result.results[0]);
    if (!parsed.success) return unavailable();
    const anchor = parsed.data;
    assertCurrentIdentity(anchor);
    const current = scopeOf(anchor);
    if (
      current.workspaceId !== claims.workspaceId ||
      current.projectId !== claims.projectId ||
      current.albumId !== claims.albumId ||
      current.mode !== 'assisted' ||
      current.projectRevision !== claims.projectRevision ||
      current.albumRevision !== claims.albumRevision ||
      current.changeSequence !== claims.changeSequence ||
      !matchingProfileMatches(claims.matchingProfile, current)
    )
      stale();

    const rows = result.results.map((raw) => {
      const row = pageRowSchema.safeParse(raw);
      if (!row.success) return unavailable();
      return row.data;
    });
    const items: ResolvedUploadCandidate[] = [];
    for (const row of rows) {
      if (row.photoId === null) continue;
      if (
        row.currentVersionId === null ||
        row.revision === null ||
        row.witnessCount !== 1
      )
        return unavailable();
      const filename = validateFilename(row.filename);
      items.push(
        resolvedUploadCandidateSchema.parse({
          photoId: row.photoId,
          filename,
          currentVersionId: row.currentVersionId,
          revision: row.revision,
        }),
      );
    }

    const hasMore = items.length > 24;
    const pageItems = items.slice(0, 24);
    const last = pageItems.at(-1);
    const nextCursor =
      hasMore && last
        ? await sign(
            claimsSchema.parse({
              ...claims,
              afterPhotoId: last.photoId,
            }),
            this.secret,
          )
        : null;
    return assistedCandidatePageSchema.parse({
      workspaceId: current.workspaceId,
      projectId: current.projectId,
      albumId: current.albumId,
      projectRevision: current.projectRevision,
      albumRevision: current.albumRevision,
      changeSequence: current.changeSequence,
      items: pageItems,
      nextCursor,
    });
  }

  async authorizeHead(
    snapshot: VersionCandidateSnapshot,
    photoIdInput: string,
  ): Promise<{
    candidate: VersionMatchCandidate;
    head: { versionId: string; revision: number };
  }> {
    ensureEnabled(this.enabled);
    ensureSecret(this.secret);
    assertSnapshot(snapshot);
    const photoId = z.uuid().safeParse(photoIdInput);
    if (!photoId.success) invalidCursor();
    if (this.sessionId.length < 1 || this.sessionId.length > 512)
      return unavailable();

    let result: D1Result<unknown>;
    try {
      result = await this.db
        .prepare(headSql)
        .bind(
          this.actorId,
          this.sessionId,
          snapshot.scope.albumId,
          photoId.data,
        )
        .all<unknown>();
    } catch {
      return unavailable();
    }
    if (!result.success || result.results.length !== 1) return unavailable();
    const parsed = headRowSchema.safeParse(result.results[0]);
    if (!parsed.success) return unavailable();
    const row = parsed.data;
    assertCurrentIdentity(row);
    const current = scopeOf(row);
    if (
      current.workspaceId !== snapshot.scope.workspaceId ||
      current.projectId !== snapshot.scope.projectId ||
      current.albumId !== snapshot.scope.albumId ||
      current.mode !== 'assisted' ||
      current.projectRevision !== snapshot.projectRevision ||
      current.albumRevision !== snapshot.albumRevision ||
      current.changeSequence !== snapshot.changeSequence ||
      !matchingProfileMatches(snapshot.matchingProfile, current)
    )
      throw new WorkspaceFailure('RESOLUTION_STALE', 409);
    if (row.photoId === null)
      throw new WorkspaceFailure('RESOLUTION_REVIEW_REQUIRED', 409);
    if (
      row.headVersionId === null ||
      row.headRevision === null ||
      row.versionId === null ||
      row.headVersionId !== row.versionId ||
      row.sha256 === null ||
      !/^[0-9a-f]{64}$/iu.test(row.sha256) ||
      row.witnessCount !== 1
    )
      return unavailable();

    const captured = snapshot.heads[photoId.data];
    // The preview's materialized head map is metadata, not catalog authority:
    // an omitted target may still be selected after this current scoped read.
    // If the preview did capture this head, require it to remain unchanged.
    if (
      captured &&
      (captured.versionId !== row.headVersionId ||
        captured.revision !== row.headRevision)
    )
      throw new WorkspaceFailure('RESOLUTION_STALE', 409);

    const filename = validateFilename(row.filename);
    const dimensions =
      row.width === null && row.height === null
        ? null
        : row.width !== null &&
            row.height !== null &&
            Number.isSafeInteger(row.width) &&
            Number.isSafeInteger(row.height) &&
            row.width > 0 &&
            row.height > 0 &&
            row.width <= 32768 &&
            row.height <= 32768 &&
            row.width * row.height <= 80_000_000
          ? { width: row.width, height: row.height }
          : unavailable();
    return {
      candidate: {
        scope: snapshot.scope,
        photoId: photoId.data,
        versionId: row.headVersionId,
        filename,
        sha256: row.sha256,
        dimensions,
      },
      head: {
        versionId: row.headVersionId,
        revision: row.headRevision,
      },
    };
  }
}
