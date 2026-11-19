import assert from 'node:assert/strict';
import { createHash, randomUUID, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { applyMigration } from './apply-migration.mjs';
import { lostInviteResponse } from './invite-issuance-browser.mjs';
import { kdfPermitChecks } from './kdf-permits.mjs';

export async function inviteIssuanceChecks({
  db,
  mf,
  request,
  headers,
  projectId,
  workspaceId,
  otherProjectId,
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
        const recoverPath = `/api/v1/invites/${result.invite.inviteId}/share-token`;
        const recovered = await request(recoverPath, { headers });
        assert.equal(recovered.status, 200);
        assert.equal(
          recovered.headers.get('Cache-Control'),
          'private, no-store',
        );
        assert.deepEqual(await recovered.json(), { token: result.token });
        assert.equal((await request(recoverPath)).status, 401);
        const row = await db
          .prepare('SELECT * FROM guest_invites WHERE id=?')
          .bind(result.invite.inviteId)
          .first();
        const commandRow = await db
          .prepare(
            'SELECT payload_json FROM invite_creation_commands WHERE request_id=?',
          )
          .bind(input.requestId)
          .first();
        assert.equal(
          Object.hasOwn(JSON.parse(commandRow.payload_json), 'clientLabel'),
          false,
          'legacy canonical payload omits the optional label key',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM guest_invite_labels WHERE invite_id=?',
              )
              .bind(result.invite.inviteId)
              .first()
          ).n,
          0,
        );
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
            assert.match(password, /^[0-9]{5}$/);
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
    'Invite labels trim/validate, atomically persist, replay by value, and stay inside invite scope',
    async () => {
      const input = { ...body(), clientLabel: '  客戶 🌿 ' },
        response = await post(input);
      assert.equal(response.status, 200, await response.clone().text());
      const created = await response.json(),
        inviteId = created.invite.inviteId,
        command = await db
          .prepare(
            'SELECT actor_id,created_at_ms,payload_json FROM invite_creation_commands WHERE request_id=?',
          )
          .bind(input.requestId)
          .first(),
        label = await db
          .prepare('SELECT * FROM guest_invite_labels WHERE invite_id=?')
          .bind(inviteId)
          .first();
      assert.equal(JSON.parse(command.payload_json).clientLabel, '客戶 🌿');
      assert.deepEqual(label, {
        invite_id: inviteId,
        client_label: '客戶 🌿',
        created_by: command.actor_id,
        created_at_ms: command.created_at_ms,
      });
      const replay = await post(input);
      assert.equal(replay.status, 200);
      assert.deepEqual(await replay.json(), {
        invite: created.invite,
        secretAvailable: false,
      });
      assert.equal(
        (await post({ ...input, clientLabel: 'Different label' })).status,
        409,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_invite_labels WHERE invite_id=?',
            )
            .bind(inviteId)
            .first()
        ).n,
        1,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_invite_labels SET client_label=? WHERE invite_id=?',
          )
          .bind('Changed label', inviteId)
          .run(),
        /IMMUTABLE_INVITE_LABEL/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_invite_labels WHERE invite_id=?')
          .bind(inviteId)
          .run(),
        /IMMUTABLE_INVITE_LABEL/,
      );

      const legacyCommand = await db
        .prepare(
          'SELECT c.actor_id,c.created_at_ms FROM invite_creation_commands c WHERE c.request_id=?',
        )
        .bind(winner.input.requestId)
        .first();
      await assert.rejects(
        db
          .prepare(
            `INSERT INTO guest_invite_labels(invite_id,client_label,created_by,created_at_ms)
             SELECT c.invite_id,'Moved label',?,c.created_at_ms FROM invite_creation_commands c
             WHERE c.request_id=?`,
          )
          .bind(owner, winner.input.requestId)
          .run(),
        /INVITE_LABEL_NOT_AUTHORIZED/,
        'a legacy creation payload cannot be assigned a label later',
      );
      assert.equal(legacyCommand.actor_id, owner);

      const legacy = { ...body() },
        legacyResponse = await post(legacy);
      assert.equal(legacyResponse.status, 200);
      const legacyInviteId = (await legacyResponse.json()).invite.inviteId;
      for (const path of [
        `/api/v1/projects/${projectId}/invites`,
        `/api/v1/workspaces/${workspaceId}/invites?scope=all`,
      ]) {
        const page = await (await request(path, { headers })).json(),
          labeled = page.invites.find((item) => item.id === inviteId),
          old = page.invites.find((item) => item.id === legacyInviteId);
        assert.equal(labeled.clientLabel, '客戶 🌿');
        assert.equal(Object.hasOwn(old, 'clientLabel'), false);
      }
      const otherProjectPage = await (
        await request(`/api/v1/projects/${otherProjectId}/invites`, { headers })
      ).json();
      assert.equal(
        otherProjectPage.invites.some((item) => item.id === inviteId),
        false,
      );
      for (const clientLabel of [
        '😀'.repeat(81),
        '  ',
        'control\u0007character',
        'direction\u202eoverride',
      ])
        assert.equal((await post({ ...body(), clientLabel })).status, 400);
    },
  );
  await check(
    'Label insert failure rolls back the invite command and invite; the exact intent can retry',
    async () => {
      const input = { ...body(), clientLabel: 'Atomic retry label' },
        before = await db
          .prepare('SELECT count(*) AS n FROM guest_invites')
          .first();
      await db.exec(
        "CREATE TRIGGER fail_invite_label BEFORE INSERT ON guest_invite_labels WHEN NEW.client_label='Atomic retry label' BEGIN SELECT RAISE(ABORT,'TEST_INVITE_LABEL_FAILURE'); END",
      );
      const failed = await post(input);
      assert.notEqual(failed.status, 200);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM invite_creation_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, input.requestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM guest_invites').first()).n,
        before.n,
      );
      await db.exec('DROP TRIGGER fail_invite_label');
      const retried = await post(input);
      assert.equal(retried.status, 200, await retried.clone().text());
      const created = await retried.json();
      assert.equal(
        (
          await db
            .prepare(
              'SELECT client_label FROM guest_invite_labels WHERE invite_id=?',
            )
            .bind(created.invite.inviteId)
            .first()
        ).client_label,
        input.clientLabel,
      );
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
  await check(
    'Invite list and unlabeled issuance remain compatible with schema 0069 before label adoption',
    async () => {
      await db.exec(
        'DROP TRIGGER guest_invite_labels_insert_guard; DROP TRIGGER guest_invite_labels_no_update; DROP TRIGGER guest_invite_labels_no_delete; DROP TABLE guest_invite_labels',
      );
      try {
        const before = await commandCount();
        assert.equal(
          (await post({ ...body(), clientLabel: 'Not adopted yet' })).status,
          503,
        );
        assert.equal((await commandCount()).n, before.n);

        const input = body(),
          created = await post(input);
        assert.equal(created.status, 200, await created.clone().text());
        const result = await created.json(),
          projectPage = await (
            await request(`/api/v1/projects/${projectId}/invites`, { headers })
          ).json(),
          workspacePage = await (
            await request(
              `/api/v1/workspaces/${workspaceId}/invites?scope=all`,
              { headers },
            )
          ).json();
        for (const page of [projectPage, workspacePage]) {
          const invite = page.invites.find(
            (item) => item.id === result.invite.inviteId,
          );
          assert.ok(invite);
          assert.equal(Object.hasOwn(invite, 'clientLabel'), false);
        }
      } finally {
        await applyMigration(
          db,
          await readFile(
            new URL('../migrations/0070_invite_labels.sql', import.meta.url),
            'utf8',
          ),
        );
      }
    },
  );
}
