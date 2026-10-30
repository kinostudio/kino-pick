# M2m3 — Project defaults and durable album inheritance

Runtime accepted locally with133 Worker checks.0031 applied locally only (41 commands); no pending migrations. Full M1–M5 and hosted release remain incomplete. M2m2 shared subjects remain independently configured; never dynamically change their sealed round bounds.

## Effective policy and source epochs

An explicit album override wins as a whole: maximum:null means unlimited even if the project has a cap. Otherwise resolve project defaults, then system minimum1/unlimited. No policy row means initial inheritance at album epoch0. Returning to inheritance stores a durable configuration row and increments its epoch; never delete a row to reset it. Equal numbers with a different source are a real audited change. Persisted sources have positive revisions; Guest legacy revision aliases albumRevision.

0031 adds project_selection_policy_configurations, album_selection_policy_configurations and immutable selection_policy_configuration_commands/results. Existing0028 policies seed explicit overrides with unchanged values/revisions; old tables, results and audit remain intact. effective_selection_policy resolves values in the same authorized Guest query. Cursor binds source and albumRevision, plus projectRevision only when inherited; irrelevant project changes do not invalidate explicit-override pagination. Old valid cursors return409 SELECTION_CHANGED after current authorization. New format errors remain400.

## Owner API and UI

GET/PUT /api/v1/projects/:projectId/selection-policy-configuration and /api/v1/albums/:albumId/selection-policy-configuration are strict, same-origin16KiB endpoints behind existing defaultOFF/hard-local GUEST_SELECTION_ENABLED. Contracts are in project-selection-policy.ts. Project writes require expectedRevision; album writes require both expectedAlbumRevision and expectedProjectRevision, explicit inherit/override and confirm:true. Only override accepts numeric bounds. Owner reads expose maxOpenSelectedCount; Guests never receive other Guests' counts.

Project cap lowering atomically rejects if any inheriting open private draft exceeds it; overridden albums are excluded. Resetting an album similarly checks its own drafts against current project bounds. Command/result/state/audit commit together under current Owner/session/tenant/editability checks. No-op retains a result without a fake event. Source changes increment revision. Legacy PUT is an explicit override adapter; historical0028 results replay exactly after current authorization. New legacy requests retain legacy_payload_json so a retry uses the original commitment even after project defaults change.

Owner panels show effective source, override/inherit choice and actual proposed bounds before confirmation. Album reset reads the project at the matching epoch; a mismatch requires refresh. Unknown responses keep UUID/body through401/403, successful historical replay always triggers a current GET, and stale responses are suppressed. Unused override inputs never block reset. Guest Grid/Lightbox retain cap/submit behavior and explicitly refresh policy.

## Integrity and recovery

State insert/update witnesses compare current epochs and predecessor commands, including the INSERT phase of UPSERT. Inherit state stores null override bounds while audit/result witnesses record resolved bounds. Canonical command CHECKs reject SQLite NULL fallthrough. Post-migration legacy seed insertion is forbidden so REPLACE cannot restore a historical seed. Both old/new policy result tables and audit_events reject duplicate INSERT/REPLACE explicitly. Cron inserts observation only if its day key is absent, preserving first-event bytes under repeated execution.

All Owner request ledgers conflict symmetrically, including shared reviews and private reopen. Automatic deletion remainsOFF/dry-runON; shared round snapshots stay immutable. Recovery is forward-only: disable Guest selection before code rollback, preserve0031 state/history/guards, repair forward or restore a separately verified consistent backup. Never restore an enabled0028 writer after the legacy command ledger becomes read-only.

## Verification boundary

133 complete local Worker checks passed after integrity repairs, with populated0004→0031 preservation and a real0028 policy seed, cap/CAS/rollback/replay cases, Owner375px confirmation/retry and Guest source-aware pagination/refresh. Repeated and concurrent Cron regression passed, preserving the first event unchanged. Unit108, integration61, strict types/lint, Next build and14 reference Chromium passed. A prior empty-policy expected object was updated to require the new source fields. Isolated31-migration and mutation probes passed; the first probe invocation had a corrected relative-path error. Local fixtures are not hosted Google/GitHub/Cloudflare acceptance.

## Historical M2m1 specification

# M2m — Selection bounds and explicit sharing

Status: M2m1 private-policy vertical slice verified locally:123 Worker checks,95 unit,61 integration,14 reference Chromium E2E, Next build and strict checks. M2m remains incomplete until explicitly opted-in shared review subjects and the two-distinct-Guest29→30 race are implemented and verified. Never report a same-Guest/two-session test as shared selection acceptance.

## Current architecture and compatibility

Existing selection state and sealed submissions belong to invite/Guest/album. Distinct people who use one link remain separate identities. This slice preserves that boundary. Album-level bounds configure every private subject in that album; counts never aggregate across Guests or invitations. Missing policy means minimum1, unlimited maximum, revision0 and modeprivate, preserving existing behavior and empty-submit denial. Project-level inherited defaults and explicit shared review-round configuration remain required follow-ups.

M2m1 adds minimum1..100000, nullable maximum1..100000 and minimum<=maximum. The100000 bound is an application input bound, not a Cloudflare service quota. Submitted snapshots remain immutable, including their prior replay results. Changing a policy does not coalesce identities, expose another Guest's picks, change any photo version or delete selection state.

## Owner policy API and safe updates

GET /api/v1/albums/:albumId/selection-policy returns {policy:{albumId,minimum,maximum,revision,mode:'private'},maxOpenSelectedCount}. The last value is Owner-only and is the maximum count of one current open private draft. PUT same path accepts strict {requestId:UUID,expectedRevision,minimum,maximum,confirm:true}; returns {policy,eventId,occurredAt}. Default is unavailable unless the existing GUEST_SELECTION_ENABLED local-only gate is explicitly enabled. No new production activation is introduced.

Current enabled Owner/session, tenant, active/draft album and writable parent are checked before replay. Exact retry retains original result; changed target/payload reuse conflicts. Revision CAS prevents lost updates. No-op retains an immutable command/result but no false state event or revision change. A maximum below any currently open private draft count is rejected with SELECTION_POLICY_BELOW_CURRENT; submitted rounds do not prevent changing future bounds. A reopened draft above current maximum can deselect, but cannot add or submit until compliant.

Migration0028 adds album_selection_policies and immutable selection_policy_commands/results. Policy changes, predecessor-guarded state, result and selection.policy_changed audit are atomic. Historical command witnesses cannot restore an old policy. Before/after, UTC, Owner session/request and tenant/project/album are retained. Audit failure rolls back all writes. Policy IDs share the existing Owner request namespace, including selection.reopened audit operations, with symmetric SQL guards that abort the entire legacy statement on conflict.

## Guest enforcement and UI

Guest selection page returns current selectionPolicy within its authorization/state query. Cursor and multi-page hydration bind the policy revision as well as round/selection revision; policy changes invalidate a cursor with SELECTION_CHANGED. No new Guest rights or other-Guest counts are returned.

A genuinely new state row checks the live private count against the maximum inside the same D1 statement. Existing-key/version updates and deselection remain allowed. Submission checks current min/max atomically while preserving current authorization, request conflict and exact replay semantics; no sibling AFTER-trigger order is assumed. Old sealed exact replay remains readable even if later bounds differ. Error codes SELECTION_LIMIT_REACHED and SELECTION_MINIMUM_NOT_MET return409, with no partial snapshot/audit/round freeze.

UI displays bounds, disables only new picks at the maximum and clips visible-page batch selection to remaining capacity, preserving version updates that consume no slot. The database remains authoritative under stale views and concurrent devices. Under-min/over-max submit is disabled; a server policy conflict refreshes current selection and bounds. Owner policy confirmation preserves exact intent through unknown responses, including later authorization failures, and remains mounted when its panel is collapsed.

## Recovery and release gates

0028 is forward-only and preserves every prior table row in a populated0027 fixture.0029 preserves all immutable history while performing only the audited legacy reopened-round repair below. Apply only locally until representative remote snapshot/restore and hosted service gates pass. Code rollback requires selection disabled; retain new schema, policy commands/results/state, audit and namespace/limit guards. Repair forward or restore a separately verified consistent snapshot. Never drop history, manually reduce picks or remove guards to force a lower maximum.

Acceptance must cover actual workerd/D1 concurrent same-Guest sessions at29→30, independent Guest isolation, policy/selection races, CAS/replay/no-op/current auth, audit rollback, state/predecessor immutability, min/max submission rollback, sealed replay after change, policy-bound cursor, real Owner/Guest UI/retry/375px and existing regressions. Shared subjects, project defaults, tags/comments/annotations/full history/versions/delivery/retention and hosted OAuth/edge/KDF/R2/CORS/import/backup/CI/deployment remain required.

D1 atomic design is checked against the official [database binding documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/). Local fixtures are not hosted production or free-tier resource acceptance.

## 0029 retained-round revision repair

Review found the older reopen operation reset a retained nonempty draft to revision0 while the existing immutable submission table requires a positive revision. Thus an unchanged resubmit, and even the intended bounds error after reopen, could fail as503 before AFTER bounds triggers ran. New reopens now initialize revision1, record that value in selection.reopened.after_json, and require the same revision in the atomic transition guard. A revision is a draft epoch, not a count of user clicks.

0029 appends one deterministic system selection.round_initialized event and advances only legacy open round>1 revision0 rows to1. It does not alter sealed submissions, selected items, feedback or historical Owner reopen events. Historical replay still returns0 when the original after_json lacked the new value; the result contract accepts historical0 and new1. This avoids rebuilding or weakening the positive-revision immutable snapshot table. Guest policy checks and current ACL remain unchanged. Populated upgrade acceptance must prove that repair/event while preserving old snapshot/audit bytes, plus unchanged resubmit, current min/max409, old replay and multiple retained rounds. Code rollback requires selection disabled and forward repair; never remove this history or restore an old issuer that emits revision0.

Local0028/0029 migrations applied successfully (28 and6 commands), with no pending migrations afterward. Owner and Guest375px synthetic screenshots were visually inspected. Hosted services, shared mode and full release are not checked/complete.

## M2m3 implementation map (reviewed, not implemented)

Keep0028 rows/commands/results/audit intact. Its no-delete guard, witness triggers and last_command_id FK prevent an unaudited reset or a new-ledger write. Introduce durable versioned album inherit/override state and unified project/album command/result ledger; seed legacy album policies as explicit overrides with unchanged values/revisions. Preserve legacy exact-result replay and current authorization. Initial absence is inherited epoch0; explicit reset is a witnessed increment, never row deletion.

Replace effective-bound lookups in guest_selection_state_limit_guard and guest_selection_submission_bounds_guard atomically. Project cap lowering examines only inheriting open private drafts; album reset checks its own open drafts. Keep current ACL and exact sealed submission replay intact. Owner authorization/CAS uses both epochs; Guest pagination should bind source and the effective source epoch plus album mode epoch, avoiding invalidation solely for irrelevant project changes under explicit override.

Update guest-selection-read.ts, guest-actions/selection-policy contracts and Guest hydration comparisons together. Owner ProjectPage gains defaults; album panel gains explicit source selection and confirmation with stable pending intent. Extend all symmetric Owner namespaces, including shared-review.ts legacy conflict queries, owner-selection.ts reopen checks and selection_reopened_shared_review_full_namespace. Shared-review round bounds remain fixed and are not dynamically inherited.

This dependency analysis came from a read-only gpt-6-luna/max subagent; no migration/API/UI was produced by that review. Latest six resolver tests, full strict typecheck, targeted lint/format,34-file handoff check and diff check passed. Targeted lint emitted only React autodetection informational warning. Prior127 Worker acceptance covers M2m2, not unimplemented M2m3 runtime behavior.
