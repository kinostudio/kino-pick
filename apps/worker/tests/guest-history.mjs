import assert from 'node:assert/strict';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { runGuestHistoryBrowserChecks } from './guest-history-browser.mjs';

const historyPermission = 1024;
const sessionHash = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
const inviteHash = (token) =>
  createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + token)
    .digest('hex');

const historyActions = [
  'selection.added',
  'selection.removed',
  'selection.version_changed',
  'selection.submitted',
  'rating.set',
  'rating.cleared',
  'favorite.added',
  'favorite.removed',
  'tag.added',
  'tag.removed',
  'shared_selection.added',
  'shared_selection.removed',
  'shared_selection.version_changed',
  'shared_selection.submitted',
];

const iso = (time = Date.now()) => new Date(time).toISOString();
const decodeCursorClaims = (token) => {
  const [payload, signature, extra] = token.split('.');
  assert.ok(payload && signature && extra === undefined);
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
};

export async function guestHistoryChecks({
  db,
  mf,
  check,
  owner,
  base,
  galleryFixture,
  request,
}) {
  const fixtureWorkspaceId = galleryFixture.context.workspace.id;
  const fixtureProjectId = galleryFixture.context.project.id;
  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession, 'Expected a current Owner session');

  const enabled = await mf.getWorker('guest-history-test');
  let browserFixtureForUi;
  const route = (worker, path, guest, options = {}) => {
    const method = options.method || 'GET';
    const headers = { ...(options.headers || {}) };
    if (guest) headers.Cookie = 'kino_guest=' + guest.secret;
    if (method !== 'GET' && method !== 'HEAD') {
      if (!headers.Origin) headers.Origin = base;
      if (!headers['Content-Type'])
        headers['Content-Type'] = 'application/json';
    }
    return worker.fetch(
      new Request(new URL(path, base), {
        method,
        headers,
        body: options.body,
      }),
    );
  };
  const appRoute = (path, guest) =>
    request(path, {
      headers: guest ? { Cookie: 'kino_guest=' + guest.secret } : {},
    });
  const readActivity = (guest, worker = enabled, query = {}) => {
    const params = new URLSearchParams();
    if (query.albumId) params.set('albumId', query.albumId);
    if (query.photoId) params.set('photoId', query.photoId);
    if (query.cursor) params.set('cursor', query.cursor);
    const suffix = params.size ? '?' + params.toString() : '';
    return route(worker, '/api/guest/me/activity' + suffix, guest);
  };
  const json = async (response, status = 200) => {
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };

  const createAlbum = async (
    name,
    workspaceId = fixtureWorkspaceId,
    projectId = fixtureProjectId,
  ) => {
    const albumId = randomUUID();
    await db
      .prepare(
        "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
      )
      .bind(albumId, workspaceId, projectId, name)
      .run();
    return albumId;
  };
  const insertPhoto = async (
    name,
    albumId,
    workspaceId = fixtureWorkspaceId,
    projectId = fixtureProjectId,
    versions = 1,
  ) => {
    const photoId = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(photoId, workspaceId, projectId, albumId, name)
      .run();

    const versionIds = [];
    const firstVersionId = randomUUID();
    await db
      .prepare(
        "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
      )
      .bind(
        firstVersionId,
        workspaceId,
        photoId,
        owner,
        randomBytes(32).toString('hex'),
      )
      .run();
    versionIds.push(firstVersionId);

    // Additional history witnesses are siblings of the current V1 head. The
    // product supports explicit current-head switching, not artificial ancestry.
    for (let versionNo = 2; versionNo <= versions; versionNo++) {
      const version = await appendAuthorizedVersionFixture({
        db,
        owner,
        photoId,
        parentVersionId: firstVersionId,
        versionNo,
        sha256: randomBytes(32).toString('hex'),
        byteSize: 17,
        mime: 'image/jpeg',
        width: 10,
        height: 10,
      });
      versionIds.push(version.version_id);
    }
    return { photoId, versionId: versionIds.at(-1) ?? null, versionIds };
  };
  const insertTombstonePhoto = async (name, albumId) => {
    const photoId = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(photoId, fixtureWorkspaceId, fixtureProjectId, albumId, name)
      .run();
    return { photoId };
  };

  const albumId = await createAlbum('Guest history isolated album');
  const photo = await insertPhoto(
    'guest-history-private-source.jpg',
    albumId,
    fixtureWorkspaceId,
    fixtureProjectId,
    2,
  );
  const secondPhoto = await insertPhoto(
    'guest-history-filter-private.jpg',
    albumId,
  );
  const foreignAlbumId = await createAlbum(
    'Guest history sealed-scope exclusion',
  );
  const foreignAlbumPhoto = await insertPhoto(
    'guest-history-foreign-album-private.jpg',
    foreignAlbumId,
  );

  const foreignWorkspace = await db
    .prepare(
      'SELECT id FROM workspaces WHERE owner_user_id=? AND id<>? ORDER BY created_at,id LIMIT 1',
    )
    .bind(owner, fixtureWorkspaceId)
    .first();
  assert.ok(
    foreignWorkspace,
    'Expected an existing separate Owner workspace for tenant isolation',
  );
  const foreignWorkspaceId = foreignWorkspace.id;
  const createProject = async (workspaceId, name) => {
    const projectId = randomUUID();
    await db
      .prepare(
        "INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,'project.created',?,?,?)",
      )
      .bind(
        owner,
        randomUUID(),
        JSON.stringify({ workspaceId, name }),
        ownerSession.id,
        projectId,
      )
      .run();
    return projectId;
  };

  const foreignProjectId = await createProject(
    foreignWorkspaceId,
    'Guest history other tenant project',
  );
  const foreignTenantAlbumId = await createAlbum(
    'Guest history other tenant album',
    foreignWorkspaceId,
    foreignProjectId,
  );
  const foreignTenantPhoto = await insertPhoto(
    'guest-history-other-tenant-private.jpg',
    foreignTenantAlbumId,
    foreignWorkspaceId,
    foreignProjectId,
  );

  const createInvite = async (
    permissionsMask,
    targetAlbumId = albumId,
    targetWorkspaceId = fixtureWorkspaceId,
    targetProjectId = fixtureProjectId,
    lifetimeMs = 60 * 60 * 1000,
  ) => {
    const inviteId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + lifetimeMs;
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        targetWorkspaceId,
        targetProjectId,
        inviteHash(token),
        permissionsMask,
        expiresAt,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, targetWorkspaceId, targetProjectId, targetAlbumId)
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId)
      .run();
    return {
      inviteId,
      token,
      albumId: targetAlbumId,
      workspaceId: targetWorkspaceId,
      projectId: targetProjectId,
      expiresAt,
    };
  };
  const createSession = async (
    invite,
    guestId = randomUUID(),
    lifetimeMs = 10 * 60 * 1000,
  ) => {
    const exists = await db
      .prepare('SELECT id FROM guest_identities WHERE id=? AND invite_id=?')
      .bind(guestId, invite.inviteId)
      .first();
    if (!exists)
      await db
        .prepare(
          'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
        )
        .bind(guestId, invite.inviteId, 'Guest history fixture')
        .run();

    const id = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const secretHash = sessionHash(secret);
    const expiresAt = Math.min(invite.expiresAt, Date.now() + lifetimeMs);
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(id, invite.inviteId, guestId, secretHash, expiresAt)
      .run();
    return {
      id,
      inviteId: invite.inviteId,
      guestId,
      secret,
      secretHash,
      expiresAt,
      albumId: invite.albumId,
      workspaceId: invite.workspaceId,
      projectId: invite.projectId,
    };
  };
  const createGuest = async (
    permissionsMask,
    targetAlbumId = albumId,
    targetWorkspaceId = fixtureWorkspaceId,
    targetProjectId = fixtureProjectId,
    sessionLifetimeMs = 10 * 60 * 1000,
  ) => {
    const invite = await createInvite(
      permissionsMask,
      targetAlbumId,
      targetWorkspaceId,
      targetProjectId,
    );
    return {
      ...invite,
      ...(await createSession(invite, randomUUID(), sessionLifetimeMs)),
    };
  };
  const appendAudit = async ({
    guest,
    action,
    before,
    after,
    occurredAt = iso(),
    workspaceId = guest.workspaceId,
    projectId = guest.projectId,
    albumId: targetAlbumId = guest.albumId,
    photoId = null,
    versionId = null,
    actorId = guest.guestId,
    guestSessionId = guest.id,
    eventId = 'guest-history:' + randomUUID(),
    requestId = 'guest-history-request:' + randomUUID(),
  }) => {
    await db
      .prepare(
        'INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        eventId,
        'guest',
        actorId,
        guestSessionId,
        workspaceId,
        projectId,
        targetAlbumId,
        photoId,
        versionId,
        action,
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after),
        requestId,
        occurredAt,
      )
      .run();
    return { eventId, requestId };
  };

  const makePayload = (action, currentGuest, privateMarkers) => {
    const privateFields = {
      guestId: privateMarkers.otherGuestId,
      sessionId: privateMarkers.sessionId,
      requestId: privateMarkers.requestId,
      storageKey: privateMarkers.storageKey,
      objectKey: privateMarkers.objectKey,
      filename: privateMarkers.filename,
      url: privateMarkers.url,
      rawAuditMarker: privateMarkers.rawAuditMarker,
    };
    const extras = () => ({ ...privateFields });
    const add = (state) => ({ ...state, ...extras() });
    if (
      action.startsWith('selection.') ||
      action.startsWith('shared_selection.')
    ) {
      if (action.endsWith('.submitted')) {
        return {
          before: add({
            roundNo: 1,
            status: 'open',
            selectionRevision: 4,
          }),
          after: add({
            roundNo: 1,
            status: 'submitted',
            selectedCount: 1,
            submissionId: privateMarkers.submissionId,
            revision: 4,
          }),
          projected: {
            before: { roundNo: 1, status: 'open' },
            after: { roundNo: 1, status: 'submitted', selectedCount: 1 },
          },
        };
      }
      if (action.endsWith('.added')) {
        return {
          before: add({ selected: false, versionId: null, selectedAt: null }),
          after: add({
            selected: true,
            versionId: currentGuest.versionId,
            selectedAt: iso(),
          }),
          projected: {
            before: { selected: false, versionId: null },
            after: { selected: true, versionId: currentGuest.versionId },
          },
        };
      }
      if (action.endsWith('.removed')) {
        return {
          before: add({
            selected: true,
            versionId: currentGuest.versionId,
            selectedAt: iso(),
          }),
          after: add({ selected: false, versionId: null, selectedAt: null }),
          projected: {
            before: {
              selected: true,
              versionId: currentGuest.versionId,
            },
            after: { selected: false, versionId: null },
          },
        };
      }
      return {
        before: add({
          selected: true,
          versionId: currentGuest.previousVersionId,
          selectedAt: iso(),
        }),
        after: add({
          selected: true,
          versionId: currentGuest.versionId,
          selectedAt: iso(),
        }),
        projected: {
          before: {
            selected: true,
            versionId: currentGuest.previousVersionId,
          },
          after: { selected: true, versionId: currentGuest.versionId },
        },
      };
    }
    if (action.startsWith('rating.')) {
      const cleared = action === 'rating.cleared';
      return {
        before: add({
          photoId: currentGuest.photoId,
          stars: cleared ? 4 : null,
          versionId: currentGuest.versionId,
          updatedAt: iso(),
        }),
        after: add({
          photoId: currentGuest.photoId,
          stars: cleared ? null : 4,
          versionId: currentGuest.versionId,
          updatedAt: iso(),
        }),
        projected: {
          before: { stars: cleared ? 4 : null },
          after: { stars: cleared ? null : 4 },
        },
      };
    }
    if (action.startsWith('favorite.')) {
      const removed = action === 'favorite.removed';
      return {
        before: add({
          photoId: currentGuest.photoId,
          favored: removed,
          versionId: currentGuest.versionId,
          updatedAt: iso(),
        }),
        after: add({
          photoId: currentGuest.photoId,
          favored: !removed,
          versionId: currentGuest.versionId,
          updatedAt: iso(),
        }),
        projected: {
          before: { favored: removed },
          after: { favored: !removed },
        },
      };
    }
    if (action.startsWith('tag.')) {
      const removed = action === 'tag.removed';
      return {
        before: add({
          tagId: privateMarkers.tagId,
          label: 'Family',
          present: removed,
          versionId: currentGuest.versionId,
          updatedAt: iso(),
        }),
        after: add({
          tagId: privateMarkers.tagId,
          label: 'Family',
          present: !removed,
          versionId: currentGuest.versionId,
          updatedAt: iso(),
        }),
        projected: {
          before: { label: 'Family', present: removed },
          after: { label: 'Family', present: !removed },
        },
      };
    }
    throw new Error('Unsupported Guest history action: ' + action);
  };

  const seedActions = async (guest, targetPhoto, occurredAt = iso()) => {
    const seeded = [];
    const privateValues = [];
    for (const action of historyActions) {
      const privateMarkers = {
        otherGuestId: randomUUID(),
        sessionId: 'private-session-' + randomUUID(),
        requestId: 'private-request-' + randomUUID(),
        storageKey: 'private-storage-' + randomUUID(),
        objectKey: 'private-object-' + randomUUID(),
        filename: 'private-filename-' + randomUUID(),
        url: 'https://private.invalid/' + randomUUID(),
        rawAuditMarker: 'private-raw-audit-' + randomUUID(),
        submissionId: 'private-submission-' + randomUUID(),
        tagId: randomUUID(),
      };
      const payload = makePayload(
        action,
        {
          ...guest,
          photoId: targetPhoto.photoId,
          versionId: targetPhoto.versionId,
          previousVersionId: targetPhoto.versionIds?.[0],
        },
        privateMarkers,
      );
      const isSubmission = action.endsWith('.submitted');
      const row = await appendAudit({
        guest,
        action,
        before: payload.before,
        after: payload.after,
        occurredAt,
        photoId: isSubmission ? null : targetPhoto.photoId,
        versionId: isSubmission ? null : targetPhoto.versionId,
        requestId: privateMarkers.requestId,
      });
      seeded.push({
        ...row,
        action,
        isSubmission,
        projected: payload.projected,
      });
      privateValues.push(...Object.values(privateMarkers));
    }
    return { seeded, privateValues };
  };

  const waitUntil = async (time) => {
    const delay = time - Date.now() + 10;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  };

  await check(
    'Guest activity capability is independent of photo view and supports authorized empty history',
    async () => {
      assert.deepEqual(
        await json(await appRoute('/api/guest/history/capabilities')),
        { enabled: false },
      );
      assert.deepEqual(
        await json(
          await route(enabled, '/api/guest/history/capabilities', null),
        ),
        { enabled: true },
      );

      const guest = await createGuest(historyPermission);
      const permission = await db
        .prepare(
          'SELECT permissions_mask FROM guest_invites WHERE id=? AND workspace_id=? AND project_id=?',
        )
        .bind(guest.inviteId, guest.workspaceId, guest.projectId)
        .first();
      assert.equal(permission.permissions_mask, historyPermission);
      assert.deepEqual(await json(await readActivity(guest)), {
        guestId: guest.guestId,
        items: [],
        nextCursor: null,
      });

      const viewOnly = await createGuest(1);
      const denied = await readActivity(viewOnly);
      assert.equal(denied.status, 401);
      const deniedText = await denied.text();
      assert.equal(deniedText.includes(viewOnly.guestId), false);
    },
  );

  await check(
    'Guest own history projects all fourteen allowlisted actions and removes private audit fields',
    async () => {
      const invite = await createInvite(historyPermission);
      const guestId = randomUUID();
      const historical = await createSession(invite, guestId, 1500);
      const markerGuest = randomUUID();
      const target = {
        ...historical,
        ...photo,
        photoId: photo.photoId,
        versionId: photo.versionId,
        previousVersionId: photo.versionIds[0],
      };
      const occurredAt = iso(Date.now() - 5000);
      const { seeded, privateValues } = await seedActions(
        target,
        target,
        occurredAt,
      );
      await waitUntil(historical.expiresAt ?? Date.now() + 1500);
      const current = await createSession(invite, guestId);
      const page = await json(await readActivity(current));
      assert.equal(page.guestId, guestId);
      assert.equal(page.items.length, historyActions.length);
      assert.equal(page.nextCursor, null);

      const byAction = new Map(
        page.items.map((event) => [event.action, event]),
      );
      assert.deepEqual([...byAction.keys()].sort(), [...historyActions].sort());
      assert.deepEqual(
        [...byAction.values()].map((event) => event.eventId).sort(),
        seeded.map((event) => event.eventId).sort(),
      );

      for (const expected of seeded) {
        const event = byAction.get(expected.action);
        assert.ok(event);
        assert.equal(event.albumId, albumId);
        assert.equal(
          event.photoStatus,
          expected.isSubmission ? null : 'available',
        );
        assert.equal(
          event.photoId,
          expected.isSubmission ? null : photo.photoId,
        );
        assert.equal(
          event.versionId,
          expected.isSubmission ? null : photo.versionId,
        );
        assert.deepEqual(event.detail, expected.projected);
        assert.deepEqual(
          Object.keys(event).sort(),
          [
            'action',
            'albumId',
            'detail',
            'eventId',
            'occurredAt',
            'photoId',
            'photoStatus',
            'versionId',
          ].sort(),
        );
      }

      const responseText = JSON.stringify(page);
      for (const privateKey of [
        'sessionId',
        'guestSessionId',
        'requestId',
        'storageKey',
        'objectKey',
        'filename',
        'url',
        'rawAuditMarker',
        'beforeJson',
        'afterJson',
        'submissionId',
        'tagId',
        'reviewId',
        'otherGuestId',
      ])
        assert.equal(responseText.includes(privateKey), false, privateKey);
      for (const value of privateValues)
        assert.equal(
          responseText.includes(String(value)),
          false,
          String(value),
        );
      assert.equal(responseText.includes(historical.id), false);
      assert.equal(responseText.includes(historical.secret), false);
      assert.equal(responseText.includes(historical.secretHash), false);
      assert.equal(responseText.includes(current.id), false);
      assert.equal(responseText.includes(current.secret), false);
      assert.equal(responseText.includes(current.secretHash), false);
      assert.notEqual(markerGuest, guestId);
    },
  );

  await check(
    'Guest history stays within the current Guest, sealed invite albums, project, and tenant',
    async () => {
      const guest = await createGuest(historyPermission, albumId);
      const otherInviteGuest = await createGuest(historyPermission, albumId);
      const own = await appendAudit({
        guest,
        action: 'favorite.added',
        before: { favored: false },
        after: { favored: true },
        photoId: photo.photoId,
        versionId: photo.versionId,
      });
      const otherInvite = await appendAudit({
        guest: otherInviteGuest,
        action: 'favorite.added',
        before: { favored: false },
        after: { favored: true },
        photoId: photo.photoId,
        versionId: photo.versionId,
      });
      const outsideAlbum = await appendAudit({
        guest,
        action: 'tag.added',
        before: { label: 'Scope', present: false },
        after: { label: 'Scope', present: true },
        albumId: foreignAlbumId,
        photoId: foreignAlbumPhoto.photoId,
        versionId: foreignAlbumPhoto.versionId,
      });
      const outsideTenant = await appendAudit({
        guest,
        action: 'rating.set',
        before: { stars: null },
        after: { stars: 5 },
        workspaceId: foreignWorkspaceId,
        projectId: foreignProjectId,
        albumId: foreignTenantAlbumId,
        photoId: foreignTenantPhoto.photoId,
        versionId: foreignTenantPhoto.versionId,
      });
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_invite_albums WHERE invite_id=?',
            )
            .bind(guest.inviteId)
            .first()
        ).n,
        1,
      );
      assert.ok(
        await db
          .prepare('SELECT invite_id FROM guest_invite_seals WHERE invite_id=?')
          .bind(guest.inviteId)
          .first(),
      );

      const page = await json(await readActivity(guest));
      assert.deepEqual(
        page.items.map((event) => event.eventId),
        [own.eventId],
      );
      assert.equal(page.items[0].albumId, albumId);
      const bodyText = JSON.stringify(page);
      for (const privateId of [
        otherInviteGuest.guestId,
        otherInvite.eventId,
        outsideAlbum.eventId,
        outsideTenant.eventId,
      ])
        assert.equal(bodyText.includes(privateId), false, privateId);

      const outOfScope = await readActivity(guest, enabled, {
        albumId: foreignAlbumId,
      });
      assert.ok([400, 401].includes(outOfScope.status));
      const outOfScopeText = await outOfScope.text();
      assert.equal(outOfScopeText.includes(foreignAlbumPhoto.photoId), false);
      assert.equal(outOfScopeText.includes(foreignAlbumPhoto.versionId), false);
    },
  );

  await check(
    'Guest history cursors order timestamp ties, reject tampering and filter changes, bind the cookie, and exclude late appends',
    async () => {
      const guest = await createGuest(historyPermission);
      const otherCookie = await createGuest(historyPermission);
      browserFixtureForUi = { guest, secondGuest: otherCookie };
      const at = iso(Date.now() - 10000);
      const expectedIds = [];
      for (let index = 0; index < 30; index++) {
        const eventId =
          'guest-history-page-' +
          guest.guestId +
          '-' +
          String(index).padStart(3, '0');
        await appendAudit({
          guest,
          action: index % 2 === 0 ? 'favorite.added' : 'favorite.removed',
          before: { favored: index % 2 === 1 },
          after: { favored: index % 2 === 0 },
          occurredAt: at,
          photoId: index % 2 === 0 ? photo.photoId : secondPhoto.photoId,
          versionId: index % 2 === 0 ? photo.versionId : secondPhoto.versionId,
          eventId,
        });
        expectedIds.push(eventId);
      }

      const first = await json(await readActivity(guest, enabled, { albumId }));
      assert.equal(first.items.length, 24);
      assert.equal(typeof first.nextCursor, 'string');
      assert.ok(first.nextCursor.length > 0);
      const firstClaims = decodeCursorClaims(first.nextCursor);
      const firstClaimsJson = JSON.stringify(firstClaims);
      assert.deepEqual(
        Object.keys(firstClaims).sort(),
        [
          'expiresAt',
          'guestId',
          'issuedAt',
          'lastEventId',
          'lastOccurredAt',
          'scopeHash',
          'snapshotRowId',
          'version',
        ].sort(),
      );
      assert.equal(firstClaims.guestId, guest.guestId);
      assert.match(firstClaims.scopeHash, /^[a-f0-9]{64}$/);
      assert.equal(firstClaims.expiresAt - firstClaims.issuedAt, 15 * 60);
      for (const privateScopeValue of [
        guest.inviteId,
        guest.workspaceId,
        guest.projectId,
      ])
        assert.equal(firstClaimsJson.includes(privateScopeValue), false);
      assert.deepEqual(
        first.items.map((event) => event.eventId),
        expectedIds.slice().sort().reverse().slice(0, 24),
      );
      assert.ok(
        first.items.every((event) => event.occurredAt === at),
        'All fixture events intentionally share one timestamp',
      );

      const filtered = await json(
        await readActivity(guest, enabled, { albumId, photoId: photo.photoId }),
      );
      assert.equal(filtered.items.length, 15);
      assert.ok(
        filtered.items.every((event) => event.photoId === photo.photoId),
      );
      const noAlbumFilter = await readActivity(guest, enabled, {
        photoId: photo.photoId,
      });
      assert.equal(noAlbumFilter.status, 400);
      const tampered = await readActivity(guest, enabled, {
        albumId,
        cursor: first.nextCursor + 'x',
      });
      assert.equal(tampered.status, 400);
      const changedFilter = await readActivity(guest, enabled, {
        albumId,
        photoId: photo.photoId,
        cursor: first.nextCursor,
      });
      assert.equal(changedFilter.status, 400);
      const switchedCookie = await readActivity(otherCookie, enabled, {
        albumId,
        cursor: first.nextCursor,
      });
      assert.ok([400, 401].includes(switchedCookie.status));

      const lateId = 'guest-history-late-backdated-' + randomUUID();
      const lateTime = iso(Date.now() - 24 * 60 * 60 * 1000);
      await appendAudit({
        guest,
        action: 'favorite.added',
        before: { favored: false },
        after: { favored: true },
        occurredAt: lateTime,
        photoId: photo.photoId,
        versionId: photo.versionId,
        eventId: lateId,
      });

      const second = await json(
        await readActivity(guest, enabled, {
          albumId,
          cursor: first.nextCursor,
        }),
      );
      assert.equal(second.items.length, 6);
      assert.equal(second.nextCursor, null);
      assert.equal(
        second.items.some((event) => event.eventId === lateId),
        false,
      );
      const allIds = [
        ...first.items.map((event) => event.eventId),
        ...second.items.map((event) => event.eventId),
      ];
      assert.equal(new Set(allIds).size, 30);
      assert.deepEqual(allIds, expectedIds.slice().sort().reverse());

      const threePageGuest = await createGuest(historyPermission);
      const threePageIds = [];
      const threePageTime = iso(Date.now() - 20000);
      for (let index = 0; index < 55; index++) {
        const eventId =
          'guest-history-three-page-' +
          threePageGuest.guestId +
          '-' +
          String(index).padStart(3, '0');
        await appendAudit({
          guest: threePageGuest,
          action: index % 2 === 0 ? 'favorite.added' : 'favorite.removed',
          before: { favored: index % 2 === 1 },
          after: { favored: index % 2 === 0 },
          occurredAt: threePageTime,
          photoId: photo.photoId,
          versionId: photo.versionId,
          eventId,
        });
        threePageIds.push(eventId);
      }
      const pageOne = await json(
        await readActivity(threePageGuest, enabled, { albumId }),
      );
      const pageOneClaims = decodeCursorClaims(pageOne.nextCursor);
      assert.equal(pageOne.items.length, 24);
      const pageTwo = await json(
        await readActivity(threePageGuest, enabled, {
          albumId,
          cursor: pageOne.nextCursor,
        }),
      );
      const pageTwoClaims = decodeCursorClaims(pageTwo.nextCursor);
      assert.equal(pageTwo.items.length, 24);
      assert.equal(pageTwoClaims.issuedAt, pageOneClaims.issuedAt);
      assert.equal(pageTwoClaims.expiresAt, pageOneClaims.expiresAt);
      assert.equal(pageTwoClaims.snapshotRowId, pageOneClaims.snapshotRowId);
      const pageThree = await json(
        await readActivity(threePageGuest, enabled, {
          albumId,
          cursor: pageTwo.nextCursor,
        }),
      );
      assert.equal(pageThree.items.length, 7);
      assert.equal(pageThree.nextCursor, null);
      const threePageResultIds = [
        ...pageOne.items.map((event) => event.eventId),
        ...pageTwo.items.map((event) => event.eventId),
        ...pageThree.items.map((event) => event.eventId),
      ];
      assert.equal(new Set(threePageResultIds).size, 55);
      assert.deepEqual(
        threePageResultIds,
        threePageIds.slice().sort().reverse(),
      );
    },
  );

  await check(
    'Guest history returns a generic unavailable marker for deleted photos and requires an own event witness',
    async () => {
      const guest = await createGuest(historyPermission);
      const otherGuest = await createGuest(historyPermission);
      const missing = await insertTombstonePhoto(
        'guest-history-tombstone-secret-filename.jpg',
        albumId,
      );
      const otherMissing = await insertTombstonePhoto(
        'guest-history-other-tombstone-secret-filename.jpg',
        albumId,
      );
      const event = await appendAudit({
        guest,
        action: 'rating.set',
        before: {
          photoId: missing.photoId,
          stars: null,
          versionId: null,
          updatedAt: null,
        },
        after: {
          photoId: missing.photoId,
          stars: 3,
          versionId: null,
          updatedAt: iso(),
        },
        photoId: missing.photoId,
        versionId: null,
      });
      const otherGuestEvent = await appendAudit({
        guest: otherGuest,
        action: 'favorite.added',
        before: {
          photoId: otherMissing.photoId,
          favored: false,
          versionId: null,
          updatedAt: null,
        },
        after: {
          photoId: otherMissing.photoId,
          favored: true,
          versionId: null,
          updatedAt: iso(),
        },
        photoId: otherMissing.photoId,
        versionId: null,
      });

      await db
        .prepare(
          'DELETE FROM photos WHERE id=? AND workspace_id=? AND project_id=? AND album_id=?',
        )
        .bind(missing.photoId, fixtureWorkspaceId, fixtureProjectId, albumId)
        .run();
      await db
        .prepare(
          'DELETE FROM photos WHERE id=? AND workspace_id=? AND project_id=? AND album_id=?',
        )
        .bind(
          otherMissing.photoId,
          fixtureWorkspaceId,
          fixtureProjectId,
          albumId,
        )
        .run();
      for (const deletedPhoto of [missing, otherMissing])
        assert.equal(
          (
            await db
              .prepare('SELECT count(*) AS n FROM photos WHERE id=?')
              .bind(deletedPhoto.photoId)
              .first()
          ).n,
          0,
        );

      const page = await json(
        await readActivity(guest, enabled, {
          albumId,
          photoId: missing.photoId,
        }),
      );
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].eventId, event.eventId);
      assert.equal(page.items[0].photoId, missing.photoId);
      assert.equal(page.items[0].photoStatus, 'unavailable');
      assert.equal(page.items[0].versionId, null);
      assert.deepEqual(page.items[0].detail, {
        before: { stars: null },
        after: { stars: 3 },
      });
      const text = JSON.stringify(page);
      assert.equal(
        text.includes('guest-history-tombstone-secret-filename.jpg'),
        false,
      );
      assert.equal(text.includes('filename'), false);

      for (const unownedPhotoId of [randomUUID(), otherMissing.photoId]) {
        const denied = await readActivity(guest, enabled, {
          albumId,
          photoId: unownedPhotoId,
        });
        assert.equal(denied.status, 401);
      }
      assert.equal(text.includes(otherGuest.guestId), false);
      assert.equal(text.includes(otherGuestEvent.eventId), false);
    },
  );

  await check(
    'Guest history denies expired and revoked current sessions but retains prior expired-session events',
    async () => {
      const expiredCurrent = await createGuest(
        historyPermission,
        albumId,
        fixtureWorkspaceId,
        fixtureProjectId,
        500,
      );
      await waitUntil(expiredCurrent.expiresAt);
      const expiredResponse = await readActivity(expiredCurrent);
      assert.equal(expiredResponse.status, 401);

      const revokedCurrent = await createGuest(historyPermission);
      await db
        .prepare(
          'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
        )
        .bind(revokedCurrent.id, revokedCurrent.secretHash)
        .run();
      const revokedResponse = await readActivity(revokedCurrent);
      assert.equal(revokedResponse.status, 401);
    },
  );

  await check(
    'Guest history fails closed on a malformed allowlisted audit projection',
    async () => {
      const guest = await createGuest(historyPermission);
      await appendAudit({
        guest,
        action: 'rating.set',
        before: {
          photoId: photo.photoId,
          stars: null,
          versionId: photo.versionId,
        },
        after: {
          photoId: photo.photoId,
          stars: 'not-a-rating',
          versionId: photo.versionId,
        },
        photoId: photo.photoId,
        versionId: photo.versionId,
      });
      const response = await readActivity(guest);
      const body = await response.text();
      assert.equal(response.status, 503, body);
      assert.equal(body.includes('not-a-rating'), false);
    },
  );

  await check(
    'Guest activity stays default-off on the application worker',
    async () => {
      assert.deepEqual(
        await json(await appRoute('/api/guest/history/capabilities')),
        { enabled: false },
      );
      const guest = await createGuest(historyPermission);
      const response = await appRoute('/api/guest/me/activity', guest);
      assert.equal(response.status, 503);
    },
  );

  await check(
    'Guest history browser pages bind the enabled entry link to the independent permission',
    async () => {
      assert.ok(browserFixtureForUi);
      const visibleGuest = await createGuest(historyPermission | 1);
      await appendAudit({
        guest: visibleGuest,
        action: 'favorite.added',
        before: { favored: false },
        after: { favored: true },
        photoId: photo.photoId,
        versionId: photo.versionId,
      });
      const viewOnlyGuest = await createGuest(1);
      const disabledWorker = await mf.getWorker('guest-feedback-test');
      await runGuestHistoryBrowserChecks({
        worker: enabled,
        disabledWorker,
        baseUrl: base,
        albumId,
        db,
        guest: {
          guestId: browserFixtureForUi.guest.guestId,
          secret: browserFixtureForUi.guest.secret,
          sessionId: browserFixtureForUi.guest.id,
        },
        secondGuest: {
          guestId: browserFixtureForUi.secondGuest.guestId,
          secret: browserFixtureForUi.secondGuest.secret,
        },
        visibleGuest: {
          guestId: visibleGuest.guestId,
          secret: visibleGuest.secret,
        },
        viewOnlyGuest: {
          guestId: viewOnlyGuest.guestId,
          secret: viewOnlyGuest.secret,
        },
      });
    },
  );
}
