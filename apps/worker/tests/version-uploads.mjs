import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';

export async function versionUploadChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  const versionWorker = await mf.getWorker('version-uploads-test');
  const storage = galleryFixture.storage;
  const ownerCookie = cookies.headers();
  const headers = () => ({
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
  });
  const send = (method, path, body) => {
    const init = { method, headers: headers() };
    if (body !== undefined) init.body = JSON.stringify(body);
    return versionWorker.fetch(new Request(new URL(path, base), init));
  };
  const appSend = (method, path, body) => {
    const init = { method, headers: headers() };
    if (body !== undefined) init.body = JSON.stringify(body);
    return request(path, init);
  };
  const readJson = async (response) => {
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    return value;
  };
  const expectCode = async (response, expectedStatus, code) => {
    const body = await readJson(response);
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    assert.equal(body?.error?.code, code, JSON.stringify(body));
    return body;
  };
  const rows = async (sql, ...values) => {
    const statement = db.prepare(sql);
    return (await statement.bind(...values).all()).results;
  };
  const first = async (sql, ...values) =>
    db
      .prepare(sql)
      .bind(...values)
      .first();
  const makeVersionInitBody = ({
    requestId = randomUUID(),
    originalFilename = 'version-addition.png',
    expectedRevision,
    expectedCurrentVersionId,
    changeType,
    changeNote,
    labels = [],
  }) => ({
    requestId,
    originalFilename,
    expectedBytes: uploadBytes.byteLength,
    contentType: 'image/png',
    sha256: uploadHash,
    expectedRevision,
    expectedCurrentVersionId,
    changeType,
    changeNote,
    labels,
    confirm: true,
  });
  const reserveVersion = async (photoId, body) => {
    const response = await send(
      'POST',
      '/api/v1/photos/' + photoId + '/versions/init',
      body,
    );
    assert.equal(response.status, 201, await response.clone().text());
    return readJson(response);
  };
  const authorizeAndPut = async (session) => {
    const authorizationResponse = await send(
      'POST',
      '/api/v1/uploads/' + session.id + '/authorize',
      { requestId: randomUUID() },
    );
    assert.equal(
      authorizationResponse.status,
      200,
      await authorizationResponse.clone().text(),
    );
    const authorization = await readJson(authorizationResponse);
    assert.equal(
      authorization.uploadAuthorization.contentLength,
      uploadBytes.byteLength,
    );
    const keyRow = await first(
      'SELECT object_key FROM upload_sessions WHERE id=?',
      session.id,
    );
    assert.ok(keyRow?.object_key);
    const put = await storage.put(
      keyRow.object_key,
      new Uint8Array(uploadBytes),
      {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'image/png' },
        sha256: Buffer.from(uploadHash, 'hex'),
      },
    );
    assert.ok(put);
    return keyRow.object_key;
  };
  const uploadBytes = await sharp({
    create: { width: 48, height: 24, channels: 3, background: '#368cba' },
  })
    .png()
    .toBuffer();
  const uploadHash = createHash('sha256').update(uploadBytes).digest('hex');

  const authenticated = await request('/api/auth/get-session', {
    headers: { Cookie: cookies.headers() },
  });
  assert.equal(authenticated.status, 200, await authenticated.clone().text());
  const authBody = await authenticated.json();
  assert.equal(authBody?.user?.id, owner);
  assert.ok(authBody?.session?.id);
  const ownerSessionId = authBody.session.id;

  let project;
  let album;
  let baseline;
  let versionInit;
  let versionInitBody;
  let versionCompletion;
  let versionCompleteBody;

  await check(
    'manual version upload capabilities are explicitly enabled only on the version test Worker',
    async () => {
      const enabled = await readJson(
        await send('GET', '/api/v1/version-uploads/capabilities'),
      );
      assert.deepEqual(enabled, { enabled: true });
      const disabledResponse = await request(
        '/api/v1/version-uploads/capabilities',
        { headers: { Cookie: ownerCookie } },
      );
      assert.equal(disabledResponse.status, 200);
      assert.deepEqual(await readJson(disabledResponse), { enabled: false });
    },
  );

  await check(
    'ordinary Owner upload creates the isolated manual project V1 baseline through the public API',
    async () => {
      const workspaceId = galleryFixture.context.workspace.id;
      const projectResponse = await appSend('POST', '/api/v1/projects', {
        workspaceId,
        name: 'Version upload fixture ' + randomUUID(),
        requestId: randomUUID(),
      });
      assert.equal(
        projectResponse.status,
        201,
        await projectResponse.clone().text(),
      );
      project = (await readJson(projectResponse)).project;
      assert.equal(project.workspaceId, workspaceId);
      assert.equal(project.versioningMode, 'manual');

      const albumResponse = await appSend(
        'POST',
        '/api/v1/projects/' + project.id + '/albums',
        {
          name: 'Version upload album ' + randomUUID(),
          requestId: randomUUID(),
        },
      );
      assert.equal(
        albumResponse.status,
        201,
        await albumResponse.clone().text(),
      );
      album = (await readJson(albumResponse)).album;

      const initRequestId = randomUUID();
      const initResponse = await appSend('POST', '/api/v1/uploads/init', {
        workspaceId,
        projectId: project.id,
        albumId: album.id,
        originalFilename: 'version-source.png',
        expectedBytes: uploadBytes.byteLength,
        contentType: 'image/png',
        sha256: uploadHash,
        requestId: initRequestId,
      });
      assert.equal(initResponse.status, 201, await initResponse.clone().text());
      const session = (await readJson(initResponse)).uploadSession;
      const authorizationRequestId = randomUUID();
      const authorizationResponse = await appSend(
        'POST',
        '/api/v1/uploads/' + session.id + '/authorize',
        { requestId: authorizationRequestId },
      );
      assert.equal(
        authorizationResponse.status,
        200,
        await authorizationResponse.clone().text(),
      );
      const authorization = (await readJson(authorizationResponse))
        .uploadAuthorization;
      assert.equal(authorization.uploadSessionId, session.id);
      assert.equal(authorization.contentLength, uploadBytes.byteLength);
      assert.equal(
        (
          await first(
            'SELECT request_id FROM upload_authorizations WHERE upload_session_id=?',
            session.id,
          )
        ).request_id,
        authorizationRequestId,
      );
      const keyRow = await first(
        'SELECT object_key FROM upload_sessions WHERE id=?',
        session.id,
      );
      assert.ok(keyRow?.object_key);
      const put = await storage.put(
        keyRow.object_key,
        new Uint8Array(uploadBytes),
        {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          sha256: Buffer.from(uploadHash, 'hex'),
        },
      );
      assert.ok(put);

      const completeRequestId = randomUUID();
      const completeResponse = await appSend(
        'POST',
        '/api/v1/uploads/' + session.id + '/complete',
        { requestId: completeRequestId },
      );
      assert.equal(
        completeResponse.status,
        200,
        await completeResponse.clone().text(),
      );
      baseline = (await readJson(completeResponse)).completion;
      assert.ok(baseline.photoId);
      assert.equal(baseline.versionNo, undefined);
      assert.equal(baseline.status, 'completed');
      const head = await first(
        'SELECT version_id,revision,last_command_id FROM photo_version_heads WHERE photo_id=?',
        baseline.photoId,
      );
      assert.deepEqual(head, {
        version_id: baseline.versionId,
        revision: 0,
        last_command_id: null,
      });
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM photos WHERE id=?',
            baseline.photoId,
          )
        ).n,
        1,
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
    },
  );

  await check(
    'generic upload endpoints cannot reserve or authorize a V2 target while their feature flag is off',
    async () => {
      const body = {
        requestId: randomUUID(),
        originalFilename: 'generic-bypass.png',
        expectedBytes: uploadBytes.byteLength,
        contentType: 'image/png',
        sha256: uploadHash,
        expectedRevision: 0,
        expectedCurrentVersionId: baseline.versionId,
        changeType: 'new_retouch',
        changeNote: '',
        labels: [],
        confirm: true,
      };
      await expectCode(
        await appSend('POST', '/api/v1/uploads/init', {
          workspaceId: galleryFixture.context.workspace.id,
          projectId: project.id,
          albumId: album.id,
          ...body,
        }),
        400,
        'INVALID_INPUT',
      );

      const init = await send(
        'POST',
        '/api/v1/photos/' + baseline.photoId + '/versions/init',
        body,
      );
      assert.equal(init.status, 201, await init.clone().text());
      const reserved = await readJson(init);
      await expectCode(
        await appSend(
          'POST',
          '/api/v1/uploads/' + reserved.uploadSession.id + '/authorize',
          { requestId: randomUUID() },
        ),
        503,
        'VERSION_UPLOADS_DISABLED',
      );
      await expectCode(
        await appSend(
          'POST',
          '/api/v1/uploads/' + reserved.uploadSession.id + '/complete',
          { requestId: randomUUID() },
        ),
        503,
        'VERSION_UPLOADS_DISABLED',
      );
      const canceled = await send(
        'POST',
        '/api/v1/uploads/' + reserved.uploadSession.id + '/cancel',
        { requestId: randomUUID() },
      );
      assert.equal(canceled.status, 200, await canceled.clone().text());
      const canceledBody = await readJson(canceled);
      assert.equal(canceledBody.uploadSession.status, 'cancelled');
      assert.equal(
        (
          await first(
            'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
            project.workspaceId,
          )
        ).reserved_bytes,
        0,
      );
    },
  );

  await check(
    'route-scoped V2 init returns a fixed target and recovery, and exact retry preserves the original session',
    async () => {
      const requestId = randomUUID();
      const body = {
        requestId,
        originalFilename: 'manual-retouch.png',
        expectedBytes: uploadBytes.byteLength,
        contentType: 'image/png',
        sha256: uploadHash,
        expectedRevision: 0,
        expectedCurrentVersionId: baseline.versionId,
        changeType: 'new_retouch',
        changeNote: 'Retouch pass one',
        labels: ['portrait', 'approved'],
        confirm: true,
      };
      versionInitBody = body;
      const beforeUsage = await first(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        project.workspaceId,
      );
      const init = await send(
        'POST',
        '/api/v1/photos/' + baseline.photoId + '/versions/init',
        body,
      );
      assert.equal(init.status, 201, await init.clone().text());
      versionInit = await readJson(init);
      assert.deepEqual(versionInit.target, {
        photoId: baseline.photoId,
        parentVersionId: baseline.versionId,
        expectedRevision: 0,
        changeType: 'new_retouch',
        changeNote: 'Retouch pass one',
        labels: ['portrait', 'approved'],
      });
      assert.equal(versionInit.uploadSession.status, 'reserved');
      assert.equal(
        versionInit.uploadSession.expectedBytes,
        uploadBytes.byteLength,
      );
      assert.deepEqual(
        await first(
          'SELECT photo_id,revision,last_command_id FROM photo_version_heads WHERE photo_id=?',
          baseline.photoId,
        ),
        { photo_id: baseline.photoId, revision: 0, last_command_id: null },
      );
      assert.deepEqual(
        await first(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          project.workspaceId,
        ),
        {
          used_bytes: beforeUsage.used_bytes,
          reserved_bytes: beforeUsage.reserved_bytes + uploadBytes.byteLength,
        },
      );

      const recovery = await send(
        'GET',
        '/api/v1/photos/' +
          baseline.photoId +
          '/versions/uploads/recovery?requestId=' +
          encodeURIComponent(requestId),
      );
      assert.equal(recovery.status, 200, await recovery.clone().text());
      const recovered = await readJson(recovery);
      assert.deepEqual(recovered.target, versionInit.target);
      assert.deepEqual(recovered.uploadSession, versionInit.uploadSession);

      const replay = await send(
        'POST',
        '/api/v1/photos/' + baseline.photoId + '/versions/init',
        body,
      );
      assert.equal(replay.status, 201, await replay.clone().text());
      assert.deepEqual(await readJson(replay), versionInit);

      const wrongPhotoRecovery = await send(
        'GET',
        '/api/v1/photos/' +
          randomUUID() +
          '/versions/uploads/recovery?requestId=' +
          encodeURIComponent(requestId),
      );
      await expectCode(wrongPhotoRecovery, 404, 'NOT_FOUND');
    },
  );

  await check(
    'wrong-photo and foreign-tenant recovery/init/complete paths cannot reveal or retarget the stored upload',
    async () => {
      const foreignUserId = randomUUID();
      const foreignWorkspaceId = randomUUID();
      const foreignProjectId = randomUUID();
      const foreignAlbumId = randomUUID();
      const foreignPhotoId = randomUUID();
      const foreignVersionId = randomUUID();
      const now = Date.now();
      const foreignHash = createHash('sha256')
        .update('foreign V1 marker')
        .digest('hex');
      await db
        .prepare(
          'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
        )
        .bind(
          foreignUserId,
          'Version upload foreign user',
          foreignUserId + '@example.invalid',
          now,
          now,
        )
        .run();
      await db
        .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
        .bind(foreignWorkspaceId, 'Foreign upload workspace', foreignUserId)
        .run();
      await db
        .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
        .bind(foreignProjectId, foreignWorkspaceId, 'Foreign upload project')
        .run();
      await db
        .prepare(
          "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
        )
        .bind(
          foreignAlbumId,
          foreignWorkspaceId,
          foreignProjectId,
          'Foreign album',
        )
        .run();
      await db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          foreignPhotoId,
          foreignWorkspaceId,
          foreignProjectId,
          foreignAlbumId,
          'foreign.png',
        )
        .run();
      await db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/png',48,24,'private')",
        )
        .bind(
          foreignVersionId,
          foreignWorkspaceId,
          foreignPhotoId,
          foreignUserId,
          foreignHash,
        )
        .run();

      const storedInit = await first(
        'SELECT request_id FROM upload_version_targets WHERE upload_session_id=?',
        versionInit.uploadSession.id,
      );
      const wrongPhotoRecovery = await send(
        'GET',
        '/api/v1/photos/' +
          foreignPhotoId +
          '/versions/uploads/recovery?requestId=' +
          encodeURIComponent(storedInit.request_id),
      );
      await expectCode(wrongPhotoRecovery, 404, 'NOT_FOUND');

      const foreignReplay = await send(
        'POST',
        '/api/v1/photos/' + foreignPhotoId + '/versions/init',
        {
          requestId: storedInit.request_id,
          originalFilename: 'manual-retouch.png',
          expectedBytes: uploadBytes.byteLength,
          contentType: 'image/png',
          sha256: uploadHash,
          expectedRevision: 0,
          expectedCurrentVersionId: foreignVersionId,
          changeType: 'new_retouch',
          changeNote: 'Retouch pass one',
          labels: ['portrait', 'approved'],
          confirm: true,
        },
      );
      await expectCode(foreignReplay, 404, 'NOT_FOUND');

      const wrongPhotoComplete = await send(
        'POST',
        '/api/v1/photos/' +
          foreignPhotoId +
          '/versions/' +
          versionInit.uploadSession.id +
          '/complete',
        { requestId: randomUUID() },
      );
      await expectCode(wrongPhotoComplete, 404, 'NOT_FOUND');
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM upload_version_completions WHERE upload_session_id=?',
            versionInit.uploadSession.id,
          )
        ).n,
        0,
      );
    },
  );
  await check(
    'V2 authorization, immutable local fixture PUT, and dedicated completion create private version 2 without switching the head',
    async () => {
      const session = versionInit.uploadSession;
      const authorization = await send(
        'POST',
        '/api/v1/uploads/' + session.id + '/authorize',
        { requestId: randomUUID() },
      );
      assert.equal(
        authorization.status,
        200,
        await authorization.clone().text(),
      );
      const grant = (await readJson(authorization)).uploadAuthorization;
      assert.equal(grant.contentLength, uploadBytes.byteLength);
      assert.equal(grant.headers['Content-Type'], 'image/png');

      const keyRow = await first(
        'SELECT object_key FROM upload_sessions WHERE id=?',
        session.id,
      );
      const put = await storage.put(
        keyRow.object_key,
        new Uint8Array(uploadBytes),
        {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          sha256: Buffer.from(uploadHash, 'hex'),
        },
      );
      assert.ok(put);

      const completeRequestId = randomUUID();
      const completeBody = { requestId: completeRequestId };
      versionCompleteBody = completeBody;
      const completePath =
        '/api/v1/photos/' +
        baseline.photoId +
        '/versions/' +
        session.id +
        '/complete';
      const completed = await send('POST', completePath, completeBody);
      assert.equal(completed.status, 200, await completed.clone().text());
      versionCompletion = await readJson(completed);
      assert.equal(versionCompletion.status, 'completed');
      assert.equal(versionCompletion.photoId, baseline.photoId);
      assert.equal(versionCompletion.versionNo, 2);
      assert.equal(versionCompletion.parentVersionId, baseline.versionId);
      assert.equal(versionCompletion.changeType, 'new_retouch');
      assert.equal(versionCompletion.changeNote, 'Retouch pass one');
      assert.deepEqual(versionCompletion.labels, ['portrait', 'approved']);

      const version = await first(
        'SELECT id,photo_id,version_no,parent_version_id,status,source_hash_sha256 FROM photo_versions WHERE id=?',
        versionCompletion.versionId,
      );
      assert.deepEqual(version, {
        id: versionCompletion.versionId,
        photo_id: baseline.photoId,
        version_no: 2,
        parent_version_id: baseline.versionId,
        status: 'private',
        source_hash_sha256: uploadHash,
      });
      const head = await first(
        'SELECT version_id,revision,last_command_id FROM photo_version_heads WHERE photo_id=?',
        baseline.photoId,
      );
      assert.deepEqual(head, {
        version_id: baseline.versionId,
        revision: 0,
        last_command_id: null,
      });
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM photos WHERE id=?',
            baseline.photoId,
          )
        ).n,
        1,
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
            baseline.photoId,
          )
        ).n,
        2,
      );
      const resultRow = await first(
        'SELECT * FROM upload_version_completions WHERE upload_session_id=?',
        session.id,
      );
      assert.equal(resultRow.actor_id, owner);
      assert.equal(resultRow.request_id, completeRequestId);
      assert.equal(resultRow.photo_id, baseline.photoId);
      assert.equal(resultRow.version_no, 2);
      assert.deepEqual(JSON.parse(resultRow.labels_json), [
        'portrait',
        'approved',
      ]);
      assert.deepEqual(JSON.parse(resultRow.result_json), versionCompletion);
      const audit = await first(
        'SELECT * FROM audit_events WHERE event_id=?',
        resultRow.event_id,
      );
      assert.equal(audit.action, 'photo.version.created');
      assert.equal(audit.actor_id, owner);
      assert.equal(audit.session_id, ownerSessionId);
      assert.equal(audit.photo_id, baseline.photoId);
      assert.equal(audit.version_id, versionCompletion.versionId);
      assert.equal(audit.request_id, completeRequestId);
      assert.equal(JSON.parse(audit.after_json).changeNote, 'Retouch pass one');

      const stored = await send('GET', '/api/v1/uploads/' + session.id);
      assert.equal(stored.status, 200, await stored.clone().text());
      assert.equal((await readJson(stored)).uploadSession.status, 'completed');
      const replay = await send('POST', completePath, completeBody);
      assert.equal(replay.status, 200, await replay.clone().text());
      assert.deepEqual(await readJson(replay), versionCompletion);
      await expectCode(
        await send('POST', '/api/v1/uploads/' + session.id + '/cancel', {
          requestId: randomUUID(),
        }),
        409,
        'UPLOAD_ALREADY_COMPLETED',
      );
    },
  );

  await check(
    'a reserved V3 keeps its original target across a head switch and mode change, then completes privately',
    async () => {
      const processed = await runImageProcessingJob({
        jobId: versionCompletion.assetId,
        jobs: new D1ImageProcessingRepository(db),
        objects: new R2ProcessingObjectStore(storage),
        processor: new LocalSharpImageProcessor(),
      });
      assert.equal(processed.status, 'succeeded');
      const readyDerivatives = await rows(
        "SELECT asset_kind FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
        versionCompletion.versionId,
      );
      assert.deepEqual(
        readyDerivatives.map((row) => row.asset_kind),
        ['preview', 'thumbnail'],
      );

      const usageBefore = await first(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        project.workspaceId,
      );
      const v3Body = makeVersionInitBody({
        originalFilename: 'manual-retouch-v3.png',
        expectedRevision: 0,
        expectedCurrentVersionId: baseline.versionId,
        changeType: 'new_retouch',
        changeNote: 'Retouch captured from V1 before switching current',
        labels: ['manual-v3'],
      });
      const v3Init = await reserveVersion(baseline.photoId, v3Body);
      assert.deepEqual(v3Init.target, {
        photoId: baseline.photoId,
        parentVersionId: baseline.versionId,
        expectedRevision: 0,
        changeType: 'new_retouch',
        changeNote: 'Retouch captured from V1 before switching current',
        labels: ['manual-v3'],
      });
      assert.equal(v3Init.uploadSession.status, 'reserved');
      const v3Key = await authorizeAndPut(v3Init.uploadSession);
      assert.equal(
        (
          await first(
            'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
            project.workspaceId,
          )
        ).reserved_bytes,
        usageBefore.reserved_bytes + uploadBytes.byteLength,
      );

      const switchToV2Response = await send(
        'POST',
        '/api/v1/photos/' + baseline.photoId + '/versions/set-current',
        {
          requestId: randomUUID(),
          expectedRevision: 0,
          expectedCurrentVersionId: baseline.versionId,
          versionId: versionCompletion.versionId,
          confirm: true,
        },
      );
      assert.equal(
        switchToV2Response.status,
        200,
        await switchToV2Response.clone().text(),
      );
      const switched = await readJson(switchToV2Response);
      assert.equal(switched.current.versionId, versionCompletion.versionId);
      assert.equal(switched.current.revision, 1);
      const projectRevision = await first(
        'SELECT revision FROM projects WHERE id=?',
        project.id,
      );
      const configuredMode = await (
        await mf.getWorker('project-versioning-test')
      ).fetch(
        new Request(
          new URL('/api/v1/projects/' + project.id + '/versioning', base),
          {
            method: 'PUT',
            headers: { ...headers(), 'X-Kino-Expected-Actor': owner },
            body: JSON.stringify({
              requestId: randomUUID(),
              expectedRevision: projectRevision.revision,
              mode: 'off',
              confirm: true,
            }),
          },
        ),
      );
      assert.equal(
        configuredMode.status,
        200,
        await configuredMode.clone().text(),
      );

      const replay = await send(
        'POST',
        '/api/v1/photos/' + baseline.photoId + '/versions/init',
        v3Body,
      );
      assert.equal(replay.status, 201, await replay.clone().text());
      assert.deepEqual(await readJson(replay), v3Init);
      const replayRecovery = await send(
        'GET',
        '/api/v1/photos/' +
          baseline.photoId +
          '/versions/uploads/recovery?requestId=' +
          encodeURIComponent(v3Body.requestId),
      );
      assert.equal(
        replayRecovery.status,
        200,
        await replayRecovery.clone().text(),
      );
      const recoveredAfterSwitch = await readJson(replayRecovery);
      const authorizationRow = await first(
        'SELECT request_id,expires_at_ms FROM upload_authorizations WHERE upload_session_id=?',
        v3Init.uploadSession.id,
      );
      assert.ok(authorizationRow);
      assert.deepEqual(recoveredAfterSwitch, {
        initRequestId: v3Body.requestId,
        uploadSession: v3Init.uploadSession,
        contentType: 'image/png',
        sha256: uploadHash,
        authorizationRequestId: authorizationRow.request_id,
        authorizationExpiresAt: new Date(
          authorizationRow.expires_at_ms,
        ).toISOString(),
        target: v3Init.target,
      });

      const staleInitBody = makeVersionInitBody({
        originalFilename: 'stale-head-cas.png',
        expectedRevision: 0,
        expectedCurrentVersionId: baseline.versionId,
        changeType: 'replace_current',
        changeNote: 'A new stale CAS must not reserve',
      });
      const staleSnapshot = {
        targetCount: (
          await first(
            'SELECT count(*) AS n FROM upload_version_targets WHERE photo_id=?',
            baseline.photoId,
          )
        ).n,
        usage: await first(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          project.workspaceId,
        ),
      };
      await expectCode(
        await send(
          'POST',
          '/api/v1/photos/' + baseline.photoId + '/versions/init',
          staleInitBody,
        ),
        409,
        'PHOTO_VERSION_REVISION_CONFLICT',
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
            owner,
            staleInitBody.requestId,
          )
        ).n,
        0,
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM upload_version_targets WHERE photo_id=?',
            baseline.photoId,
          )
        ).n,
        staleSnapshot.targetCount,
      );
      assert.deepEqual(
        await first(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          project.workspaceId,
        ),
        staleSnapshot.usage,
      );

      const retouchWhileOff = makeVersionInitBody({
        originalFilename: 'off-mode-retouch.png',
        expectedRevision: 1,
        expectedCurrentVersionId: versionCompletion.versionId,
        changeType: 'new_retouch',
        changeNote: 'Must be rejected while mode is off',
      });
      await expectCode(
        await send(
          'POST',
          '/api/v1/photos/' + baseline.photoId + '/versions/init',
          retouchWhileOff,
        ),
        409,
        'VERSIONING_MODE_DISABLED',
      );

      const v3CompleteBody = { requestId: randomUUID() };
      const v3CompletePath =
        '/api/v1/photos/' +
        baseline.photoId +
        '/versions/' +
        v3Init.uploadSession.id +
        '/complete';
      const v3CompleteResponse = await send(
        'POST',
        v3CompletePath,
        v3CompleteBody,
      );
      assert.equal(
        v3CompleteResponse.status,
        200,
        await v3CompleteResponse.clone().text(),
      );
      const v3Completion = await readJson(v3CompleteResponse);
      assert.equal(v3Completion.photoId, baseline.photoId);
      assert.equal(v3Completion.versionNo, 3);
      assert.equal(v3Completion.parentVersionId, baseline.versionId);
      assert.equal(v3Completion.status, 'completed');
      const v3Version = await first(
        'SELECT id,photo_id,version_no,parent_version_id,status FROM photo_versions WHERE id=?',
        v3Completion.versionId,
      );
      assert.deepEqual(v3Version, {
        id: v3Completion.versionId,
        photo_id: baseline.photoId,
        version_no: 3,
        parent_version_id: baseline.versionId,
        status: 'private',
      });
      const headAfterV3 = await first(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
        baseline.photoId,
      );
      assert.deepEqual(headAfterV3, {
        version_id: versionCompletion.versionId,
        revision: 1,
      });
      assert.deepEqual(
        await first(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          project.workspaceId,
        ),
        {
          used_bytes: usageBefore.used_bytes + uploadBytes.byteLength,
          reserved_bytes: usageBefore.reserved_bytes,
        },
      );
      const v3Retry = await send('POST', v3CompletePath, v3CompleteBody);
      assert.equal(v3Retry.status, 200, await v3Retry.clone().text());
      assert.deepEqual(await readJson(v3Retry), v3Completion);

      const usageBeforeCancel = await first(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        project.workspaceId,
      );
      const replaceBody = makeVersionInitBody({
        originalFilename: 'off-mode-explicit-replace.png',
        expectedRevision: 1,
        expectedCurrentVersionId: versionCompletion.versionId,
        changeType: 'replace_current',
        changeNote: '',
      });
      const replaceInit = await reserveVersion(baseline.photoId, replaceBody);
      assert.equal(replaceInit.target.changeType, 'replace_current');
      assert.equal(
        replaceInit.target.parentVersionId,
        versionCompletion.versionId,
      );
      const replaceKeyRow = await first(
        'SELECT object_key FROM upload_sessions WHERE id=?',
        replaceInit.uploadSession.id,
      );
      assert.ok(replaceKeyRow?.object_key);
      assert.equal(await storage.head(replaceKeyRow.object_key), null);
      assert.equal(
        (
          await first(
            'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
            project.workspaceId,
          )
        ).reserved_bytes,
        usageBeforeCancel.reserved_bytes + uploadBytes.byteLength,
      );
      const replaceAuthorization = await send(
        'POST',
        '/api/v1/uploads/' + replaceInit.uploadSession.id + '/authorize',
        { requestId: randomUUID() },
      );
      assert.equal(
        replaceAuthorization.status,
        200,
        await replaceAuthorization.clone().text(),
      );
      const canceled = await send(
        'POST',
        '/api/v1/uploads/' + replaceInit.uploadSession.id + '/cancel',
        { requestId: randomUUID() },
      );
      assert.equal(canceled.status, 200, await canceled.clone().text());
      assert.equal(
        (await readJson(canceled)).uploadSession.status,
        'cancelled',
      );
      const fence = await storage.head(replaceKeyRow.object_key);
      assert.ok(fence, 'An authorized empty key must be fenced, not deleted');
      assert.equal(fence.size, 0);
      assert.equal(
        fence.customMetadata?.kinoUploadFence,
        replaceInit.uploadSession.id,
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM upload_key_fences WHERE upload_session_id=?',
            replaceInit.uploadSession.id,
          )
        ).n,
        1,
      );
      assert.deepEqual(
        await first(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          project.workspaceId,
        ),
        usageBeforeCancel,
      );
      assert.equal(
        v3Key,
        (
          await first(
            'SELECT object_key FROM upload_sessions WHERE id=?',
            v3Init.uploadSession.id,
          )
        ).object_key,
      );
    },
  );

  await check(
    'overlapping V2 reservations complete with unique version numbers and leave the selected head unchanged',
    async () => {
      const beforeHead = await first(
        'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
        baseline.photoId,
      );
      assert.deepEqual(beforeHead, {
        version_id: versionCompletion.versionId,
        revision: 1,
      });
      const usageBefore = await first(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        project.workspaceId,
      );
      const bodies = [4, 5].map((ordinal) =>
        makeVersionInitBody({
          originalFilename: 'overlap-' + ordinal + '.png',
          expectedRevision: 1,
          expectedCurrentVersionId: versionCompletion.versionId,
          changeType: 'replace_current',
          changeNote: 'Concurrent local fixture ' + ordinal,
        }),
      );
      const inits = await Promise.all(
        bodies.map((body) => reserveVersion(baseline.photoId, body)),
      );
      assert.ok(
        inits.every(
          (item) => item.target.parentVersionId === versionCompletion.versionId,
        ),
      );
      await Promise.all(
        inits.map((item) => authorizeAndPut(item.uploadSession)),
      );
      const responses = await Promise.all(
        inits.map((item) =>
          send(
            'POST',
            '/api/v1/photos/' +
              baseline.photoId +
              '/versions/' +
              item.uploadSession.id +
              '/complete',
            { requestId: randomUUID() },
          ),
        ),
      );
      const completions = [];
      for (const response of responses) {
        assert.equal(response.status, 200, await response.clone().text());
        completions.push(await readJson(response));
      }
      assert.deepEqual(
        completions.map((item) => item.versionNo).sort((a, b) => a - b),
        [4, 5],
      );
      assert.ok(
        completions.every(
          (item) =>
            item.photoId === baseline.photoId &&
            item.parentVersionId === versionCompletion.versionId &&
            item.status === 'completed',
        ),
      );
      const rowsByNo = await rows(
        'SELECT id,version_no,parent_version_id,status FROM photo_versions WHERE id IN(?,?) ORDER BY version_no',
        ...completions.map((item) => item.versionId),
      );
      assert.deepEqual(
        rowsByNo.map((row) => row.version_no),
        [4, 5],
      );
      assert.ok(rowsByNo.every((row) => row.status === 'private'));
      assert.ok(
        rowsByNo.every(
          (row) => row.parent_version_id === versionCompletion.versionId,
        ),
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM photos WHERE id=?',
            baseline.photoId,
          )
        ).n,
        1,
      );
      assert.deepEqual(
        await first(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
          baseline.photoId,
        ),
        beforeHead,
      );
      assert.deepEqual(
        await first(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          project.workspaceId,
        ),
        {
          used_bytes: usageBefore.used_bytes + uploadBytes.byteLength * 2,
          reserved_bytes: usageBefore.reserved_bytes,
        },
      );
    },
  );

  await check(
    'a V2 audit failure rolls back all D1 completion effects and the same request retries exactly once',
    async () => {
      const usageBefore = await first(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        project.workspaceId,
      );
      const maxVersionBefore = await first(
        'SELECT max(version_no) AS n FROM photo_versions WHERE photo_id=?',
        baseline.photoId,
      );
      const v2Body = makeVersionInitBody({
        originalFilename: 'audit-rollback-v2.png',
        expectedRevision: 1,
        expectedCurrentVersionId: versionCompletion.versionId,
        changeType: 'replace_current',
        changeNote: 'Retry after transactional audit failure',
      });
      const initialized = await reserveVersion(baseline.photoId, v2Body);
      await authorizeAndPut(initialized.uploadSession);
      const usageReserved = await first(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        project.workspaceId,
      );
      const before = {
        versions: (
          await first(
            'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
            baseline.photoId,
          )
        ).n,
        assets: (
          await first(
            'SELECT count(*) AS n FROM photo_assets WHERE photo_id=?',
            baseline.photoId,
          )
        ).n,
        jobs: (
          await first(
            'SELECT count(*) AS n FROM image_processing_jobs WHERE id IN(SELECT id FROM photo_assets WHERE photo_id=?)',
            baseline.photoId,
          )
        ).n,
        createdAudits: (
          await first(
            "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version.created'",
            baseline.photoId,
          )
        ).n,
      };
      const completionRequestId = randomUUID();
      const completionBody = { requestId: completionRequestId };
      const completionPath =
        '/api/v1/photos/' +
        baseline.photoId +
        '/versions/' +
        initialized.uploadSession.id +
        '/complete';
      let triggerCreated = false;
      try {
        await db.exec(
          "CREATE TRIGGER fail_photo_version_audit BEFORE INSERT ON audit_events WHEN NEW.action='photo.version.created' BEGIN SELECT RAISE(ABORT,'PHOTO_VERSION_AUDIT_INJECTED'); END;",
        );
        triggerCreated = true;
        const failed = await send('POST', completionPath, completionBody);
        const failureBody = await readJson(failed);
        assert.equal(failed.status, 503, JSON.stringify(failureBody));
        assert.equal(
          failureBody?.error?.code,
          'VERSION_UPLOAD_UNAVAILABLE',
          JSON.stringify(failureBody),
        );

        assert.deepEqual(
          await first(
            'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
            project.workspaceId,
          ),
          usageReserved,
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_version_completions WHERE upload_session_id=?',
              initialized.uploadSession.id,
            )
          ).n,
          0,
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM upload_completions WHERE upload_session_id=?',
              initialized.uploadSession.id,
            )
          ).n,
          0,
        );
        assert.equal(
          (
            await first(
              "SELECT count(*) AS n FROM upload_workflow_requests WHERE upload_session_id=? AND operation='upload.completed'",
              initialized.uploadSession.id,
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
          before.versions,
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM photo_assets WHERE photo_id=?',
              baseline.photoId,
            )
          ).n,
          before.assets,
        );
        assert.equal(
          (
            await first(
              'SELECT count(*) AS n FROM image_processing_jobs WHERE id IN(SELECT id FROM photo_assets WHERE photo_id=?)',
              baseline.photoId,
            )
          ).n,
          before.jobs,
        );
        assert.equal(
          (
            await first(
              "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version.created'",
              baseline.photoId,
            )
          ).n,
          before.createdAudits,
        );
        const stillReserved = await send(
          'GET',
          '/api/v1/uploads/' + initialized.uploadSession.id,
        );
        assert.equal(
          stillReserved.status,
          200,
          await stillReserved.clone().text(),
        );
        assert.equal(
          (await readJson(stillReserved)).uploadSession.status,
          'reserved',
        );
      } finally {
        if (triggerCreated)
          await db.exec('DROP TRIGGER fail_photo_version_audit');
      }

      const retried = await send('POST', completionPath, completionBody);
      assert.equal(retried.status, 200, await retried.clone().text());
      const completed = await readJson(retried);
      assert.equal(completed.status, 'completed');
      assert.equal(completed.photoId, baseline.photoId);
      assert.equal(completed.parentVersionId, versionCompletion.versionId);
      assert.equal(completed.versionNo, maxVersionBefore.n + 1);
      assert.deepEqual(
        await first(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          project.workspaceId,
        ),
        {
          used_bytes: usageBefore.used_bytes + uploadBytes.byteLength,
          reserved_bytes: usageBefore.reserved_bytes,
        },
      );
      assert.equal(
        (
          await first(
            "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version.created' AND request_id=?",
            baseline.photoId,
            completionRequestId,
          )
        ).n,
        1,
      );
      const exactReplay = await send('POST', completionPath, completionBody);
      assert.equal(exactReplay.status, 200, await exactReplay.clone().text());
      assert.deepEqual(await readJson(exactReplay), completed);
      assert.equal(
        (
          await first(
            "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version.created' AND request_id=?",
            baseline.photoId,
            completionRequestId,
          )
        ).n,
        1,
      );
    },
  );

  await check(
    'version upload target and completion rows reject update, delete, null, primary and alternate-key replacement',
    async () => {
      const targetRow = await first(
        'SELECT * FROM upload_version_targets WHERE upload_session_id=?',
        versionInit.uploadSession.id,
      );
      const completionRow = await first(
        'SELECT * FROM upload_version_completions WHERE upload_session_id=?',
        versionInit.uploadSession.id,
      );
      assert.ok(targetRow);
      assert.ok(completionRow);
      const targetCount = (
        await first(
          'SELECT count(*) AS n FROM upload_version_targets WHERE photo_id=?',
          baseline.photoId,
        )
      ).n;
      const completionCount = (
        await first(
          'SELECT count(*) AS n FROM upload_version_completions WHERE photo_id=?',
          baseline.photoId,
        )
      ).n;
      const auditCount = (
        await first(
          "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version.created'",
          baseline.photoId,
        )
      ).n;
      const targetColumns = Object.keys(targetRow);
      const completionColumns = Object.keys(completionRow);
      const insertOrReplace = async (table, columns, row) =>
        db
          .prepare(
            'INSERT OR REPLACE INTO ' +
              table +
              ' (' +
              columns.join(',') +
              ') VALUES (' +
              columns.map(() => '?').join(',') +
              ')',
          )
          .bind(...columns.map((column) => row[column]))
          .run();
      const assertTargetPreserved = async (label, operation) => {
        await assert.rejects(
          operation,
          /IMMUTABLE_UPLOAD_VERSION_TARGET/,
          label,
        );
        assert.deepEqual(
          await first(
            'SELECT * FROM upload_version_targets WHERE upload_session_id=?',
            versionInit.uploadSession.id,
          ),
          targetRow,
          label + ': original target changed',
        );
      };
      const assertCompletionPreserved = async (label, operation) => {
        await assert.rejects(
          operation,
          /IMMUTABLE_UPLOAD_VERSION_COMPLETION/,
          label,
        );
        assert.deepEqual(
          await first(
            'SELECT * FROM upload_version_completions WHERE upload_session_id=?',
            versionInit.uploadSession.id,
          ),
          completionRow,
          label + ': original completion changed',
        );
      };

      await assertTargetPreserved(
        'target UPDATE',
        db
          .prepare(
            'UPDATE upload_version_targets SET change_note=? WHERE upload_session_id=?',
          )
          .bind('tampered target', versionInit.uploadSession.id)
          .run(),
      );
      await assertTargetPreserved(
        'target DELETE',
        db
          .prepare(
            'DELETE FROM upload_version_targets WHERE upload_session_id=?',
          )
          .bind(versionInit.uploadSession.id)
          .run(),
      );
      await assertTargetPreserved(
        'target primary-key REPLACE',
        insertOrReplace('upload_version_targets', targetColumns, {
          ...targetRow,
          change_note: targetRow.change_note + ' changed',
        }),
      );
      await assertTargetPreserved(
        'target actor/request alternate-key REPLACE',
        insertOrReplace('upload_version_targets', targetColumns, {
          ...targetRow,
          upload_session_id: randomUUID(),
          change_note: targetRow.change_note + ' changed',
        }),
      );
      await assertTargetPreserved(
        'target NULL primary-key insert',
        insertOrReplace('upload_version_targets', targetColumns, {
          ...targetRow,
          upload_session_id: null,
        }),
      );

      await assertCompletionPreserved(
        'completion UPDATE',
        db
          .prepare(
            'UPDATE upload_version_completions SET change_note=? WHERE upload_session_id=?',
          )
          .bind('tampered completion', versionInit.uploadSession.id)
          .run(),
      );
      await assertCompletionPreserved(
        'completion DELETE',
        db
          .prepare(
            'DELETE FROM upload_version_completions WHERE upload_session_id=?',
          )
          .bind(versionInit.uploadSession.id)
          .run(),
      );
      await assertCompletionPreserved(
        'completion primary-key REPLACE',
        insertOrReplace('upload_version_completions', completionColumns, {
          ...completionRow,
          change_note: completionRow.change_note + ' changed',
        }),
      );
      await assertCompletionPreserved(
        'completion actor/request alternate-key REPLACE',
        insertOrReplace('upload_version_completions', completionColumns, {
          ...completionRow,
          upload_session_id: randomUUID(),
          request_id: completionRow.request_id,
          version_id: randomUUID(),
          asset_id: randomUUID(),
          event_id: 'photo-version-created:' + randomUUID(),
          photo_id: randomUUID(),
          version_no: completionRow.version_no + 100,
        }),
      );
      await assertCompletionPreserved(
        'completion version-id alternate-key REPLACE',
        insertOrReplace('upload_version_completions', completionColumns, {
          ...completionRow,
          upload_session_id: randomUUID(),
          request_id: randomUUID(),
          asset_id: randomUUID(),
          event_id: 'photo-version-created:' + randomUUID(),
          photo_id: randomUUID(),
          version_no: completionRow.version_no + 100,
        }),
      );
      await assertCompletionPreserved(
        'completion asset-id alternate-key REPLACE',
        insertOrReplace('upload_version_completions', completionColumns, {
          ...completionRow,
          upload_session_id: randomUUID(),
          request_id: randomUUID(),
          version_id: randomUUID(),
          event_id: 'photo-version-created:' + randomUUID(),
          photo_id: randomUUID(),
          version_no: completionRow.version_no + 100,
        }),
      );
      await assertCompletionPreserved(
        'completion event-id alternate-key REPLACE',
        insertOrReplace('upload_version_completions', completionColumns, {
          ...completionRow,
          upload_session_id: randomUUID(),
          request_id: randomUUID(),
          version_id: randomUUID(),
          asset_id: randomUUID(),
          photo_id: randomUUID(),
          version_no: completionRow.version_no + 100,
        }),
      );
      await assertCompletionPreserved(
        'completion photo/version-number alternate-key REPLACE',
        insertOrReplace('upload_version_completions', completionColumns, {
          ...completionRow,
          upload_session_id: randomUUID(),
          request_id: randomUUID(),
          version_id: randomUUID(),
          asset_id: randomUUID(),
          event_id: 'photo-version-created:' + randomUUID(),
        }),
      );
      await assertCompletionPreserved(
        'completion NULL primary-key insert',
        insertOrReplace('upload_version_completions', completionColumns, {
          ...completionRow,
          upload_session_id: null,
        }),
      );

      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM upload_version_targets WHERE photo_id=?',
            baseline.photoId,
          )
        ).n,
        targetCount,
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM upload_version_completions WHERE photo_id=?',
            baseline.photoId,
          )
        ).n,
        completionCount,
      );
      assert.equal(
        (
          await first(
            "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version.created'",
            baseline.photoId,
          )
        ).n,
        auditCount,
      );
    },
  );

  await check(
    'disabling the current Owner blocks stored init, recovery, and completion replay before result access',
    async () => {
      const ownerRow = await first(
        'SELECT enabled FROM owners WHERE user_id=?',
        owner,
      );
      assert.equal(ownerRow?.enabled, 1);
      try {
        await db
          .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
          .bind(owner)
          .run();
        await expectCode(
          await send(
            'POST',
            '/api/v1/photos/' + baseline.photoId + '/versions/init',
            versionInitBody,
          ),
          403,
          'OWNER_REQUIRED',
        );
        await expectCode(
          await send(
            'GET',
            '/api/v1/photos/' +
              baseline.photoId +
              '/versions/uploads/recovery?requestId=' +
              encodeURIComponent(versionInitBody.requestId),
          ),
          403,
          'OWNER_REQUIRED',
        );
        await expectCode(
          await send(
            'POST',
            '/api/v1/photos/' +
              baseline.photoId +
              '/versions/' +
              versionInit.uploadSession.id +
              '/complete',
            versionCompleteBody,
          ),
          403,
          'OWNER_REQUIRED',
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=? WHERE user_id=?')
          .bind(ownerRow.enabled, owner)
          .run();
      }
      const restoredInit = await send(
        'POST',
        '/api/v1/photos/' + baseline.photoId + '/versions/init',
        versionInitBody,
      );
      assert.equal(restoredInit.status, 201, await restoredInit.clone().text());
      assert.deepEqual(await readJson(restoredInit), versionInit);

      await assert.rejects(
        db
          .prepare('UPDATE upload_sessions SET expires_at_ms=? WHERE id=?')
          .bind(Date.now() - 1, versionInit.uploadSession.id)
          .run(),
        /UPLOAD_ALREADY_COMPLETED/,
      );
      const completedStatus = await send(
        'GET',
        '/api/v1/uploads/' + versionInit.uploadSession.id,
      );
      assert.equal(
        completedStatus.status,
        200,
        await completedStatus.clone().text(),
      );
      assert.equal(
        (await readJson(completedStatus)).uploadSession.status,
        'completed',
      );
    },
  );
}
