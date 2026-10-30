import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

async function requestInit(incoming) {
  const method = incoming.method();
  const init = {
    method,
    headers: await incoming.allHeaders(),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD')
    init.body = incoming.postDataBuffer() ?? undefined;
  return init;
}

async function readWorkerJson(worker, base, path, ownerCookie) {
  const response = await worker.fetch(
    new Request(new URL(path, base), {
      headers: {
        Accept: 'application/json',
        Cookie: ownerCookieHeader(ownerCookie),
        Origin: new URL(base).origin,
      },
      redirect: 'manual',
    }),
  );
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function addOwnerCookie(context, base, ownerCookie) {
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: ownerCookieHeader(ownerCookie).slice(
        'kino-owner.session_token='.length,
      ),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    },
  ]);
}

async function openPolicy(page, base, projectId, albumName, albumId) {
  await page.goto(`${base}/dashboard/projects/${projectId}`, {
    waitUntil: 'networkidle',
  });
  await page
    .getByRole('button', { name: '審查挑片 ' + albumName, exact: true })
    .click();
  return page.getByTestId(`selection-policy-${albumId}`);
}

export async function runSelectionPolicyBrowserChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  projectId,
  albumId,
  db,
}) {
  const policyPath = `/api/v1/albums/${albumId}/selection-policy`;
  const initial = await readWorkerJson(worker, base, policyPath, ownerCookie);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.policy.albumId, albumId);
  assert.equal(initial.body.policy.minimum, 1);
  assert.equal(initial.body.policy.maximum, null);
  assert.equal(initial.body.policy.revision, 0);
  assert.equal(initial.body.policy.mode, 'private');
  assert.ok(Number.isInteger(initial.body.maxOpenSelectedCount));
  const maxOpenSelectedCount = initial.body.maxOpenSelectedCount;

  const album = await db
    .prepare('SELECT name FROM albums WHERE id=?')
    .bind(albumId)
    .first();
  assert.ok(album?.name, 'the browser fixture album should be in this project');

  const browser = await chromium.launch({ headless: true });
  const attempts = [];
  let dropNextPolicyResponse = false;
  let failNextPolicyRetryWith401 = false;
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(context, base, ownerCookie);
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      const isPolicyMutation =
        incoming.method() === 'PUT' && url.pathname === policyPath;
      if (!isPolicyMutation) {
        const response = await worker.fetch(
          new Request(incoming.url(), await requestInit(incoming)),
        );
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: Buffer.from(await response.arrayBuffer()),
        });
        return;
      }

      const body = incoming.postData() ?? '';
      const attempt = { body, status: 0, dropped: false };
      attempts.push(attempt);
      if (failNextPolicyRetryWith401) {
        failNextPolicyRetryWith401 = false;
        attempt.status = 401;
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'OWNER_REQUIRED' } }),
        });
        return;
      }
      const response = await worker.fetch(
        new Request(incoming.url(), await requestInit(incoming)),
      );
      attempt.status = response.status;
      if (dropNextPolicyResponse && response.ok) {
        dropNextPolicyResponse = false;
        attempt.dropped = true;
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });

    const policy = await openPolicy(page, base, projectId, album.name, albumId);
    await expect(policy).toBeVisible();
    await expect(
      policy.getByText(/目前政策：最少 1 張，最高 不限/),
    ).toBeVisible();
    await expect(
      policy.getByTestId('selection-policy-open-draft-count'),
    ).toContainText(String(maxOpenSelectedCount));
    await expect(
      policy.getByText(/共用挑片使用獨立審查與輪次設定/),
    ).toBeVisible();

    const minimum = policy.getByTestId('selection-policy-minimum');
    const maximum = policy.getByTestId('selection-policy-maximum');
    const save = policy.getByRole('button', { name: '確認政策變更' });

    // Minimum and maximum reject malformed, out-of-range, and inverted bounds.
    await minimum.fill('0');
    await expect(policy.getByText(/1 到 100000 之間的整數/)).toBeVisible();
    await expect(save).toBeDisabled();
    await minimum.fill('3');
    await maximum.fill('2');
    await expect(policy.getByText('最高張數不可少於最少張數。')).toBeVisible();
    await expect(save).toBeDisabled();
    if (maxOpenSelectedCount > 1) {
      await minimum.fill('1');
      await maximum.fill(String(maxOpenSelectedCount - 1));
      await expect(
        policy.getByText('最高張數不可低於目前仍開放的 客戶草稿數量。'),
      ).toBeVisible();
      await expect(save).toBeDisabled();
    }

    const nextMaximum =
      maxOpenSelectedCount < 100000
        ? Math.max(5, maxOpenSelectedCount + 1)
        : null;
    await minimum.fill('2');
    await maximum.fill(nextMaximum === null ? '' : String(nextMaximum));
    await expect(save).toBeEnabled();

    // Confirm focus is trapped, Escape cancels, and the explicit cancel button works.
    await save.click();
    const dialog = page.getByRole('dialog', {
      name: '確認變更挑片政策？',
    });
    const cancel = dialog.getByRole('button', { name: '取消' });
    const confirm = dialog.getByRole('button', { name: '確認套用政策' });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirm).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeFocused();
    assert.equal(attempts.length, 0);

    await save.click();
    await dialog.getByRole('button', { name: '取消' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeFocused();
    assert.equal(attempts.length, 0);

    const beforeAuditCount = await db
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_changed' AND album_id=?",
      )
      .bind(albumId)
      .first();
    const beforeCommandCount = await db
      .prepare(
        'SELECT count(*) AS n FROM selection_policy_commands WHERE album_id=?',
      )
      .bind(albumId)
      .first();

    // Commit once, drop its successful response, then retry the exact intent.
    await save.click();
    const firstConfirm = page
      .getByRole('dialog', { name: '確認變更挑片政策？' })
      .getByRole('button', { name: '確認套用政策' });
    dropNextPolicyResponse = true;
    await firstConfirm.click();
    await expect(
      policy.getByTestId('selection-policy-uncertain'),
    ).toBeVisible();
    assert.equal(attempts.length, 1);
    await expect.poll(() => attempts[0]?.status).toBe(200);
    await expect.poll(() => attempts[0]?.dropped).toBe(true);
    assert.equal(attempts[0].dropped, true);
    const exactBody = attempts[0].body;
    const exactRequest = JSON.parse(exactBody);
    assert.match(
      exactRequest.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(exactRequest.expectedRevision, 0);
    assert.equal(exactRequest.minimum, 2);
    assert.equal(exactRequest.maximum, nextMaximum);
    assert.equal(exactRequest.confirm, true);

    failNextPolicyRetryWith401 = true;
    await policy.getByRole('button', { name: '重試同一設定' }).click();
    await expect(policy.getByText(/重新登入後請重試同一設定/)).toBeVisible();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].status, 401);
    assert.equal(attempts[1].body, exactBody);

    await policy.getByRole('button', { name: '重試同一設定' }).click();
    await expect(policy.getByText(/目前政策：最少 2 張/)).toBeVisible();
    assert.equal(attempts.length, 3);
    assert.equal(attempts[2].body, exactBody);
    assert.equal(attempts[2].dropped, false);

    const requestCommandCount = await db
      .prepare(
        'SELECT count(*) AS n FROM selection_policy_commands WHERE request_id=?',
      )
      .bind(exactRequest.requestId)
      .first();
    assert.equal(requestCommandCount.n, 1);
    const commandCountAfter = await db
      .prepare(
        'SELECT count(*) AS n FROM selection_policy_commands WHERE album_id=?',
      )
      .bind(albumId)
      .first();
    assert.equal(commandCountAfter.n, beforeCommandCount.n + 1);
    const auditEvent = await db
      .prepare(
        "SELECT event_id,actor_type FROM audit_events WHERE action='selection.policy_changed' AND album_id=? AND request_id=?",
      )
      .bind(albumId, exactRequest.requestId)
      .first();
    assert.ok(auditEvent);
    assert.equal(auditEvent.actor_type, 'user');
    const auditCountAfter = await db
      .prepare(
        "SELECT count(*) AS n FROM audit_events WHERE action='selection.policy_changed' AND album_id=?",
      )
      .bind(albumId)
      .first();
    assert.equal(auditCountAfter.n, beforeAuditCount.n + 1);

    const persisted = await readWorkerJson(
      worker,
      base,
      policyPath,
      ownerCookie,
    );
    assert.equal(persisted.response.status, 200);
    assert.equal(persisted.body.policy.minimum, 2);
    assert.equal(persisted.body.policy.maximum, nextMaximum);
    assert.equal(persisted.body.policy.revision, 1);
    const policyRow = await db
      .prepare(
        'SELECT minimum,maximum,revision FROM album_selection_policies WHERE album_id=?',
      )
      .bind(albumId)
      .first();
    assert.equal(policyRow.minimum, 2);
    assert.equal(policyRow.maximum, nextMaximum);
    assert.equal(policyRow.revision, 1);

    await page.reload({ waitUntil: 'networkidle' });
    const reloadedPolicy = await openPolicy(
      page,
      base,
      projectId,
      album.name,
      albumId,
    );
    await expect(reloadedPolicy.getByText(/目前政策：最少 2 張/)).toBeVisible();
    await expect(
      reloadedPolicy.getByTestId('selection-policy-minimum'),
    ).toHaveValue('2');
    await expect(
      reloadedPolicy.getByTestId('selection-policy-maximum'),
    ).toHaveValue(nextMaximum === null ? '' : String(nextMaximum));
    await expect(
      reloadedPolicy.getByRole('button', { name: '確認政策變更' }),
    ).toBeDisabled();

    const scrollWidth = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    const clientWidth = await page.evaluate(
      () => document.documentElement.clientWidth,
    );
    assert.ok(
      scrollWidth <= clientWidth,
      `The 375px selection policy UI overflows horizontally: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`,
    );
    // An old exact replay must be followed by a current read, even if the local
    // pre-request snapshot is older than both the replay and another device.
    await reloadedPolicy.getByTestId('selection-policy-minimum').fill('3');
    await reloadedPolicy.getByRole('button', { name: '確認政策變更' }).click();
    dropNextPolicyResponse = true;
    await page
      .getByRole('dialog', { name: '確認變更挑片政策？' })
      .getByRole('button', { name: '確認套用政策' })
      .click();
    await expect.poll(() => attempts[3]?.dropped).toBe(true);
    const oldIntent = attempts[3].body;
    const later = await worker.fetch(
      new Request(new URL(policyPath, base), {
        method: 'PUT',
        headers: {
          Cookie: ownerCookieHeader(ownerCookie),
          Origin: new URL(base).origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedRevision: 2,
          minimum: 4,
          maximum: nextMaximum,
          confirm: true,
        }),
      }),
    );
    assert.equal(later.status, 200);
    assert.equal((await later.json()).policy.revision, 3);
    await reloadedPolicy.getByRole('button', { name: '重試同一設定' }).click();
    await expect(reloadedPolicy.getByText(/目前政策：最少 4 張/)).toBeVisible();
    await expect(
      reloadedPolicy.getByTestId('selection-policy-minimum'),
    ).toHaveValue('4');
    await expect(
      reloadedPolicy.getByRole('button', { name: '確認政策變更' }),
    ).toBeDisabled();
    assert.equal(attempts[4].body, oldIntent);
    await mkdir('.local', { recursive: true });
    await reloadedPolicy.screenshot({
      path: '.local/selection-policy-mobile.png',
    });
    await context.close();

    const disabledContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(disabledContext, base, ownerCookie);
    const disabledPage = await disabledContext.newPage();
    const disabledAttempts = [];
    await disabledPage.route('**/*', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      if (incoming.method() === 'PUT' && url.pathname === policyPath)
        disabledAttempts.push(incoming.postData() ?? '');
      const response = await disabledWorker.fetch(
        new Request(incoming.url(), await requestInit(incoming)),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    const disabledPolicy = await openPolicy(
      disabledPage,
      base,
      projectId,
      album.name,
      albumId,
    );
    await expect(
      disabledPolicy.getByTestId('selection-policy-unavailable'),
    ).toBeVisible();
    await expect(
      disabledPolicy.getByRole('button', { name: '確認政策變更' }),
    ).toHaveCount(0);
    assert.equal(disabledAttempts.length, 0);
    await disabledContext.close();
  } finally {
    await browser.close();
  }
}
