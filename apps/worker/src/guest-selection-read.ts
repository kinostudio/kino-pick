import { z } from 'zod';
import { guestPermissionBit } from '../../../packages/contracts/src/guest-access';
import { guestSelectionPageSchema } from '../../../packages/contracts/src/guest-actions';
import { GuestAccessDenied, hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';

const canSelectBit = guestPermissionBit('can_select');
const selectionCursorPositionSchema = z
  .object({
    albumId: z.uuid(),
    roundNo: z.number().int().positive(),
    selectionRevision: z.number().int().nonnegative(),
    selectedAtMs: z.number().int().nonnegative(),
    photoId: z.uuid(),
  })
  .strict();
const legacySelectionCursorSchema = selectionCursorPositionSchema
  .extend({ policyRevision: z.number().int().nonnegative().default(0) })
  .strict();
const selectionCursorSchema = selectionCursorPositionSchema
  .extend({
    source: z.enum(['system', 'project', 'album']),
    albumRevision: z.number().int().nonnegative(),
    projectRevision: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((cursor, context) => {
    if (cursor.source === 'album' && cursor.projectRevision !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['projectRevision'],
        message: 'Album cursors do not bind project defaults',
      });
    }
    if (cursor.source !== 'album' && cursor.projectRevision === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['projectRevision'],
        message: 'Inherited cursors must bind project defaults',
      });
    }
  });
type SelectionCursor = z.infer<typeof selectionCursorSchema>;
type DecodedCursor =
  | { kind: 'current'; value: SelectionCursor }
  | {
      kind: 'legacy';
      value: z.infer<typeof legacySelectionCursorSchema>;
    };

function decodeCursor(input?: string): DecodedCursor | null {
  if (input === undefined) return null;
  const raw = z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new z.ZodError([
      { code: 'custom', path: [], message: 'Invalid selection cursor' },
    ]);
  }
  const current = selectionCursorSchema.safeParse(parsed);
  if (current.success) return { kind: 'current', value: current.data };
  const legacy = legacySelectionCursorSchema.safeParse(parsed);
  if (legacy.success) return { kind: 'legacy', value: legacy.data };
  throw current.error;
}
function encodeCursor(value: SelectionCursor) {
  return Buffer.from(
    JSON.stringify(selectionCursorSchema.parse(value)),
  ).toString('base64url');
}

type PageRow = {
  photoId: string | null;
  versionId: string | null;
  selectedAtMs: number | null;
  selectedAt: string | null;
  selectedCount: number;
  roundNo: number;
  selectionRevision: number;
  roundStatus: 'open' | 'submitted';
  submittedAt: string | null;
  canSubmit: number;
  policyMinimum: number;
  policyMaximum: number | null;
  policyRevision: number;
  policySource: 'system' | 'project' | 'album';
  policyProjectRevision: number;
  policyAlbumRevision: number;
  guestSelectionMarker: number;
};

export class D1GuestSelectionReader {
  constructor(private db: D1Database) {}

  async list(secret: string | null, albumId: string, cursorInput?: string) {
    const album = z.uuid().parse(albumId);
    const cursor = decodeCursor(cursorInput);
    if (!secret) throw new GuestAccessDenied();
    const secretHash = await hashGuestSessionSecret(secret);
    const rows = await this.db
      .prepare(
        `WITH guest_scope AS (
          SELECT s.id AS sessionId,g.id AS guestId,i.id AS inviteId,i.workspace_id AS workspaceId,
            i.project_id AS projectId,ia.album_id AS albumId,COALESCE(r.round_no,1) AS roundNo,
            COALESCE(r.selection_revision,0) AS selectionRevision,COALESCE(r.status,'open') AS roundStatus,
            (i.permissions_mask & 512)=512 AS canSubmit,COALESCE(effective_policy.minimum,1) AS policyMinimum,effective_policy.maximum AS policyMaximum,
            COALESCE(effective_policy.revision,0) AS policyRevision,COALESCE(effective_policy.source,'system') AS policySource,
            COALESCE(effective_policy.project_revision,0) AS policyProjectRevision,COALESCE(effective_policy.album_revision,0) AS policyAlbumRevision,
            CASE WHEN r.submitted_at_ms IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',r.submitted_at_ms/1000.0,'unixepoch') END AS submittedAt
          FROM guest_sessions s
          JOIN guest_identities g ON g.id=s.guest_id AND g.invite_id=s.invite_id
          JOIN guest_invites i ON i.id=s.invite_id
          JOIN guest_invite_seals seal ON seal.invite_id=i.id
          JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id AND ia.album_id=?
          JOIN albums a ON a.id=ia.album_id AND a.workspace_id=i.workspace_id AND a.project_id=i.project_id AND a.state='active'
          JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status NOT IN('archived','deleting','deleted')
          JOIN workspaces w ON w.id=i.workspace_id
          JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1
          LEFT JOIN effective_selection_policy effective_policy
            ON effective_policy.album_id=ia.album_id AND effective_policy.workspace_id=i.workspace_id AND effective_policy.project_id=i.project_id
          LEFT JOIN guest_selection_round_state r ON r.invite_id=i.id AND r.guest_id=g.id AND r.album_id=ia.album_id
          WHERE s.secret_hash=? AND (i.permissions_mask & ?)=?
            AND s.expires_at_ms>unixepoch('subsec')*1000 AND i.expires_at_ms>unixepoch('subsec')*1000
            AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations x WHERE x.invite_id=i.id)
            AND NOT EXISTS(SELECT 1 FROM guest_session_revocations x WHERE x.session_id=s.id)
        ), page_rows AS (
          SELECT st.photo_id AS photoId,st.version_id AS versionId,st.selected_at_ms AS selectedAtMs,
            strftime('%Y-%m-%dT%H:%M:%fZ',st.selected_at_ms/1000.0,'unixepoch') AS selectedAt
          FROM guest_scope gs JOIN guest_selection_state st
            ON st.invite_id=gs.inviteId AND st.guest_id=gs.guestId AND st.album_id=gs.albumId
          WHERE (? IS NULL OR (st.selected_at_ms,st.photo_id)<(?,?))
          ORDER BY st.selected_at_ms DESC,st.photo_id DESC LIMIT 25
        ), summary AS (
          SELECT gs.roundNo,gs.selectionRevision,gs.roundStatus,gs.submittedAt,gs.canSubmit,gs.policyMinimum,gs.policyMaximum,gs.policyRevision,
            gs.policySource,gs.policyProjectRevision,gs.policyAlbumRevision,
            (SELECT count(*) FROM guest_selection_state st WHERE st.invite_id=gs.inviteId AND st.guest_id=gs.guestId AND st.album_id=gs.albumId) AS selectedCount
          FROM guest_scope gs
        )
        SELECT p.photoId,p.versionId,p.selectedAtMs,p.selectedAt,s.selectedCount,s.roundNo,s.selectionRevision,s.roundStatus,s.submittedAt,s.canSubmit,s.policyMinimum,s.policyMaximum,s.policyRevision,
          s.policySource,s.policyProjectRevision,s.policyAlbumRevision,0 AS guestSelectionMarker
        FROM page_rows p CROSS JOIN summary s
        UNION ALL
        SELECT NULL,NULL,NULL,NULL,s.selectedCount,s.roundNo,s.selectionRevision,s.roundStatus,s.submittedAt,s.canSubmit,s.policyMinimum,s.policyMaximum,s.policyRevision,
          s.policySource,s.policyProjectRevision,s.policyAlbumRevision,1
        FROM summary s WHERE NOT EXISTS(SELECT 1 FROM page_rows)`,
      )
      .bind(
        album,
        secretHash,
        canSelectBit,
        canSelectBit,
        cursor?.value.selectedAtMs ?? null,
        cursor?.value.selectedAtMs ?? null,
        cursor?.value.photoId ?? null,
      )
      .all<PageRow>();
    if (!rows.results.length) throw new GuestAccessDenied();

    const summary = rows.results[0];
    if (!summary) throw new GuestAccessDenied();
    if (cursor) {
      if (cursor.kind === 'legacy')
        throw new WorkspaceFailure('SELECTION_CHANGED', 409);
      const value = cursor.value;
      if (value.albumId !== album)
        throw new WorkspaceFailure('INVALID_INPUT', 400);
      if (
        value.roundNo !== summary.roundNo ||
        value.selectionRevision !== summary.selectionRevision ||
        value.source !== summary.policySource ||
        value.albumRevision !== summary.policyAlbumRevision ||
        (value.source !== 'album' &&
          value.projectRevision !== summary.policyProjectRevision)
      )
        throw new WorkspaceFailure('SELECTION_CHANGED', 409);
    }
    const pageRows = rows.results.filter(
      (row) => row.guestSelectionMarker === 0,
    );
    const items = pageRows.slice(0, 24).map((row) => ({
      photoId: row.photoId,
      versionId: row.versionId,
      selectedAt: row.selectedAt,
    }));
    const last = pageRows[23];
    return guestSelectionPageSchema.parse({
      items,
      canSubmit: summary.canSubmit === 1,
      selectionPolicy: {
        minimum: summary.policyMinimum,
        maximum: summary.policyMaximum,
        revision: summary.policyRevision,
        mode: 'private',
        source: summary.policySource,
        projectRevision: summary.policyProjectRevision,
        albumRevision: summary.policyAlbumRevision,
      },
      selectedCount: summary.selectedCount,
      roundNo: summary.roundNo,
      selectionRevision: summary.selectionRevision,
      roundStatus: summary.roundStatus,
      submittedAt: summary.submittedAt,
      nextCursor:
        pageRows.length > 24 && last?.photoId && last.selectedAtMs !== null
          ? encodeCursor({
              albumId: album,
              roundNo: summary.roundNo,
              selectionRevision: summary.selectionRevision,
              source: summary.policySource,
              albumRevision: summary.policyAlbumRevision,
              ...(summary.policySource === 'album'
                ? {}
                : { projectRevision: summary.policyProjectRevision }),
              selectedAtMs: last.selectedAtMs,
              photoId: last.photoId,
            })
          : null,
    });
  }
}
