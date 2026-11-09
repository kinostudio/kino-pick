import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { pngFixture } from './image-fixtures.mjs';

export async function photoDisplayLeaseChecks({
  db,
  storage,
  request,
  owner,
  ownerCookie,
  base,
  authSecret,
  fixture,
}) {
  const counts = async () => ({
    views: (
      await db.prepare('SELECT count(*) AS n FROM human_photo_views').first()
    ).n,
    frontier: createHash('sha256')
      .update(
        JSON.stringify(
          (
            await db
              .prepare('SELECT * FROM album_human_activity ORDER BY album_id')
              .all()
          ).results,
        ),
      )
      .digest('hex'),
    objects: createHash('sha256')
      .update(
        JSON.stringify(
          (await storage.list()).objects
            .map(({ key, size }) => ({ key, size }))
            .sort((a, b) => a.key.localeCompare(b.key)),
        ),
      )
      .digest('hex'),
  });
  const body = (actor) => ({
    documentId: randomUUID(),
    photoId: fixture.photoId,
    versionId: fixture.versionId,
    expectedActorId: actor,
  });
  async function api(
    path,
    expected,
    { cookie, payload, method = 'POST', origin = base, headers = {} } = {},
  ) {
    const response = await request(path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const value = await response.json().catch(() => null);
    const code = /^[A-Z_]+$/.test(value?.error?.code ?? '')
      ? value.error.code
      : 'UNKNOWN';
    assert.equal(
      response.status,
      expected,
      `display lease ${method}: expected ${expected}, got ${response.status} (${code})`,
    );
    return value;
  }
  const ownerPath = '/api/v1/albums/' + fixture.albumId + '/display-leases';
  const guestPath = '/api/guest/albums/' + fixture.albumId + '/display-leases';
  function grant(value, sent, expectedAlbum = fixture.albumId) {
    assert.deepEqual(
      Object.keys(value).sort(),
      [
        'albumId',
        'displayForMs',
        'documentId',
        'issuedAt',
        'photoId',
        'protectedUntilAt',
        'versionId',
      ].sort(),
    );
    for (const name of ['documentId', 'photoId', 'versionId'])
      assert.equal(value[name], sent[name]);
    assert.equal(value.albumId, expectedAlbum);
    assert.ok(
      Number.isSafeInteger(value.displayForMs) &&
        value.displayForMs >= 1000 &&
        value.displayForMs <= 600000,
    );
    assert.ok(
      Date.parse(value.protectedUntilAt) - Date.parse(value.issuedAt) >=
        value.displayForMs + 60000,
    );
    return value;
  }
  const capability = await api('/api/human-views/capabilities', 200, {
    method: 'GET',
  });
  assert.deepEqual(capability.displayLease, {
    protocol: 1,
    displayForMs: 600000,
  });
  const draftAlbum = (
    await api('/api/v1/projects/' + fixture.projectId + '/albums', 201, {
      cookie: ownerCookie,
      payload: {
        name: 'Finite display draft fixture',
        requestId: randomUUID(),
      },
    })
  ).album;
  assert.equal(draftAlbum.state, 'draft');
  const pixels = pngFixture(),
    checksum = createHash('sha256').update(pixels).digest('hex');
  const upload = (
    await api('/api/v1/uploads/init', 201, {
      cookie: ownerCookie,
      payload: {
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        albumId: draftAlbum.id,
        originalFilename: 'finite-draft.png',
        expectedBytes: pixels.byteLength,
        contentType: 'image/png',
        sha256: checksum,
        requestId: randomUUID(),
      },
    })
  ).uploadSession;
  await api('/api/v1/uploads/' + upload.id + '/authorize', 200, {
    cookie: ownerCookie,
    payload: { requestId: randomUUID() },
  });
  const uploadKey = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(upload.id)
    .first();
  assert.ok(uploadKey);
  await storage.put(uploadKey.object_key, new Uint8Array(pixels), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: checksum,
  });
  const completed = (
    await api('/api/v1/uploads/' + upload.id + '/complete', 200, {
      cookie: ownerCookie,
      payload: { requestId: randomUUID() },
    })
  ).completion;
  const processed = await runImageProcessingJob({
    jobId: completed.assetId,
    jobs: new D1ImageProcessingRepository(db),
    objects: new R2ProcessingObjectStore(storage),
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processed.status, 'succeeded');
  const draftPhoto = await db
    .prepare('SELECT photo_id,version_id FROM photo_assets WHERE id=?')
    .bind(completed.assetId)
    .first();
  assert.ok(draftPhoto);
  const before = await counts();
  const draftRequest = {
    ...body(owner),
    photoId: draftPhoto.photo_id,
    versionId: draftPhoto.version_id,
  };
  grant(
    await api('/api/v1/albums/' + draftAlbum.id + '/display-leases', 200, {
      cookie: ownerCookie,
      payload: draftRequest,
    }),
    draftRequest,
    draftAlbum.id,
  );
  const ownerRequest = body(owner);
  const ownerGrant = grant(
    await api(ownerPath, 200, { cookie: ownerCookie, payload: ownerRequest }),
    ownerRequest,
  );
  assert.equal(ownerGrant.displayForMs, 600000);
  const guestRequest = body(fixture.viewGuest.guestId);
  grant(
    await api(guestPath, 200, {
      cookie: 'kino_guest=' + fixture.viewGuest.cookie,
      payload: guestRequest,
    }),
    guestRequest,
  );
  const protection = await db
    .prepare(
      'SELECT protected_until_ms FROM album_read_protections WHERE album_id=?',
    )
    .bind(fixture.albumId)
    .first();
  assert.equal(
    protection.protected_until_ms,
    Date.parse(ownerGrant.protectedUntilAt),
  );

  await api(ownerPath, 401, { payload: ownerRequest });
  await api(guestPath, 401, { payload: guestRequest });
  await api(guestPath, 401, {
    cookie: 'kino_guest=' + fixture.downloadGuest.cookie,
    payload: body(fixture.downloadGuest.guestId),
  });
  await api(ownerPath.replace(fixture.albumId, fixture.unsharedAlbumId), 404, {
    cookie: ownerCookie,
    payload: ownerRequest,
  });
  await api(guestPath.replace(fixture.albumId, fixture.unsharedAlbumId), 401, {
    cookie: 'kino_guest=' + fixture.viewGuest.cookie,
    payload: guestRequest,
  });
  await api(ownerPath, 404, {
    cookie: ownerCookie,
    payload: { ...ownerRequest, versionId: randomUUID() },
  });
  await api(guestPath, 401, {
    cookie: 'kino_guest=' + fixture.viewGuest.cookie,
    payload: { ...guestRequest, versionId: randomUUID() },
  });
  await api(ownerPath, 409, {
    cookie: ownerCookie,
    payload: { ...ownerRequest, expectedActorId: randomUUID() },
  });
  await api(guestPath, 401, {
    cookie: 'kino_guest=' + fixture.viewGuest.cookie,
    payload: { ...guestRequest, expectedActorId: randomUUID() },
  });
  await api(ownerPath, 400, {
    cookie: ownerCookie,
    payload: { ...ownerRequest, documentId: 'invalid' },
  });
  await api(ownerPath, 400, {
    cookie: ownerCookie,
    payload: { ...ownerRequest, extra: true },
  });
  await api(ownerPath + '?unexpected=1', 400, {
    cookie: ownerCookie,
    payload: ownerRequest,
  });
  await api(ownerPath, 403, {
    cookie: ownerCookie,
    payload: ownerRequest,
    origin: 'https://foreign.invalid',
  });
  await api(ownerPath, 403, {
    cookie: ownerCookie,
    payload: ownerRequest,
    headers: { Purpose: 'prefetch' },
  });

  const shortId = randomUUID(),
    shortToken = randomUUID(),
    now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(shortId, shortToken, owner, now + 90000, now, now)
    .run();
  const shortCookie =
    'kino-owner.session_token=' +
    encodeURIComponent(
      shortToken + '.' + (await makeSignature(shortToken, authSecret)),
    );
  const shortRequest = body(owner);
  const shortGrant = grant(
    await api(ownerPath, 200, { cookie: shortCookie, payload: shortRequest }),
    shortRequest,
  );
  assert.ok(shortGrant.displayForMs <= 90000);
  await db.prepare('DELETE FROM owner_sessions WHERE id=?').bind(shortId).run();
  await api(ownerPath, 401, { cookie: shortCookie, payload: shortRequest });

  const invites = await api(
    '/api/v1/projects/' + fixture.projectId + '/invites',
    200,
    { method: 'GET', cookie: ownerCookie },
  );
  const permissions = invites.invites.find(
    (item) => item.id === fixture.viewGuest.inviteId,
  )?.permissions;
  assert.ok(permissions);
  const issued = await api(
    '/api/v1/projects/' + fixture.projectId + '/invites',
    200,
    {
      cookie: ownerCookie,
      payload: {
        requestId: randomUUID(),
        albumIds: [fixture.albumId],
        accessMode: 'link_only',
        permissions,
        expiresAt: new Date(Date.now() + 90000).toISOString(),
        maxUses: 1,
      },
    },
  );
  const exchanged = await request('/api/guest/exchange', {
    method: 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(),
      token: issued.token,
      displayName: 'Finite lease synthetic Guest',
    }),
  });
  assert.equal(exchanged.status, 200);
  const newSecret = /kino_guest=([a-f0-9]{64})/.exec(
    exchanged.headers.get('set-cookie') ?? '',
  )?.[1];
  assert.ok(newSecret);
  const guestSession = await db
    .prepare('SELECT guest_id FROM guest_sessions WHERE invite_id=?')
    .bind(issued.invite.inviteId)
    .first();
  assert.ok(guestSession);
  const shortGuestRequest = body(guestSession.guest_id);
  const shortGuestGrant = grant(
    await api(guestPath, 200, {
      cookie: 'kino_guest=' + newSecret,
      payload: shortGuestRequest,
    }),
    shortGuestRequest,
  );
  assert.ok(shortGuestGrant.displayForMs <= 90000);
  await api('/api/v1/invites/' + issued.invite.inviteId + '/revoke', 200, {
    cookie: ownerCookie,
    payload: { requestId: randomUUID(), confirmRevoke: true },
  });
  await api(guestPath, 401, {
    cookie: 'kino_guest=' + newSecret,
    payload: shortGuestRequest,
  });
  assert.deepEqual(
    await counts(),
    before,
    'leases never manufacture human views/frontiers or mutate R2 objects',
  );
  return [
    'realOwnerAndViewGuestGrant',
    'realDraftOwnerUploadAndGrant',
    'privateMetadataOnly',
    'noHumanOrR2Mutation',
    'scopeAndPermissionDenials',
    'originInputAndPrefetchDenials',
    'ownerSessionExpiryAndRevocation',
    'guestExpiryAndInviteRevocation',
  ];
}
