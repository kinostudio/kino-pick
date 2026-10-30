# M2m2 — Explicit shared review subjects

Status: accepted locally with127 Worker checks;0030 applied locally only. Preserve the whole M1–M5 backlog. Project inherited defaults remain M2m3; this slice proves the actual two-distinct-Guest29→30 shared race, not reuse private-session evidence.

## Isolation and opt-in

A shared review is a NEW subject within one workspace/project/album, with an immutable title and1–24 explicitly selected sealed invitations. Owner creation requires confirmShared:true acknowledging that people holding those invitations can affect the same selected set. It never merges Guests, imports private picks, changes invitation grants, shares ratings/favorites or exposes other albums/project history. Membership is sealed atomically before any Guest use. Each shared round has fixed explicit min/max; a confirmed Owner reopen may specify the next round's bounds while keeping earlier submissions immutable.

Private selection routes remain private. Guests discover only reviews for their current invited album and membership, then explicitly enter /guest/albums/:albumId/shared/:reviewId. Shared requests use separate paths and bind review/album/round, so a stale private page cannot silently mutate a new shared set. Existing private gallery/derivative ACLs continue to govern images. Default feature flag GUEST_SHARED_SELECTION_ENABLED=false, hard local-only. No hosted activation, migration or customer data.

## Required contracts and paths

All schemas live in packages/contracts/src/shared-review.ts; use strict Zod inputs, same-origin16KiB bounded mutation JSON, current Owner or Guest HttpOnly session and private/no-store responses.

Owner base /api/v1/albums/:albumId/shared-reviews:

- GET -> ownerSharedReviewListSchema (at most20 reviews).
- POST -> createSharedReviewSchema -> sharedReviewOwnerResultSchema. Canonical payload sorts inviteIds, binds album/title/bounds/confirmation and request ID. Max20 subjects per album, no implicit eviction.
- POST /:reviewId/reopen -> reopenSharedReviewSchema -> sharedReviewOwnerResultSchema. Only latest submitted round; retain selected set, initialize revision1, accept explicit next-round bounds. Exact replay returns original result before current status checks, after current authorization.
- GET /:reviewId/submissions?beforeRoundNo=positive -> sharedReviewSubmissionPageSchema,24 rows descending round; no arbitrary cursor keys.
- GET /:reviewId/submissions/:submissionId?cursor=... -> sharedReviewSubmissionDetailSchema,24 pinned items with filenames/versionNo; exact immutable submission scope/current Owner checked each page.
- GET /:reviewId/submissions/:submissionId/download?format=csv|txt|json -> complete attachment. Prefer bounded D1 paging/streaming; download.requested audit must commit before response. Append download.generated only after full formatting and before successful stream EOF; a completion-audit failure errors the stream and leaves requested evidence. Status200 alone is not proof of successful generation/receipt. CSV cells are formula-safe. No filenames/keys/content in download audit.

Guest base /api/guest/albums/:albumId/shared-reviews:

- GET -> guestSharedReviewListSchema; only current membership and can_select OR can_submit. Read no other Guests' identity/session/names. Metadata includes only the current caller's own guestId as an intent witness. No audit/retention activity write.
- GET /:reviewId -> guestSharedReviewMetadataSchema with exact current scope, min/max/round/revision/status and independent canSelect/canSubmit/canView. selectedCount is null without can_select; canSubmitNow is only a current aggregate eligibility boolean for submit-capable members.
- GET /:reviewId/selection?cursor=... -> sharedReviewSelectionPageSchema requires independent can_select; returns photo/version IDs/times only, metadata in same snapshot; cursor binds review/round/global revision.
- PUT /:reviewId/photos/:photoId/selection -> setSharedReviewSelectionSchema -> sharedReviewSelectionResultSchema. Current roundNo and expectedGuestId required; the latter must match the cookie-derived current Guest before any write, and is never an actor grant. No client actor/tenant/count. No global-revision CAS for set; serialized last-writer behavior on one photo, exact no-op/retry protected. A new key/false-to-true consumes capacity, version update/deselect does not. Meaningful set/remove/version changes increment one shared revision and append precise before/after audit with acting Guest/session/request/version/UTC.
- POST /:reviewId/submit -> submitSharedReviewSchema -> sharedReviewSubmitResultSchema. Requires independent can_submit, matching expectedGuestId, exact expectedRevision and round, server snapshots all selected versions, validates nonempty/min/max and freezes all participants atomically. Two concurrent submitters cannot create two snapshots. No client item list accepted.

Public GET /api/guest/shared-reviews/capabilities -> {enabled:boolean}, non-secret only. All deny current expired/revoked/unsealed/nonmember/foreign scopes uniformly401, invalid400, stale/locked/limit409; feature503. Images keep can_view independently; submit-only members may obtain metadata/eligibility and submit without selected item IDs. Actor identity is never conflated with the shared selection subject. Uncertain set/submit retries retain the original expectedGuestId and exact body; a different Guest cookie receives uniform401 with no new command/state/audit, rather than applying the old intent as a new actor.

## Database and invariants

0030 is additive and must preserve all prior tables/rows. Suggested tables shared_reviews, shared_review_invites, shared_review_seals, shared_review_rounds, shared_review_state, shared_review_owner_commands/results, shared_review_guest_commands/results, shared_review_submissions/items/seals. Use composite scope FKs and immutable subject/membership/seals/commands/results/snapshots. State tombstones retain selected=false, exact version witness and previous-command chain so old valid witnesses cannot restore history. Round changes need current command/result/audit evidence; no direct state reset, delete, reparenting or historical overwrite.

Owner ledger shares all six existing command namespaces, selection_policy_commands and selection.reopened audit keys, symmetrically. Guest ledger shares private selection/submission, feedback, logout and invite exchange keys. Current ACL always precedes replay/conflict. Existing ledger writes must atomically abort if a shared key conflicts; new writes check all old ledgers. Do not rely on sibling-trigger order. D1 rejected long compound SELECT in M2m1; use OR EXISTS. All state/result/revision/snapshot/seal/audit effects must commit in one command-trigger statement (or proven equivalent atomic batch). Audit/seal failure rolls everything back for an exact same-ID retry. No-op results are retained without fake state-change audit.

Shared bounds are fixed per round; creation starts empty at revision0, nonempty reopened set starts1. New selected state checks the current cap atomically; removal/version updates remain available above cap. Submission uses the coherent global revision and pins immutable assets. Owner review/export/reopen always repeats exact current scope. No R2 data/quota/retention change in this slice.

## Acceptance and recovery

Prove populated0029→0030 preservation, no private state imports/leaks, sealed explicit membership, every independent right/current revocation/Owner/session/parent denial before replay, actual two distinct Guests at29→30 exactly one new pick, two submitters one seal, stale round/revision rejection, version/tombstone/no-op/history, rollback and same-ID retry, all legacy namespace directions, paginated read/cursor changes, shared submit/detail/export/reopen and old snapshots. Real two-browser UI must show explicit shared warnings, reflect other Guest changes after refresh, enforce min/max, retain exact uncertain intent, use private image routes, and fit375px. Verify Owner create/member selection/confirmation/review/export/reopen and default-off behavior. No fake UI or hosted claims.

Recovery: turn shared feature OFF before older bundle rollback, keep0030 schema/guards/immutable history and repair forward or restore a representative independently verified consistent snapshot with writes quiesced. No destructive down migration or automatic data cleanup. Hosted OAuth/edge/KDF/R2/CORS/resources/backup/CI/deployment remain separate gates.
