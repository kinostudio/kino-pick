'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { z } from 'zod';
import {
  versionUploadCapabilitiesSchema,
  versionUploadCompletionSchema,
  versionUploadInitResultSchema,
  versionUploadInitSchema,
  versionUploadRecoverySchema,
} from '../../../packages/contracts/src/version-uploads';
import {
  photoVersionHeadSchema,
  type PhotoVersionHead,
} from '../../../packages/contracts/src/photo-versions';
import {
  authorizeUpload,
  cancelUpload,
  DirectUploadResponseError,
  getUploadCapabilities,
  getUploadOwner,
  putUploadFile,
  UploadProtocolError,
  UploadRequestError,
  type UploadAuthorization,
  type UploadCapabilities,
} from './upload-client';
import {
  ImagePreparationError,
  MAX_BROWSER_UPLOAD_BYTES,
  prepareImage,
  type PreparedImage,
} from './prepare-image';
import {
  decodeVersionUploadJournal,
  encodeVersionUploadJournal,
  versionUploadJournalKey,
  versionUploadJournalScopeSchema,
  type VersionUploadJournalItem,
  type VersionUploadJournalScope,
} from './version-upload-journal';

export type VersioningMode = 'off' | 'manual' | 'auto_filename' | 'assisted';

export type VersionUploadPanelProps = {
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  current: PhotoVersionHead;
  versioningMode: VersioningMode;
  onPendingChange?: (pending: boolean) => void;
  onCompleted?: () => void;
};

type CapabilityState =
  | { status: 'loading' }
  | { status: 'disabled' }
  | { status: 'ready'; value: UploadCapabilities }
  | { status: 'unavailable'; message: string };

type JournalState = 'loading' | 'ready' | 'blocked';

type ScopedCapabilityState = {
  resourceKey: string;
  value: CapabilityState;
};

type JournalSnapshot = {
  resourceKey: string;
  state: JournalState;
  issue: string;
  scope: VersionUploadJournalScope | null;
  entries: VersionUploadJournalItem[];
};

const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });
const cancelResultSchema = z
  .object({
    uploadSession: z.object({
      id: z.uuid(),
      status: z.enum([
        'reserved',
        'cancelled',
        'expired',
        'completed',
        'needs_review',
      ]),
    }),
  })
  .strict();
const clientInitSchema = versionUploadInitSchema.extend({
  expectedBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_BROWSER_UPLOAD_BYTES)
    .safe(),
});

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new UploadRequestError(
      response.status,
      parsed.success ? parsed.data.error.code : 'UNKNOWN_ERROR',
    );
  }
  return body;
}

function parseResponse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UploadProtocolError();
  return parsed.data;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function targetMatches(
  target: {
    photoId: string;
    parentVersionId: string;
    expectedRevision: number;
    changeType: string;
    changeNote: string;
    labels: string[];
  },
  item: VersionUploadJournalItem,
  photoId: string,
) {
  return (
    target.photoId === photoId &&
    target.parentVersionId === item.initBody.expectedCurrentVersionId &&
    target.expectedRevision === item.initBody.expectedRevision &&
    target.changeType === item.initBody.changeType &&
    target.changeNote === item.initBody.changeNote &&
    sameStrings(target.labels, item.initBody.labels)
  );
}

function isObjectMissing(error: unknown) {
  return (
    error instanceof UploadRequestError &&
    error.status === 409 &&
    error.code === 'UPLOAD_OBJECT_NOT_FOUND'
  );
}

function messageFor(error: unknown) {
  if (error instanceof UploadRequestError) {
    if (
      error.code === 'AUTH_REQUIRED' ||
      error.code === 'OWNER_REQUIRED' ||
      error.code === 'UPLOAD_OWNER_CHANGED'
    )
      return '登入或管理者授權已失效。請重新登入，再以原本的工作記錄接續。';
    if (error.code === 'PHOTO_VERSION_REVISION_CONFLICT')
      return '照片目前版本已變更。這筆上傳意圖仍保留原本版本見證；請先刷新相簿，再決定是否建立新工作。';
    if (error.code === 'VERSIONING_MODE_DISABLED')
      return '目前版本模式不允許這筆新工作。原始操作記錄已保留，請由管理者確認模式後再處理。';
    if (
      error.code === 'DIRECT_UPLOAD_DISABLED' ||
      error.code === 'PHOTO_VERSION_UPLOADS_DISABLED' ||
      error.code === 'DIRECT_UPLOAD_NOT_CONFIGURED'
    )
      return '目前尚未開放版本上傳。';
    if (error.code === 'UPLOAD_AUTHORIZATION_EXPIRED')
      return '原上傳授權已逾期。系統不會另建工作；請確認取消原工作後再重新開始。';
    if (error.code === 'REQUEST_ID_CONFLICT')
      return '伺服器無法核對原操作記錄。請保留這筆工作並交由管理者檢查。';
  }
  if (error instanceof UploadProtocolError && !error.retryable)
    return '本機記錄與伺服器目標不一致，已停止傳送。請保留記錄並交由管理者檢查。';
  if (error instanceof ImagePreparationError) return error.message;
  if (error instanceof DirectUploadResponseError)
    return '照片傳送回應未能確認。請使用同一份本機工作記錄重試。';
  return '目前無法確認這筆版本上傳結果。工作編號與請求內容已保留；重試會沿用原操作。';
}

export function VersionUploadPanel({
  workspaceId,
  projectId,
  albumId,
  photoId,
  current,
  versioningMode,
  onPendingChange,
  onCompleted,
}: VersionUploadPanelProps) {
  const resourceKey = [workspaceId, projectId, albumId, photoId].join(':');
  const [capabilityRecord, setCapabilityRecord] =
    useState<ScopedCapabilityState | null>(null);
  const [journalRecord, setJournalRecord] = useState<JournalSnapshot | null>(
    null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [notice, setNotice] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [selectedChangeType, setSelectedChangeType] = useState<
    'new_retouch' | 'replace_current'
  >('new_retouch');
  const changeTypeId = useId();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const titleId = useId();
  const fileLabelId = useId();
  const noteId = useId();
  const labelsId = useId();
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const releaseLockRef = useRef<(() => void) | null>(null);
  const scopeRef = useRef<VersionUploadJournalScope | null>(null);
  const entriesRef = useRef<VersionUploadJournalItem[]>([]);
  const pendingRef = useRef(false);
  const busyRef = useRef(false);
  const capabilityRef = useRef<UploadCapabilities | null>(null);
  const onPendingChangeRef = useRef(onPendingChange);
  const onCompletedRef = useRef(onCompleted);

  const capability =
    capabilityRecord?.resourceKey === resourceKey
      ? capabilityRecord.value
      : ({ status: 'loading' } as const);
  const currentJournal =
    journalRecord?.resourceKey === resourceKey ? journalRecord : null;
  const journalState = currentJournal?.state ?? 'loading';
  const journalIssue = currentJournal?.issue ?? '';
  const entries = currentJournal?.entries ?? [];
  const activeScope = currentJournal?.scope ?? null;
  const scopeMatchesCurrent =
    activeScope !== null &&
    activeScope.workspaceId === workspaceId &&
    activeScope.projectId === projectId &&
    activeScope.albumId === albumId &&
    activeScope.photoId === photoId;
  const visibleEntries = scopeMatchesCurrent ? entries : [];
  const activeItem = visibleEntries[0] ?? null;
  const unresolved = visibleEntries.length > 0;
  const changeType =
    versioningMode === 'off' ? 'replace_current' : selectedChangeType;

  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
    onCompletedRef.current = onCompleted;
  }, [onPendingChange, onCompleted]);

  function notifyPending(value: boolean) {
    if (pendingRef.current === value) return;
    pendingRef.current = value;
    onPendingChangeRef.current?.(value);
  }

  function isActive(generation: number) {
    return mountedRef.current && generationRef.current === generation;
  }

  function persist(
    next: VersionUploadJournalItem[],
    generation = generationRef.current,
  ) {
    const scope = scopeRef.current;
    if (
      !scope ||
      !isActive(generation) ||
      journalState !== 'ready' ||
      scope.workspaceId !== workspaceId ||
      scope.projectId !== projectId ||
      scope.albumId !== albumId ||
      scope.photoId !== photoId
    )
      throw new UploadProtocolError(false);
    try {
      const encoded = encodeVersionUploadJournal(scope, next);
      localStorage.setItem(versionUploadJournalKey(scope), encoded);
    } catch (error) {
      blockJournal(error, generation);
      throw error;
    }
    entriesRef.current = next;
    setJournalRecord({
      resourceKey,
      state: 'ready',
      issue: '',
      scope,
      entries: next,
    });
    notifyPending(next.length > 0);
  }

  function saveEntry(
    entry: VersionUploadJournalItem,
    generation = generationRef.current,
  ) {
    const currentEntries = entriesRef.current;
    const found = currentEntries.some((item) => item.id === entry.id);
    persist(
      found
        ? currentEntries.map((item) => (item.id === entry.id ? entry : item))
        : [...currentEntries, entry],
      generation,
    );
  }

  function removeEntry(id: string, generation = generationRef.current) {
    persist(
      entriesRef.current.filter((item) => item.id !== id),
      generation,
    );
  }

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    scopeRef.current = null;
    capabilityRef.current = null;
    entriesRef.current = [];

    async function initialize() {
      try {
        const response = await fetch('/api/v1/version-uploads/capabilities', {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        });
        const versionCapabilities = parseResponse(
          versionUploadCapabilitiesSchema,
          await readResponse(response),
        );
        if (!isActive(generation)) return;
        if (!versionCapabilities.enabled) {
          setCapabilityRecord({
            resourceKey,
            value: { status: 'disabled' },
          });
          setJournalRecord({
            resourceKey,
            state: 'ready',
            issue: '',
            scope: null,
            entries: [],
          });
          return;
        }

        const directCapabilities = await getUploadCapabilities(
          controller.signal,
          workspaceId,
        );
        if (!isActive(generation)) return;
        if (!directCapabilities.enabled) {
          setCapabilityRecord({
            resourceKey,
            value: { status: 'disabled' },
          });
          setJournalRecord({
            resourceKey,
            state: 'ready',
            issue: '',
            scope: null,
            entries: [],
          });
          return;
        }
        capabilityRef.current = directCapabilities;
        setCapabilityRecord({
          resourceKey,
          value: { status: 'ready', value: directCapabilities },
        });

        const actorId = await getUploadOwner(controller.signal);
        if (!isActive(generation)) return;
        const scope = versionUploadJournalScopeSchema.parse({
          actorId,
          workspaceId,
          projectId,
          albumId,
          photoId,
        });
        if (!navigator.locks) {
          setJournalRecord({
            resourceKey,
            state: 'blocked',
            issue:
              '此瀏覽器不支援跨分頁安全鎖定，已停止版本上傳。請使用支援 Web Locks 的瀏覽器及安全連線。',
            scope: null,
            entries: [],
          });
          return;
        }

        await navigator.locks.request(
          versionUploadJournalKey(scope),
          { ifAvailable: true },
          async (lock) => {
            if (!isActive(generation)) return;
            if (!lock) {
              setJournalRecord({
                resourceKey,
                state: 'blocked',
                issue:
                  '另一個分頁正在處理這張照片的版本工作。請關閉該分頁後重新載入。',
                scope,
                entries: [],
              });
              return;
            }

            scopeRef.current = scope;
            try {
              const key = versionUploadJournalKey(scope);
              const raw = localStorage.getItem(key);
              const restored = decodeVersionUploadJournal(raw, scope);
              if (raw === null)
                localStorage.setItem(
                  key,
                  encodeVersionUploadJournal(scope, []),
                );
              if (!isActive(generation)) return;
              entriesRef.current = restored;
              setJournalRecord({
                resourceKey,
                state: 'ready',
                issue: '',
                scope,
                entries: restored,
              });
              notifyPending(restored.length > 0);
            } catch {
              setJournalRecord({
                resourceKey,
                state: 'blocked',
                issue:
                  '本機版本工作記錄損壞、過期或無法保存。沒有送出新工作；請保留記錄並由管理者檢查。',
                scope,
                entries: [],
              });
            }

            await new Promise<void>((resolve) => {
              releaseLockRef.current = resolve;
              if (!isActive(generation)) resolve();
            });
          },
        );
      } catch {
        if (!isActive(generation) || controller.signal.aborted) return;
        setCapabilityRecord({
          resourceKey,
          value: {
            status: 'unavailable',
            message: '目前無法確認版本上傳功能狀態。尚未開始上傳，請稍後重試。',
          },
        });
        setJournalRecord({
          resourceKey,
          state: 'blocked',
          issue: '',
          scope: null,
          entries: [],
        });
      }
    }

    void initialize();

    return () => {
      controller.abort();
      releaseLockRef.current?.();
      releaseLockRef.current = null;
      if (generationRef.current === generation) generationRef.current += 1;
      mountedRef.current = false;
    };
    // Resource context owns this panel's journal namespace.
  }, [workspaceId, projectId, albumId, photoId, resourceKey]);

  useEffect(() => {
    if (!unresolved) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [unresolved]);

  useEffect(
    () => () => {
      if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    },
    [prepared],
  );

  function blockJournal(error: unknown, generation = generationRef.current) {
    if (!isActive(generation)) return;
    setJournalRecord({
      resourceKey,
      state: 'blocked',
      issue:
        error instanceof Error &&
        error.message === 'VERSION_UPLOAD_JOURNAL_TOO_LARGE'
          ? '本機版本工作記錄超過安全上限，已停止新請求。請保留工作資訊並聯絡管理者。'
          : '無法保存本機版本工作記錄，已停止後續請求。請保留目前畫面並聯絡管理者。',
      scope: scopeRef.current,
      entries: entriesRef.current,
    });
    setNotice('');
  }

  async function currentOwner(generation: number) {
    const scope = scopeRef.current;
    if (
      !scope ||
      !isActive(generation) ||
      scope.workspaceId !== workspaceId ||
      scope.projectId !== projectId ||
      scope.albumId !== albumId ||
      scope.photoId !== photoId
    )
      throw new UploadProtocolError(false);
    const actorId = await getUploadOwner();
    if (!isActive(generation) || actorId !== scope.actorId)
      throw new UploadProtocolError(false);
    return actorId;
  }

  async function postVersion<T>(
    path: string,
    body: unknown,
    actorId: string,
    schema: z.ZodType<T>,
  ) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Kino-Expected-Actor': z.uuid().parse(actorId),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    return parseResponse(schema, await readResponse(response));
  }

  async function getRecovery(item: VersionUploadJournalItem) {
    const requestId = z.uuid().parse(item.initBody.requestId);
    const response = await fetch(
      '/api/v1/photos/' +
        encodeURIComponent(photoId) +
        '/versions/uploads/recovery?requestId=' +
        encodeURIComponent(requestId),
      {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      },
    );
    return parseResponse(
      versionUploadRecoverySchema,
      await readResponse(response),
    );
  }

  async function createVersion(
    item: VersionUploadJournalItem,
    actorId: string,
  ) {
    const result = await postVersion(
      '/api/v1/photos/' + encodeURIComponent(photoId) + '/versions/init',
      item.initBody,
      actorId,
      versionUploadInitResultSchema,
    );
    if (
      !targetMatches(result.target, item, photoId) ||
      result.uploadSession.workspaceId !== workspaceId ||
      result.uploadSession.projectId !== projectId ||
      result.uploadSession.albumId !== albumId ||
      result.uploadSession.originalFilename !==
        item.initBody.originalFilename ||
      result.uploadSession.expectedBytes !== item.initBody.expectedBytes
    )
      throw new UploadProtocolError(false);
    return result;
  }

  function parseCompletion(body: unknown, item: VersionUploadJournalItem) {
    const result = parseResponse(versionUploadCompletionSchema, body);
    if (
      result.photoId !== photoId ||
      result.parentVersionId !== item.initBody.expectedCurrentVersionId ||
      result.actualBytes !== item.initBody.expectedBytes ||
      result.sha256 !== item.initBody.sha256 ||
      result.contentType !== item.initBody.contentType ||
      result.width !== item.width ||
      result.height !== item.height ||
      result.changeType !== item.initBody.changeType ||
      result.changeNote !== item.initBody.changeNote ||
      !sameStrings(result.labels, item.initBody.labels)
    )
      throw new UploadProtocolError(false);
    return result;
  }

  async function sendCompletion(
    item: VersionUploadJournalItem,
    actorId: string,
  ) {
    if (!item.uploadSessionId || !item.completeBody)
      throw new UploadProtocolError(false);
    const body = await postVersion(
      '/api/v1/photos/' +
        encodeURIComponent(photoId) +
        '/versions/' +
        encodeURIComponent(item.uploadSessionId) +
        '/complete',
      item.completeBody,
      actorId,
      versionUploadCompletionSchema,
    );
    return parseCompletion(body, item);
  }

  function finishCompletion(
    item: VersionUploadJournalItem,
    generation: number,
  ) {
    if (!isActive(generation)) return;
    removeEntry(item.id, generation);
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared(null);
    setFile(null);
    setStage('');
    setNotice(
      '版本已建立並送入背景處理。相簿仍顯示原目前版本；處理完成後，請在版本面板明確切換。',
    );
    onCompletedRef.current?.();
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!selected || busyRef.current) return;
    const generation = generationRef.current;
    const limits = capabilityRef.current;
    if (!limits || !limits.enabled) return;

    setNotice('');
    setStage('正在檢查照片格式、尺寸與雜湊…');
    let nextPrepared: PreparedImage | null = null;
    try {
      nextPrepared = await prepareImage(selected, {
        maxBrowserBytes: Math.min(
          limits.maxBrowserBytes,
          MAX_BROWSER_UPLOAD_BYTES,
        ),
        maxPixels: limits.maxPixels,
        maxDimension: limits.maxDimension,
      });
      if (!isActive(generation)) {
        return;
      }
      const saved = entriesRef.current[0];
      if (
        saved &&
        (selected.name.trim() !== saved.initBody.originalFilename ||
          selected.size !== saved.initBody.expectedBytes ||
          nextPrepared.contentType !== saved.initBody.contentType ||
          nextPrepared.sha256 !== saved.initBody.sha256 ||
          nextPrepared.width !== saved.width ||
          nextPrepared.height !== saved.height)
      )
        throw new Error('VERSION_UPLOAD_FILE_MISMATCH');
      if (!mountedRef.current) {
        URL.revokeObjectURL(nextPrepared.previewUrl);
        return;
      }
      if (prepared) URL.revokeObjectURL(prepared.previewUrl);
      setFile(selected);
      setPrepared(nextPrepared);
      nextPrepared = null;
      setNotice(
        saved
          ? '原檔大小、格式、雜湊及尺寸均符合保存的工作；重試會沿用原始請求。'
          : '照片檢查完成。按下建立版本後，才會先保存操作記錄再送出請求。',
      );
    } catch (error) {
      if (isActive(generation)) {
        setFile(null);
        setPrepared(null);
        setNotice(
          error instanceof Error &&
            error.message === 'VERSION_UPLOAD_FILE_MISMATCH'
            ? '所選檔案與原工作不符，尚未傳送。請重新選擇同一原檔。'
            : messageFor(error),
        );
      }
    } finally {
      if (nextPrepared) URL.revokeObjectURL(nextPrepared.previewUrl);
      if (isActive(generation)) setStage('');
    }
  }

  async function runUpload() {
    if (busyRef.current || journalState !== 'ready' || !scopeMatchesCurrent)
      return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    const generation = generationRef.current;

    try {
      let item = entriesRef.current[0] ?? null;
      if (entriesRef.current.length > 1) throw new UploadProtocolError(false);
      if (!file || !prepared) throw new Error('請先選擇並檢查照片原檔。');
      if (
        file.name.trim() !==
          (item?.initBody.originalFilename ?? file.name.trim()) ||
        file.size !== (item?.initBody.expectedBytes ?? file.size) ||
        prepared.sha256 !== (item?.initBody.sha256 ?? prepared.sha256) ||
        prepared.width !== (item?.width ?? prepared.width) ||
        prepared.height !== (item?.height ?? prepared.height)
      )
        throw new UploadProtocolError(false);

      if (!item) {
        if (changeType === 'replace_current' && !confirmReplace)
          throw new Error('請先確認這次是明確取代目前版本的版本上傳。');
        const input = clientInitSchema.safeParse({
          requestId: crypto.randomUUID(),
          originalFilename: file.name,
          expectedBytes: file.size,
          contentType: prepared.contentType,
          sha256: prepared.sha256,
          expectedRevision: photoVersionHeadSchema.parse(current).revision,
          expectedCurrentVersionId: current.versionId,
          changeType,
          changeNote,
          labels: labelsText
            .split(/[\n,]/u)
            .map((label) => label.trim())
            .filter(Boolean),
          confirm: true,
        });
        if (!input.success) throw new Error('版本說明或標籤未通過格式檢查。');
        item = {
          id: crypto.randomUUID(),
          initBody: input.data,
          uploadSessionId: null,
          authorizeBody: null,
          completeBody: null,
          cancelBody: null,
          width: prepared.width,
          height: prepared.height,
        };
        try {
          saveEntry(item, generation);
        } catch (error) {
          blockJournal(error, generation);
          throw new UploadProtocolError(false);
        }
      }

      let actorId = await currentOwner(generation);
      let recovery: z.infer<typeof versionUploadRecoverySchema> | null = null;
      try {
        recovery = await getRecovery(item);
      } catch (error) {
        if (
          !(error instanceof UploadRequestError) ||
          error.status !== 404 ||
          item.uploadSessionId !== null
        )
          throw error;
      }
      if (!isActive(generation)) return;

      if (recovery) {
        if (
          recovery.initRequestId !== item.initBody.requestId ||
          !targetMatches(recovery.target, item, photoId) ||
          recovery.uploadSession.workspaceId !== workspaceId ||
          recovery.uploadSession.projectId !== projectId ||
          recovery.uploadSession.albumId !== albumId ||
          recovery.uploadSession.originalFilename !==
            item.initBody.originalFilename ||
          recovery.uploadSession.expectedBytes !==
            item.initBody.expectedBytes ||
          recovery.contentType !== item.initBody.contentType ||
          recovery.sha256 !== item.initBody.sha256 ||
          (item.uploadSessionId &&
            item.uploadSessionId !== recovery.uploadSession.id) ||
          (item.authorizeBody &&
            recovery.authorizationRequestId &&
            item.authorizeBody.requestId !== recovery.authorizationRequestId)
        )
          throw new UploadProtocolError(false);

        item = {
          ...item,
          uploadSessionId: recovery.uploadSession.id,
          authorizeBody: recovery.authorizationRequestId
            ? { requestId: recovery.authorizationRequestId }
            : item.authorizeBody,
        };
        try {
          saveEntry(item, generation);
        } catch (error) {
          blockJournal(error, generation);
          throw new UploadProtocolError(false);
        }

        if (recovery.uploadSession.status === 'cancelled') {
          removeEntry(item.id, generation);
          setNotice('伺服器已確認原工作取消。本機記錄已清除，可另建新工作。');
          return;
        }
        if (recovery.uploadSession.status === 'expired') {
          setNotice(
            '伺服器已確認原工作逾期。請保留記錄並由管理者確認後再開始新工作。',
          );
          return;
        }
        if (recovery.uploadSession.status === 'needs_review') {
          setNotice(
            '伺服器已將原工作標記為需要檢查。請保留記錄並交由管理者處理。',
          );
          return;
        }
        if (recovery.uploadSession.status === 'completed') {
          if (!item.completeBody) throw new UploadProtocolError(false);
          actorId = await currentOwner(generation);
          await sendCompletion(item, actorId);
          finishCompletion(item, generation);
          return;
        }
      } else if (item.uploadSessionId) {
        throw new UploadProtocolError(false);
      }

      if (!item.uploadSessionId) {
        setStage('建立固定目標的版本工作…');
        actorId = await currentOwner(generation);
        const created = await createVersion(item, actorId);
        if (!isActive(generation)) return;
        item = { ...item, uploadSessionId: created.uploadSession.id };
        try {
          saveEntry(item, generation);
        } catch (error) {
          blockJournal(error, generation);
          throw new UploadProtocolError(false);
        }
      }
      if (!item.uploadSessionId) throw new UploadProtocolError(false);

      if (recovery?.authorizationExpiresAt) {
        const expires = Date.parse(recovery.authorizationExpiresAt);
        if (!Number.isFinite(expires) || expires <= Date.now())
          throw new UploadRequestError(409, 'UPLOAD_AUTHORIZATION_EXPIRED');
      }

      if (!item.authorizeBody) {
        item = { ...item, authorizeBody: { requestId: crypto.randomUUID() } };
        try {
          saveEntry(item, generation);
        } catch (error) {
          blockJournal(error, generation);
          throw new UploadProtocolError(false);
        }
      }
      const uploadSessionId = item.uploadSessionId;
      const authorizeBody = item.authorizeBody;
      if (!uploadSessionId || !authorizeBody)
        throw new UploadProtocolError(false);
      actorId = await currentOwner(generation);
      const authorization: UploadAuthorization = await authorizeUpload(
        uploadSessionId,
        authorizeBody,
        actorId,
      );
      if (!isActive(generation)) return;

      if (!item.completeBody) {
        item = { ...item, completeBody: { requestId: crypto.randomUUID() } };
        try {
          saveEntry(item, generation);
        } catch (error) {
          blockJournal(error, generation);
          throw new UploadProtocolError(false);
        }
      }

      actorId = await currentOwner(generation);
      try {
        await sendCompletion(item, actorId);
        finishCompletion(item, generation);
        return;
      } catch (error) {
        if (!isObjectMissing(error)) throw error;
      }

      actorId = await currentOwner(generation);
      setStage('直接傳送原始照片…');
      await putUploadFile(file, prepared.contentType, authorization);
      if (!isActive(generation)) return;

      actorId = await currentOwner(generation);
      setStage('確認版本建立結果…');
      await sendCompletion(item, actorId);
      finishCompletion(item, generation);
    } catch (error) {
      if (!isActive(generation)) return;
      if (error instanceof Error && error.message.startsWith('請先選擇'))
        setNotice(error.message);
      else if (error instanceof Error && error.message.startsWith('請先確認'))
        setNotice(error.message);
      else if (error instanceof Error && error.message.startsWith('版本說明'))
        setNotice(error.message);
      else setNotice(messageFor(error));
    } finally {
      if (isActive(generation)) {
        busyRef.current = false;
        setBusy(false);
        setStage('');
      }
    }
  }

  async function cancelCurrent() {
    if (busyRef.current || journalState !== 'ready' || !scopeMatchesCurrent)
      return;
    const initial = entriesRef.current[0];
    if (!initial || entriesRef.current.length !== 1) return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    const generation = generationRef.current;

    try {
      let item = initial;
      let actorId = await currentOwner(generation);
      try {
        const recovery = await getRecovery(item);
        if (!isActive(generation)) return;
        if (
          recovery.initRequestId !== item.initBody.requestId ||
          !targetMatches(recovery.target, item, photoId) ||
          (item.uploadSessionId &&
            item.uploadSessionId !== recovery.uploadSession.id)
        )
          throw new UploadProtocolError(false);
        item = {
          ...item,
          uploadSessionId: recovery.uploadSession.id,
          authorizeBody: recovery.authorizationRequestId
            ? { requestId: recovery.authorizationRequestId }
            : item.authorizeBody,
        };
        saveEntry(item, generation);
        if (
          recovery.uploadSession.status === 'completed' ||
          recovery.uploadSession.status === 'needs_review'
        ) {
          if (
            recovery.uploadSession.status === 'completed' &&
            item.completeBody
          ) {
            actorId = await currentOwner(generation);
            await sendCompletion(item, actorId);
            finishCompletion(item, generation);
          } else {
            setNotice(
              '伺服器已確認此工作完成或需要檢查，不能取消；請保留工作記錄。',
            );
          }
          return;
        }
        if (recovery.uploadSession.status === 'cancelled') {
          removeEntry(item.id, generation);
          setNotice('伺服器已確認工作已取消。本機記錄已清除。');
          return;
        }
        if (recovery.uploadSession.status === 'expired') {
          setNotice('伺服器已確認工作逾期。請保留記錄並由管理者檢查。');
          return;
        }
      } catch (error) {
        if (
          error instanceof UploadRequestError &&
          error.status === 404 &&
          item.uploadSessionId === null
        ) {
          removeEntry(item.id, generation);
          setNotice('伺服器確認尚未建立上傳工作，本機操作記錄已清除。');
          setConfirmCancel(false);
          return;
        }
        throw error;
      }

      if (!item.uploadSessionId) throw new UploadProtocolError(false);
      const uploadSessionId = item.uploadSessionId;
      if (!item.cancelBody) {
        item = { ...item, cancelBody: { requestId: crypto.randomUUID() } };
        saveEntry(item, generation);
      }
      const cancelBody = item.cancelBody;
      if (!cancelBody) throw new UploadProtocolError(false);
      actorId = await currentOwner(generation);
      const cancelled = await cancelUpload(
        uploadSessionId,
        cancelBody,
        actorId,
      );
      if (!isActive(generation)) return;
      const result = cancelResultSchema.parse({ uploadSession: cancelled });
      if (result.uploadSession.id !== uploadSessionId)
        throw new UploadProtocolError(false);
      if (result.uploadSession.status === 'cancelled') {
        removeEntry(item.id, generation);
        setConfirmCancel(false);
        setNotice(
          '伺服器已確認取消並完成原工作保護。重新上傳前，請再選擇原始照片建立新版本工作。',
        );
        return;
      }
      if (result.uploadSession.status === 'completed' && item.completeBody) {
        actorId = await currentOwner(generation);
        await sendCompletion(item, actorId);
        finishCompletion(item, generation);
        return;
      }
      if (result.uploadSession.status === 'expired') {
        setNotice('伺服器已確認工作逾期。請保留記錄並由管理者檢查。');
        return;
      }
      setNotice(
        '伺服器未確認取消完成。原工作記錄保留，請稍後使用相同操作重試。',
      );
    } catch (error) {
      if (isActive(generation)) setNotice(messageFor(error));
    } finally {
      if (isActive(generation)) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  const disabled =
    capability.status !== 'ready' ||
    journalState !== 'ready' ||
    !scopeMatchesCurrent ||
    busy ||
    entries.length > 1;

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 max-w-full rounded-lg border border-stone-300 bg-white p-3 text-stone-900 sm:p-4"
      data-photo-version-upload-panel
    >
      <h2 id={titleId} className="text-base font-semibold">
        建立照片版本
      </h2>
      <p className="mt-1 break-all text-sm text-stone-700">
        目前版本見證：修訂 {current.revision} · {current.versionId}
      </p>

      {capability.status === 'loading' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在確認版本上傳功能…
        </p>
      )}
      {capability.status === 'disabled' && (
        <p className="mt-3 rounded-md bg-stone-100 p-3 text-sm text-stone-700">
          版本上傳目前未開放。
        </p>
      )}
      {capability.status === 'unavailable' && (
        <p
          className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
          role="status"
        >
          {capability.message}
        </p>
      )}
      {journalState === 'loading' && capability.status === 'ready' && (
        <p className="mt-3 text-sm text-stone-600" role="status">
          正在確認本機工作記錄…
        </p>
      )}
      {journalState === 'blocked' && journalIssue && (
        <p
          className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
          role="alert"
        >
          {journalIssue}
        </p>
      )}

      {capability.status === 'ready' && journalState === 'ready' && (
        <>
          <p className="mt-3 rounded-md bg-stone-100 p-3 text-sm leading-6 text-stone-700">
            {versioningMode === 'off'
              ? '此專案模式只允許明確確認的「取代目前版本」。舊版本與原始檔會保留；完成後不會自動切換目前版本。'
              : '此模式允許手動新增修訂版本。系統不會依檔名自動判斷版本，也不會自動切換目前版本。'}
          </p>

          {entries.length > 1 && (
            <p
              className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
              role="alert"
            >
              這張照片有多筆未解決的本機工作記錄。為避免混用不同操作，本面板已停止新請求；請交由管理者逐筆檢查。
            </p>
          )}

          {activeItem && (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
              <h3 className="font-semibold">接續已保存的版本工作</h3>
              <dl className="mt-2 grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-stone-600">原始檔</dt>
                <dd className="min-w-0 break-all">
                  {activeItem.initBody.originalFilename}
                </dd>
                <dt className="text-stone-600">建立時的版本見證</dt>
                <dd className="min-w-0 break-all">
                  修訂 {activeItem.initBody.expectedRevision} ·{' '}
                  {activeItem.initBody.expectedCurrentVersionId}
                </dd>
                <dt className="text-stone-600">說明</dt>
                <dd className="min-w-0 break-words">
                  {activeItem.initBody.changeNote || '未填寫'}
                </dd>
                <dt className="text-stone-600">標籤</dt>
                <dd className="min-w-0 break-words">
                  {activeItem.initBody.labels.join('、') || '未填寫'}
                </dd>
              </dl>
              <p className="mt-2 text-sm text-stone-700">
                {prepared
                  ? '原檔已重新核對，可接續同一工作。'
                  : '重新載入後需重新選擇原始檔；系統會比對大小、格式、雜湊與尺寸。'}
              </p>
            </div>
          )}

          <div className="mt-4 grid min-w-0 gap-3">
            <div>
              <label
                htmlFor={fileLabelId}
                className="block text-sm font-medium text-stone-900"
              >
                原始照片
              </label>
              <input
                id={fileLabelId}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={disabled}
                onChange={(event) => void selectFile(event)}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white p-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-stone-100"
              />
            </div>

            {!activeItem && (
              <>
                <div>
                  <label
                    htmlFor={changeTypeId}
                    className="block text-sm font-medium"
                  >
                    版本操作
                  </label>
                  <select
                    id={changeTypeId}
                    value={changeType}
                    disabled={disabled || versioningMode === 'off'}
                    onChange={(event) => {
                      setSelectedChangeType(
                        event.currentTarget.value === 'replace_current'
                          ? 'replace_current'
                          : 'new_retouch',
                      );
                      setConfirmReplace(false);
                    }}
                    className="mt-1 block min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base disabled:bg-stone-100"
                  >
                    <option value="new_retouch">新增修圖版本</option>
                    <option value="replace_current">指定取代目前版本</option>
                  </select>
                  <p className="mt-1 text-sm text-stone-600">
                    兩種操作都保留歷史版本；處理完成後仍需明確切換目前版本。
                  </p>
                  <label htmlFor={noteId} className="block text-sm font-medium">
                    版本說明
                  </label>
                  <textarea
                    id={noteId}
                    value={changeNote}
                    onChange={(event) =>
                      setChangeNote(event.currentTarget.value)
                    }
                    maxLength={4000}
                    rows={3}
                    disabled={disabled}
                    className="mt-1 block min-h-20 w-full min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-stone-100"
                  />
                </div>
                <div>
                  <label
                    htmlFor={labelsId}
                    className="block text-sm font-medium"
                  >
                    標籤（每行或逗號分隔，最多 16 個）
                  </label>
                  <textarea
                    id={labelsId}
                    value={labelsText}
                    onChange={(event) =>
                      setLabelsText(event.currentTarget.value)
                    }
                    maxLength={1200}
                    rows={2}
                    disabled={disabled}
                    className="mt-1 block min-h-16 w-full min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-stone-100"
                  />
                </div>
                {changeType === 'replace_current' && (
                  <label className="flex min-w-0 items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <input
                      type="checkbox"
                      checked={confirmReplace}
                      onChange={(event) =>
                        setConfirmReplace(event.currentTarget.checked)
                      }
                      disabled={disabled}
                      className="mt-1 size-4 shrink-0 accent-amber-800"
                    />
                    <span>
                      我確認這是取代目前照片版本的明確操作，並了解舊版本會保留且不會自動成為目前版本。
                    </span>
                  </label>
                )}
              </>
            )}
          </div>

          {prepared && (
            <div className="mt-3 flex min-w-0 items-center gap-3 rounded-md bg-stone-50 p-2">
              {/* This is a short-lived local object URL; it is never sent to an image optimizer. */}
              <img
                src={prepared.previewUrl}
                alt="所選照片的本機預覽"
                className="size-16 shrink-0 rounded object-cover"
              />
              <p className="min-w-0 break-words text-sm text-stone-700">
                {file?.name} · {file?.size.toLocaleString()} bytes ·{' '}
                {prepared.width} × {prepared.height}
              </p>
            </div>
          )}

          <div className="mt-4 flex min-w-0 flex-wrap gap-2">
            <button
              type="button"
              disabled={
                disabled ||
                !file ||
                !prepared ||
                (changeType === 'replace_current' &&
                  !activeItem &&
                  !confirmReplace)
              }
              onClick={() => void runUpload()}
              className="min-h-11 min-w-0 rounded-md bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {activeItem ? '接續同一版本工作' : '建立版本工作並上傳'}
            </button>
            {activeItem && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setConfirmCancel((value) => !value)}
                className="min-h-11 min-w-0 rounded-md border border-stone-500 px-4 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmCancel ? '收起取消選項' : '取消原工作'}
              </button>
            )}
          </div>

          {confirmCancel && activeItem && (
            <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-950">
              <p>
                取消會先向伺服器確認原工作，並依原本工作金鑰執行保護。若伺服器已收到照片，系統會保留工作供檢查。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void cancelCurrent()}
                  className="min-h-11 rounded-md bg-red-800 px-4 py-2 font-semibold text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:opacity-50"
                >
                  確認取消原工作
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmCancel(false)}
                  className="min-h-11 rounded-md border border-stone-500 px-4 py-2 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-50"
                >
                  保留原工作
                </button>
              </div>
            </div>
          )}

          <p className="mt-3 text-xs leading-5 text-stone-600">
            本機只保存固定目標、請求識別碼及照片指紋，不保存照片檔、預覽內容或短效上傳授權。
          </p>
        </>
      )}

      {(stage || notice) && (
        <p
          className="mt-3 rounded-md bg-sky-50 p-3 text-sm leading-6 text-sky-950"
          role="status"
          aria-live="polite"
        >
          {stage || notice}
        </p>
      )}
    </section>
  );
}
