import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { chromium, expect } from '@playwright/test';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { pngWithDimensions } from './image-fixtures.mjs';
import { processingReviewChecks } from './processing-review.mjs';

const budget = 16777216;
export async function processingChecks({
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
  const send = (method, path, body) =>
    request(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const jobs = new D1ImageProcessingRepository(db);
  const objects = new R2ProcessingObjectStore(storage);
  const processor = new LocalSharpImageProcessor();
  const source = await sharp({
    create: { width: 48, height: 24, channels: 3, background: '#368cba' },
  })
    .png()
    .toBuffer();
  async function scope(label) {
    const create = async (path, body) => {
      const r = await send('POST', path, { ...body, requestId: randomUUID() });
      assert.equal(r.status, 201, await r.clone().text());
      return r.json();
    };
    const { workspace } = await create('/api/v1/workspaces', {
      name: 'Processing ' + label,
    });
    const { project } = await create('/api/v1/projects', {
      workspaceId: workspace.id,
      name: 'Processing ' + label,
    });
    const { album } = await create(`/api/v1/projects/${project.id}/albums`, {
      name: 'Images ' + label,
    });
    return { workspace, project, album };
  }
  async function upload(
    context,
    filename = 'photo.png',
    bytes = source,
    completeStatus = 200,
  ) {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    let r = await send('POST', '/api/v1/uploads/init', {
      workspaceId: context.workspace.id,
      projectId: context.project.id,
      albumId: context.album.id,
      originalFilename: filename,
      expectedBytes: bytes.byteLength,
      contentType: 'image/png',
      sha256,
      requestId: randomUUID(),
    });
    assert.equal(r.status, 201, await r.clone().text());
    const session = (await r.json()).uploadSession;
    r = await send('POST', `/api/v1/uploads/${session.id}/authorize`, {
      requestId: randomUUID(),
    });
    assert.equal(r.status, 200, await r.clone().text());
    const row = await db
      .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
      .bind(session.id)
      .first();
    await storage.put(row.object_key, new Uint8Array(bytes), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/png' },
      sha256,
    });
    const completeRequestId = randomUUID();
    r = await send('POST', `/api/v1/uploads/${session.id}/complete`, {
      requestId: completeRequestId,
    });
    assert.equal(r.status, completeStatus, await r.clone().text());
    if (completeStatus !== 200)
      return { sessionId: session.id, completeRequestId };
    return (await r.json()).completion;
  }
  const usage = (workspaceId) =>
    db
      .prepare(
        'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
      )
      .bind(workspaceId)
      .first();
  const jobState = (id) =>
    db
      .prepare('SELECT * FROM image_processing_jobs WHERE id=?')
      .bind(id)
      .first();
  const execute = (jobId, extra = {}) =>
    runImageProcessingJob({ jobId, jobs, objects, processor, ...extra });
  let galleryContext, readyFirst, readySecond;
  let readyFirstIsFirst = false;

  await check(
    'trusted native processing commits private R2 derivatives, exact two-scope quota and one append-only completion',
    async () => {
      galleryContext = await scope('gallery');
      readyFirst = await upload(galleryContext, 'ready-first.png');
      const queued = await jobState(readyFirst.assetId);
      assert.equal(queued.status, 'queued');
      assert.equal(queued.reserved_bytes, 0);
      const page = await send(
        'GET',
        `/api/v1/albums/${galleryContext.album.id}/photos`,
      );
      assert.equal(page.status, 200);
      assert.equal((await page.json()).photos[0].thumbnailUrl, null);
      const nodeBefore = await db
        .prepare(
          "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
        )
        .first();
      assert.equal((await execute(readyFirst.assetId)).status, 'succeeded');
      const assets = (
        await db
          .prepare(
            "SELECT * FROM photo_assets WHERE version_id=? AND asset_kind<>'original'",
          )
          .bind(readyFirst.versionId)
          .all()
      ).results;
      assert.equal(assets.length, 2);
      const derivativeBytes = assets.reduce((n, a) => n + a.byte_size, 0);
      for (const asset of assets) {
        const object = await storage.get(asset.object_key);
        assert.equal(object.httpMetadata.contentType, 'image/jpeg');
        const bytes = Buffer.from(await object.arrayBuffer());
        assert.equal(
          createHash('sha256').update(bytes).digest('hex'),
          asset.checksum_sha256,
        );
        const actual = await sharp(bytes)
          .raw()
          .toBuffer({ resolveWithObject: true });
        assert.equal(actual.info.width, 48);
        assert.equal(actual.info.height, 24);
        assert.equal(asset.state, 'private');
      }
      assert.deepEqual(await usage(galleryContext.workspace.id), {
        used_bytes: source.byteLength + derivativeBytes,
        reserved_bytes: 0,
      });
      const nodeAfter = await db
        .prepare(
          "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
        )
        .first();
      assert.equal(
        nodeAfter.used_bytes - nodeBefore.used_bytes,
        derivativeBytes,
      );
      assert.equal(nodeAfter.reserved_bytes, nodeBefore.reserved_bytes);
      assert.equal((await execute(readyFirst.assetId)).status, 'busy');
      assert.deepEqual(
        await db
          .prepare(
            "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
          )
          .first(),
        nodeAfter,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='processing.succeeded'",
            )
            .bind(readyFirst.photoId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM image_processing_outputs WHERE job_id=?',
            )
            .bind(readyFirst.assetId)
            .first()
        ).n,
        2,
      );
      await assert.rejects(
        db
          .prepare(
            "UPDATE image_processing_outputs SET object_key='other' WHERE job_id=?",
          )
          .bind(readyFirst.assetId)
          .run(),
        /IMMUTABLE_PROCESSING_OUTPUT/,
      );
    },
  );
  await check(
    'outbox enqueue audit failure rolls upload completion back; exact retry creates one original and job',
    async () => {
      const context = await scope('enqueue-rollback');
      const countBefore = (
        await db
          .prepare('SELECT count(*) AS n FROM image_processing_jobs')
          .first()
      ).n;
      await db.exec(
        "CREATE TRIGGER processing_enqueue_abort BEFORE INSERT ON audit_events WHEN NEW.action='processing.enqueued' BEGIN SELECT RAISE(ABORT,'TEST_ENQUEUE_AUDIT_FAILURE'); END;",
      );
      let pending;
      try {
        pending = await upload(context, 'enqueue.png', source, 503);
      } finally {
        await db.exec('DROP TRIGGER processing_enqueue_abort;');
      }
      assert.deepEqual(await usage(context.workspace.id), {
        used_bytes: 0,
        reserved_bytes: source.byteLength,
      });
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM photos WHERE album_id=?')
            .bind(context.album.id)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM image_processing_jobs')
            .first()
        ).n,
        countBefore,
      );
      const replay = await send(
        'POST',
        `/api/v1/uploads/${pending.sessionId}/complete`,
        { requestId: pending.completeRequestId },
      );
      assert.equal(replay.status, 200, await replay.clone().text());
      const completion = (await replay.json()).completion;
      assert.equal((await jobState(completion.assetId)).status, 'queued');
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM image_processing_jobs')
            .first()
        ).n,
        countBefore + 1,
      );
      assert.equal((await execute(completion.assetId)).status, 'succeeded');
    },
  );
  await check(
    'concurrent processing claims reserve one exact workspace budget and audit failure releases neither state nor extra bytes',
    async () => {
      const context = await scope('claim-concurrency');
      const first = await upload(context, 'one.png'),
        second = await upload(context, 'two.png');
      const initial = await usage(context.workspace.id);
      await db.exec(
        "CREATE TRIGGER processing_claim_abort BEFORE INSERT ON audit_events WHEN NEW.action='processing.running' BEGIN SELECT RAISE(ABORT,'TEST_CLAIM_AUDIT_FAILURE'); END;",
      );
      try {
        assert.equal((await execute(first.assetId)).status, 'retryable');
      } finally {
        await db.exec('DROP TRIGGER processing_claim_abort;');
      }
      assert.equal((await jobState(first.assetId)).status, 'queued');
      assert.deepEqual(await usage(context.workspace.id), initial);
      await db
        .prepare('UPDATE workspaces SET quota_bytes=? WHERE id=?')
        .bind(initial.used_bytes + budget, context.workspace.id)
        .run();
      let claims;
      try {
        claims = await Promise.all([
          jobs.claim(first.assetId),
          jobs.claim(second.assetId),
        ]);
        assert.equal(claims.filter(Boolean).length, 1);
        assert.equal(
          (await usage(context.workspace.id)).reserved_bytes,
          budget,
        );
      } finally {
        await db
          .prepare('UPDATE workspaces SET quota_bytes=9000000000 WHERE id=?')
          .bind(context.workspace.id)
          .run();
      }
      const acquired = claims.find(Boolean);
      await jobs.fail(acquired, 'PROCESSING_IO_UNCERTAIN', false);
      assert.equal((await execute(first.assetId)).status, 'succeeded');
      assert.equal((await execute(second.assetId)).status, 'succeeded');
    },
  );
  await check(
    'archive retries preserve historical snapshots after new work, authorization precedes busy-state errors',
    async () => {
      const context = await scope('archive-replay');
      const path = `/api/v1/albums/${context.album.id}/archive`;
      const original = {
        archived: true,
        expectedRevision: 1,
        requestId: randomUUID(),
      };
      let response = await send('PATCH', path, original);
      assert.equal(response.status, 200);
      const snapshot = await response.json();
      response = await send('PATCH', path, {
        archived: false,
        expectedRevision: snapshot.album.revision,
        requestId: randomUUID(),
      });
      assert.equal(response.status, 200);
      const restored = (await response.json()).album;
      await upload(context, 'after-restore.png');
      response = await send('PATCH', path, original);
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await response.json(), snapshot);
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            owner,
            randomUUID(),
            'album.archived',
            JSON.stringify({
              albumId: context.album.id,
              archived: true,
              expectedRevision: restored.revision,
            }),
            'missing-session',
            context.album.id,
          )
          .run(),
        /OWNER_REQUIRED/,
      );
      response = await send('POST', '/api/v1/uploads/init', {
        workspaceId: context.workspace.id,
        projectId: context.project.id,
        albumId: context.album.id,
        originalFilename: 'pending-after-restore.png',
        expectedBytes: source.byteLength,
        contentType: 'image/png',
        sha256: createHash('sha256').update(source).digest('hex'),
        requestId: randomUUID(),
      });
      assert.equal(response.status, 201);
      const pending = (await response.json()).uploadSession;
      response = await send('PATCH', path, original);
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await response.json(), snapshot);
      response = await send('PATCH', path, {
        ...original,
        expectedRevision: 99,
      });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'REQUEST_ID_CONFLICT');
      const current = await db
        .prepare('SELECT state,revision FROM albums WHERE id=?')
        .bind(context.album.id)
        .first();
      assert.deepEqual(current, {
        state: 'draft',
        revision: restored.revision,
      });
      response = await send('PATCH', path, {
        archived: true,
        expectedRevision: restored.revision,
        requestId: randomUUID(),
      });
      assert.equal(response.status, 409);
      response = await send('POST', `/api/v1/uploads/${pending.id}/cancel`, {
        requestId: randomUUID(),
      });
      assert.equal(response.status, 200);
    },
  );
  await check(
    'processing quota exhaustion preserves original and queues work without partial reservations',
    async () => {
      const context = await scope('quota');
      const completed = await upload(context);
      const before = await usage(context.workspace.id);
      await db
        .prepare('UPDATE workspaces SET quota_bytes=? WHERE id=?')
        .bind(source.byteLength + budget - 1, context.workspace.id)
        .run();
      assert.equal(await jobs.claim(completed.assetId), null);
      assert.deepEqual(await usage(context.workspace.id), before);
      assert.equal((await jobState(completed.assetId)).status, 'queued');
      await db
        .prepare('UPDATE workspaces SET quota_bytes=9000000000 WHERE id=?')
        .bind(context.workspace.id)
        .run();
      const node = await db
        .prepare("SELECT * FROM storage_nodes WHERE id='primary'")
        .first();
      await db
        .prepare("UPDATE storage_nodes SET quota_bytes=? WHERE id='primary'")
        .bind(node.used_bytes + node.reserved_bytes + budget - 1)
        .run();
      try {
        assert.equal(await jobs.claim(completed.assetId), null);
        assert.deepEqual(await usage(context.workspace.id), before);
      } finally {
        await db
          .prepare("UPDATE storage_nodes SET quota_bytes=? WHERE id='primary'")
          .bind(node.quota_bytes)
          .run();
      }
      assert.equal((await execute(completed.assetId)).status, 'succeeded');
    },
  );
  await check(
    'unknown R2 write and failed D1 audit retain derivative reservations, retry adopts the same keys',
    async () => {
      const context = await scope('recovery');
      const completed = await upload(context);
      let lost = false,
        created = 0,
        exists = 0;
      const uncertain = {
        read: objects.read.bind(objects),
        async putIfAbsent(...args) {
          const result = await objects.putIfAbsent(...args);
          if (result === 'created') created++;
          else exists++;
          if (!lost) {
            lost = true;
            throw new Error('lost put response');
          }
          return result;
        },
      };
      assert.equal(
        (await execute(completed.assetId, { objects: uncertain })).status,
        'retryable',
      );
      assert.deepEqual(await usage(context.workspace.id), {
        used_bytes: source.byteLength,
        reserved_bytes: budget,
      });
      await db.exec(
        "CREATE TRIGGER processing_test_abort BEFORE INSERT ON audit_events WHEN NEW.action='processing.succeeded' BEGIN SELECT RAISE(ABORT,'TEST_PROCESSING_AUDIT_FAILURE'); END;",
      );
      try {
        assert.equal(
          (await execute(completed.assetId, { objects: uncertain })).status,
          'retryable',
        );
      } finally {
        await db.exec('DROP TRIGGER processing_test_abort;');
      }
      assert.deepEqual(await usage(context.workspace.id), {
        used_bytes: source.byteLength,
        reserved_bytes: budget,
      });
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM photo_assets WHERE version_id=? AND asset_kind<>'original'",
            )
            .bind(completed.versionId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (await execute(completed.assetId, { objects: uncertain })).status,
        'succeeded',
      );
      assert.equal(created, 2);
      assert.ok(exists >= 2);
      assert.equal((await usage(context.workspace.id)).reserved_bytes, 0);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='processing.succeeded'",
            )
            .bind(completed.photoId)
            .first()
        ).n,
        1,
      );
    },
  );
  await check(
    'expired processing leases keep one reservation, stale tokens cannot finalize and current Owner is required',
    async () => {
      const context = await scope('lease');
      const completed = await upload(context);
      const short = new D1ImageProcessingRepository(db, {
        leaseDurationMs: 750,
      });
      const old = await short.claim(completed.assetId);
      assert.ok(old);
      assert.equal(await jobs.claim(completed.assetId), null);
      await new Promise((resolve) => setTimeout(resolve, 800));
      assert.deepEqual(await usage(context.workspace.id), {
        used_bytes: source.byteLength,
        reserved_bytes: budget,
      });
      const current = await jobs.claim(completed.assetId);
      assert.ok(current);
      assert.equal(current.leaseEpoch, old.leaseEpoch + 1);
      assert.deepEqual(await usage(context.workspace.id), {
        used_bytes: source.byteLength,
        reserved_bytes: budget,
      });
      await assert.rejects(jobs.assertLease(old), /PROCESSING_LEASE_LOST/);
      await assert.rejects(jobs.complete(old, []), /PROCESSING_LEASE_LOST/);
      await assert.rejects(
        jobs.fail(old, 'PROCESSING_IO_UNCERTAIN', false),
        /PROCESSING_LEASE_LOST/,
      );
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await assert.rejects(
          jobs.assertLease(current),
          /PROCESSING_LEASE_LOST/,
        );
        await assert.rejects(
          jobs.fail(current, 'PROCESSING_IO_UNCERTAIN', false),
          /PROCESSING_SOURCE_UNAVAILABLE/,
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      await jobs.fail(current, 'PROCESSING_IO_UNCERTAIN', false);
      assert.equal((await execute(completed.assetId)).status, 'succeeded');
    },
  );
  await check(
    'valid image headers with corrupt rasters enter durable review and never produce gallery image grants',
    async () => {
      const context = await scope('invalid');
      const corrupt = pngWithDimensions(48, 24);
      const completed = await upload(context, 'corrupt.png', corrupt);
      assert.equal((await execute(completed.assetId)).status, 'needs_review');
      assert.equal((await usage(context.workspace.id)).reserved_bytes, budget);
      const response = await send(
        'GET',
        `/api/v1/albums/${context.album.id}/photos`,
      );
      const photo = (await response.json()).photos[0];
      assert.equal(photo.processing, 'needs_review');
      assert.equal(photo.previewUrl, null);
      const image = await send(
        'GET',
        `/api/v1/photos/${completed.photoId}/versions/${completed.versionId}/assets/preview`,
      );
      assert.equal(image.status, 404);
    },
  );
  await processingReviewChecks({
    check,
    scope,
    upload,
    execute,
    jobs,
    storage,
    db,
    send,
    request,
    usage,
    owner,
    base,
    cookies,
    worker,
  });
  await check(
    'private gallery keyset pages and image gateway deny anonymous, revoked, mismatched and original access',
    async () => {
      readySecond = await upload(galleryContext, 'ready-second.png');
      assert.equal((await execute(readySecond.assetId)).status, 'succeeded');
      // Twenty-three additional originals stay queued: page boundary and non-ready behavior are real DB state.
      for (let index = 0; index < 23; index++)
        await upload(galleryContext, `pending-${index}.png`);
      // Synthetic fixture only: force a tied timestamp across the page boundary.
      await db
        .prepare('UPDATE photos SET created_at=? WHERE album_id=?')
        .bind('2026-10-23T12:00:00.000Z', galleryContext.album.id)
        .run();
      const path = `/api/v1/albums/${galleryContext.album.id}/photos`;
      let response = await send('GET', path);
      assert.equal(response.status, 200);
      const first = await response.json();
      assert.equal(first.photos.length, 24);
      assert.ok(first.nextCursor);
      response = await send(
        'GET',
        path + '?cursor=' + encodeURIComponent(first.nextCursor),
      );
      const second = await response.json();
      const ordered = [...first.photos, ...second.photos];
      assert.equal(new Set(ordered.map((photo) => photo.createdAt)).size, 1);
      assert.deepEqual(
        ordered.map((photo) => photo.id),
        ordered
          .map((photo) => photo.id)
          .sort()
          .reverse(),
      );
      readyFirstIsFirst =
        ordered.filter((photo) => photo.processing === 'succeeded')[0].id ===
        readyFirst.photoId;
      assert.equal(second.photos.length, 1);
      assert.equal(second.nextCursor, null);
      assert.equal(
        new Set([...first.photos, ...second.photos].map((p) => p.id)).size,
        25,
      );
      assert.equal((await request(path)).status, 401);
      assert.equal((await send('GET', path + '?cursor=bad%%%')).status, 400);
      assert.equal(
        (await send('GET', path + '?cursor=a&cursor=b')).status,
        400,
      );
      const privateImage = `/api/v1/photos/${readyFirst.photoId}/versions/${readyFirst.versionId}/assets/preview`;
      response = await send('GET', privateImage);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      assert.match(response.headers.get('cache-control'), /private, no-store/);
      assert.equal(
        response.headers.get('cross-origin-resource-policy'),
        'same-origin',
      );
      assert.equal((await request(privateImage)).status, 401);
      assert.equal(
        (
          await send(
            'GET',
            privateImage.replace(readyFirst.versionId, readySecond.versionId),
          )
        ).status,
        404,
      );
      assert.equal(
        (await send('GET', privateImage.replace('/preview', '/original')))
          .status,
        400,
      );
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        assert.equal((await send('GET', path)).status, 403);
        assert.equal((await send('GET', privateImage)).status, 403);
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
    },
  );
  await check(
    'real private gallery Grid and Lightbox load verified derivatives, paginate and fit 375px',
    async () => {
      const browser = await chromium.launch({ headless: true });
      let readySecondPagePositioned = false;
      const originalReadyFirstIsFirst = readyFirstIsFirst;
      const cursorHoldCleanup = { release: () => {} };
      try {
        const positioned = await db
          .prepare('UPDATE photos SET created_at=? WHERE id=? AND album_id=?')
          .bind(
            '2026-10-23T11:00:00.000Z',
            readySecond.photoId,
            galleryContext.album.id,
          )
          .run();
        readySecondPagePositioned = true;
        assert.equal(positioned.meta.changes, 1);
        readyFirstIsFirst = true;
        const context = await browser.newContext({
          viewport: { width: 375, height: 812 },
        });
        await context.addCookies([
          {
            name: 'kino-owner.session_token',
            value: cookies.values.get('kino-owner.session_token'),
            url: base,
            httpOnly: true,
            sameSite: 'Lax',
            secure: false,
          },
        ]);
        const page = await context.newPage();
        const external = [];
        const galleryPhotosPath = `/api/v1/albums/${galleryContext.album.id}/photos`;
        const galleryPageReads = [];
        let nextCursorHold = null;
        function armNextCursorPageHold() {
          let captureResolve;
          let gateResolve;
          let timer;
          const capturedResponse = new Promise((resolve) => {
            captureResolve = resolve;
          });
          const gate = new Promise((resolve) => {
            gateResolve = resolve;
          });
          const hold = {
            captured: Promise.race([
              capturedResponse,
              new Promise((resolve) => {
                timer = setTimeout(() => {
                  hold.release();
                  resolve(null);
                }, 10000);
              }),
            ]),
            gate,
            capture(record) {
              clearTimeout(timer);
              captureResolve(record);
            },
            release() {
              clearTimeout(timer);
              gateResolve();
            },
          };
          nextCursorHold = hold;
          cursorHoldCleanup.release = hold.release;
          return hold;
        }
        await page.route('**/*', async (route) => {
          const incoming = route.request();
          const incomingUrl = new URL(incoming.url());
          if (incomingUrl.origin !== base) {
            external.push(incoming.url());
            await route.abort();
            return;
          }
          const init = {
            method: incoming.method(),
            headers: await incoming.allHeaders(),
            redirect: 'manual',
          };
          if (!['GET', 'HEAD'].includes(init.method))
            init.body = incoming.postDataBuffer() ?? undefined;
          const response = await worker.fetch(
            new Request(incoming.url(), init),
          );
          const responseBody = Buffer.from(await response.arrayBuffer());
          if (
            incoming.method() === 'GET' &&
            incomingUrl.pathname === galleryPhotosPath
          ) {
            const pageRead = {
              cursor: incomingUrl.searchParams.get('cursor'),
              status: response.status,
              body: JSON.parse(responseBody.toString('utf8')),
            };
            galleryPageReads.push(pageRead);
            const hold = nextCursorHold;
            if (hold && pageRead.cursor !== null) {
              nextCursorHold = null;
              hold.capture(pageRead);
              await hold.gate;
            }
          }
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: responseBody,
          });
        });
        await page.goto(
          base + `/dashboard/projects/${galleryContext.project.id}`,
          { waitUntil: 'networkidle' },
        );
        await page
          .getByRole('button', {
            name: '查看照片 ' + galleryContext.album.name,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('button', { name: '載入更多照片', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('button', { name: '載入更多照片', exact: true })
          .click();
        await expect(
          page.getByRole('button', {
            name: '開啟照片預覽：ready-first.png',
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole('button', {
            name: '開啟照片預覽：ready-first.png',
            exact: true,
          })
          .click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('img')).toBeVisible();
        await expect(dialog.getByRole('img')).toHaveJSProperty(
          'naturalWidth',
          48,
        );
        await page.keyboard.press(
          readyFirstIsFirst ? 'ArrowRight' : 'ArrowLeft',
        );
        await expect(
          dialog.getByRole('heading', {
            name: 'ready-second.png',
            exact: true,
          }),
        ).toBeVisible();
        await page.keyboard.press(
          readyFirstIsFirst ? 'ArrowLeft' : 'ArrowRight',
        );
        await expect(
          dialog.getByRole('heading', { name: 'ready-first.png', exact: true }),
        ).toBeVisible();
        await page.keyboard.press('Tab');
        assert.equal(
          await dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
          true,
        );
        await mkdir('.local', { recursive: true });
        await page.screenshot({ path: '.local/gallery-lightbox-mobile.png' });
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(
          page.getByRole('button', {
            name: '開啟照片預覽：ready-first.png',
            exact: true,
          }),
        ).toBeFocused();
        await page.screenshot({ path: '.local/gallery-grid-mobile.png' });

        await page.reload({ waitUntil: 'networkidle' });
        await page
          .getByRole('button', {
            name: '查看照片 ' + galleryContext.album.name,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('button', { name: '載入更多照片', exact: true }),
        ).toBeVisible();
        const initialPage = galleryPageReads
          .filter((item) => item.cursor === null)
          .at(-1);
        assert.equal(initialPage?.status, 200);
        assert.equal(initialPage?.body.photos.length, 24);
        assert.ok(
          initialPage.body.photos.some(
            (photo) =>
              photo.id === readyFirst.photoId &&
              photo.processing === 'succeeded' &&
              photo.previewUrl !== null,
          ),
          'The original preview opener is present on the initial gallery page',
        );
        assert.equal(
          initialPage.body.photos.some(
            (photo) => photo.id === readySecond.photoId,
          ),
          false,
          'The second eligible preview is deferred to the actual cursor page',
        );

        const cursorPageHold = armNextCursorPageHold();
        try {
          await page
            .getByRole('button', { name: '載入更多照片', exact: true })
            .click();
          const heldPage = await cursorPageHold.captured;
          assert.ok(heldPage, 'The gallery cursor request reached the Worker');
          assert.equal(heldPage.status, 200);
          assert.notEqual(heldPage.cursor, null);
          assert.equal(heldPage.body.photos.length, 1);
          assert.ok(
            heldPage.body.photos.some(
              (photo) =>
                photo.id === readySecond.photoId &&
                photo.processing === 'succeeded' &&
                photo.previewUrl !== null,
            ),
            'The real second page adds the next keyboard-eligible preview',
          );
          const eligiblePhotoOrder = [
            ...initialPage.body.photos,
            ...heldPage.body.photos,
          ]
            .filter((photo) => photo.processing === 'succeeded')
            .map((photo) => photo.id);
          assert.deepEqual(eligiblePhotoOrder, [
            readyFirst.photoId,
            readySecond.photoId,
          ]);

          const originalOpener = page.getByRole('button', {
            name: '開啟照片預覽：ready-first.png',
            exact: true,
          });
          await expect(originalOpener).toBeVisible();
          await originalOpener.click();
          const delayedDialog = page.getByRole('dialog');
          await expect(delayedDialog).toBeVisible();
          await expect(
            delayedDialog.getByRole('heading', {
              name: 'ready-first.png',
              exact: true,
            }),
          ).toBeVisible();
          await expect(delayedDialog.getByRole('img')).toHaveJSProperty(
            'naturalWidth',
            48,
          );

          cursorPageHold.release();
          await expect(
            page.getByRole('button', {
              name: '開啟照片預覽：ready-second.png',
              exact: true,
            }),
          ).toBeVisible();
          await page.keyboard.press('ArrowRight');
          await expect(
            delayedDialog.getByRole('heading', {
              name: 'ready-second.png',
              exact: true,
            }),
          ).toBeVisible();

          await page.keyboard.press('Escape');
          await expect(delayedDialog).toHaveCount(0);
          await expect(originalOpener).toBeFocused();
        } finally {
          cursorPageHold.release();
          nextCursorHold = null;
        }

        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth,
          ),
          false,
        );
        assert.deepEqual(external, []);
        await context.close();
      } finally {
        cursorHoldCleanup.release();
        try {
          if (readySecondPagePositioned) {
            await db
              .prepare(
                'UPDATE photos SET created_at=? WHERE id=? AND album_id=?',
              )
              .bind(
                '2026-10-23T12:00:00.000Z',
                readySecond.photoId,
                galleryContext.album.id,
              )
              .run();
          }
        } finally {
          readyFirstIsFirst = originalReadyFirstIsFirst;
          await browser.close();
        }
      }
    },
  );
  return { context: galleryContext, photo: readyFirst, storage };
}
