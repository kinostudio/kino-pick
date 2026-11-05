import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const HOP_BY_HOP = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const matchingRulesIntentPrefix = 'kino-pic:matching-rules-intent:v1:';
const resolvedUploadJournalPrefix = 'kino-pic:resolved-upload-journal:v1:';
const projectPath = (projectId) =>
  '/api/v1/projects/' + encodeURIComponent(projectId) + '/matching-rules';
const capabilitiesPath = '/api/v1/matching-rules/capabilities';
const mobileScreenshotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.local',
  'matching-rules-mobile.png',
);
const indexScreenshotPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.local',
  'matching-rule-index-mobile.png',
);

function cookieHeader(value) {
  const match = /(?:^|;\s*)kino-owner\.session_token=([^;]+)/u.exec(value);
  const token = match?.[1] ?? value;
  assert.ok(token, 'The browser fixture has an Owner session cookie');
  return 'kino-owner.session_token=' + token;
}

function cookieValue(value) {
  return cookieHeader(value).slice('kino-owner.session_token='.length);
}

function parseJson(bytes) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(4 + body.length + 4);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}

function uniquePng() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const color = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
  const scanline = Buffer.from([0, color[0], color[1], color[2], 255]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanline)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function rulesForProfile(profile) {
  if (profile === 'default-v1')
    return {
      caseSensitive: true,
      allowJpgJpegEquivalence: false,
      stripRecognizedSuffixes: false,
    };
  const match = /^rules-v1-([01])([01])([01])$/u.exec(profile);
  assert.ok(match, 'The fixture profile is a registered matching profile');
  return {
    caseSensitive: match[1] !== '1',
    allowJpgJpegEquivalence: match[2] === '1',
    stripRecognizedSuffixes: match[3] === '1',
  };
}

function profileForRules(rules) {
  const bits =
    (rules.caseSensitive ? '0' : '1') +
    (rules.allowJpgJpegEquivalence ? '1' : '0') +
    (rules.stripRecognizedSuffixes ? '1' : '0');
  return bits === '000' ? 'default-v1' : 'rules-v1-' + bits;
}

function profileSummary(profile) {
  const rules = rulesForProfile(profile);
  return [
    rules.caseSensitive ? '區分大小寫' : '忽略大小寫',
    rules.allowJpgJpegEquivalence
      ? 'JPG 與 JPEG 視為相同'
      : 'JPG 與 JPEG 分開比對',
    rules.stripRecognizedSuffixes ? '忽略一個已知檔名後綴' : '保留檔名後綴',
  ].join('、');
}

function previewProfileSummary(profile) {
  const rules = rulesForProfile(profile);
  return [
    rules.caseSensitive ? '區分大小寫' : '忽略大小寫',
    rules.allowJpgJpegEquivalence ? '合併 JPG 與 JPEG' : '區分 JPG 與 JPEG',
    rules.stripRecognizedSuffixes ? '忽略一個已知結尾後綴' : '保留檔名後綴',
  ].join('；');
}

function anotherProfile(...excluded) {
  const excludedSet = new Set(excluded);
  return [
    'default-v1',
    'rules-v1-001',
    'rules-v1-010',
    'rules-v1-011',
    'rules-v1-100',
    'rules-v1-101',
    'rules-v1-110',
    'rules-v1-111',
  ].find((profile) => !excludedSet.has(profile));
}

function anotherNonDefaultProfile(...excluded) {
  const excludedSet = new Set(excluded);
  return [
    'rules-v1-001',
    'rules-v1-010',
    'rules-v1-011',
    'rules-v1-100',
    'rules-v1-101',
    'rules-v1-110',
    'rules-v1-111',
  ].find((profile) => !excludedSet.has(profile));
}

async function incomingBody(incoming) {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function addOwnerCookie(context, origin, ownerCookie) {
  await context.addCookies([
    {
      name: 'kino-owner.session_token',
      value: cookieValue(ownerCookie),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
      secure: new URL(origin).protocol === 'https:',
    },
  ]);
}

async function createWorkerProxy(worker, base) {
  const browserOrigin = { value: null };
  const workerOrigin = new URL(base).origin;
  let nextProjectReadHold = null;
  let nextIndexReadHold = null;
  let dropNextSuccessfulRulesResponse = false;
  let blockedRulesResponseRequestId = null;
  let holdBlockedRulesResponses = false;
  let identityOverride = null;
  let closed = false;
  const observations = {
    requests: [],
    capabilities: [],
    projectReads: [],
    projectWrites: [],
    indexReads: [],
    indexWrites: [],
    previewRequests: [],
    reservationRequests: [],
    authorizeAttempts: [],
    pageErrors: [],
    bridgeErrors: [],
  };

  const server = createServer(async (incoming, outgoing) => {
    const parsed = new URL(incoming.url ?? '/', 'http://127.0.0.1');
    const method = incoming.method ?? 'GET';
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        headers.set(
          name,
          Array.isArray(value)
            ? value.join(name === 'cookie' ? '; ' : ', ')
            : value,
        );
      }
      if (browserOrigin.value && headers.get('origin') === browserOrigin.value)
        headers.set('origin', workerOrigin);
      headers.set('cf-connecting-ip', '198.51.100.94');

      const path = parsed.pathname;
      const isRulesApi =
        path === capabilitiesPath ||
        /^\/api\/v1\/projects\/[^/]+\/matching-rules$/u.test(path) ||
        /^\/api\/v1\/albums\/[^/]+\/matching-rule-index$/u.test(path);
      if (identityOverride?.invalidateRulesSession && isRulesApi)
        headers.set('cookie', 'kino-owner.session_token=invalid-session-token');

      const requestBytes = await incomingBody(incoming);
      const requestBody = parseJson(requestBytes);
      const expectedActor = headers.get('x-kino-expected-actor');
      const record = {
        sequence: observations.requests.length + 1,
        method,
        pathname: path,
        search: parsed.search,
        requestText: requestBytes?.toString('utf8') ?? '',
        expectedActor,
        status: 0,
        responseBody: null,
        dropped: false,
        interrupted: false,
      };

      if (
        path.startsWith('/api/v1/uploads/') &&
        path.endsWith('/authorize') &&
        method === 'POST'
      ) {
        record.interrupted = true;
        observations.authorizeAttempts.push(record);
        observations.requests.push(record);
        outgoing.destroy();
        return;
      }

      const response = await worker.fetch(
        new Request(new URL(parsed.pathname + parsed.search, base), {
          method,
          headers,
          ...(requestBytes ? { body: requestBytes } : {}),
          redirect: 'manual',
        }),
      );
      const responseBytes = Buffer.from(await response.arrayBuffer());
      const isSessionIdentity = path === '/api/auth/get-session';
      const responseBody = parseJson(responseBytes);
      let outgoingBytes = responseBytes;
      let outgoingBody = responseBody;

      if (isSessionIdentity && identityOverride) {
        outgoingBody = {
          user: { id: identityOverride.actorId },
          session: { id: identityOverride.sessionId },
        };
        outgoingBytes = Buffer.from(JSON.stringify(outgoingBody), 'utf8');
      }

      record.status = response.status;
      if (!isSessionIdentity) record.responseBody = responseBody;
      observations.requests.push(record);

      if (path === capabilitiesPath && method === 'GET')
        observations.capabilities.push(record);
      if (
        method === 'GET' &&
        /^\/api\/v1\/projects\/[^/]+\/matching-rules$/u.test(path)
      )
        observations.projectReads.push(record);
      if (
        method === 'PUT' &&
        /^\/api\/v1\/projects\/[^/]+\/matching-rules$/u.test(path)
      )
        observations.projectWrites.push(record);
      if (
        method === 'GET' &&
        /^\/api\/v1\/albums\/[^/]+\/matching-rule-index$/u.test(path)
      )
        observations.indexReads.push(record);
      if (
        method === 'POST' &&
        /^\/api\/v1\/albums\/[^/]+\/matching-rule-index$/u.test(path)
      )
        observations.indexWrites.push(record);
      if (
        method === 'POST' &&
        /^\/api\/v1\/albums\/[^/]+\/upload-resolution$/u.test(path)
      )
        observations.previewRequests.push(record);
      if (
        method === 'POST' &&
        /^\/api\/v1\/albums\/[^/]+\/resolved-uploads$/u.test(path)
      )
        observations.reservationRequests.push(record);

      const projectHold =
        method === 'GET' &&
        /^\/api\/v1\/projects\/[^/]+\/matching-rules$/u.test(path)
          ? nextProjectReadHold
          : null;
      if (projectHold) {
        nextProjectReadHold = null;
        projectHold.capture(record);
        await projectHold.releasePromise;
      }
      const indexHold =
        method === 'GET' &&
        /^\/api\/v1\/albums\/[^/]+\/matching-rule-index$/u.test(path)
          ? nextIndexReadHold
          : null;
      if (indexHold) {
        nextIndexReadHold = null;
        indexHold.capture(record);
        await indexHold.releasePromise;
      }

      const isRulesWrite =
        method === 'PUT' &&
        /^\/api\/v1\/projects\/[^/]+\/matching-rules$/u.test(path);
      if (isRulesWrite && response.ok && dropNextSuccessfulRulesResponse) {
        dropNextSuccessfulRulesResponse = false;
        blockedRulesResponseRequestId =
          typeof requestBody?.requestId === 'string'
            ? requestBody.requestId
            : null;
        holdBlockedRulesResponses = blockedRulesResponseRequestId !== null;
      }
      if (
        isRulesWrite &&
        response.ok &&
        holdBlockedRulesResponses &&
        requestBody?.requestId === blockedRulesResponseRequestId
      ) {
        record.dropped = true;
        outgoing.destroy();
        return;
      }

      if (outgoing.destroyed || closed) return;
      const responseHeaders = Object.fromEntries(response.headers.entries());
      for (const name of HOP_BY_HOP) delete responseHeaders[name];
      if (identityOverride && isSessionIdentity)
        responseHeaders['content-type'] = 'application/json; charset=utf-8';
      outgoing.writeHead(response.status, responseHeaders);
      outgoing.end(outgoingBytes);
    } catch (error) {
      if (outgoing.destroyed || closed) return;
      observations.bridgeErrors.push(
        error instanceof Error ? error.message : String(error),
      );
      outgoing.writeHead(502, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
      outgoing.end('Matching rules browser proxy failed');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  browserOrigin.value = 'http://127.0.0.1:' + address.port;

  function makeHold() {
    let capture;
    let release;
    const captured = new Promise((resolve) => {
      capture = resolve;
    });
    const releasePromise = new Promise((resolve) => {
      release = resolve;
    });
    return { capture, release, captured, releasePromise };
  }

  return {
    origin: browserOrigin.value,
    observations,
    holdNextProjectRead() {
      assert.equal(nextProjectReadHold, null);
      nextProjectReadHold = makeHold();
      return {
        captured: nextProjectReadHold.captured,
        release: nextProjectReadHold.release,
      };
    },
    holdNextIndexRead() {
      assert.equal(nextIndexReadHold, null);
      nextIndexReadHold = makeHold();
      return {
        captured: nextIndexReadHold.captured,
        release: nextIndexReadHold.release,
      };
    },
    setIdentityOverride({ actorId, sessionId, invalidateRulesSession = true }) {
      identityOverride = { actorId, sessionId, invalidateRulesSession };
    },
    clearIdentityOverride() {
      identityOverride = null;
    },
    dropNextRulesResponse() {
      assert.equal(blockedRulesResponseRequestId, null);
      dropNextSuccessfulRulesResponse = true;
    },
    releaseDroppedRulesResponses() {
      holdBlockedRulesResponses = false;
      blockedRulesResponseRequestId = null;
    },
    async close() {
      closed = true;
      nextProjectReadHold?.release();
      nextIndexReadHold?.release();
      const done = new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      server.closeAllConnections?.();
      await done;
    },
  };
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
  const headers = new Headers({
    Accept: 'application/json',
    Cookie: cookieHeader(ownerCookie),
    Origin: new URL(base).origin,
    'X-Kino-Expected-Actor': owner,
  });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await worker.fetch(
    new Request(new URL(path, base), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    }),
  );
  const text = await response.text();
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    // Keep only the status and raw response for precise test diagnostics.
  }
  return { response, text, value };
}

async function readMatchingRules(worker, base, ownerCookie, owner, projectId) {
  const result = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    projectPath(projectId),
    'GET',
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.value));
  return result.value;
}

async function writeMatchingProfile(
  worker,
  base,
  ownerCookie,
  owner,
  project,
  profile,
  requestId = randomUUID(),
) {
  const body = {
    requestId,
    expectedProjectRevision: project.projectRevision,
    expectedRuleRevision: project.ruleRevision,
    profile,
    confirm: true,
  };
  const result = await ownerRequest(
    worker,
    base,
    ownerCookie,
    owner,
    projectPath(project.projectId),
    'PUT',
    body,
  );
  return { ...result, body };
}

async function readSessionWithRunner(request, ownerCookie, owner) {
  const response = await request('/api/auth/get-session', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader(ownerCookie),
    },
  });
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value?.user?.id, owner);
  assert.ok(typeof value?.session?.id === 'string');
}

async function assertMobileWidth(page, label) {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(
    widths.scrollWidth <= widths.clientWidth,
    label +
      ' overflows the 375px viewport (' +
      widths.scrollWidth +
      ' > ' +
      widths.clientWidth +
      ')',
  );
}

function countLocator(panel, label) {
  return panel.locator('dl > div').filter({ hasText: label }).locator('dd');
}

async function readSessionIntent(page) {
  return page.evaluate((prefix) => {
    const entries = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix))
        entries.push([key, sessionStorage.getItem(key)]);
    }
    return entries;
  }, matchingRulesIntentPrefix);
}

async function readLostReplyDiagnostic(page, proxy, startIndex) {
  const writes = proxy.observations.projectWrites
    .slice(startIndex)
    .map((record) => {
      let body = null;
      try {
        body = JSON.parse(record.requestText);
      } catch {
        // Do not include raw request bytes in a failure diagnostic.
      }
      return {
        status: record.status,
        dropped: record.dropped,
        requestId: typeof body?.requestId === 'string' ? body.requestId : null,
        profile: typeof body?.profile === 'string' ? body.profile : null,
      };
    });
  const ui = {
    pendingCount: await page
      .getByTestId('matching-rules-pending')
      .count()
      .catch(() => -1),
    retryCount: await page
      .getByTestId('matching-rules-retry')
      .count()
      .catch(() => -1),
  };
  const stored = await page.evaluate((prefix) => {
    const result = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      let envelope = null;
      let body = null;
      try {
        envelope = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        body = JSON.parse(envelope?.bodyJson ?? 'null');
      } catch {
        // Expose only safe metadata below.
      }
      result.push({
        phase: envelope?.phase ?? null,
        requestId: typeof body?.requestId === 'string' ? body.requestId : null,
        profile: typeof body?.profile === 'string' ? body.profile : null,
      });
    }
    return result;
  }, matchingRulesIntentPrefix);
  return { writes, ui, storedIntentCount: stored.length, stored };
}

async function readResolvedUploadJournal(page) {
  return page.evaluate((prefix) => {
    const entries = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix))
        entries.push([key, localStorage.getItem(key)]);
    }
    return entries;
  }, resolvedUploadJournalPrefix);
}

async function openProject(page, proxy, projectId, waitUntil = 'networkidle') {
  const response = await page.goto(
    proxy.origin + '/dashboard/projects/' + encodeURIComponent(projectId),
    { waitUntil },
  );
  assert.equal(response?.status(), 200);
}

async function openProjectSettings(page) {
  const settings = page.locator('details.studio-project-settings');
  await expect(settings).toHaveCount(1);
  if (!(await settings.evaluate((element) => element.open)))
    await settings.locator('summary').click();
}

async function confirmAndReopenSettings(page, button) {
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await button.click();
  await navigation;
  await openProjectSettings(page);
}

function assertHumanProfile(panel, profile) {
  return expect(panel).toContainText(profileSummary(profile));
}

export async function runMatchingRulesBrowserChecks({
  worker,
  defaultWorker,
  base,
  owner,
  cookies,
  db,
  request,
  fixture,
}) {
  assert.ok(worker && defaultWorker && base && owner && cookies && db);
  assert.equal(typeof request, 'function');
  assert.ok(fixture?.project?.id && fixture?.album?.id);
  assert.ok(fixture?.siblingProject?.id);
  const fixtureProfile = fixture?.profile?.profile ?? fixture?.profile?.id;
  assert.ok(fixtureProfile);
  const fixtureRules = fixture.profile.rules ?? rulesForProfile(fixtureProfile);
  assert.ok(
    fixture.project.mode === 'assisted' ||
      fixture.project.mode === 'auto_filename',
    'The real browser fixture must use an active resolver mode',
  );

  const ownerCookie = cookies.headers();
  await readSessionWithRunner(request, ownerCookie, owner);
  const initialConfig = await readMatchingRules(
    worker,
    base,
    ownerCookie,
    owner,
    fixture.project.id,
  );
  assert.equal(initialConfig.projectId, fixture.project.id);
  assert.equal(initialConfig.workspaceId, fixture.workspaceId);
  assert.equal(initialConfig.profile, fixtureProfile);
  assert.deepEqual(initialConfig.rules, fixtureRules);
  assert.equal(initialConfig.mode, fixture.project.mode);

  const browser = await chromium.launch({ headless: true });
  const disabledProxy = await createWorkerProxy(defaultWorker, base);
  const proxy = await createWorkerProxy(worker, base);
  let disabledContext;
  let context;
  let page;

  try {
    disabledContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(disabledContext, disabledProxy.origin, ownerCookie);
    const disabledPage = await disabledContext.newPage();
    page = disabledPage;
    disabledPage.on('pageerror', (error) =>
      disabledProxy.observations.pageErrors.push(error.message),
    );
    await openProject(disabledPage, disabledProxy, fixture.project.id);
    await expect(disabledPage.getByTestId('matching-rules-panel')).toHaveCount(
      0,
    );
    await expect
      .poll(() => disabledProxy.observations.capabilities.length)
      .toBe(1);
    assert.deepEqual(disabledProxy.observations.capabilities[0]?.responseBody, {
      enabled: false,
    });
    assert.equal(
      disabledProxy.observations.projectReads.length,
      0,
      'The default-OFF capability must hide private project settings',
    );
    assert.equal(disabledProxy.observations.projectWrites.length, 0);
    await assertMobileWidth(disabledPage, 'Default-OFF project settings');
    await disabledContext.close();
    disabledContext = null;

    context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    await addOwnerCookie(context, proxy.origin, ownerCookie);
    page = await context.newPage();
    page.on('pageerror', (error) =>
      proxy.observations.pageErrors.push(error.message),
    );

    // A project change while its first private read is outstanding must keep
    // the old project's late response out of the new project's panel.
    const heldScopeRead = proxy.holdNextProjectRead();
    await openProject(page, proxy, fixture.project.id, 'domcontentloaded');
    await openProjectSettings(page);
    const oldScopeRecord = await heldScopeRead.captured;
    assert.equal(oldScopeRecord.status, 200);
    assert.equal(oldScopeRecord.responseBody?.projectId, fixture.project.id);
    await openProject(
      page,
      proxy,
      fixture.siblingProject.id,
      'domcontentloaded',
    );
    await openProjectSettings(page);
    const siblingPanel = page.getByTestId('matching-rules-panel');
    await expect(siblingPanel).toBeVisible();
    await assertHumanProfile(siblingPanel, 'default-v1');
    heldScopeRead.release();
    await assertHumanProfile(siblingPanel, 'default-v1');
    await expect(siblingPanel).not.toContainText(fixtureProfile);

    await openProject(page, proxy, fixture.project.id);
    await openProjectSettings(page);
    let panel = page.getByTestId('matching-rules-panel');
    await expect(panel).toBeVisible();
    await assertHumanProfile(panel, fixtureProfile);
    await expect(panel).not.toContainText(
      /\b(?:default-v1|rules-v1-[01]{3})\b/u,
    );
    assert.equal(
      (await readResolvedUploadJournal(page)).length,
      0,
      'Rule settings must not touch the separate photo-upload journal',
    );

    // Actor and session changes are tested while a real authenticated GET is
    // in flight. The returned response must not restore the old private row.
    for (const identity of [
      { actorId: randomUUID(), sessionId: randomUUID() },
      { actorId: owner, sessionId: randomUUID() },
    ]) {
      const heldIdentityRead = proxy.holdNextProjectRead();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openProjectSettings(page);
      const heldRecord = await heldIdentityRead.captured;
      assert.equal(heldRecord.status, 200);
      proxy.setIdentityOverride(identity);
      heldIdentityRead.release();
      await expect(panel.getByTestId('matching-rules-summary')).toHaveCount(0);
      await expect(panel.getByTestId('matching-rules-error')).toBeVisible();
      assert.equal(
        proxy.observations.projectReads.some(
          (record) =>
            record.sequence > heldRecord.sequence &&
            record.status === 200 &&
            record.responseBody?.projectId === fixture.project.id,
        ),
        false,
        'A changed actor/session cannot repopulate the private project setting',
      );
      proxy.clearIdentityOverride();
      await page.reload({ waitUntil: 'networkidle' });
      await openProjectSettings(page);
      panel = page.getByTestId('matching-rules-panel');
      await expect(panel).toBeVisible();
      await assertHumanProfile(panel, fixtureProfile);
    }

    const originalPhotoJournals = await readResolvedUploadJournal(page);
    assert.equal(originalPhotoJournals.length, 0);
    const liveConfig = await readMatchingRules(
      worker,
      base,
      ownerCookie,
      owner,
      fixture.project.id,
    );
    assert.equal(liveConfig.profile, fixtureProfile);
    const targetRules = {
      caseSensitive: !liveConfig.rules.caseSensitive,
      allowJpgJpegEquivalence: !liveConfig.rules.allowJpgJpegEquivalence,
      stripRecognizedSuffixes: !liveConfig.rules.stripRecognizedSuffixes,
    };
    const targetProfile = profileForRules(targetRules);
    const conflictProfile = anotherProfile(liveConfig.profile, targetProfile);
    assert.ok(conflictProfile);

    const caseToggle = panel.getByTestId('matching-rules-case');
    const jpegToggle = panel.getByTestId('matching-rules-jpeg');
    const suffixToggle = panel.getByTestId('matching-rules-suffix');
    if (!liveConfig.rules.caseSensitive) await expect(caseToggle).toBeChecked();
    else await expect(caseToggle).not.toBeChecked();
    if (liveConfig.rules.allowJpgJpegEquivalence)
      await expect(jpegToggle).toBeChecked();
    else await expect(jpegToggle).not.toBeChecked();
    if (liveConfig.rules.stripRecognizedSuffixes)
      await expect(suffixToggle).toBeChecked();
    else await expect(suffixToggle).not.toBeChecked();

    // Each opt-in is driven through its own user-visible control. The staged
    // tuple is the bitwise inverse of the actual current tuple.
    await caseToggle.setChecked(!targetRules.caseSensitive);
    await jpegToggle.setChecked(targetRules.allowJpgJpegEquivalence);
    await suffixToggle.setChecked(targetRules.stripRecognizedSuffixes);
    if (!targetRules.caseSensitive) await expect(caseToggle).toBeChecked();
    else await expect(caseToggle).not.toBeChecked();
    if (targetRules.allowJpgJpegEquivalence)
      await expect(jpegToggle).toBeChecked();
    else await expect(jpegToggle).not.toBeChecked();
    if (targetRules.stripRecognizedSuffixes)
      await expect(suffixToggle).toBeChecked();
    else await expect(suffixToggle).not.toBeChecked();
    await assertMobileWidth(page, 'Staged project matching rules');

    await panel.getByTestId('matching-rules-save').click();
    let dialog = panel.getByTestId('matching-rules-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('目前：');
    await expect(dialog).toContainText('變更後：');
    await expect(dialog).toContainText(profileSummary(targetProfile));
    await expect(panel.getByTestId('matching-rules-cancel')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByTestId('matching-rules-save')).toBeFocused();
    await panel.getByTestId('matching-rules-save').click();
    dialog = panel.getByTestId('matching-rules-dialog');
    await expect(dialog).toBeVisible();
    await panel.getByTestId('matching-rules-confirm').focus();
    await page.keyboard.press('Tab');
    await expect(panel.getByTestId('matching-rules-cancel')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(panel.getByTestId('matching-rules-confirm')).toBeFocused();

    const staleMutationStart = proxy.observations.projectWrites.length;
    const competingWrite = await writeMatchingProfile(
      worker,
      base,
      ownerCookie,
      owner,
      {
        projectId: fixture.project.id,
        projectRevision: liveConfig.projectRevision,
        ruleRevision: liveConfig.ruleRevision,
      },
      conflictProfile,
    );
    assert.equal(
      competingWrite.response.status,
      200,
      JSON.stringify(competingWrite.value),
    );
    await confirmAndReopenSettings(
      page,
      panel.getByTestId('matching-rules-confirm'),
    );
    await expect
      .poll(
        () => proxy.observations.projectWrites[staleMutationStart]?.status ?? 0,
      )
      .toBe(409);
    const staleWrite = proxy.observations.projectWrites[staleMutationStart];
    assert.equal(staleWrite.expectedActor, owner);
    const staleBody = JSON.parse(staleWrite.requestText);
    assert.equal(staleBody.expectedProjectRevision, liveConfig.projectRevision);
    assert.equal(staleBody.expectedRuleRevision, liveConfig.ruleRevision);
    assert.equal(staleBody.profile, targetProfile);
    await expect(panel.getByTestId('matching-rules-pending')).toHaveCount(0);
    await expect(panel.getByTestId('matching-rules-summary')).toContainText(
      profileSummary(conflictProfile),
    );
    await expect(panel.getByTestId('matching-rules-summary')).not.toContainText(
      profileSummary(targetProfile),
    );
    await assertMobileWidth(page, 'After configuration revision conflict');

    const refreshedConfig = await readMatchingRules(
      worker,
      base,
      ownerCookie,
      owner,
      fixture.project.id,
    );
    assert.equal(refreshedConfig.profile, conflictProfile);
    const freshToggleRules = rulesForProfile(targetProfile);
    await panel
      .getByTestId('matching-rules-case')
      .setChecked(!freshToggleRules.caseSensitive);
    await panel
      .getByTestId('matching-rules-jpeg')
      .setChecked(freshToggleRules.allowJpgJpegEquivalence);
    await panel
      .getByTestId('matching-rules-suffix')
      .setChecked(freshToggleRules.stripRecognizedSuffixes);
    await panel.getByTestId('matching-rules-save').click();
    dialog = panel.getByTestId('matching-rules-dialog');
    await expect(dialog).toBeVisible();
    const freshMutationStart = proxy.observations.projectWrites.length;
    await confirmAndReopenSettings(
      page,
      panel.getByTestId('matching-rules-confirm'),
    );
    await expect
      .poll(
        () => proxy.observations.projectWrites[freshMutationStart]?.status ?? 0,
      )
      .toBe(200);
    const freshWrite = proxy.observations.projectWrites[freshMutationStart];
    const freshBody = JSON.parse(freshWrite.requestText);
    assert.equal(freshWrite.expectedActor, owner);
    assert.equal(
      freshBody.expectedProjectRevision,
      refreshedConfig.projectRevision,
    );
    assert.equal(freshBody.expectedRuleRevision, refreshedConfig.ruleRevision);
    assert.equal(freshBody.profile, targetProfile);
    await expect(panel.getByTestId('matching-rules-pending')).toHaveCount(0);
    await expect(panel.getByTestId('matching-rules-summary')).toContainText(
      profileSummary(targetProfile),
    );
    const configAfterFreshConfirm = await readMatchingRules(
      worker,
      base,
      ownerCookie,
      owner,
      fixture.project.id,
    );
    assert.equal(configAfterFreshConfirm.profile, targetProfile);
    assert.equal(
      (await readResolvedUploadJournal(page)).length,
      originalPhotoJournals.length,
      'Configuration saves leave existing photo-journal entries untouched',
    );

    // Drop successful replies for this command, including any browser-level
    // automatic retry. Only the explicit test retry may receive a reply.
    const lostProfile = anotherProfile(targetProfile, conflictProfile);
    assert.ok(lostProfile);
    const lostRules = rulesForProfile(lostProfile);
    await panel
      .getByTestId('matching-rules-case')
      .setChecked(!lostRules.caseSensitive);
    await panel
      .getByTestId('matching-rules-jpeg')
      .setChecked(lostRules.allowJpgJpegEquivalence);
    await panel
      .getByTestId('matching-rules-suffix')
      .setChecked(lostRules.stripRecognizedSuffixes);
    await panel.getByTestId('matching-rules-save').click();
    dialog = panel.getByTestId('matching-rules-dialog');
    await expect(dialog).toBeVisible();
    const lostMutationStart = proxy.observations.projectWrites.length;
    proxy.dropNextRulesResponse();
    await panel.getByTestId('matching-rules-confirm').click();
    await expect
      .poll(
        () =>
          proxy.observations.projectWrites[lostMutationStart]?.dropped ?? false,
      )
      .toBe(true);
    const lostWrite = proxy.observations.projectWrites[lostMutationStart];
    assert.equal(lostWrite.status, 200);
    assert.equal(lostWrite.expectedActor, owner);
    const frozenBody = JSON.parse(lostWrite.requestText);
    assert.equal(frozenBody.profile, lostProfile);
    assert.equal(frozenBody.confirm, true);
    assert.match(
      frozenBody.requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    try {
      await expect(panel.getByTestId('matching-rules-pending')).toBeVisible({
        timeout: 5000,
      });
    } catch {
      const diagnostic = await readLostReplyDiagnostic(
        page,
        proxy,
        lostMutationStart,
      );
      throw new Error(
        'Lost matching-rules PUT did not stay pending after its successful reply was dropped: ' +
          JSON.stringify(diagnostic),
      );
    }
    const lostAttempts =
      proxy.observations.projectWrites.slice(lostMutationStart);
    assert.ok(lostAttempts.length > 0);
    for (const attempt of lostAttempts) {
      assert.equal(attempt.status, 200);
      assert.equal(attempt.dropped, true);
      assert.equal(attempt.requestText, lostWrite.requestText);
    }
    const storedIntent = await readSessionIntent(page);
    assert.equal(storedIntent.length, 1);
    const storedEnvelope = JSON.parse(storedIntent[0][1]);
    assert.equal(storedEnvelope.actorId, owner);
    assert.equal(storedEnvelope.workspaceId, fixture.workspaceId);
    assert.equal(storedEnvelope.projectId, fixture.project.id);
    assert.equal(storedEnvelope.phase, 'unknown');
    assert.deepEqual(JSON.parse(storedEnvelope.bodyJson), frozenBody);
    const automaticCommandCount = Number(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM project_matching_rule_commands WHERE actor_id=? AND project_id=? AND request_id=?',
          )
          .bind(owner, fixture.project.id, frozenBody.requestId)
          .first()
      )?.n ?? 0,
    );
    const automaticResultCount = Number(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM project_matching_rule_results WHERE command_id IN (SELECT id FROM project_matching_rule_commands WHERE actor_id=? AND project_id=? AND request_id=?)',
          )
          .bind(owner, fixture.project.id, frozenBody.requestId)
          .first()
      )?.n ?? 0,
    );
    assert.equal(automaticCommandCount, 1);
    assert.equal(automaticResultCount, 1);
    const automaticResult = await db
      .prepare(
        'SELECT r.event_id,r.result_json FROM project_matching_rule_results r JOIN project_matching_rule_commands c ON c.id=r.command_id WHERE c.actor_id=? AND c.project_id=? AND c.request_id=?',
      )
      .bind(owner, fixture.project.id, frozenBody.requestId)
      .first();
    assert.ok(automaticResult?.event_id);
    assert.equal(automaticResult.event_id, lostWrite.responseBody?.eventId);
    const automaticAuditCount = Number(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND project_id=? AND request_id=? AND action='project.matching_rules_changed'",
          )
          .bind(owner, fixture.project.id, frozenBody.requestId)
          .first()
      )?.n ?? 0,
    );
    assert.equal(automaticAuditCount, 1);
    assert.equal(
      (await readResolvedUploadJournal(page)).length,
      originalPhotoJournals.length,
      'The rule intent stays in its own session-storage prefix',
    );

    await page.reload({ waitUntil: 'networkidle' });
    await openProjectSettings(page);
    panel = page.getByTestId('matching-rules-panel');
    await expect(panel.getByTestId('matching-rules-pending')).toBeVisible();
    const newerProfile = anotherNonDefaultProfile(targetProfile, lostProfile);
    assert.ok(newerProfile);
    const lostResult = lostWrite.responseBody;
    assert.ok(lostResult?.projectRevision && lostResult?.ruleRevision);
    const laterWrite = await writeMatchingProfile(
      worker,
      base,
      ownerCookie,
      owner,
      {
        projectId: fixture.project.id,
        projectRevision: lostResult.projectRevision,
        ruleRevision: lostResult.ruleRevision,
      },
      newerProfile,
    );
    assert.equal(
      laterWrite.response.status,
      200,
      JSON.stringify(laterWrite.value),
    );
    assert.equal(laterWrite.value.profile, newerProfile);

    proxy.releaseDroppedRulesResponses();
    const retryStart = proxy.observations.projectWrites.length;
    await confirmAndReopenSettings(
      page,
      panel.getByTestId('matching-rules-retry'),
    );
    await expect
      .poll(() => proxy.observations.projectWrites[retryStart]?.status ?? 0)
      .toBe(200);
    const replay = proxy.observations.projectWrites[retryStart];
    assert.equal(replay.expectedActor, owner);
    assert.equal(replay.requestText, lostWrite.requestText);
    assert.equal(replay.responseBody?.profile, lostProfile);
    assert.equal(replay.responseBody?.eventId, lostWrite.responseBody?.eventId);
    await expect(panel.getByTestId('matching-rules-pending')).toHaveCount(0);
    await expect(panel.getByTestId('matching-rules-summary')).toContainText(
      profileSummary(newerProfile),
    );
    await expect(panel.getByTestId('matching-rules-summary')).not.toContainText(
      profileSummary(lostProfile),
    );
    const replayRead = await readMatchingRules(
      worker,
      base,
      ownerCookie,
      owner,
      fixture.project.id,
    );
    assert.equal(replayRead.profile, newerProfile);
    const replayCommand = await db
      .prepare(
        'SELECT request_id,expected_project_revision,expected_rule_revision,profile FROM project_matching_rule_commands WHERE actor_id=? AND request_id=?',
      )
      .bind(owner, frozenBody.requestId)
      .first();
    assert.ok(replayCommand);
    assert.equal(replayCommand.request_id, frozenBody.requestId);
    assert.equal(replayCommand.profile, lostProfile);
    const finalCommandCount = Number(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM project_matching_rule_commands WHERE actor_id=? AND project_id=? AND request_id=?',
          )
          .bind(owner, fixture.project.id, frozenBody.requestId)
          .first()
      )?.n ?? 0,
    );
    const finalResultCount = Number(
      (
        await db
          .prepare(
            'SELECT count(*) AS n FROM project_matching_rule_results WHERE command_id IN (SELECT id FROM project_matching_rule_commands WHERE actor_id=? AND project_id=? AND request_id=?)',
          )
          .bind(owner, fixture.project.id, frozenBody.requestId)
          .first()
      )?.n ?? 0,
    );
    const finalAuditCount = Number(
      (
        await db
          .prepare(
            "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND project_id=? AND request_id=? AND action='project.matching_rules_changed'",
          )
          .bind(owner, fixture.project.id, frozenBody.requestId)
          .first()
      )?.n ?? 0,
    );
    assert.equal(finalCommandCount, 1);
    assert.equal(finalResultCount, 1);
    assert.equal(finalAuditCount, 1);
    await assertMobileWidth(page, 'Recovered exact matching-rule request');
    await mkdir(dirname(mobileScreenshotPath), { recursive: true });
    await panel.screenshot({ path: mobileScreenshotPath });

    // The index panel must clear the old profile's private counters on a real
    // revision conflict, then load the current profile only after explicit
    // refresh. The successful user click advances no more than 24 sessions.
    const albumCard = page.getByTestId('album-card-' + fixture.album.id);
    const openAlbum = albumCard.getByRole('button', {
      name: '開啟相簿 ' + fixture.album.name,
      exact: true,
    });
    await openAlbum.click();
    assert.equal(
      new URL(page.url()).searchParams.get('albumId'),
      fixture.album.id,
    );
    const advancedAlbumControls = albumCard.getByText('進階相簿整理', {
      exact: true,
    });
    await expect(advancedAlbumControls).toBeVisible();
    await advancedAlbumControls.click();
    const indexPanel = page.getByTestId('matching-rule-index');
    await expect(indexPanel).toBeVisible();
    await expect
      .poll(() => proxy.observations.indexReads.length)
      .toBeGreaterThan(0);
    const beforeIndexConflict =
      proxy.observations.indexReads.at(-1)?.responseBody;
    assert.equal(beforeIndexConflict?.albumId, fixture.album.id);
    assert.equal(beforeIndexConflict?.projectId, fixture.project.id);
    assert.equal(beforeIndexConflict?.profile, newerProfile);
    assert.equal(beforeIndexConflict?.state, 'building');
    assert.ok(beforeIndexConflict.missingSessions > 0);
    await expect(countLocator(indexPanel, '已建立工作階段')).toHaveText(
      String(beforeIndexConflict.indexedSessions),
    );
    await expect(countLocator(indexPanel, '待建立工作階段')).toHaveText(
      String(beforeIndexConflict.missingSessions),
    );
    await expect(countLocator(indexPanel, '相關無效工作階段')).toHaveText(
      String(beforeIndexConflict.invalidSessions),
    );
    await expect(countLocator(indexPanel, '未連結版本')).toHaveText(
      String(beforeIndexConflict.unlinkedVersions),
    );
    await expect(countLocator(indexPanel, '尚未就緒照片')).toHaveText(
      String(beforeIndexConflict.unreadyPhotos),
    );
    const staleIndexProfile = anotherNonDefaultProfile(newerProfile);
    assert.ok(staleIndexProfile);
    const indexConflictWrite = await writeMatchingProfile(
      worker,
      base,
      ownerCookie,
      owner,
      {
        projectId: fixture.project.id,
        projectRevision: replayRead.projectRevision,
        ruleRevision: replayRead.ruleRevision,
      },
      staleIndexProfile,
    );
    assert.equal(
      indexConflictWrite.response.status,
      200,
      JSON.stringify(indexConflictWrite.value),
    );
    const staleIndexPostStart = proxy.observations.indexWrites.length;
    await indexPanel.getByTestId('matching-rule-index-advance').click();
    await expect
      .poll(
        () => proxy.observations.indexWrites[staleIndexPostStart]?.status ?? 0,
      )
      .toBe(409);
    assert.deepEqual(
      JSON.parse(
        proxy.observations.indexWrites[staleIndexPostStart].requestText,
      ),
      {
        expectedProjectRevision: beforeIndexConflict.projectRevision,
        expectedRuleRevision: beforeIndexConflict.ruleRevision,
        profile: newerProfile,
      },
    );
    await expect(
      indexPanel.getByTestId('matching-rule-index-status'),
    ).toHaveCount(0);
    await expect(countLocator(indexPanel, '待建立工作階段')).toHaveCount(0);
    await expect(
      indexPanel.getByTestId('matching-rule-index-advance'),
    ).toHaveCount(0);
    await expect(
      indexPanel.getByTestId('matching-rule-index-error'),
    ).toBeVisible();

    const oldReadCount = proxy.observations.indexReads.length;
    await indexPanel.getByTestId('matching-rule-index-refresh').click();
    await expect
      .poll(() => proxy.observations.indexReads.length)
      .toBe(oldReadCount + 1);
    const currentIndexStatus =
      proxy.observations.indexReads.at(-1)?.responseBody;
    assert.equal(currentIndexStatus?.profile, staleIndexProfile);
    assert.equal(currentIndexStatus?.state, 'building');
    assert.ok(currentIndexStatus.missingSessions > 0);
    await expect(countLocator(indexPanel, '待建立工作階段')).toHaveText(
      String(currentIndexStatus.missingSessions),
    );
    const indexPostCount = proxy.observations.indexWrites.length;
    await indexPanel.getByTestId('matching-rule-index-advance').click();
    await expect
      .poll(() => proxy.observations.indexWrites.length)
      .toBe(indexPostCount + 1);
    const indexWrite = proxy.observations.indexWrites.at(-1);
    assert.equal(
      indexWrite.status,
      200,
      JSON.stringify(indexWrite.responseBody),
    );
    assert.equal(indexWrite.expectedActor, owner);
    assert.deepEqual(JSON.parse(indexWrite.requestText), {
      expectedProjectRevision: currentIndexStatus.projectRevision,
      expectedRuleRevision: currentIndexStatus.ruleRevision,
      profile: currentIndexStatus.profile,
    });
    const indexedAfter = indexWrite.responseBody;
    const indexedNow =
      currentIndexStatus.missingSessions - indexedAfter.missingSessions;
    assert.ok(indexedNow > 0 && indexedNow <= 24);
    await expect(countLocator(indexPanel, '已建立工作階段')).toHaveText(
      String(indexedAfter.indexedSessions),
    );
    await expect(countLocator(indexPanel, '待建立工作階段')).toHaveText(
      String(indexedAfter.missingSessions),
    );
    await expect(countLocator(indexPanel, '相關無效工作階段')).toHaveText(
      String(indexedAfter.invalidSessions),
    );
    await expect(countLocator(indexPanel, '未連結版本')).toHaveText(
      String(indexedAfter.unlinkedVersions),
    );
    await expect(countLocator(indexPanel, '尚未就緒照片')).toHaveText(
      String(indexedAfter.unreadyPhotos),
    );
    await expect(
      indexPanel.getByTestId('matching-rule-index-status'),
    ).toContainText(/已就緒|待建立/u);
    await expect(indexPanel).not.toContainText(
      /\b(?:default-v1|rules-v1-[01]{3})\b/u,
    );
    await assertMobileWidth(page, 'Matching-rule index status after one batch');
    await indexPanel.screenshot({ path: indexScreenshotPath });

    // Keep the profile context attached to both the preview and its durable
    // photo-upload journal. Abort the next authorization request so this UI
    // check makes no claim of an R2 transfer or recovered file bytes.
    const photoJournalsBeforeUpload = await readResolvedUploadJournal(page);
    const matchingConfigBeforePreview = await readMatchingRules(
      worker,
      base,
      ownerCookie,
      owner,
      fixture.project.id,
    );
    assert.equal(matchingConfigBeforePreview.profile, staleIndexProfile);
    await albumCard.getByRole('button', { name: /上傳照片/u }).click();
    const uploadPanel = page.getByTestId('resolved-upload');
    await expect(uploadPanel).toBeVisible();
    const uploadBytes = uniquePng();
    const filename = 'matching-rules-browser-' + randomUUID() + '.png';
    await uploadPanel.getByTestId('resolved-upload-file').setInputFiles({
      name: filename,
      mimeType: 'image/png',
      buffer: uploadBytes,
    });
    await expect(uploadPanel.getByText(/原始尺寸 1 × 1/u)).toBeVisible();
    const previewStart = proxy.observations.previewRequests.length;
    await uploadPanel.getByTestId('resolved-upload-preview').click();
    await expect
      .poll(() => proxy.observations.previewRequests.length)
      .toBe(previewStart + 1);
    const previewRecord = proxy.observations.previewRequests.at(-1);
    assert.equal(previewRecord.status, 200);
    const previewValue = previewRecord.responseBody;
    assert.deepEqual(previewValue?.matchingProfile, {
      profile: staleIndexProfile,
      ruleRevision: matchingConfigBeforePreview.ruleRevision,
    });
    await expect(
      uploadPanel.getByTestId('matching-profile-summary'),
    ).toContainText(previewProfileSummary(staleIndexProfile));
    await expect(
      uploadPanel.getByTestId('matching-profile-summary'),
    ).not.toContainText(/rules-v1-[01]{3}|revision|序號/u);
    const newPhotoChoice = uploadPanel.locator(
      'input[type="radio"][value="new_photo"]',
    );
    if ((await newPhotoChoice.count()) > 0) await newPhotoChoice.check();
    await uploadPanel.getByTestId('resolved-upload-reserve').click();
    const uploadDialog = uploadPanel.getByTestId('resolved-upload-dialog');
    await expect(uploadDialog).toBeVisible();
    await expect(
      uploadPanel.getByTestId('matching-profile-confirmation'),
    ).toContainText(previewProfileSummary(staleIndexProfile));
    await expect(
      uploadPanel.getByTestId('matching-profile-confirmation'),
    ).not.toContainText(/rules-v1-[01]{3}|revision|序號/u);
    const reservationStart = proxy.observations.reservationRequests.length;
    const authorizeStart = proxy.observations.authorizeAttempts.length;
    await uploadPanel.getByTestId('resolved-upload-confirm').click();
    await expect
      .poll(() => proxy.observations.reservationRequests.length)
      .toBe(reservationStart + 1);
    const reservation = proxy.observations.reservationRequests.at(-1);
    assert.equal(reservation.status, 201);
    const reservationBody = JSON.parse(reservation.requestText);
    assert.deepEqual(reservationBody.matchingProfile, {
      profile: staleIndexProfile,
      ruleRevision: matchingConfigBeforePreview.ruleRevision,
    });
    assert.equal(
      reservationBody.expectedProjectRevision,
      previewValue.projectRevision,
    );
    assert.equal(reservationBody.expectedMode, previewValue.mode);
    assert.equal(
      reservationBody.expectedChangeSequence,
      previewValue.changeSequence,
    );
    assert.equal(reservationBody.file?.originalFilename, filename);
    assert.equal(reservation.expectedActor, owner);
    await expect
      .poll(() => proxy.observations.authorizeAttempts.length)
      .toBeGreaterThan(authorizeStart);
    for (const attempt of proxy.observations.authorizeAttempts.slice(
      authorizeStart,
    )) {
      assert.equal(attempt.interrupted, true);
      assert.equal(attempt.status, 0);
    }
    const photoJournalEntries = await readResolvedUploadJournal(page);
    assert.equal(
      photoJournalEntries.length,
      photoJournalsBeforeUpload.length + 1,
    );
    const journalItem = photoJournalEntries
      .filter(([key]) => key.startsWith(resolvedUploadJournalPrefix))
      .flatMap(([, serialized]) => JSON.parse(serialized).items ?? [])
      .find(
        (entry) =>
          entry.reservationBody?.requestId === reservationBody.requestId,
      );
    assert.ok(journalItem, 'The new reservation has its own photo-journal row');
    assert.deepEqual(journalItem.reservationBody, reservationBody);
    assert.equal(
      journalItem.reservationBody.matchingProfile.profile,
      staleIndexProfile,
    );
    assert.equal(
      journalItem.reservationBody.matchingProfile.ruleRevision,
      matchingConfigBeforePreview.ruleRevision,
    );
    assert.equal(
      proxy.observations.indexWrites.at(-1)?.responseBody?.profile,
      staleIndexProfile,
    );
    assert.equal(
      proxy.observations.bridgeErrors.length,
      0,
      proxy.observations.bridgeErrors.join('\n'),
    );
    assert.deepEqual(proxy.observations.pageErrors, []);
    assert.deepEqual(disabledProxy.observations.bridgeErrors, []);

    return {
      defaultOffHidden: true,
      lateScopeIdentityPrivacy: true,
      controlsAndExplicitFreshConfirmation: true,
      lostReplyExactReplayKeepsCurrentProfile: true,
      indexConflictRefreshAndBoundedBatch: true,
      previewAndReservationCarryProfile: true,
      r2TransferPerformed: false,
      screenshots: [mobileScreenshotPath, indexScreenshotPath],
    };
  } finally {
    await context?.close();
    await disabledContext?.close();
    await proxy.close();
    await disabledProxy.close();
    await browser.close();
  }
}
