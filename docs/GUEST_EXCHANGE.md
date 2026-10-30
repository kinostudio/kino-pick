# M2g Guest session exchange

Migration `0022_guest_exchange.sql` and `POST /api/guest/exchange` implement the local Guest credential exchange. The route is disabled by default, requires `APP_ENV=local` even when explicitly enabled, and remains `false` in local/staging/production Wrangler variables and `.dev.vars.example`. It does not create a platform account or expose photo, download, selection, comment, annotation, or history APIs.

## Request and response

Strict JSON, at most 16 KiB:

```json
{
  "requestId": "uuid",
  "token": "64 lowercase hex characters",
  "displayName": "Guest name",
  "password": "optional exact invite password"
}
```

The token represents 32 random bytes. `displayName` is trimmed, non-empty, at most 80 Unicode code points, and rejects control/bidi override characters. A link-only invite must omit `password`. Password invites use the exact bounded password verifier established by M2c. Unknown fields and malformed shapes receive `400 INVALID_INPUT`. The request is same-origin only; the `Origin` must exactly match configured `APP_URL`. A request carrying `CF-Worker` is rejected. Source address comes only from canonicalized `CF-Connecting-IP`; X-Forwarded-For and caller-selected dimensions are never used.

Success is `200 {"authenticated":true,"expiresAt":"...Z"}` plus a single Guest cookie. The raw session bearer is never returned in JSON. HTTP local uses `kino_guest`; HTTPS uses `__Host-kino_guest; Secure`. Both are `HttpOnly; SameSite=Lax; Path=/`, have no `Domain`, and expire no later than 24 hours or the invite. Owner cookies are not changed.

Unknown, malformed bearer value with valid request shape, expired/revoked/unsealed/inactive scope, disabled Owner, wrong/missing/unexpected password, rate/capacity/max-use rejection, replay, and conflicting request-ID reuse return the same `401 {"error":{"code":"GUEST_ACCESS_REQUIRED"}}` with no cookie. Invalid JSON/schema is `400`; wrong Origin is `403`; oversized body is `413`; disabled or unavailable service is `503`. No invite existence, retry interval, invite/session identifier, or case-specific denial code is returned.

Response status/body are intentionally uniform for credential and current-scope failures, but processing duration is not padded to the native scrypt path for unknown/ineligible links. The design relies on the invite's 256-bit random bearer entropy to make token guessing infeasible; local tests do not claim timing indistinguishability.

## Admission and credential work

The M2f D1 fixed-window HMAC admission runs before password verification. It uses the existing 20/network, 5/network+invite, 50/invite per five-minute limits, a 100,000-row cap and bounded Cron cleanup. Unknown tokens consume only the network bucket. Missing/invalid address, denied counters, and max-use fail closed. These are per-D1 limits, not edge/WAF limits or hosted abuse-load acceptance.

Password verification uses the fixed M2c scrypt parameters only after current eligibility and admission succeed. Guest KDF acquisition writes an immutable permit/release and resource audit. Guest and Owner password work share one global single-active slot per D1; no TTL, reaper, timeout unlock, or parallel password execution exists. Release is awaited only after the original native promise settles. An uncertain acquisition does not start KDF; an unconfirmed release prevents session issuance and leaves capacity held for quiesced operator repair.

The local Worker test validates workerd behavior, but does not establish deployed Cloudflare `node:crypto` support limits, CPU/memory cost, cancellation behavior, acceptable free-tier usage, or abuse resistance. Keep the route disabled until these deployment gates are measured and approved.

## Atomic issuance and recovery

After verification, the Worker generates a fresh 256-bit session bearer in memory and stores only its purpose-separated SHA-256 hash. A keyed HMAC-SHA-256 request commitment binds invite ID, request ID, token hash, normalized name and exact password without persisting the password. One D1 `batch()` inserts the Guest identity and immutable exchange command; the command trigger rechecks current token hash, enabled Owner, non-archived project, live sealed scope, active album, invitation expiry/revocation and the released KDF permit. The existing session trigger is the final lifetime max-use arbiter. It creates the session and request-correlated audit atomically; trigger/audit failure rolls back identity, command, session and audit together.

Before returning `Set-Cookie`, the Worker opens a D1 `withSession('first-primary')` session and confirms the exact command ID, request commitment, session ID, and candidate session-secret hash. This read occurs against the latest primary state and remains sequentially consistent if D1 read replication is later enabled. An ambiguous write without that proof never returns a cookie.

Only hashes and the request commitment are stored in the exchange ledger. The Guest display name remains in `guest_identities` because it is the Guest-facing identity; passwords, raw invite bearer, raw session bearer and client address are not stored there or in audit. Session audit uses the original `requestId`; KDF acquisition/release events are system resource audits with invite/project scope and no credential fields.

An HTTP response can still be lost after D1 commits and before the browser receives the one-time cookie. The raw secret is intentionally not recoverable from D1. A retry with the same invite and request ID returns the generic denial and never creates a second session or replacement secret. That successful session consumes one `max_uses` unit; with `max_uses=1`, the client cannot recover it. The Owner must revoke the affected invite and issue a new one. For an invite allowing multiple uses, the client may intentionally start a new exchange with a new request ID, which creates another independently revocable session and consumes another use. There is no automatic retry with a new ID.

## Migration and rollback

Migration `0022` adds Guest KDF permit/release/active-slot tables and the immutable `guest_exchange_commands` table. It updates the existing Owner KDF guard to check the new Guest active slot, so both credential paths continue to share one global limit. It replaces only the future Guest session-created audit writer to correlate new exchange sessions with their request ID. Existing invites, identities, sessions, revocations, KDF permits, audit rows, photos, R2 objects and quotas are not rewritten or backfilled.

This migration is forward-only; do not drop the new tables or restore the old Owner KDF trigger. A code rollback must first leave exchange disabled, preserve the migration/history, stop new credential work and verify whether a Guest KDF slot is active. For an uncertain native operation, stop all callers and prove quiescence before appending the exact permit release through the audited release table. If quiescence cannot be established, keep the shared KDF capacity unavailable. Repair forward or restore a verified consistent snapshot with all callers stopped; never clear the active slot or release history directly. No remote migration or customer-data operation is authorized by this local slice.

## Verification boundary

The acceptance suite uses actual local workerd, D1, Chromium and synthetic trusted-address headers. It covers default-off gating, generic denials, link/password exchange, shared KDF exclusion, max-use concurrency, request-correlated audit, D1 batch rollback, HTTPS cookie attributes, and a browser that loses a committed response. It is not a live Cloudflare, provider, edge-header, R2, CPU/free-tier or production deployment test. M2h/M2j add local gallery/private derivatives/selection and M2k adds the actual entry UI. Remaining independent actions, complete history, notifications, versions and delivery remain unfinished. See INVITATION_FLOW.md.
