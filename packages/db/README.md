# Database foundation

Migration 202610230001 creates profiles, workspaces, members, projects, albums and photos, with read-only tenant RLS, composite tenant foreign keys and safe retention defaults. It deliberately does not implement the rest of DATA_MODEL.md. No API uses this schema yet. Owners can read their workspace; active members can read joined workspaces. All roles are read-only until M1 transactional provisioning/write services exist. Anon has no grants. Keep the security-definer function owned by the migration administrator.

Use a NEW local/staging Supabase database (auth.users, auth.uid(), anon and authenticated must already exist). Back up first using Supabase backups or pg_dump. Set DATABASE_URL in the shell, then `pnpm db:migrate`. The runner applies all pending SQL in one transaction, locks concurrent runners and refuses changed historical checksums. Do not disable TLS for a remote database. Rerun is safe. Production application rollout is blocked until real Supabase/RLS tests pass.

Recovery: failed migrations roll back atomically. After successful application, prefer a forward corrective migration. To restore data, stop writes and restore the pre-migration backup into a separate database, validate counts/RLS, then switch the connection. Do not DROP tables on a populated database. For an empty disposable local DB, recreate the entire local DB and replay migrations; no automatic down command is supplied.

Tests use PGlite (embedded PostgreSQL) with test-only auth role/function shims. This executes real SQL/RLS but does not validate hosted Supabase Auth, PostgREST, network, extensions or production roles. Run the same isolation cases against local/staging Supabase before M1 sign-off.
