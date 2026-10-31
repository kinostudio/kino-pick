## 2026-10-29 — Retention pure-planner foundation accepted

Implemented `packages/domain/src/retention.ts` and exported it through existing domain index. Deterministic dry-run only:defaultOFF;30-day inactivity/7-day minimum;80→65% estimates including reservations;oldest/least-viewed+UUID order;preservation/protection/busy/reference/recent-state guards;metrics/inventory fail-closed;whole-album caps and dual-reason dedupe. `preservationRequested=true` excludes;`cleanupAllowed` is the independent cleanup opt-in. Both mode traverses the global order once and continues required inactive candidates after the pressure target is estimated reached. Inputs are validated and not mutated;no DB/R2/delete adapter or clock/random dependency.

Focused13 tests pass (`.local/retention-planner-focused-final.log`),final root strict passes (`.local/retention-planner-types-third.log`),scoped lint passes (`.local/retention-planner-lint-final.log`;React detect warning only). Acceptance `.local/retention-planner-acceptance.json`. Earlier strict failures were fixed without relaxing TS:date tuple/exclusion reason safety and a test helper's overly narrow UUID literal type. No broad suite/build/browser run was needed or claimed for the pure module.

Critical boundary:current D1 has no effective-human-view heartbeat/projection,and several policy/busy/reference witnesses remain incomplete. This is NOT a usable D1 cleanup candidate API or deletion service. Next implement authorized visible-photo heartbeat evidence and rolling5-minute session dedupe,then read-only snapshot adapter,persisted plan/Owner UI/explicit opt-in+confirmation,locks/rechecks,delete/retry/reconciliation. Permanent fences/history must remain intact.0052 remains locally adopted;all feature/default hosted gates and automatic deletion remainOFF/dry-run. Version-approval aggregation question remains pending;fullM1–M5 remains ACTIVE/incomplete. See docs/RETENTION_PLANNER.md. Preserve unrelated dirty edits;no commit,push or deploy.

## 2026-10-29 — 0052 adopted LOCAL ONLY; version confirmation policy pending

The accepted Guest current-version download migration is now adopted in persistent LOCAL D1. Run `apps/worker/.local/guest-downloads-adopt-0052-third.log` exited0:8 actual CLI commands all0. Fresh backup was restored and upgraded in an isolated config directory,then a fresh live snapshot was compared before apply. All123 product-table row hashes match the accepted0051 development snapshot;all4 development rows,existing schema and product sequences are unchanged. Exactly one audit trigger was added;ledger is52,no pending migrations,and foreign-key checks on exported snapshots are empty. Live-after schema equals isolated-upgraded schema. Download/default hosted flags remainOFF;automatic deletionOFF/dry-run. No remote/customer data,commit,push or deploy.

Proof `apps/worker/.local/guest-downloads-adopt-09a31a74-8bb1-4913-ac86-9eea3b29515a-proof.json` SHA256 `39405b94e76c07bb607fae599cb9b2e68b0c1dcc081238f2c6c69b603c917300`. Fresh backup `apps/worker/.local/guest-downloads-adopt-09a31a74-8bb1-4913-ac86-9eea3b29515a-before.sql`,SHA256 `ae713c7515505a10cbc5d26ecee941da3af5668d31cd1e2ce44cdfc7ee282502`.0052 source SHA256 `a247e8efe8b3cf2152cffb500b5d8dacc5eab6385e4ce96086672600645dbb81`. Preserve failed preflight proofs:first CLI export did not support persist-to;second checker compared SQLite null-prototype rows with plain objects. Both stopped before persistent apply;neither is acceptance. The successful run uses an isolated Wrangler config directory and normalized sequence rows;no old backup was restored over live data. Recovery:keep flagOFF,retain audit/assets,prefer forward fix;drop only the new guard if reverting schema deliberately.

Read-only version-approval inventory found no approval permission in the existing12-bit mask. Do not reinterpret can_view/can_compare_versions/can_select as approval authority or enlarge persisted4095 mask casually. A separate Owner-authorized sealed request/invitation relation can pin exact photo/version/head revision and preserve individual Guest receipts. The user has not decided whether one representative or all designated clients must confirm;they requested clarification,which was provided,with a simplified question still pending. Do not silently choose an aggregate publication policy or show an unimplemented approval control. Owner history/head switching exists;Guest comparison canvas exists;Owner equivalent comparison remains required. See docs/VERSION_APPROVALS.md. FullM1–M5 remains ACTIVE/incomplete;next implement independent exact-version confirmation records and resolve the final delivery gate without deleting any existing product requirement.

## 2026-10-29 — Guest current-version downloads accepted locally

KISS: reused existing Guest sessions, private R2 adapter/current heads and append-only audit. Independent preview/original rights work without can_view. Bounded24-row catalogue + native attachments + download-only375px UI/logout are implemented. Source filenames use immutable V1/V2 completion witnesses; asset IDs are not upload session IDs. Fixed a real SQL bug discovered by native execution: request candidate omitted photoId/versionId used by its audit INSERT. Bounded server-side failure logs contain phase/requestId/error message, never credentials/SQL bindings.

Actual isolated runner seventh exited0 (`apps/worker/.local/guest-downloads-focused-seventh.log`):3 API groups + one375px Chromium flow. One PNG used existing Owner upload/init/authorize/local R2 put/complete and real LocalSharp processing. Preview/original bytes and SHA match; requested/generated rows pair exactly; native forged audits abort; injected generated-audit failure returns503 JSON/no file and retains requested only; opposite/view-only/foreign/unshared/revoked access denies without new download audits. Chromium saved the native attachment with exact size/hash and logout removed private filename/cookie. Root inspected `apps/worker/.local/guest-downloads-mobile.png`. Proof `apps/worker/.local/guest-downloads-focused-acceptance.json`;log SHA256 `59a56a0ed0d62bb908daa74ef00bf69f34b8d135ceba7dd92f0ce5483e90e707`. The injected error in the successful log is expected fail-closed evidence. Earlier failed logs remain failures,not acceptance.

Corrected target Worker/UI build passes (`.local/guest-downloads-sql-fix-build.log`);final root strict/scoped lint pass (`.local/guest-downloads-final-types.log`,`.local/guest-downloads-final-lint.log`). Prior scoped9 contract tests and Web types passed;full broad suites were not repeated. Browser helper uses a small real loopback HTTP bridge because route interception canceled native attachment persistence;no synthetic API responses. GUEST_DOWNLOADS_ENABLED remainsOFF/hard-local.0052 is SOURCE ONLY:default persistent local D1 remains0051;no production/customer writes,commit,push or deploy. Automatic deletionOFF/dry-run.

This supports current ready-version downloads,not a final published/approved delivery package. FullM1–M5 remains ACTIVE/incomplete. Next inspect version-approval/publication requirements and implement immutable delivery manifests,then notification/ZIP and remaining retention/hosted acceptance without removing earlier requirements. Any later0052 persistent adoption needs a fresh backup/restore/parity proof. See docs/GUEST_DOWNLOADS.md.

## 2026-10-29 — M3i5b first multi-file resolved UI accepted locally

Keep KISS: the new opt-in queue wraps the existing ResolvedAlbumUpload and its journal/lock/network pipeline. Gallery now mounts ResolvedBatchAlbumUpload. RESOLVED_BATCH_UPLOAD_ENABLED defaultsOFF in all environments/example,requires the full matching-rules chain,and rejects hosted activation. Owner-only GET /api/v1/resolved-batch-uploads/capabilities exposes strict1000-file/24-row limits. No new D1 migration or production/customer write occurred.

Implemented: multi-file descriptors/IDB queue,explicit start,one-file-at-a-time fresh preview and upload,24-row progress/reselection,pause and queued-only skip;stable async journal port with fixed request IDs and committed persistence before network;current-session checks and private filename hiding on access loss;captured-intent recovery retained when new batch admission is disabled. Queue creation briefly reuses the existing album Web Lock and rereads its pointer,preventing stale tabs from replacing another queue. Per-file parent Gallery refresh is coalesced. Human rule/error copy replaces internal codes. Server-confirmed review/rejection records remain retained;unknown captured jobs are not discarded.

Actual focused local run12192 exited0 (`apps/worker/.local/m3i5b-browser-run-fifth.log`):three375px browser scenarios/six checks true:OFF keeps legacy widget;stale-tab pointer remains one queue;three files complete signed local R2 uploads;dropped accepted reservation restores with exact original UUID/body after a rules change;new stale-policy admission stops;foreign identity clears filenames and performs no upload writes. Acceptance `apps/worker/.local/m3i5b-focused-acceptance.json`,SHA256 `57c4cd4f22ca30514e2ba71e916355c6c28ad1f72e51cc06dee99cd7d88515cc`. LogSHA256 `0e33b40bc02a29bce16d4a364a3f9e581e14f3e35a129546f95958703299f090`. The old runner success banner incorrectly included Sharp;the log is preserved and runner banner corrected for future runs. This helper did NOT invoke Sharp/derivative processing. Do not repeat that overclaim or add a redundant image-engine test.

Second target UI/Worker dry-run build exited0 (`.local/m3i5b-worker-build-second.log`);root strict and scoped final UI/helper lint exited0 (`.local/m3i5b-root-types.log`,`.local/m3i5b-ui-lint.log`). Scoped web TypeScript/Prettier pass;new gate18 unit tests,codec9 and existing journal/protocol48 targeted tests pass. Full650 unit and17 native IDB tests are earlier foundation checkpoints,not rerun or summed into a fabricated new total. Preserved failures:first real hidden pre-create/stale-pointer notice was fixed by root;other attempts exposed fixture basename,existing two completion-reconciliation probes,and an obsolete raw-code UI assertion. No failed run is reported as a pass. Main full smoke/Next reference suites were not repeated per user minimal-validation instruction.

Boundary: local workerd/D1/R2/Chromium only;no real OAuth/remoteCloudflare/production deployment,Sharp in this run,1000 physical transfers,power-loss or native-headed acceptance. Batch admission remainsOFF in checked-in config. Active captured server cancellation and remaining comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness remain unfinished.0051 stays adoptedLOCALONLY;automatic deletionOFF/dry-run. FullM1–M5 ACTIVE/incomplete. Next prioritize the roadmap's remaining real delivery features using existing services;inspect current docs/code before starting and avoid new frameworks/unnecessary test expansion. Preserve unrelated dirty work;no commit,push or deploy.

## 2026-10-29 — M3i5b integration seam in progress (KISS)

Reuse the existing resolved uploader instead of creating another upload engine. `ResolvedAlbumUpload` now accepts an optional async `ResolvedUploadJournalPort` (itemId/load/save);default localStorage behavior and existing Web Lock key are preserved. Loads/saves use the original strict max-one journal protocol. Persistence is awaited before reservation and subsequent mutations;refs/UI update only after committed save and current-generation checks. The port supplies the descriptor item ID;the three operation UUIDs remain generated once and fixed. Use a stable/memoized port object.

A batch envelope can now retain terminal `rejected` metadata for an unreserved request after a definitive server rejection,without overwriting its body or pretending the server placed it in needs_review. Controller code must establish that definitive outcome;the codec cannot determine network truth. Timeouts,AbortError and unknown outcomes must never take this path. Reserved or terminal rejected intents cannot be reactivated or rewritten. Targeted codec9 tests pass;existing journal/protocol48 tests pass after the async seam. Scoped lint plus root/Web strict checks pass. Full650 unit/17 native storage results below are prior foundation checkpoints,not a new batch UI acceptance claim;no broad suite was repeated for these isolated changes.

Actual multi-file chooser/queue/controller,session reauthorization and UI/native transfer acceptance remain unfinished. Next add the small queue wrapper and existing port binding;keep explicit current policy checks for unstarted items and exact old-intent replay for captured work. Do not introduce a new lease/timer system or another lock namespace. Default/hosted gates and automatic deletion remainOFF/dry-run;0051 stays local-only. FullM1–M5 goal ACTIVE/incomplete. Follow user KISS and minimal relevant validation;do not restart quota investigations or repeat already-green checks without a concrete reason.

## 2026-10-29 — M3i5a internal storage foundation accepted locally

Follow the user's KISS instruction: reuse existing flows/helpers/locks, add only necessary abstractions, and run the smallest meaningful checks for changed behavior. Do not repeat passing suites without a relevant source change or failure;do not expand browser-internal quota experiments. Full product scope is unchanged.

Final isolated Chromium harness exited0 with17 groups (`apps/worker/.local/m3i5a-resolved-batch-browser-final.log`;summary `apps/worker/.local/m3i5a-resolved-batch-browser-a4ae4c38-f691-4130-83d9-b294912494b8.json`,SHA256 `4c32e45f644cb4e815d64d0cff2283f8ea2e94d2fccda96ad13dccc172c7c3f6`). Actual native IndexedDB evidence:49 rows page24/24/1 with25-row lookahead;1,000 synthetic metadata rows over42 pages;updates exactly2gets/0getAll/0cursors;native operation/session uniqueness;scope/session/policy/wrapper denial;fixed intent immutability;existing-data preservation on transaction abort;reload/second-page commit;two-page same-revision CAS one winner/one conflict;fresh-context native quota rejection. Metadata volume is not physical upload acceptance. Quota lowering after existing usage remains not_checked;Chromium accepted writes despite live lowered overrides. Existing-data preservation is separately proven by native transaction abort. No further quota experiments are needed for this slice.

Latest full unit650/73 files passes (`.local/m3i5a-unit-second.log`). Full generated strict35349/whole lint28524 passed before the additive optional PUT AbortSignal;after that change root/Web strict and scoped lint pass (`.local/m3i5a-root-tsc-after-abort.log`,`.local/m3i5a-web-tsc-after-abort.log`). Final helper syntax/ESLint/Prettier pass. Native runner bundles actual adapter/codec;no app assets or main smoke runner were changed. Earlier harness failures (absent file/API name assumptions,scan scope,unsynchronized race,expanded quota experiments) are retained as failed diagnostic evidence,not accepted passes.

Next M3i5b: integrate a genuine multi-file queue with existing ResolvedAlbumUpload,its existing resolvedUploadJournalKey Web Lock,and the new storage. Avoid a new persistent lease/timer system. Existing resolved/single upload UIs already fail closed without Web Locks;do not claim unsupported-browser fallback. Preserve per-file fresh preview/fixed UUIDs/current identity/session/recovery and explicit review. Batch UI/controller and active cancellation remain unfinished;no new batch capability is exposed.0051 stays adopted LOCAL ONLY;all hosted/default gatesOFF,automatic deletionOFF/dry-run. Real OAuth,hosted/productUI integration,physical R2 bulk and power-loss acceptance remain not_checked. FullM1–M5 goal ACTIVE/incomplete. Preserve all unrelated dirty work. Read RESOLVED_BATCH_UPLOADS.md and the accepted0051 proof below.

## 2026-10-29 — M3i5a internal foundation in progress

Added strict metadata-only batch manifest/per-item codecs with1,000-descriptor bound, per-record64KiB/manifest1MiB limits, exact legacy/profile-aware intents, revision CAS, frozen descriptors/policy/UUIDs and explicit lifecycle transitions. Manifest touches do not load all item payloads. Existing single-item journals remain unchanged. Added `getUploadIdentity(signal?)` returning validated Owner UUID plus opaque session ID while stripping extra metadata;existing `getUploadOwner` callers remain unchanged.

Root latest `pnpm test:unit` exited0:650 tests/73 files (`.local/m3i5a-unit-second.log`), including8 new codec,12 identity-client and5 interruptible-PUT tests. `putUploadFile` now accepts an optional AbortSignal without changing existing call sites;already-aborted calls never start transport,in-flight interruption retains unknown-server-outcome semantics and fixed intent recovery. Scoped lint plus root/Web strict checks after this additive change exited0 (`.local/m3i5a-root-tsc-after-abort.log`,`.local/m3i5a-web-tsc-after-abort.log`). These include mocked fetch/unit evidence, not browser or hosted OAuth acceptance. IndexedDB adapter is implemented and frozen:atomic create,24+1 paging,two-read target updates,no queue-wide update scan,unique operation/session indexes and per-row scope/session/policy/wrapper checks. Root generated full typecheck35349 exited0 (`.local/m3i5a-types-first.log`);whole lint28524 exited0 (`.local/m3i5a-lint-first.log`). The isolated native Chromium harness is still being implemented; do not claim native storage acceptance,batch UI/controller,processing lease,cross-tab admission ownership,active cancellation or physical bulk upload ready. Root found and required removal of the draft adapter's all-item update scan: final update must read manifest+target only, with native unique indexes for operation IDs and upload sessions. Per-item case-insensitive UUID collisions must also fail codec validation, because a multiEntry index deduplicates keys within one row.

0051 remains adopted LOCAL ONLY with all gatesOFF and deletionOFF/dry-run;see next M3i4 accepted checkpoint and RESOLVED_BATCH_UPLOADS.md. Full goal ACTIVE/incomplete. Next finish actual IndexedDB transaction/abort/quota/CAS/reload tests, generated strict/lint and docs before UI/controller integration.

## 2026-10-29 — M3i4 accepted locally;0051 adopted LOCAL ONLY

Complete standard67362 exited0:367 actual local Cloudflare checks (`.local/m3i4-cloudflare-first.log`); focused15850 exited0:15 actual workerd/D1/R2/Sharp/API/375px groups (`apps/worker/.local/m3i4-focused-eleventh.log`).625 unit/70 files, final strict30771/lint41244,61 reference integration tests, Next build and14 reference Chromium tests pass. Large history fixtures are synthetic metadata, not1,001 physical R2 uploads. Draft-album compatibility and normal BetterAuth identity envelopes were fixed and exercised; unknown-outcome recovery keeps exact IDs/body. Earlier failed runs remain retained as failures.

Root local adoption31615 exited0 (`apps/worker/.local/m3i4-root-adopt-0051-second.log`):62 CLI commands all0;119 old tables/hashes/4 development rows/product sequences preserved;exactly one replaced resolution guard matches isolated SQL;46 added objects/four empty tables/123 total tables;FK0;ledger51/no pending. Proof `apps/worker/.local/m3i4-persistent-local-adoption-proof-323e0e3a-e1ac-4493-bea0-e84dc8000281.json`, SHA256 `dcfd4da8248b4b32cca4bd71eb9b9996ce17695c73b790cdf6db539dd08bc634`. Backup `apps/worker/.local/d1-before-0051-1e6340d0-a00b-4967-b732-9e9cb8ce8a36.sql`,699926 bytes,SHA256 `a550d2a4e353fa3f7ef5ce91a69b62cc77807673b03e8f62d64adda0ff98615e`. Source0051 SHA256 `4751bd2696f6b766ce42869470b3f98ca36c3338975cfb8cca29623108940ed3`.

Isolated prep retained all200 recorded CLI exits0 after evidence-only reconciliation of four late proof queries: `apps/worker/.local/m3i4-adoption-prep-proof-reconciled-1e6340d0-a00b-4967-b732-9e9cb8ce8a36.json`,SHA256 `f3c59003c1f4d394e952e734d716f913c7e79b46bc5a800091dac27c50e6f61c`. Preserve original failed/count-mismatched proofs. Resume fixed only snapshot `table` versus `tbl_name`;root's first adoption attempt stopped before any CLI at a multiline-Zod preflight regex, then corrected whitespace parsing without product changes. Never restore stale backups over newer writes.

All hosted/default gates remainOFF/hard-local and automatic deletionOFF/dry-run. No remote/customer write,commit,push or deploy. Real OAuth/remoteR2/CORS/edge latency/CPU/free-tier/hosted acceptance remains not_checked. FullM1–M5 goal remains ACTIVE/incomplete. Next M3i5a is internal strict batch manifest/per-item codecs and IndexedDB storage/tests;multi-file resolved UI/controller,processing lease,active cancellation,identity recovery and full native acceptance are not yet implemented. Read MATCHING_RULES.md and RESOLVED_BATCH_UPLOADS.md. Preserve all unrelated dirty work.

## 2026-10-28 — M3i4 full local runtime acceptance; persistent adoption pending

Complete `pnpm test:cloudflare` exited0:367 actual local workerd/D1/R2/API/Chromium checks (`.local/m3i4-cloudflare-first.log`). Final focused run exited0:15 groups (`apps/worker/.local/m3i4-focused-eleventh.log`), covering eight fixed profiles, Unicode expansion, full immutable history, rule CAS/ABA, fresh versus replayed six/seven-field intents, native atomic rollback and same-UUID retry, real small R2/Sharp transfers and375px settings/index/recovery UI. The1,001 appended history records are synthetic metadata, not1,001 physical uploads. Screenshots are local development UI, not hosted or final visual-design acceptance.

625 unit tests/70 files, final generated strict30771, whole lint41244,61 reference integration tests, Next reference build and14 reference Chromium checks passed. Final logs: `.local/m3i4-unit-first.log`, `m3i4-types-final.log`, `m3i4-lint-final-second.log`, `m3i4-integration.log`, `m3i4-reference-build.log`, `m3i4-reference-e2e.log`. First lint failed on generated nested `.local` artifacts; ESLint now ignores `**/.local/**`, retaining tracked production/test checks. Earlier focused failures are preserved as failures, not accepted passes.

Two real regressions were fixed and covered: the replacement resolution guard now preserves draft as well as active albums; settings/index identity readers accept the normal BetterAuth session envelope while retaining validated identity fields. The lost-response test now suppresses transparent automatic PUT retries until explicit recovery; original intent bytes/UUID and single command/result/event remain asserted.

Persistent local D1 remains0050. Source0051 SHA256 `4751bd2696f6b766ce42869470b3f98ca36c3338975cfb8cca29623108940ed3`. Fresh backup/isolated restore/upgrade proof is still running; first two prep attempts stopped before0051 execution at runner inventory-count assertions (47 unique CREATE objects,46 added objects and one replaced guard), not a migration failure. Third prep executed0051 successfully only in the isolated store, then stopped at a verification-only field-name mismatch: snapshots expose `table`, but the assertion read `tbl_name`. All144 recorded CLI exits were0. Resume verification against the retained store after correcting the checker; do not repeat DDL or weaken product assertions. Do not apply persistently before successful proof plus fresh live parity. No remote/customer write, commit, push or deploy. All hosted/default gates and automatic deletion remainOFF/dry-run. Full M1–M5 goal remains ACTIVE/incomplete. Next: finish local0051 adoption, then genuine per-file batch/captured-identity recovery and remaining roadmap.

## 2026-10-28 — M3i4 immutable matching rules in progress

Read docs/MATCHING_RULES.md. Source0051 adds nondefault keys/union view and separate immutable project rule ledger/head/result with shared project revision bump and full Owner namespace. Domain fixed8profile registry,strict contracts,default-OFF/hard-local flag,configuration/index services/routes,profile-aware indexed snapshot/cursor/native resolution context,upload dual-key batch,Owner settings/current-rule index UI and safe history projection are written. Old default keys/mode ledgers/request bodies are preserved. All production/default gates and automatic deletion remainOFF. Persistent D1 remains0050;no0051 adoption or remote/customer/commit/push/deploy.

625 unit/70 files and generated full strict28002 pass;first target dry-run build .local/m3i4-worker-build-first.log exited0. Fresh native0001–0051 syntax/schema/view-plan probe passes123 tables/FK0,but populated upgrade acceptance is pending. Root actual isolated workerd/D1 core probe passes default/no-op/profile transitions,index-gap review/bounded advance/casefold pending match,nondefault feature-OFF failclosed,reset and exact old command replay;metadata only,no R2 transfer claimed. NativeR2/Sharp/375px/full-history/CAS/replay and complete standard remain pending;runtimeagent owns matching-rules.mjs and focused runner,UIagent owns matching-rules-browser.mjs. No assets rebuild during a live focused runner;poll its reported exact handle. Standard harness already has matching-rules-test and0051 upgrade helper but not runtimehelper invocation yet. Root owns that integration.

Current key risks: actual union-view/profile snapshot plans/atomic rollback,strict new context with historical absent payloads,cross-namespace/source witnesses,Unicode expansion500-char keys,new UI recovery/identity/focus and representative-volume cost. Native large-history fixtures must be called synthetic metadata,not bulk R2 E2E. Next complete this full vertical slice/backup-live-parity adoption,then genuine per-file batch/captured-identity recovery and remaining M1–M5. Goal remains ACTIVE/incomplete. Preserve huge unrelated dirty worktree and all M3i3/older proof artifacts.

## M3i3 completion checklist (current)

- [x] Additive0050 scoped seek index;populated native D1 data/schema/sequence preservation and unforced range plan.
- [x] Signed bounded24-row catalog/current authority and arbitrary actual chosen-head reserve/CAS.
- [x]375px bounded UI paging/off-page selection,first-page reachability,separate native groups,correct decision headings and exact recovery.
- [x]352 complete local standard checks,7 final focused groups,588 unit and strict/lint/reference checks.
- [x] Fresh backup/isolated restore/live parity and verified LOCAL ONLY0050 adoption:119 old tables/same4 rows,one index,FK0,ledger50.
- [x] Update specification/AGENTS/GEMINI/HANDOFF/TASKS/CHANGELOG and preserve earlier failed-run history.
- [ ] Next: immutable opt-in matching profiles,true per-file batch/captured-identity recovery and remainingM1–M5/hosted acceptance.

## 2026-10-28 — M3i3 Assisted catalog accepted locally

Complete standard18844 exited0:352 actual local workerd/D1/R2/API/Chromium checks (.local/m3i3-cloudflare-third.log). Final focused18128 exited0:7 checks (worker .local/m3i3-focused-runner-final7.log),including1,001 guarded synthetic logical photos over24-row BINARY pages,exact Owner/session/scope/expiry/HMAC/query checks,arbitrary final-page selected-head reserve/replay,375px first/previous/next/off-page selection,correct explicit-choice headings,separate native radio groups,late identity clearing,lost-response same-UUID recovery,one real signed R2 original upload/native Sharp derivatives,stale head/sequence no-write and legacy1,000/truncated/default-OFF preservation. Root inspected final worker .local/assisted-candidate-catalog-mobile.png. Synthetic metadata is not bulk physical R2 E2E; the metadata-only picker is not final visual design.

588 unit/67 files,full strict68388/lint8613 plus later UI scoped strict/lint and final helper10/10,61 reference integration95549,Next build/14 reference Chromium13914,52-document presence and diff checks passed. Final target build was .local/m3i3-worker-build-final3.log; the second standard rebuilt the same final product source. Third standard used those unchanged assets after only the Guest-comment recovery test assertion changed. First86510 failed after338 groups at an obsolete privacy-helper assertion; second47811 failed after192 at existing recovery-form-versus-journal timing. Root replaced only that assertion with bounded polling of actual sessionStorage cleanup,retaining three exact retry payloads and single command/result/change/comment assertions; read-only source review confirmed pending hides the form before authoritative cleanup. Earlier failures are historical,not accepted passes. Deliberate one-row fixture audit delta is processing.enqueued/upload.authorized/upload.completed/upload.reserved each+1; stale denial changes no post-fixture state.

0050 is now applied LOCAL ONLY. NEW699707-byte backup worker .local/d1-before-0050-eddfe26a-9645-4a9a-b497-a4e7bbb3d58a.sql SHA25666eda00c7faff5744680489ca46607c82e2f14a765af9695062b114e11645bf0. Source0050 SHA2569c8fd019d57d00df0bf56a732ff8215e10e1bad1c7f9183fd27cb6a9b67d480b. Isolated prep35093 exited0:145 Wrangler commands all0,backup restored under a unique .local/m3i3-isolated-persist path,119 old tables/hash/schema/sequences/ledger unchanged,one scoped seek index,FK0 and native unforced covering-index BINARY ID range/no temp sort. Root verified hashes and performed fresh live parity before adoption38239 exit0:61 local CLI commands all0;all119 old product tables/rows/schema/product sequences unchanged,same4 development rows,one index,FK0,ledger50/no pending. Proofs: worker .local/m3i3-local-adoption-proof-eddfe26a-9645-4a9a-b497-a4e7bbb3d58a.json and .local/m3i3-persistent-local-adoption-proof.json;before/after snapshots and apply output retained. Preserve these and older M3h/M3i2 proofs; never restore a stale backup over newer writes.

ASSISTED_CANDIDATE_CATALOG_ENABLED and all hosted/default gates remainOFF/hard-local;automatic deletionOFF/dry-run. No remote/customer write,commit,push or deploy. Real OAuth/remoteR2/CORS/edge latency/CPU/free-tier/native-headed acceptance remains not_checked. Next Task: distinct immutable opt-in matching profiles and genuine per-file batch/captured-identity recovery;coverage-scan cost,legacy witnesses,expiry/preview liveness and metadata-picker UX remain. Comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted readiness are still required. FullM1–M5 remains ACTIVE/incomplete. This entry supersedes earlier in-progress run states; preserve unrelated dirty work.

## 2026-10-28 — M3i3 third complete standard LIVE (supersedes earlier run states)

Root18844/.local/m3i3-cloudflare-third.log is LIVE, executing the complete tests/local-smoke.mjs against the unchanged second-built final target/harness assets. Poll this same handle; never restart solely on observation timeout. Second47811 exited1 after192 groups at existing Guest-comment recovery helper623: the recovery form disappears during pending retry before follow-up authority reads and final sessionStorage cleanup. Root changed only that assertion to bounded polling of the same request ID's actual journal absence. Three identical retry payloads and one command/result/change/comment assertions remain. Scoped format/lint pass; read-only product source analysis independently confirmed the lifecycle ordering. No product fix or rebuild was needed for this test correction.

Final M3i3 focused18128 remains7/7 on final3 source/build with screenshot inspected,588 unit plus reference/strict/lint checks as below. Complete standard acceptance is still pending; first86510 and second47811 are failures,not passes. Persistent local D1 remains0049. Separate fresh backup/isolated0050 evidence is being prepared only; no persistent0050 apply before complete acceptance/live parity. All hosted/default flags and deletion remainOFF/dry-run; no remote/customer/commit/push/deploy. FullM1–M5 remains ACTIVE/incomplete; see ASSISTED_CANDIDATE_CATALOG.md and preserve all unrelated dirty work.

## M3i3 — Current delivery checklist

- [x] Source0050 additive scoped BINARY photo-ID seek index; isolated populated native D1 preservation/query-plan checks.
- [x] Strict bounded24-row catalog contract, signed exact Owner/session/scope/revision/watermark cursor and current SQL authority.
- [x] Reauthorize an arbitrary owned chosen head outside indexed preview metadata; preserve reservation CAS and exact historical replay payloads.
- [x] Bounded Owner picker with first/previous/next, off-page target summary and separate native radio groups; default-OFF legacy path retained.
- [x]588 unit,strict/lint,61 reference integration,Next build and14 reference Chromium pass.
- [x] Final focused18128 passes7 actual API/375px browser/R2/Sharp/replay/head-change groups; root inspected final screenshot.
- [ ] Complete second whole standard root47811 (.local/m3i3-cloudflare-second.log); first86510 failed at obsolete helper after338 groups,not a pass.
- [ ] Assess persistent0050 adoption only after acceptance plus fresh backup/isolated restore/live parity. Current persistent schema0049.
- [ ] Continue distinct opt-in matching profiles and actual per-file batch/recovery, then remainingM1–M5 scope and hosted acceptance.

## 2026-10-28 — M3i3 Assisted catalog in progress

Read docs/ASSISTED_CANDIDATE_CATALOG.md. Source now includes default-OFF/hard-local Assisted catalog, signed24-row keyset pages, real chosen-head authorization outside the tiny preview map, bounded UI paging/selection and additive source migration0050. Gate OFF retains legacy Assisted behavior. Persistent local D1 remains0049; no0050 adoption, remote/customer write,commit,push or deployment.

Actual588 unit/67 files, full strict76374 and whole lint58155 exited0. Initial target build passed; a later source-only cursor-cycle fix needs rebuilt browser acceptance. Focused runtime owner is continuing actual workerd/D1/R2/Chromium tests; previous failures were test assumptions, not full acceptance. Do not claim M3i3 complete or apply0050 before complete runtime validation and fresh backup/restore/live parity. All hosted flags and automatic deletion remainOFF/dry-run. FullM1–M5 remains ACTIVE/incomplete.

## 2026-10-28 — M3i2 local automatic indexing completed; M3i3 next

- [x] Integrate same-snapshot indexed auto_filename classification with full immutable history,pending/key coverage and current-head evidence beyond1,000 materialized rows.
- [x] Preserve Assisted through the existing reader and capture/replay/CAS behavior; transactionally attempt keys in all3 reservation paths with rollback on hard failure.
- [x] Deliver explicit not-ready UI,human labels and per-album heading IDs; retain internal intent/sequence/revision fields.
- [x] Pass345 actual local standard checks,563 unit,strict/lint and reference checks; supplement with13 final-copy focused checks including tenant404/no-write and mobile screenshot.
- [x] Verify fresh0049 backup,isolated restore/upgrade,fresh live parity and LOCAL ONLY adoption:119 tables/same4 product rows,old118 unchanged,empty index,FK0,no pending. See HANDOFF for pinned hashes/proofs.
- [ ] Build bounded Assisted candidate catalog pagination and current chosen-head authorization; do not silently reduce existing choices.
- [ ] Persist distinct versioned opt-in filename-rule profiles with revision CAS and complete rebuild readiness.
- [ ] Implement genuine per-file batch selection/decisions/fingerprints/stable IDs/captured targets/recovery without silent byte or identity substitution.
- [ ] Measure large coverage-query/index costs; handle legacy immutable filename witnesses and expiry-before-preview liveness without weakening CAS/fencing.

INDEXED_VERSION_MATCHING_ENABLED and hosted/default gates remainOFF/hard-local; deletionOFF/dry-run. Synthetic large-history metadata is not physical bulk R2 E2E. No remote/customer edit,commit,push or deploy. Comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and hosted acceptance remain in the ACTIVE fullM1–M5 objective.

## 2026-10-28 — M3i1 completed local foundation; M3i integration next

- [x] Add immutable upload-session/default-v1 filename index migration0049 without rewriting source rows.
- [x] Deliver scoped service/API/local Owner UI and bounded24-item idempotent maintenance with current identity/lifecycle guards.
- [x] Verify populated118→119-table isolated upgrade and all332 actual local Worker/D1/R2/API/Chromium checks;541 unit, strict, lint and preserved reference checks passed. See HANDOFF/VERIFICATION for actual logs and prior failures.
- [x] Correct the gallery toggle accessible name to reflect view/collapse; final standard verifies collapse and separate-album state.
- [ ] Verify fresh persistent backup/restore/live parity before local0049 adoption. Persistent DB remains0048; hosted/default gatesOFF.
- [ ] Integrate same-snapshot indexed classification, complete immutable history/pending evidence and reserve CAS; prove more than1,000 unrelated entries and large single-photo histories without false no-match.
- [ ] Preserve any authorized Assisted target through bounded catalog pagination/current head checks.
- [ ] Persist versioned opt-in rule profiles and complete rebuild readiness; implement genuine per-file batch/recovery without UUID, identity, target or byte substitution.
- [ ] Measure coverage scans/index cost at representative volume; define forward handling of legacy unlinked versions and refine simultaneous-panel heading IDs before hosted enablement.

Maintenance readiness is advisory; the existing matcher/1,000-candidate safety/Assisted behavior remains. No remote/customer edit,commit,push or deploy; automatic deletionOFF/dry-run. FullM1–M5 remains ACTIVE/incomplete, including Owner comparison refinements,delivery/notifications,retention confirmation/retry,roles/multi-node and external acceptance. See MATCHING_FILENAME_INDEX.md for next-slice criteria.

## 2026-10-28 — M3h Owner workspace history/export accepted locally

Full standard run41792 exited0:326 local workerd/D1/R2/API/Chromium checks (.local/m3h-cloudflare-seventh.log),including all10 new history API groups and actual375px enabled/default-OFF history filters,paging,complete CSV/JSON Blob files,error/no-file and late-identity privacy. It reads74 actual workspace action families across every owned workspace,retains original actor/session/request/UTC context and safe before/after values,and proves reads create no audit/retention activity. Unknown/malformed details never expose raw JSON. Current Owner/session/workspace checks repeat on pages/chunks; signed24-row snapshots exclude later backdated appends and survive a fresh authorized Owner session. Related invitations include immutable Guest/Owner witnesses,multi-invitation reviews and exact long reopen IDs. Guest visibility/read-right boundaries are unchanged.

Real Gallery bug fixed and accepted in this standard run: a pending page changed the navigation callback and tore down the open modal lifecycle,losing the opener focus. Keyboard callbacks now update through a ref; lifecycle cleanup occurs on actual open/close. The deterministic real-cursor hold regression opens the modal before releasing a new eligible photo,tests latest keyboard navigation and Escape focus restoration. Synthetic fixture timestamps/order are restored in finally; images/versions/keys/guards remain unchanged. Root inspected the final375px Owner history viewport and Gallery focus-ring captures (worker .local/owner-history-mobile-viewport.png and gallery-grid-mobile.png).

529 unit tests/61 files (.local/m3h-unit-sixth-final.log),integrated generated strict types (.local/m3h-types-sixth-final.log),whole lint (.local/m3h-lint-sixth-final.log),61 original reference integration,14 reference Chromium and Next reference build passed. Separate real workerd/D1 probes verify160-codepoint project/album create/rename/before/after retention (.local/m3h-unicode-probe.log) and512-character opaque session provenance across51 events/3 pages/complete JSON export (.local/m3h-session512-probe.log). Unit boundaries also reject unsupported513-character session IDs. The local/synthetic-only stream test Worker delegates to the real repository/D1 and proves pre-generation cancel/session expiry yield1 start/0 completion,restores the session and permits read200; native preinstalled completion-audit failure rejects the body. It is never mounted in the production API. Server generation is not client receipt. Standard run includes these checks; earlier failed/partial runs below are historical,not acceptance.

0048_owner_history_indexes.sql is applied LOCAL ONLY:8 CLI commands succeeded,7 indexes added. NEW694741-byte backup SHA256c5c604d5bb06170f83e5d4677138d57b235630bffadf2bb1a95252c52799444f was isolated-restored/isolated-upgraded and compared with a fresh live118-table snapshot before adoption22101 exit0. After adoption all118 old-table row hashes/counts/same4 development rows are unchanged,FK0,no pending migrations. Evidence: worker .local/m3h-local-adoption.log,m3h-apply-0048.log,m3h-after-0048-state.json and m3h-isolated-upgrade-proof.json. Migration SHA2560add396c3c6e0e1e4ad3d0fc519f0dca2cd8ae4e25ce98ec04042ba34206158f. Populated standard upgrade also preserves sequences/audit triggers; actual D1 plans use workspace-time/photo indexes and a workspace/implicit-rowid seek. No history-wide MAX is recomputed on every authority check. Leave data/ledgers intact,disable gate and repair forward; never restore an old backup over newer writes.

All hosted/default gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer modification,commit,push or deployment. Real OAuth/remoteR2/CORS/edge/free-tier/native-headed acceptance remains not_checked. Sparse actor/invitation filters and large exports need representative-volume assessment; client files above64MiB fail explicitly. Workspace history information hierarchy needs refinement before hosted enablement. Original independent Guest annotation read-permission question remains pending,so can_annotate128 is unchanged.

Next Task: scalable indexed matching/rules/batch upload,with Owner comparison refinements,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted readiness still required. FullM1–M5 goal remains ACTIVE and incomplete. Read docs/OWNER_HISTORY.md and preserve the large unrelated dirty worktree. This entry supersedes historical pending/run-state entries below.

## 2026-10-28 — M3h fourth standard run active

Current actual process48775/.local/m3h-cloudflare-fourth.log is LIVE; poll this same handle and never restart solely for timeout. Third78128 exited1 after315 old checks plus2 new API groups: the broad actual-source helper shallow-compared nested processing outputs against raw JSON,incorrectly expecting deliberately omitted SHA256 hashes. It now recursively checks every retained value,all array lengths/order and sensitive-key exclusion. Product privacy was correct; no hash was added back. Separate real-data bug fixed: project/album160-codepoint names can exceed256 UTF-16 units,so content-name projection now matches the original160-codepoint rule.528 unit/61 files pass; final full strict18605/lint45506 pass. Actual rebuilt workerd/D1 Unicode probe .local/m3h-unicode-probe.log preserves create/rename/before/after values and the prior51-event snapshot. Main fourth rebuilt the final source and includes all10 history API groups plus375px enabled/default-OFF browser coverage. Persistent DB remains0047 pending complete vertical acceptance; no remote/customer/commit/push/deploy. FullM1–M5 remains active.

## 2026-10-28 — M3h third standard run active

Current actual process78128/.local/m3h-cloudflare-third.log is LIVE; poll the same handle,do not restart on timeout. Second43270 exited1 before new history API checks: existing owner-annotation-authoring-browser helper immediately asserted journal null after server current-target200,before browser consumption. Root changed only that assertion to bounded expect.poll of actual sessionStorage null; target/current revision/command audit/UI assertions remain. Product source is unchanged. Third includes latest product build,all10 new history API groups and enabled/default-OFF375px history browser helper. Final527 unit,full strict53951,whole lint63688,format check,49-file document presence and diff checks pass; actual Next build/61 integration/14 reference Chromium remain green. Persistent DB remains0047. Pre0048 backup/restore/index-only isolated upgrade and pinned proof are ready; ignored adoption script requires a not-yet-created verified326-check acceptance file before local application. Full vertical acceptance is still pending; no remote/customer/commit/push/deploy. FullM1–M5 remains active.

## 2026-10-28 — M3h workspace history/export in progress

Read docs/OWNER_HISTORY.md. Source service/routes/contracts/projection/UI and independent default-OFF/hard-local OWNER_HISTORY_ENABLED are integrated.0048 is additive seven indexes only; persistent development DB remains0047/118 product tables/same4 development rows/FK0. FullM1–M5 remains active; no remote/customer edit,commit/push/deploy.

Actual527 unit/61 files and61 original reference integration tests passed; integrated strict types86713 and Next reference build86904 passed, plus14 reference Chromium tests29540. First full standard96007 exited1 after all315 old checks (including genuinely populated0047→0048 preservation) because a new helper expected application JSON for native hostile-Origin403; exact native403 and missing-Origin application JSON are now separate checks. Do not call this a complete M3h pass. Lint first found root this-alias, then an unused ignored-probe variable; both fixed, final whole lint still to confirm. Initial strict/UI Blob/optional-field errors were fixed and verified.

The latest rebuilt product passed actual isolated workerd/D1/Chromium probe (.local/m3h-browser-probe-third.log under worker), including24-row snapshot paging,complete CSV/JSON Blob downloads,forced completion-audit failure/no file,blur/focus,held200 followed by invalid identity,and genuine default-OFF UI. Root inspected the375px viewport capture .local/owner-history-mobile-viewport.png. Expected OWNER_HISTORY_EXPORT_FAILED in that log is injected stream-failure evidence,not a successful production download. The later capability lifecycle fix was rebuilt before this third probe; older runs used the prior bundle.

Actual isolated workerd/D1 upgrade (.local/m3h-upgrade-probe.log) preserves118 tables/71 populated fixture rows/39660 canonical bytes/audit trigger SQL/FK0, adds seven indexes and verifies workspace-time/photo/rowid-seek query plans and seek bytecode. The main populated upgrade also exercised existing command and sequence history before its later unrelated API-helper failure. NEW pre0048 backup694741 bytes SHA256c5c604d5bb06170f83e5d4677138d57b235630bffadf2bb1a95252c52799444f was restored into a separate directory and isolated-upgraded: all118 old-table hashes/counts/same4 development rows preserved/FK0/no new tables (.local/m3h-backup-restore.log and m3h-restored-upgrade.log). Current0048 SHA2560add396c3c6e0e1e4ad3d0fc519f0dca2cd8ae4e25ce98ec04042ba34206158f. No persistent0048 adoption until complete vertical acceptance and fresh live-state recheck. Keep gates OFF,repair forward,never restore over newer writes. Real OAuth/remoteR2/CORS/edge/free-tier/native-headed acceptance remains not_checked.

Next: finish full standard API/UI acceptance with actual per-action source checks across all owned workspaces,then local adoption if verified; afterwards scalable matching/batch,delivery/notifications,retention preview/confirmation/retry,roles/multi-node and hosted gates remain required. Preserve other dirty edits.

## 2026-10-28 — M3g5 independent annotation processing accepted locally

Genuine Owner processing of Guest annotations is implemented across schema/service/API/current reads/UI/recovery/tests. Independent open/in_progress/resolved decisions retain real Owner provenance and never modify Guest geometry, authorship or lifecycle. Guest content edits make the decision stale; explicit Owner reack pins the current content revision. Same-invitation sharing and different-invitation isolation remain enforced. The separate read-versus-write permission question is still pending: preserve can_annotate128 metadata read eligibility.

Final complete standard run17448 exited0:315 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g5-cloudflare-twelfth.log), including a fresh product build and the final mobile layout correction. Earlier complete runs31021/12781 and main rerun68398 also passed315; historical failed/partial runs below are not passing evidence. Coverage includes dual revision CAS, audit rollback, fresh-session historical replay, actual Owner A→B→A recovery isolation, held real200/full reload/exact UUID retry/current targeted read, and real historical AfterV28 Guest point/color edit. Guest own-target verification precedes fresh shared-target reconciliation; stale processing remains visible before reload, and Owner reack acknowledges content revision4.498 unit tests/58 files, generated integrated strict types, full lint and Next reference production build passed (m3g5-unit-indexed/types-indexed/lint-indexed/next-build logs). Root visually inspected the final Owner and Guest375px captures (worker .local/annotation-processing-owner-mobile.png and annotation-processing-guest-mobile.png). Guest labels/status are readable above the separate mobile action row; no horizontal overflow. Native-headed delivery remains unverified. Whole-repository Prettier,48-file document presence checker and git diff --check passed; the document checker is not an app test.

0047_owner_annotation_processing.sql is now applied LOCAL ONLY:48 commands succeeded. New651211-byte backup SHA256199ee6cc95a9cc0328de16c69e017c50cd3a59ef38940d8b91773bfd39ab770b, actual isolated restore70166/upgrade13204 and fresh live114-table parity passed before adoption. Post-adoption118 product tables/same4 development rows: all114 old table hashes/counts unchanged,4 new processing tables empty,FK0,no pending migrations. Evidence: worker .local/m3g5-local-adoption.log, m3g5-apply-0047.log and m3g5-after-0047-state.json. Current migration SHA2561d9ba2b88d59beb606be1b5457650c8e9fd8f0ca8a087f75ded146c182eef9ee is pinned in m3g5-isolated-upgrade-proof.json. Never restore an old backup over newer writes; gates OFF plus forward repair.

Actual current Wrangler/workerd D1 EXPLAIN verifies exact/page partial-index seeks and no global annotation/history materialization (.local/m3g5-query-plan-after-actual.log); readers join scoped processing states directly. This is local query-plan evidence, not edge CPU, latency or free-tier cost acceptance. All hosted/default feature gates remain OFF/hard-local; automatic deletion OFF/dry-run. Real OAuth, remote R2/CORS, edge deployment and native-headed delivery remain not_checked. No remote/customer modification, commit, push or deployment.

Next Task: full Owner operation history and exports, then scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, roles/multi-node and hosted acceptance. Full M1–M5 goal remains active. Preserve unrelated dirty edits. Earlier entries below are historical checkpoints; this entry supersedes their0046/pending0047 status.

## 2026-10-28 — M3g5 API accepted within partial runs; full UI acceptance active

All6 new processing API groups have actually passed in fourth76307/.local/m3g5-cloudflare-fourth.log: independent gate/input/current Owner boundary, body-free real Owner state/audit with unchanged Guest/comment sources, dual CAS+concurrency, content stale versus lifecycle +explicit reack, deleted-parent historical replay after original-session pruning, and Owner/Guest shared processing-clock cursor invalidation. The same run passed existing Guest annotation, Owner readonly and Owner authoring browser groups. It then failed only the new helper's parsing of the stored journal envelope as flat metadata; fixed. Fifth94575 passed a real accepted held processing request/full reload and then failed an overly strict raw-envelope equality: status legitimately changed ready→uncertain while metadata/command stayed identical. The helper now allows only that status transition and compares every original metadata field; B/A switching still requires unchanged post-reload raw bytes.

498 unit/58 files (.local/m3g5-unit-complete.log), final generated Worker/shared/Web strict (.local/m3g5-types-second.log), full lint (.local/m3g5-lint-final.log) and actual Next reference production build (.local/m3g5-next-build.log) pass. No hosted evidence. Current full standard run26971/.local/m3g5-cloudflare-sixth.log is ACTIVE; do not restart solely on observation timeout. The historical GuestAfterV28 setup and actual Guest UI point/color edit are in this helper, with strict own-target read preceding shared-target processing reconciliation and pre-reload stale-label assertion. A/B same-photo/version cross-invite recovery is also in source and still awaits a complete runtime pass. Root source/journal scopes were reviewed and hardened; no cross-invite replay/read/reconcile is allowed.

New651211-byte pre0047 backup and actual isolated restore/upgrade are verified as below:114 old-table hashes/4 development rows preserved,4 empty new processing tables,118 total/FK0. Persistent development DB remains0046/114tables;0047 adoption has NOT happened. Prepared ignored .local/m3g5-adopt-0047.mjs performs migration SHA/backup SHA/current114-table parity before local-only application, but must not run before full vertical acceptance. All default/hosted flags OFF/hard-local and deletion OFF/dry-run. No remote/customer edits, commit/push/deploy; fullM1-M5 remains active.

## 2026-10-28 — M3g5 independent annotation processing in progress

M3g4/0046 remains the last locally accepted baseline (308 Worker/browser checks,467 unit,114 persistent product tables/same4 development rows/FK0). This turn continues genuine Owner processing of Guest annotations: separate open/in_progress/resolved decision/revision, expectedAnnotationRevision + expectedProcessingRevision CAS, immutable body-free receipts and real Owner audit. Guest create/update (geometry/style/link) advances content watermark and makes prior decisions stale; Guest resolve/reopen/delete do not count as content edits. No Guest geometry/authorship/lifecycle is modified or impersonated.

Contracts, service/routes/default-OFF hard-local gate, current SQL readers, Guest status reconciliation, Owner processing panel and metadata journal are integrated.498 unit/58 files (.local/m3g5-unit-complete.log) and generated Worker/shared/Web strict types (.local/m3g5-types-second.log) pass; full lint passed before final scope hardening, whose focused Web lint/typechecks also pass. Cross-invite recovered A intent under B was found by read-only review and fixed before acceptance: full target match before claim/send/read, metadata-only guidance under B, and actual source scope in parent reconciliation. The browser regression is written but not yet passed. Root also requires the Guest content-edit browser path to prove strict own read followed by current shared processing projection without losing status.

First runtime99760 passed actual populated0046→0047 history preservation then failed the old Owner read field whitelist; processing was added explicitly with exact initial/null assertions, retaining all privacy restrictions. Second78496 failed the hostile-Origin fixture's expectation; real native403/Invalid Origin header is now checked separately from missing-Origin JSON403. Third81557 passed the first3 processing API groups and all content/lifecycle/reack assertions, then the privacy fixture incorrectly serialized its own body-bearing comment objects; it now checks only real receipt/annotation projections. No weakening of server checks. Guest historical UI helper was corrected to select actual AfterV28 (with a third Before) rather than silently switching the fixture to currentV1. Full runtime/UI acceptance remains PENDING; do not call this enabled/hosted usable.

NEW pre0047 backup651211 bytes, SHA256199ee6cc95a9cc0328de16c69e017c50cd3a59ef38940d8b91773bfd39ab770b, worker .local/m3g5-backup-integrity.json. Actual isolated restore62330 exit0 preserves all114 old-table hashes/4 development rows/FK0. Isolated0047 upgrade95858 exit0 preserves those114 tables and adds4 empty processing tables, total118/same4 rows/FK0. Proof .local/m3g5-isolated-upgrade-proof.json pins migration SHA256 ed8eceb5b18908a6a10fb617658d908f4eb1681ee85c13eaf23c0b888610dd11. No persistent0047 adoption; live remains0046. Before eventual adoption finish current API/UI acceptance and recheck current114-table contents against this backup. Before eventual adoption require NEW pre0047 backup/isolated restore/current114-table parity, populated-history preservation and full vertical acceptance; do not restore the pre0046 snapshot over newer data.

Guest /annotations/own and immutable Guest receipts remain unchanged. GuestShared cursor becomesv3 with independent Guest/Owner/processing counters; Owner Guest-read cursor becomesv2 with independent Guest/processing counters. Existing author-only OwnerOwn reader is unchanged. Current can_annotate128 read boundary stays unchanged pending the separate read-permission answer. All hosted gates and auto deletion remain OFF/dry-run. No remote/customer edit, commit/push/deploy. Read docs/ANNOTATION_PROCESSING.md for the frozen contract; preserve other dirty edits.

## 2026-10-28 — M3g4 genuine Owner annotation authoring accepted locally

M3g4 is locally accepted. Genuine Owner create/update/delete/resolve/reopen use separate commands/projection/changes/results, strict current Owner/session/exact invitation/photo/version authority, immutable before/after user audit and exact replay under a fresh valid Owner session. Owner can retain metadata for expired/revoked invitations and private versions; this never publishes bytes or broadens Guest access. Owner author-only recovery is separate from the existing readonly Guest annotation viewer. Guest shared lists include explicit Owner/Guest roles within one invitation, never peer write authority or identity IDs. Independent Guest/Owner cursor watermarks invalidate on either source, and the combined lifetime1000 cap includes tombstones while permitting replay/edit/lifecycle at capacity. Cross-role IDs and symmetric Owner request namespaces are guarded.

Actual final complete standard run94669 exited0:308 local Worker/workerd/D1/R2/Chromium checks (.local/m3g4-cloudflare-fourth.log). Prior complete third30871 also passed308.467 unit/55 files (.local/m3g4-unit-complete.log), generated Worker/shared/Web strict (.local/m3g4-types-complete.log), full lint (.local/m3g4-lint-final.log) plus focused final visual-helper lint passed. Same-turn Next reference build passed; it is not hosted E2E. Real375px Owner pointer geometry, reverse rectangle, full lifecycle, a held accepted create across full reload/exact UUID replay/current-own reread, and genuine disabled-Owner403 hiding Gallery/photos while preserving the exact raw journal all passed. Root visually inspected worker .local/owner-annotation-authoring-updated-mobile.png: actual purple private preview and red rectangle are visible. The helper also checks saved SVG geometry/visibility and actual red stroke pixels, retaining a canvas capture. Native headed delivery, real OAuth/remote R2/CORS/edge/free-tier acceptance remain not_checked.

A real integration defect found by the second runtime (Object.toString on a parsed query) was fixed with the production URLSearchParams helper and3 regression tests; strict types alone had not caught it. Initial raw-tamper error assertion was corrected to the actual predecessor guard without allowing writes. Current Owner auth denial and verified identity changes invalidate panel and Gallery caches/controllers under exact scope/generation guards, retaining journals; stale callbacks cannot repopulate or clear a replacement scope. Guest own/result contracts remain unchanged.

0046 is applied LOCAL ONLY:50 commands succeeded after NEW594730-byte backup SHA256 bf27e82976d3bddb995ca669f2f39eadfc6eca85228cc385403b7a1a4b9c3d09, isolated restore/isolated upgrade and a fresh live110-table hash comparison. Successful adoption36744 exit0: worker .local/m3g4-local-adoption-second.log and m3g4-apply-0046.log. All110 old tables remain byte-content-hash/count identical;4 new Owner tables empty, total114 product tables/same4 development rows/FK0/no pending migrations. Proof pins migration SHA256 c2288d201616fa486fed664bc019ac2a6a6249a9f629626986a1193d0eefd230 (.local/m3g4-isolated-upgrade-proof.json). First adoption11759 failed before migration because this Wrangler version has no --yes on migrations apply; read-only list confirmed0046 still pending. Corrected non-interactive local-only invocation rechecked the live snapshot before success. Never restore either backup over newer writes; gates OFF and forward repair.

All annotation hosted/default gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer edit, commit/push/deploy or production acceptance. The user-confirmed same-invitation sharing policy is resolved. The separate read-versus-write permission question remains pending, so can_annotate128 read eligibility is unchanged. Owner browser coverage does not claim native headed delivery or every valid-B delayed-response scenario (Guest already has separate actual coverage; Owner metadata CAS has unit/source review).

Next Task: genuine Owner processing decisions on Guest annotations with independent processing revision/status/audit (never modify Guest geometry/lifecycle or impersonate a Guest), then full Owner history/exports. FullM1-M5 remains active: scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, roles/multi-node and hosted acceptance remain unfinished. Preserve unrelated dirty edits.

## 2026-10-28 — M3g4 functional runtime passed; final visual check pending

Actual complete standard run30871 exited0:308 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g4-cloudflare-third.log), including all genuine Owner annotation API/cap/collision/history/replay cases, shared paired watermarks, real375px point/reverse rectangle/create/update/resolve/reopen/delete, a held accepted create across full reload with exact UUID/current-own reread, and real disabled-Owner403 clearing Gallery/photo cache while retaining the exact raw journal.467 unit/55 files (.local/m3g4-unit-complete.log), generated strict types (.local/m3g4-types-complete.log) and full lint (.local/m3g4-lint-final.log) pass. Earlier Next build passed; no hosted evidence.

Root visually inspected the first new Owner screenshot and found only controls/black canvas top visible because the nested scroller was positioned above the actual image. Functional assertions passed, but that capture was NOT visual acceptance. Helper now explicitly scrolls real decoded photo/rectangle into view and verifies saved SVG attributes plus actual red stroke pixels before capturing; final full run94669/.local/m3g4-cloudflare-fourth.log is active. Do not restart solely on observation timeout. Product source is unchanged by the screenshot-only strengthening.

NEW backup/isolated restore/isolated0046 upgrade are verified as detailed below. Latest live pre-adoption snapshot90074 exit0 still matches all110 backed-up tables/4 rows/FK0 (.local/m3g4-pre-adoption-parity.log under worker). Persistent DB is still0045; adoption is pending final checks. All flags OFF/hard-local; deletion OFF/dry-run; no remote/customer change, commit/push/deploy. FullM1-M5 remains active.

## 2026-10-28 — M3g4 genuine Owner annotation authoring in progress

The confirmed annotation policy remains same-invitation shared / different-invitation isolated. Owner authoring uses new strict contracts, independent commands/projections/changes/results in source-only migration0046, genuine user/session audit actions and a current Owner author-only recovery reader. It never writes a Guest command. Owner metadata can target any owned immutable version and retained invitation; Guest visibility still requires a live authorized invitation and an eligible published version. OWNER_ANNOTATION_AUTHORING_ENABLED defaults OFF and is hard-local, independent of Guest/comment flags.

Current source integrates Owner service/routes/editor/journal and mixed Guest/Owner shared rows with explicit authorType and independent Guest/Owner cursor watermarks. Actual464 unit/54 files (.local/m3g4-unit-final.log), generated strict types (.local/m3g4-types-final.log), full lint (.local/m3g4-lint-second.log) and Next build (.local/m3g4-next-build.log) passed before the latest URL serializer correction. First full runtime39250 exited1 only on an overly narrow raw-tamper error assertion; the trigger correctly rejected the write. Second5450 passed every new Owner API group, combined1000-row/tombstone cap, cross-role ID collision, paired stale cursors, populated0046 upgrade, Guest annotation browser and Owner readonly browser, then failed the new editor initial read. Root found the parsed query object was serialized with Object.toString instead of URLSearchParams; correction and a production-path regression test are underway. Full M3g4 UI acceptance remains PENDING. Current-auth denial/identity change now force Gallery cache/selection/request invalidation under generation guards while preserving all journals; actual disabled-Owner403 browser coverage is being added.

NEW pre0046 backup594730 bytes, SHA256 bf27e82976d3bddb995ca669f2f39eadfc6eca85228cc385403b7a1a4b9c3d09, worker .local/m3g4-backup-integrity.json. Actual isolated restore54476 exit0 matches all110 old-table hashes/4 development rows/FK0. Isolated upgrade68699 exit0 preserves all110 tables and adds four empty Owner tables, total114/same4 rows/FK0. Proof .local/m3g4-isolated-upgrade-proof.json pins migration SHA256 c2288d201616fa486fed664bc019ac2a6a6249a9f629626986a1193d0eefd230. Migration0046 has NOT been applied to persistent local D1; it remains0045. Before eventual adoption complete actual UI acceptance and recheck live110-table state against the NEW backup; never restore either older snapshot over newer writes. All hosted flags OFF, automatic deletion OFF/dry-run. No remote/customer changes, commit/push/deploy or hosted OAuth/R2 acceptance.

A separate read-versus-write permission question remains pending: retain the existing independent can_annotate128 read boundary until explicitly answered; do not infer permission broadening from elapsed time. Owner processing of Guest notes and remaining M1-M5 features are unfinished. Preserve all unrelated dirty edits.

## Current verified work and remaining tasks

- [x] Actual Guest own drawing/lifecycle/recovery and authenticated Owner readonly viewer.
- [x] User-confirmed same-invitation sharing, readonly peers and different-invitation isolation;295 full local checks/430 unit.
- [x] Local0045 adoption after backup/restore, live hash parity and FK/no-pending checks.
- [ ] Genuine Owner annotation creation/edit/delete/processing with Owner session/audit provenance; keep Guest authored lifecycle independent.
- [ ] Full Owner operation history/exports, scalable matching/batch, delivery/notifications and retention preview/confirmation/retry.
- [ ] Hosted OAuth/R2/CORS/edge/CI deployment and remaining roles/multi-node/full M1-M5 acceptance. Flags remain OFF and deletion OFF/dry-run.

## 2026-10-28 — M3g3 invitation-shared annotations accepted locally

The user-confirmed policy 同邀請共用（比照留言） is implemented and locally accepted. Guest main lists and overlays use /annotations/shared for the current sealed invitation; different invitations remain isolated. isMine and plain client badges derive from exact stored identity, with no peer edit/delete/resolve/reopen controls. /annotations/own remains strict author-only for command recovery and postreceipt current-row reconciliation. Commands, revision CAS, immutable witnesses and full Guest audit are unchanged; sharing never grants peer writes or image/compare/comment privileges. Shared cursors have their own viewer/session/scope domain and all-author watermark. Peer comment links are redacted without can_comment; no peer Guest IDs, bodies, keys, credentials or media URLs are exposed. No new migration was needed beyond0045.

Actual complete standard run:295 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g3-cloudflare-first.log, session43746 exit0).430 unit/50 files (.local/m3g3-unit-first.log), generated Worker/shared/Web strict types (.local/m3g3-types-first.log) and full lint (.local/m3g3-lint-first.log) passed. The same turn also passed61 reference integration/10 files,14 reference Chromium/28.1s and Next production build; these are reference coverage, not hosted E2E.375px Guest and Owner screenshots in apps/worker/.local were visually inspected; Owner capture includes the actual version overlay. Controlled delayed200/401 cases are distinct from explicitly canceled headless lifecycle cases; no native headed delivery claim.

Own canvas/recovery and Owner readonly base first passed288 checks (.local/m3g2-cloudflare-eighth.log, session78510 exit0). Actual tests cover point/reverse rectangle/keyboard/portrait/resize/zoom+pan pointer mapping, ancestor clipping, source version scope, real same-invitation peers and different-invitation isolation, own-only recovery reads, current tombstones, lost response/full reload/exact metadata CAS, live late200/401 versus valid replacement raw intent, corrupt/unavailable storage, cookie identity changes and current401 gallery-wide privacy clearing. Owner viewing supports explicit invitation/version, all authors, retained expired/revoked invite history and private draft metadata; bytes remain separately authorized. Cached image onLoad dimensions survive no-op selection and invite switching. Owner resource UUIDs retain exact SQLite identity; only new request UUIDs have canonical case.

0045 is now applied LOCAL ONLY:48 commands succeeded after a new550884-byte backup and isolated restore/upgrade proof. Backup SHA256 e031882926ae6237b483ab9008d8a5cb60d8ea719433e62d5f42487a90475b91; manifest apps/worker/.local/m3g2-backup-integrity.json. The live pre-adoption snapshot still matched all106 backed-up old tables. Post-adoption hashes preserve every one of those106 tables;4 new annotation tables are empty, total110 product tables/same4 development rows/FK0/no pending migrations. See worker .local/m3g3-apply-0045.log, m3g3-post-adoption-snapshot.log and m3g3-post-adoption-parity.log. Never restore this old backup over newer writes; gate OFF and repair forward. All Guest/Owner annotation gates remain OFF/hard-local, automatic deletion OFF/dry-run. No remote/customer modification, commit/push/deploy or real OAuth/R2/CORS/edge/free-tier acceptance. FullM1-M5 remains active: next genuine Owner annotation authoring/processing (never Guest impersonation), full Owner history/exports, scalable matching/batch, delivery/notifications, retention confirmation/retry and hosted/role/multi-node acceptance. Visibility is resolved; do not ask again or revert to own-only final display.

## 2026-10-28 — Annotation visibility decision resolved

- [x] User confirmed 同邀請共用（比照留言）, different invitations isolated.
- [x] Implement and accept invitation-shared D1 reader/API/cursor/privacy tests, preserving the explicit own endpoint and author-only writes.
- [x] Integrate shared list/canvas labels and readonly peer controls; real peer visibility/isolation/recovery browser acceptance.
- [x] Finish Owner cached-preview scope race acceptance, verified backup/restore/isolated upgrade and live local0045 adoption;106 old tables unchanged, new4empty/FK0/no pending.
- [ ] Continue genuine Owner annotation authoring/processing and remaining full M1-M5 work; hosted credentials/deployment acceptance remain open.

## 2026-10-28 — M3g2 backup/isolated upgrade verified; complete UI acceptance pending

New pre0045 local backup is550884 bytes, SHA256 e031882926ae6237b483ab9008d8a5cb60d8ea719433e62d5f42487a90475b91, manifest apps/worker/.local/m3g2-backup-integrity.json. Actual restore to a new isolated directory matches all106 old-table row-content hashes,4 total development rows and FK0 (.local/m3g2-backup-restore.log under worker, session5620 exit0). Applying0045 ONLY to that restored copy also preserves all106 old tables, adds4 empty tables, total110 tables/same4 rows/FK0 (worker .local/m3g2-restored-upgrade.log, session3506 exit0). Persistent development DB is still0044; before eventual adoption recheck live state against this snapshot and take a new backup if anything changed. Never restore the old snapshot over newer writes.

Fourth full run53696 and fifth94286 both ended exit1 at the historical comparison selector, after actual point/rectangle/keyboard/zoom+pan pointer creates and all five new Owner API groups. Fifth diagnostic proves version GET200 and correct3457 permission mask; V28 is the selected Before and intentionally omitted from After to prevent equal-version comparison. Fix the test to select a different Before before choosing V28 as After; retain the product guard. Complete remaining portrait/version/recovery/delayed-response/identity/Owner browser checks and visual screenshot inspection before accepting M3g2.

Source now maps pointers from the actual decoded image rectangle while rejecting viewport/ancestor clipping via hit testing. Exact same-intent current401 clears the entire Guest gallery/Lightbox and selection state through a guarded callback, retaining metadata recovery; independent403 remains scoped. Guest pageshow reauthorizes. Stale A must not invoke global clearing or change replacement B. Live200/401 raw-replacement, cancellation-only and current401 gallery clearing tests are in source but NOT yet reached by a complete passing run.

Actual427 unit/49 files (.local/m3g2-unit-complete.log),61 reference integration,14 reference Chromium/28.1s, full generated integrated strict types (.local/m3g2-types-integrated.log), earlier full lint plus focused final integration lint and Next build pass. Full final lint/Worker UI suite remain pending after the latest source/test edits. Gates OFF/hard-local, deletion OFF/dry-run; no remote/customer change, commit/push/deploy or hosted/native headed acceptance. FullM1-M5 remains active. See GUEST_ANNOTATIONS.md/TEST_ACCEPTANCE and preserve dirty worktree.

## 2026-10-28 — M3g2 third runtime checkpoint

Third full local run .local/m3g2-cloudflare-third.log/session63283 ended exit1 at the first actual Guest point-coordinate assertion: request y412205 versus DOM-painted expected y412256, a51/1,000,000 discrepancy. All five new Owner API groups passed first, including genuinely expired/revoked invitations, readonly multi-author/tombstone pages, cursor changes and a fresh expired Owner session without altering the primary OAuth session. This is not complete Guest/Owner UI acceptance.

Next fix pointer mapping against the decoded rendered image rectangle, keeping the original viewport clipping check and pure oriented-image adapter, rather than weakening request/DB equality. Current 401/403 command/pagination denials must clear private UI only for the matching generation/Guest/full intent while retaining recovery metadata. Also distinguish a canceled lifecycle request from a genuinely delivered late panel response; add raw-journal-replacement acceptance for real delayed200/401 without weakening the send mutex. Final427 unit/61 reference integration/14 reference Chromium, generated strict types, full lint and Next build evidence remains in the preceding checkpoint; rerun focused/full relevant checks after these edits.

0045 remains source-only/local DB0044; all hosted gates OFF/hard-local and deletion OFF/dry-run. New ignored .local/m3g2-local-state.mjs is prepared for later backup/restore/hash parity but has not been executed. No persistent migration, remote/customer modification, commit/push/deploy or hosted acceptance. FullM1-M5 remains active.

## 2026-10-28 — M3g2 annotation UI integrated; acceptance in progress

Guest own point/rectangle canvas, version-bound drawing/list/lifecycle and metadata-only recovery UI are now mounted in the current Lightbox and After comparison view. Pending operations protect navigation. Authenticated Owner readonly invitation/version annotation contracts, D1 reader, routes, independent default-OFF OWNER_ANNOTATIONS_ENABLED gate and viewer are integrated. Owner metadata may include owned private drafts; Guest eligibility and private image-byte authorization remain independent and unchanged. Peer annotation visibility still awaits the explicit product decision; no peer list is exposed to Guests.

Actual checks this turn:427 unit/49 files (.local/m3g2-unit-final.log),61 reference integration/10 files,14 reference Chromium/28.1s, Next production build, final generated Worker/shared/Web strict typecheck (.local/m3g2-types-final.log) and full lint (.local/m3g2-lint-final.log) passed. Initial test discriminant and Owner React lint findings were fixed. First Cloudflare run32344 exited1 on an observation bug: ordinary annotation POSTs were not included in the helper mutation list; bridge now observes every actual command. Second run12542 passed the first three new Owner API groups, then exited1 because the expiry fixture tried to UPDATE an immutable deadline; the guard correctly rejected it. Fixture now creates a genuinely short-lived sealed invite, proves pre-expiry access and polls the D1 clock before post-expiry assertions. Full-metadata late-response CAS, synchronous Owner scope clearing and explicit visible SVG strokes are repaired. Third full API/browser acceptance and screenshot inspection remain pending; do not call M3g2 accepted yet.

0045 remains source-only; persistent development DB remains0044. New pre0045 backup/isolated restore/old-table parity and local adoption are pending after vertical acceptance. All hosted gates remain OFF/hard-local; automatic deletion OFF/dry-run. No remote/customer data modification, commit/push/deploy or real OAuth/R2/CORS/edge acceptance. Full M1-M5 remains active and unfinished. Preserve dirty worktree and use actual terminal logs before updating acceptance claims.

## 2026-10-28 — M3g1 accepted backend; M3g2 drawing UI next

- [x] Normalized point/rectangle geometry, oriented-preview contain/zoom/pan transform and strict contracts.
- [x] Independent can_annotate, author-only lifecycle/CAS/exact replay, optional permissioned own-comment linking, immutable audit/state/result witnesses and eight-ledger namespace guards.
- [x] Explicit own-author paginated/current reader, metadata-only own activity and real author-scope index query-plan checks.
- [x]281 full local Worker/406 unit/61 reference integration/14 reference Chromium, generated types/lint/Next and Worker build.
- [x] Populated0044 upgrade preserves old rows and shared comment sequence; new4empty/FK clean in isolation.
- [ ] Actual Guest drawing/list/edit/lifecycle/recovery UI +375px pointer/keyboard/resize/zoom/pan acceptance.
- [ ] Authenticated Owner readonly annotation viewer, then genuine Owner annotation commands/processing (never Guest impersonation).
- [ ] Same-invitation peer visibility decision remains pending; explicit own reader is safe under either answer.
- [ ] New pre0045 backup/isolated restore/parity and persistent local adoption after the next vertical acceptance; local DB remains0044.
- [ ] Full history/exports, scalable matching, delivery/notifications, retention preview/confirmation/retry, production processing/roles/multi-node and all remaining M1–M5/hosted acceptance.

See GUEST_ANNOTATIONS.md/latest HANDOFF. All feature gates OFF/hard-local, deletion OFF/dry-run; no remote/customer changes or commit/push/deploy.

## 2026-10-28 — M3f2b accepted; next independent annotations

- [x] Owner processing contracts/schema/service/API/current-read/UI source, independent from Guest lifecycle and text.
- [x] Atomic body-free receipts/Owner audit/shared markers, canonical symmetric namespace, dual CAS/content staleness and explicit acknowledgement.
- [x] Actual269 full local Cloudflare checks,369 unit,61 reference integration,14 reference Chromium, strict types/lint/Next and Worker build.
- [x]375px bodyless lost-response recovery/read-only peer/isolation and screenshot visually verified.
- [x] Populated0043 upgrade plus ignored backup/isolated restore proof;0044 locally applied46 commands,102 old table hashes unchanged/new4empty/FK0/no pending.
- [ ] Independent normalized point/rectangle annotations through schema/service/API/UI/tests/docs.
- [ ] Full Owner history/exports, scalable matching/batch, delivery/notifications, retention preview/confirmation/retry, production processing/roles/multi-node and complete hosted acceptance. FullM1–M5 remains active.

See COMMENT_PROCESSING.md and latest HANDOFF. All gates stay OFF/hard-local, deletion OFF/dry-run. No remote/customer modification or commit/push/deploy.

## 2026-10-28 — Current M3f2b status

- [x] Independent Owner processing contracts/schema/service/API/current-read/UI source integrated, default-OFF/hard-local.
- [x]369 unit,61 reference integration,14 reference Chromium, strict types/lint/Next and Worker dry-build actually passed.
- [x] Populated0043 upgrade preserves old rows and existing shared marker sequence; FK clean.
- [ ] Complete new status API/375px recovery and terminal full Cloudflare acceptance (ninth run active; see HANDOFF).
- [ ] Finish isolated pre0044 backup restore proof, then local-only adoption/parity and final docs.
- [ ] Independent point/rectangle annotations, complete history/exports, delivery/notifications, retention safeguards, scalable matching and all remaining M1–M5/hosted acceptance.

## Current M3f2a acceptance and next tasks

- [x] Genuine Owner invitation/version thread reads and reply/edit/delete through schema/service/API/UI/tests/docs;260 local Worker checks and345 unit tests passed.
- [x] Populated0042 Guest history upgrade, ignored backup, isolated full-content restore and local0043 adoption;97 old-table hashes unchanged,5 new tables empty, FK clean/no pending migrations.
- [ ] Next M3f2b: genuine Owner processing-state provenance without Guest impersonation or rewriting Guest-authored text/status.
- [ ] Independent normalized point/rectangle annotations with oriented-image/letterbox validation and immutable version context.
- [ ] Full Owner history/exports/proactive or batch workflow where required, scalable indexed matching/rules/batch, delivery/notifications, retention preview/confirmation/retry, production processing/roles/multi-node and hosted acceptance. FullM1–M5 remains active.

## 2026-10-28 — M3f2a Owner reply vertical accepted locally

Supersedes pending M3f2 checkpoints below. Genuine Owner thread reads/reply/edit/delete, explicit invitation/version UI, readonly same-invitation Guest visibility, durable recovery and shared thread cursors are integrated. Actual final standard run:260 local Worker/D1/R2/Chromium checks passed (.local/m3f2-cloudflare-twelfth.log, session94956 exit0);345 unit/41files,61 reference integration,14 reference Chromium(33.9s), generated strict types/lint/Next build passed.375px Owner screenshot was visually inspected. Hosted services and native headed lifecycle delivery remain not_checked.

0043 applied LOCAL ONLY after verified ignored468000-byte backup and isolated restore.63 commands succeeded;97 old tables retain exact row-content hashes,5 new tables start empty, FK clean/no pending migrations. Populated pre0043 Guest history upgrade also passes using guarded commands and an actual private16x16 R2/Sharp V2. Keep shipped OWNER_COMMENTS_ENABLED=false/hard-local, deletion OFF/dry-run. No customer/remote changes, commit/push/deploy. FullM1–M5 remains active; next Owner processing status with genuine actor provenance, then independent point/rectangle annotations, full history/exports/delivery/retention/hosted acceptance. Read OWNER_COMMENTS.md and HANDOFF before continuing.

## 2026-10-28 — M3f2 backend accepted locally; Owner UI pending

Actual standard full local Worker run passed258 checks (.local/m3f2-cloudflare-sixth.log, session1557 exit0), including15 new Owner reply/API cases, existing Guest/Owner Chromium and actual isolated D1/R2/Sharp flows.338 unit/40files, root strict types, lint and isolated43-migration/FK probe passed before the newest UI work;7 additional Owner journal tests now pass after reproducing/fixing2 stale-storage overwrite cases. Do not treat these as final full Owner UI acceptance.

0043 source adds genuine Owner replies/commands/changes/results, shared Guest/Owner markers, canonical request casing and symmetric indexed legacy namespace guards. No persistent0043 application, remote change, commit/push/deploy. Owner replies remain OFF/hard-local in all environments; deletion OFF/dry-run. Owner UI is now mounted behind the gate, but bootstrap visibility/race fixes, new1000-reply capacity case and actual375px workflow/recovery acceptance are pending. Read docs/OWNER_COMMENTS.md and latest HANDOFF. FullM1–M5 remains active; Owner status/annotations/delivery/retention/hosted acceptance are unfinished.

## 2026-10-28 — M3f2 Owner reply contracts; runtime pending

Owner reply/edit_reply/delete_reply now have strict shared Zod contracts and meaningful validation tests. Commands reject client actor/session/workspace/Guest identity injection, bind new replies to invitation/photo/version/parent revision, and require reply CAS for edits/deletion. Owner thread pages enforce scoped unique items; authorType/parent/canEdit and tombstone/result invariants prevent representing Guest text as an editable Owner reply. Body normalization reuses the existing Guest Unicode rules.

Actual checks this turn:325 unit tests/39files passed (including9 new Owner contract cases); root TypeScript strict check and focused ESLint passed. ESLint emitted the existing React-detection warning, with no lint findings.44-file documentation portability check passed (presence only). Initial tsc caught a test reading body without narrowing the delete_reply union; corrected narrowing passed the rerun. Existing243 Worker/reference/browser acceptance remains historical and was not rerun for these unexposed contracts. No new migration, API, UI, persistent DB change or hosted deployment.

Read docs/OWNER_COMMENTS.md for the concrete next implementation. Add genuine Owner commands/replies/changes/results and a shared transactionally guarded thread watermark; preserve0042 Guest actor/session FKs, all Owner request namespace witnesses and exact replay under a fresh valid Owner session. Then service/API/UI/runtime acceptance; Owner processing-state transitions require explicit actor-aware projection. Do not advertise Owner replies as available yet. All default-OFF/hard-local flags and deletion OFF/dry-run remain unchanged. FullM1–M5 remains active; annotations/delivery/retention/production acceptance are unfinished.

## 2026-10-27 — M3f1 accepted; full goal remains active

- [x] Guest invitation-shared version comments: single/batch create, author lifecycle/CAS/tombstone, live published-ready ACL, pagination, immutable audit, exact recovery and current-state reconciliation.243 Worker,316 unit,61 reference integration,14 reference Chromium and types/lint/build passed;0042 local-only applied after backup.
- [ ] Next M3f2: Owner thread read/reply/moderation with separate Owner intent/session provenance; preserve Guest ledger and invitation/version boundaries.
- [ ] Independent point/rectangle annotations, Owner comparison/full history/exports, indexed matching/rules/batch, delivery/notifications, retention planning/confirmation/retries, production roles/processing/multi-node and hosted acceptance.

See current HANDOFF/GUEST_COMMENTS; supersedes M3f1 pending records below. No hosted enablement, deployment, commit or push. FullM1–M5 remains active.

## 2026-10-27 — M3f1 source integrated; runtime acceptance pending

Schema0042, D1GuestCommentsRepository, strict routes/default-OFF gate and actual Guest single/batch UI are integrated; no persistent0042 application.315 unit tests/38files passed. Isolated42-migration workerd/D1 syntax/FK probe passed with all4 new tables empty. Full generated Worker/shared/Web typecheck passed; later UI journal-race hardening also passed Web strict checks. First Next build passed before the final recovery hardening; final build remains required. Full lint initially found unused new-test variables plus a temporary diagnostic harness; tests were corrected and the completed temporary harness removed. No final full-suite acceptance yet.

Two API diagnostic runs use real baseline Worker/R2/Chromium and actual new comment HTTP/D1 fixtures; new comment browser checks were explicitly omitted. First58655 failed on stale24-target fixture assertions expecting2; production returned24 valid results. Second55592 passed same-invitation privacy, independent can_comment and the24-target/2,000-emoji batch, then failed because a malicious Origin is rejected by the outer runtime with plain403 `Invalid Origin header`, while the fixture expected application JSON. An isolated actual Worker probe verified missing Origin JSON403/FORBIDDEN_ORIGIN versus malicious-Origin plain403; tests now distinguish both without relaxing protection. Preserve .local/m3f-cloudflare-api-first.log and second.log. Capacity/CAS/full browser cases remain unaccepted until the standard full run.

Static review found and fixed duplicated batch body/result-size bounds, missing Owner-creator binding/timestamp/audit-session consistency, and a missing comment audit-change witness guard. A second independent UI review found delayed old responses could erase a newer request journal for the same album/Guest. Root added metadata/operation compare-and-set to success, denial demotion, abandonment and async recovery; a real same-Guest two-command browser regression is being added. Unknown intents stay scoped across401/409, and browser storage contains only metadata/body hashes. NFC/Unicode trim is enforced by application Zod; trusted raw SQLite writers lack built-in NFC normalization. Public thread deletion gives tombstones; same-author/same-session historical exact command replay may return its immutable prior body, while own activity exposes only revision/state.

Next: complete standard full Worker/API/Chromium regression, final types/lint/build/format/docs checks and only then consider local0042 adoption after backup. Keep hosted flags OFF/local-only, deletion OFF/dry-run, no commit/push/deploy/customer writes. FullM1–M5 remains active; Owner comment work, annotations, full history/delivery/retention/hosted acceptance remain required.

## 2026-10-27 — M3f1 invitation-shared version comments underway

M3e is accepted locally (228 Worker checks); M3f1 is not yet accepted. Root froze strict comment contracts, default-OFF/hard-local GUEST_COMMENTS_ENABLED and HTTP routes;25 new contract/gate unit tests passed.0042 schema/service, actual UI, same-invitation/different-invitation authorization and browser recovery tests are under parallel implementation. No0042 application or hosted acceptance. See docs/GUEST_COMMENTS.md. FullM1–M5 remains active, including independent annotations and later Owner/history/delivery/retention work. Preserve current dirty worktree and all previous accepted evidence.

## M3e current task state

- [x] Guest published-version history and three comparison modes with independent view/compare rights, current-version pinning, live private-asset authorization and unpublished-draft protection;228 local Worker checks plus288 unit tests/types/lint/build passed.
- [ ] Version-bound comments and annotations: share comments only within the same invitation; isolate other invitations. Add migration/recovery, service/API/UI and real authorization/browser tests.
- [ ] Owner comparison, full history/downloads, indexed matching/rules/batch, delivery/notifications, retention and hosted acceptance remain open.

## 2026-10-27 — M3e Guest published version comparison accepted locally

This supersedes the pending M3e checkpoints below. Guest Lightbox now provides published version history, slider, side-by-side and overlay comparison with synchronized zoom/pan, keyboard controls, preserved image proportions and explicit size/aspect warnings. Current version metadata remains pinned even outside the24-item history page. Authorization requires independent can_view + can_compare_versions, never can_select. Ready unpublished drafts are excluded from history AND direct Guest derivative requests; current/baselineV1/immutably published versions remain eligible. Every metadata/byte request rechecks live session, invitation, Owner and active parent scope.

Actual final evidence:228 local workerd/D1/R2/Chromium checks passed (session21352, .local/m3e-cloudflare-seventh.log, exit0);288 unit tests/37files, full generated strict typecheck, lint, Next production build and targeted Prettier passed.375px comparison screenshot apps/worker/.local/guest-version-comparison-mobile.png was visually inspected. New tests use actual local R2 originals and Sharp derivatives,27 published versions plus an unpublished ready draft, a restored V1 outside page one, portrait V2 and a neighboring photo. They cover strict/head-bound pagination, safe metadata, independent permissions, unpublished-byte denial, readonly ledgers, keyboard/focus and live revocation. Reference integration/E2E were not rerun for M3e; their prior61/14 passes remain historical baseline. Hosted Google/GitHub/R2 CORS/edge, real cloud quotas and deployment remain not_checked.

Earlier failures remain in first–sixth logs. Actual fixes include access-envelope parsing, upload-session metadata joins that do not confuse init/completion request IDs, nullable head typing, and capturing range values before deferred React state updates. Sixth run passed new API/browser checks but failed later while an old exchange test held four unconsumed Response handles. It now issues and validates each denial sequentially with all original assertions; seventh full run passed. The underlying transport/body-consumption cause is not proven and no production login fix is claimed. Intentional TEST_* audit-trigger exceptions in the passing suite are asserted rollback injections.

No new schema/migration or persistent development/customer data changes in M3e;0041 remains latest locally applied. No commit, push, remote resource or deployment. GUEST_VERSION_COMPARISON_ENABLED remains false in all Wrangler environments and rejects non-local enablement. Automatic deletion stays OFF/dry-run. Recovery: disable comparison, retain immutable assets/versions/publication witnesses/audit and preserve the stricter asset ACL; repair forward. See docs/GUEST_VERSION_COMPARISON.md.

Next task: version-bound comments/annotations with independent rights, same-invitation comment sharing and different-invitation isolation, delivered through schema/service/API/UI/tests/docs. Owner comparison/history, canonical indexed matching/rules/batch, delivery/notifications, retention planning/confirmation/retry, production processing/roles/multi-node and hosted acceptance remain required. FullM1–M5 stays active. Next operator: run `python tools/check_handoff.py`, then read the comparison contract and latest TASKS before starting the comment schema. Preserve the dirty codex/kino-pic-foundation worktree (base b14d505); do not assume untracked files are committed.

## 2026-10-27 — M3e comparison runtime verified; full regression pending

Guest published history and Lightbox slider/side-by-side/overlay are implemented behind default-OFF/hard-local GUEST_VERSION_COMPARISON_ENABLED. Both can_view and can_compare_versions are required independently of selection. Current/baselineV1/immutably published ready versions are eligible; never-published drafts remain inaccessible through both history and direct asset URLs. The current version is pinned outside DESC24 pages; each request rechecks live authorization.

Latest actual checks: full generated typecheck, lint,288 unit tests/37files and Next production build passed. Sixth local Worker run passed all new version API cases and375px Chromium comparison, including real private R2/Sharp derivatives, portrait/landscape letterboxing, keyboard ranges, synchronized transforms, readonly ledgers and live revocation. Screenshot apps/worker/.local/guest-version-comparison-mobile.png was inspected. The full run then failed in the existing Guest exchange denial fixture with Body is unusable: Body has already been read; its diagnosis/full rerun remains pending. This is not final full-suite acceptance.

Fixed actual integration defects: access response envelope, upload-init versus completion request-ID join, nullable head typing, and deferred React range event access. Earlier failed runs remain in .local/m3e-cloudflare-first.log through sixth.log; do not overwrite their evidence. No schema/migration, persistent data operation, commit, push or deployment in M3e.0041 remains latest locally applied; hosted OAuth/R2/CORS/edge acceptance is not_checked. Automatic deletion stays OFF/dry-run. FullM1–M5 remains active.

Next: diagnose the Guest exchange fixture, rerun the full local Worker suite, finalize comparison docs/portability checks, then implement version-bound comments and annotations with same-invitation sharing and different-invitation isolation. Large-album indexed matching/batch, Owner comparison/history, delivery/notifications, retention and hosted acceptance remain required.

## M3e Guest published version history/comparison underway

Current source adds default-OFF/hard-local GUEST_VERSION_COMPARISON_ENABLED, requiring Guest exchange and photo-version supporting gates. Guest history/API/UI requires independent can_view + can_compare_versions, not can_select. Metadata and every private image recheck current session/invite/Owner/parent ACL. Current version, baselineV1 and versions with immutable successful head-publication history are eligible; ready never-selected drafts are excluded from history and direct generic Guest asset fetch. No schema/migration or persistent data change in this read-only slice;0041 remains latest locally applied.

Contracts/backend/Lightbox UI are integrated, including a pinned ready currentVersion outside DESC24 history pages, head-bound cursors, safe role/labels metadata, slider/side-by-side/overlay, synchronized zoom/pan, letterbox and parent keyboard focus handling.288 unit tests/37files passed. Root initial full type/lint found and fixed nullable head-anchor typing and a displaced use-client directive; focused/root strict checks now pass. API fixtures create actual R2 originals/Sharp derivatives,27 published versions plus an unpublished ready draft and a neighboring photo. V2 is portrait24x48 versus V1 landscape48x24. New API/browser tests are being integrated; no final acceptance/hosted comparison claim yet. Do not mark fullM1–M5 complete. Next run full local Cloudflare regression, then final types/lint/build/docs. Same-invitation comment sharing and other-invitation isolation remain required future work.

## 2026-10-27 — Resolved upload delivery

- [x] M3c2b2 single-file vertical: mode-gated preview, explicit Auto/Assisted choice, atomic watermark/configuration/head guard in existing command namespace, real private R2 completion, raw-dimension review and held quota, durable journal/exact recovery through mode changes.220 Worker,260 unit,61 integration,14 reference browser plus strict/lint/build passed;0041 applied locally after backup.
- [ ] Complete canonical indexed lookup for large albums, persisted opt-in case/JPG-JPEG/suffix rules and multi-file batch decisions. Current safe completeness cap1000 includes versions and pending uploads; no unsupported controls advertised.
- [ ] Guest version history and comparison slider/side-by-side/overlay with independent can_compare_versions authorization and version-bound comments/annotations.
- [ ] Full Owner history/downloads, delivery/notifications, production image processing, retention planner/confirmation/retry, roles/multi-node and hosted deployment/backup acceptance. FullM1–M5 remains active.

Matching stays OFF/hard-local in shipped settings; deletion OFF/dry-run. Different invitations remain isolated for comments; same invitation sharing is confirmed.

## M3c2b2 resolved upload vertical slice underway

0041 is active source but NOT applied persistently. Root added strict atomic expected-watermark/project-mode guards and resolution raw-dimension completion backstop, retaining old command namespace/quota/CAS/replay checks. Existing upload_requests payloads now capture resolution and optional immutable versionTarget; no new Owner ledger. New default-OFF/hard-local PHOTO_VERSION_MATCHING_ENABLED controls preview/reservation routes, configuration modes and Owner uploader. Contracts/backend/UI/journal/API/browser tests are integrated in source.259 unit tests/35files passed;41 migrations passed an isolated empty workerd/D1 syntax/FK probe. No final M3c2b2 acceptance or deployment yet.

Run19503 failed at the new origin test incorrectly expecting JSON from the existing plain-text403 middleware. Fixture corrected without weakening origin checks. Type generation exposed a too-narrow literalfalse field; WorkerEnv now omits that generated matching flag and validates its string at runtime, while production enablement is still rejected. Two unused fixture imports/helpers were removed. Run90447 passed all new HTTP/D1 cases (default-OFF, canonical replay, current ACL, race/stale/pending/audit rollback, real PNG V1→V2, explicit assisted choice/foreign-head denial, dimension mismatch review/quota preservation), then browser stopped at an assertion expecting internal versionTarget in the public request instead of choice. The test is being corrected to check server-derived canonical D1 payload.

Root found a real recovery UI gap: mode auto/assisted→Manual/Off could hide an accepted pending resolved journal. Root now mounts the uploader regardless of current mode; UI agent is adding modeActive to hide only fresh matching controls while retaining existing intent recovery. Browser acceptance is being extended to change mode after a lost accepted reservation, reload/reselect/exact replay, then restore Auto for V2. Source changes require a fresh full run. Do not claim the second run passed or apply0041 yet. Final strict/full lint and Next build remain required. Hosted flags and automatic deletion stay OFF/dry-run. FullM1–M5 remains active.

## 2026-10-27 — M3c2b integration checkpoint

- [x] M3c2b1:0040 internal candidate watermarks, same-snapshot pending uploads, rollback/retry/immutability and lifecycle coverage.209 Worker and212 unit tests, strict types/lint passed; applied locally only with backup.
- [ ] M3c2b2: actual resolved reservation/API/UI. Bind explicit choice and expected watermark/configuration/head to the existing immutable upload command where feasible; atomically reject stale/new conflicting intents while current-authorized exact retries retain their original target.
- [ ] Prove simultaneous same-name first uploads and unknown-result recovery, then expose confirmed automatic/assisted settings with usable upload/batch UI. Complete indexed candidate lookup and persisted opt-in matching rules.
- [ ] Continue Guest version comparisons, same-invitation comments/isolated other invites, version-bound annotations, full history, delivery/notifications/retention, multi-node and hosted acceptance. FullM1–M5 remains unfinished.

## 2026-10-27 — M3c2 continuation

- [x] M3c2a: real scoped D1 candidate snapshot/internal classifier;204 local Worker checks,211 unit tests, strict types and lint passed. See latest HANDOFF for evidence/limits.
- [ ] M3c2b: immutable resolution/explicit assisted choice plus reservation-time candidate/head/configuration revalidation; handle simultaneous first uploads of the same canonical name and exact retry without using metadata revisions as a content epoch.
- [ ] Complete the automatic/assisted API, persisted opt-in rules, scalable complete candidate lookup and Owner confirmation/recovery UI; enable modes only after full runtime/browser acceptance.
- [ ] Continue Guest version history/comparison, comments/annotations, full history, delivery/notifications/retention, multi-node routing and hosted acceptance. FullM1–M5 is not complete.

No new migration or deployment; automatic deletion remains OFF/dry-run. Same-invitation comment visibility is authorized; different invitations remain isolated.

## 2026-10-27 — M3d durable external-effect intents accepted locally

This supersedes pending M3d checkpoints below. The old defect was reproduced in isolated workerd/D1/R2: a colliding project-mode UUID returned409 but left one R2 fence and local certificate with quota held. The fixed probe now rejects that collision before any R2/local-certificate write. The same probe also passes claim-audit rollback, unknown committed R2 result with no guessed certificate, final-audit rollback/exact retry, safe expiry of pending failed cancellation, deterministic competing D1 insertion between claim and R2, uppercase UUID compatibility, and adapter-identity mismatch denial while preserving MULTI_NODE_DISABLED.

Final full run58288 (.local/m3d-cloudflare-fourth.log) terminated successfully:198 local workerd/D1/R2/Chromium checks passed. New runtime cases cover namespace collisions in both directions, current Owner denial, exact UUID coalescing, distinct UUID same-target receipts with one finalizer/release, lost post-fence result, audit failure/expiry recovery, immutable claim snapshots, processing output-key certificates, processing lost physical result and forged-key certificate rollback before exact recovery. The prior full runs188/198 also passed; the final run includes the adapter node binding correction.202 unit tests/32files, final strict Worker/shared/Web types (55113), full lint (70534), targeted formatting and diff checks passed. Worker builds ran in the suite. Reference integration/E2E and Next production build were not rerun for this Worker-only slice; hosted OAuth/R2/CORS/edge remains not_checked.

0039 applied ONLY to local development D1:26 commands, after ignored backup apps/worker/.local/d1-before-0039-20261027.sql (392650bytes). Follow-up has no pending migrations, foreign_key_check empty, receipt table and claim audit events empty. Upgrade tests compare every prior table snapshot; no legacy ledger/alias/audit backfill or rewrite. No remote/customer migration, deploy, commit or push. All hosted feature flags remain OFF/hard-local; automatic deletion OFF/dry-run.

Architecture: owner_external_intents fixes actor/request/op/payload/scope/node/immutable keys/epoch before external effects. Existing D1 ledgers remain namespace witnesses; symmetric transactional guards cover every current Owner writer. Receipts are append-only attempt identities, not resource locks: multiple UUIDs may target one immutable key, while idempotent fences and existing finalizer guards enforce one state/quota transition. System expiry still resolves a physically fenced pending cancellation safely; it is not blocked forever by a receipt. Processing certificates now bind each declared physical observation to the captured output key. Existing completed operations replay without fabricating a new claim. R2 adapters declare storageNodeId; cancellation checks it and authorized expiry only inspects that adapter's node. This does not enable multiple accounts.

Recovery: stop serving cancel/abandon mutations before application rollback; retain claim-compatible handlers, receipts, physical fences, certificates and audit, then repair forward. Do not downgrade to pre-0039 R2 handlers merely because flags are OFF: old cleanup endpoints may still be callable. Never clear receipts/held quota to hide an unknown result. Restore backups only into an isolated verified recovery copy. Any new Owner writer must participate in the namespace guards before activation. Production contains no interleave/drop-result test hooks; those live only in the storage-test entry.

Next: wire the scoped deterministic matcher into automatic/assisted upload resolution with usable confirmation and recovery, then Guest version history/comparison. FullM1–M5 remains active; comments/annotations, full Owner history, delivery/notifications/retention, multi-node routing and hosted deployment/acceptance remain required. Different invitations remain isolated for comments; same-invitation sharing is the confirmed user decision.

## M3d external-effect intent claims underway

Read docs/OWNER_INTENT_CLAIMS.md. M3c1 remains accepted locally (188checks); fullM1–M5 stays active. Root selected external-only immutable claims plus symmetric transactional guards on all legacy Owner writers, retaining old ledgers/intentional aliases without risky backfill.0039 SQL, store and namespace inventory are isolated drafts; no active migration or persistent application. Root owns cancellation/review integration and deterministic R2-interleaving verification. Claim must commit before storage effects; unknown effects retain claim/quota; default-OFF/hard-local/deletion-dry-run safeguards stay intact.

## 2026-10-27 — M3c1 project version configuration accepted locally

This supersedes pending M3c1 checkpoints below. Run36156 (.local/m3c-cloudflare-fourth.log) terminated successfully:188 local workerd/D1/R2/Chromium checks passed. New acceptance covers local/default-OFF capability, confirmed Off/Manual settings, shared project CAS with rename, no-op/history replay/current-state reconciliation, strict body/origin/actor, audit-failure full rollback and exact retry, symmetric request-ID conflicts, immutable command/results, provenance clone/predecessor denial, disabled/expired Owner and archived-project replay denial, and375px confirmation cancellation/stale-conflict refresh/lost200 exact retry followed by a fresh current read. Existing M3a/M3b and other regressions passed in the same run.

202 unit tests/32files, strict Worker/shared/Web types (24608), full lint (65362), Next production build (73127), focused formatting and git diff checks passed.14 of the new unit cases exercise the pure matcher: exact scope, NFC/trim/UTF-16 bounds, opt-in suffix/JPG-JPEG/case rules, logical-photo ambiguity, duplicate hashes, truncation and oriented aspect/scale review. This classifier is not yet wired to an adapter/API/upload flow. Only Off/Manual settings are available; automatic/assisted modes remain unavailable. Reference integration/E2E were not rerun for this slice; previous M3b reference integration61 remains a baseline, not new hosted evidence.

0038 applied ONLY to local development D1:33 commands, after backup apps/worker/.local/d1-before-0038-20261027.sql (git-ignored,372860bytes). Follow-up migration list has none pending; foreign_key_check is empty; new command/result tables and existing-project provenance pointers are empty/null. Recovery disables configuration writes, preserves mode provenance/commands/results/audit and repairs forward; restore backups only into an isolated verified recovery copy. No remote/customer migration, deploy, commit or push. All feature gates remain OFF/hard-local; deletion OFF/dry-run.

The expiry test uses a separately issued synthetic OAuth session and preserves its revocation audit; it never recreates an old signed-in session or bypasses append-only guards. Historical intermediate test failures are retained below as evidence, not current acceptance status.

Required next work: docs/OWNER_INTENT_CLAIMS.md describes the confirmed existing cancellation/abandonment ordering risk. Implement durable actor/request claims before R2 effects and prove collisions/races/unknown outcomes without premature quota release; expanding a read-only preflight is insufficient. Then integrate scoped automatic/assisted filename resolution and Guest version comparison. Hosted OAuth/R2/CORS/edge and the full M1–M5 goal remain incomplete. Comments/annotations, complete history, delivery/notifications/retention and deployment gates remain required.

## 2026-10-27 — M3c integration and external-effect intent risk

M3c config contracts/capability,0038 SQL, service/routes and Owner UI are in active source behind default-OFF/hard-local gates.202 unit tests and final strict types passed; full lint passed. Isolated Miniflare D1 proves populated preservation, change/no-op/replay, CAS race, failed-audit rollback/exact retry, immutable history and provenance-clone denial. No0038 persistent migration or final M3c acceptance yet.

Full run99197 stopped because a CSRF test incorrectly parsed the existing outer middleware's plain-text403 as JSON; it now verifies403 and retained state. Run85751 then passed basic APIs and audit rollback/rename-CAS/namespace/immutability, but expired the main fixture session and attempted to recreate it, correctly hitting APPEND_ONLY_AUDIT for the old sign-in event. The expiry fixture is being changed to a separate signed synthetic OAuth session; never bypass/drop the audit guards or recreate a revoked session ID. No suite is currently live; next launch follows the frozen fixture fix.

Source review identified an existing actor-scoped external-effect ordering risk in uploads.cancel and processing-review.abandon: R2 fences precede final command insert; a cross-ledger request-ID conflict can leave a fence and held quota without finalizing the command. This does not expose/delete another tenant's photos. Read-only preflight cannot close the concurrent claim gap. Before hosted activation, implement a durable actor/request intent claim (fixed operation/payload/target, current authority, all Owner writers) before R2 effects, and test deterministic collision, concurrent claim, lost R2/DB result and recovery. Do not claim this risk fixed by0038's D1 namespace triggers. Source ordering was reviewed; this specific R2 collision has not yet been fault-injected at runtime.

FullM1–M5 remains active. Keep flagsOFF/deletionOFF/dry-run; no deployment/customer data/commit/push. After M3c1 acceptance, prioritize durable external-effect intent claims, then wire the scoped matcher/auto-assisted upload resolver and Guest comparisons. The pure matcher14 focused cases passed but is not an API/product feature yet.

## M3c implementation underway

Read docs/PROJECT_VERSIONING.md. M3b remains accepted locally (179checks); fullM1–M5 stays active. Root added strict mode configuration contracts and default-OFF/hard-local capability;14 focused tests passed. SQL/service drafts are isolated under .local/m3c-draft, no0038 application or runtime acceptance. Parallel work owns configuration backend, confirmation/recovery UI and deterministic filename matcher. Only off/manual configuration will be available until automatic/assisted matching is actually integrated. Existing versions/head/selection/audit must be preserved.

## 2026-10-27 — M3b manual version uploads accepted locally

This supersedes the pending M3b checkpoints below. Full run30293 (.local/m3b-api-eighth.log) terminated successfully:179 local workerd/D1/R2/Chromium checks passed. New cases prove fixed immutable reservation targets, current Owner/tenant/photo authorization before replay, head/mode-shift preservation, private same-photo versions, unique concurrent numbering, canonical audit/results, audit-failure rollback with exact retry, quota accounting, cancellation fences, stale new-init CAS denial, default-OFF bypass denial, immutable target/completion primary/alternate/null/UPDATE/DELETE defenses, and375px explicit replacement/file selection/SigV4-checked local R2 upload/lost-completion/reload/reselect recovery with the V1 head unchanged. Existing M3a current-head and other feature regressions passed in the same run.

Also passed:174 unit tests/30 files,61 reference integration/10 files, strict Worker/shared/Web typechecks, final full lint (48177), Next production build, targeted format and git diff checks.38-file documentation presence check passed. Reference-app Playwright was not rerun in this session; Worker-target Chromium is included in179 checks. Hosted OAuth, real R2 CORS/S3/edge and deployment are not verified. The browser R2 bridge uses synthetic credentials and local Miniflare storage.

0037 applied ONLY to local development D1:34 commands. Follow-up migration list has none pending; foreign_key_check returned empty; new targets/completions are empty. Pre-migration backup is apps/worker/.local/d1-before-0037-20261027.sql (git-ignored). No remote/customer migration, commit, push or deployment. Keep all feature flags OFF/hard-local and automatic deletion OFF/dry-run.

Recovery: disable version writes and keep immutable targets, completion ledgers, assets, processing jobs and audit. Repair forward with a new migration. Restore the local backup only into a verified isolated recovery copy; do not drop0037 tables beneath code whose generic upload queries now reference both completion ledgers. Do not remove history to roll back application behavior.

Full M1–M5 remains active. Next required slices: project version-mode controls and enabled filename/assisted matching, Guest scoped version history/comparison slider/side-by-side/overlay, followed by comments/annotations, full operation history, delivery/notifications/retention and hosted acceptance. Same-invitation comments may be shared; different invitations remain isolated. Completion still leaves the original current head; exposing a ready version requires a separate explicit CAS switch.

## 2026-10-27 — M3b security probes passed; browser final assertions rerun

Run27180 (.local/m3b-api-seventh.log) passed all new version API cases, including head/mode-shift frozen targets, concurrent unique version allocation, injected photo.version.created audit rollback/same-ID retry, immutable target/completion update/delete/null/primary/alternate REPLACE guards and disabled-Owner replay denial. Chromium reached file selection, explicit replacement confirmation, signed local R2 upload, lost successful completion response and reload/reselect/exact completion replay; the helper then failed its final D1 check because its fixture return and assertion call omitted photoId. Those two fixture properties are restored, with targeted lint/format passing. No product guard was relaxed.

Run30293 is LIVE at .local/m3b-api-eighth.log; poll before launching a duplicate. Full M3b acceptance, final browser D1 assertions and remaining M3a regression checks are pending.174 unit,61 reference integration, strict types, UI lint, full lint and Next build previously passed in this session.0037 remains unapplied persistently; flags remain OFF and deletion dry-run. No remote deployment or customer data changes. Full M1–M5 remains active.

## 2026-10-27 — M3b V2 runtime evidence; final regression in progress

Run21660 (.local/m3b-api-sixth.log) passed canonical V1 API setup, upload-disabled bypass denial, V2 fixed target/recovery/exact init replay, wrong-photo/tenant isolation, and real local R2 V2 completion with immutable private version/audit and unchanged head. It then failed a test that compared the richer recovery response to the init response. The expected shape now verifies the exact recovery metadata, authorization and original target/session; no authorization requirement changed.

Additional fixes from integration review: version uploader accepts the existing UPLOAD_OBJECT_NOT_FOUND409 before PUT; it had incorrectly expected404. The completion success notice now lives in the parent panel so list refresh cannot discard it. The Chromium fixture uses the canonical V1 authorization and joins upload_specs for MIME/hash. Browser expectations mirror these contracts. Latest Web strict typecheck and targeted UI lint passed. Full strict types, Next build,174 unit and61 reference integration passed earlier in this session.

Run27180 is LIVE at .local/m3b-api-seventh.log. Poll that handle before starting another full suite. It includes V2 audit rollback/same-ID retry, stale new-init CAS, target/completion UPDATE/DELETE/REPLACE/null guards and375px file upload/lost-completion/reload recovery via a synthetic SigV4-checked Miniflare R2 bridge. No final browser or full M3b acceptance is claimed until terminal results are inspected.0037 is not applied persistently; no remote/customer data, commit, push or deployment. All flags OFF/dry-run. Full M1–M5 remains active.

## 2026-10-27 — M3b API contract and manual intent UI

Current verification:174 unit tests/30 files and61 reference integration tests/10 files passed. Full lint passed after removing an unused fixture variable and an unused UI suppression. Web strict typecheck and targeted UI lint passed after the flat completion-response fix and manual intent selector. Documentation checker verified38 files; this is presence only.

The Owner uploader now explicitly offers new_retouch or replace_current in enabled modes. Off mode forces replace_current; any replacement requires confirmation. Both preserve immutable history and leave the current head unchanged until a separate ready-version CAS switch. These new UI paths still require Chromium acceptance.

Fifth full local Worker run4554 terminated at .local/m3b-api-fifth.log: existing Guest history and the canonical public V1 setup passed, then new version reservation returned200 where creation expects201. The version init router now returns201 consistently with ordinary creation; no security assertion was relaxed. The next full run is pending expanded V2 rollback/integrity/stale-CAS tests and a self-contained browser fixture.0037 is not applied persistently. Hosted OAuth/R2/edge, deployment and full M1–M5 remain incomplete; flags remain OFF and retention dry-run.

## 2026-10-27 — M3b regression and completion response correction

Current source includes the manual version upload router/service/migration and Owner UI behind default-OFF local-only gates. The UI now parses the dedicated completion endpoint's flat versionUploadCompletionSchema response, matching the API rather than an invented completion envelope. Browser verification is being added; do not claim acceptance yet.

Run .local/m3b-api-third.log terminated at a missing fixture-helper import. All five consumers now import the canonical authorized-version fixture; targeted ESLint, node syntax and formatting checks passed. Fourth run .local/m3b-api-fourth.log advanced through Guest history and version capabilities, then terminated at its new ordinary-V1 setup: the test PUT/completed without first authorizing the upload and received INVALID_STATE_TRANSITION. Repair the fixture with the normal authorization call; preserve the guard. No full M3b pass is claimed. Earlier full unit run:174 tests; latest pre-response-fix web typecheck passed. Post-response-fix typecheck log .local/m3b-web-types-response.log shows successful type generation, but the interrupted process handle is missing, so terminal exit is not proven and must be rerun.

0037 remains unapplied to persistent local/remote D1. All deletion flags remain OFF/dry-run. No hosted test, deployment, commit, push or customer data change. Next: canonical V1 setup, complete full HTTP/R2 regression, integrate isolated Chromium file-upload/recovery checks, then integrity/rollback gaps and final checks. Full M1–M5 remains active.

## 2026-10-27 — M3b UI promotion and regression fixture compatibility

The live Owner version panel now mounts the promoted version uploader with full project/album/photo context and OR-combined switch/upload pending gates. Upload completion refreshes only the version list, never the current head or gallery. New uploader context is omitted for archived/noneditable parents. Web strict typecheck passed after promotion;174 unit tests/30files passed (.local/m3b-unit-first.log). HTTP/browser upload acceptance is still pending.

Sessions10421 and22558 are terminal.10421 stopped at unused Node imports of Worker classes with unsupported strip-only parameter properties; those imports were removed.22558 stopped at another legacy direct-V2 metadata fixture, before the new API helper. A shared authorized SQL fixture helper and affected Guest selection/feedback/history/shared-review fixtures are being updated without bypassing0037. No runtime suite is currently live. The version-upload API helper is frozen with mode/head replay, private sibling completion, concurrent numbering, cancellation fencing/quota and Owner-disable cases; wait for legacy fixture updates before rerun.

0037 is active source but NOT applied persistently. No remote/customer data, deploy, commit or push. Full M1–M5 remains active.

## M3b first integrated HTTP/R2 run live

The version-upload API helper is now wired before the current-head regression helper. Session10421 is live at .local/m3b-api-first.log; poll it before any duplicate run. It exercises isolated manual-project V1/V2 public API flow, local Miniflare R2 fixture objects, scoped recovery, feature-gate bypass denial, target isolation, private completion/audit and quota conversion. These results are pending; do not infer remote R2 or production E2E.

M3a fixture versions2–27 now use authorized version uploads; only V2 is processed and the other siblings stay queued for readiness checks. Direct V1 and neighbor V1 seed setup remains. Existing immutable/scope/dimension guards retain priority, and valid V2 still requires its upload workflow. The isolated SQL behavior probe passed after this adjustment. Draft UI and journal validations passed focused5 journal tests, strict TS/lint/format, but UI is not mounted and has no browser acceptance yet.0037 remains unapplied to persistent local/remote D1.

## M3b active integration and first regression feedback

Reviewed0037 SQL, common upload service and strict version router are now integrated into active source behind all default-OFF local gates; current TypeScript check passed. Original service backup is .local/m3b-draft/live-uploads-before-integration.ts.0037 is in active migrations but is NOT applied to persistent local/remote D1. The dedicated HTTP/R2 helper is being written; existing full regression run75668 stopped at guard-priority compatibility before version API cases.

The new valid-V2 workflow gate masked established invalid scope/dimension/identity errors. Its WHEN filter now delegates malformed basic records to the existing0011/0012/0033 guards, retaining the upload-workflow requirement for valid new V2. Isolated behavioral probe passed again after this change. The probe was pinned to baseline0001–0036 after promotion to avoid accidentally applying0037 twice. Old M3a V2 fixtures are being changed to authorized version uploads rather than bypassing the new guard; initial non-current versions will be captured-parent siblings and queued targets remain unready. No security assertions are removed.

Journal module/tests passed focused5 cases; draft UI remains unwired. M3b HTTP/R2/processing/browser/full regression acceptance remains pending. Full M1–M5 stays active; no deployment or new persistent migration.

## M3b reviewed service/routes and isolated D1 checkpoint

Root virtual TypeScript validation passes for the frozen common upload service plus isolated version-upload router at their intended source paths, without replacing live code. Init replay/post-insert and completion replay/post-insert now read results and current Owner/active photo/parent scope in the same SQL query. Root also scoped target-type detection to current Owner/session before feature-gate errors and bound dedicated completion's route photo to the immutable target.

Root tightened SQL completion timestamp to its workflow witness and required exact canonical completion result JSON (including status/field set); a fresh isolated Miniflare D1 probe applied baseline0001–0036 plus draft0037, found both new tables and no FK violations. Probe setup initially needed Worker-scoped dependency resolution, the repository's v5 compatibility adapter and existing SQL normalization; these were corrected. This proves DDL application only. Separate behavioral probe has passed atomic V2 reservation and exact init replay with no new photo/head changes; completion/V1 parity/denials remain under test.

The version-aware browser journal is being implemented as a distinct module, with structured-field privacy and full Owner/workspace/project/album/photo scope; legitimate user notes/URLs/hash filenames must remain valid. UI and API drafts remain unwired, no0037 persistent migration or deployment. Full M1–M5 stays active.

## M3b fixed-target recovery and draft review checkpoint

Strict versionUploadRecoverySchema is implemented with legacy recovery fields plus immutable target metadata; it rejects storage paths, signed URLs, session identifiers and unknown fields.23 focused contract/config tests passed. Three scoped workers own isolated SQL, common upload service, and single-photo upload UI drafts under .local/m3b-draft; none is wired into live routes. SQL captures the reservation-time project mode from D1, and old exact init retries must recover the same target despite later head/mode changes after current ACL passes. Remaining completion-aware cancel/expiry/archive/accounting paths and runtime probes are still pending. No M3b migration is applied or feature enabled; M3a remains locally accepted.

## M3b version upload implementation underway

Read docs/VERSION_UPLOADS.md. SQL and service drafts are isolated in .local/m3b-draft; contracts are implemented but not exported into API routes. Root capability helper requires direct-upload/current-version/version-upload flags together and hard local-only activation;22 focused contract/config tests passed. Target photo/parent/intent metadata is fixed at reservation, completion must preserve photo_id and allocate an immutable next version without switching the head. Both completion ledgers must be recognized by recovery/cancel/expiry/archive/quota paths. No M3b runtime acceptance or migration application yet; M3a remains accepted locally and full M1–M5 stays active.

## M3a current-version switching — accepted locally

This supersedes earlier pending M3a checkpoints below; historical notes are preserved.167 full local workerd/D1/R2/Chromium checks passed in run89861 (.local/m3a-cloudflare-seventh.log), including real ready V2 processing, unique-winner CAS, no-op/exact replay, current/restore galleries, independent Guest old-version comparison ACL, audit rollback, immutable head/command/result/alternate/null/predecessor defenses, Owner confirmation/cancel, lost committed response/retry401, historical replay followed by fresh state, and pre-commit drop followed by definitive409 reconciliation. The375px screenshot apps/worker/.local/photo-version-heads-mobile.png was visually inspected.

160 unit tests/29files (including isolated M3b contracts/config),61 integration/10files,14 reference Chromium (29.1s), final generated Worker/web strict types, lint and Next build passed.0036 applied to local development D1 only (33 commands); follow-up list has no pending migrations. Keep feature flags OFF/hard-local and deletion OFF/dry-run. No remote/customer data, deploy, commit or push. Recovery: disable version writes, retain immutable versions/assets/heads/commands/results/audit, and repair forward.

Only existing-version history/current-head switching is accepted here. Actual new-version upload, metadata capture, mode-controlled matching, Guest version browsing/comparison slider/side-by-side/overlay, delivery and retention remain required. M3b upload SQL is an isolated draft under .local/m3b-draft and its new contracts are not exported/wired to APIs; its feature flag staysfalse. Different invitations remain isolated for comments; same-invitation sharing is the user's confirmed decision. Full M1–M5 and hosted acceptance remain incomplete.

## M3a browser response synchronization; isolated M3b preparation

Sixth run96001 passed version API/integrity and progressed through actual Owner switching/lost-response retries, then failed because the helper asserted replay status before the response completed (request-start record still had status0). Root added explicit completed-status polling for replay200 and definitive-conflict409, preserving all original result/body assertions. Seventh run89861 is live at .local/m3a-cloudflare-seventh.log; poll it before a duplicate run. Mobile screenshot apps/worker/.local/photo-version-heads-mobile.png was inspected; synthetic preview and version panel fit the viewport without horizontal overflow. Final runtime acceptance remains pending.

In parallel, M3b SQL is being drafted only under .local/m3b-draft (not active migrations); strict new upload contracts/tests are separate new files and are not exported into current APIs yet. Root added PHOTO_VERSION_UPLOADS_ENABLED defaultfalse/hard-local;7 focused config tests passed. This does not implement or enable manual V2 upload. No persistent0036/0037 migration or hosted deployment.

## M3a corrected Owner browser run live

UI and browser files are frozen after the definitive-conflict and direct-project-navigation corrections. Focused web typecheck, scoped lint/format and Node syntax checks passed. The browser helper now distinguishes a dropped request before Worker execution from a committed response lost in transit; it holds the fresh reconciliation GET to verify the navigation gate and confirms eventual release. Sixth full session96001 is live in .local/m3a-cloudflare-sixth.log. Poll it before starting another run. No final M3a acceptance or persistent0036 application yet.

## M3a definitive-conflict correction checkpoint

The Owner UI now recognizes only PHOTO_VERSION_REVISION_CONFLICT and PHOTO_VERSION_NOT_READY as definitive non-commit results after an ambiguous exact retry. It clears the intent, keeps the parent navigation gate during fresh-state reconciliation, and refreshes the gallery afterward. Other ambiguous codes retain the original intent. Web strict typecheck passed after this correction. Browser navigation and a pre-commit-drop/intervening-change regression remain in progress; no runtime suite is currently live. Last runtime84980 passed version API/integrity but failed the helper's project navigation. Wait for the updated browser helper freeze before launching another full run.

## M3a backend acceptance evidence; Owner browser corrections pending

Fifth full run84980 is terminal. Real ready-V2 processing, paged version metadata, CAS race/replay, Owner/Guest current and restored galleries, independent old-version comparison ACL, state/version/asset preservation, audit-failure rollback/exact retry, archived/foreign denial and direct immutable head/command/result/alternate/null/predecessor checks passed. The run then failed in the Owner browser helper because it started at the workspace homepage and searched for a project link that belongs on the workspace/projects page. The helper will navigate directly to the authenticated project route using its fixture project_id.

Independent review also found that an ambiguous request receiving definitive PHOTO_VERSION_REVISION_CONFLICT or PHOTO_VERSION_NOT_READY can remain locked forever. SQL exact replay precedes those checks, so those two codes prove that exact intent did not commit. UI correction and a pre-commit dropped-request/intervening-change regression are underway; committed lost200/retry401 must still retain intent. No final M3a browser acceptance or persistent0036 application is claimed. Log: .local/m3a-cloudflare-fifth.log. Full M1–M5 remains active.

## M3a ready-V2 evidence and gallery fixture order correction

Fourth run34588 reached and passed real V1/V2 processing, version24+3 pagination, no-op/replay, not-ready denial and two-concurrent-command CAS with exactly one200/one409. It then failed a gallery assertion because the test had restored V1 before expecting V2. Root moved the restore after V2 Owner/Guest gallery and comparison-right assertions and added both Owner/Guest V1 restoration reads. No production code or expected security boundary was weakened. Fifth run84980 is live at .local/m3a-cloudflare-fifth.log; poll it before rerun. Successful switching now has actual evidence, but remaining gallery/integrity/browser acceptance is not yet claimed.

## M3a runtime verification update

Root fixed the authenticated session fixture using /api/auth/get-session and exact D1 session ID/user/expiry. Third full run91193 then reached Owner capability assertions and failed because the helper omitted authentication; /api/v1 is correctly Owner-protected. Both OFF/ON capability checks now include Owner cookies and explicitly assert anonymous401. Fourth run34588 is live at .local/m3a-cloudflare-fourth.log; poll it before another run. These are fixture corrections; ready-V2/CAS acceptance remains unproven until that path runs.61 integration tests passed in run48063; full typecheck76265 and Next build13487 passed. Owner browser helper is now wired. No persistent0036 migration or hosted change.

## M3a interrupted-run recovery and runtime fixture correction

Root confirmed first run57801 was terminal before helper execution due an undefined cookies caller; caller now passes googleCookies. Second run6780 is also terminal: fixture incorrectly compared the signed Owner cookie string to owner_sessions.token, so no current session row was found. Correct fixture resolution through the authenticated session endpoint, then recheck exact session ID/user/expiry in D1. These failures do not validate or disprove ready-V2 switching; that path has not yet executed. Logs: .local/m3a-cloudflare-first.log and .local/m3a-cloudflare-second.log.

Full Worker/web typecheck76265 and Next build13487 passed. Owner browser helper is written and syntax/lint/format checked; it has not run. Isolated neighbor photo and immutable-guard tests are prepared. No active runtime suite remains at this checkpoint; await the corrected helper freeze before rerun. User's same-invitation comment visibility decision is recorded in DECISIONS/GUEST_ACCESS_AUDIT; different invitations remain isolated.

## Confirmed comment visibility decision — 2026-10-26

The user chose: Guests on the same invitation may read each other's comments; Guests on different invitations remain isolated. Treat invite_id as the discussion boundary in addition to workspace/project/album/photo scope. An Owner reply must target that exact invitation thread; possession of another invitation for the same project/photo grants no access to its comments. Do not merge Guest identities by nickname, email or shared photo. can_comment stays independent of can_view, selection and other permissions. This decision resolves earlier pending visibility notes; other comment lifecycle/status/retention details still need an explicit implementation contract and tests. No comments feature is implemented or enabled by this documentation update.

## M3a first runtime acceptance running

Backend0036 and head repository are frozen. Agent isolated real Miniflare/D1 probe passed V1 backfill/preservation, no-op/replay, stale/changed intent denial, head rollback/REPLACE rejection and FK integrity; successful ready-V2 switching is being verified by the main harness, not inferred from that probe. Root integrated TypeScript and full lint27752 passed; unit146/27files remains passed.

First full runtime session57801 is live at .local/m3a-cloudflare-first.log. The new helper creates an independent album/photo, processes real V1/V2 through the existing image pipeline, and exercises CAS/current galleries/Guest comparison rights/preservation/audit rollback. Poll this handle rather than starting a duplicate run. Direct immutable command/result/alternate/null/predecessor cases and the Owner browser helper are next after runtime feedback.0036 has not been persistently applied, all flags remain OFF, and manual V2 upload is still a required next vertical slice.

## M3a strict verification checkpoint

Root integrated TypeScript check now passes after correcting nullable unit fixture inference with the actual PhotoVersionItem contract type. Full unit suite passed146 tests/27files. Owner version test worker/caller is wired with explicit cookies; acceptance fixture will use a new synthetic album/photo and real processing pipeline, preserving the shared gallery fixture. Review requested safe-integer revision exhaustion rejection, explicit final version-page ordering, exact returned revision matching, and removal of an arbitrary96-item UI history cutoff. Scoped workers are completing those corrections and the runtime/browser helper. No full M3a runtime acceptance or persistent0036 application is claimed.

## M3a Owner integration checkpoint

Root connected PhotoVersionsPanel to the Owner Lightbox and added synchronous pending-operation guards on close/previous/next plus keyboard navigation. The panel must retain exact uncertain intent and report onPendingChange until the result is known; onCurrentChanged refreshes gallery only after successful reconciliation. Default-OFF panel leaves no empty visual block. Dedicated photo-versions-test Worker is wired with enabled flags for synthetic acceptance. The helper will receive existing Owner cookies explicitly; no shared fixture mutation is needed. Backend/service/0036 and UI remain in progress, so no full build or runtime acceptance is claimed for this checkpoint. Prior12 focused contract/config tests remain the current test evidence.

## M3a integration checkpoint

Root wired default-OFF Owner capability/list/set-current routes with strict UUID/query/body validation and Origin checks. Owner and Guest gallery SQL now reads the tenant/photo-scoped photo_version_heads record rather than hardcoded V1; Guest non-current derivatives additionally require can_compare_versions2048 alongside can_view. This code depends on the pending0036 migration and is not yet runtime accepted or applied to local D1. Scoped workers continue the migration/service, Owner panel and real D1 acceptance helper.12 focused contract/config tests passed (root-run); full type/runtime/browser verification remains pending. No manual V2 upload or comparison completion is claimed. Full M1–M5 stays active.

## M3a photo versions implementation underway

Read docs/PHOTO_VERSION_HEADS.md and PHOTO_VERSIONS.md. Existing uploads and gallery queries hardcode V1; immutable rows cannot safely act as mutable current-state. Scoped workers own new0036/head service, version contracts/tests, and Owner panel respectively; root owns existing integration. PHOTO_VERSIONS_ENABLED is defaultfalse/hard-local;7 config tests passed. No new version workflow or migration acceptance is claimed. Next complete atomic head switching and gallery/current/non-current access integration, then explicit manual V2 upload and comparisons. Full M1–M5 remains active; comment visibility decision is pending independently.

## M2p final local verification — supersedes earlier pending status

Final full Worker run54253 passed157 local checks (.local/m2p-cloudflare-lifecycle.log), including history API privacy/current ACL/cursor scope, three-page fixed lifetime, deleted-photo witnesses, real Chromium pagination and explicit lifecycle-event identity clearing.134 unit/25files,61 integration/10files,14 reference Chromium, final generated Worker/web strict typecheck, lint/format, Next build and36-file documentation checks passed.375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected.

0035 was applied to local development D1 only (4 commands), and follow-up migration list is empty. Existing history was preserved. Recovery is forward-only; disable history on application rollback and retain indexes/audit. All feature flags remain OFF/hard-local and retention deletion remains OFF/dry-run. No remote/customer data, deploy, commit or push occurred.

Limit: headless Chromium did not emit native blur/visibility on bringToFront or the isolated CDP probes. The passing browser test explicitly dispatches FocusEvent blur/focus and checks current-cookie/D1 reload plus old-data clearing. Native headed desktop tab delivery and hosted E2E remain not_checked. This does not complete the full product goal. Earlier status/failure notes below are retained as historical evidence, not the current acceptance status.

Next work: immutable explicit Owner photo versions with a separately audited CAS current-version pointer; current uploads/galleries hardcode V1. Add independent non-current Guest comparison authorization before V2 exposure. Comment visibility choice remains pending; do not broaden disclosure. Filename tombstones, full history/Owner views, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 goal stays active.

## M2p headless lifecycle validation boundary

Run13832 failed the real-tab transition assertion: after a second tab was opened, the first tab stayed visible/focused and no blur/visibility event arrived. Independent minimal Chromium probes reproduced events=[] / visible / hasFocus=true, including CDP focus-emulation and freeze/active probes. This is an observed headless behavior, not evidence that the application handler failed. The helper now explicitly dispatches browser FocusEvent blur/focus around the cookie switch and retains zero-old-rows/new-Guest-only assertions. It does NOT prove native desktop tab event delivery; that remains not_checked. No application safeguard or assertion was removed. Full rerun54253 is live in .local/m2p-cloudflare-lifecycle.log; poll it before another run. Final Next build93578 passed after the focus changes. Persistent0035 application remains pending.

## M2p cross-tab verification in progress

The focus/visibility fix is written: background transitions invalidate request generations, abort reads and clear the rendered snapshot; foreground reloads capabilities and page one with the current cookie. Manual refresh also invalidates older requests. Web strict typecheck and scoped formatting/lint checks passed. The real second-tab regression initially failed in run54594 because visibleGuest had zero events while the new test required one. Root added one valid favorite event to that synthetic Guest; no production logic or assertions were relaxed. Rerun13832 is live in .local/m2p-cloudflare-focus-fixed.log. Poll that handle before starting another suite. Do not claim final acceptance or apply0035 persistently until the result is known.

## Next comments slice — visibility decision pending

Read-only assessment found can_comment256 exists but comments have no migration/service/API/UI/tests. Requirements include individual/batch comments, replies, edit/delete history, Grid has-comments filter and Owner status review. User was asked whether default visibility is private Guest+photographer with explicit shared opt-in, or visible to all Guests on one invitation. Do not infer global/project visibility or merge Guest identities. Continue M2p verification independently; comment data/authorization design remains pending this decision.

## M2p follow-up security gate

Integrated Worker run50575 passed157 local checks including the actual Guest history Chromium helper, cursor privacy/three-page lifetime, and existing regressions (.local/m2p-cloudflare-browser.log). The375px screenshot apps/worker/.local/guest-history-mobile.png was visually inspected without horizontal overflow. This is not final slice acceptance: independent review found that an already-loaded history tab with no next page does not clear/revalidate after another tab changes the shared Guest cookie. Add blur/hidden invalidation and focus/visibility revalidation plus a one-page cross-tab browser regression before acceptance or persistent0035 application. Gallery entry requiring can_view is intentional because it appears within the gallery; standalone1024-only history passed independently. No hosted deployment, customer data or flags changed.

## M2p — Guest own-history implementation in progress

Current slice adds an independent can_view_own_history (1024) timeline. GUEST_HISTORY_ENABLED defaults OFF in all environments and rejects non-local activation. Root added capability/activity routes with strict query keys and duplicate rejection; backend, UI and acceptance helper are being implemented by scoped workers. This is NOT accepted end-to-end yet; no migration0035 has been applied and no hosted service has been changed.

The contract allowlists 14 own Guest selection/submission/rating/favorite/tag/shared-selection actions, exposes only projected before/after details, and excludes raw audit JSON, session/request IDs, storage data and other identities. Read scope derives from the current cookie and sealed invitation albums. Pagination must use signed scope/filter-bound cursors, recheck current authorization on every page, and exclude later appends with a snapshot watermark. Missing photos show a generic unavailable marker; retained safe filename tombstones remain a separate unfinished requirement.

Verified this pass: root independently ran13 focused Guest history contract/config tests, then the full134 unit tests in25 files; all passed. Documentation presence36files and diff whitespace checks passed. Integrated TypeScript rerun passed after the scopeHash refactor. First full local Worker run68699 failed at new history fixture setup with WORKSPACE_LIMIT_REACHED; earlier regressions including Guest tags browser passed, but history API acceptance was not reached. Correct the isolated fixture without weakening quota constraints, then rerun. A misplaced gallery client directive was corrected and its focused lint passed. Subsequent full lint and61 integration tests in10files passed; current integrated TypeScript also passed. Second full local Worker run82029 passed156 checks (.local/m2p-cloudflare-second.log), including history API scope/cursor/tombstone/current-session tests; history-specific Chromium integration remains pending. Next build initially failed exactOptionalPropertyTypes in the new UI; explicit optional types were corrected without weakening settings and fixed build80479 passed (.local/m2p-next-build-fixed.log). First failed run log: .local/m2p-cloudflare-first.log. Next: finish backend/UI, inspect authorization/cursor sanitizer, run real local D1/workerd/Chromium acceptance, and only then update acceptance status. Preserve all existing dirty work and always use explicit Kino Pick workdir. Full M1–M5 goal remains active.

## M2o — independent Guest tags accepted locally

Read docs/GUEST_TAGS.md.0034 implements immutable project label catalog, per-invite/Guest/photo membership and canonical command/result/state/audit. can_tag is independent; Grid/Lightbox also require can_view. Labels NFC/trim/case-sensitive,40codepoints,20active/photo,1000catalog/project. No Guest catalog enumeration; removing unknown membership hides another Guest catalog ID. Tags remain editable after selection submission without changing snapshots. Exact expectedGuestId/UUID/body survive uncertain responses and cookie switches; only first definite cap409 may refresh/recover. All feature flags remain OFF/hard-local.

Final full Worker run58214 passed148 local checks (`.local/m2o-all-acceptance3.log`), including actual375px Chromium tag controls, Grid/Lightbox sharing, private images, lost-response exact retry, switched-Guest denial/isolation, beforeunload warning, stale-cap refresh/removal, immutable PK/alternate/null guards, predecessor rollback, catalog1000cap/isolation/reuse, currentACL/replay and populated upgrade preservation.121 unit/23files,61 integration/10files, strict types/lint, Next build,14 reference Chromium, format and35-file spec presence checks passed. Worker UI acceptance is in the148-check suite. Screenshot `.local/guest-tags-mobile.png` inspected.

0034 applied to local development D1 only:28 commands; follow-up list has none pending. No remote/customer data, deployment, commit/push or flag activation. Recovery is forward-only: retain catalog/membership provenance/command/result/audit; disable tag writes before application rollback and repair with new migrations. Broader tags filtering/Owner history, own-history timeline, comments/annotations, versions/comparison, delivery/notifications/retention and hosted gates remain incomplete. Full M1–M5 remains active; next assess independent Guest own-history timeline.

Intermediate failures were test/code issues and were fixed before acceptance: nullable UI context, unused fixture workers, wrong Owner session_id audit assertion (Guest uses guest_session_id), image-helper argument mismatch, dialog.type method comparison and reload hydration race. The final suite includes those corrected paths. Isolated workerd catalog/integrity probes also passed; they are additional evidence, not hosted acceptance.

Execution incident retained for handoff: a subagent accidentally invoked a pnpm Prettier check in unrelated `C:\Users\Aaron\Documents\奇諾影像形象網站`, emitting dependency move/install warnings. Observed child processes ended; read-only status showed untracked pnpm-lock.yaml and node_modules/.ignored exists, without a clean before-snapshot to prove all provenance. No automatic cleanup/repair was performed there; preserve unrelated user work. All further commands use explicit KINO Pic workdir.

## M2n2 — immutable photo insertion accepted locally

0033 prevents REPLACE across version id/photo-version number, asset id/object key/version-kind and processing output job-kind/asset ID/object key; null photo version/asset IDs are rejected. Existing rows, scope checks and mutable job transitions are preserved. Isolated baseline0001–0032 reproduced queued-slot identity replacement, same-ID version hash/size replacement and original-to-delivery replacement with valid FKs;0033 rejected all with unchanged snapshots.

Final frozen-helper Worker suite passed135 checks (session59049, `.local/m2n2-final-cloudflare.log`), including populated upgrade preservation and immutable table/audit/FK comparisons.108 unit,61 integration,14 reference Chromium, strict types, lint, Next build, format and specification checks passed. Intermediate lint unused-variable warning was fixed; the old cross-tenant asset fixture now uses an unused delivery kind so it tests scope rather than colliding with the new duplicate guard.

0033 applied locally only:4 commands, then no pending migrations. No remote/customer data, deploy, commit/push or flag activation. Recovery: preserve guards/history, disable writes before code rollback and repair forward. Broader command/snapshot integrity, independent tags/comments/annotations/history, version workflows/comparison, delivery/retention and hosted gates remain incomplete. Next product slice: independent Guest tags; specification assessment underway. Full M1–M5 remains active.

## M2n1 — immutable result integrity accepted locally

Migration0032 rejects primary/alternate event-key replacement in seven immutable result tables and rejects null result keys/null or empty audit IDs;0031 duplicate-audit protection remains. Tests isolate a fresh non-null key with an existing event ID, duplicate primary key, null key, duplicate audit REPLACE, unchanged history, foreign keys and populated upgrades. Existing authorization and exact retry tests remain green.

Final strengthened Cloudflare suite passed134 local checks (session54580, `.local/m2n1-final2-cloudflare.log`).108 unit,61 integration,14 reference Chromium, typecheck, lint, Next build, format and34-file specification presence checks passed. Intermediate rerun failed on deferred Response.clone; immediate per-response parsing preserves24 concurrent attempts and20 allowed and passed the final suite.

0032 applied locally only:10 commands; no pending local migrations. No remote/customer data, deployment, commit/push or flag changes. Recovery: preserve guards/history, disable affected mutations before code rollback and repair forward. Remaining command-ledger, version/asset and snapshot/seal defenses still need audit. Full M1–M5 and hosted acceptance remain active.

## Current — M2m3 accepted locally

- [x] Project defaults and durable album inheritance: contracts/schema/service/API/UI/tests/docs, preserved legacy history and exact replay.
- [x]133 Worker checks,108 unit,61 integration,14 reference Chromium, strict types/lint and Next build.0031 applied locally (41 commands), none pending.
- [x] Reject replacement of old/new policy results and audit events; preserve repeated/concurrent Cron dry-run observation.
- [ ] Next: review replacement defenses across remaining historical immutable ledgers, then independent tags/comments/annotations and activity APIs/UI.
- [ ] Remaining full M1–M5: versions/BeforeAfter/delivery/notifications/retention and hosted provider/resources/import/backup/CI/deployment acceptance. Flags remain OFF.

# Task Board — 由 AI 每次結束前更新

> 狀態：`[ ]` 未完成；`[x]` 完成且驗證；`[~]` 正在處理（請改為列於「當前執行」段，避免 Markdown checkbox 混用）。M0 基礎已驗證；M1–M5 尚未完成，完整需求均保留。

## 當前執行

- Branch/worktree: codex/kino-pic-foundation, repository root.
- [x] M2m1 private album bounds: strict Owner policy/current ACL/CAS/replay/audit, atomic Guest cap/submit, policy-bound cursor, shared Grid/Lightbox capacity and independent canSubmit output.
- [x] Owner confirmation/exact unknown retry/current GET and Guest min2/max2/batch/cancel/submit/no-submit-right browser acceptance;375px screenshots inspected.
- [x]0029 repairs legacy reopened revision0 with audit and permits unchanged retained selection resubmit at1; old snapshots/replay remain intact.0028/0029 applied locally only, no pending migrations.
- [x] Actual Worker123, unit95, integration61, reference Chromium14, Next build, strict typecheck/lint, format/spec33/diff checks passed. Details in VERIFICATION.
- [ ] Next M2m2: explicit shared review subjects/Owner opt-in, two-distinct-Guest29→30 race and project inherited defaults. Never claim private two-session coverage proves shared mode.
- [ ] Remaining full M1–M5: tags/comments/annotations/full history/versions/BeforeAfter/delivery/notifications/retention and hosted service/resources/import/restore/CI/deployment acceptance.

## M2l completed local slice

- Branch/worktree: codex/kino-pic-foundation / repository root.
- Task ID: M2l independent ratings/favorites; complete locally; pnpm test:cloudflare117 passed. See HANDOFF/VERIFICATION for actual commands.
- [x] Strict rating/favorite contracts, independent permission API/read batches, logical-photo state and atomic append-only audit/replay.
- [x] Migration0027 predecessor guards/namespace conflicts and populated upgrade tests; applied only to local D1 with no pending migrations.
- [x] Shared Grid/Lightbox UI, independent rights, exact uncertain retry and A→B→A stale hydration regression; reload/paging/375px browser acceptance passed.
- [x] unit91, integration61, Next build, reference Chromium E2E14, strict typecheck/lint and32-file spec checker passed.
- [ ] M2m next: configurable selection limits and atomic concurrency/no-overfill tests with Owner/Guest UI. Tags/comments/annotations/full history/limits/versions/delivery/retention and hosted gates remain open; M1–M5 incomplete.

## M2k historical invitation entry

- [x] Three Owner modes,12 independent rights, pagination/expiry/maxUses, one-time fragment share links and safe uncertain retry/recovery.
- [x] Guest fragment/name/password entry, synchronous duplicate lock, explicit current-cookie recovery and entry→selection→submit local browser acceptance. Prior Worker112/unit88/integration61/reference E2E14 passed.

## M2j Guest selection read, submission, and Owner review

- [x] Add migrations 0024/0025 for Guest round state, immutable exact-version submission snapshots/results, atomic submitted state and audit; add migration 0026 snapshot seals and audited transition guards. Populated local migration acceptance reaches 0026.
- [x] Add private paginated GET of the current Guest's selection with independent can_select bit 8; return no filenames, R2 keys or image bytes.
- [x] Add POST submission with independent can_submit bit 512, server-created exact-version snapshot, immutable result/audit and Guest-write freeze.
- [x] Keep selection feature default-off and hard local-only; local migrations only, no remote/customer database changes.
- [x] Guest customer UI: selection grid, Lightbox, permissions, submit confirmation/freeze, logout, and local Chromium coverage.
- [x] Owner review/export/reopen UI and API; exact-target idempotent replay, spreadsheet-safe CSV filename handling, audited download.generated exports, keyboard-accessible reopen dialog, and latest-round-only reopen action.
- [ ] Remaining: broader Guest UI/browser E2E, selection limits, ratings/favorites/tags/annotations/comments, full event history for remaining actions, versions/delivery and hosted service gates.

## M0 基礎

- [x] M0-01 初始化 pnpm monorepo + web + worker + shared packages
- [x] M0-02 設定 TypeScript strict, lint, format, unit/e2e runners, CI
- [x] M0-03 開發環境變數/schema 驗證與 mock adapters
- [x] M0-04 將本規範對應到可執行資料庫 migrations / local dev 啟動指令

## M1 專案與相簿

- [ ] M1-01 Google/GitHub OAuth + 同身分綁定 / workspace / role & tenant RLS（本機完成；真實 Google/GitHub/Supabase 驗收未完成）
  - [x] SSR PKCE、verified getUser、workspace/member RPC、RLS、交易審計與重送去重
  - [x] 單一或雙來源同一身分、帳號頁與主動綁定、短效 hashed intent、actor/衝突/來源停用負面測試
  - [ ] 真實 provider/manual linking、automatic-email policy、fresh reauth/安全 unlink 與新增架構補充相容性驗證
  - [x] 本機整合與安全回歸通過（最新數量見 VERIFICATION）；fixture 不代表雲端 E2E
- [ ] M1-02 Project/album CRUD + dashboard（建立/讀取/改名子集合完成）
  - [x] Schema/repository/API/UI：專案/相簿建立、24 筆 cursor 分頁、改名、重新載入持久化
  - [x] tenant/parent immutable、角色/撤權、expectedRevision、audit + idempotency 原子交易
  - [x] 409 保留草稿、未知提交結果安全重試、過期 cookie refresh/重放負面測試
  - [ ] 受控狀態/封存、保護/保留政策 UI/API；相簿刪除須走後續 job，禁止直接 DELETE
  - Evidence: e68dfa8 / 69cdf6b / 875ea0b / 2e35302；完整整合提交見 git log -1
- [ ] M1-03 R2 direct upload/resume/finalize + image thumbnail worker
  - [x] Owner-only single-part signed PUT + verified completion/immutable original metadata/quota conversion 已有本機後端實作；production/local/staging flag 均預設關閉
  - [x] CF-03c2 Node-only native full-decode adapter、metadata-stripped JPEG thumbnail/preview、本機 create-once 檔案輸出 CLI
  - [x] CF-03c3 本機 D1 outbox、租約/CAS、兩級衍生檔配額、原子 assets/audit/usage、固定 private R2 keys 與明確執行的本機可信 runner
  - [x] CF-03c4b Owner 確認／雙輸出永久 fencing／abandoned／原子配額與審計；occupied/unknown 仍保留容量
  - [x] CF-03c5 有界 metadata journal、Owner/相簿隔離、跨分頁鎖、重新載入恢復與原檔重選雜湊驗證
  - [ ] multipart／授權更新／伺服器待辦發現、已有輸出審查對帳、正式處理服務、真實 R2 checksum/CORS E2E
- [ ] M1-04 Grid photos query/pagination/lightbox
  - [x] CF-03c3 Owner-only D1 24筆 keyset Grid、處理狀態、私有圖片 gateway、Lightbox 鍵盤/focus及375px本機瀏覽器驗證
  - [x] M2h Guest can_view-scoped 24-item keyset gallery and private thumbnail/preview gateway; local Worker/D1/R2 access tests passed
  - [ ] Guest selection/rating/favorite/tag/comment/annotation permissions and append-only action audit; current-version display, batch UI and hosted resource acceptance remain open

## M2 客戶挑片 + 詳細歷史

- [x] M2h Guest read-only gallery backend: current session/invite/scope/Owner/resource/expiry/revocation checks, empty-vs-unauthorized album distinction, bounded pagination and checksum-verified private derivatives. No original/download route, actions, guest UI or browse audit/retention heartbeat.
- [x] M2g Guest exchange backend: local-only same-origin route, shared KDF, atomic session/audit/max-use and one-time cookie are implemented and locally verified. No hosted exchange or Guest portal/actions is claimed.
- [x] M2d local Owner issuer backend:0019/all-six Owner ledgers, three modes/exact scope/atomic audit, HMAC request binding, one-time winner credentials and metadata-only unknown-result recovery. Guest exchange backend is now covered by M2g; creation/share UI remains incomplete and issuer default-OFF/hard local-only. Evidence in INVITE_ISSUANCE/VERIFICATION.
- [x] M2c local credential primitives + self-logout backend: fixed scrypt/exact-format guards, random domain-separated tokens, same-origin Cookie-only logout/atomic request audit/idempotent proof retry and actual Chromium cookie handling. Hosted KDF/CPU/concurrency/throttle and full creation/exchange/UI remain open. Evidence in GUEST_CREDENTIALS/VERIFICATION.
- [x] M2b Owner invite inspection/revoke:0017 atomic client-request audit/replay/namespace,24-row private scope list, real project UI with explicit confirmation/refresh/lost-response retry, immediate Guest denial and populated upgrade preservation. At M2b, invite creation/exchange remained incomplete; M2d/M2g later add local-only backends.
- [x] M2a backend authorization foundation: additive0016 scope/identity/session/revocations, independent12-bit rights and actual local D1 read-only resolver/API; no public hosted issuer/exchange or Guest photo/action flow; local-only backend slices arrive in later milestones. Evidence/recovery in GUEST_ACCESS_FOUNDATION and VERIFICATION.
- [ ] M2-01 link_only/generated_password/custom_password + guest session
- [ ] M2-02 share permissions and cross-project deny tests
- [ ] M2-03 selection, rating, favorite, tags, selection limit/submission
- [ ] M2-04 append-only events for all actions + per-photo/project/guest history
- [ ] M2-05 client portal secure grant for authorized previous projects

## M3 照片版本

- [ ] M3-01 versions/assets immutable DB and paths
- [ ] M3-02 manual new version and current version switching
- [ ] M3-03 same-file-name auto/assisted matcher and duplicate checks
- [ ] M3-04 Before/After slider, side-by-side, overlay with ratio support
- [ ] M3-05 version-specific comments/annotations linkage and tests

## M4 儲存清理

- [ ] M4-01 storage ledger, upload reservations, dashboard
- [ ] M4-02 R2 usage reconcile + stale-metric alarms
- [ ] M4-03 30-day valid view heartbeat; inactivity eligibility engine
- [ ] M4-04 >80% cleanup oldest eligible album to <=65%, block uploads >=95%
- [ ] M4-05 dry-run plan UI, opt-in, exclusions, locks, queue, idempotent delete
- [ ] M4-06 deletion audit events, retries, tombstones, pressure tests

## M5 完善

- [ ] M5-01 region annotations and review statuses
- [ ] M5-02 version approvals/delivery/ZIP/download audit
- [ ] M5-03 notifications, security hardening, a11y and mobile testing
- [ ] M5-04 staging real OAuth + R2 E2E, release runbook

## 更新方式

每次完成一個 item：① 勾選（有測試證據）② 記錄 commit hash/branch ③ HANDOFF 記錄測試命令及結果 ④ 下一個 item 明確指派 ⑤ 記錄仍未實現的行為，不隱瞞。

## M0 完成範圍與限制

- M0-01：web 與 shared packages 可執行；worker 為明確的預留邊界，尚無 R2 handler。
- M0-02：lint/typecheck/unit/integration/build/Playwright 本機通過；GitHub CI 僅已配置，未上傳執行。
- M0-03：六個 service interfaces、Zod env/health、immutable memory storage。介面不是正式 service 實作。
- M0-04：六張初始表、read-only RLS、migration runner 與復原指引；PGlite SQL/RLS 通過。真實 Supabase migration runner、OAuth、R2 尚未驗證。
- Next：M1-02，先實作專案/相簿資料完整性、授權、版本衝突、交易審計，再接 API/UI。

## 本輪交付與高難度優先順序

- 2026-10-23：主代理與兩個獨立 worktree 子代理完成上述 M1-02 子集合及安全修正；27 unit / 21 integration / 7 browser，全套 lint/typecheck/build 通過。
- 下一個最小任務：M1-02 狀態/保護流程。先定義允許的 transition、活動寫入/封存互斥鎖與審計，再做 API/UI；不實作無工作佇列保護的刪除。
- 再接 M1-03：配額 reservations、immutable object identity、上傳完成驗證的交易不變量，再連接 private R2/thumbnail pipeline。
- 真實 Google/Supabase/PostgREST 與多連線 PG 壓力驗證、R2 為獨立外部 gate，尚未通過；全部 M1–M5 未完成需求持續保留。

## OAuth 來源補充交付

- 依使用者明確確認完成 Google / GitHub 可只綁一個或同時綁兩者，共用一個 user ID/原 workspace；本機 32 unit / 27 integration / 11 browser + lint/typecheck/build 通過。Web 整合提交 1847e0d；DB/測試/文件提交見 git log -1。
- 真實 provider 尚未設定，manual linking app 預設關閉；解除綁定、closed registration、Owner bootstrap 與新增部署方案尚未實作，見 AUTH_SPEC/LOCAL_AUTH。無聲轉換 stack 不是本回合範圍。

## 相容性工作（部署與切換尚未完成）

- [x] COMPAT-01 既有程式/補充規範差異、Auth/SQL/hosting 邊界、官方來源與 registry metadata 盤點：ADR-Cloudflare-Free-First.md
- [x] COMPAT-02 獨立 worktree vinext 1.3.0 static check（apps/web 15/15）；主應用依賴不變
- [x] COMPAT-03 八項記憶體 SQLite 試驗：零列 UPDATE 陷阱、tenant/current authorization、CAS、重送及 audit/write failure rollback
- [x] COMPAT-04 本機隔離 hosting build/workerd preview：沿用 Supabase/PostgreSQL，既有 browser cases 加直接頁面 proxy refresh 回歸通過；僅 local runtime，不宣稱已部署。實驗保留於 codex/kino-pic-cloudflare-runtime；重現/限制見該分支 experiments/cloudflare-runtime/README.md 與 VERIFICATION。
- [ ] COMPAT-05 Auth/repository ports、Owner/closed/implicit-linking 政策、實際 D1 binding 及完整 roles/concurrency/restore rehearsal

本輪通過 lint/typecheck、32 unit、35 integration、build、format/docs；browser runtime 未變，沿用 9533171 的 11 tests 歷史證據，本輪未重跑。SQLite 不是 local/remote D1；原始 M1–M5 功能與外部 gates 保留。

- 主分支新增直接頁面過期 session 回歸；Next12browser通過。Next Vary 覆寫差異及 private/no-store 安全斷言見 VERIFICATION。下一產品切片維持 M1-02 狀態/保護；雲端 hosting gates 與 COMPAT-05 仍未完成。

- [x] M1-02 protection 子集合：owner-only 相簿釘選/保留保護、解除確認、CAS/audit/replay、實際 API/UI；migration0007。完整狀態/封存/專案保護與刪除仍未完成，驗證見 HANDOFF/VERIFICATION。

- [x] M1-02 archive 子集合：owner-only 空專案/相簿可逆封存、原狀態保存、編輯凍結、CAS/audit/replay/API/UI，migration0008；完整照片/review/upload 狀態流程與刪除仍未實作。
- 下一最小任務：M1-03 配額 reservation 與上傳 session 的 DB/交易不變量，先驗 tenant、重送、過期、封存互斥及配額耗盡拒絕，之後再接 private R2。不得將空內容封存視為完整 M1-02 CRUD 完成。

## 明確採納 Cloudflare 補充後的工作順序

- [x] CF-01 真正本機 Worker/static/API、D1 migrations、固定Owner bootstrap、成熟 Google/GitHub OAuth閉鎖骨架、R2 adapter、Cron無刪除觀察與CI/CD gate；不等同全產品cutover。測試見VERIFICATION。
- [ ] CF-02 D1 workspace/project/album/protection/archive repo與既有UI port；Owner policy等效案例／tenant/audit/CAS/replay及資料ID mapping rehearsal。
- [ ] CF-03 fresh link/unlink、會話管理、quota reservation/expiry/verified complete、R2直傳signer、photo_assets節點/不可變版本模型。
- [ ] CF-04 Guest gallery, selection read/submit, ratings/favorites/tags/comments/annotation, export, complete audit coverage, versions/BeforeAfter/delivery remain open. M2i only adds local-only selection write backend; no customer UI or submit workflow.
- [ ] CF-05 完整 retention dry-run preview/opt-in/locks/queues/retry/reconcile，現有Cron observation不能算完成。
- [ ] CF-06 真實provider/HTTPS、D1/R2資源、完整目標驗收、backup/restore、費用條款、正式受控CD。

舊Next/Supabase開放建帳差異保留為參考現況，沒有直接停用；目標Worker以Owner gate拒絕非Owner。完整功能與資料遷移未完成前不得切換。原附件保留不改寫。

- [x] CF-02a D1 workspace backend: additive0003, repository, Owner-only create/read API, atomic replay/audit, same-time keyset pagination and cap tests on real local workerd/D1.
- [ ] CF-02b Extend durable commands to a shared operation namespace; port project/album create/read/rename CAS, protection/archive, then connect existing React UI through a target repository adapter. Preserve reference until browser-equivalent target acceptance. CF-02 remains unchecked; this backend increment has no new target UI/E2E flow.

- [x] CF-02b D1 target backend subset: shared actor/request ledger with 0003 request snapshot migration; project/album create/read/rename, album protections, empty-content reversible archive; tenant/parent checks, CAS, before/after UTC audit, replay, rollback and local D1 tests (migrations0004/0005).
- [x] CF-02c target UI slice: same-origin Worker static React bundle reuses workspace/content forms; Owner session, workspace/project/album reads and mutations, album pin/hold and empty archive/restore controls. Chromium acceptance drives real local workerd/D1 and checks committed rows; reference Next app remains intact.

- [x] CF-02b D1 content backend and empty-content policy subset: projects/albums APIs, global command ledger, historical workspace retry upgrade, album protection/archive, immutable parent + photo catalog scope guards. Twenty-five local check groups pass.
- [ ] CF-02 exit: finish endpoint/status/empty-content parity audit, validate existing-ID import mapping against a representative sanitized dataset, and retain the legacy app until the full acceptance gate passes. CF-02 overall remains open.

- [x] CF-02b audit collision correction: migration0006 preserves event rows and removes cross-actor `(action,request_id)` uniqueness; isolated upgrade/data preservation and duplicate IDs across actors verified. Remote backup/restore and large-table rehearsal are still CF-06 gates.

- [x] Audit rebuild repair: D1 migration0006 now removes the legacy global request/action uniqueness; migration0007 rebinds all append-only event writers. Historical row equality and post-migration session audit are verified in isolated D1. Full-size staging snapshot/recovery still gates remote use.

- [x] CF-03a D1 quota reservation and expiring session core: additive migration0008, Owner-only init/read/cancel, cross-ledger actor/request collision checks, project/album archive exclusion, dual workspace/node quota counters, append-only audit, cancellation and five-minute Cron expiry. Local tests cover concurrency boundaries, replay/conflict, audit rollback, revoked Owner and lifecycle guards. **Reservation only; no signer, object transfer, verified completion, photo assets or upload UI.**
- [x] CF-03b local single-part R2 signer and verified completion backend: exact signed length/type/checksum, strict scoped key, verified object completion, immutable original/version/asset creation and quota conversion. Fence markers require session metadata, zero-byte size and dedicated fence MIME; spoofed metadata on image objects cannot release quota. Migration 0011 adds photo/version/asset/completion/audit tenant-scope guards. Local workerd/D1/R2 only; no real R2/CORS or customer upload client.
- [ ] CF-03c trusted full decode and persisted preview/thumbnail pipeline, then paginated private gallery; browser upload/dimension sub-slice is complete locally below. Migration 0011 relationship guards are in place locally; backup/restore rehearsal gates remote application. R2 single-part is capped below 5 GiB; larger files require multipart, not silent truncation.
- [ ] CF-02 exit remains open: finish endpoint/status/empty-content parity audit, validate existing-ID import mapping against a representative sanitized dataset, and retain the legacy app until the full acceptance gate passes.

## CF-03c1 local vertical slice

- [x] 0012 dimensions/immutability/scope guards; bounded JPEG/PNG/WebP headers; legacy version/asset/NULL dimensions/quota/audit upgrade preservation.
- [x] Owner20-file sequential browser uploader,64MiB/file, decode/hash/local preview, stable unknown-outcome retry, disabled init gate, expired-session reconciliation/removal and navigation warning.
- [x] 44 local Cloudflare groups,46 unit,49 integration,14 reference Chromium E2E, build/typecheck/lint passed.0012 applied only to local Wrangler D1. Final docs checks in VERIFICATION.
- [ ] CF-03c remains open: trusted full decoder/processing adapter, persistent preview/thumbnail with quota/idempotent jobs, paginated private gallery/lightbox, reload-resume/multipart, live R2/CORS and representative backup/restore. All original M2–M5 requirements remain.

## M2i Guest selection backend subset (2026-10-24)

- [x] Migration 0023: scoped selection state and immutable command/result ledger; populated upgrade fixture preserves existing asset, processing, Guest, revocation and audit snapshots. Recovery is forward-only; never drop append-only rows or triggers.
- [x] Default-off, hard local-only `PUT /api/guest/albums/:albumId/photos/:photoId/selection`; atomic current ACL, `can_select` bit, idempotent request replay, immutable before/after audit and audit-failure rollback.
- [x] Acceptance: 103 local Cloudflare groups; unit86; integration61; strict typecheck/lint passed. Exact commands and limits in VERIFICATION/HANDOFF.
- [x] Follow-up completed in M2j: current selection read, independent submit snapshot/round lifecycle, Guest UI, and Owner review/export/reopen.
- [ ] Remaining: ratings/favorites/tags/comments/annotations, complete event history for other actions, versions/delivery, selection limits, hosted session/KDF/abuse-capacity and Cloudflare edge acceptance, and retention.

## 2026-10-29 — CURRENT: human-photo heartbeat accepted locally; one-client approval confirmed

This appended entry supersedes earlier same-day statements that no heartbeat endpoint exists or that the one-versus-all question is pending. Owner/Guest visible-photo heartbeat is implemented through0053 native append-only witnesses/monotonic album activity/audit,scoped repositories/APIs and existing Gallery grid/Lightbox image wrappers. Default HUMAN_VIEW_TRACKING_ENABLED=false/hard-local.0053 SOURCE ONLY;default persistent D1 stays0052. Auto-deleteOFF/dry-run;no R2/quota mutation or deployment.

Final isolated `apps/worker/.local/human-views-focused-final.log` exited0:3 API groups +2 controlled375px Owner/Guest browser flows using the real existing upload/R2/Sharp fixture. Exact immediate rolling dedupe/deadline,authority/origin/visibility denials,forged actor/audit/projection/log guards and injected audit rollback pass. Management list/unloaded/hidden/subsecond/blur do not count;continuous visible images count;preview shares cooldown. Headless focus/visibility is controlled,not native headed or actual five-minute wall-clock recapture proof.11 scoped contract tests,13 retention safety tests,final Worker/UI build,generated bindings,root/Web strict and scoped lint pass. Acceptance:worker .local/human-views-acceptance.json. Failed DDL parentheses/test-JS-hold/Web-regex strict logs remain preserved. No broad suite was repeated.

New safety requirement: activityEvidenceVerified is mandatory in pure retention input;unknown legacy/offline/untracked periods exclude with activity_unverified. Missing last-view data must not imply never viewed. Heartbeat alone does not provide continuous coverage,state-change/policy/reference completeness or deletion authority. See docs/HUMAN_PHOTO_VIEWS.md for exact files,evidence,recovery and gaps.

User confirmed「其中一人代表確認即可」:any one authorized client may confirm a fixed version. This resolves the prior question;do not ask again or require every anonymous visitor. Next implement explicit Owner-authorized immutable request/invitation/Guest confirmation and fixed delivery manifests;retain full retention policy UI/preview/persistence/locks/recheck/retry and remaining M1-M5/hosted scope. Before0053 persistent adoption use fresh backup/isolated upgrade/live parity. Preserve unrelated dirty edits;no commit,push or deploy.

## 2026-10-29 — CURRENT follow-up: append-only REPLACE and equal-clock safety accepted

This extends/supersedes the earlier three-group human-view checkpoint:the final focused native run `apps/worker/.local/human-views-replace-safety.log` exited0 with4 API groups +2 controlled375px Owner/Guest browser flows.0053 now rejects duplicate event_id OR request_id before INSERT,so SQLite REPLACE cannot bypass append-only delete guards. Projection upsert is attempted only for an advancing frontier;two valid same-millisecond events both remain in log/audit while the maximal timestamp/UUID witness stays canonical. Native replacement/event/request/projection and equal-clock cases pass. Final test fixture selects the known non-frontier witness for timing stability;scoped lint passes. Evidence `apps/worker/.local/human-views-replace-acceptance.json` preserves the earlier checkpoint and its log rather than rewriting evidence.

0053 still SOURCE ONLY;default D1 stays0052,tracking OFF/hard-local,automatic deletionOFF/dry-run. activityEvidenceVerified must cover the policy's decision window;missing legacy/offline data is never proof of inactivity. Future deletion must separately protect in-flight authorized reads/downloads and the first1s visibility qualification window,without renewing the30-day timestamp for preloads. No physical deletion/hosted acceptance claim. User's one-authorized-client representative version approval rule is confirmed and next for implementation;fullM1-M5 remains active/incomplete. All existing document history and unrelated dirty changes are preserved.

- 2026-10-29 checkpoint: Gump interface reference recorded in `docs/GUMP_INTERFACE_REFERENCE.md`. Version approval remains OFF and unfinished: implement Worker service, reconcile session-bound retry with 0054, run native isolated migration/API and browser acceptance, and reconcile the two failing history test fixtures before mounting. Do not apply 0054 to persistent D1 without backup/restore rehearsal.

- 2026-10-29: Version confirmation local integration: Owner-authorized exact-version requests and one-Guest receipt are implemented behind local-only default-OFF flag. Isolated native D1 11 checks and API 7 checks passed; browser acceptance, full smoke rerun and safe persistent migration adoption remain outstanding. Keep delivery manifests and retention work open.

- 2026-10-29: Version confirmation isolated browser acceptance passed (Owner request, Guest fixed preview/confirmation, Owner result, OFF hidden). Persistent migration and hosted/provider E2E remain pending; capability requires both version and approval local flags.

- Full Cloudflare smoke remains failing at guest-feedback-browser.mjs:387 (access reads expected 1, observed 2); investigate actual duplicate or stale count, then rerun targeted and required regression. Earlier annotation 401 assertion was updated and its browser group passed on rerun.

- Full Cloudflare smoke third run passed the prior Guest annotation and feedback browser failures but stopped at shared-review-guest-browser.mjs:1823, another expected old 401 `存取受限` UI. Reconcile that expectation and rerun; do not claim full smoke passed.

- The shared-review fallback assertion has been corrected without removing the privacy/no-submit assertions; the full suite has not been rerun since, so regression acceptance remains open.

- 2026-10-29: Full `pnpm test:cloudflare` rerun passed 367 local checks, including the corrected shared-review 401 browser case. Hosted/provider tests and persistent 0053/0054 adoption remain open. The later Owner historical-version warning requires its focused browser verification.

- Fixed delivery groundwork: contract and unit tests exist, but no DB/service/API/UI/download is complete; see DELIVERY_MANIFEST.md. Approval UI now warns when a view-only invite cannot confirm an old version after head switch; targeted behavior test remains pending.

- The Owner view-only warning and pending V1→V2 permission behavior passed the isolated version-approvals-head-switch runner; no hosted/provider acceptance is implied.

- Delivery migration source is NOT ready: incomplete 0055 draft resides in worker .local, outside auto-apply migrations. Correct invalid SQLite CHECK subquery, complete all transactional/immutability/reference guards and native isolated tests before any migration is accepted. Auto-review rejected appending unfinished SQL to auto-applied migrations; no workaround was attempted.

- Invitation form now groups basic and advanced independent permissions; 375px focused browser passed including secret/retry and reset. Delivery Guest DTO rejects both permissions false while preserving download-only; delivery backend and migration remain incomplete.

- After invite permission grouping, its focused Chromium group passed; full smoke later exited 1 at assisted-candidate-catalog-browser.mjs:444 pagination assertion. Diagnose and run the affected scenario before claiming a current full-suite pass.

- Assisted catalog pagination browser wait now follows rendered page number; focused isolated runner passed 7 checks including 1001-item/24-row and 375px browser flow. The earlier complete smoke run remains exit 1 and has not been repeated after this correction.

- Album card share entry now opens the existing composer with the chosen active album, preserves any pending intent/one-time result, and passes isolated 375px target/decoy + lost-response Chromium tests. Dedicated popup, fixed delivery, persistent migration rehearsal and hosted acceptance remain open. Full smoke not rerun after this UI change.

- Guest Before/After now supports direct image drag, keyboard, synchronized idle wiggle, reduced motion and 375px isolated Chromium acceptance. Default OFF/local-only. Owner comparison canvas, real hosted acceptance and full regression after this change remain open.

- Owner Before/After read-only comparison is integrated behind existing default-OFF local photo-versions gate. Isolated 13 API/browser checks passed including 27 versions/head outside first page and session denial; Guest comparison regression passed. Full suite after change, hosted/provider E2E, fixed delivery and safe retention remain open.

- Freehand foundation only: strict bounded geometry/style, deterministic oriented-coordinate sampler and canonical serializer have focused tests; Guest/Owner DB guards, service, canvas/UI, cross-invite/version and browser acceptance remain incomplete. Do not display an active brush before end-to-end support.

- Freehand proposal passed Node SQLite in-memory behavior checks only; it remains REVIEW ONLY outside auto migrations. Workerd/D1 behavior, integration of Owner/Guest serializers and viewers, old-client compatibility, UI and browser acceptance are pending. Delivery 0055 rejection remains separate.

- Freehand independent gate defaults OFF and is unconnected; 20 focused tests passed. Node SQLite proposal evidence exists but workerd/D1 atomicity is not checked (probe failed before SQL). Shared canvas, two-role read/write, client compatibility and native/browser acceptance remain open.

- Freehand client compatibility requires same-authorized-scope preflight and explicit upgrade-required for unsupported clients when any page contains freehand; never silently hide strokes. Already-open idle old tabs cannot be instantly refreshed without a separate mechanism. Render model is pure/unwired; Guest+Owner service/schema/UI/DB/workerd/browser integration remains incomplete.

- Freehand proposal passed isolated workerd D1 batch atomic rollback (4 injected failure points) and Guest/Owner geometry/auth/replay/audit checks; remains REVIEW ONLY, unconnected and OFF. Wrangler/persistent migration, old-client compatibility, render/service/UI and browser acceptance remain pending.

- Freehand canvas opt-in and authorized-scope compatibility/canonical helpers remain unwired; existing Guest point/rectangle browser regression pending. Before enabling, bind preflight/read with watermarks, complete Guest/Owner writers/readers and client-version UX, prove D1/old client/browser integration.

- Existing Guest point/rectangle 375px annotation regression passed after freehand canvas groundwork (19 local API/fixture groups + browser). Freehand pointer/browser, Owner regression, compatibility integration, DB adoption and full suite remain pending.

## 2026-10-29 — Freehand canvas isolated browser verification

A test-only Vite fixture and Playwright configuration exercise the opt-in AnnotationCanvas without connecting product editors or services. Root independently ran `pnpm.cmd exec playwright test --config playwright.freehand.config.ts --reporter=line`: 4 Chromium tests passed. They cover default omission, actual mouse-drag stroke, scope change and permission loss cancelling a draft, and Enter/arrows/Escape keyboard use. The fixture uses synthetic local data; it does not establish Guest/Owner persistence, mobile touch, hosted services or production E2E. Freehand remains unwired and default OFF. Next integrate authorized full-feed read compatibility and compare the read snapshot watermarks before parsing or returning any items; then complete schemas, serializers, journal, both editors, reviewed forward migration and isolated end-to-end acceptance. No production/customer data or delivery draft was touched.

## 2026-10-29 — Read compatibility draft and prototype inventory

Four annotation read repositories and three route modules now contain a preliminary freehand capability/preflight integration with scope watermarks and 426 handling; freehand remains OFF and no client advertises support. This is an UNACCEPTED DRAFT: root strict TypeScript and the five existing preflight unit tests pass, and the existing isolated Guest point/rectangle runner passed 19 fixture/API groups plus its 375px browser flow after the change. Those tests do not prove the new 426 behavior, deleted-row handling, races, all four scopes, or cross-invite isolation. Do not enable freehand until dedicated actual D1/route tests and review are complete. Existing separate delivery rejection remains unchanged.

Prototype inventory: Worker target UI has Owner workspace/project/album and Guest album flows, but many capabilities default OFF and no general interactive mock login/demo fixture exists. Local Worker interactive use requires configured OAuth and Owner bootstrap. The Next reference homepage/login can run without credentials but is not the full Worker product prototype. `pnpm.cmd dev` started local Next at 127.0.0.1:3000; HTTP root returned 200. Synthetic browser screenshots document only isolated test states. Delivery, cleanup management and freehand end-to-end remain incomplete; no hosted acceptance claimed.

## 2026-10-29 — Isolated interactive prototype

Added `experiments/gump-demo/` as an independent local-only interface prototype, not a product route. Launch from root: `pnpm.cmd exec vite --config experiments/gump-demo/vite.config.js` and open http://127.0.0.1:4174/. It uses CSS synthetic images and per-tab memory; album creation, share option summary, selection/filter and before/after slider are demonstrable without API, credentials or customer data. It explicitly does not generate real links or persist data; nonfunctional controls were removed or made noninteractive. The demonstration is not connected to actual Worker UI or evidence of MVP/hosted completion.

HTTP root returned 200. Chromium desktop 1440x900 and mobile 390x844 tests in `tests/e2e/gump-demo-preview.spec.ts` passed 2/2 after the final wording change, covering create, share settings reflecting selected 14-day/download values, selection, slider keyboard/drag/touch, mobile overflow, and no /api/ calls. An intermediate rerun failed because the previous expected share message changed; the updated assertion was rerun and passed. Screenshots in OS Temp are local synthetic test artifacts. No production/customer data, migrations or feature gates changed. Freehand compatibility remains an unaccepted draft as described in the previous entry; delivery/retention/hosted acceptance and full M1-M5 remain incomplete.

## 2026-10-29 — Freehand compatibility read and full-chain safety checks

Fixed a concrete regression in the preliminary compatibility integration: three annotation route error handlers had dangling `if` statements, which suppressed existing Guest 401 and Owner WorkspaceFailure status mappings and returned generic 503. Each now explicitly returns 426/ANNOTATION_CLIENT_UPGRADE_REQUIRED; existing error branches are reachable again. Root strict TypeScript and scoped route ESLint passed (only the existing React detection warning).

Root independently ran `pnpm.cmd exec vitest run tests/unit/freehand-read-compat-workerd.test.ts`: 6/6 passed using isolated Miniflare D1 fixtures. All four repository scopes exercised legacy 426, Guest own targeted old rectangle plus freehand beyond first 24 still requires upgrade, shared invite isolation, and Guest own preflight/page race returns 409 without items/cursor. Guest 401/400 and Owner route error mapping were checked; Owner 409 was injected, not an actual Owner race. Supported freehand parser/UI/journal recovery remains unimplemented, so this is not freehand feature acceptance. In particular old pending journals must remain intact until upgraded recovery is implemented; idle tabs have no instant invalidation guarantee.

Root independently ran `node tools/freehand-annotation-chain-workerd.test.mjs` from apps/worker, exit 0: fresh isolated workerd D1 applied 0001-0054; both empty and seeded Guest/Owner annotation/audit snapshots survived each of four injected proposal-batch failures; successful batch preserved existing data; accepted freehand and old geometry, replay/conflict, invalid geometry and authorization guards were exercised with FK0. The proposal remains REVIEW ONLY, outside auto migrations, and was not applied to persistent/hosted data. These tests do not establish Wrangler migration application or production parity. The feature remains default OFF; complete new-reader schema, canonical writers, journal, both UI editors, reviewed migration/adoption and end-to-end/hosted tests remain required. Earlier delivery 0055 rejection is separate and untouched.

## 2026-10-29 — Freehand contract and guarded writer preparation

Extended the existing strict annotation geometry union with the bounded freehand variant, retaining point/rectangle schemas. The Worker canonical serializer now handles all three while preserving legacy canonical byte order. Guest and Owner writers have a default-false freehand gate; routes inject the existing local-only capability. A new freehand request with the gate OFF is rejected, while an authorized existing request ID can reach the existing immutable replay/conflict guard; Guest expected identity is checked. This policy and exact writer behavior have focused fake-D1 tests, NOT actual workerd writer/trigger/audit acceptance. No feature flag or migration was enabled, and the proposal remains review-only.

Existing Guest/Owner annotation canvas renderers now draw freehand geometry as polylines and label it correctly, rather than treating it as a rectangle. Editors do not yet expose freehand creation, advertise read capability, or connect recovery; no complete product flow exists. Do not advertise `freehand-v1` until all Guest/Owner reads, processing, UI and journal recovery are verified. Unsupported old clients remain protected by the prior 426 compatibility path; already-open idle tabs have no instant invalidation guarantee.

Root independently ran writer/canonical/config Vitest 18/18, read-compat workerd Vitest 6/6, full root strict TypeScript and Web typecheck, scoped UI/test lint, and freehand isolated Chromium canvas 4/4. Agent ran existing Guest annotation isolated workerd/D1/R2 regression: 19 API/fixture groups and 375px browser passed, freehand not exercised. Initial scoped lint exposed existing explicit-any fixture declarations; added narrow documented exceptions for its partial D1 race wrapper, then lint and typecheck passed. No full suite, physical touch, production OAuth/R2, persistent migration or actual freehand writer/D1 E2E was verified. Next implement and test actual D1 writer and exact replay with proposal in isolation, then both editors/journals and supported-client headers, before considering a reviewed forward migration. Delivery and retention remain incomplete; prior delivery 0055 rejection is separate and untouched.

## 2026-10-29 — Freehand writer D1 and opt-in editors

Root independently ran `pnpm.cmd exec vitest run tests/unit/freehand-annotation-writers-workerd.test.ts`: 1/1 passed against real Guest/Owner routes and a fresh isolated Miniflare workerd D1 with migrations 0001-0054 plus the review-only proposal applied only in the temporary fixture. It exercises new writes with gate OFF, writes with gate ON, exact replay after closing, changed-body conflicts, wrong identity, immutable command/change/result/audit witnesses, unchanged failure snapshots and FK0. `PRAGMA integrity_check` is not supported by D1 (SQLITE_AUTH); it was removed from this test, not claimed as passed. This does not adopt a migration or prove hosted/cloud behavior.

Guest and Owner editors now have opt-in props `freehandCapability` and `allowFreehand`, each default false, mapping drawn strokes to their existing draft/journal commands and preserving exact request body/id on retry. Revoking the prop blocks saving and clears unsent brush drafts; re-enabling does not restore them, while existing journaled commands remain. No product caller enables these props, no trusted server capability endpoint is connected and no `freehand-v1` read header is advertised. The UI is not production-ready or an end-to-end enabled feature.

Root independently ran Guest Chromium fixture 3/3 and Owner Chromium fixture 2/2 (sequentially; concurrent first Owner attempt failed because both test configs use port 3116). Fixtures use mocked API, not integrated Worker. Cases include pointer drawing, identical-body retry and revoke/re-enable behavior. Root strict TypeScript passed; agent reports complete typecheck, focused Guest journal/editor Vitest 5/5, Owner journal Vitest 7/7, scoped lint/format passed. First Guest fixture run failed from incorrect mock URL, corrected before success; Owner initial fixture path was corrected before success. No real photos, persistent or hosted data, migration, deployment or feature activation. Next complete new-client read capability/upgrade messaging across ALL geometry read paths and recovery, integrate trusted capability without breaking legacy capability JSON, perform actual Guest/Owner end-to-end browser+D1 test, and only then review forward migration and local adoption. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Freehand reader and journal recovery opt-ins

Guest and Owner UI now have independent, default-false read-capability opt-ins, separate from brush/write flags. Guest own/shared pages, cursor and targeted recovery use the opted-in header; Owner authored pages/recovery, guest-list and processing targeted reads do likewise. Existing production callers do not pass opt-ins; no server write capability endpoint or feature activation is included. On authorized read 426, UIs show upgrade guidance and clear partial/stale visible rows while retaining persistent journals; Processing 426 also clears the Owner parent list. FREEHAND_ANNOTATIONS_DISABLED 409 remains uncertain/retryable instead of a revision conflict, keeping original request/body for gate reopening. Actual authorization remains server-side, and read support must remain independent of write gate when integrated.

Root independently ran Guest Chromium 8/8 and Owner Chromium 4/4 using mock API fixtures, plus root strict TypeScript. Agent ran Guest focused Vitest 33/33 including isolated workerd read-compat and repaired legacy fake D1 preflight fixture, Owner helper 3/3 and workerd compatibility 6/6, scoped lint/format. An initial Web typecheck failed because the new Owner processing fixture omitted coordinateSpace; agent corrected it and reran Web typecheck and 4/4 browser successfully. Initial test-fixture selector/config failures were corrected before passing runs. Browser tests are mocked, separate from workerd tests; hosted OAuth/R2, physical touch and end-to-end UI/Worker/D1 remain unverified.

Next integrate new-client read capability in all real product call sites independently of write gate, add a separate trusted write-capability endpoint without altering existing strict JSON, wire UI only after full authorization/recovery checks, and exercise real browser/Worker/D1 end-to-end before reviewed migration and local adoption. Freehand remains OFF; no migration or persistent/production changes. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Freehand read integration and guarded capability

Guest selection/comparison and Owner annotation panel/editor/processing now advertise supported `freehand-v1` reads independently of write permissions. Added separate strict `{enabled:boolean}` Guest and Owner freehand write capability endpoints; existing capability JSON remains unchanged. Capability requires the local-only feature gate AND exact SHA-256 fingerprints of both full annotation guard definitions in D1 sqlite_master; missing/mismatched/unavailable guards fail closed. This fingerprint check passed isolated workerd tests but hosted behavior remains unverified. The capability does not grant authority; command routes continue existing checks. Existing production callers can read supported geometry; brush remains hidden under default OFF and against existing 0054 guards. No migration was adopted.

Guest and Owner refresh write capability on focus, fail closed for new drafts, preserve independent reads and pending journals. Exact already-journaled requests remain retryable even when write capability becomes false so committed requests can recover; server rejects uncommitted ones with 409 uncertain. Root independently ran Guest mock-API Chromium 11/11, Owner mock-API Chromium 5/5, capability route unit 6/6, isolated workerd writer/schema 2/2, root strict and Web TypeScript. Owner unit 21/21 after updating stale preflight fakeD1, per agent. These are not hosted OAuth/R2 or complete E2E acceptance.

An added test-only `apps/worker/tools/freehand-browser-workerd-e2e.test.mjs` with Vite fixtures attempted real browser→Worker/D1. It FAILED before any annotation write: capability/me/annotation reads returned 200; actual image `/api/v1/photos/.../assets/preview` enters Playwright bridge but Worker.fetch does not return. D1 preview row and ephemeral R2 JPEG match size/checksum. No root cause established; retain test/diagnostics, investigate bridge and streamed asset behavior, rerun before any claim of UI→Worker→D1 acceptance. No persistent/customer DB, migration, deployment or flag activation. Delivery/retention remain incomplete; prior delivery 0055 rejection untouched.

## 2026-10-29 — Interactive prototype multi-page navigation

Extended `experiments/gump-demo` with working local-memory overview, projects, project albums, album studio, recent items, favorites, guest selection preview and photo detail/Before-After navigation. Create/share/selection and favorites are connected across the demo pages; all visuals are synthetic, state resets on reload, no real invitation or delivery is created and no product API is used. The demo remains separate from the actual Worker application; it is not proof of MVP completion.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 2/2 Chromium flows passed at desktop and 390x844, covering navigation round trips, create/share, selection/favorites state, guest preview, detail/compare, pointer/touch/keyboard slider, no horizontal mobile overflow, zero /api/ or external-origin requests. Root also used the existing in-app browser to open the actual overview. During implementation a failed stdin file-write attempt temporarily truncated two untracked demo source files; the worker restored them from validated temporary files, checked hashes/JS syntax and completed the passing browser checks. No customer data or production service changed. Prior freehand browser→Worker/D1 E2E failure remains unresolved; delivery and retention remain incomplete; no migration, deployment or 0055 draft changes.

## 2026-10-29 — Prototype single-photo collaboration

The isolated local demo now opens single-photo detail when the thumbnail itself is clicked or tapped. It includes previous/next, return, selection/favorite, Before/After, photographer 1–5 star rating, local per-photo comments, point annotations and colored freehand with show/hide and clear draft controls. Demo ratings, comments and marks are scoped by album/photo and held only in the current tab; no API or external request, real sharing, persistent data or production capability is implied. The UI is a prototype separate from actual Worker application.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: desktop and mobile Chromium 2/2 passed, covering thumbnail entry, previous/next/back, comments and ratings isolation/clear, selection and rating independence, favorites, point and colored freehand (mobile touch emulation), draft controls, comparison, no horizontal overflow and zero API/external-origin requests. Agent additionally reports scoped ESLint/Prettier passing. Initial fixture selector ambiguity was corrected before final pass. Physical phone, real user media, server integration and hosted acceptance were not tested. Modified untracked prototype files were backed up to temp and staged/hash-checked before replacement. No migration/production data/deploy or delivery 0055 changes. Prior freehand browser-to-Worker D1 preview bridge failure remains unresolved; full SaaS goal remains active.

## 2026-10-29 — Prototype responsive image proportions

Fixed the local-only synthetic prototype responsive scenes and icons to maintain proportions rather than stretching independently. Gallery and detail generated visuals use a consistent 3:2 frame; project/album covers retain their own aspect ratios and icon containers do not flex-shrink. The photo annotation SVG uses a matching 150x100 viewBox with normalized X mapping; point/freehand positions remain aligned to the frame and points remain circular on resize. This is CSS synthetic demo art, not proof of real-photo aspect-ratio handling in the actual product.

Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 4/4 Chromium desktop/mobile flow and geometry tests passed, including viewport resize, photo frame ratio, actual pixel circle shape and point/freehand relative alignment. Agent reports Prettier check and `node --check` passed. Initial new geometry assertion used separately normalized axes incorrectly and was corrected before final acceptance. Mobile uses browser emulation, not physical device. Prototype only, no production/customer data or migration changed; formal image/R2 and prior integration test limitations remain.

## 2026-10-29 — Photographer recommendation prototype and metadata foundation

The isolated gump-demo now has per-album photographer recommendation visibility, optional minimum 1–5 star and red/yellow/green/blue/purple label criteria, selectable any/all rule, live per-photo rating and color editing/clearing, and a Guest recommendation list/count. Customer selection remains independent. Default any-mode is a demonstration default; both modes are selectable. This uses synthetic initial labels and in-memory data, not uploaded metadata or the Worker application. Root independently ran `pnpm.cmd exec playwright test --config playwright.gump-demo.config.ts --reporter=line`: 6/6 desktop/mobile Chromium tests pass, including threshold/color/mode/live edit/hide/selection independence and no API/external requests. Physical device not checked.

Added isolated `packages/image-processing/src/photographer-metadata.ts` and unit tests as an UNWIRED foundation. It extracts only selected embedded XMP Rating/Label from bounded JPEG/PNG/WebP via Sharp, reports missing/cleared/rejected/invalid/unknown states and never outputs unrelated metadata/raw label text. It is a deliberately limited strict XML/RDF subset, not standards-complete or production-ready; extended XMP, sidecars and custom/localized label-set mapping are unverified. Exact English color names only are interpreted, which cannot establish arbitrary custom Lightroom label colors. Root independently ran focused Vitest 23/23 and root strict TypeScript successfully; a prior root Vitest run failed 15 tests due to a real root-marker initialization bug, subsequently fixed before the passing rerun. Synthetic encoded images are not real customer upload acceptance. No migration/schema/API/upload pipeline hookup or persistent data change. Next design version-bound source evidence, safe imported-vs-manual precedence/clearing, durable recommendation policy, audited tenant-scoped services/routes/UI, and true bounded upload/processor integration with real format fixtures before claiming the requested feature complete.

Backup caveat: an agent accidentally overwrote the exact temp backup of the task-start untracked demo main.js while staging; a reconstructed pre-feature copy does not match the original hash and must not be represented as exact. Installed current demo remains intact/tested; an older responsive snapshot and exact task-start CSS backup remain in Temp. Delivery/retention and actual freehand browser→Worker/D1 integration remain incomplete; no 0055 draft touched.

## 2026-10-30 — Prototype and R2 next steps

- [x] Add local demonstration navigation for Owner/Guest workflows and processing-priority settings; Cloudflare-first default and Oracle candidate. These are demo-only, not provider integration.
- [ ] Identify the intended Cloudflare account and isolated staging bucket; verify private R2, CORS, signed browser upload and checksum end to end before enabling hosted upload.
- [ ] Implement persistent processing policies, Oracle and Cloudflare processing adapters, explicit fallback and real usage monitoring; do not infer operational status from demo controls.
- [ ] Complete hosted and mobile acceptance, OAuth setup and production readiness; preserve deletion OFF and existing deployment gates.

## 2026-10-31 — Kino Pick naming

Formal product name: Kino Pick（奇諾選圖）. Display names and current documentation updated; existing internal identifiers and historical evidence remain unchanged for compatibility. Directory rename pending if Windows reports an active process. No cloud, migration or customer data changes.

- [ ] Verify live signed browser upload to staging R2 with scoped credentials, checksum and create-once fence; configure actual staging origin before hosted use. See 2026-10-31 handoff.

- [x] Live R2 signed browser PUT, create-once replay and byte hash validated in isolated test (2026-10-31); full product pipeline remains pending.

- [ ] Complete kinostudio repository setup, scoped B Actions credentials and staged migration/restore/OAuth/hosted acceptance; deployment gate remains closed.

## 2026-10-31 — Deployment connection checkpoint

- [x] kinostudio/kino-pick private repository created and full scoped source published.
- [x] B-only no-expiry Actions deployment token saved after explicit user confirmation.
- [x] Actual GitHub Actions B connection check passed: https://github.com/kinostudio/kino-pick/actions/runs/41114135793 .
- [x] Local latest 820 unit,61 integration,typecheck/lint,and 26 dedicated browser cases passed.
- [x] Latest CI41118459908 executable5d425ec: all23 steps completed/success, including820 unit,61 integration,40 browser,368 Cloudflare checks. Prior brand failure fixed; canceled41116402851 was still advancing.
- [ ] Confirm GitHub top-level finalization of41118459908: at closeout run/job remained in_progress/null despite all steps succeeding, including Complete job.
- [ ] Complete original migration/restore/provider/hosted acceptance and reviewed cutover; website not deployed and readiness guard remains closed. No FILM.KINOSTUDIO resources/integrations changed.

- [x] Final complete local Cloudflare regression:368 checks,exit0; evidence apps/worker/.local/cloudflare-ci-2026-10-31.log. Hosted/OAuth acceptance remains pending.

- [x] Block native photo right-click and drag-save across Worker/Next/prototype; preserve download controls/permissions. Scoped type/lint/build and six prototype browser cases pass. Local-only; actual iOS long-press and hosted acceptance remain unchecked.

## 2026-10-31 — CURRENT online MVP critical path

Canonical order and acceptance: [MVP_RELEASE_PLAN.md](MVP_RELEASE_PLAN.md). This supersedes stale next-task suggestions above without deleting product requirements.

- [x] R0: audit source/release blockers; implement release:inventory and four safety tests; activate existing61-minute heartbeat for automatic continuation.
- [ ] R1-01: establish B staging HTTPS origin/callbacks, real Google/GitHub OAuth and fixed Owner bootstrap; preserve closed public registration.
- [ ] R2: isolated staging schema/representative D1+R2 backup/restore/parity.
- [ ] R3: hosted private100-photo upload and actual Cloudflare-first thumbnail/preview processing with quota/retry and gallery.
- [ ] R4: hosted Guest collaboration/version/recommendation real-service acceptance.
- [ ] R5: fixed approval/delivery/download/notification plus retention dry-run UI and security acceptance.
- [ ] R6: evidence-backed cutover, independent production resources, publish and fresh-browser end-to-end acceptance; record URL/GitSHA/deployment/schema/restore point.

MVP has not been published. Original deployment gate remains closed; no A/FILM.KINOSTUDIO changes.

- [x] R1-01a: create and verify B workers.dev namespace, set planned staging origin and fix Google/GitHub callback paths; Worker remains unpublished.
- [x] R2 preflight: remote staging D1 has only _cf_KV, read-only query changes0; no product migration applied.
- [ ] R1-01b: one pending browser confirmation for new kinostudio Kino Pick Staging OAuth app/Client Secret; form prepared, do not reuse CMS app or ask duplicate confirmation. Then configure private runtime credentials and fixed Owner bootstrap.

## 2026-10-31 — OAuth provisioning supersedes pending confirmation

- [x] R1-01b: user approval received; GitHub OAuth App3979161 created with exact callback; Client Secret/session secret saved in ignored ACL-protected local file and B staging secret_text bindings; no values in Git/chat.
- [x] B staging infrastructure-only503 container initialized with workers.dev/Version URLs disabled and no product/data bindings; this is NOT product deployment.
- [x] Stable kinostudio subject verified; one-time Owner bootstrap SQL/proposal prepared,not applied.
- [ ] R2 next: isolated schema backup/restore/upgrade/parity,then Owner bootstrap and controlled real GitHub login/session acceptance. Google credentials remain pending.

See STAGING_AUTH_PROVISIONING.md. Do not repeat the confirmation/Secret request or rerun the provisioning config over the eventual product. Original production cutover gates remain closed.

## 2026-10-31 — CURRENT cloud database / Owner auth milestone

- [x] Existing54migrations applied to empty B staging only after freshbackup and localnative rehearsal.
- [x] Independent B remoteD1 restore:134tables/schema/rowhash and SQLSHA parity,FK0. R2-inclusive/full-product restore is still pending.
- [x] Fixed Owner initialized once; real GitHub PKCE login and logout,session/audit counts verified;6hosted negative checks pass.
- [x] Temporary auth-only public URL disabled after acceptance; original product/production guard remains closed.
- [ ] One pending user action: isolatedB Cloudflare login inIABtab6 for R2bucket-scoped signing key configuration. ExistingCLI tokenmanagement403;do not repeat question or touchEdgeA.
- [ ] R3 parallel: realCloudflareImagesadapter/newrecipe+compatiblemigration/durablepriority andquota;then100-photo privateupload→derivatives→formalGrid/Lightbox.
- [ ] RealGoogle/providerlink-unlink/fullsession management,R2consistentbackup and remainingGuest/delivery/retention/productionrelease remain.

Canonical current evidence/recovery: STAGING_DATABASE_AUTH_ACCEPTANCE.md. No onlineMVP claim.

## 2026-10-31 — Current R3 handoff

B login and bucket-only R2 credential creation/storage are completed with user approval. Real S3 PUT200/replay412/hash-matching GET200 and signed CORS allow204/foreign403 pass. Native Images binding also generated and verified two private synthetic derivatives via real remote development. See latest HANDOFF for exact proofs and limits. These are capability checks, not product/100-photo/hosted MVP acceptance; public entry remains closed and private_direct_upload_verified remains false. No further key/login request is pending. Next implement the genuine Cloudflare recipe/adapter plus compatible durable-job migration; retain immutable Sharp recipe, quota/source/output guards and draft-SQL exclusion. Keep A untouched, auto-delete OFF/dry-run. gh works outside Wrangler-isolated XDG; prior CI41118459908 completed/success.

## 2026-10-31 — R3 source publication checkpoint

Snapshot21fa48431659dcd0ae1224d7eb68c54feb399314 was pushed to private kinostudio/kino-pick main and remote SHA was verified. Thirty changed files preserve the original foundation worktree/index;699 candidate files passed OAuth/R2 credential-value scanning with zero matches. No customer migration or product deployment ran. CI checks41135636903 is in_progress at this checkpoint; do not call it passed until final status is verified. Newly added isolated auth dry-run/native10 checks, whole-tree Prettier and54-file handoff presence checks passed locally; prior lint/type/provider evidence retains its stated scope. Next execution must check this single CI run, fix any real failure, then implement the Cloudflare adapter/recipe/durable-job slice. No repeated login/key approval is needed.

## 2026-10-31 — R3 actual Cloudflare Images adapter implemented

Previous source21fa484 CI41135636903 completed/success (all steps including isolated auth validation). Implemented the existing image-processing interface with distinct cloudflare-images-jpeg-82-v1 recipe; extracted/reused animation checks without changing Sharp behavior. Strict snapshot/hash/raw dimensions,16MiB internal source cap, sequential bounded output streams/cancellation, progressive-scan metadata stripping and provider-error sanitization are implemented. New7+old10 focused tests pass; scoped lint/rootstrict pass. Real B remote-development now invokes this adapter and returned200 with two private checked derivatives; proof worker.local/cloudflare-images-adapter-result.json. Probe stopped; no product/DB/A changes. See docs/CLOUDFLARE_IMAGE_PROCESSING.md for limits and exact next migration/recipe integration. It is not registered in the product: existing64MiB upload ceiling and immutable Sharp job recipe must be reconciled explicitly before activation. No normal-size hosted/100-photo/MVP claim; product gate and auto-delete remainOFF. This slice contains no migration to apply or customer-data change.

## 2026-10-31 — Adapter publication checkpoint

Published and verified private main cdddc19f75ca99180e0bb1c85dc616b97b413862, preserving original HEAD/index.703 Git candidate files scanned for approved OAuth/R2 secret values:0matches. New CI is pending completion; verify the run for this SHA next, without rerunning the already-green prior CI41135636903. Actual adapter probe passed at worker.local/cloudflare-images-adapter-result.json; remote-dev session22258 stopped. Next highest-priority slice is compatible processing-recipe migration/durable integration and the16MiB-versus64MiB admission decision, then hosted upload/derivative/gallery acceptance. No new login/credential approval needed; no D1 migration or product cutover occurred this slice.

## 2026-10-31 — R3 compatible processing migration adopted in B staging

Read docs/STAGING_PROCESSING_ACCEPTANCE.md.0055 now exists and was applied ONLY to B staging after fresh backup, isolated native populated8-group acceptance and an independent cloud restore+upgrade. Remote staging ledger55;133 original product tables unchanged,FK0,schema equals independent upgraded cloud DB66bba5de-c020-40a5-b8a0-f2431bc8f781. Public entryfalse;default local persistent D1 still0052. Never regenerate/overwrite applied0055 or run the old54-only rehearsal against the55 source tree.

New persisted per-workspace Owner policy API/UI, exact-recipe claims/review keys,16MiB Cloudflare admission and bounded durable upload-wake/Cron integration are implemented; cloud runtime defaultsOFF/production activation guarded.20 scoped unit tests,8 native/API/mobile groups,rootstrict/scopedlint and Worker/UI build passed; real cloud full upload/Images/gallery100-photo flow remains pending. Fresh protected exports and proof paths/recovery/failed diagnostics are in the acceptance doc. Main product gate and unfulfilled readiness remainclosed;auto-deleteOFF/dry-run,single-node. Previous cdddc19 CI41139959773 passed;new source requires one CI run. User selected pick.kinostudio.tw and confirmed DNS in A;no A/DNS change has been made. Next gated hostedOwner upload/Images/gallery acceptance and D1/R2-consistent restore; do not rerunOwnerbootstrap or request keys already saved.

## 2026-10-31 — CURRENT: B staging56; upload/processing/gallery integration accepted in isolation

Supersedes prior55-only checkpoint:0055 remains immutable;0056 adds reciprocal Owner request namespace and bounded Cloudflare IO-review guards. Actual B staging AND independent rehearsal DB now have56 migrations; fresh private backup/parity/FK0 passed,135 existing product tables unchanged and public/preview entryfalse. Details/recovery: docs/STAGING_PROCESSING_ACCEPTANCE.md; protected `.local/staging-0056-apply-proof.json`. No A/DNS/customer/default-local mutation.

Final focused20 unit checks and10 isolated native/API/mobile groups pass, including atomic migration rollback, old job preservation, Owner policy persistence/replay/collisions/tenant denial,16MiB quota-safe refusal, V1/V2 completion-aware busy lock, Cloudflare recipe claims and review fences, three transient failures→IO review with reservation retained, private derivative/gallery finalization and375px save/reload. The integration uses a Sharp-backed Images double; earlier real Cloudflare adapter probe is separate. Worker/UI build,root/Web strict and scopedlint pass; full-chain test harnesses now use official split+atomicbatch for the larger migration. Production/cloud flag defaultsOFF and release gate remainsclosed.

Next concrete task: push this source, verify its single CI run, then create a narrowly gated hostedOwner B upload validation with native Images/private R2/gallery/100 test photos and D1/R2-consistent restore. The updated product Worker itself has NOT been deployed; remote schema success is not hosted product acceptance. Preserve missing Google/link/session/Guest/version/delivery/security requirements and do not mark MVP released. User-selected production hostname is pick.kinostudio.tw in A; existing staging callbacks stay unchanged. Prepare hostname-only entry routing without root/NS/existing A deployment changes and resolve exact permissions before applying. No repeated credential/login request needed.

## 2026-10-31 — Published processing integration checkpoint

Private main6709d0bdab307f9ddb7b76ce47f0b5e0a91f2ae2 was pushed and remoteSHA verified.714 Git candidate files had zero approved OAuth/R2 credential-value matches;original HEAD/index preserved. CI41147833540 is running (last observed typecheck,no failures);do not claim a pass before finalization. Next read that one run and fix any actual failure,then perform narrowly gated hostedOwner R2/Images/gallery acceptance. B staging schema56 is already adopted with verified backups and independent cloud parity;the updated product Worker is still not deployed. No A/domain/public-entry change. Currentselecteddomainpick.kinostudio.tw remains a future release hostname,not a live-site acceptance URL.

## 2026-10-31 — Owner hosted-upload validation prepared; CI hold enforced

Added a closed-by-default B-only staging upload validation entry/config, reusing actual product Owner auth/API/UI with only direct upload/Cloudflare processing enabled. Guest routes/registration/production/foreign host+Origin are rejected;no original feature guard is removed. Actual dry-run/rootstrict/scopedlint pass and14 isolated route/static/denial checks pass. Images is a presence double here;not a provider/hosted upload result. Read docs/STAGING_UPLOAD_VALIDATION.md.

Added scoped tools/check-staging-upload-validation.mjs coupling adopted56/independent restore,Secret names,exact tested bundle and successful core CI plus unchanged backend/UI via temporary index. Actually ran it: CI41147833540 at6709d0b is stillin_progress,so gate correctly refused. No deploy/public-entry/DB/R2/A/DNS change this heartbeat. Prepared source is local/unpushed pending the existing CI outcome;preserve it. Next check only that run,fix any actualfailure,then refresh safe CI metadata and proceed with exact scoped preflight/publication/controlled hosted Owner validation. No new credential/login/useroperation is required now. Do not claim MVP release or private_direct_upload_verified.

## 2026-10-31 — Core CI finalized; restricted Owner upload preflight passed

CI41147833540 completed/success for6709d0b with no failed steps. Refreshed actual safe CI metadata and ran scoped tools/check-staging-upload-validation.mjs:passed_owner_upload_staging_preflight. Backend/UI inputs match accepted CI through a temporary index;config/source/bundle match the14-check native validation and adopted56/independent-restore proof. No production deployment is authorized by this gate. The new Owner-only entry/config/checker are ready for exact source publication and CLOSED B deployment,then metadata/denial checks before controlled public staging validation. Do not call this hosted product or100-photo acceptance yet;existing main product/production guard and readiness remainunchanged. A/DNS unchanged. Native Owner boundary check added to CI without rerunning broad suites locally.

## 2026-10-31 — CURRENT: 真實 hosted Owner／100 張 R2＋Images 圖庫驗收通過

B 的 Owner-only staging 已實際部署，來源 `7be9f78496103076f110a4f9e58e96788265f1da`，Worker version `1441d058-27f1-44e8-9440-4861f88d7f47`；CI41154235653 completed/success。真實 GitHub Owner 登入後，以產品介面建立測試 workspace/project/album，五批各20張合成JPEG經瀏覽器私人R2直傳及原生Cloudflare Images完成。100 jobs succeeded、300 assets、reserved0；全部300個物件GET/byte/SHA檢查通過，200衍生JPEG完整解碼、320/2048尺寸及比例、metadata移除與10張EXIF6方向通過。實際Edge圖庫24→48→72→96→100、100個唯一檔名／全部縮圖載入；直式1000×1600與下一張橫式1600×1000燈箱、關閉操作通過。匿名私人縮圖401，原7項hosted邊界通過。

這是受限 staging Owner 流程，非完整MVP。`private_direct_upload_verified`仍不提升為完整發佈就緒：跨租戶／配額故障hosted、含R2的備份復原及Guest等要求仍需完成。詳細scope/證據/復原下一步見 docs/HOSTED_100_PHOTO_ACCEPTANCE.md。D1已有新受ACL保護的匯出，尚未獨立restore，R2物件尚未備份。public staging目前enabled、previewfalse；其他產品feature仍OFF，無Cron／production／A／DNS改動。既有production gate保持closed，自動刪除OFF/dry-run，單R2節點。

下一切片：先完成這100張資料的D1＋R2一致備份與獨立復原，再修正Cloudflare政策16MiB但UI顯示64MiB／未設定Google仍顯示可點登入的能力宣告，依序完成真實雙OAuth綁定與Guest/版本/交付hosted驗收。不要重傳100張、重建Owner、重套0055/0056或重問憑證。保留原worktree/index與未提交變更。

## 2026-10-31 — 100-photo acceptance source publication checkpoint

Private main `1fc914edf79dcba41434f5ab69792222581beb7e` was pushed and remote SHA verified;9 intended files,721 candidate-file credential scan with0matches;original HEAD/index preserved. CI41162510021 is in_progress at handoff,not yet accepted. Actual deployed pilot remains7be9f78/version1441d058-27f1-44e8-9440-4861f88d7f47;no redeploy was needed for operator-tool/docs-only changes. Next check only this CI run,then complete fresh D1/R2 consistent backup/independent restore using the protected100-photo snapshot. Do not re-upload100 files or repeat the passed300 GET verification without a new backup/restore purpose. Edge validation tab1650468828 is retained for continuation. No user operation is pending.

## 2026-10-31 — CURRENT: 100-photo snapshot 獨立D1＋R2資料復原通過

B 新D1 bcf68fb8-0079-4c8d-b2a0-745c1aa97a26 與新私人桶kino-pick-restore100-20261031已真正還原完整snapshot。136表／2782列／726triggers／56migrations的schema、逐表hash、sequence與FK0通過；300物件自本機受保護備份還原並讀回SHA全吻合，共8,913,629bytes。原DB／原桶無寫入刪除，無A/DNS/Worker部署變更。已解決真實export的表／唯一索引／trigger載入順序問題，正常app guards及0055/0056保留。詳見docs/HOSTED_SNAPSHOT_RESTORE.md；以private consistent-restore-proof.json為準，不修改原匯出checkpoint的false狀態。

此為資料復原，不是恢復站runtime切換、新桶上傳簽名設定或完整MVP。CI41162510021真實failure：Guest測試helper未捕捉Miniflare socket rejection；新修正CI未通過前不能標green。先完成此最小CI route lifecycle修正，再接Cloudflare16MiB/登入能力UI與Google/Guest/版本/交付hosted驗收；不要重傳100張、重跑已過的復原、重建Owner或重問既有憑證。production gate及自動刪除仍OFF/dry-run，正式預設單R2節點。

## CI helper 最小修正已實作，等待新CI

`apps/worker/tests/guest-entry-ui-browser.mjs` 現追蹤所有route tasks，捕捉dispatch/route rejection，六個情境先page.unrouteAll(wait)並drain再關context，最後以AggregateError保留失敗；沒有POST retry，也沒有忽略真正transport failure。原53個assert呼叫經AST比對逐一相同。helper node syntax／scoped ESLint／Prettier通過，兩個復原工具scoped lint/format通過；未另跑全套本機smoke，新CI尚待。這處理未捕捉Promise及teardown邊界，不宣稱底層UND_ERR_SOCKET成因已完全修好。
