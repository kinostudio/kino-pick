import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
export const userA = '11111111-1111-4111-8111-111111111111';
export const userB = '22222222-2222-4222-8222-222222222222';
export const userC = '33333333-3333-4333-8333-333333333333';
export const requestA = 'aaaaaaaa-1111-4111-8111-111111111111';
export const requestB = 'bbbbbbbb-2222-4222-8222-222222222222';
export const requestC = 'cccccccc-3333-4333-8333-333333333333';
export async function fixtureDb() {
  const db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated;
 create table auth.users(id uuid primary key); create table auth.identities(user_id uuid references auth.users(id),provider text not null);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to authenticated,anon; grant execute on function auth.uid() to authenticated;`);
  const dir = new URL('../../packages/db/migrations/', import.meta.url);
  for (const name of (await readdir(dir))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    await db.exec(await readFile(new URL(name, dir), 'utf8'));
  await db.query('insert into auth.users values($1),($2),($3)', [
    userA,
    userB,
    userC,
  ]);
  await db.query(
    "insert into auth.identities values($1,'google'),($2,'google'),($3,'email')",
    [userA, userB, userC],
  );
  return db;
}
export async function loginDb(db: PGlite, userId: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId,
  ]);
  await db.exec('set role authenticated');
}
