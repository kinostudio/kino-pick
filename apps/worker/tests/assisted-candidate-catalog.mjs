import assert from 'node:assert/strict';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { runAssistedCandidateCatalogBrowserChecks } from './assisted-candidate-catalog-browser.mjs';

const PROFILE = 'default-v1';
const PAGE_SIZE = 24;
const LARGE_PHOTO_COUNT = 1001;
const FINAL_PHOTO_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
const CURSOR_PREFIX = 'kino-pic:assisted-candidate-catalog:v1:';
const RESERVED_UPLOAD_BYTES = 1;
const SMALL_DIMENSIONS = { width: 1, height: 1 };

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function ownerCookieHeader(value) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/u.exec(value);
  const token = match?.[1] ?? value;
  assert.ok(token, 'A current Owner cookie is required');
  return 'kino-owner.session_token=' + token;
}

async function bodyOf(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function cursorClaims(token, authSecret) {
  assert.equal(typeof token, 'string');
  const parts = token.split('.');
  assert.equal(parts.length, 2, 'Cursor must contain payload and signature');
  const [payload, signature] = parts;
  assert.ok(payload && signature);
  assert.equal(
    Buffer.from(payload, 'base64url').toString('base64url'),
    payload,
  );
  assert.equal(
    Buffer.from(signature, 'base64url').toString('base64url'),
    signature,
  );
  const expected = createHmac('sha256', authSecret)
    .update(CURSOR_PREFIX + payload, 'utf8')
    .digest();
  const actual = Buffer.from(signature, 'base64url');
  assert.equal(actual.byteLength, expected.byteLength);
  assert.equal(timingSafeEqual(actual, expected), true, 'Worker cursor HMAC');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function signCursor(claims, authSecret) {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', authSecret)
    .update(CURSOR_PREFIX + payload, 'utf8')
    .digest('base64url');
  return payload + '.' + signature;
}

function expectCursorClaims(claims, { owner, sessionId, scope }) {
  assert.deepEqual(Object.keys(claims), [
    'version',
    'purpose',
    'ownerId',
    'sessionId',
    'workspaceId',
    'projectId',
    'albumId',
    'projectRevision',
    'albumRevision',
    'changeSequence',
    'profile',
    'catalogId',
    'afterPhotoId',
    'issuedAt',
    'expiresAt',
  ]);
  assert.equal(claims.version, 1);
  assert.equal(claims.purpose, 'assisted_catalog_v1');
  assert.equal(claims.ownerId, owner);
  assert.equal(claims.sessionId, sessionId);
  assert.equal(claims.workspaceId, scope.workspaceId);
  assert.equal(claims.projectId, scope.projectId);
  assert.equal(claims.albumId, scope.albumId);
  assert.equal(claims.profile, PROFILE);
  assert.match(claims.catalogId, /^[0-9a-f-]{36}$/u);
  assert.equal(claims.projectRevision, scope.projectRevision);
  assert.equal(claims.albumRevision, scope.albumRevision);
  assert.equal(claims.changeSequence, scope.changeSequence);
  assert.equal(claims.afterPhotoId, null);
  assert.equal(claims.expiresAt, claims.issuedAt + 900);
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.issuedAt <= now && claims.issuedAt >= now - 30);
  assert.ok(claims.expiresAt > now);
}

function validatePage(page, scope) {
  assert.deepEqual(Object.keys(page).sort(), [
    'albumId',
    'albumRevision',
    'changeSequence',
    'items',
    'nextCursor',
    'projectId',
    'projectRevision',
    'workspaceId',
  ]);
  assert.equal(page.workspaceId, scope.workspaceId);
  assert.equal(page.projectId, scope.projectId);
  assert.equal(page.albumId, scope.albumId);
  assert.equal(page.projectRevision, scope.projectRevision);
  assert.equal(page.albumRevision, scope.albumRevision);
  assert.equal(page.changeSequence, scope.changeSequence);
  assert.ok(Array.isArray(page.items));
  assert.ok(page.items.length <= PAGE_SIZE);
  assert.ok(page.nextCursor === null || typeof page.nextCursor === 'string');
  for (const item of page.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      'currentVersionId',
      'filename',
      'photoId',
      'revision',
    ]);
    assert.match(item.photoId, /^[0-9a-f-]{36}$/u);
    assert.ok(item.filename.length > 0);
    assert.match(item.currentVersionId, /^[0-9a-f-]{36}$/u);
    assert.ok(Number.isSafeInteger(item.revision) && item.revision >= 0);
  }
}

export async function runAssistedCandidateCatalogChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
  authSecret,
}) {
  assert.ok(db && mf && check && owner && base && cookies && request);
  assert.ok(
    typeof authSecret === 'string' &&
      Buffer.byteLength(authSecret, 'utf8') >= 32,
    'The synthetic test Worker HMAC secret is required',
  );
  const workspaceId = galleryFixture?.context?.workspace?.id;
  assert.ok(workspaceId, 'Reuse the full-suite gallery workspace');
  const worker = await mf.getWorker('assisted-candidate-catalog-test');
  const legacyWorker = await mf.getWorker('resolved-uploads-test');
  const defaultWorker = await mf.getWorker('app');
  const cookie = ownerCookieHeader(cookies.headers());
  const ownerHeaders = {
    Accept: 'application/json',
    Cookie: cookie,
    Origin: new URL(base).origin,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
  };
  const unissuedSessions = new Set();
  let scope = null;
  let initialPreview = null;
  let initialCursor = null;
  let allItems = [];
  let pages = [];
  let addedVersion = null;
  let lastCandidate = null;
  let browserResult = null;

  const send = (target, method, path, body, overrides = {}) => {
    const headers = { ...ownerHeaders, ...overrides };
    for (const [name, value] of Object.entries(headers))
      if (value === undefined) delete headers[name];
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return target.fetch(new Request(new URL(path, base), init));
  };
  const expectCode = async (response, status, code) => {
    const wrapped =
      response !== null &&
      typeof response === 'object' &&
      Object.hasOwn(response, 'response');
    const actual = response?.response ?? response;
    const body = wrapped ? response.body : await bodyOf(actual);
    assert.equal(actual.status, status, JSON.stringify(body));
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
  const auditActionCounts = async (albumId) => {
    const result = await db
      .prepare(
        'SELECT action,count(*) AS n FROM audit_events WHERE album_id=? GROUP BY action ORDER BY action',
      )
      .bind(albumId)
      .all();
    return Object.fromEntries(
      result.results.map((row) => [row.action, Number(row.n)]),
    );
  };
  const scopePath = (album = scope?.album) =>
    '/api/v1/albums/' + encodeURIComponent(album.id);
  const previewFile = () => ({
    originalFilename: 'assisted-new-retouch-source.png',
    expectedBytes: RESERVED_UPLOAD_BYTES,
    contentType: 'image/png',
    sha256: sha256('assisted-catalog-distinct-preview-content'),
    dimensions: { width: 48, height: 24 },
  });
  const readPreview = async (
    target = worker,
    album = scope.album,
    file = previewFile(),
  ) => {
    const response = await send(
      target,
      'POST',
      scopePath(album) + '/upload-resolution',
      { file },
    );
    const body = await bodyOf(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const postPage = async (
    target,
    album,
    cursor,
    overrides = {},
    query = undefined,
  ) => {
    const path =
      scopePath(album) +
      '/upload-candidates' +
      (query === undefined
        ? '?' + new URLSearchParams({ cursor }).toString()
        : query);
    const response = await send(target, 'GET', path, undefined, overrides);
    return { response, body: await bodyOf(response) };
  };
  const createAssistedScope = async (label, projectId = null) => {
    let project;
    if (projectId) {
      const current = await send(
        worker,
        'GET',
        '/api/v1/projects/' + encodeURIComponent(projectId) + '/versioning',
      );
      const currentBody = await bodyOf(current);
      assert.equal(current.status, 200, JSON.stringify(currentBody));
      project = { id: projectId, workspaceId, revision: currentBody.revision };
      if (currentBody.mode !== 'assisted') {
        const changed = await send(
          worker,
          'PUT',
          '/api/v1/projects/' + encodeURIComponent(projectId) + '/versioning',
          {
            requestId: randomUUID(),
            expectedRevision: currentBody.revision,
            mode: 'assisted',
            confirm: true,
          },
        );
        const changedBody = await bodyOf(changed);
        assert.equal(changed.status, 200, JSON.stringify(changedBody));
        project.revision = changedBody.revision;
      }
    } else {
      const created = await send(worker, 'POST', '/api/v1/projects', {
        requestId: randomUUID(),
        workspaceId,
        name: 'Assisted catalog ' + label + ' ' + randomUUID(),
      });
      const createdBody = await bodyOf(created);
      assert.equal(created.status, 201, JSON.stringify(createdBody));
      project = createdBody.project;
      const current = await send(
        worker,
        'GET',
        '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning',
      );
      const currentBody = await bodyOf(current);
      assert.equal(current.status, 200, JSON.stringify(currentBody));
      const changed = await send(
        worker,
        'PUT',
        '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning',
        {
          requestId: randomUUID(),
          expectedRevision: currentBody.revision,
          mode: 'assisted',
          confirm: true,
        },
      );
      const changedBody = await bodyOf(changed);
      assert.equal(changed.status, 200, JSON.stringify(changedBody));
      assert.equal(changedBody.mode, 'assisted');
      project = { ...project, revision: changedBody.revision };
    }
    const albumResponse = await send(
      worker,
      'POST',
      '/api/v1/projects/' + encodeURIComponent(project.id) + '/albums',
      {
        requestId: randomUUID(),
        name: 'Assisted catalog album ' + label + ' ' + randomUUID(),
      },
    );
    const albumBody = await bodyOf(albumResponse);
    assert.equal(albumResponse.status, 201, JSON.stringify(albumBody));
    return { project, album: albumBody.album };
  };
  const sessionId = async () => {
    const row = await first(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? ORDER BY expiresAt DESC,id DESC LIMIT 1',
      owner,
      Date.now(),
    );
    assert.ok(row?.id, 'A current Owner session is required');
    return row.id;
  };
  const readWriteState = async (albumId) => ({
    uploadRequests: await count(
      'SELECT count(*) AS n FROM upload_requests WHERE album_id=?',
      albumId,
    ),
    uploadSessions: await count(
      'SELECT count(*) AS n FROM upload_sessions WHERE album_id=?',
      albumId,
    ),
    uploadsReserved: await count(
      "SELECT count(*) AS n FROM upload_sessions WHERE album_id=? AND status='reserved'",
      albumId,
    ),
    auditEvents: await count(
      'SELECT count(*) AS n FROM audit_events WHERE album_id=?',
      albumId,
    ),
    auditActions: await auditActionCounts(albumId),
    retentionEvents: await count(
      "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action LIKE 'retention.%'",
      albumId,
    ),
    matchingSequence: await count(
      'SELECT COALESCE(MAX(sequence),0) AS n FROM album_matching_changes WHERE album_id=?',
      albumId,
    ),
    matchingEvents: await count(
      'SELECT count(*) AS n FROM album_matching_changes WHERE album_id=?',
      albumId,
    ),
    logicalPhotos: await count(
      'SELECT count(*) AS n FROM photos WHERE album_id=?',
      albumId,
    ),
    immutableVersions: await count(
      'SELECT count(*) AS n FROM photo_versions v JOIN photos p ON p.id=v.photo_id WHERE p.album_id=?',
      albumId,
    ),
    currentHeads: await count(
      'SELECT count(*) AS n FROM photo_version_heads WHERE album_id=?',
      albumId,
    ),
    indexedSources: await count(
      'SELECT count(*) AS n FROM matching_filename_index WHERE album_id=? AND profile=?',
      albumId,
      PROFILE,
    ),
    usage: await first(
      'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
      workspaceId,
    ),
  });
  const makeOrdinaryMetadataRows = async ({
    album,
    project,
    currentSessionId,
    count: sourceCount,
    startIndex = 0,
  }) => {
    const rowsPerBatch = 24;
    for (
      let batchStart = 0;
      batchStart < sourceCount;
      batchStart += rowsPerBatch
    ) {
      const statements = [];
      const end = Math.min(batchStart + rowsPerBatch, sourceCount);
      for (let offset = batchStart; offset < end; offset++) {
        const index = startIndex + offset;
        const photoId =
          index === LARGE_PHOTO_COUNT - 1 ? FINAL_PHOTO_ID : randomUUID();
        const uploadSessionId = randomUUID();
        const versionId = randomUUID();
        const assetId = randomUUID();
        const initRequestId = randomUUID();
        const authorizeRequestId = randomUUID();
        const completeRequestId = randomUUID();
        const filename =
          index === LARGE_PHOTO_COUNT - 1
            ? 'outside-filename-final-page.png'
            : 'assisted-catalog-' + String(index).padStart(5, '0') + '.png';
        const contentHash = sha256('assisted-catalog-metadata:' + photoId);
        const now = Date.now();
        const objectKey =
          workspaceId +
          '/' +
          project.id +
          '/' +
          album.id +
          '/' +
          uploadSessionId +
          '/original';
        const payloadJson = JSON.stringify({
          workspaceId,
          projectId: project.id,
          albumId: album.id,
          originalFilename: filename,
          expectedBytes: RESERVED_UPLOAD_BYTES,
          contentType: 'image/png',
          sha256: contentHash,
        });
        const workflowPayload = JSON.stringify({ uploadSessionId });
        statements.push(
          db
            .prepare(
              'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              owner,
              initRequestId,
              'upload.reserved',
              payloadJson,
              currentSessionId,
              uploadSessionId,
              workspaceId,
              project.id,
              album.id,
              'primary',
              objectKey,
              filename,
              RESERVED_UPLOAD_BYTES,
              now,
            ),
        );
        statements.push(
          db
            .prepare(
              'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              owner,
              authorizeRequestId,
              'upload.authorized',
              workflowPayload,
              currentSessionId,
              uploadSessionId,
              now,
              now,
              now + 600000,
              'image/png',
              contentHash,
            ),
        );
        statements.push(
          db
            .prepare(
              'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,content_type,sha256_hex,actual_bytes,photo_id,version_id,asset_id,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              owner,
              completeRequestId,
              'upload.completed',
              workflowPayload,
              currentSessionId,
              uploadSessionId,
              now,
              'image/png',
              contentHash,
              RESERVED_UPLOAD_BYTES,
              photoId,
              versionId,
              assetId,
              SMALL_DIMENSIONS.width,
              SMALL_DIMENSIONS.height,
            ),
        );
      }
      const results = await db.batch(statements);
      assert.equal(results.length, statements.length);
      for (const result of results)
        assert.equal(result.success, true, JSON.stringify(result));
    }
  };
  const indexAllSources = async (album) => {
    let statusResponse = await send(
      worker,
      'GET',
      scopePath(album) + '/matching-filename-index',
    );
    let status = await bodyOf(statusResponse);
    assert.equal(statusResponse.status, 200, JSON.stringify(status));
    let advances = 0;
    while (status.missingSessions > 0 && advances < 100) {
      const advance = await send(
        worker,
        'POST',
        scopePath(album) + '/matching-filename-index',
        {},
      );
      const advanceBody = await bodyOf(advance);
      assert.equal(advance.status, 200, JSON.stringify(advanceBody));
      statusResponse = await send(
        worker,
        'GET',
        scopePath(album) + '/matching-filename-index',
      );
      status = await bodyOf(statusResponse);
      assert.equal(statusResponse.status, 200, JSON.stringify(status));
      advances++;
    }
    assert.ok(advances < 100, 'Index maintenance must make bounded progress');
    assert.equal(status.state, 'ready', JSON.stringify(status));
    assert.equal(status.missingSessions, 0);
    assert.equal(status.invalidSessions, 0);
    assert.equal(status.unlinkedVersions, 0);
    assert.equal(status.unreadyPhotos, 0);
    return status;
  };
  const createOtherTenantAlbum = async () => {
    const otherOwner = randomUUID();
    const otherWorkspace = randomUUID();
    const otherProject = randomUUID();
    const otherAlbum = randomUUID();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(
        otherOwner,
        'Catalog isolated Owner',
        'catalog-' + otherOwner + '@example.invalid',
        now,
        now,
      )
      .run();
    await db
      .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
      .bind(otherWorkspace, 'Catalog isolated workspace', otherOwner)
      .run();
    await db
      .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
      .bind(otherProject, otherWorkspace, 'Catalog isolated project')
      .run();
    await db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(otherAlbum, otherWorkspace, otherProject, 'Catalog isolated album')
      .run();
    return {
      otherOwner,
      workspaceId: otherWorkspace,
      projectId: otherProject,
      albumId: otherAlbum,
    };
  };
  const setProjectMode = async (project, mode) => {
    const path =
      '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning';
    const current = await send(worker, 'GET', path);
    const currentBody = await bodyOf(current);
    assert.equal(current.status, 200, JSON.stringify(currentBody));
    const changed = await send(worker, 'PUT', path, {
      requestId: randomUUID(),
      expectedRevision: currentBody.revision,
      mode,
      confirm: true,
    });
    const changedBody = await bodyOf(changed);
    assert.equal(changed.status, 200, JSON.stringify(changedBody));
    assert.equal(changedBody.mode, mode);
    return changedBody;
  };
  const createCursorPage = async (album, cursor, expectedScope) => {
    const { response, body } = await postPage(worker, album, cursor);
    assert.equal(response.status, 200, JSON.stringify(body));
    validatePage(body, expectedScope);
    return body;
  };
  const newVersionReservationBody = (file, snapshot, candidate) => ({
    requestId: randomUUID(),
    file,
    expectedChangeSequence: snapshot.changeSequence,
    expectedProjectRevision: snapshot.projectRevision,
    expectedMode: snapshot.mode,
    choice: {
      kind: 'new_version',
      photoId: candidate.photoId,
      parentVersionId: candidate.currentVersionId,
      expectedRevision: candidate.revision,
    },
    confirm: true,
  });
  const cancelUnissued = async (uploadSessionId) => {
    if (!unissuedSessions.has(uploadSessionId)) return;
    const response = await send(
      worker,
      'POST',
      '/api/v1/uploads/' + encodeURIComponent(uploadSessionId) + '/cancel',
      { requestId: randomUUID() },
    );
    const body = await bodyOf(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    unissuedSessions.delete(uploadSessionId);
  };

  try {
    await check(
      'Assisted catalog builds over 1,000 guarded logical photos and more than 1,000 immutable versions in the existing workspace',
      async () => {
        const created = await createAssistedScope('large');
        scope = { ...created, workspaceId };
        await makeOrdinaryMetadataRows({
          album: scope.album,
          project: scope.project,
          currentSessionId: await sessionId(),
          count: LARGE_PHOTO_COUNT,
        });
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM photos WHERE album_id=?',
            scope.album.id,
          ),
          LARGE_PHOTO_COUNT,
        );
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM photo_versions v JOIN photos p ON p.id=v.photo_id WHERE p.album_id=?',
            scope.album.id,
          ),
          LARGE_PHOTO_COUNT,
        );
        assert.deepEqual(
          await first(
            'SELECT id FROM photos WHERE album_id=? AND id=?',
            scope.album.id,
            FINAL_PHOTO_ID,
          ),
          { id: FINAL_PHOTO_ID },
        );
        addedVersion = await appendAuthorizedVersionFixture({
          db,
          owner,
          photoId: FINAL_PHOTO_ID,
          sha256: sha256('assisted-catalog-authorized-v2'),
          byteSize: 1,
          mime: 'image/png',
          width: SMALL_DIMENSIONS.width,
          height: SMALL_DIMENSIONS.height,
        });
        assert.ok(addedVersion.version_id);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM photo_versions v JOIN photos p ON p.id=v.photo_id WHERE p.album_id=?',
            scope.album.id,
          ),
          LARGE_PHOTO_COUNT + 1,
        );
        await indexAllSources(scope.album);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM photo_version_heads WHERE album_id=?',
            scope.album.id,
          ),
          LARGE_PHOTO_COUNT,
        );
      },
    );

    await check(
      'Assisted catalog traverses every eligible logical photo in 24-row BINARY keyset pages without read-side writes or public hashes',
      async () => {
        initialPreview = await readPreview();
        assert.equal(initialPreview.mode, 'assisted');
        assert.equal(initialPreview.albumId, scope.album.id);
        assert.equal(initialPreview.projectId, scope.project.id);
        assert.ok(initialPreview.catalogCursor);
        assert.equal(
          initialPreview.candidates.some(
            (candidate) => candidate.photoId === FINAL_PHOTO_ID,
          ),
          false,
          'The final photo must be outside the legacy preview candidates',
        );
        const firstScope = {
          workspaceId: initialPreview.workspaceId,
          projectId: initialPreview.projectId,
          albumId: initialPreview.albumId,
          projectRevision: initialPreview.projectRevision,
          albumRevision: scope.album.revision,
          changeSequence: initialPreview.changeSequence,
        };
        initialCursor = initialPreview.catalogCursor;
        expectCursorClaims(cursorClaims(initialCursor, authSecret), {
          owner,
          sessionId: await sessionId(),
          scope: firstScope,
        });

        const beforeReads = await readWriteState(scope.album.id);
        let cursor = initialCursor;
        const seen = new Set();
        pages = [];
        while (cursor !== null) {
          const page = await createCursorPage(scope.album, cursor, firstScope);
          pages.push(page);
          for (const item of page.items) {
            assert.equal(seen.has(item.photoId), false);
            seen.add(item.photoId);
          }
          cursor = page.nextCursor;
        }
        allItems = pages.flatMap((page) => page.items);
        assert.equal(pages.length, Math.ceil(LARGE_PHOTO_COUNT / PAGE_SIZE));
        assert.equal(seen.size, LARGE_PHOTO_COUNT);
        assert.equal(allItems.length, LARGE_PHOTO_COUNT);
        const expectedIds = (
          await db
            .prepare(
              'SELECT id FROM photos WHERE album_id=? ORDER BY id COLLATE BINARY',
            )
            .bind(scope.album.id)
            .all()
        ).results.map((row) => row.id);
        assert.deepEqual(
          allItems.map((item) => item.photoId),
          expectedIds,
        );
        assert.equal(expectedIds.at(-1), FINAL_PHOTO_ID);
        assert.equal(allItems.at(-1)?.photoId, FINAL_PHOTO_ID);
        lastCandidate = allItems.at(-1);
        assert.ok(lastCandidate);
        assert.equal(lastCandidate.filename, 'outside-filename-final-page.png');
        const head = await first(
          'SELECT version_id FROM photo_version_heads WHERE photo_id=?',
          FINAL_PHOTO_ID,
        );
        assert.equal(lastCandidate.currentVersionId, head.version_id);
        assert.equal(lastCandidate.revision, 0);
        assert.equal(JSON.stringify(pages).includes(authSecret), false);
        assert.deepEqual(await readWriteState(scope.album.id), beforeReads);
        const firstPage = pages[0];
        assert.ok(firstPage);
        const nextClaims = cursorClaims(firstPage.nextCursor, authSecret);
        assert.equal(nextClaims.afterPhotoId, firstPage.items.at(-1)?.photoId);
      },
    );

    await check(
      'Assisted catalog enforces expected Owner, exact cursor query, HMAC, current session, scope and 15-minute expiry',
      async () => {
        const validToken = initialCursor;
        const endpoint = scopePath() + '/upload-candidates';
        const before = await readWriteState(scope.album.id);
        await expectCode(
          await send(worker, 'GET', endpoint),
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          await postPage(worker, scope.album, validToken, {}, '?cursor='),
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          await postPage(
            worker,
            scope.album,
            validToken,
            {},
            '?cursor=' + encodeURIComponent(validToken) + '&extra=1',
          ),
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          await postPage(
            worker,
            scope.album,
            validToken,
            {},
            '?cursor=' +
              encodeURIComponent(validToken) +
              '&cursor=' +
              encodeURIComponent(validToken),
          ),
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          await postPage(
            worker,
            scope.album,
            validToken,
            {},
            '?cursor=not-a-valid-cursor',
          ),
          400,
          'INVALID_INPUT',
        );
        const [payload, signature] = validToken.split('.');
        assert.ok(payload && signature);
        const damaged =
          payload +
          '.' +
          (signature[0] === 'A' ? 'B' : 'A') +
          signature.slice(1);
        await expectCode(
          await postPage(worker, scope.album, damaged),
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          await postPage(worker, scope.album, validToken, {
            'X-Kino-Expected-Actor': undefined,
          }),
          403,
          'RESOLUTION_CATALOG_OWNER_CHANGED',
        );
        await expectCode(
          await postPage(worker, scope.album, validToken, {
            'X-Kino-Expected-Actor': randomUUID(),
          }),
          403,
          'RESOLUTION_CATALOG_OWNER_CHANGED',
        );
        const firstScope = {
          workspaceId,
          projectId: initialPreview.projectId,
          albumId: initialPreview.albumId,
          projectRevision: initialPreview.projectRevision,
          albumRevision: scope.album.revision,
          changeSequence: initialPreview.changeSequence,
        };
        const noOriginRead = await postPage(worker, scope.album, validToken, {
          Origin: undefined,
        });
        assert.equal(
          noOriginRead.response.status,
          200,
          JSON.stringify(noOriginRead.body),
        );
        validatePage(noOriginRead.body, firstScope);
        assert.deepEqual(await readWriteState(scope.album.id), before);

        const claims = cursorClaims(validToken, authSecret);
        await expectCode(
          await postPage(
            worker,
            scope.album,
            signCursor({ ...claims, ownerId: randomUUID() }, authSecret),
          ),
          403,
          'RESOLUTION_CATALOG_OWNER_CHANGED',
        );
        await expectCode(
          await postPage(
            worker,
            scope.album,
            signCursor(
              { ...claims, sessionId: 'different-current-owner-session' },
              authSecret,
            ),
          ),
          409,
          'RESOLUTION_CATALOG_STALE',
        );
        const otherOwned = await createAssistedScope(
          'other-owned',
          scope.project.id,
        );
        await expectCode(
          await postPage(worker, otherOwned.album, validToken),
          409,
          'RESOLUTION_CATALOG_STALE',
        );
        const foreign = await createOtherTenantAlbum();
        const foreignIssuedAt = Math.floor(Date.now() / 1000);
        const foreignCursor = signCursor(
          {
            version: 1,
            purpose: 'assisted_catalog_v1',
            ownerId: owner,
            sessionId: await sessionId(),
            workspaceId: foreign.workspaceId,
            projectId: foreign.projectId,
            albumId: foreign.albumId,
            projectRevision: 1,
            albumRevision: 1,
            changeSequence: 0,
            profile: PROFILE,
            catalogId: randomUUID(),
            afterPhotoId: null,
            issuedAt: foreignIssuedAt,
            expiresAt: foreignIssuedAt + 900,
          },
          authSecret,
        );
        await expectCode(
          await postPage(worker, { id: foreign.albumId }, foreignCursor),
          404,
          'NOT_FOUND',
        );

        const now = Math.floor(Date.now() / 1000);
        const expiredIssue = now - 960;
        const expiredClaims = {
          ...claims,
          issuedAt: expiredIssue,
          expiresAt: expiredIssue + 900,
        };
        await expectCode(
          await postPage(
            worker,
            scope.album,
            signCursor(expiredClaims, authSecret),
          ),
          409,
          'RESOLUTION_CATALOG_STALE',
        );

        const modeStale = await setProjectMode(scope.project, 'auto_filename');
        assert.ok(modeStale.revision > claims.projectRevision);
        await expectCode(
          await postPage(worker, scope.album, validToken),
          409,
          'RESOLUTION_CATALOG_STALE',
        );
        await setProjectMode(scope.project, 'assisted');
        assert.deepEqual(await readWriteState(scope.album.id), {
          ...before,
          matchingSequence: before.matchingSequence,
        });
      },
    );

    await check(
      'Chosen current head is reauthorized from the final page and exact replay precedes fresh catalog validation',
      async () => {
        const preview = await readPreview();
        const candidate = lastCandidate;
        assert.ok(preview.catalogCursor && candidate);
        assert.equal(
          preview.candidates.some(
            (entry) => entry.photoId === candidate.photoId,
          ),
          false,
        );
        assert.notEqual(candidate.filename, previewFile().originalFilename);
        const reserveBody = newVersionReservationBody(
          previewFile(),
          preview,
          candidate,
        );
        const response = await send(
          worker,
          'POST',
          scopePath() + '/resolved-uploads',
          reserveBody,
        );
        const body = await bodyOf(response);
        assert.equal(response.status, 201, JSON.stringify(body));
        assert.equal(body.target.kind, 'new_version');
        assert.equal(body.target.photoId, candidate.photoId);
        assert.equal(body.target.parentVersionId, candidate.currentVersionId);
        assert.equal(body.target.expectedRevision, candidate.revision);
        assert.equal(body.target.capturedVersioningMode, 'assisted');
        assert.equal(body.target.changeType, 'new_retouch');
        unissuedSessions.add(body.uploadSession.id);

        const moved = await setProjectMode(scope.project, 'auto_filename');
        const replay = await send(
          worker,
          'POST',
          scopePath() + '/resolved-uploads',
          reserveBody,
        );
        const replayBody = await bodyOf(replay);
        assert.equal(replay.status, 201, JSON.stringify(replayBody));
        assert.deepEqual(replayBody, body);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
            owner,
            reserveBody.requestId,
          ),
          1,
        );
        assert.ok(moved.revision > preview.projectRevision);
        await cancelUnissued(body.uploadSession.id);
        await setProjectMode(scope.project, 'assisted');
      },
    );

    await check(
      'Assisted catalog preserves 375px paging, selection visibility, confirmation and lost-response exact UUID recovery',
      async () => {
        const currentBrowserHead = await first(
          'SELECT version_id FROM photo_version_heads WHERE photo_id=?',
          FINAL_PHOTO_ID,
        );
        assert.ok(currentBrowserHead?.version_id);
        browserResult = await runAssistedCandidateCatalogBrowserChecks({
          worker,
          legacyWorker,
          defaultWorker,
          base,
          ownerCookie: cookies.headers(),
          owner,
          db,
          storage: galleryFixture.storage,
          fixture: {
            ...scope,
            finalPhotoId: FINAL_PHOTO_ID,
            finalFilename: 'outside-filename-final-page.png',
            currentVersionId: currentBrowserHead.version_id,
          },
        });
        assert.equal(browserResult.mobileOverflow, false);
        assert.equal(browserResult.selectedHeadVisibleWhilePaging, true);
        assert.equal(browserResult.confirmationCaptured, true);
        assert.equal(browserResult.lostReservationReplayVerified, true);
        assert.equal(browserResult.signedBrowserR2Puts, 1);
        assert.equal(browserResult.processedVersionStatus, 'succeeded');
        assert.match(browserResult.processedVersionId, /^[0-9a-f-]{36}$/u);
        assert.match(
          browserResult.mobileScreenshotPath,
          /assisted-candidate-catalog-mobile\.png$/u,
        );
        await indexAllSources(scope.album);
      },
    );

    await check(
      'Assisted catalog and reserve reject changed head or sequence before creating a new reservation',
      async () => {
        assert.ok(browserResult?.processedVersionId);
        await indexAllSources(scope.album);
        const stalePreview = await readPreview();
        assert.ok(stalePreview.catalogCursor);
        const currentHead = await first(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
          FINAL_PHOTO_ID,
        );
        assert.ok(currentHead?.version_id);
        assert.notEqual(
          currentHead.version_id,
          browserResult.processedVersionId,
        );
        const changedHead = await send(
          worker,
          'POST',
          '/api/v1/photos/' +
            encodeURIComponent(FINAL_PHOTO_ID) +
            '/versions/set-current',
          {
            requestId: randomUUID(),
            expectedRevision: Number(currentHead.revision),
            expectedCurrentVersionId: currentHead.version_id,
            versionId: browserResult.processedVersionId,
            confirm: true,
          },
        );
        const changed = await bodyOf(changedHead);
        assert.equal(changedHead.status, 200, JSON.stringify(changed));
        assert.equal(
          changed.current.versionId,
          browserResult.processedVersionId,
        );
        assert.equal(
          changed.current.revision,
          Number(currentHead.revision) + 1,
        );
        const changedPreview = await readPreview();
        const beforeDenied = await readWriteState(scope.album.id);
        const staleChoice = newVersionReservationBody(
          previewFile(),
          stalePreview,
          lastCandidate,
        );
        await expectCode(
          await send(
            worker,
            'POST',
            scopePath() + '/resolved-uploads',
            staleChoice,
          ),
          409,
          'RESOLUTION_STALE',
        );
        assert.deepEqual(await readWriteState(scope.album.id), beforeDenied);
        await expectCode(
          await postPage(worker, scope.album, stalePreview.catalogCursor),
          409,
          'RESOLUTION_CATALOG_STALE',
        );
        const pageScope = {
          workspaceId,
          projectId: scope.project.id,
          albumId: scope.album.id,
          projectRevision: changedPreview.projectRevision,
          albumRevision: scope.album.revision,
          changeSequence: changedPreview.changeSequence,
        };
        const currentPage = await createCursorPage(
          scope.album,
          changedPreview.catalogCursor,
          pageScope,
        );
        assert.ok(currentPage.items.length > 0);

        const beforeSequence = await readWriteState(scope.album.id);
        await makeOrdinaryMetadataRows({
          album: scope.album,
          project: scope.project,
          currentSessionId: await sessionId(),
          count: 1,
          startIndex: LARGE_PHOTO_COUNT,
        });
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM photos WHERE album_id=?',
            scope.album.id,
          ),
          LARGE_PHOTO_COUNT + 1,
        );
        await indexAllSources(scope.album);
        const sequenceFixtureState = await readWriteState(scope.album.id);
        const auditActionsBefore = beforeSequence.auditActions;
        const auditActionsAfter = sequenceFixtureState.auditActions;
        const auditActionDelta = {};
        for (const action of new Set([
          ...Object.keys(auditActionsBefore),
          ...Object.keys(auditActionsAfter),
        ])) {
          const delta =
            (auditActionsAfter[action] ?? 0) -
            (auditActionsBefore[action] ?? 0);
          if (delta !== 0) auditActionDelta[action] = delta;
        }
        process.stdout.write(
          'Assisted sequence fixture audit-action deltas: ' +
            JSON.stringify(auditActionDelta) +
            '\n',
        );
        assert.deepEqual(auditActionDelta, {
          'processing.enqueued': 1,
          'upload.authorized': 1,
          'upload.completed': 1,
          'upload.reserved': 1,
        });
        assert.equal(
          sequenceFixtureState.auditEvents,
          beforeSequence.auditEvents + 4,
        );
        await expectCode(
          await postPage(worker, scope.album, changedPreview.catalogCursor),
          409,
          'RESOLUTION_CATALOG_STALE',
        );
        const staleSequenceBody = newVersionReservationBody(
          previewFile(),
          changedPreview,
          {
            ...lastCandidate,
            currentVersionId: changed.current.versionId,
            revision: changed.current.revision,
          },
        );
        await expectCode(
          await send(
            worker,
            'POST',
            scopePath() + '/resolved-uploads',
            staleSequenceBody,
          ),
          409,
          'RESOLUTION_STALE',
        );
        const afterDenied = await readWriteState(scope.album.id);
        assert.equal(
          sequenceFixtureState.uploadRequests,
          beforeSequence.uploadRequests + 1,
        );
        assert.equal(
          sequenceFixtureState.uploadSessions,
          beforeSequence.uploadSessions + 1,
        );
        assert.ok(
          sequenceFixtureState.matchingSequence >
            beforeSequence.matchingSequence,
        );
        assert.deepEqual(afterDenied, sequenceFixtureState);
        assert.equal(
          afterDenied.uploadRequests,
          beforeSequence.uploadRequests + 1,
        );
        assert.equal(
          afterDenied.uploadSessions,
          beforeSequence.uploadSessions + 1,
        );
        assert.equal(
          afterDenied.uploadsReserved,
          sequenceFixtureState.uploadsReserved,
        );
        assert.ok(
          afterDenied.matchingSequence > beforeSequence.matchingSequence,
        );
      },
    );

    await check(
      'Catalog gate OFF preserves the existing bounded Assisted preview and default Worker remains OFF',
      async () => {
        const currentPreview = await readPreview(worker);
        assert.ok(currentPreview.catalogCursor);
        const legacy = await readPreview(legacyWorker);
        assert.equal(legacy.mode, 'assisted');
        assert.equal(Object.hasOwn(legacy, 'catalogCursor'), false);
        assert.equal(legacy.candidates.length, 1000);
        assert.equal(legacy.candidatesTruncated, true);
        await expectCode(
          await postPage(
            legacyWorker,
            scope.album,
            currentPreview.catalogCursor,
          ),
          403,
          'RESOLUTION_CATALOG_DISABLED',
        );
        const capabilities = await send(
          defaultWorker,
          'GET',
          '/api/v1/upload-resolution/capabilities',
        );
        const body = await bodyOf(capabilities);
        assert.equal(capabilities.status, 200, JSON.stringify(body));
        assert.deepEqual(body, { enabled: false });
      },
    );
  } finally {
    for (const uploadSessionId of [...unissuedSessions]) {
      try {
        await cancelUnissued(uploadSessionId);
      } catch {
        // Keep the triggering failure visible; the runner inspects residual holds.
      }
    }
  }
}
