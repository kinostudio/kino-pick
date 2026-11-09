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
import {
  photoDisplayLeaseRequestSchema,
  photoDisplayLeaseResultSchema,
} from '../../../packages/contracts/src/photo-display-leases';
import { getUploadIdentity } from './upload-client';
import {
  isPhotoDisplayLeaseCurrent,
  photoDisplayLeaseRemaining,
  type PhotoDisplayLeaseWindow,
} from './photo-display-lease-client';

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

type DisplayMode = 'unknown' | 'legacy' | 'leased' | 'unsupported';

type DisplayLeaseGrant = PhotoDisplayLeaseWindow & {
  identityKey: string;
};

type DisplayLeaseTask = {
  providerGeneration: number;
  controller: AbortController;
};

type DisplayContextValue = {
  revision: number;
  canDisplay: (photoId: string, versionId: string) => boolean;
};

const TrackingContext = createContext<TrackingContextValue | null>(null);
const DisplayContext = createContext<DisplayContextValue | null>(null);
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

function displayKey(photoId: string, versionId: string) {
  return `${photoId.toLowerCase()}:${versionId.toLowerCase()}`;
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
  const displayModeRef = useRef<DisplayMode>('unknown');
  const provisionalStartRef = useRef<PhotoDisplayLeaseWindow | null>(null);
  const displayLeasesRef = useRef(new Map<string, DisplayLeaseGrant>());
  const displayLeaseTasksRef = useRef(new Map<string, DisplayLeaseTask>());
  const displayLeaseFailuresRef = useRef(new Set<string>());
  const displayIdentityKeyRef = useRef<string | null>(null);
  const displayIdentityVerifiedRef = useRef(false);
  const displayLeasePausedRef = useRef(false);
  const [displayRevision, setDisplayRevision] = useState(0);
  const [displayIssue, setDisplayIssue] = useState<'error' | 'expired' | null>(
    null,
  );
  const retryDisplayRef = useRef<() => void>(() => {});

  const canDisplay = useCallback((photoId: string, versionId: string) => {
    const mode = displayModeRef.current;
    if (mode === 'legacy') return true;
    if (mode === 'unsupported') return false;
    const nowWall = Date.now();
    const nowPerformance = performance.now();
    if (mode === 'unknown') {
      if (provisionalStartRef.current === null) return false;
      return isPhotoDisplayLeaseCurrent(
        provisionalStartRef.current,
        nowWall,
        nowPerformance,
      );
    }
    if (displayLeasePausedRef.current || !displayIdentityVerifiedRef.current) {
      return false;
    }
    const lease = displayLeasesRef.current.get(displayKey(photoId, versionId));
    return Boolean(
      lease &&
      lease.identityKey === displayIdentityKeyRef.current &&
      isPhotoDisplayLeaseCurrent(lease, nowWall, nowPerformance),
    );
  }, []);

  const displayValue = useMemo<DisplayContextValue>(
    () => ({ revision: displayRevision, canDisplay }),
    [canDisplay, displayRevision],
  );

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
    const key = displayKey(photo.photoId, photo.versionId);
    if (
      !Array.from(photosRef.current.values()).some(
        (candidate) =>
          displayKey(candidate.photoId, candidate.versionId) === key,
      )
    ) {
      displayLeasesRef.current.delete(key);
      displayLeaseFailuresRef.current.delete(key);
      displayLeaseTasksRef.current.get(key)?.controller.abort();
      setDisplayRevision((revision) => revision + 1);
    }
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
    let documentNonce: string | null = null;
    providerGenerationRef.current = providerGeneration;
    provisionalStartRef.current = {
      startedAtWall: Date.now(),
      startedAtPerformance: performance.now(),
      displayForMs: 600_000,
    };
    const photos = photosRef.current;
    const displayLeases = displayLeasesRef.current;
    const displayLeaseTasks = displayLeaseTasksRef.current;
    const displayLeaseFailures = displayLeaseFailuresRef.current;
    stoppedRef.current = false;
    focusedRef.current = document.hasFocus();
    capabilitiesRef.current = null;
    cooldownUntilRef.current = 0;
    displayModeRef.current = 'unknown';
    displayIdentityKeyRef.current = null;
    displayIdentityVerifiedRef.current = false;
    displayLeasePausedRef.current = false;
    displayLeaseFailuresRef.current.clear();
    displayLeasesRef.current.clear();
    for (const task of displayLeaseTasksRef.current.values())
      task.controller.abort();
    displayLeaseTasksRef.current.clear();
    let capabilityController: AbortController | null = null;
    let leaseIdentityCheckController: AbortController | null = null;
    let provisionalTimer: ReturnType<typeof setTimeout> | null = null;
    let provisionalRevealTimer: ReturnType<typeof setTimeout> | null = null;
    let displayClockTimer: ReturnType<typeof setInterval> | null = null;
    let leaseNeedsIdentityCheck = false;
    let provisionalExpired = false;
    const clearUnknownDisplayTimers = () => {
      if (provisionalTimer !== null) clearTimeout(provisionalTimer);
      provisionalTimer = null;
      if (displayClockTimer !== null) clearInterval(displayClockTimer);
      displayClockTimer = null;
    };

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
      document.visibilityState === 'visible' &&
      focusedRef.current &&
      !('prerendering' in document && document.prerendering === true);

    const isInActivePhotoSurface = (photo: TrackedPhoto) => {
      const modal = Array.from(
        document.querySelectorAll<HTMLElement>(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        ),
      )
        .filter((element) => element.getClientRects().length > 0)
        .at(-1);
      return !modal || modal.contains(photo.element);
    };

    const photoSurfaceVisible = (photo: TrackedPhoto) =>
      observerRef.current !== null &&
      photosRef.current.get(photo.element) === photo &&
      photo.loaded &&
      photo.element.naturalWidth > 0 &&
      photo.intersectionRatio >= 0.5 &&
      environmentVisible() &&
      isInActivePhotoSurface(photo) &&
      isPrivateImageSource(photo.source, photo.photoId, photo.versionId);

    const displayLeaseCurrent = (photo: TrackedPhoto) => {
      const lease = displayLeasesRef.current.get(
        displayKey(photo.photoId, photo.versionId),
      );
      return Boolean(
        !displayLeasePausedRef.current &&
        displayIdentityVerifiedRef.current &&
        lease &&
        lease.identityKey === displayIdentityKeyRef.current &&
        isPhotoDisplayLeaseCurrent(lease, Date.now(), performance.now()),
      );
    };

    const eligibleNow = (photo: TrackedPhoto) =>
      !stoppedRef.current &&
      capabilitiesRef.current?.enabled === true &&
      (displayModeRef.current !== 'leased' || displayLeaseCurrent(photo)) &&
      photoSurfaceVisible(photo);

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
      syncDisplayLease(photo);
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

    let syncAllPhotos = () => {};
    const leaseCandidateNow = (photo: TrackedPhoto) =>
      displayModeRef.current === 'leased' &&
      !displayLeasePausedRef.current &&
      photoSurfaceVisible(photo);
    const candidatesForLease = (key: string) =>
      Array.from(photos.values()).filter(
        (photo) =>
          displayKey(photo.photoId, photo.versionId) === key &&
          leaseCandidateNow(photo),
      );
    const clearDisplayLease = (key: string) => {
      displayLeasesRef.current.delete(key);
    };
    const stopDisplayLeaseController = () => {
      stopProvider();
      displayLeasePausedRef.current = true;
      displayIdentityVerifiedRef.current = false;
      leaseIdentityCheckController?.abort();
      leaseIdentityCheckController = null;
      for (const task of displayLeaseTasksRef.current.values())
        task.controller.abort();
      for (const key of displayLeasesRef.current.keys()) clearDisplayLease(key);
      displayLeaseFailuresRef.current.clear();
      setDisplayIssue('error');
      setDisplayRevision((revision) => revision + 1);
    };

    const markLeaseFailure = (key: string, issue: 'error' | 'expired') => {
      displayLeaseFailuresRef.current.add(key);
      setDisplayIssue(issue);
      setDisplayRevision((revision) => revision + 1);
    };

    const checkDisplayClocks = () => {
      let changed = false;
      for (const [key, lease] of displayLeasesRef.current) {
        if (!isPhotoDisplayLeaseCurrent(lease, Date.now(), performance.now())) {
          clearDisplayLease(key);
          displayLeaseFailuresRef.current.add(key);
          changed = true;
        }
      }
      if (
        displayModeRef.current === 'unknown' &&
        !provisionalExpired &&
        !isPhotoDisplayLeaseCurrent(
          provisionalStartRef.current!,
          Date.now(),
          performance.now(),
        )
      ) {
        provisionalExpired = true;
        setDisplayIssue('expired');
        changed = true;
      }
      if (changed) {
        if (displayLeaseFailuresRef.current.size > 0)
          setDisplayIssue('expired');
        setDisplayRevision((revision) => revision + 1);
      }
      if (displayModeRef.current === 'leased' && !displayLeasePausedRef.current)
        for (const photo of photosRef.current.values()) syncDisplayLease(photo);
    };
    const startDisplayClockTimer = () => {
      if (displayClockTimer === null)
        displayClockTimer = setInterval(checkDisplayClocks, 1_000);
    };

    const requestDisplayLease = async (
      photo: TrackedPhoto,
      key: string,
      currentProviderGeneration: number,
    ) => {
      if (
        displayLeaseTasksRef.current.has(key) ||
        displayLeaseTasksRef.current.size >= 2 ||
        !candidatesForLease(key).length ||
        displayLeaseFailuresRef.current.has(key)
      ) {
        return;
      }
      const controller = new AbortController();
      const task: DisplayLeaseTask = {
        providerGeneration: currentProviderGeneration,
        controller,
      };
      displayLeaseTasksRef.current.set(key, task);
      const taskIsCurrent = () =>
        providerGenerationRef.current === task.providerGeneration &&
        displayLeaseTasksRef.current.get(key) === task &&
        !controller.signal.aborted &&
        displayModeRef.current === 'leased' &&
        !displayLeasePausedRef.current &&
        candidatesForLease(key).length > 0;

      try {
        const principalBefore = await readPrincipal(controller.signal);
        if (!taskIsCurrent()) return;
        if (
          displayIdentityKeyRef.current !== null &&
          displayIdentityKeyRef.current !== principalBefore.identityKey
        ) {
          stopDisplayLeaseController();
          return;
        }
        documentNonce ??= crypto.randomUUID().toLowerCase();
        const request = photoDisplayLeaseRequestSchema.parse({
          documentId: documentNonce,
          photoId: photo.photoId,
          versionId: photo.versionId,
          expectedActorId: principalBefore.expectedActorId,
        });
        const path =
          mode === 'owner'
            ? '/api/v1/albums/' +
              encodeURIComponent(uuidSchema.parse(albumId)) +
              '/display-leases'
            : '/api/guest/albums/' +
              encodeURIComponent(uuidSchema.parse(albumId)) +
              '/display-leases';
        const startedAtWall = Date.now();
        const startedAtPerformance = performance.now();
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
        if (!taskIsCurrent()) return;
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const code = errorCode(body);
          if (
            response.status === 401 ||
            code === 'OWNER_IDENTITY_CHANGED' ||
            code === 'GUEST_ACCESS_REQUIRED'
          ) {
            stopDisplayLeaseController();
          } else {
            markLeaseFailure(key, 'error');
          }
          return;
        }
        const parsed = photoDisplayLeaseResultSchema.safeParse(body);
        if (
          !parsed.success ||
          parsed.data.documentId !== request.documentId ||
          parsed.data.albumId !== albumId ||
          parsed.data.photoId !== photo.photoId ||
          parsed.data.versionId !== photo.versionId ||
          !Number.isFinite(Date.parse(parsed.data.issuedAt)) ||
          !Number.isFinite(Date.parse(parsed.data.protectedUntilAt)) ||
          Date.parse(parsed.data.protectedUntilAt) <=
            Date.parse(parsed.data.issuedAt)
        ) {
          displayModeRef.current = 'unsupported';
          stopDisplayLeaseController();
          return;
        }
        const principalAfter = await readPrincipal(controller.signal);
        if (!taskIsCurrent()) return;
        if (
          principalBefore.identityKey !== principalAfter.identityKey ||
          (displayIdentityKeyRef.current !== null &&
            displayIdentityKeyRef.current !== principalAfter.identityKey)
        ) {
          stopDisplayLeaseController();
          return;
        }
        const grantWindow: PhotoDisplayLeaseWindow = {
          startedAtWall,
          startedAtPerformance,
          displayForMs: Math.floor(
            Math.min(
              parsed.data.displayForMs,
              Date.parse(parsed.data.protectedUntilAt) -
                Date.parse(parsed.data.issuedAt),
            ),
          ),
        };
        if (
          grantWindow.displayForMs < 1_000 ||
          !isPhotoDisplayLeaseCurrent(
            grantWindow,
            Date.now(),
            performance.now(),
          )
        ) {
          markLeaseFailure(key, 'expired');
          return;
        }
        const lease: DisplayLeaseGrant = {
          ...grantWindow,
          identityKey: principalAfter.identityKey,
        };
        clearDisplayLease(key);
        displayLeasesRef.current.set(key, lease);
        displayIdentityKeyRef.current = principalAfter.identityKey;
        displayIdentityVerifiedRef.current = true;
        displayLeaseFailuresRef.current.delete(key);
        if (displayLeaseFailuresRef.current.size === 0) setDisplayIssue(null);
        setDisplayRevision((revision) => revision + 1);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof HumanViewRequestError && error.status === 401) {
          stopDisplayLeaseController();
        } else if (error instanceof z.ZodError) {
          displayModeRef.current = 'unsupported';
          stopDisplayLeaseController();
        } else {
          markLeaseFailure(key, 'error');
        }
      } finally {
        if (displayLeaseTasksRef.current.get(key) === task)
          displayLeaseTasksRef.current.delete(key);
        if (providerGenerationRef.current === currentProviderGeneration)
          syncAllPhotos();
      }
    };

    const syncDisplayLease = (photo: TrackedPhoto) => {
      if (displayModeRef.current !== 'leased') return;
      const key = displayKey(photo.photoId, photo.versionId);
      if (!leaseCandidateNow(photo)) {
        if (!candidatesForLease(key).length)
          displayLeaseTasksRef.current.get(key)?.controller.abort();
        return;
      }
      if (
        displayIdentityKeyRef.current !== null &&
        !displayIdentityVerifiedRef.current
      ) {
        return;
      }
      const lease = displayLeasesRef.current.get(key);
      if (lease) {
        if (lease.identityKey !== displayIdentityKeyRef.current) {
          stopDisplayLeaseController();
          return;
        }
        if (!isPhotoDisplayLeaseCurrent(lease, Date.now(), performance.now())) {
          clearDisplayLease(key);
          markLeaseFailure(key, 'expired');
          return;
        }
        const elapsed = Math.min(
          Date.now() - lease.startedAtWall,
          performance.now() - lease.startedAtPerformance,
        );
        if (
          elapsed <
          Math.max(
            1_000,
            lease.displayForMs - Math.min(300_000, lease.displayForMs / 2),
          )
        )
          return;
      }
      if (
        !displayLeaseTasksRef.current.has(key) &&
        displayLeaseTasksRef.current.size < 2 &&
        !displayLeaseFailuresRef.current.has(key)
      )
        void requestDisplayLease(photo, key, providerGeneration);
    };

    const verifyDisplayIdentity = async () => {
      if (
        displayModeRef.current !== 'leased' ||
        displayLeasePausedRef.current ||
        displayIdentityKeyRef.current === null ||
        leaseIdentityCheckController !== null
      ) {
        syncAllPhotos();
        return;
      }
      const controller = new AbortController();
      leaseIdentityCheckController = controller;
      displayIdentityVerifiedRef.current = false;
      setDisplayRevision((revision) => revision + 1);
      try {
        const principal = await readPrincipal(controller.signal);
        if (
          controller.signal.aborted ||
          providerGenerationRef.current !== providerGeneration
        ) {
          return;
        }
        if (principal.identityKey !== displayIdentityKeyRef.current) {
          stopDisplayLeaseController();
          return;
        }
        displayIdentityVerifiedRef.current = true;
        setDisplayRevision((revision) => revision + 1);
        syncAllPhotos();
      } catch {
        if (!controller.signal.aborted) stopDisplayLeaseController();
      } finally {
        if (leaseIdentityCheckController === controller)
          leaseIdentityCheckController = null;
      }
    };

    const retryDisplay = async () => {
      stoppedRef.current = false;
      cooldownUntilRef.current = 0;
      clearCooldownTimer();
      displayLeasePausedRef.current = false;
      displayIdentityKeyRef.current = null;
      displayIdentityVerifiedRef.current = false;
      displayLeaseFailuresRef.current.clear();
      leaseIdentityCheckController?.abort();
      leaseIdentityCheckController = null;
      for (const task of displayLeaseTasks.values()) task.controller.abort();
      for (const key of displayLeases.keys()) clearDisplayLease(key);
      setDisplayRevision((revision) => revision + 1);
      if (displayModeRef.current === 'leased') {
        syncAllPhotos();
        return;
      }
      capabilityController?.abort();
      const controller = new AbortController();
      capabilityController = controller;
      try {
        const response = await fetch('/api/human-views/capabilities', {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401) {
            displayModeRef.current = 'unsupported';
            clearUnknownDisplayTimers();
            stopDisplayLeaseController();
          } else {
            setDisplayIssue('error');
          }
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        const parsed = humanViewCapabilitiesSchema.safeParse(body);
        if (!parsed.success) {
          const hasDisplayLease =
            typeof body === 'object' &&
            body !== null &&
            Object.prototype.hasOwnProperty.call(body, 'displayLease');
          if (hasDisplayLease) {
            displayModeRef.current = 'unsupported';
            clearUnknownDisplayTimers();
          }
          setDisplayIssue('error');
        } else {
          capabilitiesRef.current = parsed.data;
          displayModeRef.current = parsed.data.displayLease
            ? 'leased'
            : 'legacy';
          if (parsed.data.displayLease) {
            if (provisionalTimer !== null) clearTimeout(provisionalTimer);
            provisionalTimer = null;
            startDisplayClockTimer();
          } else {
            clearUnknownDisplayTimers();
          }
          if (!parsed.data.displayLease) setDisplayIssue(null);
          else syncAllPhotos();
        }
        setDisplayRevision((revision) => revision + 1);
      } catch {
        if (!controller.signal.aborted) setDisplayIssue('error');
      }
    };

    retryDisplayRef.current = () => void retryDisplay();

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
              if (!controller.signal.aborted) {
                stopProvider();
                if (displayModeRef.current === 'leased')
                  stopDisplayLeaseController();
              }
              return;
            }
            if (!taskIsCurrent(task)) return;
            let principalCurrent: Principal;
            try {
              principalCurrent = await readPrincipal(controller.signal);
            } catch {
              if (!controller.signal.aborted) {
                stopProvider();
                if (displayModeRef.current === 'leased')
                  stopDisplayLeaseController();
              }
              return;
            }
            if (!taskIsCurrent(task)) return;
            if (principalBefore.identityKey !== principalCurrent.identityKey) {
              stopProvider();
              if (displayModeRef.current === 'leased')
                stopDisplayLeaseController();
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
                if (
                  displayModeRef.current === 'leased' &&
                  (response.status === 401 ||
                    code === 'OWNER_IDENTITY_CHANGED' ||
                    code === 'GUEST_ACCESS_REQUIRED')
                ) {
                  stopDisplayLeaseController();
                }
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
              if (
                displayModeRef.current === 'leased' &&
                (error.status === 401 ||
                  error.code === 'OWNER_IDENTITY_CHANGED' ||
                  error.code === 'GUEST_ACCESS_REQUIRED')
              ) {
                stopDisplayLeaseController();
              }
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

    syncAllPhotos = () => {
      for (const photo of photosRef.current.values()) syncPhoto(photo);
    };
    const provisionalWindow = {
      ...provisionalStartRef.current!,
    };
    provisionalRevealTimer = setTimeout(
      () => setDisplayRevision((revision) => revision + 1),
      0,
    );
    provisionalTimer = setTimeout(
      () => {
        if (
          displayModeRef.current === 'unknown' &&
          !provisionalExpired &&
          !isPhotoDisplayLeaseCurrent(
            provisionalWindow,
            Date.now(),
            performance.now(),
          )
        ) {
          provisionalExpired = true;
          setDisplayIssue('expired');
          setDisplayRevision((revision) => revision + 1);
        }
      },
      Math.max(
        0,
        photoDisplayLeaseRemaining(
          provisionalWindow,
          Date.now(),
          performance.now(),
        ),
      ),
    );
    startDisplayClockTimer();
    const updateEnvironment = () => {
      focusedRef.current = document.hasFocus();
      if (displayModeRef.current === 'leased') {
        if (!environmentVisible()) {
          leaseNeedsIdentityCheck = true;
          displayIdentityVerifiedRef.current = false;
          setDisplayRevision((revision) => revision + 1);
        } else if (leaseNeedsIdentityCheck) {
          leaseNeedsIdentityCheck = false;
          void verifyDisplayIdentity();
        }
      }
      syncAllPhotos();
    };

    if (typeof IntersectionObserver === 'undefined') {
      stopProvider();
      return () => {
        providerGenerationRef.current += 1;
        syncPhotoRef.current = null;
        capabilityController?.abort();
        clearUnknownDisplayTimers();
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
      if (displayModeRef.current === 'leased') {
        leaseNeedsIdentityCheck = true;
        displayIdentityVerifiedRef.current = false;
        setDisplayRevision((revision) => revision + 1);
      }
      syncAllPhotos();
    };
    const handleFocus = () => {
      focusedRef.current = true;
      updateEnvironment();
    };
    const handleVisibility = () => updateEnvironment();
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handleBlur);
    window.addEventListener('pageshow', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    document.addEventListener('focusin', handleVisibility);

    capabilityController = new AbortController();
    const currentCapabilityController = capabilityController;
    void (async () => {
      try {
        const response = await fetch('/api/human-views/capabilities', {
          method: 'GET',
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: currentCapabilityController.signal,
        });
        if (!response.ok) {
          if (response.status === 401) {
            displayModeRef.current = 'unsupported';
            clearUnknownDisplayTimers();
            stopDisplayLeaseController();
          } else {
            setDisplayIssue('error');
          }
          return;
        }
        const body: unknown = await response.json().catch(() => null);
        const parsed = humanViewCapabilitiesSchema.safeParse(body);
        const hasDisplayLease =
          typeof body === 'object' &&
          body !== null &&
          Object.prototype.hasOwnProperty.call(body, 'displayLease');
        if (
          providerGenerationRef.current !== providerGeneration ||
          currentCapabilityController.signal.aborted
        ) {
          return;
        }
        if (!parsed.success) {
          if (hasDisplayLease) {
            displayModeRef.current = 'unsupported';
            clearUnknownDisplayTimers();
          }
          setDisplayIssue('error');
          setDisplayRevision((revision) => revision + 1);
          return;
        }
        capabilitiesRef.current = parsed.data;
        displayModeRef.current = parsed.data.displayLease ? 'leased' : 'legacy';
        displayLeasePausedRef.current = false;
        if (parsed.data.displayLease) {
          if (provisionalTimer !== null) clearTimeout(provisionalTimer);
          provisionalTimer = null;
          startDisplayClockTimer();
        } else {
          clearUnknownDisplayTimers();
        }
        setDisplayIssue(null);
        setDisplayRevision((revision) => revision + 1);
        syncAllPhotos();
      } catch {
        // This telemetry is optional; a failed capability read means no POSTs.
        if (!currentCapabilityController.signal.aborted)
          setDisplayIssue('error');
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
      document.removeEventListener('focusin', handleVisibility);
      clearCooldownTimer();
      if (provisionalTimer !== null) clearTimeout(provisionalTimer);
      if (provisionalRevealTimer !== null) clearTimeout(provisionalRevealTimer);
      if (displayClockTimer !== null) clearInterval(displayClockTimer);
      for (const photo of photos.values()) clearPhotoTimer(photo);
      activeReportRef.current?.controller.abort();
      leaseIdentityCheckController?.abort();
      for (const task of displayLeaseTasks.values()) task.controller.abort();
      displayLeaseTasks.clear();
      for (const key of displayLeases.keys()) clearDisplayLease(key);
      displayLeaseFailures.clear();
      observer.disconnect();
      observerRef.current = null;
      syncPhotoRef.current = null;
      capabilitiesRef.current = null;
      stoppedRef.current = true;
      displayIdentityVerifiedRef.current = false;
      displayLeasePausedRef.current = true;
      retryDisplayRef.current = () => {};
    };
  }, [albumId, mode]);

  const value = useMemo<TrackingContextValue>(
    () => ({ register, unregister, loaded }),
    [loaded, register, unregister],
  );

  return (
    <TrackingContext.Provider value={value}>
      <DisplayContext.Provider value={displayValue}>
        {displayIssue && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBlock: '0.5rem',
            }}
          >
            <span>
              {displayIssue === 'expired'
                ? '照片顯示期限已到，請重新連線。'
                : '照片連線暫停，請重新連線。'}
            </span>
            <button
              type="button"
              onClick={() => retryDisplayRef.current()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
              }}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 7v5h-5M4 17v-5h5" />
                <path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" />
              </svg>
              重新連線
            </button>
          </div>
        )}
        {children}
      </DisplayContext.Provider>
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
  const display = useContext(DisplayContext);
  const displayAllowed = display?.canDisplay(photoId, versionId) ?? true;
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
  const handleError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      try {
        onError?.(event);
      } finally {
        tracking?.loaded(event.currentTarget, false);
      }
    },
    [onError, tracking],
  );

  return (
    <img
      {...imageProps}
      data-kino-photo-id={photoId}
      data-kino-version-id={versionId}
      alt={imageProps.alt ?? ''}
      src={src}
      style={
        displayAllowed
          ? imageProps.style
          : { ...imageProps.style, visibility: 'hidden' }
      }
      ref={attachRef}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
});
