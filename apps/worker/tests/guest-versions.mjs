import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';

const canView = 1;
const canCompareVersions = 2048;
const canViewAndCompare = canView | canCompareVersions;
const hashGuestSession = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const hashInviteToken = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function guestVersionChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
}) {
  assert.ok(galleryFixture?.context?.workspace?.id);
  const guestWorker = await mf.getWorker('guest-version-comparison-test');
  const versionsWorker = await mf.getWorker('photo-versions-test');
  const storage = await mf.getR2Bucket(
    'PRIMARY_STORAGE',
    'guest-version-comparison-test',
  );
  const jobs = new D1ImageProcessingRepository(db);
  const objects = new R2ProcessingObjectStore(storage);
  const processor = new LocalSharpImageProcessor();

  const send = (
    worker,
    path,
    {
      method = 'GET',
      secret,
      ownerCookie = false,
      body,
      extraHeaders = {},
    } = {},
  ) => {
    const headers = { ...extraHeaders };
    if (secret) headers.Cookie = 'kino_guest=' + secret;
    else if (ownerCookie) headers.Cookie = cookies.headers();
    if (method !== 'GET' && method !== 'HEAD') {
      if (!headers.Origin) headers.Origin = base;
      if (!headers['Content-Type'])
        headers['Content-Type'] = 'application/json';
    }
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
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
    if (expectedStatus !== undefined) {
      assert.equal(
        response.status,
        expectedStatus,
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    }
    return value;
  };

  const expectDenied = async (response) => {
    const body = await readJson(response, 401);
    assert.equal(body?.error?.code, 'GUEST_ACCESS_REQUIRED');
    return body;
  };

  const imageBytes = async (seed) =>
    sharp({
      create: {
        width: seed === 2 ? 24 : 48,
        height: seed === 2 ? 48 : 24,
        channels: 3,
        background: {
          r: (seed * 31) % 255,
          g: (seed * 67) % 255,
          b: (seed * 97) % 255,
        },
      },
    })
      .png()
      .toBuffer();

  const capabilityPath = '/api/guest/version-comparison/capabilities';
  let fixture;

  await check(
    'Guest version comparison uses a fresh scoped album and real private derivatives',
    async () => {
      const ownerSession = await db
        .prepare(
          'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? ORDER BY expiresAt DESC,id DESC LIMIT 1',
        )
        .bind(owner, Date.now())
        .first();
      assert.ok(ownerSession?.id);

      const createOwnerRecord = async (path, body) =>
        readJson(
          await send(guestWorker, path, {
            method: 'POST',
            ownerCookie: true,
            body: { ...body, requestId: randomUUID() },
          }),
          201,
        );

      // The complete suite already reaches the legitimate Owner workspace cap.
      // Use its existing isolated gallery workspace and create our own project;
      // all real processing completes, so this fixture holds no pending quota.
      const workspace = galleryFixture.context.workspace;
      const project = (
        await createOwnerRecord('/api/v1/projects', {
          workspaceId: workspace.id,
          name: 'Guest versions ' + randomUUID(),
        })
      ).project;
      const album = (
        await createOwnerRecord('/api/v1/projects/' + project.id + '/albums', {
          name: 'Guest versions ' + randomUUID(),
        })
      ).album;
      await db
        .prepare(
          "UPDATE albums SET state='active',archived_from_state=NULL WHERE id=?",
        )
        .bind(album.id)
        .run();

      const siblingAlbum = (
        await createOwnerRecord('/api/v1/projects/' + project.id + '/albums', {
          name: 'Unshared guest versions ' + randomUUID(),
        })
      ).album;

      const createGuest = async ({
        mask,
        inviteExpiresAt = Date.now() + 60 * 60 * 1000,
        sessionExpiresAt = Math.min(
          inviteExpiresAt,
          Date.now() + 30 * 60 * 1000,
        ),
      }) => {
        const inviteId = randomUUID();
        const token = randomBytes(32).toString('hex');
        await db
          .prepare(
            "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
          )
          .bind(
            inviteId,
            workspace.id,
            project.id,
            hashInviteToken(token),
            mask,
            inviteExpiresAt,
            owner,
            ownerSession.id,
          )
          .run();
        await db
          .prepare(
            'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
          )
          .bind(inviteId, workspace.id, project.id, album.id)
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
          .bind(guestId, inviteId, 'Version Guest')
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
            sessionExpiresAt,
          )
          .run();
        return { inviteId, guestId, sessionId, secret, mask };
      };

      const uploadOrdinaryV1 = async ({ filename, seed }) => {
        const bytes = await imageBytes(seed);
        const checksum = sha256(bytes);
        const initialized = await readJson(
          await send(guestWorker, '/api/v1/uploads/init', {
            method: 'POST',
            ownerCookie: true,
            body: {
              workspaceId: workspace.id,
              projectId: project.id,
              albumId: album.id,
              originalFilename: filename,
              expectedBytes: bytes.byteLength,
              contentType: 'image/png',
              sha256: checksum,
              requestId: randomUUID(),
            },
          }),
          201,
        );
        const uploadSession = initialized.uploadSession;
        assert.ok(uploadSession?.id);
        const authorized = await readJson(
          await send(
            guestWorker,
            '/api/v1/uploads/' + uploadSession.id + '/authorize',
            {
              method: 'POST',
              ownerCookie: true,
              body: { requestId: randomUUID() },
            },
          ),
          200,
        );
        assert.equal(
          authorized.uploadAuthorization.contentLength,
          bytes.byteLength,
        );

        const uploadRow = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(uploadSession.id)
          .first();
        assert.ok(uploadRow?.object_key);
        await storage.put(uploadRow.object_key, new Uint8Array(bytes), {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          sha256: checksum,
        });
        const completed = await readJson(
          await send(
            guestWorker,
            '/api/v1/uploads/' + uploadSession.id + '/complete',
            {
              method: 'POST',
              ownerCookie: true,
              body: { requestId: randomUUID() },
            },
          ),
          200,
        );
        const completion = completed.completion;
        assert.ok(completion?.photoId);
        assert.ok(completion?.versionId);
        assert.ok(completion?.assetId);
        const processed = await runImageProcessingJob({
          jobId: completion.assetId,
          jobs,
          objects,
          processor,
        });
        assert.equal(processed.status, 'succeeded');
        return {
          photoId: completion.photoId,
          versionId: completion.versionId,
          assetId: completion.assetId,
          checksum,
          objectKey: uploadRow.object_key,
          filename,
        };
      };

      let currentFixturePhotoId;
      const uploadVersionThroughOwnerApi = async ({
        parentVersionId,
        expectedRevision,
        versionNo,
        seed,
        labels,
        changeNote,
      }) => {
        const bytes = await imageBytes(seed);
        const checksum = sha256(bytes);
        const normalizedLabels = labels.map((label) =>
          label.normalize('NFC').trim(),
        );
        const initialized = await readJson(
          await send(
            guestWorker,
            '/api/v1/photos/' + currentFixturePhotoId + '/versions/init',
            {
              method: 'POST',
              ownerCookie: true,
              body: {
                requestId: randomUUID(),
                originalFilename: 'guest-version-' + versionNo + '.png',
                expectedBytes: bytes.byteLength,
                contentType: 'image/png',
                sha256: checksum,
                expectedRevision,
                expectedCurrentVersionId: parentVersionId,
                changeType: 'replace_current',
                changeNote,
                labels,
                confirm: true,
              },
            },
          ),
          201,
        );
        const uploadSessionId = initialized.uploadSession?.id;
        assert.ok(uploadSessionId);
        assert.equal(initialized.target.photoId, currentFixturePhotoId);
        assert.equal(initialized.target.parentVersionId, parentVersionId);
        assert.equal(initialized.target.expectedRevision, expectedRevision);
        assert.deepEqual(initialized.target.labels, normalizedLabels);

        const authorized = await readJson(
          await send(
            guestWorker,
            '/api/v1/uploads/' + uploadSessionId + '/authorize',
            {
              method: 'POST',
              ownerCookie: true,
              body: { requestId: randomUUID() },
            },
          ),
          200,
        );
        assert.equal(
          authorized.uploadAuthorization.contentLength,
          bytes.byteLength,
        );
        const uploadRow = await db
          .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
          .bind(uploadSessionId)
          .first();
        assert.ok(uploadRow?.object_key);
        await storage.put(uploadRow.object_key, new Uint8Array(bytes), {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          sha256: checksum,
        });
        const completed = await readJson(
          await send(
            guestWorker,
            '/api/v1/photos/' +
              currentFixturePhotoId +
              '/versions/' +
              uploadSessionId +
              '/complete',
            {
              method: 'POST',
              ownerCookie: true,
              body: { requestId: randomUUID() },
            },
          ),
          200,
        );
        assert.equal(completed.status, 'completed');
        assert.equal(completed.photoId, currentFixturePhotoId);
        assert.equal(completed.versionNo, versionNo);
        assert.equal(completed.parentVersionId, parentVersionId);
        assert.equal(completed.changeType, 'replace_current');
        const processed = await runImageProcessingJob({
          jobId: completed.assetId,
          jobs,
          objects,
          processor,
        });
        assert.equal(processed.status, 'succeeded');
        await assertReadyVersion(completed.versionId, completed.assetId);
        return {
          versionId: completed.versionId,
          versionNo: completed.versionNo,
          assetId: completed.assetId,
          checksum,
          objectKey: uploadRow.object_key,
        };
      };

      const uploadReadyMetadataVersion = async ({
        parentVersionId,
        versionNo,
        seed,
      }) => {
        const bytes = await imageBytes(seed);
        const checksum = sha256(bytes);
        const version = await appendAuthorizedVersionFixture({
          db,
          owner,
          photoId: currentFixturePhotoId,
          expectedParentVersionId: parentVersionId,
          expectedVersionNo: versionNo,
          sha256: checksum,
          byteSize: bytes.byteLength,
          mime: 'image/png',
          width: 48,
          height: 24,
        });
        await storage.put(version.objectKey, new Uint8Array(bytes), {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/png' },
          sha256: Buffer.from(checksum, 'hex'),
        });
        const processed = await runImageProcessingJob({
          jobId: version.asset_id,
          jobs,
          objects,
          processor,
        });
        assert.equal(processed.status, 'succeeded');
        await assertReadyVersion(version.version_id, version.asset_id);
        return {
          versionId: version.version_id,
          versionNo: Number(version.version_no),
          assetId: version.asset_id,
          checksum,
          objectKey: version.objectKey,
        };
      };

      async function assertReadyVersion(versionId, assetId) {
        const job = await db
          .prepare('SELECT status FROM image_processing_jobs WHERE id=?')
          .bind(assetId)
          .first();
        assert.equal(job?.status, 'succeeded');
        const assets = await db
          .prepare(
            "SELECT asset_kind,state,mime,object_key,byte_size,checksum_sha256 FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
          )
          .bind(versionId)
          .all();
        assert.deepEqual(
          assets.results.map((asset) => asset.asset_kind),
          ['preview', 'thumbnail'],
        );
        for (const asset of assets.results) {
          assert.equal(asset.state, 'private');
          assert.equal(asset.mime, 'image/jpeg');
          const object = await storage.get(asset.object_key);
          assert.ok(object);
          assert.equal(object.size, asset.byte_size);
          assert.equal(object.httpMetadata?.contentType, 'image/jpeg');
          const delivered = Buffer.from(await object.arrayBuffer());
          assert.equal(
            createHash('sha256').update(delivered).digest('hex'),
            asset.checksum_sha256,
          );
        }
      }

      const first = await uploadOrdinaryV1({
        filename: 'guest-version-v1.png',
        seed: 1,
      });
      const neighbor = await uploadOrdinaryV1({
        filename: 'guest-version-neighbor.png',
        seed: 40,
      });
      currentFixturePhotoId = first.photoId;
      fixture = {
        createReadyPhoto: uploadOrdinaryV1,
        workspace,
        project,
        album,
        siblingAlbum,
        ownerSessionId: ownerSession.id,
        photoId: first.photoId,
        filename: first.filename,
        neighborPhotoId: neighbor.photoId,
        neighborFilename: neighbor.filename,
        v1: {
          versionId: first.versionId,
          versionNo: 1,
          assetId: first.assetId,
          checksum: first.checksum,
          objectKey: first.objectKey,
        },
        photoStatePath:
          '/api/v1/photos/' + first.photoId + '/versions/set-current',
      };
      const headBeforeV2 = await db
        .prepare(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
        )
        .bind(fixture.photoId)
        .first();
      assert.equal(headBeforeV2?.version_id, fixture.v1.versionId);
      assert.equal(headBeforeV2?.revision, 0);

      const compareGuest = await createGuest({ mask: canViewAndCompare });
      const viewOnlyGuest = await createGuest({ mask: canView });
      const compareOnlyGuest = await createGuest({
        mask: canCompareVersions,
      });
      fixture.compareGuest = compareGuest;
      fixture.viewOnlyGuest = viewOnlyGuest;
      fixture.compareOnlyGuest = compareOnlyGuest;
      fixture.createGuest = createGuest;

      const privateChangeNote =
        'PRIVATE VERSION NOTE ' + randomUUID() + ' must not reach Guests';
      fixture.privateChangeNote = privateChangeNote;
      fixture.v2 = await uploadVersionThroughOwnerApi({
        parentVersionId: fixture.v1.versionId,
        expectedRevision: 0,
        versionNo: 2,
        seed: 2,
        labels: ['  Retouched  ', 'Client approved'],
        changeNote: privateChangeNote,
      });
      const headBeforePublishingV2 = await db
        .prepare(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
        )
        .bind(fixture.photoId)
        .first();
      assert.deepEqual(headBeforePublishingV2, {
        version_id: fixture.v1.versionId,
        revision: 0,
      });

      const unpublishedChangeNote = 'PRIVATE UNPUBLISHED NOTE ' + randomUUID();
      fixture.privateUnpublishedChangeNote = unpublishedChangeNote;
      fixture.v3 = await uploadVersionThroughOwnerApi({
        parentVersionId: fixture.v1.versionId,
        expectedRevision: 0,
        versionNo: 3,
        seed: 3,
        labels: ['Unpublished'],
        changeNote: unpublishedChangeNote,
      });
      const headAfterV3 = await db
        .prepare(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
        )
        .bind(fixture.photoId)
        .first();
      assert.deepEqual(headAfterV3, {
        version_id: fixture.v1.versionId,
        revision: 0,
      });
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM photo_version_head_commands WHERE photo_id=? AND version_id=?',
            )
            .bind(fixture.photoId, fixture.v3.versionId)
            .first()
        ).n,
        0,
      );

      let currentVersionId = fixture.v1.versionId;
      let currentRevision = 0;
      const switchHead = async (targetVersionId) => {
        const result = await readJson(
          await send(guestWorker, fixture.photoStatePath, {
            method: 'POST',
            ownerCookie: true,
            body: {
              requestId: randomUUID(),
              expectedRevision: currentRevision,
              expectedCurrentVersionId: currentVersionId,
              versionId: targetVersionId,
              confirm: true,
            },
          }),
          200,
        );
        assert.equal(result.changed, true);
        currentVersionId = targetVersionId;
        currentRevision += 1;
        assert.deepEqual(result.current, {
          versionId: currentVersionId,
          revision: currentRevision,
        });
      };
      fixture.setHead = switchHead;

      await switchHead(fixture.v2.versionId);

      const publishedVersions = [fixture.v1, fixture.v2];
      let lastReadyParentId = fixture.v2.versionId;
      for (let versionNo = 4; versionNo <= 28; versionNo += 1) {
        const version = await uploadReadyMetadataVersion({
          parentVersionId: lastReadyParentId,
          versionNo,
          seed: versionNo,
        });
        await switchHead(version.versionId);
        publishedVersions.push(version);
        lastReadyParentId = version.versionId;
      }

      fixture.publishedVersions = publishedVersions;
      fixture.v28 = publishedVersions[publishedVersions.length - 1];
      fixture.headAtFirstPage = {
        versionId: currentVersionId,
        revision: currentRevision,
      };
      assert.equal(fixture.v3.versionNo, 3);
      assert.equal(fixture.v28.versionNo, 28);

      const unpublishedHeadCommands = await db
        .prepare(
          'SELECT count(*) AS n FROM photo_version_head_commands WHERE photo_id=? AND version_id=?',
        )
        .bind(fixture.photoId, fixture.v3.versionId)
        .first();
      assert.equal(unpublishedHeadCommands?.n, 0);
    },
  );

  if (!fixture) return null;

  const versionsPath =
    '/api/guest/albums/' +
    fixture.album.id +
    '/photos/' +
    fixture.photoId +
    '/versions';
  const assetPath = (photoId, versionId, kind) =>
    '/api/guest/photos/' +
    photoId +
    '/versions/' +
    versionId +
    '/assets/' +
    kind;
  const headState = async () =>
    db
      .prepare(
        'SELECT version_id AS versionId,revision FROM photo_version_heads WHERE photo_id=?',
      )
      .bind(fixture.photoId)
      .first();
  const cursorFor = ({ photoId, headVersionId, headRevision, lastVersionNo }) =>
    Buffer.from(
      JSON.stringify({
        photoId,
        headVersionId,
        headRevision,
        lastVersionNo,
      }),
      'utf8',
    ).toString('base64url');

  await check(
    'Guest comparison capability is default off and history requires view plus compare without selection',
    async () => {
      const defaultCapability = await readJson(
        await request(capabilityPath),
        200,
      );
      assert.deepEqual(defaultCapability, { enabled: false });
      const disabledCapability = await readJson(
        await send(versionsWorker, capabilityPath),
        200,
      );
      assert.deepEqual(disabledCapability, { enabled: false });
      const enabledCapability = await readJson(
        await send(guestWorker, capabilityPath),
        200,
      );
      assert.deepEqual(enabledCapability, { enabled: true });
      assert.equal(
        (await request(capabilityPath + '?unexpected=1')).status,
        400,
      );

      assert.equal(
        (
          await request(versionsPath, {
            headers: { Cookie: 'kino_guest=' + fixture.compareGuest.secret },
          })
        ).status,
        503,
      );
      assert.equal(
        (
          await send(versionsWorker, versionsPath, {
            secret: fixture.compareGuest.secret,
          })
        ).status,
        503,
      );
      await expectDenied(await send(guestWorker, versionsPath));
      await expectDenied(
        await send(guestWorker, versionsPath, {
          secret: fixture.viewOnlyGuest.secret,
        }),
      );
      await expectDenied(
        await send(guestWorker, versionsPath, {
          secret: fixture.compareOnlyGuest.secret,
        }),
      );
      await expectDenied(
        await send(guestWorker, versionsPath, { ownerCookie: true }),
      );

      const page = await readJson(
        await send(guestWorker, versionsPath, {
          secret: fixture.compareGuest.secret,
        }),
        200,
      );
      assert.equal(page.albumId, fixture.album.id);
      assert.equal(page.photoId, fixture.photoId);
      assert.equal(page.head.versionId, fixture.v28.versionId);
      assert.equal(page.currentVersion.versionId, fixture.v28.versionId);
      assert.deepEqual(page.currentVersion.labels, []);
      assert.equal(page.currentVersion.createdByLabel, '攝影師');
      assert.equal(fixture.compareGuest.mask & 8, 0);
    },
  );

  await check(
    'Guest history pages expose only published ready metadata and keep current version pinned',
    async () => {
      const auditBefore = await db
        .prepare('SELECT count(*) AS n FROM audit_events WHERE workspace_id=?')
        .bind(fixture.workspace.id)
        .first();

      const firstPage = await readJson(
        await send(guestWorker, versionsPath, {
          secret: fixture.compareGuest.secret,
        }),
        200,
      );
      assert.equal(firstPage.versions.length, 24);
      assert.ok(firstPage.nextCursor);
      assert.ok(firstPage.nextCursor.length <= 512);
      assert.deepEqual(firstPage.head, fixture.headAtFirstPage);
      assert.equal(firstPage.currentVersion.versionId, fixture.v28.versionId);
      assert.equal(firstPage.currentVersion.isCurrent, true);
      assert.equal(firstPage.currentVersion.versionNo, 28);
      assert.deepEqual(firstPage.currentVersion.labels, []);
      assert.equal(firstPage.currentVersion.createdByLabel, '攝影師');
      assert.ok(
        firstPage.versions.every(
          (version) =>
            version.versionId !== fixture.v3.versionId &&
            version.isCurrent ===
              (version.versionId === firstPage.head.versionId),
        ),
      );
      assert.deepEqual(
        firstPage.versions.map((version) => version.versionNo),
        Array.from({ length: 24 }, (_, index) => 28 - index),
      );

      const expectedVersionKeys = [
        'createdAt',
        'createdByLabel',
        'height',
        'isCurrent',
        'labels',
        'previewUrl',
        'thumbnailUrl',
        'versionId',
        'versionNo',
        'width',
      ].sort();
      for (const version of [firstPage.currentVersion, ...firstPage.versions]) {
        assert.deepEqual(Object.keys(version).sort(), expectedVersionKeys);
        assert.equal(version.createdByLabel, '攝影師');
        assert.equal(
          version.thumbnailUrl,
          assetPath(fixture.photoId, version.versionId, 'thumbnail'),
        );
        assert.equal(
          version.previewUrl,
          assetPath(fixture.photoId, version.versionId, 'preview'),
        );
        assert.ok(Array.isArray(version.labels));
      }

      const secondPage = await readJson(
        await send(
          guestWorker,
          versionsPath + '?cursor=' + encodeURIComponent(firstPage.nextCursor),
          { secret: fixture.compareGuest.secret },
        ),
        200,
      );
      assert.deepEqual(
        secondPage.versions.map((version) => version.versionNo),
        [4, 2, 1],
      );
      assert.equal(secondPage.currentVersion.versionId, fixture.v28.versionId);
      assert.equal(
        secondPage.versions.some(
          (version) => version.versionId === fixture.v3.versionId,
        ),
        false,
      );
      assert.deepEqual(
        secondPage.versions.find(
          (version) => version.versionId === fixture.v2.versionId,
        )?.labels,
        ['Retouched', 'Client approved'],
      );
      assert.equal(
        secondPage.versions.find(
          (version) => version.versionId === fixture.v1.versionId,
        )?.createdByLabel,
        '攝影師',
      );
      assert.deepEqual(
        secondPage.versions.find(
          (version) => version.versionId === fixture.v1.versionId,
        )?.labels,
        [],
      );
      assert.equal(secondPage.versions[2]?.isCurrent, false);

      const metadataJson = JSON.stringify({ firstPage, secondPage });
      for (const forbidden of [
        fixture.compareGuest.secret,
        fixture.privateChangeNote,
        fixture.privateUnpublishedChangeNote,
        fixture.v2.objectKey,
        fixture.v2.checksum,
        owner,
        'actorId',
        'changeNote',
        'source_hash_sha256',
        'object_key',
        'checksum_sha256',
      ]) {
        assert.equal(metadataJson.includes(forbidden), false);
      }

      const auditAfter = await db
        .prepare('SELECT count(*) AS n FROM audit_events WHERE workspace_id=?')
        .bind(fixture.workspace.id)
        .first();
      assert.equal(auditAfter.n, auditBefore.n);
    },
  );

  await check(
    'Guest cursor validation binds photo and head, and rejects stale pagination',
    async () => {
      assert.equal(
        (
          await send(guestWorker, versionsPath + '?cursor=not-valid*', {
            secret: fixture.compareGuest.secret,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await send(guestWorker, versionsPath + '?cursor=one&cursor=two', {
            secret: fixture.compareGuest.secret,
          })
        ).status,
        400,
      );
      const current = await headState();
      const foreignPhotoCursor = cursorFor({
        photoId: randomUUID(),
        headVersionId: current.versionId,
        headRevision: current.revision,
        lastVersionNo: 1,
      });
      assert.equal(
        (
          await send(
            guestWorker,
            versionsPath + '?cursor=' + encodeURIComponent(foreignPhotoCursor),
            { secret: fixture.compareGuest.secret },
          )
        ).status,
        400,
      );

      const pageBeforeSwitch = await readJson(
        await send(guestWorker, versionsPath, {
          secret: fixture.compareGuest.secret,
        }),
        200,
      );
      assert.ok(pageBeforeSwitch.nextCursor);
      const staleCursor = pageBeforeSwitch.nextCursor;
      await fixture.setHead(fixture.v1.versionId);
      const staleResponse = await readJson(
        await send(
          guestWorker,
          versionsPath + '?cursor=' + encodeURIComponent(staleCursor),
          { secret: fixture.compareGuest.secret },
        ),
        409,
      );
      assert.equal(staleResponse?.error?.code, 'GUEST_VERSION_HISTORY_CHANGED');
    },
  );

  await check(
    'Restored old current versions stay pinned outside page one while private ready V3 remains hidden',
    async () => {
      const firstPage = await readJson(
        await send(guestWorker, versionsPath, {
          secret: fixture.compareGuest.secret,
        }),
        200,
      );
      assert.equal(firstPage.head.versionId, fixture.v1.versionId);
      assert.equal(firstPage.currentVersion.versionId, fixture.v1.versionId);
      assert.equal(firstPage.currentVersion.versionNo, 1);
      assert.equal(firstPage.currentVersion.isCurrent, true);
      assert.deepEqual(firstPage.currentVersion.labels, []);
      assert.equal(
        firstPage.versions.some(
          (version) => version.versionId === fixture.v1.versionId,
        ),
        false,
      );
      assert.equal(firstPage.versions.length, 24);
      assert.ok(firstPage.nextCursor);
      assert.ok(
        firstPage.versions.every((version) => version.isCurrent === false),
      );
      assert.equal(
        firstPage.versions.some(
          (version) => version.versionId === fixture.v3.versionId,
        ),
        false,
      );

      const secondPage = await readJson(
        await send(
          guestWorker,
          versionsPath + '?cursor=' + encodeURIComponent(firstPage.nextCursor),
          { secret: fixture.compareGuest.secret },
        ),
        200,
      );
      assert.deepEqual(
        secondPage.versions.map((version) => version.versionNo),
        [4, 2, 1],
      );
      assert.equal(secondPage.currentVersion.versionId, fixture.v1.versionId);
      assert.equal(
        secondPage.versions.find(
          (version) => version.versionId === fixture.v1.versionId,
        )?.isCurrent,
        true,
      );
      assert.equal(
        secondPage.versions.some(
          (version) => version.versionId === fixture.v3.versionId,
        ),
        false,
      );

      const emptyTailCursor = cursorFor({
        photoId: fixture.photoId,
        headVersionId: fixture.v1.versionId,
        headRevision: (await headState()).revision,
        lastVersionNo: 1,
      });
      const emptyTail = await readJson(
        await send(
          guestWorker,
          versionsPath + '?cursor=' + encodeURIComponent(emptyTailCursor),
          { secret: fixture.compareGuest.secret },
        ),
        200,
      );
      assert.deepEqual(emptyTail.versions, []);
      assert.equal(emptyTail.currentVersion.versionId, fixture.v1.versionId);
      assert.equal(emptyTail.nextCursor, null);
    },
  );

  await check(
    'Guest reads preserve current viewing while historical comparison requires both independent rights',
    async () => {
      const currentUrl = assetPath(
        fixture.photoId,
        fixture.v1.versionId,
        'preview',
      );
      const historicalUrl = assetPath(
        fixture.photoId,
        fixture.v2.versionId,
        'preview',
      );
      const unpublishedUrl = assetPath(
        fixture.photoId,
        fixture.v3.versionId,
        'preview',
      );

      const compareCurrent = await send(guestWorker, currentUrl, {
        secret: fixture.compareGuest.secret,
      });
      assert.equal(compareCurrent.status, 200);
      assert.equal(compareCurrent.headers.get('Content-Type'), 'image/jpeg');
      assert.equal(
        compareCurrent.headers.get('Cache-Control'),
        'private, no-store',
      );
      await compareCurrent.arrayBuffer();

      const viewOnlyCurrent = await send(versionsWorker, currentUrl, {
        secret: fixture.viewOnlyGuest.secret,
      });
      assert.equal(viewOnlyCurrent.status, 200);
      assert.equal(viewOnlyCurrent.headers.get('Content-Type'), 'image/jpeg');
      await viewOnlyCurrent.arrayBuffer();

      await expectDenied(
        await send(guestWorker, historicalUrl, {
          secret: fixture.viewOnlyGuest.secret,
        }),
      );
      await expectDenied(
        await send(guestWorker, currentUrl, {
          secret: fixture.compareOnlyGuest.secret,
        }),
      );
      const compareHistorical = await send(guestWorker, historicalUrl, {
        secret: fixture.compareGuest.secret,
      });
      assert.equal(compareHistorical.status, 200);
      assert.equal(compareHistorical.headers.get('Content-Type'), 'image/jpeg');
      await compareHistorical.arrayBuffer();

      await expectDenied(
        await send(guestWorker, unpublishedUrl, {
          secret: fixture.compareGuest.secret,
        }),
      );
      assert.equal(
        (
          await send(
            guestWorker,
            assetPath(fixture.photoId, fixture.v1.versionId, 'original'),
            { secret: fixture.compareGuest.secret },
          )
        ).status,
        400,
      );
      await expectDenied(
        await send(guestWorker, currentUrl, { ownerCookie: true }),
      );
      await expectDenied(
        await send(guestWorker, versionsPath, { ownerCookie: true }),
      );
      await expectDenied(
        await send(
          guestWorker,
          assetPath(randomUUID(), fixture.v1.versionId, 'preview'),
          { secret: fixture.compareGuest.secret },
        ),
      );
      await expectDenied(
        await send(
          guestWorker,
          assetPath(fixture.photoId, randomUUID(), 'preview'),
          { secret: fixture.compareGuest.secret },
        ),
      );
      await expectDenied(
        await send(
          guestWorker,
          '/api/guest/albums/' +
            fixture.siblingAlbum.id +
            '/photos/' +
            fixture.photoId +
            '/versions',
          { secret: fixture.compareGuest.secret },
        ),
      );
      await expectDenied(
        await send(
          guestWorker,
          '/api/guest/albums/' +
            fixture.album.id +
            '/photos/' +
            randomUUID() +
            '/versions',
          { secret: fixture.compareGuest.secret },
        ),
      );
    },
  );

  await check(
    'Guest history and derivative reads repeat revocation expiry and parent checks',
    async () => {
      const inviteRevoked = await fixture.createGuest({
        mask: canViewAndCompare,
      });
      await db
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(inviteRevoked.inviteId, owner, fixture.ownerSessionId)
        .run();
      await expectDenied(
        await send(guestWorker, versionsPath, {
          secret: inviteRevoked.secret,
        }),
      );
      await expectDenied(
        await send(
          guestWorker,
          assetPath(fixture.photoId, fixture.v1.versionId, 'preview'),
          { secret: inviteRevoked.secret },
        ),
      );

      const sessionRevoked = await fixture.createGuest({
        mask: canViewAndCompare,
      });
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(sessionRevoked.sessionId, hashGuestSession(sessionRevoked.secret))
        .run();
      await expectDenied(
        await send(guestWorker, versionsPath, {
          secret: sessionRevoked.secret,
        }),
      );
      await expectDenied(
        await send(
          guestWorker,
          assetPath(fixture.photoId, fixture.v1.versionId, 'preview'),
          { secret: sessionRevoked.secret },
        ),
      );

      const expiringGuest = await fixture.createGuest({
        mask: canViewAndCompare,
        sessionExpiresAt: Date.now() + 1600,
      });
      await new Promise((resolve) => setTimeout(resolve, 1700));
      await expectDenied(
        await send(guestWorker, versionsPath, {
          secret: expiringGuest.secret,
        }),
      );
      await expectDenied(
        await send(
          guestWorker,
          assetPath(fixture.photoId, fixture.v1.versionId, 'preview'),
          { secret: expiringGuest.secret },
        ),
      );

      const disabledOwnerGuest = await fixture.createGuest({
        mask: canViewAndCompare,
      });
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectDenied(
          await send(guestWorker, versionsPath, {
            secret: disabledOwnerGuest.secret,
          }),
        );
        await expectDenied(
          await send(
            guestWorker,
            assetPath(fixture.photoId, fixture.v1.versionId, 'preview'),
            { secret: disabledOwnerGuest.secret },
          ),
        );
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }

      const archivedParentGuest = await fixture.createGuest({
        mask: canViewAndCompare,
      });
      const parentBefore = await db
        .prepare('SELECT status FROM projects WHERE id=?')
        .bind(fixture.project.id)
        .first();
      assert.ok(parentBefore?.status);
      await db
        .prepare(
          "UPDATE projects SET status='archived',archived_from_status=? WHERE id=?",
        )
        .bind(parentBefore.status, fixture.project.id)
        .run();
      try {
        await expectDenied(
          await send(guestWorker, versionsPath, {
            secret: archivedParentGuest.secret,
          }),
        );
        await expectDenied(
          await send(
            guestWorker,
            assetPath(fixture.photoId, fixture.v1.versionId, 'preview'),
            { secret: archivedParentGuest.secret },
          ),
        );
      } finally {
        await db
          .prepare(
            'UPDATE projects SET status=?,archived_from_status=NULL WHERE id=?',
          )
          .bind(parentBefore.status, fixture.project.id)
          .run();
      }
    },
  );

  const revokeCompareAccess = async () => {
    await db
      .prepare(
        'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
      )
      .bind(fixture.compareGuest.inviteId, owner, fixture.ownerSessionId)
      .run();
  };

  return {
    createReadyPhoto: fixture.createReadyPhoto,
    workspaceId: fixture.workspace.id,
    projectId: fixture.project.id,
    albumId: fixture.album.id,
    photoId: fixture.photoId,
    filename: fixture.filename,
    neighborPhotoId: fixture.neighborPhotoId,
    neighborFilename: fixture.neighborFilename,
    currentVersionId: fixture.v1.versionId,
    latestVersionId: fixture.v28.versionId,
    unpublishedVersionId: fixture.v3.versionId,
    secretCompare: fixture.compareGuest.secret,
    sessionIdCompare: fixture.compareGuest.sessionId,
    secretViewOnly: fixture.viewOnlyGuest.secret,
    secretCompareOnly: fixture.compareOnlyGuest.secret,
    revokeCompareAccess,
    workerName: 'guest-version-comparison-test',
  };
}
