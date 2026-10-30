## 2026-10-27 — Own comment activity accepted locally

The own-history allowlist now additionally covers comment.create/edit/delete/resolve/reopen. Safe before/after detail is only {commentId,revision,state}, with adjacent revision/valid transition checks; no comment body, raw audit or peer Guest identity is exposed. Current can_view_own_history remains independent of can_comment/image access, and current sealed invitation/session authorization is still mandatory. Existing14-action legacy fixtures plus new comment API/unit projection cases passed in the243-check full Worker suite and316 unit suite. Guest comment thread sharing does not broaden own-history to peer events. See GUEST_COMMENTS/HANDOFF; earlier M2p pending scope notes below are historical.

## M2p final local verification — supersedes earlier pending status

Final full Worker run54253 passed157 local checks (.local/m2p-cloudflare-lifecycle.log), including history API privacy/current ACL/cursor scope, three-page fixed lifetime, deleted-photo witnesses, real Chromium pagination and explicit lifecycle-event identity clearing.134 unit/25files,61 integration/10files,14 reference Chromium, final generated Worker/web strict typecheck, lint/format, Next build and36-file documentation checks passed.375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected.

0035 was applied to local development D1 only (4 commands), and follow-up migration list is empty. Existing history was preserved. Recovery is forward-only; disable history on application rollback and retain indexes/audit. All feature flags remain OFF/hard-local and retention deletion remains OFF/dry-run. No remote/customer data, deploy, commit or push occurred.

Limit: headless Chromium did not emit native blur/visibility on bringToFront or the isolated CDP probes. The passing browser test explicitly dispatches FocusEvent blur/focus and checks current-cookie/D1 reload plus old-data clearing. Native headed desktop tab delivery and hosted E2E remain not_checked. This does not complete the full product goal. Earlier status/failure notes below are retained as historical evidence, not the current acceptance status.

Next work: immutable explicit Owner photo versions with a separately audited CAS current-version pointer; current uploads/galleries hardcode V1. Add independent non-current Guest comparison authorization before V2 exposure. Comment visibility choice remains pending; do not broaden disclosure. Filename tombstones, full history/Owner views, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 goal stays active.

# Guest own-history timeline (M2p)

Status: implementation in progress; not integrated acceptance. GUEST_HISTORY_ENABLED defaults false and is hard local-only. No hosted deployment or migration application is implied.

## Authorization

`GET /api/guest/me/activity` derives workspace, project, invite and Guest identity from the current session cookie. The independent `can_view_own_history` bit1024 is required; `can_view` alone grants no history and is not required for an authorized standalone timeline. Every page rechecks current session, invitation, Owner authorization, sealed album membership and active album/project status. Historical event sessions may be expired but must belong to the same Guest and invitation. Only the caller's Guest actor rows are returned. No global customer/project history is authorized by a single invitation.

Optional albumId and photoId filters are UUIDs; photoId requires albumId. Unknown or duplicate query keys are rejected. An explicit missing photo filter needs matching own scoped audit evidence. Unfiltered deleted-photo events may return a generic unavailable marker; identifiable safe filename tombstones are unfinished and must be designed with retention/privacy rules before deletion ships.

## Public projection

Allowlisted actions: selection.added/removed/version_changed/submitted, rating.set/cleared, favorite.added/removed, tag.added/removed, shared_selection.added/removed/version_changed/submitted. Shared actions describe only the caller's actions and must be labelled as shared selection. Owner/system/authentication/unknown future events are excluded.

Public metadata: eventId, occurredAt UTC, albumId, nullable photoId/versionId, nullable photoStatus. Detail is a strict before/after projection: selected and versionId; submission roundNo/status/optional selectedCount; nullable stars; favored; or label/present. Never expose raw JSON, session/request/invite IDs, storage keys, selected-item lists or other actor identities. Unknown internal fields are discarded; malformed required projected values fail closed.

## Pagination

Pages contain at most24 events ordered by occurred_at_utc and event_id descending. The HMAC cursor is domain-separated and binds a digest of Guest/invite/workspace/project/filter rather than exposing internal scope IDs. It expires after15 minutes from the first cursor issuance, and carries the initial audit rowid watermark plus the last tuple. Later appended events, even backdated ones, do not enter an existing traversal. A cursor is never authorization; revocation takes effect on every page. Signing uses a configured server secret with no insecure fallback. Query and response cursors are bounded2048 characters.

## Migration and recovery

Planned0035 adds query indexes only. It must not rewrite historical audit rows. Verify populated migration preservation and foreign keys before local application. Roll application code back with history disabled; indexes can remain safely. Any index correction uses a new forward migration. No remote/customer database changes are authorized by this local slice.

## Acceptance still required

Real local workerd/D1 API tests must cover independent permission, cross-Guest/invite/tenant/album isolation, current revocation, historical expired sessions, empty authorized results, complete keyset pagination with timestamp ties, cursor tamper/filter/cookie switches, append watermark, projected data minimization and malformed payload denial. Actual Chromium must cover the standalone history page, accessible mobile layout, pagination and stale/unauthorized data clearing. Existing product regressions and full M1–M5/hosted gates remain required.

## Cross-tab identity revalidation gate

A timeline with no further cursor must not retain old Guest data when the browser moves to another tab and the shared HttpOnly cookie changes. On blur/hidden, invalidate outstanding request generations, abort reads and clear the rendered history. On focus/visible, obtain a fresh capability and first-page response from the current cookie before displaying events. Cover the one-page/no-next-cursor case and delayed old responses in browser acceptance; pagination-only identity tests do not prove this boundary. This correction is pending final integrated verification.

Headless validation limit: isolated Chromium probes do not emit native blur/visibility on bringToFront. The browser regression explicitly dispatches FocusEvent blur/focus to verify handler behavior with current cookies and actual D1 responses. Native headed desktop tab delivery remains not_checked; do not describe this as a verified native cross-tab end-to-end test.
