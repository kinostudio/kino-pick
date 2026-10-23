# SQLite transaction portability probe

This is an isolated experiment, **not** a production adapter, application migration or proof of Cloudflare D1 compatibility. Only tests load schema.sql into Node 24 built-in SQLite `:memory:`. No files, accounts, cloud databases or customer data are mutated. Close the database to discard all experiment state; there is no application rollback/migration to apply.

Run from repository root: `pnpm exec vitest run tests/integration/sqlite-portability.test.ts`.

The first test intentionally demonstrates a broken design: a stale conditional UPDATE changes zero rows without throwing, so a following audit INSERT can commit. Transaction atomicity alone does not make a compare-and-swap condition true.

The remaining tests explore a command-table trigger guard: authorize a trusted actor/scope before replay, reject stale revision or changed request payload, and perform mutation/audit in one statement. They prove SQLite statement-level rollback on injected audit/write failure, replay without undoing later state, and denial after revocation. They do not prove real multi-connection contention, D1 batch/binding behavior or remote failure recovery.

Deliberate gaps: actor IDs are trusted synthetic test inputs; there is no OAuth/session verification, complete role matrix, general repository, API/UI, resource lifecycle, global quota, D1 deployment, or database grants/RLS. A caller with the DB binding could bypass the command table with direct SQL; all real entrypoints must be restricted by a trusted service. This schema cannot replace the existing PostgreSQL migrations. See docs/ADR-Cloudflare-Free-First.md before porting.
