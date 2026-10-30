import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { runResolvedUploadBrowserChecks } from './resolved-uploads-browser.mjs';
import { runIndexedVersionMatchingBrowserChecks } from './indexed-version-matching-browser.mjs';

const PROFILE = 'default-v1';
const UNRELATED_COUNT = 1001;
const SYNTHETIC_HISTORY_COUNT = 1001;
const INDEX_ADVANCE_LIMIT = 24;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function runIndexedVersionMatchingChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  const worker = await mf.getWorker('indexed-version-matching-test');
  const legacyWorker = await mf.getWorker('resolved-uploads-test');
  const defaultWorker = await mf.getWorker('app');
  const storageWorker = await mf.getWorker('storage-test');
  const ownerCookie = cookies.headers();
  const workspaceId = galleryFixture.context.workspace.id;
  const storage = galleryFixture.storage;
  const processingJobs = new D1ImageProcessingRepository(db);
  const processingObjects = new R2ProcessingObjectStore(storage);
  const imageProcessor = new LocalSharpImageProcessor();
  const headers = {
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
  };
  const unissuedSessions = new Set();

  const send = (target, method, path, body, overrides = {}) => {
    const requestHeaders = { ...headers, ...overrides };
    for (const [name, value] of Object.entries(requestHeaders))
      if (value === undefined) delete requestHeaders[name];
    const init = { method, headers: requestHeaders };
    if (body !== undefined) init.body = JSON.stringify(body);
    return target.fetch(new Request(new URL(path, base), init));
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
  const count = async (sql, ...values) =>
    Number((await first(sql, ...values))?.n ?? 0);

  const createProject = async (mode, label) => {
    const created = await send(worker, 'POST', '/api/v1/projects', {
      requestId: randomUUID(),
      workspaceId,
      name: 'Indexed match ' + label + ' ' + randomUUID(),
    });
    assert.equal(created.status, 201, await created.clone().text());
    const project = (await readJson(created)).project;
    assert.ok(project?.id);

    const settingsPath = '/api/v1/projects/' + project.id + '/versioning';
    const initial = await send(worker, 'GET', settingsPath);
    assert.equal(initial.status, 200, await initial.clone().text());
    const current = await readJson(initial);
    const changed = await send(worker, 'PUT', settingsPath, {
      requestId: randomUUID(),
      expectedRevision: current.revision,
      mode,
      confirm: true,
    });
    assert.equal(changed.status, 200, await changed.clone().text());
    const versioning = await readJson(changed);
    assert.equal(versioning.mode, mode);
    return { ...project, revision: versioning.revision };
  };
  const createAlbum = async (project, label) => {
    const response = await send(
      worker,
      'POST',
      '/api/v1/projects/' + project.id + '/albums',
      {
        requestId: randomUUID(),
        name: 'Indexed album ' + label + ' ' + randomUUID(),
      },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return (await readJson(response)).album;
  };
  const fileEvidence = (
    originalFilename,
    hash,
    dimensions = { width: 48, height: 24 },
    expectedBytes = 1,
  ) => ({
    originalFilename,
    expectedBytes,
    contentType: 'image/png',
    sha256: hash,
    dimensions,
  });
  const makePng = (width, height, background) =>
    sharp({ create: { width, height, channels: 3, background } })
      .png()
      .toBuffer();
  const imageEvidence = async (originalFilename, bytes) => {
    const metadata = await sharp(bytes).metadata();
    return fileEvidence(
      originalFilename,
      createHash('sha256').update(bytes).digest('hex'),
      { width: metadata.width, height: metadata.height },
      bytes.byteLength,
    );
  };
  const preview = async (album, file, target = worker, overrides = {}) => {
    const response = await send(
      target,
      'POST',
      '/api/v1/albums/' + album.id + '/upload-resolution',
      { file },
      overrides,
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
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
  const usage = (id) =>
    first(
      'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
      id,
    );
  const albumState = async (album) => ({
    requests: await count(
      "SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND album_id=? AND operation='upload.reserved'",
      owner,
      album.id,
    ),
    sessions: await count(
      'SELECT count(*) AS n FROM upload_sessions WHERE actor_id=? AND album_id=?',
      owner,
      album.id,
    ),
    indexRows: await count(
      'SELECT count(*) AS n FROM matching_filename_index WHERE album_id=? AND profile=?',
      album.id,
      PROFILE,
    ),
    auditRows: await count(
      'SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND album_id=?',
      owner,
      album.id,
    ),
    sequence: Number(
      (
        await first(
          'SELECT COALESCE(MAX(sequence),0) AS n FROM album_matching_changes WHERE album_id=?',
          album.id,
        )
      )?.n ?? 0,
    ),
    usage: await usage(album.workspaceId),
  });
  const status = async (album, target = worker) => {
    const response = await send(
      target,
      'GET',
      '/api/v1/albums/' + album.id + '/matching-filename-index',
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const advanceAll = async (album) => {
    let current = await status(album);
    let calls = 0;
    while (current.missingSessions > 0) {
      assert.ok(
        calls <
          Math.ceil(
            (current.indexedSessions + current.missingSessions) /
              INDEX_ADVANCE_LIMIT,
          ) +
            2,
      );
      const advanced = await send(
        worker,
        'POST',
        '/api/v1/albums/' + album.id + '/matching-filename-index',
        {},
      );
      const body = await readJson(advanced);
      assert.equal(advanced.status, 200, JSON.stringify(body));
      current = body;
      calls++;
    }
    return current;
  };
  const reserveOrdinary = async (project, album, file, target = worker) => {
    const response = await send(target, 'POST', '/api/v1/uploads/init', {
      workspaceId: project.workspaceId,
      projectId: project.id,
      albumId: album.id,
      originalFilename: file.originalFilename,
      expectedBytes: file.expectedBytes,
      contentType: file.contentType,
      sha256: file.sha256,
      requestId: randomUUID(),
    });
    const body = await readJson(response);
    assert.equal(response.status, 201, JSON.stringify(body));
    const session = body.uploadSession;
    assert.ok(session?.id);
    unissuedSessions.add(session.id);
    return session;
  };
  const authorizeAndPut = async (uploadSessionId, bytes, file) => {
    const authorization = await send(
      worker,
      'POST',
      '/api/v1/uploads/' + uploadSessionId + '/authorize',
      { requestId: randomUUID() },
    );
    const body = await readJson(authorization);
    assert.equal(authorization.status, 200, JSON.stringify(body));
    assert.equal(body.uploadAuthorization?.contentLength, bytes.byteLength);
    const key = await first(
      'SELECT object_key FROM upload_sessions WHERE id=?',
      uploadSessionId,
    );
    assert.ok(key?.object_key);
    const stored = await storage.put(key.object_key, new Uint8Array(bytes), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/png' },
      sha256: Buffer.from(file.sha256, 'hex'),
    });
    assert.ok(stored);
  };
  const completeOrdinary = async (project, album, file, bytes) => {
    const session = await reserveOrdinary(project, album, file);
    await authorizeAndPut(session.id, bytes, file);
    const response = await send(
      worker,
      'POST',
      '/api/v1/uploads/' + session.id + '/complete',
      { requestId: randomUUID() },
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.completion?.status, 'completed');
    unissuedSessions.delete(session.id);
    return { session, ...body.completion };
  };
  const processRealVersion = async (completion) => {
    assert.ok(completion?.assetId);
    assert.ok(completion?.versionId);
    const processed = await runImageProcessingJob({
      jobId: completion.assetId,
      jobs: processingJobs,
      objects: processingObjects,
      processor: imageProcessor,
    });
    assert.equal(processed.status, 'succeeded');
    assert.deepEqual(
      await first(
        'SELECT status FROM image_processing_jobs WHERE id=?',
        completion.assetId,
      ),
      { status: 'succeeded' },
    );
    const derivatives = await db
      .prepare(
        "SELECT asset_kind FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
      )
      .bind(completion.versionId)
      .all();
    assert.deepEqual(
      derivatives.results.map((row) => row.asset_kind),
      ['preview', 'thumbnail'],
    );
  };
  const completeExplicitVersion = async (photoId, filename, bytes, file) => {
    const head = await first(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      photoId,
    );
    assert.ok(head?.version_id);
    const initialized = await send(
      worker,
      'POST',
      '/api/v1/photos/' + photoId + '/versions/init',
      {
        requestId: randomUUID(),
        originalFilename: filename,
        expectedBytes: bytes.byteLength,
        contentType: 'image/png',
        sha256: file.sha256,
        expectedRevision: head.revision,
        expectedCurrentVersionId: head.version_id,
        changeType: 'replace_current',
        changeNote: 'Indexed matching fixture head',
        labels: [],
        confirm: true,
      },
    );
    const initBody = await readJson(initialized);
    assert.equal(initialized.status, 201, JSON.stringify(initBody));
    const session = initBody.uploadSession;
    assert.ok(session?.id);
    unissuedSessions.add(session.id);
    const indexed = await first(
      'SELECT original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
      session.id,
      PROFILE,
    );
    assert.deepEqual(indexed, {
      original_filename: filename,
      canonical_basename: filename.slice(0, filename.lastIndexOf('.')),
      canonical_extension: 'png',
      is_invalid: 0,
    });

    await authorizeAndPut(session.id, bytes, file);
    const completed = await send(
      worker,
      'POST',
      '/api/v1/photos/' + photoId + '/versions/' + session.id + '/complete',
      { requestId: randomUUID() },
    );
    const completion = await readJson(completed);
    assert.equal(completed.status, 200, JSON.stringify(completion));
    assert.equal(completion.status, 'completed');
    unissuedSessions.delete(session.id);
    await processRealVersion(completion);
    return { session, ...completion };
  };
  const setCurrentVersion = async (photoId, versionId) => {
    const current = await first(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      photoId,
    );
    assert.ok(current?.version_id);
    const response = await send(
      worker,
      'POST',
      '/api/v1/photos/' + photoId + '/versions/set-current',
      {
        requestId: randomUUID(),
        expectedRevision: current.revision,
        expectedCurrentVersionId: current.version_id,
        versionId,
        confirm: true,
      },
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.current;
  };
  const cancelUnissued = async (uploadSessionId, target = worker) => {
    if (!unissuedSessions.has(uploadSessionId)) return;
    const response = await send(
      target,
      'POST',
      '/api/v1/uploads/' + uploadSessionId + '/cancel',
      { requestId: randomUUID() },
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    unissuedSessions.delete(uploadSessionId);
  };
  const legacySnapshot = async (album) => {
    const authenticated = await request('/api/auth/get-session', {
      headers: { Cookie: ownerCookie },
    });
    assert.equal(authenticated.status, 200, await authenticated.clone().text());
    const authBody = await authenticated.json();
    assert.equal(authBody?.user?.id, owner);
    const response = await storageWorker.fetch(
      new Request(base + '/test-version-match-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor: owner,
          session: authBody.session.id,
          albumId: album.id,
        }),
      }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const appendSyntheticVersion = async (photoId, index, overrides = {}) =>
    appendAuthorizedVersionFixture({
      db,
      owner,
      photoId,
      sha256: overrides.sha256 ?? sha256('indexed-history-' + index),
      byteSize: 1,
      mime: 'image/png',
      width: overrides.width ?? 48,
      height: overrides.height ?? 24,
    });

  let largeProject;
  let largeAlbum;
  let largePhoto;
  let renamedHeadVersionId;
  let syntheticVersions = [];
  try {
    await check(
      'indexed Worker and maintenance capabilities are opt-in alongside the existing matching capability',
      async () => {
        const resolution = await send(
          worker,
          'GET',
          '/api/v1/upload-resolution/capabilities',
        );
        assert.equal(resolution.status, 200);
        assert.deepEqual(await readJson(resolution), { enabled: true });
        const indexCapabilities = await send(
          worker,
          'GET',
          '/api/v1/matching-filename-index/capabilities',
        );
        assert.equal(indexCapabilities.status, 200);
        assert.deepEqual(await readJson(indexCapabilities), { enabled: true });
        const legacyCapabilities = await send(
          legacyWorker,
          'GET',
          '/api/v1/matching-filename-index/capabilities',
        );
        assert.equal(legacyCapabilities.status, 200);
        assert.deepEqual(await readJson(legacyCapabilities), {
          enabled: false,
        });
        const defaults = await request(
          '/api/v1/upload-resolution/capabilities',
          {
            headers: { Cookie: ownerCookie },
          },
        );
        assert.equal(defaults.status, 200);
        assert.deepEqual(await readJson(defaults), { enabled: false });
      },
    );

    await check(
      'actual ordinary reservation API creates 1,001 unrelated immutable pending keys beyond the legacy candidate cap',
      async () => {
        largeProject = await createProject('auto_filename', 'large-history');
        largeAlbum = await createAlbum(largeProject, 'large-history');
        for (let start = 0; start < UNRELATED_COUNT; start += 24) {
          const chunk = [];
          const end = Math.min(start + 24, UNRELATED_COUNT);
          for (let index = start; index < end; index++) {
            const filename =
              'indexed-unrelated-' + String(index).padStart(4, '0') + '.png';
            chunk.push(
              reserveOrdinary(
                largeProject,
                largeAlbum,
                fileEvidence(filename, sha256('unrelated-file-' + index)),
              ),
            );
          }
          await Promise.all(chunk);
        }

        const current = await status(largeAlbum);
        assert.equal(current.indexedSessions, UNRELATED_COUNT);
        assert.equal(current.missingSessions, 0);
        assert.equal(current.state, 'ready');
        const legacy = await legacySnapshot(largeAlbum);
        assert.equal(legacy.candidatesTruncated, true);
        assert.ok(legacy.candidates.length <= 1000);

        const fresh = fileEvidence(
          'indexed-first-photo.png',
          sha256('indexed-first-photo-bytes'),
        );
        const legacyDecision = await preview(largeAlbum, fresh, legacyWorker);
        assert.equal(legacyDecision.decision.outcome, 'requires_review');
        assert.equal(
          legacyDecision.decision.reason,
          'candidate_limit_exceeded',
        );
        assert.equal(legacyDecision.candidatesTruncated, true);
        const before = await albumState(largeAlbum);
        const firstPreview = await preview(largeAlbum, fresh);
        assert.equal(firstPreview.decision.outcome, 'new_photo');
        assert.equal(firstPreview.decision.reason, 'no_filename_match');
        assert.equal(firstPreview.candidatesTruncated, false);
        assert.deepEqual(firstPreview.candidates, []);

        const beforeInvalidAuthority = await albumState(largeAlbum);
        const wrongOrigin = await send(
          worker,
          'POST',
          '/api/v1/albums/' + largeAlbum.id + '/upload-resolution',
          { file: fresh },
          { Origin: 'https://attacker.invalid' },
        );
        const wrongOriginText = await wrongOrigin.text();
        assert.equal(wrongOrigin.status, 403, wrongOriginText);
        assert.match(wrongOriginText, /Invalid Origin header/u);
        const wrongActor = await send(
          worker,
          'POST',
          '/api/v1/albums/' + largeAlbum.id + '/upload-resolution',
          { file: fresh },
          { 'X-Kino-Expected-Actor': randomUUID() },
        );
        await expectCode(wrongActor, 403, 'UPLOAD_OWNER_CHANGED');
        assert.deepEqual(await albumState(largeAlbum), beforeInvalidAuthority);

        const reserve = reserveBody(fresh, firstPreview, { kind: 'new_photo' });
        const reserved = await send(
          worker,
          'POST',
          '/api/v1/albums/' + largeAlbum.id + '/resolved-uploads',
          reserve,
        );
        const reservation = await readJson(reserved);
        assert.equal(reserved.status, 201, JSON.stringify(reservation));
        unissuedSessions.add(reservation.uploadSession.id);
        assert.deepEqual(reservation.target, { kind: 'new_photo' });
        const resolvedKey = await first(
          'SELECT original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
          reservation.uploadSession.id,
          PROFILE,
        );
        assert.deepEqual(resolvedKey, {
          original_filename: fresh.originalFilename,
          canonical_basename: 'indexed-first-photo',
          canonical_extension: 'png',
          is_invalid: 0,
        });
        assert.ok(before.sessions > 1000);
      },
    );

    await check(
      'one real R2 V1 and one real R2 renamed head remain classifiable after more than 1,000 guarded immutable D1 history completions',
      async () => {
        const firstBytes = await makePng(48, 24, '#287ca1');
        const firstFile = await imageEvidence(
          'portrait-source.png',
          firstBytes,
        );
        largePhoto = await completeOrdinary(
          largeProject,
          largeAlbum,
          firstFile,
          firstBytes,
        );
        await processRealVersion(largePhoto);
        const photoId = largePhoto.photoId;
        assert.ok(photoId);
        const initialHead = await first(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
          photoId,
        );
        assert.deepEqual(initialHead, {
          version_id: largePhoto.versionId,
          revision: 0,
        });

        const reservedKey = await first(
          'SELECT original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
          largePhoto.session.id,
          PROFILE,
        );
        assert.deepEqual(reservedKey, {
          original_filename: 'portrait-source.png',
          canonical_basename: 'portrait-source',
          canonical_extension: 'png',
          is_invalid: 0,
        });

        // This helper inserts unique command/request/completion witnesses using
        // the existing guarded D1 upload completion triggers. These 1,001 rows
        // are synthetic metadata only; they deliberately do not claim 1,001
        // physical R2 byte uploads. The V1 and renamed head below are real R2.
        syntheticVersions = [];
        for (let index = 0; index < SYNTHETIC_HISTORY_COUNT; index++) {
          syntheticVersions.push(
            await appendSyntheticVersion(
              photoId,
              String(index).padStart(4, '0'),
            ),
          );
        }

        const renamedBytes = await makePng(48, 24, '#b54f78');
        const renamedFile = await imageEvidence(
          'renamed-head.png',
          renamedBytes,
        );
        const renamedCompletion = await completeExplicitVersion(
          photoId,
          renamedFile.originalFilename,
          renamedBytes,
          renamedFile,
        );
        renamedHeadVersionId = renamedCompletion.versionId;
        const headAfterCompletion = await first(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
          photoId,
        );
        assert.deepEqual(headAfterCompletion, initialHead);
        const changedHead = await setCurrentVersion(
          photoId,
          renamedCompletion.versionId,
        );
        assert.deepEqual(changedHead, {
          versionId: renamedCompletion.versionId,
          revision: 1,
        });

        const versionCount = await count(
          'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
          photoId,
        );
        assert.equal(versionCount, SYNTHETIC_HISTORY_COUNT + 2);
        const beforeBackfill = await status(largeAlbum);
        assert.equal(beforeBackfill.missingSessions, SYNTHETIC_HISTORY_COUNT);
        const ready = await advanceAll(largeAlbum);
        assert.equal(ready.missingSessions, 0);
        assert.equal(ready.invalidSessions, 0);
        assert.equal(ready.unlinkedVersions, 0);
        assert.equal(ready.unreadyPhotos, 0);
        assert.equal(ready.state, 'ready');

        const legacy = await legacySnapshot(largeAlbum);
        assert.equal(legacy.candidatesTruncated, true);
        assert.ok(legacy.candidates.length <= 1000);

        const incoming = fileEvidence(
          'portrait-source.png',
          sha256('portrait-source-new-retouch'),
        );
        const legacyDecision = await preview(
          largeAlbum,
          incoming,
          legacyWorker,
        );
        assert.equal(legacyDecision.decision.outcome, 'requires_review');
        assert.equal(
          legacyDecision.decision.reason,
          'candidate_limit_exceeded',
        );
        assert.equal(legacyDecision.candidatesTruncated, true);
        const decision = await preview(largeAlbum, incoming);
        assert.equal(decision.decision.outcome, 'new_version');
        assert.equal(decision.decision.reason, 'unique_filename_hash_changed');
        assert.equal(decision.decision.photoId, photoId);
        assert.equal(decision.candidatesTruncated, false);
        assert.deepEqual(decision.candidates, [
          {
            photoId,
            filename: 'renamed-head.png',
            currentVersionId: renamedCompletion.versionId,
            revision: 1,
          },
        ]);
        assert.ok(versionCount > 1000);
      },
    );

    await check(
      'production indexed SQL EXPLAIN uses the canonical partial scope index with nine real D1 binds',
      async () => {
        const source = await readFile(
          new URL(
            '../src/indexed-version-match-candidates.ts',
            import.meta.url,
          ),
          'utf8',
        );
        const sqlMatch = /const indexedSnapshotSql = `([\s\S]*?)`;/u.exec(
          source,
        );
        assert.ok(
          sqlMatch?.[1],
          'Expected the production indexed SQL template',
        );
        const sql = sqlMatch[1];
        assert.match(sql, /i\.is_invalid=0/u);
        const witnessSql = sql.slice(
          sql.indexOf('version_witnesses AS'),
          sql.indexOf('coverage_counts AS'),
        );
        assert.doesNotMatch(
          witnessSql,
          /u\.actor_id=\?1/u,
          'Immutable historical versions from earlier authorized actors remain in the current Owner scope',
        );
        const index = await first(
          "SELECT sql FROM sqlite_master WHERE type='index' AND name='matching_filename_index_canonical_scope'",
        );
        assert.match(index?.sql ?? '', /WHERE is_invalid=0/u);
        const incomingHash = sha256('indexed-explain-evidence');
        const liveOwnerSession = await first(
          'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? ORDER BY expiresAt DESC,id DESC LIMIT 1',
          owner,
          Date.now(),
        );
        assert.ok(liveOwnerSession?.id);
        const plan = await db
          .prepare('EXPLAIN QUERY PLAN ' + sql)
          .bind(
            owner,
            liveOwnerSession.id,
            largeAlbum.id,
            PROFILE,
            'portrait-source',
            'png',
            incomingHash,
            48,
            24,
          )
          .all();
        assert.equal(plan.success, true, JSON.stringify(plan));
        const details = plan.results
          .map((row) => String(row.detail ?? ''))
          .filter(Boolean);
        const planText = details.join(' | ');
        assert.match(
          planText,
          /matching_filename_index_canonical_scope/u,
          planText,
        );
        process.stdout.write(
          'Indexed resolver local D1 EXPLAIN: ' +
            planText.replace(/\s+/gu, ' ') +
            '\n',
        );
      },
    );

    await check(
      'same-snapshot indexed reserve binds the current head, rejects stale watermarks without quota, and rolls back key-write failure atomically',
      async () => {
        const incoming = fileEvidence(
          'portrait-source.png',
          sha256('portrait-source-after-head'),
        );
        const original = await preview(largeAlbum, incoming);
        const match = original.candidates.find(
          (candidate) => candidate.photoId === largePhoto.photoId,
        );
        assert.ok(match);
        assert.equal(match.filename, 'renamed-head.png');
        const originalBody = reserveBody(incoming, original, {
          kind: 'new_version',
          photoId: match.photoId,
          parentVersionId: match.currentVersionId,
          expectedRevision: match.revision,
        });

        const watermarkFile = fileEvidence(
          'watermark-race.png',
          sha256('watermark-race'),
        );
        const watermarkSession = await reserveOrdinary(
          largeProject,
          largeAlbum,
          watermarkFile,
        );
        const beforeStaleReserve = await albumState(largeAlbum);
        await expectCode(
          await send(
            worker,
            'POST',
            '/api/v1/albums/' + largeAlbum.id + '/resolved-uploads',
            originalBody,
          ),
          409,
          'RESOLUTION_STALE',
        );
        assert.deepEqual(await albumState(largeAlbum), beforeStaleReserve);
        await cancelUnissued(watermarkSession.id);

        const currentPreview = await preview(largeAlbum, incoming);
        assert.equal(currentPreview.decision.outcome, 'new_version');
        const currentCandidate = currentPreview.candidates.find(
          (candidate) => candidate.photoId === largePhoto.photoId,
        );
        assert.ok(currentCandidate);
        const currentBody = reserveBody(incoming, currentPreview, {
          kind: 'new_version',
          photoId: currentCandidate.photoId,
          parentVersionId: currentCandidate.currentVersionId,
          expectedRevision: currentCandidate.revision,
        });
        const good = await send(
          worker,
          'POST',
          '/api/v1/albums/' + largeAlbum.id + '/resolved-uploads',
          currentBody,
        );
        const goodBody = await readJson(good);
        assert.equal(good.status, 201, JSON.stringify(goodBody));
        unissuedSessions.add(goodBody.uploadSession.id);
        assert.deepEqual(goodBody.target, {
          kind: 'new_version',
          photoId: largePhoto.photoId,
          parentVersionId: currentCandidate.currentVersionId,
          expectedRevision: currentCandidate.revision,
          capturedVersioningMode: 'auto_filename',
          changeType: 'new_retouch',
        });
        const resolvedVersionKey = await first(
          'SELECT original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
          goodBody.uploadSession.id,
          PROFILE,
        );
        assert.deepEqual(resolvedVersionKey, {
          original_filename: incoming.originalFilename,
          canonical_basename: 'portrait-source',
          canonical_extension: 'png',
          is_invalid: 0,
        });
        await cancelUnissued(goodBody.uploadSession.id);

        const failedFilename = 'atomic-index-failure.png';
        const failedRequestId = randomUUID();
        const beforeFailure = await albumState(largeAlbum);
        await db.exec(
          "CREATE TRIGGER fail_indexed_filename_reservation BEFORE INSERT ON matching_filename_index WHEN NEW.original_filename='atomic-index-failure.png' BEGIN SELECT RAISE(ABORT,'TEST_INDEXED_FILENAME_WRITE_FAILURE'); END;",
        );
        try {
          const failed = await send(worker, 'POST', '/api/v1/uploads/init', {
            requestId: failedRequestId,
            workspaceId: largeProject.workspaceId,
            projectId: largeProject.id,
            albumId: largeAlbum.id,
            originalFilename: failedFilename,
            expectedBytes: 1,
            contentType: 'image/png',
            sha256: sha256('atomic-index-failure'),
          });
          await expectCode(failed, 503, 'RESOLUTION_UNAVAILABLE');
          assert.deepEqual(await albumState(largeAlbum), beforeFailure);
          assert.equal(
            await first(
              'SELECT 1 AS found FROM upload_requests WHERE actor_id=? AND request_id=?',
              owner,
              failedRequestId,
            ),
            null,
          );
          assert.equal(
            await first(
              'SELECT 1 AS found FROM upload_sessions WHERE album_id=? AND original_filename=?',
              largeAlbum.id,
              failedFilename,
            ),
            null,
          );
        } finally {
          await db.exec(
            'DROP TRIGGER IF EXISTS fail_indexed_filename_reservation;',
          );
        }
      },
    );

    await check(
      'head compare-and-swap refuses an old selected version after a fresh watermark, without quota writes',
      async () => {
        const file = fileEvidence(
          'portrait-source.png',
          sha256('head-cas-before-crop'),
        );
        const oldPreview = await preview(largeAlbum, file);
        assert.equal(oldPreview.decision.outcome, 'new_version');
        const oldCandidate = oldPreview.candidates.find(
          (candidate) => candidate.photoId === largePhoto.photoId,
        );
        assert.ok(oldCandidate);
        assert.equal(oldCandidate.currentVersionId, renamedHeadVersionId);
        assert.equal(oldCandidate.revision, 1);

        const switchedToOriginal = await setCurrentVersion(
          largePhoto.photoId,
          largePhoto.versionId,
        );
        assert.equal(switchedToOriginal.revision, 2);
        const freshSequence = Number(
          (
            await first(
              'SELECT COALESCE(MAX(sequence),0) AS n FROM album_matching_changes WHERE album_id=?',
              largeAlbum.id,
            )
          ).n,
        );
        const staleHeadBody = {
          ...reserveBody(file, oldPreview, {
            kind: 'new_version',
            photoId: largePhoto.photoId,
            parentVersionId: renamedHeadVersionId,
            expectedRevision: oldCandidate.revision,
          }),
          expectedChangeSequence: freshSequence,
        };
        const beforeDenial = await albumState(largeAlbum);
        await expectCode(
          await send(
            worker,
            'POST',
            '/api/v1/albums/' + largeAlbum.id + '/resolved-uploads',
            staleHeadBody,
          ),
          409,
          'RESOLUTION_REVIEW_REQUIRED',
        );
        assert.deepEqual(await albumState(largeAlbum), beforeDenial);

        const restored = await setCurrentVersion(
          largePhoto.photoId,
          renamedHeadVersionId,
        );
        assert.equal(restored.revision, 3);
      },
    );

    await check(
      'large-history duplicate hashes, duplicate ambiguity, renamed immutable sources, crop mismatch and duplicate logical photos are explicit',
      async () => {
        const singleHash = sha256('indexed-history-0000');
        const singlePreview = await preview(
          largeAlbum,
          fileEvidence('portrait-source.png', singleHash),
        );
        assert.deepEqual(singlePreview.decision, {
          outcome: 'duplicate',
          reason: 'exact_hash_match',
          photoId: largePhoto.photoId,
          versionId: syntheticVersions[0].version_id,
        });
        assert.equal(singlePreview.candidatesTruncated, false);

        const secondDuplicate = await appendSyntheticVersion(
          largePhoto.photoId,
          'duplicate-twin',
          { sha256: singleHash },
        );
        const backfilled = await advanceAll(largeAlbum);
        assert.equal(backfilled.state, 'ready');
        const twinPreview = await preview(
          largeAlbum,
          fileEvidence('portrait-source.png', singleHash),
        );
        assert.deepEqual(twinPreview.decision, {
          outcome: 'duplicate',
          reason: 'exact_hash_match',
          photoId: largePhoto.photoId,
          versionId: null,
        });
        const twinCandidate = twinPreview.candidates.find(
          (candidate) => candidate.photoId === largePhoto.photoId,
        );
        assert.ok(twinCandidate);
        const duplicateBody = reserveBody(
          fileEvidence('portrait-source.png', singleHash),
          twinPreview,
          {
            kind: 'new_version',
            photoId: twinCandidate.photoId,
            parentVersionId: twinCandidate.currentVersionId,
            expectedRevision: twinCandidate.revision,
          },
        );
        const beforeDuplicateDenial = await albumState(largeAlbum);
        await expectCode(
          await send(
            worker,
            'POST',
            '/api/v1/albums/' + largeAlbum.id + '/resolved-uploads',
            duplicateBody,
          ),
          409,
          'RESOLUTION_DUPLICATE',
        );
        assert.deepEqual(await albumState(largeAlbum), beforeDuplicateDenial);
        assert.notEqual(
          secondDuplicate.version_id,
          syntheticVersions[0].version_id,
        );

        const cropBytes = await makePng(24, 48, '#a78542');
        const cropFile = await imageEvidence('cropped-head.png', cropBytes);
        const headBeforeCrop = await first(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
          largePhoto.photoId,
        );
        const cropVersion = await completeExplicitVersion(
          largePhoto.photoId,
          cropFile.originalFilename,
          cropBytes,
          cropFile,
        );
        const cropHead = await setCurrentVersion(
          largePhoto.photoId,
          cropVersion.versionId,
        );
        assert.equal(cropHead.versionId, cropVersion.versionId);
        assert.equal(cropHead.revision, headBeforeCrop.revision + 1);

        const cropReview = await preview(
          largeAlbum,
          fileEvidence('portrait-source.png', sha256('crop-review-input'), {
            width: 48,
            height: 24,
          }),
        );
        assert.equal(cropReview.decision.outcome, 'requires_review');
        assert.equal(
          cropReview.decision.reason,
          'dimension_change_requires_review',
        );
        assert.equal(cropReview.candidatesTruncated, false);
        assert.equal(
          cropReview.candidates[0]?.currentVersionId,
          cropVersion.versionId,
        );

        const ambiguousBytesA = await makePng(48, 24, '#3a8a56');
        const ambiguousBytesB = await makePng(48, 24, '#bc7348');
        const ambiguousA = await imageEvidence(
          'ambiguous-indexed.png',
          ambiguousBytesA,
        );
        const ambiguousB = await imageEvidence(
          'ambiguous-indexed.png',
          ambiguousBytesB,
        );
        const photoA = await completeOrdinary(
          largeProject,
          largeAlbum,
          ambiguousA,
          ambiguousBytesA,
        );
        const photoB = await completeOrdinary(
          largeProject,
          largeAlbum,
          ambiguousB,
          ambiguousBytesB,
        );
        assert.notEqual(photoA.photoId, photoB.photoId);
        const ambiguous = await preview(
          largeAlbum,
          fileEvidence('ambiguous-indexed.png', sha256('ambiguous-input')),
        );
        assert.equal(ambiguous.decision.outcome, 'requires_review');
        assert.equal(ambiguous.decision.reason, 'ambiguous_filename_match');
        assert.equal(ambiguous.candidatesTruncated, false);
        const ambiguityBody = reserveBody(
          fileEvidence('ambiguous-indexed.png', sha256('ambiguous-input')),
          ambiguous,
          { kind: 'new_photo' },
        );
        const beforeAmbiguityDenial = await albumState(largeAlbum);
        await expectCode(
          await send(
            worker,
            'POST',
            '/api/v1/albums/' + largeAlbum.id + '/resolved-uploads',
            ambiguityBody,
          ),
          409,
          'RESOLUTION_REVIEW_REQUIRED',
        );
        assert.deepEqual(await albumState(largeAlbum), beforeAmbiguityDenial);
      },
    );

    await check(
      'same-canonical reserved status blocks until a durable expiry transition',
      async () => {
        const project = await createProject('auto_filename', 'pending-state');
        const album = await createAlbum(project, 'pending-state');
        const filename = 'same-canonical-pending.png';
        const pending = await reserveOrdinary(
          project,
          album,
          fileEvidence(filename, sha256('same-canonical-pending')),
        );
        const source = await first(
          'SELECT status,expires_at_ms FROM upload_sessions WHERE id=?',
          pending.id,
        );
        assert.equal(source.status, 'reserved');
        assert.ok(source.expires_at_ms > Date.now());
        const blocked = await preview(
          album,
          fileEvidence(filename, sha256('same-canonical-preview')),
        );
        assert.equal(blocked.decision.outcome, 'requires_review');
        assert.equal(blocked.decision.reason, 'pending_upload_requires_review');
        assert.equal(blocked.candidatesTruncated, false);

        const expiredAt = Number(source.expires_at_ms);
        const expired = await db
          .prepare(
            "UPDATE upload_sessions SET status='expired',updated_at_ms=expires_at_ms,updated_by_request_id='reservation-expired:'||id,updated_by_session_id=NULL,updated_by_actor_type='system' WHERE id=? AND status='reserved' AND expires_at_ms<=? AND NOT EXISTS(SELECT 1 FROM upload_authorizations a WHERE a.upload_session_id=upload_sessions.id) AND NOT EXISTS(SELECT 1 FROM upload_completions c WHERE c.upload_session_id=upload_sessions.id) AND NOT EXISTS(SELECT 1 FROM upload_version_completions vc WHERE vc.upload_session_id=upload_sessions.id)",
          )
          .bind(pending.id, expiredAt + 1)
          .run();
        assert.equal(expired.success, true);
        unissuedSessions.delete(pending.id);
        const afterExpiry = await preview(
          album,
          fileEvidence(filename, sha256('same-canonical-after-expiry')),
        );
        assert.deepEqual(
          await first(
            'SELECT status,updated_at_ms,updated_by_actor_type FROM upload_sessions WHERE id=?',
            pending.id,
          ),
          {
            status: 'expired',
            updated_at_ms: expiredAt,
            updated_by_actor_type: 'system',
          },
        );
        assert.equal(afterExpiry.decision.outcome, 'new_photo');
        assert.equal(afterExpiry.candidatesTruncated, false);
      },
    );

    await check(
      'an invalid uncompleted filename ceases to block after cancellation without deleting its immutable invalid key',
      async () => {
        const project = await createProject('auto_filename', 'invalid-cancel');
        const album = await createAlbum(project, 'invalid-cancel');
        const invalid = await reserveOrdinary(
          project,
          album,
          fileEvidence('.', sha256('invalid-filename-reservation')),
        );
        const invalidKey = await first(
          'SELECT is_invalid,canonical_basename,canonical_extension FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
          invalid.id,
          PROFILE,
        );
        assert.deepEqual(invalidKey, {
          is_invalid: 1,
          canonical_basename: null,
          canonical_extension: null,
        });
        const blocked = await preview(
          album,
          fileEvidence('valid-after-cancel.png', sha256('valid-after-cancel')),
        );
        assert.equal(blocked.decision.outcome, 'requires_review');
        assert.equal(blocked.decision.reason, 'filename_index_not_ready');
        assert.equal(blocked.candidatesTruncated, true);

        await cancelUnissued(invalid.id);
        assert.deepEqual(
          await first(
            'SELECT is_invalid FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
            invalid.id,
            PROFILE,
          ),
          { is_invalid: 1 },
        );
        const ready = await status(album);
        assert.equal(ready.invalidSessions, 0);
        assert.equal(ready.state, 'ready');
        const after = await preview(
          album,
          fileEvidence('valid-after-cancel.png', sha256('valid-after-cancel')),
        );
        assert.equal(after.decision.outcome, 'new_photo');
        assert.equal(after.candidatesTruncated, false);
      },
    );

    await check(
      'missing immutable filename keys require review instead of false no-match, and exact reservation replay survives later gaps',
      async () => {
        const project = await createProject(
          'auto_filename',
          'missing-key-replay',
        );
        const album = await createAlbum(project, 'missing-key-replay');
        const replayFile = fileEvidence(
          'exact-lost-response.png',
          sha256('exact-lost-response'),
        );
        const before = await preview(album, replayFile);
        assert.equal(before.decision.outcome, 'new_photo');
        const originalBody = reserveBody(replayFile, before, {
          kind: 'new_photo',
        });
        const initial = await send(
          worker,
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          originalBody,
        );
        const original = await readJson(initial);
        assert.equal(initial.status, 201, JSON.stringify(original));
        unissuedSessions.add(original.uploadSession.id);

        const missing = await reserveOrdinary(
          project,
          album,
          fileEvidence('legacy-without-key.png', sha256('legacy-without-key')),
          legacyWorker,
        );
        assert.equal(
          await first(
            'SELECT 1 AS found FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
            missing.id,
            PROFILE,
          ),
          null,
        );
        const building = await status(album);
        assert.equal(building.missingSessions, 1);
        assert.equal(building.state, 'building');

        const unmatched = fileEvidence(
          'not-a-false-no-match.png',
          sha256('not-a-false-no-match'),
        );
        const notReady = await preview(album, unmatched);
        assert.equal(notReady.decision.outcome, 'requires_review');
        assert.equal(notReady.decision.reason, 'filename_index_not_ready');
        assert.equal(notReady.candidatesTruncated, true);
        const deniedBody = reserveBody(unmatched, notReady, {
          kind: 'new_photo',
        });
        const beforeDenial = await albumState(album);
        await expectCode(
          await send(
            worker,
            'POST',
            '/api/v1/albums/' + album.id + '/resolved-uploads',
            deniedBody,
          ),
          409,
          'RESOLUTION_REVIEW_REQUIRED',
        );
        assert.deepEqual(await albumState(album), beforeDenial);

        const beforeRetry = await albumState(album);
        const retry = await send(
          worker,
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          originalBody,
        );
        const replayed = await readJson(retry);
        assert.equal(retry.status, 201, JSON.stringify(replayed));
        assert.deepEqual(replayed, original);
        assert.equal(replayed.uploadSession.id, original.uploadSession.id);
        assert.deepEqual(await albumState(album), beforeRetry);

        const ready = await advanceAll(album);
        assert.equal(ready.state, 'ready');
        await cancelUnissued(missing.id, legacyWorker);
        await cancelUnissued(original.uploadSession.id);
      },
    );

    await check(
      'Assisted mode keeps the legacy candidate list and every authorized target choice with indexed gate on or off',
      async () => {
        const project = await createProject('assisted', 'assisted-legacy');
        const album = await createAlbum(project, 'assisted-legacy');
        const firstBytes = await makePng(48, 24, '#337d91');
        const secondBytes = await makePng(48, 24, '#955c91');
        const firstFile = await imageEvidence('assisted-a.png', firstBytes);
        const secondFile = await imageEvidence('assisted-b.png', secondBytes);
        const firstPhoto = await completeOrdinary(
          project,
          album,
          firstFile,
          firstBytes,
        );
        const secondPhoto = await completeOrdinary(
          project,
          album,
          secondFile,
          secondBytes,
        );
        const incoming = fileEvidence(
          'assisted-a.png',
          sha256('assisted-new-content'),
        );
        const indexed = await preview(album, incoming, worker);
        const legacy = await preview(album, incoming, legacyWorker);
        assert.equal(indexed.mode, 'assisted');
        assert.equal(indexed.decision.outcome, 'requires_review');
        assert.equal(indexed.decision.reason, 'assisted_choice_required');
        assert.equal(indexed.candidatesTruncated, false);
        assert.deepEqual(indexed.decision, legacy.decision);
        assert.deepEqual(indexed.candidates, legacy.candidates);
        assert.deepEqual(
          new Set(indexed.candidates.map((candidate) => candidate.photoId)),
          new Set([firstPhoto.photoId, secondPhoto.photoId]),
        );

        const secondCandidate = indexed.candidates.find(
          (candidate) => candidate.photoId === secondPhoto.photoId,
        );
        assert.ok(secondCandidate?.currentVersionId);
        const body = reserveBody(incoming, indexed, {
          kind: 'new_version',
          photoId: secondCandidate.photoId,
          parentVersionId: secondCandidate.currentVersionId,
          expectedRevision: secondCandidate.revision,
        });
        const response = await send(
          worker,
          'POST',
          '/api/v1/albums/' + album.id + '/resolved-uploads',
          body,
        );
        const result = await readJson(response);
        assert.equal(response.status, 201, JSON.stringify(result));
        unissuedSessions.add(result.uploadSession.id);
        assert.equal(result.target.photoId, secondPhoto.photoId);
        await cancelUnissued(result.uploadSession.id);
      },
    );

    await check(
      '375px indexed resolved upload preserves new-photo/new-version UI and explains index gaps while default gates stay hidden',
      async () => {
        const enabled = await runResolvedUploadBrowserChecks({
          worker,
          base,
          ownerCookie,
          owner,
          db,
          storage,
          galleryFixture,
        });
        assert.equal(enabled.currentHeadPreserved, true);
        assert.equal(enabled.lostReservationReplayVerified, true);

        const review = await runIndexedVersionMatchingBrowserChecks({
          worker,
          legacyWorker,
          disabledWorker: defaultWorker,
          base,
          ownerCookie,
          owner,
          db,
          galleryFixture,
        });
        assert.deepEqual(review, {
          indexNotReadyReasonVisible: true,
          noReservationWhenIndexNotReady: true,
          gateOffPanelHidden: true,
          mobileOverflow: false,
        });
      },
    );

    await check(
      'indexed upload endpoints require the current enabled Owner and exact Origin before any write',
      async () => {
        const file = fileEvidence(
          'authority-check.png',
          sha256('authority-check'),
        );
        const before = await albumState(largeAlbum);
        const foreignUserId = randomUUID();
        const foreignWorkspaceId = randomUUID();
        const foreignProjectId = randomUUID();
        const foreignAlbumId = randomUUID();
        const now = Date.now();
        await db.batch([
          db
            .prepare(
              'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
            )
            .bind(
              foreignUserId,
              'Indexed matching foreign tenant',
              foreignUserId + '@indexed-matching.invalid',
              now,
              now,
            ),
          db
            .prepare(
              'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
            )
            .bind(
              foreignWorkspaceId,
              'Indexed matching foreign workspace',
              foreignUserId,
            ),
          db
            .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
            .bind(
              foreignProjectId,
              foreignWorkspaceId,
              'Indexed matching foreign project',
            ),
          db
            .prepare(
              "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
            )
            .bind(
              foreignAlbumId,
              foreignWorkspaceId,
              foreignProjectId,
              'Indexed matching foreign album',
            ),
        ]);
        const foreignSourceState = async () => ({
          sessions: await count(
            'SELECT count(*) AS n FROM upload_sessions WHERE album_id=?',
            foreignAlbumId,
          ),
          requests: await count(
            'SELECT count(*) AS n FROM upload_requests WHERE album_id=?',
            foreignAlbumId,
          ),
          indexRows: await count(
            'SELECT count(*) AS n FROM matching_filename_index WHERE album_id=?',
            foreignAlbumId,
          ),
          ordinaryCompletions: await count(
            'SELECT count(*) AS n FROM upload_completions WHERE album_id=?',
            foreignAlbumId,
          ),
          versionCompletions: await count(
            'SELECT count(*) AS n FROM upload_version_completions WHERE album_id=?',
            foreignAlbumId,
          ),
          auditEvents: await count(
            'SELECT count(*) AS n FROM audit_events WHERE album_id=?',
            foreignAlbumId,
          ),
          matchingChanges: await count(
            'SELECT count(*) AS n FROM album_matching_changes WHERE album_id=?',
            foreignAlbumId,
          ),
        });
        const ownPreview = await preview(largeAlbum, file);
        assert.equal(ownPreview.decision.outcome, 'new_photo');
        const foreignBefore = await foreignSourceState();
        const foreignPreview = await send(
          worker,
          'POST',
          '/api/v1/albums/' + foreignAlbumId + '/upload-resolution',
          { file },
        );
        await expectCode(foreignPreview, 404, 'NOT_FOUND');
        assert.deepEqual(await albumState(largeAlbum), before);
        assert.deepEqual(await foreignSourceState(), foreignBefore);

        const foreignReserveRequestId = randomUUID();
        const foreignReserve = await send(
          worker,
          'POST',
          '/api/v1/albums/' + foreignAlbumId + '/resolved-uploads',
          reserveBody(
            file,
            ownPreview,
            { kind: 'new_photo' },
            foreignReserveRequestId,
          ),
        );
        await expectCode(foreignReserve, 404, 'NOT_FOUND');
        assert.deepEqual(await albumState(largeAlbum), before);
        assert.deepEqual(await foreignSourceState(), foreignBefore);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
            owner,
            foreignReserveRequestId,
          ),
          0,
        );

        const noOrigin = await send(
          worker,
          'POST',
          '/api/v1/albums/' + largeAlbum.id + '/upload-resolution',
          { file },
          { Origin: undefined },
        );
        await expectCode(noOrigin, 403, 'FORBIDDEN_ORIGIN');

        await db
          .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
          .bind(owner)
          .run();
        try {
          const unauthenticated = await send(
            worker,
            'POST',
            '/api/v1/albums/' + largeAlbum.id + '/upload-resolution',
            { file },
          );
          await expectCode(unauthenticated, 403, 'OWNER_REQUIRED');
        } finally {
          await db
            .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
            .bind(owner)
            .run();
        }
        assert.deepEqual(await albumState(largeAlbum), before);
      },
    );
  } finally {
    await db.exec('DROP TRIGGER IF EXISTS fail_indexed_filename_reservation;');
    // Keep the 1,001-row fixture pending through all classification assertions,
    // then release every unresolved API reservation before later checks.
    for (const uploadSessionId of [...unissuedSessions]) {
      const row = await first(
        'SELECT status FROM upload_sessions WHERE id=?',
        uploadSessionId,
      );
      if (row?.status !== 'reserved') {
        unissuedSessions.delete(uploadSessionId);
        continue;
      }
      const completion = await first(
        'SELECT 1 AS found FROM upload_completions WHERE upload_session_id=? UNION ALL SELECT 1 AS found FROM upload_version_completions WHERE upload_session_id=? LIMIT 1',
        uploadSessionId,
        uploadSessionId,
      );
      if (completion) {
        unissuedSessions.delete(uploadSessionId);
        continue;
      }
      await cancelUnissued(uploadSessionId);
    }
  }
}
