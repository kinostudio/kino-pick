import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

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
}) {
  const browser = await chromium.launch({ headless: true });
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

    await page.getByRole('link', { name: '開啟專案 ' + projectName }).click();
    const albumName = '相簿 ' + crypto.randomUUID();
    await createThroughDialog(page, '相簿', albumName);

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

    return { workspaceName, projectName, albumName };
  } finally {
    await browser.close();
  }
}
