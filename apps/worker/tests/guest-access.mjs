import assert from 'node:assert/strict';
import { activateDraftAlbumFixture } from './activate-album-fixture.mjs';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
} from 'node:crypto';
import { runInviteBrowserChecks } from './invite-browser.mjs';
import { guestLogoutBrowser } from './guest-logout-browser.mjs';
import { inviteIssuanceChecks } from './invite-issuance.mjs';
import { runGuestSelectionBrowserChecks } from './guest-selection-browser.mjs';

// Real D1 and real deployed test bundle; only privileged test fixtures issue rows.
export async function guestAccessChecks({
  db,
  mf,
  request,
  owner,
  check,
  cookies,
  base,
  galleryFixture,
}) {
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession);
  const workspace = randomUUID();
  const project = randomUUID();
  const album = randomUUID();
  const otherProject = randomUUID();
  const otherAlbum = randomUUID();
  const unsharedAlbum = randomUUID();
  await db.batch([
    db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(workspace, 'Guest fixture', owner),
    db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(project, workspace, 'Invited project'),
    db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(otherProject, workspace, 'Other project'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(album, workspace, project, 'Invited album'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(unsharedAlbum, workspace, project, 'Unshared album'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(otherAlbum, workspace, otherProject, 'Other album'),
  ]);
  const invite = async ({
    mask = 1,
    maxUses = null,
    expires = Date.now() + 3600000,
    seal = true,
    token = randomBytes(32).toString('hex'),
    grantScope = { workspace, project, album },
  } = {}) => {
    const id = randomUUID();
    await db
      .prepare(
        `INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,?,?,?)`,
      )
      .bind(
        id,
        grantScope.workspace,
        grantScope.project,
        createHash('sha256')
          .update(`kino-pic:guest-invite-token:v1:${token}`)
          .digest('hex'),
        mask,
        expires,
        maxUses,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(id, grantScope.workspace, grantScope.project, grantScope.album)
      .run();
    if (seal)
      await db
        .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
        .bind(id)
        .run();
    return id;
  };
  const identity = async (inviteId) => {
    const id = randomUUID();
    await db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(id, inviteId, 'Same display name')
      .run();
    return id;
  };
  const sessionStatement = ({ id, inviteId, guestId, secret, expires }) =>
    db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(
        id,
        inviteId,
        guestId,
        createHash('sha256')
          .update(`kino-pic:guest-session:v1:${secret}`)
          .digest('hex'),
        expires,
      );
  const session = async (inviteId, expires = Date.now() + 600000) => {
    const data = {
      id: randomUUID(),
      inviteId,
      guestId: await identity(inviteId),
      secret: randomBytes(32).toString('hex'),
      expires,
    };
    await sessionStatement(data).run();
    return data;
  };
  const access = (
    data,
    albumId = album,
    cookie = `kino_guest=${data.secret}`,
  ) =>
    request(`/api/guest/albums/${albumId}/access`, {
      headers: { Cookie: cookie },
    });
  const harness = await mf.getWorker('storage-test');
  const resolve = (data, permission, albumId = album) =>
    harness.fetch(
      `http://local.test/test-guest-access?${new URLSearchParams({ albumId, permission })}`,
      { headers: { 'X-Test-Guest-Secret': data.secret } },
    );
  const admissionWorker = harness;
  const consumeAdmission = (address, token) =>
    admissionWorker.fetch('http://local.test/test-guest-admission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, token }),
    });
  const invited = await invite();
  const guest = await session(invited);
  const ownerHeaders = {
    Cookie: cookies.headers(),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const list = (cursor) =>
    request(
      `/api/v1/projects/${project}/invites${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      { headers: ownerHeaders },
    );
  const revoke = (id, requestId = randomUUID(), extra = {}) =>
    request(`/api/v1/invites/${id}/revoke`, {
      method: 'POST',
      headers: { ...ownerHeaders, ...extra },
      body: JSON.stringify({ requestId, confirmRevoke: true }),
    });
  await check(
    'Guest scopes must be sealed and audited before first session, seal audit failure rolls back',
    async () => {
      const unsealed = await invite({ seal: false });
      await assert.rejects(session(unsealed), /GUEST_ACCESS_REQUIRED/);
      await db.exec(
        "CREATE TRIGGER fail_guest_seal_audit BEFORE INSERT ON audit_events WHEN NEW.action='share.scope_sealed' BEGIN SELECT RAISE(ABORT,'TEST_GUEST_SEAL_AUDIT_FAILURE'); END",
      );
      await assert.rejects(
        db
          .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
          .bind(unsealed)
          .run(),
        /TEST_GUEST_SEAL_AUDIT_FAILURE/,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_invite_seals WHERE invite_id=?',
            )
            .bind(unsealed)
            .first()
        ).n,
        0,
      );
      await db.exec('DROP TRIGGER fail_guest_seal_audit');
      await db
        .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
        .bind(unsealed)
        .run();
      await assert.rejects(
        db
          .prepare('INSERT INTO guest_invite_albums VALUES(?,?,?,?)')
          .bind(unsealed, workspace, project, unsharedAlbum)
          .run(),
        /IMMUTABLE_GUEST_SCOPE/,
      );
      const event = await db
        .prepare('SELECT after_json FROM audit_events WHERE event_id=?')
        .bind(`guest-invite-seal:${unsealed}`)
        .first();
      assert.deepEqual(JSON.parse(event.after_json), {
        inviteId: unsealed,
        albumIds: [album],
      });
      await session(unsealed);
    },
  );
  await check(
    'Guest read-only access is separate from Owner auth, hash-only and non-enumerating',
    async () => {
      const before = await db
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      const response = await access(guest);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
      assert.equal(response.headers.get('Set-Cookie'), null);
      const body = await response.json();
      assert.equal(body.access.guestId, guest.guestId);
      assert.equal(body.access.inviteId, invited);
      assert.equal(body.access.workspaceId, workspace);
      assert.equal(body.access.projectId, project);
      assert.equal(body.access.albumId, album);
      assert.equal(body.access.permissions.can_view, true);
      assert.equal(body.access.permissions.can_download_original, false);
      assert.ok(!JSON.stringify(body).includes(guest.secret));
      assert.ok(!JSON.stringify(body).includes('secret_hash'));
      assert.equal(
        (
          await db
            .prepare('SELECT secret_hash FROM guest_sessions WHERE id=?')
            .bind(guest.id)
            .first()
        ).secret_hash,
        createHash('sha256')
          .update(`kino-pic:guest-session:v1:${guest.secret}`)
          .digest('hex'),
      );
      for (const denied of [
        await request(`/api/guest/albums/${album}/access`),
        await access(guest, unsharedAlbum),
        await access(guest, otherAlbum),
        await access(guest, randomUUID()),
        await access(guest, album, `kino_guest=${'0'.repeat(64)}`),
        await access(
          guest,
          album,
          `kino_guest=${guest.secret}; kino_guest=${guest.secret}`,
        ),
      ]) {
        assert.equal(denied.status, 401);
        assert.deepEqual(await denied.json(), {
          error: { code: 'GUEST_ACCESS_REQUIRED' },
        });
      }
      assert.equal(
        (
          await request(`/api/v1/albums/${album}/photos`, {
            headers: { Cookie: `kino_guest=${guest.secret}` },
          })
        ).status,
        401,
      );
      const after = await db
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      assert.deepEqual(after.results, before.results);
      assert.deepEqual(
        (await db.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
    },
  );
  await check(
    'Each of twelve Guest permissions independently authorizes only its own resolver operation',
    async () => {
      const rights = [
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
      ];
      for (let index = 0; index < rights.length; index++) {
        const current = await session(await invite({ mask: 2 ** index }));
        for (let candidate = 0; candidate < rights.length; candidate++)
          assert.equal(
            (await resolve(current, rights[candidate])).status,
            candidate === index ? 200 : 401,
          );
        assert.equal((await access(current)).status, index === 0 ? 200 : 401);
      }
    },
  );
  await check(
    'Guest scope and identities are immutable composite-FK scoped, no nickname merging',
    async () => {
      const otherInvite = await invite();
      const another = await session(otherInvite);
      assert.notEqual(another.guestId, guest.guestId);
      await assert.rejects(
        db
          .prepare('INSERT INTO guest_invite_albums VALUES(?,?,?,?)')
          .bind(otherInvite, workspace, project, otherAlbum)
          .run(),
        /FOREIGN KEY|IMMUTABLE_GUEST_SCOPE/,
      );
      await assert.rejects(
        sessionStatement({
          ...another,
          id: randomUUID(),
          secret: randomBytes(32).toString('hex'),
          guestId: guest.guestId,
        }).run(),
        /FOREIGN KEY/,
      );
      await assert.rejects(
        db
          .prepare('UPDATE guest_invites SET permissions_mask=4095 WHERE id=?')
          .bind(invited)
          .run(),
        /IMMUTABLE_GUEST_GRANT/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_sessions WHERE id=?')
          .bind(guest.id)
          .run(),
        /IMMUTABLE_GUEST_GRANT/,
      );
      await assert.rejects(
        db
          .prepare('INSERT INTO guest_invite_albums VALUES(?,?,?,?)')
          .bind(invited, workspace, project, unsharedAlbum)
          .run(),
        /IMMUTABLE_GUEST_SCOPE/,
      );
    },
  );
  await check(
    'Current Owner disable, parent archive and album state are checked on every Guest read',
    async () => {
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      assert.equal((await access(guest)).status, 401);
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner)
        .run();
      await db
        .prepare("UPDATE albums SET state='deleting' WHERE id=?")
        .bind(album)
        .run();
      assert.equal((await access(guest)).status, 401);
      await db
        .prepare("UPDATE albums SET state='active' WHERE id=?")
        .bind(album)
        .run();
      await db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status='draft' WHERE id=?",
        )
        .bind(project)
        .run();
      assert.equal((await access(guest)).status, 401);
      await db
        .prepare(
          "UPDATE projects SET status='draft',archived_from_status=NULL WHERE id=?",
        )
        .bind(project)
        .run();
      assert.equal((await access(guest)).status, 200);
    },
  );
  await check(
    'Invite/session revocations immediately deny existing Guest sessions and preserve append-only audit',
    async () => {
      const revokedInvite = await invite();
      const first = await session(revokedInvite);
      const second = await session(revokedInvite);
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(
          first.id,
          createHash('sha256')
            .update(`kino-pic:guest-session:v1:${first.secret}`)
            .digest('hex'),
        )
        .run();
      assert.equal((await access(first)).status, 401);
      assert.equal((await access(second)).status, 200);
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
          )
          .bind(
            second.id,
            createHash('sha256')
              .update(`kino-pic:guest-session:v1:${first.secret}`)
              .digest('hex'),
          )
          .run(),
        /GUEST_ACCESS_REQUIRED/,
      );
      await db
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(revokedInvite, owner, ownerSession.id)
        .run();
      assert.equal((await access(second)).status, 401);
      await assert.rejects(session(revokedInvite), /GUEST_ACCESS_REQUIRED/);
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_invite_revocations WHERE invite_id=?')
          .bind(revokedInvite)
          .run(),
        /IMMUTABLE_GUEST_GRANT/,
      );
      const events = await db
        .prepare(
          "SELECT action,after_json FROM audit_events WHERE project_id=? AND action LIKE '%revoked'",
        )
        .bind(project)
        .all();
      assert.equal(events.results.length, 2);
      assert.ok(
        events.results.every(
          (row) => JSON.parse(row.after_json).revoked === true,
        ),
      );
      const audit = JSON.stringify(
        (
          await db
            .prepare('SELECT * FROM audit_events WHERE project_id=?')
            .bind(project)
            .all()
        ).results,
      );
      for (const secret of [first.secret, second.secret])
        assert.ok(!audit.includes(secret));
    },
  );
  await check(
    'D1 Guest max-use race has one winner, audit failure rolls session/use back',
    async () => {
      const limited = await invite({ maxUses: 1 });
      const candidates = await Promise.all([
        identity(limited),
        identity(limited),
      ]);
      const outcomes = await Promise.allSettled(
        candidates.map((guestId) =>
          sessionStatement({
            id: randomUUID(),
            inviteId: limited,
            guestId,
            secret: randomBytes(32).toString('hex'),
            expires: Date.now() + 600000,
          }).run(),
        ),
      );
      assert.equal(
        outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_sessions WHERE invite_id=?',
            )
            .bind(limited)
            .first()
        ).n,
        1,
      );
      const rollback = await invite({ maxUses: 1 });
      await db.exec(
        "CREATE TRIGGER fail_guest_audit BEFORE INSERT ON audit_events WHEN NEW.action='guest.session_created' BEGIN SELECT RAISE(ABORT,'TEST_GUEST_AUDIT_FAILURE'); END",
      );
      await assert.rejects(session(rollback), /TEST_GUEST_AUDIT_FAILURE/);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_sessions WHERE invite_id=?',
            )
            .bind(rollback)
            .first()
        ).n,
        0,
      );
      await db.exec('DROP TRIGGER fail_guest_audit');
      await session(rollback);
      await assert.rejects(session(rollback), /GUEST_ACCESS_REQUIRED/);
    },
  );
  let expiredSessionForLogout;
  await check(
    'Guest session DB-clock expiry and invalid lifetime bounds fail closed',
    async () => {
      const expiringInvite = await invite();
      const expiring = await session(expiringInvite, Date.now() + 1500);
      expiredSessionForLogout = expiring;
      assert.equal((await access(expiring)).status, 200);
      await new Promise((done) =>
        setTimeout(done, Math.max(0, expiring.expires - Date.now()) + 100),
      );
      assert.equal((await access(expiring)).status, 401);
      const guestId = await identity(expiringInvite);
      await assert.rejects(
        sessionStatement({
          id: randomUUID(),
          inviteId: expiringInvite,
          guestId,
          secret: randomBytes(32).toString('hex'),
          expires: Date.now() + 86400001,
        }).run(),
        /GUEST_ACCESS_REQUIRED|CHECK constraint/,
      );
    },
  );
  await check(
    'Owner invite list is private, bounded, scoped and omits all bearer/password/hash values',
    async () => {
      for (let index = 0; index < 27; index++) await invite();
      const auditBefore = await db
        .prepare('SELECT count(*) AS n FROM audit_events')
        .first();
      const first = await list();
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('Cache-Control'), 'private, no-store');
      const page = await first.json();
      assert.equal(page.invites.length, 24);
      assert.ok(page.nextCursor);
      assert.ok(
        page.invites.every(
          (i) => i.projectId === project && i.workspaceId === workspace,
        ),
      );
      const serialized = JSON.stringify(page);
      for (const forbidden of [
        'token_hash',
        'password_verifier',
        'secret_hash',
        guest.secret,
      ])
        assert.ok(!serialized.includes(forbidden));
      const ids = new Set(page.invites.map((i) => i.id));
      let cursor = page.nextCursor;
      while (cursor) {
        const next = await (await list(cursor)).json();
        for (const i of next.invites) {
          assert.ok(!ids.has(i.id));
          ids.add(i.id);
        }
        cursor = next.nextCursor;
      }
      assert.equal(
        ids.size,
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_invites WHERE project_id=?',
            )
            .bind(project)
            .first()
        ).n,
      );
      assert.equal(
        (await request(`/api/v1/projects/${project}/invites`)).status,
        401,
      );
      assert.equal(
        (
          await request(`/api/v1/projects/${randomUUID()}/invites`, {
            headers: ownerHeaders,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request(
            `/api/v1/projects/${project}/invites?cursor=bad&cursor=bad`,
            { headers: ownerHeaders },
          )
        ).status,
        400,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,
        auditBefore.n,
      );
    },
  );
  await check(
    'Owner confirmed revoke is atomic, current-authorized, replayable and immediately gates existing Guest sessions',
    async () => {
      const target = await invite();
      const active = await session(target);
      const requestId = randomUUID();
      const bad = await request(`/api/v1/invites/${target}/revoke`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ requestId, confirmRevoke: false }),
      });
      assert.equal(bad.status, 400);
      assert.equal(
        (
          await request(`/api/v1/invites/${target}/revoke`, {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({
              requestId,
              confirmRevoke: true,
              actorId: owner,
            }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(`/api/v1/invites/${target}/revoke`, {
            method: 'POST',
            headers: ownerHeaders,
            body: JSON.stringify({
              requestId,
              confirmRevoke: true,
              padding: 'x'.repeat(17000),
            }),
          })
        ).status,
        413,
      );
      assert.equal(
        (
          await revoke(target, requestId, {
            Origin: 'https://attacker.invalid',
          })
        ).status,
        403,
      );
      assert.equal((await access(active)).status, 200);
      const replies = await Promise.all(
        Array.from({ length: 4 }, () => revoke(target, requestId)),
      );
      for (const r of replies) assert.equal(r.status, 200);
      const results = await Promise.all(replies.map((r) => r.json()));
      for (const r of results) assert.deepEqual(r, results[0]);
      assert.equal(results[0].revocation.inviteId, target);
      assert.equal((await access(active)).status, 401);
      const audit = await db
        .prepare('SELECT * FROM audit_events WHERE event_id=?')
        .bind(`guest-invite-revoke:${target}`)
        .first();
      assert.equal(audit.request_id, requestId);
      assert.equal(audit.actor_id, owner);
      assert.ok(audit.session_id);
      assert.equal(JSON.parse(audit.after_json).inviteId, target);
      const freshSession = randomUUID();
      await db
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          freshSession,
          `invite-test:${freshSession}`,
          owner,
          Date.now() + 600000,
          Date.now(),
          Date.now(),
        )
        .run();
      await db
        .prepare(
          'INSERT INTO invite_revocation_commands(actor_id,request_id,session_id,invite_id,payload_json) VALUES(?,?,?,?,?)',
        )
        .bind(owner, requestId, freshSession, target, '{"confirmRevoke":true}')
        .run();
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM invite_revocation_commands WHERE invite_id=?',
            )
            .bind(target)
            .first()
        ).n,
        1,
      );
      await db
        .prepare('UPDATE owner_sessions SET expiresAt=0 WHERE id=?')
        .bind(freshSession)
        .run();
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO invite_revocation_commands(actor_id,request_id,session_id,invite_id,payload_json) VALUES(?,?,?,?,?)',
          )
          .bind(
            owner,
            requestId,
            freshSession,
            target,
            '{"confirmRevoke":true}',
          )
          .run(),
        /OWNER_REQUIRED/,
      );
      assert.equal((await revoke(await invite(), requestId)).status, 409);
      assert.equal((await revoke(target)).status, 409);
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      assert.equal((await revoke(target, requestId)).status, 403);
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner)
        .run();
      await db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status='draft' WHERE id=?",
        )
        .bind(project)
        .run();
      assert.equal((await revoke(target, requestId)).status, 200);
      const newTarget = await db
        .prepare(
          'SELECT id FROM guest_invites WHERE project_id=? AND NOT EXISTS(SELECT 1 FROM guest_invite_revocations r WHERE r.invite_id=guest_invites.id) LIMIT 1',
        )
        .bind(project)
        .first();
      assert.equal((await revoke(newTarget.id)).status, 200);
      await db
        .prepare(
          "UPDATE projects SET status='draft',archived_from_status=NULL WHERE id=?",
        )
        .bind(project)
        .run();
      await assert.rejects(
        db
          .prepare(
            'UPDATE invite_revocation_commands SET invite_id=? WHERE actor_id=? AND request_id=?',
          )
          .bind(await invite(), owner, requestId)
          .run(),
        /IMMUTABLE_INVITE_COMMAND/,
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM invite_revocation_commands WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, requestId)
          .run(),
        /IMMUTABLE_INVITE_COMMAND/,
      );
    },
  );
  await check(
    'Invite revoke audit failure rolls back ledger/revocation and original request retry succeeds',
    async () => {
      const target = await invite();
      const active = await session(target);
      const requestId = randomUUID();
      await db.exec(
        "CREATE TRIGGER fail_invite_revoke_audit BEFORE INSERT ON audit_events WHEN NEW.action='share.revoked' BEGIN SELECT RAISE(ABORT,'TEST_INVITE_REVOKE_FAILURE'); END",
      );
      assert.equal((await revoke(target, requestId)).status, 503);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM invite_revocation_commands WHERE request_id=?',
            )
            .bind(requestId)
            .first()
        ).n,
        0,
      );
      assert.equal((await access(active)).status, 200);
      await db.exec('DROP TRIGGER fail_invite_revoke_audit');
      assert.equal((await revoke(target, requestId)).status, 200);
      assert.equal((await access(active)).status, 401);
    },
  );
  await check(
    'Invite revocation shares symmetric request namespace with all four prior ledgers, auth precedes replay',
    async () => {
      const tables = [
        'request_commands',
        'upload_requests',
        'upload_workflow_requests',
        'processing_review_commands',
      ];
      const target = await invite();
      const requestId = randomUUID();
      assert.equal((await revoke(target, requestId)).status, 200);
      for (const table of tables) {
        const row = await db
          .prepare(`SELECT * FROM ${table} WHERE actor_id=? LIMIT 1`)
          .bind(owner)
          .first();
        assert.ok(row, table);
        const conflict = await revoke(await invite(), row.request_id);
        assert.equal(conflict.status, 409);
        assert.equal((await conflict.json()).error.code, 'REQUEST_ID_CONFLICT');
        const columns = Object.keys(row);
        const values = columns.map((c) =>
          c === 'request_id' ? requestId : row[c],
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
        const invalid = columns.map((c) =>
          c === 'session_id'
            ? 'invalid-session'
            : c === 'request_id'
              ? requestId
              : row[c],
        );
        await assert.rejects(
          db
            .prepare(
              `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
            )
            .bind(...invalid)
            .run(),
          /OWNER_REQUIRED/,
        );
      }
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO invite_revocation_commands(actor_id,request_id,session_id,invite_id,payload_json) VALUES(?,?,?,?,?)',
          )
          .bind(
            owner,
            requestId,
            'invalid-session',
            target,
            '{"confirmRevoke":true}',
          )
          .run(),
        /OWNER_REQUIRED/,
      );
    },
  );
  await check(
    '375px Owner invitation UI confirms revoke and safely retries a lost success using the same request ID',
    async () => {
      const target = await invite();
      const active = await session(target);
      await runInviteBrowserChecks({
        worker: await mf.getWorker('app'),
        baseUrl: base,
        sessionCookie: cookies.values.get('kino-owner.session_token'),
        projectId: project,
        inviteId: target,
        db,
      });
      assert.equal((await access(active)).status, 401);
    },
  );
  let verifier;
  const syntheticPassword = ' synthetic-only-📷-passphrase ';
  await check(
    'Real workerd native scrypt matches Node with fixed32MiB parameters and rejects wrong passwords',
    async () => {
      const timings = [];
      for (let sample = 0; sample < 2; sample++) {
        const start = performance.now();
        const response = await harness.fetch(
          'http://local.test/test-guest-kdf',
          {
            method: 'POST',
            body: JSON.stringify({ password: syntheticPassword }),
          },
        );
        assert.equal(response.status, 200);
        const current = (await response.json()).verifier;
        assert.match(
          current,
          /^\$kino-scrypt\$v=1\$N=32768,r=8,p=3\$[a-f0-9]{32}\$[a-f0-9]{64}$/,
        );
        timings.push(Math.round((performance.now() - start) * 100) / 100);
        const [salt, key] = current.split('$').slice(-2);
        assert.equal(
          key,
          scryptSync(syntheticPassword, Buffer.from(salt, 'hex'), 32, {
            N: 32768,
            r: 8,
            p: 3,
            maxmem: 64 * 1024 * 1024,
          }).toString('hex'),
        );
        if (verifier) assert.notEqual(current, verifier);
        verifier = current;
      }
      for (const [password, expected] of [
        [syntheticPassword, true],
        [syntheticPassword.trim(), false],
      ]) {
        const reply = await harness.fetch('http://local.test/test-guest-kdf', {
          method: 'POST',
          body: JSON.stringify({ password, verifier }),
        });
        assert.equal(reply.status, 200);
        assert.equal((await reply.json()).valid, expected);
      }
      process.stdout.write(
        `local native scrypt host-observed wall samples ms: ${timings.join(', ')}; not CPU/free-tier acceptance\n`,
      );
    },
  );
  await check(
    'D1 strict verifier guard rejects new malformed/weak verifiers, accepts both password modes and keeps plaintext out of audit',
    async () => {
      const insert = (mode, value) =>
        db
          .prepare(
            'INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,created_by,owner_session_id) VALUES(?,?,?,?,?,?,1,?,?,?)',
          )
          .bind(
            randomUUID(),
            workspace,
            project,
            randomBytes(32).toString('hex'),
            mode,
            value,
            Date.now() + 600000,
            owner,
            ownerSession.id,
          );
      for (const bad of [
        'plain-text-password-that-is-long-enough',
        verifier.replace('32768', '1024'),
        verifier + 'extra',
        verifier + '\0junk',
        verifier + '\n',
        verifier.replace(/\$[a-f0-9]{64}$/, '$' + 'G'.repeat(64)),
      ])
        await assert.rejects(
          insert('custom_password', bad).run(),
          /INVALID_GUEST_PASSWORD_VERIFIER/,
        );
      await insert('custom_password', verifier).run();
      await insert('generated_password', verifier).run();
      const audit = JSON.stringify(
        (
          await db
            .prepare('SELECT * FROM audit_events WHERE project_id=?')
            .bind(project)
            .all()
        ).results,
      );
      assert.ok(!audit.includes(syntheticPassword));
      assert.ok(!audit.includes(verifier));
    },
  );
  const logout = (current, requestId = randomUUID(), extra = {}) =>
    request('/api/guest/logout', {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        ...(current ? { Cookie: `kino_guest=${current.secret}` } : {}),
        ...extra,
      },
      body: JSON.stringify({ requestId }),
    });
  await check(
    'Guest self-logout is scoped, confirmed by cookie proof, idempotent and audit-correlated without Owner credentials',
    async () => {
      const source = await invite(),
        first = await session(source),
        second = await session(source),
        requestId = randomUUID();
      assert.equal(
        (await logout(first, requestId, { Origin: 'https://attacker.invalid' }))
          .status,
        403,
      );
      assert.equal(
        (
          await request('/api/guest/logout', {
            method: 'POST',
            headers: {
              Origin: base,
              'Content-Type': 'application/json',
              Cookie: `kino_guest=${first.secret}`,
            },
            body: JSON.stringify({ requestId, sessionId: second.id }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('/api/guest/logout', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId, padding: 'x'.repeat(17000) }),
          })
        ).status,
        413,
      );
      const replies = await Promise.all(
        Array.from({ length: 3 }, () => logout(first, requestId)),
      );
      for (const reply of replies) {
        assert.equal(reply.status, 200);
        assert.match(
          reply.headers.get('Set-Cookie'),
          /^kino_guest=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax$/,
        );
        assert.equal(reply.headers.get('Cache-Control'), 'private, no-store');
      }
      assert.equal((await access(first)).status, 401);
      assert.equal((await access(second)).status, 200);
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      assert.equal((await logout(second)).status, 200);
      await db
        .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
        .bind(owner)
        .run();
      assert.equal((await access(second)).status, 401);
      assert.ok(expiredSessionForLogout);
      assert.equal((await logout(expiredSessionForLogout)).status, 200);
      const event = await db
        .prepare('SELECT * FROM audit_events WHERE event_id=?')
        .bind(`guest-session-revoke:${first.id}`)
        .first();
      assert.equal(event.request_id, requestId);
      assert.equal(event.actor_id, first.guestId);
      assert.equal(event.guest_session_id, first.id);
      assert.ok(!JSON.stringify(event).includes(first.secret));
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_logout_commands WHERE session_id=?',
            )
            .bind(first.id)
            .first()
        ).n,
        1,
      );
      const sameGuest = {
        id: randomUUID(),
        inviteId: source,
        guestId: first.guestId,
        secret: randomBytes(32).toString('hex'),
        expires: Date.now() + 600000,
      };
      await sessionStatement(sameGuest).run();
      const conflict = await logout(sameGuest, requestId);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.headers.get('Set-Cookie'), null);
      assert.equal((await access(sameGuest)).status, 200);
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO guest_logout_commands(guest_id,request_id,session_id,secret_hash) VALUES(?,?,?,?)',
          )
          .bind(
            second.guestId,
            randomUUID(),
            second.id,
            createHash('sha256')
              .update(`kino-pic:guest-session:v1:${first.secret}`)
              .digest('hex'),
          )
          .run(),
        /GUEST_ACCESS_REQUIRED/,
      );
      assert.equal((await logout(null, requestId)).status, 200);
      assert.equal(
        (await logout({ secret: '0'.repeat(64) }, requestId)).status,
        200,
      );
    },
  );
  await check(
    'Guest logout audit failure preserves session and cookie for exact retry; no other session is revoked',
    async () => {
      const target = await session(await invite()),
        requestId = randomUUID();
      await db.exec(
        "CREATE TRIGGER fail_guest_logout_audit BEFORE INSERT ON audit_events WHEN NEW.action='guest.session_revoked' BEGIN SELECT RAISE(ABORT,'TEST_GUEST_LOGOUT_AUDIT_FAILURE'); END",
      );
      const failed = await logout(target, requestId);
      assert.equal(failed.status, 503);
      assert.equal(failed.headers.get('Set-Cookie'), null);
      assert.equal((await access(target)).status, 200);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_logout_commands WHERE session_id=?',
            )
            .bind(target.id)
            .first()
        ).n,
        0,
      );
      await db.exec('DROP TRIGGER fail_guest_logout_audit');
      assert.equal((await logout(target, requestId)).status, 200);
      assert.equal((await access(target)).status, 401);
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_logout_commands WHERE session_id=?')
          .bind(target.id)
          .run(),
        /IMMUTABLE_GUEST_COMMAND/,
      );
    },
  );
  await check(
    'Real Chromium lost logout response retains proof for retry, clears only Guest HttpOnly cookie after commit',
    async () => {
      const target = await session(await invite()),
        requestId = randomUUID();
      await guestLogoutBrowser({
        worker: await mf.getWorker('app'),
        base,
        ownerCookie: cookies.values.get('kino-owner.session_token'),
        guestSecret: target.secret,
        requestId,
        albumId: album,
      });
      const event = await db
        .prepare('SELECT request_id FROM audit_events WHERE event_id=?')
        .bind(`guest-session-revoke:${target.id}`)
        .first();
      assert.equal(event.request_id, requestId);
      assert.equal((await access(target)).status, 401);
    },
  );
  await check(
    'Configured HTTPS Guest logout uses only __Host cookie and clears Secure/HttpOnly/host-only scope',
    async () => {
      const target = await session(await invite()),
        secure = await mf.getWorker('guest-secure-test');
      const send = (cookie) =>
        secure.fetch('https://127.0.0.1:8787/api/guest/logout', {
          method: 'POST',
          headers: {
            Origin: 'https://127.0.0.1:8787',
            'Content-Type': 'application/json',
            Cookie: cookie,
          },
          body: JSON.stringify({ requestId: randomUUID() }),
        });
      assert.equal((await send(`kino_guest=${target.secret}`)).status, 200);
      assert.equal((await access(target)).status, 200);
      const result = await send(`__Host-kino_guest=${target.secret}`);
      assert.equal(result.status, 200);
      assert.equal(
        result.headers.get('Set-Cookie'),
        '__Host-kino_guest=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
      );
      assert.equal((await access(target)).status, 401);
    },
  );
  await inviteIssuanceChecks({
    db,
    mf,
    request,
    headers: ownerHeaders,
    projectId: project,
    albumId: album,
    otherAlbumId: otherAlbum,
    owner,
    check,
  });
  await check(
    'Guest admission canonicalizes trusted addresses, counts denied attempts and stores only HMAC pseudonyms',
    async () => {
      assert.equal(
        (await consumeAdmission('127.000.0.1', 'x'.repeat(64))).status,
        503,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_exchange_buckets')
            .first()
        ).n,
        0,
      );
      await db
        .prepare(
          'UPDATE guest_exchange_bucket_capacity SET bucket_count=100000 WHERE singleton=1',
        )
        .run();
      const atCapacity = await consumeAdmission(
        '192.0.2.250',
        randomBytes(32).toString('hex'),
      );
      assert.equal(atCapacity.status, 503);
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_exchange_buckets')
            .first()
        ).n,
        0,
      );
      await db
        .prepare(
          'UPDATE guest_exchange_bucket_capacity SET bucket_count=0 WHERE singleton=1',
        )
        .run();
      const ip = '198.51.100.29';
      for (let attempt = 1; attempt <= 21; attempt++) {
        const result = await (
          await consumeAdmission(ip, randomBytes(32).toString('hex'))
        ).json();
        assert.equal(result.error, undefined, JSON.stringify(result));
        assert.equal(result.allowed, attempt <= 20);
        assert.equal(result.inviteKnown, false);
      }
      const network = await db
        .prepare(
          "SELECT attempts,bucket_hash FROM guest_exchange_buckets WHERE dimension='network'",
        )
        .first();
      assert.equal(network.attempts, 21);
      assert.equal(network.bucket_hash.includes(ip), false);
      assert.equal(network.bucket_hash.length, 64);
      const concurrentDecisions = await Promise.all(
        Array.from({ length: 24 }, async () => {
          const response = await consumeAdmission(
            '198.51.100.32',
            randomBytes(32).toString('hex'),
          );
          return (await response.json()).allowed;
        }),
      );
      assert.equal(concurrentDecisions.filter(Boolean).length, 20);
    },
  );
  await check(
    'Guest pair/global windows enforce independent limits and charge unknown tokens only to network',
    async () => {
      const token = randomBytes(32).toString('hex');
      await invite({ token });
      const ip = '198.51.100.30';
      for (let attempt = 1; attempt <= 6; attempt++) {
        const result = await (await consumeAdmission(ip, token)).json();
        assert.equal(result.inviteKnown, true);
        assert.equal(result.allowed, attempt <= 5);
      }
      const buckets = await db
        .prepare(
          "SELECT dimension,count(*) AS n,max(attempts) AS attempts FROM guest_exchange_buckets WHERE dimension<>'network' GROUP BY dimension ORDER BY dimension",
        )
        .all();
      assert.deepEqual(
        buckets.results.map((row) => [row.dimension, row.n, row.attempts]),
        [
          ['invite', 1, 6],
          ['invite_network', 1, 6],
        ],
      );

      const globalToken = randomBytes(32).toString('hex');
      await invite({ token: globalToken });
      const inviteHash = createHash('sha256')
        .update(`kino-pic:guest-invite-token:v1:${globalToken}`)
        .digest('hex');
      const inviteId = await db
        .prepare('SELECT id FROM guest_invites WHERE token_hash=?')
        .bind(inviteHash)
        .first();
      const secret = 'synthetic-test-only-secret-at-least-forty-characters';
      const globalBucket = createHmac('sha256', secret)
        .update(`kino-pic:guest-admission:v1:invite:${inviteId.id}`)
        .digest('hex');
      await db
        .prepare(
          "INSERT INTO guest_exchange_buckets(dimension,bucket_hash,window_started_at_ms,attempts,attempt_limit,updated_at_ms) VALUES('invite',?,CAST(unixepoch('subsec')*1000/300000 AS INTEGER)*300000,49,50,unixepoch('subsec')*1000)",
        )
        .bind(globalBucket)
        .run();
      const concurrentGlobal = await Promise.all([
        consumeAdmission('203.0.113.1', globalToken),
        consumeAdmission('203.0.113.2', globalToken),
      ]);
      const concurrentGlobalDecisions = await Promise.all(
        concurrentGlobal.map(
          async (response) => (await response.json()).allowed,
        ),
      );
      assert.equal(concurrentGlobalDecisions.filter(Boolean).length, 1);
      const global = await db
        .prepare(
          "SELECT attempts FROM guest_exchange_buckets WHERE dimension='invite' AND bucket_hash=?",
        )
        .bind(globalBucket)
        .first();
      assert.equal(global.attempts, 51);

      const rollbackToken = randomBytes(32).toString('hex');
      await invite({ token: rollbackToken });
      const before = await db
        .prepare('SELECT count(*) AS n FROM guest_exchange_buckets')
        .first();
      await db.exec(
        "CREATE TRIGGER fail_guest_admission_dimension BEFORE INSERT ON guest_exchange_buckets WHEN NEW.dimension='invite' BEGIN SELECT RAISE(ABORT,'TEST_BUCKET_WRITE_FAILURE'); END",
      );
      try {
        assert.equal(
          (await consumeAdmission('203.0.113.44', rollbackToken)).status,
          503,
        );
        assert.equal(
          (
            await db
              .prepare('SELECT count(*) AS n FROM guest_exchange_buckets')
              .first()
          ).n,
          before.n,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_guest_admission_dimension');
      }
    },
  );
  await check(
    'Guest admission uses DB fixed-window reset and bounded expiry cleanup',
    async () => {
      await db
        .prepare(
          'UPDATE guest_exchange_buckets SET window_started_at_ms=0,attempts=attempt_limit+1',
        )
        .run();
      const token = randomBytes(32).toString('hex');
      await invite({ token });
      const result = await (
        await consumeAdmission('198.51.100.31', token)
      ).json();
      assert.equal(result.allowed, true);
      const reset = await db
        .prepare(
          "SELECT attempts,window_started_at_ms FROM guest_exchange_buckets WHERE dimension='network'",
        )
        .first();
      assert.equal(reset.attempts, 1);
      assert.ok(reset.window_started_at_ms > 0);
      const old = await db
        .prepare('UPDATE guest_exchange_buckets SET window_started_at_ms=0')
        .run();
      assert.ok(old.meta.changes > 0);
      const pruned = await admissionWorker.fetch(
        'http://local.test/test-prune-guest-admission',
      );
      assert.ok((await pruned.json()).changes > 0);
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_exchange_buckets')
            .first()
        ).n,
        0,
      );
    },
  );
  await check(
    'Guest gallery pages and private derivative reads repeat current view ACL and never expose originals',
    async () => {
      assert.ok(galleryFixture?.context?.album?.id);
      assert.ok(galleryFixture?.photo?.photoId);
      const grantScope = {
        workspace: galleryFixture.context.workspace.id,
        project: galleryFixture.context.project.id,
        album: galleryFixture.context.album.id,
      };
      await activateDraftAlbumFixture(db, grantScope.album);
      const galleryInvite = await invite({ mask: 1, grantScope });
      const gallerySession = await session(galleryInvite);
      const cookie = 'kino_guest=' + gallerySession.secret;
      const albumPath = '/api/guest/albums/' + grantScope.album + '/photos';
      const auditBefore = await db
        .prepare('SELECT count(*) AS n FROM audit_events')
        .first();
      const seen = new Set();
      let cursor;
      let selected;
      let firstPage;
      do {
        const path = cursor
          ? albumPath + '?cursor=' + encodeURIComponent(cursor)
          : albumPath;
        const response = await request(path, {
          headers: { Cookie: cookie },
        });
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get('Cache-Control'),
          'private, no-store',
        );
        assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
        assert.equal(response.headers.get('Set-Cookie'), null);
        const page = await response.json();
        assert.ok(page.photos.length <= 24);
        if (!firstPage) {
          firstPage = page;
          assert.ok(page.nextCursor);
        }
        for (const photo of page.photos) {
          assert.ok(!seen.has(photo.id));
          seen.add(photo.id);
          if (photo.id === galleryFixture.photo.photoId) selected = photo;
          assert.ok(!JSON.stringify(photo).includes(gallerySession.secret));
          assert.ok(!JSON.stringify(photo).includes('object_key'));
        }
        cursor = page.nextCursor;
      } while (cursor);
      assert.equal(seen.size, 25);
      assert.ok(selected);
      assert.equal(selected.processing, 'succeeded');
      assert.match(selected.previewUrl, /^\/api\/guest\/photos\//);
      assert.match(selected.thumbnailUrl, /^\/api\/guest\/photos\//);
      assert.equal(
        selected.previewUrl,
        '/api/guest/photos/' +
          galleryFixture.photo.photoId +
          '/versions/' +
          galleryFixture.photo.versionId +
          '/assets/preview',
      );
      const storedAsset = await db
        .prepare(
          "SELECT object_key,byte_size,checksum_sha256 FROM photo_assets WHERE version_id=? AND asset_kind='preview'",
        )
        .bind(galleryFixture.photo.versionId)
        .first();
      assert.ok(storedAsset);
      const storedObject = await galleryFixture.storage.get(
        storedAsset.object_key,
      );
      assert.ok(storedObject);
      const image = await request(selected.previewUrl, {
        headers: { Cookie: cookie },
      });
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('Content-Type'), 'image/jpeg');
      assert.equal(image.headers.get('Content-Disposition'), 'inline');
      assert.equal(
        image.headers.get('Cross-Origin-Resource-Policy'),
        'same-origin',
      );
      assert.equal(image.headers.get('Vary'), 'Cookie');
      assert.equal(image.headers.get('Cache-Control'), 'private, no-store');
      assert.equal(image.headers.get('Set-Cookie'), null);
      assert.equal(
        image.headers.get('Content-Length'),
        String(storedAsset.byte_size),
      );
      const delivered = Buffer.from(await image.arrayBuffer());
      const expected = Buffer.from(await storedObject.arrayBuffer());
      assert.deepEqual(delivered, expected);
      assert.equal(
        createHash('sha256').update(delivered).digest('hex'),
        storedAsset.checksum_sha256,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,
        auditBefore.n,
      );
      const noCookie = await request(albumPath);
      assert.equal(noCookie.status, 401);
      assert.equal(
        (
          await request('/api/guest/albums/' + randomUUID() + '/photos', {
            headers: { Cookie: cookie },
          })
        ).status,
        401,
      );
      assert.equal(
        (await request(albumPath, { headers: { Cookie: cookies.headers() } }))
          .status,
        401,
      );
      assert.equal(
        (
          await request(
            '/api/guest/photos/' +
              randomUUID() +
              '/versions/' +
              galleryFixture.photo.versionId +
              '/assets/preview',
            { headers: { Cookie: cookie } },
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            '/api/guest/photos/' +
              galleryFixture.photo.photoId +
              '/versions/' +
              galleryFixture.photo.versionId +
              '/assets/original',
            { headers: { Cookie: cookie } },
          )
        ).status,
        400,
      );
      const emptyInvite = await invite({
        grantScope: { workspace, project, album: unsharedAlbum },
      });
      const emptySession = await session(emptyInvite);
      const emptyResponse = await request(
        '/api/guest/albums/' + unsharedAlbum + '/photos',
        { headers: { Cookie: 'kino_guest=' + emptySession.secret } },
      );
      assert.equal(emptyResponse.status, 200);
      assert.deepEqual(await emptyResponse.json(), {
        photos: [],
        nextCursor: null,
      });
      const noViewInvite = await invite({ mask: 0, grantScope });
      const noView = await session(noViewInvite);
      assert.equal(
        (
          await request(albumPath, {
            headers: { Cookie: 'kino_guest=' + noView.secret },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(selected.previewUrl, {
            headers: { Cookie: 'kino_guest=' + noView.secret },
          })
        ).status,
        401,
      );
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(
          gallerySession.id,
          createHash('sha256')
            .update('kino-pic:guest-session:v1:' + gallerySession.secret)
            .digest('hex'),
        )
        .run();
      assert.equal(
        (await request(albumPath, { headers: { Cookie: cookie } })).status,
        401,
      );
      assert.equal(
        (await request(selected.previewUrl, { headers: { Cookie: cookie } }))
          .status,
        401,
      );
    },
  );
  await check(
    'Guest selection writes are default-off, can_select-only, idempotent and atomic with immutable audit',
    async () => {
      const path =
        '/api/guest/albums/' +
        galleryFixture.context.album.id +
        '/photos/' +
        galleryFixture.photo.photoId +
        '/selection';
      const requestId = randomUUID();
      const input = {
        requestId,
        selected: true,
        versionId: galleryFixture.photo.versionId,
      };
      const beforeDisabled = await db
        .prepare('SELECT count(*) AS n FROM guest_selection_commands')
        .first();
      const beforeDisabledSubmissions = await db
        .prepare('SELECT count(*) AS n FROM guest_selection_submissions')
        .first();
      const disabled = await request(path, {
        method: 'PUT',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      assert.equal(disabled.status, 503);
      assert.equal(
        (
          await request(
            '/api/guest/albums/' +
              galleryFixture.context.album.id +
              '/selection',
          )
        ).status,
        503,
      );
      const disabledSubmit = await request(
        '/api/guest/albums/' +
          galleryFixture.context.album.id +
          '/selection/submit',
        {
          method: 'POST',
          headers: { Origin: base, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: randomUUID() }),
        },
      );
      assert.equal(disabledSubmit.status, 503);
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_selection_commands')
            .first()
        ).n,
        beforeDisabled.n,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_selection_state')
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_selection_submissions')
            .first()
        ).n,
        beforeDisabledSubmissions.n,
      );

      const grantScope = {
        workspace: galleryFixture.context.workspace.id,
        project: galleryFixture.context.project.id,
        album: galleryFixture.context.album.id,
      };
      const selectionInvite = await invite({ mask: 520, grantScope });
      const selectionGuest = await session(selectionInvite);
      const selectionOnlyGuest = await session(
        await invite({ mask: 8, grantScope }),
      );
      const submitOnlyGuest = await session(
        await invite({ mask: 512, grantScope }),
      );
      const readOnlyPage = await request(
        '/api/guest/albums/' + grantScope.album + '/photos',
        { headers: { Cookie: 'kino_guest=' + selectionGuest.secret } },
      );
      assert.equal(readOnlyPage.status, 401);

      const enabled = await mf.getWorker('guest-selection-test');
      const put = (
        guest,
        body,
        album = grantScope.album,
        photo = galleryFixture.photo.photoId,
      ) =>
        enabled.fetch(
          new Request(
            new URL(
              '/api/guest/albums/' + album + '/photos/' + photo + '/selection',
              base,
            ),
            {
              method: 'PUT',
              headers: {
                Origin: base,
                'Content-Type': 'application/json',
                Cookie: 'kino_guest=' + guest.secret,
              },
              body: JSON.stringify(body),
            },
          ),
        );
      const readSelection = (guest, album = grantScope.album, cursor) => {
        const url = new URL('/api/guest/albums/' + album + '/selection', base);
        if (cursor) url.searchParams.set('cursor', cursor);
        return enabled.fetch(
          new Request(url, {
            headers: { Cookie: 'kino_guest=' + guest.secret },
          }),
        );
      };
      const submitSelection = (guest, body, album = grantScope.album) =>
        enabled.fetch(
          new Request(
            new URL('/api/guest/albums/' + album + '/selection/submit', base),
            {
              method: 'POST',
              headers: {
                Origin: base,
                'Content-Type': 'application/json',
                Cookie: 'kino_guest=' + guest.secret,
              },
              body: JSON.stringify(body),
            },
          ),
        );
      const staleCursorGuest = await session(
        await invite({ mask: 8, grantScope }),
      );
      const staleCursorPhotos = [];
      for (let index = 0; index < 25; index++) {
        const photoId = randomUUID();
        const versionId = randomUUID();
        await db
          .prepare(
            'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
          )
          .bind(
            photoId,
            grantScope.workspace,
            grantScope.project,
            grantScope.album,
            `cursor-${index}.jpg`,
          )
          .run();
        await db
          .prepare(
            "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
          )
          .bind(versionId, grantScope.workspace, photoId, owner, 'c'.repeat(64))
          .run();
        const selected = await put(
          staleCursorGuest,
          { requestId: randomUUID(), selected: true, versionId },
          grantScope.album,
          photoId,
        );
        assert.equal(selected.status, 200);
        staleCursorPhotos.push({ photoId, versionId });
      }
      const firstSelectionPage = await readSelection(staleCursorGuest);
      assert.equal(firstSelectionPage.status, 200);
      const firstSelectionPageBody = await firstSelectionPage.json();
      assert.equal(firstSelectionPageBody.items.length, 24);
      assert.ok(firstSelectionPageBody.nextCursor);
      const changedAfterPage = await put(
        staleCursorGuest,
        {
          requestId: randomUUID(),
          selected: false,
          versionId: staleCursorPhotos[0].versionId,
        },
        grantScope.album,
        staleCursorPhotos[0].photoId,
      );
      assert.equal(changedAfterPage.status, 200);
      const staleSelectionPage = await readSelection(
        staleCursorGuest,
        grantScope.album,
        firstSelectionPageBody.nextCursor,
      );
      assert.equal(staleSelectionPage.status, 409);
      assert.equal(
        (await staleSelectionPage.json()).error.code,
        'SELECTION_CHANGED',
      );

      const emptyPicks = await readSelection(selectionGuest);
      assert.equal(emptyPicks.status, 200);
      assert.deepEqual(await emptyPicks.json(), {
        items: [],
        canSubmit: true,
        selectionPolicy: {
          minimum: 1,
          maximum: null,
          revision: 0,
          mode: 'private',
          source: 'system',
          projectRevision: 0,
          albumRevision: 0,
        },
        selectedCount: 0,
        roundNo: 1,
        selectionRevision: 0,
        roundStatus: 'open',
        submittedAt: null,
        nextCursor: null,
      });
      assert.equal(
        (await readSelection(selectionGuest, randomUUID())).status,
        401,
      );
      assert.equal((await readSelection(submitOnlyGuest)).status, 401);
      assert.equal(
        (await submitSelection(submitOnlyGuest, { requestId: randomUUID() }))
          .status,
        422,
      );
      assert.equal(
        (await submitSelection(selectionOnlyGuest, { requestId: randomUUID() }))
          .status,
        401,
      );
      assert.equal(
        (await readSelection(selectionGuest, grantScope.album, 'not-a-cursor'))
          .status,
        400,
      );
      const beforeAudit = await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action='selection.added' AND actor_id=?",
        )
        .bind(selectionGuest.guestId)
        .first();
      const concurrent = await Promise.all([
        put(selectionGuest, input),
        put(selectionGuest, input),
      ]);
      assert.deepEqual(
        concurrent.map((response) => response.status),
        [200, 200],
      );
      const first = await concurrent[0].json();
      assert.deepEqual(await concurrent[1].json(), first);
      assert.equal(first.selected, true);
      assert.equal(first.selectedVersionId, galleryFixture.photo.versionId);
      assert.equal(first.selectedCount, 1);
      assert.equal(first.roundNo, 1);
      assert.equal(first.selectionRevision, 1);
      assert.equal(first.roundStatus, 'open');
      assert.ok(first.eventId);
      const selectedPage = await readSelection(selectionGuest);
      assert.equal(selectedPage.status, 200);
      const selectedPageBody = await selectedPage.json();
      assert.deepEqual(selectedPageBody.items, [
        {
          photoId: galleryFixture.photo.photoId,
          versionId: galleryFixture.photo.versionId,
          selectedAt: first.selectedAt,
        },
      ]);
      assert.equal(selectedPageBody.selectedCount, 1);
      assert.equal(selectedPageBody.selectionRevision, 1);
      assert.equal(concurrent[0].headers.get('Set-Cookie'), null);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_commands WHERE guest_id=?',
            )
            .bind(selectionGuest.guestId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_state WHERE guest_id=?',
            )
            .bind(selectionGuest.guestId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.added' AND actor_id=?",
            )
            .bind(selectionGuest.guestId)
            .first()
        ).n,
        beforeAudit.n + 1,
      );
      assert.deepEqual(await (await put(selectionGuest, input)).json(), first);

      const payloadConflict = await put(selectionGuest, {
        ...input,
        selected: false,
      });
      assert.equal(payloadConflict.status, 409);
      const foreignAlbum = await put(
        selectionGuest,
        {
          requestId: randomUUID(),
          selected: true,
          versionId: galleryFixture.photo.versionId,
        },
        randomUUID(),
      );
      assert.equal(foreignAlbum.status, 401);
      const mismatchedVersion = await put(selectionGuest, {
        requestId: randomUUID(),
        selected: true,
        versionId: randomUUID(),
      });
      assert.equal(mismatchedVersion.status, 401);

      const replacementVersionId = randomUUID();
      await appendAuthorizedVersionFixture({
        db,
        owner,
        photoId: galleryFixture.photo.photoId,
        versionId: replacementVersionId,
        parentVersionId: galleryFixture.photo.versionId,
        versionNo: 2,
        sha256: 'b'.repeat(64),
        byteSize: 128,
        mime: 'image/jpeg',
        width: 10,
        height: 10,
      });
      const versionChanged = await put(selectionGuest, {
        requestId: randomUUID(),
        selected: true,
        versionId: replacementVersionId,
      });
      const versionChangedBody = await versionChanged.json();
      assert.equal(versionChanged.status, 200);
      assert.equal(versionChangedBody.selected, true);
      assert.equal(versionChangedBody.selectedVersionId, replacementVersionId);
      assert.equal(versionChangedBody.selectedCount, 1);
      assert.equal(versionChangedBody.selectionRevision, 2);
      const versionChangeEvent = await db
        .prepare(
          'SELECT action,before_json,after_json FROM audit_events WHERE event_id=?',
        )
        .bind(versionChangedBody.eventId)
        .first();
      assert.equal(versionChangeEvent.action, 'selection.version_changed');
      assert.equal(
        JSON.parse(versionChangeEvent.before_json).versionId,
        galleryFixture.photo.versionId,
      );
      assert.equal(
        JSON.parse(versionChangeEvent.after_json).versionId,
        replacementVersionId,
      );
      const removed = await put(selectionGuest, {
        requestId: randomUUID(),
        selected: false,
        versionId: replacementVersionId,
      });
      assert.equal(removed.status, 200);
      const removedBody = await removed.json();
      assert.equal(removedBody.selected, false);
      assert.equal(removedBody.selectedVersionId, null);
      assert.equal(removedBody.selectedCount, 0);
      assert.equal(removedBody.selectionRevision, 3);
      assert.ok(removedBody.eventId);
      const removalEvent = await db
        .prepare(
          'SELECT action,before_json,after_json FROM audit_events WHERE event_id=?',
        )
        .bind(removedBody.eventId)
        .first();
      assert.equal(removalEvent.action, 'selection.removed');
      assert.equal(JSON.parse(removalEvent.before_json).selected, true);
      assert.equal(JSON.parse(removalEvent.after_json).selected, false);
      const auditAfterRemove = await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action LIKE 'selection.%'",
        )
        .first();
      const noOp = await put(selectionGuest, {
        requestId: randomUUID(),
        selected: false,
        versionId: replacementVersionId,
      });
      const noOpBody = await noOp.json();
      assert.equal(noOpBody.eventId, null);
      assert.equal(noOpBody.selectedCount, 0);
      assert.equal(noOpBody.selectionRevision, 3);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action LIKE 'selection.%'",
            )
            .first()
        ).n,
        auditAfterRemove.n,
      );

      const failedRequestId = randomUUID();
      await db.exec(
        "CREATE TRIGGER guest_selection_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action LIKE 'selection.%' BEGIN SELECT RAISE(ABORT,'TEST_SELECTION_AUDIT_FAILURE'); END",
      );
      let failed;
      try {
        failed = await put(selectionGuest, {
          requestId: failedRequestId,
          selected: true,
          versionId: galleryFixture.photo.versionId,
        });
      } finally {
        await db.exec('DROP TRIGGER guest_selection_test_audit_failure');
      }
      assert.equal(failed.status, 503);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_state WHERE guest_id=?',
            )
            .bind(selectionGuest.guestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_commands WHERE request_id=?',
            )
            .bind(failedRequestId)
            .first()
        ).n,
        0,
      );
      const retryAfterAuditFailure = await put(selectionGuest, {
        requestId: failedRequestId,
        selected: true,
        versionId: galleryFixture.photo.versionId,
      });
      assert.equal(retryAfterAuditFailure.status, 200);

      const submitRequestId = randomUUID();
      const submitBody = {
        requestId: submitRequestId,
        expectedRoundNo: 1,
        expectedRevision: 4,
      };
      const requestCollision = await submitSelection(selectionGuest, {
        ...submitBody,
        requestId,
      });
      assert.equal(requestCollision.status, 409);
      const beforeSubmissionAudit = await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action='selection.submitted'",
        )
        .first();
      await db.exec(
        "CREATE TRIGGER guest_selection_test_submit_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='selection.submitted' BEGIN SELECT RAISE(ABORT,'TEST_SELECTION_SUBMIT_AUDIT_FAILURE'); END",
      );
      let failedSubmit;
      try {
        failedSubmit = await submitSelection(selectionGuest, submitBody);
      } finally {
        await db.exec('DROP TRIGGER guest_selection_test_submit_audit_failure');
      }
      assert.equal(failedSubmit.status, 503);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT status,selection_revision FROM guest_selection_round_state WHERE invite_id=? AND guest_id=? AND album_id=?',
            )
            .bind(selectionInvite, selectionGuest.guestId, grantScope.album)
            .first()
        ).status,
        'open',
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_selection_submissions')
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_submission_items',
            )
            .first()
        ).n,
        0,
      );
      const submitted = await submitSelection(selectionGuest, submitBody);
      assert.equal(submitted.status, 200);
      const submittedBody = await submitted.json();
      assert.equal(submittedBody.roundNo, 1);
      assert.equal(submittedBody.selectionRevision, 4);
      assert.equal(submittedBody.selectedCount, 1);
      assert.equal(
        submittedBody.eventId,
        'guest-selection-submit:' + submittedBody.submissionId,
      );
      assert.equal(
        (await submitSelection(selectionGuest, submitBody)).status,
        200,
      );
      const conflictingReplay = await submitSelection(selectionGuest, {
        ...submitBody,
        expectedRevision: 3,
      });
      assert.equal(conflictingReplay.status, 409);
      assert.equal(
        (await submitSelection(selectionGuest, { requestId: randomUUID() }))
          .status,
        409,
      );
      const afterSubmitPage = await readSelection(selectionGuest);
      const afterSubmitBody = await afterSubmitPage.json();
      assert.equal(afterSubmitBody.roundStatus, 'submitted');
      assert.equal(afterSubmitBody.submittedAt, submittedBody.submittedAt);
      assert.equal(afterSubmitBody.items.length, 1);
      assert.equal(
        afterSubmitBody.items[0].versionId,
        galleryFixture.photo.versionId,
      );
      const snapshotItem = await db
        .prepare(
          'SELECT photo_id,version_id FROM guest_selection_submission_items WHERE submission_id=?',
        )
        .bind(submittedBody.submissionId)
        .first();
      assert.equal(snapshotItem.photo_id, galleryFixture.photo.photoId);
      assert.equal(snapshotItem.version_id, galleryFixture.photo.versionId);
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO guest_selection_submission_items(submission_id,invite_id,guest_id,workspace_id,project_id,album_id,photo_id,version_id,selected_at_ms) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            submittedBody.submissionId,
            selectionInvite,
            selectionGuest.guestId,
            grantScope.workspace,
            grantScope.project,
            grantScope.album,
            staleCursorPhotos[0].photoId,
            staleCursorPhotos[0].versionId,
            Date.now(),
          )
          .run(),
        /IMMUTABLE_GUEST_SELECTION_SNAPSHOT/,
      );
      assert.deepEqual(
        (
          await db
            .prepare(
              'SELECT photo_id,version_id FROM guest_selection_submission_items WHERE submission_id=? ORDER BY photo_id',
            )
            .bind(submittedBody.submissionId)
            .all()
        ).results,
        [
          {
            photo_id: galleryFixture.photo.photoId,
            version_id: galleryFixture.photo.versionId,
          },
        ],
      );
      const submissionEvent = await db
        .prepare(
          'SELECT action,actor_id,guest_session_id,workspace_id,project_id,album_id,request_id,after_json FROM audit_events WHERE event_id=?',
        )
        .bind(submittedBody.eventId)
        .first();
      assert.equal(submissionEvent.action, 'selection.submitted');
      assert.equal(submissionEvent.actor_id, selectionGuest.guestId);
      assert.equal(submissionEvent.guest_session_id, selectionGuest.id);
      assert.equal(submissionEvent.workspace_id, grantScope.workspace);
      assert.equal(submissionEvent.project_id, grantScope.project);
      assert.equal(submissionEvent.album_id, grantScope.album);
      assert.equal(submissionEvent.request_id, submitRequestId);
      assert.equal(JSON.parse(submissionEvent.after_json).selectedCount, 1);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.submitted'",
            )
            .first()
        ).n,
        beforeSubmissionAudit.n + 1,
      );
      const lockedMutation = await put(selectionGuest, {
        requestId: randomUUID(),
        selected: false,
        versionId: galleryFixture.photo.versionId,
      });
      assert.equal(lockedMutation.status, 409);
      const submissionIdCollision = await put(selectionGuest, {
        requestId: submitRequestId,
        selected: false,
        versionId: galleryFixture.photo.versionId,
      });
      assert.equal(submissionIdCollision.status, 409);
      const logoutCollision = await request('/api/guest/logout', {
        method: 'POST',
        headers: {
          Cookie: 'kino_guest=' + selectionGuest.secret,
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requestId }),
      });
      assert.equal(logoutCollision.status, 409);
      assert.equal(logoutCollision.headers.get('Set-Cookie'), null);
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_selection_submission_items SET version_id=? WHERE submission_id=?',
          )
          .bind(replacementVersionId, submittedBody.submissionId)
          .run(),
        /IMMUTABLE_GUEST_SELECTION_SNAPSHOT/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_selection_submissions WHERE id=?')
          .bind(submittedBody.submissionId)
          .run(),
        /IMMUTABLE_GUEST_SELECTION_SUBMISSION/,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT status FROM guest_selection_round_state WHERE invite_id=? AND guest_id=? AND album_id=?',
            )
            .bind(selectionInvite, selectionGuest.guestId, grantScope.album)
            .first()
        ).status,
        'submitted',
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_selection_round_state SET project_id=? WHERE invite_id=? AND guest_id=? AND album_id=?',
          )
          .bind(
            randomUUID(),
            selectionInvite,
            selectionGuest.guestId,
            grantScope.album,
          )
          .run(),
        /IMMUTABLE_GUEST_SELECTION_ROUND_SCOPE/,
      );
      await assert.rejects(
        db
          .prepare(
            `INSERT INTO guest_selection_round_state(
              invite_id,guest_id,workspace_id,project_id,album_id,round_no,selection_revision,status,submitted_at_ms,updated_at_ms
            ) VALUES(?,?,?,?,?,1,1,'submitted',?,?)`,
          )
          .bind(
            selectionOnlyGuest.inviteId,
            selectionOnlyGuest.guestId,
            grantScope.workspace,
            grantScope.project,
            grantScope.album,
            Date.now(),
            Date.now(),
          )
          .run(),
        /INVALID_GUEST_SELECTION_ROUND_INSERT/,
      );

      const viewOnly = await session(await invite({ mask: 1, grantScope }));
      const deniedPermission = await put(viewOnly, {
        requestId: randomUUID(),
        selected: true,
        versionId: galleryFixture.photo.versionId,
      });
      assert.equal(deniedPermission.status, 401);
      const deniedCount = await db
        .prepare('SELECT count(*) AS n FROM guest_selection_commands')
        .first();
      const revokedHash = createHash('sha256')
        .update('kino-pic:guest-session:v1:' + selectionGuest.secret)
        .digest('hex');
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(selectionGuest.id, revokedHash)
        .run();
      const revoked = await put(selectionGuest, {
        requestId: randomUUID(),
        selected: false,
        versionId: galleryFixture.photo.versionId,
      });
      assert.equal(revoked.status, 401);
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_selection_commands')
            .first()
        ).n,
        deniedCount.n,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_selection_commands SET selected=0 WHERE guest_id=? AND request_id=?',
          )
          .bind(selectionGuest.guestId, failedRequestId)
          .run(),
        /IMMUTABLE_GUEST_SELECTION_COMMAND/,
      );
    },
  );

  await check(
    '375px Guest selection UI toggles selection, guards empty submit, freezes round on confirm and records immutable snapshot',
    async () => {
      const grantScope = {
        workspace: galleryFixture.context.workspace.id,
        project: galleryFixture.context.project.id,
        album: galleryFixture.context.album.id,
      };
      // Mask 521: can_view (1) + can_select (8) + can_submit (512)
      const browserInvite = await invite({ mask: 521, grantScope });
      const browserGuest = await session(browserInvite);
      const enabledWorker = await mf.getWorker('guest-selection-test');

      await runGuestSelectionBrowserChecks({
        worker: enabledWorker,
        baseUrl: base,
        guestCookie: browserGuest.secret,
        albumId: galleryFixture.context.album.id,
        db,
        guestId: browserGuest.guestId,
      });
    },
  );
}
