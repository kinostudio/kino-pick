import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  const value = match?.[1] ?? ownerCookie;
  return 'kino-owner.session_token=' + value;
}

async function issueInvite({
  worker,
  base,
  ownerCookie,
  projectId,
  albumId,
  accessMode = 'link_only',
  password,
  maxUses,
  pick = false,
}) {
  const permissions = {
    can_view: true,
    can_download_preview: false,
    can_download_original: false,
    can_select: pick,
    can_rate: false,
    can_favorite: false,
    can_tag: false,
    can_annotate: false,
    can_comment: false,
    can_submit: pick,
    can_view_own_history: false,
    can_compare_versions: false,
  };
  const input = {
    requestId: randomUUID(),
    albumIds: [albumId],
    accessMode,
    permissions,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    maxUses,
    ...(accessMode === 'custom_password' ? { password } : {}),
  };
  const response = await worker.fetch(
    new Request(new URL('/api/v1/projects/' + projectId + '/invites', base), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader(ownerCookie),
        Origin: new URL(base).origin,
        'CF-Connecting-IP': '203.0.113.250',
      },
      body: JSON.stringify(input),
      redirect: 'manual',
    }),
  );
  assert.equal(response.status, 200, 'synthetic invite issuance succeeds');
  const result = await response.json();
  assert.equal(result.secretAvailable, true);
  assert.equal(typeof result.invite?.inviteId, 'string');
  assert.equal(
    typeof result.token === 'string' && /^[a-f0-9]{64}$/.test(result.token),
    true,
    'synthetic invite has a valid bearer',
  );
  return { inviteId: result.invite.inviteId, token: result.token };
}

async function inviteCounts(db, inviteId) {
  const count = async (table) =>
    (
      await db
        .prepare('SELECT count(*) AS n FROM ' + table + ' WHERE invite_id=?')
        .bind(inviteId)
        .first()
    ).n;
  return {
    sessions: await count('guest_sessions'),
    exchanges: await count('guest_exchange_commands'),
    identities: await count('guest_identities'),
  };
}

function createGuestBrowserPage({ browser, worker, base, address, behavior }) {
  return (async () => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    const trace = (phase) => {
      if (process.env.KINO_GUEST_ENTRY_TRACE === '1')
        console.log(
          'Guest entry context ' + address.split('.').at(-1) + ': ' + phase,
        );
    };
    trace('created');
    const observations = {
      exchangeRequests: 0,
      exchangeRequestIds: [],
      exchangeStatuses: [],
      exchangePasswordFields: [],
      genericDenials: [],
      entryAccessRequests: 0,
      entryAccessStatuses: [],
      ownerApiRequests: 0,
      tokenInNetworkUrl: false,
      tokenInReferer: false,
      responseDropped: false,
      responseCorrupted: false,
      setCookieDelivered: false,
    };
    const inFlightRoutes = new Set();
    const routeErrors = [];
    const recordRouteError = (route, error) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const detail =
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error);
      routeErrors.push(
        new Error(
          `Guest browser route ${request.method()} ${pathname} failed: ${detail}`,
          { cause: error },
        ),
      );
    };
    const handleRoute = async (route) => {
      try {
        const incoming = route.request();
        const incomingUrl = new URL(incoming.url());
        const method = incoming.method();
        const headers = await incoming.allHeaders();
        const bearer = behavior?.token;
        const referer = headers.referer ?? '';
        if (bearer && incoming.url().includes(bearer))
          observations.tokenInNetworkUrl = true;
        if (bearer && referer.includes(bearer))
          observations.tokenInReferer = true;
        if (
          incomingUrl.pathname.startsWith('/api/v1/') ||
          incomingUrl.pathname.startsWith('/api/auth/')
        ) {
          observations.ownerApiRequests++;
        }
        if (
          incomingUrl.pathname === '/api/guest/exchange' &&
          method === 'POST'
        ) {
          observations.exchangeRequests++;
          try {
            const requestBody = JSON.parse(incoming.postData() ?? '{}');
            observations.exchangeRequestIds.push(requestBody.requestId);
            observations.exchangePasswordFields.push(
              Object.prototype.hasOwnProperty.call(requestBody, 'password'),
            );
          } catch {
            observations.exchangePasswordFields.push(false);
          }
        }
        if (
          incomingUrl.pathname.startsWith('/api/guest/albums/') &&
          incomingUrl.pathname.endsWith('/access') &&
          method === 'GET' &&
          incoming.isEntryAccessCheck()
        ) {
          observations.entryAccessRequests++;
        }

        headers['cf-connecting-ip'] = address;
        const init = {
          method,
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
        };
        if (method !== 'GET' && method !== 'HEAD')
          init.body = incoming.postDataBuffer() ?? undefined;
        const routeLabel =
          method + ' ' + incomingUrl.pathname.replace(/[a-f0-9-]{36}/gi, ':id');
        trace('fetch ' + routeLabel);
        const response = await worker.fetch(new Request(incoming.url(), init));
        trace('response ' + response.status + ' ' + routeLabel);
        const responseBody = Buffer.from(await response.arrayBuffer());
        trace('body read ' + routeLabel);

        if (
          incomingUrl.pathname === '/api/guest/exchange' &&
          method === 'POST'
        ) {
          observations.exchangeStatuses.push(response.status);
          if (response.status === 401) {
            let denial = null;
            try {
              denial = JSON.parse(responseBody.toString('utf8'));
            } catch {
              /* malformed denial fails assertions */
            }
            observations.genericDenials.push(
              denial !== null &&
                Object.keys(denial).length === 1 &&
                denial.error?.code === 'GUEST_ACCESS_REQUIRED' &&
                Object.keys(denial.error).length === 1 &&
                !response.headers.has('set-cookie'),
            );
          }
          if (response.headers.has('set-cookie'))
            observations.setCookieDelivered = true;

          if (
            behavior?.dropFirstExchange &&
            observations.exchangeRequests === 1
          ) {
            assert.equal(response.status, 200);
            observations.responseDropped = true;
            await route.abort('failed');
            return;
          }

          if (
            behavior?.corruptFirstExchange &&
            observations.exchangeRequests === 1
          ) {
            assert.equal(response.status, 200);
            assert.equal(response.headers.has('set-cookie'), true);
            observations.responseCorrupted = true;
            const responseHeaders = Object.fromEntries(
              response.headers.entries(),
            );
            delete responseHeaders['content-length'];
            await route.fulfill({
              status: response.status,
              headers: responseHeaders,
              body: '{"authenticated":',
            });
            return;
          }
        }

        if (
          incomingUrl.pathname.startsWith('/api/guest/albums/') &&
          incomingUrl.pathname.endsWith('/access') &&
          method === 'GET' &&
          incoming.isEntryAccessCheck()
        )
          observations.entryAccessStatuses.push(response.status);
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody,
        });
      } catch (error) {
        recordRouteError(route, error);
        try {
          await route.abort('failed');
        } catch (abortError) {
          recordRouteError(route, abortError);
        }
      }
    };
    // Reuse the native loopback transport pattern from guest-downloads-browser.
    // Native HTTP drains bodies/cookies without route.fulfill teardown dependencies.
    const baseUrl = new URL(base);
    assert.equal(baseUrl.protocol, 'http:');
    assert.equal(baseUrl.hostname, '127.0.0.1');
    const server = createServer((incoming, outgoing) => {
      const task = (async () => {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const headers = Object.fromEntries(
          Object.entries(incoming.headers)
            .filter(([, value]) => value !== undefined)
            .map(([name, value]) => [
              name,
              Array.isArray(value) ? value.join(',') : value,
            ]),
        );
        const url = new URL(incoming.url ?? '/', base).href;
        // Gallery panels legitimately re-read access after navigation. Count only the Entry action,
        // using actual document location while its fetch is waiting for this response.
        const entryAccessCheck =
          incoming.method === 'GET' && new URL(url).pathname.endsWith('/access')
            ? await page
                .evaluate(() => window.location.pathname.endsWith('/enter'))
                .catch(() => false)
            : false;
        const request = {
          url: () => url,
          isEntryAccessCheck: () => entryAccessCheck,
          method: () => incoming.method ?? 'GET',
          allHeaders: async () => headers,
          postData: () => body.toString('utf8'),
          postDataBuffer: () => body,
        };
        const route = {
          request: () => request,
          abort: async () => {
            if (
              behavior?.dropFirstExchange &&
              request.method() === 'POST' &&
              new URL(url).pathname === '/api/guest/exchange'
            ) {
              // End after HTTP headers but before the promised body, with no cookie.
              // A raw TCP reset before headers makes Chromium transparently resend POST.
              outgoing.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Length': '1',
                Connection: 'close',
              });
              outgoing.end();
            } else outgoing.destroy();
          },
          fulfill: async (result) => {
            const responseHeaders = { ...result.headers };
            delete responseHeaders['transfer-encoding'];
            outgoing.writeHead(result.status, responseHeaders);
            outgoing.end(result.body);
          },
        };
        await handleRoute(route);
      })();
      inFlightRoutes.add(task);
      void task
        .catch((error) => {
          routeErrors.push(error);
          outgoing.destroy();
        })
        .finally(() => inFlightRoutes.delete(task));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(baseUrl.port), baseUrl.hostname, resolve);
    });
    const close = async () => {
      trace('cleanup start: ' + inFlightRoutes.size + ' pending');
      const serverClosed = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      try {
        await context.close();
      } catch (error) {
        routeErrors.push(error);
      }
      while (inFlightRoutes.size > 0)
        await Promise.allSettled([...inFlightRoutes]);
      await serverClosed;
      trace('context and server closed');
      if (routeErrors.length > 0)
        throw new AggregateError(routeErrors, 'Guest HTTP bridge failed');
    };
    return { context, page, observations, close };
  })();
}

async function assertSanitized({ page, context, observations, token }) {
  const browserState = await page.evaluate((bearer) => {
    const storedValues = [window.localStorage, window.sessionStorage];
    const credentialStored = storedValues.some((storage) => {
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index) ?? '';
        const value = storage.getItem(key) ?? '';
        if (key.includes(bearer) || value.includes(bearer)) return true;
      }
      return false;
    });
    return {
      cleanUrl: window.location.hash === '' && window.location.search === '',
      credentialStored,
      fitsMobileViewport:
        document.documentElement.scrollWidth <= window.innerWidth,
    };
  }, token);
  assert.equal(
    browserState.cleanUrl,
    true,
    'entry URL query and fragment are removed',
  );
  assert.equal(
    browserState.credentialStored,
    false,
    'bearer is not stored in browser storage',
  );
  assert.equal(
    browserState.fitsMobileViewport,
    true,
    '375px layout has no horizontal overflow',
  );
  assert.equal(
    observations.tokenInNetworkUrl,
    false,
    'bearer is absent from network URLs',
  );
  assert.equal(
    observations.tokenInReferer,
    false,
    'bearer is absent from Referer headers',
  );
  assert.equal(
    observations.ownerApiRequests,
    0,
    'Guest route sends no Owner or auth API requests',
  );
  const browserCookies = await context.cookies();
  assert.equal(
    browserCookies.some((cookie) => cookie.name.startsWith('kino-owner.')),
    false,
    'Guest browser context has no Owner cookie',
  );
}

async function waitForGallery(page, base, albumId) {
  const targetPath = '/guest/albums/' + albumId;
  await page.waitForURL(
    (url) => url.origin === new URL(base).origin && url.pathname === targetPath,
    { timeout: 15000 },
  );
  await expect(
    page.getByRole('heading', { name: /^Kino Pick (?:線上挑片|相簿)$/ }),
  ).toBeVisible();
}

async function hasGuestCookie(context, base) {
  const cookies = await context.cookies(base);
  return cookies.some(
    (cookie) =>
      cookie.name === 'kino_guest' || cookie.name === '__Host-kino_guest',
  );
}

export async function runGuestEntryUiChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  projectId,
  albumId,
  db,
}) {
  const browser = await chromium.launch({ headless: true });
  let browserContextNumber = 0;
  const nextAddress = () => {
    browserContextNumber++;
    return '203.0.113.' + (100 + browserContextNumber);
  };

  try {
    const password = ' guest exact password ' + randomUUID() + ' ';
    const linkInvite = await issueInvite({
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      maxUses: 2,
      pick: true,
    });
    const passwordInvite = await issueInvite({
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      accessMode: 'custom_password',
      password,
      maxUses: 4,
    });
    const lostWithoutCookieInvite = await issueInvite({
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      maxUses: 1,
    });
    const lostWithCookieInvite = await issueInvite({
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      maxUses: 1,
    });

    await (async () => {
      const invite = linkInvite;
      const denied = await createGuestBrowserPage({
        browser,
        worker: disabledWorker,
        base,
        address: nextAddress(),
        behavior: { token: invite.token },
      });
      try {
        const before = await inviteCounts(db, invite.inviteId);
        await denied.page.goto(
          `${base}/guest/albums/${albumId}/enter#token=${invite.token}`,
        );
        await expect(denied.page.getByRole('alert')).toContainText(
          '訪客入口目前無法提供新的登入',
        );
        await expect(
          denied.page.getByRole('button', { name: '進入相簿', exact: true }),
        ).toHaveCount(0);
        assert.equal(denied.observations.exchangeRequests, 0);
        assert.deepEqual(await inviteCounts(db, invite.inviteId), before);
        await assertSanitized({ ...denied, token: invite.token });
      } finally {
        await denied.close();
      }
    })();

    await (async () => {
      const invite = linkInvite;
      const pageContext = await createGuestBrowserPage({
        browser,
        worker,
        base,
        address: nextAddress(),
        behavior: { token: invite.token },
      });
      try {
        const before = await inviteCounts(db, invite.inviteId);
        await pageContext.page.goto(
          base +
            '/guest/albums/' +
            albumId +
            '/enter?tracking=discard#token=' +
            invite.token +
            '&unexpected=1',
          { waitUntil: 'domcontentloaded' },
        );
        await expect(pageContext.page.getByRole('alert')).toContainText(
          '邀請連結格式無法辨識',
        );
        assert.equal(pageContext.observations.exchangeRequests, 0);
        assert.deepEqual(await inviteCounts(db, invite.inviteId), before);
        await assertSanitized({
          ...pageContext,
          token: invite.token,
        });
      } finally {
        await pageContext.close();
      }
    })();

    await (async () => {
      const invite = linkInvite;
      const pageContext = await createGuestBrowserPage({
        browser,
        worker,
        base,
        address: nextAddress(),
        behavior: { token: invite.token },
      });
      try {
        await pageContext.page.goto(
          base + '/guest/albums/' + albumId + '/enter#token=' + invite.token,
          { waitUntil: 'domcontentloaded' },
        );
        await expect(pageContext.page.getByLabel('您的稱呼')).toBeVisible();
        await mkdir('.local', { recursive: true });
        await pageContext.page.screenshot({
          path: '.local/guest-entry-mobile.png',
          fullPage: true,
        });
        await pageContext.page
          .getByLabel('您的稱呼')
          .fill('Guest UI ' + randomUUID());
        await expect(
          pageContext.page.getByRole('button', {
            name: '進入相簿',
            exact: true,
          }),
        ).toBeEnabled();
        const dispatchedDuplicateSubmit = await pageContext.page.evaluate(
          () => {
            const form = document.querySelector('form');
            const button = form?.querySelector('button[type="submit"]');
            if (
              !(form instanceof HTMLFormElement) ||
              !(button instanceof HTMLButtonElement)
            )
              return false;
            const dispatch = () =>
              form.dispatchEvent(
                new SubmitEvent('submit', {
                  bubbles: true,
                  cancelable: true,
                  submitter: button,
                }),
              );
            dispatch();
            dispatch();
            return true;
          },
        );
        assert.equal(dispatchedDuplicateSubmit, true);
        await waitForGallery(pageContext.page, base, albumId);
        assert.equal(pageContext.observations.exchangeRequests, 1);
        assert.equal(pageContext.observations.exchangeRequestIds.length, 1);
        assert.deepEqual(pageContext.observations.exchangePasswordFields, [
          false,
        ]);
        assert.equal(await hasGuestCookie(pageContext.context, base), true);
        assert.equal((await inviteCounts(db, invite.inviteId)).sessions, 1);
        const choice = pageContext.page
          .getByLabel('相簿照片列表')
          .locator('li')
          .filter({ has: pageContext.page.locator('img') })
          .first()
          .getByRole('checkbox');
        await expect(choice).toBeEnabled();
        await choice.click();
        await expect(choice).toBeChecked();
        await pageContext.page
          .getByRole('button', { name: '送出挑片', exact: true })
          .click();
        await pageContext.page
          .getByRole('button', { name: '確認送出本輪挑片', exact: true })
          .click();
        await expect(
          pageContext.page.getByText('✓ 挑片已成功送出！'),
        ).toBeVisible();
        const submission = await db
          .prepare(
            'SELECT id FROM guest_selection_submissions WHERE invite_id=?',
          )
          .bind(invite.inviteId)
          .first();
        assert.ok(submission);
        assert.equal(
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM guest_selection_submission_items WHERE submission_id=?',
              )
              .bind(submission.id)
              .first()
          ).n,
          1,
        );
        const foreign = await db
          .prepare('SELECT id FROM albums WHERE id<>? LIMIT 1')
          .bind(albumId)
          .first();
        assert.ok(foreign);
        await pageContext.page.goto(`${base}/guest/albums/${foreign.id}/enter`);
        await pageContext.page
          .getByRole('button', { name: '確認登入狀態', exact: true })
          .click();
        await expect(pageContext.page.getByRole('alert')).toContainText(
          '目前瀏覽器沒有可用的訪客授權',
        );
        assert.equal(pageContext.observations.exchangeRequests, 1);
        assert.equal((await inviteCounts(db, invite.inviteId)).sessions, 1);

        await assertSanitized({
          ...pageContext,
          token: invite.token,
        });
      } finally {
        await pageContext.close();
      }
    })();

    await (async () => {
      const invite = passwordInvite;
      const pageContext = await createGuestBrowserPage({
        browser,
        worker,
        base,
        address: nextAddress(),
        behavior: { token: invite.token },
      });
      try {
        await pageContext.page.goto(
          base + '/guest/albums/' + albumId + '/enter#token=' + invite.token,
          { waitUntil: 'domcontentloaded' },
        );
        await pageContext.page
          .getByLabel('您的稱呼')
          .fill('Password Guest ' + randomUUID());
        await pageContext.page
          .getByLabel('邀請密碼（若有）')
          .fill('incorrect password ' + randomUUID());
        await pageContext.page
          .getByRole('button', { name: '進入相簿', exact: true })
          .click();
        await expect(pageContext.page.getByRole('alert')).toContainText(
          '無法驗證目前提供的資訊',
        );
        await expect(
          pageContext.page.getByLabel('邀請密碼（若有）'),
        ).toHaveValue('');
        assert.equal(pageContext.observations.exchangeStatuses[0], 401);
        assert.equal(pageContext.observations.genericDenials[0], true);
        assert.equal((await inviteCounts(db, invite.inviteId)).sessions, 0);

        await pageContext.page.getByLabel('邀請密碼（若有）').fill(password);
        await pageContext.page
          .getByRole('button', { name: '進入相簿', exact: true })
          .click();
        await waitForGallery(pageContext.page, base, albumId);
        assert.equal(pageContext.observations.exchangeRequests, 2);
        assert.deepEqual(pageContext.observations.exchangePasswordFields, [
          true,
          true,
        ]);
        assert.equal(
          new Set(pageContext.observations.exchangeRequestIds).size,
          2,
          'explicit password correction creates a new exchange request',
        );
        assert.equal(await hasGuestCookie(pageContext.context, base), true);
        assert.equal((await inviteCounts(db, invite.inviteId)).sessions, 1);
        await assertSanitized({
          ...pageContext,
          token: invite.token,
        });
      } finally {
        await pageContext.close();
      }
    })();

    await (async () => {
      const invite = lostWithoutCookieInvite;
      const pageContext = await createGuestBrowserPage({
        browser,
        worker,
        base,
        address: nextAddress(),
        behavior: { token: invite.token, dropFirstExchange: true },
      });
      try {
        await pageContext.page.goto(
          base + '/guest/albums/' + albumId + '/enter#token=' + invite.token,
          { waitUntil: 'domcontentloaded' },
        );
        await pageContext.page
          .getByLabel('您的稱呼')
          .fill('Lost Cookie Guest ' + randomUUID());
        await pageContext.page
          .getByRole('button', { name: '進入相簿', exact: true })
          .click();
        await expect(pageContext.page.getByRole('alert')).toContainText(
          '結果尚未確認',
        );
        assert.equal(pageContext.observations.exchangeRequests, 1);
        assert.equal(pageContext.observations.responseDropped, true);
        assert.equal(await hasGuestCookie(pageContext.context, base), false);
        assert.deepEqual(await inviteCounts(db, invite.inviteId), {
          sessions: 1,
          exchanges: 1,
          identities: 1,
        });

        await pageContext.page
          .getByRole('button', { name: '確認登入狀態', exact: true })
          .click();
        await expect(
          pageContext.page
            .getByRole('alert')
            .filter({ hasText: '重新開啟攝影師提供的完整邀請連結' }),
        ).toBeVisible();
        assert.equal(pageContext.observations.entryAccessRequests, 1);
        assert.deepEqual(pageContext.observations.entryAccessStatuses, [401]);
        assert.equal(pageContext.observations.exchangeRequests, 1);
        await assertSanitized({
          ...pageContext,
          token: invite.token,
        });
      } finally {
        await pageContext.close();
      }
    })();

    await (async () => {
      const invite = lostWithCookieInvite;
      const pageContext = await createGuestBrowserPage({
        browser,
        worker,
        base,
        address: nextAddress(),
        behavior: { token: invite.token, corruptFirstExchange: true },
      });
      try {
        await pageContext.page.goto(
          base + '/guest/albums/' + albumId + '/enter#token=' + invite.token,
          { waitUntil: 'domcontentloaded' },
        );
        await pageContext.page
          .getByLabel('您的稱呼')
          .fill('Lost Body Guest ' + randomUUID());
        await pageContext.page
          .getByRole('button', { name: '進入相簿', exact: true })
          .click();
        await expect(pageContext.page.getByRole('alert')).toContainText(
          '結果尚未確認',
        );
        assert.equal(pageContext.observations.exchangeRequests, 1);
        assert.equal(pageContext.observations.responseCorrupted, true);
        assert.equal(pageContext.observations.setCookieDelivered, true);
        assert.equal(await hasGuestCookie(pageContext.context, base), true);
        assert.deepEqual(await inviteCounts(db, invite.inviteId), {
          sessions: 1,
          exchanges: 1,
          identities: 1,
        });

        pageContext.page.on('dialog', (dialog) => {
          void dialog.accept();
        });
        await pageContext.page.goto(
          base + '/guest/albums/' + albumId + '/enter',
          { waitUntil: 'domcontentloaded' },
        );
        await expect(pageContext.page.getByRole('status')).toContainText(
          '沒有可用的邀請憑證',
        );
        assert.equal(pageContext.observations.exchangeRequests, 1);
        await assertSanitized({
          ...pageContext,
          token: invite.token,
        });

        await pageContext.page
          .getByRole('button', { name: '確認登入狀態', exact: true })
          .click();
        await waitForGallery(pageContext.page, base, albumId);
        assert.equal(pageContext.observations.entryAccessRequests, 1);
        assert.deepEqual(pageContext.observations.entryAccessStatuses, [200]);
        assert.equal(pageContext.observations.exchangeRequests, 1);
        await assertSanitized({
          ...pageContext,
          token: invite.token,
        });
      } finally {
        await pageContext.close();
      }
    })();
  } finally {
    await browser.close();
  }
}
