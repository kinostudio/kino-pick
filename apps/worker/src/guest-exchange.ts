import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { guestExchangeRequestSchema } from '../../../packages/contracts/src/guest-access';
import {
  hashGuestInviteToken,
  generateGuestBearer,
  guestPasswordSchema,
  guestLoginPasswordSchema,
  verifyGuestPassword,
} from './guest-credentials';
import {
  D1GuestExchangeAdmission,
  canonicalTrustedClientAddress,
} from './guest-admission';
import { hashGuestSessionSecret } from './guest-access';
import { withGuestKdfPermit } from './kdf-permits';
import { configuration, type WorkerEnv } from './config';
import { WorkspaceFailure } from './workspaces';
import {
  guestCoreRuntimeAllowed,
  STAGING_GUEST_SCOPE,
  stagingGuestValidationEnabled,
  stagingCollaborationValidationEnabled,
  stagingGuestAlbumScopeAllowed,
} from './staging-guest-scope';
import { stagingGuestPermissionMaskSupported } from './staging-guest-permissions';

function denied(): never {
  throw new WorkspaceFailure('GUEST_ACCESS_REQUIRED', 401);
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

async function hmacCommitment(secret: string, value: unknown) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return Buffer.from(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  ).toString('hex');
}

export class D1GuestExchange {
  constructor(private env: WorkerEnv) {}

  async exchange(input: unknown, trustedAddress: unknown) {
    try {
      return await this.exchangeValidated(input, trustedAddress);
    } catch (error) {
      if (error instanceof WorkspaceFailure || error instanceof z.ZodError)
        throw error;
      throw new WorkspaceFailure('GUEST_EXCHANGE_UNAVAILABLE', 503);
    }
  }

  private async exchangeValidated(input: unknown, trustedAddress: unknown) {
    const config = configuration(this.env);
    if (
      !guestCoreRuntimeAllowed(this.env) ||
      config.GUEST_EXCHANGE_ENABLED !== 'true'
    )
      throw new WorkspaceFailure('GUEST_EXCHANGE_DISABLED', 503);
    const stagingValidation = stagingGuestValidationEnabled(this.env);

    const value = guestExchangeRequestSchema.parse(input);
    if (!canonicalTrustedClientAddress(trustedAddress)) denied();
    const secret = this.env.BETTER_AUTH_SECRET;
    if (typeof secret !== 'string' || secret.length < 32)
      throw new WorkspaceFailure('GUEST_EXCHANGE_UNAVAILABLE', 503);

    const tokenHash = await hashGuestInviteToken(value.token);
    const inviteRef = await this.env.DB.prepare(
      'SELECT id FROM guest_invites WHERE token_hash=?',
    )
      .bind(tokenHash)
      .first<{ id: string }>();
    if (inviteRef) {
      const commitment = await hmacCommitment(secret, [
        'kino-pic:guest-exchange-request:v1',
        inviteRef.id,
        value.requestId,
        tokenHash,
        value.displayName,
        value.password ?? null,
      ]);
      const replay = await this.env.DB.prepare(
        'SELECT request_commitment FROM guest_exchange_commands WHERE invite_id=? AND request_id=?',
      )
        .bind(inviteRef.id, value.requestId)
        .first<{ request_commitment: string }>();
      if (replay && sameCommitment(replay.request_commitment, commitment)) {
        // Exact retries and mismatched request-ID reuse both fail closed. The one-time
        // cookie secret is never recovered from D1 after a lost HTTP response.
        denied();
      }
      if (replay) denied();
    }

    const admission = await new D1GuestExchangeAdmission(this.env.DB, secret)
      .consume({ trustedAddress, token: value.token })
      .catch(() => {
        throw new WorkspaceFailure('GUEST_EXCHANGE_UNAVAILABLE', 503);
      });
    if (!admission.allowed) denied();

    const invite = await this.env.DB.prepare(
      `SELECT i.id,i.token_hash,i.access_mode,i.password_verifier,i.expires_at_ms,
         i.workspace_id,i.project_id,i.permissions_mask,i.created_by,
         (SELECT count(*) FROM guest_invite_albums ia WHERE ia.invite_id=i.id) AS invite_album_count,
         (SELECT max(ia.album_id) FROM guest_invite_albums ia WHERE ia.invite_id=i.id) AS invite_album_id
       FROM guest_invites i JOIN workspaces w ON w.id=i.workspace_id
       JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1 AND i.created_by=o.user_id
       JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id AND p.status<>'archived'
       WHERE i.token_hash=? AND i.expires_at_ms>unixepoch('subsec')*1000
         AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=i.id)
         AND EXISTS(SELECT 1 FROM guest_invite_seals x WHERE x.invite_id=i.id)
         AND EXISTS(SELECT 1 FROM guest_invite_albums ia JOIN albums a ON a.id=ia.album_id AND a.workspace_id=ia.workspace_id AND a.project_id=ia.project_id WHERE ia.invite_id=i.id AND a.state='active')
         AND (i.max_uses IS NULL OR (SELECT count(*) FROM guest_sessions s WHERE s.invite_id=i.id)<i.max_uses)`,
    )
      .bind(tokenHash)
      .first<{
        id: string;
        token_hash: string;
        access_mode: 'link_only' | 'generated_password' | 'custom_password';
        password_verifier: string | null;
        expires_at_ms: number;
        workspace_id: string;
        project_id: string;
        permissions_mask: number;
        created_by: string;
        invite_album_count: number;
        invite_album_id: string | null;
      }>();
    if (!invite) denied();
    if (
      stagingValidation &&
      (invite.workspace_id !== STAGING_GUEST_SCOPE.workspaceId ||
        invite.invite_album_count !== 1 ||
        !invite.invite_album_id ||
        !(await stagingGuestAlbumScopeAllowed(
          this.env.DB,
          invite.created_by,
          invite.project_id,
          invite.invite_album_id,
          stagingCollaborationValidationEnabled(this.env),
        )) ||
        invite.access_mode !== 'link_only' ||
        !stagingGuestPermissionMaskSupported(this.env, invite.permissions_mask))
    )
      denied();

    let kdfPermitId: string | null = null;
    if (invite.access_mode === 'link_only') {
      if (value.password !== undefined) denied();
    } else {
      const password = (
        invite.access_mode === 'generated_password'
          ? guestLoginPasswordSchema
          : guestPasswordSchema
      ).safeParse(value.password);
      if (!password.success) denied();
      const checked = await withGuestKdfPermit(
        this.env.DB,
        { inviteId: invite.id, requestId: value.requestId },
        () => verifyGuestPassword(password.data, invite.password_verifier),
      );
      kdfPermitId = checked.permitId;
      if (!checked.result) denied();
    }

    const candidate = {
      commandId: crypto.randomUUID(),
      guestId: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      sessionSecret: generateGuestBearer(),
    };
    const sessionHash = await hashGuestSessionSecret(candidate.sessionSecret);
    const requestCommitment = await hmacCommitment(secret, [
      'kino-pic:guest-exchange-request:v1',
      invite.id,
      value.requestId,
      tokenHash,
      value.displayName,
      value.password ?? null,
    ]);

    let writeError: unknown;
    try {
      const results = await this.env.DB.batch([
        this.env.DB.prepare(
          'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
        ).bind(candidate.guestId, invite.id, value.displayName),
        this.env.DB.prepare(
          `INSERT INTO guest_exchange_commands(id,invite_id,invite_token_hash,request_id,request_commitment,guest_id,session_id,session_secret_hash,password_verified,kdf_permit_id)
           VALUES(?,?,?,?,?,?,?,?,1,?)`,
        ).bind(
          candidate.commandId,
          invite.id,
          tokenHash,
          value.requestId,
          requestCommitment,
          candidate.guestId,
          candidate.sessionId,
          sessionHash,
          kdfPermitId,
        ),
      ]);
      if (!results.every((result) => result.success))
        writeError = new Error('Guest exchange write was not confirmed');
    } catch (error) {
      writeError = error;
    }

    let committed: {
      id: string;
      invite_id: string;
      request_commitment: string;
      session_id: string;
      session_secret_hash: string;
      expires_at_ms: number;
      ttl_ms: number;
    } | null;
    try {
      const primary = this.env.DB.withSession('first-primary');
      committed = await primary
        .prepare(
          `SELECT c.id,c.invite_id,c.request_commitment,c.session_id,c.session_secret_hash,s.expires_at_ms,
             s.expires_at_ms-CAST(unixepoch('subsec')*1000 AS INTEGER) AS ttl_ms
           FROM guest_exchange_commands c JOIN guest_sessions s ON s.id=c.session_id
           WHERE c.id=? AND c.invite_id=? AND c.request_id=?`,
        )
        .bind(candidate.commandId, invite.id, value.requestId)
        .first();
    } catch {
      throw new WorkspaceFailure('GUEST_EXCHANGE_UNAVAILABLE', 503);
    }
    if (!committed) {
      const message = writeError instanceof Error ? writeError.message : '';
      if (
        [
          'GUEST_ACCESS_REQUIRED',
          'REQUEST_ID_CONFLICT',
          'INVALID_GUEST_SESSION_TIME',
        ].some((code) => message.includes(code))
      )
        denied();
      throw new WorkspaceFailure('GUEST_EXCHANGE_UNAVAILABLE', 503);
    }
    if (
      committed.id !== candidate.commandId ||
      committed.invite_id !== invite.id ||
      committed.session_id !== candidate.sessionId ||
      committed.session_secret_hash !== sessionHash ||
      !sameCommitment(committed.request_commitment, requestCommitment)
    )
      denied();

    const expiresAt = new Date(committed.expires_at_ms).toISOString();
    const maxAge = Math.max(1, Math.floor(committed.ttl_ms / 1000));
    return {
      authenticated: true as const,
      expiresAt,
      sessionSecret: candidate.sessionSecret,
      maxAge,
    };
  }
}
