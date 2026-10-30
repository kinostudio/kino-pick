import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  guestAnnotationResultSchema,
  guestAnnotationsPageSchema,
} from '../../../packages/contracts/src/guest-annotations.ts';
import { guestSharedAnnotationsPageSchema } from '../../../packages/contracts/src/annotation-threads.ts';
import { ownerAnnotationResultSchema } from '../../../packages/contracts/src/owner-annotation-authoring.ts';

const canAnnotate = 128;
const canComment = 256;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function guestSharedAnnotationChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  request,
  annotationFixture,
}) {
  const fixture = annotationFixture;
  assert.ok(fixture?.inviteId && fixture?.albumId && fixture?.photoId);
  assert.ok(fixture?.versionId && fixture?.annotationId);
  assert.ok(fixture?.authorGuestId && fixture?.peerGuestId);
  assert.ok(fixture?.secretAuthor && fixture?.secretPeer);
  assert.ok(fixture?.peerAnnotationId && fixture?.otherInviteAnnotationId);
  assert.ok(fixture?.otherInviteId && fixture?.secretOtherInvite);
  assert.equal(typeof fixture.createScopedGuestBundle, 'function');
  assert.equal(typeof request, 'function');
  assert.ok(owner);
  assert.equal(typeof cookies?.headers, 'function');

  const worker = await mf.getWorker(
    fixture.workerName ?? 'guest-annotations-test',
  );
  const disabledWorker = await mf.getWorker('app');
  const ownerWorker = await mf.getWorker('owner-annotation-authoring-test');
  const albumId = fixture.albumId;
  const photoId = fixture.photoId;
  const versionId = fixture.versionId;
  const origin = new URL(base).origin;
  const ownerCookie = cookies.headers();

  const sharedPath = (targetPhotoId = photoId, targetVersionId = versionId) =>
    '/api/guest/albums/' +
    albumId +
    '/photos/' +
    targetPhotoId +
    '/versions/' +
    targetVersionId +
    '/annotations/shared';
  const ownPath = (targetPhotoId = photoId, targetVersionId = versionId) =>
    '/api/guest/albums/' +
    albumId +
    '/photos/' +
    targetPhotoId +
    '/versions/' +
    targetVersionId +
    '/annotations/own';
  const commandPath = '/api/guest/albums/' + albumId + '/annotations/commands';

  const sendGuest = (
    targetWorker,
    path,
    { method = 'GET', secret, body } = {},
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

  const sendOwner = (path, body) =>
    ownerWorker.fetch(
      new Request(new URL(path, base), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Cookie: ownerCookie,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'manual',
      }),
    );

  const readJson = async (response) => {
    const text = await response.text();
    return { text, value: parseJson(text), status: response.status };
  };

  const counts = async () => {
    const row = await db
      .prepare(
        "SELECT (SELECT count(*) FROM guest_annotation_commands) AS commands,(SELECT count(*) FROM guest_annotations) AS annotations,(SELECT count(*) FROM guest_annotation_changes) AS changes,(SELECT count(*) FROM guest_annotation_results) AS results,(SELECT count(*) FROM audit_events WHERE action LIKE 'annotation.%') AS audits",
      )
      .first();
    assert.ok(row);
    return row;
  };

  const checkedRead = async (targetWorker, path, guest, expectedStatus) => {
    const before = await counts();
    const response = await sendGuest(targetWorker, path, {
      secret: guest?.secret,
    });
    const result = await readJson(response);
    const after = await counts();
    assert.deepEqual(after, before, 'shared annotation GET wrote ledger rows');
    if (expectedStatus !== undefined)
      assert.equal(
        result.status,
        expectedStatus,
        typeof result.value === 'string'
          ? result.value
          : JSON.stringify(result.value),
      );
    return result;
  };

  const readSharedPage = async (guest, options = {}) => {
    const path =
      sharedPath(options.photoId, options.versionId) + (options.query ?? '');
    const result = await checkedRead(worker, path, guest, 200);
    return {
      ...result,
      page: guestSharedAnnotationsPageSchema.parse(result.value),
    };
  };

  const expectedError = async (targetWorker, path, guest, status, code) => {
    const result = await checkedRead(targetWorker, path, guest, status);
    assert.equal(result.value?.error?.code, code, JSON.stringify(result.value));
    return result.value;
  };

  const guestFrom = (bundle, index = 0) => {
    const guest = bundle.guests?.[index] ?? bundle.guest;
    assert.ok(bundle.invite?.id && guest?.guestId && guest?.secret);
    return { ...guest, inviteId: bundle.invite.id };
  };

  const createAnnotation = async (guest, index, commentId = null) => {
    const body = {
      requestId: randomUUID(),
      expectedGuestId: guest.guestId,
      operation: 'create',
      photoId,
      versionId,
      geometry: {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 100_000 + (index % 700) * 1_000,
        y: 150_000 + (index % 700) * 1_000,
      },
      style: { color: index % 2 === 0 ? 'amber' : 'blue' },
      commentId,
    };
    const response = await sendGuest(worker, commandPath, {
      method: 'POST',
      secret: guest.secret,
      body,
    });
    const result = await readJson(response);
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    const parsed = guestAnnotationResultSchema.parse(result.value);
    assert.equal(parsed.item.isMine, true);
    return parsed.item;
  };

  const createOwnerAnnotation = async (targetInviteId, index) => {
    const response = await sendOwner(
      '/api/v1/albums/' + albumId + '/annotations/owner/commands',
      {
        requestId: randomUUID(),
        expectedOwnerId: owner,
        operation: 'create',
        inviteId: targetInviteId,
        photoId,
        versionId,
        geometry: {
          type: 'point',
          coordinateSpace: 'normalized_1e6',
          x: 760_000 + (index % 100) * 1_000,
          y: 220_000 + (index % 100) * 1_000,
        },
        style: { color: 'red' },
        commentId: null,
      },
    );
    const result = await readJson(response);
    assert.equal(
      result.status,
      200,
      typeof result.value === 'string'
        ? result.value
        : JSON.stringify(result.value),
    );
    const parsed = ownerAnnotationResultSchema.parse(result.value);
    assert.equal(parsed.item.authorType, 'owner');
    assert.equal(parsed.item.authorLabel, '攝影師');
    return parsed.item;
  };

  const updateAnnotation = async (
    guest,
    item,
    expectedRevision = item.revision,
  ) => {
    assert.ok(item.geometry && item.style);
    const body = {
      requestId: randomUUID(),
      expectedGuestId: guest.guestId,
      operation: 'update',
      annotationId: item.annotationId,
      expectedRevision,
      geometry: {
        type: 'point',
        coordinateSpace: 'normalized_1e6',
        x: 710_000,
        y: 620_000,
      },
      style: { color: 'red' },
      commentId: item.commentId,
    };
    const response = await sendGuest(worker, commandPath, {
      method: 'POST',
      secret: guest.secret,
      body,
    });
    return readJson(response);
  };

  const assertNoPeerIdentityOrPrivateFields = (page, raw, currentGuestId) => {
    guestSharedAnnotationsPageSchema.parse(page);
    assert.equal(page.guestId, currentGuestId);
    assert.equal(page.photoId, photoId);
    assert.equal(page.versionId, versionId);
    for (const item of page.items) {
      assert.deepEqual(Object.keys(item).sort(), [
        'annotationId',
        'authorLabel',
        'authorType',
        'commentId',
        'createdAt',
        'geometry',
        'isMine',
        'photoId',
        'processing',
        'revision',
        'state',
        'style',
        'updatedAt',
        'versionId',
      ]);
      if (item.authorType === 'owner') assert.equal(item.processing, null);
      else
        assert.deepEqual(item.processing, {
          state: 'open',
          revision: 0,
          annotationRevision: null,
          contentRevision: null,
          updatedAt: null,
          stale: false,
        });
      assert.equal('authorGuestId' in item, false);
      assert.equal('guestSecret' in item, false);
      assert.equal('secret' in item, false);
      assert.equal('mediaUrl' in item, false);
      assert.equal('r2Key' in item, false);
    }
    assert.equal(raw.includes('https://'), false);
    assert.equal(raw.includes(fixture.secretAuthor), false);
    assert.equal(raw.includes(fixture.secretPeer), false);
    assert.equal(raw.includes(fixture.secretOtherInvite), false);
    assert.equal(raw.includes(fixture.inviteToken), false);
    assert.equal(raw.includes(owner), false);
  };

  const author = {
    guestId: fixture.authorGuestId,
    secret: fixture.secretAuthor,
  };
  const peer = {
    guestId: fixture.peerGuestId,
    secret: fixture.secretPeer,
  };
  const otherInviteGuest = {
    guestId: fixture.otherGuestId,
    secret: fixture.secretOtherInvite,
  };

  await check(
    'Shared annotation reads are gated by can_annotate and the existing hard-local feature flag',
    async () => {
      await expectedError(
        disabledWorker,
        sharedPath(),
        author,
        503,
        'GUEST_ANNOTATIONS_UNAVAILABLE',
      );
      const noAnnotationBundle = await fixture.createScopedGuestBundle(
        canComment,
        ['Shared reader without annotation permission'],
      );
      const noAnnotationGuest = guestFrom(noAnnotationBundle);
      await expectedError(
        worker,
        sharedPath(),
        noAnnotationGuest,
        401,
        'GUEST_ACCESS_REQUIRED',
      );
      const annotationOnlyBundle = await fixture.createScopedGuestBundle(
        canAnnotate,
        ['Shared reader with annotation permission only'],
      );
      const annotationOnlyGuest = guestFrom(annotationOnlyBundle);
      const page = await readSharedPage(annotationOnlyGuest);
      assert.deepEqual(page.page.items, []);
      assert.equal(page.page.guestId, annotationOnlyGuest.guestId);
    },
  );

  await check(
    'Shared annotation pages show all authors in one invite and derive isMine per viewer without private fields or read writes',
    async () => {
      const authorResult = await readSharedPage(author);
      const peerResult = await readSharedPage(peer);
      const authorPage = authorResult.page;
      const peerPage = peerResult.page;
      assert.ok(authorPage.items.length >= 2);
      const authorItem = authorPage.items.find(
        (item) => item.annotationId === fixture.annotationId,
      );
      const peerItem = authorPage.items.find(
        (item) => item.annotationId === fixture.peerAnnotationId,
      );
      assert.ok(authorItem && peerItem);
      assert.equal(authorItem.isMine, true);
      assert.equal(peerItem.isMine, false);
      assert.equal(authorItem.authorLabel, fixture.authorLabel);
      assert.equal(peerItem.authorLabel, fixture.peerAuthorLabel);
      assertNoPeerIdentityOrPrivateFields(
        authorPage,
        authorResult.text,
        fixture.authorGuestId,
      );

      const peerOwnItem = peerPage.items.find(
        (item) => item.annotationId === fixture.peerAnnotationId,
      );
      const peerViewOfAuthor = peerPage.items.find(
        (item) => item.annotationId === fixture.annotationId,
      );
      assert.ok(peerOwnItem && peerViewOfAuthor);
      assert.equal(peerOwnItem.isMine, true);
      assert.equal(peerViewOfAuthor.isMine, false);
      assert.equal(peerPage.guestId, fixture.peerGuestId);
      assertNoPeerIdentityOrPrivateFields(
        peerPage,
        peerResult.text,
        fixture.peerGuestId,
      );
      assert.equal(
        authorResult.text.includes(fixture.peerGuestId),
        false,
        'peer Guest id appeared in shared response',
      );
      assert.equal(
        peerResult.text.includes(fixture.authorGuestId),
        false,
        'peer author Guest id appeared in shared response',
      );
    },
  );

  await check(
    'Shared annotation reads stay isolated to the authenticated invite and hide foreign targeted rows',
    async () => {
      const hiddenTarget = await readSharedPage(author, {
        query:
          '?annotationId=' +
          encodeURIComponent(fixture.otherInviteAnnotationId),
      });
      assert.deepEqual(hiddenTarget.page.items, []);
      const otherPage = await readSharedPage(otherInviteGuest);
      assert.ok(
        otherPage.page.items.some(
          (item) => item.annotationId === fixture.otherInviteAnnotationId,
        ),
      );
      assert.equal(
        otherPage.page.items.some(
          (item) =>
            item.annotationId === fixture.annotationId ||
            item.annotationId === fixture.peerAnnotationId,
        ),
        false,
      );
    },
  );

  await check(
    'Shared visibility does not grant peer writes and author revisions remain CAS guarded',
    async () => {
      const page = await readSharedPage(author);
      const peerItem = page.page.items.find(
        (item) => item.annotationId === fixture.peerAnnotationId,
      );
      const authorItem = page.page.items.find(
        (item) => item.annotationId === fixture.annotationId,
      );
      assert.ok(peerItem && authorItem);
      const before = await counts();

      const peerWrite = await updateAnnotation(peer, authorItem);
      assert.equal(
        peerWrite.status,
        401,
        typeof peerWrite.value === 'string'
          ? peerWrite.value
          : JSON.stringify(peerWrite.value),
      );
      assert.equal(peerWrite.value?.error?.code, 'GUEST_ACCESS_REQUIRED');

      const staleAuthorWrite = await updateAnnotation(
        author,
        authorItem,
        authorItem.revision + 1,
      );
      assert.equal(
        staleAuthorWrite.status,
        409,
        typeof staleAuthorWrite.value === 'string'
          ? staleAuthorWrite.value
          : JSON.stringify(staleAuthorWrite.value),
      );
      assert.equal(
        staleAuthorWrite.value?.error?.code,
        'ANNOTATION_REVISION_CONFLICT',
      );
      assert.deepEqual(await counts(), before);
    },
  );

  await check(
    'Shared pagination uses independent Guest and Owner watermarks and a session-bound cursor namespace',
    async () => {
      const bundle = await fixture.createScopedGuestBundle(canAnnotate, [
        'Shared pagination author',
        'Shared pagination peer',
      ]);
      const pageAuthor = guestFrom(bundle, 0);
      const pagePeer = guestFrom(bundle, 1);
      const generated = [];
      for (let index = 0; index < 25; index += 1) {
        generated.push(await createAnnotation(pageAuthor, index + 1));
      }
      generated.push(await createAnnotation(pagePeer, 26));

      const authorFirst = await readSharedPage(pageAuthor);
      assert.equal(authorFirst.page.items.length, 24);
      assert.ok(authorFirst.page.nextCursor);
      const cursor = authorFirst.page.nextCursor;
      const ownFirstResult = await checkedRead(
        worker,
        ownPath() + '?cursor=' + encodeURIComponent(cursor),
        pageAuthor,
        400,
      );
      assert.equal(
        ownFirstResult.value?.error?.code,
        'INVALID_INPUT',
        'shared cursor was accepted by own-author reader',
      );

      const ownResponse = await sendGuest(worker, ownPath() + '?limit=1', {
        secret: pageAuthor.secret,
      });
      const ownBody = await readJson(ownResponse);
      assert.equal(ownBody.status, 400);
      assert.equal(ownBody.value?.error?.code, 'INVALID_INPUT');

      const ownCursorPage = await checkedRead(
        worker,
        ownPath(),
        pageAuthor,
        200,
      );
      const ownPage = guestAnnotationsPageSchema.parse(ownCursorPage.value);
      assert.equal(ownPage.items.length, 24);
      assert.ok(ownPage.nextCursor);

      const sharedFromOwnCursor = await checkedRead(
        worker,
        sharedPath() +
          '?cursor=' +
          encodeURIComponent(ownPage.nextCursor ?? ''),
        pageAuthor,
        400,
      );
      assert.equal(
        sharedFromOwnCursor.value?.error?.code,
        'INVALID_INPUT',
        'own-author cursor was accepted by shared reader',
      );

      const peerCrossCursor = await checkedRead(
        worker,
        sharedPath() + '?cursor=' + encodeURIComponent(cursor),
        pagePeer,
        400,
      );
      assert.equal(peerCrossCursor.value?.error?.code, 'INVALID_INPUT');

      const ownerItem = await createOwnerAnnotation(pageAuthor.inviteId, 27);
      const ownerTarget =
        '?annotationId=' + encodeURIComponent(ownerItem.annotationId);
      const ownerAuthorView = await readSharedPage(pageAuthor, {
        query: ownerTarget,
      });
      const ownerPeerView = await readSharedPage(pagePeer, {
        query: ownerTarget,
      });
      for (const page of [ownerAuthorView.page, ownerPeerView.page]) {
        assert.equal(page.items.length, 1);
        assert.equal(page.items[0].authorType, 'owner');
        assert.equal(page.items[0].authorLabel, '攝影師');
        assert.equal(page.items[0].isMine, false);
        assert.equal('authorGuestId' in page.items[0], false);
        assert.equal('authorUserId' in page.items[0], false);
      }
      assert.equal(ownerAuthorView.text.includes(owner), false);
      assert.equal(ownerPeerView.text.includes(owner), false);
      await expectedError(
        worker,
        sharedPath() + '?cursor=' + encodeURIComponent(cursor),
        pageAuthor,
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );

      const freshAuthorPage = await readSharedPage(pageAuthor);
      assert.ok(freshAuthorPage.page.nextCursor);

      const foreignPhoto = await checkedRead(
        worker,
        sharedPath(randomUUID(), versionId),
        pageAuthor,
        401,
      );
      assert.equal(foreignPhoto.value?.error?.code, 'GUEST_ACCESS_REQUIRED');

      const peerItem = generated[25];
      assert.ok(peerItem);
      const peerUpdate = await updateAnnotation(pagePeer, peerItem);
      assert.equal(peerUpdate.status, 200, JSON.stringify(peerUpdate.value));
      const parsedPeerUpdate = guestAnnotationResultSchema.parse(
        peerUpdate.value,
      );
      assert.equal(parsedPeerUpdate.item.revision, peerItem.revision + 1);
      await expectedError(
        worker,
        sharedPath() +
          '?cursor=' +
          encodeURIComponent(freshAuthorPage.page.nextCursor ?? ''),
        pageAuthor,
        409,
        'ANNOTATION_HISTORY_CHANGED',
      );
    },
  );

  await check(
    'Shared annotation reads deny revoked and naturally expired Guest grants',
    async () => {
      const revokedBundle = await fixture.createScopedGuestBundle(canAnnotate, [
        'Shared revoked annotation author',
        'Shared revoked annotation peer',
      ]);
      const revokedAuthor = guestFrom(revokedBundle, 0);
      const revokedPeer = guestFrom(revokedBundle, 1);
      const revokedItem = await createAnnotation(revokedAuthor, 81);
      const beforeRevoke = await readSharedPage(revokedPeer);
      assert.ok(
        beforeRevoke.page.items.some(
          (item) => item.annotationId === revokedItem.annotationId,
        ),
      );
      const revokeResponse = await sendOwner(
        '/api/v1/invites/' + revokedBundle.invite.id + '/revoke',
        { requestId: randomUUID(), confirmRevoke: true },
      );
      const revokeResult = await readJson(revokeResponse);
      assert.equal(
        revokeResult.status,
        200,
        typeof revokeResult.value === 'string'
          ? revokeResult.value
          : JSON.stringify(revokeResult.value),
      );
      await expectedError(
        worker,
        sharedPath(),
        revokedPeer,
        401,
        'GUEST_ACCESS_REQUIRED',
      );

      const expiresAtMs = Date.now() + 5_000;
      const expiredBundle = await fixture.createScopedGuestBundle(
        canAnnotate,
        ['Shared expiring annotation author'],
        expiresAtMs,
      );
      const expiredGuest = guestFrom(expiredBundle);
      const expiredItem = await createAnnotation(expiredGuest, 82);
      const preExpiry = await readSharedPage(expiredGuest);
      assert.ok(
        preExpiry.page.items.some(
          (item) => item.annotationId === expiredItem.annotationId,
        ),
      );

      let inviteExpired = false;
      const waitDeadline = Date.now() + 6_500;
      while (!inviteExpired && Date.now() < waitDeadline) {
        const state = await db
          .prepare(
            "SELECT CASE WHEN expires_at_ms<=CAST(unixepoch('subsec')*1000 AS INTEGER) THEN 1 ELSE 0 END AS expired FROM guest_invites WHERE id=?",
          )
          .bind(expiredBundle.invite.id)
          .first();
        inviteExpired = Number(state?.expired) === 1;
        if (!inviteExpired)
          await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(inviteExpired, true, 'invite did not expire by D1 clock');
      await expectedError(
        worker,
        sharedPath(),
        expiredGuest,
        401,
        'GUEST_ACCESS_REQUIRED',
      );
    },
  );

  await check(
    'Shared annotation query parsing is strict and rejects duplicate, mixed, and unknown selectors',
    async () => {
      await expectedError(
        worker,
        sharedPath() + '?cursor=a&cursor=b',
        author,
        400,
        'INVALID_INPUT',
      );
      await expectedError(
        worker,
        sharedPath() +
          '?cursor=a&annotationId=' +
          encodeURIComponent(fixture.annotationId),
        author,
        400,
        'INVALID_INPUT',
      );
      await expectedError(
        worker,
        sharedPath() + '?authorGuestId=' + fixture.peerGuestId,
        author,
        400,
        'INVALID_INPUT',
      );
      await expectedError(
        worker,
        sharedPath() + '?annotationId=not-a-uuid',
        author,
        400,
        'INVALID_INPUT',
      );
      await expectedError(
        worker,
        sharedPath(),
        { guestId: author.guestId },
        401,
        'GUEST_ACCESS_REQUIRED',
      );
    },
  );
}
