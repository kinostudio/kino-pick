import { expect, test, type Locator, type Page } from '@playwright/test';
const fixturePath = '/owner-annotation-editor-freehand-test.html';
async function capability(
  page: Page,
  writeEnabled: boolean,
  freehandReadCapability = writeEnabled,
) {
  await page.evaluate(
    async (state) => {
      localStorage.setItem(
        'owner-editor-freehand-test:write-capability',
        state.writeEnabled ? '1' : '0',
      );
      localStorage.setItem(
        'owner-editor-freehand-test:write-capability-error',
        '0',
      );
      window.dispatchEvent(
        new CustomEvent('owner-editor-freehand-read-capability', {
          detail: { freehandReadCapability: state.freehandReadCapability },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    },
    { writeEnabled, freehandReadCapability },
  );
  if (writeEnabled)
    await expect(
      page.getByTestId('owner-annotation-tool-freehand'),
    ).toBeVisible();
  else
    await expect(
      page.getByTestId('owner-annotation-tool-freehand'),
    ).toHaveCount(0);
}
async function prepare(page: Page, writeCapabilityUnavailable = false) {
  await page.addInitScript((unavailable: boolean) => {
    localStorage.setItem(
      'owner-editor-freehand-test:write-capability-error',
      unavailable ? '1' : '0',
    );
    localStorage.removeItem('owner-editor-freehand-test:result');
    localStorage.removeItem('owner-editor-freehand-test:requests');
    localStorage.removeItem('owner-editor-freehand-test:reads');
    localStorage.removeItem('owner-editor-freehand-test:require-read');
    localStorage.removeItem('owner-editor-freehand-test:write-disabled');
    localStorage.removeItem('owner-editor-freehand-test:write-capability');
    localStorage.removeItem(
      'owner-editor-freehand-test:write-capability-checks',
    );
    sessionStorage.clear();
  }, writeCapabilityUnavailable);
  await page.route('**/assets/preview', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e7e5e4"/><path d="M20 270L380 30" stroke="#78716c" stroke-width="8"/></svg>',
    }),
  );
  await page.goto(fixturePath);
  await expect(page.getByTestId('owner-annotation-editor')).toBeVisible();
  await expect(page.getByTestId('owner-annotation-tool-point')).toBeEnabled();
}
async function image(page: Page): Promise<Locator> {
  const target = page.getByTestId('annotation-preview-image');
  await expect(page.getByTestId('annotation-zoom')).toBeEnabled();
  await expect(target).toBeVisible();
  return target;
}
async function drag(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Owner preview image has no layout box');
  const y = box.y + box.height * 0.45;
  await page.mouse.move(box.x + box.width * 0.25, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y + 12, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.75, y + 28, { steps: 4 });
  await page.mouse.up();
}
async function dragHeld(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Owner preview image has no layout box');
  const x = box.x + box.width * 0.25,
    y = box.y + box.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, y + 10, { steps: 4 });
  return { endX: box.x + box.width * 0.75, endY: box.y + box.height * 0.55 };
}
test('Owner freehand is default off and retry reuses the exact journal command', async ({
  page,
}) => {
  await prepare(page);
  await expect(page.getByTestId('owner-annotation-tool-freehand')).toHaveCount(
    0,
  );
  const initialCapabilityChecks = await page.evaluate(() =>
    Number(
      localStorage.getItem(
        'owner-editor-freehand-test:write-capability-checks',
      ) ?? '0',
    ),
  );
  const initialReads = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:reads') ?? '[]',
      ) as { capability: string | null; annotationId: string | null }[],
  );
  expect(initialReads[0]?.capability).toBe('freehand-v1');
  await capability(page, true);
  const refreshedCapabilityChecks = await page.evaluate(() =>
    Number(
      localStorage.getItem(
        'owner-editor-freehand-test:write-capability-checks',
      ) ?? '0',
    ),
  );
  expect(refreshedCapabilityChecks).toBeGreaterThan(initialCapabilityChecks);
  const brush = page.getByTestId('owner-annotation-tool-freehand');
  await expect(brush).toBeVisible();
  await brush.click();
  await drag(page, await image(page));
  await expect(page.getByTestId('owner-annotation-save')).toBeEnabled();
  await page.getByTestId('owner-annotation-save').click();
  await expect(
    page.getByText('目前無法確認標記操作結果；原操作已保留，可重試相同操作。'),
  ).toBeVisible();
  await expect(page.getByTestId('owner-annotation-retry')).toBeEnabled();
  const journal = await page.evaluate(() =>
    Object.values(sessionStorage).join('\n'),
  );
  expect(journal).toContain('"type":"freehand"');
  expect(journal).not.toContain('previewUrl');
  expect(journal).not.toContain('data:image');
  expect(journal).not.toContain('cookie');
  expect(journal).not.toContain('sessionId');
  await page.getByTestId('owner-annotation-retry').click();
  await expect(page.getByText('標記已由目前 Owner 清單確認。')).toBeVisible();
  const requests = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:requests') ?? '[]',
      ) as Record<string, unknown>[],
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ operation: 'create' });
  expect(requests[0]?.geometry).toMatchObject({ type: 'freehand' });
  const reads = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:reads') ?? '[]',
      ) as { capability: string | null; annotationId: string | null }[],
  );
  expect(reads.some((read) => read.capability === 'freehand-v1')).toBe(true);
});

test('Owner hides freehand when the trusted write capability is unavailable and refreshes it on focus', async ({
  page,
}) => {
  await prepare(page, true);
  const brush = page.getByTestId('owner-annotation-tool-freehand');
  await expect(brush).toHaveCount(0);
  const checksBefore = await page.evaluate(() =>
    Number(
      localStorage.getItem(
        'owner-editor-freehand-test:write-capability-checks',
      ) ?? '0',
    ),
  );
  expect(checksBefore).toBeGreaterThan(0);
  const reads = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:reads') ?? '[]',
      ) as { capability: string | null; annotationId: string | null }[],
  );
  expect(reads[0]?.capability).toBe('freehand-v1');

  await capability(page, true);
  const checksAfter = await page.evaluate(() =>
    Number(
      localStorage.getItem(
        'owner-editor-freehand-test:write-capability-checks',
      ) ?? '0',
    ),
  );
  expect(checksAfter).toBeGreaterThan(checksBefore);
  await expect(brush).toBeVisible();
});

test('Owner preserves the exact journal through a disabled-write 409 and read 426 on focus', async ({
  page,
}) => {
  await prepare(page);
  const initialReads = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:reads') ?? '[]',
      ) as { capability: string | null; annotationId: string | null }[],
  );
  expect(initialReads[0]?.capability).toBe('freehand-v1');

  // The writer switch can be on while this client has not opted into read support.
  await capability(page, true, false);
  await page.evaluate(() =>
    localStorage.setItem('owner-editor-freehand-test:write-disabled', '1'),
  );
  await page.getByTestId('owner-annotation-tool-freehand').click();
  await drag(page, await image(page));
  await page.getByTestId('owner-annotation-save').click();
  await expect(
    page.getByText(
      '新版筆劃目前尚未開放儲存。原操作已保留；功能重新開啟後可重試同一筆操作。',
    ),
  ).toBeVisible();

  const firstCommand = await page.evaluate(
    () =>
      (
        JSON.parse(
          localStorage.getItem('owner-editor-freehand-test:requests') ?? '[]',
        ) as Record<string, unknown>[]
      )[0],
  );
  expect(firstCommand).toMatchObject({ operation: 'create' });
  const requestId = String(firstCommand?.requestId ?? '');
  expect(requestId).not.toBe('');
  const journalAfterGate409 = await page.evaluate(() =>
    Object.values(sessionStorage).join('\n'),
  );
  expect(journalAfterGate409).toContain(requestId);
  expect(journalAfterGate409).toContain('"type":"freehand"');

  await page.evaluate(() => {
    localStorage.removeItem('owner-editor-freehand-test:write-disabled');
    localStorage.setItem('owner-editor-freehand-test:require-read', '1');
  });
  await page.getByTestId('owner-annotation-retry').click();
  const upgradeMessage =
    '此註記範圍包含新版筆劃，請載入支援新版註記的畫面後再繼續；尚未確認的操作記錄已保留。';
  await expect(page.getByText(upgradeMessage)).toBeVisible();
  const journalAfterRead426 = await page.evaluate(() =>
    Object.values(sessionStorage).join('\n'),
  );
  expect(journalAfterRead426).toContain(requestId);
  expect(journalAfterRead426).toContain('"type":"freehand"');

  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(page.getByText(upgradeMessage)).toBeVisible();
  const journalAfterFocus426 = await page.evaluate(() =>
    Object.values(sessionStorage).join('\n'),
  );
  expect(journalAfterFocus426).toContain(requestId);
  expect(journalAfterFocus426).toContain('"type":"freehand"');

  await capability(page, false, true);
  await expect(page.getByTestId('owner-annotation-editor')).toBeVisible();
  await page.getByTestId('owner-annotation-retry').click();
  await expect(page.getByText('標記已由目前 Owner 清單確認。')).toBeVisible();
  const requests = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:requests') ?? '[]',
      ) as Record<string, unknown>[],
  );
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  const reads = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:reads') ?? '[]',
      ) as { capability: string | null; annotationId: string | null }[],
  );
  expect(reads.some((read) => read.capability === 'freehand-v1')).toBe(true);
});
test('revoking Owner freehand cancels a live pointer stroke', async ({
  page,
}) => {
  await prepare(page);
  await capability(page, true);
  const brush = page.getByTestId('owner-annotation-tool-freehand');
  await expect(brush).toBeVisible();
  await brush.click();
  const target = await image(page),
    { endX, endY } = await dragHeld(page, target);
  await expect(page.getByTestId('annotation-freehand-preview')).toBeVisible();
  await capability(page, false);
  await expect(brush).toHaveCount(0);
  await page.mouse.move(endX, endY, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('owner-annotation-save')).toHaveCount(0);
  await expect(page.getByTestId('annotation-freehand-preview')).toHaveCount(0);
  await capability(page, true);
  await expect(brush).toBeVisible();
  await brush.click();
  await drag(page, await image(page));
  await expect(page.getByTestId('owner-annotation-save')).toBeEnabled();
  await capability(page, false);
  await expect(brush).toHaveCount(0);
  await expect(page.getByTestId('owner-annotation-save')).toHaveCount(0);
  await capability(page, true);
  await expect(brush).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('owner-annotation-save')).toHaveCount(0);
  const requests = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem('owner-editor-freehand-test:requests') ?? '[]',
      ) as unknown[],
  );
  expect(requests).toEqual([]);
});

test('Owner processing targeted 426 clears stale parent rows and shows the upgrade hint', async ({
  page,
}) => {
  await page.addInitScript(() => {
    sessionStorage.clear();
    localStorage.removeItem('owner-processing-freehand-test:targeted-read');
    localStorage.removeItem('owner-processing-freehand-test:read-capability');
  });
  await page.goto('/owner-annotation-processing-freehand-test.html');
  const annotationId = '66666666-6666-4666-8666-666666666666';
  const upgradeMessage =
    '此註記範圍包含新版筆劃，請載入支援新版註記的畫面後再繼續；尚未確認的操作記錄已保留。';

  const panel = page.getByTestId('annotation-processing-panel');
  await expect(panel).toBeVisible();
  await expect(
    page.getByTestId('annotation-processing-state-in_progress-' + annotationId),
  ).toBeEnabled();
  await page
    .getByTestId('annotation-processing-state-in_progress-' + annotationId)
    .click();

  await expect(page.getByTestId('owner-old-row')).toHaveCount(0);
  await expect(page.getByTestId('annotation-processing-panel')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText(upgradeMessage);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('owner-processing-freehand-test:targeted-read'),
      ),
    )
    .toBe(annotationId);
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('owner-processing-freehand-test:read-capability'),
      ),
    )
    .toBe('freehand-v1');
});
