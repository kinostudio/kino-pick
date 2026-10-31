import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { chromium, expect } from '@playwright/test';
import { jpegFixture, pngFixture } from '../tests/image-fixtures.mjs';
import { applyMigration } from '../tests/apply-migration.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerRoot = resolve(testDirectory, '..');
const projectRoot = resolve(workerRoot, '../..');
const webRoot = join(projectRoot, 'apps', 'web');
const migrationDirectory = join(workerRoot, 'migrations');
const proposalPath = join(
  workerRoot,
  'migration-proposals',
  'annotation_freehand_geometry_v1.sql',
);
const migrationPath = join(
  migrationDirectory,
  '0058_annotation_freehand_geometry_v1.sql',
);
const scriptPath = join(workerRoot, '.build', 'index.js');
const temporaryRoot = resolve(tmpdir());
const temporary = await mkdtemp(
  join(temporaryRoot, 'kino-freehand-browser-e2e-'),
);
const authSecret = 'synthetic-freehand-e2e-secret-at-least-forty-characters';
const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  ownerSession: '12121212-1212-4121-8121-121212121212',
  workspace: '22222222-2222-4222-8222-222222222222',
  project: '33333333-3333-4333-8333-333333333333',
  album: '44444444-4444-4444-8444-444444444444',
  inviteA: '55555555-5555-4555-8555-555555555555',
  inviteB: '66666666-6666-4666-8666-666666666666',
  photo: '77777777-7777-4777-8777-777777777777',
  version: '88888888-8888-4888-8888-888888888888',
  uploadSession: '99999999-9999-4999-8999-999999999999',
  originalAsset: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  guestA: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  guestSessionA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  guestB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  guestSessionB: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};
const ownerToken = 'freehand-e2e-owner-session-token';
const guestSecretA = randomBytes(32).toString('hex');
const guestSecretB = randomBytes(32).toString('hex');
const bindings = {
  APP_ENV: 'local',
  APP_URL: '',
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  GUEST_EXCHANGE_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'true',
  DIRECT_UPLOAD_ENABLED: 'false',
  GUEST_INVITE_ISSUANCE_ENABLED: 'false',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-key-never-for-production',
  R2_BUCKET_NAME: 'kino-pic-freehand-e2e-private',
  BETTER_AUTH_SECRET: authSecret,
};
let mf;
let vite;
let browser;

function validateTemporaryPath() {
  const resolved = resolve(temporary);
  assert.equal(dirname(resolved), temporaryRoot);
  assert.match(basename(resolved), /^kino-freehand-browser-e2e-[A-Za-z0-9]+$/u);
  return resolved;
}

function migrationStatements(source) {
  const lines = source.split(/\r?\n/u);
  const statements = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    if (/^DROP TRIGGER\b/i.test(trimmed)) {
      assert.match(trimmed, /;$/u);
      statements.push(trimmed);
      continue;
    }
    if (/^CREATE TRIGGER\b/i.test(trimmed)) {
      const body = [line];
      let ended = false;
      for (index++; index < lines.length; index++) {
        body.push(lines[index]);
        if (/^END;\s*$/i.test(lines[index].trim())) {
          ended = true;
          break;
        }
      }
      assert.ok(ended, 'migration trigger must end with a standalone END;');
      statements.push(body.join('\n'));
      continue;
    }
    assert.fail('unexpected SQL in the numbered migration: ' + trimmed);
  }
  return statements;
}

async function applyMigrations(database) {
  const names = (await readdir(migrationDirectory))
    .filter(
      (name) => /^\d{4}_.+\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 58,
    )
    .sort();
  assert.equal(names.length, 58);
  assert.equal(names.at(-1), '0058_annotation_freehand_geometry_v1.sql');
  assert.deepEqual(
    names.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: 58 }, (_, index) => index + 1),
  );
  for (const name of names.slice(0, -1)) {
    const source = await readFile(join(migrationDirectory, name), 'utf8');
    await applyMigration(database, source);
  }
  const proposal = await readFile(proposalPath, 'utf8');
  assert.match(proposal, /REVIEW-ONLY PROPOSAL\. DO NOT APPLY/u);
  const proposalStatements = migrationStatements(proposal);
  const migration = await readFile(migrationPath, 'utf8');
  assert.match(migration, /Forward-only migration 0058/u);
  const statements = migrationStatements(migration);
  assert.equal(statements.length, 4);
  assert.deepEqual(statements, proposalStatements);
  await applyMigration(database, migration);
  const foreignKeys = await database.prepare('PRAGMA foreign_key_check').all();
  assert.equal(foreignKeys.results.length, 0);
}

async function run(database, sql, ...values) {
  return database
    .prepare(sql)
    .bind(...values)
    .run();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashGuestSecret(secret) {
  return sha256(Buffer.from('kino-pic:guest-session:v1:' + secret, 'utf8'));
}

async function createInviteAndGuest(
  database,
  inviteId,
  guestId,
  sessionId,
  secret,
  displayName,
) {
  const now = Date.now();
  await run(
    database,
    "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id,created_at_ms) VALUES(?,?,?,?,'link_only',NULL,129,?,NULL,?,?,?)",
    inviteId,
    ids.workspace,
    ids.project,
    sha256(Buffer.from('invite-token:' + inviteId)),
    now + 30 * 86_400_000,
    ids.owner,
    ids.ownerSession,
    now,
  );
  await run(
    database,
    'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    inviteId,
    ids.workspace,
    ids.project,
    ids.album,
  );
  await run(
    database,
    'INSERT INTO guest_invite_seals(invite_id,sealed_at_ms) VALUES(?,?)',
    inviteId,
    now,
  );
  await run(
    database,
    'INSERT INTO guest_identities(id,invite_id,display_name,created_at_ms) VALUES(?,?,?,?)',
    guestId,
    inviteId,
    displayName,
    now,
  );
  await run(
    database,
    'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms,created_at_ms) VALUES(?,?,?,?,?,?)',
    sessionId,
    inviteId,
    guestId,
    hashGuestSecret(secret),
    now + 3_600_000,
    now,
  );
}

async function seedD1(database, storage) {
  const now = Date.now();
  const source = pngFixture();
  const derivative = jpegFixture();
  const sourceHash = sha256(source);
  const derivativeHash = sha256(derivative);

  await run(
    database,
    'INSERT INTO users(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)',
    ids.owner,
    'Fixture Owner',
    'owner@example.invalid',
    1,
    null,
    now,
    now,
  );
  await run(
    database,
    'INSERT INTO owners(id,user_id,enabled) VALUES(1,?,1)',
    ids.owner,
  );
  await run(
    database,
    'INSERT INTO owner_sessions(id,token,expiresAt,userId,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    ids.ownerSession,
    ownerToken,
    now + 3_600_000,
    ids.owner,
    now,
    now,
  );
  await run(
    database,
    'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
    ids.workspace,
    'Freehand E2E workspace',
    ids.owner,
  );
  await run(
    database,
    "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'uploading')",
    ids.project,
    ids.workspace,
    'Freehand E2E project',
  );
  await run(
    database,
    "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    ids.album,
    ids.workspace,
    ids.project,
    'Freehand E2E album',
  );
  await createInviteAndGuest(
    database,
    ids.inviteA,
    ids.guestA,
    ids.guestSessionA,
    guestSecretA,
    'Guest A',
  );
  await createInviteAndGuest(
    database,
    ids.inviteB,
    ids.guestB,
    ids.guestSessionB,
    guestSecretB,
    'Guest B',
  );

  const sourceObjectKey =
    ids.workspace +
    '/' +
    ids.project +
    '/' +
    ids.album +
    '/' +
    ids.uploadSession +
    '/original';
  const uploadPayloadJson = JSON.stringify({
    workspaceId: ids.workspace,
    projectId: ids.project,
    albumId: ids.album,
    originalFilename: 'freehand-e2e.png',
    expectedBytes: source.byteLength,
    contentType: 'image/png',
    sha256: sourceHash,
  });
  const workflowPayloadJson = JSON.stringify({
    uploadSessionId: ids.uploadSession,
  });
  await run(
    database,
    'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    randomUUID(),
    'upload.reserved',
    uploadPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    ids.workspace,
    ids.project,
    ids.album,
    'primary',
    sourceObjectKey,
    'freehand-e2e.png',
    source.byteLength,
    now,
  );
  await run(
    database,
    'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    randomUUID(),
    'upload.authorized',
    workflowPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    now,
    now,
    now + 600_000,
    'image/png',
    sourceHash,
  );
  await run(
    database,
    'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,content_type,sha256_hex,actual_bytes,photo_id,version_id,asset_id,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ids.owner,
    randomUUID(),
    'upload.completed',
    workflowPayloadJson,
    ids.ownerSession,
    ids.uploadSession,
    now + 1,
    'image/png',
    sourceHash,
    source.byteLength,
    ids.photo,
    ids.version,
    ids.originalAsset,
    1,
    1,
  );

  const startedAt = Date.now();
  await run(
    database,
    "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=1,attempts=1,lease_until_ms=?,updated_at_ms=?,transition_id=? WHERE id=?",
    randomUUID(),
    startedAt + 300_000,
    startedAt,
    randomUUID(),
    ids.originalAsset,
  );
  const resultJson = JSON.stringify([
    {
      kind: 'thumbnail',
      bytes: derivative.byteLength,
      mime: 'image/jpeg',
      sha256: derivativeHash,
      width: 2,
      height: 3,
    },
    {
      kind: 'preview',
      bytes: derivative.byteLength,
      mime: 'image/jpeg',
      sha256: derivativeHash,
      width: 2,
      height: 3,
    },
  ]);
  await run(
    database,
    "UPDATE image_processing_jobs SET status='succeeded',reserved_bytes=0,lease_token=NULL,lease_until_ms=NULL,reason_code=NULL,result_json=?,updated_at_ms=?,transition_id=? WHERE id=?",
    resultJson,
    Date.now(),
    randomUUID(),
    ids.originalAsset,
  );

  const derivatives = await database
    .prepare(
      "SELECT asset_kind,object_key,byte_size,checksum_sha256 FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
    )
    .bind(ids.version)
    .all();
  assert.equal(derivatives.results.length, 2);
  for (const item of derivatives.results) {
    assert.equal(item.byte_size, derivative.byteLength);
    assert.equal(item.checksum_sha256, derivativeHash);
    await storage.put(item.object_key, derivative, {
      sha256: Buffer.from(derivativeHash, 'hex'),
      httpMetadata: { contentType: 'image/jpeg' },
    });
  }
  const eligible = await database
    .prepare(
      'SELECT count(*) AS count FROM guest_annotation_eligible_versions WHERE version_id=?',
    )
    .bind(ids.version)
    .first();
  assert.equal(Number(eligible.count), 1);
  const head = await database
    .prepare(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
    )
    .bind(ids.photo)
    .first();
  assert.equal(head.version_id, ids.version);
  assert.equal(head.revision, 0);
}

async function getPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}

async function startVite(port) {
  const viteScript = join(webRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  assert.ok(existsSync(viteScript), 'the Vite package must be installed');
  vite = spawn(
    process.execPath,
    [
      viteScript,
      '--config',
      'vite.target.config.ts',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: webRoot,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  const base = 'http://127.0.0.1:' + port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (vite.exitCode !== null)
      throw new Error('Vite exited before ready with code ' + vite.exitCode);
    try {
      const response = await fetch(base + '/freehand-workerd-e2e.html');
      if (response.ok) return base;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('Vite did not serve the dedicated E2E fixture');
}

function parseJson(bytes, contentType) {
  if (!contentType?.includes('application/json')) return null;
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

async function installRealWorkerBridge(page, getWorker, observations) {
  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
  observations.browserRequests = [];
  observations.browserResponses = [];
  observations.routedRequests = [];
  observations.routeResults = [];
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.includes('/api/'))
      observations.browserResponses.push({
        pathname,
        status: response.status(),
      });
  });
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes('/api/') || pathname.endsWith('/assets/preview'))
      observations.browserRequests.push({
        pathname,
        resourceType: request.resourceType(),
      });
  });
  page.on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/assets/preview'))
      observations.bridgeErrors.push(
        'request failed ' +
          pathname +
          ': ' +
          (request.failure()?.errorText ?? ''),
      );
  });
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const routeTrace = {
      pathname: new URL(incoming.url()).pathname,
      resourceType: incoming.resourceType(),
      phases: ['start'],
    };
    observations.routedRequests.push(routeTrace);
    const routePathname = new URL(incoming.url()).pathname;
    const shouldBridge = routePathname.startsWith('/api/');
    observations.routedRequests[
      observations.routedRequests.length - 1
    ].shouldBridge = shouldBridge;
    if (!shouldBridge) {
      await route.continue();
      return;
    }
    routeTrace.phases.push('before-headers');
    const headers = await incoming.allHeaders();
    routeTrace.phases.push('after-headers');
    headers['cf-connecting-ip'] = '198.51.100.141';
    const method = incoming.method();
    const body =
      method === 'GET' || method === 'HEAD'
        ? undefined
        : (incoming.postDataBuffer() ?? undefined);
    let response;
    try {
      routeTrace.phases.push('before-worker-fetch');
      response = await getWorker().fetch(
        new Request(incoming.url(), {
          method,
          headers,
          body,
          redirect: 'manual',
        }),
      );
      routeTrace.phases.push('after-worker-fetch');
    } catch (error) {
      observations.bridgeErrors.push(
        error instanceof Error ? error.message : String(error),
      );
      await route.abort('failed');
      return;
    }
    routeTrace.phases.push('got-worker-response');
    observations.routeResults.push({
      pathname: new URL(incoming.url()).pathname,
      status: response.status,
      contentType: response.headers.get('content-type'),
    });
    let bytes;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      observations.bridgeErrors.push(
        'read response body ' +
          new URL(incoming.url()).pathname +
          ': ' +
          (error instanceof Error ? error.message : String(error)),
      );
      await route.abort('failed');
      return;
    }
    const url = new URL(incoming.url());
    routeTrace.phases.push('read-worker-body');
    const record = {
      method,
      pathname: url.pathname,
      search: url.search,
      requestHeaders: headers,
      requestBody:
        method === 'GET' || method === 'HEAD'
          ? null
          : parseJson(
              incoming.postDataBuffer() ?? Buffer.alloc(0),
              headers['content-type'],
            ),
      status: response.status,
      responseBody: parseJson(bytes, response.headers.get('content-type')),
    };
    observations.requests.push(record);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    delete responseHeaders['content-length'];
    delete responseHeaders['transfer-encoding'];
    routeTrace.phases.push('before-fulfill');
    await route.fulfill({
      status: response.status,
      headers: responseHeaders,
      body: bytes,
    });
    routeTrace.phases.push('fulfilled');
  });
}

function pageUrl(base, role, inviteId) {
  const params = new URLSearchParams({
    role,
    albumId: ids.album,
    inviteId,
    photoId: ids.photo,
    versionId: ids.version,
    filename: 'freehand-e2e.jpg',
  });
  return base + '/freehand-workerd-e2e.html?' + params.toString();
}

async function makeContext(browserInstance, base, name, value, viewport) {
  const context = await browserInstance.newContext({ viewport });
  await context.addCookies([
    {
      name,
      value,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    },
  ]);
  return context;
}

function freehandRequestRecord(observations, method, pathSuffix) {
  return observations.requests.find(
    (record) =>
      record.method === method &&
      record.pathname.endsWith(pathSuffix) &&
      record.responseBody?.item?.geometry?.type === 'freehand',
  );
}

async function drawStroke(page, role) {
  const brush = page.getByTestId(
    role === 'owner'
      ? 'owner-annotation-tool-freehand'
      : 'annotation-tool-freehand',
  );
  await brush.click();
  await expect(brush).toHaveAttribute('aria-pressed', 'true');
  const image = page.getByTestId('annotation-preview-image');
  await expect(image).toBeVisible();
  await expect(page.getByTestId('annotation-zoom')).toBeEnabled();
  const box = await image.boundingBox();
  assert.ok(box?.width && box.height);
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.34);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.41, {
    steps: 4,
  });
  await page.mouse.move(box.x + box.width * 0.77, box.y + box.height * 0.55, {
    steps: 4,
  });
  await page.mouse.up();
  const save = page.getByTestId(
    role === 'owner' ? 'owner-annotation-save' : 'annotation-save',
  );
  await expect(save).toBeEnabled();
  await save.click();
}

async function annotationCounts(database) {
  return database
    .prepare(
      "SELECT (SELECT count(*) FROM guest_annotation_commands) AS guest_commands,(SELECT count(*) FROM guest_annotations) AS guest_annotations,(SELECT count(*) FROM guest_annotation_changes) AS guest_changes,(SELECT count(*) FROM guest_annotation_results) AS guest_results,(SELECT count(*) FROM owner_annotation_commands) AS owner_commands,(SELECT count(*) FROM owner_annotations) AS owner_annotations,(SELECT count(*) FROM owner_annotation_changes) AS owner_changes,(SELECT count(*) FROM owner_annotation_results) AS owner_results,(SELECT count(*) FROM audit_events WHERE action IN('annotation.created','owner.annotation_created')) AS annotation_audits",
    )
    .first();
}

async function readAudit(database, eventId) {
  return database
    .prepare(
      'SELECT actor_type,actor_id,session_id,guest_session_id,action,request_id FROM audit_events WHERE event_id=?',
    )
    .bind(eventId)
    .first();
}

async function assertApiBlockedThroughBrowser(
  page,
  path,
  command,
  expectedActor,
) {
  const result = await page.evaluate(
    async ({ requestPath, payload, actor }) => {
      const headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (actor) headers['X-Kino-Expected-Actor'] = actor;
      const response = await fetch(requestPath, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      return { status: response.status, body: await response.json() };
    },
    { requestPath: path, payload: command, actor: expectedActor },
  );
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(
    result.body?.error?.code,
    'FREEHAND_ANNOTATIONS_DISABLED',
    'the real Worker write gate must reject freehand when switched off',
  );
}

try {
  validateTemporaryPath();
  assert.ok(
    existsSync(scriptPath),
    'Build the current Worker into apps/worker/.build/index.js before running.',
  );
  const port = await getPort();
  const base = await startVite(port);
  const workerBindings = { ...bindings, APP_URL: base };
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'freehand-enabled',
          modules: true,
          scriptPath,
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          bindings: workerBindings,
          d1Databases: { DB: 'freehand-browser-e2e' },
          r2Buckets: { PRIMARY_STORAGE: 'freehand-browser-e2e' },
        },
        {
          name: 'freehand-disabled',
          modules: true,
          scriptPath,
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            ...workerBindings,
            FREEHAND_ANNOTATIONS_ENABLED: 'false',
          },
          d1Databases: { DB: 'freehand-browser-e2e' },
          r2Buckets: { PRIMARY_STORAGE: 'freehand-browser-e2e' },
        },
      ],
      d1Persist: join(temporary, 'd1'),
      r2Persist: join(temporary, 'r2'),
    }),
  );
  const database = await mf.getD1Database('DB', 'freehand-enabled');
  const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'freehand-enabled');
  const ownerCookie = encodeURIComponent(
    ownerToken + '.' + (await makeSignature(ownerToken, authSecret)),
  );
  await applyMigrations(database);
  await seedD1(database, storage);
  const previewRow = await database
    .prepare(
      "SELECT object_key,byte_size,checksum_sha256 FROM photo_assets WHERE version_id=? AND asset_kind='preview'",
    )
    .bind(ids.version)
    .first();
  const previewObject = await storage.get(previewRow.object_key);
  const previewBytes = previewObject
    ? Buffer.from(await previewObject.arrayBuffer())
    : Buffer.alloc(0);
  console.log(
    'DIRECT_R2_DIAG ' +
      JSON.stringify({
        row: previewRow,
        objectFound: Boolean(previewObject),
        size: previewObject?.size,
        contentType: previewObject?.httpMetadata?.contentType,
        bodyBytes: previewBytes.length,
        bodySha256: sha256(previewBytes),
      }),
  );

  const enabledWorker = await mf.getWorker('freehand-enabled');
  const disabledWorker = await mf.getWorker('freehand-disabled');
  const mode = { enabled: true };
  const selectWorker = () => (mode.enabled ? enabledWorker : disabledWorker);
  const ownerObservations = { requests: [], pageErrors: [], bridgeErrors: [] };
  const guestObservations = { requests: [], pageErrors: [], bridgeErrors: [] };
  const peerGuestObservations = {
    requests: [],
    pageErrors: [],
    bridgeErrors: [],
  };
  const peerOwnerObservations = {
    requests: [],
    pageErrors: [],
    bridgeErrors: [],
  };

  browser = await chromium.launch({ headless: true });
  const ownerContext = await makeContext(
    browser,
    base,
    'kino-owner.session_token',
    ownerCookie,
    { width: 1100, height: 900 },
  );
  const ownerPage = await ownerContext.newPage();
  await installRealWorkerBridge(ownerPage, selectWorker, ownerObservations);
  await ownerPage.goto(pageUrl(base, 'owner', ids.inviteA), {
    waitUntil: 'domcontentloaded',
  });
  const ownerBrush = ownerPage.getByTestId('owner-annotation-tool-freehand');
  await expect(ownerBrush).toBeVisible();
  console.log(
    'OWNER_REQ_DIAG ' +
      JSON.stringify({
        api: ownerObservations.requests.map((record) => ({
          method: record.method,
          path: record.pathname,
          status: record.status,
          body: record.responseBody,
        })),
        browser: ownerObservations.browserRequests,
        routed: ownerObservations.routedRequests.filter((record) =>
          record.pathname.includes('/api/'),
        ),
        routeResults: ownerObservations.routeResults,
        responses: ownerObservations.browserResponses,
        bridgeErrors: ownerObservations.bridgeErrors,
      }),
  );
  await drawStroke(ownerPage, 'owner');
  await expect
    .poll(() =>
      Boolean(
        freehandRequestRecord(
          ownerObservations,
          'POST',
          '/annotations/owner/commands',
        ),
      ),
    )
    .toBe(true);
  const ownerWrite = freehandRequestRecord(
    ownerObservations,
    'POST',
    '/annotations/owner/commands',
  );
  assert.equal(ownerWrite.status, 200, JSON.stringify(ownerWrite.responseBody));
  assert.equal(ownerWrite.requestBody.expectedOwnerId, ids.owner);
  assert.equal(ownerWrite.requestBody.inviteId, ids.inviteA);
  assert.ok(ownerWrite.requestBody.geometry.points.length >= 2);
  const ownerAnnotationId = ownerWrite.responseBody.item.annotationId;
  await expect(
    ownerPage.getByTestId('owner-annotation-item-' + ownerAnnotationId),
  ).toBeVisible();
  const ownerDbRow = await database
    .prepare(
      'SELECT invite_id,geometry_json,created_session_id,last_request_id,revision FROM owner_annotations WHERE id=?',
    )
    .bind(ownerAnnotationId)
    .first();
  assert.equal(ownerDbRow.invite_id, ids.inviteA);
  assert.deepEqual(
    JSON.parse(ownerDbRow.geometry_json),
    ownerWrite.requestBody.geometry,
  );
  assert.equal(ownerDbRow.created_session_id, ids.ownerSession);
  assert.equal(ownerDbRow.last_request_id, ownerWrite.requestBody.requestId);
  assert.equal(ownerDbRow.revision, 1);
  const ownerAudit = await readAudit(
    database,
    'owner-annotation:' + ownerAnnotationId + ':1',
  );
  assert.deepEqual(
    { ...ownerAudit },
    {
      actor_type: 'user',
      actor_id: ids.owner,
      session_id: ids.ownerSession,
      guest_session_id: null,
      action: 'owner.annotation_created',
      request_id: ownerWrite.requestBody.requestId,
    },
  );

  const guestContext = await makeContext(
    browser,
    base,
    'kino_guest',
    guestSecretA,
    { width: 390, height: 844 },
  );
  const guestPage = await guestContext.newPage();
  await installRealWorkerBridge(guestPage, selectWorker, guestObservations);
  await guestPage.goto(pageUrl(base, 'guest', ids.inviteA), {
    waitUntil: 'domcontentloaded',
  });
  const guestBrush = guestPage.getByTestId('annotation-tool-freehand');
  await expect(guestBrush).toBeVisible();
  await drawStroke(guestPage, 'guest');
  await expect
    .poll(() =>
      Boolean(
        freehandRequestRecord(
          guestObservations,
          'POST',
          '/annotations/commands',
        ),
      ),
    )
    .toBe(true);
  const guestWrite = freehandRequestRecord(
    guestObservations,
    'POST',
    '/annotations/commands',
  );
  assert.equal(guestWrite.status, 200, JSON.stringify(guestWrite.responseBody));
  assert.equal(guestWrite.requestBody.expectedGuestId, ids.guestA);
  assert.equal(guestWrite.requestBody.photoId, ids.photo);
  assert.equal(guestWrite.requestBody.versionId, ids.version);
  assert.ok(guestWrite.requestBody.geometry.points.length >= 2);
  const guestAnnotationId = guestWrite.responseBody.item.annotationId;
  await expect(
    guestPage.getByTestId('annotation-item-' + guestAnnotationId),
  ).toBeVisible();
  const guestDbRow = await database
    .prepare(
      'SELECT invite_id,author_guest_id,geometry_json,last_session_id,last_request_id,revision FROM guest_annotations WHERE id=?',
    )
    .bind(guestAnnotationId)
    .first();
  assert.equal(guestDbRow.invite_id, ids.inviteA);
  assert.equal(guestDbRow.author_guest_id, ids.guestA);
  assert.deepEqual(
    JSON.parse(guestDbRow.geometry_json),
    guestWrite.requestBody.geometry,
  );
  assert.equal(guestDbRow.last_session_id, ids.guestSessionA);
  assert.equal(guestDbRow.last_request_id, guestWrite.requestBody.requestId);
  assert.equal(guestDbRow.revision, 1);
  const guestAudit = await readAudit(
    database,
    'guest-annotation:' + guestAnnotationId + ':1',
  );
  assert.deepEqual(
    { ...guestAudit },
    {
      actor_type: 'guest',
      actor_id: ids.guestA,
      session_id: null,
      guest_session_id: ids.guestSessionA,
      action: 'annotation.created',
      request_id: guestWrite.requestBody.requestId,
    },
  );

  const peerGuestContext = await makeContext(
    browser,
    base,
    'kino_guest',
    guestSecretB,
    { width: 390, height: 844 },
  );
  const peerGuestPage = await peerGuestContext.newPage();
  await installRealWorkerBridge(
    peerGuestPage,
    selectWorker,
    peerGuestObservations,
  );
  await peerGuestPage.goto(pageUrl(base, 'guest', ids.inviteB), {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    peerGuestPage.getByTestId('guest-annotations-panel'),
  ).toBeVisible();
  await expect(
    peerGuestPage.getByTestId('annotation-item-' + guestAnnotationId),
  ).toHaveCount(0);

  const peerOwnerContext = await makeContext(
    browser,
    base,
    'kino-owner.session_token',
    ownerCookie,
    { width: 1100, height: 900 },
  );
  const peerOwnerPage = await peerOwnerContext.newPage();
  await installRealWorkerBridge(
    peerOwnerPage,
    selectWorker,
    peerOwnerObservations,
  );
  await peerOwnerPage.goto(pageUrl(base, 'owner', ids.inviteB), {
    waitUntil: 'domcontentloaded',
  });
  await expect(
    peerOwnerPage.getByTestId('owner-annotation-editor'),
  ).toBeVisible();
  await expect(
    peerOwnerPage.getByTestId('owner-annotation-item-' + ownerAnnotationId),
  ).toHaveCount(0);

  const beforeDisabledWrites = await annotationCounts(database);
  mode.enabled = false;
  for (const page of [ownerPage, guestPage]) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
  }
  await expect(ownerBrush).toHaveCount(0);
  await expect(guestBrush).toHaveCount(0);
  await expect(
    ownerPage.getByTestId('owner-annotation-item-' + ownerAnnotationId),
  ).toBeVisible();
  await expect(
    guestPage.getByTestId('annotation-item-' + guestAnnotationId),
  ).toBeVisible();

  const ownerCapability = ownerObservations.requests
    .filter(
      (record) =>
        record.method === 'GET' &&
        record.pathname ===
          '/api/v1/annotations/authoring/freehand-capabilities',
    )
    .at(-1);
  const guestCapability = guestObservations.requests
    .filter(
      (record) =>
        record.method === 'GET' &&
        record.pathname === '/api/guest/annotations/freehand-capabilities',
    )
    .at(-1);
  assert.equal(ownerCapability?.responseBody?.enabled, false);
  assert.equal(guestCapability?.responseBody?.enabled, false);
  const ownerReadAfterSwitch = ownerObservations.requests
    .filter(
      (record) =>
        record.method === 'GET' &&
        record.pathname.endsWith('/annotations/owner') &&
        record.status === 200,
    )
    .at(-1);
  const guestReadAfterSwitch = guestObservations.requests
    .filter(
      (record) =>
        record.method === 'GET' &&
        (record.pathname.endsWith('/annotations/own') ||
          record.pathname.endsWith('/annotations/shared')) &&
        record.status === 200,
    )
    .at(-1);
  assert.ok(
    ownerReadAfterSwitch?.responseBody?.items.some(
      (item) => item.annotationId === ownerAnnotationId,
    ),
  );
  assert.ok(
    guestReadAfterSwitch?.responseBody?.items.some(
      (item) => item.annotationId === guestAnnotationId,
    ),
  );

  const disabledGuestCommand = {
    ...guestWrite.requestBody,
    requestId: randomUUID(),
  };
  const disabledOwnerCommand = {
    ...ownerWrite.requestBody,
    requestId: randomUUID(),
  };
  await assertApiBlockedThroughBrowser(
    guestPage,
    '/api/guest/albums/' + ids.album + '/annotations/commands',
    disabledGuestCommand,
    null,
  );
  await assertApiBlockedThroughBrowser(
    ownerPage,
    '/api/v1/albums/' + ids.album + '/annotations/owner/commands',
    disabledOwnerCommand,
    ids.owner,
  );
  assert.deepEqual(await annotationCounts(database), beforeDisabledWrites);

  await ownerPage.reload({ waitUntil: 'domcontentloaded' });
  await guestPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(
    ownerPage.getByTestId('owner-annotation-item-' + ownerAnnotationId),
  ).toBeVisible();
  await expect(
    guestPage.getByTestId('annotation-item-' + guestAnnotationId),
  ).toBeVisible();
  await expect(
    ownerPage.getByTestId('owner-annotation-tool-freehand'),
  ).toHaveCount(0);
  await expect(guestPage.getByTestId('annotation-tool-freehand')).toHaveCount(
    0,
  );

  const ownerReadHeaders = ownerObservations.requests
    .filter(
      (record) =>
        record.method === 'GET' &&
        record.pathname.endsWith('/annotations/owner'),
    )
    .map(
      (record) =>
        record.requestHeaders['x-kino-annotation-read-capabilities'] ?? '',
    );
  const guestReadHeaders = guestObservations.requests
    .filter(
      (record) =>
        record.method === 'GET' &&
        (record.pathname.endsWith('/annotations/own') ||
          record.pathname.endsWith('/annotations/shared')),
    )
    .map(
      (record) =>
        record.requestHeaders['x-kino-annotation-read-capabilities'] ?? '',
    );
  assert.ok(ownerReadHeaders.length > 0);
  assert.ok(guestReadHeaders.length > 0);
  assert.ok(ownerReadHeaders.every((header) => header === 'freehand-v1'));
  assert.ok(guestReadHeaders.every((header) => header === 'freehand-v1'));

  for (const observations of [
    ownerObservations,
    guestObservations,
    peerGuestObservations,
    peerOwnerObservations,
  ]) {
    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
  }
  const foreignInviteRows = await database
    .prepare(
      'SELECT (SELECT count(*) FROM guest_annotations WHERE invite_id=?) AS guest,(SELECT count(*) FROM owner_annotations WHERE invite_id=?) AS owner',
    )
    .bind(ids.inviteB, ids.inviteB)
    .first();
  assert.equal(Number(foreignInviteRows.guest), 0);
  assert.equal(Number(foreignInviteRows.owner), 0);
  const finalCounts = await annotationCounts(database);
  assert.equal(Number(finalCounts.guest_annotations), 1);
  assert.equal(Number(finalCounts.owner_annotations), 1);
  assert.equal(Number(finalCounts.annotation_audits), 2);
  const foreignKeys = await database.prepare('PRAGMA foreign_key_check').all();
  assert.equal(foreignKeys.results.length, 0);

  process.stdout.write(
    JSON.stringify(
      {
        result: 'pass',
        runtime:
          'Chromium browser to real Miniflare workerd Worker to isolated D1 and R2',
        migrationBaseline: '0001-0058 numbered migrations',
        uiWritesReadBack: { guest: true, owner: true },
        inviteIsolation: { guest: true, owner: true },
        writeDisabledReadContinues: true,
        auditWitnesses: 2,
        foreignKeyViolations: 0,
        persistentOrRemoteDatabaseUsed: false,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  if (browser) await browser.close().catch(() => undefined);
  if (vite && vite.exitCode === null) {
    vite.kill();
    await new Promise((resolveClose) => {
      const timeout = setTimeout(resolveClose, 3000);
      vite.once('exit', () => {
        clearTimeout(timeout);
        resolveClose();
      });
    });
  }
  if (mf) await mf.dispose().catch(() => undefined);
  await rm(validateTemporaryPath(), { recursive: true, force: true });
}
