import {
  ownerFetch,
  createIndependentActiveAlbum,
  issueTwoUseInvite,
  exchangeFreshGuest,
} from './selection-limit-guest-browser.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function cookieHeader(name, cookie) {
  const prefix = `${name}=`;
  return cookie.startsWith(prefix) ? cookie : `${prefix}${cookie}`;
}

async function workerJson(worker, base, path, { cookie, body } = {}) {
  const response = await worker.fetch(
    new Request(new URL(path, base), {
      method: body === undefined ? 'GET' : 'PUT',
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined
          ? {}
          : {
              'Content-Type': 'application/json',
              Origin: new URL(base).origin,
            }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
  return { response, body: await response.json().catch(() => null) };
}

async function readProjectConfiguration(worker, base, projectId, ownerCookie) {
  const result = await workerJson(
    worker,
    base,
    `/api/v1/projects/${projectId}/selection-policy-configuration`,
    { cookie: cookieHeader('kino-owner.session_token', ownerCookie) },
  );
  assert.equal(result.response.status, 200);
  return result.body;
}

async function setProjectMaximum(
  worker,
  base,
  projectId,
  ownerCookie,
  maximum,
) {
  const current = await readProjectConfiguration(
    worker,
    base,
    projectId,
    ownerCookie,
  );
  const result = await workerJson(
    worker,
    base,
    `/api/v1/projects/${projectId}/selection-policy-configuration`,
    {
      cookie: cookieHeader('kino-owner.session_token', ownerCookie),
      body: {
        requestId: randomUUID(),
        expectedRevision: current.revision,
        minimum: 1,
        maximum,
        confirm: true,
      },
    },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.configuration;
}

async function readAlbumConfiguration(worker, base, albumId, ownerCookie) {
  const result = await workerJson(
    worker,
    base,
    `/api/v1/albums/${albumId}/selection-policy-configuration`,
    { cookie: cookieHeader('kino-owner.session_token', ownerCookie) },
  );
  assert.equal(result.response.status, 200);
  return result.body;
}

async function setAlbumConfiguration(
  worker,
  base,
  albumId,
  ownerCookie,
  configuration,
  minimum,
  maximum,
) {
  const current = await readAlbumConfiguration(
    worker,
    base,
    albumId,
    ownerCookie,
  );
  const body = {
    requestId: randomUUID(),
    expectedAlbumRevision: current.policy.albumRevision,
    expectedProjectRevision: current.policy.projectRevision,
    configuration,
    confirm: true,
    ...(configuration === 'override' ? { minimum, maximum } : {}),
  };
  const result = await workerJson(
    worker,
    base,
    `/api/v1/albums/${albumId}/selection-policy-configuration`,
    {
      cookie: cookieHeader('kino-owner.session_token', ownerCookie),
      body,
    },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.configuration;
}

async function ensureTwentyFivePhotos(db, albumId) {
  const source = await db
    .prepare(
      `SELECT p.workspace_id,p.project_id,p.album_id,v.created_by_actor,v.source_hash_sha256,
        v.byte_size,v.mime,v.width,v.height,v.status,a.storage_node_id
       FROM photos p
       JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1
       JOIN photo_assets a ON a.version_id=v.id AND a.asset_kind='original'
       WHERE p.album_id=? ORDER BY p.created_at,p.id LIMIT 1`,
    )
    .bind(albumId)
    .first();
  assert.ok(source, 'The inheritance browser fixture needs one source photo');

  const visible = await db
    .prepare(
      `SELECT count(*) AS n FROM photos p
       JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1
       JOIN photo_assets a ON a.version_id=v.id AND a.asset_kind='original'
       WHERE p.album_id=?`,
    )
    .bind(albumId)
    .first();
  const statements = [];
  for (let index = visible.n; index < 25; index += 1) {
    const photoId = randomUUID();
    const versionId = randomUUID();
    const assetId = randomUUID();
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
          `inheritance-browser-${index + 1}.jpg`,
        ),
      db
        .prepare(
          `INSERT INTO photo_versions(
            id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,
            source_hash_sha256,byte_size,mime,width,height,status
          ) VALUES(?,?,?,1,NULL,?,?,?,?,?,?,?)`,
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
          `INSERT INTO photo_assets(
            id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,
            object_key,byte_size,mime,checksum_sha256,state
          ) VALUES(?,?,?,?,?,'original',?,?,?,?, 'private')`,
        )
        .bind(
          assetId,
          source.workspace_id,
          photoId,
          versionId,
          source.storage_node_id,
          `${source.workspace_id}/${source.project_id}/${albumId}/${photoId}/original.jpg`,
          source.byte_size,
          source.mime,
          source.source_hash_sha256,
        ),
    );
  }
  if (statements.length > 0) await db.batch(statements);

  const photos = await db
    .prepare(
      `SELECT p.id AS photoId,v.id AS versionId FROM photos p
       JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1
       JOIN photo_assets a ON a.version_id=v.id AND a.asset_kind='original'
       WHERE p.album_id=? ORDER BY p.created_at,p.id LIMIT 25`,
    )
    .bind(albumId)
    .all();
  assert.equal(photos.results.length, 25);
  return photos.results;
}

async function guestSelectionPage(worker, base, albumId, guestCookie, cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return workerJson(
    worker,
    base,
    `/api/guest/albums/${albumId}/selection${query}`,
    { cookie: cookieHeader('kino_guest', guestCookie) },
  );
}

export async function runSelectionPolicyInheritanceBrowserChecks({
  worker,
  base,
  ownerCookie,
  guestCookie,
  albumId,
  projectId,
  guestId,
  db,
}) {
  const guest = cookieHeader('kino_guest', guestCookie);
  const projectBefore = await readProjectConfiguration(
    worker,
    base,
    projectId,
    ownerCookie,
  );
  const projectMaximum = Math.max(30, projectBefore.maxOpenSelectedCount + 5);
  assert.ok(projectMaximum < 99997);
  await setProjectMaximum(worker, base, projectId, ownerCookie, projectMaximum);

  const initialAlbum = await readAlbumConfiguration(
    worker,
    base,
    albumId,
    ownerCookie,
  );
  if (initialAlbum.configuration === 'override') {
    await setAlbumConfiguration(worker, base, albumId, ownerCookie, 'inherit');
  }

  const photos = await ensureTwentyFivePhotos(db, albumId);
  const existing = await db
    .prepare(
      'SELECT photo_id AS photoId FROM guest_selection_state WHERE guest_id=? AND album_id=?',
    )
    .bind(guestId, albumId)
    .all();
  const selected = new Set(existing.results.map((row) => row.photoId));
  for (const photo of photos) {
    if (selected.has(photo.photoId)) continue;
    const result = await workerJson(
      worker,
      base,
      `/api/guest/albums/${albumId}/photos/${photo.photoId}/selection`,
      {
        cookie: guest,
        body: {
          requestId: randomUUID(),
          selected: true,
          versionId: photo.versionId,
        },
      },
    );
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
  }

  const inheritedPage = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
  );
  assert.equal(inheritedPage.response.status, 200);
  assert.equal(inheritedPage.body.selectionPolicy.source, 'project');
  assert.equal(inheritedPage.body.selectionPolicy.maximum, projectMaximum);
  assert.equal(inheritedPage.body.items.length, 24);
  assert.equal(inheritedPage.body.canSubmit, false);
  assert.ok(inheritedPage.body.nextCursor);
  assert.equal(inheritedPage.body.selectedCount, 25);
  const legacyCursorValue = JSON.parse(
    Buffer.from(inheritedPage.body.nextCursor, 'base64url').toString('utf8'),
  );
  delete legacyCursorValue.source;
  delete legacyCursorValue.albumRevision;
  delete legacyCursorValue.projectRevision;
  legacyCursorValue.policyRevision =
    inheritedPage.body.selectionPolicy.revision;
  const legacyCursor = Buffer.from(JSON.stringify(legacyCursorValue)).toString(
    'base64url',
  );
  const authorizedLegacyCursor = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
    legacyCursor,
  );
  assert.equal(authorizedLegacyCursor.response.status, 409);
  assert.equal(authorizedLegacyCursor.body.error.code, 'SELECTION_CHANGED');
  const deniedLegacyCursor = await workerJson(
    worker,
    base,
    `/api/guest/albums/${albumId}/selection?cursor=${encodeURIComponent(legacyCursor)}`,
  );
  assert.equal(deniedLegacyCursor.response.status, 401);
  const malformedCursor = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
    '%%%',
  );
  assert.equal(malformedCursor.response.status, 400);
  assert.equal(malformedCursor.body.error.code, 'INVALID_INPUT');

  const nextProjectMaximum = projectMaximum + 1;
  await setProjectMaximum(
    worker,
    base,
    projectId,
    ownerCookie,
    nextProjectMaximum,
  );
  const staleProjectCursor = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
    inheritedPage.body.nextCursor,
  );
  assert.equal(staleProjectCursor.response.status, 409);
  assert.equal(staleProjectCursor.body.error.code, 'SELECTION_CHANGED');

  await setAlbumConfiguration(
    worker,
    base,
    albumId,
    ownerCookie,
    'override',
    1,
    null,
  );
  const unlimitedPage = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
  );
  assert.equal(unlimitedPage.response.status, 200);
  assert.equal(unlimitedPage.body.selectionPolicy.source, 'album');
  assert.equal(unlimitedPage.body.selectionPolicy.maximum, null);
  const unlimitedCursorValue = JSON.parse(
    Buffer.from(unlimitedPage.body.nextCursor, 'base64url').toString('utf8'),
  );
  assert.equal(Object.hasOwn(unlimitedCursorValue, 'projectRevision'), false);
  const nextUnlimitedMaximum = projectMaximum + 2;
  await setProjectMaximum(
    worker,
    base,
    projectId,
    ownerCookie,
    nextUnlimitedMaximum,
  );
  const stableOverrideCursor = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
    unlimitedPage.body.nextCursor,
  );
  assert.equal(stableOverrideCursor.response.status, 200);
  assert.equal(stableOverrideCursor.body.selectionPolicy.maximum, null);
  assert.equal(stableOverrideCursor.body.selectionPolicy.source, 'album');

  await setAlbumConfiguration(worker, base, albumId, ownerCookie, 'inherit');
  const equalBoundsProjectPage = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
  );
  assert.equal(equalBoundsProjectPage.body.selectionPolicy.source, 'project');
  assert.equal(
    equalBoundsProjectPage.body.selectionPolicy.maximum,
    nextUnlimitedMaximum,
  );
  const projectToAlbum = await setAlbumConfiguration(
    worker,
    base,
    albumId,
    ownerCookie,
    'override',
    1,
    nextUnlimitedMaximum,
  );
  assert.equal(projectToAlbum.policy.source, 'album');
  assert.equal(projectToAlbum.policy.maximum, nextUnlimitedMaximum);
  const projectToAlbumCursor = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
    equalBoundsProjectPage.body.nextCursor,
  );
  assert.equal(projectToAlbumCursor.response.status, 409);
  assert.equal(projectToAlbumCursor.body.error.code, 'SELECTION_CHANGED');

  const equalBoundsAlbumPage = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
  );
  const albumToProject = await setAlbumConfiguration(
    worker,
    base,
    albumId,
    ownerCookie,
    'inherit',
  );
  assert.equal(albumToProject.policy.source, 'project');
  assert.equal(albumToProject.policy.maximum, nextUnlimitedMaximum);
  const albumToProjectCursor = await guestSelectionPage(
    worker,
    base,
    albumId,
    guestCookie,
    equalBoundsAlbumPage.body.nextCursor,
  );
  assert.equal(albumToProjectCursor.response.status, 409);
  assert.equal(albumToProjectCursor.body.error.code, 'SELECTION_CHANGED');

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      {
        name: 'kino_guest',
        value: guestCookie.replace(/^kino_guest=/, ''),
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
        secure: false,
      },
    ]);
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const method = incoming.method();
      const init = {
        method,
        headers: await incoming.allHeaders(),
        redirect: 'manual',
      };
      if (method !== 'GET' && method !== 'HEAD')
        init.body = incoming.postDataBuffer() ?? undefined;
      const response = await worker.fetch(new Request(incoming.url(), init));
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });

    await page.goto(`${base}/guest/albums/${albumId}`, {
      waitUntil: 'networkidle',
    });
    const policy = page.getByTestId('guest-effective-selection-policy');
    await expect(policy).toContainText('本次挑片：');
    await expect(policy).toContainText(`最多 ${nextUnlimitedMaximum} 張`);
    await expect(page.getByText('此邀請未開放送出挑片。')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '送出挑片', exact: true }),
    ).toHaveCount(0);

    const refreshedMaximum = nextUnlimitedMaximum + 1;
    await setProjectMaximum(
      worker,
      base,
      projectId,
      ownerCookie,
      refreshedMaximum,
    );
    await page.getByRole('button', { name: '重新整理挑片狀態與政策' }).click();
    await expect(policy).toContainText(`最多 ${refreshedMaximum} 張`);
    await expect(policy).toContainText('本次挑片：');
    const refreshedPolicy = await guestSelectionPage(
      worker,
      base,
      albumId,
      guestCookie,
    );
    assert.equal(refreshedPolicy.response.status, 200);
    assert.equal(refreshedPolicy.body.selectionPolicy.source, 'project');
    assert.equal(
      refreshedPolicy.body.selectionPolicy.maximum,
      refreshedMaximum,
    );
  } finally {
    await browser.close();
  }
}

export async function runIndependentSelectionPolicyInheritanceChecks({
  worker,
  base,
  ownerCookie,
  db,
  galleryFixture,
}) {
  const workspaceId = galleryFixture.context.workspace.id;
  const created = await ownerFetch({
    worker,
    base,
    ownerCookie,
    path: '/api/v1/projects',
    method: 'POST',
    body: {
      workspaceId,
      name: 'Inheritance isolated project ' + randomUUID(),
      requestId: randomUUID(),
    },
  });
  assert.equal(created.status, 201);
  const project = (await created.json()).project;
  const independentFixture = {
    context: { ...galleryFixture.context, project },
  };
  const { albumId, projectId } = await createIndependentActiveAlbum({
    worker,
    base,
    ownerCookie,
    db,
    galleryFixture: independentFixture,
  });
  const source = await db
    .prepare(
      `SELECT v.created_by_actor,v.source_hash_sha256,v.byte_size,v.mime,v.width,v.height,v.status,a.storage_node_id
     FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1
     JOIN photo_assets a ON a.photo_id=p.id AND a.version_id=v.id AND a.asset_kind='original'
     WHERE p.album_id=? LIMIT 1`,
    )
    .bind(galleryFixture.context.album.id)
    .first();
  assert.ok(source);
  const photoId = randomUUID();
  const versionId = randomUUID();
  await db.batch([
    db
      .prepare(
        'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
      )
      .bind(photoId, workspaceId, projectId, albumId, 'inheritance-seed.jpg'),
    db
      .prepare(
        `INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,
      source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,?,?,?,?,?,?)`,
      )
      .bind(
        versionId,
        workspaceId,
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
        `INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,
      object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,?,'original',?,?,?,?,'private')`,
      )
      .bind(
        randomUUID(),
        workspaceId,
        photoId,
        versionId,
        source.storage_node_id,
        `${workspaceId}/${projectId}/${albumId}/${photoId}/original.jpg`,
        source.byte_size,
        source.mime,
        source.source_hash_sha256,
      ),
  ]);
  const invite = await issueTwoUseInvite({
    worker,
    base,
    ownerCookie,
    projectId,
    albumId,
    canSubmit: false,
  });
  const guest = await exchangeFreshGuest({
    worker,
    base,
    invite,
    albumId,
    address: '198.51.100.116',
    label: 'inheritance',
  });
  await runSelectionPolicyInheritanceBrowserChecks({
    worker,
    base,
    ownerCookie,
    guestCookie: guest.cookieValue,
    albumId,
    projectId,
    guestId: guest.guestId,
    db,
  });
}
