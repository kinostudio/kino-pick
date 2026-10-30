'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ownerPhotoVersionsPageSchema,
  photoVersionsCapabilitiesSchema,
  type OwnerPhotoVersionsPage,
  type PhotoVersionItem,
} from '../../../packages/contracts/src/photo-versions';
import {
  VersionComparisonCanvas,
  type CompareMode,
  type ManualOverlayMode,
} from './version-comparison-canvas';

type ReadState =
  | { scopeKey: string; status: 'loading' }
  | { scopeKey: string; status: 'disabled' }
  | { scopeKey: string; status: 'denied' }
  | { scopeKey: string; status: 'stale' }
  | { scopeKey: string; status: 'error'; message: string }
  | {
      scopeKey: string;
      status: 'ready';
      generation: number;
      page: OwnerPhotoVersionsPage;
      versions: PhotoVersionItem[];
      seenCursors: string[];
      loadingMore: boolean;
      moreError: string;
    };

type CapabilityState = {
  scopeKey: string;
  status: 'checking' | 'enabled' | 'disabled' | 'error';
};

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Owner version comparison request failed');
  }
}

function responseErrorCode(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return '';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}

async function requestBody(
  url: string,
  signal: AbortSignal,
): Promise<{ body: unknown; status: number }> {
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiFailure(response.status, responseErrorCode(body));
  }
  return { body, status: response.status };
}

function versionsUrl(photoId: string, cursor: string | null): string {
  const base = '/api/v1/photos/' + encodeURIComponent(photoId) + '/versions';
  return cursor === null
    ? base
    : base + '?cursor=' + encodeURIComponent(cursor);
}

async function fetchCapabilities(signal: AbortSignal): Promise<boolean> {
  const response = await requestBody(
    '/api/v1/photo-versions/capabilities',
    signal,
  );
  const parsed = photoVersionsCapabilitiesSchema.safeParse(response.body);
  if (!parsed.success) throw new ApiFailure(502, 'INVALID_RESPONSE');
  return parsed.data.enabled;
}

async function fetchVersionsPage(
  photoId: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<OwnerPhotoVersionsPage> {
  const response = await requestBody(versionsUrl(photoId, cursor), signal);
  const parsed = ownerPhotoVersionsPageSchema.safeParse(response.body);
  if (!parsed.success || parsed.data.photoId !== photoId) {
    throw new ApiFailure(502, 'INVALID_RESPONSE');
  }
  if (parsed.data.currentVersion.id !== parsed.data.current.versionId) {
    throw new ApiFailure(502, 'INVALID_HEAD');
  }
  return parsed.data;
}

function sameHead(
  left: OwnerPhotoVersionsPage['current'],
  right: OwnerPhotoVersionsPage['current'],
): boolean {
  return left.versionId === right.versionId && left.revision === right.revision;
}

function hasReadyPreview(version: PhotoVersionItem): boolean {
  return version.processing === 'succeeded' && version.previewUrl !== null;
}

function uniqueVersions(
  first: PhotoVersionItem[],
  second: PhotoVersionItem[],
): PhotoVersionItem[] {
  const seen = new Set<string>();
  return [...first, ...second].filter((version) => {
    if (seen.has(version.id)) return false;
    seen.add(version.id);
    return true;
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure && error.status === 503) {
    return '版本比較目前暫時無法載入，請稍後重試。';
  }
  if (error instanceof ApiFailure && error.status === 404) {
    return '找不到這張照片的版本紀錄，請重新整理相簿。';
  }
  return '目前無法載入版本比較資料，請稍後重試。';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Taipei',
  }).format(new Date(value));
}

function candidatesFor(
  versions: PhotoVersionItem[],
  currentVersionId: string,
): PhotoVersionItem[] {
  return versions.filter(
    (version) => version.id !== currentVersionId && hasReadyPreview(version),
  );
}

function preferredCandidate(
  versions: PhotoVersionItem[],
  currentVersion: PhotoVersionItem,
): PhotoVersionItem | undefined {
  const candidates = candidatesFor(versions, currentVersion.id);
  return (
    candidates
      .filter((version) => version.versionNo < currentVersion.versionNo)
      .sort((left, right) => right.versionNo - left.versionNo)[0] ??
    candidates
      .filter((version) => version.versionNo > currentVersion.versionNo)
      .sort((left, right) => left.versionNo - right.versionNo)[0]
  );
}

export type OwnerVersionComparisonPanelProps = {
  albumId: string;
  photoId: string;
  filename: string;
  expectedCurrentVersionId: string;
  onUnauthorized?: (status: 401 | 403) => void;
  onHeadChanged?: () => void;
  onGateHidden?: () => void;
};

export function OwnerVersionComparisonPanel({
  albumId,
  photoId,
  filename,
  expectedCurrentVersionId,
  onUnauthorized,
  onHeadChanged,
  onGateHidden,
}: OwnerVersionComparisonPanelProps) {
  const scopeKey = JSON.stringify([
    'owner',
    albumId,
    photoId,
    expectedCurrentVersionId,
  ]);
  const panelId = useId();
  const versionSelectId = useId();
  const [capability, setCapability] = useState<CapabilityState>({
    scopeKey,
    status: 'checking',
  });
  const [read, setRead] = useState<ReadState>({
    scopeKey,
    status: 'loading',
  });
  const [expanded, setExpanded] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [mode, setMode] = useState<CompareMode>('slider');
  const [splitPosition, setSplitPosition] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [opacity, setOpacity] = useState(50);
  const [manualOverlayMode, setManualOverlayMode] =
    useState<ManualOverlayMode>(null);

  const generationRef = useRef(0);
  const readAbortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);
  const moreInFlightRef = useRef(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const entryButtonRef = useRef<HTMLButtonElement | null>(null);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const onHeadChangedRef = useRef(onHeadChanged);
  const onGateHiddenRef = useRef(onGateHidden);

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
    onHeadChangedRef.current = onHeadChanged;
    onGateHiddenRef.current = onGateHidden;
  }, [onGateHidden, onHeadChanged, onUnauthorized]);

  const recoverFocusBeforeReset = useCallback(() => {
    if (sectionRef.current?.contains(document.activeElement)) {
      sectionRef.current.focus();
    }
  }, []);

  const resetComparisonControls = useCallback(() => {
    setExpanded(false);
    setSelectedVersionId(null);
    setMode('slider');
    setSplitPosition(50);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setOpacity(50);
    setManualOverlayMode(null);
  }, []);

  const clearForUnauthorized = useCallback(
    (status: 401 | 403) => {
      readAbortRef.current?.abort();
      moreAbortRef.current?.abort();
      moreInFlightRef.current = false;
      generationRef.current += 1;
      setCapability({ scopeKey, status: 'disabled' });
      setRead({ scopeKey, status: 'denied' });
      resetComparisonControls();
      onUnauthorizedRef.current?.(status);
    },
    [resetComparisonControls, scopeKey],
  );

  const hideForGate = useCallback(() => {
    if (sectionRef.current?.contains(document.activeElement)) {
      onGateHiddenRef.current?.();
    }
    readAbortRef.current?.abort();
    moreAbortRef.current?.abort();
    moreInFlightRef.current = false;
    generationRef.current += 1;
    setCapability({ scopeKey, status: 'disabled' });
    setRead({ scopeKey, status: 'disabled' });
    resetComparisonControls();
  }, [resetComparisonControls, scopeKey]);

  const loadFirstPage = useCallback(async () => {
    recoverFocusBeforeReset();
    readAbortRef.current?.abort();
    moreAbortRef.current?.abort();
    moreAbortRef.current = null;
    moreInFlightRef.current = false;
    resetComparisonControls();

    const generation = ++generationRef.current;
    const controller = new AbortController();
    readAbortRef.current = controller;
    setRead({ scopeKey, status: 'loading' });

    const isCurrentRequest = () =>
      !controller.signal.aborted && generationRef.current === generation;

    try {
      const enabled = await fetchCapabilities(controller.signal);
      if (!isCurrentRequest()) return;
      if (!enabled) {
        hideForGate();
        return;
      }
      setCapability({ scopeKey, status: 'enabled' });

      const page = await fetchVersionsPage(photoId, null, controller.signal);
      if (!isCurrentRequest()) return;
      if (page.current.versionId !== expectedCurrentVersionId) {
        setRead({ scopeKey, status: 'stale' });
        onHeadChangedRef.current?.();
        return;
      }

      const versions = uniqueVersions([], page.versions);
      const initialCandidate = preferredCandidate(
        versions,
        page.currentVersion,
      );
      setSelectedVersionId(initialCandidate?.id ?? null);
      setRead({
        scopeKey,
        status: 'ready',
        generation,
        page,
        versions,
        seenCursors: [],
        loadingMore: false,
        moreError: '',
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (
        error instanceof ApiFailure &&
        (error.status === 401 || error.status === 403)
      ) {
        clearForUnauthorized(error.status);
      } else if (
        error instanceof ApiFailure &&
        error.code === 'PHOTO_VERSIONS_DISABLED'
      ) {
        hideForGate();
      } else {
        setCapability((current) =>
          current.scopeKey === scopeKey && current.status === 'enabled'
            ? current
            : { scopeKey, status: 'error' },
        );
        setRead({ scopeKey, status: 'error', message: errorMessage(error) });
      }
    } finally {
      if (readAbortRef.current === controller) readAbortRef.current = null;
    }
  }, [
    clearForUnauthorized,
    expectedCurrentVersionId,
    hideForGate,
    photoId,
    recoverFocusBeforeReset,
    resetComparisonControls,
    scopeKey,
  ]);

  useEffect(() => {
    setCapability({ scopeKey, status: 'checking' });
    void loadFirstPage();
    return () => {
      generationRef.current += 1;
      readAbortRef.current?.abort();
      moreAbortRef.current?.abort();
      readAbortRef.current = null;
      moreAbortRef.current = null;
      moreInFlightRef.current = false;
    };
  }, [loadFirstPage, scopeKey]);

  const activeRead =
    read.scopeKey === scopeKey && read.status === 'ready' ? read : null;
  const stateForScope = read.scopeKey === scopeKey ? read : null;
  const currentVersion = activeRead?.page.currentVersion ?? null;
  const candidateVersions = activeRead
    ? candidatesFor(activeRead.versions, activeRead.page.current.versionId)
    : [];
  const selectedVersion =
    selectedVersionId === null
      ? undefined
      : candidateVersions.find((version) => version.id === selectedVersionId);
  const currentVersionIsReady =
    currentVersion !== null && hasReadyPreview(currentVersion);
  const canCompare = currentVersionIsReady && selectedVersion !== undefined;
  const showGateContent =
    capability.scopeKey === scopeKey &&
    (capability.status === 'enabled' || capability.status === 'error');

  const handleImageError = useCallback(
    (versionId: string) => {
      if (!activeRead) return;
      const isPairMember =
        versionId === activeRead.page.current.versionId ||
        selectedVersionId === versionId;
      if (!isPairMember) return;

      readAbortRef.current?.abort();
      moreAbortRef.current?.abort();
      moreInFlightRef.current = false;
      generationRef.current += 1;
      setExpanded(false);
      setSelectedVersionId(null);
      setRead({
        scopeKey,
        status: 'error',
        message: '預覽目前無法載入，畫布已清除。請重新讀取目前版本。',
      });
      window.requestAnimationFrame(() => retryButtonRef.current?.focus());
    },
    [activeRead, scopeKey, selectedVersionId],
  );

  const loadMore = useCallback(async () => {
    const current = activeRead;
    if (
      !current ||
      !current.page.nextCursor ||
      current.loadingMore ||
      moreInFlightRef.current
    ) {
      return;
    }

    const cursor = current.page.nextCursor;
    const generation = current.generation;
    const expectedHead = current.page.current;
    const controller = new AbortController();
    moreAbortRef.current?.abort();
    moreAbortRef.current = controller;
    moreInFlightRef.current = true;
    setRead((previous) =>
      previous.scopeKey === scopeKey && previous.status === 'ready'
        ? { ...previous, loadingMore: true, moreError: '' }
        : previous,
    );

    const isCurrentRequest = () =>
      !controller.signal.aborted && generationRef.current === generation;

    try {
      const enabled = await fetchCapabilities(controller.signal);
      if (!isCurrentRequest()) return;
      if (!enabled) {
        hideForGate();
        return;
      }

      const page = await fetchVersionsPage(photoId, cursor, controller.signal);
      if (!isCurrentRequest()) return;
      if (
        page.photoId !== current.page.photoId ||
        !sameHead(page.current, expectedHead) ||
        current.seenCursors.includes(cursor) ||
        page.nextCursor === cursor
      ) {
        void loadFirstPage();
        return;
      }

      const nextVersions = uniqueVersions(current.versions, page.versions);
      const nextCandidates = candidatesFor(
        nextVersions,
        page.current.versionId,
      );
      setSelectedVersionId((selected) =>
        selected && nextCandidates.some((version) => version.id === selected)
          ? selected
          : (preferredCandidate(nextVersions, page.currentVersion)?.id ?? null),
      );
      setRead((previous) => {
        if (
          previous.scopeKey !== scopeKey ||
          previous.status !== 'ready' ||
          previous.generation !== generation
        ) {
          return previous;
        }
        return {
          ...previous,
          page: { ...previous.page, nextCursor: page.nextCursor },
          versions: nextVersions,
          seenCursors: [...previous.seenCursors, cursor],
          loadingMore: false,
          moreError: '',
        };
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      if (
        error instanceof ApiFailure &&
        (error.status === 401 || error.status === 403)
      ) {
        clearForUnauthorized(error.status);
      } else if (
        error instanceof ApiFailure &&
        (error.status === 400 ||
          error.status === 409 ||
          error.code === 'PHOTO_VERSION_REVISION_CONFLICT')
      ) {
        void loadFirstPage();
      } else if (
        error instanceof ApiFailure &&
        error.code === 'PHOTO_VERSIONS_DISABLED'
      ) {
        hideForGate();
      } else {
        setRead((previous) =>
          previous.scopeKey === scopeKey && previous.status === 'ready'
            ? {
                ...previous,
                loadingMore: false,
                moreError: errorMessage(error),
              }
            : previous,
        );
      }
    } finally {
      if (moreAbortRef.current === controller) {
        moreAbortRef.current = null;
        moreInFlightRef.current = false;
      }
    }
  }, [
    activeRead,
    clearForUnauthorized,
    hideForGate,
    loadFirstPage,
    photoId,
    scopeKey,
  ]);

  const onSelectVersion = (versionId: string) => {
    setSelectedVersionId(versionId);
    setMode('slider');
    setSplitPosition(50);
    setZoom(1);
    setPanX(0);
    setPanY(0);
    setOpacity(50);
    setManualOverlayMode(null);
  };

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setExpanded(false);
      window.requestAnimationFrame(() =>
        (entryButtonRef.current ?? sectionRef.current)?.focus(),
      );
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !canCompare) return;
    const frame = window.requestAnimationFrame(() =>
      entryButtonRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [canCompare, expanded]);
  if (!showGateContent) return null;

  const isChecking =
    capability.scopeKey !== scopeKey || capability.status === 'checking';
  const retry = () => void loadFirstPage();

  return (
    <section
      ref={sectionRef}
      aria-label="Owner 照片版本比較"
      tabIndex={-1}
      aria-busy={isChecking || stateForScope?.status === 'loading'}
      data-owner-version-comparison
      className="mt-3 min-w-0 rounded-xl border border-stone-200 bg-white p-3 text-stone-900 sm:p-4"
    >
      {isChecking || stateForScope?.status === 'loading' ? (
        <p className="text-sm text-stone-600" role="status">
          正在確認可比較的版本…
        </p>
      ) : stateForScope?.status === 'stale' ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-900" role="status">
            照片目前版本已更新，正在重新載入相簿。
          </p>
          <button
            type="button"
            onClick={() => onHeadChangedRef.current?.()}
            className="min-h-11 rounded-md border border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            重新整理相簿
          </button>
        </div>
      ) : stateForScope?.status === 'error' ? (
        <div className="space-y-2">
          <p className="text-sm text-stone-700" role="alert">
            {stateForScope.message}
          </p>
          <button
            ref={retryButtonRef}
            type="button"
            onClick={retry}
            className="min-h-11 rounded-md border border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            重新檢查版本比較功能
          </button>
        </div>
      ) : activeRead && !currentVersionIsReady ? (
        <p className="text-sm text-stone-600" role="status">
          目前版本的私有預覽尚未就緒，暫時無法比較。
        </p>
      ) : activeRead && candidateVersions.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-stone-600" role="status">
            尚未載入其他可比較的預覽版本。
          </p>
          {(activeRead.page.nextCursor || expanded) && (
            <button
              ref={entryButtonRef}
              type="button"
              data-testid="owner-version-comparison-entry"
              aria-expanded={expanded}
              aria-controls={panelId}
              aria-busy={activeRead.loadingMore}
              onClick={() => {
                if (expanded) {
                  setExpanded(false);
                  if (!activeRead.page.nextCursor) {
                    window.requestAnimationFrame(() =>
                      sectionRef.current?.focus(),
                    );
                  }
                } else if (activeRead.page.nextCursor) {
                  setExpanded(true);
                  void loadMore();
                }
              }}
              className="min-h-11 rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {expanded ? '收起版本比較' : '開啟版本比較'}
            </button>
          )}
          {expanded && (
            <div
              id={panelId}
              className="rounded-md bg-stone-50 p-3"
              data-owner-version-comparison-expanded
            >
              <p className="text-sm text-stone-600" role="status">
                {activeRead.loadingMore
                  ? '正在載入其他版本…'
                  : '載入更多版本以尋找可比較的預覽。'}
              </p>
            </div>
          )}
          {activeRead.page.nextCursor ? (
            <button
              type="button"
              data-testid="owner-version-comparison-load-more"
              onClick={() => void loadMore()}
              aria-busy={activeRead.loadingMore}
              className="min-h-11 rounded-md border border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
            >
              {activeRead.loadingMore ? '正在載入版本…' : '載入更多版本'}
            </button>
          ) : (
            <p className="text-xs text-stone-500">
              目前沒有第二個已就緒的私有預覽。
            </p>
          )}
          {activeRead.moreError && (
            <p role="alert" className="text-sm text-amber-900">
              {activeRead.moreError}
            </p>
          )}
        </div>
      ) : activeRead && selectedVersion && currentVersion ? (
        <>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">比較目前版本</h2>
              <p className="mt-1 text-xs text-stone-600">
                只讀取此登入工作階段可存取且已完成處理的預覽。
              </p>
            </div>
            <button
              ref={entryButtonRef}
              type="button"
              data-testid="owner-version-comparison-entry"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setExpanded((value) => !value)}
              className="min-h-11 rounded-md bg-stone-900 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {expanded ? '收起版本比較' : '開啟版本比較'}
            </button>
          </div>

          <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="min-w-0">
              <label
                htmlFor={versionSelectId}
                className="mb-1 block text-xs font-medium text-stone-700"
              >
                對照版本
              </label>
              <select
                id={versionSelectId}
                data-testid="owner-version-comparison-select"
                value={selectedVersion.id}
                onChange={(event) => onSelectVersion(event.currentTarget.value)}
                className="min-h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {candidateVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    第 {version.versionNo} 版 · {formatDate(version.createdAt)}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0 rounded-md bg-stone-50 p-2 text-xs">
              <p className="font-medium">
                目前版本 · 第 {currentVersion.versionNo} 版
              </p>
              <p className="mt-1 text-stone-600">
                {formatDate(currentVersion.createdAt)}
                {currentVersion.width !== null && currentVersion.height !== null
                  ? ' · ' +
                    currentVersion.width.toLocaleString('zh-TW') +
                    ' × ' +
                    currentVersion.height.toLocaleString('zh-TW') +
                    ' px'
                  : ''}
              </p>
            </div>
          </div>

          {expanded && canCompare && (
            <div
              id={panelId}
              className="mt-4 min-w-0 space-y-3"
              data-owner-version-comparison-expanded
            >
              <div
                className="flex min-w-0 flex-wrap gap-2"
                role="group"
                aria-label="比較顯示方式"
              >
                {(
                  [
                    ['slider', '滑桿'],
                    ['side', '並排'],
                    ['overlay', '透明疊合'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    data-testid={'owner-version-comparison-mode-' + value}
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                    className="min-h-11 rounded-md border border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 aria-pressed:border-stone-900 aria-pressed:bg-stone-900 aria-pressed:text-white"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <p
                data-testid="owner-version-comparison-pair"
                className="text-sm font-medium text-stone-700"
              >
                對照版本第 {selectedVersion.versionNo} 版 → 目前版本第{' '}
                {currentVersion.versionNo} 版
              </p>

              <VersionComparisonCanvas
                scopeKey={
                  'owner:' +
                  albumId +
                  ':' +
                  photoId +
                  ':' +
                  activeRead.page.current.versionId +
                  ':' +
                  activeRead.page.current.revision +
                  ':' +
                  selectedVersion.id +
                  ':' +
                  activeRead.generation
                }
                mode={mode}
                before={{
                  id: selectedVersion.id,
                  src: selectedVersion.previewUrl!,
                  alt:
                    filename +
                    '，對照版本第 ' +
                    selectedVersion.versionNo +
                    ' 版',
                  caption:
                    '對照版本 · 第 ' +
                    selectedVersion.versionNo +
                    ' 版 · ' +
                    formatDate(selectedVersion.createdAt),
                  label: '對照版本',
                  retryKey:
                    activeRead.generation +
                    ':' +
                    activeRead.page.current.revision,
                  badge: '對照',
                }}
                after={{
                  id: currentVersion.id,
                  src: currentVersion.previewUrl!,
                  alt:
                    filename +
                    '，目前版本第 ' +
                    currentVersion.versionNo +
                    ' 版',
                  caption:
                    '目前版本 · 第 ' +
                    currentVersion.versionNo +
                    ' 版 · ' +
                    formatDate(currentVersion.createdAt),
                  label: '目前版本',
                  retryKey:
                    activeRead.generation +
                    ':' +
                    activeRead.page.current.revision,
                  badge: '目前',
                }}
                splitPosition={splitPosition}
                onSplitPositionChange={setSplitPosition}
                zoom={zoom}
                panX={panX}
                panY={panY}
                opacity={opacity}
                manualOverlayMode={manualOverlayMode}
                onImageError={handleImageError}
                testIdPrefix="owner-compare"
                ariaLabel="Owner 照片版本比較畫布"
                maxWidthClassName="max-w-[56vh]"
              />

              {mode === 'side' && (
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="min-w-0 space-y-1 text-xs">
                    <span className="block">縮放 · {zoom.toFixed(2)}×</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.05}
                      value={zoom}
                      onChange={(event) =>
                        setZoom(event.currentTarget.valueAsNumber)
                      }
                      aria-label="比較畫面縮放"
                      className="min-h-11 w-full accent-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                  </label>
                  <label className="min-w-0 space-y-1 text-xs">
                    <span className="block">水平位置 · {panX}%</span>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={panX}
                      onChange={(event) =>
                        setPanX(event.currentTarget.valueAsNumber)
                      }
                      aria-label="比較畫面水平位置"
                      className="min-h-11 w-full accent-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                  </label>
                  <label className="min-w-0 space-y-1 text-xs">
                    <span className="block">垂直位置 · {panY}%</span>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={1}
                      value={panY}
                      onChange={(event) =>
                        setPanY(event.currentTarget.valueAsNumber)
                      }
                      aria-label="比較畫面垂直位置"
                      className="min-h-11 w-full accent-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    />
                  </label>
                </div>
              )}

              {mode === 'overlay' && (
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label className="min-w-0 space-y-1 text-xs">
                    <span className="block">
                      目前版本透明度
                      {manualOverlayMode
                        ? ' · 手動顯示中'
                        : ' · ' + opacity + '%'}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={opacity}
                      disabled={manualOverlayMode !== null}
                      onChange={(event) =>
                        setOpacity(event.currentTarget.valueAsNumber)
                      }
                      aria-label="目前版本透明度"
                      className="min-h-11 w-full accent-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                    />
                  </label>
                  <button
                    type="button"
                    aria-pressed={manualOverlayMode !== null}
                    onClick={() =>
                      setManualOverlayMode((current) =>
                        current === null
                          ? 'after'
                          : current === 'after'
                            ? 'before'
                            : null,
                      )
                    }
                    className="min-h-11 rounded-md border border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {manualOverlayMode === null
                      ? '手動顯示目前版本'
                      : manualOverlayMode === 'after'
                        ? '手動顯示對照版本'
                        : '恢復透明疊合'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeRead.page.nextCursor && (
            <div className="mt-3">
              {activeRead.moreError && (
                <p role="alert" className="mb-2 text-sm text-amber-900">
                  {activeRead.moreError}
                </p>
              )}
              <button
                type="button"
                data-testid="owner-version-comparison-load-more"
                aria-busy={activeRead.loadingMore}
                onClick={() => void loadMore()}
                className="min-h-11 rounded-md border border-stone-400 px-3 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              >
                {activeRead.loadingMore ? '正在載入版本…' : '載入更多版本'}
              </button>
            </div>
          )}
        </>
      ) : stateForScope?.status === 'disabled' ||
        stateForScope?.status === 'denied' ? null : (
        <p className="text-sm text-stone-600" role="status">
          目前沒有可供比較的版本資料。
        </p>
      )}
    </section>
  );
}
