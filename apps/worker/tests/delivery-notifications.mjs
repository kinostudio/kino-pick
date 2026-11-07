import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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

function cookieSecret(cookie) {
  const match = /^__Host-kino_guest=([a-f0-9]{64})$/.exec(cookie);
  assert.ok(match, 'native Guest cookie contains a scoped session bearer');
  return match[1];
}

function assertFeedShape(feed, idKey, id) {
  assert.deepEqual(Object.keys(feed).sort(), [idKey, 'notifications'].sort());
  assert.equal(feed[idKey], id);
  for (const notification of feed.notifications)
    assert.deepEqual(Object.keys(notification).sort(), ['kind', 'occurredAt']);
  assert.ok(feed.notifications.length <= 24, 'feed remains bounded to 24');
}

async function eventById(db, eventId, action) {
  const row = await db
    .prepare(
      'SELECT event_id,action,after_json,occurred_at_utc,project_id FROM audit_events WHERE event_id=?',
    )
    .bind(eventId)
    .first();
  assert.ok(row, action + ' immutable audit event exists');
  assert.equal(row.action, action);
  return { ...row, after: JSON.parse(row.after_json) };
}

export async function testDeliveryNotifications({
  request,
  db,
  owner,
  ownerCookie,
  workspaceId,
  albumId,
  guestCookie1,
  guestCookie2,
  approvalEventId,
  publicationEventId,
  foreignDeliveryId,
  inviteIds,
  filename,
  assetId,
}) {
  assert.equal(inviteIds.length, 2);
  const [recipientInviteId] = inviteIds;
  const approval = await eventById(
    db,
    approvalEventId,
    'version_approval.confirmed',
  );
  const publication = await eventById(
    db,
    publicationEventId,
    'delivery.published',
  );
  const foreignPublication = await eventById(
    db,
    foreignDeliveryId,
    'delivery.published',
  );
  assert.deepEqual(
    [...publication.after.inviteIds].sort(),
    [...inviteIds].sort(),
  );
  assert.deepEqual(foreignPublication.after.inviteIds, [recipientInviteId]);
  assert.equal(publication.after.item.asset.id, assetId);
  assert.equal(foreignPublication.after.item.asset.id, assetId);
  assert.equal(
    publication.after.item.versionId,
    foreignPublication.after.item.versionId,
    'both invitations retain the exact approved version',
  );

  const ownerFeed = await jsonAt(
    await request(
      '/api/v1/workspaces/' + workspaceId + '/delivery-notifications',
      'GET',
      undefined,
      ownerCookie,
      { expectedActor: owner },
    ),
    200,
    'authorized Owner reads approval and delivery notifications',
  );
  assertFeedShape(ownerFeed, 'workspaceId', workspaceId);
  assert.ok(
    ownerFeed.notifications.some(
      (item) =>
        item.kind === 'approval_confirmed' &&
        item.occurredAt === approval.occurred_at_utc,
    ),
  );
  for (const event of [publication, foreignPublication])
    assert.ok(
      ownerFeed.notifications.some(
        (item) =>
          item.kind === 'delivery_published' &&
          item.occurredAt === event.occurred_at_utc,
      ),
    );

  const guestPath = '/api/guest/albums/' + albumId + '/delivery-notifications';
  const [recipientFeed, peerFeed] = await Promise.all([
    request(guestPath, 'GET', undefined, guestCookie1).then((response) =>
      jsonAt(response, 200, 'recipient Guest reads own delivery notices'),
    ),
    request(guestPath, 'GET', undefined, guestCookie2).then((response) =>
      jsonAt(response, 200, 'peer Guest reads only addressed delivery notices'),
    ),
  ]);
  assertFeedShape(recipientFeed, 'albumId', albumId);
  assertFeedShape(peerFeed, 'albumId', albumId);
  assert.equal(recipientFeed.notifications.length, 2);
  assert.ok(
    recipientFeed.notifications.every(
      (item) => item.kind === 'delivery_published',
    ),
  );
  assert.equal(peerFeed.notifications.length, 1);
  assert.equal(peerFeed.notifications[0].kind, 'delivery_published');
  assert.ok(
    recipientFeed.notifications.some(
      (item) => item.occurredAt === publication.occurred_at_utc,
    ),
  );
  assert.ok(
    recipientFeed.notifications.some(
      (item) => item.occurredAt === foreignPublication.occurred_at_utc,
    ),
  );
  assert.ok(
    peerFeed.notifications.some(
      (item) => item.occurredAt === publication.occurred_at_utc,
    ),
  );
  if (foreignPublication.occurred_at_utc !== publication.occurred_at_utc)
    assert.ok(
      !peerFeed.notifications.some(
        (item) => item.occurredAt === foreignPublication.occurred_at_utc,
      ),
      'a nonrecipient sees no notice for the foreign publication',
    );

  const [asset, downloadAudit] = await Promise.all([
    db
      .prepare('SELECT object_key FROM photo_assets WHERE id=?')
      .bind(assetId)
      .first(),
    db
      .prepare(
        "SELECT after_json FROM audit_events WHERE action='delivery.download_requested' AND album_id=? ORDER BY occurred_at_utc DESC,event_id DESC LIMIT 1",
      )
      .bind(albumId)
      .first(),
  ]);
  assert.ok(asset?.object_key);
  assert.ok(downloadAudit?.after_json);
  const downloadData = JSON.parse(downloadAudit.after_json);
  const serialized = JSON.stringify([ownerFeed, recipientFeed, peerFeed]);
  const forbidden = [
    approvalEventId,
    publicationEventId,
    foreignDeliveryId,
    ...inviteIds,
    assetId,
    filename,
    publication.after.item.photoId,
    publication.after.item.versionId,
    asset.object_key,
    downloadData.deliveryId,
    downloadData.assetId,
    downloadData.filename,
    downloadData.clientIp,
    cookieSecret(guestCookie1),
    cookieSecret(guestCookie2),
  ].filter((value) => typeof value === 'string' && value.length > 0);
  for (const value of forbidden)
    assert.ok(
      !serialized.includes(value),
      'notification feed omits private metadata',
    );
  assert.doesNotMatch(serialized, /clientIp|objectKey|token/i);
}

export async function testRevokedDeliveryNotificationSession({
  request,
  albumId,
  guestCookie2,
}) {
  await jsonAt(
    await request(
      '/api/guest/logout',
      'POST',
      { requestId: randomUUID() },
      guestCookie2,
    ),
    200,
    'Guest logs out through the real revocation route',
  );
  await errorAt(
    await request(
      '/api/guest/albums/' + albumId + '/delivery-notifications',
      'GET',
      undefined,
      guestCookie2,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'revoked Guest session cannot read delivery notifications',
  );
}
