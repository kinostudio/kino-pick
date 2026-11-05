import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

export async function runGuestSelectionBrowserChecks({
  worker,
  baseUrl,
  guestCookie,
  albumId,
  db,
  guestId,
}) {
  const source = await db
    .prepare(
      `SELECT p.workspace_id,p.project_id,p.album_id,v.created_by_actor,v.source_hash_sha256,
        v.byte_size,v.mime,v.width,v.height,v.status,a.storage_node_id
       FROM photos p
       JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1
       JOIN photo_assets a ON a.version_id=v.id AND a.asset_kind='original'
       WHERE p.album_id=? ORDER BY p.created_at,p.id LIMIT 1`,
    )
    .bind(albumId)
    .first();
  assert.ok(source, 'The browser fixture needs one owned source photo');

  const existingVisible = await db
    .prepare(
      `SELECT count(*) AS n FROM photos p
       JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1
       JOIN photo_assets a ON a.version_id=v.id AND a.asset_kind='original'
       WHERE p.album_id=?`,
    )
    .bind(albumId)
    .first();
  const expectedPhotoCount = Math.max(25, existingVisible.n);
  const extraPhotoCount = expectedPhotoCount - existingVisible.n;
  const fixtureStatements = [];
  for (let index = 0; index < extraPhotoCount; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    fixtureStatements.push(
      db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          photoId,
          source.workspace_id,
          source.project_id,
          albumId,
          `browser-page-${index + 1}.jpg`,
        ),
      db
        .prepare(
          `INSERT INTO photo_versions(
            id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,
            source_hash_sha256,byte_size,mime,width,height,status
          ) VALUES(?,?,?,1,NULL,?,?,?,?,?,?,?)`,
        )
        .bind(
          versionId,
          source.workspace_id,
          photoId,
          source.created_by_actor,
          source.source_hash_sha256,
          source.byte_size,
          source.mime,
          source.width,
          source.height,
          source.status,
        ),
      db
        .prepare(
          `INSERT INTO photo_assets(
            id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,
            object_key,byte_size,mime,checksum_sha256,state
          ) VALUES(?,?,?,?,?,'original',?,?,?,?, 'private')`,
        )
        .bind(
          assetId,
          source.workspace_id,
          photoId,
          versionId,
          source.storage_node_id,
          `${source.workspace_id}/${source.project_id}/${albumId}/${photoId}/original.jpg`,
          source.byte_size,
          source.mime,
          source.source_hash_sha256,
        ),
    );
  }
  if (fixtureStatements.length > 0) await db.batch(fixtureStatements);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      {
        name: 'kino_guest',
        value: guestCookie,
        url: baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ]);

    const page = await context.newPage();
    const requests = [];
    const logoutAttempts = [];
    const galleryPageSizes = [];
    const selectionPageSizes = [];
    let failFirstLogout = true;
    let forceStaleCursorOnNextRead = false;
    let staleCursorResponse = null;

    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const method = incoming.method();
      const init = {
        method,
        headers: await incoming.allHeaders(),
        redirect: 'manual',
      };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = incoming.postDataBuffer() ?? undefined;
      }
      const url = new URL(incoming.url());
      let response;
      if (
        forceStaleCursorOnNextRead &&
        url.pathname === `/api/guest/albums/${albumId}/selection` &&
        url.searchParams.has('cursor')
      ) {
        forceStaleCursorOnNextRead = false;
        const selected = await db
          .prepare(
            'SELECT photo_id,version_id FROM guest_selection_state WHERE guest_id=? AND album_id=? LIMIT 1',
          )
          .bind(guestId, albumId)
          .first();
        assert.ok(selected, 'The stale-cursor check needs a selected photo');
        for (const isSelected of [false, true]) {
          const changed = await worker.fetch(
            new Request(
              `${baseUrl}/api/guest/albums/${albumId}/photos/${selected.photo_id}/selection`,
              {
                method: 'PUT',
                headers: {
                  Origin: baseUrl,
                  Cookie: `kino_guest=${guestCookie}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  requestId: randomUUID(),
                  selected: isSelected,
                  versionId: selected.version_id,
                }),
              },
            ),
          );
          assert.equal(changed.status, 200);
        }
        response = await worker.fetch(new Request(incoming.url(), init));
        staleCursorResponse = response.status;
      } else if (
        method === 'POST' &&
        url.pathname === '/api/guest/logout' &&
        failFirstLogout
      ) {
        failFirstLogout = false;
        logoutAttempts.push(JSON.parse(incoming.postData() ?? '{}'));
        response = new Response(
          JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      } else {
        response = await worker.fetch(new Request(incoming.url(), init));
        if (method === 'POST' && url.pathname === '/api/guest/logout') {
          logoutAttempts.push(JSON.parse(incoming.postData() ?? '{}'));
        }
      }

      if (
        url.pathname.includes('/selection') &&
        (method === 'PUT' || method === 'POST')
      ) {
        requests.push({
          path: url.pathname,
          method,
          status: response.status,
          postData: incoming.postData(),
        });
      }
      const responseBody = Buffer.from(await response.arrayBuffer());
      if (
        response.ok &&
        url.pathname === `/api/guest/albums/${albumId}/photos`
      ) {
        galleryPageSizes.push(
          JSON.parse(responseBody.toString('utf8')).photos.length,
        );
      }
      if (
        response.ok &&
        url.pathname === `/api/guest/albums/${albumId}/selection`
      ) {
        selectionPageSizes.push(
          JSON.parse(responseBody.toString('utf8')).items.length,
        );
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      });
    });

    // Navigate to guest album page
    await page.goto(`${baseUrl}/guest/albums/${albumId}`, {
      waitUntil: 'networkidle',
    });

    // 1. Verify page elements
    await expect(
      page.getByRole('heading', { name: /Kino Pick.*線上挑片/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '離開相簿' })).toBeVisible();

    const photoList = page.getByRole('list', { name: '相簿照片列表' });
    await expect(photoList.locator('li')).toHaveCount(24);
    await expect(page.getByText('24 張照片 · 第 1 頁')).toBeVisible();

    // Individual selection checkboxes remain usable on each bounded page.
    const checkbox = page.getByRole('checkbox', { name: /選取/ }).first();
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await photoList.locator('li').first().hover();
    await expect(checkbox.locator('xpath=ancestor::label[1]')).toHaveCSS(
      'opacity',
      '1',
    );

    // Verify initial selection count
    const bottomBar = page.getByLabel('選片統計與送出列');
    await expect(bottomBar).toBeVisible();
    await expect(bottomBar.getByText(/已選取 0 張照片/)).toBeVisible();

    // "送出挑片" button should be disabled when 0 photos are selected
    const submitBtn = bottomBar.getByRole('button', { name: '送出挑片' });
    await expect(submitBtn).toBeDisabled();

    // 2. Happy path: Toggle selection (select photo)
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(bottomBar.getByText(/已選取 1 張照片/)).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // Verify D1 state updated
    const selectedStateAfterAdd = await db
      .prepare(
        'SELECT count(*) AS n FROM guest_selection_state WHERE guest_id=? AND album_id=?',
      )
      .bind(guestId, albumId)
      .first();
    assert.equal(selectedStateAfterAdd.n, 1);

    // 3. Happy path: Deselect photo
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    await expect(bottomBar.getByText(/已選取 0 張照片/)).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    const selectedStateAfterRemove = await db
      .prepare(
        'SELECT count(*) AS n FROM guest_selection_state WHERE guest_id=? AND album_id=?',
      )
      .bind(guestId, albumId)
      .first();
    assert.equal(selectedStateAfterRemove.n, 0);

    // Reselect photo for submission
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await expect(bottomBar.getByText(/已選取 1 張照片/)).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // Batch-select only the 24 currently displayed photos with ordered PUTs.
    const firstBatchStart = requests.filter(
      (item) => item.method === 'PUT',
    ).length;
    await page.getByRole('button', { name: '選取目前顯示頁面' }).click();
    await expect(bottomBar.getByText(/已選取 24 張照片/)).toBeVisible();
    const selectedStateAfterFirstBatch = await db
      .prepare(
        'SELECT count(*) AS n FROM guest_selection_state WHERE guest_id=? AND album_id=?',
      )
      .bind(guestId, albumId)
      .first();
    assert.equal(selectedStateAfterFirstBatch.n, 24);

    const firstPageBatch = requests
      .filter((item) => item.method === 'PUT')
      .slice(firstBatchStart);
    assert.equal(firstPageBatch.length, 23);
    for (const [index, item] of firstPageBatch.entries()) {
      const body = JSON.parse(item.postData);
      assert.equal(body.selected, true);
      assert.match(
        body.requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const resultRow = await db
        .prepare(
          `SELECT r.result_json FROM guest_selection_commands c
           JOIN guest_selection_results r ON r.command_id=c.id
           WHERE c.guest_id=? AND c.request_id=?`,
        )
        .bind(guestId, body.requestId)
        .first();
      assert.ok(
        resultRow,
        'Each batch item must have its own D1 command result',
      );
      assert.equal(JSON.parse(resultRow.result_json).selectedCount, index + 2);
    }

    // The next request is bounded to the remaining page, which can also be selected.
    await page.getByRole('button', { name: '載入下一頁照片' }).click();
    const lastPageSize = expectedPhotoCount - 24;
    await expect(
      page.getByText(`${lastPageSize} 張照片 · 第 2 頁`),
    ).toBeVisible();
    await expect(photoList.locator('li')).toHaveCount(lastPageSize);
    const lastPageBatchStart = requests.filter(
      (item) => item.method === 'PUT',
    ).length;
    await page.getByRole('button', { name: '選取目前顯示頁面' }).click();
    await expect(
      bottomBar.getByText(new RegExp(`已選取 ${expectedPhotoCount} 張照片`)),
    ).toBeVisible();
    const selectedStateAfterLastBatch = await db
      .prepare(
        'SELECT count(*) AS n FROM guest_selection_state WHERE guest_id=? AND album_id=?',
      )
      .bind(guestId, albumId)
      .first();
    assert.equal(selectedStateAfterLastBatch.n, expectedPhotoCount);
    const lastPageBatch = requests
      .filter((item) => item.method === 'PUT')
      .slice(lastPageBatchStart);
    assert.equal(lastPageBatch.length, lastPageSize);
    for (const item of lastPageBatch) {
      const body = JSON.parse(item.postData);
      assert.equal(body.selected, true);
      assert.ok(body.versionId);
    }

    // A new page load rebuilds the full selection map from every 24-item cursor page.
    forceStaleCursorOnNextRead = true;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { name: /Kino Pick.*線上挑片/ }),
    ).toBeVisible();
    await expect(
      page
        .getByLabel('選片統計與送出列')
        .getByText(new RegExp(`已選取 ${expectedPhotoCount} 張照片`)),
    ).toBeVisible();
    assert.equal(
      staleCursorResponse,
      409,
      'A stale selection cursor should be rejected and reloaded safely',
    );

    await page.getByRole('button', { name: '載入下一頁照片' }).click();
    await expect(
      page.getByText(`${lastPageSize} 張照片 · 第 2 頁`),
    ).toBeVisible();
    const reloadedPageTwoCheckboxes = photoList.getByRole('checkbox');
    await expect(reloadedPageTwoCheckboxes).toHaveCount(lastPageSize);
    for (let index = 0; index < lastPageSize; index += 1) {
      await expect(reloadedPageTwoCheckboxes.nth(index)).toBeChecked();
    }
    await page.getByRole('button', { name: '上一頁照片' }).click();
    const reloadedPageOneCheckboxes = photoList.getByRole('checkbox');
    await expect(reloadedPageOneCheckboxes).toHaveCount(24);
    for (let index = 0; index < 24; index += 1) {
      await expect(reloadedPageOneCheckboxes.nth(index)).toBeChecked();
    }

    // Confirmation keeps focus inside the dialog, dismisses with Escape, then restores it.
    const freshBottomBar = page.getByLabel('選片統計與送出列');
    const freshSubmitBtn = freshBottomBar.getByRole('button', {
      name: '送出挑片',
    });
    await freshSubmitBtn.click();
    const dialog = page.getByRole('dialog', { name: '確認送出挑片？' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '返回修改' }),
    ).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const confirmBtn = dialog.getByRole('button', {
      name: '確認送出本輪挑片',
    });
    await expect(confirmBtn).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      dialog.getByRole('button', { name: '返回修改' }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(freshSubmitBtn).toBeFocused();

    // 4. Submit selection with the existing confirmation and frozen-round semantics.
    await freshSubmitBtn.click();
    const reopenedDialog = page.getByRole('dialog', { name: '確認送出挑片？' });
    await expect(
      reopenedDialog.getByText(/本輪選片將會凍結並永久封存/),
    ).toBeVisible();
    const confirmAgain = reopenedDialog.getByRole('button', {
      name: '確認送出本輪挑片',
    });
    await confirmAgain.click();

    // Wait for submission success banner
    await expect(page.getByText('✓ 挑片已成功送出！')).toBeVisible();
    await expect(page.getByText('已送出凍結')).toBeVisible();

    // Checkbox must now be disabled to prevent modifications
    await expect(reloadedPageOneCheckboxes.first()).toBeDisabled();

    // Bottom bar now shows completed
    await expect(freshBottomBar.getByText('已完成提交')).toBeVisible();

    // 5. Verify the entire multi-page D1 snapshot and each pinned version.
    const submissionRecord = await db
      .prepare(
        'SELECT id, round_no, selection_revision FROM guest_selection_submissions WHERE guest_id=? AND album_id=?',
      )
      .bind(guestId, albumId)
      .first();
    assert.ok(submissionRecord);
    assert.equal(submissionRecord.round_no, 1);

    const submissionItems = await db
      .prepare(
        'SELECT photo_id, version_id FROM guest_selection_submission_items WHERE submission_id=?',
      )
      .bind(submissionRecord.id)
      .all();
    assert.equal(submissionItems.results.length, expectedPhotoCount);
    for (const item of submissionItems.results) {
      const photoRow = await db
        .prepare(
          'SELECT p.id, v.id AS version_id FROM photos p JOIN photo_versions v ON v.photo_id=p.id WHERE p.id=? AND p.album_id=?',
        )
        .bind(item.photo_id, albumId)
        .first();
      assert.ok(photoRow, 'Submitted photo must exist in target album');
      assert.equal(photoRow.version_id, item.version_id);
    }

    const putRequestIds = requests
      .filter((item) => item.method === 'PUT')
      .map((item) => JSON.parse(item.postData).requestId);
    assert.equal(new Set(putRequestIds).size, putRequestIds.length);
    assert.ok(galleryPageSizes.includes(24));
    assert.ok(galleryPageSizes.includes(expectedPhotoCount - 24));
    assert.ok(selectionPageSizes.includes(24));
    assert.ok(selectionPageSizes.includes(expectedPhotoCount - 24));
    assert.ok(galleryPageSizes.every((size) => size <= 24));
    assert.ok(selectionPageSizes.every((size) => size <= 24));

    const roundState = await db
      .prepare(
        'SELECT status, submitted_at_ms FROM guest_selection_round_state WHERE guest_id=? AND album_id=?',
      )
      .bind(guestId, albumId)
      .first();
    assert.equal(roundState.status, 'submitted');
    assert.ok(roundState.submitted_at_ms > 0);

    const auditEvent = await db
      .prepare(
        "SELECT event_id, action, actor_id FROM audit_events WHERE action='selection.submitted' AND actor_id=?",
      )
      .bind(guestId)
      .first();
    assert.ok(auditEvent);

    // 6. Mobile 375px responsive check (no horizontal overflow)
    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    assert.ok(
      scrollWidth <= clientWidth,
      `Horizontal scroll overflow detected: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`,
    );

    // Save screenshot before the logout retry flow replaces the page.
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/guest-selection-mobile.png',
      fullPage: true,
    });

    // A failed logout preserves the current page; retry reuses its request ID.
    const logoutButton = page.getByRole('button', { name: '離開相簿' });
    await logoutButton.click();
    await expect(page.getByRole('alert').getByText(/登出失敗/)).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Kino Pick.*線上挑片/ }),
    ).toBeVisible();
    await logoutButton.click();
    await expect(
      page.getByRole('heading', { name: '您已登出訪客選片' }),
    ).toBeVisible();
    assert.equal(logoutAttempts.length, 2);
    assert.ok(logoutAttempts[0].requestId);
    assert.equal(logoutAttempts[0].requestId, logoutAttempts[1].requestId);
  } finally {
    await browser.close();
  }
}
