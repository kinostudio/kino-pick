'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type ImgHTMLAttributes,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { z } from 'zod';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import {
  humanViewCapabilitiesSchema,
  humanViewRequestSchema,
  humanViewResultSchema,
  type HumanViewCapabilities,
} from '../../../packages/contracts/src/human-views';
import { getUploadIdentity } from './upload-client';

type HumanPhotoViewsMode = 'owner' | 'guest';

type PhotoRegistration = {
  photoId: string;
  versionId: string;
  source: string;
};

type TrackedPhoto = PhotoRegistration & {
  element: HTMLImageElement;
  loaded: boolean;
  intersectionRatio: number;
  eligible: boolean;
  eligibleSince: number | null;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  retrySpent: boolean;
};

type ActiveReport = {
  photo: TrackedPhoto;
  photoGeneration: number;
  providerGeneration: number;
  controller: AbortController;
};

type Principal = {
  expectedActorId: string;
  identityKey: string;
};

type TrackingContextValue = {
  register: (element: HTMLImageElement, photo: PhotoRegistration) => void;
  unregister: (element: HTMLImageElement) => void;
  loaded: (element: HTMLImageElement, success: boolean) => void;
};

const TrackingContext = createContext<TrackingContextValue | null>(null);
const uuidSchema = z.uuid();
const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });

class HumanViewRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isPrivateImageSource(
  source: string,
  photoId: string,
  versionId: string,
) {
  if (!source || typeof window === 'undefined') return false;
  try {
    const url = new URL(source, window.location.href);
    const match = url.pathname.match(
      /^\/api\/(?:v1|guest)\/photos\/([^/]+)\/versions\/([^/]+)\/assets\/(?:thumbnail|preview)$/i,
    );
    return (
      url.origin === window.location.origin &&
      url.search === '' &&
      match !== null &&
      uuidSchema.safeParse(match[1]).success &&
      uuidSchema.safeParse(match[2]).success &&
      match[1]?.toLowerCase() === photoId.toLowerCase() &&
      match[2]?.toLowerCase() === versionId.toLowerCase() &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function assignForwardedRef(
  ref: ForwardedRef<HTMLImageElement>,
  value: HTMLImageElement | null,
) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function errorCode(body: unknown) {
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success
    ? parsed.data.error.code
    : 'HUMAN_PHOTO_VIEWS_UNAVAILABLE';
}

function principalKeyForGuest(access: z.infer<typeof guestAlbumAccessSchema>) {
  return JSON.stringify({
    guestId: access.guestId,
    inviteId: access.inviteId,
    workspaceId: access.workspaceId,
    projectId: access.projectId,
    albumId: access.albumId,
    expiresAt: access.expiresAt,
    permissions: access.permissions,
  });
}

export function HumanPhotoViewsProvider({
  mode,
  albumId,
  children,
}: {
  mode: HumanPhotoViewsMode;
  albumId: string;
  children: ReactNode;
}) {
  const photosRef = useRef(new Map<HTMLImageElement, TrackedPhoto>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const syncPhotoRef = useRef<((photo: TrackedPhoto) => void) | null>(null);
  const capabilitiesRef = useRef<HumanViewCapabilities | null>(null);
  const stoppedRef = useRef(false);
  const focusedRef = useRef(false);
  const providerGenerationRef = useRef(0);
  const activeReportRef = useRef<ActiveReport | null>(null);
  const cooldownUntilRef = useRef(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unregister = useCallback((element: HTMLImageElement) => {
    const photo = photosRef.current.get(element);
    if (!photo) return;
    photo.generation += 1;
    if (photo.timer !== null) clearTimeout(photo.timer);
    photo.timer = null;
    observerRef.current?.unobserve(element);
    if (activeReportRef.current?.photo === photo)
      activeReportRef.current.controller.abort();
    photosRef.current.delete(element);
  }, []);

  const register = useCallback(
    (element: HTMLImageElement, photo: PhotoRegistration) => {
      if (!isPrivateImageSource(photo.source, photo.photoId, photo.versionId))
        return;
      unregister(element);
      const tracked: TrackedPhoto = {
        ...photo,
        element,
        loaded: element.complete && element.naturalWidth > 0,
        intersectionRatio: 0,
        eligible: false,
        eligibleSince: null,
        generation: 0,
        timer: null,
        retrySpent: false,
      };
      photosRef.current.set(element, tracked);
      observerRef.current?.observe(element);
      syncPhotoRef.current?.(tracked);
    },
    [unregister],
  );

  const loaded = useCallback((element: HTMLImageElement, success: boolean) => {
    const photo = photosRef.current.get(element);
    if (!photo) return;
    photo.loaded = success && element.naturalWidth > 0;
    syncPhotoRef.current?.(photo);
  }, []);

  useEffect(() => {
    const providerGeneration = providerGenerationRef.current + 1;
    providerGenerationRef.current = providerGeneration;
    const photos = photosRef.current;
    stoppedRef.current = false;
    focusedRef.current = document.hasFocus();
    capabilitiesRef.current = null;
    cooldownUntilRef.current = 0;

    let capabilityController: AbortController | null = null;

    const clearPhotoTimer = (photo: TrackedPhoto) => {
      if (photo.timer !== null) clearTimeout(photo.timer);
      photo.timer = null;
    };

    const clearCooldownTimer = () => {
      if (cooldownTimerRef.current !== null)
        clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    };

    const stopProvider = () => {
      stoppedRef.current = true;
      clearCooldownTimer();
      for (const photo of photos.values()) clearPhotoTimer(photo);
      activeReportRef.current?.controller.abort();
    };

    const environmentVisible = () =>
      document.visibilityState === 'visible' && focusedRef.current;

    const eligibleNow = (photo: TrackedPhoto) =>
      !stoppedRef.current &&
      capabilitiesRef.current?.enabled === true &&
      observerRef.current !== null &&
      photosRef.current.get(photo.element) === photo &&
      photo.loaded &&
      photo.element.naturalWidth > 0 &&
      photo.intersectionRatio >= 0.5 &&
      environmentVisible() &&
      isPrivateImageSource(photo.source, photo.photoId, photo.versionId);

    const scheduleCooldownWake = () => {
      clearCooldownTimer();
      const delay = Math.max(0, cooldownUntilRef.current - Date.now());
      cooldownTimerRef.current = setTimeout(
        () => {
          cooldownTimerRef.current = null;
          for (const photo of photosRef.current.values())
            syncPhotoRef.current?.(photo);
        },
        Math.min(delay, 2_147_000_000),
      );
    };

    const syncPhoto = (photo: TrackedPhoto) => {
      if (!eligibleNow(photo)) {
        clearPhotoTimer(photo);
        if (photo.eligible) {
          const priorGeneration = photo.generation;
          photo.eligible = false;
          photo.eligibleSince = null;
          photo.generation += 1;
          photo.retrySpent = false;
          const active = activeReportRef.current;
          if (
            active?.photo === photo &&
            active.photoGeneration === priorGeneration
          ) {
            active.controller.abort();
          }
        }
        return;
      }

      if (!photo.eligible) {
        photo.eligible = true;
        photo.eligibleSince = performance.now();
        photo.generation += 1;
        photo.retrySpent = false;
      }
      if (photo.timer !== null || photo.retrySpent) return;
      if (activeReportRef.current !== null) return;
      if (cooldownUntilRef.current > Date.now()) {
        scheduleCooldownWake();
        return;
      }

      const visibleFor = photo.eligibleSince
        ? performance.now() - photo.eligibleSince
        : 0;
      const waitFor = Math.max(
        0,
        (capabilitiesRef.current?.minVisibleMs ?? 1_000) - visibleFor,
      );
      const expectedGeneration = photo.generation;
      photo.timer = setTimeout(() => {
        photo.timer = null;
        if (
          !eligibleNow(photo) ||
          photo.generation !== expectedGeneration ||
          photo.eligibleSince === null
        ) {
          syncPhoto(photo);
          return;
        }
        if (
          performance.now() - photo.eligibleSince <
          (capabilitiesRef.current?.minVisibleMs ?? 1_000)
        ) {
          syncPhoto(photo);
          return;
        }
        void sendHeartbeat(photo, expectedGeneration, providerGeneration);
      }, waitFor);
    };

    syncPhotoRef.current = syncPhoto;

    const readPrincipal = async (signal: AbortSignal): Promise<Principal> => {
      if (mode === 'owner') {
        const identity = await getUploadIdentity(signal);
        return {
          expectedActorId: uuidSchema.parse(identity.actorId),
          identityKey: JSON.stringify({
            mode,
            actorId: identity.actorId,
            sessionId: identity.sessionId,
          }),
        };
      }

      const response = await fetch(
        '/api/guest/albums/' +
          encodeURIComponent(uuidSchema.parse(albumId)) +
          '/access',
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok)
        throw new HumanViewRequestError(response.status, errorCode(body));
      const parsed = z
        .object({ access: guestAlbumAccessSchema })
        .strict()
        .safeParse(body);
      if (
        !parsed.success ||
        parsed.data.access.albumId !== albumId ||
        !parsed.data.access.permissions.can_view ||
        Date.parse(parsed.data.access.expiresAt) <= Date.now()
      ) {
        throw new HumanViewRequestError(401, 'GUEST_ACCESS_REQUIRED');
      }
      return {
        expectedActorId: parsed.data.access.guestId,
        identityKey: principalKeyForGuest(parsed.data.access),
      };
    };

    const taskIsCurrent = (task: ActiveReport) =>
      providerGenerationRef.current === task.providerGeneration &&
      activeReportRef.current === task &&
      !task.controller.signal.aborted &&
      task.photo.generation === task.photoGeneration &&
      eligibleNow(task.photo);

    const waitBriefly = (signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 1_000);
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });

    async function sendHeartbeat(
      photo: TrackedPhoto,
      photoGeneration: number,
      currentProviderGeneration: number,
    ) {
      if (
        activeReportRef.current !== null ||
        !eligibleNow(photo) ||
        photo.generation !== photoGeneration ||
        currentProviderGeneration !== providerGenerationRef.current
      ) {
        syncPhoto(photo);
        return;
      }
      const controller = new AbortController();
      const task: ActiveReport = {
        photo,
        photoGeneration,
        providerGeneration: currentProviderGeneration,
        controller,
      };
      activeReportRef.current = task;

      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            let principalBefore: Principal;
            try {
              principalBefore = await readPrincipal(controller.signal);
            } catch {
              if (!controller.signal.aborted) stopProvider();
              return;
            }
            if (!taskIsCurrent(task)) return;
            let principalCurrent: Principal;
            try {
              principalCurrent = await readPrincipal(controller.signal);
            } catch {
              if (!controller.signal.aborted) stopProvider();
              return;
            }
            if (!taskIsCurrent(task)) return;
            if (principalBefore.identityKey !== principalCurrent.identityKey) {
              stopProvider();
              return;
            }

            const request = humanViewRequestSchema.parse({
              photoId: photo.photoId,
              versionId: photo.versionId,
              expectedActorId: principalCurrent.expectedActorId,
              visibleForMs: capabilitiesRef.current?.minVisibleMs ?? 1_000,
            });
            if (!taskIsCurrent(task)) return;
            const path =
              mode === 'owner'
                ? '/api/v1/albums/' +
                  encodeURIComponent(uuidSchema.parse(albumId)) +
                  '/view-heartbeats'
                : '/api/guest/albums/' +
                  encodeURIComponent(uuidSchema.parse(albumId)) +
                  '/view-heartbeats';
            const response = await fetch(path, {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
              },
              cache: 'no-store',
              redirect: 'error',
              referrerPolicy: 'no-referrer',
              body: JSON.stringify(request),
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            const body: unknown = await response.json().catch(() => null);
            if (!response.ok) {
              const code = errorCode(body);
              if (response.status < 500 || code === 'OWNER_IDENTITY_CHANGED') {
                stopProvider();
                return;
              }
              throw new HumanViewRequestError(response.status, code);
            }
            const parsed = humanViewResultSchema.safeParse(body);
            if (!parsed.success) {
              stopProvider();
              return;
            }
            if (providerGenerationRef.current !== currentProviderGeneration)
              return;
            const serverNextAllowedAt = Date.parse(parsed.data.nextAllowedAt);
            if (!Number.isFinite(serverNextAllowedAt)) {
              stopProvider();
              return;
            }
            cooldownUntilRef.current = Math.max(
              Date.now() + 1_000,
              serverNextAllowedAt,
            );
            return;
          } catch (error) {
            if (controller.signal.aborted) return;
            if (
              error instanceof HumanViewRequestError &&
              (error.status < 500 ||
                error.code === 'OWNER_IDENTITY_CHANGED' ||
                error.code === 'GUEST_ACCESS_REQUIRED')
            ) {
              stopProvider();
              return;
            }
            if (error instanceof z.ZodError) {
              stopProvider();
              return;
            }
            if (attempt === 0 && taskIsCurrent(task)) {
              await waitBriefly(controller.signal);
              if (taskIsCurrent(task)) continue;
            }
            photo.retrySpent = true;
            stopProvider();
            return;
          }
        }
      } finally {
        if (activeReportRef.current === task) activeReportRef.current = null;
        if (cooldownUntilRef.current > Date.now() && !stoppedRef.current)
          scheduleCooldownWake();
        else if (!stoppedRef.current) {
          for (const candidate of photosRef.current.values())
            syncPhoto(candidate);
        }
      }
    }

    const syncAllPhotos = () => {
      for (const photo of photosRef.current.values()) syncPhoto(photo);
    };
    const updateEnvironment = () => {
      focusedRef.current = document.hasFocus();
      syncAllPhotos();
    };

    if (typeof IntersectionObserver === 'undefined') {
      stopProvider();
      return () => {
        providerGenerationRef.current += 1;
        syncPhotoRef.current = null;
        capabilityController?.abort();
      };
    }

    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const photo = photosRef.current.get(
            record.target as HTMLImageElement,
          );
          if (!photo) continue;
          photo.intersectionRatio = record.isIntersecting
            ? record.intersectionRatio
            : 0;
          syncPhoto(photo);
        }
      },
      { threshold: [0, 0.5] },
    );
    observerRef.current = observer;
    for (const photo of photosRef.current.values())
      observer.observe(photo.element);

    const handleBlur = () => {
      focusedRef.current = false;
      syncAllPhotos();
    };
    const handleFocus = () => {
      focusedRef.current = true;
      syncAllPhotos();
    };
    const handleVisibility = () => updateEnvironment();
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handleBlur);
    window.addEventListener('pageshow', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    capabilityController = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/human-views/capabilities', {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: capabilityController?.signal,
        });
        if (!response.ok) return;
        const body: unknown = await response.json().catch(() => null);
        const parsed = humanViewCapabilitiesSchema.safeParse(body);
        if (
          !parsed.success ||
          providerGenerationRef.current !== providerGeneration ||
          capabilityController?.signal.aborted
        ) {
          return;
        }
        capabilitiesRef.current = parsed.data;
        if (!parsed.data.enabled) return;
        for (const photo of photosRef.current.values()) syncPhoto(photo);
      } catch {
        // This telemetry is optional; a failed capability read means no POSTs.
      }
    })();

    return () => {
      providerGenerationRef.current += 1;
      capabilityController?.abort();
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handleBlur);
      window.removeEventListener('pageshow', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearCooldownTimer();
      for (const photo of photos.values()) clearPhotoTimer(photo);
      activeReportRef.current?.controller.abort();
      observer.disconnect();
      observerRef.current = null;
      syncPhotoRef.current = null;
      capabilitiesRef.current = null;
      stoppedRef.current = true;
    };
  }, [albumId, mode]);

  const value = useMemo<TrackingContextValue>(
    () => ({ register, unregister, loaded }),
    [loaded, register, unregister],
  );

  return (
    <TrackingContext.Provider value={value}>
      {children}
    </TrackingContext.Provider>
  );
}

export type TrackedPhotoImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'ref'
> & {
  photoId: string;
  versionId: string;
};

export const TrackedPhotoImage = forwardRef<
  HTMLImageElement,
  TrackedPhotoImageProps
>(function TrackedPhotoImage(
  { photoId, versionId, onLoad, onError, src, ...imageProps },
  forwardedRef,
) {
  const tracking = useContext(TrackingContext);
  const elementRef = useRef<HTMLImageElement | null>(null);
  const attachRef = useCallback(
    (element: HTMLImageElement | null) => {
      const previous = elementRef.current;
      if (previous && previous !== element) tracking?.unregister(previous);
      elementRef.current = element;
      if (element) {
        tracking?.register(element, {
          photoId,
          versionId,
          source: typeof src === 'string' ? src : '',
        });
      }
      assignForwardedRef(forwardedRef, element);
    },
    [forwardedRef, photoId, src, tracking, versionId],
  );
  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      try {
        onLoad?.(event);
      } finally {
        tracking?.loaded(
          event.currentTarget,
          event.currentTarget.naturalWidth > 0,
        );
      }
    },
    [onLoad, tracking],
  );
  // One delayed reload of the same private URL absorbs a transient 503 from
  // the asset route; a second failure is reported exactly as before.
  const [retry, setRetry] = useState<{ src: unknown; attempt: number }>({
    src,
    attempt: 0,
  });
  const attempt = retry.src === src ? retry.attempt : 0;
  const retryTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (retryTimerRef.current !== null)
        window.clearTimeout(retryTimerRef.current);
    },
    [],
  );
  const handleError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (attempt === 0 && typeof src === 'string' && src !== '') {
        if (retryTimerRef.current !== null)
          window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setRetry({ src, attempt: 1 });
        }, 1200);
        return;
      }
      try {
        onError?.(event);
      } finally {
        tracking?.loaded(event.currentTarget, false);
      }
    },
    [attempt, onError, src, tracking],
  );

  return (
    <img
      key={attempt}
      {...imageProps}
      data-kino-photo-id={photoId}
      data-kino-version-id={versionId}
      alt={imageProps.alt ?? ''}
      src={src}
      ref={attachRef}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
});
