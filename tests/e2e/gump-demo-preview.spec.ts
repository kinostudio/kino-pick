import { expect, test, type Locator, type Page } from '@playwright/test';

async function clickNav(page: Page, destination: string) {
  const navigationItem = page
    .locator(`[data-nav="${destination}"]:visible`)
    .first();
  await expect(navigationItem).toBeVisible();
  await navigationItem.click();
}

async function isFavorite(locator: Locator) {
  return locator.evaluate((element) => {
    if (element instanceof HTMLInputElement) return element.checked;
    return element.getAttribute('aria-pressed') === 'true';
  });
}

async function activateLocator(page: Page, locator: Locator, touch: boolean) {
  await locator.scrollIntoViewIfNeeded();
  if (!touch) {
    await locator.click();
    return;
  }
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Photo image button has no visible bounds');
  await page.touchscreen.tap(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
}

async function expectRating(page: Page, selected: number | null) {
  for (let candidate = 1; candidate <= 5; candidate += 1) {
    await expect(
      page.getByTestId('photo-rating-star-' + candidate),
    ).toHaveAttribute('aria-pressed', String(candidate === selected));
  }
}

async function drawFreehand(
  page: Page,
  bounds: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>,
  touch: boolean,
) {
  const startX = bounds.x + bounds.width * 0.24;
  const startY = bounds.y + bounds.height * 0.34;
  const endX = bounds.x + bounds.width * 0.76;
  const endY = bounds.y + bounds.height * 0.63;

  if (!touch) {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.mouse.up();
    return;
  }

  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: startY, id: 1 }],
    });
    for (let step = 1; step <= 8; step += 1) {
      const progress = step / 8;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: startX + (endX - startX) * progress,
            y: startY + (endY - startY) * progress,
            id: 1,
          },
        ],
      });
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}
async function runDemoFlow(page: Page, touch: boolean) {
  const apiRequests: string[] = [];
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiRequests.push(request.url());
    if (url.origin !== 'http://127.0.0.1:4174') {
      externalRequests.push(request.url());
    }
  });

  await page.goto('/');
  const demoBanner = page.getByTestId('demo-banner');
  await expect(demoBanner).toBeVisible();
  await expect(demoBanner).toContainText('互動展示資料');
  await expect(demoBanner).toContainText('不會連到客戶資料');
  await expect(page.getByText('本機展示 · 未連線')).toBeVisible();

  await clickNav(page, 'overview');
  await expect(page.getByRole('heading', { name: '工作總覽' })).toBeVisible();
  await clickNav(page, 'projects');
  await expect(page.getByRole('heading', { name: '專案與相簿' })).toBeVisible();

  const projectCard = page.getByTestId('project-card').first();
  await expect(projectCard).toBeVisible();
  const projectName = (await projectCard.locator('h2').innerText()).trim();
  const projectButton = projectCard.locator('[data-open-project]').first();
  const projectId = await projectButton.getAttribute('data-open-project');
  expect(projectId).toBeTruthy();
  await projectButton.click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  const albumCard = page.getByTestId('album-card').first();
  await expect(albumCard).toBeVisible();
  const albumName = (await albumCard.locator('h3').innerText()).trim();
  const albumButton = albumCard.locator('[data-open-album]').first();
  const albumId = await albumButton.getAttribute('data-open-album');
  expect(albumId).toBeTruthy();
  await albumButton.click();
  await expect(page.getByRole('heading', { name: '相簿工作室' })).toBeVisible();

  await page.getByTestId('share-album').click();
  const shareDialog = page.getByTestId('share-dialog');
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog).toContainText('未連線');
  await expect(shareDialog).toContainText('不會產生正式分享連結');
  await shareDialog.getByRole('checkbox', { name: /下載相片/ }).check();
  await shareDialog
    .getByRole('combobox', { name: /有效期限/ })
    .selectOption({ label: '14 天' });
  await page.getByTestId('save-share-preview').click();
  await expect(shareDialog).toContainText(
    '本機展示設定已保留：檢視 開啟 · 下載 開啟 · 挑選 開啟 · 期限 14 天。未連線，不會產生正式分享連結。',
  );
  await shareDialog.getByRole('button', { name: /返回相簿/ }).click();
  await expect(shareDialog).toBeHidden();

  const photoCard = page.getByTestId('photo-card').first();
  await expect(photoCard).toBeVisible();
  const photoId = await photoCard.getAttribute('data-photo-id');
  expect(photoId).toBeTruthy();
  const photoChoice = photoCard.locator('[data-select]');
  if (await photoChoice.isChecked()) await photoChoice.uncheck();
  await photoChoice.check();
  await expect(photoChoice).toBeChecked();

  const favoriteButton = photoCard.locator('[data-favorite]').first();
  await expect(favoriteButton).toBeVisible();
  if (!(await isFavorite(favoriteButton))) await favoriteButton.click();
  await expect.poll(() => isFavorite(favoriteButton)).toBe(true);

  await clickNav(page, 'recent');
  await expect(page.getByRole('heading', { name: '最近項目' })).toBeVisible();
  await clickNav(page, 'favorites');
  await expect(page.getByRole('heading', { name: '收藏' })).toBeVisible();
  const favoriteEntry = page.locator(`[data-photo-id="${photoId}"]`).first();
  await expect(favoriteEntry).toBeVisible();
  const photoImage = favoriteEntry
    .locator('.photo-open[data-open-photo="' + photoId + '"]')
    .first();
  await expect(photoImage).toBeVisible();
  await expect(photoImage).toHaveAttribute(
    'aria-label',
    '開啟照片詳情：窗邊的晨光',
  );
  await activateLocator(page, photoImage, touch);

  const photoDetail = page.getByTestId('photo-detail-page');
  await expect(photoDetail).toBeVisible();
  await expect(
    photoDetail.getByRole('heading', { name: '相片詳情' }),
  ).toBeVisible();
  const detailTitle = photoDetail.locator('h2').first();
  await expect(detailTitle).toHaveText('窗邊的晨光');
  const detailIndex = page.getByTestId('photo-detail-index');
  await expect(detailIndex).toHaveText('01 / 08');

  const commentText = 'QA 留言 ' + (touch ? '手機' : '桌面');
  await page.getByTestId('photo-comment-input').fill(commentText);
  await page.getByTestId('photo-comment-submit').click();
  await expect(page.getByTestId('photo-comment-list')).toContainText(
    commentText,
  );

  const ratingStatus = page.getByTestId('photo-rating-status');
  await expect(ratingStatus).toHaveText('尚未評等');
  await page.getByTestId('photo-rating-star-4').click();
  await expect(ratingStatus).toHaveText('攝影師推薦 · 4 星');
  await expectRating(page, 4);

  const selectionStatus = photoDetail.locator('.photo-detail-state b');
  await expect(selectionStatus).toHaveText('已選取');
  await photoDetail.locator('[data-toggle-selection]').click();
  await expect(selectionStatus).toHaveText('尚未選取');
  await expectRating(page, 4);
  await expect(ratingStatus).toHaveText('攝影師推薦 · 4 星');
  await photoDetail.locator('[data-toggle-selection]').click();
  await expect(selectionStatus).toHaveText('已選取');

  const detailFavorite = photoDetail.locator('[data-toggle-favorite]');
  await expect(detailFavorite).toContainText('已收藏');
  await detailFavorite.click();
  await expect(photoDetail.locator('[data-toggle-favorite]')).toContainText(
    '加入收藏',
  );
  await photoDetail.locator('[data-toggle-favorite]').click();
  await expect(photoDetail.locator('[data-toggle-favorite]')).toContainText(
    '已收藏',
  );

  const photoCanvas = page.getByTestId('photo-canvas');
  await photoCanvas.scrollIntoViewIfNeeded();
  let canvasBounds = await photoCanvas.boundingBox();
  if (!canvasBounds)
    throw new Error('Photo annotation canvas has no visible bounds');
  const annotationLayer = page.getByTestId('annotation-layer');
  const annotationColor = page.getByTestId('annotation-color');
  await annotationColor.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '#2878d0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const pointTool = page.getByTestId('annotation-tool-point');
  await pointTool.click();
  await expect(pointTool).toHaveAttribute('aria-pressed', 'true');
  const pointX = canvasBounds.x + canvasBounds.width * 0.4;
  const pointY = canvasBounds.y + canvasBounds.height * 0.42;
  if (touch) await page.touchscreen.tap(pointX, pointY);
  else await page.mouse.click(pointX, pointY);
  const pointAnnotation = annotationLayer.getByTestId('annotation-point');
  await expect(pointAnnotation).toHaveCount(1);
  await expect(pointAnnotation.locator('circle')).toHaveAttribute(
    'fill',
    '#2878d0',
  );
  await pointTool.click();
  await expect(pointTool).toHaveAttribute('aria-pressed', 'false');

  const freehandTool = page.getByTestId('annotation-tool-freehand');
  await freehandTool.click();
  await expect(freehandTool).toHaveAttribute('aria-pressed', 'true');
  await photoCanvas.scrollIntoViewIfNeeded();
  canvasBounds = await photoCanvas.boundingBox();
  if (!canvasBounds)
    throw new Error('Photo annotation canvas has no visible bounds');
  await drawFreehand(page, canvasBounds, touch);
  const strokeAnnotation = annotationLayer.getByTestId('annotation-stroke');
  await expect(strokeAnnotation).toHaveCount(1);
  await expect(strokeAnnotation).toHaveAttribute('stroke', '#2878d0');
  await freehandTool.click();
  await expect(freehandTool).toHaveAttribute('aria-pressed', 'false');

  await page.getByTestId('toggle-photo-drafts').click();
  await expect(page.getByTestId('toggle-photo-drafts')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(annotationLayer.getByTestId('annotation-point')).toHaveCount(0);
  await expect(annotationLayer.getByTestId('annotation-stroke')).toHaveCount(0);
  await page.getByTestId('toggle-photo-drafts').click();
  await expect(page.getByTestId('toggle-photo-drafts')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(annotationLayer.getByTestId('annotation-point')).toHaveCount(1);
  await expect(annotationLayer.getByTestId('annotation-stroke')).toHaveCount(1);

  await page.getByTestId('photo-detail-next').click();
  await expect(detailTitle).toHaveText('花園裡的散步');
  await expect(detailIndex).toHaveText('02 / 08');
  await expect(page.getByTestId('photo-comments-empty')).toBeVisible();
  await expect(page.getByTestId('photo-comment-list')).toHaveCount(0);
  await expect(page.getByTestId('photo-rating-status')).toHaveText('尚未評等');
  await expectRating(page, null);
  await expect(photoDetail.locator('.photo-detail-state b')).toHaveText(
    '已選取',
  );
  const nextAnnotationLayer = page.getByTestId('annotation-layer');
  await expect(nextAnnotationLayer.getByTestId('annotation-point')).toHaveCount(
    0,
  );
  await expect(
    nextAnnotationLayer.getByTestId('annotation-stroke'),
  ).toHaveCount(0);
  await page.getByTestId('photo-rating-star-2').click();
  await expect(page.getByTestId('photo-rating-status')).toHaveText(
    '攝影師推薦 · 2 星',
  );
  await expectRating(page, 2);

  await page.getByTestId('photo-detail-prev').click();
  await expect(detailTitle).toHaveText('窗邊的晨光');
  await expect(detailIndex).toHaveText('01 / 08');
  await expect(page.getByTestId('photo-comment-list')).toContainText(
    commentText,
  );
  await expect(page.getByTestId('photo-rating-status')).toHaveText(
    '攝影師推薦 · 4 星',
  );
  await expectRating(page, 4);
  await expect(selectionStatus).toHaveText('已選取');
  await expect(annotationLayer.getByTestId('annotation-point')).toHaveCount(1);
  await expect(annotationLayer.getByTestId('annotation-stroke')).toHaveCount(1);

  await page.getByTestId('photo-rating-clear').click();
  await expect(page.getByTestId('photo-rating-status')).toHaveText('尚未評等');
  await expect(page.getByTestId('photo-rating-clear')).toHaveCount(0);
  await expectRating(page, null);
  await page.getByTestId('clear-photo-draft').click();
  await expect(annotationLayer.getByTestId('annotation-point')).toHaveCount(0);
  await expect(annotationLayer.getByTestId('annotation-stroke')).toHaveCount(0);
  await expect(page.getByTestId('photo-comment-list')).toContainText(
    commentText,
  );
  await expect(selectionStatus).toHaveText('已選取');

  await page.getByTestId('photo-detail-next').click();
  await expect(detailTitle).toHaveText('花園裡的散步');
  await expect(page.getByTestId('photo-rating-status')).toHaveText(
    '攝影師推薦 · 2 星',
  );
  await expectRating(page, 2);
  await page.getByTestId('photo-detail-prev').click();
  await expect(detailTitle).toHaveText('窗邊的晨光');
  await expect(page.getByTestId('photo-rating-status')).toHaveText('尚未評等');
  await expectRating(page, null);

  const compareButton = photoDetail.locator('[data-compare="' + photoId + '"]');
  await expect(compareButton).toBeVisible();
  await compareButton.click();
  const compareDialog = page.getByTestId('compare-dialog');
  const slider = page.getByTestId('before-after-slider');
  await expect(compareDialog).toBeVisible();
  await expect(compareDialog.locator('.compare-title')).toContainText(
    '窗邊的晨光',
  );
  await expect(slider).toHaveAttribute('min', '0');
  await expect(slider).toHaveAttribute('max', '100');
  await expect(slider).toHaveAttribute('aria-valuenow', '50');
  const bounds = await slider.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error('Before/After slider has no visible bounds');

  if (touch) {
    await page.touchscreen.tap(
      bounds.x + bounds.width * 0.8,
      bounds.y + bounds.height / 2,
    );
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(
      50,
    );
    await page.touchscreen.tap(
      bounds.x + bounds.width * 0.2,
      bounds.y + bounds.height / 2,
    );
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBeLessThan(50);
  } else {
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(bounds.x + bounds.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * 0.82, y, { steps: 6 });
    await page.mouse.up();
    expect(Number(await slider.getAttribute('aria-valuenow'))).toBeGreaterThan(
      50,
    );
  }
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuenow', '0');
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuenow', '100');
  await compareDialog.locator('[data-close]').first().click();
  await expect(compareDialog).toBeHidden();

  if (touch) {
    const detailDimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(detailDimensions.scrollWidth).toBeLessThanOrEqual(
      detailDimensions.clientWidth,
    );
  }

  await photoDetail.locator('[data-back]').click();
  await expect(page.getByRole('heading', { name: '收藏' })).toBeVisible();
  await expect(favoriteEntry).toBeVisible();

  await clickNav(page, 'overview');
  await expect(page.getByRole('heading', { name: '工作總覽' })).toBeVisible();
  await clickNav(page, 'projects');
  const returningProject = page
    .getByTestId('project-card')
    .filter({ hasText: projectName })
    .first();
  await expect(returningProject).toBeVisible();
  await returningProject.locator(`[data-open-project="${projectId}"]`).click();
  const returningAlbum = page
    .getByTestId('album-card')
    .filter({ hasText: albumName })
    .first();
  await expect(returningAlbum).toBeVisible();
  await returningAlbum.locator(`[data-open-album="${albumId}"]`).click();
  await expect(page.getByRole('heading', { name: '相簿工作室' })).toBeVisible();
  await expect(
    page.locator(`[data-testid="photo-select-${photoId}"]`),
  ).toBeChecked();
  await expect(
    page.locator(`[data-photo-id="${photoId}"] [data-favorite]`),
  ).toHaveAttribute('aria-pressed', 'true');

  const createdAlbumName = `QA 相簿 ${touch ? '手機' : '桌面'}`;
  await page.getByTestId('create-album').click();
  const createDialog = page.getByTestId('album-create-dialog');
  await expect(createDialog).toBeVisible();
  await page.getByTestId('album-name-input').fill(createdAlbumName);
  await page.getByTestId('create-album-submit').click();
  const createdAlbum = page.getByTestId('created-album-card');
  await expect(createdAlbum).toBeVisible();
  await expect(createdAlbum).toContainText(createdAlbumName);
  await expect(createdAlbum).toContainText('本機暫存');

  await clickNav(page, 'projects');
  await expect(
    page
      .getByTestId('album-card')
      .filter({ hasText: createdAlbumName })
      .first(),
  ).toBeVisible();
  const existingProject = page
    .getByTestId('project-card')
    .filter({ hasText: projectName })
    .first();
  await existingProject.locator(`[data-open-project="${projectId}"]`).click();
  const existingAlbum = page
    .getByTestId('album-card')
    .filter({ hasText: albumName })
    .first();
  await existingAlbum.locator(`[data-open-album="${albumId}"]`).click();
  await expect(
    page.locator(`[data-testid="photo-select-${photoId}"]`),
  ).toBeChecked();

  const guestPreview = page.getByTestId('guest-preview');
  await expect(guestPreview).toBeVisible();
  await guestPreview.click();
  const guestPage = page.getByTestId('guest-pick-page');
  await expect(guestPage).toBeVisible();
  await expect(
    guestPage.getByRole('heading', { name: '客戶挑片預覽' }),
  ).toBeVisible();
  await expect(guestPage).toContainText('展示模式｜不會送出選片');
  await page.getByTestId('studio-return').first().click();
  await expect(page.getByRole('heading', { name: '相簿工作室' })).toBeVisible();
  await expect(
    page.locator(`[data-testid="photo-select-${photoId}"]`),
  ).toBeChecked();

  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
}

test('desktop: navigate project, album, recent, favorites, guest preview, details and compare', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await runDemoFlow(page, false);
});

test('mobile: same page round trips fit 390px and version comparison responds to touch', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await runDemoFlow(page, true);
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  } finally {
    await context.close();
  }
});

type RelativeVisualBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type PhotoAnnotationGeometry = {
  aspectRatio: number;
  pointAspectRatio: number;
  point: RelativeVisualBox;
  stroke: RelativeVisualBox;
};

async function expectPhotoAspectRatio(locator: Locator, expected: number) {
  await expect(locator).toBeVisible();
  const bounds = await locator.boundingBox();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('Photo visual has no measurable bounds');
  }
  expect(Math.abs(bounds.width / bounds.height - expected)).toBeLessThan(0.025);
}

async function readPhotoAnnotationGeometry(
  page: Page,
): Promise<PhotoAnnotationGeometry> {
  const canvasBounds = await page.getByTestId('photo-canvas').boundingBox();
  const pointBounds = await page
    .getByTestId('annotation-point')
    .locator('circle')
    .boundingBox();
  const strokeBounds = await page
    .getByTestId('annotation-stroke')
    .boundingBox();

  if (
    !canvasBounds ||
    !pointBounds ||
    !strokeBounds ||
    canvasBounds.width <= 0 ||
    canvasBounds.height <= 0
  ) {
    throw new Error('Photo annotation geometry is not visible');
  }

  const relativeBox = (
    bounds: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>,
  ): RelativeVisualBox => ({
    x: (bounds.x - canvasBounds.x) / canvasBounds.width,
    y: (bounds.y - canvasBounds.y) / canvasBounds.height,
    width: bounds.width / canvasBounds.width,
    height: bounds.height / canvasBounds.height,
  });

  return {
    aspectRatio: canvasBounds.width / canvasBounds.height,
    pointAspectRatio: pointBounds.width / pointBounds.height,
    point: relativeBox(pointBounds),
    stroke: relativeBox(strokeBounds),
  };
}

function expectNear(actual: number, expected: number, tolerance = 0.02) {
  expect(
    Math.abs(actual - expected),
    `Expected ${expected}, got ${actual} within ${tolerance}`,
  ).toBeLessThan(tolerance);
}

function expectAnnotationGeometryToStayAligned(
  geometry: PhotoAnnotationGeometry,
  baseline: PhotoAnnotationGeometry,
) {
  expectNear(geometry.aspectRatio, 3 / 2, 0.025);
  for (const feature of ['point', 'stroke'] as const) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expectNear(geometry[feature][dimension], baseline[feature][dimension]);
    }
  }
}

async function runResponsivePhotoGeometryCheck(
  page: Page,
  touch: boolean,
  initialViewport: { width: number; height: number },
  responsiveViewports: Array<{ width: number; height: number }>,
) {
  await page.setViewportSize(initialViewport);
  await page.goto('/');
  await clickNav(page, 'overview');
  await clickNav(page, 'projects');

  const projectCard = page.getByTestId('project-card').first();
  const projectName = (await projectCard.locator('h2').innerText()).trim();
  await projectCard.locator('[data-open-project]').first().click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible();

  const albumCard = page.getByTestId('album-card').first();
  await albumCard.locator('[data-open-album]').first().click();
  await expect(page.getByRole('heading', { name: '相簿工作室' })).toBeVisible();

  const galleryVisual = page.getByTestId('photo-visual').first();
  await expectPhotoAspectRatio(galleryVisual, 3 / 2);
  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expectPhotoAspectRatio(galleryVisual, 3 / 2);
  }
  await page.setViewportSize(initialViewport);

  const photoOpen = page
    .getByRole('button', { name: '開啟照片詳情：窗邊的晨光' })
    .first();
  await activateLocator(page, photoOpen, touch);

  const canvas = page.getByTestId('photo-canvas');
  await expect(canvas).toBeVisible();
  await page.getByTestId('annotation-tool-point').click();
  let canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('Photo canvas has no visible bounds');
  const pointX = canvasBounds.x + canvasBounds.width * 0.4;
  const pointY = canvasBounds.y + canvasBounds.height * 0.42;
  if (touch) await page.touchscreen.tap(pointX, pointY);
  else await page.mouse.click(pointX, pointY);
  await expect(page.getByTestId('annotation-point')).toHaveCount(1);

  await page.getByTestId('annotation-tool-freehand').click();
  await canvas.scrollIntoViewIfNeeded();
  canvasBounds = await canvas.boundingBox();
  if (!canvasBounds) throw new Error('Photo canvas has no visible bounds');
  await drawFreehand(page, canvasBounds, touch);
  await expect(page.getByTestId('annotation-stroke')).toHaveCount(1);

  const baseline = await readPhotoAnnotationGeometry(page);

  expectNear(baseline.aspectRatio, 3 / 2, 0.025);
  expectNear(baseline.point.x + baseline.point.width / 2, 0.4, 0.025);
  expectNear(baseline.point.y + baseline.point.height / 2, 0.42, 0.025);
  expectNear(baseline.pointAspectRatio, 1, 0.05);
  expectNear(baseline.stroke.x, 0.24, 0.025);
  expectNear(baseline.stroke.y, 0.34, 0.025);
  expectNear(baseline.stroke.width, 0.52, 0.025);
  expectNear(baseline.stroke.height, 0.29, 0.025);

  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expectAnnotationGeometryToStayAligned(
      await readPhotoAnnotationGeometry(page),
      baseline,
    );
    await expect(
      page.getByTestId('annotation-point').locator('circle'),
    ).toBeVisible();
    await expect(page.getByTestId('annotation-stroke')).toBeVisible();
  }

  await page.setViewportSize(initialViewport);
  expectAnnotationGeometryToStayAligned(
    await readPhotoAnnotationGeometry(page),
    baseline,
  );
}

test('desktop photo and saved annotations keep 3:2 geometry across responsive widths', async ({
  page,
}) => {
  await runResponsivePhotoGeometryCheck(
    page,
    false,
    { width: 1440, height: 900 },
    [
      { width: 1024, height: 900 },
      { width: 390, height: 844 },
    ],
  );
});

test('mobile photo and saved annotations keep 3:2 geometry across phone widths', async ({
  browser,
}) => {
  const initialViewport = { width: 390, height: 844 };
  const context = await browser.newContext({
    viewport: initialViewport,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await runResponsivePhotoGeometryCheck(page, true, initialViewport, [
      { width: 320, height: 800 },
      { width: 428, height: 926 },
    ]);
  } finally {
    await context.close();
  }
});

async function openRecommendationPhoto(page: Page, photoId: string) {
  const gallery = page.getByRole('region', { name: '示範照片' });
  const photo = gallery.locator(
    '[data-testid="photo-card"][data-photo-id="' + photoId + '"]',
  );
  await expect(photo).toBeVisible();
  await photo.locator('.photo-open[data-open-photo="' + photoId + '"]').click();
  await expect(page.getByTestId('photo-detail-page')).toBeVisible();
}

async function returnToRecommendationStudio(page: Page) {
  await page.locator('[data-testid="photo-detail-page"] [data-back]').click();
  await expect(page.getByRole('heading', { name: '相簿工作室' })).toBeVisible();
}

async function setRecommendationPhotoRating(
  page: Page,
  photoId: string,
  rating: number,
) {
  await openRecommendationPhoto(page, photoId);
  await page.getByTestId('photo-rating-star-' + rating).click();
  await expect(page.getByTestId('photo-rating-status')).toContainText(
    rating + ' 星',
  );
  await expect(page.getByTestId('photo-recommendation-status')).toContainText(
    rating + ' 星',
  );
  await returnToRecommendationStudio(page);
}

async function setRecommendationPhotoColor(
  page: Page,
  photoId: string,
  color: 'red' | 'yellow' | 'green' | 'blue' | 'purple',
) {
  await openRecommendationPhoto(page, photoId);
  await page.getByTestId('photo-color-option-' + color).click();
  await returnToRecommendationStudio(page);
}

async function clearRecommendationPhotoColor(page: Page, photoId: string) {
  await openRecommendationPhoto(page, photoId);
  const clear = page.getByTestId('photo-color-clear');
  await expect(clear).toBeEnabled();
  await clear.click();
  await expect(clear).toBeDisabled();
  await returnToRecommendationStudio(page);
}

async function expectStudioRecommendationCount(
  page: Page,
  expectedCount: number,
) {
  await expect(page.getByTestId('recommendation-match-count')).toHaveText(
    String(expectedCount),
  );
}

async function expectGuestRecommendationPhotoIds(
  page: Page,
  expectedPhotoIds: string[],
) {
  const list = page.getByTestId('recommendation-photo-list');
  await expect(list).toBeVisible();
  const cards = list.getByTestId('recommended-photo-card');
  await expect(cards).toHaveCount(expectedPhotoIds.length);
  const actualPhotoIds = await cards.evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute('data-photo-id'))
      .filter((photoId): photoId is string => photoId !== null),
  );
  expect(actualPhotoIds.sort()).toEqual([...expectedPhotoIds].sort());

  const countText = await page
    .getByTestId('recommendation-photo-count')
    .innerText();
  expect(Number(countText.match(/\d+/)?.[0])).toBe(expectedPhotoIds.length);
  for (const photoId of expectedPhotoIds) {
    await expect(
      page
        .locator(
          '[data-testid="recommended-photo-card"][data-photo-id="' +
            photoId +
            '"]',
        )
        .getByTestId('photographer-recommendation-badge'),
    ).toBeVisible();
  }
}

async function returnToRecommendationStudioFromGuest(page: Page) {
  await page.getByTestId('studio-return').first().click();
  await expect(page.getByRole('heading', { name: '相簿工作室' })).toBeVisible();
}

async function visitGuestRecommendations(
  page: Page,
  expectedPhotoIds: string[],
  mobile: boolean,
) {
  await page.getByTestId('guest-preview').click();
  await expect(page.getByTestId('guest-pick-page')).toBeVisible();
  await expectGuestRecommendationPhotoIds(page, expectedPhotoIds);
  if (mobile) {
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
  await returnToRecommendationStudioFromGuest(page);
}

async function visitGuestWithRecommendationsHidden(page: Page) {
  await page.getByTestId('guest-preview').click();
  await expect(page.getByTestId('guest-pick-page')).toBeVisible();
  await expect(page.getByTestId('guest-recommendations')).toHaveCount(0);
  await expect(
    page.getByTestId('photographer-recommendation-badge'),
  ).toHaveCount(0);
  await returnToRecommendationStudioFromGuest(page);
}

async function runRecommendationPreviewFlow(page: Page, mobile: boolean) {
  const apiRequests: string[] = [];
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiRequests.push(request.url());
    if (url.origin !== 'http://127.0.0.1:4174') {
      externalRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '相簿工作室' })).toBeVisible();

  await expect(page.getByTestId('recommendation-display-toggle')).toBeChecked();
  await expect(
    page.getByTestId('recommendation-rating-filter-toggle'),
  ).toBeChecked();
  await expect(
    page.getByTestId('recommendation-color-filter-toggle'),
  ).toBeChecked();
  await expect(page.getByTestId('recommendation-min-rating')).toHaveValue('4');
  await expect(page.getByTestId('recommendation-match-mode')).toHaveValue(
    'any',
  );
  await expect(
    page.getByTestId('recommendation-color-option-red'),
  ).toHaveAttribute('aria-pressed', 'true');
  await expectStudioRecommendationCount(page, 2);
  await visitGuestRecommendations(page, ['p01', 'p06'], mobile);

  await setRecommendationPhotoRating(page, 'p01', 5);
  await setRecommendationPhotoRating(page, 'p02', 3);
  await setRecommendationPhotoRating(page, 'p03', 4);
  await setRecommendationPhotoRating(page, 'p04', 2);

  // Default OR: p01/p03 meet the star threshold, p06 meets the color filter.
  await expectStudioRecommendationCount(page, 3);
  await visitGuestRecommendations(page, ['p01', 'p03', 'p06'], mobile);

  await page.getByTestId('recommendation-match-mode').selectOption('all');
  await expectStudioRecommendationCount(page, 1);
  await visitGuestRecommendations(page, ['p01'], mobile);
  await page.getByTestId('recommendation-match-mode').selectOption('any');
  await expectStudioRecommendationCount(page, 3);

  await page
    .getByTestId('recommendation-color-filter-toggle')
    .setChecked(false);
  await expectStudioRecommendationCount(page, 2);
  await visitGuestRecommendations(page, ['p01', 'p03'], mobile);

  await page
    .getByTestId('recommendation-rating-filter-toggle')
    .setChecked(false);
  await page.getByTestId('recommendation-color-filter-toggle').setChecked(true);
  await expectStudioRecommendationCount(page, 2);
  await visitGuestRecommendations(page, ['p01', 'p06'], mobile);

  // Changing the color threshold live selects the green photos; return to red for the edit checks.
  await page.getByTestId('recommendation-color-option-green').click();
  await expectStudioRecommendationCount(page, 2);
  await visitGuestRecommendations(page, ['p02', 'p07'], mobile);
  await page.getByTestId('recommendation-color-option-red').click();
  await expectStudioRecommendationCount(page, 2);
  await visitGuestRecommendations(page, ['p01', 'p06'], mobile);

  // A live color change adds p07 to the red-only results; clearing its label removes it.
  await setRecommendationPhotoColor(page, 'p07', 'red');
  await expectStudioRecommendationCount(page, 3);
  await visitGuestRecommendations(page, ['p01', 'p06', 'p07'], mobile);
  await clearRecommendationPhotoColor(page, 'p07');
  await expectStudioRecommendationCount(page, 2);
  await visitGuestRecommendations(page, ['p01', 'p06'], mobile);

  // Customer selection state does not participate in recommendation matching.
  await page.getByTestId('guest-preview').click();
  await expect(page.getByTestId('guest-pick-page')).toBeVisible();
  await expectGuestRecommendationPhotoIds(page, ['p01', 'p06']);
  const guestGallery = page.getByRole('region', {
    name: '客戶挑片展示照片',
  });
  const guestP01Selection = guestGallery.getByTestId('photo-select-p01');
  await expect(guestP01Selection).toBeChecked();
  await guestP01Selection.setChecked(false);
  await expect(guestP01Selection).not.toBeChecked();
  await expectGuestRecommendationPhotoIds(page, ['p01', 'p06']);
  await returnToRecommendationStudioFromGuest(page);

  const studioGallery = page.getByRole('region', { name: '示範照片' });
  const studioP01Selection = studioGallery.getByTestId('photo-select-p01');
  await expect(studioP01Selection).not.toBeChecked();
  await page.getByTestId('recommendation-display-toggle').setChecked(false);
  await visitGuestWithRecommendationsHidden(page);
  await expect(studioP01Selection).not.toBeChecked();
  await page.getByTestId('recommendation-display-toggle').setChecked(true);
  await visitGuestRecommendations(page, ['p01', 'p06'], mobile);
  await expect(studioP01Selection).not.toBeChecked();
  await studioP01Selection.setChecked(true);
  await expect(studioP01Selection).toBeChecked();
  await expectStudioRecommendationCount(page, 2);

  // A star threshold change and a changed rating update results immediately.
  await page
    .getByTestId('recommendation-color-filter-toggle')
    .setChecked(false);
  await page
    .getByTestId('recommendation-rating-filter-toggle')
    .setChecked(true);
  await page.getByTestId('recommendation-min-rating').selectOption('5');
  await expectStudioRecommendationCount(page, 1);
  await visitGuestRecommendations(page, ['p01'], mobile);
  await setRecommendationPhotoRating(page, 'p03', 5);
  await expectStudioRecommendationCount(page, 2);
  await visitGuestRecommendations(page, ['p01', 'p03'], mobile);

  // Clearing ratings removes those photos from the live recommendation list.
  await openRecommendationPhoto(page, 'p03');
  await page.getByTestId('photo-rating-clear').click();
  await expect(page.getByTestId('photo-rating-status')).toHaveText('尚未評等');
  await returnToRecommendationStudio(page);
  await expectStudioRecommendationCount(page, 1);
  await visitGuestRecommendations(page, ['p01'], mobile);

  await openRecommendationPhoto(page, 'p01');
  await page.getByTestId('photo-rating-clear').click();
  await expect(page.getByTestId('photo-rating-status')).toHaveText('尚未評等');
  await returnToRecommendationStudio(page);
  await expectStudioRecommendationCount(page, 0);
  await visitGuestRecommendations(page, [], mobile);

  if (mobile) {
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
  expect(apiRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
}

test('desktop: photographer recommendation filters update live and stay independent from client selection', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await runRecommendationPreviewFlow(page, false);
});

test('mobile: photographer recommendation filters fit 390px and update live', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await runRecommendationPreviewFlow(page, true);
  } finally {
    await context.close();
  }
});
