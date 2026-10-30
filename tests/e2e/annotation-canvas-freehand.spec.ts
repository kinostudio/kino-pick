import { expect, test, type Locator, type Page } from '@playwright/test';

const fixturePath = '/annotation-canvas-freehand-test.html';

async function act(
  page: Page,
  type: 'mode' | 'scope' | 'draw',
  value: boolean | string,
) {
  await page.evaluate(
    ({ actionType, actionValue }) => {
      window.dispatchEvent(
        new CustomEvent('annotation-canvas-fixture', {
          detail: { type: actionType, value: actionValue },
        }),
      );
    },
    { actionType: type, actionValue: value },
  );
}

async function previewImage(page: Page): Promise<Locator> {
  const image = page.getByTestId('annotation-preview-image').last();
  await expect(page.getByTestId('annotation-zoom')).toBeEnabled();
  await expect(image).toBeVisible();
  return image;
}

async function dragAcrossImage(page: Page, image: Locator) {
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error('The fixture preview image has no layout box');

  const y = bounds.y + bounds.height * 0.45;
  await page.mouse.move(bounds.x + bounds.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.48, y + 12, { steps: 4 });
  await page.mouse.move(bounds.x + bounds.width * 0.75, y + 28, { steps: 4 });
  await page.mouse.up();
}

async function dragWhileHeld(
  page: Page,
  image: Locator,
): Promise<{ endX: number; endY: number }> {
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error('The fixture preview image has no layout box');

  const startX = bounds.x + bounds.width * 0.25;
  const startY = bounds.y + bounds.height * 0.45;
  const endX = bounds.x + bounds.width * 0.75;
  const endY = bounds.y + bounds.height * 0.55;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.5, startY + 10, {
    steps: 4,
  });
  return { endX, endY };
}

test('freehand stays opt-in and a real pointer drag creates a stroke when enabled', async ({
  page,
}) => {
  await page.goto(fixturePath);
  const state = page.getByTestId('fixture-state');
  await expect(state).toContainText('"modeProp":"omitted"');

  const image = await previewImage(page);
  await dragAcrossImage(page, image);
  await expect(page.getByTestId('geometry-drafts')).toContainText(
    '"type":"point"',
  );
  await expect(page.getByTestId('freehand-drafts')).toHaveText('[]');

  await act(page, 'mode', true);
  await expect(state).toContainText('"modeProp":true');
  await dragAcrossImage(page, image);

  const freehandOutput = page.getByTestId('freehand-drafts');
  await expect(freehandOutput).toContainText('"type":"freehand"');
  const drafts = JSON.parse((await freehandOutput.textContent()) ?? '[]') as {
    geometry: { points: { x: number; y: number }[] };
  }[];
  expect(drafts).toHaveLength(1);
  expect(drafts[0]?.geometry.points.length).toBeGreaterThanOrEqual(2);
});

test('an active pointer draft is discarded when its scope changes', async ({
  page,
}) => {
  await page.goto(fixturePath);
  await act(page, 'mode', true);
  await expect(page.getByTestId('fixture-state')).toContainText(
    '"modeProp":true',
  );

  const image = await previewImage(page);
  const { endX, endY } = await dragWhileHeld(page, image);
  await expect(page.getByTestId('annotation-freehand-preview')).toBeVisible();

  await act(page, 'scope', 'fixture/scope-b');
  await expect(page.getByTestId('fixture-state')).toContainText(
    'fixture/scope-b',
  );
  await page.mouse.move(endX, endY, { steps: 3 });
  await page.mouse.up();

  await expect(page.getByTestId('freehand-drafts')).toHaveText('[]');
  await expect(page.getByTestId('annotation-freehand-preview')).toHaveCount(0);
});

test('disabling drawing cancels an active draft and blocks new strokes', async ({
  page,
}) => {
  await page.goto(fixturePath);
  await act(page, 'mode', true);

  const image = await previewImage(page);
  const { endX, endY } = await dragWhileHeld(page, image);
  await expect(page.getByTestId('annotation-freehand-preview')).toBeVisible();

  await act(page, 'draw', false);
  await expect(page.getByTestId('fixture-state')).toContainText(
    '"canDraw":false',
  );
  const readOnlyCanvas = page.locator(
    '[data-testid="annotation-canvas"] [role="img"]',
  );
  await expect(readOnlyCanvas).toHaveAttribute('tabindex', '-1');
  await page.mouse.move(endX, endY, { steps: 3 });
  await page.mouse.up();

  await expect(page.getByTestId('freehand-drafts')).toHaveText('[]');
  await expect(page.getByTestId('annotation-freehand-preview')).toHaveCount(0);
  await dragAcrossImage(page, image);
  await expect(page.getByTestId('freehand-drafts')).toHaveText('[]');
});

test('keyboard Enter and arrows create a stroke; Escape cancels the next draft', async ({
  page,
}) => {
  await page.goto(fixturePath);
  await act(page, 'mode', true);

  const canvas = page.locator(
    '[data-testid="annotation-canvas"] [role="application"]',
  );
  await expect(canvas).toBeVisible();
  await canvas.focus();

  await page.keyboard.press('Enter');
  await expect(page.getByText(/已開始自由筆畫/)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Enter');

  const freehandOutput = page.getByTestId('freehand-drafts');
  await expect(freehandOutput).toContainText('"type":"freehand"');
  const finished = JSON.parse((await freehandOutput.textContent()) ?? '[]') as {
    geometry: { points: { x: number; y: number }[] };
  }[];
  expect(finished).toHaveLength(1);
  expect(finished[0]?.geometry.points.length).toBeGreaterThanOrEqual(2);
  const completedDrafts = await freehandOutput.textContent();

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Escape');
  await expect(page.getByText('自由筆畫已取消。')).toBeVisible();
  await expect(freehandOutput).toHaveText(completedDrafts ?? '[]');
  await expect(page.getByTestId('annotation-freehand-preview')).toHaveCount(0);
});
