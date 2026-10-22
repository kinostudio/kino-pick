# ADR-0002: KINO Pic Phase 0 local foundation

Status: Accepted, 2026-10-23

The user named the product KINO Pic and chose the specification archive directory as the project root. Inventory found no Git repository or app there; the open KINO official-site repository is unrelated and has existing dirty files. Initialize this specified directory, preserve supplied ZIP/combined reference, rename active specifications and leave the official site untouched.

Keep Next.js App Router, strict TypeScript, pnpm workspaces, Tailwind 4, source-owned shadcn-style UI, TanStack Query and Zod. Do not add a public demo identity, fake gallery or in-memory project API that appears persistent. Phase 0 ends at a truthful status page, liveness endpoint, core interfaces, memory storage and initial SQL/RLS. Worker is a documented placeholder. M1 remains open.

Pin resolved package versions and pnpm lockfile. TypeScript 7 currently fails typescript-eslint; use 6.x. ESLint 10 currently conflicts with Next's React/import/a11y plugins; use 9.39.5 until compatible upstream versions exist. ESLint 9 is reported unsupported by the registry: tracked tooling risk; revisit before release. pnpm 11 uses explicit allowBuilds, limited to esbuild, sharp and unrs-resolver. No global tool configuration is changed.

PGlite executes initial migrations/RLS with test-only Supabase auth shims. This is embedded PostgreSQL integration evidence, not hosted Supabase/OAuth/R2 E2E. The Node pg migration runner needs a real disposable Supabase database for full connectivity/recovery validation. No credentials or Docker/psql are available here. Initial SQL grants reads only; role-specific writes, event transactions, immutable version schemas and production adapters belong to future reviewed slices.

Retention is OFF/dry-run in env validation and DB constraints. No destructive engine/queue/UI exists. Interfaces are contracts, not completed services. Enabling cleanup needs a future migration plus explicit owner preview/opt-in flow.

References consulted: [Tailwind Next.js guide](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security). RLS is enabled explicitly on exposed tables; scoped read policies and minimal grants are tested.
