import assert from 'node:assert/strict';
import { activateDraftAlbumFixture } from './activate-album-fixture.mjs';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

export async function ownerFetch({
  worker,
  base,
  ownerCookie,
  path,
  method,
  body,
}) {
  return worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers: {
        Accept: 'application/json',
        Cookie: ownerCookieHeader(ownerCookie),
        Origin: new URL(base).origin,
        'CF-Connecting-IP': '203.0.113.240',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual',
    }),
  );
}

export async function createIndependentActiveAlbum({
  worker,
  base,
  ownerCookie,
  db,
  galleryFixture,
}) {
  const workspaceId = galleryFixture.context.workspace.id;
  const projectId = galleryFixture.context.project.id;
  const created = await ownerFetch({
    worker,
    base,
    ownerCookie,
    path: '/api/v1/projects/' + projectId + '/albums',
    method: 'POST',
    body: {
      requestId: randomUUID(),
      name: 'Selection limit browser ' + randomUUID(),
    },
  });
  assert.equal(
    created.status,
    201,
    'synthetic selection-limit album creation succeeds',
  );
  const result = await created.json();
  assert.equal(result.album.workspaceId, workspaceId);
  assert.equal(result.album.projectId, projectId);
  assert.equal(result.album.state, 'draft');

  // The content API creates a draft. Activate only this synthetic D1 fixture so
  // the real Guest eligibility query can expose its metadata-only test photos.
  const activation = await activateDraftAlbumFixture(db, result.album.id);
  assert.equal(activation.commandCount, 1);
  const active = await db
    .prepare('SELECT id,workspace_id,project_id,state FROM albums WHERE id=?')
    .bind(result.album.id)
    .first();
  assert.deepEqual(active, {
    id: result.album.id,
    workspace_id: workspaceId,
    project_id: projectId,
    state: 'active',
  });
  return { albumId: result.album.id, workspaceId, projectId };
}

export async function createThreeVisiblePhotos({
  db,
  galleryFixture,
  albumId,
}) {
  const source = await db
    .prepare(
      'SELECT p.workspace_id,p.project_id,v.created_by_actor,v.source_hash_sha256,' +
        'v.byte_size,v.mime,v.width,v.height,v.status,a.storage_node_id ' +
        'FROM photos p ' +
        'JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id AND v.version_no=1 ' +
        "JOIN photo_assets a ON a.photo_id=p.id AND a.version_id=v.id AND a.workspace_id=p.workspace_id AND a.asset_kind='original' " +
        'WHERE p.album_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 1',
    )
    .bind(galleryFixture.context.album.id)
    .first();
  assert.ok(source, 'galleryFixture must contain an eligible source original');

  const fixtures = [];
  const statements = [];
  for (let index = 0; index < 3; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
    const filename =
      'selection-limit-' + (index + 1) + '-' + photoId.slice(0, 8) + '.jpg';
    fixtures.push({ photoId, versionId, filename });
    statements.push(
      db
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(
          photoId,
          source.workspace_id,
          source.project_id,
          albumId,
          filename,
        ),
      db
        .prepare(
          'INSERT INTO photo_versions(' +
            'id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,' +
            'source_hash_sha256,byte_size,mime,width,height,status' +
            ') VALUES(?,?,?,1,NULL,?,?,?,?,?,?,?)',
        )
        .bind(
          versionId,
          source.workspace_id,
          photoId,
          source.created_by_actor,
          source.source_hash_sha256,
          source.byte_size,
          source.mime,
          source.width,
          source.height,
          source.status,
        ),
      db
        .prepare(
          'INSERT INTO photo_assets(' +
            'id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,' +
            'object_key,byte_size,mime,checksum_sha256,state' +
            ") VALUES(?,?,?,?,?,'original',?,?,?,?, 'private')",
        )
        .bind(
          assetId,
          source.workspace_id,
          photoId,
          versionId,
          source.storage_node_id,
          source.workspace_id +
            '/' +
            source.project_id +
            '/' +
            albumId +
            '/' +
            photoId +
            '/original.jpg',
          source.byte_size,
          source.mime,
          source.source_hash_sha256,
        ),
    );
  }
  await db.batch(statements);

  // Match the gallery's version-1/original eligibility joins. All assets stay
  // private and metadata-only; this browser check writes no R2 object.
  const visible = await db
    .prepare(
      'SELECT p.id AS photoId,p.original_filename AS filename,v.id AS versionId,a.state ' +
        'FROM photos p ' +
        'JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id AND v.version_no=1 ' +
        "JOIN photo_assets a ON a.photo_id=p.id AND a.version_id=v.id AND a.workspace_id=p.workspace_id AND a.asset_kind='original' " +
        'WHERE p.album_id=? ORDER BY p.created_at DESC,p.id DESC',
    )
    .bind(albumId)
    .all();
  assert.equal(visible.results.length, 3);
  assert.ok(visible.results.every((row) => row.state === 'private'));
  assert.deepEqual(
    new Set(visible.results.map((row) => row.photoId)),
    new Set(fixtures.map((row) => row.photoId)),
  );
  return fixtures;
}

async function setExactTwoSelectionPolicy({
  worker,
  base,
  ownerCookie,
  owner,
  db,
  albumId,
}) {
  const response = await ownerFetch({
    worker,
    base,
    ownerCookie,
    path: '/api/v1/albums/' + albumId + '/selection-policy',
    method: 'PUT',
    body: {
      requestId: randomUUID(),
      expectedRevision: 0,
      minimum: 2,
      maximum: 2,
      confirm: true,
    },
  });
  assert.equal(response.status, 200, 'Owner selection policy update succeeds');
  const result = await response.json();
  assert.equal(result.policy.albumId, albumId);
  assert.equal(result.policy.minimum, 2);
  assert.equal(result.policy.maximum, 2);
  assert.equal(result.policy.revision, 1);
  assert.equal(result.policy.mode, 'private');
  assert.ok(
    result.eventId,
    'policy change returns its immutable audit event ID',
  );

  const audit = await db
    .prepare(
      'SELECT actor_type,actor_id,album_id FROM audit_events WHERE event_id=?',
    )
    .bind(result.eventId)
    .first();
  assert.ok(audit, 'Owner policy mutation has an audit event');
  assert.equal(audit.actor_type, 'user');
  assert.equal(audit.actor_id, owner);
  assert.equal(audit.album_id, albumId);
}

const guestPermissions = {
  can_view: true,
  can_download_preview: false,
  can_download_original: false,
  can_select: true,
  can_rate: false,
  can_favorite: false,
  can_tag: false,
  can_annotate: false,
  can_comment: false,
  can_submit: true,
  can_view_own_history: false,
  can_compare_versions: false,
};

export async function issueTwoUseInvite({
  worker,
  base,
  ownerCookie,
  projectId,
  albumId,
  canSubmit = true,
}) {
  const response = await ownerFetch({
    worker,
    base,
    ownerCookie,
    path: '/api/v1/projects/' + projectId + '/invites',
    method: 'POST',
    body: {
      requestId: randomUUID(),
      albumIds: [albumId],
      accessMode: 'link_only',
      permissions: { ...guestPermissions, can_submit: canSubmit },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      maxUses: 2,
    },
  });
  assert.equal(
    response.status,
    200,
    'Owner issues the synthetic link-only invite',
  );
  const result = await response.json();
  assert.equal(result.secretAvailable, true);
  assert.equal(typeof result.invite?.inviteId, 'string');
  assert.equal(
    typeof result.token === 'string' && /^[a-f0-9]{64}$/.test(result.token),
    true,
  );
  return { inviteId: result.invite.inviteId, token: result.token };
}

export async function exchangeFreshGuest({
  worker,
  base,
  invite,
  albumId,
  address,
  label,
}) {
  const exchanged = await worker.fetch(
    new Request(new URL('/api/guest/exchange', base), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: new URL(base).origin,
        'CF-Connecting-IP': address,
      },
      body: JSON.stringify({
        requestId: randomUUID(),
        token: invite.token,
        displayName: 'Synthetic selection limit ' + label + ' ' + randomUUID(),
      }),
      redirect: 'manual',
    }),
  );
  assert.equal(exchanged.status, 200, 'real Guest exchange endpoint succeeds');
  const cookieLines =
    typeof exchanged.headers.getSetCookie === 'function'
      ? exchanged.headers.getSetCookie()
      : [exchanged.headers.get('set-cookie') ?? ''];
  const setCookie = cookieLines.find((value) =>
    /(?:^|;\s*)(?:__Host-)?kino_guest=/.test(value),
  );
  assert.ok(
    setCookie,
    'Guest exchange returns its session only in an HttpOnly cookie',
  );
  assert.match(setCookie, /HttpOnly/i);
  const match = /(?:^|;\s*)((?:__Host-)?kino_guest)=([^;]+)/.exec(setCookie);
  assert.ok(match, 'Guest session cookie is parseable');

  const cookieName = match[1];
  const cookieValue = decodeURIComponent(match[2]);
  const accessResponse = await worker.fetch(
    new Request(new URL('/api/guest/albums/' + albumId + '/access', base), {
      headers: {
        Accept: 'application/json',
        Cookie: cookieName + '=' + cookieValue,
        Origin: new URL(base).origin,
        'CF-Connecting-IP': address,
      },
    }),
  );
  assert.equal(accessResponse.status, 200);
  const accessEnvelope = await accessResponse.json();
  assert.ok(
    accessEnvelope.access,
    'Guest access response uses the { access } envelope',
  );
  assert.equal(accessEnvelope.access.permissions.can_view, true);
  assert.equal(accessEnvelope.access.permissions.can_select, true);

  assert.equal(typeof accessEnvelope.access.guestId, 'string');

  return {
    cookieName,
    cookieValue,
    cookieSecure: /;\s*secure(?:;|$)/i.test(setCookie),
    guestId: accessEnvelope.access.guestId,
  };
}

async function createGuestWorkerPage({
  browser,
  worker,
  base,
  albumId,
  address,
  guest,
}) {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  await context.addCookies([
    {
      name: guest.cookieName,
      value: guest.cookieValue,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: guest.cookieSecure,
    },
  ]);
  const page = await context.newPage();
  const observations = {
    access: [],
    galleryPageSizes: [],
    selectionReads: [],
    selectionMutations: [],
    selectionErrors: [],
  };
  const accessPath = '/api/guest/albums/' + albumId + '/access';
  const galleryPath = '/api/guest/albums/' + albumId + '/photos';
  const selectionPath = '/api/guest/albums/' + albumId + '/selection';

  await page.route('**/*', async (route) => {
    const incoming = route.request();
    const method = incoming.method();
    const headers = await incoming.allHeaders();
    headers['cf-connecting-ip'] = address;
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD')
      init.body = incoming.postDataBuffer() ?? undefined;
    const url = new URL(incoming.url());
    const response = await worker.fetch(new Request(incoming.url(), init));
    const responseBytes = Buffer.from(await response.clone().arrayBuffer());

    if (url.pathname === accessPath && method === 'GET') {
      observations.access.push({
        status: response.status,
        body: JSON.parse(responseBytes.toString('utf8')),
      });
    }
    if (url.pathname === galleryPath && method === 'GET' && response.ok) {
      observations.galleryPageSizes.push(
        JSON.parse(responseBytes.toString('utf8')).photos.length,
      );
    }
    if (url.pathname === selectionPath && method === 'GET' && response.ok) {
      observations.selectionReads.push(
        JSON.parse(responseBytes.toString('utf8')),
      );
    }
    if (
      url.pathname.includes('/selection') &&
      (method === 'PUT' || method === 'POST')
    ) {
      const body = incoming.postData() ?? '';
      observations.selectionMutations.push({
        method,
        path: url.pathname,
        status: response.status,
        body: body ? JSON.parse(body) : null,
      });
    }
    if (url.pathname.includes('/selection') && response.status >= 400) {
      observations.selectionErrors.push({
        method,
        path: url.pathname,
        status: response.status,
      });
    }

    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBytes,
    });
  });

  return { context, page, observations };
}

async function filenameForCheckbox(checkbox) {
  const label = await checkbox.getAttribute('aria-label');
  assert.ok(label);
  const prefix = '選取 ';
  assert.ok(
    label.startsWith(prefix),
    'selection checkbox keeps its photo label',
  );
  return label.slice(prefix.length);
}

async function visibleSelectionCount(db, albumId, guestId) {
  return db
    .prepare(
      'SELECT count(*) AS n FROM guest_selection_state WHERE album_id=? AND guest_id=?',
    )
    .bind(albumId, guestId)
    .first();
}

async function runGuestScenario({
  browser,
  worker,
  base,
  albumId,
  guest,
  address,
  photos,
  batchOnly = false,
  db,
}) {
  const session = await createGuestWorkerPage({
    browser,
    worker,
    base,
    albumId,
    address,
    guest,
  });
  try {
    await session.page.goto(base + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    await expect(
      session.page.getByRole('heading', {
        name: /^Kino Pick (?:線上挑片|相簿)$/,
      }),
    ).toBeVisible();
    const photoList = session.page.getByRole('list', { name: '相簿照片列表' });
    await expect(photoList.locator('li')).toHaveCount(3);
    const checkboxes = photoList.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(3);
    const bottomBar = session.page.getByLabel('選片統計與送出列');
    const submit = bottomBar.getByRole('button', { name: '送出挑片' });

    await expect(session.page.getByText(/至少\s*2\s*張/)).toBeVisible();
    await expect(session.page.getByText(/最多\s*2\s*張/)).toBeVisible();
    for (const access of session.observations.access) {
      assert.equal(access.status, 200);
      assert.ok(access.body.access);
      assert.equal(access.body.access.guestId, guest.guestId);
    }
    assert.ok(session.observations.selectionReads.length > 0);
    for (const read of session.observations.selectionReads) {
      assert.equal(read.selectionPolicy.minimum, 2);
      assert.equal(read.selectionPolicy.maximum, 2);
      assert.equal(read.selectionPolicy.mode, 'private');
    }
    assert.equal(session.observations.galleryPageSizes[0], 3);
    await expect(bottomBar.getByText(/已選取\s*0\s*張照片/)).toBeVisible();
    await expect(submit).toBeDisabled();
    const selectionErrorCopy = session.page.getByText(
      /選片狀態無法同步|無法儲存選片|結果尚未確認/,
    );
    await expect(selectionErrorCopy).toHaveCount(0);

    if (batchOnly) {
      await session.page
        .getByRole('button', { name: '選取目前顯示頁面' })
        .click();
      await expect(bottomBar.getByText(/已選取\s*2\s*張照片/)).toBeVisible();
      await expect(submit).toBeEnabled();
      await expect(checkboxes.nth(0)).toBeChecked();
      await expect(checkboxes.nth(1)).toBeChecked();
      await expect(checkboxes.nth(2)).not.toBeChecked();
      await expect(checkboxes.nth(2)).toBeDisabled();

      const count = await visibleSelectionCount(db, albumId, guest.guestId);
      assert.equal(count.n, 2);
      assert.equal(session.observations.selectionMutations.length, 2);
      assert.ok(
        session.observations.selectionMutations.every(
          (mutation) => mutation.method === 'PUT' && mutation.status === 200,
        ),
      );
      const selectedFilenames = await Promise.all([
        filenameForCheckbox(checkboxes.nth(0)),
        filenameForCheckbox(checkboxes.nth(1)),
      ]);
      const selectedRows = await db
        .prepare(
          'SELECT p.original_filename AS filename FROM guest_selection_state s ' +
            'JOIN photos p ON p.id=s.photo_id WHERE s.album_id=? AND s.guest_id=?',
        )
        .bind(albumId, guest.guestId)
        .all();
      assert.deepEqual(
        new Set(selectedFilenames),
        new Set(selectedRows.results.map((row) => row.filename)),
      );
      assert.ok(
        session.observations.selectionErrors.length === 0,
        'batch selection must not surface a failed API response',
      );
      await expect(selectionErrorCopy).toHaveCount(0);
      const viewport = await session.page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      assert.ok(viewport.scrollWidth <= viewport.clientWidth);
      await mkdir('.local', { recursive: true });
      await session.page.screenshot({
        path: '.local/selection-limit-guest-mobile.png',
        fullPage: true,
      });
    } else {
      const first = checkboxes.nth(0);
      const second = checkboxes.nth(1);
      const third = checkboxes.nth(2);
      const secondFilename = await filenameForCheckbox(second);
      const thirdFilename = await filenameForCheckbox(third);
      const fixtureByFilename = new Map(
        photos.map((photo) => [photo.filename, photo]),
      );
      const expectedSnapshotIds = new Set([
        fixtureByFilename.get(secondFilename)?.photoId,
        fixtureByFilename.get(thirdFilename)?.photoId,
      ]);
      assert.ok(!expectedSnapshotIds.has(undefined));

      await first.click();
      await expect(first).toBeChecked();
      await expect(bottomBar.getByText(/已選取\s*1\s*張照片/)).toBeVisible();
      await expect(submit).toBeDisabled();

      await second.click();
      await expect(second).toBeChecked();
      await expect(bottomBar.getByText(/已選取\s*2\s*張照片/)).toBeVisible();
      await expect(submit).toBeEnabled();
      await expect(first).toBeEnabled();
      await expect(third).not.toBeChecked();
      await expect(third).toBeDisabled();

      // At the cap, a selection remains removable and releases a slot.
      await first.click();
      await expect(first).not.toBeChecked();
      await expect(bottomBar.getByText(/已選取\s*1\s*張照片/)).toBeVisible();
      await expect(third).toBeEnabled();

      await third.click();
      await expect(third).toBeChecked();
      await expect(bottomBar.getByText(/已選取\s*2\s*張照片/)).toBeVisible();
      await expect(submit).toBeEnabled();
      await expect(first).not.toBeChecked();
      await expect(first).toBeDisabled();

      await submit.click();
      const dialog = session.page.getByRole('dialog', {
        name: '確認送出挑片？',
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: '確認送出' }).click();
      await expect(session.page.getByText('✓ 挑片已成功送出！')).toBeVisible();

      const selectedRows = await db
        .prepare(
          'SELECT photo_id,version_id FROM guest_selection_state WHERE album_id=? AND guest_id=? ORDER BY photo_id',
        )
        .bind(albumId, guest.guestId)
        .all();
      assert.equal(selectedRows.results.length, 2);
      assert.deepEqual(
        new Set(selectedRows.results.map((row) => row.photo_id)),
        expectedSnapshotIds,
      );

      const submission = await db
        .prepare(
          'SELECT id,round_no,selection_revision FROM guest_selection_submissions WHERE guest_id=? AND album_id=?',
        )
        .bind(guest.guestId, albumId)
        .first();
      assert.ok(submission);
      assert.equal(submission.round_no, 1);
      const snapshot = await db
        .prepare(
          'SELECT photo_id,version_id FROM guest_selection_submission_items WHERE submission_id=? ORDER BY photo_id',
        )
        .bind(submission.id)
        .all();
      assert.equal(snapshot.results.length, 2);
      assert.deepEqual(
        new Set(snapshot.results.map((row) => row.photo_id)),
        expectedSnapshotIds,
      );
      for (const item of snapshot.results) {
        const pinned = await db
          .prepare(
            'SELECT id FROM photo_versions WHERE id=? AND photo_id=? AND version_no=1',
          )
          .bind(item.version_id, item.photo_id)
          .first();
        assert.ok(pinned);
      }

      const audit = await db
        .prepare(
          "SELECT actor_type,actor_id FROM audit_events WHERE action='selection.submitted' AND album_id=? AND actor_id=?",
        )
        .bind(albumId, guest.guestId)
        .first();
      assert.ok(audit);
      assert.equal(audit.actor_type, 'guest');
      assert.deepEqual(session.observations.selectionErrors, []);
      assert.equal(
        session.observations.selectionMutations.filter(
          (mutation) => mutation.method === 'POST',
        ).length,
        1,
      );
      assert.ok(
        session.observations.selectionMutations.every(
          (mutation) => mutation.status === 200,
        ),
      );
      await expect(selectionErrorCopy).toHaveCount(0);
    }
  } finally {
    await session.context.close();
  }
}

export async function runGuestSelectionLimitBrowserChecks({
  worker,
  base,
  ownerCookie,
  owner,
  db,
  galleryFixture,
}) {
  const album = await createIndependentActiveAlbum({
    worker,
    base,
    ownerCookie,
    db,
    galleryFixture,
  });
  const photos = await createThreeVisiblePhotos({
    db,
    galleryFixture,
    albumId: album.albumId,
  });
  await setExactTwoSelectionPolicy({
    worker,
    base,
    ownerCookie,
    owner,
    db,
    albumId: album.albumId,
  });
  const invite = await issueTwoUseInvite({
    worker,
    base,
    ownerCookie,
    projectId: album.projectId,
    albumId: album.albumId,
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const firstGuest = await exchangeFreshGuest({
      worker,
      base,
      invite,
      albumId: album.albumId,
      address: '198.51.100.151',
      label: 'A',
    });
    const secondGuest = await exchangeFreshGuest({
      worker,
      base,
      invite,
      albumId: album.albumId,
      address: '198.51.100.152',
      label: 'B',
    });
    assert.notEqual(
      firstGuest.guestId,
      secondGuest.guestId,
      'two distinct invite exchanges create independent Guest identities',
    );

    await runGuestScenario({
      browser,
      worker,
      base,
      albumId: album.albumId,
      guest: firstGuest,
      address: '198.51.100.151',
      photos,
      batchOnly: false,
      db,
    });
    await runGuestScenario({
      browser,
      worker,
      base,
      albumId: album.albumId,
      guest: secondGuest,
      address: '198.51.100.152',
      photos,
      batchOnly: true,
      db,
    });
    const selectOnlyInvite = await issueTwoUseInvite({
      worker,
      base,
      ownerCookie,
      projectId: album.projectId,
      albumId: album.albumId,
      canSubmit: false,
    });
    const selectOnlyGuest = await exchangeFreshGuest({
      worker,
      base,
      invite: selectOnlyInvite,
      albumId: album.albumId,
      address: '198.51.100.153',
      label: 'select only',
    });
    const selectOnlyPage = await createGuestWorkerPage({
      browser,
      worker,
      base,
      albumId: album.albumId,
      guest: selectOnlyGuest,
      address: '198.51.100.153',
    });
    try {
      await selectOnlyPage.page.goto(base + '/guest/albums/' + album.albumId, {
        waitUntil: 'networkidle',
      });
      await expect(
        selectOnlyPage.page.getByText('此邀請未開放送出挑片。'),
      ).toHaveCount(0);
      await expect(
        selectOnlyPage.page.getByRole('button', {
          name: '送出挑片',
          exact: true,
        }),
      ).toHaveCount(0);
      const firstPick = selectOnlyPage.page
        .getByRole('list', { name: '相簿照片列表' })
        .getByRole('checkbox')
        .first();
      await firstPick.click();
      await expect(firstPick).toBeChecked();
      assert.ok(
        selectOnlyPage.observations.selectionReads.every(
          (read) => read.canSubmit === false,
        ),
      );
    } finally {
      await selectOnlyPage.context.close();
    }
  } finally {
    await browser.close();
  }
}
