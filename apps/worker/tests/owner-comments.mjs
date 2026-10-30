import { makeSignature } from 'better-auth/crypto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  guestCommentResultSchema,
  guestCommentsPageSchema,
} from '../../../packages/contracts/src/guest-comments.ts';
import {
  ownerCommentResultSchema,
  ownerCommentThreadPageSchema,
  ownerCommentsCapabilitiesSchema,
} from '../../../packages/contracts/src/owner-comments.ts';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function ownerCommentChecks({
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

  const ownerWorker = await mf.getWorker('owner-comments-test');
  const guestWorker = await mf.getWorker(
    fixture.workerName ?? 'guest-comments-test',
  );
  const disabledWorker = await mf.getWorker('app');
  const ownerCookie = cookies.headers();
  const albumId = fixture.albumId;
  const photoId = fixture.photoId;
  const versionId = fixture.versionId;
  const inviteId = fixture.commentOnlyInviteId;
  const otherInviteId = fixture.otherInviteId;
  const guestId = fixture.commentOnlyGuestId;
  const guestSecret = fixture.commentOnlySecret;
  const ownerCommandPath =
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
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    if (options.commentId) url.searchParams.set('commentId', options.commentId);
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
    if (options.cursor) url.searchParams.set('cursor', options.cursor);
    if (options.commentId) url.searchParams.set('commentId', options.commentId);
    return url.pathname + url.search;
  };

  const ownerSend = (
    targetWorker,
    path,
    {
      method = 'GET',
      body,
      includeCookie = true,
      omitOrigin = false,
      origin,
      expectedActor,
      extraHeaders = {},
      cookie = ownerCookie,
    } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    if (includeCookie && cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') {
      if (!omitOrigin) headers.Origin = origin ?? new URL(base).origin;
      headers['Content-Type'] = 'application/json';
      if (expectedActor !== null)
        headers['X-Kino-Expected-Actor'] = expectedActor ?? owner;
    }
    Object.assign(headers, extraHeaders);
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return targetWorker.fetch(new Request(new URL(path, base), init));
  };

  const guestSend = (
    path,
    {
      method = 'GET',
      body,
      secret = guestSecret,
      includeCookie = true,
      omitOrigin = false,
      extraHeaders = {},
    } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    if (includeCookie && secret) {
      const name =
        new URL(base).protocol === 'https:'
          ? '__Host-kino_guest'
          : 'kino_guest';
      headers.Cookie = name + '=' + secret;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      if (!omitOrigin) headers.Origin = new URL(base).origin;
      headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, extraHeaders);
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
  const expectOwnerPage = async (targetInviteId, options = {}) => {
    const response = await ownerSend(
      options.targetWorker ?? ownerWorker,
      ownerThreadPath(targetInviteId, options),
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return ownerCommentThreadPageSchema.parse(body);
  };
  const expectGuestPage = async (options = {}) => {
    const response = await guestSend(guestThreadPath(options), {
      secret: options.secret ?? guestSecret,
    });
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    const page = guestCommentsPageSchema.parse(body);
    assert.equal(page.guestId, options.guestId ?? guestId);
    return page;
  };
  const postGuestCommand = async (body, options = {}) =>
    guestSend(guestCommandPath, {
      method: 'POST',
      body,
      ...(options.secret ? { secret: options.secret } : {}),
    });
  const postOwnerCommand = async (body, options = {}) =>
    ownerSend(ownerWorker, ownerCommandPath, {
      method: 'POST',
      body,
      ...options,
    });

  const ownerTableSnapshot = async () => {
    const snapshot = {};
    for (const table of [
      'owner_comment_commands',
      'owner_comment_replies',
      'owner_comment_changes',
      'owner_comment_results',
      'comment_thread_changes',
    ]) {
      const row = await db
        .prepare('SELECT count(*) AS n FROM ' + table)
        .first();
      snapshot[table] = row?.n ?? null;
    }
    const audit = await db
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND action LIKE 'comment.%'",
      )
      .bind(owner)
      .first();
    snapshot.ownerCommentAudit = audit?.n ?? null;
    return snapshot;
  };
  const guestTableSnapshot = async () => {
    const snapshot = {};
    for (const table of [
      'guest_comment_commands',
      'guest_comments',
      'guest_comment_changes',
      'guest_comment_results',
    ]) {
      const row = await db
        .prepare('SELECT count(*) AS n FROM ' + table)
        .first();
      snapshot[table] = row?.n ?? null;
    }
    return snapshot;
  };
  const count = async (table) =>
    (await db.prepare('SELECT count(*) AS n FROM ' + table).first()).n;
  const readCommandResult = async (response, expectedStatus = 200) => {
    const body = await readJson(response);
    assert.equal(response.status, expectedStatus, JSON.stringify(body));
    if (expectedStatus === 200) ownerCommentResultSchema.parse(body);
    return body;
  };
  const createParent = async (index) => {
    const requestId = randomUUID();
    const body = 'Owner API parent ' + String(index + 1) + ' ' + randomUUID();
    const response = await postGuestCommand({
      requestId,
      expectedGuestId: guestId,
      operation: 'create',
      targets: [{ photoId, versionId }],
      body,
    });
    const result = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(result));
    guestCommentResultSchema.parse(result);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].authorType, 'guest');
    assert.equal(result.items[0].parentCommentId, null);
    return result.items[0];
  };
  const replyCommand = (parent, requestId = randomUUID(), body) => ({
    requestId,
    operation: 'reply',
    inviteId,
    photoId,
    versionId,
    parentCommentId: parent.commentId,
    expectedParentRevision: parent.revision,
    body: body ?? 'Owner reply ' + randomUUID(),
  });
  const targetOwnerItem = (commentId) =>
    expectOwnerPage(inviteId, { commentId });
  const targetGuestItem = (commentId) => expectGuestPage({ commentId });

  let parents = [];
  let parent;
  let replyCreateCommand;
  let replyCreateResult;
  let replyEditCommand;
  let replyEditResult;
  let replyDeleteCommand;
  let replyDeleteResult;
  let replyId;
  let guestCursorBeforeOwnerReply;
  let ownerCursorBeforeGuestEdit;
  let currentParentRevision = 1;

  await check(
    'Owner comment capabilities are independently gated and require a live Owner session',
    async () => {
      const enabledResponse = await ownerSend(
        ownerWorker,
        '/api/v1/comments/capabilities',
      );
      const enabledBody = await readJson(enabledResponse);
      assert.equal(enabledResponse.status, 200, JSON.stringify(enabledBody));
      assert.deepEqual(ownerCommentsCapabilitiesSchema.parse(enabledBody), {
        enabled: true,
      });

      const disabledResponse = await ownerSend(
        disabledWorker,
        '/api/v1/comments/capabilities',
      );
      const disabledBody = await readJson(disabledResponse);
      assert.equal(disabledResponse.status, 200, JSON.stringify(disabledBody));
      assert.deepEqual(ownerCommentsCapabilitiesSchema.parse(disabledBody), {
        enabled: false,
      });

      await expectError(
        await ownerSend(ownerWorker, ownerThreadPath(inviteId), {
          includeCookie: false,
        }),
        401,
        'AUTH_REQUIRED',
      );

      await expectError(
        await ownerSend(disabledWorker, ownerThreadPath(inviteId)),
        503,
        'OWNER_COMMENTS_DISABLED',
      );
      await expectError(
        await ownerSend(disabledWorker, ownerCommandPath, {
          method: 'POST',
          body: {
            requestId: randomUUID(),
            operation: 'reply',
            inviteId,
            photoId,
            versionId,
            parentCommentId: randomUUID(),
            expectedParentRevision: 1,
            body: 'Disabled feature must not write',
          },
        }),
        503,
        'OWNER_COMMENTS_DISABLED',
      );
    },
  );

  await check(
    'Guest comment fixtures create real invitation-scoped parents and pagination cursors',
    async () => {
      for (let index = 0; index < 25; index += 1)
        parents.push(await createParent(index));
      parent = parents[0];
      assert.ok(parent?.commentId);
      assert.equal(parent.revision, 1);

      const guestPage = await expectGuestPage();
      const ownerPage = await expectOwnerPage(inviteId);
      assert.equal(guestPage.items.length, 24);
      assert.equal(ownerPage.items.length, 24);
      assert.ok(guestPage.nextCursor);
      assert.ok(ownerPage.nextCursor);
      guestCursorBeforeOwnerReply = guestPage.nextCursor;
      ownerCursorBeforeGuestEdit = ownerPage.nextCursor;
    },
  );

  await check(
    'Owner thread reads preserve the invitation and version scope without writing',
    async () => {
      const before = await ownerTableSnapshot();
      const page = await expectOwnerPage(inviteId);
      const targeted = await targetOwnerItem(parent.commentId);
      const after = await ownerTableSnapshot();
      assert.deepEqual(after, before);
      assert.equal(page.inviteId, inviteId);
      assert.equal(page.photoId, photoId);
      assert.equal(page.versionId, versionId);
      assert.equal(page.items.length, 24);
      assert.ok(page.nextCursor);
      assert.equal(targeted.inviteId, inviteId);
      assert.equal(targeted.items.length, 1);
      assert.equal(targeted.nextCursor, null);
      assert.deepEqual(
        {
          authorType: targeted.items[0].authorType,
          parentCommentId: targeted.items[0].parentCommentId,
          canEdit: targeted.items[0].canEdit,
          body: targeted.items[0].body,
          state: targeted.items[0].state,
        },
        {
          authorType: 'guest',
          parentCommentId: null,
          canEdit: false,
          body: parent.body,
          state: 'open',
        },
      );

      const otherInvitePage = await expectOwnerPage(otherInviteId);
      assert.equal(otherInvitePage.inviteId, otherInviteId);
      assert.equal(otherInvitePage.items.length, 0);
      assert.equal(otherInvitePage.nextCursor, null);
    },
  );

  await check(
    'Owner replies reject missing Origin, changed actor and injected client identity fields',
    async () => {
      const command = replyCommand(parent);
      const before = await ownerTableSnapshot();

      await expectError(
        await postOwnerCommand(command, { omitOrigin: true }),
        403,
        'FORBIDDEN_ORIGIN',
      );
      await expectError(
        await postOwnerCommand(command, { expectedActor: randomUUID() }),
        403,
        'OWNER_COMMENTS_OWNER_CHANGED',
      );
      await expectError(
        await postOwnerCommand({ ...command, actorId: owner }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await postOwnerCommand({ ...command, sessionId: randomUUID() }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await postOwnerCommand({ ...command, expectedGuestId: guestId }),
        400,
        'INVALID_INPUT',
      );
      assert.deepEqual(await ownerTableSnapshot(), before);
    },
  );

  await check(
    'Owner reply creation is exact-replay safe and invalidates a Guest thread cursor',
    async () => {
      const rawBody = '  Owner reply e\u0301\r\nsecond line  ';
      replyCreateCommand = replyCommand(parent, randomUUID(), rawBody);
      const created = await readCommandResult(
        await postOwnerCommand(replyCreateCommand),
      );
      replyCreateResult = created;
      replyId = created.item.commentId;
      assert.equal(created.operation, 'reply');
      assert.equal(created.item.authorType, 'owner');
      assert.equal(created.item.parentCommentId, parent.commentId);
      assert.equal(created.item.photoId, photoId);
      assert.equal(created.item.versionId, versionId);
      assert.equal(created.item.body, 'Owner reply é\nsecond line');
      assert.equal(created.item.state, 'open');
      assert.equal(created.item.revision, 1);
      assert.equal(created.item.canEdit, true);

      const afterCreate = await ownerTableSnapshot();
      const replay = await readCommandResult(
        await postOwnerCommand(replyCreateCommand),
      );
      assert.deepEqual(replay, created);
      const alternateCase = await readCommandResult(
        await postOwnerCommand({
          ...replyCreateCommand,
          requestId: replyCreateCommand.requestId.toUpperCase(),
        }),
      );
      assert.deepEqual(alternateCase, created);
      assert.deepEqual(await ownerTableSnapshot(), afterCreate);

      await expectError(
        await guestSend(
          guestThreadPath({ cursor: guestCursorBeforeOwnerReply }),
        ),
        409,
        'COMMENT_HISTORY_CHANGED',
      );
    },
  );

  await check(
    'Owner replies are visible to Guests only under the selected invitation',
    async () => {
      const ownerPage = await targetOwnerItem(replyId);
      assert.equal(ownerPage.items.length, 1);
      assert.deepEqual(
        {
          authorType: ownerPage.items[0].authorType,
          parentCommentId: ownerPage.items[0].parentCommentId,
          canEdit: ownerPage.items[0].canEdit,
          body: ownerPage.items[0].body,
          state: ownerPage.items[0].state,
        },
        {
          authorType: 'owner',
          parentCommentId: parent.commentId,
          canEdit: true,
          body: replyCreateResult.item.body,
          state: 'open',
        },
      );

      const guestPage = await targetGuestItem(replyId);
      assert.equal(guestPage.items.length, 1);
      assert.equal(guestPage.items[0].authorType, 'owner');
      assert.equal(guestPage.items[0].parentCommentId, parent.commentId);
      assert.equal(guestPage.items[0].isMine, false);
      assert.equal(guestPage.items[0].body, replyCreateResult.item.body);

      const isolated = await expectGuestPage({
        secret: fixture.secretOtherInvite,
        guestId: fixture.otherGuestId,
      });
      assert.equal(
        isolated.items.some(
          (item) =>
            item.commentId === parent.commentId || item.commentId === replyId,
        ),
        false,
      );
      assert.equal(
        JSON.stringify(isolated).includes(replyCreateResult.item.body),
        false,
      );
    },
  );

  await check(
    'Guest command endpoints cannot edit an Owner reply',
    async () => {
      const ownerBefore = await ownerTableSnapshot();
      const guestBefore = await guestTableSnapshot();
      await expectError(
        await postGuestCommand({
          requestId: randomUUID(),
          expectedGuestId: guestId,
          operation: 'edit',
          commentId: replyId,
          expectedRevision: 1,
          body: 'Guest must not edit Owner content',
        }),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
      assert.deepEqual(await ownerTableSnapshot(), ownerBefore);
      assert.deepEqual(await guestTableSnapshot(), guestBefore);
      const after = await targetOwnerItem(replyId);
      assert.equal(after.items[0].body, replyCreateResult.item.body);
      assert.equal(after.items[0].revision, 1);
    },
  );

  await check(
    'Owner reply edits use revision CAS and recover exact receipts',
    async () => {
      replyEditCommand = {
        requestId: randomUUID(),
        operation: 'edit_reply',
        replyId,
        expectedRevision: 1,
        body: 'Edited Owner reply ' + randomUUID(),
      };
      replyEditResult = await readCommandResult(
        await postOwnerCommand(replyEditCommand),
      );
      assert.equal(replyEditResult.operation, 'edit_reply');
      assert.equal(replyEditResult.item.commentId, replyId);
      assert.equal(replyEditResult.item.revision, 2);
      assert.equal(replyEditResult.item.body, replyEditCommand.body);
      assert.equal(replyEditResult.item.state, 'open');
      assert.equal(replyEditResult.item.canEdit, true);

      const afterEdit = await ownerTableSnapshot();
      const replay = await readCommandResult(
        await postOwnerCommand(replyEditCommand),
      );
      assert.deepEqual(replay, replyEditResult);
      assert.deepEqual(await ownerTableSnapshot(), afterEdit);

      await expectError(
        await postOwnerCommand({
          ...replyEditCommand,
          requestId: randomUUID(),
          expectedRevision: 1,
          body: 'Stale Owner reply edit',
        }),
        409,
        'COMMENT_REVISION_CONFLICT',
      );
      assert.deepEqual(await ownerTableSnapshot(), afterEdit);
    },
  );

  await check(
    'Guest parent edits invalidate Owner cursors while historical Owner receipts remain exact',
    async () => {
      const pageBeforeEdit = await expectOwnerPage(inviteId);
      assert.ok(pageBeforeEdit.nextCursor);
      ownerCursorBeforeGuestEdit = pageBeforeEdit.nextCursor;

      const parentEdit = await readJson(
        await postGuestCommand({
          requestId: randomUUID(),
          expectedGuestId: guestId,
          operation: 'edit',
          commentId: parent.commentId,
          expectedRevision: 1,
          body: 'Guest parent edited after Owner reply',
        }),
      );
      assert.equal(parentEdit.operation, 'edit');
      guestCommentResultSchema.parse(parentEdit);
      assert.equal(parentEdit.items[0].revision, 2);
      currentParentRevision = 2;

      await expectError(
        await ownerSend(
          ownerWorker,
          ownerThreadPath(inviteId, { cursor: ownerCursorBeforeGuestEdit }),
        ),
        409,
        'COMMENT_HISTORY_CHANGED',
      );

      const createReplay = await readCommandResult(
        await postOwnerCommand(replyCreateCommand),
      );
      const editReplay = await readCommandResult(
        await postOwnerCommand(replyEditCommand),
      );
      assert.deepEqual(createReplay, replyCreateResult);
      assert.deepEqual(editReplay, replyEditResult);

      const staleParentReply = await postOwnerCommand(
        replyCommand(
          { ...parent, revision: 1 },
          randomUUID(),
          'Stale parent reply must not be accepted',
        ),
      );
      await expectError(staleParentReply, 409, 'COMMENT_REVISION_CONFLICT');

      const currentParent = await targetOwnerItem(parent.commentId);
      const currentReply = await targetOwnerItem(replyId);
      assert.equal(currentParent.items[0].revision, currentParentRevision);
      assert.equal(
        currentParent.items[0].body,
        'Guest parent edited after Owner reply',
      );
      assert.equal(currentReply.items[0].revision, 2);
      assert.equal(currentReply.items[0].body, replyEditResult.item.body);
    },
  );

  await check(
    'Owner reply and legacy Owner request namespaces reject case-variant collisions in both insertion orders',
    async () => {
      const albumScope = await db
        .prepare('SELECT workspace_id FROM albums WHERE id=?')
        .bind(albumId)
        .first();
      assert.ok(albumScope?.workspace_id);
      const legacyRequestId = randomUUID().toUpperCase();
      const legacyResponse = await request('/api/v1/projects', {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: albumScope.workspace_id,
          name: 'Owner comment namespace fixture ' + randomUUID(),
          requestId: legacyRequestId,
        }),
      });
      const legacyBody = await readJson(legacyResponse);
      assert.equal(legacyResponse.status, 201, JSON.stringify(legacyBody));

      const beforeFirstOrder = await ownerTableSnapshot();
      await expectError(
        await postOwnerCommand(
          replyCommand(
            { ...parent, revision: currentParentRevision },
            legacyRequestId,
            'Owner namespace collision',
          ),
        ),
        409,
        'REQUEST_ID_CONFLICT',
      );
      assert.deepEqual(await ownerTableSnapshot(), beforeFirstOrder);

      const ownerRequestId = randomUUID();
      const ownerReply = await readCommandResult(
        await postOwnerCommand(
          replyCommand(
            { ...parent, revision: currentParentRevision },
            ownerRequestId,
            'Owner namespace first ' + randomUUID(),
          ),
        ),
      );
      assert.equal(ownerReply.operation, 'reply');

      const legacyCountBeforeConflict = await count('request_commands');
      const reverseConflict = await request('/api/v1/projects', {
        method: 'POST',
        headers: {
          Cookie: ownerCookie,
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceId: albumScope.workspace_id,
          name: 'Must not be created',
          requestId: ownerRequestId.toUpperCase(),
        }),
      });
      await expectError(reverseConflict, 409, 'REQUEST_ID_CONFLICT');
      assert.equal(await count('request_commands'), legacyCountBeforeConflict);

      const beforeForeignParent = await ownerTableSnapshot();
      await expectError(
        await postOwnerCommand({
          requestId: randomUUID(),
          operation: 'reply',
          inviteId: otherInviteId,
          photoId,
          versionId,
          parentCommentId: parent.commentId,
          expectedParentRevision: currentParentRevision,
          body: 'A different invitation cannot adopt this parent',
        }),
        404,
        'NOT_FOUND',
      );
      assert.deepEqual(await ownerTableSnapshot(), beforeForeignParent);
    },
  );

  await check(
    'Exact Owner replay under a fresh session preserves original provenance and does not pin the old session',
    async () => {
      const scope = await db
        .prepare(
          'SELECT workspace_id,project_id FROM guest_invites WHERE id=? AND created_by=?',
        )
        .bind(inviteId, owner)
        .first();
      assert.ok(scope?.workspace_id && scope?.project_id);

      const requestId = randomUUID();
      const replayCommand = replyCommand(
        { ...parent, revision: currentParentRevision },
        requestId,
        'Synthetic fresh-session replay ' + randomUUID(),
      );
      const requestJson = JSON.stringify(replayCommand);
      const originalSessionId = randomUUID();
      const freshSessionId = randomUUID();
      const now = Date.now();
      const insertSession = (sessionId, token) =>
        db
          .prepare(
            'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
          )
          .bind(sessionId, token, owner, now + 600000, now, now)
          .run();
      await insertSession(
        originalSessionId,
        'owner-comments-old:' + originalSessionId,
      );
      await insertSession(
        freshSessionId,
        'owner-comments-fresh:' + freshSessionId,
      );

      const insertCommand = (sessionId, replyIdForInsert) =>
        db
          .prepare(
            'INSERT INTO owner_comment_commands(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,invite_id,photo_id,version_id,parent_comment_id,reply_id,operation,request_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            owner,
            sessionId,
            requestId,
            scope.workspace_id,
            scope.project_id,
            albumId,
            inviteId,
            photoId,
            versionId,
            parent.commentId,
            replyIdForInsert,
            'reply',
            requestJson,
            Date.now(),
          )
          .run();

      try {
        await insertCommand(originalSessionId, randomUUID());
        const stored = await db
          .prepare(
            'SELECT id,session_id,reply_id,request_json FROM owner_comment_commands WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, requestId)
          .first();
        assert.ok(stored?.id && stored?.reply_id);
        assert.equal(stored.session_id, originalSessionId);
        assert.equal(stored.request_json, requestJson);

        const resultBefore = await db
          .prepare(
            'SELECT result_json FROM owner_comment_results WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, requestId)
          .first();
        assert.ok(resultBefore?.result_json);
        const parsedResult = ownerCommentResultSchema.parse(
          JSON.parse(resultBefore.result_json),
        );
        assert.equal(parsedResult.requestId, requestId);
        assert.equal(parsedResult.item.commentId, stored.reply_id);

        const commandCountBeforeReplay = await count('owner_comment_commands');
        await insertCommand(freshSessionId, stored.reply_id);
        assert.equal(
          await count('owner_comment_commands'),
          commandCountBeforeReplay,
        );
        const afterReplay = await db
          .prepare(
            'SELECT id,session_id,reply_id,request_json FROM owner_comment_commands WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, requestId)
          .first();
        assert.deepEqual(afterReplay, stored);
        assert.deepEqual(
          await db
            .prepare(
              'SELECT result_json FROM owner_comment_results WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, requestId)
            .first(),
          resultBefore,
        );

        const originalAudit = await db
          .prepare(
            "SELECT session_id FROM audit_events WHERE actor_type='user' AND actor_id=? AND request_id=?",
          )
          .bind(owner, requestId)
          .first();
        assert.equal(originalAudit?.session_id, originalSessionId);
        const originalChange = await db
          .prepare(
            'SELECT session_id FROM owner_comment_changes WHERE command_id=?',
          )
          .bind(stored.id)
          .first();
        assert.equal(originalChange?.session_id, originalSessionId);

        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(originalSessionId, owner)
          .run();
        assert.equal(
          await db
            .prepare('SELECT id FROM owner_sessions WHERE id=?')
            .bind(originalSessionId)
            .first(),
          null,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT session_id FROM owner_comment_commands WHERE id=?',
              )
              .bind(stored.id)
              .first()
          ).session_id,
          originalSessionId,
        );
        assert.equal(
          (
            await db
              .prepare(
                "SELECT session_id FROM audit_events WHERE actor_type='user' AND actor_id=? AND request_id=?",
              )
              .bind(owner, requestId)
              .first()
          ).session_id,
          originalSessionId,
        );
      } finally {
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(originalSessionId, owner)
          .run();
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(freshSessionId, owner)
          .run();
      }
    },
  );

  await check(
    'D1 audit failure rolls back Owner reply state, witness and result before retry',
    async () => {
      const requestId = randomUUID();
      const command = replyCommand(
        { ...parent, revision: currentParentRevision },
        requestId,
        'Audit rollback reply ' + randomUUID(),
      );
      const beforeOwner = await ownerTableSnapshot();
      const beforeGuest = await guestTableSnapshot();
      const triggerName =
        'owner_comment_test_fail_audit_' + randomUUID().replaceAll('-', '');
      await db.exec(
        'CREATE TRIGGER ' +
          triggerName +
          ' BEFORE INSERT ON audit_events WHEN NEW.actor_id=' +
          "'" +
          owner +
          "'" +
          ' AND NEW.request_id=' +
          "'" +
          requestId +
          "'" +
          " BEGIN SELECT RAISE(ABORT,'TEST_OWNER_COMMENT_AUDIT'); END;",
      );
      try {
        await expectError(
          await postOwnerCommand(command),
          503,
          'OWNER_COMMENTS_UNAVAILABLE',
        );
        assert.deepEqual(await ownerTableSnapshot(), beforeOwner);
        assert.deepEqual(await guestTableSnapshot(), beforeGuest);
      } finally {
        await db.exec('DROP TRIGGER ' + triggerName);
      }

      const recovered = await readCommandResult(
        await postOwnerCommand(command),
      );
      assert.equal(recovered.requestId, requestId);
      assert.equal(recovered.item.parentCommentId, parent.commentId);
      assert.equal(recovered.item.body, command.body);
    },
  );

  await check(
    'Deleting replies creates immutable tombstones and exact replay survives parent deletion',
    async () => {
      replyDeleteCommand = {
        requestId: randomUUID(),
        operation: 'delete_reply',
        replyId,
        expectedRevision: 2,
      };
      replyDeleteResult = await readCommandResult(
        await postOwnerCommand(replyDeleteCommand),
      );
      assert.equal(replyDeleteResult.operation, 'delete_reply');
      assert.equal(replyDeleteResult.item.revision, 3);
      assert.equal(replyDeleteResult.item.state, 'deleted');
      assert.equal(replyDeleteResult.item.body, null);

      const deleteReplay = await readCommandResult(
        await postOwnerCommand(replyDeleteCommand),
      );
      assert.deepEqual(deleteReplay, replyDeleteResult);

      const parentDelete = await readJson(
        await postGuestCommand({
          requestId: randomUUID(),
          expectedGuestId: guestId,
          operation: 'delete',
          commentId: parent.commentId,
          expectedRevision: currentParentRevision,
        }),
      );
      assert.equal(parentDelete.operation, 'delete');
      guestCommentResultSchema.parse(parentDelete);
      assert.equal(parentDelete.items[0].state, 'deleted');
      assert.equal(parentDelete.items[0].body, null);

      assert.deepEqual(
        await readCommandResult(await postOwnerCommand(replyCreateCommand)),
        replyCreateResult,
      );
      assert.deepEqual(
        await readCommandResult(await postOwnerCommand(replyEditCommand)),
        replyEditResult,
      );
      assert.deepEqual(
        await readCommandResult(await postOwnerCommand(replyDeleteCommand)),
        replyDeleteResult,
      );

      const ownerCurrentReply = await targetOwnerItem(replyId);
      assert.equal(ownerCurrentReply.items.length, 1);
      assert.equal(ownerCurrentReply.items[0].state, 'deleted');
      assert.equal(ownerCurrentReply.items[0].body, null);
      assert.equal(ownerCurrentReply.items[0].revision, 3);
      const guestCurrentReply = await targetGuestItem(replyId);
      assert.equal(guestCurrentReply.items.length, 1);
      assert.equal(guestCurrentReply.items[0].authorType, 'owner');
      assert.equal(guestCurrentReply.items[0].state, 'deleted');
      assert.equal(guestCurrentReply.items[0].body, null);
      assert.equal(
        guestCurrentReply.items[0].parentCommentId,
        parent.commentId,
      );
    },
  );

  await check(
    'A disabled Owner and an expired Owner session cannot read or replay old replies',
    async () => {
      const authResponse = await request('/api/auth/get-session', {
        headers: { Cookie: ownerCookie },
      });
      const authBody = await readJson(authResponse);
      assert.equal(authResponse.status, 200, JSON.stringify(authBody));
      assert.equal(authBody?.user?.id, owner);
      const ownerSessionId = authBody?.session?.id;
      assert.ok(ownerSessionId);
      const before = await ownerTableSnapshot();
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectError(
          await ownerSend(ownerWorker, ownerThreadPath(inviteId)),
          403,
          'OWNER_REQUIRED',
        );
        await expectError(
          await postOwnerCommand(replyCreateCommand),
          403,
          'OWNER_REQUIRED',
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      assert.deepEqual(await ownerTableSnapshot(), before);

      assert.equal(typeof authSecret, 'string');
      assert.ok(
        authSecret.startsWith('synthetic-'),
        'test-only signing key required',
      );
      const isolatedSessionId = randomUUID();
      const token = 'owner-comments-expiry:' + randomUUID();
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
      assert.ok(
        cookiePart,
        'actual OAuth cookie supplies the configured session cookie name',
      );
      const cookieName = cookiePart.slice(0, cookiePart.indexOf('='));
      const isolatedCookie =
        cookieName +
        '=' +
        encodeURIComponent(
          token + '.' + (await makeSignature(token, authSecret)),
        );
      try {
        const validIsolated = await ownerSend(ownerWorker, '/api/v1/me', {
          cookie: isolatedCookie,
        });
        assert.equal(validIsolated.status, 200);
        assert.equal(
          (await readJson(validIsolated)).sessionId,
          isolatedSessionId,
        );
        await db
          .prepare(
            'UPDATE owner_sessions SET expiresAt=0 WHERE id=? AND userId=?',
          )
          .bind(isolatedSessionId, owner)
          .run();
        await expectError(
          await ownerSend(ownerWorker, ownerThreadPath(inviteId), {
            cookie: isolatedCookie,
          }),
          401,
          'AUTH_REQUIRED',
        );
        await expectError(
          await postOwnerCommand(replyCreateCommand, {
            cookie: isolatedCookie,
          }),
          401,
          'AUTH_REQUIRED',
        );
      } finally {
        // Expired-session pruning is allowed; never resurrect an audited session ID.
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(isolatedSessionId, owner)
          .run();
      }
      const mainOwner = await ownerSend(ownerWorker, '/api/v1/me');
      assert.equal(mainOwner.status, 200);
      assert.equal((await readJson(mainOwner)).sessionId, ownerSessionId);
      assert.deepEqual(await ownerTableSnapshot(), before);
    },
  );

  await check(
    'Shared thread markers reject forged inserts, ID replacement and deletion',
    async () => {
      const change = await db
        .prepare(
          "SELECT event_id FROM owner_comment_changes WHERE reply_id=? AND operation='reply' ORDER BY seq LIMIT 1",
        )
        .bind(replyId)
        .first();
      assert.ok(change?.event_id);
      const marker = await db
        .prepare(
          'SELECT * FROM comment_thread_changes WHERE source_kind=? AND source_event_id=?',
        )
        .bind('owner', change.event_id)
        .first();
      assert.ok(marker);
      const before = await count('comment_thread_changes');

      await assert.rejects(
        db
          .prepare(
            'INSERT INTO comment_thread_changes(source_kind,source_event_id,invite_id,workspace_id,project_id,album_id,photo_id,version_id,occurred_at_ms) VALUES(?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            'owner',
            'forged:' + randomUUID(),
            marker.invite_id,
            marker.workspace_id,
            marker.project_id,
            marker.album_id,
            marker.photo_id,
            marker.version_id,
            marker.occurred_at_ms,
          )
          .run(),
      );
      assert.equal(await count('comment_thread_changes'), before);

      await assert.rejects(
        db
          .prepare(
            'UPDATE comment_thread_changes SET seq=seq+1000000 WHERE seq=?',
          )
          .bind(marker.seq)
          .run(),
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE comment_thread_changes SET source_event_id=? WHERE seq=?',
          )
          .bind('replaced:' + randomUUID(), marker.seq)
          .run(),
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM comment_thread_changes WHERE seq=?')
          .bind(marker.seq)
          .run(),
      );
      const after = await db
        .prepare(
          'SELECT * FROM comment_thread_changes WHERE source_kind=? AND source_event_id=?',
        )
        .bind('owner', change.event_id)
        .first();
      assert.deepEqual(after, marker);
      assert.equal(await count('comment_thread_changes'), before);
    },
  );

  await check(
    'Owner reply lifetime cap counts tombstones, rejects the 1001st reply, and preserves reads and exact replay',
    async () => {
      const capParent = await createParent(26);
      assert.equal(capParent.state, 'open');
      assert.equal(capParent.revision, 1);

      const currentOwner = await ownerSend(ownerWorker, '/api/v1/me');
      const currentOwnerBody = await readJson(currentOwner);
      assert.equal(currentOwner.status, 200, JSON.stringify(currentOwnerBody));
      assert.equal(currentOwnerBody?.actor?.id, owner);
      const sessionId = currentOwnerBody?.sessionId;
      assert.ok(sessionId);
      assert.ok(
        await db
          .prepare(
            'SELECT id FROM owner_sessions WHERE id=? AND userId=? AND expiresAt>? LIMIT 1',
          )
          .bind(sessionId, owner, Date.now())
          .first(),
      );

      const scope = await db
        .prepare(
          'SELECT i.workspace_id,i.project_id,ia.album_id FROM guest_invites i JOIN guest_invite_albums ia ON ia.invite_id=i.id AND ia.workspace_id=i.workspace_id AND ia.project_id=i.project_id WHERE i.id=? AND i.created_by=? AND ia.album_id=?',
        )
        .bind(inviteId, owner, albumId)
        .first();
      assert.ok(scope?.workspace_id && scope?.project_id && scope?.album_id);

      const scopedReplyCount = async () =>
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM owner_comment_replies WHERE invite_id=? AND photo_id=? AND version_id=?',
            )
            .bind(inviteId, photoId, versionId)
            .first()
        ).n;
      const scopedOwnerChangeCount = async () =>
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM owner_comment_changes WHERE invite_id=? AND photo_id=? AND version_id=?',
            )
            .bind(inviteId, photoId, versionId)
            .first()
        ).n;
      const scopedOwnerMarkerCount = async () =>
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM comment_thread_changes WHERE source_kind='owner' AND invite_id=? AND photo_id=? AND version_id=?",
            )
            .bind(inviteId, photoId, versionId)
            .first()
        ).n;
      const scopedReplyAuditCount = async () =>
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE actor_type='user' AND actor_id=? AND action='owner.comment_reply_created' AND photo_id=? AND version_id=?",
            )
            .bind(owner, photoId, versionId)
            .first()
        ).n;

      const existingCount = await scopedReplyCount();
      assert.ok(existingCount < 1000, 'fixture has room to reach the cap');
      const fillCount = 1000 - existingCount;
      const ownerCommandCountBefore = await count('owner_comment_commands');
      const ownerChangeCountBefore = await scopedOwnerChangeCount();
      const ownerMarkerCountBefore = await scopedOwnerMarkerCount();
      const replyAuditCountBefore = await scopedReplyAuditCount();
      const insertSql =
        'INSERT INTO owner_comment_commands(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,invite_id,photo_id,version_id,parent_comment_id,reply_id,operation,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)';

      for (let start = 0; start < fillCount; start += 40) {
        const chunkSize = Math.min(40, fillCount - start);
        const statements = Array.from({ length: chunkSize }, () => {
          const requestId = randomUUID();
          const replyId = randomUUID();
          const body = 'Owner reply capacity ' + requestId;
          const command = {
            requestId,
            operation: 'reply',
            inviteId,
            photoId,
            versionId,
            parentCommentId: capParent.commentId,
            expectedParentRevision: capParent.revision,
            body,
          };
          return db
            .prepare(insertSql)
            .bind(
              randomUUID(),
              owner,
              sessionId,
              requestId,
              scope.workspace_id,
              scope.project_id,
              scope.album_id,
              inviteId,
              photoId,
              versionId,
              capParent.commentId,
              replyId,
              'reply',
              JSON.stringify(command),
            );
        });
        const results = await db.batch(statements);
        assert.equal(results.length, chunkSize);
      }

      assert.equal(await scopedReplyCount(), 1000);
      assert.ok(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM owner_comment_replies WHERE invite_id=? AND photo_id=? AND version_id=? AND state='deleted'",
            )
            .bind(inviteId, photoId, versionId)
            .first()
        ).n >= 1,
        'previously deleted replies remain part of the lifetime count',
      );
      assert.equal(
        await count('owner_comment_commands'),
        ownerCommandCountBefore + fillCount,
      );
      assert.equal(
        await scopedOwnerChangeCount(),
        ownerChangeCountBefore + fillCount,
      );
      assert.equal(
        await scopedOwnerMarkerCount(),
        ownerMarkerCountBefore + fillCount,
      );
      assert.equal(
        await scopedReplyAuditCount(),
        replyAuditCountBefore + fillCount,
      );

      const beforeDeniedReply = await ownerTableSnapshot();
      await expectError(
        await postOwnerCommand(
          replyCommand(
            capParent,
            randomUUID(),
            'The 1001st Owner reply must be denied',
          ),
        ),
        409,
        'COMMENT_LIMIT_REACHED',
      );
      assert.deepEqual(await ownerTableSnapshot(), beforeDeniedReply);
      assert.equal(await scopedReplyCount(), 1000);

      const ownerPageAtCap = await expectOwnerPage(inviteId);
      const guestPageAtCap = await expectGuestPage();
      assert.equal(ownerPageAtCap.items.length, 24);
      assert.ok(ownerPageAtCap.nextCursor);
      assert.equal(guestPageAtCap.items.length, 24);
      assert.ok(guestPageAtCap.nextCursor);

      const beforeReplay = await ownerTableSnapshot();
      const historicalReplay = await readCommandResult(
        await postOwnerCommand(replyCreateCommand),
      );
      assert.deepEqual(historicalReplay, replyCreateResult);
      assert.deepEqual(await ownerTableSnapshot(), beforeReplay);

      const editableReply = await db
        .prepare(
          "SELECT id,revision FROM owner_comment_replies WHERE invite_id=? AND photo_id=? AND version_id=? AND parent_comment_id=? AND state='open' ORDER BY created_at_ms,id LIMIT 1",
        )
        .bind(inviteId, photoId, versionId, capParent.commentId)
        .first();
      assert.ok(editableReply?.id);
      const atCapEdit = await readCommandResult(
        await postOwnerCommand({
          requestId: randomUUID(),
          operation: 'edit_reply',
          replyId: editableReply.id,
          expectedRevision: editableReply.revision,
          body: 'Editing a reply remains available at the lifetime cap',
        }),
      );
      assert.equal(atCapEdit.operation, 'edit_reply');
      assert.equal(atCapEdit.item.revision, editableReply.revision + 1);
      assert.equal(await scopedReplyCount(), 1000);
    },
  );
}
