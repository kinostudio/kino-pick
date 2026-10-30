import { expect, test, type Page } from '@playwright/test';
import type { AnnotationGeometry } from '../../packages/contracts/src/annotation-geometry';
import type {
  GuestAnnotationCommand,
  GuestAnnotationItem,
} from '../../packages/contracts/src/guest-annotations';
import type { GuestSharedAnnotationItem } from '../../packages/contracts/src/annotation-threads';

const fixturePath = '/guest-annotation-freehand-test.html';
const albumId = '11111111-1111-4111-8111-111111111111';
const guestId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const annotationId = '55555555-5555-4555-8555-555555555555';
const pendingRequestId = '77777777-7777-4777-8777-777777777777';
const timestamp = '2026-10-29T00:00:00.000Z';
const journalKey = 'kino-pic:guest-annotations:v1:' + guestId + ':' + albumId;

const pointGeometry: AnnotationGeometry = {
  type: 'point',
  coordinateSpace: 'normalized_1e6',
  x: 250_000,
  y: 350_000,
};
const freehandGeometry: AnnotationGeometry = {
  type: 'freehand',
  coordinateSpace: 'normalized_1e6',
  version: 1,
  points: [
    { x: 100_000, y: 200_000 },
    { x: 400_000, y: 800_000 },
  ],
};

function makeOwnItem(
  geometry: AnnotationGeometry,
  id = annotationId,
  color: 'amber' | 'red' | 'blue' = 'blue',
): GuestAnnotationItem {
  return {
    annotationId: id,
    photoId,
    versionId,
    revision: 1,
    geometry,
    style: { color },
    commentId: null,
    state: 'open',
    authorLabel: 'Guest One',
    isMine: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function makeSharedItem(
  geometry: AnnotationGeometry,
  id = annotationId,
  color: 'amber' | 'red' | 'blue' = 'blue',
): GuestSharedAnnotationItem {
  return {
    ...makeOwnItem(geometry, id, color),
    authorType: 'guest',
    processing: null,
  };
}

type MockOptions = {
  freehandItem?: boolean;
  requireFreehandRead?: boolean;
  upgradeAfterFirstPage?: boolean;
  upgradeOwnTarget?: boolean;
  writeMode?: 'unavailable' | 'disabled-until-enabled' | 'success';
  writeCapabilityEnabled?: boolean;
  writeCapabilityFailure?: 'unavailable' | 'malformed';
};

type GuestApiMock = {
  requestBodies: string[];
  readCapabilityHeaders: string[];
  writeCapabilityReads: () => number;
  setFreehandWriteCapability: (enabled: boolean) => void;
  enableFreehandWrites: () => void;
};

async function mockGuestApi(
  page: Page,
  options: MockOptions = {},
): Promise<GuestApiMock> {
  const requestBodies: string[] = [];
  const readCapabilityHeaders: string[] = [];
  let writeGateEnabled = options.writeMode !== 'disabled-until-enabled';
  let writeCapabilityEnabled = options.writeCapabilityEnabled ?? true;
  let writeCapabilityReadCount = 0;
  let createdOwnItem: GuestAnnotationItem | null = null;
  let createdSharedItem: GuestSharedAnnotationItem | null = null;

  await page.route('**/api/guest/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    const upgradeRequired = () =>
      route.fulfill({
        status: 426,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'ANNOTATION_CLIENT_UPGRADE_REQUIRED' },
        }),
      });

    if (
      request.method() === 'GET' &&
      pathname === '/api/guest/annotations/freehand-capabilities'
    ) {
      writeCapabilityReadCount += 1;
      if (options.writeCapabilityFailure === 'unavailable') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }),
        });
        return;
      }
      if (options.writeCapabilityFailure === 'malformed') {
        await json({ enabled: 'true' });
        return;
      }
      await json({ enabled: writeCapabilityEnabled });
      return;
    }

    if (
      request.method() === 'GET' &&
      pathname === '/api/guest/annotations/capabilities'
    ) {
      await json({ enabled: true });
      return;
    }

    if (request.method() === 'GET' && pathname.endsWith('/access')) {
      await json({
        access: {
          guestId,
          inviteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          workspaceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
          projectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          albumId,
          permissions: {
            can_view: true,
            can_download_preview: true,
            can_download_original: false,
            can_select: false,
            can_rate: false,
            can_favorite: false,
            can_tag: false,
            can_annotate: true,
            can_comment: false,
            can_submit: false,
            can_view_own_history: false,
            can_compare_versions: true,
          },
          expiresAt: '2027-01-01T00:00:00.000Z',
        },
      });
      return;
    }

    if (request.method() === 'GET' && pathname.endsWith('/annotations/own')) {
      const readCapability =
        request.headers()['x-kino-annotation-read-capabilities'] ?? '';
      readCapabilityHeaders.push(readCapability);
      if (
        (options.requireFreehandRead && readCapability !== 'freehand-v1') ||
        (options.upgradeOwnTarget && url.searchParams.has('annotationId'))
      ) {
        await upgradeRequired();
        return;
      }
      await json({
        guestId,
        photoId,
        versionId,
        items: createdOwnItem ? [createdOwnItem] : [],
        nextCursor: null,
      });
      return;
    }

    if (
      request.method() === 'GET' &&
      pathname.endsWith('/annotations/shared')
    ) {
      const readCapability =
        request.headers()['x-kino-annotation-read-capabilities'] ?? '';
      readCapabilityHeaders.push(readCapability);
      if (
        (options.requireFreehandRead && readCapability !== 'freehand-v1') ||
        (options.upgradeAfterFirstPage && url.searchParams.has('cursor'))
      ) {
        await upgradeRequired();
        return;
      }
      const items = createdSharedItem
        ? [createdSharedItem]
        : options.freehandItem
          ? [makeSharedItem(freehandGeometry)]
          : options.upgradeAfterFirstPage
            ? [makeSharedItem(pointGeometry)]
            : [];
      await json({
        guestId,
        photoId,
        versionId,
        items,
        nextCursor:
          options.upgradeAfterFirstPage && !url.searchParams.has('cursor')
            ? 'cursor-2'
            : null,
      });
      return;
    }

    if (request.method() === 'GET' && pathname.endsWith('/assets/preview')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body:
          '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
          '<rect width="800" height="600" fill="#e7e5e4"/>' +
          '<path d="M30 560L770 40" stroke="#78716c" stroke-width="8"/>' +
          '</svg>',
      });
      return;
    }

    if (
      request.method() === 'POST' &&
      pathname.endsWith('/annotations/commands')
    ) {
      const body = request.postData() ?? '';
      requestBodies.push(body);
      if (options.writeMode === 'disabled-until-enabled' && !writeGateEnabled) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'FREEHAND_ANNOTATIONS_DISABLED' },
          }),
        });
        return;
      }
      if (
        options.writeMode !== 'success' &&
        options.writeMode !== 'disabled-until-enabled'
      ) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'FREEHAND_DISABLED' } }),
        });
        return;
      }
      const command = JSON.parse(body) as GuestAnnotationCommand;
      if (command.operation !== 'create') {
        throw new Error('The Guest freehand fixture only expects create');
      }
      const item = makeOwnItem(
        command.geometry,
        annotationId,
        command.style.color,
      );
      createdOwnItem = item;
      createdSharedItem = {
        ...item,
        authorType: 'guest',
        processing: null,
      };
      await json({
        requestId: command.requestId,
        operation: 'create',
        item,
        occurredAt: timestamp,
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'NOT_FOUND' } }),
    });
  });
  return {
    requestBodies,
    readCapabilityHeaders,
    writeCapabilityReads: () => writeCapabilityReadCount,
    setFreehandWriteCapability: (enabled) => {
      writeCapabilityEnabled = enabled;
    },
    enableFreehandWrites: () => {
      writeGateEnabled = true;
      writeCapabilityEnabled = true;
    },
  };
}

async function drawFreehand(page: Page) {
  const image = page.getByTestId('annotation-preview-image');
  await expect(image).toBeVisible();
  await expect(page.getByTestId('annotation-zoom')).toBeEnabled();
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error('The Guest preview has no layout box');

  const startX = bounds.x + bounds.width * 0.2;
  const startY = bounds.y + bounds.height * 0.35;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.48, startY + 16, {
    steps: 4,
  });
  await page.mouse.move(bounds.x + bounds.width * 0.78, startY + 34, {
    steps: 4,
  });
  await page.mouse.up();
}

test('default Guest editor keeps the brush hidden and sends no read capability', async ({
  page,
}) => {
  const api = await mockGuestApi(page);
  await page.goto(fixturePath);
  await expect(page.getByTestId('annotation-tool-point')).toBeVisible();
  await expect(page.getByTestId('annotation-tool-freehand')).toHaveCount(0);
  await expect.poll(() => api.readCapabilityHeaders.length).toBeGreaterThan(0);
  expect(api.readCapabilityHeaders.every((header) => header === '')).toBe(true);
});

test('read-only opt-in parses and displays freehand without enabling the brush', async ({
  page,
}) => {
  const api = await mockGuestApi(page, {
    freehandItem: true,
    requireFreehandRead: true,
    writeCapabilityEnabled: false,
  });
  await page.goto(fixturePath + '?read-capability=true');
  await expect(
    page.getByTestId('annotation-item-' + annotationId),
  ).toContainText('自由筆畫');
  await expect(page.getByTestId('annotation-tool-freehand')).toHaveCount(0);
  expect(
    api.readCapabilityHeaders.length > 0 &&
      api.readCapabilityHeaders.every((header) => header === 'freehand-v1'),
  ).toBe(true);
});

test('a legacy Guest page reports 426, hides all rows, and preserves its journal', async ({
  page,
}) => {
  const api = await mockGuestApi(page, { requireFreehandRead: true });
  await page.goto(fixturePath + '?pending=true');
  await expect(page.getByTestId('guest-journal-seeded')).toHaveText('seeded');
  await expect(page.getByTestId('annotation-upgrade-required')).toContainText(
    '新版自由筆畫標註',
  );
  await expect(
    page.getByTestId('annotation-upgrade-journal-preserved'),
  ).toBeVisible();
  await expect(page.getByTestId('guest-pending-state')).toHaveText('pending');
  await expect(page.getByTestId('annotation-item-' + annotationId)).toHaveCount(
    0,
  );
  const stored = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    journalKey,
  );
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored ?? 'null') as {
    command: { requestId: string; geometry: AnnotationGeometry };
  };
  expect(parsed.command.requestId).toBe(pendingRequestId);
  expect(parsed.command.geometry).toEqual(freehandGeometry);
  expect(api.readCapabilityHeaders.length > 0).toBe(true);
  expect(api.readCapabilityHeaders.every((header) => header === '')).toBe(true);
});

test('an unavailable trusted write capability keeps reads enabled and the brush hidden', async ({
  page,
}) => {
  const api = await mockGuestApi(page, {
    freehandItem: true,
    requireFreehandRead: true,
    writeCapabilityFailure: 'unavailable',
  });
  await page.goto(fixturePath + '?read-capability=true');
  await expect(
    page.getByTestId('annotation-item-' + annotationId),
  ).toContainText('自由筆畫');
  await expect(page.getByTestId('annotation-tool-freehand')).toHaveCount(0);
  expect(api.writeCapabilityReads()).toBeGreaterThan(0);
  expect(
    api.readCapabilityHeaders.length > 0 &&
      api.readCapabilityHeaders.every((header) => header === 'freehand-v1'),
  ).toBe(true);
});

test('a 426 during pagination hides previously loaded partial rows and preserves the journal', async ({
  page,
}) => {
  await mockGuestApi(page, { upgradeAfterFirstPage: true });
  await page.goto(fixturePath + '?pending=true');
  await expect(
    page.getByTestId('annotation-item-' + annotationId),
  ).toBeVisible();
  await page.getByTestId('annotation-load-more').click();
  await expect(page.getByTestId('annotation-upgrade-required')).toBeVisible();
  await expect(page.getByTestId('annotation-item-' + annotationId)).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId('annotation-upgrade-journal-preserved'),
  ).toBeVisible();
  await expect(page.getByTestId('guest-pending-state')).toHaveText('pending');
  const stored = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    journalKey,
  );
  const parsed = JSON.parse(stored ?? 'null') as {
    command: { requestId: string; geometry: AnnotationGeometry };
  };
  expect(parsed.command.requestId).toBe(pendingRequestId);
  expect(parsed.command.geometry).toEqual(freehandGeometry);
});

test('a disabled write capability still allows exact pending-intent replay', async ({
  page,
}) => {
  const api = await mockGuestApi(page, {
    writeCapabilityEnabled: false,
    writeMode: 'success',
  });
  await page.goto(fixturePath + '?pending=true&read-capability=true');
  await page.getByTestId('annotation-retry').click();

  await expect.poll(() => api.requestBodies.length).toBe(1);
  const sent = JSON.parse(api.requestBodies[0]!) as GuestAnnotationCommand;
  expect(sent.requestId).toBe(pendingRequestId);
  expect(sent.expectedGuestId).toBe(guestId);
  expect(sent.operation).toBe('create');
  if (sent.operation !== 'create') {
    throw new Error('The seeded Guest journal should be a create command');
  }
  expect(sent.geometry).toEqual(freehandGeometry);
  await expect(page.getByTestId('annotation-retry')).toHaveCount(0);
  expect(
    api.readCapabilityHeaders.every((header) => header === 'freehand-v1'),
  ).toBe(true);
});

test('a targeted recovery 426 preserves the original command and hides stale rows', async ({
  page,
}) => {
  const api = await mockGuestApi(page, {
    upgradeOwnTarget: true,
    writeMode: 'success',
  });
  await page.goto(fixturePath + '?pending=true');
  await page.getByTestId('annotation-retry').click();
  await expect(page.getByTestId('annotation-upgrade-required')).toBeVisible();
  await expect(page.getByTestId('annotation-item-' + annotationId)).toHaveCount(
    0,
  );
  await expect(
    page.getByTestId('annotation-upgrade-journal-preserved'),
  ).toBeVisible();
  await expect(page.getByTestId('guest-pending-state')).toHaveText('pending');
  expect(api.requestBodies).toHaveLength(1);
  const sent = JSON.parse(api.requestBodies[0]!) as GuestAnnotationCommand;
  expect(sent.requestId).toBe(pendingRequestId);
  expect(sent.operation).toBe('create');
  if (sent.operation !== 'create') {
    throw new Error('The seeded Guest journal should be a create command');
  }
  expect(sent.geometry).toEqual(freehandGeometry);
  const stored = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    journalKey,
  );
  const parsed = JSON.parse(stored ?? 'null') as {
    command: GuestAnnotationCommand;
  };
  expect(parsed.command).toEqual(sent);
});

test('opt-in Guest drawing saves and retries the exact original command', async ({
  page,
}) => {
  const { requestBodies } = await mockGuestApi(page);
  await page.goto(fixturePath + '?read-capability=true');
  const freehandTool = page.getByTestId('annotation-tool-freehand');
  await expect(freehandTool).toBeVisible();
  await freehandTool.click();
  await drawFreehand(page);

  await expect(page.getByTestId('annotation-draft-mark')).toBeVisible();
  await expect(page.getByTestId('annotation-save')).toBeEnabled();
  await page.getByTestId('annotation-save').click();
  await expect.poll(() => requestBodies.length).toBe(1);
  await expect(page.getByTestId('annotation-retry')).toBeVisible();

  await page.getByTestId('annotation-retry').click();
  await expect.poll(() => requestBodies.length).toBe(2);
  expect(requestBodies[1]).toBe(requestBodies[0]);

  const command = JSON.parse(requestBodies[0] ?? 'null') as {
    requestId: string;
    expectedGuestId: string;
    operation: string;
    photoId: string;
    versionId: string;
    geometry: { type: string; points: { x: number; y: number }[] };
  };
  expect(command).toMatchObject({
    expectedGuestId: guestId,
    operation: 'create',
    photoId,
    versionId,
  });
  expect(command.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(command.geometry.type).toBe('freehand');
  expect(command.geometry.points.length).toBeGreaterThanOrEqual(2);
  expect(requestBodies[0]).not.toContain('data:image');
});

test('a disabled freehand write stays retryable and replays unchanged after the gate opens', async ({
  page,
}) => {
  const api = await mockGuestApi(page, {
    writeMode: 'disabled-until-enabled',
  });
  await page.goto(fixturePath + '?read-capability=true');
  await page.getByTestId('annotation-tool-freehand').click();
  await drawFreehand(page);
  await page.getByTestId('annotation-save').click();
  await expect.poll(() => api.requestBodies.length).toBe(1);
  await expect(page.locator('p[role="status"]')).toContainText(
    '自由筆畫標註目前暫停儲存',
  );
  const originalBody = api.requestBodies[0]!;
  await expect(page.getByTestId('annotation-retry')).toBeEnabled();

  api.enableFreehandWrites();
  await page.getByTestId('annotation-retry').click();
  await expect.poll(() => api.requestBodies.length).toBe(2);
  expect(api.requestBodies[1]).toBe(originalBody);
  await expect(
    page.getByText('標記操作已由目前授權清單確認完成。'),
  ).toBeVisible();
  await expect(
    page.getByTestId('annotation-item-' + annotationId),
  ).toContainText('自由筆畫');
  await expect(page.getByTestId('annotation-retry')).toHaveCount(0);
  expect(api.readCapabilityHeaders.length > 2).toBe(true);
  expect(
    api.readCapabilityHeaders.every((header) => header === 'freehand-v1'),
  ).toBe(true);
});

test('focus refresh revokes stale freehand controls while read support stays enabled', async ({
  page,
}) => {
  const api = await mockGuestApi(page, {
    freehandItem: true,
    requireFreehandRead: true,
  });
  await page.goto(fixturePath + '?read-capability=true');
  await expect(page.getByTestId('annotation-tool-freehand')).toBeVisible();
  await expect(
    page.getByTestId('annotation-item-' + annotationId),
  ).toContainText('自由筆畫');

  api.setFreehandWriteCapability(false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(page.getByTestId('annotation-tool-freehand')).toHaveCount(0);
  await expect(
    page.getByTestId('annotation-item-' + annotationId),
  ).toContainText('自由筆畫');
  expect(api.writeCapabilityReads()).toBeGreaterThan(1);
  expect(api.requestBodies).toHaveLength(0);
  expect(
    api.readCapabilityHeaders.every((header) => header === 'freehand-v1'),
  ).toBe(true);
});

test('the last write-capability check prevents a stale freehand draft from sending', async ({
  page,
}) => {
  const api = await mockGuestApi(page);
  await page.goto(fixturePath + '?read-capability=true');
  await page.getByTestId('annotation-tool-freehand').click();
  await drawFreehand(page);
  await expect(page.getByTestId('annotation-draft-mark')).toBeVisible();

  api.setFreehandWriteCapability(false);
  await page.getByTestId('annotation-save').click();

  await expect(page.getByTestId('annotation-tool-freehand')).toHaveCount(0);
  await expect(page.getByTestId('annotation-draft-mark')).toHaveCount(0);
  expect(api.requestBodies).toHaveLength(0);
  expect(api.writeCapabilityReads()).toBeGreaterThan(1);
  const stored = await page.evaluate(
    (key) => sessionStorage.getItem(key),
    journalKey,
  );
  expect(stored).toBeNull();
});
