import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const guestSessionHash = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');

export async function selectionPolicyConfigurationChecks({
  mf,
  db,
  check,
  owner,
  cookies,
  base,
  galleryFixture,
  request,
}) {
  const worker = await mf.getWorker('guest-feedback-test');
  const workspaceId = galleryFixture.context.workspace.id;
  const ownerHeaders = {
    Cookie: cookies.headers(),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const send = (method, path, body, target = worker) =>
    target.fetch(
      new Request(new URL(path, base), {
        method,
        headers: ownerHeaders,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const expectCode = async (response, status, code) => {
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  };
  const projectPath = (projectId) =>
    '/api/v1/projects/' + projectId + '/selection-policy-configuration';
  const albumPath = (albumId) =>
    '/api/v1/albums/' + albumId + '/selection-policy-configuration';

  const projectCreateRequestId = randomUUID();
  const createdProject = await request('/api/v1/projects', {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({
      workspaceId,
      name: 'M2m3 policy configuration fixture',
      requestId: projectCreateRequestId,
    }),
  });
  assert.equal(createdProject.status, 201);
  const projectId = (await createdProject.json()).project.id;
  const createAlbum = async (name) => {
    const albumId = randomUUID();
    await db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(albumId, workspaceId, projectId, name)
      .run();
    return albumId;
  };
  const mainAlbumId = await createAlbum('M2m3 inherited and override fixture');
  const capAlbumId = await createAlbum('M2m3 inherited cap fixture');

  const projectGet = async () =>
    worker.fetch(
      new Request(new URL(projectPath(projectId), base), {
        headers: { Cookie: cookies.headers() },
      }),
    );
  const albumGet = async (albumId) =>
    worker.fetch(
      new Request(new URL(albumPath(albumId), base), {
        headers: { Cookie: cookies.headers() },
      }),
    );
  const putProject = (body) => send('PUT', projectPath(projectId), body);
  const putAlbum = (albumId, body) => send('PUT', albumPath(albumId), body);
  const projectBody = (requestId, expectedRevision, minimum, maximum) => ({
    requestId,
    expectedRevision,
    minimum,
    maximum,
    confirm: true,
  });
  const albumOverrideBody = (
    requestId,
    expectedAlbumRevision,
    expectedProjectRevision,
    minimum,
    maximum,
  ) => ({
    requestId,
    expectedAlbumRevision,
    expectedProjectRevision,
    configuration: 'override',
    minimum,
    maximum,
    confirm: true,
  });
  const albumInheritBody = (
    requestId,
    expectedAlbumRevision,
    expectedProjectRevision,
  ) => ({
    requestId,
    expectedAlbumRevision,
    expectedProjectRevision,
    configuration: 'inherit',
    confirm: true,
  });

  await check(
    'M2m3 project defaults, source epochs, overrides, replay, and reset are durable',
    async () => {
      let response = await projectGet();
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        projectId,
        minimum: 1,
        maximum: null,
        revision: 0,
        maxOpenSelectedCount: 0,
      });
      response = await albumGet(mainAlbumId);
      assert.equal(response.status, 200);
      const initialAlbum = await response.json();
      assert.equal(initialAlbum.configuration, 'inherit');
      assert.deepEqual(initialAlbum.policy, {
        minimum: 1,
        maximum: null,
        mode: 'private',
        source: 'system',
        projectRevision: 0,
        albumRevision: 0,
      });
      assert.equal(initialAlbum.maxOpenSelectedCount, 0);

      const firstProjectRequestId = randomUUID();
      const firstProjectBody = projectBody(firstProjectRequestId, 0, 1, 3);
      const firstProjectResponse = await putProject(firstProjectBody);
      assert.equal(firstProjectResponse.status, 200);
      const firstProjectResult = await firstProjectResponse.json();
      assert.deepEqual(firstProjectResult.configuration, {
        projectId,
        minimum: 1,
        maximum: 3,
        revision: 1,
      });
      assert.ok(firstProjectResult.eventId);
      response = await albumGet(mainAlbumId);
      const inheritedProject = await response.json();
      assert.equal(inheritedProject.policy.source, 'project');
      assert.equal(inheritedProject.policy.projectRevision, 1);
      assert.equal(inheritedProject.policy.albumRevision, 0);
      assert.equal(inheritedProject.policy.maximum, 3);

      const sourceChangeRequestId = randomUUID();
      const sourceChange = await putAlbum(
        mainAlbumId,
        albumOverrideBody(sourceChangeRequestId, 0, 1, 1, 3),
      );
      assert.equal(sourceChange.status, 200);
      const sourceChangeResult = await sourceChange.json();
      assert.equal(sourceChangeResult.configuration.configuration, 'override');
      assert.equal(sourceChangeResult.configuration.policy.source, 'album');
      assert.equal(sourceChangeResult.configuration.policy.albumRevision, 1);
      assert.ok(sourceChangeResult.eventId);

      const secondProjectRequestId = randomUUID();
      const secondProjectBody = projectBody(secondProjectRequestId, 1, 2, 4);
      const secondProjectResponse = await putProject(secondProjectBody);
      assert.equal(secondProjectResponse.status, 200);
      const secondProjectResult = await secondProjectResponse.json();
      assert.deepEqual(secondProjectResult.configuration, {
        projectId,
        minimum: 2,
        maximum: 4,
        revision: 2,
      });
      response = await albumGet(mainAlbumId);
      const explicitAlbum = await response.json();
      assert.equal(explicitAlbum.policy.source, 'album');
      assert.equal(explicitAlbum.policy.minimum, 1);
      assert.equal(explicitAlbum.policy.maximum, 3);
      assert.equal(explicitAlbum.policy.projectRevision, 2);
      assert.equal(explicitAlbum.policy.albumRevision, 1);

      const exactProjectReplay = await putProject(secondProjectBody);
      assert.equal(exactProjectReplay.status, 200);
      assert.deepEqual(await exactProjectReplay.json(), secondProjectResult);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_configuration_changed' AND request_id=?",
            )
            .bind(secondProjectRequestId)
            .first()
        ).n,
        1,
      );

      const resetRequestId = randomUUID();
      const resetResponse = await putAlbum(
        mainAlbumId,
        albumInheritBody(resetRequestId, 1, 2),
      );
      assert.equal(resetResponse.status, 200);
      const resetResult = await resetResponse.json();
      assert.equal(resetResult.configuration.configuration, 'inherit');
      assert.equal(resetResult.configuration.policy.source, 'project');
      assert.equal(resetResult.configuration.policy.minimum, 2);
      assert.equal(resetResult.configuration.policy.maximum, 4);
      assert.equal(resetResult.configuration.policy.albumRevision, 2);
      assert.ok(resetResult.eventId);

      const replayAfterChange = await putProject(firstProjectBody);
      assert.equal(replayAfterChange.status, 200);
      assert.deepEqual(await replayAfterChange.json(), firstProjectResult);
      assert.equal((await (await projectGet()).json()).revision, 2);

      await expectCode(
        await putProject(projectBody(projectCreateRequestId, 0, 1, 3)),
        409,
        'REQUEST_ID_CONFLICT',
      );
      const reverseNamespace = await request('/api/v1/projects', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          workspaceId,
          name: 'M2m3 namespace collision',
          requestId: firstProjectRequestId,
        }),
      });
      await expectCode(reverseNamespace, 409, 'REQUEST_ID_CONFLICT');
    },
  );

  const capPhotos = [];
  const capPhotoStatements = [];
  for (let index = 0; index < 2; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    capPhotos.push({ photoId, versionId });
    capPhotoStatements.push(
      db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          photoId,
          workspaceId,
          projectId,
          capAlbumId,
          'm2m3-cap-' + (index + 1) + '.jpg',
        ),
      db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
        )
        .bind(
          versionId,
          workspaceId,
          photoId,
          owner,
          randomBytes(32).toString('hex'),
        ),
    );
  }
  await db.batch(capPhotoStatements);

  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession);
  const inviteId = randomUUID();
  const tokenHash = createHash('sha256')
    .update('kino-pic:m2m3-policy-fixture:' + randomBytes(32).toString('hex'))
    .digest('hex');
  const expiresAt = Date.now() + 3600000;
  await db
    .prepare(
      "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',520,?,NULL,?,?)",
    )
    .bind(
      inviteId,
      workspaceId,
      projectId,
      tokenHash,
      expiresAt,
      owner,
      ownerSession.id,
    )
    .run();
  await db
    .prepare(
      'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    )
    .bind(inviteId, workspaceId, projectId, capAlbumId)
    .run();
  await db
    .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
    .bind(inviteId)
    .run();
  const guestId = randomUUID();
  await db
    .prepare(
      'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
    )
    .bind(guestId, inviteId, 'M2m3 policy fixture')
    .run();
  const guestSecret = randomBytes(32).toString('hex');
  const guestSessionId = randomUUID();
  await db
    .prepare(
      'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
    )
    .bind(
      guestSessionId,
      inviteId,
      guestId,
      guestSessionHash(guestSecret),
      Date.now() + 1800000,
    )
    .run();
  const guestRequest = (path, body) =>
    worker.fetch(
      new Request(new URL(path, base), {
        method: 'PUT',
        headers: {
          Cookie: 'kino_guest=' + guestSecret,
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
  const capSelectionPath = (photoId) =>
    '/api/guest/albums/' + capAlbumId + '/photos/' + photoId + '/selection';

  await check(
    'Project cap lowering checks only inheriting drafts; album reset checks its own open draft',
    async () => {
      const projectBefore = await (await projectGet()).json();
      assert.equal(projectBefore.maximum, 4);
      for (const photo of capPhotos) {
        const response = await guestRequest(capSelectionPath(photo.photoId), {
          requestId: randomUUID(),
          versionId: photo.versionId,
          selected: true,
        });
        assert.equal(response.status, 200);
      }

      const lowerProjectRequestId = randomUUID();
      await expectCode(
        await putProject(
          projectBody(lowerProjectRequestId, projectBefore.revision, 1, 1),
        ),
        409,
        'SELECTION_POLICY_BELOW_CURRENT',
      );
      assert.equal((await (await projectGet()).json()).revision, 2);

      const overrideRequestId = randomUUID();
      const overrideResponse = await putAlbum(
        capAlbumId,
        albumOverrideBody(overrideRequestId, 0, projectBefore.revision, 1, 3),
      );
      assert.equal(overrideResponse.status, 200);
      const overrideResult = await overrideResponse.json();
      assert.equal(overrideResult.configuration.policy.source, 'album');
      assert.equal(overrideResult.configuration.policy.albumRevision, 1);

      const loweredProject = await putProject(
        projectBody(lowerProjectRequestId, projectBefore.revision, 1, 1),
      );
      assert.equal(loweredProject.status, 200);
      const loweredProjectResult = await loweredProject.json();
      assert.equal(loweredProjectResult.configuration.revision, 3);

      const resetUnderCapRequestId = randomUUID();
      const auditCountBeforeReset = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_configuration_changed' AND request_id=?",
          )
          .bind(resetUnderCapRequestId)
          .first()
      ).n;
      await expectCode(
        await putAlbum(
          capAlbumId,
          albumInheritBody(resetUnderCapRequestId, 1, 3),
        ),
        409,
        'SELECTION_POLICY_BELOW_CURRENT',
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT configuration,revision FROM album_selection_policy_configurations WHERE album_id=?',
            )
            .bind(capAlbumId)
            .first()
        ).configuration,
        'override',
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_configuration_changed' AND request_id=?",
            )
            .bind(resetUnderCapRequestId)
            .first()
        ).n,
        auditCountBeforeReset,
      );

      const albumLowerRequestId = randomUUID();
      await expectCode(
        await putAlbum(
          capAlbumId,
          albumOverrideBody(albumLowerRequestId, 1, 3, 1, 1),
        ),
        409,
        'SELECTION_POLICY_BELOW_CURRENT',
      );
    },
  );

  await check(
    'Configuration ledger enforces concurrent CAS, atomic audit rollback, and immutable witnesses',
    async () => {
      const current = await (await projectGet()).json();
      const races = await Promise.all([
        putProject(projectBody(randomUUID(), current.revision, 1, 6)),
        putProject(projectBody(randomUUID(), current.revision, 1, 7)),
      ]);
      assert.deepEqual(
        races.map((response) => response.status).sort(),
        [200, 409],
      );
      const rejected = races.find((response) => response.status === 409);
      assert.ok(rejected);
      await expectCode(rejected, 409, 'SELECTION_POLICY_REVISION_CONFLICT');

      const stateBefore = await db
        .prepare(
          'SELECT minimum,maximum,revision,last_command_id FROM project_selection_policy_configurations WHERE project_id=?',
        )
        .bind(projectId)
        .first();
      const rollbackRequestId = randomUUID();
      await db
        .prepare(
          "CREATE TRIGGER m2m3_test_reject_policy_audit BEFORE INSERT ON audit_events WHEN NEW.action='selection.policy_configuration_changed' BEGIN SELECT RAISE(ABORT,'M2M3_TEST_AUDIT_REJECTED'); END",
        )
        .run();
      try {
        const rejectedAudit = await putProject(
          projectBody(
            rollbackRequestId,
            stateBefore.revision,
            1,
            stateBefore.maximum === 8 ? 9 : 8,
          ),
        );
        await expectCode(
          rejectedAudit,
          503,
          'SELECTION_POLICY_CONFIGURATION_UNAVAILABLE',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM selection_policy_configuration_commands WHERE actor_id=? AND request_id=?',
              )
              .bind(owner, rollbackRequestId)
              .first()
          ).n,
          0,
        );
        const stateAfter = await db
          .prepare(
            'SELECT minimum,maximum,revision,last_command_id FROM project_selection_policy_configurations WHERE project_id=?',
          )
          .bind(projectId)
          .first();
        assert.deepEqual(stateAfter, stateBefore);
      } finally {
        await db.prepare('DROP TRIGGER m2m3_test_reject_policy_audit').run();
      }

      await assert.rejects(
        db
          .prepare(
            'UPDATE project_selection_policy_configurations SET minimum=minimum+1 WHERE project_id=?',
          )
          .bind(projectId)
          .run(),
        /INVALID_SELECTION_POLICY_CONFIGURATION_WITNESS/u,
      );
      const immutableCommandId = stateBefore.last_command_id;
      const resultBeforeReplace = await db
        .prepare(
          'SELECT * FROM selection_policy_configuration_results WHERE command_id=?',
        )
        .bind(immutableCommandId)
        .first();
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO selection_policy_configuration_results SELECT * FROM selection_policy_configuration_results WHERE command_id=?',
          )
          .bind(immutableCommandId)
          .run(),
        /IMMUTABLE_SELECTION_POLICY_CONFIGURATION_RESULT/u,
      );
      assert.deepEqual(
        await db
          .prepare(
            'SELECT * FROM selection_policy_configuration_results WHERE command_id=?',
          )
          .bind(immutableCommandId)
          .first(),
        resultBeforeReplace,
      );
      const auditBeforeReplace = await db
        .prepare('SELECT * FROM audit_events WHERE event_id=?')
        .bind(resultBeforeReplace.event_id)
        .first();
      assert.ok(auditBeforeReplace);
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO audit_events SELECT * FROM audit_events WHERE event_id=?',
          )
          .bind(resultBeforeReplace.event_id)
          .run(),
        /APPEND_ONLY_AUDIT/u,
      );
      assert.deepEqual(
        await db
          .prepare('SELECT * FROM audit_events WHERE event_id=?')
          .bind(resultBeforeReplace.event_id)
          .first(),
        auditBeforeReplace,
      );

      await assert.rejects(
        db
          .prepare(
            'UPDATE selection_policy_configuration_commands SET minimum=minimum+1 WHERE id=?',
          )
          .bind(immutableCommandId)
          .run(),
        /IMMUTABLE_SELECTION_POLICY_CONFIGURATION_COMMAND/u,
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM project_selection_policy_configurations WHERE project_id=?',
          )
          .bind(projectId)
          .run(),
        /IMMUTABLE_SELECTION_POLICY_CONFIGURATION_STATE/u,
      );

      const currentProject = await (await projectGet()).json();
      const crossRequestId = randomUUID();
      const canonicalProjectPayload = JSON.stringify({
        projectId,
        expectedRevision: currentProject.revision,
        minimum: currentProject.minimum,
        maximum: currentProject.maximum,
        confirm: true,
      });
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO selection_policy_configuration_commands(id,actor_id,session_id,request_id,target_type,workspace_id,project_id,album_id,expected_project_revision,expected_album_revision,configuration,minimum,maximum,payload_json,legacy_payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            owner,
            ownerSession.id,
            crossRequestId,
            'project',
            workspaceId,
            projectId,
            null,
            currentProject.revision,
            null,
            null,
            currentProject.minimum,
            currentProject.maximum,
            canonicalProjectPayload,
            JSON.stringify({ albumId: capAlbumId, expectedRevision: 0 }),
            Date.now(),
          )
          .run(),
        /CHECK constraint failed/u,
      );
      const malformedPayloadRequestId = randomUUID();
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO selection_policy_configuration_commands(id,actor_id,session_id,request_id,target_type,workspace_id,project_id,album_id,expected_project_revision,expected_album_revision,configuration,minimum,maximum,payload_json,legacy_payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            owner,
            ownerSession.id,
            malformedPayloadRequestId,
            'project',
            workspaceId,
            projectId,
            null,
            currentProject.revision,
            null,
            null,
            currentProject.minimum,
            currentProject.maximum,
            null,
            null,
            Date.now(),
          )
          .run(),
        /NOT NULL constraint failed/u,
      );
      for (const requestId of [crossRequestId, malformedPayloadRequestId]) {
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM selection_policy_configuration_commands WHERE actor_id=? AND request_id=?',
              )
              .bind(owner, requestId)
              .first()
          ).n,
          0,
        );
      }
    },
  );

  await check(
    'Legacy selection-policy adapter replays exact intent only while album and parent remain writable',
    async () => {
      const legacyProjectCreate = await request('/api/v1/projects', {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({
          workspaceId,
          name: 'M2m3 legacy replay fixture',
          requestId: randomUUID(),
        }),
      });
      assert.equal(legacyProjectCreate.status, 201);
      const legacyProjectId = (await legacyProjectCreate.json()).project.id;
      const legacyAlbumCreate = await request(
        '/api/v1/projects/' + legacyProjectId + '/albums',
        {
          method: 'POST',
          headers: ownerHeaders,
          body: JSON.stringify({
            name: 'M2m3 legacy replay album',
            requestId: randomUUID(),
          }),
        },
      );
      assert.equal(legacyAlbumCreate.status, 201);
      const legacyAlbumId = (await legacyAlbumCreate.json()).album.id;
      const legacyRequestId = randomUUID();
      const legacyBody = {
        requestId: legacyRequestId,
        expectedRevision: 0,
        minimum: 2,
        maximum: 5,
        confirm: true,
      };
      const oldPath = '/api/v1/albums/' + legacyAlbumId + '/selection-policy';
      const first = await send('PUT', oldPath, legacyBody);
      assert.equal(first.status, 200);
      const firstResult = await first.json();
      const exactReplay = await send('PUT', oldPath, legacyBody);
      assert.equal(exactReplay.status, 200);
      assert.deepEqual(await exactReplay.json(), firstResult);

      const archive = await request(
        '/api/v1/albums/' + legacyAlbumId + '/archive',
        {
          method: 'PATCH',
          headers: ownerHeaders,
          body: JSON.stringify({
            archived: true,
            expectedRevision: 1,
            requestId: randomUUID(),
          }),
        },
      );
      assert.equal(archive.status, 200);
      await expectCode(
        await send('PUT', oldPath, legacyBody),
        409,
        'RESOURCE_NOT_EDITABLE',
      );
    },
  );
}
