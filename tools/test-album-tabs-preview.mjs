import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:4198/', { waitUntil: 'networkidle' });
  const nav = page.getByRole('navigation', { name: '切換同專案相簿' });
  await page
    .getByRole('heading', { name: '海邊儀式・精選照片', exact: true })
    .waitFor();
  const aligned = async () => {
    await page.waitForFunction(() => {
      const pill = document
        .querySelector('.studio-album-tabs-pill')
        ?.getBoundingClientRect();
      const active = document
        .querySelector('[aria-current="page"]')
        ?.getBoundingClientRect();
      return (
        pill &&
        active &&
        Math.abs(pill.x - active.x) < 1 &&
        Math.abs(pill.width - active.width) < 1
      );
    });
  };
  await aligned();
  const initial = await nav.locator('.studio-album-tabs-pill').boundingBox();
  await nav.getByRole('button', { name: '宴客花絮', exact: true }).click();
  await page.getByRole('heading', { name: '宴客花絮', exact: true }).waitFor();
  await aligned();
  const changed = await nav.locator('.studio-album-tabs-pill').boundingBox();
  assert.ok(changed.x !== initial.x && changed.width < initial.width);
  const colors = await nav.evaluate((element) => ({
    pill: getComputedStyle(element.querySelector('.studio-album-tabs-pill'))
      .backgroundColor,
    track: getComputedStyle(element.querySelector('.studio-album-tabs-track'))
      .backgroundColor,
  }));
  assert.deepEqual(colors, {
    pill: 'rgb(66, 111, 105)',
    track: 'rgb(238, 236, 230)',
  });
  await nav.getByRole('button', { name: '宴客花絮', exact: true }).press('End');
  await page.getByRole('heading', { name: '修圖成品', exact: true }).waitFor();
  await aligned();
  await page.keyboard.press('Home');
  await page.getByRole('heading', { name: '全部相簿', exact: true }).waitFor();
  await aligned();
  await nav
    .getByRole('button', { name: '海邊儀式・精選照片', exact: true })
    .click();
  await aligned();
  await mkdir('.local', { recursive: true });
  await page.screenshot({ path: '.local/album-tabs-preview-desktop.png' });
  await page.setViewportSize({ width: 375, height: 812 });
  await nav.getByRole('button', { name: '修圖成品', exact: true }).click();
  await aligned();
  const mobile = await page.evaluate(() => {
    const nav = document.querySelector('.studio-album-tabs');
    const active = nav
      .querySelector('[aria-current="page"]')
      .getBoundingClientRect();
    const bounds = nav.getBoundingClientRect();
    return {
      fits: document.documentElement.scrollWidth <= innerWidth,
      scrollable: nav.scrollWidth > nav.clientWidth,
      visible:
        active.left >= bounds.left - 1 && active.right <= bounds.right + 1,
    };
  });
  assert.deepEqual(mobile, { fits: true, scrollable: true, visible: true });
  await page.screenshot({ path: '.local/album-tabs-preview-mobile.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const duration = await nav
    .locator('.studio-album-tabs-pill')
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  assert.equal(duration, '0s');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: 'passed',
      checks: [
        'selection-and-content',
        'pill-position-and-variable-width',
        'existing-colors',
        'keyboard',
        'mobile-overflow-and-active-visible',
        'reduced-motion',
        'no-page-errors',
      ],
    }),
  );
} finally {
  await browser.close();
}
