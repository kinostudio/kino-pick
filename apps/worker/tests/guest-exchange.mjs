import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { guestExchangeLostResponseBrowser } from './guest-exchange-browser.mjs';

const tokenHash = (token) =>
  createHash('sha256')
    .update(`kino-pic:guest-invite-token:v1:${token}`)
    .digest('hex');

function verifier(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `$kino-scrypt$v=1$N=32768,r=8,p=3$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function guestExchangeChecks({ db, mf, check, owner, base }) {
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession);
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const albumId = randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(workspaceId, 'Guest exchange fixtures', owner),
    db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(projectId, workspaceId, 'Exchange project'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(albumId, workspaceId, projectId, 'Exchange album'),
  ]);

  const addInvite = async ({
    mode = 'link_only',
    password = null,
    maxUses = null,
    seal = true,
    expiresAt = Date.now() + 3600000,
  } = {}) => {
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    await db
      .prepare(
        'INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,?,?,1,?,?,?,?)',
      )
      .bind(
        id,
        workspaceId,
        projectId,
        tokenHash(token),
        mode,
        password === null ? null : verifier(password),
        expiresAt,
        maxUses,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(id, workspaceId, projectId, albumId)
      .run();
    if (seal)
      await db
        .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
        .bind(id)
        .run();
    return { id, token };
  };

  const enabled = await mf.getWorker('guest-exchange-test');
  const disabled = await mf.getWorker('app');
  let ipOctet = 30;
  const send = (worker, body, origin = base, extraHeaders = {}) =>
    worker.fetch(
      new Request(origin + '/api/guest/exchange', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': `198.51.100.${ipOctet++}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      }),
    );
  const bodyFor = (invite, extra = {}) => ({
    requestId: randomUUID(),
    token: invite.token,
    displayName: '林 小安',
    ...extra,
  });
  const denial = async (response) => {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: { code: 'GUEST_ACCESS_REQUIRED' },
    });
    assert.equal(response.headers.get('set-cookie'), null);
  };
  const count = async (table, inviteId) =>
    (
      await db
        .prepare(`SELECT count(*) AS n FROM ${table} WHERE invite_id=?`)
        .bind(inviteId)
        .first()
    ).n;

  await check(
    'Guest exchange defaults closed and rejects Worker subrequests and missing trusted client addresses',
    async () => {
      const link = await addInvite();
      const input = bodyFor(link);
      const before = await count('guest_sessions', link.id);
      const closed = await send(disabled, input);
      assert.equal(closed.status, 503);
      assert.equal((await closed.json()).error.code, 'GUEST_EXCHANGE_DISABLED');
      assert.equal(await count('guest_sessions', link.id), before);
      const csrf = await enabled.fetch(
        new Request(base + '/api/guest/exchange', {
          method: 'POST',
          headers: {
            Origin: 'https://attacker.invalid',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': `198.51.100.${ipOctet++}`,
          },
          body: JSON.stringify(bodyFor(link)),
        }),
      );
      assert.equal(csrf.status, 403);
      const malformed = await send(enabled, {
        ...bodyFor(link),
        unexpected: 'rejected',
      });
      assert.equal(malformed.status, 400);
      const oversized = await enabled.fetch(
        new Request(base + '/api/guest/exchange', {
          method: 'POST',
          headers: {
            Origin: base,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': `198.51.100.${ipOctet++}`,
          },
          body: 'x'.repeat(17000),
        }),
      );
      assert.equal(oversized.status, 413);
      await denial(
        await send(enabled, bodyFor(link), base, {
          'CF-Worker': 'subrequest.test',
        }),
      );
      await denial(
        await send(enabled, bodyFor(link), base, {
          'CF-Connecting-IP': '',
        }),
      );
      assert.equal(await count('guest_sessions', link.id), before);
    },
  );

  await check(
    'Link-only Guest exchange creates one HttpOnly session, uses the current ACL and emits request-correlated audit',
    async () => {
      const link = await addInvite();
      const input = bodyFor(link);
      const response = await send(enabled, input);
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.deepEqual(Object.keys(json).sort(), [
        'authenticated',
        'expiresAt',
      ]);
      assert.equal(json.authenticated, true);
      const setCookie = response.headers.get('set-cookie') ?? '';
      assert.match(setCookie, /^kino_guest=[a-f0-9]{64};/);
      assert.match(setCookie, /Path=\//);
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);
      assert.doesNotMatch(setCookie, /Domain=/i);
      const sessionSecret = /^kino_guest=([a-f0-9]{64});/.exec(setCookie)?.[1];
      assert.ok(sessionSecret);
      const session = await db
        .prepare(
          'SELECT s.id,s.secret_hash,s.guest_id,s.expires_at_ms FROM guest_sessions s WHERE s.invite_id=?',
        )
        .bind(link.id)
        .first();
      assert.ok(session);
      assert.equal(
        session.secret_hash,
        createHash('sha256')
          .update(`kino-pic:guest-session:v1:${sessionSecret}`)
          .digest('hex'),
      );
      assert.ok(session.expires_at_ms <= Date.parse(json.expiresAt) + 1);
      const audit = await db
        .prepare(
          "SELECT request_id,actor_type,guest_session_id,after_json FROM audit_events WHERE action='guest.session_created' AND guest_session_id=?",
        )
        .bind(session.id)
        .first();
      assert.equal(audit.request_id, input.requestId);
      assert.equal(audit.actor_type, 'guest');
      assert.equal(audit.guest_session_id, session.id);
      assert.equal(audit.after_json.includes(sessionSecret), false);
      assert.equal(audit.after_json.includes('林 小安'), false);
      assert.equal(await count('guest_exchange_commands', link.id), 1);
      assert.equal(await count('guest_identities', link.id), 1);

      const access = await enabled.fetch(
        new Request(`${base}/api/guest/albums/${albumId}/access`, {
          headers: { Cookie: `kino_guest=${sessionSecret}` },
        }),
      );
      assert.equal(access.status, 200);
      assert.equal((await access.json()).access.albumId, albumId);

      await denial(await send(enabled, input));
      await denial(
        await send(enabled, { ...input, displayName: 'Changed visitor' }),
      );
      assert.equal(await count('guest_sessions', link.id), 1);
      assert.equal(await count('guest_exchange_commands', link.id), 1);
    },
  );

  await check(
    'Password Guest exchange uses the global KDF permit and persists neither plaintext nor verifier in audit',
    async () => {
      const password = 'guest password test';
      const invite = await addInvite({ mode: 'custom_password', password });
      const input = bodyFor(invite, { password });
      const response = await send(enabled, input);
      assert.equal(response.status, 200);
      assert.equal(await count('guest_sessions', invite.id), 1);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_kdf_permits WHERE invite_id=?',
            )
            .bind(invite.id)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_kdf_permit_releases r JOIN guest_kdf_permits p ON p.id=r.permit_id WHERE p.invite_id=?',
            )
            .bind(invite.id)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_kdf_active_slot')
            .first()
        ).n,
        0,
      );
      const audit = JSON.stringify(
        (
          await db
            .prepare(
              'SELECT action,after_json FROM audit_events WHERE project_id=?',
            )
            .bind(projectId)
            .all()
        ).results,
      );
      assert.equal(audit.includes(password), false);
      assert.equal(audit.includes('kino-scrypt'), false);

      const badPasswordInvite = await addInvite({
        mode: 'generated_password',
        password,
      });
      await denial(
        await send(
          enabled,
          bodyFor(badPasswordInvite, { password: 'another wrong password' }),
        ),
      );
      assert.equal(await count('guest_sessions', badPasswordInvite.id), 0);
    },
  );

  await check(
    'A Guest password KDF cannot overlap the active Owner KDF slot',
    async () => {
      const password = 'shared global KDF limit';
      const invite = await addInvite({ mode: 'custom_password', password });
      const ownerPermitId = randomUUID();
      await db
        .prepare(
          'INSERT INTO kdf_permits(id,actor_id,session_id,request_id) VALUES(?,?,?,?)',
        )
        .bind(ownerPermitId, owner, ownerSession.id, randomUUID())
        .run();
      try {
        await denial(await send(enabled, bodyFor(invite, { password })));
        assert.equal(await count('guest_sessions', invite.id), 0);
        assert.equal(await count('guest_kdf_permits', invite.id), 0);
        assert.equal(
          (
            await db
              .prepare('SELECT permit_id FROM kdf_active_slot WHERE slot=1')
              .first()
          ).permit_id,
          ownerPermitId,
        );
      } finally {
        await db
          .prepare('INSERT INTO kdf_permit_releases(permit_id) VALUES(?)')
          .bind(ownerPermitId)
          .run();
      }
    },
  );

  await check(
    'Unknown, revoked, unsealed, wrong-password, and rate-limited attempts share one public denial',
    async () => {
      const revoked = await addInvite();
      await db
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(revoked.id, owner, ownerSession.id)
        .run();
      const unsealed = await addInvite({ seal: false });
      const passwordInvite = await addInvite({
        mode: 'custom_password',
        password: 'correct password value',
      });
      const unknown = bodyFor({ token: randomBytes(32).toString('hex') });
      // Consume each single-use response before issuing the next Miniflare subrequest.
      await denial(await send(enabled, unknown));
      await denial(await send(enabled, bodyFor(revoked)));
      await denial(await send(enabled, bodyFor(unsealed)));
      await denial(
        await send(
          enabled,
          bodyFor(passwordInvite, { password: 'wrong password value' }),
        ),
      );

      const expired = await addInvite({ expiresAt: Date.now() + 1200 });
      await new Promise((resolve) => setTimeout(resolve, 1300));
      await denial(await send(enabled, bodyFor(expired)));

      const rateAddress = `198.51.100.${ipOctet++}`;
      for (let index = 0; index < 21; index++) {
        const reply = await send(
          enabled,
          bodyFor({ token: randomBytes(32).toString('hex') }),
          base,
          { 'CF-Connecting-IP': rateAddress },
        );
        await denial(reply);
      }
    },
  );

  await check(
    'Concurrent redemptions of a max-use-one invite have exactly one atomic winner',
    async () => {
      const invite = await addInvite({ maxUses: 1 });
      const inputs = [bodyFor(invite), bodyFor(invite)];
      const responses = await Promise.all(
        inputs.map((input) => send(enabled, input)),
      );
      const successful = responses.filter(
        (response) => response.status === 200,
      );
      const deniedResponses = responses.filter(
        (response) => response.status !== 200,
      );
      assert.equal(successful.length, 1);
      assert.equal(deniedResponses.length, 1);
      await denial(deniedResponses[0]);
      assert.equal(await count('guest_sessions', invite.id), 1);
      assert.equal(await count('guest_exchange_commands', invite.id), 1);
    },
  );

  await check(
    'Session audit failure rolls the identity, command and Guest session back together',
    async () => {
      const invite = await addInvite();
      await db.exec(
        "CREATE TRIGGER fail_guest_exchange_audit BEFORE INSERT ON audit_events WHEN NEW.action='guest.session_created' BEGIN SELECT RAISE(ABORT,'INJECTED_GUEST_AUDIT_FAILURE'); END",
      );
      try {
        const response = await send(enabled, bodyFor(invite));
        assert.equal(response.status, 503);
        assert.equal(
          (await response.json()).error.code,
          'GUEST_EXCHANGE_UNAVAILABLE',
        );
        assert.equal(await count('guest_sessions', invite.id), 0);
        assert.equal(await count('guest_exchange_commands', invite.id), 0);
        assert.equal(await count('guest_identities', invite.id), 0);
      } finally {
        await db.exec('DROP TRIGGER fail_guest_exchange_audit');
      }
    },
  );

  await check(
    'HTTPS exchange sets a Secure __Host cookie, and a lost response cannot create or recover a second session secret',
    async () => {
      const secureWorker = await mf.getWorker('guest-exchange-secure-test');
      const secureOrigin = 'https://127.0.0.1:8787';
      const secureInvite = await addInvite();
      const secureReply = await send(
        secureWorker,
        bodyFor(secureInvite),
        secureOrigin,
      );
      assert.equal(secureReply.status, 200);
      const secureCookie = secureReply.headers.get('set-cookie') ?? '';
      assert.match(secureCookie, /^__Host-kino_guest=[a-f0-9]{64};/);
      assert.match(secureCookie, /Secure/);
      assert.match(secureCookie, /HttpOnly/);
      assert.match(secureCookie, /Path=\//);
      assert.doesNotMatch(secureCookie, /Domain=/i);

      const lostInvite = await addInvite({ maxUses: 1 });
      const requestId = randomUUID();
      await guestExchangeLostResponseBrowser({
        worker: enabled,
        base,
        token: lostInvite.token,
        requestId,
      });
      assert.equal(await count('guest_sessions', lostInvite.id), 1);
      assert.equal(await count('guest_exchange_commands', lostInvite.id), 1);
    },
  );
}
