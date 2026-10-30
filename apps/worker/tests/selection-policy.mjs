import assert from 'node:assert/strict';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const sessionHash = (secret) =>
  createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');

export async function selectionPolicyChecks({
  mf,
  db,
  check,
  owner,
  cookies,
  base,
  galleryFixture,
  request,
}) {
  const enabled = await mf.getWorker('guest-feedback-test');
  const workspaceId = galleryFixture.context.workspace.id;
  const projectId = randomUUID();
  const albumId = randomUUID();
  const ownerHeaders = { Cookie: cookies.headers(), Origin: base };
  const ownerPath = '/api/v1/albums/' + albumId + '/selection-policy';
  const ownerCall = (method, body, targetWorker = enabled) =>
    targetWorker.fetch(
      new Request(new URL(ownerPath, base), {
        method,
        headers: {
          ...ownerHeaders,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const setBody = (requestId, expectedRevision, minimum, maximum) => ({
    requestId,
    expectedRevision,
    minimum,
    maximum,
    confirm: true,
  });
  const expectCode = async (response, status, code) => {
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  };

  const ownerSession = await db
    .prepare(
      'SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>? LIMIT 1',
    )
    .bind(owner, Date.now() + 60000)
    .first();
  assert.ok(ownerSession);

  await db
    .prepare(
      "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
    )
    .bind(projectId, workspaceId, 'Selection policy ' + projectId)
    .run();

  await db
    .prepare(
      "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
    )
    .bind(albumId, workspaceId, projectId, 'Selection policy isolated fixture')
    .run();

  const photos = [];
  const photoStatements = [];
  for (let index = 0; index < 31; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    photos.push({ photoId, versionId });
    photoStatements.push(
      db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          photoId,
          workspaceId,
          projectId,
          albumId,
          'policy-photo-' + (index + 1) + '.jpg',
        ),
      db
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
        )
        .bind(
          versionId,
          workspaceId,
          photoId,
          owner,
          randomBytes(32).toString('hex'),
        ),
    );
  }
  await db.batch(photoStatements);

  const invite = async (mask = 520) => {
    const inviteId = randomUUID();
    const tokenHash = createHash('sha256')
      .update(
        'kino-pic:guest-invite-token:v1:' + randomBytes(32).toString('hex'),
      )
      .digest('hex');
    const expires = Date.now() + 3600000;
    await db
      .prepare(
        "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',?,?,NULL,?,?)",
      )
      .bind(
        inviteId,
        workspaceId,
        projectId,
        tokenHash,
        mask,
        expires,
        owner,
        ownerSession.id,
      )
      .run();
    await db
      .prepare(
        'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
      )
      .bind(inviteId, workspaceId, projectId, albumId)
      .run();
    await db
      .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
      .bind(inviteId)
      .run();
    return inviteId;
  };

  const guestIdentity = async (inviteId, guestId = randomUUID()) => {
    await db
      .prepare(
        'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
      )
      .bind(guestId, inviteId, 'Policy fixture')
      .run();
    return guestId;
  };

  const guestSession = async (inviteId, guestId) => {
    const secret = randomBytes(32).toString('hex');
    const id = randomUUID();
    await db
      .prepare(
        'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
      )
      .bind(id, inviteId, guestId, sessionHash(secret), Date.now() + 1800000)
      .run();
    return { id, inviteId, guestId, secret };
  };

  const guestRoute = (guest, path, method = 'GET', body) =>
    enabled.fetch(
      new Request(new URL(path, base), {
        method,
        headers: {
          Cookie: 'kino_guest=' + guest.secret,
          ...(body === undefined
            ? {}
            : { Origin: base, 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  const selectionPath = '/api/guest/albums/' + albumId + '/selection';
  const selectPhoto = (
    guest,
    photo,
    selected = true,
    versionId = photo.versionId,
  ) =>
    guestRoute(
      guest,
      '/api/guest/albums/' +
        albumId +
        '/photos/' +
        photo.photoId +
        '/selection',
      'PUT',
      { requestId: randomUUID(), selected, versionId },
    );
  const readSelection = async (guest) => {
    const response = await guestRoute(guest, selectionPath);
    assert.equal(response.status, 200);
    return response.json();
  };
  const readAllSelection = async (guest) => {
    let cursor = null;
    let firstPage = null;
    const items = [];
    do {
      const path =
        selectionPath + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
      const response = await guestRoute(guest, path);
      assert.equal(response.status, 200);
      const page = await response.json();
      firstPage ??= page;
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return { ...firstPage, items };
  };

  const setPolicy = (input) => ownerCall('PUT', input);
  const getPolicy = () => ownerCall('GET');

  await check(
    'Owner selection policy defaults, canonical commands, replay, CAS, audit and namespace guards are atomic',
    async () => {
      const defaultOff = await request(ownerPath, { headers: ownerHeaders });
      await expectCode(defaultOff, 503, 'GUEST_SELECTION_DISABLED');

      const initialResponse = await getPolicy();
      assert.equal(initialResponse.status, 200);
      const initial = await initialResponse.json();
      assert.deepEqual(initial, {
        policy: {
          albumId,
          minimum: 1,
          maximum: null,
          revision: 0,
          mode: 'private',
        },
        maxOpenSelectedCount: 0,
      });
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM album_selection_policies WHERE album_id=?',
            )
            .bind(albumId)
            .first()
        ).n,
        0,
      );
      const defaultRequestId = randomUUID();
      const auditBeforeDefaultOverride = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_configuration_changed'",
          )
          .first()
      ).n;
      const firstOverrideBody = setBody(defaultRequestId, 0, 1, null);
      const firstOverride = await setPolicy(firstOverrideBody);
      assert.equal(firstOverride.status, 200);
      const firstOverrideResult = await firstOverride.json();
      assert.equal(firstOverrideResult.policy.revision, 1);
      assert.equal(firstOverrideResult.policy.minimum, 1);
      assert.equal(firstOverrideResult.policy.maximum, null);
      assert.ok(firstOverrideResult.eventId);
      assert.match(firstOverrideResult.eventId, /^selection-policy-config:/u);
      assert.match(firstOverrideResult.occurredAt, /^\d{4}-\d\d-\d\dT/u);
      assert.deepEqual(
        await (await setPolicy(firstOverrideBody)).json(),
        firstOverrideResult,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM album_selection_policies WHERE album_id=?',
            )
            .bind(albumId)
            .first()
        ).n,
        0,
      );
      assert.deepEqual(
        await db
          .prepare(
            'SELECT configuration,minimum,maximum,revision FROM album_selection_policy_configurations WHERE album_id=?',
          )
          .bind(albumId)
          .first(),
        {
          configuration: 'override',
          minimum: 1,
          maximum: null,
          revision: 1,
        },
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM selection_policy_configuration_commands WHERE actor_id=? AND request_id=? AND target_type='album' AND legacy_payload_json IS NOT NULL",
            )
            .bind(owner, defaultRequestId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM selection_policy_configuration_results r JOIN selection_policy_configuration_commands c ON c.id=r.command_id WHERE c.actor_id=? AND c.request_id=?',
            )
            .bind(owner, defaultRequestId)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_configuration_changed'",
            )
            .first()
        ).n,
        auditBeforeDefaultOverride + 1,
      );

      const initialOverrideAudit = await db
        .prepare(
          'SELECT before_json,after_json FROM audit_events WHERE event_id=?',
        )
        .bind(firstOverrideResult.eventId)
        .first();
      assert.deepEqual(JSON.parse(initialOverrideAudit.before_json), {
        targetType: 'album',
        albumId,
        projectId,
        configuration: 'inherit',
        minimum: 1,
        maximum: null,
        mode: 'private',
        source: 'system',
        projectRevision: 0,
        albumRevision: 0,
      });
      assert.deepEqual(JSON.parse(initialOverrideAudit.after_json), {
        targetType: 'album',
        albumId,
        projectId,
        configuration: 'override',
        minimum: 1,
        maximum: null,
        mode: 'private',
        source: 'album',
        projectRevision: 0,
        albumRevision: 1,
      });

      const changedRequestId = randomUUID();
      const changedBody = setBody(changedRequestId, 1, 2, null);
      const changedResponse = await setPolicy(changedBody);
      assert.equal(changedResponse.status, 200);
      const changed = await changedResponse.json();
      assert.deepEqual(changed.policy, {
        albumId,
        minimum: 2,
        maximum: null,
        revision: 2,
        mode: 'private',
      });
      assert.ok(changed.eventId);
      assert.match(changed.eventId, /^selection-policy-config:/u);
      assert.equal(
        changed.occurredAt,
        (
          await db
            .prepare(
              'SELECT occurred_at_utc FROM audit_events WHERE event_id=?',
            )
            .bind(changed.eventId)
            .first()
        ).occurred_at_utc,
      );
      const changedAudit = await db
        .prepare(
          'SELECT actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id FROM audit_events WHERE event_id=?',
        )
        .bind(changed.eventId)
        .first();
      assert.equal(changedAudit.actor_type, 'user');
      assert.equal(changedAudit.actor_id, owner);
      assert.equal(changedAudit.session_id, ownerSession.id);
      assert.equal(changedAudit.workspace_id, workspaceId);
      assert.equal(changedAudit.project_id, projectId);
      assert.equal(changedAudit.album_id, albumId);
      assert.equal(
        changedAudit.action,
        'selection.policy_configuration_changed',
      );
      assert.equal(changedAudit.request_id, changedRequestId);
      assert.deepEqual(JSON.parse(changedAudit.before_json), {
        targetType: 'album',
        albumId,
        projectId,
        configuration: 'override',
        minimum: 1,
        maximum: null,
        mode: 'private',
        source: 'album',
        projectRevision: 0,
        albumRevision: 1,
      });
      assert.deepEqual(JSON.parse(changedAudit.after_json), {
        targetType: 'album',
        albumId,
        projectId,
        configuration: 'override',
        minimum: 2,
        maximum: null,
        mode: 'private',
        source: 'album',
        projectRevision: 0,
        albumRevision: 2,
      });
      assert.deepEqual(await (await setPolicy(changedBody)).json(), changed);

      await expectCode(
        await setPolicy(setBody(randomUUID(), 1, 3, null)),
        409,
        'SELECTION_POLICY_REVISION_CONFLICT',
      );

      const stateBeforeNoop = await db
        .prepare(
          'SELECT configuration,minimum,maximum,revision,last_command_id,legacy_command_id,updated_at_ms FROM album_selection_policy_configurations WHERE album_id=?',
        )
        .bind(albumId)
        .first();
      const auditBeforeExistingNoop = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_configuration_changed'",
          )
          .first()
      ).n;
      const existingNoop = await setPolicy(setBody(randomUUID(), 2, 2, null));
      assert.equal(existingNoop.status, 200);
      const existingNoopBody = await existingNoop.json();
      assert.equal(existingNoopBody.policy.revision, 2);
      assert.equal(existingNoopBody.eventId, null);
      assert.deepEqual(
        await db
          .prepare(
            'SELECT configuration,minimum,maximum,revision,last_command_id,legacy_command_id,updated_at_ms FROM album_selection_policy_configurations WHERE album_id=?',
          )
          .bind(albumId)
          .first(),
        stateBeforeNoop,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_configuration_changed'",
            )
            .first()
        ).n,
        auditBeforeExistingNoop,
      );

      await assert.rejects(
        db
          .prepare(
            'UPDATE selection_policy_configuration_commands SET minimum=3 WHERE actor_id=? AND request_id=?',
          )
          .bind(owner, changedRequestId)
          .run(),
        /IMMUTABLE_SELECTION_POLICY_CONFIGURATION_COMMAND/u,
      );
      await assert.rejects(
        db
          .prepare(
            'DELETE FROM selection_policy_configuration_results WHERE command_id=(SELECT id FROM selection_policy_configuration_commands WHERE actor_id=? AND request_id=?)',
          )
          .bind(owner, changedRequestId)
          .run(),
        /IMMUTABLE_SELECTION_POLICY_CONFIGURATION_RESULT/u,
      );
      await assert.rejects(
        db
          .prepare(
            'UPDATE album_selection_policy_configurations SET minimum=3 WHERE album_id=?',
          )
          .bind(albumId)
          .run(),
        /INVALID_SELECTION_POLICY_CONFIGURATION_WITNESS/u,
      );

      const ownerDisabled = await db
        .prepare('SELECT enabled FROM owners WHERE user_id=?')
        .bind(owner)
        .first();
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        await expectCode(await setPolicy(changedBody), 403, 'OWNER_REQUIRED');
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=? WHERE user_id=?')
          .bind(ownerDisabled.enabled, owner)
          .run();
      }

      const absent = await enabled.fetch(
        new Request(
          new URL('/api/v1/albums/' + randomUUID() + '/selection-policy', base),
          {
            headers: ownerHeaders,
          },
        ),
      );
      assert.equal(absent.status, 404);
      const malformed = await enabled.fetch(
        new Request(
          new URL('/api/v1/albums/not-a-uuid/selection-policy', base),
          {
            headers: ownerHeaders,
          },
        ),
      );
      assert.equal(malformed.status, 400);

      const reopenCollision = randomUUID();
      await db
        .prepare(
          "INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,request_id) VALUES(?, 'user', ?, ?, ?, ?, ?, 'selection.reopened', ?)",
        )
        .bind(
          randomUUID(),
          owner,
          ownerSession.id,
          workspaceId,
          projectId,
          albumId,
          reopenCollision,
        )
        .run();
      await expectCode(
        await setPolicy(setBody(reopenCollision, 2, 3, null)),
        409,
        'REQUEST_ID_CONFLICT',
      );

      const contentCollision = randomUUID();
      const contentRevision = (
        await db
          .prepare('SELECT revision FROM albums WHERE id=?')
          .bind(albumId)
          .first()
      ).revision;
      await db
        .prepare(
          'INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          owner,
          contentCollision,
          'album.renamed',
          JSON.stringify({
            albumId,
            name: 'Policy namespace fixture',
            expectedRevision: contentRevision,
          }),
          ownerSession.id,
          albumId,
        )
        .run();
      await expectCode(
        await setPolicy(setBody(contentCollision, 2, 3, null)),
        409,
        'REQUEST_ID_CONFLICT',
      );

      const symmetricCollision = randomUUID();
      const symmetricPolicy = await setPolicy(
        setBody(symmetricCollision, 2, 3, null),
      );
      assert.equal(symmetricPolicy.status, 200);
      assert.deepEqual(await (await setPolicy(changedBody)).json(), changed);
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            owner,
            symmetricCollision,
            'album.renamed',
            JSON.stringify({
              albumId,
              name: 'Should roll back',
              expectedRevision: contentRevision + 1,
            }),
            ownerSession.id,
            albumId,
          )
          .run(),
        /REQUEST_ID_CONFLICT/u,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM request_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, symmetricCollision)
            .first()
        ).n,
        0,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,request_id) VALUES(?, 'user', ?, ?, ?, ?, ?, 'selection.reopened', ?)",
          )
          .bind(
            randomUUID(),
            owner,
            ownerSession.id,
            workspaceId,
            projectId,
            albumId,
            symmetricCollision,
          )
          .run(),
        /REQUEST_ID_CONFLICT/u,
      );

      const auditFailure = randomUUID();
      await db.exec(
        "CREATE TRIGGER fail_selection_policy_audit BEFORE INSERT ON audit_events WHEN NEW.action='selection.policy_configuration_changed' BEGIN SELECT RAISE(ABORT,'INJECTED_POLICY_AUDIT_FAILURE'); END;",
      );
      try {
        await expectCode(
          await setPolicy(setBody(auditFailure, 3, 4, null)),
          503,
          'SELECTION_POLICY_CONFIGURATION_UNAVAILABLE',
        );
      } finally {
        await db.exec('DROP TRIGGER fail_selection_policy_audit;');
      }
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM selection_policy_configuration_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, auditFailure)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT revision,minimum FROM album_selection_policy_configurations WHERE album_id=?',
            )
            .bind(albumId)
            .first()
        ).revision,
        3,
      );
    },
  );

  await check(
    'Private selection limits serialize new photos, isolate Guests, and preserve compliant submit snapshots',
    async () => {
      const policyAtStart = await (await getPolicy()).json();
      const capSet = await setPolicy(
        setBody(randomUUID(), policyAtStart.policy.revision, 1, 30),
      );
      assert.equal(capSet.status, 200);
      const capPolicy = await capSet.json();
      assert.equal(
        capPolicy.policy.revision,
        policyAtStart.policy.revision + 1,
      );
      assert.equal(capPolicy.policy.maximum, 30);

      const inviteId = await invite();
      const guestId = await guestIdentity(inviteId);
      const firstSession = await guestSession(inviteId, guestId);
      const secondSession = await guestSession(inviteId, guestId);

      for (const photo of photos.slice(0, 29)) {
        const response = await selectPhoto(firstSession, photo);
        assert.equal(response.status, 200);
      }
      assert.equal((await readSelection(firstSession)).selectedCount, 29);

      const concurrent = await Promise.all([
        selectPhoto(firstSession, photos[29]),
        selectPhoto(secondSession, photos[30]),
      ]);
      assert.deepEqual(
        concurrent.map((response) => response.status).sort(),
        [200, 409],
      );
      const failedInsert = concurrent.find(
        (response) => response.status === 409,
      );
      assert.equal(
        (await failedInsert.json()).error.code,
        'SELECTION_LIMIT_REACHED',
      );
      const winnerIndex = concurrent[0].status === 200 ? 29 : 30;
      const loserIndex = winnerIndex === 29 ? 30 : 29;
      const atCap = await readSelection(secondSession);
      assert.equal(atCap.selectedCount, 30);
      assert.equal((await readSelection(firstSession)).selectedCount, 30);

      const lowerOpenRequestId = randomUUID();
      const policyCommandsBeforeLower = (
        await db
          .prepare(
            'SELECT count(*) AS n FROM selection_policy_configuration_commands WHERE album_id=?',
          )
          .bind(albumId)
          .first()
      ).n;
      const lowerOpen = await setPolicy(
        setBody(lowerOpenRequestId, capPolicy.policy.revision, 1, 29),
      );
      await expectCode(lowerOpen, 409, 'SELECTION_POLICY_BELOW_CURRENT');
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM selection_policy_configuration_commands WHERE album_id=?',
            )
            .bind(albumId)
            .first()
        ).n,
        policyCommandsBeforeLower,
      );
      assert.deepEqual(
        (await (await getPolicy()).json()).policy,
        capPolicy.policy,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE request_id=? AND action='selection.policy_configuration_changed'",
            )
            .bind(lowerOpenRequestId)
            .first()
        ).n,
        0,
      );

      const nextVersionId = randomUUID();
      const nextVersionNo = await db
        .prepare(
          'SELECT COALESCE(MAX(version_no),0)+1 AS next FROM photo_versions WHERE photo_id=?',
        )
        .bind(photos[0].photoId)
        .first();
      await appendAuthorizedVersionFixture({
        db,
        owner,
        photoId: photos[0].photoId,
        versionId: nextVersionId,
        parentVersionId: photos[0].versionId,
        versionNo: nextVersionNo.next,
        sha256: randomBytes(32).toString('hex'),
        byteSize: 17,
        mime: 'image/jpeg',
        width: 10,
        height: 10,
      });
      const versioned = await selectPhoto(
        firstSession,
        photos[0],
        true,
        nextVersionId,
      );
      assert.equal(versioned.status, 200);
      const versionedBody = await versioned.json();
      assert.match(versionedBody.eventId, /^guest-selection:/u);
      assert.equal((await readSelection(firstSession)).selectedCount, 30);

      const sameVersionNoop = await selectPhoto(
        secondSession,
        photos[0],
        true,
        nextVersionId,
      );
      assert.equal(sameVersionNoop.status, 200);
      assert.equal((await sameVersionNoop.json()).eventId, null);
      const absentPhotoNoop = await selectPhoto(
        firstSession,
        photos[loserIndex],
        false,
      );
      assert.equal(absentPhotoNoop.status, 200);
      assert.equal((await absentPhotoNoop.json()).eventId, null);

      assert.equal(
        (await selectPhoto(secondSession, photos[1], false)).status,
        200,
      );
      assert.equal((await readSelection(firstSession)).selectedCount, 29);
      assert.equal(
        (await selectPhoto(secondSession, photos[loserIndex])).status,
        200,
      );
      assert.equal((await readSelection(firstSession)).selectedCount, 30);

      const submitRound = await readSelection(firstSession);
      const submissionRequestId = randomUUID();
      const submitBody = {
        requestId: submissionRequestId,
        expectedRoundNo: submitRound.roundNo,
        expectedRevision: submitRound.selectionRevision,
      };
      const submittedResponse = await guestRoute(
        firstSession,
        selectionPath + '/submit',
        'POST',
        submitBody,
      );
      assert.equal(submittedResponse.status, 200);
      const submitted = await submittedResponse.json();
      assert.equal(submitted.selectedCount, 30);
      assert.equal(submitted.roundNo, submitRound.roundNo);
      assert.equal(submitted.selectionRevision, submitRound.selectionRevision);
      const sealedBeforePolicyChange = await db
        .prepare(
          'SELECT count(*) AS n FROM guest_selection_submission_items WHERE guest_id=? AND album_id=?',
        )
        .bind(guestId, albumId)
        .first();
      assert.equal(sealedBeforePolicyChange.n, 30);

      const lowerAfterSubmit = await setPolicy(
        setBody(randomUUID(), capPolicy.policy.revision, 1, 29),
      );
      assert.equal(lowerAfterSubmit.status, 200);
      const loweredPolicy = await lowerAfterSubmit.json();
      assert.equal(loweredPolicy.policy.maximum, 29);
      const replayedSubmit = await guestRoute(
        firstSession,
        selectionPath + '/submit',
        'POST',
        submitBody,
      );
      assert.equal(replayedSubmit.status, 200);
      assert.deepEqual(await replayedSubmit.json(), submitted);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_submission_items WHERE guest_id=? AND album_id=?',
            )
            .bind(guestId, albumId)
            .first()
        ).n,
        30,
      );
      const frozenVersion = await db
        .prepare(
          'SELECT version_id FROM guest_selection_submission_items WHERE guest_id=? AND album_id=? AND photo_id=?',
        )
        .bind(guestId, albumId, photos[0].photoId)
        .first();
      assert.equal(frozenVersion.version_id, nextVersionId);

      const raisedMaximum = await setPolicy(
        setBody(randomUUID(), loweredPolicy.policy.revision, 1, 30),
      );
      assert.equal(raisedMaximum.status, 200);
      const raisedMaximumBody = await raisedMaximum.json();
      const raceGuestId = await guestIdentity(inviteId);
      const raceGuest = await guestSession(inviteId, raceGuestId);
      for (const photo of photos.slice(0, 29))
        assert.equal((await selectPhoto(raceGuest, photo)).status, 200);
      const racePolicyPromise = setPolicy(
        setBody(randomUUID(), raisedMaximumBody.policy.revision, 1, 29),
      );
      const raceAddPromise = selectPhoto(raceGuest, photos[29]);
      const [racePolicyResponse, raceAddResponse] = await Promise.all([
        racePolicyPromise,
        raceAddPromise,
      ]);
      assert.deepEqual(
        [racePolicyResponse.status, raceAddResponse.status].sort(),
        [200, 409],
      );
      if (racePolicyResponse.status === 200) {
        assert.equal((await racePolicyResponse.json()).policy.maximum, 29);
        assert.equal(
          (await raceAddResponse.json()).error.code,
          'SELECTION_LIMIT_REACHED',
        );
        assert.equal((await readSelection(raceGuest)).selectedCount, 29);
      } else {
        await expectCode(
          racePolicyResponse,
          409,
          'SELECTION_POLICY_BELOW_CURRENT',
        );
        assert.equal(raceAddResponse.status, 200);
        assert.equal((await readSelection(raceGuest)).selectedCount, 30);
      }
      const raceRound = await readSelection(raceGuest);
      const raceSubmission = await guestRoute(
        raceGuest,
        selectionPath + '/submit',
        'POST',
        {
          requestId: randomUUID(),
          expectedRoundNo: raceRound.roundNo,
          expectedRevision: raceRound.selectionRevision,
        },
      );
      assert.equal(raceSubmission.status, 200);
      const afterRace = await (await getPolicy()).json();
      const baseline29 = await setPolicy(
        setBody(randomUUID(), afterRace.policy.revision, 1, 29),
      );
      assert.equal(baseline29.status, 200);
      const baseline29Body = await baseline29.json();
      assert.equal(baseline29Body.policy.maximum, 29);

      const guestBId = await guestIdentity(inviteId);
      const guestB = await guestSession(inviteId, guestBId);
      const guestCId = await guestIdentity(inviteId);
      const guestC = await guestSession(inviteId, guestCId);
      for (const photo of photos.slice(0, 29))
        assert.equal((await selectPhoto(guestB, photo)).status, 200);
      for (const photo of photos.slice(2, 31))
        assert.equal((await selectPhoto(guestC, photo)).status, 200);
      assert.equal((await readSelection(guestB)).selectedCount, 29);
      assert.equal((await readSelection(guestC)).selectedCount, 29);
      const guestBPage = await readAllSelection(guestB);
      const guestCPage = await readAllSelection(guestC);
      assert.equal(
        guestBPage.items.some((item) => item.photoId === photos[29].photoId),
        false,
      );
      assert.equal(
        guestBPage.items.some((item) => item.photoId === photos[30].photoId),
        false,
      );
      assert.equal(
        guestCPage.items.some((item) => item.photoId === photos[30].photoId),
        true,
      );
      const openRead = await (await getPolicy()).json();
      assert.equal(openRead.policy.maximum, 29);
      assert.equal(openRead.maxOpenSelectedCount, 29);

      const minSet = await setPolicy(
        setBody(randomUUID(), baseline29Body.policy.revision, 2, 29),
      );
      assert.equal(minSet.status, 200);
      const minPolicy = await minSet.json();
      const staleCursorResponse = await guestRoute(
        guestB,
        selectionPath + '?cursor=' + encodeURIComponent(guestBPage.nextCursor),
      );
      await expectCode(staleCursorResponse, 409, 'SELECTION_CHANGED');
      const minGuestId = await guestIdentity(inviteId);
      const minGuest = await guestSession(inviteId, minGuestId);
      assert.equal((await selectPhoto(minGuest, photos[0])).status, 200);
      const oneSelected = await readSelection(minGuest);
      const failingSubmitId = randomUUID();
      const auditBeforeMinimum = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='selection.submitted'",
          )
          .first()
      ).n;
      await expectCode(
        await guestRoute(minGuest, selectionPath + '/submit', 'POST', {
          requestId: failingSubmitId,
          expectedRoundNo: oneSelected.roundNo,
          expectedRevision: oneSelected.selectionRevision,
        }),
        409,
        'SELECTION_MINIMUM_NOT_MET',
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_submissions WHERE guest_id=? AND album_id=?',
            )
            .bind(minGuestId, albumId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.submitted'",
            )
            .first()
        ).n,
        auditBeforeMinimum,
      );

      assert.equal((await selectPhoto(minGuest, photos[1])).status, 200);
      const compliantRound = await readSelection(minGuest);
      const compliantRequestId = randomUUID();
      const compliantSubmitBody = {
        requestId: compliantRequestId,
        expectedRoundNo: compliantRound.roundNo,
        expectedRevision: compliantRound.selectionRevision,
      };
      const compliantResponse = await guestRoute(
        minGuest,
        selectionPath + '/submit',
        'POST',
        compliantSubmitBody,
      );
      assert.equal(compliantResponse.status, 200);
      const compliantResult = await compliantResponse.json();
      assert.equal(compliantResult.selectedCount, 2);

      const raisedMin = await setPolicy(
        setBody(randomUUID(), minPolicy.policy.revision, 3, 29),
      );
      assert.equal(raisedMin.status, 200);
      const raised = await raisedMin.json();
      assert.equal(raised.policy.minimum, 3);
      assert.equal(raised.policy.revision, minPolicy.policy.revision + 1);
      const auditBeforeReplay = (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE action='selection.submitted' AND request_id=?",
          )
          .bind(compliantRequestId)
          .first()
      ).n;
      const compliantReplay = await guestRoute(
        minGuest,
        selectionPath + '/submit',
        'POST',
        compliantSubmitBody,
      );
      assert.equal(compliantReplay.status, 200);
      assert.deepEqual(await compliantReplay.json(), compliantResult);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.submitted' AND request_id=?",
            )
            .bind(compliantRequestId)
            .first()
        ).n,
        auditBeforeReplay,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_submissions WHERE guest_id=? AND album_id=?',
            )
            .bind(minGuestId, albumId)
            .first()
        ).n,
        1,
      );
    },
  );

  await check(
    'Policy scope is tenant-bound, strict, and cross-ledger with Guest feedback requests',
    async () => {
      const foreignUserId = randomUUID();
      const foreignWorkspaceId = randomUUID();
      const foreignProjectId = randomUUID();
      const foreignAlbumId = randomUUID();
      const now = Date.now();
      await db
        .prepare(
          'INSERT INTO users(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,?,?,1,NULL,?,?)',
        )
        .bind(
          foreignUserId,
          'Foreign fixture',
          foreignUserId + '@selection-policy.invalid',
          now,
          now,
        )
        .run();
      await db
        .prepare('INSERT INTO workspaces(id,name,owner_user_id) VALUES(?,?,?)')
        .bind(
          foreignWorkspaceId,
          'Foreign selection policy workspace',
          foreignUserId,
        )
        .run();
      await db
        .prepare(
          "INSERT INTO projects(id,workspace_id,name,status) VALUES(?,?,?,'draft')",
        )
        .bind(foreignProjectId, foreignWorkspaceId, 'Foreign policy project')
        .run();
      await db
        .prepare(
          "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
        )
        .bind(
          foreignAlbumId,
          foreignWorkspaceId,
          foreignProjectId,
          'Foreign policy album',
        )
        .run();

      const foreignPath =
        '/api/v1/albums/' + foreignAlbumId + '/selection-policy';
      const foreignGet = await enabled.fetch(
        new Request(new URL(foreignPath, base), { headers: ownerHeaders }),
      );
      assert.equal(foreignGet.status, 404);
      const foreignSet = await enabled.fetch(
        new Request(new URL(foreignPath, base), {
          method: 'PUT',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(setBody(randomUUID(), 0, 1, null)),
        }),
      );
      assert.equal(foreignSet.status, 404);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM album_selection_policies WHERE album_id=?',
            )
            .bind(foreignAlbumId)
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM album_selection_policy_configurations WHERE album_id=?',
            )
            .bind(foreignAlbumId)
            .first()
        ).n,
        0,
      );

      const invalidStrict = await setPolicy({
        ...setBody(randomUUID(), 2, 3, null),
        albumId,
      });
      assert.equal(invalidStrict.status, 400);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM album_selection_policy_configurations WHERE album_id=?',
            )
            .bind(albumId)
            .first()
        ).n,
        1,
      );

      const malformedRequestId = randomUUID();
      const frozenLegacyRequestId = randomUUID();
      const malformedRevision = (await (await getPolicy()).json()).policy
        .revision;
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO selection_policy_commands(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,expected_revision,minimum,maximum,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            owner,
            ownerSession.id,
            frozenLegacyRequestId,
            workspaceId,
            projectId,
            albumId,
            0,
            1,
            null,
            JSON.stringify({
              albumId,
              expectedRevision: 0,
              minimum: 1,
              maximum: null,
              confirm: true,
            }),
            Date.now(),
          )
          .run(),
        /LEGACY_SELECTION_POLICY_READ_ONLY/u,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM selection_policy_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, frozenLegacyRequestId)
            .first()
        ).n,
        0,
      );

      const activeStateBeforeMalformed = await db
        .prepare(
          'SELECT configuration,minimum,maximum,revision,last_command_id,legacy_command_id,updated_at_ms FROM album_selection_policy_configurations WHERE album_id=?',
        )
        .bind(albumId)
        .first();
      const malformedProjectRevision = await db
        .prepare(
          'SELECT COALESCE((SELECT revision FROM project_selection_policy_configurations WHERE project_id=?),0) AS revision',
        )
        .bind(projectId)
        .first();
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO selection_policy_configuration_commands(id,actor_id,session_id,request_id,target_type,workspace_id,project_id,album_id,expected_project_revision,expected_album_revision,configuration,minimum,maximum,payload_json,legacy_payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            owner,
            ownerSession.id,
            malformedRequestId,
            'album',
            workspaceId,
            projectId,
            albumId,
            malformedProjectRevision.revision,
            malformedRevision,
            'override',
            4,
            null,
            '{}',
            null,
            Date.now(),
          )
          .run(),
        /CHECK constraint failed/u,
      );
      assert.deepEqual(
        await db
          .prepare(
            'SELECT configuration,minimum,maximum,revision,last_command_id,legacy_command_id,updated_at_ms FROM album_selection_policy_configurations WHERE album_id=?',
          )
          .bind(albumId)
          .first(),
        activeStateBeforeMalformed,
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM selection_policy_configuration_commands WHERE actor_id=? AND request_id=?',
            )
            .bind(owner, malformedRequestId)
            .first()
        ).n,
        0,
      );

      const feedbackInvite = await invite(536);
      const feedbackGuestId = await guestIdentity(feedbackInvite);
      const feedbackGuest = await guestSession(feedbackInvite, feedbackGuestId);
      const selectionCollisionId = randomUUID();
      const ratingResponse = await guestRoute(
        feedbackGuest,
        '/api/guest/albums/' +
          albumId +
          '/photos/' +
          photos[0].photoId +
          '/rating',
        'PUT',
        {
          requestId: selectionCollisionId,
          versionId: photos[0].versionId,
          stars: 4,
        },
      );
      assert.equal(ratingResponse.status, 200);
      await expectCode(
        await guestRoute(
          feedbackGuest,
          '/api/guest/albums/' +
            albumId +
            '/photos/' +
            photos[0].photoId +
            '/selection',
          'PUT',
          {
            requestId: selectionCollisionId,
            versionId: photos[0].versionId,
            selected: true,
          },
        ),
        409,
        'REQUEST_ID_CONFLICT',
      );

      const validSelectionId = randomUUID();
      const validSelection = await guestRoute(
        feedbackGuest,
        '/api/guest/albums/' +
          albumId +
          '/photos/' +
          photos[0].photoId +
          '/selection',
        'PUT',
        {
          requestId: validSelectionId,
          versionId: photos[0].versionId,
          selected: true,
        },
      );
      assert.equal(validSelection.status, 200);
      const round = await readSelection(feedbackGuest);
      const submissionCollisionId = randomUUID();
      const ratingForSubmit = await guestRoute(
        feedbackGuest,
        '/api/guest/albums/' +
          albumId +
          '/photos/' +
          photos[1].photoId +
          '/rating',
        'PUT',
        {
          requestId: submissionCollisionId,
          versionId: photos[1].versionId,
          stars: 5,
        },
      );
      assert.equal(ratingForSubmit.status, 200);
      const submissionsBefore = (
        await db
          .prepare(
            'SELECT count(*) AS n FROM guest_selection_submissions WHERE guest_id=? AND album_id=?',
          )
          .bind(feedbackGuestId, albumId)
          .first()
      ).n;
      await expectCode(
        await guestRoute(feedbackGuest, selectionPath + '/submit', 'POST', {
          requestId: submissionCollisionId,
          expectedRoundNo: round.roundNo,
          expectedRevision: round.selectionRevision,
        }),
        409,
        'REQUEST_ID_CONFLICT',
      );
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_submissions WHERE guest_id=? AND album_id=?',
            )
            .bind(feedbackGuestId, albumId)
            .first()
        ).n,
        submissionsBefore,
      );
    },
  );
}
