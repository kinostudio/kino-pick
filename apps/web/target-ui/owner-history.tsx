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
import { photoDisplayName } from './photo-filename';
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
  'owner.bootstrapped': '啟用攝影師帳號',
  'owner.signed_in': '登入管理工作台',
  'owner.session_revoked': '結束管理工作台登入',
  'owner.provider_linked': '綁定登入帳號',
  'owner.provider_unlinked': '解除登入帳號綁定',
  'workspace.created': '建立工作空間',
  'workspace.renamed': '修改工作空間名稱',
  'workspace.deleted': '移除工作空間',
  'project.created': '建立專案',
  'project.renamed': '修改專案名稱',
  'project.archived': '封存專案',
  'project.restored': '還原專案',
  'album.created': '建立相簿',
  'album.renamed': '修改相簿名稱',
  'album.activated': '開放相簿給客戶瀏覽',
  'album.protection_changed': '調整相簿清理保護',
  'album.archived': '封存相簿',
  'album.restored': '還原相簿',
  'album.photographer_recommendations.changed': '調整攝影師推薦條件',
  'album.photographer_recommendations.set': '調整攝影師推薦條件',
  'photo.photographer_metadata.changed': '調整攝影師星等與色標',
  'photo.photographer_metadata.set': '調整攝影師星等與色標',
  'photo.photographer_metadata.import': '讀取照片內的星等與色標',
  'photo.photographer_metadata.imported': '讀取照片內的星等與色標',
  'photo.version.created': '新增照片版本',
  'photo.version.current.set': '切換顯示的照片版本',
  'photo.version_current_changed': '切換顯示的照片版本',
  'project.versioning_mode_changed': '調整修圖版本管理方式',
  'project.versioning_mode.set': '調整修圖版本管理方式',
  'project.matching_rules.set': '調整照片版本比對方式',
  'image_processing.policy_changed': '調整縮圖與預覽圖設定',
  'storage.oracle_policy_changed': '調整備援儲存空間',
  'retention.dry_run_observed': '檢查可清理的相簿（未刪除）',
  'shared_review.created': '建立客戶共同挑片',
  'shared_review.reopened': '重新開放客戶共同挑片',
  'share.scope_sealed': '確認分享相簿與權限',
  'security.kdf_acquired': '開始設定分享密碼',
  'security.kdf_released': '結束分享密碼設定',
  'security.guest_kdf_acquired': '開始核對分享密碼',
  'security.guest_kdf_released': '結束分享密碼核對',
  'owner.external_intent_claimed': '處理停止上傳或照片處理的要求',
  'upload.expired': '照片上傳已逾時',
  'upload.capability_fenced': '停止接收此照片的上傳',
  'upload.needs_review': '照片上傳需要確認',
  'processing.running': '正在產生縮圖與預覽圖',
  'processing.retryable': '等待重新產生縮圖與預覽圖',
  'processing.needs_review': '照片處理需要確認',
  'processing.abandoned': '停止產生縮圖與預覽圖',
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
  'album.cover_changed': '更換相簿封面',
  'project.cover_changed': '更換專案封面',
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
  'owner.album_feedback_created': '攝影師新增共用意見',
  'owner.album_feedback_updated': '攝影師編輯共用意見',
  'owner.album_feedback_deleted': '攝影師刪除共用意見',
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
  'share.created': '建立相簿分享連結',
  'share.revoked': '停用相簿分享連結',
  'guest.session_created': '客戶開啟分享相簿',
  'guest.session_revoked': '結束客戶的相簿存取',
  'upload.reserved': '照片加入上傳佇列',
  'upload.authorized': '準備傳送照片',
  'upload.completed': '照片原檔已上傳',
  'upload.cancelled': '取消照片上傳',
  'processing.enqueued': '等待產生縮圖與預覽圖',
  'processing.succeeded': '縮圖與預覽圖已完成',
  'processing.failed': '縮圖與預覽圖產生失敗',
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

export function historyEventLabel(event: OwnerHistoryEvent) {
  const after = event.details.after;
  if (
    event.action === 'rating.set' &&
    typeof after?.stars === 'number' &&
    Number.isInteger(after.stars) &&
    after.stars >= 1 &&
    after.stars <= 5
  )
    return `評為 ${after.stars} 星`;
  if (
    (event.action === 'tag.added' || event.action === 'tag.removed') &&
    typeof (after?.label ?? event.details.before?.label) === 'string'
  ) {
    const label = after?.label ?? event.details.before?.label;
    return `${event.action === 'tag.added' ? '新增' : '移除'}標籤「${label}」`;
  }
  if (
    event.action === 'photo.version.created' &&
    typeof after?.versionNo === 'number'
  )
    return after.versionNo === 1
      ? '新增照片'
      : `上傳第 ${after.versionNo} 版照片`;
  if (
    [
      'owner.album_feedback_created',
      'owner.album_feedback_updated',
      'owner.album_feedback_deleted',
    ].includes(event.action)
  ) {
    const kind = after?.kind ?? event.details.before?.kind;
    const verb = event.action.endsWith('_created')
      ? '新增'
      : event.action.endsWith('_updated')
        ? '編輯'
        : '刪除';
    const content =
      kind === 'annotation'
        ? '手繪註記'
        : kind === 'comment'
          ? '共用留言'
          : '共用意見';
    return `攝影師${verb}${content}`;
  }
  if (
    event.action === 'album.protection_changed' &&
    typeof after?.isPinned === 'boolean'
  )
    return after.isPinned ? '保護相簿，避免自動清理' : '取消相簿的清理保護';
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
          ? '要求下載預覽畫質照片'
          : '要求下載原始畫質照片';
      return kind === 'preview'
        ? '預覽畫質照片已可下載'
        : '原始畫質照片已可下載';
    }
  }
  return actionLabels[event.action] ?? '尚未分類的活動';
}

export function historyEventSummary(event: OwnerHistoryEvent) {
  const label = historyEventLabel(event);
  const after = event.details.after;
  const before = event.details.before;
  const subject = event.subject;
  const filename = subject?.photoFilename || after?.originalFilename;
  if (typeof filename === 'string' && filename)
    return `${label} · ${photoDisplayName(filename)}`;
  if (
    event.action.endsWith('.renamed') &&
    typeof before?.name === 'string' &&
    typeof after?.name === 'string'
  )
    return `${label} · ${before.name} → ${after.name}`;
  const name =
    after?.name ?? before?.name ?? subject?.albumName ?? subject?.projectName;
  return typeof name === 'string' && name ? `${label} · ${name}` : label;
}

export function historyEventObjectLabel(event: OwnerHistoryEvent) {
  const after = event.details.after;
  const before = event.details.before;
  if (
    event.action === 'workspace.renamed' ||
    event.action === 'workspace.deleted'
  ) {
    const name = after?.name ?? before?.name;
    return typeof name === 'string' && name
      ? `工作空間「${name}」`
      : '工作空間名稱未提供';
  }
  const photoFilename =
    event.subject?.photoFilename ||
    (typeof after?.originalFilename === 'string'
      ? after.originalFilename
      : null);
  const photoName = photoFilename
    ? `照片「${photoDisplayName(photoFilename)}」`
    : event.photoId
      ? '照片名稱未提供'
      : null;
  const albumName = event.subject?.albumName?.trim();
  const album = albumName
    ? `相簿「${albumName}」`
    : event.albumId
      ? '相簿名稱未提供'
      : null;
  const projectName = event.subject?.projectName?.trim();
  const project = projectName
    ? `專案「${projectName}」`
    : event.projectId && !event.albumId && !event.photoId
      ? '專案名稱未提供'
      : null;
  return [photoName, album, project].filter(Boolean).join(' · ') || '未提供';
}

const recommendationColorLabels: Record<string, string> = {
  red: '紅色',
  yellow: '黃色',
  green: '綠色',
  blue: '藍色',
  purple: '紫色',
};

function recommendationValue(
  value: unknown,
  field: 'visible' | 'minRating' | 'allowedLabels',
) {
  if (field === 'visible')
    return typeof value === 'boolean' ? (value ? '開啟' : '關閉') : null;
  if (field === 'minRating') {
    if (value === null) return '不使用星等條件';
    return typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5
      ? `${value} 星以上`
      : null;
  }
  if (
    !Array.isArray(value) ||
    !value.every(
      (label) =>
        typeof label === 'string' &&
        Object.hasOwn(recommendationColorLabels, label),
    )
  )
    return null;
  return value.length
    ? value.map((label) => recommendationColorLabels[label]).join('、')
    : '未設定';
}

export function historyEventChangeLines(event: OwnerHistoryEvent) {
  if (
    event.action === 'album.photographer_recommendations.changed' &&
    event.details.status === 'available'
  ) {
    const before = event.details.before;
    const after = event.details.after;
    if (!before || !after) return ['推薦條件前後資料不完整，未呈現。'];
    const fields = [
      ['是否顯示推薦', 'visible'],
      ['最低星等', 'minRating'],
      ['色標', 'allowedLabels'],
    ] as const;
    const lines = fields.map(([label, field]) => {
      const beforeValue = recommendationValue(before[field], field);
      const afterValue = recommendationValue(after[field], field);
      return beforeValue === null || afterValue === null
        ? null
        : `${label}：${beforeValue} → ${afterValue}`;
    });
    if (lines.some((line) => line === null))
      return ['推薦條件前後資料不完整，未呈現。'];
    return [
      ...lines.filter((line): line is string => line !== null),
      '條件判斷：符合任一已設定條件即可推薦（OR）。',
    ];
  }

  if (
    (event.action === 'workspace.renamed' ||
      event.action === 'album.renamed' ||
      event.action === 'project.renamed') &&
    event.details.status === 'available'
  ) {
    const beforeName = event.details.before?.name;
    const afterName = event.details.after?.name;
    if (typeof beforeName === 'string' && typeof afterName === 'string')
      return [`名稱：${beforeName} → ${afterName}`];
  }

  if (
    event.action === 'album.protection_changed' &&
    event.details.status === 'available'
  ) {
    const beforePinned = event.details.before?.isPinned;
    const afterPinned = event.details.after?.isPinned;
    if (typeof beforePinned === 'boolean' && typeof afterPinned === 'boolean')
      return [
        `自動清理保護：${beforePinned ? '開啟' : '關閉'} → ${afterPinned ? '開啟' : '關閉'}`,
      ];
  }

  if (event.details.status === 'omitted')
    return ['此活動沒有可顯示的前後摘要。'];
  if (event.details.status === 'invalid') return ['活動明細格式無法安全呈現。'];
  return [historyEventLabel(event)];
}

export function historyActorLabel(event: OwnerHistoryEvent) {
  if (event.actor.type === 'system') return '系統';
  const label = event.actor.label?.trim();
  if (!label || /^(owner|admin|administrator|guest)$/iu.test(label))
    return event.actor.type === 'user' ? '攝影師' : '客戶';
  return label;
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
  const changes = historyEventChangeLines(event);
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
        aria-label={`查看${historyEventLabel(event)}詳細資料`}
      >
        詳情
      </summary>
      <section className="history-timeline__plain" aria-label="活動內容">
        <dl className="grid min-w-0 grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt>對象</dt>
            <dd>{historyEventObjectLabel(event)}</dd>
          </div>
          <div className="min-w-0">
            <dt>動作</dt>
            <dd>{historyEventLabel(event)}</dd>
          </div>
          <div className="min-w-0 sm:col-span-3">
            <dt>變更</dt>
            <dd>
              <ul>
                {changes.map((change, index) => (
                  <li key={`${index}-${change}`}>{change}</li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </section>
      <details className="history-timeline__technical">
        <summary>技術資料</summary>
        <dl className="grid min-w-0 grid-cols-1 gap-2 text-xs sm:grid-cols-2">
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
            <dd>{actorLabels[event.actor.type]}</dd>
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
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-stone-700">事件前後資料</h4>
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
    </details>
  );
}

function EventCard({ event }: { event: OwnerHistoryEvent }) {
  const actor = historyActorLabel(event);
  const label = historyEventSummary(event);
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
