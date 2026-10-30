import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

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
    const assetCacheHeaders = [];
    page.on('response', async (response) => {
      if (new URL(response.url()).pathname.startsWith('/assets/')) {
        assetCacheHeaders.push(await response.headerValue('cache-control'));
      }
    });
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
      const headers = Object.fromEntries(response.headers.entries());
      const body = Buffer.from(await response.arrayBuffer());
      await route.fulfill({ status: response.status, headers, body });
    });

    const document = await page.goto(baseUrl + '/', {
      waitUntil: 'networkidle',
    });
    assert.equal(document?.status(), 200);
    assert.match(
      document?.headers()['cache-control'] ?? '',
      /private, no-store/,
    );
    await expect(
      page.getByRole('heading', { name: '攝影工作台' }),
    ).toBeVisible();
    await expect
      .poll(() =>
        assetCacheHeaders.some((value) => value?.includes('immutable')),
      )
      .toBe(true);

    const workspaceName = '瀏覽器驗收 ' + crypto.randomUUID();
    await page.getByLabel('工作空間名稱').fill(workspaceName);
    await page.getByRole('button', { name: '建立工作空間' }).click();
    await expect(
      page.getByRole('heading', { name: workspaceName }),
    ).toBeVisible();

    await page
      .getByRole('link', { name: '查看 ' + workspaceName + ' 的專案' })
      .click();
    await expect(page.getByLabel('專案名稱')).toBeVisible();
    const projectName = '專案 ' + crypto.randomUUID();
    await page.getByLabel('專案名稱').fill(projectName);
    await page.getByRole('button', { name: '建立專案' }).click();
    await expect(
      page.getByRole('heading', { name: projectName }),
    ).toBeVisible();

    await page.getByRole('link', { name: '開啟專案 ' + projectName }).click();
    await expect(page.getByLabel('相簿名稱')).toBeVisible();
    const albumName = '相簿 ' + crypto.randomUUID();
    await page.getByLabel('相簿名稱').fill(albumName);
    await page.getByRole('button', { name: '建立相簿' }).click();
    await expect(page.getByRole('heading', { name: albumName })).toBeVisible();

    await page.getByRole('button', { name: '保護設定 ' + albumName }).click();
    await page.getByLabel('釘選相簿').check();
    await page.getByRole('button', { name: '儲存保護設定' }).click();
    await expect(page.getByText('草稿 · 已釘選')).toBeVisible();

    await page.getByRole('button', { name: '封存相簿 ' + albumName }).click();
    await page.getByLabel('我確認封存此相簿').check();
    await page.getByRole('button', { name: '確認封存相簿' }).click();
    await expect(page.getByText('已封存 · 已釘選')).toBeVisible();

    await page.reload({ waitUntil: 'networkidle' });
    await expect(
      page.getByRole('heading', { name: projectName }),
    ).toBeVisible();
    await expect(page.getByText('已封存 · 已釘選')).toBeVisible();

    return { workspaceName, projectName, albumName };
  } finally {
    await browser.close();
  }
}
