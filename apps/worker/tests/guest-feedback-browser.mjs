import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function ownerCookieHeader(ownerCookie) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/.exec(ownerCookie);
  return 'kino-owner.session_token=' + (match?.[1] ?? ownerCookie);
}

async function issueFeedbackInvite({
  worker,
  base,
  ownerCookie,
  projectId,
  albumId,
  canRate,
  canFavorite,
}) {
  const input = {
    requestId: randomUUID(),
    albumIds: [albumId],
    accessMode: 'link_only',
    permissions: {
      can_view: true,
      can_download_preview: false,
      can_download_original: false,
      can_select: false,
      can_rate: canRate,
      can_favorite: canFavorite,
      can_tag: false,
      can_annotate: false,
      can_comment: false,
      can_submit: false,
      can_view_own_history: false,
      can_compare_versions: false,
    },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    maxUses: 1,
  };
  const response = await worker.fetch(
    new Request(new URL('/api/v1/projects/' + projectId + '/invites', base), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Cookie: ownerCookieHeader(ownerCookie),
        Origin: new URL(base).origin,
        'CF-Connecting-IP': '203.0.113.240',
      },
      body: JSON.stringify(input),
      redirect: 'manual',
    }),
  );
  assert.equal(
    response.status,
    200,
    'synthetic feedback invite issuance succeeds',
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

async function exchangeFeedbackInvite({ worker, base, invite, address }) {
  const response = await worker.fetch(
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
        displayName: 'Synthetic feedback visitor',
      }),
      redirect: 'manual',
    }),
  );
  assert.equal(
    response.status,
    200,
    'synthetic feedback Guest exchange succeeds',
  );
  const cookieLines =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  const setCookie = cookieLines.find((value) =>
    /(?:^|;\s*)(?:__Host-)?kino_guest=/.test(value),
  );
  assert.ok(setCookie, 'Guest exchange returns a scoped session cookie');
  const match = /(?:^|;\s*)((?:__Host-)?kino_guest)=([^;]+)/.exec(setCookie);
  assert.ok(match, 'Guest session cookie is parseable');
  return {
    cookieName: match[1],
    cookieValue: decodeURIComponent(match[2]),
    secure: /;\s*secure(?:;|$)/i.test(setCookie),
  };
}

async function ensureFeedbackBrowserPhotos(db, albumId) {
  const source = await db
    .prepare(
      'SELECT p.workspace_id,p.project_id,p.album_id,v.created_by_actor,' +
        'v.source_hash_sha256,v.byte_size,v.mime,v.width,v.height,v.status,' +
        'a.storage_node_id FROM photos p ' +
        'JOIN photo_versions v ON v.photo_id=p.id AND v.version_no=1 ' +
        "JOIN photo_assets a ON a.version_id=v.id AND a.asset_kind='original' " +
        'WHERE p.album_id=? ORDER BY p.created_at,p.id LIMIT 1',
    )
    .bind(albumId)
    .first();
  assert.ok(
    source,
    'The feedback browser fixture needs one synthetic source photo',
  );
  const countRow = await db
    .prepare(
      "SELECT count(*) AS n FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id AND v.version_no=1 JOIN photo_assets a ON a.photo_id=p.id AND a.version_id=v.id AND a.workspace_id=p.workspace_id AND a.asset_kind='original' WHERE p.album_id=?",
    )
    .bind(albumId)
    .first();
  const extraCount = Math.max(0, 25 - countRow.n);
  const statements = [];
  for (let index = 0; index < extraCount; index += 1) {
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
          'feedback-browser-' + (index + 1) + '.jpg',
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
  if (statements.length > 0) await db.batch(statements);
  return Math.max(25, countRow.n);
}

function createFeedbackBrowser({
  browser,
  worker,
  base,
  albumId,
  address,
  cookieName,
  cookieValue,
  cookieSecure,
  dropFirstRatingResponse = false,
}) {
  return (async () => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
        secure: cookieSecure,
      },
    ]);
    const page = await context.newPage();
    const observations = {
      capabilitiesReads: 0,
      accessReads: 0,
      ratingBatches: [],
      staleRatingBatches: 0,
      favoriteBatches: [],
      ratingMutations: [],
      favoriteMutations: [],
      galleryPageSizes: [],
      guestId: null,
      droppedRatingResponse: false,
    };
    let staleRatingBody = null;
    let serveStaleRatingBatch = false;
    let nextRatingResponseGate = null;

    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      const method = incoming.method();
      const headers = await incoming.allHeaders();
      headers['cf-connecting-ip'] = address;
      const init = { method, headers, redirect: 'manual' };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = incoming.postDataBuffer() ?? undefined;
      }
      const response = await worker.fetch(new Request(incoming.url(), init));
      // Materialize once before delayed delivery; never share a consumable body
      // between observations, stale-response fixtures and the route response.
      const responseBody = Buffer.from(await response.arrayBuffer());
      const readJsonBody = () => {
        try {
          return JSON.parse(responseBody.toString('utf8'));
        } catch {
          return null;
        }
      };

      if (
        url.pathname === '/api/guest/feedback/capabilities' &&
        method === 'GET'
      ) {
        observations.capabilitiesReads += 1;
      }
      if (
        url.pathname === '/api/guest/albums/' + albumId + '/access' &&
        method === 'GET'
      ) {
        observations.accessReads += 1;
        const access = readJsonBody();
        observations.guestId = access?.access?.guestId ?? null;
      }
      if (
        url.pathname === '/api/guest/albums/' + albumId + '/photos' &&
        method === 'GET' &&
        response.ok
      ) {
        const pageData = readJsonBody();
        if (pageData?.photos) {
          observations.galleryPageSizes.push(pageData.photos.length);
        }
      }
      if (
        url.pathname === '/api/guest/albums/' + albumId + '/ratings' &&
        method === 'GET'
      ) {
        observations.ratingBatches.push(url.searchParams.getAll('photoId'));
        if (staleRatingBody === null && response.ok) {
          staleRatingBody = Buffer.from(responseBody);
        }
        if (serveStaleRatingBatch && staleRatingBody !== null) {
          serveStaleRatingBatch = false;
          observations.staleRatingBatches += 1;
          await route.fulfill({
            status: 200,
            headers: Object.fromEntries(response.headers.entries()),
            body: staleRatingBody,
          });
          return;
        }
      }
      if (
        url.pathname === '/api/guest/albums/' + albumId + '/favorites' &&
        method === 'GET'
      ) {
        observations.favoriteBatches.push(url.searchParams.getAll('photoId'));
      }
      const isRatingMutation =
        method === 'PUT' &&
        url.pathname.startsWith('/api/guest/albums/' + albumId + '/photos/') &&
        url.pathname.endsWith('/rating');
      const isFavoriteMutation =
        method === 'PUT' &&
        url.pathname.startsWith('/api/guest/albums/' + albumId + '/photos/') &&
        url.pathname.endsWith('/favorite');
      if (isRatingMutation) {
        observations.ratingMutations.push({
          pathname: url.pathname,
          body: incoming.postData() ?? '',
          status: response.status,
        });
      }
      if (isFavoriteMutation) {
        observations.favoriteMutations.push({
          pathname: url.pathname,
          body: incoming.postData() ?? '',
          status: response.status,
        });
      }

      if (
        isRatingMutation &&
        dropFirstRatingResponse &&
        !observations.droppedRatingResponse
      ) {
        assert.equal(response.status, 200);
        observations.droppedRatingResponse = true;
        await route.abort('failed');
        return;
      }

      if (isRatingMutation && nextRatingResponseGate) {
        assert.equal(response.status, 200);
        const gate = nextRatingResponseGate;
        nextRatingResponseGate = null;
        gate.signalReady();
        await gate.released;
      }

      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: responseBody,
      });
    });

    return {
      context,
      page,
      observations,
      delayNextRatingResponse() {
        let signalReady;
        let release;
        const responseReady = new Promise((resolve) => {
          signalReady = resolve;
        });
        const released = new Promise((resolve) => {
          release = resolve;
        });
        nextRatingResponseGate = { signalReady, released };
        return { responseReady, release };
      },
      serveStaleNextRatingBatch() {
        assert.ok(staleRatingBody, 'Initial rating batch body was captured');
        serveStaleRatingBatch = true;
      },
    };
  })();
}

function assertInitialReads(observations, { canRate, canFavorite }) {
  assert.equal(observations.capabilitiesReads, 1);
  // Feedback, downloads, expiry and background activity independently verify access.
  assert.equal(observations.accessReads, 4);
  assert.equal(observations.ratingBatches.length, canRate ? 1 : 0);
  assert.equal(observations.favoriteBatches.length, canFavorite ? 1 : 0);
  for (const batch of observations.ratingBatches) {
    assert.ok(batch.length >= 1 && batch.length <= 24);
    assert.equal(new Set(batch).size, batch.length);
  }
  for (const batch of observations.favoriteBatches) {
    assert.ok(batch.length >= 1 && batch.length <= 24);
    assert.equal(new Set(batch).size, batch.length);
  }
}

async function assertNoMobileOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    'Feedback controls overflow the 375px viewport',
  );
}

async function runRightsScenario({
  browser,
  worker,
  base,
  ownerCookie,
  projectId,
  albumId,
  address,
  canRate,
  canFavorite,
  dropFirstRatingResponse = false,
  photoCount,
  db,
}) {
  const invite = await issueFeedbackInvite({
    worker,
    base,
    ownerCookie,
    projectId,
    albumId,
    canRate,
    canFavorite,
  });
  const guest = await exchangeFeedbackInvite({
    worker,
    base,
    invite,
    address,
  });
  const browserState = await createFeedbackBrowser({
    browser,
    worker,
    base,
    albumId,
    address,
    cookieName: guest.cookieName,
    cookieValue: guest.cookieValue,
    cookieSecure: guest.secure,
    dropFirstRatingResponse,
  });

  try {
    await browserState.page.goto(base + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    await expect(
      browserState.page.getByRole('heading', { name: /Kino Pick.*相簿/ }),
    ).toBeVisible();
    const photoList = browserState.page.getByRole('list', {
      name: '相簿照片列表',
    });
    await expect(photoList.locator('li')).toHaveCount(24);
    assertInitialReads(browserState.observations, { canRate, canFavorite });
    assert.equal(browserState.observations.galleryPageSizes[0], 24);
    await expect(
      browserState.page.getByText(
        '目前未開放挑片。您可以繼續瀏覽照片，並使用畫面提供的其他功能。',
      ),
    ).toHaveCount(0);
    await expect(browserState.page.getByLabel('選片統計與送出列')).toHaveCount(
      0,
    );
    await expect(
      browserState.page.getByRole('checkbox', { name: /選取/ }),
    ).toHaveCount(0);
    await expect(browserState.page.getByText(/選片狀態無法同步/)).toHaveCount(
      0,
    );
    const firstCard = photoList.locator('li').first();
    await firstCard.hover();

    if (canRate) {
      const ratingGroup = firstCard.getByRole('radiogroup', { name: '評分' });
      await expect(ratingGroup).toBeVisible();
      await expect(
        ratingGroup.getByRole('radio', { name: '1 星' }),
      ).toBeVisible();
    } else {
      await expect(firstCard.getByRole('radiogroup')).toHaveCount(0);
    }
    if (canFavorite) {
      await expect(
        firstCard.getByRole('button', { name: '加入收藏', exact: true }),
      ).toBeVisible();
    } else {
      await expect(firstCard.getByRole('button', { name: /收藏/ })).toHaveCount(
        0,
      );
    }

    if (canRate && canFavorite) {
      const row = await db
        .prepare(
          "SELECT p.id FROM photos p JOIN photo_versions v ON v.photo_id=p.id AND v.workspace_id=p.workspace_id AND v.version_no=1 JOIN photo_assets a ON a.photo_id=p.id AND a.version_id=v.id AND a.workspace_id=p.workspace_id AND a.asset_kind='original' WHERE p.album_id=? ORDER BY p.created_at DESC,p.id DESC LIMIT 1",
        )
        .bind(albumId)
        .first();
      assert.ok(row);
      const beforeEvents = await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE actor_type='guest' AND actor_id=? AND album_id=? AND photo_id=? AND action='rating.set'",
        )
        .bind(browserState.observations.guestId, albumId, row.id)
        .first();
      const ratingThree = firstCard.getByRole('radio', { name: '3 星' });
      await ratingThree.click();
      await expect(
        firstCard.getByText('儲存結果尚未確認，請重試相同操作。'),
      ).toBeVisible();
      assert.equal(browserState.observations.droppedRatingResponse, true);
      await firstCard.getByRole('button', { name: '重試相同評分操作' }).click();
      await expect(ratingThree).toBeChecked();
      assert.equal(browserState.observations.ratingMutations.length, 2);
      assert.equal(
        browserState.observations.ratingMutations[0].body,
        browserState.observations.ratingMutations[1].body,
      );
      assert.equal(browserState.observations.ratingMutations[0].status, 200);
      assert.equal(browserState.observations.ratingMutations[1].status, 200);
      const firstBody = JSON.parse(
        browserState.observations.ratingMutations[0].body,
      );
      assert.match(
        firstBody.requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const afterEvents = await db
        .prepare(
          "SELECT count(*) AS n FROM audit_events WHERE actor_type='guest' AND actor_id=? AND album_id=? AND photo_id=? AND action='rating.set'",
        )
        .bind(browserState.observations.guestId, albumId, row.id)
        .first();
      assert.equal(afterEvents.n, beforeEvents.n + 1);

      const delayedRating = browserState.delayNextRatingResponse();
      const fourStars = firstCard.getByRole('radio', { name: '4 星' });
      await fourStars.click();
      await delayedRating.responseReady;
      const batchesBeforeDelayedNextPage =
        browserState.observations.ratingBatches.length;
      await browserState.page
        .getByRole('button', { name: '載入下一頁照片' })
        .click();
      await expect(
        browserState.page.getByText(/張照片 · 第 2 頁/),
      ).toBeVisible();
      await expect
        .poll(() => browserState.observations.ratingBatches.length)
        .toBe(batchesBeforeDelayedNextPage + 1);

      const batchesBeforeReturnToDelayedPage =
        browserState.observations.ratingBatches.length;
      browserState.serveStaleNextRatingBatch();
      await browserState.page
        .getByRole('button', { name: '上一頁照片' })
        .click();
      await expect(
        browserState.page.getByText('24 張照片 · 第 1 頁'),
      ).toBeVisible();
      await expect
        .poll(() => browserState.observations.ratingBatches.length)
        .toBe(batchesBeforeReturnToDelayedPage + 1);
      await expect
        .poll(() => browserState.observations.staleRatingBatches)
        .toBe(1);
      const returnedFirstCard = browserState.page
        .getByRole('list', { name: '相簿照片列表' })
        .locator('li')
        .first();
      const returnedFourStars = returnedFirstCard.getByRole('radio', {
        name: '4 星',
      });
      await expect(returnedFourStars).not.toBeChecked();
      await expect(returnedFourStars).toBeDisabled();

      delayedRating.release();
      await expect(returnedFourStars).toBeChecked();
      await expect(returnedFourStars).toBeEnabled();

      await firstCard.getByRole('button', { name: /檢視大圖/ }).click();
      const dialog = browserState.page.getByRole('dialog').last();
      await expect(
        dialog.getByRole('radiogroup', { name: '評分' }).getByRole('radio', {
          name: '4 星',
        }),
      ).toBeChecked();
      await dialog
        .getByRole('radiogroup', { name: '評分' })
        .getByRole('radio', { name: '5 星' })
        .click();
      await expect(
        dialog
          .getByRole('radiogroup', { name: '評分' })
          .getByRole('radio', { name: '5 星' }),
      ).toBeChecked();
      await dialog.getByRole('button', { name: '清除評分' }).click();
      await expect(
        dialog
          .getByRole('radiogroup', { name: '評分' })
          .getByRole('radio', { name: '5 星' }),
      ).not.toBeChecked();
      await dialog.getByRole('button', { name: '加入收藏' }).click();
      await expect(
        dialog.getByRole('button', { name: '移除收藏' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await dialog.getByRole('button', { name: '移除收藏' }).click();
      await expect(
        dialog.getByRole('button', { name: '加入收藏' }),
      ).toHaveAttribute('aria-pressed', 'false');
      await dialog.getByRole('button', { name: '關閉預覽' }).click();
      await expect(browserState.page.getByRole('dialog')).toHaveCount(0);
      await firstCard.getByRole('radio', { name: '2 星' }).click();
      await expect(
        firstCard.getByRole('radio', { name: '2 星' }),
      ).toBeChecked();
      await firstCard.getByRole('button', { name: '加入收藏' }).click();
      await expect(
        firstCard.getByRole('button', { name: '移除收藏' }),
      ).toHaveAttribute('aria-pressed', 'true');
    } else if (canRate) {
      await firstCard.getByRole('radio', { name: '4 星' }).click();
      await expect(
        firstCard.getByRole('radio', { name: '4 星' }),
      ).toBeChecked();
      await firstCard.getByRole('button', { name: '清除評分' }).click();
      await expect(
        firstCard.getByRole('radio', { name: '4 星' }),
      ).not.toBeChecked();
    } else if (canFavorite) {
      await firstCard.getByRole('button', { name: '加入收藏' }).click();
      await expect(
        firstCard.getByRole('button', { name: '移除收藏' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await firstCard.getByRole('button', { name: '移除收藏' }).click();
      await expect(
        firstCard.getByRole('button', { name: '加入收藏' }),
      ).toHaveAttribute('aria-pressed', 'false');
    }

    await assertNoMobileOverflow(browserState.page);
    if (canRate && canFavorite) {
      await firstCard.scrollIntoViewIfNeeded();
      await browserState.page.screenshot({
        path: '.local/guest-feedback-mobile.png',
      });
    }
    const countsBeforeReload = {
      rating: browserState.observations.ratingBatches.length,
      favorite: browserState.observations.favoriteBatches.length,
    };
    await browserState.page.reload({ waitUntil: 'networkidle' });
    await expect(
      browserState.page.getByRole('heading', { name: /Kino Pick.*相簿/ }),
    ).toBeVisible();
    const reloadedFirstCard = browserState.page
      .getByRole('list', { name: '相簿照片列表' })
      .locator('li')
      .first();
    if (canRate) {
      if (canFavorite) {
        await expect(
          reloadedFirstCard.getByRole('radio', { name: '2 星' }),
        ).toBeChecked();
      } else {
        await expect(
          reloadedFirstCard.getByRole('radio', { name: '1 星' }),
        ).not.toBeChecked();
      }
      assert.equal(
        browserState.observations.ratingBatches.length,
        countsBeforeReload.rating + 1,
      );
    }
    if (canFavorite) {
      if (canRate) {
        await expect(
          reloadedFirstCard.getByRole('button', { name: '移除收藏' }),
        ).toHaveAttribute('aria-pressed', 'true');
      } else {
        await expect(
          reloadedFirstCard.getByRole('button', { name: '加入收藏' }),
        ).toHaveAttribute('aria-pressed', 'false');
      }
      assert.equal(
        browserState.observations.favoriteBatches.length,
        countsBeforeReload.favorite + 1,
      );
    }

    const countsBeforeNextPage = {
      rating: browserState.observations.ratingBatches.length,
      favorite: browserState.observations.favoriteBatches.length,
    };
    await browserState.page
      .getByRole('button', { name: '載入下一頁照片' })
      .click();
    const secondPageSize = Math.min(24, photoCount - 24);
    await expect(
      browserState.page.getByText(secondPageSize + ' 張照片 · 第 2 頁'),
    ).toBeVisible();
    await expect(
      browserState.page
        .getByRole('list', { name: '相簿照片列表' })
        .locator('li'),
    ).toHaveCount(secondPageSize);
    if (canRate) {
      await expect
        .poll(() => browserState.observations.ratingBatches.length)
        .toBe(countsBeforeNextPage.rating + 1);
      assert.equal(
        browserState.observations.ratingBatches.at(-1)?.length,
        secondPageSize,
      );
    }
    if (canFavorite) {
      await expect
        .poll(() => browserState.observations.favoriteBatches.length)
        .toBe(countsBeforeNextPage.favorite + 1);
      assert.equal(
        browserState.observations.favoriteBatches.at(-1)?.length,
        secondPageSize,
      );
    }

    const countsBeforePreviousPage = {
      rating: browserState.observations.ratingBatches.length,
      favorite: browserState.observations.favoriteBatches.length,
    };
    await browserState.page.getByRole('button', { name: '上一頁照片' }).click();
    await expect(
      browserState.page.getByText('24 張照片 · 第 1 頁'),
    ).toBeVisible();
    if (canRate) {
      await expect
        .poll(() => browserState.observations.ratingBatches.length)
        .toBe(countsBeforePreviousPage.rating + 1);
    }
    if (canFavorite) {
      await expect
        .poll(() => browserState.observations.favoriteBatches.length)
        .toBe(countsBeforePreviousPage.favorite + 1);
    }
    if (canRate && canFavorite) {
      const firstCardAfterPaging = browserState.page
        .getByRole('list', { name: '相簿照片列表' })
        .locator('li')
        .first();
      await expect(
        firstCardAfterPaging.getByRole('radio', { name: '2 星' }),
      ).toBeChecked();
      await expect(
        firstCardAfterPaging.getByRole('button', { name: '移除收藏' }),
      ).toHaveAttribute('aria-pressed', 'true');
    }
    await assertNoMobileOverflow(browserState.page);
  } finally {
    await browserState.context.close();
  }
}

export async function runGuestFeedbackBrowserChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  projectId,
  albumId,
  db,
}) {
  const photoCount = await ensureFeedbackBrowserPhotos(db, albumId);
  const browser = await chromium.launch({ headless: true });
  try {
    await runRightsScenario({
      browser,
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      address: '198.51.100.71',
      canRate: true,
      canFavorite: false,
      photoCount,
      db,
    });
    await runRightsScenario({
      browser,
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      address: '198.51.100.72',
      canRate: false,
      canFavorite: true,
      photoCount,
      db,
    });
    await runRightsScenario({
      browser,
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      address: '198.51.100.73',
      canRate: true,
      canFavorite: true,
      dropFirstRatingResponse: true,
      photoCount,
      db,
    });

    const disabledInvite = await issueFeedbackInvite({
      worker,
      base,
      ownerCookie,
      projectId,
      albumId,
      canRate: true,
      canFavorite: true,
    });
    const disabledGuest = await exchangeFeedbackInvite({
      worker,
      base,
      invite: disabledInvite,
      address: '198.51.100.74',
    });
    const disabledState = await createFeedbackBrowser({
      browser,
      worker: disabledWorker,
      base,
      albumId,
      address: '198.51.100.74',
      cookieName: disabledGuest.cookieName,
      cookieValue: disabledGuest.cookieValue,
      cookieSecure: disabledGuest.secure,
    });
    try {
      await disabledState.page.goto(base + '/guest/albums/' + albumId, {
        waitUntil: 'networkidle',
      });
      await expect(
        disabledState.page.getByRole('heading', { name: /Kino Pick.*相簿/ }),
      ).toBeVisible();
      assert.equal(disabledState.observations.capabilitiesReads, 1);
      assert.equal(disabledState.observations.ratingBatches.length, 0);
      assert.equal(disabledState.observations.favoriteBatches.length, 0);
      const firstCard = disabledState.page
        .getByRole('list', { name: '相簿照片列表' })
        .locator('li')
        .first();
      await expect(firstCard.getByRole('radiogroup')).toHaveCount(0);
      await expect(firstCard.getByRole('button', { name: /收藏/ })).toHaveCount(
        0,
      );
      await assertNoMobileOverflow(disabledState.page);
    } finally {
      await disabledState.context.close();
    }
  } finally {
    await browser.close();
  }
}
