# Guest selection UI, APIs and Owner review (M2i/M2j)

## Status and scope

M2i/M2j now provide a local, feature-gated Guest selection flow: Guests browse the authorized album, see and change only their own selection, submit it, and see the submitted round frozen. The Guest gallery displays 24-photo pages and hydrates selection state by following every selection cursor page. Batch selection runs sequentially over only the currently visible page; stale revisions or partial mutation failures trigger a server refresh before further edits. Logout reuses one stable request ID across safe retries. Submit/reopen dialogs support keyboard focus, Escape and Tab handling. The Owner album screen lists submissions, opens immutable snapshot detail, exports CSV/TXT/JSON, and can reopen only the latest submitted round as a new round.

As of 2026-10-26, local acceptance passed: pnpm test:cloudflare 109 checks including migration upgrade through0026 and Guest/Owner browser flows; pnpm test:unit 88; pnpm test:integration 61 after the native-image test timeout was raised to30 seconds; strict typecheck, lint, and pnpm build passed. Separate Next/reference pnpm test:e2e passed 14 Chromium tests; pnpm format:check, python tools/check_handoff.py (30 specification files), and git diff --check passed. The Next/reference E2E tests do not exercise the Worker target UI; that has local browser coverage in test:cloudflare. All production/staging selection flags remain default-off and the Worker hard-rejects non-local enablement.

This is a tested local vertical slice, not the complete product workflow. Ratings, favorites, tags, comments, annotations, complete historical activity views for remaining actions, configurable selection limits, difficult combinations of independent Guest permissions, hosted service configuration and deployment acceptance remain open. Cross-project history remains closed.

## Guest contracts

### Current selection state

GET /api/guest/albums/:albumId/selection?cursor=:opaque requires the independent can_select permission (bit 8). It returns at most 24 rows shaped as {photoId, versionId, selectedAt}, plus selectedCount, roundNo, selectionRevision, roundStatus, submittedAt, and nextCursor. It returns only the caller's own selected IDs and exact pinned version IDs; it contains no filename, image key, asset URL, or other Guest's state.

The opaque cursor is album-, round-, and revision-bound. A malformed cursor is a client error; a stale round/revision returns 409 SELECTION_CHANGED, so a caller must refresh from the first page. The authorized empty result is distinct from a missing, expired, revoked, foreign, or under-permissioned Guest session. Selection reads do not write an audit event and do not count as a valid-human-view retention heartbeat.

### Selection mutation

PUT /api/guest/albums/:albumId/photos/:photoId/selection accepts strict JSON {requestId: UUID, selected: boolean, versionId: UUID}. The exact version is mandatory for both selecting and deselecting. It requires can_select; that permission does not imply can_view, download, or submission.

A changed state emits selection.added, selection.removed, or selection.version_changed. Exact retry under the same Guest/request ID and payload returns its immutable result; a conflicting reuse returns 409 REQUEST_ID_CONFLICT. No-op deselection retains its immutable command/result but does not write a state-change event.

### Guest UI operational boundaries

The Guest screen reads the album grid in 24-photo pages. It loads the Guest's selection state across all cursor pages before presenting the selection map, and its batch control processes only the currently visible page, one request at a time. A stale selection revision or partial per-photo write causes a refresh from D1 before the screen resumes editing, so the UI does not assume a failed batch was all-or-nothing. Logout retains the original request ID until the server confirms the same request, making a lost response retry safe. Submit confirmation keeps keyboard focus within the dialog, closes on Escape, and supports Tab navigation.

### Guest submission

POST /api/guest/albums/:albumId/selection/submit requires the independent can_submit permission (bit 512); it does not imply can_select. The request carries a UUID requestId and may carry expectedRoundNo and expectedRevision together. The server reads the authorized Guest’s current selected rows and exact pinned versions; the client cannot supply or alter the submitted photo list. An empty selection returns 422, while stale round/revision or already-submitted rounds conflict.

The D1 transaction creates the immutable submission header, exact-version item snapshot and result, updates the round to submitted, inserts the selection.submitted append-only audit event, and seals the snapshot under migration 0026 guards. A successful submission freezes further Guest selection writes for that round. The local UI’s supported path requires both can_select and can_submit; combinations where a Guest can submit without being allowed to read/change selection still need explicit UI acceptance.

## Owner review and export

Owner routes require the current enabled Owner session and the album's workspace ownership. They remain behind GUEST_SELECTION_ENABLED:

- GET /api/v1/albums/:albumId/submissions returns summaries with invite/Guest identifiers, round/revision, selected count, submission time, current round status and whether the snapshot is sealed.
- GET /api/v1/albums/:albumId/submissions/:submissionId returns the immutable submitted items, exact photo/version IDs, original filename, version number, size and dimensions.
- GET /api/v1/albums/:albumId/submissions/:submissionId/export?format=csv|json|txt downloads the immutable submission in the requested format; omitted format defaults to CSV. The TXT export is a filename list. After successful export formatting, the Worker inserts one append-only `download.generated` event before returning the attachment. The INSERT rechecks the live Owner/session and exact workspace/project/album/submission scope; audit failure prevents a successful response. Metadata contains only submission ID, format and selected count, with fresh server UUIDs for event/request IDs. This proves server-side generation, not complete client receipt; no schema migration is required.
- POST /api/v1/albums/:albumId/rounds/reopen accepts {requestId: UUID, inviteId: UUID, guestId: UUID, expectedRoundNo: positive integer}. After explicit Owner confirmation, it records selection.reopened and opens the next retained round at revision 1 under0029; pre0029 exact replay still returns its historical0 and current state must be read separately. Current selection state remains available for Guest changes in the reopened round, while the prior submission snapshot stays sealed. Current Owner/session, album scope and expected round are checked; exact replay is request-bound.

The UI is integrated into the Worker Owner album page as submission review/detail, export choices, and a confirmation dialog for reopening. Only the latest submitted round offers the reopen action. The confirmation dialog keeps keyboard focus within the dialog, closes on Escape, and supports Tab navigation. Guest and Owner UI/API permission combinations have not all been accepted; in particular, test the Guest view/select/submit combinations independently before widening access.

## Denials and request boundary

Guest mutation routes are outside Owner-only /api/v1; they require exact configured Origin, bounded JSON and the Guest HttpOnly cookie. Missing/expired/revoked/foreign/under-permissioned Guest scope uses non-enumerating 401 GUEST_ACCESS_REQUIRED. Disabled feature is 503; malformed UUID/body is 400; origin mismatch is 403. Database triggers are the final authorization boundary and recheck current session hash, Guest identity, immutable invite scope, parent state, exact photo/version where relevant, permission, expiry and revocation before writes.

## Atomic history and privacy

Selection commands/results, submission parent/items/results, round state and audit are D1-backed. State changes, version-pinned submission snapshots, their seal, and append-only audit events commit atomically; an audit failure rolls the transaction back. Events include the Guest/session and tenant/album/photo/version where applicable, request ID, before/after values and UTC time. Session bearer secrets are never stored; only a hash binds a command to its current session. There is no global identity, cross-project query, or implicit sharing of selection state. The Owner export is derived only from the authorized album's immutable submission detail.

## Configuration and rollout

GUEST_SELECTION_ENABLED defaults to false in local/staging/production Wrangler config and .dev.vars.example; runtime configuration rejects enablement outside APP_ENV=local. The Cloudflare test suite enables the flag only in isolated test workers. Local success does not establish hosted OAuth/session behavior, abuse controls, D1 transaction behavior at production scale, browser UI permission edge cases, or release readiness. Keep hosted flags off.

## Migration and recovery

Current policy/reopen behavior is defined in SELECTION_POLICY.md.0028 adds private min/max/CAS/commands/audit and policy-bound cursors;0029 initializes retained reopened drafts at1 and performs an audited repair of legacy open round>1 revision0 without rewriting any sealed snapshot or old result.

- 0023_guest_selection.sql adds per-invite/Guest/photo selection state and immutable mutation command/result tables and guards.
- 0024_guest_selection_submissions.sql adds Guest-specific round/revision state, immutable submission/snapshot/result tables, submission authorization/audit/freeze guards, and cross-ledger request-ID collision checks.
- 0025_guest_selection_empty_guard.sql forward-replaces the submit guard so authorization and request replay/conflict are checked first, then empty-selection validation, then revision/status checks.
- 0026_guest_selection_snapshot_guards.sql seals each immutable submission with a verified item count and stabilizes tenant/round scope; round transitions require an authorized current Owner session and matching audited reopen event.

These migrations are additive and forward-only. The populated isolated upgrade test through 0026 verifies existing assets, Guest scopes/sessions, selection commands, prior snapshots and audit history are preserved. The migrations have been exercised in local isolated D1 only; no remote/customer database was touched.

If Worker code must be rolled back, turn off the selection flag and stop using the routes, but retain all selection/submission/round/seal/audit rows, indexes and authorization/immutability triggers. Restore behavior with a forward repair or recover a separately verified backup into an isolated database. Do not drop append-only rows, manually rewrite selection state, remove guards, or run these migrations against remote/customer D1 without the release backup/restore gate.

## Remaining acceptance

Finish independent Guest permission-combination coverage, configurable selection limits, ratings/favorites/tags/comments/annotations and full historical activity. Validate hosted OAuth, Guest session/abuse controls, D1, R2 and deployment only after their separate release gates pass. The current screens/APIs are local-only and do not mean the whole Kino Pick service is production-ready.
