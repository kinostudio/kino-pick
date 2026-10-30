import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function projectVersioningChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  const worker = await mf.getWorker('project-versioning-test');
  const cookie = cookies.headers();
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
  };
  const send = (method, path, body, overrides = {}) =>
    worker.fetch(
      new Request(new URL(path, base), {
        method,
        headers: { ...headers, ...overrides },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const first = (sql, ...values) =>
    db
      .prepare(sql)
      .bind(...values)
      .first();
  const error = async (response, status, code) => {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(body.error?.code, code);
  };
  let project;
  const path = () => '/api/v1/projects/' + project.id + '/versioning';
  const write = (expectedRevision, mode, requestId = randomUUID()) => ({
    requestId,
    expectedRevision,
    mode,
    confirm: true,
  });
  const snapshot = async () => ({
    project: await first(
      'SELECT versioning_mode,revision,versioning_command_id FROM projects WHERE id=?',
      project.id,
    ),
    commands: (
      await first(
        'SELECT count(*) AS n FROM project_versioning_commands WHERE project_id=?',
        project.id,
      )
    ).n,
    results: (
      await first('SELECT count(*) AS n FROM project_versioning_results')
    ).n,
    audits: (
      await first(
        "SELECT count(*) AS n FROM audit_events WHERE project_id=? AND action='project.versioning_mode_changed'",
        project.id,
      )
    ).n,
  });

  await check(
    'Project versioning is local/default-OFF and requires current Owner authentication',
    async () => {
      const anonymous = await worker.fetch(
        new Request(base + '/api/v1/versioning/capabilities'),
      );
      assert.equal(anonymous.status, 401);
      assert.deepEqual(
        await (
          await request('/api/v1/versioning/capabilities', {
            headers: { Cookie: cookie },
          })
        ).json(),
        { enabled: false },
      );
      assert.deepEqual(
        await (await send('GET', '/api/v1/versioning/capabilities')).json(),
        { enabled: true },
      );
      const response = await request('/api/v1/projects', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workspaceId: galleryFixture.context.workspace.id,
          name: 'Project version settings ' + randomUUID(),
          requestId: randomUUID(),
        }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      project = (await response.json()).project;
      const read = await send('GET', path());
      assert.equal(read.status, 200, await read.clone().text());
      assert.deepEqual(await read.json(), {
        projectId: project.id,
        workspaceId: project.workspaceId,
        mode: 'manual',
        revision: project.revision,
        availableModes: ['off', 'manual'],
      });
    },
  );
  let original;
  let changed;
  await check(
    'Confirmed mode changes share project CAS and append one before/after event with exact retry',
    async () => {
      original = write(project.revision, 'off');
      const response = await send('PUT', path(), original);
      assert.equal(response.status, 200, await response.clone().text());
      changed = await response.json();
      assert.deepEqual(
        { ...changed, eventId: null },
        {
          projectId: project.id,
          workspaceId: project.workspaceId,
          mode: 'off',
          revision: project.revision + 1,
          changed: true,
          eventId: null,
        },
      );
      assert.ok(changed.eventId);
      const before = await snapshot();
      assert.deepEqual(
        await (await send('PUT', path(), original)).json(),
        changed,
      );
      assert.deepEqual(await snapshot(), before);
      const audit = await first(
        'SELECT actor_id,session_id,request_id,before_json,after_json FROM audit_events WHERE event_id=?',
        changed.eventId,
      );
      assert.equal(audit.actor_id, owner);
      assert.ok(audit.session_id);
      assert.equal(audit.request_id, original.requestId);
      assert.equal(JSON.parse(audit.before_json).mode, 'manual');
      assert.equal(JSON.parse(audit.after_json).mode, 'off');
    },
  );
  await check(
    'Mode no-op, stale new intent and historical replay preserve current configuration and audit',
    async () => {
      const restore = await send(
        'PUT',
        path(),
        write(changed.revision, 'manual'),
      );
      assert.equal(restore.status, 200, await restore.clone().text());
      const current = await restore.json();
      const before = await snapshot();
      const noop = await send('PUT', path(), write(current.revision, 'manual'));
      assert.equal(noop.status, 200, await noop.clone().text());
      assert.deepEqual(await noop.json(), {
        projectId: project.id,
        workspaceId: project.workspaceId,
        mode: 'manual',
        revision: current.revision,
        changed: false,
        eventId: null,
      });
      assert.equal((await snapshot()).audits, before.audits);
      const afterNoop = await snapshot();
      await error(
        await send('PUT', path(), write(changed.revision, 'off')),
        409,
        'PROJECT_VERSIONING_REVISION_CONFLICT',
      );
      assert.deepEqual(await snapshot(), afterNoop);
      assert.deepEqual(
        await (await send('PUT', path(), original)).json(),
        changed,
      );
      assert.equal((await (await send('GET', path())).json()).mode, 'manual');
      assert.deepEqual(await snapshot(), afterNoop);
    },
  );
  await check(
    'Mode writes reject CSRF, actor swaps, unconfirmed or automated input without partial writes',
    async () => {
      const state = await (await send('GET', path())).json();
      const body = write(state.revision, 'off');
      const before = await snapshot();
      const rejectedOrigin = await send('PUT', path(), body, {
        Origin: 'https://foreign.example',
      });
      assert.equal(rejectedOrigin.status, 403, await rejectedOrigin.text());
      await error(
        await send('PUT', path(), body, {
          'X-Kino-Expected-Actor': randomUUID(),
        }),
        403,
        'PROJECT_VERSIONING_OWNER_CHANGED',
      );
      for (const input of [
        { ...body, confirm: false },
        { ...body, mode: 'auto_filename' },
        { ...body, mode: 'assisted' },
        { ...body, workspaceId: project.workspaceId },
        { ...body, expectedRevision: 0 },
      ])
        await error(await send('PUT', path(), input), 400, 'INVALID_INPUT');
      await error(
        await send('PUT', path() + '?unexpected=1', body),
        400,
        'INVALID_INPUT',
      );
      await error(
        await send('GET', path() + '?unexpected=1'),
        400,
        'INVALID_INPUT',
      );
      assert.deepEqual(await snapshot(), before);
    },
  );
  return { projectId: project.id, projectName: project.name };
}
