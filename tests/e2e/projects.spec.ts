import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { login, origin } from '../helpers/browser';
import {
  projectSchema,
  albumSchema,
} from '../../packages/contracts/src/projects';
const headers = { Origin: origin };

test('project/album persistence, role isolation, concurrent revisions, conflict recovery and cursor pagination', async ({
  page,
  browser,
}) => {
  await login(page);
  const workspaceResponse = await page.request.post('/api/v1/workspaces', {
    headers,
    data: { name: '專案整合工作室', requestId: crypto.randomUUID() },
  });
  expect(workspaceResponse.status()).toBe(201);
  const workspaceId = z
    .object({ workspace: z.object({ id: z.uuid() }) })
    .parse(await workspaceResponse.json()).workspace.id;
  await page.goto(`/dashboard/workspaces/${workspaceId}`);
  await page.getByLabel('專案名稱', { exact: true }).fill('秋日人像');
  await page.getByRole('button', { name: '建立專案', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '開啟專案 秋日人像', exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: '編輯 秋日人像', exact: true })
    .click();
  await page.getByLabel('修改名稱', { exact: true }).fill('秋日人像定稿');
  await page.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await page
    .getByRole('link', { name: '開啟專案 秋日人像定稿', exact: true })
    .click();
  const projectList = z
    .object({ projects: z.array(projectSchema) })
    .parse(
      await (
        await page.request.get(`/api/v1/projects?workspaceId=${workspaceId}`)
      ).json(),
    );
  const project = projectList.projects[0]!;
  expect(project.revision).toBe(2);
  await page.getByLabel('相簿名稱', { exact: true }).fill('第一輪選片');
  await page.getByRole('button', { name: '建立相簿', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '編輯 第一輪選片', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '編輯 第一輪選片', exact: true })
    .click();
  await page.getByLabel('修改名稱', { exact: true }).fill('精選相簿');
  await page.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '編輯 精選相簿', exact: true }),
  ).toBeVisible();
  await page.reload();
  const albums = z
    .object({ albums: z.array(albumSchema) })
    .parse(
      await (
        await page.request.get(`/api/v1/projects/${project.id}/albums`)
      ).json(),
    );
  expect(albums.albums[0]!.name).toBe('精選相簿');
  expect(albums.albums[0]!.revision).toBe(2);
  await page.screenshot({
    path: '.local/m1-project-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '.local/m1-project-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const contextB = await browser.newContext({ baseURL: origin });
  const pageB = await contextB.newPage();
  await login(pageB, 'b');
  expect(
    (await pageB.request.get(`/api/v1/projects/${project.id}`)).status(),
  ).toBe(404);
  expect(
    (await pageB.request.get(`/api/v1/projects/${project.id}/albums`)).status(),
  ).toBe(404);
  expect(
    (
      await pageB.request.get(`/api/v1/projects?workspaceId=${workspaceId}`)
    ).status(),
  ).toBe(404);
  const createAlbum = { name: '越權相簿', requestId: crypto.randomUUID() };
  expect(
    (
      await pageB.request.post(`/api/v1/projects/${project.id}/albums`, {
        headers,
        data: createAlbum,
      })
    ).status(),
  ).toBe(404);
  const membershipUrl = `/api/v1/workspaces/${workspaceId}/members`;
  const member = {
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'retoucher',
    status: 'active',
    requestId: crypto.randomUUID(),
  };
  expect(
    (await page.request.put(membershipUrl, { headers, data: member })).status(),
  ).toBe(200);
  await pageB.goto(`/dashboard/projects/${project.id}`);
  await expect(
    pageB.getByRole('heading', { name: '秋日人像定稿', exact: true }),
  ).toBeVisible();
  await expect(
    pageB.getByRole('button', { name: '建立相簿', exact: true }),
  ).toHaveCount(0);
  await expect(
    pageB.getByRole('button', { name: '編輯 精選相簿', exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await pageB.request.post(`/api/v1/projects/${project.id}/albums`, {
        headers,
        data: createAlbum,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.put(membershipUrl, {
        headers,
        data: {
          ...member,
          role: 'photographer',
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  await pageB.reload();
  await pageB
    .getByRole('button', { name: '編輯 秋日人像定稿', exact: true })
    .click();
  await pageB.getByLabel('修改名稱', { exact: true }).fill('撤權未提交草稿');
  const racing = ['乙的修改', '丙的修改'].map((name) => ({
    name,
    expectedRevision: project.revision,
    requestId: crypto.randomUUID(),
  }));
  const results = await Promise.all(
    racing.map((data) =>
      pageB.request.patch(`/api/v1/projects/${project.id}`, { headers, data }),
    ),
  );
  expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  const winnerIndex = results.findIndex((r) => r.status() === 200);
  const winnerBody = z
    .object({ project: projectSchema })
    .parse(await results[winnerIndex]!.json());
  expect(winnerBody.project.revision).toBe(3);
  const replay = await pageB.request.patch(`/api/v1/projects/${project.id}`, {
    headers,
    data: racing[winnerIndex],
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(winnerBody);
  // Owner page still has revision2. The 409 path must retain their draft.
  await page
    .getByRole('button', { name: '編輯 秋日人像定稿', exact: true })
    .click();
  await page.getByLabel('修改名稱', { exact: true }).fill('保留攝影師的草稿');
  await page.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '重新載入最新資料', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('修改名稱', { exact: true })).toHaveValue(
    '保留攝影師的草稿',
  );
  await expect(
    page.getByRole('button', { name: '儲存名稱', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: '重新載入最新資料', exact: true })
    .click();
  await expect(page.getByLabel('修改名稱', { exact: true })).toHaveValue(
    '保留攝影師的草稿',
  );
  await expect(
    page.getByRole('button', { name: '儲存名稱', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '保留攝影師的草稿', exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.put(membershipUrl, {
        headers,
        data: {
          ...member,
          status: 'suspended',
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  await pageB.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await expect(
    pageB.getByRole('alert').filter({ hasText: '無法存取這筆資料' }),
  ).toBeVisible();
  await expect(pageB.getByLabel('修改名稱', { exact: true })).toHaveValue(
    '撤權未提交草稿',
  );
  const protectedCurrent = z
    .object({ project: projectSchema })
    .parse(
      await (await page.request.get(`/api/v1/projects/${project.id}`)).json(),
    ).project;
  expect(protectedCurrent.name).toBe('保留攝影師的草稿');
  expect(protectedCurrent.revision).toBe(4);
  // A previously successful mutation cannot be replayed after authorization is revoked.
  expect(
    (
      await pageB.request.patch(`/api/v1/projects/${project.id}`, {
        headers,
        data: racing[winnerIndex],
      })
    ).status(),
  ).toBe(404);
  expect(
    (await pageB.request.get(`/api/v1/projects/${project.id}`)).status(),
  ).toBe(404);
  await contextB.close();

  for (let i = 0; i < 25; i++) {
    expect(
      (
        await page.request.post('/api/v1/projects', {
          headers,
          data: {
            workspaceId,
            name: `分頁專案 ${i}`,
            requestId: crypto.randomUUID(),
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await page.request.post(`/api/v1/projects/${project.id}/albums`, {
          headers,
          data: { name: `分頁相簿 ${i}`, requestId: crypto.randomUUID() },
        })
      ).status(),
    ).toBe(201);
  }
  for (const [url, key] of [
    [`/api/v1/projects?workspaceId=${workspaceId}`, 'projects'],
    [`/api/v1/projects/${project.id}/albums`, 'albums'],
  ] as const) {
    const pageSchema = z.object({
      projects: z.array(projectSchema).optional(),
      albums: z.array(albumSchema).optional(),
      nextCursor: z.string().nullable(),
    });
    const first = pageSchema.parse(await (await page.request.get(url)).json());
    const firstRows = first[key]!;
    expect(firstRows).toHaveLength(24);
    expect(first.nextCursor).toBeTruthy();
    const separator = url.includes('?') ? '&' : '?';
    const second = pageSchema.parse(
      await (
        await page.request.get(
          url + separator + 'cursor=' + encodeURIComponent(first.nextCursor!),
        )
      ).json(),
    );
    expect(second[key]).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...firstRows, ...second[key]!].map((row) => row.id)).size,
    ).toBe(26);
    expect(
      (await page.request.get(url + separator + 'cursor=invalid')).status(),
    ).toBe(400);
  }
  expect(
    (
      await page.request.patch(`/api/v1/albums/${albums.albums[0]!.id}`, {
        headers,
        data: {
          name: '不可變更租戶',
          workspaceId: crypto.randomUUID(),
          expectedRevision: 2,
          requestId: crypto.randomUUID(),
        },
      })
    ).status(),
  ).toBe(400);
});

test('lost responses retry the same create/rename request without duplicate entities or revisions', async ({
  page,
}) => {
  await login(page);
  const workspace = z.object({ workspace: z.object({ id: z.uuid() }) }).parse(
    await (
      await page.request.post('/api/v1/workspaces', {
        headers,
        data: { name: '重送一致性工作室', requestId: crypto.randomUUID() },
      })
    ).json(),
  ).workspace;
  await page.goto(`/dashboard/workspaces/${workspace.id}`);
  const creates: unknown[] = [];
  await page.route('**/api/v1/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    creates.push(route.request().postDataJSON());
    if (creates.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      return route.abort('failed'); // server committed; browser never saw success
    }
    return route.continue();
  });
  await page.getByLabel('專案名稱', { exact: true }).fill('回應中斷測試');
  await page.getByRole('button', { name: '建立專案', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '操作尚未確認' }),
  ).toBeVisible();
  await expect(page.getByLabel('專案名稱', { exact: true })).toHaveValue(
    '回應中斷測試',
  );
  await page.getByRole('button', { name: '建立專案', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '開啟專案 回應中斷測試', exact: true }),
  ).toBeVisible();
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual(creates[0]);
  const listed = z
    .object({ projects: z.array(projectSchema) })
    .parse(
      await (
        await page.request.get(`/api/v1/projects?workspaceId=${workspace.id}`)
      ).json(),
    );
  expect(listed.projects).toHaveLength(1);
  const project = listed.projects[0]!;
  expect(project.revision).toBe(1);
  const renames: unknown[] = [];
  await page.route(`**/api/v1/projects/${project.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    renames.push(route.request().postDataJSON());
    if (renames.length === 1) {
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      return route.abort('failed');
    }
    return route.continue();
  });
  await page
    .getByRole('button', { name: '編輯 回應中斷測試', exact: true })
    .click();
  await page.getByLabel('修改名稱', { exact: true }).fill('已恢復回應');
  await page.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: '操作尚未確認' }),
  ).toBeVisible();
  await expect(page.getByLabel('修改名稱', { exact: true })).toHaveValue(
    '已恢復回應',
  );
  await page.getByRole('button', { name: '儲存名稱', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '開啟專案 已恢復回應', exact: true }),
  ).toBeVisible();
  expect(renames).toHaveLength(2);
  expect(renames[1]).toEqual(renames[0]);
  const current = z
    .object({ project: projectSchema })
    .parse(
      await (await page.request.get(`/api/v1/projects/${project.id}`)).json(),
    ).project;
  expect(current.revision).toBe(2);
  expect(current.name).toBe('已恢復回應');
  await page.reload();
  await expect(
    page.getByRole('link', { name: '開啟專案 已恢復回應', exact: true }),
  ).toBeVisible();
});
