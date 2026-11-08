import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

async function ownerRequest(
  worker,
  base,
  ownerCookie,
  path,
  method = 'GET',
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
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
  return { response, value: await response.json().catch(() => null) };
}

function assertStatus(result, expected, label) {
  const code = result.value?.error?.code;
  const safeCode =
    typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)
      ? code
      : 'UNKNOWN_ERROR';
  assert.equal(
    result.response.status,
    expected,
    `${label}: expected HTTP ${expected}, got HTTP ${result.response.status} (${safeCode})`,
  );
}

async function createArchivedAlbum({ worker, base, ownerCookie, workspaceId }) {
  const projectResult = await ownerRequest(
    worker,
    base,
    ownerCookie,
    '/api/v1/projects',
    'POST',
    {
      workspaceId,
      name: '閒置清理瀏覽器 ' + randomUUID(),
      requestId: randomUUID(),
    },
  );
  assertStatus(projectResult, 201, 'create retention test project');
  const project = projectResult.value.project;
  const albumResult = await ownerRequest(
    worker,
    base,
    ownerCookie,
    '/api/v1/projects/' + project.id + '/albums',
    'POST',
    { name: '清理設定測試', requestId: randomUUID() },
  );
  assertStatus(albumResult, 201, 'create retention test album');
  const album = albumResult.value.album;
  const archived = await ownerRequest(
    worker,
    base,
    ownerCookie,
    '/api/v1/albums/' + album.id + '/archive',
    'PATCH',
    {
      archived: true,
      expectedRevision: album.revision,
      requestId: randomUUID(),
    },
  );
  assertStatus(archived, 200, 'archive empty draft retention test album');
  assert.equal(archived.value.album.state, 'archived');
  return { project, album };
}

export async function runAlbumRetentionPolicyBrowserChecks({
  worker,
  base,
  ownerCookie,
  galleryFixture,
}) {
  const ownerResult = await ownerRequest(
    worker,
    base,
    ownerCookie,
    '/api/v1/me',
  );
  assertStatus(ownerResult, 200, 'read current Owner');
  const expectedOwnerId = ownerResult.value.actor.id;
  const { project, album } = await createArchivedAlbum({
    worker,
    base,
    ownerCookie,
    workspaceId: galleryFixture.context.workspace.id,
  });
  const policyPath = '/api/v1/albums/' + album.id + '/retention-policy';
  const capabilityPath = '/api/v1/album-retention-policy/capabilities';
  const requests = [];
  let dropNextPut = false;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
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
    const page = await context.newPage();
    const origin = new URL(base).origin;
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      if (new URL(incoming.url()).origin !== origin) {
        await route.abort('blockedbyclient');
        return;
      }
      const path = new URL(incoming.url()).pathname;
      const method = incoming.method();
      const body = incoming.postData() ?? '';
      const tracked =
        path === capabilityPath ||
        path === policyPath ||
        path.startsWith('/api/v1/albums/' + album.id + '/deletion');
      const record = { path, method, body, responseBody: null };
      if (tracked) requests.push(record);

      const init = {
        method,
        headers: await incoming.allHeaders(),
        redirect: 'manual',
      };
      if (method !== 'GET' && method !== 'HEAD')
        init.body = incoming.postDataBuffer() ?? undefined;
      const response = await worker.fetch(new Request(incoming.url(), init));
      const responseBytes = Buffer.from(await response.arrayBuffer());
      if (tracked && response.headers.get('content-type')?.includes('json')) {
        record.responseBody = JSON.parse(responseBytes.toString('utf8'));
      }
      if (path === policyPath && method === 'PUT' && dropNextPut) {
        dropNextPut = false;
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBytes,
      });
    });

    await page.goto(base + '/dashboard/projects/' + project.id, {
      waitUntil: 'networkidle',
    });
    await expect(
      page.getByRole('heading', { name: project.name, exact: true }),
    ).toBeVisible();
    assert.equal(
      requests.filter(
        (request) =>
          request.path === capabilityPath || request.path === policyPath,
      ).length,
      0,
      'album retention reads wait until settings first opens',
    );

    const settings = page
      .getByTestId('album-card-' + album.id)
      .locator('details.studio-album-settings');
    await settings.locator('summary').click();
    const form = page.getByTestId('album-retention-policy');
    const allowed = form.getByRole('switch', { name: '允許閒置清理' });
    const days = form.getByLabel('無人瀏覽幾天後列入清理');
    await expect(allowed).toBeVisible();
    await expect(allowed).not.toBeChecked();
    await expect(days).toHaveValue('90');
    const firstRead = requests.find(
      (request) => request.path === policyPath && request.method === 'GET',
    );
    assert.deepEqual(firstRead?.responseBody, {
      albumId: album.id,
      revision: 0,
      cleanupAllowed: false,
      inactiveDays: 90,
      automaticDeletionEnabled: false,
      dryRun: true,
    });
    assert.equal(
      requests.filter((request) => request.path === capabilityPath).length,
      1,
    );
    assert.equal(
      requests.filter(
        (request) => request.path === policyPath && request.method === 'GET',
      ).length,
      1,
    );

    await days.fill('120');
    await settings.locator('summary').click();
    await settings.locator('summary').click();
    await expect(days).toHaveValue('120');
    assert.equal(
      requests.filter(
        (request) =>
          request.path === capabilityPath || request.path === policyPath,
      ).length,
      2,
      'closing/reopening settings keeps the draft without another read',
    );

    dropNextPut = true;
    await form.getByRole('button', { name: '儲存清理設定' }).click();
    const retry = form.getByRole('button', { name: '重試相同設定' });
    await expect(retry).toBeVisible();
    await expect(days).toHaveValue('120');
    await expect(allowed).not.toBeChecked();
    const puts = () =>
      requests.filter(
        (request) => request.path === policyPath && request.method === 'PUT',
      );
    assert.equal(puts().length, 1);
    const firstBody = JSON.parse(puts()[0].body);
    assert.equal(firstBody.expectedOwnerId, expectedOwnerId);
    assert.equal(firstBody.expectedRevision, 0);
    assert.equal(firstBody.cleanupAllowed, false);
    assert.equal(firstBody.inactiveDays, 120);
    await retry.click();
    await expect(form.getByRole('status')).toContainText('設定已儲存');
    assert.equal(puts().length, 2);
    assert.equal(puts()[0].body, puts()[1].body);

    let saved = await ownerRequest(worker, base, ownerCookie, policyPath);
    assertStatus(saved, 200, 'read policy for archived album');
    assert.equal(saved.value.inactiveDays, 120);
    assert.equal(saved.value.cleanupAllowed, false);

    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      requests.filter((request) => request.path === capabilityPath).length,
      1,
      'retention capability remains lazy until settings opens',
    );
    await page
      .getByTestId('album-card-' + album.id)
      .locator('details.studio-album-settings > summary')
      .click();
    const reloadedForm = page.getByTestId('album-retention-policy');
    const reloadedAllowed = reloadedForm.getByRole('switch', {
      name: '允許閒置清理',
    });
    const reloadedDays = reloadedForm.getByLabel('無人瀏覽幾天後列入清理');
    await expect(reloadedDays).toHaveValue('120');
    await expect(reloadedAllowed).not.toBeChecked();

    await reloadedAllowed.check();
    await reloadedForm.getByRole('button', { name: '儲存清理設定' }).click();
    await expect(reloadedForm.getByRole('status')).toContainText('設定已儲存');
    saved = await ownerRequest(worker, base, ownerCookie, policyPath);
    assertStatus(saved, 200, 'read updated policy for archived album');
    assert.equal(saved.value.inactiveDays, 120);
    assert.equal(saved.value.cleanupAllowed, true);
    assert.equal(saved.value.automaticDeletionEnabled, false);
    assert.equal(saved.value.dryRun, true);

    const putCount = puts().length;
    await reloadedDays.fill('36501');
    await reloadedForm.getByRole('button', { name: '儲存清理設定' }).click();
    await expect(reloadedForm.getByRole('alert')).toContainText('1–36500');
    assert.equal(puts().length, putCount, 'out-of-range days do not write');
    assert.equal(
      requests.filter(
        (request) =>
          request.method === 'DELETE' || request.path.includes('/deletion'),
      ).length,
      0,
      'saving this preference never starts deletion',
    );
  } finally {
    await browser.close();
  }
  return { projectId: project.id, albumId: album.id };
}
