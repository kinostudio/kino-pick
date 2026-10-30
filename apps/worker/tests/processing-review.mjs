import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { R2ProcessingReviewStore } from '../src/processing-review-storage.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { pngWithDimensions } from './image-fixtures.mjs';

export async function processingReviewChecks({
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
}) {
  const context = await scope('review preview');
  const completed = await upload(
    context,
    'review-corrupt.png',
    pngWithDimensions(48, 24),
  );
  assert.equal((await execute(completed.assetId)).status, 'needs_review');
  const path = `/api/v1/photos/${completed.photoId}/versions/${completed.versionId}/processing-review`;
  const physical = new R2ProcessingReviewStore(storage);
  const slots = (jobId = completed.assetId, target = context) =>
    ['thumbnail', 'preview'].map((kind) => ({
      jobId,
      kind,
      workspaceId: target.workspace.id,
      projectId: target.project.id,
      albumId: target.album.id,
      key: `${target.workspace.id}/${target.project.id}/${target.album.id}/${jobId}/derived/local-sharp-0.35.5-v1/${kind}.jpg`,
    }));
  await check(
    'Owner processing review dry-run is scoped, private and changes no objects, audit, job or quota',
    async () => {
      const beforeJob = await db
        .prepare('SELECT * FROM image_processing_jobs WHERE id=?')
        .bind(completed.assetId)
        .first();
      const beforeUsage = await usage(context.workspace.id);
      const beforeAudit = await db
        .prepare('SELECT count(*) AS n FROM audit_events')
        .first();
      const beforeObjects = (await storage.list()).objects.map(
        (object) => object.key,
      );
      let response = await send('GET', path);
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get('cache-control'), /private, no-store/);
      const preview = await response.json();
      assert.equal(preview.jobId, completed.assetId);
      assert.equal(preview.potentialReleaseBytes, 16777216);
      assert.equal(preview.heldBytes, 16777216);
      assert.equal(preview.dryRun, true);
      assert.equal(preview.originalRetained, true);
      assert.deepEqual(
        preview.outputs.map((item) => item.state),
        ['missing', 'missing'],
      );
      assert.ok(!JSON.stringify(preview).includes('/derived/'));
      assert.equal((await request(path)).status, 401);
      assert.equal(
        (await send('GET', path.replace(completed.versionId, randomUUID())))
          .status,
        404,
      );
      assert.equal(
        (await send('GET', path.replace(completed.photoId, 'bad'))).status,
        400,
      );
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        assert.equal((await send('GET', path)).status, 403);
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      assert.deepEqual(
        await db
          .prepare('SELECT * FROM image_processing_jobs WHERE id=?')
          .bind(completed.assetId)
          .first(),
        beforeJob,
      );
      assert.deepEqual(await usage(context.workspace.id), beforeUsage);
      assert.deepEqual(
        await db.prepare('SELECT count(*) AS n FROM audit_events').first(),
        beforeAudit,
      );
      assert.deepEqual(
        (await storage.list()).objects.map((object) => object.key),
        beforeObjects,
      );
    },
  );
  await check(
    'conditional processing fences survive ambiguous writes, deny late creates and never release quota by themselves',
    async () => {
      const pair = slots();
      let lost = true;
      const uncertain = new R2ProcessingReviewStore({
        head: (...args) => storage.head(...args),
        put: async (...args) => {
          const result = await storage.put(...args);
          if (lost) {
            lost = false;
            throw new Error('lost response after commit');
          }
          return result;
        },
      });
      assert.equal((await uncertain.fenceBoth(pair)).bothFenced, true);
      assert.equal((await physical.fenceBoth(pair)).bothFenced, true);
      for (const slot of pair) {
        assert.equal(
          await storage.put(slot.key, new Uint8Array([1, 2, 3]), {
            onlyIf: { etagDoesNotMatch: '*' },
            httpMetadata: { contentType: 'image/jpeg' },
          }),
          null,
        );
        assert.equal((await storage.head(slot.key)).size, 0);
      }
      assert.equal(
        (await usage(context.workspace.id)).reserved_bytes,
        16777216,
      );
      assert.equal(await jobs.claim(completed.assetId), null);
      const preview = await (await send('GET', path)).json();
      assert.deepEqual(
        preview.outputs.map((output) => output.state),
        ['fenced', 'fenced'],
      );
      assert.equal(preview.heldBytes, 16777216);
    },
  );
  await check(
    'occupied, forged, unknown and racing processing outputs cannot be certified as both fenced',
    async () => {
      const pair = slots(randomUUID());
      const first = pair[0];
      await storage.put(first.key, new Uint8Array([1]), {
        httpMetadata: {
          contentType: 'application/x-kino-pic-processing-fence',
        },
        customMetadata: {
          kinoProcessingFence: first.jobId,
          kinoProcessingKind: first.kind,
        },
      });
      assert.equal((await physical.fenceBoth(pair)).bothFenced, false);
      assert.equal((await storage.head(first.key)).size, 1);
      const unavailable = new R2ProcessingReviewStore({
        head: async () => {
          throw new Error('unavailable');
        },
        put: async () => {
          throw new Error('unavailable');
        },
      });
      assert.equal(
        (await unavailable.fenceBoth(slots(randomUUID()))).bothFenced,
        false,
      );
      assert.equal(await unavailable.inspect(pair[0]), 'unknown');
      const racingPair = slots(randomUUID());
      let raced = false;
      const racing = new R2ProcessingReviewStore({
        head: (...args) => storage.head(...args),
        put: async (key, body, options) => {
          if (!raced) {
            raced = true;
            await storage.put(key, new Uint8Array([9]), {
              onlyIf: { etagDoesNotMatch: '*' },
            });
          }
          return storage.put(key, body, options);
        },
      });
      assert.equal((await racing.fenceBoth(racingPair)).bothFenced, false);
      assert.equal((await storage.head(racingPair[0].key)).size, 1);
      await assert.rejects(physical.fenceBoth([pair[0], pair[0]]));
      await assert.rejects(
        physical.fenceBoth([pair[0], slots(randomUUID())[1]]),
      );
      await assert.rejects(
        physical.inspect({ ...pair[0], key: pair[0].key + '/wrong' }),
      );
      assert.equal(
        (await usage(context.workspace.id)).reserved_bytes,
        16777216,
      );
    },
  );
  await check(
    'a fence winning after the native runner lease check prevents completion and retains both quota reservations',
    async () => {
      const target = await scope('fence runner race');
      const original = await upload(target);
      const store = new R2ProcessingObjectStore(storage);
      const pair = slots(original.assetId, target);
      let won = false;
      const result = await execute(original.assetId, {
        objects: {
          read: (...args) => store.read(...args),
          putIfAbsent: async (...args) => {
            if (!won) {
              won = true;
              assert.equal((await physical.fenceBoth(pair)).bothFenced, true);
            }
            return store.putIfAbsent(...args);
          },
        },
      });
      assert.equal(result.status, 'needs_review');
      assert.equal((await usage(target.workspace.id)).reserved_bytes, 16777216);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM photo_assets WHERE version_id=? AND asset_kind<>'original'",
            )
            .bind(original.versionId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='processing.succeeded'",
            )
            .bind(original.photoId)
            .first()
        ).n,
        0,
      );
      for (const slot of pair)
        assert.equal(await physical.inspect(slot), 'fenced');
    },
  );
  await check(
    'occupied review output reports zero potential release and retains the original and all held capacity',
    async () => {
      const target = await scope('occupied review');
      const original = await upload(
        target,
        'invalid-occupied.png',
        pngWithDimensions(48, 24),
      );
      assert.equal((await execute(original.assetId)).status, 'needs_review');
      const pair = slots(original.assetId, target);
      await storage.put(pair[0].key, new Uint8Array([1, 2, 3]), {
        onlyIf: { etagDoesNotMatch: '*' },
      });
      const response = await send(
        'GET',
        `/api/v1/photos/${original.photoId}/versions/${original.versionId}/processing-review`,
      );
      assert.equal(response.status, 200);
      const preview = await response.json();
      assert.equal(preview.potentialReleaseBytes, 0);
      assert.equal(
        preview.outputs.find((output) => output.kind === 'thumbnail').state,
        'occupied',
      );
      assert.equal((await usage(target.workspace.id)).reserved_bytes, 16777216);
      assert.equal((await storage.head(pair[0].key)).size, 3);
      const rejection = await send(
        'POST',
        `/api/v1/photos/${original.photoId}/versions/${original.versionId}/processing-review/abandon`,
        {
          requestId: randomUUID(),
          expectedLeaseEpoch: 1,
          confirmAbandon: true,
        },
      );
      assert.equal(rejection.status, 409);
      assert.equal(
        (await rejection.json()).error.code,
        'PROCESSING_OUTPUTS_OCCUPIED',
      );
      assert.equal((await usage(target.workspace.id)).reserved_bytes, 16777216);
      assert.equal((await storage.head(pair[0].key)).size, 3);
      assert.equal(await physical.inspect(pair[1]), 'fenced');
    },
  );
  await check(
    'Owner-confirmed abandonment atomically releases both ledgers once and rolls back on audit failure',
    async () => {
      const target = await scope('resolution');
      const original = await upload(
        target,
        'resolution-corrupt.png',
        pngWithDimensions(48, 24),
      );
      assert.equal((await execute(original.assetId)).status, 'needs_review');
      const endpoint = `/api/v1/photos/${original.photoId}/versions/${original.versionId}/processing-review/abandon`;
      const intent = {
        requestId: randomUUID(),
        expectedLeaseEpoch: 1,
        confirmAbandon: true,
      };
      const originalKey = (
        await db
          .prepare('SELECT object_key FROM photo_assets WHERE id=?')
          .bind(original.assetId)
          .first()
      ).object_key;
      const nodeBefore = await db
        .prepare(
          "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
        )
        .first();
      assert.equal(
        (await send('POST', endpoint, { ...intent, confirmAbandon: false }))
          .status,
        400,
      );
      assert.equal(
        (await send('POST', endpoint, { ...intent, fences: [] })).status,
        400,
      );
      assert.equal(
        (await send('POST', endpoint, { ...intent, expectedLeaseEpoch: 2 }))
          .status,
        409,
      );
      assert.equal(
        (
          await request(endpoint, {
            method: 'POST',
            headers: {
              Cookie: cookies.headers(),
              'Content-Type': 'application/json',
              Origin: 'https://evil.invalid',
            },
            body: JSON.stringify(intent),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: base },
            body: JSON.stringify(intent),
          })
        ).status,
        401,
      );
      for (const slot of slots(original.assetId, target))
        assert.equal(await physical.inspect(slot), 'missing');
      const priorCommand = await db
        .prepare(
          'SELECT request_id FROM request_commands WHERE actor_id=? LIMIT 1',
        )
        .bind(owner)
        .first();
      assert.equal(
        (
          await send('POST', endpoint, {
            ...intent,
            requestId: priorCommand.request_id,
          })
        ).status,
        409,
      );
      await db
        .prepare(
          "UPDATE storage_nodes SET status='readonly' WHERE id='primary'",
        )
        .run();
      try {
        assert.equal((await send('POST', endpoint, intent)).status, 409);
      } finally {
        await db
          .prepare(
            "UPDATE storage_nodes SET status='active' WHERE id='primary'",
          )
          .run();
      }
      for (const slot of slots(original.assetId, target))
        assert.equal(await physical.inspect(slot), 'missing');
      await db.exec(
        "CREATE TRIGGER reject_abandon_audit BEFORE INSERT ON audit_events WHEN NEW.action='processing.abandoned' BEGIN SELECT RAISE(ABORT,'TEST_ABANDON_AUDIT'); END;",
      );
      try {
        assert.equal((await send('POST', endpoint, intent)).status, 503);
        assert.equal(
          (await usage(target.workspace.id)).reserved_bytes,
          16777216,
        );
        assert.equal(
          (
            await db
              .prepare('SELECT status FROM image_processing_jobs WHERE id=?')
              .bind(original.assetId)
              .first()
          ).status,
          'needs_review',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM processing_review_commands WHERE job_id=?',
              )
              .bind(original.assetId)
              .first()
          ).n,
          0,
        );
        for (const slot of slots(original.assetId, target))
          assert.equal(await physical.inspect(slot), 'fenced');
      } finally {
        await db.exec('DROP TRIGGER reject_abandon_audit;');
      }
      const outcomes = await Promise.all([
        send('POST', endpoint, intent),
        send('POST', endpoint, intent),
      ]);
      for (const outcome of outcomes)
        assert.equal(outcome.status, 200, await outcome.clone().text());
      assert.deepEqual(await outcomes[0].json(), await outcomes[1].json());
      assert.equal((await usage(target.workspace.id)).reserved_bytes, 0);
      const nodeAfter = await db
        .prepare(
          "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
        )
        .first();
      assert.equal(
        nodeAfter.reserved_bytes,
        nodeBefore.reserved_bytes - 16777216,
      );
      assert.equal(nodeAfter.used_bytes, nodeBefore.used_bytes);
      assert.equal(
        (await storage.head(originalKey)).size,
        pngWithDimensions(48, 24).byteLength,
      );
      const audit = (
        await db
          .prepare(
            "SELECT actor_type,actor_id,session_id,request_id,before_json,after_json FROM audit_events WHERE photo_id=? AND action='processing.abandoned'",
          )
          .bind(original.photoId)
          .all()
      ).results;
      assert.equal(audit.length, 1);
      assert.equal(audit[0].actor_type, 'user');
      assert.equal(audit[0].actor_id, owner);
      assert.ok(audit[0].session_id);
      assert.equal(audit[0].request_id, intent.requestId);
      assert.equal(JSON.parse(audit[0].before_json).reservedBytes, 16777216);
      assert.equal(JSON.parse(audit[0].after_json).reservedBytes, 0);
      assert.equal(await jobs.claim(original.assetId), null);
      assert.equal(
        (await send('POST', endpoint, { ...intent, expectedLeaseEpoch: 2 }))
          .status,
        409,
      );
      assert.equal(
        (
          await send('POST', '/api/v1/workspaces', {
            name: 'collision',
            requestId: intent.requestId,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await send('POST', '/api/v1/uploads/init', {
            workspaceId: target.workspace.id,
            projectId: target.project.id,
            albumId: target.album.id,
            originalFilename: 'conflict.png',
            expectedBytes: 8,
            contentType: 'image/png',
            sha256: 'a'.repeat(64),
            requestId: intent.requestId,
          })
        ).status,
        409,
      );
      const uploadSession = await db
        .prepare(
          'SELECT upload_session_id AS id FROM upload_completions WHERE asset_id=?',
        )
        .bind(original.assetId)
        .first();
      assert.equal(
        (
          await send('POST', `/api/v1/uploads/${uploadSession.id}/authorize`, {
            requestId: intent.requestId,
          })
        ).status,
        409,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE processing_review_commands SET session_id=? WHERE job_id=?',
          )
          .bind('changed', original.assetId)
          .run(),
        /IMMUTABLE_PROCESSING_REVIEW/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM processing_review_commands WHERE job_id=?')
          .bind(original.assetId)
          .run(),
        /IMMUTABLE_PROCESSING_REVIEW/,
      );
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        assert.equal((await send('POST', endpoint, intent)).status, 403);
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      assert.equal((await send('POST', endpoint, intent)).status, 200);
      await db
        .prepare(
          "UPDATE albums SET state='archived',archived_from_state='draft' WHERE id=?",
        )
        .bind(target.album.id)
        .run();
      try {
        assert.equal((await send('POST', endpoint, intent)).status, 200);
      } finally {
        await db
          .prepare(
            "UPDATE albums SET state='draft',archived_from_state=NULL WHERE id=?",
          )
          .bind(target.album.id)
          .run();
      }
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,'workspace.created','{}','invalid',?)",
          )
          .bind(owner, intent.requestId, randomUUID())
          .run(),
        /OWNER_REQUIRED/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms) VALUES(?,?,'upload.reserved','{}','invalid',?,0)",
          )
          .bind(owner, intent.requestId, randomUUID())
          .run(),
        /OWNER_REQUIRED/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms) VALUES(?,?,'upload.authorized','{}','invalid',?,0)",
          )
          .bind(owner, intent.requestId, randomUUID())
          .run(),
        /OWNER_REQUIRED/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO processing_review_commands(actor_id,request_id,session_id,job_id,expected_epoch,payload_json,fences_json,created_at_ms) VALUES(?,?,'invalid',?,1,'{}','[]',0)",
          )
          .bind(owner, intent.requestId, original.assetId)
          .run(),
        /OWNER_REQUIRED/,
      );
      assert.equal(
        (await send('GET', `/api/v1/albums/${target.album.id}/photos`)).status,
        200,
      );
      assert.equal(
        (
          await (
            await send('GET', `/api/v1/albums/${target.album.id}/photos`)
          ).json()
        ).photos[0].processing,
        'abandoned',
      );
    },
  );
  await check(
    '375px Owner confirms abandonment and retries a lost successful response using the same operation ID',
    async () => {
      const { chromium, expect } = await import('@playwright/test');
      const browser = await chromium.launch();
      const browserContext = await browser.newContext({
        viewport: { width: 375, height: 812 },
      });
      const origin = new URL(base);
      await browserContext.addCookies(
        cookies
          .headers()
          .split('; ')
          .map((entry) => {
            const split = entry.indexOf('=');
            return {
              name: entry.slice(0, split),
              value: entry.slice(split + 1),
              domain: origin.hostname,
              path: '/',
            };
          }),
      );
      const page = await browserContext.newPage();
      const requestIds = [];
      let loseAcknowledgement = true;
      try {
        await page.route('**/*', async (route) => {
          const incoming = route.request();
          assert.equal(new URL(incoming.url()).origin, base);
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
          if (
            incoming.method() === 'POST' &&
            new URL(incoming.url()).pathname.endsWith(
              '/processing-review/abandon',
            )
          ) {
            requestIds.push(incoming.postDataJSON().requestId);
            assert.equal(response.status, 200, await response.clone().text());
            if (loseAcknowledgement) {
              loseAcknowledgement = false;
              await route.abort('failed');
              return;
            }
          }
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
          });
        });
        await page.goto(base + `/dashboard/projects/${context.project.id}`, {
          waitUntil: 'networkidle',
        });
        await page
          .getByRole('button', {
            name: `查看照片 ${context.album.name}`,
            exact: true,
          })
          .click();
        await page
          .getByRole('button', { name: '檢視處理問題', exact: true })
          .click();
        await expect(
          page.getByText('原圖已保留。處理失敗的預留容量：16 MiB。', {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText('縮圖：已封鎖寫入', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText('預覽圖：已封鎖寫入', { exact: true }),
        ).toBeVisible();
        const release = page.getByRole('button', {
          name: '停止處理並釋放預留容量',
          exact: true,
        });
        await expect(release).toBeDisabled();
        await page.getByRole('checkbox').check();
        await expect(release).toBeEnabled();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        );
        await page.screenshot({
          path: '.local/processing-review-mobile.png',
          fullPage: true,
        });
        await release.click();
        await expect(page.getByRole('alert')).toContainText('相同操作重試');
        await release.click();
        await expect(
          page.getByText('已停止處理，原圖已保留', { exact: true }),
        ).toBeVisible();
        assert.equal(requestIds.length, 2);
        assert.equal(new Set(requestIds).size, 1);
        assert.equal((await usage(context.workspace.id)).reserved_bytes, 0);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='processing.abandoned'",
              )
              .bind(completed.photoId)
              .first()
          ).n,
          1,
        );
        await page.screenshot({
          path: '.local/processing-abandoned-mobile.png',
          fullPage: true,
        });
      } finally {
        await browser.close();
      }
    },
  );
}
