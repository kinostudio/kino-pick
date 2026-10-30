import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runMatchingFilenameIndexBrowserChecks } from './matching-filename-index-browser.mjs';

const PROFILE = 'default-v1';
const MAX_BATCH = 24;

async function bodyOf(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function statusShape(status, scope) {
  assert.deepEqual(Object.keys(status).sort(), [
    'albumId',
    'indexedSessions',
    'invalidSessions',
    'missingSessions',
    'profile',
    'projectId',
    'state',
    'unlinkedVersions',
    'unreadyPhotos',
    'workspaceId',
  ]);
  assert.deepEqual(
    {
      workspaceId: status.workspaceId,
      projectId: status.projectId,
      albumId: status.albumId,
      profile: status.profile,
    },
    {
      workspaceId: scope.workspace.id,
      projectId: scope.project.id,
      albumId: scope.album.id,
      profile: PROFILE,
    },
  );
  for (const field of [
    'indexedSessions',
    'missingSessions',
    'invalidSessions',
    'unlinkedVersions',
    'unreadyPhotos',
  ]) {
    assert.ok(Number.isSafeInteger(status[field]) && status[field] >= 0);
  }
  assert.ok(['building', 'blocked', 'ready'].includes(status.state));
  return status;
}

async function all(db, sql, ...values) {
  const statement = db.prepare(sql);
  const result = values.length
    ? await statement.bind(...values).all()
    : await statement.all();
  assert.equal(result.success, true, sql);
  return result.results;
}

async function sourceSnapshot(db, { workspace, project, album }) {
  const rows = async (sql, ...values) => all(db, sql, ...values);
  const scoped = (sql) => rows(sql, workspace.id, project.id, album.id);
  const uploadIds = await rows(
    'SELECT id FROM upload_sessions WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY id',
    workspace.id,
    project.id,
    album.id,
  );
  const uploadIdList = uploadIds.map((row) => row.id);
  const json = async (sql, ...values) =>
    JSON.stringify(await rows(sql, ...values));
  return {
    project: await rows(
      'SELECT id,workspace_id,versioning_mode,revision,status FROM projects WHERE id=?',
      project.id,
    ),
    album: await rows(
      'SELECT id,workspace_id,project_id,state,revision,is_pinned,legal_hold FROM albums WHERE id=?',
      album.id,
    ),
    uploads: await scoped(
      'SELECT * FROM upload_sessions WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY id',
    ),
    uploadSpecs: await rows(
      'SELECT p.* FROM upload_specs p JOIN upload_sessions u ON u.id=p.upload_session_id WHERE u.workspace_id=? AND u.project_id=? AND u.album_id=? ORDER BY p.upload_session_id',
      workspace.id,
      project.id,
      album.id,
    ),
    uploadRequests: await scoped(
      'SELECT * FROM upload_requests WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY actor_id,request_id',
    ),
    uploadWorkflowRequests: await rows(
      'SELECT r.* FROM upload_workflow_requests r JOIN upload_sessions u ON u.id=r.upload_session_id WHERE u.workspace_id=? AND u.project_id=? AND u.album_id=? ORDER BY r.actor_id,r.request_id',
      workspace.id,
      project.id,
      album.id,
    ),
    uploadCompletions: await scoped(
      'SELECT * FROM upload_completions WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY upload_session_id',
    ),
    uploadVersionCompletions: await scoped(
      'SELECT * FROM upload_version_completions WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY upload_session_id',
    ),
    photos: await scoped(
      'SELECT * FROM photos WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY id',
    ),
    versions: await rows(
      'SELECT v.* FROM photo_versions v JOIN photos p ON p.id=v.photo_id AND p.workspace_id=v.workspace_id WHERE p.workspace_id=? AND p.project_id=? AND p.album_id=? ORDER BY v.id',
      workspace.id,
      project.id,
      album.id,
    ),
    assets: await rows(
      'SELECT a.* FROM photo_assets a JOIN photos p ON p.id=a.photo_id AND p.workspace_id=a.workspace_id WHERE p.workspace_id=? AND p.project_id=? AND p.album_id=? ORDER BY a.id',
      workspace.id,
      project.id,
      album.id,
    ),
    processingJobs: await rows(
      'SELECT j.* FROM image_processing_jobs j JOIN photo_assets a ON a.id=j.id JOIN photos p ON p.id=a.photo_id AND p.workspace_id=a.workspace_id WHERE p.workspace_id=? AND p.project_id=? AND p.album_id=? ORDER BY j.id',
      workspace.id,
      project.id,
      album.id,
    ),
    heads: await rows(
      'SELECT * FROM photo_version_heads WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY photo_id',
      workspace.id,
      project.id,
      album.id,
    ),
    matchingChanges: await rows(
      'SELECT * FROM album_matching_changes WHERE workspace_id=? AND project_id=? AND album_id=? ORDER BY sequence',
      workspace.id,
      project.id,
      album.id,
    ),
    reservations: await rows(
      'SELECT r.* FROM storage_reservations r JOIN upload_sessions u ON u.id=r.id WHERE u.workspace_id=? AND u.project_id=? AND u.album_id=? ORDER BY r.id',
      workspace.id,
      project.id,
      album.id,
    ),
    usage: await rows(
      'SELECT * FROM workspace_storage_usage WHERE workspace_id=?',
      workspace.id,
    ),
    storageNode: await rows("SELECT * FROM storage_nodes WHERE id='primary'"),
    settings: await rows('SELECT * FROM storage_settings WHERE id=1'),
    audit: await rows(
      'SELECT * FROM audit_events WHERE workspace_id=? ORDER BY event_id',
      workspace.id,
    ),
    retention: await rows(
      "SELECT event_id,actor_type,action,after_json,request_id FROM audit_events WHERE action LIKE 'retention.%' ORDER BY event_id",
    ),
    uploadIdJson: JSON.stringify(uploadIdList),
    // Force the audit/retention snapshots to be represented by full row data.
    auditFingerprint: await json(
      'SELECT * FROM audit_events WHERE workspace_id=? ORDER BY event_id',
      workspace.id,
    ),
  };
}

export async function runMatchingFilenameIndexChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  assert.ok(galleryFixture?.context?.album?.id);
  const enabledWorker = await mf.getWorker('matching-filename-index-test');
  const storageWorker = await mf.getWorker('storage-test');
  const ownerCookie = cookies.headers();
  const ownerHeaders = {
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
  };
  const ownedUploadSessions = new Set();

  const enabledFetch = (path, init = {}) =>
    enabledWorker.fetch(
      new Request(base + path, {
        ...init,
        headers: new Headers(init.headers ?? ownerHeaders),
      }),
    );
  const readStatus = async (albumId) => {
    const response = await enabledFetch(
      '/api/v1/albums/' + albumId + '/matching-filename-index',
    );
    const body = await bodyOf(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const advance = async (albumId, overrides = {}) => {
    const headers = new Headers(ownerHeaders);
    for (const [name, value] of Object.entries(overrides.headers ?? {})) {
      if (value === undefined) headers.delete(name);
      else headers.set(name, value);
    }
    const response = await enabledFetch(
      '/api/v1/albums/' + albumId + '/matching-filename-index',
      {
        method: 'POST',
        headers,
        body: overrides.body ?? '{}',
      },
    );
    return { response, body: await bodyOf(response) };
  };
  const expectError = async (response, status, code, parsedBody) => {
    const body = parsedBody === undefined ? await bodyOf(response) : parsedBody;
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(body?.error?.code, code, JSON.stringify(body));
    return body;
  };
  const create = async (path, fields) => {
    const response = await request(path, {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        Origin: base,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...fields, requestId: randomUUID() }),
    });
    const body = await bodyOf(response);
    assert.equal(response.status, 201, JSON.stringify(body));
    return body;
  };
  const createScope = async (name, existing) => {
    const workspace = existing?.workspace ?? galleryFixture.context.workspace;
    const project =
      existing?.project ??
      (
        await create('/api/v1/projects', {
          workspaceId: workspace.id,
          name: 'Filename index ' + name,
        })
      ).project;
    const album = (
      await create(`/api/v1/projects/${project.id}/albums`, { name })
    ).album;
    return { workspace, project, album };
  };
  const reserve = async (scope, originalFilename) => {
    const response = await request('/api/v1/uploads/init', {
      method: 'POST',
      headers: {
        Cookie: ownerCookie,
        Origin: base,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: scope.workspace.id,
        projectId: scope.project.id,
        albumId: scope.album.id,
        originalFilename,
        expectedBytes: 8,
        contentType: 'image/png',
        sha256: 'a'.repeat(64),
        requestId: randomUUID(),
      }),
    });
    const body = await bodyOf(response);
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(body?.uploadSession?.originalFilename, originalFilename);
    ownedUploadSessions.add(body.uploadSession.id);
    return body.uploadSession;
  };
  const tableRows = async (sql, ...values) => all(db, sql, ...values);

  const authenticated = await request('/api/auth/get-session', {
    headers: { Cookie: ownerCookie },
  });
  assert.equal(authenticated.status, 200, await authenticated.clone().text());
  const authBody = await authenticated.json();
  assert.equal(authBody?.user?.id, owner);
  assert.ok(authBody?.session?.id);
  const sessionId = authBody.session.id;
  assert.ok(
    await db
      .prepare(
        'SELECT id FROM owner_sessions WHERE userId=? AND id=? AND expiresAt>? LIMIT 1',
      )
      .bind(owner, sessionId, Date.now())
      .first(),
    'The index fixture has a live Owner session',
  );

  const progressScope = await createScope('progress');
  const invalidScope = await createScope('invalid', progressScope);
  const blockerScope = await createScope('blockers', progressScope);
  const progressFilenames = [
    'Cafe\u0301.JPG',
    'café.JPG',
    'Café_edit.JPG',
    'Café.jpg',
    'notes.raw',
    ...Array.from({ length: 25 }, (_, index) => `batch-${index}.png`),
  ];
  const progressSessions = [];
  try {
    await check(
      'matching filename index capabilities default off and expose only the local test gate',
      async () => {
        const defaultHeaders = {
          Cookie: ownerCookie,
          Origin: base,
          Accept: 'application/json',
        };
        const disabled = await request(
          '/api/v1/matching-filename-index/capabilities',
          { headers: defaultHeaders },
        );
        const enabled = await enabledFetch(
          '/api/v1/matching-filename-index/capabilities',
          { headers: new Headers(defaultHeaders) },
        );
        assert.equal(disabled.status, 200);
        assert.deepEqual(await disabled.json(), { enabled: false });
        assert.equal(enabled.status, 200);
        assert.deepEqual(await enabled.json(), { enabled: true });

        await expectError(
          await request(
            '/api/v1/albums/' +
              progressScope.album.id +
              '/matching-filename-index',
            { headers: defaultHeaders },
          ),
          403,
          'MATCHING_INDEX_DISABLED',
        );
      },
    );

    for (const filename of progressFilenames)
      progressSessions.push(await reserve(progressScope, filename));
    const invalidSession = await reserve(invalidScope, '.');

    await check(
      'current Owner, Guest, cross-owner, query, Origin and expected-actor boundaries are enforced',
      async () => {
        const unauthenticated = await request(
          '/api/v1/albums/' +
            progressScope.album.id +
            '/matching-filename-index',
          { headers: { Cookie: 'kino_guest=synthetic-guest-session' } },
        );
        assert.equal(unauthenticated.status, 401);

        const foreignOwnerId = randomUUID();
        const foreignWorkspaceId = randomUUID();
        const foreignProjectId = randomUUID();
        const foreignAlbumId = randomUUID();
        const now = Date.now();
        await db
          .prepare(
            'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
          )
          .bind(
            foreignOwnerId,
            'Synthetic other Owner',
            `matching-index-${foreignOwnerId}@example.invalid`,
            now,
            now,
          )
          .run();
        await db
          .prepare(
            'INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)',
          )
          .bind(foreignWorkspaceId, 'Synthetic other Owner', foreignOwnerId)
          .run();
        await db
          .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
          .bind(foreignProjectId, foreignWorkspaceId, 'Synthetic other Owner')
          .run();
        await db
          .prepare(
            'INSERT INTO albums(id,workspace_id,project_id,name) VALUES(?,?,?,?)',
          )
          .bind(
            foreignAlbumId,
            foreignWorkspaceId,
            foreignProjectId,
            'Synthetic other Owner',
          )
          .run();
        await expectError(
          await enabledFetch(
            '/api/v1/albums/' + foreignAlbumId + '/matching-filename-index',
          ),
          404,
          'NOT_FOUND',
        );

        await expectError(
          await enabledFetch(
            '/api/v1/albums/not-a-uuid/matching-filename-index',
          ),
          400,
          'INVALID_INPUT',
        );
        await expectError(
          await enabledFetch(
            '/api/v1/albums/' +
              progressScope.album.id +
              '/matching-filename-index?cursor=1',
          ),
          400,
          'INVALID_INPUT',
        );
        const queryMutation = await enabledFetch(
          '/api/v1/albums/' +
            progressScope.album.id +
            '/matching-filename-index?limit=1',
          { method: 'POST', headers: new Headers(ownerHeaders), body: '{}' },
        );
        await expectError(queryMutation, 400, 'INVALID_INPUT');
        const wrongOrigin = await advance(progressScope.album.id, {
          headers: { Origin: 'http://evil.example' },
        });
        assert.equal(wrongOrigin.response.status, 403);
        assert.match(String(wrongOrigin.body), /Invalid Origin header/u);
        const missingOrigin = await advance(progressScope.album.id, {
          headers: { Origin: undefined },
        });
        await expectError(
          missingOrigin.response,
          403,
          'FORBIDDEN_ORIGIN',
          missingOrigin.body,
        );
        const changedActor = await advance(progressScope.album.id, {
          headers: { 'X-Kino-Expected-Actor': randomUUID() },
        });
        await expectError(
          changedActor.response,
          403,
          'MATCHING_INDEX_OWNER_CHANGED',
          changedActor.body,
        );
        const missingActor = await advance(progressScope.album.id, {
          headers: { 'X-Kino-Expected-Actor': undefined },
        });
        await expectError(
          missingActor.response,
          403,
          'MATCHING_INDEX_OWNER_CHANGED',
          missingActor.body,
        );
        const wrongActor = await advance(progressScope.album.id, {
          body: JSON.stringify({ limit: 24 }),
        });
        await expectError(
          wrongActor.response,
          400,
          'INVALID_INPUT',
          wrongActor.body,
        );
        const tooLarge = await advance(progressScope.album.id, {
          body: JSON.stringify({ note: 'x'.repeat(2048) }),
        });
        await expectError(
          tooLarge.response,
          413,
          'BODY_TOO_LARGE',
          tooLarge.body,
        );

        const ownerDisabled = await db
          .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
          .bind(owner)
          .run();
        assert.equal(ownerDisabled.success, true);
        try {
          const response = await enabledFetch(
            '/api/v1/albums/' +
              progressScope.album.id +
              '/matching-filename-index',
          );
          assert.equal(response.status, 403);
        } finally {
          await db
            .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
            .bind(owner)
            .run();
        }
      },
    );

    await check(
      'index reads and bounded advances backfill immutable upload sources without changing upload, audit, retention, storage or matching inputs',
      async () => {
        const sourceBefore = await sourceSnapshot(db, progressScope);
        const classifierRequest = await storageWorker.fetch(
          new Request(base + '/test-version-match-candidates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actor: owner,
              session: sessionId,
              albumId: galleryFixture.context.album.id,
            }),
          }),
        );
        const classifierBody = await bodyOf(classifierRequest);
        assert.equal(
          classifierRequest.status,
          200,
          JSON.stringify(classifierBody),
        );

        const initial = statusShape(
          await readStatus(progressScope.album.id),
          progressScope,
        );
        assert.equal(initial.indexedSessions, 0);
        assert.equal(initial.missingSessions, progressSessions.length);
        assert.equal(initial.state, 'building');

        const beforeRows = await tableRows(
          'SELECT count(*) AS n FROM matching_filename_index WHERE album_id=? AND profile=?',
          progressScope.album.id,
          PROFILE,
        );
        const first = await advance(progressScope.album.id);
        assert.equal(first.response.status, 200, JSON.stringify(first.body));
        const afterFirstRows = await tableRows(
          'SELECT count(*) AS n FROM matching_filename_index WHERE album_id=? AND profile=?',
          progressScope.album.id,
          PROFILE,
        );
        const firstDelta = afterFirstRows[0].n - beforeRows[0].n;
        assert.ok(firstDelta > 0 && firstDelta <= MAX_BATCH);
        assert.equal(afterFirstRows[0].n, firstDelta);
        assert.equal(first.body.indexedSessions, firstDelta);
        assert.equal(
          first.body.missingSessions,
          progressSessions.length - firstDelta,
        );
        assert.ok(first.body.missingSessions > 0);
        assert.equal(first.body.state, 'building');

        const concurrent = await Promise.all(
          Array.from({ length: 4 }, () => advance(progressScope.album.id)),
        );
        for (const result of concurrent) {
          assert.equal(
            result.response.status,
            200,
            JSON.stringify(result.body),
          );
          assert.ok(['building', 'ready'].includes(result.body.state));
          assert.ok(result.body.missingSessions >= 0);
        }
        const final = statusShape(
          await readStatus(progressScope.album.id),
          progressScope,
        );
        assert.equal(final.indexedSessions, progressSessions.length);
        assert.equal(final.missingSessions, 0);
        assert.equal(final.invalidSessions, 0);
        assert.equal(final.unlinkedVersions, 0);
        assert.equal(final.unreadyPhotos, 0);
        assert.equal(final.state, 'ready');

        const indexedRows = await tableRows(
          'SELECT upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE album_id=? AND profile=? ORDER BY original_filename,upload_session_id',
          progressScope.album.id,
          PROFILE,
        );
        assert.equal(indexedRows.length, progressSessions.length);
        const byRawFilename = new Map(
          indexedRows.map((row) => [row.original_filename, row]),
        );
        assert.deepEqual(
          {
            basename: byRawFilename.get('Cafe\u0301.JPG')?.canonical_basename,
            extension: byRawFilename.get('Cafe\u0301.JPG')?.canonical_extension,
            invalid: byRawFilename.get('Cafe\u0301.JPG')?.is_invalid,
          },
          { basename: 'Café', extension: 'JPG', invalid: 0 },
        );
        assert.deepEqual(
          {
            basename: byRawFilename.get('café.JPG')?.canonical_basename,
            extension: byRawFilename.get('café.JPG')?.canonical_extension,
            invalid: byRawFilename.get('café.JPG')?.is_invalid,
          },
          { basename: 'café', extension: 'JPG', invalid: 0 },
        );
        assert.deepEqual(
          {
            basename: byRawFilename.get('Café_edit.JPG')?.canonical_basename,
            extension: byRawFilename.get('Café_edit.JPG')?.canonical_extension,
            invalid: byRawFilename.get('Café_edit.JPG')?.is_invalid,
          },
          { basename: 'Café_edit', extension: 'JPG', invalid: 0 },
        );
        assert.deepEqual(
          {
            basename: byRawFilename.get('Café.jpg')?.canonical_basename,
            extension: byRawFilename.get('Café.jpg')?.canonical_extension,
            invalid: byRawFilename.get('Café.jpg')?.is_invalid,
          },
          { basename: 'Café', extension: 'jpg', invalid: 0 },
        );
        assert.deepEqual(
          {
            basename: byRawFilename.get('notes.raw')?.canonical_basename,
            extension: byRawFilename.get('notes.raw')?.canonical_extension,
            invalid: byRawFilename.get('notes.raw')?.is_invalid,
          },
          { basename: 'notes.raw', extension: null, invalid: 0 },
        );
        const rawSource = await tableRows(
          'SELECT original_filename FROM upload_sessions WHERE id=?',
          progressSessions[0].id,
        );
        assert.equal(rawSource[0].original_filename, 'Cafe\u0301.JPG');
        assert.equal(
          byRawFilename.get('Cafe\u0301.JPG')?.upload_session_id,
          progressSessions[0].id,
        );

        const statusJson = JSON.stringify(final);
        for (const row of indexedRows) {
          assert.equal(statusJson.includes(row.original_filename), false);
        }
        const objectKeys = await tableRows(
          'SELECT object_key FROM upload_sessions WHERE album_id=?',
          progressScope.album.id,
        );
        for (const row of objectKeys)
          assert.equal(statusJson.includes(row.object_key), false);
        for (const forbidden of [
          'originalFilename',
          'canonicalBasename',
          'canonicalExtension',
          'uploadSessionId',
          'objectKey',
          'object_key',
        ])
          assert.equal(Object.hasOwn(final, forbidden), false);

        const stableRows = await tableRows(
          'SELECT upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE album_id=? AND profile=? ORDER BY upload_session_id',
          progressScope.album.id,
          PROFILE,
        );
        for (const row of stableRows) {
          await assert.rejects(
            db
              .prepare(
                'UPDATE matching_filename_index SET canonical_basename=? WHERE upload_session_id=? AND profile=?',
              )
              .bind('tampered', row.upload_session_id, PROFILE)
              .run(),
            /MATCHING_FILENAME_INDEX_IMMUTABLE/,
          );
          await assert.rejects(
            db
              .prepare(
                'DELETE FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
              )
              .bind(row.upload_session_id, PROFILE)
              .run(),
            /MATCHING_FILENAME_INDEX_IMMUTABLE/,
          );
        }
        const firstRow = stableRows[0];
        assert.ok(firstRow);
        await assert.rejects(
          db
            .prepare(
              'INSERT OR REPLACE INTO matching_filename_index(upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid) VALUES(?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              firstRow.upload_session_id,
              firstRow.workspace_id,
              firstRow.project_id,
              firstRow.album_id,
              firstRow.original_filename,
              firstRow.profile,
              'tampered',
              firstRow.canonical_extension,
              firstRow.is_invalid,
            )
            .run(),
          /MATCHING_FILENAME_INDEX_IMMUTABLE/,
        );
        await assert.rejects(
          db
            .prepare(
              'UPDATE upload_sessions SET original_filename=? WHERE id=?',
            )
            .bind('rewritten.png', progressSessions[0].id)
            .run(),
          /IMMUTABLE_UPLOAD_SESSION/,
        );

        const replayBefore = JSON.stringify(
          await tableRows(
            'SELECT * FROM matching_filename_index WHERE album_id=? AND profile=? ORDER BY upload_session_id',
            progressScope.album.id,
            PROFILE,
          ),
        );
        const replay = await Promise.all([
          advance(progressScope.album.id),
          advance(progressScope.album.id),
        ]);
        for (const result of replay) {
          assert.equal(
            result.response.status,
            200,
            JSON.stringify(result.body),
          );
          assert.deepEqual(result.body, final);
        }
        assert.equal(
          JSON.stringify(
            await tableRows(
              'SELECT * FROM matching_filename_index WHERE album_id=? AND profile=? ORDER BY upload_session_id',
              progressScope.album.id,
              PROFILE,
            ),
          ),
          replayBefore,
        );

        const afterSources = await sourceSnapshot(db, progressScope);
        assert.deepEqual(afterSources, sourceBefore);
        const classifierAfter = await storageWorker.fetch(
          new Request(base + '/test-version-match-candidates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actor: owner,
              session: sessionId,
              albumId: galleryFixture.context.album.id,
            }),
          }),
        );
        const classifierBodyAfter = await bodyOf(classifierAfter);
        assert.equal(
          classifierAfter.status,
          200,
          JSON.stringify(classifierBodyAfter),
        );
        assert.deepEqual(classifierBodyAfter, classifierBody);
      },
    );

    await check(
      'invalid canonical filenames are indexed as an explicit blocker without exposing their source text',
      async () => {
        const sourceBefore = await sourceSnapshot(db, invalidScope);
        const initial = statusShape(
          await readStatus(invalidScope.album.id),
          invalidScope,
        );
        assert.equal(initial.missingSessions, 1);
        assert.equal(initial.state, 'building');
        const result = await advance(invalidScope.album.id);
        assert.equal(result.response.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.indexedSessions, 1);
        assert.equal(result.body.missingSessions, 0);
        assert.equal(result.body.invalidSessions, 1);
        assert.equal(result.body.state, 'blocked');
        assert.equal(JSON.stringify(result.body).includes('"."'), false);
        const row = await tableRows(
          'SELECT upload_session_id,profile,workspace_id,project_id,album_id,original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE upload_session_id=? AND profile=?',
          invalidSession.id,
          PROFILE,
        );
        assert.deepEqual(row, [
          {
            upload_session_id: invalidSession.id,
            profile: PROFILE,
            workspace_id: invalidScope.workspace.id,
            project_id: invalidScope.project.id,
            album_id: invalidScope.album.id,
            original_filename: '.',
            canonical_basename: null,
            canonical_extension: null,
            is_invalid: 1,
          },
        ]);
        assert.deepEqual(await sourceSnapshot(db, invalidScope), sourceBefore);
      },
    );

    await check(
      'unlinked versions and photos without a complete version head block readiness',
      async () => {
        const unreadyPhotoId = randomUUID();
        const unlinkedPhotoId = randomUUID();
        const unlinkedVersionId = randomUUID();
        await db.batch([
          db
            .prepare(
              'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
            )
            .bind(
              unreadyPhotoId,
              blockerScope.workspace.id,
              blockerScope.project.id,
              blockerScope.album.id,
              'unready-without-version.png',
            ),
          db
            .prepare(
              'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
            )
            .bind(
              unlinkedPhotoId,
              blockerScope.workspace.id,
              blockerScope.project.id,
              blockerScope.album.id,
              'version-without-upload-link.png',
            ),
          db
            .prepare(
              "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,8,'image/png',2,4,'private')",
            )
            .bind(
              unlinkedVersionId,
              blockerScope.workspace.id,
              unlinkedPhotoId,
              owner,
              'b'.repeat(64),
            ),
        ]);
        const sourceBefore = await sourceSnapshot(db, blockerScope);
        const status = statusShape(
          await readStatus(blockerScope.album.id),
          blockerScope,
        );
        assert.equal(status.indexedSessions, 0);
        assert.equal(status.missingSessions, 0);
        assert.equal(status.unlinkedVersions, 1);
        assert.equal(status.unreadyPhotos, 1);
        assert.equal(status.state, 'blocked');
        assert.deepEqual(await sourceSnapshot(db, blockerScope), sourceBefore);
      },
    );

    await check(
      'a new immutable upload session makes a ready index building until one browser batch advances it',
      async () => {
        const before = statusShape(
          await readStatus(progressScope.album.id),
          progressScope,
        );
        assert.equal(before.state, 'ready');
        const lateSession = await reserve(
          progressScope,
          'arrived-after-ready.png',
        );
        const building = statusShape(
          await readStatus(progressScope.album.id),
          progressScope,
        );
        assert.equal(building.indexedSessions, before.indexedSessions);
        assert.equal(building.missingSessions, 1);
        assert.equal(building.state, 'building');

        const sourceBeforeUi = await sourceSnapshot(db, progressScope);
        const browserResult = await runMatchingFilenameIndexBrowserChecks({
          db,
          worker: enabledWorker,
          disabledWorker: await mf.getWorker('app'),
          base,
          owner,
          ownerCookie,
          scope: progressScope,
          blockerScope,
          expectedMissing: 1,
        });
        assert.equal(browserResult.disabledHidden, true);
        assert.equal(browserResult.readyAfterOneBatch, true);
        assert.equal(browserResult.batchPosts, 1);
        assert.equal(browserResult.mobileOverflow, false);
        assert.ok(ownedUploadSessions.has(lateSession.id));

        const ready = statusShape(
          await readStatus(progressScope.album.id),
          progressScope,
        );
        assert.equal(ready.state, 'ready');
        assert.equal(ready.indexedSessions, progressSessions.length + 1);
        assert.equal(ready.missingSessions, 0);
        assert.deepEqual(
          await sourceSnapshot(db, progressScope),
          sourceBeforeUi,
        );
      },
    );
  } finally {
    for (const uploadSessionId of ownedUploadSessions) {
      const row = await db
        .prepare('SELECT status FROM upload_sessions WHERE id=?')
        .bind(uploadSessionId)
        .first();
      if (!row || row.status !== 'reserved') continue;
      const response = await request(
        '/api/v1/uploads/' + uploadSessionId + '/cancel',
        {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            Origin: base,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requestId: randomUUID() }),
        },
      );
      const body = await bodyOf(response);
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body?.uploadSession?.status, 'cancelled');
    }
  }
}
