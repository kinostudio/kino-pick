import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function albumMatchingChangeChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  const storageWorker = await mf.getWorker('storage-test');
  const ownerCookie = cookies.headers();
  const galleryAlbumId = galleryFixture.context.album.id;
  const galleryPhoto = galleryFixture.photo;
  const headers = {
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
  };
  const ownedUploadIds = new Set();

  const bodyOf = async (response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const send = (method, path, body) =>
    request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const readSnapshot = async (albumId) => {
    const response = await storageWorker.fetch(
      new Request(base + '/test-version-match-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: owner, session: sessionId, albumId }),
      }),
    );
    const body = await bodyOf(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const markersFor = async (album) => {
    const result = await db
      .prepare(
        'SELECT sequence,workspace_id,project_id,album_id,kind,source_id,' +
          'source_revision,source_state,created_at_ms ' +
          'FROM album_matching_changes WHERE album_id=? ORDER BY sequence',
      )
      .bind(album.id)
      .all();
    return result.results;
  };
  const workspaceReservedBytes = async (workspaceId) => {
    const row = await db
      .prepare(
        'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
      )
      .bind(workspaceId)
      .first();
    return row?.reserved_bytes ?? null;
  };
  const create = async (path, fields) => {
    const response = await send('POST', path, {
      ...fields,
      requestId: randomUUID(),
    });
    const body = await bodyOf(response);
    assert.equal(response.status, 201, JSON.stringify(body));
    return body;
  };
  const makeScope = async (label) => {
    const workspace = (
      await create('/api/v1/workspaces', { name: 'Matching changes ' + label })
    ).workspace;
    const project = (
      await create('/api/v1/projects', {
        workspaceId: workspace.id,
        name: 'Matching changes ' + label,
      })
    ).project;
    const album = (
      await create('/api/v1/projects/' + project.id + '/albums', {
        name: 'Matching changes ' + label + ' A',
      })
    ).album;
    const otherAlbum = (
      await create('/api/v1/projects/' + project.id + '/albums', {
        name: 'Matching changes ' + label + ' B',
      })
    ).album;
    return { workspace, project, album, otherAlbum };
  };
  const uploadInitBody = (
    scope,
    requestId = randomUUID(),
    album = scope.album,
  ) => ({
    workspaceId: scope.workspace.id,
    projectId: scope.project.id,
    albumId: album.id,
    originalFilename: 'matching-change-small.png',
    expectedBytes: 8,
    contentType: 'image/png',
    sha256: 'a'.repeat(64),
    requestId,
  });
  const registerOwnedUpload = (body) => {
    const id = body?.uploadSession?.id;
    if (typeof id === 'string') ownedUploadIds.add(id);
    return body.uploadSession;
  };
  const cleanupOwnedPending = async () => {
    for (const uploadSessionId of ownedUploadIds) {
      const row = await db
        .prepare('SELECT status FROM upload_sessions WHERE id=?')
        .bind(uploadSessionId)
        .first();
      if (!row || row.status !== 'reserved') continue;
      const response = await send(
        'POST',
        '/api/v1/uploads/' + uploadSessionId + '/cancel',
        { requestId: randomUUID() },
      );
      const body = await bodyOf(response);
      assert.equal(
        response.status,
        200,
        'could not clean up test-owned unissued upload: ' +
          JSON.stringify(body),
      );
      assert.equal(body?.uploadSession?.status, 'cancelled');
    }
  };

  const authenticated = await request('/api/auth/get-session', {
    headers: { Cookie: ownerCookie },
  });
  assert.equal(authenticated.status, 200, await authenticated.clone().text());
  const authBody = await authenticated.json();
  assert.equal(authBody?.user?.id, owner);
  assert.ok(authBody?.session?.id);
  const sessionId = authBody.session.id;
  assert.ok(
    await db
      .prepare(
        'SELECT id FROM owner_sessions WHERE userId=? AND id=? AND expiresAt>? LIMIT 1',
      )
      .bind(owner, sessionId, Date.now())
      .first(),
    'Expected /api/auth/get-session to provide a live Owner session id',
  );

  const galleryBefore = await readSnapshot(galleryAlbumId);
  const galleryHead = await db
    .prepare(
      'SELECT version_id,revision FROM photo_version_heads ' +
        'WHERE workspace_id=? AND project_id=? AND album_id=? AND photo_id=?',
    )
    .bind(
      galleryFixture.context.workspace.id,
      galleryFixture.context.project.id,
      galleryAlbumId,
      galleryPhoto.photoId,
    )
    .first();
  assert.ok(galleryHead, 'expected the normal processing photo head');
  assert.equal(galleryHead.version_id, galleryPhoto.versionId);
  const galleryMarkers = await db
    .prepare(
      'SELECT sequence,kind,source_id,source_revision,source_state ' +
        'FROM album_matching_changes WHERE workspace_id=? AND project_id=? ' +
        'AND album_id=? ORDER BY sequence',
    )
    .bind(
      galleryFixture.context.workspace.id,
      galleryFixture.context.project.id,
      galleryAlbumId,
    )
    .all();
  const hasGalleryMarker = (kind, sourceId, sourceRevision, sourceState) =>
    galleryMarkers.results.some(
      (row) =>
        row.kind === kind &&
        row.source_id === sourceId &&
        row.source_revision === sourceRevision &&
        row.source_state === sourceState,
    );
  assert.ok(
    hasGalleryMarker('photo', galleryPhoto.photoId, 0, ''),
    'normal processing should append the fixture photo marker',
  );
  assert.ok(
    hasGalleryMarker('version', galleryPhoto.versionId, 0, ''),
    'normal processing should append the fixture version marker',
  );
  assert.ok(
    hasGalleryMarker('head', galleryPhoto.photoId, galleryHead.revision, ''),
    'normal processing should append the fixture head marker',
  );

  let scope;
  let firstUploadId;
  try {
    await check(
      'album matching clocks track scoped unissued upload reservations and cancellation retries',
      async () => {
        scope = await makeScope(randomUUID());
        const initialA = await readSnapshot(scope.album.id);
        const initialB = await readSnapshot(scope.otherAlbum.id);
        assert.equal(initialA.changeSequence, 0);
        assert.deepEqual(initialA.pendingUploads, []);
        assert.deepEqual(initialA.candidates, []);
        assert.deepEqual(initialA.heads, {});
        assert.equal(initialB.changeSequence, 0);
        assert.deepEqual(initialB.pendingUploads, []);
        assert.deepEqual(initialB.candidates, []);
        assert.deepEqual(initialB.heads, {});

        const initBody = uploadInitBody(scope);
        const createdResponse = await send(
          'POST',
          '/api/v1/uploads/init',
          initBody,
        );
        const createdBody = await bodyOf(createdResponse);
        assert.equal(createdResponse.status, 201, JSON.stringify(createdBody));
        const session = registerOwnedUpload(createdBody);
        assert.equal(session.status, 'reserved');
        firstUploadId = session.id;

        const afterInitA = await readSnapshot(scope.album.id);
        assert.ok(afterInitA.changeSequence > initialA.changeSequence);
        assert.deepEqual(afterInitA.pendingUploads, [
          {
            uploadSessionId: session.id,
            filename: initBody.originalFilename,
          },
        ]);
        const reservedMarkers = await markersFor(scope.album);
        assert.equal(reservedMarkers.length, 1);
        assert.deepEqual(
          {
            workspace_id: reservedMarkers[0].workspace_id,
            project_id: reservedMarkers[0].project_id,
            album_id: reservedMarkers[0].album_id,
            kind: reservedMarkers[0].kind,
            source_id: reservedMarkers[0].source_id,
            source_revision: reservedMarkers[0].source_revision,
            source_state: reservedMarkers[0].source_state,
          },
          {
            workspace_id: scope.workspace.id,
            project_id: scope.project.id,
            album_id: scope.album.id,
            kind: 'upload',
            source_id: session.id,
            source_revision: 0,
            source_state: 'reserved',
          },
        );
        assert.equal(afterInitA.changeSequence, reservedMarkers[0].sequence);

        const afterInitB = await readSnapshot(scope.otherAlbum.id);
        assert.equal(afterInitB.changeSequence, initialB.changeSequence);
        assert.deepEqual(afterInitB.pendingUploads, initialB.pendingUploads);
        assert.deepEqual(afterInitB.heads, initialB.heads);
        assert.deepEqual(afterInitB.candidates, initialB.candidates);

        const initReplayResponse = await send(
          'POST',
          '/api/v1/uploads/init',
          initBody,
        );
        const initReplayBody = await bodyOf(initReplayResponse);
        assert.equal(
          initReplayResponse.status,
          201,
          JSON.stringify(initReplayBody),
        );
        assert.deepEqual(initReplayBody.uploadSession, session);
        assert.deepEqual(await markersFor(scope.album), reservedMarkers);
        const afterInitReplay = await readSnapshot(scope.album.id);
        assert.equal(afterInitReplay.changeSequence, afterInitA.changeSequence);
        assert.deepEqual(
          afterInitReplay.pendingUploads,
          afterInitA.pendingUploads,
        );

        const cancelRequestId = randomUUID();
        const cancelBody = { requestId: cancelRequestId };
        const cancelledResponse = await send(
          'POST',
          '/api/v1/uploads/' + session.id + '/cancel',
          cancelBody,
        );
        const cancelledBody = await bodyOf(cancelledResponse);
        assert.equal(
          cancelledResponse.status,
          200,
          JSON.stringify(cancelledBody),
        );
        const cancelled = cancelledBody.uploadSession;
        assert.equal(cancelled.status, 'cancelled');

        const afterCancelA = await readSnapshot(scope.album.id);
        assert.ok(afterCancelA.changeSequence > afterInitReplay.changeSequence);
        assert.deepEqual(afterCancelA.pendingUploads, []);
        const allMarkers = await markersFor(scope.album);
        assert.equal(allMarkers.length, 2);
        assert.deepEqual(
          allMarkers.map((row) => ({
            kind: row.kind,
            source_id: row.source_id,
            source_revision: row.source_revision,
            source_state: row.source_state,
          })),
          [
            {
              kind: 'upload',
              source_id: session.id,
              source_revision: 0,
              source_state: 'reserved',
            },
            {
              kind: 'upload',
              source_id: session.id,
              source_revision: 0,
              source_state: 'cancelled',
            },
          ],
        );
        assert.equal(
          afterCancelA.changeSequence,
          allMarkers[allMarkers.length - 1].sequence,
        );

        const cancelReplayResponse = await send(
          'POST',
          '/api/v1/uploads/' + session.id + '/cancel',
          cancelBody,
        );
        const cancelReplayBody = await bodyOf(cancelReplayResponse);
        assert.equal(
          cancelReplayResponse.status,
          200,
          JSON.stringify(cancelReplayBody),
        );
        assert.deepEqual(cancelReplayBody.uploadSession, cancelled);
        assert.deepEqual(await markersFor(scope.album), allMarkers);
        const afterCancelReplay = await readSnapshot(scope.album.id);
        assert.equal(
          afterCancelReplay.changeSequence,
          afterCancelA.changeSequence,
        );
        assert.deepEqual(
          afterCancelReplay.pendingUploads,
          afterCancelA.pendingUploads,
        );

        const afterSecondaryCancel = await readSnapshot(scope.otherAlbum.id);
        assert.equal(
          afterSecondaryCancel.changeSequence,
          initialB.changeSequence,
        );
        assert.deepEqual(
          afterSecondaryCancel.pendingUploads,
          initialB.pendingUploads,
        );
      },
    );

    await check(
      'album matching markers reject update delete replace and invalid source or scope writes',
      async () => {
        const rowsBefore = await markersFor(scope.album);
        assert.equal(rowsBefore.length, 2);
        for (const row of rowsBefore) {
          await assert.rejects(
            db
              .prepare(
                'UPDATE album_matching_changes SET source_state=? WHERE sequence=?',
              )
              .bind('expired', row.sequence)
              .run(),
            /IMMUTABLE_ALBUM_MATCHING_CHANGE/,
          );
          await assert.rejects(
            db
              .prepare('DELETE FROM album_matching_changes WHERE sequence=?')
              .bind(row.sequence)
              .run(),
            /IMMUTABLE_ALBUM_MATCHING_CHANGE/,
          );
          await assert.rejects(
            db
              .prepare(
                'INSERT OR REPLACE INTO album_matching_changes(' +
                  'sequence,workspace_id,project_id,album_id,kind,source_id,' +
                  'source_revision,source_state,created_at_ms) ' +
                  'SELECT sequence,workspace_id,project_id,album_id,kind,source_id,' +
                  'source_revision,source_state,created_at_ms ' +
                  'FROM album_matching_changes WHERE sequence=?',
              )
              .bind(row.sequence)
              .run(),
            /IMMUTABLE_ALBUM_MATCHING_CHANGE/,
          );
        }

        await assert.rejects(
          db
            .prepare(
              'INSERT INTO album_matching_changes(' +
                'workspace_id,project_id,album_id,kind,source_id,' +
                "source_revision,source_state) VALUES(?,?,?,'upload',?,0,'reserved')",
            )
            .bind(
              scope.workspace.id,
              scope.project.id,
              scope.album.id,
              randomUUID(),
            )
            .run(),
          /ALBUM_MATCHING_CHANGE_SOURCE_MISMATCH/,
        );
        await assert.rejects(
          db
            .prepare(
              'INSERT INTO album_matching_changes(' +
                'workspace_id,project_id,album_id,kind,source_id,' +
                "source_revision,source_state) VALUES(?,?,?,'upload',?,0,'cancelled')",
            )
            .bind(
              scope.workspace.id,
              scope.project.id,
              scope.otherAlbum.id,
              firstUploadId,
            )
            .run(),
          /IMMUTABLE_ALBUM_MATCHING_CHANGE/,
        );
        await assert.rejects(
          db
            .prepare(
              'INSERT INTO album_matching_changes(' +
                'workspace_id,project_id,album_id,kind,source_id,' +
                "source_revision,source_state) VALUES(?,?,?,'upload',?,0,'reserved')",
            )
            .bind(randomUUID(), scope.project.id, scope.album.id, randomUUID())
            .run(),
          /ALBUM_MATCHING_CHANGE_SCOPE_MISMATCH/,
        );
        assert.deepEqual(await markersFor(scope.album), rowsBefore);
      },
    );

    await check(
      'upload audit failure rolls back matching marker quota request and session before exact UUID retry',
      async () => {
        const requestId = randomUUID();
        const input = uploadInitBody(scope, requestId, scope.otherAlbum);
        const beforeSnapshot = await readSnapshot(scope.otherAlbum.id);
        const beforeRows = await markersFor(scope.otherAlbum);
        const beforeReservedBytes = await workspaceReservedBytes(
          scope.workspace.id,
        );

        await db.exec(
          'CREATE TRIGGER fail_matching_change_upload_audit ' +
            'BEFORE INSERT ON audit_events ' +
            "WHEN NEW.action='upload.reserved' " +
            "BEGIN SELECT RAISE(ABORT,'MATCHING_CHANGE_UPLOAD_AUDIT_INJECTED'); END;",
        );
        try {
          const failedResponse = await send(
            'POST',
            '/api/v1/uploads/init',
            input,
          );
          const failedBody = await bodyOf(failedResponse);
          assert.equal(failedResponse.status, 503, JSON.stringify(failedBody));
          assert.equal(
            (
              await db
                .prepare(
                  'SELECT count(*) AS n FROM album_matching_changes ' +
                    'WHERE album_id=?',
                )
                .bind(scope.otherAlbum.id)
                .first()
            ).n,
            beforeRows.length,
          );
          assert.deepEqual(await markersFor(scope.otherAlbum), beforeRows);
          assert.deepEqual(
            await readSnapshot(scope.otherAlbum.id),
            beforeSnapshot,
          );
          assert.equal(
            await workspaceReservedBytes(scope.workspace.id),
            beforeReservedBytes,
          );
          assert.equal(
            (
              await db
                .prepare(
                  'SELECT count(*) AS n FROM upload_requests ' +
                    'WHERE actor_id=? AND request_id=?',
                )
                .bind(owner, requestId)
                .first()
            ).n,
            0,
          );
          assert.equal(
            (
              await db
                .prepare(
                  'SELECT count(*) AS n FROM upload_sessions ' +
                    'WHERE created_request_id=?',
                )
                .bind(requestId)
                .first()
            ).n,
            0,
          );
          assert.equal(
            (
              await db
                .prepare(
                  'SELECT count(*) AS n FROM audit_events ' +
                    "WHERE action='upload.reserved' AND request_id=?",
                )
                .bind(requestId)
                .first()
            ).n,
            0,
          );
        } finally {
          await db.exec('DROP TRIGGER fail_matching_change_upload_audit');
        }

        const retriedResponse = await send(
          'POST',
          '/api/v1/uploads/init',
          input,
        );
        const retriedBody = await bodyOf(retriedResponse);
        assert.equal(retriedResponse.status, 201, JSON.stringify(retriedBody));
        const retriedSession = registerOwnedUpload(retriedBody);
        assert.ok(retriedSession?.id);
        assert.equal(retriedSession.status, 'reserved');

        const afterRetry = await readSnapshot(scope.otherAlbum.id);
        assert.ok(afterRetry.changeSequence > beforeSnapshot.changeSequence);
        assert.deepEqual(afterRetry.pendingUploads, [
          {
            uploadSessionId: retriedSession.id,
            filename: input.originalFilename,
          },
        ]);
        const retryMarkers = await markersFor(scope.otherAlbum);
        assert.equal(retryMarkers.length, beforeRows.length + 1);
        assert.deepEqual(
          {
            workspace_id: retryMarkers.at(-1).workspace_id,
            project_id: retryMarkers.at(-1).project_id,
            album_id: retryMarkers.at(-1).album_id,
            kind: retryMarkers.at(-1).kind,
            source_id: retryMarkers.at(-1).source_id,
            source_revision: retryMarkers.at(-1).source_revision,
            source_state: retryMarkers.at(-1).source_state,
          },
          {
            workspace_id: scope.workspace.id,
            project_id: scope.project.id,
            album_id: scope.otherAlbum.id,
            kind: 'upload',
            source_id: retriedSession.id,
            source_revision: 0,
            source_state: 'reserved',
          },
        );

        const replayResponse = await send(
          'POST',
          '/api/v1/uploads/init',
          input,
        );
        const replayBody = await bodyOf(replayResponse);
        assert.equal(replayResponse.status, 201, JSON.stringify(replayBody));
        assert.deepEqual(replayBody.uploadSession, retriedSession);
        assert.deepEqual(await markersFor(scope.otherAlbum), retryMarkers);
        const afterReplay = await readSnapshot(scope.otherAlbum.id);
        assert.equal(afterReplay.changeSequence, afterRetry.changeSequence);
        assert.deepEqual(afterReplay.pendingUploads, afterRetry.pendingUploads);
      },
    );

    await check(
      'album matching mutations leave the processed gallery marker clock and head unchanged',
      async () => {
        const galleryAfter = await readSnapshot(galleryAlbumId);
        assert.deepEqual(galleryAfter, galleryBefore);
        const headAfter = await db
          .prepare(
            'SELECT version_id,revision FROM photo_version_heads ' +
              'WHERE workspace_id=? AND project_id=? AND album_id=? AND photo_id=?',
          )
          .bind(
            galleryFixture.context.workspace.id,
            galleryFixture.context.project.id,
            galleryAlbumId,
            galleryPhoto.photoId,
          )
          .first();
        assert.deepEqual(headAfter, galleryHead);
        const markersAfter = await db
          .prepare(
            'SELECT sequence,kind,source_id,source_revision,source_state ' +
              'FROM album_matching_changes WHERE workspace_id=? AND project_id=? ' +
              'AND album_id=? ORDER BY sequence',
          )
          .bind(
            galleryFixture.context.workspace.id,
            galleryFixture.context.project.id,
            galleryAlbumId,
          )
          .all();
        assert.deepEqual(markersAfter.results, galleryMarkers.results);
      },
    );
  } finally {
    await cleanupOwnedPending();
  }
}
