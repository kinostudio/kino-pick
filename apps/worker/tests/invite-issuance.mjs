import assert from 'node:assert/strict';
import { createHash, randomUUID, scryptSync } from 'node:crypto';
import { lostInviteResponse } from './invite-issuance-browser.mjs';
import { kdfPermitChecks } from './kdf-permits.mjs';

export async function inviteIssuanceChecks({
  db,
  mf,
  request,
  headers,
  projectId,
  albumId,
  otherAlbumId,
  owner,
  check,
}) {
  const rights = Object.fromEntries(
    [
      'can_view',
      'can_download_preview',
      'can_download_original',
      'can_select',
      'can_rate',
      'can_favorite',
      'can_tag',
      'can_annotate',
      'can_comment',
      'can_submit',
      'can_view_own_history',
      'can_compare_versions',
    ].map((key) => [key, key === 'can_view']),
  );
  const body = (mode = 'link_only') => ({
    requestId: randomUUID(),
    albumIds: [albumId],
    accessMode: mode,
    permissions: rights,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    maxUses: 3,
    ...(mode === 'custom_password'
      ? { password: ' custom-📷-secret-value ' }
      : {}),
  });
  const post = (input, extra = {}) =>
    request(`/api/v1/projects/${projectId}/invites`, {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(input),
    });
  const recover = (id) =>
    request(`/api/v1/invites/creation/${id}`, { headers });
  const disabled = await mf.getWorker('upload-disabled');
  const off = (input) =>
    disabled.fetch(
      `http://127.0.0.1:8787/api/v1/projects/${projectId}/invites`,
      { method: 'POST', headers, body: JSON.stringify(input) },
    );
  const commandCount = () =>
    db.prepare('SELECT count(*) AS n FROM invite_creation_commands').first();
  const session = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  await kdfPermitChecks({
    db,
    mf,
    owner,
    session: session.id,
    check,
    post,
    body,
  });
  let winner;
  await check(
    'Owner issuance gate and strict input deny before any new command, invite or secret',
    async () => {
      const before = await commandCount();
      assert.equal((await off(body())).status, 503);
      assert.equal(
        (await post(body(), { Origin: 'https://attacker.invalid' })).status,
        403,
      );
      for (const bad of [
        { ...body(), password: 'forbidden-mode-password' },
        { ...body(), albumIds: [albumId, albumId] },
        { ...body(), token: 'caller-secret' },
        { ...body('custom_password'), password: 'short' },
        { ...body(), albumIds: [] },
      ])
        assert.equal((await post(bad)).status, 400);
      assert.equal(
        (
          await request(`/api/v1/projects/${projectId}/invites`, {
            method: 'POST',
            headers: {
              Origin: headers.Origin,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body()),
          })
        ).status,
        401,
      );
      assert.equal(
        (await post({ ...body(), albumIds: [otherAlbumId] })).status,
        409,
      );
      assert.equal(
        (
          await post({
            ...body(),
            expiresAt: new Date(Date.now() - 10000).toISOString(),
          })
        ).status,
        409,
      );
      assert.equal((await commandCount()).n, before.n);
    },
  );
  await check(
    'All three Owner invitation modes atomically seal exact scope and reveal secrets only on initial winner',
    async () => {
      for (const mode of [
        'link_only',
        'generated_password',
        'custom_password',
      ]) {
        const input = body(mode),
          response = await post(input);
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.equal(result.secretAvailable, true);
        assert.match(result.token, /^[a-f0-9]{64}$/);
        assert.equal(result.invite.projectId, projectId);
        const row = await db
          .prepare('SELECT * FROM guest_invites WHERE id=?')
          .bind(result.invite.inviteId)
          .first();
        assert.equal(
          row.token_hash,
          createHash('sha256')
            .update(`kino-pic:guest-invite-token:v1:${result.token}`)
            .digest('hex'),
        );
        assert.equal(row.permissions_mask, 1);
        assert.equal(row.access_mode, mode);
        if (mode === 'link_only') {
          assert.equal(row.password_verifier, null);
          assert.equal(result.generatedPassword, null);
        } else {
          const password =
            mode === 'generated_password'
              ? result.generatedPassword
              : input.password;
          if (mode === 'generated_password') {
            assert.match(password, /^[a-f0-9]{64}$/);
            assert.notEqual(password, result.token);
          } else assert.equal(result.generatedPassword, null);
          const [salt, key] = row.password_verifier.split('$').slice(-2);
          assert.equal(
            key,
            scryptSync(password, Buffer.from(salt, 'hex'), 32, {
              N: 32768,
              r: 8,
              p: 3,
              maxmem: 64 * 1024 * 1024,
            }).toString('hex'),
          );
          assert.ok(
            !JSON.stringify(
              await db
                .prepare(
                  'SELECT * FROM invite_creation_commands WHERE request_id=?',
                )
                .bind(input.requestId)
                .first(),
            ).includes(password),
          );
        }
        assert.ok(
          await db
            .prepare('SELECT 1 FROM guest_invite_seals WHERE invite_id=?')
            .bind(row.id)
            .first(),
        );
        assert.deepEqual(
          (
            await db
              .prepare(
                'SELECT album_id FROM guest_invite_albums WHERE invite_id=?',
              )
              .bind(row.id)
              .all()
          ).results,
          [{ album_id: albumId }],
        );
        const replay = await (await post(input)).json(),
          recovery = await (await recover(input.requestId)).json();
        assert.deepEqual(replay, {
          invite: result.invite,
          secretAvailable: false,
        });
        assert.deepEqual(recovery, replay);
        assert.deepEqual(await (await off(input)).json(), replay);
        const offRecovery = await disabled.fetch(
          `http://127.0.0.1:8787/api/v1/invites/creation/${input.requestId}`,
          { headers },
        );
        assert.deepEqual(await offRecovery.json(), replay);
        const audit = (
          await db
            .prepare(
              "SELECT * FROM audit_events WHERE request_id=? AND action IN('share.created','share.scope_sealed')",
            )
            .bind(input.requestId)
            .all()
        ).results;
        assert.equal(audit.length, 2);
        for (const secret of [
          result.token,
          result.generatedPassword,
          input.password,
          row.password_verifier,
        ].filter(Boolean))
          assert.ok(!JSON.stringify(audit).includes(secret));
        assert.ok(!JSON.stringify(recovery).includes('hash'));
        assert.ok(!JSON.stringify(recovery).includes('commitment'));
        if (mode === 'custom_password')
          assert.equal(
            (await post({ ...input, password: input.password + 'different' }))
              .status,
            409,
          );
        if (mode === 'link_only') winner = { input, result };
      }
    },
  );
  await check(
    'Concurrent identical creation has one positive D1 winner and no losing or replayed secrets',
    async () => {
      const input = body(),
        responses = await Promise.all(
          Array.from({ length: 3 }, () => post(input)),
        );
      for (const r of responses) assert.equal(r.status, 200);
      const results = await Promise.all(responses.map((r) => r.json()));
      assert.equal(results.filter((r) => r.secretAvailable).length, 1);
      assert.equal(new Set(results.map((r) => r.invite.inviteId)).size, 1);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM invite_creation_commands WHERE request_id=?',
            )
            .bind(input.requestId)
            .first()
        ).n,
        1,
      );
      assert.equal((await post({ ...input, maxUses: 4 })).status, 409);
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      assert.equal((await recover(input.requestId)).status, 403);
      assert.equal((await post(input)).status, 403);
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner)
        .run();
      await db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status='draft' WHERE id=?",
        )
        .bind(projectId)
        .run();
      assert.equal((await post(input)).status, 200);
      assert.equal((await recover(input.requestId)).status, 200);
      await db
        .prepare(
          "UPDATE projects SET status='draft',archived_from_status=NULL WHERE id=?",
        )
        .bind(projectId)
        .run();
    },
  );
  await check(
    'Issuance seal/audit failure rolls back entire command/parent/scope; exact original request can retry',
    async () => {
      const input = body(),
        before = await db
          .prepare('SELECT count(*) AS n FROM guest_invites')
          .first();
      await db.exec(
        "CREATE TRIGGER fail_create_seal_audit BEFORE INSERT ON audit_events WHEN NEW.action='share.scope_sealed' BEGIN SELECT RAISE(ABORT,'TEST_CREATE_SEAL_FAILURE'); END",
      );
      assert.equal((await post(input)).status, 503);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM guest_invites').first()).n,
        before.n,
      );
      assert.equal((await recover(input.requestId)).status, 404);
      await db.exec('DROP TRIGGER fail_create_seal_audit');
      assert.equal((await (await post(input)).json()).secretAvailable, true);
    },
  );
  await check(
    'Issuance request IDs conflict symmetrically with all five existing Owner ledgers',
    async () => {
      for (const table of [
        'request_commands',
        'upload_requests',
        'upload_workflow_requests',
        'processing_review_commands',
        'invite_revocation_commands',
      ]) {
        const row = await db
          .prepare(`SELECT * FROM ${table} WHERE actor_id=? LIMIT 1`)
          .bind(owner)
          .first();
        assert.ok(row, table);
        const conflict = await post({ ...body(), requestId: row.request_id });
        assert.equal(conflict.status, 409);
        assert.equal((await conflict.json()).error.code, 'REQUEST_ID_CONFLICT');
        const columns = Object.keys(row),
          values = columns.map((c) =>
            c === 'request_id' ? winner.input.requestId : row[c],
          );
        await assert.rejects(
          db
            .prepare(
              `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
            )
            .bind(...values)
            .run(),
          /REQUEST_ID_CONFLICT/,
        );
      }
      await assert.rejects(
        db
          .prepare('DELETE FROM invite_creation_commands WHERE request_id=?')
          .bind(winner.input.requestId)
          .run(),
        /IMMUTABLE_INVITE_COMMAND/,
      );
    },
  );
  await check(
    'Actual Chromium lost creation response retries original intent without reissuing or redisplaying secrets',
    async () => {
      const input = body('generated_password');
      const cookie = headers.Cookie.split(';')
        .map((p) => p.trim())
        .find((p) => p.startsWith('kino-owner.session_token='))
        ?.split('=')
        .slice(1)
        .join('=');
      assert.ok(cookie);
      const id = await lostInviteResponse({
        worker: await mf.getWorker('app'),
        base: 'http://127.0.0.1:8787',
        ownerCookie: cookie,
        projectId,
        input,
      });
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM invite_creation_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, input.requestId)
            .first()
        ).n,
        1,
      );
      const revoked = await request(`/api/v1/invites/${id}/revoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ requestId: randomUUID(), confirmRevoke: true }),
      });
      assert.equal(revoked.status, 200);
      assert.equal(
        (await (await recover(input.requestId)).json()).secretAvailable,
        false,
      );
    },
  );
}
