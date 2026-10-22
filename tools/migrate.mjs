import { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required; no database was changed');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(741026230)');
  await client.query('CREATE SCHEMA IF NOT EXISTS kino_migrations');
  await client.query('REVOKE ALL ON SCHEMA kino_migrations FROM PUBLIC');
  await client.query(
    'CREATE TABLE IF NOT EXISTS kino_migrations.applied (name text primary key, sha256 text not null, applied_at timestamptz not null default now())',
  );
  const dir = fileURLToPath(
    new URL('../packages/db/migrations/', import.meta.url),
  );
  for (const name of (await readdir(dir))
    .filter((n) => /^\d+_[a-z_]+\.sql$/.test(n))
    .sort()) {
    const sql = (await readFile(`${dir}/${name}`, 'utf8')).replace(
      /\r\n/g,
      '\n',
    );
    const hash = createHash('sha256').update(sql).digest('hex');
    const existing = await client.query(
      'SELECT sha256 FROM kino_migrations.applied WHERE name=$1',
      [name],
    );
    if (existing.rows.length) {
      if (existing.rows[0].sha256 !== hash)
        throw new Error(`Migration checksum mismatch: ${name}`);
      continue;
    }
    await client.query(sql);
    await client.query(
      'INSERT INTO kino_migrations.applied(name,sha256) VALUES($1,$2)',
      [name, hash],
    );
    console.log(`Applied ${name}`);
  }
  await client.query('COMMIT');
} catch {
  await client.query('ROLLBACK').catch(() => {});
  // Never log the connection string or driver error that may contain secrets.
  console.error(
    'Migration failed and transaction rolled back. Check DB roles, schema and connectivity.',
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
