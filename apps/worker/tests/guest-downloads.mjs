import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { pngFixture } from './image-fixtures.mjs';

const tokenHash = (token) =>
  createHash('sha256')
    .update(`kino-pic:guest-invite-token:v1:${token}`)
    .digest('hex');
const guestSecretHash = (secret) =>
  createHash('sha256')
    .update(`kino-pic:guest-session:v1:${secret}`)
    .digest('hex');

async function jsonAt(response, status, label) {
  assert.equal(
    response.status,
    status,
    `${label}: ${await response.clone().text()}`,
  );
  return response.json();
}
function guestCookieSecret(response) {
  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^kino_guest=[a-f0-9]{64};/u);
  return /^kino_guest=([a-f0-9]{64});/u.exec(setCookie)?.[1] ?? '';
}
async function denied(response, label) {
  assert.equal(
    response.status,
    401,
    `${label}: ${await response.clone().text()}`,
  );
  assert.deepEqual(await response.json(), {
    error: { code: 'GUEST_ACCESS_REQUIRED' },
  });
}
function assertNoPrivateMetadata(page) {
  assert.doesNotMatch(
    JSON.stringify(page),
    /objectKey|storageNodeId|checksum|sha256|assetId/u,
  );
}
export async function guestDownloadChecks({
  db,
  worker,
  request,
  owner,
  ownerSessionId,
  ownerCookie,
  base,
  storage,
  fixtureOnly = false,
}) {
  const ownerHeaders = {
    Cookie: ownerCookie,
    Origin: base,
    'Content-Type': 'application/json',
  };
  const ownerPost = async (path, body) =>
    jsonAt(
      await request(path, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ ...body, requestId: randomUUID() }),
      }),
      201,
      path,
    );

  const { workspace } = await ownerPost('/api/v1/workspaces', {
    name: 'Guest download fixture',
  });
  const { project } = await ownerPost('/api/v1/projects', {
    workspaceId: workspace.id,
    name: 'Guest download fixture',
  });
  const albumId = randomUUID();
  const unsharedAlbumId = randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(albumId, workspace.id, project.id, 'Guest download album'),
    db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(unsharedAlbumId, workspace.id, project.id, 'Unshared guest album'),
  ]);

  const source = pngFixture();
  const sourceFilename = 'guest-download-source.png';
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const init = await ownerPost('/api/v1/uploads/init', {
    workspaceId: workspace.id,
    projectId: project.id,
    albumId,
    originalFilename: sourceFilename,
    expectedBytes: source.byteLength,
    contentType: 'image/png',
    sha256: sourceHash,
  });
  const uploadSession = init.uploadSession;
  assert.ok(uploadSession?.id);
  await jsonAt(
    await request(`/api/v1/uploads/${uploadSession.id}/authorize`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ requestId: randomUUID() }),
    }),
    200,
    'upload authorize',
  );
  const uploadRow = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(uploadSession.id)
    .first();
  assert.ok(uploadRow?.object_key);
  await storage.put(uploadRow.object_key, new Uint8Array(source), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: sourceHash,
  });
  const completionResponse = await request(
    `/api/v1/uploads/${uploadSession.id}/complete`,
    {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ requestId: randomUUID() }),
    },
  );
  const completionBody = await jsonAt(
    completionResponse,
    200,
    'upload complete',
  );
  const completion = completionBody.completion;
  assert.ok(completion?.assetId && completion?.versionId);
  assert.notEqual(
    completion.assetId,
    uploadSession.id,
    'asset ID must come from the completion witness, not the upload session',
  );

  const jobs = new D1ImageProcessingRepository(db);
  const objects = new R2ProcessingObjectStore(storage);
  const processor = new LocalSharpImageProcessor();
  const processing = await runImageProcessingJob({
    jobId: completion.assetId,
    jobs,
    objects,
    processor,
  });
  assert.equal(processing.status, 'succeeded');
  const photo = await db
    .prepare(
      "SELECT p.id AS photoId,v.id AS versionId FROM photo_assets a JOIN photos p ON p.id=a.photo_id AND p.workspace_id=a.workspace_id AND p.project_id=? AND p.album_id=? JOIN photo_versions v ON v.id=a.version_id AND v.photo_id=p.id AND v.workspace_id=p.workspace_id WHERE a.id=? AND a.asset_kind='original'",
    )
    .bind(project.id, albumId, completion.assetId)
    .first();
  assert.ok(photo?.photoId && photo?.versionId);
  const assets = (
    await db
      .prepare(
        "SELECT id,asset_kind,object_key,storage_node_id,byte_size,mime,checksum_sha256,state FROM photo_assets WHERE version_id=? AND asset_kind IN('original','preview') ORDER BY asset_kind",
      )
      .bind(photo.versionId)
      .all()
  ).results;
  const original = assets.find((asset) => asset.asset_kind === 'original');
  const preview = assets.find((asset) => asset.asset_kind === 'preview');
  assert.ok(original && preview);
  assert.equal(original.state, 'private');
  assert.equal(preview.state, 'private');

  const makeInvite = async (permissionsMask, name) => {
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
      )
      .bind(
        id,
        workspace.id,
        project.id,
        tokenHash(token),
        permissionsMask,
        Date.now() + 3_600_000,
        owner,
        ownerSessionId,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(id, workspace.id, project.id, albumId)
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(id)
      .run();
    return { id, token, name };
  };

  let ipOctet = 121;
  const exchange = async (invite) => {
    const response = await worker.fetch(
      new Request(base + '/api/guest/exchange', {
        method: 'POST',
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': `198.51.100.${ipOctet++}`,
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          token: invite.token,
          displayName: invite.name,
        }),
      }),
    );
    await jsonAt(response, 200, 'Guest exchange');
    const cookie = guestCookieSecret(response);
    assert.ok(cookie);
    const session = await db
      .prepare(
        'SELECT id,guest_id,secret_hash FROM guest_sessions WHERE invite_id=?',
      )
      .bind(invite.id)
      .first();
    assert.ok(session?.id && session?.guest_id);
    assert.equal(session.secret_hash, guestSecretHash(cookie));
    return {
      inviteId: invite.id,
      guestId: session.guest_id,
      sessionId: session.id,
      secretHash: session.secret_hash,
      cookie,
    };
  };

  const previewGuest = await exchange(
    await makeInvite(2, 'Preview only guest'),
  );
  const originalGuest = await exchange(
    await makeInvite(4, 'Original only guest'),
  );
  const viewGuest = await exchange(await makeInvite(1, 'View only guest'));
  if (fixtureOnly)
    return {
      fixture: {
        workspaceId: workspace.id,
        projectId: project.id,
        albumId,
        unsharedAlbumId,
        photoId: photo.photoId,
        versionId: photo.versionId,
        sourceFilename,
        viewGuest,
        downloadGuest: originalGuest,
        createGuest: async (mask = 1) =>
          exchange(await makeInvite(mask, 'Human view fixture')),
      },
    };

  const getAs = (path, guest) =>
    request(path, { headers: { Cookie: `kino_guest=${guest.cookie}` } });
  const pagePath = (id = albumId) => `/api/guest/albums/${id}/downloads`;
  const downloadPath = (photoId, versionId, kind) =>
    `/api/guest/photos/${photoId}/versions/${versionId}/downloads/${kind}`;
  const countDownloadAudit = async (guest) =>
    (
      await db
        .prepare(
          "SELECT count(*) AS count FROM audit_events WHERE actor_id=? AND guest_session_id=? AND action IN('download.requested','download.generated')",
        )
        .bind(guest.guestId, guest.sessionId)
        .first()
    ).count;
  const checks = [];

  const versionDownloadPath = (kind) =>
    downloadPath(photo.photoId, photo.versionId, kind);
  const auditRows = (guest) =>
    db
      .prepare(
        "SELECT event_id,actor_type,actor_id,guest_session_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id FROM audit_events WHERE actor_id=? AND guest_session_id=? AND action IN('download.requested','download.generated') ORDER BY action,event_id",
      )
      .bind(guest.guestId, guest.sessionId)
      .all();

  {
    const previewPageResponse = await getAs(pagePath(), previewGuest);
    const previewPage = await jsonAt(
      previewPageResponse,
      200,
      'preview-only catalogue',
    );
    assert.equal(previewPage.access.permissions.can_view, false);
    assert.equal(previewPage.access.permissions.can_download_preview, true);
    assert.equal(previewPage.access.permissions.can_download_original, false);
    assert.equal(previewPage.photos.length, 1);
    assert.equal(previewPage.photos[0].photoId, photo.photoId);
    assert.equal(previewPage.photos[0].versionId, photo.versionId);
    assert.equal(previewPage.photos[0].filename, sourceFilename);
    assert.equal(
      previewPage.photos[0].preview.filename,
      'guest-download-source.preview.jpg',
    );
    assert.equal(previewPage.photos[0].preview.byteSize, preview.byte_size);
    assert.equal(previewPage.photos[0].preview.mime, 'image/jpeg');
    assert.equal(previewPage.photos[0].original, null);
    assert.equal(previewPage.nextCursor, null);
    assertNoPrivateMetadata(previewPage);

    const originalPageResponse = await getAs(pagePath(), originalGuest);
    const originalPage = await jsonAt(
      originalPageResponse,
      200,
      'original-only catalogue',
    );
    assert.equal(originalPage.access.permissions.can_view, false);
    assert.equal(originalPage.access.permissions.can_download_preview, false);
    assert.equal(originalPage.access.permissions.can_download_original, true);
    assert.equal(originalPage.photos.length, 1);
    assert.equal(originalPage.photos[0].preview, null);
    assert.equal(originalPage.photos[0].original.filename, sourceFilename);
    assert.equal(originalPage.photos[0].original.byteSize, original.byte_size);
    assert.equal(originalPage.photos[0].original.mime, 'image/png');
    assertNoPrivateMetadata(originalPage);
    checks.push(
      'preview/original catalogues expose only the matching ready asset without can_view',
    );
  }

  {
    const downloadAndAssert = async (guest, kind, asset) => {
      const response = await getAs(versionDownloadPath(kind), guest);
      if (response.status !== 200) {
        const routeBody = await response
          .clone()
          .json()
          .catch(() => null);
        const events = (await auditRows(guest)).results;
        throw new Error(
          'Guest download failure: ' +
            JSON.stringify({
              routeStatus: response.status,
              routeBody,
              requested: events.filter(
                (row) => row.action === 'download.requested',
              ).length,
              generated: events.filter(
                (row) => row.action === 'download.generated',
              ).length,
            }),
        );
      }
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Content-Type'), asset.mime);
      assert.equal(
        Number(response.headers.get('Content-Length')),
        asset.byte_size,
      );
      const actual = Buffer.from(await response.arrayBuffer());
      const stored = await storage.get(asset.object_key);
      assert.ok(stored, `missing private ${kind} R2 fixture`);
      const expected = Buffer.from(await stored.arrayBuffer());
      const actualHash = createHash('sha256').update(actual).digest('hex');
      assert.deepEqual(actual, expected);
      assert.equal(actual.byteLength, asset.byte_size);
      assert.equal(actualHash, asset.checksum_sha256);
      assert.equal(
        createHash('sha256').update(expected).digest('hex'),
        asset.checksum_sha256,
      );

      const rows = (await auditRows(guest)).results;
      assert.equal(rows.length, 2);
      const requested = rows.find((row) => row.action === 'download.requested');
      const generated = rows.find((row) => row.action === 'download.generated');
      assert.ok(requested && generated);
      assert.notEqual(requested.event_id, generated.event_id);
      assert.equal(requested.request_id, generated.request_id);
      const expectedAfter = {
        assetKind: kind,
        assetId: asset.id,
        filename: sourceFilename,
        byteSize: asset.byte_size,
        mime: asset.mime,
      };
      for (const row of [requested, generated]) {
        assert.equal(row.actor_type, 'guest');
        assert.equal(row.actor_id, guest.guestId);
        assert.equal(row.guest_session_id, guest.sessionId);
        assert.equal(row.session_id, null);
        assert.equal(row.workspace_id, workspace.id);
        assert.equal(row.project_id, project.id);
        assert.equal(row.album_id, albumId);
        assert.equal(row.photo_id, photo.photoId);
        assert.equal(row.version_id, photo.versionId);
        assert.equal(row.before_json, null);
        assert.deepEqual(JSON.parse(row.after_json), expectedAfter);
        assert.equal(
          Object.keys(JSON.parse(row.after_json)).sort().join(','),
          'assetId,assetKind,byteSize,filename,mime',
        );
      }
      assert.equal(requested.after_json, generated.after_json);
    };

    await downloadAndAssert(previewGuest, 'preview', preview);
    await downloadAndAssert(originalGuest, 'original', original);

    await db.exec(
      "CREATE TRIGGER guest_downloads_generated_abort BEFORE INSERT ON audit_events WHEN NEW.action='download.generated' BEGIN SELECT RAISE(ABORT,'INJECTED_DOWNLOAD_GENERATED_AUDIT_FAILURE'); END",
    );
    try {
      const failure = await getAs(
        versionDownloadPath('original'),
        originalGuest,
      );
      assert.equal(failure.status, 503, await failure.clone().text());
      assert.equal(
        failure.headers.get('Content-Type')?.split(';')[0],
        'application/json',
      );
      assert.deepEqual(await failure.json(), {
        error: { code: 'DOWNLOAD_AUDIT_UNAVAILABLE' },
      });
      const failedAuditRows = (await auditRows(originalGuest)).results;
      const requested = failedAuditRows.filter(
        (row) => row.action === 'download.requested',
      );
      const generated = failedAuditRows.filter(
        (row) => row.action === 'download.generated',
      );
      assert.equal(requested.length, 2);
      assert.equal(generated.length, 1);
      const generatedRequestIds = new Set(
        generated.map((row) => row.request_id),
      );
      assert.equal(
        requested.filter((row) => !generatedRequestIds.has(row.request_id))
          .length,
        1,
      );
    } finally {
      await db.exec('DROP TRIGGER guest_downloads_generated_abort');
    }

    const rejectForged = async ({
      actorType,
      actorId,
      guestSessionId,
      sessionId,
      assetId,
    }) => {
      const eventId = randomUUID();
      const requestId = randomUUID();
      const afterJson = JSON.stringify({
        assetKind: 'original',
        assetId,
        filename: sourceFilename,
        byteSize: original.byte_size,
        mime: original.mime,
      });
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            eventId,
            actorType,
            actorId,
            guestSessionId,
            sessionId,
            workspace.id,
            project.id,
            albumId,
            photo.photoId,
            photo.versionId,
            'download.requested',
            null,
            afterJson,
            requestId,
          )
          .run(),
        /GUEST_MEDIA_DOWNLOAD_INVALID/u,
      );
      const absent = await db
        .prepare('SELECT event_id FROM audit_events WHERE event_id=?')
        .bind(eventId)
        .first();
      assert.equal(absent, null);
    };

    await rejectForged({
      actorType: 'user',
      actorId: owner,
      guestSessionId: null,
      sessionId: ownerSessionId,
      assetId: original.id,
    });
    await rejectForged({
      actorType: 'guest',
      actorId: originalGuest.guestId,
      guestSessionId: originalGuest.sessionId,
      sessionId: null,
      assetId: randomUUID(),
    });
    checks.push(
      'current private bytes match their hashes, requested/generated audits pair exactly, and native forged inserts abort',
    );
  }

  {
    const beforePreviewAudit = await countDownloadAudit(previewGuest);
    await denied(
      await getAs(
        downloadPath(photo.photoId, photo.versionId, 'original'),
        previewGuest,
      ),
      'preview permission cannot download original',
    );
    assert.equal(await countDownloadAudit(previewGuest), beforePreviewAudit);

    const beforeOriginalAudit = await countDownloadAudit(originalGuest);
    await denied(
      await getAs(
        downloadPath(photo.photoId, photo.versionId, 'preview'),
        originalGuest,
      ),
      'original permission cannot download preview',
    );
    await denied(
      await getAs(
        downloadPath(photo.photoId, randomUUID(), 'original'),
        originalGuest,
      ),
      'non-current version UUID',
    );
    await denied(
      await getAs(
        downloadPath(randomUUID(), photo.versionId, 'original'),
        originalGuest,
      ),
      'foreign photo UUID',
    );
    await denied(
      await getAs(pagePath(unsharedAlbumId), originalGuest),
      'album outside sealed invite scope',
    );
    assert.equal(await countDownloadAudit(originalGuest), beforeOriginalAudit);

    await denied(await getAs(pagePath(), viewGuest), 'view-only catalogue');
    const beforeViewAudit = await countDownloadAudit(viewGuest);
    await denied(
      await getAs(versionDownloadPath('preview'), viewGuest),
      'view-only Guest download',
    );
    assert.equal(await countDownloadAudit(viewGuest), beforeViewAudit);

    await db
      .prepare(
        'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
      )
      .bind(previewGuest.sessionId, previewGuest.secretHash)
      .run();
    const beforeRevokedAudit = await countDownloadAudit(previewGuest);
    await denied(
      await getAs(pagePath(), previewGuest),
      'revoked session catalogue',
    );
    await denied(
      await getAs(versionDownloadPath('preview'), previewGuest),
      'revoked session download',
    );
    assert.equal(await countDownloadAudit(previewGuest), beforeRevokedAudit);
    checks.push(
      'opposite permission, view-only, stale/foreign IDs, unshared album and revoked session deny without download audits',
    );
  }

  return {
    checks,
    browser: { albumId, cookie: originalGuest.cookie },
  };
}
