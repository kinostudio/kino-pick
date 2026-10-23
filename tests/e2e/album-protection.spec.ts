import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { login, origin } from '../helpers/browser';
import {
  albumSchema,
  projectSchema,
} from '../../packages/contracts/src/projects';
const headers = { Origin: origin };
test('owner protection persists, unprotect confirms, conflicts preserve drafts, and uncertain retries remain idempotent', async ({
  page,
  browser,
}) => {
  await login(page, 'e');
  const workspaceId = z.object({ workspace: z.object({ id: z.uuid() }) }).parse(
    await (
      await page.request.post('/api/v1/workspaces', {
        headers,
        data: { name: '保護工作室', requestId: crypto.randomUUID() },
      })
    ).json(),
  ).workspace.id;
  const project = z.object({ project: projectSchema }).parse(
    await (
      await page.request.post('/api/v1/projects', {
        headers,
        data: {
          workspaceId,
          name: '保護專案',
          requestId: crypto.randomUUID(),
        },
      })
    ).json(),
  ).project;
  const album = z.object({ album: albumSchema }).parse(
    await (
      await page.request.post(`/api/v1/projects/${project.id}/albums`, {
        headers,
        data: { name: '保護測試相簿', requestId: crypto.randomUUID() },
      })
    ).json(),
  ).album;
  const endpoint = `/api/v1/albums/${album.id}/protection`;
  const data = (
    expectedRevision: number,
    isPinned: boolean,
    legalHold: boolean,
    confirmUnprotect = false,
  ) => ({
    expectedRevision,
    isPinned,
    legalHold,
    confirmUnprotect,
    requestId: crypto.randomUUID(),
  });
  await page.goto(`/dashboard/projects/${project.id}`);
  await page
    .getByRole('button', { name: '保護設定 保護測試相簿', exact: true })
    .click();
  await page.getByLabel('釘選相簿', { exact: true }).check();
  await page.getByLabel('保留保護', { exact: true }).check();
  await page.getByRole('button', { name: '儲存保護設定', exact: true }).click();
  await expect(
    page.getByText('草稿 · 已釘選 · 保留保護', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: '保護設定 保護測試相簿', exact: true })
    .click();
  await page.getByLabel('釘選相簿', { exact: true }).uncheck();
  await page.getByLabel('保留保護', { exact: true }).uncheck();
  const confirm = page.getByLabel(
    '我確認解除保護；未來啟用清理政策後可能成為清理候選',
    { exact: true },
  );
  const save = page.getByRole('button', { name: '儲存保護設定', exact: true });
  await expect(save).toBeDisabled();
  const noConfirm = await page.request.patch(endpoint, {
    headers,
    data: data(2, false, false),
  });
  expect(noConfirm.status()).toBe(409);
  expect((await noConfirm.json()).error.code).toBe(
    'PROTECTION_CONFIRMATION_REQUIRED',
  );
  await confirm.check();
  const attempts: string[] = [];
  await page.route(
    `**${endpoint}`,
    async (route) => {
      attempts.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await save.click();
  await expect(
    page.getByRole('alert').filter({ hasText: '操作尚未確認' }),
  ).toBeVisible();
  page.on('request', (request) => {
    if (request.url().endsWith(endpoint) && request.method() === 'PATCH')
      attempts.push(request.postData()!);
  });
  await save.click();
  await expect(
    page.getByRole('button', { name: '保護設定 保護測試相簿', exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
  const list = async () =>
    z
      .object({ albums: z.array(albumSchema) })
      .parse(
        await (
          await page.request.get(`/api/v1/projects/${project.id}/albums`)
        ).json(),
      ).albums[0]!;
  expect(await list()).toMatchObject({
    revision: 3,
    isPinned: false,
    legalHold: false,
  });
  await page
    .getByRole('button', { name: '保護設定 保護測試相簿', exact: true })
    .click();
  await page.getByLabel('釘選相簿', { exact: true }).check();
  expect(
    (
      await page.request.patch(endpoint, {
        headers,
        data: data(3, false, true),
      })
    ).status(),
  ).toBe(200);
  await save.click();
  await expect(
    page.getByRole('alert').filter({ hasText: '資料已更新' }),
  ).toBeVisible();
  await expect(page.getByLabel('釘選相簿', { exact: true })).toBeChecked();
  await expect(save).toBeDisabled();
  await page
    .getByRole('button', { name: '載入最新保護設定', exact: true })
    .click();
  await expect(
    page.getByText('目前設定：釘選關閉，保留保護開啟', { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('釘選相簿', { exact: true })).toBeChecked();
  await expect(save).toBeDisabled();
  await confirm.check();
  await save.click();
  await expect(
    page.getByRole('button', { name: '保護設定 保護測試相簿', exact: true }),
  ).toBeVisible();
  expect(await list()).toMatchObject({
    revision: 5,
    isPinned: true,
    legalHold: false,
  });
  expect(
    (
      await page.request.patch(endpoint, {
        headers: { Origin: 'https://attacker.invalid' },
        data: data(5, false, false, true),
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(endpoint, {
        headers,
        data: { ...data(5, true, false), state: 'deleted' },
      })
    ).status(),
  ).toBe(400);
  const other = await browser.newContext({ baseURL: origin });
  const otherPage = await other.newPage();
  await login(otherPage, 'b');
  const memberData = {
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'photographer',
    status: 'active',
    requestId: crypto.randomUUID(),
  };
  expect(
    (
      await page.request.put(`/api/v1/workspaces/${workspaceId}/members`, {
        headers,
        data: memberData,
      })
    ).status(),
  ).toBe(200);
  await otherPage.goto(`/dashboard/projects/${project.id}`);
  await expect(
    otherPage.getByRole('button', {
      name: '保護設定 保護測試相簿',
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await otherPage.request.patch(endpoint, {
        headers,
        data: data(5, false, false, true),
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put(`/api/v1/workspaces/${workspaceId}/members`, {
        headers,
        data: {
          ...memberData,
          status: 'suspended',
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await otherPage.request.patch(endpoint, {
        headers,
        data: data(5, false, false, true),
      })
    ).status(),
  ).toBe(404);
  await other.close();
  const racing = await Promise.all([
    page.request.patch(endpoint, { headers, data: data(5, true, true) }),
    page.request.patch(endpoint, {
      headers,
      data: data(5, false, false, true),
    }),
  ]);
  expect(racing.map((r) => r.status()).sort()).toEqual([200, 409]);
  expect((await list()).revision).toBe(6);
  await page.reload();
  await page.screenshot({
    path: '.local/album-protection-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page
    .getByRole('button', { name: '保護設定 保護測試相簿', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.local/album-protection-mobile.png',
    fullPage: true,
  });
});
