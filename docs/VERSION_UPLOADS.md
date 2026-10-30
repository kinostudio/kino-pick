## 2026-10-27 — M3b manual version uploads accepted locally

This supersedes the pending M3b checkpoints below. Full run30293 (.local/m3b-api-eighth.log) terminated successfully:179 local workerd/D1/R2/Chromium checks passed. New cases prove fixed immutable reservation targets, current Owner/tenant/photo authorization before replay, head/mode-shift preservation, private same-photo versions, unique concurrent numbering, canonical audit/results, audit-failure rollback with exact retry, quota accounting, cancellation fences, stale new-init CAS denial, default-OFF bypass denial, immutable target/completion primary/alternate/null/UPDATE/DELETE defenses, and375px explicit replacement/file selection/SigV4-checked local R2 upload/lost-completion/reload/reselect recovery with the V1 head unchanged. Existing M3a current-head and other feature regressions passed in the same run.

Also passed:174 unit tests/30 files,61 reference integration/10 files, strict Worker/shared/Web typechecks, final full lint (48177), Next production build, targeted format and git diff checks.38-file documentation presence check passed. Reference-app Playwright was not rerun in this session; Worker-target Chromium is included in179 checks. Hosted OAuth, real R2 CORS/S3/edge and deployment are not verified. The browser R2 bridge uses synthetic credentials and local Miniflare storage.

0037 applied ONLY to local development D1:34 commands. Follow-up migration list has none pending; foreign_key_check returned empty; new targets/completions are empty. Pre-migration backup is apps/worker/.local/d1-before-0037-20261027.sql (git-ignored). No remote/customer migration, commit, push or deployment. Keep all feature flags OFF/hard-local and automatic deletion OFF/dry-run.

Recovery: disable version writes and keep immutable targets, completion ledgers, assets, processing jobs and audit. Repair forward with a new migration. Restore the local backup only into a verified isolated recovery copy; do not drop0037 tables beneath code whose generic upload queries now reference both completion ledgers. Do not remove history to roll back application behavior.

Full M1–M5 remains active. Next required slices: project version-mode controls and enabled filename/assisted matching, Guest scoped version history/comparison slider/side-by-side/overlay, followed by comments/annotations, full operation history, delivery/notifications/retention and hosted acceptance. Same-invitation comments may be shared; different invitations remain isolated. Completion still leaves the original current head; exposing a ready version requires a separate explicit CAS switch.

## 2026-10-27 — M3b API contract and manual intent UI

Current verification:174 unit tests/30 files and61 reference integration tests/10 files passed. Full lint passed after removing an unused fixture variable and an unused UI suppression. Web strict typecheck and targeted UI lint passed after the flat completion-response fix and manual intent selector. Documentation checker verified38 files; this is presence only.

The Owner uploader now explicitly offers new_retouch or replace_current in enabled modes. Off mode forces replace_current; any replacement requires confirmation. Both preserve immutable history and leave the current head unchanged until a separate ready-version CAS switch. These new UI paths still require Chromium acceptance.

Fifth full local Worker run4554 terminated at .local/m3b-api-fifth.log: existing Guest history and the canonical public V1 setup passed, then new version reservation returned200 where creation expects201. The version init router now returns201 consistently with ordinary creation; no security assertion was relaxed. The next full run is pending expanded V2 rollback/integrity/stale-CAS tests and a self-contained browser fixture.0037 is not applied persistently. Hosted OAuth/R2/edge, deployment and full M1–M5 remain incomplete; flags remain OFF and retention dry-run.

## M3b active integration and first regression feedback

Reviewed0037 SQL, common upload service and strict version router are now integrated into active source behind all default-OFF local gates; current TypeScript check passed. Original service backup is .local/m3b-draft/live-uploads-before-integration.ts.0037 is in active migrations but is NOT applied to persistent local/remote D1. The dedicated HTTP/R2 helper is being written; existing full regression run75668 stopped at guard-priority compatibility before version API cases.

The new valid-V2 workflow gate masked established invalid scope/dimension/identity errors. Its WHEN filter now delegates malformed basic records to the existing0011/0012/0033 guards, retaining the upload-workflow requirement for valid new V2. Isolated behavioral probe passed again after this change. The probe was pinned to baseline0001–0036 after promotion to avoid accidentally applying0037 twice. Old M3a V2 fixtures are being changed to authorized version uploads rather than bypassing the new guard; initial non-current versions will be captured-parent siblings and queued targets remain unready. No security assertions are removed.

Journal module/tests passed focused5 cases; draft UI remains unwired. M3b HTTP/R2/processing/browser/full regression acceptance remains pending. Full M1–M5 stays active; no deployment or new persistent migration.

# M3b immutable manual version uploads

Status: in development. Contracts and capability dependency checks are implemented; SQL/service drafts are isolated under .local/m3b-draft and are not applied or wired into production APIs. M3a current-version switching remains accepted locally. Full version upload is not yet usable.

## Fixed reservation target

POST /api/v1/photos/:photoId/versions/init will derive workspace/project/album/photo from the current Owner scope. The strict request includes requestId, originalFilename, expectedBytes, contentType, sha256, expectedRevision, expectedCurrentVersionId, changeType, changeNote, labels and confirm:true. changeType is new_retouch or replace_current. Notes/labels must be explicit (empty allowed), canonical NFC/trim and bounded; no caller tenant IDs or completion-time retargeting are accepted.

The canonical upload reservation keeps the existing seven fields and adds versionTarget with photoId,parentVersionId,expectedRevision,changeType,changeNote,labels,confirm:true. Parent is the captured expected current version. Store an immutable target in the same reservation statement; do not rely on independent AFTER-trigger ordering. Legacy reservation result JSON remains unchanged; the version wrapper reads target metadata separately and returns uploadSession/target.

## Mode and visibility

Manual, auto_filename and assisted modes may explicitly add a retouch version without filename inference. Off permits only an explicitly confirmed replace_current intent that preserves old assets. Completion creates a private immutable version and original asset, queues existing processing, and never changes the current head. Exposing a ready target still requires the explicit CAS switch; a changed head requires renewed confirmation. Filename matching and comparison interfaces remain later required work.

## Reuse and completion

Reuse immutable object keys, quota reservations, presign bindings, R2 byte/MIME/hash/dimension inspection, review holds, cancellation fences and processing jobs. Completion input stays requestId only. Allocate the next unique photo version number atomically. Because legacy upload_completions.photo_id is unique, use a separate immutable version-completion ledger and preserve the ordinary V1 branch and replay shapes.

Every completed-state query, cancellation/expiry guard, recovery response, archive-busy check and quota conversion must recognize both completion ledgers. A completed version must not remain apparently reserved. Generic upload routes may not bypass the version capability or fixed-target authorization. Check current Owner/session/target/parent authority before reading a version replay result.

## Capability and verification

PHOTO_VERSION_UPLOADS_ENABLED defaultsfalse and is hard local-only. versionUploadCapability additionally requires DIRECT_UPLOAD_ENABLED and PHOTO_VERSIONS_ENABLED; all eight dependency combinations are tested. Current focused contract/config acceptance:23 tests passed. No upload API/runtime acceptance is claimed.

Next gates: populated migration preservation and ordinary V1 regression; exact init recovery/namespace conflicts; fixed target and parent; concurrent V2/V3 numbering; real direct upload/verification/processing; stale head confirmation; canceled/expired capability fencing; completed-state/archive accounting; current authorization before replay; failed audit full rollback; immutable primary/alternate/null defenses; Owner browser file selection, retry/recovery and375px. Apply no remote/customer migration. Recovery disables version upload writes, preserves targets/completions/assets/audit, and repairs forward.

## Lost-init recovery and parallel drafts

versionUploadRecoverySchema extends the existing upload recovery response with the immutable target. It rejects storage keys, signed URLs, session IDs and unknown fields. recoveryVersion(photoId,initRequestId) must verify current Owner/session/photo/parent scope before returning metadata; an exact init retry recovers the same target even if head or mode later changes, subject to current access authorization.

SQL draft captures the project mode from D1 at reservation. Service draft and single-photo UI draft are isolated alongside it. UI endpoint strings remain provisional until route/service integration is reviewed. The UI must use existing upload journal/recovery semantics and report any needed target-journal extension; no ad hoc secret-bearing browser storage is authorized by this slice. Completion retains the old current head, and a later explicit ready-version confirmation switches it.
