import assert from 'node:assert/strict';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const sessionHash = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const inviteHash = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

export async function guestFeedbackChecks({
  db,
  mf,
  check,
  owner,
  base,
  galleryFixture,
  request,
}) {
  const workspaceId = galleryFixture.context.workspace.id;
  const projectId = galleryFixture.context.project.id;
  const albumId = galleryFixture.context.album.id;
  const photoId = galleryFixture.photo.photoId;
  const versionId = galleryFixture.photo.versionId;
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession);
  const enabled = await mf.getWorker('guest-feedback-test');
  const selectionWorker = await mf.getWorker('guest-selection-test');
  const exchangeWorker = await mf.getWorker('guest-exchange-test');

  const route = (worker, path, guest, options = {}) => {
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    if (guest) headers.Cookie = 'kino_guest=' + guest.secret;
    if (method !== 'GET' && method !== 'HEAD') {
      if (!headers.Origin) headers.Origin = base;
      if (!headers['Content-Type'])
        headers['Content-Type'] = 'application/json';
    }
    return worker.fetch(
      new Request(new URL(path, base), {
        method,
        headers,
        body: options.body,
      }),
    );
  };
  const appRoute = (path, guest, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (guest) headers.Cookie = 'kino_guest=' + guest.secret;
    if (options.method && !['GET', 'HEAD'].includes(options.method)) {
      if (!headers.Origin) headers.Origin = base;
      if (!headers['Content-Type'])
        headers['Content-Type'] = 'application/json';
    }
    return request(path, { ...options, headers });
  };
  const createInvite = async (
    mask,
    requestedAlbumId = albumId,
    expires = Date.now() + 3600000,
  ) => {
    const inviteId = randomUUID();
    const token = randomBytes(32).toString('hex');
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        workspaceId,
        projectId,
        inviteHash(token),
        mask,
        expires,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, workspaceId, projectId, requestedAlbumId)
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId)
      .run();
    return { inviteId, token, albumId: requestedAlbumId };
  };
  const createSession = async (
    inviteId,
    guestId = randomUUID(),
    expires = Date.now() + 600000,
  ) => {
    const exists = await db
      .prepare('SELECT id FROM guest_identities WHERE id=? AND invite_id=?')
      .bind(guestId, inviteId)
      .first();
    if (!exists)
      await db
        .prepare(
          'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
        )
        .bind(guestId, inviteId, 'Feedback fixture')
        .run();
    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const secretHash = sessionHash(secret);
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(id, inviteId, guestId, secretHash, expires)
      .run();
    return { id, inviteId, guestId, secret, secretHash, expires };
  };
  const createGuest = async (
    mask,
    targetAlbumId = albumId,
    lifetimeMs = 600000,
    inviteLifetimeMs = 3600000,
  ) => {
    const inviteExpires = Date.now() + inviteLifetimeMs;
    const invite = await createInvite(mask, targetAlbumId, inviteExpires);
    return {
      ...invite,
      ...(await createSession(
        invite.inviteId,
        randomUUID(),
        Math.min(inviteExpires, Date.now() + lifetimeMs),
      )),
    };
  };
  const ratingPath = (a, p) =>
    '/api/guest/albums/' + a + '/photos/' + p + '/rating';
  const favoritePath = (a, p) =>
    '/api/guest/albums/' + a + '/photos/' + p + '/favorite';
  const readPath = (kind, a, ids) =>
    '/api/guest/albums/' +
    a +
    '/' +
    kind +
    '?' +
    ids.map((id) => 'photoId=' + encodeURIComponent(id)).join('&');
  const putRating = (worker, guest, a, p, body) =>
    route(worker, ratingPath(a, p), guest, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  const putFavorite = (worker, guest, a, p, body) =>
    route(worker, favoritePath(a, p), guest, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  const readRatings = (worker, guest, a, ids) =>
    route(worker, readPath('ratings', a, ids), guest);
  const readFavorites = (worker, guest, a, ids) =>
    route(worker, readPath('favorites', a, ids), guest);
  const putSelection = (guest, body) =>
    route(
      selectionWorker,
      '/api/guest/albums/' +
        guest.albumId +
        '/photos/' +
        photoId +
        '/selection',
      guest,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  const submitSelection = (guest, body) =>
    route(
      selectionWorker,
      '/api/guest/albums/' + guest.albumId + '/selection/submit',
      guest,
      { method: 'POST', body: JSON.stringify(body) },
    );
  const logout = (guest, requestId) =>
    appRoute('/api/guest/logout', guest, {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    });
  const feedbackCommandCount = async () =>
    (
      await db
        .prepare('SELECT count(*) AS n FROM guest_feedback_commands')
        .first()
    ).n;
  const auditCountFor = async (requestId) =>
    (
      await db
        .prepare('SELECT count(*) AS n FROM audit_events WHERE request_id=?')
        .bind(requestId)
        .first()
    ).n;
  const insertPhoto = async (name, targetAlbumId = albumId) => {
    const newPhotoId = randomUUID();
    const newVersionId = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(newPhotoId, workspaceId, projectId, targetAlbumId, name)
      .run();
    await db
      .prepare(
        "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
      )
      .bind(
        newVersionId,
        workspaceId,
        newPhotoId,
        owner,
        randomBytes(32).toString('hex'),
      )
      .run();
    return { photoId: newPhotoId, versionId: newVersionId };
  };
  const secondPhoto = await insertPhoto('feedback-second-private.jpg');
  const foreignAlbumId = randomUUID();
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(foreignAlbumId, workspaceId, projectId, 'Feedback foreign fixture')
    .run();
  const foreignPhoto = await insertPhoto(
    'feedback-foreign-private.jpg',
    foreignAlbumId,
  );
  const version2 = randomUUID();
  const nextVersion = await db
    .prepare(
      'SELECT COALESCE(MAX(version_no),0)+1 AS n FROM photo_versions WHERE photo_id=?',
    )
    .bind(photoId)
    .first();
  await appendAuthorizedVersionFixture({
    db,
    owner,
    photoId,
    versionId: version2,
    parentVersionId: versionId,
    versionNo: nextVersion.n,
    sha256: randomBytes(32).toString('hex'),
    byteSize: 128,
    mime: 'image/jpeg',
    width: 10,
    height: 10,
  });
  await check(
    'Guest feedback is default-off, validates mutation boundaries, and enforces independent rating/favorite scopes',
    async () => {
      const ratingGuest = await createGuest(16);
      const favoriteGuest = await createGuest(32);
      const defaultOffCount = await feedbackCommandCount();
      const auditBeforeDefaultOff = (
        await db.prepare('SELECT count(*) AS n FROM audit_events').first()
      ).n;
      const ratingsBeforeDefaultOff = (
        await db.prepare('SELECT count(*) AS n FROM guest_rating_state').first()
      ).n;
      const favoritesBeforeDefaultOff = (
        await db
          .prepare('SELECT count(*) AS n FROM guest_favorite_state')
          .first()
      ).n;
      const disabled = await appRoute(
        ratingPath(albumId, photoId),
        ratingGuest,
        {
          method: 'PUT',
          body: JSON.stringify({
            requestId: randomUUID(),
            versionId,
            stars: 4,
          }),
        },
      );
      assert.equal(disabled.status, 503);
      assert.equal(
        (await disabled.json()).error.code,
        'GUEST_FEEDBACK_DISABLED',
      );
      assert.equal(await feedbackCommandCount(), defaultOffCount);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,
        auditBeforeDefaultOff,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_rating_state')
            .first()
        ).n,
        ratingsBeforeDefaultOff,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_favorite_state')
            .first()
        ).n,
        favoritesBeforeDefaultOff,
      );

      const beforeInvalid = await feedbackCommandCount();
      const originDenied = await route(
        enabled,
        ratingPath(albumId, photoId),
        ratingGuest,
        {
          method: 'PUT',
          headers: { Origin: 'https://attacker.invalid' },
          body: JSON.stringify({
            requestId: randomUUID(),
            versionId,
            stars: 4,
          }),
        },
      );
      assert.equal(originDenied.status, 403);
      const nonJson = await route(
        enabled,
        ratingPath(albumId, photoId),
        ratingGuest,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: '{"stars":4}',
        },
      );
      assert.equal(nonJson.status, 400);
      const oversized = await route(
        enabled,
        ratingPath(albumId, photoId),
        ratingGuest,
        {
          method: 'PUT',
          body: 'x'.repeat(17000),
        },
      );
      assert.equal(oversized.status, 413);
      const invalidBodies = [
        { requestId: randomUUID(), versionId, stars: 0 },
        { requestId: randomUUID(), versionId, stars: 6 },
        { requestId: randomUUID(), versionId, stars: 2.5 },
        { requestId: randomUUID(), versionId, stars: 4, actorId: owner },
        {
          requestId: randomUUID(),
          versionId,
          stars: 4,
          workspaceId,
          projectId,
        },
        null,
      ];
      for (const body of invalidBodies)
        assert.equal(
          (
            await route(enabled, ratingPath(albumId, photoId), ratingGuest, {
              method: 'PUT',
              body: JSON.stringify(body),
            })
          ).status,
          400,
        );
      assert.equal(
        (
          await putFavorite(enabled, favoriteGuest, albumId, photoId, {
            requestId: randomUUID(),
            versionId,
            favored: null,
          })
        ).status,
        400,
      );
      assert.equal(await feedbackCommandCount(), beforeInvalid);

      const auditBeforeReads = (
        await db.prepare('SELECT count(*) AS n FROM audit_events').first()
      ).n;
      const ratingResponse = await readRatings(enabled, ratingGuest, albumId, [
        photoId,
        secondPhoto.photoId,
      ]);
      assert.equal(ratingResponse.status, 200);
      const ratingPage = await ratingResponse.json();
      assert.deepEqual(ratingPage.items, [
        { photoId, stars: null, versionId: null, updatedAt: null },
        {
          photoId: secondPhoto.photoId,
          stars: null,
          versionId: null,
          updatedAt: null,
        },
      ]);
      const favoriteResponse = await readFavorites(
        enabled,
        favoriteGuest,
        albumId,
        [photoId, secondPhoto.photoId],
      );
      assert.equal(favoriteResponse.status, 200);
      assert.deepEqual((await favoriteResponse.json()).items, [
        { photoId, favored: false, versionId: null, updatedAt: null },
        {
          photoId: secondPhoto.photoId,
          favored: false,
          versionId: null,
          updatedAt: null,
        },
      ]);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM audit_events').first()).n,
        auditBeforeReads,
      );
      assert.equal(
        JSON.stringify(ratingPage).includes('feedback-second-private.jpg'),
        false,
      );
      assert.equal(JSON.stringify(ratingPage).includes('object_key'), false);

      assert.equal(
        (
          await putFavorite(enabled, ratingGuest, albumId, photoId, {
            requestId: randomUUID(),
            versionId,
            favored: true,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await putRating(enabled, favoriteGuest, albumId, photoId, {
            requestId: randomUUID(),
            versionId,
            stars: 4,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await route(
            enabled,
            '/api/guest/albums/' + albumId + '/photos',
            ratingGuest,
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await route(
            enabled,
            '/api/guest/albums/' + albumId + '/selection',
            ratingGuest,
          )
        ).status,
        401,
      );

      const requestId = randomUUID();
      const rated = await putRating(enabled, ratingGuest, albumId, photoId, {
        requestId,
        versionId,
        stars: 4,
      });
      assert.equal(rated.status, 200);
      const ratedBody = await rated.json();
      assert.equal(ratedBody.photoId, photoId);
      assert.equal(ratedBody.stars, 4);
      assert.equal(ratedBody.versionId, versionId);
      assert.ok(ratedBody.eventId);
      assert.equal(ratedBody.occurredAt, ratedBody.updatedAt);
      const ratingAudit = await db
        .prepare('SELECT * FROM audit_events WHERE event_id=?')
        .bind(ratedBody.eventId)
        .first();
      assert.equal(ratingAudit.action, 'rating.set');
      assert.equal(ratingAudit.actor_type, 'guest');
      assert.equal(ratingAudit.actor_id, ratingGuest.guestId);
      assert.equal(ratingAudit.guest_session_id, ratingGuest.id);
      assert.equal(ratingAudit.workspace_id, workspaceId);
      assert.equal(ratingAudit.project_id, projectId);
      assert.equal(ratingAudit.album_id, albumId);
      assert.equal(ratingAudit.photo_id, photoId);
      assert.equal(ratingAudit.version_id, versionId);
      assert.equal(ratingAudit.request_id, requestId);
      assert.equal(JSON.parse(ratingAudit.before_json).stars, null);
      assert.equal(JSON.parse(ratingAudit.after_json).stars, 4);
      const changed = await putRating(enabled, ratingGuest, albumId, photoId, {
        requestId: randomUUID(),
        versionId,
        stars: 2,
      });
      assert.equal(changed.status, 200);
      const beforeNoop = await db
        .prepare(
          "SELECT stars,last_version_id,updated_at_ms,last_command_id,strftime('%Y-%m-%dT%H:%M:%fZ',updated_at_ms/1000.0,'unixepoch') AS updatedAt FROM guest_rating_state WHERE guest_id=? AND photo_id=?",
        )
        .bind(ratingGuest.guestId, photoId)
        .first();
      const noop = await putRating(enabled, ratingGuest, albumId, photoId, {
        requestId: randomUUID(),
        versionId: version2,
        stars: 2,
      });
      assert.equal(noop.status, 200);
      const noopBody = await noop.json();
      assert.equal(noopBody.eventId, null);
      assert.equal(noopBody.versionId, versionId);
      assert.equal(noopBody.updatedAt, beforeNoop.updatedAt);
      const afterNoop = await db
        .prepare(
          'SELECT stars,last_version_id,updated_at_ms,last_command_id FROM guest_rating_state WHERE guest_id=? AND photo_id=?',
        )
        .bind(ratingGuest.guestId, photoId)
        .first();
      assert.deepEqual(afterNoop, {
        stars: beforeNoop.stars,
        last_version_id: beforeNoop.last_version_id,
        updated_at_ms: beforeNoop.updated_at_ms,
        last_command_id: beforeNoop.last_command_id,
      });

      const cleared = await putRating(enabled, ratingGuest, albumId, photoId, {
        requestId: randomUUID(),
        versionId: version2,
        stars: null,
      });
      assert.equal(cleared.status, 200);
      const clearedBody = await cleared.json();
      assert.equal(clearedBody.stars, null);
      assert.equal(clearedBody.versionId, version2);
      assert.ok(clearedBody.updatedAt);
      const clearAudit = await db
        .prepare(
          'SELECT action,before_json,after_json FROM audit_events WHERE event_id=?',
        )
        .bind(clearedBody.eventId)
        .first();
      assert.equal(clearAudit.action, 'rating.cleared');
      assert.equal(JSON.parse(clearAudit.before_json).stars, 2);
      assert.equal(JSON.parse(clearAudit.after_json).stars, null);
      const clearNoop = await putRating(
        enabled,
        ratingGuest,
        albumId,
        photoId,
        {
          requestId: randomUUID(),
          versionId,
          stars: null,
        },
      );
      assert.equal(clearNoop.status, 200);
      const clearNoopBody = await clearNoop.json();
      assert.equal(clearNoopBody.eventId, null);
      assert.equal(clearNoopBody.versionId, version2);
      assert.equal(clearNoopBody.updatedAt, clearedBody.updatedAt);

      const favoriteRequestId = randomUUID();
      const favoriteReplies = await Promise.all([
        putFavorite(enabled, favoriteGuest, albumId, photoId, {
          requestId: favoriteRequestId,
          versionId,
          favored: true,
        }),
        putFavorite(enabled, favoriteGuest, albumId, photoId, {
          requestId: favoriteRequestId,
          versionId,
          favored: true,
        }),
      ]);
      assert.deepEqual(
        favoriteReplies.map((response) => response.status),
        [200, 200],
      );
      const favoriteBody = await favoriteReplies[0].json();
      assert.deepEqual(await favoriteReplies[1].json(), favoriteBody);
      assert.equal(favoriteBody.favored, true);
      assert.equal(favoriteBody.versionId, versionId);
      assert.ok(favoriteBody.eventId);
      assert.equal(await auditCountFor(favoriteRequestId), 1);
      const favoriteNoop = await putFavorite(
        enabled,
        favoriteGuest,
        albumId,
        photoId,
        {
          requestId: randomUUID(),
          versionId: version2,
          favored: true,
        },
      );
      assert.equal(favoriteNoop.status, 200);
      const favoriteNoopBody = await favoriteNoop.json();
      assert.equal(favoriteNoopBody.eventId, null);
      assert.equal(favoriteNoopBody.versionId, versionId);
      assert.equal(favoriteNoopBody.updatedAt, favoriteBody.updatedAt);
      const favoriteRemoved = await putFavorite(
        enabled,
        favoriteGuest,
        albumId,
        photoId,
        {
          requestId: randomUUID(),
          versionId: version2,
          favored: false,
        },
      );
      assert.equal(favoriteRemoved.status, 200);
      const favoriteRemovedBody = await favoriteRemoved.json();
      assert.equal(favoriteRemovedBody.favored, false);
      assert.equal(favoriteRemovedBody.versionId, version2);
      const favoriteAudit = await db
        .prepare(
          'SELECT action,before_json,after_json FROM audit_events WHERE event_id=?',
        )
        .bind(favoriteRemovedBody.eventId)
        .first();
      assert.equal(favoriteAudit.action, 'favorite.removed');
      assert.equal(JSON.parse(favoriteAudit.before_json).favored, true);
      assert.equal(JSON.parse(favoriteAudit.after_json).favored, false);

      const replayId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, ratingGuest, albumId, photoId, {
            requestId: replayId,
            versionId,
            stars: 5,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await putRating(enabled, ratingGuest, albumId, photoId, {
            requestId: replayId,
            versionId,
            stars: 3,
          })
        ).status,
        409,
      );
      const deniedBatch = await readRatings(enabled, ratingGuest, albumId, [
        photoId,
        foreignPhoto.photoId,
      ]);
      assert.equal(deniedBatch.status, 401);
      const deniedText = JSON.stringify(await deniedBatch.json());
      assert.equal(deniedText.includes(foreignPhoto.photoId), false);
      assert.equal(deniedText.includes('feedback-foreign-private.jpg'), false);
      const latest = await readRatings(enabled, ratingGuest, albumId, [
        photoId,
      ]);
      assert.equal(latest.status, 200);
      const latestBody = await latest.json();
      assert.equal(latestBody.items[0].stars, 5);
      assert.equal(latestBody.items[0].versionId, versionId);
    },
  );

  await check(
    'Guest feedback command/result/state witnesses are immutable and audit failure rolls back for a same-ID retry',
    async () => {
      const guest = await createGuest(16);
      const failedRequestId = randomUUID();
      const beforeCommands = await feedbackCommandCount();
      await db.exec(
        "CREATE TRIGGER guest_feedback_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action IN('rating.set','rating.cleared','favorite.added','favorite.removed') BEGIN SELECT RAISE(ABORT,'TEST_FEEDBACK_AUDIT_FAILURE'); END",
      );
      let failed;
      try {
        failed = await putRating(enabled, guest, albumId, photoId, {
          requestId: failedRequestId,
          versionId,
          stars: 5,
        });
      } finally {
        await db.exec('DROP TRIGGER guest_feedback_test_audit_failure');
      }
      assert.equal(failed.status, 503);
      assert.equal(await feedbackCommandCount(), beforeCommands);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_feedback_commands WHERE request_id=?',
            )
            .bind(failedRequestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_rating_state WHERE guest_id=? AND photo_id=?',
            )
            .bind(guest.guestId, photoId)
            .first()
        ).n,
        0,
      );
      assert.equal(await auditCountFor(failedRequestId), 0);
      const retry = await putRating(enabled, guest, albumId, photoId, {
        requestId: failedRequestId,
        versionId,
        stars: 5,
      });
      assert.equal(retry.status, 200);
      const retryBody = await retry.json();
      assert.ok(retryBody.eventId);
      const command = await db
        .prepare(
          'SELECT id FROM guest_feedback_commands WHERE guest_id=? AND request_id=?',
        )
        .bind(guest.guestId, failedRequestId)
        .first();
      assert.ok(command);
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_rating_state SET stars=4 WHERE guest_id=? AND photo_id=?',
          )
          .bind(guest.guestId, photoId)
          .run(),
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM guest_rating_state WHERE guest_id=? AND photo_id=?',
          )
          .bind(guest.guestId, photoId)
          .run(),
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_feedback_commands SET payload_json=? WHERE id=?',
          )
          .bind('{}', command.id)
          .run(),
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_feedback_commands WHERE id=?')
          .bind(command.id)
          .run(),
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_feedback_results SET result_json=? WHERE command_id=?',
          )
          .bind('{}', command.id)
          .run(),
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_feedback_results WHERE command_id=?')
          .bind(command.id)
          .run(),
      );

      const countBeforeMalformed = await feedbackCommandCount();
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO guest_feedback_commands(id,guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,kind,value_integer,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            guest.guestId,
            guest.inviteId,
            guest.id,
            guest.secretHash,
            randomUUID(),
            workspaceId,
            projectId,
            albumId,
            secondPhoto.photoId,
            secondPhoto.versionId,
            'rating',
            null,
            '{"stars":null}',
          )
          .run(),
      );
      assert.equal(await feedbackCommandCount(), countBeforeMalformed);

      const chainGuest = await createGuest(16);
      const chainIds = [];
      for (const stars of [1, 2, 3]) {
        const id = randomUUID();
        const response = await putRating(
          enabled,
          chainGuest,
          albumId,
          photoId,
          {
            requestId: id,
            versionId,
            stars,
          },
        );
        assert.equal(response.status, 200);
        chainIds.push(
          (
            await db
              .prepare(
                'SELECT id FROM guest_feedback_commands WHERE guest_id=? AND request_id=?',
              )
              .bind(chainGuest.guestId, id)
              .first()
          ).id,
        );
      }
      const stateBeforeTamper = await db
        .prepare(
          'SELECT * FROM guest_rating_state WHERE guest_id=? AND photo_id=?',
        )
        .bind(chainGuest.guestId, photoId)
        .first();
      const latestRequestId = (
        await db
          .prepare('SELECT request_id FROM guest_feedback_commands WHERE id=?')
          .bind(chainIds[2])
          .first()
      ).request_id;
      const auditBeforeTamper = await auditCountFor(latestRequestId);
      const oldWitness = await db
        .prepare(
          'SELECT c.version_id,c.created_at_ms,r.previous_command_id FROM guest_feedback_commands c JOIN guest_feedback_results r ON r.command_id=c.id WHERE c.id=?',
        )
        .bind(chainIds[0])
        .first();
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_rating_state SET stars=1,last_version_id=?,updated_at_ms=?,last_command_id=? WHERE guest_id=? AND photo_id=?',
          )
          .bind(
            oldWitness.version_id,
            oldWitness.created_at_ms,
            chainIds[0],
            chainGuest.guestId,
            photoId,
          )
          .run(),
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO guest_rating_state(invite_id,guest_id,workspace_id,project_id,album_id,photo_id,stars,last_version_id,updated_at_ms,last_command_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            stateBeforeTamper.invite_id,
            stateBeforeTamper.guest_id,
            stateBeforeTamper.workspace_id,
            stateBeforeTamper.project_id,
            stateBeforeTamper.album_id,
            stateBeforeTamper.photo_id,
            1,
            oldWitness.version_id,
            oldWitness.created_at_ms,
            chainIds[0],
          )
          .run(),
      );
      const stateAfterTamper = await db
        .prepare(
          'SELECT * FROM guest_rating_state WHERE guest_id=? AND photo_id=?',
        )
        .bind(chainGuest.guestId, photoId)
        .first();
      assert.deepEqual(stateAfterTamper, stateBeforeTamper);
      assert.equal(await auditCountFor(latestRequestId), auditBeforeTamper);

      const snapshotGuest = await createGuest(568);
      assert.equal(
        (
          await putSelection(snapshotGuest, {
            requestId: randomUUID(),
            versionId,
            selected: true,
          })
        ).status,
        200,
      );
      const submitted = await submitSelection(snapshotGuest, {
        requestId: randomUUID(),
        expectedRoundNo: 1,
        expectedRevision: 1,
      });
      assert.equal(submitted.status, 200);
      const submittedBody = await submitted.json();
      const beforeItems = await db
        .prepare(
          'SELECT photo_id,version_id,selected_at_ms FROM guest_selection_submission_items WHERE submission_id=?',
        )
        .bind(submittedBody.submissionId)
        .all();
      assert.equal(beforeItems.results.length, 1);
      assert.equal(
        (
          await putRating(enabled, snapshotGuest, albumId, photoId, {
            requestId: randomUUID(),
            versionId: version2,
            stars: 3,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await putFavorite(enabled, snapshotGuest, albumId, photoId, {
            requestId: randomUUID(),
            versionId: version2,
            favored: true,
          })
        ).status,
        200,
      );
      const afterItems = await db
        .prepare(
          'SELECT photo_id,version_id,selected_at_ms FROM guest_selection_submission_items WHERE submission_id=?',
        )
        .bind(submittedBody.submissionId)
        .all();
      assert.deepEqual(afterItems.results, beforeItems.results);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT version_id FROM guest_selection_state WHERE guest_id=? AND photo_id=?',
            )
            .bind(snapshotGuest.guestId, photoId)
            .first()
        ).version_id,
        versionId,
      );
    },
  );

  await check(
    'Guest feedback request IDs conflict symmetrically with selection, submission, logout, and exchange ledgers',
    async () => {
      const feedbackFirstSelection = await createGuest(24);
      const feedbackSelectionId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, feedbackFirstSelection, albumId, photoId, {
            requestId: feedbackSelectionId,
            versionId,
            stars: 4,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await putSelection(feedbackFirstSelection, {
            requestId: feedbackSelectionId,
            versionId,
            selected: true,
          })
        ).status,
        409,
      );

      const selectionFirstFeedback = await createGuest(24);
      const selectionFeedbackId = randomUUID();
      assert.equal(
        (
          await putSelection(selectionFirstFeedback, {
            requestId: selectionFeedbackId,
            versionId,
            selected: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await putRating(enabled, selectionFirstFeedback, albumId, photoId, {
            requestId: selectionFeedbackId,
            versionId,
            stars: 4,
          })
        ).status,
        409,
      );

      const feedbackFirstSubmission = await createGuest(536);
      assert.equal(
        (
          await putSelection(feedbackFirstSubmission, {
            requestId: randomUUID(),
            versionId,
            selected: true,
          })
        ).status,
        200,
      );
      const feedbackSubmissionId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, feedbackFirstSubmission, albumId, photoId, {
            requestId: feedbackSubmissionId,
            versionId,
            stars: 5,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await submitSelection(feedbackFirstSubmission, {
            requestId: feedbackSubmissionId,
            expectedRoundNo: 1,
            expectedRevision: 1,
          })
        ).status,
        409,
      );

      const submissionFirstFeedback = await createGuest(536);
      assert.equal(
        (
          await putSelection(submissionFirstFeedback, {
            requestId: randomUUID(),
            versionId,
            selected: true,
          })
        ).status,
        200,
      );
      const submissionId = randomUUID();
      assert.equal(
        (
          await submitSelection(submissionFirstFeedback, {
            requestId: submissionId,
            expectedRoundNo: 1,
            expectedRevision: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await putRating(enabled, submissionFirstFeedback, albumId, photoId, {
            requestId: submissionId,
            versionId,
            stars: 5,
          })
        ).status,
        409,
      );

      const feedbackFirstLogout = await createGuest(16);
      await createSession(
        feedbackFirstLogout.inviteId,
        feedbackFirstLogout.guestId,
      );
      const feedbackLogoutId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, feedbackFirstLogout, albumId, photoId, {
            requestId: feedbackLogoutId,
            versionId,
            stars: 4,
          })
        ).status,
        200,
      );
      assert.equal(
        (await logout(feedbackFirstLogout, feedbackLogoutId)).status,
        409,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_session_revocations WHERE session_id=?',
            )
            .bind(feedbackFirstLogout.id)
            .first()
        ).n,
        0,
      );

      const logoutFirstFeedback = await createGuest(16);
      const secondLogoutSession = await createSession(
        logoutFirstFeedback.inviteId,
        logoutFirstFeedback.guestId,
      );
      const logoutFeedbackId = randomUUID();
      assert.equal(
        (await logout(logoutFirstFeedback, logoutFeedbackId)).status,
        200,
      );
      assert.equal(
        (
          await putRating(enabled, secondLogoutSession, albumId, photoId, {
            requestId: logoutFeedbackId,
            versionId,
            stars: 4,
          })
        ).status,
        409,
      );

      const exchangeFirstInvite = await createInvite(16);
      const exchangeFirstRequestId = randomUUID();
      const exchangeReply = await exchangeWorker.fetch(
        new Request(new URL('/api/guest/exchange', base), {
          method: 'POST',
          headers: {
            Origin: base,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.210',
          },
          body: JSON.stringify({
            requestId: exchangeFirstRequestId,
            token: exchangeFirstInvite.token,
            displayName: 'Feedback exchange',
          }),
        }),
      );
      assert.equal(exchangeReply.status, 200);
      const exchangeCookie = exchangeReply.headers.get('set-cookie') || '';
      const secretMatch = exchangeCookie.match(
        /(?:__Host-)?kino_guest=([a-f0-9]{64})/,
      );
      assert.ok(secretMatch);
      const exchangedSecret = secretMatch[1];
      const exchangedRow = await db
        .prepare('SELECT id,guest_id FROM guest_sessions WHERE secret_hash=?')
        .bind(sessionHash(exchangedSecret))
        .first();
      assert.ok(exchangedRow);
      const exchangedGuest = {
        id: exchangedRow.id,
        inviteId: exchangeFirstInvite.inviteId,
        guestId: exchangedRow.guest_id,
        secret: exchangedSecret,
      };
      assert.equal(
        (
          await putRating(enabled, exchangedGuest, albumId, photoId, {
            requestId: exchangeFirstRequestId,
            versionId,
            stars: 4,
          })
        ).status,
        409,
      );

      const feedbackFirstInvite = await createInvite(16);
      const feedbackFirstGuest = {
        ...feedbackFirstInvite,
        ...(await createSession(feedbackFirstInvite.inviteId)),
      };
      const feedbackExchangeId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, feedbackFirstGuest, albumId, photoId, {
            requestId: feedbackExchangeId,
            versionId,
            stars: 4,
          })
        ).status,
        200,
      );
      const exchangeConflict = await exchangeWorker.fetch(
        new Request(new URL('/api/guest/exchange', base), {
          method: 'POST',
          headers: {
            Origin: base,
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '198.51.100.211',
          },
          body: JSON.stringify({
            requestId: feedbackExchangeId,
            token: feedbackFirstInvite.token,
            displayName: 'Feedback exchange',
          }),
        }),
      );
      assert.equal(exchangeConflict.status, 401);
      assert.equal(exchangeConflict.headers.get('set-cookie'), null);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_exchange_commands WHERE invite_id=? AND request_id=?',
            )
            .bind(feedbackFirstInvite.inviteId, feedbackExchangeId)
            .first()
        ).n,
        0,
      );
    },
  );

  await check(
    'Guest feedback rechecks live invite, session, Owner, expiry, and parent authority before returning an exact retry',
    async () => {
      const inviteRevoked = await createGuest(16);
      const inviteRequestId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, inviteRevoked, albumId, photoId, {
            requestId: inviteRequestId,
            versionId,
            stars: 5,
          })
        ).status,
        200,
      );
      await db
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(inviteRevoked.inviteId, owner, ownerSession.id)
        .run();
      assert.equal(
        (
          await putRating(enabled, inviteRevoked, albumId, photoId, {
            requestId: inviteRequestId,
            versionId,
            stars: 5,
          })
        ).status,
        401,
      );

      const sessionRevoked = await createGuest(16);
      const sessionRequestId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, sessionRevoked, albumId, photoId, {
            requestId: sessionRequestId,
            versionId,
            stars: 4,
          })
        ).status,
        200,
      );
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(sessionRevoked.id, sessionRevoked.secretHash)
        .run();
      assert.equal(
        (
          await putRating(enabled, sessionRevoked, albumId, photoId, {
            requestId: sessionRequestId,
            versionId,
            stars: 4,
          })
        ).status,
        401,
      );

      const expired = await createGuest(16, albumId, 1500);
      const expiredId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, expired, albumId, photoId, {
            requestId: expiredId,
            versionId,
            stars: 3,
          })
        ).status,
        200,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, expired.expires - Date.now()) + 100),
      );
      assert.equal(
        (
          await putRating(enabled, expired, albumId, photoId, {
            requestId: expiredId,
            versionId,
            stars: 3,
          })
        ).status,
        401,
      );

      const expiredInvite = await createGuest(16, albumId, 600000, 1500);
      const expiredInviteId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, expiredInvite, albumId, photoId, {
            requestId: expiredInviteId,
            versionId,
            stars: 2,
          })
        ).status,
        200,
      );
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(0, expiredInvite.expires - Date.now()) + 100,
        ),
      );
      assert.equal(
        (
          await putRating(enabled, expiredInvite, albumId, photoId, {
            requestId: expiredInviteId,
            versionId,
            stars: 2,
          })
        ).status,
        401,
      );

      const ownerDenied = await createGuest(16);
      const ownerRequestId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, ownerDenied, albumId, photoId, {
            requestId: ownerRequestId,
            versionId,
            stars: 2,
          })
        ).status,
        200,
      );
      const ownerWasEnabled = await db
        .prepare('SELECT enabled FROM owners WHERE user_id=?')
        .bind(owner)
        .first();
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        assert.equal(
          (
            await putRating(enabled, ownerDenied, albumId, photoId, {
              requestId: ownerRequestId,
              versionId,
              stars: 2,
            })
          ).status,
          401,
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=? WHERE user_id=?')
          .bind(ownerWasEnabled.enabled, owner)
          .run();
      }

      const parentDenied = await createGuest(16);
      const parentRequestId = randomUUID();
      assert.equal(
        (
          await putRating(enabled, parentDenied, albumId, photoId, {
            requestId: parentRequestId,
            versionId,
            stars: 1,
          })
        ).status,
        200,
      );
      const parentBefore = await db
        .prepare('SELECT status,archived_from_status FROM projects WHERE id=?')
        .bind(projectId)
        .first();
      await db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status='draft' WHERE id=?",
        )
        .bind(projectId)
        .run();
      try {
        assert.equal(
          (
            await putRating(enabled, parentDenied, albumId, photoId, {
              requestId: parentRequestId,
              versionId,
              stars: 1,
            })
          ).status,
          401,
        );
      } finally {
        await db
          .prepare(
            'UPDATE projects SET status=?,archived_from_status=? WHERE id=?',
          )
          .bind(
            parentBefore.status,
            parentBefore.archived_from_status,
            projectId,
          )
          .run();
      }
    },
  );
}
