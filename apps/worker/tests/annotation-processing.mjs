import { makeSignature } from 'better-auth/crypto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ownerAnnotationProcessingCapabilitiesSchema,
  ownerAnnotationProcessingCommandSchema,
  ownerAnnotationProcessingResultSchema,
} from '../../../packages/contracts/src/annotation-processing.ts';
import {
  guestAnnotationResultSchema,
  guestAnnotationsPageSchema,
} from '../../../packages/contracts/src/guest-annotations.ts';
import { guestCommentResultSchema } from '../../../packages/contracts/src/guest-comments.ts';
import { guestSharedAnnotationsPageSchema } from '../../../packages/contracts/src/annotation-threads.ts';
import { ownerAnnotationsPageSchema } from '../../../packages/contracts/src/owner-annotations.ts';

const canAnnotate = 128;
const canComment = 256;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function runAnnotationProcessingChecks({
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
  assert.ok(fixture?.secretAuthor && fixture?.createScopedGuestBundle);
  assert.equal(typeof request, 'function');
  assert.equal(typeof cookies?.headers, 'function');
  assert.equal(typeof check, 'function');
  assert.equal(typeof authSecret, 'string');
  assert.ok(authSecret.startsWith('synthetic-'));

  const processingWorker = await mf.getWorker('annotation-processing-test');
  const ownerReadWorker = await mf.getWorker('owner-annotations-test');
  const guestWorker = await mf.getWorker(
    fixture.workerName ?? 'guest-annotations-test',
  );
  const guestCommentWorker = await mf.getWorker('guest-comments-test');
  const disabledWorker = await mf.getWorker('app');
  const ownerCookie = cookies.headers();
  const origin = new URL(base).origin;
  const albumId = fixture.albumId;
  const photoId = fixture.photoId;
  const versionId = fixture.versionId;
  const capabilitiesPath = '/api/v1/annotation-processing/capabilities';
  const commandPath =
    '/api/v1/albums/' + albumId + '/annotation-processing/commands';
  const ownerReadPath = (targetInviteId, options = {}) => {
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
  const guestAnnotationPath = (
    targetPhotoId = photoId,
    targetVersionId = versionId,
    kind = 'shared',
    options = {},
  ) => {
    const url = new URL(
      '/api/guest/albums/' +
        albumId +
        '/photos/' +
        targetPhotoId +
        '/versions/' +
        targetVersionId +
        '/annotations/' +
        kind,
      base,
    );
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    if (options.annotationId)
      url.searchParams.set('annotationId', options.annotationId);
    return url.pathname + url.search;
  };
  const guestAnnotationCommandPath =
    '/api/guest/albums/' + albumId + '/annotations/commands';
  const guestCommentCommandPath =
    '/api/guest/albums/' + albumId + '/comments/commands';
  const ownerSend = (
    targetWorker,
    path,
    {
      method = 'GET',
      body,
      rawBody = false,
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
    if (body !== undefined)
      init.body = rawBody ? String(body) : JSON.stringify(body);
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
  const readResponse = async (response) => {
    const text = await response.text();
    return { status: response.status, text, value: parseJson(text) };
  };
  const expectError = async (response, status, code) => {
    const result = await readResponse(response);
    assert.equal(
      result.status,
      status,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    if (code)
      assert.equal(
        result.value?.error?.code,
        code,
        typeof result.value === 'string'
          ? result.value
          : JSON.stringify(result.value),
      );
    return result.value;
  };
  const expectOwnerJson = async (response, status = 200) => {
    const result = await readResponse(response);
    assert.equal(
      result.status,
      status,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    return result.value;
  };
  const ownerPost = (body, options = {}) =>
    ownerSend(processingWorker, commandPath, {
      method: 'POST',
      body,
      ...options,
    });
  const guestPostAnnotation = (guest, body) =>
    guestSend(guestWorker, guestAnnotationCommandPath, {
      method: 'POST',
      secret: guest.secret,
      body,
    });
  const guestPostComment = (guest, body) =>
    guestSend(guestCommentWorker, guestCommentCommandPath, {
      method: 'POST',
      secret: guest.secret,
      body,
    });
  const assertProcessingResult = async (response, expectedStatus = 200) => {
    const result = await expectOwnerJson(response, expectedStatus);
    if (expectedStatus === 200)
      ownerAnnotationProcessingResultSchema.parse(result);
    return result;
  };
  const capabilities = async (
    targetWorker = processingWorker,
    cookie = ownerCookie,
  ) => {
    const result = await readResponse(
      await ownerSend(targetWorker, capabilitiesPath, { cookie }),
    );
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    return ownerAnnotationProcessingCapabilitiesSchema.parse(result.value);
  };
  const guestFrom = (bundle, index = 0) => {
    const guest = bundle.guests?.[index] ?? bundle.guest;
    assert.ok(bundle.invite?.id && guest?.guestId && guest?.secret);
    return { ...guest, inviteId: bundle.invite.id };
  };
  const createScopedGuest = async (mask, name, targetPhotoId = photoId) => {
    const bundle = await fixture.createScopedGuestBundle(mask, [name]);
    const guest = guestFrom(bundle);
    guest.photoId = targetPhotoId;
    return { bundle, guest };
  };
  const createAnnotation = async (
    guest,
    {
      targetPhotoId = guest.photoId ?? photoId,
      targetVersionId = versionId,
      commentId = null,
      requestId = randomUUID(),
      x = 120_000,
    } = {},
  ) => {
    const body = {
      requestId,
      expectedGuestId: guest.guestId,
      operation: 'create',
      photoId: targetPhotoId,
      versionId: targetVersionId,
      geometry: {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x,
        y: 260_000,
      },
      style: { color: 'amber' },
      commentId,
    };
    const response = await guestPostAnnotation(guest, body);
    const result = await readResponse(response);
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    const parsed = guestAnnotationResultSchema.parse(result.value);
    assert.equal(parsed.item.revision, 1);
    return { body, receipt: parsed, item: parsed.item, raw: result.text };
  };
  const updateAnnotation = async (
    guest,
    item,
    {
      expectedRevision = item.revision,
      commentId = item.commentId,
      requestId = randomUUID(),
      x = 550_000,
      color = 'blue',
    } = {},
  ) => {
    const body = {
      requestId,
      expectedGuestId: guest.guestId,
      operation: 'update',
      annotationId: item.annotationId,
      expectedRevision,
      geometry: {
        type: 'rectangle',
        coordinateSpace: 'normalized_1e6',
        x,
        y: 300_000,
        width: 160_000,
        height: 190_000,
      },
      style: { color },
      commentId,
    };
    const response = await guestPostAnnotation(guest, body);
    const result = await readResponse(response);
    if (result.status !== 200) return { body, ...result };
    return {
      body,
      ...result,
      receipt: guestAnnotationResultSchema.parse(result.value),
    };
  };
  const lifecycleAnnotation = async (
    guest,
    operation,
    item,
    expectedRevision = item.revision,
  ) => {
    const body = {
      requestId: randomUUID(),
      expectedGuestId: guest.guestId,
      operation,
      annotationId: item.annotationId,
      expectedRevision,
    };
    const response = await guestPostAnnotation(guest, body);
    const result = await readResponse(response);
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    return {
      body,
      receipt: guestAnnotationResultSchema.parse(result.value),
    };
  };
  const createComment = async (guest, label) => {
    const body = {
      requestId: randomUUID(),
      expectedGuestId: guest.guestId,
      operation: 'create',
      targets: [{ photoId: guest.photoId ?? photoId, versionId }],
      body: label + ' ' + randomUUID(),
    };
    const result = await readResponse(await guestPostComment(guest, body));
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    const parsed = guestCommentResultSchema.parse(result.value);
    assert.equal(parsed.items.length, 1);
    return { body, item: parsed.items[0], raw: result.text };
  };
  const processingCommand = (
    guest,
    item,
    {
      requestId = randomUUID(),
      expectedAnnotationRevision = item.revision,
      expectedProcessingRevision = 0,
      state = 'in_progress',
    } = {},
  ) =>
    ownerAnnotationProcessingCommandSchema.parse({
      requestId,
      expectedOwnerId: owner,
      operation: 'set_processing_state',
      inviteId: guest.inviteId,
      photoId: item.photoId,
      versionId: item.versionId,
      annotationId: item.annotationId,
      expectedAnnotationRevision,
      expectedProcessingRevision,
      state,
    });
  const readOwnerPage = async (
    inviteId,
    options = {},
    cookie = ownerCookie,
  ) => {
    const result = await readResponse(
      await ownerSend(ownerReadWorker, ownerReadPath(inviteId, options), {
        cookie,
      }),
    );
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    return ownerAnnotationsPageSchema.parse(result.value);
  };
  const ownerItem = async (guest, annotationId, cookie = ownerCookie) => {
    const page = await readOwnerPage(
      guest.inviteId,
      { photoId: guest.photoId ?? photoId, annotationId },
      cookie,
    );
    assert.equal(page.inviteId, guest.inviteId);
    assert.equal(page.photoId, guest.photoId ?? photoId);
    assert.equal(page.versionId, versionId);
    assert.equal(page.items?.length, 1);
    assert.equal(page.items[0]?.annotationId, annotationId);
    return page.items[0];
  };
  const sharedPage = async (guest, options = {}) => {
    const result = await readResponse(
      await guestSend(
        guestWorker,
        guestAnnotationPath(
          options.photoId ?? guest.photoId ?? photoId,
          options.versionId ?? versionId,
          'shared',
          options,
        ),
        { secret: guest.secret },
      ),
    );
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    const page = guestSharedAnnotationsPageSchema.parse(result.value);
    return { ...result, page };
  };
  const sharedItem = async (guest, annotationId) => {
    const { page } = await sharedPage(guest, { annotationId });
    assert.equal(page.guestId, guest.guestId);
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.annotationId, annotationId);
    return page.items[0];
  };
  const guestOwnItem = async (guest, annotationId) => {
    const result = await readResponse(
      await guestSend(
        guestWorker,
        guestAnnotationPath(guest.photoId ?? photoId, versionId, 'own', {
          annotationId,
        }),
        { secret: guest.secret },
      ),
    );
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    const page = guestAnnotationsPageSchema.parse(result.value);
    assert.equal(page.guestId, guest.guestId);
    assert.equal(page.items?.length, 1);
    assert.equal(page.items[0]?.annotationId, annotationId);
    assert.equal(
      Object.hasOwn(page.items[0], 'processing'),
      false,
      'the existing Guest own response must remain unchanged',
    );
    return { page, raw: result.text };
  };
  const process = async (
    guest,
    item,
    options = {},
    cookie = ownerCookie,
    targetWorker = processingWorker,
  ) => {
    const body = processingCommand(guest, item, options);
    const result = await assertProcessingResult(
      await ownerSend(targetWorker, commandPath, {
        method: 'POST',
        body,
        cookie,
      }),
    );
    assert.equal(result.ownerId, owner);
    assert.equal(result.requestId, body.requestId);
    assert.equal(result.operation, body.operation);
    assert.equal(result.inviteId, body.inviteId);
    assert.equal(result.photoId, body.photoId);
    assert.equal(result.versionId, body.versionId);
    assert.equal(result.annotationId, body.annotationId);
    assert.equal(
      result.processing.annotationRevision,
      body.expectedAnnotationRevision,
    );
    assert.equal(
      result.processing.revision,
      body.expectedProcessingRevision + 1,
    );
    return { body, result };
  };
  const processingCounts = async () => {
    const row = await db
      .prepare(
        'SELECT ' +
          '(SELECT count(*) FROM owner_annotation_processing_commands) AS commands,' +
          '(SELECT count(*) FROM owner_annotation_processing_states) AS states,' +
          '(SELECT count(*) FROM owner_annotation_processing_changes) AS changes,' +
          '(SELECT count(*) FROM owner_annotation_processing_results) AS results,' +
          "(SELECT count(*) FROM audit_events WHERE actor_id=? AND action='owner.annotation_processing_changed') AS audits",
      )
      .bind(owner)
      .first();
    assert.ok(row);
    return row;
  };
  const sourceCounts = async () => {
    const row = await db
      .prepare(
        'SELECT ' +
          '(SELECT count(*) FROM guest_annotation_commands) AS guestCommands,' +
          '(SELECT count(*) FROM guest_annotations) AS guestAnnotations,' +
          '(SELECT count(*) FROM guest_annotation_changes) AS guestChanges,' +
          '(SELECT count(*) FROM guest_annotation_results) AS guestResults,' +
          "(SELECT count(*) FROM audit_events WHERE action LIKE 'annotation.%') AS guestAudits," +
          '(SELECT count(*) FROM guest_comment_commands) AS guestCommentCommands,' +
          '(SELECT count(*) FROM guest_comments) AS guestComments,' +
          '(SELECT count(*) FROM guest_comment_changes) AS guestCommentChanges,' +
          '(SELECT count(*) FROM guest_comment_results) AS guestCommentResults,' +
          "(SELECT count(*) FROM audit_events WHERE action LIKE 'comment.%') AS guestCommentAudits," +
          '(SELECT count(*) FROM owner_annotation_commands) AS ownerCommands,' +
          '(SELECT count(*) FROM owner_annotations) AS ownerAnnotations,' +
          '(SELECT count(*) FROM owner_annotation_changes) AS ownerChanges,' +
          '(SELECT count(*) FROM owner_annotation_results) AS ownerResults',
      )
      .first();
    assert.ok(row);
    return row;
  };
  const assertGuestSourcesUnchanged = async (before) =>
    assert.deepEqual(await sourceCounts(), before);
  const verifyProcessingPrivacy = (rawText, guest, guestBody = '') => {
    assert.equal(rawText.includes(guest.secret), false);
    assert.equal(rawText.includes(guest.sessionId ?? '\u0000'), false);
    if (guestBody) assert.equal(rawText.includes(guestBody), false);
    assert.equal(rawText.includes('r2Key'), false);
    assert.equal(rawText.includes('mediaUrl'), false);
    assert.equal(rawText.includes('guestSessionId'), false);
  };
  const makeOwnerSession = async (label) => {
    const sessionId = randomUUID();
    const token = 'annotation-processing:' + label + ':' + randomUUID();
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(sessionId, token, owner, now + 600_000, now, now)
      .run();
    const cookiePart = ownerCookie
      .split(';')
      .map((value) => value.trim())
      .find((value) =>
        value.slice(0, value.indexOf('=')).endsWith('.session_token'),
      );
    assert.ok(
      cookiePart,
      'the synthetic Owner cookie must identify its session cookie name',
    );
    const cookieName = cookiePart.slice(0, cookiePart.indexOf('='));
    const cookie =
      cookieName +
      '=' +
      encodeURIComponent(
        token + '.' + (await makeSignature(token, authSecret)),
      );
    return { sessionId, token, cookie };
  };
  const currentOwnerSession = async (cookie = ownerCookie) => {
    const result = await expectOwnerJson(
      await ownerSend(processingWorker, '/api/v1/me', { cookie }),
    );
    assert.equal(result.actor?.id, owner);
    assert.equal(typeof result.sessionId, 'string');
    return result.sessionId;
  };

  const cleanupOwnerSession = async (sessionId) => {
    await db
      .prepare('DELETE FROM owner_sessions WHERE id=?')
      .bind(sessionId)
      .run();
  };
  const snapshotCounts = async () => ({
    guest: await sourceCounts(),
    processing: await processingCounts(),
  });
  const assertOnlyProcessingWrites = (before, after, { states = 1 } = {}) => {
    assert.deepEqual(after.guest, before.guest);
    assert.equal(after.processing.commands, before.processing.commands + 1);
    assert.equal(after.processing.states, before.processing.states + states);
    assert.equal(after.processing.changes, before.processing.changes + 1);
    assert.equal(after.processing.results, before.processing.results + 1);
    assert.equal(after.processing.audits, before.processing.audits + 1);
  };

  await check(
    'Owner annotation processing has an independent local gate and strict Owner request boundary',
    async () => {
      const before = await snapshotCounts();
      assert.deepEqual(await capabilities(), { enabled: true });
      assert.deepEqual(await capabilities(disabledWorker), { enabled: false });

      const independentCapabilities = await Promise.all(
        [
          '/api/v1/annotations/authoring/capabilities',
          '/api/v1/comments/capabilities',
          '/api/guest/annotations/capabilities',
        ].map(async (path) =>
          expectOwnerJson(await ownerSend(processingWorker, path)),
        ),
      );
      assert.deepEqual(independentCapabilities, [
        { enabled: false },
        { enabled: false },
        { enabled: false },
      ]);
      await expectError(
        await ownerSend(processingWorker, capabilitiesPath + '?unexpected=1'),
        400,
        'INVALID_INPUT',
      );

      const seedGuest = {
        inviteId: fixture.inviteId,
        guestId: fixture.authorGuestId,
        secret: fixture.secretAuthor,
      };
      const seedItem = fixture.seededAnnotation;
      assert.ok(seedItem?.annotationId && seedItem?.revision);
      const validBody = processingCommand(seedGuest, seedItem);
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          body: {},
          includeCookie: false,
        }),
        401,
        'AUTH_REQUIRED',
      );
      await expectError(
        await ownerSend(disabledWorker, commandPath, {
          method: 'POST',
          body: validBody,
        }),
        503,
        'ANNOTATION_PROCESSING_DISABLED',
      );
      const hostileOrigin = await readResponse(
        await ownerPost(validBody, {
          extraHeaders: { Origin: 'https://untrusted.example' },
        }),
      );
      assert.equal(hostileOrigin.status, 403, hostileOrigin.text);
      assert.equal(hostileOrigin.text, 'Invalid Origin header');
      await expectError(
        await ownerPost(validBody, { omitOrigin: true }),
        403,
        'FORBIDDEN_ORIGIN',
      );
      await expectError(
        await ownerPost(validBody, { expectedActor: randomUUID() }),
        409,
        'OWNER_IDENTITY_CHANGED',
      );
      await expectError(
        await ownerPost({ ...validBody, expectedOwnerId: randomUUID() }),
        409,
        'OWNER_IDENTITY_CHANGED',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath + '?unexpected=1', {
          method: 'POST',
          body: validBody,
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerPost({ ...validBody, privateExtension: true }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          rawBody: true,
          body: '{',
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          contentType: 'text/plain',
          body: '{}',
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          rawBody: true,
          body: 'x'.repeat(8193),
        }),
        413,
        'BODY_TOO_LARGE',
      );
      assert.deepEqual(await snapshotCounts(), before);
    },
  );

  await check(
    'Owner processing writes only its immutable projection and reads preserve Guest annotation and comment history',
    async () => {
      const { guest } = await createScopedGuest(
        canAnnotate | canComment,
        'Processing body privacy',
      );
      const privateComment = await createComment(
        guest,
        'processing-private-comment-' + randomUUID(),
      );
      const annotation = await createAnnotation(guest, {
        commentId: privateComment.item.commentId,
      });

      const beforeWrite = await snapshotCounts();
      const processed = await process(guest, annotation.item);
      const afterWrite = await snapshotCounts();
      assertOnlyProcessingWrites(beforeWrite, afterWrite);
      assert.equal(
        processed.result.processing.contentRevision,
        annotation.item.revision,
      );
      assert.equal(processed.result.processing.stale, false);
      verifyProcessingPrivacy(
        JSON.stringify(processed.result),
        guest,
        privateComment.item.body,
      );
      assert.equal(
        JSON.stringify(processed.body).includes(privateComment.item.body),
        false,
      );

      const stored = await db
        .prepare(
          'SELECT c.id,c.actor_id,c.expected_owner_id,c.session_id,c.request_id,c.content_revision,c.request_json,' +
            'ch.before_json,ch.after_json,e.actor_type,e.session_id AS auditSessionId,' +
            'e.guest_session_id AS auditGuestSessionId,e.action ' +
            'FROM owner_annotation_processing_commands c ' +
            'JOIN owner_annotation_processing_changes ch ON ch.command_id=c.id ' +
            'JOIN audit_events e ON e.event_id=ch.event_id ' +
            'WHERE c.actor_id=? AND c.request_id=?',
        )
        .bind(owner, processed.body.requestId)
        .first();
      assert.ok(stored?.id);
      assert.equal(stored.actor_id, owner);
      assert.equal(stored.expected_owner_id, owner);
      assert.equal(stored.session_id, await currentOwnerSession());
      assert.equal(stored.content_revision, annotation.item.revision);
      assert.deepEqual(JSON.parse(stored.request_json), processed.body);
      assert.equal(stored.actor_type, 'user');
      assert.equal(stored.auditSessionId, stored.session_id);
      assert.equal(stored.auditGuestSessionId, null);
      assert.equal(stored.action, 'owner.annotation_processing_changed');
      for (const raw of [
        stored.request_json,
        stored.before_json,
        stored.after_json,
      ])
        verifyProcessingPrivacy(raw, guest, privateComment.item.body);
      assert.equal(stored.request_json.includes('geometry'), false);
      assert.equal(stored.request_json.includes('style'), false);
      assert.equal(stored.request_json.includes('commentId'), false);
      assert.equal(
        stored.after_json.includes(privateComment.item.commentId),
        false,
      );

      const beforeReads = await snapshotCounts();
      const ownerResponse = await readResponse(
        await ownerSend(
          ownerReadWorker,
          ownerReadPath(guest.inviteId, {
            photoId: guest.photoId,
            versionId,
            annotationId: annotation.item.annotationId,
          }),
        ),
      );
      assert.equal(ownerResponse.status, 200, ownerResponse.text);
      const ownerPage = ownerAnnotationsPageSchema.parse(ownerResponse.value);
      assert.equal(ownerPage.items.length, 1);
      const ownerItemValue = ownerPage.items[0];
      assert.equal(ownerItemValue.authorGuestId, guest.guestId);
      assert.equal(ownerItemValue.canEdit, false);
      assert.equal(ownerItemValue.processing.revision, 1);
      assert.equal(ownerItemValue.processing.annotationRevision, 1);
      assert.equal(ownerItemValue.processing.contentRevision, 1);
      assert.equal(ownerItemValue.processing.stale, false);
      verifyProcessingPrivacy(
        ownerResponse.text,
        guest,
        privateComment.item.body,
      );

      const sharedResult = await sharedPage(guest, {
        photoId: guest.photoId,
        annotationId: annotation.item.annotationId,
      });
      const sharedItemValue = sharedResult.page.items[0];
      assert.ok(sharedItemValue);
      assert.equal(sharedItemValue.authorType, 'guest');
      assert.equal(sharedItemValue.isMine, true);
      assert.deepEqual(sharedItemValue.processing, ownerItemValue.processing);
      assert.equal('authorGuestId' in sharedItemValue, false);
      verifyProcessingPrivacy(
        sharedResult.text,
        guest,
        privateComment.item.body,
      );

      const own = await guestOwnItem(guest, annotation.item.annotationId);
      assert.equal(
        Object.hasOwn(own.page.items[0], 'processing'),
        false,
        'the Guest own response contract must remain unchanged',
      );
      verifyProcessingPrivacy(own.raw, guest, privateComment.item.body);
      assert.deepEqual(await snapshotCounts(), beforeReads);
    },
  );

  await check(
    'Owner processing uses annotation and processing CAS revisions, including concurrent submissions',
    async () => {
      const { guest } = await createScopedGuest(
        canAnnotate,
        'Processing dual CAS',
      );
      const annotation = await createAnnotation(guest);
      const staleAnnotation = processingCommand(guest, annotation.item, {
        expectedAnnotationRevision: annotation.item.revision + 1,
      });
      await expectError(
        await ownerPost(staleAnnotation),
        409,
        'ANNOTATION_REVISION_CONFLICT',
      );
      const first = await process(guest, annotation.item);
      const staleProcessing = processingCommand(guest, annotation.item, {
        expectedProcessingRevision: 0,
        state: 'resolved',
      });
      await expectError(
        await ownerPost(staleProcessing),
        409,
        'ANNOTATION_PROCESSING_REVISION_CONFLICT',
      );

      const beforeRace = await snapshotCounts();
      const racingBodies = [
        processingCommand(guest, annotation.item, {
          expectedProcessingRevision: 1,
          state: 'open',
        }),
        processingCommand(guest, annotation.item, {
          expectedProcessingRevision: 1,
          state: 'resolved',
        }),
      ];
      const raceResponses = await Promise.all(
        racingBodies.map((body) => ownerPost(body)),
      );
      const raceResults = await Promise.all(raceResponses.map(readResponse));
      const successIndexes = raceResults
        .map((result, index) => (result.status === 200 ? index : -1))
        .filter((index) => index >= 0);
      const conflictIndexes = raceResults
        .map((result, index) => (result.status === 409 ? index : -1))
        .filter((index) => index >= 0);
      assert.equal(successIndexes.length, 1);
      assert.equal(conflictIndexes.length, 1);
      const successIndex = successIndexes[0];
      const conflictIndex = conflictIndexes[0];
      const winningReceipt = ownerAnnotationProcessingResultSchema.parse(
        raceResults[successIndex].value,
      );
      assert.equal(winningReceipt.processing.revision, 2);
      assert.equal(
        winningReceipt.requestId,
        racingBodies[successIndex].requestId,
      );
      assert.equal(
        raceResults[conflictIndex].value?.error?.code,
        'ANNOTATION_PROCESSING_REVISION_CONFLICT',
      );
      const afterRace = await snapshotCounts();
      assert.deepEqual(afterRace.guest, beforeRace.guest);
      assert.equal(
        afterRace.processing.commands,
        beforeRace.processing.commands + 1,
      );
      assert.equal(afterRace.processing.states, beforeRace.processing.states);
      assert.equal(
        afterRace.processing.changes,
        beforeRace.processing.changes + 1,
      );
      assert.equal(
        afterRace.processing.results,
        beforeRace.processing.results + 1,
      );
      assert.equal(
        afterRace.processing.audits,
        beforeRace.processing.audits + 1,
      );
      assert.equal(first.result.processing.revision, 1);
    },
  );

  await check(
    'Guest content edits stale processing while resolve and reopen preserve the content watermark',
    async () => {
      const { guest } = await createScopedGuest(
        canAnnotate | canComment,
        'Processing content acknowledgement',
      );
      const firstComment = await createComment(
        guest,
        'processing-linked-comment-one-' + randomUUID(),
      );
      const secondComment = await createComment(
        guest,
        'processing-linked-comment-two-' + randomUUID(),
      );
      const annotation = await createAnnotation(guest, {
        commentId: firstComment.item.commentId,
      });
      const initialAck = await process(guest, annotation.item);
      assert.equal(initialAck.result.processing.contentRevision, 1);
      assert.equal(initialAck.result.processing.stale, false);

      const updated = await updateAnnotation(guest, annotation.item, {
        expectedRevision: 1,
        commentId: secondComment.item.commentId,
        x: 440_000,
        color: 'blue',
      });
      assert.equal(updated.status, 200, JSON.stringify(updated.value));
      const updatedItem = updated.receipt.item;
      assert.equal(updatedItem.revision, 2);
      assert.equal(updatedItem.commentId, secondComment.item.commentId);
      let ownerSnapshot = await ownerItem(guest, annotation.item.annotationId);
      assert.equal(ownerSnapshot.processing.stale, true);
      assert.equal(ownerSnapshot.processing.annotationRevision, 1);
      assert.equal(ownerSnapshot.processing.contentRevision, 1);

      const resolved = await lifecycleAnnotation(guest, 'resolve', updatedItem);
      assert.equal(resolved.receipt.item.revision, 3);
      ownerSnapshot = await ownerItem(guest, annotation.item.annotationId);
      assert.equal(ownerSnapshot.state, 'resolved');
      assert.equal(ownerSnapshot.processing.stale, true);
      assert.equal(ownerSnapshot.processing.contentRevision, 1);

      const reopened = await lifecycleAnnotation(
        guest,
        'reopen',
        resolved.receipt.item,
      );
      assert.equal(reopened.receipt.item.revision, 4);
      ownerSnapshot = await ownerItem(guest, annotation.item.annotationId);
      assert.equal(ownerSnapshot.state, 'open');
      assert.equal(ownerSnapshot.processing.stale, true);
      assert.equal(ownerSnapshot.processing.annotationRevision, 1);
      assert.equal(ownerSnapshot.processing.contentRevision, 1);

      const beforeReack = await snapshotCounts();
      const reack = await process(guest, reopened.receipt.item, {
        expectedAnnotationRevision: 4,
        expectedProcessingRevision: 1,
        state: 'resolved',
      });
      assert.equal(reack.result.processing.revision, 2);
      assert.equal(reack.result.processing.annotationRevision, 4);
      assert.equal(reack.result.processing.contentRevision, 2);
      assert.equal(reack.result.processing.stale, false);
      await assertGuestSourcesUnchanged(beforeReack.guest);

      const ownerAfterReack = await ownerItem(
        guest,
        annotation.item.annotationId,
      );
      const sharedAfterReack = await sharedItem(
        guest,
        annotation.item.annotationId,
      );
      assert.deepEqual(ownerAfterReack.processing, reack.result.processing);
      assert.deepEqual(sharedAfterReack.processing, reack.result.processing);
      const serialized = JSON.stringify({
        receipt: reack.result,
        ownerAnnotation: ownerAfterReack,
        sharedAnnotation: sharedAfterReack,
      });
      assert.equal(serialized.includes(firstComment.item.body), false);
      assert.equal(serialized.includes(secondComment.item.body), false);
    },
  );

  await check(
    'A deleted Guest annotation rejects new processing commands but replays the exact receipt after an old Owner session is gone',
    async () => {
      const { guest } = await createScopedGuest(
        canAnnotate,
        'Processing deleted replay',
      );
      const annotation = await createAnnotation(guest);
      const oldSession = await makeOwnerSession('deleted-replay-old');
      let freshSession;
      try {
        const original = await process(
          guest,
          annotation.item,
          {},
          oldSession.cookie,
        );
        assert.equal(
          await currentOwnerSession(oldSession.cookie),
          oldSession.sessionId,
        );

        const deleted = await lifecycleAnnotation(
          guest,
          'delete',
          annotation.item,
        );
        assert.equal(deleted.receipt.item.state, 'deleted');
        assert.equal(deleted.receipt.item.revision, 2);

        const beforeNewCommand = await snapshotCounts();
        const newCommand = processingCommand(guest, deleted.receipt.item, {
          expectedAnnotationRevision: deleted.receipt.item.revision,
          expectedProcessingRevision: original.result.processing.revision,
          state: 'resolved',
        });
        await expectError(
          await ownerPost(newCommand),
          409,
          'ANNOTATION_NOT_EDITABLE',
        );
        assert.deepEqual(await snapshotCounts(), beforeNewCommand);

        await cleanupOwnerSession(oldSession.sessionId);
        freshSession = await makeOwnerSession('deleted-replay-fresh');
        assert.equal(
          await currentOwnerSession(freshSession.cookie),
          freshSession.sessionId,
        );
        const beforeReplay = await snapshotCounts();
        const replay = await assertProcessingResult(
          await ownerSend(processingWorker, commandPath, {
            method: 'POST',
            body: original.body,
            cookie: freshSession.cookie,
          }),
        );
        assert.deepEqual(replay, original.result);
        assert.deepEqual(await snapshotCounts(), beforeReplay);

        const retained = await ownerItem(
          guest,
          annotation.item.annotationId,
          freshSession.cookie,
        );
        assert.equal(retained.state, 'deleted');
        assert.equal(retained.geometry, null);
        assert.equal(retained.style, null);
        assert.equal(retained.commentId, null);
        assert.deepEqual(retained.processing, original.result.processing);
        const deletedShared = await sharedItem(
          guest,
          annotation.item.annotationId,
        );
        assert.equal(deletedShared.state, 'deleted');
        assert.equal(deletedShared.geometry, null);
        assert.deepEqual(deletedShared.processing, original.result.processing);
      } finally {
        if (freshSession) await cleanupOwnerSession(freshSession.sessionId);
        await cleanupOwnerSession(oldSession.sessionId);
      }
    },
  );

  await check(
    'Owner and Guest shared pagination cursors both invalidate when processing history advances',
    async () => {
      const { guest } = await createScopedGuest(
        canAnnotate,
        'Processing cursor pair',
      );
      for (let index = 0; index < 25; index += 1)
        await createAnnotation(guest, { x: 100_000 + index * 10_000 });

      const beforeReads = await snapshotCounts();
      const firstOwnerPage = await readOwnerPage(guest.inviteId, {
        photoId: guest.photoId,
        versionId,
      });
      assert.equal(firstOwnerPage.items.length, 24);
      assert.ok(firstOwnerPage.nextCursor);
      const firstSharedResult = await sharedPage(guest);
      assert.equal(firstSharedResult.page.items.length, 24);
      assert.ok(firstSharedResult.page.nextCursor);
      assert.deepEqual(await snapshotCounts(), beforeReads);

      await process(guest, firstOwnerPage.items[0]);
      const afterProcessing = await snapshotCounts();
      await expectError(
        await ownerSend(
          ownerReadWorker,
          ownerReadPath(guest.inviteId, {
            photoId: guest.photoId,
            versionId,
            cursor: firstOwnerPage.nextCursor,
          }),
        ),
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );
      await expectError(
        await guestSend(
          guestWorker,
          guestAnnotationPath(guest.photoId, versionId, 'shared', {
            cursor: firstSharedResult.page.nextCursor,
          }),
          { secret: guest.secret },
        ),
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );
      assert.deepEqual(await snapshotCounts(), afterProcessing);
    },
  );
}
