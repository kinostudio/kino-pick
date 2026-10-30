import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
export async function lostInviteResponse({
  worker,
  base,
  ownerCookie,
  projectId,
  input,
}) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: 'kino-owner.session_token',
        value: ownerCookie,
        url: base,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await context.newPage();
    let dropped = false;
    await page.route('**/*', async (route) => {
      const incoming = route.request(),
        method = incoming.method();
      const response = await worker.fetch(
        new Request(incoming.url(), {
          method,
          headers: await incoming.allHeaders(),
          ...(method !== 'GET' && method !== 'HEAD'
            ? { body: incoming.postDataBuffer() ?? undefined }
            : {}),
          redirect: 'manual',
        }),
      );
      if (
        new URL(incoming.url()).pathname ===
          `/api/v1/projects/${projectId}/invites` &&
        method === 'POST' &&
        !dropped
      ) {
        assert.equal(response.status, 200);
        dropped = true;
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await page.goto(base + '/dashboard', { waitUntil: 'networkidle' });
    const create = () =>
      page.evaluate(
        async ({ id, body }) => {
          try {
            const response = await fetch(`/api/v1/projects/${id}/invites`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            return await response.json();
          } catch {
            return null;
          }
        },
        { id: projectId, body: input },
      );
    assert.equal(await create(), null);
    const replay = await create();
    assert.equal(replay.secretAvailable, false);
    assert.ok(!('token' in replay));
    assert.ok(!('generatedPassword' in replay));
    const recovery = await page.evaluate(
      async (id) =>
        await (await fetch(`/api/v1/invites/creation/${id}`)).json(),
      input.requestId,
    );
    assert.deepEqual(recovery, replay);
    await context.close();
    return replay.invite.inviteId;
  } finally {
    await browser.close();
  }
}
