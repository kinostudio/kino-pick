import { makeSignature } from 'better-auth/crypto';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ownerAnnotationItemSchema,
  ownerAnnotationsCapabilitiesSchema,
  ownerAnnotationsPageSchema,
} from '../../../packages/contracts/src/owner-annotations.ts';
import { guestAnnotationResultSchema } from '../../../packages/contracts/src/guest-annotations.ts';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function ownerAnnotationChecks({
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
  assert.ok(fixture?.peerAnnotationId && fixture?.peerAuthorGuestId);
  assert.ok(fixture?.peerGuestSecret && fixture?.peerGuestSessionId);
  assert.ok(fixture?.otherInviteId && fixture?.otherInviteAnnotationId);
  assert.equal(typeof request, 'function');
  assert.equal(typeof cookies?.headers, 'function');

  const ownerWorker = await mf.getWorker('owner-annotations-test');
  const guestWorker = await mf.getWorker(
    fixture.workerName ?? 'guest-annotations-test',
  );
  const disabledWorker = await mf.getWorker('app');
  const ownerCookie = cookies.headers();
  const { albumId, photoId, versionId } = fixture;
  const inviteId = fixture.inviteId;
  const origin = new URL(base).origin;
  const capabilitiesPath = '/api/v1/annotations/capabilities';
  const ownerPath = (targetInviteId, options = {}) => {
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
  const guestOwnPath = (
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

  const ownerSend = (
    targetWorker,
    path,
    {
      method = 'GET',
      body,
      includeCookie = true,
      cookie = ownerCookie,
      omitOrigin = false,
      extraHeaders = {},
    } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    if (includeCookie && cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') {
      if (!omitOrigin) headers.Origin = origin;
      headers['Content-Type'] = 'application/json';
    }
    Object.assign(headers, extraHeaders);
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return targetWorker.fetch(new Request(new URL(path, base), init));
  };
  const guestSend = (
    targetWorker,
    path,
    { method = 'GET', body, secret, omitOrigin = false } = {},
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
      if (!omitOrigin) headers.Origin = origin;
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
  const readOwnerPage = async (targetInviteId, options = {}) => {
    const response = await ownerSend(
      options.targetWorker ?? ownerWorker,
      ownerPath(targetInviteId, options),
      { cookie: options.cookie ?? ownerCookie },
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return ownerAnnotationsPageSchema.parse(body);
  };
  const readGuestPage = async (
    guest,
    targetPhotoId = photoId,
    targetVersionId = versionId,
    annotationId,
  ) => {
    const response = await guestSend(
      guestWorker,
      guestOwnPath(targetPhotoId, targetVersionId, annotationId),
      { secret: guest.secret },
    );
    const body = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const counts = async () => {
    const row = await db
      .prepare(
        "SELECT (SELECT count(*) FROM guest_annotation_commands) AS commands,(SELECT count(*) FROM guest_annotations) AS annotations,(SELECT count(*) FROM guest_annotation_changes) AS changes,(SELECT count(*) FROM guest_annotation_results) AS results,(SELECT count(*) FROM audit_events WHERE action LIKE 'annotation.%') AS annotationAudit",
      )
      .first();
    assert.ok(row);
    return row;
  };
  const createGuestAnnotation = async (guest, index) => {
    const body = {
      requestId: randomUUID(),
      expectedGuestId: guest.guestId,
      operation: 'create',
      photoId,
      versionId,
      geometry: {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 100_000 + index * 1000,
        y: 200_000 + index * 1000,
      },
      style: { color: index % 2 === 0 ? 'amber' : 'blue' },
      commentId: null,
    };
    const response = await guestSend(
      guestWorker,
      '/api/guest/albums/' + albumId + '/annotations/commands',
      { method: 'POST', secret: guest.secret, body },
    );
    const value = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(value));
    const result = guestAnnotationResultSchema.parse(value);
    if (guest.label !== undefined)
      assert.equal(result.item.authorLabel, guest.label);
    return result.item;
  };
  const updateGuestAnnotation = async (
    guest,
    annotationId,
    expectedRevision,
  ) => {
    const response = await guestSend(
      guestWorker,
      '/api/guest/albums/' + albumId + '/annotations/commands',
      {
        method: 'POST',
        secret: guest.secret,
        body: {
          requestId: randomUUID(),
          expectedGuestId: guest.guestId,
          operation: 'update',
          annotationId,
          expectedRevision,
          geometry: {
            type: 'rectangle',
            coordinateSpace: 'normalized_1e6',
            x: 300_000,
            y: 300_000,
            width: 100_000,
            height: 100_000,
          },
          style: { color: 'red' },
          commentId: null,
        },
      },
    );
    const value = await readJson(response);
    assert.equal(response.status, 200, JSON.stringify(value));
    return guestAnnotationResultSchema.parse(value).item;
  };

  await check(
    'Owner annotation reads are independently gated, current-session authenticated, and strictly scoped',
    async () => {
      const enabledResponse = await ownerSend(ownerWorker, capabilitiesPath);
      const enabledBody = await readJson(enabledResponse);
      assert.equal(enabledResponse.status, 200, JSON.stringify(enabledBody));
      assert.deepEqual(ownerAnnotationsCapabilitiesSchema.parse(enabledBody), {
        enabled: true,
      });
      assert.deepEqual(
        await readJson(
          await ownerSend(ownerWorker, '/api/guest/annotations/capabilities'),
        ),
        { enabled: false },
      );
      assert.deepEqual(
        await readJson(
          await ownerSend(ownerWorker, '/api/v1/comments/capabilities'),
        ),
        { enabled: false },
      );

      const disabledResponse = await ownerSend(
        disabledWorker,
        capabilitiesPath,
      );
      const disabledBody = await readJson(disabledResponse);
      assert.equal(disabledResponse.status, 200, JSON.stringify(disabledBody));
      assert.deepEqual(ownerAnnotationsCapabilitiesSchema.parse(disabledBody), {
        enabled: false,
      });
      await expectError(
        await ownerSend(ownerWorker, ownerPath(inviteId), {
          includeCookie: false,
        }),
        401,
        'AUTH_REQUIRED',
      );
      await expectError(
        await ownerSend(disabledWorker, ownerPath(inviteId)),
        503,
        'OWNER_ANNOTATIONS_DISABLED',
      );
      await expectError(
        await ownerSend(ownerWorker, ownerPath(inviteId) + '&actorId=' + owner),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(
          ownerWorker,
          ownerPath(inviteId) + '&inviteId=' + inviteId,
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(
          ownerWorker,
          ownerPath(inviteId) +
            '&cursor=x&annotationId=' +
            fixture.annotationId,
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(
          ownerWorker,
          ownerPath(inviteId, { photoId: randomUUID() }),
        ),
        404,
        'NOT_FOUND',
      );

      // Resource UUIDs retain their exact SQLite identity; only request IDs
      // have canonical case. A differently cased resource must not alias it.
      if (inviteId.toUpperCase() !== inviteId) {
        await expectError(
          await ownerSend(ownerWorker, ownerPath(inviteId.toUpperCase())),
          404,
          'NOT_FOUND',
        );
      }
      if (photoId.toUpperCase() !== photoId) {
        await expectError(
          await ownerSend(
            ownerWorker,
            ownerPath(inviteId, { photoId: photoId.toUpperCase() }),
          ),
          404,
          'NOT_FOUND',
        );
      }

      const noGrantBundle = await fixture.createScopedGuestBundle(0, [
        'Owner no Guest annotation grant',
      ]);
      const noGrantInviteId = noGrantBundle.invite.id;
      const noGrantPage = await readOwnerPage(noGrantInviteId);
      assert.deepEqual(noGrantPage.items, []);

      const unsupportedPost = await ownerSend(
        ownerWorker,
        ownerPath(inviteId),
        { method: 'POST', body: {} },
      );
      await expectError(unsupportedPost, 404);
    },
  );

  await check(
    'Owner annotation pages expose all authors and retained tombstones without writes or private credentials',
    async () => {
      const before = await counts();
      const page = await readOwnerPage(inviteId);
      const after = await counts();
      assert.deepEqual(after, before);
      assert.equal(page.inviteId, inviteId);
      assert.equal(page.photoId, photoId);
      assert.equal(page.versionId, versionId);
      assert.ok(page.items.length >= 2);
      if (fixture.draftVersionId) {
        const privateDraft = await readOwnerPage(inviteId, {
          versionId: fixture.draftVersionId,
        });
        assert.equal(privateDraft.versionId, fixture.draftVersionId);
        assert.deepEqual(privateDraft.items, []);
      }

      const primary = page.items.find(
        (item) => item.annotationId === fixture.annotationId,
      );
      const peer = page.items.find(
        (item) => item.annotationId === fixture.peerAnnotationId,
      );
      assert.ok(primary);
      assert.ok(peer);
      assert.equal(primary.authorGuestId, fixture.authorGuestId);
      assert.equal(primary.authorLabel, fixture.authorLabel);
      assert.notEqual(primary.state, 'deleted');
      assert.ok(primary.geometry && primary.style);
      assert.equal(peer.authorGuestId, fixture.peerAuthorGuestId);
      assert.equal(peer.authorLabel, fixture.peerAuthorLabel);
      assert.notEqual(peer.state, 'deleted');
      assert.ok(peer.geometry && peer.style);
      for (const item of [primary, peer]) {
        ownerAnnotationItemSchema.parse(item);
        assert.equal(item.canEdit, false);
        assert.deepEqual(item.processing, {
          state: 'open',
          revision: 0,
          annotationRevision: null,
          contentRevision: null,
          updatedAt: null,
          stale: false,
        });
        assert.equal('isMine' in item, false);
        assert.deepEqual(
          Object.keys(item).sort(),
          [
            'annotationId',
            'authorGuestId',
            'authorLabel',
            'canEdit',
            'commentId',
            'createdAt',
            'geometry',
            'photoId',
            'processing',
            'revision',
            'state',
            'style',
            'updatedAt',
            'versionId',
          ].sort(),
        );
        if (item.state === 'deleted') {
          assert.equal(item.geometry, null);
          assert.equal(item.style, null);
          assert.equal(item.commentId, null);
        }
      }
      const targeted = await readOwnerPage(inviteId, {
        annotationId: fixture.annotationId,
      });
      assert.equal(targeted.items.length, 1);
      assert.equal(targeted.items[0].annotationId, fixture.annotationId);

      const serialized = JSON.stringify(page);
      for (const privateValue of [
        fixture.guestSecret,
        fixture.guestSessionId,
        fixture.peerGuestSecret,
        fixture.peerGuestSessionId,
        fixture.inviteToken,
        'secret_hash',
        'object_key',
        'originalUrl',
        'previewUrl',
      ])
        if (privateValue)
          assert.equal(serialized.includes(privateValue), false);

      const wrongInviteTarget = await readOwnerPage(fixture.otherInviteId, {
        annotationId: fixture.annotationId,
      });
      assert.deepEqual(wrongInviteTarget.items, []);
      const otherInviteTarget = await readOwnerPage(inviteId, {
        annotationId: fixture.otherInviteAnnotationId,
      });
      assert.deepEqual(otherInviteTarget.items, []);
      const unknownTarget = await readOwnerPage(inviteId, {
        annotationId: randomUUID(),
      });
      assert.deepEqual(unknownTarget.items, []);

      const guestOwn = await readGuestPage(
        { secret: fixture.guestSecret },
        photoId,
        versionId,
        fixture.peerAnnotationId,
      );
      assert.deepEqual(guestOwn.items, []);
    },
  );

  await check(
    'Owner annotation pages paginate by immutable scope watermark and detect Guest updates',
    async () => {
      const authors = [
        {
          guestId: fixture.authorGuestId,
          secret: fixture.guestSecret,
          label: fixture.authorLabel,
        },
        {
          guestId: fixture.peerAuthorGuestId,
          secret: fixture.peerGuestSecret,
          label: fixture.peerAuthorLabel,
        },
      ];
      const created = [];
      for (let index = 0; index < 25; index += 1)
        created.push(await createGuestAnnotation(authors[index % 2], index));

      const first = await readOwnerPage(inviteId);
      assert.equal(first.items.length, 24);
      assert.ok(first.nextCursor);
      assert.ok(
        first.items.some(
          (item) => item.authorGuestId === fixture.authorGuestId,
        ),
      );
      assert.ok(
        first.items.some(
          (item) => item.authorGuestId === fixture.peerAuthorGuestId,
        ),
      );
      const second = await readOwnerPage(inviteId, {
        cursor: first.nextCursor,
      });
      assert.ok(second.items.length >= 1);
      assert.equal(second.nextCursor, null);
      assert.equal(
        new Set(
          [...first.items, ...second.items].map((item) => item.annotationId),
        ).size,
        first.items.length + second.items.length,
      );

      const changed = await updateGuestAnnotation(
        authors[0],
        created[0].annotationId,
        1,
      );
      assert.equal(changed.revision, 2);
      await expectError(
        await ownerSend(
          ownerWorker,
          ownerPath(inviteId, { cursor: first.nextCursor }),
        ),
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );
      const badScope = await ownerSend(
        ownerWorker,
        ownerPath(fixture.otherInviteId, { cursor: first.nextCursor }),
      );
      await expectError(badScope, 400, 'INVALID_INPUT');
    },
  );

  await check(
    'Owner retains exact-invitation annotations after expiry and guarded revocation while Guests lose access',
    async () => {
      assert.equal(typeof fixture.createScopedGuestBundle, 'function');
      const expiredAtMs = Date.now() + 5_000;
      const expiredBundle = await fixture.createScopedGuestBundle(
        128,
        ['Owner retained expired annotation'],
        expiredAtMs,
      );
      const expiredInviteId =
        expiredBundle.inviteId ?? expiredBundle.invite?.id;
      const expiredGuest = {
        ...(expiredBundle.guests?.[0] ?? expiredBundle.guest),
        label: 'Owner retained expired annotation',
      };
      assert.ok(expiredInviteId && expiredGuest.secret && expiredGuest.guestId);
      const expiredAnnotation = await createGuestAnnotation(expiredGuest, 31);
      const preExpiryPage = await readGuestPage(expiredGuest);
      assert.ok(
        preExpiryPage.items.some(
          (item) => item.annotationId === expiredAnnotation.annotationId,
        ),
      );
      let inviteExpired = false;
      const expiryWaitDeadline = Date.now() + 6_500;
      while (!inviteExpired && Date.now() < expiryWaitDeadline) {
        const expiryState = await db
          .prepare(
            "SELECT CASE WHEN expires_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER) THEN 1 ELSE 0 END AS expired FROM guest_invites WHERE id=?",
          )
          .bind(expiredInviteId)
          .first();
        inviteExpired = Number(expiryState?.expired) === 1;
        if (!inviteExpired)
          await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(inviteExpired, true, 'invite did not expire by D1 clock');
      const expiredRetained = await readOwnerPage(expiredInviteId, {
        annotationId: expiredAnnotation.annotationId,
      });
      assert.equal(expiredRetained.items.length, 1);
      assert.equal(
        expiredRetained.items[0].annotationId,
        expiredAnnotation.annotationId,
      );
      await expectError(
        await guestSend(guestWorker, guestOwnPath(), {
          secret: expiredGuest.secret,
        }),
        401,
        'GUEST_ACCESS_REQUIRED',
      );

      const revokedBundle = await fixture.createScopedGuestBundle(128, [
        'Owner retained revoked annotation',
      ]);
      const revokedInviteId =
        revokedBundle.inviteId ?? revokedBundle.invite?.id;
      const revokedGuest = {
        ...(revokedBundle.guests?.[0] ?? revokedBundle.guest),
        label: 'Owner retained revoked annotation',
      };
      assert.ok(revokedInviteId && revokedGuest.secret && revokedGuest.guestId);
      const revokedAnnotation = await createGuestAnnotation(revokedGuest, 32);
      const revokeResponse = await ownerSend(
        ownerWorker,
        '/api/v1/invites/' + revokedInviteId + '/revoke',
        {
          method: 'POST',
          body: { requestId: randomUUID(), confirmRevoke: true },
        },
      );
      const revokeBody = await readJson(revokeResponse);
      assert.equal(revokeResponse.status, 200, JSON.stringify(revokeBody));
      const revokedRetained = await readOwnerPage(revokedInviteId, {
        annotationId: revokedAnnotation.annotationId,
      });
      assert.equal(revokedRetained.items.length, 1);
      assert.equal(
        revokedRetained.items[0].annotationId,
        revokedAnnotation.annotationId,
      );
      await expectError(
        await guestSend(guestWorker, guestOwnPath(), {
          secret: revokedGuest.secret,
        }),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
    },
  );

  await check(
    'Owner disablement and an expired fresh session deny annotation reads without changing the OAuth session',
    async () => {
      const authResponse = await request('/api/auth/get-session', {
        headers: { Cookie: ownerCookie },
      });
      const authBody = await readJson(authResponse);
      assert.equal(authResponse.status, 200, JSON.stringify(authBody));
      assert.equal(authBody?.user?.id, owner);
      const primarySessionId = authBody?.session?.id;
      assert.ok(primarySessionId);
      const primaryExpiry = await db
        .prepare('SELECT expiresAt FROM owner_sessions WHERE id=? AND userId=?')
        .bind(primarySessionId, owner)
        .first();
      assert.ok(primaryExpiry?.expiresAt);

      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectError(
          await ownerSend(ownerWorker, ownerPath(inviteId)),
          403,
          'OWNER_REQUIRED',
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }

      assert.equal(typeof authSecret, 'string');
      assert.ok(authSecret.startsWith('synthetic-'));
      const isolatedSessionId = randomUUID();
      const token = 'owner-annotations-expiry:' + randomUUID();
      const now = Date.now();
      await db
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(isolatedSessionId, token, owner, now + 600_000, now, now)
        .run();
      try {
        const cookiePart = ownerCookie
          .split(';')
          .map((value) => value.trim())
          .find((value) =>
            value.slice(0, value.indexOf('=')).endsWith('.session_token'),
          );
        assert.ok(cookiePart);
        const cookieName = cookiePart.slice(0, cookiePart.indexOf('='));
        const isolatedCookie =
          cookieName +
          '=' +
          encodeURIComponent(
            token + '.' + (await makeSignature(token, authSecret)),
          );
        const valid = await readOwnerPage(inviteId, { cookie: isolatedCookie });
        assert.ok(valid.items.length >= 1);
        await db
          .prepare(
            'UPDATE owner_sessions SET expiresAt=0 WHERE id=? AND userId=?',
          )
          .bind(isolatedSessionId, owner)
          .run();
        await expectError(
          await ownerSend(ownerWorker, ownerPath(inviteId), {
            cookie: isolatedCookie,
          }),
          401,
          'AUTH_REQUIRED',
        );
      } finally {
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(isolatedSessionId, owner)
          .run();
      }
      const primarySession = await ownerSend(ownerWorker, '/api/v1/me');
      assert.equal(primarySession.status, 200);
      assert.equal(
        (await readJson(primarySession)).sessionId,
        primarySessionId,
      );
      assert.deepEqual(
        await db
          .prepare(
            'SELECT expiresAt FROM owner_sessions WHERE id=? AND userId=?',
          )
          .bind(primarySessionId, owner)
          .first(),
        primaryExpiry,
      );
    },
  );
}
