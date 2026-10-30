import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function versionMatchCandidateChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  const storageWorker = await mf.getWorker('storage-test');
  const ownerCookie = cookies.headers();
  const galleryAlbumId = galleryFixture.context.album.id;
  const galleryPhoto = galleryFixture.photo;

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
    'Expected /api/auth/get-session to provide a live Owner session id',
  );

  const call = (overrides = {}) => {
    const body = {
      actor: overrides.actor ?? owner,
      session: overrides.session ?? sessionId,
      albumId: overrides.albumId ?? galleryAlbumId,
    };
    if (Object.prototype.hasOwnProperty.call(overrides, 'evidence'))
      body.evidence = overrides.evidence;
    return storageWorker.fetch(
      new Request(base + '/test-version-match-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  };
  const bodyOf = async (response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  const expectError = async (response, status, code) => {
    const body = await bodyOf(response);
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(body?.error?.code, code, JSON.stringify(body));
    return body;
  };
  const liveVersion = async (versionId) =>
    db
      .prepare(
        'SELECT v.id AS versionId,v.photo_id AS photoId,' +
          'v.source_hash_sha256 AS sha256,v.width,v.height,' +
          'u.original_filename AS filename ' +
          'FROM photo_versions v ' +
          'JOIN upload_completions c ON c.version_id=v.id ' +
          'JOIN upload_sessions u ON u.id=c.upload_session_id ' +
          'WHERE v.id=?',
      )
      .bind(versionId)
      .first();

  await check(
    'version-match candidate reads require the current Owner actor and live session',
    async () => {
      const otherEnabledOwner = await db
        .prepare(
          'SELECT user_id FROM owners WHERE enabled=1 AND user_id<>? LIMIT 1',
        )
        .bind(owner)
        .first();
      const mismatchedActor = otherEnabledOwner?.user_id ?? randomUUID();
      const actorFailure = await expectError(
        await call({ actor: mismatchedActor }),
        404,
        'NOT_FOUND',
      );
      assert.equal(actorFailure?.snapshot, undefined);
      assert.equal(actorFailure?.candidates, undefined);
      await expectError(
        await call({ session: 'missing-session-' + randomUUID() }),
        404,
        'NOT_FOUND',
      );
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectError(await call(), 404, 'NOT_FOUND');
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
    },
  );

  let snapshot;
  let immutable;
  await check(
    'version-match snapshots bind active scope, revisions and head while exposing no storage or session secrets',
    async () => {
      const response = await call();
      const body = await bodyOf(response);
      assert.equal(response.status, 200, JSON.stringify(body));
      snapshot = body;

      assert.deepEqual(snapshot.scope, {
        workspaceId: galleryFixture.context.workspace.id,
        projectId: galleryFixture.context.project.id,
        albumId: galleryAlbumId,
      });
      assert.equal(snapshot.mode, 'manual');
      assert.ok(Number.isSafeInteger(snapshot.changeSequence));
      assert.equal(
        snapshot.changeSequence,
        (
          await db
            .prepare(
              'SELECT COALESCE(MAX(sequence),0) AS n FROM album_matching_changes WHERE album_id=?',
            )
            .bind(galleryAlbumId)
            .first()
        ).n,
      );
      assert.ok(Array.isArray(snapshot.pendingUploads));

      assert.ok(Number.isSafeInteger(snapshot.projectRevision));
      assert.ok(snapshot.projectRevision > 0);
      assert.ok(Number.isSafeInteger(snapshot.albumRevision));
      assert.ok(snapshot.albumRevision > 0);

      const head = snapshot.heads?.[galleryPhoto.photoId];
      assert.equal(head?.versionId, galleryPhoto.versionId);
      assert.ok(Number.isSafeInteger(head?.revision));
      assert.ok(head.revision >= 0);

      const allKeys = new Set();
      const visit = (value) => {
        if (Array.isArray(value)) {
          for (const child of value) visit(child);
          return;
        }
        if (value && typeof value === 'object') {
          for (const [key, child] of Object.entries(value)) {
            allKeys.add(key);
            visit(child);
          }
        }
      };
      visit(snapshot);
      for (const key of [
        'object_key',
        'objectKey',
        'nodeId',
        'storageNodeId',
        'credential_ref',
        'sessionSecret',
        'sessionToken',
        'accessToken',
      ])
        assert.equal(allKeys.has(key), false, 'snapshot leaked ' + key);
      assert.equal(JSON.stringify(snapshot).includes(sessionId), false);
    },
  );

  await check(
    'version-match candidates use immutable completion filename, hash and dimensions; persisted manual mode stays disabled',
    async () => {
      immutable = await liveVersion(galleryPhoto.versionId);
      assert.ok(immutable, 'expected the fixture immutable photo version');
      assert.equal(immutable.photoId, galleryPhoto.photoId);
      assert.equal(typeof immutable.filename, 'string');
      assert.ok(immutable.filename.length > 0);
      assert.match(immutable.sha256, /^[a-f0-9]{64}$/iu);
      assert.ok(Number.isSafeInteger(immutable.width) && immutable.width > 0);
      assert.ok(Number.isSafeInteger(immutable.height) && immutable.height > 0);

      const candidate = snapshot.candidates.find(
        (row) => row.versionId === galleryPhoto.versionId,
      );
      assert.ok(
        candidate,
        'expected the immutable version in the scoped candidates',
      );
      assert.equal(candidate.photoId, immutable.photoId);
      assert.equal(candidate.filename, immutable.filename);
      assert.equal(candidate.sha256, immutable.sha256);
      assert.deepEqual(candidate.dimensions, {
        width: immutable.width,
        height: immutable.height,
      });

      const resolvedResponse = await call({
        evidence: {
          filename: immutable.filename,
          sha256: immutable.sha256,
          dimensions: { width: immutable.width, height: immutable.height },
        },
      });
      const resolved = await bodyOf(resolvedResponse);
      assert.equal(resolvedResponse.status, 200, JSON.stringify(resolved));
      assert.equal(resolved.snapshot.mode, 'manual');
      assert.deepEqual(resolved.decision, {
        outcome: 'new_photo',
        reason: 'matching_disabled',
        photoId: null,
        versionId: null,
      });
    },
  );

  await check(
    'version-match evidence rejects caller-supplied mode, options and candidates',
    async () => {
      const evidence = {
        filename: immutable.filename,
        sha256: immutable.sha256,
        dimensions: { width: immutable.width, height: immutable.height },
      };
      for (const extra of [
        { mode: 'auto_filename' },
        { mode: 'unrecognized_mode' },
        { options: { allowJpgJpegEquivalence: true } },
        { candidates: [] },
      ]) {
        await expectError(
          await call({ evidence: { ...evidence, ...extra } }),
          400,
          'INVALID_INPUT',
        );
      }
    },
  );

  await check(
    'version-match reads deny a missing album without disclosing candidates',
    async () => {
      const response = await call({ albumId: randomUUID() });
      const body = await expectError(response, 404, 'NOT_FOUND');
      assert.equal(body?.snapshot, undefined);
      assert.equal(body?.candidates, undefined);
    },
  );

  await check(
    'version-match returns a complete empty snapshot for an authorized empty album',
    async () => {
      const headers = {
        Cookie: ownerCookie,
        Origin: base,
        'Content-Type': 'application/json',
      };
      const create = async (path, fields) => {
        const response = await request(path, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...fields, requestId: randomUUID() }),
        });
        const body = await bodyOf(response);
        assert.equal(response.status, 201, JSON.stringify(body));
        return body;
      };

      const workspace = (
        await create('/api/v1/workspaces', {
          name: 'Version match empty ' + randomUUID(),
        })
      ).workspace;
      const project = (
        await create('/api/v1/projects', {
          workspaceId: workspace.id,
          name: 'Version match empty ' + randomUUID(),
        })
      ).project;
      const album = (
        await create('/api/v1/projects/' + project.id + '/albums', {
          name: 'Version match empty ' + randomUUID(),
        })
      ).album;

      const response = await call({ albumId: album.id });
      const body = await bodyOf(response);
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.deepEqual(body.scope, {
        workspaceId: workspace.id,
        projectId: project.id,
        albumId: album.id,
      });
      assert.equal(body.mode, 'manual');
      assert.deepEqual(body.candidates, []);
      assert.equal(body.candidatesTruncated, false);
      assert.deepEqual(body.heads, {});
      const archived = await request(
        '/api/v1/albums/' + album.id + '/archive',
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            requestId: randomUUID(),
            expectedRevision: album.revision,
            archived: true,
          }),
        },
      );
      assert.equal(archived.status, 200, await archived.clone().text());
      await expectError(await call({ albumId: album.id }), 404, 'NOT_FOUND');
    },
  );
}
