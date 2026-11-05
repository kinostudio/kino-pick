import { applyMigration } from './apply-migration.mjs';
import { createServer } from 'node:http';
import { chromium, expect } from '@playwright/test';
import { unstable_splitSqlQuery } from 'wrangler';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import sharp from 'sharp';
import { D1UploadRepository } from '../src/uploads.ts';
import { R2StorageAdapter } from '../src/r2-storage.ts';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { CloudflareImagesProcessor } from '../../../packages/image-processing/src/cloudflare-images.ts';
const oldRecipe = 'local-sharp-0.35.5-v1',
  cloudRecipe = 'cloudflare-images-jpeg-82-v1';
const base = 'http://127.0.0.1:8798',
  owner = randomUUID(),
  sid = randomUUID(),
  token = randomUUID();
const secret =
  'processing-recipes-isolated-test-secret-at-least-forty-characters';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_DOWNLOADS_ENABLED: 'true',
  BETTER_AUTH_SECRET: secret,
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-not-real-secret',
  R2_BUCKET_NAME: 'processing-recipes-isolated',
};
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        d1Databases: { DB: 'processing-recipes-isolated' },
        r2Buckets: { PRIMARY_STORAGE: 'processing-recipes-isolated' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
      },
    ],
  }),
);
const hash = (x) => createHash('sha256').update(x).digest('hex');
const flat = (s) =>
  s
    .split(/\r?\n/)
    .filter((x) => x.trim() && !x.trim().startsWith('--'))
    .join(' ');
const checks = [];
async function check(label, run) {
  await run();
  checks.push(label);
  console.log('passed: ' + label);
}
try {
  const db = await mf.getD1Database('DB', 'app'),
    storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
  for (const name of (await readdir('migrations'))
    .filter((x) => /^\d{4}.*\.sql$/.test(x) && x < '0055')
    .sort())
    await db.exec(flat(await readFile('migrations/' + name, 'utf8')));
  await db
    .prepare(
      'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
    )
    .bind(owner, 'processing-recipes-test')
    .run();
  const now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(sid, token, owner, now + 3600000, now, now)
    .run();
  const cookie =
    'kino-owner.session_token=' +
    encodeURIComponent(token + '.' + (await makeSignature(token, secret)));
  const headers = {
    Cookie: cookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
  };
  const request = (path, init = {}) => mf.dispatchFetch(base + path, init);
  const post = async (path, body, status = 200) => {
    const response = await request(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  const { workspace } = await post(
    '/api/v1/workspaces',
    {
      name: 'Recipe upgrade fixture',
      requestId: randomUUID(),
    },
    201,
  );
  const { project } = await post(
    '/api/v1/projects',
    {
      workspaceId: workspace.id,
      name: 'Recipe upgrade fixture',
      requestId: randomUUID(),
    },
    201,
  );
  const fixture = {
    workspaceId: workspace.id,
    projectId: project.id,
    albumId: randomUUID(),
  };
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(
      fixture.albumId,
      fixture.workspaceId,
      fixture.projectId,
      'Recipe upgrade album',
    )
    .run();
  // Seed schema54 through its primary-only repository; current HTTP admission requires schema65.
  let seedingSchema54 = true;
  const legacyUploads = new D1UploadRepository(
    db,
    owner,
    sid,
    new R2StorageAdapter(storage),
  );
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#28647a' },
  })
    .png()
    .toBuffer();
  async function init(expectedBytes = source.length) {
    const body = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      albumId: fixture.albumId,
      originalFilename: randomUUID() + '.png',
      expectedBytes,
      contentType: 'image/png',
      sha256: hash(source),
      requestId: randomUUID(),
    };
    if (seedingSchema54) return legacyUploads.reserve(body);
    return (await post('/api/v1/uploads/init', body, 201)).uploadSession;
  }
  async function upload() {
    const session = await init();
    await post('/api/v1/uploads/' + session.id + '/authorize', {
      requestId: randomUUID(),
    });
    const row = await db
      .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
      .bind(session.id)
      .first();
    await storage.put(row.object_key, source, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/png' },
      sha256: hash(source),
    });
    await post('/api/v1/uploads/' + session.id + '/complete', {
      requestId: randomUUID(),
    });
    return db
      .prepare(
        "SELECT a.id,a.photo_id,a.version_id FROM photo_assets a WHERE a.object_key=? AND a.asset_kind='original'",
      )
      .bind(row.object_key)
      .first();
  }
  const jobs = new D1ImageProcessingRepository(db);
  const review = await upload();
  const claim = await jobs.claim(review.id);
  await jobs.fail(claim, 'PROCESSING_CONTENT_INVALID', true);
  await post(
    `/api/v1/photos/${review.photo_id}/versions/${review.version_id}/processing-review/abandon`,
    {
      expectedLeaseEpoch: claim.leaseEpoch,
      confirmAbandon: true,
      requestId: randomUUID(),
    },
  );
  const queued = await upload();
  const tables = (
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all()
  ).results.map((x) => x.name);
  async function snapshot() {
    const rows = {};
    for (const name of tables) {
      const values = (await db.prepare('SELECT * FROM "' + name + '"').all())
        .results;
      rows[name] = hash(
        JSON.stringify(values.map((x) => JSON.stringify(x)).sort()),
      );
    }
    return rows;
  }
  const before = await snapshot();
  const triggers = (
    await db
      .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
      .all()
  ).results;
  const migration = await readFile(
    'migrations/0055_processing_recipes.sql',
    'utf8',
  );
  await check(
    'populated native D1 upgrade preserves every existing table row and FK',
    async () => {
      for (const table of [
        'processing_review_commands',
        'owner_external_intents',
      ])
        assert.ok(
          (await db.prepare('SELECT count(*) n FROM ' + table).first()).n > 0,
          table + ' populated',
        );
      const statements = unstable_splitSqlQuery(migration);
      await assert.rejects(
        db.batch([
          ...statements.map((sql) => db.prepare(sql)),
          db.prepare('SELECT * FROM intentionally_missing_migration_table'),
        ]),
      );
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        await db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='workspace_image_processing_policies'",
          )
          .first(),
        null,
      );
      await applyMigration(db, migration);
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual(
        (await db.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
      const after = new Map(
        (
          await db
            .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
            .all()
        ).results.map((x) => [x.name, x.sql]),
      );
      for (const t of triggers)
        if (
          ![
            'processing_original_outbox',
            'processing_job_insert_guard',
          ].includes(t.name)
        )
          assert.equal(
            flat(after.get(t.name) ?? '')
              .replace(/\s+/g, ' ')
              .trim(),
            t.sql.replace(/\s+/g, ' ').trim(),
            t.name,
          );
      for (const view of [
        'guest_comment_eligible_versions',
        'guest_annotation_eligible_versions',
      ])
        await db.prepare('SELECT count(*) n FROM ' + view).first();
    },
  );
  const namespaceMigration = await readFile(
    'migrations/0056_processing_policy_and_retry_guards.sql',
    'utf8',
  );
  await applyMigration(db, namespaceMigration);
  for (const name of (await readdir('migrations'))
    .filter(
      (name) => /^\d{4}.*\.sql$/.test(name) && Number(name.slice(0, 4)) > 56,
    )
    .sort())
    await applyMigration(db, await readFile('migrations/' + name, 'utf8'));
  seedingSchema54 = false;
  assert.ok(
    await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='storage_pending_derivative_capacity'",
      )
      .first(),
  );

  const policyPath =
    '/api/v1/workspaces/' + fixture.workspaceId + '/image-processing-policy';
  const change = (recipe, revision, requestId = randomUUID(), status = 200) =>
    post(policyPath, { recipe, expectedRevision: revision, requestId }, status);
  await check(
    'default Sharp survives upgrade and finishes existing queued work',
    async () => {
      const r = await request(policyPath, { headers });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).recipe, oldRecipe);
      const caps = await request(
        '/api/v1/workspaces/' + fixture.workspaceId + '/upload-capabilities',
        { headers },
      );
      assert.equal(caps.status, 200);
      assert.equal((await caps.json()).maxBrowserBytes, 64 * 1024 * 1024);

      assert.equal(
        (
          await runImageProcessingJob({
            jobId: queued.id,
            jobs,
            objects: new R2ProcessingObjectStore(storage),
            processor: new LocalSharpImageProcessor(),
          })
        ).status,
        'succeeded',
      );
    },
  );
  const policyId = randomUUID();
  await check(
    'authorized policy is revisioned, replay stable and tenant scoped',
    async () => {
      const receipt = await change(cloudRecipe, 0, policyId);
      assert.equal(receipt.revision, 1);
      const capsPath =
        '/api/v1/workspaces/' + fixture.workspaceId + '/upload-capabilities';
      const caps = await request(capsPath, { headers });
      assert.equal(caps.status, 200);
      assert.equal(caps.headers.get('cache-control'), 'private, no-store');
      const capValue = await caps.json();
      assert.equal(capValue.maxBrowserBytes, 16 * 1024 * 1024);
      assert.equal(capValue.enabled, false); // Native fixture intentionally has cloud processing OFF.
      assert.equal((await request(capsPath)).status, 401);
      assert.equal(
        (
          await request(
            '/api/v1/workspaces/' + randomUUID() + '/upload-capabilities',
            { headers },
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await request(capsPath + '?workspaceId=' + fixture.workspaceId, {
            headers,
          })
        ).status,
        400,
      );
      assert.equal(
        (await request(capsPath + '?unexpected=1', { headers })).status,
        400,
      );
      const legacyCaps = await request('/api/v1/uploads/capabilities', {
        headers,
      });
      assert.equal((await legacyCaps.json()).maxBrowserBytes, 64 * 1024 * 1024);

      const oldId = (
        await db
          .prepare(
            'SELECT request_id FROM workspace_commands WHERE actor_id=? LIMIT 1',
          )
          .bind(owner)
          .first()
      ).request_id;
      assert.equal(
        (await change(cloudRecipe, 0, oldId, 409)).error.code,
        'REQUEST_ID_CONFLICT',
      );
      assert.equal(
        (
          await post(
            '/api/v1/workspaces',
            { name: 'Blocked duplicate request', requestId: policyId },
            409,
          )
        ).error.code,
        'REQUEST_ID_CONFLICT',
      );

      assert.deepEqual(await change(cloudRecipe, 0, policyId), receipt);
      await change(oldRecipe, 0, randomUUID(), 409);
      await change(oldRecipe, 0, policyId, 409);
      const foreign = await request(
        '/api/v1/workspaces/' + randomUUID() + '/image-processing-policy',
        { headers },
      );
      assert.equal(foreign.status, 404);
      const anonymous = await request(policyPath);
      assert.equal(anonymous.status, 401);
    },
  );
  await check(
    'Cloudflare admission rejects over16MiB without reserving quota',
    async () => {
      const beforeUsage = await db
        .prepare(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        )
        .bind(fixture.workspaceId)
        .first();
      await post(
        '/api/v1/uploads/init',
        {
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          albumId: fixture.albumId,
          originalFilename: 'large.png',
          expectedBytes: 16777217,
          contentType: 'image/png',
          sha256: hash(source),
          requestId: randomUUID(),
        },
        409,
      );
      assert.deepEqual(
        await db
          .prepare(
            'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(fixture.workspaceId)
          .first(),
        beforeUsage,
      );
    },
  );
  await check(
    'in-flight reservations prevent recipe switch; receipts remain immutable',
    async () => {
      const session = await init();
      await change(oldRecipe, 1, randomUUID(), 409);
      await post('/api/v1/uploads/' + session.id + '/cancel', {
        requestId: randomUUID(),
      });
      await change(oldRecipe, 1);
      await change(cloudRecipe, 2);
      const replay = await change(cloudRecipe, 0, policyId);
      assert.equal(replay.revision, 1);
      await assert.rejects(
        db
          .prepare(
            'UPDATE workspace_image_processing_policy_commands SET recipe=? WHERE actor_id=? AND request_id=?',
          )
          .bind(oldRecipe, owner, policyId)
          .run(),
        /IMMUTABLE_PROCESSING_POLICY_COMMAND/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO audit_events(event_id,actor_type,action,request_id) VALUES('forged','system','image_processing.policy_changed','forged')",
          )
          .run(),
        /PROCESSING_POLICY_AUDIT_INVALID/,
      );
    },
  );
  const cloud = await upload();
  await check(
    'new Cloudflare recipe and canonical slots preserve historical recipes',
    async () => {
      const record = await db
        .prepare('SELECT recipe FROM image_processing_jobs WHERE id=?')
        .bind(cloud.id)
        .first();
      assert.equal(record.recipe, cloudRecipe);
      const slots = (
        await db
          .prepare(
            'SELECT object_key FROM image_processing_outputs WHERE job_id=?',
          )
          .bind(cloud.id)
          .all()
      ).results;
      assert.equal(slots.length, 2);
      assert.ok(
        slots.every((x) =>
          x.object_key.includes('/derived/' + cloudRecipe + '/'),
        ),
      );
      assert.equal(
        (
          await db
            .prepare('SELECT recipe FROM image_processing_jobs WHERE id=?')
            .bind(queued.id)
            .first()
        ).recipe,
        oldRecipe,
      );
      assert.equal(await jobs.claim(cloud.id), null);
    },
  );
  // Provider is explicitly mocked in this native-D1 flow. Real binding proof is separate.
  const images = {
    async info(stream) {
      const bytes = Buffer.from(await new Response(stream).arrayBuffer());
      const m = await sharp(bytes).metadata();
      return {
        format: 'image/' + m.format,
        fileSize: bytes.length,
        width: m.width,
        height: m.height,
      };
    },
    input(stream) {
      return {
        transform(options) {
          return {
            async output() {
              const bytes = await sharp(
                Buffer.from(await new Response(stream).arrayBuffer()),
              )
                .rotate()
                .resize(options.width, options.height, {
                  fit: 'inside',
                  withoutEnlargement: true,
                })
                .jpeg({ quality: 82 })
                .toBuffer();
              return {
                response: () =>
                  new Response(bytes, {
                    headers: { 'Content-Type': 'image/jpeg' },
                  }),
              };
            },
          };
        },
      };
    },
  };
  const cfJobs = new D1ImageProcessingRepository(db, {
    processorVersion: cloudRecipe,
  });
  await check(
    'Cloudflare adapter durable finalization publishes both private derivatives and gallery',
    async () => {
      const outcome = await runImageProcessingJob({
        jobId: cloud.id,
        jobs: cfJobs,
        objects: new R2ProcessingObjectStore(storage),
        processor: new CloudflareImagesProcessor(images),
      });
      assert.equal(outcome.status, 'succeeded');
      const response = await request(
        '/api/v1/albums/' + fixture.albumId + '/photos',
        { headers },
      );
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.json();
      assert.ok(JSON.stringify(body).includes(cloud.photo_id));
      assert.ok(!JSON.stringify(body).includes('/derived/'));
      const slots = (
        await db
          .prepare(
            'SELECT object_key FROM image_processing_outputs WHERE job_id=?',
          )
          .bind(cloud.id)
          .all()
      ).results;
      for (const slot of slots) {
        const obj = await storage.get(slot.object_key);
        assert.ok(obj);
        await sharp(Buffer.from(await obj.arrayBuffer()))
          .raw()
          .toBuffer();
      }
      await assert.rejects(
        db
          .prepare('UPDATE image_processing_jobs SET recipe=? WHERE id=?')
          .bind(oldRecipe, cloud.id)
          .run(),
        /IMMUTABLE|INVALID|PROCESSING/,
      );
      assert.deepEqual(
        (await db.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
    },
  );
  await check(
    'Cloudflare review abandonment fences the immutable recipe-specific slots',
    async () => {
      const item = await upload();
      const claimed = await cfJobs.claim(item.id);
      assert.ok(claimed);
      await cfJobs.fail(claimed, 'PROCESSING_CONTENT_INVALID', true);
      await post(
        `/api/v1/photos/${item.photo_id}/versions/${item.version_id}/processing-review/abandon`,
        {
          expectedLeaseEpoch: claimed.leaseEpoch,
          confirmAbandon: true,
          requestId: randomUUID(),
        },
      );
      assert.equal(
        (
          await db
            .prepare('SELECT status FROM image_processing_jobs WHERE id=?')
            .bind(item.id)
            .first()
        ).status,
        'abandoned',
      );
      for (const slot of (
        await db
          .prepare(
            'SELECT object_key FROM image_processing_outputs WHERE job_id=?',
          )
          .bind(item.id)
          .all()
      ).results) {
        assert.ok(slot.object_key.includes('/' + cloudRecipe + '/'));
        const fence = await storage.head(slot.object_key);
        assert.equal(fence.size, 0);
        assert.equal(
          fence.httpMetadata.contentType,
          'application/x-kino-pic-processing-fence',
        );
      }
    },
  );
  await check(
    'three transient Cloudflare failures retain quota and enter review instead of blocking forever',
    async () => {
      const item = await upload();
      const objects = new R2ProcessingObjectStore(storage);
      for (const status of ['retryable', 'retryable', 'needs_review'])
        assert.equal(
          (
            await runImageProcessingJob({
              jobId: item.id,
              jobs: cfJobs,
              objects,
              maxTransientAttempts: 3,
              processor: {
                async process() {
                  throw new Error('synthetic temporary provider failure');
                },
              },
            })
          ).status,
          status,
        );
      const row = await db
        .prepare(
          'SELECT status,reserved_bytes,reason_code,attempts FROM image_processing_jobs WHERE id=?',
        )
        .bind(item.id)
        .first();
      assert.deepEqual(row, {
        status: 'needs_review',
        reserved_bytes: 16777216,
        reason_code: 'PROCESSING_IO_UNCERTAIN',
        attempts: 3,
      });
    },
  );
  await check(
    '375px Owner policy UI persists a change against actual native API',
    async () => {
      const server = createServer(async (req, res) => {
        try {
          const parts = [];
          for await (const part of req) parts.push(part);
          const method = req.method ?? 'GET';
          const response = await request(req.url ?? '/', {
            method,
            headers: req.headers,
            ...(method === 'GET' || method === 'HEAD'
              ? {}
              : { body: Buffer.concat(parts) }),
          });
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.writeHead(503);
          res.end('test bridge unavailable');
        }
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(8798, '127.0.0.1', resolve);
      });
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 375, height: 900 },
        });
        await context.addCookies([
          {
            name: 'kino-owner.session_token',
            value: cookie.split('=').slice(1).join('='),
            url: base,
          },
        ]);
        const page = await context.newPage();
        await page.goto(
          base + '/dashboard/workspaces/' + fixture.workspaceId + '/settings',
        );
        const panel = page.getByRole('region', {
          name: '新照片處理配方',
          exact: true,
        });
        await expect(
          panel.locator('input[value="cloudflare-images-jpeg-82-v1"]'),
        ).toBeChecked();
        await expect(panel.locator('[role="status"]')).toBeVisible();
        await panel.locator('input[value="local-sharp-0.35.5-v1"]').check();
        await panel.locator('button[type="submit"]').click();
        await expect(panel.getByText(/\u4fee\u8a02 4/)).toBeVisible();
        await page.reload();
        await expect(
          panel.locator('input[value="local-sharp-0.35.5-v1"]'),
        ).toBeChecked();
        await page.screenshot({
          path: '.local/processing-policy-mobile.png',
          fullPage: true,
        });
        await context.close();
      } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
      }
    },
  );
  await writeFile(
    '.local/processing-recipes-native-proof.json',
    JSON.stringify(
      {
        status: 'passed_isolated_native_d1',
        checks,
        migrationSha256: hash(migration),
        namespaceMigrationSha256: hash(namespaceMigration),
        preservedTables: tables.length,
        fixtureAdmission:
          'schema54 repository primary-only; runtime HTTP after full migration chain',
        provider: 'mock Sharp-backed binding; not hosted Images acceptance',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({
      status: 'passed_isolated_native_d1',
      checks: checks.length,
    }),
  );
} finally {
  await mf.dispose();
}
