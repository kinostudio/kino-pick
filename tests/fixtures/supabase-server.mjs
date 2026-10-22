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
  refreshes = new Map(),
  sessions = new Map();
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
function issue(id, sessionId = randomUUID(), lifetime = 3600) {
  if (!sessions.has(sessionId))
    sessions.set(sessionId, { active: true, current: null });
  const session = sessions.get(sessionId);
  const access = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
      'base64url',
    ),
    Buffer.from(
      JSON.stringify({
        sub: id,
        iat: now(),
        exp: now() + lifetime,
        session_id: sessionId,
        role: 'authenticated',
        jti: randomUUID(),
      }),
    ).toString('base64url'),
    'test-only-invalid-signature',
  ].join('.');
  const refresh = randomUUID();
  tokens.set(access, { id, refresh, sessionId, expiresAt: now() + lifetime });
  refreshes.set(refresh, { id, sessionId, usedAt: null });
  const pair = {
    access_token: access,
    refresh_token: refresh,
    token_type: 'bearer',
    expires_in: lifetime,
    expires_at: now() + lifetime,
    user: user(id),
  };
  session.current = pair;
  return pair;
}
const body = async (req) => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16384) throw new Error('BODY_LIMIT');
  }
  return JSON.parse(raw || '{}');
};
// Restricted PostgREST read subset. All identifiers are fixed below; user
// filters are bound parameters, and the same PostgreSQL RLS runs in this fixture.
const readColumns = {
  workspaces: ['id', 'owner_user_id', 'name', 'quota_bytes', 'created_at'],
  workspace_members: ['workspace_id', 'user_id', 'role', 'status'],
  projects: [
    'id',
    'workspace_id',
    'name',
    'status',
    'versioning_mode',
    'revision',
    'created_at',
  ],
  albums: [
    'id',
    'workspace_id',
    'project_id',
    'name',
    'state',
    'is_pinned',
    'legal_hold',
    'revision',
    'created_at',
  ],
};
async function selectRows(tx, table, url) {
  const allowed = readColumns[table];
  const selected =
    (url.searchParams.get('select') ?? '*') === '*'
      ? allowed
      : url.searchParams.get('select').split(',');
  if (!selected.every((column) => allowed.includes(column)))
    throw new Error('UNSUPPORTED_SELECT');
  const projection = selected
    .map((column) =>
      column === 'created_at'
        ? `to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at`
        : column === 'quota_bytes'
          ? 'quota_bytes::float8 as quota_bytes'
          : column,
    )
    .join(',');
  const args = [],
    conditions = [];
  for (const [column, value] of url.searchParams) {
    if (['select', 'order', 'limit', 'or'].includes(column)) continue;
    if (
      !allowed.includes(column) ||
      !['id', 'workspace_id', 'project_id', 'user_id', 'status'].includes(
        column,
      )
    )
      throw new Error('UNSUPPORTED_FILTER');
    if (value.startsWith('eq.')) {
      const parsed =
        column === 'status'
          ? z.enum(['active', 'suspended']).parse(value.slice(3))
          : z.uuid().parse(value.slice(3));
      args.push(parsed);
      conditions.push(`${column}=$${args.length}`);
    } else if (
      column === 'workspace_id' &&
      value.startsWith('in.(') &&
      value.endsWith(')')
    ) {
      args.push(z.array(z.uuid()).max(25).parse(value.slice(4, -1).split(',')));
      conditions.push(`${column}=any($${args.length}::uuid[])`);
    } else throw new Error('UNSUPPORTED_FILTER');
  }
  const cursor = url.searchParams.get('or');
  if (cursor) {
    if (!allowed.includes('created_at')) throw new Error('UNSUPPORTED_CURSOR');
    const match =
      /^\(created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)\)$/.exec(
        cursor,
      );
    if (!match || match[1] !== match[2]) throw new Error('INVALID_CURSOR');
    args.push(
      z.iso.datetime({ offset: true }).parse(match[1]),
      z.uuid().parse(match[3]),
    );
    conditions.push(
      `(created_at,id)<($${args.length - 1}::timestamptz,$${args.length}::uuid)`,
    );
  }
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(25)
    .parse(url.searchParams.get('limit') ?? 25);
  const order = url.searchParams.get('order');
  if (order && order !== 'created_at.desc,id.desc')
    throw new Error('UNSUPPORTED_ORDER');
  return (
    await tx.query(
      `select ${projection} from public.${table} ${conditions.length ? 'where ' + conditions.join(' and ') : ''} ${order ? 'order by created_at desc,id desc' : ''} limit ${limit}`,
      args,
    )
  ).rows;
}
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
        const refresh = refreshes.get(parsed.refresh_token);
        const session = refresh && sessions.get(refresh.sessionId);
        if (!refresh || !session?.active)
          return send(400, { message: 'Invalid refresh token' });
        // Test subset of provider semantics: concurrent refreshes reuse the
        // current pair for ten seconds. This is not a complete GoTrue emulator.
        if (refresh.usedAt !== null) {
          if (Date.now() - refresh.usedAt <= 10000)
            return send(200, session.current);
          return send(400, { message: 'Refresh token already used' });
        }
        refresh.usedAt = Date.now();
        return send(200, issue(refresh.id, refresh.sessionId));
      }
    }
    const record = tokens.get(
      req.headers.authorization?.replace(/^Bearer /, ''),
    );
    if (
      !record ||
      !sessions.get(record.sessionId)?.active ||
      record.expiresAt <= now()
    )
      return send(401, {
        message: 'Auth session missing',
        code: 'session_not_found',
      });
    if (url.pathname === '/__test/session/expire' && req.method === 'POST')
      return send(200, issue(record.id, record.sessionId, -3600));
    if (url.pathname === '/auth/v1/user') return send(200, user(record.id));
    if (url.pathname === '/auth/v1/logout') {
      // Revoke the entire fixture session, including older rotated access tokens.
      sessions.get(record.sessionId).active = false;
      res.writeHead(204);
      return res.end();
    }
    const result = await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        record.id,
      ]);
      const table = url.pathname.replace('/rest/v1/', '');
      if (req.method === 'GET' && Object.hasOwn(readColumns, table))
        return selectRows(tx, table, url);
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
      const projectRpc = url.pathname.replace('/rest/v1/rpc/', '');
      const rpcArguments = {
        create_project: ['p_workspace_id', 'p_name', 'p_request_id'],
        rename_project: [
          'p_project_id',
          'p_name',
          'p_expected_revision',
          'p_request_id',
        ],
        create_album: ['p_project_id', 'p_name', 'p_request_id'],
        rename_album: [
          'p_album_id',
          'p_name',
          'p_expected_revision',
          'p_request_id',
        ],
      };
      if (Object.hasOwn(rpcArguments, projectRpc)) {
        const keys = rpcArguments[projectRpc];
        const values = keys.map((key) =>
          key === 'p_name'
            ? z.string().parse(input[key])
            : key === 'p_expected_revision'
              ? z.number().int().positive().parse(input[key])
              : z.uuid().parse(input[key]),
        );
        return (
          await tx.query(
            `select public.${projectRpc}(${keys.map((_, i) => '$' + (i + 1)).join(',')}) as result`,
            values,
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
