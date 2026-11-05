import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import {
  createInviteSchema,
  createdInviteSchema,
  inviteCreationResponseSchema,
} from '../../../packages/contracts/src/invites';
import {
  guestPermissionNames,
  guestPermissionBit,
} from '../../../packages/contracts/src/guest-access';
import {
  createGuestPasswordVerifier,
  createGeneratedGuestPasswordVerifier,
  generateGuestPassword,
  generateGuestBearer,
  guestPasswordSchema,
  hashGuestInviteToken,
} from './guest-credentials';
import { configuration, type WorkerEnv } from './config';
import { WorkspaceFailure } from './workspaces';
import { withOwnerKdfPermit } from './kdf-permits';
import {
  guestCoreRuntimeAllowed,
  STAGING_GUEST_SCOPE,
  stagingGuestValidationEnabled,
} from './staging-guest-scope';
import {
  stagingGuestPermissionMaskSupported,
  stagingGuestPermissionsSupported,
} from './staging-guest-permissions';
const storedStagingInvitePayloadSchema = z.object({
  projectId: z.uuid(),
  albumIds: z.array(z.uuid()).min(1).max(1),
  accessMode: z.literal('link_only'),
  permissionsMask: z.number().int().min(0).max(4095),
});

function hasOnlyStagingPermissions(
  permissions: z.infer<typeof createInviteSchema>['permissions'],
  env: WorkerEnv,
) {
  return stagingGuestPermissionsSupported(env, permissions);
}

function storedStagingInvitePayloadAllowed(payload: string, env: WorkerEnv) {
  try {
    const parsed = storedStagingInvitePayloadSchema.safeParse(
      JSON.parse(payload) as unknown,
    );
    return (
      parsed.success &&
      parsed.data.projectId === STAGING_GUEST_SCOPE.projectId &&
      parsed.data.albumIds[0] === STAGING_GUEST_SCOPE.albumId &&
      stagingGuestPermissionMaskSupported(env, parsed.data.permissionsMask)
    );
  } catch {
    return false;
  }
}

function assertStagingInviteScope(
  projectId: string,
  value: z.infer<typeof createInviteSchema>,
  env: WorkerEnv,
) {
  if (
    projectId !== STAGING_GUEST_SCOPE.projectId ||
    value.albumIds.length !== 1 ||
    value.albumIds[0] !== STAGING_GUEST_SCOPE.albumId ||
    !hasOnlyStagingPermissions(value.permissions, env)
  )
    throw new WorkspaceFailure('INVALID_INVITE_SCOPE', 409);
  if (value.accessMode !== 'link_only')
    throw new WorkspaceFailure('FEATURE_UNAVAILABLE', 503);
}

function sameCommitment(stored: unknown, expected: string) {
  if (
    typeof stored !== 'string' ||
    stored.length !== 64 ||
    !/^[a-f0-9]+$/.test(stored)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(stored, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}
function samePrivateValue(stored: unknown, expected: string | null) {
  if (expected === null) return stored === null;
  if (typeof stored !== 'string') return false;
  const left = Buffer.from(stored, 'utf8'),
    right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

export class D1InviteIssuance {
  constructor(
    private env: WorkerEnv,
    private actor: string,
    private session: string,
  ) {}
  private async authorize() {
    if (
      !(await this.env.DB.prepare(
        "SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 WHERE o.user_id=? AND o.enabled=1",
      )
        .bind(this.session, this.actor)
        .first())
    )
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }
  private async current(requestId: string) {
    return this.env.DB.prepare(
      `SELECT c.invite_id AS inviteId,i.workspace_id AS workspaceId,i.project_id AS projectId,
      strftime('%Y-%m-%dT%H:%M:%fZ',i.created_at_ms/1000.0,'unixepoch') AS createdAt,
      strftime('%Y-%m-%dT%H:%M:%fZ',i.expires_at_ms/1000.0,'unixepoch') AS expiresAt,
      c.payload_json,c.request_commitment
      ,c.token_hash,c.password_verifier
      FROM invite_creation_commands c JOIN guest_invites i ON i.id=c.invite_id
      JOIN workspaces w ON w.id=i.workspace_id AND w.owner_user_id=c.actor_id
      JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1
      JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000
      WHERE c.actor_id=? AND c.request_id=?`,
    )
      .bind(this.session, this.actor, requestId)
      .first();
  }
  async recovery(requestId: string) {
    z.uuid().parse(requestId);
    const stagingConfig =
      this.env.STAGING_GUEST_VALIDATION === 'true'
        ? configuration(this.env)
        : null;
    const stagingValidation =
      stagingConfig !== null && stagingGuestValidationEnabled(this.env);
    await this.authorize();
    const row = await this.current(requestId);
    if (!row) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (
      stagingValidation &&
      (row.workspaceId !== STAGING_GUEST_SCOPE.workspaceId ||
        row.projectId !== STAGING_GUEST_SCOPE.projectId ||
        !storedStagingInvitePayloadAllowed(String(row.payload_json), this.env))
    )
      throw new WorkspaceFailure('INVALID_INVITE_SCOPE', 409);
    const invite = createdInviteSchema.parse({
      inviteId: row.inviteId,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    });
    return inviteCreationResponseSchema.parse({
      invite,
      secretAvailable: false,
    });
  }
  async create(projectId: string, input: unknown) {
    z.uuid().parse(projectId);
    const value = createInviteSchema.parse(input);
    const stagingConfig =
      this.env.STAGING_GUEST_VALIDATION === 'true'
        ? configuration(this.env)
        : null;
    const stagingValidation =
      stagingConfig !== null && stagingGuestValidationEnabled(this.env);
    if (stagingValidation) assertStagingInviteScope(projectId, value, this.env);
    if (value.accessMode === 'custom_password')
      guestPasswordSchema.parse(value.password);
    await this.authorize();
    const config = stagingConfig ?? configuration(this.env);
    const payload = JSON.stringify({
      projectId,
      albumIds: [...value.albumIds].sort(),
      accessMode: value.accessMode,
      permissionsMask: guestPermissionNames.reduce(
        (mask, name) =>
          mask + (value.permissions[name] ? guestPermissionBit(name) : 0),
        0,
      ),
      expiresAtMs: Date.parse(value.expiresAt),
      maxUses: value.maxUses,
    });
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(
        z.string().min(32).parse(this.env.BETTER_AUTH_SECRET),
      ),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const requestCommitment = Buffer.from(
      await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(
          JSON.stringify([
            'kino-pic:invite-create-request:v1',
            this.actor,
            value.requestId,
            payload,
            value.password ?? null,
          ]),
        ),
      ),
    ).toString('hex');
    const previous = await this.current(value.requestId);
    if (previous) {
      if (
        previous.payload_json !== payload ||
        !sameCommitment(previous.request_commitment, requestCommitment)
      )
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      return this.recovery(value.requestId);
    }
    // Committed metadata replay is safe while disabled; new secrets/KDF are not.
    if (
      !guestCoreRuntimeAllowed(this.env) ||
      config.GUEST_INVITE_ISSUANCE_ENABLED !== 'true'
    )
      throw new WorkspaceFailure('INVITE_ISSUANCE_DISABLED', 503);
    const collision = await this.env.DB.prepare(
      'SELECT 1 FROM request_commands WHERE actor_id=? AND request_id=? UNION ALL SELECT 1 FROM upload_requests WHERE actor_id=? AND request_id=? UNION ALL SELECT 1 FROM upload_workflow_requests WHERE actor_id=? AND request_id=? UNION ALL SELECT 1 FROM processing_review_commands WHERE actor_id=? AND request_id=? UNION ALL SELECT 1 FROM invite_revocation_commands WHERE actor_id=? AND request_id=? LIMIT 1',
    )
      .bind(
        this.actor,
        value.requestId,
        this.actor,
        value.requestId,
        this.actor,
        value.requestId,
        this.actor,
        value.requestId,
        this.actor,
        value.requestId,
      )
      .first();
    if (collision) throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    // Validate current scope before spending KDF CPU; SQL repeats this at commit.
    const parent = await this.env.DB.prepare(
      "SELECT p.workspace_id FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=? AND w.owner_user_id=? AND p.status<>'archived'",
    )
      .bind(projectId, this.actor)
      .first<{ workspace_id: string }>();
    if (!parent) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (
      stagingConfig &&
      parent.workspace_id !== STAGING_GUEST_SCOPE.workspaceId
    )
      throw new WorkspaceFailure('INVALID_INVITE_SCOPE', 409);
    const scoped = await this.env.DB.prepare(
      "SELECT count(*) AS n FROM albums WHERE project_id=? AND state='active' AND id IN(SELECT value FROM json_each(?))",
    )
      .bind(projectId, JSON.stringify(value.albumIds))
      .first<{ n: number }>();
    if (scoped?.n !== value.albumIds.length)
      throw new WorkspaceFailure('INVALID_INVITE_SCOPE', 409);
    const candidateId = crypto.randomUUID(),
      token = generateGuestBearer();
    const generatedPassword =
      value.accessMode === 'generated_password'
        ? generateGuestPassword()
        : null;
    const password =
      value.accessMode === 'link_only'
        ? null
        : (generatedPassword ?? value.password);
    const verifier =
      password === null
        ? null
        : await withOwnerKdfPermit(
            this.env.DB,
            {
              actor: this.actor,
              session: this.session,
              requestId: value.requestId,
            },
            () =>
              value.accessMode === 'generated_password'
                ? createGeneratedGuestPasswordVerifier(password)
                : createGuestPasswordVerifier(password),
          );
    const tokenHash = await hashGuestInviteToken(token);
    let inserted = false;
    try {
      const execution = await this.env.DB.prepare(
        'INSERT INTO invite_creation_commands(actor_id,request_id,session_id,invite_id,project_id,payload_json,request_commitment,token_hash,password_verifier) VALUES(?,?,?,?,?,?,?,?,?)',
      )
        .bind(
          this.actor,
          value.requestId,
          this.session,
          candidateId,
          projectId,
          payload,
          requestCommitment,
          tokenHash,
          verifier,
        )
        .run();
      inserted = execution.meta.changes > 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      for (const code of [
        'OWNER_REQUIRED',
        'REQUEST_ID_CONFLICT',
        'NOT_FOUND',
        'INVALID_INVITE_SCOPE',
        'INVALID_INVITE_EXPIRY',
        'INVITE_EXPIRED',
        'INVITE_LIMIT_REACHED',
      ])
        if (message.includes(code))
          throw new WorkspaceFailure(
            code,
            code === 'OWNER_REQUIRED' ? 403 : code === 'NOT_FOUND' ? 404 : 409,
          );
      throw error;
    }
    const committed = await this.current(value.requestId);
    if (!committed) {
      await this.authorize();
      throw new WorkspaceFailure('INVITE_RESULT_UNAVAILABLE', 503);
    }
    if (
      committed.payload_json !== payload ||
      !sameCommitment(committed.request_commitment, requestCommitment)
    )
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    const invite = createdInviteSchema.parse({
      inviteId: committed.inviteId,
      workspaceId: committed.workspaceId,
      projectId: committed.projectId,
      createdAt: committed.createdAt,
      expiresAt: committed.expiresAt,
    });
    const won =
      inserted &&
      invite.inviteId === candidateId &&
      samePrivateValue(committed.token_hash, tokenHash) &&
      samePrivateValue(committed.password_verifier, verifier);
    return inviteCreationResponseSchema.parse(
      won
        ? { invite, secretAvailable: true, token, generatedPassword }
        : { invite, secretAvailable: false },
    );
  }
}
