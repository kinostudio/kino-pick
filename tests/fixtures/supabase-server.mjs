// TEST-ONLY loopback Supabase HTTP fixture. Never imported by application code.
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { z } from 'zod';
const db = new PGlite();
const users = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
};
await db.exec(`create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key);create table auth.identities(user_id uuid references auth.users(id),provider text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon;grant execute on function auth.uid() to authenticated;`);
const dir = new URL('../../packages/db/migrations/', import.meta.url);
for (const name of (await readdir(dir))
  .filter((n) => n.endsWith('.sql'))
  .sort())
  await db.exec(await readFile(new URL(name, dir), 'utf8'));
for (const id of Object.values(users)) {
  await db.query('insert into auth.users values($1)', [id]);
  await db.query("insert into auth.identities values($1,'google')", [id]);
}
const codes = new Map(),
  tokens = new Map(),
  refreshes = new Map();
const now = () => Math.floor(Date.now() / 1000);
function user(id) {
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: id === users.a ? 'a@example.test' : 'b@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: {},
    identities: [
      {
        id,
        user_id: id,
        identity_id: id,
        provider: 'google',
        identity_data: { sub: `fixture-${id}` },
        created_at: new Date(0).toISOString(),
      },
    ],
    created_at: new Date(0).toISOString(),
  };
}
function issue(id) {
  const access = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({
        sub: id,
        iat: now(),
        exp: now() + 3600,
        role: 'authenticated',
        jti: randomUUID(),
      }),
    ).toString('base64url'),
    'test-only-invalid-signature',
  ].join('.');
  const refresh = randomUUID();
  tokens.set(access, { id, refresh });
  refreshes.set(refresh, id);
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now() + 3600,
    user: user(id),
  };
}
const body = async (req) => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16384) throw new Error('BODY_LIMIT');
  }
  return JSON.parse(raw || '{}');
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:54329');
  const send = (status, value) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(value));
  };
  try {
    if (url.pathname === '/health') return send(200, { fixture: true });
    if (url.pathname === '/auth/v1/authorize') {
      const redirect = url.searchParams.get('redirect_to');
      const challenge = url.searchParams.get('code_challenge');
      if (
        redirect !== 'http://127.0.0.1:3100/auth/callback' ||
        !challenge ||
        url.searchParams.get('code_challenge_method') !== 's256' ||
        url.searchParams.get('provider') !== 'google'
      )
        return send(400, { message: 'INVALID_FIXTURE_AUTHORIZE' });
      const code = randomUUID();
      codes.set(code, {
        challenge,
        id: /(?:^|;\s*)fixture-user=b(?:;|$)/.test(req.headers.cookie ?? '')
          ? users.b
          : users.a,
      });
      res.writeHead(303, { Location: `${redirect}?code=${code}` });
      return res.end();
    }
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const input = await body(req);
      if (url.searchParams.get('grant_type') === 'pkce') {
        const parsed = z
          .object({ auth_code: z.string(), code_verifier: z.string() })
          .parse(input);
        const record = codes.get(parsed.auth_code);
        codes.delete(parsed.auth_code);
        if (
          !record ||
          createHash('sha256')
            .update(parsed.code_verifier)
            .digest('base64url') !== record.challenge
        )
          return send(400, {
            error_code: 'bad_code_verifier',
            msg: 'Invalid test PKCE exchange',
          });
        return send(200, issue(record.id));
      }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const parsed = z.object({ refresh_token: z.string() }).parse(input);
        const id = refreshes.get(parsed.refresh_token);
        if (!id) return send(400, { message: 'Invalid refresh token' });
        refreshes.delete(parsed.refresh_token);
        return send(200, issue(id));
      }
    }
    const record = tokens.get(
      req.headers.authorization?.replace(/^Bearer /, ''),
    );
    if (!record)
      return send(401, {
        message: 'Auth session missing',
        code: 'session_not_found',
      });
    if (url.pathname === '/auth/v1/user') return send(200, user(record.id));
    if (url.pathname === '/auth/v1/logout') {
      tokens.delete(req.headers.authorization.replace(/^Bearer /, ''));
      refreshes.delete(record.refresh);
      res.writeHead(204);
      return res.end();
    }
    const result = await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        record.id,
      ]);
      if (url.pathname === '/rest/v1/workspaces' && req.method === 'GET') {
        let args = [];
        let where = '';
        const filter = url.searchParams.get('or');
        if (filter) {
          const match =
            /created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)/.exec(
              filter,
            );
          if (!match || match[1] !== match[2])
            throw new Error('INVALID_CURSOR');
          const input = z
            .tuple([z.iso.datetime({ offset: true }), z.uuid()])
            .parse([match[1], match[3]]);
          args = input;
          where = 'where (created_at,id)<($1::timestamptz,$2::uuid)';
        }
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(101)
          .parse(url.searchParams.get('limit') ?? 25);
        return (
          await tx.query(
            `select id,owner_user_id,name,quota_bytes::float8 as quota_bytes,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at from workspaces ${where} order by created_at desc,id desc limit ${limit}`,
            args,
          )
        ).rows;
      }
      if (url.pathname === '/rest/v1/workspace_members' && req.method === 'GET')
        return (
          await tx.query(
            "select workspace_id,role,status from workspace_members where user_id=$1 and status='active' limit 100",
            [record.id],
          )
        ).rows;
      const input = await body(req);
      if (url.pathname === '/rest/v1/rpc/ensure_photographer_profile') {
        const p = z.object({ p_request_id: z.uuid() }).parse(input);
        return (
          await tx.query('select ensure_photographer_profile($1) as result', [
            p.p_request_id,
          ])
        ).rows[0].result;
      }
      if (url.pathname === '/rest/v1/rpc/create_workspace') {
        const p = z
          .object({ p_name: z.string(), p_request_id: z.uuid() })
          .parse(input);
        return (
          await tx.query('select create_workspace($1,$2) as result', [
            p.p_name,
            p.p_request_id,
          ])
        ).rows[0].result;
      }
      if (url.pathname === '/rest/v1/rpc/set_workspace_member') {
        const p = z
          .object({
            p_workspace_id: z.uuid(),
            p_user_id: z.uuid(),
            p_role: z.string(),
            p_status: z.string(),
            p_request_id: z.uuid(),
          })
          .parse(input);
        return (
          await tx.query(
            'select set_workspace_member($1,$2,$3,$4,$5) as result',
            [
              p.p_workspace_id,
              p.p_user_id,
              p.p_role,
              p.p_status,
              p.p_request_id,
            ],
          )
        ).rows[0].result;
      }
      throw new Error('UNSUPPORTED_FIXTURE_ENDPOINT');
    });
    return send(200, result);
  } catch (error) {
    return send(400, { code: error.code ?? 'P0001', message: error.message });
  }
});
server.listen(54329, '127.0.0.1', () =>
  console.log('Test-only Supabase fixture ready on loopback'),
);
async function stop() {
  server.close();
  await db.close();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
