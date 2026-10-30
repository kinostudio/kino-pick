import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

export async function resolvedUploadChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  const worker = await mf.getWorker('resolved-uploads-test');
  const ownerCookie = cookies.headers();
  const headers = {
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
  };
  const send = (method, path, body, overrides = {}) => {
    const init = { method, headers: { ...headers, ...overrides } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return worker.fetch(new Request(new URL(path, base), init));
  };
  const defaultSend = (method, path, body, overrides = {}) => {
    const init = { method, headers: { ...headers, ...overrides } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return request(path, init);
  };
  const readJson = async (response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const expectCode = async (response, status, code) => {
    const body = await readJson(response);
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(body?.error?.code, code, JSON.stringify(body));
    return body;
  };
  const first = (sql, ...values) =>
    db
      .prepare(sql)
      .bind(...values)
      .first();
  // Needs-review uploads deliberately keep quota; isolate this acceptance
  // workspace from legacy/manual-upload fixtures that require no held work.
  const workspaceResponse = await send('POST', '/api/v1/workspaces', {
    requestId: randomUUID(),
    name: 'Resolved acceptance ' + randomUUID(),
  });
  assert.equal(
    workspaceResponse.status,
    201,
    await workspaceResponse.clone().text(),
  );
  const workspaceId = (await readJson(workspaceResponse)).workspace.id;
  const storage = galleryFixture.storage;
  const unissuedSessions = new Set();

  const usage = (id) =>
    first(
      'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
      id,
    );
  const albumSequence = async (albumId) =>
    (
      await first(
        'SELECT COALESCE(MAX(sequence),0) AS sequence FROM album_matching_changes WHERE album_id=?',
        albumId,
      )
    ).sequence;
  const albumSnapshot = async (album) => ({
    requests: (
      await first(
        'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND album_id=?',
        owner,
        album.id,
      )
    ).n,
    sessions: (
      await first(
        'SELECT count(*) AS n FROM upload_sessions WHERE actor_id=? AND album_id=?',
        owner,
        album.id,
      )
    ).n,
    audits: (
      await first(
        "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND album_id=? AND action='upload.reserved'",
        owner,
        album.id,
      )
    ).n,
    sequence: await albumSequence(album.id),
    usage: await usage(album.workspaceId),
  });
  const trackSession = (uploadSession) => {
    if (uploadSession?.id) unissuedSessions.add(uploadSession.id);
  };
  const forgetSession = (uploadSessionId) =>
    unissuedSessions.delete(uploadSessionId);
  const cancelUnissued = async (uploadSessionId) => {
    if (!unissuedSessions.has(uploadSessionId)) return;
    const response = await send(
      'POST',
      '/api/v1/uploads/' + uploadSessionId + '/cancel',
      { requestId: randomUUID() },
    );
    assert.equal(response.status, 200, await response.clone().text());
    unissuedSessions.delete(uploadSessionId);
  };
  const createProject = async (sendRequest, label) => {
    const response = await sendRequest('POST', '/api/v1/projects', {
      workspaceId,
      name: 'Resolved upload ' + label + ' ' + randomUUID(),
      requestId: randomUUID(),
    });
    assert.equal(response.status, 201, await response.clone().text());
    return (await readJson(response)).project;
  };
  const createAlbum = async (projectId, label) => {
    const response = await send(
      'POST',
      '/api/v1/projects/' + projectId + '/albums',
      {
        name: 'Resolved album ' + label + ' ' + randomUUID(),
        requestId: randomUUID(),
      },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await readJson(response)).album;
  };
  const createConfiguredProject = async (mode = 'auto_filename') => {
    const project = await createProject(send, mode);
    const settingsPath = '/api/v1/projects/' + project.id + '/versioning';
    const initialResponse = await send('GET', settingsPath);
    assert.equal(
      initialResponse.status,
      200,
      await initialResponse.clone().text(),
    );
    const initial = await readJson(initialResponse);
    assert.deepEqual(initial.availableModes, [
      'off',
      'manual',
      'auto_filename',
      'assisted',
    ]);
    const update = await send('PUT', settingsPath, {
      requestId: randomUUID(),
      expectedRevision: initial.revision,
      mode,
      confirm: true,
    });
    assert.equal(update.status, 200, await update.clone().text());
    const changed = await readJson(update);
    assert.equal(changed.mode, mode);
    assert.equal(changed.changed, true);
    assert.ok(changed.eventId);
    const currentResponse = await send('GET', settingsPath);
    assert.equal(
      currentResponse.status,
      200,
      await currentResponse.clone().text(),
    );
    const current = await readJson(currentResponse);
    assert.equal(current.mode, mode);
    assert.deepEqual(current.availableModes, [
      'off',
      'manual',
      'auto_filename',
      'assisted',
    ]);
    return { project, initial, current };
  };
  const makePng = (width, height, background) =>
    sharp({
      create: { width, height, channels: 3, background },
    })
      .png()
      .toBuffer();
  const evidence = async (originalFilename, bytes, declaredDimensions) => {
    const metadata = await sharp(bytes).metadata();
    return {
      originalFilename,
      expectedBytes: bytes.byteLength,
      contentType: 'image/png',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      dimensions: declaredDimensions ?? {
        width: metadata.width,
        height: metadata.height,
      },
    };
  };
  const preview = async (albumId, file) => {
    const response = await send(
      'POST',
      '/api/v1/albums/' + albumId + '/upload-resolution',
      { file },
    );
    assert.equal(response.status, 200, await response.clone().text());
    return readJson(response);
  };
  const reserveBody = (file, snapshot, choice, requestId = randomUUID()) => ({
    requestId,
    file,
    expectedChangeSequence: snapshot.changeSequence,
    expectedProjectRevision: snapshot.projectRevision,
    expectedMode: snapshot.mode,
    choice,
    confirm: true,
  });
  const createPendingUpload = async (album, project, file) => {
    const response = await send('POST', '/api/v1/uploads/init', {
      workspaceId: project.workspaceId,
      projectId: project.id,
      albumId: album.id,
      originalFilename: file.originalFilename,
      expectedBytes: file.expectedBytes,
      contentType: file.contentType,
      sha256: file.sha256,
      requestId: randomUUID(),
    });
    assert.equal(response.status, 201, await response.clone().text());
    const uploadSession = (await readJson(response)).uploadSession;
    trackSession(uploadSession);
    return uploadSession;
  };
  const authorizeAndPut = async (uploadSessionId, bytes, sha256) => {
    const authorizationResponse = await send(
      'POST',
      '/api/v1/uploads/' + uploadSessionId + '/authorize',
      { requestId: randomUUID() },
    );
    assert.equal(
      authorizationResponse.status,
      200,
      await authorizationResponse.clone().text(),
    );
    const authorization = (await readJson(authorizationResponse))
      .uploadAuthorization;
    assert.equal(authorization.contentLength, bytes.byteLength);
    const keyRow = await first(
      'SELECT object_key FROM upload_sessions WHERE id=?',
      uploadSessionId,
    );
    assert.ok(keyRow?.object_key);
    forgetSession(uploadSessionId);
    const put = await storage.put(keyRow.object_key, new Uint8Array(bytes), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/png' },
      sha256: Buffer.from(sha256, 'hex'),
    });
    assert.ok(put);
    return keyRow.object_key;
  };
  const completeOrdinary = async (project, album, file, bytes) => {
    const init = await send('POST', '/api/v1/uploads/init', {
      workspaceId: project.workspaceId,
      projectId: project.id,
      albumId: album.id,
      originalFilename: file.originalFilename,
      expectedBytes: file.expectedBytes,
      contentType: file.contentType,
      sha256: file.sha256,
      requestId: randomUUID(),
    });
    assert.equal(init.status, 201, await init.clone().text());
    const uploadSession = (await readJson(init)).uploadSession;
    trackSession(uploadSession);
    await authorizeAndPut(uploadSession.id, bytes, file.sha256);
    const completed = await send(
      'POST',
      '/api/v1/uploads/' + uploadSession.id + '/complete',
      { requestId: randomUUID() },
    );
    assert.equal(completed.status, 200, await completed.clone().text());
    const completion = (await readJson(completed)).completion;
    assert.equal(completion.status, 'completed');
    return completion;
  };

  try {
    await check(
      'default application keeps upload resolution disabled and denies preview/reserve before any reservation write',
      async () => {
        const capability = await defaultSend(
          'GET',
          '/api/v1/upload-resolution/capabilities',
        );
        assert.equal(capability.status, 200, await capability.clone().text());
        assert.deepEqual(await readJson(capability), { enabled: false });

        const projectResponse = await defaultSend('POST', '/api/v1/projects', {
          workspaceId,
          name: 'Disabled resolved upload ' + randomUUID(),
          requestId: randomUUID(),
        });
        assert.equal(
          projectResponse.status,
          201,
          await projectResponse.clone().text(),
        );
        const project = (await readJson(projectResponse)).project;
        const albumResponse = await defaultSend(
          'POST',
          '/api/v1/projects/' + project.id + '/albums',
          { name: 'Disabled album ' + randomUUID(), requestId: randomUUID() },
        );
        assert.equal(
          albumResponse.status,
          201,
          await albumResponse.clone().text(),
        );
        const album = (await readJson(albumResponse)).album;
        const bytes = await makePng(48, 24, '#367ca4');
        const file = await evidence('disabled.png', bytes);
        const before = await albumSnapshot(album);

        await expectCode(
          await defaultSend(
            'POST',
            '/api/v1/albums/' + album.id + '/upload-resolution',
            { file },
          ),
          503,
          'RESOLUTION_UNAVAILABLE',
        );
        await expectCode(
          await defaultSend(
            'POST',
            '/api/v1/albums/' + album.id + '/resolved-uploads',
            reserveBody(
              file,
              {
                changeSequence: 0,
                projectRevision: project.revision,
                mode: 'auto_filename',
              },
              { kind: 'new_photo' },
            ),
          ),
          503,
          'RESOLUTION_UNAVAILABLE',
        );
        assert.deepEqual(await albumSnapshot(album), before);
      },
    );

    let configured;
    let foreignCandidateHead;
    await check(
      'matching-enabled Worker exposes four confirmed project modes',
      async () => {
        const capabilities = await send(
          'GET',
          '/api/v1/upload-resolution/capabilities',
        );
        assert.equal(
          capabilities.status,
          200,
          await capabilities.clone().text(),
        );
        assert.deepEqual(await readJson(capabilities), { enabled: true });
        configured = await createConfiguredProject();
      },
    );
    if (!configured) return;
    const { project } = configured;

    let replayAlbum;
    let replayBody;
    let replayReservation;
    await check(
      'empty enabled album previews a new photo, validates strict confirmation, reserves canonically, and replays one stable session',
      async () => {
        replayAlbum = await createAlbum(project.id, 'replay');
        const bytes = await makePng(48, 24, '#377fa1');
        const file = await evidence('replay.png', bytes);
        const current = await preview(replayAlbum.id, file);
        assert.equal(current.mode, 'auto_filename');
        assert.deepEqual(current.candidates, []);
        assert.equal(current.decision.outcome, 'new_photo');
        assert.equal(current.decision.photoId, null);
        assert.equal(current.decision.versionId, null);

        replayBody = reserveBody(file, current, { kind: 'new_photo' });
        const beforeInvalid = await albumSnapshot(replayAlbum);
        await expectCode(
          await send(
            'POST',
            '/api/v1/albums/' + replayAlbum.id + '/upload-resolution',
            { file, albumId: replayAlbum.id },
          ),
          400,
          'INVALID_INPUT',
        );
        for (const invalid of [
          { ...replayBody, target: { kind: 'new_photo' } },
          { ...replayBody, workspaceId },
          { ...replayBody, confirm: false },
          { ...replayBody, expectedMode: 'manual' },
          { ...replayBody, choice: { kind: 'skip' } },
          {
            ...replayBody,
            choice: { kind: 'new_photo', photoId: randomUUID() },
          },
        ]) {
          await expectCode(
            await send(
              'POST',
              '/api/v1/albums/' + replayAlbum.id + '/resolved-uploads',
              invalid,
            ),
            400,
            'INVALID_INPUT',
          );
        }
        const rejectedOrigin = await send(
          'POST',
          '/api/v1/albums/' + replayAlbum.id + '/upload-resolution',
          { file },
          { Origin: 'https://foreign.invalid' },
        );
        assert.equal(rejectedOrigin.status, 403, await rejectedOrigin.text());
        await expectCode(
          await send(
            'POST',
            '/api/v1/albums/' + replayAlbum.id + '/resolved-uploads',
            replayBody,
            { 'X-Kino-Expected-Actor': randomUUID() },
          ),
          403,
          'UPLOAD_OWNER_CHANGED',
        );
        assert.deepEqual(await albumSnapshot(replayAlbum), beforeInvalid);

        const reservationResponse = await send(
          'POST',
          '/api/v1/albums/' + replayAlbum.id + '/resolved-uploads',
          replayBody,
        );
        assert.equal(
          reservationResponse.status,
          201,
          await reservationResponse.clone().text(),
        );
        replayReservation = await readJson(reservationResponse);
        trackSession(replayReservation.uploadSession);
        assert.deepEqual(replayReservation.target, { kind: 'new_photo' });
        assert.equal(replayReservation.uploadSession.status, 'reserved');

        const stored = await first(
          'SELECT payload_json,session_id,workspace_id,project_id,album_id,original_filename,expected_bytes FROM upload_requests WHERE actor_id=? AND request_id=?',
          owner,
          replayBody.requestId,
        );
        assert.ok(stored);
        const payload = JSON.parse(stored.payload_json);
        assert.deepEqual(payload.resolution, {
          expectedChangeSequence: current.changeSequence,
          expectedProjectRevision: current.projectRevision,
          expectedMode: current.mode,
          choice: { kind: 'new_photo' },
          dimensions: file.dimensions,
          confirm: true,
        });
        assert.equal(payload.workspaceId, project.workspaceId);
        assert.equal(payload.projectId, project.id);
        assert.equal(payload.albumId, replayAlbum.id);
        assert.equal(
          (await albumSequence(replayAlbum.id)) > current.changeSequence,
          true,
        );

        const beforeReplay = await albumSnapshot(replayAlbum);
        const replay = await send(
          'POST',
          '/api/v1/albums/' + replayAlbum.id + '/resolved-uploads',
          replayBody,
        );
        assert.equal(replay.status, 201, await replay.clone().text());
        assert.deepEqual(await readJson(replay), replayReservation);
        assert.deepEqual(await albumSnapshot(replayAlbum), beforeReplay);
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
              owner,
              replayBody.requestId,
            )
          ).n,
          1,
        );

        const clonedRequestId = randomUUID();
        const clonedSessionId = randomUUID();
        const cloneObjectKey = `${stored.workspace_id}/${stored.project_id}/${stored.album_id}/${clonedSessionId}/original`;
        const beforeClone = await albumSnapshot(replayAlbum);
        await assert.rejects(
          () =>
            db
              .prepare(
                'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              )
              .bind(
                owner,
                clonedRequestId,
                'upload.reserved',
                stored.payload_json,
                stored.session_id,
                clonedSessionId,
                stored.workspace_id,
                stored.project_id,
                stored.album_id,
                'primary',
                cloneObjectKey,
                stored.original_filename,
                stored.expected_bytes,
                Date.now(),
              )
              .run(),
          (error) => {
            assert.match(String(error?.message), /RESOLUTION_STALE/);
            return true;
          },
        );
        assert.deepEqual(await albumSnapshot(replayAlbum), beforeClone);
        assert.equal(
          await first(
            'SELECT 1 AS found FROM upload_requests WHERE actor_id=? AND request_id=?',
            owner,
            clonedRequestId,
          ),
          null,
        );
        assert.equal(
          await first(
            'SELECT 1 AS found FROM upload_sessions WHERE id=?',
            clonedSessionId,
          ),
          null,
        );
      },
    );

    if (replayReservation?.uploadSession?.id) {
      await check(
        'current Owner and active album scope are checked before resolved reservation replay',
        async () => {
          await cancelUnissued(replayReservation.uploadSession.id);
          await db
            .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
            .bind(owner)
            .run();
          try {
            await expectCode(
              await send(
                'POST',
                '/api/v1/albums/' + replayAlbum.id + '/resolved-uploads',
                replayBody,
              ),
              403,
              'OWNER_REQUIRED',
            );
          } finally {
            await db
              .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
              .bind(owner)
              .run();
          }

          const revision = await first(
            'SELECT revision FROM albums WHERE id=?',
            replayAlbum.id,
          );
          const archived = await send(
            'PATCH',
            '/api/v1/albums/' + replayAlbum.id + '/archive',
            {
              archived: true,
              expectedRevision: revision.revision,
              requestId: randomUUID(),
            },
          );
          assert.equal(archived.status, 200, await archived.clone().text());
          await expectCode(
            await send(
              'POST',
              '/api/v1/albums/' + replayAlbum.id + '/resolved-uploads',
              replayBody,
            ),
            404,
            'NOT_FOUND',
          );
        },
      );
    }

    await check(
      'two distinct request IDs from one preview produce one reservation and one stale conflict',
      async () => {
        const album = await createAlbum(project.id, 'concurrent');
        const bytes = await makePng(48, 24, '#429e7d');
        const file = await evidence('concurrent.png', bytes);
        const current = await preview(album.id, file);
        const beforeUsage = await usage(project.workspaceId);
        const bodies = [
          reserveBody(file, current, { kind: 'new_photo' }),
          reserveBody(file, current, { kind: 'new_photo' }),
        ];
        const calls = bodies.map((body) =>
          send(
            'POST',
            '/api/v1/albums/' + album.id + '/resolved-uploads',
            body,
          ),
        );
        let settled;
        try {
          settled = await Promise.allSettled(calls);
        } finally {
          await Promise.allSettled(calls);
        }
        assert.equal(
          settled.filter((item) => item.status === 'fulfilled').length,
          2,
        );
        const responses = settled.map((item) => {
          assert.equal(item.status, 'fulfilled');
          return item.value;
        });
        const successful = responses.filter(
          (response) => response.status === 201,
        );
        const stale = responses.filter((response) => response.status === 409);
        assert.equal(successful.length, 1);
        assert.equal(stale.length, 1);
        await expectCode(stale[0], 409, 'RESOLUTION_STALE');
        const reservation = await readJson(successful[0]);
        trackSession(reservation.uploadSession);
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND album_id=?',
              owner,
              album.id,
            )
          ).n,
          1,
        );
        assert.equal(
          (
            await first(
              "SELECT count(*) AS n FROM upload_sessions WHERE actor_id=? AND album_id=? AND status='reserved'",
              owner,
              album.id,
            )
          ).n,
          1,
        );
        const afterUsage = await usage(project.workspaceId);
        assert.equal(
          afterUsage.reserved_bytes - beforeUsage.reserved_bytes,
          file.expectedBytes,
        );
        await cancelUnissued(reservation.uploadSession.id);
      },
    );

    await check(
      'a new ordinary reservation invalidates an earlier preview, pending names require review, and albums remain isolated',
      async () => {
        const album = await createAlbum(project.id, 'pending');
        const otherAlbum = await createAlbum(project.id, 'isolated');
        const bytes = await makePng(48, 24, '#639348');
        const file = await evidence('pending-name.png', bytes);
        const oldPreview = await preview(album.id, file);
        assert.equal(oldPreview.decision.outcome, 'new_photo');

        const pending = await createPendingUpload(album, project, file);
        const afterPending = await albumSnapshot(album);
        const staleBody = reserveBody(file, oldPreview, { kind: 'new_photo' });
        await expectCode(
          await send(
            'POST',
            '/api/v1/albums/' + album.id + '/resolved-uploads',
            staleBody,
          ),
          409,
          'RESOLUTION_STALE',
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
              owner,
              staleBody.requestId,
            )
          ).n,
          0,
        );
        assert.deepEqual(await albumSnapshot(album), afterPending);

        const pendingPreview = await preview(album.id, file);
        assert.equal(pendingPreview.decision.outcome, 'requires_review');
        assert.equal(
          pendingPreview.decision.reason,
          'pending_upload_requires_review',
        );
        const isolatedPreview = await preview(otherAlbum.id, file);
        assert.equal(isolatedPreview.decision.outcome, 'new_photo');
        assert.deepEqual(isolatedPreview.candidates, []);
        await cancelUnissued(pending.id);
      },
    );

    await check(
      'failed upload reservation audit rolls back request, session, watermark, and quota before exact retry',
      async () => {
        const album = await createAlbum(project.id, 'audit-retry');
        const bytes = await makePng(48, 24, '#7455b0');
        const file = await evidence('audit-retry.png', bytes);
        const current = await preview(album.id, file);
        const body = reserveBody(file, current, { kind: 'new_photo' });
        const before = await albumSnapshot(album);
        await db.exec('DROP TRIGGER IF EXISTS fail_resolved_upload_audit;');
        await db.exec(
          `CREATE TRIGGER fail_resolved_upload_audit BEFORE INSERT ON audit_events WHEN NEW.action='upload.reserved' AND NEW.request_id='${body.requestId}' BEGIN SELECT RAISE(ABORT,'TEST_RESOLVED_UPLOAD_AUDIT_FAILURE'); END;`,
        );
        try {
          await expectCode(
            await send(
              'POST',
              '/api/v1/albums/' + album.id + '/resolved-uploads',
              body,
            ),
            503,
            'RESOLUTION_UNAVAILABLE',
          );
          assert.deepEqual(await albumSnapshot(album), before);
        } finally {
          await db.exec('DROP TRIGGER IF EXISTS fail_resolved_upload_audit;');
        }
        const retry = await send(
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          body,
        );
        assert.equal(retry.status, 201, await retry.clone().text());
        const reservation = await readJson(retry);
        trackSession(reservation.uploadSession);
        assert.deepEqual(reservation.target, { kind: 'new_photo' });
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
              owner,
              body.requestId,
            )
          ).n,
          1,
        );
        await cancelUnissued(reservation.uploadSession.id);
      },
    );

    await check(
      'real PNG V1 completion resolves a changed same-name file into private V2 without switching its head, and exact hashes cannot reserve',
      async () => {
        const album = await createAlbum(project.id, 'versions');
        const firstBytes = await makePng(48, 24, '#205080');
        const firstFile = await evidence('portrait-source.png', firstBytes);
        const firstCompletion = await completeOrdinary(
          project,
          album,
          firstFile,
          firstBytes,
        );
        const firstHead = await first(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
          firstCompletion.photoId,
        );
        assert.equal(firstHead.version_id, firstCompletion.versionId);
        foreignCandidateHead = {
          photoId: firstCompletion.photoId,
          versionId: firstCompletion.versionId,
          revision: firstHead.revision,
        };

        const secondBytes = await makePng(48, 24, '#bf4e79');
        const secondFile = await evidence('portrait-source.png', secondBytes);
        assert.notEqual(secondFile.sha256, firstFile.sha256);
        const current = await preview(album.id, secondFile);
        assert.equal(current.decision.outcome, 'new_version');
        assert.equal(current.decision.photoId, firstCompletion.photoId);
        const candidate = current.candidates.find(
          (item) => item.photoId === firstCompletion.photoId,
        );
        assert.ok(candidate);
        const body = reserveBody(secondFile, current, {
          kind: 'new_version',
          photoId: candidate.photoId,
          parentVersionId: candidate.currentVersionId,
          expectedRevision: candidate.revision,
        });
        const reservationResponse = await send(
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          body,
        );
        assert.equal(
          reservationResponse.status,
          201,
          await reservationResponse.clone().text(),
        );
        const reservation = await readJson(reservationResponse);
        trackSession(reservation.uploadSession);
        assert.deepEqual(reservation.target, {
          kind: 'new_version',
          photoId: firstCompletion.photoId,
          parentVersionId: firstCompletion.versionId,
          expectedRevision: firstHead.revision,
          capturedVersioningMode: 'auto_filename',
          changeType: 'new_retouch',
        });

        await authorizeAndPut(
          reservation.uploadSession.id,
          secondBytes,
          secondFile.sha256,
        );
        const completed = await send(
          'POST',
          `/api/v1/photos/${firstCompletion.photoId}/versions/${reservation.uploadSession.id}/complete`,
          { requestId: randomUUID() },
        );
        assert.equal(completed.status, 200, await completed.clone().text());
        const secondCompletion = await readJson(completed);
        assert.equal(secondCompletion.status, 'completed');
        assert.equal(secondCompletion.photoId, firstCompletion.photoId);
        assert.equal(secondCompletion.versionNo, 2);
        assert.equal(
          secondCompletion.parentVersionId,
          firstCompletion.versionId,
        );
        assert.equal(secondCompletion.changeType, 'new_retouch');

        const storedVersion = await first(
          'SELECT source_hash_sha256,byte_size,mime,width,height,status FROM photo_versions WHERE id=?',
          secondCompletion.versionId,
        );
        assert.deepEqual(storedVersion, {
          source_hash_sha256: secondFile.sha256,
          byte_size: secondBytes.byteLength,
          mime: 'image/png',
          width: 48,
          height: 24,
          status: 'private',
        });
        assert.deepEqual(
          await first(
            'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
            firstCompletion.photoId,
          ),
          firstHead,
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
              firstCompletion.photoId,
            )
          ).n,
          2,
        );

        const duplicatePreview = await preview(album.id, secondFile);
        assert.equal(duplicatePreview.decision.outcome, 'duplicate');
        const duplicateBody = reserveBody(secondFile, duplicatePreview, {
          kind: 'new_version',
          photoId: firstCompletion.photoId,
          parentVersionId: firstCompletion.versionId,
          expectedRevision: firstHead.revision,
        });
        const beforeDuplicate = await albumSnapshot(album);
        await expectCode(
          await send(
            'POST',
            '/api/v1/albums/' + album.id + '/resolved-uploads',
            duplicateBody,
          ),
          409,
          'RESOLUTION_DUPLICATE',
        );
        assert.deepEqual(await albumSnapshot(album), beforeDuplicate);
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
              owner,
              duplicateBody.requestId,
            )
          ).n,
          0,
        );
      },
    );

    await check(
      'assisted mode requires explicit new-version or new-photo choice and rejects a foreign album head without quota writes',
      async () => {
        const assisted = await createConfiguredProject('assisted');
        assert.equal(assisted.initial.mode, 'manual');
        assert.equal(assisted.current.mode, 'assisted');
        assert.equal(assisted.current.revision, assisted.initial.revision + 1);
        assert.ok(foreignCandidateHead);

        const album = await createAlbum(assisted.project.id, 'assisted');
        const firstBytes = await makePng(48, 24, '#385d88');
        const firstFile = await evidence('assisted-source.png', firstBytes);
        const baseline = await completeOrdinary(
          assisted.project,
          album,
          firstFile,
          firstBytes,
        );

        const changedBytes = await makePng(48, 24, '#bb5b71');
        const changedFile = await evidence('assisted-source.png', changedBytes);
        assert.notEqual(changedFile.sha256, firstFile.sha256);
        const current = await preview(album.id, changedFile);
        assert.equal(current.mode, 'assisted');
        assert.equal(current.decision.outcome, 'requires_review');
        assert.equal(current.decision.reason, 'assisted_choice_required');
        assert.equal(current.decision.photoId, baseline.photoId);

        const beforeForgedChoice = await albumSnapshot(album);
        const foreignChoice = reserveBody(changedFile, current, {
          kind: 'new_version',
          photoId: foreignCandidateHead.photoId,
          parentVersionId: foreignCandidateHead.versionId,
          expectedRevision: foreignCandidateHead.revision,
        });
        await expectCode(
          await send(
            'POST',
            '/api/v1/albums/' + album.id + '/resolved-uploads',
            foreignChoice,
          ),
          409,
          'RESOLUTION_REVIEW_REQUIRED',
        );
        assert.deepEqual(await albumSnapshot(album), beforeForgedChoice);
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
              owner,
              foreignChoice.requestId,
            )
          ).n,
          0,
        );

        const candidate = current.candidates.find(
          (item) => item.photoId === baseline.photoId,
        );
        assert.ok(candidate);
        const newVersionChoice = reserveBody(changedFile, current, {
          kind: 'new_version',
          photoId: candidate.photoId,
          parentVersionId: candidate.currentVersionId,
          expectedRevision: candidate.revision,
        });
        const reservedVersion = await send(
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          newVersionChoice,
        );
        assert.equal(
          reservedVersion.status,
          201,
          await reservedVersion.clone().text(),
        );
        const versionReservation = await readJson(reservedVersion);
        trackSession(versionReservation.uploadSession);
        assert.deepEqual(versionReservation.target, {
          kind: 'new_version',
          photoId: baseline.photoId,
          parentVersionId: baseline.versionId,
          expectedRevision: 0,
          capturedVersioningMode: 'assisted',
          changeType: 'new_retouch',
        });
        assert.deepEqual(
          await first(
            'SELECT photo_id,parent_version_id,expected_revision,captured_versioning_mode,change_type FROM upload_version_targets WHERE upload_session_id=?',
            versionReservation.uploadSession.id,
          ),
          {
            photo_id: baseline.photoId,
            parent_version_id: baseline.versionId,
            expected_revision: 0,
            captured_versioning_mode: 'assisted',
            change_type: 'new_retouch',
          },
        );
        assert.equal(
          (
            await first(
              'SELECT version_id FROM photo_version_heads WHERE photo_id=?',
              baseline.photoId,
            )
          ).version_id,
          baseline.versionId,
        );
        await cancelUnissued(versionReservation.uploadSession.id);

        const newBytes = await makePng(40, 30, '#4c8b65');
        const newFile = await evidence('assisted-new-photo.png', newBytes);
        const newPreview = await preview(album.id, newFile);
        assert.equal(newPreview.mode, 'assisted');
        assert.equal(newPreview.decision.outcome, 'new_photo');
        const newPhotoBody = reserveBody(newFile, newPreview, {
          kind: 'new_photo',
        });
        const reservedPhoto = await send(
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          newPhotoBody,
        );
        assert.equal(
          reservedPhoto.status,
          201,
          await reservedPhoto.clone().text(),
        );
        const photoReservation = await readJson(reservedPhoto);
        trackSession(photoReservation.uploadSession);
        assert.deepEqual(photoReservation.target, { kind: 'new_photo' });
        await cancelUnissued(photoReservation.uploadSession.id);
      },
    );

    await check(
      'declared raw dimension mismatch puts a real upload in needs_review while retaining quota and withholding V2 metadata',
      async () => {
        const album = await createAlbum(project.id, 'dimension-mismatch');
        const firstBytes = await makePng(48, 24, '#185c7a');
        const firstFile = await evidence('dimension-source.png', firstBytes);
        const baseline = await completeOrdinary(
          project,
          album,
          firstFile,
          firstBytes,
        );
        const beforeUsage = await usage(project.workspaceId);

        const actualBytes = await makePng(48, 23, '#9b3e64');
        const declaredFile = await evidence(
          'dimension-source.png',
          actualBytes,
          {
            width: 48,
            height: 24,
          },
        );
        const current = await preview(album.id, declaredFile);
        assert.equal(current.decision.outcome, 'new_version');
        assert.equal(current.decision.photoId, baseline.photoId);
        const candidate = current.candidates.find(
          (item) => item.photoId === baseline.photoId,
        );
        assert.ok(candidate);
        const body = reserveBody(declaredFile, current, {
          kind: 'new_version',
          photoId: candidate.photoId,
          parentVersionId: candidate.currentVersionId,
          expectedRevision: candidate.revision,
        });
        const reserved = await send(
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          body,
        );
        assert.equal(reserved.status, 201, await reserved.clone().text());
        const reservation = await readJson(reserved);
        trackSession(reservation.uploadSession);
        assert.deepEqual(reservation.target, {
          kind: 'new_version',
          photoId: baseline.photoId,
          parentVersionId: baseline.versionId,
          expectedRevision: 0,
          capturedVersioningMode: 'auto_filename',
          changeType: 'new_retouch',
        });

        await authorizeAndPut(
          reservation.uploadSession.id,
          actualBytes,
          declaredFile.sha256,
        );
        const completed = await send(
          'POST',
          `/api/v1/photos/${baseline.photoId}/versions/${reservation.uploadSession.id}/complete`,
          { requestId: randomUUID() },
        );
        await expectCode(
          completed,
          422,
          'UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH',
        );
        const currentSession = await send(
          'GET',
          '/api/v1/uploads/' + reservation.uploadSession.id,
        );
        assert.equal(
          currentSession.status,
          200,
          await currentSession.clone().text(),
        );
        assert.equal(
          (await readJson(currentSession)).uploadSession.status,
          'needs_review',
        );
        assert.equal(
          (
            await first(
              'SELECT reason_code FROM upload_review_flags WHERE upload_session_id=?',
              reservation.uploadSession.id,
            )
          ).reason_code,
          'UPLOAD_METADATA_MISMATCH',
        );
        const afterUsage = await usage(project.workspaceId);
        assert.equal(
          afterUsage.reserved_bytes - beforeUsage.reserved_bytes,
          actualBytes.byteLength,
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_version_completions WHERE upload_session_id=?',
              reservation.uploadSession.id,
            )
          ).n,
          0,
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
              baseline.photoId,
            )
          ).n,
          1,
        );
        assert.equal(
          (
            await first(
              'SELECT version_id FROM photo_version_heads WHERE photo_id=?',
              baseline.photoId,
            )
          ).version_id,
          baseline.versionId,
        );
      },
    );
  } finally {
    const cleanup = await Promise.allSettled(
      [...unissuedSessions].map((uploadSessionId) =>
        cancelUnissued(uploadSessionId),
      ),
    );
    const failedCleanup = cleanup.filter(
      (result) => result.status === 'rejected',
    );
    if (failedCleanup.length)
      throw new AggregateError(
        failedCleanup.map((result) => result.reason),
        'Unissued resolved fixture cleanup failed',
      );
  }
}
