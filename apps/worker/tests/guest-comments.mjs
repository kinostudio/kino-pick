import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  guestCommentResultSchema,
  guestCommentsPageSchema,
} from '../../../packages/contracts/src/guest-comments.ts';

const canView = 1;
const canCompareVersions = 2048;
const canSelect = 8;
const canRate = 16;
const canFavorite = 32;
const canTag = 64;
const canComment = 256;
const canSubmit = 512;
const canViewOwnHistory = 1024;
const fullNamespaceRights =
  canView |
  canSelect |
  canRate |
  canFavorite |
  canTag |
  canComment |
  canSubmit |
  canViewOwnHistory;

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

export async function guestCommentChecks({
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
  assert.ok(
    versionFixture?.latestVersionId && versionFixture?.unpublishedVersionId,
  );

  const worker = await mf.getWorker('guest-comments-test');
  const disabledWorker = await mf.getWorker('app');
  const albumId = versionFixture.albumId;
  const photoId = versionFixture.photoId;
  const versionId = versionFixture.latestVersionId;
  const neighborPhotoId = versionFixture.neighborPhotoId;
  const neighborFilename = versionFixture.neighborFilename;
  const neighborVersion = await db
    .prepare(
      'SELECT id FROM photo_versions WHERE photo_id=? AND workspace_id=? AND version_no=1',
    )
    .bind(neighborPhotoId, versionFixture.workspaceId)
    .first();
  assert.ok(neighborVersion?.id, 'neighbor photo has its actual ready V1');
  const neighborVersionId = neighborVersion.id;
  assert.equal(
    typeof versionFixture.createReadyPhoto,
    'function',
    'version fixture exposes the real Owner upload plus R2/Sharp ready-photo helper',
  );
  const extraReadyPhotos = [];
  for (let index = 0; index < 22; index += 1) {
    extraReadyPhotos.push(
      await versionFixture.createReadyPhoto({
        filename:
          'guest-comments-batch-' + String(index + 1).padStart(2, '0') + '.png',
        seed: 100 + index,
      }),
    );
  }
  const batchTargets = [
    { photoId, versionId },
    { photoId: neighborPhotoId, versionId: neighborVersionId },
    ...extraReadyPhotos.map((photo) => ({
      photoId: photo.photoId,
      versionId: photo.versionId,
    })),
  ];
  assert.equal(batchTargets.length, 24);
  assert.equal(new Set(batchTargets.map((target) => target.photoId)).size, 24);
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? ORDER BY expiresAt DESC,id DESC LIMIT 1',
    )
    .bind(owner, Date.now())
    .first();
  assert.ok(ownerSession?.id);

  const capabilitiesPath = '/api/guest/comments/capabilities';
  const commandPath = '/api/guest/albums/' + albumId + '/comments/commands';
  const commentsPath = (targetPhotoId, targetVersionId, cursor) => {
    const basePath =
      '/api/guest/albums/' +
      albumId +
      '/photos/' +
      targetPhotoId +
      '/versions/' +
      targetVersionId +
      '/comments';
    return cursor
      ? basePath + '?cursor=' + encodeURIComponent(cursor)
      : basePath;
  };

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
      if (!omitOrigin && !headers.Origin) headers.Origin = new URL(base).origin;
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
    if (expectedStatus !== undefined) {
      assert.equal(
        response.status,
        expectedStatus,
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    }
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
    expectError(response, 409, 'COMMENT_REVISION_CONFLICT');
  const expectHistoryChanged = (response) =>
    expectError(response, 409, 'COMMENT_HISTORY_CHANGED');

  const createInvite = async ({
    mask,
    expiresAtMs = Date.now() + 60 * 60 * 1000,
  }) => {
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

  const createSession = async (invite, guest, { expiresAtMs } = {}) => {
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const sessionExpiry =
      expiresAtMs ?? Math.min(invite.expiresAtMs, Date.now() + 30 * 60 * 1000);
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(
        sessionId,
        invite.id,
        guest.guestId,
        hashGuestSession(secret),
        sessionExpiry,
      )
      .run();
    return {
      inviteId: invite.id,
      guestId: guest.guestId,
      sessionId,
      secret,
      mask: invite.mask,
    };
  };

  const createGuest = async (invite, displayName, options = {}) => {
    const guestId = randomUUID();
    await db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(guestId, invite.id, displayName)
      .run();
    return createSession(invite, { guestId }, options);
  };

  const createInviteWithGuests = async (
    mask,
    names,
    expiresAtMs = Date.now() + 60 * 60 * 1000,
  ) => {
    const invite = await createInvite({ mask, expiresAtMs });
    const guests = [];
    for (const name of names) guests.push(await createGuest(invite, name));
    return { invite, guests };
  };

  const createBody = (guest, requestId, targets, body) => ({
    requestId,
    expectedGuestId: guest.guestId,
    operation: 'create',
    targets,
    body,
  });
  const createCommand = (guest, requestId, targets, body) =>
    send(worker, commandPath, {
      method: 'POST',
      secret: guest.secret,
      body: createBody(guest, requestId, targets, body),
    });
  const createSingle = async (
    guest,
    requestId = randomUUID(),
    target = { photoId, versionId },
    body = 'Guest comment ' + randomUUID(),
    expectedStatus = 200,
  ) => {
    const response = await createCommand(guest, requestId, [target], body);
    const result = await readJson(response, expectedStatus);
    if (expectedStatus === 200) guestCommentResultSchema.parse(result);
    return { response, result, requestId, body, target };
  };
  const commentCommand = (guest, input, options = {}) =>
    send(worker, commandPath, {
      method: 'POST',
      secret: guest.secret,
      body: input,
      ...options,
    });
  const readComments = async (
    guest,
    targetPhotoId = photoId,
    targetVersionId = versionId,
    cursor,
    targetWorker = worker,
  ) => {
    const result = await readJson(
      await send(
        targetWorker,
        commentsPath(targetPhotoId, targetVersionId, cursor),
        {
          secret: guest?.secret,
        },
      ),
      200,
    );
    return guestCommentsPageSchema.parse(result);
  };
  const commentTableSnapshot = async () => {
    const snapshot = {};
    for (const table of [
      'guest_comments',
      'guest_comment_commands',
      'guest_comment_changes',
      'guest_comment_results',
    ]) {
      const row = await db
        .prepare('SELECT count(*) AS n FROM ' + table)
        .first();
      snapshot[table] = row?.n ?? null;
    }
    const audit = await db
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action LIKE 'comment.%'",
      )
      .first();
    snapshot.commentAuditEvents = audit?.n ?? null;
    return snapshot;
  };

  const commentOnly = await createInviteWithGuests(canComment, [
    'Comment only author',
    'Comment only peer',
  ]);
  const otherInvite = await createInviteWithGuests(canComment, [
    'Other invitation reader',
  ]);
  const history = await createInviteWithGuests(canComment | canViewOwnHistory, [
    'History author',
    'History peer',
  ]);
  const pagination = await createInviteWithGuests(canComment, [
    'Pagination author',
    'Pagination peer',
  ]);
  const browser = await createInviteWithGuests(
    canView | canComment | canCompareVersions,
    ['Browser author', 'Browser peer'],
  );
  const recoveryBrowser = await createInviteWithGuests(
    canView | canComment | canCompareVersions,
    ['Recovery browser author'],
  );
  const namespace = await createInviteWithGuests(fullNamespaceRights, [
    'Namespace guest',
  ]);

  const author = commentOnly.guests[0];
  const peer = commentOnly.guests[1];
  const other = otherInvite.guests[0];
  const historyAuthor = history.guests[0];
  const historyPeer = history.guests[1];
  const paginationAuthor = pagination.guests[0];
  const paginationPeer = pagination.guests[1];
  const browserAuthor = browser.guests[0];
  const browserPeer = browser.guests[1];
  const recoveryBrowserAuthor = recoveryBrowser.guests[0];
  const namespaceGuest = namespace.guests[0];

  await check(
    'Guest comments are default-off and can_comment alone authorizes text reads',
    async () => {
      const defaultCapabilities = await readJson(
        await request(capabilitiesPath),
        200,
      );
      assert.deepEqual(defaultCapabilities, { enabled: false });
      assert.deepEqual(
        await readJson(await send(disabledWorker, capabilitiesPath), 200),
        { enabled: false },
      );
      assert.deepEqual(
        await readJson(await send(worker, capabilitiesPath), 200),
        { enabled: true },
      );
      assert.equal(
        (await send(worker, capabilitiesPath + '?unexpected=1')).status,
        400,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT permissions_mask FROM guest_invites WHERE id=?')
            .bind(commentOnly.invite.id)
            .first()
        ).permissions_mask,
        canComment,
        'Fixture proves can_comment works with no view/select/compare grants',
      );

      const initiallyEmpty = await readComments(author);
      assert.equal(initiallyEmpty.guestId, author.guestId);
      assert.deepEqual(initiallyEmpty.items, []);
      assert.equal(initiallyEmpty.nextCursor, null);
      await expectDenied(
        await send(worker, commentsPath(photoId, versionId), {}),
      );
      await expectDenied(
        await send(worker, commentsPath(photoId, versionId), {
          secret:
            '0000000000000000000000000000000000000000000000000000000000000000',
        }),
      );
      await expectError(
        await send(disabledWorker, commentsPath(photoId, versionId), {
          secret: author.secret,
        }),
        503,
        'GUEST_COMMENTS_UNAVAILABLE',
      );
      await expectError(
        await send(disabledWorker, commandPath, {
          method: 'POST',
          secret: author.secret,
          body: createBody(
            author,
            randomUUID(),
            [{ photoId, versionId }],
            'off',
          ),
        }),
        503,
        'GUEST_COMMENTS_UNAVAILABLE',
      );
    },
  );

  let primary;
  let browserBatchResult;

  await check(
    'Guest comments share only within one invitation and preserve strict plain-text projections',
    async () => {
      const rawBody = '  e\u0301\r\nsecond line\rthird line  ';
      const created = await createSingle(
        author,
        randomUUID(),
        { photoId, versionId },
        rawBody,
      );
      primary = created.result.items[0];
      assert.equal(primary.body, 'é\nsecond line\nthird line');
      assert.equal(primary.state, 'open');
      assert.equal(primary.revision, 1);
      assert.equal(primary.isMine, true);
      assert.equal(primary.authorLabel, 'Comment only author');

      const replay = await readJson(
        await createCommand(
          author,
          created.requestId,
          [created.target],
          rawBody,
        ),
        200,
      );
      guestCommentResultSchema.parse(replay);
      assert.deepEqual(replay, created.result);
      const afterReplay = await readComments(author);
      assert.equal(afterReplay.items.length, 1);
      assert.equal(afterReplay.items[0].commentId, primary.commentId);

      const peerPage = await readComments(peer);
      assert.equal(peerPage.guestId, peer.guestId);
      assert.equal(peerPage.items.length, 1);
      assert.equal(peerPage.items[0].isMine, false);
      assert.equal(peerPage.items[0].body, primary.body);
      assert.equal(peerPage.items[0].authorLabel, primary.authorLabel);

      const otherPage = await readComments(other);
      assert.equal(otherPage.guestId, other.guestId);
      assert.deepEqual(otherPage.items, []);
      const serializedItem = JSON.stringify(peerPage.items[0]);
      for (const privateValue of [
        author.guestId,
        author.sessionId,
        author.inviteId,
        author.secret,
        peer.guestId,
        peer.sessionId,
        peer.inviteId,
        peer.secret,
        other.guestId,
        other.sessionId,
        other.inviteId,
        other.secret,
      ])
        assert.equal(serializedItem.includes(privateValue), false);
      for (const forbiddenKey of [
        'authorGuestId',
        'guestId',
        'inviteId',
        'sessionId',
        'requestId',
        'secret',
      ])
        assert.equal(Object.hasOwn(peerPage.items[0], forbiddenKey), false);
      assert.deepEqual(
        Object.keys(peerPage.items[0]).sort(),
        [
          'authorLabel',
          'authorType',
          'body',
          'commentId',
          'createdAt',
          'isMine',
          'parentCommentId',
          'photoId',
          'processing',
          'revision',
          'state',
          'updatedAt',
          'versionId',
        ].sort(),
      );

      assert.deepEqual(peerPage.items[0].processing, {
        state: 'open',
        revision: 0,
        commentRevision: null,
        contentRevision: null,
        updatedAt: null,
        stale: false,
      });

      const htmlBody =
        '<script>window.__guestCommentUnsafe = true</script> & literal';
      const htmlCreated = await createSingle(
        author,
        randomUUID(),
        { photoId, versionId },
        htmlBody,
      );
      assert.equal(htmlCreated.result.items[0].body, htmlBody);
      assert.equal(
        (await readComments(peer)).items.some((item) => item.body === htmlBody),
        true,
      );
      const changedReplay = await readJson(
        await createCommand(
          author,
          created.requestId,
          [created.target],
          'same UUID with different canonical payload',
        ),
      );
      assert.equal(changedReplay.error.code, 'REQUEST_ID_CONFLICT');
      assert.equal((await readComments(other)).items.length, 0);
    },
  );

  await check(
    'Guest comment batch creates are all-or-none and bind one version per unique photo',
    async () => {
      const requestId = randomUUID();
      const batchBody = '😀'.repeat(2000);
      const targets = batchTargets;
      const result = await readJson(
        await createCommand(author, requestId, targets, batchBody),
        200,
      );
      guestCommentResultSchema.parse(result);
      assert.equal(result.items.length, 24);
      assert.equal(new Set(result.items.map((item) => item.photoId)).size, 24);
      assert.ok(result.items.every((item) => item.body === batchBody));
      assert.ok(result.items.every((item) => item.revision === 1));
      assert.deepEqual(
        result.items.map((item) => item.versionId),
        targets.map((target) => target.versionId),
      );
      const exactReplay = await readJson(
        await createCommand(author, requestId, targets, batchBody),
        200,
      );
      assert.deepEqual(exactReplay, result);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_comments WHERE created_request_id=?',
            )
            .bind(requestId)
            .first()
        ).n,
        24,
      );
      browserBatchResult = result;

      const specialBody = 'quote " slash \\\nnew line';
      const specialText = await createSingle(
        author,
        randomUUID(),
        targets[2],
        specialBody,
      );
      assert.equal(specialText.result.items[0].body, specialBody);

      const beforeBadBatch = await commentTableSnapshot();
      const badRequestId = randomUUID();
      const badTargets = targets.map((target, index) =>
        index === targets.length - 1
          ? { ...target, versionId: randomUUID() }
          : target,
      );
      await expectDenied(
        await createCommand(author, badRequestId, badTargets, 'must roll back'),
      );
      assert.deepEqual(await commentTableSnapshot(), beforeBadBatch);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_comment_commands WHERE request_id=?',
            )
            .bind(badRequestId)
            .first()
        ).n,
        0,
      );

      const duplicateTargetBody = {
        requestId: randomUUID(),
        expectedGuestId: author.guestId,
        operation: 'create',
        targets: [
          { photoId, versionId },
          { photoId, versionId: versionFixture.currentVersionId },
        ],
        body: 'duplicate photo target',
      };
      await expectError(
        await commentCommand(author, duplicateTargetBody),
        400,
        'INVALID_INPUT',
      );
      const tooManyTargets = {
        ...duplicateTargetBody,
        requestId: randomUUID(),
        targets: Array.from({ length: 25 }, () => ({
          photoId: randomUUID(),
          versionId: randomUUID(),
        })),
      };
      await expectError(
        await commentCommand(author, tooManyTargets),
        400,
        'INVALID_INPUT',
      );
      const draftRequestId = randomUUID();
      await expectDenied(
        await createCommand(
          author,
          draftRequestId,
          [{ photoId, versionId: versionFixture.unpublishedVersionId }],
          'unpublished draft',
        ),
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_comment_commands WHERE request_id=?',
            )
            .bind(draftRequestId)
            .first()
        ).n,
        0,
      );
    },
  );

  await check(
    'Guest comment API enforces origin, JSON, query, body, and strict command shapes',
    async () => {
      const command = createBody(
        author,
        randomUUID(),
        [{ photoId, versionId }],
        'strict request',
      );
      await expectError(
        await commentCommand(author, command, { omitOrigin: true }),
        403,
        'FORBIDDEN_ORIGIN',
      );
      const attackerOrigin = await commentCommand(author, command, {
        extraHeaders: { Origin: 'https://attacker.example' },
      });
      assert.equal(attackerOrigin.status, 403);
      assert.equal(
        attackerOrigin.headers.get('content-type'),
        'text/plain;charset=UTF-8',
      );
      assert.equal(await attackerOrigin.text(), 'Invalid Origin header');
      await expectError(
        await send(worker, commandPath + '?unexpected=1', {
          method: 'POST',
          secret: author.secret,
          body: command,
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(worker, commandPath, {
          method: 'POST',
          secret: author.secret,
          body: JSON.stringify(command),
          rawBody: true,
          extraHeaders: { 'Content-Type': 'text/plain' },
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await commentCommand(author, { ...command, ownerId: owner }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await commentCommand(author, {
          ...command,
          requestId: randomUUID(),
          body: 'x\u0000',
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await commentCommand(author, {
          ...command,
          requestId: randomUUID(),
          body: 'x'.repeat(2001),
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(worker, commentsPath(photoId, versionId) + '?unknown=1', {
          secret: author.secret,
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(
          worker,
          commentsPath(photoId, versionId) + '?cursor=bad&cursor=bad2',
          { secret: author.secret },
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(
          worker,
          '/api/guest/albums/' +
            albumId +
            '/photos/' +
            randomUUID() +
            '/versions/' +
            versionId +
            '/comments',
          { secret: author.secret },
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
    },
  );

  await check(
    'Guest comment CAS serializes competing edits and enforces author-only lifecycle transitions',
    async () => {
      const created = await createSingle(
        author,
        randomUUID(),
        { photoId, versionId },
        'CAS starting body',
      );
      const commentId = created.result.items[0].commentId;
      for (const operation of [
        { operation: 'edit', body: 'peer cannot edit' },
        { operation: 'delete' },
        { operation: 'resolve' },
        { operation: 'reopen' },
      ]) {
        await expectDenied(
          await commentCommand(peer, {
            requestId: randomUUID(),
            expectedGuestId: peer.guestId,
            commentId,
            expectedRevision: 1,
            ...operation,
          }),
        );
      }

      const race = await Promise.all(
        ['CAS winner A', 'CAS winner B'].map(async (body) => {
          const response = await commentCommand(author, {
            requestId: randomUUID(),
            expectedGuestId: author.guestId,
            operation: 'edit',
            commentId,
            expectedRevision: 1,
            body,
          });
          const result = await readJson(response);
          return { status: response.status, result };
        }),
      );
      assert.deepEqual(
        race.map((item) => item.status).sort((a, b) => a - b),
        [200, 409],
      );
      const rejected = race.find((item) => item.status === 409);
      assert.equal(rejected?.result?.error?.code, 'COMMENT_REVISION_CONFLICT');
      const winner = race.find((item) => item.status === 200);
      guestCommentResultSchema.parse(winner.result);
      assert.equal(winner.result.items[0].revision, 2);
      assert.ok(
        ['CAS winner A', 'CAS winner B'].includes(winner.result.items[0].body),
      );
      await expectRevisionConflict(
        await commentCommand(author, {
          requestId: randomUUID(),
          expectedGuestId: author.guestId,
          operation: 'edit',
          commentId,
          expectedRevision: 1,
          body: 'stale body',
        }),
      );

      const lifecycle = await createSingle(
        author,
        randomUUID(),
        { photoId: neighborPhotoId, versionId: neighborVersionId },
        'open lifecycle body',
      );
      const lifecycleId = lifecycle.result.items[0].commentId;
      let revision = 1;
      const lifecycleCommand = async (operation, patch = {}) => {
        const result = await readJson(
          await commentCommand(author, {
            requestId: randomUUID(),
            expectedGuestId: author.guestId,
            commentId: lifecycleId,
            expectedRevision: revision,
            operation,
            ...patch,
          }),
          200,
        );
        guestCommentResultSchema.parse(result);
        revision += 1;
        return result.items[0];
      };
      const resolved = await lifecycleCommand('resolve');
      assert.equal(resolved.state, 'resolved');
      assert.equal(resolved.revision, 2);
      const editedResolved = await lifecycleCommand('edit', {
        body: 'still resolved after edit',
      });
      assert.equal(editedResolved.state, 'resolved');
      assert.equal(editedResolved.body, 'still resolved after edit');
      assert.equal(editedResolved.revision, 3);
      await expectRevisionConflict(
        await commentCommand(author, {
          requestId: randomUUID(),
          expectedGuestId: author.guestId,
          operation: 'resolve',
          commentId: lifecycleId,
          expectedRevision: revision,
        }),
      );
      const reopened = await lifecycleCommand('reopen');
      assert.equal(reopened.state, 'open');
      const deleted = await lifecycleCommand('delete');
      assert.equal(deleted.state, 'deleted');
      assert.equal(deleted.body, null);
      assert.equal(deleted.revision, 5);
      const tombstonePage = await readComments(
        peer,
        neighborPhotoId,
        neighborVersionId,
      );
      const tombstone = tombstonePage.items.find(
        (item) => item.commentId === lifecycleId,
      );
      assert.ok(tombstone);
      assert.equal(tombstone.state, 'deleted');
      assert.equal(tombstone.body, null);

      const commentIdPath =
        commentsPath(neighborPhotoId, neighborVersionId) +
        '?commentId=' +
        encodeURIComponent(lifecycleId);
      const currentTombstone = await readJson(
        await send(worker, commentIdPath, { secret: author.secret }),
        200,
      );
      assert.equal(currentTombstone.items.length, 1);
      assert.equal(currentTombstone.nextCursor, null);
      assert.deepEqual(
        {
          commentId: currentTombstone.items[0].commentId,
          body: currentTombstone.items[0].body,
          state: currentTombstone.items[0].state,
          revision: currentTombstone.items[0].revision,
          isMine: currentTombstone.items[0].isMine,
        },
        {
          commentId: lifecycleId,
          body: null,
          state: 'deleted',
          revision: 5,
          isMine: true,
        },
      );
      const crossInviteTombstone = await readJson(
        await send(worker, commentIdPath, { secret: other.secret }),
        200,
      );
      assert.equal(crossInviteTombstone.guestId, other.guestId);
      assert.deepEqual(crossInviteTombstone.items, []);
      assert.equal(crossInviteTombstone.nextCursor, null);
      await expectError(
        await send(
          worker,
          commentsPath(neighborPhotoId, neighborVersionId) +
            '?commentId=not-a-uuid',
          { secret: author.secret },
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(worker, commentIdPath + '&cursor=bad', {
          secret: author.secret,
        }),
        400,
        'INVALID_INPUT',
      );
      await expectRevisionConflict(
        await commentCommand(author, {
          requestId: randomUUID(),
          expectedGuestId: author.guestId,
          operation: 'edit',
          commentId: lifecycleId,
          expectedRevision: revision,
          body: 'cannot replace tombstone',
        }),
      );

      const auditRows = await db
        .prepare(
          "SELECT action,before_json,after_json FROM audit_events WHERE actor_type='guest' AND actor_id=? AND photo_id=? AND action LIKE 'comment.%' ORDER BY rowid",
        )
        .bind(author.guestId, neighborPhotoId)
        .all();
      assert.ok(
        auditRows.results.some((event) => event.action === 'comment.create'),
      );
      assert.ok(
        auditRows.results.some((event) => event.action === 'comment.resolve'),
      );
      assert.ok(
        auditRows.results.some((event) => event.action === 'comment.edit'),
      );
      assert.ok(
        auditRows.results.some((event) => event.action === 'comment.reopen'),
      );
      assert.ok(
        auditRows.results.some((event) => event.action === 'comment.delete'),
      );
      for (const event of auditRows.results) {
        const before = JSON.parse(event.before_json);
        const after = JSON.parse(event.after_json);
        assert.equal(typeof before.commentId, 'string');
        assert.equal(after.revision, before.revision + 1);
        assert.equal(Object.hasOwn(before, 'body'), true);
        assert.equal(Object.hasOwn(after, 'body'), true);
      }
    },
  );

  await check(
    'Guest comment D1 guards preserve immutable scope, tombstones, and command-bound predecessor witnesses',
    async () => {
      const comment = primary;
      assert.ok(comment?.commentId);
      await assert.rejects(
        db
          .prepare('UPDATE guest_comments SET id=? WHERE id=?')
          .bind(randomUUID(), comment.commentId)
          .run(),
        /IMMUTABLE_GUEST_COMMENT_SCOPE/,
      );
      await assert.rejects(
        db
          .prepare('UPDATE guest_comments SET version_id=? WHERE id=?')
          .bind(versionFixture.currentVersionId, comment.commentId)
          .run(),
        /IMMUTABLE_GUEST_COMMENT_SCOPE/,
      );
      await assert.rejects(
        db
          .prepare(
            "UPDATE guest_comments SET body=NULL,state='open' WHERE id=?",
          )
          .bind(comment.commentId)
          .run(),
        /constraint failed|INVALID_GUEST_COMMENT_PREDECESSOR/i,
      );
      await assert.rejects(
        db
          .prepare("UPDATE guest_comments SET state='resolved' WHERE id=?")
          .bind(comment.commentId)
          .run(),
        /INVALID_GUEST_COMMENT_PREDECESSOR/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM guest_comments WHERE id=?')
          .bind(comment.commentId)
          .run(),
        /IMMUTABLE_GUEST_COMMENT/,
      );
      await assert.rejects(
        db
          .prepare(
            "UPDATE guest_comment_changes SET operation='delete' WHERE comment_id=? AND revision=1",
          )
          .bind(comment.commentId)
          .run(),
        /IMMUTABLE_GUEST_COMMENT_CHANGE/,
      );
      const change = await db
        .prepare(
          'SELECT event_id,operation,revision,before_json,after_json FROM guest_comment_changes WHERE comment_id=? AND revision=1',
        )
        .bind(comment.commentId)
        .first();
      assert.ok(
        change.event_id.startsWith('guest-comment:' + comment.commentId + ':'),
      );
      assert.equal(change.operation, 'create');
      assert.equal(change.revision, 1);
      assert.equal(JSON.parse(change.before_json).state, 'absent');
      assert.equal(JSON.parse(change.after_json).state, 'open');
    },
  );

  await check(
    'Guest comment change witnesses cannot redirect an author edit to a sibling comment',
    async () => {
      const createdA = await createSingle(
        author,
        randomUUID(),
        { photoId, versionId },
        'Sibling comment A',
      );
      const createdB = await createSingle(
        author,
        randomUUID(),
        { photoId, versionId },
        'Sibling comment B',
      );
      const commentAId = createdA.result.items[0].commentId;
      const commentBId = createdB.result.items[0].commentId;
      const editRequestId = randomUUID();
      const editBody = 'Only sibling A is allowed to receive this edit.';
      const editedA = await readJson(
        await commentCommand(author, {
          requestId: editRequestId,
          expectedGuestId: author.guestId,
          commentId: commentAId,
          expectedRevision: 1,
          operation: 'edit',
          body: editBody,
        }),
        200,
      );
      assert.equal(editedA.items[0].commentId, commentAId);
      assert.equal(editedA.items[0].revision, 2);
      const editCommand = await db
        .prepare(
          'SELECT id,created_at_ms FROM guest_comment_commands WHERE guest_id=? AND request_id=?',
        )
        .bind(author.guestId, editRequestId)
        .first();
      assert.ok(editCommand?.id);
      const beforeRows = await db
        .prepare(
          'SELECT id,body,state,revision,last_command_id FROM guest_comments WHERE id IN (?,?) ORDER BY id',
        )
        .bind(commentAId, commentBId)
        .all();
      const beforeSnapshot = await commentTableSnapshot();
      const forgedBefore = JSON.stringify({
        commentId: commentBId,
        revision: 1,
        state: 'open',
        body: 'Sibling comment B',
      });
      const forgedAfter = JSON.stringify({
        commentId: commentBId,
        revision: 2,
        state: 'open',
        body: editBody,
      });
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO guest_comment_changes(event_id,command_id,request_id,guest_id,invite_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,comment_id,operation,revision,occurred_at_ms,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            'guest-comment:' + commentBId + ':2',
            editCommand.id,
            editRequestId,
            author.guestId,
            author.inviteId,
            author.sessionId,
            versionFixture.workspaceId,
            versionFixture.projectId,
            albumId,
            photoId,
            versionId,
            commentBId,
            'edit',
            2,
            editCommand.created_at_ms,
            forgedBefore,
            forgedAfter,
          )
          .run(),
        /INVALID_GUEST_COMMENT_CHANGE/,
      );
      assert.deepEqual(await commentTableSnapshot(), beforeSnapshot);
      assert.deepEqual(
        (
          await db
            .prepare(
              'SELECT id,body,state,revision,last_command_id FROM guest_comments WHERE id IN (?,?) ORDER BY id',
            )
            .bind(commentAId, commentBId)
            .all()
        ).results,
        beforeRows.results,
      );
    },
  );

  await check(
    'Guest comment audit failures roll back commands, comments, history, and audit rows',
    async () => {
      const requestId = randomUUID();
      const before = await commentTableSnapshot();
      await db.exec(
        "CREATE TRIGGER guest_comment_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.actor_type='guest' AND NEW.action LIKE 'comment.%' BEGIN SELECT RAISE(ABORT,'TEST_GUEST_COMMENT_AUDIT_FAILURE'); END",
      );
      try {
        await expectError(
          await createCommand(
            author,
            requestId,
            [{ photoId, versionId }],
            'audit rollback',
          ),
          503,
          'GUEST_COMMENTS_UNAVAILABLE',
        );
      } finally {
        await db.exec('DROP TRIGGER guest_comment_test_audit_failure');
      }
      assert.deepEqual(await commentTableSnapshot(), before);
      for (const table of [
        'guest_comment_commands',
        'guest_comment_changes',
        'guest_comment_results',
      ]) {
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM ' + table + ' WHERE request_id=?',
              )
              .bind(requestId)
              .first()
          ).n,
          0,
        );
      }
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(requestId)
            .first()
        ).n,
        0,
      );
    },
  );

  await check(
    'Directly forged Guest comment audit rows fail the immutable change-witness guard',
    async () => {
      const before = await commentTableSnapshot();
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc) VALUES(?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            'guest',
            author.guestId,
            author.sessionId,
            versionFixture.workspaceId,
            versionFixture.projectId,
            albumId,
            photoId,
            versionId,
            'comment.create',
            '{}',
            '{}',
            randomUUID(),
            new Date().toISOString(),
          )
          .run(),
        /INVALID_GUEST_COMMENT_AUDIT/,
      );
      assert.deepEqual(await commentTableSnapshot(), before);
    },
  );

  await check(
    'Guest comment 1,000-item cap keeps replay available and rejects a mixed full-thread batch atomically',
    async () => {
      const capacityBundle = await createInviteWithGuests(canComment, [
        'Capacity guest',
      ]);
      const capacityGuest = capacityBundle.guests[0];
      const accepted = await createSingle(
        capacityGuest,
        randomUUID(),
        { photoId, versionId },
        'capacity replay',
      );
      const insert = db.prepare(
        'INSERT INTO guest_comment_commands(id,guest_id,invite_id,session_id,secret_hash,expected_guest_id,request_id,workspace_id,project_id,album_id,operation,request_json,targets_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      for (let start = 0; start < 999; start += 50) {
        const statements = [];
        for (let index = start; index < Math.min(start + 50, 999); index += 1) {
          const requestId = randomUUID();
          const commentId = randomUUID();
          const requestJson = JSON.stringify({
            requestId,
            expectedGuestId: capacityGuest.guestId,
            operation: 'create',
            targets: [{ photoId, versionId }],
            body: 'x',
          });
          const targetsJson = JSON.stringify([
            { commentId, photoId, versionId },
          ]);
          statements.push(
            insert.bind(
              randomUUID(),
              capacityGuest.guestId,
              capacityBundle.invite.id,
              capacityGuest.sessionId,
              hashGuestSession(capacityGuest.secret),
              capacityGuest.guestId,
              requestId,
              versionFixture.workspaceId,
              versionFixture.projectId,
              albumId,
              'create',
              requestJson,
              targetsJson,
            ),
          );
        }
        await db.batch(statements);
      }

      const count = await db
        .prepare(
          'SELECT count(*) AS n FROM guest_comments WHERE invite_id=? AND photo_id=? AND version_id=?',
        )
        .bind(capacityBundle.invite.id, photoId, versionId)
        .first();
      assert.equal(count?.n, 1000);

      const replay = await createCommand(
        capacityGuest,
        accepted.requestId,
        [accepted.target],
        accepted.body,
      );
      assert.deepEqual(await readJson(replay, 200), accepted.result);

      await expectError(
        await createCommand(
          capacityGuest,
          randomUUID(),
          [{ photoId, versionId }],
          'one over the cap',
        ),
        409,
        'COMMENT_LIMIT_REACHED',
      );

      const requestId = randomUUID();
      const before = await commentTableSnapshot();
      await expectError(
        await createCommand(
          capacityGuest,
          requestId,
          [
            { photoId: neighborPhotoId, versionId: neighborVersionId },
            { photoId, versionId },
          ],
          'one empty and one full target',
        ),
        409,
        'COMMENT_LIMIT_REACHED',
      );
      assert.deepEqual(await commentTableSnapshot(), before);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_comment_commands WHERE guest_id=? AND request_id=?',
            )
            .bind(capacityGuest.guestId, requestId)
            .first()
        )?.n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_comments WHERE invite_id=? AND photo_id=? AND version_id=?',
            )
            .bind(capacityBundle.invite.id, neighborPhotoId, neighborVersionId)
            .first()
        )?.n,
        0,
      );
    },
  );

  await check(
    'Guest comment pages expose 24 plus one and reject stale or cross-scope cursors',
    async () => {
      for (let index = 0; index < 25; index += 1) {
        const result = await readJson(
          await createCommand(
            paginationAuthor,
            randomUUID(),
            [{ photoId, versionId }],
            'Page comment ' + String(index + 1),
          ),
          200,
        );
        guestCommentResultSchema.parse(result);
      }
      const paginationFirst = await readComments(paginationAuthor);
      assert.equal(paginationFirst.items.length, 24);
      assert.ok(paginationFirst.nextCursor);
      assert.ok(paginationFirst.nextCursor.length <= 1024);
      const paginationSecond = await readComments(
        paginationAuthor,
        photoId,
        versionId,
        paginationFirst.nextCursor,
      );
      assert.equal(paginationSecond.items.length, 1);
      assert.equal(paginationSecond.nextCursor, null);

      await expectError(
        await send(
          worker,
          commentsPath(
            photoId,
            versionFixture.currentVersionId,
            paginationFirst.nextCursor,
          ),
          { secret: paginationAuthor.secret },
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(
          worker,
          commentsPath(
            neighborPhotoId,
            neighborVersionId,
            paginationFirst.nextCursor,
          ),
          { secret: paginationAuthor.secret },
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(
          worker,
          commentsPath(photoId, versionId, paginationFirst.nextCursor),
          { secret: paginationPeer.secret },
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await send(
          worker,
          commentsPath(photoId, versionId, paginationFirst.nextCursor),
          { secret: other.secret },
        ),
        400,
        'INVALID_INPUT',
      );

      const legacyCursor = JSON.parse(
        Buffer.from(paginationFirst.nextCursor, 'base64url').toString('utf8'),
      );
      assert.equal(legacyCursor.schemaVersion, 2);
      delete legacyCursor.schemaVersion;
      await expectError(
        await send(
          worker,
          commentsPath(
            photoId,
            versionId,
            Buffer.from(JSON.stringify(legacyCursor)).toString('base64url'),
          ),
          { secret: paginationAuthor.secret },
        ),
        400,
        'INVALID_INPUT',
      );
      await createSingle(
        paginationAuthor,
        randomUUID(),
        { photoId, versionId },
        'watermark change',
      );
      await expectHistoryChanged(
        await send(
          worker,
          commentsPath(photoId, versionId, paginationFirst.nextCursor),
          { secret: paginationAuthor.secret },
        ),
      );
      await expectError(
        await send(
          worker,
          commentsPath(photoId, versionId, 'not-a-valid-comment-cursor'),
          { secret: paginationAuthor.secret },
        ),
        400,
        'INVALID_INPUT',
      );
    },
  );

  await check(
    'Guest comment request IDs conflict symmetrically with selection, feedback, tags, logout, exchange, and shared review ledgers',
    async () => {
      const commentOnTarget = (guest, requestId, body) =>
        createCommand(guest, requestId, [{ photoId, versionId }], body);

      const assertForwardAndReverse = async (
        name,
        ledgerCommand,
        {
          ledgerSuccessStatus = 200,
          ledgerFailureStatus = 409,
          ledgerFailureCode = 'REQUEST_ID_CONFLICT',
        } = {},
      ) => {
        const ledgerFirstId = randomUUID();
        await readJson(
          await ledgerCommand(namespaceGuest, ledgerFirstId),
          ledgerSuccessStatus,
        );
        await expectRequestConflict(
          await commentOnTarget(
            namespaceGuest,
            ledgerFirstId,
            name + ' collision from existing ledger',
          ),
        );

        const commentFirstId = randomUUID();
        await readJson(
          await commentOnTarget(
            namespaceGuest,
            commentFirstId,
            name + ' collision from comments ledger',
          ),
          200,
        );
        await expectError(
          await ledgerCommand(namespaceGuest, commentFirstId),
          ledgerFailureStatus,
          ledgerFailureCode,
        );
      };

      await assertForwardAndReverse(
        'Guest rating feedback',
        (guest, requestId) =>
          send(
            worker,
            '/api/guest/albums/' + albumId + '/photos/' + photoId + '/rating',
            {
              method: 'PUT',
              secret: guest.secret,
              body: { requestId, versionId, stars: null },
            },
          ),
      );
      await assertForwardAndReverse(
        'Guest favorite feedback',
        (guest, requestId) =>
          send(
            worker,
            '/api/guest/albums/' + albumId + '/photos/' + photoId + '/favorite',
            {
              method: 'PUT',
              secret: guest.secret,
              body: { requestId, versionId, favored: false },
            },
          ),
      );
      await assertForwardAndReverse('Guest tag', (guest, requestId) =>
        send(
          worker,
          '/api/guest/albums/' + albumId + '/photos/' + photoId + '/tags',
          {
            method: 'PUT',
            secret: guest.secret,
            body: {
              requestId,
              expectedGuestId: guest.guestId,
              versionId,
              label: 'namespace-' + requestId.slice(0, 8),
              present: false,
            },
          },
        ),
      );
      await assertForwardAndReverse('Guest selection', (guest, requestId) =>
        send(
          worker,
          '/api/guest/albums/' + albumId + '/photos/' + photoId + '/selection',
          {
            method: 'PUT',
            secret: guest.secret,
            body: { requestId, versionId, selected: false },
          },
        ),
      );

      const ownerReviewCreate = async () => {
        assert.equal(typeof cookies?.headers, 'function');
        const response = await send(
          worker,
          '/api/v1/albums/' + albumId + '/shared-reviews',
          {
            method: 'POST',
            body: {
              requestId: randomUUID(),
              title: 'Guest comments namespace ' + randomUUID(),
              inviteIds: [namespace.invite.id],
              minimum: 1,
              maximum: 1,
              confirmShared: true,
            },
            extraHeaders: {
              Cookie: cookies.headers(),
              Origin: new URL(base).origin,
              'Content-Type': 'application/json',
            },
          },
        );
        const result = await readJson(response);
        assert.ok([200, 201].includes(response.status), JSON.stringify(result));
        assert.ok(result.review?.id);
        return result.review.id;
      };
      const reviewId = await ownerReviewCreate();
      const sharedSet = (guest, requestId) =>
        send(
          worker,
          '/api/guest/albums/' +
            albumId +
            '/shared-reviews/' +
            reviewId +
            '/photos/' +
            photoId +
            '/selection',
          {
            method: 'PUT',
            secret: guest.secret,
            body: {
              requestId,
              expectedGuestId: guest.guestId,
              roundNo: 1,
              versionId,
              selected: false,
            },
          },
        );
      await assertForwardAndReverse('Guest shared review', sharedSet);

      const submitWithId = (guest, requestId) =>
        send(worker, '/api/guest/albums/' + albumId + '/selection/submit', {
          method: 'POST',
          secret: guest.secret,
          body: {
            requestId,
            expectedRoundNo: 1,
            expectedRevision: 1,
          },
        });
      const selectionRequestId = randomUUID();
      await readJson(
        await send(
          worker,
          '/api/guest/albums/' + albumId + '/photos/' + photoId + '/selection',
          {
            method: 'PUT',
            secret: namespaceGuest.secret,
            body: {
              requestId: selectionRequestId,
              versionId,
              selected: true,
            },
          },
        ),
        200,
      );
      const submissionRequestId = randomUUID();
      await readJson(
        await submitWithId(namespaceGuest, submissionRequestId),
        200,
      );
      await expectRequestConflict(
        await commentOnTarget(
          namespaceGuest,
          submissionRequestId,
          'selection submission ledger collision',
        ),
      );
      const reverseSubmissionGuest = await createGuest(
        namespace.invite,
        'Reverse submission namespace guest',
      );
      const reverseSelectionRequestId = randomUUID();
      await readJson(
        await send(
          worker,
          '/api/guest/albums/' + albumId + '/photos/' + photoId + '/selection',
          {
            method: 'PUT',
            secret: reverseSubmissionGuest.secret,
            body: {
              requestId: reverseSelectionRequestId,
              versionId,
              selected: true,
            },
          },
        ),
        200,
      );
      const commentBeforeSubmission = randomUUID();
      await readJson(
        await commentOnTarget(
          reverseSubmissionGuest,
          commentBeforeSubmission,
          'comment before selection submission',
        ),
        200,
      );
      const reverseSubmissionSnapshot = async () => {
        const round = await db
          .prepare(
            'SELECT round_no,selection_revision,status,submitted_at_ms FROM guest_selection_round_state WHERE invite_id=? AND guest_id=? AND album_id=?',
          )
          .bind(namespace.invite.id, reverseSubmissionGuest.guestId, albumId)
          .first();
        const ledgers = await db
          .prepare(
            'SELECT (SELECT count(*) FROM guest_selection_submissions WHERE invite_id=? AND guest_id=? AND album_id=?) AS submissions,(SELECT count(*) FROM guest_selection_submission_items WHERE invite_id=? AND guest_id=? AND album_id=?) AS items,(SELECT count(*) FROM guest_selection_submission_results r JOIN guest_selection_submissions s ON s.id=r.submission_id WHERE s.invite_id=? AND s.guest_id=? AND s.album_id=?) AS results,(SELECT count(*) FROM guest_selection_submission_seals z JOIN guest_selection_submissions s ON s.id=z.submission_id WHERE s.invite_id=? AND s.guest_id=? AND s.album_id=?) AS seals',
          )
          .bind(
            namespace.invite.id,
            reverseSubmissionGuest.guestId,
            albumId,
            namespace.invite.id,
            reverseSubmissionGuest.guestId,
            albumId,
            namespace.invite.id,
            reverseSubmissionGuest.guestId,
            albumId,
            namespace.invite.id,
            reverseSubmissionGuest.guestId,
            albumId,
          )
          .first();
        return { round, ledgers };
      };
      const reverseSubmissionBefore = await reverseSubmissionSnapshot();
      assert.equal(reverseSubmissionBefore.round?.round_no, 1);
      assert.equal(reverseSubmissionBefore.round?.selection_revision, 1);
      assert.equal(reverseSubmissionBefore.round?.status, 'open');
      await expectRequestConflict(
        await submitWithId(reverseSubmissionGuest, commentBeforeSubmission),
      );
      assert.deepEqual(
        await reverseSubmissionSnapshot(),
        reverseSubmissionBefore,
        'The request-ID collision leaves the open round and all submission snapshots untouched',
      );

      const logoutSession = await createSession(
        namespace.invite,
        namespaceGuest,
      );
      const logout = (sessionGuest, requestId) =>
        send(worker, '/api/guest/logout', {
          method: 'POST',
          secret: sessionGuest.secret,
          body: { requestId },
        });
      const logoutFirstId = randomUUID();
      await readJson(await logout(logoutSession, logoutFirstId), 200);
      await expectRequestConflict(
        await commentOnTarget(
          namespaceGuest,
          logoutFirstId,
          'logout ledger collision',
        ),
      );
      const commentBeforeLogout = randomUUID();
      await readJson(
        await commentOnTarget(
          namespaceGuest,
          commentBeforeLogout,
          'comment before logout',
        ),
        200,
      );
      const secondLogoutSession = await createSession(
        namespace.invite,
        namespaceGuest,
      );
      await expectRequestConflict(
        await logout(secondLogoutSession, commentBeforeLogout),
      );

      const exchangeFirstInvite = await createInvite({ mask: canComment });
      const exchangeFirstId = randomUUID();
      const exchangeResponse = await send(worker, '/api/guest/exchange', {
        method: 'POST',
        body: {
          requestId: exchangeFirstId,
          token: exchangeFirstInvite.token,
          displayName: 'Exchange first guest',
        },
        extraHeaders: {
          'CF-Connecting-IP': '198.51.100.251',
          Origin: new URL(base).origin,
          'Content-Type': 'application/json',
        },
      });
      await readJson(exchangeResponse, 200);
      const cookieLine =
        typeof exchangeResponse.headers.getSetCookie === 'function'
          ? exchangeResponse.headers
              .getSetCookie()
              .find((value) => /(?:^|;\s*)(?:__Host-)?kino_guest=/.test(value))
          : exchangeResponse.headers.get('set-cookie');
      assert.ok(cookieLine);
      const exchangedSecret = /(?:^|;\s*)(?:__Host-)?kino_guest=([^;]+)/.exec(
        cookieLine,
      )?.[1];
      assert.ok(exchangedSecret);
      const decodedExchangeSecret = decodeURIComponent(exchangedSecret);
      const exchangedSession = await db
        .prepare('SELECT guest_id FROM guest_sessions WHERE secret_hash=?')
        .bind(hashGuestSession(decodedExchangeSecret))
        .first();
      assert.ok(exchangedSession?.guest_id);
      await expectRequestConflict(
        await createCommand(
          {
            ...namespaceGuest,
            guestId: exchangedSession.guest_id,
            secret: decodedExchangeSecret,
          },
          exchangeFirstId,
          [{ photoId, versionId }],
          'exchange-first collision',
        ),
      );

      const commentFirstInvite = await createInvite({ mask: canComment });
      const commentFirstGuest = await createGuest(
        commentFirstInvite,
        'Comment before exchange',
      );
      const commentFirstExchangeId = randomUUID();
      await readJson(
        await createCommand(
          commentFirstGuest,
          commentFirstExchangeId,
          [{ photoId, versionId }],
          'comment-first exchange collision',
        ),
        200,
      );
      const identitiesBefore = await db
        .prepare('SELECT count(*) AS n FROM guest_identities WHERE invite_id=?')
        .bind(commentFirstInvite.id)
        .first();
      await expectDenied(
        await send(worker, '/api/guest/exchange', {
          method: 'POST',
          body: {
            requestId: commentFirstExchangeId,
            token: commentFirstInvite.token,
            displayName: 'Must not be exchanged',
          },
          extraHeaders: {
            'CF-Connecting-IP': '198.51.100.252',
            Origin: new URL(base).origin,
            'Content-Type': 'application/json',
          },
        }),
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_identities WHERE invite_id=?',
            )
            .bind(commentFirstInvite.id)
            .first()
        ).n,
        identitiesBefore.n,
        'colliding exchange insertion rolls back its identity',
      );
    },
  );

  await check(
    'Guest comment own-history projection includes only the caller and never exposes body text',
    async () => {
      const authorBody = 'HISTORY SECRET BODY ' + randomUUID();
      const peerBody = 'PEER SECRET BODY ' + randomUUID();
      const authorCreate = await createSingle(
        historyAuthor,
        randomUUID(),
        { photoId, versionId },
        authorBody,
      );
      const historyCommentId = authorCreate.result.items[0].commentId;
      const peerCreate = await createSingle(
        historyPeer,
        randomUUID(),
        { photoId, versionId },
        peerBody,
      );
      const historyPeerCommentId = peerCreate.result.items[0].commentId;
      const authorEdit = await readJson(
        await commentCommand(historyAuthor, {
          requestId: randomUUID(),
          expectedGuestId: historyAuthor.guestId,
          operation: 'edit',
          commentId: historyCommentId,
          expectedRevision: 1,
          body: 'HISTORY EDITED SECRET BODY ' + randomUUID(),
        }),
        200,
      );
      guestCommentResultSchema.parse(authorEdit);

      const historyPath =
        '/api/guest/me/activity?albumId=' +
        encodeURIComponent(albumId) +
        '&photoId=' +
        encodeURIComponent(photoId);
      const ledgerBefore = await commentTableSnapshot();
      const page = await readJson(
        await send(worker, historyPath, { secret: historyAuthor.secret }),
        200,
      );
      assert.deepEqual(Object.keys(page).sort(), [
        'guestId',
        'items',
        'nextCursor',
      ]);
      assert.equal(page.guestId, historyAuthor.guestId);
      assert.ok(Array.isArray(page.items));
      assert.ok(page.items.length <= 24);
      assert.equal(
        page.nextCursor === null || typeof page.nextCursor === 'string',
        true,
      );
      for (const item of page.items) {
        assert.deepEqual(Object.keys(item).sort(), [
          'action',
          'albumId',
          'detail',
          'eventId',
          'occurredAt',
          'photoId',
          'photoStatus',
          'versionId',
        ]);
        assert.ok(
          [
            'comment.create',
            'comment.edit',
            'comment.delete',
            'comment.resolve',
            'comment.reopen',
          ].includes(item.action),
        );
        assert.equal(item.albumId, albumId);
        assert.equal(item.photoId, photoId);
        assert.equal(item.versionId, versionId);
        assert.deepEqual(Object.keys(item.detail).sort(), ['after', 'before']);
        for (const state of [item.detail.before, item.detail.after]) {
          assert.deepEqual(Object.keys(state).sort(), [
            'commentId',
            'revision',
            'state',
          ]);
          assert.equal(typeof state.commentId, 'string');
          assert.equal(Number.isSafeInteger(state.revision), true);
          assert.ok(
            ['absent', 'open', 'resolved', 'deleted'].includes(state.state),
          );
        }
      }
      const commentEvents = page.items.filter((item) =>
        item.action.startsWith('comment.'),
      );
      assert.ok(
        commentEvents.some(
          (item) =>
            item.action === 'comment.create' &&
            item.detail.after.commentId === historyCommentId,
        ),
      );
      assert.ok(
        commentEvents.some(
          (item) =>
            item.action === 'comment.edit' &&
            item.detail.after.commentId === historyCommentId,
        ),
      );
      assert.equal(
        commentEvents.some(
          (item) => item.detail.after.commentId === historyPeerCommentId,
        ),
        false,
      );
      for (const event of commentEvents) {
        assert.ok(event.versionId);
        assert.equal(Object.hasOwn(event.detail.before, 'body'), false);
        assert.equal(Object.hasOwn(event.detail.after, 'body'), false);
      }
      const serializedHistory = JSON.stringify(page);
      for (const privateValue of [
        authorBody,
        peerBody,
        historyAuthor.secret,
        historyPeer.secret,
        historyAuthor.sessionId,
        historyPeer.sessionId,
        historyAuthor.inviteId,
        historyPeer.inviteId,
        historyPeer.guestId,
      ])
        assert.equal(serializedHistory.includes(privateValue), false);
      assert.equal(
        page.items.some(
          (item) => item.detail?.after?.commentId === historyPeerCommentId,
        ),
        false,
      );
      const ledgerAfter = await commentTableSnapshot();
      assert.deepEqual(ledgerAfter, ledgerBefore);
      await expectDenied(
        await send(worker, historyPath, { secret: author.secret }),
      );
    },
  );

  await check(
    'Guest comment current ACL is checked before replay for invite revocation, session revocation, owner disablement and expiry',
    async () => {
      const inviteRevokedBundle = await createInviteWithGuests(canComment, [
        'Invite revoked comment guest',
      ]);
      const inviteGuest = inviteRevokedBundle.guests[0];
      const inviteWrite = await createSingle(
        inviteGuest,
        randomUUID(),
        { photoId, versionId },
        'invite revoked replay body',
      );
      await db
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(inviteRevokedBundle.invite.id, owner, ownerSession.id)
        .run();
      await expectDenied(
        await send(worker, commentsPath(photoId, versionId), {
          secret: inviteGuest.secret,
        }),
      );
      await expectDenied(
        await createCommand(
          inviteGuest,
          inviteWrite.requestId,
          [inviteWrite.target],
          inviteWrite.body,
        ),
      );

      const sessionRevokedBundle = await createInviteWithGuests(canComment, [
        'Session revoked comment guest',
      ]);
      const sessionGuest = sessionRevokedBundle.guests[0];
      const sessionWrite = await createSingle(
        sessionGuest,
        randomUUID(),
        { photoId, versionId },
        'session revoked replay body',
      );
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(sessionGuest.sessionId, hashGuestSession(sessionGuest.secret))
        .run();
      await expectDenied(
        await send(worker, commentsPath(photoId, versionId), {
          secret: sessionGuest.secret,
        }),
      );
      await expectDenied(
        await createCommand(
          sessionGuest,
          sessionWrite.requestId,
          [sessionWrite.target],
          sessionWrite.body,
        ),
      );

      const ownerDisabledBundle = await createInviteWithGuests(canComment, [
        'Owner disabled comment guest',
      ]);
      const disabledGuest = ownerDisabledBundle.guests[0];
      const disabledWrite = await createSingle(
        disabledGuest,
        randomUUID(),
        { photoId, versionId },
        'owner disabled replay body',
      );
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectDenied(
          await send(worker, commentsPath(photoId, versionId), {
            secret: disabledGuest.secret,
          }),
        );
        await expectDenied(
          await createCommand(
            disabledGuest,
            disabledWrite.requestId,
            [disabledWrite.target],
            disabledWrite.body,
          ),
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }

      const expiry = Date.now() + 2600;
      const expiringBundle = await createInviteWithGuests(
        canComment,
        ['Expired comment guest'],
        expiry,
      );
      const expiringGuest = expiringBundle.guests[0];
      const expiryWrite = await createSingle(
        expiringGuest,
        randomUUID(),
        { photoId, versionId },
        'expired replay body',
      );
      await new Promise((resolve) => setTimeout(resolve, 2750));
      await expectDenied(
        await send(worker, commentsPath(photoId, versionId), {
          secret: expiringGuest.secret,
        }),
      );
      await expectDenied(
        await createCommand(
          expiringGuest,
          expiryWrite.requestId,
          [expiryWrite.target],
          expiryWrite.body,
        ),
      );

      const shortSessionInvite = await createInvite({ mask: canComment });
      const shortSessionGuest = await createGuest(
        shortSessionInvite,
        'Short session comment guest',
        { expiresAtMs: Date.now() + 1900 },
      );
      const shortSessionWrite = await createSingle(
        shortSessionGuest,
        randomUUID(),
        { photoId, versionId },
        'expired session replay body',
      );
      await new Promise((resolve) => setTimeout(resolve, 2050));
      await expectDenied(
        await send(worker, commentsPath(photoId, versionId), {
          secret: shortSessionGuest.secret,
        }),
      );
      await expectDenied(
        await createCommand(
          shortSessionGuest,
          shortSessionWrite.requestId,
          [shortSessionWrite.target],
          shortSessionWrite.body,
        ),
      );
    },
  );

  return {
    albumId,
    photoId,
    versionId,
    currentVersionId: versionFixture.currentVersionId,
    filename: versionFixture.filename,
    neighborPhotoId,
    neighborVersionId,
    neighborFilename,
    secretAuthor: browserAuthor.secret,
    secretPeer: browserPeer.secret,
    secretOtherInvite: other.secret,
    authorGuestId: browserAuthor.guestId,
    peerGuestId: browserPeer.guestId,
    otherGuestId: other.guestId,
    authorInviteId: browser.invite.id,
    authorSessionId: browserAuthor.sessionId,
    otherInviteId: otherInvite.invite.id,
    secretRecoveryBrowser: recoveryBrowserAuthor.secret,
    recoveryBrowserGuestId: recoveryBrowserAuthor.guestId,
    recoveryBrowserInviteId: recoveryBrowser.invite.id,
    browserBatchResult,
    batchTargets,
    commentOnlySecret: author.secret,
    commentOnlyGuestId: author.guestId,
    commentOnlyInviteId: commentOnly.invite.id,
    workerName: 'guest-comments-test',
    disabledWorker,
  };
}
