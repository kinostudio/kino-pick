## 2026-11-08 Candidate schema0067 (not adopted live)

`0067_delivery_zip_tickets.sql` adds one unique audit request index, one live authorization view and two audit INSERT guards. It adds no photo/asset table and never rewrites immutable originals or previous deliveries. ZIP tickets and requested/generated events are append-only audit records; fixed manifests bind tenant/project/album/invitation/session, exact original versions, sizes and SHA256. Source originals remain in their existing storage nodes; streaming does not store duplicate ZIP objects.

Before live adoption: fresh protected schema66 export, independent remote restore,0067 upgrade, exact prior-table/schema/sequence/hash/FK parity, then fresh-source parity. Recovery is feature-OFF plus forward repair; do not overwrite live data with an old snapshot. Full cloud proof is still pending explicit backup/restore authorization. Capture metadata is read on demand, and notification feeds project existing audit events; neither introduces new persisted customer fields.

## Migration0052 — Guest media download audit integrity (LOCAL adopted)

Adds only `guest_media_download_audit_guard` to enforce exact current-version media witnesses,independent download permissions,current sealed-invite/session scope and paired requested/generated events. No product table or row is replaced. Fresh backup/isolated restore-upgrade/live parity preserved123 product tables and4 development rows;local ledger52,no pending migrations. See HANDOFF and GUEST_DOWNLOADS for proof and rollback. No hosted adoption claim.

## 2026-10-29 — Current local milestone

M3i4 immutable opt-in matching rules are accepted locally:367 complete Cloudflare checks,15 focused groups and625 unit tests.0051 is adopted LOCAL ONLY after fresh backup,isolated restore/upgrade and live parity:119 old tables/4 development rows unchanged,four empty new tables,123 total,FK0,ledger51/no pending. All hosted/default gates and automatic deletion remainOFF/dry-run. See MATCHING_RULES.md and latest HANDOFF.md for exact evidence. Next M3i5a builds internal durable batch records/storage;resolved multi-file UI/controller and remaining M1–M5/hosted acceptance remain unfinished.

## M3i3 — Verified local0050 adoption

0050 adds only photos_assisted_catalog_scope_id on photos(workspace_id,project_id,album_id,id). Fresh backup/isolated restore/upgrade and root fresh live-parity adoption preserve all119 old table hashes/counts/schema/product sequences,same4 development rows;one index,FK0,ledger50/no pending. No remote/customer migration. HANDOFF pins backup699707-byte/source hashes and evidence paths. Disable the catalog flag for application rollback,retain immutable data and repair forward;never restore an old backup over newer writes. This current status supersedes pending-source entries below.

## M3i3 — Additive source0050 (not persistently adopted)

0050_assisted_catalog_index.sql adds photos_assisted_catalog_scope_id on photos(workspace_id,project_id,album_id,id), without new tables or product data rewrites. Isolated populated native D1 checks preserve all119 old table hashes/counts/schema/sequences and FK0, and prove the unforced scoped BINARY ID range uses this covering index. Catalog cursors are transient signed context, not database authority or immutable request fields. Persistent local DB remains0049; no remote migration. See ASSISTED_CANDIDATE_CATALOG.md for forward recovery and pending vertical acceptance.

## M3i2 — Local0049 adoption

0049 is applied LOCAL ONLY after fresh verified backup/isolated restore/upgrade and root live parity.119 product tables/same4 development rows: all118 old table hashes/schema/product sequences unchanged,new matching_filename_index empty,FK0,ledger49/no pending. No new schema beyond0049 is required for indexed aggregate classification. See HANDOFF for pinned hashes/proofs and INDEXED_VERSION_MATCHING.md for the current service contract. Hosted/default gates remainOFF.

## M3i1 — Derived filename witnesses (0049)

Migration0049 adds matching_filename_index keyed by immutable upload session plus default-v1 profile, with exact source scope/name FK witness, append-only replacement/update/delete guards and scoped canonical lookup indexes. Existing rows are untouched. Invalid canonical names are explicit markers; unlinked versions and missing heads block readiness. See MATCHING_FILENAME_INDEX.md for trusted canonicalization boundary and forward recovery. Persistent adoption is separate from isolated test migration.

## 2026-10-28 — Workspace Owner history/export accepted locally

See [OWNER_HISTORY.md](OWNER_HISTORY.md) for current authority,retained invitation attribution,bounded safe projection,HMAC snapshots,stream generation audit,default-OFF gate and additive0048 recovery. Complete standard326-check local API/UI acceptance and529 unit tests passed.0048 is applied locally after new verified backup/restore and118-old-table parity; no remote deployment or hosted acceptance. See latest HANDOFF for logs,limits and remaining work.

## 2026-10-28 — M3g5 independent processing integration in progress

See [ANNOTATION_PROCESSING.md](ANNOTATION_PROCESSING.md) for separate Owner decisions on Guest annotations, dual source/processing CAS, body-free immutable receipts, current-reader clocks and recovery. Contracts/service/routes/read/UI are integrated behind default-OFF hard-local OWNER_ANNOTATION_PROCESSING_ENABLED; full actual runtime acceptance is pending. Guest annotation geometry/authorship/lifecycle and own recovery/result schemas remain unchanged. Persistent D1 remains0046;0047 is source-only. All hosted gates OFF, deletion OFF/dry-run.

## 2026-10-28 — M3g4 locally accepted

Genuine Owner annotation authoring and invitation-shared mixed-role reads are locally accepted with308 complete Worker/D1/R2/Chromium checks and467 unit tests. Real375px geometry/lifecycle/reload/exact replay and actual disabled-Owner403 privacy/journal preservation passed; Root inspected the actual photo/red-rectangle capture.0046 is applied LOCAL ONLY after a new verified backup/isolated restore/110-old-table hash parity:114 tables/same4 development rows/4 new empty Owner tables/FK0/no pending migrations. All gates remain OFF/hard-local and deletion OFF/dry-run; no hosted acceptance. See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) and latest HANDOFF for contracts, logs, recovery and unfinished Owner processing/history work. Earlier in-progress checkpoints below are historical and superseded.

## 2026-10-28 — M3g4 Owner annotation integration in progress

See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) for genuine Owner commands, independent schema0046, author-only recovery, mixed-role invitation sharing, separate cursor watermarks and migration recovery. This source integration is not yet full runtime/browser acceptance. Persistent D1 remains0045; all hosted gates OFF, deletion OFF/dry-run. Existing Guest command/result semantics and cross-invitation isolation remain unchanged.

## 2026-10-28 — Annotation schema adopted locally

0045 is locally applied: guest_annotation_commands, guest_annotations, guest_annotation_changes and guest_annotation_results start empty;110 product tables retain the same4 development rows and all106 prior table hashes/FK0/no pending migrations. Backup/restore evidence is in HANDOFF. Invitation sharing is a read projection over the same immutable version-bound records, not a schema rewrite: shared pages use invitation-wide change watermark and exact viewer/session/scope digest; own pages remain author-only. isMine is derived from exact stored Guest ID, never normalized case or client input. Public peers do not receive authorGuestId; Owner readonly pages may include the scoped author ID with canEdit:false. Owner authored commands/processing require genuine separate Owner provenance in later work.

## 2026-10-28 — M3g1 annotation backend boundary

0045 source adds guest_annotation_commands/guest_annotations/guest_annotation_changes/guest_annotation_results, eligible-version alias and indexed symmetric Guest UUID namespace guards. Fullscope/state/change/audit/result transition is atomic and append-only. Own list/watermark indexes are actual D1 plan-verified. Populated0044 old rows/comment marker sequence preserved/new4empty/FK clean. No local adoption; see GUEST_ANNOTATIONS.md.

## 2026-10-28 — M3f2b locally accepted

Independent Owner processing and current thread snapshots are now accepted locally:269 full Worker/369 unit/61 reference integration/14 reference Chromium, strict/lint/build passed;0044 locally adopted after verified backup/restore and102 old-table hash parity, new4empty/FK0. This supersedes pending integration notes below. Keep gates OFF/hard-local, Guest lifecycle independent, deletion OFF/dry-run. See COMMENT_PROCESSING.md and latest HANDOFF for contract, recovery and evidence; fullM1–M5/hosted acceptance remains open.

## 2026-10-28 — M3f2b integration pending acceptance

0044 source adds owner_comment_processing_commands/state/changes/results and comment_processing_snapshots. It preserves every prior table row and the shared comment_thread_changes sequence, extending only its source-witness guard. Owner processing revisions and Guest create/edit content revisions are independent; transient Owner sessions have no historical FK. New immutable audit/receipt contains no Guest body. Local persistent adoption pending; see COMMENT_PROCESSING.md.

## 2026-10-28 — Cloudflare0043 locally adopted

Owner commands/replies/changes/results and shared comment_thread_changes are applied locally only.63 commands succeeded after verified backup/restore;97 prior product tables retain exact content hashes,5 new tables are empty, FK clean/no pending migrations. A separate populated0042 Guest create/edit/history fixture with actual private R2/Sharp V2 survives0043 unchanged. Owner session audit strings are not transient session FKs; Guest0042 actor/session/receipt rows are preserved. Nonunique legacy actor/lower(request_id) indexes support canonical new Owner namespace guards without rewriting accepted aliases. See OWNER_COMMENTS/HANDOFF for full recovery and evidence. No remote data changed.

## 2026-10-28 — Cloudflare0043 Owner replies (not persistently applied)

Source adds owner_comment_commands/replies/changes/results plus shared comment_thread_changes. Guest0042 projections and immutable receipts are not rewritten. Reply parents bind an exact Guest comment in the same invitation/album/photo/version. Owner session IDs are validated against live sessions on insert but retained as immutable strings without a transient session FK, so logout does not pin old sessions. Shared markers bind an immutable Guest/Owner source change and invalidate v2 thread cursors transactionally. Lowercase new request keys and nonunique legacy actor/lower(request_id) indexes guard both namespace insertion orders without changing accepted aliases. See OWNER_COMMENTS.md for recovery and remaining runtime/upgrade/UI acceptance.

## 2026-10-27 — M3f1 comment schema accepted locally

0042 adds guest_comments, guest_comment_commands, guest_comment_changes, guest_comment_results and guest_comment_eligible_versions. Full populated upgrade snapshots preserve all earlier table data. Each lifecycle change binds its exact command commentId, author/invitation/tenant/photo/version, predecessor/revision, UTC/session/request and audit witness; direct sibling-target redirection is rejected.1,000 lifetime rows per invitation/photo/version includes tombstones. Internal batch targets store IDs only; shared body is stored once. Result text is bounded to300,000 SQLite characters. All4 tables/audits begin empty after verified local adoption; no backfill. Future Owner writers require a separate authenticated namespace/provenance path rather than fabricated Guest sessions. Physical retention deletion must account for comment/version FKs and retained audit context. Current contract/recovery: GUEST_COMMENTS.md. Earlier pending notes below are historical.

## M3f1 version comment model — implementation underway

0042 is being implemented with an immutable Guest comment command/change/result ledger and guarded current projection. Each comment binds exact invitation/author/workspace/project/album/photo/version, and every change is audited with UTC/session/request/before/after. Same-invitation readers do not own peer comments. Batch creation has one canonical request plus1..24 independently version-bound items; edits/status/deletion use revision CAS and tombstones rather than rewriting history. No persistent0042 adoption or runtime acceptance yet; see GUEST_COMMENTS.md and HANDOFF.md.

## Cloudflare0041 — resolved upload payload guards

No new Owner ledger/table or historical rewrite. Existing upload_requests.payload_json adds a strict resolution object and optional server-derived versionTarget, preserving actor/request canonical identity. New-request guards verify0040 watermark and project mode/revision atomically before quota/reservation; old head CAS/namespace/ACL guards remain. Mode guards now permit four supported modes; the upload guard permits exactly one extra resolution field. Workflow completion must match saved raw dimensions. Existing upload_review_flags UPLOAD_METADATA_MISMATCH holds quota on mismatch. The new feature flag remains OFF/hard-local.0041 is applied locally only after backup; see HANDOFF/RESOLVED_UPLOADS for preservation and forward recovery.

## Cloudflare0040 — internal album matching watermarks

album_matching_changes uses a safe-integer AUTOINCREMENT sequence, exact workspace/project/album FK and immutable unique(kind,source_id,source_revision,source_state) identity. Future photo/version/head/upload lifecycle mutations append markers atomically. Per-album MAX(sequence), or0 for pre-existing content, is an invalidation watermark; no historical data is rewritten or backfilled. Markers are not user operation audit events and do not infer actor/request or causal ordering. New snapshot readers also include unfinished upload reservations.0040 is local-only accepted; forward recovery retains the table/triggers/history. See PROJECT_VERSIONING/HANDOFF.

## Cloudflare target0039 — immutable external-effect receipts

owner_external_intents has actor_id/request_id primary identity and fixed operation/session/workspace/project/album/storage-node plus an upload session/object key or processing job/photo/version/epoch/output keys. It contains no quota counters and has no per-target uniqueness. New receipts append owner.external_intent_claimed with UTC and session/request correlation, omitting keys from audit JSON. Current Owner/scope and immutable target checks precede replay. Namespace guards cover all current Owner command ledgers and legacy user fence witnesses; only an exact bound finalizer may use the same request ID. Existing rows, aliases and completed operations are unchanged. A partial actor/request fence index avoids a full scan on each Owner write. See OWNER_INTENT_CLAIMS.md for runtime proof, residual hosted gates and forward recovery.

## Cloudflare target0038 — project version mode configuration

projects.versioning_mode remains authoritative and shares projects.revision with rename/archive. Nullable versioning_command_id points to the last actual changed-mode command; existing projects remain null. project_versioning_commands/results are immutable actor/request-scoped canonical witnesses. Changed mode writes one before/after audit and increments the project revision; no-op seals its result without revision/pointer/audit changes. Guarded updates require the predecessor/result/audit witness; inserts cannot clone a historical command pointer. See PROJECT_VERSIONING.md for runtime evidence and forward-only recovery. Automatic/assisted writes remain unavailable until resolver integration.

## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison slider/side-by-side/overlay, delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

## M3a separate current-version heads — 0036 pending local application

0036 adds photo_version_heads plus immutable photo_version_head_commands/results. Existing V1 metadata is backfilled at revision0 and new V1 inserts seed a head; immutable photo_versions.status is not changed. Confirmed switches bind expected current ID/revision, exact scoped ready target, predecessor command, current Owner authorization and append-only photo.version_current_changed audit atomically. No-op retains revision and emits no fake event; safe-integer overflow is rejected. Populated migration preservation and direct D1 guards passed in the main test path, but final browser acceptance/persistent local application remain pending. Retain records/heads on rollback and repair forward with writes disabled.

## M2p final local verification — supersedes earlier pending status

Final full Worker run54253 passed157 local checks (.local/m2p-cloudflare-lifecycle.log), including history API privacy/current ACL/cursor scope, three-page fixed lifetime, deleted-photo witnesses, real Chromium pagination and explicit lifecycle-event identity clearing.134 unit/25files,61 integration/10files,14 reference Chromium, final generated Worker/web strict typecheck, lint/format, Next build and36-file documentation checks passed.375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected.

0035 was applied to local development D1 only (4 commands), and follow-up migration list is empty. Existing history was preserved. Recovery is forward-only; disable history on application rollback and retain indexes/audit. All feature flags remain OFF/hard-local and retention deletion remains OFF/dry-run. No remote/customer data, deploy, commit or push occurred.

Limit: headless Chromium did not emit native blur/visibility on bringToFront or the isolated CDP probes. The passing browser test explicitly dispatches FocusEvent blur/focus and checks current-cookie/D1 reload plus old-data clearing. Native headed desktop tab delivery and hosted E2E remain not_checked. This does not complete the full product goal. Earlier status/failure notes below are retained as historical evidence, not the current acceptance status.

Next work: immutable explicit Owner photo versions with a separately audited CAS current-version pointer; current uploads/galleries hardcode V1. Add independent non-current Guest comparison authorization before V2 exposure. Comment visibility choice remains pending; do not broaden disclosure. Filename tombstones, full history/Owner views, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 goal stays active.

## M2p Guest history indexes — 0035 pending local application

0035_guest_history_index.sql adds three partial audit indexes for own Guest actor/time, album/time and photo/time queries. It adds no tables and rewrites no history. Historical audit session witnesses bind the same invite and Guest; current session and sealed active albums independently authorize each read. Populated migration preservation passed in the first isolated full-harness run, but persistent local migration application and full history acceptance are pending. Recovery is forward-only; leave indexes intact on application rollback with history disabled. No hosted migration has been applied.

## M2o Guest tag schema (0034, applied locally)

Four additive tables implement independent tag feedback: guest_tag_labels is an immutable workspace/project label catalog; guest_tag_commands records canonical per-Guest request intent and exact version/session/identity witness; guest_tag_results retains immutable before/after/result/event commitment; guest_tag_state stores per-invite/Guest/photo/tag presence with predecessor-linked provenance. Removal retains state/history. SQL rechecks current sealed scope, Owner, session, expiry/revocation and can_tag before replay; mutations and audit are atomic. Reads return only caller state, never a shared catalog list. Both result and catalog reject primary/alternate-key replacement; state rejects historical-witness rollback. See GUEST_TAGS.md for limits and no-op behavior.

0034 applied locally only (28 commands), no pending migrations. Populated migration preservation and API checks passed in the144-check backend run; isolated real workerd cap/immutability/predecessor probes passed. Final integrated148-check local suite including browser acceptance passed; these facts do not authorize hosted enablement. Restore forward and preserve all history; disable GUEST_TAGS_ENABLED before application rollback.

## M2n2 — immutable photo insertion accepted locally

0033 prevents REPLACE across version id/photo-version number, asset id/object key/version-kind and processing output job-kind/asset ID/object key; null photo version/asset IDs are rejected. Existing rows, scope checks and mutable job transitions are preserved. Isolated baseline0001–0032 reproduced queued-slot identity replacement, same-ID version hash/size replacement and original-to-delivery replacement with valid FKs;0033 rejected all with unchanged snapshots.

Final frozen-helper Worker suite passed135 checks (session59049, `.local/m2n2-final-cloudflare.log`), including populated upgrade preservation and immutable table/audit/FK comparisons.108 unit,61 integration,14 reference Chromium, strict types, lint, Next build, format and specification checks passed. Intermediate lint unused-variable warning was fixed; the old cross-tenant asset fixture now uses an unused delivery kind so it tests scope rather than colliding with the new duplicate guard.

0033 applied locally only:4 commands, then no pending migrations. No remote/customer data, deploy, commit/push or flag activation. Recovery: preserve guards/history, disable writes before code rollback and repair forward. Broader command/snapshot integrity, independent tags/comments/annotations/history, version workflows/comparison, delivery/retention and hosted gates remain incomplete. Next product slice: independent Guest tags; specification assessment underway. Full M1–M5 remains active.

## M2n1 — immutable result integrity accepted locally

Migration0032 rejects primary/alternate event-key replacement in seven immutable result tables and rejects null result keys/null or empty audit IDs;0031 duplicate-audit protection remains. Tests isolate a fresh non-null key with an existing event ID, duplicate primary key, null key, duplicate audit REPLACE, unchanged history, foreign keys and populated upgrades. Existing authorization and exact retry tests remain green.

Final strengthened Cloudflare suite passed134 local checks (session54580, `.local/m2n1-final2-cloudflare.log`).108 unit,61 integration,14 reference Chromium, typecheck, lint, Next build, format and34-file specification presence checks passed. Intermediate rerun failed on deferred Response.clone; immediate per-response parsing preserves24 concurrent attempts and20 allowed and passed the final suite.

0032 applied locally only:10 commands; no pending local migrations. No remote/customer data, deployment, commit/push or flag changes. Recovery: preserve guards/history, disable affected mutations before code rollback and repair forward. Remaining command-ledger, version/asset and snapshot/seal defenses still need audit. Full M1–M5 and hosted acceptance remain active.

## Migration0031 — durable inherited selection policies

New project/album configuration state and unified immutable command/result ledger preserve all0028 data. Legacy policy rows seed explicit overrides; inherit resets retain epochs. effective_selection_policy resolves album override/project/system defaults, and atomic guards enforce current rights, cap and CAS. Old result replay stays immutable. Duplicate insertion/replacement is denied for new/old policy results and audit events.0031 applied locally only (41 commands); recovery is forward-only with selection disabled before code rollback. See SELECTION_POLICY.md.

## Migration0030 — explicit shared reviews (local integration)

shared_reviews plus immutable shared_review_invites/shared_review_seals define separately opted-in subjects. shared_review_rounds and predecessor-linked shared_review_state retain logical-photo/version witnesses and fixed round bounds. Owner/Guest command/result ledgers enforce symmetric old namespace conflicts, current ACL before replay, and immutable results. shared_review_submissions/items/seals pin historical content, filenames and versions without altering originals. Guest expected_guest_id must equal cookie-derived guest_id; required payload CHECK expressions reject NULL/missing fields. Existing private tables remain unchanged. Recovery is forward-only; leave the shared flag OFF and preserve schema/history. See SHARED_SELECTION.md. All30 migrations and populated upgrade preservation passed in the complete127-check local suite.0030 applied locally (75 commands); no pending local migrations. No remote migration.

# Database Schema Contract — PostgreSQL / Supabase

## M2m1 migrations0028–0029

0028 adds album_selection_policies and immutable selection_policy_commands/results. Policy state carries tenant/project/album, minimum, nullable maximum, revision, last_command_id and UTC witness. Predecessor and revision guards prevent historical-policy rollback. Canonical strict command payload binds album and expected revision. All state/result/audit changes are one command statement, including no-op proof semantics and symmetric Owner namespace conflicts.

0029 repairs legacy open round>1 revision0 with a deterministic system initialization audit and revision1, and requires newly audited reopens to use1. Existing selected rows, sealed snapshots, submission results, feedback and historical reopen metadata remain intact. This preserves the positive-revision submission constraint while allowing unchanged retained picks to submit. Recovery is forward-only; disable selection on older-code rollback, retain0028/0029 history/guards and repair forward or use a verified consistent restore. No remote migration or customer data is involved in local acceptance.

## Migration0027 — independent Guest feedback

Adds guest_feedback_commands, guest_feedback_results, guest_rating_state and guest_favorite_state. State key is invite_id/guest_id/photo_id; tenant/project/album are scope-stable and composite-FK checked. last_version_id/updated_at_ms/last_command_id identify the last meaningful change. Clear/unfavorite retain rows. Results retain previous_command_id, before/after/result JSON and optional event witness. State UPDATE requires the exact current predecessor; old valid witnesses cannot restore historical values. Commands/results and state deletion are immutable. Cross-ledger namespace guards abort conflicting selection/submission/logout/exchange statements including all their side effects. Populated upgrade acceptance compares all preexisting table rows before/after0027. Recovery is forward-only: disable feedback, preserve schema/history/guards and repair forward or restore a separately verified consistent snapshot; never destructively down-migrate.

## D1 M2j Guest selection submission extension (current target)

Migrations 0024 and 0025 extend the existing D1 selection state with per-invite/Guest/album round and revision state, immutable submission header/item/result rows, and current submit authorization. The database copies selected photo/version IDs and timestamps from server state, marks the round submitted, and appends selection.submitted audit in the same transaction. Submission items retain the exact selected immutable version. Selection commands after submission are rejected. GET returns only the Guest's own selection fields; can_select and can_submit are separate permission bits. Migration 0025 reorders the empty-draft check after authorization and request replay/conflict guards. Both migrations are additive and forward-only; preserve previous selection and audit rows. Populated upgrade was tested through 0025 and the migration was applied only to local D1. Owner reopen/export APIs and customer UI are not implemented; see GUEST_SELECTION.md.

M2g D1 migration0022 adds immutable `guest_kdf_permits`/`guest_kdf_permit_releases` and a bounded Guest active-slot row. The Owner KDF guard is forward-updated to share one global active slot across both ledgers; there is no TTL. `guest_exchange_commands` stores invite/token hashes, request ID, keyed commitment, candidate IDs, session hash, verified marker and released KDF permit ID. One D1 batch inserts identity then command; command trigger rechecks current invite/Owner/scope/expiry/revocation/max-use and creates the session; future session audit uses the exchange request ID. Existing Guest data/audit and unrelated D1/PostgreSQL tables remain unchanged. No raw token/password/session bearer or IP is added. Migration is forward-only; see GUEST_EXCHANGE.md.

M2f D1 migration0021 adds one reusable row per (`dimension`,`bucket_hash`) with database fixed-window start, unsaturated attempts, policy limit and last update. Bucket hashes are purpose-separated HMAC pseudonyms; a trigger-maintained singleton capacity ledger limits rows to100000; rows expire by24h-window age and Cron deletes at most1000 oldest rows per run. This transient table contains no raw address/token/invite ID and is not append-only action history. No existing data or Guest revocation state is rewritten; see GUEST_ADMISSION.md.

M2e D1 migration0020 adds immutable kdf_permits(id,actor_id,session_id,request_id,acquired_at_ms), immutable kdf_permit_releases(permit_id,released_at_ms), and one-row kdf_active_slot(slot=1,permit_id). Current Owner guard and slot/audit insert are atomic; release clears exactly its own slot and audits atomically. DB timestamps, no TTL; resource audit is independent from later invite commit. No existing rows/schema/guards are rewritten. See KDF_ADMISSION.md for quiesced recovery/rollback.

M2d0019 adds invite_creation_commands with actor/request key, candidate invite/project, sanitized config, request commitment, private token hash/verifier and DB UTC creation time. Positive insert triggers parent/all album scope/seal/audit atomically. Rebuilds five canonical guards to include the sixth Owner ledger, replaces future create/seal audit request IDs only, preserves old events. No plaintext, table rewrite/backfill or R2/quota change. Historical result derives from immutable invite rows; recovery excludes private command columns. See INVITE_ISSUANCE.md.

M2c D1 migration0018 adds immutable guest_logout_commands(guest_id,request_id,unique session_id,secret_hash witness), SQL cookie proof before replay and atomic guest.session_revoked request audit. Replaces only future session-revoke audit writer; preserves historical events/hashes/legacy verifier rows. New password-mode invites require canonical fixed v1 scrypt shape and explicit NUL rejection. Existing verifiers are not converted or treated as plaintext. No photo/R2/quota data changes. See GUEST_CREDENTIALS.md for recovery/trust boundaries.

M2b D1 migration0017 adds immutable invite_revocation_commands, unique per invite and keyed actor/request; rebuilds four canonical guards with all-ledger conflicts before replay, and replaces only the future revoke audit writer. No table/data rebuild or legacy request-ID rewrite. Existing revocation timestamp is the immutable response snapshot; new distinct commands after revocation409. Preserve all0016 data and current guards on rollback. See OWNER_INVITATIONS.md.

## D1 M2a additive foundation

Migration0016 adds guest_invites, guest_invite_albums, guest_invite_seals, guest_identities, guest_sessions and two immutable revocation tables, plus composite album scope index. Hashes only; stable12-bit rights; sealing audits exact album IDs and forbids widening before/after redemption. Sessions have24-hour/invite clamps and atomic lifetime issuance count. Session revocation carries a matching hash witness. Existing tables/records/counters are preserved; these D1 tables do not alter PostgreSQL. Public issuance, validated password verifier format and shared Owner command replay remain pending. Read GUEST_ACCESS_FOUNDATION.md before exposing writes or performing recovery.

## CF-03c3 D1 processing extension (current target)

Migration0013 adds `image_processing_jobs` keyed to the immutable original asset, pinned recipe/status, reserved bytes, token/epoch/deadline, attempts, reason, result JSON and UTC transition fields. `image_processing_outputs` stores immutable `(job,kind)` slots, asset UUID, unique scoped object key and8MiB cap. New private originals enqueue transactionally; no legacy backfill or immutable-row edits. Claim atomically reserves16MiB at workspace/node, lease takeover retains it, complete atomically inserts both private assets and converts to actual bytes with append-only audit. Review/unknown states never release quota. Job scope derives from existing composite-guarded photo/version/original rows. Pending/retry/review jobs block archive; future cleanup must use the same busy condition. Forward-only recovery, state table and original schema boundary are in PROCESSING_PIPELINE.md. Applied to local D1 only; representative remote backup/restore remains unverified.

此文件是資料模型合約；實際 migrations 應由 Codex 分段產生，並經資料權限測試，不應在未連上資料庫時宣稱已套用。

## 全域慣例

- Primary keys：UUID。所有租戶資源含 `workspace_id` 並依此建 composite indexes；FK cascade 必小心，因為相簿刪除需要保留 tombstone/audit。
- 時間：`timestamptz` UTC、`created_at` / `updated_at`；更動事件的時間由 server / DB 指定。
- PostgreSQL enums 或 CHECK constraints 必涵蓋明確狀態；外部輸入 Zod + DB Constraints 雙重檢查。
- 重複 API 以 `idempotency_key` / `(actor_id, request_id)` unique 制止重複 event。
- 所有表需要 RLS 或可靠的 server tenant scoping；不允許前端使用高權限 service role 直接讀寫。

## 身分與組織

| Table                    | 重要欄位                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `profiles`               | id(auth.users FK), display_name, avatar_url, locale                                                             |
| `workspaces`             | id, owner_user_id, name, quota_bytes, retention_policy_id, created_at                                           |
| `workspace_members`      | workspace_id, user_id, role, permissions_json, status                                                           |
| `clients`                | id, workspace_id, name, contact_email(nullable), created_at                                                     |
| `client_portal_grants`   | id, workspace_id, client_id, subject_identity/email_hash, grant_token_hash, auth_method, expires_at, revoked_at |
| `client_portal_projects` | portal_grant_id, project_id                                                                                     |

## 專案／分享／相簿

| Table                | 重要欄位                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`           | id, workspace_id, client_id?, name, status, versioning_mode, selection_limit?, cover_photo_id?, settings_json                                             |
| `albums`             | id, workspace_id, project_id, name, display_order, created_at, published_at, last_valid_viewed_at, state, is_pinned, legal_hold                           |
| `review_rounds`      | id, workspace_id, project_id, album_id?, number, status, selection_limit, shared_selection, submitted_at, submitted_by                                    |
| `review_submissions` | id, workspace_id, round_id, actor_id, snapshot_json, submitted_at, reopened_at?                                                                           |
| `share_links`        | id, workspace_id, project_id, scope_json, token_hash UNIQUE, password_hash?, access_mode, expires_at, revoked_at, permissions_json, max_uses?, used_count |
| `guest_identities`   | id, display_name, created_at, verified_email_hash?                                                                                                        |
| `guest_sessions`     | id, workspace_id, invite_id, guest_id, hashed_session_secret, expires_at, revoked_at, last_seen_at                                                        |

## 照片與版本

| Table             | 重要欄位                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `photos`          | id, workspace_id, project_id, album_id, canonical_name, original_filename, current_version_id(nullable), sort_index, state                                        |
| `photo_versions`  | id, workspace_id, photo_id, version_no, parent_version_id?, created_by_actor, upload_note, source_hash_sha256, width, height, status, created_at                  |
| `photo_assets`    | id, workspace_id, photo_id, version_id?, asset_kind, r2_bucket, object_key UNIQUE, byte_size, mime, checksum_sha256, state, storage_class, created_at, deleted_at |
| `upload_sessions` | id, workspace_id, album_id, photo_id?, version_target_id?, intent, object_key, status, expected_bytes, reservation_bytes, expires_at, completed_at                |
| `image_diff_jobs` | id, workspace_id, photo_id, before_version_id, after_version_id, alignment_strategy, status, heatmap_asset_id?, diff_metadata_json                                |

## 客戶狀態與歷程

| Table             | 重要欄位                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `selection_items` | id, workspace_id, round_id, photo_id, actor_kind, actor_id, selected_at, UNIQUE(round_id, photo_id, actor_kind, actor_id)                                                                            |
| `photo_ratings`   | workspace_id, photo_id, actor_kind, actor_id, stars CHECK 1..5                                                                                                                                       |
| `favorites`       | workspace_id, photo_id, actor_kind, actor_id, favorited_at                                                                                                                                           |
| `tags`            | id, workspace_id, project_id, label, color?                                                                                                                                                          |
| `photo_tags`      | photo_id, tag_id, actor_kind, actor_id                                                                                                                                                               |
| `comments`        | id, workspace_id, photo_id, version_id?, parent_comment_id?, actor_kind, actor_id, text, status, created_at, edited_at?, deleted_at?                                                                 |
| `annotations`     | id, workspace_id, photo_id, version_id, comment_id?, author_actor, geometry_json, style_json, status, created_at, deleted_at?                                                                        |
| `activity_events` | id, workspace_id, project_id, album_id?, photo_id?, version_id?, round_id?, actor_kind, actor_id, guest_session_id?, invite_id?, action, before_json, after_json, occurred_at, request_id, meta_json |
| `audit_logs`      | id, workspace_id?, actor, operation, resource, before_json, after_json, timestamp, request_id, result                                                                                                |

## 儲存保留與作業

| Table                  | 重要欄位                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage_policies`     | id, workspace_id?, enabled, dry_run, soft_quota_bytes, warn_ratio, cleanup_ratio, target_ratio, block_ratio, inactivity_days, pressure_mode, protect_config_json, updated_at |
| `storage_ledgers`      | id, workspace_id, bucket, confirmed_bytes, reservation_bytes, last_reconciled_at, observed_cloud_bytes?, metric_freshness_state                                              |
| `storage_reservations` | id, workspace_id, upload_session_id, reserved_bytes, expires_at, status                                                                                                      |
| `retention_plans`      | id, workspace_id, reason, policy_snapshot_json, status, candidate_bytes, created_at, approved_at?                                                                            |
| `retention_plan_items` | id, plan_id, album_id, estimated_bytes, eligibility_snapshot_json, exclusion_reason?                                                                                         |
| `deletion_jobs`        | id, workspace_id, plan_id, album_id, state, reason, byte_estimate, bytes_reclaimed, attempt_count, lock_owner?, started_at, finished_at                                      |
| `deletion_items`       | id, job_id, photo_asset_id, r2_bucket, object_key, bytes, state, attempts, last_error?                                                                                       |
| `jobs`                 | id, workspace_id?, job_type, payload_json, status, attempts, next_run_at, dedupe_key UNIQUE                                                                                  |
| `notifications`        | id, recipient, kind, payload_json, state, sent_at?                                                                                                                           |
| `deliveries`           | id, workspace_id, project_id, status, expires_at, created_by, approved_review_round_id?                                                                                      |
| `delivery_assets`      | id, delivery_id, photo_id, photo_version_id, file_asset_id                                                                                                                   |

## 強制唯一鍵 / 索引（最低）

- `photo_versions UNIQUE(photo_id, version_no)`。
- `photo_assets UNIQUE(r2_bucket, object_key)`；state+workspace_id 索引。
- `photos (workspace_id, project_id, album_id, canonical_name)` 非唯一（同名可能需要人工比對）。
- `selection_items UNIQUE(round_id, photo_id, actor_kind, actor_id)`；另建 (workspace_id, round_id) index。
- `activity_events (workspace_id, project_id, occurred_at DESC, id DESC)` + `(photo_id, occurred_at DESC)` + `(actor_kind, actor_id, occurred_at DESC)`。
- `albums (workspace_id, created_at ASC)`、`(workspace_id, last_valid_viewed_at)` for cleanup。
- `deletion_items UNIQUE(job_id, r2_bucket, object_key)`；禁止同 key 再刪雙重扣帳。
- `share_links (token_hash)` unique and expiration indexes。

## Database security

- 所有管理修改先 check workspace role；guest 讀取不能直接以 Supabase anon role 查所有表，必須走 server scoped session + 經檢查的 API / RPC。
- `activity_events` 一般服務帳號只可 INSERT / SELECT scoped rows；UPDATE/DELETE 僅可由特定資料保留管理程序執行並記額外 audit。
- DB migration 規定：expand/migrate/contract，提供 rollback 或 restore strategy；不允許大量 cascade 直接刪 activity_events。

## 重要交易範例（偽碼）

```
BEGIN;
  lock review_round FOR UPDATE;
  assert session can_select AND round.status='selecting';
  assert selection_count < limit (unless deselect);
  INSERT/DELETE selection_item;
  INSERT activity_event {action, before, after, request_id};
COMMIT;
```

刪除相簿應採多步狀態機與 job，不能使用 `DELETE FROM albums` 讓 FK cascade 偷偷丟失歷史。

## 已實作子集合：M1-01 / migration 202610230002

新增 `audit_logs`：workspace_id nullable、actor_id、operation、resource_id、before_json、after_json、occurred_at (DB UTC)、request_id；一般角色只有 owner/自身無 workspace 的 profile event 可讀，不可直接寫入或修改/刪除。此表是管理變更審計，尚不是完整照片/guest 操作的 `activity_events`。後者仍在 M2，必須包含 session/invite/photo/version 前後值。

`kino_private.workspace_requests` 是不公開的交易重送 ledger，actor_id/request_id unique，記 operation、payload、result。表開 RLS 且不授權一般角色/schema access；只由可信 security-definer RPC 讀寫。已實作三項 RPC：ensure_photographer_profile、create_workspace、set_workspace_member；具角色/身份檢查、鎖與同交易 audit。資料表其餘欄位/完整模型仍待相應 phase migration，不能把本規範表格視為已建置。

## 已實作子集合：migration 202610230003 / 202610230004

0003 為 audit_logs 增加 statement-level TRUNCATE 拒絕，並調整首次建帳 user row lock，既有 migration checksum 不變。

0004 為 projects/albums 增加正整數 revision（預設 1）和相簿 project cursor index；DB trigger 禁止修改 id/workspace_id，album.project_id 同樣不可改。原有 composite FK/RLS 和一般角色直接寫入禁令保留。

新增 create_project/rename_project/create_album/rename_album 四個受控 RPC。只管理名稱；每個 mutation 在鎖住 workspace 並確認當前角色後才讀重送 ledger。名稱/revision、project.created/project.renamed/album.created/album.renamed 管理審計與私有 ledger 同交易。改名完整記錄 before/after，重送回歷史結果而不還原目前狀態。不能把此管理審計當成尚未實作的完整照片/guest activity_events。

這些 migration 沒有資料刪除、自動清理、資產或照片版本表；workspaces 自動刪除 OFF/dry-run constraints 保留。回復步驟見 packages/db/README.md。

0005 以 forward replacement 統一 create_workspace 名稱 normalization 與 code-point 長度（120），防止 direct RPC 寫入 API response schema 無法讀取的名稱。保留既有資料與 audit/request history，沒有自動清洗歷史紀錄。

## Migration 202610230006

OAuth user guard 接受 Google/GitHub，平台仍以既有 auth.users.id 為唯一內部 identity。Supabase auth.identities 管理 provider subject 的唯一性，應用不另建 Email merge 表。kino_private.oauth_link_intents 存 token_hash PK、actor_id、provider、request_id、created_at/expires_at/completed_at，RLS 且不向 app roles 開表存取權，只經受控 RPC。開始/完成紀錄 identity.link_started / identity.linked 管理 audit，沒有 raw token 或 OAuth code。實際 provider mutation 不在 app audit transaction，細節見 AUTH_SPEC。

## Album protection implementation increment

Migration0007 adds an owner-controlled RPC over existing albums.is_pinned/legal_hold. No columns/data rewrite. It shares album revision with rename; records album.protection_changed before/after snapshots in append-only management audit, UTC occurred_at, actor/resource/request IDs and private idempotency ledger in one transaction. It does not reset last_valid_viewed_at/published_at/state. Only current owner can mutate; current authorization precedes replay. Future deletion eligibility must lock/recheck the same workspace and album, and reject pinned/legal hold rather than bypass flags under quota pressure. Full photo/guest activity_events and request-session attribution remain future work.

## Empty archive origins (migration0008)

Nullable projects.archived_from_status (draft/delivered) and albums.archived_from_state (draft) record the prior state and clear on restore. Non-null origins require current archived state; pre-existing archived rows retain null and cannot be guessed/restored. New owner-controlled set_content_archived reuses revision, global private request ledger, workspace locks and append management events project/album.archived/restored with before/after state, actor, resource, UTC occurred_at and request ID. No child cascade, protection/activity reset or data deletion. Existing content RPCs enforce archived-parent/resource edit restrictions after authorized replay. Origins are internal DB fields, not client-supplied. Future photo/reservation/review operations must lock/recheck archive status.

## Cloudflare foundation schema (new target, not customer import)

apps/worker/migrations/0001/0002 add nine D1 tables: users, oauth_accounts (unique providerId/accountId subject), owner_sessions, auth_verifications, owners, owner_bootstrap, audit_events, storage_settings, storage_nodes. Better Auth/Drizzle owns typed user/account/session mapping; fixed internal users.id remains the identity key. Bootstrap single INSERT + trigger writes user/accounts/owner/audit atomically and closes bootstrap. Session insert/delete audit triggers use the same SQLite statement transaction; append-only audit update/delete denied. Current authorization lives in trusted Worker; no PostgreSQL RLS claim on D1.

No existing workspace/project/photo/customer rows were imported or rewritten. Product D1 schemas/tenant constraints, guest sessions, photo_assets.storage_node_id, version/event/query models and all legacy RPC invariants remain future migrations. PG eight migrations stay unchanged. Metadata defaults are one binding-backed node, new internal9GB quota, cross-account off/autodelete off/dry-run on; no billing guarantee. See DEPLOYMENT recovery/gates before any target data cutover.

## CF-02a additive D1 workspace migration

apps/worker/migrations/0003_workspaces.sql adds workspaces and durable workspace_commands(actor_id,request_id composite primary key). A BEFORE trigger checks the current enabled Owner and matching unexpired session before replay/conflict/cap checks; AFTER trigger creates workspace, original result snapshot and append-only workspace.created audit in one statement transaction. SQL audit failure rolls back all three. Result records cannot be changed/deleted after completion. Audit records retain actor/session/workspace/request IDs and UTC time. Same actor/request/name replays without another event, changed normalized name conflicts. Future business operations must extend this to one shared operation namespace before mounting additional mutation APIs; workspace-only ledger is not evidence of cross-operation replay protection yet.

The index (owner_user_id,created_at DESC,id DESC) backs LIMIT25 keyset reads, returning24 rows. No existing PostgreSQL schema/checksum or customer data is changed/imported. 9GB per-workspace default is an internal ceiling, not a guarantee that each workspace can reserve the whole single storage node concurrently.

## D1 migration0004: projects/albums and shared commands

Adds tenant-bound `projects` with status/versioning/revision/archive origin; `albums` with composite `(project_id,workspace_id)` parent FK, state/protection/revision/archive origin; and `photos` metadata references constrained to same workspace/project/album. `photos` is a catalog/empty-content guard only: it has no upload, assets, version or image processing API. Page indexes use workspace/project and `(created_at DESC,id DESC)`. Parent IDs are immutable by API/schema relationship.

Adds `request_commands(actor_id,request_id)` shared across workspace/project/album operations. Migration copies every existing 0003 workspace command with its actor, operation, payload, session, resource/workspace ID, original result snapshot and creation timestamp; original `workspace_commands` and audit history remain intact. One SQL trigger validates live current Owner/session first, then detects operation/payload conflict and handles replay before mutation-specific CAS/state guards. AFTER triggers write resource, result snapshot and append-only UTC audit atomically. Project/album errors or audit failure roll back command and content. Completion snapshot is immutable; intermediate before/result snapshots are only filled by the atomic insert trigger. Workspace create is now recorded in shared ledger while its original audit trigger remains authoritative.

D1 archive rejects photo-bearing content and follows stored origin. It does not delete or free storage. The nine-GB target workspace ceiling does not promise simultaneous capacity reservation. UI, uploads/assets, immutable photo versions, delivery, guest records, role/team membership and retention jobs remain separate pending schema/service work.

## D1 migration0005 parent hardening

Adds a unique album `(id,project_id,workspace_id)` parent index, immutable project/album tenant/parent update triggers, and a `photos` insert guard requiring the album and project to match the same workspace. Photo rows cannot be reparented after insertion. This supports empty-content archive checks and blocks cross-project catalog associations before upload APIs exist. `photos` still stores only original filename and IDs/timestamp; immutable assets, processing states, quota reservation and versions remain pending.

## D1 migration0006: actor-safe audit keys

Rebuilds the audit table with `event_id` as its unique key and copies every historical column/event ID/UTC timestamp verbatim. Removes the old global unique `(action,request_id)` rule: command idempotency is owned by the actor-scoped request ledger, while event IDs deduplicate each emitted event. This permits different tenants/users/guest sessions to legitimately use the same request UUID/action without blocking one another. Append-only update/delete triggers are restored on the rebuilt table. Apply before importing high-volume target audit traffic; rebuilding a large log needs a private snapshot and staged rehearsal first.

### Migration0007: trigger rebind after audit rebuild

The first0006 rehearsal exposed that SQLite can retain/rewrite trigger references while an audit table is renamed. Migration0007 explicitly recreates every bootstrap/session/workspace/content audit writer against the current `audit_events` table. It also creates a temporary empty compatibility table while repairing a development database that had already taken the rename path, then drops it after all writers point to the canonical table. Historical events stay in `audit_events`; the compatibility table is never an archive.

## D1 migration0008: upload reservation ledger (CF-03a)

Additive D1 migration for the reservation-only stage; it creates no photo asset and issues no R2 URL. `workspace_storage_usage` tracks used/reserved bytes per workspace (existing workspaces are backfilled with zero used bytes because the D1 photo catalog has no materialized assets yet). `upload_sessions` stores immutable workspace/project/album/node scope, a server-generated opaque ID/key, expected and reserved bytes, actor/session/request provenance, fixed 15-minute expiry, and a reserved/cancelled/expired lifecycle. The API never returns the private object key. `storage_reservations` is an immutable reservation history; live reserved counters are maintained separately on the workspace usage row and storage node.

`upload_requests` is a separate operation/result ledger because the existing `request_commands.operation` check is enumerated. Migration0008 rebuilds the existing request guard to enforce one `(actor_id,request_id)` namespace across both ledgers, preserving current Owner/session checks before replay, tenant validation, and immutable original results. The SQL insert trigger atomically validates same-owner workspace→project→album scope, writable parent states, active primary node, workspace quota and aggregate node quota; it then creates the session/reservation, increments both counters, snapshots the result, and appends UTC audit. Cancel and expiry atomically move state, release both reserved counters, and append audit. Archive requests reject while the relevant project/album has a reserved session. Guard/audit failure leaves no partial reservation.

Historical CF-03a state (superseded by CF-03b below): the Worker exposed Owner-only init/read/cancel and a five-minute Cron, with no signed URL, object verification, used-byte completion or asset/version records. At that stage expiry could release capacity after session expiry. The rule changed before the signer was introduced: capability-backed reservations now require a durable same-key fence before release. Migration0008 remains part of the forward schema and must be preserved on code rollback; repair forward and do not drop this ledger after data exists.

## D1 migrations0009-0011: historical CF-03b baseline (superseded by0012 below)

Migration0009 adds immutable `upload_specs`, capability issuance/workflow request results, durable key-fence and review records, `photo_versions`, `photo_assets`, and `upload_completions`, plus SQL guards/triggers for verification, append-only audit and quota conversion. A successful completion creates exactly one logical photo, first private version and original asset with a server-generated object key. Migration0010 is a forward trigger correction for an early local 0009 draft; fresh installations keep the immutable request payload as the upload-spec source. It does not drop the early draft's extra nullable columns.

The local Wrangler D1 received early-draft0009, repair0010 and scope-guard migration0011. A deterministic synthetic compatibility fixture adds nullable legacy upload-session columns, models a legacy trigger that reads them, and verifies0010 switches future specs back to payload_json without changing existing quota/audit snapshots. The early-0009 SQL itself is not tracked, so this fixture is explicitly reconstructed and is not byte-for-byte historical migration or production recovery proof. The migrations are forward-only. Preserve upload/audit history and use a new corrective migration or a verified snapshot restore; never down-migrate. A representative backup/restore rehearsal remains pending before remote application. No imported customer data or remote D1 was used.

The completion validator checks exact byte count, stored MIME, provider SHA-256 and the initial JPEG/PNG/WebP signature bytes. This is not a decoder, dimension/pixel limit, decompression-bomb control, malware scan or thumbnail pipeline. Migration0011 adds composite tenant/photo/version relationships and guards photo, asset, completion and audit inserts against cross-scope references; it was applied to local Wrangler D1 and also exercised in an isolated Miniflare upgrade fixture. These local guards do not replace a representative backup/restore rehearsal before remote migration. Signed cancellation/expiry requires a durable conditional same-key fence; a suspicious/unreadable object remains reserved for review.

## D1 migration0012: encoded image dimensions

Adds nullable image_width/image_height to upload_workflow_requests and upload_completions. Historical rows and immutable version NULL dimensions remain unchanged. New completed workflows/versions require integer positive dimensions <=32768 per side and <=80M pixels. Completion dimensions must match the inserted version; workflow dimension updates are immutable. Completion writes width/height into version/result/audit atomically. Values come from bounded server headers, not client input or full pixel decode.

Isolated upgrade preserves legacy versions/assets/quota/audit.0012 applied only to local Wrangler D1. Forward-only recovery: retain schema/history and upload flags OFF before any old-bundle rollback; pre0012 writers fail closed on new completions. Use a compatible forward fix or verified separate snapshot restore. Never guess/backfill dimensions or drop guards. Remote representative backup/restore through0012 remains pending.

Migration0014 rebinds upload/processing archive busy guards to current Owner/session scope and defers existing actor/request IDs to shared replay/conflict handling. This trigger-only forward repair leaves immutable data, quota and audit untouched. Historical archive snapshots remain replayable after restore/new work; new busy archive commands still fail.

## Migration0015 current terminal resolution

Copies image_processing_jobs and image_processing_outputs together to preserve populated FKs and exact rows, adds terminal abandoned with reserved0, reinstalls index/triggers. Immutable processing_review_commands has actor/request primary key, unique job, session, expected epoch, canonical payload, trusted server fence attestations and UTC ms. Insert guard repeats authorization/scope/state/epoch/active primary node; apply changes job and existing apply trigger releases both reservations with user/session/request audit. Symmetric namespace guards protect all four ledgers. No original/used-byte change or legacy backfill. Local53 commands; restore guidance in PROCESSING_REVIEW.

## Migration 0060 photo pinning

Adds Owner-only `photo_pin_commands`, immutable `photo_pin_results`, and the mutable `photo_pin_states` projection. The command trigger rechecks the enabled Owner session, workspace/project/album/photo/current-head scope, editable state, timestamp, expected revision, and request-ID uniqueness across existing command and audit namespaces. A real change advances the projection revision and appends the matching `photo.pinned` or `photo.unpinned` audit event atomically. Unpinning stores `is_pinned=0` with a newer revision; it does not delete state or history. No legacy photo backfill or Guest permission is added.

Recovery: migration 0060 is additive and must follow a fresh protected schema-0059 backup, restore into a separate D1 database, upgrade there, and verify old-table/schema/sequence parity and foreign keys before adoption. Before any pin writes, a code rollback to a schema-0059-compatible gallery can omit the optional projection. After writes, retain commands/results/audit and repair forward; do not drop tables/triggers or restore an older snapshot over newer activity. This migration is source-only until hosted adoption is separately evidenced.

## 0069 候選：逐相簿繼承期限（未套雲端）

`guest_invites.expiry_mode`區分舊`custom`與新`inherit_album`，只有後者的原始`expires_at_ms`可為NULL；舊欄位與值保留。`guest_invite_albums.inherit_generation`在封存前綁定相簿世代，封存後不可改。

`album_inherited_share_transitions` append-only保存原因、前一歷史、世代、phase、截止、權威輸入指紋與DB UTC毫秒。`album_inherited_share_states`只允許由該歷史推進的投影，世代1–2147483647，耗盡不得環繞。`effective_album_inherited_share_expiry`、`next_album_inherited_share_state`、`effective_guest_invite_album_expiry`共用目前規則，維持workspace/project/album及不可回復舊連結的界線。

0069亦保護`albums.created_at`與既有id免遭UPDATE／REPLACE改寫，禁止未來human時間，保留原始操作審計；正向活動不是刪除所需的連續追蹤覆蓋。完整語義、migration與forward recovery見[繼承期限](INHERITED_SHARE_EXPIRY.md)。這些候選結構不能當成已部署schema。
