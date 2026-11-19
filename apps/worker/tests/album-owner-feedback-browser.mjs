import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { photoDisplayName } from '../../web/target-ui/photo-filename.ts';
import {
  guestCookieName,
  makeBrowserState,
  ownerCookieValue,
  projectAndAlbumNames,
} from './owner-comments-browser.mjs';

function ownerFeedbackPath(albumId) {
  return (
    '/api/v1/albums/' + encodeURIComponent(albumId) + '/owner-feedback/commands'
  );
}

function parseGuestCookie(base, guest) {
  const defaultName = guestCookieName(base);
  const cookie = guest?.cookie;
  let cookieName = guest?.cookieName ?? defaultName;
  let cookieValue = guest?.cookieValue;

  if (typeof cookie === 'string') {
    const match = /(?:^|;\s*)((?:__Host-)?kino_guest)=([^;]+)/.exec(cookie);
    if (match) {
      cookieName = match[1];
      cookieValue = decodeURIComponent(match[2]);
    } else if (cookieValue === undefined) {
      cookieValue = cookie;
    }
  } else if (cookie && typeof cookie === 'object') {
    cookieName = cookie.name ?? cookieName;
    cookieValue = cookie.value ?? cookieValue;
  }

  assert.equal(typeof cookieValue, 'string', 'Guest fixture has a cookie');
  assert.ok(cookieValue.length > 0, 'Guest cookie is nonempty');
  return { cookieName, cookieValue };
}

async function ensureDisclosureOpen(dialog, label) {
  const summary = dialog.locator('summary').filter({ hasText: label });
  await expect(summary).toHaveCount(1);
  const details = summary.locator('xpath=..');
  if ((await details.getAttribute('open')) === null) await summary.click();
}

async function waitForMutation(state, albumId, operation, photoId, versionId) {
  const path = ownerFeedbackPath(albumId);
  const matches = () =>
    state.observations.ownerMutations.filter(
      (record) =>
        record.pathname.endsWith('/owner-feedback/commands') &&
        record.method === 'POST' &&
        record.status === 200 &&
        record.requestBody?.operation === operation &&
        record.requestBody?.photoId === photoId &&
        record.requestBody?.versionId === versionId,
    );
  await expect.poll(() => matches().length).toBeGreaterThan(0);
  const record = matches().at(-1);
  assert.ok(record, 'Owner feedback command response was observed');
  assert.equal(record.requestBody.operation, operation);
  assert.equal(record.responseBody?.operation, operation);
  assert.equal(record.responseBody?.item?.photoId, photoId);
  assert.equal(record.responseBody?.item?.versionId, versionId);
  assert.equal(record.responseBody?.item?.state, 'open');
  assert.equal(
    record.responseBody?.item?.kind,
    operation.endsWith('_comment') ? 'comment' : 'annotation',
  );
  assert.equal(record.pathname, path);
  return record;
}

async function waitForObservedRequest(state, afterIndex, method, pathname) {
  const matches = () =>
    state.observations.requests
      .slice(afterIndex)
      .filter(
        (record) => record.method === method && record.pathname === pathname,
      );
  await expect.poll(() => matches().length).toBeGreaterThan(0);
  const record = matches().at(-1);
  assert.ok(record, 'The expected local UI request was observed');
  return record;
}

async function assertCanvasNavigationDoesNotOverlap(dialog, role) {
  const layout = await dialog.evaluate((element) => {
    const canvas = element.querySelector('[data-testid="annotation-canvas"]');
    const navigation = element.querySelector('.kino-photo-detail-navigation');
    const rect = (target) => {
      if (!(target instanceof Element)) return null;
      const bounds = target.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const canvasBounds = rect(canvas);
    const navigationBounds = rect(navigation);
    const intersects =
      canvasBounds !== null &&
      navigationBounds !== null &&
      canvasBounds.left < navigationBounds.right &&
      canvasBounds.right > navigationBounds.left &&
      canvasBounds.top < navigationBounds.bottom &&
      canvasBounds.bottom > navigationBounds.top;
    return {
      viewportWidth: window.innerWidth,
      canvas: canvasBounds,
      navigation: navigationBounds,
      intersects,
    };
  });
  assert.equal(
    layout.viewportWidth,
    375,
    `${role} lightbox layout is checked at the existing 375px viewport`,
  );
  assert.ok(layout.canvas?.width > 0 && layout.canvas?.height > 0);
  assert.ok(layout.navigation?.width > 0 && layout.navigation?.height > 0);
  assert.equal(
    layout.intersects,
    false,
    `${role} annotation canvas and photo navigation must not overlap: ` +
      JSON.stringify(layout),
  );
}

async function waitForStableFreehandSurface(canvas) {
  const result = await canvas.evaluate(async (element) => {
    const application = element.querySelector('[role="application"]');
    const image = element.querySelector(
      '[data-testid="annotation-preview-image"]',
    );
    if (!(application instanceof HTMLElement))
      return { stable: false, reason: 'application surface is missing' };
    if (!(image instanceof HTMLImageElement))
      return { stable: false, reason: 'preview image is missing' };

    const rect = (target) => {
      const bounds = target.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const fractions = [
      [0.24, 0.28],
      [0.48, 0.56],
      [0.74, 0.39],
    ];
    let previousSignature = '';
    let stableFrames = 0;
    let latest = null;

    for (let frame = 1; frame <= 45; frame += 1) {
      await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
      const applicationBounds = rect(application);
      const imageBounds = rect(image);
      const style = getComputedStyle(image);
      let painted = imageBounds;
      if (style.objectFit === 'contain') {
        const scale = Math.min(
          imageBounds.width / image.naturalWidth,
          imageBounds.height / image.naturalHeight,
        );
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        painted = {
          left: imageBounds.left + (imageBounds.width - width) / 2,
          top: imageBounds.top + (imageBounds.height - height) / 2,
          right: imageBounds.left + (imageBounds.width + width) / 2,
          bottom: imageBounds.top + (imageBounds.height + height) / 2,
          width,
          height,
        };
      }
      const points = fractions.map(([x, y]) => ({
        x: painted.left + painted.width * x,
        y: painted.top + painted.height * y,
      }));
      const drawingStage = Array.from(application.children).find((child) =>
        child.classList.contains('select-none'),
      );
      const hits = points.map((point) => {
        const target = document.elementFromPoint(point.x, point.y);
        return {
          tagName: target?.tagName ?? null,
          className:
            typeof target?.className === 'string'
              ? target.className
              : (target?.getAttribute('class') ?? null),
          insideApplication: Boolean(target && application.contains(target)),
          insideDrawingStage: Boolean(target && drawingStage?.contains(target)),
          inPaintedImage:
            point.x >= painted.left &&
            point.x <= painted.right &&
            point.y >= painted.top &&
            point.y <= painted.bottom,
        };
      });
      latest = {
        frame,
        stableFrames: 0,
        applicationBounds,
        imageBounds,
        paintedBounds: painted,
        imageComplete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        points,
        hits,
      };
      const signature = JSON.stringify({
        applicationBounds,
        imageBounds,
        painted,
        imageComplete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        hits,
      });
      stableFrames = signature === previousSignature ? stableFrames + 1 : 1;
      latest.stableFrames = stableFrames;
      if (
        stableFrames >= 4 &&
        image.complete &&
        image.naturalWidth > 0 &&
        image.naturalHeight > 0 &&
        hits.every(
          (hit) =>
            hit.insideApplication &&
            hit.insideDrawingStage &&
            hit.inPaintedImage,
        )
      )
        return { ...latest, stable: true };
      previousSignature = signature;
    }
    return { ...(latest ?? {}), stable: false, maxFrames: 45 };
  });
  assert.ok(
    result.stable,
    'The drawing surface must keep stable viewport/image bounds and hit-test points for 4 consecutive RAF frames within 45 frames: ' +
      JSON.stringify(result),
  );
  return result;
}

async function openOwnerFeedbackPhoto({
  page,
  base,
  projectId,
  albumId,
  projectName,
  albumName,
  photos,
}) {
  const response = await page.goto(
    new URL('/dashboard/projects/' + encodeURIComponent(projectId), base).href,
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(response?.status(), 200);
  await expect(
    page.getByRole('heading', { name: projectName, exact: true }),
  ).toBeVisible();
  const toggle = page.getByRole('button', { name: '切換工作台選單' });
  const sidebar = page.getByRole('complementary', { name: '工作台導覽' });
  await toggle.click();
  const triggerBox = await toggle.boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  assert.ok(
    triggerBox &&
      sidebarBox &&
      sidebarBox.y >= triggerBox.y + triggerBox.height,
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  const openAlbum = page.getByRole('button', {
    name: '開啟相簿 ' + albumName,
    exact: true,
  });
  const cardTestId = await openAlbum
    .locator('xpath=ancestor::li[1]')
    .getAttribute('data-testid');
  assert.equal(cardTestId, 'album-card-' + albumId);
  await openAlbum.click();
  assert.equal(new URL(page.url()).searchParams.get('albumId'), albumId);
  const previewButtons = page.getByRole('button', {
    name: /^開啟照片預覽：/u,
  });
  await expect(previewButtons).toHaveCount(photos.length);
  const visibleFilenames = await previewButtons.evaluateAll((buttons) =>
    buttons.map(
      (button) =>
        button.getAttribute('aria-label')?.replace(/^開啟照片預覽：/u, '') ??
        '',
    ),
  );
  const orderedPhotos = visibleFilenames.map((filename) =>
    photos.find((photo) => photo.filename === filename),
  );
  assert.ok(
    orderedPhotos.every((photo) => photo !== undefined),
    'The album UI shows both fixture photos in a known order',
  );
  const [currentPhoto, nextPhoto] = orderedPhotos;
  assert.ok(currentPhoto && nextPhoto);
  await previewButtons.first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(currentPhoto.filename);
  await expect(
    dialog.getByRole('heading', {
      name: currentPhoto.filename,
      level: 2,
      exact: true,
      includeHidden: true,
    }),
  ).toBeVisible();
  return { dialog, currentPhoto, nextPhoto };
}

async function drawFreehand(dialog, panel) {
  const canvas = dialog.getByTestId('annotation-canvas');
  let startPoint = null;
  let stableSurface = null;
  let interactionEndSurface = null;
  try {
    await expect(canvas).toBeVisible();
    await assertCanvasNavigationDoesNotOverlap(dialog, 'Owner');
    await canvas.scrollIntoViewIfNeeded();
    const image = canvas.getByTestId('annotation-preview-image');
    await expect(image).toBeVisible();
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement &&
            element.complete &&
            element.naturalWidth > 0 &&
            element.naturalHeight > 0,
        ),
      )
      .toBe(true);

    await panel.getByRole('button', { name: '手繪', exact: true }).click();
    const drawingSurface = canvas.getByRole('application');
    await expect(drawingSurface).toBeVisible();
    await expect(drawingSurface).toHaveAttribute('aria-label', /自由筆畫模式/u);
    stableSurface = await waitForStableFreehandSurface(canvas);
    startPoint = stableSurface.points[0] ?? null;
    assert.ok(startPoint);
    await dialog
      .page()
      .mouse.move(Math.round(startPoint.x), Math.round(startPoint.y));
    await dialog.page().mouse.down();
    for (const point of stableSurface.points.slice(1))
      await dialog.page().mouse.move(Math.round(point.x), Math.round(point.y), {
        steps: 8,
      });
    await dialog.page().mouse.up();
    interactionEndSurface = await canvas.evaluate((element) => {
      const bounds = (target) => {
        if (!(target instanceof Element)) return null;
        const rect = target.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        application: bounds(element.querySelector('[role="application"]')),
        image: bounds(
          element.querySelector('[data-testid="annotation-preview-image"]'),
        ),
      };
    });
    await expect(canvas.getByTestId('annotation-draft-mark')).toBeVisible();
  } catch (error) {
    const evidence = await canvas
      .evaluate((element, point) => {
        const app = element.querySelector('[role="application"]');
        const image = element.querySelector(
          '[data-testid="annotation-preview-image"]',
        );
        const hit =
          point && Number.isFinite(point.x) && Number.isFinite(point.y)
            ? document.elementFromPoint(point.x, point.y)
            : null;
        const rect = (value) => {
          if (!(value instanceof Element)) return null;
          const bounds = value.getBoundingClientRect();
          return {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
            width: bounds.width,
            height: bounds.height,
          };
        };
        const preview = image instanceof HTMLImageElement ? image : null;
        return {
          application: {
            role: app?.getAttribute('role') ?? null,
            ariaLabel: app?.getAttribute('aria-label') ?? null,
            bounds: rect(app),
          },
          image: {
            bounds: rect(image),
            complete: preview?.complete ?? false,
            naturalWidth: preview?.naturalWidth ?? 0,
            naturalHeight: preview?.naturalHeight ?? 0,
          },
          startPoint: point,
          pointerHit: {
            tagName: hit?.tagName ?? null,
            role: hit?.getAttribute('role') ?? null,
            testId: hit?.getAttribute('data-testid') ?? null,
            className:
              typeof hit?.className === 'string'
                ? hit.className
                : (hit?.getAttribute('class') ?? null),
            insideApplication: Boolean(app && hit && app.contains(hit)),
          },
          draftMarks: element.querySelectorAll(
            '[data-testid="annotation-draft-mark"]',
          ).length,
          freehandPreviews: element.querySelectorAll(
            '[data-testid="annotation-freehand-preview"]',
          ).length,
          canvasStatuses: Array.from(
            element.querySelectorAll('[role="status"], [aria-live]'),
          ).map((node) => node.textContent?.trim() ?? ''),
        };
      }, startPoint)
      .catch((diagnosticError) => ({
        canvasInspectionError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      }));
    const panelEvidence = await panel
      .evaluate((element) => ({
        statuses: Array.from(
          element.querySelectorAll(
            '[role="status"], [role="alert"], [aria-live]',
          ),
        ).map((node) => node.textContent?.trim() ?? ''),
        buttons: Array.from(element.querySelectorAll('button')).map(
          (button) => ({
            text: button.textContent?.trim() ?? '',
            disabled: button.disabled,
            ariaLabel: button.getAttribute('aria-label'),
          }),
        ),
      }))
      .catch((diagnosticError) => ({
        panelInspectionError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      }));
    const diagnostics = {
      error: error instanceof Error ? error.message : String(error),
      stableSurface,
      interactionEndSurface,
      canvas: evidence,
      panel: panelEvidence,
    };
    const jsonPath = resolve('.local/owner-feedback-draw-failure.json');
    const screenshotPath = resolve('.local/owner-feedback-draw-failure.png');
    await writeFile(jsonPath, JSON.stringify(diagnostics, null, 2), 'utf8');
    await dialog
      .page()
      .screenshot({ path: screenshotPath, fullPage: true })
      .catch(() => undefined);
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.message +=
      ' (drawing diagnostics: ' +
      jsonPath +
      '; screenshot: ' +
      screenshotPath +
      ')';
    throw failure;
  }
}

async function openGuestPhoto(page, base, fixture, photo) {
  const response = await page.goto(
    new URL('/guest/albums/' + encodeURIComponent(fixture.albumId), base).href,
    { waitUntil: 'domcontentloaded' },
  );
  assert.equal(response?.status(), 200);
  await expect(
    page.getByRole('heading', { name: /^Kino Pick (?:線上挑片|相簿)$/u }),
  ).toBeVisible();
  await page
    .getByRole('list', { name: '相簿照片列表' })
    .getByRole('button', {
      name: '檢視大圖 ' + photo.filename,
      exact: true,
    })
    .click();
  const dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName(photo.filename);
  await ensureDisclosureOpen(dialog, '攝影師意見');
  return {
    dialog,
    panel: dialog.getByRole('region', { name: '攝影師意見', exact: true }),
  };
}

export async function runAlbumOwnerFeedbackBrowserChecks({
  db,
  worker,
  base,
  fixture,
  owner,
  browser: suppliedBrowser,
}) {
  assert.ok(db && worker && base && fixture);
  assert.ok(owner, 'Owner feedback browser checks need the Owner id');
  assert.ok(
    fixture.ownerCookie,
    'Owner feedback fixture includes Owner cookie',
  );
  for (const key of [
    'projectId',
    'albumId',
    'photoId',
    'versionId',
    'filename',
    'nextPhotoId',
    'nextVersionId',
    'nextFilename',
    'guestViewOnly',
  ])
    assert.ok(fixture[key], 'Owner feedback fixture provides ' + key);
  assert.notEqual(fixture.photoId, fixture.nextPhotoId);

  const { albumName, projectName, projectId } = await projectAndAlbumNames(
    db,
    fixture.albumId,
  );
  const browser =
    suppliedBrowser ?? (await chromium.launch({ headless: true }));
  const ownsBrowser = suppliedBrowser === undefined;
  let ownerState;
  let guestState;
  try {
    ownerState = await makeBrowserState({
      browser,
      worker,
      base,
      cookieName: 'kino-owner.session_token',
      cookieValue: ownerCookieValue(fixture.ownerCookie),
      kind: 'owner',
      albumId: fixture.albumId,
      mutationSuffix: 'owner-feedback',
    });
    const opened = await openOwnerFeedbackPhoto({
      page: ownerState.page,
      base,
      projectId,
      albumId: fixture.albumId,
      projectName,
      albumName,
      photos: [
        {
          id: fixture.photoId,
          versionId: fixture.versionId,
          filename: fixture.filename,
        },
        {
          id: fixture.nextPhotoId,
          versionId: fixture.nextVersionId,
          filename: fixture.nextFilename,
        },
      ],
    });
    const { dialog, currentPhoto, nextPhoto } = opened;
    assert.equal(
      new URL(ownerState.page.url()).searchParams.get('photoId'),
      currentPhoto.id,
      'The Owner lightbox URL matches the first photo in gallery order',
    );

    const download = dialog.getByRole('button', { name: '下載這張照片' });
    const quality = dialog.getByRole('group', { name: '下載畫質' });
    await expect(download).toBeVisible();
    await expect(
      dialog.getByText('請先儲存、重試或取消這筆註記。'),
    ).toHaveCount(0);
    await download.click();
    await expect(
      quality.getByRole('link', { name: '原始畫質' }),
    ).toHaveAttribute(
      'href',
      `/api/v1/photos/${currentPhoto.id}/versions/${currentPhoto.versionId}/original`,
    );
    await download.click();
    const photoImage = dialog.locator('.kino-photo-zoom-image img');
    await photoImage.dispatchEvent('pointerdown', {
      pointerType: 'touch',
      isPrimary: true,
      clientX: 40,
      clientY: 40,
    });
    await expect(quality.getByRole('link', { name: '縮圖' })).toBeVisible();
    await photoImage.dispatchEvent('pointerup', {
      pointerType: 'touch',
      isPrimary: true,
    });
    await download.click();

    await ensureDisclosureOpen(dialog, '評論');
    const commentPanel = dialog.getByRole('region', {
      name: '攝影師意見',
      exact: true,
    });
    const commentText = '本機攝影師意見 ' + randomUUID();
    const commentDraft = '取消草稿 ' + randomUUID();
    const commentInput = commentPanel.getByPlaceholder('留下意見…');
    await expect(commentInput).toBeEnabled();
    const ownerIdentityRead = ownerState.observations.requests.find(
      (record) =>
        record.method === 'GET' &&
        record.pathname === '/api/v1/me' &&
        record.status === 200,
    );
    assert.equal(ownerIdentityRead?.responseBody?.actor?.id, owner);
    await commentInput.fill(commentText);
    await commentPanel
      .getByRole('button', { name: '發表', exact: true })
      .click();
    const commentMutation = await waitForMutation(
      ownerState,
      fixture.albumId,
      'create_comment',
      currentPhoto.id,
      currentPhoto.versionId,
    );
    const commentId = commentMutation.responseBody.item.id;
    await expect(
      commentPanel.getByText(commentText, { exact: true }),
    ).toBeVisible();

    const annotationReadStart = ownerState.observations.requests.length;
    await ensureDisclosureOpen(dialog, '繪圖與註記');
    const annotationPanel = dialog.getByRole('region', {
      name: '攝影師手繪意見',
      exact: true,
    });
    const feedbackRead = await waitForObservedRequest(
      ownerState,
      annotationReadStart,
      'GET',
      '/api/v1/albums/' +
        encodeURIComponent(fixture.albumId) +
        '/photos/' +
        encodeURIComponent(currentPhoto.id) +
        '/versions/' +
        encodeURIComponent(currentPhoto.versionId) +
        '/owner-feedback',
    );
    assert.equal(
      feedbackRead.status,
      200,
      'Owner feedback read for the annotation scope succeeds: ' +
        JSON.stringify(feedbackRead.responseBody),
    );
    const freehandCapabilities = await waitForObservedRequest(
      ownerState,
      annotationReadStart,
      'GET',
      '/api/v1/annotations/authoring/freehand-capabilities',
    );
    assert.equal(
      freehandCapabilities.status,
      200,
      'Owner freehand capability endpoint succeeds: ' +
        JSON.stringify(freehandCapabilities.responseBody),
    );
    assert.equal(
      freehandCapabilities.responseBody?.enabled,
      true,
      'The local fixture enables the real Owner freehand capability',
    );
    await expect(
      annotationPanel.getByRole('button', { name: '手繪', exact: true }),
    ).toBeVisible();
    await drawFreehand(dialog, annotationPanel);
    await annotationPanel
      .getByRole('button', { name: '儲存', exact: true })
      .click();
    const annotationMutation = await waitForMutation(
      ownerState,
      fixture.albumId,
      'create_annotation',
      currentPhoto.id,
      currentPhoto.versionId,
    );
    const annotationId = annotationMutation.responseBody.item.id;
    assert.equal(annotationMutation.requestBody.geometry.type, 'freehand');
    await expect(
      annotationPanel.getByRole('region', { name: '手繪意見列表' }),
    ).toContainText('手繪標記');

    const guest = parseGuestCookie(base, fixture.guestViewOnly);
    guestState = await makeBrowserState({
      browser,
      worker,
      base,
      cookieName: guest.cookieName,
      cookieValue: guest.cookieValue,
      kind: 'guest',
      albumId: fixture.albumId,
    });
    const guestOpened = await openGuestPhoto(
      guestState.page,
      base,
      fixture,
      currentPhoto,
    );
    await expect(
      guestOpened.dialog.getByTestId('annotation-canvas'),
    ).toBeVisible();
    await assertCanvasNavigationDoesNotOverlap(guestOpened.dialog, 'Guest');
    await expect(
      guestOpened.panel.getByText(commentText, { exact: true }),
    ).toBeVisible();
    await expect(
      guestOpened.panel.getByRole('region', { name: '手繪意見列表' }),
    ).toContainText('手繪標記');
    await expect(
      guestOpened.dialog.getByTestId('annotation-mark-' + annotationId),
    ).toBeVisible();
    await expect(
      guestOpened.dialog.getByTestId('annotation-canvas').getByRole('img', {
        name: currentPhoto.filename + ' 標註預覽',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      guestOpened.dialog
        .getByTestId('annotation-canvas')
        .getByRole('application'),
    ).toHaveCount(0);
    const guestCanvasControls = guestOpened.panel.getByRole('region', {
      name: '標註畫布與檢視控制',
      exact: true,
    });
    await expect(
      guestCanvasControls.locator('input[type="range"]'),
    ).toHaveCount(3);
    for (const label of [
      '標註畫布縮放',
      '標註畫布水平移動',
      '標註畫布垂直移動',
    ])
      await expect(
        guestCanvasControls.getByRole('slider', { name: label, exact: true }),
      ).toHaveCount(1);
    await expect(
      guestOpened.panel.locator('textarea, select, input:not([type="range"])'),
    ).toHaveCount(0);
    for (const name of ['發表', '手繪', '儲存', '取消'])
      await expect(
        guestOpened.panel.getByRole('button', { name, exact: true }),
      ).toHaveCount(0);
    assert.equal(
      guestState.observations.requests.some(
        (record) =>
          record.method !== 'GET' &&
          record.pathname.includes('/owner-feedback/commands'),
      ),
      false,
      'Guest viewing does not send Owner feedback mutations',
    );

    await commentInput.fill(commentDraft);
    await expect(
      dialog.getByText('請先儲存或取消攝影師意見草稿。', { exact: true }),
    ).toBeVisible();
    const nextButton = dialog.getByRole('button', {
      name: '下一張',
      exact: true,
      includeHidden: true,
    });
    const previousButton = dialog.getByRole('button', {
      name: '上一張',
      exact: true,
      includeHidden: true,
    });
    await expect(previousButton).toBeDisabled();
    await expect(nextButton).toBeDisabled();
    const mutationCountBeforeCancel =
      ownerState.observations.ownerMutations.length;
    await commentPanel
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await expect(
      dialog.getByText('請先儲存或取消攝影師意見草稿。', { exact: true }),
    ).toHaveCount(0);
    await expect(nextButton).toBeEnabled();
    assert.equal(
      ownerState.observations.ownerMutations.length,
      mutationCountBeforeCancel,
      'Canceling the local comment draft sends no command',
    );
    await nextButton.click();
    assert.equal(
      new URL(ownerState.page.url()).searchParams.get('photoId'),
      nextPhoto.id,
      'The next-photo navigation updates the URL to the exact next photo',
    );
    await expect(dialog.locator('h2.kino-photo-detail-title')).toHaveText(
      photoDisplayName(nextPhoto.filename),
    );
    await ensureDisclosureOpen(dialog, '評論');
    const nextCommentPanel = dialog.getByRole('region', {
      name: '攝影師意見',
      exact: true,
    });
    const nextCommentInput = nextCommentPanel.getByPlaceholder('留下意見…');
    await expect(nextCommentInput).toBeEnabled();
    await expect(nextCommentInput).toHaveValue('');
    await expect(
      nextCommentPanel.getByText(commentDraft, { exact: true }),
    ).toHaveCount(0);
    await expect(
      nextCommentPanel.getByText(commentText, { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByText('請先儲存或取消攝影師意見草稿。', { exact: true }),
    ).toHaveCount(0);
    const secondDraft = '第二張取消草稿 ' + randomUUID();
    await nextCommentInput.fill(secondDraft);
    await expect(
      dialog.getByText('請先儲存或取消攝影師意見草稿。', { exact: true }),
    ).toBeVisible();
    await expect(previousButton).toBeDisabled();
    await expect(nextButton).toBeDisabled();
    await nextCommentPanel
      .getByRole('button', { name: '取消', exact: true })
      .click();
    await expect(
      dialog.getByText('請先儲存或取消攝影師意見草稿。', { exact: true }),
    ).toHaveCount(0);
    await expect(previousButton).toBeEnabled();
    assert.equal(
      ownerState.observations.ownerMutations.length,
      mutationCountBeforeCancel,
      'Canceling drafts on either photo sends no command',
    );
    assert.equal(ownerState.observations.pageErrors.length, 0);
    assert.equal(guestState.observations.pageErrors.length, 0);
    assert.deepEqual(ownerState.observations.bridgeErrors, []);
    assert.deepEqual(guestState.observations.bridgeErrors, []);

    return {
      ownerCommentId: commentId,
      ownerAnnotationId: annotationId,
      ownerPhotoId: currentPhoto.id,
      guestSawSameComment: true,
      guestSawSameAnnotation: true,
      guestWriteControls: 0,
      commentDraftCancelled: true,
      nextPhotoId: nextPhoto.id,
      nextPhotoStartsWithEmptyDraft: true,
    };
  } finally {
    await guestState?.close();
    await ownerState?.close();
    if (ownsBrowser) await browser.close();
  }
}
