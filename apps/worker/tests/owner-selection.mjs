import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { runOwnerSelectionBrowserChecks } from './owner-selection-browser.mjs';

export async function ownerSelectionChecks({
  db,
  mf,
  request,
  owner,
  check,
  cookies,
  base,
  galleryFixture,
}) {
  const selectionWorker = await mf.getWorker('guest-selection-test');
  const albumId = galleryFixture.context.album.id;
  const projectId = galleryFixture.context.project.id;
  const ownerHeaders = {
    Cookie: cookies.headers(),
    Origin: base,
  };
  const readGeneratedExportEvents = () =>
    db
      .prepare(
        `SELECT event_id, actor_type, actor_id, session_id, workspace_id, project_id,
           album_id, action, after_json, request_id
         FROM audit_events WHERE action='download.generated'`,
      )
      .all();
  const assertNoNewGeneratedExports = async (before) => {
    const after = await readGeneratedExportEvents();
    assert.deepEqual(
      after.results.map((event) => event.event_id).sort(),
      before.results.map((event) => event.event_id).sort(),
    );
  };
  const assertOneGeneratedExport = async (
    before,
    { format, submissionId, selectedCount },
  ) => {
    const after = await readGeneratedExportEvents();
    assert.equal(after.results.length, before.results.length + 1);
    const previousIds = new Set(before.results.map((event) => event.event_id));
    const created = after.results.filter(
      (event) => !previousIds.has(event.event_id),
    );
    assert.equal(created.length, 1);
    const event = created[0];
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    assert.match(event.event_id, uuidPattern);
    assert.match(event.request_id, uuidPattern);
    assert.equal(
      before.results.some((prior) => prior.request_id === event.request_id),
      false,
    );
    assert.equal(event.actor_type, 'user');
    assert.equal(event.actor_id, owner);
    assert.equal(event.workspace_id, galleryFixture.context.workspace.id);
    assert.equal(event.project_id, galleryFixture.context.project.id);
    assert.equal(event.album_id, albumId);
    assert.equal(event.action, 'download.generated');
    const session = await db
      .prepare('SELECT userId,expiresAt FROM owner_sessions WHERE id=?')
      .bind(event.session_id)
      .first();
    assert.ok(session);
    assert.equal(session.userId, owner);
    assert.ok(session.expiresAt > Date.now());
    const metadata = JSON.parse(event.after_json);
    assert.deepEqual(Object.keys(metadata).sort(), [
      'format',
      'selectedCount',
      'submissionId',
    ]);
    assert.deepEqual(metadata, { submissionId, format, selectedCount });
    return event;
  };

  await check(
    'Owner selection endpoints are gated by GUEST_SELECTION_ENABLED, authenticated and workspace-scoped',
    async () => {
      // 1. Default disabled worker returns 503
      const disabledSubmissions = await request(
        `/api/v1/albums/${albumId}/submissions`,
        { headers: ownerHeaders },
      );
      assert.equal(disabledSubmissions.status, 503);
      assert.equal(
        (await disabledSubmissions.json()).error.code,
        'GUEST_SELECTION_DISABLED',
      );

      const disabledReopen = await request(
        `/api/v1/albums/${albumId}/rounds/reopen`,
        {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: randomUUID(),
            inviteId: randomUUID(),
            guestId: randomUUID(),
            expectedRoundNo: 1,
          }),
        },
      );
      assert.equal(disabledReopen.status, 503);
      assert.equal(
        (await disabledReopen.json()).error.code,
        'GUEST_SELECTION_DISABLED',
      );

      // 2. Enabled worker requires authentication
      const unauth = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/submissions`),
      );
      assert.equal(unauth.status, 401);

      // 3. Non-existent album returns 404
      const notFound = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${randomUUID()}/submissions`, {
          headers: ownerHeaders,
        }),
      );
      assert.equal(notFound.status, 404);

      // 4. Malformed UUID album returns 400
      const invalid = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/not-a-uuid/submissions`, {
          headers: ownerHeaders,
        }),
      );
      assert.equal(invalid.status, 400);
    },
  );

  let activeGuestId = null;
  let activeInviteId = null;
  let activeSelectedCount = null;
  let activeSubmissionId = null;

  await check(
    'Owner can list submissions, view snapshot item details and export CSV/TXT/JSON',
    async () => {
      const beforeReads = await readGeneratedExportEvents();
      // Fetch submissions list
      const listRes = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/submissions`, {
          headers: ownerHeaders,
        }),
      );
      assert.equal(listRes.status, 200);
      const listData = await listRes.json();
      assert.ok(Array.isArray(listData.submissions));

      // There should be at least 1 submission from prior guest selection test
      assert.ok(listData.submissions.length >= 1);
      const sub = listData.submissions[0];
      assert.equal(sub.roundNo, 1);
      assert.equal(sub.roundStatus, 'submitted');
      assert.equal(sub.sealed, true);
      assert.ok(sub.selectedCount > 0);

      activeGuestId = sub.guestId;
      activeInviteId = sub.inviteId;
      activeSelectedCount = sub.selectedCount;
      activeSubmissionId = sub.id;

      // Fetch submission detail
      const detailRes = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/submissions/${sub.id}`, {
          headers: ownerHeaders,
        }),
      );
      assert.equal(detailRes.status, 200);
      const detailData = await detailRes.json();
      assert.equal(detailData.submission.id, sub.id);
      assert.equal(detailData.submission.items.length, sub.selectedCount);
      await assertNoNewGeneratedExports(beforeReads);

      const firstItem = detailData.submission.items[0];
      assert.ok(firstItem.originalFilename);
      assert.ok(firstItem.versionNo >= 1);
      assert.ok(firstItem.byteSize > 0);

      const formulaLikeFilename = ' \t\u0001=1+1.jpg';
      await db
        .prepare('UPDATE photos SET original_filename=? WHERE id=?')
        .bind(formulaLikeFilename, firstItem.photoId)
        .run();
      const updatedDetailRes = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/submissions/${sub.id}`, {
          headers: ownerHeaders,
        }),
      );
      assert.equal(updatedDetailRes.status, 200);
      const updatedDetail = await updatedDetailRes.json();
      const updatedItem = updatedDetail.submission.items.find(
        (item) => item.photoId === firstItem.photoId,
      );
      assert.equal(updatedItem.originalFilename, formulaLikeFilename);
      await assertNoNewGeneratedExports(beforeReads);

      // Export CSV
      const csvAuditBefore = await readGeneratedExportEvents();
      const csvRes = await selectionWorker.fetch(
        new Request(
          `${base}/api/v1/albums/${albumId}/submissions/${sub.id}/export?format=csv`,
          { headers: ownerHeaders },
        ),
      );
      assert.equal(csvRes.status, 200);
      assert.match(csvRes.headers.get('content-type') || '', /text\/csv/);
      assert.match(
        csvRes.headers.get('content-disposition') || '',
        /attachment; filename=.*\.csv/,
      );
      const csvText = await csvRes.text();
      assert.ok(
        csvText.startsWith(
          'photo_id,filename,version_no,version_id,selected_at',
        ),
      );
      assert.ok(csvText.includes(formulaLikeFilename));
      assert.ok(csvText.includes(`,"'${formulaLikeFilename}",`));
      const csvAudit = await assertOneGeneratedExport(csvAuditBefore, {
        format: 'csv',
        submissionId: sub.id,
        selectedCount: sub.selectedCount,
      });

      const normalFilename = 'normal, "quoted".jpg';
      await db
        .prepare('UPDATE photos SET original_filename=? WHERE id=?')
        .bind(normalFilename, firstItem.photoId)
        .run();
      const normalCsvAuditBefore = await readGeneratedExportEvents();
      const normalCsvRes = await selectionWorker.fetch(
        new Request(
          `${base}/api/v1/albums/${albumId}/submissions/${sub.id}/export?format=csv`,
          { headers: ownerHeaders },
        ),
      );
      const normalCsvText = await normalCsvRes.text();
      assert.equal(normalCsvRes.status, 200);
      assert.ok(normalCsvText.includes(',"normal, ""quoted"".jpg",'));
      const normalCsvAudit = await assertOneGeneratedExport(
        normalCsvAuditBefore,
        {
          format: 'csv',
          submissionId: sub.id,
          selectedCount: sub.selectedCount,
        },
      );
      assert.notEqual(normalCsvAudit.event_id, csvAudit.event_id);
      assert.notEqual(normalCsvAudit.request_id, csvAudit.request_id);

      await db
        .prepare('UPDATE photos SET original_filename=? WHERE id=?')
        .bind(formulaLikeFilename, firstItem.photoId)
        .run();

      // Export TXT (Lightroom filenames)
      const txtAuditBefore = await readGeneratedExportEvents();
      const txtRes = await selectionWorker.fetch(
        new Request(
          `${base}/api/v1/albums/${albumId}/submissions/${sub.id}/export?format=txt`,
          { headers: ownerHeaders },
        ),
      );
      assert.equal(txtRes.status, 200);
      assert.match(txtRes.headers.get('content-type') || '', /text\/plain/);
      const txtText = await txtRes.text();
      assert.ok(txtText.split('\n').includes(formulaLikeFilename));
      assert.ok(!txtText.split('\n').includes(`'${formulaLikeFilename}`));
      await assertOneGeneratedExport(txtAuditBefore, {
        format: 'txt',
        submissionId: sub.id,
        selectedCount: sub.selectedCount,
      });

      // Export JSON
      const jsonAuditBefore = await readGeneratedExportEvents();
      const jsonRes = await selectionWorker.fetch(
        new Request(
          `${base}/api/v1/albums/${albumId}/submissions/${sub.id}/export?format=json`,
          { headers: ownerHeaders },
        ),
      );
      assert.equal(jsonRes.status, 200);
      assert.match(
        jsonRes.headers.get('content-type') || '',
        /application\/json/,
      );
      const jsonParsed = await jsonRes.json();
      assert.equal(jsonParsed.submission.id, sub.id);
      const jsonItem = jsonParsed.submission.items.find(
        (item) => item.photoId === firstItem.photoId,
      );
      assert.equal(jsonItem.originalFilename, formulaLikeFilename);
      await assertOneGeneratedExport(jsonAuditBefore, {
        format: 'json',
        submissionId: sub.id,
        selectedCount: sub.selectedCount,
      });

      for (const formulaPrefix of ['+', '-', '@']) {
        const candidateFilename = ` \t\u0001${formulaPrefix}1+1.jpg`;
        await db
          .prepare('UPDATE photos SET original_filename=? WHERE id=?')
          .bind(candidateFilename, firstItem.photoId)
          .run();
        const candidateCsvAuditBefore = await readGeneratedExportEvents();
        const candidateCsvRes = await selectionWorker.fetch(
          new Request(
            `${base}/api/v1/albums/${albumId}/submissions/${sub.id}/export?format=csv`,
            { headers: ownerHeaders },
          ),
        );
        assert.equal(candidateCsvRes.status, 200);
        const candidateCsvText = await candidateCsvRes.text();
        assert.ok(candidateCsvText.includes(`,"'${candidateFilename}",`));
        await assertOneGeneratedExport(candidateCsvAuditBefore, {
          format: 'csv',
          submissionId: sub.id,
          selectedCount: sub.selectedCount,
        });
      }
    },
  );

  await check(
    'Owner export authorization errors and audit failures never return an unaudited download',
    async () => {
      const before = await readGeneratedExportEvents();
      const exportPath = `/api/v1/albums/${albumId}/submissions/${activeSubmissionId}/export?format=csv`;

      const unauthorized = await selectionWorker.fetch(
        new Request(`${base}${exportPath}`),
      );
      assert.equal(unauthorized.status, 401);
      await assertNoNewGeneratedExports(before);

      const foreignAlbum = await db
        .prepare(
          `SELECT a.id FROM albums a JOIN workspaces w ON w.id=a.workspace_id
           WHERE w.owner_user_id=? AND a.id<>? LIMIT 1`,
        )
        .bind(owner, albumId)
        .first();
      assert.ok(foreignAlbum);
      const foreign = await selectionWorker.fetch(
        new Request(
          `${base}/api/v1/albums/${foreignAlbum.id}/submissions/${activeSubmissionId}/export?format=csv`,
          { headers: ownerHeaders },
        ),
      );
      assert.equal(foreign.status, 404);
      await assertNoNewGeneratedExports(before);

      await db.exec(
        "CREATE TRIGGER test_owner_export_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='download.generated' BEGIN SELECT RAISE(ABORT,'TEST_OWNER_EXPORT_AUDIT_FAILURE'); END",
      );
      let failedExport;
      try {
        failedExport = await selectionWorker.fetch(
          new Request(`${base}${exportPath}`, { headers: ownerHeaders }),
        );
      } finally {
        await db.exec('DROP TRIGGER test_owner_export_audit_failure');
      }
      assert.equal(failedExport.status, 503);
      await assertNoNewGeneratedExports(before);
    },
  );

  await check(
    'Owner round reopen validates status/round conflicts and executes through Playwright UI',
    async () => {
      // 1. Conflict: expectedRoundNo does not match current round
      const wrongRoundRes = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/rounds/reopen`, {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: randomUUID(),
            inviteId: activeInviteId,
            guestId: activeGuestId,
            expectedRoundNo: 999,
          }),
        }),
      );
      assert.equal(wrongRoundRes.status, 409);
      assert.equal((await wrongRoundRes.json()).error.code, 'ROUND_CONFLICT');

      // 2. Reopen via real Chromium browser UI
      await runOwnerSelectionBrowserChecks({
        worker: selectionWorker,
        baseUrl: base,
        ownerCookie: cookies.values.get('kino-owner.session_token'),
        projectId,
        albumId,
        db,
        guestId: activeGuestId,
        selectedCount: activeSelectedCount,
      });

      // 3. Negative check: Cannot reopen an already 'open' round
      const alreadyOpenRes = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/rounds/reopen`, {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: randomUUID(),
            inviteId: activeInviteId,
            guestId: activeGuestId,
            expectedRoundNo: 2,
          }),
        }),
      );
      assert.equal(alreadyOpenRes.status, 409);
      assert.equal(
        (await alreadyOpenRes.json()).error.code,
        'ROUND_NOT_SUBMITTED',
      );
    },
  );

  await check(
    'Guest can modify selection and submit Round 2, resulting in multiple preserved submission snapshots',
    async () => {
      // 1. Create a fresh invite and guest session with mask 521 (can_view | can_select | can_submit)
      const token = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256')
        .update(`kino-pic:guest-invite-token:v1:${token}`)
        .digest('hex');
      const inviteId = randomUUID();
      const guestId = randomUUID();
      const sessionId = randomUUID();
      const guestSecret = randomBytes(32).toString('hex');
      const guestSecretHash = createHash('sha256')
        .update(`kino-pic:guest-session:v1:${guestSecret}`)
        .digest('hex');

      const ownerSession = await db
        .prepare('SELECT id FROM owner_sessions WHERE userId=? LIMIT 1')
        .bind(owner)
        .first();

      const inviteExpires = Date.now() + 3600000;
      const sessionExpires = inviteExpires - 60000;

      await db.batch([
        db
          .prepare(
            `INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',521,?,?,?)`,
          )
          .bind(
            inviteId,
            galleryFixture.context.workspace.id,
            galleryFixture.context.project.id,
            tokenHash,
            inviteExpires,
            owner,
            ownerSession.id,
          ),
        db
          .prepare(
            'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
          )
          .bind(
            inviteId,
            galleryFixture.context.workspace.id,
            galleryFixture.context.project.id,
            albumId,
          ),
        db
          .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
          .bind(inviteId),
        db
          .prepare(
            'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
          )
          .bind(guestId, inviteId, 'Round 2 Guest'),
        db
          .prepare(
            'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
          )
          .bind(sessionId, inviteId, guestId, guestSecretHash, sessionExpires),
      ]);

      const guestCookie = `kino_guest=${guestSecret}`;
      const guestHeaders = {
        Cookie: guestCookie,
        Origin: base,
        'Content-Type': 'application/json',
      };

      // 2. Guest selects photo in round 1
      const selectRes = await selectionWorker.fetch(
        new Request(
          `${base}/api/guest/albums/${albumId}/photos/${galleryFixture.photo.photoId}/selection`,
          {
            method: 'PUT',
            headers: guestHeaders,
            body: JSON.stringify({
              requestId: randomUUID(),
              selected: true,
              versionId: galleryFixture.photo.versionId,
            }),
          },
        ),
      );
      assert.equal(selectRes.status, 200);

      // 3. Guest submits round 1
      const submitRound1Res = await selectionWorker.fetch(
        new Request(`${base}/api/guest/albums/${albumId}/selection/submit`, {
          method: 'POST',
          headers: guestHeaders,
          body: JSON.stringify({
            requestId: randomUUID(),
            expectedRoundNo: 1,
            expectedRevision: 1,
          }),
        }),
      );
      assert.equal(submitRound1Res.status, 200);
      const submitRound1 = await submitRound1Res.json();
      assert.equal(submitRound1.roundNo, 1);

      // 4. Owner reopens round 1 -> round 2 for this guest
      const reopenRequestId = randomUUID();
      const reopenRes = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/rounds/reopen`, {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: reopenRequestId,
            inviteId,
            guestId,
            expectedRoundNo: 1,
          }),
        }),
      );
      assert.equal(reopenRes.status, 200);
      const reopenData = await reopenRes.json();
      assert.equal(reopenData.reopen.roundNo, 2);
      assert.equal(reopenData.reopen.status, 'open');

      // Exact replay returns the original result and deterministic audit event.
      const exactReplay = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/rounds/reopen`, {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: reopenRequestId,
            inviteId,
            guestId,
            expectedRoundNo: 1,
          }),
        }),
      );
      assert.equal(exactReplay.status, 200);
      assert.deepEqual((await exactReplay.json()).reopen, reopenData.reopen);

      // Reusing the same request for a different guest, invite, or round conflicts.
      const changedGuestId = randomUUID();
      const changedGuestReplay = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/rounds/reopen`, {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: reopenRequestId,
            inviteId,
            guestId: changedGuestId,
            expectedRoundNo: 1,
          }),
        }),
      );
      assert.equal(changedGuestReplay.status, 409);
      assert.equal(
        (await changedGuestReplay.json()).error.code,
        'REQUEST_ID_CONFLICT',
      );

      const changedInviteReplay = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/rounds/reopen`, {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: reopenRequestId,
            inviteId: randomUUID(),
            guestId: randomUUID(),
            expectedRoundNo: 1,
          }),
        }),
      );
      assert.equal(changedInviteReplay.status, 409);
      assert.equal(
        (await changedInviteReplay.json()).error.code,
        'REQUEST_ID_CONFLICT',
      );

      const changedRoundReplay = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/rounds/reopen`, {
          method: 'POST',
          headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: reopenRequestId,
            inviteId,
            guestId,
            expectedRoundNo: 2,
          }),
        }),
      );
      assert.equal(changedRoundReplay.status, 409);
      assert.equal(
        (await changedRoundReplay.json()).error.code,
        'REQUEST_ID_CONFLICT',
      );

      const originalRoundAfterReplays = await db
        .prepare(
          'SELECT round_no,status FROM guest_selection_round_state WHERE invite_id=? AND guest_id=? AND album_id=?',
        )
        .bind(inviteId, guestId, albumId)
        .first();
      assert.deepEqual(originalRoundAfterReplays, {
        round_no: 2,
        status: 'open',
      });
      const changedGuestRound = await db
        .prepare(
          'SELECT 1 FROM guest_selection_round_state WHERE invite_id=? AND guest_id=? AND album_id=?',
        )
        .bind(inviteId, changedGuestId, albumId)
        .first();
      assert.equal(changedGuestRound, null);

      // 5. Guest checks selection state: roundNo is 2, status is open
      const guestSelectionRes = await selectionWorker.fetch(
        new Request(`${base}/api/guest/albums/${albumId}/selection`, {
          headers: { Cookie: guestCookie },
        }),
      );
      assert.equal(guestSelectionRes.status, 200);
      const guestSelection = await guestSelectionRes.json();
      assert.equal(guestSelection.roundNo, 2);
      assert.equal(guestSelection.roundStatus, 'open');

      // 6. Guest modifies selection in round 2 (deselect and re-select to bump revision)
      const deselectRes = await selectionWorker.fetch(
        new Request(
          `${base}/api/guest/albums/${albumId}/photos/${galleryFixture.photo.photoId}/selection`,
          {
            method: 'PUT',
            headers: guestHeaders,
            body: JSON.stringify({
              requestId: randomUUID(),
              selected: false,
              versionId: galleryFixture.photo.versionId,
            }),
          },
        ),
      );
      assert.equal(deselectRes.status, 200);

      const reselectRes = await selectionWorker.fetch(
        new Request(
          `${base}/api/guest/albums/${albumId}/photos/${galleryFixture.photo.photoId}/selection`,
          {
            method: 'PUT',
            headers: guestHeaders,
            body: JSON.stringify({
              requestId: randomUUID(),
              selected: true,
              versionId: galleryFixture.photo.versionId,
            }),
          },
        ),
      );
      assert.equal(reselectRes.status, 200);
      const reselectData = await reselectRes.json();
      assert.equal(reselectData.roundNo, 2);
      assert.equal(reselectData.selectionRevision, 3);

      // 7. Guest submits round 2
      const submitRound2Res = await selectionWorker.fetch(
        new Request(`${base}/api/guest/albums/${albumId}/selection/submit`, {
          method: 'POST',
          headers: guestHeaders,
          body: JSON.stringify({
            requestId: randomUUID(),
            expectedRoundNo: 2,
            expectedRevision: reselectData.selectionRevision,
          }),
        }),
      );
      assert.equal(submitRound2Res.status, 200);
      const submitRound2 = await submitRound2Res.json();
      assert.equal(submitRound2.roundNo, 2);
      assert.equal(submitRound2.selectionRevision, 3);

      // 8. Owner lists submissions: sees both round 1 and round 2 for this guest!
      const ownerListRes = await selectionWorker.fetch(
        new Request(`${base}/api/v1/albums/${albumId}/submissions`, {
          headers: ownerHeaders,
        }),
      );
      assert.equal(ownerListRes.status, 200);
      const ownerListData = await ownerListRes.json();
      const guestSubmissions = ownerListData.submissions.filter(
        (s) => s.guestId === guestId,
      );
      assert.equal(guestSubmissions.length, 2);
      assert.equal(guestSubmissions[0].roundNo, 2);
      assert.equal(guestSubmissions[1].roundNo, 1);
      assert.equal(guestSubmissions[0].sealed, true);
      assert.equal(guestSubmissions[1].sealed, true);

      await runOwnerSelectionBrowserChecks({
        worker: selectionWorker,
        baseUrl: base,
        ownerCookie: cookies.values.get('kino-owner.session_token'),
        projectId,
        albumId,
        db,
        guestId,
        verifyRound2Only: true,
      });
    },
  );
}
