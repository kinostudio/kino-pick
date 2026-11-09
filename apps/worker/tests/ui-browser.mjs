import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

async function createThroughDialog(page, label, name) {
  await page.getByRole('button', { name: new RegExp('建立' + label) }).click();
  const dialog = page.getByRole('dialog', { name: '建立' + label });
  await expect(dialog).toBeVisible();
  const nameInput = dialog.getByLabel(label + '名稱');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await dialog
    .getByRole('button', { name: '建立' + label, exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

export async function runWorkerUiBrowserChecks({
  worker,
  baseUrl,
  sessionCookie,
  checkStorageCapacity = false,
}) {
  const browser = await chromium.launch({ headless: true });
  const cardLayouts = [];
  let releaseCapacityRefresh;
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
    let capacityGate;
    async function checkCardLayout(kind) {
      await mkdir('.local', { recursive: true });
      for (const width of [375, 913, 1280, 1920]) {
        await page.setViewportSize({ width, height: 900 });
        const card = page.locator('.studio-' + kind + '-card').first();
        await expect(card).toBeVisible();
        const metrics = await card.evaluate((element, kind) => {
          const rect = element.getBoundingClientRect();
          const cover = element
            .querySelector('.studio-' + kind + '-cover')
            .getBoundingClientRect();
          return {
            cardWidth: rect.width,
            coverRatio: cover.width / cover.height,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        }, kind);
        assert.ok(metrics.cardWidth <= 352.5, kind + ' card stays compact');
        assert.ok(Math.abs(metrics.coverRatio - 4 / 3) < 0.02);
        assert.equal(metrics.overflow, false);
        cardLayouts.push({ kind, viewportWidth: width, ...metrics });
        if (width !== 1920)
          await page.screenshot({
            path: '.local/card-width-' + kind + '-' + width + '.png',
          });
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    const baseOrigin = new URL(baseUrl).origin;
    const assetCacheHeaders = [];
    let initialWorkspaceReads = 0;
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname.startsWith('/assets/')) {
        assetCacheHeaders.push(await response.headerValue('cache-control'));
      }
    });
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      if (new URL(incoming.url()).origin !== baseOrigin) {
        await route.abort('blockedbyclient');
        return;
      }
      const method = incoming.method();
      if (
        method === 'GET' &&
        new URL(incoming.url()).pathname === '/api/v1/storage/oracle-policy' &&
        capacityGate
      )
        await capacityGate;
      if (
        method === 'GET' &&
        new URL(incoming.url()).pathname === '/api/v1/workspaces'
      )
        initialWorkspaceReads++;
      const init = {
        method,
        headers: await incoming.allHeaders(),
        redirect: 'manual',
      };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = incoming.postDataBuffer() ?? undefined;
      }
      const response = await worker.fetch(new Request(incoming.url(), init));
      const headers = Object.fromEntries(response.headers.entries());
      const body = Buffer.from(await response.arrayBuffer());
      await route.fulfill({ status: response.status, headers, body });
    });

    const document = await page.goto(baseUrl + '/', {
      waitUntil: 'domcontentloaded',
    });
    assert.equal(document?.status(), 200);
    assert.match(
      document?.headers()['cache-control'] ?? '',
      /private, no-store/,
    );
    await expect(
      page.getByRole('heading', { name: '攝影工作台' }),
    ).toBeVisible();
    await expect(page.getByLabel('工作空間名稱')).toBeVisible();
    await expect
      .poll(() =>
        assetCacheHeaders.some((value) => value?.includes('immutable')),
      )
      .toBe(true);
    // The shell and workspace page each read once; a recreated schema must not loop.
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    assert.equal(
      initialWorkspaceReads,
      2,
      'Owner shell must settle without repeated workspace requests',
    );

    const workspaceName = '瀏覽器驗收 ' + crypto.randomUUID();
    await page.getByLabel('工作空間名稱').fill(workspaceName);
    await page.getByRole('button', { name: '建立工作空間' }).click();
    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible();

    await page
      .getByRole('link', { name: '查看 ' + workspaceName + ' 的專案' })
      .click();
    const projectName = '專案 ' + crypto.randomUUID();
    await createThroughDialog(page, '專案', projectName);
    await checkCardLayout('project');

    await page.getByRole('link', { name: '開啟專案 ' + projectName }).click();
    const albumName = '相簿 ' + crypto.randomUUID();
    await createThroughDialog(page, '相簿', albumName);
    await checkCardLayout('album');

    const otherAlbumName = '精選相簿';
    await createThroughDialog(page, '相簿', otherAlbumName);
    const tabs = page.getByRole('navigation', { name: '切換同專案相簿' });
    const pillAligned = () =>
      expect
        .poll(async () =>
          tabs.evaluate((element) => {
            const active = element
              .querySelector('[aria-current="page"]')
              ?.getBoundingClientRect();
            const pill = element
              .querySelector('.studio-album-tabs-pill')
              ?.getBoundingClientRect();
            return (
              !!active &&
              !!pill &&
              Math.abs(active.left - pill.left) < 1 &&
              Math.abs(active.width - pill.width) < 1
            );
          }),
        )
        .toBe(true);
    const projectUrl = page.url();
    await tabs.getByRole('button', { name: albumName, exact: true }).click();
    await expect(page.locator('h1')).toHaveText(albumName);
    await pillAligned();
    const albumUrl = page.url();
    assert.ok(new URL(albumUrl).searchParams.get('albumId'));
    await page.locator('h1').click();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(() =>
        tabs.evaluate((element) => {
          const active = element
            .querySelector('[aria-current="page"]')
            .getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return (
            active.left >= bounds.left - 1 && active.right <= bounds.right + 1
          );
        }),
      )
      .toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    const firstWidth = await tabs
      .locator('.studio-album-tabs-pill')
      .evaluate((element) => element.getBoundingClientRect().width);
    await tabs
      .getByRole('button', { name: otherAlbumName, exact: true })
      .click();
    await expect(page.locator('h1')).toHaveText(otherAlbumName);
    await pillAligned();
    assert.notEqual(page.url(), albumUrl);
    const otherWidth = await tabs
      .locator('.studio-album-tabs-pill')
      .evaluate((element) => element.getBoundingClientRect().width);
    assert.ok(otherWidth < firstWidth, 'pill must fit each album label');
    await page.locator('h1').click();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect
      .poll(() =>
        tabs.evaluate((element) => {
          const active = element
            .querySelector('[aria-current="page"]')
            .getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return (
            active.left >= bounds.left - 1 && active.right <= bounds.right + 1
          );
        }),
      )
      .toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goBack();
    await expect(page).toHaveURL(albumUrl);
    await expect(page.locator('h1')).toHaveText(albumName);
    await pillAligned();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1')).toHaveText(albumName);
    await pillAligned();

    await page.setViewportSize({ width: 375, height: 812 });
    await tabs
      .getByRole('button', { name: otherAlbumName, exact: true })
      .click();
    await pillAligned();
    await expect
      .poll(() =>
        tabs.evaluate((element) => {
          const active = element
            .querySelector('[aria-current="page"]')
            .getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return (
            active.left >= bounds.left - 1 && active.right <= bounds.right + 1
          );
        }),
      )
      .toBe(true);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await tabs
      .getByRole('button', { name: otherAlbumName, exact: true })
      .press('Home');
    await expect(page).toHaveURL(projectUrl);
    await pillAligned();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await tabs
        .locator('.studio-album-tabs-pill')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
      '0s',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 720 });

    const originalAlbum = page.locator('.studio-album-card').filter({
      has: page.getByRole('heading', { name: albumName, exact: true }),
    });
    await originalAlbum.getByText('相簿設定', { exact: true }).click();
    await page.getByRole('button', { name: '保護設定 ' + albumName }).click();
    await page.getByLabel('釘選相簿').check();
    await page.getByRole('button', { name: '儲存保護設定' }).click();
    await expect(page.getByText('草稿 · 已釘選')).toBeVisible();

    await page.getByRole('button', { name: '封存相簿 ' + albumName }).click();
    await page.getByLabel('我確認封存此相簿').check();
    await page.getByRole('button', { name: '確認封存相簿' }).click();
    await expect(page.getByText('已封存 · 已釘選')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: projectName }),
    ).toBeVisible();
    await originalAlbum.getByText('相簿設定', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: '保護設定 ' + albumName }),
    ).toBeVisible();
    await expect(page.getByText('已封存 · 已釘選')).toBeVisible();

    if (checkStorageCapacity) {
      await page.getByRole('link', { name: '處理設定', exact: true }).click();
      const r2 = page.getByRole('region', {
        name: 'R2 · 優先儲存',
        exact: true,
      });
      const oracle = page.getByRole('region', {
        name: 'Oracle · 擴充空間',
        exact: true,
      });
      await expect(r2).toContainText('9 GB');
      await expect(oracle).toContainText('30 GB');
      await expect(oracle).toContainText('155.8 GB');
      const quota = page.getByLabel('Oracle 容量上限（GB，可調整）');
      await quota.fill('42');
      capacityGate = new Promise((resolve) => {
        releaseCapacityRefresh = resolve;
      });
      await page
        .getByRole('button', { name: '重新整理用量', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: '儲存設定', exact: true }),
      ).toBeDisabled();
      await expect(quota).toBeDisabled();
      releaseCapacityRefresh();
      capacityGate = undefined;
      await expect(
        page.getByText('用量已更新。', { exact: true }),
      ).toBeVisible();
      await expect(quota).toHaveValue('42');
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
        );
        await page.screenshot({
          path: '.local/storage-capacity-' + width + '.png',
        });
      }
    }
    return { workspaceName, projectName, albumName, cardLayouts };
  } finally {
    releaseCapacityRefresh?.();
    await browser.close();
  }
}
