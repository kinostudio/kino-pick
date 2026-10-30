import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workerDirectory = resolve(testDirectory, '..');
const repositoryDirectory = resolve(workerDirectory, '../..');
const localDirectory = join(workerDirectory, '.local');
const storePath = join(
  repositoryDirectory,
  'apps/web/target-ui/resolved-batch-store.ts',
);
const journalPath = join(
  repositoryDirectory,
  'apps/web/target-ui/resolved-batch-journal.ts',
);

async function loadEsbuild() {
  const virtualStore = join(repositoryDirectory, 'node_modules/.pnpm');
  const candidates = (await readdir(virtualStore))
    .filter((name) => /^esbuild@/u.test(name))
    .sort();
  for (const candidate of candidates) {
    const main = join(
      virtualStore,
      candidate,
      'node_modules/esbuild/lib/main.js',
    );
    if (existsSync(main)) {
      const esbuildModule = await import(pathToFileURL(main).href);
      return esbuildModule.build ? esbuildModule : esbuildModule.default;
    }
  }
  throw new Error('Installed esbuild package was not found');
}

async function bundleSource() {
  const { build } = await loadEsbuild();
  const entry = [
    'import * as store from ' +
      JSON.stringify(storePath.replaceAll('\\', '/')) +
      ';',
    'import * as journal from ' +
      JSON.stringify(journalPath.replaceAll('\\', '/')) +
      ';',
    'globalThis.__resolvedBatchModules = { store, journal };',
  ].join('\n');
  const built = await build({
    stdin: {
      contents: entry,
      loader: 'js',
      resolveDir: repositoryDirectory,
      sourcefile: 'resolved-batch-store-browser-entry.js',
    },
    bundle: true,
    write: false,
    outfile: 'resolved-batch-store-browser.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  assert.equal(built.outputFiles.length, 1);
  return built.outputFiles[0].text;
}

function startOrigin(bundle) {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head>' +
    '<body><main>isolated IndexedDB harness</main><script src="/bundle.js"></script></body></html>';
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(bundle);
      return;
    }
    if (request.url === '/' || request.url?.startsWith('/?')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(html);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('The isolated harness origin did not bind'));
        return;
      }
      resolveServer({
        origin: 'http://127.0.0.1:' + address.port,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.close((error) =>
              error ? rejectClose(error) : resolveClose(),
            );
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

async function runCore(page) {
  return page.evaluate(async () => {
    const {
      ResolvedBatchStore,
      RESOLVED_BATCH_DATABASE_NAME,
      RESOLVED_BATCH_ITEM_STORE_NAME,
    } = globalThis.__resolvedBatchModules.store;
    const { encodeResolvedBatchItemEnvelope } =
      globalThis.__resolvedBatchModules.journal;
    const groups = [];
    const metrics = {};
    function check(value, message) {
      if (!value) throw new Error(message);
    }
    function equal(actual, expected, message) {
      if (actual !== expected) {
        throw new Error(
          message +
            ': expected ' +
            String(expected) +
            ', got ' +
            String(actual),
        );
      }
    }
    const id = () => crypto.randomUUID();
    const freshScope = () => ({
      actorId: id(),
      workspaceId: id(),
      projectId: id(),
      albumId: id(),
    });
    const freshPolicy = () => ({
      expectedMode: 'assisted',
      projectRevision: 1,
    });
    const freshDescriptor = (ordinal) => ({
      id: id(),
      ordinal,
      originalFilename: 'native-batch-' + ordinal + '.png',
      expectedBytes: 1,
      contentType: 'image/png',
      lastModified: ordinal,
    });
    function fixture(count = 1, options = {}) {
      const scope = options.scope ?? freshScope();
      const queueId = options.queueId ?? id();
      const policy = options.policy ?? freshPolicy();
      const now = Date.now();
      const descriptors = Array.from({ length: count }, (_, ordinal) =>
        freshDescriptor(ordinal),
      );
      const manifest = {
        version: 1,
        scope,
        queueId,
        capturedSessionId:
          options.capturedSessionId ?? 'opaque-owner-session-native',
        policy,
        revision: 0,
        createdAt: now,
        savedAt: now,
        descriptors,
      };
      const items = descriptors.map((descriptor) => ({
        version: 1,
        scope,
        queueId,
        capturedSessionId: manifest.capturedSessionId,
        policy,
        descriptor,
        revision: 0,
        state: 'queued',
        intent: null,
        createdAt: now,
        savedAt: now,
      }));
      return { scope, queueId, policy, manifest, descriptors, items };
    }
    function intentFor(record, ordinal, options = {}) {
      const descriptor = record.descriptors[ordinal];
      const operationIds = options.operationIds ?? [id(), id(), id()];
      const fingerprint = {
        originalFilename: descriptor.originalFilename,
        expectedBytes: descriptor.expectedBytes,
        contentType: descriptor.contentType,
        sha256: 'a'.repeat(64),
        dimensions: { width: 1, height: 1 },
      };
      const reservationBody = {
        requestId: operationIds[0],
        file: {
          originalFilename: descriptor.originalFilename.trim(),
          expectedBytes: descriptor.expectedBytes,
          contentType: descriptor.contentType,
          sha256: fingerprint.sha256,
          dimensions: fingerprint.dimensions,
        },
        expectedChangeSequence: 0,
        expectedProjectRevision: record.policy.projectRevision,
        expectedMode: record.policy.expectedMode,
        ...(record.policy.matchingProfile
          ? { matchingProfile: record.policy.matchingProfile }
          : {}),
        choice: { kind: 'new_photo' },
        confirm: true,
      };
      let reservation = null;
      if (options.uploadSessionId) {
        reservation = {
          uploadSession: {
            id: options.uploadSessionId,
            workspaceId: record.scope.workspaceId,
            projectId: record.scope.projectId,
            albumId: record.scope.albumId,
            originalFilename: descriptor.originalFilename.trim(),
            expectedBytes: descriptor.expectedBytes,
            reservedBytes: descriptor.expectedBytes,
            status: 'reserved',
            expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
            createdAt: new Date().toISOString(),
          },
          target: { kind: 'new_photo' },
        };
      }
      return {
        id: descriptor.id,
        reservationBody,
        reservation,
        authorizeBody: { requestId: operationIds[1] },
        completeBody: { requestId: operationIds[2] },
        fingerprint,
        needsReview: false,
      };
    }
    function captured(record, ordinal, options = {}) {
      const previous = record.items[ordinal];
      return {
        ...previous,
        revision: 1,
        savedAt: Math.max(Date.now(), previous.savedAt + 1),
        state: 'captured',
        intent: intentFor(record, ordinal, options),
      };
    }
    function identity(recordScope, queueId) {
      return {
        actorKey: recordScope.actorId.toLowerCase(),
        workspaceKey: recordScope.workspaceId.toLowerCase(),
        projectKey: recordScope.projectId.toLowerCase(),
        albumKey: recordScope.albumId.toLowerCase(),
        queueKey: queueId.toLowerCase(),
      };
    }
    function operationKeys(item) {
      if (!item.intent) return [];
      return [
        item.intent.reservationBody.requestId,
        item.intent.authorizeBody.requestId,
        item.intent.completeBody.requestId,
      ].map(
        (requestId) =>
          item.scope.actorId.toLowerCase() + ':' + requestId.toLowerCase(),
      );
    }
    function itemRecord(item) {
      const sessionId = item.intent?.reservation?.uploadSession.id;
      return {
        ...identity(item.scope, item.queueId),
        ordinal: item.descriptor.ordinal,
        actorOperationKeys: operationKeys(item),
        ...(sessionId
          ? {
              actorUploadSessionKey:
                item.scope.actorId.toLowerCase() +
                ':' +
                sessionId.toLowerCase(),
            }
          : {}),
        serialized: encodeResolvedBatchItemEnvelope(item),
      };
    }
    function itemKey(recordScope, queueId, ordinal) {
      const value = identity(recordScope, queueId);
      return [
        value.actorKey,
        value.workspaceKey,
        value.projectKey,
        value.albumKey,
        value.queueKey,
        ordinal,
      ];
    }
    function transactionDone(transaction) {
      return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve(), {
          once: true,
        });
        transaction.addEventListener(
          'abort',
          () =>
            reject(
              transaction.error ??
                new DOMException('IndexedDB transaction aborted', 'AbortError'),
            ),
          { once: true },
        );
      });
    }
    function requestResult(request) {
      return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          'error',
          () => reject(request.error ?? new Error('IndexedDB request failed')),
          { once: true },
        );
      });
    }
    function openDatabase(name) {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name);
        request.addEventListener('success', () => resolve(request.result), {
          once: true,
        });
        request.addEventListener(
          'error',
          () => reject(request.error ?? new Error('IndexedDB open failed')),
          { once: true },
        );
      });
    }
    async function readItemRow(name, recordScope, queueId, ordinal) {
      const database = await openDatabase(name);
      const transaction = database.transaction(
        RESOLVED_BATCH_ITEM_STORE_NAME,
        'readonly',
      );
      const done = transactionDone(transaction);
      const row = await requestResult(
        transaction
          .objectStore(RESOLVED_BATCH_ITEM_STORE_NAME)
          .get(itemKey(recordScope, queueId, ordinal)),
      );
      await done;
      database.close();
      return row;
    }
    async function mutateItemRow(name, recordScope, queueId, ordinal, edit) {
      const database = await openDatabase(name);
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(
          RESOLVED_BATCH_ITEM_STORE_NAME,
          'readwrite',
        );
        transaction.addEventListener('complete', () => resolve(), {
          once: true,
        });
        transaction.addEventListener(
          'abort',
          () =>
            reject(
              transaction.error ??
                new DOMException('IndexedDB transaction aborted', 'AbortError'),
            ),
          { once: true },
        );
        const objectStore = transaction.objectStore(
          RESOLVED_BATCH_ITEM_STORE_NAME,
        );
        const request = objectStore.get(itemKey(recordScope, queueId, ordinal));
        request.addEventListener(
          'error',
          () => {
            try {
              transaction.abort();
            } catch {}
          },
          { once: true },
        );
        request.addEventListener(
          'success',
          () => {
            try {
              if (!request.result)
                throw new Error('Tamper fixture row was not found');
              objectStore.put(edit(request.result));
            } catch (error) {
              try {
                transaction.abort();
              } catch {}
              reject(error);
            }
          },
          { once: true },
        );
      });
      database.close();
    }
    async function rawAddItem(name, row) {
      const database = await openDatabase(name);
      let requestError = null;
      const result = await new Promise((resolve) => {
        const transaction = database.transaction(
          RESOLVED_BATCH_ITEM_STORE_NAME,
          'readwrite',
        );
        transaction.addEventListener('complete', () => resolve({ ok: true }), {
          once: true,
        });
        transaction.addEventListener(
          'abort',
          () =>
            resolve({
              ok: false,
              errorName: requestError?.name ?? transaction.error?.name ?? null,
            }),
          { once: true },
        );
        const request = transaction
          .objectStore(RESOLVED_BATCH_ITEM_STORE_NAME)
          .add(row);
        request.addEventListener(
          'error',
          () => {
            requestError = request.error;
          },
          { once: true },
        );
      });
      database.close();
      return result;
    }
    const dbName = () => RESOLVED_BATCH_DATABASE_NAME;
    const recordGroup = (name, detail = {}) => groups.push({ name, ...detail });

    const pages = fixture(49);
    const pagesDb = dbName();
    const pagesStore = new ResolvedBatchStore();
    await pagesStore.createQueue(pages.manifest, pages.items);
    const counter = { active: true, gets: 0, cursors: 0, rows: 0 };
    const oldGet = IDBObjectStore.prototype.get;
    const oldCursor = IDBIndex.prototype.openCursor;
    IDBObjectStore.prototype.get = function (...args) {
      if (counter.active) counter.gets++;
      return oldGet.apply(this, args);
    };
    IDBIndex.prototype.openCursor = function (...args) {
      const request = oldCursor.apply(this, args);
      if (counter.active) {
        counter.cursors++;
        request.addEventListener('success', () => {
          if (request.result) counter.rows++;
        });
      }
      return request;
    };
    let firstPage;
    try {
      firstPage = await pagesStore.listItems(
        pages.scope,
        pages.queueId,
        null,
        24,
      );
    } finally {
      counter.active = false;
      IDBObjectStore.prototype.get = oldGet;
      IDBIndex.prototype.openCursor = oldCursor;
    }
    equal(firstPage.items.length, 24, 'First page length');
    equal(firstPage.nextAfterOrdinal, 23, 'First page cursor');
    equal(counter.gets, 1, 'Page performs one manifest get');
    equal(counter.cursors, 1, 'Page opens one index cursor');
    check(counter.rows <= 25, 'Page reads more than 25 cursor rows');
    const secondPage = await pagesStore.listItems(
      pages.scope,
      pages.queueId,
      firstPage.nextAfterOrdinal,
      24,
    );
    const finalPage = await pagesStore.listItems(
      pages.scope,
      pages.queueId,
      secondPage.nextAfterOrdinal,
      24,
    );
    equal(secondPage.items.length, 24, 'Second page length');
    equal(secondPage.nextAfterOrdinal, 47, 'Second page cursor');
    equal(finalPage.items.length, 1, 'Final page length');
    equal(finalPage.nextAfterOrdinal, null, 'Final page has no next cursor');
    metrics.pageCursorRows = counter.rows;
    recordGroup('49 rows page 24/24/1', {
      pageLengths: [24, 24, 1],
      cursorReads: counter.rows,
    });
    pagesStore.close();

    const large = fixture(1000);
    const largeStore = new ResolvedBatchStore();
    await largeStore.createQueue(large.manifest, large.items);
    let after = null;
    let total = 0;
    let pageCount = 0;
    let lastLength = 0;
    while (true) {
      const result = await largeStore.listItems(
        large.scope,
        large.queueId,
        after,
        24,
      );
      check(result.items.length <= 24, 'A page returned more than 24 rows');
      total += result.items.length;
      pageCount++;
      lastLength = result.items.length;
      if (result.nextAfterOrdinal === null) break;
      check(
        result.nextAfterOrdinal > (after ?? -1),
        'Keyset cursor did not advance',
      );
      after = result.nextAfterOrdinal;
    }
    equal(total, 1000, '1000 metadata rows are pageable');
    equal(pageCount, 42, '1000 rows use 42 bounded pages');
    equal(lastLength, 16, 'Last page length');
    recordGroup('1000 synthetic metadata rows page in bounded batches', {
      pageCount,
      rowCount: total,
    });
    largeStore.close();

    const readFixture = fixture(1);
    const readStore = new ResolvedBatchStore();
    await readStore.createQueue(readFixture.manifest, readFixture.items);
    const reads = { active: true, get: 0, getAll: 0, cursor: 0 };
    const getImpl = IDBObjectStore.prototype.get;
    const getAllImpl = IDBObjectStore.prototype.getAll;
    const cursorImpl = IDBIndex.prototype.openCursor;
    IDBObjectStore.prototype.get = function (...args) {
      if (reads.active) reads.get++;
      return getImpl.apply(this, args);
    };
    IDBObjectStore.prototype.getAll = function (...args) {
      if (reads.active) reads.getAll++;
      return getAllImpl.apply(this, args);
    };
    IDBIndex.prototype.openCursor = function (...args) {
      if (reads.active) reads.cursor++;
      return cursorImpl.apply(this, args);
    };
    try {
      await readStore.updateItem(0, 0, {
        ...readFixture.items[0],
        revision: 1,
        savedAt: Date.now(),
        state: 'cancelled',
      });
    } finally {
      reads.active = false;
      IDBObjectStore.prototype.get = getImpl;
      IDBObjectStore.prototype.getAll = getAllImpl;
      IDBIndex.prototype.openCursor = cursorImpl;
    }
    equal(reads.get, 2, 'updateItem reads manifest and one target');
    equal(reads.getAll, 0, 'updateItem does not call getAll');
    equal(reads.cursor, 0, 'updateItem does not open a cursor');
    metrics.updateReads = {
      get: reads.get,
      getAll: reads.getAll,
      cursor: reads.cursor,
    };
    recordGroup(
      'updateItem uses two direct gets and no cursor scan',
      metrics.updateReads,
    );
    readStore.close();

    const sameQueue = fixture(2);
    const nativeDb = dbName();
    const nativeStore = new ResolvedBatchStore();
    const dummy = fixture(1);
    await nativeStore.createQueue(dummy.manifest, dummy.items);
    const duplicateId = id();
    const rawFirst = captured(sameQueue, 0, {
      operationIds: [duplicateId, id(), id()],
    });
    const rawSecond = captured(sameQueue, 1, {
      operationIds: [duplicateId.toUpperCase(), id(), id()],
    });
    check(
      (await rawAddItem(nativeDb, itemRecord(rawFirst))).ok,
      'First index row commits',
    );
    const rawConflict = await rawAddItem(nativeDb, itemRecord(rawSecond));
    check(!rawConflict.ok, 'Native index rejects duplicate row');
    equal(
      rawConflict.errorName,
      'ConstraintError',
      'Native index reports ConstraintError',
    );
    equal(
      await readItemRow(nativeDb, sameQueue.scope, sameQueue.queueId, 1),
      undefined,
      'Rejected native row is rolled back',
    );
    recordGroup(
      'native multiEntry operation index rejects same-queue collision',
    );
    nativeStore.close();

    const operation = fixture(1);
    const operationDb = dbName();
    const operationStore = new ResolvedBatchStore();
    const requestId = id();
    await operationStore.createQueue(operation.manifest, [
      captured(operation, 0, { operationIds: [requestId, id(), id()] }),
    ]);
    const reused = fixture(1, { scope: operation.scope });
    let operationError;
    try {
      await operationStore.createQueue(reused.manifest, [
        captured(reused, 0, {
          operationIds: [requestId.toUpperCase(), id(), id()],
        }),
      ]);
    } catch (error) {
      operationError = error;
    }
    equal(
      operationError?.code,
      'RESOLVED_BATCH_STORE_UNIQUE_CONFLICT',
      'Cross-queue operation reuse rejected',
    );
    equal(
      await operationStore.readManifest(reused.scope, reused.queueId),
      null,
      'Failed operation collision leaves no manifest',
    );
    equal(
      await readItemRow(operationDb, reused.scope, reused.queueId, 0),
      undefined,
      'Failed operation collision rolls back item',
    );
    recordGroup('cross-queue operation UUID reuse fails atomically');
    operationStore.close();

    const session = fixture(1);
    const sessionDb = dbName();
    const sessionStore = new ResolvedBatchStore();
    const sessionId = id();
    await sessionStore.createQueue(session.manifest, [
      captured(session, 0, { uploadSessionId: sessionId }),
    ]);
    const reusedSession = fixture(1, { scope: session.scope });
    let sessionError;
    try {
      await sessionStore.createQueue(reusedSession.manifest, [
        captured(reusedSession, 0, { uploadSessionId: sessionId }),
      ]);
    } catch (error) {
      sessionError = error;
    }
    equal(
      sessionError?.code,
      'RESOLVED_BATCH_STORE_UNIQUE_CONFLICT',
      'Cross-queue upload session reuse rejected',
    );
    equal(
      await sessionStore.readManifest(
        reusedSession.scope,
        reusedSession.queueId,
      ),
      null,
      'Session conflict leaves no manifest',
    );
    equal(
      await readItemRow(
        sessionDb,
        reusedSession.scope,
        reusedSession.queueId,
        0,
      ),
      undefined,
      'Session conflict rolls back item',
    );
    recordGroup('cross-queue upload-session UUID reuse fails atomically');
    sessionStore.close();

    const scoped = fixture(1);
    const scopeStore = new ResolvedBatchStore();
    await scopeStore.createQueue(scoped.manifest, scoped.items);
    const wrongScope = { ...scoped.scope, actorId: id() };
    equal(
      await scopeStore.readManifest(wrongScope, scoped.queueId),
      null,
      'Wrong actor cannot read manifest',
    );
    let scopeError;
    try {
      await scopeStore.listItems(wrongScope, scoped.queueId);
    } catch (error) {
      scopeError = error;
    }
    equal(
      scopeError?.code,
      'RESOLVED_BATCH_STORE_NOT_FOUND',
      'Wrong actor cannot list items',
    );
    recordGroup('actor scope isolation');
    scopeStore.close();

    const immutable = fixture(1);
    const immutableStore = new ResolvedBatchStore();
    const capturedItem = captured(immutable, 0);
    await immutableStore.createQueue(immutable.manifest, [capturedItem]);
    let immutableError;
    try {
      await immutableStore.updateItem(0, 1, {
        ...capturedItem,
        revision: 2,
        savedAt: Date.now(),
        intent: {
          ...capturedItem.intent,
          reservationBody: {
            ...capturedItem.intent.reservationBody,
            expectedChangeSequence: 1,
          },
        },
      });
    } catch (error) {
      immutableError = error;
    }
    equal(
      immutableError?.code,
      'RESOLVED_BATCH_JOURNAL_IMMUTABLE_FIELD',
      'Captured body rewrite rejected',
    );
    equal(
      (await immutableStore.readManifest(immutable.scope, immutable.queueId))
        ?.revision,
      0,
      'Rejected rewrite leaves manifest unchanged',
    );
    equal(
      (await immutableStore.listItems(immutable.scope, immutable.queueId))
        .items[0]?.revision,
      1,
      'Rejected rewrite leaves item unchanged',
    );
    recordGroup('captured intent body remains immutable');
    immutableStore.close();

    const wrapper = fixture(1);
    const wrapperDb = dbName();
    const wrapperStore = new ResolvedBatchStore();
    await wrapperStore.createQueue(wrapper.manifest, wrapper.items);
    await mutateItemRow(
      wrapperDb,
      wrapper.scope,
      wrapper.queueId,
      0,
      (row) => ({
        ...row,
        actorOperationKeys: ['invalid:operation-key'],
      }),
    );
    let wrapperError;
    try {
      await wrapperStore.listItems(wrapper.scope, wrapper.queueId);
    } catch (error) {
      wrapperError = error;
    }
    equal(
      wrapperError?.code,
      'RESOLVED_BATCH_STORE_CORRUPT',
      'Wrapper tamper rejected',
    );
    recordGroup('stored wrapper tampering fails closed');
    wrapperStore.close();

    const binding = fixture(1);
    const bindingDb = dbName();
    const bindingStore = new ResolvedBatchStore();
    await bindingStore.createQueue(binding.manifest, binding.items);
    await mutateItemRow(bindingDb, binding.scope, binding.queueId, 0, (row) => {
      const item = JSON.parse(row.serialized);
      item.capturedSessionId = 'different-opaque-session';
      return { ...row, serialized: JSON.stringify(item) };
    });
    let bindingError;
    try {
      await bindingStore.listItems(binding.scope, binding.queueId);
    } catch (error) {
      bindingError = error;
    }
    equal(
      bindingError?.code,
      'RESOLVED_BATCH_STORE_CORRUPT',
      'Item session mismatch rejected',
    );
    recordGroup('item-to-manifest session mismatch fails closed');
    bindingStore.close();

    const policyFixture = fixture(1);
    const policyDb = dbName();
    const policyStore = new ResolvedBatchStore();
    await policyStore.createQueue(policyFixture.manifest, policyFixture.items);
    await mutateItemRow(
      policyDb,
      policyFixture.scope,
      policyFixture.queueId,
      0,
      (row) => {
        const item = JSON.parse(row.serialized);
        item.policy = { expectedMode: 'manual', projectRevision: 1 };
        return { ...row, serialized: JSON.stringify(item) };
      },
    );
    let policyError;
    try {
      await policyStore.listItems(policyFixture.scope, policyFixture.queueId);
    } catch (error) {
      policyError = error;
    }
    equal(
      policyError?.code,
      'RESOLVED_BATCH_STORE_CORRUPT',
      'Item policy mismatch rejected',
    );
    recordGroup('item-to-manifest policy mismatch fails closed');
    policyStore.close();

    const updateBinding = fixture(1);
    const updateBindingDb = dbName();
    const updateBindingStore = new ResolvedBatchStore();
    await updateBindingStore.createQueue(
      updateBinding.manifest,
      updateBinding.items,
    );
    await mutateItemRow(
      updateBindingDb,
      updateBinding.scope,
      updateBinding.queueId,
      0,
      (row) => {
        const item = JSON.parse(row.serialized);
        item.capturedSessionId = 'different-opaque-session';
        return { ...row, serialized: JSON.stringify(item) };
      },
    );
    const changedRow = await readItemRow(
      updateBindingDb,
      updateBinding.scope,
      updateBinding.queueId,
      0,
    );
    const changedItem = JSON.parse(changedRow.serialized);
    let updateBindingError;
    try {
      await updateBindingStore.updateItem(0, 0, {
        ...changedItem,
        revision: 1,
        savedAt: Date.now(),
        state: 'cancelled',
      });
    } catch (error) {
      updateBindingError = error;
    }
    equal(
      updateBindingError?.code,
      'RESOLVED_BATCH_STORE_CORRUPT',
      'Update rejects item not bound to manifest',
    );
    equal(
      (
        await updateBindingStore.readManifest(
          updateBinding.scope,
          updateBinding.queueId,
        )
      )?.revision,
      0,
      'Rejected tampered update leaves manifest unchanged',
    );
    recordGroup('updateItem checks target binding against manifest');
    updateBindingStore.close();

    const rollback = fixture(1);
    const rollbackStore = new ResolvedBatchStore();
    await rollbackStore.createQueue(rollback.manifest, rollback.items);
    const oldManifest = await rollbackStore.readManifest(
      rollback.scope,
      rollback.queueId,
    );
    const oldItem = (
      await rollbackStore.listItems(rollback.scope, rollback.queueId)
    ).items[0];
    const putImpl = IDBObjectStore.prototype.put;
    let puts = 0;
    IDBObjectStore.prototype.put = function (...args) {
      const request = putImpl.apply(this, args);
      puts++;
      if (puts === 2) this.transaction.abort();
      return request;
    };
    let abortError;
    try {
      await rollbackStore.updateItem(0, 0, {
        ...rollback.items[0],
        revision: 1,
        savedAt: Date.now(),
        state: 'cancelled',
      });
    } catch (error) {
      abortError = error;
    } finally {
      IDBObjectStore.prototype.put = putImpl;
    }
    check(abortError, 'Forced native abort rejects the update');
    equal(puts, 2, 'Abort follows both queued writes');
    equal(
      JSON.stringify(
        await rollbackStore.readManifest(rollback.scope, rollback.queueId),
      ),
      JSON.stringify(oldManifest),
      'Abort rolls back manifest',
    );
    equal(
      JSON.stringify(
        (await rollbackStore.listItems(rollback.scope, rollback.queueId))
          .items[0],
      ),
      JSON.stringify(oldItem),
      'Abort rolls back item',
    );
    recordGroup('native transaction abort rolls back manifest and target');
    rollbackStore.close();

    const scan = fixture(1);
    const scanDb = dbName();
    const scanStore = new ResolvedBatchStore();
    await scanStore.createQueue(scan.manifest, [
      captured(scan, 0, { uploadSessionId: id() }),
    ]);
    const rawDb = await openDatabase(scanDb);
    const scanTx = rawDb.transaction(
      ['manifests', RESOLVED_BATCH_ITEM_STORE_NAME],
      'readonly',
    );
    const scanDone = transactionDone(scanTx);
    const manifestRequest = scanTx
      .objectStore('manifests')
      .get([
        scan.scope.actorId.toLowerCase(),
        scan.scope.workspaceId.toLowerCase(),
        scan.scope.projectId.toLowerCase(),
        scan.scope.albumId.toLowerCase(),
        scan.queueId.toLowerCase(),
      ]);
    const itemRequest = scanTx
      .objectStore(RESOLVED_BATCH_ITEM_STORE_NAME)
      .get(itemKey(scan.scope, scan.queueId, 0));
    const [manifestRow, itemRow] = await Promise.all([
      requestResult(manifestRequest),
      requestResult(itemRequest),
    ]);
    const manifestRows = manifestRow ? [manifestRow] : [];
    const itemRows = itemRow ? [itemRow] : [];
    await scanDone;
    rawDb.close();
    check(
      manifestRows.length === 1 && itemRows.length === 1,
      'Synthetic metadata rows exist',
    );
    const forbiddenKey =
      /signed.?url|presigned|object.?key|authorization|cookie|capability|preview.?url|session.?token/iu;
    const forbiddenValue = /https?:\/\/|blob:|x-amz-signature|bearer\s/iu;
    function inspect(value) {
      if (typeof File !== 'undefined' && value instanceof File)
        throw new Error('File object persisted');
      if (typeof Blob !== 'undefined' && value instanceof Blob)
        throw new Error('Blob object persisted');
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          check(!forbiddenKey.test(key), 'Capability key persisted: ' + key);
          inspect(child);
        }
      }
      if (typeof value === 'string')
        check(!forbiddenValue.test(value), 'Capability value persisted');
    }
    inspect(manifestRows);
    inspect(itemRows);
    recordGroup('persisted rows are metadata-only without capability fields');
    scanStore.close();

    return {
      groups,
      metrics: { ...metrics, boundedPages: 42 },
      reload: {
        databaseName: pagesDb,
        scope: pages.scope,
        queueId: pages.queueId,
        afterOrdinal: 23,
      },
    };
  });
}

async function reloadCheck(page, details) {
  await page.reload({ waitUntil: 'load' });
  return page.evaluate(async (input) => {
    const { ResolvedBatchStore } = globalThis.__resolvedBatchModules.store;
    const store = new ResolvedBatchStore();
    const page = await store.listItems(
      input.scope,
      input.queueId,
      input.afterOrdinal,
      24,
    );
    if (page.items.length !== 24 || page.items[0]?.descriptor.ordinal !== 24)
      throw new Error('Second page did not survive reload');
    const item = page.items[0];
    await store.updateItem(page.manifestRevision, item.revision, {
      ...item,
      revision: item.revision + 1,
      savedAt: Math.max(Date.now(), item.savedAt),
      state: 'cancelled',
    });
    const manifest = await store.readManifest(input.scope, input.queueId);
    const checked = await store.listItems(input.scope, input.queueId, 23, 24);
    store.close();
    if (manifest?.revision !== 1 || checked.items[0]?.state !== 'cancelled')
      throw new Error('Reloaded update did not commit');
    return {
      secondPageLength: page.items.length,
      manifestRevision: manifest.revision,
      itemState: checked.items[0].state,
    };
  }, details);
}

async function raceChecks(browser, origin) {
  const context = await browser.newContext();
  const firstPage = await context.newPage();
  const secondPage = await context.newPage();
  try {
    await Promise.all([firstPage.goto(origin), secondPage.goto(origin)]);
    const record = await firstPage.evaluate(() => {
      const id = () => crypto.randomUUID();
      const scope = {
        actorId: id(),
        workspaceId: id(),
        projectId: id(),
        albumId: id(),
      };
      const queueId = id();
      const now = Date.now();
      const policy = { expectedMode: 'assisted', projectRevision: 1 };
      const descriptor = {
        id: id(),
        ordinal: 0,
        originalFilename: 'cas-race.png',
        expectedBytes: 1,
        contentType: 'image/png',
        lastModified: 0,
      };
      const manifest = {
        version: 1,
        scope,
        queueId,
        capturedSessionId: 'opaque-race-session',
        policy,
        revision: 0,
        createdAt: now,
        savedAt: now,
        descriptors: [descriptor],
      };
      const item = {
        version: 1,
        scope,
        queueId,
        capturedSessionId: manifest.capturedSessionId,
        policy,
        descriptor,
        revision: 0,
        state: 'queued',
        intent: null,
        createdAt: now,
        savedAt: now,
      };
      return { scope, queueId, manifest, item };
    });
    const databaseName = await firstPage.evaluate(
      () =>
        globalThis.__resolvedBatchModules.store.RESOLVED_BATCH_DATABASE_NAME,
    );
    await firstPage.evaluate(
      async (input) => {
        const { ResolvedBatchStore } = globalThis.__resolvedBatchModules.store;
        const store = new ResolvedBatchStore();
        await store.createQueue(input.manifest, [input.item]);
        store.close();
      },
      { databaseName, manifest: record.manifest, item: record.item },
    );
    async function prepare(page) {
      return page.evaluate(
        async (input) => {
          const { ResolvedBatchStore } =
            globalThis.__resolvedBatchModules.store;
          const store = new ResolvedBatchStore();
          try {
            const manifest = await store.readManifest(
              input.scope,
              input.queueId,
            );
            const items = await store.listItems(
              input.scope,
              input.queueId,
              null,
              1,
            );
            return {
              manifestRevision: manifest.revision,
              item: items.items[0],
            };
          } finally {
            store.close();
          }
        },
        { databaseName, scope: record.scope, queueId: record.queueId },
      );
    }
    const prepared = await Promise.all([
      prepare(firstPage),
      prepare(secondPage),
    ]);
    assert.equal(prepared[0].manifestRevision, prepared[1].manifestRevision);
    assert.equal(prepared[0].item.revision, prepared[1].item.revision);
    async function attempt(page, snapshot) {
      return page.evaluate(
        async (input) => {
          const { ResolvedBatchStore } =
            globalThis.__resolvedBatchModules.store;
          const store = new ResolvedBatchStore();
          try {
            const item = input.item;
            const result = await store.updateItem(
              input.manifestRevision,
              item.revision,
              {
                ...item,
                revision: item.revision + 1,
                savedAt: Math.max(Date.now(), item.savedAt),
                state: 'cancelled',
              },
            );
            return { ok: true, revision: result.manifest.revision };
          } catch (error) {
            return { ok: false, code: error?.code ?? null };
          } finally {
            store.close();
          }
        },
        {
          databaseName,
          manifestRevision: snapshot.manifestRevision,
          item: snapshot.item,
        },
      );
    }
    const attempts = await Promise.all([
      attempt(firstPage, prepared[0]),
      attempt(secondPage, prepared[1]),
    ]);
    assert.equal(attempts.filter((item) => item.ok).length, 1);
    assert.equal(attempts.filter((item) => !item.ok).length, 1);
    assert.equal(
      attempts.find((item) => !item.ok)?.code,
      'RESOLVED_BATCH_STORE_CONFLICT',
    );
    return {
      attempts,
      winnerRevision: attempts.find((item) => item.ok).revision,
    };
  } finally {
    await context.close();
  }
}

async function quotaCheck(browser, origin) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(origin);
    const cdp = await context.newCDPSession(page);
    try {
      await cdp.send('Storage.overrideQuotaForOrigin', {
        origin,
        quotaSize: 1,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /wasn.t found|not found|method.*not.*found|unknown method/iu.test(
          message,
        )
      )
        return {
          status: 'not_checked',
          detail: 'CDP quota override unsupported',
          populatedQuotaLowering: 'not_checked',
        };
      throw error;
    }
    const outcome = await page.evaluate(async () => {
      const { ResolvedBatchStore } = globalThis.__resolvedBatchModules.store;
      const id = () => crypto.randomUUID();
      const scope = {
        actorId: id(),
        workspaceId: id(),
        projectId: id(),
        albumId: id(),
      };
      const queueId = id();
      const policy = { expectedMode: 'assisted', projectRevision: 1 };
      const now = Date.now();
      const descriptors = Array.from({ length: 1000 }, (_, ordinal) => ({
        id: id(),
        ordinal,
        originalFilename: 'fresh-quota-' + ordinal + '.png',
        expectedBytes: 1,
        contentType: 'image/png',
        lastModified: ordinal,
      }));
      const manifest = {
        version: 1,
        scope,
        queueId,
        capturedSessionId: 'opaque-fresh-quota-session',
        policy,
        revision: 0,
        createdAt: now,
        savedAt: now,
        descriptors,
      };
      const items = descriptors.map((descriptor) => ({
        version: 1,
        scope,
        queueId,
        capturedSessionId: manifest.capturedSessionId,
        policy,
        descriptor,
        revision: 0,
        state: 'queued',
        intent: null,
        createdAt: now,
        savedAt: now,
      }));
      const store = new ResolvedBatchStore();
      try {
        await store.createQueue(manifest, items);
        return { threw: false };
      } catch (error) {
        return {
          threw: true,
          name: error?.name ?? null,
          code: error?.code ?? null,
        };
      } finally {
        store.close();
      }
    });
    assert.equal(outcome.threw, true);
    assert.equal(outcome.name, 'QuotaExceededError');
    return {
      status: 'passed',
      detail:
        'Fresh empty browser context rejects the 1000-row metadata write at a 1-byte quota.',
      nativeError: outcome.name,
      existingDataPreservation:
        'covered by the separate native transaction-abort rollback group',
      populatedQuotaLowering: 'not_checked',
    };
  } finally {
    await context.close();
  }
}
export async function runResolvedBatchStoreBrowserChecks() {
  const bundle = await bundleSource();
  const origin = await startOrigin(bundle);
  const browser = await chromium.launch({ headless: true });
  let summary;
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(origin.origin, { waitUntil: 'load' });
    await page.waitForFunction(() =>
      Boolean(globalThis.__resolvedBatchModules?.store?.ResolvedBatchStore),
    );
    const core = await runCore(page);
    const reload = await reloadCheck(page, core.reload);
    const race = await raceChecks(browser, origin.origin);
    const quota = await quotaCheck(browser, origin.origin);
    assert.deepEqual(pageErrors, [], 'Harness page emitted a browser error');
    await context.close();
    summary = {
      status: 'passed',
      browser: 'Chromium',
      groups: [
        ...core.groups,
        { name: 'reload and second-page commit', ...reload },
        { name: 'two-page same-revision CAS race', ...race },
        { name: 'native fresh-context quota rejection', ...quota },
      ],
      metrics: core.metrics,
      pageErrors,
      boundaries: {
        realStoreAndJournalBundle: true,
        nativeIndexedDB: true,
        metadataOnlyFixtures: true,
        physicalPowerLoss: 'not_checked',
        physicalR2: 'not_checked',
        productUI: 'not_checked',
        realOAuth: 'not_checked',
      },
    };
  } finally {
    await browser.close();
    await origin.close();
  }
  await mkdir(localDirectory, { recursive: true });
  const artifactPath = join(
    localDirectory,
    'm3i5a-resolved-batch-browser-' + randomUUID() + '.json',
  );
  await writeFile(
    artifactPath,
    JSON.stringify(summary, null, 2) + '\n',
    'utf8',
  );
  return { ...summary, artifactPath };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runResolvedBatchStoreBrowserChecks()
    .then((result) =>
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'),
    )
    .catch((error) => {
      process.stderr.write(
        JSON.stringify(
          {
            status: 'failed',
            error:
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
          },
          null,
          2,
        ) + '\n',
      );
      process.exitCode = 1;
    });
}
