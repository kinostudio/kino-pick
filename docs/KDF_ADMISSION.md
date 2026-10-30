# M2e Owner KDF admission (shared with M2g Guest exchange)

Migration0020 adds one D1-wide native password KDF slot. The local-only/default-OFF Owner issuer acquires it before generating a password verifier. Link-only creation and committed metadata recovery do not require KDF. Concurrent password work fails closed with503/KDF_CAPACITY_UNAVAILABLE; callers keep the original intent and request ID for manual retry/recovery.

Acquisition checks current enabled Owner/session, inserts an immutable permit, fills the bounded one-row active slot and writes security.kdf_acquired in the same transaction. INSERT RETURNING and positive changes must confirm this request's permit before work starts. An ambiguous acquire never runs work or guesses that release is safe. This uses D1 transaction semantics documented in the [D1 API](https://developers.cloudflare.com/d1/worker-api/d1-database/).

The original native promise is awaited in try/finally. Only after it settles does the internal release insert an immutable release, clear exactly that permit's slot and write security.kdf_released atomically. Release remains possible after session/Owner revocation. Unconfirmed release returns503/KDF_RELEASE_UNAVAILABLE and prevents invitation commit; it does not imply the release failed to commit. Old release retries cannot clear another permit. Permit/audit metadata contains identifiers only, never passwords, tokens or verifier bytes. This resource history can remain even when later invitation creation fails.

There is deliberately no TTL, automatic reaper, request-timeout release or Promise.race. A cancelled/crashed Worker may leave the slot held indefinitely. Time passing does not prove a native operation has stopped. Acquisition reads only the single current slot rather than scanning historical permits. History remains append-only; capacity enforcement is scoped to this D1 database, not multiple independent databases.

## Operator recovery and rollback

No public repair endpoint exists. A trusted operator must first disable issuance, stop every caller/runner using this database and establish that all prior Worker executions/native KDF work have terminated. A timeout or old acquired_at_ms alone is insufficient. Snapshot the database, inspect SELECT permit_id FROM kdf_active_slot WHERE slot=1, and reconcile the affected original request through metadata recovery. After confirmed quiescence, execute a parameterized INSERT INTO kdf_permit_releases(permit_id) VALUES(?) ON CONFLICT(permit_id) DO NOTHING for that exact permit. The trigger clears only its own slot and appends the existing request-correlated system audit. Confirm slot absence and audit before re-enabling local issuance. Never delete the slot, permit, release or audit directly. If termination cannot be established, keep issuance disabled.

Code rollback: keep issuance disabled and preserve0020 and all history; older issuer code bypasses this admission mechanism and must not be enabled. Repair forward after quiescence or restore an independently verified consistent snapshot while all callers are stopped. Migration is additive with no backfill, photo/R2 mutation or quota change. No remote migration is authorized by local tests.

## Remaining gates

Migration0022 adds a separate immutable Guest KDF ledger/active-slot row and updates the Owner guard to check both; this still enforces one global KDF at a time in the D1 database. Guest exchange has its own current invite ACL and audit, described in GUEST_EXCHANGE.md. Persistent network/invite buckets are wired before Guest KDF. Hosted native-KDF CPU/memory/cancellation validation and deployment acceptance remain required. The single slot does not prove acceptable service cost or prevent repeated sequential requests. No production flag is enabled.
