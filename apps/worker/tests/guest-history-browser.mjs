import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function guestCookieName(baseUrl) {
  return new URL(baseUrl).protocol === 'https:'
    ? '__Host-kino_guest'
    : 'kino_guest';
}

function guestSessionHash(secret) {
  return createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
}

async function createHistoryBrowser({
  browser,
  worker,
  baseUrl,
  guestSecret,
  viewport = { width: 375, height: 812 },
}) {
  const secure = new URL(baseUrl).protocol === 'https:';
  const cookieName = guestCookieName(baseUrl);
  const context = await browser.newContext({ viewport });
  await context.addCookies([
    {
      name: cookieName,
      value: guestSecret,
      url: baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
      secure,
    },
  ]);

  const page = await context.newPage();
  const observations = {
    requests: [],
    capabilityReads: [],
    activityReads: [],
    accessReads: [],
    bridgeErrors: [],
    pageErrors: [],
  };
  let sequence = 0;

  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (url.origin !== new URL(baseUrl).origin) {
      await route.continue();
      return;
    }

    const method = incoming.method();
    const headers = await incoming.allHeaders();
    headers['cf-connecting-ip'] = '198.51.100.93';
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = incoming.postDataBuffer() ?? undefined;
    }

    let response;
    try {
      response = await worker.fetch(new Request(incoming.url(), init));
    } catch (error) {
      observations.bridgeErrors.push(
        error instanceof Error ? error.message : String(error),
      );
      await route.abort('failed');
      return;
    }

    const responseBody = Buffer.from(await response.arrayBuffer());
    const responseHeaders = Object.fromEntries(response.headers.entries());
    let body = null;
    try {
      body = JSON.parse(responseBody.toString('utf8'));
    } catch {
      body = null;
    }
    const record = {
      sequence: ++sequence,
      method,
      pathname: url.pathname,
      search: url.search,
      status: response.status,
      body,
    };
    observations.requests.push(record);

    if (
      method === 'GET' &&
      url.pathname === '/api/guest/history/capabilities'
    ) {
      observations.capabilityReads.push(record);
    }
    if (method === 'GET' && url.pathname === '/api/guest/me/activity') {
      observations.activityReads.push(record);
    }
    if (
      method === 'GET' &&
      url.pathname.startsWith('/api/guest/albums/') &&
      url.pathname.endsWith('/access')
    ) {
      observations.accessReads.push(record);
    }

    await route.fulfill({
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
    });
  });

  return {
    context,
    page,
    observations,
    async switchGuest(secret) {
      await context.addCookies([
        {
          name: cookieName,
          value: secret,
          url: baseUrl,
          httpOnly: true,
          sameSite: 'Lax',
          secure,
        },
      ]);
    },
    async close() {
      await context.close();
    },
  };
}

function historyItems(page) {
  return page.locator('section[aria-label="你的活動紀錄"] ol > li');
}

async function assertNoMobileOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    'Guest history overflows the 375px viewport',
  );
}

function albumPermission(db, guestId) {
  return db
    .prepare(
      'SELECT i.permissions_mask FROM guest_identities g JOIN guest_invites i ON i.id=g.invite_id WHERE g.id=?',
    )
    .bind(guestId)
    .first();
}

async function assertNoPrivateIdentifiers(page, guest, responsePage) {
  const text = await page.locator('main').innerText();
  for (const value of [
    guest.guestId,
    ...responsePage.items.map((item) => item.eventId),
    ...responsePage.items.map((item) => item.photoId).filter(Boolean),
    ...responsePage.items.map((item) => item.versionId).filter(Boolean),
  ]) {
    assert.ok(
      value && !text.includes(value),
      'History UI hides raw identifiers',
    );
  }
}

async function checkPaginationAndGuestSwitch({
  browser,
  worker,
  baseUrl,
  albumId,
  guest,
  secondGuest,
}) {
  const browserState = await createHistoryBrowser({
    browser,
    worker,
    baseUrl,
    guestSecret: guest.secret,
  });
  try {
    const { page, observations } = browserState;
    await page.goto(
      baseUrl + '/guest/history?albumId=' + encodeURIComponent(albumId),
      { waitUntil: 'networkidle' },
    );
    await expect(
      page.getByRole('heading', { name: '你的活動紀錄' }),
    ).toBeVisible();
    await expect
      .poll(() => observations.activityReads.length)
      .toBeGreaterThan(0);

    const firstCapability = observations.capabilityReads[0];
    const firstActivity = observations.activityReads[0];
    assert.ok(firstCapability);
    assert.ok(firstActivity);
    assert.equal(firstCapability.status, 200);
    assert.deepEqual(firstCapability.body, { enabled: true });
    assert.ok(
      firstCapability.sequence < firstActivity.sequence,
      'Capability is confirmed before history data is fetched',
    );
    assert.equal(firstActivity.status, 200);
    assert.equal(firstActivity.body.guestId, guest.guestId);
    assert.ok(firstActivity.body.items.length <= 24);
    assert.equal(firstActivity.body.items.length, 24);
    assert.ok(firstActivity.body.nextCursor);

    const eventRows = historyItems(page);
    await expect(eventRows).toHaveCount(24);
    await assertNoPrivateIdentifiers(page, guest, firstActivity.body);
    const firstPageText = await page.locator('main').innerText();
    if (
      firstActivity.body.items.some((item) =>
        item.action.startsWith('shared_selection.'),
      )
    ) {
      assert.match(firstPageText, /共同挑片/);
    }
    if (
      firstActivity.body.items.some(
        (item) => item.photoStatus === 'unavailable',
      )
    ) {
      assert.match(firstPageText, /照片目前無法顯示/);
    }
    await assertNoMobileOverflow(page);
    await page.screenshot({
      path: '.local/guest-history-mobile.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: '載入更多活動紀錄' }).click();
    await expect.poll(() => observations.activityReads.length).toBe(2);
    await expect.poll(async () => eventRows.count()).toBeGreaterThan(24);
    const secondPage = observations.activityReads[1];
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.body.guestId, guest.guestId);
    assert.ok(secondPage.body.items.length > 0);
    assert.equal(secondPage.body.items.length <= 24, true);
    await assertNoMobileOverflow(page);
  } finally {
    await browserState.close();
  }

  const switchState = await createHistoryBrowser({
    browser,
    worker,
    baseUrl,
    guestSecret: guest.secret,
  });
  try {
    const { page, observations } = switchState;
    await page.goto(
      baseUrl + '/guest/history?albumId=' + encodeURIComponent(albumId),
      { waitUntil: 'networkidle' },
    );
    const eventRows = historyItems(page);
    await expect(eventRows).toHaveCount(24);
    assert.equal(observations.activityReads[0]?.body?.guestId, guest.guestId);

    await switchState.switchGuest(secondGuest.secret);
    await page.getByRole('button', { name: '載入更多活動紀錄' }).click();
    await expect.poll(() => observations.activityReads.length).toBe(2);
    assert.equal(observations.activityReads[1]?.status, 400);
    await expect(page.getByText(/舊紀錄已清除/)).toBeVisible();
    await expect(eventRows).toHaveCount(0);
    assert.equal(
      observations.activityReads.filter((item) => item.status === 200).length,
      1,
      'The page waits for an explicit refresh after a switched-Guest cursor is rejected',
    );

    await page.getByRole('button', { name: '重新整理活動紀錄' }).click();
    await expect(page.getByText('目前沒有可顯示的活動紀錄。')).toBeVisible();
    await expect.poll(() => observations.activityReads.length).toBe(3);
    assert.equal(observations.activityReads[2]?.status, 200);
    assert.equal(
      observations.activityReads[2]?.body?.guestId,
      secondGuest.guestId,
    );
    await expect(eventRows).toHaveCount(0);
  } finally {
    await switchState.close();
  }
}

async function checkBackgroundRevalidatesCurrentGuest({
  browser,
  worker,
  baseUrl,
  albumId,
  visibleGuest,
  secondGuest,
}) {
  const browserState = await createHistoryBrowser({
    browser,
    worker,
    baseUrl,
    guestSecret: visibleGuest.secret,
  });
  try {
    const { context, page, observations } = browserState;
    await page.goto(
      baseUrl + '/guest/history?albumId=' + encodeURIComponent(albumId),
      { waitUntil: 'networkidle' },
    );
    const eventRows = historyItems(page);
    await expect(eventRows).toHaveCount(1);
    assert.equal(observations.activityReads.length, 1);
    assert.equal(
      observations.activityReads[0]?.body?.guestId,
      visibleGuest.guestId,
    );
    assert.equal(
      observations.activityReads[0]?.body?.nextCursor,
      null,
      'This regression uses a single-page history with no pagination cursor',
    );

    await page.evaluate(() => {
      window.__guestHistoryLifecycle = [];
      window.addEventListener('blur', () =>
        window.__guestHistoryLifecycle.push('blur'),
      );
      document.addEventListener('visibilitychange', () =>
        window.__guestHistoryLifecycle.push(
          document.visibilityState === 'hidden' ? 'hidden' : 'visible',
        ),
      );
    });
    const backgroundTab = await context.newPage();
    await backgroundTab.goto('about:blank');
    await backgroundTab.bringToFront();
    // Headless Chromium keeps all pages visible/focused (isolated protocol probe confirmed).
    // Exercise the browser's DOM lifecycle handler explicitly; native desktop tab delivery is not claimed.
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
    await expect(eventRows).toHaveCount(0);
    const backgroundSignals = await page.evaluate(
      () => window.__guestHistoryLifecycle,
    );
    assert.ok(
      backgroundSignals.includes('blur') ||
        backgroundSignals.includes('hidden'),
      'The explicit headless lifecycle event reached the browser handler',
    );
    assert.equal(
      observations.activityReads.length,
      1,
      'History remains cleared while the page is in the background',
    );

    await browserState.switchGuest(secondGuest.secret);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect.poll(() => observations.activityReads.length).toBe(2);
    await expect(page.getByText('目前沒有可顯示的活動紀錄。')).toBeVisible();
    assert.equal(observations.activityReads[1]?.status, 200);
    assert.equal(
      observations.activityReads[1]?.body?.guestId,
      secondGuest.guestId,
      'Foreground revalidation uses the current browser Guest cookie',
    );
    await expect(eventRows).toHaveCount(0);
    assert.equal(
      observations.capabilityReads.length,
      2,
      'Foreground performs one fresh capability check before its data read',
    );
  } finally {
    await browserState.close();
  }
}

async function checkRevokedSessionClearsHistory({
  browser,
  worker,
  baseUrl,
  albumId,
  db,
  guest,
}) {
  const browserState = await createHistoryBrowser({
    browser,
    worker,
    baseUrl,
    guestSecret: guest.secret,
  });
  try {
    const { page, observations } = browserState;
    await page.goto(
      baseUrl + '/guest/history?albumId=' + encodeURIComponent(albumId),
      { waitUntil: 'networkidle' },
    );
    const eventRows = historyItems(page);
    await expect(eventRows).toHaveCount(24);
    assert.ok(guest.sessionId, 'The Guest fixture provides its session ID');

    await db
      .prepare(
        'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
      )
      .bind(guest.sessionId, guestSessionHash(guest.secret))
      .run();

    await page.getByRole('button', { name: '載入更多活動紀錄' }).click();
    await expect.poll(() => observations.activityReads.length).toBe(2);
    assert.equal(observations.activityReads[1]?.status, 401);
    await expect(page.getByText(/訪客工作階段已失效/)).toBeVisible();
    await expect(eventRows).toHaveCount(0);
  } finally {
    await browserState.close();
  }
}

async function checkHistoryEntryLink({
  browser,
  worker,
  disabledWorker,
  baseUrl,
  albumId,
  visibleGuest,
  viewOnlyGuest,
}) {
  const enabledState = await createHistoryBrowser({
    browser,
    worker,
    baseUrl,
    guestSecret: visibleGuest.secret,
  });
  try {
    await enabledState.page.goto(baseUrl + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    await expect(
      enabledState.page.getByRole('heading', { name: /客戶挑片/ }),
    ).toBeVisible();
    const historyLink = enabledState.page.getByRole('link', {
      name: '查看自己的活動紀錄',
    });
    await expect(historyLink).toBeVisible();
    await assertNoMobileOverflow(enabledState.page);
    await expect(historyLink).toHaveAttribute(
      'href',
      '/guest/history?albumId=' + albumId,
    );
  } finally {
    await enabledState.close();
  }

  const viewOnlyState = await createHistoryBrowser({
    browser,
    worker,
    baseUrl,
    guestSecret: viewOnlyGuest.secret,
  });
  try {
    await viewOnlyState.page.goto(baseUrl + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    await expect(
      viewOnlyState.page.getByRole('heading', { name: /客戶挑片/ }),
    ).toBeVisible();
    await expect(
      viewOnlyState.page.getByRole('link', {
        name: '查看自己的活動紀錄',
      }),
    ).toHaveCount(0);
  } finally {
    await viewOnlyState.close();
  }

  const disabledState = await createHistoryBrowser({
    browser,
    worker: disabledWorker,
    baseUrl,
    guestSecret: visibleGuest.secret,
  });
  try {
    await disabledState.page.goto(baseUrl + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    await expect(
      disabledState.page.getByRole('heading', { name: /客戶挑片/ }),
    ).toBeVisible();
    await expect(
      disabledState.page.getByRole('link', {
        name: '查看自己的活動紀錄',
      }),
    ).toHaveCount(0);
    assert.deepEqual(disabledState.observations.capabilityReads[0]?.body, {
      enabled: false,
    });

    await disabledState.page.goto(
      baseUrl + '/guest/history?albumId=' + encodeURIComponent(albumId),
      { waitUntil: 'networkidle' },
    );
    await expect(
      disabledState.page.getByText('訪客活動紀錄目前尚未開放。'),
    ).toBeVisible();
    await expect(historyItems(disabledState.page)).toHaveCount(0);
    assert.equal(disabledState.observations.activityReads.length, 0);
  } finally {
    await disabledState.close();
  }
}

export async function runGuestHistoryBrowserChecks({
  worker,
  disabledWorker,
  baseUrl,
  albumId,
  db,
  guest,
  secondGuest,
  visibleGuest,
  viewOnlyGuest,
}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const permission = await albumPermission(db, guest.guestId);
    assert.equal(
      permission?.permissions_mask,
      1024,
      'The standalone history Guest has can_view_own_history without can_view',
    );

    await checkPaginationAndGuestSwitch({
      browser,
      worker,
      baseUrl,
      albumId,
      guest,
      secondGuest,
    });
    await checkBackgroundRevalidatesCurrentGuest({
      browser,
      worker,
      baseUrl,
      albumId,
      visibleGuest,
      secondGuest,
    });
    await checkRevokedSessionClearsHistory({
      browser,
      worker,
      baseUrl,
      albumId,
      db,
      guest,
    });
    await checkHistoryEntryLink({
      browser,
      worker,
      disabledWorker,
      baseUrl,
      albumId,
      visibleGuest,
      viewOnlyGuest,
    });
  } finally {
    await browser.close();
  }
}
