import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSignature } from 'better-auth/crypto';
import { applyMigration } from './apply-migration.mjs';
import { guestDownloadChecks } from './guest-downloads.mjs';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { pngFixture } from './image-fixtures.mjs';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import {
  guestCommentResultSchema,
  guestCommentsPageSchema,
} from '../../../packages/contracts/src/guest-comments.ts';

const base = 'http://127.0.0.1:8787';
let stage = 'initialize';
const authSecret = 'synthetic-test-only-secret-at-least-forty-characters';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'true',
  GUEST_COMMENTS_ENABLED: 'true',
  GUEST_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATIONS_ENABLED: 'true',
  OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
  FREEHAND_ANNOTATIONS_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
  OWNER_COMMENTS_ENABLED: 'true',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-key-never-for-production',
  R2_BUCKET_NAME: 'kino-pic-feedback-test-private',
  BETTER_AUTH_SECRET: authSecret,
  GOOGLE_CLIENT_ID: 'local-google',
  GOOGLE_CLIENT_SECRET: 'fixture',
  GITHUB_CLIENT_ID: 'local-github',
  GITHUB_CLIENT_SECRET: 'fixture',
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashGuestSession = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const hashInviteToken = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

async function json(response, status, label) {
  const value = await response.json();
  assert.equal(response.status, status, `${label}: ${JSON.stringify(value)}`);
  return value;
}

function ownerHeaders(ownerCookie, origin = base, ownerId = '') {
  return {
    Cookie: ownerCookie,
    Origin: origin,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': ownerId,
  };
}

export async function createAlbumOwnerFeedbackFixture({
  db,
  worker,
  base: origin,
  ownerId,
  ownerSessionId,
  ownerCookie,
  storage,
}) {
  const request = (path, init = {}) =>
    worker.fetch(new Request(new URL(path, origin), init));
  const ownerPost = async (path, payload, status = 201) => {
    const headers = ownerHeaders(ownerCookie, origin, ownerId);
    return json(
      await request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ requestId: randomUUID(), ...payload }),
      }),
      status,
      path,
    );
  };
  let beforeInvites;
  const { fixture: shared } = await guestDownloadChecks({
    db,
    worker,
    request,
    owner: ownerId,
    ownerSessionId,
    ownerCookie,
    base: origin,
    storage,
    fixtureOnly: true,
    beforeInvites: async (scope) => {
      stage = 'owner-zero-invite-create';
      const count = await db
        .prepare(
          'SELECT count(*) AS count FROM guest_invites WHERE project_id=?',
        )
        .bind(scope.project.id)
        .first();
      assert.equal(
        Number(count?.count),
        0,
        'Owner creates feedback at zero invites',
      );
      const commentRequestId = randomUUID();
      const annotationRequestId = randomUUID();
      const commentCommand = {
        requestId: commentRequestId,
        operation: 'create_comment',
        photoId: scope.photoId,
        versionId: scope.versionId,
        body: 'Owner note created before any invite exists',
      };
      const annotationCommand = {
        requestId: annotationRequestId,
        operation: 'create_annotation',
        photoId: scope.photoId,
        versionId: scope.versionId,
        geometry: {
          type: 'freehand',
          coordinateSpace: 'normalized_1e6',
          version: 1,
          points: [
            { x: 120_000, y: 210_000 },
            { x: 260_000, y: 370_000 },
            { x: 410_000, y: 340_000 },
          ],
        },
        style: { color: 'amber' },
      };
      const postCommand = async (command) => {
        const headers = ownerHeaders(ownerCookie, origin, ownerId);
        const response = await request(
          `/api/v1/albums/${scope.albumId}/owner-feedback/commands`,
          { method: 'POST', headers, body: JSON.stringify(command) },
        );
        return json(response, 200, 'zero-invite Owner feedback command');
      };
      beforeInvites = {
        comment: commentCommand,
        annotation: annotationCommand,
        commentResult: await postCommand(commentCommand),
        annotationResult: await postCommand(annotationCommand),
      };
      assert.equal(beforeInvites.commentResult.item.authorType, 'owner');
      assert.equal(beforeInvites.annotationResult.item.kind, 'annotation');
    },
  });

  stage = 'fixture-second-photo';
  const uploadBytes = pngFixture();
  const uploadHash = sha256(uploadBytes);
  const nextFilename = 'owner-feedback-next.png';
  const initialized = await ownerPost('/api/v1/uploads/init', {
    workspaceId: shared.workspaceId,
    projectId: shared.projectId,
    albumId: shared.albumId,
    originalFilename: nextFilename,
    expectedBytes: uploadBytes.byteLength,
    contentType: 'image/png',
    sha256: uploadHash,
  });
  const uploadId = initialized.uploadSession.id;
  assert.ok(uploadId);
  await json(
    await request(`/api/v1/uploads/${uploadId}/authorize`, {
      method: 'POST',
      headers: ownerHeaders(ownerCookie, origin, ownerId),
      body: JSON.stringify({ requestId: randomUUID() }),
    }),
    200,
    'second photo upload authorize',
  );
  const uploadRow = await db
    .prepare('SELECT object_key FROM upload_sessions WHERE id=?')
    .bind(uploadId)
    .first();
  assert.ok(uploadRow?.object_key);
  await storage.put(uploadRow.object_key, new Uint8Array(uploadBytes), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: uploadHash,
  });
  const completed = await json(
    await request(`/api/v1/uploads/${uploadId}/complete`, {
      method: 'POST',
      headers: ownerHeaders(ownerCookie, origin, ownerId),
      body: JSON.stringify({ requestId: randomUUID() }),
    }),
    200,
    'second photo upload complete',
  );
  const nextPhoto = completed.completion;
  const jobs = new D1ImageProcessingRepository(db);
  const objects = new R2ProcessingObjectStore(storage);
  const processing = await runImageProcessingJob({
    jobId: nextPhoto.assetId,
    jobs,
    objects,
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processing.status, 'succeeded');

  const draft = await ownerPost(`/api/v1/projects/${shared.projectId}/albums`, {
    name: 'Owner feedback draft ' + randomUUID(),
  });
  const secondGuest = await shared.createGuest(1);
  const guestCommentAuthor = await shared.createGuest(1 | 256);
  const guestCommentPeer = await shared.createGuest(1 | 256);
  const foreignWorkspace = await ownerPost('/api/v1/workspaces', {
    name: 'Owner feedback foreign ' + randomUUID(),
  });
  const foreignProject = await ownerPost('/api/v1/projects', {
    workspaceId: foreignWorkspace.workspace.id,
    name: 'Owner feedback foreign project',
  });
  const foreignAlbum = await ownerPost(
    `/api/v1/projects/${foreignProject.project.id}/albums`,
    { name: 'Owner feedback foreign album' },
  );

  const guest = (item) => ({
    ...item,
    cookieName: 'kino_guest',
    cookieValue: item.cookie,
    cookieHeader: 'kino_guest=' + item.cookie,
  });
  return {
    workspaceId: shared.workspaceId,
    projectId: shared.projectId,
    albumId: shared.albumId,
    draftAlbumId: draft.album.id,
    unsharedAlbumId: shared.unsharedAlbumId,
    foreignWorkspaceId: foreignWorkspace.workspace.id,
    foreignAlbumId: foreignAlbum.album.id,
    photoId: shared.photoId,
    versionId: shared.versionId,
    filename: shared.sourceFilename,
    nextPhotoId: nextPhoto.photoId,
    nextVersionId: nextPhoto.versionId,
    nextFilename,
    ownerCookie,
    initialCommentId: beforeInvites.commentResult.item.id,
    initialAnnotationId: beforeInvites.annotationResult.item.id,
    zeroInviteComment: beforeInvites.comment,
    zeroInviteAnnotation: beforeInvites.annotation,
    zeroInviteCommentResult: beforeInvites.commentResult,
    zeroInviteAnnotationResult: beforeInvites.annotationResult,
    guestViewOnly: guest(shared.viewGuest),
    guestSecondViewOnly: guest(secondGuest),
    guestNoView: guest(shared.downloadGuest),
    guestCommentAuthor: guest(guestCommentAuthor),
    guestCommentPeer: guest(guestCommentPeer),
  };
}

async function ownerRead({
  worker,
  base: origin,
  ownerCookie,
  albumId,
  photoId,
  versionId,
}) {
  const path = `/api/v1/albums/${albumId}/photos/${photoId}/versions/${versionId}/owner-feedback`;
  return json(
    await worker.fetch(
      new Request(new URL(path, origin), { headers: { Cookie: ownerCookie } }),
    ),
    200,
    'Owner feedback read',
  );
}

async function guestRead({
  worker,
  base: origin,
  guest,
  albumId,
  photoId,
  versionId,
}) {
  const path = `/api/guest/albums/${albumId}/photos/${photoId}/versions/${versionId}/owner-feedback`;
  return worker.fetch(
    new Request(new URL(path, origin), {
      headers: { Cookie: `${guest.cookieName}=${guest.cookieValue}` },
    }),
  );
}

async function ownerCommand({
  worker,
  base: origin,
  fixture,
  command,
  status = 200,
}) {
  const headers = ownerHeaders(fixture.ownerCookie, origin, fixture.ownerId);
  return json(
    await worker.fetch(
      new Request(
        new URL(
          `/api/v1/albums/${fixture.albumId}/owner-feedback/commands`,
          origin,
        ),
        { method: 'POST', headers, body: JSON.stringify(command) },
      ),
    ),
    status,
    `Owner feedback ${command.operation}`,
  );
}

async function createExpiredViewGuest({
  db,
  fixture,
  ownerId,
  ownerSessionId,
}) {
  const inviteId = randomUUID();
  const guestId = randomUUID();
  const sessionId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',1,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        fixture.workspaceId,
        fixture.projectId,
        hashInviteToken(token),
        now + 30_000,
        ownerId,
        ownerSessionId,
      ),
    db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, fixture.workspaceId, fixture.projectId, fixture.albumId),
    db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId),
    db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(guestId, inviteId, 'Expiring native guest'),
    db
      .prepare(
        "INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)+1000)",
      )
      .bind(sessionId, inviteId, guestId, hashGuestSession(secret)),
  ]);
  return {
    inviteId,
    guestId,
    sessionId,
    cookie: secret,
    cookieName: 'kino_guest',
    cookieValue: secret,
  };
}

async function runNativeChecks({
  db,
  worker,
  storage,
  base: origin,
  fixture,
  ownerId,
  ownerSessionId,
}) {
  fixture.ownerId = ownerId;
  const created = fixture.zeroInviteCommentResult;
  const annotation = fixture.zeroInviteAnnotationResult;
  stage = 'owner-album-feedback-read';
  const ownerPage = await ownerRead({
    worker,
    base: origin,
    ownerCookie: fixture.ownerCookie,
    albumId: fixture.albumId,
    photoId: fixture.photoId,
    versionId: fixture.versionId,
  });
  assert.ok(
    ownerPage.items.some((item) => item.id === created.item.id),
    'Owner read retains the zero-invite comment',
  );
  assert.ok(
    ownerPage.items.some((item) => item.id === annotation.item.id),
    'Owner read retains the zero-invite annotation',
  );
  assert.equal(
    new Set(ownerPage.items.map((item) => item.id)).size,
    ownerPage.items.length,
    'Owner page contains each feedback item once',
  );
  for (const item of ownerPage.items) {
    assert.equal(item.authorType, 'owner');
    assert.equal(item.scope.kind, 'album');
    assert.equal(item.albumId, fixture.albumId);
    assert.equal(item.photoId, fixture.photoId);
    assert.equal(item.versionId, fixture.versionId);
  }
  for (const guest of [fixture.guestViewOnly, fixture.guestSecondViewOnly]) {
    stage = 'guest-can-view-read';
    const page = await json(
      await guestRead({
        worker,
        base: origin,
        guest,
        albumId: fixture.albumId,
        photoId: fixture.photoId,
        versionId: fixture.versionId,
      }),
      200,
      'can_view Guest Owner feedback read',
    );
    assert.deepEqual(page.items, ownerPage.items);
    assert.doesNotMatch(JSON.stringify(page), /inviteId|invite_id/u);
  }

  stage = 'guest-comment-invite-isolation';
  const guestCommentText = 'Guest private comment ' + randomUUID();
  const guestCommentCreate = await worker.fetch(
    new Request(
      new URL(`/api/guest/albums/${fixture.albumId}/comments/commands`, origin),
      {
        method: 'POST',
        headers: {
          Cookie: `kino_guest=${fixture.guestCommentAuthor.cookieValue}`,
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedGuestId: fixture.guestCommentAuthor.guestId,
          operation: 'create',
          targets: [{ photoId: fixture.photoId, versionId: fixture.versionId }],
          body: guestCommentText,
        }),
      },
    ),
  );
  const guestCommentCreated = guestCommentResultSchema.parse(
    await json(
      guestCommentCreate,
      200,
      'Guest A creates invite-scoped comment',
    ),
  );
  assert.equal(guestCommentCreated.items[0]?.body, guestCommentText);
  const readGuestComments = async (guest) => {
    const response = await worker.fetch(
      new Request(
        new URL(
          `/api/guest/albums/${fixture.albumId}/photos/${fixture.photoId}/versions/${fixture.versionId}/comments`,
          origin,
        ),
        { headers: { Cookie: `kino_guest=${guest.cookieValue}` } },
      ),
    );
    return guestCommentsPageSchema.parse(
      await json(response, 200, 'Guest invite-scoped comments read'),
    );
  };
  const authorComments = await readGuestComments(fixture.guestCommentAuthor);
  const peerComments = await readGuestComments(fixture.guestCommentPeer);
  assert.ok(
    authorComments.items.some((item) => item.body === guestCommentText),
    'Guest A can read their comment in the originating invite',
  );
  assert.ok(
    peerComments.items.every((item) => item.body !== guestCommentText),
    'Guest B cannot read Guest A invite-scoped comment',
  );
  assert.doesNotMatch(JSON.stringify(ownerPage), new RegExp(guestCommentText));
  for (const guest of [fixture.guestCommentAuthor, fixture.guestCommentPeer]) {
    const canonicalPage = await json(
      await guestRead({
        worker,
        base: origin,
        guest,
        albumId: fixture.albumId,
        photoId: fixture.photoId,
        versionId: fixture.versionId,
      }),
      200,
      'can_view and can_comment Guest reads canonical Owner feedback',
    );
    assert.deepEqual(canonicalPage.items, ownerPage.items);
  }

  const noView = await guestRead({
    worker,
    base: origin,
    guest: fixture.guestNoView,
    albumId: fixture.albumId,
    photoId: fixture.photoId,
    versionId: fixture.versionId,
  });
  assert.equal(
    noView.status,
    401,
    'A non-can_view invite cannot read Owner feedback',
  );

  stage = 'guest-write-denial';
  const guestWrite = await worker.fetch(
    new Request(
      new URL(
        `/api/v1/albums/${fixture.albumId}/owner-feedback/commands`,
        origin,
      ),
      {
        method: 'POST',
        headers: {
          Cookie: fixture.guestViewOnly.cookieHeader,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Kino-Expected-Actor': ownerId,
        },
        body: JSON.stringify({
          ...fixture.zeroInviteComment,
          requestId: randomUUID(),
          body: 'Guest cannot use the Owner write endpoint',
        }),
      },
    ),
  );
  assert.equal(
    guestWrite.status,
    401,
    'Guest writes remain outside Owner command scope',
  );

  stage = 'guest-album-scope-denial';
  for (const albumId of [fixture.unsharedAlbumId, fixture.foreignAlbumId]) {
    const denied = await guestRead({
      worker,
      base: origin,
      guest: fixture.guestViewOnly,
      albumId,
      photoId: fixture.photoId,
      versionId: fixture.versionId,
    });
    assert.equal(
      denied.status,
      401,
      'Guest read cannot cross invited album scope',
    );
  }

  stage = 'guest-expiry-denial';
  const expiringGuest = await createExpiredViewGuest({
    db,
    fixture,
    ownerId,
    ownerSessionId,
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_100));
  const expiredRead = await guestRead({
    worker,
    base: origin,
    guest: expiringGuest,
    albumId: fixture.albumId,
    photoId: fixture.photoId,
    versionId: fixture.versionId,
  });
  assert.equal(
    expiredRead.status,
    401,
    'Expired Guest sessions cannot read Owner feedback',
  );

  stage = 'owner-idempotency-cas';
  const replay = await ownerCommand({
    worker,
    base: origin,
    fixture,
    command: fixture.zeroInviteComment,
  });
  assert.deepEqual(
    replay,
    created,
    'Exact create retry returns its original result',
  );
  const conflictingReplay = await ownerCommand({
    worker,
    base: origin,
    fixture,
    command: {
      ...fixture.zeroInviteComment,
      body: 'different request payload',
    },
    status: 409,
  });
  assert.equal(conflictingReplay.error.code, 'REQUEST_ID_CONFLICT');

  const updateCommand = {
    requestId: randomUUID(),
    operation: 'update_comment',
    photoId: fixture.photoId.toUpperCase(),
    versionId: fixture.versionId.toUpperCase(),
    feedbackId: created.item.id.toUpperCase(),
    expectedRevision: 1,
    body: 'same update replayed concurrently',
  };
  const updates = await Promise.all(
    [0, 1].map(() =>
      ownerCommand({ worker, base: origin, fixture, command: updateCommand }),
    ),
  );
  assert.deepEqual(
    updates[0],
    updates[1],
    'Concurrent exact updates share the same receipt',
  );
  assert.equal(updates[0].item.revision, 2);
  const journalCount = await db
    .prepare(
      'SELECT count(*) AS count FROM album_owner_feedback_changes WHERE request_id=?',
    )
    .bind(updateCommand.requestId)
    .first();
  const auditCount = await db
    .prepare(
      'SELECT count(*) AS count FROM audit_events WHERE request_id=? AND action=?',
    )
    .bind(updateCommand.requestId, 'owner.album_feedback_updated')
    .first();
  assert.equal(
    Number(journalCount?.count),
    1,
    'An idempotent update appends one journal row',
  );
  assert.equal(
    Number(auditCount?.count),
    1,
    'An idempotent update appends one audit row',
  );

  stage = 'disabled-owner-replay-denial';
  await db
    .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
    .bind(ownerId)
    .run();
  const disabledReplay = await worker.fetch(
    new Request(
      new URL(
        `/api/v1/albums/${fixture.albumId}/owner-feedback/commands`,
        origin,
      ),
      {
        method: 'POST',
        headers: ownerHeaders(fixture.ownerCookie, origin, ownerId),
        body: JSON.stringify(fixture.zeroInviteComment),
      },
    ),
  );
  assert.equal(
    disabledReplay.status,
    403,
    'Disabled Owner cannot replay a prior result',
  );
  await db
    .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
    .bind(ownerId)
    .run();

  stage = 'revoked-invite-denial';
  const guestRevocation = await worker.fetch(
    new Request(
      new URL(
        `/api/v1/invites/${fixture.guestSecondViewOnly.inviteId}/revoke`,
        origin,
      ),
      {
        method: 'POST',
        headers: ownerHeaders(fixture.ownerCookie, origin, ownerId),
        body: JSON.stringify({ requestId: randomUUID(), confirmRevoke: true }),
      },
    ),
  );
  await json(guestRevocation, 200, 'Owner invite revocation');
  const revokedRead = await guestRead({
    worker,
    base: origin,
    guest: fixture.guestSecondViewOnly,
    albumId: fixture.albumId,
    photoId: fixture.photoId,
    versionId: fixture.versionId,
  });
  assert.equal(
    revokedRead.status,
    401,
    'Revoked invite cannot read Owner feedback',
  );

  stage = 'advance-photo-version';
  const nextBytes = pngFixture();
  const nextHash = sha256(nextBytes);
  const newVersion = await appendAuthorizedVersionFixture({
    db,
    owner: ownerId,
    photoId: fixture.photoId,
    expectedParentVersionId: fixture.versionId,
    expectedVersionNo: 2,
    sha256: nextHash,
    byteSize: nextBytes.byteLength,
    mime: 'image/png',
    width: 1,
    height: 1,
  });
  await storage.put(newVersion.objectKey, new Uint8Array(nextBytes), {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'image/png' },
    sha256: Buffer.from(nextHash, 'hex'),
  });
  const processing = await runImageProcessingJob({
    jobId: newVersion.asset_id,
    jobs: new D1ImageProcessingRepository(db),
    objects: new R2ProcessingObjectStore(storage),
    processor: new LocalSharpImageProcessor(),
  });
  assert.equal(processing.status, 'succeeded');
  const versionsPage = await json(
    await worker.fetch(
      new Request(
        new URL(`/api/v1/photos/${fixture.photoId}/versions`, origin),
        { headers: { Cookie: fixture.ownerCookie } },
      ),
    ),
    200,
    'Owner reads current version before head switch',
  );
  assert.equal(versionsPage.current.versionId, fixture.versionId);
  const setCurrentResponse = await worker.fetch(
    new Request(
      new URL(`/api/v1/photos/${fixture.photoId}/versions/set-current`, origin),
      {
        method: 'POST',
        headers: ownerHeaders(fixture.ownerCookie, origin, ownerId),
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedRevision: versionsPage.current.revision,
          expectedCurrentVersionId: versionsPage.current.versionId,
          versionId: newVersion.version_id,
          confirm: true,
        }),
      },
    ),
  );
  const setCurrentResult = await json(
    setCurrentResponse,
    200,
    'Owner switches current version through canonical CAS API',
  );
  assert.equal(setCurrentResult.current.versionId, newVersion.version_id);
  assert.equal(setCurrentResult.changed, true);

  stage = 'stale-head-create-denial';
  const staleCreate = await ownerCommand({
    worker,
    base: origin,
    fixture,
    command: {
      requestId: randomUUID(),
      operation: 'create_comment',
      photoId: fixture.photoId,
      versionId: fixture.versionId,
      body: 'A stale-head create must fail',
    },
    status: 409,
  });
  assert.equal(staleCreate.error.code, 'CURRENT_VERSION_CHANGED');

  stage = 'owner-historical-version-read';
  const historicalOwnerPage = await ownerRead({
    worker,
    base: origin,
    ownerCookie: fixture.ownerCookie,
    albumId: fixture.albumId,
    photoId: fixture.photoId,
    versionId: fixture.versionId,
  });
  assert.ok(
    historicalOwnerPage.items.some((item) => item.id === created.item.id),
    'Owner can still read notes for an immutable historical version',
  );
  stage = 'owner-historical-version-mutation';
  const historicalUpdate = await ownerCommand({
    worker,
    base: origin,
    fixture,
    command: {
      ...updateCommand,
      requestId: randomUUID(),
      expectedRevision: 2,
      body: 'Historical version remains editable by Owner CAS',
    },
  });
  assert.equal(historicalUpdate.item.revision, 3);
  const historicalDelete = await ownerCommand({
    worker,
    base: origin,
    fixture,
    command: {
      requestId: randomUUID(),
      operation: 'delete_annotation',
      photoId: fixture.photoId,
      versionId: fixture.versionId,
      feedbackId: annotation.item.id,
      expectedRevision: 1,
    },
  });
  assert.equal(historicalDelete.item.state, 'deleted');

  stage = 'guest-current-version-read';
  const newVersionGuestPage = await json(
    await guestRead({
      worker,
      base: origin,
      guest: fixture.guestViewOnly,
      albumId: fixture.albumId,
      photoId: fixture.photoId,
      versionId: newVersion.version_id,
    }),
    200,
    'can_view Guest current-version Owner feedback read',
  );
  assert.equal(newVersionGuestPage.items.length, 0);
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(foreignKeys.results.length, 0);
  return { ...fixture, versionId: newVersion.version_id };
}

async function run() {
  stage = 'migrations';
  const migrations = (await readdir(resolve('apps/worker/migrations')))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  assert.equal(
    migrations.length,
    73,
    'Native test requires the full 001..0073 schema',
  );
  assert.ok(
    migrations.every((name, index) => Number(name.slice(0, 4)) === index + 1),
  );

  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'app',
          modules: true,
          scriptPath: resolve('apps/worker/.build/index.js'),
          compatibilityDate: '2026-10-23',
          compatibilityFlags: ['nodejs_compat'],
          bindings,
          d1Databases: {
            DB: 'test',
            DB_UPGRADE: 'upgrade',
            DB_UPLOAD_SPEC_REPAIR: 'repair',
          },
          r2Buckets: {
            PRIMARY_STORAGE: 'test',
            COMMENT_UPGRADE_STORAGE: 'comment-upgrade',
          },
          assets: {
            directory: resolve('apps/worker/.static'),
            binding: 'ASSETS',
            run_worker_first: true,
            routerConfig: {
              has_user_worker: true,
              invoke_user_worker_ahead_of_assets: true,
            },
          },
        },
      ],
    }),
  );
  try {
    const db = await mf.getD1Database('DB', 'app');
    for (const name of migrations)
      await applyMigration(
        db,
        await readFile(resolve('apps/worker/migrations', name), 'utf8'),
      );
    stage = 'owner-bootstrap';
    const ownerId = randomUUID();
    const ownerSessionId = randomUUID();
    const ownerToken = randomBytes(32).toString('hex');
    const now = Date.now();
    await db
      .prepare(
        'INSERT INTO owner_bootstrap(id,user_id,google_subject) VALUES(1,?,?)',
      )
      .bind(ownerId, 'feedback-native-' + ownerId)
      .run();
    await db
      .prepare(
        'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
      )
      .bind(ownerSessionId, ownerToken, ownerId, now + 3_600_000, now, now)
      .run();
    const ownerCookie =
      'kino-owner.session_token=' +
      encodeURIComponent(
        ownerToken + '.' + (await makeSignature(ownerToken, authSecret)),
      );
    const worker = await mf.getWorker('app');
    stage = 'owner-auth-middleware';
    const me = await worker.fetch(
      new Request(new URL('/api/v1/me', base), {
        headers: { Cookie: ownerCookie },
      }),
    );
    assert.equal(
      me.status,
      200,
      'Test-only Owner session must pass real auth middleware',
    );
    const storage = await mf.getR2Bucket('PRIMARY_STORAGE', 'app');
    stage = 'fixture-real-d1-r2';
    let fixture = await createAlbumOwnerFeedbackFixture({
      db,
      worker,
      base,
      ownerId,
      ownerSessionId,
      ownerCookie,
      storage,
    });
    stage = 'native-api-d1';
    fixture = await runNativeChecks({
      db,
      worker,
      storage,
      base,
      fixture,
      ownerId,
      ownerSessionId,
    });
    console.log('album Owner feedback native D1/R2 checks passed');
    stage = 'chromium-ui';
    const browserPath = resolve(
      'apps/worker/tests/album-owner-feedback-browser.mjs',
    );
    if (existsSync(browserPath)) {
      const { runAlbumOwnerFeedbackBrowserChecks } = await import(
        pathToFileURL(browserPath)
      );
      await runAlbumOwnerFeedbackBrowserChecks({
        db,
        worker,
        base,
        fixture,
        owner: ownerId,
      });
      console.log('album Owner feedback Chromium flow passed');
    } else {
      throw new Error('ALBUM_OWNER_FEEDBACK_BROWSER_HELPER_MISSING');
    }
  } finally {
    await mf.dispose();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run().catch(async (error) => {
    const classification =
      typeof error?.code === 'string' && /^[A-Z0-9_]+$/u.test(error.code)
        ? error.code
        : error instanceof Error && /^[A-Za-z]+Error$/u.test(error.name)
          ? error.name.toUpperCase()
          : 'UNCLASSIFIED_ERROR';
    const details = [];
    let current = error;
    for (let depth = 0; current && depth < 5; depth += 1) {
      details.push(
        current instanceof Error
          ? `${current.name}: ${current.message}\n${current.stack ?? ''}`
          : String(current),
      );
      current = current instanceof Error ? current.cause : undefined;
    }
    try {
      const logPath = resolve('.local/owner-feedback-native-failure.log');
      await mkdir(resolve('.local'), { recursive: true });
      await writeFile(
        logPath,
        `stage=${stage}\nclassification=${classification}\n\n${details.join('\nCaused by:\n')}\n`,
        { mode: 0o600 },
      );
    } catch {
      console.error(
        `album-owner-feedback-native:${stage}:DIAGNOSTIC_WRITE_FAILED`,
      );
      process.exitCode = 1;
      return;
    }
    console.error(`album-owner-feedback-native:${stage}:${classification}`);
    process.exitCode = 1;
  });
}
