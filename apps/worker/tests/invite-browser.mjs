import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

export async function runInviteBrowserChecks({
  worker,
  baseUrl,
  sessionCookie,
  projectId,
  inviteId,
  db,
}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      {
        name: 'kino-owner.session_token',
        value: sessionCookie,
        url: baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ]);
    const page = await context.newPage();
    let dropped = false;
    const requests = [];
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const method = incoming.method();
      const init = {
        method,
        headers: await incoming.allHeaders(),
        redirect: 'manual',
      };
      if (method !== 'GET' && method !== 'HEAD')
        init.body = incoming.postDataBuffer() ?? undefined;
      const response = await worker.fetch(new Request(incoming.url(), init));
      if (
        new URL(incoming.url()).pathname ===
          `/api/v1/invites/${inviteId}/revoke` &&
        method === 'POST'
      ) {
        requests.push(JSON.parse(incoming.postData() ?? '{}'));
        if (!dropped) {
          assert.equal(response.status, 200);
          dropped = true;
          await route.abort('failed');
          return;
        }
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await page.goto(`${baseUrl}/dashboard/projects/${projectId}`, {
      waitUntil: 'networkidle',
    });
    await page
      .getByRole('button', { name: '查看客戶邀請', exact: true })
      .click();
    const card = page.getByRole('listitem', {
      name: `邀請 ${inviteId}`,
      exact: true,
    });
    await expect(card).toBeVisible();
    const button = card.getByRole('button', { name: '撤銷邀請', exact: true });
    await expect(button).toBeDisabled();
    await card.getByRole('checkbox').check();
    await button.click();
    await expect(card.getByRole('alert')).toContainText('尚無法確認撤銷結果');
    await mkdir(resolve('../../.local'), { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve('../../.local/invite-revoke-retry-mobile.png'),
      fullPage: false,
    });
    assert.equal(requests.length, 1);
    await button.click();
    const revoked = page.getByRole('listitem', {
      name: `邀請 ${inviteId}`,
      exact: true,
    });
    await expect(revoked.getByRole('status')).toContainText('撤銷時間');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM invite_revocation_commands WHERE invite_id=?',
          )
          .bind(inviteId)
          .first()
      ).n,
      1,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT request_id FROM audit_events WHERE event_id=?')
          .bind(`guest-invite-revoke:${inviteId}`)
          .first()
      ).request_id,
      requests[0].requestId,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await revoked.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: resolve('../../.local/invite-revoked-mobile.png'),
      fullPage: false,
    });
    await context.close();
  } finally {
    await browser.close();
  }
}
