import { createIndependentActiveAlbum } from './selection-limit-guest-browser.mjs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
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
  const value = await response.json().catch(() => null);
  return { response, value };
}

async function ensureInheritedProjectDefaults({
  worker,
  base,
  ownerCookie,
  projectId,
  albumId,
}) {
  const projectPath =
    '/api/v1/projects/' + projectId + '/selection-policy-configuration';
  const albumPath =
    '/api/v1/albums/' + albumId + '/selection-policy-configuration';

  let project = await ownerRequest(worker, base, ownerCookie, projectPath);
  assert.equal(project.response.status, 200);
  assert.equal(project.value.projectId, projectId);
  if (
    project.value.revision === 0 ||
    project.value.minimum !== 1 ||
    project.value.maximum !== null
  ) {
    const changed = await ownerRequest(
      worker,
      base,
      ownerCookie,
      projectPath,
      'PUT',
      {
        requestId: randomUUID(),
        expectedRevision: project.value.revision,
        minimum: 1,
        maximum: null,
        confirm: true,
      },
    );
    assert.equal(changed.response.status, 200);
    project = await ownerRequest(worker, base, ownerCookie, projectPath);
    assert.equal(project.response.status, 200);
  }

  const album = await ownerRequest(worker, base, ownerCookie, albumPath);
  assert.equal(album.response.status, 200);
  assert.equal(album.value.albumId, albumId);
  if (album.value.configuration !== 'inherit') {
    const reset = await ownerRequest(
      worker,
      base,
      ownerCookie,
      albumPath,
      'PUT',
      {
        requestId: randomUUID(),
        expectedAlbumRevision: album.value.policy.albumRevision,
        expectedProjectRevision: project.value.revision,
        confirm: true,
        configuration: 'inherit',
      },
    );
    assert.equal(reset.response.status, 200);
  }
}

async function createPrivateDraftWithTwoPicks({
  worker,
  base,
  projectId,
  albumId,
  db,
}) {
  const ownerSession = await db
    .prepare(
      "SELECT s.id,s.userId FROM owner_sessions s JOIN workspaces w ON w.owner_user_id=s.userId JOIN albums a ON a.workspace_id=w.id WHERE a.id=? AND s.expiresAt>unixepoch('subsec')*1000 LIMIT 1",
    )
    .bind(albumId)
    .first();
  assert.ok(ownerSession?.id && ownerSession?.userId);

  const album = await db
    .prepare(
      'SELECT a.workspace_id,a.project_id FROM albums a ' +
        'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id ' +
        'WHERE a.id=? AND p.id=?',
    )
    .bind(albumId, projectId)
    .first();
  assert.ok(album?.workspace_id && album?.project_id);

  const inviteId = randomUUID();
  const inviteHash = createHash('sha256')
    .update('kino-pic:guest-invite-token:v1:' + randomBytes(32).toString('hex'))
    .digest('hex');
  const expires = Date.now() + 60 * 60 * 1000;
  await db
    .prepare(
      'INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,max_uses,created_by,owner_session_id) ' +
        "VALUES(?,?,?,?,'link_only',8,?,NULL,?,?)",
    )
    .bind(
      inviteId,
      album.workspace_id,
      album.project_id,
      inviteHash,
      expires,
      ownerSession.userId,
      ownerSession.id,
    )
    .run();
  await db
    .prepare(
      'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
    )
    .bind(inviteId, album.workspace_id, album.project_id, albumId)
    .run();
  await db
    .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
    .bind(inviteId)
    .run();

  const guestId = randomUUID();
  await db
    .prepare(
      'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
    )
    .bind(guestId, inviteId, 'Selection policy configuration test')
    .run();

  const secret = randomBytes(32).toString('hex');
  const sessionHash = createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
  await db
    .prepare(
      'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
    )
    .bind(
      randomUUID(),
      inviteId,
      guestId,
      sessionHash,
      Date.now() + 30 * 60 * 1000,
    )
    .run();

  const photos = [];
  for (let index = 0; index < 2; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    await db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(
        photoId,
        album.workspace_id,
        album.project_id,
        albumId,
        'policy-configuration-' + (index + 1) + '.jpg',
      )
      .run();
    await db
      .prepare(
        'INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) ' +
          "VALUES(?,?,?,1,NULL,?,?,17,'image/jpeg',10,10,'private')",
      )
      .bind(
        versionId,
        album.workspace_id,
        photoId,
        ownerSession.userId,
        randomBytes(32).toString('hex'),
      )
      .run();
    photos.push({ photoId, versionId });
  }

  for (const photo of photos) {
    const response = await worker.fetch(
      new Request(
        new URL(
          '/api/guest/albums/' +
            albumId +
            '/photos/' +
            photo.photoId +
            '/selection',
          base,
        ),
        {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            Cookie: 'kino_guest=' + secret,
            Origin: new URL(base).origin,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: randomUUID(),
            selected: true,
            versionId: photo.versionId,
          }),
        },
      ),
    );
    assert.equal(response.status, 200);
  }
}

async function isNarrowViewportOverflowing(page) {
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(
    width.scroll <= width.client,
    'The 375px selection configuration UI overflows: scrollWidth=' +
      width.scroll +
      ', clientWidth=' +
      width.client,
  );
}

export async function runSelectionPolicyConfigurationBrowserChecks({
  worker,
  base,
  ownerCookie,
  projectId,
  albumId,
  db,
}) {
  const projectPath =
    '/api/v1/projects/' + projectId + '/selection-policy-configuration';
  const albumPath =
    '/api/v1/albums/' + albumId + '/selection-policy-configuration';

  await ensureInheritedProjectDefaults({
    worker,
    base,
    ownerCookie,
    projectId,
    albumId,
  });
  await createPrivateDraftWithTwoPicks({
    worker,
    base,
    ownerCookie,
    projectId,
    albumId,
    db,
  });

  const initial = await ownerRequest(worker, base, ownerCookie, projectPath);
  assert.equal(initial.response.status, 200);
  assert.equal(initial.value.projectId, projectId);
  const projectRevision = initial.value.revision;
  const openDraftCount = initial.value.maxOpenSelectedCount;
  const cap = Math.max(2, openDraftCount);
  assert.ok(cap <= 100000);

  const rejectedCap = await ownerRequest(
    worker,
    base,
    ownerCookie,
    projectPath,
    'PUT',
    {
      requestId: randomUUID(),
      expectedRevision: projectRevision,
      minimum: 1,
      maximum: cap - 1,
      confirm: true,
    },
  );
  assert.equal(rejectedCap.response.status, 409);
  assert.match(
    rejectedCap.value?.error?.code ?? '',
    /BELOW_CURRENT|SELECTION_LIMIT/,
  );

  const album = await db
    .prepare('SELECT name FROM albums WHERE id=?')
    .bind(albumId)
    .first();
  assert.ok(album?.name);

  const laterMaximum = cap < 100000 ? cap + 1 : null;
  const browser = await chromium.launch({ headless: true });
  const attempts = [];
  const authFailures = [];
  let dropNextProjectResponse = false;
  let projectReads = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      {
        name: 'kino-owner.session_token',
        value: ownerCookieHeader(ownerCookie).slice(
          'kino-owner.session_token='.length,
        ),
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ]);
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      const isProjectRead =
        incoming.method() === 'GET' && url.pathname === projectPath;
      const isProjectWrite =
        incoming.method() === 'PUT' && url.pathname === projectPath;
      if (isProjectRead) projectReads += 1;

      if (isProjectWrite) {
        const attempt = {
          body: incoming.postData() ?? '',
          status: 0,
          dropped: false,
        };
        attempts.push(attempt);
        const deniedStatus = authFailures.shift();
        if (deniedStatus) {
          attempt.status = deniedStatus;
          await route.fulfill({
            status: deniedStatus,
            contentType: 'application/json',
            body: JSON.stringify({
              error: {
                code:
                  deniedStatus === 401 ? 'OWNER_REQUIRED' : 'OWNER_REQUIRED',
              },
            }),
          });
          return;
        }

        const response = await worker.fetch(
          new Request(incoming.url(), await requestInit(incoming)),
        );
        attempt.status = response.status;
        if (dropNextProjectResponse && response.ok) {
          dropNextProjectResponse = false;
          attempt.dropped = true;
          await route.abort('failed');
          return;
        }
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: Buffer.from(await response.arrayBuffer()),
        });
        return;
      }

      const response = await worker.fetch(
        new Request(incoming.url(), await requestInit(incoming)),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });

    await page.goto(base + '/dashboard/projects/' + projectId, {
      waitUntil: 'networkidle',
    });
    const project = page.getByTestId(
      'selection-policy-configuration-project-' + projectId,
    );
    await expect(project).toBeVisible();
    await expect(
      project.getByTestId('selection-policy-configuration-source'),
    ).toContainText(/系統預設|專案預設/);

    const maximum = project.getByTestId(
      'selection-policy-configuration-project-maximum',
    );
    const save = project.getByTestId('selection-policy-configuration-save');
    await maximum.fill(String(cap - 1));
    await expect(
      project.getByTestId('selection-policy-configuration-cap-error'),
    ).toContainText('目前仍開放的私有草稿');
    await expect(save).toBeDisabled();

    await maximum.fill(String(cap));
    await expect(save).toBeEnabled();
    await save.click();
    const dialog = page.getByRole('dialog', {
      name: '確認變更專案挑片預設？',
    });
    const cancel = dialog.getByRole('button', { name: '取消' });
    const confirmButton = dialog.getByTestId(
      'selection-policy-configuration-confirm',
    );
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirmButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(save).toBeFocused();

    await save.click();
    const secondDialog = page.getByRole('dialog', {
      name: '確認變更專案挑片預設？',
    });
    dropNextProjectResponse = true;
    await secondDialog
      .getByTestId('selection-policy-configuration-confirm')
      .click();
    await expect(
      project.getByTestId('selection-policy-configuration-pending'),
    ).toBeVisible();
    await expect.poll(() => attempts[0]?.dropped).toBe(true);
    const exactBody = attempts[0].body;
    const exactRequest = JSON.parse(exactBody);
    assert.match(
      exactRequest.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(exactRequest.expectedRevision, projectRevision);
    assert.equal(exactRequest.maximum, cap);
    assert.equal(exactRequest.confirm, true);

    const later = await ownerRequest(
      worker,
      base,
      ownerCookie,
      projectPath,
      'PUT',
      {
        requestId: randomUUID(),
        expectedRevision: projectRevision + 1,
        minimum: 1,
        maximum: laterMaximum,
        confirm: true,
      },
    );
    assert.equal(later.response.status, 200);
    assert.equal(later.value.configuration.maximum, laterMaximum);

    authFailures.push(401, 403);
    await project.getByTestId('selection-policy-configuration-retry').click();
    await expect(
      project.getByTestId('selection-policy-configuration-error'),
    ).toContainText('重新登入後請重試同一設定');
    assert.equal(attempts[1].status, 401);
    assert.equal(attempts[1].body, exactBody);
    await expect(
      project.getByTestId('selection-policy-configuration-pending'),
    ).toBeVisible();

    await project.getByTestId('selection-policy-configuration-retry').click();
    await expect(
      project.getByTestId('selection-policy-configuration-error'),
    ).toContainText('重新登入後請重試同一設定');
    assert.equal(attempts[2].status, 403);
    assert.equal(attempts[2].body, exactBody);
    await expect(
      project.getByTestId('selection-policy-configuration-pending'),
    ).toBeVisible();

    const readsBeforeReplay = projectReads;
    await project.getByTestId('selection-policy-configuration-retry').click();
    await expect.poll(() => attempts[3]?.status).toBe(200);
    assert.equal(attempts[3].body, exactBody);
    await expect(
      project.getByTestId('selection-policy-configuration-project-maximum'),
    ).toHaveValue(laterMaximum === null ? '' : String(laterMaximum));
    await expect.poll(() => projectReads).toBeGreaterThan(readsBeforeReplay);
    await isNarrowViewportOverflowing(page);

    await page
      .getByRole('button', { name: '審查挑片 ' + album.name, exact: true })
      .click();
    const albumSection = page.getByTestId(
      'selection-policy-configuration-album-' + albumId,
    );
    await expect(albumSection).toBeVisible();
    await expect(
      albumSection.getByTestId('selection-policy-configuration-source'),
    ).toContainText('專案預設');

    await albumSection
      .getByTestId('selection-policy-configuration-override')
      .check();
    const albumMaximum = albumSection.getByTestId(
      'selection-policy-configuration-album-maximum',
    );
    await albumMaximum.fill('');
    const albumSave = albumSection.getByTestId(
      'selection-policy-configuration-save',
    );
    await expect(albumSave).toBeEnabled();
    await albumSave.click();
    await page
      .getByRole('dialog', { name: '確認變更相簿挑片政策？' })
      .getByTestId('selection-policy-configuration-confirm')
      .click();
    await expect(
      albumSection.getByTestId('selection-policy-configuration-source'),
    ).toContainText('相簿覆寫');
    await expect(
      albumSection.getByTestId('selection-policy-configuration-effective'),
    ).toContainText('最高 不限');

    await albumSection
      .getByTestId('selection-policy-configuration-inherit')
      .check();
    await expect(albumSave).toBeEnabled();
    await albumSave.click();
    await page
      .getByRole('dialog', { name: '確認改為沿用上層政策？' })
      .getByTestId('selection-policy-configuration-confirm')
      .click();
    await expect(
      albumSection.getByTestId('selection-policy-configuration-source'),
    ).toContainText('專案預設');
    await expect(
      albumSection.getByTestId('selection-policy-configuration-effective'),
    ).toContainText(
      '最高 ' + (laterMaximum === null ? '不限' : String(laterMaximum) + ' 張'),
    );
    await isNarrowViewportOverflowing(page);
    await context.close();
  } finally {
    await browser.close();
  }

  const currentProject = await ownerRequest(
    worker,
    base,
    ownerCookie,
    projectPath,
  );
  const currentAlbum = await ownerRequest(worker, base, ownerCookie, albumPath);
  assert.equal(currentProject.response.status, 200);
  assert.equal(currentProject.value.maximum, laterMaximum);
  assert.equal(currentAlbum.response.status, 200);
  assert.equal(currentAlbum.value.configuration, 'inherit');
  assert.equal(currentAlbum.value.policy.source, 'project');
}

export async function runIndependentSelectionPolicyConfigurationBrowserChecks({
  worker,
  base,
  ownerCookie,
  db,
  galleryFixture,
}) {
  const created = await ownerRequest(
    worker,
    base,
    ownerCookie,
    '/api/v1/projects',
    'POST',
    {
      workspaceId: galleryFixture.context.workspace.id,
      name: 'Owner policy isolated ' + randomUUID(),
      requestId: randomUUID(),
    },
  );
  assert.equal(created.response.status, 201);
  const context = { ...galleryFixture.context, project: created.value.project };
  const { projectId, albumId } = await createIndependentActiveAlbum({
    worker,
    base,
    ownerCookie,
    db,
    galleryFixture: { context },
  });
  await runSelectionPolicyConfigurationBrowserChecks({
    worker,
    base,
    ownerCookie,
    db,
    projectId,
    albumId,
  });
}
