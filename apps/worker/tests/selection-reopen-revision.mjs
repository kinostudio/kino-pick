import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ownerFetch,
  createIndependentActiveAlbum,
  createThreeVisiblePhotos,
  issueTwoUseInvite,
  exchangeFreshGuest,
} from './selection-limit-guest-browser.mjs';

export async function reopenedSelectionRevisionChecks({
  worker,
  base,
  ownerCookie,
  db,
  galleryFixture,
  check,
}) {
  await check(
    'Reopened retained selections submit unchanged at revision1, enforce current bounds and preserve earlier snapshots/replays',
    async () => {
      const album = await createIndependentActiveAlbum({
        worker,
        base,
        ownerCookie,
        db,
        galleryFixture,
      });
      const photos = await createThreeVisiblePhotos({
        db,
        galleryFixture,
        albumId: album.albumId,
      });
      const ownerCall = (path, method = 'GET', body) =>
        ownerFetch({ worker, base, ownerCookie, path, method, body });
      const policyPath =
        '/api/v1/albums/' + album.albumId + '/selection-policy';
      const policy = async (expectedRevision, minimum, maximum) => {
        const response = await ownerCall(policyPath, 'PUT', {
          requestId: randomUUID(),
          expectedRevision,
          minimum,
          maximum,
          confirm: true,
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      await policy(0, 1, 2);
      const invite = await issueTwoUseInvite({
        worker,
        base,
        ownerCookie,
        projectId: album.projectId,
        albumId: album.albumId,
      });
      const guest = await exchangeFreshGuest({
        worker,
        base,
        invite,
        albumId: album.albumId,
        address: '198.51.100.161',
        label: 'reopen',
      });
      const guestCall = (path, method = 'GET', body) =>
        worker.fetch(
          new Request(new URL(path, base), {
            method,
            headers: {
              Accept: 'application/json',
              Cookie: guest.cookieName + '=' + guest.cookieValue,
              Origin: new URL(base).origin,
              ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          }),
        );
      const selectionPath = '/api/guest/albums/' + album.albumId + '/selection';
      const select = async (photo) => {
        const r = await guestCall(
          '/api/guest/albums/' +
            album.albumId +
            '/photos/' +
            photo.photoId +
            '/selection',
          'PUT',
          {
            requestId: randomUUID(),
            versionId: photo.versionId,
            selected: true,
          },
        );
        assert.equal(r.status, 200);
      };
      const submit = async (body) =>
        guestCall(selectionPath + '/submit', 'POST', body);
      const read = async () => {
        const r = await guestCall(selectionPath);
        assert.equal(r.status, 200);
        return r.json();
      };
      const reopen = async (expectedRoundNo) => {
        const body = {
          requestId: randomUUID(),
          inviteId: invite.inviteId,
          guestId: guest.guestId,
          expectedRoundNo,
        };
        const r = await ownerCall(
          '/api/v1/albums/' + album.albumId + '/rounds/reopen',
          'POST',
          body,
        );
        assert.equal(r.status, 200);
        const value = await r.json();
        assert.equal(value.reopen.selectionRevision, 1);
        return { body, value };
      };
      await select(photos[0]);
      await select(photos[1]);
      const firstPage = await read();
      const firstBody = {
        requestId: randomUUID(),
        expectedRoundNo: firstPage.roundNo,
        expectedRevision: firstPage.selectionRevision,
      };
      const firstResponse = await submit(firstBody);
      assert.equal(firstResponse.status, 200);
      const first = await firstResponse.json();
      const items = async (id) =>
        (
          await db
            .prepare(
              'SELECT photo_id,version_id,selected_at_ms FROM guest_selection_submission_items WHERE submission_id=? ORDER BY photo_id',
            )
            .bind(id)
            .all()
        ).results;
      const original = await items(first.submissionId);
      await policy(1, 1, 1);
      const reopened = await reopen(1);
      const page = await read();
      assert.equal(page.roundNo, 2);
      assert.equal(page.selectionRevision, 1);
      assert.equal(page.selectedCount, 2);
      const secondBody = {
        requestId: randomUUID(),
        expectedRoundNo: 2,
        expectedRevision: 1,
      };
      const denied = await submit(secondBody);
      assert.equal(denied.status, 409);
      assert.equal((await denied.json()).error.code, 'SELECTION_LIMIT_REACHED');
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_submissions WHERE request_id=?',
            )
            .bind(secondBody.requestId)
            .first()
        ).n,
        0,
      );
      assert.equal((await read()).roundStatus, 'open');
      await policy(2, 1, 2);
      const secondResponse = await submit(secondBody);
      assert.equal(secondResponse.status, 200);
      const second = await secondResponse.json();
      assert.equal(second.selectionRevision, 1);
      assert.equal(second.selectedCount, 2);
      assert.deepEqual(await items(second.submissionId), original);
      assert.deepEqual(await items(first.submissionId), original);
      const oldReplay = await submit(firstBody);
      assert.equal(oldReplay.status, 200);
      assert.deepEqual(await oldReplay.json(), first);
      const reopenReplay = await ownerCall(
        '/api/v1/albums/' + album.albumId + '/rounds/reopen',
        'POST',
        reopened.body,
      );
      assert.equal(reopenReplay.status, 200);
      assert.deepEqual(await reopenReplay.json(), reopened.value);
      assert.equal((await read()).roundStatus, 'submitted');
      await policy(3, 3, 3);
      await reopen(2);
      const thirdBody = {
        requestId: randomUUID(),
        expectedRoundNo: 3,
        expectedRevision: 1,
      };
      const under = await submit(thirdBody);
      assert.equal(under.status, 409);
      assert.equal(
        (await under.json()).error.code,
        'SELECTION_MINIMUM_NOT_MET',
      );
      await select(photos[2]);
      const thirdPage = await read();
      assert.equal(thirdPage.selectedCount, 3);
      const thirdResponse = await submit({
        requestId: randomUUID(),
        expectedRoundNo: 3,
        expectedRevision: thirdPage.selectionRevision,
      });
      assert.equal(thirdResponse.status, 200);
      assert.deepEqual(await items(first.submissionId), original);
      assert.deepEqual(await items(second.submissionId), original);
      assert.equal(
        (
          await db
            .prepare(
              'SELECT count(*) AS n FROM guest_selection_submissions WHERE guest_id=? AND album_id=?',
            )
            .bind(guest.guestId, album.albumId)
            .first()
        ).n,
        3,
      );
    },
  );
}
