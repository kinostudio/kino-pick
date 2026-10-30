import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingReviewStore } from '../src/processing-review-storage.ts';
import { pngWithDimensions } from './image-fixtures.mjs';

export async function ownerExternalIntentChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
  setInterleaveHook,
}) {
  const ownerCookie = cookies.headers();
  const storage = galleryFixture.storage;
  assert.ok(storage, 'The gallery fixture must include its R2 test bucket');
  assert.equal(typeof setInterleaveHook, 'function');
  const storageWorker = await mf.getWorker('storage-test');
  const configWorker = await mf.getWorker('project-versioning-test');
  const applicationWorker = await mf.getWorker('app');
  let barrierReleaseTimer = null;
  const appHeaders = () => ({
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
  });
  const configHeaders = () => ({
    ...appHeaders(),
    'X-Kino-Expected-Actor': owner,
  });
  const appSend = (method, path, body) => {
    const init = { method, headers: appHeaders() };
    if (body !== undefined) init.body = JSON.stringify(body);
    return request(path, init);
  };
  const configSend = (method, path, body) => {
    const init = { method, headers: configHeaders() };
    if (body !== undefined) init.body = JSON.stringify(body);
    return configWorker.fetch(new Request(new URL(path, base), init));
  };
  const first = async (sql, ...values) =>
    db
      .prepare(sql)
      .bind(...values)
      .first();
  const all = async (sql, ...values) =>
    (
      await db
        .prepare(sql)
        .bind(...values)
        .all()
    ).results;
  const readJson = async (response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const expectStatus = async (response, status, code) => {
    const body = await readJson(response);
    assert.equal(response.status, status, JSON.stringify(body));
    if (code) assert.equal(body?.error?.code, code, JSON.stringify(body));
    return body;
  };
  const authenticated = await request('/api/auth/get-session', {
    headers: { Cookie: ownerCookie },
  });
  const authBody = await readJson(authenticated);
  assert.equal(authenticated.status, 200, JSON.stringify(authBody));
  assert.equal(authBody?.user?.id, owner);
  assert.ok(authBody?.session?.id);
  const sessionId = authBody.session.id;
  assert.ok(
    await first(
      'SELECT id FROM owner_sessions WHERE userId=? AND id=? AND expiresAt>? LIMIT 1',
      owner,
      sessionId,
      Date.now() + 60000,
    ),
    'Expected the Owner cookie to resolve to a live session',
  );

  const projectScope = async (label) => {
    const projectResponse = await appSend('POST', '/api/v1/projects', {
      workspaceId: galleryFixture.context.workspace.id,
      name: 'External intent ' + label + ' ' + randomUUID(),
      requestId: randomUUID(),
    });
    assert.equal(
      projectResponse.status,
      201,
      await projectResponse.clone().text(),
    );
    const project = (await readJson(projectResponse)).project;
    assert.ok(project?.id);
    const albumResponse = await appSend(
      'POST',
      '/api/v1/projects/' + project.id + '/albums',
      { name: 'Intent ' + label, requestId: randomUUID() },
    );
    assert.equal(albumResponse.status, 201, await albumResponse.clone().text());
    return {
      workspaceId: galleryFixture.context.workspace.id,
      projectId: project.id,
      albumId: (await readJson(albumResponse)).album.id,
    };
  };
  const readProjectMode = async (projectId) => {
    const response = await configSend(
      'GET',
      '/api/v1/projects/' + projectId + '/versioning',
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const setProjectMode = async (projectId, mode, requestId = randomUUID()) => {
    const current = await readProjectMode(projectId);
    const response = await configSend(
      'PUT',
      '/api/v1/projects/' + projectId + '/versioning',
      { requestId, expectedRevision: current.revision, mode, confirm: true },
    );
    return { response, body: await readJson(response), before: current };
  };
  const quota = async (workspaceId) => {
    const [workspace, node] = await Promise.all([
      first(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        workspaceId,
      ),
      first(
        "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
      ),
    ]);
    assert.ok(node, 'Expected the primary storage node');
    return {
      workspaceUsed: workspace?.used_bytes ?? 0,
      workspaceReserved: workspace?.reserved_bytes ?? 0,
      nodeUsed: node.used_bytes,
      nodeReserved: node.reserved_bytes,
    };
  };
  const reserveAuthorized = async (scope, requestId = randomUUID()) => {
    const bytes = new Uint8Array([0x89]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const init = await appSend('POST', '/api/v1/uploads/init', {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      albumId: scope.albumId,
      originalFilename: 'external-intent.png',
      expectedBytes: bytes.byteLength,
      contentType: 'image/png',
      sha256,
      requestId,
    });
    assert.equal(init.status, 201, await init.clone().text());
    const uploadSession = (await readJson(init)).uploadSession;
    assert.ok(uploadSession?.id);
    const authorized = await appSend(
      'POST',
      '/api/v1/uploads/' + uploadSession.id + '/authorize',
      { requestId: randomUUID() },
    );
    assert.equal(authorized.status, 200, await authorized.clone().text());
    const row = await first(
      'SELECT object_key FROM upload_sessions WHERE id=?',
      uploadSession.id,
    );
    assert.ok(row?.object_key);
    return { session: uploadSession, objectKey: row.object_key, scope };
  };
  const cancellationBody = (upload, requestId, options = {}) => ({
    operation: 'upload.cancelled',
    actorId: owner,
    sessionId,
    requestId,
    uploadSessionId: upload.session.id,
    interleave: options.interleave ?? false,
    ...(options.dropAfterFence ? { dropAfterFence: true } : {}),
  });
  const runIntent = (body) =>
    storageWorker.fetch(
      new Request(new URL('/test-owner-external-intent', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const intentFor = (requestId) =>
    first(
      'SELECT * FROM owner_external_intents WHERE actor_id=? AND request_id=?',
      owner,
      requestId,
    );
  const intentCount = async (requestId) =>
    (
      await first(
        'SELECT count(*) AS n FROM owner_external_intents WHERE actor_id=? AND request_id=?',
        owner,
        requestId,
      )
    ).n;
  const fenceCount = async (uploadSessionId) =>
    (
      await first(
        'SELECT count(*) AS n FROM upload_key_fences WHERE upload_session_id=?',
        uploadSessionId,
      )
    ).n;
  const uploadRequestCount = async (requestId) =>
    (
      await first(
        'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
        owner,
        requestId,
      )
    ).n;
  const sessionStatus = async (uploadSessionId) =>
    (
      await first(
        'SELECT status FROM upload_sessions WHERE id=?',
        uploadSessionId,
      )
    )?.status;
  const auditCount = async (requestId, action) =>
    (
      await first(
        'SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND request_id=? AND action=?',
        owner,
        requestId,
        action,
      )
    ).n;
  const claimAuditCount = (requestId) =>
    auditCount(requestId, 'owner.external_intent_claimed');
  const cancelAuditCount = (requestId) =>
    auditCount(requestId, 'upload.cancelled');
  const assertUploadFenceMarker = async (upload) => {
    const marker = await storage.head(upload.objectKey);
    assert.ok(marker, 'Expected an immutable R2 upload fence marker');
    assert.equal(marker.size, 0);
    assert.equal(
      marker.httpMetadata?.contentType,
      'application/x-kino-pic-upload-fence',
    );
    assert.equal(marker.customMetadata?.kinoUploadFence, upload.session.id);
  };
  const cancelAndCheck = async (upload, requestId = randomUUID()) => {
    const body = await expectStatus(
      await runIntent(cancellationBody(upload, requestId)),
      200,
    );
    assert.equal(body?.uploadSession?.id, upload.session.id);
    assert.equal(body?.uploadSession?.status, 'cancelled');
    return body;
  };

  await check(
    'A known project-version request UUID blocks upload cancellation before claim, R2 fence, or quota release',
    async () => {
      const scope = await projectScope('known namespace');
      const upload = await reserveAuthorized(scope);
      const heldQuota = await quota(scope.workspaceId);
      const requestId = randomUUID();
      const configured = await setProjectMode(
        scope.projectId,
        'off',
        requestId,
      );
      assert.equal(
        configured.response.status,
        200,
        JSON.stringify(configured.body),
      );
      const beforeMode = await readProjectMode(scope.projectId);
      assert.equal(beforeMode.mode, 'off');
      await expectStatus(
        await runIntent(cancellationBody(upload, requestId)),
        409,
        'REQUEST_ID_CONFLICT',
      );
      assert.equal(await intentCount(requestId), 0);
      assert.equal(await claimAuditCount(requestId), 0);
      assert.equal(await fenceCount(upload.session.id), 0);
      assert.equal(await uploadRequestCount(requestId), 0);
      assert.equal(await sessionStatus(upload.session.id), 'reserved');
      assert.deepEqual(await quota(scope.workspaceId), heldQuota);
      assert.equal(await storage.head(upload.objectKey), null);
      assert.deepEqual(await readProjectMode(scope.projectId), beforeMode);
      await cancelAndCheck(upload);
    },
  );

  await check(
    'Owner disabled before a new claim has zero effects and current authority is required again for replay',
    async () => {
      const scope = await projectScope('disabled before claim');
      const baselineQuota = await quota(scope.workspaceId);
      const upload = await reserveAuthorized(scope);
      const requestId = randomUUID();
      const heldQuota = await quota(scope.workspaceId);
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectStatus(
          await appSend(
            'POST',
            '/api/v1/uploads/' + upload.session.id + '/cancel',
            { requestId },
          ),
          403,
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      assert.equal(await intentCount(requestId), 0);
      assert.equal(await claimAuditCount(requestId), 0);
      assert.equal(await fenceCount(upload.session.id), 0);
      assert.equal(await sessionStatus(upload.session.id), 'reserved');
      assert.deepEqual(await quota(scope.workspaceId), heldQuota);
      assert.equal(await storage.head(upload.objectKey), null);
      await cancelAndCheck(upload, requestId);
      assert.deepEqual(await quota(scope.workspaceId), baselineQuota);
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectStatus(
          await appSend(
            'POST',
            '/api/v1/uploads/' + upload.session.id + '/cancel',
            { requestId },
          ),
          403,
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      assert.equal(await cancelAuditCount(requestId), 1);
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.deepEqual(await quota(scope.workspaceId), baselineQuota);
    },
  );

  await check(
    'Claim-audit failure rolls back before R2 and permits an exact retry',
    async () => {
      const scope = await projectScope('claim audit rollback');
      const upload = await reserveAuthorized(scope);
      const requestId = randomUUID();
      const heldQuota = await quota(scope.workspaceId);
      await db.exec(
        "CREATE TRIGGER fail_owner_external_claim_audit BEFORE INSERT ON audit_events WHEN NEW.action='owner.external_intent_claimed' BEGIN SELECT RAISE(ABORT,'TEST_OWNER_EXTERNAL_CLAIM_AUDIT_FAILURE'); END;",
      );
      try {
        await expectStatus(
          await runIntent(cancellationBody(upload, requestId)),
          503,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_owner_external_claim_audit;');
      }
      assert.equal(await intentCount(requestId), 0);
      assert.equal(await claimAuditCount(requestId), 0);
      assert.equal(await fenceCount(upload.session.id), 0);
      assert.equal(await uploadRequestCount(requestId), 0);
      assert.equal(await sessionStatus(upload.session.id), 'reserved');
      assert.deepEqual(await quota(scope.workspaceId), heldQuota);
      assert.equal(await storage.head(upload.objectKey), null);
      await cancelAndCheck(upload, requestId);
      assert.equal(await intentCount(requestId), 1);
      assert.equal(await claimAuditCount(requestId), 1);
    },
  );

  await check(
    'A committed claim blocks a later cross-ledger project write before fencing and leaves project CAS unchanged',
    async () => {
      const scope = await projectScope('claim namespace interleave');
      const baselineQuota = await quota(scope.workspaceId);
      const upload = await reserveAuthorized(scope);
      const requestId = randomUUID();
      const beforeMode = await readProjectMode(scope.projectId);
      let observed = 0;
      await setInterleaveHook(async (hookRequest) => {
        observed += 1;
        const hook = await hookRequest.json();
        assert.equal(hook.operation, 'upload.cancelled');
        assert.equal(hook.actorId, owner);
        assert.equal(hook.requestId, requestId);
        const response = await configSend(
          'PUT',
          '/api/v1/projects/' + scope.projectId + '/versioning',
          {
            requestId,
            expectedRevision: beforeMode.revision,
            mode: 'off',
            confirm: true,
          },
        );
        const body = await readJson(response);
        assert.equal(response.status, 409, JSON.stringify(body));
        assert.equal(body?.error?.code, 'REQUEST_ID_CONFLICT');
        return new Response(null, { status: 204 });
      });
      let response;
      try {
        response = await runIntent(
          cancellationBody(upload, requestId, { interleave: true }),
        );
      } finally {
        if (barrierReleaseTimer !== null) {
          clearTimeout(barrierReleaseTimer);
          barrierReleaseTimer = null;
        }
        await setInterleaveHook(null);
      }
      const result = await expectStatus(response, 200);
      assert.equal(result?.uploadSession?.status, 'cancelled');
      assert.equal(observed, 1);
      assert.equal(await intentCount(requestId), 1);
      assert.equal(await claimAuditCount(requestId), 1);
      assert.equal(await uploadRequestCount(requestId), 1);
      assert.deepEqual(await readProjectMode(scope.projectId), beforeMode);
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.deepEqual(await quota(scope.workspaceId), baselineQuota);
    },
  );

  await check(
    'Concurrent exact cancellation UUIDs coalesce to one result, claim, physical certificate, audit, and quota release',
    async () => {
      const scope = await projectScope('same UUID race');
      const baselineQuota = await quota(scope.workspaceId);
      const upload = await reserveAuthorized(scope);
      const requestId = randomUUID();
      let arrivals = 0;
      let openBarrier;
      const barrier = new Promise((resolve) => {
        openBarrier = resolve;
      });
      await setInterleaveHook(async () => {
        arrivals += 1;
        if (arrivals >= 2) openBarrier();
        await barrier;
        return new Response(null, { status: 204 });
      });
      barrierReleaseTimer = setTimeout(() => openBarrier(), 10000);
      let outcomes;
      try {
        outcomes = await Promise.allSettled([
          runIntent(cancellationBody(upload, requestId, { interleave: true })),
          runIntent(cancellationBody(upload, requestId, { interleave: true })),
        ]);
      } finally {
        if (barrierReleaseTimer !== null) {
          clearTimeout(barrierReleaseTimer);
          barrierReleaseTimer = null;
        }
        await setInterleaveHook(null);
      }
      assert.equal(arrivals, 2);
      const responses = outcomes.map((outcome) => {
        assert.equal(outcome.status, 'fulfilled', String(outcome.reason ?? ''));
        return outcome.value;
      });
      const bodies = await Promise.all(responses.map(readJson));
      for (let index = 0; index < responses.length; index++)
        assert.equal(
          responses[index].status,
          200,
          JSON.stringify(bodies[index]),
        );
      assert.deepEqual(bodies[0], bodies[1]);
      assert.equal(bodies[0]?.uploadSession?.status, 'cancelled');
      assert.equal(await intentCount(requestId), 1);
      assert.equal(await claimAuditCount(requestId), 1);
      assert.equal(await cancelAuditCount(requestId), 1);
      assert.equal(await uploadRequestCount(requestId), 1);
      assert.equal(await fenceCount(upload.session.id), 1);
      await assertUploadFenceMarker(upload);
      assert.deepEqual(await quota(scope.workspaceId), baselineQuota);
    },
  );

  await check(
    'Different UUIDs may claim one cancellation target; an idempotent R2 fence has one finalizer and quota release',
    async () => {
      const scope = await projectScope('distinct UUID same target');
      const baselineQuota = await quota(scope.workspaceId);
      const upload = await reserveAuthorized(scope);
      const requestIds = [randomUUID(), randomUUID()];
      let arrivals = 0;
      let openBarrier;
      const barrier = new Promise((resolve) => {
        openBarrier = resolve;
      });
      await setInterleaveHook(async () => {
        arrivals += 1;
        if (arrivals >= 2) openBarrier();
        await barrier;
        return new Response(null, { status: 204 });
      });
      barrierReleaseTimer = setTimeout(() => openBarrier(), 10000);
      let outcomes;
      try {
        outcomes = await Promise.allSettled(
          requestIds.map((requestId) =>
            runIntent(
              cancellationBody(upload, requestId, { interleave: true }),
            ),
          ),
        );
      } finally {
        if (barrierReleaseTimer !== null) {
          clearTimeout(barrierReleaseTimer);
          barrierReleaseTimer = null;
        }
        await setInterleaveHook(null);
      }
      assert.equal(arrivals, 2);
      const responses = outcomes.map((outcome) => {
        assert.equal(outcome.status, 'fulfilled', String(outcome.reason ?? ''));
        return outcome.value;
      });
      const bodies = await Promise.all(responses.map(readJson));
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [200, 409],
      );
      assert.equal(
        bodies.filter((body) => body?.uploadSession?.status === 'cancelled')
          .length,
        1,
      );
      assert.equal(await intentCount(requestIds[0]), 1);
      assert.equal(await intentCount(requestIds[1]), 1);
      assert.equal(await claimAuditCount(requestIds[0]), 1);
      assert.equal(await claimAuditCount(requestIds[1]), 1);
      assert.ok(
        bodies[responses.findIndex((response) => response.status === 409)]
          ?.error?.code,
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM owner_external_intents WHERE actor_id=? AND upload_session_id=?',
            owner,
            upload.session.id,
          )
        ).n,
        2,
      );
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.equal(
        (
          await first(
            "SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND upload_session_id=? AND operation='upload.cancelled'",
            owner,
            upload.session.id,
          )
        ).n,
        1,
      );
      assert.equal(
        (await Promise.all(requestIds.map(cancelAuditCount))).reduce(
          (total, count) => total + count,
          0,
        ),
        1,
      );
      assert.deepEqual(await quota(scope.workspaceId), baselineQuota);
      await assertUploadFenceMarker(upload);
    },
  );

  await check(
    'A lost response after the R2 fence retains the claim and quota, then exact retry adopts that same fence',
    async () => {
      const scope = await projectScope('unknown R2 result');
      const baselineQuota = await quota(scope.workspaceId);
      const upload = await reserveAuthorized(scope);
      const requestId = randomUUID();
      const heldQuota = await quota(scope.workspaceId);
      await expectStatus(
        await runIntent(
          cancellationBody(upload, requestId, { dropAfterFence: true }),
        ),
        503,
        'OWNER_INTENT_TEST_FAILED',
      );
      const claimBefore = await intentFor(requestId);
      assert.ok(claimBefore);
      assert.equal(await claimAuditCount(requestId), 1);
      assert.equal(await sessionStatus(upload.session.id), 'reserved');
      assert.equal(await fenceCount(upload.session.id), 0);
      assert.equal(await uploadRequestCount(requestId), 0);
      assert.deepEqual(await quota(scope.workspaceId), heldQuota);
      await assertUploadFenceMarker(upload);
      const completed = await cancelAndCheck(upload, requestId);
      assert.equal(completed.uploadSession.status, 'cancelled');
      assert.deepEqual(await intentFor(requestId), claimBefore);
      assert.equal(await intentCount(requestId), 1);
      assert.equal(await claimAuditCount(requestId), 1);
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.equal(await uploadRequestCount(requestId), 1);
      assert.equal(await cancelAuditCount(requestId), 1);
      assert.deepEqual(await quota(scope.workspaceId), baselineQuota);
      await assertUploadFenceMarker(upload);
    },
  );

  await check(
    'Final cancel audit failure retains its claim, physical and D1 fence, and quota until scheduled expiry releases once',
    async () => {
      const scope = await projectScope('final audit and expiry');
      const baselineQuota = await quota(scope.workspaceId);
      const upload = await reserveAuthorized(scope);
      const requestId = randomUUID();
      const heldQuota = await quota(scope.workspaceId);
      await db.exec(
        "CREATE TRIGGER fail_upload_cancel_audit BEFORE INSERT ON audit_events WHEN NEW.action='upload.cancelled' BEGIN SELECT RAISE(ABORT,'TEST_UPLOAD_CANCEL_AUDIT_FAILURE'); END;",
      );
      try {
        await expectStatus(
          await runIntent(cancellationBody(upload, requestId)),
          503,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_upload_cancel_audit;');
      }
      const claim = await intentFor(requestId);
      const localFence = await first(
        'SELECT * FROM upload_key_fences WHERE upload_session_id=?',
        upload.session.id,
      );
      assert.ok(claim);
      assert.ok(localFence);
      assert.equal(await claimAuditCount(requestId), 1);
      assert.equal(await cancelAuditCount(requestId), 0);
      assert.equal(await uploadRequestCount(requestId), 0);
      assert.equal(await sessionStatus(upload.session.id), 'reserved');
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.deepEqual(await quota(scope.workspaceId), heldQuota);
      await assertUploadFenceMarker(upload);

      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectStatus(
          await appSend(
            'POST',
            '/api/v1/uploads/' + upload.session.id + '/cancel',
            { requestId },
          ),
          403,
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      assert.deepEqual(await intentFor(requestId), claim);
      assert.deepEqual(
        await first(
          'SELECT * FROM upload_key_fences WHERE upload_session_id=?',
          upload.session.id,
        ),
        localFence,
      );
      assert.equal(await sessionStatus(upload.session.id), 'reserved');
      assert.deepEqual(await quota(scope.workspaceId), heldQuota);

      const scheduledTime = Date.parse(upload.session.expiresAt) + 1;
      await applicationWorker.scheduled({
        scheduledTime,
        cron: '*/5 * * * *',
      });
      assert.equal(await sessionStatus(upload.session.id), 'expired');
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.equal(await intentCount(requestId), 1);
      assert.equal(await claimAuditCount(requestId), 1);
      assert.equal(await cancelAuditCount(requestId), 0);
      assert.equal(await uploadRequestCount(requestId), 0);
      assert.equal(
        (
          await first(
            "SELECT count(*) AS n FROM audit_events WHERE action='upload.expired' AND request_id=?",
            'reservation-expired:' + upload.session.id,
          )
        ).n,
        1,
      );
      assert.deepEqual(
        await first(
          'SELECT * FROM upload_key_fences WHERE upload_session_id=?',
          upload.session.id,
        ),
        localFence,
      );
      const releasedQuota = await quota(scope.workspaceId);
      assert.deepEqual(releasedQuota, baselineQuota);
      await assertUploadFenceMarker(upload);

      await applicationWorker.scheduled({
        scheduledTime,
        cron: '*/5 * * * *',
      });
      assert.equal(await sessionStatus(upload.session.id), 'expired');
      assert.equal(await intentCount(requestId), 1);
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.equal(
        (
          await first(
            "SELECT count(*) AS n FROM audit_events WHERE action='upload.expired' AND request_id=?",
            'reservation-expired:' + upload.session.id,
          )
        ).n,
        1,
      );
      await expectStatus(
        await runIntent(cancellationBody(upload, requestId)),
        409,
      );
      assert.equal(await intentCount(requestId), 1);
      assert.equal(await cancelAuditCount(requestId), 0);
      assert.deepEqual(await quota(scope.workspaceId), baselineQuota);
    },
  );

  await check(
    'External claims reject UPDATE, DELETE, null-key, and OR REPLACE retarget attempts without changing their snapshots',
    async () => {
      const scope = await projectScope('immutable claim');
      const upload = await reserveAuthorized(scope);
      const requestId = randomUUID();
      await cancelAndCheck(upload, requestId);
      const original = await intentFor(requestId);
      assert.ok(original);
      const auditBefore = await all(
        'SELECT * FROM audit_events WHERE actor_id=? AND request_id=? ORDER BY event_id',
        owner,
        requestId,
      );
      const sessionBefore = await first(
        'SELECT status,updated_at_ms,updated_by_request_id FROM upload_sessions WHERE id=?',
        upload.session.id,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE owner_external_intents SET payload_json=? WHERE actor_id=? AND request_id=?',
          )
          .bind(
            '{"uploadSessionId":"00000000-0000-4000-8000-000000000000"}',
            owner,
            requestId,
          )
          .run(),
        /IMMUTABLE_OWNER_EXTERNAL_INTENT/,
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM owner_external_intents WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, requestId)
          .run(),
        /IMMUTABLE_OWNER_EXTERNAL_INTENT/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO owner_external_intents(actor_id,request_id,operation,session_id,workspace_id,project_id,album_id,upload_session_id,job_id,photo_id,version_id,expected_epoch,storage_node_id,original_object_key,thumbnail_key,preview_key,payload_json,created_at_ms) SELECT actor_id,NULL,operation,session_id,workspace_id,project_id,album_id,upload_session_id,job_id,photo_id,version_id,expected_epoch,storage_node_id,original_object_key,thumbnail_key,preview_key,payload_json,created_at_ms FROM owner_external_intents WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, requestId)
          .run(),
        /INVALID_INPUT/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT OR REPLACE INTO owner_external_intents(actor_id,request_id,operation,session_id,workspace_id,project_id,album_id,upload_session_id,job_id,photo_id,version_id,expected_epoch,storage_node_id,original_object_key,thumbnail_key,preview_key,payload_json,created_at_ms) SELECT actor_id,request_id,operation,session_id,workspace_id,project_id,album_id,upload_session_id,job_id,photo_id,version_id,expected_epoch,storage_node_id,original_object_key,thumbnail_key,preview_key,json_object('uploadSessionId',upload_session_id||'-retargeted'),created_at_ms FROM owner_external_intents WHERE actor_id=? AND request_id=?",
          )
          .bind(owner, requestId)
          .run(),
        /INVALID_INPUT|REQUEST_ID_CONFLICT/,
      );
      assert.deepEqual(await intentFor(requestId), original);
      assert.deepEqual(
        await all(
          'SELECT * FROM audit_events WHERE actor_id=? AND request_id=? ORDER BY event_id',
          owner,
          requestId,
        ),
        auditBefore,
      );
      assert.deepEqual(
        await first(
          'SELECT status,updated_at_ms,updated_by_request_id FROM upload_sessions WHERE id=?',
          upload.session.id,
        ),
        sessionBefore,
      );
      assert.equal(await fenceCount(upload.session.id), 1);
      assert.equal(await uploadRequestCount(requestId), 1);
      await assertUploadFenceMarker(upload);
    },
  );

  await check(
    'Processing collision, lost physical result and forged key certificate preserve claims/quota before exact fixed-key recovery',
    async () => {
      const scope = await projectScope('processing target');
      const bytes = pngWithDimensions(48, 24);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const init = await appSend('POST', '/api/v1/uploads/init', {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        albumId: scope.albumId,
        originalFilename: 'needs-review.png',
        expectedBytes: bytes.byteLength,
        contentType: 'image/png',
        sha256,
        requestId: randomUUID(),
      });
      assert.equal(init.status, 201, await init.clone().text());
      const uploadSession = (await readJson(init)).uploadSession;
      const authorized = await appSend(
        'POST',
        '/api/v1/uploads/' + uploadSession.id + '/authorize',
        { requestId: randomUUID() },
      );
      assert.equal(authorized.status, 200, await authorized.clone().text());
      const original = await first(
        'SELECT object_key FROM upload_sessions WHERE id=?',
        uploadSession.id,
      );
      await storage.put(original.object_key, new Uint8Array(bytes), {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'image/png' },
        sha256: Buffer.from(sha256, 'hex'),
      });
      const completed = await appSend(
        'POST',
        '/api/v1/uploads/' + uploadSession.id + '/complete',
        { requestId: randomUUID() },
      );
      assert.equal(completed.status, 200, await completed.clone().text());
      const completion = (await readJson(completed)).completion;
      assert.ok(
        completion?.photoId && completion?.versionId && completion?.assetId,
      );
      const processed = await runImageProcessingJob({
        jobId: completion.assetId,
        jobs: new D1ImageProcessingRepository(db),
        objects: new R2ProcessingObjectStore(storage),
        processor: new LocalSharpImageProcessor(),
      });
      assert.equal(processed.status, 'needs_review');
      const job = await first(
        'SELECT status,lease_epoch,reserved_bytes FROM image_processing_jobs WHERE id=?',
        completion.assetId,
      );
      assert.equal(job.status, 'needs_review');
      assert.equal(job.reserved_bytes, 16777216);
      const prefix =
        scope.workspaceId +
        '/' +
        scope.projectId +
        '/' +
        scope.albumId +
        '/' +
        completion.assetId +
        '/derived/local-sharp-0.35.5-v1/';
      const thumbnailKey = prefix + 'thumbnail.jpg';
      const previewKey = prefix + 'preview.jpg';
      const slots = [
        {
          jobId: completion.assetId,
          kind: 'thumbnail',
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          albumId: scope.albumId,
          key: thumbnailKey,
        },
        {
          jobId: completion.assetId,
          kind: 'preview',
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          albumId: scope.albumId,
          key: previewKey,
        },
      ];
      const reviewStorage = new R2ProcessingReviewStore(storage);
      assert.equal(await reviewStorage.inspect(slots[0]), 'missing');
      assert.equal(await reviewStorage.inspect(slots[1]), 'missing');

      const namespaceScope = await projectScope('processing namespace');
      const requestId = randomUUID();
      const configured = await setProjectMode(
        namespaceScope.projectId,
        'off',
        requestId,
      );
      assert.equal(
        configured.response.status,
        200,
        JSON.stringify(configured.body),
      );
      const heldQuota = await quota(scope.workspaceId);
      const conflict = await expectStatus(
        await runIntent({
          operation: 'processing.abandoned',
          actorId: owner,
          sessionId,
          requestId,
          photoId: completion.photoId,
          versionId: completion.versionId,
          expectedLeaseEpoch: job.lease_epoch,
          confirmAbandon: true,
          interleave: false,
        }),
        409,
        'REQUEST_ID_CONFLICT',
      );
      assert.ok(conflict?.error);
      assert.equal(await intentCount(requestId), 0);
      assert.equal(await claimAuditCount(requestId), 0);
      assert.equal(
        (
          await first(
            'SELECT status FROM image_processing_jobs WHERE id=?',
            completion.assetId,
          )
        ).status,
        'needs_review',
      );
      assert.deepEqual(await quota(scope.workspaceId), heldQuota);
      assert.equal(await reviewStorage.inspect(slots[0]), 'missing');
      assert.equal(await reviewStorage.inspect(slots[1]), 'missing');

      const beforeAbandonQuota = await quota(scope.workspaceId);
      const abandonRequestId = randomUUID();
      const lostPhysicalBody = {
        operation: 'processing.abandoned',
        actorId: owner,
        sessionId,
        requestId: abandonRequestId,
        photoId: completion.photoId,
        versionId: completion.versionId,
        expectedLeaseEpoch: job.lease_epoch,
        confirmAbandon: true,
        interleave: false,
        dropAfterFence: true,
      };
      await expectStatus(await runIntent(lostPhysicalBody), 503);
      assert.equal(await intentCount(abandonRequestId), 1);
      assert.equal(await claimAuditCount(abandonRequestId), 1);
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM processing_review_commands WHERE actor_id=? AND request_id=?',
            owner,
            abandonRequestId,
          )
        ).n,
        0,
      );
      assert.equal(
        (
          await first(
            'SELECT status FROM image_processing_jobs WHERE id=?',
            completion.assetId,
          )
        ).status,
        'needs_review',
      );
      assert.deepEqual(await quota(scope.workspaceId), beforeAbandonQuota);
      assert.equal(await reviewStorage.inspect(slots[0]), 'fenced');
      assert.equal(await reviewStorage.inspect(slots[1]), 'fenced');
      const pendingClaim = await intentFor(abandonRequestId);
      const forgedCertificate = JSON.stringify([
        {
          kind: 'thumbnail',
          key: thumbnailKey + '.unclaimed',
          state: 'fenced',
        },
        { kind: 'preview', key: previewKey, state: 'fenced' },
      ]);
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO processing_review_commands(actor_id,request_id,session_id,job_id,expected_epoch,payload_json,fences_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            owner,
            abandonRequestId,
            sessionId,
            completion.assetId,
            job.lease_epoch,
            pendingClaim.payload_json,
            forgedCertificate,
            Date.now(),
          )
          .run(),
        /PROCESSING_FENCES_REQUIRED/,
      );
      assert.equal(
        (
          await first(
            'SELECT count(*) AS n FROM processing_review_commands WHERE actor_id=? AND request_id=?',
            owner,
            abandonRequestId,
          )
        ).n,
        0,
      );
      assert.equal(
        (
          await first(
            'SELECT status FROM image_processing_jobs WHERE id=?',
            completion.assetId,
          )
        ).status,
        'needs_review',
      );
      assert.equal(
        await auditCount(abandonRequestId, 'processing.abandoned'),
        0,
      );
      assert.deepEqual(await quota(scope.workspaceId), beforeAbandonQuota);
      const abandoned = await expectStatus(
        await runIntent({
          operation: 'processing.abandoned',
          actorId: owner,
          sessionId,
          requestId: abandonRequestId,
          photoId: completion.photoId,
          versionId: completion.versionId,
          expectedLeaseEpoch: job.lease_epoch,
          confirmAbandon: true,
          interleave: false,
        }),
        200,
      );
      assert.equal(abandoned?.status, 'abandoned');
      assert.equal(abandoned?.jobId, completion.assetId);
      const claim = await intentFor(abandonRequestId);
      assert.ok(claim);
      assert.equal(claim.operation, 'processing.abandoned');
      assert.equal(claim.job_id, completion.assetId);
      assert.equal(claim.photo_id, completion.photoId);
      assert.equal(claim.version_id, completion.versionId);
      assert.equal(claim.expected_epoch, job.lease_epoch);
      assert.equal(claim.thumbnail_key, thumbnailKey);
      assert.equal(claim.preview_key, previewKey);
      const command = await first(
        'SELECT * FROM processing_review_commands WHERE actor_id=? AND request_id=?',
        owner,
        abandonRequestId,
      );
      assert.ok(command);
      const certificate = JSON.parse(command.fences_json);
      assert.deepEqual(
        certificate
          .map((item) => ({
            kind: item.kind,
            key: item.key,
            state: item.state,
          }))
          .sort((left, right) => left.kind.localeCompare(right.kind)),
        [
          { kind: 'preview', key: previewKey, state: 'fenced' },
          { kind: 'thumbnail', key: thumbnailKey, state: 'fenced' },
        ],
      );
      assert.equal(await reviewStorage.inspect(slots[0]), 'fenced');
      assert.equal(await reviewStorage.inspect(slots[1]), 'fenced');
      const [thumbnailMarker, previewMarker, sourceMarker] = await Promise.all([
        storage.head(thumbnailKey),
        storage.head(previewKey),
        storage.head(original.object_key),
      ]);
      for (const marker of [thumbnailMarker, previewMarker]) {
        assert.equal(
          marker?.httpMetadata?.contentType,
          'application/x-kino-pic-processing-fence',
        );
        assert.equal(
          marker?.customMetadata?.kinoProcessingFence,
          completion.assetId,
        );
      }
      assert.equal(
        thumbnailMarker?.customMetadata?.kinoProcessingKind,
        'thumbnail',
      );
      assert.equal(
        previewMarker?.customMetadata?.kinoProcessingKind,
        'preview',
      );
      assert.equal(sourceMarker?.size, bytes.byteLength);
      assert.equal(await claimAuditCount(abandonRequestId), 1);
      assert.equal(
        await auditCount(abandonRequestId, 'processing.abandoned'),
        1,
      );
      assert.equal(
        (
          await first(
            'SELECT status FROM image_processing_jobs WHERE id=?',
            completion.assetId,
          )
        ).status,
        'abandoned',
      );
      const afterAbandonQuota = await quota(scope.workspaceId);
      assert.equal(
        afterAbandonQuota.workspaceReserved,
        beforeAbandonQuota.workspaceReserved - 16777216,
      );
      assert.equal(
        afterAbandonQuota.nodeReserved,
        beforeAbandonQuota.nodeReserved - 16777216,
      );
    },
  );
}
