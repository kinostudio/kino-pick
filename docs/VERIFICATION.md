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
