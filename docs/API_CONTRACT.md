## Guest current-version file downloads (local opt-in)

`GET /api/guest/albums/:albumId/downloads?cursor=UUID` returns a strict `{access, photos, nextCursor}` page, at most24 current ready photo/version rows. Access includes Guest/invite/workspace/project/album IDs, expiry and only the three view/download permission booleans. Each photo has independent nullable `preview`/`original` file descriptors; only allowed kinds are included. No object key, storage credential or signed R2 URL is returned.

`GET /api/guest/photos/:photoId/versions/:versionId/downloads/:kind` streams the authorized private `preview` or `original` as an attachment with `private, no-store`, UTF-8 filename and verified size/SHA-256/MIME. Each attempt uses a server-generated UUID and appends `download.requested`; `download.generated` means prepared for streaming, not client receipt. Unknown/expired/revoked/foreign resources and missing required permission return uniform401. Audit or storage verification failure returns503 without file bytes. A current ready head is required; historical comparison permission does not grant file downloads. FlagOFF returns503. See [GUEST_DOWNLOADS.md](GUEST_DOWNLOADS.md).

## 2026-10-29 — Local resolved batch upload

The opt-in multi-file queue is integrated in the existing Owner album UI. Three focused local375px browser scenarios pass:sequential signed local R2 transfers,exact lost-response recovery,stale-policy/identity admission denial and stale-tab pointer protection. RESOLVED_BATCH_UPLOAD_ENABLED defaultsOFF/hard-local;all cleanup remainsOFF/dry-run. See RESOLVED_BATCH_UPLOADS.md and latest HANDOFF for exact evidence. Formal OAuth,remoteCloudflare,derivative processing in this run,full delivery and remaining M1–M5 scope are not complete.

## 2026-10-29 — Current local milestone

M3i4 immutable opt-in matching rules are accepted locally:367 complete Cloudflare checks,15 focused groups and625 unit tests.0051 is adopted LOCAL ONLY after fresh backup,isolated restore/upgrade and live parity:119 old tables/4 development rows unchanged,four empty new tables,123 total,FK0,ledger51/no pending. All hosted/default gates and automatic deletion remainOFF/dry-run. See MATCHING_RULES.md and latest HANDOFF.md for exact evidence. Next M3i5a builds internal durable batch records/storage;resolved multi-file UI/controller and remaining M1–M5/hosted acceptance remain unfinished.

## M3i3 — Local catalog contract verified

The optional Assisted preview catalogCursor and Owner-only GET upload-candidates contract below passed352 complete local checks and7 focused groups.Each page independently checks current Owner/session/scope/revisions;fresh reserve authorizes the selected real head before existing CAS. Readonly GET has no Origin requirement;mutations retain strict Origin. Default/hosted gates remainOFF;see ASSISTED_CANDIDATE_CATALOG.md and HANDOFF for exact replay/privacy/expiry evidence. Earlier pending entries below are historical.

## M3i3 — Assisted candidate catalog (runtime acceptance pending)

With local ASSISTED_CANDIDATE_CATALOG_ENABLED and indexed prerequisites, complete nonduplicate Assisted previews may add optional catalogCursor. GET /api/v1/albums/:albumId/upload-candidates requires exactly one cursor query, existing Owner session and X-Kino-Expected-Actor; returns at most24 candidates, captured scope/revisions/sequence and nullable nextCursor. Readonly GET has no Origin requirement; mutation guards are unchanged. Cursor is signed, fixed15-minute lifetime and bound to exact Owner/session/scope/preview/watermark. It is never reservation authority or part of journal/canonical payload. Current selected-head authorization plus existing final CAS permit an authorized target outside the tiny preview candidate list. Gate OFF preserves legacy behavior. See ASSISTED_CANDIDATE_CATALOG.md for exact lifecycle, privacy and recovery boundaries; full acceptance is pending.

## M3i2 — Existing automatic preview/reserve contract

With INDEXED_VERSION_MATCHING_ENABLED and supporting local gates, auto_filename uses aggregate full-history evidence beyond the materialized1,000-row cap. Existing endpoint/request/replay shapes remain. In this path candidates contains at most the unique current-head display/authorization entry; candidatesTruncated describes decision evidence completeness, not an album catalog. filename_index_not_ready is an explicit no-reservation review state. Every fresh reserve recomputes coverage and retains sequence/project/head CAS; historical exact replay precedes those checks. Assisted falls back to its existing full candidate behavior. See INDEXED_VERSION_MATCHING.md.

## M3i1 — Owner filename index maintenance

GET /api/v1/matching-filename-index/capabilities and GET/POST /api/v1/albums/:albumId/matching-filename-index use the existing Owner session middleware and current D1 scope checks. POST requires exact Origin, mandatory X-Kino-Expected-Actor, empty strict JSON object, no query, maximum1024 bytes; processes at most24 missing immutable session keys. Status contains scope/profile/counts/state only. MATCHING_FILENAME_INDEX_ENABLED is independent, defaultOFF and local-only. See MATCHING_FILENAME_INDEX.md; this does not enable indexed upload classification.

## 2026-10-28 — Workspace Owner history/export accepted locally

See [OWNER_HISTORY.md](OWNER_HISTORY.md) for current authority,retained invitation attribution,bounded safe projection,HMAC snapshots,stream generation audit,default-OFF gate and additive0048 recovery. Complete standard326-check local API/UI acceptance and529 unit tests passed.0048 is applied locally after new verified backup/restore and118-old-table parity; no remote deployment or hosted acceptance. See latest HANDOFF for logs,limits and remaining work.

## 2026-10-28 — M3g5 independent processing integration in progress

See [ANNOTATION_PROCESSING.md](ANNOTATION_PROCESSING.md) for separate Owner decisions on Guest annotations, dual source/processing CAS, body-free immutable receipts, current-reader clocks and recovery. Contracts/service/routes/read/UI are integrated behind default-OFF hard-local OWNER_ANNOTATION_PROCESSING_ENABLED; full actual runtime acceptance is pending. Guest annotation geometry/authorship/lifecycle and own recovery/result schemas remain unchanged. Persistent D1 remains0046;0047 is source-only. All hosted gates OFF, deletion OFF/dry-run.

## 2026-10-28 — M3g4 locally accepted

Genuine Owner annotation authoring and invitation-shared mixed-role reads are locally accepted with308 complete Worker/D1/R2/Chromium checks and467 unit tests. Real375px geometry/lifecycle/reload/exact replay and actual disabled-Owner403 privacy/journal preservation passed; Root inspected the actual photo/red-rectangle capture.0046 is applied LOCAL ONLY after a new verified backup/isolated restore/110-old-table hash parity:114 tables/same4 development rows/4 new empty Owner tables/FK0/no pending migrations. All gates remain OFF/hard-local and deletion OFF/dry-run; no hosted acceptance. See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) and latest HANDOFF for contracts, logs, recovery and unfinished Owner processing/history work. Earlier in-progress checkpoints below are historical and superseded.

## 2026-10-28 — M3g4 Owner annotation integration in progress

See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) for genuine Owner commands, independent schema0046, author-only recovery, mixed-role invitation sharing, separate cursor watermarks and migration recovery. This source integration is not yet full runtime/browser acceptance. Persistent D1 remains0045; all hosted gates OFF, deletion OFF/dry-run. Existing Guest command/result semantics and cross-invitation isolation remain unchanged.

## 2026-10-28 — Invitation-shared annotation read accepted locally

GET /api/guest/albums/:albumId/photos/:photoId/versions/:versionId/annotations/shared accepts cursor XOR annotationId and returns the existing strict annotation page: guestId is the authenticated viewer, items are only the same sealed invitation/version, and isMine is derived from exact stored author identity. No caller-supplied invite/author scope is accepted. Different invitations return no foreign targeted record. The separate /annotations/own stays author-only and is used for all postreceipt current-row reconciliation. Sharing does not authorize peer commands. Shared cursor namespace is distinct from own/Owner and binds viewer/session/invite/photo/version plus all-author watermark; stale pages409, malformed/cross-scope cursor400, current Guest denial401. Independent can_annotate is required; no image bytes or comment bodies are granted. Peer commentId is redacted without can_comment. Reads append no audit or retention activity. Existing default-OFF hard-local annotation gate applies. Full295 runtime/430 unit/types/lint accepted locally; no hosted claim. See GUEST_ANNOTATIONS/HANDOFF for schema adoption and remaining work.

## 2026-10-28 — M3g2 annotation source integration; runtime acceptance pending

Guest annotations now have a real own-author point/rectangle canvas, version-bound list/lifecycle and metadata-only recovery UI. Guest reads remain own-author only while peer visibility policy is pending. Owner adds GET /api/v1/annotations/capabilities and GET /api/v1/albums/:albumId/photos/:photoId/versions/:versionId/annotations?inviteId=... with cursor XOR annotationId. This route is readonly, returns scoped authorGuestId and canEdit:false, and has no Owner write or Guest impersonation path. It can read retained annotations from expired/revoked sealed invites while current Owner/session and exact owned active resource checks still pass. Exact owned private draft versions may be addressed for metadata; image bytes remain governed by the separate private Owner asset route. OWNER_ANNOTATIONS_ENABLED is independent, default-OFF/hard-local and requires PHOTO_VERSIONS_ENABLED. 427 unit, 61 reference integration, 14 reference Chromium, strict types, lint and Next build pass; full runtime acceptance remains pending. The 12542 attempt passed the first three Owner API groups but stopped in expiry test setup on an immutable invite UPDATE; the repaired short-lived-invite test is awaiting the complete rerun. 0045 is source-only; local D1 remains at 0044. See GUEST_ANNOTATIONS.md.

## 2026-10-28 — M3g1 annotation backend boundary (historical checkpoint)

M3g1 added GET /api/guest/annotations/capabilities; GET /api/guest/albums/:albumId/photos/:photoId/versions/:versionId/annotations/own (cursor XOR annotationId); POST /api/guest/albums/:albumId/annotations/commands. Strict author-only lifecycle/expectedGuestId/expectedRevision and fixed normalized_1e6 geometry; optional own-comment link requires can_comment too. At this historical checkpoint the drawing UI and Owner readonly source were pending; M3g2 source now integrates them, with full runtime acceptance still pending. The 281-check M3g1 local run passed; 0045 remains source-only. See GUEST_ANNOTATIONS.md.

## 2026-10-28 — M3f2b locally accepted

Independent Owner processing and current thread snapshots are now accepted locally:269 full Worker/369 unit/61 reference integration/14 reference Chromium, strict/lint/build passed;0044 locally adopted after verified backup/restore and102 old-table hash parity, new4empty/FK0. This supersedes pending integration notes below. Keep gates OFF/hard-local, Guest lifecycle independent, deletion OFF/dry-run. See COMMENT_PROCESSING.md and latest HANDOFF for contract, recovery and evidence; fullM1–M5/hosted acceptance remains open.

## 2026-10-28 — M3f2b integration pending acceptance

Owner processing API source adds authenticated GET /api/v1/comment-processing/capabilities and POST /api/v1/albums/:albumId/comment-processing/commands with strict body-free set_processing_state, expectedCommentRevision/expectedProcessingRevision, exact Origin and expected actor header. Current thread Guest items now include processing; Owner replies require null. Existing immutable receipts are unchanged with parser defaults. Runtime acceptance pending; see COMMENT_PROCESSING.md.

## 2026-10-28 — M3f2a Owner reply contract accepted locally

OWNER_COMMENTS.md is current. Authenticated Owner capability/thread/reply routes are integrated and exercised in the260-check local suite. Replies bind one sealed invitation/photo/immutable published-ready version and Guest parent; edits/deletes use reply CAS. Origin/expected-actor/JSON guards, canonical request UUIDs, current authority before exact fresh-session replay and scoped cursors are enforced. Guest read items add server-derived authorType/parentCommentId; old stored Guest receipts are unchanged and default to Guest provenance. No Guest text/status mutation is exposed by Owner commands.0043 is local-only applied; feature stays OFF/hard-local and hosted acceptance remains open. Earlier pending entries below are historical.

## 2026-10-28 — Owner reply API source; acceptance pending

New default-OFF/hard-local OWNER_COMMENTS_ENABLED gates authenticated GET /api/v1/comments/capabilities, GET /api/v1/albums/:albumId/photos/:photoId/versions/:versionId/comment-threads?inviteId= (cursor OR commentId), and POST /api/v1/albums/:albumId/comment-replies/commands. Mutations require exact Origin, JSON and X-Kino-Expected-Actor. Strict reply/edit_reply/delete_reply commands use parent/reply revision CAS and normalize request UUID casing. Current authority precedes fresh-session historical replay. Guest read items add server-derived authorType and parentCommentId; Guest mutation receipts remain author-only. See OWNER_COMMENTS.md. New15 API cases passed in a partial full-suite run; final full regression and Owner UI remain pending.0043 is not persistently applied; older acceptance checkpoints below remain historical.

## 2026-10-27 — M3f1 comment contract accepted locally

Current contract is GUEST_COMMENTS.md and packages/contracts/src/guest-comments.ts. Guest commands support atomic create1–24 targets and author-only edit/delete/resolve/reopen with expectedGuestId/requestId/revision CAS. The version-thread GET accepts cursor OR commentId (never both), rejects duplicate/unknown fields and rechecks current invitation/version authority. A targeted current read prevents immutable old write receipts from resurrecting a deleted/edited thread item. Non-author mutations are401; authorized stale CAS409.243 local Worker checks passed;0042 applied locally only after backup. Flag stays OFF/hard-local; hosted/Owner comment APIs are not implemented. Older checkpoints below are historical.

## M3f1 Guest comments — implementation underway

See GUEST_COMMENTS.md and packages/contracts/src/guest-comments.ts. New capability GET /api/guest/comments/capabilities and version-thread GET /api/guest/albums/:albumId/photos/:photoId/versions/:versionId/comments use default-OFF/hard-local GUEST_COMMENTS_ENABLED. POST /api/guest/albums/:albumId/comments/commands accepts create(targets1..24,body) or author-only edit/delete/resolve/reopen(commentId,expectedRevision), with requestId/expectedGuestId. Same-invitation shared reads remain isolated from different invitations; can_comment is independent. Batch commands are atomic and never alter picks. Strict JSON/query/origin and live ACL precede replay. New schema/service/UI/runtime acceptance and0042 adoption remain pending.

## M3e Guest published-version history/comparison API — 2026-10-27

GET /api/guest/version-comparison/capabilities accepts no query parameters and returns only {enabled:boolean}; it reports availability, not invitation authority. GUEST_VERSION_COMPARISON_ENABLED defaults false across Wrangler environments and .dev.vars.example, is rejected outside APP_ENV=local, and requires GUEST_EXCHANGE_ENABLED and PHOTO_VERSIONS_ENABLED.

GET /api/guest/albums/:albumId/photos/:photoId/versions?cursor=:opaque requires the Guest cookie plus independent can_view and can_compare_versions, not can_select. It returns {albumId,photoId,head:{versionId,revision},currentVersion,versions,nextCursor}; versions are descending and limited to24 per page. A ready currentVersion is pinned separately and may be null if the head is not ready. Eligible versions are ready current, baseline V1, or have immutable successful head-publication history recording changed:true. Ready drafts outside the current/baseline V1 exceptions and without publication history are excluded.

The opaque cursor binds photo, current-head ID/revision and last version number. A changed head returns409 GUEST_VERSION_HISTORY_CHANGED. Invalid IDs/query/cursor return400 INVALID_INPUT; unavailable/insufficient Guest scope returns401 GUEST_ACCESS_REQUIRED; disabled/unavailable history returns503 GUEST_VERSION_HISTORY_UNAVAILABLE. Metadata has bounded labels, fixed createdByLabel 攝影師 and no actor IDs, keys, credentials, originals or signed URLs.

The existing GET /api/guest/photos/:photoId/versions/:versionId/assets/:kind accepts only thumbnail/preview. Current bytes require can_view; non-current published bytes additionally require can_compare_versions. Each request rechecks live session/invite/Owner/parent ACL and verifies private R2 output metadata/bytes. Reads make no state/audit changes and do not refresh retention.

Final run7 passed228 local Cloudflare checks, including new API and375px Chromium comparison (.local/m3e-cloudflare-seventh.log).288 unit tests/37files, generated strict types, lint, Next build and targeted formatting also passed. Run6 previously passed new comparison checks but failed later in the exchange test; sequential request/response validation retained all denial assertions and run7 passed. The underlying transport cause is unproven. Hosted OAuth, remote R2/CORS, edge and deployment remain not_checked. See GUEST_VERSION_COMPARISON.md and HANDOFF.md.

## M3c2b2 resolved uploads (local acceptance)

GET /api/v1/upload-resolution/capabilities, POST /api/v1/albums/:albumId/upload-resolution {file}, and POST /api/v1/albums/:albumId/resolved-uploads {requestId,file,expectedChangeSequence,expectedProjectRevision,expectedMode,choice,confirm:true} implement preview and atomic reservation behind PHOTO_VERSION_MATCHING_ENABLED. Reserve returns201 {uploadSession,target}; choice is public, versionTarget is server-derived canonical command metadata. Current ACL precedes exact historical replay; new stale intent returns RESOLUTION_STALE409, duplicates/review cannot allocate. Matching raw dimensions are verified against private R2 at completion; mismatch returns UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH422 and retains needs-review quota. Original ordinary upload init explicitly creates independent photos. See RESOLVED_UPLOADS.md for complete body/response/recovery semantics and real-local-only evidence.

## Cloudflare M3d — same public bodies, durable intent before R2

Upload cancellation and processing abandonment retain their existing strict public request bodies and responses. Server-derived immutable receipts claim actor/request and exact storage target before fencing; callers cannot supply object keys or storage certificates. Known request-ID conflicts fail before R2. Exact retries reauthorize and recover the same receipt/result; final audit failures retain receipts and capacity until certified finalization or safe expiry. Processing output certificates bind the captured keys internally and are never exposed in preview/API JSON. No new public test, claim-key or interleave endpoint is introduced. Existing completed operations continue to replay. See OWNER_INTENT_CLAIMS.md; real hosted behavior remains unverified.

## Cloudflare M3c1 — Owner project version configuration

Owner-authenticated GET /api/v1/versioning/capabilities returns {enabled}. GET /api/v1/projects/:projectId/versioning returns projectId,workspaceId,mode,revision,availableModes:['off','manual']. PUT that project endpoint requires requestId,expectedRevision,mode('off'|'manual'),confirm:true and exact Origin/X-Kino-Expected-Actor. Unknown fields/query parameters are rejected. Result: projectId,workspaceId,mode,revision,changed,eventId(UUID or null for no-op). PROJECT_VERSIONING_REVISION_CONFLICT409 proves a fresh stale intent was not committed; exact historical replay is checked first under current authorization and must be followed by fresh GET. See PROJECT_VERSIONING.md. Feature is OFF/hard-local; real hosted acceptance remains open.

## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison slider/side-by-side/overlay, delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

## M3a current-version API — runtime/browser acceptance pending

Owner-authenticated GET /api/v1/photo-versions/capabilities returns {enabled}. GET /api/v1/photos/:photoId/versions accepts only one optional bounded cursor and returns {photoId,current:{versionId,revision},versions,nextCursor}; at most24 strict metadata items with private Owner gateway URLs. POST /api/v1/photos/:photoId/versions/set-current requires exact Origin and strict {requestId,expectedRevision,expectedCurrentVersionId,versionId,confirm:true}; response is {photoId,current,changed,eventId,occurredAt}. Existing body limits and current Owner/session/tenant checks apply. PHOTO_VERSIONS_ENABLED defaultsfalse/hard-local. No manual V2 upload endpoint is implemented by this slice. See PHOTO_VERSION_HEADS.md for idempotency and definitive conflict rules.

## M2p own-history API — integration pending

See GUEST_HISTORY.md and packages/contracts/src/guest-history.ts. GET /api/guest/history/capabilities returns {enabled}; GET /api/guest/me/activity accepts optional albumId/photoId/cursor only (photoId requires albumId, duplicate/unknown query keys rejected). Current cookie plus independent can_view_own_history authorizes the read. Pages expose {guestId,items,nextCursor}, at most24 projected own events, and exclude raw audit/session/request/storage information. Signed cursor scope digests bind current identity/invitation/filter and snapshot watermark with a fixed15-minute lifetime. Current ACL is checked on every page. GUEST_HISTORY_ENABLED is OFF/hard-local; complete runtime/browser acceptance is pending. Owner invitation capabilities additionally expose historyEnabled without granting any permission.

## Guest tag contract clarification (M2o, accepted locally)

See GUEST_TAGS.md. Tags use independent can_tag and per-invite/Guest memberships, with no Guest project-catalog enumeration. Like M2l ratings/favorites, tags may change after selection submission without modifying the frozen snapshot; this overrides older generic submitted-round edit restrictions for tags only. Stable expectedGuestId protects uncertain retries from cookie identity changes. Routes and Grid/Lightbox controls passed the148-check local suite; GUEST_TAGS_ENABLED remainsfalse with hard-local gating, and hosted acceptance is not claimed.

## M2m3 configuration contracts — accepted locally

Implemented GET/PUT routes /api/v1/projects/:projectId/selection-policy-configuration and /api/v1/albums/:albumId/selection-policy-configuration use packages/contracts/src/project-selection-policy.ts. Project writes bind expectedRevision, min/max and confirm:true. Album writes bind expectedAlbumRevision and expectedProjectRevision, configuration inherit/override and confirm:true; only override accepts min/max. Mutation results contain configuration, eventId and occurredAt; Owner reads additionally expose maxOpenSelectedCount. Local133-check Worker acceptance passed; hosted enablement remains prohibited. Existing GUEST_SELECTION_ENABLED gate remains defaultOFF/hard-local.

## M2m2 shared review API (local integration)

See [SHARED_SELECTION.md](SHARED_SELECTION.md) and packages/contracts/src/shared-review.ts for strict Owner create/list/reopen/history/detail/stream-export and Guest discover/metadata/selection/set/submit contracts. Independent paths keep private selections separate. Guest metadata includes only caller guestId; both mutation inputs require matching expectedGuestId, with actor derived exclusively from the cookie. Keep original witness/UUID/body on uncertain retries. GUEST_SHARED_SELECTION_ENABLED defaults false and rejects hosted enablement. The complete127-check local suite passed; hosted acceptance remains open.

# API 合約（v1）

## M2m1 policy and current Guest selection snapshot

GET/PUT /api/v1/albums/:albumId/selection-policy use current Owner scope and the existing local-only/default-OFF selection gate. GET returns {policy:{albumId,minimum,maximum,revision,mode:'private'},maxOpenSelectedCount}; PUT strict {requestId,expectedRevision,minimum,maximum,confirm:true} returns immutable {policy,eventId,occurredAt}. Bounds1..100000, maximum nullable and minimum<=maximum. Stale policy, maximum below an open draft, request reuse and selection bounds are409 with documented codes. No-op adds no false state event.

Guest selection GET now requires selectionPolicy {minimum,maximum,revision,mode:'private'} plus independent canSubmit:boolean in each coherent snapshot. New cursors carry policyRevision; a changed policy yields SELECTION_CHANGED. Mutations keep old immutable result shapes. Submit bounds use SELECTION_MINIMUM_NOT_MET/SELECTION_LIMIT_REACHED409. New reopen results use revision1; historical pre0029 replay retains0. Clients must GET current selection state after a historical replay. No new permission is implied. See SELECTION_POLICY.md.

## M2l independent feedback contract

See GUEST_FEEDBACK.md for full request/result schemas. PUT /api/guest/albums/:albumId/photos/:photoId/rating accepts requestId, versionId, stars(1–5|null); analogous /favorite accepts favored:boolean. Strict objects reject actor/tenant extras. GET /api/guest/albums/:albumId/ratings or /favorites takes1–24 unique repeated photoId query parameters, denies the whole foreign/missing batch, and returns only own state/defaults without keys, filenames, audit or retention writes. Independent can_rate/can_favorite apply even without can_view/select; image access still requires can_view. Current ACL precedes replay, payload/target/action reuse conflicts409, denied scope401. PUT requires exact Origin and bounded JSON. Public /api/guest/feedback/capabilities returns {enabled}; Owner invite capabilities add feedbackEnabled. Both describe availability only. GUEST_FEEDBACK_ENABLED defaultsfalse and rejects nonlocal enablement.

M2j current: the local-only/default-OFF Guest selection flow includes 24-photo gallery pages, hydration across all selection cursors, sequential visible-page-only batch mutation, stale/partial-write refresh, stable logout retry IDs, submission and keyboard-operable dialogs. Owner review/detail/export supports CSV/TXT/JSON; only the latest submitted round can reopen with an audited transition. Migrations0023–0026 enforce current ACL, immutable sealed snapshots and scope-stable round transitions. Verified local evidence is Cloudflare109, unit88, integration61 after timeout correction, strict typecheck, lint, Next production build, 14 Next/reference Chromium E2E tests, format, handoff checker (30 specs) and diff check. Owner export generation appends a scoped download.generated event before returning the attachment; this records server generation, not proof of client receipt. Full activity history remains open. Full action/history parity, selection limits, independent Guest permission combinations and hosted/deployment acceptance remain open. See GUEST_SELECTION.md, GUEST_GALLERY.md and GUEST_EXCHANGE.md.

M2f historical: admission returns allowed/inviteKnown/retryAfterSeconds only to trusted service callers; never expose inviteKnown or distinct throttle/credential denial. M2g connects this gate to a local-only exchange route using same-origin input, CF-Connecting-IP only, pre-KDF admission and atomic current ACL/session/use/audit. Failure to resolve trusted IP/counters is closed. See GUEST_ADMISSION.md.

M2e historical: local Owner password-mode invitation POST may return503 KDF_CAPACITY_UNAVAILABLE before hashing or503 KDF_RELEASE_UNAVAILABLE after native settlement with unconfirmed release. Never automatically issue a replacement; preserve original request and reconcile metadata/retry. Link-only and committed metadata recovery do not require KDF. M2g adds Guest exchange while retaining a private lock/repair surface. See KDF_ADMISSION.md.

## M2h Guest gallery and private derivative reads

`GET /api/guest/albums/:albumId/photos?cursor=:opaque` returns `{photos:[{id,versionId,filename,width,height,createdAt,processing,thumbnailUrl,previewUrl}],nextCursor}` with at most24 photos per page. The M2h baseline read version_no=1; M3a later changed the gallery to current-head reads, and M3e adds published-version history/comparison above. A cursor is optional, unique, and validated; unknown/duplicate query parameters or malformed IDs/cursors return400. An authorized empty album returns an empty page; an unauthorized/foreign album shares401 `GUEST_ACCESS_REQUIRED`.

`GET /api/guest/photos/:photoId/versions/:versionId/assets/:kind` permits only `thumbnail` or `preview`. Every request uses the configured Guest cookie and checks the current sealed invite album scope, can_view, enabled Owner, active album/project state, session/invite expiry and revocations. Missing, invalid, revoked, foreign, or insufficient sessions/resources share401 `GUEST_ACCESS_REQUIRED`. The private output must match the successful processing job/output slot and JPEG metadata; R2 bytes are checked against stored size and SHA-256 and capped at8MiB. Successful bytes are inline, same-origin, `private, no-store`, and vary by Cookie. Corrupt/missing output is503; invalid kind or UUID is400. No original, signed object key, download grant, state change, audit event or view heartbeat is exposed. Exact limitations and regression coverage: GUEST_GALLERY.md.

## M2d local Owner issuer (current, default-OFF)

POST `/api/v1/projects/:projectId/invites` accepts strict `{requestId,albumIds[1..24 distinct UUID],accessMode,permissions:all12booleans,expiresAt:UTC,maxUses:null|1..10000,password?:custom-only}`. Same-Origin JSON/current Owner/session/16KiB; new issuance requires APP_ENV=local AND GUEST_INVITE_ISSUANCE_ENABLED=true (false in every env).200 discriminated response: proven first winner `{invite:{inviteId,workspaceId,projectId,createdAt,expiresAt},secretAvailable:true,token,generatedPassword:null|64hex}`; all committed replays `{invite,secretAvailable:false}`. Custom password never echoed. GET `/api/v1/invites/creation/:requestId` returns metadata-only under current Owner, even flag off/archived/revoked.400 input,401 anonymous,403 Origin/Owner,404 parent/request,409 config/password/request/scope/expiry/limit,503 disabled new work/unknown result. Six Owner command ledgers share namespace; secrets require positive insert plus committed candidate/hash/verifier match. At M2d, no secret recovery/share URL/Guest exchange was exposed. M2g adds a separate local-only exchange route; key rotation still uses recovery GET. Exact details in INVITE_ISSUANCE.md.

## M2c Guest self-logout (current)

POST `/api/guest/logout` accepts strict `{requestId:UUID}` after exact configured Origin/JSON/16KiB checks; target comes only from canonical Guest cookie, never body actor/session/invite.200 `{loggedOut:true}` confirms revocation then expires only Guest HttpOnly cookie (HTTPS __Host-kino_guest; Secure; Path=/; no Domain; SameSite=Lax; Max-Age=0, local HTTP kino_guest without Secure). Unknown/absent cookie also200 with no mutation.400 invalid/extra input,403 Origin,413 body size,409 same-Guest/request different session conflict,503 unknown result; failed mutations do not clear cookie. Exact replay is idempotent and audit correlates request/Guest/session/project/invite. Expired or Owner-disabled sessions can revoke themselves. No Owner cookie change. Private/no-store/no-referrer. At M2c, issuance/exchange/public KDF were absent; M2g later adds a local-only exchange route. See GUEST_CREDENTIALS.md.

## M2b Owner invitation inspection/revocation (current)

GET `/api/v1/projects/:projectId/invites?cursor=...` requires current Owner/session and returns `{invites:[{id,workspaceId,projectId,accessMode,permissions,createdAt,expiresAt,revokedAt,sealed,maxUses,issuedSessions,albums:[{id,name}]}],nextCursor}`;24 items with UTC/id keyset. No secrets/hashes/passwords/R2 keys; private/no-store. POST `/api/v1/invites/:inviteId/revoke` accepts strict `{requestId:UUID,confirmRevoke:true}`, exact Origin/current Owner/session; returns `{revocation:{inviteId,workspaceId,projectId,revokedAt}}`.400 invalid/extra/unconfirmed,401 anonymous,403 Origin/Owner,404 unknown/foreign,409 request conflict or new request for already-revoked invite,503 unknown failure.16KiB body limit. Exact committed replay returns same result under current authorization, including archived parents; all five ledgers share actor/request namespace. New audit has client request ID; historical audit unchanged. Guest sessions denied immediately after commit. At M2b, public invite creation/exchange/logout were absent. Later milestones add the gated Owner issuer and Guest session endpoints. Full semantics in OWNER_INVITATIONS.md.

## M2a Guest authorization foundation (historical)

GET `/api/guest/albums/:albumId/access` is outside Owner-only /api/v1 and accepts only the configured HTTPS __Host-kino_guest cookie (kino_guest for local HTTP). Returns `{access:{guestId,inviteId,workspaceId,projectId,albumId,permissions,expiresAt}}` after current invite/session/explicit sealed album/Owner/state/expiry/revocation/can_view checks. Missing, invalid, revoked, expired and unavailable scope share401 GUEST_ACCESS_REQUIRED; invalid UUID400. Private/no-store, no-referrer, no Set-Cookie, no keys/URLs/secrets and no writes. It issues no session or write grant. Guest photo listing/preview is separately specified by M2h above; it does not issue a download grant. At M2a, invite creation/exchange/logout/gallery/actions were still planned; later milestones add gated local-only issuance/exchange/logout and M2h read-only gallery. Table rows may exist from local fixtures or gated issuer tests. See GUEST_ACCESS_FOUNDATION.md.

## CF-03c5 upload recovery (current)

GET `/api/v1/uploads/recovery/:initRequestId` is a current-Owner/session, original-init scoped, purely read-only query; it does not run the old GET expiration sweep. Returns `{initRequestId,uploadSession,contentType,sha256,authorizationRequestId,authorizationExpiresAt}` with full existing canonical session shape and nullable legacy fingerprint/auth fields. No object key/URL/auth cookie/credential.400 invalid UUID,401 anonymous,403 disabled Owner,404 unknown/foreign/non-init request; private/no-store. Browser compares canonical scope/name/size/MIME/hash before continuation. Browser upload mutations send optional X-Kino-Expected-Actor; when present it must be a UUID matching authenticated owner or403 UPLOAD_OWNER_CHANGED before route writes. It is an expectation, never auth, and is not forwarded to R2. No URL renewal or multipart change. See UPLOAD_RECOVERY.md.

## CF-03c4b processing abandonment (current)

POST `/api/v1/photos/:photoId/versions/:versionId/processing-review/abandon` accepts strict `{requestId:UUID,expectedLeaseEpoch:positiveInt,confirmAbandon:true}` after same-origin JSON/current Owner/session checks. Returns `{jobId,status:'abandoned',leaseEpoch,releasedBytes:16777216,originalRetained:true}`. No client keys/proofs. Two verified permanent empty R2 fences precede the D1 atomic command/job/two-level quota/audit transaction.400 invalid/missing confirmation/extra fields;401 anonymous;403 Origin/disabled Owner;404 foreign/unavailable scope;409 epoch/state/node/request conflict or occupied output;503 uncertain fencing/unknown service outcome. Exact committed retry returns the snapshot with current authorization, including archived parent; different payload/operation conflicts. Client must retain same operation ID on unknown responses. GET remains read-only and cannot preview abandoned jobs. Gallery schema now includes abandoned with no image URLs. See PROCESSING_REVIEW.md.

## CF-03c4a historical processing review preview

GET `/api/v1/photos/:photoId/versions/:versionId/processing-review` is current Owner/session scoped and private/no-store. Only needs_review jobs: returns jobId/photoId/versionId/status/leaseEpoch/reason/heldBytes(16777216)/potentialReleaseBytes(0 or16777216)/originalRetained(true)/dryRun(true)/outputs[{kind,state}]. State is missing/fenced/occupied/unknown; keys are server-derived and never returned. Authorization and epoch are rechecked after storage reads.400 invalid UUID,401 anonymous,403 disabled Owner,404 unknown/foreign/unavailable scope,409 non-review state. No writes, audit event, human-view heartbeat or quota release; preview is advisory. No corresponding POST exists yet. See PROCESSING_REVIEW.md.

CF-03c3 adds Owner-only `GET /api/v1/albums/:albumId/photos?cursor=...` and `GET /api/v1/photos/:photoId/versions/:versionId/assets/:kind`. The page returns24 version1 metadata rows and a nullable keyset cursor; fields are `id,versionId,filename,width,height,createdAt,processing,thumbnailUrl,previewUrl`. Processing states are queued/running/retryable/needs_review/succeeded/unsupported/unavailable; image URLs stay null until trusted processing succeeds. Only thumbnail/preview kinds are served, with current Owner/session/scope plus exact job/slot/checksum checks; original access is absent. Unknown/foreign resources return404, invalid query/kind400, auth401/403 and inconsistent physical derivatives503. All image/list responses are private/no-store. Local manifests remain unaccepted; there is no public processing completion/mutation endpoint. Trusted local runner and exact recovery contract are in PROCESSING_PIPELINE.md. Upload completion still performs header checks and transactionally enqueues the independent full-decoding job.

路徑 `/api/v1/...`，所有資源要以 actor session + workspace/scope 驗證，不允許只用 path id 決定授權。Response 錯誤統一 `{ "error": { "code": string, "message": string, "details"?: object }, "requestId": string }`；timestamp ISO8601 UTC。會改變狀態的 POST/PUT/PATCH 具 requestId/idempotency。Zod 驗證 request/response；API pagination 以 opaque cursor。

## Auth/Workspace

| Method | Path                             | 目的                                                                             | 權限                |
| ------ | -------------------------------- | -------------------------------------------------------------------------------- | ------------------- |
| POST   | `/guest-invites/:token/exchange` | 交換 token（含 password/OTP）取得 HttpOnly scoped session；redirect 清 URL token | invite secret       |
| POST   | `/guest-sessions/logout`         | 撤銷 guest session                                                               | guest               |
| GET    | `/me`                            | 目前 actor/角色/權限                                                             | auth                |
| GET    | `/workspaces`                    | 列出可管理的空間                                                                 | owner/team          |
| POST   | `/workspaces`                    | 建立空間                                                                         | authenticated       |
| GET    | `/client-portal/projects`        | 受驗證的跨專案清單                                                               | client portal grant |

## Project/Album/Share

| Method    | Path                          | 目的                        |
| --------- | ----------------------------- | --------------------------- |
| GET/POST  | `/projects`                   | 篩選專案、新建              |
| GET/PATCH | `/projects/:id`               | 查詢/修改                   |
| GET/POST  | `/projects/:id/albums`        | 相簿清單/新增               |
| PATCH     | `/albums/:id`                 | 改標題/排序/保護/政策       |
| POST      | `/projects/:id/invites`       | 建立 invite token/模式/權限 |
| POST      | `/invites/:id/revoke`         | 立即撤銷                    |
| POST      | `/projects/:id/review-rounds` | 建立新輪次                  |
| POST      | `/review-rounds/:id/submit`   | 交易提交快照                |
| POST      | `/review-rounds/:id/reopen`   | 限攝影師／指定管理權限      |

## Upload/Photos

| Method | Path                                          | 目的                                                                                              |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| POST   | `/uploads/init`                               | 驗證 quota + 預留容量，建立待上傳 session                                                         |
| POST   | `/uploads/:id/authorize`                      | Owner-only 建立短效、checksum-bound R2 PUT grant                                                  |
| POST   | `/uploads/:id/complete`                       | 驗證 R2 object metadata / checksum / magic，建立 original photo/version/asset；thumbnail 尚未實作 |
| POST   | `/uploads/:id/cancel`                         | 取消單次上傳 reservation；已授權時先 fence object key；目前沒有 multipart cleanup                 |
| GET    | `/albums/:id/photos?cursor=...`               | 分頁 photo metadata + authenticated previews                                                      |
| GET    | `/photos/:id`                                 | photo detail current state                                                                        |
| GET    | `/images/:assetId`                            | 私有圖片 gateway，驗權限與尺寸                                                                    |
| POST   | `/photos/:id/versions/init`                   | 指定照片產生新版本上傳                                                                            |
| POST   | `/photos/:id/versions/complete`               | 結束新版本                                                                                        |
| GET    | `/photos/:id/versions`                        | 版本清單                                                                                          |
| POST   | `/photos/:id/versions/:versionId/set-current` | 切換 current                                                                                      |
| POST   | `/uploads/resolve-match`                      | 同檔名疑義人工批次確認                                                                            |
| POST   | `/photos/:id/diff`                            | before/after 產生 heatmap (feature flag)                                                          |

## Review, activity

| Method | Path                                           | 目的                                     |
| ------ | ---------------------------------------------- | ---------------------------------------- |
| PUT    | `/review-rounds/:id/photos/:photoId/selection` | selected:true/false，transaction + event |
| PUT    | `/photos/:id/rating`                           | stars 1..5 or null                       |
| PUT    | `/photos/:id/favorite`                         | favored true/false                       |
| PUT    | `/photos/:id/tags`                             | add/remove labels                        |
| POST   | `/photos/:id/comments`                         | 留言與回覆                               |
| PATCH  | `/comments/:id`                                | 編修文字和狀態                           |
| POST   | `/photos/:id/annotations`                      | 正規化 geometry                          |
| PATCH  | `/annotations/:id`                             | 修改／刪除標註                           |
| GET    | `/projects/:id/activity?cursor=...`            | owner/team 受限操作全歷史                |
| GET    | `/photos/:id/activity`                         | 按照片歷程                               |
| GET    | `/guest/me/activity?projectId=...`             | 客戶自己的歷程                           |
| GET    | `/projects/:id/selected-export`                | 選片 TXT / CSV                           |
| POST   | `/albums/:id/view-heartbeat`                   | 有效瀏覽（去重節流）                     |

## Storage and retention

| Method    | Path                                   | 目的                                              |
| --------- | -------------------------------------- | ------------------------------------------------- |
| GET       | `/storage/usage`                       | ledger、reserved、reconciled、bucket distribution |
| GET/PATCH | `/storage/policy`                      | 設定 retention、quota、閾值（owner only）         |
| POST      | `/storage/retention/preview`           | 不破壞資料的 dry-run plan                         |
| GET       | `/storage/retention/plans/:id`         | 查看候選、排除原因、預估 bytes                    |
| POST      | `/storage/retention/plans/:id/execute` | owner explicit confirmation; policy eligible only |
| POST      | `/storage/retention/jobs/:id/cancel`   | 刪除尚未開始部分                                  |
| GET       | `/storage/retention/jobs`              | job history                                       |
| POST      | `/storage/retention/jobs/:id/retry`    | 僅 retry failed; idempotent                       |

## Delivery

| Method | Path                       | 目的                               |
| ------ | -------------------------- | ---------------------------------- |
| POST   | `/projects/:id/deliveries` | 建立交付                           |
| GET    | `/deliveries/:id`          | 授權的交付清單                     |
| POST   | `/deliveries/:id/download` | 授權分辨版本與解析度下載、事件 log |
| POST   | `/deliveries/:id/zip`      | 產生有期限 ZIP 的背景作業          |

## 常見錯誤代碼

`AUTH_REQUIRED`, `INVITE_EXPIRED`, `INVITE_REVOKED`, `PASSWORD_INVALID`, `FORBIDDEN_SCOPE`, `TENANT_MISMATCH`, `REVIEW_LOCKED`, `SELECTION_LIMIT_REACHED`, `VERSION_MATCH_AMBIGUOUS`, `DUPLICATE_CONTENT`, `QUOTA_EXCEEDED`, `UPLOAD_NOT_VERIFIED`, `ASSET_DELETING`, `RETENTION_POLICY_NOT_ENABLED`, `REQUIRES_DRY_RUN_REVIEW`, `CONCURRENT_MODIFICATION`, `RATE_LIMITED`, `NOT_FOUND`。

## API 規約例子

`PUT /review-rounds/123/photos/abc/selection` body `{"selected":true,"requestId":"uuid"}` → `{ "selected": true, "selectedCount": 12, "limit": 30, "eventId": "uuid", "occurredAt": "...Z" }`。
`POST /storage/retention/preview` → `{ "planId": "...", "dryRun": true, "currentBytes": 6400000000, "targetBytes": 5200000000, "candidates": [...], "excluded": [...] }`。
`GET /photos/:id/versions` → `[{"versionNo":1,"assetReady":true,"comment":"original"},{"versionNo":2,"assetReady":true,"comment":"retouch"}]`。

所有正式 endpoint 應產出 OpenAPI 文件（可從 Zod 或定義同步產生），並附錯誤碼與授權範例；不可只產生 API URL 表但沒有實作。

## M1-01 implemented locally (2026-10-23)

Only these endpoints are implemented at this stage; tables above remain the full roadmap.

- POST `/auth/google`: same-origin native form; Supabase Google OAuth/PKCE redirect. Configured callback only.
- GET `/auth/callback`: one-use provider code exchange, verified Google identity, ensure profile, fixed dashboard redirect. Untrusted next/Host ignored.
- POST `/auth/logout`: same-origin, local-session sign out, fixed login redirect.
- GET `/api/v1/me`: `{actor:{id,provider:'google'}}` from verified getUser, never cookie data alone.
- GET `/api/v1/workspaces?cursor=...`: `{workspaces:[{id,name,ownerUserId,role,createdAt,quotaBytes}],nextCursor:string|null}`. 24 items per page, descending `(created_at,id)`, opaque validated cursor preserves microseconds. No other tenant data returned.
- POST `/api/v1/workspaces`: JSON `{name,requestId:uuid}` (no actor/owner fields accepted) → 201 `{workspace}`. Same actor/requestId/body returns same result; changed payload → 409 REQUEST_ID_CONFLICT. 100 owned workspace application limit. Auth caller can independently create a workspace even if a member of another workspace.
- PUT `/api/v1/workspaces/:workspaceId/members`: owner-only JSON `{userId,role:'workspace_editor'|'photographer'|'retoucher',status:'active'|'suspended',requestId}` → `{member:{workspaceId,userId,role,status}}`. Existing platform profiles only. Owner transfer/removal, team invitations and management UI are not implemented; no UI pretends otherwise.

Mutations enforce canonical Origin/Fetch Metadata and a 16KiB streamed JSON limit, unknown fields rejected. Errors use the standard envelope and generic safe messages; no DB/token details. Auth-disabled requests return AUTH_UNAVAILABLE (503), invalid session AUTH_REQUIRED (401), non-Google identity 403, cross-tenant/owner-only writes FORBIDDEN_SCOPE (403), owner role mutation 409. All protected responses are private/no-store. Empty workspace arrays are real RLS results, not synthetic demo data. Real Google/Supabase/PostgREST verification is still outstanding; tests use a separate loopback fixture.

## M1-02 implemented locally — create/read/rename subset

- GET `/api/v1/projects?workspaceId=uuid&cursor=...` → `{workspace,projects,nextCursor}`.
- POST `/api/v1/projects`: strict `{workspaceId,name,requestId}` → 201 `{project}`.
- GET `/api/v1/projects/:projectId` → `{workspace,project}`.
- PATCH `/api/v1/projects/:projectId`: strict `{name,expectedRevision,requestId}` → `{project}`.
- GET `/api/v1/projects/:projectId/albums?cursor=...` → `{workspace,project,albums,nextCursor}`.
- POST `/api/v1/projects/:projectId/albums`: strict `{name,requestId}` → 201 `{album}`.
- PATCH `/api/v1/albums/:albumId`: strict `{name,expectedRevision,requestId}` → `{album}`.

Project: `{id,workspaceId,name,status,versioningMode,revision,createdAt}`. Album: `{id,workspaceId,projectId,name,state,isPinned,legalHold,revision,createdAt}`. Creation starts at revision 1 and draft/manual defaults. Names trim to 1–160 characters. List pages contain at most 24 rows in descending `(created_at,id)` with validated opaque cursor preserving timestamp microseconds.

Owner/editor/photographer may create and rename; retoucher reads only. Missing/cross-tenant/suspended resources uniformly return NOT_FOUND (404), including a replay after revocation; an active read-only retoucher mutation returns FORBIDDEN_SCOPE (403). Inputs cannot override parent IDs, status, protection flags or actor. Name and revision changes, before/after audit, and request ledger commit atomically. A different request with a stale revision returns CONCURRENT_MODIFICATION (409); same request/body replays the original result without another revision/event. Changed body/operation under the same actor/requestId returns REQUEST_ID_CONFLICT (409). New rename requests, including unchanged names, advance revision.

UI routes: `/dashboard/workspaces/:workspaceId` lists projects; `/dashboard/projects/:projectId` lists albums. Conflict reload keeps the draft and requires review before saving against the refreshed revision. Owner-only album protection and reversible empty-content archive/restore routes are implemented. Destructive DELETE and publication/full lifecycle transitions remain pending. CF-03c1 已有本機 feature-gated upload UI；持久化 photo grid 仍待 M1-04。

## OAuth 多來源與主動綁定（2026-10-23）

- POST `/auth/google` / `/auth/github`：同源 native form，僅限 AUTH_PROVIDERS 啟用來源；來源停用 503。Google/GitHub 登入共用既有固定 `/auth/callback`，用 stable user ID 建 profile。
- POST `/auth/link/:provider`：已登入 + 同源 + app manual linking 開關 + allowlisted provider，建立私有短效 intent，SDK PKCE 前往 provider；已綁定 409，pending 過多 429。token 不在 URL、body、回應 JSON 或 audit 中。
- GET `/auth/link/callback`：單一 code + HttpOnly intent + 當前 verified actor；先讀 actor-scoped hash intent，再交換code，驗同 user ID/intended provider、寫 completion。固定 redirect 到 `/dashboard/account?notice=linked` 或 generic error，不接受 next/actor 參數控制目的地。
- `/dashboard/account`：顯示 server-verified bound providers，可新增另一來源；來源停用/未設定 manual linking 時沒有無效按鈕。沒有 unlink/merge API。
- GET `/api/v1/me` actor.provider 擴充為 google|github，為優先 Google 的其中一個合資格已綁 identity，**不是當前 OAuth session 登入來源**。授權仍以 actor.id、session 及 workspace role；不依 provider 取得跨租戶權限。

Private DB begin/read/complete link RPC 僅支援相同 actor，未驗證 provider identity 不可 complete。新錯誤碼 OAUTH_IDENTITY_REQUIRED=403、LINK_INTENT_INVALID=400、LINK_NOT_VERIFIED=403、IDENTITY_ALREADY_LINKED=409、LINK_LIMIT_REACHED=429。應用錯誤訊息不洩漏 provider URL/code/token/其他帳號資料。

## M1-02 album protection increment (2026-10-23)

PATCH `/api/v1/albums/:albumId/protection`: strict JSON `{isPinned:boolean,legalHold:boolean,confirmUnprotect:boolean,expectedRevision:positiveInt,requestId:uuid}` → `{album}`. Requires current workspace owner, canonical Origin, verified session and the existing streamed body limit; scope/actor/state overrides rejected. Ordinary album PATCH remains name-only. Active non-owner members get403; missing/cross-tenant/suspended gets404. Supports flags on draft/active/archived without changing state. Deleting/deleted → RESOURCE_NOT_EDITABLE409. Clearing either currently true flag without explicit confirmation → PROTECTION_CONFIRMATION_REQUIRED409. Stale revision shares CONCURRENT_MODIFICATION409 with rename. Replays and changed payload follow the existing global request ledger rules, after current authorization.

UI: owner sees album protection settings in project album list; unprotect requires acknowledgement; network retries retain identical body/request ID. Conflict retains choices, requires reload and comparison against current flags, then confirmation again if removing current protection. Other members see saved labels only. These controls do not enable cleanup, implement archive/restore or prove legal compliance.

## Empty-content archive/restore increment (2026-10-23)

PATCH `/api/v1/projects/:projectId/archive` or `/api/v1/albums/:albumId/archive`, strict JSON `{archived:boolean,expectedRevision:positiveInt,requestId:uuid}` → `{project}` / `{album}`. Verified current workspace owner only; canonical Origin, streamed JSON limit, standard private/no-store errors. Active non-owner403; missing/cross-tenant/suspended404. INVALID_STATE_TRANSITION409 for unsupported/same target state or legacy archive with unknown origin; CONTENT_NOT_EMPTY_OR_IDLE409 for photos/busy content; RESOURCE_NOT_EDITABLE409 for album transition under archived parent. CAS409 and idempotency follow existing rules; current authorization precedes historical replay.

Initial project archive supports draft/delivered with zero photos and children only draft/archived; album supports draft with zero photos under draft/delivered parent. Restore exact stored origin, with parent restored first. Children are not cascaded. UI owner controls include confirmation, conflict reload/review/reconfirmation and same-body network retry. Archived project cannot rename/create albums, archived/deleting/deleted albums cannot rename. Ordinary PATCH cannot change state. Protection stays independent/owner-editable; flags and human-view times unchanged. Full photo/review/upload/delivery lifecycle and deletion remain pending.

## Cloudflare foundation API boundary

New apps/worker routes are not a full replacement for the above Next business API yet. GET /api/health reports migration-foundation/not_checked, GET /api/v1/me and /api/v1/storage/nodes require a valid Better Auth session plus current enabled Owner. Unknown subject/session denied, node response excludes credential_ref/account/endpoint. POST /api/auth/sign-in/social and GET provider callbacks/get-session plus POST sign-out are mature SDK handlers with exact canonical Origin, 16KiB real body limit, HttpOnly/Lax and HTTPS Secure cookies. Other Auth operations remain404 until fresh-link/unlink/session-management protections exist. Closed target has no public signup/first-login owner route or production mock mode. CF-03b 已掛載本機 D1 upload backend routes（見下節）；DIRECT_UPLOAD_ENABLED 在 local、staging、production 都預設為 false，測試才用 synthetic R2 signer/binding。Live R2、bucket CORS、remote D1 和 browser-to-live-R2 transfer 尚未驗證；CF-03c3 now provides local trusted derivative jobs and private Owner gallery after the feature-gated uploader; production processing/live resources remain unverified. Legacy endpoints remain a separate reference until D1 ports/Owner acceptance; do not route production users to the foundation.

## CF-02a D1 workspace API (local backend slice)

Worker GET /api/v1/workspaces and POST /api/v1/workspaces now use D1, retaining the reference JSON envelopes, strict createWorkspaceSchema, 24-row keyset pages, name normalization, request UUID and 100-owned-workspace cap. Owner-only target policy replaces reference multi-member access for this slice; no team management endpoint is exposed. Both require current Better Auth session and enabled Owner; POST additionally requires exact canonical Origin, application/json and a real 16KiB body bound. Unknown fields/invalid cursor/JSON return INVALID_INPUT400, conflicting request409 REQUEST_ID_CONFLICT, cap409 WORKSPACE_LIMIT_REACHED. Successful retries return original workspace/201, including after reaching the cap. API errors contain no raw SQL. Responses remain private/no-store.

D1 timestamps use canonical UTC milliseconds; shared opaque cursor envelope is retained, not a cross-database cursor migration guarantee. D1 workspace quota is9GB internal configuration, not extra allocatable physical capacity per workspace. The current target UI/API covers the workspace/project/album subset documented below; this is not complete UI/API parity. Existing Next routes continue to use their original repository.

## CF-02b Worker D1 content API (backend, no UI cutover)

All target routes require a Better Auth session and current enabled Owner. Mutations require exact canonical Origin, application/json and <=16KiB streamed body. Inputs share strict packages/contracts schemas and return private/no-store.

- GET `/api/v1/projects?workspaceId=<uuid>&cursor=...` → `{workspace,projects,nextCursor}`; 24 rows/page, descending `(created_at,id)`, D1 cursor. GET `/api/v1/projects/:projectId` → `{workspace,project}`. POST `/api/v1/projects` strict `{workspaceId,name,requestId}` → 201 `{project}`. PATCH `/api/v1/projects/:projectId` strict `{name,expectedRevision,requestId}` → `{project}`.
- GET `/api/v1/projects/:projectId/albums?cursor=...` → `{workspace,project,albums,nextCursor}`. POST same route strict `{name,requestId}` →201 `{album}`. PATCH `/api/v1/albums/:albumId` strict `{name,expectedRevision,requestId}` → `{album}`.
- PATCH `/api/v1/albums/:albumId/protection` strict `{isPinned,legalHold,confirmUnprotect,expectedRevision,requestId}`. Clearing saved protection requires confirmUnprotect=true.
- PATCH `/api/v1/projects/:projectId/archive` and `/api/v1/albums/:albumId/archive` strict `{archived,expectedRevision,requestId}`; owner-only, reversible origin saved. Projects only draft/delivered with no albums/photos; albums only draft with no photos under draft/delivered parent. No cascade and no object deletion.

All operations now share `(actor_id,request_id)` in `request_commands`; operation plus canonical validated payload must match or returns REQUEST_ID_CONFLICT409. Current Owner/session and resource tenant are checked before replay; create/rename/state/audit/result are one D1 transaction. Renames use revision CAS, replay yields the original response, audit stores before/after. Errors include INVALID_INPUT400, AUTH_REQUIRED401 from middleware, OWNER_REQUIRED403, NOT_FOUND404, REQUEST_ID_CONFLICT/CONCURRENT_MODIFICATION/RESOURCE_NOT_EDITABLE/PROTECTION_CONFIRMATION_REQUIRED/INVALID_STATE_TRANSITION/CONTENT_NOT_EMPTY_OR_IDLE409. Owner-only policy applies to this target; legacy member roles remain in the still-running Next reference. UI calls are not switched to these routes yet.

Migration0005 makes D1 parent IDs immutable and rejects a photo-catalog insert unless project/album/workspace all match. There is still no public photo creation endpoint; this table exists for scope and archive integrity only.

Audit `requestId` is scoped to the actor/guest-session command ledger. Equal request IDs from separate actors are allowed; `eventId` identifies a single append-only history row.

## M2g Guest session exchange

`POST /api/guest/exchange` is outside the Owner-only `/api/v1` middleware and does not create a platform account. It accepts strict JSON `{requestId,token,displayName,password?}` with a16KiB streamed bound, exact configured Origin and body token only. `CF-Connecting-IP` is required; `CF-Worker` is rejected, and no caller-supplied IP/XFF is trusted. `GUEST_EXCHANGE_ENABLED` defaults false and is hard-rejected outside `APP_ENV=local`.

Success returns `200 {authenticated:true,expiresAt}` and a one-time HttpOnly Guest cookie. The raw session bearer is absent from JSON. Local HTTP uses `kino_guest`; HTTPS uses `__Host-kino_guest; Secure`; both are SameSite=Lax/Path=/, host-only and clamped to24h/invite expiry. The final current invite, Owner, sealed album scope, expiry/revocation and max-use are checked in the atomic identity/command/session/audit write. Session audit uses the request ID. Password attempts use the same global KDF slot as Owner invite issuance.

All credential/scope/rate/capacity/max-use/replay denials return the same `401 {error:{code:"GUEST_ACCESS_REQUIRED"}}`, without retry timing, invite/session IDs or cookie. Malformed body/schema400, Origin403, oversized413, and disabled/unavailable local gate503 remain distinct preconditions/service failures. A post-commit lost HTTP response cannot be recovered or reissued: same request ID is denied, no second session is created and its max-use remains consumed. See GUEST_EXCHANGE.md. M2h later adds scoped read-only gallery/photo-preview routes; no Guest action API or UI is claimed.

## Current Worker surface used by CF-02c

The Worker UI uses GET /api/v1/me, GET/POST /api/v1/workspaces, GET/POST /api/v1/projects, GET/PATCH /api/v1/projects/:id, GET/POST /api/v1/projects/:id/albums, PATCH /api/v1/albums/:id, PATCH /api/v1/albums/:id/protection, and PATCH /api/v1/projects/:id/archive or /api/v1/albums/:id/archive. These routes are same-origin and require the current enabled Owner/session; there is no browser service-role credential. Unknown /api paths stay JSON 404. This sentence is historical CF-02c status: the Worker now includes local-only gated Guest gallery, version history/comparison and action APIs. Consult the dated Guest contracts above; hosted OAuth and delivery remain separate release gates.

## CF-03b D1 upload authorization and verified completion (historical backend baseline)

The Worker currently exposes the following Owner-only, same-origin routes. Every route requires an unexpired Better Auth session whose user is an enabled Owner, exact canonical `Origin` for mutations, `Content-Type: application/json`, and the streamed 16 KiB body limit. Scope and actor ownership are checked again on each lookup. The Worker foundation error body is currently `{ "error": { "code": "..." } }`; the wider API envelope above remains the product contract to converge on.

| Method | Path                                         | Strict request body                                                                           | Success                                         |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| POST   | `/api/v1/uploads/init`                       | `{workspaceId,projectId,albumId,originalFilename,expectedBytes,contentType,sha256,requestId}` | `201 {uploadSession}` with `status:"reserved"`  |
| GET    | `/api/v1/uploads/:uploadSessionId`           | none                                                                                          | `200 {uploadSession}`                           |
| POST   | `/api/v1/uploads/:uploadSessionId/authorize` | `{requestId}`                                                                                 | `200 {uploadAuthorization}`                     |
| POST   | `/api/v1/uploads/:uploadSessionId/complete`  | `{requestId}`                                                                                 | `200 {completion}`                              |
| POST   | `/api/v1/uploads/:uploadSessionId/cancel`    | `{requestId}`                                                                                 | `200 {uploadSession}` with `status:"cancelled"` |

`uploadSession` contains the opaque session ID, workspace/project/album IDs, original filename, `expectedBytes`, `reservedBytes`, and a status of reserved, cancelled, expired, completed, or needs_review; createdAt/expiresAt timestamps are UTC `createdAt`/`expiresAt`. It deliberately excludes the generated object key, R2 binding, credential reference, and signed URL. `originalFilename` is 1–255 characters with path/control characters rejected. `expectedBytes` is a positive safe integer no greater than `5,363,466,240` bytes (5 GiB minus 5 MiB); accepted types are `image/jpeg`, `image/png`, and `image/webp`; `sha256` is a lowercase 64-character hexadecimal digest.

Init reserves the expected bytes against the workspace and the active `primary` node for 15 minutes. It only accepts the same owned-workspace/project/album states as the existing archive guards. A same actor/request ID and identical immutable payload replays the original result without a second reservation or audit event. Reusing that request ID with a different payload or colliding with another command returns `409 REQUEST_ID_CONFLICT`. `STORAGE_QUOTA_EXCEEDED` is `409`; unknown, cross-tenant, suspended, or non-owned sessions are deliberately indistinguishable as `404 NOT_FOUND`; missing Owner is `403 OWNER_REQUIRED`; an unavailable ledger is `503 STORAGE_LEDGER_UNAVAILABLE`.

Upload errors currently use the foundation body { "error": { "code": "..." } } (no message or requestId yet): 400 INVALID_INPUT; 401 AUTH_REQUIRED; 403 OWNER_REQUIRED or FORBIDDEN_ORIGIN; 404 NOT_FOUND; 409 REQUEST_ID_CONFLICT, STORAGE_QUOTA_EXCEEDED, UPLOAD_SESSION_EXPIRED, UPLOAD_ALREADY_AUTHORIZED, UPLOAD_AUTHORIZATION_EXPIRED, UPLOAD_OBJECT_EXISTS, UPLOAD_OBJECT_NOT_FOUND, UPLOAD_ALREADY_COMPLETED, UPLOAD_NEEDS_REVIEW, UPLOAD_VERIFICATION_MISMATCH, or INVALID_STATE_TRANSITION; 413 BODY_TOO_LARGE; 422 UPLOAD_CONTENT_INVALID; and 503 STORAGE_LEDGER_UNAVAILABLE, DIRECT_UPLOAD_DISABLED, or DIRECT_UPLOAD_NOT_CONFIGURED.

Init, cancel, authorize, and complete request IDs are actor-scoped across the D1 command/workflow ledgers. Repeating an operation with the same request ID and payload returns its saved result; changing the operation or payload under that ID returns 409 REQUEST_ID_CONFLICT. Authorization can be issued once per upload session; only replaying the same authorization request ID returns the original grant.

Authorize creates a one-time D1 authorization record for the session and returns a short-lived R2 PUT grant:

```json
{
  "uploadSessionId": "uuid",
  "method": "PUT",
  "url": "https://...",
  "expiresAt": "2026-10-23T00:00:00.000Z",
  "contentLength": 1234,
  "headers": {
    "Content-Type": "image/jpeg",
    "If-None-Match": "*",
    "x-amz-checksum-sha256": "..."
  }
}
```

The URL signs the exact byte length, MIME, SHA-256 checksum, `If-None-Match: *`, and generated tenant/project/album/session object key. Its lifetime is at most 10 minutes and never exceeds the 15-minute upload session. It is a bearer URL and may be replayed until expiry, so the key is create-once and the permanent fence described below is required. A browser upload uses the returned content type, checksum and conditional header, with a Blob/File whose byte length equals `contentLength`; a Chromium Blob/File PUT test confirms the browser supplies the matching `Content-Length` automatically. Repeating the same authorization request is deterministic; a different request ID after authorization returns `409 UPLOAD_ALREADY_AUTHORIZED`. With `DIRECT_UPLOAD_ENABLED=false`, the route returns `503 DIRECT_UPLOAD_DISABLED`; missing R2 signer settings return `503 DIRECT_UPLOAD_NOT_CONFIGURED`.

The client performs the PUT directly to R2, then calls complete. Complete performs a bounded R2 `HEAD` plus a first-16-byte range read and requires stored size, R2 checksum, stored MIME, and JPEG/PNG/WebP prefix signatures (JPEG 3 bytes, PNG 8 bytes, WebP 12 bytes) to match the immutable D1 specification. This checks file signatures only; it does not fully decode the image or generate thumbnails. A valid object atomically creates the logical photo, version 1 and immutable original asset, converts workspace/node `reserved_bytes` to `used_bytes`, appends the completion audit event, and returns `{uploadSessionId,status:"completed",photoId,versionId,assetId,actualBytes,contentType,sha256,completedAt}`. The completion request is idempotent by actor/request ID and payload. Missing object or invalid state returns `409`; a size/MIME/checksum/magic mismatch records an immutable review flag, returns `422 UPLOAD_CONTENT_INVALID`, exposes session status `needs_review`, and keeps the reservation. There is no automatic release of a review-held reservation.

Cancel is idempotent by actor/request ID and payload. Before cancelling an authorized session, the service conditionally creates a permanent zero-byte R2 fence marker at the generated key with If-None-Match: *, records the durable D1 fence row and append-only upload.capability_fenced event, and only then releases the reservation and marks the session cancelled. An occupied key that is not this session's fence returns 409 UPLOAD_OBJECT_EXISTS; the session and quota stay reserved. An unissued reservation can be cancelled without an R2 fence. Completed sessions return 409 UPLOAD_ALREADY_COMPLETED; other invalid transitions return 409 INVALID_STATE_TRANSITION.

Five-minute Cron and request-time expiry handle unissued reservations directly. Request-time GET expiry does not process authorized reservations. Cron releases an authorized, expired reservation only after the same conditional permanent R2 fence marker and D1 fence record succeed; if the key is occupied or the fence cannot be confirmed, counters stay reserved for retry. A fenced or completed key is never reused, so a previously issued bearer URL cannot write a late object after cancellation or expiry. Cron does not delete customer photos and the retention engine remains observation-only.

CF-03b is a backend/local verification slice. DIRECT_UPLOAD_ENABLED defaults to false in config.ts and is explicitly false in local, staging and production Wrangler variables; only local Miniflare tests override it with synthetic R2 signer values and an isolated R2 binding. The Worker code and local tests do not prove live R2, bucket CORS, remote D1, real OAuth, or browser-to-live-R2 transfer. No upload UI, photo grid/gallery, or thumbnail job is implemented here. D1 schema migration 0009_upload_authorization_and_assets.sql adds the immutable upload authorization, fence, review, photo/version/asset and completion records. D1 migration 0010_upload_spec_payload_correction.sql is a forward-only schema repair for the early local 0009 draft. D1 migration 0011_photo_scope_integrity.sql adds scoped indexes and guards for photo/version/asset/completion/audit relationships. The local Wrangler D1 is upgraded through early-draft 0009, repair 0010 and 0011; migration 0011 was also exercised in an isolated Miniflare upgrade test. None of these migrations has been applied remotely. Keep the migrations, do not down-migrate, and complete a representative backup/restore rehearsal through 0011 before any remote application.

## CF-03c1 historical upload contract

Owner/session-protected GET /api/v1/uploads/capabilities returns {enabled,maxBrowserBytes:67108864,maxPixels:80000000,maxDimension:32768}, private/no-store with no signer secrets/account/endpoint. Enabled requires configured/enabled signing. POST /uploads/init now applies the same gate before reservation:503 DIRECT_UPLOAD_DISABLED or DIRECT_UPLOAD_NOT_CONFIGURED with no session/quota write.

New completion results add encoded width/height inspected by server. Read at most262144 header bytes; malformed/impossible/over-limit dimensions return422 UPLOAD_CONTENT_INVALID and needs_review with quota held. JPEG SOF/PNG IHDR+CRC/WebP container checks are structural only.0012 stores dimensions atomically in new immutable versions/completions/results/audit; historical replay snapshots remain unchanged, including old responses without dimensions.

Browser UI decodes before reserve, bounds20 files/64MiB each, makes transient local previews, and retries each operation with its original ID. Unknown PUT first confirms before retransmission. No new photo-read/gallery endpoint, persisted thumbnail, proxy transfer or reload-resume API.

## M2j Guest selection and Owner submission API (local-only vertical slice)

GET /api/guest/albums/:albumId/selection?cursor=:opaque requires the Guest cookie and independent can_select (permission bit 8). It returns at most 24 of the caller's own selected rows shaped as {photoId,versionId,selectedAt}, with selectedCount, roundNo, selectionRevision, roundStatus, submittedAt and nextCursor. It does not expose filenames, image/object keys, asset URLs or another Guest's state. The keyset cursor is bound to album, round and selection revision; stale round/revision returns 409 SELECTION_CHANGED. Authorized empty state returns an empty page; foreign/expired/revoked/insufficient scope remains non-enumerating 401 GUEST_ACCESS_REQUIRED. Reads add no audit event and do not refresh retention activity.

PUT /api/guest/albums/:albumId/photos/:photoId/selection accepts strict {requestId: UUID, selected: boolean, versionId: UUID}; the exact version is mandatory for select and deselect. It requires can_select. A state change writes selection.added, selection.removed or selection.version_changed with immutable before/after history; exact retry returns the original result and changed reuse is 409 REQUEST_ID_CONFLICT.

POST /api/guest/albums/:albumId/selection/submit accepts strict {requestId: UUID, expectedRoundNo?: positive integer, expectedRevision?: nonnegative integer}; expectedRoundNo and expectedRevision must be supplied together. It requires independent can_submit (bit 512), not can_select. The client cannot submit photo IDs or versions: D1 takes the current per-Guest selection, pins each exact photo/version ID and selected time into immutable submission items, writes the immutable result and selection.submitted event, seals the snapshot, and marks the round submitted in one transaction. Empty selection returns 422 EMPTY_SELECTION; stale or already submitted rounds return 409. The Guest page shows the current round, selection, submission confirmation and frozen state after success.

Owner routes require the current enabled Owner session and album workspace ownership. GET /api/v1/albums/:albumId/submissions returns submission summaries; GET /api/v1/albums/:albumId/submissions/:submissionId returns immutable item detail with version-pinned photo/version IDs and metadata (filename, version number, size and dimensions). GET /api/v1/albums/:albumId/submissions/:submissionId/export?format=csv|json|txt exports the selected snapshot (default CSV; TXT is a filename list). POST /api/v1/albums/:albumId/rounds/reopen accepts {requestId: UUID, inviteId: UUID, guestId: UUID, expectedRoundNo: positive integer}; after explicit Owner confirmation, it creates the next open round and appends selection.reopened with current session and exact album/round scope. The current selection state remains available for Guest changes in that round, while existing submission snapshots remain sealed. The same request is replayable; stale, unauthorized or conflicting transitions fail closed. Each successful export writes a scoped download.generated event with submission ID, format and selected count before returning the attachment. Filenames/content are omitted; audit failure fails closed.

UI behavior and acceptance boundary: the Guest album screen paginates gallery rows by24, hydrates its selection map by reading every selection cursor page, and runs batch changes sequentially only on the visible page. A stale revision or partial write requires a server refresh before editing continues. Logout retries reuse the stable original request ID. Submit and Owner reopen dialogs keep keyboard focus manageable and support Escape/Tab. The Owner UI exposes reopen only on the latest submitted round. Current local evidence: Cloudflare109, unit88, integration61 after timeout correction, strict typecheck/lint, Next production build, 14 Next/reference Chromium E2E tests, format, handoff checker (30 specs), and diff check passed. The reference-app E2E suite does not exercise the Worker UI.

All routes are behind GUEST_SELECTION_ENABLED. It defaults to false in all Wrangler environments and .dev.vars.example; configuration rejects true unless APP_ENV=local. Guest mutations require exact Origin, bounded bodies and the Guest HttpOnly cookie. Missing/revoked/expired/foreign/under-permissioned Guest scope returns401 GUEST_ACCESS_REQUIRED; disabled feature is503; malformed input is400; origin mismatch is403. Owner routes use the Owner session. Migrations0023–0026 are additive and forward-only; see [GUEST_SELECTION.md](GUEST_SELECTION.md) for recovery.

## M2k invitation UI capability and entry contract

`GET /api/v1/invites/capabilities` requires the current enabled Owner/session and returns `{issuanceEnabled, exchangeEnabled, selectionEnabled, maxAlbums:24, maxUses:10000, maxExpiryDays:365}`. `GET /api/guest/capabilities` is anonymous and returns only `{exchangeEnabled}`. They are read-only, private/no-store and never create a grant/session or reveal configuration secrets. Availability requires the corresponding flag and APP_ENV=local; neither endpoint changes the existing issuer/exchange authorization.

The UI share URL is `/guest/albums/:albumId/enter#token=<64-lowercase-hex>`. Bootstrap captures a single valid fragment token and cleans the URL before render; no bearer is accepted from query/path. The Guest entry form calls the existing exchange POST. Lost/unknown outcomes can check the existing album access GET but cannot auto-create a replacement session or recover a lost bearer. See INVITATION_FLOW.md for transient Owner results, exact intent retries, and acceptance boundaries.

## 2026-10-29 — Authorized photo-view heartbeat local slice

Owner/Guest POST album view-heartbeats now validates current viewing authority and ready private photo/version,then atomically appends a rolling-five-minute-deduped gallery.viewed witness and monotonic last-valid-view projection. Loaded,intersecting,visible/focused photos must qualify for1s in the Gallery;metadata/download-only/Cron fetches do not count. This is a browser heuristic,not proof of humanity or complete occlusion detection. Three native API groups and two375px controlled browser flows pass;see HUMAN_PHOTO_VIEWS.md and latest appended HANDOFF entry.

0053 remains SOURCE ONLY and default persistent D1 remains0052;tracking and deletion defaultOFF/dry-run. Continuous activity evidence for legacy/disabled/outage periods is not established by an absent timestamp:the pure planner now rejects activityEvidenceVerified=false. Actual D1 snapshot/plan persistence/policy/Owner confirmation/deletion locks/jobs/retry/reconciliation/global quota/hosted acceptance remain required. The user's one-person representative approval rule is confirmed;version confirmation implementation is next.

## 2026-10-29 Owner currentVersion pin

Owner photo version list includes `currentVersion` metadata matching `current.versionId` from the same authorized read. New cursors pin head/revision and stale use returns 409; legacy cursor format remains accepted and consumers must recheck head/revision. Existing Owner preview endpoints remain private and no Guest authority is widened. See latest HANDOFF for local validation and default-OFF boundary.
