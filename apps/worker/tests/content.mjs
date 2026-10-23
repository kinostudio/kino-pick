import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function contentChecks({
  check,
  request,
  db,
  cookies,
  owner,
  base,
  workspace,
  workspaceRequestId,
}) {
  const headers = {
    Cookie: cookies.headers(),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const send = (method, path, body, origin = base) =>
    request(path, {
      method,
      headers: { ...headers, Origin: origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const createProject = (
    name,
    requestId = randomUUID(),
    workspaceId = workspace.id,
  ) => send('POST', '/api/v1/projects', { workspaceId, name, requestId });
  let project, album, projectNameReq, albumNameReq;
  await check(
    'D1 shared command namespace protects workspace and project operation IDs; project create/list/get are tenant scoped',
    async () => {
      assert.equal(
        (await createProject('cross op', workspaceRequestId)).status,
        409,
      );
      const projectRequestId = randomUUID();
      const projectReplies = await Promise.all(
        Array.from({ length: 4 }, () =>
          createProject('  portrait set  ', projectRequestId),
        ),
      );
      for (const reply of projectReplies) assert.equal(reply.status, 201);
      const projectBodies = await Promise.all(
        projectReplies.map((reply) => reply.json()),
      );
      project = projectBodies[0].project;
      for (const body of projectBodies) assert.deepEqual(body.project, project);
      let r;
      assert.equal(project.workspaceId, workspace.id);
      assert.equal(project.name, 'portrait set');
      assert.equal(project.status, 'draft');
      assert.equal(project.versioningMode, 'manual');
      assert.equal(project.revision, 1);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='project.created' AND request_id=?",
            )
            .bind(projectRequestId)
            .first()
        ).n,
        1,
      );
      r = await send('GET', '/api/v1/projects/' + project.id);
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).project, project);
      r = await send('GET', '/api/v1/projects?workspaceId=' + workspace.id);
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).projects, [project]);
      const outsider = '88888888-8888-4888-8888-888888888888';
      await db
        .prepare(
          "INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,'Other','other@fixture.invalid',1,unixepoch()*1000,unixepoch()*1000)",
        )
        .bind(outsider)
        .run();
      const otherWorkspace = '77777777-7777-4777-8777-777777777777';
      await db
        .prepare(
          "INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,'Other tenant',?)",
        )
        .bind(otherWorkspace, outsider)
        .run();
      assert.equal(
        (await createProject('IDOR', randomUUID(), otherWorkspace)).status,
        404,
      );
      assert.equal(
        (await send('GET', '/api/v1/projects?workspaceId=' + otherWorkspace))
          .status,
        404,
      );
      assert.equal(
        (await send('GET', '/api/v1/projects/' + outsider)).status,
        404,
      );
    },
  );
  await check(
    'D1 project audit failure rolls back project and shared request row',
    async () => {
      const req = randomUUID();
      await db.exec(
        "CREATE TRIGGER fail_project_audit BEFORE INSERT ON audit_events WHEN NEW.action='project.created' BEGIN SELECT RAISE(ABORT,'PROJECT_AUDIT_INJECTED'); END;",
      );
      try {
        assert.equal(
          (await createProject('rollback project', req)).status,
          503,
        );
        assert.equal(
          await db
            .prepare("SELECT id FROM projects WHERE name='rollback project'")
            .first(),
          null,
        );
        assert.equal(
          await db
            .prepare(
              'SELECT request_id FROM request_commands WHERE request_id=?',
            )
            .bind(req)
            .first(),
          null,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_project_audit');
      }
      assert.equal((await createProject('rollback project', req)).status, 201);
    },
  );
  await check(
    'D1 project rename uses revision CAS, shared replay and before/after append-only audit',
    async () => {
      projectNameReq = randomUUID();
      let r = await send('PATCH', '/api/v1/projects/' + project.id, {
        name: 'portrait final',
        expectedRevision: 1,
        requestId: projectNameReq,
      });
      assert.equal(r.status, 200);
      const renamed = (await r.json()).project;
      assert.equal(renamed.name, 'portrait final');
      assert.equal(renamed.revision, 2);
      r = await send('PATCH', '/api/v1/projects/' + project.id, {
        name: 'portrait final',
        expectedRevision: 1,
        requestId: projectNameReq,
      });
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).project, renamed);
      assert.equal(
        (
          await send('PATCH', '/api/v1/projects/' + project.id, {
            name: 'lost update',
            expectedRevision: 1,
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      const audit = await db
        .prepare(
          "SELECT * FROM audit_events WHERE action='project.renamed' AND request_id=?",
        )
        .bind(projectNameReq)
        .first();
      assert.deepEqual(JSON.parse(audit.before_json), project);
      assert.deepEqual(JSON.parse(audit.after_json), renamed);
      assert.equal(audit.actor_id, owner);
      assert.match(audit.occurred_at_utc, /Z$/);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='project.renamed' AND request_id=?",
            )
            .bind(projectNameReq)
            .first()
        ).n,
        1,
      );
      await assert.rejects(
        db
          .prepare("UPDATE audit_events SET after_json='{}' WHERE request_id=?")
          .bind(projectNameReq)
          .run(),
        /APPEND_ONLY_AUDIT/,
      );
    },
  );
  await check(
    'D1 album create and scoped listing keep strict parent IDs and retry semantics',
    async () => {
      const requestId = randomUUID();
      let r = await send('POST', '/api/v1/projects/' + project.id + '/albums', {
        name: 'selects',
        requestId,
      });
      assert.equal(r.status, 201);
      album = (await r.json()).album;
      assert.equal(album.projectId, project.id);
      assert.equal(album.workspaceId, workspace.id);
      assert.equal(album.revision, 1);
      assert.equal(album.isPinned, false);
      assert.equal(album.legalHold, false);
      r = await send('POST', '/api/v1/projects/' + project.id + '/albums', {
        name: 'selects',
        requestId,
      });
      assert.equal(r.status, 201);
      assert.deepEqual((await r.json()).album, album);
      r = await send('GET', '/api/v1/projects/' + project.id + '/albums');
      assert.equal(r.status, 200);
      assert.deepEqual((await r.json()).albums, [album]);
      assert.equal(
        (
          await send('POST', '/api/v1/projects/' + project.id + '/albums', {
            name: 'x',
            requestId,
            projectId: '00000000-0000-4000-8000-000000000001',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await send(
            'POST',
            '/api/v1/projects/' + project.id + '/albums',
            { name: 'wrong origin', requestId: randomUUID() },
            'https://attacker.invalid',
          )
        ).status,
        403,
      );
    },
  );
  await check(
    'D1 content schema blocks tenant reparenting and cross-project photo catalog rows',
    async () => {
      const otherProject = (
        await (await createProject('separate album parent')).json()
      ).project;
      const otherAlbum = (
        await (
          await send(
            'POST',
            '/api/v1/projects/' + otherProject.id + '/albums',
            { name: 'separate album', requestId: randomUUID() },
          )
        ).json()
      ).album;
      await assert.rejects(
        db
          .prepare('UPDATE projects SET workspace_id=? WHERE id=?')
          .bind('77777777-7777-4777-8777-777777777777', project.id)
          .run(),
        /IMMUTABLE_PARENT/,
      );
      await assert.rejects(
        db
          .prepare('UPDATE albums SET project_id=? WHERE id=?')
          .bind(otherProject.id, album.id)
          .run(),
        /IMMUTABLE_PARENT/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            workspace.id,
            project.id,
            otherAlbum.id,
            'wrong-parent.jpg',
          )
          .run(),
        /IMMUTABLE_PARENT/,
      );
    },
  );
  await check(
    'D1 album rename and protection enforce confirmation, current revision and immutable parent',
    async () => {
      albumNameReq = randomUUID();
      let r = await send('PATCH', '/api/v1/albums/' + album.id, {
        name: 'client selects',
        expectedRevision: 1,
        requestId: albumNameReq,
      });
      assert.equal(r.status, 200);
      album = (await r.json()).album;
      assert.equal(album.revision, 2);
      r = await send('PATCH', '/api/v1/albums/' + album.id + '/protection', {
        isPinned: true,
        legalHold: true,
        confirmUnprotect: false,
        expectedRevision: 2,
        requestId: randomUUID(),
      });
      assert.equal(r.status, 200);
      album = (await r.json()).album;
      assert.equal(album.isPinned, true);
      assert.equal(album.legalHold, true);
      assert.equal(album.revision, 3);
      r = await send('PATCH', '/api/v1/albums/' + album.id + '/protection', {
        isPinned: false,
        legalHold: false,
        confirmUnprotect: false,
        expectedRevision: 3,
        requestId: randomUUID(),
      });
      assert.equal(r.status, 409);
      assert.equal(
        (await r.json()).error.code,
        'PROTECTION_CONFIRMATION_REQUIRED',
      );
      r = await send('PATCH', '/api/v1/albums/' + album.id + '/protection', {
        isPinned: false,
        legalHold: false,
        confirmUnprotect: true,
        expectedRevision: 2,
        requestId: randomUUID(),
      });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error.code, 'CONCURRENT_MODIFICATION');
      await assert.rejects(
        db
          .prepare('UPDATE albums SET project_id=? WHERE id=?')
          .bind('00000000-0000-4000-8000-000000000001', album.id)
          .run(),
      );
    },
  );
  await check(
    'D1 empty archive/restore preserves origin and protections; nonempty parents cannot archive',
    async () => {
      const emptyProject = (await (await createProject('empty project')).json())
        .project;
      let r = await send(
        'PATCH',
        '/api/v1/projects/' + emptyProject.id + '/archive',
        { archived: true, expectedRevision: 1, requestId: randomUUID() },
      );
      assert.equal(r.status, 200);
      let archived = (await r.json()).project;
      assert.equal(archived.status, 'archived');
      assert.equal(archived.revision, 2);
      assert.equal(
        (
          await send('PATCH', '/api/v1/projects/' + emptyProject.id, {
            name: 'no edit',
            expectedRevision: 2,
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      r = await send(
        'PATCH',
        '/api/v1/projects/' + emptyProject.id + '/archive',
        { archived: false, expectedRevision: 2, requestId: randomUUID() },
      );
      assert.equal(r.status, 200);
      assert.equal((await r.json()).project.status, 'draft');
      const p2 = (await (await createProject('album archiver')).json()).project;
      const a2 = (
        await (
          await send('POST', '/api/v1/projects/' + p2.id + '/albums', {
            name: 'empty album',
            requestId: randomUUID(),
          })
        ).json()
      ).album;
      r = await send('PATCH', '/api/v1/albums/' + a2.id + '/archive', {
        archived: true,
        expectedRevision: 1,
        requestId: randomUUID(),
      });
      assert.equal(r.status, 200);
      let aArchived = (await r.json()).album;
      assert.equal(aArchived.state, 'archived');
      r = await send('PATCH', '/api/v1/albums/' + a2.id + '/archive', {
        archived: false,
        expectedRevision: 2,
        requestId: randomUUID(),
      });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).album.state, 'draft');
      assert.equal(
        (
          await send('PATCH', '/api/v1/projects/' + project.id + '/archive', {
            archived: true,
            expectedRevision: 2,
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
      const photoId = randomUUID();
      await db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(photoId, workspace.id, project.id, album.id, 'fixture.jpg')
        .run();
      assert.equal(
        (
          await send('PATCH', '/api/v1/albums/' + album.id + '/archive', {
            archived: true,
            expectedRevision: 3,
            requestId: randomUUID(),
          })
        ).status,
        409,
      );
    },
  );
}
