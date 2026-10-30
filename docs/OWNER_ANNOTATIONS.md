## 2026-10-28 — M3g5 independent processing integration in progress

See [ANNOTATION_PROCESSING.md](ANNOTATION_PROCESSING.md) for separate Owner decisions on Guest annotations, dual source/processing CAS, body-free immutable receipts, current-reader clocks and recovery. Contracts/service/routes/read/UI are integrated behind default-OFF hard-local OWNER_ANNOTATION_PROCESSING_ENABLED; full actual runtime acceptance is pending. Guest annotation geometry/authorship/lifecycle and own recovery/result schemas remain unchanged. Persistent D1 remains0046;0047 is source-only. All hosted gates OFF, deletion OFF/dry-run.

# Genuine Owner annotations

## M3g4 scope and verification boundary

Source implementation adds Owner create/update/delete/resolve/reopen on an explicitly selected invitation/photo/immutable version. It uses its own command, projection, change and result tables; no Guest command is forged. Actual complete local acceptance passed308 Worker/D1/R2/Chromium checks and467 unit tests; see the newest HANDOFF for logs.0046 is applied locally with110 old-table hashes preserved,4 empty new tables/FK0. Hosted/native headed acceptance remains not_checked. Owner processing decisions on Guest annotations are a separate unfinished feature.

Owner authoring requires current enabled Owner identity, live opaque Owner session, owned workspace, active project/album, sealed owned invitation with album membership, and exact photo/version scope. Retained expired/revoked invitations and private draft versions are valid Owner metadata targets. They do not become Guest-readable or grant access to image bytes. Author labels use the fixed role label 攝影師 rather than OAuth profile data.

## Contract and HTTP

- GET `/api/v1/annotations/authoring/capabilities` reports the independent writer gate.
- POST `/api/v1/albums/:albumId/annotations/owner/commands` requires same Origin and strict JSON, including requestId, expectedOwnerId, operation, inviteId, photoId and versionId. Create/update carry geometry/style/commentId; update/lifecycle carry annotationId and expectedRevision.
- GET `/api/v1/albums/:albumId/photos/:photoId/versions/:versionId/annotations/owner?inviteId=...` reads only current Owner-authored rows. Cursor and annotationId are mutually exclusive. This recovery reader uses the existing Owner metadata read gate, so disabling writes does not implicitly remove metadata recovery.
- Existing Owner `/annotations` remains the Guest annotation viewer. Existing Guest `/annotations/own` and immutable Guest receipts remain author-only and unchanged. Guest `/annotations/shared` combines roles inside the same live invitation; Owner rows are always isMine=false. Only Guest-authored own rows can enter Guest edit/recovery commands.

Guest shared cursor v2 binds exact viewer/session/scope plus separate guestWatermark and ownerWatermark change sequence watermarks. A change from either source invalidates it. Taking MAX of two independent sequences would miss changes and is forbidden. Neither public projection exposes peer identity IDs, secrets, storage keys, media URLs or comment bodies. Links are redacted unless the Guest owns that Guest annotation or independently has can_comment. Current can_annotate128 read eligibility remains unchanged pending the separate read-permission decision.

## Durable mutations and privacy

New request UUIDs are canonical lowercase; existing resource IDs retain exact SQLite case identity. Commands are immutable, actor/request-idempotent and share a symmetric indexed namespace with prior Owner ledgers. Exact historical replay requires current Owner authority but may use a fresh Owner session; historical opaque session IDs are retained without a foreign key to a transient login session row. Receipt reconciliation uses a fresh exact Owner-own targeted read and full metadata compare-and-set before clearing a pending intent.

Owner and Guest annotations share a lifetime cap of1000 per invitation/photo/version, including tombstones. Both create paths enforce it. Exact replay, edits and lifecycle remain available at the cap. Annotation IDs cannot collide across role tables. Optional comment links must target a live Guest comment in exactly the same invitation/photo/version; lifecycle retains the existing link, while deletion clears geometry/style/link. Audit actions are owner.annotation_created/updated/deleted/resolved/reopened with actor_type=user, current Owner session, full immutable before/after values, UTC time and request ID. Guest audit actions and authorship remain unchanged.

The browser journal stores command metadata only, one pending intent per Owner/album, and uses full-intent raw compare-and-set plus an in-flight claim. Unknown requests block navigation and require exact UUID recovery. Current authorization denial clears private UI without deleting recovery metadata; stale responses cannot overwrite a newer intent. Capability OFF does not lock navigation. The editor renders real decoded preview coordinates using the existing annotation canvas.

## Migration0046 and Recovery

Local adoption is complete with50 commands after NEW594730-byte backup SHA256 bf27e82976d3bddb995ca669f2f39eadfc6eca85228cc385403b7a1a4b9c3d09, isolated restore/upgrade and current110-table hash parity. Total114 product tables/same4 development rows/4 empty Owner tables/FK0/no pending migrations. Worker .local/m3g4-local-adoption-second.log is the successful result; the earlier invocation failed on an unsupported --yes flag before migration. Current Wrangler skips confirmation in a non-interactive context; do not add unsupported flags. No remote changes.

0046_owner_annotations.sql adds owner_annotation_commands, owner_annotations, owner_annotation_changes and owner_annotation_results plus cross-role capacity/ID and symmetric request namespace guards/indexes. It does not rewrite old product rows. OWNER_ANNOTATION_AUTHORING_ENABLED requires local + PHOTO_VERSIONS_ENABLED + OWNER_ANNOTATIONS_ENABLED. All feature gates remain OFF/hard-local in example/default/staging/production configuration. Automatic deletion remains OFF/dry-run.

Before persistent local adoption: finish actual API/browser acceptance, export a NEW pre0046 backup, record its SHA256/size, restore into a new isolated directory, compare all110 old product-table contents/counts and FK checks, apply0046 only to that copy, confirm four new tables empty and all old hashes/sequences unchanged, then recheck current live state against the backup before applying locally. Populated isolated upgrade tests must also retain real Guest annotation commands/results/audit and exact replay.

Recovery is forward repair with all relevant gates OFF. Do not DROP ledgers or rewrite append-only history. A pre0046 backup can be restored only to a separate database for comparison/reconstruction; never overwrite newer local/customer writes with it. A hosted migration requires its own reviewed backup/restore and deployment acceptance. No hosted migration, customer edit or deployment is authorized by local test evidence.
