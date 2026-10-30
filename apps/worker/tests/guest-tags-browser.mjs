import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';

function guestCookieName(baseUrl) {
  return new URL(baseUrl).protocol === 'https:'
    ? '__Host-kino_guest'
    : 'kino_guest';
}

function guestSessionHash(secret) {
  return createHash('sha256')
    .update('kino-pic:guest-session:v1:' + secret)
    .digest('hex');
}

async function createSiblingGuest(db, guestId) {
  const identity = await db
    .prepare('SELECT invite_id FROM guest_identities WHERE id=?')
    .bind(guestId)
    .first();
  assert.ok(identity, 'The browser Guest identity exists in D1');

  const siblingGuestId = randomUUID();
  const sessionId = randomUUID();
  const secret = randomBytes(32).toString('hex');
  await db
    .prepare(
      'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
    )
    .bind(
      siblingGuestId,
      identity.invite_id,
      'Synthetic switched browser Guest',
    )
    .run();
  await db
    .prepare(
      'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
    )
    .bind(
      sessionId,
      identity.invite_id,
      siblingGuestId,
      guestSessionHash(secret),
      Date.now() + 15 * 60 * 1000,
    )
    .run();
  return { guestId: siblingGuestId, secret };
}

function createGuestTagsBrowser({
  browser,
  worker,
  baseUrl,
  albumId,
  guestSecret,
}) {
  return (async () => {
    const secure = new URL(baseUrl).protocol === 'https:';
    const cookieName = guestCookieName(baseUrl);
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await context.addCookies([
      {
        name: cookieName,
        value: guestSecret,
        url: baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
        secure,
      },
    ]);
    const page = await context.newPage();
    const observations = {
      capabilitiesReads: 0,
      accessReads: 0,
      accessGuestIds: [],
      galleryPages: [],
      tagBatches: [],
      tagPages: [],
      mutations: [],
      assetResponses: [],
      droppedResponses: 0,
      bridgeErrors: [],
      pageErrors: [],
    };
    let dropNextTagResponse = false;

    page.on('pageerror', (error) =>
      observations.pageErrors.push(error.message),
    );

    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      const method = incoming.method();
      const headers = await incoming.allHeaders();
      headers['cf-connecting-ip'] = '198.51.100.91';
      const init = { method, headers, redirect: 'manual' };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = incoming.postDataBuffer() ?? undefined;
      }

      let response;
      try {
        response = await worker.fetch(new Request(incoming.url(), init));
      } catch (error) {
        observations.bridgeErrors.push(
          error instanceof Error ? error.message : String(error),
        );
        await route.abort('failed');
        return;
      }
      const responseBody = Buffer.from(await response.arrayBuffer());
      const responseHeaders = Object.fromEntries(response.headers.entries());
      const status = response.status;
      const readJsonBody = () => {
        try {
          return JSON.parse(responseBody.toString('utf8'));
        } catch {
          return null;
        }
      };

      if (method === 'GET' && url.pathname === '/api/guest/tags/capabilities') {
        observations.capabilitiesReads += 1;
      }
      if (
        method === 'GET' &&
        url.pathname === '/api/guest/albums/' + albumId + '/access'
      ) {
        observations.accessReads += 1;
        observations.accessGuestIds.push(
          readJsonBody()?.access?.guestId ?? null,
        );
      }
      if (
        method === 'GET' &&
        url.pathname === '/api/guest/albums/' + albumId + '/photos' &&
        response.ok
      ) {
        const body = readJsonBody();
        if (Array.isArray(body?.photos)) {
          observations.galleryPages.push(body.photos);
        }
      }
      if (
        method === 'GET' &&
        url.pathname === '/api/guest/albums/' + albumId + '/tags'
      ) {
        observations.tagBatches.push(url.searchParams.getAll('photoId'));
        if (response.ok) observations.tagPages.push(readJsonBody());
      }

      const assetMatch =
        method === 'GET' &&
        /^\/api\/guest\/photos\/[^/]+\/versions\/[^/]+\/assets\/(thumbnail|preview)$/.exec(
          url.pathname,
        );
      if (assetMatch) {
        observations.assetResponses.push({
          kind: assetMatch[1],
          status,
          contentType: response.headers.get('content-type'),
          byteLength: responseBody.byteLength,
          pathname: url.pathname,
        });
      }

      const isTagMutation =
        method === 'PUT' &&
        url.pathname.startsWith('/api/guest/albums/' + albumId + '/photos/') &&
        url.pathname.endsWith('/tags');
      if (isTagMutation) {
        observations.mutations.push({
          pathname: url.pathname,
          body: incoming.postData() ?? '',
          status,
        });
        if (dropNextTagResponse) {
          assert.equal(
            status,
            200,
            'The Worker committed before the response was lost',
          );
          dropNextTagResponse = false;
          observations.droppedResponses += 1;
          await route.abort('failed');
          return;
        }
      }

      await route.fulfill({
        status,
        headers: responseHeaders,
        body: responseBody,
      });
    });

    return {
      context,
      page,
      observations,
      dropNextTagResponse() {
        assert.equal(
          dropNextTagResponse,
          false,
          'Only one lost response fixture is armed at a time',
        );
        dropNextTagResponse = true;
      },
      async switchGuest(secret) {
        await context.addCookies([
          {
            name: cookieName,
            value: secret,
            url: baseUrl,
            httpOnly: true,
            sameSite: 'Lax',
            secure,
          },
        ]);
      },
    };
  })();
}

function photoCard(page, photo) {
  const list = page.getByRole('list', { name: '相簿照片列表' });
  const button = list.getByRole('button', {
    name: '檢視大圖 ' + photo.filename,
    exact: true,
  });
  return button.locator('xpath=ancestor::li[1]');
}

function findPhotoInObservations(observations, photoId) {
  for (
    let index = observations.galleryPages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const photo = observations.galleryPages[index].find(
      (item) => item.id === photoId,
    );
    if (photo) return photo;
  }
  return null;
}

async function findPhotoCard(page, observations, photoId, versionId) {
  for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
    const photo = findPhotoInObservations(observations, photoId);
    if (photo) {
      assert.equal(
        photo.versionId,
        versionId,
        'The browser gallery displays the expected logical photo version',
      );
      const card = photoCard(page, photo);
      if ((await card.count()) === 1) return { card, photo };
    }

    const nextPage = page.getByRole('button', {
      name: '載入下一頁照片',
    });
    if ((await nextPage.count()) === 0 || (await nextPage.isDisabled())) break;
    const previousPageCount = observations.galleryPages.length;
    await nextPage.click();
    await expect
      .poll(() => observations.galleryPages.length)
      .toBeGreaterThan(previousPageCount);
  }
  assert.fail('The target photo appears in the authorized Guest gallery');
}

async function assertNoMobileOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth,
    'Guest tags overflow the 375px viewport',
  );
}

function latestTagState(observations, targetGuestId, photoId) {
  for (let index = observations.tagPages.length - 1; index >= 0; index -= 1) {
    const page = observations.tagPages[index];
    if (page?.guestId !== targetGuestId) continue;
    const state = page.items?.find((item) => item.photoId === photoId);
    if (state) return state;
  }
  return null;
}

async function writeGuestTag({
  worker,
  baseUrl,
  albumId,
  photoId,
  guestSecret,
  body,
}) {
  const origin = new URL(baseUrl).origin;
  const response = await worker.fetch(
    new Request(
      new URL(
        '/api/guest/albums/' + albumId + '/photos/' + photoId + '/tags',
        baseUrl,
      ),
      {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: guestCookieName(baseUrl) + '=' + guestSecret,
          Origin: origin,
          'CF-Connecting-IP': '198.51.100.91',
        },
        body: JSON.stringify(body),
        redirect: 'manual',
      },
    ),
  );
  const result = await response.json();
  return { status: response.status, result };
}

async function countAddEvents(db, guestId, albumId, photoId, requestId) {
  const row = await db
    .prepare(
      "SELECT count(*) AS n FROM audit_events WHERE actor_type='guest' AND actor_id=? AND album_id=? AND photo_id=? AND request_id=? AND action='tag.added'",
    )
    .bind(guestId, albumId, photoId, requestId)
    .first();
  return row?.n ?? 0;
}

async function assertImageLoaded(imageLocator, kind, observations) {
  await expect
    .poll(() =>
      imageLocator.evaluate(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      observations.assetResponses.some(
        (response) =>
          response.kind === kind &&
          response.status === 200 &&
          response.contentType?.startsWith('image/jpeg') &&
          response.byteLength > 0,
      ),
    )
    .toBe(true);
}

export async function runGuestTagsBrowserChecks({
  worker,
  baseUrl,
  albumId,
  photoId,
  versionId,
  guestSecret,
  guestId,
  db,
}) {
  const browser = await chromium.launch({ headless: true });
  let browserState;
  try {
    browserState = await createGuestTagsBrowser({
      browser,
      worker,
      baseUrl,
      albumId,
      guestSecret,
    });
    const { page, observations } = browserState;
    await page.goto(baseUrl + '/guest/albums/' + albumId, {
      waitUntil: 'networkidle',
    });
    await expect(page.getByRole('heading', { name: /客戶挑片/ })).toBeVisible();

    const { card, photo } = await findPhotoCard(
      page,
      observations,
      photoId,
      versionId,
    );
    await card.scrollIntoViewIfNeeded();
    const photoList = page.getByRole('list', { name: '相簿照片列表' });
    const thumbnailButton = photoList.getByRole('button', {
      name: '檢視大圖 ' + photo.filename,
      exact: true,
    });
    await assertImageLoaded(
      thumbnailButton.getByRole('img', { name: photo.filename }),
      'thumbnail',
      observations,
    );

    assert.equal(observations.capabilitiesReads >= 1, true);
    assert.equal(observations.accessReads >= 1, true);
    assert.equal(observations.accessGuestIds.at(-1), guestId);
    assert.ok(
      observations.tagBatches.some((batch) => batch.includes(photoId)),
      'The browser read state for the fixture photo',
    );
    for (const batch of observations.tagBatches) {
      assert.ok(batch.length >= 1 && batch.length <= 24);
      assert.equal(new Set(batch).size, batch.length);
    }
    const initialState = latestTagState(observations, guestId, photoId);
    assert.ok(initialState, 'The Guest tag read includes the target photo');
    assert.deepEqual(initialState.tags, []);

    const gridTags = card.getByRole('region', { name: '訪客標籤' });
    await expect(gridTags).toBeVisible();
    const gridInput = gridTags.getByLabel('新增標籤');
    const gridLabel = 'grid-tag-' + randomUUID().slice(0, 8);
    await gridInput.fill(gridLabel);
    await gridTags.getByRole('button', { name: '新增', exact: true }).click();
    await expect(gridTags.getByText(gridLabel, { exact: true })).toBeVisible();
    assert.ok(
      latestTagState(observations, guestId, photoId)?.tags.some(
        (tag) => tag.label === gridLabel && tag.versionId === versionId,
      ),
      'The committed Grid tag is re-read from the Worker',
    );

    await thumbnailButton.click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toBeVisible();
    const lightboxTags = dialog.getByRole('region', { name: '訪客標籤' });
    await expect(
      lightboxTags.getByText(gridLabel, { exact: true }),
    ).toBeVisible();
    await assertImageLoaded(
      dialog.locator('img').last(),
      'preview',
      observations,
    );
    await lightboxTags
      .getByRole('button', { name: '移除標籤 ' + gridLabel, exact: true })
      .click();
    await expect(
      lightboxTags.getByText(gridLabel, { exact: true }),
    ).toHaveCount(0);
    await dialog.getByRole('button', { name: '關閉預覽' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(gridTags.getByText(gridLabel, { exact: true })).toHaveCount(0);

    const lightboxLabel = 'lightbox-tag-' + randomUUID().slice(0, 8);
    await thumbnailButton.click();
    const secondDialog = page.getByRole('dialog').last();
    const secondLightboxTags = secondDialog.getByRole('region', {
      name: '訪客標籤',
    });
    await secondLightboxTags.getByLabel('新增標籤').fill(lightboxLabel);
    await secondLightboxTags
      .getByRole('button', { name: '新增', exact: true })
      .click();
    await expect(
      secondLightboxTags.getByText(lightboxLabel, { exact: true }),
    ).toBeVisible();
    await secondDialog.getByRole('button', { name: '關閉預覽' }).click();
    await expect(
      gridTags.getByText(lightboxLabel, { exact: true }),
    ).toBeVisible();
    await gridTags
      .getByRole('button', {
        name: '移除標籤 ' + lightboxLabel,
        exact: true,
      })
      .click();
    await expect(
      gridTags.getByText(lightboxLabel, { exact: true }),
    ).toHaveCount(0);
    await thumbnailButton.click();
    const thirdDialog = page.getByRole('dialog').last();
    const thirdLightboxTags = thirdDialog.getByRole('region', {
      name: '訪客標籤',
    });
    await expect(
      thirdLightboxTags.getByText(lightboxLabel, { exact: true }),
    ).toHaveCount(0);
    await thirdDialog.getByRole('button', { name: '關閉預覽' }).click();

    const retryLabel = 'retry-tag-' + randomUUID().slice(0, 8);
    const retryMutationStart = observations.mutations.length;
    browserState.dropNextTagResponse();
    await gridInput.fill(retryLabel);
    await gridTags.getByRole('button', { name: '新增', exact: true }).click();
    await expect(
      gridTags.getByText('標籤操作結果尚未確認。請重試完全相同的操作。'),
    ).toBeVisible();
    assert.equal(observations.droppedResponses, 1);
    assert.equal(observations.mutations.length, retryMutationStart + 1);
    const firstRetryMutation = observations.mutations[retryMutationStart];
    const retryBody = JSON.parse(firstRetryMutation.body);
    assert.equal(firstRetryMutation.status, 200);
    assert.equal(retryBody.expectedGuestId, guestId);
    assert.equal(retryBody.versionId, versionId);
    assert.equal(retryBody.label, retryLabel);
    assert.equal(retryBody.present, true);
    assert.equal(
      await countAddEvents(db, guestId, albumId, photoId, retryBody.requestId),
      1,
    );

    await gridTags
      .getByRole('button', { name: '重試相同標籤操作', exact: true })
      .click();
    await expect(gridTags.getByText(retryLabel, { exact: true })).toBeVisible();
    assert.equal(observations.mutations.length, retryMutationStart + 2);
    assert.equal(
      observations.mutations[retryMutationStart + 1].body,
      firstRetryMutation.body,
      'Retry preserves the exact request ID and body',
    );
    assert.equal(observations.mutations[retryMutationStart + 1].status, 200);
    assert.equal(
      await countAddEvents(db, guestId, albumId, photoId, retryBody.requestId),
      1,
      'Successful replay creates no duplicate audit event',
    );
    await gridTags
      .getByRole('button', {
        name: '移除標籤 ' + retryLabel,
        exact: true,
      })
      .click();
    await expect(gridTags.getByText(retryLabel, { exact: true })).toHaveCount(
      0,
    );

    const capacityLabels = Array.from(
      { length: 19 },
      (_, index) =>
        'capacity-seed-' + (index + 1) + '-' + randomUUID().slice(0, 6),
    );
    for (const label of capacityLabels) {
      const seeded = await writeGuestTag({
        worker,
        baseUrl,
        albumId,
        photoId,
        guestSecret,
        body: {
          requestId: randomUUID(),
          expectedGuestId: guestId,
          versionId,
          label,
          present: true,
        },
      });
      assert.equal(seeded.status, 200);
    }

    await page.reload({ waitUntil: 'networkidle' });
    const { card: capacityCard } = await findPhotoCard(
      page,
      observations,
      photoId,
      versionId,
    );
    const capacityTags = capacityCard.getByRole('region', {
      name: '訪客標籤',
    });
    const capacityInput = capacityTags.getByLabel('新增標籤');
    const tagList = capacityTags.getByRole('list', {
      name: '此照片的標籤',
    });
    await expect(tagList.getByRole('listitem')).toHaveCount(19);
    await expect(capacityTags.getByText('19/20 個標籤')).toBeVisible();

    const twentiethLabel = 'capacity-external-' + randomUUID().slice(0, 8);
    const externallyAdded = await writeGuestTag({
      worker,
      baseUrl,
      albumId,
      photoId,
      guestSecret,
      body: {
        requestId: randomUUID(),
        expectedGuestId: guestId,
        versionId,
        label: twentiethLabel,
        present: true,
      },
    });
    assert.equal(externallyAdded.status, 200);

    const staleLimitLabel = 'stale-limit-' + randomUUID().slice(0, 8);
    await capacityInput.fill(staleLimitLabel);
    await capacityTags
      .getByRole('button', { name: '新增', exact: true })
      .click();
    await expect(
      capacityTags.getByText(
        '此照片已達標籤上限；請重新載入目前標籤後再操作。',
      ),
    ).toBeVisible();
    assert.equal(observations.mutations.at(-1)?.status, 409);
    await capacityTags
      .getByRole('button', { name: '重新載入標籤', exact: true })
      .click();
    await expect(tagList.getByRole('listitem')).toHaveCount(20);
    await expect(capacityTags.getByText('20/20 個標籤')).toBeVisible();
    await expect(
      capacityTags.getByRole('button', {
        name: '移除標籤 ' + capacityLabels[0],
        exact: true,
      }),
    ).toBeEnabled();

    await assertNoMobileOverflow(page);
    await page.screenshot({
      path: '.local/guest-tags-mobile.png',
      fullPage: true,
    });

    await capacityTags
      .getByRole('button', {
        name: '移除標籤 ' + capacityLabels[0],
        exact: true,
      })
      .click();
    await expect(tagList.getByRole('listitem')).toHaveCount(19);
    const freedSlotLabel = 'capacity-freed-' + randomUUID().slice(0, 8);
    await capacityInput.fill(freedSlotLabel);
    await capacityTags
      .getByRole('button', { name: '新增', exact: true })
      .click();
    await expect(
      capacityTags.getByText(freedSlotLabel, { exact: true }),
    ).toBeVisible();
    await capacityTags
      .getByRole('button', {
        name: '移除標籤 ' + freedSlotLabel,
        exact: true,
      })
      .click();
    await expect(
      capacityTags.getByText(freedSlotLabel, { exact: true }),
    ).toHaveCount(0);

    const switchedLabel = 'identity-tag-' + randomUUID().slice(0, 8);
    const switchedMutationStart = observations.mutations.length;
    browserState.dropNextTagResponse();
    await gridInput.fill(switchedLabel);
    await gridTags.getByRole('button', { name: '新增', exact: true }).click();
    await expect(
      gridTags.getByText('標籤操作結果尚未確認。請重試完全相同的操作。'),
    ).toBeVisible();
    const firstSwitchedMutation = observations.mutations[switchedMutationStart];
    const switchedBody = JSON.parse(firstSwitchedMutation.body);
    assert.equal(firstSwitchedMutation.status, 200);
    assert.equal(switchedBody.expectedGuestId, guestId);

    const sibling = await createSiblingGuest(db, guestId);
    await browserState.switchGuest(sibling.secret);
    await gridTags
      .getByRole('button', { name: '重試相同標籤操作', exact: true })
      .click();
    await expect(gridTags.getByText(/此操作仍綁定原訪客身分/)).toBeVisible();
    assert.equal(observations.mutations.length, switchedMutationStart + 2);
    const deniedRetry = observations.mutations[switchedMutationStart + 1];
    assert.equal(deniedRetry.status, 401);
    assert.equal(
      deniedRetry.body,
      firstSwitchedMutation.body,
      'A switched cookie does not remap the pending Guest identity or request body',
    );
    assert.equal(
      await countAddEvents(
        db,
        guestId,
        albumId,
        photoId,
        switchedBody.requestId,
      ),
      1,
      'The original commit remains exactly one append-only event',
    );

    // Verify the live pending-intent guard independently of CDP reload semantics.
    assert.equal(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
      true,
    );
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }),
      page.waitForEvent('dialog').then(async (dialogEvent) => {
        assert.equal(dialogEvent.type(), 'beforeunload');
        await dialogEvent.accept();
      }),
      page.evaluate(() => {
        window.location.reload();
      }),
    ]);
    await expect(
      page.getByRole('list', { name: '相簿照片列表' }),
    ).toBeVisible();
    await expect
      .poll(() => observations.accessGuestIds.at(-1))
      .toBe(sibling.guestId);
    const { card: siblingCard } = await findPhotoCard(
      page,
      observations,
      photoId,
      versionId,
    );
    assert.equal(observations.accessGuestIds.at(-1), sibling.guestId);
    const siblingState = latestTagState(observations, sibling.guestId, photoId);
    assert.ok(siblingState, 'The switched Guest receives its own tag state');
    assert.deepEqual(
      siblingState.tags,
      [],
      'The switched Guest reads only its own empty tag state',
    );
    assert.equal(
      JSON.stringify(
        observations.tagPages.filter(
          (pageData) => pageData.guestId === sibling.guestId,
        ),
      ).includes(switchedLabel),
      false,
      'The switched Guest API response does not include the original Guest label',
    );
    await expect(page.getByText(switchedLabel, { exact: true })).toHaveCount(0);
    await expect(
      siblingCard
        .getByRole('region', { name: '訪客標籤' })
        .getByText(switchedLabel, { exact: true }),
    ).toHaveCount(0);
    assert.equal(
      page.url().includes(guestSecret),
      false,
      'The Guest session secret never enters the URL',
    );
    const browserStorage = await page.evaluate(() =>
      JSON.stringify({
        localStorage: Object.keys(localStorage).map((key) => [
          key,
          localStorage.getItem(key),
        ]),
        sessionStorage: Object.keys(sessionStorage).map((key) => [
          key,
          sessionStorage.getItem(key),
        ]),
      }),
    );
    assert.equal(browserStorage.includes(guestSecret), false);

    assert.deepEqual(observations.bridgeErrors, []);
    assert.deepEqual(observations.pageErrors, []);
  } finally {
    if (browserState) await browserState.context.close();
    await browser.close();
  }
}
