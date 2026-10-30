'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { z } from 'zod';
import type { GalleryPhoto } from '../../../packages/contracts/src/gallery';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import {
  guestFavoritePageSchema,
  guestFavoriteRequestSchema,
  guestFavoriteResultSchema,
  guestFeedbackCapabilitiesSchema,
  guestRatingPageSchema,
  guestRatingRequestSchema,
  guestRatingResultSchema,
  type GuestFavoriteState,
  type GuestRatingState,
} from '../../../packages/contracts/src/guest-feedback';

type FeedbackKind = 'rating' | 'favorite';
type SnapshotStatus = 'loading' | 'error' | 'ready';

type FeedbackSnapshot = {
  key: string;
  generation: number;
  status: SnapshotStatus;
  enabled: boolean;
  canRate: boolean;
  canFavorite: boolean;
  ratingStatus: 'ready' | 'error';
  favoriteStatus: 'ready' | 'error';
  ratings: ReadonlyMap<string, GuestRatingState>;
  favorites: ReadonlyMap<string, GuestFavoriteState>;
};

type RatingBody = z.infer<typeof guestRatingRequestSchema>;
type FavoriteBody = z.infer<typeof guestFavoriteRequestSchema>;

type RatingCommand = {
  kind: 'rating';
  albumId: string;
  photoId: string;
  versionId: string;
  url: string;
  body: RatingBody;
  bodyJson: string;
};

type FavoriteCommand = {
  kind: 'favorite';
  albumId: string;
  photoId: string;
  versionId: string;
  url: string;
  body: FavoriteBody;
  bodyJson: string;
};

type FeedbackCommand = RatingCommand | FavoriteCommand;

type OperationState =
  | {
      phase: 'pending' | 'uncertain' | 'syncing';
      command: FeedbackCommand;
    }
  | {
      phase: 'denied' | 'sync-error' | 'refreshing' | 'refresh-error';
      kind: FeedbackKind;
    };

class FeedbackApiFailure extends Error {
  constructor(public readonly statusCode: number) {
    super('Guest feedback request failed');
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
  if (!response.ok) throw new FeedbackApiFailure(response.status);
  return schema.parse(body);
}

function operationKey(photoId: string, kind: FeedbackKind) {
  return photoId + ':' + kind;
}

function operationIsGuarded(operation: OperationState | undefined) {
  return Boolean(
    operation &&
    (operation.phase === 'pending' ||
      operation.phase === 'uncertain' ||
      operation.phase === 'syncing' ||
      operation.phase === 'refreshing'),
  );
}

function emptySnapshot(
  key: string,
  generation: number,
  status: SnapshotStatus,
): FeedbackSnapshot {
  return {
    key,
    generation,
    status,
    enabled: false,
    canRate: false,
    canFavorite: false,
    ratingStatus: 'ready',
    favoriteStatus: 'ready',
    ratings: new Map(),
    favorites: new Map(),
  };
}

function pagePhotoIdsFromKey(key: string) {
  const identity = JSON.parse(key) as [string, Array<[string, string]>];
  return Array.from(new Set(identity[1].map(([photoId]) => photoId)));
}

function feedbackReadPath(
  albumId: string,
  kind: FeedbackKind,
  photoIds: string[],
) {
  const query = new URLSearchParams();
  for (const photoId of photoIds) query.append('photoId', photoId);
  const collection = kind === 'rating' ? 'ratings' : 'favorites';
  return (
    '/api/guest/albums/' +
    encodeURIComponent(albumId) +
    '/' +
    collection +
    '?' +
    query.toString()
  );
}

function indexRequestedStates<T extends { photoId: string }>(
  photoIds: string[],
  items: T[],
) {
  const expected = new Set(photoIds);
  const indexed = new Map<string, T>();
  if (items.length !== expected.size) {
    throw new Error('Incomplete Guest feedback state');
  }
  for (const item of items) {
    if (!expected.has(item.photoId) || indexed.has(item.photoId)) {
      throw new Error('Invalid Guest feedback state');
    }
    indexed.set(item.photoId, item);
  }
  if (indexed.size !== expected.size) {
    throw new Error('Incomplete Guest feedback state');
  }
  return indexed;
}

async function readRatingStates(albumId: string, photoIds: string[]) {
  const page = await requestJson(
    feedbackReadPath(albumId, 'rating', photoIds),
    guestRatingPageSchema,
  );
  return indexRequestedStates(photoIds, page.items);
}

async function readFavoriteStates(albumId: string, photoIds: string[]) {
  const page = await requestJson(
    feedbackReadPath(albumId, 'favorite', photoIds),
    guestFavoritePageSchema,
  );
  return indexRequestedStates(photoIds, page.items);
}

async function readOneRating(albumId: string, photoId: string) {
  const states = await readRatingStates(albumId, [photoId]);
  const state = states.get(photoId);
  if (!state) throw new Error('Guest rating state unavailable');
  return state;
}

async function readOneFavorite(albumId: string, photoId: string) {
  const states = await readFavoriteStates(albumId, [photoId]);
  const state = states.get(photoId);
  if (!state) throw new Error('Guest favorite state unavailable');
  return state;
}

type RightRead<T> = {
  status: 'ready' | 'error';
  value: ReadonlyMap<string, T>;
};

type LoadedFeedback = {
  status: 'ready';
  enabled: boolean;
  canRate: boolean;
  canFavorite: boolean;
  ratingStatus: 'ready' | 'error';
  favoriteStatus: 'ready' | 'error';
  ratings: ReadonlyMap<string, GuestRatingState>;
  favorites: ReadonlyMap<string, GuestFavoriteState>;
};

async function loadFeedback(albumId: string, photoIds: string[]) {
  const capabilities = await requestJson(
    '/api/guest/feedback/capabilities',
    guestFeedbackCapabilitiesSchema,
  );
  if (!capabilities.enabled) {
    return {
      status: 'ready',
      enabled: false,
      canRate: false,
      canFavorite: false,
      ratingStatus: 'ready',
      favoriteStatus: 'ready',
      ratings: new Map<string, GuestRatingState>(),
      favorites: new Map<string, GuestFavoriteState>(),
    } satisfies LoadedFeedback;
  }

  const { access } = await requestJson(
    '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
    z.object({ access: guestAlbumAccessSchema }).strict(),
  );
  if (access.albumId !== albumId) {
    throw new Error('Guest album access scope mismatch');
  }

  const canRate = access.permissions.can_view && access.permissions.can_rate;
  const canFavorite =
    access.permissions.can_view && access.permissions.can_favorite;

  const ratingRead: Promise<RightRead<GuestRatingState>> =
    canRate && photoIds.length > 0
      ? readRatingStates(albumId, photoIds)
          .then((value) => ({ status: 'ready' as const, value }))
          .catch(() => ({
            status: 'error' as const,
            value: new Map<string, GuestRatingState>(),
          }))
      : Promise.resolve({
          status: 'ready' as const,
          value: new Map<string, GuestRatingState>(),
        });

  const favoriteRead: Promise<RightRead<GuestFavoriteState>> =
    canFavorite && photoIds.length > 0
      ? readFavoriteStates(albumId, photoIds)
          .then((value) => ({ status: 'ready' as const, value }))
          .catch(() => ({
            status: 'error' as const,
            value: new Map<string, GuestFavoriteState>(),
          }))
      : Promise.resolve({
          status: 'ready' as const,
          value: new Map<string, GuestFavoriteState>(),
        });

  const [ratings, favorites] = await Promise.all([ratingRead, favoriteRead]);
  return {
    status: 'ready',
    enabled: true,
    canRate,
    canFavorite,
    ratingStatus: ratings.status,
    favoriteStatus: favorites.status,
    ratings: ratings.value,
    favorites: favorites.value,
  } satisfies LoadedFeedback;
}

type HydrationRequest = {
  promise: Promise<LoadedFeedback>;
  reconciliationSequence: number;
};

type ReconciledFeedbackState =
  | {
      kind: 'rating';
      albumId: string;
      photoId: string;
      versionId: string;
      sequence: number;
      value: GuestRatingState;
    }
  | {
      kind: 'favorite';
      albumId: string;
      photoId: string;
      versionId: string;
      sequence: number;
      value: GuestFavoriteState;
    };

type FeedbackContextValue = {
  snapshot: FeedbackSnapshot;
  operations: ReadonlyMap<string, OperationState>;
  setRating: (photo: GalleryPhoto, stars: number | null) => void;
  setFavorite: (photo: GalleryPhoto, favored: boolean) => void;
  retryMutation: (photo: GalleryPhoto, kind: FeedbackKind) => void;
  refreshState: (photo: GalleryPhoto, kind: FeedbackKind) => void;
};

const GuestFeedbackContext = createContext<FeedbackContextValue | null>(null);

export function GuestFeedbackProvider({
  albumId,
  photos,
  children,
}: {
  albumId: string;
  photos: GalleryPhoto[];
  children: ReactNode;
}) {
  const generationKey = JSON.stringify([
    albumId,
    photos.map((photo) => [photo.id, photo.versionId]),
  ]);
  const [snapshot, setSnapshot] = useState<FeedbackSnapshot>(() =>
    emptySnapshot(generationKey, 0, 'loading'),
  );
  const [operations, setOperations] = useState<
    ReadonlyMap<string, OperationState>
  >(() => new Map());
  const hydrationRequestsRef = useRef(new Map<string, HydrationRequest>());
  const reconciliationSequenceRef = useRef(0);
  const reconciledStatesRef = useRef(
    new Map<string, ReconciledFeedbackState>(),
  );
  const generationSequenceRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeKeyRef = useRef<string | null>(null);
  const operationsRef = useRef(new Map<string, OperationState>());
  const inFlightRef = useRef(new Set<string>());
  const guardedOperationsRef = useRef(new Set<string>());

  useEffect(() => {
    const generation = generationSequenceRef.current + 1;
    generationSequenceRef.current = generation;
    activeGenerationRef.current = generation;
    activeKeyRef.current = generationKey;

    let hydrationRequest = hydrationRequestsRef.current.get(generationKey);
    if (!hydrationRequest) {
      hydrationRequest = {
        promise: loadFeedback(albumId, pagePhotoIdsFromKey(generationKey)),
        reconciliationSequence: reconciliationSequenceRef.current,
      };
      hydrationRequestsRef.current.set(generationKey, hydrationRequest);
      const requestForCleanup = hydrationRequest;
      void requestForCleanup.promise.then(
        () => {
          if (
            hydrationRequestsRef.current.get(generationKey) ===
            requestForCleanup
          ) {
            hydrationRequestsRef.current.delete(generationKey);
          }
        },
        () => {
          if (
            hydrationRequestsRef.current.get(generationKey) ===
            requestForCleanup
          ) {
            hydrationRequestsRef.current.delete(generationKey);
          }
        },
      );
    }

    void hydrationRequest.promise.then(
      (loaded) => {
        if (
          activeGenerationRef.current !== generation ||
          activeKeyRef.current !== generationKey
        ) {
          return;
        }
        const identity = JSON.parse(generationKey) as [
          string,
          Array<[string, string]>,
        ];
        const ratings = new Map(loaded.ratings);
        const favorites = new Map(loaded.favorites);
        let ratingStatus = loaded.ratingStatus;
        let favoriteStatus = loaded.favoriteStatus;
        for (const [photoId, versionId] of identity[1]) {
          const latestRating = reconciledStatesRef.current.get(
            operationKey(photoId, 'rating'),
          );
          if (
            loaded.canRate &&
            latestRating?.kind === 'rating' &&
            latestRating.albumId === identity[0] &&
            latestRating.versionId === versionId &&
            latestRating.sequence > hydrationRequest.reconciliationSequence
          ) {
            ratings.set(photoId, latestRating.value);
            ratingStatus = 'ready';
          }

          const latestFavorite = reconciledStatesRef.current.get(
            operationKey(photoId, 'favorite'),
          );
          if (
            loaded.canFavorite &&
            latestFavorite?.kind === 'favorite' &&
            latestFavorite.albumId === identity[0] &&
            latestFavorite.versionId === versionId &&
            latestFavorite.sequence > hydrationRequest.reconciliationSequence
          ) {
            favorites.set(photoId, latestFavorite.value);
            favoriteStatus = 'ready';
          }
        }
        setSnapshot({
          ...loaded,
          key: generationKey,
          generation,
          ratingStatus,
          favoriteStatus,
          ratings,
          favorites,
        });
      },
      () => {
        if (
          activeGenerationRef.current !== generation ||
          activeKeyRef.current !== generationKey
        ) {
          return;
        }
        setSnapshot(emptySnapshot(generationKey, generation, 'error'));
      },
    );

    return () => {
      if (
        activeGenerationRef.current === generation &&
        activeKeyRef.current === generationKey
      ) {
        activeGenerationRef.current = 0;
        activeKeyRef.current = null;
      }
    };
  }, [albumId, generationKey]);

  useEffect(() => {
    const guardBeforeUnload = (event: BeforeUnloadEvent) => {
      if (guardedOperationsRef.current.size === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guardBeforeUnload);
    return () => window.removeEventListener('beforeunload', guardBeforeUnload);
  }, []);

  function updateOperation(key: string, operation: OperationState | null) {
    const next = new Map(operationsRef.current);
    if (operation) next.set(key, operation);
    else next.delete(key);
    operationsRef.current = next;
    setOperations(next);

    if (operationIsGuarded(operation ?? undefined)) {
      guardedOperationsRef.current.add(key);
    } else {
      guardedOperationsRef.current.delete(key);
    }
  }

  function applyRating(
    key: string,
    generation: number,
    photoId: string,
    value: GuestRatingState,
  ) {
    setSnapshot((current) => {
      if (
        current.status !== 'ready' ||
        current.key !== key ||
        current.generation !== generation
      ) {
        return current;
      }
      const ratings = new Map(current.ratings);
      ratings.set(photoId, value);
      return { ...current, ratingStatus: 'ready', ratings };
    });
  }

  function applyFavorite(
    key: string,
    generation: number,
    photoId: string,
    value: GuestFavoriteState,
  ) {
    setSnapshot((current) => {
      if (
        current.status !== 'ready' ||
        current.key !== key ||
        current.generation !== generation
      ) {
        return current;
      }
      const favorites = new Map(current.favorites);
      favorites.set(photoId, value);
      return { ...current, favoriteStatus: 'ready', favorites };
    });
  }

  function currentGenerationForPhoto(
    targetAlbumId: string,
    photoId: string,
    versionId: string,
  ) {
    const key = activeKeyRef.current;
    const generation = activeGenerationRef.current;
    if (!key || generation === 0) return null;
    const identity = JSON.parse(key) as [string, Array<[string, string]>];
    if (
      identity[0] !== targetAlbumId ||
      !identity[1].some(
        ([currentPhotoId, currentVersionId]) =>
          currentPhotoId === photoId && currentVersionId === versionId,
      )
    ) {
      return null;
    }
    return { key, generation };
  }

  function reconcileRatingRead(
    targetAlbumId: string,
    photoId: string,
    versionId: string,
    value: GuestRatingState,
  ) {
    const sequence = reconciliationSequenceRef.current + 1;
    reconciliationSequenceRef.current = sequence;
    reconciledStatesRef.current.set(operationKey(photoId, 'rating'), {
      kind: 'rating',
      albumId: targetAlbumId,
      photoId,
      versionId,
      sequence,
      value,
    });
    const target = currentGenerationForPhoto(targetAlbumId, photoId, versionId);
    if (!target) return false;
    applyRating(target.key, target.generation, photoId, value);
    return true;
  }

  function reconcileFavoriteRead(
    targetAlbumId: string,
    photoId: string,
    versionId: string,
    value: GuestFavoriteState,
  ) {
    const sequence = reconciliationSequenceRef.current + 1;
    reconciliationSequenceRef.current = sequence;
    reconciledStatesRef.current.set(operationKey(photoId, 'favorite'), {
      kind: 'favorite',
      albumId: targetAlbumId,
      photoId,
      versionId,
      sequence,
      value,
    });
    const target = currentGenerationForPhoto(targetAlbumId, photoId, versionId);
    if (!target) return false;
    applyFavorite(target.key, target.generation, photoId, value);
    return true;
  }

  async function refreshOne(photo: GalleryPhoto, kind: FeedbackKind) {
    const keyForOperation = operationKey(photo.id, kind);
    const existing = operationsRef.current.get(keyForOperation);
    if (
      inFlightRef.current.has(keyForOperation) ||
      (existing &&
        (existing.phase === 'pending' ||
          existing.phase === 'uncertain' ||
          existing.phase === 'syncing' ||
          existing.phase === 'refreshing'))
    ) {
      return;
    }

    inFlightRef.current.add(keyForOperation);
    updateOperation(keyForOperation, { phase: 'refreshing', kind });
    try {
      const reconciled =
        kind === 'rating'
          ? reconcileRatingRead(
              albumId,
              photo.id,
              photo.versionId,
              await readOneRating(albumId, photo.id),
            )
          : reconcileFavoriteRead(
              albumId,
              photo.id,
              photo.versionId,
              await readOneFavorite(albumId, photo.id),
            );
      updateOperation(
        keyForOperation,
        reconciled ? null : { phase: 'refresh-error', kind },
      );
    } catch {
      updateOperation(keyForOperation, { phase: 'refresh-error', kind });
    } finally {
      inFlightRef.current.delete(keyForOperation);
    }
  }

  async function executeMutation(command: FeedbackCommand) {
    const keyForOperation = operationKey(command.photoId, command.kind);
    if (inFlightRef.current.has(keyForOperation)) return;
    const existing = operationsRef.current.get(keyForOperation);
    const retryingUncertain = existing?.phase === 'uncertain';
    if (
      existing &&
      existing.phase !== 'uncertain' &&
      existing.phase !== 'denied' &&
      existing.phase !== 'sync-error' &&
      existing.phase !== 'refresh-error'
    ) {
      return;
    }

    inFlightRef.current.add(keyForOperation);
    updateOperation(keyForOperation, { phase: 'pending', command });

    try {
      if (command.kind === 'rating') {
        const result = await requestJson(command.url, guestRatingResultSchema, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: command.bodyJson,
        });
        if (result.photoId !== command.photoId) {
          throw new Error('Guest rating result scope mismatch');
        }
      } else {
        const result = await requestJson(
          command.url,
          guestFavoriteResultSchema,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: command.bodyJson,
          },
        );
        if (result.photoId !== command.photoId) {
          throw new Error('Guest favorite result scope mismatch');
        }
      }
    } catch (error) {
      if (
        !retryingUncertain &&
        error instanceof FeedbackApiFailure &&
        error.statusCode >= 400 &&
        error.statusCode < 500
      ) {
        updateOperation(keyForOperation, {
          phase: 'denied',
          kind: command.kind,
        });
      } else {
        updateOperation(keyForOperation, {
          phase: 'uncertain',
          command,
        });
      }
      inFlightRef.current.delete(keyForOperation);
      return;
    }

    updateOperation(keyForOperation, { phase: 'syncing', command });
    try {
      const reconciled =
        command.kind === 'rating'
          ? reconcileRatingRead(
              command.albumId,
              command.photoId,
              command.versionId,
              await readOneRating(command.albumId, command.photoId),
            )
          : reconcileFavoriteRead(
              command.albumId,
              command.photoId,
              command.versionId,
              await readOneFavorite(command.albumId, command.photoId),
            );
      updateOperation(
        keyForOperation,
        reconciled ? null : { phase: 'sync-error', kind: command.kind },
      );
    } catch {
      updateOperation(keyForOperation, {
        phase: 'sync-error',
        kind: command.kind,
      });
    } finally {
      inFlightRef.current.delete(keyForOperation);
    }
  }

  function setRating(photo: GalleryPhoto, stars: number | null) {
    if (
      snapshot.status !== 'ready' ||
      snapshot.key !== generationKey ||
      !snapshot.canRate
    ) {
      return;
    }
    const photoState = snapshot.ratings.get(photo.id);
    const keyForOperation = operationKey(photo.id, 'rating');
    const existing = operationsRef.current.get(keyForOperation);
    if (
      inFlightRef.current.has(keyForOperation) ||
      (existing && existing.phase !== 'denied')
    ) {
      return;
    }
    if (photoState?.stars === stars) return;

    const body = guestRatingRequestSchema.parse({
      requestId: globalThis.crypto.randomUUID(),
      versionId: photo.versionId,
      stars,
    });
    const command: RatingCommand = {
      kind: 'rating',
      albumId,
      photoId: photo.id,
      versionId: photo.versionId,
      url:
        '/api/guest/albums/' +
        encodeURIComponent(albumId) +
        '/photos/' +
        encodeURIComponent(photo.id) +
        '/rating',
      body,
      bodyJson: JSON.stringify(body),
    };
    void executeMutation(command);
  }

  function setFavorite(photo: GalleryPhoto, favored: boolean) {
    if (
      snapshot.status !== 'ready' ||
      snapshot.key !== generationKey ||
      !snapshot.canFavorite
    ) {
      return;
    }
    const photoState = snapshot.favorites.get(photo.id);
    const keyForOperation = operationKey(photo.id, 'favorite');
    const existing = operationsRef.current.get(keyForOperation);
    if (
      inFlightRef.current.has(keyForOperation) ||
      (existing && existing.phase !== 'denied')
    ) {
      return;
    }
    if (photoState?.favored === favored) return;

    const body = guestFavoriteRequestSchema.parse({
      requestId: globalThis.crypto.randomUUID(),
      versionId: photo.versionId,
      favored,
    });
    const command: FavoriteCommand = {
      kind: 'favorite',
      albumId,
      photoId: photo.id,
      versionId: photo.versionId,
      url:
        '/api/guest/albums/' +
        encodeURIComponent(albumId) +
        '/photos/' +
        encodeURIComponent(photo.id) +
        '/favorite',
      body,
      bodyJson: JSON.stringify(body),
    };
    void executeMutation(command);
  }

  function retryMutation(photo: GalleryPhoto, kind: FeedbackKind) {
    const existing = operationsRef.current.get(operationKey(photo.id, kind));
    if (!existing || existing.phase !== 'uncertain') return;
    void executeMutation(existing.command);
  }

  function refreshState(photo: GalleryPhoto, kind: FeedbackKind) {
    if (
      snapshot.status !== 'ready' ||
      snapshot.key !== generationKey ||
      (kind === 'rating' && !snapshot.canRate) ||
      (kind === 'favorite' && !snapshot.canFavorite)
    ) {
      return;
    }
    void refreshOne(photo, kind);
  }

  const activeSnapshot =
    snapshot.key === generationKey
      ? snapshot
      : emptySnapshot(generationKey, 0, 'loading');
  const contextValue: FeedbackContextValue = {
    snapshot: activeSnapshot,
    operations,
    setRating,
    setFavorite,
    retryMutation,
    refreshState,
  };

  return (
    <GuestFeedbackContext.Provider value={contextValue}>
      {children}
    </GuestFeedbackContext.Provider>
  );
}

function operationMessage(operation: OperationState | undefined) {
  if (!operation) return null;
  if (operation.phase === 'pending') return '正在儲存…';
  if (operation.phase === 'uncertain') {
    return '儲存結果尚未確認，請重試相同操作。';
  }
  if (operation.phase === 'syncing') return '正在確認最新狀態…';
  if (operation.phase === 'refreshing') return '正在重新載入狀態…';
  if (operation.phase === 'sync-error') {
    return '無法同步目前狀態，請重新載入。';
  }
  if (operation.phase === 'refresh-error') {
    return '目前狀態無法載入，請再試一次。';
  }
  return '無法儲存這項回饋，請稍後再試。';
}

function operationBlocksControls(operation: OperationState | undefined) {
  return Boolean(operation && operation.phase !== 'denied');
}

function canRetryRead(operation: OperationState | undefined) {
  return Boolean(
    operation &&
    (operation.phase === 'sync-error' || operation.phase === 'refresh-error'),
  );
}

function RatingControls({
  photo,
  compact,
  value,
  readFailed,
  operation,
  context,
  groupId,
}: {
  photo: GalleryPhoto;
  compact: boolean;
  value: GuestRatingState | undefined;
  readFailed: boolean;
  operation: OperationState | undefined;
  context: FeedbackContextValue;
  groupId: string;
}) {
  if (!value || readFailed) {
    const refreshing = operation?.phase === 'refreshing';
    return (
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span role="status" className="text-stone-600">
          {operationMessage(operation) ?? '評分暫時無法載入。'}
        </span>
        {operation?.phase !== 'uncertain' &&
          operation?.phase !== 'pending' &&
          operation?.phase !== 'syncing' && (
            <button
              type="button"
              disabled={refreshing}
              onClick={() => context.refreshState(photo, 'rating')}
              className="rounded border border-stone-300 px-1.5 py-1 text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            >
              重新載入評分
            </button>
          )}
        {operation?.phase === 'uncertain' && (
          <button
            type="button"
            onClick={() => context.retryMutation(photo, 'rating')}
            className="rounded border border-amber-500 px-1.5 py-1 text-amber-900 hover:bg-amber-50"
          >
            重試相同評分操作
          </button>
        )}
      </div>
    );
  }

  const locked = operationBlocksControls(operation);
  const sizeClass = compact ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <fieldset
        disabled={locked}
        className="min-w-0 border-0 p-0"
        aria-label="照片評分"
      >
        <legend className="sr-only">照片評分</legend>
        <div role="radiogroup" aria-label="評分" className="flex items-center">
          {[1, 2, 3, 4, 5].map((stars) => (
            <label
              key={stars}
              className={
                'relative inline-flex cursor-pointer items-center justify-center rounded focus-within:outline-none ' +
                sizeClass
              }
            >
              <input
                type="radio"
                name={groupId}
                value={stars}
                aria-label={stars + ' 星'}
                checked={value.stars === stars}
                onChange={() => context.setRating(photo, stars)}
                className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              <span
                aria-hidden="true"
                className={
                  'pointer-events-none grid h-full w-full place-items-center rounded text-lg leading-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-amber-700 ' +
                  (value.stars !== null && value.stars >= stars
                    ? 'text-amber-500'
                    : 'text-stone-300')
                }
              >
                ★
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        disabled={locked || value.stars === null}
        onClick={() => context.setRating(photo, null)}
        aria-label="清除評分"
        className="rounded border border-stone-300 px-1.5 py-1 text-xs text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        清除
      </button>
      {operation?.phase === 'uncertain' && (
        <button
          type="button"
          onClick={() => context.retryMutation(photo, 'rating')}
          className="rounded border border-amber-500 px-1.5 py-1 text-xs text-amber-900 hover:bg-amber-50"
        >
          重試相同評分操作
        </button>
      )}
      {canRetryRead(operation) && (
        <button
          type="button"
          onClick={() => context.refreshState(photo, 'rating')}
          className="rounded border border-stone-300 px-1.5 py-1 text-xs text-stone-700 hover:bg-stone-100"
        >
          重新載入評分
        </button>
      )}
      {operation && (
        <span role="status" className="basis-full text-xs text-stone-600">
          {operationMessage(operation)}
        </span>
      )}
    </div>
  );
}

function FavoriteControls({
  photo,
  compact,
  value,
  readFailed,
  operation,
  context,
}: {
  photo: GalleryPhoto;
  compact: boolean;
  value: GuestFavoriteState | undefined;
  readFailed: boolean;
  operation: OperationState | undefined;
  context: FeedbackContextValue;
}) {
  if (!value || readFailed) {
    const refreshing = operation?.phase === 'refreshing';
    return (
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span role="status" className="text-stone-600">
          {operationMessage(operation) ?? '收藏狀態暫時無法載入。'}
        </span>
        {operation?.phase !== 'uncertain' &&
          operation?.phase !== 'pending' &&
          operation?.phase !== 'syncing' && (
            <button
              type="button"
              disabled={refreshing}
              onClick={() => context.refreshState(photo, 'favorite')}
              className="rounded border border-stone-300 px-1.5 py-1 text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            >
              重新載入收藏
            </button>
          )}
        {operation?.phase === 'uncertain' && (
          <button
            type="button"
            onClick={() => context.retryMutation(photo, 'favorite')}
            className="rounded border border-amber-500 px-1.5 py-1 text-amber-900 hover:bg-amber-50"
          >
            重試相同收藏操作
          </button>
        )}
      </div>
    );
  }

  const locked = operationBlocksControls(operation);
  const label = value.favored ? '移除收藏' : '加入收藏';
  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-pressed={value.favored}
        aria-label={label}
        disabled={locked}
        onClick={() => context.setFavorite(photo, !value.favored)}
        className={
          'inline-flex items-center justify-center gap-1 rounded border px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-50 ' +
          (value.favored
            ? 'border-rose-300 bg-rose-50 text-rose-800'
            : 'border-stone-300 text-stone-700 hover:bg-stone-100') +
          (compact ? ' min-h-7' : ' min-h-8')
        }
      >
        <span aria-hidden="true">{value.favored ? '♥' : '♡'}</span>
        <span>{label}</span>
      </button>
      {operation?.phase === 'uncertain' && (
        <button
          type="button"
          onClick={() => context.retryMutation(photo, 'favorite')}
          className="rounded border border-amber-500 px-1.5 py-1 text-xs text-amber-900 hover:bg-amber-50"
        >
          重試相同收藏操作
        </button>
      )}
      {canRetryRead(operation) && (
        <button
          type="button"
          onClick={() => context.refreshState(photo, 'favorite')}
          className="rounded border border-stone-300 px-1.5 py-1 text-xs text-stone-700 hover:bg-stone-100"
        >
          重新載入收藏
        </button>
      )}
      {operation && (
        <span role="status" className="basis-full text-xs text-stone-600">
          {operationMessage(operation)}
        </span>
      )}
    </div>
  );
}

export function GuestFeedbackControls({
  photo,
  compact = false,
}: {
  photo: GalleryPhoto;
  compact?: boolean;
}) {
  const context = useContext(GuestFeedbackContext);
  const radioName = useId();
  if (!context) return null;

  const snapshot = context.snapshot;
  if (snapshot.status === 'loading') return null;
  if (snapshot.status === 'error') {
    return (
      <p role="status" className="text-xs text-stone-600">
        訪客回饋暫時無法載入。
      </p>
    );
  }
  if (!snapshot.enabled || (!snapshot.canRate && !snapshot.canFavorite)) {
    return null;
  }

  const ratingOperation = context.operations.get(
    operationKey(photo.id, 'rating'),
  );
  const favoriteOperation = context.operations.get(
    operationKey(photo.id, 'favorite'),
  );

  return (
    <div
      role="group"
      aria-label="訪客回饋"
      aria-busy={
        ratingOperation?.phase === 'pending' ||
        ratingOperation?.phase === 'syncing' ||
        ratingOperation?.phase === 'refreshing' ||
        favoriteOperation?.phase === 'pending' ||
        favoriteOperation?.phase === 'syncing' ||
        favoriteOperation?.phase === 'refreshing'
      }
      className={
        'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ' +
        (compact ? 'text-xs' : 'text-sm')
      }
    >
      {snapshot.canRate && (
        <RatingControls
          photo={photo}
          compact={compact}
          value={snapshot.ratings.get(photo.id)}
          readFailed={snapshot.ratingStatus === 'error'}
          operation={ratingOperation}
          context={context}
          groupId={radioName}
        />
      )}
      {snapshot.canFavorite && (
        <FavoriteControls
          photo={photo}
          compact={compact}
          value={snapshot.favorites.get(photo.id)}
          readFailed={snapshot.favoriteStatus === 'error'}
          operation={favoriteOperation}
          context={context}
        />
      )}
    </div>
  );
}
