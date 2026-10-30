# Assisted candidate catalog — M3i3

## Scope and rollout

This slice preserves explicit selection of any authorized logical photo in Assisted mode beyond the legacy 1,000-candidate materialization limit. `ASSISTED_CANDIDATE_CATALOG_ENABLED` defaults OFF in all environments, rejects hosted activation and requires the indexed matching capability and its existing prerequisites. Gate OFF retains the legacy reader and selector. The complete M1–M5 objective remains unfinished.

## Schema and recovery

`0050_assisted_catalog_index.sql` adds only `photos_assisted_catalog_scope_id` on `photos(workspace_id,project_id,album_id,id)`. It does not rewrite photos, heads, versions, assets or audit events. The populated upgrade test checks all119 pre-existing product table hashes/counts, prior schema objects and sequences, exactly one added index and zero foreign-key errors. This test must pass in actual D1; source inspection alone is insufficient.

Persistent local development D1 is now0050 after fresh backup,isolated restore/upgrade,complete vertical acceptance and root live-parity adoption38239. All119 old table hashes/counts/schema/product sequences and same4 development rows remain unchanged;one added index,FK0,ledger50/no pending. HANDOFF pins backup/source hashes and proofs. No remote/customer migration is claimed. Roll application behavior back by disabling the catalog flag and retaining immutable records. Repair through a forward migration;never restore a stale backup over newer writes. Automatic deletion remains OFF/dry-run.

## API and authority

A complete nonduplicate Assisted upload preview may include optional `catalogCursor`. This is a signed initial cursor, not reservation authority. `GET /api/v1/albums/:albumId/upload-candidates?cursor=...` accepts exactly one cursor query and requires the existing Owner session plus `X-Kino-Expected-Actor`. A readonly GET does not require an Origin header; upload mutation routes retain their strict Origin checks.

Each cursor is HMAC-SHA256 authenticated with a purpose-specific namespace and canonical base64url encoding. Strict claims bind Owner, exact session, workspace/project/album, project and album revisions, matching sequence, default-v1 profile, unique preview catalog ID, last photo UUID and a fixed900-second lifetime. The token length is bounded4096. Each page independently checks current enabled Owner/live session, owned active scope, Assisted mode and captured revisions/sequence in the same SQL snapshot. A valid signature alone grants no access. Session changes, mutation or expiry require fresh preview and explicit selection.

A BINARY UUID keyset seeks25 rows and returns at most24 candidates plus nextCursor. Public items contain only logical-photo ID, original filename from the immutable head completion witness, current version ID and head revision. Ambiguous/missing witnesses fail closed; object keys and hashes are never projected. The catalog enumerates owned album photos independently of filename matching. `candidatesTruncated` describes matching evidence, not this directory's completeness.

Fresh reservation reauthorizes an arbitrary selected head from actual current scoped D1 metadata, including its immutable hash/dimensions. A selected photo need not occur in the tiny indexed preview head map; a captured entry, when present, must still match. Existing expected-parent/revision, project revision, matching watermark and final guarded D1 CAS remain authoritative. Catalog tokens never enter the canonical reservation body or recovery journal. Historical exact replay retains its original bytes/UUID/target and remains before fresh matching checks.

## UI lifecycle

The picker retains at most24 current rows,32 page cursors and one selected row independently. Next, previous and first-page controls keep a selected off-page target visible. Returning to the first page resets cursor history; tokens from the previous history are legitimate there. A preview/file/actor/scope change, stale response or suspended panel clears sensitive selection. Abort/generation guards prevent late responses from repopulating old state; current identity is checked before and after reads. Errors require an explicit refresh/fresh preview rather than silent reservation.

Labels use filenames and human-readable version information. The current picker is metadata-only; visual thumbnails and final information hierarchy remain future UX work. Gate OFF preserves the existing selector. No new batch-upload or configurable matching-rule feature is implied.

## Verification status — accepted locally

Complete standard18844 exited0:352 actual local workerd/D1/R2/API/Chromium checks (`.local/m3i3-cloudflare-third.log`). Focused18128 exited0:seven groups (`apps/worker/.local/m3i3-focused-runner-final7.log`) cover1,001 guarded synthetic logical photos in24-row pages,all cursor/authority boundaries,arbitrary final-page chosen-head reservation/replay,375px first/previous/next/off-page target selection,correct explicit-choice headings,separate radio groups,identity clearing,lost-response recovery,one actual signed R2 original plus native Sharp derivatives,stale head/sequence no writes and legacy/default-OFF preservation. Root inspected the final mobile screenshot. Synthetic metadata is not1,001 physical R2 transfers;metadata-only controls are not final visual-design acceptance.

588 unit/67 files,generated full strict68388/lint8613 plus later UI scoped strict/lint and final helper10/10,61 reference integration95549,Next build/14 reference Chromium13914,52-file document presence and diff checks pass. Isolated populated native D1 and fresh real-backup restore preserve119 old tables/schema/sequences/FK0;the unforced scoped BINARY ID range uses the new covering index without a temporary sort. Structural query-plan evidence is not edge latency,CPU or free-tier evidence.

Earlier standard86510 failed after338 groups at an obsolete privacy-helper assertion. Second47811 failed after192 at an existing Guest-comment recovery timing assumption. The form hides while retry is pending,before authoritative reads clear the journal;the helper now polls actual sessionStorage request removal,retaining exact retry payload and single-write assertions. No product source changed for that correction. Third complete standard uses the second-built final assets and passed all352. Intended fixture audit delta is processing.enqueued/upload.authorized/upload.completed/upload.reserved each+1;stale denial deep-equals the full post-fixture state. Synthetic completion witnesses may retain reserved session status;never assume that count is zero.

Fresh backup699707 bytes and0050 source hashes are pinned in HANDOFF. Isolated prep35093:145 CLI commands all0;root persistent local adoption38239 also exited0 after fresh live parity.119 tables/same4 development rows unchanged,one index,FK0,ledger50/no pending. All feature/default/hosted and delete gates remainOFF. Real Google/GitHub OAuth,remoteR2/CORS,edge latency/CPU,free-tier suitability,native-headed and hosted deployment remain not_checked.

## Remaining work

Distinct opt-in matching profiles, genuine per-file batch/recovery, comparison refinements, delivery/notifications, retention confirmation/retry, roles/multi-node and hosted readiness remain required. Existing expiry/preview liveness and full-coverage scan cost are unchanged.
