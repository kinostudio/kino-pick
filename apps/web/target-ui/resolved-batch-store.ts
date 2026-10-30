import {
  assertResolvedBatchItemUpdate,
  assertResolvedBatchManifestTouch,
  decodeResolvedBatchItemEnvelope,
  decodeResolvedBatchManifest,
  encodeResolvedBatchItemEnvelope,
  encodeResolvedBatchManifest,
  resolvedBatchJournalLimits,
  resolvedBatchJournalScopeSchema,
  validateResolvedBatchItemEnvelope,
  validateResolvedBatchQueue,
  type ResolvedBatchItemEnvelope,
  type ResolvedBatchJournalScope,
  type ResolvedBatchManifest,
} from './resolved-batch-journal';

export const RESOLVED_BATCH_DATABASE_NAME = 'kino-pic-resolved-batch-journal';
export const RESOLVED_BATCH_DATABASE_VERSION = 1;
export const RESOLVED_BATCH_MANIFEST_STORE_NAME = 'manifests';
export const RESOLVED_BATCH_ITEM_STORE_NAME = 'items';

const manifestStoreName = RESOLVED_BATCH_MANIFEST_STORE_NAME;
const itemStoreName = RESOLVED_BATCH_ITEM_STORE_NAME;
const queueOrdinalIndexName = 'scopeQueueOrdinal';
const actorOperationIndexName = 'actorOperationKey';
const maximumOpenBlockedMs = 2_000;
const pageSizeLimit = 24;
const maximumItems = 1_000;

const identityFields = [
  'actorKey',
  'workspaceKey',
  'projectKey',
  'albumKey',
  'queueKey',
] as const;

type IdentityField = (typeof identityFields)[number];

type DatabaseIdentity = Record<IdentityField, string>;

type ManifestRecord = DatabaseIdentity & {
  serialized: string;
};

type ItemRecord = DatabaseIdentity & {
  ordinal: number;
  actorOperationKeys: string[];
  actorUploadSessionKey?: string;
  serialized: string;
};

export type ResolvedBatchStoreErrorCode =
  | 'RESOLVED_BATCH_STORE_CLOSED'
  | 'RESOLVED_BATCH_STORE_UNAVAILABLE'
  | 'RESOLVED_BATCH_STORE_OPEN_FAILED'
  | 'RESOLVED_BATCH_STORE_BLOCKED'
  | 'RESOLVED_BATCH_STORE_VERSION_CHANGED'
  | 'RESOLVED_BATCH_STORE_CORRUPT'
  | 'RESOLVED_BATCH_STORE_NOT_FOUND'
  | 'RESOLVED_BATCH_STORE_CONFLICT'
  | 'RESOLVED_BATCH_STORE_TOO_MANY_ITEMS'
  | 'RESOLVED_BATCH_STORE_QUEUE_EXISTS'
  | 'RESOLVED_BATCH_STORE_OPERATION_UUID_CONFLICT'
  | 'RESOLVED_BATCH_STORE_UPLOAD_SESSION_CONFLICT'
  | 'RESOLVED_BATCH_STORE_UNIQUE_CONFLICT';

export class ResolvedBatchStoreError extends Error {
  constructor(
    public readonly code: ResolvedBatchStoreErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ResolvedBatchStoreError';
  }
}

export type ResolvedBatchItemPage = Readonly<{
  items: readonly ResolvedBatchItemEnvelope[];
  manifestRevision: number;
  nextAfterOrdinal: number | null;
}>;

function normalizedUuid(value: string) {
  return value.toLowerCase();
}

function databaseIdentity(
  scope: ResolvedBatchJournalScope,
  queueId: string,
): DatabaseIdentity {
  const parsedScope = resolvedBatchJournalScopeSchema.parse(scope);
  if (typeof queueId !== 'string')
    throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
  return {
    actorKey: normalizedUuid(parsedScope.actorId),
    workspaceKey: normalizedUuid(parsedScope.workspaceId),
    projectKey: normalizedUuid(parsedScope.projectId),
    albumKey: normalizedUuid(parsedScope.albumId),
    queueKey: normalizedUuid(queueId),
  };
}

function manifestKey(identity: DatabaseIdentity): IDBValidKey[] {
  return identityFields.map((field) => identity[field]);
}

function itemKey(identity: DatabaseIdentity, ordinal: number): IDBValidKey[] {
  return [...manifestKey(identity), ordinal];
}

function ordinalRange(
  identity: DatabaseIdentity,
  afterOrdinal: number | null = null,
) {
  const prefix = manifestKey(identity) as string[];
  const lower = [...prefix, afterOrdinal ?? -1];
  const upper = [...prefix, Number.MAX_SAFE_INTEGER];
  return IDBKeyRange.bound(lower, upper, afterOrdinal !== null, false);
}

function operationKeys(item: ResolvedBatchItemEnvelope) {
  const intent = item.intent;
  if (!intent) return [];
  const keys = [
    intent.reservationBody.requestId,
    intent.authorizeBody.requestId,
    intent.completeBody.requestId,
  ].map(
    (requestId) =>
      normalizedUuid(item.scope.actorId) + ':' + normalizedUuid(requestId),
  );
  if (new Set(keys).size !== keys.length)
    throw new ResolvedBatchStoreError(
      'RESOLVED_BATCH_STORE_OPERATION_UUID_CONFLICT',
    );
  return keys;
}

function uploadSessionKey(item: ResolvedBatchItemEnvelope) {
  const sessionId = item.intent?.reservation?.uploadSession.id;
  return sessionId
    ? normalizedUuid(item.scope.actorId) + ':' + normalizedUuid(sessionId)
    : undefined;
}

function makeManifestRecord(
  manifest: ResolvedBatchManifest,
  serialized: string,
): ManifestRecord {
  return {
    ...databaseIdentity(manifest.scope, manifest.queueId),
    serialized,
  };
}

function makeItemRecord(
  item: ResolvedBatchItemEnvelope,
  serialized: string,
): ItemRecord {
  const sessionKey = uploadSessionKey(item);
  return {
    ...databaseIdentity(item.scope, item.queueId),
    ordinal: item.descriptor.ordinal,
    actorOperationKeys: operationKeys(item),
    ...(sessionKey ? { actorUploadSessionKey: sessionKey } : {}),
    serialized,
  };
}

function assertRecordIdentity(
  record: ManifestRecord | ItemRecord,
  expected: DatabaseIdentity,
) {
  const allowedFields =
    'ordinal' in record
      ? [
          ...identityFields,
          'ordinal',
          'actorOperationKeys',
          ...(record.actorUploadSessionKey
            ? ['actorUploadSessionKey' as const]
            : []),
          'serialized',
        ]
      : [...identityFields, 'serialized'];
  const allowedFieldSet = new Set<string>(allowedFields);
  if (
    identityFields.some((field) => record[field] !== expected[field]) ||
    Object.keys(record).length !== allowedFields.length ||
    !Object.keys(record).every((field) => allowedFieldSet.has(field)) ||
    typeof record.serialized !== 'string'
  )
    throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
}

function waitForTransaction(
  transaction: IDBTransaction,
  getRequestFailure: () => unknown = () => undefined,
) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => {
      const requestFailure = getRequestFailure();
      if (requestFailure) reject(requestFailure);
      else resolve();
    });
    transaction.addEventListener('abort', () => {
      reject(
        getRequestFailure() ??
          transaction.error ??
          new DOMException('IndexedDB transaction aborted', 'AbortError'),
      );
    });
  });
}

function beginTransaction(
  database: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
) {
  try {
    return database.transaction(stores, mode, { durability: 'strict' });
  } catch (error) {
    if (error instanceof TypeError) return database.transaction(stores, mode);
    throw error;
  }
}

function createStores(database: IDBDatabase) {
  const manifests = database.createObjectStore(manifestStoreName, {
    keyPath: [...identityFields],
  });
  manifests.createIndex('scope', [...identityFields], { unique: true });

  const items = database.createObjectStore(itemStoreName, {
    keyPath: [...identityFields, 'ordinal'],
  });
  items.createIndex(queueOrdinalIndexName, [...identityFields, 'ordinal'], {
    unique: true,
  });
  items.createIndex(actorOperationIndexName, 'actorOperationKeys', {
    unique: true,
    multiEntry: true,
  });
  items.createIndex('actorUploadSessionKey', 'actorUploadSessionKey', {
    unique: true,
  });
}

function assertExistingSchema(database: IDBDatabase) {
  if (
    !database.objectStoreNames.contains(manifestStoreName) ||
    !database.objectStoreNames.contains(itemStoreName)
  )
    throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
  const transaction = database.transaction(
    [manifestStoreName, itemStoreName],
    'readonly',
  );
  if (
    !transaction.objectStore(manifestStoreName).indexNames.contains('scope') ||
    !transaction
      .objectStore(itemStoreName)
      .indexNames.contains(queueOrdinalIndexName) ||
    !transaction
      .objectStore(itemStoreName)
      .indexNames.contains(actorOperationIndexName) ||
    !transaction
      .objectStore(itemStoreName)
      .indexNames.contains('actorUploadSessionKey')
  ) {
    transaction.abort();
    throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
  }
  const manifestStore = transaction.objectStore(manifestStoreName);
  const itemStore = transaction.objectStore(itemStoreName);
  if (
    JSON.stringify(manifestStore.keyPath) !== JSON.stringify(identityFields) ||
    JSON.stringify(itemStore.keyPath) !==
      JSON.stringify([...identityFields, 'ordinal'])
  ) {
    transaction.abort();
    throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
  }
  const manifestScope = manifestStore.index('scope');
  const queueOrdinal = itemStore.index(queueOrdinalIndexName);
  const actorOperation = itemStore.index(actorOperationIndexName);
  const actorSession = itemStore.index('actorUploadSessionKey');
  if (
    JSON.stringify(manifestScope.keyPath) !== JSON.stringify(identityFields) ||
    !manifestScope.unique ||
    JSON.stringify(queueOrdinal.keyPath) !==
      JSON.stringify([...identityFields, 'ordinal']) ||
    !queueOrdinal.unique ||
    actorOperation.keyPath !== 'actorOperationKeys' ||
    !actorOperation.unique ||
    !actorOperation.multiEntry ||
    actorSession.keyPath !== 'actorUploadSessionKey' ||
    !actorSession.unique ||
    actorSession.multiEntry
  ) {
    transaction.abort();
    throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
  }
}

function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
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

export class ResolvedBatchStore {
  #database: IDBDatabase | null = null;
  #openPromise: Promise<IDBDatabase> | null = null;
  #closed = false;
  #versionChanged = false;

  close() {
    this.#closed = true;
    this.#database?.close();
    this.#database = null;
    this.#openPromise = null;
  }

  async createQueue(manifestInput: unknown, itemInputs: readonly unknown[]) {
    if (itemInputs.length > maximumItems)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_TOO_MANY_ITEMS');

    const now = Date.now();
    const snapshot = validateResolvedBatchQueue(manifestInput, itemInputs, now);
    if (snapshot.items.length > resolvedBatchJournalLimits().maxDescriptors)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_TOO_MANY_ITEMS');

    const encodedManifest = encodeResolvedBatchManifest(snapshot.manifest, now);
    const encodedItems = snapshot.items.map((item) =>
      encodeResolvedBatchItemEnvelope(item, now),
    );
    const manifestRow = makeManifestRecord(snapshot.manifest, encodedManifest);
    const itemRows = snapshot.items.map((item, index) =>
      makeItemRecord(item, encodedItems[index] ?? ''),
    );

    const normalizedOperationKeys = new Set<string>();
    const normalizedSessionKeys = new Set<string>();
    for (const row of itemRows) {
      for (const key of row.actorOperationKeys) {
        if (normalizedOperationKeys.has(key))
          throw new ResolvedBatchStoreError(
            'RESOLVED_BATCH_STORE_OPERATION_UUID_CONFLICT',
          );
        normalizedOperationKeys.add(key);
      }
      if (row.actorUploadSessionKey) {
        if (normalizedSessionKeys.has(row.actorUploadSessionKey))
          throw new ResolvedBatchStoreError(
            'RESOLVED_BATCH_STORE_UPLOAD_SESSION_CONFLICT',
          );
        normalizedSessionKeys.add(row.actorUploadSessionKey);
      }
    }

    const database = await this.#open();
    const transaction = beginTransaction(
      database,
      [manifestStoreName, itemStoreName],
      'readwrite',
    );
    let requestFailure: unknown;
    let constraintFailureStore: 'manifest' | 'item' | null = null;
    const completion = waitForTransaction(transaction, () => requestFailure);
    const manifests = transaction.objectStore(manifestStoreName);
    const items = transaction.objectStore(itemStoreName);
    try {
      const manifestRequest = manifests.add(manifestRow);
      manifestRequest.addEventListener('error', () => {
        requestFailure ??= manifestRequest.error ?? undefined;
        if (manifestRequest.error?.name === 'ConstraintError')
          constraintFailureStore = 'manifest';
      });
      for (const row of itemRows) {
        const request = items.add(row);
        request.addEventListener('error', () => {
          requestFailure ??= request.error ?? undefined;
          if (request.error?.name === 'ConstraintError')
            constraintFailureStore = 'item';
        });
      }
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The original synchronous IndexedDB error is the useful result.
      }
      await completion.catch(() => undefined);
      throw error;
    }

    try {
      await completion;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'ConstraintError') {
        throw new ResolvedBatchStoreError(
          constraintFailureStore === 'item'
            ? 'RESOLVED_BATCH_STORE_UNIQUE_CONFLICT'
            : 'RESOLVED_BATCH_STORE_QUEUE_EXISTS',
          { cause: error },
        );
      }
      throw error;
    }
    return snapshot.manifest;
  }

  async readManifest(
    scope: ResolvedBatchJournalScope,
    queueId: string,
  ): Promise<ResolvedBatchManifest | null> {
    const identity = databaseIdentity(scope, queueId);
    const database = await this.#open();
    const transaction = beginTransaction(
      database,
      manifestStoreName,
      'readonly',
    );
    const completion = waitForTransaction(transaction);
    const request = transaction
      .objectStore(manifestStoreName)
      .get(manifestKey(identity)) as IDBRequest<ManifestRecord | undefined>;
    let record: ManifestRecord | undefined;
    try {
      record = await idbRequest(request);
      await completion;
    } catch (error) {
      await completion.catch(() => undefined);
      throw error;
    }
    if (!record) return null;
    assertRecordIdentity(record, identity);
    const manifest = decodeResolvedBatchManifest(
      record.serialized,
      scope,
      Date.now(),
      queueId,
    );
    if (!manifest)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
    return manifest;
  }

  async listItems(
    scope: ResolvedBatchJournalScope,
    queueId: string,
    afterOrdinal: number | null = null,
    limit = pageSizeLimit,
  ): Promise<ResolvedBatchItemPage> {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > pageSizeLimit ||
      (afterOrdinal !== null &&
        (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0))
    )
      throw new RangeError('Resolved batch page bounds are invalid');

    const identity = databaseIdentity(scope, queueId);
    const database = await this.#open();
    const transaction = beginTransaction(
      database,
      [manifestStoreName, itemStoreName],
      'readonly',
    );
    const completion = waitForTransaction(transaction);
    const manifestRequest = transaction
      .objectStore(manifestStoreName)
      .get(manifestKey(identity)) as IDBRequest<ManifestRecord | undefined>;
    const cursorRequest = transaction
      .objectStore(itemStoreName)
      .index(queueOrdinalIndexName)
      .openCursor(ordinalRange(identity, afterOrdinal));
    let manifest: ResolvedBatchManifest | null = null;
    let manifestReady = false;
    let cursorFinished = false;
    const page: ResolvedBatchItemEnvelope[] = [];
    let lookaheadItem: ResolvedBatchItemEnvelope | null = null;
    let hasMore = false;
    let failure: unknown;

    const abort = (error: unknown) => {
      if (failure) return;
      failure = error;
      try {
        transaction.abort();
      } catch {
        // The transaction may already be closing; completion reports its state.
      }
    };

    manifestRequest.onerror = () => abort(manifestRequest.error);
    manifestRequest.onsuccess = () => {
      try {
        const record = manifestRequest.result;
        if (!record)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_NOT_FOUND');
        assertRecordIdentity(record, identity);
        manifest = decodeResolvedBatchManifest(
          record.serialized,
          scope,
          Date.now(),
          queueId,
        );
        if (!manifest)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
        manifestReady = true;
        if (cursorFinished) validatePage();
      } catch (error) {
        abort(error);
      }
    };

    const validatePage = () => {
      if (failure || !manifest) return;
      const startOrdinal = afterOrdinal === null ? 0 : afterOrdinal + 1;
      const remainingItems = Math.max(
        0,
        manifest.descriptors.length - startOrdinal,
      );
      const expectedPageLength = Math.min(limit, remainingItems);
      if (
        page.length !== expectedPageLength ||
        hasMore !== remainingItems > limit ||
        hasMore !== (lookaheadItem !== null)
      ) {
        abort(new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT'));
        return;
      }
      const checkedRows = lookaheadItem ? [...page, lookaheadItem] : page;
      for (const [index, item] of checkedRows.entries()) {
        const expected = manifest.descriptors[item.descriptor.ordinal];
        if (
          item.descriptor.ordinal !== startOrdinal + index ||
          !expected ||
          JSON.stringify(expected) !== JSON.stringify(item.descriptor) ||
          item.capturedSessionId !== manifest.capturedSessionId ||
          JSON.stringify(item.policy) !== JSON.stringify(manifest.policy)
        ) {
          abort(new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT'));
          return;
        }
      }
    };

    cursorRequest.onerror = () => abort(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      if (failure) return;
      const cursor = cursorRequest.result;
      if (!cursor) {
        cursorFinished = true;
        if (manifestReady) validatePage();
        return;
      }

      try {
        const row = cursor.value as ItemRecord;
        assertRecordIdentity(row, identity);
        const parsed = JSON.parse(row.serialized) as {
          descriptor?: { id?: string };
        };
        const itemId = parsed.descriptor?.id;
        if (!itemId)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
        const envelope = decodeResolvedBatchItemEnvelope(
          row.serialized,
          scope,
          queueId,
          itemId,
          Date.now(),
        );
        const expectedOperationKeys = envelope ? operationKeys(envelope) : [];
        if (
          !envelope ||
          row.ordinal !== envelope.descriptor.ordinal ||
          !Array.isArray(row.actorOperationKeys) ||
          row.actorOperationKeys.length !== expectedOperationKeys.length ||
          row.actorOperationKeys.some(
            (key, index) => key !== expectedOperationKeys[index],
          ) ||
          (row.actorUploadSessionKey ?? null) !==
            (uploadSessionKey(envelope) ?? null)
        )
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
        if (page.length < limit) {
          page.push(envelope);
          cursor.continue();
        } else {
          hasMore = true;
          lookaheadItem = envelope;
          cursorFinished = true;
          validatePage();
        }
      } catch (error) {
        abort(error);
      }
    };

    try {
      await completion;
    } catch (error) {
      throw failure ?? error;
    }
    const resolvedManifest = manifest as ResolvedBatchManifest | null;
    if (!resolvedManifest)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
    return {
      items: page,
      manifestRevision: resolvedManifest.revision,
      nextAfterOrdinal:
        hasMore && page.length > 0
          ? (page[page.length - 1]?.descriptor.ordinal ?? null)
          : null,
    };
  }

  async updateItem(
    expectedManifestRevision: number,
    expectedItemRevision: number,
    nextItemInput: ResolvedBatchItemEnvelope,
  ): Promise<{
    manifest: ResolvedBatchManifest;
    item: ResolvedBatchItemEnvelope;
  }> {
    const nextItem = validateResolvedBatchItemEnvelope(nextItemInput);
    const scope = nextItem.scope;
    const queueId = nextItem.queueId;
    const expectedIdentity = databaseIdentity(scope, queueId);
    const database = await this.#open();
    const transaction = beginTransaction(
      database,
      [manifestStoreName, itemStoreName],
      'readwrite',
    );
    let failure: unknown;
    let uniqueIndexConflict = false;
    const completion = waitForTransaction(transaction, () => failure);
    const manifestStore = transaction.objectStore(manifestStoreName);
    const itemStore = transaction.objectStore(itemStoreName);
    const manifestRequest = manifestStore.get(
      manifestKey(expectedIdentity),
    ) as IDBRequest<ManifestRecord | undefined>;
    const itemRequest = itemStore.get(
      itemKey(expectedIdentity, nextItem.descriptor.ordinal),
    ) as IDBRequest<ItemRecord | undefined>;
    let manifest: ResolvedBatchManifest | null = null;
    let manifestRow: ManifestRecord | undefined;
    let itemRow: ItemRecord | undefined;
    let storedItem: ResolvedBatchItemEnvelope | null = null;
    let manifestReady = false;
    let itemReady = false;
    let wrote = false;
    let committedManifest: ResolvedBatchManifest | null = null;
    let committedItem: ResolvedBatchItemEnvelope | null = null;

    const abort = (error: unknown) => {
      if (failure) return;
      failure = error;
      try {
        transaction.abort();
      } catch {
        // The transaction may already be closing; completion reports its state.
      }
    };

    const captureRequestError = (request: IDBRequest, isItemWrite = false) => {
      request.addEventListener(
        'error',
        () => {
          failure ??= request.error ?? undefined;
          if (
            isItemWrite &&
            request.error instanceof DOMException &&
            request.error.name === 'ConstraintError'
          )
            uniqueIndexConflict = true;
        },
        { once: true },
      );
    };
    captureRequestError(manifestRequest);
    captureRequestError(itemRequest);

    const commitUpdate = () => {
      if (
        failure ||
        !manifestReady ||
        !itemReady ||
        !manifest ||
        !storedItem ||
        !manifestRow ||
        !itemRow
      )
        return;
      const currentItemRow = itemRow as ItemRecord;
      try {
        if (manifest.revision !== expectedManifestRevision)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CONFLICT');
        const expectedDescriptor =
          manifest.descriptors[nextItem.descriptor.ordinal];
        if (
          !expectedDescriptor ||
          JSON.stringify(expectedDescriptor) !==
            JSON.stringify(nextItem.descriptor) ||
          storedItem.descriptor.ordinal !== nextItem.descriptor.ordinal ||
          JSON.stringify(storedItem.descriptor) !==
            JSON.stringify(expectedDescriptor) ||
          storedItem.capturedSessionId !== manifest.capturedSessionId ||
          JSON.stringify(storedItem.policy) !== JSON.stringify(manifest.policy)
        )
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');

        const checkedNextItem = assertResolvedBatchItemUpdate(
          storedItem,
          nextItem,
          expectedItemRevision,
          Date.now(),
        );
        const now = Math.max(Date.now(), manifest.savedAt);
        const nextManifest = assertResolvedBatchManifestTouch(
          manifest,
          { ...manifest, revision: manifest.revision + 1, savedAt: now },
          expectedManifestRevision,
          now,
        );
        const serializedItem = encodeResolvedBatchItemEnvelope(
          checkedNextItem,
          now,
        );
        const serializedManifest = encodeResolvedBatchManifest(
          nextManifest,
          now,
        );
        const nextRecord = makeItemRecord(checkedNextItem, serializedItem);
        if (
          identityFields.some(
            (field) => nextRecord[field] !== currentItemRow[field],
          ) ||
          nextRecord.ordinal !== currentItemRow.ordinal ||
          JSON.stringify(currentItemRow.actorOperationKeys) !==
            JSON.stringify(operationKeys(storedItem)) ||
          (currentItemRow.actorUploadSessionKey ?? null) !==
            (uploadSessionKey(storedItem) ?? null)
        )
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');

        const itemPut = itemStore.put(nextRecord);
        const manifestPut = manifestStore.put(
          makeManifestRecord(nextManifest, serializedManifest),
        );
        captureRequestError(itemPut, true);
        captureRequestError(manifestPut);
        committedManifest = nextManifest;
        committedItem = checkedNextItem;
        wrote = true;
      } catch (error) {
        abort(error);
      }
    };

    manifestRequest.onerror = () => abort(manifestRequest.error);
    manifestRequest.onsuccess = () => {
      try {
        manifestRow = manifestRequest.result;
        if (!manifestRow)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_NOT_FOUND');
        assertRecordIdentity(manifestRow, expectedIdentity);
        manifest = decodeResolvedBatchManifest(
          manifestRow.serialized,
          scope,
          Date.now(),
          queueId,
        );
        if (!manifest)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
        manifestReady = true;
        commitUpdate();
      } catch (error) {
        abort(error);
      }
    };

    itemRequest.onerror = () => abort(itemRequest.error);
    itemRequest.onsuccess = () => {
      try {
        itemRow = itemRequest.result;
        if (!itemRow)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_NOT_FOUND');
        assertRecordIdentity(itemRow, expectedIdentity);
        const parsed = JSON.parse(itemRow.serialized) as {
          descriptor?: { id?: string };
        };
        const itemId = parsed.descriptor?.id;
        if (!itemId)
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
        storedItem = decodeResolvedBatchItemEnvelope(
          itemRow.serialized,
          scope,
          queueId,
          itemId,
          Date.now(),
        );
        const expectedOperationKeys = storedItem
          ? operationKeys(storedItem)
          : [];
        if (
          !storedItem ||
          itemRow.ordinal !== storedItem.descriptor.ordinal ||
          !Array.isArray(itemRow.actorOperationKeys) ||
          itemRow.actorOperationKeys.length !== expectedOperationKeys.length ||
          itemRow.actorOperationKeys.some(
            (key, index) => key !== expectedOperationKeys[index],
          )
        )
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
        if (
          (itemRow.actorUploadSessionKey ?? null) !==
          (uploadSessionKey(storedItem) ?? null)
        )
          throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
        itemReady = true;
        commitUpdate();
      } catch (error) {
        abort(error);
      }
    };

    try {
      await completion;
    } catch (error) {
      const cause = failure ?? error;
      if (
        uniqueIndexConflict &&
        cause instanceof DOMException &&
        cause.name === 'ConstraintError'
      )
        throw new ResolvedBatchStoreError(
          'RESOLVED_BATCH_STORE_UNIQUE_CONFLICT',
          { cause },
        );
      throw cause;
    }
    if (!wrote || !committedManifest || !committedItem)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
    return { manifest: committedManifest, item: committedItem };
  }

  async #open() {
    if (this.#closed)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CLOSED');
    if (this.#versionChanged)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_VERSION_CHANGED');
    if (this.#database) return this.#database;
    if (this.#openPromise) return this.#openPromise;

    const factory = globalThis.indexedDB;
    if (!factory)
      throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_UNAVAILABLE');

    this.#openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false;
      let blockedTimer: ReturnType<typeof setTimeout> | undefined;
      let upgradeFailure: unknown;
      let request: IDBOpenDBRequest;
      const settleFailure = (error: unknown) => {
        if (settled) return;
        settled = true;
        if (blockedTimer) clearTimeout(blockedTimer);
        reject(error);
      };

      try {
        request = factory.open(
          RESOLVED_BATCH_DATABASE_NAME,
          RESOLVED_BATCH_DATABASE_VERSION,
        );
      } catch (error) {
        settleFailure(
          new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_OPEN_FAILED', {
            cause: error,
          }),
        );
        return;
      }

      request.onupgradeneeded = (event) => {
        try {
          if (event.oldVersion !== 0)
            throw new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CORRUPT');
          createStores(request.result);
        } catch (error) {
          upgradeFailure = error;
          try {
            request.transaction?.abort();
          } catch {
            // The open request will report the failed upgrade.
          }
        }
      };

      request.onblocked = () => {
        if (blockedTimer) return;
        blockedTimer = setTimeout(() => {
          settleFailure(
            new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_BLOCKED'),
          );
        }, maximumOpenBlockedMs);
      };

      request.onerror = () => {
        settleFailure(
          upgradeFailure ??
            new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_OPEN_FAILED', {
              cause: request.error ?? undefined,
            }),
        );
      };

      request.onsuccess = () => {
        const database = request.result;
        if (settled || this.#closed) {
          database.close();
          settleFailure(
            new ResolvedBatchStoreError('RESOLVED_BATCH_STORE_CLOSED'),
          );
          return;
        }
        if (blockedTimer) clearTimeout(blockedTimer);
        try {
          assertExistingSchema(database);
        } catch (error) {
          database.close();
          settleFailure(error);
          return;
        }
        database.onversionchange = () => {
          this.#versionChanged = true;
          database.close();
          if (this.#database === database) this.#database = null;
          this.#openPromise = null;
        };
        database.onclose = () => {
          if (this.#database === database) this.#database = null;
        };
        this.#database = database;
        settled = true;
        resolve(database);
      };
    });

    try {
      return await this.#openPromise;
    } catch (error) {
      this.#openPromise = null;
      throw error;
    }
  }
}
