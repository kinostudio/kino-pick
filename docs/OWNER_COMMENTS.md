## 2026-10-28 — M3f2b locally accepted

Independent Owner processing and current thread snapshots are now accepted locally:269 full Worker/369 unit/61 reference integration/14 reference Chromium, strict/lint/build passed;0044 locally adopted after verified backup/restore and102 old-table hash parity, new4empty/FK0. This supersedes pending integration notes below. Keep gates OFF/hard-local, Guest lifecycle independent, deletion OFF/dry-run. See COMMENT_PROCESSING.md and latest HANDOFF for contract, recovery and evidence; fullM1–M5/hosted acceptance remains open.

## 2026-10-28 — M3f2b integration pending acceptance

M3f2b extends current thread items with independent processing snapshots for Guest parents; Owner replies always carry null. It shares Owner reply recovery serialization and shared cursor invalidation but never edits Guest authorship/text/state. Processing source integrated, runtime acceptance/local0044 adoption pending; see COMMENT_PROCESSING.md.

# Owner comment collaboration (M3f2)

## Current implementation boundary

M3f2a is accepted locally:260 full Worker/D1/R2/Chromium checks,345 unit,61 reference integration,14 reference Chromium, strict types/lint/Next build passed.0043 is applied only to the local development DB after verified backup/isolated restore. Owner reply UI is mounted and exercised at375px. Shipped flags remain OFF/hard-local; no hosted deployment is claimed. Genuine Owner processing status, annotations and the rest of M1–M5 remain unfinished.

## Identity and thread scope

Owner requests use the current authenticated internal Owner identity and live Owner session. Google and GitHub identities resolve to that same internal identity. Never accept actorId, sessionId, workspaceId or expectedGuestId in a reply command. A displayed nickname does not prove actor role: responses carry a server-derived authorType of guest or owner.

Every thread is scoped to one sealed invitation, album, logical photo and immutable version. Owner UI must explicitly select the invitation; replies must never broadcast across invitations to the same photo. Guest access continues to require independent can_comment and live invitation/session authorization. Owner access uses live ownership of the workspace and active parent scope, never a Guest cookie.

## Commands and current reads

The reply command contains requestId, operation=reply, inviteId, photoId, versionId, parentCommentId, expectedParentRevision and normalized body. A new reply requires a live nondeleted parent matching that invitation/photo/version and revision. Owner edit_reply/delete_reply target a replyId with expectedRevision; they cannot mutate Guest text. Body normalization and the 2,000 Unicode-codepoint limit reuse the Guest body schema.

Owner thread items distinguish authorType, parentCommentId and canEdit. Guest items have no parent and are never editable through Owner reply controls. Owner replies have a parent, cannot use the Guest resolved state, and retain a null-body tombstone on deletion. Resolving/reopening a Guest request as Owner requires a later explicit actor-aware status projection; do not simulate it by changing Guest session fields.

Thread reads require inviteId and permit either a cursor or a targeted commentId, never both. Pages contain at most24 unique items matching the requested photo/version. Historical command receipts prove completion only; the UI must independently read current state before displaying a receipt as current content.

## Database integration (0043 local-only applied)

0042 Guest projections have mandatory Guest author/session/command foreign keys. Preserve those ledgers. 0043 adds separate owner_comment_commands/replies/changes/results and comment_thread_changes, with genuine Owner session audit provenance and atomic all-or-none command effects. Owner session IDs remain historical strings without foreign keys to transient owner_sessions; live authority is checked in the insert guard, so logout can remove old sessions without deleting history.

A shared append-only thread change sequence covers Guest and Owner changes transactionally. Taking max(Guest sequence, Owner sequence) is insufficient: a change to the smaller sequence would not invalidate a cursor. Markers must bind an immutable source change and exact invitation/album/photo/version, reject replacement/update/delete, and introduce no read-side writes. Existing history remains intact without backfill. Guest cursors now require schemaVersion2 and the v2 scope digest, rejecting old v1 tokens; Owner cursors are newly introduced v2 tokens. Legacy immutable Guest receipts parse with default authorType=guest and parentCommentId=null; stored JSON is unchanged. Guest thread reads union both actors and never grant isMine to an Owner reply.

Owner request namespace is actor/request. Before activation, include all existing namespace witnesses: workspace_commands, request_commands, upload_requests, upload_workflow_requests, processing_review_commands, invite_revocation_commands, invite_creation_commands, selection_policy_commands, selection_policy_configuration_commands, shared_review_owner_commands, photo_version_head_commands, project_versioning_commands, owner_external_intents, and selection.reopened user audit witnesses. Retain intentional legacy aliases and upload_key_fences semantics documented in OWNER_INTENT_CLAIMS.md. Symmetric transactional guards reject an unrelated new reply command using the same key in either insertion order. New Owner request UUIDs normalize to lowercase; probes include lower(request_id) on legacy witnesses, with nonunique actor/canonical-request expression indexes. Inverse guards canonicalize the legacy writer request before comparison. These indexes preserve old spellings and intentional aliases; no historical rows are rewritten. This slice does not redesign legacy-to-legacy UUID casing semantics. External intent guards must reject collisions before any R2 effect.

Current Owner/session and tenant authorization precede exact replay. A fresh valid session for the same internal Owner may recover an exact historical request; preserve its original audit session. Do not copy the older session-bound shared-review replay behavior. Compare canonical operation/payload/scope before returning an immutable result; do not require a historical parent revision to remain current for an already accepted exact replay. New intent still requires current parent/reply CAS.

## Required runtime acceptance

Test both namespace insertion orders, current authority before replay, fresh-session recovery, disabled Owner, foreign tenant/invitation/version targets, stale parent/reply revisions, terminal deletion, forged author/parent/sibling changes, audit/result rollback and projection immutability. Verify Guest visibility only within the same invitation, readonly Owner replies, and cursor invalidation after either actor changes a thread. Test lost receipts, late A/B responses, corrupt/unavailable metadata-only recovery storage and current-state reconciliation in actual Chromium.

Owner album Lightbox currently mounts PhotoVersionsPanel in apps/web/target-ui/album-gallery.tsx; integrate explicit version and invitation selection there. Never store plaintext comment bodies or credentials in browser recovery storage. No inactive controls or hosted availability claims.

## Recovery and remaining work

0043 was applied to local development D1 only after backup apps/worker/.local/d1-before-0043-20261028-014104.sql (468000bytes,SHA256 e777bfe679555dbf8e3b43064ef6358d38f043d41b180bd60674fe4dd174b703).63 commands succeeded. All97 prior product tables retain exact row-content hashes;5 new tables are empty, FK check is clean and no migrations are pending. An isolated backup import matched all97 table hashes and was then removed with scoped path checks. A separate upgrade fixture creates a real ready private16x16 V2 through guarded upload/head commands and R2/Sharp, then creates/edits Guest comments under0042 before applying0043 and comparing every old table. No Guest history is rewritten or backfilled. See HANDOFF/VERIFICATION and the ignored backup integrity manifest for exact evidence. No hosted DB/R2 recovery claim. Before any future application, back up local D1, validate a populated upgrade and document forward recovery. Retain all immutable commands/changes/results/audit and repair forward. Never drop Guest history or modify customer/remote data to simplify migration. Automatic deletion remains OFF/dry-run.

Next: finish Owner schema/service/API/UI/tests as a vertical slice, then Owner status transitions with explicit provenance and independent point/rectangle annotations. Full M1–M5, delivery, retention and hosted acceptance remain unfinished.

## HTTP integration

OWNER_COMMENTS_ENABLED defaults false in all3 Wrangler environments and .dev.vars.example and rejects non-local activation. It requires PHOTO_VERSIONS_ENABLED, independently of Guest exchange/comment/selection gates. All Owner routes run behind the existing authentication middleware and no-store headers.

- GET /api/v1/comments/capabilities returns {enabled:boolean}.
- GET /api/v1/albums/:albumId/photos/:photoId/versions/:versionId/comment-threads requires inviteId, accepts cursor OR commentId, and rejects duplicate or unknown fields.
- POST /api/v1/albums/:albumId/comment-replies/commands requires exact Origin, application/json and X-Kino-Expected-Actor matching the cookie-derived Owner. It accepts reply/edit_reply/delete_reply only. Routes enforce the default-OFF gate before repository access.

Current Owner/session checks precede read/replay; targeted current reads never merge another invitation. Owner can read/reply to retained expired/revoked invitation threads, while Guest reads still deny them. Neither route grants image access to a Guest or permits Owner mutation of Guest text. Owner status transitions and annotations remain required follow-up work.

## Accepted UI and recovery

Owner AlbumGallery Lightbox mounts the real panel behind OWNER_COMMENTS_ENABLED. Invitation and version choices are explicit, readable and paginated; historical published versions remain separate from the current image. Owner replies have role badges, author-only reply edit/delete CAS and tombstones. Guest author text/status are readonly to this service. New Owner replies do not move picks, ratings, photo heads or old comments.

The actor/album journal keeps one captured intent, with metadata and body SHA in sessionStorage and plaintext only in page memory. Full reload requires matching normalized body reentry against the original target. Missing/corrupt/unavailable or newly changed raw storage blocks replacement writes. Save/finish/discard compare full metadata, sending has an atomic claim, and preparation releases once before network waits. Confirmed historical receipts require a targeted current read; late200/401 cannot clear another request. Explicit two-step discard clears local recovery only and never cancels a remote commit.

Blur/hidden clears visible text and demotes pending plaintext; generations invalidate old responses. Focus/pageshow revalidate or restart bootstrap if Owner initialization was interrupted. Initially-hidden mounting is guarded in source. Headless acceptance explicitly dispatches lifecycle events; native headed delivery and direct hidden-at-mount runtime remain not_checked. Disabled capability loading leaves existing gallery navigation working. Snapshot files show375px viewport layout with no horizontal overflow.

Final standard evidence is .local/m3f2-cloudflare-twelfth.log (260 checks,exit0); current source also passes345 unit,61 reference integration,14 reference Chromium, strict types/lint/Next build. Runtime includes1,000 lifetime replies/tombstones, exact replay and edits at cap, privacy/CAS/rollback/namespace guards, lost receipt/full reload, current-read ordering and actual late200/401 A/B browser delivery. Remaining work includes genuine Owner processing state, annotations, full history/exports/delivery/retention and hosted acceptance.
