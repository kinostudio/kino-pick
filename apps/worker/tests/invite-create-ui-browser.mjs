import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { activateDraftAlbumFixture } from './activate-album-fixture.mjs';
import { chromium, expect } from '@playwright/test';

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function addOwnerCookie(context, base, ownerCookie) {
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: ownerCookie,
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    },
  ]);
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

async function routeWorker(page, worker, onRequest = () => {}) {
  await page.route('**/*', async (route) => {
    const incoming = route.request();
    onRequest(incoming);
    const response = await worker.fetch(
      new Request(incoming.url(), await requestInit(incoming)),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

async function openInviteForm(page, base, projectId) {
  await page.goto(`${base}/dashboard/projects/${projectId}`, {
    waitUntil: 'domcontentloaded',
  });
  const launcher = page.getByTestId('invite-create-launcher');
  await expect(launcher).toBeVisible();
  await launcher.getByRole('button', { name: '建立邀請', exact: true }).click();
  const dialog = page.getByTestId('invite-create-dialog');
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole('button', {
    name: '建立分享連結',
    exact: true,
  });
  await expect(create).toBeVisible();
  return create;
}

async function openInviteFormFromAlbum(page, base, projectId, albumId) {
  await page.goto(
    base + '/dashboard/projects/' + encodeURIComponent(projectId),
    { waitUntil: 'domcontentloaded' },
  );
  const entry = page.getByTestId('invite-from-album-' + albumId);
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(
    page.getByTestId('invite-preselected-album-' + albumId),
  ).toBeVisible();
  const dialog = page.getByTestId('invite-create-dialog');
  await expect(dialog).toBeVisible();
  const create = dialog.getByRole('button', {
    name: '建立分享連結',
    exact: true,
  });
  await expect(create).toBeVisible();
  return create;
}

async function createActiveDecoyAlbum({
  worker,
  base,
  ownerCookie,
  projectId,
  db,
}) {
  const origin = new URL(base).origin;
  const response = await worker.fetch(
    new Request(
      new URL(
        '/api/v1/projects/' + encodeURIComponent(projectId) + '/albums',
        base,
      ),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Cookie: 'kino-owner.session_token=' + ownerCookie,
          Origin: origin,
        },
        body: JSON.stringify({
          name: 'Invite scope decoy ' + randomUUID(),
          requestId: randomUUID(),
        }),
      },
    ),
  );
  assert.equal(response.status, 201, 'synthetic decoy album is created');
  const result = await response.json();
  const decoy = result.album;
  assert.equal(decoy.projectId, projectId);
  const activation = await activateDraftAlbumFixture(db, decoy.id);
  assert.equal(activation.commandCount, 1);
  return decoy.id;
}

async function assertNoBrowserSecretStorage(page, secrets) {
  const leak = await page.evaluate((values) => {
    const stored = [
      ...Object.values(localStorage),
      ...Object.values(sessionStorage),
    ].join('\n');
    const currentUrl = window.location.href;
    return values.some(
      (value) =>
        value &&
        [value, encodeURIComponent(value)].some(
          (candidate) =>
            stored.includes(candidate) || currentUrl.includes(candidate),
        ),
    );
  }, secrets);
  ensure(
    !leak,
    'A one-time invite secret was persisted in browser storage or the current URL.',
  );
}

async function commandCount(db, requestId) {
  const row = await db
    .prepare(
      'SELECT count(*) AS n FROM invite_creation_commands WHERE request_id=?',
    )
    .bind(requestId)
    .first();
  return row.n;
}

export async function runInviteCreateUiChecks({
  worker,
  disabledWorker,
  base,
  ownerCookie,
  projectId,
  albumId,
  db,
}) {
  const browser = await chromium.launch({ headless: true });
  const attempts = [];
  const recoveryIds = [];
  let dropInviteResponse = false;
  let failNextInviteRetry = false;
  try {
    const decoyAlbumId = await createActiveDecoyAlbum({
      worker,
      base,
      ownerCookie,
      projectId,
      db,
    });
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(context, base, ownerCookie);
    const page = await context.newPage();
    await page.route('**/*', async (route) => {
      const incoming = route.request();
      const url = new URL(incoming.url());
      const method = incoming.method();
      const isCreate =
        method === 'POST' &&
        url.pathname === `/api/v1/projects/${projectId}/invites`;
      const isRecovery =
        method === 'GET' &&
        url.pathname.startsWith('/api/v1/invites/creation/');
      if (isRecovery) recoveryIds.push(url.pathname.split('/').at(-1));

      if (isCreate) {
        const attempt = { body: incoming.postData() ?? '', requestId: '' };
        attempts.push(attempt);
        try {
          attempt.requestId = JSON.parse(attempt.body).requestId;
        } catch {
          throw new Error('The invite form sent an unreadable request body.');
        }
        if (failNextInviteRetry) {
          failNextInviteRetry = false;
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'OWNER_REQUIRED' } }),
          });
          return;
        }
      }
      const response = await worker.fetch(
        new Request(incoming.url(), await requestInit(incoming)),
      );
      if (isCreate) {
        if (dropInviteResponse) {
          dropInviteResponse = false;
          ensure(
            response.status === 200,
            'The synthetic invite response could not be dropped after commit.',
          );
          await route.abort('failed');
          return;
        }
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });

    const create = await openInviteFormFromAlbum(
      page,
      base,
      projectId,
      albumId,
    );
    const inviteDialog = page.getByTestId('invite-create-dialog');
    await expect(inviteDialog).toBeVisible();
    const inviteForm = page.locator('section[aria-label="建立客戶邀請"]');
    await expect(inviteForm).toHaveCount(1);
    await expect(page.getByTestId('invite-album-' + albumId)).toBeChecked();
    await expect(
      page.getByTestId('invite-album-' + decoyAlbumId),
    ).not.toBeChecked();
    const initiallyCheckedAlbumIds = await page
      .locator('input[data-testid^="invite-album-"]:checked')
      .evaluateAll((nodes) =>
        nodes.map((node) =>
          node.getAttribute('data-testid')?.replace('invite-album-', ''),
        ),
      );
    ensure(
      initiallyCheckedAlbumIds.length === 1 &&
        initiallyCheckedAlbumIds[0] === albumId,
      'Opening invite creation from an album must preselect only that album.',
    );
    await mkdir('.local', { recursive: true });
    await page.screenshot({
      path: '.local/invite-create-mobile.png',
      fullPage: true,
    });

    const advancedPermissions = page.getByTestId('invite-advanced-permissions');
    ensure(
      !(await advancedPermissions.evaluate((node) => node.open)),
      'Advanced invite permissions must be collapsed by default.',
    );
    await expect(page.getByTestId('invite-basic-permissions')).toBeVisible();
    await expect(page.getByTestId('invite-permission-can_rate')).toBeHidden();
    const permissionState = await page
      .locator('[data-testid^="invite-permission-"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          name: node
            .getAttribute('data-testid')
            ?.replace('invite-permission-', ''),
          checked: node.checked,
        })),
      );
    ensure(
      permissionState.length === 12,
      'The invite form must show all 12 permission controls.',
    );
    ensure(
      permissionState.every(
        (permission) => permission.checked === (permission.name === 'can_view'),
      ),
      'The invite form must default to view only.',
    );
    await advancedPermissions.locator('summary').click();
    for (const permission of [
      'can_rate',
      'can_favorite',
      'can_tag',
      'can_annotate',
      'can_comment',
      'can_view_own_history',
      'can_compare_versions',
    ]) {
      await expect(
        page.getByTestId('invite-permission-' + permission),
      ).toBeVisible();
    }
    await page.getByTestId('invite-permission-can_rate').check();
    await expect(
      page.getByText('下載預覽（尚未可用）', { exact: true }),
    ).toBeVisible();
    const viewPermission = page.getByTestId('invite-permission-can_view');
    const submitPermission = page.getByTestId('invite-permission-can_submit');
    const selectPermission = page.getByTestId('invite-permission-can_select');
    await viewPermission.uncheck();
    await expect(
      page.getByText(/未授予「查看相簿」時，Guest 相簿頁面無法顯示圖庫/),
    ).toBeVisible();
    ensure(
      !(await submitPermission.isChecked()) &&
        !(await selectPermission.isChecked()),
      'Disabling view must not silently alter selection or submission permissions.',
    );
    await viewPermission.check();
    await submitPermission.check();
    ensure(
      !(await selectPermission.isChecked()),
      'Submitting permission must not implicitly enable selection permission.',
    );
    await page.getByTestId('invite-permission-can_download_preview').check();
    await page.getByTestId(`invite-album-${albumId}`).check();
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.getByTestId('invite-secret-result')).toBeVisible();
    const linkOnlyBody = JSON.parse(attempts.at(-1).body);
    assert.deepEqual(
      linkOnlyBody.albumIds,
      [albumId],
      'the real invite POST must contain only the entry album',
    );
    ensure(
      linkOnlyBody.accessMode === 'link_only',
      'The default access mode must be link only.',
    );
    ensure(
      linkOnlyBody.permissions.can_view &&
        linkOnlyBody.permissions.can_submit &&
        !linkOnlyBody.permissions.can_select &&
        linkOnlyBody.permissions.can_download_preview &&
        linkOnlyBody.permissions.can_rate &&
        !linkOnlyBody.permissions.can_favorite &&
        !linkOnlyBody.permissions.can_tag &&
        !linkOnlyBody.permissions.can_annotate &&
        !linkOnlyBody.permissions.can_comment &&
        !linkOnlyBody.permissions.can_view_own_history &&
        !linkOnlyBody.permissions.can_compare_versions,
      'Independent basic and advanced permission choices were not preserved in the request.',
    );
    const linkOnlyId = attempts.at(-1).requestId;
    ensure(
      (await commandCount(db, linkOnlyId)) === 1,
      'The link-only invite must commit once.',
    );
    const linkOnlyRow = await db
      .prepare(
        `SELECT i.permissions_mask AS permissionsMask,i.access_mode AS accessMode,i.max_uses AS maxUses
         FROM guest_invites i JOIN invite_creation_commands c ON c.invite_id=i.id
         WHERE c.request_id=?`,
      )
      .bind(linkOnlyId)
      .first();
    ensure(
      linkOnlyRow?.permissionsMask === 531 &&
        linkOnlyRow.accessMode === 'link_only' &&
        linkOnlyRow.maxUses === null,
      'The link-only invite did not preserve independent permissions and unlimited uses.',
    );
    const shareHref = await page
      .getByTestId('invite-share-link-0')
      .getAttribute('href');
    ensure(!!shareHref, 'The winning invocation must show one share URL.');
    const shareUrl = new URL(shareHref);
    ensure(
      shareUrl.origin === new URL(base).origin &&
        shareUrl.pathname === `/guest/albums/${albumId}/enter` &&
        shareUrl.search === '' &&
        /^#token=[a-f0-9]{64}$/.test(shareUrl.hash),
      'The share token must be placed only in the URL fragment.',
    );
    const linkToken = shareUrl.hash.slice('#token='.length);
    ensure(
      (await page.getByTestId('invite-generated-password').count()) === 0,
      'Link-only mode must not display a generated password.',
    );
    await assertNoBrowserSecretStorage(page, [linkToken]);
    ensure(
      (await page.evaluate(
        (token) => document.body.innerText.includes(token),
        linkToken,
      )) === false,
      'The token must not be printed as page text.',
    );
    await page.getByRole('button', { name: '再建立一筆邀請' }).click();
    ensure(
      !(await advancedPermissions.evaluate((node) => node.open)) &&
        !(await page.getByTestId('invite-permission-can_rate').isChecked()),
      'A new invite must reset advanced permissions and collapse their section.',
    );
    await page.getByTestId(`invite-album-${albumId}`).check();
    await page.getByTestId('invite-mode-generated_password').check();
    await create.click();
    await expect(page.getByTestId('invite-secret-result')).toBeVisible();
    const generatedBody = JSON.parse(attempts.at(-1).body);
    assert.deepEqual(
      generatedBody.albumIds,
      [albumId],
      'the generated-password POST must retain only the entry album',
    );
    ensure(
      generatedBody.accessMode === 'generated_password' &&
        !Object.hasOwn(generatedBody, 'password'),
      'Generated-password mode must not submit a caller password.',
    );
    const generatedRequestId = attempts.at(-1).requestId;
    ensure(
      (await commandCount(db, generatedRequestId)) === 1,
      'The generated-password invite must commit once.',
    );
    const generatedPassword = await page
      .getByTestId('invite-generated-password')
      .innerText();
    ensure(
      /^[0-9]{5}$/.test(generatedPassword),
      'Generated-password mode must display its one-time generated password.',
    );
    const generatedShareHref = await page
      .getByTestId('invite-share-link-0')
      .getAttribute('href');
    ensure(
      !!generatedShareHref,
      'Generated-password mode must show a share URL.',
    );
    const generatedToken = new URL(generatedShareHref).hash.slice(
      '#token='.length,
    );
    const passwordLinkToggle = page.getByRole('switch', {
      name: '將密碼加入分享連結',
    });
    await expect(passwordLinkToggle).not.toBeChecked();
    await passwordLinkToggle.check();
    const includedPasswordUrl = new URL(
      await page.getByTestId('invite-share-link-0').getAttribute('href'),
    );
    assert.equal(includedPasswordUrl.search, '');
    assert.equal(
      new URLSearchParams(includedPasswordUrl.hash.slice(1)).get('password'),
      generatedPassword,
    );
    await passwordLinkToggle.uncheck();
    assert.equal(
      await page.getByTestId('invite-share-link-0').getAttribute('href'),
      generatedShareHref,
      'Turning the switch off must restore the original token-only link.',
    );
    await assertNoBrowserSecretStorage(page, [
      generatedToken,
      generatedPassword,
    ]);
    const generatedLeaks = await page.evaluate(
      ({ token, password }) => ({
        tokenInText: document.body.innerText.includes(token),
        tokenInUrl: window.location.href.includes(token),
        passwordInStorage: [
          ...Object.values(localStorage),
          ...Object.values(sessionStorage),
        ].some((value) => value.includes(password)),
      }),
      { token: generatedToken, password: generatedPassword },
    );
    ensure(
      !generatedLeaks.tokenInText &&
        !generatedLeaks.tokenInUrl &&
        !generatedLeaks.passwordInStorage,
      'A generated secret leaked into page text, the current URL, or browser storage.',
    );

    await page.getByRole('button', { name: '再建立一筆邀請' }).click();
    const closeDialogForPendingEntry = inviteDialog.getByRole('button', {
      name: '關閉建立客戶邀請',
      exact: true,
    });
    await expect(closeDialogForPendingEntry).toBeEnabled();
    await closeDialogForPendingEntry.click();
    await expect(inviteDialog).not.toBeVisible();
    const targetEntryForPending = page.getByTestId(
      'invite-from-album-' + albumId,
    );
    await expect(targetEntryForPending).toBeEnabled();
    await targetEntryForPending.click();
    await expect(inviteDialog).toBeVisible();
    const currentPreselectedSummary = page.getByTestId(
      'invite-preselected-album-' + albumId,
    );
    await expect(currentPreselectedSummary).toBeVisible();
    await expect(inviteForm).toHaveCount(1);
    const originalPreselectedSummary =
      await currentPreselectedSummary.elementHandle();
    const currentInviteForm = inviteDialog.getByTestId('invite-create');
    await expect(currentInviteForm).toHaveCount(1);
    const originalInviteForm = await currentInviteForm.elementHandle();
    const pendingCreate = currentInviteForm.getByRole('button', {
      name: '建立分享連結',
      exact: true,
    });
    assert.ok(originalPreselectedSummary);
    assert.ok(originalInviteForm);
    await expect(page.getByTestId('invite-album-' + albumId)).toBeChecked();
    await expect(
      page.getByTestId('invite-album-' + decoyAlbumId),
    ).not.toBeChecked();
    await page.getByTestId('invite-mode-custom_password').check();
    const customPassword = '  exact custom-📷 secret  ';
    await page.getByTestId('invite-custom-password').fill(customPassword);
    dropInviteResponse = true;
    await pendingCreate.click();
    await expect(page.getByTestId('invite-uncertain-status')).toBeVisible();
    ensure(
      (await page.getByTestId('invite-secret-result').count()) === 0,
      'The UI must not show secrets before the creation result is confirmed.',
    );
    const pendingPasswordTextLeak = await page.evaluate(
      (password) => document.body.innerText.includes(password),
      customPassword,
    );
    ensure(
      !pendingPasswordTextLeak,
      'The one-time password must not appear as page text while the outcome is unknown.',
    );
    await assertNoBrowserSecretStorage(page, [customPassword]);
    const decoyEntry = page.getByTestId('invite-from-album-' + decoyAlbumId);
    await expect(decoyEntry).toBeEnabled();
    const closeInviteDialog = inviteDialog.getByRole('button', {
      name: '關閉建立客戶邀請',
      exact: true,
    });
    await expect(closeInviteDialog).toBeEnabled();
    const attemptsBeforeEntrySwitch = attempts.length;
    const requestIdBeforeEntrySwitch = attempts.at(-1).requestId;
    await closeInviteDialog.click();
    await expect(inviteDialog).not.toBeVisible();
    await decoyEntry.click();
    await expect(inviteDialog).toBeVisible();
    ensure(
      attempts.length === attemptsBeforeEntrySwitch &&
        attempts.at(-1).requestId === requestIdBeforeEntrySwitch,
      'Switching album entries must not submit another invite or replace its pending request ID.',
    );
    ensure(
      await originalInviteForm.evaluate((node) => node.isConnected),
      'Switching album entries must not unmount the pending invite form.',
    );
    ensure(
      await originalPreselectedSummary.evaluate((node) => node.isConnected),
      'Switching album entries must keep the original preselection mounted.',
    );
    await expect(inviteForm).toHaveCount(1);
    await expect(currentInviteForm).toHaveCount(1);
    await expect(
      currentInviteForm.getByText('正在分享相簿', { exact: true }),
    ).toBeVisible();
    await expect(
      currentInviteForm.getByTestId('invite-uncertain-status'),
    ).toBeVisible();
    await expect(
      currentInviteForm.getByTestId('invite-preselected-album-' + albumId),
    ).toBeVisible();
    await expect(
      currentInviteForm.getByTestId('invite-album-' + albumId),
    ).toBeChecked();
    await expect(
      currentInviteForm.getByTestId('invite-album-' + decoyAlbumId),
    ).not.toBeChecked();
    const passwordAfterEntrySwitch = await page.evaluate(
      (password) => document.body.innerText.includes(password),
      customPassword,
    );
    ensure(
      !passwordAfterEntrySwitch,
      'Switching the album entry must not expose a pending one-time password.',
    );
    await assertNoBrowserSecretStorage(page, [customPassword]);
    const customFirstAttempt = attempts.at(-1);
    ensure(
      customFirstAttempt.requestId === requestIdBeforeEntrySwitch,
      'Reopening the invite modal must retain the pending request ID.',
    );
    const customPayload = JSON.parse(customFirstAttempt.body);
    assert.deepEqual(
      customPayload.albumIds,
      [albumId],
      'the pending invite intent must retain only its original target album',
    );
    ensure(
      customPayload.accessMode === 'custom_password' &&
        customPayload.password === customPassword,
      'Custom-password bytes must be preserved exactly in the submitted intent.',
    );
    ensure(
      attempts.filter(
        (attempt) => attempt.requestId === customFirstAttempt.requestId,
      ).length === 1,
      'Changing the album entry must not submit or replace the pending invite.',
    );
    failNextInviteRetry = true;
    await page.getByRole('button', { name: '重試同一邀請' }).click();
    await expect(
      page.getByText(
        '這次重試未通過，但先前結果仍未確認。原操作已保留；請查詢建立結果或重試同一邀請。',
      ),
    ).toBeVisible();
    await expect(pendingCreate).toBeDisabled();
    const retryPasswordTextLeak = await page.evaluate(
      (password) => document.body.innerText.includes(password),
      customPassword,
    );
    ensure(
      !retryPasswordTextLeak,
      'The one-time password must remain hidden after an unsuccessful retry.',
    );
    await assertNoBrowserSecretStorage(page, [customPassword]);
    ensure(
      (await page.getByRole('button', { name: '再建立一筆邀請' }).count()) ===
        0,
      'A failed retry after an unknown outcome must not offer a new invite intent.',
    );
    const customRetryAttempts = attempts.filter(
      (attempt) => attempt.requestId === customFirstAttempt.requestId,
    );
    ensure(
      customRetryAttempts.length === 2 &&
        customRetryAttempts[0].body === customRetryAttempts[1].body,
      'A retry after an unknown outcome must retain the original request ID and body.',
    );
    ensure(
      (await commandCount(db, customFirstAttempt.requestId)) === 1,
      'A synthetic authorization failure must not create a second invite command.',
    );
    await page.getByRole('button', { name: '查詢建立結果' }).click();
    await expect(page.getByTestId('invite-metadata-result')).toBeVisible();
    ensure(
      recoveryIds.includes(customFirstAttempt.requestId),
      'Metadata recovery must use the original request ID after a retry authorization error.',
    );
    ensure(
      (await commandCount(db, customFirstAttempt.requestId)) === 1,
      'Retry after a committed lost response must not create a duplicate invite.',
    );
    ensure(
      (await page.getByTestId('invite-share-link-0').count()) === 0 &&
        (await page.getByTestId('invite-generated-password').count()) === 0,
      'Metadata-only replay must not return or display one-time secrets.',
    );
    const customFieldValue = await page
      .getByTestId('invite-custom-password')
      .inputValue();
    ensure(
      customFieldValue === '',
      'The custom password field must clear after resolution.',
    );
    const customVisible = await page.evaluate(
      (password) => document.body.innerText.includes(password),
      customPassword,
    );
    ensure(
      !customVisible,
      'The custom password must never be echoed in the UI.',
    );
    await assertNoBrowserSecretStorage(page, [customPassword]);

    await page.getByRole('button', { name: '再建立一筆邀請' }).click();
    await page.getByTestId(`invite-album-${albumId}`).check();
    await page.getByTestId('invite-mode-generated_password').check();
    dropInviteResponse = true;
    await create.click();
    await expect(page.getByTestId('invite-uncertain-status')).toBeVisible();
    const recoveryAttempt = attempts.at(-1);
    await page.getByRole('button', { name: '查詢建立結果' }).click();
    await expect(page.getByTestId('invite-metadata-result')).toBeVisible();
    ensure(
      recoveryIds.includes(recoveryAttempt.requestId),
      'Recovery must query metadata using the original request ID.',
    );
    ensure(
      (await commandCount(db, recoveryAttempt.requestId)) === 1,
      'Recovery after a committed lost response must not create a duplicate invite.',
    );
    ensure(
      (await page.getByTestId('invite-share-link-0').count()) === 0 &&
        (await page.getByTestId('invite-generated-password').count()) === 0,
      'Recovery must remain metadata-only after a lost one-time response.',
    );

    const mobileWidth = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    ensure(mobileWidth, 'Invite creation UI overflows horizontally at 375px.');

    const beforeDisabled = await db
      .prepare('SELECT count(*) AS n FROM invite_creation_commands')
      .first();
    const disabledContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(disabledContext, base, ownerCookie);
    const disabledPage = await disabledContext.newPage();
    let disabledCreateAttempts = 0;
    await routeWorker(disabledPage, disabledWorker, (incoming) => {
      const url = new URL(incoming.url());
      if (
        incoming.method() === 'POST' &&
        url.pathname === `/api/v1/projects/${projectId}/invites`
      )
        disabledCreateAttempts += 1;
    });
    const disabledCreate = await openInviteForm(disabledPage, base, projectId);
    await expect(disabledCreate).toBeDisabled();
    await expect(
      disabledPage.getByText(/尚未開放建立新邀請|訪客登入尚未啟用/),
    ).toBeVisible();
    ensure(
      disabledCreateAttempts === 0,
      'Disabled capability must not submit an invite.',
    );
    const afterDisabled = await db
      .prepare('SELECT count(*) AS n FROM invite_creation_commands')
      .first();
    assert.equal(afterDisabled.n, beforeDisabled.n);
    await disabledContext.close();
    await context.close();
  } finally {
    await browser.close();
  }
}
