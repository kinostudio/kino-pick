import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';

export async function humanViewChecks({
  db,
  request,
  owner,
  ownerCookie,
  base,
  authSecret,
  fixture,
}) {
  const {
    albumId,
    photoId,
    versionId,
    viewGuest,
    downloadGuest,
    unsharedAlbumId,
  } = fixture;
  const body = (actor) => ({
    photoId,
    versionId,
    expectedActorId: actor,
    visibleForMs: 1000,
  });
  const send = (role, cookie, actor, extra = {}, headers = {}) =>
    request(
      `/api/${role === 'owner' ? 'v1' : 'guest'}/albums/${extra.albumId ?? albumId}/view-heartbeats`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: base,
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ ...body(actor), ...(extra.body ?? {}) }),
      },
    );
  const count = async (table) =>
    (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
  const projection = () =>
    db
      .prepare('SELECT * FROM album_human_activity WHERE album_id=?')
      .bind(albumId)
      .first();
  const usage = () =>
    db
      .prepare('SELECT * FROM workspace_storage_usage WHERE workspace_id=?')
      .bind(fixture.workspaceId)
      .first();
  const beforeUsage = await usage();
  const beforeAssets = await count('photo_assets');
  const checks = [];
  const cap = await request('/api/human-views/capabilities');
  assert.equal(cap.status, 200);
  assert.deepEqual(await cap.json(), {
    enabled: true,
    minVisibleMs: 1000,
    dedupeMs: 300000,
  });

  async function accept(role, cookie, actor) {
    const before = await count('human_photo_views');
    const r = await send(role, cookie, actor);
    assert.equal(r.status, 200, await r.clone().text());
    const result = await r.json();
    assert.equal(result.recorded, true);
    assert.equal(await count('human_photo_views'), before + 1);
    const row = await db
      .prepare(
        'SELECT * FROM human_photo_views WHERE actor_id=? ORDER BY viewed_at_ms DESC LIMIT 1',
      )
      .bind(actor)
      .first();
    assert.ok(row);
    assert.equal(Date.parse(result.nextAllowedAt), row.viewed_at_ms + 300000);
    assert.equal(row.photo_id, photoId);
    assert.equal(row.version_id, versionId);
    assert.equal(row.visible_for_ms, 1000);
    const audit = await db
      .prepare(
        "SELECT * FROM audit_events WHERE request_id=? AND action='gallery.viewed'",
      )
      .bind(row.request_id)
      .first();
    assert.ok(audit);
    assert.equal(audit.actor_id, actor);
    assert.equal(audit.actor_type, role === 'owner' ? 'user' : 'guest');
    assert.equal(audit.album_id, albumId);
    assert.equal(audit.photo_id, photoId);
    assert.equal(audit.version_id, versionId);
    assert.equal(audit.before_json, null);
    assert.deepEqual(JSON.parse(audit.after_json), {
      source: 'visible_photo',
      visibleForMs: 1000,
    });
    assert.equal(
      role === 'owner' ? audit.session_id : audit.guest_session_id,
      row.authorization_session_id,
    );
    const p = await projection();
    assert.equal(p.last_valid_viewed_at_ms, row.viewed_at_ms);
    const repeat = await send(role, cookie, actor);
    assert.equal(repeat.status, 200, await repeat.clone().text());
    const repeatBody = await repeat.json();
    assert.equal(repeatBody.recorded, false);
    assert.equal(repeatBody.nextAllowedAt, result.nextAllowedAt);
    assert.equal(await count('human_photo_views'), before + 1);
    assert.deepEqual(await projection(), p);
    return row;
  }
  const ownerRow = await accept('owner', ownerCookie, owner);
  const guestRow = await accept(
    'guest',
    'kino_guest=' + viewGuest.cookie,
    viewGuest.guestId,
  );
  checks.push(
    'Owner/Guest visible-photo activity is atomic, scoped, and rolling-five-minute deduped with exact audit/projection witnesses',
  );

  const beforeDenied = await count('human_photo_views');
  const beforeProjection = await projection();
  for (const [extra, headers, status] of [
    [{ body: { visibleForMs: 999 } }, {}, 400],
    [{ body: { observedAt: '2026-01-01T00:00:00Z' } }, {}, 400],
    [{}, { Origin: 'https://foreign.invalid' }, 403],
    [{}, { 'CF-Worker': 'foreign.invalid' }, 403],
    [{}, { 'Sec-Fetch-Site': 'cross-site' }, 403],
  ]) {
    const r = await send(
      'guest',
      'kino_guest=' + viewGuest.cookie,
      viewGuest.guestId,
      extra,
      headers,
    );
    assert.equal(r.status, status, await r.clone().text());
  }
  for (const [guest, extra] of [
    [downloadGuest, {}],
    [viewGuest, { body: { expectedActorId: randomUUID() } }],
    [viewGuest, { body: { photoId: randomUUID() } }],
    [viewGuest, { body: { versionId: randomUUID() } }],
    [viewGuest, { albumId: unsharedAlbumId }],
  ]) {
    const r = await send(
      'guest',
      'kino_guest=' + guest.cookie,
      guest.guestId,
      extra,
    );
    assert.equal(r.status, 401, await r.clone().text());
  }
  await db
    .prepare(
      'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
    )
    .bind(viewGuest.sessionId, viewGuest.secretHash)
    .run();
  const revoked = await send(
    'guest',
    'kino_guest=' + viewGuest.cookie,
    viewGuest.guestId,
  );
  assert.equal(revoked.status, 401, await revoked.clone().text());
  assert.equal(await count('human_photo_views'), beforeDenied);
  assert.deepEqual(await projection(), beforeProjection);
  checks.push(
    'Subsecond, injected timestamps, cross-origin/Worker requests, download-only, foreign scope/identity and revoked sessions do not renew activity',
  );

  const session = randomUUID(),
    token = randomUUID(),
    now = Date.now();
  await db
    .prepare(
      'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind(session, token, owner, now + 3600000, now, now)
    .run();
  const freshOwnerCookie =
    (base.startsWith('https:')
      ? '__Secure-kino-owner.session_token='
      : 'kino-owner.session_token=') +
    encodeURIComponent(token + '.' + (await makeSignature(token, authSecret)));
  const beforeFutureTimestamp = {
    humanEvents: await count('human_photo_views'),
    humanAudits: await db
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='gallery.viewed'",
      )
      .first(),
    transitions: await count('album_inherited_share_transitions'),
    states: await count('album_inherited_share_states'),
    projection: await projection(),
    inheritedState: await db
      .prepare(
        'SELECT generation,phase,expires_at_ms,inputs_json,last_transition_id FROM album_inherited_share_states WHERE album_id=? AND workspace_id=? AND project_id=?',
      )
      .bind(albumId, fixture.workspaceId, fixture.projectId)
      .first(),
  };
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO human_photo_views(event_id,request_id,actor_type,actor_id,authorization_session_id,workspace_id,project_id,album_id,photo_id,version_id,viewed_at_ms,visible_for_ms) SELECT ?,?,'user',?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER)+500,1000",
      )
      .bind(
        randomUUID(),
        randomUUID(),
        owner,
        session,
        fixture.workspaceId,
        fixture.projectId,
        albumId,
        photoId,
        versionId,
      )
      .run(),
    /HUMAN_VIEW_TIMESTAMP_INVALID/,
  );
  assert.equal(
    await count('human_photo_views'),
    beforeFutureTimestamp.humanEvents,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE action='gallery.viewed'",
        )
        .first()
    ).n,
    beforeFutureTimestamp.humanAudits.n,
  );
  assert.equal(
    await count('album_inherited_share_transitions'),
    beforeFutureTimestamp.transitions,
  );
  assert.equal(
    await count('album_inherited_share_states'),
    beforeFutureTimestamp.states,
  );
  assert.deepEqual(await projection(), beforeFutureTimestamp.projection);
  assert.deepEqual(
    await db
      .prepare(
        'SELECT generation,phase,expires_at_ms,inputs_json,last_transition_id FROM album_inherited_share_states WHERE album_id=? AND workspace_id=? AND project_id=?',
      )
      .bind(albumId, fixture.workspaceId, fixture.projectId)
      .first(),
    beforeFutureTimestamp.inheritedState,
  );
  checks.push(
    'Database-clock future human view is rejected by timestamp guard without changing event, audit, activity, or inherited state',
  );
  const beforeFailure = await count('human_photo_views');
  await db.exec(
    "CREATE TRIGGER human_views_test_audit_abort BEFORE INSERT ON audit_events WHEN NEW.action='gallery.viewed' BEGIN SELECT RAISE(ABORT,'INJECTED_HUMAN_VIEW_AUDIT_FAILURE'); END",
  );
  try {
    const failed = await send('owner', freshOwnerCookie, owner);
    assert.equal(failed.status, 503, await failed.clone().text());
    assert.equal(await count('human_photo_views'), beforeFailure);
    assert.deepEqual(await projection(), beforeProjection);
  } finally {
    await db.exec('DROP TRIGGER human_views_test_audit_abort');
  }
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO human_photo_views(event_id,request_id,actor_type,actor_id,authorization_session_id,workspace_id,project_id,album_id,photo_id,version_id,viewed_at_ms,visible_for_ms) VALUES(?,?,'user',?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),1000)",
      )
      .bind(
        randomUUID(),
        randomUUID(),
        randomUUID(),
        session,
        fixture.workspaceId,
        fixture.projectId,
        albumId,
        photoId,
        versionId,
      )
      .run(),
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE human_photo_views SET visible_for_ms=1001 WHERE event_id=?',
      )
      .bind(ownerRow.event_id)
      .run(),
  );
  await assert.rejects(
    db
      .prepare('DELETE FROM human_photo_views WHERE event_id=?')
      .bind(ownerRow.event_id)
      .run(),
  );
  await assert.rejects(
    db
      .prepare(
        'UPDATE album_human_activity SET last_valid_viewed_at_ms=last_valid_viewed_at_ms+86400000 WHERE album_id=?',
      )
      .bind(albumId)
      .run(),
  );
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,after_json,request_id) VALUES(?,'user',?,?,?,?,?,?,?,'gallery.viewed',?,?)",
      )
      .bind(
        randomUUID(),
        owner,
        session,
        fixture.workspaceId,
        fixture.projectId,
        albumId,
        photoId,
        versionId,
        JSON.stringify({ source: 'visible_photo', visibleForMs: 1000 }),
        randomUUID(),
      )
      .run(),
  );
  assert.equal(await count('human_photo_views'), beforeFailure);
  assert.deepEqual(await usage(), beforeUsage);
  assert.equal(await count('photo_assets'), beforeAssets);
  checks.push(
    'Audit failure rolls back activity, native immutable/projection/audit guards reject forged changes, and quota/assets stay intact',
  );
  // REPLACE must not bypass append-only deletion triggers, even with a fresh session.
  const duplicateInsert =
    "INSERT OR REPLACE INTO human_photo_views(event_id,request_id,actor_type,actor_id,authorization_session_id,workspace_id,project_id,album_id,photo_id,version_id,viewed_at_ms,visible_for_ms) VALUES(?,?,'user',?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),1000)";
  for (const [eventId, requestId] of [
    [ownerRow.event_id, randomUUID()],
    [randomUUID(), ownerRow.request_id],
  ]) {
    await assert.rejects(
      db
        .prepare(duplicateInsert)
        .bind(
          eventId,
          requestId,
          owner,
          session,
          fixture.workspaceId,
          fixture.projectId,
          albumId,
          photoId,
          versionId,
        )
        .run(),
      /IMMUTABLE_HUMAN_PHOTO_VIEW/,
    );
  }
  const olderProjectionWitness =
    beforeProjection.view_event_id === ownerRow.event_id ? guestRow : ownerRow;
  await assert.rejects(
    db
      .prepare(
        'INSERT OR REPLACE INTO album_human_activity(album_id,workspace_id,project_id,last_valid_viewed_at_ms,view_event_id) VALUES(?,?,?,?,?)',
      )
      .bind(
        albumId,
        fixture.workspaceId,
        fixture.projectId,
        olderProjectionWitness.viewed_at_ms,
        olderProjectionWitness.event_id,
      )
      .run(),
    /HUMAN_ACTIVITY_WITNESS_REQUIRED/,
  );
  assert.deepEqual(await projection(), beforeProjection);
  const tieHigh = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
  const tieLow = '00000000-0000-4000-8000-000000000000';
  const tieGuests = [
    await fixture.createGuest(1),
    await fixture.createGuest(1),
  ];
  const countBeforeTies = await count('human_photo_views');
  await db
    .prepare(
      "INSERT INTO human_photo_views(event_id,request_id,actor_type,actor_id,authorization_session_id,workspace_id,project_id,album_id,photo_id,version_id,viewed_at_ms,visible_for_ms) SELECT ?,?,'guest',?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),1000 UNION ALL SELECT ?,?,'guest',?,?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER),1000",
    )
    .bind(
      tieHigh,
      randomUUID(),
      tieGuests[0].guestId,
      tieGuests[0].sessionId,
      fixture.workspaceId,
      fixture.projectId,
      albumId,
      photoId,
      versionId,
      tieLow,
      randomUUID(),
      tieGuests[1].guestId,
      tieGuests[1].sessionId,
      fixture.workspaceId,
      fixture.projectId,
      albumId,
      photoId,
      versionId,
    )
    .run();
  const ties = (
    await db
      .prepare('SELECT * FROM human_photo_views WHERE event_id IN(?,?)')
      .bind(tieHigh, tieLow)
      .all()
  ).results;
  assert.equal(ties.length, 2);
  assert.equal(ties[0].viewed_at_ms, ties[1].viewed_at_ms);
  assert.equal(await count('human_photo_views'), countBeforeTies + 2);
  const frontier = await projection();
  assert.equal(frontier.view_event_id, tieHigh);
  assert.equal(frontier.last_valid_viewed_at_ms, ties[0].viewed_at_ms);
  const tieAudits = await db
    .prepare(
      "SELECT count(*) AS n FROM audit_events WHERE action='gallery.viewed' AND event_id IN(?,?)",
    )
    .bind(tieHigh, tieLow)
    .first();
  assert.equal(tieAudits.n, 2);
  checks.push(
    'Native REPLACE cannot overwrite event/request IDs or regress activity; equal-millisecond views both persist with a stable maximal frontier',
  );
  const browserGuest = await fixture.createGuest(1);
  return {
    checks,
    browser: {
      albumId,
      photoId,
      versionId,
      projectId: fixture.projectId,
      guestCookie: browserGuest.cookie,
      ownerCookie: freshOwnerCookie,
    },
  };
}
