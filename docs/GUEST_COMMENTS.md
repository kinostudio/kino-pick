## 2026-10-28 — M3f2b locally accepted

Independent Owner processing and current thread snapshots are now accepted locally:269 full Worker/369 unit/61 reference integration/14 reference Chromium, strict/lint/build passed;0044 locally adopted after verified backup/restore and102 old-table hash parity, new4empty/FK0. This supersedes pending integration notes below. Keep gates OFF/hard-local, Guest lifecycle independent, deletion OFF/dry-run. See COMMENT_PROCESSING.md and latest HANDOFF for contract, recovery and evidence; fullM1–M5/hosted acceptance remains open.

## 2026-10-28 — M3f2b integration pending acceptance

Current Guest thread reads include readonly Owner processing in the same authorized SQL snapshot. Guest resolve/reopen remains distinct; only Guest create/edit revisions make an existing Owner decision stale. Original immutable command receipts remain unchanged and parse processing as null. Processing API/UI full acceptance pending; see COMMENT_PROCESSING.md.

## 2026-10-28 — Owner replies now integrated locally

M3f2a adds genuine Owner replies with authorType=owner,parentCommentId and isMine=false in Guest reads. Same-invitation peers see them readonly; other invitations remain isolated. Stored0042 Guest receipts are unchanged; default provenance parses old JSON without backfill. Shared0043 markers invalidate both actor cursors; Guest v2 schema/digest rejects old v1 tokens. Owner reply/edit/delete and unknown-outcome recovery passed the260-check suite;0043 is locally applied after backup/parity. Owner processing status and annotations remain unfinished. See OWNER_COMMENTS.md for current scope; original Guest acceptance below remains valid.

# Invitation-shared version comments (M3f1)

Accepted locally on2026-10-27:243 full local Worker checks,316 unit tests,61 reference integration tests,14 reference Chromium tests, strict types/lint/Next build passed.0042 is applied only to local development D1 after backup. No hosted OAuth/R2/CORS/edge/deployment acceptance is claimed. FullM1–M5 remains active; Owner comment workflow and annotations are not implemented here.

## Capability and independent permissions

GUEST_COMMENTS_ENABLED defaults false in all3 Wrangler environments and .dev.vars.example; non-local enablement is rejected. Guest exchange and photo-version supporting gates are required. Text reads and writes require independent can_comment (256), not can_view, can_select, can_annotate or can_compare_versions. Image gateways retain their own rights. Owner cookies do not authorize Guest commands.

Threads share only within the exact same sealed invitation, album, logical photo and immutable version. Other invitations to the same photo see separate threads. Author identity and tenant/session scope come from the current cookie, never client scope fields, nickname matching or account email. Every read/write/exact replay checks live session/invitation expiry, revocations, enabled Owner/creator and active parents. Ready current, baselineV1, or immutable successful changed:true head-publication versions are eligible; succeeded processing and exact private derivative slots are required. Ready unpublished drafts stay hidden.

## Routes and lifecycle

GET /api/guest/comments/capabilities returns {enabled:boolean}, an availability hint.

GET /api/guest/albums/:albumId/photos/:photoId/versions/:versionId/comments?cursor=:opaque returns {guestId,photoId,versionId,items,nextCursor}, at most24 ascending items per page. The strict canonical cursor binds current Guest/invitation/album/photo/version via an opaque scope digest, thread change watermark and last creation/id anchor. Malformed/cross-scope cursors return400; a matching scope with a changed watermark returns409 COMMENT_HISTORY_CHANGED. Missing/foreign/unpublished photo targets fail closed with401. The client clears stale pages before explicit reload.

An alternative ?commentId=:uuid returns0/1 current item under identical authorization, with nextCursor:null. It cannot combine with cursor; duplicate/unknown query fields are invalid. Another authorized invitation receives no item for a foreign thread. After confirming a write, the UI uses this current read and revision-monotone merging rather than treating an immutable historical receipt as current state.

POST /api/guest/albums/:albumId/comments/commands accepts guestCommentCommandSchema. create supplies requestId,expectedGuestId,operation,1–24 different photo/version targets and one body. edit supplies commentId,expectedRevision,body; delete/resolve/reopen supply commentId,expectedRevision. All operations include requestId/expectedGuestId. Only the author may mutate; peers read. Authorized stale revision/invalid transition returns409 COMMENT_REVISION_CONFLICT; another author is denied401 before CAS. Resolve requires open, reopen requires resolved, edit preserves open/resolved status, and deletion is terminal with body:null tombstone. Batch creation is all-or-none, one version per logical photo in one album. Text allows1–2,000 normalized Unicode code points and safe newlines/tabs, rejects hidden controls, and renders as literal text.

Safe items expose commentId/photoId/versionId/revision/body/state/authorLabel/isMine and UTC times, not peer Guest/session/invitation identifiers, raw audit, storage keys or credentials. Current thread reads retain deleted tombstones. Own activity exposes only commentId/revision/state deltas and never body text or peer actions.

## Schema, atomicity and capacity

0042 adds guest_comments projection, immutable guest_comment_commands,guest_comment_changes,guest_comment_results and a scoped eligible-version view. Changes/audit must match exact command target, author/session/scope, revision predecessor, transition, request and UTC; comment audit requires a full immutable change witness. Every accepted command creates its results and changes/audit in one SQLite statement. Direct PK/alternate-key replacement, forged sibling-target changes, predecessor rollback and audit forgery are rejected. Request IDs conflict symmetrically with the7 existing Guest ledgers; exchange uses invitation/request scope, the others Guest/request scope. Existing authorization and invalid-state ordering remain intact.

A thread permits1,000 lifetime comments including tombstones. Deleting does not free history capacity. At capacity an exact accepted replay still succeeds; a mixed full/nonfull batch rolls back entirely. Canonical body is stored once per command; repeated result items are bounded to300,000 SQLite text characters. Application Zod enforces NFC/Unicode trim; trusted raw SQLite writers have no built-in NFC normalizer. Photo/version FKs intentionally preserve context; future physical retention deletion must preserve comment/audit tombstones rather than cascade away history.

## UI and unknown outcomes

The current Lightbox and selected After comparison version have a real comment panel. Grid batch targets use separate checkboxes and never change picks. Safe filenames/version labels replace internal IDs. Author editing, delete confirmation, resolve/reopen, literal text, UTC-backed display and explicit24-item load-more work on375px screens. Owner thread/reply/annotation controls are absent until implemented.

One pending intent per album/Guest holds its exact UUID/payload in module memory across same-page unmounts. sessionStorage keeps only operation/Guest/targets/revision/request ID and body hash, with no plaintext body or credentials. Full reload requires explicit matching body/targets to retry. Corrupt/unavailable records block replacement POST. A late old success/401 cannot erase a newer journal; abandonment and async recovery compare the observed original intent. Abandonment is a two-step local decision, not server cancellation. Preparation mutex is released before the network wait, while pending intent still serializes normal writes.

Blur/hidden/pagehide clears visible text and demotes pending plaintext state; focus/visible/pageshow reloads current access. Responses require the same context/generation/Guest before UI application. A validated matching200 proves completion; its matching journal is released after the current-state reconciliation attempt settles, even when that later read is denied. A later read denial clears visible data without pretending the confirmed write is unknown. Immutable same-author/same-session historical replay may return an older body; that receipt never replaces a later edit/deletion in the visible thread. Delete success also clears its confirmation/editor so new composition remains possible.

## Recovery

0042 was applied locally after ignored apps/worker/.local/d1-before-0042-20261027-234330.sql (430590bytes):36 commands succeeded. Follow-up has no pending migration/FK violations; all4 new tables and comment audit count start at0. Populated upgrade acceptance proves no old-table rewrite. A subsequent2026-10-28 isolated backup import passed, with23 old-table counts matching the current DB and both FK checks empty; restored schema correctly predates the4 new tables. The temporary restore copy was removed, original backup retained. This verifies local import/count/FK recovery only, not hosted/R2 or row-content hash parity. Backup SHA-256 is recorded in apps/worker/.local/m3f-backup-integrity.json.

Before application rollback, disable GUEST_COMMENTS_ENABLED. Retain immutable commands/changes/results/audit and guarded projection, preserve asset authorization and repair forward. Never clear unknown requests or drop history to simulate recovery. Restore the backup only into an isolated verified recovery copy. Automatic deletion stays OFF/dry-run; no customer/remote data was changed.

## Verification and remaining work

Full local evidence is .local/m3f-cloudflare-third.log (243 checks, exit0), plus316 unit/38files,61 integration/10files,14 reference Chromium(26.4s), final typecheck/lint/Next build. Targeted22-check version/comment API/browser diagnostic is supplemental. Runtime cases include24 actual R2/Sharp targets with2,000-emoji bodies,1,000-comment cap, atomic rollback, all legacy namespaces, cursor invalidation, current authority, actual mobile lifecycle/CAS, plaintext HTML safety, stale identity, delayed create after deletion, same-Guest late200/401 A/B journal races, corrupt/quota-failed storage and no read-side ledger changes. Screenshot apps/worker/.local/guest-comments-mobile.png was visually inspected.

Headless tests explicitly dispatch lifecycle events; native headed tab delivery is not_checked. Hosted services, real cloud quotas and deployment remain not_checked. Next implement genuine Owner-authorized thread read/reply/moderation with explicit Owner intent/provenance, then independent point/rectangle annotations, full history/exports, delivery/notifications and retention. Same-invitation sharing/different-invitation isolation is the confirmed user decision. FullM1–M5 remains active.
