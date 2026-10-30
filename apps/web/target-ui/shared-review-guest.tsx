'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import {
  galleryPageSchema,
  type GalleryPhoto,
} from '../../../packages/contracts/src/gallery';
import {
  guestSharedReviewListSchema,
  guestSharedReviewMetadataSchema,
  sharedReviewCapabilitiesSchema,
  sharedReviewSelectionPageSchema,
  sharedReviewSelectionResultSchema,
  sharedReviewSubmitResultSchema,
  type GuestSharedReviewMetadata,
} from '../../../packages/contracts/src/shared-review';

type ApiErrorShape = { status: number; code: string };
type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; failure: ApiErrorShape };
type CapabilityState = 'loading' | 'enabled' | 'disabled' | 'unavailable';
type SelectionSnapshot = {
  review: GuestSharedReviewMetadata;
  selectedMap: Map<string, string>;
};
type MutationIntent = {
  scopeKey: string;
  photoId: string;
  bodyJson: string;
  requestId: string;
};
type SubmitIntent = {
  scopeKey: string;
  bodyJson: string;
  requestId: string;
};

class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

const uuidSchema = z.uuid();

function apiPath(albumId: string, reviewId?: string, suffix = '') {
  const base =
    '/api/guest/albums/' + encodeURIComponent(albumId) + '/shared-reviews';
  return reviewId ? base + '/' + encodeURIComponent(reviewId) + suffix : base;
}

function metadataPath(albumId: string, reviewId: string) {
  return apiPath(albumId, reviewId);
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
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
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFailure(502, 'INVALID_RESPONSE');
  return parsed.data;
}

function sameReview(
  left: GuestSharedReviewMetadata,
  right: GuestSharedReviewMetadata,
) {
  return (
    left.id === right.id &&
    left.guestId === right.guestId &&
    left.albumId === right.albumId &&
    left.roundNo === right.roundNo &&
    left.revision === right.revision &&
    left.status === right.status &&
    left.minimum === right.minimum &&
    left.maximum === right.maximum &&
    left.canSelect === right.canSelect &&
    left.canSubmit === right.canSubmit &&
    left.canView === right.canView &&
    left.canSubmitNow === right.canSubmitNow &&
    left.selectedCount === right.selectedCount &&
    left.submittedAt === right.submittedAt
  );
}

function messageFor(error: unknown) {
  if (!(error instanceof ApiFailure)) {
    return '連線結果尚未確認。請保留目前操作，稍後重試同一項目。';
  }
  if (error.status === 401) {
    return '目前訪客授權無法存取這筆共同挑片，或邀請已失效。';
  }
  if (error.status === 409) {
    return '共同挑片內容已變更或目前已鎖定。請先重新整理目前狀態。';
  }
  if (error.code === 'GUEST_SHARED_SELECTION_DISABLED') {
    return '共同挑片功能目前未開放。';
  }
  return '目前無法載入或更新共同挑片，請稍後再試。';
}

async function loadSelectionSnapshot(
  albumId: string,
  reviewId: string,
): Promise<SelectionSnapshot> {
  let lastError: unknown = new ApiFailure(409, 'SHARED_REVIEW_CHANGED');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const selectedMap = new Map<string, string>();
    const seenCursors = new Set<string>();
    let firstPage: z.infer<typeof sharedReviewSelectionPageSchema> | null =
      null;
    let cursor: string | null = null;
    try {
      while (true) {
        const query: string = cursor
          ? '?cursor=' + encodeURIComponent(cursor)
          : '';
        const page: z.infer<typeof sharedReviewSelectionPageSchema> =
          await requestJson(
            apiPath(albumId, reviewId, '/selection' + query),
            sharedReviewSelectionPageSchema,
          );
        if (firstPage && !sameReview(firstPage.review, page.review)) {
          throw new ApiFailure(409, 'SHARED_REVIEW_CHANGED');
        }
        firstPage ??= page;
        for (const item of page.items) {
          if (selectedMap.has(item.photoId)) {
            throw new ApiFailure(409, 'SHARED_REVIEW_CHANGED');
          }
          selectedMap.set(item.photoId, item.versionId);
        }
        cursor = page.nextCursor;
        if (!cursor) break;
        if (seenCursors.has(cursor)) {
          throw new ApiFailure(409, 'SHARED_REVIEW_CHANGED');
        }
        seenCursors.add(cursor);
      }
      if (!firstPage || firstPage.review.selectedCount !== selectedMap.size) {
        throw new ApiFailure(409, 'SHARED_REVIEW_CHANGED');
      }
      const confirmed = await requestJson(
        apiPath(albumId, reviewId, '/selection'),
        sharedReviewSelectionPageSchema,
      );
      if (
        !sameReview(firstPage.review, confirmed.review) ||
        selectedMap.size !== confirmed.review.selectedCount
      ) {
        throw new ApiFailure(409, 'SHARED_REVIEW_CHANGED');
      }
      return { review: confirmed.review, selectedMap };
    } catch (error) {
      lastError = error;
      if (
        attempt === 2 ||
        !(error instanceof ApiFailure && error.status === 409)
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

export function GuestSharedReviewLinks({ albumId }: { albumId: string }) {
  const [capability, setCapability] = useState<CapabilityState>('loading');
  const [reviews, setReviews] = useState<
    LoadState<z.infer<typeof guestSharedReviewListSchema>>
  >({ status: 'loading' });

  useEffect(() => {
    if (!uuidSchema.safeParse(albumId).success) return;
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const result = await requestJson(
          '/api/guest/shared-reviews/capabilities',
          sharedReviewCapabilitiesSchema,
          { signal: controller.signal },
        );
        if (!active) return;
        if (!result.enabled) {
          setCapability('disabled');
          setReviews({ status: 'ready', value: { reviews: [] } });
          return;
        }
        setCapability('enabled');
        const current = await requestJson(
          apiPath(albumId),
          guestSharedReviewListSchema,
          { signal: controller.signal },
        );
        if (active) setReviews({ status: 'ready', value: current });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        const failure =
          error instanceof ApiFailure
            ? { status: error.status, code: error.code }
            : { status: 503, code: 'SERVICE_UNAVAILABLE' };
        setCapability('unavailable');
        setReviews({ status: 'error', failure });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [albumId]);

  if (capability === 'loading') return null;
  if (capability === 'disabled') {
    return (
      <p className="mt-5 text-sm text-stone-500" aria-live="polite">
        共同挑片目前未開放。
      </p>
    );
  }
  if (capability === 'unavailable') {
    return (
      <p className="mt-5 text-sm text-stone-600" role="status">
        目前無法確認共同挑片狀態，因此不顯示進入連結。
      </p>
    );
  }
  if (reviews.status === 'loading') {
    return (
      <p className="mt-5 text-sm text-stone-500" role="status">
        正在載入您可參與的共同挑片…
      </p>
    );
  }
  if (reviews.status === 'error') {
    return (
      <p className="mt-5 text-sm text-stone-600" role="status">
        目前無法載入您可參與的共同挑片。
      </p>
    );
  }
  if (reviews.value.reviews.length === 0) {
    return (
      <p className="mt-5 text-sm text-stone-500" aria-live="polite">
        目前沒有可參與的共同挑片。
      </p>
    );
  }

  return (
    <section
      aria-label="共同挑片"
      className="mt-6 rounded-xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5"
    >
      <h2 className="text-base font-semibold text-stone-900">共同挑片</h2>
      <p className="mt-1 text-sm text-stone-600">
        這是獨立的共同選擇空間。請明確進入；私人挑片、星等與收藏不會帶入或共享。
      </p>
      <ul className="mt-4 grid gap-3">
        {reviews.value.reviews.map((review) => (
          <li
            key={review.id}
            className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-stone-900">
                {review.title}
              </p>
              <p className="mt-1 text-xs text-stone-600">
                第 {review.roundNo} 輪 ·{' '}
                {review.status === 'submitted' ? '已送出並鎖定' : '進行中'}
                {review.selectedCount !== null
                  ? ' · 已選 ' + review.selectedCount + ' 張'
                  : ''}
              </p>
            </div>
            <a
              href={
                '/guest/albums/' +
                encodeURIComponent(albumId) +
                '/shared/' +
                encodeURIComponent(review.id)
              }
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-amber-800 px-3 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800"
            >
              {review.status === 'submitted' ? '查看共同挑片' : '進入共同挑片'}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function GuestSharedReviewPage({
  albumId,
  reviewId,
}: {
  albumId: string;
  reviewId: string;
}) {
  return (
    <GuestSharedReviewPageContent
      key={albumId + ':' + reviewId}
      albumId={albumId}
      reviewId={reviewId}
    />
  );
}

function GuestSharedReviewPageContent({
  albumId,
  reviewId,
}: {
  albumId: string;
  reviewId: string;
}) {
  const scopeKey = albumId + ':' + reviewId;
  const [capability, setCapability] = useState<CapabilityState>('loading');
  const [metadataState, setMetadataState] = useState<
    LoadState<GuestSharedReviewMetadata>
  >({ status: 'loading' });
  const [selectionState, setSelectionState] = useState<
    LoadState<SelectionSnapshot> | { status: 'not-allowed' }
  >({ status: 'loading' });
  const [galleryPages, setGalleryPages] = useState<
    z.infer<typeof galleryPageSchema>[]
  >([]);
  const [galleryState, setGalleryState] = useState<
    'loading' | 'ready' | 'not-allowed' | 'error'
  >('loading');
  const [galleryError, setGalleryError] = useState('');
  const [galleryPageIndex, setGalleryPageIndex] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const refreshRequiredRef = useRef(false);
  function setNeedsRefresh(value: boolean) {
    refreshRequiredRef.current = value;
    setRefreshRequired(value);
  }
  const [mutationPhase, setMutationPhase] = useState<
    'idle' | 'pending' | 'unknown'
  >('idle');
  const [mutationMessage, setMutationMessage] = useState('');
  const [submitPhase, setSubmitPhase] = useState<
    'idle' | 'pending' | 'unknown' | 'confirmed'
  >('idle');
  const [submitMessage, setSubmitMessage] = useState('');
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);

  const metadataRef = useRef<GuestSharedReviewMetadata | null>(null);
  const selectionRef = useRef<SelectionSnapshot | null>(null);
  const scopeRef = useRef(scopeKey);
  const pageGenerationRef = useRef(0);
  const selectionGenerationRef = useRef(0);
  const mutationLockRef = useRef(false);
  const submitLockRef = useRef(false);
  const submitPreparingRef = useRef(false);
  const mutationIntentRef = useRef<MutationIntent | null>(null);
  const submitIntentRef = useRef<SubmitIntent | null>(null);
  const confirmDialogRef = useRef<HTMLDivElement | null>(null);
  const confirmTitleId = useId();
  const confirmDescriptionId = useId();
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    scopeRef.current = scopeKey;
  }, [scopeKey]);

  const setMetadata = useCallback((value: GuestSharedReviewMetadata) => {
    metadataRef.current = value;
    setMetadataState({ status: 'ready', value });
  }, []);

  const setSelectionSnapshot = useCallback((value: SelectionSnapshot) => {
    selectionRef.current = value;
    setSelectionState({ status: 'ready', value });
  }, []);

  const isCurrent = useCallback(
    (capturedScope: string, capturedGeneration: number) =>
      scopeRef.current === capturedScope &&
      pageGenerationRef.current === capturedGeneration,
    [],
  );

  useEffect(() => {
    const generation = ++pageGenerationRef.current;
    const controller = new AbortController();
    let active = true;
    if (
      !uuidSchema.safeParse(albumId).success ||
      !uuidSchema.safeParse(reviewId).success
    ) {
      return () => {
        active = false;
        controller.abort();
        pageGenerationRef.current += 1;
      };
    }

    void (async () => {
      try {
        const capabilityResult = await requestJson(
          '/api/guest/shared-reviews/capabilities',
          sharedReviewCapabilitiesSchema,
          { signal: controller.signal },
        );
        if (!active || !isCurrent(scopeKey, generation)) return;
        if (!capabilityResult.enabled) {
          setCapability('disabled');
          setMetadataState({
            status: 'error',
            failure: { status: 503, code: 'GUEST_SHARED_SELECTION_DISABLED' },
          });
          return;
        }
        setCapability('enabled');

        const metadata = await requestJson(
          metadataPath(albumId, reviewId),
          guestSharedReviewMetadataSchema,
          { signal: controller.signal },
        );
        if (!active || !isCurrent(scopeKey, generation)) return;
        setMetadata(metadata);

        const selectionGeneration = ++selectionGenerationRef.current;
        const selectionTask = metadata.canSelect
          ? loadSelectionSnapshot(albumId, reviewId)
              .then((snapshot) => {
                if (
                  !active ||
                  !isCurrent(scopeKey, generation) ||
                  selectionGeneration !== selectionGenerationRef.current
                )
                  return;
                setMetadata(snapshot.review);
                setSelectionSnapshot(snapshot);
              })
              .catch((error: unknown) => {
                if (
                  !active ||
                  !isCurrent(scopeKey, generation) ||
                  selectionGeneration !== selectionGenerationRef.current
                )
                  return;
                const failure =
                  error instanceof ApiFailure
                    ? { status: error.status, code: error.code }
                    : { status: 503, code: 'SERVICE_UNAVAILABLE' };
                setSelectionState({ status: 'error', failure });
                if (failure.status === 409) setNeedsRefresh(true);
              })
          : Promise.resolve().then(() => {
              if (active && isCurrent(scopeKey, generation)) {
                selectionRef.current = null;
                setSelectionState({ status: 'not-allowed' });
              }
            });

        const galleryTask = metadata.canView
          ? requestJson(
              '/api/guest/albums/' + encodeURIComponent(albumId) + '/photos',
              galleryPageSchema,
              { signal: controller.signal },
            )
              .then((page) => {
                if (!active || !isCurrent(scopeKey, generation)) return;
                setGalleryPages([page]);
                setGalleryPageIndex(0);
                setGalleryState('ready');
              })
              .catch(() => {
                if (!active || !isCurrent(scopeKey, generation)) return;
                setGalleryState('error');
                setGalleryError('無法載入目前相簿照片。');
              })
          : Promise.resolve().then(() => {
              if (active && isCurrent(scopeKey, generation)) {
                setGalleryPages([]);
                setGalleryState('not-allowed');
              }
            });
        await Promise.all([selectionTask, galleryTask]);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        if (!isCurrent(scopeKey, generation)) return;
        const failure =
          error instanceof ApiFailure
            ? { status: error.status, code: error.code }
            : { status: 503, code: 'SERVICE_UNAVAILABLE' };
        setCapability(
          failure.code === 'GUEST_SHARED_SELECTION_DISABLED'
            ? 'disabled'
            : 'enabled',
        );
        setMetadataState({ status: 'error', failure });
      }
    })();

    return () => {
      active = false;
      controller.abort();
      pageGenerationRef.current += 1;
      selectionGenerationRef.current += 1;
    };
  }, [
    albumId,
    isCurrent,
    reviewId,
    scopeKey,
    setMetadata,
    setSelectionSnapshot,
  ]);

  const refreshSharedState = useCallback(async () => {
    const capturedScope = scopeKey;
    const generation = pageGenerationRef.current;
    const selectionGeneration = ++selectionGenerationRef.current;
    setRefreshing(true);
    setNeedsRefresh(false);
    setSubmitMessage('');
    setMutationMessage('');
    setSelectionState((current) =>
      current.status === 'not-allowed' ? current : { status: 'loading' },
    );

    try {
      const metadata = await requestJson(
        metadataPath(albumId, reviewId),
        guestSharedReviewMetadataSchema,
      );
      if (!isCurrent(capturedScope, generation)) return false;
      setMetadata(metadata);
      if (!metadata.canSelect) {
        selectionRef.current = null;
        setSelectionState({ status: 'not-allowed' });
        setNeedsRefresh(false);
        return true;
      }

      const snapshot = await loadSelectionSnapshot(albumId, reviewId);
      if (
        !isCurrent(capturedScope, generation) ||
        selectionGeneration !== selectionGenerationRef.current
      ) {
        return false;
      }
      setMetadata(snapshot.review);
      setSelectionSnapshot(snapshot);
      setNeedsRefresh(false);
      if (!mutationIntentRef.current) {
        setMutationPhase('idle');
        setMutationMessage('');
      }
      return true;
    } catch (error) {
      if (
        !isCurrent(capturedScope, generation) ||
        selectionGeneration !== selectionGenerationRef.current
      ) {
        return false;
      }
      const failure =
        error instanceof ApiFailure
          ? { status: error.status, code: error.code }
          : { status: 503, code: 'SERVICE_UNAVAILABLE' };
      setSelectionState({ status: 'error', failure });
      setNeedsRefresh(true);
      return false;
    } finally {
      if (
        isCurrent(capturedScope, generation) &&
        selectionGeneration === selectionGenerationRef.current
      ) {
        setRefreshing(false);
      }
    }
  }, [
    albumId,
    isCurrent,
    reviewId,
    scopeKey,
    setMetadata,
    setSelectionSnapshot,
  ]);

  async function refreshForCommand(): Promise<boolean> {
    const capturedScope = scopeKey;
    const generation = pageGenerationRef.current;
    const known = metadataRef.current;
    if (!known) return false;
    const fresh = await requestJson(
      metadataPath(albumId, reviewId),
      guestSharedReviewMetadataSchema,
    );
    if (!isCurrent(capturedScope, generation)) return false;
    if (!sameReview(known, fresh)) {
      setNeedsRefresh(true);
      setSubmitMessage(
        '其他參與者或攝影師已更新這一輪。請先重新整理目前狀態，再繼續操作。',
      );
      return false;
    }
    return true;
  }

  async function sendSelectionIntent(
    intent: MutationIntent,
    isRetry: boolean,
  ): Promise<boolean> {
    if (mutationLockRef.current) return false;
    mutationLockRef.current = true;
    setMutationPhase('pending');
    setMutationMessage(
      isRetry ? '正在使用原本的要求重試；請勿重複點選或執行相反操作。' : '',
    );

    const capturedScope = intent.scopeKey;
    const generation = pageGenerationRef.current;
    if (!isRetry) {
      try {
        if (!(await refreshForCommand())) {
          if (isCurrent(capturedScope, generation)) {
            mutationIntentRef.current = null;
            setMutationPhase('idle');
          }
          mutationLockRef.current = false;
          return false;
        }
      } catch {
        if (isCurrent(capturedScope, generation)) {
          mutationIntentRef.current = null;
          setMutationPhase('idle');
          setMutationMessage(
            '目前無法確認共同狀態，選取要求尚未送出。請重新整理後再試。',
          );
        }
        mutationLockRef.current = false;
        return false;
      }
    }
    if (!isCurrent(capturedScope, generation)) {
      mutationLockRef.current = false;
      return false;
    }
    try {
      const response = await fetch(
        apiPath(
          albumId,
          reviewId,
          '/photos/' + encodeURIComponent(intent.photoId) + '/selection',
        ),
        {
          method: 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: intent.bodyJson,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 200) {
        const parsed = sharedReviewSelectionResultSchema.safeParse(body);
        if (!parsed.success) {
          if (isCurrent(capturedScope, generation)) {
            mutationIntentRef.current = { ...intent };
            setMutationPhase('unknown');
            setMutationMessage(
              '伺服器已回應，但無法確認共同選片結果。請只重試同一項要求。',
            );
          }
          return false;
        }

        if (!isCurrent(capturedScope, generation)) return false;
        mutationIntentRef.current = null;
        setMutationPhase('idle');
        setMutationMessage('操作已確認，正在重新讀取共同選片狀態…');
        const refreshed = await refreshSharedState();
        if (isCurrent(capturedScope, generation)) {
          setMutationMessage(
            refreshed
              ? '共同選片狀態已重新同步。'
              : '操作已確認，但目前狀態尚未重新同步。請使用「重新整理共同挑片」。',
          );
        }
        return refreshed;
      }

      const parsedError = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(body);
      const code = parsedError.success
        ? parsedError.data.error.code
        : 'SERVICE_UNAVAILABLE';
      if (isRetry || response.status >= 500) {
        if (isCurrent(capturedScope, generation)) {
          mutationIntentRef.current = { ...intent };
          setMutationPhase('unknown');
          setMutationMessage(
            '這項要求的結果仍未確認。請重試同一要求；系統不會自動反向操作。',
          );
        }
        return false;
      }

      if (!isCurrent(capturedScope, generation)) return false;
      mutationIntentRef.current = null;
      setMutationPhase('idle');
      if (response.status === 409) {
        setNeedsRefresh(true);
        setMutationMessage(
          '共同名額或目前輪次已更新。請重新整理後再選取其他照片。',
        );
      } else {
        setMutationMessage(messageFor(new ApiFailure(response.status, code)));
      }
      return false;
    } catch {
      if (isCurrent(capturedScope, generation)) {
        mutationIntentRef.current = { ...intent };
        setMutationPhase('unknown');
        setMutationMessage(
          '連線中斷，這項要求可能已完成。請重試同一項要求，不要執行相反操作。',
        );
      }
      return false;
    } finally {
      mutationLockRef.current = false;
    }
  }

  async function changePhoto(photo: GalleryPhoto, selected: boolean) {
    const metadata = metadataRef.current;
    const snapshot = selectionRef.current;
    if (
      !metadata?.canSelect ||
      metadata.status !== 'open' ||
      !snapshot ||
      submitPreparingRef.current ||
      submitLockRef.current ||
      refreshRequiredRef.current ||
      busy ||
      mutationIntentRef.current ||
      mutationLockRef.current
    ) {
      return false;
    }

    if (
      selected &&
      !snapshot.selectedMap.has(photo.id) &&
      metadata.maximum !== null &&
      snapshot.selectedMap.size >= metadata.maximum
    ) {
      setMutationMessage('已達共同挑片上限；請先取消一張再選取。');
      return false;
    }

    let requestId: string;
    try {
      requestId = crypto.randomUUID();
    } catch {
      setMutationMessage('目前無法建立安全的要求編號，請重新載入後再試。');
      return false;
    }
    const intent: MutationIntent = {
      scopeKey,
      photoId: photo.id,
      requestId,
      bodyJson: JSON.stringify({
        requestId,
        roundNo: metadata.roundNo,
        versionId: photo.versionId,
        expectedGuestId: metadata.guestId,
        selected,
      }),
    };
    mutationIntentRef.current = intent;
    return sendSelectionIntent(intent, false);
  }

  async function togglePhoto(
    event: ChangeEvent<HTMLInputElement>,
    photo: GalleryPhoto,
  ) {
    await changePhoto(photo, event.currentTarget.checked);
  }

  async function retrySelectionIntent() {
    const intent = mutationIntentRef.current;
    if (!intent || intent.scopeKey !== scopeKey) return;
    await sendSelectionIntent(intent, true);
  }

  async function selectVisiblePage() {
    const metadata = metadataRef.current;
    const snapshot = selectionRef.current;
    if (!metadata?.canSelect || metadata.status !== 'open' || !snapshot) return;
    const changes = photos.filter(
      (photo) => snapshot.selectedMap.get(photo.id) !== photo.versionId,
    );
    if (changes.length === 0) return;

    const alreadySelected = changes.filter((photo) =>
      snapshot.selectedMap.has(photo.id),
    );
    const notSelected = changes.filter(
      (photo) => !snapshot.selectedMap.has(photo.id),
    );
    const slots =
      metadata.maximum === null
        ? notSelected.length
        : Math.max(0, metadata.maximum - snapshot.selectedMap.size);
    const plan = alreadySelected.concat(notSelected.slice(0, slots));

    for (const photo of plan) {
      if (
        !selectionRef.current ||
        refreshRequiredRef.current ||
        mutationIntentRef.current
      ) {
        break;
      }
      const changed = await changePhoto(photo, true);
      if (!changed) break;
    }
  }

  async function startSubmit() {
    const metadata = metadataRef.current;
    if (
      !metadata?.canSubmit ||
      !metadata.canSubmitNow ||
      metadata.status !== 'open' ||
      submitLockRef.current ||
      submitPreparingRef.current ||
      submitIntentRef.current ||
      busy
    ) {
      return;
    }
    setSubmitMessage('');
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setConfirmSubmitOpen(true);
  }

  async function submitOrRetry(existing?: SubmitIntent) {
    if (submitLockRef.current || submitPreparingRef.current) return;
    submitPreparingRef.current = true;
    setSubmitPhase('pending');
    setSubmitMessage('正在確認最新共同狀態…');
    const capturedScope = existing?.scopeKey ?? scopeKey;
    const generation = pageGenerationRef.current;
    const isRetry = Boolean(existing);
    let intent = existing;

    if (!intent) {
      const metadata = metadataRef.current;
      if (
        !metadata?.canSubmit ||
        !metadata.canSubmitNow ||
        metadata.status !== 'open'
      ) {
        setSubmitMessage('目前尚未符合共同挑片送出條件。');
        setSubmitPhase('idle');
        setConfirmSubmitOpen(false);
        submitPreparingRef.current = false;
        return;
      }
      try {
        const fresh = await requestJson(
          metadataPath(albumId, reviewId),
          guestSharedReviewMetadataSchema,
        );
        if (!isCurrent(capturedScope, generation)) {
          submitPreparingRef.current = false;
          return;
        }
        if (!sameReview(metadata, fresh)) {
          setNeedsRefresh(true);
          setSubmitMessage(
            '共同挑片狀態已變更。請先重新整理，再確認送出最新狀態。',
          );
          setSubmitPhase('idle');
          setConfirmSubmitOpen(false);
          submitPreparingRef.current = false;
          return;
        }
        if (!fresh.canSubmitNow || fresh.status !== 'open') {
          setSubmitMessage('目前尚未符合共同挑片送出條件。');
          setSubmitPhase('idle');
          setConfirmSubmitOpen(false);
          submitPreparingRef.current = false;
          return;
        }
        let requestId: string;
        try {
          requestId = crypto.randomUUID();
        } catch {
          setSubmitMessage('目前無法建立安全的送出要求，請稍後再試。');
          setSubmitPhase('idle');
          setConfirmSubmitOpen(false);
          submitPreparingRef.current = false;
          return;
        }
        intent = {
          scopeKey,
          requestId,
          bodyJson: JSON.stringify({
            requestId,
            expectedGuestId: fresh.guestId,
            roundNo: fresh.roundNo,
            expectedRevision: fresh.revision,
          }),
        };
        submitIntentRef.current = intent;
      } catch (error) {
        setSubmitMessage(messageFor(error));
        setSubmitPhase('idle');
        setConfirmSubmitOpen(false);
        submitPreparingRef.current = false;
        return;
      }
    }

    if (
      !isCurrent(capturedScope, generation) ||
      !intent ||
      intent.scopeKey !== scopeKey
    ) {
      setSubmitPhase('idle');
      setConfirmSubmitOpen(false);
      submitPreparingRef.current = false;
      return;
    }
    submitPreparingRef.current = false;
    submitLockRef.current = true;
    setSubmitPhase('pending');
    setSubmitMessage(
      isRetry
        ? '正在重試原本的送出要求；不會建立另一筆送出。'
        : '正在送出共同挑片…',
    );
    try {
      const response = await fetch(apiPath(albumId, reviewId, '/submit'), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: intent.bodyJson,
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 200) {
        const parsed = sharedReviewSubmitResultSchema.safeParse(body);
        if (!parsed.success) {
          if (isCurrent(capturedScope, generation)) {
            submitIntentRef.current = intent;
            setSubmitPhase('unknown');
            setSubmitMessage(
              '送出要求已回應，但無法確認結果。請只重試同一項送出要求。',
            );
            setConfirmSubmitOpen(false);
          }
          return;
        }

        if (!isCurrent(capturedScope, generation)) return;
        submitIntentRef.current = null;
        setConfirmSubmitOpen(false);
        setSubmitMessage('共同挑片已送出並鎖定，正在讀取目前狀態…');
        try {
          const fresh = await requestJson(
            metadataPath(albumId, reviewId),
            guestSharedReviewMetadataSchema,
          );
          if (!isCurrent(capturedScope, generation)) return;
          setMetadata(fresh);
          if (fresh.canSelect) {
            try {
              const snapshot = await loadSelectionSnapshot(albumId, reviewId);
              if (!isCurrent(capturedScope, generation)) return;
              setMetadata(snapshot.review);
              setSelectionSnapshot(snapshot);
            } catch {
              setNeedsRefresh(true);
            }
          }
          const current = selectionRef.current?.review ?? fresh;
          setSubmitMessage(
            current.status === 'submitted'
              ? '本輪共同挑片已送出並鎖定。'
              : '原提交已確認，目前第 ' + current.roundNo + ' 輪已重新開放。',
          );
          setSubmitPhase('confirmed');
        } catch {
          setSubmitMessage(
            '送出已確認，但目前狀態尚未重新同步。請重新整理共同挑片。',
          );
          setNeedsRefresh(true);
          setSubmitPhase('confirmed');
        }
        return;
      }

      const parsedError = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(body);
      const code = parsedError.success
        ? parsedError.data.error.code
        : 'SERVICE_UNAVAILABLE';
      if (isRetry || response.status >= 500) {
        if (isCurrent(capturedScope, generation)) {
          submitIntentRef.current = intent;
          setSubmitPhase('unknown');
          setSubmitMessage(
            '送出結果仍未確認。請重試原本要求；不會自動送出另一份內容。',
          );
          setConfirmSubmitOpen(false);
        }
        return;
      }

      if (!isCurrent(capturedScope, generation)) return;
      submitIntentRef.current = null;
      setSubmitPhase('idle');
      setConfirmSubmitOpen(false);
      if (response.status === 409) setNeedsRefresh(true);
      setSubmitMessage(messageFor(new ApiFailure(response.status, code)));
    } catch {
      if (isCurrent(capturedScope, generation)) {
        submitIntentRef.current = intent;
        setSubmitPhase('unknown');
        setSubmitMessage(
          '送出連線中斷，結果尚未確認。請只重試原本的送出要求。',
        );
        setConfirmSubmitOpen(false);
      }
    } finally {
      submitLockRef.current = false;
      submitPreparingRef.current = false;
    }
  }
  async function retrySubmitIntent() {
    const intent = submitIntentRef.current;
    if (!intent || intent.scopeKey !== scopeKey) return;
    await submitOrRetry(intent);
  }

  useEffect(() => {
    if (!confirmSubmitOpen || submitPhase === 'pending') return;
    const dialog = confirmDialogRef.current;
    if (!dialog) return;
    const controls = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    confirmButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmSubmitOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const buttons = controls();
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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [confirmSubmitOpen, submitPhase]);

  useEffect(() => {
    if (!confirmSubmitOpen) lastFocusedRef.current?.focus();
  }, [confirmSubmitOpen]);

  useEffect(() => {
    if (
      mutationPhase !== 'pending' &&
      mutationPhase !== 'unknown' &&
      submitPhase !== 'pending' &&
      submitPhase !== 'unknown'
    ) {
      return;
    }
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [mutationPhase, submitPhase]);

  async function loadNextGalleryPage() {
    const page = galleryPages[galleryPageIndex];
    if (!page?.nextCursor || galleryLoading) return;
    setGalleryLoading(true);
    setGalleryError('');
    try {
      const next = await requestJson(
        '/api/guest/albums/' +
          encodeURIComponent(albumId) +
          '/photos?cursor=' +
          encodeURIComponent(page.nextCursor),
        galleryPageSchema,
      );
      if (scopeRef.current !== scopeKey) return;
      const seen = new Set(
        galleryPages.flatMap((item) => item.photos.map((photo) => photo.id)),
      );
      if (next.photos.some((photo) => seen.has(photo.id))) {
        setGalleryState('error');
        setGalleryError('相簿分頁內容不一致，請重新整理頁面。');
        return;
      }
      setGalleryPages((current) => current.concat(next));
      setGalleryPageIndex((current) => current + 1);
    } catch {
      setGalleryError('無法載入下一頁照片。');
    } finally {
      setGalleryLoading(false);
    }
  }

  function loadPreviousGalleryPage() {
    if (galleryPageIndex > 0 && !galleryLoading) {
      setGalleryPageIndex((current) => current - 1);
    }
  }

  const currentMetadata =
    metadataState.status === 'ready' ? metadataState.value : null;
  const currentSnapshot =
    selectionState.status === 'ready' ? selectionState.value : null;
  const currentGallery = galleryPages[galleryPageIndex] ?? null;
  const currentPageHasNext =
    galleryPageIndex + 1 < galleryPages.length ||
    Boolean(currentGallery?.nextCursor);
  const currentRoundLocked = currentMetadata?.status !== 'open';
  const photos: GalleryPhoto[] = currentGallery?.photos ?? [];
  const selectedMap = currentSnapshot?.selectedMap ?? new Map<string, string>();
  const selectedCount =
    currentMetadata?.canSelect && currentSnapshot
      ? currentSnapshot.selectedMap.size
      : null;
  const maxReached =
    currentMetadata?.maximum !== null &&
    currentMetadata?.maximum !== undefined &&
    selectedCount !== null &&
    selectedCount >= currentMetadata.maximum;
  const busy =
    refreshing ||
    galleryLoading ||
    mutationPhase !== 'idle' ||
    submitPhase === 'pending' ||
    submitPhase === 'unknown' ||
    refreshRequired;
  const canEdit =
    Boolean(
      currentMetadata?.canSelect &&
      currentSnapshot &&
      currentMetadata.status === 'open',
    ) && !busy;
  const canSubmit =
    Boolean(
      currentMetadata?.canSubmit &&
      currentMetadata.canSubmitNow &&
      currentMetadata.status === 'open',
    ) && !busy;
  const canBatchSelect =
    canEdit &&
    photos.length > 0 &&
    photos.some((photo) =>
      selectedMap.has(photo.id)
        ? selectedMap.get(photo.id) !== photo.versionId
        : !maxReached,
    );

  if (capability === 'loading' || metadataState.status === 'loading') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 text-center" role="status">
        <p className="text-stone-600">正在載入共同挑片授權與狀態…</p>
      </main>
    );
  }

  if (capability === 'disabled') {
    return (
      <main className="mx-auto mt-10 max-w-xl px-4">
        <section
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-stone-900"
        >
          <h1 className="text-xl font-semibold">共同挑片目前未開放</h1>
          <p className="mt-2 text-sm text-stone-700">
            這個連結目前無法進入共同挑片。請返回私人相簿。
          </p>
          <a
            href={'/guest/albums/' + encodeURIComponent(albumId)}
            className="mt-4 inline-flex min-h-10 items-center text-sm font-medium text-amber-900 underline"
          >
            返回私人相簿
          </a>
        </section>
      </main>
    );
  }

  if (metadataState.status === 'error') {
    const denied = metadataState.failure.status === 401;
    return (
      <main className="mx-auto mt-10 max-w-xl px-4">
        <section
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-stone-900"
        >
          <h1 className="text-xl font-semibold">
            {denied ? '目前無法進入這筆共同挑片' : '共同挑片暫時無法使用'}
          </h1>
          <p className="mt-2 text-sm text-stone-700">
            {denied
              ? '目前訪客授權無法存取此共同挑片，或邀請已失效。'
              : messageFor(
                  new ApiFailure(
                    metadataState.failure.status,
                    metadataState.failure.code,
                  ),
                )}
          </p>
          <a
            href={'/guest/albums/' + encodeURIComponent(albumId)}
            className="mt-4 inline-flex min-h-10 items-center text-sm font-medium text-amber-900 underline"
          >
            返回私人相簿
          </a>
        </section>
      </main>
    );
  }

  const metadata =
    currentMetadata ??
    (metadataState.status === 'ready' ? metadataState.value : null);
  if (!metadata) return null;

  return (
    <div className="min-h-screen bg-stone-50 pb-32 text-stone-900">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold sm:text-xl">
              Kino Pick{' '}
              <span className="font-normal text-stone-500">共同挑片</span>
            </h1>
            <p className="text-xs text-stone-600 sm:text-sm">
              第 {metadata.roundNo} 輪 · 修訂 {metadata.revision} ·{' '}
              {metadata.status === 'submitted' ? '已送出並鎖定' : '進行中'}
            </p>
          </div>
          <a
            href={'/guest/albums/' + encodeURIComponent(albumId)}
            className="inline-flex min-h-10 items-center rounded-md border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            返回私人相簿
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
          <h2 className="text-lg font-semibold">{metadata.title}</h2>
          <p className="mt-2 text-sm font-semibold text-amber-950">
            共同選片，會影響所有參與者。
          </p>
          <p className="mt-1 text-sm text-stone-700">
            共同選取會使用同一份照片清單，任何參與者的選取都會改變共同結果。星等、收藏與私人挑片不會帶入或共享。
          </p>
          {metadata.canSelect && metadata.selectedCount !== null && (
            <p className="mt-3 text-sm text-stone-700">
              已選 {metadata.selectedCount} 張 · 至少 {metadata.minimum} 張 ·{' '}
              {metadata.maximum === null
                ? '不設上限'
                : '最多 ' + metadata.maximum + ' 張'}
            </p>
          )}
        </section>

        {refreshRequired && (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
          >
            <p className="text-sm text-amber-950">
              共同選取狀態已變更。按下重新整理前，照片選取與送出會暫停。
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={refreshing}
              onClick={() => void refreshSharedState()}
            >
              {refreshing ? '重新整理中…' : '重新整理共同挑片'}
            </Button>
          </div>
        )}

        {mutationMessage && (
          <p
            role={mutationPhase === 'unknown' ? 'alert' : 'status'}
            className="mt-4 text-sm text-stone-700"
          >
            {mutationMessage}
          </p>
        )}
        {mutationPhase === 'unknown' && (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void retrySelectionIntent()}
            >
              重試同一項共同選取要求
            </Button>
          </div>
        )}
        {submitMessage && (
          <p
            role={submitPhase === 'unknown' ? 'alert' : 'status'}
            className="mt-4 text-sm text-stone-700"
          >
            {submitMessage}
          </p>
        )}
        {submitPhase === 'unknown' && (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void retrySubmitIntent()}
            >
              重試同一項送出要求
            </Button>
          </div>
        )}

        {selectionState.status === 'loading' && metadata.canSelect && (
          <p role="status" className="mt-4 text-sm text-stone-600">
            正在讀取共同選取狀態…
          </p>
        )}
        {selectionState.status === 'error' && (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4"
          >
            <p className="text-sm text-amber-950">
              {messageFor(
                new ApiFailure(
                  selectionState.failure.status,
                  selectionState.failure.code,
                ),
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={refreshing}
              onClick={() => void refreshSharedState()}
            >
              重新整理共同挑片
            </Button>
          </div>
        )}

        {!metadata.canView && (
          <section className="mt-5 rounded-lg border border-stone-200 bg-white p-4">
            <h2 className="font-medium">此邀請沒有查看照片的權限</h2>
            <p className="mt-1 text-sm text-stone-600">
              目前不會載入照片或名稱。若您有送出權限，畫面會依共同挑片資格提供送出功能。
            </p>
          </section>
        )}

        {metadata.canView && (
          <>
            <div
              role="navigation"
              aria-label="共同挑片照片分頁"
              className="mb-4 mt-5 flex flex-wrap items-center justify-between gap-3"
            >
              <p aria-live="polite" className="text-sm text-stone-600">
                第 {galleryPageIndex + 1} 頁 · 顯示 {photos.length} 張照片
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {metadata.canSelect && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canBatchSelect || galleryLoading}
                    onClick={() => void selectVisiblePage()}
                  >
                    選取目前顯示頁面
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={galleryPageIndex === 0 || galleryLoading}
                  onClick={loadPreviousGalleryPage}
                  aria-label="上一頁共同挑片照片"
                >
                  上一頁
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!currentPageHasNext || galleryLoading}
                  onClick={() => void loadNextGalleryPage()}
                  aria-label="下一頁共同挑片照片"
                >
                  {galleryLoading ? '載入中…' : '下一頁'}
                </Button>
              </div>
            </div>

            {galleryState === 'loading' && (
              <p
                role="status"
                className="py-8 text-center text-sm text-stone-600"
              >
                正在載入照片…
              </p>
            )}
            {galleryState === 'error' && (
              <p role="alert" className="py-8 text-center text-sm text-red-800">
                {galleryError}
              </p>
            )}
            {galleryError && galleryState === 'ready' && (
              <p role="alert" className="mb-3 text-sm text-red-800">
                {galleryError}
              </p>
            )}
            {galleryState === 'ready' && photos.length === 0 && (
              <p className="rounded-lg border border-dashed border-stone-300 py-16 text-center text-stone-500">
                此相簿目前沒有照片。
              </p>
            )}
            {galleryState === 'ready' && photos.length > 0 && (
              <ul
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
                aria-label="共同挑片照片列表"
              >
                {photos.map((photo) => {
                  const isSelected = selectedMap.has(photo.id);
                  return (
                    <li
                      key={photo.id}
                      className={
                        'group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-white ' +
                        (isSelected
                          ? 'border-amber-700 ring-2 ring-amber-700/20'
                          : 'border-stone-200')
                      }
                    >
                      <div className="aspect-square w-full overflow-hidden bg-stone-100">
                        {photo.thumbnailUrl ? (
                          <img
                            src={photo.thumbnailUrl}
                            alt={photo.filename}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-stone-500">
                            {photo.processing === 'succeeded'
                              ? '預覽載入中…'
                              : '照片處理中'}
                          </div>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-2.5">
                        <span
                          className="min-w-0 flex-1 truncate text-xs text-stone-700"
                          title={photo.filename}
                        >
                          {photo.filename}
                        </span>
                        {metadata.canSelect && (
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={
                                !canEdit ||
                                currentRoundLocked ||
                                (!isSelected && maxReached)
                              }
                              onChange={(event) =>
                                void togglePhoto(event, photo)
                              }
                              aria-label={'共同選取 ' + photo.filename}
                              className="h-4 w-4 rounded border-stone-300 text-amber-700 focus:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <span
                              className={
                                isSelected
                                  ? 'font-medium text-amber-800'
                                  : 'text-stone-500'
                              }
                            >
                              {isSelected ? '已共同選取' : '共同選取'}
                            </span>
                          </label>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            其他參與者的最新變更不會即時推送。需要查看最新狀態時，請按「重新整理共同挑片」。
          </p>
          {!refreshRequired && (
            <Button
              type="button"
              variant="outline"
              disabled={
                refreshing ||
                mutationPhase === 'pending' ||
                submitPhase === 'pending'
              }
              onClick={() => void refreshSharedState()}
            >
              {refreshing ? '重新整理中…' : '重新整理共同挑片'}
            </Button>
          )}
        </div>
      </main>

      {metadata.canSubmit && (
        <aside
          aria-label="共同挑片送出列"
          className="fixed bottom-0 left-0 right-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p
                data-testid="shared-review-count"
                className="text-sm font-medium text-stone-900"
                aria-live="polite"
              >
                {metadata.canSelect && selectedCount !== null
                  ? '共同選取 ' + selectedCount + ' 張照片'
                  : '共同挑片送出資格'}
              </p>
              <p className="text-xs text-stone-500">
                {metadata.status === 'submitted'
                  ? '本輪已送出並鎖定。'
                  : metadata.canSelect && selectedCount !== null
                    ? selectedCount < metadata.minimum
                      ? '至少再選取 ' +
                        (metadata.minimum - selectedCount) +
                        ' 張即可送出。'
                      : '送出後，本輪共同選取會對所有參與者鎖定。'
                    : '送出時會由伺服器確認所有參與者的共同狀態。'}
              </p>
            </div>
            {metadata.status === 'submitted' ? (
              <span className="inline-flex min-h-10 items-center rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-700">
                本輪已鎖定
              </span>
            ) : (
              <Button
                type="button"
                disabled={!canSubmit}
                onClick={() => void startSubmit()}
                aria-label="送出共同挑片"
                data-testid="shared-review-submit"
              >
                送出共同挑片
              </Button>
            )}
          </div>
        </aside>
      )}

      {confirmSubmitOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={confirmTitleId}
          aria-describedby={confirmDescriptionId}
          ref={confirmDialogRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2
              id={confirmTitleId}
              className="text-lg font-semibold text-stone-900"
            >
              確認送出共同挑片？
            </h2>
            <p
              id={confirmDescriptionId}
              className="mt-2 text-sm text-stone-600"
            >
              送出後，本輪共同選取會對所有參與者鎖定。請確認您要送出目前這份共同選擇。
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={submitPhase === 'pending'}
                onClick={() => setConfirmSubmitOpen(false)}
              >
                返回修改
              </Button>
              <Button
                type="button"
                ref={confirmButtonRef}
                disabled={submitPhase === 'pending'}
                onClick={() => void submitOrRetry()}
                aria-label="確認送出共同挑片"
              >
                {submitPhase === 'pending' ? '送出中…' : '確認送出'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
