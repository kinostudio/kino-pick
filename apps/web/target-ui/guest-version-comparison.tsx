'use client';
import { GuestAnnotationsPanel } from './guest-annotations';
import { GuestCommentsPanel } from './guest-comments';
import {
  VersionComparisonCanvas,
  type CompareMode,
  type ManualOverlayMode,
} from './version-comparison-canvas';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  guestPhotoVersionsPageSchema,
  type GuestPhotoVersion,
  type GuestPhotoVersionsPage,
} from '../../../packages/contracts/src/guest-versions';
import {
  createInitialGuestVersionSelection,
  mergeGuestPhotoVersions,
  selectLoadedGuestVersion,
  type GuestVersionSelection,
  type GuestVersionSelectionSlot,
} from './guest-version-comparison-model';

type ReadyView = {
  scopeKey: string;
  status: 'ready';
  head: GuestPhotoVersionsPage['head'];
  pinnedCurrentVersion: GuestPhotoVersion | null;
  versions: GuestPhotoVersion[];
  nextCursor: string | null;
  seenCursors: string[];
  selection: GuestVersionSelection;
  mode: CompareMode;
  splitPosition: number;
  opacity: number;
  manualOverlayMode: ManualOverlayMode;
  zoom: number;
  panX: number;
  panY: number;
  loadingMore: boolean;
  loadMoreError: boolean;
  failedPreviewIds: string[];
  previewRetry: number;
};

type ComparisonView =
  | { scopeKey: string; status: 'loading' }
  | { scopeKey: string; status: 'denied' }
  | { scopeKey: string; status: 'stale' }
  | { scopeKey: string; status: 'error' }
  | ReadyView;

class ApiFailure extends Error {
  constructor(public readonly statusCode: number) {
    super('Guest version comparison request failed');
  }
}

function makeVersionsPath(
  albumId: string,
  photoId: string,
  cursor: string | null,
) {
  const base =
    '/api/guest/albums/' +
    encodeURIComponent(albumId) +
    '/photos/' +
    encodeURIComponent(photoId) +
    '/versions';

  return cursor === null
    ? base
    : base + '?cursor=' + encodeURIComponent(cursor);
}

async function requestVersionPage(
  albumId: string,
  photoId: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<GuestPhotoVersionsPage> {
  const response = await fetch(makeVersionsPath(albumId, photoId, cursor), {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiFailure(response.status);

  const parsed = guestPhotoVersionsPageSchema.safeParse(body);
  if (!parsed.success) throw new ApiFailure(502);
  return parsed.data;
}

function createReadyView(
  scopeKey: string,
  page: GuestPhotoVersionsPage,
): ReadyView | null {
  const versions = mergeGuestPhotoVersions(page.currentVersion, page.versions);
  if (versions === null) return null;

  return {
    scopeKey,
    status: 'ready',
    head: page.head,
    pinnedCurrentVersion: page.currentVersion,
    versions,
    nextCursor: page.nextCursor,
    seenCursors: [],
    selection: createInitialGuestVersionSelection(
      versions,
      page.head.versionId,
    ),
    mode: 'slider',
    splitPosition: 50,
    opacity: 50,
    manualOverlayMode: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    loadingMore: false,
    loadMoreError: false,
    failedPreviewIds: [],
    previewRetry: 0,
  };
}

function sameHead(
  left: GuestPhotoVersionsPage['head'],
  right: GuestPhotoVersionsPage['head'],
) {
  return left.versionId === right.versionId && left.revision === right.revision;
}

function formatCreatedAt(createdAt: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(createdAt));
}

function formatDimensions(version: GuestPhotoVersion) {
  if (version.width === null || version.height === null) {
    return '尺寸未提供';
  }
  return (
    version.width.toLocaleString('zh-TW') +
    ' × ' +
    version.height.toLocaleString('zh-TW') +
    ' px'
  );
}

function formatOptionLabel(version: GuestPhotoVersion) {
  return (
    '版本 ' +
    version.versionNo +
    ' · ' +
    formatCreatedAt(version.createdAt) +
    (version.isCurrent ? ' · 目前版本' : '')
  );
}

function hasDifferentGeometry(
  before: GuestPhotoVersion,
  after: GuestPhotoVersion,
) {
  if (
    before.width === null ||
    before.height === null ||
    after.width === null ||
    after.height === null
  ) {
    return false;
  }

  return (
    before.width !== after.width ||
    before.height !== after.height ||
    before.width * after.height !== after.width * before.height
  );
}

function VersionDetails({
  label,
  version,
  unavailableText,
}: {
  label: string;
  version: GuestPhotoVersion | undefined;
  unavailableText: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-white/5 px-3 py-2">
      <h4 className="text-xs font-semibold text-white/75">{label}</h4>
      {version ? (
        <dl className="mt-1 space-y-0.5 text-xs">
          <div>
            <dt className="sr-only">版本編號</dt>
            <dd className="font-medium">版本 {version.versionNo}</dd>
          </div>
          <div>
            <dt className="sr-only">建立時間</dt>
            <dd>
              <time dateTime={version.createdAt}>
                {formatCreatedAt(version.createdAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="sr-only">建立者</dt>
            <dd className="text-white/65">{version.createdByLabel}</dd>
          </div>
          <div>
            <dt className="sr-only">圖片尺寸</dt>
            <dd className="text-white/65">{formatDimensions(version)}</dd>
          </div>
          <div>
            <dt className="sr-only">版本標籤</dt>
            <dd
              className="flex min-w-0 flex-wrap items-center gap-1 pt-0.5"
              aria-label="版本標籤"
            >
              {version.labels.length === 0 ? (
                <span className="text-white/50">無版本標籤</span>
              ) : (
                version.labels.map((label) => (
                  <span
                    key={label}
                    className="max-w-full break-words rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/70"
                  >
                    {label}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 break-words text-xs text-white/65">
          {unavailableText}
        </p>
      )}
    </div>
  );
}

export function GuestVersionComparison({
  albumId,
  photoId,
  filename,
  onClose,
  onPendingChange,
  onUnauthorized,
}: {
  albumId: string;
  photoId: string;
  filename: string;
  onClose: () => void;
  onPendingChange?: (pending: boolean) => void;
  onUnauthorized?: () => void;
}) {
  const scopeKey = JSON.stringify([albumId, photoId]);
  const [annotationPending, setAnnotationPending] = useState(false);
  const annotationPendingRef = useRef(false);
  const onAnnotationPending = useCallback(
    (pending: boolean) => {
      annotationPendingRef.current = pending;
      setAnnotationPending(pending);
      onPendingChange?.(pending);
    },
    [onPendingChange],
  );
  useEffect(
    () => () => {
      onPendingChange?.(false);
    },
    [onPendingChange],
  );
  const [view, setView] = useState<ComparisonView>(() => ({
    scopeKey,
    status: 'loading',
  }));
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const loadMoreLockRef = useRef(false);
  const opacityId = useId();
  const zoomId = useId();
  const panXId = useId();
  const panYId = useId();
  const runInitialRead = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    const generation = ++generationRef.current;
    controllerRef.current = controller;
    loadMoreLockRef.current = false;

    const isActive = () =>
      generationRef.current === generation &&
      controllerRef.current === controller &&
      !controller.signal.aborted;

    const becomeTerminal = (status: 'denied' | 'stale') => {
      if (!isActive()) return;
      controller.abort();
      controllerRef.current = null;
      generationRef.current += 1;
      loadMoreLockRef.current = false;
      setView({ scopeKey, status });
    };

    void requestVersionPage(albumId, photoId, null, controller.signal)
      .then((page) => {
        if (!isActive()) return;
        if (page.albumId !== albumId || page.photoId !== photoId) {
          becomeTerminal('stale');
          return;
        }

        const readyView = createReadyView(scopeKey, page);
        if (!readyView) {
          becomeTerminal('stale');
          return;
        }
        setView(readyView);
      })
      .catch((error: unknown) => {
        if (!isActive()) return;
        if (error instanceof ApiFailure && error.statusCode === 401) {
          onUnauthorized?.();
          becomeTerminal('denied');
        } else if (error instanceof ApiFailure && error.statusCode === 403) {
          becomeTerminal('denied');
        } else if (error instanceof ApiFailure && error.statusCode === 409) {
          becomeTerminal('stale');
        } else {
          setView({ scopeKey, status: 'error' });
        }
      });
  }, [albumId, onUnauthorized, photoId, scopeKey]);

  const retryInitialRead = useCallback(() => {
    setView({ scopeKey, status: 'loading' });
    runInitialRead();
  }, [runInitialRead, scopeKey]);

  useEffect(() => {
    runInitialRead();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      generationRef.current += 1;
      loadMoreLockRef.current = false;
    };
  }, [runInitialRead]);

  const currentView = useMemo(
    () =>
      view.scopeKey === scopeKey
        ? view
        : ({ scopeKey, status: 'loading' } as const),
    [view, scopeKey],
  );

  const updateReadyView = useCallback(
    (update: (ready: ReadyView) => ReadyView) => {
      setView((current) => {
        if (current.scopeKey !== scopeKey || current.status !== 'ready') {
          return current;
        }
        return update(current);
      });
    },
    [scopeKey],
  );

  const selectVersion = useCallback(
    (slot: GuestVersionSelectionSlot, versionId: string) => {
      if (annotationPendingRef.current) return;
      updateReadyView((current) => {
        const selection = selectLoadedGuestVersion(
          current.selection,
          slot,
          versionId,
          current.versions,
        );
        if (
          selection.beforeVersionId === current.selection.beforeVersionId &&
          selection.afterVersionId === current.selection.afterVersionId
        ) {
          return current;
        }
        return {
          ...current,
          selection,
          zoom: 1,
          panX: 0,
          panY: 0,
          manualOverlayMode: null,
        };
      });
    },
    [updateReadyView],
  );

  const loadMore = useCallback(async () => {
    if (
      currentView.status !== 'ready' ||
      currentView.nextCursor === null ||
      currentView.loadingMore ||
      loadMoreLockRef.current
    ) {
      return;
    }

    const controller = controllerRef.current;
    const generation = generationRef.current;
    const cursor = currentView.nextCursor;
    if (!controller || controller.signal.aborted) return;

    const isActive = () =>
      generationRef.current === generation &&
      controllerRef.current === controller &&
      !controller.signal.aborted;
    const becomeTerminal = (status: 'denied' | 'stale') => {
      if (!isActive()) return;
      controller.abort();
      controllerRef.current = null;
      generationRef.current += 1;
      loadMoreLockRef.current = false;
      setView({ scopeKey, status });
    };

    if (currentView.seenCursors.includes(cursor)) {
      becomeTerminal('stale');
      return;
    }

    loadMoreLockRef.current = true;
    setView((current) =>
      current.scopeKey === scopeKey && current.status === 'ready'
        ? { ...current, loadingMore: true, loadMoreError: false }
        : current,
    );

    try {
      const page = await requestVersionPage(
        albumId,
        photoId,
        cursor,
        controller.signal,
      );
      if (!isActive()) return;

      if (
        page.albumId !== albumId ||
        page.photoId !== photoId ||
        !sameHead(page.head, currentView.head)
      ) {
        becomeTerminal('stale');
        return;
      }

      const seenCursors = [...currentView.seenCursors, cursor];
      if (
        page.nextCursor === cursor ||
        (page.nextCursor !== null && seenCursors.includes(page.nextCursor))
      ) {
        becomeTerminal('stale');
        return;
      }

      const pinnedCurrentVersion =
        currentView.pinnedCurrentVersion ?? page.currentVersion;
      const versions = mergeGuestPhotoVersions(pinnedCurrentVersion, [
        ...(page.currentVersion ? [page.currentVersion] : []),
        ...currentView.versions,
        ...page.versions,
      ]);
      if (versions === null) {
        becomeTerminal('stale');
        return;
      }

      setView((current) => {
        if (
          current.scopeKey !== scopeKey ||
          current.status !== 'ready' ||
          !sameHead(current.head, page.head)
        ) {
          return current;
        }

        return {
          ...current,
          pinnedCurrentVersion,
          versions,
          nextCursor: page.nextCursor,
          seenCursors,
          loadingMore: false,
          loadMoreError: false,
        };
      });
    } catch (error: unknown) {
      if (!isActive()) return;
      if (error instanceof ApiFailure && error.statusCode === 401) {
        onUnauthorized?.();
        becomeTerminal('denied');
      } else if (error instanceof ApiFailure && error.statusCode === 403) {
        becomeTerminal('denied');
      } else if (error instanceof ApiFailure && error.statusCode === 409) {
        becomeTerminal('stale');
      } else {
        setView((current) =>
          current.scopeKey === scopeKey && current.status === 'ready'
            ? { ...current, loadingMore: false, loadMoreError: true }
            : current,
        );
      }
    } finally {
      if (isActive()) {
        loadMoreLockRef.current = false;
        setView((current) =>
          current.scopeKey === scopeKey && current.status === 'ready'
            ? { ...current, loadingMore: false }
            : current,
        );
      }
    }
  }, [albumId, currentView, onUnauthorized, photoId, scopeKey]);

  const handleImageError = useCallback(
    (versionId: string) => {
      updateReadyView((current) => ({
        ...current,
        failedPreviewIds: current.failedPreviewIds.includes(versionId)
          ? current.failedPreviewIds
          : [...current.failedPreviewIds, versionId],
      }));
    },
    [updateReadyView],
  );

  const retryPreviews = useCallback(() => {
    updateReadyView((current) => ({
      ...current,
      failedPreviewIds: [],
      previewRetry: current.previewRetry + 1,
    }));
  }, [updateReadyView]);

  const ready = currentView.status === 'ready' ? currentView : null;
  const beforeVersion = ready
    ? ready.versions.find(
        (version) => version.versionId === ready.selection.beforeVersionId,
      )
    : undefined;
  const afterVersion = ready
    ? ready.versions.find(
        (version) => version.versionId === ready.selection.afterVersionId,
      )
    : undefined;
  const hasLoadedPair =
    ready !== null &&
    beforeVersion !== undefined &&
    afterVersion !== undefined &&
    beforeVersion.versionId !== afterVersion.versionId;
  const beforeOptions = ready
    ? ready.versions.filter(
        (version) => version.versionId !== ready.selection.afterVersionId,
      )
    : [];
  const afterOptions = ready
    ? ready.versions.filter(
        (version) => version.versionId !== ready.selection.beforeVersionId,
      )
    : [];
  const currentHeadIsLoaded =
    ready?.versions.some(
      (version) => version.versionId === ready.head.versionId,
    ) ?? false;
  const selectedPreviewFailed =
    ready !== null &&
    ((beforeVersion !== undefined &&
      ready.failedPreviewIds.includes(beforeVersion.versionId)) ||
      (afterVersion !== undefined &&
        ready.failedPreviewIds.includes(afterVersion.versionId)));
  const geometryWarning =
    beforeVersion !== undefined &&
    afterVersion !== undefined &&
    hasDifferentGeometry(beforeVersion, afterVersion);
  const updateZoom = (value: number) => {
    updateReadyView((current) => ({
      ...current,
      zoom: value,
      ...(value <= 1 ? { panX: 0, panY: 0 } : {}),
    }));
  };

  const setMode = (mode: CompareMode) => {
    updateReadyView((current) => ({
      ...current,
      mode,
      manualOverlayMode: mode === 'overlay' ? current.manualOverlayMode : null,
    }));
  };

  const modeButtonClass = (active: boolean) =>
    'min-h-10 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ' +
    (active
      ? 'border-amber-300 bg-amber-300/15 text-amber-100'
      : 'border-white/20 hover:bg-white/10');

  if (currentView.status === 'denied') return null;

  return (
    <section
      data-testid="guest-version-comparison"
      aria-label="照片版本比較"
      className="w-full min-w-0 space-y-3 bg-stone-950 px-3 py-3 text-white sm:px-4"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">版本比較</h3>
          <p className="truncate text-xs text-white/65" title={filename}>
            {filename}
          </p>
        </div>
        <button
          type="button"
          data-testid="compare-close"
          disabled={annotationPending}
          onClick={() => {
            if (!annotationPendingRef.current) onClose();
          }}
          className="min-h-10 shrink-0 rounded-md border border-white/25 px-3 text-sm hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          關閉比較
        </button>
      </header>

      {currentView.status === 'loading' && (
        <p role="status" className="py-8 text-center text-sm text-white/70">
          正在載入已處理版本…
        </p>
      )}

      {currentView.status === 'stale' && (
        <div className="space-y-3 rounded-md border border-amber-200/30 p-3">
          <p role="alert" className="text-sm">
            版本清單已更新，已清除舊的預覽。請明確重新載入目前版本。
          </p>
          <button
            type="button"
            onClick={retryInitialRead}
            className="min-h-10 rounded-md border border-white/25 px-3 text-sm hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            重新載入目前版本
          </button>
        </div>
      )}

      {currentView.status === 'error' && (
        <div className="space-y-3 rounded-md border border-red-200/30 p-3">
          <p role="alert" className="text-sm">
            目前無法載入版本，預覽已清除。請明確重試。
          </p>
          <button
            type="button"
            onClick={retryInitialRead}
            className="min-h-10 rounded-md border border-white/25 px-3 text-sm hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            重試載入版本
          </button>
        </div>
      )}

      {ready && (
        <div className="min-w-0 space-y-3">
          {ready.pinnedCurrentVersion === null && !currentHeadIsLoaded && (
            <p
              role="status"
              className="rounded-md border border-white/10 p-2 text-xs text-white/75"
            >
              目前版本尚未有可比較預覽。已載入的其他版本仍可供檢視。
            </p>
          )}

          {ready.versions.length === 0 && (
            <p
              role="status"
              className="rounded-md border border-white/10 p-3 text-center text-sm text-white/70"
            >
              目前沒有可比較的已處理版本。
            </p>
          )}

          {ready.versions.length === 1 && (
            <div className="space-y-3">
              <VersionDetails
                label="已處理版本"
                version={ready.versions[0]}
                unavailableText="目前沒有已處理版本。"
              />
              <p role="status" className="text-sm text-white/70">
                至少需要兩個不同的已處理版本才能比較。
              </p>
            </div>
          )}

          {ready.versions.length >= 2 && (
            <>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <label className="min-w-0 space-y-1 text-xs font-medium">
                  <span>Before 版本</span>
                  <select
                    data-testid="compare-before"
                    disabled={annotationPending}
                    value={ready.selection.beforeVersionId ?? ''}
                    onChange={(event) =>
                      selectVersion('before', event.currentTarget.value)
                    }
                    className="min-h-10 w-full min-w-0 rounded-md border border-white/20 bg-stone-900 px-2 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    <option value="" disabled>
                      選擇 Before
                    </option>
                    {beforeOptions.map((version) => (
                      <option key={version.versionId} value={version.versionId}>
                        {formatOptionLabel(version)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="min-w-0 space-y-1 text-xs font-medium">
                  <span>After 版本</span>
                  <select
                    data-testid="compare-after"
                    disabled={annotationPending}
                    value={ready.selection.afterVersionId ?? ''}
                    onChange={(event) =>
                      selectVersion('after', event.currentTarget.value)
                    }
                    className="min-h-10 w-full min-w-0 rounded-md border border-white/20 bg-stone-900 px-2 text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    {!currentHeadIsLoaded &&
                      ready.selection.afterVersionId ===
                        ready.head.versionId && (
                        <option value={ready.head.versionId} disabled>
                          目前版本尚無可比較預覽
                        </option>
                      )}
                    <option value="" disabled>
                      選擇 After
                    </option>
                    {afterOptions.map((version) => (
                      <option key={version.versionId} value={version.versionId}>
                        {formatOptionLabel(version)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid min-w-0 grid-cols-2 gap-2">
                <VersionDetails
                  label="Before"
                  version={beforeVersion}
                  unavailableText="請從已載入的版本中選擇。"
                />
                <VersionDetails
                  label="After"
                  version={afterVersion}
                  unavailableText={
                    ready.selection.afterVersionId === ready.head.versionId
                      ? '目前版本尚未有可比較預覽。'
                      : '請從已載入的版本中選擇。'
                  }
                />
              </div>

              {!hasLoadedPair && (
                <p role="status" className="text-xs text-white/70">
                  請選擇兩個不同且已載入的版本，再開始比較。
                </p>
              )}

              {hasLoadedPair && (
                <>
                  {geometryWarning && (
                    <p
                      role="status"
                      className="rounded-md border border-amber-200/30 px-3 py-2 text-xs text-amber-100"
                    >
                      兩個版本的尺寸或長寬比不同，請留意邊界裁切。
                    </p>
                  )}

                  <div
                    role="group"
                    aria-label="比較方式"
                    className="flex min-w-0 flex-wrap gap-2"
                  >
                    <button
                      type="button"
                      data-testid="compare-mode-slider"
                      aria-pressed={ready.mode === 'slider'}
                      onClick={() => setMode('slider')}
                      className={modeButtonClass(ready.mode === 'slider')}
                    >
                      拉桿
                    </button>
                    <button
                      type="button"
                      data-testid="compare-mode-side"
                      aria-pressed={ready.mode === 'side'}
                      onClick={() => setMode('side')}
                      className={modeButtonClass(ready.mode === 'side')}
                    >
                      並排
                    </button>
                    <button
                      type="button"
                      data-testid="compare-mode-overlay"
                      aria-pressed={ready.mode === 'overlay'}
                      onClick={() => setMode('overlay')}
                      className={modeButtonClass(ready.mode === 'overlay')}
                    >
                      疊合
                    </button>
                  </div>

                  {selectedPreviewFailed ? (
                    <div
                      data-testid="compare-canvas"
                      role="group"
                      className="min-w-0"
                      aria-label="版本比較畫布"
                    >
                      <div className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-md border border-red-200/30 p-4 text-center text-sm">
                        <p>預覽載入失敗，已清除比較畫布。</p>
                        <button
                          type="button"
                          onClick={retryPreviews}
                          className="min-h-10 rounded-md border border-white/25 px-3 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                        >
                          明確重試預覽
                        </button>
                      </div>
                    </div>
                  ) : (
                    <VersionComparisonCanvas
                      scopeKey={scopeKey}
                      mode={ready.mode}
                      before={{
                        id: beforeVersion.versionId,
                        src: beforeVersion.previewUrl,
                        alt:
                          filename + ' Before 版本 ' + beforeVersion.versionNo,
                        caption: 'Before · 版本 ' + beforeVersion.versionNo,
                        label: 'Before',
                        retryKey: ready.previewRetry,
                        badge: 'BEFORE',
                      }}
                      after={{
                        id: afterVersion.versionId,
                        src: afterVersion.previewUrl,
                        alt: filename + ' After 版本 ' + afterVersion.versionNo,
                        caption: 'After · 版本 ' + afterVersion.versionNo,
                        label: 'After',
                        retryKey: ready.previewRetry,
                        badge: 'AFTER',
                      }}
                      splitPosition={ready.splitPosition}
                      onSplitPositionChange={(value) =>
                        updateReadyView((current) => ({
                          ...current,
                          splitPosition: value,
                        }))
                      }
                      zoom={ready.zoom}
                      panX={ready.panX}
                      panY={ready.panY}
                      opacity={ready.opacity}
                      manualOverlayMode={ready.manualOverlayMode}
                      onImageError={handleImageError}
                    />
                  )}
                  {ready.mode === 'side' && (
                    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="min-w-0 space-y-1">
                        <label htmlFor={zoomId} className="block text-xs">
                          同步縮放
                        </label>
                        <input
                          id={zoomId}
                          data-testid="compare-zoom"
                          type="range"
                          min={1}
                          max={3}
                          step={0.1}
                          value={ready.zoom}
                          onChange={(event) =>
                            updateZoom(event.currentTarget.valueAsNumber)
                          }
                          className="min-h-8 w-full accent-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                        />
                        <output
                          htmlFor={zoomId}
                          className="block text-xs text-white/65"
                        >
                          {ready.zoom.toFixed(1)}×
                        </output>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <label htmlFor={panXId} className="block text-xs">
                          同步水平平移
                        </label>
                        <input
                          id={panXId}
                          data-testid="compare-pan-x"
                          type="range"
                          min={-50}
                          max={50}
                          step={1}
                          value={ready.panX}
                          disabled={ready.zoom <= 1}
                          onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            updateReadyView((current) => ({
                              ...current,
                              panX: value,
                            }));
                          }}
                          className="min-h-8 w-full accent-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50"
                        />
                        <output
                          htmlFor={panXId}
                          className="block text-xs text-white/65"
                        >
                          {ready.panX}%
                        </output>
                      </div>
                      <div className="min-w-0 space-y-1">
                        <label htmlFor={panYId} className="block text-xs">
                          同步垂直平移
                        </label>
                        <input
                          id={panYId}
                          data-testid="compare-pan-y"
                          type="range"
                          min={-50}
                          max={50}
                          step={1}
                          value={ready.panY}
                          disabled={ready.zoom <= 1}
                          onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            updateReadyView((current) => ({
                              ...current,
                              panY: value,
                            }));
                          }}
                          className="min-h-8 w-full accent-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50"
                        />
                        <output
                          htmlFor={panYId}
                          className="block text-xs text-white/65"
                        >
                          {ready.panY}%
                        </output>
                      </div>
                    </div>
                  )}

                  {ready.mode === 'overlay' && (
                    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1">
                        <label htmlFor={opacityId} className="block text-xs">
                          After 版本透明度
                        </label>
                        <input
                          id={opacityId}
                          data-testid="compare-opacity"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={ready.opacity}
                          disabled={ready.manualOverlayMode !== null}
                          onChange={(event) => {
                            const value = event.currentTarget.valueAsNumber;
                            updateReadyView((current) => ({
                              ...current,
                              opacity: value,
                            }));
                          }}
                          className="min-h-8 w-full accent-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-50"
                        />
                        <output
                          htmlFor={opacityId}
                          className="block text-xs text-white/65"
                        >
                          {ready.manualOverlayMode
                            ? '手動切換中'
                            : ready.opacity + '%'}
                        </output>
                      </div>
                      <div className="flex min-w-0 items-end">
                        <button
                          type="button"
                          data-testid="compare-blink"
                          aria-pressed={ready.manualOverlayMode !== null}
                          onClick={() =>
                            updateReadyView((current) => ({
                              ...current,
                              manualOverlayMode:
                                current.manualOverlayMode === null
                                  ? 'after'
                                  : current.manualOverlayMode === 'after'
                                    ? 'before'
                                    : null,
                            }))
                          }
                          className="min-h-10 max-w-full rounded-md border border-white/25 px-3 text-left text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                        >
                          {ready.manualOverlayMode === null
                            ? '手動顯示 After'
                            : ready.manualOverlayMode === 'after'
                              ? '手動顯示 Before'
                              : '恢復透明疊合'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {afterVersion && (
            <GuestAnnotationsPanel
              key={
                'annotations:' +
                albumId +
                ':' +
                photoId +
                ':' +
                afterVersion.versionId
              }
              albumId={albumId}
              photoId={photoId}
              versionId={afterVersion.versionId}
              filename={filename}
              versionNo={afterVersion.versionNo}
              previewUrl={afterVersion.previewUrl}
              isCurrentVersion={afterVersion.isCurrent}
              freehandReadCapability={true}
              onPendingChange={onAnnotationPending}
              onUnauthorized={onUnauthorized}
            />
          )}

          {afterVersion && (
            <GuestCommentsPanel
              key={`${albumId}:${photoId}:${afterVersion.versionId}`}
              albumId={albumId}
              photoId={photoId}
              versionId={afterVersion.versionId}
              filename={filename}
              versionNo={afterVersion.versionNo}
            />
          )}

          {ready.loadMoreError && (
            <p role="alert" className="text-xs text-red-200">
              無法載入下一頁版本，已保留目前授權頁面；請明確重試。
            </p>
          )}

          {ready.nextCursor !== null && (
            <button
              type="button"
              data-testid="compare-load-more"
              disabled={ready.loadingMore}
              onClick={() => void loadMore()}
              className="min-h-10 rounded-md border border-white/25 px-3 text-sm hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-wait disabled:opacity-60"
            >
              {ready.loadingMore ? '載入中…' : '載入更多版本'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
