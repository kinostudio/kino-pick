import { runPhotoVersionHeadsBrowserChecks } from './photo-version-heads-browser.mjs';
import assert from 'node:assert/strict';
import { activateDraftAlbumFixture } from './activate-album-fixture.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';

const canView = 1;
const canSelect = 8;
const canRate = 16;
const canFavorite = 32;
const canCompareVersions = 2048;
const currentChangeAction = 'photo.version_current_changed';
const hashGuestSession = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const hashInviteToken = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function photoVersionHeadChecks({
  db,
  mf,
  check,
  owner,
  cookies,
  base,
  galleryFixture,
  request,
}) {
  const context = galleryFixture.context;
  const workspaceId = context.workspace.id;
  const projectId = context.project.id;
  const storage = galleryFixture.storage;
  const ownerCookie = cookies?.values?.get('kino-owner.session_token');
  assert.ok(ownerCookie, 'The photo-version helper requires the Owner cookie');
  assert.ok(storage, 'The gallery fixture must include its R2 test bucket');

  const authenticated = await request('/api/auth/get-session', {
    headers: { Cookie: cookies.headers() },
  });
  assert.equal(authenticated.status, 200);
  const authenticatedBody = await authenticated.json();
  assert.equal(authenticatedBody?.user?.id, owner);
  assert.ok(authenticatedBody?.session?.id);
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND id=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, authenticatedBody.session.id, Date.now() + 60000)
    .first();
  assert.ok(ownerSession, 'Expected the current authenticated Owner session');

  const versionsWorker = await mf.getWorker('photo-versions-test');
  const versionUploadsWorker = await mf.getWorker('version-uploads-test');
  const guestWorker = await mf.getWorker('guest-feedback-test');
  const selectionWorker = await mf.getWorker('guest-selection-test');
  const processingJobs = new D1ImageProcessingRepository(db);
  const processingObjects = new R2ProcessingObjectStore(storage);
  const imageProcessor = new LocalSharpImageProcessor();

  let albumId;
  let photoId;
  let neighborPhotoId;
  let neighborVersionId;
  let version1Id;
  let version2;
  let version3;
  let compareGuest;
  let viewOnlyGuest;
  let winningIntent;
  let switchBackIntent;
  let auditRetryIntent;
  let beforeSwitchSnapshot;
  let finalChangedResult;
  let currentNoop;

  const send = (worker, path, options = {}) => {
    const method = options.method ?? 'GET';
    const headers = { ...(options.headers ?? {}) };
    if (options.guest) headers.Cookie = 'kino_guest=' + options.guest.secret;
    else if (!options.anonymous) headers.Cookie = cookies.headers();
    if (method !== 'GET' && method !== 'HEAD') {
      if (!headers.Origin) headers.Origin = base;
      if (!headers['Content-Type'])
        headers['Content-Type'] = 'application/json';
    }
    const init = { method, headers };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    return worker.fetch(new Request(new URL(path, base), init));
  };
  const readJson = async (response, expectedStatus) => {
    const text = await response.text();
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
    if (expectedStatus !== undefined)
      assert.equal(response.status, expectedStatus, JSON.stringify(value));
    return value;
  };
  const errorCode = (body) => body?.error?.code ?? body?.error;
  const rows = async (sql, ...values) => {
    let statement = db.prepare(sql);
    if (values.length) statement = statement.bind(...values);
    return (await statement.all()).results;
  };
  const currentHead = () =>
    db
      .prepare(
        'SELECT photo_id,workspace_id,project_id,album_id,version_id,revision,last_command_id FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(photoId)
      .first();
  const ownerVersionsPath = () => `/api/v1/photos/${photoId}/versions`;
  const setCurrentPath = () => `/api/v1/photos/${photoId}/versions/set-current`;
  const galleryPath = () => `/api/v1/albums/${albumId}/photos`;
  const setIntent = (
    requestId,
    expectedRevision,
    expectedCurrentVersionId,
    versionId,
  ) => ({
    requestId,
    expectedRevision,
    expectedCurrentVersionId,
    versionId,
    confirm: true,
  });
  const setCurrent = (intent) =>
    send(versionsWorker, setCurrentPath(), { method: 'POST', body: intent });

  async function createVersionAlbum() {
    const response = await request(`/api/v1/projects/${projectId}/albums`, {
      method: 'POST',
      headers: {
        Cookie: cookies.headers(),
        Origin: base,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Photo version head fixture ' + randomUUID(),
        requestId: randomUUID(),
      }),
    });
    const body = await readJson(response, 201);
    const album = body.album;
    assert.ok(album?.id);
    await activateDraftAlbumFixture(db, album.id);
    return album;
  }

  async function createPhoto(album, filename = 'versioned-fixture.jpg') {
    const id = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(id, workspaceId, projectId, album.id, filename)
      .run();
    return id;
  }

  async function createGuest(mask) {
    const inviteId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 60 * 60 * 1000;
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        workspaceId,
        projectId,
        hashInviteToken(token),
        mask,
        expiresAt,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, workspaceId, projectId, albumId)
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId)
      .run();
    const guestId = randomUUID();
    await db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(guestId, inviteId, 'Photo version fixture')
      .run();
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(
        sessionId,
        inviteId,
        guestId,
        hashGuestSession(secret),
        Math.min(expiresAt, Date.now() + 10 * 60 * 1000),
      )
      .run();
    return { inviteId, albumId, guestId, sessionId, secret };
  }

  async function insertAndProcessVersion(versionNo, parentVersionId) {
    const versionId = randomUUID();
    const assetId = randomUUID();
    const bytes = await sharp({
      create: { width: 48, height: 24, channels: 3, background: '#4a8db8' },
    })
      .png()
      .toBuffer();
    const checksum = sha256(bytes);
    const objectKey = `${workspaceId}/${projectId}/${albumId}/${assetId}/original`;
    await storage.put(objectKey, new Uint8Array(bytes), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/png' },
      sha256: checksum,
    });
    const inserted = await db.batch([
      db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,?,?,?,?,?,?,48,24,'private')",
        )
        .bind(
          versionId,
          workspaceId,
          photoId,
          versionNo,
          parentVersionId,
          owner,
          checksum,
          bytes.byteLength,
          'image/png',
        ),
      db
        .prepare(
          "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'primary','original',?,?,?,?,'private')",
        )
        .bind(
          assetId,
          workspaceId,
          photoId,
          versionId,
          objectKey,
          bytes.byteLength,
          'image/png',
          checksum,
        ),
      db
        .prepare(
          'UPDATE workspace_storage_usage SET used_bytes=used_bytes+? WHERE workspace_id=?',
        )
        .bind(bytes.byteLength, workspaceId),
      db
        .prepare(
          "UPDATE storage_nodes SET used_bytes=used_bytes+? WHERE id='primary'",
        )
        .bind(bytes.byteLength),
    ]);
    assert.equal(inserted[2]?.meta.changes, 1);
    assert.equal(inserted[3]?.meta.changes, 1);
    const processed = await runImageProcessingJob({
      jobId: assetId,
      jobs: processingJobs,
      objects: processingObjects,
      processor: imageProcessor,
    });
    assert.equal(processed.status, 'succeeded');
    const derivatives = await rows(
      "SELECT asset_kind FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
      versionId,
    );
    assert.deepEqual(
      derivatives.map((asset) => asset.asset_kind),
      ['preview', 'thumbnail'],
    );
    return { versionId, assetId, checksum };
  }

  const versionUploadBytes = await sharp({
    create: { width: 48, height: 24, channels: 3, background: '#4a8db8' },
  })
    .png()
    .toBuffer();
  const versionUploadHash = sha256(versionUploadBytes);

  async function uploadVersion(versionNo, processDerivatives = false) {
    const initRequestId = randomUUID();
    const initBody = {
      requestId: initRequestId,
      originalFilename: 'version-' + versionNo + '.png',
      expectedBytes: versionUploadBytes.byteLength,
      contentType: 'image/png',
      sha256: versionUploadHash,
      expectedRevision: 0,
      expectedCurrentVersionId: version1Id,
      changeType: 'replace_current',
      changeNote: 'Photo version acceptance fixture ' + versionNo,
      labels: [],
      confirm: true,
    };
    const initialized = await readJson(
      await send(
        versionUploadsWorker,
        '/api/v1/photos/' + photoId + '/versions/init',
        { method: 'POST', body: initBody },
      ),
      201,
    );
    const session = initialized.uploadSession;
    assert.ok(session?.id);
    assert.deepEqual(initialized.target, {
      photoId,
      parentVersionId: version1Id,
      expectedRevision: 0,
      changeType: 'replace_current',
      changeNote: 'Photo version acceptance fixture ' + versionNo,
      labels: [],
    });

    const authorization = await readJson(
      await send(
        versionUploadsWorker,
        '/api/v1/uploads/' + session.id + '/authorize',
        { method: 'POST', body: { requestId: randomUUID() } },
      ),
      200,
    );
    assert.equal(
      authorization.uploadAuthorization.contentLength,
      versionUploadBytes.byteLength,
    );
    const keyRow = await db
      .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
      .bind(session.id)
      .first();
    assert.ok(keyRow?.object_key);
    await storage.put(keyRow.object_key, new Uint8Array(versionUploadBytes), {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'image/png' },
      sha256: Buffer.from(versionUploadHash, 'hex'),
    });

    const completed = await readJson(
      await send(
        versionUploadsWorker,
        '/api/v1/photos/' + photoId + '/versions/' + session.id + '/complete',
        { method: 'POST', body: { requestId: randomUUID() } },
      ),
      200,
    );
    assert.equal(completed.photoId, photoId);
    assert.equal(completed.versionNo, versionNo);
    assert.equal(completed.parentVersionId, version1Id);
    assert.equal(completed.changeType, 'replace_current');
    assert.equal(completed.status, 'completed');

    if (processDerivatives) {
      const processed = await runImageProcessingJob({
        jobId: completed.assetId,
        jobs: processingJobs,
        objects: processingObjects,
        processor: imageProcessor,
      });
      assert.equal(processed.status, 'succeeded');
      const derivatives = await rows(
        "SELECT asset_kind FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
        completed.versionId,
      );
      assert.deepEqual(
        derivatives.map((asset) => asset.asset_kind),
        ['preview', 'thumbnail'],
      );
    }

    return {
      id: completed.versionId,
      versionId: completed.versionId,
      assetId: completed.assetId,
      versionNo: completed.versionNo,
    };
  }
  const photoStateSnapshot = async () => ({
    versions: await rows(
      'SELECT * FROM photo_versions WHERE photo_id=? ORDER BY version_no,id',
      photoId,
    ),
    assets: await rows(
      'SELECT * FROM photo_assets WHERE photo_id=? ORDER BY version_id,asset_kind,id',
      photoId,
    ),
    selectionState: await rows(
      'SELECT * FROM guest_selection_state WHERE photo_id=? ORDER BY invite_id,guest_id',
      photoId,
    ),
    selectionCommands: await rows(
      'SELECT * FROM guest_selection_commands WHERE photo_id=? ORDER BY id',
      photoId,
    ),
    selectionResults: await rows(
      'SELECT r.* FROM guest_selection_results r JOIN guest_selection_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
      photoId,
    ),
    ratingState: await rows(
      'SELECT * FROM guest_rating_state WHERE photo_id=? ORDER BY invite_id,guest_id',
      photoId,
    ),
    favoriteState: await rows(
      'SELECT * FROM guest_favorite_state WHERE photo_id=? ORDER BY invite_id,guest_id',
      photoId,
    ),
    feedbackCommands: await rows(
      'SELECT * FROM guest_feedback_commands WHERE photo_id=? ORDER BY id',
      photoId,
    ),
    feedbackResults: await rows(
      'SELECT r.* FROM guest_feedback_results r JOIN guest_feedback_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
      photoId,
    ),
    auditEvents: await rows(
      'SELECT * FROM audit_events WHERE photo_id=? ORDER BY event_id',
      photoId,
    ),
  });
  await check(
    'photo-version capability remains off by default and the test Worker explicitly enables the API',
    async () => {
      const off = await readJson(
        await request('/api/v1/photo-versions/capabilities', {
          headers: { Cookie: cookies.headers() },
        }),
        200,
      );
      assert.deepEqual(off, { enabled: false });
      const on = await readJson(
        await send(versionsWorker, '/api/v1/photo-versions/capabilities'),
        200,
      );
      assert.deepEqual(on, { enabled: true });
      const anonymous = await send(
        versionsWorker,
        '/api/v1/photo-versions/capabilities',
        { anonymous: true },
      );
      assert.equal(anonymous.status, 401);
    },
  );

  await check(
    'isolated fixture creates V1 and uploaded V2, then queues sibling versions through the authorized upload workflow',
    async () => {
      const album = await createVersionAlbum();
      albumId = album.id;
      photoId = await createPhoto(album);
      const version1 = await insertAndProcessVersion(1, null);
      version1Id = version1.versionId;
      version2 = await uploadVersion(2, true);
      version3 = await uploadVersion(3);
      for (let versionNo = 4; versionNo <= 27; versionNo++)
        await uploadVersion(versionNo);

      const primaryPhotoId = photoId;
      neighborPhotoId = await createPhoto(
        album,
        'versioned-fixture-neighbor.jpg',
      );
      photoId = neighborPhotoId;
      neighborVersionId = (await insertAndProcessVersion(1, null)).versionId;
      photoId = primaryPhotoId;

      const initialHead = await currentHead();
      assert.deepEqual(initialHead, {
        photo_id: photoId,
        workspace_id: workspaceId,
        project_id: projectId,
        album_id: albumId,
        version_id: version1Id,
        revision: 0,
        last_command_id: null,
      });

      compareGuest = await createGuest(
        canView + canSelect + canRate + canFavorite + canCompareVersions,
      );
      viewOnlyGuest = await createGuest(canView);
      await readJson(
        await send(
          selectionWorker,
          `/api/guest/albums/${albumId}/photos/${photoId}/selection`,
          {
            method: 'PUT',
            guest: compareGuest,
            body: {
              requestId: randomUUID(),
              versionId: version1Id,
              selected: true,
            },
          },
        ),
        200,
      );
      await readJson(
        await send(
          guestWorker,
          `/api/guest/albums/${albumId}/photos/${photoId}/rating`,
          {
            method: 'PUT',
            guest: compareGuest,
            body: { requestId: randomUUID(), versionId: version1Id, stars: 4 },
          },
        ),
        200,
      );
      await readJson(
        await send(
          guestWorker,
          `/api/guest/albums/${albumId}/photos/${photoId}/favorite`,
          {
            method: 'PUT',
            guest: compareGuest,
            body: {
              requestId: randomUUID(),
              versionId: version1Id,
              favored: true,
            },
          },
        ),
        200,
      );
    },
  );

  await check(
    'Owner version listing paginates at 24, no-op replay preserves the head, and unready targets are rejected',
    async () => {
      const firstPage = await readJson(
        await send(versionsWorker, ownerVersionsPath()),
        200,
      );
      assert.equal(firstPage.photoId, photoId);
      assert.equal(firstPage.versions.length, 24);
      assert.ok(firstPage.nextCursor);
      assert.ok(firstPage.nextCursor.length <= 2048);
      assert.deepEqual(firstPage.current, {
        versionId: version1Id,
        revision: 0,
      });
      assert.equal(firstPage.currentVersion.id, version1Id);
      assert.equal(firstPage.currentVersion.versionNo, 1);
      assert.equal(firstPage.currentVersion.processing, 'succeeded');
      assert.equal(
        firstPage.currentVersion.previewUrl,
        '/api/v1/photos/' +
          photoId +
          '/versions/' +
          version1Id +
          '/assets/preview',
      );
      assert.equal(
        firstPage.versions.some((version) => version.id === version1Id),
        false,
        'The current head is older than the first 24-row page',
      );

      const secondPage = await readJson(
        await send(
          versionsWorker,
          ownerVersionsPath() +
            '?cursor=' +
            encodeURIComponent(firstPage.nextCursor),
        ),
        200,
      );
      assert.equal(secondPage.photoId, photoId);
      assert.deepEqual(secondPage.current, firstPage.current);
      assert.deepEqual(secondPage.currentVersion, firstPage.currentVersion);
      assert.equal(secondPage.versions.length, 3);
      assert.equal(secondPage.nextCursor, null);
      const legacyCursor = Buffer.from(
        JSON.stringify({
          photoId,
          versionNo: firstPage.versions.at(-1).versionNo,
        }),
        'utf8',
      ).toString('base64url');
      const legacySecondPage = await readJson(
        await send(
          versionsWorker,
          ownerVersionsPath() + '?cursor=' + encodeURIComponent(legacyCursor),
        ),
        200,
      );
      assert.deepEqual(legacySecondPage.current, firstPage.current);
      assert.deepEqual(
        legacySecondPage.currentVersion,
        firstPage.currentVersion,
      );
      const allVersions = [...firstPage.versions, ...secondPage.versions];
      assert.equal(allVersions.length, 27);
      assert.equal(new Set(allVersions.map((item) => item.id)).size, 27);
      assert.deepEqual(
        allVersions.map((item) => item.versionNo).sort((a, b) => a - b),
        Array.from({ length: 27 }, (_, index) => index + 1),
      );
      const readyV1 = allVersions.find((item) => item.id === version1Id);
      const readyV2 = allVersions.find(
        (item) => item.id === version2.versionId,
      );
      assert.equal(readyV1?.processing, 'succeeded');
      assert.equal(readyV2?.processing, 'succeeded');
      assert.equal(
        readyV2?.thumbnailUrl,
        `/api/v1/photos/${photoId}/versions/${version2.versionId}/assets/thumbnail`,
      );
      assert.equal(
        readyV2?.previewUrl,
        `/api/v1/photos/${photoId}/versions/${version2.versionId}/assets/preview`,
      );

      const initialHead = await currentHead();
      const switchEventsBefore = await rows(
        "SELECT * FROM audit_events WHERE photo_id=? AND action='photo.version_current_changed' ORDER BY event_id",
        photoId,
      );
      currentNoop = setIntent(randomUUID(), 0, version1Id, version1Id);
      const noOpResult = await readJson(await setCurrent(currentNoop), 200);
      assert.equal(noOpResult.photoId, photoId);
      assert.deepEqual(noOpResult.current, {
        versionId: version1Id,
        revision: 0,
      });
      assert.equal(noOpResult.changed, false);
      assert.equal(noOpResult.eventId, null);
      assert.ok(Number.isFinite(Date.parse(noOpResult.occurredAt)));
      assert.deepEqual(await currentHead(), initialHead);
      assert.deepEqual(
        await readJson(await setCurrent(currentNoop), 200),
        noOpResult,
      );
      assert.deepEqual(
        await rows(
          "SELECT * FROM audit_events WHERE photo_id=? AND action='photo.version_current_changed' ORDER BY event_id",
          photoId,
        ),
        switchEventsBefore,
      );

      const notReadyBody = setIntent(randomUUID(), 0, version1Id, version3.id);
      const notReadyResult = await readJson(
        await setCurrent(notReadyBody),
        409,
      );
      assert.equal(errorCode(notReadyResult), 'PHOTO_VERSION_NOT_READY');
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM photo_version_head_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, notReadyBody.requestId)
            .first()
        ).n,
        0,
      );
      assert.deepEqual(await currentHead(), initialHead);
    },
  );

  await check(
    'current-version CAS admits one race winner, replays exact intent, and rejects changed intent',
    async () => {
      beforeSwitchSnapshot = await photoStateSnapshot();
      const initialHead = await currentHead();
      const left = setIntent(
        randomUUID(),
        initialHead.revision,
        initialHead.version_id,
        version2.versionId,
      );
      const right = setIntent(
        randomUUID(),
        initialHead.revision,
        initialHead.version_id,
        version2.versionId,
      );
      const [leftResponse, rightResponse] = await Promise.all([
        setCurrent(left),
        setCurrent(right),
      ]);
      const [leftResult, rightResult] = await Promise.all([
        readJson(leftResponse),
        readJson(rightResponse),
      ]);
      assert.deepEqual(
        [leftResponse.status, rightResponse.status].sort((a, b) => a - b),
        [200, 409],
      );
      const leftWon = leftResponse.status === 200;
      winningIntent = leftWon ? left : right;
      const winningResult = leftWon ? leftResult : rightResult;
      const conflictResult = leftWon ? rightResult : leftResult;
      assert.equal(
        errorCode(conflictResult),
        'PHOTO_VERSION_REVISION_CONFLICT',
      );
      assert.equal(winningResult.changed, true);
      assert.deepEqual(winningResult.current, {
        versionId: version2.versionId,
        revision: 1,
      });
      const winningCommand = await db
        .prepare(
          'SELECT id FROM photo_version_head_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, winningIntent.requestId)
        .first();
      assert.ok(winningCommand);
      assert.equal(
        winningResult.eventId,
        'photo-version-current:' + winningCommand.id,
      );
      const eventsAfterWinner = await rows(
        "SELECT * FROM audit_events WHERE photo_id=? AND action='photo.version_current_changed' ORDER BY event_id",
        photoId,
      );
      assert.equal(eventsAfterWinner.length, 1);
      assert.equal(eventsAfterWinner[0].request_id, winningIntent.requestId);
      assert.deepEqual(
        await readJson(await setCurrent(winningIntent), 200),
        winningResult,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE photo_id=? AND action='photo.version_current_changed'",
            )
            .bind(photoId)
            .first()
        ).n,
        1,
      );

      const currentNoop = setIntent(
        randomUUID(),
        1,
        version2.versionId,
        version2.versionId,
      );
      const noOpResult = await readJson(await setCurrent(currentNoop), 200);
      assert.equal(noOpResult.changed, false);
      assert.equal(noOpResult.current.revision, 1);
      assert.equal(noOpResult.eventId, null);
      assert.deepEqual(
        await readJson(await setCurrent(currentNoop), 200),
        noOpResult,
      );
      assert.equal((await currentHead()).last_command_id, winningCommand.id);
      const changedIntent = { ...currentNoop, versionId: version1Id };
      const changedResult = await readJson(
        await setCurrent(changedIntent),
        409,
      );
      assert.equal(errorCode(changedResult), 'REQUEST_ID_CONFLICT');
    },
  );

  await check(
    'Owner and Guest galleries follow the new head; non-current Guest assets require view plus compare',
    async () => {
      const ownerPage = await readJson(
        await send(versionsWorker, galleryPath()),
        200,
      );
      const ownerPhoto = ownerPage.photos.find((item) => item.id === photoId);
      assert.ok(ownerPhoto);
      assert.equal(ownerPhoto.versionId, version2.versionId);
      assert.equal(ownerPhoto.processing, 'succeeded');
      const ownerImage = await send(
        versionsWorker,
        `/api/v1/photos/${photoId}/versions/${version2.versionId}/assets/preview`,
      );
      assert.equal(ownerImage.status, 200);
      assert.equal(ownerImage.headers.get('Content-Type'), 'image/jpeg');

      const guestPage = await readJson(
        await send(guestWorker, `/api/guest/albums/${albumId}/photos`, {
          guest: compareGuest,
        }),
        200,
      );
      const guestPhoto = guestPage.photos.find((item) => item.id === photoId);
      assert.ok(guestPhoto);
      assert.equal(guestPhoto.versionId, version2.versionId);
      const currentAsset = guestPhoto.previewUrl;
      const oldAsset = `/api/guest/photos/${photoId}/versions/${version1Id}/assets/preview`;
      assert.equal(
        currentAsset,
        `/api/guest/photos/${photoId}/versions/${version2.versionId}/assets/preview`,
      );
      assert.equal(
        (await send(guestWorker, currentAsset, { guest: viewOnlyGuest }))
          .status,
        200,
      );
      assert.equal(
        (await send(guestWorker, oldAsset, { guest: viewOnlyGuest })).status,
        401,
      );
      assert.equal(
        (await send(guestWorker, oldAsset, { guest: compareGuest })).status,
        200,
      );
      assert.equal(
        (await send(guestWorker, currentAsset, { guest: compareGuest })).status,
        200,
      );

      switchBackIntent = setIntent(
        randomUUID(),
        1,
        version2.versionId,
        version1Id,
      );
      const switchedBack = await readJson(
        await setCurrent(switchBackIntent),
        200,
      );
      assert.equal(switchedBack.changed, true);
      assert.deepEqual(switchedBack.current, {
        versionId: version1Id,
        revision: 2,
      });
      const restoredOwner = await readJson(
        await send(versionsWorker, galleryPath()),
        200,
      );
      assert.equal(
        restoredOwner.photos.find((item) => item.id === photoId)?.versionId,
        version1Id,
      );
      const restoredGuest = await readJson(
        await send(guestWorker, `/api/guest/albums/${albumId}/photos`, {
          guest: compareGuest,
        }),
        200,
      );
      assert.equal(
        restoredGuest.photos.find((item) => item.id === photoId)?.versionId,
        version1Id,
      );
      const afterSwitch = await photoStateSnapshot();
      assert.deepEqual(afterSwitch.versions, beforeSwitchSnapshot.versions);
      assert.deepEqual(afterSwitch.assets, beforeSwitchSnapshot.assets);
      assert.deepEqual(
        afterSwitch.selectionState,
        beforeSwitchSnapshot.selectionState,
      );
      assert.deepEqual(
        afterSwitch.selectionCommands,
        beforeSwitchSnapshot.selectionCommands,
      );
      assert.deepEqual(
        afterSwitch.selectionResults,
        beforeSwitchSnapshot.selectionResults,
      );
      assert.deepEqual(
        afterSwitch.ratingState,
        beforeSwitchSnapshot.ratingState,
      );
      assert.deepEqual(
        afterSwitch.favoriteState,
        beforeSwitchSnapshot.favoriteState,
      );
      assert.deepEqual(
        afterSwitch.feedbackCommands,
        beforeSwitchSnapshot.feedbackCommands,
      );
      assert.deepEqual(
        afterSwitch.feedbackResults,
        beforeSwitchSnapshot.feedbackResults,
      );
      assert.deepEqual(
        afterSwitch.auditEvents.filter(
          (event) => event.action !== currentChangeAction,
        ),
        beforeSwitchSnapshot.auditEvents.filter(
          (event) => event.action !== currentChangeAction,
        ),
      );
      assert.equal(
        afterSwitch.auditEvents.filter(
          (event) => event.action === currentChangeAction,
        ).length,
        2,
      );
      assert.equal(
        afterSwitch.selectionState.find(
          (state) => state.guest_id === compareGuest.guestId,
        )?.version_id,
        version1Id,
      );
      assert.equal(
        afterSwitch.ratingState.find(
          (state) => state.guest_id === compareGuest.guestId,
        )?.last_version_id,
        version1Id,
      );
      assert.equal(
        afterSwitch.favoriteState.find(
          (state) => state.guest_id === compareGuest.guestId,
        )?.last_version_id,
        version1Id,
      );
      assert.deepEqual(await currentHead(), {
        photo_id: photoId,
        workspace_id: workspaceId,
        project_id: projectId,
        album_id: albumId,
        version_id: version1Id,
        revision: 2,
        last_command_id: (
          await db
            .prepare(
              'SELECT id FROM photo_version_head_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, switchBackIntent.requestId)
            .first()
        ).id,
      });
    },
  );

  await check(
    'audit failure rolls head, command, result and event back atomically; exact retry commits once',
    async () => {
      const before = {
        head: await currentHead(),
        commands: await rows(
          'SELECT * FROM photo_version_head_commands WHERE photo_id=? ORDER BY id',
          photoId,
        ),
        results: await rows(
          'SELECT r.* FROM photo_version_head_results r JOIN photo_version_head_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
          photoId,
        ),
        events: await rows(
          'SELECT * FROM audit_events WHERE photo_id=? ORDER BY event_id',
          photoId,
        ),
      };
      auditRetryIntent = setIntent(
        randomUUID(),
        before.head.revision,
        before.head.version_id,
        version2.versionId,
      );
      await db.exec(
        `CREATE TRIGGER photo_version_test_audit_abort BEFORE INSERT ON audit_events WHEN NEW.action='${currentChangeAction}' BEGIN SELECT RAISE(ABORT,'TEST_PHOTO_VERSION_AUDIT_ABORT'); END;`,
      );
      let failedResponse;
      try {
        failedResponse = await setCurrent(auditRetryIntent);
        assert.ok(
          failedResponse.status >= 500,
          `Expected an audit failure response, received ${failedResponse.status}`,
        );
        await failedResponse.text();
      } finally {
        await db.exec('DROP TRIGGER photo_version_test_audit_abort;');
      }
      assert.deepEqual(await currentHead(), before.head);
      assert.deepEqual(
        await rows(
          'SELECT * FROM photo_version_head_commands WHERE photo_id=? ORDER BY id',
          photoId,
        ),
        before.commands,
      );
      assert.deepEqual(
        await rows(
          'SELECT r.* FROM photo_version_head_results r JOIN photo_version_head_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
          photoId,
        ),
        before.results,
      );
      assert.deepEqual(
        await rows(
          'SELECT * FROM audit_events WHERE photo_id=? ORDER BY event_id',
          photoId,
        ),
        before.events,
      );

      finalChangedResult = await readJson(
        await setCurrent(auditRetryIntent),
        200,
      );
      assert.equal(finalChangedResult.changed, true);
      assert.deepEqual(finalChangedResult.current, {
        versionId: version2.versionId,
        revision: before.head.revision + 1,
      });
      const retryCommand = await db
        .prepare(
          'SELECT id FROM photo_version_head_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, auditRetryIntent.requestId)
        .first();
      assert.equal(
        finalChangedResult.eventId,
        'photo-version-current:' + retryCommand.id,
      );
      assert.deepEqual(
        await readJson(await setCurrent(auditRetryIntent), 200),
        finalChangedResult,
      );
      await check(
        'head, command, result, alternate-key and predecessor guards reject replacement without changing state',
        async () => {
          const stableHead = await currentHead();
          const stableCommands = await rows(
            'SELECT * FROM photo_version_head_commands WHERE photo_id=? ORDER BY id',
            photoId,
          );
          const stableResults = await rows(
            'SELECT r.* FROM photo_version_head_results r JOIN photo_version_head_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
            photoId,
          );
          const stableAudit = await rows(
            'SELECT * FROM audit_events WHERE photo_id=? ORDER BY event_id',
            photoId,
          );
          const command = await db
            .prepare(
              'SELECT * FROM photo_version_head_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, winningIntent.requestId)
            .first();
          assert.ok(command);
          const result = await db
            .prepare(
              'SELECT * FROM photo_version_head_results WHERE command_id=?',
            )
            .bind(command.id)
            .first();
          assert.ok(result?.event_id);

          await assert.rejects(
            db
              .prepare(
                'UPDATE photo_version_heads SET version_id=?,revision=revision+1,last_command_id=? WHERE photo_id=?',
              )
              .bind(version1Id, command.id, photoId)
              .run(),
            /INVALID_PHOTO_VERSION_HEAD_TRANSITION/,
          );
          await assert.rejects(
            db
              .prepare('DELETE FROM photo_version_heads WHERE photo_id=?')
              .bind(photoId)
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD/,
          );
          await assert.rejects(
            db
              .prepare(
                'INSERT OR REPLACE INTO photo_version_heads(photo_id,workspace_id,project_id,album_id,version_id,revision,last_command_id) VALUES(?,?,?,?,?,?,?)',
              )
              .bind(
                stableHead.photo_id,
                stableHead.workspace_id,
                stableHead.project_id,
                stableHead.album_id,
                stableHead.version_id,
                stableHead.revision,
                stableHead.last_command_id,
              )
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD/,
          );

          await assert.rejects(
            db
              .prepare(
                'UPDATE photo_version_head_commands SET version_id=? WHERE id=?',
              )
              .bind(version1Id, command.id)
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
          );
          await assert.rejects(
            db
              .prepare('DELETE FROM photo_version_head_commands WHERE id=?')
              .bind(command.id)
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
          );
          await assert.rejects(
            db
              .prepare(
                'INSERT OR REPLACE INTO photo_version_head_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,expected_revision,expected_current_version_id,version_id,confirm,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              )
              .bind(
                command.id,
                command.actor_id,
                command.session_id,
                command.request_id,
                command.operation,
                command.workspace_id,
                command.project_id,
                command.album_id,
                command.photo_id,
                command.expected_revision,
                command.expected_current_version_id,
                command.version_id,
                command.confirm,
                command.payload_json,
                command.created_at_ms,
              )
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
          );
          await assert.rejects(
            db
              .prepare(
                'INSERT OR REPLACE INTO photo_version_head_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,expected_revision,expected_current_version_id,version_id,confirm,payload_json,created_at_ms) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              )
              .bind(
                command.actor_id,
                command.session_id,
                randomUUID(),
                command.operation,
                command.workspace_id,
                command.project_id,
                command.album_id,
                command.photo_id,
                command.expected_revision,
                command.expected_current_version_id,
                command.version_id,
                command.confirm,
                command.payload_json,
                Date.now(),
              )
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
          );

          await assert.rejects(
            db
              .prepare(
                'UPDATE photo_version_head_results SET event_id=? WHERE command_id=?',
              )
              .bind('replacement-event', command.id)
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
          );
          await assert.rejects(
            db
              .prepare(
                'DELETE FROM photo_version_head_results WHERE command_id=?',
              )
              .bind(command.id)
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
          );
          await assert.rejects(
            db
              .prepare(
                'INSERT OR REPLACE INTO photo_version_head_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?)',
              )
              .bind(
                result.command_id,
                result.previous_command_id,
                result.before_json,
                result.after_json,
                result.result_json,
                result.event_id,
                result.occurred_at_utc,
              )
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
          );
          await assert.rejects(
            db
              .prepare(
                'INSERT OR REPLACE INTO photo_version_head_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?)',
              )
              .bind(
                randomUUID(),
                null,
                '{}',
                '{}',
                '{}',
                result.event_id,
                result.occurred_at_utc,
              )
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
          );
          await assert.rejects(
            db
              .prepare(
                "INSERT OR REPLACE INTO photo_version_head_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc) VALUES(NULL,NULL,'{}','{}','{}',NULL,?)",
              )
              .bind(result.occurred_at_utc)
              .run(),
            /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
          );

          const conflictingPayload = JSON.stringify({
            requestId: command.request_id,
            expectedRevision: command.expected_revision,
            expectedCurrentVersionId: command.expected_current_version_id,
            versionId: command.expected_current_version_id,
            confirm: true,
          });
          await assert.rejects(
            db
              .prepare(
                'INSERT INTO photo_version_head_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,expected_revision,expected_current_version_id,version_id,confirm,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              )
              .bind(
                randomUUID(),
                command.actor_id,
                command.session_id,
                command.request_id,
                command.operation,
                command.workspace_id,
                command.project_id,
                command.album_id,
                command.photo_id,
                command.expected_revision,
                command.expected_current_version_id,
                command.expected_current_version_id,
                1,
                conflictingPayload,
                Date.now(),
              )
              .run(),
            /REQUEST_ID_CONFLICT/,
          );

          assert.deepEqual(await currentHead(), stableHead);
          assert.deepEqual(
            await rows(
              'SELECT * FROM photo_version_head_commands WHERE photo_id=? ORDER BY id',
              photoId,
            ),
            stableCommands,
          );
          assert.deepEqual(
            await rows(
              'SELECT r.* FROM photo_version_head_results r JOIN photo_version_head_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
              photoId,
            ),
            stableResults,
          );
          assert.deepEqual(
            await rows(
              'SELECT * FROM audit_events WHERE photo_id=? ORDER BY event_id',
              photoId,
            ),
            stableAudit,
          );
        },
      );
      const finalHead = await currentHead();
      assert.equal(finalHead.version_id, version2.versionId);
      assert.equal(finalHead.revision, 3);

      const after = await photoStateSnapshot();
      assert.deepEqual(after.versions, beforeSwitchSnapshot.versions);
      assert.deepEqual(after.assets, beforeSwitchSnapshot.assets);
      assert.deepEqual(
        after.auditEvents.filter(
          (event) => event.action !== currentChangeAction,
        ),
        beforeSwitchSnapshot.auditEvents.filter(
          (event) => event.action !== currentChangeAction,
        ),
      );
      assert.equal(
        after.auditEvents.filter(
          (event) => event.action === currentChangeAction,
        ).length,
        3,
      );

      const ownerWasEnabled = await db
        .prepare('SELECT enabled FROM owners WHERE user_id=?')
        .bind(owner)
        .first();
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        const deniedReplay = await send(versionsWorker, setCurrentPath(), {
          method: 'POST',
          body: auditRetryIntent,
        });
        assert.equal(deniedReplay.status, 403);
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=? WHERE user_id=?')
          .bind(ownerWasEnabled.enabled, owner)
          .run();
      }
      assert.deepEqual(await currentHead(), finalHead);
    },
  );

  await check(
    'archived project or album and foreign-tenant photo are denied without a head command',
    async () => {
      const beforeHead = await currentHead();
      const archivedAlbumIntent = setIntent(
        randomUUID(),
        beforeHead.revision,
        beforeHead.version_id,
        version1Id,
      );
      const albumBefore = await db
        .prepare('SELECT state,archived_from_state FROM albums WHERE id=?')
        .bind(albumId)
        .first();
      await db
        .prepare(
          "UPDATE albums SET state='archived',archived_from_state='draft' WHERE id=?",
        )
        .bind(albumId)
        .run();
      try {
        const result = await readJson(
          await setCurrent(archivedAlbumIntent),
          409,
        );
        assert.equal(errorCode(result), 'RESOURCE_NOT_EDITABLE');
      } finally {
        await db
          .prepare('UPDATE albums SET state=?,archived_from_state=? WHERE id=?')
          .bind(albumBefore.state, albumBefore.archived_from_state, albumId)
          .run();
      }

      const projectBefore = await db
        .prepare('SELECT status,archived_from_status FROM projects WHERE id=?')
        .bind(projectId)
        .first();
      await db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status='draft' WHERE id=?",
        )
        .bind(projectId)
        .run();
      try {
        const result = await readJson(
          await setCurrent(
            setIntent(
              randomUUID(),
              beforeHead.revision,
              beforeHead.version_id,
              version1Id,
            ),
          ),
          409,
        );
        assert.equal(errorCode(result), 'RESOURCE_NOT_EDITABLE');
      } finally {
        await db
          .prepare(
            'UPDATE projects SET status=?,archived_from_status=? WHERE id=?',
          )
          .bind(
            projectBefore.status,
            projectBefore.archived_from_status,
            projectId,
          )
          .run();
      }
      assert.deepEqual(await currentHead(), beforeHead);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM photo_version_head_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, archivedAlbumIntent.requestId)
            .first()
        ).n,
        0,
      );

      const foreignUserId = randomUUID();
      const foreignWorkspaceId = randomUUID();
      const foreignProjectId = randomUUID();
      const foreignAlbumId = randomUUID();
      const foreignPhotoId = randomUUID();
      const foreignVersionId = randomUUID();
      const now = Date.now();
      await db
        .prepare(
          'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
        )
        .bind(
          foreignUserId,
          'Photo version foreign tenant',
          `photo-version-${foreignUserId}@example.invalid`,
          now,
          now,
        )
        .run();
      await db
        .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
        .bind(
          foreignWorkspaceId,
          'Photo version foreign workspace',
          foreignUserId,
        )
        .run();
      await db
        .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
        .bind(foreignProjectId, foreignWorkspaceId, 'Foreign version project')
        .run();
      await db
        .prepare(
          "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
        )
        .bind(
          foreignAlbumId,
          foreignWorkspaceId,
          foreignProjectId,
          'Foreign version album',
        )
        .run();
      await db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          foreignPhotoId,
          foreignWorkspaceId,
          foreignProjectId,
          foreignAlbumId,
          'foreign-tenant.jpg',
        )
        .run();
      await db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
        )
        .bind(
          foreignVersionId,
          foreignWorkspaceId,
          foreignPhotoId,
          foreignUserId,
          randomBytes(32).toString('hex'),
        )
        .run();

      const foreignList = await readJson(
        await send(versionsWorker, `/api/v1/photos/${foreignPhotoId}/versions`),
        404,
      );
      assert.equal(errorCode(foreignList), 'NOT_FOUND');
      assert.equal(
        Object.hasOwn(foreignList, 'currentVersion'),
        false,
        'Foreign tenant metadata must not be returned',
      );
      const foreignMutation = await readJson(
        await send(
          versionsWorker,
          `/api/v1/photos/${foreignPhotoId}/versions/set-current`,
          {
            method: 'POST',
            body: setIntent(
              randomUUID(),
              0,
              foreignVersionId,
              foreignVersionId,
            ),
          },
        ),
        404,
      );
      assert.equal(errorCode(foreignMutation), 'NOT_FOUND');
    },
  );

  await check(
    'head, command, result, alternate-key and predecessor guards reject replacement without changing state',
    async () => {
      const stableHead = await currentHead();
      const stableCommands = await rows(
        'SELECT * FROM photo_version_head_commands WHERE photo_id=? ORDER BY id',
        photoId,
      );
      const stableResults = await rows(
        'SELECT r.* FROM photo_version_head_results r JOIN photo_version_head_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
        photoId,
      );
      const stableAudit = await rows(
        'SELECT * FROM audit_events WHERE photo_id=? ORDER BY event_id',
        photoId,
      );
      const command = await db
        .prepare(
          'SELECT * FROM photo_version_head_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, winningIntent.requestId)
        .first();
      assert.ok(command);
      const result = await db
        .prepare('SELECT * FROM photo_version_head_results WHERE command_id=?')
        .bind(command.id)
        .first();
      assert.ok(result?.event_id);

      await assert.rejects(
        db
          .prepare(
            'UPDATE photo_version_heads SET version_id=?,revision=revision+1,last_command_id=? WHERE photo_id=?',
          )
          .bind(version1Id, command.id, photoId)
          .run(),
        /INVALID_PHOTO_VERSION_HEAD_TRANSITION/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM photo_version_heads WHERE photo_id=?')
          .bind(photoId)
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO photo_version_heads(photo_id,workspace_id,project_id,album_id,version_id,revision,last_command_id) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(
            stableHead.photo_id,
            stableHead.workspace_id,
            stableHead.project_id,
            stableHead.album_id,
            stableHead.version_id,
            stableHead.revision,
            stableHead.last_command_id,
          )
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD/,
      );

      await assert.rejects(
        db
          .prepare(
            'UPDATE photo_version_head_commands SET version_id=? WHERE id=?',
          )
          .bind(version1Id, command.id)
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM photo_version_head_commands WHERE id=?')
          .bind(command.id)
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO photo_version_head_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,expected_revision,expected_current_version_id,version_id,confirm,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            command.id,
            command.actor_id,
            command.session_id,
            command.request_id,
            command.operation,
            command.workspace_id,
            command.project_id,
            command.album_id,
            command.photo_id,
            command.expected_revision,
            command.expected_current_version_id,
            command.version_id,
            command.confirm,
            command.payload_json,
            command.created_at_ms,
          )
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO photo_version_head_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,expected_revision,expected_current_version_id,version_id,confirm,payload_json,created_at_ms) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            command.actor_id,
            command.session_id,
            randomUUID(),
            command.operation,
            command.workspace_id,
            command.project_id,
            command.album_id,
            command.photo_id,
            command.expected_revision,
            command.expected_current_version_id,
            command.version_id,
            command.confirm,
            command.payload_json,
            Date.now(),
          )
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_COMMAND/,
      );

      await assert.rejects(
        db
          .prepare(
            'UPDATE photo_version_head_results SET event_id=? WHERE command_id=?',
          )
          .bind('replacement-event', command.id)
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
      );
      await assert.rejects(
        db
          .prepare('DELETE FROM photo_version_head_results WHERE command_id=?')
          .bind(command.id)
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO photo_version_head_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(
            result.command_id,
            result.previous_command_id,
            result.before_json,
            result.after_json,
            result.result_json,
            result.event_id,
            result.occurred_at_utc,
          )
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT OR REPLACE INTO photo_version_head_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            null,
            '{}',
            '{}',
            '{}',
            result.event_id,
            result.occurred_at_utc,
          )
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT OR REPLACE INTO photo_version_head_results(command_id,previous_command_id,before_json,after_json,result_json,event_id,occurred_at_utc) VALUES(NULL,NULL,'{}','{}','{}',NULL,?)",
          )
          .bind(result.occurred_at_utc)
          .run(),
        /IMMUTABLE_PHOTO_VERSION_HEAD_RESULT/,
      );

      const conflictingPayload = JSON.stringify({
        requestId: command.request_id,
        expectedRevision: command.expected_revision,
        expectedCurrentVersionId: command.expected_current_version_id,
        versionId: command.expected_current_version_id,
        confirm: true,
      });
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO photo_version_head_commands(id,actor_id,session_id,request_id,operation,workspace_id,project_id,album_id,photo_id,expected_revision,expected_current_version_id,version_id,confirm,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            command.actor_id,
            command.session_id,
            command.request_id,
            command.operation,
            command.workspace_id,
            command.project_id,
            command.album_id,
            command.photo_id,
            command.expected_revision,
            command.expected_current_version_id,
            command.expected_current_version_id,
            1,
            conflictingPayload,
            Date.now(),
          )
          .run(),
        /REQUEST_ID_CONFLICT/,
      );

      assert.deepEqual(await currentHead(), stableHead);
      assert.deepEqual(
        await rows(
          'SELECT * FROM photo_version_head_commands WHERE photo_id=? ORDER BY id',
          photoId,
        ),
        stableCommands,
      );
      assert.deepEqual(
        await rows(
          'SELECT r.* FROM photo_version_head_results r JOIN photo_version_head_commands c ON c.id=r.command_id WHERE c.photo_id=? ORDER BY r.command_id',
          photoId,
        ),
        stableResults,
      );
      assert.deepEqual(
        await rows(
          'SELECT * FROM audit_events WHERE photo_id=? ORDER BY event_id',
          photoId,
        ),
        stableAudit,
      );
    },
  );
  await check(
    'Owner version keyset pages pin the head revision and preserve legacy cursors',
    async () => {
      const initialPage = await readJson(
        await send(versionsWorker, ownerVersionsPath()),
        200,
      );
      const initialHead = await currentHead();
      assert.deepEqual(initialPage.current, {
        versionId: initialHead.version_id,
        revision: initialHead.revision,
      });
      assert.equal(initialPage.currentVersion.id, initialHead.version_id);
      assert.ok(initialPage.nextCursor);

      const switchTarget =
        initialHead.version_id === version1Id ? version2.versionId : version1Id;
      const changed = await readJson(
        await setCurrent(
          setIntent(
            randomUUID(),
            initialHead.revision,
            initialHead.version_id,
            switchTarget,
          ),
        ),
        200,
      );
      assert.equal(changed.changed, true);

      const stalePage = await readJson(
        await send(
          versionsWorker,
          ownerVersionsPath() +
            '?cursor=' +
            encodeURIComponent(initialPage.nextCursor),
        ),
        409,
      );
      assert.equal(errorCode(stalePage), 'PHOTO_VERSION_REVISION_CONFLICT');

      const restored = await readJson(
        await setCurrent(
          setIntent(
            randomUUID(),
            changed.current.revision,
            changed.current.versionId,
            initialHead.version_id,
          ),
        ),
        200,
      );
      assert.equal(restored.current.versionId, initialHead.version_id);
      assert.equal(restored.current.revision, initialHead.revision + 2);

      const legacyCursor = Buffer.from(
        JSON.stringify({
          photoId,
          versionNo: initialPage.versions.at(-1).versionNo,
        }),
        'utf8',
      ).toString('base64url');
      const legacyPage = await readJson(
        await send(
          versionsWorker,
          ownerVersionsPath() + '?cursor=' + encodeURIComponent(legacyCursor),
        ),
        200,
      );
      assert.deepEqual(legacyPage.current, restored.current);
      assert.equal(legacyPage.currentVersion.id, restored.current.versionId);
      assert.equal(legacyPage.currentVersion.previewUrl !== null, true);
    },
  );

  const finalHead = await currentHead();
  await check(
    'Owner version browser preserves confirmation, retry identity and current gallery at375px',
    async () => {
      await runPhotoVersionHeadsBrowserChecks({
        worker: versionsWorker,
        disabledWorker: guestWorker,
        base,
        ownerCookie,
        albumId,
        photoId,
        neighborPhotoId,
        neighborVersionId,
        version1Id,
        version2Id: version2.versionId,
        currentRevision: finalHead.revision,
        db,
      });
    },
  );
  return {
    photoId,
    albumId,
    version1Id,
    version2Id: version2.versionId,
    neighborPhotoId,
    neighborVersionId,
    currentRevision: finalHead.revision,
  };
}
