import { runGuestTagsBrowserChecks } from './guest-tags-browser.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const sessionHash = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const inviteHash = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

export async function guestTagsChecks({
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
  const enabled = await mf.getWorker('guest-tags-test');
  const selectionWorker = await mf.getWorker('guest-selection-test');

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
  const otherPhoto = await insertPhoto('guest-tag-other-private.jpg');
  const foreignAlbumId = randomUUID();
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(
      foreignAlbumId,
      workspaceId,
      projectId,
      'Guest tag out-of-scope fixture',
    )
    .run();
  const foreignPhoto = await insertPhoto(
    'guest-tag-foreign-private.jpg',
    foreignAlbumId,
  );
  const path = `/api/guest/albums/${albumId}/photos/${photoId}/tags`;
  const readPath = (ids = [photoId]) =>
    `/api/guest/albums/${albumId}/tags?` +
    ids.map((id) => 'photoId=' + encodeURIComponent(id)).join('&');
  const put = (guest, body, worker = enabled) =>
    route(worker, path, guest, { method: 'PUT', body: JSON.stringify(body) });
  const intent = (guest, label, present = true) => ({
    requestId: randomUUID(),
    expectedGuestId: guest.guestId,
    versionId,
    label,
    present,
  });
  const json = async (response, status = 200) => {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };
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
  const putRating = (guest, body) =>
    route(
      enabled,
      '/api/guest/albums/' + albumId + '/photos/' + photoId + '/rating',
      guest,
      { method: 'PUT', body: JSON.stringify(body) },
    );
  const logout = (guest, requestId) =>
    appRoute('/api/guest/logout', guest, {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    });
  await check(
    'Guest tags are default-off and independently require can_tag with exact identity',
    async () => {
      assert.deepEqual(
        await json(await appRoute('/api/guest/tags/capabilities')),
        { enabled: false },
      );
      assert.deepEqual(
        await json(await route(enabled, '/api/guest/tags/capabilities')),
        { enabled: true },
      );
      const denied = await createGuest(1 + 8 + 16 + 32 + 512);
      await json(await put(denied, intent(denied, 'private')), 401);
      await json(await route(enabled, readPath(), denied), 401);
      const guest = await createGuest(64);
      await json(
        await appRoute(path, guest, {
          method: 'PUT',
          body: JSON.stringify(intent(guest, 'off')),
        }),
        503,
      );
      await json(
        await put(guest, {
          ...intent(guest, 'wrong identity'),
          expectedGuestId: randomUUID(),
        }),
        401,
      );
      const before = await json(await route(enabled, readPath(), guest));
      assert.equal(before.guestId, guest.guestId);
      assert.deepEqual(before.items, [{ photoId, tags: [] }]);
      const body = intent(guest, '  修圖  ');
      const added = await json(await put(guest, body));
      assert.equal(added.label, '修圖');
      assert.equal(added.changed, true);
      assert.ok(added.eventId);
      const other = await createGuest(64);
      assert.deepEqual(
        (await json(await route(enabled, readPath(), other))).items,
        [{ photoId, tags: [] }],
      );
      await json(await put(other, body), 401);
    },
  );
  await check(
    'Guest tag exact replay, no-op and removal preserve immutable change events',
    async () => {
      const guest = await createGuest(64);
      const body = intent(guest, 'review');
      const added = await json(await put(guest, body));
      assert.deepEqual(await json(await put(guest, body)), added);
      await json(await put(guest, { ...body, label: 'changed intent' }), 409);
      const noop = await json(await put(guest, intent(guest, 'review')));
      assert.equal(noop.changed, false);
      assert.equal(noop.eventId, null);
      const removed = await json(
        await put(guest, intent(guest, 'review', false)),
      );
      assert.equal(removed.changed, true);
      const absent = await json(
        await put(guest, intent(guest, 'never-created', false)),
      );
      assert.equal(absent.changed, false);
      assert.equal(absent.tagId, null);
      const events = (
        await db
          .prepare(
            "SELECT action,before_json,after_json,actor_id,guest_session_id,photo_id,version_id FROM audit_events WHERE actor_id=? AND action IN('tag.added','tag.removed') ORDER BY occurred_at_utc,event_id",
          )
          .bind(guest.guestId)
          .all()
      ).results;
      assert.equal(events.length, 2);
      assert.deepEqual(events.map((e) => e.action).sort(), [
        'tag.added',
        'tag.removed',
      ]);
      for (const event of events) {
        assert.equal(event.guest_session_id, guest.id);
        assert.equal(event.photo_id, photoId);
        assert.equal(event.version_id, versionId);
        assert.notEqual(event.before_json, event.after_json);
      }
      assert.deepEqual(
        (await json(await route(enabled, readPath(), guest))).items,
        [{ photoId, tags: [] }],
      );
    },
  );
  await check(
    'Guest tag capacity serializes concurrent additions and permits removal',
    async () => {
      const guest = await createGuest(64);
      for (let i = 0; i < 19; i++)
        await json(await put(guest, intent(guest, `tag-${i}`)));
      const statuses = await Promise.all(
        ['a', 'b'].map(async (label) => {
          const r = await put(guest, intent(guest, `race-${label}`));
          await r.arrayBuffer();
          return r.status;
        }),
      );
      assert.deepEqual(statuses.sort(), [200, 409]);
      assert.equal(
        (await json(await route(enabled, readPath(), guest))).items[0].tags
          .length,
        20,
      );
      await json(await put(guest, intent(guest, 'tag-0', false)));
      await json(await put(guest, intent(guest, 'after-remove')));
    },
  );
  await check(
    'Guest tag audit failure rolls back and same request retries safely',
    async () => {
      const guest = await createGuest(64);
      const body = intent(guest, 'atomic');
      await db.exec(
        "CREATE TRIGGER test_tag_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='tag.added' BEGIN SELECT RAISE(ABORT,'TEST_TAG_AUDIT_FAILURE'); END;",
      );
      try {
        await json(await put(guest, body), 503);
        assert.deepEqual(
          (await json(await route(enabled, readPath(), guest))).items,
          [{ photoId, tags: [] }],
        );
      } finally {
        await db.exec('DROP TRIGGER test_tag_audit_failure');
      }
      const result = await json(await put(guest, body));
      assert.equal(result.changed, true);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(body.requestId)
            .first()
        ).n,
        1,
      );
    },
  );
  await check(
    'Guest tags reject invalid origins, unknown body fields, unexpected query parameters, and oversized input',
    async () => {
      const guest = await createGuest(64);
      const commandCount = (
        await db.prepare('SELECT count(*) AS n FROM guest_tag_commands').first()
      ).n;
      const wrongOrigin = await route(enabled, path, guest, {
        method: 'PUT',
        headers: { Origin: 'https://attacker.invalid' },
        body: JSON.stringify(intent(guest, 'wrong origin')),
      });
      assert.equal(wrongOrigin.status, 403);
      assert.equal(
        (
          await put(guest, {
            ...intent(guest, 'unknown field'),
            actorId: owner,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await route(enabled, path + '?unused=1', guest, {
            method: 'PUT',
            body: JSON.stringify(intent(guest, 'query on mutation')),
          })
        ).status,
        400,
      );
      assert.equal(
        (await route(enabled, readPath() + '&unused=1', guest)).status,
        400,
      );
      assert.equal(
        (await route(enabled, readPath([photoId, photoId]), guest)).status,
        400,
      );
      const tooManyPhotoIds = Array.from({ length: 25 }, () => randomUUID());
      assert.equal(
        (await route(enabled, readPath(tooManyPhotoIds), guest)).status,
        400,
      );
      assert.equal(
        (
          await route(enabled, path, guest, {
            method: 'PUT',
            body: 'x'.repeat(17000),
          })
        ).status,
        413,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_tag_commands')
            .first()
        ).n,
        commandCount,
      );
    },
  );

  await check(
    'Guest tag reads deny mixed in-scope and out-of-scope batches and writes reject another photos version',
    async () => {
      const guest = await createGuest(64);
      const mixedRead = await route(
        enabled,
        readPath([photoId, foreignPhoto.photoId]),
        guest,
      );
      assert.equal(mixedRead.status, 401);
      const deniedText = JSON.stringify(await mixedRead.json());
      assert.equal(deniedText.includes(foreignPhoto.photoId), false);
      assert.equal(deniedText.includes('guest-tag-foreign-private.jpg'), false);

      const commandCount = (
        await db.prepare('SELECT count(*) AS n FROM guest_tag_commands').first()
      ).n;
      const wrongVersion = await put(guest, {
        ...intent(guest, 'wrong photo version'),
        versionId: otherPhoto.versionId,
      });
      assert.equal(wrongVersion.status, 401);
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM guest_tag_commands')
            .first()
        ).n,
        commandCount,
      );
    },
  );

  await check(
    'Guest tags remain mutable after selection submission without changing the sealed snapshot',
    async () => {
      const guest = await createGuest(64 + 8 + 512);
      const selected = await putSelection(guest, {
        requestId: randomUUID(),
        versionId,
        selected: true,
      });
      assert.equal(selected.status, 200);
      const submitted = await submitSelection(guest, {
        requestId: randomUUID(),
        expectedRoundNo: 1,
        expectedRevision: 1,
      });
      const submittedBody = await json(submitted);
      const beforeItems = await db
        .prepare(
          'SELECT photo_id,version_id,selected_at_ms FROM guest_selection_submission_items WHERE submission_id=?',
        )
        .bind(submittedBody.submissionId)
        .all();
      assert.equal(beforeItems.results.length, 1);

      const added = await json(await put(guest, intent(guest, 'after-submit')));
      assert.equal(added.changed, true);
      assert.ok(added.eventId);
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
            .bind(guest.guestId, photoId)
            .first()
        ).version_id,
        versionId,
      );
      assert.deepEqual(
        (await json(await route(enabled, readPath(), guest))).items,
        [
          {
            photoId,
            tags: [
              {
                tagId: added.tagId,
                label: 'after-submit',
                versionId,
                updatedAt: added.occurredAt,
              },
            ],
          },
        ],
      );
    },
  );

  await check(
    'Guest tag request IDs conflict symmetrically with selection, submission, feedback, and logout',
    async () => {
      const tagFirstSelection = await createGuest(64 + 8);
      const tagFirstSelectionId = randomUUID();
      assert.equal(
        (
          await put(tagFirstSelection, {
            ...intent(tagFirstSelection, 'tag-first-selection'),
            requestId: tagFirstSelectionId,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await putSelection(tagFirstSelection, {
            requestId: tagFirstSelectionId,
            versionId,
            selected: true,
          })
        ).status,
        409,
      );

      const selectionFirstTag = await createGuest(64 + 8);
      const selectionFirstTagId = randomUUID();
      assert.equal(
        (
          await putSelection(selectionFirstTag, {
            requestId: selectionFirstTagId,
            versionId,
            selected: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await put(selectionFirstTag, {
            ...intent(selectionFirstTag, 'selection-first-tag'),
            requestId: selectionFirstTagId,
          })
        ).status,
        409,
      );

      const tagFirstSubmission = await createGuest(64 + 8 + 512);
      assert.equal(
        (
          await putSelection(tagFirstSubmission, {
            requestId: randomUUID(),
            versionId,
            selected: true,
          })
        ).status,
        200,
      );
      const tagFirstSubmissionId = randomUUID();
      assert.equal(
        (
          await put(tagFirstSubmission, {
            ...intent(tagFirstSubmission, 'tag-first-submission'),
            requestId: tagFirstSubmissionId,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await submitSelection(tagFirstSubmission, {
            requestId: tagFirstSubmissionId,
            expectedRoundNo: 1,
            expectedRevision: 1,
          })
        ).status,
        409,
      );

      const submissionFirstTag = await createGuest(64 + 8 + 512);
      assert.equal(
        (
          await putSelection(submissionFirstTag, {
            requestId: randomUUID(),
            versionId,
            selected: true,
          })
        ).status,
        200,
      );
      const submissionFirstTagId = randomUUID();
      assert.equal(
        (
          await submitSelection(submissionFirstTag, {
            requestId: submissionFirstTagId,
            expectedRoundNo: 1,
            expectedRevision: 1,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await put(submissionFirstTag, {
            ...intent(submissionFirstTag, 'submission-first-tag'),
            requestId: submissionFirstTagId,
          })
        ).status,
        409,
      );

      const tagFirstFeedback = await createGuest(64 + 16);
      const tagFirstFeedbackId = randomUUID();
      assert.equal(
        (
          await put(tagFirstFeedback, {
            ...intent(tagFirstFeedback, 'tag-first-feedback'),
            requestId: tagFirstFeedbackId,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await putRating(tagFirstFeedback, {
            requestId: tagFirstFeedbackId,
            versionId,
            stars: 4,
          })
        ).status,
        409,
      );

      const feedbackFirstTag = await createGuest(64 + 16);
      const feedbackFirstTagId = randomUUID();
      assert.equal(
        (
          await putRating(feedbackFirstTag, {
            requestId: feedbackFirstTagId,
            versionId,
            stars: 4,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await put(feedbackFirstTag, {
            ...intent(feedbackFirstTag, 'feedback-first-tag'),
            requestId: feedbackFirstTagId,
          })
        ).status,
        409,
      );

      const tagFirstLogout = await createGuest(64);
      const tagFirstLogoutId = randomUUID();
      assert.equal(
        (
          await put(tagFirstLogout, {
            ...intent(tagFirstLogout, 'tag-first-logout'),
            requestId: tagFirstLogoutId,
          })
        ).status,
        200,
      );
      assert.equal(
        (await logout(tagFirstLogout, tagFirstLogoutId)).status,
        409,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_session_revocations WHERE session_id=?',
            )
            .bind(tagFirstLogout.id)
            .first()
        ).n,
        0,
      );

      const logoutFirstTag = await createGuest(64);
      const afterLogoutSession = await createSession(
        logoutFirstTag.inviteId,
        logoutFirstTag.guestId,
      );
      const logoutFirstTagId = randomUUID();
      assert.equal(
        (await logout(logoutFirstTag, logoutFirstTagId)).status,
        200,
      );
      assert.equal(
        (
          await put(afterLogoutSession, {
            ...intent(afterLogoutSession, 'logout-first-tag'),
            requestId: logoutFirstTagId,
          })
        ).status,
        409,
      );
    },
  );

  await check(
    'Guest tag exact retries recheck revoked, disabled, and expired authority before replay',
    async () => {
      const inviteRevoked = await createGuest(64);
      const inviteRevokedBody = intent(inviteRevoked, 'invite-revoked');
      assert.equal((await put(inviteRevoked, inviteRevokedBody)).status, 200);
      await db
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(inviteRevoked.inviteId, owner, ownerSession.id)
        .run();
      assert.equal((await put(inviteRevoked, inviteRevokedBody)).status, 401);

      const sessionRevoked = await createGuest(64);
      const sessionRevokedBody = intent(sessionRevoked, 'session-revoked');
      assert.equal((await put(sessionRevoked, sessionRevokedBody)).status, 200);
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(sessionRevoked.id, sessionRevoked.secretHash)
        .run();
      assert.equal((await put(sessionRevoked, sessionRevokedBody)).status, 401);

      const ownerDisabled = await createGuest(64);
      const ownerDisabledBody = intent(ownerDisabled, 'owner-disabled');
      assert.equal((await put(ownerDisabled, ownerDisabledBody)).status, 200);
      const previousOwnerEnabled = await db
        .prepare('SELECT enabled FROM owners WHERE user_id=?')
        .bind(owner)
        .first();
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        assert.equal((await put(ownerDisabled, ownerDisabledBody)).status, 401);
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=? WHERE user_id=?')
          .bind(previousOwnerEnabled.enabled, owner)
          .run();
      }

      const expiredSession = await createGuest(64, albumId, 1500);
      const expiredSessionBody = intent(expiredSession, 'session-expired');
      assert.equal((await put(expiredSession, expiredSessionBody)).status, 200);
      const expiredInvite = await createGuest(64, albumId, 600000, 1500);
      const expiredInviteBody = intent(expiredInvite, 'invite-expired');
      assert.equal((await put(expiredInvite, expiredInviteBody)).status, 200);
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(expiredSession.expires, expiredInvite.expires) -
            Date.now() +
            100,
        ),
      );
      assert.equal((await put(expiredSession, expiredSessionBody)).status, 401);
      assert.equal((await put(expiredInvite, expiredInviteBody)).status, 401);
    },
  );

  await check(
    'Guest tags Grid and Lightbox preserve identity, retries and capacity recovery at375px',
    async () => {
      const guest = await createGuest(1 + 64 + 8 + 512);
      await runGuestTagsBrowserChecks({
        worker: enabled,
        baseUrl: base,
        albumId,
        photoId,
        versionId,
        guestSecret: guest.secret,
        guestId: guest.guestId,
        db,
      });
    },
  );
  assert.deepEqual(
    (await db.prepare('PRAGMA foreign_key_check').all()).results,
    [],
  );
}
