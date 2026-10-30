'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { z } from 'zod';
import { freehandAnnotationWriteCapabilitiesSchema } from '../../../packages/contracts/src/freehand-annotation-capabilities.ts';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access.ts';
import {
  guestAnnotationResultSchema,
  guestAnnotationsCapabilitiesSchema,
  guestAnnotationsPageSchema,
  type GuestAnnotationCommand,
  type GuestAnnotationItem,
  type GuestAnnotationResult,
} from '../../../packages/contracts/src/guest-annotations.ts';
import {
  guestSharedAnnotationsPageSchema,
  type GuestSharedAnnotationItem,
} from '../../../packages/contracts/src/annotation-threads.ts';
import type { AnnotationGeometry } from '../../../packages/contracts/src/annotation-geometry.ts';
import type { FreehandStroke } from '../../../packages/contracts/src/freehand-stroke.ts';
import {
  abandonGuestAnnotationIntent,
  claimGuestAnnotationIntent,
  completeGuestAnnotationIntent,
  getGuestAnnotationJournalSnapshot,
  guestAnnotationJournalMetadata,
  isCurrentGuestAnnotationIntent,
  markGuestAnnotationConflict,
  markGuestAnnotationUncertain,
  readGuestAnnotationJournal,
  releaseGuestAnnotationClaim,
  saveGuestAnnotationIntent,
  subscribeGuestAnnotationJournal,
  type GuestAnnotationJournalMetadata,
  type GuestAnnotationJournalSnapshot,
} from './guest-annotation-journal.ts';
import {
  AnnotationCanvas,
  type AnnotationCanvasImageState,
  type AnnotationTool,
} from './annotation-canvas.tsx';

type Status =
  | 'loading'
  | 'ready'
  | 'disabled'
  | 'unauthorized'
  | 'denied'
  | 'upgrade-required'
  | 'error';

type ExpectedCurrent = {
  revision: number;
  state: 'open' | 'resolved';
  geometry: AnnotationGeometry;
  style: { color: 'amber' | 'red' | 'blue' };
  commentId: string | null;
};

type Draft = {
  geometry: AnnotationGeometry;
  color: 'amber' | 'red' | 'blue';
  annotationId: string | null;
  expectedCurrent: ExpectedCurrent | null;
};

type GuestAnnotationTool = AnnotationTool | 'freehand';

function commandUsesFreehandGeometry(command: GuestAnnotationCommand): boolean {
  return (
    (command.operation === 'create' || command.operation === 'update') &&
    command.geometry.type === 'freehand'
  );
}

/** Requires an explicit trusted capability and a currently authorized preview. */
export function canShowGuestFreehandControl(
  writeCapability: boolean | undefined,
  imageAllowed: boolean,
  readCapability: boolean | undefined,
): boolean {
  return writeCapability === true && readCapability === true && imageAllowed;
}

export const FREEHAND_ANNOTATION_READ_CAPABILITIES_HEADER =
  'X-Kino-Annotation-Read-Capabilities';
export const FREEHAND_ANNOTATION_READ_CAPABILITY = 'freehand-v1';

export function guestAnnotationReadHeaders(
  freehandReadCapability: boolean,
): Record<string, string> {
  return freehandReadCapability
    ? {
        [FREEHAND_ANNOTATION_READ_CAPABILITIES_HEADER]:
          FREEHAND_ANNOTATION_READ_CAPABILITY,
      }
    : {};
}

export function isGuestAnnotationReadUpgradeRequired(
  statusCode: number,
  code: string | null,
): boolean {
  return statusCode === 426 && code === 'ANNOTATION_CLIENT_UPGRADE_REQUIRED';
}

export function isGuestAnnotationCommandConflict(
  statusCode: number,
  code: string | null,
): boolean {
  return (
    statusCode === 409 &&
    (code === 'ANNOTATION_REVISION_CONFLICT' ||
      code === 'ANNOTATION_HISTORY_CHANGED' ||
      code === 'REQUEST_ID_CONFLICT')
  );
}

export function shouldDiscardGuestFreehandDraft(
  previousCapability: boolean | undefined,
  currentCapability: boolean | undefined,
  geometry: AnnotationGeometry | null,
): boolean {
  return (
    previousCapability === true &&
    currentCapability !== true &&
    geometry?.type === 'freehand'
  );
}

export function draftWithGuestFreehandStroke(
  current: Draft | null,
  stroke: FreehandStroke,
): Draft {
  return {
    geometry: stroke.geometry,
    color: stroke.style.color,
    annotationId: current?.annotationId ?? null,
    expectedCurrent: current?.expectedCurrent ?? null,
  };
}

type PanelSnapshot = {
  key: string;
  generation: number;
  status: Status;
  featureEnabled: boolean;
  guestId: string | null;
  canAnnotate: boolean;
  canComment: boolean;
  items: GuestSharedAnnotationItem[];
  nextCursor: string | null;
  seenCursors: string[];
  loadingMore: boolean;
  moreError: boolean;
};

type CapabilityRead =
  | { enabled: false }
  | {
      enabled: true;
      guestId: string;
      canAnnotate: true;
      canComment: boolean;
    }
  | {
      enabled: true;
      denied: 'view' | 'annotate' | 'compare';
    };

type PageTarget = {
  albumId: string;
  photoId: string;
  versionId: string;
};

const emptyJournal: GuestAnnotationJournalSnapshot = { kind: 'none' };
const preparationLocks = new Set<string>();
const errorSchema = z
  .object({ error: z.object({ code: z.string() }).strict() })
  .strict();

class ApiFailure extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string | null,
  ) {
    super('Guest annotations request failed');
  }
}

class ProtocolFailure extends Error {
  constructor() {
    super('Invalid Guest annotations response');
  }
}

function panelKey(
  albumId: string,
  photoId: string,
  versionId: string,
  previewUrl: string | null,
  isCurrentVersion: boolean | undefined,
) {
  return JSON.stringify([
    albumId,
    photoId,
    versionId,
    previewUrl,
    isCurrentVersion ?? null,
  ]);
}

function emptyPanel(
  key: string,
  generation: number,
  status: Status,
  featureEnabled = false,
): PanelSnapshot {
  return {
    key,
    generation,
    status,
    featureEnabled,
    guestId: null,
    canAnnotate: false,
    canComment: false,
    items: [],
    nextCursor: null,
    seenCursors: [],
    loadingMore: false,
    moreError: false,
  };
}

function previewRoute(
  input: string | null,
  photoId: string,
  versionId: string,
): string | null {
  if (input === null || typeof window === 'undefined') return null;
  try {
    const parsed = new URL(input, window.location.origin);
    const expected =
      '/api/guest/photos/' +
      encodeURIComponent(photoId) +
      '/versions/' +
      encodeURIComponent(versionId) +
      '/assets/preview';
    if (
      parsed.origin !== window.location.origin ||
      parsed.pathname !== expected ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }
    return expected;
  } catch {
    return null;
  }
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new ApiFailure(
      response.status,
      error.success ? error.data.error.code : null,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ProtocolFailure();
  return parsed.data;
}

async function readCapability(
  albumId: string,
  isCurrentVersion: boolean | undefined,
  signal: AbortSignal,
): Promise<CapabilityRead> {
  const capability = await requestJson(
    '/api/guest/annotations/capabilities',
    guestAnnotationsCapabilitiesSchema,
    { signal },
  );
  if (!capability.enabled) return { enabled: false };

  const response = await requestJson(
    '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
    z.object({ access: guestAlbumAccessSchema }).strict(),
    { signal },
  );
  const access = response.access;
  if (access.albumId !== albumId) throw new ProtocolFailure();
  if (!access.permissions.can_view) return { enabled: true, denied: 'view' };
  if (!access.permissions.can_annotate)
    return { enabled: true, denied: 'annotate' };
  if (isCurrentVersion !== true && !access.permissions.can_compare_versions) {
    return { enabled: true, denied: 'compare' };
  }
  return {
    enabled: true,
    guestId: access.guestId,
    canAnnotate: true,
    canComment: access.permissions.can_comment,
  };
}

async function readFreehandWriteCapability(
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const capability = await requestJson(
      '/api/guest/annotations/freehand-capabilities',
      freehandAnnotationWriteCapabilitiesSchema,
      { signal },
    );
    return capability.enabled;
  } catch {
    return false;
  }
}

function annotationsPath(
  target: PageTarget,
  cursor?: string | null,
  annotationId?: string,
) {
  let path =
    '/api/guest/albums/' +
    encodeURIComponent(target.albumId) +
    '/photos/' +
    encodeURIComponent(target.photoId) +
    '/versions/' +
    encodeURIComponent(target.versionId) +
    '/annotations/own';
  if (annotationId !== undefined) {
    path += '?annotationId=' + encodeURIComponent(annotationId);
  } else if (cursor) {
    path += '?cursor=' + encodeURIComponent(cursor);
  }
  return path;
}

function sharedAnnotationsPath(
  target: PageTarget,
  cursor?: string | null,
  annotationId?: string,
) {
  let path =
    '/api/guest/albums/' +
    encodeURIComponent(target.albumId) +
    '/photos/' +
    encodeURIComponent(target.photoId) +
    '/versions/' +
    encodeURIComponent(target.versionId) +
    '/annotations/shared';
  if (cursor && annotationId !== undefined) throw new ProtocolFailure();
  if (annotationId !== undefined)
    path += '?annotationId=' + encodeURIComponent(annotationId);
  else if (cursor) path += '?cursor=' + encodeURIComponent(cursor);
  return path;
}

async function readPage(
  target: PageTarget,
  guestId: string,
  signal: AbortSignal,
  freehandReadCapability: boolean,
  cursor?: string | null,
  annotationId?: string,
) {
  const page = await requestJson(
    annotationsPath(target, cursor, annotationId),
    guestAnnotationsPageSchema,
    {
      signal,
      headers: guestAnnotationReadHeaders(freehandReadCapability),
    },
  );
  if (
    page.guestId !== guestId ||
    page.photoId !== target.photoId ||
    page.versionId !== target.versionId ||
    page.items.some(
      (item) =>
        item.photoId !== target.photoId ||
        item.versionId !== target.versionId ||
        !item.isMine,
    )
  ) {
    throw new ProtocolFailure();
  }
  return page;
}

async function readSharedPage(
  target: PageTarget,
  guestId: string,
  signal: AbortSignal,
  freehandReadCapability: boolean,
  cursor?: string | null,
  annotationId?: string,
) {
  const page = await requestJson(
    sharedAnnotationsPath(target, cursor, annotationId),
    guestSharedAnnotationsPageSchema,
    {
      signal,
      headers: guestAnnotationReadHeaders(freehandReadCapability),
    },
  );
  if (
    page.guestId !== guestId ||
    page.photoId !== target.photoId ||
    page.versionId !== target.versionId ||
    page.items.some(
      (item) =>
        item.photoId !== target.photoId || item.versionId !== target.versionId,
    )
  ) {
    throw new ProtocolFailure();
  }
  if (
    annotationId !== undefined &&
    (page.items.length !== 1 ||
      page.items[0]?.annotationId !== annotationId ||
      page.nextCursor !== null)
  )
    throw new ProtocolFailure();
  return page;
}

async function sharedProjectionAfterOwnRead(
  target: PageTarget,
  guestId: string,
  own: GuestAnnotationItem,
  signal: AbortSignal,
  freehandReadCapability: boolean,
): Promise<GuestSharedAnnotationItem> {
  const page = await readSharedPage(
    target,
    guestId,
    signal,
    freehandReadCapability,
    null,
    own.annotationId,
  );
  const item = page.items[0]!;
  if (
    item.authorType !== 'guest' ||
    !item.isMine ||
    item.revision < own.revision
  )
    throw new ProtocolFailure();
  if (
    item.revision === own.revision &&
    (item.state !== own.state ||
      JSON.stringify(item.geometry) !== JSON.stringify(own.geometry) ||
      JSON.stringify(item.style) !== JSON.stringify(own.style) ||
      item.commentId !== own.commentId ||
      item.updatedAt !== own.updatedAt ||
      item.createdAt !== own.createdAt ||
      item.authorLabel !== own.authorLabel)
  )
    throw new ProtocolFailure();
  return item;
}

function mergeItems(
  existing: GuestSharedAnnotationItem[],
  incoming: GuestSharedAnnotationItem[],
) {
  const result = [...existing];
  for (const item of incoming) {
    const index = result.findIndex(
      (current) => current.annotationId === item.annotationId,
    );
    if (index === -1) {
      result.push(item);
    } else {
      const current = result[index]!;
      if (
        current.authorType !== item.authorType ||
        current.isMine !== item.isMine
      ) {
        throw new ProtocolFailure();
      }
      const previousProcessingRevision = current.processing?.revision ?? 0;
      const incomingProcessingRevision = item.processing?.revision ?? 0;
      if (
        item.revision > current.revision &&
        incomingProcessingRevision < previousProcessingRevision
      )
        throw new ProtocolFailure();
      if (
        item.revision > current.revision ||
        (item.revision === current.revision &&
          incomingProcessingRevision >= previousProcessingRevision)
      )
        result[index] = item;
    }
  }
  return result;
}

function annotationStateLabel(state: GuestSharedAnnotationItem['state']) {
  switch (state) {
    case 'open':
      return '待處理';
    case 'resolved':
      return '已處理';
    case 'deleted':
      return '已刪除';
  }
}

function expectedCurrentFromItem(
  item: GuestSharedAnnotationItem,
): ExpectedCurrent | null {
  if (
    item.authorType !== 'guest' ||
    !item.isMine ||
    item.state === 'deleted' ||
    item.geometry === null ||
    item.style === null
  ) {
    return null;
  }
  return {
    revision: item.revision,
    state: item.state,
    geometry: item.geometry,
    style: item.style,
    commentId: item.commentId,
  };
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateReceipt(
  result: GuestAnnotationResult,
  metadata: GuestAnnotationJournalMetadata,
) {
  const { command } = metadata;
  const item = result.item;
  if (
    result.requestId !== command.requestId ||
    result.operation !== command.operation ||
    item.photoId !== metadata.photoId ||
    item.versionId !== metadata.versionId ||
    !item.isMine
  ) {
    throw new ProtocolFailure();
  }

  if (command.operation === 'create') {
    if (
      item.revision !== 1 ||
      item.state !== 'open' ||
      !sameJson(item.geometry, command.geometry) ||
      !sameJson(item.style, command.style) ||
      item.commentId !== command.commentId
    ) {
      throw new ProtocolFailure();
    }
    return;
  }

  const expected = metadata.expectedCurrent;
  if (
    !expected ||
    item.annotationId !== command.annotationId ||
    item.revision !== command.expectedRevision + 1
  ) {
    throw new ProtocolFailure();
  }

  if (command.operation === 'update') {
    if (
      item.state !== 'open' ||
      !sameJson(item.geometry, command.geometry) ||
      !sameJson(item.style, command.style) ||
      item.commentId !== command.commentId
    ) {
      throw new ProtocolFailure();
    }
    return;
  }

  if (command.operation === 'delete') {
    if (
      item.state !== 'deleted' ||
      item.geometry !== null ||
      item.style !== null ||
      item.commentId !== null
    ) {
      throw new ProtocolFailure();
    }
    return;
  }

  const nextState = command.operation === 'resolve' ? 'resolved' : 'open';
  if (
    item.state !== nextState ||
    !sameJson(item.geometry, expected.geometry) ||
    !sameJson(item.style, expected.style) ||
    item.commentId !== expected.commentId
  ) {
    throw new ProtocolFailure();
  }
}

function conflictText(error: ApiFailure) {
  if (error.code === 'ANNOTATION_REVISION_CONFLICT') {
    return '標記版本已變更。保留了原操作；請明確重新載入目前標記，再重試或放棄原操作。';
  }
  if (error.code === 'ANNOTATION_HISTORY_CHANGED') {
    return '標記清單快照已變更。保留了原操作；請明確重新載入目前標記。';
  }
  if (error.code === 'REQUEST_ID_CONFLICT') {
    return '操作識別碼與既有操作不符。保留了原操作；請重新載入後檢查，或明確放棄。';
  }
  return '標記操作遇到版本衝突。保留了原操作；請明確重新載入目前標記。';
}

function snapshotFailure(error: unknown): Status {
  if (error instanceof ApiFailure) {
    if (error.statusCode === 401) return 'unauthorized';
    if (error.statusCode === 403) return 'denied';
    if (error.statusCode === 503) return 'disabled';
    if (isGuestAnnotationReadUpgradeRequired(error.statusCode, error.code)) {
      return 'upgrade-required';
    }
  }
  return 'error';
}

function failureMessage(error: unknown) {
  if (error instanceof ApiFailure) {
    if (error.statusCode === 401)
      return '訪客工作階段已失效。請重新登入相同邀請後重新載入。';
    if (error.statusCode === 403) return '目前邀請或版本沒有標註所需的授權。';
    if (error.statusCode === 503) return '標註功能目前未開放。';
    if (isGuestAnnotationReadUpgradeRequired(error.statusCode, error.code)) {
      return '這項邀請包含新版自由筆畫標註，目前畫面無法安全讀取。請更新至支援版本後重新載入；未確認的原操作會保留。';
    }
    if (
      error.statusCode === 409 &&
      error.code === 'FREEHAND_ANNOTATIONS_DISABLED'
    ) {
      return '自由筆畫標註目前暫停儲存；原操作與識別碼已保留。服務重新開啟後，可直接重試原操作。';
    }
    if (error.statusCode === 409) return conflictText(error);
  }
  if (error instanceof ProtocolFailure)
    return '伺服器回傳的標記資料無法驗證；未套用或清除原操作。';
  return '無法確認標記資料。請保持原操作並明確重試。';
}

export function GuestAnnotationsPanel({
  albumId,
  photoId,
  versionId,
  filename = '這張照片',
  versionNo,
  previewUrl,
  isCurrentVersion,
  freehandReadCapability = false,
  onPendingChange,
  onUnauthorized,
}: {
  albumId: string;
  photoId: string;
  versionId: string;
  filename?: string;
  versionNo?: number;
  previewUrl: string | null;
  isCurrentVersion?: boolean;
  /** Advertise this product client’s complete freehand read support. */
  freehandReadCapability?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onUnauthorized?: (() => void) | undefined;
}) {
  const contextKey = panelKey(
    albumId,
    photoId,
    versionId,
    previewUrl,
    isCurrentVersion,
  );
  const target = { albumId, photoId, versionId };
  const safePreviewUrl = previewRoute(previewUrl, photoId, versionId);
  const [snapshot, setSnapshot] = useState<PanelSnapshot>(() =>
    emptyPanel(contextKey, 0, 'loading'),
  );
  const snapshotRef = useRef(snapshot);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [freehandWriteCapabilityRecord, setFreehandWriteCapabilityRecord] =
    useState<{ contextKey: string; enabled: boolean } | null>(null);
  const freehandWriteCapability =
    freehandWriteCapabilityRecord?.contextKey === contextKey &&
    freehandWriteCapabilityRecord.enabled;
  const freehandEditorCapability =
    freehandWriteCapability && freehandReadCapability === true;
  const [previousFreehandCapability, setPreviousFreehandCapability] = useState(
    freehandEditorCapability,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (previousFreehandCapability !== freehandEditorCapability) {
    setPreviousFreehandCapability(freehandEditorCapability);
    if (
      shouldDiscardGuestFreehandDraft(
        previousFreehandCapability,
        freehandEditorCapability,
        draft?.geometry ?? null,
      )
    ) {
      setDraft(null);
    }
  }
  const [tool, setTool] = useState<GuestAnnotationTool>('point');
  const [color, setColor] = useState<'amber' | 'red' | 'blue'>('amber');
  const [notice, setNotice] = useState<string | null>(null);
  const [imageState, setImageState] = useState<AnnotationCanvasImageState>({
    status: 'empty',
  });
  const [previewFailed, setPreviewFailed] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [conflictReloadedRequestId, setConflictReloadedRequestId] = useState<
    string | null
  >(null);
  const [preparing, setPreparing] = useState(false);
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeKeyRef = useRef(contextKey);
  const latestContextKeyRef = useRef(contextKey);
  const controllersRef = useRef(new Set<AbortController>());
  const loadingMoreRef = useRef(false);
  const callbackRef = useRef(onPendingChange);
  const unauthorizedCallbackRef = useRef(onUnauthorized);
  const lastPendingReportRef = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    callbackRef.current = onPendingChange;
    unauthorizedCallbackRef.current = onUnauthorized;
    latestContextKeyRef.current = contextKey;
  }, [contextKey, onPendingChange, onUnauthorized]);

  const writeSnapshot = useCallback((next: PanelSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const current =
    snapshot.key === contextKey
      ? snapshot
      : emptyPanel(contextKey, 0, 'loading');
  const journalGuestId = current.guestId ?? '';
  const subscribeJournal = useCallback(
    (listener: () => void) =>
      journalGuestId
        ? subscribeGuestAnnotationJournal(journalGuestId, albumId, listener)
        : () => undefined,
    [albumId, journalGuestId],
  );
  const getJournalSnapshot = useCallback(
    () =>
      journalGuestId
        ? getGuestAnnotationJournalSnapshot(journalGuestId, albumId)
        : emptyJournal,
    [albumId, journalGuestId],
  );
  const journal = useSyncExternalStore(
    subscribeJournal,
    getJournalSnapshot,
    () => emptyJournal,
  );

  const contextGenerationIsCurrent = useCallback(
    (generation: number) =>
      latestContextKeyRef.current === contextKey &&
      activeKeyRef.current === contextKey &&
      activeGenerationRef.current === generation &&
      snapshotRef.current.key === contextKey &&
      snapshotRef.current.generation === generation,
    [contextKey],
  );

  const abortReads = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    loadingMoreRef.current = false;
  }, []);

  const setReadUpgradeRequired = useCallback(
    (guestId: string, generation: number, error: ApiFailure) => {
      if (!contextGenerationIsCurrent(generation)) return;
      const upgradeGeneration = generationRef.current + 1;
      generationRef.current = upgradeGeneration;
      activeGenerationRef.current = upgradeGeneration;
      activeKeyRef.current = contextKey;
      abortReads();
      writeSnapshot({
        ...emptyPanel(contextKey, upgradeGeneration, 'upgrade-required', true),
        guestId,
      });
      setNotice(failureMessage(error));
    },
    [abortReads, contextGenerationIsCurrent, contextKey, writeSnapshot],
  );

  const bootstrap = useCallback(
    async (explicitReload = false) => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      activeGenerationRef.current = generation;
      activeKeyRef.current = contextKey;
      abortReads();
      writeSnapshot(emptyPanel(contextKey, generation, 'loading'));
      setDraft(null);
      setSelectedId(null);
      setDeleteConfirmId(null);
      setNotice(null);
      setPreviewFailed(false);
      setImageState({ status: 'empty' });
      setConflictReloadedRequestId(null);
      setFreehandWriteCapabilityRecord({ contextKey, enabled: false });

      if (document.visibilityState === 'hidden') return false;

      const controller = new AbortController();
      controllersRef.current.add(controller);
      const targetForRead: PageTarget = { albumId, photoId, versionId };
      const active = () =>
        !controller.signal.aborted &&
        document.visibilityState !== 'hidden' &&
        contextGenerationIsCurrent(generation);
      let authorizedGuestId: string | null = null;

      try {
        const access = await readCapability(
          albumId,
          isCurrentVersion,
          controller.signal,
        );
        if (!active()) return false;
        if (!access.enabled) {
          writeSnapshot(emptyPanel(contextKey, generation, 'disabled'));
          return false;
        }
        writeSnapshot(emptyPanel(contextKey, generation, 'loading', true));
        if ('denied' in access) {
          writeSnapshot({
            ...emptyPanel(contextKey, generation, 'denied', true),
            canAnnotate: false,
          });
          return false;
        }

        authorizedGuestId = access.guestId;
        void readFreehandWriteCapability(controller.signal).then((enabled) => {
          if (active()) {
            setFreehandWriteCapabilityRecord({ contextKey, enabled });
          }
        });
        const restored = readGuestAnnotationJournal(access.guestId, albumId);
        const page = await readSharedPage(
          targetForRead,
          access.guestId,
          controller.signal,
          freehandReadCapability,
        );
        if (!active()) return false;

        let items = page.items;
        if (
          explicitReload &&
          restored.kind === 'pending' &&
          restored.metadata.photoId === photoId &&
          restored.metadata.versionId === versionId &&
          restored.command.operation !== 'create'
        ) {
          const currentPage = await readPage(
            targetForRead,
            access.guestId,
            controller.signal,
            freehandReadCapability,
            null,
            restored.command.annotationId,
          );
          if (!active()) return false;
          if (currentPage.items.length !== 1) throw new ProtocolFailure();
          const projected = await sharedProjectionAfterOwnRead(
            targetForRead,
            access.guestId,
            currentPage.items[0]!,
            controller.signal,
            freehandReadCapability,
          );
          if (!active()) return false;
          items = mergeItems(items, [projected]);
        }

        const seenCursors: string[] = [];
        writeSnapshot({
          key: contextKey,
          generation,
          status: 'ready',
          featureEnabled: true,
          guestId: access.guestId,
          canAnnotate: true,
          canComment: access.canComment,
          items,
          nextCursor: page.nextCursor,
          seenCursors,
          loadingMore: false,
          moreError: false,
        });
        if (
          explicitReload &&
          restored.kind === 'pending' &&
          restored.status === 'conflict' &&
          restored.metadata.photoId === photoId &&
          restored.metadata.versionId === versionId
        ) {
          setConflictReloadedRequestId(restored.command.requestId);
        }
        return true;
      } catch (error) {
        if (!active()) return false;
        const status = snapshotFailure(error);
        if (
          error instanceof ApiFailure &&
          isGuestAnnotationReadUpgradeRequired(error.statusCode, error.code) &&
          authorizedGuestId !== null
        ) {
          setReadUpgradeRequired(authorizedGuestId, generation, error);
        } else {
          writeSnapshot(
            emptyPanel(contextKey, generation, status, status !== 'disabled'),
          );
          setNotice(failureMessage(error));
        }
        if (status === 'unauthorized') unauthorizedCallbackRef.current?.();
        return false;
      } finally {
        controllersRef.current.delete(controller);
      }
    },
    [
      abortReads,
      albumId,
      contextGenerationIsCurrent,
      contextKey,
      freehandReadCapability,
      isCurrentVersion,
      photoId,
      setReadUpgradeRequired,
      versionId,
      writeSnapshot,
    ],
  );

  useEffect(() => {
    const suspend = () => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      activeGenerationRef.current = generation;
      activeKeyRef.current = contextKey;
      abortReads();
      writeSnapshot(emptyPanel(contextKey, generation, 'loading'));
      setDraft(null);
      setSelectedId(null);
      setDeleteConfirmId(null);
      setNotice(null);
      setImageState({ status: 'empty' });
      setPreviewFailed(false);
      setFreehandWriteCapabilityRecord({ contextKey, enabled: false });
      setConflictReloadedRequestId(null);
    };
    const resume = () => {
      if (document.visibilityState !== 'hidden') void bootstrap();
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') suspend();
      else resume();
    };

    window.addEventListener('blur', suspend);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibilityChanged);
    if (document.visibilityState === 'hidden') suspend();
    else void bootstrap();

    return () => {
      window.removeEventListener('blur', suspend);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', visibilityChanged);
      generationRef.current += 1;
      activeGenerationRef.current = generationRef.current;
      abortReads();
    };
  }, [abortReads, bootstrap, contextKey, writeSnapshot]);

  const operationScopeMatches =
    journal.kind === 'pending' &&
    journal.metadata.photoId === photoId &&
    journal.metadata.versionId === versionId;
  const operation = journal;
  const hasSavedIntent = operation.kind !== 'none';
  const hasUnsavedDraft = draft !== null;
  const authorizationUnavailable =
    current.status === 'unauthorized' || current.status === 'denied';
  const pending =
    current.featureEnabled &&
    !authorizationUnavailable &&
    (operation.kind !== 'none' || hasUnsavedDraft);

  useEffect(() => {
    if (authorizationUnavailable) {
      if (lastPendingReportRef.current !== false) {
        callbackRef.current?.(false);
        lastPendingReportRef.current = false;
      }
      return;
    }

    if (current.featureEnabled) {
      if (lastPendingReportRef.current !== pending) {
        callbackRef.current?.(pending);
        lastPendingReportRef.current = pending;
      }
      return;
    }

    if (
      (current.status === 'disabled' || current.status === 'loading') &&
      lastPendingReportRef.current === true
    ) {
      callbackRef.current?.(false);
      lastPendingReportRef.current = false;
    }
  }, [
    authorizationUnavailable,
    current.featureEnabled,
    current.status,
    pending,
  ]);

  const ready =
    current.key === contextKey &&
    current.status === 'ready' &&
    current.guestId !== null;
  const imageAllowed =
    ready && current.canAnnotate && !previewFailed && safePreviewUrl !== null;
  const canDraw =
    imageAllowed &&
    imageState.status === 'ready' &&
    operation.kind === 'none' &&
    !preparing;
  const freehandControlAvailable = canShowGuestFreehandControl(
    freehandWriteCapability,
    imageAllowed,
    freehandReadCapability,
  );
  const activeTool: GuestAnnotationTool =
    tool === 'freehand' && !freehandControlAvailable ? 'point' : tool;
  const freehandMode = activeTool === 'freehand';
  const canvasTool: AnnotationTool =
    activeTool === 'freehand' ? 'point' : activeTool;
  const freehandScopeKey =
    freehandControlAvailable && current.guestId !== null
      ? JSON.stringify([albumId, current.guestId, photoId, versionId])
      : undefined;

  const imageStateChanged = useCallback(
    (state: AnnotationCanvasImageState) => {
      if (latestContextKeyRef.current === contextKey) setImageState(state);
    },
    [contextKey],
  );

  const previewFailedHandler = useCallback(() => {
    setPreviewFailed(true);
    setDraft(null);
    setSelectedId(null);
    setNotice('授權預覽無法載入。已隱藏標記與編輯內容；請重新檢查授權並載入。');
    const currentSnapshot = snapshotRef.current;
    if (currentSnapshot.key === contextKey) {
      writeSnapshot({
        ...currentSnapshot,
        status: 'error',
        items: [],
        nextCursor: null,
        loadingMore: false,
      });
    }
  }, [contextKey, writeSnapshot]);

  const liveView = useCallback(
    (generation: number, guestId: string) =>
      latestContextKeyRef.current === contextKey &&
      contextGenerationIsCurrent(generation) &&
      snapshotRef.current.status === 'ready' &&
      snapshotRef.current.guestId === guestId,
    [contextGenerationIsCurrent, contextKey],
  );

  const recheckFreehandWriteCapability = useCallback(
    async (generation: number, guestId: string) => {
      const controller = new AbortController();
      controllersRef.current.add(controller);
      try {
        const enabled = await readFreehandWriteCapability(controller.signal);
        if (
          controller.signal.aborted ||
          document.visibilityState === 'hidden' ||
          !liveView(generation, guestId)
        ) {
          return false;
        }
        setFreehandWriteCapabilityRecord({ contextKey, enabled });
        return enabled;
      } finally {
        controllersRef.current.delete(controller);
      }
    },
    [contextKey, liveView],
  );

  const clearPrivateViewAfterDenial = useCallback(
    (
      status: 'unauthorized' | 'denied',
      guestId: string,
      generation: number,
      message: string,
    ) => {
      if (!contextGenerationIsCurrent(generation)) return false;
      const latest = snapshotRef.current;
      if (
        latest.status !== 'ready' ||
        latest.guestId !== guestId ||
        latest.generation !== generation ||
        latest.key !== contextKey
      ) {
        return false;
      }

      abortReads();
      writeSnapshot({
        ...emptyPanel(contextKey, generation, status, latest.featureEnabled),
        guestId,
      });
      setDraft(null);
      setSelectedId(null);
      setDeleteConfirmId(null);
      setPreviewFailed(true);
      setImageState({ status: 'empty' });
      setFreehandWriteCapabilityRecord({ contextKey, enabled: false });
      setConflictReloadedRequestId(null);
      setNotice(message);
      if (status === 'unauthorized') unauthorizedCallbackRef.current?.();
      return true;
    },
    [abortReads, contextGenerationIsCurrent, contextKey, writeSnapshot],
  );

  const sendClaim = useCallback(
    async (
      metadata: GuestAnnotationJournalMetadata,
      claim: NonNullable<ReturnType<typeof claimGuestAnnotationIntent>>,
      generation: number,
    ) => {
      const controller = new AbortController();
      controllersRef.current.add(controller);
      let authoritative: GuestSharedAnnotationItem | null = null;
      let error: unknown = null;

      try {
        const result = await requestJson(
          '/api/guest/albums/' +
            encodeURIComponent(albumId) +
            '/annotations/commands',
          guestAnnotationResultSchema,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(claim.command),
            signal: controller.signal,
          },
        );
        validateReceipt(result, metadata);
        if (!liveView(generation, metadata.expectedGuestId)) return;

        // Receipts can be historical exact replays. Always fetch the current row
        // before merging and never resurrect the immutable receipt itself.
        const page = await readPage(
          { albumId, photoId: metadata.photoId, versionId: metadata.versionId },
          metadata.expectedGuestId,
          controller.signal,
          freehandReadCapability,
          null,
          result.item.annotationId,
        );
        if (
          page.items.length !== 1 ||
          page.items[0]!.annotationId !== result.item.annotationId
        ) {
          throw new ProtocolFailure();
        }
        const currentItem = page.items[0]!;
        if (
          currentItem.revision < result.item.revision ||
          currentItem.photoId !== metadata.photoId ||
          currentItem.versionId !== metadata.versionId ||
          !currentItem.isMine
        ) {
          throw new ProtocolFailure();
        }
        if (!liveView(generation, metadata.expectedGuestId)) return;
        authoritative = await sharedProjectionAfterOwnRead(
          { albumId, photoId: metadata.photoId, versionId: metadata.versionId },
          metadata.expectedGuestId,
          currentItem,
          controller.signal,
          freehandReadCapability,
        );
        if (!liveView(generation, metadata.expectedGuestId)) return;
      } catch (caught) {
        error = caught;
      } finally {
        controllersRef.current.delete(controller);
        releaseGuestAnnotationClaim(claim);
      }

      if (!liveView(generation, metadata.expectedGuestId)) return;
      if (error !== null) {
        if (
          error instanceof ApiFailure &&
          isGuestAnnotationCommandConflict(error.statusCode, error.code)
        ) {
          if (!markGuestAnnotationConflict(metadata)) return;
          setConflictReloadedRequestId(null);
        } else {
          if (!markGuestAnnotationUncertain(metadata)) return;
        }
        if (
          error instanceof ApiFailure &&
          (error.statusCode === 401 || error.statusCode === 403)
        ) {
          if (!isCurrentGuestAnnotationIntent(metadata)) return;
          clearPrivateViewAfterDenial(
            error.statusCode === 401 ? 'unauthorized' : 'denied',
            metadata.expectedGuestId,
            generation,
            failureMessage(error),
          );
          return;
        }
        if (
          error instanceof ApiFailure &&
          isGuestAnnotationReadUpgradeRequired(error.statusCode, error.code)
        ) {
          setReadUpgradeRequired(metadata.expectedGuestId, generation, error);
          return;
        }
        setNotice(failureMessage(error));
        return;
      }

      if (!authoritative) {
        markGuestAnnotationUncertain(metadata);
        setNotice('目前標記尚未讀回確認；原操作仍保留，請重試相同操作。');
        return;
      }

      const latest = snapshotRef.current;
      if (
        latest.status !== 'ready' ||
        latest.guestId !== metadata.expectedGuestId ||
        latest.key !== contextKey ||
        latest.generation !== generation
      ) {
        return;
      }
      let mergedItems: GuestSharedAnnotationItem[];
      try {
        mergedItems = mergeItems(latest.items, [authoritative]);
      } catch {
        if (!markGuestAnnotationUncertain(metadata)) return;
        setNotice('目前標註清單的作者資料不一致；原操作仍保留，請重新載入。');
        return;
      }
      if (
        !isCurrentGuestAnnotationIntent(metadata) ||
        !completeGuestAnnotationIntent(metadata)
      ) {
        return;
      }
      writeSnapshot({
        ...latest,
        items: mergedItems,
      });
      if (authoritative.state === 'deleted') {
        setSelectedId((value) =>
          value === authoritative!.annotationId ||
          metadata.command.operation === 'create'
            ? null
            : value,
        );
        setDraft((value) =>
          value?.annotationId === authoritative!.annotationId ||
          metadata.command.operation === 'create'
            ? null
            : value,
        );
        setDeleteConfirmId(null);
      }

      setConflictReloadedRequestId(null);
      if (metadata.command.operation === 'create') {
        setDraft(null);
        setSelectedId(authoritative.annotationId);
      } else {
        setDraft((value) =>
          value?.annotationId === authoritative!.annotationId ? null : value,
        );
      }
      setDeleteConfirmId(null);
      setNotice('標記操作已由目前授權清單確認完成。');
    },
    [
      albumId,
      clearPrivateViewAfterDenial,
      contextKey,
      freehandReadCapability,
      liveView,
      setReadUpgradeRequired,
      writeSnapshot,
    ],
  );

  const dispatchNewIntent = useCallback(
    async (metadata: GuestAnnotationJournalMetadata) => {
      const scope = metadata.expectedGuestId + ':' + albumId;
      if (preparationLocks.has(scope)) {
        setNotice('另一筆標記操作正在準備；請等待後再試。');
        return;
      }
      preparationLocks.add(scope);
      setPreparing(true);
      const generation = current.generation;

      try {
        if (commandUsesFreehandGeometry(metadata.command)) {
          const enabled = await recheckFreehandWriteCapability(
            generation,
            metadata.expectedGuestId,
          );
          if (!enabled) {
            if (liveView(generation, metadata.expectedGuestId)) {
              setDraft(null);
              setNotice(
                '目前無法確認自由筆畫寫入授權；草稿未送出，原有復原記錄會保留。',
              );
            }
            return;
          }
        }

        const saved = saveGuestAnnotationIntent(metadata);
        if (!saved.ok) {
          if (saved.snapshot.kind !== 'none')
            readGuestAnnotationJournal(metadata.expectedGuestId, albumId);
          setNotice(
            saved.reason === 'invalid'
              ? '標記操作資料無效，尚未送出。'
              : '已有標記操作或復原記錄；請先完成、重試或明確放棄原操作。',
          );
          return;
        }
        const claim = claimGuestAnnotationIntent(saved.metadata);
        if (!claim) {
          readGuestAnnotationJournal(metadata.expectedGuestId, albumId);
          setNotice('原標記操作已保存，但目前無法取得傳送鎖；請重試原操作。');
          return;
        }
        await sendClaim(saved.metadata, claim, generation);
      } finally {
        preparationLocks.delete(scope);
        setPreparing(false);
      }
    },
    [
      albumId,
      current.generation,
      liveView,
      recheckFreehandWriteCapability,
      sendClaim,
    ],
  );

  function newRequestId() {
    try {
      return crypto.randomUUID().toLowerCase();
    } catch {
      throw new Error('Secure request IDs are unavailable');
    }
  }

  function saveDraft() {
    if (draft?.geometry.type === 'freehand' && !freehandControlAvailable) {
      setDraft(null);
      setNotice('自由筆畫授權已失效；草稿已清除，請重新確認授權。');
      return;
    }
    if (
      draft?.expectedCurrent?.commentId !== null &&
      draft?.expectedCurrent?.commentId !== undefined &&
      !current.canComment
    ) {
      setNotice('此標記連結到留言；保留該連結需要留言授權，目前未送出變更。');
      return;
    }
    if (
      !ready ||
      !current.canAnnotate ||
      !draft ||
      imageState.status !== 'ready' ||
      !safePreviewUrl ||
      operation.kind !== 'none' ||
      preparing
    ) {
      return;
    }

    try {
      const requestId = newRequestId();
      const command: GuestAnnotationCommand =
        draft.annotationId === null || draft.expectedCurrent === null
          ? {
              requestId,
              expectedGuestId: current.guestId!,
              operation: 'create',
              photoId,
              versionId,
              geometry: draft.geometry,
              style: { color: draft.color },
              commentId: null,
            }
          : {
              requestId,
              expectedGuestId: current.guestId!,
              operation: 'update',
              annotationId: draft.annotationId,
              expectedRevision: draft.expectedCurrent.revision,
              geometry: draft.geometry,
              style: { color: draft.color },
              // There is no link editor in this panel; keep the existing link.
              commentId: draft.expectedCurrent.commentId,
            };
      const metadata = guestAnnotationJournalMetadata({
        albumId,
        expectedGuestId: current.guestId!,
        photoId,
        versionId,
        command,
        expectedCurrent: draft.expectedCurrent,
      });
      void dispatchNewIntent(metadata);
    } catch {
      setNotice('無法建立安全的標記操作識別碼；目前內容尚未送出。');
    }
  }

  function runLifecycle(
    operationName: 'resolve' | 'reopen' | 'delete',
    item: GuestSharedAnnotationItem,
  ) {
    if (
      !ready ||
      !current.canAnnotate ||
      item.authorType !== 'guest' ||
      !item.isMine ||
      item.photoId !== photoId ||
      item.versionId !== versionId ||
      operation.kind !== 'none' ||
      preparing
    ) {
      return;
    }
    const expectedCurrent = expectedCurrentFromItem(item);
    if (!expectedCurrent) {
      setNotice('此標記目前沒有可驗證的幾何資料，尚未送出。');
      return;
    }

    try {
      const requestId = newRequestId();
      const command: GuestAnnotationCommand =
        operationName === 'delete'
          ? {
              requestId,
              expectedGuestId: current.guestId!,
              operation: 'delete',
              annotationId: item.annotationId,
              expectedRevision: item.revision,
            }
          : {
              requestId,
              expectedGuestId: current.guestId!,
              operation: operationName,
              annotationId: item.annotationId,
              expectedRevision: item.revision,
            };
      const metadata = guestAnnotationJournalMetadata({
        albumId,
        expectedGuestId: current.guestId!,
        photoId,
        versionId,
        command,
        expectedCurrent,
      });
      void dispatchNewIntent(metadata);
    } catch {
      setNotice('無法建立安全的標記操作識別碼；目前狀態尚未送出。');
    }
  }

  async function retryOriginalIntent() {
    if (
      operation.kind !== 'pending' ||
      !operationScopeMatches ||
      operation.sending ||
      !ready ||
      operation.metadata.expectedGuestId !== current.guestId
    ) {
      return;
    }
    const generation = current.generation;
    if (
      operation.status === 'conflict' &&
      conflictReloadedRequestId !== operation.command.requestId
    ) {
      setNotice('衝突後請先明確重新載入目前標記，再重試原操作。');
      return;
    }

    if (commandUsesFreehandGeometry(operation.command)) {
      const enabled = await recheckFreehandWriteCapability(
        generation,
        operation.metadata.expectedGuestId,
      );
      if (!liveView(generation, operation.metadata.expectedGuestId)) return;
      if (!enabled) {
        setNotice(
          '正在用原識別碼向伺服器確認操作結果；若尚未提交，原記錄仍會保留。',
        );
      }
    }

    const claim = claimGuestAnnotationIntent(operation.metadata);
    if (!claim) {
      readGuestAnnotationJournal(operation.metadata.expectedGuestId, albumId);
      setNotice('原操作記錄已改變或無法安全取得傳送鎖；未建立新操作。');
      return;
    }

    setNotice('正在以原識別碼重試標記操作…');
    await sendClaim(operation.metadata, claim, generation);
  }

  function abandonOriginalIntent() {
    if (operation.kind !== 'pending' || operation.sending) return;
    if (!abandonGuestAnnotationIntent(operation.metadata)) {
      readGuestAnnotationJournal(operation.metadata.expectedGuestId, albumId);
      setNotice('本機操作記錄已改變；未清除任何其他標記操作。');
      return;
    }
    setDraft(null);
    setSelectedId(null);
    setDeleteConfirmId(null);
    setConflictReloadedRequestId(null);
    setNotice('原標記操作已明確放棄；請重新選取目前清單內容。');
  }

  async function loadMore() {
    if (
      !ready ||
      current.nextCursor === null ||
      current.loadingMore ||
      loadingMoreRef.current
    ) {
      return;
    }

    const cursor = current.nextCursor;
    const generation = current.generation;
    const guestId = current.guestId!;
    if (current.seenCursors.includes(cursor) || current.items.length >= 1_000) {
      setNotice('標記頁面游標或筆數已達安全上限；請明確重新載入。');
      writeSnapshot({
        ...current,
        nextCursor: null,
        moreError: true,
      });
      return;
    }

    const controller = new AbortController();
    controllersRef.current.add(controller);
    loadingMoreRef.current = true;
    writeSnapshot({ ...current, loadingMore: true, moreError: false });
    try {
      const page = await readSharedPage(
        target,
        guestId,
        controller.signal,
        freehandReadCapability,
        cursor,
      );
      if (
        controller.signal.aborted ||
        !liveView(generation, guestId) ||
        current.seenCursors.includes(cursor) ||
        page.nextCursor === cursor ||
        (page.nextCursor !== null &&
          current.seenCursors.includes(page.nextCursor))
      ) {
        if (!controller.signal.aborted && liveView(generation, guestId)) {
          const latest = snapshotRef.current;
          writeSnapshot({
            ...latest,
            loadingMore: false,
            moreError: true,
          });
          setNotice('標記頁面游標已改變；請明確重新載入目前標記。');
        }
        return;
      }

      const latest = snapshotRef.current;
      if (
        latest.status !== 'ready' ||
        latest.guestId !== guestId ||
        latest.generation !== generation
      ) {
        return;
      }
      writeSnapshot({
        ...latest,
        items: mergeItems(latest.items, page.items),
        nextCursor: page.nextCursor,
        seenCursors: [...latest.seenCursors, cursor],
        loadingMore: false,
        moreError: false,
      });
    } catch (error) {
      if (!controller.signal.aborted && liveView(generation, guestId)) {
        if (
          error instanceof ApiFailure &&
          isGuestAnnotationReadUpgradeRequired(error.statusCode, error.code)
        ) {
          setReadUpgradeRequired(guestId, generation, error);
        } else if (error instanceof ApiFailure && error.statusCode === 401) {
          clearPrivateViewAfterDenial(
            'unauthorized',
            guestId,
            generation,
            failureMessage(error),
          );
        } else if (error instanceof ApiFailure && error.statusCode === 403) {
          clearPrivateViewAfterDenial(
            'denied',
            guestId,
            generation,
            failureMessage(error),
          );
        } else {
          const latest = snapshotRef.current;
          writeSnapshot({
            ...latest,
            loadingMore: false,
            moreError: true,
          });
          setNotice(failureMessage(error));
        }
      }
    } finally {
      controllersRef.current.delete(controller);
      loadingMoreRef.current = false;
    }
  }

  const journalMatchesThisTarget =
    operation.kind === 'pending' &&
    operation.metadata.photoId === photoId &&
    operation.metadata.versionId === versionId;
  const journalMessage =
    operation.kind === 'blocked'
      ? operation.reason === 'storage'
        ? '標註復原記錄目前無法讀取或寫入；此相簿的標註操作已暫停。'
        : '標註復原記錄內容無法驗證；此相簿的標註操作已暫停，沒有覆寫或清除記錄。'
      : operation.kind === 'pending' && !journalMatchesThisTarget
        ? '另一張照片或版本有尚未確認的標註操作。請返回該照片與版本重試原操作，或明確放棄；目前不會建立新操作。'
        : operation.kind === 'pending' && operation.status === 'conflict'
          ? '原操作遇到版本衝突並保留中。請明確重新載入目前標記，再重試或放棄原操作。'
          : operation.kind === 'pending'
            ? '原標註操作尚未確認。重試會使用原識別碼與完整原指令。'
            : null;

  const versionLabel =
    versionNo === undefined ? '目前顯示版本' : '版本 ' + versionNo;

  if (
    current.key !== contextKey ||
    current.status === 'loading' ||
    current.status === 'disabled'
  ) {
    return null;
  }

  return (
    <section
      data-testid="guest-annotations-panel"
      aria-label="訪客標註"
      className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4 text-stone-900"
    >
      <header className="space-y-1">
        <h3 className="text-base font-semibold">照片標註</h3>
        <p className="text-xs text-stone-600">
          {filename} · {versionLabel}
          。可檢視同一邀請的標註；你只能編輯自己的標註。
        </p>
      </header>

      {current.status === 'unauthorized' && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p>{notice ?? '訪客工作階段已失效；目前不顯示標註。'}</p>
          <button
            type="button"
            data-testid="annotation-reload"
            onClick={() => void bootstrap(true)}
            className="min-h-10 rounded-md border border-amber-400 px-3 text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          >
            重新檢查授權並載入標記
          </button>
        </div>
      )}
      {current.status === 'denied' && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-stone-100 p-3 text-sm text-stone-700"
        >
          <p>
            {notice ??
              (isCurrentVersion === true
                ? '此邀請沒有檢視與標註目前版本的完整授權。'
                : '此版本需要獨立的比較授權與標註授權。')}
          </p>
          <button
            type="button"
            data-testid="annotation-reload"
            onClick={() => void bootstrap(true)}
            className="min-h-10 rounded-md border border-stone-400 px-3 text-xs font-medium hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-600"
          >
            重新檢查授權並載入標記
          </button>
        </div>
      )}
      {current.status === 'upgrade-required' && (
        <div
          role="alert"
          data-testid="annotation-upgrade-required"
          className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p>{notice ?? '這個標註畫面需要更新後才能安全顯示目前標記。'}</p>
          {operation.kind === 'pending' && (
            <p data-testid="annotation-upgrade-journal-preserved">
              未確認的原標註操作、識別碼與內容已保留。更新後請回到原照片與版本重新檢查；不要另建或改用其他邀請重試。
            </p>
          )}
          {operation.kind === 'blocked' && journalMessage && (
            <p data-testid="annotation-upgrade-journal-preserved">
              {journalMessage}
            </p>
          )}
          <button
            type="button"
            data-testid="annotation-reload"
            onClick={() => void bootstrap(true)}
            className="min-h-10 rounded-md border border-amber-400 px-3 text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          >
            重新檢查標註相容性
          </button>
        </div>
      )}
      {current.status === 'error' && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-900"
        >
          <p>{notice ?? '目前無法安全載入標註。'}</p>
          <button
            type="button"
            data-testid="annotation-reload"
            onClick={() => void bootstrap(true)}
            className="min-h-10 rounded-md border border-red-300 px-3 text-xs font-medium hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            重新載入目前標記
          </button>
        </div>
      )}

      {current.status === 'ready' && (
        <>
          {notice && (
            <p
              role="status"
              className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700"
            >
              {notice}
            </p>
          )}

          {journalMessage && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            >
              <p>{journalMessage}</p>
              {operation.kind === 'pending' && (
                <div className="flex flex-wrap gap-2">
                  {journalMatchesThisTarget && (
                    <>
                      <button
                        type="button"
                        data-testid="annotation-retry"
                        disabled={
                          operation.sending ||
                          (operation.status === 'conflict' &&
                            conflictReloadedRequestId !==
                              operation.command.requestId)
                        }
                        onClick={() => void retryOriginalIntent()}
                        className="min-h-10 rounded-md bg-amber-800 px-3 text-xs font-semibold text-white hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-wait disabled:opacity-50"
                      >
                        {operation.sending ? '原操作傳送中…' : '重試原標記操作'}
                      </button>
                      {operation.status === 'conflict' && (
                        <button
                          type="button"
                          data-testid="annotation-reload"
                          onClick={() => void bootstrap(true)}
                          className="min-h-10 rounded-md border border-amber-500 px-3 text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                        >
                          重新載入目前標記
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    data-testid="annotation-abandon"
                    disabled={operation.sending}
                    onClick={abandonOriginalIntent}
                    className="min-h-10 rounded-md border border-amber-500 px-3 text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-wait disabled:opacity-50"
                  >
                    放棄原操作
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3">
            {current.canAnnotate && (
              <div className="grid grid-cols-1 gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="annotation-tool-point"
                    aria-pressed={activeTool === 'point'}
                    disabled={!imageAllowed || hasSavedIntent || preparing}
                    onClick={() => setTool('point')}
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-amber-700 aria-pressed:bg-amber-50"
                  >
                    點標記
                  </button>
                  <button
                    type="button"
                    data-testid="annotation-tool-rectangle"
                    aria-pressed={activeTool === 'rectangle'}
                    disabled={!imageAllowed || hasSavedIntent || preparing}
                    onClick={() => setTool('rectangle')}
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-amber-700 aria-pressed:bg-amber-50"
                  >
                    矩形標記
                  </button>
                  {freehandControlAvailable && (
                    <button
                      type="button"
                      data-testid="annotation-tool-freehand"
                      aria-pressed={activeTool === 'freehand'}
                      disabled={!canDraw || hasSavedIntent || preparing}
                      onClick={() => setTool('freehand')}
                      className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-amber-700 aria-pressed:bg-amber-50"
                    >
                      自由筆畫
                    </button>
                  )}
                </div>

                <fieldset className="flex flex-wrap items-center gap-3">
                  <legend className="sr-only">標記顏色</legend>
                  {(
                    [
                      ['amber', '琥珀色'],
                      ['red', '紅色'],
                      ['blue', '藍色'],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-xs"
                    >
                      <input
                        type="radio"
                        name={'annotation-color-' + photoId + '-' + versionId}
                        value={value}
                        checked={color === value}
                        disabled={hasSavedIntent || preparing}
                        onChange={() => {
                          setColor(value);
                          setDraft((currentDraft) =>
                            currentDraft
                              ? { ...currentDraft, color: value }
                              : currentDraft,
                          );
                        }}
                        className="h-4 w-4 accent-amber-700"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>

                {draft && (
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                    <button
                      type="button"
                      data-testid="annotation-save"
                      disabled={
                        !canDraw || operation.kind !== 'none' || preparing
                      }
                      onClick={saveDraft}
                      className="min-h-10 rounded-md bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {preparing
                        ? '保存操作中…'
                        : draft.annotationId === null
                          ? '儲存標記'
                          : '儲存標記變更'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(null);
                        setSelectedId(null);
                        setNotice('未儲存的標記草稿已清除。');
                      }}
                      disabled={preparing}
                      className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                    >
                      清除草稿
                    </button>
                    <span className="text-xs text-stone-600">
                      {draft.annotationId === null
                        ? '新標記草稿'
                        : '正在編輯自己的標記'}
                      {' · '}
                      {draft.geometry.type === 'point'
                        ? '點'
                        : draft.geometry.type === 'freehand'
                          ? '自由筆畫'
                          : '矩形'}
                    </span>
                  </div>
                )}

                {safePreviewUrl === null && previewUrl !== null && (
                  <p
                    role="alert"
                    className="text-xs text-red-700 sm:col-span-2"
                  >
                    預覽網址不符合目前照片與版本；未載入影像或啟用幾何編輯。
                  </p>
                )}
                {imageState.status === 'error' && (
                  <p
                    role="alert"
                    className="text-xs text-red-700 sm:col-span-2"
                  >
                    預覽載入失敗；請重新檢查授權後明確載入。
                  </p>
                )}
              </div>
            )}

            {imageAllowed && (
              <AnnotationCanvas
                key={contextKey}
                previewUrl={safePreviewUrl}
                filename={filename}
                annotations={current.items}
                selectedAnnotationId={selectedId}
                draftGeometry={
                  draft?.geometry ??
                  (operation.kind === 'pending' &&
                  journalMatchesThisTarget &&
                  (operation.command.operation === 'create' ||
                    operation.command.operation === 'update')
                    ? operation.command.geometry
                    : null)
                }
                tool={canvasTool}
                freehandMode={freehandMode}
                {...(freehandScopeKey === undefined
                  ? {}
                  : { freehandScopeKey })}
                {...(freehandControlAvailable
                  ? {
                      onDraftFreehand: (stroke) => {
                        setNotice(null);
                        setDraft((currentDraft) =>
                          draftWithGuestFreehandStroke(currentDraft, stroke),
                        );
                      },
                    }
                  : {})}
                color={
                  draft?.color ??
                  (operation.kind === 'pending' &&
                  (operation.command.operation === 'create' ||
                    operation.command.operation === 'update')
                    ? operation.command.style.color
                    : color)
                }
                canDraw={canDraw}
                onDraftGeometry={(geometry) => {
                  setNotice(null);
                  setDraft((currentDraft) =>
                    currentDraft
                      ? { ...currentDraft, geometry }
                      : {
                          geometry,
                          color,
                          annotationId: null,
                          expectedCurrent: null,
                        },
                  );
                }}
                onImageState={imageStateChanged}
                onImageError={previewFailedHandler}
              />
            )}

            {!imageAllowed && current.canAnnotate && (
              <div
                data-testid="annotation-canvas"
                className="flex min-h-32 items-center justify-center rounded-lg border border-stone-300 bg-stone-950 px-4 text-center text-sm text-white/70"
              >
                {previewUrl === null
                  ? '目前版本沒有可用的授權預覽；仍可檢視同邀請標註。'
                  : previewFailed
                    ? '授權預覽已停用。重新載入權限後才會再次顯示。'
                    : '正在檢查目前照片版本的授權預覽…'}
              </div>
            )}
          </div>

          {current.canAnnotate && (
            <section aria-label="同邀請標註清單" className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">同邀請標註</h4>
                <button
                  type="button"
                  data-testid="annotation-reload"
                  onClick={() => void bootstrap(true)}
                  disabled={current.loadingMore || preparing}
                  className="min-h-9 rounded-md border border-stone-300 px-3 text-xs hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                >
                  重新載入目前標記
                </button>
              </div>
              <p className="text-xs text-stone-600">
                顯示同一邀請內的標註。你可以維護自己的標註；其他客戶的標註僅供檢視。
              </p>

              {current.items.length === 0 ? (
                <p className="rounded-md bg-white p-3 text-xs text-stone-600">
                  這個版本目前沒有同邀請標註。
                </p>
              ) : (
                <ul className="space-y-2">
                  {current.items.map((item) => (
                    <li
                      key={item.annotationId}
                      data-testid={'annotation-item-' + item.annotationId}
                      className={
                        selectedId === item.annotationId
                          ? 'rounded-lg border border-amber-600 bg-amber-50 p-3'
                          : 'rounded-lg border border-stone-200 bg-white p-3'
                      }
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <button
                          type="button"
                          aria-pressed={selectedId === item.annotationId}
                          onClick={() =>
                            setSelectedId((currentId) =>
                              currentId === item.annotationId
                                ? null
                                : item.annotationId,
                            )
                          }
                          className="min-h-10 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                        >
                          <span className="mb-1 flex flex-wrap items-center gap-2">
                            <span className="break-all text-xs text-stone-700">
                              {item.authorLabel}
                            </span>
                            <span
                              className={
                                item.authorType === 'owner'
                                  ? 'rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-900'
                                  : item.isMine
                                    ? 'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900'
                                    : 'rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700'
                              }
                            >
                              {item.authorType === 'owner'
                                ? '攝影師'
                                : item.isMine
                                  ? '我'
                                  : '同邀請客戶'}
                            </span>
                          </span>
                          <span className="block text-sm font-medium">
                            {annotationStateLabel(item.state)} · 版本修訂{' '}
                            {item.revision}
                          </span>
                          {item.authorType === 'guest' &&
                            item.processing !== null && (
                              <span
                                data-testid={
                                  'annotation-processing-' + item.annotationId
                                }
                                className="block text-xs text-violet-900"
                              >
                                攝影師處理：
                                {item.processing.state === 'open'
                                  ? '待處理'
                                  : item.processing.state === 'in_progress'
                                    ? '處理中'
                                    : '已處理'}
                                {item.processing.stale
                                  ? ' · 標記內容已更新，待重新確認'
                                  : ''}
                              </span>
                            )}
                          <span className="block break-all text-xs text-stone-600">
                            {item.geometry === null
                              ? '標記幾何已刪除'
                              : item.geometry.type === 'point'
                                ? '點標記'
                                : item.geometry.type === 'freehand'
                                  ? '自由筆畫'
                                  : '矩形標記'}
                            {item.commentId
                              ? ' · 已連結留言識別碼 ' + item.commentId
                              : ''}
                          </span>
                          {item.commentId !== null && !current.canComment && (
                            <span className="block text-xs text-amber-800">
                              編輯此連結標記需要留言授權。
                            </span>
                          )}
                        </button>

                        {item.authorType === 'guest' &&
                          item.isMine &&
                          item.state !== 'deleted' && (
                            <div className="flex flex-wrap gap-2">
                              {item.state === 'open' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={
                                      !canDraw ||
                                      hasSavedIntent ||
                                      preparing ||
                                      item.geometry === null ||
                                      item.style === null ||
                                      (item.commentId !== null &&
                                        !current.canComment)
                                    }
                                    onClick={() => {
                                      if (
                                        item.authorType !== 'guest' ||
                                        !item.isMine ||
                                        item.geometry === null ||
                                        item.style === null
                                      ) {
                                        return;
                                      }
                                      const base =
                                        expectedCurrentFromItem(item);
                                      if (!base) return;
                                      setSelectedId(item.annotationId);
                                      setColor(item.style.color);
                                      setDraft({
                                        geometry: item.geometry,
                                        color: item.style.color,
                                        annotationId: item.annotationId,
                                        expectedCurrent: base,
                                      });
                                      setNotice(
                                        '已載入自己的標記草稿；儲存前不會送出變更。',
                                      );
                                    }}
                                    className="min-h-9 rounded-md border border-stone-300 px-2.5 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                                  >
                                    編輯標記
                                  </button>
                                  <button
                                    type="button"
                                    disabled={hasSavedIntent || preparing}
                                    onClick={() =>
                                      runLifecycle('resolve', item)
                                    }
                                    className="min-h-9 rounded-md border border-emerald-700 px-2.5 text-xs text-emerald-900 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                                  >
                                    標記已處理
                                  </button>
                                </>
                              )}
                              {item.state === 'resolved' && (
                                <button
                                  type="button"
                                  disabled={hasSavedIntent || preparing}
                                  onClick={() => runLifecycle('reopen', item)}
                                  className="min-h-9 rounded-md border border-amber-700 px-2.5 text-xs text-amber-900 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                                >
                                  重新開啟
                                </button>
                              )}
                              {deleteConfirmId === item.annotationId ? (
                                <>
                                  <button
                                    type="button"
                                    data-testid="annotation-delete-confirm"
                                    disabled={hasSavedIntent || preparing}
                                    onClick={() => {
                                      setDeleteConfirmId(null);
                                      runLifecycle('delete', item);
                                    }}
                                    className="min-h-9 rounded-md bg-red-700 px-2.5 text-xs font-semibold text-white hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:opacity-50"
                                  >
                                    確認刪除標記
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="min-h-9 rounded-md border border-stone-300 px-2.5 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                                  >
                                    取消
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={hasSavedIntent || preparing}
                                  onClick={() =>
                                    setDeleteConfirmId(item.annotationId)
                                  }
                                  className="min-h-9 rounded-md border border-red-300 px-2.5 text-xs text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                                >
                                  刪除標記
                                </button>
                              )}
                            </div>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {current.moreError && (
                <p role="alert" className="text-xs text-red-700">
                  無法載入更多同邀請標註；目前已載入的列仍保留。請明確重新載入。
                </p>
              )}
              {current.nextCursor !== null && (
                <button
                  type="button"
                  data-testid="annotation-load-more"
                  disabled={current.loadingMore}
                  onClick={() => void loadMore()}
                  className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-wait disabled:opacity-50"
                >
                  {current.loadingMore ? '載入中…' : '載入更多標註'}
                </button>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
