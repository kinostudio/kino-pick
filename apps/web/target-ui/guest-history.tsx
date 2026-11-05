'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import {
  guestHistoryCapabilitiesSchema,
  guestHistoryPageSchema,
  guestHistoryQuerySchema,
  type GuestHistoryEvent,
  type GuestHistoryPage as GuestActivityPage,
} from '../../../packages/contracts/src/guest-history';

type HistoryFilter = {
  albumId?: string | undefined;
  photoId?: string | undefined;
};

type LoadStatus =
  | 'loading'
  | 'ready'
  | 'disabled'
  | 'unauthorized'
  | 'error'
  | 'invalid-filter'
  | 'refresh-required';

type PageError = 'temporary' | 'unavailable';

type HistorySnapshot = {
  filterKey: string;
  generation: number;
  status: LoadStatus;
  guestId: string | null;
  items: GuestHistoryEvent[];
  nextCursor: string | null;
  loadingMore: boolean;
  moreError: PageError | null;
};

type HistoryRequestResult =
  { kind: 'disabled' } | { kind: 'ready'; page: GuestActivityPage };

class GuestHistoryApiFailure extends Error {
  constructor(public readonly statusCode: number) {
    super('Guest history request failed');
  }
}

function emptySnapshot(
  filterKey: string,
  generation: number,
  status: LoadStatus,
): HistorySnapshot {
  return {
    filterKey,
    generation,
    status,
    guestId: null,
    items: [],
    nextCursor: null,
    loadingMore: false,
    moreError: null,
  };
}

function resolveFilter(albumId?: string, photoId?: string, search = '') {
  const params = new URLSearchParams(search);
  const duplicateQuery =
    (albumId === undefined && params.getAll('albumId').length > 1) ||
    (photoId === undefined && params.getAll('photoId').length > 1);
  const rawAlbumId = albumId ?? params.get('albumId');
  const rawPhotoId = photoId ?? params.get('photoId');
  const input: HistoryFilter = {
    ...(rawAlbumId !== null && rawAlbumId !== undefined
      ? { albumId: rawAlbumId }
      : {}),
    ...(rawPhotoId !== null && rawPhotoId !== undefined
      ? { photoId: rawPhotoId }
      : {}),
  };
  const parsed = guestHistoryQuerySchema.safeParse(input);
  if (duplicateQuery || !parsed.success) {
    return {
      valid: false,
      filter: {} as HistoryFilter,
      filterKey: 'invalid:' + JSON.stringify([albumId, photoId, search]),
    };
  }
  return {
    valid: true,
    filter: parsed.data,
    filterKey: JSON.stringify([
      parsed.data.albumId ?? null,
      parsed.data.photoId ?? null,
    ]),
  };
}

async function requestJson<T>(
  path: string,
  schema: { parse: (input: unknown) => T },
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new GuestHistoryApiFailure(response.status);
  const body: unknown = await response.json().catch(() => null);
  return schema.parse(body);
}

async function requestHistoryPage(
  filter: HistoryFilter,
  cursor: string | null,
  signal: AbortSignal,
): Promise<HistoryRequestResult> {
  const capabilities = await requestJson(
    '/api/guest/history/capabilities',
    guestHistoryCapabilitiesSchema,
    signal,
  );
  if (!capabilities.enabled) return { kind: 'disabled' };

  const queryInput: HistoryFilter & { cursor?: string } = { ...filter };
  if (cursor !== null) queryInput.cursor = cursor;
  const query = guestHistoryQuerySchema.parse(queryInput);
  const params = new URLSearchParams();
  if (query.albumId) params.set('albumId', query.albumId);
  if (query.photoId) params.set('photoId', query.photoId);
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  const suffix = params.size > 0 ? '?' + params.toString() : '';
  const page = await requestJson(
    '/api/guest/me/activity' + suffix,
    guestHistoryPageSchema,
    signal,
  );
  return { kind: 'ready', page };
}

function errorStatus(error: unknown): PageError {
  return error instanceof GuestHistoryApiFailure && error.statusCode === 503
    ? 'temporary'
    : 'unavailable';
}

function formatOccurredAt(value: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(new Date(value));
}

function actionLabel(event: GuestHistoryEvent) {
  switch (event.action) {
    case 'selection.added':
      return '你將照片加入自己的挑片';
    case 'selection.removed':
      return '你從自己的挑片移除了照片';
    case 'selection.version_changed':
      return '你更新了自己挑選的照片版本';
    case 'selection.submitted':
      return '你送出了自己的挑片結果';
    case 'rating.set':
      return '你為照片設定了評分';
    case 'rating.cleared':
      return '你清除了自己的評分';
    case 'favorite.added':
      return '你將照片加入自己的最愛';
    case 'favorite.removed':
      return '你從自己的最愛移除了照片';
    case 'tag.added':
      return '你為照片加入標籤';
    case 'tag.removed':
      return '你移除了照片標籤';
    case 'shared_selection.added':
      return '你將照片加入共同挑片';
    case 'shared_selection.removed':
      return '你從共同挑片移除了照片';
    case 'shared_selection.version_changed':
      return '你更新了共同挑片中的照片版本';
    case 'shared_selection.submitted':
      return '你送出了自己的共同挑片結果';
    case 'comment.create':
      return '你新增了版本留言';
    case 'comment.edit':
      return '你編輯了版本留言';
    case 'comment.delete':
      return '你刪除了版本留言';
    case 'comment.resolve':
      return '你將留言標記為已處理';
    case 'comment.reopen':
      return '你重新開啟了留言';
    case 'annotation.created':
      return '你新增了版本標註';
    case 'annotation.updated':
      return '你更新了版本標註';
    case 'annotation.deleted':
      return '你刪除了版本標註';
    case 'annotation.resolved':
      return '你將標註標記為已處理';
    case 'annotation.reopened':
      return '你重新開啟了標註';
    case 'version_approval.confirmed':
      return '你已確認照片版本';
    case 'download.requested':
      return event.detail.assetKind === 'preview'
        ? '你要求下載預覽檔'
        : '你要求下載原始照片';
    case 'download.generated':
      return event.detail.assetKind === 'preview'
        ? '已準備預覽檔供下載'
        : '已準備原始照片供下載';
  }
}

function selectionValue(value: {
  selected: boolean;
  versionId: string | null;
}) {
  const status = value.selected ? '已選擇' : '未選擇';
  return value.versionId ? status + '（已指定版本）' : status;
}

function submissionValue(value: {
  roundNo: number;
  status: 'open' | 'submitted';
  selectedCount?: number | undefined;
}) {
  const parts = [
    '第 ' + value.roundNo + ' 輪',
    value.status === 'submitted' ? '已送出' : '進行中',
  ];
  if (value.selectedCount !== undefined) {
    parts.push('已選 ' + value.selectedCount + ' 張');
  }
  return parts.join('、');
}

function detailText(event: GuestHistoryEvent) {
  switch (event.action) {
    case 'selection.added':
    case 'selection.removed':
    case 'selection.version_changed':
      return (
        '自己的挑片：' +
        selectionValue(event.detail.before) +
        ' → ' +
        selectionValue(event.detail.after)
      );
    case 'shared_selection.added':
    case 'shared_selection.removed':
    case 'shared_selection.version_changed':
      return (
        '你的共同挑片：' +
        selectionValue(event.detail.before) +
        ' → ' +
        selectionValue(event.detail.after)
      );
    case 'selection.submitted':
      return (
        '送出前：' +
        submissionValue(event.detail.before) +
        '；送出後：' +
        submissionValue(event.detail.after)
      );
    case 'shared_selection.submitted':
      return (
        '共同挑片送出前：' +
        submissionValue(event.detail.before) +
        '；送出後：' +
        submissionValue(event.detail.after)
      );
    case 'rating.set':
    case 'rating.cleared': {
      const value = (stars: number | null) =>
        stars === null ? '尚未評分' : stars + ' 星';
      return (
        '評分：' +
        value(event.detail.before.stars) +
        ' → ' +
        value(event.detail.after.stars)
      );
    }
    case 'favorite.added':
    case 'favorite.removed':
      return (
        '自己的最愛：' +
        (event.detail.before.favored ? '已加入' : '未加入') +
        ' → ' +
        (event.detail.after.favored ? '已加入' : '未加入')
      );
    case 'comment.create':
    case 'comment.edit':
    case 'comment.delete':
    case 'comment.resolve':
    case 'comment.reopen': {
      const labels = {
        absent: '尚未建立',
        open: '待處理',
        resolved: '已處理',
        deleted: '已刪除',
      };
      return `留言修訂 ${event.detail.before.revision} → ${event.detail.after.revision}：${labels[event.detail.before.state]} → ${labels[event.detail.after.state]}`;
    }
    case 'annotation.created':
    case 'annotation.updated':
    case 'annotation.deleted':
    case 'annotation.resolved':
    case 'annotation.reopened': {
      const labels = {
        absent: '尚未建立',
        open: '待處理',
        resolved: '已處理',
        deleted: '已刪除',
      };
      return (
        '標註修訂 ' +
        event.detail.before.revision +
        ' → ' +
        event.detail.after.revision +
        '：' +
        labels[event.detail.before.state] +
        ' → ' +
        labels[event.detail.after.state]
      );
    }
    case 'tag.added':
    case 'tag.removed': {
      const label = event.detail.after.present
        ? event.detail.after.label
        : event.detail.before.label;
      return (
        '標籤「' +
        label +
        '」：' +
        (event.detail.before.present ? '已加入' : '未加入') +
        ' → ' +
        (event.detail.after.present ? '已加入' : '未加入')
      );
    }
    case 'version_approval.confirmed':
      return '已確認此照片的指定版本';
    case 'download.requested':
    case 'download.generated': {
      const kind = event.detail.assetKind === 'preview' ? '預覽檔' : '原始檔';
      return (
        kind +
        '「' +
        event.detail.filename +
        '」· ' +
        event.detail.byteSize.toLocaleString() +
        ' bytes · ' +
        event.detail.mime
      );
    }
  }
}

function ActivityItem({ event }: { event: GuestHistoryEvent }) {
  const photoLabel =
    event.photoStatus === 'unavailable'
      ? '照片目前無法顯示'
      : event.photoId === null
        ? '相簿活動'
        : '照片活動';
  return (
    <li className="min-w-0 rounded-lg border border-stone-200 bg-white p-4 sm:p-5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="break-words font-medium text-stone-900">
            {actionLabel(event)}
          </h2>
          <p className="mt-1 text-sm text-stone-600">{photoLabel}</p>
        </div>
        <time
          dateTime={event.occurredAt}
          className="shrink-0 text-sm text-stone-500"
        >
          {formatOccurredAt(event.occurredAt)}
        </time>
      </div>
      <p className="mt-3 break-words text-sm leading-6 text-stone-700">
        {detailText(event)}
      </p>
    </li>
  );
}

export type GuestHistoryPageProps = {
  albumId?: string | undefined;
  photoId?: string | undefined;
};

export function GuestHistoryPage({
  albumId,
  photoId,
}: GuestHistoryPageProps = {}) {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const resolved = useMemo(
    () => resolveFilter(albumId, photoId, search),
    [albumId, photoId, search],
  );
  const { filter, filterKey } = resolved;
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(() =>
    emptySnapshot(filterKey, 0, 'loading'),
  );
  const snapshotRef = useRef(snapshot);
  const generationSequenceRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const controllersRef = useRef(new Set<AbortController>());
  const initialRequestGenerationRef = useRef<number | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const retryCursorRef = useRef<string | null>(null);
  const suspendedRef = useRef(false);

  const writeSnapshot = useCallback(
    (value: HistorySnapshot) => {
      snapshotRef.current = value;
      setSnapshot(value);
    },
    [setSnapshot],
  );

  const addController = useCallback(() => {
    const controller = new AbortController();
    controllersRef.current.add(controller);
    return controller;
  }, []);

  const releaseController = useCallback((controller: AbortController) => {
    controllersRef.current.delete(controller);
  }, []);

  const loadFirstPage = useCallback(
    async (generation: number, targetFilter: HistoryFilter) => {
      if (
        activeGenerationRef.current !== generation ||
        initialRequestGenerationRef.current === generation
      ) {
        return;
      }
      initialRequestGenerationRef.current = generation;
      const controller = addController();
      try {
        const result = await requestHistoryPage(
          targetFilter,
          null,
          controller.signal,
        );
        if (activeGenerationRef.current !== generation) return;
        if (result.kind === 'disabled') {
          writeSnapshot(emptySnapshot(filterKey, generation, 'disabled'));
          return;
        }
        writeSnapshot({
          ...emptySnapshot(filterKey, generation, 'ready'),
          guestId: result.page.guestId,
          items: result.page.items,
          nextCursor: result.page.nextCursor,
        });
      } catch (error) {
        if (
          activeGenerationRef.current !== generation ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          return;
        }
        if (
          error instanceof GuestHistoryApiFailure &&
          error.statusCode === 401
        ) {
          writeSnapshot(emptySnapshot(filterKey, generation, 'unauthorized'));
        } else {
          writeSnapshot({
            ...emptySnapshot(filterKey, generation, 'error'),
            moreError: errorStatus(error),
          });
        }
      } finally {
        releaseController(controller);
        if (initialRequestGenerationRef.current === generation) {
          initialRequestGenerationRef.current = null;
        }
      }
    },
    [addController, filterKey, releaseController, writeSnapshot],
  );

  const abortPending = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    initialRequestGenerationRef.current = null;
    loadMoreInFlightRef.current = false;
    retryCursorRef.current = null;
  }, []);

  const restartFromBeginning = useCallback(() => {
    if (!resolved.valid || suspendedRef.current) return;
    abortPending();
    const generation = generationSequenceRef.current + 1;
    generationSequenceRef.current = generation;
    activeGenerationRef.current = generation;
    writeSnapshot(emptySnapshot(filterKey, generation, 'loading'));
    void loadFirstPage(generation, filter);
  }, [
    abortPending,
    filter,
    filterKey,
    loadFirstPage,
    resolved.valid,
    writeSnapshot,
  ]);

  useEffect(() => {
    const generation = generationSequenceRef.current + 1;
    generationSequenceRef.current = generation;
    activeGenerationRef.current = generation;
    suspendedRef.current = false;
    abortPending();

    let disposed = false;
    const suspendForBackground = () => {
      if (disposed || !resolved.valid || suspendedRef.current) return;
      suspendedRef.current = true;
      const invalidGeneration = generationSequenceRef.current + 1;
      generationSequenceRef.current = invalidGeneration;
      activeGenerationRef.current = invalidGeneration;
      abortPending();
      flushSync(() => {
        writeSnapshot(
          emptySnapshot(filterKey, invalidGeneration, 'refresh-required'),
        );
      });
    };
    const resumeForForeground = () => {
      if (
        disposed ||
        !suspendedRef.current ||
        !resolved.valid ||
        document.visibilityState === 'hidden' ||
        document.hidden
      ) {
        return;
      }
      suspendedRef.current = false;
      restartFromBeginning();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' || document.hidden) {
        suspendForBackground();
      } else {
        resumeForForeground();
      }
    };

    window.addEventListener('blur', suspendForBackground);
    window.addEventListener('focus', resumeForForeground);
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (!resolved.valid) {
      writeSnapshot(emptySnapshot(filterKey, generation, 'invalid-filter'));
    } else if (document.visibilityState === 'hidden' || document.hidden) {
      suspendedRef.current = true;
      const suspendedGeneration = generationSequenceRef.current + 1;
      generationSequenceRef.current = suspendedGeneration;
      activeGenerationRef.current = suspendedGeneration;
      abortPending();
      writeSnapshot(
        emptySnapshot(filterKey, suspendedGeneration, 'refresh-required'),
      );
    } else {
      writeSnapshot(emptySnapshot(filterKey, generation, 'loading'));
      void loadFirstPage(generation, filter);
    }

    return () => {
      disposed = true;
      window.removeEventListener('blur', suspendForBackground);
      window.removeEventListener('focus', resumeForForeground);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      suspendedRef.current = false;
      activeGenerationRef.current = 0;
      abortPending();
    };
  }, [
    abortPending,
    filter,
    filterKey,
    loadFirstPage,
    resolved.valid,
    restartFromBeginning,
    writeSnapshot,
  ]);

  function loadMore() {
    const current = snapshotRef.current;
    const generation = activeGenerationRef.current;
    const cursor = retryCursorRef.current ?? current.nextCursor;
    if (
      generation === 0 ||
      !resolved.valid ||
      current.filterKey !== filterKey ||
      current.generation !== generation ||
      current.status !== 'ready' ||
      current.guestId === null ||
      cursor === null ||
      loadMoreInFlightRef.current
    ) {
      return;
    }

    loadMoreInFlightRef.current = true;
    retryCursorRef.current = cursor;
    writeSnapshot({
      ...current,
      loadingMore: true,
      moreError: null,
    });
    const controller = addController();

    void requestHistoryPage(filter, cursor, controller.signal)
      .then((result) => {
        if (activeGenerationRef.current !== generation) return;
        if (result.kind === 'disabled') {
          retryCursorRef.current = null;
          writeSnapshot(emptySnapshot(filterKey, generation, 'disabled'));
          return;
        }

        const latest = snapshotRef.current;
        if (
          latest.filterKey !== filterKey ||
          latest.generation !== generation ||
          latest.status !== 'ready'
        ) {
          return;
        }
        if (
          result.page.guestId !== latest.guestId ||
          result.page.nextCursor === cursor
        ) {
          retryCursorRef.current = null;
          writeSnapshot(
            emptySnapshot(filterKey, generation, 'refresh-required'),
          );
          return;
        }

        const seen = new Set(latest.items.map((item) => item.eventId));
        const newItems = result.page.items.filter(
          (item) => !seen.has(item.eventId),
        );
        retryCursorRef.current = null;
        writeSnapshot({
          ...latest,
          items: [...latest.items, ...newItems],
          nextCursor: result.page.nextCursor,
          loadingMore: false,
          moreError: null,
        });
      })
      .catch((error: unknown) => {
        if (activeGenerationRef.current !== generation) return;
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        if (
          error instanceof GuestHistoryApiFailure &&
          error.statusCode === 401
        ) {
          retryCursorRef.current = null;
          writeSnapshot(emptySnapshot(filterKey, generation, 'unauthorized'));
          return;
        }
        if (
          error instanceof GuestHistoryApiFailure &&
          error.statusCode === 400
        ) {
          retryCursorRef.current = null;
          writeSnapshot(
            emptySnapshot(filterKey, generation, 'refresh-required'),
          );
          return;
        }
        writeSnapshot({
          ...snapshotRef.current,
          loadingMore: false,
          moreError: errorStatus(error),
        });
      })
      .finally(() => {
        releaseController(controller);
        if (activeGenerationRef.current === generation) {
          loadMoreInFlightRef.current = false;
        }
      });
  }

  const visibleSnapshot =
    snapshot.filterKey === filterKey
      ? snapshot
      : emptySnapshot(filterKey, -1, 'loading');

  if (
    visibleSnapshot.status === 'loading' ||
    visibleSnapshot.status === 'disabled'
  ) {
    return null;
  }
  if (visibleSnapshot.status === 'unauthorized') {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <p
          role="alert"
          className="rounded-lg bg-white p-4 text-sm text-stone-700"
        >
          此連結目前無法使用，請聯絡攝影師。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6">
        <p className="mt-3 text-sm text-stone-600">Kino Pick 奇諾選圖</p>
        <h1 className="mt-1 text-2xl font-semibold text-stone-900">
          你的活動紀錄
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-6 text-stone-600">
          只顯示目前訪客身分自己的操作；共同挑片項目會清楚標示。
        </p>
      </header>

      {visibleSnapshot.status === 'invalid-filter' && (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          這個相簿篩選連結無效，請返回相簿後重新開啟活動紀錄。
        </p>
      )}

      {visibleSnapshot.status === 'refresh-required' && (
        <section
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p>
            頁面狀態或訪客身分已變更，舊紀錄已清除。返回頁面後會重新載入；也可手動重新整理。
          </p>
          <button
            type="button"
            onClick={restartFromBeginning}
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-amber-800 px-4 py-2 font-medium text-amber-950 underline-offset-2 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            重新整理活動紀錄
          </button>
        </section>
      )}

      {visibleSnapshot.status === 'error' && (
        <section
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p>
            {visibleSnapshot.moreError === 'temporary'
              ? '活動紀錄暫時無法載入，請稍後重試。'
              : '目前無法載入活動紀錄，請稍後重試。'}
          </p>
          <button
            type="button"
            onClick={restartFromBeginning}
            className="mt-3 inline-flex min-h-11 items-center rounded-md border border-amber-800 px-4 py-2 font-medium text-amber-950 underline-offset-2 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            重試
          </button>
        </section>
      )}

      {visibleSnapshot.status === 'ready' && (
        <section aria-label="你的活動紀錄">
          {visibleSnapshot.items.length === 0 ? (
            <p className="rounded-lg bg-white p-4 text-sm text-stone-600">
              目前沒有可顯示的活動紀錄。
            </p>
          ) : (
            <ol className="space-y-3">
              {visibleSnapshot.items.map((event) => (
                <ActivityItem key={event.eventId} event={event} />
              ))}
            </ol>
          )}

          {visibleSnapshot.moreError && (
            <p role="alert" className="mt-4 text-sm text-red-800">
              {visibleSnapshot.moreError === 'temporary'
                ? '下一頁活動暫時無法載入。'
                : '下一頁活動無法載入。請重試或重新整理紀錄。'}
            </p>
          )}

          {visibleSnapshot.nextCursor !== null && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                disabled={visibleSnapshot.loadingMore}
                onClick={loadMore}
                className="inline-flex min-h-11 w-full max-w-sm items-center justify-center rounded-md border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {visibleSnapshot.loadingMore
                  ? '載入中…'
                  : visibleSnapshot.moreError
                    ? '重試載入下一頁'
                    : '載入更多活動紀錄'}
              </button>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

export function GuestHistoryLink({ albumId }: { albumId: string }) {
  const [visibleAlbumId, setVisibleAlbumId] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();

    async function loadPermission() {
      try {
        const capabilities = await requestJson(
          '/api/guest/history/capabilities',
          guestHistoryCapabilitiesSchema,
          controller.signal,
        );
        if (!capabilities.enabled) return;

        const response = await requestJson(
          '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
          z.object({ access: guestAlbumAccessSchema }).strict(),
          controller.signal,
        );
        if (
          generationRef.current === generation &&
          response.access.albumId === albumId &&
          response.access.permissions.can_view_own_history
        ) {
          setVisibleAlbumId(albumId);
        }
      } catch {
        // Hide the optional link when capability or access cannot be confirmed.
      }
    }

    void loadPermission();
    return () => {
      controller.abort();
      if (generationRef.current === generation) {
        generationRef.current += 1;
      }
    };
  }, [albumId]);

  if (visibleAlbumId !== albumId) return null;
  return (
    <a
      href={'/guest/history?albumId=' + encodeURIComponent(albumId)}
      className="inline-flex min-h-11 items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      查看自己的活動紀錄
    </a>
  );
}
