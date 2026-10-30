'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  ownerPhotoVersionsPageSchema,
  photoVersionsCapabilitiesSchema,
  setCurrentPhotoVersionResultSchema,
  setCurrentPhotoVersionSchema,
  type OwnerPhotoVersionsPage,
  type PhotoVersionItem,
} from '../../../packages/contracts/src/photo-versions';
import { VersionUploadPanel } from './version-upload';

const versionUploadContextSchema = z
  .object({
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    versioningMode: z.enum(['off', 'manual', 'auto_filename', 'assisted']),
  })
  .strict();

export type PhotoVersionUploadContext = z.infer<
  typeof versionUploadContextSchema
>;

type SwitchIntent = {
  photoId: string;
  requestId: string;
  body: string;
  versionNo: number;
  versionId: string;
  expectedCurrentVersionId: string;
  expectedRevision: number;
  ambiguous: boolean;
};
type Reconciliation = { notifyGallery: boolean };
type ReadState =
  | { status: 'loading'; photoId: string; sequence: number }
  | { status: 'disabled'; photoId: string; sequence: number }
  | {
      status: 'error';
      photoId: string;
      sequence: number;
      message: string;
    }
  | {
      status: 'ready';
      photoId: string;
      sequence: number;
      page: OwnerPhotoVersionsPage;
      versions: PhotoVersionItem[];
      moreError: string;
      loadingMore: boolean;
    };

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function errorCode(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return '';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}

async function requestJson<T>(
  url: string,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError('Request failed', response.status, errorCode(body));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data === undefined) {
    throw new ApiError('Response could not be verified', response.status, '');
  }
  return parsed.data;
}

async function fetchFirstPage(
  photoId: string,
  signal: AbortSignal,
): Promise<
  { kind: 'disabled' } | { kind: 'enabled'; page: OwnerPhotoVersionsPage }
> {
  const capability = await requestJson(
    '/api/v1/photo-versions/capabilities',
    photoVersionsCapabilitiesSchema,
    { signal },
  );
  if (!capability.enabled) return { kind: 'disabled' };

  const page = await requestJson(
    `/api/v1/photos/${encodeURIComponent(photoId)}/versions`,
    ownerPhotoVersionsPageSchema,
    { signal },
  );
  if (page.photoId !== photoId) {
    throw new ApiError('Response photo did not match', 200, '');
  }
  return { kind: 'enabled', page };
}

function loadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return '登入已失效或目前帳號沒有管理權限，請重新登入後再載入。';
    }
    if (error.status === 503) {
      return '版本管理目前暫時無法連線，請稍後重試。';
    }
  }
  return '目前無法載入版本紀錄，請稍後重試。';
}

function processingLabel(value: PhotoVersionItem['processing']): string {
  switch (value) {
    case 'queued':
      return '排隊處理中';
    case 'running':
      return '處理中';
    case 'retryable':
      return '等待重試';
    case 'needs_review':
      return '等待檢查';
    case 'abandoned':
      return '已停止處理';
    case 'succeeded':
      return '處理完成';
    case 'unsupported':
      return '格式暫不支援';
    case 'unavailable':
      return '目前無法使用';
  }
}

function isSwitchable(
  version: PhotoVersionItem,
  currentVersionId: string,
): boolean {
  return (
    version.id !== currentVersionId &&
    version.processing === 'succeeded' &&
    version.thumbnailUrl !== null &&
    version.previewUrl !== null
  );
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function addUnresolvedBeforeUnload() {
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}

export type PhotoVersionsPanelProps = {
  photoId: string;
  onCurrentChanged?: () => void;
  onPendingChange?: (pending: boolean) => void;
  uploadContext?: PhotoVersionUploadContext;
};

export function PhotoVersionsPanel({
  photoId,
  onCurrentChanged,
  onPendingChange,
  uploadContext,
}: PhotoVersionsPanelProps) {
  const [read, setRead] = useState<ReadState | null>(null);
  const [intent, setIntent] = useState<SwitchIntent | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmVersionId, setConfirmVersionId] = useState<string | null>(null);
  const [intentMessage, setIntentMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);

  const readSequenceRef = useRef(0);
  const readAbortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);
  const moreInFlightRef = useRef(false);
  const intentRef = useRef<SwitchIntent | null>(null);
  const inFlightRef = useRef(false);
  const reconciliationRef = useRef<Reconciliation | null>(null);
  const switchPendingRef = useRef(false);
  const uploadPendingRef = useRef(false);
  const parentPendingRef = useRef(false);
  const onCurrentChangedRef = useRef(onCurrentChanged);
  const onPendingChangeRef = useRef(onPendingChange);

  useEffect(() => {
    onCurrentChangedRef.current = onCurrentChanged;
    onPendingChangeRef.current = onPendingChange;
  }, [onCurrentChanged, onPendingChange]);

  const reportParentPending = useCallback(() => {
    const pending = switchPendingRef.current || uploadPendingRef.current;
    if (parentPendingRef.current === pending) return;
    parentPendingRef.current = pending;
    onPendingChangeRef.current?.(pending);
  }, []);

  const reportPending = useCallback(
    (pending: boolean) => {
      switchPendingRef.current = pending;
      reportParentPending();
    },
    [reportParentPending],
  );

  const reportUploadPending = useCallback(
    (pending: boolean) => {
      uploadPendingRef.current = pending;
      setUploadPending(pending);
      reportParentPending();
    },
    [reportParentPending],
  );

  const startRefresh = useCallback(() => {
    if (uploadPendingRef.current) return;
    readAbortRef.current?.abort();
    moreAbortRef.current?.abort();
    moreAbortRef.current = null;
    moreInFlightRef.current = false;

    const sequence = ++readSequenceRef.current;
    const controller = new AbortController();
    readAbortRef.current = controller;
    setRead({ status: 'loading', photoId, sequence });

    void fetchFirstPage(photoId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || readSequenceRef.current !== sequence)
          return;
        if (result.kind === 'disabled') {
          if (reconciliationRef.current) {
            setRead({
              status: 'error',
              photoId,
              sequence,
              message:
                '操作已收到確認，但目前無法重新讀取目前版本。請重試載入以核對結果。',
            });
          } else {
            setRead({ status: 'disabled', photoId, sequence });
          }
          return;
        }

        setRead({
          status: 'ready',
          photoId,
          sequence,
          page: result.page,
          versions: result.page.versions,
          moreError: '',
          loadingMore: false,
        });

        const reconciliation = reconciliationRef.current;
        if (reconciliation) {
          reconciliationRef.current = null;
          setReconciling(false);
          reportPending(false);
          if (reconciliation.notifyGallery) {
            onCurrentChangedRef.current?.();
          }
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || readSequenceRef.current !== sequence)
          return;
        setRead({
          status: 'error',
          photoId,
          sequence,
          message: loadErrorMessage(error),
        });
      })
      .finally(() => {
        if (readAbortRef.current === controller) readAbortRef.current = null;
      });

    return () => controller.abort();
  }, [photoId, reportPending]);

  useEffect(() => {
    const cancel = startRefresh();
    return () => {
      cancel?.();
      readAbortRef.current?.abort();
      moreAbortRef.current?.abort();
    };
  }, [startRefresh]);

  useEffect(() => {
    if (!intent && !reconciling) return;
    return addUnresolvedBeforeUnload();
  }, [intent, reconciling]);

  useEffect(() => {
    if (!confirmVersionId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setConfirmVersionId(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [confirmVersionId]);

  const activeRead = read?.photoId === photoId ? read : null;

  const failRead = useCallback(
    (message: string) => {
      readAbortRef.current?.abort();
      moreAbortRef.current?.abort();
      moreAbortRef.current = null;
      moreInFlightRef.current = false;
      const sequence = ++readSequenceRef.current;
      setRead({ status: 'error', photoId, sequence, message });
    },
    [photoId],
  );

  const loadMore = useCallback(async () => {
    const current = read;
    if (
      !current ||
      current.status !== 'ready' ||
      current.photoId !== photoId ||
      !current.page.nextCursor ||
      moreInFlightRef.current ||
      uploadPendingRef.current ||
      intentRef.current ||
      reconciliationRef.current
    )
      return;

    const cursor = current.page.nextCursor;
    const sequence = current.sequence;
    const controller = new AbortController();
    moreAbortRef.current?.abort();
    moreAbortRef.current = controller;
    moreInFlightRef.current = true;
    setRead((previous) =>
      previous?.status === 'ready' && previous.sequence === sequence
        ? { ...previous, loadingMore: true, moreError: '' }
        : previous,
    );

    try {
      const capability = await requestJson(
        '/api/v1/photo-versions/capabilities',
        photoVersionsCapabilitiesSchema,
        { signal: controller.signal },
      );
      if (!capability.enabled) {
        setRead({ status: 'disabled', photoId, sequence });
        return;
      }
      const page = await requestJson(
        `/api/v1/photos/${encodeURIComponent(photoId)}/versions?cursor=${encodeURIComponent(cursor)}`,
        ownerPhotoVersionsPageSchema,
        { signal: controller.signal },
      );
      if (page.photoId !== photoId) {
        throw new ApiError('Response photo did not match', 200, '');
      }
      if (
        page.current.versionId !== current.page.current.versionId ||
        page.current.revision !== current.page.current.revision
      ) {
        startRefresh();
        return;
      }
      if (page.nextCursor === cursor) {
        startRefresh();
        return;
      }
      if (controller.signal.aborted || readSequenceRef.current !== sequence)
        return;

      setRead((previous) => {
        if (
          previous?.status !== 'ready' ||
          previous.sequence !== sequence ||
          previous.photoId !== photoId
        )
          return previous;
        const seen = new Set(previous.versions.map((version) => version.id));
        const additional = page.versions.filter(
          (version) => !seen.has(version.id),
        );
        return {
          ...previous,
          versions: [...previous.versions, ...additional],
          page: { ...previous.page, nextCursor: page.nextCursor },
          moreError: '',
          loadingMore: false,
        };
      });
    } catch (error) {
      if (controller.signal.aborted || readSequenceRef.current !== sequence)
        return;
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        failRead(loadErrorMessage(error));
      } else if (
        error instanceof ApiError &&
        (error.status === 400 || error.status === 409)
      ) {
        startRefresh();
      } else {
        const message = loadErrorMessage(error);
        setRead((previous) =>
          previous?.status === 'ready' && previous.sequence === sequence
            ? { ...previous, loadingMore: false, moreError: message }
            : previous,
        );
      }
    } finally {
      if (moreAbortRef.current === controller) moreAbortRef.current = null;
      moreInFlightRef.current = false;
      setRead((previous) =>
        previous?.status === 'ready' && previous.sequence === sequence
          ? { ...previous, loadingMore: false }
          : previous,
      );
    }
  }, [failRead, photoId, read, startRefresh]);

  const clearIntent = useCallback(
    (attempt: SwitchIntent, releasePending = true) => {
      if (intentRef.current?.requestId !== attempt.requestId) return;
      intentRef.current = null;
      setIntent(null);
      setSending(false);
      setIntentMessage('');
      if (releasePending) reportPending(false);
    },
    [reportPending],
  );

  const rememberIntent = useCallback((next: SwitchIntent | null) => {
    intentRef.current = next;
    setIntent(next);
  }, []);

  const sendIntent = useCallback(
    async (attempt: SwitchIntent) => {
      if (
        intentRef.current?.requestId !== attempt.requestId ||
        inFlightRef.current
      )
        return;
      inFlightRef.current = true;
      setSending(true);
      setIntentMessage('');
      try {
        const response = await fetch(
          `/api/v1/photos/${encodeURIComponent(attempt.photoId)}/versions/set-current`,
          {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: attempt.body,
          },
        );
        const body: unknown = await response.json().catch(() => null);

        if (response.status === 409) {
          const currentIntent = intentRef.current;
          const code = errorCode(body);
          const definitelyNotCommitted =
            code === 'PHOTO_VERSION_REVISION_CONFLICT' ||
            code === 'PHOTO_VERSION_NOT_READY';
          if (currentIntent?.ambiguous && !definitelyNotCommitted) {
            setIntentMessage(
              '此操作先前的回應不明；請保留原操作並重試，核對完成前不會更換版本。',
            );
            return;
          }

          if (definitelyNotCommitted) {
            reportPending(true);
            clearIntent(attempt, false);
            setNotice(
              code === 'PHOTO_VERSION_NOT_READY'
                ? '操作未套用：此版本目前尚未就緒。正在重新讀取目前狀態。'
                : '操作未套用：目前版本已變更。正在重新讀取目前狀態。',
            );
            reconciliationRef.current = { notifyGallery: true };
            setReconciling(true);
            startRefresh();
            return;
          }

          clearIntent(attempt);
          setNotice('此操作未套用，已重新載入版本紀錄；請再次確認後操作。');
          startRefresh();
          return;
        }

        if (!response.ok) {
          const currentIntent = intentRef.current;
          if (currentIntent?.requestId === attempt.requestId) {
            rememberIntent({ ...currentIntent, ambiguous: true });
          }
          const authFailure =
            response.status === 401 ||
            response.status === 403 ||
            errorCode(body) === 'OWNER_REQUIRED';
          const message = authFailure
            ? '登入或管理權限需要重新確認。操作結果仍未確認；重新登入後請重試同一操作，原操作編號與內容會保持不變。'
            : '操作結果仍未確認。請明確重試同一操作，原操作編號與內容會保持不變。';
          setIntentMessage(message);
          if (authFailure)
            failRead(loadErrorMessage(new ApiError('', response.status, '')));
          return;
        }

        const parsed = setCurrentPhotoVersionResultSchema.safeParse(body);
        if (!parsed.success) {
          const currentIntent = intentRef.current;
          if (currentIntent?.requestId === attempt.requestId) {
            rememberIntent({ ...currentIntent, ambiguous: true });
          }
          setIntentMessage(
            '伺服器回應無法與原操作核對；結果仍未確認，請重試同一操作。',
          );
          return;
        }
        const expectedResultRevision =
          attempt.expectedRevision + (parsed.data.changed ? 1 : 0);
        if (
          parsed.data.photoId !== attempt.photoId ||
          parsed.data.current.versionId !== attempt.versionId ||
          parsed.data.current.revision !== expectedResultRevision
        ) {
          const currentIntent = intentRef.current;
          if (currentIntent?.requestId === attempt.requestId) {
            rememberIntent({ ...currentIntent, ambiguous: true });
          }
          setIntentMessage(
            '伺服器回應無法與原操作核對；結果仍未確認，請重試同一操作。',
          );
          return;
        }

        rememberIntent(null);
        setConfirmVersionId(null);
        setIntentMessage('操作已收到確認，正在重新讀取目前版本。請稍候。');
        reconciliationRef.current = { notifyGallery: true };
        setReconciling(true);
        reportPending(true);
        startRefresh();
      } catch {
        const currentIntent = intentRef.current;
        if (currentIntent?.requestId === attempt.requestId) {
          rememberIntent({ ...currentIntent, ambiguous: true });
        }
        setIntentMessage(
          '操作結果仍未確認。請明確重試同一操作，原操作編號與內容會保持不變。',
        );
      } finally {
        inFlightRef.current = false;
        setSending(false);
      }
    },
    [clearIntent, failRead, rememberIntent, reportPending, startRefresh],
  );

  const confirmSwitch = useCallback(() => {
    const current = read;
    const target =
      current?.status === 'ready'
        ? current.versions.find((version) => version.id === confirmVersionId)
        : undefined;
    if (
      !current ||
      current.status !== 'ready' ||
      current.photoId !== photoId ||
      !target ||
      !isSwitchable(target, current.page.current.versionId) ||
      uploadPendingRef.current ||
      intentRef.current ||
      reconciliationRef.current
    )
      return;

    const parsed = setCurrentPhotoVersionSchema.safeParse({
      requestId: crypto.randomUUID(),
      expectedRevision: current.page.current.revision,
      expectedCurrentVersionId: current.page.current.versionId,
      versionId: target.id,
      confirm: true,
    });
    if (!parsed.success) {
      setIntentMessage('無法建立有效的版本切換操作，請重新載入後再試。');
      return;
    }

    const attempt: SwitchIntent = {
      photoId,
      requestId: parsed.data.requestId,
      body: JSON.stringify(parsed.data),
      versionNo: target.versionNo,
      versionId: parsed.data.versionId,
      expectedCurrentVersionId: parsed.data.expectedCurrentVersionId,
      expectedRevision: parsed.data.expectedRevision,
      ambiguous: false,
    };
    setNotice('');
    setConfirmVersionId(null);
    rememberIntent(attempt);
    reportPending(true);
    void sendIntent(attempt);
  }, [
    photoId,
    read,
    rememberIntent,
    reportPending,
    sendIntent,
    confirmVersionId,
  ]);

  const retryIntent = useCallback(() => {
    const attempt = intentRef.current;
    if (!attempt || inFlightRef.current) return;
    void sendIntent(attempt);
  }, [sendIntent]);

  const currentIntent = intent?.photoId === photoId ? intent : null;
  const busy = Boolean(currentIntent || reconciling || uploadPending);
  const parsedUploadContext = uploadContext
    ? versionUploadContextSchema.safeParse(uploadContext)
    : null;
  const uploadMount =
    activeRead?.status === 'ready' &&
    activeRead.photoId === photoId &&
    parsedUploadContext?.success === true &&
    !intent &&
    !reconciling
      ? { current: activeRead.page.current, context: parsedUploadContext.data }
      : null;

  return (
    <section
      aria-label="照片版本管理"
      className="min-w-0 rounded-xl bg-stone-50 p-3 text-stone-900 shadow-sm sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">版本紀錄</h2>
          <p className="mt-1 text-sm text-stone-600">
            檢視此照片的版本，並選擇要使用的目前版本。
          </p>
        </div>
        {activeRead?.status === 'ready' && (
          <span className="shrink-0 rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-800">
            共載入 {activeRead.versions.length} 個版本
          </span>
        )}
      </div>

      {currentIntent && (
        <div
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-semibold text-amber-950">
            {sending ? '正在確認版本切換…' : '版本切換結果尚待確認'}
          </p>
          <p className="mt-1 text-sm text-amber-900">
            {intentMessage ||
              `請完成或重試切換至第 ${currentIntent.versionNo} 版的操作。確認前，其他版本操作與照片切換會保持鎖定。`}
          </p>
          {!sending && (
            <button
              type="button"
              onClick={retryIntent}
              className="mt-3 min-h-11 w-full rounded-md bg-amber-900 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900 sm:w-auto"
            >
              重試同一操作
            </button>
          )}
        </div>
      )}

      {notice && (
        <p
          className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950"
          role="status"
        >
          {notice}
        </p>
      )}

      {reconciling && !currentIntent && (
        <p
          className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-950"
          role="status"
        >
          {intentMessage || '正在重新讀取目前版本，請稍候。'}
        </p>
      )}

      {activeRead?.status === 'loading' && (
        <p className="mt-4 text-sm text-stone-600" role="status">
          正在載入版本紀錄…
        </p>
      )}

      {activeRead?.status === 'disabled' && (
        <p className="mt-4 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          版本管理目前尚未開放。
        </p>
      )}

      {activeRead?.status === 'error' && (
        <div className="mt-4 rounded-lg border border-stone-300 bg-white p-3">
          <p className="text-sm text-stone-700" role="alert">
            {activeRead.message}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={startRefresh}
            className="mt-3 min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700"
          >
            重新載入
          </button>
        </div>
      )}

      {activeRead?.status === 'ready' && (
        <>
          <p className="mt-3 text-sm text-stone-700">
            目前使用的版本會在已載入的項目中標示；較舊版本可載入查看。
          </p>
          {activeRead.versions.length === 0 ? (
            <p className="mt-3 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
              目前沒有可顯示的版本紀錄。
            </p>
          ) : (
            <ol className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              {activeRead.versions.map((version) => {
                const isCurrent =
                  version.id === activeRead.page.current.versionId;
                const canSwitch =
                  !busy &&
                  isSwitchable(version, activeRead.page.current.versionId);
                const isConfirming = confirmVersionId === version.id;
                const previewUrl =
                  version.processing === 'succeeded'
                    ? version.previewUrl
                    : null;
                return (
                  <li
                    key={version.id}
                    className={`min-w-0 rounded-lg border bg-white p-3 ${
                      isCurrent
                        ? 'border-emerald-700 ring-1 ring-emerald-700/20'
                        : 'border-stone-300'
                    }`}
                  >
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-stone-100 sm:h-24 sm:w-24">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={`第 ${version.versionNo} 版預覽`}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <span className="px-2 text-center text-xs text-stone-500">
                            預覽尚未就緒
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            第 {version.versionNo} 版
                          </h3>
                          {isCurrent && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-950">
                              目前使用
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-stone-700">
                          {processingLabel(version.processing)}
                        </p>
                        <p className="mt-1 break-words text-xs text-stone-600">
                          {formatCreatedAt(version.createdAt)}
                        </p>
                        <p className="mt-1 break-all text-xs text-stone-600">
                          {version.width !== null && version.height !== null
                            ? `${version.width} × ${version.height}`
                            : '尺寸資料未提供'}
                        </p>
                      </div>
                    </div>

                    {isCurrent ? (
                      <p className="mt-3 text-sm font-medium text-emerald-900">
                        這是目前使用的版本。
                      </p>
                    ) : (
                      <div className="mt-3">
                        {!isSwitchable(
                          version,
                          activeRead.page.current.versionId,
                        ) && (
                          <p className="mb-2 text-xs text-stone-600">
                            版本處理完成且預覽可用後，才能設為目前版本。
                          </p>
                        )}
                        {isConfirming ? (
                          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                            <p className="text-sm font-medium text-amber-950">
                              確定將目前版本切換為第 {version.versionNo} 版？
                            </p>
                            <p className="mt-1 text-xs text-amber-900">
                              這會更新照片目前使用的版本。
                            </p>
                            <div className="mt-3 flex flex-col gap-2 min-[420px]:flex-row">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={confirmSwitch}
                                className="min-h-11 flex-1 rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                確認切換
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmVersionId(null)}
                                className="min-h-11 flex-1 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                返回
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={!canSwitch}
                            onClick={() => setConfirmVersionId(version.id)}
                            className="min-h-11 w-full rounded-md border border-stone-500 px-3 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            設為目前版本
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {activeRead.page.nextCursor && (
            <div className="mt-4">
              {activeRead.moreError && (
                <p className="mb-2 text-sm text-stone-700" role="alert">
                  {activeRead.moreError}
                </p>
              )}
              <button
                type="button"
                disabled={busy || activeRead.loadingMore}
                onClick={() => void loadMore()}
                className="min-h-11 w-full rounded-md border border-stone-500 px-3 py-2 text-sm font-semibold text-stone-900 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeRead.loadingMore ? '正在載入…' : '載入更多版本'}
              </button>
            </div>
          )}
        </>
      )}

      {uploadMount && (
        <div className="mt-4">
          <VersionUploadPanel
            workspaceId={uploadMount.context.workspaceId}
            projectId={uploadMount.context.projectId}
            albumId={uploadMount.context.albumId}
            photoId={photoId}
            current={uploadMount.current}
            versioningMode={uploadMount.context.versioningMode}
            onPendingChange={reportUploadPending}
            onCompleted={() => {
              setNotice(
                '版本已建立並送入背景處理。相簿仍顯示原目前版本；處理完成後，請明確切換。',
              );
              startRefresh();
            }}
          />
        </div>
      )}
    </section>
  );
}
