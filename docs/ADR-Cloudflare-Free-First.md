# ADR — Cloudflare free-first compatibility assessment

Date: 2026-10-23 (Asia/Taipei). Status: **assessment/prototype only; deployment stack unchanged**. Baseline inspected: 9533171. Source proposal: user-provided, untracked docsCODEX_ARCHITECTURE_ADDENDUM.md; preserved unchanged. The user's explicit confirmed product decision remains Google/GitHub single or dual identity. This assessment does not silently adopt every imperative in the attached reference.

## Outcome

Preserving the React/Next UI while evaluating Workers is plausible. Replacing Supabase/PostgreSQL with D1/Auth is a separate, substantial security/transaction port. Do not replace the application with a new Vite/Hono scaffold or translate migrations mechanically. No Cloudflare resource, account, key or deployment was created.

## What was actually checked

- Registry metadata: vinext 1.3.0 (Node >=22), @opennextjs/cloudflare 1.20.13 (Next peer >=15.5.28 <16 or >=16.4.1; Wrangler ^4.148.0), Better Auth 1.7.12. These are observations at execution time, not pinned production dependencies or a support guarantee.
- In an isolated worktree at the baseline, frozen install passed. `pnpm dlx vinext@1.3.0 check` run from **apps/web** reported 100% static compatibility (15 supported, 0 partial/issues): five import categories, headers/transpilePackages, App Router/proxy, six pages and fourteen handlers. Local report: .local/vinext-check-web.log.
- An initial command used the monorepo root and reported missing app/pages despite recursively seeing imports. Rerunning with the actual web cwd fixed the scope. The check exited 0 in both cases: exit status alone is not a compatibility gate.
- This was a static scan, **not** vinext init/build/workerd preview or deployment. It did not exercise Supabase SSR, HttpOnly/chunked refresh cookies, PKCE, RSC redirects, runtime crypto/Buffer or cache headers. Its library report listed Tailwind/Zod; that is not proof that every Supabase dependency is supported.
- Eight isolated Node SQLite tests passed. They demonstrate a zero-row UPDATE/audit trap and one possible guarded command design. They are not D1 tests or a new production repository. See experiments/sqlite-portability/README.md.

Cloudflare currently documents vinext as its recommended Next path, including proxy/App Router support, while describing it as beta. Therefore the first hosting PoC should evaluate the existing application with a pinned adapter and the same browser assertions before any adoption. OpenNext remains an alternative to evaluate; matching its Next peer range is insufficient runtime evidence. [Official Next/Workers guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/)

## Existing code and porting boundaries

| Area         | Existing evidence                                                                                  | Migration requirement                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI/contract  | apps/web dashboard/client forms; packages/contracts Zod DTOs                                       | Preserve URLs, IDs, pagination, 409 draft UX and requestId retry behavior; avoid rewriting UI before runtime evidence                                       |
| Runtime      | next/headers, next/server, next/navigation, proxy.ts request/response cookies                      | Real workerd preview must pass cookie refresh/chunk/redirect/no-store tests; Next build on Node is not proof                                                |
| Node APIs    | node:crypto on request paths; Buffer cursor encoding                                               | Test pinned adapter/node compatibility; fs/pg in tools/migrate.mjs remains local admin tooling                                                              |
| Auth         | Supabase SSR getUser/signInWithOAuth/linkIdentity                                                  | Introduce an Auth service boundary; preserve platform IDs and provider subjects, invalidate/reissue sessions during migration; never merge by display email |
| Data         | SupabaseClient constructors in workspace/project/link repositories; PostgREST reads and RPC writes | Preserve method contracts; replace transport, authorization and transaction implementation separately                                                       |
| SQL safety   | auth.uid/identities, RLS/ACL, SECURITY DEFINER, PL/pgSQL, JSONB, timestamptz, advisory/row locks   | Existing six migrations cannot be replayed into SQLite. Worker-side actor/tenant/role checks and atomic DB invariants must be re-proven                     |
| Storage/jobs | memory storage; Worker directory is placeholder                                                    | R2/Queues/Cron still unimplemented; no hosting adapter creates these automatically                                                                          |
| Production   | env schema blocks production memory storage                                                        | Keep the gate until real Auth/private storage/retention evidence exists                                                                                     |

## Hard transaction finding

D1 documents batch execution as a transaction with rollback on a failed statement. It does not make a conditional UPDATE that affects no rows an error. Thus naively batching `UPDATE ... WHERE revision=?` then audit/idempotency INSERTs could record success without a mutation. This is an inference from the documented batch semantics, reproduced with an isolated SQLite transaction; remote D1 itself remains untested. [D1 database batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)

The experiment raises a statement error for stale revision, authorizes before replay, and uses trigger-driven mutation/audit. Audit/write failure tests leave no command, event or mutation. A historical replay keeps later state intact. SQLite RAISE behavior supports the prototype's abort/ignore choices. [SQLite triggers](https://www.sqlite.org/lang_createtrigger.html)

This does **not** replace PostgreSQL RLS or a complete authorization service. The prototype trusts fixture actor IDs and has no role matrix; any code with the D1 binding may issue direct SQL. Production port tests must cover every entrypoint, revoked-session writes, current-role checks before replay, FK isolation, quota reservations, partial failure, concurrency and private history. Do not issue SQL BEGIN/COMMIT across independent D1 HTTP calls or equate D1 Sessions/bookmarks with interactive PostgreSQL transactions.

## Auth and policy differences

- Current app uses stable Supabase user.id; manual binding verifies before/after actor. Supabase automatic same-verified-email linking is still an external behavior; strict manual-only linking is not satisfied just by hiding a button. See AUTH_SPEC/LOCAL_AUTH.
- Better Auth currently documents disableImplicitLinking=true while preserving explicit linkSocial. Its OAuth validation hook can inspect provider identity before creation/link/sign-in. These make it a candidate for strict linking/subject-based access, not an implemented choice. Disabling email/password sign-up alone does not prove OAuth registration is closed. Version 1.7.12 was metadata-checked, not installed, typechecked or exercised on D1. [Linking](https://better-auth.com/docs/concepts/users-accounts), [OAuth validation](https://better-auth.com/docs/concepts/oauth), [Options](https://better-auth.com/docs/reference/options)
- Current app is multi-tenant and does not implement closed registration, offline Owner bootstrap, mandatory fresh reauthentication, secure unlink or full session management. An Owner allowlist must use verified provider subject/issuer or mapped user ID, never first-login-wins/email text. It must cover direct API/DB paths, not only OAuth UI.
- Proposal quota 9,000,000,000 differs from current 8,000,000,000 internal default. Keep current behavior until an explicit policy migration/configuration; neither number guarantees zero R2 cost. No pricing/terms/account allowance audit was done here.

## Staged plan and acceptance gates

1. **Hosting-only isolated PoC:** keep Supabase/PostgreSQL and IDs; pinned vinext setup in an experimental worktree, build and workerd preview, replay the eleven existing browser tests against that runtime. Assert PKCE/link before/after actor, both providers, chunked refresh/parallel requests/logout replay, cookies/redirect/cache headers. Do not change production.
2. **Auth/repository ports:** extract interfaces behind factories while retaining the current implementation as reference. Add explicit subject-based Owner policy/closed bootstrap design. Evaluate pinned Better Auth with implicit linking disabled, permitted identities, existing-account conflict, fresh reauth and concurrent unlink retaining one usable source.
3. **D1 vertical prototype:** isolated schema and real local D1 binding; create/read/rename with roles, tenant checks, request replay, revisions and audit rollback. Add true concurrent tests and remote disposable staging only when authorized/configured. No dual writes to production.
4. **Migration rehearsal:** export a snapshot, preserve existing IDs and all ownership/event/request associations, transform timestamps/JSON/int64 safely; verify counts, FKs, audit hashes and authorization. Auth sessions are not assumed portable. Compare reference API results; rehearse restore into a separate DB.
5. **Cutover gate:** stop writes, final export/checks, operator-controlled switch; retain verified backup/reference stack and documented rollback. R2 private upload/usage/retention/guest release gates still apply. Free-first is an aim; billing and limits must be verified before deployment.

No part of the attached original photography/guest/version/history/retention feature list is cancelled by this assessment. Next smallest task is the isolated hosting runtime PoC; M1-02 state/protection work remains on the task board.

## Local runtime follow-up (2026-10-23)

The isolated `codex/kino-pic-cloudflare-runtime` branch now has a reproducible Vite production build and built-Worker Wrangler preview, preserving all Supabase/PostgreSQL app code. Existing browser workflows and an additional direct-page expired-session proxy case run on workerd. See that branch's `experiments/cloudflare-runtime/README.md` and main VERIFICATION/HANDOFF. This advances the hosting gate only for local runtime; it is not adoption, cloud deployment, Auth replacement, D1 proof or a change to registration/ownership policy. Main defaults remain Next.

Framework difference discovered: Next overwrites proxy Vary with its RSC list while workerd retains Cookie. Both tested runtimes prohibit private response caching via private/no-store. The common regression tests cache prohibition and actual HttpOnly session rotation, rather than relying on a framework-specific Vary value. Cloud CDN behavior and HTTPS still require independent validation.
