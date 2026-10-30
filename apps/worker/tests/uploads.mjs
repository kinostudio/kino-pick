import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { pngFixture, pngWithDimensions } from './image-fixtures.mjs';

export async function uploadChecks({
  check,
  request,
  db,
  cookies,
  owner,
  base,
  worker,
  storage,
}) {
  const headers = {
    Cookie: cookies.headers(),
    Origin: base,
    'Content-Type': 'application/json',
  };
  const send = (method, path, body, origin = base, cookie = headers.Cookie) =>
    request(path, {
      method,
      headers: { ...headers, Origin: origin, Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  async function json(response) {
    return response.json();
  }
  async function expectCode(response, code) {
    const body = await json(response);
    assert.equal(body.error?.code, code, JSON.stringify(body));
  }
  async function makeAlbum(label) {
    const workspaceRequestId = randomUUID();
    let response = await send('POST', '/api/v1/workspaces', {
      name: `Upload ${label}`,
      requestId: workspaceRequestId,
    });
    assert.equal(response.status, 201);
    const workspace = (await json(response)).workspace;
    response = await send('POST', '/api/v1/projects', {
      workspaceId: workspace.id,
      name: `Project ${label}`,
      requestId: randomUUID(),
    });
    assert.equal(response.status, 201);
    const project = (await json(response)).project;
    response = await send('POST', `/api/v1/projects/${project.id}/albums`, {
      name: `Album ${label}`,
      requestId: randomUUID(),
    });
    assert.equal(response.status, 201);
    const album = (await json(response)).album;
    return { workspace, project, album, workspaceRequestId };
  }
  const initBody = (scope, expectedBytes, requestId = randomUUID()) => ({
    workspaceId: scope.workspace.id,
    projectId: scope.project.id,
    albumId: scope.album.id,
    originalFilename: 'portrait 01.jpg',
    expectedBytes,
    contentType: 'image/jpeg',
    sha256: '1'.repeat(64),
    requestId,
  });
  const fixtureScopes = [];
  const originalNode = await db
    .prepare("SELECT quota_bytes FROM storage_nodes WHERE id='primary'")
    .first();
  const originalWorkspaceQuotas = new Map();
  async function cancelAllFixtureSessions() {
    for (const scope of fixtureScopes) {
      const rows = await db
        .prepare(
          "SELECT u.id FROM upload_sessions u WHERE u.workspace_id=? AND u.status='reserved' AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=u.id) AND NOT EXISTS(SELECT 1 FROM upload_review_flags f WHERE f.upload_session_id=u.id)",
        )
        .bind(scope.workspace.id)
        .all();
      for (const row of rows.results) {
        const response = await send(
          'POST',
          `/api/v1/uploads/${row.id}/cancel`,
          { requestId: randomUUID() },
        );
        if (response.status !== 200)
          throw new Error(
            `Fixture reservation cleanup failed: ${response.status}`,
          );
      }
    }
  }

  try {
    const primary = await makeAlbum('A');
    const secondary = await makeAlbum('B');
    const archival = await makeAlbum('C');
    const scopeOnly = await makeAlbum('D');
    fixtureScopes.push(primary, secondary, archival, scopeOnly);
    for (const scope of fixtureScopes) {
      originalWorkspaceQuotas.set(
        scope.workspace.id,
        scope.workspace.quotaBytes,
      );
      await db
        .prepare('UPDATE workspaces SET quota_bytes=900 WHERE id=?')
        .bind(scope.workspace.id)
        .run();
    }

    await check(
      'D1 upload reservation API is Owner-only, strict, same-origin and tenant scoped',
      async () => {
        assert.equal(
          (
            await send(
              'POST',
              '/api/v1/uploads/init',
              initBody(primary, 1),
              base,
              '',
            )
          ).status,
          401,
        );
        for (const body of [
          { ...initBody(primary, 1), injected: 'owner' },
          { ...initBody(primary, 1), expectedBytes: 0 },
          { ...initBody(primary, 1), expectedBytes: 5363466241 },
          { ...initBody(primary, 1), contentType: 'image/svg+xml' },
          { ...initBody(primary, 1), sha256: 'bad' },
          { ...initBody(primary, 1), originalFilename: '../private.jpg' },
          { ...initBody(primary, 1), requestId: 'invalid' },
        ])
          assert.equal(
            (await send('POST', '/api/v1/uploads/init', body)).status,
            400,
          );
        assert.equal(
          (
            await send(
              'POST',
              '/api/v1/uploads/init',
              initBody(primary, 1),
              'https://attacker.invalid',
            )
          ).status,
          403,
        );
        const crossScope = initBody(primary, 1);
        crossScope.projectId = secondary.project.id;
        crossScope.albumId = secondary.album.id;
        await expectCode(
          await send('POST', '/api/v1/uploads/init', crossScope),
          'NOT_FOUND',
        );
        await expectCode(
          await send(
            'POST',
            '/api/v1/uploads/init',
            initBody(primary, 1, primary.workspaceRequestId),
          ),
          'REQUEST_ID_CONFLICT',
        );
      },
    );

    await check(
      'D1 reservation commits workspace and node counters, result snapshot, and UTC audit atomically',
      async () => {
        await db
          .prepare(
            "UPDATE storage_nodes SET quota_bytes=1000 WHERE id='primary'",
          )
          .run();
        const requestId = randomUUID();
        const body = initBody(primary, 40, requestId);
        const response = await send('POST', '/api/v1/uploads/init', body);
        assert.equal(response.status, 201);
        const session = (await json(response)).uploadSession;
        assert.equal(session.status, 'reserved');
        assert.equal(session.expectedBytes, 40);
        assert.equal(session.reservedBytes, 40);
        assert.ok(
          Date.parse(session.expiresAt) - Date.parse(session.createdAt) ===
            900000,
        );
        const object = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(session.id)
          .first();
        assert.equal(
          object.object_key,
          `${primary.workspace.id}/${primary.project.id}/${primary.album.id}/${session.id}/original`,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(primary.workspace.id)
              .first()
          ).reserved_bytes,
          40,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT reserved_bytes FROM storage_nodes WHERE id='primary'",
              )
              .first()
          ).reserved_bytes,
          40,
        );
        const audit = await db
          .prepare(
            "SELECT * FROM audit_events WHERE action='upload.reserved' AND request_id=?",
          )
          .bind(requestId)
          .first();
        assert.equal(audit.actor_id, owner);
        assert.equal(audit.workspace_id, primary.workspace.id);
        assert.equal(audit.project_id, primary.project.id);
        assert.equal(audit.album_id, primary.album.id);
        assert.match(audit.occurred_at_utc, /Z$/);
        assert.deepEqual(JSON.parse(audit.after_json), session);

        const replay = await send('POST', '/api/v1/uploads/init', body);
        assert.equal(replay.status, 201);
        assert.deepEqual((await json(replay)).uploadSession, session);
        await expectCode(
          await send('POST', '/api/v1/uploads/init', {
            ...body,
            originalFilename: 'different.jpg',
          }),
          'REQUEST_ID_CONFLICT',
        );
        await expectCode(
          await send('POST', '/api/v1/workspaces', {
            name: 'Cross-operation collision',
            requestId,
          }),
          'REQUEST_ID_CONFLICT',
        );
        const read = await send('GET', `/api/v1/uploads/${session.id}`);
        assert.equal(read.status, 200, await read.clone().text());
        assert.deepEqual((await json(read)).uploadSession, session);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE action='upload.reserved' AND request_id=?",
              )
              .bind(requestId)
              .first()
          ).n,
          1,
        );
        await cancelAllFixtureSessions();
      },
    );

    await check(
      'D1 audit failure rolls back upload request, session, reservation and both quota counters',
      async () => {
        const requestId = randomUUID();
        await db.exec(
          "CREATE TRIGGER fail_upload_audit BEFORE INSERT ON audit_events WHEN NEW.action='upload.reserved' BEGIN SELECT RAISE(ABORT,'UPLOAD_AUDIT_INJECTED'); END;",
        );
        try {
          const response = await send(
            'POST',
            '/api/v1/uploads/init',
            initBody(secondary, 10, requestId),
          );
          assert.equal(response.status, 503);
          assert.equal(
            (
              await db
                .prepare(
                  'SELECT count(*) AS n FROM upload_requests WHERE request_id=?',
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
                  'SELECT count(*) AS n FROM upload_sessions WHERE created_request_id=?',
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
                  "SELECT reserved_bytes FROM storage_nodes WHERE id='primary'",
                )
                .first()
            ).reserved_bytes,
            0,
          );
        } finally {
          await db.exec('DROP TRIGGER fail_upload_audit');
        }
        const response = await send(
          'POST',
          '/api/v1/uploads/init',
          initBody(secondary, 10, requestId),
        );
        assert.equal(response.status, 201);
        await cancelAllFixtureSessions();
      },
    );

    await check(
      'D1 node and workspace quotas reject concurrent over-reservation at exact boundaries',
      async () => {
        const replies = await Promise.all([
          send('POST', '/api/v1/uploads/init', initBody(primary, 700)),
          send('POST', '/api/v1/uploads/init', initBody(secondary, 700)),
        ]);
        assert.equal(
          replies.filter((response) => response.status === 201).length,
          1,
        );
        const failure = replies.find((response) => response.status !== 201);
        assert.equal(failure?.status, 409);
        await expectCode(failure, 'STORAGE_QUOTA_EXCEEDED');
        assert.equal(
          (
            await db
              .prepare(
                "SELECT reserved_bytes FROM storage_nodes WHERE id='primary'",
              )
              .first()
          ).reserved_bytes,
          700,
        );
        const other = replies.find((response) => response.status === 201);
        const winning = (await json(other)).uploadSession;
        const winningScope =
          winning.workspaceId === primary.workspace.id ? primary : secondary;
        const otherScope = winningScope === primary ? secondary : primary;
        const exactlyFull = await send(
          'POST',
          '/api/v1/uploads/init',
          initBody(otherScope, 300),
        );
        assert.equal(exactlyFull.status, 201);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT reserved_bytes FROM storage_nodes WHERE id='primary'",
              )
              .first()
          ).reserved_bytes,
          1000,
        );
        await expectCode(
          await send('POST', '/api/v1/uploads/init', initBody(winningScope, 1)),
          'STORAGE_QUOTA_EXCEEDED',
        );
        await cancelAllFixtureSessions();

        await db
          .prepare('UPDATE workspaces SET quota_bytes=500 WHERE id=?')
          .bind(primary.workspace.id)
          .run();
        await expectCode(
          await send('POST', '/api/v1/uploads/init', initBody(primary, 501)),
          'STORAGE_QUOTA_EXCEEDED',
        );
        const atWorkspaceLimit = await send(
          'POST',
          '/api/v1/uploads/init',
          initBody(primary, 500),
        );
        assert.equal(atWorkspaceLimit.status, 201);
        await expectCode(
          await send('POST', '/api/v1/uploads/init', initBody(primary, 1)),
          'STORAGE_QUOTA_EXCEEDED',
        );
        await cancelAllFixtureSessions();
      },
    );

    await check(
      'D1 cancel is idempotent, releases counters once and blocks archive while reservation is active',
      async () => {
        const create = await send(
          'POST',
          '/api/v1/uploads/init',
          initBody(archival, 80),
        );
        assert.equal(create.status, 201);
        const session = (await json(create)).uploadSession;
        const archive = () =>
          send('PATCH', `/api/v1/albums/${archival.album.id}/archive`, {
            archived: true,
            expectedRevision: 1,
            requestId: randomUUID(),
          });
        const blocked = await archive();
        await expectCode(blocked, 'UPLOADS_IN_PROGRESS');

        const requestId = randomUUID();
        const cancelBody = { requestId };
        const cancelled = await send(
          'POST',
          `/api/v1/uploads/${session.id}/cancel`,
          cancelBody,
        );
        assert.equal(cancelled.status, 200);
        const result = (await json(cancelled)).uploadSession;
        assert.equal(result.status, 'cancelled');
        assert.equal(
          (
            await db
              .prepare(
                "SELECT reserved_bytes FROM storage_nodes WHERE id='primary'",
              )
              .first()
          ).reserved_bytes,
          0,
        );
        const replay = await send(
          'POST',
          `/api/v1/uploads/${session.id}/cancel`,
          cancelBody,
        );
        assert.equal(replay.status, 200);
        assert.deepEqual((await json(replay)).uploadSession, result);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE action='upload.cancelled' AND request_id=?",
              )
              .bind(requestId)
              .first()
          ).n,
          1,
        );
        await expectCode(
          await send('POST', `/api/v1/uploads/${session.id}/cancel`, {
            requestId: randomUUID(),
          }),
          'INVALID_STATE_TRANSITION',
        );
        const archived = await archive();
        assert.equal(archived.status, 200);
        await expectCode(
          await send('POST', '/api/v1/uploads/init', initBody(archival, 1)),
          'NOT_FOUND',
        );
      },
    );

    await check(
      'D1 init and empty album archive serialize without leaving an upload reservation on archived content',
      async () => {
        const raceAlbum = await send(
          'POST',
          `/api/v1/projects/${archival.project.id}/albums`,
          { name: 'Race album', requestId: randomUUID() },
        );
        assert.equal(raceAlbum.status, 201);
        const album = (await json(raceAlbum)).album;
        const scope = { ...archival, album };
        const uploadPromise = send(
          'POST',
          '/api/v1/uploads/init',
          initBody(scope, 20),
        );
        const archivePromise = send(
          'PATCH',
          `/api/v1/albums/${album.id}/archive`,
          { archived: true, expectedRevision: 1, requestId: randomUUID() },
        );
        const [uploadResponse, archiveResponse] = await Promise.all([
          uploadPromise,
          archivePromise,
        ]);
        if (uploadResponse.status === 201) {
          assert.equal(archiveResponse.status, 409);
          await expectCode(archiveResponse, 'UPLOADS_IN_PROGRESS');
          const session = (await json(uploadResponse)).uploadSession;
          await send('POST', `/api/v1/uploads/${session.id}/cancel`, {
            requestId: randomUUID(),
          });
        } else {
          assert.equal(uploadResponse.status, 404);
          assert.equal(archiveResponse.status, 200);
          await expectCode(uploadResponse, 'NOT_FOUND');
        }
      },
    );

    await check(
      'D1 Cron expires stale reservations once and appends system audit without deleting objects',
      async () => {
        const response = await send(
          'POST',
          '/api/v1/uploads/init',
          initBody(scopeOnly, 60),
        );
        assert.equal(response.status, 201);
        const session = (await json(response)).uploadSession;
        const eventTime = Date.parse(session.expiresAt) + 1;
        await worker.scheduled({
          scheduledTime: eventTime,
          cron: '*/5 * * * *',
        });
        const read = await send('GET', `/api/v1/uploads/${session.id}`);
        assert.equal((await json(read)).uploadSession.status, 'expired');
        const audit = await db
          .prepare(
            "SELECT * FROM audit_events WHERE action='upload.expired' AND request_id=?",
          )
          .bind(`reservation-expired:${session.id}`)
          .first();
        assert.equal(audit.actor_type, 'system');
        assert.equal(audit.actor_id, null);
        assert.equal(audit.workspace_id, scopeOnly.workspace.id);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT reserved_bytes FROM storage_nodes WHERE id='primary'",
              )
              .first()
          ).reserved_bytes,
          0,
        );
        await worker.scheduled({
          scheduledTime: eventTime,
          cron: '*/5 * * * *',
        });
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE action='upload.expired' AND request_id=?",
              )
              .bind(`reservation-expired:${session.id}`)
              .first()
          ).n,
          1,
        );
        await expectCode(
          await send('POST', `/api/v1/uploads/${session.id}/cancel`, {
            requestId: randomUUID(),
          }),
          'INVALID_STATE_TRANSITION',
        );
      },
    );

    await check(
      'R2 authorization verifies exact byte length, MIME, checksum and image bytes despite forged fence metadata',
      async () => {
        const image = pngFixture();
        const sha256 = createHash('sha256').update(image).digest('hex');
        const body = {
          ...initBody(primary, image.byteLength),
          originalFilename: 'proof.png',
          contentType: 'image/png',
          sha256,
        };
        const created = await send('POST', '/api/v1/uploads/init', body);
        assert.equal(created.status, 201);
        const session = (await json(created)).uploadSession;
        const requestId = randomUUID();
        const authBody = { requestId };
        const authorized = await send(
          'POST',
          `/api/v1/uploads/${session.id}/authorize`,
          authBody,
        );
        assert.equal(authorized.status, 200);
        const grant = (await json(authorized)).uploadAuthorization;
        assert.equal(grant.contentLength, image.byteLength);
        assert.deepEqual(grant.headers, {
          'Content-Type': 'image/png',
          'If-None-Match': '*',
          'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString(
            'base64',
          ),
        });
        const signed = new URL(grant.url);
        assert.equal(
          signed.searchParams.get('X-Amz-SignedHeaders'),
          'content-length;content-type;host;if-none-match;x-amz-checksum-sha256',
        );
        assert.equal(signed.searchParams.get('X-Amz-Expires'), '600');
        assert.ok(signed.pathname.endsWith('/original'));
        await assert.rejects(
          db
            .prepare(
              "UPDATE upload_sessions SET status='expired',updated_at_ms=?,updated_by_request_id='reservation-expired:'||id,updated_by_session_id=NULL,updated_by_actor_type='system' WHERE id=?",
            )
            .bind(Date.parse(session.expiresAt) + 1, session.id)
            .run(),
          /UPLOAD_KEY_NOT_FENCED/,
        );
        const replay = await send(
          'POST',
          `/api/v1/uploads/${session.id}/authorize`,
          authBody,
        );
        assert.equal(replay.status, 200);
        assert.equal((await json(replay)).uploadAuthorization.url, grant.url);
        await expectCode(
          await send('POST', `/api/v1/uploads/${session.id}/authorize`, {
            requestId: randomUUID(),
          }),
          'UPLOAD_ALREADY_AUTHORIZED',
        );

        const key = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(session.id)
          .first();
        await storage.put(key.object_key, image, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          customMetadata: { kinoUploadFence: session.id },
          sha256: Buffer.from(sha256, 'hex'),
        });
        await worker.scheduled({
          scheduledTime: Date.parse(session.expiresAt) + 1,
          cron: '*/5 * * * *',
        });
        assert.equal(
          (await json(await send('GET', `/api/v1/uploads/${session.id}`)))
            .uploadSession.status,
          'reserved',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(primary.workspace.id)
              .first()
          ).reserved_bytes,
          image.byteLength,
        );
        const completeBody = { requestId: randomUUID() };
        const completed = await send(
          'POST',
          `/api/v1/uploads/${session.id}/complete`,
          completeBody,
        );
        assert.equal(completed.status, 200);
        const result = (await json(completed)).completion;
        assert.equal(result.status, 'completed');
        assert.equal(result.actualBytes, image.byteLength);
        assert.equal(result.width, 1);
        assert.equal(result.height, 1);
        const dimensions = await db
          .prepare('SELECT width,height FROM photo_versions WHERE id=?')
          .bind(result.versionId)
          .first();
        assert.deepEqual(dimensions, { width: 1, height: 1 });
        assert.match(result.photoId, /^[0-9a-f-]{36}$/i);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(primary.workspace.id)
              .first()
          ).used_bytes,
          image.byteLength,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
              )
              .first()
          ).reserved_bytes,
          0,
        );
        assert.equal(
          (
            await db
              .prepare('SELECT count(*) AS n FROM photo_assets WHERE id=?')
              .bind(result.assetId)
              .first()
          ).n,
          1,
        );
        assert.equal(
          (await json(await send('GET', `/api/v1/uploads/${session.id}`)))
            .uploadSession.status,
          'completed',
        );
        const completeReplay = await send(
          'POST',
          `/api/v1/uploads/${session.id}/complete`,
          completeBody,
        );
        assert.deepEqual((await json(completeReplay)).completion, result);
        await expectCode(
          await send('POST', `/api/v1/uploads/${session.id}/cancel`, {
            requestId: randomUUID(),
          }),
          'UPLOAD_ALREADY_COMPLETED',
        );
      },
    );

    await check(
      'authorized cancellation fences its immutable key before releasing the reservation',
      async () => {
        const image = new Uint8Array([255, 216, 255, 0]);
        const sha256 = createHash('sha256').update(image).digest('hex');
        const created = await send('POST', '/api/v1/uploads/init', {
          ...initBody(primary, image.byteLength),
          contentType: 'image/jpeg',
          sha256,
        });
        const session = (await json(created)).uploadSession;
        assert.equal(created.status, 201);
        const authorized = await send(
          'POST',
          `/api/v1/uploads/${session.id}/authorize`,
          { requestId: randomUUID() },
        );
        assert.equal(authorized.status, 200);
        const row = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(session.id)
          .first();
        const cancelled = await send(
          'POST',
          `/api/v1/uploads/${session.id}/cancel`,
          { requestId: randomUUID() },
        );
        assert.equal(cancelled.status, 200);
        const fence = await storage.head(row.object_key);
        assert.equal(fence?.customMetadata?.kinoUploadFence, session.id);
        const latePut = await storage.put(row.object_key, image, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/jpeg' },
          sha256: Buffer.from(sha256, 'hex'),
        });
        assert.equal(latePut, null);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM upload_key_fences WHERE upload_session_id=?',
              )
              .bind(session.id)
              .first()
          ).n,
          1,
        );
      },
    );

    await check(
      'forged fence metadata on an uploaded object cannot release a cancelled reservation',
      async () => {
        const image = new Uint8Array([255, 216, 255, 0]);
        const sha256 = createHash('sha256').update(image).digest('hex');
        const created = await send('POST', '/api/v1/uploads/init', {
          ...initBody(secondary, image.byteLength),
          contentType: 'image/jpeg',
          sha256,
        });
        assert.equal(created.status, 201);
        const session = (await json(created)).uploadSession;
        assert.equal(
          (
            await send('POST', `/api/v1/uploads/${session.id}/authorize`, {
              requestId: randomUUID(),
            })
          ).status,
          200,
        );
        const row = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(session.id)
          .first();
        await storage.put(row.object_key, image, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { kinoUploadFence: session.id },
          sha256: Buffer.from(sha256, 'hex'),
        });

        const cancelled = await send(
          'POST',
          `/api/v1/uploads/${session.id}/cancel`,
          { requestId: randomUUID() },
        );
        assert.equal(cancelled.status, 409);
        await expectCode(cancelled, 'UPLOAD_OBJECT_EXISTS');
        assert.equal(
          (await json(await send('GET', `/api/v1/uploads/${session.id}`)))
            .uploadSession.status,
          'reserved',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(secondary.workspace.id)
              .first()
          ).reserved_bytes,
          image.byteLength,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM upload_key_fences WHERE upload_session_id=?',
              )
              .bind(session.id)
              .first()
          ).n,
          0,
        );

        await storage.delete(row.object_key);
        const retry = await send(
          'POST',
          `/api/v1/uploads/${session.id}/cancel`,
          { requestId: randomUUID() },
        );
        assert.equal(retry.status, 200);
        const marker = await storage.head(row.object_key);
        assert.equal(marker?.size, 0);
        assert.equal(
          marker?.httpMetadata?.contentType,
          'application/x-kino-pic-upload-fence',
        );
        assert.equal(marker?.customMetadata?.kinoUploadFence, session.id);
      },
    );

    await check(
      'signed reservation expiry writes a durable R2 fence before releasing bytes; corrupt objects go to review without quota release',
      async () => {
        const image = pngFixture();
        const sha256 = createHash('sha256').update(image).digest('hex');
        const created = await send('POST', '/api/v1/uploads/init', {
          ...initBody(scopeOnly, image.byteLength),
          contentType: 'image/png',
          sha256,
        });
        assert.equal(created.status, 201);
        const session = (await json(created)).uploadSession;
        assert.equal(
          (
            await send('POST', `/api/v1/uploads/${session.id}/authorize`, {
              requestId: randomUUID(),
            })
          ).status,
          200,
        );
        const key = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(session.id)
          .first();
        const eventTime = Date.parse(session.expiresAt) + 1;
        await Promise.all([
          worker.scheduled({ scheduledTime: eventTime, cron: '*/5 * * * *' }),
          worker.scheduled({ scheduledTime: eventTime, cron: '*/5 * * * *' }),
        ]);
        assert.equal(
          (await json(await send('GET', `/api/v1/uploads/${session.id}`)))
            .uploadSession.status,
          'expired',
        );
        const marker = await storage.head(key.object_key);
        assert.equal(marker?.size, 0);
        assert.equal(
          marker?.httpMetadata?.contentType,
          'application/x-kino-pic-upload-fence',
        );
        assert.equal(marker?.customMetadata?.kinoUploadFence, session.id);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(scopeOnly.workspace.id)
              .first()
          ).reserved_bytes,
          0,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM upload_key_fences WHERE upload_session_id=?',
              )
              .bind(session.id)
              .first()
          ).n,
          1,
        );

        const spoofImage = new Uint8Array([255, 216, 255, 1]);
        const spoofHash = createHash('sha256').update(spoofImage).digest('hex');
        const spoofCreated = await send('POST', '/api/v1/uploads/init', {
          ...initBody(secondary, spoofImage.byteLength),
          contentType: 'image/jpeg',
          sha256: spoofHash,
        });
        assert.equal(spoofCreated.status, 201);
        const spoofSession = (await json(spoofCreated)).uploadSession;
        assert.equal(
          (
            await send('POST', `/api/v1/uploads/${spoofSession.id}/authorize`, {
              requestId: randomUUID(),
            })
          ).status,
          200,
        );
        const spoofKey = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(spoofSession.id)
          .first();
        await storage.put(spoofKey.object_key, spoofImage, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/jpeg' },
          customMetadata: { kinoUploadFence: spoofSession.id },
          sha256: Buffer.from(spoofHash, 'hex'),
        });
        await worker.scheduled({
          scheduledTime: Date.parse(spoofSession.expiresAt) + 1,
          cron: '*/5 * * * *',
        });
        assert.equal(
          (await json(await send('GET', `/api/v1/uploads/${spoofSession.id}`)))
            .uploadSession.status,
          'reserved',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(secondary.workspace.id)
              .first()
          ).reserved_bytes,
          spoofImage.byteLength,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM upload_key_fences WHERE upload_session_id=?',
              )
              .bind(spoofSession.id)
              .first()
          ).n,
          0,
        );
        await storage.delete(spoofKey.object_key);
        await worker.scheduled({
          scheduledTime: Date.parse(spoofSession.expiresAt) + 1,
          cron: '*/5 * * * *',
        });
        assert.equal(
          (await json(await send('GET', `/api/v1/uploads/${spoofSession.id}`)))
            .uploadSession.status,
          'expired',
        );
        const expiryMarker = await storage.head(spoofKey.object_key);
        assert.equal(expiryMarker?.size, 0);
        assert.equal(
          expiryMarker?.httpMetadata?.contentType,
          'application/x-kino-pic-upload-fence',
        );
        assert.equal(
          expiryMarker?.customMetadata?.kinoUploadFence,
          spoofSession.id,
        );

        const invalid = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
        const expectedHash = createHash('sha256').update(image).digest('hex');
        const bad = await send('POST', '/api/v1/uploads/init', {
          ...initBody(scopeOnly, invalid.byteLength),
          contentType: 'image/png',
          sha256: expectedHash,
        });
        assert.equal(bad.status, 201);
        const badSession = (await json(bad)).uploadSession;
        await send('POST', `/api/v1/uploads/${badSession.id}/authorize`, {
          requestId: randomUUID(),
        });
        const badKey = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(badSession.id)
          .first();
        await storage.put(badKey.object_key, invalid, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          sha256: Buffer.from(
            createHash('sha256').update(invalid).digest('hex'),
            'hex',
          ),
        });
        const response = await send(
          'POST',
          `/api/v1/uploads/${badSession.id}/complete`,
          { requestId: randomUUID() },
        );
        assert.equal(response.status, 422);
        await expectCode(response, 'UPLOAD_CONTENT_INVALID');
        assert.equal(
          (await json(await send('GET', `/api/v1/uploads/${badSession.id}`)))
            .uploadSession.status,
          'needs_review',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(scopeOnly.workspace.id)
              .first()
          ).reserved_bytes,
          invalid.byteLength,
        );
        await worker.scheduled({
          scheduledTime: Date.parse(badSession.expiresAt) + 1,
          cron: '*/5 * * * *',
        });
        assert.equal(
          (
            await db
              .prepare(
                'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(scopeOnly.workspace.id)
              .first()
          ).reserved_bytes,
          invalid.byteLength,
        );
      },
    );

    await check(
      'upload capabilities omit secrets; malformed and oversized image headers remain reserved for review',
      async () => {
        const capability = await send('GET', '/api/v1/uploads/capabilities');
        assert.equal(capability.status, 200);
        assert.deepEqual(await json(capability), {
          enabled: true,
          maxBrowserBytes: 67108864,
          maxPixels: 80000000,
          maxDimension: 32768,
        });
        assert.equal(
          (
            await send(
              'GET',
              '/api/v1/uploads/capabilities',
              undefined,
              base,
              '',
            )
          ).status,
          401,
        );
        for (const image of [
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          pngWithDimensions(32769, 1),
          pngWithDimensions(10000, 10000),
        ]) {
          const hash = createHash('sha256').update(image).digest('hex');
          const created = await send('POST', '/api/v1/uploads/init', {
            ...initBody(secondary, image.byteLength),
            contentType: 'image/png',
            sha256: hash,
          });
          assert.equal(created.status, 201);
          const session = (await json(created)).uploadSession;
          assert.equal(
            (
              await send('POST', `/api/v1/uploads/${session.id}/authorize`, {
                requestId: randomUUID(),
              })
            ).status,
            200,
          );
          const key = await db
            .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
            .bind(session.id)
            .first();
          await storage.put(key.object_key, image, {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: { contentType: 'image/png' },
            sha256: Buffer.from(hash, 'hex'),
          });
          const before = await db
            .prepare(
              'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
            )
            .bind(secondary.workspace.id)
            .first();
          const complete = await send(
            'POST',
            `/api/v1/uploads/${session.id}/complete`,
            { requestId: randomUUID() },
          );
          assert.equal(complete.status, 422);
          assert.equal(
            (await json(await send('GET', `/api/v1/uploads/${session.id}`)))
              .uploadSession.status,
            'needs_review',
          );
          assert.deepEqual(
            await db
              .prepare(
                'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
              )
              .bind(secondary.workspace.id)
              .first(),
            before,
          );
          assert.equal(
            (
              await db
                .prepare(
                  'SELECT count(*) AS n FROM upload_completions WHERE upload_session_id=?',
                )
                .bind(session.id)
                .first()
            ).n,
            0,
          );
        }
      },
    );

    await check(
      'D1 revoked Owner cannot replay reservation and direct session transitions remain guarded',
      async () => {
        const requestId = randomUUID();
        const body = initBody(scopeOnly, 12, requestId);
        const created = await send('POST', '/api/v1/uploads/init', body);
        assert.equal(created.status, 201);
        const session = (await json(created)).uploadSession;
        await db.prepare('UPDATE owners SET enabled=0').run();
        try {
          assert.equal(
            (await send('POST', '/api/v1/uploads/init', body)).status,
            403,
          );
        } finally {
          await db.prepare('UPDATE owners SET enabled=1').run();
        }
        await assert.rejects(
          db
            .prepare("UPDATE upload_sessions SET status='cancelled' WHERE id=?")
            .bind(session.id)
            .run(),
          /OWNER_REQUIRED/,
        );
        await assert.rejects(
          db
            .prepare('DELETE FROM upload_sessions WHERE id=?')
            .bind(session.id)
            .run(),
          /IMMUTABLE_UPLOAD_SESSION/,
        );
        await send('POST', `/api/v1/uploads/${session.id}/cancel`, {
          requestId: randomUUID(),
        });
      },
    );
  } finally {
    await db.prepare('UPDATE owners SET enabled=1').run();
    await cancelAllFixtureSessions();
    await db
      .prepare("UPDATE storage_nodes SET quota_bytes=? WHERE id='primary'")
      .bind(originalNode.quota_bytes)
      .run();
    for (const [workspaceId, quota] of originalWorkspaceQuotas) {
      await db
        .prepare('UPDATE workspaces SET quota_bytes=? WHERE id=?')
        .bind(quota, workspaceId)
        .run();
    }
  }
}
