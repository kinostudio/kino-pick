## 2026-10-28 — M3g5 independent processing integration in progress

See [ANNOTATION_PROCESSING.md](ANNOTATION_PROCESSING.md) for separate Owner decisions on Guest annotations, dual source/processing CAS, body-free immutable receipts, current-reader clocks and recovery. Contracts/service/routes/read/UI are integrated behind default-OFF hard-local OWNER_ANNOTATION_PROCESSING_ENABLED; full actual runtime acceptance is pending. Guest annotation geometry/authorship/lifecycle and own recovery/result schemas remain unchanged. Persistent D1 remains0046;0047 is source-only. All hosted gates OFF, deletion OFF/dry-run.

## 2026-10-28 — M3g4 locally accepted

Genuine Owner annotation authoring and invitation-shared mixed-role reads are locally accepted with308 complete Worker/D1/R2/Chromium checks and467 unit tests. Real375px geometry/lifecycle/reload/exact replay and actual disabled-Owner403 privacy/journal preservation passed; Root inspected the actual photo/red-rectangle capture.0046 is applied LOCAL ONLY after a new verified backup/isolated restore/110-old-table hash parity:114 tables/same4 development rows/4 new empty Owner tables/FK0/no pending migrations. All gates remain OFF/hard-local and deletion OFF/dry-run; no hosted acceptance. See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) and latest HANDOFF for contracts, logs, recovery and unfinished Owner processing/history work. Earlier in-progress checkpoints below are historical and superseded.

## 2026-10-28 — M3g4 Owner annotation integration in progress

See [OWNER_ANNOTATIONS.md](OWNER_ANNOTATIONS.md) for genuine Owner commands, independent schema0046, author-only recovery, mixed-role invitation sharing, separate cursor watermarks and migration recovery. This source integration is not yet full runtime/browser acceptance. Persistent D1 remains0045; all hosted gates OFF, deletion OFF/dry-run. Existing Guest command/result semantics and cross-invitation isolation remain unchanged.

## 2026-10-28 — Shared UI/API and Owner readonly viewer accepted locally

The confirmed same-invitation sharing policy is now implemented and accepted with295 complete local Worker/D1/R2/Chromium checks,430 unit tests, generated strict types and full lint. /annotations/shared drives main lists and overlays; /annotations/own remains strict for exact author recovery. Clear badges and plain author labels distinguish self from readonly peers; different invitations never merge. Shared read cursors bind the exact current viewer/session/scope and all-author watermark. Resource IDs preserve case-sensitive identity; request IDs alone are canonical lowercase. Peer comment links are independently permissioned/redacted, never bodies.

The real canvas uses decoded image DOM bounds and natural dimensions, rejects letterbox and ancestor-clipped captured-pointer endpoints, preserves normalized immutable-version geometry across resize/zoom/pan, and supports keyboard/reverse rectangle drawing. Live receipt/current-row/full-intent CAS precedes editor changes; current401 clears the entire gallery while retaining metadata recovery, and stale A cannot clear B. Owner readonly cached previews retain onLoad dimensions across scope changes/no-op selections. Actual Guest/Owner375px captures were visually inspected. Local schema adoption state and backup proof are in latest HANDOFF; hosted flags remain OFF, no remote deployment is claimed. Earlier own-only/pending-visibility notes are historical and superseded.

## 2026-10-28 — User confirmed same-invitation sharing; integration in progress

The visibility question is resolved: 同邀請共用（比照留言）. Implement a live scoped /annotations/shared reader and shared list/overlay for all authors of the same sealed invitation. Preserve /annotations/own for current own-row recovery and author-only command authority. Different invitations always stay isolated. Shared read visibility never permits editing/deleting/resolving/reopening a peer's annotation. The new reader must use a separate viewer/session/scope cursor namespace and invitation-wide change watermark; it must not expose peer identity IDs, secrets, media URLs or comment bodies. Image/compare/comment permissions remain independent.

Current own drawing/recovery already passed the complete Guest Chromium group in the sixth and seventh full attempts, and the375px screenshot was visually inspected. Owner readonly source is being fixed for cached-image dimension races when switching invitation or reselecting the same scope; eighth full run is pending. Shared reader implementation is delegated in new files; route/UI integration and shared API/browser acceptance remain unfinished. All annotation flags remain OFF/hard-local. Earlier pending-policy notes below are historical and superseded by this explicit answer.

# Version-bound Guest annotations

## M3g2 source integrated; full runtime acceptance pending — 2026-10-28

The current source includes a real Guest-owned point/rectangle canvas, version-bound list and lifecycle controls, and metadata-only recovery UI in the Lightbox and after-comparison view. Pending operations protect navigation. Guest reads remain author-only; peer visibility for one invitation is still an explicit product decision, so no Guest peer list is exposed.

Authenticated Owner annotation capabilities and a readonly invitation/version reader are integrated. The routes are GET /api/v1/annotations/capabilities and GET /api/v1/albums/:albumId/photos/:photoId/versions/:versionId/annotations with required inviteId and mutually exclusive cursor or annotationId. Owner results include scoped authorGuestId and canEdit:false, with geometry/style and tombstones where present; they do not contain isMine, guest credentials, R2 keys or signed URLs. There is no Owner annotation authoring route, and Owner reads never impersonate a Guest. The Owner reader reuses the existing annotation schema; it adds no migration.

Owner annotation metadata can be read for an exact version belonging to the Owner's photo, including private ready draft versions that the Owner may already see in version metadata. This is metadata authorization only: an unpublished draft normally has no Guest-created annotations, and this reader does not grant image bytes. Owner image access remains on its separate authenticated private asset path with its own integrity checks. Guest annotation eligibility and byte authorization remain unchanged.

The Owner may read retained annotations from a sealed invitation after it expires or is revoked, provided the current Owner/session and exact owned active resource scope remain valid. Guest access for that expired or revoked invitation remains denied. Current Owner/session checks, active album/project scope, exact invite grant and full photo/version scope still apply.

GUEST_ANNOTATIONS_ENABLED and OWNER_ANNOTATIONS_ENABLED default to false and are hard-local. Owner annotations require PHOTO_VERSIONS_ENABLED and remain independent of Guest exchange, Guest annotations and Owner comments. Hosted activation is rejected. Shared Guest annotation visibility and Owner authoring remain pending policy/product work.

Source and local checks currently pass: 427 unit tests/49 files, 61 reference integration checks/10 files, 14 reference Chromium checks, generated strict typecheck, full lint and Next production build. Full Worker/workerd/D1/R2/Chromium runtime acceptance is still pending. The 12542 attempt passed the first three Owner API check groups, then exited in expiry test setup when it tried to UPDATE the immutable guest invite expiry. That fixture now uses a genuinely short-lived invitation and bounded D1-clock polling; the complete rerun remains pending. 0045 is source-only and the local D1 database remains at 0044.

## M3g1 backend foundation accepted locally — 2026-10-28

Annotations are independently authorized by `can_annotate` (128). Geometry is bound to one sealed invitation, logical photo and immutable published-ready version; publishing a new head never moves old geometry. Original/preview/compare/comment/selection privileges remain independent. No annotation command creates or overwrites an R2 object.

The user has been asked whether peers of the same invitation may see annotations, or only the author and photographer. That answer is pending. Implementation first exposes an explicit own-author reader, valid under either choice, and does not expose peer data. Different invitations always remain isolated. Owner authored annotation commands and shared display are separate subsequent work; never impersonate a Guest.

## Coordinates and contracts

`coordinateSpace: normalized_1e6` uses integer x/y from0 to1,000,000 across the oriented preview image. A point carries type/coordinateSpace/x/y; a rectangle adds positive width/height and must fit completely inside the image. Integer quantization avoids SQLite/JavaScript floating JSON mismatches. Style is an allowlisted color (amber/red/blue), not arbitrary CSS/SVG/path markup.

The pure coordinate adapter uses the preview's actual oriented dimensions (`naturalWidth`/`naturalHeight`), never an unrotated EXIF width. It computes object-fit contain, center zoom and CSS-pixel pan, rejects letterbox/outside/clipped input, supports reverse rectangle drags, and maps normalized geometry back after resize/zoom/pan. At the M3g1 checkpoint it did not include a drawing UI; M3g2 source now uses the adapter in the Guest canvas, with full runtime acceptance pending.

Commands create/update/delete/resolve/reopen carry a canonical lowercase request UUID and expectedGuestId; existing annotations also require expectedRevision. Creation has photoId/versionId; geometry/style/commentId are required for create/update, with null commentId allowed. No client actor/session/workspace/author field is accepted. Mutations are author-only. Update applies only to open annotations; resolve/reopen change lifecycle; delete preserves a tombstone. Immutable history and exact original receipts survive edits and deletion.

Optional nonnull comment links require `can_comment` (256) in addition, and a live comment by the same Guest in the exact invitation/photo/version. Geometry with null link works without comment permission or its UI feature. Resolve/reopen preserve an existing link without resubmitting it; deleting an annotation clears its public geometry/style/link. Linking never copies or edits comment text.

## D1 boundary

0045 source adds guest_annotation_commands, guest_annotations, guest_annotation_changes and guest_annotation_results, plus an eligible-version alias and indexed symmetric namespace guards for all eight old Guest ledgers. It does not rewrite old history or comment cursors. A single command statement authorizes the live session/hash/identity, sealed grant, deadlines/revocations/current enabled Owner/active parents/ready version, then performs canonical replay before mutable revision/cap/link validation. Replaying under a different Guest session is denied. Each change binds its exact command, annotation, predecessor, scope and provenance.

Audit actions annotation.created/updated/deleted/resolved/reopened have UTC time, exact Guest/Guest session/request and complete before/after state. Owner session_id is null. Geometry/style/link are retained in internal append-only audit, while public own activity exposes only annotationId/revision/state. Lifetime cap is1,000 per invitation/photo/version including tombstones; replay and existing edits/lifecycle remain possible at cap. Quota exhaustion never deletes protected images.

## API and gates

- GET /api/guest/annotations/capabilities.
- GET /api/guest/albums/:albumId/photos/:photoId/versions/:versionId/annotations/own with cursor or annotationId (mutually exclusive). This endpoint always reads only the authenticated author.
- POST /api/guest/albums/:albumId/annotations/commands with exact Origin and JSON, strict body/query bounds and expectedGuestId.
- GUEST_ANNOTATIONS_ENABLED=false in all environments; requires local Guest exchange and photo versions, never comment/Owner collaboration/view/select/compare feature gates. Hosted activation is rejected.

ReadOwn must authorize current identity/full scope, source watermark and rows in one SQL snapshot. It returns24 items, strict keyset cursor, targeted current tombstone reads, no peer/private fields, and ANNOTATION_HISTORY_CHANGED on stale own-history pagination. Reads never append audit or retention activity.

## Verification and pending work

Actual final standard run:281 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3g-cloudflare-seventh.log, session83933 exit0);406 unit/46files (.local/m3g-unit-first.log),61 reference integration/10files,14 reference Chromium(26.8s), generated strict Worker/shared/Web types (.local/m3g-types-final.log), full lint and Next/Worker builds passed. Populated0044→0045 upgrade preserves every prior table row and existing comment marker sequence, with four new tables empty/FK clean. It includes genuine guarded Guest/Owner comments plus a genuine Owner processing decision against actual private R2/Sharp ready V2. Own-author page/watermark indexes are verified by actual D1 EXPLAIN QUERY PLAN, including in the final populated full run; the separate ignored worker .local/m3g-index-probe.mjs also passed45 migrations/FK/plan assertions. This is structural query-plan proof, not hosted performance/free-tier acceptance.

Actual twelve M3g1 check groups cover independent grants/media denial, geometry/style/author isolation, session-bound exact replay and current tombstones, CAS/lifecycle, permissioned own-comment links including accepted uppercase legacy IDs, symmetric request namespace, atomic audit rollback, exact audit witnesses, strict HTTP/query/bounds, scoped24+1/stale cursors,1,000 lifetime cap, metadata-only activity without can_annotate dependency, immutable/sibling/predecessor guards and query plans. Pure coordinate math had seven tests at that checkpoint. M3g2 now has a real canvas in source, but its full browser/runtime acceptance is pending.

0045 is source-only and NOT persistently applied; development DB remains at0044. GUEST_ANNOTATIONS_ENABLED=false in all Wrangler environments/.dev.vars.example and rejects hosted activation. At the M3g1 checkpoint there was no annotation UI; M3g2 UI source is now present, but its full runtime acceptance is not yet claimed. No local adoption/backup for0045, remote/customer modification, commit/push/deploy or real OAuth/R2/CORS/edge acceptance. Automatic deletion remains OFF/dry-run. Previous local0044 backup proof does not substitute for a NEW pre0045 backup/restore before later adoption.

M3g2 source integration is complete; next acceptance work is the full Worker/workerd/D1/R2/Chromium run and actual 375px pointer/keyboard/resize/zoom/pan/unknown-result/lifecycle browser checks. The peer visibility question remains pending: do not infer that annotations are shared from the earlier comment-sharing decision. Explicit /annotations/own is valid under either choice; current Guest UI and Owner readonly viewing do not expose peer data. Genuine Owner annotation authoring, shared Guest display policy, full history/exports, scalable matching, delivery/notifications/retention and remaining M1–M5/hosted acceptance are still required; never impersonate a Guest for Owner writes.

## Recovery

Gate OFF and repair forward; retain all annotation commands/changes/results/tombstones and immutable photo assets/versions. Before persistent adoption, verify ignored backup/hash/isolated restore and populated0044 upgrade parity including real Owner processing history and the existing comment marker sequence. Never drop records, reset sequences or restore an old backup over newer writes to make a test pass. Automatic deletion stays OFF and retention dry-run. No real cloud/provider/fee/deployment acceptance is claimed.
