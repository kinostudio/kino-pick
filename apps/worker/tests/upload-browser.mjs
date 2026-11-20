import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AwsV4Signer } from 'aws4fetch';
import { chromium, expect } from '@playwright/test';
import { pngFixture, jpegFixture, webpFixture } from './image-fixtures.mjs';

/** Local only: actual Worker/D1 and browser, intercepted S3 -> private Miniflare R2.
 * This bridge verifies signatures/bytes but is not live bucket CORS/S3 proof. */
export async function runUploadBrowserChecks({
  worker,
  db,
  storage,
  baseUrl,
  sessionCookie,
  bulkOnly = false,
  benchmark,
}) {
  const cookie = `kino-owner.session_token=${sessionCookie}`;
  async function create(path, body) {
    const response = await worker.fetch(
      new Request(baseUrl + path, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: baseUrl,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...body, requestId: randomUUID() }),
      }),
    );
    assert.equal(response.status, 201);
    return response.json();
  }
  const { workspace } = await create('/api/v1/workspaces', {
    name: 'Browser upload ' + randomUUID(),
  });
  const { project } = await create('/api/v1/projects', {
    workspaceId: workspace.id,
    name: 'Upload project',
  });
  const expectedActor = (
    await db
      .prepare('SELECT owner_user_id FROM workspaces WHERE id=?')
      .bind(workspace.id)
      .first()
  ).owner_user_id;
  const { album } = await create(`/api/v1/projects/${project.id}/albums`, {
    name: 'Upload album',
  });
  if (benchmark) {
    const response = await worker.fetch(
      new Request(
        baseUrl +
          '/api/v1/workspaces/' +
          workspace.id +
          '/image-processing-policy',
        {
          method: 'POST',
          headers: {
            Cookie: cookie,
            Origin: baseUrl,
            'Content-Type': 'application/json',
            'X-Kino-Expected-Actor': expectedActor,
          },
          body: JSON.stringify({
            requestId: randomUUID(),
            expectedRevision: 0,
            recipe: 'browser-first-jpeg-82-v1',
          }),
        },
      ),
    );
    assert.equal(response.status, 200, await response.text());
  }
  const browser = await chromium.launch({ headless: true });
  let putCount = 0;
  const drops = new Set();
  const operationIds = {
    init: new Set(),
    authorize: new Set(),
    complete: new Set(),
  };
  let capabilityOverride = false;
  let heldSessionId = null;
  let releaseHeldInit = null;
  const lifecycleMutations = [];
  let bulkQueueMode = false;
  let bulkQueueActiveFilename = null;
  let bulkQueueMaxActive = 0;
  const bulkQueueEvents = [];
  const derivativeWindows = [];
  const putStarts = [];
  let activeDerivatives = 0;
  let maxActiveDerivatives = 0;

  try {
    const context = await browser.newContext();
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
    page.on('dialog', (dialog) => dialog.accept());
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(error.message));
    const bridge = async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      const headers = await incoming.allHeaders();
      if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
        assert.equal(url.protocol, 'https:');
        assert.equal(incoming.method(), 'PUT');
        assert.equal(headers.cookie, undefined);
        assert.equal(headers.authorization, undefined);
        assert.equal(headers['x-kino-expected-actor'], undefined);
        if (benchmark) putStarts.push(performance.now());
        const bytes = incoming.postDataBuffer();
        assert.ok(bytes);
        const checksum = createHash('sha256').update(bytes).digest('base64');
        assert.equal(headers['x-amz-checksum-sha256'], checksum);
        assert.equal(headers['if-none-match'], '*');
        if (bulkQueueMode) {
          assert.ok(bulkQueueActiveFilename);
          bulkQueueEvents.push(`put:${bulkQueueActiveFilename}`);
        }
        const signature = url.searchParams.get('X-Amz-Signature');
        url.searchParams.delete('X-Amz-Signature');
        const signed = await new AwsV4Signer({
          url: url.toString(),
          method: 'PUT',
          service: 's3',
          region: 'auto',
          accessKeyId: 'synthetic-test-access-key',
          secretAccessKey: 'synthetic-test-secret-key-never-for-production',
          datetime: url.searchParams.get('X-Amz-Date'),
          signQuery: true,
          allHeaders: true,
          headers: {
            'Content-Type': headers['content-type'],
            'Content-Length': String(bytes.byteLength),
            'If-None-Match': '*',
            'x-amz-checksum-sha256': checksum,
          },
        }).sign();
        assert.equal(
          signed.url.searchParams.get('X-Amz-Signature'),
          signature,
          'signed grant must bind the bytes and headers actually sent',
        );
        const key = decodeURIComponent(url.pathname)
          .split('/')
          .slice(2)
          .join('/');
        const pendingFile = await db
          .prepare(
            'SELECT original_filename FROM upload_sessions WHERE object_key=?',
          )
          .bind(key)
          .first();
        if (pendingFile?.original_filename === 'expires.png') {
          drops.add('expiry-put');
          await route.abort('failed'); // No object was committed for this case.
          return;
        }
        const object = await storage.put(key, bytes, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: headers['content-type'] },
          sha256: Buffer.from(checksum, 'base64'),
        });
        putCount++;
        assert.ok(
          object,
          'unknown PUT outcome must not cause another create-once write',
        );
        if (!drops.has('put')) {
          drops.add('put');
          await route.abort('failed'); // Object committed; browser never receives the response.
        } else {
          await route.fulfill({
            status: 200,
            headers: { 'Access-Control-Allow-Origin': baseUrl },
            body: '',
          });
        }
        return;
      }
      assert.equal(
        url.origin,
        baseUrl,
        'test must not send any unhandled external traffic',
      );
      if (
        capabilityOverride &&
        url.pathname === '/api/v1/uploads/capabilities'
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            enabled: false,
            maxBrowserBytes: 67108864,
            maxPixels: 80000000,
            maxDimension: 32768,
          }),
        });
        return;
      }
      const method = incoming.method();
      const init = { method, headers, redirect: 'manual' };
      if (method !== 'GET' && method !== 'HEAD')
        init.body = incoming.postDataBuffer() ?? undefined;
      const kind =
        url.pathname === '/api/v1/uploads/init'
          ? 'init'
          : url.pathname.endsWith('/authorize')
            ? 'authorize'
            : url.pathname.endsWith('/complete')
              ? 'complete'
              : null;
      if (method === 'POST' && url.pathname.startsWith('/api/v1/uploads/'))
        assert.equal(headers['x-kino-expected-actor'], expectedActor);
      if (
        heldSessionId &&
        method === 'POST' &&
        url.pathname.includes(heldSessionId)
      )
        lifecycleMutations.push(url.pathname);
      if (kind)
        operationIds[kind].add(JSON.parse(incoming.postData()).requestId);
      if (bulkQueueMode && kind === 'init') {
        const requestBody = incoming.postDataJSON();
        assert.equal(
          bulkQueueActiveFilename,
          null,
          'the next reservation must wait for the previous completion',
        );
        bulkQueueActiveFilename = requestBody.originalFilename;
        bulkQueueMaxActive = Math.max(bulkQueueMaxActive, 1);
        bulkQueueEvents.push(`reserve:${bulkQueueActiveFilename}`);
      } else if (bulkQueueMode && kind === 'authorize') {
        assert.ok(bulkQueueActiveFilename);
        bulkQueueEvents.push(`authorize:${bulkQueueActiveFilename}`);
      }
      const derivative =
        benchmark &&
        method === 'POST' &&
        url.pathname.endsWith('/browser-derivatives');
      const begin = performance.now();
      if (derivative)
        maxActiveDerivatives = Math.max(
          maxActiveDerivatives,
          ++activeDerivatives,
        );
      const response = await worker.fetch(new Request(incoming.url(), init));
      const body = Buffer.from(await response.arrayBuffer());
      if (derivative) {
        activeDerivatives--;
        derivativeWindows.push({
          begin,
          end: performance.now(),
          status: response.status,
          result: JSON.parse(body.toString()),
        });
      }
      if (bulkQueueMode && kind === 'complete' && response.ok) {
        assert.ok(bulkQueueActiveFilename);
        bulkQueueEvents.push(`complete:${bulkQueueActiveFilename}`);
        bulkQueueActiveFilename = null;
      }
      if (
        kind === 'init' &&
        incoming.postDataJSON().originalFilename === 'lifecycle.png' &&
        response.ok
      ) {
        heldSessionId = JSON.parse(body).uploadSession.id;
        await new Promise((resolve) => {
          releaseHeldInit = resolve;
        });
      }
      if (
        (kind === 'init' || kind === 'complete') &&
        response.ok &&
        !drops.has(kind)
      ) {
        drops.add(kind);
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
      });
    };
    await page.route('**/*', bridge);
    await page.goto(baseUrl + '/dashboard/projects/' + project.id, {
      waitUntil: 'networkidle',
    });
    await page
      .getByRole('button', { name: '上傳照片 ' + album.name, exact: true })
      .click();
    const input = page.getByLabel('選擇照片', { exact: true });
    await expect(input).toBeVisible();
    if (benchmark) {
      const files = (await readdir(benchmark))
        .filter((name) => name.endsWith('.jpg'))
        .sort();
      assert.equal(files.length, 50);
      drops.add('init');
      drops.add('put');
      drops.add('complete');
      await input.setInputFiles(files.map((name) => resolve(benchmark, name)));
      const startUpload = page.getByRole('button', {
        name: '開始上傳',
        exact: true,
      });
      await expect(page.getByText('等待上傳', { exact: true })).toHaveCount(
        50,
        { timeout: 90_000 },
      );
      const start = performance.now();
      await startUpload.click();
      await expect
        .poll(() => derivativeWindows.length, { timeout: 300_000 })
        .toBe(50);
      const last = derivativeWindows.reduce(
        (max, item) => Math.max(max, item.end),
        start,
      );
      assert.ok(
        derivativeWindows.every(
          (item) => item.status === 200 && item.result.status === 'succeeded',
        ),
        JSON.stringify(
          derivativeWindows.filter(
            (item) => item.status !== 200 || item.result.status !== 'succeeded',
          ),
        ),
      );
      assert.equal(maxActiveDerivatives, 1);
      assert.equal(putStarts.length, 50);
      const overlappingPuts = putStarts.filter((time) =>
        derivativeWindows.some((item) => time >= item.begin && time < item.end),
      ).length;
      const { n } = await db
        .prepare(
          "SELECT count(*) AS n FROM upload_completions c JOIN image_processing_jobs j ON j.id=c.asset_id WHERE c.album_id=? AND j.recipe='browser-first-jpeg-82-v1' AND j.status='succeeded'",
        )
        .bind(album.id)
        .first();
      assert.equal(n, 50);
      console.log(
        JSON.stringify({
          firstReadyMs: Math.round(derivativeWindows[0].end - start),
          totalMs: Math.round(last - start),
          files: n,
          maxActiveDerivatives,
          overlappingPuts,
        }),
      );
      return;
    }
    if (bulkOnly) {
      const filenames = Array.from(
        { length: 25 },
        (_, index) => `queue-${String(index + 1).padStart(2, '0')}.png`,
      );
      drops.add('init');
      drops.add('put');
      drops.add('complete');
      bulkQueueMode = true;
      await input.setInputFiles(
        filenames.map((name) => ({
          name,
          mimeType: 'image/png',
          buffer: pngFixture(),
        })),
      );
      await expect(page.getByTestId('upload-item')).toHaveCount(25);
      await expect(page.getByText('等待上傳', { exact: true })).toHaveCount(25);
      const journal = await page.evaluate(() =>
        Object.entries(localStorage).filter(([key]) =>
          key.startsWith('kino-pic:upload-journal:'),
        ),
      );
      assert.equal(journal.length, 1);
      assert.equal(JSON.parse(journal[0][1]).items.length, 0);

      let stopJournalSampling = false;
      let maximumJournalItems = 0;
      const journalSampler = (async () => {
        while (!stopJournalSampling) {
          const count = await page.evaluate(() => {
            const entry = Object.entries(localStorage).find(([key]) =>
              key.startsWith('kino-pic:upload-journal:'),
            );
            return entry ? JSON.parse(entry[1]).items.length : 0;
          });
          maximumJournalItems = Math.max(maximumJournalItems, count);
          await page.waitForTimeout(10);
        }
      })();
      try {
        await page
          .getByRole('button', { name: '開始上傳', exact: true })
          .click();
        await page
          .getByRole('button', { name: '收起上傳 ' + album.name, exact: true })
          .click();
        await expect(
          page.getByRole('progressbar', { name: '照片上傳進度' }),
        ).toBeVisible();
        await expect(input).toBeHidden();
        await page
          .getByRole('button', { name: '展開上傳 ' + album.name, exact: true })
          .click();
        await expect(page.getByText('已完成', { exact: true })).toHaveCount(
          25,
          {
            timeout: 120_000,
          },
        );
      } finally {
        stopJournalSampling = true;
        await journalSampler;
      }

      await page.setViewportSize({ width: 375, height: 812 });
      await expect(
        page.getByRole('progressbar', { name: '照片上傳進度' }),
      ).toHaveAttribute('value', '25');
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        true,
      );
      await page
        .getByRole('button', { name: '收起上傳 ' + album.name, exact: true })
        .click();
      await page
        .getByRole('button', { name: '開啟相簿 ' + album.name, exact: true })
        .click();
      await expect(
        page.getByRole('button', {
          name: '展開上傳 ' + album.name,
          exact: true,
        }),
      ).toBeVisible();
      const photoCard = page
        .getByText('queue-25', { exact: true })
        .locator('..');
      await photoCard
        .getByRole('button', { name: '查看原圖', exact: true })
        .click();
      await expect
        .poll(() =>
          photoCard
            .getByRole('img', { name: 'queue-25', exact: true })
            .evaluate((image) => image.naturalWidth),
        )
        .toBeGreaterThan(0);

      assert.equal(putCount, 25);
      assert.equal(bulkQueueActiveFilename, null);
      assert.equal(bulkQueueMaxActive, 1);
      assert.deepEqual(
        bulkQueueEvents,
        filenames.flatMap((filename) => [
          `reserve:${filename}`,
          `authorize:${filename}`,
          `put:${filename}`,
          `complete:${filename}`,
        ]),
      );
      assert.ok(maximumJournalItems <= 20);
      assert.deepEqual(
        await db
          .prepare(
            'SELECT count(*) AS n FROM upload_sessions WHERE workspace_id=?',
          )
          .bind(workspace.id)
          .first(),
        { n: 25 },
      );
      assert.deepEqual(
        await db
          .prepare(
            'SELECT count(*) AS n FROM upload_completions WHERE workspace_id=?',
          )
          .bind(workspace.id)
          .first(),
        { n: 25 },
      );
      return;
    }
    await input.setInputFiles({
      name: 'portrait.png',
      mimeType: 'image/png',
      buffer: pngFixture(),
    });
    await page.getByRole('button', { name: '開始上傳', exact: true }).click();
    await expect.poll(() => drops.has('init')).toBe(true);
    async function reloadUpload() {
      await page.reload({ waitUntil: 'networkidle' });
      await page
        .getByRole('button', { name: '上傳照片 ' + album.name, exact: true })
        .click();
      await expect(page.getByLabel('選擇照片', { exact: true })).toBeEnabled();
    }
    const journal = await page.evaluate(() =>
      Object.entries(localStorage).filter(([key]) =>
        key.startsWith('kino-pic:upload-journal:'),
      ),
    );
    assert.equal(journal.length, 1);
    assert.ok(
      !/https:|blob:|previewUrl|authorization|cookie|token/i.test(
        journal[0][1],
      ),
    );
    const originalInitId = JSON.parse(journal[0][1]).items[0].initBody
      .requestId;
    await reloadUpload();
    const restoredRow = page.getByRole('listitem', {
      name: 'portrait.png',
      exact: true,
    });
    await expect(
      restoredRow.getByText('等待恢復', { exact: true }),
    ).toBeVisible();
    assert.equal(operationIds.init.size, 1);
    await restoredRow
      .getByRole('button', { name: '確認 portrait.png', exact: true })
      .click();
    await expect(restoredRow).toContainText('重新選擇原檔');
    assert.equal(putCount, 0);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: resolveScreenshot('upload-resume-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    // Another tab cannot overwrite this scope's journal while the first owns its Web Lock.
    const second = await context.newPage();
    await second.route('**/*', bridge);
    await second.goto(baseUrl + '/dashboard/projects/' + project.id, {
      waitUntil: 'networkidle',
    });
    await second
      .getByRole('button', { name: '上傳照片 ' + album.name, exact: true })
      .click();
    await expect(second.getByRole('alert')).toContainText('另一個分頁');
    await expect(second.getByLabel('選擇照片', { exact: true })).toBeDisabled();
    await second.close();
    // Valid PNG with identical dimensions and byte length, different encoding/hash.
    const wrong = pngFixture();
    for (let offset = 8; offset + 12 <= wrong.length;) {
      const length = wrong.readUInt32BE(offset);
      if (wrong.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
        wrong[offset + 9] = 0x9c;
        let crc = 0xffffffff;
        for (const byte of wrong.subarray(offset + 4, offset + 8 + length)) {
          crc ^= byte;
          for (let bit = 0; bit < 8; bit++)
            crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
        }
        wrong.writeUInt32BE((crc ^ 0xffffffff) >>> 0, offset + 8 + length);
        break;
      }
      offset += length + 12;
    }
    assert.equal(wrong.byteLength, pngFixture().byteLength);
    assert.deepEqual(
      await page.evaluate(async (data) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const image = await createImageBitmap(
          new Blob([bytes], { type: 'image/png' }),
        );
        const dimensions = [image.width, image.height];
        image.close();
        return dimensions;
      }, wrong.toString('base64')),
      [1, 1],
    );
    assert.notEqual(
      createHash('sha256').update(wrong).digest('hex'),
      createHash('sha256').update(pngFixture()).digest('hex'),
    );
    await restoredRow
      .getByLabel('重新選擇 portrait.png', { exact: true })
      .setInputFiles({
        name: 'portrait.png',
        mimeType: 'image/png',
        buffer: wrong,
      });
    await expect(restoredRow).toContainText('內容或資訊不符');
    assert.equal(putCount, 0);
    await restoredRow
      .getByLabel('重新選擇 portrait.png', { exact: true })
      .setInputFiles({
        name: 'portrait.png',
        mimeType: 'image/png',
        buffer: pngFixture(),
      });
    await page.getByRole('button', { name: '開始上傳', exact: true }).click();
    await expect.poll(() => drops.has('put')).toBe(true);
    await reloadUpload();
    await restoredRow
      .getByRole('button', { name: '確認 portrait.png', exact: true })
      .click();
    await expect.poll(() => drops.has('complete')).toBe(true);
    await reloadUpload();
    await restoredRow
      .getByRole('button', { name: '確認 portrait.png', exact: true })
      .click();
    await expect(
      restoredRow.getByText('已完成', { exact: true }),
    ).toBeVisible();
    assert.deepEqual([...operationIds.init], [originalInitId]);
    await expect
      .poll(
        async () =>
          (
            await db
              .prepare(
                'SELECT count(*) AS n FROM upload_completions WHERE workspace_id=?',
              )
              .bind(workspace.id)
              .first()
          ).n,
      )
      .toBe(1);
    await expect(page.getByText('已完成', { exact: true })).toBeVisible();
    assert.equal(putCount, 1);
    for (const ids of Object.values(operationIds))
      assert.equal(
        ids.size,
        1,
        'ambiguous results must reuse original request IDs',
      );
    assert.deepEqual(
      await db
        .prepare(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        )
        .bind(workspace.id)
        .first(),
      { used_bytes: pngFixture().byteLength, reserved_bytes: 0 },
    );
    const version = await db
      .prepare(
        'SELECT v.width,v.height,a.object_key FROM photo_versions v JOIN photo_assets a ON a.version_id=v.id WHERE v.workspace_id=?',
      )
      .bind(workspace.id)
      .first();
    assert.equal(version.width, 1);
    assert.equal(version.height, 1);
    assert.deepEqual(
      Buffer.from(await (await storage.get(version.object_key)).arrayBuffer()),
      pngFixture(),
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE workspace_id=? AND action='upload.completed'",
          )
          .bind(workspace.id)
          .first()
      ).n,
      1,
    );
    const reserveCount = await db
      .prepare('SELECT count(*) AS n FROM upload_sessions WHERE workspace_id=?')
      .bind(workspace.id)
      .first();
    await input.setInputFiles([
      {
        name: 'broken.png',
        mimeType: 'image/png',
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      },
      {
        name: 'header-only.png',
        mimeType: 'image/png',
        buffer: pngFixture().subarray(0, 33),
      },
    ]);
    await expect(
      page
        .getByRole('listitem', { name: 'broken.png', exact: true })
        .getByRole('alert'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('listitem', { name: 'header-only.png', exact: true })
        .getByRole('alert'),
    ).toContainText('無法解碼');
    assert.deepEqual(
      await db
        .prepare(
          'SELECT count(*) AS n FROM upload_sessions WHERE workspace_id=?',
        )
        .bind(workspace.id)
        .first(),
      reserveCount,
    );
    await input.setInputFiles([
      { name: 'batch.jpg', mimeType: 'image/jpeg', buffer: jpegFixture() },
      { name: 'batch.webp', mimeType: 'image/webp', buffer: webpFixture() },
    ]);
    await page.getByRole('button', { name: '開始上傳', exact: true }).click();
    for (const name of ['batch.jpg', 'batch.webp'])
      await expect(
        page
          .getByRole('listitem', { name, exact: true })
          .getByText('已完成', { exact: true }),
      ).toBeVisible();
    assert.equal(putCount, 3);
    assert.deepEqual(
      await db
        .prepare(
          'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
        )
        .bind(workspace.id)
        .first(),
      {
        used_bytes:
          pngFixture().byteLength +
          jpegFixture().byteLength +
          webpFixture().byteLength,
        reserved_bytes: 0,
      },
    );
    assert.equal(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM upload_completions WHERE workspace_id=?',
          )
          .bind(workspace.id)
          .first()
      ).n,
      3,
    );
    await input.setInputFiles({
      name: 'expires.png',
      mimeType: 'image/png',
      buffer: pngFixture(),
    });
    await page.getByRole('button', { name: '開始上傳', exact: true }).click();
    await expect.poll(() => drops.has('expiry-put')).toBe(true);
    const expiresRow = page.getByRole('listitem', {
      name: 'expires.png',
      exact: true,
    });
    await expect(
      expiresRow.getByRole('button', { name: '取消 expires.png', exact: true }),
    ).toBeEnabled();
    const expiresSession = await db
      .prepare(
        'SELECT id,expires_at_ms FROM upload_sessions WHERE workspace_id=? AND original_filename=?',
      )
      .bind(workspace.id, 'expires.png')
      .first();
    await worker.scheduled({
      scheduledTime: expiresSession.expires_at_ms + 1,
      cron: '*/5 * * * *',
    });
    await reloadUpload();
    await expiresRow
      .getByRole('button', { name: '取消 expires.png', exact: true })
      .click();
    await expect(expiresRow.getByText('已逾期', { exact: true })).toBeVisible();
    await expiresRow
      .getByRole('button', { name: '從清單移除', exact: true })
      .click();
    await expect(expiresRow).toHaveCount(0);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolveScreenshot('upload-mobile.png'),
      fullPage: true,
    });
    await input.setInputFiles({
      name: 'lifecycle.png',
      mimeType: 'image/png',
      buffer: pngFixture(),
    });
    await page.getByRole('button', { name: '開始上傳', exact: true }).click();
    await expect.poll(() => heldSessionId !== null).toBe(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.ok(releaseHeldInit);
    releaseHeldInit();
    await page
      .getByRole('button', { name: '上傳照片 ' + album.name, exact: true })
      .click();
    await expect(page.getByLabel('選擇照片', { exact: true })).toBeEnabled();
    const lifecycleRow = page.getByRole('listitem', {
      name: 'lifecycle.png',
      exact: true,
    });
    await lifecycleRow
      .getByRole('button', { name: '確認 lifecycle.png', exact: true })
      .click();
    await lifecycleRow
      .getByRole('button', { name: '取消 lifecycle.png', exact: true })
      .click();
    await expect(
      lifecycleRow.getByText('已取消', { exact: true }),
    ).toBeVisible();
    assert.deepEqual(lifecycleMutations, [
      `/api/v1/uploads/${heldSessionId}/cancel`,
    ]);
    assert.equal(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM upload_authorizations WHERE upload_session_id=?',
          )
          .bind(heldSessionId)
          .first()
      ).n,
      0,
    );
    await lifecycleRow
      .getByRole('button', { name: '從清單移除', exact: true })
      .click();
    const localKey = (
      await page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith('kino-pic:upload-journal:'),
        ),
      )
    )[0];
    const beforeLocalClear = await db
      .prepare('SELECT count(*) AS n FROM upload_sessions WHERE workspace_id=?')
      .bind(workspace.id)
      .first();
    await page.evaluate(
      (key) => localStorage.setItem(key, '{broken'),
      localKey,
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .getByRole('button', { name: '上傳照片 ' + album.name, exact: true })
      .click();
    await expect(page.getByRole('alert')).toContainText('無法讀取或保存');
    await expect(page.getByLabel('選擇照片', { exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: '清除此相簿的本機續傳記錄', exact: true })
      .click();
    await expect(page.getByLabel('選擇照片', { exact: true })).toBeEnabled();
    assert.deepEqual(
      await db
        .prepare(
          'SELECT count(*) AS n FROM upload_sessions WHERE workspace_id=?',
        )
        .bind(workspace.id)
        .first(),
      beforeLocalClear,
    );
    const { album: blockedAlbum } = await create(
      `/api/v1/projects/${project.id}/albums`,
      { name: 'Journal storage failure' },
    );
    const blocked = await context.newPage();
    await blocked.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      };
    });
    await blocked.route('**/*', bridge);
    await blocked.goto(baseUrl + '/dashboard/projects/' + project.id, {
      waitUntil: 'networkidle',
    });
    await blocked
      .getByRole('button', {
        name: '上傳照片 ' + blockedAlbum.name,
        exact: true,
      })
      .click();
    await expect(blocked.getByRole('alert')).toContainText('無法讀取或保存');
    await expect(
      blocked.getByLabel('選擇照片', { exact: true }),
    ).toBeDisabled();
    await expect(
      blocked.getByRole('button', { name: '開始上傳', exact: true }),
    ).toBeDisabled();
    await blocked.close();
    assert.deepEqual(
      await db
        .prepare(
          'SELECT count(*) AS n FROM upload_sessions WHERE workspace_id=?',
        )
        .bind(workspace.id)
        .first(),
      beforeLocalClear,
    );
    capabilityOverride = true;
    await page.reload({ waitUntil: 'networkidle' });
    await page
      .getByRole('button', { name: '上傳照片 ' + album.name, exact: true })
      .click();
    await expect(page.getByLabel('選擇照片', { exact: true })).toHaveCount(0);
    assert.deepEqual(browserErrors, []);
  } finally {
    await browser.close();
  }
}

function resolveScreenshot(name) {
  return fileURLToPath(new URL('../../../.local/' + name, import.meta.url));
}
