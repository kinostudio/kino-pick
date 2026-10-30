# Indexed automatic version matching — M3i2

## Scope

M3i2 integrates complete-history indexed classification into the existing automatic filename upload preview/reservation workflow. It uses migration0049's immutable default-v1 upload-session keys; no new schema is needed. Existing project modes and source payload/replay shapes are retained. The independent `INDEXED_VERSION_MATCHING_ENABLED` defaults OFF in every environment and rejects hosted activation. It requires existing upload, version, project-configuration, resolved-matching and filename-index gates. Real hosted acceptance remains separate.

This slice targets `auto_filename`. A snapshot in any other mode falls back to the existing complete-candidate reader, retaining Assisted's current ability to explicitly choose any authorized logical photo. Large-album Assisted pagination, configurable rule profiles and true per-file batch upload remain required following slices. No smaller Assisted catalog is substituted for existing behavior.

## Same-snapshot evidence

`D1IndexedVersionMatchCandidates.resolve` uses a single authorized SQL statement for current enabled Owner/live session, owned active album/project, persisted mode/revisions, album matching watermark, key coverage, pending reservations, exact canonical filename lookup, distinct logical-photo count, complete immutable version history and current head.

Keys use JavaScript's existing NFC/case-sensitive default profile. The SQL lookup uses BINARY canonical tuples and the canonical partial index; unknown extensions retain their full basename and NULL extension. SQLite lower() is used only for hexadecimal hash equality, never filename matching. Current ownership authorizes historical witnesses regardless of the original uploading actor; no mutable photo filename fallback is admitted as immutable evidence.

Missing keys, relevant invalid names, unlinked historical versions or incomplete photo/head evidence prevent completeness. `filename_index_not_ready` is an explicit review outcome; the UI offers no automatic reservation from that result. A ready maintenance panel is never read as authority. Pending means reserved without either ordinary/version completion; elapsed TTL alone does not clear it. Durable cancellation/expiry clears uncompleted pending evidence. Invalid uncompleted names that are durably cancelled/expired no longer permanently block an otherwise complete album; their immutable marker remains retained.

For one matched logical photo, SQL aggregates all versions across every upload filename. It returns total versions, malformed hashes/dimensions, missing dimensions, incompatible encoded dimensions and exact-hash counts. Dimensions use the original division order and thresholds (aspect delta0.05, per-axis scale0.5..2); raw width/height are not EXIF-normalized. Ambiguous logical photos are reviewed before duplicate resolution. Duplicate content is checked before missing-dimension evidence, while malformed evidence is rejected. Multiple equal-hash history versions return a NULL exact version ID. No materialized candidate limit is raised: the result is one aggregate row plus at most one current-head candidate.

The pure `classifyIndexedVersionMatch` validates strict counter coherence and evidence before deciding. It does not authorize a reservation. Preview and fresh reserve each recompute the scoped snapshot; existing project revision, matching sequence and head-CAS SQL guards remain the final write boundary.

## Reservation keys and recovery

Ordinary init, explicit manual-version init and resolved init use the same D1 batch for the original guarded reservation statement and a trusted canonical-key INSERT SELECT. A hard key-write failure rolls back request/session/quota/audit/watermark changes; known quota/authority/conflict errors remain intact, while unknown index failures produce generic RESOLUTION_UNAVAILABLE503.

Exact ordinary races may make the original insert an existing-command no-op, with no source for the newly generated unused candidate ID; the derived insert then affects zero rows and the original stored result is returned. Version/resolved historical replay remains before fresh matching checks. No journal UUID, bytes, target, payload or reservation is replaced after an uncertain outcome.

An authority expiry between batch statements can also prevent the derived INSERT SELECT. The authorized reservation remains governed by its original guard and subsequent current-authority result read; missing-key completeness makes later classification fail closed. Fresh authorized maintenance can fill such a retained source. This is a completeness protocol, not a claim that every replay or expiry edge inserts a new key. Never infer no-match merely because a key is absent.

## UI and verification

Existing single-file upload preview/confirmation/recovery is reused. It displays the explicit incomplete-index reason, and the maintenance panel no longer claims indexed matching is globally unavailable. Per-album heading IDs permit simultaneous panels without duplicate label references. A local-only flag does not imply the photographer opted into the project mode.

Actual commands and results belong in HANDOFF/VERIFICATION. Large-history metadata fixtures must retain all D1 guards and distinct immutable witnesses; synthetic database evidence must not be described as1,001 verified physical R2 transfers. The standard command must exercise actual workerd/D1/API behavior beyond1,000 entries and real small-image completion, atomic rollback, stale/replay boundaries, current authority and the reused375px UI. Source-level or pure unit equivalence alone does not establish that acceptance. Query-plan evidence does not establish edge latency, CPU cost or free-tier viability.

## Recovery and remaining work

Persistent local D1 is now0049 after fresh backup/isolated restore/upgrade and root live-parity adoption (119 tables/same4 development rows,old118 unchanged,empty index,FK0,no pending). HANDOFF pins the backup/source hashes and proof artifacts. No remote/customer edit,commit,push or deployment is part of this slice. Turn off INDEXED_VERSION_MATCHING_ENABLED to restore the existing reader; retain keys, reservations and immutable history. Use forward profiles/migrations to repair canonical behavior, never rewrite old evidence or restore a stale backup over newer writes. Automatic deletion stays OFF/dry-run.

A known bounded liveness issue remains in the existing expiry workflow: due same-name rows stay pending until durable scheduled cleanup/fencing commits, and reserve-time cleanup of an unrelated due row can advance the album watermark and yield RESOLUTION_STALE. The client must obtain a fresh preview and explicit choice; never ignore TTL fences or silently alter an existing intent. Coordinating cleanup before preview without turning advisory reads into unaudited writes is follow-up work, not an exception to CAS.

Next complete bounded Assisted catalog pagination and chosen-head authorization, versioned opt-in rules and true per-file batch/recovery. Representative-volume coverage-scan/index-cost measurements, legacy forward witnesses, comparison refinements, delivery/notifications, retention confirmation/retry, roles/multi-node and hosted readiness remain in the full active M1–M5 objective.
