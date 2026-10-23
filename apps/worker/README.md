# KINO Pic Cloudflare migration foundation

This existing package now has a real Hono/Better Auth/Drizzle/D1/Static Assets entry and a private R2 adapter. It does not replace the existing Next project UI/API yet. See ../../docs/DEPLOYMENT.md for local startup, explicit verified-subject Owner bootstrap, environment/secret setup, recovery and deployment gates. PG migrations remain unchanged and must not be applied to D1.

From repo root: `pnpm dev:cloudflare` starts local loopback8787; `pnpm test:cloudflare` dry-builds production/test entries and runs real local workerd/D1/R2 with synthetic Google/GitHub HTTP services only. No fake auth mode is available in the deployable code. Storage test harness is not the configured main. No public upload/download implementation or completed gallery is implied.

Target defaults: closed registration, no email merging, one explicitly provisioned Owner UUID, single private same-account R2 binding, 9GB internal node quota, autodeletion false/dry-run true. Cross-account enablement and direct-upload signer are pending. Cron only appends deleted=0/eligibility=not_implemented observations. No cleanup preview/delete or real resource deployment has occurred.

Pinned local tools include Miniflare5 beta; keep its converter/router flags and rerun tests when upgrading. CD guard intentionally blocks the incomplete cutover. Do not remove old business features or old schema to unblock it.
