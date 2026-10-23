# Cloudflare deployment and cutover runbook

Target adopted by explicit user request on 2026-10-23: GitHub CI/CD + Workers/Static Assets + D1 + private R2 + Cron, closed Owner identity. This changes the deployment target, not the original product feature requirements. Current Cloudflare entry is a tested migration foundation, not a replacement for the existing project UI/API. No remote resource or deployment has been created. `.invalid` origins and synthetic D1 IDs deliberately block accidental adoption.

## Local, no cloud credentials

Node24, pnpm11.25.0, from repository root (Windows may need pnpm.cmd):

```powershell
pnpm install --frozen-lockfile
pnpm --filter @kino-pic/worker db:migrate:local
pnpm dev:cloudflare
# Another terminal:
pnpm test:cloudflare
```

Worker listens only on 127.0.0.1:8787. Root page honestly describes migration status; /api/health is a configuration/liveness check, not provider connectivity. Without valid secret/provider configuration, management APIs fail SERVICE_NOT_READY. There is no production mock-login mode. `pnpm test:cloudflare` dry-builds both production and test-only entries, starts actual workerd/D1/R2 through pinned Miniflare and replaces provider HTTP responses only inside the test process. RSA fixture keys remain ephemeral; no real OAuth connection is claimed.

Existing `pnpm dev/build/test:e2e` continues to run the Next/Supabase/PostgreSQL reference and its existing workflows. It must not be deployed as the new closed-registration target without a separately approved policy/cutover change. The old Auth code was preserved; there is no claim that its earlier open/automatic-email behavior has become closed.

## Explicit Owner bootstrap

Verify Google sub from a correctly verified provider identity, or GitHub stable numeric ID from an authenticated provider response. Never use email, display name, first visitor or an unverified decoded token. The CLI requires an operator attestation; it cannot establish external identity ownership itself. For local tests use synthetic subjects only.

```powershell
node tools/bootstrap-cloudflare-owner.mjs --user-id 99999999-9999-4999-8999-999999999999 --google-sub YOUR_VERIFIED_GOOGLE_SUB --github-id 123456789 --verified-subjects --out .local/owner-bootstrap.sql
pnpm --filter @kino-pic/worker exec wrangler d1 execute DB --local --file ../../.local/owner-bootstrap.sql
```

Either provider may be omitted. To preserve a migrated identity, use the reviewed original internal UUID, not a newly inferred email match. The generator refuses to overwrite files and does not connect anywhere. Review the SQL and exact database before application. Its single INSERT triggers user/accounts/owner/audit atomically, then permanently closes bootstrap. Audit failure leaves no partial user/owner; duplicate bootstrap aborts. Synthetic bootstrap.invalid email is a non-deliverable placeholder, not a merge/authorization key. Initial pre-provisioning of two verified subjects is an operator bootstrap, not the future in-app fresh-reauth linking feature.

Create apps/worker/.dev.vars from its .dev.vars.example only when configuring actual providers. Use a random >=32-character BETTER_AUTH_SECRET; Google/GitHub keys stay out of Git. Callbacks: canonical APP_URL + /api/auth/callback/google or /api/auth/callback/github. Better Auth owns OAuth/state/PKCE/session verification; Google code-flow profile mapping additionally uses its verifyGoogleIdToken helper. Explicit account linking/unlinking is closed until fresh reauthentication, last-provider protection and audit are implemented. Current session sign-out is implemented; a session-management UI and broader revoke controls remain pending.

## Independent environments and controlled CD

wrangler.jsonc has separate local/staging/production D1 identifiers and R2 bucket names; staging/production have no workers.dev exposure and use invalid canonical URLs until explicitly configured. Generate types after edits. Never reuse customer production D1/R2 for local or staging tests. No migrations run at request startup. D1 migrations are under apps/worker/migrations, unrelated to packages/db/migrations (PG). Do not apply PG SQL to D1.

CI now runs Cloudflare dry-build/local tests in addition to the original suite. deploy-cloudflare.yml is manual workflow_dispatch, serialized per environment, uses GitHub protected environments and environment-specific least-privilege Cloudflare secrets. The readiness guard intentionally always rejects this foundation stage, even if someone flips JSON flags; production deploy remains unavailable until a reviewed cutover implementation replaces it with resource/schema/provider/restore checks. Configure GitHub production environment required reviewers before enabling CD. No hosted Actions execution or deployment is claimed.

Required release gates include all original business flows on the target D1 backend, actual Google/GitHub callback/closed-owner tests, fresh linking/unlinking/session controls, private direct-upload completion validation, backups/import/restore rehearsal and billing/terms review. The current Worker has no project/album D1 repository or gallery frontend; do not redirect existing users to it yet.

## Cron and storage limits

Staging/production Cron is daily UTC. Current scheduled handler only appends an idempotent observation with deleted=0 and eligibility=not_implemented. It does not select candidates, reconcile bytes, preview deletions or delete anything. Local Wrangler --test-scheduled /__scheduled was actually triggered and its D1 audit inspected. No remote Cron has run. Automatic deletion remains false and dry_run true in both configuration and D1 constraints.

Default new D1 node quota is 9,000,000,000 internal bytes from the addendum; existing PostgreSQL 8GB settings are not rewritten. This is not an official free limit or a zero-bill promise. One same-account private R2 binding is enabled; multi-account routing is false. storage_nodes stores credential_ref only; no S3 secret in DB/frontend. Low-level R2 scoped conditional puts/reads are locally tested, but signed direct-upload URLs, magic/size/hash completion verification, quota reservations, asset/node metadata, actual image processing and cross-node moves are still pending. The test-only 8-byte PNG signature object is synthetic binary storage evidence, not a valid-image pipeline test.

Verify current official [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) plus applicable Cloudflare terms before resource creation or any cross-account policy. Quotas, CPU/memory, operations and monthly storage accounting are separate costs. Browser/local thumbnail generation remains the initial direction; no large-image decoding/heatmap is assumed to fit Free Workers.

## Recovery

Back up and verify target DB/bucket separately before any future cutover. Do not delete the PG schema, rewrite old migrations or remap IDs automatically. Current D1 tables hold only new local/test foundation data; no customer import occurred. Stop local Worker to return to the existing Next reference. Preserve audit/bootstrap/session evidence; use reviewed forward D1 migrations instead of deleting tables. Real backup/Time Travel/R2 restore has not been exercised. R2 is not an independent backup.
