import { z } from 'zod';
import {
  ownerHistoryFiltersSchema,
  ownerHistoryQuerySchema,
  ownerHistoryPageSchema,
  ownerHistoryEventSchema,
  ownerHistoryExportRequestSchema,
  type OwnerHistoryFilters,
  type OwnerHistoryEvent,
  type OwnerHistoryPage,
} from '../../../packages/contracts/src/owner-history';
import { projectOwnerHistoryDetails } from './owner-history-projection';
import { WorkspaceFailure } from './workspaces';

const PAGE_SIZE = 24;
const TTL = 900;
const rowId = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((v) => v.length < 19 || v <= '9223372036854775807');
const claimsSchema = z
  .object({
    version: z.literal(1),
    purpose: z.enum(['snapshot', 'cursor']),
    ownerId: z.uuid(),
    workspaceId: z.uuid(),
    filters: ownerHistoryFiltersSchema,
    high: rowId,
    afterTime: z.iso.datetime().nullable(),
    afterId: z.string().min(1).max(512).nullable(),
    issuedAt: z.number().int().nonnegative().safe(),
    expiresAt: z.number().int().positive().safe(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.expiresAt !== v.issuedAt + TTL ||
      (v.purpose === 'snapshot'
        ? v.afterTime !== null || v.afterId !== null
        : v.afterTime === null || v.afterId === null)
    )
      c.addIssue({ code: 'custom', message: 'Invalid history position' });
  });
type Claims = z.infer<typeof claimsSchema>;
type Bind = string | number | null;
function fail(code: string, status: 400 | 403 | 404 | 409 | 503): never {
  throw new WorkspaceFailure(code, status);
}
function invalid(): never {
  return fail('INVALID_INPUT', 400);
}
function unavailable(): never {
  return fail('OWNER_HISTORY_UNAVAILABLE', 503);
}
const authSql = `authorized AS (SELECT o.user_id AS owner_id,w.id AS workspace_id FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 JOIN workspaces w ON w.id=? AND w.owner_user_id=o.user_id WHERE o.enabled=1 AND o.user_id=?)`;
function canonicalFilter(f: OwnerHistoryFilters): OwnerHistoryFilters {
  return ownerHistoryFiltersSchema.parse({
    projectId: f.projectId,
    albumId: f.albumId,
    photoId: f.photoId,
    versionId: f.versionId,
    inviteId: f.inviteId,
    actorType: f.actorType,
    actorId: f.actorId,
    action: f.action,
    from: f.from === undefined ? undefined : new Date(f.from).toISOString(),
    to: f.to === undefined ? undefined : new Date(f.to).toISOString(),
  });
}
function safeFilterJson(f: OwnerHistoryFilters) {
  return JSON.stringify(canonicalFilter(f));
}
const encoder = new TextEncoder();
async function key(secret: string) {
  if (secret.length < 32) unavailable();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
function message(payload: string) {
  return encoder.encode('kino-pic:owner-history:v1:' + payload);
}
async function sign(claims: Claims, secret: string) {
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = await crypto.subtle.sign('HMAC', await key(secret), message(p));
  return p + '.' + Buffer.from(sig).toString('base64url');
}
async function verify(
  token: string,
  secret: string,
  ownerId: string,
  workspaceId: string,
  purpose: Claims['purpose'],
): Promise<Claims> {
  if (token.length > 8192) invalid();
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))
  )
    invalid();
  const payload = Buffer.from(parts[0]!, 'base64url');
  const signature = Buffer.from(parts[1]!, 'base64url');
  if (
    signature.length !== 32 ||
    payload.toString('base64url') !== parts[0] ||
    signature.toString('base64url') !== parts[1]
  )
    invalid();
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      signature,
      message(parts[0]!),
    ))
  )
    invalid();
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(payload),
    );
  } catch {
    return invalid();
  }
  const parsed = claimsSchema.safeParse(decoded);
  if (!parsed.success) invalid();
  const c = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  if (
    c.ownerId !== ownerId ||
    c.workspaceId !== workspaceId ||
    c.purpose !== purpose
  )
    invalid();
  if (c.issuedAt > now || c.expiresAt <= now)
    return fail('HISTORY_SNAPSHOT_EXPIRED', 409);
  return { ...c, filters: canonicalFilter(c.filters) };
}
const auditAfter = `CASE WHEN json_valid(e.after_json) THEN e.after_json ELSE '{}' END`;
const auditBefore = `CASE WHEN json_valid(e.before_json) THEN e.before_json ELSE '{}' END`;
const reopenInvite = `(SELECT ri.id FROM guest_invites ri JOIN guest_identities rg ON rg.invite_id=ri.id AND rg.id=substr(e.event_id,length('guest-selection-reopen:')+38,36) JOIN guest_invite_albums ra ON ra.invite_id=ri.id AND ra.album_id=e.album_id AND ra.workspace_id=e.workspace_id AND ra.project_id=e.project_id WHERE ri.id=substr(e.event_id,length('guest-selection-reopen:')+1,36) AND ri.workspace_id=e.workspace_id AND ri.project_id=e.project_id AND e.action='selection.reopened' AND json_type(${auditAfter},'$.roundNo')='integer' AND e.event_id='guest-selection-reopen:'||ri.id||':'||rg.id||':'||e.album_id||':'||json_extract(${auditAfter},'$.roundNo'))`;
const inviteExpression = `COALESCE(hs.invite_id,hg.invite_id,
 (SELECT ch.invite_id FROM owner_comment_changes ch WHERE ch.event_id=e.event_id AND ch.workspace_id=e.workspace_id AND ch.actor_id=e.actor_id),
 (SELECT ch.invite_id FROM owner_comment_processing_changes ch WHERE ch.event_id=e.event_id AND ch.workspace_id=e.workspace_id AND ch.actor_id=e.actor_id),
 (SELECT ch.invite_id FROM owner_annotation_changes ch WHERE ch.event_id=e.event_id AND ch.workspace_id=e.workspace_id AND ch.actor_id=e.actor_id),
 (SELECT ch.invite_id FROM owner_annotation_processing_changes ch WHERE ch.event_id=e.event_id AND ch.workspace_id=e.workspace_id AND ch.actor_id=e.actor_id),
 CASE WHEN e.action='share.revoked' THEN (SELECT rc.invite_id FROM invite_revocation_commands rc WHERE rc.actor_id=e.actor_id AND rc.request_id=e.request_id) END,
 CASE WHEN e.action IN('download.requested','download.generated') THEN COALESCE((SELECT sub.invite_id FROM guest_selection_submissions sub WHERE sub.id=json_extract(${auditAfter},'$.submissionId') AND sub.workspace_id=e.workspace_id AND sub.project_id=e.project_id AND sub.album_id=e.album_id),(SELECT sub.invite_id FROM shared_review_submissions sub WHERE sub.id=json_extract(${auditAfter},'$.submissionId') AND sub.workspace_id=e.workspace_id AND sub.project_id=e.project_id AND sub.album_id=e.album_id)) END,
 ${reopenInvite},
 CASE WHEN e.action IN('share.created','share.scope_sealed','guest.session_created','security.guest_kdf_acquired','security.guest_kdf_released','selection.round_initialized') THEN COALESCE(json_extract(${auditAfter},'$.inviteId'),json_extract(${auditBefore},'$.inviteId')) END)`;
const relatedInvitesExpression = `CASE WHEN ci.id IS NOT NULL THEN json_array(ci.id) WHEN e.action IN('shared_review.created','shared_review.reopened') THEN (SELECT json_group_array(invite_id) FROM (SELECT si.invite_id FROM shared_review_invites si JOIN guest_invites ii ON ii.id=si.invite_id AND ii.workspace_id=si.workspace_id AND ii.project_id=si.project_id AND ii.created_by=auth.owner_id JOIN guest_invite_seals iseal ON iseal.invite_id=ii.id JOIN shared_reviews sr ON sr.id=si.review_id AND sr.workspace_id=si.workspace_id AND sr.project_id=si.project_id AND sr.album_id=si.album_id JOIN shared_review_seals rseal ON rseal.review_id=sr.id WHERE si.review_id=json_extract(${auditAfter},'$.reviewId') AND si.workspace_id=e.workspace_id AND si.project_id=e.project_id AND si.album_id=e.album_id ORDER BY si.invite_id)) ELSE '[]' END`;
const joins = `LEFT JOIN guest_sessions hs ON hs.id=e.guest_session_id AND e.actor_type='guest' AND hs.guest_id=e.actor_id LEFT JOIN guest_identities hg ON hg.id=e.actor_id AND e.actor_type='guest' LEFT JOIN guest_invites ci ON ci.id=${inviteExpression} AND ci.workspace_id=e.workspace_id AND ci.project_id=e.project_id AND ci.created_by=auth.owner_id AND EXISTS(SELECT 1 FROM guest_invite_seals sealed WHERE sealed.invite_id=ci.id) LEFT JOIN users hu ON hu.id=e.actor_id AND e.actor_type='user'`;

type EventRow = {
  event_id: string;
  actor_type: 'user' | 'guest' | 'system';
  actor_id: string | null;
  guest_session_id: string | null;
  session_id: string | null;
  workspace_id: string;
  project_id: string | null;
  album_id: string | null;
  photo_id: string | null;
  version_id: string | null;
  action: string;
  before_json: string | null;
  after_json: string | null;
  request_id: string;
  occurred_at_utc: string;
  invite_id: string | null;
  related_invite_ids: string;
  actor_label: string | null;
};
export class D1OwnerHistoryRepository {
  constructor(
    private readonly db: D1Database,
    private readonly ownerId: string,
    private readonly sessionId: string,
    private readonly secret: string,
  ) {}
  private authBindings(workspace: string): Bind[] {
    return [this.sessionId, workspace, this.ownerId];
  }
  private async scope(
    workspace: string,
    filters: OwnerHistoryFilters,
    captureHigh = false,
  ): Promise<string> {
    const values = this.authBindings(workspace);
    const guards: string[] = [];
    for (const [field, table, column] of [
      ['projectId', 'projects', 'project_id'],
      ['albumId', 'albums', 'album_id'],
      ['photoId', 'photos', 'photo_id'],
      ['versionId', 'photo_versions', 'version_id'],
    ] as const) {
      const id = filters[field];
      if (id !== undefined) {
        guards.push(
          `(EXISTS(SELECT 1 FROM ${table} r WHERE r.id=? AND r.workspace_id=auth.workspace_id) OR (NOT EXISTS(SELECT 1 FROM ${table} r WHERE r.id=?) AND EXISTS(SELECT 1 FROM audit_events h WHERE h.workspace_id=auth.workspace_id AND h.${column}=?)))`,
        );
        values.push(id, id, id);
      }
    }
    if (filters.inviteId !== undefined) {
      guards.push(
        `EXISTS(SELECT 1 FROM guest_invites i JOIN guest_invite_seals seal ON seal.invite_id=i.id WHERE i.id=? AND i.workspace_id=auth.workspace_id AND i.created_by=auth.owner_id)`,
      );
      values.push(filters.inviteId);
    }
    let result: { high: string; scope_allowed: number } | null;
    try {
      result = await this.db
        .prepare(
          `WITH ${authSql} SELECT ${captureHigh ? 'CAST(COALESCE((SELECT rowid FROM audit_events INDEXED BY audit_owner_history_workspace_rowid WHERE workspace_id=auth.workspace_id ORDER BY rowid DESC LIMIT 1),0) AS TEXT)' : "'0'"} AS high,CASE WHEN ${guards.length ? guards.join(' AND ') : '1'} THEN 1 ELSE 0 END AS scope_allowed FROM authorized auth`,
        )
        .bind(...values)
        .first();
    } catch {
      return unavailable();
    }
    if (!result) {
      await this.assertOwner();
      return fail('NOT_FOUND', 404);
    }
    if (result.scope_allowed !== 1) return fail('NOT_FOUND', 404);
    return rowId.parse(result.high);
  }
  private async assertOwner() {
    const r = await this.db
      .prepare(
        `SELECT 1 AS ok FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE o.user_id=? AND o.enabled=1`,
      )
      .bind(this.sessionId, this.ownerId)
      .first();
    if (!r) return fail('OWNER_REQUIRED', 403);
  }
  private async read(
    workspace: string,
    c: Claims,
  ): Promise<OwnerHistoryEvent[]> {
    const values = this.authBindings(workspace);
    const conditions = ['e.rowid<=?'];
    values.push(c.high);
    for (const [field, column] of [
      ['projectId', 'project_id'],
      ['photoId', 'photo_id'],
      ['versionId', 'version_id'],
      ['actorType', 'actor_type'],
      ['actorId', 'actor_id'],
      ['action', 'action'],
    ] as const) {
      if (c.filters[field] !== undefined) {
        conditions.push(`e.${column}=?`);
        values.push(c.filters[field]!);
      }
    }
    if (c.filters.albumId !== undefined) {
      conditions.push(
        `(e.album_id=? OR (e.album_id IS NULL AND ci.id IS NOT NULL AND EXISTS(SELECT 1 FROM guest_invite_albums ia WHERE ia.invite_id=ci.id AND ia.workspace_id=e.workspace_id AND ia.project_id=e.project_id AND ia.album_id=?)))`,
      );
      values.push(c.filters.albumId, c.filters.albumId);
    }
    if (c.filters.inviteId !== undefined) {
      conditions.push(
        `EXISTS(SELECT 1 FROM json_each(${relatedInvitesExpression}) rel WHERE rel.value=?)`,
      );
      values.push(c.filters.inviteId);
    }
    if (c.filters.from !== undefined) {
      conditions.push('e.occurred_at_utc>=?');
      values.push(c.filters.from);
    }
    if (c.filters.to !== undefined) {
      conditions.push('e.occurred_at_utc<?');
      values.push(c.filters.to);
    }
    if (c.afterTime !== null) {
      conditions.push(
        '(e.occurred_at_utc<? OR (e.occurred_at_utc=? AND e.event_id<?))',
      );
      values.push(c.afterTime, c.afterTime, c.afterId);
    }
    let rows: EventRow[];
    try {
      const r = await this.db
        .prepare(
          `WITH ${authSql} SELECT e.*,ci.id AS invite_id,${relatedInvitesExpression} AS related_invite_ids,CASE WHEN e.actor_type='guest' AND hg.invite_id=ci.id THEN hg.display_name WHEN e.actor_type='user' THEN hu.name ELSE NULL END AS actor_label FROM audit_events e JOIN authorized auth ON auth.workspace_id=e.workspace_id ${joins} WHERE ${conditions.join(' AND ')} ORDER BY e.occurred_at_utc DESC,e.event_id DESC LIMIT ${PAGE_SIZE + 1}`,
        )
        .bind(...values)
        .all<EventRow>();
      if (!r.success) return unavailable();
      rows = r.results;
    } catch {
      return unavailable();
    }
    // A denied query and an authorized empty page must not be confused.
    await this.scope(workspace, c.filters);
    return rows.map((r) => {
      const parsed = ownerHistoryEventSchema.safeParse({
        eventId: r.event_id,
        occurredAt: r.occurred_at_utc,
        actor: {
          type: r.actor_type,
          id: r.actor_id,
          label:
            r.actor_label?.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, '') ||
            null,
        },
        workspaceId: r.workspace_id,
        projectId: r.project_id,
        albumId: r.album_id,
        photoId: r.photo_id,
        versionId: r.version_id,
        inviteId: r.invite_id,
        relatedInviteIds: JSON.parse(r.related_invite_ids) as unknown,
        sessionId: r.session_id,
        guestSessionId: r.guest_session_id,
        requestId: r.request_id,
        action: r.action,
        details: projectOwnerHistoryDetails(
          r.action,
          r.before_json,
          r.after_json,
        ),
      });
      if (!parsed.success) return unavailable();
      return parsed.data;
    });
  }
  async page(
    workspaceInput: string,
    input: unknown,
  ): Promise<OwnerHistoryPage> {
    const workspace = z.uuid().parse(workspaceInput);
    const parsed = ownerHistoryQuerySchema.safeParse(input);
    if (!parsed.success) return invalid();
    const { cursor, ...rawFilters } = parsed.data;
    const filters = canonicalFilter(rawFilters);
    const high = await this.scope(workspace, filters, !cursor);
    const now = Math.floor(Date.now() / 1000);
    const claims: Claims = cursor
      ? await verify(cursor, this.secret, this.ownerId, workspace, 'cursor')
      : {
          version: 1,
          purpose: 'snapshot',
          ownerId: this.ownerId,
          workspaceId: workspace,
          filters,
          high,
          afterTime: null,
          afterId: null,
          issuedAt: now,
          expiresAt: now + TTL,
        };
    if (safeFilterJson(claims.filters) !== safeFilterJson(filters))
      return invalid();
    const rows = await this.read(workspace, claims);
    const items = rows.slice(0, PAGE_SIZE);
    const last = items.at(-1);
    const snapshot = {
      ...claims,
      purpose: 'snapshot' as const,
      afterTime: null,
      afterId: null,
    };
    return ownerHistoryPageSchema.parse({
      ownerId: this.ownerId,
      workspaceId: workspace,
      snapshotToken: await sign(snapshot, this.secret),
      items,
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? await sign(
              {
                ...claims,
                purpose: 'cursor',
                afterTime: last.occurredAt,
                afterId: last.eventId,
              },
              this.secret,
            )
          : null,
    });
  }
  private async exportAudit(
    workspace: string,
    generationId: string,
    action: 'owner_history.export_started' | 'owner_history.export_completed',
    data: Record<string, unknown>,
  ) {
    const r = await this.db
      .prepare(
        `WITH ${authSql} INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,action,after_json,request_id) SELECT ?,'user',auth.owner_id,?,auth.workspace_id,?,?,? FROM authorized auth`,
      )
      .bind(
        ...this.authBindings(workspace),
        crypto.randomUUID(),
        this.sessionId,
        action,
        JSON.stringify(data),
        generationId,
      )
      .run();
    if (r.meta.changes !== 1) return fail('OWNER_REQUIRED', 403);
  }
  async export(workspaceInput: string, input: unknown): Promise<Response> {
    const workspace = z.uuid().parse(workspaceInput);
    const command = ownerHistoryExportRequestSchema.parse(input);
    if (command.expectedOwnerId !== this.ownerId)
      return fail('OWNER_IDENTITY_CHANGED', 409);
    const claims = await verify(
      command.snapshotToken,
      this.secret,
      this.ownerId,
      workspace,
      'snapshot',
    );
    await this.scope(workspace, claims.filters);
    let rows = await this.read(workspace, claims);
    let position: Claims = claims;
    const generationId = crypto.randomUUID();
    const metadata = {
      generationId,
      format: command.format,
      snapshotRowId: claims.high,
      filters: claims.filters,
    };
    await this.exportAudit(
      workspace,
      generationId,
      'owner_history.export_started',
      metadata,
    );
    let count = 0;
    let header = false;
    let finished = false;
    let cancelled = false;
    let first = true;
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          if (cancelled || finished) return;
          await this.scope(workspace, claims.filters);
          if (cancelled) return;
          if (Math.floor(Date.now() / 1000) >= claims.expiresAt)
            return fail('HISTORY_SNAPSHOT_EXPIRED', 409);
          if (!header) {
            header = true;
            controller.enqueue(
              encoder.encode(
                command.format === 'json'
                  ? JSON.stringify({
                      version: 1,
                      ...metadata,
                      workspaceId: workspace,
                    }).slice(0, -1) + ',"events":['
                  : csvHeader,
              ),
            );
            return;
          }
          const items = rows.slice(0, PAGE_SIZE);
          if (items.length) {
            const chunk =
              command.format === 'json'
                ? items
                    .map((item) => {
                      const prefix = first ? '' : ',';
                      first = false;
                      return prefix + JSON.stringify(item);
                    })
                    .join('')
                : items.map(csvRow).join('');
            if (cancelled) return;
            controller.enqueue(encoder.encode(chunk));
            count += items.length;
          }
          if (rows.length > PAGE_SIZE) {
            const last = items.at(-1)!;
            position = {
              ...position,
              purpose: 'cursor',
              afterTime: last.occurredAt,
              afterId: last.eventId,
            };
            rows = await this.read(workspace, position);
            return;
          }
          if (cancelled) return;
          await this.exportAudit(
            workspace,
            generationId,
            'owner_history.export_completed',
            { ...metadata, count },
          );
          if (cancelled) return;
          finished = true;
          if (command.format === 'json')
            controller.enqueue(
              encoder.encode('],"count":' + count + ',"complete":true}'),
            );
          controller.close();
        } catch {
          finished = true;
          if (!cancelled)
            controller.error(new Error('OWNER_HISTORY_EXPORT_FAILED'));
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(body, {
      headers: {
        'Content-Type':
          command.format === 'json'
            ? 'application/json; charset=utf-8'
            : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="history-${workspace}.${command.format}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Kino-History-Generation': generationId,
      },
    });
  }
}
const csvFields = [
  'eventId',
  'occurredAt',
  'action',
  'actorType',
  'actorId',
  'actorLabel',
  'workspaceId',
  'projectId',
  'albumId',
  'photoId',
  'versionId',
  'inviteId',
  'relatedInviteIds',
  'sessionId',
  'guestSessionId',
  'requestId',
  'detailsStatus',
  'before',
  'after',
];
const csvHeader = csvFields.join(',') + '\r\n';
export function ownerHistoryCsvCell(input: string | null): string {
  const s = input ?? '';
  const safe = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function csvRow(e: OwnerHistoryEvent) {
  return (
    [
      e.eventId,
      e.occurredAt,
      e.action,
      e.actor.type,
      e.actor.id,
      e.actor.label,
      e.workspaceId,
      e.projectId,
      e.albumId,
      e.photoId,
      e.versionId,
      e.inviteId,
      JSON.stringify(e.relatedInviteIds),
      e.sessionId,
      e.guestSessionId,
      e.requestId,
      e.details.status,
      e.details.before === null ? null : JSON.stringify(e.details.before),
      e.details.after === null ? null : JSON.stringify(e.details.after),
    ]
      .map(ownerHistoryCsvCell)
      .join(',') + '\r\n'
  );
}
