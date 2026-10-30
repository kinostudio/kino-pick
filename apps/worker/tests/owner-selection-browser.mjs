import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

export async function runOwnerSelectionBrowserChecks({
  worker,
  baseUrl,
  ownerCookie,
  projectId,
  albumId,
  db,
  guestId,
  selectedCount,
  verifyRound2Only = false,
}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      {
        name: 'kino-owner.session_token',
        value: ownerCookie,
        url: baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ]);

    const page = await context.newPage();

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
      const response = await worker.fetch(new Request(incoming.url(), init));
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });

    // 1. Navigate to project dashboard
    await page.goto(`${baseUrl}/dashboard/projects/${projectId}`, {
      waitUntil: 'networkidle',
    });

    // 2. Locate and open "審查挑片"
    const reviewBtn = page.getByRole('button', { name: /審查挑片/ }).first();
    await expect(reviewBtn).toBeVisible();
    await reviewBtn.click();

    // 3. Verify submissions panel is open and lists round 1 submission
    const heading = page.getByRole('heading', { name: /挑片審查與匯出/ });
    await expect(heading).toBeVisible();

    const round1Card = page.getByTestId(`submission-card-${guestId}-1`);
    await expect(round1Card).toBeVisible();

    if (verifyRound2Only) {
      const round2Card = page.getByTestId(`submission-card-${guestId}-2`);
      await expect(round2Card).toBeVisible();
      await expect(
        round1Card.getByText(/已重開（第 2 輪已送出）/),
      ).toBeVisible();
      await expect(round2Card.getByText('已送出鎖定')).toBeVisible();
      await expect(
        round1Card.getByRole('button', { name: /重開挑片輪次/ }),
      ).toHaveCount(0);

      const round2ReopenBtn = round2Card.getByRole('button', {
        name: /重開第 2 輪挑片輪次/,
      });
      await expect(round2ReopenBtn).toBeVisible();
      await round2ReopenBtn.click();
      const round2Dialog = page.getByRole('dialog', {
        name: '確認重開挑片輪次？',
      });
      await expect(round2Dialog).toBeVisible();
      await expect(
        round2Dialog.getByText(/將為此訪客建立第 3 輪挑片/),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(round2Dialog).not.toBeVisible();
      await expect(round2ReopenBtn).toBeFocused();
      return;
    }

    await expect(round1Card.getByText('第 1 輪挑片')).toBeVisible();
    await expect(round1Card.getByText('已送出鎖定')).toBeVisible();
    await expect(
      round1Card.getByText(`已選取 ${selectedCount} 張照片`),
    ).toBeVisible();

    // 4. Test "查看明細"
    const detailBtn = round1Card.getByRole('button', {
      name: /查看第 1 輪挑片明細/,
    });
    await expect(detailBtn).toBeVisible();
    await detailBtn.click();
    await expect(round1Card.getByText('選取照片清單：')).toBeVisible();

    // 5. Test "重開挑片輪次" modal
    const reopenBtn = round1Card.getByRole('button', {
      name: /重開第 1 輪挑片輪次/,
    });
    await expect(reopenBtn).toBeVisible();
    await reopenBtn.click();

    // Dialog appears with explanation
    const dialog = page.getByRole('dialog', { name: '確認重開挑片輪次？' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/將為此訪客建立第 2 輪挑片/)).toBeVisible();
    await expect(dialog.getByText(/第 1 輪的提交紀錄/)).toBeVisible();

    // Confirm reopen
    const cancelReopenBtn = dialog.getByRole('button', { name: '取消' });
    const confirmReopenBtn = dialog.getByRole('button', { name: '確認重開' });
    await expect(cancelReopenBtn).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirmReopenBtn).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancelReopenBtn).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirmReopenBtn).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(reopenBtn).toBeFocused();

    await reopenBtn.click();
    const confirmDialog = page.getByRole('dialog', {
      name: '確認重開挑片輪次？',
    });
    const confirmButton = confirmDialog.getByRole('button', {
      name: '確認重開',
    });
    await confirmButton.click();

    // Dialog closes and card updates to reopened state
    await expect(confirmDialog).not.toBeVisible();
    await expect(round1Card).toBeFocused();
    await expect(
      round1Card.getByText(/已重開（進行中 第 2 輪）/),
    ).toBeVisible();

    // 6. Verify D1 database state after reopen
    const roundState = await db
      .prepare(
        'SELECT round_no, status, selection_revision, submitted_at_ms FROM guest_selection_round_state WHERE guest_id=? AND album_id=?',
      )
      .bind(guestId, albumId)
      .first();
    assert.equal(roundState.round_no, 2);
    assert.equal(roundState.status, 'open');
    assert.equal(roundState.selection_revision, 1);
    assert.equal(roundState.submitted_at_ms, null);

    const auditEvent = await db
      .prepare(
        "SELECT event_id, action, actor_type FROM audit_events WHERE action='selection.reopened' AND album_id=?",
      )
      .bind(albumId)
      .first();
    assert.ok(auditEvent);
    assert.equal(auditEvent.actor_type, 'user');

    // 7. Check 375px mobile responsiveness (no horizontal scroll overflow)
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

    // Save screenshot
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/owner-selection-mobile.png',
      fullPage: true,
    });
  } finally {
    await browser.close();
  }
}
