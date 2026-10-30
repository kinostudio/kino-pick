import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

async function insertReplace(db, table, row) {
  const columns = Object.keys(row);
  return db
    .prepare(
      'INSERT OR REPLACE INTO ' +
        quote(table) +
        '(' +
        columns.map(quote).join(',') +
        ') VALUES(' +
        columns.map(() => '?').join(',') +
        ')',
    )
    .bind(...columns.map((column) => row[column]))
    .run();
}

export async function projectVersioningIntegrityChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  expiredOwnerCookie,
  projectId,
}) {
  const worker = await mf.getWorker('project-versioning-test');
  const cookie = cookies.headers();
  assert.ok(
    typeof expiredOwnerCookie === 'string' && expiredOwnerCookie.length > 0,
    'the helper requires a separate synthetic Owner session cookie',
  );
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
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(body?.error?.code, code, JSON.stringify(body));
  };
  const versioningPath = '/api/v1/projects/' + projectId + '/versioning';
  const archivePath = '/api/v1/projects/' + projectId + '/archive';
  const readVersioning = () => send('GET', versioningPath);
  const write = (expectedRevision, mode, requestId = randomUUID()) => ({
    requestId,
    expectedRevision,
    mode,
    confirm: true,
  });
  const oppositeMode = (mode) => (mode === 'manual' ? 'off' : 'manual');
  const put = (body, overrides = {}) =>
    send('PUT', versioningPath, body, overrides);
  const rename = (name, expectedRevision, requestId = randomUUID()) =>
    send('PATCH', '/api/v1/projects/' + projectId, {
      name,
      expectedRevision,
      requestId,
    });
  const snapshot = async () => ({
    project: await first('SELECT * FROM projects WHERE id=?', projectId),
    commands: (
      await db
        .prepare(
          'SELECT * FROM project_versioning_commands WHERE project_id=? ORDER BY created_at_ms,id',
        )
        .bind(projectId)
        .all()
    ).results,
    results: (
      await db
        .prepare(
          'SELECT r.* FROM project_versioning_results r JOIN project_versioning_commands c ON c.id=r.command_id WHERE c.project_id=? ORDER BY c.created_at_ms,c.id',
        )
        .bind(projectId)
        .all()
    ).results,
    audit: (
      await db
        .prepare(
          "SELECT * FROM audit_events WHERE project_id=? AND action='project.versioning_mode_changed' ORDER BY rowid",
        )
        .bind(projectId)
        .all()
    ).results,
    projectRequests: (
      await db
        .prepare(
          'SELECT * FROM request_commands WHERE actor_id=? AND resource_id=? ORDER BY rowid',
        )
        .bind(owner, projectId)
        .all()
    ).results,
    foreignKeys: (await db.prepare('PRAGMA foreign_key_check').all()).results,
  });

  const initialProject = await first(
    'SELECT id,workspace_id,name,status,versioning_mode,revision FROM projects WHERE id=?',
    projectId,
  );
  assert.ok(
    initialProject,
    'the base project-versioning helper must create a project',
  );
  assert.ok(
    !['archived', 'deleting', 'deleted'].includes(initialProject.status),
    'integrity helper requires an active project',
  );
  assert.equal(
    initialProject.versioning_mode,
    'manual',
    'the base helper must leave the project in manual mode',
  );
  const initialOwner = await first(
    'SELECT enabled FROM owners WHERE user_id=?',
    owner,
  );
  assert.equal(
    initialOwner?.enabled,
    1,
    'integrity helper requires an enabled Owner',
  );

  const authResponse = await worker.fetch(
    new Request(new URL('/api/auth/get-session', base), {
      headers: { Cookie: cookie },
    }),
  );
  assert.equal(authResponse.status, 200);
  const auth = await authResponse.json();
  assert.equal(auth?.user?.id, owner);
  const ownerSessionId = auth?.session?.id;
  assert.ok(ownerSessionId, 'expected the cookie-bound live Owner session');
  const initialOwnerSession = await first(
    'SELECT id,expiresAt FROM owner_sessions WHERE id=? AND userId=?',
    ownerSessionId,
    owner,
  );
  assert.ok(initialOwnerSession);
  assert.ok(
    initialOwnerSession.expiresAt > Date.now(),
    'the cookie-bound Owner session must initially be live',
  );

  const expiredAuthResponse = await worker.fetch(
    new Request(new URL('/api/auth/get-session', base), {
      headers: { Cookie: expiredOwnerCookie },
    }),
  );
  assert.equal(expiredAuthResponse.status, 200);
  const expiredAuth = await expiredAuthResponse.json();
  assert.equal(expiredAuth?.user?.id, owner);
  const expiredOwnerSessionId = expiredAuth?.session?.id;
  assert.ok(expiredOwnerSessionId);
  assert.notEqual(
    expiredOwnerSessionId,
    ownerSessionId,
    'expiry coverage must use a separate synthetic session',
  );
  const expiredOwnerSession = await first(
    'SELECT id,expiresAt FROM owner_sessions WHERE id=? AND userId=?',
    expiredOwnerSessionId,
    owner,
  );
  assert.ok(expiredOwnerSession);
  assert.ok(expiredOwnerSession.expiresAt > Date.now());

  let replayIntent;

  try {
    await check(
      'Project version audit failure rolls back command, result, audit, and project state before exact retry',
      async () => {
        const current = await (await readVersioning()).json();
        replayIntent = write(current.revision, oppositeMode(current.mode));
        const before = await snapshot();
        await db.exec(
          "CREATE TRIGGER fail_project_versioning_audit BEFORE INSERT ON audit_events WHEN NEW.action='project.versioning_mode_changed' BEGIN SELECT RAISE(ABORT,'PROJECT_VERSIONING_AUDIT_INJECTED'); END;",
        );
        try {
          await error(
            await put(replayIntent),
            503,
            'PROJECT_VERSIONING_UNAVAILABLE',
          );
        } finally {
          await db.exec('DROP TRIGGER fail_project_versioning_audit');
        }
        assert.deepEqual(
          await snapshot(),
          before,
          'failed audit insertion must roll back every ledger and project mutation',
        );

        const retried = await put(replayIntent);
        assert.equal(retried.status, 200, await retried.clone().text());
        const result = await retried.json();
        assert.equal(result.changed, true);
        assert.equal(result.mode, replayIntent.mode);
        assert.equal(result.revision, current.revision + 1);
        assert.ok(result.eventId);
        const stored = await first(
          'SELECT result_json FROM project_versioning_results WHERE event_id=?',
          result.eventId,
        );
        assert.deepEqual(JSON.parse(stored.result_json), result);
        const audit = await first(
          'SELECT actor_id,request_id,action,before_json,after_json FROM audit_events WHERE event_id=?',
          result.eventId,
        );
        assert.equal(audit.actor_id, owner);
        assert.equal(audit.request_id, replayIntent.requestId);
        assert.equal(audit.action, 'project.versioning_mode_changed');
        assert.equal(JSON.parse(audit.before_json).mode, current.mode);
        assert.equal(JSON.parse(audit.after_json).mode, result.mode);
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM project_versioning_commands WHERE actor_id=? AND request_id=?',
              owner,
              replayIntent.requestId,
            )
          ).n,
          1,
        );
        const committed = await snapshot();
        assert.deepEqual(await (await put(replayIntent)).json(), result);
        assert.deepEqual(
          await snapshot(),
          committed,
          'exact retry must not add a second result or audit event',
        );
      },
    );

    await check(
      'Project rename and version-mode writes share one revision CAS and request namespace in both directions',
      async () => {
        const current = await (await readVersioning()).json();
        const staleIntent = write(current.revision, oppositeMode(current.mode));
        const projectBeforeRename = await first(
          'SELECT name,revision FROM projects WHERE id=?',
          projectId,
        );
        const renameRequestId = randomUUID();
        const renameName = 'Version integrity rename ' + randomUUID();
        const renamed = await rename(
          renameName,
          projectBeforeRename.revision,
          renameRequestId,
        );
        assert.equal(renamed.status, 200, await renamed.clone().text());
        const renamedProject = (await renamed.json()).project;
        assert.equal(renamedProject.revision, current.revision + 1);
        assert.equal(renamedProject.name, renameName);
        const afterRename = await snapshot();
        await error(
          await put(staleIntent),
          409,
          'PROJECT_VERSIONING_REVISION_CONFLICT',
        );
        assert.deepEqual(
          await snapshot(),
          afterRename,
          'stale configuration must not add a command or revert the rename',
        );

        const afterStale = await (await readVersioning()).json();
        const namespaceSnapshot = await snapshot();
        await error(
          await put(
            write(
              afterStale.revision,
              oppositeMode(afterStale.mode),
              renameRequestId,
            ),
          ),
          409,
          'REQUEST_ID_CONFLICT',
        );
        assert.deepEqual(await snapshot(), namespaceSnapshot);

        const configIntent = write(
          afterStale.revision,
          oppositeMode(afterStale.mode),
        );
        const configResponse = await put(configIntent);
        assert.equal(
          configResponse.status,
          200,
          await configResponse.clone().text(),
        );
        const configResult = await configResponse.json();
        assert.equal(configResult.changed, true);
        const afterConfig = await snapshot();
        await error(
          await rename(
            'Must not apply ' + randomUUID(),
            configResult.revision,
            configIntent.requestId,
          ),
          409,
          'REQUEST_ID_CONFLICT',
        );
        assert.deepEqual(
          await snapshot(),
          afterConfig,
          'legacy project rename must reject a versioning command request ID symmetrically',
        );
        replayIntent = configIntent;
      },
    );

    await check(
      'Project versioning commands, results, and provenance reject mutation, replacement, cloning, and predecessor rollback',
      async () => {
        const history = (
          await db
            .prepare(
              'SELECT * FROM project_versioning_commands WHERE project_id=? ORDER BY created_at_ms,id',
            )
            .bind(projectId)
            .all()
        ).results;
        assert.ok(history.length >= 2, 'requires at least two mode changes');
        const project = await first(
          'SELECT * FROM projects WHERE id=?',
          projectId,
        );
        const currentCommand = history.find(
          (command) => command.id === project.versioning_command_id,
        );
        assert.ok(
          currentCommand,
          'project provenance must point to its latest changed command',
        );
        const historicalCommand = history.find(
          (command) =>
            command.id !== project.versioning_command_id &&
            command.mode !== project.versioning_mode,
        );
        assert.ok(
          historicalCommand,
          'requires an earlier command with a different mode for rollback testing',
        );

        const before = await snapshot();
        const primaryCommand = {
          ...currentCommand,
          request_id: randomUUID(),
          created_at_ms: Date.now(),
        };
        await assert.rejects(
          insertReplace(db, 'project_versioning_commands', primaryCommand),
          /IMMUTABLE_PROJECT_VERSIONING_COMMAND/u,
          'same command ID must not replace immutable command history',
        );

        const alternateCommand = {
          ...currentCommand,
          id: randomUUID(),
          mode: oppositeMode(currentCommand.mode),
          payload_json: JSON.stringify({
            projectId,
            expectedRevision: currentCommand.expected_revision,
            mode: oppositeMode(currentCommand.mode),
            confirm: true,
          }),
          created_at_ms: Date.now(),
        };
        await assert.rejects(
          insertReplace(db, 'project_versioning_commands', alternateCommand),
          /REQUEST_ID_CONFLICT/u,
          'an existing project request ID with different intent must conflict',
        );

        const nullCommand = {
          ...currentCommand,
          id: null,
          request_id: randomUUID(),
          created_at_ms: Date.now(),
        };
        await assert.rejects(
          insertReplace(db, 'project_versioning_commands', nullCommand),
          /IMMUTABLE_PROJECT_VERSIONING_COMMAND|NOT NULL/u,
          'a valid-scope command with a null ID must be rejected',
        );

        await assert.rejects(
          db
            .prepare(
              "UPDATE project_versioning_commands SET mode='off' WHERE id=?",
            )
            .bind(currentCommand.id)
            .run(),
          /IMMUTABLE_PROJECT_VERSIONING_COMMAND/u,
        );
        await assert.rejects(
          db
            .prepare('DELETE FROM project_versioning_commands WHERE id=?')
            .bind(currentCommand.id)
            .run(),
          /IMMUTABLE_PROJECT_VERSIONING_COMMAND/u,
        );

        const eventResult = await first(
          'SELECT r.* FROM project_versioning_results r JOIN project_versioning_commands c ON c.id=r.command_id WHERE c.project_id=? AND r.event_id IS NOT NULL ORDER BY c.created_at_ms DESC,c.id DESC LIMIT 1',
          projectId,
        );
        assert.ok(
          eventResult,
          'requires a changed command result with an event ID',
        );
        const primaryResult = {
          ...eventResult,
          result_json: JSON.stringify({ tampered: true }),
        };
        await assert.rejects(
          insertReplace(db, 'project_versioning_results', primaryResult),
          /IMMUTABLE_PROJECT_VERSIONING_RESULT/u,
          'same result command ID must not replace stored result JSON',
        );
        const alternateResult = {
          ...eventResult,
          command_id: randomUUID(),
          result_json: JSON.stringify({ tampered: true }),
        };
        await assert.rejects(
          insertReplace(db, 'project_versioning_results', alternateResult),
          /IMMUTABLE_PROJECT_VERSIONING_RESULT/u,
          'event ID must not be replaced by a different result command',
        );
        const nullResult = {
          ...eventResult,
          command_id: null,
        };
        await assert.rejects(
          insertReplace(db, 'project_versioning_results', nullResult),
          /IMMUTABLE_PROJECT_VERSIONING_RESULT|NOT NULL/u,
          'a result with a null command ID must be rejected',
        );
        await assert.rejects(
          db
            .prepare(
              "UPDATE project_versioning_results SET result_json='{}' WHERE command_id=?",
            )
            .bind(eventResult.command_id)
            .run(),
          /IMMUTABLE_PROJECT_VERSIONING_RESULT/u,
        );
        await assert.rejects(
          db
            .prepare(
              'DELETE FROM project_versioning_results WHERE command_id=?',
            )
            .bind(eventResult.command_id)
            .run(),
          /IMMUTABLE_PROJECT_VERSIONING_RESULT/u,
        );

        const cloneProjectId = randomUUID();
        await assert.rejects(
          db
            .prepare(
              "INSERT INTO projects(id,workspace_id,name,status,versioning_mode,revision,versioning_command_id) VALUES(?,?,?,'draft',?,1,?)",
            )
            .bind(
              cloneProjectId,
              project.workspace_id,
              'Provenance clone fixture',
              historicalCommand.mode,
              historicalCommand.id,
            )
            .run(),
          /PROJECT_VERSIONING_STATE_IMMUTABLE/u,
          'a new project cannot clone another project command pointer',
        );
        assert.equal(
          await first('SELECT id FROM projects WHERE id=?', cloneProjectId),
          null,
        );

        await assert.rejects(
          db
            .prepare(
              'INSERT OR REPLACE INTO projects(id,workspace_id,name,status,versioning_mode,revision,versioning_command_id) VALUES(?,?,?, ?,?,?,?)',
            )
            .bind(
              projectId,
              project.workspace_id,
              project.name,
              project.status,
              historicalCommand.mode,
              project.revision,
              historicalCommand.id,
            )
            .run(),
          /PROJECT_VERSIONING_STATE_IMMUTABLE|INVALID_PROJECT_VERSIONING_REPLACE/u,
          'REPLACE must not restore an earlier configuration or provenance pointer',
        );

        await assert.rejects(
          db
            .prepare(
              'UPDATE projects SET versioning_mode=?,versioning_command_id=? WHERE id=?',
            )
            .bind(historicalCommand.mode, historicalCommand.id, projectId)
            .run(),
          /INVALID_PROJECT_VERSIONING_TRANSITION/u,
          'an earlier command cannot roll the current project pointer backward',
        );
        assert.deepEqual(
          await snapshot(),
          before,
          'all failed replacement, mutation, clone, and rollback attempts must preserve history and project state',
        );
      },
    );

    await check(
      'Disabled and expired Owner authority, and archived project scope, deny exact replay before returning history',
      async () => {
        assert.ok(replayIntent, 'requires a previously committed exact intent');
        const before = await snapshot();
        const currentOwner = await first(
          'SELECT enabled FROM owners WHERE user_id=?',
          owner,
        );
        assert.equal(currentOwner?.enabled, 1);
        await db
          .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
          .bind(owner)
          .run();
        try {
          await error(await put(replayIntent), 403, 'OWNER_REQUIRED');
        } finally {
          await db
            .prepare('UPDATE owners SET enabled=? WHERE user_id=?')
            .bind(currentOwner.enabled, owner)
            .run();
        }
        assert.deepEqual(await snapshot(), before);

        await db
          .prepare('UPDATE owner_sessions SET expiresAt=0 WHERE id=?')
          .bind(expiredOwnerSessionId)
          .run();
        await error(
          await put(replayIntent, { Cookie: expiredOwnerCookie }),
          401,
          'AUTH_REQUIRED',
        );
        const revokedSessionAudit = await first(
          'SELECT event_id,actor_id,session_id,action FROM audit_events WHERE event_id=?',
          'revoke:' + expiredOwnerSessionId,
        );
        assert.deepEqual(revokedSessionAudit, {
          event_id: 'revoke:' + expiredOwnerSessionId,
          actor_id: owner,
          session_id: expiredOwnerSessionId,
          action: 'owner.session_revoked',
        });
        assert.deepEqual(await snapshot(), before);
        assert.deepEqual(
          await first(
            'SELECT id,expiresAt FROM owner_sessions WHERE id=?',
            ownerSessionId,
          ),
          initialOwnerSession,
          'the primary test session must remain unchanged',
        );

        const activeProject = await first(
          'SELECT status,revision FROM projects WHERE id=?',
          projectId,
        );
        assert.ok(
          !['archived', 'deleting', 'deleted'].includes(activeProject.status),
        );
        const archived = await send('PATCH', archivePath, {
          archived: true,
          expectedRevision: activeProject.revision,
          requestId: randomUUID(),
        });
        assert.equal(archived.status, 200, await archived.clone().text());
        assert.equal((await archived.json()).project.status, 'archived');

        const afterArchive = await snapshot();
        await error(await readVersioning(), 409, 'RESOURCE_NOT_EDITABLE');
        await error(await put(replayIntent), 409, 'RESOURCE_NOT_EDITABLE');
        assert.deepEqual(
          await snapshot(),
          afterArchive,
          'archived scope must deny GET and historical retry without another result or audit',
        );

        const archivedProject = await first(
          'SELECT revision FROM projects WHERE id=?',
          projectId,
        );
        const restored = await send('PATCH', archivePath, {
          archived: false,
          expectedRevision: archivedProject.revision,
          requestId: randomUUID(),
        });
        assert.equal(restored.status, 200, await restored.clone().text());
        assert.notEqual((await restored.json()).project.status, 'archived');
        const afterRestore = await readVersioning();
        assert.equal(
          afterRestore.status,
          200,
          await afterRestore.clone().text(),
        );
      },
    );
  } finally {
    await db
      .prepare('UPDATE owners SET enabled=? WHERE user_id=?')
      .bind(initialOwner.enabled, owner)
      .run();

    const currentProject = await first(
      'SELECT status,revision,name FROM projects WHERE id=?',
      projectId,
    );
    if (currentProject?.status === 'archived') {
      const restored = await send('PATCH', archivePath, {
        archived: false,
        expectedRevision: currentProject.revision,
        requestId: randomUUID(),
      });
      assert.equal(restored.status, 200, await restored.clone().text());
    }

    const currentVersioning = await readVersioning();
    if (currentVersioning.status === 200) {
      const value = await currentVersioning.json();
      if (value.mode !== 'manual') {
        const restored = await put(write(value.revision, 'manual'));
        assert.equal(restored.status, 200, await restored.clone().text());
      }
    }

    const afterModeRestore = await first(
      'SELECT name,revision FROM projects WHERE id=?',
      projectId,
    );
    if (afterModeRestore?.name !== initialProject.name) {
      const renamed = await rename(
        initialProject.name,
        afterModeRestore.revision,
        randomUUID(),
      );
      assert.equal(renamed.status, 200, await renamed.clone().text());
    }
  }

  const finalProject = await first(
    'SELECT status,versioning_mode FROM projects WHERE id=?',
    projectId,
  );
  const finalOwner = await first(
    'SELECT enabled FROM owners WHERE user_id=?',
    owner,
  );
  assert.ok(finalProject);
  assert.ok(!['archived', 'deleting', 'deleted'].includes(finalProject.status));
  assert.equal(finalProject.versioning_mode, 'manual');
  assert.equal(finalOwner?.enabled, 1);
}
