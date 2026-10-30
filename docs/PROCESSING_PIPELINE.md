# Durable image processing and private Owner gallery — CF-03c3

## Implemented local path

New original completion → D1 transactional outbox → explicit trusted Node runner → private create-once R2 derivatives → D1 atomic asset/quota/audit completion → authenticated gallery gateway. The native decoder stays outside Worker/browser bundles. This is a real local pipeline, not a browser-submitted manifest or a deployed processing service. No paid processing service, remote resources or automatic cleanup is enabled.

```powershell
pnpm --filter @kino-pic/worker db:migrate:local
pnpm dev:cloudflare
# In another shell, process at most five pending local jobs:
pnpm image:process:pending:local --run 5
```

The command requires explicit `--run`, reads the fixed local Wrangler configuration, sets `remoteBindings:false`, uses local `.wrangler/state/v3`, and rejects a non-local APP_ENV. It runs a finite batch, not a daemon. Output contains opaque job IDs and status only. A failed/review-held batch reports a nonzero exit; a busy job is retained. It does not enable direct uploads. Local defaults disable signing and OAuth. The browser upload acceptance currently uses the isolated harness's signature-checking S3 interception; standalone Wrangler dev does not expose that mock S3 bridge. Merely inserting fake signing keys, or mixing live signed PUTs with a local emulated bucket, cannot produce a working upload flow. Provider settings and aligned storage/signing/CORS or a separately implemented dev bridge remain prerequisites for standalone use. Never copy synthetic test secrets into real environments; keep production flags closed until actual acceptance.

`image:process:local` remains the separate file-to-file operator tool from LOCAL_IMAGE_PROCESSING.md. Its JSON manifest has no authority over the new D1 job workflow.

## Migrations0013–0014 and state

`image_processing_jobs.id` is the immutable original asset ID. One pinned recipe (`local-sharp-0.35.5-v1`) creates two immutable output slots with server-selected UUIDs and scope-prefixed keys. New original insertion, job/slots, original completion, counters and enqueue audit commit or roll back together. No historical asset is automatically backfilled. Legacy metadata/assets/audit/quota remain unchanged by the additive migration; legacy gallery entries without a job are `unavailable`. Unknown dimensions or originals above64MiB are `unsupported` for this processing recipe, rather than silently decoded without bounds.

| State        | Reserved derivative bytes | Meaning                                                           |
| ------------ | ------------------------- | ----------------------------------------------------------------- |
| queued       | 0                         | Awaiting explicit runner and capacity                             |
| running      | 16MiB                     | Current token/epoch lease, at most10 minutes measured by D1 clock |
| retryable    | 16MiB                     | Unknown/transient failure; keep possible physical bytes accounted |
| needs_review | 16MiB                     | Invalid raster or mismatched output; automatic processing stops   |
| succeeded    | 0                         | Both verified immutable assets and actual used bytes committed    |
| unsupported  | 0                         | Original retained; this recipe cannot process it                  |

Claims atomically reserve16MiB against both workspace and aggregate single-node quota. A full quota leaves the original intact and job queued. Concurrent claims for one remaining budget admit only one. Token/epoch/unexpired-lease predicates guard every final/retry/review update; expiry alone neither frees quota nor authorizes a stale worker. The current adapter is for the binding-backed primary node; multi-account processing/routing remains disabled and requires a future configured adapter/router.

The runner checks the lease before reading/decode, before each output write and before commit. It independently checks processor result scope/source/recipe, exactly two kinds, JPEG structural dimensions, size limits and SHA-256, then reads back exact stored bytes. LocalSharp fully decodes the original and reopens/redecodes generated JPEGs as described in LOCAL_IMAGE_PROCESSING.md. Generated output keys are reused across attempts with create-only puts; an occupied key is adopted only if bytes match the expected result. R2 puts bind a provider-verified SHA-256 checksum. A late stale write cannot create a new attempt-specific key or cause a released reservation.

Completion inserts both private assets, converts reserved bytes to actual used bytes at both levels, changes status and appends the UTC audit in one SQL transaction. Failed audit rolls back all D1 changes while the possible R2 bytes stay covered by the retained reservation. Retry regenerates and adopts those same keys. Original/version/asset rows remain immutable. Job changes append before/after states, epoch, reserved bytes and reason without logging lease tokens. Pending/retry/review jobs additionally block archive commands; future retention execution must honor the same busy state.

Migration0014 repairs both upload/processing archive busy guards: only currently authorized Owner/session scope is inspected, and existing request IDs defer to the shared replay/conflict guards. A historical archive retry returns its original snapshot even after restore and new pending work; a new archive still refuses busy resources. It changes triggers only, preserving existing records and counters.

CF-03c4b adds an Owner-confirmed needs_review abandonment endpoint with two permanent output fences and atomic reserved0/audit; see PROCESSING_REVIEW.md. Occupied/unknown outputs remain fully reserved and have no forced cleanup endpoint. Do not manually clear reserved counters or reset a job to queued. Automatic backoff, dead-letter review UI, recipe regeneration/generation switching and a production runner are future work.

## Private API and usable UI

- `GET /api/v1/albums/:albumId/photos?cursor=...`: current Owner/session plus workspace/album scope,24 photos per keyset page (`createdAt,id` descending), opaque cursor. Unknown/foreign/deleting albums are denied. The initial implementation shows version1; manual/current-version switching remains M3 work.
- Each photo returns `id,versionId,filename,width,height,createdAt,processing,thumbnailUrl,previewUrl`. Dimensions are raw encoded dimensions. URLs are nullable until the job succeeds and contain only same-origin gateway paths, never R2 keys or signing credentials.
- `GET /api/v1/photos/:photoId/versions/:versionId/assets/:kind`: only thumbnail/preview, current Owner/session, same logical photo/version, successful job and its exact slot/asset. It checks private R2 size/MIME/provider SHA-256 against D1 and streams the bounded derived JPEG. Images are private/no-store, nosniff, same-origin resource policy. Missing/corrupt physical derivatives fail closed; original downloads have no gateway here.
- Album cards expose a real photo Grid with refresh, pagination, honest processing/review/unavailable tiles and an accessible Lightbox for processed previews. Escape, arrow navigation, focus trap/return and375px layout are browser-tested. No fake rating/download/selection controls were added; guest/picking/version/delivery remain separate milestones.
- List/image/preload requests do not count as valid human-view heartbeats. The retention heartbeat and private-image cache optimization remain later work; deletion stays OFF/dry-run ON.

## Recovery and verification boundary

0013 is additive and0014 repairs its archive guards forward-only. Before remote use, rehearse a representative private backup/restore through0014. Stop the local/production runner before reverting code; retain schema, all immutable assets/jobs/audit and held reservations. An older bundle may keep enqueueing jobs through the DB trigger, which then wait unprocessed; it must never clear their counters. Repair forward or restore a separately verified consistent DB/object snapshot. Do not down-migrate after processing creates physical objects or restore the faulty busy guards. No remote backup/restore or customer-data change has been performed.

Local acceptance uses actual workerd/D1/R2 plus native Node decoding and Chromium, with synthetic OAuth and intercepted S3 only. Cases cover enqueue/claim/final audit rollback, concurrent quota/claims, unknown PUT adoption, expired/stale leases, revoked Owner, corrupt raster review, private gateway denial and25-photo keyset UI/lightbox. The actual local CLI smoke separately proved it connects to local bindings and reports no pending jobs; the full native pipeline was exercised by the isolated harness. Results and initial failures are recorded in VERIFICATION/HANDOFF. No true cloud OAuth/R2/CORS or production deployment proof is implied.

References consulted for this implementation: [Wrangler local binding proxy](https://developers.cloudflare.com/workers/wrangler/api/), [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [R2 conditional writes/checksums](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

CF-03c4b connects the read-only Owner review to an explicit confirmed mutation with permanent output fences, abandoned terminal status and atomic release/audit.0015 is required. See PROCESSING_REVIEW.md for exact states, permanent marker protection and the next terminal-state/atomic-ledger migration.
