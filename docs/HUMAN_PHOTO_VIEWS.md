# Authorized visible-photo heartbeat

## Current candidate: 2026-11-09 G2-03

The G1 hosted baseline is schema67 with tracking OFF. This continuation prepares activation only in the exact Cloudflare B collaboration scope; arbitrary staging and production remain rejected. It does not deploy, adopt schema68, enable automatic deletion, or establish continuous historical tracking coverage. The schema68 policy candidate defaults to90 days and OFF; earlier source-only/local-schema/30-day statements below describe their historical checkpoints.

The existing Owner/Guest routes and real D1 service are reused. Prefetch/prerender purpose headers and recognized bot/crawler/spider user agents are rejected before writes. Browser tracking additionally excludes prerendered documents and photos behind an active visible modal. These are heuristics, not proof that a client is human. A visible, authorized grid thumbnail can qualify; fetching an image or metadata by itself cannot.

`node tests/human-views-focused.mjs` (from `apps/worker`, after product build) passed 14 named local checks with fresh ephemeral D1/R2, Sharp and controlled Chromium at375px. This includes modal/background exclusion before the first event, focus recovery, one-second continuous exposure, shared grid/lightbox cooldown, authorization refusals and atomic audit-failure rollback. The injected audit failure is expected negative-test output. Proof: worker `.local/human-views-focused-proof.json`; final log: `.local/human-views-focused-second.log`. These synthetic sessions are not real OAuth or hosted acceptance.

The B native runner passed its original33 checks plus6 Human sidecar groups (and empty FK checks). Its normal test worker explicitly overrides tracking OFF, while the otherwise equivalent B sidecar runs ON; both are recorded separately in `.local/human-view-b-profile-proof.json`. New release receipts require source-bound native/browser proofs for68/ON and preserve the exact prior67/OFF and older68/OFF contracts. Source-bound validation and pure release-guard tests passed. Full release self-test still rejects the missing genuine0068 restore/adoption manifest. See `docs/releases/g2-human-view-local-readiness.json` for safe evidence and retained fixture/transport failures.

The future cleanup adapter must still establish reliable coverage across disabled/outage periods and protect active reads/downloads and the first visibility qualification window. Missing events never authorize deletion. Same-browser unique-visitor/IP activity is a separate existing telemetry path; this slice does not change its identity or permissions.

Status: implemented and accepted in isolated local workerd/D1/R2/Sharp/Chromium. Default `HUMAN_VIEW_TRACKING_ENABLED=false`; hosted activation is rejected. Migration0053 is source-only; persistent local D1 remains0052. No automatic deletion,quota release or production deployment is enabled.

## API and authority

`GET /api/human-views/capabilities` returns `{enabled,minVisibleMs:1000,dedupeMs:300000}`. Owner `POST /api/v1/albums/:albumId/view-heartbeats` and Guest `POST /api/guest/albums/:albumId/view-heartbeats` take strict `{photoId,versionId,expectedActorId,visibleForMs}` and return `{recorded,nextAllowedAt}`. No client time or request ID is trusted;the server generates separate event/request UUIDs and uses D1 time. JSON bodies are bounded to4KiB;same-origin,fetch-site and Worker-subrequest checks apply.

Owner/Guest identity,live session,enabled workspace Owner,active album,photo/version scope,immutable private original and complete processing outputs are rechecked before dedupe/write. Guest requires can_view;historical versions additionally require the existing comparison/published-version rule. Download permission does not grant viewing or renew activity. Unknown/revoked/foreign Guest scope uses uniform401;Owner resources are scoped to their workspace. No R2 secret/object key is returned.

## Atomic evidence

`human_photo_views` is append-only with a rolling indexed five-minute window per authorization session/actor/album. The insert atomically advances `album_human_activity` monotonically and appends `gallery.viewed` with exact actor/session/scope/photo/version/UTC/request and safe `{source:'visible_photo',visibleForMs}`. Native guards reject forged actor/audit/projection updates and log mutation/deletion. An audit failure rolls back both event and projection. Duplicates do not extend last-view time;their nextAllowedAt is exactly the existing witness time+300000ms. Owner history gets a safe projection/label;Guest history visibility is not broadened.

## Browser signal

Owner and Guest Gallery grid/Lightbox images use the existing DOM with a tracking provider. A private URL must match the photo/version IDs,the image must be loaded with naturalWidth>0,at least50% intersecting,and the document visible/focused continuously for at least1s. Blur/pagehide/visibility loss/unmount/scope changes reset/cancel. Per-gallery inflight/cooldown state coalesces image reports;server deadlines are honored,without extending a duplicate by another five minutes. Tracking is optional telemetry and never blocks gallery controls. Download-only pages have no provider. Before/After canvas-specific tracking and broader headed/device acceptance remain separate coverage work.

These are observable browser heuristics,not proof of a human or perfect occlusion/attention detection. Client-reported visibleForMs describes qualifying exposure,not an authenticated attention measurement. Pure API/image/metadata/health/Cron requests never generate a view by themselves.

## Legacy data and cleanup safety

A missing event is not evidence that an old album was never viewed. The pure planner now requires `activityEvidenceVerified`;false excludes an album with activity_unverified. A real snapshot adapter must establish continuous tracking coverage and reliable recent-state evidence,including feature-disabled/outage periods,before using a null last-view timestamp as the never-viewed baseline.0053 alone does not prove that coverage. Publication/state/protection/policy/busy/reference witnesses and the full D1 planner/Owner policy UI/confirmation/jobs/retries/reconciliation are still unfinished. Never turn this projection into immediate deletion authority.

## Focused verification

`apps/worker/.local/human-views-focused-final.log` exited0:three API groups and two375px Owner/Guest browser flows using one real uploaded/Sharp-processed private image. Covered:atomic witnesses and exact deadline/immediate dedupe;subsecond/untrusted timestamp/origin/Worker/download-only/foreign identity/scope/revocation denial;native forged Owner actor/audit/projection/log guards;injected audit-failure rollback;workspace usage and asset preservation. Browser proved management-list/unloaded/hidden/subsecond/blur exclusion,continuous visible recording and shared preview cooldown. Headless focus/visibility was explicitly controlled;this is not headed-device acceptance or a natural five-minute elapsed-time test.

Eleven contract tests passed in the assigned agent;thirteen pure-retention safety tests pass including legacy activity gaps. Final build,generated bindings,root/Web strict and scoped lint pass. Logs are in root `.local/human-views-*.log`;acceptance JSON is worker `.local/human-views-acceptance.json`. Earlier failures are retained:first0053 parenthesis error;second test bridge mistakenly held static JS as an image;later Web strict regex-index error. These were corrected,not reported as successful runs. No broad suite was repeated.

## Recovery and next work

Disable the tracking flag first. Preserve0053 tables,projection,audit and guards;prefer forward fixes and never restore an older backup over newer events. Persistent adoption needs fresh backup/isolated restore-upgrade/live parity proof and must preserve every old table/history. Current local database is still0052.

The user confirmed one authorized client may approve a fixed version as a representative. Next implement the explicit Owner-authorized immutable request/invitation/Guest confirmation flow,then a fixed delivery manifest. Do not ask the one-versus-all question again. The full M1-M5 goal remains active.

## Execution race boundary

A preview may be authorized/loaded before its first qualifying one-second heartbeat. The future cleanup executor must protect in-flight read/download grants and this qualification window under its activity/lock/grace rules;it must not treat a missing not-yet-qualified heartbeat as evidence that no one is using the album. These short-lived safety holds must remain separate from the30-day valid-human-view timestamp,so preloads or downloads do not falsely renew inactivity. No physical cleanup is implemented or certified by this heartbeat slice.

## 2026-10-29 — CURRENT follow-up: append-only REPLACE and equal-clock safety accepted

This extends/supersedes the earlier three-group human-view checkpoint:the final focused native run `apps/worker/.local/human-views-replace-safety.log` exited0 with4 API groups +2 controlled375px Owner/Guest browser flows.0053 now rejects duplicate event_id OR request_id before INSERT,so SQLite REPLACE cannot bypass append-only delete guards. Projection upsert is attempted only for an advancing frontier;two valid same-millisecond events both remain in log/audit while the maximal timestamp/UUID witness stays canonical. Native replacement/event/request/projection and equal-clock cases pass. Final test fixture selects the known non-frontier witness for timing stability;scoped lint passes. Evidence `apps/worker/.local/human-views-replace-acceptance.json` preserves the earlier checkpoint and its log rather than rewriting evidence.

0053 still SOURCE ONLY;default D1 stays0052,tracking OFF/hard-local,automatic deletionOFF/dry-run. activityEvidenceVerified must cover the policy's decision window;missing legacy/offline data is never proof of inactivity. Future deletion must separately protect in-flight authorized reads/downloads and the first1s visibility qualification window,without renewing the30-day timestamp for preloads. No physical deletion/hosted acceptance claim. User's one-authorized-client representative version approval rule is confirmed and next for implementation;fullM1-M5 remains active/incomplete. All existing document history and unrelated dirty changes are preserved.
