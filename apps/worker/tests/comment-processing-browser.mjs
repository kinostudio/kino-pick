import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import {
  guestCommentsPageSchema,
  guestCommentResultSchema,
} from '../../../packages/contracts/src/guest-comments.ts';
import { ownerCommentProcessingResultSchema } from '../../../packages/contracts/src/comment-processing.ts';
import {
  ownerCookieValue,
  guestCookieName,
  projectAndAlbumNames,
  createGuestParent,
  makeBrowserState,
  openOwnerPhoto,
  selectOwnerScope,
  ensureThreadBodyVisible,
  waitForTargetOwnerRead,
  assertNoHorizontalOverflow,
  itemRow,
  openGuestPanel,
} from './owner-comments-browser.mjs';

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

async function waitForProcessingMutation(state, requestId, dropped) {
  await expect
    .poll(() =>
      state.observations.ownerMutations.some(
        (record) =>
          record.requestBody?.requestId === requestId &&
          record.requestBody?.operation === 'set_processing_state' &&
          record.status === 200 &&
          record.dropped === dropped,
      ),
    )
    .toBe(true);
  return state.observations.ownerMutations.find(
    (record) =>
      record.requestBody?.requestId === requestId &&
      record.requestBody?.operation === 'set_processing_state' &&
      record.status === 200 &&
      record.dropped === dropped,
  );
}

async function processingFootprint(db, ownerId, requestId, commentId) {
  const counts = await db
    .prepare(
      "SELECT (SELECT count(*) FROM owner_comment_processing_commands WHERE actor_id=? AND request_id=?) AS commands,(SELECT count(*) FROM owner_comment_processing_state WHERE comment_id=?) AS state_rows,(SELECT count(*) FROM owner_comment_processing_changes WHERE actor_id=? AND request_id=?) AS changes,(SELECT count(*) FROM owner_comment_processing_results WHERE actor_id=? AND request_id=?) AS results,(SELECT count(*) FROM comment_thread_changes t JOIN owner_comment_processing_changes c ON c.event_id=t.source_event_id WHERE c.actor_id=? AND c.request_id=? AND t.source_kind='owner') AS markers,(SELECT count(*) FROM audit_events e JOIN owner_comment_processing_changes c ON c.event_id=e.event_id WHERE c.actor_id=? AND c.request_id=? AND e.actor_id=? AND e.action='owner.comment_processing_changed' AND e.actor_type='user' AND e.guest_session_id IS NULL) AS audits",
    )
    .bind(
      ownerId,
      requestId,
      commentId,
      ownerId,
      requestId,
      ownerId,
      requestId,
      ownerId,
      requestId,
      ownerId,
      requestId,
      ownerId,
    )
    .first();
  const state = await db
    .prepare(
      'SELECT state,revision,comment_revision,content_revision FROM owner_comment_processing_state WHERE comment_id=?',
    )
    .bind(commentId)
    .first();
  return { counts, state };
}

export async function runCommentProcessingBrowserChecks({
  db,
  worker,
  guestWorker,
  base,
  ownerCookie,
  fixture,
  owner,
}) {
  assert.ok(db && worker && guestWorker && base && owner);
  assert.ok(
    ownerCookie,
    'The processing browser check requires an Owner cookie',
  );
  for (const key of [
    'albumId',
    'photoId',
    'versionId',
    'currentVersionId',
    'filename',
    'authorInviteId',
    'secretAuthor',
    'authorGuestId',
    'secretPeer',
    'secretOtherInvite',
  ])
    assert.ok(fixture?.[key], 'The comment fixture provides ' + key);

  const parentBody = 'Processing UI parent ' + randomUUID();
  const parent = await createGuestParent({
    guestWorker,
    base,
    fixture,
    body: parentBody,
  });

  const { albumName, projectName, projectId } = await projectAndAlbumNames(
    db,
    fixture.albumId,
  );
  const browser = await chromium.launch({ headless: true });
  let ownerState;
  let guestState;
  try {
    ownerState = await makeBrowserState({
      browser,
      worker,
      base,
      cookieName: 'kino-owner.session_token',
      cookieValue: ownerCookieValue(ownerCookie),
      kind: 'owner',
      albumId: fixture.albumId,
      mutationSuffix: 'comment-processing',
    });
    const { page, observations } = ownerState;
    let { panel } = await openOwnerPhoto({
      page,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    await selectOwnerScope(panel, fixture);
    await ensureThreadBodyVisible(panel, parentBody);

    let guestItem = itemRow(panel, '訪客留言', parentBody);
    await expect(guestItem.article).toBeVisible();
    await expect(
      guestItem.article.getByText('攝影師處理：待處理', { exact: true }),
    ).toBeVisible();
    await expect(
      guestItem.row.getByRole('button', { name: '標記待處理', exact: true }),
    ).toBeDisabled();
    const inProgress = guestItem.row.getByRole('button', {
      name: '標記處理中',
      exact: true,
    });
    await expect(inProgress).toBeEnabled();

    ownerState.dropNextSuccessfulOwnerMutationResponse();
    await inProgress.click();
    await expect
      .poll(() =>
        observations.ownerMutations.some(
          (record) =>
            record.requestBody?.operation === 'set_processing_state' &&
            record.status === 200 &&
            record.dropped,
        ),
      )
      .toBe(true);
    const dropped = observations.ownerMutations.find(
      (record) =>
        record.requestBody?.operation === 'set_processing_state' &&
        record.status === 200 &&
        record.dropped,
    );
    assert.ok(dropped?.requestBody?.requestId);
    assert.deepEqual(Object.keys(dropped.requestBody).sort(), [
      'commentId',
      'expectedCommentRevision',
      'expectedProcessingRevision',
      'inviteId',
      'operation',
      'photoId',
      'requestId',
      'state',
      'versionId',
    ]);
    assert.equal(dropped.requestBody.operation, 'set_processing_state');
    assert.equal(dropped.requestBody.inviteId, fixture.authorInviteId);
    assert.equal(dropped.requestBody.photoId, fixture.photoId);
    assert.equal(dropped.requestBody.versionId, fixture.versionId);
    assert.equal(dropped.requestBody.commentId, parent.commentId);
    assert.equal(dropped.requestBody.expectedCommentRevision, parent.revision);
    assert.equal(dropped.requestBody.expectedProcessingRevision, 0);
    assert.equal(dropped.requestBody.state, 'in_progress');
    const lostReceipt = ownerCommentProcessingResultSchema.parse(
      dropped.responseBody,
    );
    assert.equal(lostReceipt.requestId, dropped.requestBody.requestId);
    assert.deepEqual(lostReceipt.processing, {
      state: 'in_progress',
      revision: 1,
      commentRevision: parent.revision,
      contentRevision: parent.revision,
      updatedAt: lostReceipt.occurredAt,
      stale: false,
    });
    assert.equal(JSON.stringify(lostReceipt).includes(parentBody), false);
    assert.equal(
      (
        await processingFootprint(
          db,
          owner,
          dropped.requestBody.requestId,
          parent.commentId,
        )
      ).counts.commands,
      1,
    );
    await expect(
      panel.getByText('有一筆攝影師留言操作尚待確認', { exact: true }),
    ).toBeVisible();

    const journalKey =
      'kino-pic:owner-comments:v1:' + owner + ':' + fixture.albumId;
    const storedJournal = await page.evaluate((key) => {
      const value = sessionStorage.getItem(key);
      return value === null ? null : JSON.parse(value);
    }, journalKey);
    assert.ok(storedJournal);
    assert.deepEqual(Object.keys(storedJournal).sort(), [
      'actorId',
      'albumId',
      'commentId',
      'expectedCommentRevision',
      'expectedProcessingRevision',
      'inviteId',
      'operation',
      'photoId',
      'requestId',
      'state',
      'versionId',
    ]);
    const serializedJournal = JSON.stringify(storedJournal);
    assert.equal(serializedJournal.includes(parentBody), false);
    assert.equal(
      serializedJournal.includes(ownerCookieValue(ownerCookie)),
      false,
    );
    assert.equal(serializedJournal.includes(fixture.secretAuthor), false);
    assert.equal(serializedJournal.includes(fixture.secretPeer), false);
    assert.equal(serializedJournal.includes('bodySha256'), false);

    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { name: albumName, exact: true }),
    ).toBeVisible();
    const reopened = await openOwnerPhoto({
      page,
      base,
      projectId,
      projectName,
      albumName,
      filename: fixture.filename,
    });
    panel = reopened.panel;
    await selectOwnerScope(panel, fixture);
    await ensureThreadBodyVisible(panel, parentBody);
    const retry = panel.getByRole('button', {
      name: '以相同操作重試',
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(
      panel.locator('#owner-comment-recovery-' + fixture.albumId),
    ).toHaveCount(0);
    await retry.click();

    const replay = await waitForProcessingMutation(
      ownerState,
      dropped.requestBody.requestId,
      false,
    );
    assert.deepEqual(replay.requestBody, dropped.requestBody);
    assert.deepEqual(
      ownerCommentProcessingResultSchema.parse(replay.responseBody),
      lostReceipt,
    );
    const replayRead = await waitForTargetOwnerRead(
      ownerState,
      fixture,
      fixture.authorInviteId,
      parent.commentId,
      replay.sequence,
    );
    assert.equal(replayRead.responseBody.items[0].body, parentBody);
    assert.equal(replayRead.responseBody.items[0].revision, parent.revision);
    assert.deepEqual(
      replayRead.responseBody.items[0].processing,
      lostReceipt.processing,
    );
    assert.deepEqual(
      await processingFootprint(
        db,
        owner,
        dropped.requestBody.requestId,
        parent.commentId,
      ),
      {
        counts: {
          commands: 1,
          state_rows: 1,
          changes: 1,
          results: 1,
          markers: 1,
          audits: 1,
        },
        state: {
          state: 'in_progress',
          revision: 1,
          comment_revision: parent.revision,
          content_revision: parent.revision,
        },
      },
    );

    await expect(
      panel.getByText('有一筆攝影師留言操作尚待確認', { exact: true }),
    ).toHaveCount(0);

    // A receipt read precedes final identity reconciliation and journal cleanup.
    await expect
      .poll(() =>
        page.evaluate((key) => sessionStorage.getItem(key), journalKey),
      )
      .toBe(null);

    const editedBody = 'Guest edit after Owner processing ' + randomUUID();
    const guestEditRequestId = randomUUID();
    const guestEditResponse = await guestWorker.fetch(
      new Request(
        new URL(
          '/api/guest/albums/' +
            encodeURIComponent(fixture.albumId) +
            '/comments/commands',
          base,
        ),
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Origin: new URL(base).origin,
            Cookie: guestCookieName(base) + '=' + fixture.secretAuthor,
            'Content-Type': 'application/json',
            'cf-connecting-ip': '198.51.100.188',
          },
          body: JSON.stringify({
            requestId: guestEditRequestId,
            expectedGuestId: fixture.authorGuestId,
            operation: 'edit',
            commentId: parent.commentId,
            expectedRevision: parent.revision,
            body: editedBody,
          }),
          redirect: 'manual',
        },
      ),
    );
    const guestEditBody = parseJson(await guestEditResponse.arrayBuffer());
    assert.equal(guestEditResponse.status, 200, JSON.stringify(guestEditBody));
    const guestEdit = guestCommentResultSchema.parse(guestEditBody);
    assert.equal(guestEdit.items[0].body, editedBody);
    assert.equal(guestEdit.items[0].revision, parent.revision + 1);

    const readsBeforeFocus = observations.ownerThreadReads.length;
    await page.bringToFront();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect
      .poll(() =>
        observations.ownerThreadReads
          .slice(readsBeforeFocus)
          .some(
            (record) =>
              record.status === 200 &&
              record.responseBody?.items?.some(
                (item) =>
                  item.commentId === parent.commentId &&
                  item.processing?.stale === true,
              ),
          ),
      )
      .toBe(true);
    guestItem = itemRow(panel, '訪客留言', editedBody);
    await expect(guestItem.article).toBeVisible();
    await expect(
      guestItem.article.getByText(/^攝影師處理：處理中/u),
    ).toBeVisible();
    await expect(
      guestItem.article.getByText('留言有新的編輯，請攝影師重新確認', {
        exact: true,
      }),
    ).toBeVisible();
    const acknowledge = guestItem.row.getByRole('button', {
      name: '標記處理中',
      exact: true,
    });
    await expect(acknowledge).toBeEnabled();
    assert.deepEqual(
      await db
        .prepare(
          'SELECT revision,comment_revision,content_revision,state FROM owner_comment_processing_state WHERE comment_id=?',
        )
        .bind(parent.commentId)
        .first(),
      {
        revision: 1,
        comment_revision: parent.revision,
        content_revision: parent.revision,
        state: 'in_progress',
      },
    );

    await acknowledge.click();
    await expect
      .poll(() =>
        observations.ownerMutations.some(
          (record) =>
            record.requestBody?.operation === 'set_processing_state' &&
            record.requestBody?.state === 'in_progress' &&
            record.requestBody?.expectedProcessingRevision === 1 &&
            record.requestBody?.expectedCommentRevision ===
              parent.revision + 1 &&
            record.status === 200 &&
            !record.dropped,
        ),
      )
      .toBe(true);
    const acknowledgeRecord = observations.ownerMutations.find(
      (record) =>
        record.requestBody?.operation === 'set_processing_state' &&
        record.requestBody?.state === 'in_progress' &&
        record.requestBody?.expectedProcessingRevision === 1 &&
        record.requestBody?.expectedCommentRevision === parent.revision + 1 &&
        record.status === 200 &&
        !record.dropped,
    );
    assert.ok(acknowledgeRecord?.requestBody?.requestId);
    const acknowledgeReceipt = ownerCommentProcessingResultSchema.parse(
      acknowledgeRecord.responseBody,
    );
    assert.deepEqual(acknowledgeReceipt.processing, {
      state: 'in_progress',
      revision: 2,
      commentRevision: parent.revision + 1,
      contentRevision: parent.revision + 1,
      updatedAt: acknowledgeReceipt.occurredAt,
      stale: false,
    });
    const acknowledgeRead = await waitForTargetOwnerRead(
      ownerState,
      fixture,
      fixture.authorInviteId,
      parent.commentId,
      acknowledgeRecord.sequence,
    );
    assert.equal(acknowledgeRead.responseBody.items[0].body, editedBody);
    assert.deepEqual(
      acknowledgeRead.responseBody.items[0].processing,
      acknowledgeReceipt.processing,
    );
    await expect(
      guestItem.article.getByText('攝影師處理：處理中', { exact: true }),
    ).toBeVisible();
    await expect(
      guestItem.article.getByText('留言有新的編輯，請攝影師重新確認', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(acknowledge).toBeDisabled();

    const ackFootprint = await processingFootprint(
      db,
      owner,
      acknowledgeRecord.requestBody.requestId,
      parent.commentId,
    );
    assert.deepEqual(ackFootprint.counts, {
      commands: 1,
      state_rows: 1,
      changes: 1,
      results: 1,
      markers: 1,
      audits: 1,
    });
    assert.deepEqual(ackFootprint.state, {
      state: 'in_progress',
      revision: 2,
      comment_revision: parent.revision + 1,
      content_revision: parent.revision + 1,
    });
    const commentChanges = await db
      .prepare(
        'SELECT count(*) AS n FROM owner_comment_processing_changes WHERE comment_id=?',
      )
      .bind(parent.commentId)
      .first();
    assert.equal(commentChanges.n, 2);

    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/comment-processing-mobile.png',
      fullPage: false,
    });
    await assertNoHorizontalOverflow(page, 'Owner processing panel');

    guestState = await makeBrowserState({
      browser,
      worker: guestWorker,
      base,
      cookieName: guestCookieName(base),
      cookieValue: fixture.secretPeer,
      kind: 'guest',
      albumId: fixture.albumId,
    });
    const guestPanel = await openGuestPanel({
      page: guestState.page,
      base,
      albumId: fixture.albumId,
      fixture: { ...fixture, replyId: parent.commentId },
      currentVersionId: fixture.currentVersionId,
    });
    const peerItem = guestPanel.getByTestId('comment-item-' + parent.commentId);
    await expect(peerItem).toBeVisible();
    await expect(
      peerItem.getByText('攝影師處理：處理中', { exact: true }),
    ).toBeVisible();
    await expect(
      peerItem.getByText('留言有新的編輯，請攝影師重新確認', { exact: true }),
    ).toHaveCount(0);
    await expect(
      guestPanel.getByRole('button', { name: /標記(?:待處理|處理中|已處理)/u }),
    ).toHaveCount(0);
    await assertNoHorizontalOverflow(guestState.page, 'Guest processing panel');

    const otherInviteUrl = new URL(
      '/api/guest/albums/' +
        encodeURIComponent(fixture.albumId) +
        '/photos/' +
        encodeURIComponent(fixture.photoId) +
        '/versions/' +
        encodeURIComponent(fixture.versionId) +
        '/comments',
      base,
    );
    otherInviteUrl.searchParams.set('commentId', parent.commentId);
    const otherInviteResponse = await guestWorker.fetch(
      new Request(otherInviteUrl, {
        headers: {
          Accept: 'application/json',
          Cookie: guestCookieName(base) + '=' + fixture.secretOtherInvite,
          'cf-connecting-ip': '198.51.100.189',
        },
        redirect: 'manual',
      }),
    );
    const otherInviteBody = parseJson(await otherInviteResponse.arrayBuffer());
    assert.equal(otherInviteResponse.status, 200);
    const otherInvitePage = guestCommentsPageSchema.parse(otherInviteBody);
    assert.equal(
      otherInvitePage.items.some((item) => item.commentId === parent.commentId),
      false,
    );
    assert.equal(
      JSON.stringify(otherInvitePage).includes('in_progress'),
      false,
    );

    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
    assert.deepEqual(guestState.observations.bridgeErrors, []);
    assert.deepEqual(guestState.observations.pageErrors, []);
  } finally {
    if (guestState) await guestState.close();
    if (ownerState) await ownerState.close();
    await browser.close();
  }
}
