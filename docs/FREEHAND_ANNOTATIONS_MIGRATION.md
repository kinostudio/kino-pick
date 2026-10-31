# Freehand annotation migration 0058

## Scope

0058_annotation_freehand_geometry_v1.sql is the numbered, forward-only migration candidate for the existing Guest and Owner annotation services. It replaces only guest_annotation_command_guard and owner_annotation_command_insert_guard. The four DDL statements match the reviewed fixture at apps/worker/migration-proposals/annotation_freehand_geometry_v1.sql.

It adds bounded freehand-v1 geometry validation to the two existing writers. It does not add tables or rewrite annotation, command, receipt, history, result, permission, or audit rows. Point and rectangle validation and all existing authorization, replay, namespace, and audit behavior stay in the guards. The migration SHA-256 is FC9711203793A675CEA9ECD72C8692DFB4B7BDE200FA5ADBDEFC08414054A5FB.

The schema capability helper hashes both complete trigger definitions. On the 57-migration schema it reports unsupported and keeps the freehand controls disabled. After 0058, the same existing Guest/Owner services report supported only when the freehand and prerequisite flags are enabled. Checked-in defaults remain OFF, and configuration still rejects hosted freehand activation. No UI or service rewrite was needed; the missing piece was an adopted D1 guard version.

## Local evidence

All checks used isolated Miniflare/workerd D1/R2 and synthetic records. No persistent local D1, Cloudflare resource, B staging database, customer data, A site, DNS, or deployment was touched.

- node apps/worker/tools/freehand-annotation-chain-workerd.test.mjs — passed. Applied immutable migrations 0001–0057 into temporary D1, seeded valid point/rectangle Guest and Owner rows with audit witnesses, and tested migration 0058. Four injected DDL failures rolled back to the exact original trigger SQL and preserved populated annotation/audit snapshots. Successful replacement retained the snapshots and foreign-key check was empty. Guest and Owner accepted bounded valid freehand, retained history/audit witnesses, preserved point/rectangle writes and replay semantics, and rejected invalid geometry.
- pnpm.cmd exec vitest run tests/unit/freehand-annotation-writers-workerd.test.ts — passed, 2 tests. The actual capability routes reported disabled on the old 57-schema, enabled after 0058 with the synthetic local gates enabled, and the actual Guest/Owner repositories wrote and read back freehand commands.
- pnpm.cmd --filter @kino-pic/worker build — passed as a Wrangler dry-run build. It did not deploy. Existing Vite large-chunk and Wrangler multiple-environment warnings remain.
- node apps/worker/tools/freehand-browser-workerd-e2e.test.mjs — passed. Chromium exercised the built Worker with isolated D1/R2. Owner and Guest selected the freehand tool, drew, saved, and read back through the real routes; the other invitation stayed isolated; disabling the capability hid both brushes while saved annotations stayed readable. Two annotation audit witnesses were present and PRAGMA foreign_key_check returned zero rows.

The full-chain test helpers now use the repository's applyMigration helper, which applies Wrangler-split SQL batches. The original single-db.exec() approach exceeded D1's single-statement limit when migrations 0055–0057 were added. The browser fixture now persists the expected SHA-256 metadata for its synthetic R2 derivative and explicitly selects the Freehand tool before drawing.

## Adoption gate and recovery

This is source plus isolated acceptance evidence only. Cloud adoption is still pending the root-coordinated exact-source CI, fresh protected backup, independent restore/upgrade through 0058 (and the coordinated 0059 migration), schema/data parity, and deployment/readiness review. Do not apply 0058 to a persistent or hosted database from this note.

If an isolated or future D1 batch fails, stop and check that both original guard definitions and all annotation/audit rows remain unchanged and that the migration ledger did not advance. The tested batch is atomic. Do not run its individual DROP TRIGGER statements, apply only part of the migration, or restore an older snapshot over newer writes.

If freehand writes need to be stopped after a successful adoption, set the existing freehand feature flag OFF and preserve all accepted freehand rows and audit evidence. Existing freehand reads remain governed by the current read-capability handshake; older readers receive the existing upgrade-required response when the authorized feed contains freehand geometry.

Schema rollback must be a separate reviewed forward migration that restores the original Guest and Owner trigger definitions from immutable migrations 0045/0046. That rollback migration has not been authored here; do not edit 0058 or delete freehand data. Take a new backup and rehearse that forward migration against an independent restored copy before any adoption.
