import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function workspaceChecks({
  check,
  request,
  db,
  cookies,
  owner,
  base,
}) {
  const headers = {
    Cookie: cookies.headers(),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const post = (body, extra = {}) =>
    request('/api/v1/workspaces', {
      method: 'POST',
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  const name = '奇諾工作空間';
  const requestId = randomUUID();
  let workspace;
  const session = (await (await request('/api/v1/me', { headers })).json())
    .sessionId;
  await check(
    'D1 workspace concurrent retry writes one workspace, ledger and UTC audit',
    async () => {
      const replies = await Promise.all(
        Array.from({ length: 4 }, () =>
          post({ name: '  ' + name + '  ', requestId }),
        ),
      );
      for (const reply of replies) assert.equal(reply.status, 201);
      const bodies = await Promise.all(replies.map((r) => r.json()));
      workspace = bodies[0].workspace;
      for (const body of bodies) assert.deepEqual(body.workspace, workspace);
      assert.equal(workspace.ownerUserId, owner);
      assert.equal(workspace.quotaBytes, 9000000000);
      assert.equal(workspace.name, name);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM workspaces').first()).n,
        1,
      );
      const audit = await db
        .prepare(
          "SELECT * FROM audit_events WHERE action='workspace.created' AND request_id=?",
        )
        .bind(requestId)
        .first();
      assert.equal(audit.session_id, session);
      assert.equal(audit.actor_id, owner);
      assert.equal(audit.workspace_id, workspace.id);
      assert.match(audit.occurred_at_utc, /Z$/);
      assert.deepEqual(JSON.parse(audit.after_json), workspace);
      assert.equal((await post({ name: 'different', requestId })).status, 409);
    },
  );
  await check(
    'D1 workspace API rejects forged fields, CSRF, malformed JSON and oversized bodies',
    async () => {
      for (const body of [
        { name: ' ', requestId: randomUUID() },
        { name: 'a'.repeat(121), requestId: randomUUID() },
        { name, requestId: 'bad' },
        { name, requestId: randomUUID(), ownerUserId: owner },
      ])
        assert.equal((await post(body)).status, 400);
      assert.equal(
        (
          await post(
            { name, requestId: randomUUID() },
            { Origin: 'https://attacker.invalid' },
          )
        ).status,
        403,
      );
      assert.equal(
        (await post({ name, requestId: randomUUID() }, { Origin: '' })).status,
        403,
      );
      assert.equal(
        (
          await request('/api/v1/workspaces', {
            method: 'POST',
            headers,
            body: '{',
          })
        ).status,
        400,
      );
      assert.equal(
        (await post({ name: 'x'.repeat(17000), requestId: randomUUID() }))
          .status,
        413,
      );
      assert.equal(
        (await request('/api/v1/workspaces?cursor=bad!', { headers })).status,
        400,
      );
      assert.equal(
        (await request('/api/v1/workspaces?actorId=' + owner, { headers }))
          .status,
        400,
      );
    },
  );
  await check(
    'D1 workspace injected audit failure rolls back state and replay ledger',
    async () => {
      const id = randomUUID();
      await db.exec(
        "CREATE TRIGGER fail_workspace_audit BEFORE INSERT ON audit_events WHEN NEW.action='workspace.created' BEGIN SELECT RAISE(ABORT,'INJECTED_FAILURE'); END;",
      );
      try {
        assert.equal(
          (await post({ name: 'rollback', requestId: id })).status,
          503,
        );
        assert.equal(
          await db
            .prepare('SELECT * FROM workspace_commands WHERE request_id=?')
            .bind(id)
            .first(),
          null,
        );
        assert.equal(
          await db
            .prepare("SELECT * FROM workspaces WHERE name='rollback'")
            .first(),
          null,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_workspace_audit');
      }
      assert.equal(
        (await post({ name: 'rollback', requestId: id })).status,
        201,
      );
    },
  );
  await check(
    'D1 workspace SQL rechecks enabled Owner and live session before replay',
    async () => {
      const insert = (sid, id = requestId) =>
        db
          .prepare(
            'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
          )
          .bind(owner, id, sid, name, randomUUID())
          .run();
      await db.prepare('UPDATE owners SET enabled=0').run();
      try {
        assert.equal((await post({ name, requestId })).status, 403);
        await assert.rejects(insert(session), /OWNER_REQUIRED/);
        await assert.rejects(insert(session, randomUUID()), /OWNER_REQUIRED/);
      } finally {
        await db.prepare('UPDATE owners SET enabled=1').run();
      }
      await assert.rejects(insert('forged'), /OWNER_REQUIRED/);
      const expiry = (
        await db
          .prepare('SELECT expiresAt FROM owner_sessions WHERE id=?')
          .bind(session)
          .first()
      ).expiresAt;
      await db
        .prepare('UPDATE owner_sessions SET expiresAt=0 WHERE id=?')
        .bind(session)
        .run();
      try {
        await assert.rejects(insert(session), /OWNER_REQUIRED/);
      } finally {
        await db
          .prepare('UPDATE owner_sessions SET expiresAt=? WHERE id=?')
          .bind(expiry, session)
          .run();
      }
      await assert.rejects(
        db.prepare('DELETE FROM workspace_commands').run(),
        /IMMUTABLE_COMMAND/,
      );
      await assert.rejects(
        db.prepare("UPDATE workspace_commands SET name='tamper'").run(),
        /IMMUTABLE_COMMAND/,
      );
    },
  );
  await check(
    'D1 workspace keyset pages cover tied timestamps and cap at 100 with replay allowed',
    async () => {
      // Force ties through trusted fixture SQL; production has no update endpoint.
      for (let i = 2; i < 100; i++)
        await db
          .prepare(
            'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
          )
          .bind(owner, randomUUID(), session, 'workspace ' + i, randomUUID())
          .run();
      await db
        .prepare("UPDATE workspaces SET created_at='2026-10-23T12:00:00.000Z'")
        .run();
      const ids = [];
      let cursor = null;
      do {
        const response = await request(
          '/api/v1/workspaces' + (cursor ? '?cursor=' + cursor : ''),
          { headers },
        );
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get('Cache-Control'),
          'private, no-store',
        );
        const body = await response.json();
        assert.ok(body.workspaces.length <= 24);
        ids.push(...body.workspaces.map((w) => w.id));
        cursor = body.nextCursor;
      } while (cursor);
      assert.equal(ids.length, 100);
      assert.equal(new Set(ids).size, 100);
      assert.deepEqual(ids, [...ids].sort().reverse());
      assert.equal(
        (await post({ name: 'over limit', requestId: randomUUID() })).status,
        409,
      );
      const replay = await post({ name, requestId });
      assert.equal(replay.status, 201);
      assert.deepEqual((await replay.json()).workspace, workspace);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='workspace.created'",
            )
            .first()
        ).n,
        100,
      );
    },
  );
}
