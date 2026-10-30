# Independent Owner annotation processing

## M3g5 implementation boundary

Schema/service/API/current reads/UI/recovery are accepted locally:498 unit tests/58 files and315 complete local Worker/workerd/D1/R2/Chromium checks passed, together with integrated strict types/lint and Next reference production build. Migration0047 is applied locally after verified backup/isolated restore/upgrade and fresh114-old-table parity;118 tables/same4 development rows/FK0/no pending migrations. All feature gates remain default OFF/hard-local. This is not hosted deployment or real OAuth/R2/CORS acceptance; see latest HANDOFF for evidence and remaining boundaries.

Only an authenticated current Owner decides how to process Guest-authored annotations. Owner-authored notes retain their own lifecycle and do not have this processing projection. States mirror comment processing: open / in_progress / resolved. An absent decision is open/revision0, acknowledged annotationRevision/contentRevision/time NULL, stale=false. A recorded decision has independent positive revision, acknowledged positive annotationRevision/contentRevision, contentRevision<=annotationRevision, UTC time and a computed stale flag.

Annotation create/update are content changes (geometry, color/style or comment link). Owner confirmation pins the latest such immutable change revision at the expected Guest annotation revision. Later Guest create/update makes the current processing snapshot stale. Guest resolve/reopen/delete advances lifecycle revision without changing that content watermark. A new processing command needs both current Guest revision and current processing revision; a stale decision can be explicitly reaffirmed. Deleted Guest parents reject new decisions, while exact historical replay remains possible under fresh current Owner authority.

## Command/API/gates

Strict command: requestId (new canonical lowercase UUID), expectedOwnerId, operation=set_processing_state, inviteId, photoId, versionId, annotationId, expectedAnnotationRevision, expectedProcessingRevision and state. Resource IDs preserve exact case identity. Client actor/session/contentRevision/geometry/style/link injection is rejected. Canonical JSON uses this exact listed order. Content revision is derived by SQL from immutable Guest create/update changes; it is never client supplied.

Authenticated GET /api/v1/annotation-processing/capabilities and POST /api/v1/albums/:albumId/annotation-processing/commands require the real Owner session. Writes additionally require exact Origin, matching X-Kino-Expected-Actor, strict JSON/no query and an8192-byte body limit. OWNER_ANNOTATION_PROCESSING_ENABLED defaults false in every environment and is hard-local. It requires PHOTO_VERSIONS_ENABLED and OWNER_ANNOTATIONS_ENABLED; Owner authoring/comment/Guest flags remain independent.

The authorized target is the exact owned workspace/active project+album/sealed invitation created by this Owner/album membership/Guest annotation/photo/immutable version. Owner metadata can retain expired or revoked invitations and any owned version. These decisions never grant Guest image/version/comment/selection access. Receipt is ownerId/requestId/operation/invitation/photo/version/annotation IDs plus a positive fresh processing snapshot and occurredAt. It contains no geometry/style/comment link/body, Guest ID, secret or media URL.

## Schema/read invariants

Source migration0047 adds owner_annotation_processing_commands, owner_annotation_processing_states, owner_annotation_processing_changes and owner_annotation_processing_results plus owner_annotation_processing_snapshots view. No old product row is rewritten. Guarded command projection/change/result/audit writes are atomic. Audit action owner.annotation_processing_changed uses actor_type=user, original opaque Owner session, NULL Guest session, UTC/request/full scope and before/after processing metadata. Historical session strings have no FK that would pin deleted login sessions.

Current authorization precedes exact replay and namespace lookup. Exact original replay can use a fresh live Owner session and retains the original provenance. Mutable parent state/CAS checks must not reject that historical exact replay. All18 prior Owner request namespaces, including Owner annotation authoring, remain symmetrically guarded/indexed case-insensitively without rewriting old casing. Guest ledgers and Guest lifecycle remain unchanged.

Owner Guest-annotation and Guest shared readers include current processing in the same authorized SQL snapshot. Owner Guest-read cursor v2 stores separate Guest+processing watermarks. Guest shared cursor v3 stores separate Guest+Owner+processing watermarks. MAX of independent clocks is forbidden. A change to any relevant source invalidates its cursor. Guest own recovery/results and the Owner author-only annotation reader stay unchanged. Owner-authored shared rows have processing=null; Guest rows have initial/recorded processing metadata. Same-invitation sharing and different-invitation isolation remain mandatory; reading status grants no peer writes.

## Recovery and remaining acceptance

Metadata-only exact-intent recovery and targeted current reads are implemented and passed actual local browser acceptance, including an accepted held request/full reload/exact replay and A→B→A invitation isolation. Full-intent compare-and-set protection and current-auth privacy invalidation remain mandatory. Guest own-target receipt verification is followed by a fresh shared-target read before rendering current processing. Native headed lifecycle, hosted OAuth/R2/CORS/edge/free-tier acceptance remain not_checked.

Before persistent adoption take a NEW ignored pre0047 export with SHA256/size, restore into a separate directory and compare all114 old product-table row hashes/counts/FK checks. Isolated0047 upgrade must preserve every old table/history/sequence, add four empty tables and keep FK0. Populated upgrade must retain genuine Guest annotation and Owner annotation/processing history and exact old command replay. Recheck live state before local application. The pre0046 backup cannot prove a114-table restore and must never overwrite newer writes.

Recovery is gates OFF plus forward repair. Never DROP command/change/result/audit ledgers, reverse source revisions or overwrite new data with an old backup. No automatic image deletion is added; deletion stays OFF/dry-run. No remote migration/deployment/customer modification is implied by local evidence.
