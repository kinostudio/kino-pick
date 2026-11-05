'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';
import type { GalleryPhoto } from '../../../packages/contracts/src/gallery';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import {
  guestTagCapabilitiesSchema,
  guestTagItemSchema,
  guestTagLabelSchema,
  guestTagPageSchema,
  guestTagPhotoIdsSchema,
  guestTagRequestSchema,
  guestTagResultSchema,
  guestTagStateSchema,
} from '../../../packages/contracts/src/guest-tags';

type GuestTag = z.infer<typeof guestTagItemSchema>;
type GuestTagPhotoState = z.infer<typeof guestTagStateSchema>;
type TagRequest = z.infer<typeof guestTagRequestSchema>;
type TagResult = z.infer<typeof guestTagResultSchema>;

type SnapshotStatus = 'loading' | 'error' | 'ready';

type TagsSnapshot = {
  key: string;
  generation: number;
  status: SnapshotStatus;
  enabled: boolean;
  canTag: boolean;
  guestId: string | null;
  failedPhotoIds: ReadonlySet<string>;
  tags: ReadonlyMap<string, readonly GuestTag[]>;
};

type TagCommand = {
  albumId: string;
  photoId: string;
  url: string;
  body: TagRequest;
  bodyJson: string;
  mayHaveCommitted: boolean;
};

type OperationState =
  | {
      phase:
        | 'pending'
        | 'uncertain'
        | 'syncing'
        | 'sync-error'
        | 'identity-mismatch';
      command: TagCommand;
      lastStatusCode: number | null;
    }
  | {
      phase: 'refreshing' | 'refresh-error';
    }
  | {
      phase: 'rejected';
      message: string;
    };

type ReconciledTagState = {
  albumId: string;
  photoId: string;
  guestId: string;
  sequence: number;
  tags: readonly GuestTag[];
};

type LoadedTags = {
  status: 'ready';
  enabled: boolean;
  canTag: boolean;
  guestId: string | null;
  failedPhotoIds: ReadonlySet<string>;
  tags: ReadonlyMap<string, readonly GuestTag[]>;
};

type TagReadPage = {
  guestId: string | null;
  failedPhotoIds: ReadonlySet<string>;
  tags: ReadonlyMap<string, readonly GuestTag[]>;
};

type HydrationRequest = {
  promise: Promise<LoadedTags>;
  reconciliationSequence: number;
};

type TagsContextValue = {
  albumId: string;
  photoIds: readonly string[];
  snapshot: TagsSnapshot;
  operations: ReadonlyMap<string, OperationState>;
  changeTag: (
    photoId: string,
    versionId: string,
    label: string,
    present: boolean,
  ) => boolean;
  retryMutation: (photoId: string) => void;
  refreshState: (photoId: string) => void;
};

const GuestTagsContext = createContext<TagsContextValue | null>(null);

class TagsApiFailure extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string | null,
  ) {
    super('Guest tags request failed');
  }
}

class GuestIdentityMismatch extends Error {
  constructor() {
    super('Guest identity changed while reconciling a tag operation');
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
    const error = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(body);
    throw new TagsApiFailure(
      response.status,
      error.success ? error.data.error.code : null,
    );
  }
  return schema.parse(body);
}

function operationKey(albumId: string, photoId: string) {
  return JSON.stringify([albumId, photoId]);
}

function operationIsGuarded(operation: OperationState | undefined) {
  return Boolean(
    operation &&
    (operation.phase === 'pending' ||
      operation.phase === 'uncertain' ||
      operation.phase === 'syncing' ||
      operation.phase === 'sync-error' ||
      operation.phase === 'identity-mismatch'),
  );
}

function emptySnapshot(
  key: string,
  generation: number,
  status: SnapshotStatus,
): TagsSnapshot {
  return {
    key,
    generation,
    status,
    enabled: false,
    canTag: false,
    guestId: null,
    failedPhotoIds: new Set(),
    tags: new Map(),
  };
}

function pageIdentityFromKey(key: string) {
  return JSON.parse(key) as [string, boolean, string[]];
}

function photoIdsFromKey(key: string) {
  return pageIdentityFromKey(key)[2];
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function tagsReadPath(albumId: string, photoIds: string[]) {
  const checkedPhotoIds = guestTagPhotoIdsSchema.parse(photoIds);
  const query = new URLSearchParams();
  for (const photoId of checkedPhotoIds) query.append('photoId', photoId);
  return (
    '/api/guest/albums/' +
    encodeURIComponent(albumId) +
    '/tags?' +
    query.toString()
  );
}

function indexPhotoTags(photoIds: string[], items: GuestTagPhotoState[]) {
  const expected = new Set(photoIds);
  const indexed = new Map<string, readonly GuestTag[]>();
  if (items.length !== expected.size) {
    throw new Error('Incomplete Guest tag state');
  }
  for (const item of items) {
    if (!expected.has(item.photoId) || indexed.has(item.photoId)) {
      throw new Error('Invalid Guest tag state');
    }
    indexed.set(item.photoId, item.tags);
  }
  if (indexed.size !== expected.size) {
    throw new Error('Incomplete Guest tag state');
  }
  return indexed;
}

async function readTagPage(albumId: string, photoIds: string[]) {
  const page = await requestJson(
    tagsReadPath(albumId, photoIds),
    guestTagPageSchema,
  );
  return {
    guestId: page.guestId,
    tags: indexPhotoTags(photoIds, page.items),
  };
}

async function loadPhotoTags(
  albumId: string,
  photoIds: string[],
): Promise<TagReadPage> {
  if (photoIds.length === 0) {
    return {
      guestId: null,
      failedPhotoIds: new Set(),
      tags: new Map(),
    };
  }

  const reads = await Promise.all(
    chunks(photoIds, 24).map(async (photoIdChunk) => {
      try {
        return {
          photoIds: photoIdChunk,
          value: await readTagPage(albumId, photoIdChunk),
        };
      } catch {
        return { photoIds: photoIdChunk, value: null };
      }
    }),
  );

  const guestIds = new Set(
    reads.flatMap((read) => (read.value ? [read.value.guestId] : [])),
  );
  if (guestIds.size > 1) {
    return {
      guestId: null,
      failedPhotoIds: new Set(photoIds),
      tags: new Map(),
    };
  }

  const guestId = guestIds.values().next().value ?? null;
  const failedPhotoIds = new Set<string>();
  const tags = new Map<string, readonly GuestTag[]>();
  for (const read of reads) {
    if (!read.value) {
      for (const photoId of read.photoIds) failedPhotoIds.add(photoId);
      continue;
    }
    for (const [photoId, photoTags] of read.value.tags) {
      tags.set(photoId, photoTags);
    }
  }
  return { guestId, failedPhotoIds, tags };
}

async function loadTags(
  albumId: string,
  canTag: boolean,
  photoIds: string[],
): Promise<LoadedTags> {
  const capabilities = await requestJson(
    '/api/guest/tags/capabilities',
    guestTagCapabilitiesSchema,
  );
  if (!capabilities.enabled || !canTag) {
    return {
      status: 'ready',
      enabled: capabilities.enabled,
      canTag: false,
      guestId: null,
      failedPhotoIds: new Set(),
      tags: new Map(),
    };
  }

  const { access } = await requestJson(
    '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
    z.object({ access: guestAlbumAccessSchema }).strict(),
  );
  if (access.albumId !== albumId) {
    throw new Error('Guest album access scope mismatch');
  }
  const hasTagAccess =
    access.permissions.can_view && access.permissions.can_tag;
  if (!hasTagAccess) {
    return {
      status: 'ready',
      enabled: true,
      canTag: false,
      guestId: null,
      failedPhotoIds: new Set(),
      tags: new Map(),
    };
  }

  const page = await loadPhotoTags(albumId, photoIds);
  if (page.guestId && page.guestId !== access.guestId) {
    return {
      status: 'ready',
      enabled: true,
      canTag: true,
      guestId: null,
      failedPhotoIds: new Set(photoIds),
      tags: new Map(),
    };
  }
  return {
    status: 'ready',
    enabled: true,
    canTag: true,
    guestId: page.guestId,
    failedPhotoIds: page.failedPhotoIds,
    tags: page.tags,
  };
}

async function readOnePhotoTags(albumId: string, photoId: string) {
  const page = await readTagPage(albumId, [photoId]);
  const tags = page.tags.get(photoId);
  if (!tags) throw new Error('Guest tag state unavailable');
  return { guestId: page.guestId, tags };
}

function normalizeLabel(label: string) {
  const normalized = label.normalize('NFC').trim();
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > 40 ||
    /[\p{Cc}\p{Cf}]/u.test(normalized)
  ) {
    return null;
  }
  try {
    return guestTagLabelSchema.parse(normalized);
  } catch {
    return null;
  }
}

function tagsMutationPath(albumId: string, photoId: string) {
  return (
    '/api/guest/albums/' +
    encodeURIComponent(albumId) +
    '/photos/' +
    encodeURIComponent(photoId) +
    '/tags'
  );
}

export function GuestTagsProvider({
  albumId,
  photoIds,
  canTag = true,
  children,
}: {
  albumId: string;
  photoIds: string[];
  canTag?: boolean;
  children: ReactNode;
}) {
  const normalizedPhotoIds = Array.from(new Set(photoIds));
  const generationKey = JSON.stringify([albumId, canTag, normalizedPhotoIds]);
  const [snapshot, setSnapshot] = useState<TagsSnapshot>(() =>
    emptySnapshot(generationKey, 0, 'loading'),
  );
  const [operations, setOperations] = useState<
    ReadonlyMap<string, OperationState>
  >(() => new Map());
  const hydrationRequestsRef = useRef(new Map<string, HydrationRequest>());
  const reconciledStatesRef = useRef(new Map<string, ReconciledTagState>());
  const reconciliationSequenceRef = useRef(0);
  const generationSequenceRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeKeyRef = useRef<string | null>(null);
  const operationsRef = useRef(new Map<string, OperationState>());
  const inFlightRef = useRef(new Set<string>());
  const refreshInFlightRef = useRef(new Set<string>());
  const guardedOperationsRef = useRef(new Set<string>());

  useEffect(() => {
    const generation = generationSequenceRef.current + 1;
    generationSequenceRef.current = generation;
    activeGenerationRef.current = generation;
    activeKeyRef.current = generationKey;

    let hydrationRequest = hydrationRequestsRef.current.get(generationKey);
    if (!hydrationRequest) {
      hydrationRequest = {
        promise: loadTags(albumId, canTag, photoIdsFromKey(generationKey)),
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
        const identity = pageIdentityFromKey(generationKey);
        const tags = new Map(loaded.tags);
        const failedPhotoIds = new Set(loaded.failedPhotoIds);
        if (loaded.guestId) {
          for (const photoId of identity[2]) {
            const latest = reconciledStatesRef.current.get(
              operationKey(identity[0], photoId),
            );
            if (
              latest &&
              latest.albumId === identity[0] &&
              latest.guestId === loaded.guestId &&
              latest.sequence > hydrationRequest.reconciliationSequence
            ) {
              tags.set(photoId, latest.tags);
              failedPhotoIds.delete(photoId);
            }
          }
        }
        setSnapshot({
          ...loaded,
          key: generationKey,
          generation,
          tags,
          failedPhotoIds,
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
  }, [albumId, canTag, generationKey]);

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

  function activeGenerationForPhoto(photoId: string) {
    const key = activeKeyRef.current;
    const generation = activeGenerationRef.current;
    if (!key || generation === 0) return null;
    const identity = pageIdentityFromKey(key);
    if (identity[0] !== albumId || !identity[2].includes(photoId)) return null;
    return { key, generation };
  }

  function applyPhotoTags(
    key: string,
    generation: number,
    photoId: string,
    guestId: string,
    photoTags: readonly GuestTag[],
  ) {
    let applied = false;
    setSnapshot((current) => {
      if (
        current.status !== 'ready' ||
        current.key !== key ||
        current.generation !== generation ||
        current.guestId !== guestId
      ) {
        return current;
      }
      const tags = new Map(current.tags);
      tags.set(photoId, photoTags);
      const failedPhotoIds = new Set(current.failedPhotoIds);
      failedPhotoIds.delete(photoId);
      applied = true;
      return { ...current, tags, failedPhotoIds };
    });
    return applied;
  }

  function reconcilePhotoTags(
    targetAlbumId: string,
    photoId: string,
    guestId: string,
    photoTags: readonly GuestTag[],
  ) {
    const sequence = reconciliationSequenceRef.current + 1;
    reconciliationSequenceRef.current = sequence;
    reconciledStatesRef.current.set(operationKey(targetAlbumId, photoId), {
      albumId: targetAlbumId,
      photoId,
      guestId,
      sequence,
      tags: photoTags,
    });
    const target = activeGenerationForPhoto(photoId);
    if (!target) return false;
    return applyPhotoTags(
      target.key,
      target.generation,
      photoId,
      guestId,
      photoTags,
    );
  }

  async function refreshState(photoId: string) {
    const key = operationKey(albumId, photoId);
    const existing = operationsRef.current.get(key);
    if (
      !photoIds.includes(photoId) ||
      inFlightRef.current.has(key) ||
      (existing && 'command' in existing) ||
      snapshot.status !== 'ready' ||
      snapshot.key !== generationKey ||
      !snapshot.enabled ||
      !snapshot.canTag ||
      refreshInFlightRef.current.has(generationKey)
    ) {
      return;
    }

    refreshInFlightRef.current.add(generationKey);
    updateOperation(key, { phase: 'refreshing' });
    const generation = activeGenerationRef.current;
    try {
      const page = await loadPhotoTags(albumId, normalizedPhotoIds);
      if (
        activeGenerationRef.current !== generation ||
        activeKeyRef.current !== generationKey
      ) {
        updateOperation(key, null);
        return;
      }
      const sequence = reconciliationSequenceRef.current + 1;
      reconciliationSequenceRef.current = sequence;
      if (page.guestId) {
        for (const [targetPhotoId, photoTags] of page.tags) {
          const nextSequence = reconciliationSequenceRef.current + 1;
          reconciliationSequenceRef.current = nextSequence;
          reconciledStatesRef.current.set(
            operationKey(albumId, targetPhotoId),
            {
              albumId,
              photoId: targetPhotoId,
              guestId: page.guestId,
              sequence: nextSequence,
              tags: photoTags,
            },
          );
        }
      }
      setSnapshot((current) => {
        if (
          current.key !== generationKey ||
          current.generation !== generation ||
          current.status !== 'ready'
        ) {
          return current;
        }
        return {
          ...current,
          guestId: page.guestId,
          tags: new Map(page.tags),
          failedPhotoIds: new Set(page.failedPhotoIds),
        };
      });
      updateOperation(key, null);
    } catch {
      updateOperation(key, { phase: 'refresh-error' });
    } finally {
      refreshInFlightRef.current.delete(generationKey);
    }
  }

  async function executeMutation(command: TagCommand) {
    const key = operationKey(command.albumId, command.photoId);
    try {
      const result: TagResult = await requestJson(
        command.url,
        guestTagResultSchema,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: command.bodyJson,
        },
      );
      if (
        result.guestId !== command.body.expectedGuestId ||
        result.photoId !== command.photoId ||
        result.versionId !== command.body.versionId ||
        result.label !== command.body.label ||
        result.present !== command.body.present
      ) {
        throw new Error('Guest tag result scope mismatch');
      }
    } catch (error) {
      if (
        !command.mayHaveCommitted &&
        error instanceof TagsApiFailure &&
        error.statusCode === 409 &&
        ['TAG_LIMIT_REACHED', 'TAG_CATALOG_LIMIT_REACHED'].includes(
          error.code ?? '',
        )
      ) {
        updateOperation(key, {
          phase: 'rejected',
          message:
            error.code === 'TAG_LIMIT_REACHED'
              ? '此照片已達標籤上限；請重新載入目前標籤後再操作。'
              : '此專案已達標籤種類上限；可重新載入並使用已存在的標籤。',
        });
        inFlightRef.current.delete(key);
        return;
      }
      command.mayHaveCommitted = true;
      updateOperation(key, {
        phase: 'uncertain',
        command,
        lastStatusCode:
          error instanceof TagsApiFailure ? error.statusCode : null,
      });
      inFlightRef.current.delete(key);
      return;
    }

    command.mayHaveCommitted = true;
    updateOperation(key, {
      phase: 'syncing',
      command,
      lastStatusCode: null,
    });
    try {
      const state = await readOnePhotoTags(command.albumId, command.photoId);
      if (state.guestId !== command.body.expectedGuestId) {
        throw new GuestIdentityMismatch();
      }
      reconcilePhotoTags(
        command.albumId,
        command.photoId,
        state.guestId,
        state.tags,
      );
      updateOperation(key, null);
    } catch (error) {
      updateOperation(key, {
        phase:
          error instanceof GuestIdentityMismatch
            ? 'identity-mismatch'
            : 'sync-error',
        command,
        lastStatusCode: null,
      });
    } finally {
      inFlightRef.current.delete(key);
    }
  }

  function changeTag(
    photoId: string,
    versionId: string,
    labelInput: string,
    present: boolean,
  ) {
    if (
      snapshot.status !== 'ready' ||
      snapshot.key !== generationKey ||
      !snapshot.enabled ||
      !snapshot.canTag ||
      snapshot.failedPhotoIds.has(photoId) ||
      !normalizedPhotoIds.includes(photoId)
    ) {
      return false;
    }
    const label = normalizeLabel(labelInput);
    const currentTags = snapshot.tags.get(photoId);
    if (!label || !currentTags) return false;

    const key = operationKey(albumId, photoId);
    const existing = operationsRef.current.get(key);
    if (inFlightRef.current.has(key) || existing) return false;

    const labelExists = currentTags.some((tag) => tag.label === label);
    if (labelExists === present) return false;
    if (present && currentTags.length >= 20) return false;

    const body = guestTagRequestSchema.parse({
      requestId: globalThis.crypto.randomUUID(),
      expectedGuestId: snapshot.guestId,
      versionId,
      label,
      present,
    });
    const command: TagCommand = {
      albumId,
      photoId,
      url: tagsMutationPath(albumId, photoId),
      body,
      bodyJson: JSON.stringify(body),
      mayHaveCommitted: false,
    };

    // Lock synchronously before the request can yield so Grid and Lightbox cannot double-submit.
    inFlightRef.current.add(key);
    updateOperation(key, {
      phase: 'pending',
      command,
      lastStatusCode: null,
    });
    void executeMutation(command);
    return true;
  }

  function retryMutation(photoId: string) {
    const key = operationKey(albumId, photoId);
    const existing = operationsRef.current.get(key);
    if (
      !existing ||
      !('command' in existing) ||
      !['uncertain', 'sync-error', 'identity-mismatch'].includes(
        existing.phase,
      ) ||
      inFlightRef.current.has(key)
    ) {
      return;
    }
    const command = existing.command;
    inFlightRef.current.add(key);
    updateOperation(key, {
      phase: 'pending',
      command,
      lastStatusCode: existing.lastStatusCode,
    });
    void executeMutation(command);
  }

  const activeSnapshot =
    snapshot.key === generationKey
      ? snapshot
      : emptySnapshot(generationKey, 0, 'loading');
  const contextValue: TagsContextValue = {
    albumId,
    photoIds: normalizedPhotoIds,
    snapshot: activeSnapshot,
    operations,
    changeTag,
    retryMutation,
    refreshState: (photoId) => void refreshState(photoId),
  };

  return (
    <GuestTagsContext.Provider value={contextValue}>
      {children}
    </GuestTagsContext.Provider>
  );
}

function operationMessage(
  operation: OperationState | undefined,
  guestMatches: boolean,
) {
  if (!operation) return null;
  if (operation.phase === 'pending') return '正在儲存標籤…';
  if (operation.phase === 'uncertain') {
    if (
      !guestMatches ||
      operation.lastStatusCode === 401 ||
      operation.lastStatusCode === 403
    ) {
      return '此操作仍綁定原訪客身分。請確認目前使用同一訪客，再重試相同操作。';
    }
    return '標籤操作結果尚未確認。請重試完全相同的操作。';
  }
  if (operation.phase === 'rejected') return operation.message;
  if (operation.phase === 'syncing') return '正在載入目前標籤…';
  if (operation.phase === 'identity-mismatch') {
    return '訪客身分已變更；此操作仍綁定原訪客。請切回原訪客後重試相同操作。';
  }
  if (operation.phase === 'sync-error') {
    return '操作已回應，但目前狀態尚未同步。請重試相同操作以讀取最新狀態。';
  }
  if (operation.phase === 'refreshing') return '正在重新載入標籤…';
  return '標籤狀態載入失敗，請重新載入。';
}

function TagStatus({
  operation,
  guestMatches,
  onRetryMutation,
  onRefresh,
}: {
  operation: OperationState | undefined;
  guestMatches: boolean;
  onRetryMutation: () => void;
  onRefresh: () => void;
}) {
  if (!operation) return null;
  const retryMutation =
    'command' in operation &&
    (operation.phase === 'uncertain' ||
      operation.phase === 'sync-error' ||
      operation.phase === 'identity-mismatch');
  const retryRead =
    operation.phase === 'refresh-error' || operation.phase === 'rejected';

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
      <span role="status" aria-live="polite">
        {operationMessage(operation, guestMatches)}
      </span>
      {retryMutation && (
        <button
          type="button"
          onClick={onRetryMutation}
          className="rounded border border-amber-500 px-2 py-1 text-amber-900 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          重試相同標籤操作
        </button>
      )}
      {retryRead && (
        <button
          type="button"
          onClick={onRefresh}
          className="rounded border border-stone-300 px-2 py-1 text-stone-700 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
        >
          重新載入標籤
        </button>
      )}
    </div>
  );
}

export function GuestBatchTagControls({
  photos,
  selectedPhotoIds,
}: {
  photos: readonly GalleryPhoto[];
  selectedPhotoIds: readonly string[];
}) {
  const context = useContext(GuestTagsContext);
  const inputId = useId();
  const scope = JSON.stringify([
    context?.snapshot.key,
    context?.snapshot.guestId,
  ]);
  const [draft, setDraft] = useState({
    scope,
    label: '',
    ids: selectedPhotoIds,
  });
  const [notice, setNotice] = useState({ scope, text: '' });
  const current =
    draft.scope === scope ? draft : { scope, label: '', ids: selectedPhotoIds };
  if (
    !context ||
    context.snapshot.status !== 'ready' ||
    !context.snapshot.enabled ||
    !context.snapshot.canTag
  )
    return null;
  const active = context;
  const operations = [...active.operations.entries()].filter(([key]) => {
    const [albumId] = JSON.parse(key) as [string, string];
    return albumId === active.albumId;
  });
  const busy = operations.some(([, operation]) =>
    operationIsGuarded(operation),
  );
  const targets = photos
    .filter((photo) => current.ids.includes(photo.id))
    .slice(0, 24);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = guestTagLabelSchema.safeParse(current.label);
    if (!parsed.success || targets.length === 0 || busy) {
      setNotice({ scope, text: '請選擇照片，並輸入 1–40 字的標籤。' });
      return;
    }
    let started = 0;
    let unchanged = 0;
    for (const photo of targets) {
      if (
        active.snapshot.tags
          .get(photo.id)
          ?.some((tag) => tag.label === parsed.data)
      ) {
        unchanged++;
      } else if (
        active.changeTag(photo.id, photo.versionId, parsed.data, true)
      ) {
        started++;
      }
    }
    const skipped = targets.length - started - unchanged;
    setNotice({
      scope,
      text: `已送出 ${started} 張，已有標籤 ${unchanged} 張${skipped ? `，${skipped} 張未送出，請檢查標籤上限或重新載入照片` : ''}。每張照片分別儲存，請確認下方結果。`,
    });
  }

  return (
    <details
      className="guest-batch-tag-disclosure"
      open={
        busy || (notice.scope === scope && Boolean(notice.text)) || undefined
      }
    >
      <summary>
        <StudioIcon name="tag" width={18} height={18} />
        批次標籤
      </summary>
      <form onSubmit={apply} className="guest-batch-tag-form">
        <p>為本頁勾選的照片加入同一標籤，不會變更送交攝影師的挑片。</p>
        <fieldset disabled={busy}>
          <legend>選擇照片（本頁最多 24 張）</legend>
          <div className="guest-batch-tag-targets">
            {photos.slice(0, 24).map((photo) => (
              <label key={photo.id}>
                <input
                  type="checkbox"
                  checked={current.ids.includes(photo.id)}
                  onChange={(event) =>
                    setDraft({
                      ...current,
                      ids: event.currentTarget.checked
                        ? [...current.ids, photo.id]
                        : current.ids.filter((id) => id !== photo.id),
                    })
                  }
                />
                {photo.filename}
                {current.label &&
                  active.snapshot.tags
                    .get(photo.id)
                    ?.some(
                      (tag) => tag.label === normalizeLabel(current.label),
                    ) && <span>已儲存</span>}
              </label>
            ))}
          </div>
          <label htmlFor={inputId}>標籤名稱</label>
          <div className="guest-batch-tag-input">
            <input
              id={inputId}
              value={current.label}
              maxLength={80}
              onChange={(event) =>
                setDraft({ ...current, label: event.currentTarget.value })
              }
            />
            <button
              type="submit"
              disabled={!targets.length || !current.label.trim()}
            >
              套用至 {targets.length} 張照片
            </button>
          </div>
        </fieldset>
        {notice.scope === scope && notice.text && (
          <p role="status">{notice.text}</p>
        )}
      </form>
      {operations.map(([key, operation]) => {
        const [, photoId] = JSON.parse(key) as [string, string];
        const guestMatches =
          !('command' in operation) ||
          operation.command.body.expectedGuestId === active.snapshot.guestId;
        return (
          <div key={key} className="guest-batch-tag-result">
            <span>
              {photos.find((photo) => photo.id === photoId)?.filename ??
                '照片標籤'}
            </span>
            <TagStatus
              operation={operation}
              guestMatches={guestMatches}
              onRetryMutation={() => active.retryMutation(photoId)}
              onRefresh={() => active.refreshState(photoId)}
            />
          </div>
        );
      })}
    </details>
  );
}

export function GuestTagControls({
  photoId,
  versionId,
  disabled = false,
  compact = false,
}: {
  photoId: string;
  versionId: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const context = useContext(GuestTagsContext);
  const inputId = useId();
  const statusId = useId();
  const draftScope = JSON.stringify([
    context?.albumId,
    photoId,
    versionId,
    context?.snapshot.key,
    context?.snapshot.guestId,
  ]);
  const [draftState, setDraftState] = useState({
    scope: draftScope,
    value: '',
  });
  const draft = draftState.scope === draftScope ? draftState.value : '';
  const [validationState, setValidationState] = useState<{
    scope: string;
    message: string | null;
  }>({ scope: draftScope, message: null });
  const validationMessage =
    validationState.scope === draftScope ? validationState.message : null;

  function updateDraft(value: string) {
    setDraftState({ scope: draftScope, value });
  }

  function updateValidationMessage(message: string | null) {
    setValidationState({ scope: draftScope, message });
  }

  if (!context) return null;
  const activeContext = context;
  if (!activeContext.photoIds.includes(photoId)) return null;

  const snapshot = activeContext.snapshot;
  if (snapshot.status === 'loading') return null;
  if (!snapshot.enabled || !snapshot.canTag) return null;
  if (snapshot.status === 'error') return null;

  const tags = snapshot.tags.get(photoId);
  const failed = snapshot.failedPhotoIds.has(photoId) || !tags;
  const operation = activeContext.operations.get(
    operationKey(activeContext.albumId, photoId),
  );
  const commandGuestId =
    operation && 'command' in operation
      ? operation.command.body.expectedGuestId
      : null;
  const guestMatches =
    commandGuestId === null ||
    snapshot.guestId === null ||
    commandGuestId === snapshot.guestId;
  const locked = disabled || failed || Boolean(operation);

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = normalizeLabel(draft);
    if (!label) {
      updateValidationMessage(
        '標籤需先去除首尾空白，長度 1–40 個 Unicode 字元，且不可含控制或格式字元。',
      );
      return;
    }
    if (tags?.some((tag) => tag.label === label)) {
      updateValidationMessage('這個標籤已加入照片。');
      return;
    }
    if (tags && tags.length >= 20) {
      updateValidationMessage('每張照片最多可有 20 個標籤。');
      return;
    }
    const started = activeContext.changeTag(photoId, versionId, label, true);
    if (started) {
      updateDraft('');
      updateValidationMessage(null);
    }
  }

  const classes =
    'min-w-0 rounded border border-stone-200 bg-white ' +
    (compact ? 'p-2' : 'p-2.5');

  if (failed) {
    return (
      <section className={classes} aria-label="訪客標籤">
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span role="status">標籤狀態暫時無法載入。</span>
          {!operation && (
            <button
              type="button"
              onClick={() => activeContext.refreshState(photoId)}
              className="rounded border border-stone-300 px-2 py-1 text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            >
              重新載入標籤
            </button>
          )}
          <TagStatus
            operation={operation}
            guestMatches={guestMatches}
            onRetryMutation={() => activeContext.retryMutation(photoId)}
            onRefresh={() => activeContext.refreshState(photoId)}
          />
        </div>
      </section>
    );
  }

  const visibleTags = tags ?? [];
  const atLimit = visibleTags.length >= 20;
  const addDisabled = locked || atLimit || draft.trim().length === 0;

  return (
    <section className={classes} aria-label="訪客標籤">
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleTags.length > 0 ? (
          <ul
            className="flex min-w-0 flex-wrap gap-1.5"
            aria-label="此照片的標籤"
          >
            {visibleTags.map((tag) => (
              <li
                key={tag.tagId}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-950"
              >
                <span className="max-w-48 break-words">{tag.label}</span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() =>
                    activeContext.changeTag(
                      photoId,
                      versionId,
                      tag.label,
                      false,
                    )
                  }
                  aria-label={'移除標籤 ' + tag.label}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-stone-500">尚無標籤</p>
        )}
      </div>

      <form
        onSubmit={handleAdd}
        className="mt-2 flex flex-wrap items-center gap-2"
      >
        <label htmlFor={inputId} className="sr-only">
          新增標籤
        </label>
        <input
          id={inputId}
          type="text"
          value={draft}
          disabled={locked || atLimit}
          maxLength={80}
          aria-describedby={validationMessage ? statusId : undefined}
          placeholder={atLimit ? '已達 20 個標籤上限' : '新增標籤'}
          onChange={(event) => {
            updateDraft(event.currentTarget.value);
            updateValidationMessage(null);
          }}
          className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1.5 text-xs text-stone-900 placeholder:text-stone-400 focus:border-amber-700 focus:outline-none focus:ring-1 focus:ring-amber-700 disabled:bg-stone-100 disabled:text-stone-500"
        />
        <button
          type="submit"
          disabled={addDisabled}
          className="rounded border border-amber-700 bg-amber-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          新增
        </button>
      </form>

      {validationMessage && (
        <p id={statusId} role="alert" className="mt-1 text-xs text-red-800">
          {validationMessage}
        </p>
      )}
      <p className="mt-1 text-xs text-stone-500">
        {visibleTags.length}/20 個標籤
      </p>
      <div className="mt-1">
        <TagStatus
          operation={operation}
          guestMatches={guestMatches}
          onRetryMutation={() => activeContext.retryMutation(photoId)}
          onRefresh={() => activeContext.refreshState(photoId)}
        />
      </div>
    </section>
  );
}
