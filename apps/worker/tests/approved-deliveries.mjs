import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { guestPermissionNames } from '../../../packages/contracts/src/guest-access.ts';
import { testDeliveryZips } from './delivery-zips.mjs';
import {
  testDeliveryNotifications,
  testRevokedDeliveryNotificationSession,
} from './delivery-notifications.mjs';

async function jsonAt(response, expected, label) {
  const value = await response
    .clone()
    .json()
    .catch(() => null);
  const code =
    typeof value?.error?.code === 'string' ? value.error.code : 'non-json';
  assert.equal(response.status, expected, label + ': ' + code);
  return value;
}

async function errorAt(response, expected, code, label) {
  const value = await jsonAt(response, expected, label);
  assert.equal(value?.error?.code, code, label);
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

async function deliveryAuditCount(db) {
  const row = await db
    .prepare(
      "SELECT count(*) AS count FROM audit_events WHERE action LIKE 'delivery.%'",
    )
    .first();
  return Number(row.count);
}

export async function testApprovedDeliveries({
  request,
  db,
  owner,
  ownerCookie,
  nonmemberCookie,
  target,
  photo,
}) {
  const albumId = target.albumId;
  const permissions = Object.fromEntries(
    guestPermissionNames.map((name) => [
      name,
      name === 'can_view' ||
        name === 'can_download_original' ||
        name === 'can_view_own_history',
    ]),
  );
  const invitePath = '/api/v1/projects/' + target.projectId + '/invites';
  async function invite(label) {
    const result = await jsonAt(
      await request(
        invitePath,
        'POST',
        {
          requestId: randomUUID(),
          albumIds: [albumId],
          accessMode: 'link_only',
          permissions,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          maxUses: 2,
        },
        ownerCookie,
      ),
      200,
      label,
    );
    assert.ok(result.invite?.inviteId && result.token, label);
    return { id: result.invite.inviteId, token: result.token };
  }
  async function exchange(invite, displayName) {
    const response = await request('/api/guest/exchange', 'POST', {
      requestId: randomUUID(),
      token: invite.token,
      displayName,
    });
    const result = await jsonAt(response, 200, displayName + ' exchange');
    assert.equal(result.authenticated, true);
    return secureGuestCookie(response);
  }

  const guests = [
    await invite('approved delivery Guest 1 invitation'),
    await invite('approved delivery Guest 2 invitation'),
  ];
  const [guestCookie1, guestCookie2] = await Promise.all([
    exchange(guests[0], 'Approved delivery Guest 1'),
    exchange(guests[1], 'Approved delivery Guest 2'),
  ]);
  const access = await jsonAt(
    await request(
      '/api/guest/albums/' + albumId + '/access',
      'GET',
      undefined,
      guestCookie1,
    ),
    200,
    'approved delivery Guest access',
  );
  assert.equal(access.access.inviteId, guests[0].id);
  assert.deepEqual(access.access.permissions, permissions);
  const access2 = await jsonAt(
    await request(
      '/api/guest/albums/' + albumId + '/access',
      'GET',
      undefined,
      guestCookie2,
    ),
    200,
    'approved delivery Guest 2 access',
  );
  assert.equal(access2.access.inviteId, guests[1].id);
  assert.deepEqual(access2.access.permissions, permissions);

  const nonmemberAccess = await jsonAt(
    await request(
      '/api/guest/albums/' + albumId + '/access',
      'GET',
      undefined,
      nonmemberCookie,
    ),
    200,
    'existing Guest access outside the new approval',
  );
  assert.ok(
    !guests.some((guest) => guest.id === nonmemberAccess.access.inviteId),
    'existing Guest is not a member of the approval',
  );

  const versions = await jsonAt(
    await request(
      '/api/v1/photos/' + photo.photoId + '/versions',
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'approved delivery current version',
  );
  assert.equal(versions.current.versionId, photo.versionId);
  const approvalPath =
    '/api/v1/albums/' +
    albumId +
    '/photos/' +
    photo.photoId +
    '/version-approvals';
  const approvalInput = {
    requestId: randomUUID(),
    expectedOwnerId: owner,
    expectedHead: {
      versionId: versions.current.versionId,
      revision: versions.current.revision,
    },
    inviteIds: guests.map((guest) => guest.id),
    confirm: true,
  };
  const approval = await jsonAt(
    await request(approvalPath, 'POST', approvalInput, ownerCookie),
    200,
    'Owner creates version approval for both invited Guests',
  );
  assert.equal(approval.request.versionId, photo.versionId);
  assert.deepEqual(
    [...approval.request.inviteIds].sort(),
    [...approvalInput.inviteIds].sort(),
  );

  const guestApprovalPath =
    '/api/guest/albums/' +
    albumId +
    '/photos/' +
    photo.photoId +
    '/version-approvals';
  const visibleApprovals = await jsonAt(
    await request(guestApprovalPath, 'GET', undefined, guestCookie1),
    200,
    'Guest lists version approval',
  );
  assert.equal(visibleApprovals.requests.length, 1);
  assert.equal(visibleApprovals.requests[0].id, approval.request.id);
  assert.equal(visibleApprovals.requests[0].status, 'open');
  const confirmation = await jsonAt(
    await request(
      guestApprovalPath + '/' + approval.request.id + '/confirm',
      'POST',
      {
        requestId: randomUUID(),
        expectedGuestId: access.access.guestId,
        confirm: true,
      },
      guestCookie1,
    ),
    200,
    'one invited Guest confirms the version',
  );
  assert.equal(confirmation.guestId, access.access.guestId);
  assert.equal(confirmation.recorded, true);
  const receipts = await db
    .prepare(
      'SELECT guest_id FROM version_approval_receipts WHERE approval_request_id=? ORDER BY guest_id',
    )
    .bind(approval.request.id)
    .all();
  assert.deepEqual(
    receipts.results.map((row) => row.guest_id),
    [access.access.guestId],
  );
  const ownerApprovals = await jsonAt(
    await request(approvalPath, 'GET', undefined, ownerCookie),
    200,
    'Owner sees approval confirmed by one invited Guest',
  );
  assert.equal(ownerApprovals.requests.length, 1);
  assert.equal(ownerApprovals.requests[0].status, 'confirmed');

  const publishPath = approvalPath + '/' + approval.request.id + '/delivery';
  const unsharedPublishCount = await deliveryAuditCount(db);
  await errorAt(
    await request(
      publishPath,
      'POST',
      {
        requestId: randomUUID(),
        expectedOwnerId: owner,
        inviteIds: [guests[0].id, nonmemberAccess.access.inviteId],
        confirm: true,
      },
      ownerCookie,
    ),
    409,
    'INVALID_DELIVERY_RECIPIENTS',
    'an invite outside approval membership cannot receive publication',
  );
  assert.equal(await deliveryAuditCount(db), unsharedPublishCount);

  const publicationInput = {
    requestId: randomUUID(),
    expectedOwnerId: owner,
    inviteIds: guests.map((guest) => guest.id),
    confirm: true,
  };
  const publication = await jsonAt(
    await request(publishPath, 'POST', publicationInput, ownerCookie),
    200,
    'Owner publishes the approved original to both invited Guests',
  );
  const published = publication.delivery;
  assert.equal(published.status, 'published');
  assert.deepEqual(
    [...published.inviteIds].sort(),
    [...publicationInput.inviteIds].sort(),
  );
  assert.equal(published.items.length, 1);
  assert.equal(published.items[0].asset.assetKind, 'original');
  const publishedAuditCount = await deliveryAuditCount(db);

  const replay = await jsonAt(
    await request(publishPath, 'POST', publicationInput, ownerCookie),
    200,
    'Owner exact publication replay',
  );
  assert.deepEqual(replay, publication);
  await errorAt(
    await request(
      publishPath,
      'POST',
      {
        ...publicationInput,
        inviteIds: [guests[0].id, nonmemberAccess.access.inviteId],
      },
      ownerCookie,
    ),
    409,
    'REQUEST_ID_CONFLICT',
    'publication replay with a different recipient conflicts',
  );
  assert.equal(await deliveryAuditCount(db), publishedAuditCount);

  const recipientRows = await db
    .prepare(
      'SELECT invite_id,guest_id FROM approved_delivery_live_guests WHERE delivery_id=? ORDER BY invite_id',
    )
    .bind(published.id)
    .all();
  assert.deepEqual(
    recipientRows.results,
    [
      { invite_id: guests[0].id, guest_id: access.access.guestId },
      { invite_id: guests[1].id, guest_id: access2.access.guestId },
    ].sort((a, b) => a.invite_id.localeCompare(b.invite_id)),
  );
  const inviteMasks = await db
    .prepare(
      'SELECT id,permissions_mask FROM guest_invites WHERE id IN (?,?) ORDER BY id',
    )
    .bind(guests[0].id, guests[1].id)
    .all();
  const permissionMask = guestPermissionNames.reduce(
    (mask, name, index) =>
      mask +
      (name === 'can_view' ||
      name === 'can_download_original' ||
      name === 'can_view_own_history'
        ? 2 ** index
        : 0),
    0,
  );
  assert.deepEqual(
    inviteMasks.results,
    [...guests]
      .map((guest) => ({ id: guest.id, permissions_mask: permissionMask }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );

  const guestDeliveriesPath = '/api/guest/albums/' + albumId + '/deliveries';
  const guestDeliveries = await jsonAt(
    await request(guestDeliveriesPath, 'GET', undefined, guestCookie1),
    200,
    'Guest reads the fixed delivery manifest',
  );
  assert.equal(guestDeliveries.deliveries.length, 1);
  const guestDelivery = guestDeliveries.deliveries[0];
  assert.equal(guestDelivery.access.inviteId, guests[0].id);
  assert.deepEqual(guestDelivery.access.permissions, {
    can_view_delivery: true,
    can_download_delivery: true,
  });
  const publishedDelivery = {
    id: published.id,
    projectId: published.projectId,
    albumId: published.albumId,
    status: published.status,
    publishedAt: published.publishedAt,
    expiresAt: published.expiresAt,
    items: published.items.map(({ photoId, versionId, versionNo, asset }) => ({
      photoId,
      versionId,
      versionNo,
      asset,
    })),
  };
  assert.deepEqual(guestDelivery.delivery, publishedDelivery);

  const file = published.items[0].asset;
  const downloadRequestId = randomUUID();
  const downloadPath =
    '/api/guest/albums/' +
    albumId +
    '/deliveries/' +
    published.id +
    '/assets/' +
    file.id +
    '/download?requestId=' +
    downloadRequestId;
  const download = await request(downloadPath, 'GET', undefined, guestCookie1);
  const downloadError = await download
    .clone()
    .json()
    .catch(() => null);
  assert.equal(
    download.status,
    200,
    'authorized original download: ' +
      (downloadError?.error?.code ?? 'non-json'),
  );
  assert.equal(download.headers.get('content-type'), file.mime);
  assert.equal(download.headers.get('content-length'), String(file.byteSize));
  assert.match(
    download.headers.get('content-disposition') ?? '',
    /^attachment;/,
  );
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.byteLength, file.byteSize);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    file.checksumSha256,
  );
  const downloadAudits = await db
    .prepare(
      `SELECT event_id,actor_id,guest_session_id,action,after_json,request_id
       FROM audit_events WHERE request_id=? AND action IN('delivery.download_requested','delivery.download_generated') ORDER BY action`,
    )
    .bind(downloadRequestId)
    .all();
  assert.deepEqual(
    downloadAudits.results.map((row) => row.action),
    ['delivery.download_generated', 'delivery.download_requested'],
  );
  assert.equal(downloadAudits.results[0].actor_id, access.access.guestId);
  assert.equal(
    downloadAudits.results[0].guest_session_id,
    downloadAudits.results[1].guest_session_id,
  );
  for (const audit of downloadAudits.results) {
    assert.equal(audit.request_id, downloadRequestId);
    assert.deepEqual(JSON.parse(audit.after_json), {
      deliveryId: published.id,
      assetId: file.id,
      filename: file.filename,
      byteSize: file.byteSize,
      mime: file.mime,
      clientIp: '127.0.0.1',
    });
  }

  for (const audit of downloadAudits.results) {
    await assert.rejects(
      db
        .prepare(
          `INSERT OR REPLACE INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) SELECT ?,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id FROM audit_events WHERE event_id=?`,
        )
        .bind(randomUUID(), audit.event_id)
        .run(),
      /REQUEST_ID_CONFLICT/,
    );
    assert.ok(
      await db
        .prepare('SELECT event_id FROM audit_events WHERE event_id=?')
        .bind(audit.event_id)
        .first(),
    );
  }
  const inFlightRequestId = randomUUID();
  const requestedOnlyEventId = randomUUID();
  await db
    .prepare(
      `INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) SELECT ?,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,? FROM audit_events WHERE event_id=?`,
    )
    .bind(
      requestedOnlyEventId,
      inFlightRequestId,
      downloadAudits.results[1].event_id,
    )
    .run();

  const ownHistory = await jsonAt(
    await request(
      '/api/guest/me/activity?albumId=' + albumId,
      'GET',
      undefined,
      guestCookie1,
    ),
    200,
    'Guest delivery history',
  );
  assert.deepEqual(
    ownHistory.items
      .filter((x) => x.action.startsWith('delivery.'))
      .map((x) => x.action)
      .sort(),
    [
      'delivery.download_generated',
      'delivery.download_requested',
      'delivery.download_requested',
    ],
  );
  assert.ok(!JSON.stringify(ownHistory).includes('clientIp'));
  const peerHistory = await jsonAt(
    await request(
      '/api/guest/me/activity?albumId=' + albumId,
      'GET',
      undefined,
      guestCookie2,
    ),
    200,
    'peer Guest own history',
  );
  assert.equal(
    peerHistory.items.filter((x) => x.action.startsWith('delivery.')).length,
    0,
  );
  const beforeUnsharedRead = await deliveryAuditCount(db);
  const unsharedList = await jsonAt(
    await request(guestDeliveriesPath, 'GET', undefined, nonmemberCookie),
    200,
    'nonmember Guest cannot read the delivery manifest',
  );
  assert.deepEqual(unsharedList, { deliveries: [], nextCursor: null });
  await errorAt(
    await request(downloadPath, 'GET', undefined, nonmemberCookie),
    401,
    'GUEST_ACCESS_REQUIRED',
    'nonmember Guest cannot download the delivery',
  );
  assert.equal(await deliveryAuditCount(db), beforeUnsharedRead);

  const beforeWrongAlbum = await deliveryAuditCount(db);
  await errorAt(
    await request(
      '/api/guest/albums/' + randomUUID() + '/deliveries',
      'GET',
      undefined,
      guestCookie1,
    ),
    404,
    'NOT_FOUND',
    'Guest cannot read deliveries from another album',
  );
  assert.equal(await deliveryAuditCount(db), beforeWrongAlbum);

  const publicationRow = await db
    .prepare(
      "SELECT event_id,actor_id,request_id,after_json,occurred_at_utc FROM audit_events WHERE action='delivery.published' AND actor_id=? AND request_id=?",
    )
    .bind(owner, publicationInput.requestId)
    .first();
  assert.ok(publicationRow);
  const publicationSnapshot = JSON.parse(publicationRow.after_json);
  assert.equal(publicationSnapshot.approvalRequestId, approval.request.id);
  assert.equal(publicationSnapshot.approvalReceiptId, confirmation.eventId);
  assert.deepEqual(
    publicationSnapshot.inviteIds,
    [...guests.map((guest) => guest.id)].sort(),
  );
  assert.equal(publicationSnapshot.item.photoId, photo.photoId);
  assert.equal(publicationSnapshot.item.versionId, photo.versionId);
  assert.equal(publicationSnapshot.item.asset.id, file.id);
  assert.equal(
    publicationSnapshot.item.asset.checksumSha256,
    file.checksumSha256,
  );
  const replacementEventId = randomUUID();
  const replacement = await db
    .prepare(
      `INSERT OR REPLACE INTO audit_events(event_id,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc)
       SELECT ?,actor_type,actor_id,session_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc FROM audit_events WHERE event_id=?`,
    )
    .bind(replacementEventId, publication.eventId)
    .run();
  assert.equal(replacement.meta.changes, 0);
  assert.deepEqual(
    await db
      .prepare(
        "SELECT event_id,actor_id,request_id,after_json,occurred_at_utc FROM audit_events WHERE action='delivery.published' AND actor_id=? AND request_id=?",
      )
      .bind(owner, publicationInput.requestId)
      .first(),
    publicationRow,
  );
  assert.equal(
    await db
      .prepare('SELECT event_id FROM audit_events WHERE event_id=?')
      .bind(replacementEventId)
      .first(),
    null,
  );

  const secondPublication = await jsonAt(
    await request(
      publishPath,
      'POST',
      {
        ...publicationInput,
        requestId: randomUUID(),
        inviteIds: [guests[0].id],
      },
      ownerCookie,
    ),
    200,
    'second publication for request binding',
  );
  await testDeliveryNotifications({
    request,
    db,
    owner,
    ownerCookie,
    workspaceId: target.workspaceId,
    albumId,
    guestCookie1,
    guestCookie2,
    approvalEventId: confirmation.eventId,
    publicationEventId: published.id,
    foreignDeliveryId: secondPublication.delivery.id,
    inviteIds: guests.map((guest) => guest.id),
    filename: file.filename,
    assetId: file.id,
  });
  const revokeRequestId = randomUUID();
  const revoke = await jsonAt(
    await request(
      '/api/v1/albums/' + albumId + '/deliveries/' + published.id + '/revoke',
      'POST',
      { requestId: revokeRequestId, expectedOwnerId: owner, confirm: true },
      ownerCookie,
    ),
    200,
    'Owner revokes published delivery',
  );
  assert.deepEqual(revoke, { revoked: true });
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) SELECT ?,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,'delivery.download_generated',after_json,request_id FROM audit_events WHERE event_id=?`,
      )
      .bind(randomUUID(), requestedOnlyEventId)
      .run(),
    /GUEST_ACCESS_REQUIRED/,
  );
  const revocation = await db
    .prepare(
      "SELECT event_id FROM audit_events WHERE action='delivery.revoked' AND json_extract(after_json,'$.deliveryId')=?",
    )
    .bind(published.id)
    .first();
  await assert.rejects(
    db
      .prepare(
        `INSERT OR REPLACE INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) SELECT ?,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,? FROM audit_events WHERE event_id=?`,
      )
      .bind(randomUUID(), randomUUID(), revocation.event_id)
      .run(),
    /ALREADY_REVOKED/,
  );
  assert.ok(
    await db
      .prepare('SELECT event_id FROM audit_events WHERE event_id=?')
      .bind(revocation.event_id)
      .first(),
  );
  await errorAt(
    await request(
      '/api/v1/albums/' +
        albumId +
        '/deliveries/' +
        secondPublication.delivery.id +
        '/revoke',
      'POST',
      { requestId: revokeRequestId, expectedOwnerId: owner, confirm: true },
      ownerCookie,
    ),
    409,
    'REQUEST_ID_CONFLICT',
    'revoke request cannot target another delivery',
  );
  assert.equal(
    (
      await jsonAt(
        await request(guestDeliveriesPath, 'GET', undefined, guestCookie1),
        200,
        'second delivery remains live',
      )
    ).deliveries[0].delivery.id,
    secondPublication.delivery.id,
  );
  await jsonAt(
    await request(
      '/api/v1/albums/' +
        albumId +
        '/deliveries/' +
        secondPublication.delivery.id +
        '/revoke',
      'POST',
      { requestId: randomUUID(), expectedOwnerId: owner, confirm: true },
      ownerCookie,
    ),
    200,
    'revoke second using fresh intent',
  );
  await jsonAt(
    await request(
      '/api/v1/albums/' + albumId + '/deliveries/' + published.id + '/revoke',
      'POST',
      { requestId: revokeRequestId, expectedOwnerId: owner, confirm: true },
      ownerCookie,
    ),
    200,
    'exact original revoke replay',
  );
  await errorAt(
    await request(
      '/api/v1/albums/' + albumId + '/deliveries/' + published.id + '/revoke',
      'POST',
      { requestId: randomUUID(), expectedOwnerId: owner, confirm: true },
      ownerCookie,
    ),
    409,
    'ALREADY_REVOKED',
    'fresh intent does not receive unbound success',
  );
  const beforeRevokedRead = await deliveryAuditCount(db);
  const revokedList = await jsonAt(
    await request(guestDeliveriesPath, 'GET', undefined, guestCookie1),
    200,
    'revoked delivery is hidden from Guest reads',
  );
  assert.deepEqual(revokedList, { deliveries: [], nextCursor: null });
  const revokedReplay = await jsonAt(
    await request(publishPath, 'POST', publicationInput, ownerCookie),
    200,
    'committed publication replay reports current revoked status',
  );
  assert.equal(revokedReplay.delivery.status, 'revoked');
  assert.equal(revokedReplay.delivery.id, published.id);
  await errorAt(
    await request(downloadPath, 'GET', undefined, guestCookie1),
    401,
    'GUEST_ACCESS_REQUIRED',
    'revoked delivery cannot be downloaded',
  );
  assert.equal(await deliveryAuditCount(db), beforeRevokedRead);

  for (let i = 0; i < 25; i++)
    await jsonAt(
      await request(
        publishPath,
        'POST',
        { ...publicationInput, requestId: randomUUID() },
        ownerCookie,
      ),
      200,
      'paged publication fixture',
    );
  const firstGuestPage = await jsonAt(
    await request(guestDeliveriesPath, 'GET', undefined, guestCookie1),
    200,
    'first delivery page',
  );
  assert.equal(firstGuestPage.deliveries.length, 24);
  assert.ok(firstGuestPage.nextCursor);
  const lastGuestPage = await jsonAt(
    await request(
      guestDeliveriesPath + '?cursor=' + firstGuestPage.nextCursor,
      'GET',
      undefined,
      guestCookie1,
    ),
    200,
    'second delivery page',
  );
  assert.equal(lastGuestPage.deliveries.length, 1);
  assert.equal(lastGuestPage.nextCursor, null);
  assert.equal(
    new Set(
      [...firstGuestPage.deliveries, ...lastGuestPage.deliveries].map(
        (x) => x.delivery.id,
      ),
    ).size,
    25,
  );
  const ownerList =
    '/api/v1/albums/' +
    albumId +
    '/photos/' +
    photo.photoId +
    '/deliveries?approvalId=' +
    approval.request.id;
  const firstOwnerPage = await jsonAt(
    await request(ownerList, 'GET', undefined, ownerCookie),
    200,
    'scoped Owner delivery page',
  );
  assert.equal(firstOwnerPage.deliveries.length, 24);
  assert.ok(firstOwnerPage.nextCursor);
  const lastOwnerPage = await jsonAt(
    await request(
      ownerList + '&cursor=' + firstOwnerPage.nextCursor,
      'GET',
      undefined,
      ownerCookie,
    ),
    200,
    'scoped Owner second page',
  );
  assert.equal(lastOwnerPage.deliveries.length, 3);
  assert.equal(lastOwnerPage.nextCursor, null);
  await errorAt(
    await request(
      guestDeliveriesPath + '?cursor=' + firstGuestPage.nextCursor,
      'GET',
      undefined,
      nonmemberCookie,
    ),
    400,
    'INVALID_CURSOR',
    'another invite cannot reuse a delivery cursor',
  );
  await testDeliveryZips({
    request,
    db,
    albumId,
    owner,
    ownerCookie,
    guestCookie1,
    guestCookie2,
    nonmemberCookie,
    deliveryIds: firstGuestPage.deliveries
      .slice(0, 2)
      .map((entry) => entry.delivery.id),
  });
  await testRevokedDeliveryNotificationSession({
    request,
    albumId,
    guestCookie2,
  });
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all();
  assert.deepEqual(foreignKeys.results, []);
}
