import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';
import './owner-history.css';
import {
  ownerHistoryCapabilitiesSchema,
  ownerHistoryEventSchema,
  ownerHistoryFiltersSchema,
  ownerHistoryPageSchema,
  ownerHistoryQuerySchema,
  type OwnerHistoryEvent,
  type OwnerHistoryFilters,
} from '../../../packages/contracts/src/owner-history';

const meSchema = z.object({ actor: z.object({ id: z.uuid() }) });
const errorSchema = z.object({ error: z.object({ code: z.string().min(1) }) });
const actorTypeOptions = ['system', 'user', 'guest'] as const;
const EMPTY = {
  projectId: '',
  albumId: '',
  photoId: '',
  versionId: '',
  inviteId: '',
  actorTypes: [...actorTypeOptions],
  actorId: '',
  action: '',
  from: '',
  to: '',
};
type Draft = typeof EMPTY;
type ActorType = (typeof actorTypeOptions)[number];
type Capability = 'loading' | 'enabled' | 'disabled' | 'error';
type State = {
  status: 'loading' | 'ready' | 'error' | 'suspended';
  items: OwnerHistoryEvent[];
  snapshotToken: string | null;
  nextCursor: string | null;
  loadingMore: boolean;
  stale: boolean;
  error: string;
};

class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const actionLabels: Record<string, string> = {
  'project.deleted': '刪除專案',
  'album.deletion_started': '開始清理相簿儲存空間',
  'album.deleted': '完成相簿清理',
  'storage.asset_reclaimed': '釋放照片儲存空間',
  'storage.reclaim_failed': '照片清理失敗，等待重試',
  'gallery.viewed': '檢視照片',
  'version_approval.requested': '建立版本確認請求',
  'version_approval.confirmed': '客戶確認照片版本',
  'delivery.published': '交付固定版本成品',
  'delivery.revoked': '撤回成品交付',
  'delivery.download_requested': '客戶要求下載成品',
  'delivery.download_generated': '成品已準備下載',
  'delivery.zip_created': '建立批次 ZIP 下載',
  'delivery.zip_download_requested': '客戶要求下載批次 ZIP',
  'delivery.zip_download_generated': '批次 ZIP 已準備下載',
  'project.matching_rules_changed': '調整照片比對規則',
  'selection.added': '新增挑片',
  'selection.removed': '移除挑片',
  'selection.version_changed': '變更挑片版本',
  'selection.submitted': '提交挑片',
  'selection.reopened': '重開挑片輪次',
  'selection.round_initialized': '建立挑片輪次',
  'selection.policy_changed': '變更挑片規則',
  'selection.policy_configuration_changed': '調整挑片規則設定',
  'album.retention_settings_changed': '調整相簿保留設定',
  'invite.expiry_mode_recorded': '設定分享期限方式',
  'shared_selection.added': '新增共用挑片',
  'shared_selection.removed': '移除共用挑片',
  'shared_selection.version_changed': '變更共用挑片版本',
  'shared_selection.submitted': '提交共用挑片',
  'rating.set': '設定評分',
  'rating.cleared': '清除評分',
  'photo.pinned': '置頂照片',
  'photo.unpinned': '取消照片置頂',
  'favorite.added': '加入收藏',
  'favorite.removed': '移除收藏',
  'tag.added': '新增標籤',
  'tag.removed': '移除標籤',
  'comment.create': '新增留言',
  'comment.reply': '回覆留言',
  'comment.edit': '編輯留言',
  'comment.delete': '刪除留言',
  'comment.resolve': '標記留言完成',
  'comment.reopen': '重新開啟留言',
  'owner.comment_reply_created': '管理者回覆留言',
  'owner.comment_reply_edited': '編輯管理者回覆',
  'owner.comment_reply_deleted': '刪除管理者回覆',
  'owner.comment_processing_changed': '更新留言處理狀態',
  'annotation.created': '新增標註',
  'annotation.updated': '更新標註',
  'annotation.deleted': '刪除標註',
  'annotation.resolved': '標記標註完成',
  'annotation.reopened': '重新開啟標註',
  'owner.annotation_created': '管理者新增標註',
  'owner.annotation_updated': '管理者更新標註',
  'owner.annotation_deleted': '管理者刪除標註',
  'owner.annotation_resolved': '管理者完成標註',
  'owner.annotation_reopened': '管理者重新開啟標註',
  'owner.annotation_processing_changed': '更新標註處理狀態',
  'share.created': '建立邀請',
  'share.revoked': '撤銷邀請',
  'guest.session_created': '建立訪客工作階段',
  'guest.session_revoked': '撤銷訪客工作階段',
  'upload.reserved': '預留上傳空間',
  'upload.authorized': '授權上傳',
  'upload.completed': '完成上傳',
  'upload.cancelled': '取消上傳',
  'processing.enqueued': '排入影像處理',
  'processing.succeeded': '完成影像處理',
  'processing.failed': '影像處理失敗',
  'download.generated': '產生匯出檔案',
  'download.requested': '提出匯出要求',
  'owner_history.export_started': '開始匯出活動紀錄',
  'owner_history.export_completed': '完成匯出活動紀錄',
};
const actorLabels: Record<OwnerHistoryEvent['actor']['type'], string> = {
  user: '管理者',
  guest: '訪客',
  system: '系統',
};
const utcFormatter = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const compactUtcFormatter = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'UTC',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function actionLabel(event: OwnerHistoryEvent) {
  if (
    (event.action === 'download.requested' ||
      event.action === 'download.generated') &&
    event.details.status === 'available' &&
    event.details.after
  ) {
    const kind = event.details.after.assetKind;
    if (kind === 'preview' || kind === 'original') {
      if (event.action === 'download.requested')
        return kind === 'preview'
          ? '提出預覽檔下載要求'
          : '提出原始照片下載要求';
      return kind === 'preview' ? '準備預覽檔供下載' : '準備原始照片供下載';
    }
  }
  return actionLabels[event.action] ?? '其他操作';
}
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
const filterFields = [
  ['projectId', '專案 ID'],
  ['albumId', '相簿 ID'],
  ['photoId', '照片 ID'],
  ['versionId', '版本 ID'],
  ['inviteId', '邀請 ID'],
  ['actorId', '操作者 ID'],
  ['action', '操作名稱'],
] as const;
type TextFilterField = (typeof filterFields)[number][0];
type TextDraftField = TextFilterField | 'from' | 'to';

function hasCustomFilters(draft: Draft) {
  return (
    draft.actorTypes.length !== actorTypeOptions.length ||
    filterFields.some(([field]) => Boolean(draft[field])) ||
    Boolean(draft.from || draft.to)
  );
}

function emptyState(status: State['status'], error = ''): State {
  return {
    status,
    items: [],
    snapshotToken: null,
    nextCursor: null,
    loadingMore: false,
    stale: false,
    error,
  };
}
function eventTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : utcFormatter.format(date) + ' UTC';
}
function apiError(status: number, body: unknown) {
  const parsed = errorSchema.safeParse(body);
  return new ApiError(
    status,
    parsed.success ? parsed.data.error.code : 'SERVICE_UNAVAILABLE',
  );
}
function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
function isDisabled(error: unknown) {
  return (
    error instanceof ApiError &&
    /HISTORY_DISABLED|OWNER_HISTORY_DISABLED/u.test(error.code)
  );
}
function isIdentity(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.statusCode === 401 ||
      error.statusCode === 403 ||
      /AUTH_REQUIRED|OWNER_REQUIRED|OWNER_CHANGED|EXPECTED_ACTOR/u.test(
        error.code,
      ))
  );
}
function isStale(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.statusCode === 409 || /SNAPSHOT|CURSOR|STALE/u.test(error.code))
  );
}
function errorText(error: unknown, exporting = false) {
  if (error instanceof Error && error.message === 'EXPORT_TOO_LARGE') {
    return '匯出檔超過 64 MiB 上限，沒有建立下載檔。請縮小時間範圍或增加篩選條件。';
  }
  if (isStale(error))
    return '活動快照已過期或範圍已變更。請按「重新整理紀錄」載入新快照後再試。';
  if (isIdentity(error))
    return '管理者登入身分已變更或失效。活動資料已清除；請重新登入後再載入。';
  if (error instanceof ApiError && error.statusCode === 400)
    return '查詢條件無效或快照已失效。請檢查條件，或重新整理紀錄。';
  return exporting
    ? '匯出尚未完成，沒有建立下載檔。請重新整理紀錄後再試。'
    : '無法載入活動紀錄。請重新整理紀錄後再試。';
}
function parseDraft(draft: Draft): OwnerHistoryFilters {
  const raw: Record<string, unknown> = { actorTypes: draft.actorTypes };
  for (const [field] of filterFields) {
    const value = draft[field].trim();
    if (value) raw[field] = value;
  }
  for (const field of ['from', 'to'] as const) {
    if (draft[field]) {
      const date = new Date(draft[field]);
      if (Number.isNaN(date.getTime())) throw new Error('INVALID_LOCAL_TIME');
      raw[field] = date.toISOString();
    }
  }
  return ownerHistoryFiltersSchema.parse(raw);
}
function queryString(filters: OwnerHistoryFilters, cursor: string | null) {
  const query = ownerHistoryQuerySchema.parse({
    ...filters,
    ...(cursor ? { cursor } : {}),
  });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') params.set(key, value);
    else if (Array.isArray(value)) {
      if (!value.length) params.append(key, '');
      else for (const item of value) params.append(key, item);
    }
  }
  return params.toString();
}
async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
async function verifyOwner(ownerId: string, signal: AbortSignal) {
  const response = await fetch('/api/v1/me', {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'X-Kino-Expected-Actor': ownerId },
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) throw apiError(response.status, body);
  const me = meSchema.safeParse(body);
  if (!me.success) throw new ApiError(503, 'INVALID_OWNER_RESPONSE');
  if (me.data.actor.id !== ownerId) throw new ApiError(409, 'OWNER_CHANGED');
}
async function getPage(
  workspaceId: string,
  ownerId: string,
  filters: OwnerHistoryFilters,
  cursor: string | null,
  signal: AbortSignal,
) {
  const query = queryString(filters, cursor);
  const response = await fetch(
    '/api/v1/workspaces/' +
      encodeURIComponent(workspaceId) +
      '/history' +
      (query ? '?' + query : ''),
    {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'X-Kino-Expected-Actor': ownerId },
      signal,
    },
  );
  const body = await readJson(response);
  if (!response.ok) throw apiError(response.status, body);
  const page = ownerHistoryPageSchema.safeParse(body);
  if (!page.success) throw new ApiError(503, 'INVALID_HISTORY_RESPONSE');
  if (page.data.ownerId !== ownerId || page.data.workspaceId !== workspaceId) {
    throw new ApiError(409, 'OWNER_HISTORY_SCOPE_CHANGED');
  }
  return page.data;
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportBlob(
  response: Response,
  format: 'csv' | 'json',
  signal: AbortSignal,
  workspaceId: string,
) {
  const mime = format === 'csv' ? 'text/csv' : 'application/json';
  if (
    (response.headers.get('Content-Type') ?? '')
      .split(';', 1)[0]
      ?.trim()
      .toLowerCase() !== mime
  ) {
    throw new ApiError(503, 'INVALID_EXPORT_CONTENT_TYPE');
  }
  const generationId = response.headers.get('X-Kino-History-Generation');
  if (!generationId || !z.uuid().safeParse(generationId).success) {
    throw new ApiError(503, 'INVALID_EXPORT_GENERATION');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(503, 'INVALID_EXPORT_STREAM');
  const parts: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_EXPORT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('EXPORT_TOO_LARGE');
      }
      const part = new ArrayBuffer(chunk.value.byteLength);
      new Uint8Array(part).set(chunk.value);
      parts.push(part);
    }
  } finally {
    reader.releaseLock();
  }
  const completeBlob = new Blob(parts, { type: mime + '; charset=utf-8' });
  await validateExport(completeBlob, format, workspaceId, generationId);
  return completeBlob;
}

async function validateExport(
  blob: Blob,
  format: 'csv' | 'json',
  workspaceId: string,
  generationId: string,
) {
  if (format === 'csv') return;
  let decoded: unknown;
  try {
    decoded = JSON.parse(await blob.text());
  } catch {
    throw new ApiError(503, 'INVALID_EXPORT_JSON');
  }
  const envelope = z
    .object({
      version: z.literal(1),
      generationId: z.uuid(),
      format: z.literal('json'),
      snapshotRowId: z.string().regex(/^(0|[1-9][0-9]{0,18})$/),
      filters: ownerHistoryFiltersSchema,
      workspaceId: z.uuid(),
      events: z.array(ownerHistoryEventSchema),
      count: z.number().int().nonnegative(),
      complete: z.literal(true),
    })
    .strict()
    .safeParse(decoded);
  if (
    !envelope.success ||
    envelope.data.workspaceId !== workspaceId ||
    envelope.data.generationId !== generationId ||
    envelope.data.count !== envelope.data.events.length
  ) {
    throw new ApiError(503, 'INVALID_EXPORT_ENVELOPE');
  }
}

function EventDetails({ event }: { event: OwnerHistoryEvent }) {
  const known = Object.hasOwn(actionLabels, event.action);
  const ids: readonly [string, string | null][] = [
    ['工作空間', event.workspaceId],
    ['專案', event.projectId],
    ['相簿', event.albumId],
    ['照片', event.photoId],
    ['版本', event.versionId],
    ['邀請', event.inviteId],
  ];
  return (
    <details className="history-timeline__details">
      <summary
        className="cursor-pointer text-xs font-medium text-stone-700"
        aria-label={`查看${actionLabel(event)}詳細資料`}
      >
        詳情
      </summary>
      <dl className="mt-3 grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="font-semibold text-stone-600">操作代碼</dt>
          <dd className="break-all">{event.action}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-600">事件 ID</dt>
          <dd className="break-all">{event.eventId}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-600">操作者 ID</dt>
          <dd className="break-all">{event.actor.id ?? '未提供'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-600">操作者類型</dt>
          <dd>{event.actor.type}</dd>
        </div>
        {ids.map(([label, value]) => (
          <div className="min-w-0" key={label}>
            <dt className="font-semibold text-stone-600">{label} ID</dt>
            <dd className="break-all">{value ?? '無'}</dd>
          </div>
        ))}
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-semibold text-stone-600">相關邀請 ID</dt>
          <dd className="break-all">
            {event.relatedInviteIds.length
              ? event.relatedInviteIds.join(', ')
              : '無'}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-600">Owner 工作階段 ID</dt>
          <dd className="break-all">{event.sessionId ?? '無'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-stone-600">Guest 工作階段 ID</dt>
          <dd className="break-all">{event.guestSessionId ?? '無'}</dd>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <dt className="font-semibold text-stone-600">Request ID</dt>
          <dd className="break-all">{event.requestId ?? '無'}</dd>
        </div>
      </dl>
      <div className="mt-3 min-w-0">
        <h4 className="text-xs font-semibold text-stone-700">事件明細</h4>
        {!known || event.details.status === 'omitted' ? (
          <p className="mt-1 break-words text-xs text-stone-600">
            此操作的前後資料已省略。
          </p>
        ) : event.details.status === 'invalid' ? (
          <p className="mt-1 break-words text-xs text-stone-600">
            事件明細格式無法安全呈現，已省略。
          </p>
        ) : (
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-xs text-stone-800">
            {JSON.stringify(
              { before: event.details.before, after: event.details.after },
              null,
              2,
            )}
          </pre>
        )}
      </div>
    </details>
  );
}

function EventCard({ event }: { event: OwnerHistoryEvent }) {
  const actor = event.actor.label ?? actorLabels[event.actor.type];
  const label = actionLabel(event);
  const time = eventTime(event.occurredAt);
  return (
    <li className="history-timeline__event">
      <h3 className="history-timeline__action" title={label}>
        {label}
      </h3>
      <span
        className="history-timeline__actor"
        title={`${actorLabels[event.actor.type]}：${actor}`}
        aria-label={`操作者：${actorLabels[event.actor.type]} ${actor}`}
      >
        {actor}
      </span>
      <time
        dateTime={event.occurredAt}
        title={time}
        aria-label={time}
        className="history-timeline__time"
      >
        {compactUtcFormatter.format(new Date(event.occurredAt))}
      </time>
      <EventDetails event={event} />
    </li>
  );
}

function TextFilter({
  label,
  field,
  value,
  update,
  placeholder,
}: {
  label: string;
  field: TextFilterField;
  value: string;
  update: (field: TextFilterField, value: string) => void;
  placeholder?: string | undefined;
}) {
  return (
    <label className="min-w-0 text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      <input
        value={value}
        onChange={(event) => update(field, event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="min-h-11 w-full min-w-0 rounded border border-stone-300 px-3 py-2 text-sm"
      />
    </label>
  );
}

export function OwnerWorkspaceHistory({
  workspaceId,
  ownerId,
}: {
  workspaceId: string;
  ownerId: string;
}) {
  const validWorkspace = useMemo(
    () => z.uuid().safeParse(workspaceId).success,
    [workspaceId],
  );
  const validOwner = useMemo(
    () => z.uuid().safeParse(ownerId).success,
    [ownerId],
  );
  const [capability, setCapability] = useState<Capability>('loading');
  const capRef = useRef<Capability>('loading');
  const initiallySuspended =
    typeof document !== 'undefined' &&
    (document.hidden || !document.hasFocus());
  const [isSuspended, setIsSuspended] = useState(initiallySuspended);
  const [history, setHistory] = useState<State>(() =>
    emptyState(initiallySuspended ? 'suspended' : 'loading'),
  );
  const stateRef = useRef(history);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [appliedDraft, setAppliedDraft] = useState<Draft>(EMPTY);
  const [filterError, setFilterError] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [exportError, setExportError] = useState('');
  const controllers = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const suspended = useRef(initiallySuspended);
  const activeFilters = useRef<OwnerHistoryFilters>({});
  const consumedCursors = useRef(new Set<string>());

  const write = useCallback((next: State) => {
    stateRef.current = next;
    setHistory(next);
  }, []);
  const abortAll = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
    setExporting(null);
  }, []);
  const makeController = useCallback(() => {
    const controller = new AbortController();
    controllers.current.add(controller);
    return controller;
  }, []);
  const release = useCallback((controller: AbortController) => {
    controllers.current.delete(controller);
  }, []);
  const current = useCallback((expected: number) => {
    return generation.current === expected && !suspended.current;
  }, []);

  const loadSnapshot = useCallback(
    (nextFilters: OwnerHistoryFilters) => {
      if (
        capRef.current !== 'enabled' ||
        suspended.current ||
        !validWorkspace ||
        !validOwner
      )
        return;
      const expected = generation.current + 1;
      generation.current = expected;
      abortAll();
      activeFilters.current = nextFilters;
      consumedCursors.current = new Set();
      setExportError('');
      write(emptyState('loading'));
      void (async () => {
        const controller = makeController();
        try {
          await verifyOwner(ownerId, controller.signal);
          if (!current(expected)) return;
          const page = await getPage(
            workspaceId,
            ownerId,
            nextFilters,
            null,
            controller.signal,
          );
          if (!current(expected)) return;
          await verifyOwner(ownerId, controller.signal);
          if (!current(expected)) return;
          write({
            status: 'ready',
            items: page.items,
            snapshotToken: page.snapshotToken,
            nextCursor: page.nextCursor,
            loadingMore: false,
            stale: false,
            error: '',
          });
        } catch (error) {
          if (!current(expected) || isAbort(error)) return;
          if (isDisabled(error)) {
            capRef.current = 'disabled';
            setCapability('disabled');
            write(emptyState('error'));
          } else {
            write(emptyState('error', errorText(error)));
          }
        } finally {
          release(controller);
        }
      })();
    },
    [
      abortAll,
      current,
      makeController,
      ownerId,
      release,
      validOwner,
      validWorkspace,
      workspaceId,
      write,
    ],
  );

  useEffect(() => {
    if (!validWorkspace || !validOwner) return;
    let disposed = false;
    // Capability data is not private history, so the request may finish while
    // blurred and let the next focus load the private history.
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/v1/owner-history/capabilities', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'X-Kino-Expected-Actor': ownerId,
          },
          signal: controller.signal,
        });
        const body = await readJson(response);
        if (!response.ok) throw apiError(response.status, body);
        const parsed = ownerHistoryCapabilitiesSchema.safeParse(body);
        if (!parsed.success)
          throw new ApiError(503, 'INVALID_CAPABILITY_RESPONSE');
        if (disposed) return;
        capRef.current = parsed.data.enabled ? 'enabled' : 'disabled';
        setCapability(capRef.current);
        if (parsed.data.enabled) loadSnapshot(activeFilters.current);
      } catch (error) {
        if (disposed || isAbort(error)) return;
        capRef.current = 'error';
        setCapability('error');
        write(emptyState('error'));
      }
    })();
    return () => {
      disposed = true;
      generation.current += 1;
      abortAll();
      controller.abort();
    };
  }, [
    abortAll,
    loadSnapshot,
    ownerId,
    validOwner,
    validWorkspace,
    workspaceId,
    write,
  ]);

  useEffect(() => {
    const hide = () => {
      if (suspended.current) return;
      suspended.current = true;
      setIsSuspended(true);
      generation.current += 1;
      abortAll();
      write(emptyState('suspended'));
      setExportError('');
    };
    const show = () => {
      if (
        !suspended.current ||
        document.hidden ||
        document.visibilityState === 'hidden'
      )
        return;
      suspended.current = false;
      setIsSuspended(false);
      loadSnapshot(activeFilters.current);
    };
    const visibility = () => {
      if (document.hidden || document.visibilityState === 'hidden') hide();
      else show();
    };
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    if (document.hidden || document.visibilityState === 'hidden') hide();
    return () => {
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [abortAll, loadSnapshot, write]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(appliedDraft);
  const canReset = hasCustomFilters(draft) || hasCustomFilters(appliedDraft);
  const canExport =
    history.status === 'ready' &&
    !!history.snapshotToken &&
    !history.loadingMore &&
    !history.stale &&
    !dirty &&
    exporting === null &&
    !isSuspended;

  function update(field: TextDraftField, value: string) {
    setDraft((old) => ({ ...old, [field]: value }));
    setFilterError('');
  }
  function toggleActorType(type: ActorType) {
    const selected = new Set(draft.actorTypes);
    if (selected.has(type)) selected.delete(type);
    else selected.add(type);
    const nextActorTypes = actorTypeOptions.filter((candidate) =>
      selected.has(candidate),
    );
    setDraft((old) => ({ ...old, actorTypes: nextActorTypes }));
    setAppliedDraft((old) => ({ ...old, actorTypes: nextActorTypes }));
    setFilterError('');
    loadSnapshot({ ...activeFilters.current, actorTypes: nextActorTypes });
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const next = parseDraft(draft);
      setAppliedDraft({ ...draft });
      setFilterError('');
      loadSnapshot(next);
    } catch (error) {
      setFilterError(
        error instanceof Error && error.message === 'INVALID_LOCAL_TIME'
          ? '請輸入有效的起訖時間。'
          : '篩選條件無效，請確認 ID、操作名稱與時間範圍。',
      );
    }
  }
  function reset() {
    setDraft(EMPTY);
    setAppliedDraft(EMPTY);
    setFilterError('');
    loadSnapshot({});
  }
  function refresh() {
    if (history.status !== 'loading' && history.status !== 'suspended') {
      loadSnapshot(activeFilters.current);
    }
  }

  async function loadMore() {
    const start = stateRef.current;
    const cursor = start.nextCursor;
    if (
      start.status !== 'ready' ||
      !cursor ||
      start.loadingMore ||
      start.stale ||
      suspended.current
    )
      return;
    const expected = generation.current;
    write({ ...start, loadingMore: true, error: '' });
    const controller = makeController();
    try {
      await verifyOwner(ownerId, controller.signal);
      if (!current(expected)) return;
      const page = await getPage(
        workspaceId,
        ownerId,
        activeFilters.current,
        cursor,
        controller.signal,
      );
      if (!current(expected)) return;
      await verifyOwner(ownerId, controller.signal);
      if (!current(expected)) return;
      if (page.snapshotToken !== stateRef.current.snapshotToken) {
        throw new ApiError(409, 'OWNER_HISTORY_SNAPSHOT_CHANGED');
      }
      if (consumedCursors.current.has(cursor))
        throw new ApiError(409, 'OWNER_HISTORY_CURSOR_REPEATED');
      const ids = new Set(stateRef.current.items.map((item) => item.eventId));
      if (page.items.some((item) => ids.has(item.eventId)))
        throw new ApiError(409, 'OWNER_HISTORY_PAGE_OVERLAP');
      consumedCursors.current.add(cursor);
      if (page.nextCursor && consumedCursors.current.has(page.nextCursor)) {
        throw new ApiError(409, 'OWNER_HISTORY_CURSOR_REPEATED');
      }
      const latest = stateRef.current;
      write({
        ...latest,
        items: [...latest.items, ...page.items],
        nextCursor: page.nextCursor,
        loadingMore: false,
        stale: false,
        error: '',
      });
    } catch (error) {
      if (!current(expected) || isAbort(error)) return;
      if (isDisabled(error)) {
        capRef.current = 'disabled';
        setCapability('disabled');
        write(emptyState('error'));
      } else if (isIdentity(error)) {
        write(emptyState('error', errorText(error)));
      } else {
        const latest = stateRef.current;
        const stale = isStale(error);
        write({
          ...latest,
          loadingMore: false,
          nextCursor: stale ? null : latest.nextCursor,
          stale,
          error: errorText(error),
        });
      }
    } finally {
      release(controller);
    }
  }

  async function exportHistory(format: 'csv' | 'json') {
    const start = stateRef.current;
    if (
      !canExport ||
      suspended.current ||
      !start.snapshotToken ||
      capRef.current !== 'enabled'
    )
      return;
    const expected = generation.current;
    const controller = makeController();
    setExporting(format);
    setExportError('');
    try {
      await verifyOwner(ownerId, controller.signal);
      if (!current(expected)) return;
      const response = await fetch(
        '/api/v1/workspaces/' +
          encodeURIComponent(workspaceId) +
          '/history/export',
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: format === 'csv' ? 'text/csv' : 'application/json',
            'Content-Type': 'application/json',
            'X-Kino-Expected-Actor': ownerId,
          },
          body: JSON.stringify({
            expectedOwnerId: ownerId,
            snapshotToken: start.snapshotToken,
            format,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw apiError(response.status, await readJson(response));
      const blob = await exportBlob(
        response,
        format,
        controller.signal,
        workspaceId,
      );
      if (!current(expected)) return;
      await verifyOwner(ownerId, controller.signal);
      if (!current(expected)) return;
      saveBlob(blob, 'history-workspace-' + workspaceId + '.' + format);
    } catch (error) {
      if (!current(expected) || isAbort(error)) return;
      if (isDisabled(error)) {
        capRef.current = 'disabled';
        setCapability('disabled');
        write(emptyState('error'));
      } else if (isIdentity(error)) {
        write(emptyState('error', errorText(error, true)));
      } else {
        if (isStale(error)) {
          write({
            ...stateRef.current,
            stale: true,
            error: errorText(error, true),
          });
        }
        setExportError(errorText(error, true));
      }
    } finally {
      release(controller);
      if (current(expected)) setExporting(null);
    }
  }

  if (!validWorkspace || !validOwner) {
    return (
      <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <h2 className="text-xl font-semibold">工作空間活動紀錄</h2>
        <p role="alert" className="mt-3 text-sm text-red-800">
          無法確認工作空間或管理者身分。
        </p>
      </section>
    );
  }
  if (capability === 'loading' || capability === 'disabled') return null;
  if (capability === 'error') {
    return (
      <section className="mt-8 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <h2 className="text-xl font-semibold">工作空間活動紀錄</h2>
        <p role="alert" className="mt-3 text-sm text-red-800">
          目前無法確認活動紀錄是否可用。
        </p>
      </section>
    );
  }

  return (
    <section
      className="owner-history"
      aria-labelledby="owner-history-title"
      data-testid="owner-workspace-history"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="min-w-0">
          <h2 id="owner-history-title" className="text-xl font-semibold">
            工作空間活動紀錄
          </h2>
          <p className="mt-2 break-words text-sm text-stone-600">
            看看誰瀏覽了照片、完成挑片，或更新了相簿。
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={
            history.status === 'loading' ||
            history.status === 'suspended' ||
            exporting !== null
          }
          className="min-h-11 shrink-0 rounded border border-stone-400 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <StudioIcon name="refresh" className="mr-2 inline-block h-4 w-4" />
          {history.status === 'loading' ? '載入中…' : '重新整理紀錄'}
        </button>
      </header>

      <form
        className="history-controls"
        onSubmit={apply}
        aria-label="活動紀錄篩選"
      >
        <fieldset
          disabled={history.status === 'suspended' || exporting !== null}
        >
          <div
            className="history-actor-filter"
            role="group"
            aria-label="操作者類型"
          >
            <span className="history-actor-filter__label">操作者</span>
            {actorTypeOptions.map((type) => (
              <label className="history-actor-filter__option" key={type}>
                <input
                  type="checkbox"
                  checked={draft.actorTypes.includes(type)}
                  onChange={() => toggleActorType(type)}
                />
                {actorLabels[type]}
              </label>
            ))}
          </div>
          <details className="history-filters">
            <summary>
              <StudioIcon name="settings" />
              其他篩選條件
            </summary>
            <div className="history-filters__body">
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="min-w-0 text-sm">
                  <span className="mb-1 block font-medium text-stone-700">
                    起始時間（本機時間）
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.from}
                    onChange={(e) => update('from', e.target.value)}
                    className="min-h-11 w-full min-w-0 rounded border border-stone-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="min-w-0 text-sm">
                  <span className="mb-1 block font-medium text-stone-700">
                    結束時間（不含，本機時間）
                  </span>
                  <input
                    type="datetime-local"
                    value={draft.to}
                    onChange={(e) => update('to', e.target.value)}
                    className="min-h-11 w-full min-w-0 rounded border border-stone-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <details className="history-advanced">
                <summary>
                  <StudioIcon name="settings" />
                  專案、照片與操作
                </summary>
                <p className="mt-2 text-xs text-stone-500">
                  需要查找特定照片或操作時，再填寫以下欄位。
                </p>
                <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filterFields.map(([field, label]) => (
                    <TextFilter
                      key={field}
                      label={label}
                      field={field}
                      value={draft[field]}
                      update={update}
                      placeholder={
                        field === 'action'
                          ? '例如 selection.submitted'
                          : undefined
                      }
                    />
                  ))}
                </div>
              </details>
              <p className="mt-3 text-xs text-stone-600">
                時間依此裝置的時區輸入，送出時會轉為
                UTC。時間範圍採起始包含、結束不包含。
              </p>
            </div>
          </details>
          {filterError && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {filterError}
            </p>
          )}
          <div className="history-filter-actions">
            <button
              type="submit"
              disabled={
                !dirty || history.status === 'suspended' || exporting !== null
              }
              className="min-h-11 rounded bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              套用其他條件
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={
                !canReset ||
                exporting !== null ||
                history.status === 'suspended'
              }
              className="min-h-11 rounded border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              清除條件並重新載入
            </button>
          </div>
        </fieldset>
      </form>

      <details className="history-export">
        <summary>
          <StudioIcon name="list" />
          匯出紀錄
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportHistory('csv')}
            disabled={!canExport}
            className="min-h-11 rounded border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting === 'csv' ? '準備 CSV…' : '匯出 CSV'}
          </button>
          <button
            type="button"
            onClick={() => void exportHistory('json')}
            disabled={!canExport}
            className="min-h-11 rounded border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting === 'json' ? '準備 JSON…' : '匯出 JSON'}
          </button>
          {dirty && (
            <p className="self-center text-xs text-amber-900">
              篩選條件尚未套用，匯出功能會在套用或清除後啟用。
            </p>
          )}
        </div>
      </details>
      <p className="history-caption">最新活動在最上方 · 時間以 UTC 顯示</p>
      {history.error && (
        <p role="alert" className="mt-4 break-words text-sm text-red-800">
          {history.error}
        </p>
      )}
      {exportError && (
        <p role="alert" className="mt-2 break-words text-sm text-red-800">
          {exportError}
        </p>
      )}
      {history.status === 'suspended' && (
        <p className="mt-4 text-sm text-stone-600">
          活動資料已清除；視窗返回後會重新驗證管理者身分。
        </p>
      )}
      {history.status === 'loading' && (
        <p className="mt-4 text-sm text-stone-600" role="status">
          正在載入活動紀錄…
        </p>
      )}
      {history.status === 'ready' && history.items.length === 0 && (
        <p
          className="mt-4 text-sm text-stone-600"
          data-testid="owner-history-empty"
        >
          此快照沒有符合條件的活動紀錄。
        </p>
      )}
      {history.items.length > 0 && (
        <ol className="history-timeline" data-testid="owner-history-items">
          {history.items.map((event) => (
            <EventCard key={event.eventId} event={event} />
          ))}
        </ol>
      )}
      {history.nextCursor && !history.stale && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={
              history.loadingMore ||
              history.status !== 'ready' ||
              exporting !== null
            }
            className="min-h-11 w-full max-w-sm rounded-md border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-100 disabled:cursor-wait disabled:opacity-60"
          >
            {history.loadingMore
              ? '載入中…'
              : history.error
                ? '重試載入下一頁'
                : '載入更多活動紀錄'}
          </button>
        </div>
      )}
    </section>
  );
}
