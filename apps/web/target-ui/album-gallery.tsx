'use client';
import { StudioIcon } from './studio-icons';
import {
  PhotographerRecommendationPolicy,
  PhotographerPhotoEditor,
} from './photographer-recommendations';
import './photo-detail.css';
import './album-gallery-view.css';
import { MatchingFilenameIndexPanel } from './matching-filename-index';
import { MatchingRuleIndexPanel } from './matching-rule-index';
import { OwnerAnnotationsPanel } from './owner-annotations';
import { OwnerVersionApprovalsPanel } from './version-approvals';
import {
  HumanPhotoViewsProvider,
  TrackedPhotoImage,
} from './human-photo-views';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import { ProcessingReview } from './processing-review';
import { PhotoVersionsPanel } from './photo-versions';
import { OwnerVersionComparisonPanel } from './owner-version-comparison';
import { OwnerCommentsPanel } from './owner-comments';
import {
  setPhotoPinResultSchema,
  setPhotoPinSchema,
} from '../../../packages/contracts/src/photo-pins';

const photoPathPrefix = '/api/v1/photos/';
const photoPathOrigin = 'https://kino-pic.invalid';

function isProtectedPhotoPath(value: string) {
  if (
    !value.startsWith(photoPathPrefix) ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#')
  )
    return false;

  try {
    const url = new URL(value, photoPathOrigin);
    return (
      url.origin === photoPathOrigin && url.pathname.startsWith(photoPathPrefix)
    );
  } catch {
    return false;
  }
}

const privatePhotoPathSchema = z
  .string()
  .min(1)
  .refine(isProtectedPhotoPath, '預覽網址必須使用相簿私有圖片路徑');

const galleryPhotoSchema = z
  .object({
    id: z.string().min(1),
    versionId: z.string().min(1),
    filename: z.string().min(1),
    photographerRecommended: z.boolean().optional(),
    isPinned: z.boolean().optional(),
    pinRevision: z.number().int().safe().min(0).optional(),
    width: z.number().int().positive().safe().nullable(),
    height: z.number().int().positive().safe().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    processing: z.enum([
      'queued',
      'running',
      'retryable',
      'needs_review',
      'abandoned',
      'succeeded',
      'unsupported',
      'unavailable',
    ]),
    thumbnailUrl: privatePhotoPathSchema.nullable(),
    previewUrl: privatePhotoPathSchema.nullable(),
  })
  .strict();

const albumPhotosResponseSchema = z
  .object({
    photos: z.array(galleryPhotoSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();

type GalleryPhoto = z.infer<typeof galleryPhotoSchema>;
type GalleryApiError = {
  status: number | null;
  kind: 'http' | 'protocol' | 'network';
};
type PhotoPinIntent = {
  body: z.infer<typeof setPhotoPinSchema>;
  actor: string;
  session: string;
};

type GalleryState = {
  albumId: string;
  photos: GalleryPhoto[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: GalleryApiError | null;
};

function initialGalleryState(albumId: string): GalleryState {
  return {
    albumId,
    photos: [],
    nextCursor: null,
    loading: true,
    loadingMore: false,
    error: null,
  };
}

const processingLabels: Record<GalleryPhoto['processing'], string> = {
  queued: '等待處理',
  running: '正在處理照片',
  retryable: '處理失敗，等待重試',
  needs_review: '等待檢查',
  abandoned: '已停止處理，原圖已保留',
  succeeded: '處理完成',
  unsupported: '此檔案格式不支援',
  unavailable: '照片目前無法使用',
};

class GalleryHttpError extends Error {
  constructor(readonly status: number) {
    super('ALBUM_PHOTOS_REQUEST_FAILED');
  }
}

class GalleryProtocolError extends Error {
  constructor() {
    super('ALBUM_PHOTOS_RESPONSE_INVALID');
  }
}

class PinHttpError extends Error {
  constructor(readonly status: number) {
    super('PHOTO_PIN_REQUEST_FAILED');
  }
}

class PinProtocolError extends Error {
  constructor() {
    super('PHOTO_PIN_RESPONSE_INVALID');
  }
}

const ownerIdentitySchema = z
  .object({
    actor: z.object({ id: z.uuid() }).strict(),
    sessionId: z.string().min(1),
    role: z.literal('owner'),
  })
  .strict();

async function readPinJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new PinHttpError(response.status);
  return body;
}

export async function fetchAlbumPhotos(
  albumId: string,
  cursor: string | null,
  signal: AbortSignal,
) {
  const query = cursor === null ? '' : '?cursor=' + encodeURIComponent(cursor);
  const response = await fetch(
    '/api/v1/albums/' + encodeURIComponent(albumId) + '/photos' + query,
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal,
    },
  );

  if (!response.ok) throw new GalleryHttpError(response.status);

  const body: unknown = await response.json().catch(() => null);
  const result = albumPhotosResponseSchema.safeParse(body);
  if (!result.success || (cursor !== null && result.data.nextCursor === cursor))
    throw new GalleryProtocolError();

  return result.data;
}

function deduplicatePhotos(photos: GalleryPhoto[]) {
  const seen = new Set<string>();
  return photos.filter((photo) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });
}

function mergePhotos(existing: GalleryPhoto[], incoming: GalleryPhoto[]) {
  const seen = new Set(existing.map((photo) => photo.id));
  const additions = incoming.filter((photo) => {
    if (seen.has(photo.id)) return false;
    seen.add(photo.id);
    return true;
  });
  return [...existing, ...additions];
}

function errorMessage(error: GalleryApiError) {
  if (error.kind === 'http') {
    if (error.status === 401) return '登入狀態已逾期，請重新登入。';
    if (error.status === 403)
      return '目前帳號無法存取這本相簿，請重新登入或確認權限。';
    if (error.status === 404) return '找不到相簿或相簿已無法存取，請重新整理。';
  }
  if (error.kind === 'protocol') return '照片資料格式不正確，請重新整理。';
  return '目前無法載入照片，請檢查連線後重新整理。';
}

function failureFrom(error: unknown): GalleryApiError {
  if (error instanceof GalleryHttpError)
    return { status: error.status, kind: 'http' };
  if (error instanceof GalleryProtocolError)
    return { status: null, kind: 'protocol' };
  return { status: null, kind: 'network' };
}

function canShowThumbnail(photo: GalleryPhoto) {
  return photo.processing === 'succeeded' && photo.thumbnailUrl !== null;
}

function canOpenPreview(photo: GalleryPhoto) {
  return canShowThumbnail(photo) && photo.previewUrl !== null;
}

function thumbnailKey(photo: GalleryPhoto) {
  return photo.id + ':' + photo.versionId + ':' + (photo.thumbnailUrl ?? '');
}

function PhotoStatusTile({ photo }: { photo: GalleryPhoto }) {
  const message =
    photo.processing === 'succeeded'
      ? '縮圖尚未提供'
      : processingLabels[photo.processing];

  return (
    <div
      className="flex aspect-[4/3] min-w-0 items-center justify-center rounded-t-md bg-stone-100 px-3 text-center"
      role="status"
    >
      <p className="text-sm text-stone-600">{message}</p>
    </div>
  );
}

function focusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (element) =>
      !element.hasAttribute('hidden') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      getComputedStyle(element).visibility !== 'hidden',
  );
}

function PhotoPinButton({
  photo,
  pending,
  retryTarget,
  onClick,
  compact = false,
}: {
  photo: GalleryPhoto;
  pending: boolean;
  retryTarget: boolean | undefined;
  onClick: () => void;
  compact?: boolean;
}) {
  if (photo.isPinned === undefined || photo.pinRevision === undefined)
    return null;
  const target = retryTarget ?? !photo.isPinned;
  const actionLabel =
    retryTarget !== undefined
      ? target
        ? '重試置頂'
        : '重試取消置頂'
      : photo.isPinned
        ? '取消置頂'
        : '置頂';

  return (
    <button
      type="button"
      className={`gallery-photo-pin-button${compact ? ' gallery-photo-pin-button-detail' : ''}`}
      aria-label={`${actionLabel}：${photo.filename}`}
      aria-pressed={photo.isPinned}
      title={`${actionLabel}：${photo.filename}`}
      disabled={pending}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <g transform="rotate(38 12 12)">
          <path
            d="M7.25 3.25h9.5v2.8l-1.45 2.2v3.55h-6.6V8.25l-1.45-2.2v-2.8Z"
            fill={photo.isPinned ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.9"
          />
          <path
            d="M7.2 11.8h9.6M12 11.8v8.95"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.9"
          />
        </g>
      </svg>
      {compact && <span>{actionLabel}</span>}
    </button>
  );
}

export function AlbumGallery({
  albumId,
  uploadContext,
}: {
  albumId: string;
  uploadContext?: {
    workspaceId: string;
    projectId: string;
    versioningMode: 'off' | 'manual' | 'auto_filename' | 'assisted';
  };
}) {
  const [recommendationPending, setRecommendationPending] = useState(false);
  const recommendationPendingRef = useRef(false);
  const onRecommendationPendingChange = useCallback((pending: boolean) => {
    recommendationPendingRef.current = pending;
    setRecommendationPending(pending);
  }, []);
  const [versionPending, setVersionPending] = useState(false);
  const [deliveryPending, setDeliveryPending] = useState(false);
  const deliveryPendingRef = useRef(false);
  const [commentPending, setCommentPending] = useState(false);
  const [pinPendingPhotoIds, setPinPendingPhotoIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [pinStateUncertain, setPinStateUncertain] = useState(false);
  const pinRefreshPendingRef = useRef(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinRetryTargets, setPinRetryTargets] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());
  const pinPendingRef = useRef(new Set<string>());
  const pinIntentsRef = useRef(new Map<string, PhotoPinIntent>());
  const commentPendingRef = useRef(false);
  const [ownerAnnotationPending, setOwnerAnnotationPending] = useState(false);
  const ownerAnnotationPendingRef = useRef(false);
  const onCommentPendingChange = useCallback((pending: boolean) => {
    commentPendingRef.current = pending;
    setCommentPending(pending);
  }, []);
  const onOwnerAnnotationPendingChange = useCallback((pending: boolean) => {
    ownerAnnotationPendingRef.current = pending;
    setOwnerAnnotationPending(pending);
  }, []);
  const anyPending =
    versionPending ||
    deliveryPending ||
    commentPending ||
    ownerAnnotationPending ||
    recommendationPending ||
    pinPendingPhotoIds.size > 0 ||
    pinStateUncertain;
  const versionPendingRef = useRef(false);
  const onVersionPendingChange = useCallback((pending: boolean) => {
    versionPendingRef.current = pending;
    setVersionPending(pending);
  }, []);
  const onDeliveryPendingChange = useCallback((pending: boolean) => {
    deliveryPendingRef.current = pending;
    setDeliveryPending(pending);
  }, []);
  const [gallery, setGallery] = useState<GalleryState>(() =>
    initialGalleryState(albumId),
  );
  const [galleryView, setGalleryView] = useState<'masonry' | 'list'>('masonry');
  const galleryRef = useRef(gallery);
  const galleryForRender = useMemo(
    () =>
      gallery.albumId === albumId ? gallery : initialGalleryState(albumId),
    [albumId, gallery],
  );
  const readyPhotos = useMemo(
    () => galleryForRender.photos.filter(canOpenPreview),
    [galleryForRender.photos],
  );
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const photoSelectionGeneration = useRef(0);
  const advancePhotoSelectionGeneration = useCallback(() => {
    photoSelectionGeneration.current++;
  }, []);
  const [activePhotoSelection, setActivePhotoSelection] = useState<{
    albumId: string;
    photoId: string;
    generation: number;
  } | null>(null);
  const activePhotoId =
    activePhotoSelection?.albumId === albumId
      ? activePhotoSelection.photoId
      : null;
  const activePhotoIdRef = useRef(activePhotoId);
  const openedLightboxHistoryRef = useRef(false);
  useEffect(() => {
    activePhotoIdRef.current = activePhotoId;
  }, [activePhotoId]);
  const writePhotoUrl = useCallback(
    (photoId: string | null, push: boolean) => {
      const url = new URL(window.location.href);
      if (photoId) {
        url.searchParams.set('photoId', photoId);
        url.searchParams.set('albumId', albumId);
      } else {
        url.searchParams.delete('photoId');
        url.searchParams.delete('albumId');
      }
      if (push) window.history.pushState({ kinoPickPhoto: true }, '', url);
      else
        window.history.replaceState(
          { kinoPickPhoto: photoId !== null },
          '',
          url,
        );
    },
    [albumId],
  );
  const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedPreviewKey, setFailedPreviewKey] = useState<string | null>(null);
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
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const photosTitleRef = useRef<HTMLHeadingElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const instanceId = useId();
  const titleId = instanceId + '-lightbox-title';
  const photoToolsId = instanceId + '-photo-tools';
  const [photoToolsOpen, setPhotoToolsOpen] = useState(true);

  const commitGallery = useCallback((next: GalleryState) => {
    galleryRef.current = next;
    setGallery(next);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const photoId = new URL(window.location.href).searchParams.get('photoId');
      if (!photoId) {
        openedLightboxHistoryRef.current = false;
        activePhotoIdRef.current = null;
        advancePhotoSelectionGeneration();
        setActivePhotoSelection(null);
        return;
      }
      const photo = galleryRef.current.photos.find(
        (item) => item.id === photoId,
      );
      if (!photo || !canOpenPreview(photo)) return;
      openedLightboxHistoryRef.current =
        window.history.state?.kinoPickPhoto === true;
      advancePhotoSelectionGeneration();
      activePhotoIdRef.current = photo.id;
      setActivePhotoSelection({
        albumId,
        photoId: photo.id,
        generation: photoSelectionGeneration.current,
      });
    };
    window.addEventListener('popstate', syncFromUrl);
    syncFromUrl();
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [albumId, advancePhotoSelectionGeneration]);

  useEffect(() => {
    if (galleryForRender.loading || galleryForRender.albumId !== albumId)
      return;
    const photoId = new URL(window.location.href).searchParams.get('photoId');
    if (!photoId || activePhotoIdRef.current === photoId) return;
    const photo = galleryForRender.photos.find((item) => item.id === photoId);
    if (!photo || !canOpenPreview(photo)) return;
    openedLightboxHistoryRef.current =
      window.history.state?.kinoPickPhoto === true;
    advancePhotoSelectionGeneration();
    activePhotoIdRef.current = photo.id;
    setActivePhotoSelection({
      albumId,
      photoId: photo.id,
      generation: photoSelectionGeneration.current,
    });
  }, [albumId, advancePhotoSelectionGeneration, galleryForRender]);

  const loadFirstPage = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const generation = ++requestSequence.current;
    advancePhotoSelectionGeneration();
    activePhotoIdRef.current = null;
    setActivePhotoSelection(null);
    setFailedPreviewKey(null);
    commitGallery({
      albumId,
      photos: [],
      nextCursor: null,
      loading: true,
      loadingMore: false,
      error: null,
    });
    setFailedThumbnails(new Set());

    try {
      const result = await fetchAlbumPhotos(albumId, null, controller.signal);
      if (controller.signal.aborted || generation !== requestSequence.current)
        return;
      commitGallery({
        albumId,
        photos: deduplicatePhotos(result.photos),
        nextCursor: result.nextCursor,
        loading: false,
        loadingMore: false,
        error: null,
      });
    } catch (error) {
      if (controller.signal.aborted || generation !== requestSequence.current)
        return;
      commitGallery({
        albumId,
        photos: [],
        nextCursor: null,
        loading: false,
        loadingMore: false,
        error: failureFrom(error),
      });
    } finally {
      if (generation === requestSequence.current)
        requestController.current = null;
    }
  }, [advancePhotoSelectionGeneration, albumId, commitGallery]);

  const loadNextPage = useCallback(async () => {
    const current = galleryRef.current;
    if (
      current.albumId !== albumId ||
      current.loading ||
      current.loadingMore ||
      current.nextCursor === null ||
      requestController.current !== null
    )
      return;

    const cursor = current.nextCursor;
    const controller = new AbortController();
    requestController.current = controller;
    const generation = ++requestSequence.current;
    commitGallery({ ...current, loadingMore: true, error: null });

    try {
      const result = await fetchAlbumPhotos(albumId, cursor, controller.signal);
      if (controller.signal.aborted || generation !== requestSequence.current)
        return;
      const latest = galleryRef.current;
      commitGallery({
        ...latest,
        photos: mergePhotos(latest.photos, result.photos),
        nextCursor: result.nextCursor,
        loading: false,
        loadingMore: false,
        error: null,
      });
    } catch (error) {
      if (controller.signal.aborted || generation !== requestSequence.current)
        return;
      commitGallery({
        ...galleryRef.current,
        loading: false,
        loadingMore: false,
        error: failureFrom(error),
      });
    } finally {
      if (generation === requestSequence.current)
        requestController.current = null;
    }
  }, [albumId, commitGallery]);

  const refreshFirstPagePreservingPhoto = useCallback(async () => {
    const current = galleryRef.current;
    if (current.albumId !== albumId) return;
    const preservePhotoId = activePhotoIdRef.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const generation = ++requestSequence.current;
    commitGallery({
      ...current,
      loading: current.photos.length === 0,
      loadingMore: false,
      error: null,
    });

    try {
      const result = await fetchAlbumPhotos(albumId, null, controller.signal);
      if (controller.signal.aborted || generation !== requestSequence.current)
        return;
      const latest = galleryRef.current;
      const preserve = latest.photos.find(
        (photo) => photo.id === preservePhotoId,
      );
      commitGallery({
        albumId,
        photos: deduplicatePhotos([
          ...result.photos,
          ...(preserve ? [preserve] : []),
        ]),
        nextCursor: result.nextCursor,
        loading: false,
        loadingMore: false,
        error: null,
      });
    } catch (error) {
      if (controller.signal.aborted || generation !== requestSequence.current)
        return;
      commitGallery({
        ...galleryRef.current,
        loading: false,
        loadingMore: false,
        error: failureFrom(error),
      });
    } finally {
      if (generation === requestSequence.current)
        requestController.current = null;
    }
  }, [albumId, commitGallery]);

  const setPhotoPinned = useCallback(
    async (photo: GalleryPhoto) => {
      if (
        !uploadContext ||
        photo.isPinned === undefined ||
        photo.pinRevision === undefined ||
        pinPendingRef.current.has(photo.id)
      )
        return;

      pinPendingRef.current.add(photo.id);
      setPinPendingPhotoIds((current) => new Set(current).add(photo.id));
      setPinError(null);

      try {
        let intent = pinIntentsRef.current.get(photo.id);
        if (!intent) {
          const identity = ownerIdentitySchema.parse(
            await readPinJson('/api/v1/me', {
              headers: { Accept: 'application/json' },
            }),
          );
          const body = setPhotoPinSchema.parse({
            requestId: crypto.randomUUID(),
            expectedRevision: photo.pinRevision,
            isPinned: !photo.isPinned,
          });
          intent = {
            body,
            actor: identity.actor.id,
            session: identity.sessionId,
          };
          pinIntentsRef.current.set(photo.id, intent);
        }

        setPinStateUncertain(true);
        const response = setPhotoPinResultSchema.parse(
          await readPinJson(
            '/api/v1/photos/' + encodeURIComponent(photo.id) + '/pin',
            {
              method: 'PUT',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Kino-Expected-Actor': intent.actor,
                'X-Kino-Expected-Session': intent.session,
              },
              body: JSON.stringify(intent.body),
            },
          ),
        );

        if (
          response.photo.photoId !== photo.id ||
          response.photo.albumId !== albumId ||
          response.photo.isPinned !== intent.body.isPinned ||
          response.photo.revision < intent.body.expectedRevision ||
          (response.changed &&
            response.photo.revision !== intent.body.expectedRevision + 1) ||
          (!response.changed &&
            response.photo.revision !== intent.body.expectedRevision)
        )
          throw new PinProtocolError();

        pinIntentsRef.current.delete(photo.id);
        setPinRetryTargets((current) => {
          if (!current.has(photo.id)) return current;
          const next = new Map(current);
          next.delete(photo.id);
          return next;
        });
        const current = galleryRef.current;
        if (current.albumId === albumId) {
          commitGallery({
            ...current,
            photos: current.photos.map((item) =>
              item.id === photo.id
                ? {
                    ...item,
                    isPinned: response.photo.isPinned,
                    pinRevision: response.photo.revision,
                  }
                : item,
            ),
          });
        }
        setPinError(null);
        setPinStateUncertain(pinIntentsRef.current.size > 0);
        if (activePhotoIdRef.current === photo.id)
          pinRefreshPendingRef.current = true;
        else void refreshFirstPagePreservingPhoto();
      } catch (error) {
        const definiteHttpFailure =
          error instanceof PinHttpError &&
          [400, 401, 403, 404, 409, 422].includes(error.status);
        const hasRetryableIntent = pinIntentsRef.current.has(photo.id);
        if (!hasRetryableIntent) {
          setPinStateUncertain(pinIntentsRef.current.size > 0);
          setPinError(
            error instanceof PinHttpError && error.status === 401
              ? '登入狀態已逾期，請重新登入後再設定置頂。'
              : error instanceof PinHttpError && error.status === 403
                ? '目前登入身分無法修改此照片的置頂狀態。'
                : '無法確認攝影師身分，置頂狀態尚未變更。',
          );
        } else if (definiteHttpFailure) {
          pinIntentsRef.current.delete(photo.id);
          setPinRetryTargets((current) => {
            if (!current.has(photo.id)) return current;
            const next = new Map(current);
            next.delete(photo.id);
            return next;
          });
          setPinStateUncertain(pinIntentsRef.current.size > 0);
          setPinError(
            error instanceof PinHttpError && error.status === 409
              ? '置頂資料已變更，相簿正在更新，請重新確認。'
              : error instanceof PinHttpError && error.status === 401
                ? '登入狀態已逾期，請重新登入後再設定置頂。'
                : error instanceof PinHttpError && error.status === 403
                  ? '目前登入身分無法修改此照片的置頂狀態。'
                  : '置頂設定未套用，請確認相簿資料後再試。',
          );
          if (error instanceof PinHttpError && error.status === 409) {
            if (activePhotoIdRef.current === photo.id) {
              pinRefreshPendingRef.current = true;
            } else {
              void refreshFirstPagePreservingPhoto();
            }
          }
        } else {
          const retryTarget = pinIntentsRef.current.get(photo.id)?.body
            .isPinned;
          if (retryTarget !== undefined)
            setPinRetryTargets((current) => {
              const next = new Map(current);
              next.set(photo.id, retryTarget);
              return next;
            });
          setPinStateUncertain(true);
          setPinError('置頂操作結果尚未確認；再次點擊會重試同一筆操作。');
        }
      } finally {
        pinPendingRef.current.delete(photo.id);
        setPinPendingPhotoIds((current) => {
          const next = new Set(current);
          next.delete(photo.id);
          return next;
        });
      }
    },
    [albumId, commitGallery, refreshFirstPagePreservingPhoto, uploadContext],
  );

  useEffect(() => {
    const stop = (event: BeforeUnloadEvent) => {
      if (pinPendingRef.current.size > 0 || pinIntentsRef.current.size > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', stop);
    return () => window.removeEventListener('beforeunload', stop);
  }, []);

  useEffect(() => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const generation = ++requestSequence.current;

    void fetchAlbumPhotos(albumId, null, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || generation !== requestSequence.current)
          return;
        commitGallery({
          albumId,
          photos: deduplicatePhotos(result.photos),
          nextCursor: result.nextCursor,
          loading: false,
          loadingMore: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generation !== requestSequence.current)
          return;
        commitGallery({
          albumId,
          photos: [],
          nextCursor: null,
          loading: false,
          loadingMore: false,
          error: failureFrom(error),
        });
      })
      .finally(() => {
        if (generation === requestSequence.current)
          requestController.current = null;
      });

    return () => {
      requestSequence.current += 1;
      requestController.current?.abort();
      requestController.current = null;
    };
  }, [albumId, commitGallery]);

  const activePhoto =
    activePhotoId === null
      ? undefined
      : readyPhotos.find((photo) => photo.id === activePhotoId);
  const activePhotoSelectionGeneration = activePhotoSelection?.generation ?? 0;
  const activePhotoIndex = activePhoto
    ? readyPhotos.findIndex((photo) => photo.id === activePhoto.id)
    : -1;
  const lightboxOpen = activePhoto !== undefined;

  useEffect(() => {
    if (!pinRefreshPendingRef.current || lightboxOpen) return;
    pinRefreshPendingRef.current = false;
    void refreshFirstPagePreservingPhoto();
  }, [lightboxOpen, refreshFirstPagePreservingPhoto]);

  useEffect(() => {
    const refreshRecommendations = () => {
      void refreshFirstPagePreservingPhoto();
    };
    window.addEventListener(
      'kino-pick:photographer-changed',
      refreshRecommendations,
    );
    return () =>
      window.removeEventListener(
        'kino-pick:photographer-changed',
        refreshRecommendations,
      );
  }, [refreshFirstPagePreservingPhoto]);

  const closeLightbox = useCallback(() => {
    if (
      versionPendingRef.current ||
      deliveryPendingRef.current ||
      commentPendingRef.current ||
      ownerAnnotationPendingRef.current ||
      recommendationPendingRef.current ||
      pinPendingRef.current.size > 0 ||
      pinIntentsRef.current.size > 0
    )
      return;
    const currentPhotoId = new URL(window.location.href).searchParams.get(
      'photoId',
    );
    if (currentPhotoId && openedLightboxHistoryRef.current) {
      openedLightboxHistoryRef.current = false;
      window.history.back();
      return;
    }
    if (currentPhotoId) writePhotoUrl(null, false);
    advancePhotoSelectionGeneration();
    activePhotoIdRef.current = null;
    setActivePhotoSelection(null);
  }, [advancePhotoSelectionGeneration, writePhotoUrl]);

  const moveLightbox = useCallback(
    (direction: -1 | 1) => {
      if (
        versionPendingRef.current ||
        deliveryPendingRef.current ||
        commentPendingRef.current ||
        ownerAnnotationPendingRef.current ||
        recommendationPendingRef.current ||
        pinPendingRef.current.size > 0 ||
        pinIntentsRef.current.size > 0
      )
        return;
      const photos = readyPhotos;
      const currentIndex = photos.findIndex(
        (photo) => photo.id === activePhotoIdRef.current,
      );
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= photos.length)
        return;
      const nextPhoto = photos[nextIndex];
      if (!nextPhoto) return;
      writePhotoUrl(nextPhoto.id, false);
      advancePhotoSelectionGeneration();
      activePhotoIdRef.current = nextPhoto.id;
      setActivePhotoSelection({
        albumId,
        photoId: nextPhoto.id,
        generation: photoSelectionGeneration.current,
      });
    },
    [advancePhotoSelectionGeneration, albumId, readyPhotos, writePhotoUrl],
  );
  const moveLightboxRef = useRef(moveLightbox);
  useLayoutEffect(() => {
    moveLightboxRef.current = moveLightbox;
  }, [moveLightbox]);
  const onOwnerAnnotationUnauthorized = useCallback(
    (
      sourceAlbumId: string,
      sourcePhotoId: string,
      sourceSelectionGeneration: number,
      status: 401 | 403,
    ) => {
      if (
        sourceAlbumId !== albumId ||
        galleryRef.current.albumId !== sourceAlbumId ||
        activePhotoIdRef.current !== sourcePhotoId ||
        photoSelectionGeneration.current !== sourceSelectionGeneration
      )
        return;

      returnFocusRef.current = photosTitleRef.current;
      requestSequence.current++;
      requestController.current?.abort();
      requestController.current = null;
      advancePhotoSelectionGeneration();
      activePhotoIdRef.current = null;
      ownerAnnotationPendingRef.current = false;
      setOwnerAnnotationPending(false);
      setActivePhotoSelection(null);
      setFailedPreviewKey(null);
      setFailedThumbnails(new Set());
      commitGallery({
        albumId: sourceAlbumId,
        photos: [],
        nextCursor: null,
        loading: false,
        loadingMore: false,
        error: { status, kind: 'http' },
      });
    },
    [advancePhotoSelectionGeneration, albumId, commitGallery],
  );

  useEffect(() => {
    if (!lightboxOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        event.target instanceof Element &&
        event.target.closest('[data-photo-version-panel]')
      )
        return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveLightboxRef.current(-1);
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveLightboxRef.current(1);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = focusableElements(dialogRef.current);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (
        event.shiftKey &&
        (current === first || current === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const returnTarget = returnFocusRef.current;
      if (returnTarget?.isConnected) returnTarget.focus();
      returnFocusRef.current = null;
    };
  }, [closeLightbox, lightboxOpen]);

  const formattedDate = useCallback((value: string) => {
    return new Intl.DateTimeFormat('zh-TW', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Taipei',
    }).format(new Date(value));
  }, []);

  const shouldOfferSignIn =
    galleryForRender.error?.kind === 'http' &&
    (galleryForRender.error.status === 401 ||
      galleryForRender.error.status === 403);

  return (
    <HumanPhotoViewsProvider
      key={'owner-views:' + albumId}
      mode="owner"
      albumId={albumId}
    >
      <section
        aria-labelledby={instanceId + '-photos-title'}
        aria-busy={galleryForRender.loading || galleryForRender.loadingMore}
        className="mt-5 min-w-0 border-t border-stone-200 pt-5"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h4
              ref={photosTitleRef}
              tabIndex={-1}
              id={instanceId + '-photos-title'}
              className="text-base font-semibold"
            >
              照片
            </h4>
            {!galleryForRender.loading && !galleryForRender.error && (
              <p className="mt-1 text-xs text-stone-600">
                已載入 {galleryForRender.photos.length} 張照片
                {uploadContext &&
                  ` · 攝影師推薦 ${galleryForRender.photos.filter((photo) => photo.photographerRecommended).length}`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="gallery-view-switch"
              role="group"
              aria-label="圖庫顯示方式"
            >
              <button
                type="button"
                aria-label="瀑布流"
                title="瀑布流"
                aria-pressed={galleryView === 'masonry'}
                onClick={() => setGalleryView('masonry')}
              >
                <StudioIcon name="projects" width={18} height={18} />
              </button>
              <button
                type="button"
                aria-label="圖片清單"
                title="圖片清單"
                aria-pressed={galleryView === 'list'}
                onClick={() => setGalleryView('list')}
              >
                <StudioIcon name="list" width={18} height={18} />
              </button>
            </div>
            <button
              type="button"
              aria-label={galleryForRender.loading ? '載入中…' : '重新整理'}
              title={galleryForRender.loading ? '載入中…' : '重新整理'}
              className="min-h-10 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              disabled={galleryForRender.loading}
              onClick={() => void loadFirstPage()}
            >
              <StudioIcon name="refresh" width={18} height={18} />
            </button>
          </div>
        </div>

        {pinError && (
          <p className="mt-3 text-sm text-rose-700" role="alert">
            {pinError}
          </p>
        )}

        {uploadContext && (
          <PhotographerRecommendationPolicy key={albumId} albumId={albumId} />
        )}
        {uploadContext && (
          <details className="studio-settings">
            <summary>進階相簿整理</summary>
            <MatchingFilenameIndexPanel
              workspaceId={uploadContext.workspaceId}
              projectId={uploadContext.projectId}
              albumId={albumId}
            />
            <MatchingRuleIndexPanel
              key={'rule-index:' + albumId}
              albumId={albumId}
            />
          </details>
        )}

        {galleryForRender.loading && (
          <p className="mt-5 text-sm text-stone-600" role="status">
            正在載入照片…
          </p>
        )}

        {galleryForRender.error && (
          <div
            className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-4"
            role="alert"
          >
            <p className="text-sm text-stone-800">
              {errorMessage(galleryForRender.error)}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              {shouldOfferSignIn && (
                <a className="underline" href="/">
                  重新登入
                </a>
              )}
              <button
                type="button"
                className="underline"
                onClick={() =>
                  void (galleryForRender.photos.length > 0 &&
                  galleryForRender.nextCursor !== null
                    ? loadNextPage()
                    : loadFirstPage())
                }
              >
                {galleryForRender.photos.length > 0 &&
                galleryForRender.nextCursor !== null
                  ? '重試載入下一頁'
                  : '重新載入'}
              </button>
            </div>
          </div>
        )}

        {!galleryForRender.loading &&
          !galleryForRender.error &&
          galleryForRender.photos.length === 0 && (
            <p className="mt-5 text-sm text-stone-600">此相簿目前沒有照片。</p>
          )}

        {galleryForRender.photos.length > 0 && (
          <ul
            className={`mt-5 min-w-0 ${galleryView === 'masonry' ? 'gallery-masonry' : 'gallery-list'}`}
            data-testid="owner-gallery-photos"
            data-gallery-view={galleryView}
          >
            {galleryForRender.photos.map((photo) => {
              const displayFilename =
                galleryView === 'masonry'
                  ? photo.filename.replace(/\.[^.]+$/, '') || photo.filename
                  : photo.filename;
              const imageKey = thumbnailKey(photo);
              const thumbnailFailed = failedThumbnails.has(imageKey);
              const showThumbnail = canShowThumbnail(photo) && !thumbnailFailed;

              return (
                <li
                  key={photo.id}
                  className={`gallery-photo-card min-w-0 overflow-hidden rounded-md border border-stone-200 bg-white ${photo.processing === 'needs_review' && galleryView === 'masonry' ? 'col-span-2' : ''}`}
                >
                  {showThumbnail ? (
                    canOpenPreview(photo) ? (
                      <button
                        type="button"
                        aria-label={'開啟照片預覽：' + photo.filename}
                        className="group gallery-photo-open block w-full min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-stone-700"
                        onClick={(event) => {
                          returnFocusRef.current = event.currentTarget;
                          setFailedPreviewKey(null);
                          advancePhotoSelectionGeneration();
                          writePhotoUrl(photo.id, true);
                          openedLightboxHistoryRef.current = true;
                          activePhotoIdRef.current = photo.id;
                          setActivePhotoSelection({
                            albumId,
                            photoId: photo.id,
                            generation: photoSelectionGeneration.current,
                          });
                        }}
                      >
                        <span
                          className="gallery-photo-thumbnail flex min-w-0 items-center justify-center overflow-hidden bg-stone-100"
                          style={{
                            aspectRatio:
                              galleryView === 'masonry' &&
                              photo.width !== null &&
                              photo.height !== null
                                ? `${photo.width} / ${photo.height}`
                                : '4 / 3',
                          }}
                        >
                          <TrackedPhotoImage
                            photoId={photo.id}
                            versionId={photo.versionId}
                            src={photo.thumbnailUrl ?? undefined}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className={`h-full w-full ${galleryView === 'masonry' ? 'object-cover' : 'object-contain'}`}
                            onError={() =>
                              setFailedThumbnails((current) =>
                                new Set(current).add(imageKey),
                              )
                            }
                          />
                          {photo.photographerRecommended && (
                            <span className="gallery-recommendation-badge">
                              <span aria-hidden="true">★</span> 攝影師推薦
                            </span>
                          )}
                        </span>
                        <span className="gallery-photo-filename block min-w-0 break-all px-2 pt-2 text-sm font-medium group-hover:underline">
                          {displayFilename}
                        </span>
                        {galleryView === 'list' && (
                          <time
                            className="gallery-photo-date block px-2 pb-2 pt-1 text-xs text-stone-600"
                            dateTime={photo.createdAt}
                          >
                            {formattedDate(photo.createdAt)}
                          </time>
                        )}
                      </button>
                    ) : (
                      <div className="gallery-photo-unavailable min-w-0">
                        <span className="gallery-photo-thumbnail flex aspect-[4/3] min-w-0 items-center justify-center overflow-hidden bg-stone-100">
                          <TrackedPhotoImage
                            photoId={photo.id}
                            versionId={photo.versionId}
                            src={photo.thumbnailUrl ?? undefined}
                            alt={photo.filename}
                            loading="lazy"
                            decoding="async"
                            className={`h-full w-full ${galleryView === 'masonry' ? 'object-cover' : 'object-contain'}`}
                            onError={() =>
                              setFailedThumbnails((current) =>
                                new Set(current).add(imageKey),
                              )
                            }
                          />
                          {photo.photographerRecommended && (
                            <span className="gallery-recommendation-badge">
                              <span aria-hidden="true">★</span> 攝影師推薦
                            </span>
                          )}
                        </span>
                        <p className="gallery-photo-filename break-all px-2 pt-2 text-sm font-medium">
                          {displayFilename}
                        </p>
                        <p className="gallery-photo-date px-2 pb-2 pt-1 text-xs text-stone-600">
                          大圖預覽尚未提供
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="gallery-photo-unavailable min-w-0">
                      {thumbnailFailed ? (
                        <div
                          className="gallery-photo-thumbnail flex items-center justify-center overflow-hidden bg-stone-100 px-3 text-center"
                          role="status"
                        >
                          <p className="text-sm text-stone-600">
                            縮圖目前無法載入
                          </p>
                        </div>
                      ) : (
                        <PhotoStatusTile photo={photo} />
                      )}
                      <p className="gallery-photo-filename break-all px-2 pt-2 text-sm font-medium">
                        {displayFilename}
                      </p>
                      {galleryView === 'list' && (
                        <time
                          className="gallery-photo-date block px-2 pb-2 pt-1 text-xs text-stone-600"
                          dateTime={photo.createdAt}
                        >
                          {formattedDate(photo.createdAt)}
                        </time>
                      )}
                    </div>
                  )}
                  {uploadContext &&
                    photo.isPinned !== undefined &&
                    photo.pinRevision !== undefined && (
                      <PhotoPinButton
                        photo={photo}
                        pending={pinPendingPhotoIds.has(photo.id)}
                        retryTarget={pinRetryTargets.get(photo.id)}
                        onClick={() => void setPhotoPinned(photo)}
                      />
                    )}
                  {photo.processing === 'retryable' && uploadContext && (
                    <ProcessingReview
                      key={`${photo.id}:${photo.versionId}:retry`}
                      photoId={photo.id}
                      versionId={photo.versionId}
                      retryOnly
                      onResolved={() => void loadFirstPage()}
                    />
                  )}
                  {photo.processing === 'needs_review' && (
                    <ProcessingReview
                      key={`${photo.id}:${photo.versionId}`}
                      photoId={photo.id}
                      versionId={photo.versionId}
                      onResolved={() => void loadFirstPage()}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!galleryForRender.loading &&
          !galleryForRender.error &&
          galleryForRender.nextCursor !== null && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                disabled={galleryForRender.loadingMore}
                onClick={() => void loadNextPage()}
              >
                {galleryForRender.loadingMore ? '載入中…' : '載入更多照片'}
              </button>
            </div>
          )}

        {galleryForRender.loadingMore && (
          <p className="mt-3 text-center text-sm text-stone-600" role="status">
            正在載入更多照片…
          </p>
        )}

        {lightboxOpen && activePhoto && (
          <div className="kino-photo-detail-overlay">
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className={
                photoToolsOpen
                  ? 'kino-photo-detail-dialog'
                  : 'kino-photo-detail-dialog kino-photo-detail-dialog--tools-collapsed'
              }
            >
              <div className="kino-photo-detail-header">
                <div className="min-w-0">
                  <p className="kino-photo-detail-eyebrow">PHOTO / DETAIL</p>
                  <h2 className="kino-photo-detail-title">相片詳情</h2>
                  <p
                    className="kino-photo-detail-index"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {activePhotoIndex + 1} / {readyPhotos.length}
                  </p>
                </div>
                <div className="kino-photo-detail-header-actions">
                  <button
                    type="button"
                    className="kino-photo-detail-tools-toggle"
                    aria-label={
                      photoToolsOpen ? '收合照片工具' : '展開照片工具'
                    }
                    aria-expanded={photoToolsOpen}
                    aria-controls={photoToolsId}
                    title={photoToolsOpen ? '收合照片工具' : '展開照片工具'}
                    disabled={anyPending}
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
                  <button
                    ref={closeButtonRef}
                    disabled={anyPending}
                    type="button"
                    className="kino-photo-detail-close"
                    onClick={closeLightbox}
                  >
                    關閉
                  </button>
                </div>
              </div>

              <div className="kino-photo-detail-stage">
                {activePhoto.photographerRecommended && (
                  <span className="kino-photo-detail-recommendation">
                    <span aria-hidden="true">★</span> 攝影師推薦
                  </span>
                )}
                {pinError && (
                  <p className="kino-photo-detail-pin-error" role="alert">
                    {pinError}
                  </p>
                )}
                {uploadContext &&
                  activePhoto.isPinned !== undefined &&
                  activePhoto.pinRevision !== undefined && (
                    <PhotoPinButton
                      photo={activePhoto}
                      pending={pinPendingPhotoIds.has(activePhoto.id)}
                      retryTarget={pinRetryTargets.get(activePhoto.id)}
                      onClick={() => void setPhotoPinned(activePhoto)}
                    />
                  )}
                {!annotationCanvasPortalActive &&
                  (failedPreviewKey === thumbnailKey(activePhoto) ? (
                    <p className="kino-photo-detail-error">
                      大圖目前無法載入，請稍後重新整理相簿。
                    </p>
                  ) : (
                    <TrackedPhotoImage
                      photoId={activePhoto.id}
                      versionId={activePhoto.versionId}
                      src={activePhoto.previewUrl ?? undefined}
                      alt={activePhoto.filename}
                      decoding="async"
                      className="kino-photo-detail-image"
                      onError={() =>
                        setFailedPreviewKey(thumbnailKey(activePhoto))
                      }
                    />
                  ))}
                <div
                  ref={setAnnotationCanvasHostRef}
                  className="kino-photo-detail-canvas-host"
                />
              </div>

              <aside
                id={photoToolsId}
                hidden={!photoToolsOpen}
                className="kino-photo-detail-tools"
                onClickCapture={(event) => {
                  const trigger =
                    event.target instanceof Element
                      ? event.target.closest(
                          '[data-testid="owner-version-comparison-entry"]',
                        )
                      : null;
                  if (trigger?.getAttribute('aria-expanded') === 'false') {
                    const area = event.currentTarget;
                    window.requestAnimationFrame(() =>
                      area.scrollTo({ top: 0, behavior: 'auto' }),
                    );
                  }
                }}
              >
                <section
                  className="kino-photo-detail-metadata"
                  aria-label="照片資訊"
                >
                  <p className="kino-photo-detail-eyebrow">PHOTO FILE</p>
                  <h3 id={titleId} className="kino-photo-detail-filename">
                    {activePhoto.filename}
                  </h3>
                  <dl className="kino-photo-detail-facts">
                    <div>
                      <dt>檔案尺寸</dt>
                      <dd>
                        {activePhoto.width !== null &&
                        activePhoto.height !== null
                          ? activePhoto.width +
                            ' × ' +
                            activePhoto.height +
                            ' px'
                          : '尚無尺寸資料'}
                      </dd>
                    </div>
                  </dl>
                </section>
                <div
                  data-photo-version-panel
                  className="kino-photo-detail-panels"
                >
                  {uploadContext && (
                    <PhotographerPhotoEditor
                      key={
                        'photographer:' +
                        activePhoto.id +
                        ':' +
                        activePhoto.versionId
                      }
                      photoId={activePhoto.id}
                      versionId={activePhoto.versionId}
                      onPendingChange={onRecommendationPendingChange}
                    />
                  )}
                  <PhotoVersionsPanel
                    photoId={activePhoto.id}
                    {...(uploadContext
                      ? { uploadContext: { ...uploadContext, albumId } }
                      : {})}
                    onPendingChange={onVersionPendingChange}
                    onCurrentChanged={() => {
                      returnFocusRef.current = photosTitleRef.current;
                      void loadFirstPage();
                    }}
                  />
                  <OwnerVersionComparisonPanel
                    key={
                      'owner-version-comparison:' +
                      albumId +
                      ':' +
                      activePhoto.id +
                      ':' +
                      activePhoto.versionId +
                      ':' +
                      activePhotoSelectionGeneration
                    }
                    albumId={albumId}
                    photoId={activePhoto.id}
                    filename={activePhoto.filename}
                    expectedCurrentVersionId={activePhoto.versionId}
                    onUnauthorized={(status) =>
                      onOwnerAnnotationUnauthorized(
                        albumId,
                        activePhoto.id,
                        activePhotoSelectionGeneration,
                        status,
                      )
                    }
                    onHeadChanged={() => {
                      returnFocusRef.current = photosTitleRef.current;
                      void loadFirstPage();
                    }}
                    onGateHidden={() => closeButtonRef.current?.focus()}
                  />
                  {uploadContext && (
                    <OwnerVersionApprovalsPanel
                      key={
                        'version-approvals:' +
                        albumId +
                        ':' +
                        activePhoto.id +
                        ':' +
                        activePhoto.versionId
                      }
                      workspaceId={uploadContext.workspaceId}
                      projectId={uploadContext.projectId}
                      albumId={albumId}
                      photoId={activePhoto.id}
                      filename={activePhoto.filename}
                      onPendingChange={onDeliveryPendingChange}
                    />
                  )}
                  {uploadContext && (
                    <OwnerCommentsPanel
                      key={activePhoto.id}
                      albumId={albumId}
                      projectId={uploadContext.projectId}
                      photoId={activePhoto.id}
                      currentVersionId={activePhoto.versionId}
                      filename={activePhoto.filename}
                      onPendingChange={onCommentPendingChange}
                    />
                  )}
                  {uploadContext && (
                    <OwnerAnnotationsPanel
                      key={'annotations:' + activePhoto.id}
                      albumId={albumId}
                      projectId={uploadContext.projectId}
                      photoId={activePhoto.id}
                      currentVersionId={activePhoto.versionId}
                      filename={activePhoto.filename}
                      canvasContainer={annotationCanvasHost}
                      onCanvasPortalActiveChange={
                        setAnnotationCanvasPortalActive
                      }
                      onPendingChange={onOwnerAnnotationPendingChange}
                      onUnauthorized={(status) =>
                        onOwnerAnnotationUnauthorized(
                          albumId,
                          activePhoto.id,
                          activePhotoSelectionGeneration,
                          status,
                        )
                      }
                    />
                  )}
                </div>
                {commentPending && (
                  <p role="status" className="kino-photo-detail-pending">
                    留言操作結果尚待確認，請先重試原操作或明確放棄本機恢復紀錄。
                  </p>
                )}
                {ownerAnnotationPending && (
                  <p role="status" className="kino-photo-detail-pending">
                    Owner
                    標記草稿或操作尚待確認，請先完成、重試原操作或明確放棄。
                  </p>
                )}
                {versionPending && (
                  <p role="status" className="kino-photo-detail-pending">
                    版本操作結果尚待確認，請先完成或重試此操作。
                  </p>
                )}
                {deliveryPending && (
                  <p role="status" className="kino-photo-detail-pending">
                    成品交付操作尚待核對，請先完成或重試原操作。
                  </p>
                )}
              </aside>
              <div className="kino-photo-detail-navigation">
                <button
                  type="button"
                  className="kino-photo-detail-step"
                  aria-label="上一張"
                  title="上一張照片"
                  disabled={anyPending || activePhotoIndex <= 0}
                  onClick={() => moveLightbox(-1)}
                >
                  <StudioIcon
                    name="chevronDown"
                    width={20}
                    height={20}
                    style={{ transform: 'rotate(90deg)' }}
                  />
                </button>
                <button
                  type="button"
                  className="kino-photo-detail-step"
                  aria-label="下一張"
                  title="下一張照片"
                  disabled={
                    anyPending ||
                    activePhotoIndex < 0 ||
                    activePhotoIndex >= readyPhotos.length - 1
                  }
                  onClick={() => moveLightbox(1)}
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
                className="kino-photo-detail-thumbnails"
                aria-label="相簿照片縮圖列"
              >
                {readyPhotos.map((photo, index) => (
                  <button
                    key={photo.id}
                    type="button"
                    aria-label={`切換至第 ${index + 1} 張：${photo.filename}`}
                    title={`${index + 1}. ${photo.filename}`}
                    aria-current={
                      photo.id === activePhoto.id ? 'true' : undefined
                    }
                    onClick={() => {
                      if (anyPending || photo.id === activePhoto.id) return;
                      writePhotoUrl(photo.id, false);
                      advancePhotoSelectionGeneration();
                      activePhotoIdRef.current = photo.id;
                      setFailedPreviewKey(null);
                      setActivePhotoSelection({
                        albumId,
                        photoId: photo.id,
                        generation: photoSelectionGeneration.current,
                      });
                    }}
                  >
                    {canShowThumbnail(photo) ? (
                      <TrackedPhotoImage
                        photoId={photo.id}
                        versionId={photo.versionId}
                        src={photo.thumbnailUrl ?? undefined}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="kino-photo-detail-thumbnail-image"
                      />
                    ) : (
                      <span className="kino-photo-detail-thumbnail-placeholder">
                        {index + 1}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        )}
      </section>
    </HumanPhotoViewsProvider>
  );
}
