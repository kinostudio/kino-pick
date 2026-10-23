# Phase 0 verification — 2026-10-23

Local Windows, Node 24.18.0, pnpm 11.25.0. Commands run from repository root. See HANDOFF for detailed scope, resolved failures and unverified external services.

- passed: install, lint, strict typecheck, Vitest unit (9), embedded PostgreSQL integration (1), optimized Next build, Chromium E2E (1), development server HTTP smoke (200).
- passed: production dependency audit reports zero known vulnerabilities at execution time.
- expected failure: db:migrate without DATABASE_URL exits 1 before any DB connection.
- not_checked: actual Supabase migration runner connectivity/recovery, Google OAuth, R2, GitHub CI, staging/production release.
- passed: python tools/check_handoff.py (24 files), pnpm format:check, pnpm install --frozen-lockfile.

PGlite uses actual PostgreSQL engine + test-only Supabase auth shims. This does not verify hosted Supabase claims, grants, extensions or PostgREST. The E2E exercises only Phase 0 local status/health; it is not product E2E.

## Clean checkout verification

A fresh local Git clone under ignored `.local/clean-check` had no node_modules or Next artifacts. `pnpm install --frozen-lockfile`, `pnpm typecheck` (with next typegen), `pnpm test` (10 tests), and `pnpm build` all passed. This validates fresh-checkout type generation. Next warned that the parent workspace was outside the nested clone; it correctly used the clone repository and build passed. Migration runner normalizes CRLF to LF before checksumming. Generated next-env.d.ts is ignored.

## 2026-10-23 M1-01

- Passed: pnpm typecheck, pnpm lint, pnpm test:unit (17), pnpm test:integration (6), pnpm build, pnpm test:e2e (4), pnpm format:check, python tools/check_handoff.py (24 files).
- pnpm audit --prod --json: 0 vulnerabilities; .local/m1-audit.json.
- Browser: real Next server + separate loopback Supabase/PGlite fixture; PKCE, HttpOnly, two actors/tenant isolation, create/reload/replay/conflict, owner member changes/suspension, 24+2 pagination, logout, forged callback/session and auth-disabled denial. Desktop/mobile screenshots inspected.
- Not checked: hosted Google/Supabase/PostgREST, real multi-connection PostgreSQL lock contention, R2, GitHub CI/deployment. Fixture tokens are intentionally invalid outside the test service.

## 2026-10-23 M1-02 subset / security hardening — latest

| Command                  | Result | Scope                                                   |
| ------------------------ | ------ | ------------------------------------------------------- |
| pnpm lint                | passed | Full integrated repository                              |
| pnpm typecheck           | passed | Strict shared packages/tests + Next typegen/web         |
| pnpm test:unit           | passed | 27 tests                                                |
| pnpm test:integration    | passed | 21 tests, all five migrations on PGlite with auth shims |
| pnpm build               | passed | Optimized Next app/API/dashboard                        |
| pnpm test:e2e            | passed | 7 Chromium tests, final run 17.3s                       |
| pnpm audit --prod --json | passed | 0 vulnerabilities, .local/m1-projects-audit.json        |

Browser evidence includes two tenants/roles, persisted project/album create/rename, 24+2 cursor pages, concurrent name updates with one conflict, 409 disabled save and preserved draft after reload, permission revoked during edit, replay rejected after suspension, and committed POST/PATCH response loss followed by identical request/body retry (one entity and one revision increment). Expired chunked session refresh, simultaneous refresh and logout cookie replay also pass. Desktop/375px screenshots inspected.

Test fixture implements real migrations/RLS via PGlite, restricted bound read filters and a small provider HTTP subset. PGlite serializes DB transactions: parallel HTTP tests do not prove PostgreSQL multi-connection lock contention. Hosted Google/Supabase/PostgREST, actual migration runner connectivity/recovery, R2, remote CI and release remain not_checked. No cloud keys or customer images used. Initial backend test-string quoting issue was corrected before successful full SQL execution; no unresolved check failure is represented as pass.

Final format/document/frozen-install/diff checks are recorded in HANDOFF after execution.

- Final passed: frozen install, format:check (after correcting sessions.spec.ts formatting), check_handoff.py (24 files), git diff --check.

## 2026-10-23 Google / GitHub same-user linking — latest

- Passed: pnpm lint, pnpm typecheck, pnpm test:unit (32), pnpm test:integration (27), pnpm build, pnpm test:e2e (11 Chromium tests / 19.3s).
- Passed: pnpm format:check, python tools/check_handoff.py (24 required files), git diff --check; pnpm audit --prod --json reports 0 (.local/oauth-audit.json).
- SQL proves GitHub-only provisioning/content, stable profile after additional identity, same actor hash scope, expiry, callback completion identity verification, private table denies, audit failure rollback and completed-request idempotency. Browser verifies both linking directions and signing back in with the other provider, retained workspace IDs, existing-account conflict, wrong exchanged actor signout, no-intent rejection, source/link disabled and old workflows.
- Strict provider authorization URL guard tested against genuine Google/GitHub host/path and exact callback, attacker prefixes/userinfo/hash/wrong path/redirect_uri, duplicate callback values and production loopback rejection. Actual external provider URL/runtime/network has not been exercised.
- Screenshots .local/oauth-account-desktop.png and oauth-account-mobile.png inspected; 375px no overflow.
- Not checked: real Google/GitHub/Supabase, hosted grants/migrations/recovery, automatic email linking policy, HTTPS/revocation and PG multi-session contention. Fixture is a limited Auth/PGlite subset, not real end-to-end provider validation. Supabase Auth linking and app audit completion are separate transactions; no cross-service rollback claim.

## 2026-10-23 compatibility assessment / isolated SQLite probe

- Passed: pnpm lint, typecheck, 32 unit, 35 integration (27 PG +8 isolated SQLite), build. No application runtime/schema/dependency change.
- Pinned vinext1.3.0 check from isolated apps/web: 15 static supported /0 partial/0 issues; .local/vinext-check-web.log. Initial root-cwd report was scoped incorrectly and is not counted as a project result. No vinext init/build/workerd/deploy performed.
- SQLite tests demonstrate zero-row CAS + false audit reproduction, explicit revision rejection, tenant/current actor checks before replay, later-state preservation, conflict, audit/write rollback and bound values/append-only rows. Fixture actor is trusted and simplified; tests do not prove production authorization or D1 API/remote/concurrent behavior.
- Browser11: not rerun this round, runtime unchanged; previous9533171 evidence remains historical. Next hosting PoC must run those assertions against the target runtime.
- Cloudflare/Better Auth docs and package metadata verified at assessment time; no claim of paid/free allowance or deployed compatibility. Details/sources in ADR-Cloudflare-Free-First.md.

- Final passed: format:check, check_handoff.py (24 required files), git diff --check. Isolated audit worktree remained clean after CLI check.

## 2026-10-23 — Local workerd hosting runtime (isolated branch)

- Experimental versions: vinext1.3.0, @vinext/cloudflare1.2.0, React RSC19.3.1, Vite8.3.5, React plugin6.1.2, RSC plugin0.5.38, Cloudflare Vite plugin1.64.0, Wrangler4.151.3; pinned experimental lockfile, Node24/pnpm11.25.0. Initialized with Cloudflare target/legacy Wrangler, no CDN/data/image cache, removed deploy script. No main app dependency changes.
- Passed actual `pnpm --filter @kino-pic/web run build:vinext` five-stage production build and generated Wrangler config. `wrangler types --include-runtime=false` generated ASSETS binding type; `pnpm install --frozen-lockfile` passed after explicit experimental workerd allowBuilds. Upstream SOURCEMAP_BROKEN/INEFFECTIVE_DYNAMIC_IMPORT warnings remain.
- Actual harness uses built `dist/server/wrangler.json` with `wrangler dev --local`, loopback3100/3101/3103 and distinct inspector ports, plus existing fixture54329. No Vite Node-only dev server or Next process is counted as Worker evidence. Shell env is forwarded as allowlisted Worker vars, constrained to APP_ENV=test and known loopback Auth fixture. First11 tests passed21.3s; expanded12 passed30.6s before final launcher restriction rerun.
- Added direct expired-cookie SSR regression because API refresh can mask broken proxy updates. The first common test incorrectly required Vary: Cookie on Next and failed (11passed/1failed); Next overwrites Vary with RSC list. Corrected common security assertion to private/no-store plus real cookie rotation. Main Next production build and12 Chromium cases passed18.9s after correction.
- Experimental lint/typecheck,32unit/35integration passed. Initial generated-dist lint failure81errors/4618warnings was fixed with scoped generated-output ignores; initial format check flagged workspace YAML/test formatting and was corrected. Native installation and UTF-8 setup errors are documented in experiment README.
- Not checked: cloud deploy/limits/CDN, real provider/Supabase/GoTrue, HTTPS/Secure, actual PG contention or R2. Local serial PGlite cannot establish hosted transactional behavior; fixture omits automatic email linking. No schema migration or live DB recovery required. See isolated experiment README and ADR for reproduction/adoption gates.

- Final local evidence: isolated runtime commit **8845867**, clean experimental worktree; restricted-launcher workerd12browser passed21.1s. Main Next12browser passed18.9s; main lint/typecheck/32unit/35integration/build passed. Frozen install/format/docs/diff final checks recorded after execution. No push/deploy; user addendum remains untracked.

## 2026-10-23 — Owner-controlled album protection (latest)

- Complete a scoped vertical slice: migration0007 → strict contract/repository → PATCH /api/v1/albums/:id/protection → real owner UI → SQL/browser regressions. Reuses existing is_pinned/legal_hold; no table/data rewrite. Only current workspace owner may change flags; other active roles read only. Clearing either true flag needs explicit confirmation in API and UI.
- Request→workspace→album locks, current authorization before idempotent replay, shared revision CAS with rename, and flags/before-after audit/ledger in the same transaction. Old success retries return history without restoring current flags; changed payload conflicts. Audit failure rolls back flags/revision/ledger. New writes to deleting/deleted denied; archived can retain protection. Does not reset human-view clocks or change album/project state.
- Real local commands passed: pnpm lint/typecheck,33unit,42integration (seven PG migrations plus isolated SQLite probe), pnpm build,13Chromium E2E19.9s. UI desktop/375px screenshots inspected at .local/album-protection-*.png; no overflow. Final fixture/helper edits receive lint/type/format checks below.
- Tests cover non-owner direct API and revoked access, CSRF/scope override, explicit unprotect confirmation, conflict retains choices/reload/reconfirm, commit-response loss retry identical ID/body with one revision, parallel expectedRevision gives one200/one409, permission after owner loss, direct writes/unsupported/anon denial, audit failure retry, terminal deletion guard.
- Corrected failed attempts: initial SQL test referenced audit created_at instead of occurred_at (41passed/1failed); new browser test initially used common actor A and polluted existing 24+2 workspace expectation (12passed/1failed). Assigned isolated fixture actor E, then fixed its authorization-cookie selector allowlist; first E attempt correctly failed identity assertion. Full13passed after fixes; application Auth has no fixture bypass.
- Full E2E emitted three SDK warnings about invalid mixed chunked-cookie JSON during session tests; session rotation/concurrent refresh/logout-replay assertions passed. This is not claimed warning-free; a focused follow-up is recorded below. Actual Supabase/HTTPS/Secure-cookie/PG contention and R2 remain not_checked.
- Migration recovery: packages/db/README.md exact REVOKE signature, transactional migration failure recovery, forward fix/backup restore into separate DB. Preserve protection flags/audit/ledger; no hosted migration/restore run. Auto-delete stays OFF/dry-run; no retention executor/delete/archive/state transition functionality implied.
- User untracked architecture addendum remains untouched/unstaged. No dependency/stack change, no push/deploy. Full M1–M5 requirements still open. Next minimum task: define project/album archive/restore transition invariants and interaction with active review/upload/retention locks before exposing state controls; project protection and upload quota reservation follow separately.

- Focused follow-up: `pnpm exec playwright test sessions.spec.ts` passed2/2 (9.2s), no mixed-cookie warning observed in that run. This does not establish the full-suite warning cannot recur; retain real Supabase concurrent-refresh acceptance gate. Final lint/typecheck/frozen install/format:check/check_handoff.py24files/diff checks passed.

- Final formatting correction: adding fixture actor E changed a regex that Prettier wraps differently; initial final-format attempt failed. Formatted supabase-server.mjs, then actually reran format:check (passed), check_handoff.py24files (passed), and diff --check (passed). No behavior change. Feature commit f924195; formatting/document correction follows.

## 2026-10-23 — Reversible empty-content archive (latest)

- Delivered migration0008 → contract/repository → owner-only project/album archive API → confirmation/conflict/retry UI → SQL/browser regression. Only empty/idle content: project draft/delivered, album draft under draft/delivered parent. Store original state in nullable archived_from_status/archived_from_state and clear on restore. Existing archived rows keep null origin and fail closed rather than guess draft. No data backfill or physical deletion.
- Shared request→workspace→project/album locking, current owner authorization before replay, revision CAS and state/origin/audit/ledger transaction. Project archive freezes names/new albums; album archive freezes names. Parent must be restored before child transition; children are not cascaded. Protection remains editable by owner and flags/human-view timestamps unchanged. Identical historical retry returns history without altering current state; new same-state requests reject.
- Passed actual commands: pnpm lint/typecheck;34unit;49integration (eight PG migrations, plus eight isolated SQLite tests); pnpm build;14Chromium E2E22.9s. Added explicit workspace filters to candidate checks, then reran49integration and complete14E2E on final migration. No failing test attempt this slice; no hosted acceptance implied.
- SQL covers original draft/delivered restore, immutable child state/protection/times, unsupported/busy/nonempty/legacy origins, edit freeze, owner/current roles, unsupported/anon/direct write denial, shared CAS/replay/request namespace, audit failure rollback of state/origin/revision/ledger and retry. Browser covers confirmation, lost response identical request retry, conflict reload/reconfirm, edit UI freeze, parent-before-child restore, protection after archive, non-owner/revoked/CSRF/unknown-field denial, parallel expectedRevision one200/one409.
- Desktop/375px .local/archive-desktop.png and archive-mobile.png inspected, no overflow. .local/archive-build.log and archive-e2e.log preserve local command output. PGlite is serialized and Auth HTTP fixture is a limited fake; simultaneous HTTP cases do not establish real PG lock contention or actual OAuth/Supabase/PostgREST behavior. HTTPS, R2, cloud CI/deploy remain not_checked.
- Recovery and exact REVOKE signature in packages/db/README.md. Runner transaction/checksum handles failed migration. After success keep origins/name guards/audit/ledger, prefer forward fix/backup restore in separate DB; do not drop origin columns or revert to unguarded name/create functions while archived rows exist. No hosted migration/restore performed.
- Future uploads/reservations/reviews/jobs must join the same archive-state locks/idle guards before widening support. Full workflow submission snapshots, photos/version/guest/delivery, project protection and deletion remain pending. Auto-delete OFF/dry-run ON, no paid/free plan assumption or stack switch, no push/deploy. User's untracked architecture addendum remains untouched and unstaged.
- Next minimum task: M1-03 upload-session/quota reservation transaction core (scope, idempotency, expiry, archived-parent exclusion, exhausted quota rejection), then private R2 adapter/verified completion. Full M1-02 CRUD/review-state lifecycle is not marked complete by this archive subset.

- Final checks passed: frozen install, format:check, check_handoff.py24files, diff --check. Initial final-format check flagged content-archive.spec.ts; formatted it and actually reran format/docs/diff checks successfully. No logic change; this formatting attempt is not counted as an initially clean check.
