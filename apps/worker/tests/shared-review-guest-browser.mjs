import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

async function api(worker, base, path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = {
    Accept: 'application/json',
    Origin: new URL(base).origin,
    'CF-Connecting-IP': options.address ?? '198.51.100.70',
  };
  if (options.ownerCookie)
    headers.Cookie = ownerCookieHeader(options.ownerCookie);
  if (options.guestCookie) headers.Cookie = options.guestCookie;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers,
      ...(options.body !== undefined
        ? {
            body:
              typeof options.body === 'string'
                ? options.body
                : JSON.stringify(options.body),
          }
        : {}),
      redirect: 'manual',
    }),
  );
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function createActiveTestAlbum({ db, project, workspace }) {
  const albumId = randomUUID();
  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,'Shared review browser fixture','active')",
    )
    .bind(albumId, workspace, project)
    .run();
  return albumId;
}

async function seedVersionOneOriginalMetadata({ db, galleryFixture, albumId }) {
  const source = await db
    .prepare(
      'SELECT p.workspace_id,p.project_id,v.created_by_actor,v.source_hash_sha256,' +
        'v.byte_size,v.mime,v.width,v.height,v.status,a.storage_node_id ' +
        'FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1 ' +
        "JOIN photo_assets a ON a.version_id=v.id AND a.asset_kind='original' " +
        'WHERE p.album_id=? ORDER BY p.created_at,p.id LIMIT 1',
    )
    .bind(galleryFixture.context.album.id)
    .first();
  assert.ok(
    source,
    'The shared browser fixture needs one version-1 original asset.',
  );
  const rows = [];
  const ids = [];
  for (let index = 0; index < 31; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    const objectKey =
      source.workspace_id +
      '/' +
      source.project_id +
      '/' +
      albumId +
      '/' +
      photoId +
      '/original.jpg';
    const createdAt = new Date(Date.now() + index * 1000).toISOString();
    ids.push(photoId);
    rows.push(
      db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename,created_at) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          photoId,
          source.workspace_id,
          source.project_id,
          albumId,
          'shared-browser-' + String(index + 1).padStart(2, '0') + '.jpg',
          createdAt,
        ),
      db
        .prepare(
          'INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,?,?,?,?,?)',
        )
        .bind(
          versionId,
          source.workspace_id,
          photoId,
          source.created_by_actor,
          source.source_hash_sha256,
          source.byte_size,
          source.mime,
          source.width,
          source.height,
          source.status,
        ),
      db
        .prepare(
          "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,?,'original',?,?,?,?, 'private')",
        )
        .bind(
          assetId,
          source.workspace_id,
          photoId,
          versionId,
          source.storage_node_id,
          objectKey,
          source.byte_size,
          source.mime,
          source.source_hash_sha256,
        ),
    );
  }
  await db.batch(rows);
  const row = await db
    .prepare(
      "SELECT count(*) AS n FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id AND v.version_no=1 JOIN photo_assets a ON a.photo_id=p.id AND a.version_id=v.id AND a.workspace_id=p.workspace_id AND a.asset_kind='original' WHERE p.album_id=?",
    )
    .bind(albumId)
    .first();
  assert.equal(
    row.n,
    31,
    'The album must contain 31 version-1/original metadata rows.',
  );
  return ids;
}

async function issueSharedInvite({
  worker,
  base,
  ownerCookie,
  projectId,
  albumId,
  address,
  maxUses = 1,
  canView = true,
  canSelect = true,
  canSubmit = true,
}) {
  const permissions = {
    can_view: canView,
    can_download_preview: false,
    can_download_original: false,
    can_select: canSelect,
    can_rate: false,
    can_favorite: false,
    can_tag: false,
    can_annotate: false,
    can_comment: false,
    can_submit: canSubmit,
    can_view_own_history: false,
    can_compare_versions: false,
  };
  const result = await api(
    worker,
    base,
    '/api/v1/projects/' + projectId + '/invites',
    {
      method: 'POST',
      ownerCookie,
      address,
      body: {
        requestId: randomUUID(),
        albumIds: [albumId],
        accessMode: 'link_only',
        permissions,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        maxUses,
      },
    },
  );
  assert.equal(
    result.response.status,
    200,
    'The Owner invite API should issue a Guest invite.',
  );
  assert.equal(result.body.secretAvailable, true);
  assert.match(result.body.token, /^[a-f0-9]{64}$/);
  return { inviteId: result.body.invite.inviteId, token: result.body.token };
}

async function exchangeGuestInvite({
  worker,
  base,
  invite,
  address,
  displayName,
}) {
  const result = await api(worker, base, '/api/guest/exchange', {
    method: 'POST',
    address,
    body: {
      requestId: randomUUID(),
      token: invite.token,
      displayName,
    },
  });
  assert.equal(
    result.response.status,
    200,
    'The Guest exchange should create a distinct browser session.',
  );
  const cookieLines =
    typeof result.response.headers.getSetCookie === 'function'
      ? result.response.headers.getSetCookie()
      : [result.response.headers.get('set-cookie') ?? ''];
  const setCookie = cookieLines.find((value) =>
    /(?:^|;\s*)(?:__Host-)?kino_guest=/.test(value),
  );
  assert.ok(
    setCookie,
    'The Guest exchange response should contain its HttpOnly cookie.',
  );
  const match = /(?:^|;\s*)((?:__Host-)?kino_guest)=([^;]+)/.exec(setCookie);
  assert.ok(match);
  return {
    name: match[1],
    value: decodeURIComponent(match[2]),
    header: match[1] + '=' + decodeURIComponent(match[2]),
    secure: /;\s*secure(?:;|$)/i.test(setCookie),
  };
}

async function getAllGalleryPhotos(worker, base, albumId, cookie) {
  const photos = [];
  const seen = new Set();
  let cursor = null;
  while (true) {
    const path =
      '/api/guest/albums/' +
      albumId +
      '/photos' +
      (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
    const result = await api(worker, base, path, {
      guestCookie: cookie.header,
    });
    assert.equal(
      result.response.status,
      200,
      'The authorized Guest gallery should page metadata.',
    );
    const page = result.body;
    assert.ok(Array.isArray(page.photos) && page.photos.length <= 24);
    photos.push(...page.photos);
    cursor = page.nextCursor;
    if (!cursor) break;
    assert.equal(seen.has(cursor), false, 'Gallery cursors must not cycle.');
    seen.add(cursor);
  }
  return photos;
}

async function getSharedSelectionItems(
  worker,
  base,
  albumId,
  reviewId,
  cookie,
) {
  const items = [];
  const seen = new Set();
  let cursor = null;
  let first = null;
  while (true) {
    const path =
      '/api/guest/albums/' +
      albumId +
      '/shared-reviews/' +
      reviewId +
      '/selection' +
      (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
    const result = await api(worker, base, path, {
      guestCookie: cookie.header,
    });
    assert.equal(
      result.response.status,
      200,
      'A shared member with can_select can read the shared IDs.',
    );
    first ??= result.body.review;
    assert.equal(result.body.review.revision, first.revision);
    items.push(...result.body.items);
    cursor = result.body.nextCursor;
    if (!cursor) break;
    assert.equal(
      seen.has(cursor),
      false,
      'Shared selection cursors must not cycle.',
    );
    seen.add(cursor);
  }
  return { review: first, items };
}

function requestInit(incoming) {
  const method = incoming.method();
  return incoming.allHeaders().then((headers) => ({
    method,
    headers,
    ...(method !== 'GET' && method !== 'HEAD'
      ? { body: incoming.postDataBuffer() ?? undefined }
      : {}),
    redirect: 'manual',
  }));
}

async function routeWorker(
  page,
  getWorker,
  onRequest = () => {},
  onResponse = () => false,
) {
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (await onRequest(incoming, url)) {
      try {
        await route.abort('failed');
      } catch {
        // The browser may already have canceled this request during navigation.
      }
      return;
    }
    const workerResponse = await getWorker().fetch(
      new Request(incoming.url(), await requestInit(incoming)),
    );
    const responseBytes = Buffer.from(await workerResponse.arrayBuffer());
    const responseForObservation = new Response(
      responseBytes.length ? responseBytes : null,
      { status: workerResponse.status, headers: workerResponse.headers },
    );
    if (await onResponse(incoming, url, responseForObservation)) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: workerResponse.status,
      headers: Object.fromEntries(workerResponse.headers.entries()),
      body: responseBytes,
    });
  });
}

async function navigateAwayWhilePreflightHeld(page, destination, gate) {
  const dialogPromise = page.waitForEvent('dialog', { timeout: 10000 });
  const navigationPromise = page.goto(destination, { waitUntil: 'commit' });
  const dialog = await dialogPromise;
  assert.equal(dialog.type(), 'beforeunload');
  await dialog.accept();
  await navigationPromise;
  assert.equal(typeof gate.release, 'function');
  gate.release();
  gate.release = null;
  await expect.poll(() => gate.completed, { timeout: 10000 }).toBe(true);
}

async function addGuestCookie(context, base, cookie) {
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: cookie.secure,
    },
  ]);
}

export async function runSharedReviewGuestBrowserChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  owner,
  db,
  galleryFixture,
}) {
  assert.ok(galleryFixture?.context?.project?.id);
  assert.ok(galleryFixture?.context?.workspace?.id);
  const disabledCapabilities = await api(
    disabledWorker,
    base,
    '/api/guest/shared-reviews/capabilities',
  );
  assert.equal(disabledCapabilities.response.status, 200);
  assert.deepEqual(disabledCapabilities.body, { enabled: false });

  const ownerScope = await db
    .prepare('SELECT owner_user_id FROM workspaces WHERE id=?')
    .bind(galleryFixture.context.workspace.id)
    .first();
  assert.equal(ownerScope.owner_user_id, owner);

  const albumId = await createActiveTestAlbum({
    db,
    project: galleryFixture.context.project.id,
    workspace: galleryFixture.context.workspace.id,
  });
  const photoIds = await seedVersionOneOriginalMetadata({
    db,
    galleryFixture,
    albumId,
  });

  assert.equal(photoIds.length, 31);
  const participantInvite = await issueSharedInvite({
    worker,
    base,
    ownerCookie,
    projectId: galleryFixture.context.project.id,
    albumId,
    address: '198.51.100.81',
    maxUses: 2,
  });
  const createReview = await api(
    worker,
    base,
    '/api/v1/albums/' + albumId + '/shared-reviews',
    {
      method: 'POST',
      ownerCookie,
      body: {
        requestId: randomUUID(),
        title: 'Shared browser concurrency review',
        inviteIds: [participantInvite.inviteId],
        minimum: 1,
        maximum: 30,
        confirmShared: true,
      },
    },
  );
  assert.ok(
    createReview.response.status === 200 ||
      createReview.response.status === 201,
    'The Owner must explicitly create the shared subject with its 30-photo cap.',
  );
  const reviewId = createReview.body.review?.id;
  assert.match(reviewId ?? '', /^[0-9a-f-]{36}$/i);
  assert.deepEqual(createReview.body.review.inviteIds, [
    participantInvite.inviteId,
  ]);
  assert.equal(createReview.body.review.maximum, 30);
  assert.equal(createReview.body.review.selectedCount, 0);

  const guestA = await exchangeGuestInvite({
    worker,
    base,
    invite: participantInvite,
    address: '198.51.100.82',
    displayName: 'Shared browser Guest A',
  });
  const guestB = await exchangeGuestInvite({
    worker,
    base,
    invite: participantInvite,
    address: '198.51.100.83',
    displayName: 'Shared browser Guest B',
  });
  assert.notEqual(guestA.value, guestB.value);
  const guestMetadataPath =
    '/api/guest/albums/' + albumId + '/shared-reviews/' + reviewId;
  const metadataA = await api(worker, base, guestMetadataPath, {
    guestCookie: guestA.header,
  });
  const metadataB = await api(worker, base, guestMetadataPath, {
    guestCookie: guestB.header,
  });
  assert.equal(metadataA.response.status, 200);
  assert.equal(metadataB.response.status, 200);
  const guestIdA = metadataA.body.guestId;
  const guestIdB = metadataB.body.guestId;
  assert.match(guestIdA, /^[0-9a-f-]{36}$/i);
  assert.match(guestIdB, /^[0-9a-f-]{36}$/i);
  assert.notEqual(
    guestIdA,
    guestIdB,
    'The same invite must not merge distinct Guest actors.',
  );
  const participantSessions = await db
    .prepare(
      'SELECT id,guest_id FROM guest_sessions WHERE invite_id=? ORDER BY created_at_ms,id',
    )
    .bind(participantInvite.inviteId)
    .all();
  assert.equal(participantSessions.results.length, 2);
  assert.notEqual(
    participantSessions.results[0].guest_id,
    participantSessions.results[1].guest_id,
    'Two exchanges of the selected invite must retain distinct Guest actors.',
  );
  assert.notEqual(
    participantSessions.results[0].id,
    participantSessions.results[1].id,
  );

  const photos = await getAllGalleryPhotos(worker, base, albumId, guestA);
  assert.equal(photos.length, 31);
  const sharedSeedPhotos = photos.slice(0, 29);
  const remaining = photos.slice(29);
  assert.equal(sharedSeedPhotos.length, 29);
  assert.equal(remaining.length, 2);
  const switchedCookieRequestId = randomUUID();
  const switchedCookieAttempt = await api(
    worker,
    base,
    '/api/guest/albums/' +
      albumId +
      '/shared-reviews/' +
      reviewId +
      '/photos/' +
      photos[0].id +
      '/selection',
    {
      method: 'PUT',
      guestCookie: guestB.header,
      body: {
        requestId: switchedCookieRequestId,
        roundNo: 1,
        versionId: photos[0].versionId,
        expectedGuestId: guestIdA,
        selected: true,
      },
    },
  );
  assert.equal(switchedCookieAttempt.response.status, 401);
  const noSharedStateAfterSwitch = await getSharedSelectionItems(
    worker,
    base,
    albumId,
    reviewId,
    guestA,
  );
  assert.equal(noSharedStateAfterSwitch.review.selectedCount, 0);
  const switchedCookieAudit = await db
    .prepare(
      'SELECT count(*) AS n FROM audit_events WHERE album_id=? AND request_id=? AND actor_type=?',
    )
    .bind(albumId, switchedCookieRequestId, 'guest')
    .first();
  assert.equal(switchedCookieAudit.n, 0);
  const seedResponses = [];
  for (const photo of sharedSeedPhotos) {
    const result = await api(
      worker,
      base,
      '/api/guest/albums/' +
        albumId +
        '/shared-reviews/' +
        reviewId +
        '/photos/' +
        photo.id +
        '/selection',
      {
        method: 'PUT',
        guestCookie: guestA.header,
        body: {
          requestId: randomUUID(),
          roundNo: 1,
          versionId: photo.versionId,
          expectedGuestId: guestIdA,
          selected: true,
        },
      },
    );
    seedResponses.push(result.response.status);
  }
  assert.ok(
    seedResponses.every((status) => status === 200),
    'The first Guest seeds the shared set through the Guest mutation API.',
  );

  const initialShared = await getSharedSelectionItems(
    worker,
    base,
    albumId,
    reviewId,
    guestA,
  );
  assert.equal(initialShared.review.selectedCount, 29);
  assert.equal(initialShared.items.length, 29);

  const privatePick = remaining[0];
  const privateMutation = await api(
    worker,
    base,
    '/api/guest/albums/' + albumId + '/photos/' + privatePick.id + '/selection',
    {
      method: 'PUT',
      guestCookie: guestA.header,
      body: {
        requestId: randomUUID(),
        versionId: privatePick.versionId,
        selected: true,
      },
    },
  );
  assert.equal(privateMutation.response.status, 200);
  assert.equal(
    initialShared.items.some((item) => item.photoId === privatePick.id),
    false,
    'A private pick must not appear in the shared subject.',
  );

  const guestBPrivate = await api(
    worker,
    base,
    '/api/guest/albums/' + albumId + '/selection',
    { guestCookie: guestB.header },
  );
  assert.equal(guestBPrivate.response.status, 200);
  assert.equal(guestBPrivate.body.selectedCount, 0);
  assert.equal(
    initialShared.items.some((item) =>
      guestBPrivate.body.items.some(
        (privateItem) => privateItem.photoId === item.photoId,
      ),
    ),
    false,
    'Shared picks must not appear in another Guest’s private selection.',
  );

  const guestAList = await api(
    worker,
    base,
    '/api/guest/albums/' + albumId + '/shared-reviews',
    { guestCookie: guestA.header },
  );
  const guestBList = await api(
    worker,
    base,
    '/api/guest/albums/' + albumId + '/shared-reviews',
    { guestCookie: guestB.header },
  );
  assert.equal(guestAList.response.status, 200);
  assert.equal(guestBList.response.status, 200);
  assert.deepEqual(
    guestAList.body.reviews.map((review) => review.id),
    [reviewId],
  );
  assert.deepEqual(
    guestBList.body.reviews.map((review) => review.id),
    [reviewId],
  );
  for (const body of [guestAList.body, guestBList.body]) {
    assert.equal(
      JSON.stringify(body).includes('Shared browser Guest A') ||
        JSON.stringify(body).includes('Shared browser Guest B'),
      false,
      'Membership discovery must not expose Guest names.',
    );
  }

  const foreignInvite = await issueSharedInvite({
    worker,
    base,
    ownerCookie,
    projectId: galleryFixture.context.project.id,
    albumId,
    address: '198.51.100.84',
  });
  const foreignGuest = await exchangeGuestInvite({
    worker,
    base,
    invite: foreignInvite,
    address: '198.51.100.85',
    displayName: 'Nonmember browser Guest',
  });
  const foreignList = await api(
    worker,
    base,
    '/api/guest/albums/' + albumId + '/shared-reviews',
    { guestCookie: foreignGuest.header },
  );
  assert.equal(foreignList.response.status, 200);
  assert.equal(foreignList.body.reviews.length, 0);
  const foreignMetadata = await api(
    worker,
    base,
    '/api/guest/albums/' + albumId + '/shared-reviews/' + reviewId,
    { guestCookie: foreignGuest.header },
  );
  assert.equal(foreignMetadata.response.status, 401);

  const selectOnlyInvite = await issueSharedInvite({
    worker,
    base,
    ownerCookie,
    projectId: galleryFixture.context.project.id,
    albumId,
    address: '198.51.100.86',
    canView: true,
    canSelect: true,
    canSubmit: false,
  });
  const submitOnlyInvite = await issueSharedInvite({
    worker,
    base,
    ownerCookie,
    projectId: galleryFixture.context.project.id,
    albumId,
    address: '198.51.100.87',
    canView: false,
    canSelect: false,
    canSubmit: true,
  });
  const rightsInviteIds = [
    selectOnlyInvite.inviteId,
    submitOnlyInvite.inviteId,
  ].sort();
  const rightsReviewCreate = await api(
    worker,
    base,
    '/api/v1/albums/' + albumId + '/shared-reviews',
    {
      method: 'POST',
      ownerCookie,
      body: {
        requestId: randomUUID(),
        title: 'Independent Guest rights review',
        inviteIds: rightsInviteIds,
        minimum: 1,
        maximum: 30,
        confirmShared: true,
      },
    },
  );
  assert.ok(
    rightsReviewCreate.response.status === 200 ||
      rightsReviewCreate.response.status === 201,
  );
  const rightsReviewId = rightsReviewCreate.body.review.id;
  const selectOnlyGuest = await exchangeGuestInvite({
    worker,
    base,
    invite: selectOnlyInvite,
    address: '198.51.100.88',
    displayName: 'Selection-only Guest',
  });
  const submitOnlyGuest = await exchangeGuestInvite({
    worker,
    base,
    invite: submitOnlyInvite,
    address: '198.51.100.89',
    displayName: 'Submit-only Guest',
  });
  const rightsMetadataPath =
    '/api/guest/albums/' + albumId + '/shared-reviews/' + rightsReviewId;
  const selectionOnlyMetadata = await api(worker, base, rightsMetadataPath, {
    guestCookie: selectOnlyGuest.header,
  });
  const submitOnlyMetadataBeforePick = await api(
    worker,
    base,
    rightsMetadataPath,
    { guestCookie: submitOnlyGuest.header },
  );
  assert.equal(selectionOnlyMetadata.response.status, 200);
  assert.equal(selectionOnlyMetadata.body.canView, true);
  assert.equal(selectionOnlyMetadata.body.canSelect, true);
  assert.equal(selectionOnlyMetadata.body.canSubmit, false);
  assert.equal(selectionOnlyMetadata.body.selectedCount, 0);
  assert.equal(submitOnlyMetadataBeforePick.response.status, 200);
  assert.equal(submitOnlyMetadataBeforePick.body.canView, false);
  assert.equal(submitOnlyMetadataBeforePick.body.canSelect, false);
  assert.equal(submitOnlyMetadataBeforePick.body.canSubmit, true);
  assert.equal(submitOnlyMetadataBeforePick.body.selectedCount, null);
  assert.equal(submitOnlyMetadataBeforePick.body.canSubmitNow, false);

  const selectionOnlySet = await api(
    worker,
    base,
    '/api/guest/albums/' +
      albumId +
      '/shared-reviews/' +
      rightsReviewId +
      '/photos/' +
      photos[0].id +
      '/selection',
    {
      method: 'PUT',
      guestCookie: selectOnlyGuest.header,
      body: {
        requestId: randomUUID(),
        roundNo: 1,
        versionId: photos[0].versionId,
        expectedGuestId: selectionOnlyMetadata.body.guestId,
        selected: true,
      },
    },
  );
  assert.equal(selectionOnlySet.response.status, 200);
  const selectionOnlySubmitAttempt = await api(
    worker,
    base,
    '/api/guest/albums/' +
      albumId +
      '/shared-reviews/' +
      rightsReviewId +
      '/submit',
    {
      method: 'POST',
      guestCookie: selectOnlyGuest.header,
      body: {
        requestId: randomUUID(),
        roundNo: 1,
        expectedRevision: selectionOnlySet.body.revision,
        expectedGuestId: selectionOnlyMetadata.body.guestId,
      },
    },
  );
  assert.equal(selectionOnlySubmitAttempt.response.status, 401);

  const submitOnlyRead = await api(
    worker,
    base,
    '/api/guest/albums/' +
      albumId +
      '/shared-reviews/' +
      rightsReviewId +
      '/selection',
    { guestCookie: submitOnlyGuest.header },
  );
  assert.equal(submitOnlyRead.response.status, 401);
  assert.equal(
    JSON.stringify(submitOnlyRead.body).includes(photos[0].id),
    false,
  );
  const submitOnlyGallery = await api(
    worker,
    base,
    '/api/guest/albums/' + albumId + '/photos',
    { guestCookie: submitOnlyGuest.header },
  );
  assert.equal(submitOnlyGallery.response.status, 401);
  const submitOnlyMetadata = await api(worker, base, rightsMetadataPath, {
    guestCookie: submitOnlyGuest.header,
  });
  assert.equal(submitOnlyMetadata.response.status, 200);
  assert.equal(submitOnlyMetadata.body.canSubmitNow, true);
  assert.equal(submitOnlyMetadata.body.selectedCount, null);
  assert.equal(submitOnlyMetadata.body.canSelect, false);
  assert.equal(submitOnlyMetadata.body.canView, false);
  assert.equal(
    JSON.stringify(submitOnlyMetadata.body).includes(photos[0].id),
    false,
  );
  const browser = await chromium.launch({ headless: true });
  const observationsA = {
    writes: [],
    ownerApiPaths: [],
    privateSelectionReads: [],
  };
  const observationsB = {
    writes: [],
    ownerApiPaths: [],
    privateSelectionReads: [],
  };
  const drop = {
    nextSelection: false,
    dropped: false,
    nextSubmit: false,
    droppedSubmit: false,
  };
  let activeWorkerA = disabledWorker;
  try {
    const contextA = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const contextB = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addGuestCookie(contextA, base, guestA);
    await addGuestCookie(contextB, base, guestB);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await routeWorker(
      pageA,
      () => activeWorkerA,
      (incoming, url) => {
        if (url.pathname.startsWith('/api/v1/'))
          observationsA.ownerApiPaths.push(url.pathname);
        if (
          url.pathname === '/api/guest/albums/' + albumId + '/selection' &&
          incoming.method() === 'GET'
        )
          observationsA.privateSelectionReads.push(url.pathname);
      },
      async (incoming, url, response) => {
        const isSharedSet =
          incoming.method() === 'PUT' &&
          url.pathname.includes('/shared-reviews/');
        const isSharedSubmit =
          incoming.method() === 'POST' &&
          url.pathname.includes('/shared-reviews/') &&
          url.pathname.endsWith('/submit');
        if (isSharedSet || isSharedSubmit) {
          observationsA.writes.push({
            status: response.status,
            body: incoming.postData() ?? '',
            path: url.pathname,
            responseBody: await response
              .clone()
              .json()
              .catch(() => null),
          });
        }
        if (
          drop.nextSelection &&
          incoming.method() === 'PUT' &&
          url.pathname.includes('/shared-reviews/') &&
          url.pathname.endsWith('/selection')
        ) {
          assert.equal(response.status, 200);
          drop.nextSelection = false;
          drop.dropped = true;
          return true;
        }
        if (
          drop.nextSubmit &&
          incoming.method() === 'POST' &&
          url.pathname.includes('/shared-reviews/') &&
          url.pathname.endsWith('/submit')
        ) {
          assert.equal(response.status, 200);
          drop.nextSubmit = false;
          drop.droppedSubmit = true;
          return true;
        }
        return false;
      },
    );
    await routeWorker(
      pageB,
      () => worker,
      (incoming, url) => {
        if (url.pathname.startsWith('/api/v1/'))
          observationsB.ownerApiPaths.push(url.pathname);
        if (
          url.pathname === '/api/guest/albums/' + albumId + '/selection' &&
          incoming.method() === 'GET'
        )
          observationsB.privateSelectionReads.push(url.pathname);
      },
      async (incoming, url, response) => {
        const isSharedSet =
          incoming.method() === 'PUT' &&
          url.pathname.includes('/shared-reviews/');
        const isSharedSubmit =
          incoming.method() === 'POST' &&
          url.pathname.includes('/shared-reviews/') &&
          url.pathname.endsWith('/submit');
        if (isSharedSet || isSharedSubmit) {
          observationsB.writes.push({
            status: response.status,
            body: incoming.postData() ?? '',
            path: url.pathname,
            responseBody: await response
              .clone()
              .json()
              .catch(() => null),
          });
        }
        return false;
      },
    );

    await pageA.goto(base + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    const disabledPrivateSelectionBaselineA =
      observationsA.privateSelectionReads.length;
    const disabledPrivateSelectionBaselineB =
      observationsB.privateSelectionReads.length;
    await expect(pageA.getByText('共同挑片目前未開放。')).toBeVisible();
    await expect(
      pageA.getByRole('link', { name: /進入共同挑片|查看共同挑片/ }),
    ).toHaveCount(0);
    await pageA.goto(
      base + '/guest/albums/' + albumId + '/shared/' + reviewId,
      { waitUntil: 'networkidle' },
    );
    await expect(
      pageA.getByRole('heading', { name: '共同挑片目前未開放' }),
    ).toBeVisible();
    assert.equal(
      observationsA.privateSelectionReads.length,
      disabledPrivateSelectionBaselineA,
    );
    assert.equal(
      observationsB.privateSelectionReads.length,
      disabledPrivateSelectionBaselineB,
    );
    activeWorkerA = worker;

    await pageA.goto(base + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    await expect(
      pageA.getByRole('link', {
        name: '進入共同挑片',
        exact: true,
      }),
    ).toBeVisible();
    const privateSelectionReadBaselineA =
      observationsA.privateSelectionReads.length;
    const privateSelectionReadBaselineB =
      observationsB.privateSelectionReads.length;
    await pageA
      .getByRole('link', {
        name: '進入共同挑片',
        exact: true,
      })
      .click();
    await pageB.goto(
      base + '/guest/albums/' + albumId + '/shared/' + reviewId,
      { waitUntil: 'networkidle' },
    );
    await expect(
      pageA.getByRole('heading', { name: '共同挑片' }),
    ).toBeVisible();
    await expect(
      pageB.getByRole('heading', { name: '共同挑片' }),
    ).toBeVisible();
    await expect(pageA.getByTestId('shared-review-count')).toContainText('29');
    await expect(pageB.getByTestId('shared-review-count')).toContainText('29');

    await mkdir('.local', { recursive: true });
    await pageA.screenshot({
      path: '.local/shared-review-guest-mobile.png',
      fullPage: true,
    });

    const secretLeaks = await pageA.evaluate(
      (values) => {
        const stored = [
          ...Object.values(localStorage),
          ...Object.values(sessionStorage),
        ].join('\n');
        const pageText = document.body.innerText;
        return values.some(
          (value) =>
            value &&
            (stored.includes(value) ||
              window.location.href.includes(value) ||
              pageText.includes(value)),
        );
      },
      [
        participantInvite.token,
        guestA.value,
        guestB.value,
        foreignInvite.token,
        foreignGuest.value,
      ],
    );
    assert.equal(
      secretLeaks,
      false,
      'Guest bearer values must not enter page text, URL, or browser storage.',
    );
    assert.equal(observationsA.ownerApiPaths.length, 0);
    assert.equal(observationsB.ownerApiPaths.length, 0);
    assert.equal(
      observationsA.privateSelectionReads.length,
      privateSelectionReadBaselineA,
    );
    assert.equal(
      observationsB.privateSelectionReads.length,
      privateSelectionReadBaselineB,
    );

    await pageA.getByRole('button', { name: '下一頁共同挑片照片' }).click();
    await pageB.getByRole('button', { name: '下一頁共同挑片照片' }).click();
    await expect(
      pageA.getByRole('list', { name: '共同挑片照片列表' }).locator('li'),
    ).toHaveCount(7);
    await expect(
      pageB.getByRole('list', { name: '共同挑片照片列表' }).locator('li'),
    ).toHaveCount(7);

    const targetA = remaining[0];
    const targetB = remaining[1];
    const checkboxA = pageA.getByRole('checkbox', {
      name: '共同選取 ' + targetA.filename,
    });
    const checkboxB = pageB.getByRole('checkbox', {
      name: '共同選取 ' + targetB.filename,
    });
    await expect(checkboxA).not.toBeChecked();
    await expect(checkboxB).not.toBeChecked();

    const raceBeforeA = [...observationsA.writes];
    const raceBeforeB = [...observationsB.writes];
    await Promise.all([checkboxA.click(), checkboxB.click()]);
    await expect
      .poll(
        async () => {
          const current = await api(
            worker,
            base,
            '/api/guest/albums/' + albumId + '/shared-reviews/' + reviewId,
            { guestCookie: guestA.header },
          );
          assert.equal(current.response.status, 200);
          return current.body.selectedCount;
        },
        { timeout: 15000 },
      )
      .toBe(30);
    await expect
      .poll(
        async () => {
          const writes = [
            ...observationsA.writes.slice(raceBeforeA.length),
            ...observationsB.writes.slice(raceBeforeB.length),
          ];
          if (writes.some((entry) => entry.status === 409)) return true;
          const text = await Promise.all([
            pageA.locator('body').innerText(),
            pageB.locator('body').innerText(),
          ]);
          return text.some((value) =>
            value.includes('其他參與者或攝影師已更新這一輪'),
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const stateAfterRace = await getSharedSelectionItems(
      worker,
      base,
      albumId,
      reviewId,
      guestA,
    );
    assert.equal(stateAfterRace.review.selectedCount, 30);
    assert.equal(stateAfterRace.items.length, 30);

    const raceWrites = [
      ...observationsA.writes.slice(raceBeforeA.length),
      ...observationsB.writes.slice(raceBeforeB.length),
    ];
    assert.equal(
      raceWrites.filter((entry) => entry.status === 200).length,
      1,
      'Exactly one distinct participant pick should commit at the 30-photo cap.',
    );
    const winnerWrite = raceWrites.find((entry) => entry.status === 200);
    assert.ok(winnerWrite);
    const winnerPhotoId = /\/photos\/([a-f0-9-]+)\/selection$/i.exec(
      winnerWrite.path,
    )?.[1];
    assert.ok(winnerPhotoId === targetA.id || winnerPhotoId === targetB.id);
    const raceUiText = await Promise.all([
      pageA.locator('body').innerText(),
      pageB.locator('body').innerText(),
    ]);
    assert.ok(
      raceWrites.some((entry) => entry.status === 409) ||
        raceUiText.some((value) =>
          value.includes('其他參與者或攝影師已更新這一輪'),
        ),
      'The second browser must see a conflict or be asked to refresh the changed revision.',
    );

    for (const page of [pageA, pageB]) {
      const refreshButton = page.getByRole('button', {
        name: '重新整理共同挑片',
      });
      await refreshButton.first().click();
      await expect(page.getByTestId('shared-review-count')).toContainText('30');
    }
    const guestBSharedAfterRefresh = await getSharedSelectionItems(
      worker,
      base,
      albumId,
      reviewId,
      guestB,
    );
    assert.equal(guestBSharedAfterRefresh.review.selectedCount, 30);
    assert.ok(
      guestBSharedAfterRefresh.items.some(
        (item) => item.photoId === winnerPhotoId,
      ),
      'Guest B must see the committed selection after explicit refresh.',
    );

    const guestAChangePhoto = photos[24];
    const guestAChangeCheckbox = pageA.getByRole('checkbox', {
      name: '共同選取 ' + guestAChangePhoto.filename,
    });
    const guestBChangeCheckbox = pageB.getByRole('checkbox', {
      name: '共同選取 ' + guestAChangePhoto.filename,
    });
    await expect(guestAChangeCheckbox).toBeChecked();
    await expect(guestBChangeCheckbox).toBeChecked();
    await guestAChangeCheckbox.click();
    await expect(guestAChangeCheckbox).not.toBeChecked({ timeout: 15000 });
    await expect(pageA.getByTestId('shared-review-count')).toContainText('29');
    await pageB
      .getByRole('button', { name: '重新整理共同挑片' })
      .first()
      .click();
    await expect(pageB.getByTestId('shared-review-count')).toContainText('29');
    await expect(guestBChangeCheckbox).not.toBeChecked();

    await guestAChangeCheckbox.click();
    await expect(guestAChangeCheckbox).toBeChecked({ timeout: 15000 });
    await expect(pageA.getByTestId('shared-review-count')).toContainText('30');
    await pageB
      .getByRole('button', { name: '重新整理共同挑片' })
      .first()
      .click();
    await expect(pageB.getByTestId('shared-review-count')).toContainText('30');
    await expect(guestBChangeCheckbox).toBeChecked();

    const cappedState = await getSharedSelectionItems(
      worker,
      base,
      albumId,
      reviewId,
      guestA,
    );
    assert.equal(cappedState.review.selectedCount, 30);
    assert.equal(cappedState.items.length, 30);
    const galleryVersions = new Map(
      photos.map((photo) => [photo.id, photo.versionId]),
    );
    assert.ok(
      cappedState.items.every(
        (item) => galleryVersions.get(item.photoId) === item.versionId,
      ),
      'Every current pick should already point at its version-1 gallery item.',
    );
    assert.ok(
      photos
        .slice(24)
        .some(
          (photo) =>
            !cappedState.items.some((item) => item.photoId === photo.id),
        ),
      'The visible page should contain an unselected photo while the set is at cap.',
    );
    const batchButton = pageA.getByRole('button', {
      name: '選取目前顯示頁面',
    });
    await expect(batchButton).toBeDisabled();
    const beforeNoopWrites = observationsA.writes.length;
    await batchButton.evaluate((button) => button.click());
    await expect.poll(() => observationsA.writes.length).toBe(beforeNoopWrites);
    const afterNoopState = await getSharedSelectionItems(
      worker,
      base,
      albumId,
      reviewId,
      guestA,
    );
    assert.equal(afterNoopState.review.revision, cappedState.review.revision);
    assert.deepEqual(
      afterNoopState.items
        .map((item) => [item.photoId, item.versionId])
        .sort(([left], [right]) => left.localeCompare(right)),
      cappedState.items
        .map((item) => [item.photoId, item.versionId])
        .sort(([left], [right]) => left.localeCompare(right)),
    );

    const mobileFits = await pageA.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    assert.equal(
      mobileFits,
      true,
      'The shared review must not overflow at 375px.',
    );

    const submitButton = pageA.getByTestId('shared-review-submit');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();
    const submitDialog = pageA.getByRole('dialog', {
      name: '確認送出共同挑片？',
    });
    await expect(submitDialog).toBeVisible();
    const confirmSubmit = pageA.getByRole('button', {
      name: '確認送出共同挑片',
    });
    await expect(confirmSubmit).toBeFocused();
    await pageA.keyboard.press('Escape');
    await expect(submitDialog).toHaveCount(0);
    await expect(submitButton).toBeFocused();

    await submitButton.click();
    await expect(submitDialog).toBeVisible();
    await pageA.keyboard.press('Tab');
    const backButton = pageA.getByRole('button', { name: '返回修改' });
    await expect(backButton).toBeFocused();
    await pageA.keyboard.press('Shift+Tab');
    await expect(confirmSubmit).toBeFocused();
    const submitBeforeLostRetry = observationsA.writes.length;
    drop.nextSubmit = true;
    await confirmSubmit.click();
    const retrySubmitButton = pageA.getByRole('button', {
      name: '重試同一項送出要求',
    });
    await expect(retrySubmitButton).toBeVisible({ timeout: 15000 });
    assert.equal(drop.droppedSubmit, true);
    const firstUncertainSubmit = observationsA.writes[submitBeforeLostRetry];
    assert.equal(firstUncertainSubmit.status, 200);
    const uncertainSubmitBody = JSON.parse(firstUncertainSubmit.body);
    assert.equal(uncertainSubmitBody.expectedGuestId, guestIdA);
    assert.deepEqual(
      Object.keys(uncertainSubmitBody).sort(),
      ['expectedGuestId', 'expectedRevision', 'requestId', 'roundNo'].sort(),
    );
    assert.equal(Object.hasOwn(uncertainSubmitBody, 'photoIds'), false);

    await contextA.clearCookies();
    await addGuestCookie(contextA, base, guestB);
    await retrySubmitButton.click();
    await expect(
      pageA.getByText(
        '送出結果仍未確認。請重試原本要求；不會自動送出另一份內容。',
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => observationsA.writes.length)
      .toBe(submitBeforeLostRetry + 2);
    const switchedSubmitRetry = observationsA.writes[submitBeforeLostRetry + 1];
    assert.equal(switchedSubmitRetry.status, 401);
    assert.equal(switchedSubmitRetry.body, firstUncertainSubmit.body);
    assert.equal(
      JSON.parse(switchedSubmitRetry.body).expectedGuestId,
      guestIdA,
      'Switching Guest cookies must not replace the original submit expectedGuestId.',
    );

    await contextA.clearCookies();
    await addGuestCookie(contextA, base, guestA);
    await retrySubmitButton.click();
    await expect(pageA.getByText('本輪共同挑片已送出並鎖定。')).toBeVisible({
      timeout: 15000,
    });
    await expect(pageA.getByText('本輪已鎖定', { exact: true })).toBeVisible();
    await expect
      .poll(() => observationsA.writes.length)
      .toBe(submitBeforeLostRetry + 3);
    const exactSubmitRetry = observationsA.writes.slice(submitBeforeLostRetry);
    assert.equal(exactSubmitRetry.length, 3);
    assert.equal(exactSubmitRetry[0].body, exactSubmitRetry[1].body);
    assert.equal(exactSubmitRetry[0].body, exactSubmitRetry[2].body);
    assert.deepEqual(
      exactSubmitRetry.map((entry) => entry.status),
      [200, 401, 200],
    );
    const firstSubmitResult = exactSubmitRetry[0].responseBody;
    const replaySubmitResult = exactSubmitRetry[2].responseBody;
    assert.ok(firstSubmitResult?.eventId);
    assert.equal(replaySubmitResult?.eventId, firstSubmitResult.eventId);
    const submitAudit = await db
      .prepare(
        'SELECT count(*) AS n FROM audit_events WHERE album_id=? AND request_id=? AND actor_type=?',
      )
      .bind(albumId, uncertainSubmitBody.requestId, 'guest')
      .first();
    assert.equal(submitAudit.n, 1);
    const submitCommands = await db
      .prepare(
        'SELECT count(*) AS n FROM shared_review_guest_commands WHERE request_id=?',
      )
      .bind(uncertainSubmitBody.requestId)
      .first();
    assert.equal(submitCommands.n, 1);

    await pageB
      .getByRole('button', { name: '重新整理共同挑片' })
      .first()
      .click();
    await expect(pageB.getByText('本輪已鎖定', { exact: true })).toBeVisible();
    await expect(checkboxB).toBeDisabled();

    const ownerSubmissions = await api(
      worker,
      base,
      '/api/v1/albums/' +
        albumId +
        '/shared-reviews/' +
        reviewId +
        '/submissions',
      { ownerCookie },
    );
    assert.equal(ownerSubmissions.response.status, 200);
    assert.equal(ownerSubmissions.body.submissions.length, 1);
    assert.equal(
      ownerSubmissions.body.submissions[0].id,
      firstSubmitResult.submission.id,
    );
    const oldSubmission = ownerSubmissions.body.submissions[0];
    assert.equal(oldSubmission.roundNo, 1);
    assert.equal(oldSubmission.selectedCount, 30);
    const oldDetailItems = [];
    let detailCursor = null;
    const detailCursors = new Set();
    while (true) {
      const detailPath =
        '/api/v1/albums/' +
        albumId +
        '/shared-reviews/' +
        reviewId +
        '/submissions/' +
        oldSubmission.id +
        (detailCursor ? '?cursor=' + encodeURIComponent(detailCursor) : '');
      const detail = await api(worker, base, detailPath, { ownerCookie });
      assert.equal(detail.response.status, 200);
      oldDetailItems.push(...detail.body.items);
      detailCursor = detail.body.nextCursor;
      if (!detailCursor) break;
      assert.equal(detailCursors.has(detailCursor), false);
      detailCursors.add(detailCursor);
    }
    assert.equal(oldDetailItems.length, 30);

    const secondParticipantSet = await api(
      worker,
      base,
      '/api/guest/albums/' +
        albumId +
        '/shared-reviews/' +
        reviewId +
        '/photos/' +
        photos[0].id +
        '/selection',
      {
        method: 'PUT',
        guestCookie: guestB.header,
        body: {
          requestId: randomUUID(),
          roundNo: 1,
          versionId: photos[0].versionId,
          expectedGuestId: guestIdB,
          selected: false,
        },
      },
    );
    assert.equal(secondParticipantSet.response.status, 409);
    const secondSubmit = await api(
      worker,
      base,
      '/api/guest/albums/' +
        albumId +
        '/shared-reviews/' +
        reviewId +
        '/submit',
      {
        method: 'POST',
        guestCookie: guestB.header,
        body: {
          requestId: randomUUID(),
          roundNo: 1,
          expectedRevision: guestBSharedAfterRefresh.review.revision,
          expectedGuestId: guestIdB,
        },
      },
    );
    assert.equal(secondSubmit.response.status, 409);

    const reopen = await api(
      worker,
      base,
      '/api/v1/albums/' + albumId + '/shared-reviews/' + reviewId + '/reopen',
      {
        method: 'POST',
        ownerCookie,
        body: {
          requestId: randomUUID(),
          expectedRoundNo: 1,
          minimum: 1,
          maximum: 30,
          confirmShared: true,
        },
      },
    );
    assert.equal(reopen.response.status, 200);
    assert.equal(reopen.body.review.roundNo, 2);
    assert.equal(reopen.body.review.revision, 1);
    assert.equal(reopen.body.review.selectedCount, 30);
    assert.equal(reopen.body.review.status, 'open');

    for (const page of [pageA, pageB]) {
      await page
        .getByRole('button', { name: '重新整理共同挑片' })
        .first()
        .click();
      await expect(page.getByText(/第 2 輪/)).toBeVisible();
      await expect(page.getByTestId('shared-review-count')).toContainText('30');
    }
    const ownerSubmissionsAfterReopen = await api(
      worker,
      base,
      '/api/v1/albums/' +
        albumId +
        '/shared-reviews/' +
        reviewId +
        '/submissions',
      { ownerCookie },
    );
    assert.equal(ownerSubmissionsAfterReopen.body.submissions.length, 1);
    assert.equal(
      ownerSubmissionsAfterReopen.body.submissions[0].id,
      oldSubmission.id,
    );
    assert.equal(
      ownerSubmissionsAfterReopen.body.submissions[0].selectedCount,
      30,
    );

    await pageA.getByRole('button', { name: '上一頁共同挑片照片' }).click();
    const lostResponsePhoto = photos[0];
    const lostCheckbox = pageA.getByRole('checkbox', {
      name: '共同選取 ' + lostResponsePhoto.filename,
    });
    await expect(lostCheckbox).toBeChecked();
    const beforeLostRetry = observationsA.writes.length;
    drop.nextSelection = true;
    await lostCheckbox.click();
    const retryButton = pageA.getByRole('button', {
      name: '重試同一項共同選取要求',
    });
    await expect(retryButton).toBeVisible({ timeout: 15000 });
    const beforeUnloadWarns = await pageA.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(beforeUnloadWarns, true);
    const firstUncertain = observationsA.writes[beforeLostRetry];
    assert.ok(firstUncertain);
    assert.equal(firstUncertain.status, 200);
    assert.equal(drop.dropped, true);
    await contextA.clearCookies();
    await addGuestCookie(contextA, base, guestB);
    await retryButton.click();
    await expect(
      pageA.getByText(
        '這項要求的結果仍未確認。請重試同一要求；系統不會自動反向操作。',
      ),
    ).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => observationsA.writes.length)
      .toBe(beforeLostRetry + 2);
    assert.equal(observationsA.writes[beforeLostRetry + 1].status, 401);
    assert.equal(
      observationsA.writes[beforeLostRetry + 1].body,
      firstUncertain.body,
      'Switching Guest cookies must not replace the original expectedGuestId.',
    );

    await contextA.clearCookies();
    await addGuestCookie(contextA, base, guestA);
    await pageA.getByRole('button', { name: '重試同一項共同選取要求' }).click();
    await expect(lostCheckbox).not.toBeChecked({ timeout: 15000 });
    await expect(pageA.getByTestId('shared-review-count')).toContainText('29');

    const exactRetry = observationsA.writes.slice(beforeLostRetry);
    assert.equal(exactRetry.length, 3);
    assert.equal(exactRetry[0].body, exactRetry[1].body);
    assert.equal(exactRetry[0].body, exactRetry[2].body);
    const uncertainBody = JSON.parse(exactRetry[0].body);
    assert.equal(uncertainBody.roundNo, 2);
    assert.equal(uncertainBody.selected, false);
    assert.equal(uncertainBody.expectedGuestId, guestIdA);
    assert.deepEqual(
      exactRetry.map((entry) => entry.status),
      [200, 401, 200],
    );
    const retryAudit = await db
      .prepare(
        'SELECT count(*) AS n FROM audit_events WHERE album_id=? AND request_id=? AND actor_type=?',
      )
      .bind(albumId, uncertainBody.requestId, 'guest')
      .first();
    assert.equal(retryAudit.n, 1);
    const guestCommands = await db
      .prepare(
        'SELECT count(*) AS n FROM shared_review_guest_commands WHERE request_id=?',
      )
      .bind(uncertainBody.requestId)
      .first();
    assert.equal(guestCommands.n, 1);

    await pageB.getByRole('button', { name: '上一頁共同挑片照片' }).click();
    const removedPhotoOnGuestB = pageB.getByRole('checkbox', {
      name: '共同選取 ' + lostResponsePhoto.filename,
    });
    await expect(removedPhotoOnGuestB).toBeChecked();
    await pageB
      .getByRole('button', { name: '重新整理共同挑片' })
      .first()
      .click();
    await expect(pageB.getByTestId('shared-review-count')).toContainText('29');
    await expect(removedPhotoOnGuestB).not.toBeChecked();
    assert.equal(
      observationsA.privateSelectionReads.length,
      privateSelectionReadBaselineA,
    );
    assert.equal(
      observationsB.privateSelectionReads.length,
      privateSelectionReadBaselineB,
    );
    assert.equal(observationsA.ownerApiPaths.length, 0);
    assert.equal(observationsB.ownerApiPaths.length, 0);

    const contextC = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const contextD = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addGuestCookie(contextC, base, selectOnlyGuest);
    await addGuestCookie(contextD, base, submitOnlyGuest);
    const pageC = await contextC.newPage();
    const pageD = await contextD.newPage();
    const rightsObservations = {
      ownerApiPaths: [],
      galleryReads: [],
      selectionReads: [],
      selectionPuts: [],
      submitPosts: [],
    };
    let observeSharedGalleryReads = true;
    const heldPreflight = {
      armed: false,
      started: false,
      completed: false,
      release: null,
    };
    function armHeldPreflight() {
      heldPreflight.armed = true;
      heldPreflight.started = false;
      heldPreflight.completed = false;
      heldPreflight.release = null;
    }
    async function maybeHoldPreflight(incoming, url) {
      if (
        !heldPreflight.armed ||
        incoming.method() !== 'GET' ||
        url.pathname !== rightsMetadataPath
      ) {
        return false;
      }
      heldPreflight.armed = false;
      heldPreflight.started = true;
      await new Promise((resolve) => {
        heldPreflight.release = resolve;
      });
      heldPreflight.completed = true;
      return true;
    }
    await routeWorker(
      pageC,
      () => worker,
      maybeHoldPreflight,
      (incoming, url, response) => {
        if (
          incoming.method() === 'PUT' &&
          url.pathname.startsWith(
            '/api/guest/albums/' +
              albumId +
              '/shared-reviews/' +
              rightsReviewId +
              '/photos/',
          ) &&
          url.pathname.endsWith('/selection')
        ) {
          rightsObservations.selectionPuts.push({
            status: response.status,
            body: incoming.postData() ?? '',
          });
        }
        return false;
      },
    );
    await routeWorker(
      pageD,
      () => worker,
      async (incoming, url) => {
        if (url.pathname.startsWith('/api/v1/'))
          rightsObservations.ownerApiPaths.push(url.pathname);
        if (
          observeSharedGalleryReads &&
          incoming.method() === 'GET' &&
          url.pathname === '/api/guest/albums/' + albumId + '/photos'
        )
          rightsObservations.galleryReads.push(url.pathname);
        if (
          incoming.method() === 'GET' &&
          url.pathname ===
            '/api/guest/albums/' +
              albumId +
              '/shared-reviews/' +
              rightsReviewId +
              '/selection'
        )
          rightsObservations.selectionReads.push(url.pathname);
        return maybeHoldPreflight(incoming, url);
      },
      (incoming, url, response) => {
        if (
          incoming.method() === 'POST' &&
          url.pathname ===
            '/api/guest/albums/' +
              albumId +
              '/shared-reviews/' +
              rightsReviewId +
              '/submit'
        ) {
          rightsObservations.submitPosts.push({
            status: response.status,
            body: incoming.postData() ?? '',
          });
        }
        return false;
      },
    );

    await pageC.goto(
      base + '/guest/albums/' + albumId + '/shared/' + rightsReviewId,
      { waitUntil: 'networkidle' },
    );
    await expect(
      pageC.getByRole('heading', { name: '共同挑片' }),
    ).toBeVisible();
    await expect(
      pageC.getByRole('checkbox', {
        name: '共同選取 ' + photos[0].filename,
      }),
    ).toBeChecked();
    await expect(pageC.getByTestId('shared-review-submit')).toHaveCount(0);

    armHeldPreflight();
    await pageC
      .getByRole('checkbox', { name: '共同選取 ' + photos[0].filename })
      .click();
    await expect
      .poll(() => heldPreflight.started, { timeout: 10000 })
      .toBe(true);
    const selectionUnloadWarns = await pageC.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(selectionUnloadWarns, true);
    await navigateAwayWhilePreflightHeld(
      pageC,
      base + '/guest/albums/' + albumId,
      heldPreflight,
    );
    assert.equal(rightsObservations.selectionPuts.length, 0);
    await pageC.goto(
      base + '/guest/albums/' + albumId + '/shared/' + rightsReviewId,
      { waitUntil: 'networkidle' },
    );
    await expect(
      pageC.getByRole('checkbox', {
        name: '共同選取 ' + photos[0].filename,
      }),
    ).toBeChecked();
    assert.equal(rightsObservations.selectionPuts.length, 0);

    await pageD.goto(
      base + '/guest/albums/' + albumId + '/shared/' + rightsReviewId,
      { waitUntil: 'networkidle' },
    );
    await expect(pageD.getByText('此邀請沒有查看照片的權限')).toBeVisible();
    await expect(pageD.getByTestId('shared-review-count')).toHaveText(
      '共同挑片送出資格',
    );
    await expect(
      pageD.getByRole('button', { name: '送出共同挑片' }),
    ).toBeEnabled();
    await expect(pageD.getByText(/shared-browser-/)).toHaveCount(0);
    assert.equal(rightsObservations.galleryReads.length, 0);
    await pageD.getByRole('button', { name: '送出共同挑片' }).click();
    await expect(
      pageD.getByRole('dialog', { name: '確認送出共同挑片？' }),
    ).toBeVisible();
    armHeldPreflight();
    await pageD.getByRole('button', { name: '確認送出共同挑片' }).click();
    await expect
      .poll(() => heldPreflight.started, { timeout: 10000 })
      .toBe(true);
    const submitUnloadWarns = await pageD.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(submitUnloadWarns, true);
    observeSharedGalleryReads = false;
    await navigateAwayWhilePreflightHeld(
      pageD,
      base + '/guest/albums/' + albumId,
      heldPreflight,
    );
    assert.equal(rightsObservations.submitPosts.length, 0);
    await expect(
      pageD.getByRole('status').filter({
        hasText: '相簿預覽目前無法顯示',
      }),
    ).toBeVisible({ timeout: 15000 });
    observeSharedGalleryReads = true;
    await pageD.goto(
      base + '/guest/albums/' + albumId + '/shared/' + rightsReviewId,
      { waitUntil: 'networkidle' },
    );
    await expect(pageD.getByText('此邀請沒有查看照片的權限')).toBeVisible();
    await expect(
      pageD.getByRole('button', { name: '送出共同挑片' }),
    ).toBeEnabled();
    await expect(pageD.getByText(/shared-browser-/)).toHaveCount(0);
    await pageD.getByRole('button', { name: '送出共同挑片' }).click();
    await pageD.getByRole('button', { name: '確認送出共同挑片' }).click();
    await expect(pageD.getByText('本輪共同挑片已送出並鎖定。')).toBeVisible({
      timeout: 15000,
    });

    const reopenRightsReview = await api(
      worker,
      base,
      '/api/v1/albums/' +
        albumId +
        '/shared-reviews/' +
        rightsReviewId +
        '/reopen',
      {
        method: 'POST',
        ownerCookie,
        body: {
          requestId: randomUUID(),
          expectedRoundNo: 1,
          minimum: 1,
          maximum: 30,
          confirmShared: true,
        },
      },
    );
    assert.equal(reopenRightsReview.response.status, 200);
    assert.equal(reopenRightsReview.body.review.roundNo, 2);
    assert.equal(reopenRightsReview.body.review.selectedCount, 1);

    const staleSelectionOnlyCheckbox = pageC.getByRole('checkbox', {
      name: '共同選取 ' + photos[0].filename,
    });
    await expect(staleSelectionOnlyCheckbox).toBeChecked();
    await staleSelectionOnlyCheckbox.click();
    await expect(pageC.getByText('其他參與者或攝影師已更新這一輪')).toBeVisible(
      { timeout: 15000 },
    );
    assert.equal(rightsObservations.selectionPuts.length, 0);
    await pageC
      .getByRole('button', { name: '重新整理共同挑片' })
      .first()
      .click();
    await expect(pageC.getByText(/第 2 輪/)).toBeVisible();
    await expect(staleSelectionOnlyCheckbox).toBeChecked();

    await staleSelectionOnlyCheckbox.click();
    await expect(staleSelectionOnlyCheckbox).not.toBeChecked({
      timeout: 15000,
    });
    await expect.poll(() => rightsObservations.selectionPuts.length).toBe(1);
    const selectionAfterStalePreflight = await getSharedSelectionItems(
      worker,
      base,
      albumId,
      rightsReviewId,
      selectOnlyGuest,
    );
    assert.equal(selectionAfterStalePreflight.review.roundNo, 2);
    assert.equal(selectionAfterStalePreflight.review.selectedCount, 0);

    await staleSelectionOnlyCheckbox.click();
    await expect(staleSelectionOnlyCheckbox).toBeChecked({ timeout: 15000 });
    await expect.poll(() => rightsObservations.selectionPuts.length).toBe(2);
    assert.deepEqual(
      rightsObservations.selectionPuts.map((entry) => {
        const body = JSON.parse(entry.body);
        return [
          entry.status,
          body.roundNo,
          body.expectedGuestId,
          body.selected,
        ];
      }),
      [
        [200, 2, selectionOnlyMetadata.body.guestId, false],
        [200, 2, selectionOnlyMetadata.body.guestId, true],
      ],
    );
    const selectionAfterUnlock = await getSharedSelectionItems(
      worker,
      base,
      albumId,
      rightsReviewId,
      selectOnlyGuest,
    );
    assert.equal(selectionAfterUnlock.review.selectedCount, 1);

    assert.equal(rightsObservations.ownerApiPaths.length, 0);
    assert.equal(rightsObservations.galleryReads.length, 0);
    assert.equal(rightsObservations.selectionReads.length, 0);
    assert.equal(rightsObservations.submitPosts.length, 1);
    assert.equal(rightsObservations.submitPosts[0].status, 200);
    const submitOnlyBody = JSON.parse(rightsObservations.submitPosts[0].body);
    assert.deepEqual(
      Object.keys(submitOnlyBody).sort(),
      ['expectedGuestId', 'expectedRevision', 'requestId', 'roundNo'].sort(),
    );
    assert.equal(
      submitOnlyBody.expectedGuestId,
      submitOnlyMetadata.body.guestId,
    );
    assert.equal(Object.hasOwn(submitOnlyBody, 'photoIds'), false);

    const rightsSubmissions = await api(
      worker,
      base,
      '/api/v1/albums/' +
        albumId +
        '/shared-reviews/' +
        rightsReviewId +
        '/submissions',
      { ownerCookie },
    );
    assert.equal(rightsSubmissions.response.status, 200);
    assert.equal(rightsSubmissions.body.submissions.length, 1);
    assert.equal(rightsSubmissions.body.submissions[0].selectedCount, 1);

    const previewAlbumId = galleryFixture.context.album.id;
    const previewInvite = await issueSharedInvite({
      worker,
      base,
      ownerCookie,
      projectId: galleryFixture.context.project.id,
      albumId: previewAlbumId,
      address: '198.51.100.94',
      maxUses: 1,
      canView: true,
      canSelect: true,
      canSubmit: false,
    });
    const createPreviewReview = await api(
      worker,
      base,
      '/api/v1/albums/' + previewAlbumId + '/shared-reviews',
      {
        method: 'POST',
        ownerCookie,
        body: {
          requestId: randomUUID(),
          title: 'Processed gallery shared preview check',
          inviteIds: [previewInvite.inviteId],
          minimum: 1,
          maximum: 30,
          confirmShared: true,
        },
      },
    );
    assert.ok(
      createPreviewReview.response.status === 200 ||
        createPreviewReview.response.status === 201,
      'The Owner must explicitly create a separate shared subject for the processed gallery.',
    );
    const previewReviewId = createPreviewReview.body.review?.id;
    assert.match(previewReviewId ?? '', /^[0-9a-f-]{36}$/i);
    assert.deepEqual(createPreviewReview.body.review.inviteIds, [
      previewInvite.inviteId,
    ]);
    assert.equal(createPreviewReview.body.review.selectedCount, 0);

    const previewGuest = await exchangeGuestInvite({
      worker,
      base,
      invite: previewInvite,
      address: '198.51.100.95',
      displayName: 'Processed preview Guest',
    });
    const previewMetadataPath =
      '/api/guest/albums/' +
      previewAlbumId +
      '/shared-reviews/' +
      previewReviewId;
    const previewMetadata = await api(worker, base, previewMetadataPath, {
      guestCookie: previewGuest.header,
    });
    assert.equal(previewMetadata.response.status, 200);
    assert.equal(previewMetadata.body.canView, true);
    assert.equal(previewMetadata.body.canSelect, true);
    assert.equal(previewMetadata.body.selectedCount, 0);
    const emptyPreviewSelection = await getSharedSelectionItems(
      worker,
      base,
      previewAlbumId,
      previewReviewId,
      previewGuest,
    );
    assert.equal(emptyPreviewSelection.review.selectedCount, 0);
    assert.equal(
      emptyPreviewSelection.items.length,
      0,
      'The new shared subject must not import private picks.',
    );

    const previewAlbumPhotos = await getAllGalleryPhotos(
      worker,
      base,
      previewAlbumId,
      previewGuest,
    );
    const readyPreviewIndex = previewAlbumPhotos.findIndex(
      (photo) => photo.processing === 'succeeded' && photo.thumbnailUrl,
    );
    const readyPreviewPhoto = previewAlbumPhotos[readyPreviewIndex];
    const readyPreviewPageIndex = Math.floor(readyPreviewIndex / 24);
    assert.ok(
      readyPreviewPhoto,
      'Processing fixture blocker: no succeeded Guest thumbnail exists in the authorized album.',
    );
    const expectedThumbnailPath = new URL(readyPreviewPhoto.thumbnailUrl, base)
      .pathname;
    assert.equal(
      expectedThumbnailPath,
      '/api/guest/photos/' +
        readyPreviewPhoto.id +
        '/versions/' +
        readyPreviewPhoto.versionId +
        '/assets/thumbnail',
    );

    const previewContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addGuestCookie(previewContext, base, previewGuest);
    const previewPage = await previewContext.newPage();
    const previewObservations = {
      ownerApiPaths: [],
      privateSelectionReads: [],
      thumbnailResponses: [],
      originalAssetPaths: [],
    };
    await routeWorker(
      previewPage,
      () => worker,
      (incoming, url) => {
        if (url.pathname.startsWith('/api/v1/')) {
          previewObservations.ownerApiPaths.push(url.pathname);
        }
        if (
          incoming.method() === 'GET' &&
          url.pathname === '/api/guest/albums/' + previewAlbumId + '/selection'
        ) {
          previewObservations.privateSelectionReads.push(url.pathname);
        }
        if (url.pathname.endsWith('/assets/original')) {
          previewObservations.originalAssetPaths.push(url.pathname);
        }
        return false;
      },
      (incoming, url, response) => {
        if (
          incoming.method() === 'GET' &&
          url.pathname === expectedThumbnailPath
        ) {
          previewObservations.thumbnailResponses.push({
            path: url.pathname,
            status: response.status,
            contentType: response.headers.get('content-type'),
          });
        }
        return false;
      },
    );
    await previewPage.goto(
      base + '/guest/albums/' + previewAlbumId + '/shared/' + previewReviewId,
      { waitUntil: 'networkidle' },
    );
    await expect(
      previewPage.getByRole('heading', { name: '共同挑片' }),
    ).toBeVisible();
    for (let pageIndex = 0; pageIndex < readyPreviewPageIndex; pageIndex += 1) {
      await previewPage
        .getByRole('button', { name: '下一頁共同挑片照片' })
        .click();
      await expect(
        previewPage.getByText(new RegExp('第 ' + (pageIndex + 2) + ' 頁')),
      ).toBeVisible();
    }
    const expectedThumbnail = previewPage.locator(
      'img[src="' + readyPreviewPhoto.thumbnailUrl + '"]',
    );
    await expect(expectedThumbnail).toBeVisible();
    await expectedThumbnail.scrollIntoViewIfNeeded();
    await expect
      .poll(
        () =>
          expectedThumbnail.evaluate(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    const renderedThumbnail = await expectedThumbnail.evaluate((image) => ({
      currentSrc: image.currentSrc,
      complete: image.complete,
      naturalWidth: image.naturalWidth,
    }));
    assert.equal(renderedThumbnail.complete, true);
    assert.ok(renderedThumbnail.naturalWidth > 0);
    assert.equal(
      new URL(renderedThumbnail.currentSrc).pathname,
      expectedThumbnailPath,
    );
    assert.equal(previewObservations.thumbnailResponses.length, 1);
    assert.deepEqual(previewObservations.thumbnailResponses[0], {
      path: expectedThumbnailPath,
      status: 200,
      contentType: 'image/jpeg',
    });
    assert.equal(previewObservations.ownerApiPaths.length, 0);
    assert.equal(previewObservations.privateSelectionReads.length, 0);
    assert.equal(previewObservations.originalAssetPaths.length, 0);
    const guestResourceUrls = await previewPage
      .locator('a[href], img[src]')
      .evaluateAll((elements) =>
        elements.map(
          (element) =>
            element.getAttribute('href') ?? element.getAttribute('src') ?? '',
        ),
      );
    assert.equal(
      guestResourceUrls.some((url) => url.startsWith('/api/v1/')),
      false,
      'The Guest page must not link to Owner APIs.',
    );
    assert.equal(
      guestResourceUrls.some((url) =>
        /\/assets\/original(?:$|[?#])/i.test(url),
      ),
      false,
      'The Guest page must not link to originals.',
    );
    assert.equal(
      guestResourceUrls.some((url) =>
        /(?:^|\/)[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\//i.test(
          url,
        ),
      ),
      false,
      'The Guest page must not expose storage object-key paths.',
    );
    assert.equal(
      await previewPage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      'The real-preview Guest page must not overflow at 375px.',
    );
    await previewContext.close();

    await contextC.close();
    await contextD.close();
    await contextA.close();
    await contextB.close();
  } finally {
    await browser.close();
  }
}
