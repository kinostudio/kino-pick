import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { chromium, expect } from '@playwright/test';

const HISTORY_PATH = /^\/api\/v1\/workspaces\/[^/]+\/history$/;
const EXPORT_PATH = /^\/api\/v1\/workspaces\/[^/]+\/history\/export$/;
const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function ownerCookieValue(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  assert.ok(match, 'The browser fixture has an Owner session cookie');
  return decodeURIComponent(match[1]);
}

async function addOwnerCookie(context, origin, ownerCookie) {
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: ownerCookieValue(ownerCookie),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(origin).protocol === 'https:',
    },
  ]);
}

async function requestBody(incoming) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

async function createOwnerHistoryProxy(worker, base) {
  const browserOrigin = { value: null };
  const workerOrigin = new URL(base).origin;
  const observations = {
    requests: [],
    capabilities: [],
    me: [],
    histories: [],
    exports: [],
    proxyErrors: [],
  };
  let heldHistory = null;
  let activeHold = null;
  const server = createServer(async (incoming, outgoing) => {
    const parsed = new URL(incoming.url ?? '/', 'http://127.0.0.1');
    const method = incoming.method ?? 'GET';
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        headers.set(
          name,
          Array.isArray(value)
            ? value.join(name === 'cookie' ? '; ' : ', ')
            : value,
        );
      }
      if (
        browserOrigin.value &&
        headers.get('origin') === browserOrigin.value
      ) {
        headers.set('origin', workerOrigin);
      }
      headers.set('cf-connecting-ip', '198.51.100.92');
      const body = await requestBody(incoming);
      const target = new URL(parsed.pathname + parsed.search, base);
      const response = await worker.fetch(
        new Request(target, {
          method,
          headers,
          ...(body ? { body } : {}),
          redirect: 'manual',
        }),
      );
      const responseHeaders = Object.fromEntries(response.headers.entries());
      for (const name of HOP_BY_HOP) delete responseHeaders[name];
      const record = {
        method,
        pathname: parsed.pathname,
        search: parsed.search,
        status: response.status,
        expectedActor: headers.get('x-kino-expected-actor'),
      };
      observations.requests.push(record);

      if (parsed.pathname === '/api/v1/owner-history/capabilities')
        observations.capabilities.push(record);
      if (parsed.pathname === '/api/v1/me') observations.me.push(record);

      if (method === 'GET' && HISTORY_PATH.test(parsed.pathname)) {
        const bytes = Buffer.from(await response.arrayBuffer());
        record.body = parseJson(bytes);
        observations.histories.push(record);
        const hold = heldHistory;
        if (hold) {
          heldHistory = null;
          activeHold = hold;
          hold.capture(record);
          await hold.releasePromise;
          activeHold = null;
        }
        outgoing.writeHead(response.status, responseHeaders);
        outgoing.end(bytes);
        return;
      }

      if (method === 'POST' && EXPORT_PATH.test(parsed.pathname)) {
        const request = body ? parseJson(body) : null;
        const exportRecord = {
          ...record,
          request,
          generationId: response.headers.get('X-Kino-History-Generation'),
          completed: false,
        };
        observations.exports.push(exportRecord);
        outgoing.writeHead(response.status, responseHeaders);
        try {
          if (response.body) {
            await pipeline(Readable.fromWeb(response.body), outgoing);
          } else {
            outgoing.end();
          }
          exportRecord.completed = true;
        } catch (error) {
          exportRecord.streamError =
            error instanceof Error ? error.message : String(error);
          if (!outgoing.destroyed) outgoing.destroy();
        }
        return;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      record.body = parseJson(bytes);
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(bytes);
    } catch (error) {
      observations.proxyErrors.push(
        error instanceof Error ? error.message : String(error),
      );
      if (outgoing.headersSent) outgoing.destroy();
      else {
        outgoing.writeHead(502, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        });
        outgoing.end('Owner history browser proxy failed');
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  browserOrigin.value = 'http://127.0.0.1:' + address.port;
  return {
    origin: browserOrigin.value,
    observations,
    holdNextHistoryResponse() {
      assert.equal(heldHistory, null, 'Only one history response can be held');
      let capture;
      let release;
      const captured = new Promise((resolve) => {
        capture = resolve;
      });
      const releasePromise = new Promise((resolve) => {
        release = resolve;
      });
      heldHistory = { capture, release, releasePromise };
      return { captured, release };
    },
    async close() {
      heldHistory?.release();
      activeHold?.release();
      const closed = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.closeAllConnections?.();
      await closed;
    },
  };
}

function dateTimeLocal(value) {
  return new Date(value).toISOString().slice(0, 16);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' && text[index + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  assert.equal(quoted, false, 'CSV ended inside a quoted field');
  return rows;
}

async function insertProbeEvents({
  db,
  owner,
  workspaceId,
  projectId,
  action,
  occurredAt,
  count,
  nonce,
}) {
  const ids = [];
  const statements = [];
  for (let index = 0; index < count; index += 1) {
    const eventId =
      'owner-history-ui:' + nonce + ':' + String(index).padStart(2, '0');
    ids.push(eventId);
    statements.push(
      db
        .prepare(
          "INSERT INTO audit_events(event_id,actor_type,actor_id,workspace_id,project_id,action,request_id,occurred_at_utc) VALUES(?,'user',?,?,?,?,?,?)",
        )
        .bind(
          eventId,
          owner,
          workspaceId,
          projectId,
          action,
          'owner-history-ui-request:' + nonce + ':' + index,
          occurredAt,
        ),
    );
  }
  if (statements.length) await db.batch(statements);
  return ids;
}

async function assertNoMobileOverflow(page) {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (widths.scrollWidth > widths.clientWidth) {
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .map((element) => ({
          tag: element.tagName,
          classes: element.className,
          width: element.getBoundingClientRect().width,
          right: element.getBoundingClientRect().right,
          minWidth: getComputedStyle(element).minWidth,
          text: element.children.length
            ? ''
            : element.textContent?.slice(0, 80),
        }))
        .filter((item) => item.right > innerWidth + 1 && item.width > 0)
        .slice(0, 25),
    );
    console.error(JSON.stringify({ mobileHistoryOverflow: overflow }));
  }
  assert.ok(
    widths.scrollWidth <= widths.clientWidth,
    'Owner history overflows the 375px viewport: ' + JSON.stringify(widths),
  );
}

async function downloadFile(page, format, workspaceId) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('button', {
        name: '匯出 ' + format.toUpperCase(),
        exact: true,
      })
      .click(),
  ]);
  assert.equal(
    download.suggestedFilename(),
    'history-workspace-' + workspaceId + '.' + format,
  );
  const path = await download.path();
  assert.ok(path, 'The browser completed the ' + format + ' download');
  return readFile(path, 'utf8');
}

export async function runOwnerHistoryBrowserChecks({
  db,
  worker,
  base,
  ownerCookie,
  owner,
  workspaceId,
  disabledWorker,
}) {
  assert.ok(workspaceId, 'The API fixture supplies an Owner workspace');
  assert.ok(ownerCookie, 'The API fixture supplies an Owner session');
  const project = await db
    .prepare(
      "SELECT id FROM projects WHERE workspace_id=? AND status NOT IN('archived','deleting','deleted') ORDER BY created_at,id LIMIT 1",
    )
    .bind(workspaceId)
    .first();
  assert.ok(project?.id, 'The existing Owner workspace has an active project');

  const nonce = randomUUID();
  const action = 'ui.browser_probe_' + nonce.slice(0, 12).replaceAll('-', '');
  const eventDate = new Date(Date.now() + 120_000);
  eventDate.setSeconds(0, 0);
  const eventTime = eventDate.toISOString();
  const windowStart = new Date(Date.parse(eventTime) - 60_000).toISOString();
  const windowEnd = new Date(Date.parse(eventTime) + 60_000).toISOString();
  const firstIds = await insertProbeEvents({
    db,
    owner,
    workspaceId,
    projectId: project.id,
    action,
    occurredAt: eventTime,
    count: 51,
    nonce,
  });
  const browser = await chromium.launch({ headless: true });
  const proxy = await createOwnerHistoryProxy(worker, base);
  let disabledProxy = null;
  let disabledContext = null;
  let context;
  let failTrigger = null;
  try {
    if (disabledWorker) {
      disabledProxy = await createOwnerHistoryProxy(disabledWorker, base);
      disabledContext = await browser.newContext({
        viewport: { width: 375, height: 812 },
      });
      await addOwnerCookie(disabledContext, disabledProxy.origin, ownerCookie);
      const disabledPage = await disabledContext.newPage();
      await disabledPage.goto(
        disabledProxy.origin +
          '/dashboard/workspaces/' +
          encodeURIComponent(workspaceId) +
          '/history',
        { waitUntil: 'networkidle' },
      );
      await expect(
        disabledPage.getByTestId('owner-workspace-history'),
      ).toHaveCount(0);
      await expect(
        disabledPage.getByRole('button', { name: '匯出 CSV', exact: true }),
      ).toHaveCount(0);
      assert.deepEqual(disabledProxy.observations.capabilities[0]?.body, {
        enabled: false,
      });
      assert.equal(disabledProxy.observations.histories.length, 0);
      assert.equal(disabledProxy.observations.exports.length, 0);
      await disabledContext.close();
      disabledContext = null;
      await disabledProxy.close();
      disabledProxy = null;
    }

    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      timezoneId: 'UTC',
      acceptDownloads: true,
    });
    await addOwnerCookie(context, proxy.origin, ownerCookie);
    const page = await context.newPage();
    page.on('pageerror', (error) =>
      proxy.observations.proxyErrors.push(error.message),
    );
    await page.goto(
      proxy.origin +
        '/dashboard/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/history',
      { waitUntil: 'networkidle' },
    );

    const panel = page.getByTestId('owner-workspace-history');
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('heading', { name: '工作空間活動紀錄' }),
    ).toBeVisible();
    await expect.poll(() => proxy.observations.capabilities.length).toBe(1);
    assert.equal(proxy.observations.capabilities[0].status, 200);
    assert.equal(
      proxy.observations.capabilities[0].expectedActor,
      owner,
      'The capability read binds to the expected Owner identity',
    );
    await expect.poll(() => proxy.observations.histories.length).toBe(1);
    await expect(panel.getByTestId('owner-history-items')).toBeVisible();

    for (const label of ['系統', '管理者', '訪客']) {
      const checkbox = panel.getByLabel(label, { exact: true });
      await expect(checkbox).toBeVisible();
      await expect(checkbox).toBeChecked();
      await expect(
        panel.locator('.history-filters').getByLabel(label),
      ).toHaveCount(0);
    }
    await expect(panel.getByLabel('專案 ID')).toBeHidden();
    await panel.getByText('其他篩選條件', { exact: true }).click();
    await expect(panel.getByLabel('起始時間（本機時間）')).toBeVisible();
    await panel.getByText('專案、照片與操作', { exact: true }).click();
    for (const label of [
      '專案 ID',
      '相簿 ID',
      '照片 ID',
      '版本 ID',
      '邀請 ID',
      '操作者 ID',
      '操作名稱',
      '起始時間（本機時間）',
      '結束時間（不含，本機時間）',
    ]) {
      await expect(panel.getByLabel(label)).toBeVisible();
    }

    await panel.getByLabel('專案 ID').fill(project.id);
    await panel.getByLabel('操作名稱').fill(action);
    await panel
      .getByLabel('起始時間（本機時間）')
      .fill(dateTimeLocal(windowStart));
    await panel
      .getByLabel('結束時間（不含，本機時間）')
      .fill(dateTimeLocal(windowEnd));
    await panel
      .getByRole('button', { name: '套用其他條件', exact: true })
      .click();
    await expect.poll(() => proxy.observations.histories.length).toBe(2);

    const firstApplied = proxy.observations.histories[1];
    const firstAppliedParams = new URLSearchParams(firstApplied.search);
    assert.deepEqual(firstAppliedParams.getAll('actorTypes'), [
      'system',
      'user',
      'guest',
    ]);
    assert.equal(firstAppliedParams.get('actorType'), null);
    await panel.getByLabel('操作名稱').fill(action + '.unapplied');
    await panel.getByLabel('系統', { exact: true }).uncheck();
    await expect.poll(() => proxy.observations.histories.length).toBe(3);
    const narrowedParams = new URLSearchParams(
      proxy.observations.histories[2].search,
    );
    assert.deepEqual(narrowedParams.getAll('actorTypes'), ['user', 'guest']);
    assert.equal(
      narrowedParams.get('action'),
      action,
      'The immediate actor toggle keeps the applied action, not its unsent draft',
    );
    assert.equal(narrowedParams.get('projectId'), project.id);
    assert.equal(narrowedParams.get('from'), windowStart);
    assert.equal(narrowedParams.get('to'), windowEnd);
    await panel.getByLabel('系統', { exact: true }).check();
    await expect.poll(() => proxy.observations.histories.length).toBe(4);
    const filteredFirst = proxy.observations.histories[3];
    const filteredParams = new URLSearchParams(filteredFirst.search);
    assert.equal(filteredFirst.status, 200);
    assert.equal(filteredFirst.expectedActor, owner);
    assert.equal(filteredFirst.body.items.length, 24);
    assert.ok(filteredFirst.body.nextCursor);
    assert.deepEqual(
      {
        projectId: filteredParams.get('projectId'),
        action: filteredParams.get('action'),
        actorTypes: filteredParams.getAll('actorTypes'),
        from: filteredParams.get('from'),
        to: filteredParams.get('to'),
      },
      {
        projectId: project.id,
        action,
        actorTypes: ['system', 'user', 'guest'],
        from: windowStart,
        to: windowEnd,
      },
      'Applied UI filters are sent as the bounded UTC history query',
    );
    await panel.getByLabel('操作名稱').fill(action);
    await expect(
      panel.getByTestId('owner-history-items').locator('li'),
    ).toHaveCount(24);
    await expect(
      panel
        .getByTestId('owner-history-items')
        .getByText('其他操作', { exact: true })
        .first(),
    ).toBeVisible();
    const firstDetails = panel
      .getByTestId('owner-history-items')
      .locator('li')
      .first()
      .locator('details summary');
    await firstDetails.click();
    await expect(
      panel.getByText('此操作的前後資料已省略。').first(),
    ).toBeVisible();
    await assertNoMobileOverflow(page);
    await mkdir('.local', { recursive: true });
    await firstDetails.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: '.local/owner-history-mobile-viewport.png',
    });
    await page.screenshot({
      path: '.local/owner-history-mobile.png',
      fullPage: true,
    });

    const snapshotToken = filteredFirst.body.snapshotToken;
    const lateTime = new Date(Date.parse(eventTime) + 1_000).toISOString();
    const lateIds = await insertProbeEvents({
      db,
      owner,
      workspaceId,
      projectId: project.id,
      action,
      occurredAt: lateTime,
      count: 1,
      nonce: nonce + '-late',
    });
    const expectedInitialIds = new Set(firstIds);
    for (let pageIndex = 0; pageIndex < 2; pageIndex += 1) {
      await panel
        .getByRole('button', { name: '載入更多活動紀錄', exact: true })
        .click();
      await expect
        .poll(() => proxy.observations.histories.length)
        .toBe(5 + pageIndex);
      const next = proxy.observations.histories[4 + pageIndex];
      assert.equal(next.status, 200);
      assert.equal(next.expectedActor, owner);
      assert.equal(next.body.snapshotToken, snapshotToken);
      assert.equal(
        next.body.items.length,
        Math.min(24, 51 - 24 * (pageIndex + 1)),
      );
      assert.ok(
        next.body.items.every((item) => expectedInitialIds.has(item.eventId)),
        'The cursor keeps later inserts outside the original snapshot',
      );
      assert.ok(
        next.body.items.every((item) => !lateIds.includes(item.eventId)),
      );
    }
    await expect(
      panel.getByTestId('owner-history-items').locator('li'),
    ).toHaveCount(51);
    assert.equal(
      proxy.observations.histories
        .slice(3, 6)
        .flatMap((item) => item.body.items).length,
      51,
    );
    await expect(
      panel.getByRole('button', { name: '載入更多活動紀錄', exact: true }),
    ).toHaveCount(0);

    await panel
      .getByRole('button', { name: '重新整理紀錄', exact: true })
      .click();
    await expect.poll(() => proxy.observations.histories.length).toBe(7);
    const refreshed = proxy.observations.histories[6];
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.snapshotToken, snapshotToken);
    assert.ok(
      refreshed.body.items.some((item) => lateIds.includes(item.eventId)),
      'A manual refresh captures events inserted after the prior snapshot',
    );
    const refreshedSnapshot = refreshed.body.snapshotToken;

    await panel.getByText('匯出紀錄', { exact: true }).click();
    const jsonText = await downloadFile(page, 'json', workspaceId);
    const jsonExport = JSON.parse(jsonText);
    const jsonAttempt = proxy.observations.exports.at(-1);
    assert.equal(jsonAttempt.status, 200);
    assert.equal(jsonAttempt.completed, true);
    assert.equal(jsonAttempt.expectedActor, owner);
    assert.equal(
      jsonAttempt.pathname,
      '/api/v1/workspaces/' + workspaceId + '/history/export',
    );
    assert.equal(
      jsonAttempt.search,
      '',
      'Export requests have no query string',
    );
    assert.equal(jsonAttempt.request.expectedOwnerId, owner);
    assert.equal(jsonAttempt.request.snapshotToken, refreshedSnapshot);
    assert.equal(jsonAttempt.request.format, 'json');
    assert.match(jsonAttempt.generationId, /^[0-9a-f-]{36}$/i);
    assert.equal(jsonExport.version, 1);
    assert.equal(jsonExport.format, 'json');
    assert.equal(jsonExport.workspaceId, workspaceId);
    assert.equal(jsonExport.generationId, jsonAttempt.generationId);
    assert.equal(jsonExport.complete, true);
    assert.equal(jsonExport.count, jsonExport.events.length);
    assert.equal(jsonExport.events.length, 52);
    const expectedAllIds = new Set([...firstIds, ...lateIds]);
    assert.deepEqual(
      new Set(jsonExport.events.map((item) => item.eventId)),
      expectedAllIds,
      'JSON contains the exact filtered snapshot, including the refresh-only event',
    );
    assert.ok(
      jsonExport.events.every((item) => item.details.status === 'omitted'),
      'Unknown event details stay explicitly omitted in JSON',
    );

    const csvText = await downloadFile(page, 'csv', workspaceId);
    const csvRows = parseCsv(csvText);
    const csvAttempt = proxy.observations.exports.at(-1);
    assert.equal(csvAttempt.status, 200);
    assert.equal(csvAttempt.completed, true);
    assert.match(csvAttempt.generationId, /^[0-9a-f-]{36}$/i);
    assert.notEqual(
      csvAttempt.generationId,
      jsonAttempt.generationId,
      'Each format attempt receives its own generation UUID',
    );
    assert.equal(csvRows[0][0], 'eventId');
    assert.equal(csvRows.length, 53);
    assert.deepEqual(
      new Set(csvRows.slice(1).map((row) => row[0])),
      expectedAllIds,
    );

    failTrigger = 'owner_history_ui_fail_' + randomUUID().replaceAll('-', '');
    await db.exec(
      'CREATE TRIGGER ' +
        failTrigger +
        " BEFORE INSERT ON audit_events WHEN NEW.action='owner_history.export_completed' BEGIN SELECT RAISE(ABORT,'INJECTED_OWNER_HISTORY_STREAM_FAILURE'); END;",
    );
    await panel.getByRole('button', { name: '匯出 JSON', exact: true }).click();
    await expect(
      page.getByText('匯出尚未完成，沒有建立下載檔。請重新整理紀錄後再試。', {
        exact: true,
      }),
    ).toBeVisible();
    const failedAttempt = proxy.observations.exports.at(-1);
    assert.equal(failedAttempt.status, 200);
    assert.equal(failedAttempt.completed, false);
    assert.equal(failedAttempt.request.format, 'json');
    const failedDownload = await page
      .waitForEvent('download', { timeout: 500 })
      .then(() => true)
      .catch(() => false);
    assert.equal(
      failedDownload,
      false,
      'An interrupted stream creates no file',
    );
    await db.exec('DROP TRIGGER ' + failTrigger);
    failTrigger = null;

    const historyList = panel.getByTestId('owner-history-items').locator('li');
    for (const label of ['系統', '管理者', '訪客']) {
      const beforeToggle = proxy.observations.histories.length;
      await panel.getByLabel(label, { exact: true }).uncheck();
      await expect
        .poll(() => proxy.observations.histories.length)
        .toBe(beforeToggle + 1);
    }
    const emptyQuery = new URLSearchParams(
      proxy.observations.histories.at(-1).search,
    );
    assert.deepEqual(emptyQuery.getAll('actorTypes'), ['']);
    assert.equal(proxy.observations.histories.at(-1).body.items.length, 0);
    await expect(panel.getByTestId('owner-history-empty')).toBeVisible();
    await expect(historyList).toHaveCount(0);
    const emptyJson = JSON.parse(await downloadFile(page, 'json', workspaceId));
    assert.equal(emptyJson.count, 0);
    assert.deepEqual(emptyJson.events, []);
    assert.deepEqual(emptyJson.filters.actorTypes, []);
    for (const label of ['系統', '管理者', '訪客']) {
      const beforeToggle = proxy.observations.histories.length;
      await panel.getByLabel(label, { exact: true }).check();
      await expect
        .poll(() => proxy.observations.histories.length)
        .toBe(beforeToggle + 1);
    }
    await expect(historyList).toHaveCount(24);

    const beforeBlurReads = proxy.observations.histories.length;
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')));
    await expect(historyList).toHaveCount(0);
    await expect(page.getByText(/活動資料已清除/)).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new FocusEvent('focus')));
    await expect
      .poll(() => proxy.observations.histories.length)
      .toBe(beforeBlurReads + 1);
    await expect(historyList).toHaveCount(24);
    assert.ok(
      proxy.observations.me.length >= 4,
      'Focus and history reads revalidate the current Owner session',
    );

    const held = proxy.holdNextHistoryResponse();
    const beforeHeldRead = proxy.observations.histories.length;
    await panel
      .getByRole('button', { name: '重新整理紀錄', exact: true })
      .click();
    const heldResponse = await held.captured;
    assert.equal(heldResponse.status, 200);
    assert.ok(heldResponse.body.items.length > 0);
    assert.equal(heldResponse.expectedActor, owner);
    await context.addCookies([
      {
        name: 'kino-owner.session_token',
        value: 'invalid-session-' + randomUUID(),
        url: proxy.origin,
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ]);
    held.release();
    await expect
      .poll(() => proxy.observations.histories.length)
      .toBe(beforeHeldRead + 1);
    await expect(historyList).toHaveCount(0);
    await expect(page.getByText(/管理者登入身分已變更或失效/)).toBeVisible();
    assert.ok(
      proxy.observations.me.some((record) => record.status === 401),
      'A delayed Owner A page response is rejected after the browser session changes',
    );
    assert.equal(
      proxy.observations.proxyErrors.length,
      0,
      'Browser proxy and page have no uncaught errors',
    );
  } finally {
    if (failTrigger)
      await db.exec('DROP TRIGGER ' + failTrigger).catch(() => {});
    if (context) await context.close();
    if (disabledContext) await disabledContext.close();
    if (disabledProxy) await disabledProxy.close();
    await proxy.close();
    await browser.close();
  }
}
