import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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

async function zipAuditCount(db) {
  const row = await db
    .prepare(
      "SELECT count(*) AS count FROM audit_events WHERE action LIKE 'delivery.zip_%'",
    )
    .first();
  return Number(row.count);
}

function readZip(bytes) {
  const script = [
    'import base64,io,json,sys,zipfile',
    'with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:',
    '    print(json.dumps([{ "name": item.filename, "bytes": base64.b64encode(archive.read(item)).decode("ascii") } for item in archive.infolist()]))',
  ].join('\n');
  const reader = spawnSync(
    process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
    ['-c', script],
    { input: bytes, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  if (reader.error) throw reader.error;
  assert.equal(reader.status, 0, 'Python zipfile reads the complete archive');
  return JSON.parse(reader.stdout).map((entry) => ({
    name: entry.name,
    bytes: Buffer.from(entry.bytes, 'base64'),
  }));
}

export async function testDeliveryZips({
  request,
  db,
  albumId,
  owner,
  ownerCookie,
  guestCookie1,
  guestCookie2,
  nonmemberCookie,
  deliveryIds,
}) {
  assert.equal(deliveryIds.length, 2, 'the archive fixture has two entries');
  assert.equal(new Set(deliveryIds).size, 2);

  const guestDeliveries = await jsonAt(
    await request(
      '/api/guest/albums/' + albumId + '/deliveries',
      'GET',
      undefined,
      guestCookie1,
    ),
    200,
    'Guest reads source deliveries for ZIP byte comparison',
  );
  const selected = deliveryIds.map((deliveryId) => {
    const entry = guestDeliveries.deliveries.find(
      (candidate) => candidate.delivery.id === deliveryId,
    );
    assert.ok(entry, 'selected delivery belongs to Guest 1');
    return entry;
  });
  assert.equal(
    new Set(selected.map((entry) => entry.delivery.items[0].photoId)).size,
    1,
    'this fixture repeats one original photo across two publications',
  );
  assert.equal(
    new Set(
      selected.map((entry) => {
        const item = entry.delivery.items[0];
        return `${item.photoId}:${item.versionId}:${item.asset.id}`;
      }),
    ).size,
    1,
    'the fixture uses the same fixed original, not two physical photos',
  );

  const sourceBytes = new Map();
  for (const entry of selected) {
    const item = entry.delivery.items[0];
    assert.equal(item.asset.assetKind, 'original');
    const response = await request(
      '/api/guest/albums/' +
        albumId +
        '/deliveries/' +
        entry.delivery.id +
        '/assets/' +
        item.asset.id +
        '/download?requestId=' +
        randomUUID(),
      'GET',
      undefined,
      guestCookie1,
    );
    assert.equal(response.status, 200, 'each original remains readable');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.byteLength, item.asset.byteSize);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      item.asset.checksumSha256,
    );
    sourceBytes.set(entry.delivery.id, bytes);
  }

  const access = await jsonAt(
    await request(
      '/api/guest/albums/' + albumId + '/access',
      'GET',
      undefined,
      guestCookie1,
    ),
    200,
    'ZIP owner identity',
  );
  const path = '/api/guest/albums/' + albumId + '/delivery-zips';
  const input = {
    requestId: randomUUID(),
    expectedGuestId: access.access.guestId,
    deliveryIds,
  };
  const ticket = await jsonAt(
    await request(path, 'POST', input, guestCookie1),
    200,
    'Guest creates a two-publication ZIP',
  );
  assert.equal(ticket.albumId, albumId);
  assert.equal(ticket.fileCount, 2);
  assert.equal(
    new Set(ticket.files.map((file) => file.name)).size,
    2,
    'repeated publication of one original still receives distinct ZIP names',
  );
  assert.ok(Date.parse(ticket.expiresAt) > Date.now());
  assert.ok(Date.parse(ticket.expiresAt) <= Date.now() + 15 * 60_000);

  const ticketRow = await db
    .prepare(
      "SELECT event_id,actor_id,guest_session_id,workspace_id,project_id,album_id,after_json FROM audit_events WHERE action='delivery.zip_created' AND event_id=?",
    )
    .bind(ticket.id)
    .first();
  assert.ok(ticketRow);
  const manifest = JSON.parse(ticketRow.after_json);
  assert.deepEqual(manifest.deliveryIds, [...deliveryIds].sort());
  assert.equal(manifest.items.length, 2);
  assert.deepEqual(
    ticket.files.map((file) => file.name),
    manifest.items.map((item) => item.entryName),
  );
  for (const item of manifest.items) {
    const source = selected.find(
      (entry) => entry.delivery.id === item.deliveryId,
    );
    assert.ok(source);
    assert.equal(item.byteSize, source.delivery.items[0].asset.byteSize);
  }

  assert.deepEqual(
    await jsonAt(
      await request(path, 'POST', input, guestCookie1),
      200,
      'exact ZIP creation replay',
    ),
    ticket,
  );
  const created = await zipAuditCount(db);
  await errorAt(
    await request(
      path,
      'POST',
      { ...input, deliveryIds: [deliveryIds[0]] },
      guestCookie1,
    ),
    409,
    'REQUEST_ID_CONFLICT',
    'changed ZIP replay conflicts',
  );
  assert.equal(await zipAuditCount(db), created);

  await errorAt(
    await request(path + '/' + ticket.id, 'GET', undefined, guestCookie2),
    401,
    'GUEST_ACCESS_REQUIRED',
    'another invited Guest cannot read this Guest session ticket',
  );
  const nonmemberAccess = await jsonAt(
    await request(
      '/api/guest/albums/' + albumId + '/access',
      'GET',
      undefined,
      nonmemberCookie,
    ),
    200,
    'nonmember identity for recipient denial',
  );
  const beforeNonmemberCreate = await zipAuditCount(db);
  await errorAt(
    await request(
      path,
      'POST',
      {
        ...input,
        requestId: randomUUID(),
        expectedGuestId: nonmemberAccess.access.guestId,
      },
      nonmemberCookie,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'nonrecipient cannot create a ZIP from another invitation delivery',
  );
  assert.equal(await zipAuditCount(db), beforeNonmemberCreate);

  const downloadRequestId = randomUUID();
  const download = await request(
    path + '/' + ticket.id + '/download?requestId=' + downloadRequestId,
    'GET',
    undefined,
    guestCookie1,
  );
  assert.equal(download.status, 200, 'authorized ZIP download');
  assert.equal(download.headers.get('content-type'), 'application/zip');
  assert.match(
    download.headers.get('content-disposition') ?? '',
    /^attachment;/,
  );
  const archiveEntries = readZip(Buffer.from(await download.arrayBuffer()));
  assert.deepEqual(
    archiveEntries.map((entry) => entry.name),
    manifest.items.map((item) => item.entryName),
  );
  for (let index = 0; index < archiveEntries.length; index++) {
    const entry = archiveEntries[index];
    const item = manifest.items[index];
    assert.ok(entry && item);
    assert.deepEqual(entry.bytes, sourceBytes.get(item.deliveryId));
  }
  const downloadAudits = await db
    .prepare(
      "SELECT action,actor_id,guest_session_id,after_json FROM audit_events WHERE request_id=? AND action IN('delivery.zip_download_requested','delivery.zip_download_generated') ORDER BY action",
    )
    .bind(downloadRequestId)
    .all();
  assert.deepEqual(
    downloadAudits.results.map((row) => row.action),
    ['delivery.zip_download_generated', 'delivery.zip_download_requested'],
  );
  assert.ok(
    downloadAudits.results.every(
      (row) =>
        row.actor_id === access.access.guestId &&
        row.guest_session_id === ticketRow.guest_session_id &&
        Object.keys(JSON.parse(row.after_json)).sort().join(',') ===
          'clientIp,ticketId',
    ),
  );

  const history = await jsonAt(
    await request(
      '/api/guest/me/activity?albumId=' + albumId,
      'GET',
      undefined,
      guestCookie1,
    ),
    200,
    'Guest ZIP history uses the real scoped projection',
  );
  const zipEvents = history.items.filter((event) =>
    event.action.startsWith('delivery.zip_'),
  );
  assert.equal(zipEvents.length, 2);
  for (const event of zipEvents) {
    assert.equal(event.photoId, null);
    assert.equal(event.versionId, null);
    assert.equal(event.photoStatus, null);
    assert.deepEqual(event.detail, { ticketId: ticket.id });
  }
  const otherHistory = await jsonAt(
    await request(
      '/api/guest/me/activity?albumId=' + albumId,
      'GET',
      undefined,
      guestCookie2,
    ),
    200,
    'Other Guest retains its own isolated history',
  );
  assert.equal(
    otherHistory.items.some((event) =>
      event.action.startsWith('delivery.zip_'),
    ),
    false,
  );

  const expiredId = randomUUID();
  const expiredManifest = JSON.stringify({ ...manifest, expiresAtMs: 0 });
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,after_json,request_id)
         SELECT ?,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,'delivery.zip_created',?,? FROM audit_events WHERE event_id=?`,
      )
      .bind(expiredId, expiredManifest, randomUUID(), ticket.id)
      .run(),
    /INVALID_ZIP_MANIFEST/,
  );
  await errorAt(
    await request(path + '/' + expiredId, 'GET', undefined, guestCookie1),
    401,
    'GUEST_ACCESS_REQUIRED',
    'an expired forged ticket remains unavailable',
  );

  const afterJson = JSON.stringify({ ticketId: ticket.id, clientIp: null });
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,after_json,request_id)
         SELECT ?,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,'delivery.zip_download_generated',?,? FROM audit_events WHERE event_id=?`,
      )
      .bind(randomUUID(), afterJson, randomUUID(), ticket.id)
      .run(),
    /DOWNLOAD_AUDIT_UNAVAILABLE/,
  );
  const otherAccess = await jsonAt(
    await request(
      '/api/guest/albums/' + albumId + '/access',
      'GET',
      undefined,
      guestCookie2,
    ),
    200,
    'second invite identity for SQL forgery check',
  );
  const otherSession = await db
    .prepare(
      "SELECT id FROM guest_sessions WHERE guest_id=? AND expires_at_ms>unixepoch('subsec')*1000 ORDER BY id LIMIT 1",
    )
    .bind(otherAccess.access.guestId)
    .first();
  assert.ok(otherSession);
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,after_json,request_id)
         SELECT ?,'guest',?,?,workspace_id,project_id,album_id,'delivery.zip_download_requested',?,? FROM audit_events WHERE event_id=?`,
      )
      .bind(
        randomUUID(),
        otherAccess.access.guestId,
        otherSession.id,
        afterJson,
        randomUUID(),
        ticket.id,
      )
      .run(),
    /GUEST_ACCESS_REQUIRED/,
  );

  const revokeId = deliveryIds[0];
  assert.ok(revokeId);
  await jsonAt(
    await request(
      '/api/v1/albums/' + albumId + '/deliveries/' + revokeId + '/revoke',
      'POST',
      { requestId: randomUUID(), expectedOwnerId: owner, confirm: true },
      ownerCookie,
    ),
    200,
    'Owner revokes one ZIP source delivery',
  );
  const beforeRevokedRead = await zipAuditCount(db);
  await errorAt(
    await request(path + '/' + ticket.id, 'GET', undefined, guestCookie1),
    401,
    'GUEST_ACCESS_REQUIRED',
    'ticket disappears after a source delivery is revoked',
  );
  await errorAt(
    await request(
      path + '/' + ticket.id + '/download?requestId=' + randomUUID(),
      'GET',
      undefined,
      guestCookie1,
    ),
    401,
    'GUEST_ACCESS_REQUIRED',
    'ZIP download fails closed after a source delivery is revoked',
  );
  assert.equal(await zipAuditCount(db), beforeRevokedRead);
}
