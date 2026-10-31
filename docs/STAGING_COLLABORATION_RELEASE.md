# Scoped B collaboration validation release

This runbook describes the manual workflow_dispatch release for the bounded B staging collaboration profile. It does not change the general Cloudflare deployment workflow, the production workflow, or the global MVP readiness gate.

## What the workflow releases

The workflow checks out one full commit SHA from kinostudio/kino-pick, then runs the product build, the scoped Wrangler dry run, the focused photographer metadata/recommendation native D1/R2 run, and the 24-check scoped collaboration native D1/R2 run.

Before deployment, the preflight requires all of the following:

- The newest completed run of .github/workflows/ci.yml for the exact source SHA completed successfully.
- The committed collaboration-0059 restore manifest proves an independent schema 57 to 59 restore/upgrade, zero source writes, parity, and zero foreign-key violations. Its 0058 and 0059 hashes must match the checked-in migrations.
- The local 10-group photographer proof and 24-check collaboration proof match their exact test runners, built bundles, profile, source files, and migration hashes.
- Cloudflare account B, the fixed Worker, D1, and R2 match their expected IDs. D1 has exactly the 59 checked-in migration names and zero foreign-key violations.
- The expected six secret names are present. Secret values are never read into the receipt or printed.
- R2 has no enabled managed public URL or custom public domain.
- The fixed workers.dev entry is already closed, preview URLs are closed, the prior Worker version matches the reviewed baseline, and there are no Worker routes or cron schedules.
- The scoped config keeps storage auto-delete off, retention dry-run on, multi-account storage off, registration closed, and only its fixed D1 and R2 bindings.

After Wrangler deploys the pinned profile, a second read-only check verifies its complete runtime flags/bindings and the latest 100 percent deployment annotation against the same source SHA. The workflow uploads a non-secret JSON receipt before the final public-entry step. Only the last step may enable the fixed workers.dev entry, and it sets previews_enabled to false. It does not change routes, DNS, the R2 bucket, or D1 data.

## Dispatch

1. Confirm the 0059 adoption and committed restore manifest are complete for B, and confirm the existing B workers.dev entry is closed.
2. Confirm a successful checks workflow run exists for the exact commit to release.
3. In GitHub Actions, select Deploy scoped B collaboration validation, choose Run workflow, and enter the complete 40-character source SHA.
4. Review the workflow result and download the kino-pic-collaboration-validation artifact. The receipt records the source SHA, exact CI run, deployed Worker version UUID, deployment UUID, migration hashes, native proof digests, and closed-entry check. It contains no secret values, SQL, or backup data.

The workflow intentionally does not test or require production readiness flags. It is limited to this named staging validation profile; the standard deployment workflow remains unchanged and blocked by its existing gate.

## Failure and recovery

- If source pinning, CI, local evidence, or pre-deploy resource checks fail, no Worker deploy or public-entry mutation occurs.
- If Wrangler succeeds but the post-deploy checks or artifact upload fail, the workers.dev entry remains closed. Preserve the failed action log and deployed version UUID; do not rerun migrations or manually open the entry.
- The activation script rechecks the full post-deploy conditions immediately before its only normal mutation. If enabling or readback fails after an enable attempt, it posts the fixed entry closed and verifies that both the entry and previews are disabled. If it cannot confirm that state, the workflow reports the public state as unknown; close the fixed workers.dev entry in the Cloudflare dashboard and verify it before further work.
- To recover a failed deployment, have the release owner restore the previously verified Owner baseline version using the controlled Cloudflare release process while keeping the entry closed. Do not edit DNS, routes, R2 public access, or D1 as part of this workflow. The 0059 migration is forward-only; use the existing recovery notes in the migration and restore manifest.

The Cloudflare checks use the read-only Workers settings, deployments, secrets-name, schedules, R2 domain, and D1 query APIs. The activation step uses only the Workers script subdomain endpoint for the fixed B Worker. See the [Workers settings API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/), [Workers deployments API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/), [Workers subdomain API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/subdomain/), [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), and [R2 bucket domains API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/domains/).
