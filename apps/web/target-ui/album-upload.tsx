'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  ImagePreparationError,
  MAX_BROWSER_UPLOAD_BYTES,
  prepareImage,
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

const MAX_QUEUE_ITEMS = 20;
// Pause between items after a transient failure (covers D1's 10s window),
// and stop the run after this many consecutive transient failures.
const QUEUE_TRANSIENT_PAUSE_MS = 10_000;
const QUEUE_TRANSIENT_FAILURE_LIMIT = 3;

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
  file: File | null;
  filename: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  restored: boolean;
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

type CapabilityState =
  | { status: 'loading' }
  | { status: 'unavailable'; message: string }
  | { status: 'ready'; value: UploadCapabilities };

type AlbumUploadProps = {
  workspaceId: string;
  projectId: string;
  albumId: string;
  onCompleted?: () => void;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024)
    return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
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
      return '此工作區使用 Cloudflare 縮圖，每張照片最多 16 MiB。請選擇較小的照片。';
    case 'STORAGE_QUOTA_EXCEEDED':
      return '目前可用空間不足，這張照片尚未完成上傳。';
    case 'UPLOAD_SESSION_EXPIRED':
      return '這筆上傳工作已逾期，照片未標示完成。系統不會自動建立新工作，請保留記錄並聯絡管理者處理。';
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
      return '目前無法完成這筆照片上傳，請保留記錄並稍後重試。';
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
    (error instanceof DOMException && error.name === 'AbortError')
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
}: AlbumUploadProps) {
  const [capability, setCapability] = useState<CapabilityState>({
    status: 'loading',
  });
  const [items, setItemsState] = useState<QueueItem[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [journalReady, setJournalReady] = useState(false);
  const [journalIssue, setJournalIssue] = useState('');
  const [hasJournalLock, setHasJournalLock] = useState(false);
  const journalScopeRef = useRef<UploadJournalScope | null>(null);
  const journalIssueRef = useRef(false);
  const generationRef = useRef(0);
  const releaseJournalRef = useRef<(() => void) | null>(null);
  const titleId = useId();
  const itemsRef = useRef<QueueItem[]>([]);
  const mountedRef = useRef(false);
  const operationLockRef = useRef(false);
  const selectionLockRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    journalScopeRef.current = null;
    journalIssueRef.current = false;
    const controller = new AbortController();
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
              localStorage.setItem(key, raw ?? encodeUploadJournal(scope, []));
              const restored: QueueItem[] = saved.map((entry) => ({
                ...entry,
                file: null,
                filename: entry.initBody.originalFilename,
                byteSize: entry.initBody.expectedBytes,
                restored: true,
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
              itemsRef.current = restored;
              setItemsState(restored);
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
      item.status === 'needs_file' ||
      item.status === 'working' ||
      item.status === 'retry' ||
      item.status === 'needs_review' ||
      (item.status === 'blocked' && item.uploadSessionId !== null),
  );

  useEffect(() => {
    if (!hasUnfinishedServerWork) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasUnfinishedServerWork]);

  function commitItems(next: QueueItem[]) {
    itemsRef.current = next;
    const scope = journalScopeRef.current;
    if (scope && mountedRef.current && !journalIssueRef.current) {
      try {
        const entries: UploadJournalItem[] = [];
        for (const item of next) {
          if (
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
      } catch {
        journalIssueRef.current = true;
        setJournalIssue(
          '無法保存續傳資訊，已停止後續上傳請求。請保留目前畫面，待瀏覽器儲存恢復後重新載入。',
        );
      }
    }
    if (mountedRef.current) setItemsState(next);
  }
  async function ensureJournalIdentity(item: QueueItem) {
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
    if ((await getUploadOwner()) !== scope.actorId) {
      for (const item of itemsRef.current) item.authorization = null;
      journalIssueRef.current = true;
      setJournalIssue('登入帳號已變更，已停止上傳；請重新載入後使用目前帳號。');
      throw new UploadProtocolError(false);
    }
    if (
      !mountedRef.current ||
      journalIssueRef.current ||
      item.generation !== generationRef.current
    )
      throw new UploadProtocolError(false);
    return scope.actorId;
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
    operationLockRef.current = false;
    setBusyState(false);
  }

  function finishCompleted(id: string, item: QueueItem) {
    updateItem(id, (current) => ({
      ...current,
      status: 'completed',
      stage: '',
      retryAction: null,
      message: `照片已完成上傳（${item.width ?? 0} × ${item.height ?? 0}）。`,
    }));
    if (mountedRef.current) {
      try {
        onCompleted?.();
      } catch {
        // A refresh callback must not turn a confirmed server completion into a failed upload.
      }
    }
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
    const expectedActorId = await ensureJournalIdentity(item);
    const completion = await completeUpload(
      item.uploadSessionId,
      item.completeBody,
      expectedActorId,
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
  async function runUpload(id: string, startingItem: QueueItem) {
    let item = startingItem;
    if (item.restored) {
      const recovered = await recoverItem(id, item);
      if (!recovered) return;
      item = recovered;
    }
    if (!item.file || !item.image) return;
    updateItem(id, (current) => ({
      ...current,
      status: 'working',
      stage: '準備上傳工作…',
      message: '',
      retryAction: null,
    }));

    try {
      if (!item.initBody) throw new UploadProtocolError();

      if (!item.uploadSessionId) {
        updateItem(id, (current) => ({
          ...current,
          stage: '建立上傳工作…',
        }));
        const expectedActorId = await ensureJournalIdentity(item);
        const session = await reserveUpload(item.initBody, expectedActorId);
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
        const expectedActorId = await ensureJournalIdentity(item);
        const authorization = await authorizeUpload(
          item.uploadSessionId,
          authorizeBody,
          expectedActorId,
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

      updateItem(id, (current) => ({
        ...current,
        stage: '先確認這筆照片是否已完整收到…',
      }));
      try {
        await confirmServerCompletion(id, item);
        return;
      } catch (error) {
        if (
          !(error instanceof UploadRequestError) ||
          error.status !== 409 ||
          error.code !== 'UPLOAD_OBJECT_NOT_FOUND'
        ) {
          if (
            error instanceof UploadRequestError &&
            error.code === 'UPLOAD_ALREADY_COMPLETED' &&
            (await reconcileAlreadyCompleted(id, item))
          )
            return;
          throw error;
        }
      }

      updateItem(id, (current) => ({
        ...current,
        stage: '直接上傳原始照片…',
      }));
      await ensureJournalIdentity(item);
      await putUploadFile(
        item.file!,
        item.image?.contentType ?? '',
        item.authorization,
      );

      updateItem(id, (current) => ({
        ...current,
        stage: '確認照片完整性…',
      }));
      try {
        await confirmServerCompletion(id, item);
      } catch (error) {
        if (
          error instanceof UploadRequestError &&
          error.code === 'UPLOAD_ALREADY_COMPLETED' &&
          (await reconcileAlreadyCompleted(id, item))
        )
          return;
        throw error;
      }
    } catch (error) {
      if (
        error instanceof UploadRequestError &&
        (error.code === 'UPLOAD_CONTENT_INVALID' ||
          error.code === 'UPLOAD_NEEDS_REVIEW')
      ) {
        finishNeedsReview(id);
        return;
      }
      const directResponse = error instanceof DirectUploadResponseError;
      const retryable = isRecoverable(error) || directResponse;
      updateItem(id, (current) => ({
        ...current,
        status: retryable ? 'retry' : 'blocked',
        stage: '',
        retryAction: retryable
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
      const readyItems = itemsRef.current.filter(
        (item) => item.status === 'ready',
      );
      // A transient failure (typically D1's 10-second resource window) would
      // otherwise cascade into every following item. Pause past the window,
      // and stop after repeated failures so the rest stay ready to restart.
      let transientFailures = 0;
      for (const item of readyItems) {
        if (!mountedRef.current) break;
        const latest = itemsRef.current.find(
          (candidate) => candidate.id === item.id,
        );
        if (latest?.status !== 'ready') continue;
        await runUpload(item.id, latest);
        const outcome = itemsRef.current.find(
          (candidate) => candidate.id === item.id,
        );
        if (outcome?.status !== 'retry') {
          transientFailures = 0;
          continue;
        }
        transientFailures += 1;
        if (transientFailures >= QUEUE_TRANSIENT_FAILURE_LIMIT) break;
        const remaining = readyItems
          .slice(readyItems.indexOf(item) + 1)
          .some(
            (next) =>
              itemsRef.current.find((candidate) => candidate.id === next.id)
                ?.status === 'ready',
          );
        // Never hold the operation lock after the last item: the Owner's
        // retry action must stay immediately available.
        if (!remaining) break;
        await new Promise((resolve) =>
          window.setTimeout(resolve, QUEUE_TRANSIENT_PAUSE_MS),
        );
      }
    });
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

  async function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || selectionLockRef.current) return;
    if (capability.status !== 'ready' || !capability.value.enabled) return;
    if (!journalReady || journalIssueRef.current) return;

    selectionLockRef.current = true;
    setSelecting(true);
    setNotice('');
    try {
      const available = Math.max(0, MAX_QUEUE_ITEMS - itemsRef.current.length);
      const accepted = files.slice(0, available);
      if (accepted.length < files.length)
        setNotice('一次最多保留 20 張照片在清單中；已加入可容納的檔案。');
      if (!accepted.length) return;

      const placeholders: QueueItem[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        byteSize: file.size,
        width: null,
        height: null,
        restored: false,
        verified: true,
        generation: generationRef.current,
        status: 'validating',
        message: '',
        stage: '檢查檔案大小、格式與尺寸…',
        previewUrl: null,
        image: null,
        initBody: null,
        uploadSessionId: null,
        authorizeBody: null,
        authorization: null,
        completeBody: null,
        cancelBody: null,
        retryAction: null,
      }));
      commitItems([...itemsRef.current, ...placeholders]);

      for (const placeholder of placeholders) {
        try {
          const image = await prepareImage(placeholder.file!, {
            maxBrowserBytes: Math.min(
              capability.value.maxBrowserBytes,
              MAX_BROWSER_UPLOAD_BYTES,
            ),
            maxPixels: capability.value.maxPixels,
            maxDimension: capability.value.maxDimension,
          });
          const initBody: InitUploadBody = {
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
            break;
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
            status: 'rejected',
            stage: '',
            message:
              error instanceof ImagePreparationError
                ? error.message
                : '無法檢查這個檔案，請確認內容完整後再加入。',
          }));
        }
      }
    } finally {
      selectionLockRef.current = false;
      if (mountedRef.current) setSelecting(false);
    }
  }

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

  const readyCount = items.filter((item) => item.status === 'ready').length;
  const canAdd = items.length < MAX_QUEUE_ITEMS;
  const maxFileSizeMiB =
    Math.min(capability.value.maxBrowserBytes, MAX_BROWSER_UPLOAD_BYTES) /
    (1024 * 1024);
  const maxFileSizeLabel = Number.isInteger(maxFileSizeMiB)
    ? String(maxFileSizeMiB)
    : maxFileSizeMiB.toFixed(1);

  return (
    <section
      aria-labelledby={titleId}
      className="mt-8 border-t border-stone-200 pt-6"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        上傳照片
      </h2>
      <p className="mt-2 text-sm text-stone-600">
        可一次選取最多 20 張 JPEG、PNG 或 WebP；每張最多 {maxFileSizeLabel}
        MiB。照片會依序上傳。預覽只暫存在目前瀏覽器，不會另存為相簿縮圖。
      </p>
      <p className="mt-2 text-xs text-stone-600">
        續傳記錄包含檔名、大小、雜湊與操作編號；最後更新後 7
        天內可恢復，過期需手動清除。不保存照片內容、預覽或上傳網址，需使用相同帳號與相簿恢復。
      </p>
      <p className="mt-2 text-xs text-stone-600">
        恢復工作資訊不會延長上傳授權；授權逾期且尚未收到照片時，需先確認或取消原工作，再建立新工作。
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
          選擇照片
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            aria-label="選擇照片"
            disabled={
              !canAdd || busy || selecting || !!journalIssue || !journalReady
            }
            onChange={(event) => void selectFiles(event)}
          />
        </label>
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
          <span className="text-sm text-stone-500">已準備 {readyCount} 張</span>
        )}
        <span className="text-sm text-stone-500">
          {items.length} / {MAX_QUEUE_ITEMS} 張
        </span>
      </div>
      {notice && (
        <p role="status" className="mt-3 text-sm text-amber-900">
          {notice}
        </p>
      )}
      {hasUnfinishedServerWork && (
        <p role="status" className="mt-3 text-sm text-amber-900">
          目前有尚未完成的上傳工作。離開或重新載入後可在同一帳號與相簿恢復工作；需要傳送照片時，請重新選擇原檔並驗證。
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
                <p className="break-all font-medium">{item.filename}</p>
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
              <div className="flex shrink-0 flex-wrap gap-2">
                {item.restored && !item.cancelBody && (
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
