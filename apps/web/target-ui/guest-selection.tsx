'use client';

import { StudioIcon } from './studio-icons';
import { GuestDeliveryNotifications } from './delivery-notifications';
import './album-gallery-view.css';
import './guest-gallery-view.css';

import { KinoLogo } from './kino-logo';
import { GuestExpiry } from './guest-expiry';
import { ClientActivityTracker } from './client-activity';
import { GuestAnnotationsPanel } from './guest-annotations';
import {
  GuestCommentsPanel,
  GuestBatchCommentComposer,
} from './guest-comments';

import { GuestVersionComparison } from './guest-version-comparison';
import { GuestVersionComparisonButton } from './guest-version-entry';

import { GuestHistoryLink } from './guest-history';
import {
  GuestTagsProvider,
  GuestTagControls,
  GuestBatchTagControls,
} from './guest-tags';

import { GuestSharedReviewLinks } from './shared-review-guest';
import { GuestDownloadsPanel } from './guest-downloads';
import { GuestDeliveryPanel } from './approved-deliveries';
import { GuestVersionApprovalsPanel } from './version-approvals';
import { CaptureMetadataDetails } from './capture-metadata';
import { usePhotoFilmstripWindow } from './photo-filmstrip';
import {
  HumanPhotoViewsProvider,
  TrackedPhotoImage,
} from './human-photo-views';

import { GuestFeedbackProvider, GuestFeedbackControls } from './guest-feedback';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { planSelectionBatch } from '../../../packages/domain/src/selection-bounds';
import { Button } from '@kino-pic/ui';
import {
  galleryPageSchema,
  type GalleryPhoto,
} from '../../../packages/contracts/src/gallery';
import {
  guestSelectionPageSchema,
  guestSelectionResultSchema,
  guestSelectionSubmissionResultSchema,
  type GuestSelectionPage,
} from '../../../packages/contracts/src/guest-actions';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; statusCode: number; code: string };

type GalleryPage = z.infer<typeof galleryPageSchema>;

type GuestSelectionSnapshot = {
  page: GuestSelectionPage;
  selectedMap: Map<string, string>;
};

class ApiFailure extends Error {
  constructor(
    public statusCode: number,
    public code: string,
  ) {
    super(code);
  }
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(body);
    throw new ApiFailure(
      response.status,
      parsed.success ? parsed.data.error.code : 'SERVICE_UNAVAILABLE',
    );
  }
  return schema.parse(body);
}

function hasSameSelectionSummary(
  left: GuestSelectionPage,
  right: GuestSelectionPage,
) {
  return (
    left.selectedCount === right.selectedCount &&
    left.roundNo === right.roundNo &&
    left.selectionRevision === right.selectionRevision &&
    left.roundStatus === right.roundStatus &&
    left.submittedAt === right.submittedAt &&
    left.canSubmit === right.canSubmit &&
    left.selectionPolicy.revision === right.selectionPolicy.revision &&
    left.selectionPolicy.minimum === right.selectionPolicy.minimum &&
    left.selectionPolicy.maximum === right.selectionPolicy.maximum &&
    left.selectionPolicy.mode === right.selectionPolicy.mode &&
    left.selectionPolicy.source === right.selectionPolicy.source &&
    left.selectionPolicy.albumRevision ===
      right.selectionPolicy.albumRevision &&
    (left.selectionPolicy.source === 'album' ||
      left.selectionPolicy.projectRevision ===
        right.selectionPolicy.projectRevision)
  );
}

async function loadGuestSelectionSnapshot(
  albumId: string,
): Promise<GuestSelectionSnapshot> {
  let lastError: unknown = new ApiFailure(409, 'SELECTION_CHANGED');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const selectedMap = new Map<string, string>();
    const seenCursors = new Set<string>();
    let firstPage: GuestSelectionPage | null = null;
    let cursor: string | null = null;

    try {
      while (true) {
        const query: string = cursor
          ? `?cursor=${encodeURIComponent(cursor)}`
          : '';
        const page: GuestSelectionPage = await requestJson<GuestSelectionPage>(
          `/api/guest/albums/${albumId}/selection${query}`,
          guestSelectionPageSchema,
        );

        if (firstPage && !hasSameSelectionSummary(firstPage, page)) {
          throw new ApiFailure(409, 'SELECTION_CHANGED');
        }
        firstPage ??= page;

        for (const item of page.items) {
          if (selectedMap.has(item.photoId)) {
            throw new ApiFailure(409, 'SELECTION_CHANGED');
          }
          selectedMap.set(item.photoId, item.versionId);
        }

        cursor = page.nextCursor;
        if (!cursor) break;
        if (seenCursors.has(cursor)) {
          throw new ApiFailure(409, 'SELECTION_CHANGED');
        }
        seenCursors.add(cursor);
      }

      if (!firstPage || selectedMap.size !== firstPage.selectedCount) {
        throw new ApiFailure(409, 'SELECTION_CHANGED');
      }

      // Confirm the cursor walk still matches the current first-page revision.
      const confirmedPage = await requestJson(
        `/api/guest/albums/${albumId}/selection`,
        guestSelectionPageSchema,
      );
      if (
        !hasSameSelectionSummary(firstPage, confirmedPage) ||
        selectedMap.size !== confirmedPage.selectedCount
      ) {
        throw new ApiFailure(409, 'SELECTION_CHANGED');
      }

      return { page: confirmedPage, selectedMap };
    } catch (error) {
      lastError = error;
      if (
        attempt === 2 ||
        !(error instanceof ApiFailure && error.statusCode === 409)
      ) {
        throw error;
      }
    }
  }

  throw lastError;
}

export function GuestAlbumPage({ albumId }: { albumId: string }) {
  return <GuestAlbumPageContent key={albumId} albumId={albumId} />;
}

function GuestAlbumHeader({
  albumId,
  roundNo = 1,
  roundStatus = 'open',
  loggingOut,
  downloadOnly = false,
  canSelect = false,
  onLogout,
}: {
  albumId: string;
  roundNo?: number;
  roundStatus?: string;
  loggingOut: boolean;
  downloadOnly?: boolean;
  canSelect?: boolean;
  onLogout: () => void;
}) {
  return (
    <header className="guest-album-header sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="guest-album-header-inner mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="guest-album-brand-group">
          <span aria-hidden="true" className="guest-album-logo-wrap">
            <KinoLogo className="guest-album-logo" />
          </span>
          <div>
            <h1 className="guest-album-brand text-lg font-semibold sm:text-xl">
              Kino Pick{' '}
              <span className="font-normal text-stone-500">
                {downloadOnly ? '照片下載' : canSelect ? '線上挑片' : '相簿'}
              </span>
            </h1>
            <p className="guest-album-context text-xs text-stone-500 sm:text-sm">
              {downloadOnly ? (
                '相簿目前版本下載'
              ) : canSelect ? (
                <>
                  第 {roundNo} 輪挑片
                  {roundStatus === 'submitted' && (
                    <span className="ml-2 inline-flex items-center rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-800">
                      已送出凍結
                    </span>
                  )}
                </>
              ) : (
                '瀏覽相簿'
              )}
            </p>
            <GuestExpiry albumId={albumId} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <GuestDeliveryNotifications albumId={albumId} />
          {!downloadOnly && <GuestHistoryLink albumId={albumId} />}
          <Button
            type="button"
            variant="outline"
            disabled={loggingOut}
            onClick={onLogout}
            aria-label="離開相簿"
          >
            {loggingOut ? '登出中…' : '登出'}
          </Button>
        </div>
      </div>
    </header>
  );
}

function GuestAlbumPageContent({ albumId }: { albumId: string }) {
  const [galleryView, setGalleryView] = useState<'masonry' | 'list'>('masonry');
  const [photosState, setPhotosState] = useState<LoadState<GalleryPage[]>>({
    status: 'loading',
  });
  const [selectionState, setSelectionState] = useState<
    LoadState<GuestSelectionPage>
  >({ status: 'loading' });

  const [selectedMap, setSelectedMap] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [selectedCount, setSelectedCount] = useState(0);
  const [roundNo, setRoundNo] = useState(1);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [roundStatus, setRoundStatus] = useState<'open' | 'submitted'>('open');
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [galleryPageIndex, setGalleryPageIndex] = useState(0);
  const [galleryPageLoading, setGalleryPageLoading] = useState(false);
  const [galleryPageError, setGalleryPageError] = useState<string | null>(null);
  const [selectionRefreshing, setSelectionRefreshing] = useState(false);

  const [mutatingPhotoId, setMutatingPhotoId] = useState<string | null>(null);
  const [batchMutating, setBatchMutating] = useState(false);
  const [activePhoto, setActivePhoto] = useState<GalleryPhoto | null>(null);
  const [annotationCanvasHost, setAnnotationCanvasHost] =
    useState<HTMLDivElement | null>(null);
  const [annotationCanvasPortalActive, setAnnotationCanvasPortalActive] =
    useState(false);
  const setAnnotationCanvasHostRef = useCallback(
    (host: HTMLDivElement | null) => {
      setAnnotationCanvasHost(host);
    },
    [],
  );
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [annotationPending, setAnnotationPending] = useState(false);
  const annotationPendingRef = useRef(false);
  const onAnnotationPendingChange = useCallback((pending: boolean) => {
    annotationPendingRef.current = pending;
    setAnnotationPending(pending);
  }, []);
  const comparisonButtonRef = useRef<HTMLButtonElement | null>(null);
  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement | null>(null);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const lightboxTitleId = useId();
  const photoToolsId = lightboxTitleId + '-photo-tools';
  const [photoToolsOpen, setPhotoToolsOpen] = useState(true);
  const confirmTitleId = useId();
  const confirmDescId = useId();
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);
  const submitDialogRef = useRef<HTMLDivElement | null>(null);
  const submitSuccessRef = useRef<HTMLDivElement | null>(null);
  const confirmDialogWasOpenRef = useRef(false);
  const logoutRequestIdRef = useRef<string | null>(null);
  const selectionRequestGenerationRef = useRef(0);
  const onAnnotationsUnauthorized = useCallback(() => {
    // A current Guest 401 invalidates the shared gallery identity, including
    // the Lightbox preview outside the annotations panel. Keep recovery storage.
    selectionRequestGenerationRef.current++;
    annotationPendingRef.current = false;
    setAnnotationPending(false);
    setActivePhoto(null);
    setComparisonOpen(false);
    setConfirmSubmitOpen(false);
    setSelectedMap(new Map());
    setSelectedCount(0);
    setSubmittedAt(null);
    setPhotosState({
      status: 'error',
      statusCode: 401,
      code: 'GUEST_ACCESS_REQUIRED',
    });
    setSelectionState({
      status: 'error',
      statusCode: 401,
      code: 'GUEST_ACCESS_REQUIRED',
    });
  }, [
    setAnnotationPending,
    setActivePhoto,
    setComparisonOpen,
    setConfirmSubmitOpen,
    setSelectedMap,
    setSelectedCount,
    setSubmittedAt,
    setPhotosState,
    setSelectionState,
  ]);

  const selectionPolicy =
    selectionState.status === 'ready'
      ? selectionState.value.selectionPolicy
      : null;

  const selectionAtMaximum =
    selectionPolicy?.maximum != null &&
    selectedCount >= selectionPolicy.maximum;
  const canSubmit =
    selectionState.status === 'ready' && selectionState.value.canSubmit;
  const selectionWithinBounds =
    selectionPolicy !== null &&
    selectedCount >= selectionPolicy.minimum &&
    (selectionPolicy.maximum === null ||
      selectedCount <= selectionPolicy.maximum);

  const refreshSelection = useCallback(
    async (showLoading: boolean) => {
      const generation = ++selectionRequestGenerationRef.current;
      if (showLoading) setSelectionState({ status: 'loading' });
      setSelectionRefreshing(true);

      try {
        const snapshot = await loadGuestSelectionSnapshot(albumId);
        if (generation !== selectionRequestGenerationRef.current) return false;
        setSelectionState({ status: 'ready', value: snapshot.page });
        setSelectedMap(snapshot.selectedMap);
        setSelectedCount(snapshot.page.selectedCount);
        setRoundNo(snapshot.page.roundNo);
        setSelectionRevision(snapshot.page.selectionRevision);
        setRoundStatus(snapshot.page.roundStatus);
        setSubmittedAt(snapshot.page.submittedAt);
        return true;
      } catch (err) {
        if (generation !== selectionRequestGenerationRef.current) return false;
        const fail =
          err instanceof ApiFailure
            ? err
            : new ApiFailure(503, 'SERVICE_UNAVAILABLE');
        setSelectionState({
          status: 'error',
          statusCode: fail.statusCode,
          code: fail.code,
        });
        return false;
      } finally {
        if (generation === selectionRequestGenerationRef.current) {
          setSelectionRefreshing(false);
        }
      }
    },
    [albumId],
  );

  useEffect(() => {
    let active = true;
    void requestJson(`/api/guest/albums/${albumId}/photos`, galleryPageSchema)
      .then((photosData) => {
        if (!active) return;
        setPhotosState({ status: 'ready', value: [photosData] });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const fail =
          err instanceof ApiFailure
            ? err
            : new ApiFailure(503, 'SERVICE_UNAVAILABLE');
        setPhotosState({
          status: 'error',
          statusCode: fail.statusCode,
          code: fail.code,
        });
      });

    queueMicrotask(() => {
      if (active) void refreshSelection(true);
    });

    return () => {
      active = false;
      selectionRequestGenerationRef.current += 1;
    };
  }, [albumId, refreshSelection]);

  const loadNextGalleryPage = async () => {
    if (
      photosState.status !== 'ready' ||
      galleryPageLoading ||
      batchMutating ||
      mutatingPhotoId
    ) {
      return;
    }

    const cachedNext = galleryPageIndex + 1;
    if (cachedNext < photosState.value.length) {
      setActivePhoto(null);
      setGalleryPageIndex(cachedNext);
      setGalleryPageError(null);
      return;
    }

    const currentPage = photosState.value[galleryPageIndex];
    if (!currentPage?.nextCursor) return;

    setGalleryPageLoading(true);
    setGalleryPageError(null);
    try {
      const query = `?cursor=${encodeURIComponent(currentPage.nextCursor)}`;
      const nextPage = await requestJson(
        `/api/guest/albums/${albumId}/photos${query}`,
        galleryPageSchema,
      );
      setPhotosState((current) => {
        if (current.status !== 'ready') return current;
        return { status: 'ready', value: [...current.value, nextPage] };
      });
      setActivePhoto(null);
      setGalleryPageIndex(cachedNext);
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : 'SERVICE_UNAVAILABLE';
      setGalleryPageError(`無法載入下一頁照片 (${code})，請重試。`);
    } finally {
      setGalleryPageLoading(false);
    }
  };

  const loadPreviousGalleryPage = () => {
    if (galleryPageIndex === 0 || batchMutating || mutatingPhotoId) return;
    setActivePhoto(null);
    setGalleryPageIndex((current) => Math.max(0, current - 1));
    setGalleryPageError(null);
  };

  const applySelectionResult = (
    photoId: string,
    result: z.infer<typeof guestSelectionResultSchema>,
  ) => {
    setSelectedMap((previous) => {
      const next = new Map(previous);
      if (result.selected && result.selectedVersionId) {
        next.set(photoId, result.selectedVersionId);
      } else {
        next.delete(photoId);
      }
      return next;
    });
    setSelectedCount(result.selectedCount);
    if (result.roundNo !== undefined) setRoundNo(result.roundNo);
    if (result.selectionRevision !== undefined)
      setSelectionRevision(result.selectionRevision);
    if (result.roundStatus !== undefined) setRoundStatus(result.roundStatus);
  };

  const toggleSelection = async (photo: GalleryPhoto) => {
    if (
      roundStatus === 'submitted' ||
      mutatingPhotoId ||
      batchMutating ||
      selectionRefreshing
    ) {
      return;
    }
    const isSelected = selectedMap.has(photo.id);
    const nextSelected = !isSelected;
    if (nextSelected && selectionAtMaximum) {
      setSubmitError('已達挑片上限，請先取消一張照片再改選。');
      return;
    }
    setMutatingPhotoId(photo.id);
    setSubmitError(null);

    const requestId = crypto.randomUUID();
    try {
      const result = await requestJson(
        `/api/guest/albums/${albumId}/photos/${photo.id}/selection`,
        guestSelectionResultSchema,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            selected: nextSelected,
            versionId: photo.versionId,
          }),
        },
      );
      applySelectionResult(photo.id, result);
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : 'SERVICE_UNAVAILABLE';
      if (code === 'SELECTION_CHANGED' || code === 'REQUEST_ID_CONFLICT') {
        setSubmitError('選片狀態已變更，正在重新載入最新狀態。');
      } else if (code === 'SELECTION_LIMIT_REACHED') {
        setSubmitError('已達目前挑片上限，正在同步最新狀態。');
      } else {
        setSubmitError(`選片更新失敗 (${code})，請重試。`);
      }
    } finally {
      await refreshSelection(false);
      setMutatingPhotoId(null);
    }
  };

  const selectDisplayedPage = async (photos: GalleryPhoto[]) => {
    if (
      roundStatus === 'submitted' ||
      mutatingPhotoId ||
      batchMutating ||
      selectionRefreshing
    ) {
      return;
    }

    const pendingPhotos = planSelectionBatch(
      photos,
      selectedMap,
      selectedCount,
      selectionPolicy?.maximum ?? null,
    );
    if (pendingPhotos.length === 0) return;

    setBatchMutating(true);
    setSubmitError(null);
    let completed = 0;
    let failureCode: string | null = null;

    try {
      for (const photo of pendingPhotos) {
        try {
          const result = await requestJson(
            `/api/guest/albums/${albumId}/photos/${photo.id}/selection`,
            guestSelectionResultSchema,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requestId: crypto.randomUUID(),
                selected: true,
                versionId: photo.versionId,
              }),
            },
          );
          applySelectionResult(photo.id, result);
          completed += 1;
        } catch (err) {
          failureCode =
            err instanceof ApiFailure ? err.code : 'SERVICE_UNAVAILABLE';
          break;
        }
      }
    } finally {
      const refreshed = await refreshSelection(false);
      setBatchMutating(false);
      if (failureCode) {
        const skipped = pendingPhotos.length - completed - 1;
        setSubmitError(
          `本頁已完成選取 ${completed} 張，第 ${completed + 1} 張失敗 (${failureCode})，${skipped} 張尚未處理。${refreshed ? '已重新同步選片狀態。' : '請重新載入選片狀態。'}`,
        );
      } else if (!refreshed) {
        setSubmitError(
          '本頁選取已送出，但無法確認最新狀態，請重新載入選片狀態。',
        );
      }
    }
  };

  const submitSelection = async () => {
    if (
      submitting ||
      roundStatus === 'submitted' ||
      mutatingPhotoId ||
      batchMutating ||
      selectionRefreshing
    ) {
      return;
    }
    if (!canSubmit) return;
    if (!selectionWithinBounds) {
      setSubmitError('挑片張數尚未符合目前範圍，請依畫面提示調整。');
      setConfirmSubmitOpen(false);
      return;
    }
    if (selectedCount === 0) {
      setSubmitError('請至少選取一張照片後再送出挑片。');
      setConfirmSubmitOpen(false);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    const requestId = crypto.randomUUID();
    try {
      const result = await requestJson(
        `/api/guest/albums/${albumId}/selection/submit`,
        guestSelectionSubmissionResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId,
            expectedRoundNo: roundNo,
            expectedRevision: selectionRevision,
          }),
        },
      );

      setRoundStatus('submitted');
      setSubmittedAt(result.submittedAt);
      setSelectedCount(result.selectedCount);
      setSelectionRevision(result.selectionRevision);
      setSubmitSuccess(true);
      setConfirmSubmitOpen(false);
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : 'SERVICE_UNAVAILABLE';
      if (
        code === 'SELECTION_LIMIT_REACHED' ||
        code === 'SELECTION_MINIMUM_NOT_MET'
      ) {
        await refreshSelection(false);
        setSubmitError('挑片範圍已變更，請依最新提示調整後重新送出。');
      } else if (code === 'EMPTY_SELECTION') {
        setSubmitError('請至少選取一張照片後再送出挑片。');
      } else if (
        code === 'ROUND_ALREADY_SUBMITTED' ||
        code === 'SELECTION_REVISION_MISMATCH' ||
        code === 'SELECTION_ROUND_MISMATCH'
      ) {
        await refreshSelection(false);
        setSubmitError('本輪選片狀態已提交或已變更，已重新載入最新狀態。');
      } else {
        setSubmitError(`送出挑片失敗 (${code})，請重試。`);
      }
      setConfirmSubmitOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    const requestId = logoutRequestIdRef.current ?? crypto.randomUUID();
    logoutRequestIdRef.current = requestId;
    try {
      const response = await fetch('/api/guest/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const parsed = z
          .object({ error: z.object({ code: z.string() }) })
          .safeParse(body);
        const code = parsed.success
          ? parsed.data.error.code
          : 'SERVICE_UNAVAILABLE';
        throw new ApiFailure(response.status, code);
      }
      setLoggedOut(true);
      logoutRequestIdRef.current = null;
    } catch (err) {
      const code = err instanceof ApiFailure ? err.code : 'SERVICE_UNAVAILABLE';
      setLogoutError(`登出失敗 (${code})，此頁面仍保留；請使用相同請求重試。`);
    } finally {
      setLoggingOut(false);
    }
  };

  const openLightbox = (photo: GalleryPhoto) => {
    lastActiveElementRef.current = document.activeElement as HTMLElement | null;
    setComparisonOpen(false);
    setActivePhoto(photo);
    requestAnimationFrame(() => lightboxCloseRef.current?.focus());
  };

  const closeLightbox = () => {
    if (annotationPendingRef.current) return;
    setComparisonOpen(false);
    setActivePhoto(null);
    lastActiveElementRef.current?.focus();
  };

  // Keyboard navigation for Lightbox
  useEffect(() => {
    if (!activePhoto || photosState.status !== 'ready') return;
    const photos = photosState.value[galleryPageIndex]?.photos ?? [];
    const currentIndex = photos.findIndex((p) => p.id === activePhoto.id);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Tab') {
        const focusable = Array.from(
          lightboxRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !lightboxRef.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !lightboxRef.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first?.focus();
        }
        return;
      }
      if (
        annotationPendingRef.current &&
        ['Escape', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        e.preventDefault();
        return;
      }
      if (
        e.key !== 'Escape' &&
        e.target instanceof Element &&
        e.target.closest(
          '[data-testid="guest-annotations-panel"], [data-testid="annotation-canvas"]',
        )
      )
        return;
      if (e.key === 'Escape') {
        if (comparisonOpen) {
          setComparisonOpen(false);
          comparisonButtonRef.current?.focus();
          e.preventDefault();
        } else closeLightbox();
      } else if (comparisonOpen) {
        return;
      } else if (
        e.target instanceof HTMLElement &&
        (e.target.matches('input, select, textarea') ||
          e.target.isContentEditable)
      ) {
        return;
      } else if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) {
        const next = photos[currentIndex + 1];
        if (next) setActivePhoto(next);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        const prev = photos[currentIndex - 1];
        if (prev) setActivePhoto(prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePhoto, comparisonOpen, galleryPageIndex, photosState]);

  useEffect(() => {
    if (!confirmSubmitOpen) {
      if (confirmDialogWasOpenRef.current) {
        confirmDialogWasOpenRef.current = false;
        window.requestAnimationFrame(() => {
          const submitButton = submitButtonRef.current;
          if (submitButton?.isConnected && !submitButton.disabled) {
            submitButton.focus();
          } else {
            submitSuccessRef.current?.focus();
          }
        });
      }
      return;
    }

    confirmDialogWasOpenRef.current = true;
    const dialog = submitDialogRef.current;
    if (!dialog) return;

    const getDialogButtons = () =>
      Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).filter(
        (button) => !button.disabled && button.getClientRects().length > 0,
      );
    const firstButton = getDialogButtons()[0];
    if (firstButton) firstButton.focus();
    else dialog.focus();

    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!submitting) {
          event.preventDefault();
          setConfirmSubmitOpen(false);
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const buttons = getDialogButtons();
      const first = buttons[0];
      const last = buttons.at(-1);
      if (!first || !last) {
        event.preventDefault();
      } else if (
        (event.shiftKey &&
          (document.activeElement === first ||
            !dialog.contains(document.activeElement))) ||
        (!event.shiftKey &&
          (document.activeElement === last ||
            !dialog.contains(document.activeElement)))
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeyDown);
    return () => document.removeEventListener('keydown', handleDialogKeyDown);
  }, [confirmSubmitOpen, submitting]);

  const currentGalleryPage =
    photosState.status === 'ready'
      ? photosState.value[galleryPageIndex]
      : undefined;
  const photos = currentGalleryPage?.photos ?? [];
  const activePhotoIndex = photos.findIndex(
    (photo) => photo.id === activePhoto?.id,
  );
  const { navRef: photoFilmstripRef, items: photoFilmstripItems } =
    usePhotoFilmstripWindow(photos, activePhotoIndex);

  if (loggedOut) {
    return (
      <main className="guest-studio guest-state-page mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold text-stone-900">
          您已登出訪客選片
        </h1>
        <p className="mt-4 text-stone-600">
          如需再次存取此相簿，請重新點擊攝影師提供的專屬邀請連結。
        </p>
      </main>
    );
  }

  if (photosState.status === 'loading') {
    return (
      <main
        className="guest-studio guest-state-page mx-auto max-w-4xl px-6 py-16 text-center"
        role="status"
      >
        <p className="text-stone-600">載入相簿中…</p>
      </main>
    );
  }

  if (photosState.status === 'error') {
    if (photosState.statusCode === 401) {
      return (
        <div className="guest-studio guest-gallery-page guest-download-only min-h-screen bg-stone-50 text-stone-900">
          <GuestAlbumHeader
            albumId={albumId}
            loggingOut={loggingOut}
            downloadOnly
            onLogout={() => void handleLogout()}
          />
          {logoutError && (
            <div
              role="alert"
              className="mx-auto mt-4 max-w-6xl px-4 text-sm text-red-800 sm:px-6"
            >
              {logoutError}
            </div>
          )}
          <main className="guest-gallery-content mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <p role="status" className="text-sm text-stone-600">
              此連結目前無法使用，請聯絡攝影師。
            </p>
            <button
              type="button"
              className="mt-4 min-h-11 rounded-md border border-stone-300 px-3 text-sm"
              onClick={() => window.location.reload()}
            >
              重新載入
            </button>
            <GuestDownloadsPanel albumId={albumId} viewable={false} />
            <GuestDeliveryPanel albumId={albumId} />
          </main>
        </div>
      );
    }
    return (
      <main className="guest-studio guest-state-page mx-auto mt-12 max-w-xl px-6">
        <section
          role="alert"
          className="guest-state-card rounded-lg border border-amber-300 bg-amber-50 p-6 text-stone-900"
        >
          <h2 className="text-lg font-semibold">存取受限</h2>
          <p className="mt-2 text-sm text-stone-700">
            目前無法載入相簿內容，請稍後重新整理。
          </p>
        </section>
      </main>
    );
  }

  const navigatePreview = (photo: GalleryPhoto | undefined) => {
    if (!photo || annotationPendingRef.current || comparisonOpen) return;
    setActivePhoto(photo);
  };

  const hasNextGalleryPage =
    galleryPageIndex + 1 < photosState.value.length ||
    Boolean(currentGalleryPage?.nextCursor);
  const canSelect = selectionState.status === 'ready';
  const selectionBusy =
    selectionRefreshing || batchMutating || mutatingPhotoId !== null;

  return (
    <HumanPhotoViewsProvider
      key={'guest-views:' + albumId}
      mode="guest"
      albumId={albumId}
    >
      <GuestTagsProvider
        albumId={albumId}
        photoIds={photos.map((photo) => photo.id)}
      >
        <GuestFeedbackProvider albumId={albumId} photos={photos}>
          <div className="guest-studio guest-gallery-page min-h-screen bg-stone-50 pb-28 text-stone-900">
            <ClientActivityTracker albumId={albumId} />
            <GuestAlbumHeader
              albumId={albumId}
              roundNo={roundNo}
              canSelect={canSelect}
              roundStatus={roundStatus}
              loggingOut={loggingOut}
              onLogout={() => void handleLogout()}
            />

            {logoutError && (
              <div
                role="alert"
                className="mx-auto mt-4 max-w-6xl px-4 text-sm text-red-800 sm:px-6"
              >
                {logoutError}
              </div>
            )}

            <main className="guest-gallery-content mx-auto max-w-6xl px-4 py-6 sm:px-6">
              <header className="guest-gallery-intro">
                <h2>相簿照片</h2>
              </header>
              <GuestSharedReviewLinks albumId={albumId} />

              {submitSuccess && (
                <div
                  role="status"
                  ref={submitSuccessRef}
                  tabIndex={-1}
                  className="guest-submission-success mb-6 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900"
                >
                  <p className="font-semibold">✓ 挑片已成功送出！</p>
                  <p className="mt-1 text-sm text-emerald-800">
                    您的選片結果已永久封存送交攝影師，本輪選片已鎖定。星等與收藏的後續變更不會改寫此快照。
                  </p>
                </div>
              )}

              {submitError && (
                <div
                  role="alert"
                  className="guest-submission-error mb-6 rounded-md border border-red-300 bg-red-50 p-4 text-red-900"
                >
                  <p className="text-sm font-medium">{submitError}</p>
                </div>
              )}

              {selectionState.status === 'loading' && (
                <p role="status" className="mb-4 text-sm text-stone-600">
                  正在載入完整選片狀態…
                </p>
              )}

              {selectionState.status === 'error' &&
                selectionState.statusCode !== 401 &&
                selectionState.code !== 'GUEST_SELECTION_DISABLED' && (
                  <div
                    role="alert"
                    className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950"
                  >
                    <p className="text-sm">
                      選片狀態無法同步 ({selectionState.code}
                      )。請重新載入後再繼續。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={selectionRefreshing}
                      onClick={() => void refreshSelection(true)}
                    >
                      {selectionRefreshing ? '重新載入中…' : '重新載入選片狀態'}
                    </Button>
                  </div>
                )}

              {canSelect && selectionPolicy && (
                <div
                  role="status"
                  data-testid="guest-effective-selection-policy"
                  className="guest-selection-policy mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-stone-700"
                >
                  <p>
                    本次挑片：至少 {selectionPolicy.minimum} 張 ·{' '}
                    {selectionPolicy.maximum === null
                      ? '不設上限'
                      : `最多 ${selectionPolicy.maximum} 張`}
                    。
                    {roundStatus === 'open' &&
                      selectionAtMaximum &&
                      ' 已達上限，取消一張後即可改選。'}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={selectionRefreshing || selectionBusy}
                    onClick={() => void refreshSelection(true)}
                    aria-label="重新整理挑片狀態與政策"
                  >
                    {selectionRefreshing ? '重新整理中…' : '重新整理挑片狀態'}
                  </Button>
                </div>
              )}
              <div
                role="navigation"
                aria-label="相簿分頁"
                className="guest-gallery-toolbar mb-4 flex flex-wrap items-center justify-between gap-3"
              >
                <p aria-live="polite" className="text-sm text-stone-600">
                  {photos.length} 張照片
                  {(galleryPageIndex > 0 || hasNextGalleryPage) &&
                    ` · 第 ${galleryPageIndex + 1} 頁`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="gallery-view-switch"
                    role="group"
                    aria-label="圖庫顯示方式"
                  >
                    <button
                      type="button"
                      aria-pressed={galleryView === 'masonry'}
                      onClick={() => setGalleryView('masonry')}
                    >
                      <StudioIcon name="projects" width={16} height={16} />
                      瀑布流
                    </button>
                    <button
                      type="button"
                      aria-pressed={galleryView === 'list'}
                      onClick={() => setGalleryView('list')}
                    >
                      <StudioIcon name="list" width={16} height={16} />
                      圖片清單
                    </button>
                  </div>
                  {canSelect && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        roundStatus === 'submitted' ||
                        selectionBusy ||
                        photos.length === 0 ||
                        planSelectionBatch(
                          photos,
                          selectedMap,
                          selectedCount,
                          selectionPolicy?.maximum ?? null,
                        ).length === 0
                      }
                      onClick={() => void selectDisplayedPage(photos)}
                    >
                      {photos.length > 0 &&
                      photos.every(
                        (photo) =>
                          selectedMap.get(photo.id) === photo.versionId,
                      )
                        ? '本頁已全數選取'
                        : '選取目前顯示頁面'}
                    </Button>
                  )}
                  {(galleryPageIndex > 0 || hasNextGalleryPage) && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          galleryPageIndex === 0 ||
                          galleryPageLoading ||
                          selectionBusy
                        }
                        onClick={loadPreviousGalleryPage}
                        aria-label="上一頁照片"
                      >
                        上一頁
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          !hasNextGalleryPage ||
                          galleryPageLoading ||
                          selectionBusy
                        }
                        onClick={() => void loadNextGalleryPage()}
                        aria-label="載入下一頁照片"
                      >
                        {galleryPageLoading ? '載入中…' : '下一頁'}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {galleryPageError && (
                <p role="alert" className="mb-4 text-sm text-red-800">
                  {galleryPageError}
                </p>
              )}

              <div className="guest-album-utilities">
                <GuestDownloadsPanel
                  albumId={albumId}
                  compact
                  onViewAccessLost={onAnnotationsUnauthorized}
                />
                <GuestDeliveryPanel albumId={albumId} />
                <GuestBatchCommentComposer
                  albumId={albumId}
                  photos={photos}
                  onUnauthorized={onAnnotationsUnauthorized}
                />
                <GuestBatchTagControls
                  photos={photos}
                  selectedPhotoIds={[...selectedMap.keys()]}
                />
              </div>

              {photos.length === 0 ? (
                <div className="rounded-lg border border-dashed border-stone-300 py-16 text-center text-stone-500">
                  此相簿目前沒有照片。
                </div>
              ) : (
                <ul
                  className={
                    'guest-photo-grid ' +
                    (galleryView === 'masonry'
                      ? 'gallery-masonry'
                      : 'gallery-list')
                  }
                  aria-label="相簿照片列表"
                >
                  {photos.map((photo) => {
                    const isSelected = selectedMap.has(photo.id);
                    return (
                      <li
                        key={photo.id}
                        className={`guest-photo-card group relative flex flex-col overflow-hidden rounded-lg border bg-white transition-all ${
                          isSelected
                            ? 'border-amber-600 ring-2 ring-amber-600/20'
                            : 'border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => openLightbox(photo)}
                          style={{
                            aspectRatio:
                              galleryView === 'list'
                                ? '4 / 3'
                                : photo.width && photo.height
                                  ? `${photo.width} / ${photo.height}`
                                  : '4 / 3',
                          }}
                          className="guest-photo-preview w-full overflow-hidden bg-stone-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                          aria-label={`檢視大圖 ${photo.filename}`}
                        >
                          {photo.thumbnailUrl ? (
                            <TrackedPhotoImage
                              photoId={photo.id}
                              versionId={photo.versionId}
                              src={photo.thumbnailUrl}
                              alt={photo.filename}
                              loading="lazy"
                              className="guest-photo-image h-full w-full object-cover transition duration-150 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-stone-400">
                              {photo.processing === 'succeeded'
                                ? '預覽載入中…'
                                : '處理中'}
                            </div>
                          )}
                        </button>

                        <div className="flex items-center justify-between gap-2 p-2.5">
                          <span
                            className="truncate text-xs text-stone-600"
                            title={photo.filename}
                          >
                            {photo.filename}
                            {photo.photographerRecommended && (
                              <span className="guest-photographer-badge">
                                ★ 攝影師推薦
                              </span>
                            )}
                          </span>

                          {canSelect && (
                            <label
                              className="guest-photo-select"
                              data-selected={isSelected}
                              title={isSelected ? '取消選取' : '選取照片'}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={
                                  roundStatus === 'submitted' ||
                                  selectionBusy ||
                                  (!isSelected && selectionAtMaximum)
                                }
                                onChange={() => void toggleSelection(photo)}
                                aria-label={`選取 ${photo.filename}`}
                                className="guest-photo-select-input"
                              />
                              <StudioIcon name="check" width={20} height={20} />
                            </label>
                          )}
                        </div>
                        <div className="guest-card-feedback">
                          <GuestFeedbackControls photo={photo} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </main>

            {/* Floating Bottom Selection Bar */}
            {canSelect && (
              <aside
                aria-label="選片統計與送出列"
                className="guest-selection-bar fixed bottom-0 left-0 right-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6"
              >
                <div className="guest-selection-bar-content mx-auto flex max-w-6xl items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      已選取{' '}
                      <span className="text-amber-800 font-bold">
                        {selectedCount}
                      </span>{' '}
                      張照片
                    </p>
                    <p className="text-xs text-stone-500">
                      {roundStatus === 'submitted'
                        ? `本輪挑片已於 ${submittedAt ? new Date(submittedAt).toLocaleString() : '已完成'} 送出凍結`
                        : '選取完成後，請點擊「送出挑片」鎖定本輪選擇'}
                    </p>
                  </div>

                  <div>
                    {roundStatus === 'open' && canSubmit ? (
                      <Button
                        type="button"
                        ref={submitButtonRef}
                        disabled={
                          !selectionWithinBounds || submitting || selectionBusy
                        }
                        onClick={() => setConfirmSubmitOpen(true)}
                        aria-label="送出挑片"
                        className="guest-submit-button"
                      >
                        {submitting ? '送出中…' : '送出挑片'}
                      </Button>
                    ) : roundStatus !== 'open' ? (
                      <span className="inline-flex items-center rounded-md bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-700">
                        已完成提交
                      </span>
                    ) : null}
                  </div>
                </div>
              </aside>
            )}

            {/* Confirmation Dialog */}
            {confirmSubmitOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={confirmTitleId}
                aria-describedby={confirmDescId}
                ref={submitDialogRef}
                tabIndex={-1}
                className="guest-confirm-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
              >
                <div className="guest-confirm-card w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                  <h2
                    id={confirmTitleId}
                    className="text-lg font-semibold text-stone-900"
                  >
                    確認送出挑片？
                  </h2>
                  <p id={confirmDescId} className="mt-2 text-sm text-stone-600">
                    您目前共選取了{' '}
                    <strong className="text-stone-900">{selectedCount}</strong>{' '}
                    張照片。 送出挑片後，本輪選片將會
                    <strong>凍結並永久封存</strong>
                    送交攝影師，您將無法再修改本輪的選取結果。
                  </p>

                  <div className="guest-confirm-actions mt-6 flex justify-end gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => setConfirmSubmitOpen(false)}
                    >
                      返回修改
                    </Button>
                    <Button
                      type="button"
                      disabled={submitting}
                      onClick={() => void submitSelection()}
                      aria-label="確認送出本輪挑片"
                      className="guest-submit-button"
                    >
                      {submitting ? '送出中…' : '確認送出'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Lightbox Modal */}
            {activePhoto && (
              <div className="kino-photo-detail-overlay guest-photo-detail-overlay">
                <div
                  ref={lightboxRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={lightboxTitleId}
                  className={
                    comparisonOpen
                      ? 'kino-photo-detail-dialog guest-photo-detail-dialog guest-photo-detail-dialog--comparison'
                      : photoToolsOpen
                        ? 'kino-photo-detail-dialog guest-photo-detail-dialog'
                        : 'kino-photo-detail-dialog guest-photo-detail-dialog kino-photo-detail-dialog--tools-collapsed'
                  }
                  tabIndex={-1}
                >
                  <div className="kino-photo-detail-header guest-photo-detail-header">
                    <div className="min-w-0">
                      <p className="kino-photo-detail-eyebrow">
                        GUEST / PHOTO DETAIL
                      </p>
                      <h2
                        id={lightboxTitleId}
                        className="kino-photo-detail-title"
                      >
                        {activePhoto.filename}
                      </h2>
                    </div>
                    <div className="guest-photo-detail-actions">
                      {canSelect && (
                        <label className="guest-photo-selection flex cursor-pointer items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedMap.has(activePhoto.id)}
                            disabled={
                              roundStatus === 'submitted' ||
                              selectionBusy ||
                              (!selectedMap.has(activePhoto.id) &&
                                selectionAtMaximum)
                            }
                            onChange={() => void toggleSelection(activePhoto)}
                            aria-label="選取這張"
                            className="h-4 w-4 rounded border-stone-300 text-amber-600"
                          />
                          <span>
                            {selectedMap.has(activePhoto.id)
                              ? '已選取'
                              : '選取這張'}
                          </span>
                        </label>
                      )}
                      {!annotationPending && (
                        <GuestVersionComparisonButton
                          key={`${albumId}:${activePhoto.id}`}
                          albumId={albumId}
                          photoId={activePhoto.id}
                          opened={comparisonOpen}
                          buttonRef={comparisonButtonRef}
                          onOpen={() => {
                            if (!annotationPendingRef.current)
                              setComparisonOpen(true);
                          }}
                          onClose={() => {
                            setComparisonOpen(false);
                            comparisonButtonRef.current?.focus();
                          }}
                        />
                      )}
                      {!comparisonOpen && (
                        <button
                          type="button"
                          className="kino-photo-detail-tools-toggle"
                          aria-label={
                            photoToolsOpen ? '收合照片工具' : '展開照片工具'
                          }
                          aria-expanded={photoToolsOpen}
                          aria-controls={photoToolsId}
                          title={
                            photoToolsOpen ? '收合照片工具' : '展開照片工具'
                          }
                          disabled={annotationPending}
                          onClick={() => setPhotoToolsOpen((open) => !open)}
                        >
                          <StudioIcon
                            name="chevronDown"
                            width={18}
                            height={18}
                            style={{
                              transform: photoToolsOpen
                                ? 'rotate(180deg)'
                                : undefined,
                            }}
                          />
                          {photoToolsOpen ? '收合工具' : '展開工具'}
                        </button>
                      )}
                      <Button
                        disabled={annotationPending}
                        ref={lightboxCloseRef}
                        type="button"
                        variant="outline"
                        onClick={closeLightbox}
                        aria-label="關閉預覽"
                        className="kino-photo-detail-close guest-photo-detail-close"
                      >
                        關閉
                      </Button>
                    </div>
                  </div>

                  {comparisonOpen ? (
                    <div className="guest-photo-comparison-stage">
                      <GuestVersionComparison
                        key={`${albumId}:${activePhoto.id}`}
                        albumId={albumId}
                        photoId={activePhoto.id}
                        filename={activePhoto.filename}
                        onPendingChange={onAnnotationPendingChange}
                        onUnauthorized={onAnnotationsUnauthorized}
                        onClose={() => {
                          if (annotationPendingRef.current) return;
                          setComparisonOpen(false);
                          comparisonButtonRef.current?.focus();
                        }}
                      />
                    </div>
                  ) : (
                    <div className="guest-photo-pane">
                      <div className="kino-photo-detail-stage guest-photo-stage">
                        {!annotationCanvasPortalActive &&
                          (activePhoto.previewUrl ? (
                            <TrackedPhotoImage
                              photoId={activePhoto.id}
                              versionId={activePhoto.versionId}
                              src={activePhoto.previewUrl}
                              alt={activePhoto.filename}
                              className="kino-photo-detail-image guest-photo-detail-image"
                            />
                          ) : (
                            <p
                              role="status"
                              className="kino-photo-detail-error"
                            >
                              大圖預覽處理中…
                            </p>
                          ))}
                        <div
                          ref={setAnnotationCanvasHostRef}
                          className="kino-photo-detail-canvas-host"
                        />
                      </div>
                      <aside
                        id={photoToolsId}
                        hidden={!photoToolsOpen}
                        className="kino-photo-detail-tools guest-photo-tools"
                      >
                        <section
                          className="kino-photo-detail-metadata"
                          aria-label="照片資訊"
                        >
                          <dl className="kino-photo-detail-facts">
                            <div>
                              <dt>檔案尺寸</dt>
                              <dd>
                                {activePhoto.width !== null &&
                                activePhoto.height !== null
                                  ? `${activePhoto.width} × ${activePhoto.height} px`
                                  : '尚無尺寸資料'}
                              </dd>
                            </div>
                            {photoToolsOpen && (
                              <CaptureMetadataDetails
                                key={`${albumId}:${activePhoto.id}:${activePhoto.versionId}`}
                                url={`/api/guest/photos/${encodeURIComponent(activePhoto.id)}/versions/${encodeURIComponent(activePhoto.versionId)}/capture-metadata`}
                              />
                            )}
                          </dl>
                        </section>
                        {activePhoto.photographerRecommended && (
                          <p className="guest-photographer-badge">
                            ★ 攝影師推薦
                          </p>
                        )}
                        <GuestFeedbackControls photo={activePhoto} compact />
                        <GuestTagControls
                          photoId={activePhoto.id}
                          versionId={activePhoto.versionId}
                          compact
                        />
                        <GuestAnnotationsPanel
                          key={
                            'annotations:' +
                            albumId +
                            ':' +
                            activePhoto.id +
                            ':' +
                            activePhoto.versionId
                          }
                          albumId={albumId}
                          photoId={activePhoto.id}
                          versionId={activePhoto.versionId}
                          filename={activePhoto.filename}
                          previewUrl={activePhoto.previewUrl}
                          canvasContainer={annotationCanvasHost}
                          onCanvasPortalActiveChange={
                            setAnnotationCanvasPortalActive
                          }
                          isCurrentVersion={true}
                          freehandReadCapability={true}
                          onPendingChange={onAnnotationPendingChange}
                          onUnauthorized={onAnnotationsUnauthorized}
                        />
                        <GuestCommentsPanel
                          key={`${albumId}:${activePhoto.id}:${activePhoto.versionId}`}
                          albumId={albumId}
                          photoId={activePhoto.id}
                          versionId={activePhoto.versionId}
                          filename={activePhoto.filename}
                          onUnauthorized={onAnnotationsUnauthorized}
                        />
                        <GuestVersionApprovalsPanel
                          key={
                            'version-approvals:' +
                            albumId +
                            ':' +
                            activePhoto.id +
                            ':' +
                            activePhoto.versionId
                          }
                          albumId={albumId}
                          photoId={activePhoto.id}
                          filename={activePhoto.filename}
                        />
                      </aside>
                    </div>
                  )}
                  {!comparisonOpen && (
                    <>
                      <div className="kino-photo-detail-navigation">
                        <button
                          type="button"
                          className="kino-photo-detail-step"
                          aria-label="上一張照片"
                          title="上一張照片"
                          disabled={annotationPending || activePhotoIndex <= 0}
                          onClick={() =>
                            navigatePreview(photos[activePhotoIndex - 1])
                          }
                        >
                          <StudioIcon
                            name="chevronDown"
                            width={20}
                            height={20}
                            style={{ transform: 'rotate(90deg)' }}
                          />
                        </button>
                        <span className="kino-photo-detail-index">
                          {activePhotoIndex + 1} / {photos.length}
                        </span>
                        <button
                          type="button"
                          className="kino-photo-detail-step"
                          aria-label="下一張照片"
                          title="下一張照片"
                          disabled={
                            annotationPending ||
                            activePhotoIndex >= photos.length - 1
                          }
                          onClick={() =>
                            navigatePreview(photos[activePhotoIndex + 1])
                          }
                        >
                          <StudioIcon
                            name="chevronDown"
                            width={20}
                            height={20}
                            style={{ transform: 'rotate(-90deg)' }}
                          />
                        </button>
                      </div>
                      <nav
                        ref={photoFilmstripRef}
                        className="kino-photo-detail-thumbnails"
                        aria-label="相簿照片縮圖列"
                      >
                        {photoFilmstripItems.map(({ photo, index }) => (
                          <button
                            key={photo.id}
                            type="button"
                            className="kino-photo-detail-thumbnail"
                            aria-label={`切換至第 ${index + 1} 張：${photo.filename}`}
                            title={`${index + 1}. ${photo.filename}`}
                            aria-current={
                              photo.id === activePhoto.id ? 'true' : undefined
                            }
                            disabled={annotationPending}
                            onClick={() => navigatePreview(photo)}
                          >
                            {photo.thumbnailUrl ? (
                              <img
                                src={photo.thumbnailUrl}
                                className="kino-photo-detail-thumbnail-image"
                                alt=""
                                loading="lazy"
                                draggable={false}
                                onContextMenu={(event) =>
                                  event.preventDefault()
                                }
                              />
                            ) : (
                              index + 1
                            )}
                          </button>
                        ))}
                      </nav>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </GuestFeedbackProvider>
      </GuestTagsProvider>
    </HumanPhotoViewsProvider>
  );
}
