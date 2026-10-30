import assert from 'node:assert/strict';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  createIndependentActiveAlbum,
  exchangeFreshGuest,
  issueTwoUseInvite,
} from './selection-limit-guest-browser.mjs';

function ownerHeaders(base, cookies) {
  return {
    Accept: 'application/json',
    Cookie: cookies.headers(),
    Origin: base,
  };
}
function ownerCall(worker, base, cookies, path, method = 'GET', body) {
  return worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers: {
        ...ownerHeaders(base, cookies),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
}
function guestCall(worker, base, guest, path, method = 'GET', body) {
  return worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers: {
        Accept: 'application/json',
        Cookie: guest.cookieName + '=' + guest.cookieValue,
        Origin: new URL(base).origin,
        'CF-Connecting-IP': '198.51.100.227',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
}
async function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal((await response.json()).error.code, code);
}
async function createSharedPhotos({ db, galleryFixture, albumId, count = 31 }) {
  const source = await db
    .prepare(
      `SELECT p.workspace_id,p.project_id,v.created_by_actor,v.source_hash_sha256,
       v.byte_size,v.mime,v.width,v.height,v.status,a.storage_node_id
     FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id AND v.version_no=1
     JOIN photo_assets a ON a.photo_id=p.id AND a.version_id=v.id AND a.workspace_id=p.workspace_id AND a.asset_kind='original'
     WHERE p.album_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 1`,
    )
    .bind(galleryFixture.context.album.id)
    .first();
  assert.ok(source, 'gallery fixture supplies a private eligible source asset');
  const photos = [];
  const statements = [];
  for (let index = 0; index < count; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    const filename =
      index === 0
        ? ' \t=shared-formula-' + photoId.slice(0, 8) + '.jpg'
        : 'shared-photo-' + (index + 1) + '-' + photoId.slice(0, 8) + '.jpg';
    photos.push({ photoId, versionId, filename });
    statements.push(
      db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          photoId,
          source.workspace_id,
          source.project_id,
          albumId,
          filename,
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
          source.workspace_id +
            '/' +
            source.project_id +
            '/' +
            albumId +
            '/' +
            photoId +
            '/original.jpg',
          source.byte_size,
          source.mime,
          source.source_hash_sha256,
        ),
    );
  }
  await db.batch(statements);
  return photos;
}
async function createSubmitOnlyInvite({
  db,
  owner,
  workspaceId,
  projectId,
  albumId,
}) {
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession);
  const inviteId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');
  const expiresAt = Date.now() + 15 * 60 * 1000;
  await db.batch([
    db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',512,?,1,?,?)",
      )
      .bind(
        inviteId,
        workspaceId,
        projectId,
        tokenHash,
        expiresAt,
        owner,
        ownerSession.id,
      ),
    db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, workspaceId, projectId, albumId),
    db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId),
  ]);
  return { inviteId, token };
}
async function exchangeGuestWithoutPermissionAssumptions({
  db,
  worker,
  base,
  invite,
  label,
}) {
  const response = await worker.fetch(
    new Request(new URL('/api/guest/exchange', base), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: new URL(base).origin,
        'CF-Connecting-IP': '198.51.100.228',
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        token: invite.token,
        displayName: 'Shared test ' + label + ' ' + randomUUID(),
      }),
      redirect: 'manual',
    }),
  );
  assert.equal(response.status, 200, 'link-only Guest exchange succeeds');
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  const setCookie = cookies.find((value) =>
    /(?:^|;\s*)(?:__Host-)?kino_guest=/.test(value),
  );
  assert.ok(setCookie);
  assert.match(setCookie, /HttpOnly/i);
  const match = /(?:^|;\s*)((?:__Host-)?kino_guest)=([^;]+)/.exec(setCookie);
  assert.ok(match);
  const cookieValue = decodeURIComponent(match[2]);
  const session = await db
    .prepare('SELECT guest_id FROM guest_sessions WHERE secret_hash=?')
    .bind(
      createHash('sha256')
        .update('kino-pic:guest-session:v1:' + cookieValue)
        .digest('hex'),
    )
    .first();
  assert.ok(
    session,
    'synthetic cookie resolves to its own committed Guest session',
  );
  return { cookieName: match[1], cookieValue, guestId: session.guest_id };
}

export async function sharedReviewChecks({
  ownerSigningSecret,
  mf,
  db,
  check,
  owner,
  cookies,
  base,
  galleryFixture,
  request,
}) {
  const enabled = await mf.getWorker('guest-shared-test');
  const capabilitiesPath = '/api/guest/shared-reviews/capabilities';

  await check(
    'Shared review routes report default-off and explicit local enablement',
    async () => {
      const disabled = await request(capabilitiesPath);
      assert.equal(disabled.status, 200);
      assert.deepEqual(await disabled.json(), { enabled: false });
      const active = await enabled.fetch(
        new Request(new URL(capabilitiesPath, base), {
          headers: { Accept: 'application/json' },
        }),
      );
      assert.equal(active.status, 200);
      assert.deepEqual(await active.json(), { enabled: true });
    },
  );

  await check(
    'Explicit shared review backend seals membership, serializes two distinct Guests at the cap, preserves history, and denies cookie-switched intent',
    async () => {
      const album = await createIndependentActiveAlbum({
        worker: enabled,
        base,
        ownerCookie: cookies.headers(),
        db,
        galleryFixture,
      });
      const photos = await createSharedPhotos({
        db,
        galleryFixture,
        albumId: album.albumId,
        count: 31,
      });
      const invite = await issueTwoUseInvite({
        worker: enabled,
        base,
        ownerCookie: cookies.headers(),
        projectId: album.projectId,
        albumId: album.albumId,
      });
      const guestA = await exchangeFreshGuest({
        worker: enabled,
        base,
        invite,
        albumId: album.albumId,
        address: '198.51.100.231',
        label: 'shared-A',
      });
      const guestB = await exchangeFreshGuest({
        worker: enabled,
        base,
        invite,
        albumId: album.albumId,
        address: '198.51.100.232',
        label: 'shared-B',
      });
      assert.notEqual(
        guestA.guestId,
        guestB.guestId,
        'one shared invitation produces two distinct Guest identities',
      );
      const submitOnlyInvite = await createSubmitOnlyInvite({
        db,
        owner,
        workspaceId: album.workspaceId,
        projectId: album.projectId,
        albumId: album.albumId,
      });
      const submitOnly = await exchangeGuestWithoutPermissionAssumptions({
        db,
        worker: enabled,
        base,
        invite: submitOnlyInvite,
        label: 'submit-only',
      });
      const ownerPath = '/api/v1/albums/' + album.albumId + '/shared-reviews';
      const reviewIdFor = (response) => response.review.id;
      const ownerRequest = (path, method = 'GET', body) =>
        ownerCall(enabled, base, cookies, path, method, body);
      const guestPath = (guest, suffix) =>
        '/api/guest/albums/' + album.albumId + '/shared-reviews' + suffix;
      const readMeta = async (guest, id) => {
        const response = await guestCall(
          enabled,
          base,
          guest,
          guestPath(guest, '/' + id),
        );
        assert.equal(response.status, 200);
        return response.json();
      };
      const readSelection = async (guest, id, cursor) => {
        const target =
          guestPath(guest, '/' + id + '/selection') +
          (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
        return guestCall(enabled, base, guest, target);
      };
      const setShared = (
        guest,
        id,
        photo,
        requestId,
        roundNo,
        selected = true,
      ) =>
        guestCall(
          enabled,
          base,
          guest,
          guestPath(
            guest,
            '/' + id + '/photos/' + photo.photoId + '/selection',
          ),
          'PUT',
          {
            requestId,
            expectedGuestId: guest.guestId,
            roundNo,
            versionId: photo.versionId,
            selected,
          },
        );
      const submitShared = (guest, id, requestId, roundNo, expectedRevision) =>
        guestCall(
          enabled,
          base,
          guest,
          guestPath(guest, '/' + id + '/submit'),
          'POST',
          {
            requestId,
            expectedGuestId: guest.guestId,
            roundNo,
            expectedRevision,
          },
        );
      const privateRequestId = randomUUID();
      const privatePick = await guestCall(
        enabled,
        base,
        guestA,
        '/api/guest/albums/' +
          album.albumId +
          '/photos/' +
          photos[0].photoId +
          '/selection',
        'PUT',
        {
          requestId: privateRequestId,
          versionId: photos[0].versionId,
          selected: true,
        },
      );
      assert.equal(
        privatePick.status,
        200,
        'private pick is written before shared review creation',
      );

      // Exercise rollback after review and both membership rows have begun to insert.
      const createBody = {
        requestId: randomUUID(),
        title: 'Shared family picks ' + randomUUID(),
        inviteIds: [invite.inviteId, submitOnlyInvite.inviteId],
        minimum: 1,
        maximum: 30,
        confirmShared: true,
      };
      await db.exec(
        "CREATE TRIGGER fail_shared_review_seal BEFORE INSERT ON shared_review_seals WHEN NEW.member_count=2 BEGIN SELECT RAISE(ABORT,'TEST_SHARED_SEAL_FAILURE'); END",
      );
      try {
        const failed = await ownerRequest(ownerPath, 'POST', createBody);
        assert.equal(failed.status, 503);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM shared_reviews WHERE album_id=?',
              )
              .bind(album.albumId)
              .first()
          ).n,
          0,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM shared_review_owner_commands WHERE request_id=?',
              )
              .bind(createBody.requestId)
              .first()
          ).n,
          0,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM shared_review_invites WHERE album_id=?',
              )
              .bind(album.albumId)
              .first()
          ).n,
          0,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_shared_review_seal');
      }
      const createdResponse = await ownerRequest(ownerPath, 'POST', createBody);
      assert.ok([200, 201].includes(createdResponse.status));
      const created = await createdResponse.json();
      const reviewId = reviewIdFor(created);
      assert.equal(created.review.revision, 0);
      assert.equal(created.review.status, 'open');
      assert.equal(
        created.review.selectedCount,
        0,
        'private picks are never imported into a shared subject',
      );
      assert.deepEqual(
        created.review.inviteIds,
        [invite.inviteId, submitOnlyInvite.inviteId].sort(),
      );
      const createReplay = await ownerRequest(ownerPath, 'POST', createBody);
      assert.equal(createReplay.status, createdResponse.status);
      assert.deepEqual(
        await createReplay.json(),
        created,
        'exact create replay returns its original immutable result',
      );
      const ownerAudit = await db
        .prepare(
          "SELECT actor_id,action,after_json FROM audit_events WHERE request_id=? AND action='shared_review.created'",
        )
        .bind(createBody.requestId)
        .first();
      assert.ok(ownerAudit);
      assert.equal(ownerAudit.actor_id, owner);
      assert.deepEqual(
        Object.keys(JSON.parse(ownerAudit.after_json)).sort(),
        [
          'memberCount',
          'reviewId',
          'revision',
          'status',
          'title',
          'roundNo',
        ].sort(),
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_state WHERE review_id=?',
            )
            .bind(reviewId)
            .first()
        ).n,
        0,
      );

      // The database rejects an Owner command whose otherwise valid JSON omits a required key.
      const ownerSession = await db
        .prepare(
          'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
        )
        .bind(owner, Date.now())
        .first();
      assert.ok(
        ownerSession,
        'the Owner fixture has a current database session',
      );
      const malformedOwnerRequestId = randomUUID();
      const malformedOwnerReviewId = randomUUID();
      const malformedOwnerCommandId = randomUUID();
      const malformedOwnerTitle = 'Malformed shared review ' + randomUUID();
      const malformedOwnerInvites = JSON.stringify([invite.inviteId]);
      const malformedOwnerPayload = JSON.stringify({
        albumId: album.albumId,
        title: malformedOwnerTitle,
        inviteIds: [invite.inviteId],
        minimum: 1,
        maximum: 30,
        confirmShared: true,
      });
      await assert.rejects(
        db
          .prepare(
            `INSERT INTO shared_review_owner_commands(
      id,actor_id,session_id,request_id,workspace_id,project_id,album_id,action,review_id,title,
      invite_ids_json,expected_round_no,minimum,maximum,payload_json,created_at_ms
    ) VALUES(?,?,?,?,?,?,?,'create',?,?,?,NULL,?,?,?,?)`,
          )
          .bind(
            malformedOwnerCommandId,
            owner,
            ownerSession.id,
            malformedOwnerRequestId,
            album.workspaceId,
            album.projectId,
            album.albumId,
            malformedOwnerReviewId,
            malformedOwnerTitle,
            malformedOwnerInvites,
            1,
            30,
            malformedOwnerPayload,
            Date.now(),
          )
          .run(),
        /CHECK constraint failed/,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_owner_commands WHERE request_id=?',
            )
            .bind(malformedOwnerRequestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM shared_reviews WHERE id=?')
            .bind(malformedOwnerReviewId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_state WHERE review_id=?',
            )
            .bind(malformedOwnerReviewId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(malformedOwnerRequestId)
            .first()
        ).n,
        0,
      );

      const initialA = await readMeta(guestA, reviewId);
      assert.equal(initialA.guestId, guestA.guestId);
      assert.equal(initialA.selectedCount, 0);
      assert.deepEqual(
        Object.keys(initialA).sort(),
        [
          'albumId',
          'canSelect',
          'canSubmit',
          'canSubmitNow',
          'canView',
          'guestId',
          'id',
          'maximum',
          'minimum',
          'revision',
          'roundNo',
          'selectedCount',
          'status',
          'submittedAt',
          'title',
        ].sort(),
      );
      const initialSelection = await readSelection(guestA, reviewId);
      assert.equal(initialSelection.status, 200);
      assert.deepEqual((await initialSelection.json()).items, []);
      const initiallySubmitOnly = await readMeta(submitOnly, reviewId);
      assert.equal(initiallySubmitOnly.selectedCount, null);
      assert.equal(initiallySubmitOnly.canSubmit, true);
      assert.equal(initiallySubmitOnly.canSubmitNow, false);

      // A Guest command missing requestId inside payload_json is rejected before state or audit writes.
      const guestSessionHash = createHash('sha256')
        .update('kino-pic:guest-session:v1:' + guestA.cookieValue)
        .digest('hex');
      const initialGuestSession = await db
        .prepare('SELECT id FROM guest_sessions WHERE secret_hash=?')
        .bind(guestSessionHash)
        .first();
      assert.ok(initialGuestSession);
      const malformedGuestRequestId = randomUUID();
      const malformedGuestCommandId = randomUUID();
      const malformedGuestPayload = JSON.stringify({
        albumId: album.albumId,
        reviewId,
        expectedGuestId: guestA.guestId,
        roundNo: 1,
        photoId: photos[30].photoId,
        versionId: photos[30].versionId,
        selected: true,
      });
      await assert.rejects(
        db
          .prepare(
            `INSERT INTO shared_review_guest_commands(
      id,action,guest_id,expected_guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,
      review_id,round_no,photo_id,version_id,selected,expected_revision,payload_json,created_at_ms
    ) VALUES(?,'set',?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`,
          )
          .bind(
            malformedGuestCommandId,
            guestA.guestId,
            guestA.guestId,
            invite.inviteId,
            initialGuestSession.id,
            guestSessionHash,
            malformedGuestRequestId,
            album.workspaceId,
            album.projectId,
            album.albumId,
            reviewId,
            1,
            photos[30].photoId,
            photos[30].versionId,
            1,
            malformedGuestPayload,
            Date.now(),
          )
          .run(),
        /CHECK constraint failed/,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_guest_commands WHERE request_id=?',
            )
            .bind(malformedGuestRequestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_guest_results WHERE command_id=?',
            )
            .bind(malformedGuestCommandId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_state WHERE review_id=? AND photo_id=?',
            )
            .bind(reviewId, photos[30].photoId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(malformedGuestRequestId)
            .first()
        ).n,
        0,
      );

      // A request ID already used by the private selection ledger cannot enter the shared ledger.
      await expectError(
        await setShared(guestA, reviewId, photos[1], privateRequestId, 1),
        409,
        'REQUEST_ID_CONFLICT',
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_guest_commands WHERE request_id=?',
            )
            .bind(privateRequestId)
            .first()
        ).n,
        0,
      );

      // A failing audit after state/result/revision writes rolls the entire Guest command back.
      const sharedToPrivateRequestId = randomUUID();
      await db.exec(
        `CREATE TRIGGER fail_shared_set_audit BEFORE INSERT ON audit_events WHEN NEW.action='shared_selection.added' AND NEW.request_id='${sharedToPrivateRequestId}' BEGIN SELECT RAISE(ABORT,'TEST_SHARED_SET_AUDIT_FAILURE'); END`,
      );
      try {
        await expectError(
          await setShared(
            guestA,
            reviewId,
            photos[0],
            sharedToPrivateRequestId,
            1,
          ),
          503,
          'SHARED_SELECTION_UNAVAILABLE',
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM shared_review_guest_commands WHERE request_id=?',
              )
              .bind(sharedToPrivateRequestId)
              .first()
          ).n,
          0,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM shared_review_state WHERE review_id=? AND photo_id=?',
              )
              .bind(reviewId, photos[0].photoId)
              .first()
          ).n,
          0,
        );
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
              )
              .bind(sharedToPrivateRequestId)
              .first()
          ).n,
          0,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_shared_set_audit');
      }
      const firstSet = await setShared(
        guestA,
        reviewId,
        photos[0],
        sharedToPrivateRequestId,
        1,
      );
      assert.equal(firstSet.status, 200);
      const firstSetResult = await firstSet.json();
      assert.equal(firstSetResult.revision, 1);
      assert.equal(firstSetResult.selectedCount, 1);
      assert.ok(firstSetResult.eventId);

      // The reverse namespace direction also aborts old private writes atomically.
      await expectError(
        await guestCall(
          enabled,
          base,
          guestA,
          '/api/guest/albums/' +
            album.albumId +
            '/photos/' +
            photos[1].photoId +
            '/selection',
          'PUT',
          {
            requestId: sharedToPrivateRequestId,
            versionId: photos[1].versionId,
            selected: true,
          },
        ),
        409,
        'REQUEST_ID_CONFLICT',
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_state WHERE invite_id=? AND guest_id=? AND photo_id=?',
            )
            .bind(invite.inviteId, guestA.guestId, photos[1].photoId)
            .first()
        ).n,
        0,
      );

      // The Owner's new request namespace conflicts in both directions with old ledgers.
      const oldOwnerRequestId = randomUUID();
      const oldAlbum = await ownerCall(
        enabled,
        base,
        cookies,
        '/api/v1/projects/' + album.projectId + '/albums',
        'POST',
        {
          requestId: oldOwnerRequestId,
          name: 'Shared namespace old request ' + randomUUID(),
        },
      );
      assert.equal(oldAlbum.status, 201);
      await expectError(
        await ownerRequest(ownerPath, 'POST', {
          ...createBody,
          requestId: oldOwnerRequestId,
        }),
        409,
        'REQUEST_ID_CONFLICT',
      );
      const sharedOwnerRequestId = createBody.requestId;
      const sharedOwnerAlbum = await ownerCall(
        enabled,
        base,
        cookies,
        '/api/v1/projects/' + album.projectId + '/albums',
        'POST',
        {
          requestId: sharedOwnerRequestId,
          name: 'Shared namespace new request ' + randomUUID(),
        },
      );
      assert.equal(sharedOwnerAlbum.status, 409);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_owner_commands WHERE request_id=?',
            )
            .bind(sharedOwnerRequestId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM request_commands WHERE request_id=?',
            )
            .bind(sharedOwnerRequestId)
            .first()
        ).n,
        0,
      );

      // One Guest adds 28 more picks. The stale cursor must become unusable after the next revision.
      for (const photo of photos.slice(1, 29)) {
        const response = await setShared(
          guestA,
          reviewId,
          photo,
          randomUUID(),
          1,
        );
        assert.equal(response.status, 200);
      }
      const at29 = await readMeta(guestA, reviewId);
      assert.equal(at29.selectedCount, 29);
      assert.equal(at29.revision, 29);
      const pageAt29 = await readSelection(guestA, reviewId);
      assert.equal(pageAt29.status, 200);
      const cursorAt29 = (await pageAt29.json()).nextCursor;
      assert.ok(cursorAt29, 'selected state uses 24-item pages');

      // Two different Guest identities sharing one invitation concurrently contend for slot 30.
      const raceBodies = [
        setShared(guestA, reviewId, photos[29], randomUUID(), 1),
        setShared(guestB, reviewId, photos[30], randomUUID(), 1),
      ];
      const race = await Promise.all(raceBodies);
      assert.deepEqual(
        race.map((response) => response.status).sort(),
        [200, 409],
      );
      const capacityWinnerPhoto =
        photos[29 + race.findIndex((response) => response.status === 200)];
      assert.ok(capacityWinnerPhoto);
      const deniedRace = race.find((response) => response.status === 409);
      assert.ok(deniedRace);
      assert.equal(
        (await deniedRace.json()).error.code,
        'SELECTION_LIMIT_REACHED',
      );
      assert.notEqual(guestA.guestId, guestB.guestId);
      const afterRace = await readMeta(guestA, reviewId);
      assert.equal(afterRace.selectedCount, 30);
      assert.equal(afterRace.revision, 30);
      await expectError(
        await readSelection(guestA, reviewId, cursorAt29),
        409,
        'SELECTION_CHANGED',
      );
      const finalPage = await readSelection(guestA, reviewId);
      assert.equal(finalPage.status, 200);
      const firstPageValue = await finalPage.json();
      assert.equal(firstPageValue.items.length, 24);
      assert.ok(firstPageValue.nextCursor);
      const secondPage = await readSelection(
        guestA,
        reviewId,
        firstPageValue.nextCursor,
      );
      assert.equal(secondPage.status, 200);
      assert.equal((await secondPage.json()).items.length, 6);

      // Same logical/version set is an immutable no-op with no state-change event.
      const noOpBody = {
        requestId: randomUUID(),
        expectedGuestId: guestA.guestId,
        roundNo: 1,
        versionId: photos[0].versionId,
        selected: true,
      };
      const noOpResponse = await guestCall(
        enabled,
        base,
        guestA,
        guestPath(
          guestA,
          '/' + reviewId + '/photos/' + photos[0].photoId + '/selection',
        ),
        'PUT',
        noOpBody,
      );
      assert.equal(noOpResponse.status, 200);
      const noOp = await noOpResponse.json();
      assert.equal(noOp.revision, 30);
      assert.equal(noOp.selectedCount, 30);
      assert.equal(noOp.eventId, null);
      assert.deepEqual(
        await (
          await guestCall(
            enabled,
            base,
            guestA,
            guestPath(
              guestA,
              '/' + reviewId + '/photos/' + photos[0].photoId + '/selection',
            ),
            'PUT',
            noOpBody,
          )
        ).json(),
        noOp,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(noOpBody.requestId)
            .first()
        ).n,
        0,
      );

      const deselect = await setShared(
        guestB,
        reviewId,
        photos[0],
        randomUUID(),
        1,
        false,
      );
      assert.equal(deselect.status, 200);
      assert.equal((await deselect.json()).selectedCount, 29);
      const tombstone = await db
        .prepare(
          'SELECT selected,last_command_id,version_id FROM shared_review_state WHERE review_id=? AND photo_id=?',
        )
        .bind(reviewId, photos[0].photoId)
        .first();
      assert.equal(tombstone.selected, 0);
      const reselect = await setShared(
        guestA,
        reviewId,
        photos[0],
        randomUUID(),
        1,
        true,
      );
      assert.equal(reselect.status, 200);
      assert.equal((await reselect.json()).selectedCount, 30);
      const restored = await db
        .prepare(
          'SELECT selected,last_command_id FROM shared_review_state WHERE review_id=? AND photo_id=?',
        )
        .bind(reviewId, photos[0].photoId)
        .first();
      assert.equal(restored.selected, 1);
      assert.notEqual(
        restored.last_command_id,
        tombstone.last_command_id,
        'state chain advances through a tombstone instead of restoring an old witness',
      );

      // The self Guest ID is an intent witness only; switching cookies cannot claim another Guest.
      const switchedRequestId = randomUUID();
      await expectError(
        await guestCall(
          enabled,
          base,
          guestB,
          guestPath(
            guestB,
            '/' + reviewId + '/photos/' + photos[2].photoId + '/selection',
          ),
          'PUT',
          {
            requestId: switchedRequestId,
            expectedGuestId: guestA.guestId,
            roundNo: 1,
            versionId: photos[2].versionId,
            selected: true,
          },
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_guest_commands WHERE request_id=?',
            )
            .bind(switchedRequestId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM audit_events WHERE request_id=?',
            )
            .bind(switchedRequestId)
            .first()
        ).n,
        0,
      );
      const switchedPhotoCountBefore = (
        await db
          .prepare(
            'SELECT count(*) AS n FROM shared_review_state WHERE review_id=? AND photo_id=?',
          )
          .bind(reviewId, photos[2].photoId)
          .first()
      ).n;
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_state WHERE review_id=? AND photo_id=?',
            )
            .bind(reviewId, photos[2].photoId)
            .first()
        ).n,
        switchedPhotoCountBefore,
      );

      // Submit-only members can learn eligibility without seeing the shared selection or Guest identities.
      const submitOnlyMeta = await readMeta(submitOnly, reviewId);
      assert.equal(submitOnlyMeta.guestId, submitOnly.guestId);
      assert.equal(submitOnlyMeta.canSelect, false);
      assert.equal(submitOnlyMeta.canSubmit, true);
      assert.equal(submitOnlyMeta.canView, false);
      assert.equal(submitOnlyMeta.selectedCount, null);
      assert.equal(submitOnlyMeta.canSubmitNow, true);
      const auditBeforeDiscover = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action LIKE 'shared_%'",
          )
          .bind(album.albumId)
          .first()
      ).n;
      const discover = await guestCall(
        enabled,
        base,
        submitOnly,
        '/api/guest/albums/' + album.albumId + '/shared-reviews',
      );
      assert.equal(discover.status, 200);
      const discoverValue = await discover.json();
      assert.equal(discoverValue.reviews.length, 1);
      assert.equal(discoverValue.reviews[0].id, reviewId);
      assert.equal(discoverValue.reviews[0].selectedCount, null);
      const discoverJson = JSON.stringify(discoverValue);
      assert.ok(discoverJson.includes(submitOnly.guestId));
      assert.ok(!discoverJson.includes(guestA.guestId));
      assert.ok(!discoverJson.includes(guestB.guestId));
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action LIKE 'shared_%'",
            )
            .bind(album.albumId)
            .first()
        ).n,
        auditBeforeDiscover,
      );
      await expectError(
        await readSelection(submitOnly, reviewId),
        401,
        'GUEST_ACCESS_REQUIRED',
      );

      // A valid but unsealed invitation in the same album is not a review member.
      const nonmemberInvite = await issueTwoUseInvite({
        worker: enabled,
        base,
        ownerCookie: cookies.headers(),
        projectId: album.projectId,
        albumId: album.albumId,
      });
      const nonmember = await exchangeFreshGuest({
        worker: enabled,
        base,
        invite: nonmemberInvite,
        albumId: album.albumId,
        address: '198.51.100.233',
        label: 'shared-nonmember',
      });
      await expectError(
        await guestCall(
          enabled,
          base,
          nonmember,
          guestPath(nonmember, '/' + reviewId),
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
      );

      // The first of two concurrent submitters creates the sole immutable snapshot.
      const submitRequests = [
        { guest: guestA, requestId: randomUUID() },
        { guest: guestB, requestId: randomUUID() },
      ];
      const simultaneousSubmits = await Promise.all(
        submitRequests.map(({ guest, requestId }) =>
          submitShared(guest, reviewId, requestId, 1, 32),
        ),
      );
      assert.deepEqual(
        simultaneousSubmits.map((response) => response.status).sort(),
        [200, 409],
      );
      const winningIndex = simultaneousSubmits.findIndex(
        (response) => response.status === 200,
      );
      assert.ok(winningIndex >= 0);
      const winningRequest = submitRequests[winningIndex];
      const firstSubmitValue = await simultaneousSubmits[winningIndex].json();
      const firstSubmission = firstSubmitValue.submission;
      assert.equal(firstSubmission.roundNo, 1);
      assert.equal(firstSubmission.revision, 32);
      assert.equal(firstSubmission.selectedCount, 30);
      assert.ok(firstSubmitValue.eventId);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_submissions WHERE review_id=?',
            )
            .bind(reviewId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_submission_seals WHERE submission_id=?',
            )
            .bind(firstSubmission.id)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_submission_items WHERE submission_id=?',
            )
            .bind(firstSubmission.id)
            .first()
        ).n,
        30,
      );
      const submitReplay = await submitShared(
        winningRequest.guest,
        reviewId,
        winningRequest.requestId,
        1,
        32,
      );
      assert.equal(submitReplay.status, 200);
      assert.deepEqual(await submitReplay.json(), firstSubmitValue);
      await expectError(
        await submitShared(winningRequest.guest, reviewId, randomUUID(), 1, 30),
        409,
        'ROUND_CONFLICT',
      );
      const submittedMeta = await readMeta(guestA, reviewId);
      assert.equal(submittedMeta.status, 'submitted');
      assert.equal(submittedMeta.canSubmitNow, false);
      const otherSubmittedMeta = await readMeta(submitOnly, reviewId);
      assert.equal(otherSubmittedMeta.selectedCount, null);
      assert.equal(otherSubmittedMeta.canSubmitNow, false);

      const firstHistory = await ownerRequest(
        ownerPath + '/' + reviewId + '/submissions',
      );
      assert.equal(firstHistory.status, 200);
      const firstHistoryValue = await firstHistory.json();
      assert.equal(firstHistoryValue.submissions.length, 1);
      assert.equal(firstHistoryValue.submissions[0].id, firstSubmission.id);
      assert.equal(firstHistoryValue.nextBeforeRoundNo, null);
      const detailResponse = await ownerRequest(
        ownerPath + '/' + reviewId + '/submissions/' + firstSubmission.id,
      );
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.items.length, 24);
      assert.ok(detail.nextCursor);
      const detailSecondResponse = await ownerRequest(
        ownerPath +
          '/' +
          reviewId +
          '/submissions/' +
          firstSubmission.id +
          '?cursor=' +
          encodeURIComponent(detail.nextCursor),
      );
      assert.equal(detailSecondResponse.status, 200);
      const detailSecond = await detailSecondResponse.json();
      assert.equal(detailSecond.items.length, 6);
      assert.equal(detailSecond.nextCursor, null);
      assert.ok(
        [...detail.items, ...detailSecond.items].some((item) =>
          item.filename.startsWith(' \t=shared-formula-'),
        ),
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_submission_items WHERE submission_id=?',
            )
            .bind(firstSubmission.id)
            .first()
        ).n,
        30,
      );

      // Requested evidence commits before streaming; a failed completion audit errors the body.
      const requestedBefore = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action='download.requested'",
          )
          .bind(album.albumId)
          .first()
      ).n;
      const generatedBefore = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action='download.generated'",
          )
          .bind(album.albumId)
          .first()
      ).n;
      await db.exec(
        "CREATE TRIGGER fail_shared_download_generated BEFORE INSERT ON audit_events WHEN NEW.action='download.generated' AND NEW.album_id='" +
          album.albumId +
          "' BEGIN SELECT RAISE(ABORT,'TEST_SHARED_DOWNLOAD_AUDIT_FAILURE'); END",
      );
      try {
        const failedDownload = await ownerRequest(
          ownerPath +
            '/' +
            reviewId +
            '/submissions/' +
            firstSubmission.id +
            '/download?format=csv',
        );
        assert.equal(failedDownload.status, 200);
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action='download.requested'",
              )
              .bind(album.albumId)
              .first()
          ).n,
          requestedBefore + 1,
        );
        await assert.rejects(failedDownload.text());
        assert.equal(
          (
            await db
              .prepare(
                "SELECT count(*) AS n FROM audit_events WHERE album_id=? AND action='download.generated'",
              )
              .bind(album.albumId)
              .first()
          ).n,
          generatedBefore,
        );
      } finally {
        await db.exec('DROP TRIGGER fail_shared_download_generated');
      }
      const csvResponse = await ownerRequest(
        ownerPath +
          '/' +
          reviewId +
          '/submissions/' +
          firstSubmission.id +
          '/download?format=csv',
      );
      assert.equal(csvResponse.status, 200);
      assert.match(
        csvResponse.headers.get('Content-Disposition') ?? '',
        /attachment; filename="shared-selection-/,
      );
      const csv = await csvResponse.text();
      assert.match(
        csv,
        /"' \t=shared-formula-/,
        'CSV prefixes formula-like filenames after leading whitespace',
      );
      assert.equal(csv.trim().split(/\r?\n/).length, 31);
      const txtResponse = await ownerRequest(
        ownerPath +
          '/' +
          reviewId +
          '/submissions/' +
          firstSubmission.id +
          '/download?format=txt',
      );
      assert.equal(txtResponse.status, 200);
      const txt = await txtResponse.text();
      assert.equal(txt.trim().split(/\r?\n/).length, 30);
      const jsonResponse = await ownerRequest(
        ownerPath +
          '/' +
          reviewId +
          '/submissions/' +
          firstSubmission.id +
          '/download?format=json',
      );
      assert.equal(jsonResponse.status, 200);
      const jsonDownload = await jsonResponse.json();
      assert.equal(jsonDownload.items.length, 30);
      assert.equal(jsonDownload.submission.id, firstSubmission.id);
      const downloadAudits = await db
        .prepare(
          "SELECT request_id,action,after_json FROM audit_events WHERE actor_type='user' AND actor_id=? AND album_id=? AND action IN('download.requested','download.generated') ORDER BY occurred_at_utc,event_id",
        )
        .bind(owner, album.albumId)
        .all();
      assert.equal(
        downloadAudits.results.filter(
          (row) => row.action === 'download.requested',
        ).length,
        4,
      );
      assert.equal(
        downloadAudits.results.filter(
          (row) => row.action === 'download.generated',
        ).length,
        3,
      );
      const downloadAuditGroups = new Map();
      for (const row of downloadAudits.results) {
        const group = downloadAuditGroups.get(row.request_id) ?? [];
        group.push(row.action);
        downloadAuditGroups.set(row.request_id, group);
      }
      const completedDownloadGroups = [...downloadAuditGroups.values()].filter(
        (actions) => actions.length === 2,
      );
      const failedDownloadGroups = [...downloadAuditGroups.values()].filter(
        (actions) => actions.length === 1,
      );
      assert.equal(
        completedDownloadGroups.length,
        3,
        'each successful stream has one correlated request/generated audit pair',
      );
      assert.equal(
        failedDownloadGroups.length,
        1,
        'a completion-audit failure leaves only requested evidence',
      );
      for (const actions of completedDownloadGroups)
        assert.deepEqual(actions.sort(), [
          'download.generated',
          'download.requested',
        ]);
      assert.deepEqual(failedDownloadGroups[0], ['download.requested']);
      for (const row of downloadAudits.results) {
        const after = JSON.parse(row.after_json);
        assert.deepEqual(
          Object.keys(after).sort(),
          ['format', 'reviewId', 'selectedCount', 'submissionId'].sort(),
        );
        assert.ok(!row.after_json.includes('shared-formula-'));
        assert.ok(!row.after_json.includes('original.jpg'));
      }

      // Reopen retains selected state, starts at revision 1, and the old submission stays immutable.
      const reopenBody = {
        requestId: randomUUID(),
        expectedRoundNo: 1,
        minimum: 30,
        maximum: 30,
        confirmShared: true,
      };
      const reopenPath = ownerPath + '/' + reviewId + '/reopen';
      const reopenedResponse = await ownerRequest(
        reopenPath,
        'POST',
        reopenBody,
      );
      assert.ok([200, 201].includes(reopenedResponse.status));
      const reopened = await reopenedResponse.json();
      assert.equal(reopened.review.roundNo, 2);
      assert.equal(reopened.review.revision, 1);
      assert.equal(reopened.review.status, 'open');
      assert.equal(reopened.review.selectedCount, 30);
      assert.equal((await readMeta(submitOnly, reviewId)).canSubmitNow, true);
      await expectError(
        await setShared(guestA, reviewId, photos[2], randomUUID(), 1),
        409,
        'ROUND_CONFLICT',
      );
      await expectError(
        await submitShared(submitOnly, reviewId, randomUUID(), 2, 0),
        409,
        'SELECTION_REVISION_CONFLICT',
      );

      const sourceVersion = await db
        .prepare(
          'SELECT id,workspace_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status FROM photo_versions WHERE id=? AND photo_id=?',
        )
        .bind(photos[0].versionId, photos[0].photoId)
        .first();
      assert.ok(sourceVersion);
      const version2Id = randomUUID();
      await appendAuthorizedVersionFixture({
        db,
        owner,
        photoId: photos[0].photoId,
        versionId: version2Id,
        parentVersionId: sourceVersion.id,
        versionNo: 2,
        sha256: sourceVersion.source_hash_sha256,
        byteSize: sourceVersion.byte_size,
        mime: sourceVersion.mime,
        width: sourceVersion.width,
        height: sourceVersion.height,
      });
      const version2RequestId = randomUUID();
      const version2Set = await setShared(
        guestA,
        reviewId,
        { ...photos[0], versionId: version2Id },
        version2RequestId,
        2,
        true,
      );
      assert.equal(version2Set.status, 200);
      const version2Result = await version2Set.json();
      assert.equal(version2Result.revision, 2);
      assert.equal(version2Result.selectedCount, 30);
      assert.equal(version2Result.selectedVersionId, version2Id);
      const versionAudit = await db
        .prepare(
          "SELECT action FROM audit_events WHERE action='shared_selection.version_changed' AND request_id=?",
        )
        .bind(version2RequestId)
        .first();
      assert.equal(versionAudit?.action, 'shared_selection.version_changed');
      await expectError(
        await submitShared(guestA, reviewId, randomUUID(), 2, 1),
        409,
        'SELECTION_REVISION_CONFLICT',
      );
      const removeForMinimum = await setShared(
        guestB,
        reviewId,
        capacityWinnerPhoto,
        randomUUID(),
        2,
        false,
      );
      assert.equal(removeForMinimum.status, 200);
      assert.equal((await removeForMinimum.json()).selectedCount, 29);
      await expectError(
        await submitShared(submitOnly, reviewId, randomUUID(), 2, 3),
        409,
        'SELECTION_MINIMUM_NOT_MET',
      );
      const restoreForMinimum = await setShared(
        guestA,
        reviewId,
        capacityWinnerPhoto,
        randomUUID(),
        2,
        true,
      );
      assert.equal(restoreForMinimum.status, 200);
      assert.equal((await restoreForMinimum.json()).revision, 4);
      const readySubmitOnly = await readMeta(submitOnly, reviewId);
      assert.equal(readySubmitOnly.canSelect, false);
      assert.equal(readySubmitOnly.selectedCount, null);
      assert.equal(readySubmitOnly.canSubmitNow, true);
      const secondSubmit = await submitShared(
        submitOnly,
        reviewId,
        randomUUID(),
        2,
        4,
      );
      assert.equal(secondSubmit.status, 200);
      const secondSubmission = (await secondSubmit.json()).submission;
      assert.equal(secondSubmission.roundNo, 2);
      assert.equal(secondSubmission.revision, 4);
      assert.equal(secondSubmission.selectedCount, 30);

      const history = await ownerRequest(
        ownerPath + '/' + reviewId + '/submissions',
      );
      assert.equal(history.status, 200);
      const historyValue = await history.json();
      assert.deepEqual(
        historyValue.submissions.map((item) => item.roundNo),
        [2, 1],
      );
      assert.equal(historyValue.nextBeforeRoundNo, null);
      const oldRoundOnly = await ownerRequest(
        ownerPath + '/' + reviewId + '/submissions?beforeRoundNo=2',
      );
      assert.deepEqual(
        (await oldRoundOnly.json()).submissions.map((item) => item.roundNo),
        [1],
      );
      const completeSnapshotItems = async (firstPage, submissionId) => {
        assert.ok(firstPage.nextCursor);
        const response = await ownerRequest(
          ownerPath +
            '/' +
            reviewId +
            '/submissions/' +
            submissionId +
            '?cursor=' +
            encodeURIComponent(firstPage.nextCursor),
        );
        assert.equal(response.status, 200);
        const page = await response.json();
        assert.equal(page.nextCursor, null);
        const items = [...firstPage.items, ...page.items];
        assert.equal(items.length, 30);
        assert.equal(new Set(items.map((item) => item.photoId)).size, 30);
        return items;
      };
      const oldSnapshotAgain = await ownerRequest(
        ownerPath + '/' + reviewId + '/submissions/' + firstSubmission.id,
      );
      const oldSnapshotValue = await oldSnapshotAgain.json();
      assert.equal(oldSnapshotValue.items.length, 24);
      const oldSnapshotItems = await completeSnapshotItems(
        oldSnapshotValue,
        firstSubmission.id,
      );
      assert.equal(
        oldSnapshotItems.find((item) => item.photoId === photos[0].photoId)
          .versionId,
        photos[0].versionId,
      );
      const secondSnapshot = await ownerRequest(
        ownerPath + '/' + reviewId + '/submissions/' + secondSubmission.id,
      );
      const secondSnapshotValue = await secondSnapshot.json();
      const secondSnapshotItems = await completeSnapshotItems(
        secondSnapshotValue,
        secondSubmission.id,
      );
      assert.equal(
        secondSnapshotItems.find((item) => item.photoId === photos[0].photoId)
          .versionId,
        version2Id,
      );
      assert.equal(secondSnapshotValue.items.length, 24);
      const reopenReplay = await ownerRequest(reopenPath, 'POST', reopenBody);
      assert.equal(reopenReplay.status, reopenedResponse.status);
      assert.deepEqual(
        await reopenReplay.json(),
        reopened,
        'exact Owner replay returns the round-two result after round two has later submitted',
      );

      // Current session revocation precedes replay and denies the old exact Guest result.
      const revokedHash = createHash('sha256')
        .update('kino-pic:guest-session:v1:' + guestA.cookieValue)
        .digest('hex');
      const guestSession = await db
        .prepare('SELECT id FROM guest_sessions WHERE secret_hash=?')
        .bind(revokedHash)
        .first();
      assert.ok(guestSession);
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(guestSession.id, revokedHash)
        .run();
      await expectError(
        await guestCall(
          enabled,
          base,
          guestA,
          guestPath(
            guestA,
            '/' + reviewId + '/photos/' + photos[0].photoId + '/selection',
          ),
          'PUT',
          noOpBody,
        ),
        401,
        'GUEST_ACCESS_REQUIRED',
      );

      // A revoked Owner session cannot replay and expose its previously stored result.
      const isolatedOwnerSessionId = randomUUID();
      const isolatedOwnerToken = randomBytes(32).toString('hex');
      const isolatedOwnerNow = Date.now();
      await db
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          isolatedOwnerSessionId,
          isolatedOwnerToken,
          owner,
          isolatedOwnerNow + 3600000,
          isolatedOwnerNow,
          isolatedOwnerNow,
        )
        .run();
      const isolatedOwnerSignature = createHmac('sha256', ownerSigningSecret)
        .update(isolatedOwnerToken)
        .digest('base64');
      const isolatedOwnerCookies = {
        headers: () =>
          'kino-owner.session_token=' +
          encodeURIComponent(isolatedOwnerToken + '.' + isolatedOwnerSignature),
      };
      const isolatedOwnerBody = {
        requestId: randomUUID(),
        title: 'Revoked replay ' + randomUUID(),
        inviteIds: [invite.inviteId],
        minimum: 1,
        maximum: 30,
        confirmShared: true,
      };
      const isolatedOwnerCreate = await ownerCall(
        enabled,
        base,
        isolatedOwnerCookies,
        ownerPath,
        'POST',
        isolatedOwnerBody,
      );
      assert.ok([200, 201].includes(isolatedOwnerCreate.status));
      const isolatedOwnerResult = await isolatedOwnerCreate.json();
      assert.ok(isolatedOwnerResult.review.id);
      await db
        .prepare('UPDATE owner_sessions SET expiresAt=? WHERE id=?')
        .bind(Date.now() - 1000, isolatedOwnerSessionId)
        .run();
      const deniedOwnerReplay = await ownerCall(
        enabled,
        base,
        isolatedOwnerCookies,
        ownerPath,
        'POST',
        isolatedOwnerBody,
      );
      await expectError(deniedOwnerReplay, 401, 'AUTH_REQUIRED');
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM shared_review_owner_commands WHERE request_id=?',
            )
            .bind(isolatedOwnerBody.requestId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE request_id=? AND action='shared_review.created'",
            )
            .bind(isolatedOwnerBody.requestId)
            .first()
        ).n,
        1,
      );
    },
  );
}
