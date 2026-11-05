'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import {
  guestCommentBodySchema,
  guestCommentCommandSchema,
  guestCommentResultSchema,
  guestCommentsCapabilitiesSchema,
  guestCommentsPageSchema,
  type GuestCommentCommand,
  type GuestCommentItem,
  type GuestCommentResult,
} from '../../../packages/contracts/src/guest-comments';
import type { CommentProcessingSnapshot } from '../../../packages/contracts/src/comment-processing';

type CommentTarget = { photoId: string; versionId: string };
type TargetLabel = CommentTarget & { filename: string };

const pendingMetadataSchema = z
  .object({
    version: z.literal(1),
    albumId: z.uuid(),
    expectedGuestId: z.uuid(),
    requestId: z.uuid(),
    operation: z.enum(['create', 'edit', 'delete', 'resolve', 'reopen']),
    targets: z
      .array(z.object({ photoId: z.uuid(), versionId: z.uuid() }).strict())
      .min(1)
      .max(24)
      .refine(
        (targets) =>
          new Set(targets.map((target) => target.photoId)).size ===
          targets.length,
      ),
    commentId: z.uuid().optional(),
    expectedRevision: z.number().int().positive().safe().optional(),
    bodySha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const create = value.operation === 'create';
    const hasBody = create || value.operation === 'edit';
    if (
      (create &&
        (value.commentId !== undefined ||
          value.expectedRevision !== undefined)) ||
      (!create &&
        (value.targets.length !== 1 ||
          value.commentId === undefined ||
          value.expectedRevision === undefined)) ||
      hasBody !== (value.bodySha256 !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid comment recovery metadata',
      });
    }
  });

type PendingMetadata = z.infer<typeof pendingMetadataSchema>;
type CapturedAttempt = {
  albumId: string;
  contextKey: string;
  generation: number;
  command: GuestCommentCommand;
  bodyJson: string;
  metadata: PendingMetadata;
  targets: TargetLabel[];
};
type OperationState =
  | {
      phase: 'pending' | 'uncertain';
      attempt: CapturedAttempt;
      message: string;
    }
  | {
      phase: 'conflict';
      attempt: CapturedAttempt;
      message: string;
      reloaded: boolean;
    }
  | { phase: 'recovery-required'; metadata: PendingMetadata; message: string }
  | {
      phase: 'storage-blocked';
      albumId: string;
      guestId: string;
      storageKey: string;
      message: string;
    };

const operationStore = new Map<string, OperationState>();
const operationListeners = new Map<string, Set<() => void>>();
const preparingCommands = new Set<string>();

function storeKey(albumId: string, guestId: string) {
  return JSON.stringify([albumId, guestId]);
}

function storedOperation(key: string) {
  return key ? (operationStore.get(key) ?? null) : null;
}

function subscribeOperation(key: string, listener: () => void) {
  if (!key) return () => undefined;
  let listeners = operationListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    operationListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    const active = operationListeners.get(key);
    active?.delete(listener);
    if (active?.size === 0) operationListeners.delete(key);
  };
}

function publishOperation(key: string, value: OperationState | null) {
  if (!key) return;
  if (value === null) operationStore.delete(key);
  else operationStore.set(key, value);
  for (const listener of operationListeners.get(key) ?? []) listener();
}

function useAlbumOperation(albumId: string, guestId: string | null) {
  const key = guestId ? storeKey(albumId, guestId) : '';
  const subscribe = useCallback(
    (listener: () => void) => subscribeOperation(key, listener),
    [key],
  );
  const getSnapshot = useCallback(() => storedOperation(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

function metadataForOperation(
  operation: OperationState,
): PendingMetadata | null {
  if (operation.phase === 'storage-blocked') return null;
  return operation.phase === 'recovery-required'
    ? operation.metadata
    : operation.attempt.metadata;
}

function sessionStorageKey(
  metadata: Pick<PendingMetadata, 'albumId' | 'expectedGuestId'>,
) {
  return (
    'kino-pic:guest-comments:pending:' +
    encodeURIComponent(metadata.albumId) +
    ':' +
    encodeURIComponent(metadata.expectedGuestId)
  );
}

function getSessionStorage() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function saveMetadata(metadata: PendingMetadata) {
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(sessionStorageKey(metadata), JSON.stringify(metadata));
    return true;
  } catch {
    return false;
  }
}

type MetadataRead =
  | { status: 'ready'; metadata: PendingMetadata | null }
  | { status: 'blocked'; storageKey: string };

function loadMetadata(albumId: string, guestId: string): MetadataRead {
  const storageKey = sessionStorageKey({ albumId, expectedGuestId: guestId });
  const storage = getSessionStorage();
  if (!storage) return { status: 'blocked', storageKey };
  try {
    const raw = storage.getItem(storageKey);
    if (raw === null) return { status: 'ready', metadata: null };
    const result = pendingMetadataSchema.safeParse(JSON.parse(raw));
    if (
      !result.success ||
      result.data.albumId !== albumId ||
      result.data.expectedGuestId !== guestId
    ) {
      return { status: 'blocked', storageKey };
    }
    return { status: 'ready', metadata: result.data };
  } catch {
    return { status: 'blocked', storageKey };
  }
}

function sameMetadata(left: PendingMetadata | null, right: PendingMetadata) {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

/** A late receipt must never remove a newer request's recovery journal. */
function removeMetadata(metadata: PendingMetadata) {
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    const key = sessionStorageKey(metadata);
    const raw = storage.getItem(key);
    if (raw === null) return true;
    const current = pendingMetadataSchema.safeParse(JSON.parse(raw));
    if (!current.success || !sameMetadata(current.data, metadata)) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function keepOtherGuestAttemptsMetadataOnly(albumId: string, guestId: string) {
  for (const [key, operation] of operationStore) {
    const metadata = metadataForOperation(operation);
    if (
      metadata &&
      metadata.albumId === albumId &&
      metadata.expectedGuestId !== guestId &&
      operation.phase !== 'recovery-required'
    ) {
      publishOperation(key, {
        phase: 'recovery-required',
        metadata,
        message:
          '訪客身分已變更。原操作識別資料仍保留，請回到原邀請並重新輸入相同留言。',
      });
    }
  }
}

function keepAlbumAttemptsMetadataOnly(albumId: string) {
  for (const [key, operation] of operationStore) {
    const metadata = metadataForOperation(operation);
    if (
      metadata &&
      metadata.albumId === albumId &&
      operation.phase !== 'recovery-required'
    ) {
      publishOperation(key, {
        phase: 'recovery-required',
        metadata,
        message:
          '訪客存取需要重新確認。原操作識別資料仍保留，請恢復同一邀請後重新輸入相同留言。',
      });
    }
  }
}

function restoreOperation(albumId: string, guestId: string) {
  keepOtherGuestAttemptsMetadataOnly(albumId, guestId);
  const key = storeKey(albumId, guestId);
  if (storedOperation(key)) return;
  const journal = loadMetadata(albumId, guestId);
  if (journal.status === 'blocked') {
    publishOperation(key, {
      phase: 'storage-blocked',
      albumId,
      guestId,
      storageKey: journal.storageKey,
      message:
        '留言重試記錄無法安全讀取。請先檢查留言是否已送出，再明確放棄損壞或無法讀取的記錄。',
    });
  } else if (journal.metadata) {
    publishOperation(key, {
      phase: 'recovery-required',
      metadata: journal.metadata,
      message:
        '發現尚未確認的留言操作。請重新輸入相同留言與目標，並使用原操作識別碼重試。',
    });
  }
}

function abandonOperation(
  operation: OperationState,
  albumId: string,
  guestId: string,
) {
  const key = storeKey(albumId, guestId);
  if (storedOperation(key) !== operation || operation.phase === 'pending')
    return false;
  const storage = getSessionStorage();
  try {
    if (!storage) return false;
    if (operation.phase === 'storage-blocked') {
      storage.removeItem(operation.storageKey);
    } else if (!removeMetadata(metadataForOperation(operation)!)) {
      return false;
    }
  } catch {
    return false;
  }
  publishOperation(storeKey(albumId, guestId), null);
  return true;
}

async function sha256(value: string) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function commandTargets(
  command: GuestCommentCommand,
  fallback: CommentTarget[],
) {
  return command.operation === 'create' ? command.targets : fallback;
}

function createMetadata(
  albumId: string,
  command: GuestCommentCommand,
  targets: CommentTarget[],
  bodySha256: string | null,
) {
  return pendingMetadataSchema.parse({
    version: 1,
    albumId,
    expectedGuestId: command.expectedGuestId,
    requestId: command.requestId,
    operation: command.operation,
    targets,
    ...(command.operation === 'create'
      ? {}
      : {
          commentId: command.commentId,
          expectedRevision: command.expectedRevision,
        }),
    bodySha256,
  });
}

function captureAttempt(
  albumId: string,
  contextKey: string,
  generation: number,
  command: GuestCommentCommand,
  targets: TargetLabel[],
  bodySha256: string | null,
): CapturedAttempt {
  const pairs = targets.map(({ photoId, versionId }) => ({
    photoId,
    versionId,
  }));
  const metadata = createMetadata(
    albumId,
    command,
    commandTargets(command, pairs),
    bodySha256,
  );
  return {
    albumId,
    contextKey,
    generation,
    command,
    bodyJson: JSON.stringify(command),
    metadata,
    targets,
  };
}

function commandFromMetadata(metadata: PendingMetadata, body?: string) {
  let raw: unknown;
  if (metadata.operation === 'create') {
    if (body === undefined) throw new Error('Missing comment body');
    raw = {
      requestId: metadata.requestId,
      expectedGuestId: metadata.expectedGuestId,
      operation: 'create',
      targets: metadata.targets,
      body,
    };
  } else if (metadata.operation === 'edit') {
    if (
      body === undefined ||
      metadata.commentId === undefined ||
      metadata.expectedRevision === undefined
    ) {
      throw new Error('Missing edit recovery data');
    }
    raw = {
      requestId: metadata.requestId,
      expectedGuestId: metadata.expectedGuestId,
      commentId: metadata.commentId,
      expectedRevision: metadata.expectedRevision,
      operation: 'edit',
      body,
    };
  } else {
    if (
      metadata.commentId === undefined ||
      metadata.expectedRevision === undefined
    ) {
      throw new Error('Missing comment recovery data');
    }
    raw = {
      requestId: metadata.requestId,
      expectedGuestId: metadata.expectedGuestId,
      commentId: metadata.commentId,
      expectedRevision: metadata.expectedRevision,
      operation: metadata.operation,
    };
  }
  return guestCommentCommandSchema.parse(raw);
}

function commandLabel(operation: PendingMetadata['operation']) {
  switch (operation) {
    case 'create':
      return '新增留言';
    case 'edit':
      return '編輯留言';
    case 'delete':
      return '刪除留言';
    case 'resolve':
      return '標記已解決';
    case 'reopen':
      return '重新開啟留言';
  }
}

function operationSummary(
  operation: OperationState,
  filenames?: ReadonlyMap<string, string>,
) {
  if (operation.phase === 'storage-blocked') {
    return '原留言的復原資料無法讀取';
  }
  const metadata = metadataForOperation(operation);
  if (!metadata) return '操作記錄無法讀取';
  const targets = metadata.targets.map((target) => {
    const filename = filenames?.get(target.photoId);
    return (filename ?? '原操作中的照片') + ' · 原操作選定的版本';
  });
  return commandLabel(metadata.operation) + ' · ' + targets.join('、');
}

class ApiFailure extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string | null,
  ) {
    super('Guest comments request failed');
  }
}

class ProtocolFailure extends Error {
  constructor() {
    super('Invalid Guest comments response');
  }
}

const errorSchema = z
  .object({ error: z.object({ code: z.string() }).strict() })
  .strict();

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = errorSchema.safeParse(body);
    throw new ApiFailure(
      response.status,
      parsedError.success ? parsedError.data.error.code : null,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ProtocolFailure();
  return parsed.data;
}

type AccessRead =
  { enabled: false } | { enabled: true; guestId: string; canComment: boolean };

async function readCommentAccess(
  albumId: string,
  signal: AbortSignal,
): Promise<AccessRead> {
  const capabilities = await requestJson(
    '/api/guest/comments/capabilities',
    guestCommentsCapabilitiesSchema,
    { signal },
  );
  if (!capabilities.enabled) return { enabled: false };
  const response = await requestJson(
    '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
    z.object({ access: guestAlbumAccessSchema }).strict(),
    { signal },
  );
  if (response.access.albumId !== albumId) throw new ProtocolFailure();
  return {
    enabled: true,
    guestId: response.access.guestId,
    canComment: response.access.permissions.can_comment,
  };
}

function commentsPath(
  albumId: string,
  photoId: string,
  versionId: string,
  cursor: string | null,
) {
  const path =
    '/api/guest/albums/' +
    encodeURIComponent(albumId) +
    '/photos/' +
    encodeURIComponent(photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/comments';
  return cursor === null
    ? path
    : path + '?cursor=' + encodeURIComponent(cursor);
}

async function readPage(
  albumId: string,
  photoId: string,
  versionId: string,
  cursor: string | null,
  guestId: string,
  signal: AbortSignal,
) {
  const page = await requestJson(
    commentsPath(albumId, photoId, versionId, cursor),
    guestCommentsPageSchema,
    { signal },
  );
  if (
    page.guestId !== guestId ||
    page.photoId !== photoId ||
    page.versionId !== versionId
  ) {
    throw new ProtocolFailure();
  }
  return page;
}

function validateResult(result: GuestCommentResult, attempt: CapturedAttempt) {
  const { command, metadata } = attempt;
  if (
    result.guestId !== command.expectedGuestId ||
    result.requestId !== command.requestId ||
    result.operation !== command.operation
  ) {
    throw new ProtocolFailure();
  }
  if (command.operation === 'create') {
    if (result.items.length !== command.targets.length)
      throw new ProtocolFailure();
    const expected = new Map(
      command.targets.map((target) => [target.photoId, target.versionId]),
    );
    for (const item of result.items) {
      if (
        expected.get(item.photoId) !== item.versionId ||
        !item.isMine ||
        item.state !== 'open' ||
        item.body !== command.body
      ) {
        throw new ProtocolFailure();
      }
      expected.delete(item.photoId);
    }
    if (expected.size !== 0) throw new ProtocolFailure();
    return;
  }

  if (result.items.length !== 1 || metadata.targets.length !== 1) {
    throw new ProtocolFailure();
  }
  const target = metadata.targets[0];
  const item = result.items[0];
  if (!target || !item) throw new ProtocolFailure();
  if (
    item.commentId !== command.commentId ||
    item.photoId !== target.photoId ||
    item.versionId !== target.versionId ||
    !item.isMine
  ) {
    throw new ProtocolFailure();
  }
  if (command.operation === 'edit') {
    if (item.body !== command.body || item.state === 'deleted') {
      throw new ProtocolFailure();
    }
  } else if (command.operation === 'delete') {
    if (item.state !== 'deleted' || item.body !== null) {
      throw new ProtocolFailure();
    }
  } else if (command.operation === 'resolve') {
    if (item.state !== 'resolved' || item.body === null) {
      throw new ProtocolFailure();
    }
  } else if (item.state !== 'open' || item.body === null) {
    throw new ProtocolFailure();
  }
}

async function postCommand(attempt: CapturedAttempt) {
  const result = await requestJson(
    '/api/guest/albums/' +
      encodeURIComponent(attempt.albumId) +
      '/comments/commands',
    guestCommentResultSchema,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: attempt.bodyJson,
    },
  );
  validateResult(result, attempt);
  return result;
}

function isAttemptViewCurrent(
  attempt: CapturedAttempt,
  snapshot: {
    key: string;
    generation: number;
    status: Status;
    guestId: string | null;
  },
  activeKey: string,
  activeGeneration: number,
  viewKey: string,
  viewGeneration: number,
) {
  return (
    attempt.contextKey === viewKey &&
    attempt.generation === viewGeneration &&
    activeKey === viewKey &&
    activeGeneration === viewGeneration &&
    snapshot.key === viewKey &&
    snapshot.generation === viewGeneration &&
    snapshot.status === 'ready' &&
    snapshot.guestId === attempt.command.expectedGuestId
  );
}

function clearOnSuccess(attempt: CapturedAttempt) {
  const key = storeKey(attempt.albumId, attempt.command.expectedGuestId);
  const current = storedOperation(key);
  if (
    !current ||
    !sameMetadata(metadataForOperation(current), attempt.metadata)
  )
    return;
  if (!removeMetadata(attempt.metadata)) {
    // Completion is known, but retain the original request until its journal can
    // be removed. Retrying this exact completed request is safe.
    if (storedOperation(key) === current)
      publishOperation(key, {
        phase: 'uncertain',
        attempt,
        message:
          '留言已完成，但重試記錄無法清除；請恢復工作階段儲存後重試相同操作。',
      });
    return;
  }
  if (storedOperation(key) === current) publishOperation(key, null);
}

function demoteForRecovery(attempt: CapturedAttempt) {
  const key = storeKey(attempt.albumId, attempt.command.expectedGuestId);
  const current = storedOperation(key);
  if (!current || !('attempt' in current) || current.attempt !== attempt)
    return;
  publishOperation(key, {
    phase: 'recovery-required',
    metadata: attempt.metadata,
    message:
      '原操作結果尚未確認。請恢復同一訪客存取後，重新輸入相同留言並重試。',
  });
}

function markUncertain(attempt: CapturedAttempt, message: string) {
  const key = storeKey(attempt.albumId, attempt.command.expectedGuestId);
  const current = storedOperation(key);
  if (current && 'attempt' in current && current.attempt === attempt) {
    publishOperation(key, { phase: 'uncertain', attempt, message });
  }
}

function markConflict(attempt: CapturedAttempt, message: string) {
  const key = storeKey(attempt.albumId, attempt.command.expectedGuestId);
  const current = storedOperation(key);
  if (current && 'attempt' in current && current.attempt === attempt) {
    publishOperation(key, {
      phase: 'conflict',
      attempt,
      message,
      reloaded: false,
    });
  }
}

function markConflictReloaded(albumId: string, guestId: string) {
  const key = storeKey(albumId, guestId);
  const current = storedOperation(key);
  if (current?.phase === 'conflict' && !current.reloaded) {
    publishOperation(key, { ...current, reloaded: true });
  }
}

function conflictMessage(error: ApiFailure) {
  if (error.code === 'COMMENT_REVISION_CONFLICT') {
    return '留言版本已變更。清單已清除，請明確重新載入後檢查內容。';
  }
  if (error.code === 'COMMENT_HISTORY_CHANGED') {
    return '留言快照已變更。清單已清除，請明確重新載入。';
  }
  if (error.code === 'REQUEST_ID_CONFLICT') {
    return '操作識別碼發生衝突。請重新載入並使用原操作重試，或明確放棄這筆操作。';
  }
  return '留言操作發生衝突。請重新載入並使用原操作重試。';
}

function readFailure(error: unknown) {
  if (error instanceof ApiFailure) {
    if (error.statusCode === 401) return 'unauthorized' as const;
    if (error.statusCode === 403) return 'denied' as const;
    if (error.statusCode === 503) return 'disabled' as const;
    if (error.statusCode === 409) return 'stale' as const;
  }
  return 'error' as const;
}

function canRetry(operation: OperationState) {
  return (
    operation.phase === 'uncertain' ||
    (operation.phase === 'conflict' && operation.reloaded)
  );
}

function targetLabels(
  metadata: PendingMetadata,
  names?: ReadonlyMap<string, string>,
) {
  return metadata.targets.map((target) => ({
    ...target,
    filename: names?.get(target.photoId) ?? '原操作中的照片',
  }));
}

function equalTargets(left: CommentTarget[], right: CommentTarget[]) {
  return (
    left.length === right.length &&
    left.every(
      (target, index) =>
        target.photoId === right[index]?.photoId &&
        target.versionId === right[index]?.versionId,
    )
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(new Date(value));
}

function stateLabel(item: GuestCommentItem) {
  if (item.authorType === 'owner')
    return item.state === 'deleted' ? '攝影師回覆已刪除' : '攝影師回覆';
  if (item.state === 'open') return '客戶留言待處理';
  if (item.state === 'resolved') return '客戶已標記解決';
  return '客戶留言已刪除';
}

function processingStateLabel(
  snapshot: CommentProcessingSnapshot | null,
): string {
  const state = snapshot?.state ?? 'open';
  if (state === 'in_progress') return '處理中';
  if (state === 'resolved') return '已處理';
  return '待處理';
}

function mergeProcessingSnapshots(
  left: CommentProcessingSnapshot | null,
  right: CommentProcessingSnapshot | null,
): CommentProcessingSnapshot | null {
  if (!left) return right;
  if (!right) return left;
  if (left.revision > right.revision) return left;
  if (right.revision > left.revision) return right;
  if (right.revision === 0) return right;
  if (left.stale === right.stale) return right;
  // Revision zero returns above; recorded snapshots permit either stale value.
  return { ...right, stale: true } as CommentProcessingSnapshot;
}

function CommentOperationNotice({
  operation,
  summary,
  testIdPrefix,
  onRetry,
  retryDisabled,
  onAbandon,
  abandonAllowed,
}: {
  operation: OperationState;
  summary: string;
  testIdPrefix: string;
  onRetry: () => void;
  retryDisabled: boolean;
  onAbandon: () => void;
  abandonAllowed: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div
      role={operation.phase === 'conflict' ? 'alert' : 'status'}
      className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
    >
      <p>
        {operation.phase === 'pending'
          ? '留言操作正在確認中。'
          : operation.message}
      </p>
      <p className="mt-1 break-words text-xs text-amber-900">{summary}</p>
      {operation.phase === 'conflict' && !operation.reloaded && (
        <p className="mt-2 text-xs">
          清單已清除；請先明確重新載入，再重試或放棄。
        </p>
      )}
      {canRetry(operation) && (
        <button
          type="button"
          data-testid={testIdPrefix + '-retry'}
          onClick={onRetry}
          disabled={retryDisabled}
          className="mt-2 rounded border border-amber-700 px-3 py-1.5 font-medium hover:bg-amber-100 disabled:opacity-50"
        >
          重試相同留言操作
        </button>
      )}
      {operation.phase !== 'pending' && abandonAllowed && (
        <div className="mt-2">
          {!confirming ? (
            <button
              type="button"
              data-testid={testIdPrefix + '-abandon'}
              onClick={() => setConfirming(true)}
              className="rounded border border-amber-800 px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
            >
              放棄未確認留言操作
            </button>
          ) : (
            <div className="rounded border border-amber-500 bg-white p-2">
              <p className="text-xs leading-5">
                放棄會清除原操作的重試識別資料；若伺服器已接受，留言仍可能存在。請先重新載入並檢查留言，再確認放棄。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid={testIdPrefix + '-abandon-confirm'}
                  onClick={onAbandon}
                  className="rounded bg-amber-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  確認放棄原操作
                </button>
                <button
                  type="button"
                  data-testid={testIdPrefix + '-abandon-cancel'}
                  onClick={() => setConfirming(false)}
                  className="rounded border border-stone-300 px-3 py-1.5 text-xs"
                >
                  保留原操作
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function mergeItems(current: GuestCommentItem[], next: GuestCommentItem[]) {
  const map = new Map(current.map((item) => [item.commentId, item]));
  for (const item of next) {
    const existing = map.get(item.commentId);
    if (!existing) {
      map.set(item.commentId, item);
      continue;
    }
    const row = item.revision >= existing.revision ? item : existing;
    map.set(item.commentId, {
      ...row,
      processing: mergeProcessingSnapshots(
        existing.processing,
        item.processing,
      ),
    });
  }
  return Array.from(map.values());
}

type Status =
  | 'loading'
  | 'ready'
  | 'disabled'
  | 'denied'
  | 'unauthorized'
  | 'error'
  | 'stale';

type PanelSnapshot = {
  key: string;
  generation: number;
  status: Status;
  guestId: string | null;
  items: GuestCommentItem[];
  nextCursor: string | null;
  seenCursors: string[];
  loadingMore: boolean;
  moreError: boolean;
};

function emptyPanel(
  key: string,
  generation: number,
  status: Status,
): PanelSnapshot {
  return {
    key,
    generation,
    status,
    guestId: null,
    items: [],
    nextCursor: null,
    seenCursors: [],
    loadingMore: false,
    moreError: false,
  };
}

export function GuestCommentsPanel({
  albumId,
  photoId,
  versionId,
  filename = '這張照片',
  versionNo,
  onUnauthorized,
}: {
  albumId: string;
  photoId: string;
  versionId: string;
  filename?: string;
  versionNo?: number;
  onUnauthorized?: (() => void) | undefined;
}) {
  const versionLabel =
    versionNo === undefined ? '目前顯示版本' : `版本 ${versionNo}`;
  const contextKey = JSON.stringify([albumId, photoId, versionId]);
  const [snapshot, setSnapshot] = useState<PanelSnapshot>(() =>
    emptyPanel(contextKey, 0, 'loading'),
  );
  const snapshotRef = useRef(snapshot);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [body, setBody] = useState('');
  const [recoveryBody, setRecoveryBody] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    commentId: string;
    body: string;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeKeyRef = useRef(contextKey);
  const controllersRef = useRef(new Set<AbortController>());
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const writeSnapshot = useCallback((next: PanelSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    if (next.status === 'unauthorized') onUnauthorizedRef.current?.();
  }, []);
  const current =
    snapshot.key === contextKey
      ? snapshot
      : emptyPanel(contextKey, 0, 'loading');
  const operation = useAlbumOperation(albumId, current.guestId);
  const operationKey = current.guestId
    ? storeKey(albumId, current.guestId)
    : '';
  const locked = operation !== null || preparing;
  const resumedBody =
    operation &&
    (operation.phase === 'pending' ||
      operation.phase === 'uncertain' ||
      operation.phase === 'conflict') &&
    operation.attempt.command.operation === 'create' &&
    operation.attempt.albumId === albumId
      ? operation.attempt.command.body
      : body;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeGenerationRef.current = generation;
    activeKeyRef.current = contextKey;
    const controllers = controllersRef.current;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    loadingMoreRef.current = false;
    writeSnapshot(emptyPanel(contextKey, generation, 'loading'));
    setNotice(null);
    const controller = new AbortController();
    controllers.add(controller);
    const isCurrent = () =>
      activeGenerationRef.current === generation &&
      activeKeyRef.current === contextKey;

    void (async () => {
      try {
        const access = await readCommentAccess(albumId, controller.signal);
        if (!isCurrent()) return;
        if (!access.enabled) {
          writeSnapshot(emptyPanel(contextKey, generation, 'disabled'));
          return;
        }
        restoreOperation(albumId, access.guestId);
        if (!access.canComment) {
          writeSnapshot(emptyPanel(contextKey, generation, 'denied'));
          return;
        }
        const loading = {
          ...emptyPanel(contextKey, generation, 'loading'),
          guestId: access.guestId,
        };
        writeSnapshot(loading);
        const page = await readPage(
          albumId,
          photoId,
          versionId,
          null,
          access.guestId,
          controller.signal,
        );
        if (!isCurrent()) return;
        writeSnapshot({
          ...loading,
          status: 'ready',
          items: page.items,
          nextCursor: page.nextCursor,
        });
        if (refreshNonce > 0) markConflictReloaded(albumId, access.guestId);
      } catch (error) {
        if (
          !isCurrent() ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        const failure = readFailure(error);
        if (failure === 'unauthorized') {
          keepAlbumAttemptsMetadataOnly(albumId);
          setBody('');
          setRecoveryBody('');
          setEditing(null);
        }
        if (failure === 'disabled') setBody('');
        writeSnapshot(emptyPanel(contextKey, generation, failure));
      } finally {
        controllers.delete(controller);
      }
    })();

    return () => {
      controller.abort();
      controllers.delete(controller);
    };
  }, [albumId, contextKey, photoId, refreshNonce, versionId, writeSnapshot]);

  useEffect(() => {
    const suspendedRef = { current: false };
    let lastRefreshAt = 0;
    const clearVisibleData = () => {
      if (suspendedRef.current) return;
      suspendedRef.current = true;
      keepAlbumAttemptsMetadataOnly(albumId);
      for (const controller of controllersRef.current) controller.abort();
      controllersRef.current.clear();
      setBody('');
      setRecoveryBody('');
      setEditing(null);
      setNotice(null);
      setRecoveryNotice(null);
      writeSnapshot(
        emptyPanel(contextKey, activeGenerationRef.current, 'loading'),
      );
    };
    const reloadCurrentAccess = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastRefreshAt < 500) return;
      lastRefreshAt = now;
      suspendedRef.current = false;
      setBody('');
      setRecoveryBody('');
      setEditing(null);
      setNotice(null);
      setRecoveryNotice(null);
      writeSnapshot(
        emptyPanel(contextKey, activeGenerationRef.current, 'loading'),
      );
      setRefreshNonce((value) => value + 1);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') clearVisibleData();
      else reloadCurrentAccess();
    };
    window.addEventListener('blur', clearVisibleData);
    window.addEventListener('focus', reloadCurrentAccess);
    window.addEventListener('pagehide', clearVisibleData);
    window.addEventListener('pageshow', reloadCurrentAccess);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', clearVisibleData);
      window.removeEventListener('focus', reloadCurrentAccess);
      window.removeEventListener('pagehide', clearVisibleData);
      window.removeEventListener('pageshow', reloadCurrentAccess);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [albumId, contextKey, writeSnapshot]);

  function reload() {
    setEditing(null);
    setRecoveryNotice(null);
    writeSnapshot(
      emptyPanel(contextKey, snapshotRef.current.generation, 'loading'),
    );
    setRefreshNonce((value) => value + 1);
    setNotice(null);
  }

  function clearForUnauthorized() {
    keepAlbumAttemptsMetadataOnly(albumId);
    setBody('');
    setRecoveryBody('');
    setEditing(null);
    writeSnapshot(
      emptyPanel(contextKey, snapshotRef.current.generation, 'unauthorized'),
    );
  }

  function markStale(
    attempt: CapturedAttempt,
    viewKey: string,
    viewGeneration: number,
  ) {
    const latest = snapshotRef.current;
    if (
      isAttemptViewCurrent(
        attempt,
        latest,
        activeKeyRef.current,
        activeGenerationRef.current,
        viewKey,
        viewGeneration,
      )
    ) {
      setEditing(null);
      writeSnapshot({
        ...emptyPanel(attempt.contextKey, latest.generation, 'stale'),
        guestId: attempt.command.expectedGuestId,
      });
    }
  }

  async function executeAttempt(
    attempt: CapturedAttempt,
    viewKey = contextKey,
    viewGeneration = activeGenerationRef.current,
  ) {
    const key = storeKey(attempt.albumId, attempt.command.expectedGuestId);
    const state = storedOperation(key);
    const isCurrentView = () =>
      isAttemptViewCurrent(
        attempt,
        snapshotRef.current,
        activeKeyRef.current,
        activeGenerationRef.current,
        viewKey,
        viewGeneration,
      );
    if (
      !state ||
      !('attempt' in state) ||
      state.attempt !== attempt ||
      !isCurrentView()
    ) {
      return;
    }
    publishOperation(key, {
      phase: 'pending',
      attempt,
      message: '正在確認留言操作結果。',
    });
    setNotice(null);

    let result: GuestCommentResult;
    try {
      result = await postCommand(attempt);
    } catch (error) {
      if (error instanceof ApiFailure && error.statusCode === 401) {
        demoteForRecovery(attempt);
        if (isCurrentView()) clearForUnauthorized();
      } else if (error instanceof ApiFailure && error.statusCode === 409) {
        markConflict(attempt, conflictMessage(error));
        markStale(attempt, viewKey, viewGeneration);
      } else if (error instanceof ApiFailure && error.statusCode === 403) {
        markUncertain(
          attempt,
          '留言權限已變更；原操作仍保留，請在權限恢復後重試。',
        );
        if (isCurrentView()) {
          writeSnapshot(emptyPanel(viewKey, viewGeneration, 'denied'));
        }
      } else if (error instanceof ApiFailure && error.statusCode === 503) {
        markUncertain(
          attempt,
          '留言服務暫時停用；原操作仍保留，請稍後重新載入。',
        );
        if (isCurrentView()) {
          writeSnapshot(emptyPanel(viewKey, viewGeneration, 'disabled'));
        }
      } else {
        markUncertain(
          attempt,
          '留言操作結果尚未確認。請重試原操作，系統會保留相同識別碼與內容。',
        );
        if (isCurrentView()) {
          setNotice('留言操作結果尚未確認。請使用原操作識別碼重試。');
        }
      }
      return;
    }

    // A validated 200 proves this exact request completed, so its recovery
    // journal can be cleared even if the active guest or photo has changed.
    try {
      if (!isCurrentView()) return;

      let access: AccessRead;
      try {
        access = await readCommentAccess(
          attempt.albumId,
          new AbortController().signal,
        );
      } catch (error) {
        if (!isCurrentView()) return;
        const failure = readFailure(error);
        if (failure === 'unauthorized') {
          clearForUnauthorized();
        } else if (failure === 'denied') {
          writeSnapshot(emptyPanel(viewKey, viewGeneration, 'denied'));
        } else if (failure === 'disabled') {
          writeSnapshot(emptyPanel(viewKey, viewGeneration, 'disabled'));
        } else {
          setBody('');
          setRecoveryBody('');
          setEditing(null);
          writeSnapshot(emptyPanel(viewKey, viewGeneration, 'loading'));
          setRefreshNonce((value) => value + 1);
        }
        return;
      }
      if (!isCurrentView()) return;
      if (!access.enabled) {
        writeSnapshot(emptyPanel(viewKey, viewGeneration, 'disabled'));
        return;
      }
      if (!access.canComment) {
        writeSnapshot(emptyPanel(viewKey, viewGeneration, 'denied'));
        return;
      }
      if (access.guestId !== attempt.command.expectedGuestId) {
        setBody('');
        setRecoveryBody('');
        setEditing(null);
        setNotice(null);
        writeSnapshot(emptyPanel(viewKey, viewGeneration, 'loading'));
        setRefreshNonce((value) => value + 1);
        return;
      }

      const matchingReceipt = result.items.find(
        (item) => item.photoId === photoId && item.versionId === versionId,
      );
      let authoritativeItems: GuestCommentItem[] = [];
      if (matchingReceipt) {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        try {
          const page = await requestJson(
            commentsPath(albumId, photoId, versionId, null) +
              '?commentId=' +
              encodeURIComponent(matchingReceipt.commentId),
            guestCommentsPageSchema,
            { signal: controller.signal },
          );
          if (
            page.guestId !== attempt.command.expectedGuestId ||
            page.photoId !== photoId ||
            page.versionId !== versionId ||
            page.nextCursor !== null ||
            page.items.length !== 1 ||
            page.items[0]?.commentId !== matchingReceipt.commentId
          )
            throw new ProtocolFailure();
          authoritativeItems = page.items;
        } catch (error) {
          if (!isCurrentView()) return;
          setEditing(null);
          if (error instanceof ApiFailure && error.statusCode === 401)
            clearForUnauthorized();
          else {
            writeSnapshot({
              ...emptyPanel(viewKey, viewGeneration, 'stale'),
              guestId: attempt.command.expectedGuestId,
            });
            setNotice('留言操作已完成；目前內容需要重新載入確認。');
          }
          return;
        } finally {
          controllersRef.current.delete(controller);
        }
      }

      const latest = snapshotRef.current;
      if (
        !isAttemptViewCurrent(
          attempt,
          latest,
          activeKeyRef.current,
          activeGenerationRef.current,
          viewKey,
          viewGeneration,
        )
      ) {
        return;
      }
      writeSnapshot({
        ...latest,
        items: mergeItems(latest.items, authoritativeItems),
      });
      if (attempt.command.operation === 'create') setBody('');
      if (attempt.command.operation !== 'create') {
        const completedCommentId = attempt.command.commentId;
        setEditing((existing) =>
          existing &&
          (existing.commentId === completedCommentId ||
            existing.commentId === 'delete:' + completedCommentId)
            ? null
            : existing,
        );
      }
      setRecoveryBody('');
      setRecoveryNotice(null);
      setNotice('留言操作已確認完成。');
    } finally {
      clearOnSuccess(attempt);
    }
  }

  async function beginCommand(
    raw: unknown,
    targets: TargetLabel[],
    bodyValue: string | undefined,
  ) {
    const dispatchGeneration = current.generation;
    if (!operationKey || preparingCommands.has(operationKey)) return;
    if (storedOperation(operationKey) !== null) return;
    const parsed = guestCommentCommandSchema.safeParse(raw);
    if (!parsed.success) {
      setNotice('留言內容或目標無效，請檢查後再送出。');
      return;
    }
    preparingCommands.add(operationKey);
    preparingRef.current = true;
    setPreparing(true);
    let holdsPreparation = true;
    const releasePreparation = () => {
      if (!holdsPreparation) return;
      holdsPreparation = false;
      preparingCommands.delete(operationKey);
      preparingRef.current = false;
      setPreparing(false);
    };
    try {
      const bodyHash =
        'body' in parsed.data ? await sha256(parsed.data.body) : null;
      if (
        activeKeyRef.current !== contextKey ||
        activeGenerationRef.current !== dispatchGeneration ||
        snapshotRef.current.key !== contextKey ||
        snapshotRef.current.generation !== dispatchGeneration ||
        snapshotRef.current.status !== 'ready' ||
        snapshotRef.current.guestId !== parsed.data.expectedGuestId
      ) {
        return;
      }
      const attempt = captureAttempt(
        albumId,
        contextKey,
        dispatchGeneration,
        parsed.data,
        targets,
        bodyHash,
      );
      if (storedOperation(operationKey) !== null) return;
      if (!saveMetadata(attempt.metadata)) {
        setNotice('工作階段儲存無法使用，留言尚未送出。');
        return;
      }
      if (bodyValue !== undefined && parsed.data.operation === 'create')
        setBody(bodyValue);
      publishOperation(operationKey, {
        phase: 'pending',
        attempt,
        message: '正在確認留言操作結果。',
      });
      // The pending intent owns the network operation. Preparation must not
      // stay locked after an explicitly abandoned request is still in flight.
      releasePreparation();
      await executeAttempt(attempt, contextKey, current.generation);
    } catch {
      setNotice('無法準備安全重試資料；留言尚未送出。');
    } finally {
      releasePreparation();
    }
  }

  function retryOriginal() {
    if (
      !operation ||
      operation.phase === 'recovery-required' ||
      operation.phase === 'storage-blocked'
    )
      return;
    if (operation.phase === 'pending') return;
    if (operation.phase === 'conflict' && !operation.reloaded) return;
    if (
      current.status !== 'ready' ||
      !current.guestId ||
      snapshotRef.current.guestId !== operation.attempt.command.expectedGuestId
    ) {
      return;
    }
    const retry = {
      ...operation.attempt,
      contextKey,
      generation: current.generation,
    };
    publishOperation(operationKey, {
      phase: 'pending',
      attempt: retry,
      message: '正在以相同操作識別碼重試。',
    });
    void executeAttempt(retry, contextKey, current.generation);
  }

  async function recoverOriginal() {
    const dispatchGeneration = current.generation;
    if (
      !operation ||
      operation.phase !== 'recovery-required' ||
      !current.guestId
    ) {
      return;
    }
    const metadata = operation.metadata;
    const target = metadata.targets[0];
    if (
      !target ||
      target.photoId !== photoId ||
      target.versionId !== versionId
    ) {
      setRecoveryNotice(
        '請開啟原照片版本留言面板，或使用批次留言區恢復原目標。',
      );
      return;
    }
    let value: string | undefined;
    if (metadata.bodySha256 !== null) {
      const parsedBody = guestCommentBodySchema.safeParse(recoveryBody);
      if (!parsedBody.success) {
        setRecoveryNotice('請輸入原留言內容。');
        return;
      }
      if ((await sha256(parsedBody.data)) !== metadata.bodySha256) {
        setRecoveryNotice('內容與原操作不相符；請重新確認原留言文字。');
        return;
      }
      value = parsedBody.data;
    }
    if (
      activeKeyRef.current !== contextKey ||
      activeGenerationRef.current !== dispatchGeneration ||
      snapshotRef.current.key !== contextKey ||
      snapshotRef.current.generation !== dispatchGeneration ||
      snapshotRef.current.status !== 'ready' ||
      snapshotRef.current.guestId !== metadata.expectedGuestId ||
      storedOperation(operationKey) !== operation
    ) {
      return;
    }
    const command = commandFromMetadata(metadata, value);
    const attempt = captureAttempt(
      albumId,
      contextKey,
      dispatchGeneration,
      command,
      targetLabels(metadata),
      metadata.bodySha256,
    );
    if (!saveMetadata(metadata)) {
      setRecoveryNotice('工作階段儲存無法更新；原操作尚未送出。');
      return;
    }
    publishOperation(operationKey, {
      phase: 'pending',
      attempt,
      message: '正在以原操作識別碼確認留言結果。',
    });
    setRecoveryNotice(null);
    if (value !== undefined) setRecoveryBody(value);
    await executeAttempt(attempt, contextKey, current.generation);
  }

  function abandonCurrent() {
    if (!operation || !current.guestId || operation.phase === 'pending') return;
    if (!abandonOperation(operation, albumId, current.guestId)) {
      setNotice('無法清除原操作記錄；請保持此面板開啟並確認工作階段儲存可用。');
      return;
    }
    setBody('');
    setRecoveryBody('');
    setEditing(null);
    setNotice('原操作已明確放棄。請重新載入留言後再開始其他操作。');
    setRefreshNonce((value) => value + 1);
  }

  async function loadMore() {
    const page = snapshotRef.current;
    if (
      loadingMoreRef.current ||
      page.status !== 'ready' ||
      page.key !== contextKey ||
      !page.guestId ||
      page.nextCursor === null
    ) {
      return;
    }
    const cursor = page.nextCursor;
    if (page.seenCursors.includes(cursor)) {
      writeSnapshot({
        ...emptyPanel(contextKey, page.generation, 'stale'),
        guestId: page.guestId,
      });
      return;
    }
    loadingMoreRef.current = true;
    writeSnapshot({ ...page, loadingMore: true, moreError: false });
    const controller = new AbortController();
    controllersRef.current.add(controller);
    try {
      const next = await readPage(
        albumId,
        photoId,
        versionId,
        cursor,
        page.guestId,
        controller.signal,
      );
      if (
        activeGenerationRef.current !== page.generation ||
        activeKeyRef.current !== contextKey
      ) {
        return;
      }
      const latest = snapshotRef.current;
      const existingIds = new Set(latest.items.map((item) => item.commentId));
      if (
        next.items.some((item) => existingIds.has(item.commentId)) ||
        (next.nextCursor !== null &&
          (next.nextCursor === cursor ||
            latest.seenCursors.includes(next.nextCursor)))
      ) {
        writeSnapshot({
          ...emptyPanel(contextKey, page.generation, 'stale'),
          guestId: page.guestId,
        });
        return;
      }
      writeSnapshot({
        ...latest,
        items: [...latest.items, ...next.items],
        nextCursor: next.nextCursor,
        seenCursors: [...latest.seenCursors, cursor],
        loadingMore: false,
        moreError: false,
      });
    } catch (error) {
      if (
        activeGenerationRef.current !== page.generation ||
        activeKeyRef.current !== contextKey ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return;
      }
      const failure = readFailure(error);
      if (failure === 'unauthorized') {
        keepAlbumAttemptsMetadataOnly(albumId);
        setBody('');
        setRecoveryBody('');
        setEditing(null);
        writeSnapshot(emptyPanel(contextKey, page.generation, 'unauthorized'));
      } else if (failure === 'disabled') {
        writeSnapshot(emptyPanel(contextKey, page.generation, 'disabled'));
      } else if (failure === 'denied') {
        writeSnapshot(emptyPanel(contextKey, page.generation, 'denied'));
      } else if (failure === 'stale') {
        writeSnapshot({
          ...emptyPanel(contextKey, page.generation, 'stale'),
          guestId: page.guestId,
        });
      } else {
        const latest = snapshotRef.current;
        if (latest.key === contextKey && latest.status === 'ready') {
          writeSnapshot({ ...latest, loadingMore: false, moreError: true });
        }
      }
    } finally {
      controllersRef.current.delete(controller);
      loadingMoreRef.current = false;
      const latest = snapshotRef.current;
      if (
        latest.key === contextKey &&
        latest.status === 'ready' &&
        latest.loadingMore
      ) {
        writeSnapshot({ ...latest, loadingMore: false });
      }
    }
  }

  function submitNew(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (current.status !== 'ready' || !current.guestId || locked || operation)
      return;
    const parsed = guestCommentBodySchema.safeParse(resumedBody);
    if (!parsed.success) {
      setNotice('留言需為 1–2000 字，且不可含控制字元。');
      return;
    }
    void beginCommand(
      {
        requestId: globalThis.crypto.randomUUID(),
        expectedGuestId: current.guestId,
        operation: 'create',
        targets: [{ photoId, versionId }],
        body: parsed.data,
      },
      [{ photoId, versionId, filename }],
      parsed.data,
    );
  }

  function mutateItem(
    item: GuestCommentItem,
    kind: 'edit' | 'delete' | 'resolve' | 'reopen',
    bodyValue?: string,
  ) {
    if (
      current.status !== 'ready' ||
      !current.guestId ||
      !item.isMine ||
      item.state === 'deleted' ||
      operation ||
      preparingRef.current
    ) {
      return;
    }
    let normalized: string | undefined;
    if (bodyValue !== undefined) {
      const parsed = guestCommentBodySchema.safeParse(bodyValue);
      if (!parsed.success) {
        setNotice('留言需為 1–2000 字，且不可含控制字元。');
        return;
      }
      normalized = parsed.data;
    }
    void beginCommand(
      {
        requestId: globalThis.crypto.randomUUID(),
        expectedGuestId: current.guestId,
        commentId: item.commentId,
        expectedRevision: item.revision,
        operation: kind,
        ...(normalized === undefined ? {} : { body: normalized }),
      },
      [
        {
          photoId: item.photoId,
          versionId: item.versionId,
          filename,
        },
      ],
      normalized,
    );
  }

  function recoveryForm() {
    if (!operation || operation.phase !== 'recovery-required') return null;
    const metadata = operation.metadata;
    const recoveryTarget = metadata.targets[0];
    const match =
      metadata.targets.length === 1 &&
      recoveryTarget !== undefined &&
      recoveryTarget.photoId === photoId &&
      recoveryTarget.versionId === versionId;
    if (!match) {
      return (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>{operation.message}</p>
          <p className="mt-1 break-all text-xs">
            {operationSummary(operation, new Map([[photoId, filename]]))}
          </p>
          <p className="mt-1 text-xs">
            請回到原照片版本，或使用批次留言區恢復原操作。
          </p>
        </div>
      );
    }
    return (
      <form
        className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void recoverOriginal();
        }}
      >
        <p className="text-sm font-medium text-amber-950">
          {operation.message}
        </p>
        <p className="mt-1 break-all text-xs">
          {operationSummary(operation, new Map([[photoId, filename]]))}
        </p>
        {metadata.bodySha256 !== null && (
          <>
            <label
              htmlFor="comment-recovery-body"
              className="mt-3 block text-sm"
            >
              重新輸入完全相同的留言
            </label>
            <textarea
              id="comment-recovery-body"
              data-testid="comment-recovery-body"
              value={recoveryBody}
              onChange={(event) => {
                setRecoveryBody(event.target.value);
                setRecoveryNotice(null);
              }}
              maxLength={8000}
              rows={4}
              className="mt-1 w-full resize-y rounded-md border border-amber-400 bg-white px-3 py-2 text-sm"
            />
          </>
        )}
        {recoveryNotice && (
          <p role="alert" className="mt-2 text-sm text-rose-800">
            {recoveryNotice}
          </p>
        )}
        <button
          type="submit"
          data-testid="comment-recovery-retry"
          disabled={
            preparing || (metadata.bodySha256 !== null && !recoveryBody)
          }
          className="mt-2 rounded bg-amber-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          使用原留言操作重試
        </button>
      </form>
    );
  }

  if (
    current.status === 'loading' ||
    current.status === 'disabled' ||
    current.status === 'denied'
  ) {
    return null;
  }
  if (current.status === 'unauthorized') {
    return null;
  }

  return (
    <section
      data-testid="guest-comments-panel"
      aria-label="訪客留言"
      className="min-w-0 rounded-lg border border-stone-200 bg-stone-50 p-3 text-stone-900"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">版本留言</h3>
        <span className="break-all text-xs text-stone-500">
          {filename} · {versionLabel}
        </span>
      </div>
      {operation && (
        <CommentOperationNotice
          key={
            operation.phase === 'storage-blocked'
              ? operation.storageKey
              : metadataForOperation(operation)?.requestId
          }
          operation={operation}
          summary={operationSummary(operation, new Map([[photoId, filename]]))}
          testIdPrefix="comment"
          onRetry={retryOriginal}
          retryDisabled={
            preparing ||
            operation.phase === 'pending' ||
            (operation.phase === 'conflict' && !operation.reloaded)
          }
          onAbandon={abandonCurrent}
          abandonAllowed={operation.phase !== 'conflict' || operation.reloaded}
        />
      )}
      {current.status === 'stale' && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
        >
          留言快照已失效，清單已清除。請明確重新載入。
          <button
            type="button"
            data-testid="comment-reload"
            onClick={reload}
            className="ml-2 rounded border border-amber-700 px-2 py-1"
          >
            重新載入留言
          </button>
        </div>
      )}
      {current.status === 'error' && (
        <div
          role="status"
          className="mt-3 rounded-md border border-stone-300 bg-white p-3 text-sm"
        >
          留言暫時無法載入。
          <button
            type="button"
            data-testid="comment-reload"
            onClick={reload}
            className="ml-2 rounded border border-stone-300 px-2 py-1"
          >
            重試載入
          </button>
        </div>
      )}
      {current.status === 'ready' && (
        <>
          {current.items.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">目前沒有留言。</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {current.items.map((item) => {
                const isEditing = editing?.commentId === item.commentId;
                const confirmingDelete =
                  editing?.commentId === 'delete:' + item.commentId;
                return (
                  <li
                    key={item.commentId}
                    data-testid={'comment-item-' + item.commentId}
                    className="min-w-0 rounded-lg border border-stone-200 bg-white p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {item.authorLabel}
                          <span
                            className="ml-2 rounded border border-stone-300 px-1.5 py-0.5 text-xs"
                            data-testid={
                              'comment-author-type-' + item.commentId
                            }
                          >
                            {item.authorType === 'owner'
                              ? '攝影師回覆'
                              : '客戶留言'}
                          </span>
                        </p>
                        <p className="mt-1 break-all text-xs text-stone-500">
                          {versionLabel}
                        </p>
                      </div>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">
                        {stateLabel(item)}
                      </span>
                    </div>
                    {item.authorType === 'guest' && (
                      <p className="mt-2 text-sm text-stone-700">
                        攝影師處理：{processingStateLabel(item.processing)}
                        {item.processing?.stale && (
                          <span className="mt-1 block text-amber-800">
                            留言有新的編輯，請攝影師重新確認
                          </span>
                        )}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-500">
                      <time dateTime={item.createdAt}>
                        建立於 {formatTime(item.createdAt)}
                      </time>
                      {item.updatedAt !== item.createdAt && (
                        <time dateTime={item.updatedAt}>
                          更新於 {formatTime(item.updatedAt)}
                        </time>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="mt-3">
                        <label
                          htmlFor={'comment-edit-body-' + item.commentId}
                          className="sr-only"
                        >
                          編輯留言
                        </label>
                        <textarea
                          id={'comment-edit-body-' + item.commentId}
                          data-testid={'comment-edit-body-' + item.commentId}
                          value={editing.body}
                          onChange={(event) =>
                            setEditing((value) =>
                              value?.commentId === item.commentId
                                ? { ...value, body: event.target.value }
                                : value,
                            )
                          }
                          disabled={locked}
                          maxLength={8000}
                          rows={4}
                          className="w-full resize-y rounded-md border border-stone-300 px-3 py-2 text-sm leading-6"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            data-testid={
                              'comment-edit-submit-' + item.commentId
                            }
                            onClick={() =>
                              mutateItem(item, 'edit', editing.body)
                            }
                            disabled={
                              locked ||
                              !guestCommentBodySchema.safeParse(editing.body)
                                .success
                            }
                            className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          >
                            儲存編輯
                          </button>
                          <button
                            type="button"
                            data-testid={
                              'comment-edit-cancel-' + item.commentId
                            }
                            onClick={() => setEditing(null)}
                            disabled={locked}
                            className="rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50"
                          >
                            取消編輯
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">
                        {item.body ?? '此留言已刪除'}
                      </p>
                    )}
                    {item.isMine &&
                      item.state !== 'deleted' &&
                      !isEditing &&
                      !confirmingDelete && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-testid={'comment-edit-' + item.commentId}
                            onClick={() => {
                              if (!locked && item.body !== null) {
                                setNotice(null);
                                setEditing({
                                  commentId: item.commentId,
                                  body: item.body,
                                });
                              }
                            }}
                            disabled={locked}
                            className="rounded border border-stone-300 px-2.5 py-1.5 text-xs disabled:opacity-50"
                          >
                            編輯
                          </button>
                          <button
                            type="button"
                            data-testid={'comment-delete-' + item.commentId}
                            onClick={() =>
                              setEditing({
                                commentId: 'delete:' + item.commentId,
                                body: '',
                              })
                            }
                            disabled={locked}
                            className="rounded border border-rose-300 px-2.5 py-1.5 text-xs text-rose-800 disabled:opacity-50"
                          >
                            刪除
                          </button>
                          {item.state === 'open' ? (
                            <button
                              type="button"
                              data-testid={'comment-resolve-' + item.commentId}
                              onClick={() => mutateItem(item, 'resolve')}
                              disabled={locked}
                              className="rounded border border-emerald-300 px-2.5 py-1.5 text-xs text-emerald-800 disabled:opacity-50"
                            >
                              標記已解決
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-testid={'comment-reopen-' + item.commentId}
                              onClick={() => mutateItem(item, 'reopen')}
                              disabled={locked}
                              className="rounded border border-stone-300 px-2.5 py-1.5 text-xs disabled:opacity-50"
                            >
                              重新開啟
                            </button>
                          )}
                        </div>
                      )}
                    {confirmingDelete && item.isMine && (
                      <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 p-3">
                        <p className="text-sm font-medium text-rose-900">
                          確定刪除此留言？刪除後會保留刪除狀態。
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            data-testid={
                              'comment-delete-confirm-' + item.commentId
                            }
                            onClick={() => mutateItem(item, 'delete')}
                            disabled={locked}
                            className="rounded bg-rose-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          >
                            確認刪除留言
                          </button>
                          <button
                            type="button"
                            data-testid={
                              'comment-delete-cancel-' + item.commentId
                            }
                            onClick={() => setEditing(null)}
                            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
                          >
                            保留留言
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {current.nextCursor !== null && (
            <div className="mt-3">
              <button
                type="button"
                data-testid="comment-load-more"
                onClick={() => void loadMore()}
                disabled={locked || current.loadingMore}
                className="rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {current.loadingMore ? '載入中…' : '載入更多留言'}
              </button>
              {current.moreError && (
                <p role="status" className="mt-2 text-sm text-stone-600">
                  無法載入下一頁；可重試相同游標。
                </p>
              )}
            </div>
          )}
          {operation?.phase === 'recovery-required' ? (
            recoveryForm()
          ) : (
            <>
              {!editing && (
                <form
                  className="mt-4 border-t border-stone-200 pt-3"
                  onSubmit={submitNew}
                >
                  <label
                    htmlFor="comment-body"
                    className="block text-sm font-medium"
                  >
                    新增留言
                  </label>
                  <textarea
                    id="comment-body"
                    data-testid="comment-body"
                    value={resumedBody}
                    onChange={(event) => {
                      setBody(event.target.value);
                      setNotice(null);
                    }}
                    disabled={locked}
                    maxLength={8000}
                    rows={3}
                    placeholder="以純文字留下版本留言"
                    className="mt-1 w-full resize-y rounded-md border border-stone-300 bg-white px-3 py-2 text-sm leading-6 disabled:opacity-60"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="submit"
                      data-testid="comment-submit"
                      disabled={
                        locked ||
                        !guestCommentBodySchema.safeParse(resumedBody).success
                      }
                      className="rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      送出留言
                    </button>
                    {notice && (
                      <p role="status" className="text-sm">
                        {notice}
                      </p>
                    )}
                  </div>
                </form>
              )}
              {notice && editing && (
                <p role="status" className="mt-3 text-sm">
                  {notice}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export type GuestBatchCommentPhoto = {
  id: string;
  versionId: string;
  filename: string;
};

type BatchSnapshot = {
  key: string;
  generation: number;
  status: Status;
  guestId: string | null;
};

function emptyBatch(
  key: string,
  generation: number,
  status: Status,
): BatchSnapshot {
  return { key, generation, status, guestId: null };
}

function uniqueFirst24(photos: GuestBatchCommentPhoto[]) {
  const ids = new Set<string>();
  const result: GuestBatchCommentPhoto[] = [];
  for (const photo of photos) {
    if (ids.has(photo.id)) continue;
    ids.add(photo.id);
    result.push(photo);
    if (result.length === 24) break;
  }
  return result;
}

export function GuestBatchCommentComposer({
  albumId,
  photos,
  onUnauthorized,
}: {
  albumId: string;
  photos: GuestBatchCommentPhoto[];
  onUnauthorized?: (() => void) | undefined;
}) {
  const visiblePhotos = uniqueFirst24(photos);
  const displayKey = JSON.stringify([
    albumId,
    visiblePhotos.map((photo) => [photo.id, photo.versionId, photo.filename]),
  ]);
  return (
    <BatchCommentComposerView
      key={displayKey}
      albumId={albumId}
      photos={visiblePhotos}
      truncated={photos.length > visiblePhotos.length}
      onUnauthorized={onUnauthorized}
    />
  );
}

function BatchCommentComposerView({
  albumId,
  photos,
  truncated,
  onUnauthorized,
}: {
  albumId: string;
  photos: GuestBatchCommentPhoto[];
  truncated: boolean;
  onUnauthorized?: (() => void) | undefined;
}) {
  const contextKey = JSON.stringify([albumId]);
  const visiblePhotos = photos;
  const [snapshot, setSnapshot] = useState<BatchSnapshot>(() =>
    emptyBatch(contextKey, 0, 'loading'),
  );
  const snapshotRef = useRef(snapshot);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [body, setBody] = useState('');
  const [recoveryBody, setRecoveryBody] = useState('');
  const [confirmation, setConfirmation] = useState<TargetLabel[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const preparingRef = useRef(false);
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeKeyRef = useRef(contextKey);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  const writeSnapshot = useCallback((next: BatchSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    if (next.status === 'unauthorized') onUnauthorizedRef.current?.();
  }, []);
  const current =
    snapshot.key === contextKey
      ? snapshot
      : emptyBatch(contextKey, 0, 'loading');
  const operation = useAlbumOperation(albumId, current.guestId);
  const operationKey = current.guestId
    ? storeKey(albumId, current.guestId)
    : '';
  const locked = operation !== null || preparing;
  const resumedBody =
    operation &&
    (operation.phase === 'pending' ||
      operation.phase === 'uncertain' ||
      operation.phase === 'conflict') &&
    operation.attempt.command.operation === 'create' &&
    operation.attempt.albumId === albumId
      ? operation.attempt.command.body
      : body;

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeGenerationRef.current = generation;
    activeKeyRef.current = contextKey;
    controllerRef.current?.abort();
    writeSnapshot(emptyBatch(contextKey, generation, 'loading'));
    setNotice(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () =>
      activeGenerationRef.current === generation &&
      activeKeyRef.current === contextKey;
    void (async () => {
      try {
        const access = await readCommentAccess(albumId, controller.signal);
        if (!isCurrent()) return;
        if (!access.enabled) {
          writeSnapshot(emptyBatch(contextKey, generation, 'disabled'));
          return;
        }
        restoreOperation(albumId, access.guestId);
        if (!access.canComment) {
          writeSnapshot(emptyBatch(contextKey, generation, 'denied'));
          return;
        }
        writeSnapshot({
          key: contextKey,
          generation,
          status: 'ready',
          guestId: access.guestId,
        });
        if (refreshNonce > 0) markConflictReloaded(albumId, access.guestId);
      } catch (error) {
        if (
          !isCurrent() ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        const failure = readFailure(error);
        if (failure === 'unauthorized') {
          keepAlbumAttemptsMetadataOnly(albumId);
          setBody('');
          setRecoveryBody('');
          setSelected(new Set());
          setConfirmation(null);
        }
        writeSnapshot(emptyBatch(contextKey, generation, failure));
      }
    })();
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [albumId, contextKey, refreshNonce, writeSnapshot]);

  useEffect(() => {
    const suspendedRef = { current: false };
    let lastRefreshAt = 0;
    const clearVisibleData = () => {
      if (suspendedRef.current) return;
      suspendedRef.current = true;
      keepAlbumAttemptsMetadataOnly(albumId);
      controllerRef.current?.abort();
      controllerRef.current = null;
      setBody('');
      setRecoveryBody('');
      setSelected(new Set());
      setConfirmation(null);
      setNotice(null);
      setRecoveryNotice(null);
      writeSnapshot(
        emptyBatch(contextKey, activeGenerationRef.current, 'loading'),
      );
    };
    const reloadCurrentAccess = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastRefreshAt < 500) return;
      lastRefreshAt = now;
      suspendedRef.current = false;
      setBody('');
      setRecoveryBody('');
      setSelected(new Set());
      setConfirmation(null);
      setNotice(null);
      setRecoveryNotice(null);
      writeSnapshot(
        emptyBatch(contextKey, activeGenerationRef.current, 'loading'),
      );
      setRefreshNonce((value) => value + 1);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') clearVisibleData();
      else reloadCurrentAccess();
    };
    window.addEventListener('blur', clearVisibleData);
    window.addEventListener('focus', reloadCurrentAccess);
    window.addEventListener('pagehide', clearVisibleData);
    window.addEventListener('pageshow', reloadCurrentAccess);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', clearVisibleData);
      window.removeEventListener('focus', reloadCurrentAccess);
      window.removeEventListener('pagehide', clearVisibleData);
      window.removeEventListener('pageshow', reloadCurrentAccess);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [albumId, contextKey, writeSnapshot]);

  function reloadAccess() {
    writeSnapshot(
      emptyBatch(contextKey, snapshotRef.current.generation, 'loading'),
    );
    setConfirmation(null);
    setNotice(null);
    setRefreshNonce((value) => value + 1);
  }

  function clearForUnauthorized() {
    keepAlbumAttemptsMetadataOnly(albumId);
    setBody('');
    setRecoveryBody('');
    setSelected(new Set());
    setConfirmation(null);
    writeSnapshot(
      emptyBatch(contextKey, snapshotRef.current.generation, 'unauthorized'),
    );
  }

  async function executeAttempt(
    attempt: CapturedAttempt,
    viewKey = contextKey,
    viewGeneration = activeGenerationRef.current,
  ) {
    const key = storeKey(attempt.albumId, attempt.command.expectedGuestId);
    const state = storedOperation(key);
    const isCurrentView = () =>
      isAttemptViewCurrent(
        attempt,
        snapshotRef.current,
        activeKeyRef.current,
        activeGenerationRef.current,
        viewKey,
        viewGeneration,
      );
    if (
      !state ||
      !('attempt' in state) ||
      state.attempt !== attempt ||
      !isCurrentView()
    ) {
      return;
    }
    publishOperation(key, {
      phase: 'pending',
      attempt,
      message: '正在確認留言操作結果。',
    });
    setNotice(null);

    try {
      await postCommand(attempt);
    } catch (error) {
      if (error instanceof ApiFailure && error.statusCode === 401) {
        demoteForRecovery(attempt);
        if (isCurrentView()) clearForUnauthorized();
      } else if (error instanceof ApiFailure && error.statusCode === 409) {
        markConflict(attempt, conflictMessage(error));
        if (isCurrentView()) {
          writeSnapshot({
            ...emptyBatch(viewKey, viewGeneration, 'stale'),
            guestId: attempt.command.expectedGuestId,
          });
        }
      } else if (error instanceof ApiFailure && error.statusCode === 403) {
        markUncertain(
          attempt,
          '留言權限已變更；原操作仍保留，請在權限恢復後重試。',
        );
        if (isCurrentView()) {
          writeSnapshot(emptyBatch(viewKey, viewGeneration, 'denied'));
        }
      } else if (error instanceof ApiFailure && error.statusCode === 503) {
        markUncertain(
          attempt,
          '留言服務暫時停用；原操作仍保留，請稍後重新載入。',
        );
        if (isCurrentView()) {
          writeSnapshot(emptyBatch(viewKey, viewGeneration, 'disabled'));
        }
      } else {
        markUncertain(
          attempt,
          '留言操作結果尚未確認。請重試原操作，系統會保留相同識別碼與內容。',
        );
        if (isCurrentView()) {
          setNotice('留言操作結果尚未確認。請使用原操作識別碼重試。');
        }
      }
      return;
    }

    // A validated 200 proves this exact request completed, so its recovery
    // journal can be cleared without applying the result to a different view.
    try {
      if (!isCurrentView()) return;

      let access: AccessRead;
      try {
        access = await readCommentAccess(
          attempt.albumId,
          new AbortController().signal,
        );
      } catch (error) {
        if (!isCurrentView()) return;
        const failure = readFailure(error);
        if (failure === 'unauthorized') {
          clearForUnauthorized();
        } else if (failure === 'denied') {
          writeSnapshot(emptyBatch(viewKey, viewGeneration, 'denied'));
        } else if (failure === 'disabled') {
          writeSnapshot(emptyBatch(viewKey, viewGeneration, 'disabled'));
        } else {
          setBody('');
          setRecoveryBody('');
          setSelected(new Set());
          setConfirmation(null);
          writeSnapshot(emptyBatch(viewKey, viewGeneration, 'loading'));
          setRefreshNonce((value) => value + 1);
        }
        return;
      }
      if (!isCurrentView()) return;
      if (!access.enabled) {
        writeSnapshot(emptyBatch(viewKey, viewGeneration, 'disabled'));
        return;
      }
      if (!access.canComment) {
        writeSnapshot(emptyBatch(viewKey, viewGeneration, 'denied'));
        return;
      }
      if (access.guestId !== attempt.command.expectedGuestId) {
        setBody('');
        setRecoveryBody('');
        setSelected(new Set());
        setConfirmation(null);
        setNotice(null);
        writeSnapshot(emptyBatch(viewKey, viewGeneration, 'loading'));
        setRefreshNonce((value) => value + 1);
        return;
      }
      if (!isCurrentView()) return;
      setConfirmation(null);
      setSelected(new Set());
      if (attempt.command.operation === 'create') setBody('');
      setRecoveryBody('');
      setRecoveryNotice(null);
      setNotice(
        attempt.command.operation === 'create'
          ? '已成功新增 ' + attempt.metadata.targets.length + ' 則留言。'
          : attempt.command.operation === 'edit'
            ? '留言編輯已完成。'
            : attempt.command.operation === 'delete'
              ? '留言刪除已完成。'
              : attempt.command.operation === 'resolve'
                ? '留言已標記為已解決。'
                : '留言已重新開啟。',
      );
    } finally {
      clearOnSuccess(attempt);
    }
  }

  async function beginCommand(
    raw: unknown,
    targets: TargetLabel[],
    bodyValue: string | undefined,
  ) {
    const dispatchGeneration = current.generation;
    if (!operationKey || preparingCommands.has(operationKey)) return;
    if (storedOperation(operationKey) !== null) return;
    const parsed = guestCommentCommandSchema.safeParse(raw);
    if (!parsed.success) {
      setNotice('留言內容或目標無效，請檢查後再送出。');
      return;
    }
    preparingCommands.add(operationKey);
    preparingRef.current = true;
    setPreparing(true);
    let holdsPreparation = true;
    const releasePreparation = () => {
      if (!holdsPreparation) return;
      holdsPreparation = false;
      preparingCommands.delete(operationKey);
      preparingRef.current = false;
      setPreparing(false);
    };
    try {
      const bodyHash =
        'body' in parsed.data ? await sha256(parsed.data.body) : null;
      if (
        activeKeyRef.current !== contextKey ||
        activeGenerationRef.current !== dispatchGeneration ||
        snapshotRef.current.key !== contextKey ||
        snapshotRef.current.generation !== dispatchGeneration ||
        snapshotRef.current.status !== 'ready' ||
        snapshotRef.current.guestId !== parsed.data.expectedGuestId
      ) {
        return;
      }
      const attempt = captureAttempt(
        albumId,
        contextKey,
        dispatchGeneration,
        parsed.data,
        targets,
        bodyHash,
      );
      if (storedOperation(operationKey) !== null) return;
      if (!saveMetadata(attempt.metadata)) {
        setNotice('工作階段儲存無法使用，留言尚未送出。');
        return;
      }
      if (bodyValue !== undefined && parsed.data.operation === 'create')
        setBody(bodyValue);
      publishOperation(operationKey, {
        phase: 'pending',
        attempt,
        message: '正在確認留言操作結果。',
      });
      // The pending intent owns the network operation. Preparation must not
      // stay locked after an explicitly abandoned request is still in flight.
      releasePreparation();
      await executeAttempt(attempt, contextKey, current.generation);
    } catch {
      setNotice('無法準備安全重試資料；留言尚未送出。');
    } finally {
      releasePreparation();
    }
  }

  function retryOriginal() {
    if (
      !operation ||
      operation.phase === 'recovery-required' ||
      operation.phase === 'storage-blocked'
    )
      return;
    if (operation.phase === 'pending') return;
    if (operation.phase === 'conflict' && !operation.reloaded) return;
    if (
      current.status !== 'ready' ||
      !current.guestId ||
      snapshotRef.current.guestId !== operation.attempt.command.expectedGuestId
    ) {
      return;
    }
    const retry = {
      ...operation.attempt,
      contextKey,
      generation: current.generation,
    };
    publishOperation(operationKey, {
      phase: 'pending',
      attempt: retry,
      message: '正在以相同操作識別碼重試。',
    });
    void executeAttempt(retry, contextKey, current.generation);
  }

  async function recoverOriginal() {
    const dispatchGeneration = current.generation;
    if (
      !operation ||
      operation.phase !== 'recovery-required' ||
      !current.guestId
    ) {
      return;
    }
    const metadata = operation.metadata;
    if (metadata.operation !== 'create') {
      setRecoveryNotice('請回到原照片留言面板恢復這項操作。');
      return;
    }
    const chosen = visiblePhotos
      .filter((photo) => selected.has(photo.id))
      .map(({ id, versionId }) => ({ photoId: id, versionId }));
    if (!equalTargets(metadata.targets, chosen)) {
      setRecoveryNotice('請依原操作目標順序重新勾選照片。');
      return;
    }
    const parsed = guestCommentBodySchema.safeParse(recoveryBody);
    if (!parsed.success) {
      setRecoveryNotice('請輸入原留言內容。');
      return;
    }
    if ((await sha256(parsed.data)) !== metadata.bodySha256) {
      setRecoveryNotice('內容與原操作不相符；請重新確認原留言文字。');
      return;
    }
    if (
      activeKeyRef.current !== contextKey ||
      activeGenerationRef.current !== dispatchGeneration ||
      snapshotRef.current.key !== contextKey ||
      snapshotRef.current.generation !== dispatchGeneration ||
      snapshotRef.current.status !== 'ready' ||
      snapshotRef.current.guestId !== metadata.expectedGuestId ||
      storedOperation(operationKey) !== operation
    ) {
      return;
    }
    const command = commandFromMetadata(metadata, parsed.data);
    const names = new Map(
      visiblePhotos.map((photo) => [photo.id, photo.filename]),
    );
    const attempt = captureAttempt(
      albumId,
      contextKey,
      dispatchGeneration,
      command,
      targetLabels(metadata, names),
      metadata.bodySha256,
    );
    if (!saveMetadata(metadata)) {
      setRecoveryNotice('工作階段儲存無法更新；原操作尚未送出。');
      return;
    }
    publishOperation(operationKey, {
      phase: 'pending',
      attempt,
      message: '正在以原操作識別碼確認留言結果。',
    });
    setRecoveryNotice(null);
    setBody(parsed.data);
    await executeAttempt(attempt, contextKey, current.generation);
  }

  function abandonCurrent() {
    if (!operation || !current.guestId || operation.phase === 'pending') return;
    if (!abandonOperation(operation, albumId, current.guestId)) {
      setNotice('無法清除原操作記錄；請保持此面板開啟並確認工作階段儲存可用。');
      return;
    }
    setBody('');
    setRecoveryBody('');
    setSelected(new Set());
    setConfirmation(null);
    setNotice('原操作已明確放棄。請重新載入權限後再開始其他操作。');
    setRefreshNonce((value) => value + 1);
  }

  const selectedTargets = visiblePhotos
    .filter((photo) => selected.has(photo.id))
    .map((photo) => ({
      photoId: photo.id,
      versionId: photo.versionId,
      filename: photo.filename,
    }));

  function toggle(photo: GuestBatchCommentPhoto) {
    if (locked || confirmation !== null) return;
    setSelected((existing) => {
      const next = new Set(existing);
      if (next.has(photo.id)) next.delete(photo.id);
      else if (next.size < 24) next.add(photo.id);
      return next;
    });
    setNotice(null);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      current.status !== 'ready' ||
      !current.guestId ||
      locked ||
      operation ||
      selectedTargets.length < 1 ||
      selectedTargets.length > 24 ||
      !guestCommentBodySchema.safeParse(resumedBody).success
    ) {
      return;
    }
    setConfirmation(selectedTargets);
  }

  function confirmBatch() {
    if (
      !confirmation ||
      current.status !== 'ready' ||
      !current.guestId ||
      locked ||
      operation
    )
      return;
    const parsed = guestCommentBodySchema.safeParse(resumedBody);
    if (!parsed.success) {
      setNotice('留言需為 1–2000 字，且不可含控制字元。');
      setConfirmation(null);
      return;
    }
    void beginCommand(
      {
        requestId: globalThis.crypto.randomUUID(),
        expectedGuestId: current.guestId,
        operation: 'create',
        targets: confirmation.map(({ photoId, versionId }) => ({
          photoId,
          versionId,
        })),
        body: parsed.data,
      },
      confirmation,
      parsed.data,
    );
  }

  function recoveryForm() {
    if (!operation || operation.phase !== 'recovery-required') return null;
    const metadata = operation.metadata;
    const names = new Map(
      visiblePhotos.map((photo) => [photo.id, photo.filename]),
    );
    const chosen = visiblePhotos
      .filter((photo) => selected.has(photo.id))
      .map(({ id, versionId }) => ({ photoId: id, versionId }));
    const matching =
      metadata.operation === 'create' && equalTargets(metadata.targets, chosen);
    return (
      <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-medium text-amber-950">
          {operation.message}
        </p>
        <p className="mt-1 break-words text-xs">
          {operationSummary(operation, names)}
        </p>
        {metadata.operation === 'create' ? (
          <>
            <p className="mt-2 text-xs">
              請重新勾選原目標並輸入完全相同的留言。工作階段儲存只保留識別資料與內容雜湊。
            </p>
            <label
              htmlFor="batch-comment-recovery-body"
              className="mt-3 block text-sm"
            >
              原留言內容
            </label>
            <textarea
              id="batch-comment-recovery-body"
              data-testid="batch-comment-recovery-body"
              value={recoveryBody}
              onChange={(event) => {
                setRecoveryBody(event.target.value);
                setRecoveryNotice(null);
              }}
              maxLength={8000}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-amber-400 bg-white px-3 py-2 text-sm"
            />
            {recoveryNotice && (
              <p role="alert" className="mt-2 text-sm text-rose-800">
                {recoveryNotice}
              </p>
            )}
            <button
              type="button"
              data-testid="batch-comment-recovery-retry"
              onClick={() => void recoverOriginal()}
              disabled={!matching || !recoveryBody || preparing}
              className="mt-2 rounded bg-amber-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              使用原留言操作重試
            </button>
          </>
        ) : (
          <p className="mt-2 text-xs">請回到原照片留言面板恢復此操作。</p>
        )}
      </div>
    );
  }

  if (
    current.status === 'loading' ||
    current.status === 'disabled' ||
    current.status === 'denied'
  ) {
    return null;
  }
  if (current.status === 'unauthorized') {
    return null;
  }

  return (
    <details
      className="guest-batch-comment-disclosure"
      open={operation ? true : undefined}
    >
      <summary>批次留言</summary>
      <section
        data-testid="guest-batch-comment-composer"
        aria-label="批次留言"
        className="mb-5 rounded-lg border border-stone-200 bg-white p-4 text-stone-900"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">批次留言</h2>
            <p className="mt-1 text-sm text-stone-600">
              可獨立選擇目前顯示的照片，不會更動挑片結果；每次最多 24 張。
            </p>
          </div>
          <span className="text-xs text-stone-500">
            已選 {selectedTargets.length} / 24
          </span>
        </div>
        {truncated && (
          <p className="mt-2 text-xs text-stone-500">
            清單最多顯示 24 張照片；請在目前畫面分批留言。
          </p>
        )}
        {operation && (
          <CommentOperationNotice
            key={
              operation.phase === 'storage-blocked'
                ? operation.storageKey
                : metadataForOperation(operation)?.requestId
            }
            operation={operation}
            summary={operationSummary(
              operation,
              new Map(visiblePhotos.map((photo) => [photo.id, photo.filename])),
            )}
            testIdPrefix="batch-comment"
            onRetry={retryOriginal}
            retryDisabled={
              preparing ||
              operation.phase === 'pending' ||
              (operation.phase === 'conflict' && !operation.reloaded)
            }
            onAbandon={abandonCurrent}
            abandonAllowed={
              operation.phase !== 'conflict' || operation.reloaded
            }
          />
        )}
        {current.status === 'stale' && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
          >
            留言操作發生衝突。請明確重新載入權限，再重試原操作。
            <button
              type="button"
              data-testid="batch-comment-reload"
              onClick={reloadAccess}
              className="ml-2 rounded border border-amber-700 px-2 py-1"
            >
              重新載入權限
            </button>
          </div>
        )}
        {current.status === 'error' && (
          <div
            role="status"
            className="mt-3 rounded-md border border-stone-300 bg-stone-50 p-3 text-sm"
          >
            留言權限暫時無法載入。
            <button
              type="button"
              data-testid="batch-comment-reload"
              onClick={reloadAccess}
              className="ml-2 rounded border border-stone-300 px-2 py-1"
            >
              重試
            </button>
          </div>
        )}
        {current.status === 'ready' && (
          <>
            {operation?.phase === 'recovery-required' ? (
              recoveryForm()
            ) : (
              <form className="mt-3" onSubmit={review}>
                <fieldset
                  disabled={locked || confirmation !== null}
                  className="min-w-0 border-0 p-0"
                >
                  <legend className="text-sm font-medium">
                    選擇要留言的照片
                  </legend>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {visiblePhotos.map((photo) => (
                      <li key={photo.id} className="min-w-0">
                        <label className="flex min-w-0 items-start gap-2 rounded-md border border-stone-200 p-2 text-sm hover:bg-stone-50">
                          <input
                            type="checkbox"
                            data-testid={'batch-comment-toggle-' + photo.id}
                            checked={selected.has(photo.id)}
                            onChange={() => toggle(photo)}
                            disabled={locked || confirmation !== null}
                            className="mt-0.5 h-4 w-4 shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block break-words font-medium">
                              {photo.filename}
                            </span>
                            <span className="block break-all text-xs text-stone-500">
                              目前顯示版本
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
                {confirmation === null ? (
                  <div className="mt-3">
                    <label
                      htmlFor="batch-comment-body"
                      className="block text-sm font-medium"
                    >
                      留言內容
                    </label>
                    <textarea
                      id="batch-comment-body"
                      data-testid="batch-comment-body"
                      value={resumedBody}
                      onChange={(event) => {
                        setBody(event.target.value);
                        setNotice(null);
                      }}
                      disabled={locked}
                      maxLength={8000}
                      rows={3}
                      placeholder="以純文字新增同一則留言至所選照片版本"
                      className="mt-1 w-full resize-y rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      data-testid="batch-comment-submit"
                      disabled={
                        locked ||
                        selectedTargets.length === 0 ||
                        !guestCommentBodySchema.safeParse(resumedBody).success
                      }
                      className="mt-2 rounded bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                    >
                      檢查目標並繼續
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="font-medium text-amber-950">
                      確認要在 {confirmation.length} 張照片新增留言
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">
                      {confirmation.map((target) => (
                        <li key={target.photoId} className="break-words">
                          {target.filename} · 本次選定版本
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 whitespace-pre-wrap break-words rounded bg-white p-2 text-sm">
                      {body}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="batch-comment-confirm"
                        onClick={confirmBatch}
                        disabled={
                          locked ||
                          !guestCommentBodySchema.safeParse(resumedBody).success
                        }
                        className="rounded bg-amber-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                      >
                        確認送出留言
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmation(null)}
                        disabled={locked}
                        className="rounded border border-stone-300 px-3 py-1.5 text-sm disabled:opacity-50"
                      >
                        修改目標
                      </button>
                    </div>
                  </div>
                )}
                {notice && (
                  <p role="status" className="mt-3 text-sm">
                    {notice}
                  </p>
                )}
              </form>
            )}
          </>
        )}
      </section>
    </details>
  );
}
