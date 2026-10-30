import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { pngFixture } from './image-fixtures.mjs';

function cookieHeader(value) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/u.exec(value);
  const token = match?.[1] ?? value;
  assert.ok(token, 'A current Owner cookie is required for this browser check');
  return 'kino-owner.session_token=' + token;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function ownerRequest(worker, base, cookie, owner, path, method, body) {
  const headers = {
    Accept: 'application/json',
    Cookie: cookieHeader(cookie),
    Origin: new URL(base).origin,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(method !== 'GET' && method !== 'HEAD'
      ? { 'X-Kino-Expected-Actor': owner }
      : {}),
  };
  const response = await worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
  const value = await readJson(response);
  return { response, value };
}

async function createAutoAlbum({ worker, base, cookie, owner, workspaceId }) {
  const projectResult = await ownerRequest(
    worker,
    base,
    cookie,
    owner,
    '/api/v1/projects',
    'POST',
    {
      requestId: randomUUID(),
      workspaceId,
      name: 'Indexed browser ' + randomUUID(),
    },
  );
  assert.equal(
    projectResult.response.status,
    201,
    JSON.stringify(projectResult.value),
  );
  const project = projectResult.value?.project;
  assert.ok(project?.id);

  const versioning = await ownerRequest(
    worker,
    base,
    cookie,
    owner,
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning',
    'GET',
  );
  assert.equal(
    versioning.response.status,
    200,
    JSON.stringify(versioning.value),
  );
  const changed = await ownerRequest(
    worker,
    base,
    cookie,
    owner,
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning',
    'PUT',
    {
      requestId: randomUUID(),
      expectedRevision: versioning.value.revision,
      mode: 'auto_filename',
      confirm: true,
    },
  );
  assert.equal(changed.response.status, 200, JSON.stringify(changed.value));
  assert.equal(changed.value?.mode, 'auto_filename');

  const albumName = 'Indexed browser album ' + randomUUID();
  const albumResult = await ownerRequest(
    worker,
    base,
    cookie,
    owner,
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/albums',
    'POST',
    { requestId: randomUUID(), name: albumName },
  );
  assert.equal(
    albumResult.response.status,
    201,
    JSON.stringify(albumResult.value),
  );
  const album = albumResult.value?.album;
  assert.ok(album?.id);
  return { project, album, albumName };
}

async function assertMobileWidth(page, label) {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(
    width.scroll <= width.client,
    label + ' overflows 375px (' + width.scroll + ' > ' + width.client + ')',
  );
}

export async function runIndexedVersionMatchingBrowserChecks({
  worker,
  legacyWorker,
  disabledWorker,
  base,
  ownerCookie,
  owner,
  db,
  galleryFixture,
}) {
  const cookie = ownerCookie ?? '';
  const workspaceId = galleryFixture?.context?.workspace?.id;
  assert.ok(
    worker && legacyWorker && disabledWorker && base && cookie && owner && db,
  );
  assert.ok(workspaceId, 'A current Owner workspace is required');

  const fixture = await createAutoAlbum({
    worker,
    base,
    cookie,
    owner,
    workspaceId,
  });

  // Create one immutable source through the legacy-enabled API Worker. That
  // Worker deliberately has no filename-index gate, so the indexed browser
  // must explain incomplete evidence instead of presenting a false no-match.
  const staleFilename = 'source-without-index-' + randomUUID() + '.png';
  const staleReservation = await ownerRequest(
    legacyWorker,
    base,
    cookie,
    owner,
    '/api/v1/uploads/init',
    'POST',
    {
      requestId: randomUUID(),
      workspaceId,
      projectId: fixture.project.id,
      albumId: fixture.album.id,
      originalFilename: staleFilename,
      expectedBytes: 1,
      contentType: 'image/png',
      sha256: '7'.repeat(64),
    },
  );
  assert.equal(
    staleReservation.response.status,
    201,
    JSON.stringify(staleReservation.value),
  );
  const staleSessionId = staleReservation.value?.uploadSession?.id;
  assert.ok(staleSessionId);

  const statusResponse = await ownerRequest(
    worker,
    base,
    cookie,
    owner,
    '/api/v1/albums/' +
      encodeURIComponent(fixture.album.id) +
      '/matching-filename-index',
    'GET',
  );
  assert.equal(
    statusResponse.response.status,
    200,
    JSON.stringify(statusResponse.value),
  );
  assert.equal(statusResponse.value?.missingSessions, 1);
  assert.equal(statusResponse.value?.state, 'building');

  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const token = cookieHeader(cookie).slice(
      'kino-owner.session_token='.length,
    );
    await context.addCookies([
      {
        name: 'kino-owner.session_token',
        value: token,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
        secure: new URL(base).protocol === 'https:',
      },
    ]);
    const page = await context.newPage();
    const apiCalls = [];
    let activeWorker = worker;
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      if (url.origin !== new URL(base).origin) {
        await route.continue();
        return;
      }

      const headers = await incoming.allHeaders();
      delete headers.host;
      delete headers['content-length'];
      delete headers['accept-encoding'];
      headers['cf-connecting-ip'] = '198.51.100.98';
      const method = incoming.method();
      const requestBody = incoming.postDataBuffer() ?? undefined;
      let response;
      try {
        response = await activeWorker.fetch(
          new Request(incoming.url(), {
            method,
            headers,
            ...(requestBody === undefined ? {} : { body: requestBody }),
            redirect: 'manual',
          }),
        );
      } catch (error) {
        if (url.pathname.startsWith('/api/'))
          apiCalls.push({
            method,
            pathname: url.pathname,
            error: String(error),
          });
        await route.abort('failed');
        return;
      }

      const responseBody = Buffer.from(await response.arrayBuffer());
      if (url.pathname.startsWith('/api/')) {
        apiCalls.push({
          method,
          pathname: url.pathname,
          status: response.status,
          body: responseBody.toString('utf8'),
        });
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      });
    });

    const openPanel = async () => {
      const document = await page.goto(
        base + '/dashboard/projects/' + encodeURIComponent(fixture.project.id),
        { waitUntil: 'networkidle' },
      );
      assert.equal(document?.status(), 200);
      await expect(
        page.getByRole('heading', { name: fixture.project.name, exact: true }),
      ).toBeVisible();
      const albumCard = page.getByTestId('album-card-' + fixture.album.id);
      await expect(albumCard).toBeVisible();
      await albumCard
        .getByRole('button', {
          name: '上傳照片 ' + fixture.albumName,
          exact: true,
        })
        .click();
      return page.getByTestId('resolved-upload');
    };

    const panel = await openPanel();
    await expect(
      panel.getByRole('heading', {
        name: '依檔名解析上傳',
        exact: true,
      }),
    ).toBeVisible();
    await panel.getByTestId('resolved-upload-file').setInputFiles({
      name: 'not-ready-browser-' + randomUUID() + '.png',
      mimeType: 'image/png',
      buffer: pngFixture(),
    });
    await expect(panel.getByText(/原始尺寸 1 × 1/u)).toBeVisible();
    await panel.getByTestId('resolved-upload-preview').click();
    await expect(
      panel.getByRole('heading', {
        name: '檔名比對資料尚未完整，請先整理相簿索引',
        exact: true,
      }),
    ).toBeVisible();
    await expect(panel.getByRole('alert')).toContainText('此結果不能建立上傳');
    await expect(panel.getByTestId('resolved-upload-reserve')).toBeDisabled();
    await assertMobileWidth(page, 'Indexed filename-index review');
    await mkdir('.local', { recursive: true });
    await panel.screenshot({
      path: '.local/indexed-version-matching-not-ready-mobile.png',
    });
    const previewCall = apiCalls.find(
      (call) =>
        call.method === 'POST' && call.pathname.endsWith('/upload-resolution'),
    );
    assert.equal(previewCall?.status, 200, JSON.stringify(previewCall));
    const previewBody = JSON.parse(previewCall.body);
    assert.equal(previewBody?.decision?.reason, 'filename_index_not_ready');
    assert.equal(previewBody?.candidatesTruncated, true);
    assert.equal(
      apiCalls.some((call) => call.pathname.endsWith('/resolved-uploads')),
      false,
      'An unready index must not produce a browser reservation request',
    );

    // The production-facing gates remain default-OFF. With the default Worker,
    // the project can still be viewed but no resolved-upload panel is mounted.
    activeWorker = disabledWorker;
    const disabledCapabilities = await ownerRequest(
      disabledWorker,
      base,
      cookie,
      owner,
      '/api/v1/upload-resolution/capabilities',
      'GET',
    );
    assert.equal(disabledCapabilities.response.status, 200);
    assert.deepEqual(disabledCapabilities.value, { enabled: false });
    const disabledIndexCapabilities = await ownerRequest(
      disabledWorker,
      base,
      cookie,
      owner,
      '/api/v1/matching-filename-index/capabilities',
      'GET',
    );
    assert.equal(disabledIndexCapabilities.response.status, 200);
    assert.deepEqual(disabledIndexCapabilities.value, { enabled: false });
    await page.reload({ waitUntil: 'networkidle' });
    const albumCard = page.getByTestId('album-card-' + fixture.album.id);
    await expect(albumCard).toBeVisible();
    await albumCard
      .getByRole('button', {
        name: '上傳照片 ' + fixture.albumName,
        exact: true,
      })
      .click();
    await expect(page.getByTestId('resolved-upload')).toHaveCount(0);
    await assertMobileWidth(page, 'Default-OFF resolved-upload UI');
    assert.deepEqual(pageErrors, []);

    return {
      indexNotReadyReasonVisible: true,
      noReservationWhenIndexNotReady: true,
      gateOffPanelHidden: true,
      mobileOverflow: false,
    };
  } finally {
    await context?.close();
    await browser.close();
    const cancelled = await ownerRequest(
      legacyWorker,
      base,
      cookie,
      owner,
      '/api/v1/uploads/' + staleSessionId + '/cancel',
      'POST',
      { requestId: randomUUID() },
    );
    assert.equal(
      cancelled.response.status,
      200,
      JSON.stringify(cancelled.value),
    );
  }
}
