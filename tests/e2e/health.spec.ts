import { test, expect } from '@playwright/test';
test('foundation page is honest and health route is a liveness check', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'KINO Pic', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('開發基礎已建立 · Phase 0')).toBeVisible();
  await page.screenshot({ path: '.local/phase0-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.local/phase0-mobile.png', fullPage: true });
  await page.getByRole('link', { name: '查看應用健康狀態' }).click();
  await expect(page).toHaveURL(/\/api\/health$/);
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toEqual({
    status: 'ok',
    service: 'kino-pic-web',
    phase: 'M0',
    dependencies: 'not_checked',
  });
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(res.headers()['referrer-policy']).toBe('no-referrer');
});
