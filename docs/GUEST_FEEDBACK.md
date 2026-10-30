# M2l — Independent Guest ratings and favorites

Status: locally implemented and verified (117 Worker checks,91 unit,61 integration,14 reference Chromium E2E, Next build and strict checks; see VERIFICATION). This slice adds actual rating/favorite state, command/result history, APIs and shared Grid/Lightbox controls. It preserves the full product backlog and does not enable hosted access.

## Rights and logical photo state

`can_rate` (bit16) and `can_favorite` (bit32) authorize their own actions and state reads independently. Neither implies can_view, can_select, can_submit or the other feedback right. The gallery UI itself still requires can_view; a known-photo action API need not grant image access. A session from one invitation never exposes another Guest's state or a different project.

Ratings (1–5 or null) and favorite values belong to a logical photo. Each meaningful change records the exact version the caller acted on, but a later version does not erase the state. Setting the same logical value is a no-op: it keeps an immutable request result without a state-change event or replacing the last meaningful version/time. A clear retains a null-rating/false-favorite state row with its change witness; absent state uses null version/time.

Selection submission freezes only its sealed selected-photo/version snapshot. Separately authorized rating/favorite changes remain possible and cannot alter that snapshot. Owner review/history for all feedback events remains a later task.

## Strict API contract

- PUT `/api/guest/albums/:albumId/photos/:photoId/rating`: `{requestId:UUID, versionId:UUID, stars:1..5|null}`.
- PUT `/api/guest/albums/:albumId/photos/:photoId/favorite`: `{requestId:UUID, versionId:UUID, favored:boolean}`.
- GET `/api/guest/albums/:albumId/ratings?photoId=:id&photoId=:id` and analogous `/favorites`: 1–24 unique known photo IDs. Each endpoint requires only its own permission and returns current defaults/state for those exact photos. Invalid/foreign photo scope denies the whole batch. No filenames, image URLs, storage keys or other Guest data are returned. Reads do not append audit or retention activity.
- GET `/api/guest/feedback/capabilities`: anonymous, private/no-store, non-secret `{enabled:boolean}`. Owner invite capabilities also report feedbackEnabled; this describes availability, not authorization.

Rating responses include photoId, stars, versionId and updatedAt; favorite responses include photoId, favored, versionId and updatedAt. Mutation results additionally contain eventId (null for no-op) and occurredAt. Strict shared schemas reject extra fields, invalid values, duplicate/oversized batches and wrong version shapes.

## Atomic history and request conflicts

Migration0027 adds guest_rating_state, guest_favorite_state, guest_feedback_commands and guest_feedback_results without rewriting old data. A single command INSERT validates current hash session, identity, sealed exact album, enabled Owner, parent state, expiry/revocations, required action bit, and full photo/version scope. It then captures immutable before/after/result values, changes state and appends rating.set/rating.cleared/favorite.added/favorite.removed in one statement. Audit failure rolls the command/result/state back. Events include UTC, Guest/session, workspace/project/album/photo/version, request ID and before/after values. Session bearer secrets are not stored in these commands.

Exact replay is bound to Guest, request UUID, action, target, version and payload, and remains subject to current authorization. Changed reuse conflicts. Feedback shares a request namespace with selection, submission, logout and invite-wide exchange operations. New feedback checks old ledgers before insertion; AFTER INSERT guards on old command tables reject existing feedback conflicts so all old state/audit effects roll back regardless of sibling trigger order. An ignored exact old replay cannot coexist with a conflicting feedback row because its original key prevented that row from being created.

State writes require the exact immutable command/result witness and a predecessor equal to the current last command. The predecessor is captured before mutation, so an older valid witness cannot silently restore historical state even when timestamps tie. Scope cannot change. Clear/unfavorite are witnessed updates; direct state deletion and command/result edits/deletions are forbidden.

D1 behavior is checked against the [binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [SQLite SQL support](https://developers.cloudflare.com/d1/sql-api/sql-statements/); runtime acceptance must exercise actual local workerd/D1, not a memory substitute.

## UI, uncertainty and release gates

One provider shares hydrated state between Grid and Lightbox. It uses at most one ratings and one favorites batch per visible page, according to rights. Pending changes use synchronous per-photo/action locks and stable exact request UUID/body retries; unknown outcomes are not reported as success or followed by an automatic opposite action/new request. A confirmed mutation re-reads current state so replay cannot overwrite a newer value. Stale page callbacks must be ignored and pending navigation warns. No bearer or mutable review state is persisted in browser storage.

GUEST_FEEDBACK_ENABLED defaults false in every environment/example and runtime rejects non-local activation. This flag is independent of selection/exchange; all current-session checks remain authoritative. Production mutation throughput/abuse/D1 cost and real hosted services remain unverified.

## Migration recovery and remaining scope

Migration0027 is additive and forward-only. Disable feedback before rolling back code, preserve commands/results/state/audit and new namespace guards, and repair forward or restore a separately verified consistent snapshot. Never drop or truncate audit/history to repair a request conflict. Before a remote migration rehearse representative backup/restore with writes stopped. This slice changes no R2 object or quota and performs no remote migration.

Actual local acceptance proves populated0026→0027 preservation, independent rights without view/select, add/change/clear/no-op, exact/concurrent replay, symmetric namespace conflicts, current denial before replay, audit rollback, direct-state/immutable guards, logical-version persistence, submitted snapshot preservation, Grid/Lightbox state/reload/paging, lost response retry and375px layout. Tags/comments/annotations/full history/selection limits/versions/delivery/retention and hosted acceptance stay required.

The375px synthetic screenshot at apps/worker/.local/guest-feedback-mobile.png was visually inspected. This is fixture UI evidence, not customer photos or hosted R2 acceptance.
