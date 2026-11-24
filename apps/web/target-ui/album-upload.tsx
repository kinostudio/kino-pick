'use client';

import type { UploadProgress } from './upload-window';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { folderFileKey, readDroppedFiles } from './dropped-files';
import {
  batchKey,
  encodeFolderBatch,
  readFolderBatch,
  type BatchFile,
} from './upload-folder-batch';
import { photoDisplayName } from './photo-filename';
import {
  ImagePreparationError,
  MAX_BROWSER_UPLOAD_BYTES,
  prepareImage,
  sha256,
  type PreparedImage,
} from './prepare-image';
import {
  authorizeUpload,
  cancelUpload,
  completeUpload,
  DirectUploadResponseError,
  getUploadCapabilities,
  getUploadSession,
  getUploadOwner,
  getUploadRecovery,
  putUploadFile,
  reserveUpload,
  UploadProtocolError,
  UploadRequestError,
  type InitUploadBody,
  type UploadAuthorization,
  type UploadCapabilities,
  type UploadCompletion,
} from './upload-client';

import {
  encodeUploadJournal,
  decodeUploadJournal,
  uploadJournalKey,
  type UploadJournalScope,
  type UploadJournalItem,
} from './upload-journal';

const MAX_ACTIVE_JOURNAL_ITEMS = 20;
const ORIGINAL_UPLOAD_TIMEOUT_MS = 180_000;
const ORIGINAL_RECOVERY_DELAYS_MS = [2000, 8000];
declare const __UPLOAD_SLOTS__: number;
const MAX_PARALLEL_UPLOADS =
  typeof __UPLOAD_SLOTS__ === 'number' ? __UPLOAD_SLOTS__ : 10;
const QUEUE_TRANSIENT_PAUSE_MS = 10_000;

type ItemStatus =
  | 'needs_file'
  | 'validating'
  | 'ready'
  | 'working'
  | 'retry'
  | 'blocked'
  | 'needs_review'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'rejected';

type RetryAction =
  'upload' | 'confirm' | 'cancel' | 'status' | 'restore' | null;

type QueueItem = {
  id: string;
  received?: boolean | undefined;
  file: File | null;
  filename: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  restored: boolean;
  started: boolean;
  verified: boolean;
  generation: number;
  status: ItemStatus;
  message: string;
  stage: string;
  previewUrl: string | null;
  image: PreparedImage | null;
  initBody: InitUploadBody | null;
  uploadSessionId: string | null;
  authorizeBody: { requestId: string } | null;
  authorization: UploadAuthorization | null;
  completeBody: { requestId: string } | null;
  cancelBody: { requestId: string } | null;
  retryAction: RetryAction;
};

function queuedPhoto(
  id: string,
  filename: string,
  byteSize: number,
  generation: number,
  file: File | null,
): QueueItem {
  return {
    id,
    file,
    filename,
    byteSize,
    generation,
    width: null,
    height: null,
    restored: false,
    started: false,
    verified: Boolean(file),
    status: file ? 'validating' : 'needs_file',
    message: '',
    stage: file ? '等候處理' : '',
    previewUrl: null,
    image: null,
    initBody: null,
    uploadSessionId: null,
    authorizeBody: null,
    authorization: null,
    completeBody: null,
    cancelBody: null,
    retryAction: null,
  };
}

type CapabilityState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; value: UploadCapabilities };

type AlbumUploadProps = {
  workspaceId: string;
  projectId: string;
  albumId: string;
  onCompleted?: () => void;
  onUploadProgress?: (progress: UploadProgress | null) => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function failureMessage(error: unknown) {
  if (!(error instanceof UploadRequestError))
    return '目前無法確認這筆上傳結果。請使用下方按鈕重試，系統會接續原本的工作。';
  switch (error.code) {
    case 'AUTH_REQUIRED':
    case 'OWNER_REQUIRED':
    case 'UPLOAD_OWNER_CHANGED':
      return '登入狀態已失效或尚未取得管理者授權，請重新登入後再繼續。';
    case 'PROCESSING_SOURCE_LIMIT':
      return '此工作區使用 Cloudflare 縮圖，每張照片最多約 16.8 MB。請選擇較小的照片。';
    case 'STORAGE_QUOTA_EXCEEDED':
      return '目前可用空間不足，這張照片尚未完成上傳。';
    case 'UPLOAD_SESSION_EXPIRED':
      return '這筆工作的期限已到。請核對上傳狀態，確認後可接續原檔。';
    case 'UPLOAD_AUTHORIZATION_EXPIRED':
      return '這筆上傳授權已逾期，不能直接重傳。請先取消此工作；若系統發現已收到照片，會保留檔案並請您確認狀態。';
    case 'UPLOAD_ALREADY_AUTHORIZED':
      return '這筆工作已有另一項上傳授權，為避免重複占用，請保留記錄並聯絡管理者處理。';
    case 'REQUEST_ID_CONFLICT':
      return '這筆工作的回應無法安全核對，請保留記錄並聯絡管理者處理。';
    case 'DIRECT_UPLOAD_DISABLED':
    case 'DIRECT_UPLOAD_NOT_CONFIGURED':
      return '目前尚未開放照片上傳，請稍後再試。';
    case 'UPLOAD_CONTENT_INVALID':
    case 'UPLOAD_NEEDS_REVIEW':
      return '照片已進入檢查流程，尚未標示完成；請由管理者檢查這筆工作。';
    case 'NOT_FOUND':
      return '找不到這筆上傳工作。請保留目前記錄並重新整理相簿。';
    case 'INVALID_INPUT':
      return '這筆照片資料未通過檢查，尚未標示完成。請確認檔案後再處理。';
    default:
      if (error.status === 429)
        return '上傳請求過於頻繁。請稍後批量恢復上傳狀態（HTTP 429）。';
      if (error.status === 408 || error.status >= 500)
        return `上傳服務暫時無法確認結果（HTTP ${error.status}）。請使用批量恢復上傳狀態。`;
      return `無法完成上傳（HTTP ${error.status}，${error.code}）。`;
  }
}

function isRecoverable(error: unknown) {
  if (error instanceof UploadProtocolError) return error.retryable;
  if (error instanceof UploadRequestError)
    return error.status === 408 || error.status === 429 || error.status >= 500;
  if (error instanceof DirectUploadResponseError)
    return error.status === 408 || error.status === 429 || error.status >= 500;
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      ['AbortError', 'TimeoutError'].includes(error.name))
  );
}

function statusLabel(status: ItemStatus) {
  switch (status) {
    case 'needs_file':
      return '等待恢復';
    case 'validating':
      return '檢查中';
    case 'ready':
      return '等待上傳';
    case 'working':
      return '處理中';
    case 'retry':
      return '等待重試';
    case 'blocked':
      return '需要處理';
    case 'needs_review':
      return '需要檢查';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return '已取消';
    case 'expired':
      return '已逾期';
    case 'rejected':
      return '未加入';
  }
}

export function AlbumUpload({
  workspaceId,
  projectId,
  albumId,
  onCompleted,
  onUploadProgress,
}: AlbumUploadProps) {
  const [capability, setCapability] = useState<CapabilityState>({
    status: 'loading',
  });
  const [items, setItemsState] = useState<QueueItem[]>([]);
  const [notice, setNotice] = useState('');
  const [timing, setTiming] = useState({
    started: 0,
    elapsed: 0,
  });

  const deliveries = useRef<{ at: number; bytes: number }[]>([]);
  const pauseDispatchUntil = useRef(0);
  useEffect(() => {
    if (!timing.started) return;
    const timer = window.setInterval(() => {
      if (!operationLockRef.current) return;
      setTiming((current) => ({
        ...current,
        elapsed: performance.now() - current.started,
      }));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [timing.started]);
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [partialHistory, setPartialHistory] = useState(false);
  const [folderPending, setFolderPending] = useState(false);
  const batchRef = useRef<BatchFile[]>([]);
  const [journalReady, setJournalReady] = useState(false);
  const [journalIssue, setJournalIssue] = useState('');
  const [hasJournalLock, setHasJournalLock] = useState(false);
  const journalScopeRef = useRef<UploadJournalScope | null>(null);
  const journalIssueRef = useRef(false);
  const generationRef = useRef(0);
  const lifecycleSignalRef = useRef<AbortSignal | null>(null);
  const releaseJournalRef = useRef<(() => void) | null>(null);
  const titleId = useId();
  const itemsRef = useRef<QueueItem[]>([]);
  const mountedRef = useRef(false);
  const operationLockRef = useRef(false);
  const derivativeRef = useRef<Promise<void> | null>(null);
  const selectionLockRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    journalScopeRef.current = null;
    batchRef.current = [];
    setPartialHistory(false);
    setFolderPending(false);
    journalIssueRef.current = false;
    const controller = new AbortController();
    lifecycleSignalRef.current = controller.signal;
    void getUploadCapabilities(controller.signal, workspaceId)
      .then(async (value) => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setCapability({ status: 'ready', value });
        if (!value.enabled) {
          setJournalReady(true);
          return;
        }
        const actorId = await getUploadOwner(controller.signal);
        if (controller.signal.aborted) return;
        if (!navigator.locks) {
          journalIssueRef.current = true;
          setJournalIssue(
            '此瀏覽器不支援安全的跨分頁續傳鎖，已停止上傳。請使用支援 Web Locks 的瀏覽器及安全連線。',
          );
          return;
        }
        const scope = { actorId, workspaceId, projectId, albumId };
        await navigator.locks.request(
          uploadJournalKey(scope),
          { ifAvailable: true },
          async (lock) => {
            if (controller.signal.aborted) return;
            if (!lock) {
              journalIssueRef.current = true;
              setJournalIssue(
                '另一個分頁正在控制此相簿的上傳。請關閉該分頁或離開相簿後重新載入。',
              );
              return;
            }
            journalScopeRef.current = scope;
            setHasJournalLock(true);
            try {
              const key = uploadJournalKey(scope);
              const raw = localStorage.getItem(key);
              const saved = decodeUploadJournal(raw, scope);
              const batch = readFolderBatch(scope);
              batchRef.current = batch;
              localStorage.setItem(key, raw ?? encodeUploadJournal(scope, []));
              const restored: QueueItem[] = saved.map((entry) => ({
                ...entry,
                file: null,
                filename: entry.initBody.originalFilename,
                byteSize: entry.initBody.expectedBytes,
                restored: true,
                started: true,
                verified: false,
                generation,
                status: 'needs_file',
                message:
                  '已恢復工作資訊；請先確認伺服器狀態，需要傳送照片時再重新選擇原檔。',
                stage: '',
                previewUrl: null,
                image: null,
                authorization: null,
                retryAction: 'restore',
              }));
              setPartialHistory(!batch.length && restored.length > 0);
              const folderIds = new Set(batch.map((entry) => entry.id));
              const restoredById = new Map(
                restored.map((item) => [item.id, item]),
              );
              const next = [
                ...restored.filter((item) => !folderIds.has(item.id)),
                ...batch
                  .filter((entry) => entry.state !== 'skipped')
                  .map((entry): QueueItem => {
                    const placeholder = queuedPhoto(
                      entry.id,
                      entry.name,
                      entry.bytes,
                      generation,
                      null,
                    );
                    if (entry.state === 'completed')
                      return {
                        ...placeholder,
                        status: 'completed',
                        message: '已入庫，續傳時略過。',
                      };
                    return restoredById.get(entry.id) ?? placeholder;
                  }),
              ];
              itemsRef.current = next;
              setItemsState(next);
              setFolderPending(
                batch.some((entry) => entry.state === 'pending'),
              );
              setJournalReady(true);
            } catch {
              journalIssueRef.current = true;
              setJournalIssue(
                '無法讀取或保存本機續傳資訊；記錄可能損壞、過期或瀏覽器禁止儲存。尚未送出新上傳。',
              );
            }
            await new Promise<void>((resolve) => {
              releaseJournalRef.current = resolve;
              if (controller.signal.aborted) resolve();
            });
          },
        );
      })
      .catch(() => {
        if (mountedRef.current && !controller.signal.aborted)
          setCapability({
            status: 'unavailable',
            message: '目前無法確認上傳功能狀態，請稍後重新整理。',
          });
      });
    return () => {
      mountedRef.current = false;
      generationRef.current = generation + 1;
      journalScopeRef.current = null;
      controller.abort();
      releaseJournalRef.current?.();
      for (const item of itemsRef.current)
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    };
  }, [workspaceId, projectId, albumId]);

  const hasUnfinishedServerWork = items.some(
    (item) =>
      item.started &&
      !['completed', 'cancelled', 'expired', 'rejected'].includes(item.status),
  );
  const hasUnstartedLocalQueue = items.some(
    (item) => !item.started && ['validating', 'ready'].includes(item.status),
  );

  useEffect(() => {
    if (!hasUnfinishedServerWork && !hasUnstartedLocalQueue) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasUnfinishedServerWork, hasUnstartedLocalQueue]);

  function saveFolderBatch(scope: UploadJournalScope, entries: BatchFile[]) {
    if (entries.some((entry) => entry.state === 'pending')) {
      localStorage.setItem(batchKey(scope), encodeFolderBatch(scope, entries));
      batchRef.current = entries;
    } else {
      localStorage.removeItem(batchKey(scope));
      batchRef.current = [];
    }
  }

  function commitItems(next: QueueItem[]) {
    itemsRef.current = next;
    const scope = journalScopeRef.current;
    if (scope && mountedRef.current && !journalIssueRef.current) {
      try {
        if (batchRef.current.length > 0) {
          const current = new Map(next.map((item) => [item.id, item]));
          const batch = batchRef.current.map((entry): BatchFile => {
            if (entry.state !== 'pending') return entry;
            const item = current.get(entry.id);
            const state =
              item?.status === 'completed'
                ? 'completed'
                : !item ||
                    ['rejected', 'cancelled', 'expired'].includes(item.status)
                  ? 'skipped'
                  : 'pending';
            const sha = item?.initBody?.sha256 ?? entry.sha256;
            return state !== entry.state || sha !== entry.sha256
              ? { ...entry, state, sha256: sha }
              : entry;
          });
          if (batch.some((entry, index) => entry !== batchRef.current[index])) {
            // Save the completion before removing its recovery operation from the journal.
            // Keep a fully terminal receipt until the journal write below has succeeded.
            localStorage.setItem(
              batchKey(scope),
              encodeFolderBatch(scope, batch),
            );
            batchRef.current = batch;
          }
        }
        const entries: UploadJournalItem[] = [];
        for (const item of next) {
          if (
            !item.started ||
            !item.initBody ||
            item.width === null ||
            item.height === null ||
            ['completed', 'cancelled', 'expired', 'rejected'].includes(
              item.status,
            )
          )
            continue;
          entries.push({
            id: item.id,
            ...(item.received ? { received: true } : {}),
            initBody: item.initBody,
            uploadSessionId: item.uploadSessionId,
            authorizeBody: item.authorizeBody,
            completeBody: item.completeBody,
            cancelBody: item.cancelBody,
            width: item.width,
            height: item.height,
          });
        }
        localStorage.setItem(
          uploadJournalKey(scope),
          encodeUploadJournal(scope, entries),
        );
        if (
          batchRef.current.length &&
          batchRef.current.every((entry) => entry.state !== 'pending')
        ) {
          saveFolderBatch(scope, batchRef.current);
        }
      } catch {
        journalIssueRef.current = true;
        setJournalIssue(
          '無法保存續傳資訊，已停止後續上傳請求。請保留目前畫面，待瀏覽器儲存恢復後重新載入。',
        );
      }
    }
    if (mountedRef.current) setItemsState(next);
  }
  function slowDispatch(delay: number) {
    pauseDispatchUntil.current = Math.max(
      pauseDispatchUntil.current,
      performance.now() + Math.max(delay, QUEUE_TRANSIENT_PAUSE_MS),
    );
  }
  async function waitForDispatch() {
    while (performance.now() < pauseDispatchUntil.current) {
      setNotice('上傳服務暫時無法回應，稍後會自動接續排隊照片。');
      await new Promise((resolve) =>
        window.setTimeout(
          resolve,
          pauseDispatchUntil.current - performance.now(),
        ),
      );
    }
  }
  function currentJournalActor(item: QueueItem) {
    const scope = journalScopeRef.current;
    if (
      !mountedRef.current ||
      !scope ||
      journalIssueRef.current ||
      item.generation !== generationRef.current ||
      scope.workspaceId !== workspaceId ||
      scope.projectId !== projectId ||
      scope.albumId !== albumId
    )
      throw new UploadProtocolError(false);
    return scope.actorId;
  }

  async function ensureJournalIdentity(item: QueueItem) {
    const actorId = currentJournalActor(item);
    if ((await getUploadOwner()) !== actorId) {
      for (const item of itemsRef.current) item.authorization = null;
      journalIssueRef.current = true;
      setJournalIssue('登入帳號已變更，已停止上傳；請重新載入後使用目前帳號。');
      throw new UploadProtocolError(false);
    }
    currentJournalActor(item);
    return actorId;
  }

  function updateItem(
    id: string,
    update: (item: QueueItem) => QueueItem,
  ): QueueItem | null {
    const current = itemsRef.current.find((item) => item.id === id);
    if (!current) return null;
    const updated = update(current);
    if (updated.generation !== generationRef.current) return null;
    commitItems(
      itemsRef.current.map((item) => (item.id === id ? updated : item)),
    );
    return updated;
  }

  function setBusyState(value: boolean) {
    if (mountedRef.current) setBusy(value);
  }

  function enterOperation() {
    if (
      operationLockRef.current ||
      !mountedRef.current ||
      journalIssueRef.current ||
      !journalScopeRef.current
    )
      return false;
    operationLockRef.current = true;
    setBusyState(true);
    return true;
  }

  function leaveOperation() {
    if (mountedRef.current) {
      const now = performance.now();
      setTiming((current) =>
        current.started
          ? { ...current, elapsed: now - current.started }
          : current,
      );
    }
    operationLockRef.current = false;
    setBusyState(false);
  }

  function notifyAlbumChanged(generation: number) {
    if (mountedRef.current && generationRef.current === generation) {
      try {
        onCompleted?.();
      } catch {
        // A refresh callback must not turn a confirmed server completion into a failed upload.
      }
    }
  }

  function finishCompleted(id: string, item: QueueItem) {
    updateItem(id, (current) => ({
      ...current,
      status: 'completed',
      stage: '',
      retryAction: null,
      message: `照片已完成上傳（${item.width ?? 0} × ${item.height ?? 0}）。`,
    }));
    notifyAlbumChanged(item.generation);
  }

  function finishNeedsReview(id: string) {
    updateItem(id, (current) => ({
      ...current,
      status: 'needs_review',
      stage: '',
      retryAction: null,
      message:
        '這筆照片需要人工檢查，尚未標示完成。請保留這項記錄，交由管理者處理。',
    }));
  }

  function finishFromCompletion(
    id: string,
    item: QueueItem,
    completion: UploadCompletion,
  ) {
    if (completion.status === 'needs_review') {
      finishNeedsReview(id);
      return 'terminal' as const;
    }
    if (completion.actualBytes !== item.byteSize) {
      updateItem(id, (current) => ({
        ...current,
        status: 'blocked',
        stage: '',
        retryAction: null,
        message:
          '系統回報的照片大小與原始檔案不一致，尚未標示完成。請保留這筆工作並聯絡管理者檢查。',
      }));
      return 'terminal' as const;
    }
    finishCompleted(id, item);
    return 'terminal' as const;
  }

  async function confirmServerCompletion(id: string, item: QueueItem) {
    if (!item.uploadSessionId || !item.completeBody)
      throw new UploadProtocolError();
    const expectedActorId = currentJournalActor(item);
    const completion = await completeUpload(
      item.uploadSessionId,
      item.completeBody,
      expectedActorId,
      capability.status === 'ready' && capability.value.browserProcessing
        ? (item.file ?? undefined)
        : undefined,
      async (process) => {
        // Queue derivatives without holding up the next original upload.
        const pending = Promise.resolve(derivativeRef.current)
          .then(async () => {
            if (
              !mountedRef.current ||
              generationRef.current !== item.generation
            )
              return;
            await process();
            notifyAlbumChanged(item.generation);
          })
          .catch(() => {
            // The original is durable and Cloudflare can finish processing it.
          });
        derivativeRef.current = pending;
        void pending.then(() => {
          if (derivativeRef.current === pending) derivativeRef.current = null;
        });
      },
      slowDispatch,
    );
    finishFromCompletion(id, item, completion);
  }

  async function reconcileAlreadyCompleted(id: string, item: QueueItem) {
    if (!item.uploadSessionId) return false;
    try {
      const session = await getUploadSession(item.uploadSessionId);
      if (session.status === 'needs_review') {
        finishNeedsReview(id);
        return true;
      }
      if (session.status === 'completed') {
        finishCompleted(id, item);
        return true;
      }
      if (session.status === 'expired' || session.status === 'cancelled') {
        updateItem(id, (current) => ({
          ...current,
          status: session.status === 'expired' ? 'expired' : 'cancelled',
          stage: '',
          retryAction: null,
          message:
            session.status === 'expired'
              ? '這筆上傳工作已逾期，可從清單移除。'
              : '這筆上傳工作已取消，可從清單移除。',
        }));
        return true;
      }
    } catch {
      // Keep the original response as the actionable error if the status read fails.
    }
    return false;
  }

  async function recoverItem(
    id: string,
    item: QueueItem,
    purpose: 'resume' | 'cancel' = 'resume',
  ): Promise<QueueItem | null> {
    try {
      if (!item.initBody) throw new UploadProtocolError(false);
      await ensureJournalIdentity(item);
      let recovery;
      try {
        recovery = await getUploadRecovery(item.initBody.requestId);
      } catch (error) {
        if (
          !(error instanceof UploadRequestError) ||
          error.status !== 404 ||
          item.uploadSessionId !== null
        )
          throw error;
        const waiting = {
          ...item,
          restored: !item.file,
          status: item.file ? ('ready' as const) : ('needs_file' as const),
          retryAction: item.file ? null : ('restore' as const),
          message:
            '伺服器尚無這筆工作；請重新選擇原檔，再使用開始上傳接續同一操作。',
          stage: '',
        };
        updateItem(id, () => waiting);
        return item.file ? waiting : null;
      }
      const session = recovery.uploadSession;
      const expected = item.initBody;
      if (
        recovery.initRequestId !== expected.requestId ||
        session.workspaceId !== workspaceId ||
        session.projectId !== projectId ||
        session.albumId !== albumId ||
        session.originalFilename !== expected.originalFilename.trim() ||
        session.expectedBytes !== expected.expectedBytes ||
        recovery.sha256 !== expected.sha256 ||
        recovery.contentType !== expected.contentType ||
        (item.uploadSessionId && session.id !== item.uploadSessionId) ||
        (item.authorizeBody &&
          recovery.authorizationRequestId &&
          item.authorizeBody.requestId !== recovery.authorizationRequestId)
      )
        throw new UploadProtocolError(false);
      const next: QueueItem = {
        ...item,
        uploadSessionId: session.id,
        authorization: null,
        verified: true,
        authorizeBody: recovery.authorizationRequestId
          ? { requestId: recovery.authorizationRequestId }
          : item.authorizeBody,
        completeBody: item.completeBody ?? { requestId: crypto.randomUUID() },
        restored: true,
      };
      updateItem(id, () => next);
      if (session.status === 'completed') {
        finishCompleted(id, next);
        return null;
      }
      if (session.status === 'needs_review') {
        finishNeedsReview(id);
        return null;
      }
      if (
        session.status === 'expired' &&
        purpose === 'resume' &&
        !item.cancelBody
      ) {
        // The server expires an issued reservation only after fencing the absent original.
        const renewal: QueueItem = {
          ...item,
          uploadSessionId: null,
          authorization: null,
          authorizeBody: null,
          completeBody: null,
          received: false,
          initBody: { ...expected, requestId: crypto.randomUUID() },
          status: item.file ? 'ready' : 'needs_file',
          restored: !item.file,
          verified: Boolean(item.file),
          retryAction: item.file ? null : 'restore',
          stage: '',
          message: item.file
            ? '舊工作已逾期，將重新上傳原檔。'
            : '舊工作已逾期。請重選原檔以繼續上傳。',
        };
        updateItem(id, () => renewal);
        return item.file && !journalIssueRef.current ? renewal : null;
      }
      if (session.status === 'expired' || session.status === 'cancelled') {
        updateItem(id, (current) => ({
          ...current,
          status: session.status === 'expired' ? 'expired' : 'cancelled',
          retryAction: null,
          stage: '',
          message: '伺服器已確認工作結束，未建立新的上傳。',
        }));
        return null;
      }
      if (next.cancelBody || purpose === 'cancel') {
        updateItem(id, (current) => ({
          ...current,
          status: 'retry',
          retryAction: 'cancel',
          stage: '',
          message: '已恢復尚未確認的取消操作，請確認或重試取消。',
        }));
        return null;
      }
      if (recovery.authorizationRequestId) {
        try {
          await confirmServerCompletion(id, next);
          return null;
        } catch (error) {
          if (
            !(error instanceof UploadRequestError) ||
            error.code !== 'UPLOAD_OBJECT_NOT_FOUND'
          ) {
            if (
              error instanceof UploadRequestError &&
              ['UPLOAD_CONTENT_INVALID', 'UPLOAD_NEEDS_REVIEW'].includes(
                error.code,
              )
            ) {
              finishNeedsReview(id);
              return null;
            }
            if (
              error instanceof UploadRequestError &&
              error.code === 'UPLOAD_ALREADY_COMPLETED' &&
              (await reconcileAlreadyCompleted(id, next))
            )
              return null;
            throw error;
          }
        }
      }
      if (
        recovery.authorizationExpiresAt &&
        Date.parse(recovery.authorizationExpiresAt) <= Date.now()
      ) {
        updateItem(id, (current) => ({
          ...current,
          status: 'blocked',
          retryAction: null,
          stage: '',
          message:
            '原上傳授權已逾期，尚未收到完整照片。請取消此工作；取消確認後，再加入原檔建立新工作。',
        }));
        return null;
      }
      const ready: QueueItem = {
        ...next,
        restored: !next.file,
        status: next.file ? 'ready' : 'needs_file',
        retryAction: next.file ? null : 'restore',
        stage: '',
        message: next.file
          ? '原檔與伺服器資訊已核對，可接續上傳。'
          : '尚未收到完整照片；請重新選擇原檔，核對後才會傳送。',
      };
      updateItem(id, () => ready);
      return ready.file ? ready : null;
    } catch (error) {
      const retryable = isRecoverable(error);
      updateItem(id, (current) => ({
        ...current,
        status: retryable ? 'retry' : 'blocked',
        retryAction: retryable ? 'restore' : null,
        stage: '',
        message:
          error instanceof UploadProtocolError && !error.retryable
            ? '續傳資料與伺服器不一致，已停止；請保留記錄並交由管理者檢查。'
            : failureMessage(error),
      }));
      return null;
    }
  }
  async function reselectFile(
    id: string,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !enterOperation()) return;
    let prepared: PreparedImage | null = null;
    try {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (
        !item?.initBody ||
        capability.status !== 'ready' ||
        !capability.value.enabled
      )
        return;
      prepared = await prepareImage(file, {
        ...capability.value,
        maxBrowserBytes: Math.min(
          capability.value.maxBrowserBytes,
          MAX_BROWSER_UPLOAD_BYTES,
        ),
      });
      if (
        file.name.trim() !== item.initBody.originalFilename.trim() ||
        file.size !== item.byteSize ||
        prepared.contentType !== item.initBody.contentType ||
        prepared.sha256 !== item.initBody.sha256 ||
        prepared.width !== item.width ||
        prepared.height !== item.height
      )
        throw new Error('FILE_MISMATCH');
      if (!mountedRef.current || item.generation !== generationRef.current) {
        URL.revokeObjectURL(prepared.previewUrl);
        prepared = null;
        return;
      }
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      const image = prepared;
      prepared = null;
      updateItem(id, (current) => ({
        ...current,
        file,
        image,
        previewUrl: image.previewUrl,
        restored: true,
        status: 'ready',
        retryAction: null,
        stage: '',
        message: '原檔雜湊與資訊一致；開始前會再核對伺服器狀態。',
      }));
    } catch {
      if (prepared) URL.revokeObjectURL(prepared.previewUrl);
      updateItem(id, (current) => ({
        ...current,
        message: '選擇的檔案內容或資訊不符，未傳送檔案。請重新選擇同一原檔。',
      }));
    } finally {
      leaveOperation();
    }
  }
  function clearLocalJournal() {
    const scope = journalScopeRef.current;
    if (
      !scope ||
      operationLockRef.current ||
      selectionLockRef.current ||
      !window.confirm(
        '只會清除此相簿的本機續傳記錄，不會取消伺服器工作或釋放容量；遺失的工作仍須另行處理。確定清除？',
      )
    )
      return;
    try {
      localStorage.setItem(
        uploadJournalKey(scope),
        encodeUploadJournal(scope, []),
      );
      saveFolderBatch(scope, []);
      setFolderPending(false);
      for (const item of itemsRef.current)
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      itemsRef.current = [];
      setItemsState([]);
      journalIssueRef.current = false;
      setJournalIssue('');
      setJournalReady(true);
    } catch {
      setJournalIssue('瀏覽器仍無法保存本機資訊，尚未送出新上傳。');
    }
  }
  async function waitForUploadConnection(id: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (navigator.onLine) return;
    updateItem(id, (current) => ({ ...current, stage: '等待網路恢復…' }));
    await new Promise<void>((resolve) => {
      const finish = () => {
        window.removeEventListener('online', finish);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      window.addEventListener('online', finish, { once: true });
      signal.addEventListener('abort', finish, { once: true });
      if (navigator.onLine || signal.aborted) finish();
    });
    signal.throwIfAborted();
  }

  async function runUpload(
    id: string,
    startingItem: QueueItem,
    enqueueConfirmation?: (work: () => Promise<void>) => void,
  ) {
    let item = startingItem;
    if (item.restored) {
      const recovered = await recoverItem(id, item);
      if (!recovered) return;
      item = recovered;
    }
    if (!item.file || !item.image) return;
    item = {
      ...item,
      started: true,
      status: 'working',
      stage: '準備上傳工作…',
      message: '',
      retryAction: null,
    };
    updateItem(id, () => item);

    try {
      if (!item.initBody) throw new UploadProtocolError();

      const hasExistingSession = Boolean(item.uploadSessionId);
      if (!item.uploadSessionId) {
        updateItem(id, (current) => ({
          ...current,
          stage: '建立上傳工作…',
        }));
        const expectedActorId = currentJournalActor(item);
        const session = await reserveUpload(
          item.initBody,
          expectedActorId,
          slowDispatch,
        );
        item = {
          ...item,
          status: 'working',
          stage: '上傳工作已建立，準備取得授權…',
          uploadSessionId: session.id,
          completeBody: { requestId: crypto.randomUUID() },
        };
        updateItem(id, () => item);
      }

      if (!item.authorization) {
        let authorizeBody = item.authorizeBody;
        if (!authorizeBody) {
          authorizeBody = { requestId: crypto.randomUUID() };
          item = {
            ...item,
            status: 'working',
            stage: '準備取得這筆工作的短效上傳授權…',
            authorizeBody,
          };
          updateItem(id, () => item);
        }
        if (!item.uploadSessionId) throw new UploadProtocolError();
        updateItem(id, (current) => ({
          ...current,
          stage: '取得這筆工作的短效上傳授權…',
        }));
        const expectedActorId = currentJournalActor(item);
        const authorization = await authorizeUpload(
          item.uploadSessionId,
          authorizeBody,
          expectedActorId,
          slowDispatch,
        );
        item = {
          ...item,
          status: 'working',
          stage: '上傳授權已取得，準備確認照片狀態…',
          authorization,
        };
        updateItem(id, () => item);
      }

      if (!item.uploadSessionId || !item.completeBody || !item.authorization)
        throw new UploadProtocolError();

      const signal = lifecycleSignalRef.current;
      if (!signal) throw new UploadProtocolError();
      let receivedOrUncertain = hasExistingSession;
      let lastFailure: unknown;
      let recoveryAttempts = 0;

      for (;;) {
        await waitForUploadConnection(id, signal);
        if (receivedOrUncertain) {
          updateItem(id, (current) => ({
            ...current,
            stage: '確認原圖是否已收到…',
          }));
          try {
            await confirmServerCompletion(id, item);
            return;
          } catch (error) {
            if (
              error instanceof UploadRequestError &&
              error.code === 'UPLOAD_ALREADY_COMPLETED' &&
              (await reconcileAlreadyCompleted(id, item))
            )
              return;
            if (
              !(error instanceof UploadRequestError) ||
              error.status !== 409 ||
              error.code !== 'UPLOAD_OBJECT_NOT_FOUND'
            ) {
              const delay = ORIGINAL_RECOVERY_DELAYS_MS[recoveryAttempts++];
              if (!isRecoverable(error) || delay === undefined) throw error;
              await new Promise((resolve) => window.setTimeout(resolve, delay));
              continue;
            }
          }
        }

        if (receivedOrUncertain && lastFailure !== undefined) {
          const delay = ORIGINAL_RECOVERY_DELAYS_MS[recoveryAttempts++];
          if (delay === undefined) throw lastFailure;
          updateItem(id, (current) => ({
            ...current,
            stage: `準備重試原圖（${recoveryAttempts}/2）…`,
          }));
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          await waitForUploadConnection(id, signal);
        }

        try {
          await ensureJournalIdentity(item);
          signal.throwIfAborted();
          updateItem(id, (current) => ({
            ...current,
            received: false,
            stage: '直接上傳原始照片…',
          }));
          await putUploadFile(
            item.file!,
            item.image?.contentType ?? '',
            item.authorization,
            AbortSignal.any([
              signal,
              AbortSignal.timeout(ORIGINAL_UPLOAD_TIMEOUT_MS),
            ]),
          );
        } catch (error) {
          if (
            !isRecoverable(error) &&
            !(
              error instanceof DirectUploadResponseError && error.status === 412
            )
          )
            throw error;
          lastFailure = error;
          receivedOrUncertain = true;
          continue;
        }
        if (!mountedRef.current || item.generation !== generationRef.current)
          return;
        const now = performance.now();
        deliveries.current = deliveries.current.filter(
          (entry) => entry.at > now - 10000,
        );
        deliveries.current.push({ at: now, bytes: item.byteSize });
        item = { ...item, received: true, stage: '原圖已收到，等待入庫…' };
        updateItem(id, () => item);
        if (
          journalIssueRef.current ||
          !mountedRef.current ||
          item.generation !== generationRef.current
        )
          return;
        const confirm = async () => {
          await waitForDispatch();
          if (
            !mountedRef.current ||
            item.generation !== generationRef.current ||
            journalIssueRef.current
          )
            return;
          await confirmOnly(id, item);
        };
        if (enqueueConfirmation) enqueueConfirmation(confirm);
        else await confirm();
        return;
      }
    } catch (error) {
      if (!mountedRef.current || item.generation !== generationRef.current)
        return;
      if (
        error instanceof UploadRequestError &&
        (error.code === 'UPLOAD_CONTENT_INVALID' ||
          error.code === 'UPLOAD_NEEDS_REVIEW')
      ) {
        finishNeedsReview(id);
        return;
      }
      const directResponse = error instanceof DirectUploadResponseError;
      const expired =
        error instanceof UploadRequestError &&
        error.code === 'UPLOAD_SESSION_EXPIRED';
      const retryable = isRecoverable(error) || directResponse || expired;
      updateItem(id, (current) => ({
        ...current,
        status: retryable ? 'retry' : 'blocked',
        stage: '',
        retryAction: expired
          ? 'restore'
          : retryable
            ? directResponse && !isRecoverable(error)
              ? 'confirm'
              : 'upload'
            : null,
        message: directResponse
          ? '上傳服務尚未確認照片是否收到。先確認照片狀態後再決定下一步。'
          : failureMessage(error),
      }));
    }
  }

  async function confirmOnly(id: string, item: QueueItem) {
    updateItem(id, (current) => ({
      ...current,
      status: 'working',
      stage: '確認照片是否已完整收到…',
      message: '',
      retryAction: null,
    }));
    try {
      await confirmServerCompletion(id, item);
    } catch (error) {
      if (
        error instanceof UploadRequestError &&
        error.code === 'UPLOAD_OBJECT_NOT_FOUND' &&
        error.status === 409
      ) {
        updateItem(id, (current) => ({
          ...current,
          received: false,
          status: 'blocked',
          stage: '',
          retryAction: null,
          message:
            '目前沒有可完成的照片，這筆上傳工作仍保留。您可以重新嘗試取消，或稍後再確認。',
        }));
        return;
      }
      if (
        error instanceof UploadRequestError &&
        (error.code === 'UPLOAD_CONTENT_INVALID' ||
          error.code === 'UPLOAD_NEEDS_REVIEW')
      ) {
        finishNeedsReview(id);
        return;
      }
      if (
        error instanceof UploadRequestError &&
        error.code === 'UPLOAD_ALREADY_COMPLETED' &&
        (await reconcileAlreadyCompleted(id, item))
      )
        return;
      updateItem(id, (current) => ({
        ...current,
        status: isRecoverable(error) ? 'retry' : 'blocked',
        stage: '',
        retryAction: isRecoverable(error) ? 'confirm' : null,
        message: failureMessage(error),
      }));
    }
  }

  async function cancelSession(id: string, startingItem: QueueItem) {
    let item = startingItem;
    if (!item.uploadSessionId) return;
    if (!item.cancelBody) {
      item = {
        ...item,
        status: 'working',
        stage: '取消這筆未完成的上傳工作…',
        cancelBody: { requestId: crypto.randomUUID() },
      };
      updateItem(id, () => item);
    }
    updateItem(id, (current) => ({
      ...current,
      status: 'working',
      stage: '取消這筆未完成的上傳工作…',
      message: '',
      retryAction: null,
    }));
    try {
      if (!item.uploadSessionId || !item.cancelBody)
        throw new UploadProtocolError();
      const expectedActorId = await ensureJournalIdentity(item);
      const result = await cancelUpload(
        item.uploadSessionId,
        item.cancelBody,
        expectedActorId,
      );
      if (result.status === 'cancelled') {
        updateItem(id, (current) => ({
          ...current,
          status: 'cancelled',
          stage: '',
          retryAction: null,
          message: '這筆未完成的上傳工作已取消。',
        }));
        return;
      }
      if (result.status === 'expired') {
        updateItem(id, (current) => ({
          ...current,
          status: 'expired',
          stage: '',
          retryAction: null,
          message: '這筆上傳工作已逾期，沒有標示為完成。',
        }));
        return;
      }
      if (result.status === 'needs_review') {
        finishNeedsReview(id);
        return;
      }
      if (result.status === 'completed') {
        if (!(await reconcileAlreadyCompleted(id, item)))
          updateItem(id, (current) => ({
            ...current,
            status: 'blocked',
            stage: '',
            retryAction: null,
            message:
              '系統回報這筆工作已完成，但目前無法重新確認。請保留記錄並聯絡管理者檢查。',
          }));
        return;
      }
      throw new UploadProtocolError();
    } catch (error) {
      if (
        error instanceof UploadRequestError &&
        [
          'INVALID_STATE_TRANSITION',
          'UPLOAD_SESSION_EXPIRED',
          'UPLOAD_ALREADY_COMPLETED',
        ].includes(error.code)
      ) {
        if (await reconcileAlreadyCompleted(id, item)) return;
        updateItem(id, (current) => ({
          ...current,
          status: 'retry',
          stage: '',
          retryAction: 'status',
          message:
            '這筆工作的狀態已變更，請稍後確認狀態；系統會保留原工作，不會重複上傳。',
        }));
        return;
      }
      if (
        error instanceof UploadRequestError &&
        error.code === 'UPLOAD_OBJECT_EXISTS'
      ) {
        updateItem(id, (current) => ({
          ...current,
          status: 'retry',
          stage: '',
          retryAction: 'confirm',
          message:
            '系統找到這筆工作已有檔案，為避免遺失，沒有取消或移除。請先確認照片狀態。',
        }));
        return;
      }
      const retryable = isRecoverable(error);
      updateItem(id, (current) => ({
        ...current,
        status: retryable ? 'retry' : 'blocked',
        stage: '',
        retryAction: retryable ? 'cancel' : null,
        message: failureMessage(error),
      }));
    }
  }

  async function withOperationLock(work: () => Promise<void>) {
    if (!enterOperation()) return;
    try {
      await work();
    } finally {
      leaveOperation();
    }
  }

  async function startQueue() {
    await withOperationLock(async () => {
      setNotice('');
      const readyItems = itemsRef.current.filter(
        (item) => item.status === 'ready' || item.status === 'validating',
      );
      // Two independent confirmation lanes. All writes still use their original request IDs.
      const lanes = [Promise.resolve(), Promise.resolve()];
      const confirmations = new Set<Promise<void>>();
      let lane = 0;
      function enqueueConfirmation(work: () => Promise<void>) {
        const task = lanes[lane]!.then(work).finally(() =>
          confirmations.delete(task),
        );
        lanes[lane] = task;
        lane = 1 - lane;
        confirmations.add(task);
      }
      const pending = new Set<Promise<void>>();
      try {
        for (const item of readyItems) {
          if (pending.size >= MAX_PARALLEL_UPLOADS) await Promise.race(pending);
          while (confirmations.size >= 8) await Promise.race(confirmations);
          await waitForDispatch();
          if (
            !mountedRef.current ||
            item.generation !== generationRef.current ||
            journalIssueRef.current
          )
            return;
          if (item.status === 'validating') await prepareQueuedFile(item);
          if (
            !mountedRef.current ||
            item.generation !== generationRef.current ||
            journalIssueRef.current
          )
            return;
          const latest = itemsRef.current.find(
            (candidate) => candidate.id === item.id,
          );
          if (latest?.status !== 'ready') continue;
          if (!latest.started) {
            const journaledCount = () =>
              itemsRef.current.filter(
                (candidate) =>
                  candidate.started &&
                  candidate.initBody !== null &&
                  candidate.width !== null &&
                  candidate.height !== null &&
                  !['completed', 'cancelled', 'expired', 'rejected'].includes(
                    candidate.status,
                  ),
              ).length;
            if (pending.size && journaledCount() >= MAX_ACTIVE_JOURNAL_ITEMS)
              await Promise.all(pending);
            while (
              confirmations.size &&
              journaledCount() >= MAX_ACTIVE_JOURNAL_ITEMS
            )
              await Promise.race(confirmations);
            if (
              !mountedRef.current ||
              item.generation !== generationRef.current ||
              journalIssueRef.current
            )
              return;
            if (journaledCount() >= MAX_ACTIVE_JOURNAL_ITEMS) {
              setNotice(
                `已有 ${MAX_ACTIVE_JOURNAL_ITEMS} 筆未完成工作保留在續傳清單；請先完成或處理後，再開始其他照片。`,
              );
              break;
            }
          }
          setNotice('');
          const task = runUpload(item.id, latest, enqueueConfirmation)
            .then(() => {
              const outcome = itemsRef.current.find(
                (candidate) => candidate.id === item.id,
              );
              if (outcome?.status === 'retry') {
                slowDispatch(QUEUE_TRANSIENT_PAUSE_MS);
              }
            })
            .finally(() => pending.delete(task));
          pending.add(task);
        }
      } finally {
        await Promise.allSettled(pending);
        await Promise.all(lanes);
      }
    });
  }

  const recoverableRows = items.filter(
    (item) =>
      ['restore', 'upload', 'confirm'].includes(item.retryAction ?? '') &&
      !item.cancelBody,
  );
  const partialRecovery =
    !batchRef.current.length && recoverableRows.length > 0;
  async function recoverBatch() {
    let resumeQueue = false;
    await withOperationLock(async () => {
      let checked = 0;
      for (const row of recoverableRows) {
        if (
          !mountedRef.current ||
          row.generation !== generationRef.current ||
          journalIssueRef.current
        )
          return;
        setNotice(
          `正在核對上傳狀態（${++checked} / ${recoverableRows.length}）`,
        );
        const ready = await recoverItem(row.id, row);
        if (ready?.file && ready.image && !journalIssueRef.current)
          await runUpload(row.id, { ...ready, restored: false });
      }
      const remaining = recoverableRows.filter((row) =>
        itemsRef.current.some(
          (current) => current.id === row.id && current.status !== 'completed',
        ),
      ).length;
      setNotice(
        `已核對 ${checked} 張，${checked - remaining} 張已完成，${remaining} 張仍需處理。`,
      );
      if (!batchRef.current.length) setFolderPending(false);
      resumeQueue = itemsRef.current.some(
        (row) =>
          row.file && (row.status === 'ready' || row.status === 'validating'),
      );
    });
    if (resumeQueue) await startQueue();
  }

  async function retryItem(id: string) {
    await withOperationLock(async () => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item || !['retry', 'needs_file'].includes(item.status)) return;
      if (item.retryAction === 'restore') {
        await recoverItem(id, item);
      } else if (item.retryAction === 'status') {
        if (!(await reconcileAlreadyCompleted(id, item)))
          updateItem(id, (current) => ({
            ...current,
            message: '工作尚未結束，請稍後再確認狀態；未建立新的上傳工作。',
          }));
      } else if (item.retryAction === 'cancel') await cancelSession(id, item);
      else if (item.retryAction === 'confirm') await confirmOnly(id, item);
      else if (item.retryAction === 'upload') await runUpload(id, item);
    });
  }

  async function cancelItem(id: string) {
    await withOperationLock(async () => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item?.uploadSessionId) return;
      if (
        [
          'working',
          'completed',
          'cancelled',
          'expired',
          'needs_review',
        ].includes(item.status)
      )
        return;
      if (item.restored && !item.verified) {
        await recoverItem(id, item, 'cancel');
        const verified = itemsRef.current.find(
          (candidate) => candidate.id === id,
        );
        if (
          !verified?.verified ||
          !verified.uploadSessionId ||
          [
            'completed',
            'cancelled',
            'expired',
            'needs_review',
            'blocked',
          ].includes(verified.status)
        )
          return;
        await cancelSession(id, verified);
      } else await cancelSession(id, item);
    });
  }

  async function prepareQueuedFile(placeholder: QueueItem) {
    if (capability.status !== 'ready') return;
    try {
      updateItem(placeholder.id, (current) => ({
        ...current,
        stage: '檢查檔案大小、格式與尺寸…',
      }));
      const image = await prepareImage(placeholder.file!, {
        maxBrowserBytes: Math.min(
          capability.value.maxBrowserBytes,
          MAX_BROWSER_UPLOAD_BYTES,
        ),
        maxPixels: capability.value.maxPixels,
        maxDimension: capability.value.maxDimension,
      });
      if (
        placeholder.initBody &&
        (placeholder.initBody.sha256 !== image.sha256 ||
          placeholder.initBody.contentType !== image.contentType ||
          placeholder.width !== image.width ||
          placeholder.height !== image.height)
      ) {
        URL.revokeObjectURL(image.previewUrl);
        throw new ImagePreparationError('原檔內容不符，請重新選擇原資料夾。');
      }
      const initBody: InitUploadBody = placeholder.initBody ?? {
        workspaceId,
        projectId,
        albumId,
        originalFilename: placeholder.filename.trim(),
        expectedBytes: placeholder.byteSize,
        contentType: image.contentType,
        sha256: image.sha256,
        requestId: crypto.randomUUID(),
      };
      if (
        !mountedRef.current ||
        placeholder.generation !== generationRef.current
      ) {
        URL.revokeObjectURL(image.previewUrl);
        return;
      }
      updateItem(placeholder.id, (current) => ({
        ...current,
        status: 'ready',
        stage: '',
        message: '',
        previewUrl: image.previewUrl,
        image,
        width: image.width,
        height: image.height,
        initBody,
      }));
    } catch (error) {
      updateItem(placeholder.id, (current) => ({
        ...current,
        status: placeholder.started ? 'needs_file' : 'rejected',
        stage: '',
        message:
          error instanceof ImagePreparationError
            ? error.message
            : '無法檢查這個檔案，請確認內容完整後再加入。',
      }));
    }
  }

  async function selectFiles(
    readFiles: () =>
      | { files: File[]; folder: boolean }
      | Promise<{ files: File[]; folder: boolean }>,
  ) {
    if (selectionLockRef.current || operationLockRef.current) return;
    if (capability.status !== 'ready' || !capability.value.enabled) return;
    if (!journalReady || journalIssueRef.current) return;

    selectionLockRef.current = true;
    setSelecting(true);
    setNotice('');
    try {
      deliveries.current = [];
      setTiming({
        started: performance.now(),
        elapsed: 0,
      });
      const generation = generationRef.current;
      const { files, folder } = await readFiles();
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (!files.length) {
        setNotice('沒有可加入的檔案。');
        return;
      }
      const scope = journalScopeRef.current;
      if (!scope) return;
      if (partialRecovery) {
        const matches = new Map<string, File>();
        for (const file of files) {
          const candidates = recoverableRows.filter(
            (row) =>
              row.filename.trim() === file.name.trim() &&
              row.byteSize === file.size,
          );
          if (!candidates.length) continue;
          const hash = await sha256(file);
          for (const row of candidates)
            if (row.initBody?.sha256 === hash) matches.set(row.id, file);
        }
        if (!mountedRef.current || generation !== generationRef.current) return;
        if (!matches.size) {
          setNotice('所選照片與待恢復的記錄不符。');
          return;
        }
        commitItems(
          itemsRef.current.map((row) =>
            matches.has(row.id)
              ? {
                  ...row,
                  file: matches.get(row.id)!,
                  status: 'validating',
                  stage: '等候核對',
                }
              : row,
          ),
        );
      } else if (folderPending && batchRef.current.length) {
        const entries = batchRef.current;
        const chosen = new Map(
          files.map((file) => [folderFileKey(file), file]),
        );
        if (
          entries.some(
            (entry) => entry.state !== 'skipped' && !chosen.has(entry.key),
          )
        ) {
          setNotice('所選檔案與原批次不符，請重選原本的整批照片或資料夾。');
          return;
        }
        setNotice('正在核對原批次與已入庫照片…');
        for (const entry of entries) {
          if (entry.state === 'skipped') continue;
          const file = chosen.get(entry.key)!;
          if (entry.sha256 && (await sha256(file)) !== entry.sha256) {
            setNotice('重選的照片內容與原批次不符，未開始續傳。');
            return;
          }
          if (!mountedRef.current || generation !== generationRef.current)
            return;
        }
        const pending = new Map(
          entries
            .filter((entry) => entry.state === 'pending')
            .map((entry) => [entry.id, chosen.get(entry.key)!]),
        );
        commitItems(
          itemsRef.current.map((item) => {
            const file = pending.get(item.id);
            return file
              ? { ...item, file, status: 'validating', stage: '等候處理' }
              : item;
          }),
        );
        setFolderPending(false);
      } else {
        if (batchRef.current.some((entry) => entry.state === 'pending')) {
          setNotice('目前仍有一批資料夾照片待完成，請先繼續這批上傳。');
          return;
        }
        setPartialHistory(false);
        const placeholders = files.map((file) =>
          queuedPhoto(
            crypto.randomUUID(),
            file.name,
            file.size,
            generation,
            file,
          ),
        );
        if (folder || files.length > 1) {
          const batch = placeholders.map((item): BatchFile => ({
            id: item.id,
            key: folderFileKey(item.file!),
            name: item.filename,
            bytes: item.byteSize,
            sha256: null,
            state: 'pending',
          }));
          if (new Set(batch.map((entry) => entry.key)).size !== batch.length) {
            setNotice('有重複的照片路徑，請一次選取一個資料夾。');
            return;
          }
          saveFolderBatch(scope, batch);
        }
        commitItems([...itemsRef.current, ...placeholders]);
      }

      await startQueue();
    } catch {
      setNotice('無法加入照片，請重新選擇檔案或資料夾。');
    } finally {
      selectionLockRef.current = false;
      if (mountedRef.current) setSelecting(false);
    }
  }

  const completedCount = items.filter(
    (item) => item.status === 'completed',
  ).length;
  const totalCount = items.length;
  const transferring = items.filter(
    (i) => i.status === 'working' && i.stage === '直接上傳原始照片…',
  ).length;
  const confirming = items.filter(
    (i) => i.received && ['working', 'needs_file'].includes(i.status),
  ).length;
  const retrying = items.filter((i) => i.status === 'retry').length;
  const needsFile = items.filter(
    (i) => i.status === 'needs_file' && !i.received,
  ).length;
  const onlyConfirming =
    confirming > 0 &&
    items.every((i) => i.status === 'completed' || i.received);
  const breakdown = `傳輸中 ${transferring} · 原圖已收到待入庫 ${confirming} · 等待重試 ${retrying} · 待選原檔 ${needsFile}`;
  const remainingBytes = items.reduce(
    (sum, item) =>
      !item.received && ['validating', 'ready', 'working'].includes(item.status)
        ? sum + item.byteSize
        : sum,
    0,
  );
  const waitingForConnection = items.some(
    (item) => item.stage === '等待網路恢復…',
  );
  const now = timing.started + timing.elapsed;
  const windowBytes = deliveries.current.reduce(
    (sum, entry) => sum + (entry.at >= now - 10000 ? entry.bytes : 0),
    0,
  );
  const batchRate =
    busy && !waitingForConnection && timing.elapsed > 0
      ? (windowBytes * 1000) / Math.min(10000, timing.elapsed)
      : undefined;
  useEffect(() => {
    onUploadProgress?.(
      totalCount || busy || selecting
        ? {
            active: busy || selecting,
            done: partialHistory ? null : completedCount,
            elapsedSeconds: timing.started
              ? Math.floor(timing.elapsed / 1000)
              : undefined,
            breakdown,
            bytesPerSecond: batchRate,
            remainingSeconds:
              batchRate && remainingBytes > 0
                ? Math.ceil(remainingBytes / batchRate)
                : undefined,
            total: totalCount,
            label: waitingForConnection
              ? '等待網路恢復…'
              : busy
                ? onlyConfirming
                  ? '正在確認入庫'
                  : '上傳中'
                : selecting
                  ? '正在加入照片…'
                  : partialHistory
                    ? `舊上傳記錄 · 已確認 ${completedCount} 張（原批次總數未知）`
                    : completedCount === totalCount
                      ? '上傳完成'
                      : folderPending
                        ? '等待重選原檔'
                        : recoverableRows.length
                          ? `等待批量恢復（${recoverableRows.length} 張待核對）`
                          : journalIssue
                            ? '續傳記錄異常，已暫停'
                            : '上傳已暫停，請查看佇列',
          }
        : null,
    );
  }, [
    onUploadProgress,
    completedCount,
    totalCount,
    busy,
    selecting,
    timing,
    breakdown,
    onlyConfirming,
    remainingBytes,
    batchRate,
    waitingForConnection,
    folderPending,
    partialHistory,
    recoverableRows.length,
    journalIssue,
  ]);

  function removeItem(id: string) {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (
      !item ||
      !['ready', 'rejected', 'completed', 'cancelled', 'expired'].includes(
        item.status,
      )
    )
      return;
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    commitItems(itemsRef.current.filter((candidate) => candidate.id !== id));
  }

  if (
    capability.status === 'loading' ||
    (!journalReady &&
      !journalIssue &&
      capability.status === 'ready' &&
      capability.value.enabled)
  )
    return (
      <section
        className="mt-8 border-t border-stone-200 pt-6"
        aria-live="polite"
      >
        <h2 className="text-lg font-semibold">上傳照片</h2>
        <p className="mt-3 text-sm text-stone-600">正在確認此相簿的上傳功能…</p>
      </section>
    );

  if (capability.status === 'unavailable')
    return (
      <section className="mt-8 border-t border-stone-200 pt-6">
        <h2 className="text-lg font-semibold">上傳照片</h2>
        <p role="status" className="mt-3 text-sm text-amber-900">
          {capability.message}
        </p>
      </section>
    );

  if (!capability.value.enabled)
    return (
      <section className="mt-8 border-t border-stone-200 pt-6">
        <h2 className="text-lg font-semibold">上傳照片</h2>
        <p className="mt-3 text-sm text-stone-600">
          此環境目前尚未開放瀏覽器上傳照片。
        </p>
      </section>
    );

  const readyCount = items.filter(
    (item) => item.status === 'ready' || item.status === 'validating',
  ).length;
  const maxFileSizeMB =
    Math.min(capability.value.maxBrowserBytes, MAX_BROWSER_UPLOAD_BYTES) /
    1_000_000;
  const maxFileSizeLabel = Number.isInteger(maxFileSizeMB)
    ? String(maxFileSizeMB)
    : maxFileSizeMB.toFixed(1);

  return (
    <section
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const transfer = event.dataTransfer;
        void selectFiles(() => readDroppedFiles(transfer));
      }}
      aria-labelledby={titleId}
      className="mt-8 border-t border-stone-200 pt-6"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        上傳照片
      </h2>
      <p className="mt-2 text-sm text-stone-600">
        拖入照片或資料夾，或點「選擇照片」。支援 JPEG、PNG、WebP，每張最多約{' '}
        {maxFileSizeLabel} MB。 照片最多同時上傳 {MAX_PARALLEL_UPLOADS}{' '}
        張，請保留此分頁。
      </p>
      {journalIssue && (
        <div role="alert" className="mt-3 text-sm text-amber-900">
          <p>{journalIssue}</p>
          {hasJournalLock && (
            <button
              type="button"
              onClick={clearLocalJournal}
              disabled={busy || selecting}
              className="mt-2 rounded border px-3 py-2"
            >
              清除此相簿的本機續傳記錄
            </button>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
          {partialRecovery || folderPending ? '重選原照片並續傳' : '選擇照片'}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            aria-label="選擇照片"
            disabled={busy || selecting || !!journalIssue || !journalReady}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void selectFiles(() => ({ files, folder: false }));
            }}
          />
        </label>
        <label className="inline-flex cursor-pointer items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium has-[:disabled]:opacity-50">
          {folderPending ? '重選原資料夾並續傳' : '選擇資料夾'}
          <input
            type="file"
            multiple
            className="sr-only"
            {...{ webkitdirectory: '' }}
            aria-label={folderPending ? '重選原資料夾並續傳' : '選擇資料夾'}
            disabled={busy || selecting || !!journalIssue || !journalReady}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void selectFiles(() => ({ files, folder: true }));
            }}
          />
        </label>
        {recoverableRows.length > 0 && (
          <button
            type="button"
            disabled={busy || selecting || !!journalIssue || !journalReady}
            onClick={() => void recoverBatch()}
            className="rounded-md border px-4 py-2"
          >
            批量恢復上傳狀態（{recoverableRows.length} 張）
          </button>
        )}
        {partialHistory && (
          <p>
            目前顯示此分頁可恢復的記錄，原批次總數未知。重選檔案只會接續相符的工作。
          </p>
        )}
        <button
          type="button"
          disabled={
            busy ||
            selecting ||
            readyCount === 0 ||
            !!journalIssue ||
            !journalReady
          }
          onClick={() => void startQueue()}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '處理中…' : '開始上傳'}
        </button>
        {readyCount > 0 && (
          <span className="text-sm text-stone-500">排隊中 {readyCount} 張</span>
        )}
        <span className="text-sm text-stone-500">
          {items.length} 張在清單中
        </span>
      </div>
      {notice && (
        <p role="status" className="mt-3 text-sm text-amber-900">
          {notice}
        </p>
      )}
      {hasUnfinishedServerWork && (
        <p role="status" className="mt-3 text-sm text-amber-900">
          已開始的未完成上傳可在同一帳號與相簿恢復；需要重傳時請重新選擇原檔。
        </p>
      )}
      {hasUnstartedLocalQueue && (
        <p role="status" className="mt-3 text-sm text-amber-900">
          {batchRef.current.length
            ? '重新開啟後可重選原照片或資料夾續傳。'
            : '重新載入或離開此頁後，尚未開始的照片需重新選取。'}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-5 rounded-md bg-white p-4 text-sm text-stone-500">
          選取照片後，會先檢查檔案並建立僅供本機查看的小型預覽。
        </p>
      ) : (
        <ul className="mt-5 space-y-3" aria-label="照片上傳佇列">
          {items.map((item) => (
            <li
              key={item.id}
              data-testid="upload-item"
              aria-label={item.filename}
              className="flex min-w-0 flex-col gap-3 rounded-lg border border-stone-200 bg-white p-4 sm:flex-row sm:items-center"
            >
              {item.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt={`本機預覽：${item.filename}`}
                  width={80}
                  height={80}
                  className="h-20 w-20 shrink-0 rounded object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-20 w-20 shrink-0 rounded bg-stone-100"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="break-all font-medium">
                  {photoDisplayName(item.filename)}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {formatBytes(item.byteSize)}
                  {item.image
                    ? ` · ${item.image.width} × ${item.image.height}`
                    : ''}
                </p>
                <p
                  className={`mt-2 text-sm ${
                    item.status === 'completed'
                      ? 'text-green-800'
                      : item.status === 'needs_review' ||
                          item.status === 'blocked' ||
                          item.status === 'rejected'
                        ? 'text-amber-900'
                        : 'text-stone-600'
                  }`}
                  role={
                    item.status === 'blocked' ||
                    item.status === 'needs_review' ||
                    item.status === 'rejected'
                      ? 'alert'
                      : undefined
                  }
                >
                  <span className="font-medium">
                    {statusLabel(item.status)}
                  </span>
                  {item.stage ? ` · ${item.stage}` : ''}
                  {item.message ? ` · ${item.message}` : ''}
                </p>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                {item.restored &&
                  !item.cancelBody &&
                  ['retry', 'needs_file', 'ready'].includes(item.status) && (
                    <label className="rounded-md border border-stone-300 px-3 py-2 text-sm">
                      重新選擇原檔
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        aria-label={`重新選擇 ${item.filename}`}
                        className="sr-only"
                        disabled={busy || !!journalIssue}
                        onChange={(event) => void reselectFile(item.id, event)}
                      />
                    </label>
                  )}
                {['retry', 'needs_file'].includes(item.status) &&
                  item.retryAction && (
                    <button
                      type="button"
                      disabled={busy || !!journalIssue}
                      aria-label={
                        item.retryAction === 'upload'
                          ? `重試 ${item.filename}`
                          : item.retryAction === 'cancel'
                            ? `重試取消 ${item.filename}`
                            : `確認 ${item.filename}`
                      }
                      onClick={() => void retryItem(item.id)}
                      className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {item.retryAction === 'cancel'
                        ? '重新嘗試取消'
                        : item.retryAction === 'confirm' ||
                            item.retryAction === 'status'
                          ? '確認照片狀態'
                          : item.retryAction === 'restore'
                            ? '確認續傳狀態'
                            : '重試上傳'}
                    </button>
                  )}
                {item.uploadSessionId &&
                  ![
                    'working',
                    'completed',
                    'cancelled',
                    'expired',
                    'needs_review',
                  ].includes(item.status) && (
                    <button
                      type="button"
                      disabled={busy || !!journalIssue}
                      aria-label={`取消 ${item.filename}`}
                      onClick={() => void cancelItem(item.id)}
                      className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      取消未完成上傳
                    </button>
                  )}
                {[
                  'ready',
                  'rejected',
                  'completed',
                  'cancelled',
                  'expired',
                ].includes(item.status) && (
                  <button
                    type="button"
                    disabled={busy || selecting}
                    onClick={() => removeItem(item.id)}
                    className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    從清單移除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
