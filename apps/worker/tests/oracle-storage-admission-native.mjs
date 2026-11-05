import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { D1ContentRepository } from '../src/content.ts';
import { D1UploadRepository } from '../src/uploads.ts';
import { D1WorkspaceRepository } from '../src/workspaces.ts';
import {
  readOraclePolicy,
  saveOraclePolicy,
} from '../src/oracle-storage-policy.ts';
import {
  refreshStorageHealth,
  selectStorageNodeForUpload,
} from '../src/storage-admission.ts';
import { storageBucketForNode } from '../src/private-storage.ts';
import { R2StorageAdapter } from '../src/r2-storage.ts';
import { applyMigration } from './apply-migration.mjs';

const endpoint = 'https://drive.kinostudio.tw';
const bucketName = 'kino-pick-overflow';
const region = 'us-east-1';
const healthKey = '_kino/system/storage-health.json';
const GB = 1_000_000_000;
const R2_QUOTA = 9 * GB;
const ORACLE_QUOTA = 30 * GB;
const DERIVATIVE_BUDGET = 16_777_216;
const MAX_UPLOAD = 5_363_466_240;
const R2_FULL_FIRST = R2_QUOTA - 2 * DERIVATIVE_BUDGET - MAX_UPLOAD;
const ORACLE_WORKSPACE_FIRST = (ORACLE_QUOTA - 8 * DERIVATIVE_BUDGET) / 4;
const ORACLE_WORKSPACE_SECOND = ORACLE_WORKSPACE_FIRST - MAX_UPLOAD;

function mockS3() {
  const objects = new Map();
  let version = 0;
  let signedRequests = 0;
  let photoObjectWrites = 0;

  function responseHeaders(key, entry) {
    return {
      'Content-Length': String(entry.bytes.byteLength),
      'Content-Type': entry.contentType,
      ETag: entry.etag,
      'Last-Modified': entry.updatedAt.toUTCString(),
      'x-amz-checksum-sha256': createHash('sha256')
        .update(entry.bytes)
        .digest('base64'),
      'x-amz-meta-kino-key': key,
    };
  }

  async function fetch(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== endpoint) throw new Error('UNEXPECTED_S3_ORIGIN');
    if (!request.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256 '))
      throw new Error('UNSIGNED_S3_REQUEST');
    signedRequests++;
    const path = url.pathname.split('/').filter(Boolean);
    if (path.shift() !== bucketName) throw new Error('UNEXPECTED_S3_BUCKET');
    const key = path.map(decodeURIComponent).join('/');
    const existing = objects.get(key);

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (!existing) return new Response(null, { status: 404 });
      return new Response(request.method === 'HEAD' ? null : existing.bytes, {
        status: 200,
        headers: responseHeaders(key, existing),
      });
    }

    if (request.method !== 'PUT') return new Response(null, { status: 405 });
    if (!key.startsWith('_kino/system/')) {
      photoObjectWrites++;
      throw new Error('UNEXPECTED_PHOTO_OBJECT_WRITE');
    }
    if (
      (request.headers.get('if-none-match') === '*' && existing) ||
      (request.headers.has('if-match') &&
        request.headers.get('if-match') !== existing?.etag &&
        request.headers.get('if-match') !== '*')
    )
      return new Response(null, { status: 412 });

    const bytes = new Uint8Array(await request.arrayBuffer());
    const entry = {
      bytes,
      contentType:
        request.headers.get('content-type') ?? 'application/octet-stream',
      etag: `"native-${++version}"`,
      updatedAt: new Date(),
    };
    objects.set(key, entry);
    return new Response(null, { status: 200 });
  }

  return {
    fetch,
    objects,
    signedRequestCount: () => signedRequests,
    photoObjectWriteCount: () => photoObjectWrites,
    setHealth(value) {
      objects.set(healthKey, {
        bytes: new TextEncoder().encode(JSON.stringify(value)),
        contentType: 'application/json',
        etag: `"native-health-${++version}"`,
        updatedAt: new Date(),
      });
    },
    deleteHealth() {
      objects.delete(healthKey);
    },
  };
}

/** Reusable isolated fixture. `mockOracle:false` lets a parent run it with supplied real credentials. */
export async function createOracleStorageAdmissionFixture({
  mockOracle = true,
  envOverrides = {},
} = {}) {
  const previousFetch = globalThis.fetch;
  const s3 = mockOracle ? mockS3() : null;
  if (s3) globalThis.fetch = s3.fetch;

  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'oracle-admission-native',
          modules: true,
          script:
            'export default {fetch(){return new Response(null,{status:404})}}',
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'oracle-admission-native' },
          r2Buckets: { PRIMARY_STORAGE: 'oracle-admission-native' },
        },
      ],
    }),
  );

  try {
    const db = await mf.getD1Database('DB', 'oracle-admission-native');
    const primaryBucket = await mf.getR2Bucket(
      'PRIMARY_STORAGE',
      'oracle-admission-native',
    );
    const migrations = (await readdir(resolve('apps/worker/migrations')))
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();
    for (const file of migrations.filter(
      (name) => Number(name.slice(0, 4)) <= 64,
    ))
      await applyMigration(
        db,
        await readFile(resolve('apps/worker/migrations', file), 'utf8'),
      );

    const owner = randomUUID();
    const session = randomUUID();
    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
      )
      .bind(owner, 'oracle-admission-' + randomUUID())
      .run();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        session,
        randomBytes(32).toString('hex'),
        owner,
        now + 3_600_000,
        now,
        now,
      )
      .run();

    const workspaceRepository = new D1WorkspaceRepository(db, owner, session);
    const contentRepository = new D1ContentRepository(db, owner, session);
    const createScope = async (label) => {
      const workspace = await workspaceRepository.create({
        name: `Oracle ${label} ${randomUUID().slice(0, 8)}`,
        requestId: randomUUID(),
      });
      const project = await contentRepository.createProject({
        workspaceId: workspace.id,
        name: `Project ${label}`,
        requestId: randomUUID(),
      });
      const album = await contentRepository.createAlbum(project.id, {
        name: `Album ${label}`,
        requestId: randomUUID(),
      });
      return { workspace, project, album };
    };

    const populatedScope = await createScope('migration');
    const beforeMigration = await db
      .prepare(
        'SELECT w.id,w.name,w.quota_bytes,p.id AS project_id,a.id AS album_id FROM workspaces w JOIN projects p ON p.workspace_id=w.id JOIN albums a ON a.project_id=p.id WHERE w.id=?',
      )
      .bind(populatedScope.workspace.id)
      .first();
    const admissionMigration = migrations.find(
      (name) => Number(name.slice(0, 4)) === 65,
    );
    assert.equal(admissionMigration, '0065_oracle_storage_admission.sql');
    await applyMigration(
      db,
      await readFile(
        resolve('apps/worker/migrations', admissionMigration),
        'utf8',
      ),
    );
    const afterMigration = await db
      .prepare(
        'SELECT w.id,w.name,w.quota_bytes,p.id AS project_id,a.id AS album_id FROM workspaces w JOIN projects p ON p.workspace_id=w.id JOIN albums a ON a.project_id=p.id WHERE w.id=?',
      )
      .bind(populatedScope.workspace.id)
      .first();
    assert.deepEqual(afterMigration, beforeMigration);

    await db
      .prepare(
        `INSERT INTO storage_nodes(id,provider,account_id,bucket_name,endpoint,credential_ref,status,priority,quota_bytes,used_bytes,reserved_bytes)
         VALUES('oracle-vm','s3','native-fixture',? ,?,'env:ORACLE_STORAGE','active',2,?,0,0)`,
      )
      .bind(bucketName, endpoint, ORACLE_QUOTA)
      .run();

    const env = {
      APP_ENV: 'local',
      APP_URL: 'http://localhost:4197',
      REGISTRATION_MODE: 'closed',
      STORAGE_AUTODELETE_ENABLED: 'false',
      STORAGE_RETENTION_DRY_RUN: 'true',
      MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
      ORACLE_STORAGE_ENABLED: 'true',
      ORACLE_STORAGE_ENDPOINT: endpoint,
      ORACLE_STORAGE_REGION: region,
      ORACLE_STORAGE_BUCKET: bucketName,
      ORACLE_STORAGE_ACCESS_KEY_ID: 'native-test-access-key',
      ORACLE_STORAGE_SECRET_ACCESS_KEY: 'native-test-secret-never-real',
      ...envOverrides,
      DB: db,
      PRIMARY_STORAGE: primaryBucket,
      ORACLE_STORAGE_ADMIN_USER_ID: owner,
    };
    const repository = new D1UploadRepository(
      db,
      owner,
      session,
      new R2StorageAdapter(primaryBucket),
      {
        storageForNode: (nodeId) =>
          new R2StorageAdapter(storageBucketForNode(env, nodeId), nodeId),
        chooseStorageNode: (bytes) => selectStorageNodeForUpload(env, bytes),
      },
    );

    return {
      db,
      env,
      owner,
      session,
      repository,
      populatedScope,
      createScope,
      s3,
      mockOracle,
      async reserve(scope, expectedBytes, requestId = randomUUID()) {
        return repository.reserve({
          workspaceId: scope.workspace.id,
          projectId: scope.project.id,
          albumId: scope.album.id,
          originalFilename: `native-${requestId}.jpg`,
          expectedBytes,
          contentType: 'image/jpeg',
          sha256: 'a'.repeat(64),
          requestId,
        });
      },
      async cancel(sessionId) {
        return repository.cancel(sessionId, { requestId: randomUUID() });
      },
      async node(id) {
        return db
          .prepare(
            'SELECT id,quota_bytes,used_bytes,reserved_bytes FROM storage_nodes WHERE id=?',
          )
          .bind(id)
          .first();
      },
      async nodeCommitment(id) {
        const node = await db
          .prepare(
            'SELECT quota_bytes,used_bytes,reserved_bytes FROM storage_nodes WHERE id=?',
          )
          .bind(id)
          .first();
        const pending = await db
          .prepare(
            'SELECT COALESCE(SUM(pending_bytes),0) AS bytes FROM storage_pending_derivative_capacity WHERE storage_node_id=?',
          )
          .bind(id)
          .first();
        return {
          quotaBytes: node.quota_bytes,
          usedBytes: node.used_bytes,
          reservedBytes: node.reserved_bytes,
          pendingBytes: pending.bytes,
          committedBytes: node.used_bytes + node.reserved_bytes + pending.bytes,
        };
      },
      async storageNodeFor(sessionId) {
        return db
          .prepare('SELECT storage_node_id FROM upload_sessions WHERE id=?')
          .bind(sessionId)
          .first();
      },
      dispose: async () => {
        if (s3) globalThis.fetch = previousFetch;
        await mf.dispose();
      },
    };
  } catch (error) {
    if (s3) globalThis.fetch = previousFetch;
    await mf.dispose();
    throw error;
  }
}

async function rejectedWith(promise, code) {
  await assert.rejects(
    promise,
    (error) => error?.code === code || error?.message?.includes(code),
  );
}

async function rawReservation(fixture, scope, storageNodeId) {
  const requestId = randomUUID();
  const uploadSessionId = randomUUID();
  const objectKey = `${scope.workspace.id}/${scope.project.id}/${scope.album.id}/${uploadSessionId}/original`;
  const payloadJson = JSON.stringify({
    workspaceId: scope.workspace.id,
    projectId: scope.project.id,
    albumId: scope.album.id,
    originalFilename: 'forged-reservation.jpg',
    expectedBytes: 1,
    contentType: 'image/jpeg',
    sha256: 'a'.repeat(64),
  });
  await fixture.db
    .prepare(
      'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      fixture.owner,
      requestId,
      'upload.reserved',
      payloadJson,
      fixture.session,
      uploadSessionId,
      scope.workspace.id,
      scope.project.id,
      scope.album.id,
      storageNodeId,
      objectKey,
      'forged-reservation.jpg',
      1,
      Date.now(),
    )
    .run();
  return requestId;
}

export async function runOracleStorageAdmissionNative() {
  const fixture = await createOracleStorageAdmissionFixture();
  const checks = [];
  const created = [];
  try {
    const primary = await fixture.nodeCommitment('primary');
    const oracle = await fixture.node('oracle-vm');
    assert.equal(primary.quotaBytes, R2_QUOTA);
    assert.equal(oracle.quota_bytes, ORACLE_QUOTA);
    assert.equal(
      (
        await fixture.db
          .prepare('SELECT quota_bytes FROM oracle_storage_policy WHERE id=1')
          .first()
      ).quota_bytes,
      ORACLE_QUOTA,
    );

    const normalScope = fixture.populatedScope;
    const normalRequestId = randomUUID();
    const normal = await fixture.reserve(normalScope, 1, normalRequestId);
    created.push(normal.id);
    assert.equal(
      (await fixture.storageNodeFor(normal.id)).storage_node_id,
      'primary',
    );
    const normalReplay = await fixture.reserve(normalScope, 1, normalRequestId);
    assert.equal(normalReplay.id, normal.id);
    await fixture.cancel(normal.id);
    assert.equal((await fixture.nodeCommitment('primary')).committedBytes, 0);
    checks.push(
      'new reservation prefers R2 and exact replay reuses its original session',
    );

    const raceFillScope = await fixture.createScope('R2 race fill');
    const raceFillA = await fixture.reserve(raceFillScope, MAX_UPLOAD);
    const raceFillB = await fixture.reserve(
      raceFillScope,
      R2_QUOTA - 3 * DERIVATIVE_BUDGET - 1 - MAX_UPLOAD,
    );
    created.push(raceFillA.id, raceFillB.id);
    assert.equal(
      (await fixture.storageNodeFor(raceFillA.id)).storage_node_id,
      'primary',
    );
    assert.equal(
      (await fixture.storageNodeFor(raceFillB.id)).storage_node_id,
      'primary',
    );
    assert.equal(
      (await fixture.nodeCommitment('primary')).committedBytes,
      R2_QUOTA - DERIVATIVE_BUDGET - 1,
    );

    const raceScopes = await Promise.all([
      fixture.createScope('R2 race A'),
      fixture.createScope('R2 race B'),
    ]);
    const raceIds = [randomUUID(), randomUUID()];
    const race = await Promise.allSettled(
      raceScopes.map((scope, index) =>
        fixture.reserve(scope, 1, raceIds[index]),
      ),
    );
    const successes = race.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failures = race.filter((result) => result.status === 'rejected');
    assert.equal(successes.length, 1);
    assert.ok(
      failures.length === 1 &&
        ['STORAGE_QUOTA_EXCEEDED', 'STORAGE_NODE_UNAVAILABLE'].some(
          (code) =>
            failures[0].reason?.code === code ||
            failures[0].reason?.message?.includes(code),
        ),
    );
    created.push(...successes.map((session) => session.id));
    const raceNode = await fixture.storageNodeFor(successes[0].id);
    assert.equal(raceNode.storage_node_id, 'primary');
    assert.ok(
      (await fixture.nodeCommitment('primary')).committedBytes <= R2_QUOTA,
    );
    for (const session of successes) await fixture.cancel(session.id);
    await fixture.cancel(raceFillA.id);
    await fixture.cancel(raceFillB.id);
    assert.equal((await fixture.nodeCommitment('primary')).committedBytes, 0);
    checks.push(
      'concurrent last-slot reservations cannot overbook R2; cancellation releases native ledger capacity',
    );

    const fullScope = await fixture.createScope('R2 full');
    const fullA = await fixture.reserve(fullScope, MAX_UPLOAD);
    const fullB = await fixture.reserve(fullScope, R2_FULL_FIRST);
    created.push(fullA.id, fullB.id);
    assert.equal(
      (await fixture.storageNodeFor(fullA.id)).storage_node_id,
      'primary',
    );
    assert.equal(
      (await fixture.storageNodeFor(fullB.id)).storage_node_id,
      'primary',
    );
    assert.equal(
      (await fixture.nodeCommitment('primary')).committedBytes,
      R2_QUOTA,
    );

    const guardScope = await fixture.createScope('Oracle guards');
    await assert.rejects(() =>
      rawReservation(fixture, guardScope, 'unknown-node'),
    );
    await assert.rejects(() =>
      rawReservation(fixture, guardScope, 'oracle-vm'),
    );
    await rejectedWith(
      fixture.reserve(await fixture.createScope('Oracle disabled'), 1),
      'STORAGE_NODE_UNAVAILABLE',
    );
    checks.push(
      'unknown node and direct Oracle reservation are rejected while policy is disabled',
    );

    const policy = await saveOraclePolicy(
      fixture.env,
      fixture.owner,
      fixture.session,
      {
        requestId: randomUUID(),
        expectedRevision: 0,
        enabled: true,
        quotaGb: 30,
      },
    );
    assert.equal(policy.requestedEnabled, true);
    assert.equal(policy.effectiveEnabled, false);
    await rejectedWith(
      fixture.reserve(await fixture.createScope('Oracle missing health'), 1),
      'STORAGE_NODE_UNAVAILABLE',
    );

    fixture.s3.setHealth({
      observedAtMs: Date.now() - 120_001,
      mounted: true,
      freeBytes: 50 * GB,
      maximumQuotaBytes: ORACLE_QUOTA,
      quotaBytes: ORACLE_QUOTA,
    });
    await refreshStorageHealth(fixture.env);
    await rejectedWith(
      fixture.reserve(await fixture.createScope('Oracle stale health'), 1),
      'STORAGE_NODE_UNAVAILABLE',
    );
    await assert.rejects(() =>
      rawReservation(fixture, guardScope, 'oracle-vm'),
    );

    fixture.s3.deleteHealth();
    await rejectedWith(
      fixture.reserve(
        await fixture.createScope('Oracle missing health retry'),
        1,
      ),
      'STORAGE_NODE_UNAVAILABLE',
    );
    const publishFreshHealth = async (freeBytes) => {
      await new Promise((resolve) => setTimeout(resolve, 3));
      fixture.s3.setHealth({
        observedAtMs: Date.now(),
        mounted: true,
        freeBytes,
        maximumQuotaBytes: ORACLE_QUOTA,
        quotaBytes: ORACLE_QUOTA,
      });
      await refreshStorageHealth(fixture.env);
    };
    await publishFreshHealth(50 * GB);
    const readyPolicy = await readOraclePolicy(fixture.env, fixture.owner);
    assert.equal(readyPolicy.effectiveEnabled, true);
    assert.equal((await fixture.node('oracle-vm')).quota_bytes, ORACLE_QUOTA);

    const vmScope = await fixture.createScope('Oracle captured session');
    const vmRequestId = randomUUID();
    const vmSession = await fixture.reserve(vmScope, 1, vmRequestId);
    created.push(vmSession.id);
    assert.equal(
      (await fixture.storageNodeFor(vmSession.id)).storage_node_id,
      'oracle-vm',
    );
    await rejectedWith(
      fixture.repository.reserve({
        workspaceId: vmScope.workspace.id,
        projectId: vmScope.project.id,
        albumId: vmScope.album.id,
        originalFilename: `native-${vmRequestId}.jpg`,
        expectedBytes: 2,
        contentType: 'image/jpeg',
        sha256: 'a'.repeat(64),
        requestId: vmRequestId,
      }),
      'REQUEST_ID_CONFLICT',
    );

    await publishFreshHealth(20 * GB);
    await rejectedWith(
      fixture.reserve(await fixture.createScope('Oracle disk floor'), 1),
      'STORAGE_QUOTA_EXCEEDED',
    );
    await publishFreshHealth(50 * GB);
    checks.push(
      'fresh health admits VM only above its physical free-space floor; missing, stale and direct forged-node writes fail closed',
    );

    const foreignScope = await fixture.createScope('Foreign scope');
    await rejectedWith(
      fixture.repository.reserve({
        workspaceId: vmScope.workspace.id,
        projectId: foreignScope.project.id,
        albumId: foreignScope.album.id,
        originalFilename: 'cross-scope.jpg',
        expectedBytes: 1,
        contentType: 'image/jpeg',
        sha256: 'a'.repeat(64),
        requestId: randomUUID(),
      }),
      'NOT_FOUND',
    );

    const workspaceLimitScope = await fixture.createScope('Workspace quota');
    const workspaceLimitA = await fixture.reserve(
      workspaceLimitScope,
      MAX_UPLOAD,
    );
    const workspaceLimitB = await fixture.reserve(
      workspaceLimitScope,
      R2_FULL_FIRST,
    );
    created.push(workspaceLimitA.id, workspaceLimitB.id);
    assert.equal(
      (await fixture.storageNodeFor(workspaceLimitA.id)).storage_node_id,
      'oracle-vm',
    );
    assert.equal(
      (await fixture.storageNodeFor(workspaceLimitB.id)).storage_node_id,
      'oracle-vm',
    );
    await rejectedWith(
      fixture.reserve(workspaceLimitScope, 1),
      'STORAGE_QUOTA_EXCEEDED',
    );
    await fixture.cancel(workspaceLimitA.id);
    await fixture.cancel(workspaceLimitB.id);
    checks.push(
      'cross-scope and workspace-quota refusals remain enforced when VM capacity is available',
    );

    await fixture.cancel(fullA.id);
    await fixture.cancel(fullB.id);
    assert.equal((await fixture.nodeCommitment('primary')).committedBytes, 0);
    const afterReclaimScope = await fixture.createScope('R2 reclaimed');
    const afterReclaim = await fixture.reserve(afterReclaimScope, 1);
    created.push(afterReclaim.id);
    assert.equal(
      (await fixture.storageNodeFor(afterReclaim.id)).storage_node_id,
      'primary',
    );
    const capturedReplay = await fixture.reserve(vmScope, 1, vmRequestId);
    assert.equal(capturedReplay.id, vmSession.id);
    assert.equal(
      (await fixture.storageNodeFor(vmSession.id)).storage_node_id,
      'oracle-vm',
    );
    await fixture.cancel(afterReclaim.id);
    await fixture.cancel(vmSession.id);
    checks.push(
      'native cancellation reclaims R2 capacity for the next upload while a captured VM session remains pinned to VM',
    );

    const quotaFillA = await fixture.reserve(fullScope, MAX_UPLOAD);
    const quotaFillB = await fixture.reserve(fullScope, R2_FULL_FIRST);
    created.push(quotaFillA.id, quotaFillB.id);
    const oracleSessions = [];
    for (let index = 0; index < 4; index++) {
      const scope = await fixture.createScope(`Oracle 30GB ${index + 1}`);
      oracleSessions.push(
        await fixture.reserve(scope, MAX_UPLOAD),
        await fixture.reserve(scope, ORACLE_WORKSPACE_SECOND),
      );
    }
    created.push(...oracleSessions.map((session) => session.id));
    const fullOracle = await fixture.nodeCommitment('oracle-vm');
    assert.equal(fullOracle.quotaBytes, ORACLE_QUOTA);
    assert.equal(fullOracle.committedBytes, ORACLE_QUOTA);
    assert.equal(fullOracle.usedBytes, 0);
    assert.equal(
      (await fixture.nodeCommitment('primary')).committedBytes,
      R2_QUOTA,
    );
    await rejectedWith(
      fixture.reserve(await fixture.createScope('Oracle 30GB bound'), 1),
      'STORAGE_QUOTA_EXCEEDED',
    );
    checks.push(
      '30GB VM quota counts original reservations and pending derivative budgets exactly',
    );

    for (const session of oracleSessions) await fixture.cancel(session.id);
    await fixture.cancel(quotaFillA.id);
    await fixture.cancel(quotaFillB.id);
    assert.equal((await fixture.nodeCommitment('oracle-vm')).committedBytes, 0);
    assert.equal((await fixture.nodeCommitment('primary')).committedBytes, 0);

    assert.equal(
      (
        await fixture.db
          .prepare('SELECT count(*) AS n FROM upload_completions')
          .first()
      ).n,
      0,
    );
    assert.equal(fixture.s3.photoObjectWriteCount(), 0);
    const proof = {
      status: 'passed_native_oracle_storage_admission',
      schemaVersion: 65,
      checks,
      r2QuotaBytes: R2_QUOTA,
      oracleQuotaBytes: ORACLE_QUOTA,
      reservationsCreated: created.length,
      reservationsCancelled: created.length,
      photoCompletions: 0,
      oraclePhotoObjectWrites: fixture.s3.photoObjectWriteCount(),
      mockedS3SignedRequests: fixture.s3.signedRequestCount(),
      oracleStorageMocked: true,
      liveOracleVM: false,
      physicalPhotoUploads: false,
      sourceHashes: Object.fromEntries(
        await Promise.all(
          Object.entries({
            runner: 'apps/worker/tests/oracle-storage-admission-native.mjs',
            storageAdmission: 'apps/worker/src/storage-admission.ts',
            uploads: 'apps/worker/src/uploads.ts',
            migration65:
              'apps/worker/migrations/0065_oracle_storage_admission.sql',
          }).map(async ([key, path]) => [
            key,
            createHash('sha256')
              .update(
                (await readFile(resolve(path), 'utf8')).replace(/\r\n/g, '\n'),
              )
              .digest('hex'),
          ]),
        ),
      ),
    };
    const proofPath = resolve(
      'apps/worker/.local/oracle-storage-admission-native-proof.json',
    );
    await mkdir(dirname(proofPath), { recursive: true });
    await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n');
    console.log(
      `passed: ${checks.length} native Oracle admission groups; metadata reservations only; no photo-object write`,
    );
  } finally {
    await fixture.dispose();
  }
}
