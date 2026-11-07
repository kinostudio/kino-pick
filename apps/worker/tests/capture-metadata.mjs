import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { guestPermissionNames } from '../../../packages/contracts/src/guest-access.ts';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { jpegFixture } from './image-fixtures.mjs';

async function jsonAt(response, status, label) {
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  assert.equal(
    response.status,
    status,
    `${label}: ${body?.error?.code ?? (await response.clone().text())}`,
  );
  return body;
}

async function errorAt(response, status, code, label) {
  const body = await jsonAt(response, status, label);
  assert.equal(body?.error?.code, code, label);
}

function secureGuestCookie(response) {
  const header = response.headers.get('set-cookie') ?? '';
  const match = /^__Host-kino_guest=([a-f0-9]{64});/.exec(header);
  assert.ok(match, 'Guest exchange returns a secure Host cookie');
  assert.match(header, /(?:^|;\s*)Path=\//);
  assert.match(header, /(?:^|;\s*)HttpOnly(?:;|$)/);
  assert.match(header, /(?:^|;\s*)SameSite=Lax(?:;|$)/);
  assert.match(header, /(?:^|;\s*)Secure(?:;|$)/);
  assert.doesNotMatch(header, /(?:^|;\s*)Domain=/i);
  return '__Host-kino_guest=' + match[1];
}

function concat(...parts) {
  const bytes = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function exifJpegFixture() {
  const tiff = new Uint8Array(280);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  view.setUint16(8, 3, true);
  const entry = (offset, tag, type, count, value) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
  };
  entry(10, 0x0110, 2, 9, 144);
  entry(22, 0x8769, 4, 1, 52);
  entry(34, 0x8825, 4, 1, 224);
  view.setUint32(46, 0, true);
  view.setUint16(52, 6, true);
  entry(54, 0xa434, 2, 14, 156);
  entry(66, 0x829d, 5, 1, 176);
  entry(78, 0x829a, 5, 1, 184);
  entry(90, 0x8827, 3, 1, 200);
  entry(102, 0x927c, 7, 4, 268);
  entry(114, 0xa431, 2, 11, 192);
  view.setUint32(126, 0, true);
  tiff.set(new TextEncoder().encode('Nikon Z8\0'), 144);
  tiff.set(new TextEncoder().encode('NIKKOR 24-70\0'), 156);
  view.setUint32(176, 28, true);
  view.setUint32(180, 10, true);
  view.setUint32(184, 1, true);
  view.setUint32(188, 125, true);
  tiff.set(new TextEncoder().encode('SN-1234567\0'), 192);
  view.setUint16(224, 1, true);
  entry(226, 0x0002, 5, 3, 248);
  view.setUint32(238, 0, true);
  view.setUint32(248, 47, true);
  view.setUint32(252, 1, true);
  view.setUint32(256, 37, true);
  view.setUint32(260, 1, true);
  view.setUint32(264, 12, true);
  view.setUint32(268, 1, true);

  const exif = concat(new TextEncoder().encode('Exif\0\0'), tiff);
  const segmentLength = exif.length + 2;
  const base = jpegFixture();
  return concat(
    new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      segmentLength >> 8,
      segmentLength & 0xff,
    ]),
    exif,
    base.subarray(2),
  );
}

export async function testCaptureMetadata({
  db,
  request,
  owner,
  ownerCookie,
  storage,
  target,
}) {
  const source = exifJpegFixture();
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const ownerPost = async (path, body, status = 200) =>
    jsonAt(await request(path, 'POST', body, ownerCookie), status, path);
  const putAndProcess = async (sessionId, filename) => {
    const row = await db
      .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
      .bind(sessionId)
      .first();
    assert.ok(row?.object_key, filename + ' upload has a reserved object key');
    const put = await storage.put(row.object_key, source, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/jpeg' },
      sha256: Buffer.from(sourceHash, 'hex'),
    });
    assert.ok(put, filename + ' original was stored');
  };
  const process = async (assetId) => {
    const result = await runImageProcessingJob({
      jobId: assetId,
      jobs: new D1ImageProcessingRepository(db),
      objects: new R2ProcessingObjectStore(storage),
      processor: new LocalSharpImageProcessor(),
    });
    assert.equal(result.status, 'succeeded');
  };

  const first = await ownerPost(
    '/api/v1/uploads/init',
    {
      requestId: randomUUID(),
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      albumId: target.albumId,
      originalFilename: 'capture-metadata-v1.jpg',
      expectedBytes: source.byteLength,
      contentType: 'image/jpeg',
      sha256: sourceHash,
    },
    201,
  );
  const v1SessionId = first.uploadSession.id;
  assert.ok(v1SessionId);
  await ownerPost('/api/v1/uploads/' + v1SessionId + '/authorize', {
    requestId: randomUUID(),
  });
  await putAndProcess(v1SessionId, 'capture-metadata V1');
  const v1Complete = await ownerPost(
    '/api/v1/uploads/' + v1SessionId + '/complete',
    { requestId: randomUUID() },
  );
  const photoId = v1Complete.completion?.photoId;
  const v1Id = v1Complete.completion?.versionId;
  const v1AssetId = v1Complete.completion?.assetId;
  assert.ok(photoId && v1Id && v1AssetId);
  await process(v1AssetId);
  const currentHead = await db
    .prepare(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
    )
    .bind(photoId)
    .first();
  assert.deepEqual(currentHead, { version_id: v1Id, revision: 0 });

  const v2Init = await ownerPost(
    '/api/v1/photos/' + photoId + '/versions/init',
    {
      requestId: randomUUID(),
      originalFilename: 'capture-metadata-v2.jpg',
      expectedBytes: source.byteLength,
      contentType: 'image/jpeg',
      sha256: sourceHash,
      expectedRevision: Number(currentHead.revision),
      expectedCurrentVersionId: currentHead.version_id,
      changeType: 'replace_current',
      changeNote: 'Capture metadata authorization fixture',
      labels: [],
      confirm: true,
    },
    201,
  );
  const v2SessionId = v2Init.uploadSession?.id;
  assert.ok(v2SessionId);
  await ownerPost('/api/v1/uploads/' + v2SessionId + '/authorize', {
    requestId: randomUUID(),
  });
  await putAndProcess(v2SessionId, 'capture-metadata V2');
  const v2Complete = await ownerPost(
    '/api/v1/photos/' + photoId + '/versions/' + v2SessionId + '/complete',
    { requestId: randomUUID() },
  );
  const v2Id = v2Complete.versionId;
  assert.ok(v2Id && v2Complete.assetId);
  assert.equal(v2Complete.versionNo, 2);
  await process(v2Complete.assetId);
  const headBeforeSwitch = await db
    .prepare(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
    )
    .bind(photoId)
    .first();
  assert.deepEqual(headBeforeSwitch, { version_id: v1Id, revision: 0 });
  const switched = await ownerPost(
    '/api/v1/photos/' + photoId + '/versions/set-current',
    {
      requestId: randomUUID(),
      expectedRevision: Number(headBeforeSwitch.revision),
      expectedCurrentVersionId: headBeforeSwitch.version_id,
      versionId: v2Id,
      confirm: true,
    },
  );
  assert.equal(switched.changed, true);
  assert.equal(switched.current?.versionId, v2Id);
  assert.equal(
    switched.current?.revision,
    Number(headBeforeSwitch.revision) + 1,
  );

  const foreign = {
    ownerId: randomUUID(),
    workspaceId: randomUUID(),
    projectId: randomUUID(),
    albumId: randomUUID(),
    photoId: randomUUID(),
    versionId: randomUUID(),
  };
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        foreign.ownerId,
        'Foreign workspace fixture',
        foreign.ownerId + '@capture-fixture.invalid',
        1,
        now,
        now,
      ),
    db
      .prepare(
        'INSERT INTO workspaces(id,name,owner_user_id,quota_bytes) VALUES(?,?,?,?)',
      )
      .bind(
        foreign.workspaceId,
        'Foreign capture metadata workspace',
        foreign.ownerId,
        1000000,
      ),
    db
      .prepare(
        "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
      )
      .bind(foreign.projectId, foreign.workspaceId, 'Foreign capture fixture'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(
        foreign.albumId,
        foreign.workspaceId,
        foreign.projectId,
        'Foreign capture fixture',
      ),
    db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(
        foreign.photoId,
        foreign.workspaceId,
        foreign.projectId,
        foreign.albumId,
        'foreign-capture-fixture.jpg',
      ),
    db
      .prepare(
        "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,?,'image/jpeg',2,3,'private')",
      )
      .bind(
        foreign.versionId,
        foreign.workspaceId,
        foreign.photoId,
        foreign.ownerId,
        sourceHash,
        source.byteLength,
      ),
  ]);
  assert.ok(
    await db
      .prepare(
        'SELECT v.id FROM photo_versions v JOIN workspaces w ON w.id=v.workspace_id WHERE v.id=? AND w.owner_user_id<>?',
      )
      .bind(foreign.versionId, owner)
      .first(),
    'foreign workspace contains a real photo version row',
  );

  const capturePath = (targetPhotoId, targetVersionId) =>
    '/api/v1/photos/' +
    targetPhotoId +
    '/versions/' +
    targetVersionId +
    '/capture-metadata';
  const guestCapturePath = (targetPhotoId, targetVersionId) =>
    '/api/guest/photos/' +
    targetPhotoId +
    '/versions/' +
    targetVersionId +
    '/capture-metadata';
  const expected = {
    cameraModel: 'Nikon Z8',
    lensModel: 'NIKKOR 24-70',
    fNumber: 2.8,
    exposureSeconds: 1 / 125,
    iso: 200,
  };
  const ownerResponse = await request(
    capturePath(photoId, v2Id),
    'GET',
    undefined,
    ownerCookie,
  );
  const ownerCurrent = await jsonAt(
    ownerResponse,
    200,
    'Owner reads current capture metadata',
  );
  assert.deepEqual(ownerCurrent, expected);
  assert.equal(ownerResponse.headers.get('Cache-Control'), 'private, no-store');
  await errorAt(
    await request(capturePath(photoId, v2Id)),
    401,
    'AUTH_REQUIRED',
    'unauthenticated Owner cannot read capture metadata',
  );
  await errorAt(
    await request(
      capturePath(foreign.photoId, foreign.versionId),
      'GET',
      undefined,
      ownerCookie,
    ),
    404,
    'NOT_FOUND',
    'Owner cannot read a photo version from a foreign workspace',
  );

  const permissions = (enabled) =>
    Object.fromEntries(
      guestPermissionNames.map((name) => [name, enabled.includes(name)]),
    );
  const issueAndExchange = async (albumId, mask, name) => {
    const issued = await ownerPost(
      '/api/v1/projects/' + target.projectId + '/invites',
      {
        requestId: randomUUID(),
        albumIds: [albumId],
        accessMode: 'link_only',
        permissions: permissions(mask),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        maxUses: 1,
      },
    );
    assert.ok(issued.invite?.inviteId && issued.token);
    const response = await request('/api/guest/exchange', 'POST', {
      requestId: randomUUID(),
      token: issued.token,
      displayName: name,
    });
    await jsonAt(response, 200, name + ' exchange');
    return secureGuestCookie(response);
  };
  const viewOnly = await issueAndExchange(
    target.albumId,
    ['can_view'],
    'Capture metadata view-only fixture',
  );
  const compare = await issueAndExchange(
    target.albumId,
    ['can_view', 'can_compare_versions'],
    'Capture metadata compare fixture',
  );
  const wrongAlbum = await ownerPost(
    '/api/v1/projects/' + target.projectId + '/albums',
    { name: 'Capture metadata wrong album', requestId: randomUUID() },
    201,
  );
  await ownerPost('/api/v1/albums/' + wrongAlbum.album.id + '/activate', {
    requestId: randomUUID(),
    expectedRevision: wrongAlbum.album.revision,
    confirmActivate: true,
  });
  const wrongInvite = await issueAndExchange(
    wrongAlbum.album.id,
    ['can_view', 'can_compare_versions'],
    'Capture metadata wrong album fixture',
  );

  const currentGuest = await jsonAt(
    await request(guestCapturePath(photoId, v2Id), 'GET', undefined, compare),
    200,
    'Guest with view and compare reads current capture metadata',
  );
  assert.deepEqual(currentGuest, expected);
  const currentViewOnly = await jsonAt(
    await request(guestCapturePath(photoId, v2Id), 'GET', undefined, viewOnly),
    200,
    'view-only Guest reads current capture metadata',
  );
  assert.deepEqual(currentViewOnly, expected);
  await errorAt(
    await request(guestCapturePath(photoId, v1Id), 'GET', undefined, viewOnly),
    401,
    'GUEST_ACCESS_REQUIRED',
    'Guest without compare permission cannot read historical metadata',
  );
  const historicalGuest = await jsonAt(
    await request(guestCapturePath(photoId, v1Id), 'GET', undefined, compare),
    200,
    'Guest with view and compare reads historical capture metadata',
  );
  assert.deepEqual(historicalGuest, expected);
  await errorAt(
    await request(
      guestCapturePath(photoId, v2Id),
      'GET',
      undefined,
      wrongInvite,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'Guest invitation for another album cannot read this photo',
  );

  const originalKeys = (
    await db
      .prepare(
        "SELECT object_key FROM photo_assets WHERE photo_id=? AND asset_kind='original' ORDER BY version_id",
      )
      .bind(photoId)
      .all()
  ).results.map((row) => row.object_key);
  for (const body of [
    ownerCurrent,
    currentGuest,
    currentViewOnly,
    historicalGuest,
  ]) {
    assert.deepEqual(
      body,
      expected,
      'capture response contains only allowlisted fields',
    );
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /SN-1234567|47|37|12/u);
    for (const key of originalKeys) assert.ok(!serialized.includes(key));
    assert.doesNotMatch(
      serialized,
      /objectKey|storageNodeId|checksum|assetId/u,
    );
  }

  return {
    checks: [
      'Owner session is required and a foreign-workspace photo version returns NOT_FOUND',
      'view-only Guest reads current metadata but cannot read history; view plus compare allows both',
      'Guest invite for another album cannot read the photo',
      'current and historical responses contain only allowlisted camera metadata',
      'unauthorized R2 read count is not observable through native Miniflare bindings (not_checked)',
    ],
  };
}
