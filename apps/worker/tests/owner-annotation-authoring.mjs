import { makeSignature } from 'better-auth/crypto';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  ownerAnnotationAuthoringCapabilitiesSchema,
  ownerAnnotationCommandSchema,
  ownerAnnotationResultSchema,
  ownerAuthoredAnnotationPageSchema,
} from '../../../packages/contracts/src/owner-annotation-authoring.ts';
import { guestSharedAnnotationsPageSchema } from '../../../packages/contracts/src/annotation-threads.ts';
import { guestAnnotationResultSchema } from '../../../packages/contracts/src/guest-annotations.ts';
import { guestCommentResultSchema } from '../../../packages/contracts/src/guest-comments.ts';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function ownerAnnotationAuthoringChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  request,
  authSecret,
  annotationFixture,
}) {
  const fixture = annotationFixture;
  assert.ok(fixture?.inviteId && fixture?.albumId && fixture?.photoId);
  assert.ok(
    fixture?.versionId && fixture?.annotationId && fixture?.authorGuestId,
  );
  assert.ok(fixture?.guestSecret && fixture?.guestSessionId);
  assert.ok(fixture?.peerGuestSecret && fixture?.peerAuthorGuestId);
  assert.ok(fixture?.otherInviteId && fixture?.otherGuestId);
  assert.ok(fixture?.secretOtherInvite);
  assert.ok(fixture?.createScopedGuestBundle);
  assert.equal(typeof request, 'function');
  assert.equal(typeof cookies?.headers, 'function');

  const authoringWorker = await mf.getWorker('owner-annotation-authoring-test');
  const ownerReadWorker = await mf.getWorker('owner-annotations-test');
  const guestAnnotationWorker = await mf.getWorker(
    fixture.workerName ?? 'guest-annotations-test',
  );
  const guestCommentWorker = await mf.getWorker('guest-comments-test');
  const ownerCommentsWorker = await mf.getWorker('owner-comments-test');
  const ownerProcessingWorker = await mf.getWorker('owner-processing-test');
  const storageWorker = await mf.getWorker('storage-test');
  const disabledWorker = await mf.getWorker('app');
  const ownerCookie = cookies.headers();
  const origin = new URL(base).origin;
  const albumId = fixture.albumId;
  const photoId = fixture.photoId;
  const versionId = fixture.versionId;
  const inviteId = fixture.inviteId;
  const commandPath =
    '/api/v1/albums/' + albumId + '/annotations/owner/commands';
  const capabilitiesPath = '/api/v1/annotations/authoring/capabilities';
  const pagePath = (targetInviteId, options = {}) => {
    const url = new URL(
      '/api/v1/albums/' +
        albumId +
        '/photos/' +
        (options.photoId ?? photoId) +
        '/versions/' +
        (options.versionId ?? versionId) +
        '/annotations/owner',
      base,
    );
    url.searchParams.set('inviteId', targetInviteId);
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    if (options.annotationId)
      url.searchParams.set('annotationId', options.annotationId);
    return url.pathname + url.search;
  };
  const guestAnnotationPath = (
    targetPhotoId = photoId,
    targetVersionId = versionId,
    annotationId,
  ) => {
    const url = new URL(
      '/api/guest/albums/' +
        albumId +
        '/photos/' +
        targetPhotoId +
        '/versions/' +
        targetVersionId +
        '/annotations/own',
      base,
    );
    if (annotationId) url.searchParams.set('annotationId', annotationId);
    return url.pathname + url.search;
  };
  const guestSharedAnnotationPath = (
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
    '/annotations/shared' +
    query;
  const ownerSend = (
    targetWorker,
    path,
    {
      method = 'GET',
      body,
      cookie = ownerCookie,
      includeCookie = true,
      omitOrigin = false,
      contentType = 'application/json',
      expectedActor = owner,
      extraHeaders = {},
    } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    if (includeCookie && cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') {
      if (!omitOrigin) headers.Origin = origin;
      headers['Content-Type'] = contentType;
      if (expectedActor !== null)
        headers['X-Kino-Expected-Actor'] = expectedActor;
    }
    Object.assign(headers, extraHeaders);
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return targetWorker.fetch(new Request(new URL(path, base), init));
  };
  const guestSend = (
    targetWorker,
    path,
    { method = 'GET', body, secret } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    if (secret) {
      const cookieName =
        new URL(base).protocol === 'https:'
          ? '__Host-kino_guest'
          : 'kino_guest';
      headers.Cookie = cookieName + '=' + secret;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      headers.Origin = origin;
      headers['Content-Type'] = 'application/json';
    }
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return targetWorker.fetch(new Request(new URL(path, base), init));
  };
  const readJson = async (response) => parseJson(await response.text());
  const expectError = async (response, status, code) => {
    const body = await readJson(response);
    assert.equal(response.status, status, JSON.stringify(body));
    if (code) assert.equal(body?.error?.code, code, JSON.stringify(body));
    return body;
  };
  const postOwner = (body, options = {}) =>
    ownerSend(authoringWorker, commandPath, {
      method: 'POST',
      body,
      ...options,
    });
  const postGuestAnnotation = (
    guest,
    body,
    targetWorker = guestAnnotationWorker,
  ) =>
    guestSend(
      targetWorker,
      '/api/guest/albums/' + albumId + '/annotations/commands',
      {
        method: 'POST',
        body,
        secret: guest.secret,
      },
    );
  const readOwnerPage = async (targetInviteId, options = {}) => {
    const response = await ownerSend(
      options.targetWorker ?? authoringWorker,
      pagePath(targetInviteId, options),
      { cookie: options.cookie ?? ownerCookie },
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return ownerAuthoredAnnotationPageSchema.parse(body);
  };
  const readOwnerResult = async (response, expectedStatus = 200) => {
    const body = await readJson(response);
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    if (expectedStatus === 200) ownerAnnotationResultSchema.parse(body);
    return body;
  };
  const counts = async () => {
    const row = await db
      .prepare(
        'SELECT (SELECT count(*) FROM owner_annotation_commands) AS commands,' +
          '(SELECT count(*) FROM owner_annotations) AS annotations,' +
          '(SELECT count(*) FROM owner_annotation_changes) AS changes,' +
          '(SELECT count(*) FROM owner_annotation_results) AS results,' +
          "(SELECT count(*) FROM audit_events WHERE actor_type='user' AND actor_id=? " +
          "AND action LIKE 'owner.annotation_%') AS audit",
      )
      .bind(owner)
      .first();
    assert.ok(row);
    return row;
  };
  const readSnapshot = async () => ({
    owner: await counts(),
    guest: await db
      .prepare(
        'SELECT (SELECT count(*) FROM guest_annotation_commands) AS commands,' +
          '(SELECT count(*) FROM guest_annotations) AS annotations,' +
          '(SELECT count(*) FROM guest_annotation_changes) AS changes,' +
          '(SELECT count(*) FROM guest_annotation_results) AS results,' +
          "(SELECT count(*) FROM audit_events WHERE action LIKE 'annotation.%') AS audit",
      )
      .first(),
  });
  const createBody = (options = {}) => ({
    requestId: options.requestId ?? randomUUID(),
    expectedOwnerId: options.expectedOwnerId ?? owner,
    inviteId: options.inviteId ?? inviteId,
    photoId: options.photoId ?? photoId,
    versionId: options.versionId ?? versionId,
    operation: 'create',
    geometry: options.geometry ?? {
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: 170_000,
      y: 240_000,
    },
    style: options.style ?? { color: 'amber' },
    commentId: options.commentId ?? null,
  });
  const createOwnerAnnotation = async (options = {}) => {
    const body = createBody(options);
    ownerAnnotationCommandSchema.parse(body);
    const result = await readOwnerResult(await postOwner(body));
    assert.equal(result.ownerId, owner);
    assert.equal(result.requestId, body.requestId);
    assert.equal(result.operation, 'create');
    assert.equal(result.item.authorType, 'owner');
    assert.equal(result.item.canEdit, true);
    assert.equal(result.item.inviteId, body.inviteId);
    assert.equal(result.item.photoId, body.photoId);
    assert.equal(result.item.versionId, body.versionId);
    return { body, result, item: result.item };
  };
  const updateOwnerAnnotation = async (item, options = {}) => {
    const body = {
      requestId: options.requestId ?? randomUUID(),
      expectedOwnerId: options.expectedOwnerId ?? owner,
      inviteId: options.inviteId ?? item.inviteId,
      photoId: options.photoId ?? item.photoId,
      versionId: options.versionId ?? item.versionId,
      operation: 'update',
      annotationId: item.annotationId,
      expectedRevision: options.expectedRevision ?? item.revision,
      geometry: options.geometry ?? {
        type: 'rectangle',
        coordinateSpace: 'normalized_1e6',
        x: 310_000,
        y: 280_000,
        width: 125_000,
        height: 160_000,
      },
      style: options.style ?? { color: 'blue' },
      commentId: Object.hasOwn(options, 'commentId')
        ? options.commentId
        : item.commentId,
    };
    ownerAnnotationCommandSchema.parse(body);
    const result = await readOwnerResult(await postOwner(body));
    return { body, result, item: result.item };
  };
  const lifecycleOwnerAnnotation = async (operation, item, options = {}) => {
    const body = {
      requestId: options.requestId ?? randomUUID(),
      expectedOwnerId: options.expectedOwnerId ?? owner,
      inviteId: options.inviteId ?? item.inviteId,
      photoId: options.photoId ?? item.photoId,
      versionId: options.versionId ?? item.versionId,
      operation,
      annotationId: item.annotationId,
      expectedRevision: options.expectedRevision ?? item.revision,
    };
    ownerAnnotationCommandSchema.parse(body);
    const result = await readOwnerResult(await postOwner(body));
    return { body, result, item: result.item };
  };
  const createGuestComment = async (guest, label) => {
    const body = {
      requestId: randomUUID(),
      expectedGuestId: guest.guestId,
      operation: 'create',
      targets: [{ photoId, versionId }],
      body: label + ' ' + randomUUID(),
    };
    const response = await guestSend(
      guestCommentWorker,
      '/api/guest/albums/' + albumId + '/comments/commands',
      { method: 'POST', body, secret: guest.secret },
    );
    const result = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(result));
    guestCommentResultSchema.parse(result);
    assert.equal(result.items.length, 1);
    return { body, item: result.items[0] };
  };
  const deleteGuestComment = async (guest, item) => {
    const body = {
      requestId: randomUUID(),
      expectedGuestId: guest.guestId,
      operation: 'delete',
      commentId: item.commentId,
      expectedRevision: item.revision,
    };
    const response = await guestSend(
      guestCommentWorker,
      '/api/guest/albums/' + albumId + '/comments/commands',
      { method: 'POST', body, secret: guest.secret },
    );
    const result = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(result));
    const parsed = guestCommentResultSchema.parse(result);
    assert.equal(parsed.items.length, 1);
    return parsed.items[0];
  };
  const createGuestAnnotation = async (guest, options = {}) => {
    const body = {
      requestId: options.requestId ?? randomUUID(),
      expectedGuestId: guest.guestId,
      operation: 'create',
      photoId: options.photoId ?? photoId,
      versionId: options.versionId ?? versionId,
      geometry: {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 410_000,
        y: 380_000,
      },
      style: { color: 'red' },
      commentId: null,
    };
    const response = await postGuestAnnotation(guest, body);
    const result = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(result));
    return { body, result: guestAnnotationResultSchema.parse(result) };
  };
  const ownerReadPaths = (targetInviteId, options = {}) => {
    const url = new URL(
      '/api/v1/albums/' +
        albumId +
        '/photos/' +
        (options.photoId ?? photoId) +
        '/versions/' +
        (options.versionId ?? versionId) +
        '/annotations',
      base,
    );
    url.searchParams.set('inviteId', targetInviteId);
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    if (options.annotationId)
      url.searchParams.set('annotationId', options.annotationId);
    return url.pathname + url.search;
  };
  const readOwnerReadOnlyPage = async (targetInviteId, options = {}) => {
    const response = await ownerSend(
      ownerReadWorker,
      ownerReadPaths(targetInviteId, options),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const createFreshOwnerSession = async (ttlMs = 600_000) => {
    const sessionId = randomUUID();
    const token = 'owner-annotation-authoring:' + randomUUID();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(sessionId, token, owner, now + ttlMs, now, now)
      .run();
    const cookiePart = ownerCookie
      .split(';')
      .map((value) => value.trim())
      .find((value) =>
        value.slice(0, value.indexOf('=')).endsWith('.session_token'),
      );
    assert.ok(cookiePart);
    const cookieName = cookiePart.slice(0, cookiePart.indexOf('='));
    const cookie =
      cookieName +
      '=' +
      encodeURIComponent(
        token + '.' + (await makeSignature(token, authSecret)),
      );
    return { sessionId, token, cookie };
  };
  const guestCreateBody = (guest, options = {}) => ({
    requestId: options.requestId ?? randomUUID(),
    expectedGuestId: guest.guestId,
    operation: 'create',
    photoId: options.photoId ?? photoId,
    versionId: options.versionId ?? versionId,
    geometry: {
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: 590_000,
      y: 120_000,
    },
    style: { color: 'blue' },
    commentId: null,
  });
  const hashGuestSecret = (secret) =>
    createHash('sha256')
      .update('kino-pic:guest-session:v1:' + secret)
      .digest('hex');
  const currentOwnerSessionId = async () => {
    const response = await request('/api/auth/get-session', {
      headers: { Cookie: ownerCookie },
    });
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.ok(body?.session?.id);
    return body.session.id;
  };
  const guardedOwnerCreateStatement = (
    targetInviteId,
    sessionId,
    annotationId,
    requestId = randomUUID(),
    index = 0,
  ) => {
    const geometry = {
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: 1 + ((index * 7919) % 900_000),
      y: 1 + ((index * 3571) % 900_000),
    };
    const style = { color: ['amber', 'red', 'blue'][index % 3] };
    const body = {
      requestId,
      expectedOwnerId: owner,
      operation: 'create',
      inviteId: targetInviteId,
      photoId,
      versionId,
      geometry,
      style,
      commentId: null,
    };
    return db
      .prepare(
        'INSERT INTO owner_annotation_commands(id,actor_id,expected_owner_id,session_id,request_id,' +
          'workspace_id,project_id,album_id,invite_id,photo_id,version_id,annotation_id,' +
          'operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) ' +
          'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,?)',
      )
      .bind(
        randomUUID(),
        owner,
        owner,
        sessionId,
        requestId,
        fixture.workspaceId,
        fixture.projectId,
        albumId,
        targetInviteId,
        photoId,
        versionId,
        annotationId,
        'create',
        JSON.stringify(geometry),
        JSON.stringify(style),
        JSON.stringify(body),
      );
  };
  const guardedGuestCreateStatement = (
    guest,
    targetInviteId,
    annotationId,
    requestId = randomUUID(),
    index = 0,
  ) => {
    const geometry = {
      type: 'point',
      coordinateSpace: 'normalized_1e6',
      x: 2 + ((index * 6151) % 900_000),
      y: 2 + ((index * 4001) % 900_000),
    };
    const style = { color: ['blue', 'amber', 'red'][index % 3] };
    const body = {
      requestId,
      expectedGuestId: guest.guestId,
      operation: 'create',
      photoId,
      versionId,
      geometry,
      style,
      commentId: null,
    };
    return db
      .prepare(
        'INSERT INTO guest_annotation_commands(id,guest_id,expected_guest_id,invite_id,session_id,' +
          'secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,' +
          'annotation_id,operation,expected_revision,geometry_json,style_json,linked_comment_id,request_json) ' +
          'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,?)',
      )
      .bind(
        randomUUID(),
        guest.guestId,
        guest.guestId,
        targetInviteId,
        guest.sessionId,
        hashGuestSecret(guest.secret),
        requestId,
        fixture.workspaceId,
        fixture.projectId,
        albumId,
        photoId,
        versionId,
        annotationId,
        'create',
        JSON.stringify(geometry),
        JSON.stringify(style),
        JSON.stringify(body),
      );
  };

  let ownerCreated;
  let linkedComment;

  await check(
    'Owner annotation authoring has an independent gate and requires a current Owner session',
    async () => {
      const enabled = await readJson(
        await ownerSend(authoringWorker, capabilitiesPath),
      );
      assert.deepEqual(
        ownerAnnotationAuthoringCapabilitiesSchema.parse(enabled),
        {
          enabled: true,
        },
      );
      const disabled = await readJson(
        await ownerSend(disabledWorker, capabilitiesPath),
      );
      assert.deepEqual(
        ownerAnnotationAuthoringCapabilitiesSchema.parse(disabled),
        {
          enabled: false,
        },
      );
      assert.deepEqual(
        await readJson(
          await ownerSend(
            authoringWorker,
            '/api/guest/annotations/capabilities',
          ),
        ),
        { enabled: false },
      );
      assert.deepEqual(
        await readJson(
          await ownerSend(authoringWorker, '/api/v1/comments/capabilities'),
        ),
        { enabled: false },
      );
      assert.deepEqual(
        await readJson(
          await ownerSend(
            authoringWorker,
            '/api/v1/comment-processing/capabilities',
          ),
        ),
        { enabled: false },
      );
      assert.deepEqual(
        await readJson(
          await ownerSend(authoringWorker, '/api/v1/annotations/capabilities'),
        ),
        { enabled: true },
      );
      assert.deepEqual(
        await readJson(
          await ownerSend(
            authoringWorker,
            '/api/v1/photo-versions/capabilities',
          ),
        ),
        { enabled: true },
      );
      assert.deepEqual(
        await readJson(
          await ownerSend(authoringWorker, '/api/guest/capabilities'),
        ),
        { exchangeEnabled: false },
      );

      await expectError(
        await ownerSend(authoringWorker, pagePath(inviteId), {
          includeCookie: false,
        }),
        401,
        'AUTH_REQUIRED',
      );
      await expectError(
        await ownerSend(disabledWorker, commandPath, {
          method: 'POST',
          body: createBody(),
        }),
        503,
        'OWNER_ANNOTATION_AUTHORING_DISABLED',
      );
      for (const secret of [fixture.guestSecret, fixture.peerGuestSecret]) {
        await expectError(
          await guestSend(authoringWorker, pagePath(inviteId), { secret }),
          401,
          'AUTH_REQUIRED',
        );
        await expectError(
          await guestSend(authoringWorker, commandPath, {
            method: 'POST',
            body: createBody(),
            secret,
          }),
          401,
          'AUTH_REQUIRED',
        );
      }

      const noGrant = await fixture.createScopedGuestBundle(0, [
        'Owner annotation without Guest grants',
      ]);
      const noGrantInviteId = noGrant.inviteId ?? noGrant.invite?.id;
      assert.ok(noGrantInviteId);
      const before = await counts();
      const identityChanged = createBody({
        inviteId: noGrantInviteId,
        expectedOwnerId: randomUUID(),
      });
      await expectError(
        await postOwner(identityChanged),
        409,
        'OWNER_IDENTITY_CHANGED',
      );
      if (owner.toUpperCase() !== owner)
        await expectError(
          await postOwner({
            ...createBody({ inviteId: noGrantInviteId }),
            expectedOwnerId: owner.toUpperCase(),
          }),
          409,
          'OWNER_IDENTITY_CHANGED',
        );
      assert.deepEqual(await counts(), before);

      const injected = createBody({ inviteId: noGrantInviteId });
      for (const field of [
        { actorId: owner },
        { sessionId: randomUUID() },
        { expectedGuestId: fixture.authorGuestId },
        { photoVersionUrl: 'https://private.invalid/x' },
      ])
        await expectError(
          await postOwner({ ...injected, ...field }),
          400,
          'INVALID_INPUT',
        );
      await expectError(
        await postOwner(injected, { omitOrigin: true }),
        403,
        'FORBIDDEN_ORIGIN',
      );
      await expectError(
        await postOwner(injected, { contentType: 'text/plain' }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await postOwner({
          ...injected,
          requestId: injected.requestId.toUpperCase(),
        }),
        400,
        'INVALID_INPUT',
      );
      assert.deepEqual(await counts(), before);

      for (const badQuery of [
        '&cursor=x&annotationId=' + fixture.annotationId,
        '&unexpected=1',
        '&inviteId=' + inviteId,
      ])
        await expectError(
          await ownerSend(authoringWorker, pagePath(inviteId) + badQuery),
          400,
          'INVALID_INPUT',
        );
      await expectError(
        await ownerSend(
          authoringWorker,
          pagePath(inviteId, {
            photoId: randomUUID(),
          }),
        ),
        404,
        'NOT_FOUND',
      );
      await expectError(
        await ownerSend(authoringWorker, pagePath(inviteId).split('?')[0]),
        400,
        'INVALID_INPUT',
      );
      if (albumId.toUpperCase() !== albumId)
        await expectError(
          await ownerSend(
            authoringWorker,
            pagePath(inviteId).replace(
              '/albums/' + albumId + '/',
              '/albums/' + albumId.toUpperCase() + '/',
            ),
          ),
          404,
          'NOT_FOUND',
        );
      if (inviteId.toUpperCase() !== inviteId)
        await expectError(
          await ownerSend(authoringWorker, pagePath(inviteId.toUpperCase())),
          404,
          'NOT_FOUND',
        );
      if (photoId.toUpperCase() !== photoId)
        await expectError(
          await ownerSend(
            authoringWorker,
            pagePath(inviteId, {
              photoId: photoId.toUpperCase(),
            }),
          ),
          404,
          'NOT_FOUND',
        );
      if (versionId.toUpperCase() !== versionId)
        await expectError(
          await ownerSend(
            authoringWorker,
            pagePath(inviteId, {
              versionId: versionId.toUpperCase(),
            }),
          ),
          404,
          'NOT_FOUND',
        );
    },
  );

  await check(
    'Owner authoring is independent of Guest permission bits and may target private draft metadata',
    async () => {
      assert.ok(fixture.draftVersionId);
      const noGrant = await fixture.createScopedGuestBundle(0, [
        'Owner-only annotation grant test',
      ]);
      const noGrantInviteId = noGrant.inviteId ?? noGrant.invite?.id;
      assert.ok(noGrantInviteId);
      const before = await counts();
      const noGrantWrite = await createOwnerAnnotation({
        inviteId: noGrantInviteId,
      });
      assert.equal(noGrantWrite.item.inviteId, noGrantInviteId);

      const draftBundle = await fixture.createScopedGuestBundle(128, [
        'Owner annotation private draft Guest check',
      ]);
      const draftInviteId = draftBundle.inviteId ?? draftBundle.invite?.id;
      const draftGuest = draftBundle.guests?.[0] ?? draftBundle.guest;
      assert.ok(draftInviteId && draftGuest?.secret && draftGuest?.guestId);
      const draft = await createOwnerAnnotation({
        inviteId: draftInviteId,
        versionId: fixture.draftVersionId,
        geometry: {
          type: 'rectangle',
          coordinateSpace: 'normalized_1e6',
          x: 100_000,
          y: 110_000,
          width: 190_000,
          height: 210_000,
        },
      });
      assert.equal(draft.item.inviteId, draftInviteId);
      assert.equal(draft.item.versionId, fixture.draftVersionId);
      const page = await readOwnerPage(draftInviteId, {
        versionId: fixture.draftVersionId,
        annotationId: draft.item.annotationId,
      });
      assert.equal(page.ownerId, owner);
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].annotationId, draft.item.annotationId);
      assert.equal(page.items[0].authorType, 'owner');
      assert.equal(page.items[0].canEdit, true);
      assert.equal(page.items[0].commentId, null);
      const guestWrite = guestCreateBody(draftGuest, {
        versionId: fixture.draftVersionId,
      });
      const denied = await postGuestAnnotation(draftGuest, guestWrite);
      await expectError(denied, 401, 'GUEST_ACCESS_REQUIRED');
      assert.deepEqual(await counts(), {
        commands: Number(before.commands) + 2,
        annotations: Number(before.annotations) + 2,
        changes: Number(before.changes) + 2,
        results: Number(before.results) + 2,
        audit: Number(before.audit) + 2,
      });
      const serialized = JSON.stringify(page);
      for (const value of [
        fixture.guestSecret,
        fixture.peerGuestSecret,
        fixture.inviteToken,
        'object_key',
        'originalUrl',
        'previewUrl',
        'signedUrl',
        'photoBytes',
      ])
        if (value) assert.equal(serialized.includes(value), false);
    },
  );

  await check(
    'Owner create, update, CAS lifecycle, tombstones and exact replay retain genuine Owner provenance',
    async () => {
      const foreignComment = await createGuestComment(
        {
          guestId: fixture.otherGuestId,
          secret: fixture.secretOtherInvite,
        },
        'Guest comment from another invitation',
      );
      const beforeForeignLink = await counts();
      await expectError(
        await postOwner(
          createBody({ commentId: foreignComment.item.commentId }),
        ),
        409,
        'ANNOTATION_COMMENT_UNAVAILABLE',
      );
      assert.deepEqual(await counts(), beforeForeignLink);

      const sameInviteGuest = {
        guestId: fixture.authorGuestId,
        secret: fixture.guestSecret,
      };
      const removedComment = await createGuestComment(
        sameInviteGuest,
        'Deleted Guest comment must not link',
      );
      const removedItem = await deleteGuestComment(
        sameInviteGuest,
        removedComment.item,
      );
      assert.equal(removedItem.state, 'deleted');
      const beforeDeletedLink = await counts();
      await expectError(
        await postOwner(createBody({ commentId: removedItem.commentId })),
        409,
        'ANNOTATION_COMMENT_UNAVAILABLE',
      );
      assert.deepEqual(await counts(), beforeDeletedLink);

      linkedComment = await createGuestComment(
        {
          guestId: fixture.peerAuthorGuestId,
          secret: fixture.peerGuestSecret,
        },
        'Peer Guest comment for an Owner annotation',
      );
      const created = await createOwnerAnnotation({
        commentId: linkedComment.item.commentId,
      });
      ownerCreated = created;
      const originalReceipt = structuredClone(created.result);
      assert.equal(created.item.revision, 1);
      assert.equal(created.item.state, 'open');
      assert.equal(created.item.commentId, linkedComment.item.commentId);
      assert.ok(created.item.geometry && created.item.style);
      assert.ok(created.item.authorLabel.length > 0);
      assert.deepEqual(
        Object.keys(created.item).sort(),
        [
          'annotationId',
          'authorLabel',
          'authorType',
          'canEdit',
          'commentId',
          'createdAt',
          'geometry',
          'inviteId',
          'photoId',
          'revision',
          'state',
          'style',
          'updatedAt',
          'versionId',
        ].sort(),
      );
      const serialized = JSON.stringify(created.result);
      for (const value of [
        fixture.guestSecret,
        fixture.guestSessionId,
        fixture.peerGuestSecret,
        fixture.peerGuestSessionId,
        fixture.inviteToken,
        'object_key',
        'originalUrl',
        'previewUrl',
        'signedUrl',
        'photoBytes',
        linkedComment.item.body,
      ])
        if (value) assert.equal(serialized.includes(value), false);

      const livePage = await readOwnerPage(inviteId, {
        annotationId: created.item.annotationId,
      });
      assert.equal(livePage.items.length, 1);
      assert.equal(livePage.items[0].state, 'open');
      assert.equal(livePage.items[0].commentId, linkedComment.item.commentId);
      assert.equal('authorGuestId' in livePage.items[0], false);
      assert.equal(
        JSON.stringify(livePage).includes(linkedComment.item.body),
        false,
      );

      const updated = await updateOwnerAnnotation(created.item, {
        geometry: {
          type: 'point',
          coordinateSpace: 'normalized_1e6',
          x: 720_000,
          y: 330_000,
        },
        commentId: null,
      });
      assert.equal(updated.item.annotationId, created.item.annotationId);
      assert.equal(updated.item.revision, 2);
      assert.equal(updated.item.state, 'open');
      assert.equal(updated.item.commentId, null);
      assert.notDeepEqual(updated.item.geometry, created.item.geometry);
      await expectError(
        await postOwner({
          ...updated.body,
          requestId: randomUUID(),
          expectedRevision: 1,
        }),
        409,
        'ANNOTATION_REVISION_CONFLICT',
      );

      const resolved = await lifecycleOwnerAnnotation('resolve', updated.item);
      assert.equal(resolved.item.revision, 3);
      assert.equal(resolved.item.state, 'resolved');
      const reopened = await lifecycleOwnerAnnotation('reopen', resolved.item);
      assert.equal(reopened.item.revision, 4);
      assert.equal(reopened.item.state, 'open');
      const deleted = await lifecycleOwnerAnnotation('delete', reopened.item);
      assert.equal(deleted.item.revision, 5);
      assert.equal(deleted.item.state, 'deleted');
      assert.equal(deleted.item.geometry, null);
      assert.equal(deleted.item.style, null);
      assert.equal(deleted.item.commentId, null);

      const target = await readOwnerPage(inviteId, {
        annotationId: created.item.annotationId,
      });
      assert.equal(target.items.length, 1);
      assert.equal(target.items[0].state, 'deleted');
      assert.equal(target.items[0].geometry, null);
      assert.equal(target.items[0].canEdit, true);

      const beforeReplay = await counts();
      const replay = await readOwnerResult(await postOwner(created.body));
      assert.deepEqual(replay, originalReceipt);
      assert.deepEqual(await counts(), beforeReplay);

      const fresh = await createFreshOwnerSession();
      try {
        const freshReplay = await readOwnerResult(
          await postOwner(created.body, { cookie: fresh.cookie }),
        );
        assert.deepEqual(freshReplay, originalReceipt);
        assert.deepEqual(await counts(), beforeReplay);
      } finally {
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(fresh.sessionId, owner)
          .run();
      }

      const authResponse = await request('/api/auth/get-session', {
        headers: { Cookie: ownerCookie },
      });
      const authBody = await readJson(authResponse);
      assert.equal(authResponse.status, 200, JSON.stringify(authBody));
      const sessionId = authBody?.session?.id;
      assert.ok(sessionId);
      const storedCommand = await db
        .prepare(
          'SELECT id,actor_id,expected_owner_id,session_id,request_id,invite_id,' +
            'workspace_id,project_id,album_id,photo_id,version_id,annotation_id,' +
            'operation,expected_revision,request_json FROM owner_annotation_commands ' +
            'WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, created.body.requestId)
        .first();
      assert.ok(storedCommand?.id);
      assert.equal(storedCommand.actor_id, owner);
      assert.equal(storedCommand.expected_owner_id, owner);
      assert.equal(storedCommand.session_id, sessionId);
      assert.equal(storedCommand.request_id, created.body.requestId);
      assert.equal(storedCommand.invite_id, inviteId);
      assert.equal(storedCommand.workspace_id, fixture.workspaceId);
      assert.equal(storedCommand.project_id, fixture.projectId);
      assert.equal(storedCommand.album_id, albumId);
      assert.equal(storedCommand.photo_id, photoId);
      assert.equal(storedCommand.version_id, versionId);
      assert.equal(storedCommand.annotation_id, created.item.annotationId);
      assert.equal(storedCommand.operation, 'create');
      assert.equal(storedCommand.expected_revision, null);
      assert.deepEqual(JSON.parse(storedCommand.request_json), created.body);
      assert.equal(
        storedCommand.request_json.includes(linkedComment.item.body),
        false,
      );

      const change = await db
        .prepare(
          'SELECT event_id,actor_id,expected_owner_id,session_id,request_id,' +
            'invite_id,workspace_id,project_id,album_id,photo_id,version_id,' +
            'annotation_id,operation,revision,after_json FROM owner_annotation_changes ' +
            'WHERE command_id=?',
        )
        .bind(storedCommand.id)
        .first();
      assert.ok(change?.event_id);
      assert.equal(change.actor_id, owner);
      assert.equal(change.expected_owner_id, owner);
      assert.equal(change.session_id, sessionId);
      assert.equal(change.request_id, created.body.requestId);
      assert.equal(change.invite_id, inviteId);
      assert.equal(change.workspace_id, fixture.workspaceId);
      assert.equal(change.project_id, fixture.projectId);
      assert.equal(change.album_id, albumId);
      assert.equal(change.photo_id, photoId);
      assert.equal(change.version_id, versionId);
      assert.equal(change.annotation_id, created.item.annotationId);
      assert.equal(change.operation, 'create');
      assert.equal(change.revision, 1);
      const afterState = JSON.parse(change.after_json);
      assert.equal(afterState.annotationId, created.item.annotationId);
      assert.equal(afterState.ownerId, owner);
      assert.equal(afterState.authorType, 'owner');
      assert.equal(afterState.state, 'open');
      assert.equal(change.after_json.includes(linkedComment.item.body), false);

      const createAudit = await db
        .prepare(
          'SELECT actor_type,actor_id,guest_session_id,session_id,action,request_id ' +
            'FROM audit_events WHERE event_id=?',
        )
        .bind(change.event_id)
        .first();
      assert.deepEqual(createAudit, {
        actor_type: 'user',
        actor_id: owner,
        guest_session_id: null,
        session_id: sessionId,
        action: 'owner.annotation_created',
        request_id: created.body.requestId,
      });
      const storedResult = await db
        .prepare(
          'SELECT result_json FROM owner_annotation_results WHERE command_id=?',
        )
        .bind(storedCommand.id)
        .first();
      assert.ok(storedResult?.result_json);
      assert.deepEqual(JSON.parse(storedResult.result_json), created.result);
      assert.equal(
        storedResult.result_json.includes(linkedComment.item.body),
        false,
      );

      const auditRows = await db
        .prepare(
          'SELECT action,actor_type,actor_id,session_id,guest_session_id,request_id,occurred_at_utc ' +
            "FROM audit_events WHERE actor_type='user' AND actor_id=? " +
            "AND request_id IN (?,?,?,?,?) AND action LIKE 'owner.annotation_%' " +
            'ORDER BY request_id,action',
        )
        .bind(
          owner,
          created.body.requestId,
          updated.body.requestId,
          resolved.body.requestId,
          reopened.body.requestId,
          deleted.body.requestId,
        )
        .all();
      assert.equal(auditRows.results.length, 5);
      const expectedActions = new Map([
        [created.body.requestId, 'owner.annotation_created'],
        [updated.body.requestId, 'owner.annotation_updated'],
        [resolved.body.requestId, 'owner.annotation_resolved'],
        [reopened.body.requestId, 'owner.annotation_reopened'],
        [deleted.body.requestId, 'owner.annotation_deleted'],
      ]);
      for (const row of auditRows.results) {
        assert.equal(row.actor_id, owner);
        assert.equal(row.actor_type, 'user');
        assert.equal(row.session_id, sessionId);
        assert.equal(row.guest_session_id, null);
        assert.equal(row.action, expectedActions.get(row.request_id));
        assert.ok(Number.isFinite(Date.parse(row.occurred_at_utc)));
      }
    },
  );

  await check(
    'Owner authoring pages are readonly, invite scoped, 24 plus 1, and stale after Owner or Guest changes',
    async () => {
      const bundle = await fixture.createScopedGuestBundle(128, [
        'Owner annotation cursor guest',
      ]);
      const cursorInviteId = bundle.inviteId ?? bundle.invite?.id;
      const cursorGuest = bundle.guests?.[0] ?? bundle.guest;
      assert.ok(cursorInviteId && cursorGuest?.secret && cursorGuest?.guestId);

      const ownerRows = [];
      for (let index = 0; index < 25; index += 1) {
        const annotation = await createOwnerAnnotation({
          inviteId: cursorInviteId,
          geometry: {
            type: 'point',
            coordinateSpace: 'normalized_1e6',
            x: 50_000 + index * 10_000,
            y: 190_000 + index * 1000,
          },
          style: { color: index % 2 === 0 ? 'amber' : 'red' },
        });
        ownerRows.push(annotation.item);
      }
      const beforeRead = await readSnapshot();
      const first = await readOwnerPage(cursorInviteId);
      assert.equal(first.ownerId, owner);
      assert.equal(first.inviteId, cursorInviteId);
      assert.equal(first.photoId, photoId);
      assert.equal(first.versionId, versionId);
      assert.equal(first.items.length, 24);
      assert.ok(first.nextCursor);
      assert.ok(
        first.items.every(
          (item) => item.authorType === 'owner' && item.canEdit === true,
        ),
      );
      const second = await readOwnerPage(cursorInviteId, {
        cursor: first.nextCursor,
      });
      assert.equal(second.items.length, 1);
      assert.equal(second.nextCursor, null);
      assert.equal(
        new Set(
          [...first.items, ...second.items].map((item) => item.annotationId),
        ).size,
        25,
      );
      assert.deepEqual(await readSnapshot(), beforeRead);

      const foreignTarget = await readOwnerPage(fixture.otherInviteId, {
        annotationId: ownerRows[0].annotationId,
      });
      assert.deepEqual(foreignTarget.items, []);
      assert.deepEqual(await readSnapshot(), beforeRead);
      await expectError(
        await ownerSend(
          authoringWorker,
          pagePath(cursorInviteId, {
            cursor: first.nextCursor,
            annotationId: ownerRows[0].annotationId,
          }),
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(
          authoringWorker,
          pagePath(fixture.otherInviteId, {
            cursor: first.nextCursor,
          }),
        ),
        400,
        'INVALID_INPUT',
      );

      const guestRows = [];
      for (let index = 0; index < 25; index += 1)
        guestRows.push(await createGuestAnnotation(cursorGuest));
      const legacyGuestPage = await readOwnerReadOnlyPage(cursorInviteId);
      assert.ok(legacyGuestPage.nextCursor);
      assert.ok(
        legacyGuestPage.items.some(
          (item) => item.annotationId === guestRows[0].result.item.annotationId,
        ),
      );
      const afterGuestChanges = await readOwnerPage(cursorInviteId, {
        cursor: first.nextCursor,
      });
      assert.equal(afterGuestChanges.items.length, 1);
      assert.equal(
        afterGuestChanges.items[0].annotationId,
        ownerRows[24].annotationId,
      );
      await expectError(
        await ownerSend(
          authoringWorker,
          pagePath(cursorInviteId, {
            cursor: legacyGuestPage.nextCursor,
          }),
        ),
        400,
        'INVALID_INPUT',
      );

      const changedOwner = await updateOwnerAnnotation(ownerRows[0]);
      assert.equal(changedOwner.item.revision, 2);
      await expectError(
        await ownerSend(
          authoringWorker,
          pagePath(cursorInviteId, {
            cursor: first.nextCursor,
          }),
        ),
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );

      const serialized = JSON.stringify(first);
      for (const privateValue of [
        fixture.guestSecret,
        fixture.peerGuestSecret,
        fixture.inviteToken,
        cursorGuest.secret,
        'object_key',
        'originalUrl',
        'previewUrl',
        'signedUrl',
        'photoBytes',
      ])
        if (privateValue)
          assert.equal(serialized.includes(privateValue), false);
    },
  );

  await check(
    'Owner writes remain available for retained expired and revoked invitations while Guests are denied',
    async () => {
      const expiresAt = Date.now() + 5_000;
      const expiring = await fixture.createScopedGuestBundle(
        128,
        ['Owner expired invitation annotation'],
        expiresAt,
      );
      const expiringInviteId = expiring.inviteId ?? expiring.invite?.id;
      const expiringGuest = expiring.guests?.[0] ?? expiring.guest;
      assert.ok(expiringInviteId && expiringGuest?.secret);
      const guestBefore = await guestSend(
        guestAnnotationWorker,
        guestAnnotationPath(),
        { secret: expiringGuest.secret },
      );
      assert.equal(guestBefore.status, 200, await guestBefore.clone().text());

      let expired = false;
      const deadline = Date.now() + 6_500;
      while (!expired && Date.now() < deadline) {
        const state = await db
          .prepare(
            "SELECT CASE WHEN expires_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER) " +
              'THEN 1 ELSE 0 END AS expired FROM guest_invites WHERE id=?',
          )
          .bind(expiringInviteId)
          .first();
        expired = Number(state?.expired) === 1;
        if (!expired) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(expired, true, 'invite did not expire by D1 clock');
      const expiredWrite = await createOwnerAnnotation({
        inviteId: expiringInviteId,
      });
      assert.equal(expiredWrite.item.inviteId, expiringInviteId);
      await expectError(
        await guestSend(guestAnnotationWorker, guestAnnotationPath(), {
          secret: expiringGuest.secret,
        }),
        401,
        'GUEST_ACCESS_REQUIRED',
      );

      const revoked = await fixture.createScopedGuestBundle(128, [
        'Owner revoked invitation annotation',
      ]);
      const revokedInviteId = revoked.inviteId ?? revoked.invite?.id;
      const revokedGuest = revoked.guests?.[0] ?? revoked.guest;
      assert.ok(revokedInviteId && revokedGuest?.secret);
      const revoke = await ownerSend(
        ownerReadWorker,
        '/api/v1/invites/' + revokedInviteId + '/revoke',
        {
          method: 'POST',
          body: { requestId: randomUUID(), confirmRevoke: true },
        },
      );
      const revokeBody = await readJson(revoke);
      assert.equal(revoke.status, 200, JSON.stringify(revokeBody));
      const revokedWrite = await createOwnerAnnotation({
        inviteId: revokedInviteId,
      });
      assert.equal(revokedWrite.item.inviteId, revokedInviteId);
      await expectError(
        await guestSend(guestAnnotationWorker, guestAnnotationPath(), {
          secret: revokedGuest.secret,
        }),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
    },
  );

  await check(
    'Owner identity, session expiry and inactive parent scope are rechecked for writes and reads',
    async () => {
      assert.ok(ownerCreated);
      const before = await counts();
      await expectError(
        await postOwner({
          ...ownerCreated.body,
          requestId: randomUUID(),
          expectedOwnerId: randomUUID(),
        }),
        409,
        'OWNER_IDENTITY_CHANGED',
      );
      assert.deepEqual(await counts(), before);

      const fresh = await createFreshOwnerSession();
      try {
        const valid = await readOwnerPage(inviteId, { cookie: fresh.cookie });
        assert.equal(valid.ownerId, owner);
        await db
          .prepare(
            'UPDATE owner_sessions SET expiresAt=0 WHERE id=? AND userId=?',
          )
          .bind(fresh.sessionId, owner)
          .run();
        await expectError(
          await ownerSend(authoringWorker, pagePath(inviteId), {
            cookie: fresh.cookie,
          }),
          401,
          'AUTH_REQUIRED',
        );
        await expectError(
          await postOwner(ownerCreated.body, { cookie: fresh.cookie }),
          401,
          'AUTH_REQUIRED',
        );
      } finally {
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(fresh.sessionId, owner)
          .run();
      }

      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectError(
          await postOwner(ownerCreated.body),
          403,
          'OWNER_REQUIRED',
        );
        await expectError(
          await ownerSend(authoringWorker, pagePath(inviteId)),
          403,
          'OWNER_REQUIRED',
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }

      const project = await db
        .prepare(
          'SELECT status,archived_from_status AS archivedFromStatus FROM projects WHERE id=? AND workspace_id=?',
        )
        .bind(fixture.projectId, fixture.workspaceId)
        .first();
      assert.ok(project?.status);
      const beforeArchive = await counts();
      await db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status='draft' WHERE id=? AND workspace_id=?",
        )
        .bind(fixture.projectId, fixture.workspaceId)
        .run();
      try {
        await expectError(
          await postOwner(createBody({ requestId: randomUUID() })),
          404,
          'NOT_FOUND',
        );
        await expectError(await postOwner(ownerCreated.body), 404, 'NOT_FOUND');
        await expectError(
          await ownerSend(authoringWorker, pagePath(inviteId)),
          404,
          'NOT_FOUND',
        );
        assert.deepEqual(await counts(), beforeArchive);
      } finally {
        await db
          .prepare(
            'UPDATE projects SET status=?,archived_from_status=? WHERE id=? AND workspace_id=?',
          )
          .bind(
            project.status,
            project.archivedFromStatus,
            fixture.projectId,
            fixture.workspaceId,
          )
          .run();
      }
    },
  );

  await check(
    'Owner annotation request IDs are symmetric with Owner comments, processing, and external-intent ledgers',
    async () => {
      const guest = {
        guestId: fixture.peerAuthorGuestId,
        secret: fixture.peerGuestSecret,
      };
      const ownerReplyPath =
        '/api/v1/albums/' + albumId + '/comment-replies/commands';
      const processingPath =
        '/api/v1/albums/' + albumId + '/comment-processing/commands';
      const ownerReplyBody = (requestId, parent) => ({
        requestId,
        operation: 'reply',
        inviteId,
        photoId,
        versionId,
        parentCommentId: parent.commentId,
        expectedParentRevision: parent.revision,
        body: 'Owner namespace reply ' + randomUUID(),
      });
      const processingBody = (requestId, parent) => ({
        requestId,
        operation: 'set_processing_state',
        inviteId,
        photoId,
        versionId,
        commentId: parent.commentId,
        expectedCommentRevision: parent.revision,
        expectedProcessingRevision: 0,
        state: 'in_progress',
      });
      const runReply = (requestId, parent) =>
        ownerSend(ownerCommentsWorker, ownerReplyPath, {
          method: 'POST',
          body: ownerReplyBody(requestId, parent),
        });
      const runProcessing = (requestId, parent) =>
        ownerSend(ownerProcessingWorker, processingPath, {
          method: 'POST',
          body: processingBody(requestId, parent),
        });
      const assertConflict = async (response) =>
        expectError(response, 409, 'REQUEST_ID_CONFLICT');
      const countFor = async (table, requestId) => {
        assert.ok(
          [
            'owner_annotation_commands',
            'owner_comment_commands',
            'owner_comment_processing_commands',
            'owner_external_intents',
          ].includes(table),
        );
        const row = await db
          .prepare(
            'SELECT count(*) AS n FROM ' +
              table +
              ' WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, requestId)
          .first();
        return Number(row?.n ?? -1);
      };

      const commentParentForLegacy = await createGuestComment(
        guest,
        'Owner namespace legacy reply parent',
      );
      const legacyReplyId = randomUUID().toUpperCase();
      const legacyReply = await readJson(
        await runReply(legacyReplyId, commentParentForLegacy.item),
      );
      assert.equal(
        legacyReply?.item?.authorType,
        'owner',
        JSON.stringify(legacyReply),
      );
      assert.equal(legacyReply?.requestId, legacyReplyId.toLowerCase());
      await assertConflict(
        await postOwner(createBody({ requestId: legacyReplyId.toLowerCase() })),
      );
      assert.equal(
        await countFor('owner_comment_commands', legacyReplyId.toLowerCase()),
        1,
      );
      assert.equal(
        await countFor(
          'owner_annotation_commands',
          legacyReplyId.toLowerCase(),
        ),
        0,
      );

      const replyParentForNew = await createGuestComment(
        guest,
        'Owner namespace reverse reply parent',
      );
      const newReplyCollisionId = randomUUID();
      await createOwnerAnnotation({ requestId: newReplyCollisionId });
      await assertConflict(
        await runReply(newReplyCollisionId, replyParentForNew.item),
      );
      assert.equal(
        await countFor('owner_annotation_commands', newReplyCollisionId),
        1,
      );
      assert.equal(
        await countFor('owner_comment_commands', newReplyCollisionId),
        0,
      );

      const processingParentForLegacy = await createGuestComment(
        guest,
        'Owner namespace legacy processing parent',
      );
      const legacyProcessingId = randomUUID().toUpperCase();
      const processingReceipt = await readJson(
        await runProcessing(legacyProcessingId, processingParentForLegacy.item),
      );
      assert.equal(
        processingReceipt?.processing?.state,
        'in_progress',
        JSON.stringify(processingReceipt),
      );
      assert.equal(
        processingReceipt?.requestId,
        legacyProcessingId.toLowerCase(),
      );
      await assertConflict(
        await postOwner(
          createBody({ requestId: legacyProcessingId.toLowerCase() }),
        ),
      );
      assert.equal(
        await countFor(
          'owner_comment_processing_commands',
          legacyProcessingId.toLowerCase(),
        ),
        1,
      );
      assert.equal(
        await countFor(
          'owner_annotation_commands',
          legacyProcessingId.toLowerCase(),
        ),
        0,
      );

      const processingParentForNew = await createGuestComment(
        guest,
        'Owner namespace reverse processing parent',
      );
      const newProcessingCollisionId = randomUUID();
      await createOwnerAnnotation({ requestId: newProcessingCollisionId });
      await assertConflict(
        await runProcessing(
          newProcessingCollisionId,
          processingParentForNew.item,
        ),
      );
      assert.equal(
        await countFor('owner_annotation_commands', newProcessingCollisionId),
        1,
      );
      assert.equal(
        await countFor(
          'owner_comment_processing_commands',
          newProcessingCollisionId,
        ),
        0,
      );

      const authResponse = await request('/api/auth/get-session', {
        headers: { Cookie: ownerCookie },
      });
      const auth = await readJson(authResponse);
      assert.equal(authResponse.status, 200, JSON.stringify(auth));
      const sessionId = auth?.session?.id;
      assert.ok(sessionId);
      const digest = createHash('sha256')
        .update(new Uint8Array([0x89]))
        .digest('hex');
      const reserve = async (name) => {
        const response = await request('/api/v1/uploads/init', {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            Origin: origin,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
            albumId,
            originalFilename: name,
            expectedBytes: 1,
            contentType: 'image/png',
            sha256: digest,
            requestId: randomUUID(),
          }),
        });
        const body = await readJson(response);
        assert.equal(response.status, 201, JSON.stringify(body));
        assert.ok(body?.uploadSession?.id);
        return body.uploadSession.id;
      };
      const runExternal = (requestId, uploadSessionId) =>
        storageWorker.fetch(
          new Request(new URL('/test-owner-external-intent', base), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operation: 'upload.cancelled',
              actorId: owner,
              sessionId,
              requestId,
              uploadSessionId,
            }),
          }),
        );
      const cleanupUpload = async (uploadSessionId) => {
        const response = await request(
          '/api/v1/uploads/' + uploadSessionId + '/cancel',
          {
            method: 'POST',
            headers: {
              Cookie: ownerCookie,
              Origin: origin,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requestId: randomUUID() }),
          },
        );
        assert.equal(response.status, 200, await response.clone().text());
      };

      const ownerToExternalId = randomUUID();
      await createOwnerAnnotation({ requestId: ownerToExternalId });
      const uploadForCollision = await reserve(
        'owner-annotation-collision.png',
      );
      await assertConflict(
        await runExternal(ownerToExternalId, uploadForCollision),
      );
      assert.equal(
        await countFor('owner_annotation_commands', ownerToExternalId),
        1,
      );
      assert.equal(
        await countFor('owner_external_intents', ownerToExternalId),
        0,
      );
      const stateAfterCollision = await db
        .prepare('SELECT status FROM upload_sessions WHERE id=?')
        .bind(uploadForCollision)
        .first();
      assert.equal(stateAfterCollision?.status, 'reserved');
      await cleanupUpload(uploadForCollision);

      const externalToOwnerId = randomUUID();
      const uploadForExternal = await reserve('owner-external-namespace.png');
      const externalCreated = await readJson(
        await runExternal(externalToOwnerId, uploadForExternal),
      );
      assert.equal(
        externalCreated?.uploadSession?.status,
        'cancelled',
        JSON.stringify(externalCreated),
      );
      await assertConflict(
        await postOwner(createBody({ requestId: externalToOwnerId })),
      );
      assert.equal(
        await countFor('owner_external_intents', externalToOwnerId),
        1,
      );
      assert.equal(
        await countFor('owner_annotation_commands', externalToOwnerId),
        0,
      );
    },
  );

  await check(
    'Owner annotation IDs collide symmetrically across guarded Guest and Owner command writers',
    async () => {
      assert.ok(ownerCreated?.item?.annotationId);
      const ownerSessionId = await currentOwnerSessionId();
      const guest = {
        guestId: fixture.authorGuestId,
        secret: fixture.guestSecret,
        sessionId: fixture.guestSessionId,
      };
      const before = await readSnapshot();

      await assert.rejects(
        guardedOwnerCreateStatement(
          inviteId,
          ownerSessionId,
          fixture.annotationId,
        ).run(),
        /ANNOTATION_ID_COLLISION/u,
        'an Owner command must not claim a retained Guest annotation ID',
      );
      assert.deepEqual(await readSnapshot(), before);

      await assert.rejects(
        guardedGuestCreateStatement(
          guest,
          inviteId,
          ownerCreated.item.annotationId,
        ).run(),
        /ANNOTATION_ID_COLLISION/u,
        'a Guest command must not claim a retained Owner tombstone ID',
      );
      assert.deepEqual(await readSnapshot(), before);
    },
  );

  await check(
    'Guest shared annotations expose genuine Owner rows as non-mine and do not grant Guest mutation rights',
    async () => {
      const ownerRow = await createOwnerAnnotation();
      assert.equal(ownerRow.item.state, 'open');
      assert.ok(ownerRow.item.geometry && ownerRow.item.style);

      const beforeRead = await readSnapshot();
      const response = await guestSend(
        guestAnnotationWorker,
        guestSharedAnnotationPath(),
        { secret: fixture.guestSecret },
      );
      const text = await response.text();
      const page = guestSharedAnnotationsPageSchema.parse(parseJson(text));
      assert.equal(response.status, 200, text);
      assert.equal(page.guestId, fixture.authorGuestId);
      const sharedOwnerRow = page.items.find(
        (item) => item.annotationId === ownerRow.item.annotationId,
      );
      assert.ok(
        sharedOwnerRow,
        'the Owner annotation should be shared in its invitation',
      );
      assert.equal(sharedOwnerRow.authorType, 'owner');
      assert.equal(sharedOwnerRow.isMine, false);
      assert.equal(sharedOwnerRow.revision, ownerRow.item.revision);
      assert.deepEqual(sharedOwnerRow.geometry, ownerRow.item.geometry);
      assert.deepEqual(sharedOwnerRow.style, ownerRow.item.style);
      assert.equal('authorUserId' in sharedOwnerRow, false);
      assert.equal('ownerId' in sharedOwnerRow, false);
      assert.equal('canEdit' in sharedOwnerRow, false);
      assert.equal(text.includes(owner), false);
      assert.equal(text.includes(fixture.guestSecret), false);
      assert.equal(text.includes(fixture.peerGuestSecret), false);
      assert.deepEqual(await readSnapshot(), beforeRead);

      const beforeWrite = await readSnapshot();
      await expectError(
        await postGuestAnnotation(
          {
            guestId: fixture.authorGuestId,
            secret: fixture.guestSecret,
          },
          {
            requestId: randomUUID(),
            expectedGuestId: fixture.authorGuestId,
            operation: 'update',
            annotationId: ownerRow.item.annotationId,
            expectedRevision: ownerRow.item.revision,
            geometry: {
              type: 'point',
              coordinateSpace: 'normalized_1e6',
              x: 830_000,
              y: 710_000,
            },
            style: { color: 'red' },
            commentId: null,
          },
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
      assert.deepEqual(await readSnapshot(), beforeWrite);
    },
  );

  await check(
    'Owner and Guest annotation projections share a 1000-row lifetime cap including tombstones',
    async () => {
      const bundle = await fixture.createScopedGuestBundle(128, [
        'Mixed lifetime cap Guest one',
        'Mixed lifetime cap Guest two',
      ]);
      const capInviteId = bundle.inviteId ?? bundle.invite?.id;
      const capGuests = bundle.guests ?? [];
      assert.ok(capInviteId && capGuests.length === 2);
      const capGuest = capGuests[0];
      const capPeer = capGuests[1];
      assert.ok(capGuest?.secret && capGuest.sessionId);
      assert.ok(capPeer?.secret && capPeer.sessionId);

      const ownerRepresentative = await createOwnerAnnotation({
        inviteId: capInviteId,
      });
      const guestRepresentative = await createGuestAnnotation(capGuest);
      const ownerReceipt = structuredClone(ownerRepresentative.result);
      const guestReceipt = structuredClone(guestRepresentative.result);
      const ownerSessionId = await currentOwnerSessionId();

      // These are command inserts into the production guarded tables. Their
      // database triggers perform authorization and write each projection,
      // immutable change witness, audit record, and replay receipt atomically.
      const ownerStatements = [];
      for (let index = 0; index < 499; index += 1)
        ownerStatements.push(
          guardedOwnerCreateStatement(
            capInviteId,
            ownerSessionId,
            randomUUID(),
            randomUUID(),
            index + 1,
          ),
        );
      for (let start = 0; start < ownerStatements.length; start += 40)
        await db.batch(ownerStatements.slice(start, start + 40));

      const guestStatements = [];
      for (let index = 0; index < 499; index += 1)
        guestStatements.push(
          guardedGuestCreateStatement(
            index % 2 === 0 ? capGuest : capPeer,
            capInviteId,
            randomUUID(),
            randomUUID(),
            index + 1,
          ),
        );
      for (let start = 0; start < guestStatements.length; start += 40)
        await db.batch(guestStatements.slice(start, start + 40));

      const atCapacity = await db
        .prepare(
          'SELECT (SELECT count(*) FROM guest_annotations WHERE invite_id=? AND photo_id=? AND version_id=?) AS guestCount,' +
            ' (SELECT count(*) FROM owner_annotations WHERE invite_id=? AND photo_id=? AND version_id=?) AS ownerCount',
        )
        .bind(capInviteId, photoId, versionId, capInviteId, photoId, versionId)
        .first();
      assert.equal(Number(atCapacity?.guestCount), 500);
      assert.equal(Number(atCapacity?.ownerCount), 500);

      const ownerUpdate = await updateOwnerAnnotation(ownerRepresentative.item);
      assert.equal(ownerUpdate.item.revision, 2);
      const guestUpdateBody = {
        requestId: randomUUID(),
        expectedGuestId: capGuest.guestId,
        operation: 'update',
        annotationId: guestRepresentative.result.item.annotationId,
        expectedRevision: 1,
        geometry: {
          type: 'point',
          coordinateSpace: 'normalized_1e6',
          x: 620_000,
          y: 520_000,
        },
        style: { color: 'blue' },
        commentId: null,
      };
      const guestUpdatedResponse = await postGuestAnnotation(
        capGuest,
        guestUpdateBody,
      );
      const guestUpdated = guestAnnotationResultSchema.parse(
        await readJson(guestUpdatedResponse),
      );
      assert.equal(guestUpdated.item.revision, 2);

      const ownerDeleted = await lifecycleOwnerAnnotation(
        'delete',
        ownerUpdate.item,
      );
      assert.equal(ownerDeleted.item.state, 'deleted');
      const guestDeletedResponse = await postGuestAnnotation(capGuest, {
        requestId: randomUUID(),
        expectedGuestId: capGuest.guestId,
        operation: 'delete',
        annotationId: guestUpdated.item.annotationId,
        expectedRevision: guestUpdated.item.revision,
      });
      const guestDeleted = guestAnnotationResultSchema.parse(
        await readJson(guestDeletedResponse),
      );
      assert.equal(guestDeleted.item.state, 'deleted');

      const afterTombstones = await db
        .prepare(
          'SELECT (SELECT count(*) FROM guest_annotations WHERE invite_id=? AND photo_id=? AND version_id=?) AS guestCount,' +
            ' (SELECT count(*) FROM owner_annotations WHERE invite_id=? AND photo_id=? AND version_id=?) AS ownerCount,' +
            " (SELECT count(*) FROM guest_annotations WHERE invite_id=? AND photo_id=? AND version_id=? AND state='deleted') AS guestTombstones," +
            " (SELECT count(*) FROM owner_annotations WHERE invite_id=? AND photo_id=? AND version_id=? AND state='deleted') AS ownerTombstones",
        )
        .bind(
          capInviteId,
          photoId,
          versionId,
          capInviteId,
          photoId,
          versionId,
          capInviteId,
          photoId,
          versionId,
          capInviteId,
          photoId,
          versionId,
        )
        .first();
      assert.equal(Number(afterTombstones?.guestCount), 500);
      assert.equal(Number(afterTombstones?.ownerCount), 500);
      assert.ok(Number(afterTombstones?.guestTombstones) >= 1);
      assert.ok(Number(afterTombstones?.ownerTombstones) >= 1);

      const beforeReplay = await readSnapshot();
      assert.deepEqual(
        await readOwnerResult(await postOwner(ownerRepresentative.body)),
        ownerReceipt,
      );
      const guestReplay = guestAnnotationResultSchema.parse(
        await readJson(
          await postGuestAnnotation(capGuest, guestRepresentative.body),
        ),
      );
      assert.deepEqual(guestReplay, guestReceipt);
      assert.deepEqual(await readSnapshot(), beforeReplay);

      const beforeDeniedCreates = await readSnapshot();
      await expectError(
        await postOwner(createBody({ inviteId: capInviteId })),
        409,
        'ANNOTATION_LIMIT_REACHED',
      );
      await expectError(
        await postGuestAnnotation(capGuest, guestCreateBody(capGuest)),
        409,
        'ANNOTATION_LIMIT_REACHED',
      );
      assert.deepEqual(await readSnapshot(), beforeDeniedCreates);
    },
  );

  await check(
    'Guest shared annotation cursor watermark includes Owner and Guest changes when the Guest sequence is ahead',
    async () => {
      const bundle = await fixture.createScopedGuestBundle(128, [
        'Shared watermark Guest author',
        'Shared watermark Guest peer',
      ]);
      const cursorInviteId = bundle.inviteId ?? bundle.invite?.id;
      const cursorGuests = bundle.guests ?? [];
      const cursorGuest = cursorGuests[0];
      const cursorPeer = cursorGuests[1];
      assert.ok(cursorInviteId && cursorGuest?.secret && cursorPeer?.secret);

      const ownerRow = await createOwnerAnnotation({
        inviteId: cursorInviteId,
      });
      const guestRows = [];
      for (let index = 0; index < 25; index += 1)
        guestRows.push(
          await createGuestAnnotation(
            index % 2 === 0 ? cursorGuest : cursorPeer,
          ),
        );

      const sequenceBinds = [
        cursorInviteId,
        fixture.workspaceId,
        fixture.projectId,
        albumId,
        photoId,
        versionId,
      ];
      const guestSequence = await db
        .prepare(
          'SELECT COALESCE(MAX(seq),0) AS seq FROM guest_annotation_changes WHERE invite_id=? AND workspace_id=? AND project_id=? AND album_id=? AND photo_id=? AND version_id=?',
        )
        .bind(...sequenceBinds)
        .first();
      const ownerSequence = await db
        .prepare(
          'SELECT COALESCE(MAX(seq),0) AS seq FROM owner_annotation_changes WHERE invite_id=? AND workspace_id=? AND project_id=? AND album_id=? AND photo_id=? AND version_id=?',
        )
        .bind(...sequenceBinds)
        .first();
      assert.ok(Number(guestSequence?.seq) > Number(ownerSequence?.seq));

      const beforeRead = await readSnapshot();
      const firstResponse = await guestSend(
        guestAnnotationWorker,
        guestSharedAnnotationPath(),
        { secret: cursorGuest.secret },
      );
      const firstText = await firstResponse.text();
      assert.equal(firstResponse.status, 200, firstText);
      const firstPage = guestSharedAnnotationsPageSchema.parse(
        parseJson(firstText),
      );
      assert.equal(firstPage.items.length, 24);
      assert.ok(firstPage.nextCursor);
      assert.ok(
        firstPage.items.some(
          (item) =>
            item.annotationId === ownerRow.item.annotationId &&
            item.authorType === 'owner' &&
            item.isMine === false,
        ),
      );
      assert.deepEqual(await readSnapshot(), beforeRead);

      const changedGuestRow = guestRows[0]?.result.item;
      assert.ok(changedGuestRow);
      const updateResponse = await postGuestAnnotation(cursorGuest, {
        requestId: randomUUID(),
        expectedGuestId: cursorGuest.guestId,
        operation: 'update',
        annotationId: changedGuestRow.annotationId,
        expectedRevision: changedGuestRow.revision,
        geometry: {
          type: 'point',
          coordinateSpace: 'normalized_1e6',
          x: 915_000,
          y: 845_000,
        },
        style: { color: 'red' },
        commentId: null,
      });
      const changedGuest = guestAnnotationResultSchema.parse(
        await readJson(updateResponse),
      );
      assert.equal(changedGuest.item.revision, changedGuestRow.revision + 1);

      const beforeStaleRead = await readSnapshot();
      await expectError(
        await guestSend(
          guestAnnotationWorker,
          guestSharedAnnotationPath(
            photoId,
            versionId,
            '?cursor=' + encodeURIComponent(firstPage.nextCursor),
          ),
          { secret: cursorGuest.secret },
        ),
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );
      assert.deepEqual(await readSnapshot(), beforeStaleRead);
    },
  );

  await check(
    'Owner annotation writes roll back atomically on audit failure and immutable rows reject raw tampering',
    async () => {
      const requestId = randomUUID();
      const before = await counts();
      const trigger =
        'test_fail_owner_annotation_audit_' + randomUUID().replaceAll('-', '');
      await db.exec(
        'CREATE TRIGGER ' +
          trigger +
          " BEFORE INSERT ON audit_events WHEN NEW.actor_id='" +
          owner +
          "' AND NEW.action LIKE 'owner.annotation_%' " +
          "BEGIN SELECT RAISE(ABORT,'TEST_OWNER_ANNOTATION_AUDIT_FAILURE'); END;",
      );
      try {
        await expectError(
          await postOwner(createBody({ requestId })),
          503,
          'OWNER_ANNOTATION_AUTHORING_UNAVAILABLE',
        );
      } finally {
        await db.exec('DROP TRIGGER IF EXISTS ' + trigger + ';');
      }
      assert.deepEqual(await counts(), before);

      await readOwnerResult(await postOwner(createBody({ requestId })));
      const stored = await db
        .prepare(
          'SELECT id,annotation_id,request_id,operation FROM owner_annotation_commands ' +
            'WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, requestId)
        .first();
      assert.ok(stored?.id && stored.annotation_id);
      assert.equal(stored.request_id, requestId);
      const afterCreate = await counts();
      assert.deepEqual(afterCreate, {
        commands: Number(before.commands) + 1,
        annotations: Number(before.annotations) + 1,
        changes: Number(before.changes) + 1,
        results: Number(before.results) + 1,
        audit: Number(before.audit) + 1,
      });

      await assert.rejects(
        db
          .prepare(
            'UPDATE owner_annotations SET revision=revision+1 WHERE id=?',
          )
          .bind(stored.annotation_id)
          .run(),
        /INVALID_OWNER_ANNOTATION_PREDECESSOR/u,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM owner_annotation_commands WHERE id=?')
          .bind(stored.id)
          .run(),
        /IMMUTABLE_OWNER_ANNOTATION_COMMAND/u,
      );
      assert.deepEqual(await counts(), afterCreate);
    },
  );
}
