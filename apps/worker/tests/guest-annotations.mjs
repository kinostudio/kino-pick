import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  guestAnnotationResultSchema,
  guestAnnotationsPageSchema,
} from '../../../packages/contracts/src/guest-annotations.ts';

import { guestHistoryPageSchema } from '../../../packages/contracts/src/guest-history.ts';
const canAnnotate = 128;
const canComment = 256;
const canViewOwnHistory = 1024;
const hashGuestSession = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const hashInviteToken = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function assertGuestAnnotationOwnPlans(db, scope) {
  const bindings = [
    scope.guestId,
    scope.inviteId,
    scope.workspaceId,
    scope.projectId,
    scope.albumId,
    scope.photoId,
    scope.versionId,
  ];
  const pagePlan = await db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT id,geometry_json,style_json,state,revision,created_at_ms,updated_at_ms FROM guest_annotations WHERE author_guest_id=? AND invite_id=? AND workspace_id=? AND project_id=? AND album_id=? AND photo_id=? AND version_id=? ORDER BY created_at_ms,id LIMIT 25',
    )
    .bind(...bindings)
    .all();
  const watermarkPlan = await db
    .prepare(
      'EXPLAIN QUERY PLAN SELECT MAX(seq) FROM guest_annotation_changes WHERE guest_id=? AND invite_id=? AND workspace_id=? AND project_id=? AND album_id=? AND photo_id=? AND version_id=?',
    )
    .bind(...bindings)
    .all();
  assert.ok(
    pagePlan.results.some((row) =>
      String(row.detail).includes('guest_annotations_own_page'),
    ),
  );
  assert.ok(
    watermarkPlan.results.some((row) =>
      String(row.detail).includes('guest_annotation_changes_own_scope'),
    ),
  );
  assert.equal(
    pagePlan.results.some((row) =>
      String(row.detail).includes('USE TEMP B-TREE'),
    ),
    false,
  );
  assert.equal(
    watermarkPlan.results.some((row) =>
      /^SCAN guest_annotation_changes/u.test(String(row.detail)),
    ),
    false,
  );
  return {
    page: pagePlan.results.map((row) => row.detail),
    watermark: watermarkPlan.results.map((row) => row.detail),
  };
}

export async function guestAnnotationChecks({
  db,
  mf,
  check,
  owner,
  base,
  versionFixture,
  cookies,
  request,
}) {
  assert.ok(versionFixture?.workspaceId && versionFixture?.projectId);
  assert.ok(versionFixture?.albumId && versionFixture?.photoId);
  assert.ok(versionFixture?.latestVersionId);
  void cookies;

  const worker = await mf.getWorker('guest-annotations-test');
  const disabledWorker = await mf.getWorker('app');
  const commentWorker = await mf.getWorker('guest-comments-test');
  const albumId = versionFixture.albumId;
  const photoId = versionFixture.photoId;
  const versionId = versionFixture.latestVersionId;
  const origin = new URL(base).origin;
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? ORDER BY expiresAt DESC,id DESC LIMIT 1',
    )
    .bind(owner, Date.now())
    .first();
  assert.ok(ownerSession?.id);

  const capabilitiesPath = '/api/guest/annotations/capabilities';
  const commandPath = '/api/guest/albums/' + albumId + '/annotations/commands';
  const ownPath = (
    targetPhotoId = photoId,
    targetVersionId = versionId,
    query = '',
  ) =>
    '/api/guest/albums/' +
    albumId +
    '/photos/' +
    targetPhotoId +
    '/versions/' +
    targetVersionId +
    '/annotations/own' +
    query;

  const send = (
    targetWorker,
    path,
    {
      method = 'GET',
      secret,
      body,
      extraHeaders = {},
      omitOrigin = false,
      rawBody = false,
    } = {},
  ) => {
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (secret) {
      const cookieName =
        new URL(base).protocol === 'https:'
          ? '__Host-kino_guest'
          : 'kino_guest';
      headers.Cookie = cookieName + '=' + secret;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      if (!omitOrigin && !headers.Origin) headers.Origin = origin;
      if (!rawBody && !headers['Content-Type'])
        headers['Content-Type'] = 'application/json';
    }
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = rawBody ? body : JSON.stringify(body);
    return targetWorker.fetch(new Request(new URL(path, base), init));
  };

  const readJson = async (response, expectedStatus) => {
    const text = await response.text();
    const value = parseJson(text);
    if (expectedStatus !== undefined)
      assert.equal(
        response.status,
        expectedStatus,
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    return value;
  };
  const expectError = async (response, status, code) => {
    const body = await readJson(response, status);
    assert.equal(body?.error?.code, code);
    return body;
  };
  const expectDenied = (response) =>
    expectError(response, 401, 'GUEST_ACCESS_REQUIRED');
  const expectRequestConflict = (response) =>
    expectError(response, 409, 'REQUEST_ID_CONFLICT');
  const expectRevisionConflict = (response) =>
    expectError(response, 409, 'ANNOTATION_REVISION_CONFLICT');
  const expectLimitReached = (response) =>
    expectError(response, 409, 'ANNOTATION_LIMIT_REACHED');
  const expectHistoryChanged = (response) =>
    expectError(response, 409, 'ANNOTATION_HISTORY_CHANGED');

  const createInvite = async (
    mask,
    expiresAtMs = Date.now() + 60 * 60 * 1000,
  ) => {
    const inviteId = randomUUID();
    const token = randomBytes(32).toString('hex');
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        versionFixture.workspaceId,
        versionFixture.projectId,
        hashInviteToken(token),
        mask,
        expiresAtMs,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(
        inviteId,
        versionFixture.workspaceId,
        versionFixture.projectId,
        albumId,
      )
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId)
      .run();
    return { id: inviteId, token, expiresAtMs, mask };
  };
  const createSession = async (invite, guestId, displayName, expiresAtMs) => {
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const sessionExpiry =
      expiresAtMs ?? Math.min(invite.expiresAtMs, Date.now() + 30 * 60 * 1000);
    if (
      !(await db
        .prepare('SELECT id FROM guest_identities WHERE id=? AND invite_id=?')
        .bind(guestId, invite.id)
        .first())
    ) {
      await db
        .prepare(
          'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
        )
        .bind(guestId, invite.id, displayName)
        .run();
    }
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(
        sessionId,
        invite.id,
        guestId,
        hashGuestSession(secret),
        sessionExpiry,
      )
      .run();
    return {
      inviteId: invite.id,
      guestId,
      sessionId,
      secret,
      mask: invite.mask,
    };
  };
  const createGuest = (invite, displayName, existingGuestId) =>
    createSession(invite, existingGuestId ?? randomUUID(), displayName);
  const createInviteWithGuests = async (mask, names, expiresAtMs) => {
    const invite = await createInvite(mask, expiresAtMs);
    const guests = [];
    for (const name of names) guests.push(await createGuest(invite, name));
    return { invite, guests };
  };

  const command = (guest, body, options = {}) =>
    send(worker, commandPath, {
      method: 'POST',
      secret: guest?.secret,
      body,
      ...options,
    });
  const commentCommand = (guest, body, options = {}) =>
    send(commentWorker, '/api/guest/albums/' + albumId + '/comments/commands', {
      method: 'POST',
      secret: guest?.secret,
      body,
      ...options,
    });
  const readOwn = async (
    guest,
    targetPhotoId = photoId,
    targetVersionId = versionId,
    query = '',
  ) =>
    guestAnnotationsPageSchema.parse(
      await readJson(
        await send(worker, ownPath(targetPhotoId, targetVersionId, query), {
          secret: guest?.secret,
        }),
        200,
      ),
    );
  const point = (x, y) => ({
    type: 'point',
    coordinateSpace: 'normalized_1e6',
    x,
    y,
  });
  const rectangle = (x, y, width, height) => ({
    type: 'rectangle',
    coordinateSpace: 'normalized_1e6',
    x,
    y,
    width,
    height,
  });
  const createBody = (
    guest,
    geometry = point(500000, 500000),
    style = { color: 'amber' },
    requestId = randomUUID(),
    commentId = null,
  ) => ({
    requestId,
    expectedGuestId: guest.guestId,
    operation: 'create',
    photoId,
    versionId,
    geometry,
    style,
    commentId,
  });
  const createAnnotation = async (
    guest,
    body = createBody(guest),
    status = 200,
  ) => {
    const response = await command(guest, body);
    const result = await readJson(response, status);
    if (status === 200) guestAnnotationResultSchema.parse(result);
    return { response, result, body };
  };
  const counts = async () => {
    const row = await db
      .prepare(
        "SELECT (SELECT count(*) FROM guest_annotation_commands) AS commands,(SELECT count(*) FROM guest_annotations) AS annotations,(SELECT count(*) FROM guest_annotation_changes) AS changes,(SELECT count(*) FROM guest_annotation_results) AS results,(SELECT count(*) FROM audit_events WHERE action LIKE 'annotation.%') AS audit",
      )
      .first();
    return row;
  };
  const annotationOnly = await createInviteWithGuests(canAnnotate, [
    'Annotation author',
    'Annotation peer',
  ]);
  const otherInvite = await createInviteWithGuests(canAnnotate, [
    'Other invite guest',
  ]);
  const commentOnly = await createInviteWithGuests(canComment, [
    'Comment-only guest',
  ]);
  const mixed = await createInviteWithGuests(canAnnotate | canComment, [
    'Linked annotation author',
    'Linked annotation peer',
  ]);
  const pagination = await createInviteWithGuests(canAnnotate, [
    'Pagination author',
  ]);
  const namespace = await createInviteWithGuests(canAnnotate | canComment, [
    'Namespace guest',
  ]);
  const annotationHistory = await createInviteWithGuests(
    canAnnotate | canViewOwnHistory,
    ['Annotation history author', 'Annotation history peer'],
  );
  const historyOnly = await createInviteWithGuests(canViewOwnHistory, [
    'History-only reader',
  ]);
  const author = annotationOnly.guests[0];
  const peer = annotationOnly.guests[1];
  const other = otherInvite.guests[0];
  const noAnnotate = commentOnly.guests[0];
  const linkedAuthor = mixed.guests[0];
  const linkedPeer = mixed.guests[1];
  const pageAuthor = pagination.guests[0];
  const namespaceGuest = namespace.guests[0];
  const historyAuthor = annotationHistory.guests[0];
  const historyPeer = annotationHistory.guests[1];
  const historyOnlyGuest = historyOnly.guests[0];

  await check(
    'Guest annotations are default-off and require only the separate can_annotate grant',
    async () => {
      assert.deepEqual(await readJson(await request(capabilitiesPath), 200), {
        enabled: false,
      });
      assert.deepEqual(
        await readJson(await send(disabledWorker, capabilitiesPath), 200),
        {
          enabled: false,
        },
      );
      assert.deepEqual(
        await readJson(await send(worker, capabilitiesPath), 200),
        {
          enabled: true,
        },
      );
      assert.equal(
        (await send(worker, capabilitiesPath + '?unexpected=1')).status,
        400,
      );

      const mask = await db
        .prepare('SELECT permissions_mask FROM guest_invites WHERE id=?')
        .bind(annotationOnly.invite.id)
        .first();
      assert.equal(mask?.permissions_mask, canAnnotate);
      assert.deepEqual((await readOwn(author)).items, []);
      await expectDenied(await send(worker, ownPath(), {}));
      await expectError(
        await send(worker, ownPath(), { secret: noAnnotate.secret }),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
      await expectError(
        await send(disabledWorker, commandPath, {
          method: 'POST',
          secret: author.secret,
          body: createBody(author),
        }),
        503,
        'GUEST_ANNOTATIONS_UNAVAILABLE',
      );
      await expectError(
        await send(worker, commandPath + '?unexpected=1', {
          method: 'POST',
          secret: author.secret,
          body: createBody(author),
        }),
        400,
        'INVALID_INPUT',
      );
    },
  );

  let primary;
  let primaryCreate;
  let rectangleCreate;
  await check(
    'Point and rectangle annotations are normalized, style-allowlisted, author-only, and expose no image bytes',
    async () => {
      const upperRequestId = randomUUID().toUpperCase();
      const createBodyUpper = createBody(
        author,
        point(123456, 654321),
        { color: 'red' },
        upperRequestId,
      );
      primaryCreate = await createAnnotation(author, createBodyUpper);
      primary = primaryCreate.result.item;
      assert.equal(
        primaryCreate.result.requestId,
        upperRequestId.toLowerCase(),
      );
      assert.equal(primary.geometry.type, 'point');
      assert.deepEqual(primary.geometry, point(123456, 654321));
      assert.deepEqual(primary.style, { color: 'red' });
      assert.equal(primary.state, 'open');
      assert.equal(primary.revision, 1);
      assert.equal(primary.authorLabel, 'Annotation author');
      assert.equal(primary.isMine, true);
      assert.equal(primary.commentId, null);
      assert.equal(primary.createdAt, primary.updatedAt);
      assert.deepEqual(
        Object.keys(primary).sort(),
        [
          'annotationId',
          'authorLabel',
          'commentId',
          'createdAt',
          'geometry',
          'isMine',
          'photoId',
          'revision',
          'state',
          'style',
          'updatedAt',
          'versionId',
        ].sort(),
      );
      for (const forbidden of [
        author.guestId,
        author.inviteId,
        author.sessionId,
        author.secret,
        'objectKey',
        'thumbnailUrl',
        'previewUrl',
        'originalUrl',
        'body',
        'note',
      ])
        assert.equal(JSON.stringify(primary).includes(forbidden), false);

      const exactLowerReplay = await createAnnotation(author, {
        ...createBodyUpper,
        requestId: upperRequestId.toLowerCase(),
      });
      assert.deepEqual(exactLowerReplay.result, primaryCreate.result);

      rectangleCreate = await createAnnotation(
        author,
        createBody(author, rectangle(100000, 200000, 300000, 400000), {
          color: 'blue',
        }),
      );
      assert.deepEqual(
        rectangleCreate.result.item.geometry,
        rectangle(100000, 200000, 300000, 400000),
      );
      const ownPage = await readOwn(author);
      assert.equal(ownPage.items.length, 2);
      assert.equal(ownPage.guestId, author.guestId);
      assert.deepEqual(
        new Set(ownPage.items.map((item) => item.annotationId)),
        new Set([
          primary.annotationId,
          rectangleCreate.result.item.annotationId,
        ]),
      );
      assert.deepEqual((await readOwn(peer)).items, []);
      assert.deepEqual((await readOwn(other)).items, []);

      await expectError(
        await send(
          worker,
          '/api/guest/photos/' +
            photoId +
            '/versions/' +
            versionId +
            '/assets/preview',
          {
            secret: author.secret,
          },
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
      await expectError(
        await send(worker, ownPath(), { secret: noAnnotate.secret }),
        401,
        'GUEST_ACCESS_REQUIRED',
      );

      const invalidBodies = [
        { ...createBody(author), note: 'freeform is forbidden' },
        { ...createBody(author), geometry: { ...point(1, 2), width: 3 } },
        { ...createBody(author), geometry: point(1000001, 0) },
        { ...createBody(author), geometry: rectangle(999999, 0, 2, 1) },
        { ...createBody(author), style: { color: 'purple' } },
        { ...createBody(author), style: { color: 'amber', css: 'url(x)' } },
      ];
      for (const invalid of invalidBodies)
        await expectError(await command(author, invalid), 400, 'INVALID_INPUT');

      const wrongIdentity = createBody(author);
      wrongIdentity.requestId = randomUUID();
      wrongIdentity.expectedGuestId = randomUUID();
      await expectDenied(await command(author, wrongIdentity));

      const commentOnlyRead = await send(worker, ownPath(), {
        secret: noAnnotate.secret,
      });
      await expectDenied(commentOnlyRead);
      const peerUpdate = {
        requestId: randomUUID(),
        expectedGuestId: peer.guestId,
        operation: 'update',
        annotationId: primary.annotationId,
        expectedRevision: 1,
        geometry: point(9, 9),
        style: { color: 'amber' },
        commentId: null,
      };
      await expectDenied(await command(peer, peerUpdate));
      await expectDenied(
        await command(peer, { ...peerUpdate, expectedGuestId: author.guestId }),
      );
      await expectDenied(
        await command(other, {
          ...peerUpdate,
          requestId: randomUUID(),
          expectedGuestId: other.guestId,
        }),
      );

      const changedSession = await createGuest(
        annotationOnly.invite,
        'Annotation author',
        author.guestId,
      );
      await expectRequestConflict(
        await command(changedSession, {
          ...createBody(author),
          requestId: primaryCreate.result.requestId,
          geometry: primaryCreate.body.geometry,
          style: primaryCreate.body.style,
        }),
      );
    },
  );
  let primaryUpdated;
  await check(
    'Guest annotation update replay, revision CAS, lifecycle transitions, and tombstones never roll projection state backward',
    async () => {
      const updateBody = {
        requestId: randomUUID(),
        expectedGuestId: author.guestId,
        operation: 'update',
        annotationId: primary.annotationId,
        expectedRevision: 1,
        geometry: rectangle(111111, 222222, 333333, 444444),
        style: { color: 'blue' },
        commentId: null,
      };
      const updateResponse = await command(author, updateBody);
      primaryUpdated = guestAnnotationResultSchema.parse(
        await readJson(updateResponse, 200),
      );
      assert.equal(primaryUpdated.item.revision, 2);
      assert.equal(primaryUpdated.item.state, 'open');
      assert.deepEqual(primaryUpdated.item.geometry, updateBody.geometry);
      assert.deepEqual(primaryUpdated.item.style, updateBody.style);

      const exactUpdateReplay = await readJson(
        await command(author, updateBody),
        200,
      );
      assert.deepEqual(exactUpdateReplay, primaryUpdated);
      const exactCreateReplay = await readJson(
        await command(author, primaryCreate.body),
        200,
      );
      assert.deepEqual(exactCreateReplay, primaryCreate.result);
      const afterOldCreateReplay = await readOwn(author);
      const afterOldCreateItem = afterOldCreateReplay.items.find(
        (item) => item.annotationId === primary.annotationId,
      );
      assert.deepEqual(afterOldCreateItem?.geometry, updateBody.geometry);
      assert.equal(afterOldCreateItem?.revision, 2);

      await expectRequestConflict(
        await command(author, {
          ...updateBody,
          style: { color: 'red' },
        }),
      );
      await expectRevisionConflict(
        await command(author, {
          ...updateBody,
          requestId: randomUUID(),
          expectedRevision: 1,
          geometry: point(1, 1),
        }),
      );

      const simultaneous = [
        {
          requestId: randomUUID(),
          expectedGuestId: author.guestId,
          operation: 'update',
          annotationId: rectangleCreate.result.item.annotationId,
          expectedRevision: 1,
          geometry: point(200000, 300000),
          style: { color: 'amber' },
          commentId: null,
        },
        {
          requestId: randomUUID(),
          expectedGuestId: author.guestId,
          operation: 'update',
          annotationId: rectangleCreate.result.item.annotationId,
          expectedRevision: 1,
          geometry: rectangle(400000, 400000, 10000, 10000),
          style: { color: 'red' },
          commentId: null,
        },
      ];
      const raced = await Promise.all(
        simultaneous.map(async (body) => {
          const response = await command(author, body);
          return { status: response.status, body: await readJson(response) };
        }),
      );
      assert.equal(raced.filter((item) => item.status === 200).length, 1);
      assert.equal(raced.filter((item) => item.status === 409).length, 1);
      assert.equal(
        raced.find((item) => item.status === 409)?.body?.error?.code,
        'ANNOTATION_REVISION_CONFLICT',
      );
      const winner = raced.find((item) => item.status === 200);
      guestAnnotationResultSchema.parse(winner?.body);
      const winnerCommand = simultaneous.find(
        (body) => body.requestId === winner?.body?.requestId,
      );
      assert.ok(winnerCommand);
      assert.deepEqual(
        await readJson(await command(author, winnerCommand), 200),
        winner?.body,
      );

      const resolvedBody = {
        requestId: randomUUID(),
        expectedGuestId: author.guestId,
        operation: 'resolve',
        annotationId: primary.annotationId,
        expectedRevision: 2,
      };
      const resolved = guestAnnotationResultSchema.parse(
        await readJson(await command(author, resolvedBody), 200),
      );
      assert.equal(resolved.item.state, 'resolved');
      assert.equal(resolved.item.revision, 3);
      const reopenedBody = {
        requestId: randomUUID(),
        expectedGuestId: author.guestId,
        operation: 'reopen',
        annotationId: primary.annotationId,
        expectedRevision: 3,
      };
      const reopened = guestAnnotationResultSchema.parse(
        await readJson(await command(author, reopenedBody), 200),
      );
      assert.equal(reopened.item.state, 'open');
      assert.equal(reopened.item.revision, 4);
      const deleteBody = {
        requestId: randomUUID(),
        expectedGuestId: author.guestId,
        operation: 'delete',
        annotationId: primary.annotationId,
        expectedRevision: 4,
      };
      const deleted = guestAnnotationResultSchema.parse(
        await readJson(await command(author, deleteBody), 200),
      );
      assert.equal(deleted.item.state, 'deleted');
      assert.equal(deleted.item.revision, 5);
      assert.equal(deleted.item.geometry, null);
      assert.equal(deleted.item.style, null);
      assert.equal(deleted.item.commentId, null);
      assert.deepEqual(
        await readJson(await command(author, deleteBody), 200),
        deleted,
      );
      await expectRevisionConflict(
        await command(author, {
          ...resolvedBody,
          requestId: randomUUID(),
          expectedRevision: 5,
        }),
      );
      await expectRevisionConflict(
        await command(author, {
          ...updateBody,
          requestId: randomUUID(),
          expectedRevision: 5,
        }),
      );
      const tombstone = (await readOwn(author)).items.find(
        (item) => item.annotationId === primary.annotationId,
      );
      assert.equal(tombstone?.state, 'deleted');
      assert.equal(tombstone?.revision, 5);
      assert.equal(tombstone?.geometry, null);
      assert.equal(tombstone?.style, null);
    },
  );

  await check(
    'Optional Guest comment links require same-author same-version can_comment, while lifecycle requests carry no link',
    async () => {
      const otherCommentInvite = await createInviteWithGuests(canComment, [
        'Foreign comment author',
      ]);
      const createComment = async (guest, requestId = randomUUID()) => {
        const body = {
          requestId,
          expectedGuestId: guest.guestId,
          operation: 'create',
          targets: [{ photoId, versionId }],
          body: 'annotation link fixture',
        };
        const result = await readJson(await commentCommand(guest, body), 200);
        return { commentId: result.items[0].commentId, result, body };
      };
      const createCommentWithId = async (
        guest,
        commentId,
        requestId = randomUUID(),
      ) => {
        const body = {
          requestId,
          expectedGuestId: guest.guestId,
          operation: 'create',
          targets: [{ photoId, versionId }],
          body: 'annotation uppercase comment link fixture',
        };
        const targetsJson = JSON.stringify([{ commentId, photoId, versionId }]);
        await db
          .prepare(
            'INSERT INTO guest_comment_commands(id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,workspace_id,project_id,album_id,operation,request_json,targets_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            guest.guestId,
            guest.inviteId,
            guest.sessionId,
            hashGuestSession(guest.secret),
            guest.guestId,
            requestId,
            versionFixture.workspaceId,
            versionFixture.projectId,
            albumId,
            'create',
            JSON.stringify(body),
            targetsJson,
          )
          .run();
        const receipt = await db
          .prepare(
            'SELECT result_json AS resultJson FROM guest_comment_results WHERE guest_id=? AND request_id=?',
          )
          .bind(guest.guestId, requestId)
          .first();
        assert.ok(receipt?.resultJson);
        const result = JSON.parse(receipt.resultJson);
        return { commentId: result.items[0].commentId, result, body };
      };
      const ownComment = await createCommentWithId(
        linkedAuthor,
        randomUUID().toUpperCase(),
      );
      const peerComment = await createComment(linkedPeer);
      const foreignComment = await createComment(otherCommentInvite.guests[0]);
      const deletedComment = await createComment(linkedAuthor);
      await readJson(
        await commentCommand(linkedAuthor, {
          requestId: randomUUID(),
          expectedGuestId: linkedAuthor.guestId,
          operation: 'delete',
          commentId: deletedComment.commentId,
          expectedRevision: 1,
        }),
        200,
      );

      const linkedCreate = await createAnnotation(
        linkedAuthor,
        createBody(
          linkedAuthor,
          point(321000, 654000),
          { color: 'amber' },
          randomUUID(),
          ownComment.commentId,
        ),
      );
      assert.equal(linkedCreate.result.item.commentId, ownComment.commentId);
      assert.equal(
        linkedCreate.result.item.commentId,
        ownComment.commentId.toUpperCase(),
        'Legacy uppercase Guest comment IDs retain their exact stored identity',
      );

      for (const commentId of [
        peerComment.commentId,
        foreignComment.commentId,
        deletedComment.commentId,
      ])
        await expectDenied(
          await command(
            linkedAuthor,
            createBody(
              linkedAuthor,
              point(5, 5),
              { color: 'red' },
              randomUUID(),
              commentId,
            ),
          ),
        );

      const linkedId = linkedCreate.result.item.annotationId;
      const linkedResolvedBody = {
        requestId: randomUUID(),
        expectedGuestId: linkedAuthor.guestId,
        operation: 'resolve',
        annotationId: linkedId,
        expectedRevision: 1,
      };
      const linkedResolved = await readJson(
        await command(linkedAuthor, linkedResolvedBody),
        200,
      );
      assert.equal(linkedResolved.item.commentId, ownComment.commentId);
      assert.equal(linkedResolved.item.state, 'resolved');
      const linkedReopened = await readJson(
        await command(linkedAuthor, {
          requestId: randomUUID(),
          expectedGuestId: linkedAuthor.guestId,
          operation: 'reopen',
          annotationId: linkedId,
          expectedRevision: 2,
        }),
        200,
      );
      assert.equal(linkedReopened.item.commentId, ownComment.commentId);
      const linkedDeleted = await readJson(
        await command(linkedAuthor, {
          requestId: randomUUID(),
          expectedGuestId: linkedAuthor.guestId,
          operation: 'delete',
          annotationId: linkedId,
          expectedRevision: 3,
        }),
        200,
      );
      assert.equal(linkedDeleted.item.commentId, null);
      assert.equal(linkedDeleted.item.state, 'deleted');

      assert.deepEqual((await readOwn(linkedPeer)).items, []);
    },
  );
  await check(
    'Guest annotation request IDs share the existing Guest ledger namespace symmetrically and case-insensitively',
    async () => {
      const legacyUpper = randomUUID().toUpperCase();
      const legacyLower = legacyUpper.toLowerCase();
      const legacyCommentId = randomUUID();
      const legacyBody = 'uppercase legacy request alias';
      const requestJson = JSON.stringify({
        requestId: legacyUpper,
        expectedGuestId: namespaceGuest.guestId,
        operation: 'create',
        targets: [{ photoId, versionId }],
        body: legacyBody,
      });
      const targetsJson = JSON.stringify([
        { commentId: legacyCommentId, photoId, versionId },
      ]);
      await db
        .prepare(
          'INSERT INTO guest_comment_commands(id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,workspace_id,project_id,album_id,operation,request_json,targets_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          randomUUID(),
          namespaceGuest.guestId,
          namespace.invite.id,
          namespaceGuest.sessionId,
          hashGuestSession(namespaceGuest.secret),
          namespaceGuest.guestId,
          legacyUpper,
          versionFixture.workspaceId,
          versionFixture.projectId,
          albumId,
          'create',
          requestJson,
          targetsJson,
        )
        .run();
      await expectRequestConflict(
        await command(
          namespaceGuest,
          createBody(
            namespaceGuest,
            point(4, 5),
            { color: 'amber' },
            legacyLower,
          ),
        ),
      );

      const annotationFirstId = randomUUID();
      const annotationFirst = await createAnnotation(
        namespaceGuest,
        createBody(
          namespaceGuest,
          point(800000, 100000),
          { color: 'blue' },
          annotationFirstId,
        ),
      );
      assert.equal(annotationFirst.result.requestId, annotationFirstId);
      const commentConflict = await commentCommand(namespaceGuest, {
        requestId: annotationFirstId,
        expectedGuestId: namespaceGuest.guestId,
        operation: 'create',
        targets: [{ photoId, versionId }],
        body: 'must rollback on annotation namespace collision',
      });
      await expectRequestConflict(commentConflict);
      for (const [table, requestColumn] of [
        ['guest_comment_commands', 'request_id'],
        ['guest_comment_results', 'request_id'],
      ]) {
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM ' +
                  table +
                  ' WHERE ' +
                  requestColumn +
                  '=?',
              )
              .bind(annotationFirstId)
              .first()
          )?.n,
          0,
        );
      }
    },
  );

  await check(
    'Guest annotation audit failure rolls the complete command back and permits exact retry',
    async () => {
      const requestId = randomUUID();
      const input = createBody(
        namespaceGuest,
        rectangle(200000, 200000, 250000, 250000),
        { color: 'red' },
        requestId,
      );
      const before = await counts();
      await db.exec(
        "CREATE TRIGGER guest_annotation_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.actor_type='guest' AND NEW.action LIKE 'annotation.%' BEGIN SELECT RAISE(ABORT,'TEST_GUEST_ANNOTATION_AUDIT_FAILURE'); END",
      );
      try {
        await expectError(
          await command(namespaceGuest, input),
          503,
          'GUEST_ANNOTATIONS_UNAVAILABLE',
        );
      } finally {
        await db.exec('DROP TRIGGER guest_annotation_test_audit_failure');
      }
      assert.deepEqual(await counts(), before);
      for (const [table, requestColumn] of [
        ['guest_annotation_commands', 'request_id'],
        ['guest_annotations', 'last_request_id'],
        ['guest_annotation_changes', 'request_id'],
        ['guest_annotation_results', 'request_id'],
      ])
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM ' +
                  table +
                  ' WHERE ' +
                  requestColumn +
                  '=?',
              )
              .bind(requestId)
              .first()
          )?.n,
          0,
        );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(requestId)
            .first()
        )?.n,
        0,
      );
      const retried = await createAnnotation(namespaceGuest, input);
      assert.equal(retried.result.requestId, requestId);
      assert.equal(retried.result.item.revision, 1);
    },
  );

  await check(
    'Guest annotation history and audit keep one exact actor/session/scope witness per revision',
    async () => {
      const changes = await db
        .prepare(
          'SELECT ch.seq,ch.event_id AS eventId,ch.command_id AS commandId,ch.request_id AS requestId,ch.guest_id AS guestId,ch.invite_id AS inviteId,ch.session_id AS sessionId,ch.workspace_id AS workspaceId,ch.project_id AS projectId,ch.album_id AS albumId,ch.photo_id AS photoId,ch.version_id AS versionId,ch.annotation_id AS annotationId,ch.operation,ch.revision,ch.occurred_at_ms AS occurredAtMs,ch.before_json AS beforeJson,ch.after_json AS afterJson,a.actor_type AS actorType,a.actor_id AS actorId,a.guest_session_id AS auditGuestSessionId,a.session_id AS auditOwnerSessionId,a.action,a.before_json AS auditBeforeJson,a.after_json AS auditAfterJson,a.request_id AS auditRequestId,a.occurred_at_utc AS occurredAtUtc FROM guest_annotation_changes ch JOIN audit_events a ON a.event_id=ch.event_id WHERE ch.annotation_id=? ORDER BY ch.revision',
        )
        .bind(primary.annotationId)
        .all();
      assert.equal(changes.results.length, 5);
      assert.deepEqual(
        changes.results.map((row) => row.operation),
        ['create', 'update', 'resolve', 'reopen', 'delete'],
      );
      const actionByOperation = {
        create: 'annotation.created',
        update: 'annotation.updated',
        resolve: 'annotation.resolved',
        reopen: 'annotation.reopened',
        delete: 'annotation.deleted',
      };
      for (const row of changes.results) {
        assert.equal(
          row.eventId,
          'guest-annotation:' + primary.annotationId + ':' + row.revision,
        );
        assert.equal(row.guestId, author.guestId);
        assert.equal(row.inviteId, annotationOnly.invite.id);
        assert.equal(row.sessionId, author.sessionId);
        assert.equal(row.workspaceId, versionFixture.workspaceId);
        assert.equal(row.projectId, versionFixture.projectId);
        assert.equal(row.albumId, albumId);
        assert.equal(row.photoId, photoId);
        assert.equal(row.versionId, versionId);
        assert.equal(row.actorType, 'guest');
        assert.equal(row.actorId, author.guestId);
        assert.equal(row.auditGuestSessionId, author.sessionId);
        assert.equal(row.auditOwnerSessionId, null);
        assert.equal(row.action, actionByOperation[row.operation]);
        assert.equal(row.auditRequestId, row.requestId);
        assert.equal(row.auditBeforeJson, row.beforeJson);
        assert.equal(row.auditAfterJson, row.afterJson);
        assert.equal(
          row.occurredAtUtc,
          new Date(row.occurredAtMs).toISOString(),
        );
        const before = JSON.parse(row.beforeJson);
        const after = JSON.parse(row.afterJson);
        assert.deepEqual(Object.keys(before), [
          'annotationId',
          'revision',
          'state',
          'geometry',
          'style',
          'commentId',
        ]);
        assert.deepEqual(Object.keys(after), [
          'annotationId',
          'revision',
          'state',
          'geometry',
          'style',
          'commentId',
        ]);
        for (const privateValue of [
          author.secret,
          author.guestId,
          author.sessionId,
          annotationOnly.invite.id,
          'object_key',
          'objectKey',
          'originalUrl',
          'thumbnailUrl',
          'previewUrl',
        ])
          assert.equal(
            row.beforeJson.includes(privateValue) ||
              row.afterJson.includes(privateValue),
            false,
          );
      }
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE event_id IN(SELECT event_id FROM guest_annotation_changes WHERE annotation_id=?)',
            )
            .bind(primary.annotationId)
            .first()
        )?.n,
        changes.results.length,
      );
      const globalWitnessCount = await db
        .prepare(
          "SELECT (SELECT count(*) FROM audit_events WHERE action IN('annotation.created','annotation.updated','annotation.deleted','annotation.resolved','annotation.reopened')) AS audits,(SELECT count(*) FROM guest_annotation_changes) AS changes",
        )
        .first();
      assert.equal(globalWitnessCount.audits, globalWitnessCount.changes);
    },
  );
  await check(
    'Guest annotation routes enforce strict bounded JSON, exact Origin, and current scoped cursors',
    async () => {
      const boundaryInput = createBody(namespaceGuest);
      await expectError(
        await send(worker, commandPath, {
          method: 'POST',
          secret: namespaceGuest.secret,
          body: JSON.stringify(boundaryInput),
          rawBody: true,
          extraHeaders: { Origin: origin, 'Content-Type': 'text/plain' },
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(worker, commandPath, {
          method: 'POST',
          secret: namespaceGuest.secret,
          body: boundaryInput,
          omitOrigin: true,
        }),
        403,
        'FORBIDDEN_ORIGIN',
      );
      const maliciousOrigin = await send(worker, commandPath, {
        method: 'POST',
        secret: namespaceGuest.secret,
        body: boundaryInput,
        extraHeaders: { Origin: 'https://attacker.invalid' },
      });
      const maliciousText = await maliciousOrigin.text();
      assert.equal(maliciousOrigin.status, 403);
      assert.ok(maliciousText.length > 0);
      await expectError(
        await send(worker, commandPath, {
          method: 'POST',
          secret: namespaceGuest.secret,
          body: 'x'.repeat(17000),
          rawBody: true,
          extraHeaders: { Origin: origin, 'Content-Type': 'application/json' },
        }),
        413,
        'BODY_TOO_LARGE',
      );
      await expectError(
        await send(worker, ownPath() + '?unknown=1', { secret: author.secret }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(worker, ownPath() + '?cursor=bad&cursor=bad', {
          secret: author.secret,
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(worker, ownPath() + '?annotationId=not-a-uuid&cursor=bad', {
          secret: author.secret,
        }),
        400,
        'INVALID_INPUT',
      );
      await expectDenied(
        await send(worker, ownPath(), {
          secret: '0'.repeat(64),
        }),
      );

      for (let index = 0; index < 25; index += 1)
        await createAnnotation(
          pageAuthor,
          createBody(pageAuthor, point(index * 1000, index * 1000), {
            color: 'amber',
          }),
        );
      const firstPage = await readOwn(pageAuthor);
      assert.equal(firstPage.items.length, 24);
      assert.ok(firstPage.nextCursor);
      const secondPage = await readOwn(
        pageAuthor,
        photoId,
        versionId,
        '?cursor=' + encodeURIComponent(firstPage.nextCursor),
      );
      assert.equal(secondPage.items.length, 1);
      assert.equal(secondPage.nextCursor, null);
      assert.equal(
        new Set(
          [...firstPage.items, ...secondPage.items].map(
            (item) => item.annotationId,
          ),
        ).size,
        25,
      );

      const sameIdentityNewSession = await createGuest(
        pagination.invite,
        'Pagination author',
        pageAuthor.guestId,
      );
      await expectError(
        await send(
          worker,
          ownPath(
            photoId,
            versionId,
            '?cursor=' + encodeURIComponent(firstPage.nextCursor),
          ),
          { secret: sameIdentityNewSession.secret },
        ),
        400,
        'INVALID_INPUT',
      );
      await createAnnotation(
        pageAuthor,
        createBody(pageAuthor, point(900000, 100000), { color: 'red' }),
      );
      await expectHistoryChanged(
        await send(
          worker,
          ownPath(
            photoId,
            versionId,
            '?cursor=' + encodeURIComponent(firstPage.nextCursor),
          ),
          { secret: pageAuthor.secret },
        ),
      );
      await expectError(
        await send(
          worker,
          ownPath(
            photoId,
            versionId,
            '?cursor=' + encodeURIComponent(firstPage.nextCursor),
          ),
          { secret: other.secret },
        ),
        400,
        'INVALID_INPUT',
      );
    },
  );

  await check(
    'Guest annotation capacity is lifetime per invite/photo/version; replay, edits, and tombstones remain available at capacity',
    async () => {
      const capacity = await createInviteWithGuests(canAnnotate, [
        'Capacity guest',
      ]);
      const capacityGuest = capacity.guests[0];
      const accepted = await createAnnotation(
        capacityGuest,
        createBody(capacityGuest, point(10, 20), { color: 'blue' }),
      );
      const insert = db.prepare(
        'INSERT INTO guest_annotation_commands(id,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,?)',
      );
      for (let start = 0; start < 999; start += 40) {
        const statements = [];
        for (let index = start; index < Math.min(start + 40, 999); index += 1) {
          const requestId = randomUUID();
          const geometry = point((index % 999) + 1, ((index * 3) % 999) + 1);
          const style = { color: ['amber', 'red', 'blue'][index % 3] };
          const input = {
            requestId,
            expectedGuestId: capacityGuest.guestId,
            operation: 'create',
            photoId,
            versionId,
            geometry,
            style,
            commentId: null,
          };
          statements.push(
            insert.bind(
              randomUUID(),
              capacityGuest.guestId,
              capacityGuest.guestId,
              capacity.invite.id,
              capacityGuest.sessionId,
              hashGuestSession(capacityGuest.secret),
              requestId,
              versionFixture.workspaceId,
              versionFixture.projectId,
              albumId,
              photoId,
              versionId,
              randomUUID(),
              'create',
              JSON.stringify(geometry),
              JSON.stringify(style),
              JSON.stringify(input),
            ),
          );
        }
        await db.batch(statements);
      }
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_annotations WHERE invite_id=? AND photo_id=? AND version_id=?',
            )
            .bind(capacity.invite.id, photoId, versionId)
            .first()
        )?.n,
        1000,
      );
      assert.deepEqual(
        await readJson(await command(capacityGuest, accepted.body), 200),
        accepted.result,
      );
      await expectLimitReached(
        await command(capacityGuest, createBody(capacityGuest)),
      );

      const atCapacityUpdate = {
        requestId: randomUUID(),
        expectedGuestId: capacityGuest.guestId,
        operation: 'update',
        annotationId: accepted.result.item.annotationId,
        expectedRevision: 1,
        geometry: rectangle(300000, 300000, 100000, 100000),
        style: { color: 'red' },
        commentId: null,
      };
      const updated = await readJson(
        await command(capacityGuest, atCapacityUpdate),
        200,
      );
      assert.equal(updated.item.revision, 2);
      const deleted = await readJson(
        await command(capacityGuest, {
          requestId: randomUUID(),
          expectedGuestId: capacityGuest.guestId,
          operation: 'delete',
          annotationId: accepted.result.item.annotationId,
          expectedRevision: 2,
        }),
        200,
      );
      assert.equal(deleted.item.state, 'deleted');
      assert.deepEqual(
        await readJson(await command(capacityGuest, accepted.body), 200),
        accepted.result,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_annotations WHERE invite_id=? AND photo_id=? AND version_id=?',
            )
            .bind(capacity.invite.id, photoId, versionId)
            .first()
        )?.n,
        1000,
      );
    },
  );
  await check(
    'Guest annotation history exposes metadata transitions only and history reads need no can_annotate grant',
    async () => {
      const historyWorker = await mf.getWorker('guest-history-test');
      const created = await createAnnotation(
        historyAuthor,
        createBody(historyAuthor, point(700000, 100000), { color: 'amber' }),
      );
      const annotationId = created.result.item.annotationId;
      const operations = [
        {
          operation: 'update',
          expectedRevision: 1,
          geometry: rectangle(100000, 100000, 200000, 200000),
          style: { color: 'red' },
          commentId: null,
        },
        { operation: 'resolve', expectedRevision: 2 },
        { operation: 'reopen', expectedRevision: 3 },
        { operation: 'delete', expectedRevision: 4 },
      ];
      for (const operation of operations)
        await readJson(
          await command(historyAuthor, {
            requestId: randomUUID(),
            expectedGuestId: historyAuthor.guestId,
            annotationId,
            ...operation,
          }),
          200,
        );

      const path =
        '/api/guest/me/activity?albumId=' +
        encodeURIComponent(albumId) +
        '&photoId=' +
        encodeURIComponent(photoId);
      const authorPage = guestHistoryPageSchema.parse(
        await readJson(
          await send(historyWorker, path, { secret: historyAuthor.secret }),
          200,
        ),
      );
      const expected = [
        'annotation.created',
        'annotation.updated',
        'annotation.resolved',
        'annotation.reopened',
        'annotation.deleted',
      ];
      const events = authorPage.items.filter((event) =>
        event.action.startsWith('annotation.'),
      );
      assert.deepEqual(
        new Set(events.map((event) => event.action)),
        new Set(expected),
      );
      for (const event of events) {
        assert.equal(event.photoId, photoId);
        assert.equal(event.versionId, versionId);
        assert.deepEqual(Object.keys(event.detail).sort(), ['after', 'before']);
        for (const side of ['before', 'after']) {
          assert.deepEqual(Object.keys(event.detail[side]).sort(), [
            'annotationId',
            'revision',
            'state',
          ]);
          assert.equal(event.detail[side].annotationId, annotationId);
        }
        for (const privateValue of [
          'geometry',
          'style',
          'commentId',
          'body',
          historyAuthor.guestId,
          historyPeer.guestId,
          historyAuthor.sessionId,
          historyAuthor.secret,
          historyAuthor.inviteId,
        ])
          assert.equal(
            JSON.stringify(event.detail).includes(privateValue),
            false,
          );
      }

      const peerPage = guestHistoryPageSchema.parse(
        await readJson(
          await send(historyWorker, path, { secret: historyPeer.secret }),
          200,
        ),
      );
      assert.equal(peerPage.guestId, historyPeer.guestId);
      assert.deepEqual(peerPage.items, []);

      const historyOnlyPage = guestHistoryPageSchema.parse(
        await readJson(
          await send(historyWorker, path, { secret: historyOnlyGuest.secret }),
          200,
        ),
      );
      assert.equal(historyOnlyPage.guestId, historyOnlyGuest.guestId);
      assert.deepEqual(historyOnlyPage.items, []);
      assert.equal(
        (
          await db
            .prepare('SELECT permissions_mask FROM guest_invites WHERE id=?')
            .bind(historyOnly.invite.id)
            .first()
        )?.permissions_mask,
        canViewOwnHistory,
      );
    },
  );

  await check(
    'Guest annotation command, projection, history, result, and audit guards block UPDATE, DELETE, REPLACE, forged siblings, and wrong predecessors',
    async () => {
      const commandRow = await db
        .prepare(
          'SELECT id FROM guest_annotation_commands WHERE guest_id=? AND invite_id=? AND request_id=?',
        )
        .bind(
          author.guestId,
          annotationOnly.invite.id,
          primaryCreate.result.requestId,
        )
        .first();
      assert.ok(commandRow?.id);
      const before = await counts();

      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_annotations SET revision=revision+1 WHERE id=?',
          )
          .bind(primary.annotationId)
          .run(),
        /INVALID_GUEST_ANNOTATION_PREDECESSOR/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_annotations WHERE id=?')
          .bind(primary.annotationId)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO guest_annotations SELECT * FROM guest_annotations WHERE id=?',
          )
          .bind(primary.annotationId)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION/,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_annotation_commands SET request_json=? WHERE id=?',
          )
          .bind('{}', commandRow.id)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_COMMAND/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_annotation_commands WHERE id=?')
          .bind(commandRow.id)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_COMMAND/,
      );
      await db
        .prepare(
          'INSERT OR REPLACE INTO guest_annotation_commands SELECT * FROM guest_annotation_commands WHERE id=?',
        )
        .bind(commandRow.id)
        .run();
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_annotation_changes SET after_json=? WHERE annotation_id=?',
          )
          .bind('{}', primary.annotationId)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_CHANGE/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_annotation_changes WHERE annotation_id=?')
          .bind(primary.annotationId)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_CHANGE/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO guest_annotation_changes SELECT * FROM guest_annotation_changes WHERE annotation_id=? AND revision=1',
          )
          .bind(primary.annotationId)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_CHANGE/,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE guest_annotation_results SET result_json=? WHERE command_id=?',
          )
          .bind('{}', commandRow.id)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_RESULT/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_annotation_results WHERE command_id=?')
          .bind(commandRow.id)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_RESULT/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO guest_annotation_results SELECT * FROM guest_annotation_results WHERE command_id=?',
          )
          .bind(commandRow.id)
          .run(),
        /IMMUTABLE_GUEST_ANNOTATION_RESULT/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO guest_annotation_changes(event_id,command_id,request_id,guest_id,invite_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,annotation_id,operation,revision,occurred_at_ms,before_json,after_json) SELECT 'guest-annotation:'||c.annotation_id||':999',c.id,c.request_id,c.guest_id,c.invite_id,c.session_id,c.workspace_id,c.project_id,c.album_id,c.photo_id,c.version_id,c.annotation_id,c.operation,999,c.created_at_ms,'{}','{}' FROM guest_annotation_commands c WHERE c.id=?",
          )
          .bind(commandRow.id)
          .run(),
        /INVALID_GUEST_ANNOTATION_CHANGE/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,action,before_json,after_json,request_id,occurred_at_utc) VALUES(?, 'guest', ?, ?, 'annotation.created', '{}', '{}', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
          )
          .bind(randomUUID(), author.guestId, author.sessionId, randomUUID())
          .run(),
        /INVALID_GUEST_ANNOTATION_AUDIT/,
      );
      assert.deepEqual(await counts(), before);
    },
  );

  await check(
    'Own annotation pages and watermarks use complete author-scope indexes',
    async () => {
      await assertGuestAnnotationOwnPlans(db, {
        guestId: peer.guestId,
        inviteId: peer.inviteId,
        workspaceId: versionFixture.workspaceId,
        projectId: versionFixture.projectId,
        albumId,
        photoId,
        versionId,
      });
    },
  );

  const createBrowserFixture = async () => {
    const browserPermissionMask =
      1 | canAnnotate | canComment | canViewOwnHistory | 2048;
    const authorBundle = await createInviteWithGuests(browserPermissionMask, [
      'Annotation browser author',
      'Annotation browser peer',
    ]);
    const otherBundle = await createInviteWithGuests(browserPermissionMask, [
      'Annotation browser other invite',
    ]);
    const browserAuthor = authorBundle.guests[0];
    const browserPeer = authorBundle.guests[1];
    const otherGuest = otherBundle.guests[0];
    const seeded = await createAnnotation(
      browserAuthor,
      createBody(browserAuthor, point(250000, 350000), { color: 'amber' }),
    );
    const peerSeeded = await createAnnotation(
      browserPeer,
      createBody(browserPeer, rectangle(600000, 200000, 150000, 250000), {
        color: 'blue',
      }),
    );
    const otherSeeded = await createAnnotation(
      otherGuest,
      createBody(otherGuest, point(800000, 700000), { color: 'red' }),
    );
    const annotationFixture = {
      workspaceId: versionFixture.workspaceId,
      projectId: versionFixture.projectId,
      albumId,
      photoId,
      versionId,
      currentVersionId: versionFixture.currentVersionId,
      draftVersionId: versionFixture.unpublishedVersionId,
      filename: versionFixture.filename,
      permissionsMask: browserPermissionMask,
      inviteId: authorBundle.invite.id,
      inviteToken: authorBundle.invite.token,
      authorInviteId: browserAuthor.inviteId,
      authorGuestId: browserAuthor.guestId,
      authorSessionId: browserAuthor.sessionId,
      secretAuthor: browserAuthor.secret,
      guestSecret: browserAuthor.secret,
      guestSessionId: browserAuthor.sessionId,
      authorLabel: 'Annotation browser author',
      peerGuestId: browserPeer.guestId,
      peerSessionId: browserPeer.sessionId,
      secretPeer: browserPeer.secret,
      peerGuestSecret: browserPeer.secret,
      peerGuestSessionId: browserPeer.sessionId,
      peerAnnotationId: peerSeeded.result.item.annotationId,
      peerAuthorGuestId: browserPeer.guestId,
      peerAuthorLabel: 'Annotation browser peer',
      otherInviteId: otherGuest.inviteId,
      otherGuestId: otherGuest.guestId,
      otherSessionId: otherGuest.sessionId,
      secretOtherInvite: otherGuest.secret,
      otherAuthorLabel: 'Annotation browser other invite',
      otherInviteAnnotationId: otherSeeded.result.item.annotationId,
      annotationId: seeded.result.item.annotationId,
      seededAnnotation: seeded.result.item,
      workerName: 'guest-annotations-test',
      createScopedGuestBundle: (mask, names, expiresAtMs) =>
        createInviteWithGuests(mask, names, expiresAtMs),
    };
    assert.equal(annotationFixture.versionId, versionFixture.latestVersionId);
    return annotationFixture;
  };

  return {
    albumId,
    photoId,
    versionId,
    workerName: 'guest-annotations-test',
    disabledWorker,
    createBrowserFixture,
  };
}
