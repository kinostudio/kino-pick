import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { login, origin } from '../helpers/browser';
import {
  projectSchema,
  albumSchema,
} from '../../packages/contracts/src/projects';
const headers = { Origin: origin };
test('archive/restore freezes editing, preserves protection, and handles lost responses/conflicts/current roles', async ({
  page,
  browser,
}) => {
  await login(page, 'e');
  const workspaceId = z.object({ workspace: z.object({ id: z.uuid() }) }).parse(
    await (
      await page.request.post('/api/v1/workspaces', {
        headers,
        data: { name: '封存工作室', requestId: crypto.randomUUID() },
      })
    ).json(),
  ).workspace.id;
  const project = z.object({ project: projectSchema }).parse(
    await (
      await page.request.post('/api/v1/projects', {
        headers,
        data: {
          workspaceId,
          name: '封存專案測試',
          requestId: crypto.randomUUID(),
        },
      })
    ).json(),
  ).project;
  const album = z.object({ album: albumSchema }).parse(
    await (
      await page.request.post(`/api/v1/projects/${project.id}/albums`, {
        headers,
        data: { name: '封存相簿測試', requestId: crypto.randomUUID() },
      })
    ).json(),
  ).album;
  const projectEndpoint = `/api/v1/projects/${project.id}/archive`;
  const albumEndpoint = `/api/v1/albums/${album.id}/archive`;
  const body = (archived: boolean, expectedRevision: number) => ({
    archived,
    expectedRevision,
    requestId: crypto.randomUUID(),
  });
  await page.goto(`/dashboard/projects/${project.id}`);
  await page
    .getByRole('button', { name: '封存相簿 封存相簿測試', exact: true })
    .click();
  const confirmAlbum = page.getByRole('button', {
    name: '確認封存相簿',
    exact: true,
  });
  await expect(confirmAlbum).toBeDisabled();
  await page.getByLabel('我確認封存此相簿', { exact: true }).check();
  const attempts: string[] = [];
  await page.route(
    `**${albumEndpoint}`,
    async (route) => {
      attempts.push(route.request().postData()!);
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await confirmAlbum.click();
  await expect(
    page.getByRole('alert').filter({ hasText: '操作尚未確認' }),
  ).toBeVisible();
  page.on('request', (request) => {
    if (request.url().endsWith(albumEndpoint) && request.method() === 'PATCH')
      attempts.push(request.postData()!);
  });
  await confirmAlbum.click();
  await expect(
    page.getByRole('button', { name: '還原相簿 封存相簿測試', exact: true }),
  ).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(attempts[1]);
  await expect(
    page.getByRole('button', { name: '編輯 封存相簿測試', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: '封存專案 封存專案測試', exact: true })
    .click();
  await page.getByLabel('我確認封存此專案', { exact: true }).check();
  expect(
    (
      await page.request.patch(`/api/v1/projects/${project.id}`, {
        headers,
        data: {
          name: '封存專案新名稱',
          expectedRevision: 1,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: '確認封存專案', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '資料已更新' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '確認封存專案', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: '載入最新封存狀態', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: '封存專案新名稱', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '確認封存專案', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('我確認封存此專案', { exact: true }).check();
  await page.getByRole('button', { name: '確認封存專案', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '還原專案 封存專案新名稱', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('相簿名稱', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '編輯 封存專案新名稱', exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post(`/api/v1/projects/${project.id}/albums`, {
        headers,
        data: { name: '禁止新增', requestId: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.patch(albumEndpoint, { headers, data: body(false, 2) })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.patch(`/api/v1/albums/${album.id}/protection`, {
        headers,
        data: {
          isPinned: true,
          legalHold: true,
          expectedRevision: 2,
          confirmUnprotect: false,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.patch(`/api/v1/albums/${album.id}`, {
        headers,
        data: {
          name: '禁止改名',
          expectedRevision: 3,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(409);
  const other = await browser.newContext({ baseURL: origin });
  const otherPage = await other.newPage();
  await login(otherPage, 'b');
  const membership = {
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'photographer',
    status: 'active',
    requestId: crypto.randomUUID(),
  };
  expect(
    (
      await page.request.put(`/api/v1/workspaces/${workspaceId}/members`, {
        headers,
        data: membership,
      })
    ).status(),
  ).toBe(200);
  await otherPage.goto(`/dashboard/projects/${project.id}`);
  await expect(
    otherPage.getByRole('button', {
      name: '還原專案 封存專案新名稱',
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    (
      await otherPage.request.patch(projectEndpoint, {
        headers,
        data: body(false, 3),
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put(`/api/v1/workspaces/${workspaceId}/members`, {
        headers,
        data: {
          ...membership,
          status: 'suspended',
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await otherPage.request.patch(projectEndpoint, {
        headers,
        data: body(false, 3),
      })
    ).status(),
  ).toBe(404);
  await other.close();
  await page.reload();
  await page
    .getByRole('button', { name: '還原專案 封存專案新名稱', exact: true })
    .click();
  await page.getByLabel('我確認還原此專案', { exact: true }).check();
  await page.getByRole('button', { name: '確認還原專案', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '還原相簿 封存相簿測試', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '還原相簿 封存相簿測試', exact: true })
    .click();
  await page.getByLabel('我確認還原此相簿', { exact: true }).check();
  await page.getByRole('button', { name: '確認還原相簿', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '編輯 封存相簿測試', exact: true }),
  ).toBeVisible();
  const current = z
    .object({ albums: z.array(albumSchema) })
    .parse(
      await (
        await page.request.get(`/api/v1/projects/${project.id}/albums`)
      ).json(),
    ).albums[0]!;
  expect(current).toMatchObject({
    state: 'draft',
    isPinned: true,
    legalHold: true,
    revision: 4,
  });
  expect(
    (
      await page.request.patch(projectEndpoint, {
        headers: { Origin: 'https://attacker.invalid' },
        data: body(true, 4),
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(projectEndpoint, {
        headers,
        data: { ...body(true, 4), status: 'delivered' },
      })
    ).status(),
  ).toBe(400);
  const race = await Promise.all([
    page.request.patch(projectEndpoint, { headers, data: body(true, 4) }),
    page.request.patch(projectEndpoint, { headers, data: body(true, 4) }),
  ]);
  expect(race.map((r) => r.status()).sort()).toEqual([200, 409]);
  await page.reload();
  await page.screenshot({ path: '.local/archive-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page
    .getByRole('button', { name: '還原專案 封存專案新名稱', exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.local/archive-mobile.png', fullPage: true });
});
