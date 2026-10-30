import { z } from 'zod';
import { hashGuestInviteToken } from './guest-credentials';

const WINDOW_MS = 5 * 60 * 1000;
const RETAIN_MS = 24 * 60 * 60 * 1000;
const MAX_BUCKET_ROWS = 100_000;
const limits = { network: 20, invite_network: 5, invite: 50 } as const;
const tokenSchema = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);

export function canonicalTrustedClientAddress(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64 || input.includes('%'))
    return null;
  const value = input.trim();
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part, i) => part > 255 || String(part) !== ipv4[i + 1]))
      return null;
    return parts.join('.');
  }
  if (!value.includes(':') || value.includes('[') || value.includes(']'))
    return null;
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) return null;
    const canonical = hostname.slice(1, -1).toLowerCase();
    const parts = canonical.split('::');
    if (parts.length > 2) return null;
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const groups =
      parts.length === 1
        ? left.map((part) => Number.parseInt(part, 16))
        : [
            ...left.map((part) => Number.parseInt(part, 16)),
            ...Array<number>(8 - left.length - right.length).fill(0),
            ...right.map((part) => Number.parseInt(part, 16)),
          ];
    if (
      groups.length !== 8 ||
      groups.some((n) => !Number.isInteger(n) || n < 0 || n > 0xffff)
    )
      return null;
    if (groups.slice(0, 5).every((n) => n === 0) && groups[5] === 0xffff) {
      return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
    }
    return canonical;
  } catch {
    return null;
  }
}

async function keyedHash(secret: string, purpose: string, value: string) {
  if (secret.length < 32) throw new Error('GUEST_ADMISSION_UNAVAILABLE');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`kino-pic:guest-admission:v1:${purpose}:${value}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class D1GuestExchangeAdmission {
  constructor(
    private db: D1Database,
    private secret: string,
  ) {}

  async consume(input: { trustedAddress: unknown; token: unknown }) {
    const address = canonicalTrustedClientAddress(input.trustedAddress);
    if (!address) throw new Error('GUEST_ADMISSION_UNAVAILABLE');
    const networkHash = await keyedHash(this.secret, 'network', address);
    let inviteId: string | null = null;
    const token = tokenSchema.safeParse(input.token);
    if (token.success) {
      const tokenHash = await hashGuestInviteToken(token.data);
      const invite = await this.db
        .prepare('SELECT id FROM guest_invites WHERE token_hash=?')
        .bind(tokenHash)
        .first<{ id: string }>();
      inviteId = invite?.id ?? null;
    }
    const pairHash = inviteId
      ? await keyedHash(
          this.secret,
          'invite-network',
          `${inviteId}\0${address}`,
        )
      : null;
    const inviteHash = inviteId
      ? await keyedHash(this.secret, 'invite', inviteId)
      : null;
    const result = await this.db
      .prepare(
        `WITH clock(now_ms) AS MATERIALIZED (
           SELECT CAST(unixepoch('subsec')*1000 AS INTEGER)
         ), incoming(dimension,bucket_hash,attempt_limit,enabled) AS (
           VALUES('network',?,${limits.network},1),('invite_network',?,${limits.invite_network},?),('invite',?,${limits.invite},?)
         ), capacity(bucket_count,missing_count) AS MATERIALIZED (
           SELECT c.bucket_count,
             (SELECT count(*) FROM incoming i WHERE i.enabled=1 AND NOT EXISTS(
               SELECT 1 FROM guest_exchange_buckets b WHERE b.dimension=i.dimension AND b.bucket_hash=i.bucket_hash
             ))
           FROM guest_exchange_bucket_capacity c WHERE c.singleton=1
         )
         INSERT INTO guest_exchange_buckets(dimension,bucket_hash,window_started_at_ms,attempts,attempt_limit,updated_at_ms)
         SELECT dimension,bucket_hash,CAST(clock.now_ms/${WINDOW_MS} AS INTEGER)*${WINDOW_MS},1,attempt_limit,clock.now_ms
         FROM incoming CROSS JOIN clock CROSS JOIN capacity
         WHERE enabled=1 AND capacity.bucket_count+capacity.missing_count<=${MAX_BUCKET_ROWS}
         ON CONFLICT(dimension,bucket_hash) DO UPDATE SET
           attempts=CASE WHEN guest_exchange_buckets.window_started_at_ms+${WINDOW_MS}<=excluded.window_started_at_ms THEN 1 ELSE guest_exchange_buckets.attempts+1 END,
           window_started_at_ms=CASE WHEN guest_exchange_buckets.window_started_at_ms+${WINDOW_MS}<=excluded.window_started_at_ms THEN excluded.window_started_at_ms ELSE guest_exchange_buckets.window_started_at_ms END,
           attempt_limit=excluded.attempt_limit,updated_at_ms=excluded.updated_at_ms
         RETURNING dimension,bucket_hash,window_started_at_ms,attempts,attempt_limit,updated_at_ms`,
      )
      .bind(
        networkHash,
        pairHash,
        pairHash ? 1 : 0,
        inviteHash,
        inviteHash ? 1 : 0,
      )
      .all<{
        dimension: 'network' | 'invite_network' | 'invite';
        bucket_hash: string;
        window_started_at_ms: number;
        attempts: number;
        attempt_limit: number;
        updated_at_ms: number;
      }>();
    if (!result.success || result.results.length !== (inviteId ? 3 : 1))
      throw new Error('GUEST_ADMISSION_UNAVAILABLE');
    const decision = result.results.every(
      (row) => row.attempts <= row.attempt_limit,
    );
    const retryAfterSeconds = Math.max(
      1,
      ...result.results
        .filter((row) => row.attempts > row.attempt_limit)
        .map((row) =>
          Math.ceil(
            (row.window_started_at_ms + WINDOW_MS - row.updated_at_ms) / 1000,
          ),
        ),
    );
    // Only internal callers can observe inviteKnown; public denial remains generic.
    return {
      allowed: decision,
      inviteKnown: inviteId !== null,
      retryAfterSeconds,
    };
  }
}

export async function pruneExpiredGuestAdmissionBuckets(db: D1Database) {
  return db
    .prepare(
      `DELETE FROM guest_exchange_buckets WHERE rowid IN (
         SELECT rowid FROM guest_exchange_buckets
         WHERE window_started_at_ms < CAST(unixepoch('subsec')*1000 AS INTEGER)-?
         ORDER BY window_started_at_ms,rowid
         LIMIT 1000
       )`,
    )
    .bind(RETAIN_MS)
    .run();
}
