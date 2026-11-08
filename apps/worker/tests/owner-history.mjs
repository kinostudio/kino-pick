import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { ownerHistoryPageSchema } from '../../../packages/contracts/src/owner-history.ts';

const PAGE_SIZE = 24;
const PRIVATE_MARKER = 'owner-history-private-';
const PROJECTED_SOURCE_ACTIONS = new Set(
  `
owner.bootstrapped
owner.signed_in
owner.session_revoked
workspace.created
project.created
project.renamed
project.archived
project.restored
project.versioning_mode_changed
album.created
album.renamed
album.protection_changed
album.retention_policy_changed
album.archived
album.restored
upload.reserved
upload.authorized
upload.completed
upload.cancelled
upload.expired
upload.capability_fenced
upload.needs_review
owner.external_intent_claimed
processing.enqueued
processing.running
processing.retryable
processing.needs_review
processing.succeeded
processing.abandoned
photo.version.created
photo.version_current_changed
share.created
share.scope_sealed
share.revoked
guest.session_created
guest.session_revoked
security.kdf_acquired
security.kdf_released
security.guest_kdf_acquired
security.guest_kdf_released
selection.added
selection.removed
selection.version_changed
selection.submitted
selection.reopened
selection.round_initialized
selection.policy_changed
selection.policy_configuration_changed
rating.set
rating.cleared
favorite.added
favorite.removed
tag.added
tag.removed
shared_review.created
shared_review.reopened
shared_selection.added
shared_selection.removed
shared_selection.version_changed
shared_selection.submitted
comment.create
comment.edit
comment.delete
comment.resolve
comment.reopen
owner.comment_reply_created
owner.comment_reply_edited
owner.comment_reply_deleted
owner.comment_processing_changed
annotation.created
annotation.updated
annotation.deleted
annotation.resolved
annotation.reopened
owner.annotation_created
owner.annotation_updated
owner.annotation_deleted
owner.annotation_resolved
owner.annotation_reopened
owner.annotation_processing_changed
download.requested
download.generated
`
    .trim()
    .split(/\s+/),
);

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function queryString(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (!value.length) params.append(key, '');
      else for (const item of value) params.append(key, String(item));
    } else params.append(key, String(value));
  }
  const text = params.toString();
  return text ? '?' + text : '';
}

function nextMillisecond(timestamp) {
  return new Date(Date.parse(timestamp) + 1).toISOString();
}

function assertNoSensitiveDetailKeys(value) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveDetailKeys(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(
      /password|secret|token|authorization|credential|sha.?256|object[_-]?key|presigned/i.test(
        key,
      ),
      false,
      'sensitive history detail key was projected: ' + key,
    );
    assertNoSensitiveDetailKeys(child);
  }
}

function assertProjectedSubset(projected, raw, path = 'details') {
  if (projected === null || typeof projected !== 'object') {
    assert.equal(projected, raw, 'projected value changed at ' + path);
    return;
  }

  assert.ok(
    raw !== null && typeof raw === 'object',
    path + ' source must be an object',
  );
  if (Array.isArray(projected)) {
    assert.ok(Array.isArray(raw), path + ' source must be an array');
    assert.equal(projected.length, raw.length, path + ' array length changed');
    for (let index = 0; index < projected.length; index++)
      assertProjectedSubset(
        projected[index],
        raw[index],
        path + '[' + index + ']',
      );
    return;
  }

  assert.equal(Array.isArray(raw), false, path + ' source must be an object');
  for (const [key, value] of Object.entries(projected)) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(raw, key),
      true,
      'projected key is absent from source at ' + path + '.' + key,
    );
    assertProjectedSubset(value, raw[key], path + '.' + key);
  }
}

function signHistoryClaims(claims, secret) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update('kino-pic:owner-history:v1:' + payload)
    .digest('base64url');
  return payload + '.' + signature;
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split('\r\n').filter(Boolean)) {
    const row = [];
    let field = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quoted) {
        if (char === '"') {
          if (line[index + 1] === '"') {
            field += '"';
            index++;
          } else quoted = false;
        } else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') {
        row.push(field);
        field = '';
      } else field += char;
    }
    assert.equal(quoted, false, 'CSV row ended inside a quoted field');
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cookieName(cookieHeader) {
  const pair = String(cookieHeader)
    .split(';')
    .map((part) => part.trim())
    .find((part) =>
      part.slice(0, part.indexOf('=')).endsWith('.session_token'),
    );
  assert.ok(pair, 'Owner session cookie must be present');
  return pair.slice(0, pair.indexOf('='));
}

export async function runOwnerHistoryChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  authSecret,
  annotationFixture,
}) {
  let fixture = annotationFixture;
  if (fixture?.createBrowserFixture && !fixture.workspaceId)
    fixture = await fixture.createBrowserFixture();

  assert.ok(fixture?.workspaceId && fixture?.projectId);
  assert.ok(fixture?.albumId && fixture?.photoId && fixture?.versionId);
  assert.equal(typeof check, 'function');
  assert.equal(typeof cookies?.headers, 'function');
  assert.equal(typeof authSecret, 'string');
  assert.ok(authSecret.length >= 32);

  const worker = await mf.getWorker('owner-history-test');
  const streamWorker = await mf.getWorker('owner-history-stream-test');
  const defaultWorker = await mf.getWorker('app');
  const guestWorker = await mf.getWorker(
    fixture.workerName ?? 'guest-annotations-test',
  );
  const ownerCookie = cookies.headers();
  const cookieToken = cookies.values?.get?.('kino-owner.session_token');
  assert.ok(cookieToken);
  const rawCookieToken = decodeURIComponent(cookieToken).split('.')[0];
  const activeSession = await db
    .prepare(
      'SELECT id,expiresAt FROM owner_sessions WHERE token=? AND userId=?',
    )
    .bind(rawCookieToken, owner)
    .first();
  assert.ok(activeSession?.id);

  const origin = new URL(base).origin;
  const historyPath = (workspaceId, filters = {}) =>
    '/api/v1/workspaces/' + workspaceId + '/history' + queryString(filters);
  const exportPath = (workspaceId) =>
    '/api/v1/workspaces/' + workspaceId + '/history/export';

  const ownerSend = (
    targetWorker,
    path,
    {
      method = 'GET',
      body,
      rawBody = false,
      cookie = ownerCookie,
      includeCookie = true,
      originHeader = origin,
      contentType = 'application/json',
      expectedActor = owner,
      extraHeaders = {},
    } = {},
  ) => {
    const headers = { Accept: 'application/json' };
    if (includeCookie && cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') {
      if (originHeader !== null) headers.Origin = originHeader;
      if (contentType !== null) headers['Content-Type'] = contentType;
    }
    if (expectedActor !== null)
      headers['X-Kino-Expected-Actor'] = expectedActor;
    Object.assign(headers, extraHeaders);
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined)
      init.body = rawBody ? String(body) : JSON.stringify(body);
    return targetWorker.fetch(new Request(new URL(path, base), init));
  };

  const guestSend = (path, secret, body) => {
    const cookieName =
      new URL(base).protocol === 'https:' ? '__Host-kino_guest' : 'kino_guest';
    return guestWorker.fetch(
      new Request(new URL(path, base), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: cookieName + '=' + secret,
        },
        body: JSON.stringify(body),
        redirect: 'manual',
      }),
    );
  };

  const readValue = async (response) => parseJson(await response.text());
  const expectError = async (response, status, code) => {
    const value = await readValue(response);
    assert.equal(
      response.status,
      status,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
    assert.equal(value?.error?.code, code);
    return value;
  };

  const readPage = async (
    workspaceId,
    filters = {},
    { targetWorker = worker, cookie = ownerCookie } = {},
  ) => {
    const response = await ownerSend(
      targetWorker,
      historyPath(workspaceId, filters),
      { cookie },
    );
    const value = await readValue(response);
    assert.equal(
      response.status,
      200,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
    return ownerHistoryPageSchema.parse(value);
  };

  const readAllPages = async (
    workspaceId,
    filters = {},
    { targetWorker = worker, cookie = ownerCookie } = {},
  ) => {
    const pages = [];
    const items = [];
    let cursor;
    let snapshotToken;
    for (let index = 0; index < 100; index++) {
      const query = { ...filters };
      if (cursor) query.cursor = cursor;
      const page = await readPage(workspaceId, query, { targetWorker, cookie });
      if (snapshotToken === undefined) snapshotToken = page.snapshotToken;
      else assert.equal(page.snapshotToken, snapshotToken);
      pages.push(page);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (!cursor) return { pages, items, snapshotToken };
    }
    assert.fail('Owner history pagination exceeded its guard');
  };

  const exportRequest = (workspaceId, body, options = {}) =>
    ownerSend(worker, exportPath(workspaceId), {
      method: 'POST',
      body,
      ...options,
    });

  const streamHarnessRequest = async (operation, snapshotToken) => {
    const response = await streamWorker.fetch(
      new Request(new URL('/test-owner-history-stream/' + operation, base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: owner,
          sessionId: activeSession.id,
          workspaceId: fixture.workspaceId,
          snapshotToken,
        }),
      }),
    );
    const value = await readValue(response);
    assert.equal(
      response.status,
      200,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
    assert.deepEqual(Object.keys(value ?? {}).sort(), [
      'completedCount',
      'generationId',
      'interrupted',
      'startedCount',
    ]);
    assert.match(
      value.generationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    assert.equal(typeof value.interrupted, 'boolean');
    assert.equal(typeof value.startedCount, 'number');
    assert.equal(typeof value.completedCount, 'number');
    return value;
  };

  const generationAuditCounts = async (generationId) => {
    const rows = await db
      .prepare(
        "SELECT action,count(*) AS count FROM audit_events WHERE request_id=? AND actor_type='user' AND actor_id=? AND session_id=? AND workspace_id=? AND action IN('owner_history.export_started','owner_history.export_completed') GROUP BY action",
      )
      .bind(generationId, owner, activeSession.id, fixture.workspaceId)
      .all();
    const counts = new Map(
      rows.results.map((row) => [row.action, Number(row.count)]),
    );
    return {
      startedCount: counts.get('owner_history.export_started') ?? 0,
      completedCount: counts.get('owner_history.export_completed') ?? 0,
    };
  };

  const insertAudit = async (options) => {
    const row = {
      eventId: randomUUID(),
      actorType: 'user',
      actorId: owner,
      guestSessionId: null,
      sessionId: activeSession.id,
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      albumId: fixture.albumId,
      photoId: fixture.photoId,
      versionId: fixture.versionId,
      beforeJson: null,
      afterJson: null,
      requestId: randomUUID(),
      occurredAt: '2020-01-02T03:04:05.006Z',
      ...options,
    };
    await db
      .prepare(
        'INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,action,before_json,after_json,request_id,occurred_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        row.eventId,
        row.actorType,
        row.actorId,
        row.guestSessionId,
        row.sessionId,
        row.workspaceId,
        row.projectId,
        row.albumId,
        row.photoId,
        row.versionId,
        row.action,
        row.beforeJson,
        row.afterJson,
        row.requestId,
        row.occurredAt,
      )
      .run();
    return row.eventId;
  };

  const auditCounts = async () => {
    const row = await db
      .prepare(
        "SELECT count(*) AS total,sum(CASE WHEN action='retention.dry_run_observed' THEN 1 ELSE 0 END) AS retention FROM audit_events",
      )
      .first();
    return {
      total: Number(row?.total ?? 0),
      retention: Number(row?.retention ?? 0),
    };
  };

  const readEventForRow = async (row, cookie = ownerCookie) => {
    const filters = {
      action: row.action,
      from: row.occurred_at_utc,
      to: nextMillisecond(row.occurred_at_utc),
    };
    for (const [filterName, columnName] of [
      ['projectId', 'project_id'],
      ['albumId', 'album_id'],
      ['photoId', 'photo_id'],
      ['versionId', 'version_id'],
      ['actorType', 'actor_type'],
      ['actorId', 'actor_id'],
    ]) {
      const value = row[columnName];
      if (value !== null && value !== undefined) filters[filterName] = value;
    }
    const result = await readAllPages(row.workspace_id, filters, { cookie });
    const event = result.items.find((item) => item.eventId === row.event_id);
    assert.ok(event, 'history omitted source event ' + row.event_id);
    return event;
  };

  const assertEnvelopeMatchesAudit = async (event, row) => {
    assert.equal(event.eventId, row.event_id);
    assert.equal(event.occurredAt, row.occurred_at_utc);
    assert.equal(event.actor.type, row.actor_type);
    assert.equal(event.actor.id, row.actor_id);
    assert.equal(event.workspaceId, row.workspace_id);
    assert.equal(event.projectId, row.project_id);
    assert.equal(event.albumId, row.album_id);
    assert.equal(event.photoId, row.photo_id);
    assert.equal(event.versionId, row.version_id);
    assert.equal(event.sessionId, row.session_id);
    assert.equal(event.guestSessionId, row.guest_session_id);
    assert.equal(event.requestId, row.request_id);
    assert.equal(event.action, row.action);
    assert.ok(
      ['available', 'omitted', 'invalid'].includes(event.details.status),
    );

    if (event.details.status === 'available') {
      for (const [side, column] of [
        ['before', 'before_json'],
        ['after', 'after_json'],
      ]) {
        const projected = event.details[side];
        if (projected === null) continue;
        const raw = JSON.parse(row[column]);
        assertProjectedSubset(projected, raw, side);
        assertNoSensitiveDetailKeys(projected);
      }
    } else {
      assert.equal(event.details.before, null);
      assert.equal(event.details.after, null);
    }

    if (row.actor_type === 'user') {
      const identity = await db
        .prepare('SELECT name FROM users WHERE id=?')
        .bind(row.actor_id)
        .first();
      assert.equal(event.actor.label, identity?.name ?? null);
    } else if (row.actor_type === 'guest' && event.inviteId !== null) {
      const identity = await db
        .prepare('SELECT display_name FROM guest_identities WHERE id=?')
        .bind(row.actor_id)
        .first();
      assert.equal(event.actor.label, identity?.display_name ?? null);
    }
  };

  await check(
    'Owner history is default-off, authenticates the current Owner, and rejects invalid route inputs',
    async () => {
      const disabled = await readValue(
        await ownerSend(defaultWorker, '/api/v1/owner-history/capabilities'),
      );
      const enabled = await readValue(
        await ownerSend(worker, '/api/v1/owner-history/capabilities'),
      );
      assert.deepEqual(disabled, { enabled: false });
      assert.deepEqual(enabled, { enabled: true });

      await expectError(
        await ownerSend(defaultWorker, historyPath(fixture.workspaceId)),
        503,
        'OWNER_HISTORY_DISABLED',
      );
      await expectError(
        await ownerSend(worker, historyPath(fixture.workspaceId), {
          includeCookie: false,
        }),
        401,
        'AUTH_REQUIRED',
      );
      await expectError(
        await ownerSend(worker, historyPath(fixture.workspaceId), {
          expectedActor: '00000000-0000-4000-8000-ffffffffffff',
        }),
        409,
        'OWNER_IDENTITY_CHANGED',
      );
      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId) + '?action=alpha&action=beta',
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(worker, historyPath(fixture.workspaceId) + '?limit=24'),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(worker, '/api/v1/owner-history/capabilities?extra=1'),
        400,
        'INVALID_INPUT',
      );
      const hostileOriginResponse = await exportRequest(
        fixture.workspaceId,
        { expectedOwnerId: owner, snapshotToken: 'unused', format: 'json' },
        { originHeader: 'https://attacker.example' },
      );
      assert.equal(hostileOriginResponse.status, 403);
      assert.equal(await hostileOriginResponse.text(), 'Invalid Origin header');
      await expectError(
        await exportRequest(
          fixture.workspaceId,
          { expectedOwnerId: owner, snapshotToken: 'unused', format: 'json' },
          { originHeader: null },
        ),
        403,
        'FORBIDDEN_ORIGIN',
      );
      await expectError(
        await exportRequest(fixture.workspaceId, '{}', {
          contentType: 'text/plain',
        }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await exportRequest(fixture.workspaceId, '{', { rawBody: true }),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await exportRequest(fixture.workspaceId, {
          expectedOwnerId: owner,
          snapshotToken: 'unused',
          format: 'json',
          requestId: randomUUID(),
        }),
        400,
        'INVALID_INPUT',
      );
    },
  );

  await check(
    'Owner history hides foreign and missing workspaces and foreign resources identically',
    async () => {
      const foreignUser = randomUUID();
      const foreignWorkspace = randomUUID();
      const foreignProject = randomUUID();
      const now = Date.now();
      await db
        .prepare(
          'INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
        )
        .bind(
          foreignUser,
          'Owner history foreign tenant',
          foreignUser + '@owner-history.invalid',
          now,
          now,
        )
        .run();
      await db
        .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
        .bind(foreignWorkspace, 'Foreign history workspace', foreignUser)
        .run();
      await db
        .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
        .bind(foreignProject, foreignWorkspace, 'Foreign history project')
        .run();

      await expectError(
        await ownerSend(worker, historyPath(foreignWorkspace)),
        404,
        'NOT_FOUND',
      );
      await expectError(
        await ownerSend(worker, historyPath(randomUUID())),
        404,
        'NOT_FOUND',
      );
      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId, { projectId: foreignProject }),
        ),
        404,
        'NOT_FOUND',
      );
    },
  );

  let annotationRow;
  let sourceActionRows = [];
  await check(
    'Owner reads real Guest and Owner source events without audit or retention writes',
    async () => {
      const beforeCounts = await auditCounts();
      annotationRow = await db
        .prepare(
          "SELECT * FROM audit_events WHERE workspace_id=? AND actor_id=? AND guest_session_id=? AND action='annotation.created' AND json_extract(after_json,'$.annotationId')=? ORDER BY rowid DESC LIMIT 1",
        )
        .bind(
          fixture.workspaceId,
          fixture.authorGuestId,
          fixture.authorSessionId ?? fixture.guestSessionId,
          fixture.annotationId ?? fixture.seededAnnotation?.annotationId,
        )
        .first();
      assert.ok(annotationRow, 'real annotation fixture event is required');

      const annotationEvent = await readEventForRow(annotationRow);
      await assertEnvelopeMatchesAudit(annotationEvent, annotationRow);
      assert.equal(annotationEvent.actor.type, 'guest');
      assert.equal(annotationEvent.actor.id, fixture.authorGuestId);
      assert.equal(annotationEvent.actor.label, fixture.authorLabel);
      assert.equal(
        annotationEvent.guestSessionId,
        fixture.authorSessionId ?? fixture.guestSessionId,
      );
      assert.equal(
        annotationEvent.inviteId,
        fixture.authorInviteId ?? fixture.inviteId,
      );
      assert.ok(
        annotationEvent.relatedInviteIds.includes(
          fixture.authorInviteId ?? fixture.inviteId,
        ),
      );
      assert.equal(annotationEvent.details.status, 'available');
      assert.equal(
        annotationEvent.details.after?.annotationId,
        fixture.annotationId ?? fixture.seededAnnotation?.annotationId,
      );

      const rows = await db
        .prepare(
          'SELECT e.* FROM audit_events e JOIN (SELECT MIN(a.rowid) AS first_rowid FROM audit_events a JOIN workspaces w ON w.id=a.workspace_id WHERE w.owner_user_id=? AND a.workspace_id IS NOT NULL GROUP BY a.action) first ON first.first_rowid=e.rowid ORDER BY e.action',
        )
        .bind(owner)
        .all();
      sourceActionRows = rows.results;
      assert.ok(
        sourceActionRows.some((row) => row.action === 'annotation.created'),
      );
      for (const row of sourceActionRows) {
        const event = await readEventForRow(row);
        await assertEnvelopeMatchesAudit(event, row);
        if (PROJECTED_SOURCE_ACTIONS.has(row.action))
          assert.notEqual(
            event.details.status,
            'omitted',
            'known source action was omitted: ' + row.action,
          );
      }
      process.stdout.write(
        'Owner history covered ' +
          sourceActionRows.length +
          ' actual Owner workspace actions: ' +
          sourceActionRows
            .map((row) => row.action)
            .sort()
            .join(', ') +
          '\n',
      );
      assert.deepEqual(await auditCounts(), beforeCounts);
    },
  );

  await check(
    'Owner history omits unknown audit JSON and returns invalid known envelopes without leaking fields',
    async () => {
      const unknownAction = 'owner_history_test.unknown.' + randomUUID();
      const unknownId = await insertAudit({
        action: unknownAction,
        beforeJson: JSON.stringify({
          password: PRIVATE_MARKER + 'password-before',
          secret: PRIVATE_MARKER + 'secret-before',
        }),
        afterJson: JSON.stringify({
          sessionToken: PRIVATE_MARKER + 'token-after',
          nested: { accessKey: PRIVATE_MARKER + 'key-after' },
        }),
      });
      const unknownPage = await readPage(fixture.workspaceId, {
        action: unknownAction,
      });
      const unknownEvent = unknownPage.items.find(
        (item) => item.eventId === unknownId,
      );
      assert.ok(unknownEvent);
      assert.deepEqual(unknownEvent.details, {
        status: 'omitted',
        before: null,
        after: null,
      });
      assert.equal(
        JSON.stringify(unknownEvent).includes(PRIVATE_MARKER),
        false,
      );

      const malformedAt = '2000-01-01T00:00:00.000Z';
      const malformedId = await insertAudit({
        action: 'owner_history.export_started',
        beforeJson: '{',
        afterJson: JSON.stringify({
          generationId: PRIVATE_MARKER + 'known-malformed',
        }),
        occurredAt: malformedAt,
      });
      const malformedPage = await readPage(fixture.workspaceId, {
        action: 'owner_history.export_started',
        from: malformedAt,
        to: '2000-01-01T00:00:00.001Z',
      });
      const malformedEvent = malformedPage.items.find(
        (item) => item.eventId === malformedId,
      );
      assert.ok(malformedEvent);
      assert.deepEqual(malformedEvent.details, {
        status: 'invalid',
        before: null,
        after: null,
      });
      assert.equal(
        JSON.stringify(malformedEvent).includes(PRIVATE_MARKER),
        false,
      );
    },
  );

  const pageAction = 'owner_history_test.page.' + randomUUID();
  const tiedAt = '2020-01-02T03:04:05.006Z';
  const seededEventIds = [];
  let lateBackdatedEventId;
  let pagingState;
  await check(
    'Owner history freezes 24-row pages with UTC tie ordering and excludes late backdated appends',
    async () => {
      for (let index = 0; index < 55; index++)
        seededEventIds.push(
          await insertAudit({
            action: pageAction,
            occurredAt: tiedAt,
            beforeJson: JSON.stringify({
              password: PRIVATE_MARKER + 'page-before-' + index,
            }),
            afterJson: JSON.stringify({
              secret: PRIVATE_MARKER + 'page-after-' + index,
              value: index,
            }),
          }),
        );

      const firstPage = await readPage(fixture.workspaceId, {
        action: pageAction,
      });
      assert.equal(firstPage.items.length, PAGE_SIZE);
      assert.ok(firstPage.nextCursor);
      for (const event of firstPage.items) {
        assert.equal(event.occurredAt, tiedAt);
        assert.equal(event.details.status, 'omitted');
        assert.equal(JSON.stringify(event).includes(PRIVATE_MARKER), false);
      }

      lateBackdatedEventId = await insertAudit({
        action: pageAction,
        occurredAt: '1999-12-31T23:59:59.999Z',
        beforeJson: JSON.stringify({ password: PRIVATE_MARKER + 'late' }),
      });

      const secondPage = await readPage(fixture.workspaceId, {
        action: pageAction,
        cursor: firstPage.nextCursor,
      });
      const thirdPage = await readPage(fixture.workspaceId, {
        action: pageAction,
        cursor: secondPage.nextCursor,
      });
      assert.equal(secondPage.items.length, PAGE_SIZE);
      assert.ok(secondPage.nextCursor);
      assert.equal(thirdPage.items.length, 7);
      assert.equal(thirdPage.nextCursor, null);
      assert.equal(secondPage.snapshotToken, firstPage.snapshotToken);
      assert.equal(thirdPage.snapshotToken, firstPage.snapshotToken);

      const allItems = [
        ...firstPage.items,
        ...secondPage.items,
        ...thirdPage.items,
      ];
      const actualIds = allItems.map((item) => item.eventId);
      const expectedIds = [...seededEventIds].sort((left, right) =>
        left > right ? -1 : left < right ? 1 : 0,
      );
      assert.deepEqual(actualIds, expectedIds);
      assert.equal(new Set(actualIds).size, seededEventIds.length);
      assert.equal(actualIds.includes(lateBackdatedEventId), false);
      for (let index = 1; index < firstPage.items.length; index++)
        assert.ok(
          firstPage.items[index - 1].eventId > firstPage.items[index].eventId,
        );

      pagingState = {
        action: pageAction,
        firstPage,
        expectedIds,
        snapshotToken: firstPage.snapshotToken,
        lateBackdatedEventId,
      };
    },
  );

  await check(
    'Owner history authenticates cursor context, rejects expired tokens, and recovers with a fresh Owner session',
    async () => {
      const { action, firstPage } = pagingState;
      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId, {
            action: action + '.other',
            cursor: firstPage.nextCursor,
          }),
        ),
        400,
        'INVALID_INPUT',
      );
      const tamperedCursor =
        firstPage.nextCursor.slice(0, -1) +
        (firstPage.nextCursor.endsWith('A') ? 'B' : 'A');
      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId, {
            action,
            cursor: tamperedCursor,
          }),
        ),
        400,
        'INVALID_INPUT',
      );

      const tamperedSnapshot =
        firstPage.snapshotToken.slice(0, -1) +
        (firstPage.snapshotToken.endsWith('A') ? 'B' : 'A');
      await expectError(
        await exportRequest(fixture.workspaceId, {
          expectedOwnerId: owner,
          snapshotToken: tamperedSnapshot,
          format: 'json',
        }),
        400,
        'INVALID_INPUT',
      );

      const high = await db
        .prepare(
          'SELECT CAST(COALESCE(MAX(rowid),0) AS TEXT) AS high FROM audit_events WHERE workspace_id=?',
        )
        .bind(fixture.workspaceId)
        .first();
      const now = Math.floor(Date.now() / 1000);
      const expiredCursor = signHistoryClaims(
        {
          version: 1,
          purpose: 'cursor',
          ownerId: owner,
          workspaceId: fixture.workspaceId,
          filters: { action },
          high: high.high,
          afterTime: tiedAt,
          afterId: seededEventIds[seededEventIds.length - 1],
          issuedAt: now - 901,
          expiresAt: now - 1,
        },
        authSecret,
      );
      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId, {
            action,
            cursor: expiredCursor,
          }),
        ),
        409,
        'HISTORY_SNAPSHOT_EXPIRED',
      );

      const baseline = await readPage(fixture.workspaceId, {
        action,
        cursor: firstPage.nextCursor,
      });
      const name = cookieName(ownerCookie);
      const freshId = randomUUID();
      const freshToken = 'owner-history-fresh:' + randomUUID();
      const time = Date.now();
      await db
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(freshId, freshToken, owner, time + 600000, time, time)
        .run();
      const freshCookie =
        name +
        '=' +
        encodeURIComponent(
          freshToken + '.' + (await makeSignature(freshToken, authSecret)),
        );
      try {
        await db
          .prepare(
            'UPDATE owner_sessions SET expiresAt=0 WHERE id=? AND userId=?',
          )
          .bind(activeSession.id, owner)
          .run();
        const recovered = await readPage(
          fixture.workspaceId,
          { action, cursor: firstPage.nextCursor },
          { cookie: freshCookie },
        );
        assert.deepEqual(
          recovered.items.map((item) => item.eventId),
          baseline.items.map((item) => item.eventId),
        );
      } finally {
        await db
          .prepare(
            'UPDATE owner_sessions SET expiresAt=? WHERE id=? AND userId=?',
          )
          .bind(activeSession.expiresAt, activeSession.id, owner)
          .run();
        await db
          .prepare('DELETE FROM owner_sessions WHERE id=? AND userId=?')
          .bind(freshId, owner)
          .run();
      }
    },
  );

  await check(
    'Owner history preserves related invite witnesses, long reopen IDs, and Guest history after logout',
    async () => {
      const sharedRows = await db
        .prepare(
          "SELECT * FROM audit_events WHERE workspace_id=? AND action IN('shared_review.created','shared_review.reopened') ORDER BY occurred_at_utc DESC,event_id DESC LIMIT 20",
        )
        .bind(fixture.workspaceId)
        .all();
      for (const row of sharedRows.results) {
        const event = await readEventForRow(row);
        const rawAfter = parseJson(row.after_json ?? 'null');
        if (!rawAfter?.reviewId) continue;
        const membership = await db
          .prepare(
            'SELECT si.invite_id FROM shared_review_invites si JOIN guest_invites i ON i.id=si.invite_id AND i.workspace_id=si.workspace_id AND i.project_id=si.project_id AND i.created_by=? JOIN guest_invite_seals seal ON seal.invite_id=i.id JOIN shared_reviews sr ON sr.id=si.review_id AND sr.workspace_id=si.workspace_id AND sr.project_id=si.project_id AND sr.album_id=si.album_id JOIN shared_review_seals rseal ON rseal.review_id=sr.id WHERE si.review_id=? AND si.workspace_id=? AND si.project_id=? AND si.album_id=? ORDER BY si.invite_id',
          )
          .bind(
            owner,
            rawAfter.reviewId,
            row.workspace_id,
            row.project_id,
            row.album_id,
          )
          .all();
        assert.deepEqual(
          event.relatedInviteIds,
          membership.results.map((item) => item.invite_id),
        );
      }

      const reopenedRows = await db
        .prepare(
          "SELECT * FROM audit_events WHERE workspace_id=? AND action='selection.reopened' ORDER BY occurred_at_utc DESC,event_id DESC LIMIT 20",
        )
        .bind(fixture.workspaceId)
        .all();
      for (const row of reopenedRows.results) {
        const event = await readEventForRow(row);
        assert.equal(event.eventId, row.event_id);
        if (row.event_id.length > 128) assert.ok(event.eventId.length > 128);
        if (event.inviteId !== null)
          assert.ok(event.relatedInviteIds.includes(event.inviteId));
      }

      const logout = await guestSend(
        '/api/guest/logout',
        fixture.secretAuthor ?? fixture.guestSecret,
        {
          requestId: randomUUID(),
        },
      );
      const logoutValue = await readValue(logout);
      assert.equal(logout.status, 200, JSON.stringify(logoutValue));
      assert.deepEqual(logoutValue, { loggedOut: true });
      const afterLogout = await readPage(fixture.workspaceId, {
        action: 'annotation.created',
        actorId: fixture.authorGuestId,
        inviteId: fixture.authorInviteId ?? fixture.inviteId,
        from: annotationRow.occurred_at_utc,
        to: nextMillisecond(annotationRow.occurred_at_utc),
      });
      assert.ok(
        afterLogout.items.some(
          (event) => event.eventId === annotationRow.event_id,
        ),
      );
    },
  );

  let jsonGenerationId;
  await check(
    'Owner JSON export streams the exact frozen snapshot and records server-generated metadata',
    async () => {
      const { action, expectedIds, snapshotToken, lateBackdatedEventId } =
        pagingState;
      const response = await exportRequest(fixture.workspaceId, {
        expectedOwnerId: owner,
        snapshotToken,
        format: 'json',
      });
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get('Content-Type') ?? '',
        /^application\/json/u,
      );
      jsonGenerationId = response.headers.get('X-Kino-History-Generation');
      assert.ok(jsonGenerationId);

      const text = await response.text();
      const data = JSON.parse(text);
      const claims = JSON.parse(
        Buffer.from(snapshotToken.split('.')[0], 'base64url').toString('utf8'),
      );
      assert.equal(data.complete, true);
      assert.equal(data.count, expectedIds.length);
      assert.equal(data.version, 1);
      assert.equal(data.generationId, jsonGenerationId);
      assert.equal(data.format, 'json');
      assert.equal(data.workspaceId, fixture.workspaceId);
      assert.equal(data.snapshotRowId, claims.high);
      assert.deepEqual(data.filters, { action });
      assert.deepEqual(
        data.events.map((item) => item.eventId),
        expectedIds,
      );
      assert.equal(
        data.events.some((item) => item.eventId === lateBackdatedEventId),
        false,
      );
      assert.equal(
        data.events.some(
          (item) =>
            item.action === 'owner_history.export_started' ||
            item.action === 'owner_history.export_completed',
        ),
        false,
      );
      assert.equal(text.includes(PRIVATE_MARKER), false);

      const started = await db
        .prepare(
          "SELECT * FROM audit_events WHERE action='owner_history.export_started' AND request_id=?",
        )
        .bind(jsonGenerationId)
        .first();
      const completed = await db
        .prepare(
          "SELECT * FROM audit_events WHERE action='owner_history.export_completed' AND request_id=?",
        )
        .bind(jsonGenerationId)
        .first();
      assert.ok(started && completed);
      for (const row of [started, completed]) {
        assert.equal(row.actor_type, 'user');
        assert.equal(row.actor_id, owner);
        assert.equal(row.session_id, activeSession.id);
        assert.equal(row.workspace_id, fixture.workspaceId);
        const metadata = JSON.parse(row.after_json);
        assert.equal(metadata.generationId, jsonGenerationId);
        assert.equal(metadata.format, 'json');
        assert.deepEqual(metadata.filters, { action });
        assert.equal(Object.hasOwn(metadata, 'events'), false);
        assert.equal(JSON.stringify(metadata).includes(PRIVATE_MARKER), false);
      }
      assert.equal(JSON.parse(completed.after_json).count, expectedIds.length);
      assert.equal(started.request_id, jsonGenerationId);
      assert.equal(completed.request_id, jsonGenerationId);
      assert.notEqual(started.event_id, jsonGenerationId);
      assert.notEqual(completed.event_id, jsonGenerationId);
    },
  );

  await check(
    'Owner CSV export quotes formula-like labels, request IDs, and event IDs',
    async () => {
      const action = 'owner_history_test.csv.' + randomUUID();
      const guestId = randomUUID();
      const formulaEventId = '=2+3';
      const formulaRequestId = '=1+1,"quoted"';
      const formulaLabel = '=SUM(1,1)';
      await db
        .prepare(
          'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
        )
        .bind(guestId, fixture.authorInviteId ?? fixture.inviteId, formulaLabel)
        .run();
      await insertAudit({
        eventId: formulaEventId,
        actorType: 'guest',
        actorId: guestId,
        guestSessionId: null,
        sessionId: null,
        action,
        requestId: formulaRequestId,
        beforeJson: JSON.stringify({ password: PRIVATE_MARKER + 'csv' }),
        afterJson: JSON.stringify({ count: 1 }),
        occurredAt: '2021-02-03T04:05:06.007Z',
      });

      const page = await readPage(fixture.workspaceId, { action });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].eventId, formulaEventId);
      assert.equal(page.items[0].actor.label, formulaLabel);
      assert.equal(page.items[0].requestId, formulaRequestId);
      const response = await exportRequest(fixture.workspaceId, {
        expectedOwnerId: owner,
        snapshotToken: page.snapshotToken,
        format: 'csv',
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Content-Type') ?? '', /^text\/csv/u);
      const rows = parseCsv(await response.text());
      assert.equal(rows.length, 2);
      const header = rows[0];
      const row = rows[1];
      const field = (name) => row[header.indexOf(name)];
      assert.equal(field('eventId'), "'" + formulaEventId);
      assert.equal(field('actorLabel'), "'" + formulaLabel);
      assert.equal(field('requestId'), "'" + formulaRequestId);
      assert.equal(field('detailsStatus'), 'omitted');
    },
  );

  await check(
    'Owner exports fail closed on audit failure, cancellation, and mid-stream session revocation',
    async () => {
      const { snapshotToken } = pagingState;
      const beforeFailedStart = await db
        .prepare(
          "SELECT COALESCE(MAX(rowid),0) AS high FROM audit_events WHERE action='owner_history.export_started' AND session_id=? AND workspace_id=?",
        )
        .bind(activeSession.id, fixture.workspaceId)
        .first();
      await db.exec(
        "CREATE TRIGGER owner_history_test_fail_complete BEFORE INSERT ON audit_events WHEN NEW.action='owner_history.export_completed' BEGIN SELECT RAISE(ABORT,'TEST_OWNER_HISTORY_COMPLETE_FAILURE'); END",
      );
      let failedId;
      try {
        let failedResponse;
        let fetchRejected = false;
        try {
          failedResponse = await exportRequest(fixture.workspaceId, {
            expectedOwnerId: owner,
            snapshotToken,
            format: 'json',
          });
        } catch {
          fetchRejected = true;
        }

        if (failedResponse) {
          failedId = failedResponse.headers.get('X-Kino-History-Generation');
          assert.ok(failedId);
          assert.equal(failedResponse.status, 200);
          await assert.rejects(failedResponse.text());
        } else {
          assert.equal(fetchRejected, true);
          const failedStart = await db
            .prepare(
              "SELECT request_id FROM audit_events WHERE action='owner_history.export_started' AND session_id=? AND workspace_id=? AND rowid>? ORDER BY rowid DESC LIMIT 1",
            )
            .bind(
              activeSession.id,
              fixture.workspaceId,
              beforeFailedStart?.high ?? 0,
            )
            .first();
          assert.ok(failedStart?.request_id);
          failedId = failedStart.request_id;
        }
      } finally {
        await db.exec('DROP TRIGGER owner_history_test_fail_complete');
      }

      assert.ok(failedId);
      const failedStart = await db
        .prepare(
          "SELECT event_id FROM audit_events WHERE action='owner_history.export_started' AND request_id=?",
        )
        .bind(failedId)
        .first();
      const failedComplete = await db
        .prepare(
          "SELECT event_id FROM audit_events WHERE action='owner_history.export_completed' AND request_id=?",
        )
        .bind(failedId)
        .first();
      assert.ok(failedStart);
      assert.equal(failedComplete, null);

      const cancelled = await streamHarnessRequest('cancel', snapshotToken);
      assert.equal(cancelled.interrupted, true);
      assert.equal(cancelled.startedCount, 1);
      assert.equal(cancelled.completedCount, 0);
      assert.deepEqual(await generationAuditCounts(cancelled.generationId), {
        startedCount: 1,
        completedCount: 0,
      });

      const revoked = await streamHarnessRequest('revoke', snapshotToken);
      assert.equal(revoked.interrupted, true);
      assert.equal(revoked.startedCount, 1);
      assert.equal(revoked.completedCount, 0);
      assert.deepEqual(await generationAuditCounts(revoked.generationId), {
        startedCount: 1,
        completedCount: 0,
      });
    },
  );

  await check(
    'Owner actor filters canonicalize, keep an explicit empty result, and bind pages and exports',
    async () => {
      const action = 'owner_history_test.actor_filter.' + randomUUID();
      for (const [actorType, count] of [
        ['guest', 25],
        ['system', 2],
        ['user', 2],
      ]) {
        for (let index = 0; index < count; index++)
          await insertAudit({
            actorType,
            actorId:
              actorType === 'system'
                ? null
                : actorType === 'user'
                  ? owner
                  : randomUUID(),
            sessionId: actorType === 'user' ? activeSession.id : null,
            action,
          });
      }

      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId, { actorTypes: ['guest', 'guest'] }),
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId, {
            actorTypes: ['guest', 'system', 'user', 'guest'],
          }),
        ),
        400,
        'INVALID_INPUT',
      );
      await expectError(
        await ownerSend(
          worker,
          historyPath(fixture.workspaceId, {
            actorType: 'user',
            actorTypes: ['guest'],
          }),
        ),
        400,
        'INVALID_INPUT',
      );

      const mixed = await readAllPages(fixture.workspaceId, {
        action,
        actorTypes: ['guest', 'system'],
      });
      assert.equal(mixed.items.length, 27);
      assert.equal(mixed.pages.length, 2);
      assert.deepEqual(
        new Set(mixed.items.map((event) => event.actor.type)),
        new Set(['guest', 'system']),
      );
      const claims = JSON.parse(
        Buffer.from(mixed.snapshotToken.split('.')[0], 'base64url').toString(),
      );
      assert.deepEqual(claims.filters, {
        action,
        actorTypes: ['system', 'guest'],
      });

      const legacy = await readPage(fixture.workspaceId, {
        action,
        actorType: 'guest',
      });
      assert.equal(legacy.items.length, PAGE_SIZE);
      assert.ok(legacy.nextCursor);
      const legacyContinuation = await readPage(fixture.workspaceId, {
        action,
        actorTypes: ['guest'],
        cursor: legacy.nextCursor,
      });
      assert.equal(legacyContinuation.snapshotToken, legacy.snapshotToken);
      assert.equal(legacyContinuation.items.length, 1);
      assert.equal(legacyContinuation.items[0].actor.type, 'guest');

      const exportedResponse = await exportRequest(fixture.workspaceId, {
        expectedOwnerId: owner,
        snapshotToken: mixed.snapshotToken,
        format: 'json',
      });
      assert.equal(exportedResponse.status, 200);
      const exported = JSON.parse(await exportedResponse.text());
      assert.equal(exported.count, mixed.items.length);
      assert.deepEqual(exported.filters, claims.filters);
      assert.deepEqual(
        exported.events.map((event) => event.eventId),
        mixed.items.map((event) => event.eventId),
      );

      const empty = await readPage(fixture.workspaceId, {
        action,
        actorTypes: [],
      });
      assert.deepEqual(empty.items, []);
      const emptyClaims = JSON.parse(
        Buffer.from(empty.snapshotToken.split('.')[0], 'base64url').toString(),
      );
      assert.deepEqual(emptyClaims.filters, { action, actorTypes: [] });
      const emptyExportResponse = await exportRequest(fixture.workspaceId, {
        expectedOwnerId: owner,
        snapshotToken: empty.snapshotToken,
        format: 'json',
      });
      const emptyExport = JSON.parse(await emptyExportResponse.text());
      assert.equal(emptyExport.count, 0);
      assert.deepEqual(emptyExport.events, []);
      assert.deepEqual(emptyExport.filters, emptyClaims.filters);
    },
  );

  return {
    workspaceId: fixture.workspaceId,
    sourceActionCount: sourceActionRows.length,
    sourceActions: sourceActionRows.map((row) => row.action).sort(),
    snapshotItemCount: pagingState.expectedIds.length,
    snapshotPageCount: pagingState.firstPage.nextCursor ? 3 : 1,
    jsonGenerationId,
    annotationEventId: annotationRow.event_id,
  };
}
