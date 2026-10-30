# Independent Owner comment processing

## M3f2b accepted locally — 2026-10-28

Owner processing is separate from Guest-authored comment text and lifecycle. Its states are `open` (待處理), `in_progress` (處理中), and `resolved` (已處理). Only an authenticated current workspace Owner can change it. Guests of the same sealed invitation may read the status; other invitations remain isolated. Owner replies do not themselves carry processing state.

An absent state is open/revision 0 with null source revisions/time. A recorded state has an independent positive revision, the Guest comment revision acknowledged by the Owner, and the latest create/edit content revision. Guest edit advances the content watermark and makes the recorded state stale without overwriting the Owner's decision. Guest resolve/reopen/delete do not count as text edits. A stale state can be explicitly reaffirmed using fresh Guest and processing revisions. Deleted Guest parents reject new decisions; historical exact replay remains possible after current Owner/scope authorization.

## Transaction and privacy

Migration 0044 adds immutable commands/changes/results and a guarded processing projection. A single command statement records projection, body-free receipt, genuine Owner audit and a shared thread marker atomically. It never writes Guest comment content, authorship, lifecycle or revision. Audit action is `owner.comment_processing_changed`, actor type user, original opaque Owner session and request ID; Guest session is null. The receipt contains no Guest text. Session IDs remain historical strings without a foreign key that would prevent session pruning.

The existing shared marker table and sequence must survive migration unchanged. Only its source-witness insert guard expands to accept the new Owner status event. Old Guest/Owner sources retain their exact guards. Request IDs share the canonical actor namespace with all previous Owner commands and external-effect witnesses in both directions.

Both thread readers include processing in the same live authorized SQL snapshot. A processing change may update an item whose Guest revision is unchanged, so UI reconciliation must also compare the independent processing revision. Immutable receipts never replace current thread reads or resurrect deleted text. Guest command receipts written before this migration remain unchanged; their schema defaults processing to null.

## API and gates

The public CAS fields are `expectedCommentRevision` and `expectedProcessingRevision`; `contentRevision` is derived by the server and cannot be injected by clients.

- Authenticated GET `/api/v1/comment-processing/capabilities`.
- Authenticated POST `/api/v1/albums/:albumId/comment-processing/commands`.
- Command operation `set_processing_state`, request ID, invitation/photo/version/comment IDs, expected Guest revision, expected processing revision, and target state. Client actor/session injection is rejected.
- Exact Origin, JSON content type and matching `X-Kino-Expected-Actor` are required for writes. Unknown/duplicate query parameters are rejected.
- `OWNER_COMMENT_PROCESSING_ENABLED=false` by default in every environment. It requires Owner comments and photo versions; Guest exchange/comment write gates are independent. Hosted enablement is rejected pending acceptance.

Owner UI uses the same serialized, metadata-only actor/album intent journal as replies. Status intents need no comment body for recovery. Losing a response must retain the original request ID and full intent compare-and-set checks; late responses cannot clear a newer intent. After a successful receipt, perform a targeted authorized current-thread read before rendering confirmation.

## Verification boundary

Actual terminal evidence:269 local Worker/workerd/D1/R2/Chromium checks passed (.local/m3f2b-cloudflare-ninth.log, session94874 exit0);369 unit/42files (.local/m3f2b-unit-complete.log),61 reference integration/10files,14 reference Chromium(28.6s), generated strict Worker/shared/Web types (.local/m3f2b-types-fixed.log), full lint (.local/m3f2b-lint-last.log), Next production build and Worker dry-build passed.375px processing screenshot apps/worker/.local/comment-processing-mobile.png was visually inspected. Hosted OAuth/R2/CORS/edge and native headed lifecycle delivery remain not_checked.

Actual API cases verify readonly current snapshots, origin/actor/JSON/strict shape denial, isolated invites, both CAS revisions and concurrent one winner, Guest create/edit content staleness versus resolve/reopen, same-state acknowledgement, body-free historical replay after edit/delete under a fresh valid opaque Owner session, symmetric namespace, cursor invalidation, audit rollback and immutable state witnesses. The browser uses actual375px UI/private local gallery, lost committed200/full reload/same UUID without text reentry, fresh target reads, Guest edit/reconfirmation, readonly peer and other-invitation isolation. Native headed lifecycle and hosted services are not covered by these fixtures.

## Adoption and recovery

0044 applied LOCAL ONLY after verified ignored512749-byte pre-migration backup and isolated restore.46 commands succeeded; all102 old tables retain exact row-content hashes,4 new tables start empty, total106 product tables retain the same4 development rows, FK clean/no pending migrations. Backup SHA256 c63607d764a0693498755c717639f54582f799c156195854e99c713a0fb60e44, worker .local/m3f2b-backup-integrity.json. Populated0043 upgrade also preserves actual Guest/Owner histories and existing shared marker rows/sequence. No remote/customer change, commit/push/deploy. Keep OWNER_COMMENT_PROCESSING_ENABLED=false and all hosted gates OFF/hard-local; deletion OFF/dry-run.

For future migrations, repeat the ignored export/hash/isolated restore and populated history checks before adoption. Never assume a manifest proves restore completion. Local data backup does not include remote R2 objects.

Recovery is gate OFF followed by forward repair. Retain immutable commands, changes, receipts, audit, shared markers and original Guest history. Do not reverse the migration by dropping historical records or restore a backup over newer work. No automatic photo deletion is introduced; automatic deletion remains OFF and retention stays dry-run.
