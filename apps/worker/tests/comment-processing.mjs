import { makeSignature } from 'better-auth/crypto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  guestCommentResultSchema,
  guestCommentsPageSchema,
} from '../../../packages/contracts/src/guest-comments.ts';
import {
  commentProcessingSnapshotSchema,
  ownerCommentProcessingCapabilitiesSchema,
  ownerCommentProcessingResultSchema,
} from '../../../packages/contracts/src/comment-processing.ts';
import { ownerCommentThreadPageSchema } from '../../../packages/contracts/src/owner-comments.ts';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function runCommentProcessingChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  request,
  guestCommentsFixture,
  authSecret,
}) {
  const fixture = guestCommentsFixture;
  assert.ok(fixture?.albumId && fixture?.photoId && fixture?.versionId);
  assert.ok(fixture?.commentOnlyInviteId && fixture?.otherInviteId);
  assert.ok(fixture?.commentOnlySecret && fixture?.commentOnlyGuestId);
  assert.equal(typeof request, 'function');

  const processingWorker = await mf.getWorker('owner-processing-test');
  const ownerCommentsWorker = await mf.getWorker('owner-comments-test');
  const guestWorker = await mf.getWorker(
    fixture.workerName ?? 'guest-comments-test',
  );
  const ownerCookie = cookies.headers();
  const albumId = fixture.albumId;
  const photoId = fixture.photoId;
  const versionId = fixture.versionId;
  const inviteId = fixture.commentOnlyInviteId;
  const otherInviteId = fixture.otherInviteId;
  const guestId = fixture.commentOnlyGuestId;
  const guestSecret = fixture.commentOnlySecret;
  const commandPath =
    '/api/v1/albums/' + albumId + '/comment-processing/commands';
  const ownerReplyPath =
    '/api/v1/albums/' + albumId + '/comment-replies/commands';
  const ownerThreadPath = (targetInviteId, options = {}) => {
    const url = new URL(
      '/api/v1/albums/' +
        albumId +
        '/photos/' +
        photoId +
        '/versions/' +
        versionId +
        '/comment-threads',
      base,
    );
    url.searchParams.set('inviteId', targetInviteId);
    if (options.commentId) url.searchParams.set('commentId', options.commentId);
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    return url.pathname + url.search;
  };
  const guestCommandPath =
    '/api/guest/albums/' + albumId + '/comments/commands';
  const guestThreadPath = (options = {}) => {
    const url = new URL(
      '/api/guest/albums/' +
        albumId +
        '/photos/' +
        photoId +
        '/versions/' +
        versionId +
        '/comments',
      base,
    );
    if (options.commentId) url.searchParams.set('commentId', options.commentId);
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    return url.pathname + url.search;
  };

  const ownerSend = (
    targetWorker,
    path,
    {
      method = 'GET',
      body,
      cookie = ownerCookie,
      expectedActor = owner,
      omitOrigin = false,
      origin,
      contentType = 'application/json',
      extraHeaders = {},
    } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') {
      if (!omitOrigin) headers.Origin = origin ?? new URL(base).origin;
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
    path,
    { method = 'GET', body, secret = guestSecret } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    const name =
      new URL(base).protocol === 'https:' ? '__Host-kino_guest' : 'kino_guest';
    headers.Cookie = name + '=' + secret;
    if (method !== 'GET' && method !== 'HEAD') {
      headers.Origin = new URL(base).origin;
      headers['Content-Type'] = 'application/json';
    }
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return guestWorker.fetch(new Request(new URL(path, base), init));
  };
  const readJson = async (response) => parseJson(await response.text());
  const expectError = async (response, status, code) => {
    const body = await readJson(response);
    assert.equal(response.status, status, JSON.stringify(body));
    if (code) assert.equal(body?.error?.code, code, JSON.stringify(body));
    return body;
  };
  const postGuest = (body) =>
    guestSend(guestCommandPath, { method: 'POST', body });
  const postProcessing = (body, options = {}) =>
    ownerSend(processingWorker, commandPath, {
      method: 'POST',
      body,
      ...options,
    });
  const readOwnerItem = async (commentId) => {
    const response = await ownerSend(
      ownerCommentsWorker,
      ownerThreadPath(inviteId, { commentId }),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    const page = ownerCommentThreadPageSchema.parse(body);
    assert.equal(page.inviteId, inviteId);
    assert.equal(page.items.length, 1);
    return page.items[0];
  };
  const readGuestItem = async (commentId) => {
    const response = await guestSend(guestThreadPath({ commentId }));
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    const page = guestCommentsPageSchema.parse(body);
    assert.equal(page.guestId, guestId);
    assert.equal(page.items.length, 1);
    return page.items[0];
  };
  const readOwnerPage = async (targetInviteId = inviteId, options = {}) => {
    const response = await ownerSend(
      ownerCommentsWorker,
      ownerThreadPath(targetInviteId, options),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return ownerCommentThreadPageSchema.parse(body);
  };
  const readGuestPage = async (options = {}) => {
    const response = await guestSend(guestThreadPath(options));
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    const page = guestCommentsPageSchema.parse(body);
    assert.equal(page.guestId, guestId);
    return page;
  };
  const createParent = async (label) => {
    const text = 'Processing API parent ' + label + ' ' + randomUUID();
    const response = await postGuest({
      requestId: randomUUID(),
      expectedGuestId: guestId,
      operation: 'create',
      targets: [{ photoId, versionId }],
      body: text,
    });
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    const result = guestCommentResultSchema.parse(body);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].body, text);
    return result.items[0];
  };
  const processingCommand = (
    parent,
    {
      requestId = randomUUID(),
      state = 'in_progress',
      expectedCommentRevision = parent.revision,
      expectedProcessingRevision = 0,
    } = {},
  ) => ({
    requestId,
    operation: 'set_processing_state',
    inviteId,
    photoId,
    versionId,
    commentId: parent.commentId,
    expectedCommentRevision,
    expectedProcessingRevision,
    state,
  });
  const readProcessingResult = async (response, expectedStatus = 200) => {
    const body = await readJson(response);
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    if (expectedStatus === 200) ownerCommentProcessingResultSchema.parse(body);
    return body;
  };
  const processingTableSnapshot = async () => {
    const snapshot = {};
    for (const table of [
      'guest_comment_changes',
      'owner_comment_commands',
      'owner_comment_changes',
      'owner_comment_processing_commands',
      'owner_comment_processing_state',
      'owner_comment_processing_changes',
      'owner_comment_processing_results',
      'comment_thread_changes',
    ]) {
      const row = await db
        .prepare('SELECT count(*) AS n FROM ' + table)
        .first();
      snapshot[table] = row?.n ?? null;
    }
    const audit = await db
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action='owner.comment_processing_changed'",
      )
      .bind(owner)
      .first();
    snapshot.processingAudit = audit?.n ?? null;
    return snapshot;
  };
  const assertProcessingProvenance = async (command, receipt, parent) => {
    const authResponse = await request('/api/auth/get-session', {
      headers: { Cookie: ownerCookie },
    });
    const authBody = await readJson(authResponse);
    assert.equal(authResponse.status, 200, JSON.stringify(authBody));
    assert.equal(authBody?.user?.id, owner);
    const sessionId = authBody?.session?.id;
    assert.ok(sessionId);

    const storedCommand = await db
      .prepare(
        'SELECT id,actor_id,session_id,request_id,workspace_id,project_id,album_id,invite_id,photo_id,version_id,comment_id,operation,target_state,expected_comment_revision,expected_processing_revision,content_revision,request_json,created_at_ms FROM owner_comment_processing_commands WHERE actor_id=? AND request_id=?',
      )
      .bind(owner, command.requestId.toLowerCase())
      .first();
    assert.ok(storedCommand?.id);
    assert.deepEqual(
      {
        actor: storedCommand.actor_id,
        session: storedCommand.session_id,
        requestId: storedCommand.request_id,
        albumId: storedCommand.album_id,
        inviteId: storedCommand.invite_id,
        photoId: storedCommand.photo_id,
        versionId: storedCommand.version_id,
        commentId: storedCommand.comment_id,
        operation: storedCommand.operation,
        targetState: storedCommand.target_state,
        expectedCommentRevision: storedCommand.expected_comment_revision,
        expectedProcessingRevision: storedCommand.expected_processing_revision,
        contentRevision: storedCommand.content_revision,
      },
      {
        actor: owner,
        session: sessionId,
        requestId: command.requestId.toLowerCase(),
        albumId,
        inviteId,
        photoId,
        versionId,
        commentId: parent.commentId,
        operation: 'set_processing_state',
        targetState: command.state,
        expectedCommentRevision: command.expectedCommentRevision,
        expectedProcessingRevision: command.expectedProcessingRevision,
        contentRevision: 1,
      },
    );
    assert.equal(
      storedCommand.request_json,
      JSON.stringify({
        requestId: command.requestId.toLowerCase(),
        operation: 'set_processing_state',
        inviteId,
        photoId,
        versionId,
        commentId: parent.commentId,
        expectedCommentRevision: command.expectedCommentRevision,
        expectedProcessingRevision: command.expectedProcessingRevision,
        state: command.state,
      }),
    );

    const change = await db
      .prepare(
        'SELECT event_id,actor_id,session_id,request_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,comment_id,revision,occurred_at_ms,before_json,after_json FROM owner_comment_processing_changes WHERE command_id=?',
      )
      .bind(storedCommand.id)
      .first();
    assert.ok(change?.event_id);
    assert.equal(
      change.event_id,
      'owner-comment-processing:' + parent.commentId + ':1',
    );
    assert.equal(change.actor_id, owner);
    assert.equal(change.session_id, sessionId);
    assert.equal(change.request_id, command.requestId.toLowerCase());
    assert.equal(change.invite_id, inviteId);
    assert.equal(change.album_id, albumId);
    assert.equal(change.photo_id, photoId);
    assert.equal(change.version_id, versionId);
    assert.equal(change.comment_id, parent.commentId);
    assert.equal(change.revision, 1);
    assert.deepEqual(JSON.parse(change.before_json), {
      commentId: parent.commentId,
      state: 'open',
      revision: 0,
      commentRevision: null,
      contentRevision: null,
    });
    assert.deepEqual(JSON.parse(change.after_json), {
      commentId: parent.commentId,
      state: command.state,
      revision: 1,
      commentRevision: command.expectedCommentRevision,
      contentRevision: 1,
    });

    const marker = await db
      .prepare(
        "SELECT source_kind,source_event_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,occurred_at_ms FROM comment_thread_changes WHERE source_kind='owner' AND source_event_id=?",
      )
      .bind(change.event_id)
      .first();
    assert.ok(marker);
    assert.deepEqual(marker, {
      source_kind: 'owner',
      source_event_id: change.event_id,
      invite_id: inviteId,
      workspace_id: storedCommand.workspace_id,
      project_id: storedCommand.project_id,
      album_id: albumId,
      photo_id: photoId,
      version_id: versionId,
      occurred_at_ms: change.occurred_at_ms,
    });

    const audit = await db
      .prepare(
        "SELECT event_id,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc FROM audit_events WHERE event_id=? AND action='owner.comment_processing_changed'",
      )
      .bind(change.event_id)
      .first();
    assert.ok(audit);
    assert.deepEqual(audit, {
      event_id: change.event_id,
      actor_type: 'user',
      actor_id: owner,
      session_id: sessionId,
      guest_session_id: null,
      workspace_id: storedCommand.workspace_id,
      project_id: storedCommand.project_id,
      album_id: albumId,
      photo_id: photoId,
      version_id: versionId,
      action: 'owner.comment_processing_changed',
      before_json: change.before_json,
      after_json: change.after_json,
      request_id: command.requestId.toLowerCase(),
      occurred_at_utc: new Date(change.occurred_at_ms).toISOString(),
    });
    assert.equal(receipt.occurredAt, audit.occurred_at_utc);

    const storedResult = await db
      .prepare(
        'SELECT result_json,occurred_at_ms FROM owner_comment_processing_results WHERE actor_id=? AND request_id=?',
      )
      .bind(owner, command.requestId.toLowerCase())
      .first();
    assert.ok(storedResult?.result_json);
    assert.deepEqual(JSON.parse(storedResult.result_json), receipt);
    assert.equal(storedResult.occurred_at_ms, change.occurred_at_ms);
    for (const value of [
      storedCommand.request_json,
      change.before_json,
      change.after_json,
      JSON.stringify(audit),
      storedResult.result_json,
    ])
      assert.equal(value.includes(parent.body), false);
  };
  const expectInitialProcessing = (value) =>
    assert.deepEqual(commentProcessingSnapshotSchema.parse(value), {
      state: 'open',
      revision: 0,
      commentRevision: null,
      contentRevision: null,
      updatedAt: null,
      stale: false,
    });
  const ownerReply = async (
    parent,
    requestId,
    body,
    targetInviteId = inviteId,
  ) => {
    const response = await ownerSend(ownerCommentsWorker, ownerReplyPath, {
      method: 'POST',
      body: {
        requestId,
        operation: 'reply',
        inviteId: targetInviteId,
        photoId,
        versionId,
        parentCommentId: parent.commentId,
        expectedParentRevision: parent.revision,
        body: body ?? 'Namespace reply ' + randomUUID(),
      },
    });
    return { response, body: await readJson(response) };
  };

  await check(
    'Owner comment processing stays default-OFF in the Owner comments Worker',
    async () => {
      const parent = await createParent('default-off');
      const capabilityResponse = await ownerSend(
        ownerCommentsWorker,
        '/api/v1/comment-processing/capabilities',
      );
      const capabilityBody = await readJson(capabilityResponse);
      assert.equal(
        capabilityResponse.status,
        200,
        JSON.stringify(capabilityBody),
      );
      assert.deepEqual(
        ownerCommentProcessingCapabilitiesSchema.parse(capabilityBody),
        { enabled: false },
      );

      const before = await processingTableSnapshot();
      await expectError(
        await ownerSend(ownerCommentsWorker, commandPath, {
          method: 'POST',
          body: processingCommand(parent, { state: 'in_progress' }),
        }),
        503,
        'COMMENT_PROCESSING_DISABLED',
      );
      assert.deepEqual(await processingTableSnapshot(), before);
      expectInitialProcessing(
        (await readGuestItem(parent.commentId)).processing,
      );
    },
  );

  await check(
    'Owner processing records an independent body-free receipt visible in current Owner and Guest snapshots',
    async () => {
      const capabilityResponse = await ownerSend(
        processingWorker,
        '/api/v1/comment-processing/capabilities',
      );
      const capabilityBody = await readJson(capabilityResponse);
      assert.equal(
        capabilityResponse.status,
        200,
        JSON.stringify(capabilityBody),
      );
      assert.deepEqual(
        ownerCommentProcessingCapabilitiesSchema.parse(capabilityBody),
        { enabled: true },
      );

      const parent = await createParent('initial');
      const ownerPageBefore = await readOwnerPage();
      const guestPageBefore = await readGuestPage();
      assert.ok(ownerPageBefore.nextCursor);
      assert.ok(guestPageBefore.nextCursor);
      const ownerCursorProbe = await ownerSend(
        ownerCommentsWorker,
        ownerThreadPath(inviteId, { cursor: ownerPageBefore.nextCursor }),
      );
      const ownerCursorProbeBody = await readJson(ownerCursorProbe);
      assert.equal(
        ownerCursorProbe.status,
        200,
        JSON.stringify(ownerCursorProbeBody),
      );
      ownerCommentThreadPageSchema.parse(ownerCursorProbeBody);
      const guestCursorProbe = await guestSend(
        guestThreadPath({ cursor: guestPageBefore.nextCursor }),
      );
      const guestCursorProbeBody = await readJson(guestCursorProbe);
      assert.equal(
        guestCursorProbe.status,
        200,
        JSON.stringify(guestCursorProbeBody),
      );
      guestCommentsPageSchema.parse(guestCursorProbeBody);

      const beforeOwner = await readOwnerItem(parent.commentId);
      const beforeGuest = await readGuestItem(parent.commentId);
      expectInitialProcessing(beforeOwner.processing);
      expectInitialProcessing(beforeGuest.processing);
      assert.deepEqual(
        {
          body: beforeGuest.body,
          state: beforeGuest.state,
          revision: beforeGuest.revision,
        },
        { body: parent.body, state: 'open', revision: 1 },
      );

      const command = processingCommand(parent, { state: 'in_progress' });
      const receipt = await readProcessingResult(await postProcessing(command));
      assert.deepEqual(Object.keys(receipt).sort(), [
        'commentId',
        'occurredAt',
        'operation',
        'photoId',
        'processing',
        'requestId',
        'versionId',
      ]);
      assert.deepEqual(Object.keys(receipt.processing).sort(), [
        'commentRevision',
        'contentRevision',
        'revision',
        'stale',
        'state',
        'updatedAt',
      ]);
      assert.equal(JSON.stringify(receipt).includes(parent.body), false);
      assert.equal(receipt.requestId, command.requestId.toLowerCase());
      assert.equal(receipt.operation, 'set_processing_state');
      assert.equal(receipt.commentId, parent.commentId);
      assert.equal(receipt.photoId, photoId);
      assert.equal(receipt.versionId, versionId);
      assert.deepEqual(receipt.processing, {
        state: 'in_progress',
        revision: 1,
        commentRevision: 1,
        contentRevision: 1,
        updatedAt: receipt.occurredAt,
        stale: false,
      });
      await assertProcessingProvenance(command, receipt, parent);

      const countsBeforeCurrentReads = await processingTableSnapshot();
      const currentOwner = await readOwnerItem(parent.commentId);
      const currentGuest = await readGuestItem(parent.commentId);
      assert.deepEqual(currentOwner.processing, receipt.processing);
      assert.deepEqual(currentGuest.processing, receipt.processing);
      assert.deepEqual(
        {
          body: currentGuest.body,
          state: currentGuest.state,
          revision: currentGuest.revision,
        },
        { body: parent.body, state: 'open', revision: 1 },
      );
      await expectError(
        await ownerSend(
          ownerCommentsWorker,
          ownerThreadPath(inviteId, { cursor: ownerPageBefore.nextCursor }),
        ),
        409,
        'COMMENT_HISTORY_CHANGED',
      );
      await expectError(
        await guestSend(
          guestThreadPath({ cursor: guestPageBefore.nextCursor }),
        ),
        409,
        'COMMENT_HISTORY_CHANGED',
      );
      assert.deepEqual(
        await processingTableSnapshot(),
        countsBeforeCurrentReads,
        'current thread reads must not write projections or history',
      );

      const countsAfterCommit = await processingTableSnapshot();
      assert.deepEqual(
        await readProcessingResult(await postProcessing(command)),
        receipt,
      );
      assert.deepEqual(await processingTableSnapshot(), countsAfterCommit);
    },
  );

  await check(
    'Processing commands enforce Owner-only authority, exact invitation scope and processing CAS',
    async () => {
      const parent = await createParent('scope-and-cas');
      const command = processingCommand(parent, { state: 'resolved' });
      const before = await processingTableSnapshot();

      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          body: command,
          omitOrigin: true,
        }),
        403,
        'FORBIDDEN_ORIGIN',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          body: command,
          contentType: 'text/plain',
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          body: command,
          expectedActor: null,
        }),
        403,
        'COMMENT_PROCESSING_OWNER_CHANGED',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          body: command,
          expectedActor: randomUUID(),
        }),
        403,
        'COMMENT_PROCESSING_OWNER_CHANGED',
      );
      await expectError(
        await ownerSend(processingWorker, commandPath + '?unexpected=1', {
          method: 'POST',
          body: command,
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(
          processingWorker,
          commandPath + '?unexpected=1&unexpected=2',
          { method: 'POST', body: command },
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await postProcessing({ ...command, actorId: owner }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await postProcessing({ ...command, sessionId: randomUUID() }),
        400,
        'INVALID_INPUT',
      );
      assert.deepEqual(await processingTableSnapshot(), before);

      const guestCookieName =
        new URL(base).protocol === 'https:'
          ? '__Host-kino_guest'
          : 'kino_guest';
      await expectError(
        await ownerSend(processingWorker, commandPath, {
          method: 'POST',
          body: command,
          cookie: guestCookieName + '=' + guestSecret,
        }),
        401,
        'AUTH_REQUIRED',
      );

      await expectError(
        await postProcessing({
          ...command,
          inviteId: otherInviteId,
        }),
        404,
        'NOT_FOUND',
      );

      const guestPayload = {
        requestId: randomUUID(),
        expectedGuestId: guestId,
        operation: 'edit',
        commentId: parent.commentId,
        expectedRevision: parent.revision,
        body: 'Guest cannot set the Owner processing projection',
        processing: { state: 'resolved' },
      };
      await expectError(await postGuest(guestPayload), 400, 'INVALID_INPUT');

      await readProcessingResult(await postProcessing(command));
      const afterCommit = await processingTableSnapshot();
      await expectError(
        await postProcessing({
          ...command,
          requestId: randomUUID(),
          expectedProcessingRevision: 0,
        }),
        409,
        'COMMENT_PROCESSING_REVISION_CONFLICT',
      );
      assert.notDeepEqual(afterCommit, before);
      assert.deepEqual(await processingTableSnapshot(), afterCommit);
      const guestNow = await readGuestItem(parent.commentId);
      assert.equal(guestNow.body, parent.body);
      assert.equal(guestNow.revision, 1);
    },
  );

  await check(
    'Guest body edits make Owner processing stale, while same-state acknowledgement and resolve/reopen preserve content watermark rules',
    async () => {
      const parent = await createParent('stale-and-lifecycle');
      const originalCommand = processingCommand(parent, {
        state: 'in_progress',
      });
      const originalReceipt = await readProcessingResult(
        await postProcessing(originalCommand),
      );

      const edited = await readJson(
        await postGuest({
          requestId: randomUUID(),
          expectedGuestId: guestId,
          operation: 'edit',
          commentId: parent.commentId,
          expectedRevision: 1,
          body: 'Edited Guest content ' + randomUUID(),
        }),
      );
      assert.equal(edited.operation, 'edit');
      const afterEdit = guestCommentResultSchema.parse(edited).items[0];
      assert.equal(afterEdit.revision, 2);
      const staleOwner = await readOwnerItem(parent.commentId);
      const staleGuest = await readGuestItem(parent.commentId);
      assert.deepEqual(staleOwner.processing, {
        ...originalReceipt.processing,
        stale: true,
      });
      assert.deepEqual(staleGuest.processing, staleOwner.processing);
      assert.equal(staleGuest.body, afterEdit.body);
      assert.equal(staleGuest.revision, 2);

      const reaffirmCommand = processingCommand(afterEdit, {
        state: 'in_progress',
        expectedProcessingRevision: 1,
      });
      const reaffirm = await readProcessingResult(
        await postProcessing(reaffirmCommand),
      );
      assert.deepEqual(reaffirm.processing, {
        state: 'in_progress',
        revision: 2,
        commentRevision: 2,
        contentRevision: 2,
        updatedAt: reaffirm.occurredAt,
        stale: false,
      });

      const resolved = guestCommentResultSchema.parse(
        await readJson(
          await postGuest({
            requestId: randomUUID(),
            expectedGuestId: guestId,
            operation: 'resolve',
            commentId: parent.commentId,
            expectedRevision: 2,
          }),
        ),
      ).items[0];
      assert.equal(resolved.revision, 3);
      assert.equal(resolved.state, 'resolved');
      const afterResolve = await readOwnerItem(parent.commentId);
      assert.deepEqual(afterResolve.processing, reaffirm.processing);
      assert.equal(afterResolve.processing.stale, false);

      const reopened = guestCommentResultSchema.parse(
        await readJson(
          await postGuest({
            requestId: randomUUID(),
            expectedGuestId: guestId,
            operation: 'reopen',
            commentId: parent.commentId,
            expectedRevision: 3,
          }),
        ),
      ).items[0];
      assert.equal(reopened.revision, 4);
      assert.equal(reopened.state, 'open');
      const afterReopen = await readGuestItem(parent.commentId);
      assert.equal(afterReopen.processing.revision, 2);
      assert.equal(afterReopen.processing.commentRevision, 2);
      assert.equal(afterReopen.processing.contentRevision, 2);
      assert.equal(afterReopen.processing.stale, false);
      assert.equal(afterReopen.revision, 4);
    },
  );

  await check(
    'Concurrent Owner processing writes have one compare-and-set winner',
    async () => {
      const parent = await createParent('concurrent-cas');
      const commands = [
        processingCommand(parent, {
          requestId: randomUUID(),
          state: 'in_progress',
          expectedProcessingRevision: 0,
        }),
        processingCommand(parent, {
          requestId: randomUUID(),
          state: 'resolved',
          expectedProcessingRevision: 0,
        }),
      ];
      const before = await processingTableSnapshot();
      const outcomes = await Promise.all(
        commands.map(async (command) => {
          const response = await postProcessing(command);
          return { command, response, body: await readJson(response) };
        }),
      );
      const winners = outcomes.filter(
        ({ response }) => response.status === 200,
      );
      const losers = outcomes.filter(({ response }) => response.status !== 200);
      assert.equal(
        winners.length,
        1,
        JSON.stringify(outcomes.map((value) => value.body)),
      );
      assert.equal(
        losers.length,
        1,
        JSON.stringify(outcomes.map((value) => value.body)),
      );
      const winner = winners[0];
      const loser = losers[0];
      assert.ok(winner && loser);
      ownerCommentProcessingResultSchema.parse(winner.body);
      assert.equal(loser.response.status, 409, JSON.stringify(loser.body));
      assert.equal(
        loser.body?.error?.code,
        'COMMENT_PROCESSING_REVISION_CONFLICT',
      );

      const after = await processingTableSnapshot();
      for (const table of [
        'owner_comment_processing_commands',
        'owner_comment_processing_state',
        'owner_comment_processing_changes',
        'owner_comment_processing_results',
        'comment_thread_changes',
        'processingAudit',
      ])
        assert.equal(after[table], before[table] + 1, table);
      assert.equal(after.guest_comment_changes, before.guest_comment_changes);
      assert.equal(after.owner_comment_commands, before.owner_comment_commands);
      assert.equal(after.owner_comment_changes, before.owner_comment_changes);

      const loserRow = await db
        .prepare(
          'SELECT id FROM owner_comment_processing_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, loser.command.requestId.toLowerCase())
        .first();
      assert.equal(loserRow, null);
      const currentOwner = await readOwnerItem(parent.commentId);
      const currentGuest = await readGuestItem(parent.commentId);
      assert.equal(currentOwner.processing.revision, 1);
      assert.equal(currentOwner.processing.state, winner.command.state);
      assert.deepEqual(currentGuest.processing, currentOwner.processing);
      assert.equal(currentGuest.revision, 1);
      assert.equal(currentGuest.body, parent.body);
    },
  );

  await check(
    'Exact processing receipts replay after Guest edit and deletion under a fresh opaque Owner session',
    async () => {
      const parent = await createParent('fresh-session-replay');
      const command = processingCommand(parent, {
        state: 'resolved',
      });
      const receipt = await readProcessingResult(await postProcessing(command));
      const storedBefore = await db
        .prepare(
          'SELECT id,session_id,content_revision,request_json FROM owner_comment_processing_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, command.requestId.toLowerCase())
        .first();
      assert.ok(storedBefore?.id && storedBefore?.session_id);
      const originalSession = await request('/api/auth/get-session', {
        headers: { Cookie: ownerCookie },
      });
      const originalSessionBody = await readJson(originalSession);
      assert.equal(
        originalSession.status,
        200,
        JSON.stringify(originalSessionBody),
      );
      assert.equal(storedBefore.session_id, originalSessionBody?.session?.id);

      const guestEdit = guestCommentResultSchema.parse(
        await readJson(
          await postGuest({
            requestId: randomUUID(),
            expectedGuestId: guestId,
            operation: 'edit',
            commentId: parent.commentId,
            expectedRevision: 1,
            body: 'Changed after processing receipt ' + randomUUID(),
          }),
        ),
      ).items[0];
      assert.equal(guestEdit.revision, 2);

      const isolatedSessionId = 'owner-processing-fresh:' + randomUUID();
      const token = 'owner-processing-token:' + randomUUID();
      const now = Date.now();
      await db
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(isolatedSessionId, token, owner, now + 600000, now, now)
        .run();
      const cookiePart = ownerCookie
        .split(';')
        .map((value) => value.trim())
        .find((value) =>
          value.slice(0, value.indexOf('=')).endsWith('.session_token'),
        );
      assert.ok(cookiePart, 'actual OAuth cookie has a session cookie name');
      const cookieName = cookiePart.slice(0, cookiePart.indexOf('='));
      const freshCookie =
        cookieName +
        '=' +
        encodeURIComponent(
          token + '.' + (await makeSignature(token, authSecret)),
        );
      try {
        const whoami = await ownerSend(processingWorker, '/api/v1/me', {
          cookie: freshCookie,
        });
        const whoamiBody = await readJson(whoami);
        assert.equal(whoami.status, 200, JSON.stringify(whoamiBody));
        assert.equal(whoamiBody.sessionId, isolatedSessionId);

        const beforeEditReplay = await processingTableSnapshot();
        assert.deepEqual(
          await readProcessingResult(
            await postProcessing(command, { cookie: freshCookie }),
          ),
          receipt,
        );
        assert.deepEqual(await processingTableSnapshot(), beforeEditReplay);

        const guestDelete = guestCommentResultSchema.parse(
          await readJson(
            await postGuest({
              requestId: randomUUID(),
              expectedGuestId: guestId,
              operation: 'delete',
              commentId: parent.commentId,
              expectedRevision: 2,
            }),
          ),
        ).items[0];
        assert.equal(guestDelete.revision, 3);
        assert.equal(guestDelete.state, 'deleted');

        const beforeDeleteReplay = await processingTableSnapshot();
        assert.deepEqual(
          await readProcessingResult(
            await postProcessing(command, { cookie: freshCookie }),
          ),
          receipt,
        );
        assert.deepEqual(await processingTableSnapshot(), beforeDeleteReplay);
        const storedAfter = await db
          .prepare(
            'SELECT id,session_id,content_revision,request_json FROM owner_comment_processing_commands WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, command.requestId.toLowerCase())
          .first();
        assert.deepEqual(storedAfter, storedBefore);
        const currentOwner = await readOwnerItem(parent.commentId);
        assert.equal(currentOwner.state, 'deleted');
        assert.equal(currentOwner.body, null);
        assert.equal(currentOwner.processing.stale, true);
      } finally {
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(isolatedSessionId, owner)
          .run();
      }
    },
  );

  await check(
    'Owner processing and Owner reply request namespaces reject collisions in both insertion orders',
    async () => {
      const replyFirstParent = await createParent('reply-namespace-first');
      // Earlier acceptance intentionally fills this invite's 1,000-reply cap.
      // Reuse its actual guarded reply command as the first namespace witness;
      // never clear history or weaken capacity just to create another fixture.
      const existingReplyWitness = await db
        .prepare(
          'SELECT request_id FROM owner_comment_commands WHERE actor_id=? AND invite_id=? ORDER BY created_at_ms,id LIMIT 1',
        )
        .bind(owner, inviteId)
        .first();
      assert.ok(existingReplyWitness?.request_id);
      const replyFirstId = existingReplyWitness.request_id.toUpperCase();
      const beforeProcessingConflict = await processingTableSnapshot();
      await expectError(
        await postProcessing(
          processingCommand(replyFirstParent, {
            requestId: replyFirstId,
            state: 'resolved',
          }),
        ),
        409,
        'REQUEST_ID_CONFLICT',
      );
      assert.deepEqual(
        await processingTableSnapshot(),
        beforeProcessingConflict,
      );

      // Exercise the inverse guard below the unrelated reply cap. Keep the
      // deliberately full invitation untouched and use the existing live
      // browser invitation with its own actual Guest-authorized parent.
      const inverseParentResponse = await guestSend(guestCommandPath, {
        method: 'POST',
        secret: fixture.secretAuthor,
        body: {
          requestId: randomUUID(),
          expectedGuestId: fixture.authorGuestId,
          operation: 'create',
          targets: [{ photoId, versionId }],
          body: 'Processing inverse namespace parent ' + randomUUID(),
        },
      });
      const inverseParentBody = await readJson(inverseParentResponse);
      assert.equal(
        inverseParentResponse.status,
        200,
        JSON.stringify(inverseParentBody),
      );
      const processingFirstParent =
        guestCommentResultSchema.parse(inverseParentBody).items[0];
      const processingFirstId = randomUUID();
      await readProcessingResult(
        await postProcessing({
          ...processingCommand(processingFirstParent, {
            requestId: processingFirstId,
            state: 'resolved',
          }),
          inviteId: fixture.authorInviteId,
        }),
      );
      const replyWorkerBefore = await db
        .prepare('SELECT count(*) AS n FROM owner_comment_commands')
        .first();
      const replyConflict = await ownerReply(
        processingFirstParent,
        processingFirstId.toUpperCase(),
        'This reply must not reuse processing request ID',
        fixture.authorInviteId,
      );
      assert.equal(
        replyConflict.response.status,
        409,
        JSON.stringify(replyConflict.body),
      );
      assert.equal(
        replyConflict.body?.error?.code,
        'REQUEST_ID_CONFLICT',
        JSON.stringify(replyConflict.body),
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM owner_comment_commands')
            .first()
        ).n,
        replyWorkerBefore.n,
      );
    },
  );

  await check(
    'Processing audit rollback is atomic and recorded processing state remains append-only',
    async () => {
      const parent = await createParent('atomic-rollback');
      const command = processingCommand(parent, { state: 'open' });
      const before = await processingTableSnapshot();
      const triggerName =
        'owner_processing_test_fail_audit_' + randomUUID().replaceAll('-', '');
      await db.exec(
        'CREATE TRIGGER ' +
          triggerName +
          ' BEFORE INSERT ON audit_events WHEN NEW.actor_id=' +
          "'" +
          owner +
          "' AND NEW.request_id='" +
          command.requestId.toLowerCase() +
          "' AND NEW.action='owner.comment_processing_changed'" +
          " BEGIN SELECT RAISE(ABORT,'TEST_OWNER_COMMENT_PROCESSING_AUDIT'); END;",
      );
      try {
        await expectError(
          await postProcessing(command),
          503,
          'COMMENT_PROCESSING_UNAVAILABLE',
        );
        assert.deepEqual(await processingTableSnapshot(), before);
        const guest = await readGuestItem(parent.commentId);
        assert.equal(guest.body, parent.body);
        assert.equal(guest.revision, 1);
        expectInitialProcessing(guest.processing);
      } finally {
        await db.exec('DROP TRIGGER ' + triggerName);
      }

      const committed = await readProcessingResult(
        await postProcessing(command),
      );
      assert.equal(committed.requestId, command.requestId.toLowerCase());
      await assert.rejects(
        db
          .prepare(
            "UPDATE owner_comment_processing_state SET state='resolved' WHERE comment_id=?",
          )
          .bind(parent.commentId)
          .run(),
        /IMMUTABLE_OWNER_COMMENT_PROCESSING_SCOPE|INVALID_OWNER_COMMENT_PROCESSING_PREDECESSOR/u,
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM owner_comment_processing_state WHERE comment_id=?',
          )
          .bind(parent.commentId)
          .run(),
        /IMMUTABLE_OWNER_COMMENT_PROCESSING_STATE/u,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE owner_comment_processing_results SET result_json=result_json WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, command.requestId.toLowerCase())
          .run(),
        /IMMUTABLE_OWNER_COMMENT_PROCESSING_RESULT/u,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE owner_comment_processing_changes SET after_json=after_json WHERE request_id=?',
          )
          .bind(command.requestId.toLowerCase())
          .run(),
        /IMMUTABLE_OWNER_COMMENT_PROCESSING_CHANGE/u,
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM owner_comment_processing_results WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, command.requestId.toLowerCase())
          .run(),
        /IMMUTABLE_OWNER_COMMENT_PROCESSING_RESULT/u,
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM owner_comment_processing_commands WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, command.requestId.toLowerCase())
          .run(),
        /IMMUTABLE_OWNER_COMMENT_PROCESSING_COMMAND/u,
      );
    },
  );
}
