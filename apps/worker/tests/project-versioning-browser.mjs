import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

const capabilitiesPath = '/api/v1/versioning/capabilities';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

async function addOwnerCookie(context, base, ownerCookie) {
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: ownerCookieHeader(ownerCookie).slice(
        'kino-owner.session_token='.length,
      ),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(base).protocol === 'https:',
    },
  ]);
}

async function ownerRequest(
  worker,
  base,
  ownerCookie,
  owner,
  path,
  method,
  body,
) {
  const response = await worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers: {
        Accept: 'application/json',
        Cookie: ownerCookieHeader(ownerCookie),
        Origin: new URL(base).origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(method === 'PUT' ? { 'X-Kino-Expected-Actor': owner } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
  const value = await response.json().catch(() => null);
  return { response, value };
}

async function requestInit(incoming) {
  const method = incoming.method();
  const init = {
    method,
    headers: await incoming.allHeaders(),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD')
    init.body = incoming.postDataBuffer() ?? undefined;
  return init;
}

function makeObservations() {
  return {
    apiRequests: [],
    capabilityReads: [],
    projectReads: [],
    mutationAttempts: [],
    pageErrors: [],
    bridgeErrors: [],
    mainNavigations: 0,
  };
}

async function bridgePage({
  page,
  worker,
  base,
  projectPath,
  observations,
  capabilityDisabled = false,
}) {
  let sequence = 0;
  let dropNextSuccessfulMutationResponse = false;

  page.on('pageerror', (error) => observations.pageErrors.push(error.message));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) observations.mainNavigations += 1;
  });
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    if (url.origin !== new URL(base).origin) {
      await route.continue();
      return;
    }

    const method = incoming.method();
    const record = {
      sequence: ++sequence,
      method,
      pathname: url.pathname,
      search: url.search,
      status: 0,
      requestBody: incoming.postData() ?? '',
      expectedActor: '',
      responseBody: null,
      dropped: false,
      mocked: false,
    };

    if (
      capabilityDisabled &&
      method === 'GET' &&
      url.pathname === capabilitiesPath
    ) {
      record.status = 200;
      record.responseBody = { enabled: false };
      record.mocked = true;
      observations.capabilityReads.push(record);
      observations.apiRequests.push(record);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'private, no-store' },
        body: JSON.stringify(record.responseBody),
      });
      return;
    }

    if (method === 'PUT' && url.pathname === projectPath) {
      const headers = await incoming.allHeaders();
      record.expectedActor = headers['x-kino-expected-actor'] ?? '';
      observations.mutationAttempts.push(record);
    }

    let response;
    try {
      response = await worker.fetch(
        new Request(incoming.url(), await requestInit(incoming)),
      );
    } catch (error) {
      observations.bridgeErrors.push(
        error instanceof Error ? error.message : String(error),
      );
      await route.abort('failed');
      return;
    }

    const responseBytes = Buffer.from(await response.arrayBuffer());
    record.status = response.status;
    record.responseBody = parseJson(responseBytes);
    observations.apiRequests.push(record);

    if (method === 'GET' && url.pathname === capabilitiesPath)
      observations.capabilityReads.push(record);
    if (method === 'GET' && url.pathname === projectPath)
      observations.projectReads.push(record);

    if (
      method === 'PUT' &&
      url.pathname === projectPath &&
      dropNextSuccessfulMutationResponse &&
      response.ok
    ) {
      dropNextSuccessfulMutationResponse = false;
      record.dropped = true;
      await route.abort('failed');
      return;
    }

    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBytes,
    });
  });

  return {
    observations,
    dropNextSuccessfulMutationResponse() {
      dropNextSuccessfulMutationResponse = true;
    },
  };
}

async function assertNarrowViewport(page) {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(
    width.scroll <= width.client,
    'The 375px project versioning UI overflows: scrollWidth=' +
      width.scroll +
      ', clientWidth=' +
      width.client,
  );
}

export async function runProjectVersioningBrowserChecks({
  worker,
  base,
  ownerCookie,
  owner,
  db,
  projectId,
  projectName,
}) {
  const projectPath =
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/versioning';
  const browser = await chromium.launch({ headless: true });

  try {
    const disabledContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(disabledContext, base, ownerCookie);
    const disabledPage = await disabledContext.newPage();
    const disabledObservations = makeObservations();
    await bridgePage({
      page: disabledPage,
      worker,
      base,
      projectPath,
      observations: disabledObservations,
      capabilityDisabled: true,
    });
    await disabledPage.goto(
      base + '/dashboard/projects/' + encodeURIComponent(projectId),
      { waitUntil: 'networkidle' },
    );
    await disabledPage
      .locator('details.studio-project-settings > summary')
      .click();
    const disabledPanel = disabledPage.locator(
      '[data-project-versioning-configuration]',
    );
    await expect(disabledPanel).toBeVisible();
    await expect(disabledPanel.getByRole('status')).toContainText(
      '目前尚未開放',
    );
    await expect(disabledPanel.locator('select,button')).toHaveCount(0);
    assert.equal(
      disabledObservations.capabilityReads.length,
      1,
      'The OFF capability must be checked before rendering any settings',
    );
    assert.equal(disabledObservations.capabilityReads[0].mocked, true);
    assert.equal(
      disabledObservations.projectReads.length,
      0,
      'The OFF capability must not fetch private project version settings',
    );
    assert.equal(disabledObservations.mutationAttempts.length, 0);
    await assertNarrowViewport(disabledPage);
    await disabledContext.close();

    const initialRead = await ownerRequest(
      worker,
      base,
      ownerCookie,
      owner,
      projectPath,
      'GET',
    );
    assert.equal(
      initialRead.response.status,
      200,
      JSON.stringify(initialRead.value),
    );
    assert.equal(initialRead.value.projectId, projectId);
    assert.equal(initialRead.value.mode, 'manual');

    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(context, base, ownerCookie);
    const page = await context.newPage();
    const observations = makeObservations();
    const bridge = await bridgePage({
      page,
      worker,
      base,
      projectPath,
      observations,
    });

    try {
      await page.goto(
        base + '/dashboard/projects/' + encodeURIComponent(projectId),
        { waitUntil: 'networkidle' },
      );
      await expect(
        page.getByRole('heading', { name: projectName }),
      ).toBeVisible();
      const projectSettings = page.locator('details.studio-project-settings');
      await projectSettings.locator('summary').click();
      const panel = page.locator('[data-project-versioning-configuration]');
      await expect(panel).toBeVisible();
      await expect(panel.getByLabel('版本控制模式')).toBeVisible();
      await expect(panel).toContainText('目前模式：手動');

      const modeSelect = panel.getByLabel('版本控制模式');
      const availableOptions = await modeSelect
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.value));
      assert.deepEqual(availableOptions, ['', 'off', 'manual']);
      await assertNarrowViewport(page);

      await modeSelect.selectOption('off');
      await panel.getByRole('button', { name: '確認變更模式' }).click();
      const cancelledConfirmation = panel.getByTestId(
        'project-versioning-configuration-confirm',
      );
      await expect(cancelledConfirmation).toBeVisible();
      await cancelledConfirmation.getByRole('button', { name: '取消' }).click();
      await expect(cancelledConfirmation).toHaveCount(0);
      assert.equal(
        observations.mutationAttempts.length,
        0,
        'Cancelling the confirmation must not send a mode change',
      );

      const staleConfirmationOpen = panel.getByRole('button', {
        name: '確認變更模式',
      });
      await staleConfirmationOpen.click();
      const staleConfirmation = panel.getByTestId(
        'project-versioning-configuration-confirm',
      );
      await expect(staleConfirmation).toBeVisible();

      const competingWrite = await ownerRequest(
        worker,
        base,
        ownerCookie,
        owner,
        projectPath,
        'PUT',
        {
          requestId: randomUUID(),
          expectedRevision: initialRead.value.revision,
          mode: 'off',
          confirm: true,
        },
      );
      assert.equal(
        competingWrite.response.status,
        200,
        JSON.stringify(competingWrite.value),
      );
      assert.equal(competingWrite.value.mode, 'off');

      await staleConfirmation
        .getByRole('button', { name: '確認並套用' })
        .click();
      await expect
        .poll(() => observations.mutationAttempts[0]?.status)
        .toBe(409);
      await expect(
        panel.getByTestId('project-versioning-configuration-pending'),
      ).toHaveCount(0);
      await expect(panel).toContainText('目前模式：關閉');

      const staleAttempt = observations.mutationAttempts[0];
      assert.equal(staleAttempt.expectedActor, owner);
      const staleBody = JSON.parse(staleAttempt.requestBody);
      assert.equal(staleBody.expectedRevision, initialRead.value.revision);
      assert.equal(staleBody.mode, 'off');
      assert.equal(staleBody.confirm, true);
      const staleCommand = await db
        .prepare(
          'SELECT count(*) AS n FROM project_versioning_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(owner, staleBody.requestId)
        .first();
      const staleAudit = await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE project_id=? AND action='project.versioning_mode_changed' AND request_id=?",
        )
        .bind(projectId, staleBody.requestId)
        .first();
      assert.equal(
        staleCommand?.n,
        0,
        'A stale rejected intent must not be recorded',
      );
      assert.equal(
        staleAudit?.n,
        0,
        'A stale rejected intent must not append audit',
      );
      await assertNarrowViewport(page);

      const currentAfterStale = await ownerRequest(
        worker,
        base,
        ownerCookie,
        owner,
        projectPath,
        'GET',
      );
      assert.equal(currentAfterStale.response.status, 200);
      assert.equal(currentAfterStale.value.mode, 'off');

      await modeSelect.selectOption('manual');
      await panel.getByRole('button', { name: '確認變更模式' }).click();
      const lostConfirmation = panel.getByTestId(
        'project-versioning-configuration-confirm',
      );
      await expect(lostConfirmation).toBeVisible();
      bridge.dropNextSuccessfulMutationResponse();
      await lostConfirmation
        .getByRole('button', { name: '確認並套用' })
        .click();
      const pending = panel.getByTestId(
        'project-versioning-configuration-pending',
      );
      await expect(pending).toBeVisible();
      await expect
        .poll(() => observations.mutationAttempts[1]?.dropped)
        .toBe(true);
      const firstLostAttempt = observations.mutationAttempts[1];
      const frozenBody = firstLostAttempt.requestBody;
      const frozenIntent = JSON.parse(frozenBody);
      assert.equal(firstLostAttempt.status, 200);
      assert.equal(firstLostAttempt.expectedActor, owner);
      assert.equal(
        frozenIntent.expectedRevision,
        currentAfterStale.value.revision,
      );
      assert.equal(frozenIntent.mode, 'manual');
      assert.equal(frozenIntent.confirm, true);
      assert.match(
        frozenIntent.requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      assert.equal(firstLostAttempt.responseBody?.changed, true);
      assert.equal(firstLostAttempt.responseBody?.mode, 'manual');

      const laterWrite = await ownerRequest(
        worker,
        base,
        ownerCookie,
        owner,
        projectPath,
        'PUT',
        {
          requestId: randomUUID(),
          expectedRevision: firstLostAttempt.responseBody.revision,
          mode: 'off',
          confirm: true,
        },
      );
      assert.equal(
        laterWrite.response.status,
        200,
        JSON.stringify(laterWrite.value),
      );
      assert.equal(laterWrite.value.mode, 'off');

      const navigationCountBeforeRetry = observations.mainNavigations;
      await panel.getByTestId('project-versioning-configuration-retry').click();
      await expect
        .poll(() => observations.mutationAttempts[2]?.status)
        .toBe(200);
      const replay = observations.mutationAttempts[2];
      assert.equal(replay.requestBody, frozenBody);
      assert.equal(replay.expectedActor, owner);
      assert.equal(replay.responseBody?.mode, 'manual');
      assert.equal(
        replay.responseBody?.eventId,
        firstLostAttempt.responseBody.eventId,
      );

      await expect
        .poll(() => observations.mainNavigations)
        .toBeGreaterThan(navigationCountBeforeRetry);
      const postReplayRead = observations.projectReads.find(
        (record) => record.sequence > replay.sequence,
      );
      assert.ok(
        postReplayRead,
        'The exact retry must be followed by a fresh GET',
      );
      assert.equal(postReplayRead.responseBody?.mode, 'off');
      await projectSettings.locator('summary').click();
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('目前模式：關閉');
      await expect(
        panel.getByTestId('project-versioning-configuration-pending'),
      ).toHaveCount(0);
      await assertNarrowViewport(page);
      assert.deepEqual(observations.bridgeErrors, []);
      assert.deepEqual(observations.pageErrors, []);
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
