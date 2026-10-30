'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { z } from 'zod';
import type { AnnotationGeometry } from '../../../packages/contracts/src/annotation-geometry.ts';
import type { FreehandStroke } from '../../../packages/contracts/src/freehand-stroke.ts';
import { freehandAnnotationWriteCapabilitiesSchema } from '../../../packages/contracts/src/freehand-annotation-capabilities.ts';
import {
  type OwnerAnnotationCommand,
  ownerAnnotationAuthoringCapabilitiesSchema,
  ownerAnnotationCommandSchema,
  ownerAnnotationResultSchema,
  ownerAuthoredAnnotationPageSchema,
  type OwnerAuthoredAnnotationItem,
} from '../../../packages/contracts/src/owner-annotation-authoring.ts';
import {
  type AnnotationStyle,
  type GuestAnnotationItem,
} from '../../../packages/contracts/src/guest-annotations.ts';
import {
  abandonOwnerAnnotationIntent,
  claimOwnerAnnotationIntent,
  completeOwnerAnnotationIntent,
  getOwnerAnnotationJournalSnapshot,
  isCurrentOwnerAnnotationIntent,
  markOwnerAnnotationConflict,
  markOwnerAnnotationUncertain,
  ownerAnnotationJournalMetadata,
  readOwnerAnnotationJournal,
  releaseOwnerAnnotationClaim,
  saveOwnerAnnotationIntent,
  subscribeOwnerAnnotationJournal,
  type OwnerAnnotationJournalMetadata,
  type OwnerAnnotationJournalSnapshot,
} from './owner-annotation-journal.ts';
import {
  AnnotationCanvas,
  type AnnotationCanvasImageState,
  type AnnotationTool,
} from './annotation-canvas.tsx';
import { ownerAnnotationsPath } from './owner-annotation-query.ts';
import {
  OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE,
  OWNER_FREEHAND_WRITE_DISABLED_MESSAGE,
  isOwnerAnnotationUpgradeRequired,
  isOwnerFreehandWriteDisabled,
  ownerAnnotationReadCapabilityHeaders,
} from './owner-annotation-read-support.ts';

const currentOwnerSchema = z
  .object({
    actor: z.object({ id: z.uuid() }).strict(),
    role: z.literal('owner'),
    sessionId: z.string().min(1),
  })
  .strict();

type OwnerIdentity = z.infer<typeof currentOwnerSchema>;
type EditorStatus =
  'loading' | 'ready' | 'disabled' | 'unauthorized' | 'denied' | 'error';
type EditorTarget = {
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
};
type ExpectedCurrent = {
  revision: number;
  state: 'open' | 'resolved';
  geometry: AnnotationGeometry;
  style: AnnotationStyle;
  commentId: string | null;
};
type Draft = {
  geometry: AnnotationGeometry;
  color: AnnotationStyle['color'];
  annotationId: string | null;
  expectedCurrent: ExpectedCurrent | null;
};
type EditorSnapshot = {
  key: string;
  generation: number;
  status: EditorStatus;
  featureEnabled: boolean;
  owner: OwnerIdentity | null;
  items: OwnerAuthoredAnnotationItem[];
  nextCursor: string | null;
  loadingMore: boolean;
  moreError: boolean;
};
type EditorProps = {
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  filename: string;
  previewUrl: string | null;
  freehandReadCapability?: boolean;
  onPendingChange?: (pending: boolean) => void;
  onUnauthorized?: ((status: 401 | 403) => void) | undefined;
};

const emptyJournal: OwnerAnnotationJournalSnapshot = { kind: 'none' };
const colors = {
  amber: '#d97706',
  red: '#dc2626',
  blue: '#2563eb',
} as const;

class ApiFailure extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string | null,
  ) {
    super(code ?? 'OWNER_ANNOTATIONS_REQUEST_FAILED');
  }
}

class ProtocolFailure extends Error {
  constructor() {
    super('Invalid Owner annotation response');
  }
}

function errorCode(value: unknown) {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return null;
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return null;
  return typeof error.code === 'string' ? error.code : null;
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...init.headers },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ApiFailure(response.status, errorCode(body));
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ProtocolFailure();
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiFailure || error instanceof ProtocolFailure)
      throw error;
    throw new ApiFailure(0, 'NETWORK_UNKNOWN');
  } finally {
    window.clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function editorKey(target: EditorTarget, previewUrl: string | null) {
  return JSON.stringify([
    target.albumId,
    target.inviteId,
    target.photoId,
    target.versionId,
    previewUrl,
  ]);
}

function emptySnapshot(
  key: string,
  generation: number,
  status: EditorStatus,
  featureEnabled = false,
  owner: OwnerIdentity | null = null,
): EditorSnapshot {
  return {
    key,
    generation,
    status,
    featureEnabled,
    owner,
    items: [],
    nextCursor: null,
    loadingMore: false,
    moreError: false,
  };
}

function safePreviewPath(
  input: string | null,
  photoId: string,
  versionId: string,
): string | null {
  if (input === null || typeof window === 'undefined') return null;
  try {
    const parsed = new URL(input, window.location.origin);
    const expected =
      '/api/v1/photos/' +
      encodeURIComponent(photoId) +
      '/versions/' +
      encodeURIComponent(versionId) +
      '/assets/preview';
    if (
      parsed.origin !== window.location.origin ||
      parsed.pathname !== expected ||
      parsed.search !== '' ||
      parsed.hash !== ''
    )
      return null;
    return expected;
  } catch {
    return null;
  }
}

async function readCurrentOwner(signal: AbortSignal) {
  return requestJson('/api/v1/me', currentOwnerSchema, { signal });
}

async function verifyOwner(identity: OwnerIdentity, signal: AbortSignal) {
  const current = await readCurrentOwner(signal);
  if (
    current.actor.id !== identity.actor.id ||
    current.role !== identity.role ||
    current.sessionId !== identity.sessionId
  ) {
    throw new ApiFailure(401, 'OWNER_CHANGED');
  }
}

async function readOwnerPage(
  target: EditorTarget,
  owner: OwnerIdentity,
  signal: AbortSignal,
  cursor?: string | null,
  annotationId?: string,
  freehandReadCapability = true,
) {
  await verifyOwner(owner, signal);
  const page = await requestJson(
    ownerAnnotationsPath(target, cursor, annotationId),
    ownerAuthoredAnnotationPageSchema,
    {
      signal,
      headers: ownerAnnotationReadCapabilityHeaders(freehandReadCapability),
    },
  );
  await verifyOwner(owner, signal);
  if (
    page.ownerId !== owner.actor.id ||
    page.inviteId !== target.inviteId ||
    page.photoId !== target.photoId ||
    page.versionId !== target.versionId ||
    page.items.some(
      (item) =>
        item.inviteId !== target.inviteId ||
        item.photoId !== target.photoId ||
        item.versionId !== target.versionId ||
        item.authorType !== 'owner' ||
        item.canEdit !== true,
    ) ||
    (annotationId !== undefined &&
      (page.items.length !== 1 ||
        page.items[0]?.annotationId !== annotationId ||
        page.nextCursor !== null))
  ) {
    throw new ProtocolFailure();
  }
  return page;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedCurrentFromItem(
  item: OwnerAuthoredAnnotationItem,
): ExpectedCurrent | null {
  if (
    item.authorType !== 'owner' ||
    !item.canEdit ||
    item.state === 'deleted' ||
    item.geometry === null ||
    item.style === null
  )
    return null;
  return {
    revision: item.revision,
    state: item.state,
    geometry: item.geometry,
    style: item.style,
    commentId: item.commentId,
  };
}

function validateReceipt(
  result: z.infer<typeof ownerAnnotationResultSchema>,
  metadata: OwnerAnnotationJournalMetadata,
) {
  const command = metadata.command;
  const item = result.item;
  if (
    result.ownerId !== metadata.ownerId ||
    result.requestId !== command.requestId ||
    result.operation !== command.operation ||
    item.inviteId !== metadata.inviteId ||
    item.photoId !== metadata.photoId ||
    item.versionId !== metadata.versionId ||
    item.authorType !== 'owner' ||
    item.canEdit !== true
  )
    throw new ProtocolFailure();

  if (command.operation === 'create') {
    if (
      item.revision !== 1 ||
      item.state !== 'open' ||
      !sameJson(item.geometry, command.geometry) ||
      !sameJson(item.style, command.style) ||
      item.commentId !== command.commentId
    )
      throw new ProtocolFailure();
    return;
  }

  const expected = metadata.expectedCurrent;
  if (
    !expected ||
    item.annotationId !== command.annotationId ||
    item.revision !== command.expectedRevision + 1
  )
    throw new ProtocolFailure();

  if (command.operation === 'update') {
    if (
      item.state !== 'open' ||
      !sameJson(item.geometry, command.geometry) ||
      !sameJson(item.style, command.style) ||
      item.commentId !== expected.commentId
    )
      throw new ProtocolFailure();
    return;
  }

  if (command.operation === 'delete') {
    if (
      item.state !== 'deleted' ||
      item.geometry !== null ||
      item.style !== null ||
      item.commentId !== null
    )
      throw new ProtocolFailure();
    return;
  }

  const expectedState = command.operation === 'resolve' ? 'resolved' : 'open';
  if (
    item.state !== expectedState ||
    !sameJson(item.geometry, expected.geometry) ||
    !sameJson(item.style, expected.style) ||
    item.commentId !== expected.commentId
  )
    throw new ProtocolFailure();
}

function mergeItems(
  existing: OwnerAuthoredAnnotationItem[],
  incoming: OwnerAuthoredAnnotationItem[],
) {
  const result = [...existing];
  for (const item of incoming) {
    const index = result.findIndex(
      (current) => current.annotationId === item.annotationId,
    );
    if (index === -1) result.push(item);
    else if (result[index]!.revision <= item.revision) result[index] = item;
  }
  return result;
}

function canvasItems(
  items: OwnerAuthoredAnnotationItem[],
): GuestAnnotationItem[] {
  return items.map((item) => ({
    annotationId: item.annotationId,
    photoId: item.photoId,
    versionId: item.versionId,
    revision: item.revision,
    geometry: item.geometry,
    style: item.style,
    commentId: item.commentId,
    state: item.state,
    authorLabel: item.authorLabel,
    // AnnotationCanvas consumes this as a geometry view only. Owner RPCs and
    // ownership checks stay in this component's Owner-specific contracts.
    isMine: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
}

function stateLabel(state: OwnerAuthoredAnnotationItem['state']) {
  if (state === 'deleted') return '已刪除';
  if (state === 'resolved') return '已處理';
  return '待處理';
}

function errorMessage(error: unknown) {
  if (error instanceof ApiFailure) {
    if (error.statusCode === 401) return '登入狀態已失效；標記資料已隱藏。';
    if (error.statusCode === 403)
      return '目前帳號無法讀取這組標記；資料已隱藏。';
    if (isOwnerAnnotationUpgradeRequired(error))
      return OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE;
    if (isOwnerFreehandWriteDisabled(error))
      return OWNER_FREEHAND_WRITE_DISABLED_MESSAGE;
    if (error.statusCode === 409)
      return '標記已在其他操作中變更。原操作仍保留，請明確重新載入。';
    if (error.statusCode === 0)
      return '目前無法確認標記操作結果；原操作已保留，可重試相同操作。';
  }
  return '目前無法安全讀取標記；原操作仍保留。';
}

export function OwnerAnnotationEditor({
  albumId,
  inviteId,
  photoId,
  versionId,
  filename,
  previewUrl,
  freehandReadCapability = true,
  onPendingChange,
  onUnauthorized,
}: EditorProps) {
  const target = useMemo(
    () => ({ albumId, inviteId, photoId, versionId }),
    [albumId, inviteId, photoId, versionId],
  );
  const contextKey = editorKey(target, previewUrl);
  const safePreviewUrl = safePreviewPath(previewUrl, photoId, versionId);
  const [snapshot, setSnapshot] = useState<EditorSnapshot>(() =>
    emptySnapshot(contextKey, 0, 'loading'),
  );
  const snapshotRef = useRef(snapshot);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<AnnotationTool>('point');
  const [freehandMode, setFreehandMode] = useState(false);
  const [allowFreehand, setAllowFreehand] = useState(false);
  const [color, setColor] = useState<AnnotationStyle['color']>('amber');
  const [notice, setNotice] = useState<string | null>(null);
  const [imageState, setImageState] = useState<AnnotationCanvasImageState>({
    status: 'empty',
  });
  const [previewFailed, setPreviewFailed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const [conflictReloadedRequestId, setConflictReloadedRequestId] = useState<
    string | null
  >(null);
  const [journalScopeLoaded, setJournalScopeLoaded] = useState('');
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeKeyRef = useRef(contextKey);
  const latestKeyRef = useRef(contextKey);
  const ownerRef = useRef<OwnerIdentity | null>(null);
  const lastOwnerIdRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const visibleRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());
  const loadingMoreRef = useRef(false);
  const pendingCallbackRef = useRef(onPendingChange);
  const unauthorizedCallbackRef = useRef(onUnauthorized);
  const lastPendingReportRef = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    latestKeyRef.current = contextKey;
    pendingCallbackRef.current = onPendingChange;
    unauthorizedCallbackRef.current = onUnauthorized;
  }, [contextKey, onPendingChange, onUnauthorized]);

  const writeSnapshot = useCallback((next: EditorSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const current =
    snapshot.key === contextKey
      ? snapshot
      : emptySnapshot(contextKey, 0, 'loading');
  const journalOwnerId = current.owner?.actor.id ?? '';
  const subscribeJournal = useCallback(
    (listener: () => void) =>
      journalOwnerId
        ? subscribeOwnerAnnotationJournal(journalOwnerId, albumId, listener)
        : () => undefined,
    [albumId, journalOwnerId],
  );
  const getJournalSnapshot = useCallback(
    () =>
      journalOwnerId
        ? getOwnerAnnotationJournalSnapshot(journalOwnerId, albumId)
        : emptyJournal,
    [albumId, journalOwnerId],
  );
  const journal = useSyncExternalStore(
    subscribeJournal,
    getJournalSnapshot,
    () => emptyJournal,
  );

  const contextGenerationIsCurrent = useCallback(
    (generation: number) =>
      mountedRef.current &&
      latestKeyRef.current === contextKey &&
      activeKeyRef.current === contextKey &&
      activeGenerationRef.current === generation &&
      snapshotRef.current.key === contextKey &&
      snapshotRef.current.generation === generation &&
      visibleRef.current &&
      document.visibilityState !== 'hidden',
    [contextKey],
  );

  const abortReads = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
    loadingMoreRef.current = false;
  }, []);

  const clearPrivateLocalState = useCallback(() => {
    setDraft(null);
    setSelectedId(null);
    setFreehandMode(false);
    setImageState({ status: 'empty' });
    setPreviewFailed(false);
    setAbandonArmed(false);
    setConflictReloadedRequestId(null);
  }, []);

  const [previousFreehandCapability, setPreviousFreehandCapability] =
    useState(allowFreehand);
  if (previousFreehandCapability !== allowFreehand) {
    setPreviousFreehandCapability(allowFreehand);
    if (!allowFreehand) {
      setFreehandMode(false);
      setDraft((existing) =>
        existing?.geometry.type === 'freehand' ? null : existing,
      );
    }
  }

  const bootstrap = useCallback(
    async (explicitReload = false) => {
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      activeGenerationRef.current = generation;
      activeKeyRef.current = contextKey;
      abortReads();
      ownerRef.current = null;
      writeSnapshot(emptySnapshot(contextKey, generation, 'loading'));
      clearPrivateLocalState();
      setNotice(null);
      setPreparing(false);
      setAllowFreehand(false);
      if (document.visibilityState === 'hidden') return false;

      const controller = new AbortController();
      controllersRef.current.add(controller);
      const active = () =>
        !controller.signal.aborted && contextGenerationIsCurrent(generation);
      let capabilityEnabled = false;
      let owner: OwnerIdentity | null = null;
      try {
        const [capability, freehandWriteCapability] = await Promise.all([
          requestJson(
            '/api/v1/annotations/authoring/capabilities',
            ownerAnnotationAuthoringCapabilitiesSchema,
            { signal: controller.signal },
          ),
          requestJson(
            '/api/v1/annotations/authoring/freehand-capabilities',
            freehandAnnotationWriteCapabilitiesSchema,
            { signal: controller.signal },
          ).catch((error: unknown) => {
            if (
              error instanceof ApiFailure &&
              (error.statusCode === 401 || error.statusCode === 403)
            )
              throw error;
            return null;
          }),
        ]);
        if (!active()) return false;
        if (!capability.enabled) {
          setAllowFreehand(false);
          writeSnapshot(emptySnapshot(contextKey, generation, 'disabled'));
          return false;
        }
        setAllowFreehand(freehandWriteCapability?.enabled === true);
        capabilityEnabled = true;
        writeSnapshot(emptySnapshot(contextKey, generation, 'loading', true));
        owner = await readCurrentOwner(controller.signal);
        if (!active()) return false;
        if (
          lastOwnerIdRef.current !== null &&
          lastOwnerIdRef.current !== owner.actor.id
        ) {
          writeSnapshot(
            emptySnapshot(contextKey, generation, 'unauthorized', true),
          );
          clearPrivateLocalState();
          setNotice('Owner 登入身分已變更；目前註記與預覽已隱藏。');
          pendingCallbackRef.current?.(false);
          lastPendingReportRef.current = false;
          unauthorizedCallbackRef.current?.(401);
          return false;
        }
        lastOwnerIdRef.current = owner.actor.id;
        ownerRef.current = owner;
        readOwnerAnnotationJournal(owner.actor.id, albumId);
        setJournalScopeLoaded(JSON.stringify([owner.actor.id, albumId]));
        writeSnapshot(
          emptySnapshot(contextKey, generation, 'loading', true, owner),
        );

        const page = await readOwnerPage(
          target,
          owner,
          controller.signal,
          null,
          undefined,
          freehandReadCapability,
        );
        if (!active()) return false;
        let items = page.items;
        const recovered = readOwnerAnnotationJournal(owner.actor.id, albumId);
        const recoveredMatchesTarget =
          explicitReload &&
          recovered.kind === 'pending' &&
          recovered.metadata.inviteId === inviteId &&
          recovered.metadata.photoId === photoId &&
          recovered.metadata.versionId === versionId;
        let recoveryReloaded = false;
        if (
          recoveredMatchesTarget &&
          recovered.kind === 'pending' &&
          recovered.command.operation !== 'create'
        ) {
          if (!isCurrentOwnerAnnotationIntent(recovered.metadata)) return false;
          const currentPage = await readOwnerPage(
            target,
            owner,
            controller.signal,
            null,
            recovered.command.annotationId,
            freehandReadCapability,
          );
          if (
            !active() ||
            !isCurrentOwnerAnnotationIntent(recovered.metadata) ||
            currentPage.items.length !== 1
          )
            return false;
          items = mergeItems(items, currentPage.items);
          recoveryReloaded = true;
        } else if (
          recoveredMatchesTarget &&
          recovered.kind === 'pending' &&
          recovered.command.operation === 'create' &&
          isCurrentOwnerAnnotationIntent(recovered.metadata)
        ) {
          recoveryReloaded = true;
        }
        if (
          recoveryReloaded &&
          recovered.kind === 'pending' &&
          recovered.status === 'conflict'
        )
          setConflictReloadedRequestId(recovered.command.requestId);
        writeSnapshot({
          key: contextKey,
          generation,
          status: 'ready',
          featureEnabled: true,
          owner,
          items,
          nextCursor: page.nextCursor,
          loadingMore: false,
          moreError: false,
        });
        return true;
      } catch (error) {
        if (!active()) return false;
        const status =
          error instanceof ApiFailure && error.statusCode === 401
            ? 'unauthorized'
            : error instanceof ApiFailure && error.statusCode === 403
              ? 'denied'
              : 'error';
        writeSnapshot(
          emptySnapshot(
            contextKey,
            generation,
            status,
            capabilityEnabled,
            status === 'error' ? owner : null,
          ),
        );
        clearPrivateLocalState();
        setNotice(errorMessage(error));
        if (status === 'unauthorized' || status === 'denied') {
          ownerRef.current = null;
          pendingCallbackRef.current?.(false);
          lastPendingReportRef.current = false;
          unauthorizedCallbackRef.current?.(
            status === 'unauthorized' ? 401 : 403,
          );
        }
        return false;
      } finally {
        controllersRef.current.delete(controller);
      }
    },
    [
      abortReads,
      albumId,
      clearPrivateLocalState,
      contextGenerationIsCurrent,
      contextKey,
      freehandReadCapability,
      inviteId,
      photoId,
      target,
      versionId,
      writeSnapshot,
    ],
  );

  const suspend = useCallback(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeGenerationRef.current = generation;
    activeKeyRef.current = contextKey;
    abortReads();
    ownerRef.current = null;
    setAllowFreehand(false);
    writeSnapshot(emptySnapshot(contextKey, generation, 'loading'));
    clearPrivateLocalState();
    setNotice(null);
    setPreparing(false);
  }, [abortReads, clearPrivateLocalState, contextKey, writeSnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    const resume = () => {
      visibleRef.current = document.visibilityState !== 'hidden';
      if (visibleRef.current) void bootstrap();
      else suspend();
    };
    const hide = () => {
      visibleRef.current = false;
      suspend();
    };
    const visibility = () =>
      document.visibilityState === 'hidden' ? hide() : resume();

    if (document.visibilityState === 'hidden') hide();
    else {
      visibleRef.current = true;
      void bootstrap();
    }
    window.addEventListener('blur', hide);
    window.addEventListener('focus', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', visibility);
      mountedRef.current = false;
      visibleRef.current = false;
      generationRef.current += 1;
      activeGenerationRef.current = generationRef.current;
      abortReads();
      ownerRef.current = null;
    };
  }, [abortReads, bootstrap, suspend]);

  const currentJournal = journal;
  const hasIntent = currentJournal.kind !== 'none';
  const draftAvailable =
    draft !== null && (allowFreehand || draft.geometry.type !== 'freehand');
  const hasDraft = draftAvailable;
  const journalScopeReady =
    current.owner !== null &&
    journalScopeLoaded === JSON.stringify([current.owner.actor.id, albumId]);
  const canReportPending =
    current.featureEnabled &&
    current.status !== 'disabled' &&
    current.status !== 'unauthorized' &&
    current.status !== 'denied';
  const pending =
    canReportPending && (!journalScopeReady || hasIntent || hasDraft);
  useEffect(() => {
    const reported = pending ? true : false;
    if (lastPendingReportRef.current !== reported) {
      pendingCallbackRef.current?.(reported);
      lastPendingReportRef.current = reported;
    }
  }, [pending]);

  const ready =
    current.key === contextKey &&
    current.status === 'ready' &&
    current.owner !== null;
  const sameView = useCallback(
    (generation: number, owner: OwnerIdentity) => {
      const latest = snapshotRef.current;
      return (
        contextGenerationIsCurrent(generation) &&
        latest.status === 'ready' &&
        latest.owner?.actor.id === owner.actor.id &&
        latest.owner.sessionId === owner.sessionId
      );
    },
    [contextGenerationIsCurrent],
  );

  const clearPrivateViewAfterDenial = useCallback(
    (
      status: 'unauthorized' | 'denied',
      owner: OwnerIdentity,
      generation: number,
      message: string,
      metadata?: OwnerAnnotationJournalMetadata,
    ) => {
      if (!contextGenerationIsCurrent(generation)) return false;
      const latest = snapshotRef.current;
      if (
        latest.status !== 'ready' ||
        latest.owner?.actor.id !== owner.actor.id ||
        latest.owner.sessionId !== owner.sessionId ||
        latest.generation !== generation ||
        latest.key !== contextKey ||
        (metadata !== undefined &&
          (!isCurrentOwnerAnnotationIntent(metadata) ||
            metadata.ownerId !== owner.actor.id ||
            metadata.albumId !== albumId ||
            metadata.inviteId !== inviteId ||
            metadata.photoId !== photoId ||
            metadata.versionId !== versionId))
      )
        return false;

      abortReads();
      ownerRef.current = null;
      writeSnapshot(
        emptySnapshot(contextKey, generation, status, latest.featureEnabled),
      );
      clearPrivateLocalState();
      setNotice(message);
      pendingCallbackRef.current?.(false);
      lastPendingReportRef.current = false;
      unauthorizedCallbackRef.current?.(status === 'unauthorized' ? 401 : 403);
      return true;
    },
    [
      abortReads,
      albumId,
      clearPrivateLocalState,
      contextGenerationIsCurrent,
      contextKey,
      inviteId,
      photoId,
      versionId,
      writeSnapshot,
    ],
  );

  const imageAllowed = ready && safePreviewUrl !== null && !previewFailed;
  const canDraw =
    imageAllowed &&
    imageState.status === 'ready' &&
    currentJournal.kind === 'none' &&
    !preparing;
  const journalMatchesTarget =
    currentJournal.kind === 'pending' &&
    currentJournal.metadata.ownerId === current.owner?.actor.id &&
    currentJournal.metadata.albumId === albumId &&
    currentJournal.metadata.inviteId === inviteId &&
    currentJournal.metadata.photoId === photoId &&
    currentJournal.metadata.versionId === versionId;
  const draftGeometry =
    (draftAvailable ? draft?.geometry : null) ??
    (currentJournal.kind === 'pending' &&
    journalMatchesTarget &&
    (currentJournal.command.operation === 'create' ||
      currentJournal.command.operation === 'update')
      ? currentJournal.command.geometry
      : null);
  const canvasColor =
    (draftAvailable ? draft?.color : null) ??
    (currentJournal.kind === 'pending' &&
    journalMatchesTarget &&
    (currentJournal.command.operation === 'create' ||
      currentJournal.command.operation === 'update')
      ? currentJournal.command.style.color
      : color);

  const imageStateChanged = useCallback(
    (state: AnnotationCanvasImageState) => {
      if (latestKeyRef.current === contextKey) setImageState(state);
    },
    [contextKey],
  );

  const imageFailed = useCallback(() => {
    if (latestKeyRef.current !== contextKey) return;
    setPreviewFailed(true);
    setDraft(null);
    setSelectedId(null);
    setImageState({ status: 'error' });
    setNotice('目前無法載入授權的照片預覽；標註資料仍可重新載入。');
  }, [contextKey]);

  const readCurrent = useCallback(
    async (owner: OwnerIdentity, signal: AbortSignal, annotationId?: string) =>
      readOwnerPage(
        target,
        owner,
        signal,
        null,
        annotationId,
        freehandReadCapability,
      ),
    [freehandReadCapability, target],
  );

  const loadMore = useCallback(async () => {
    const owner = current.owner;
    const cursor = current.nextCursor;
    const generation = current.generation;
    if (
      !ready ||
      !owner ||
      !cursor ||
      current.loadingMore ||
      loadingMoreRef.current
    )
      return;
    const controller = new AbortController();
    controllersRef.current.add(controller);
    loadingMoreRef.current = true;
    writeSnapshot({ ...current, loadingMore: true, moreError: false });
    try {
      const page = await readOwnerPage(
        target,
        owner,
        controller.signal,
        cursor,
        undefined,
        freehandReadCapability,
      );
      if (controller.signal.aborted || !sameView(generation, owner)) return;
      if (page.nextCursor === cursor) throw new ProtocolFailure();
      const latest = snapshotRef.current;
      if (latest.nextCursor !== cursor) return;
      const known = new Set(latest.items.map((item) => item.annotationId));
      if (page.items.some((item) => known.has(item.annotationId)))
        throw new ProtocolFailure();
      writeSnapshot({
        ...latest,
        items: [...latest.items, ...page.items],
        nextCursor: page.nextCursor,
        loadingMore: false,
        moreError: false,
      });
    } catch (error) {
      if (controller.signal.aborted || !sameView(generation, owner)) return;
      if (
        error instanceof ApiFailure &&
        (error.statusCode === 401 || error.statusCode === 403)
      ) {
        clearPrivateViewAfterDenial(
          error.statusCode === 401 ? 'unauthorized' : 'denied',
          owner,
          generation,
          errorMessage(error),
        );
      } else if (isOwnerAnnotationUpgradeRequired(error)) {
        writeSnapshot(
          emptySnapshot(contextKey, generation, 'error', true, owner),
        );
        clearPrivateLocalState();
        setNotice(OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE);
      } else {
        writeSnapshot({
          ...snapshotRef.current,
          loadingMore: false,
          moreError: true,
        });
        setNotice(errorMessage(error));
      }
    } finally {
      controllersRef.current.delete(controller);
      loadingMoreRef.current = false;
    }
  }, [
    clearPrivateLocalState,
    clearPrivateViewAfterDenial,
    current,
    contextKey,
    freehandReadCapability,
    ready,
    sameView,
    target,
    writeSnapshot,
  ]);

  const sendClaim = useCallback(
    async (
      metadata: OwnerAnnotationJournalMetadata,
      claim: NonNullable<ReturnType<typeof claimOwnerAnnotationIntent>>,
      owner: OwnerIdentity,
      generation: number,
    ) => {
      const controller = new AbortController();
      controllersRef.current.add(controller);
      let receipt: z.infer<typeof ownerAnnotationResultSchema> | null = null;
      let currentItem: OwnerAuthoredAnnotationItem | null = null;
      let requestError: unknown = null;
      try {
        if (
          metadata.ownerId !== owner.actor.id ||
          metadata.albumId !== albumId ||
          metadata.inviteId !== inviteId ||
          metadata.photoId !== photoId ||
          metadata.versionId !== versionId ||
          !isCurrentOwnerAnnotationIntent(metadata)
        )
          return;
        await verifyOwner(owner, controller.signal);
        const result = await requestJson(
          '/api/v1/albums/' +
            encodeURIComponent(albumId) +
            '/annotations/owner/commands',
          ownerAnnotationResultSchema,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(claim.command),
            signal: controller.signal,
          },
        );
        await verifyOwner(owner, controller.signal);
        validateReceipt(result, metadata);
        if (!sameView(generation, owner)) return;

        const page = await readCurrent(
          owner,
          controller.signal,
          result.item.annotationId,
        );
        if (
          page.items.length !== 1 ||
          page.items[0]?.annotationId !== result.item.annotationId
        )
          throw new ProtocolFailure();
        const authoritative = page.items[0]!;
        if (authoritative.revision < result.item.revision)
          throw new ProtocolFailure();
        if (
          authoritative.revision === result.item.revision &&
          !sameJson(authoritative, result.item)
        )
          throw new ProtocolFailure();
        if (!sameView(generation, owner)) return;
        receipt = result;
        currentItem = authoritative;
      } catch (error) {
        requestError = error;
      } finally {
        controllersRef.current.delete(controller);
        releaseOwnerAnnotationClaim(claim);
      }

      if (!sameView(generation, owner)) return;
      if (requestError !== null) {
        const freehandWriteDisabled =
          isOwnerFreehandWriteDisabled(requestError);
        if (
          requestError instanceof ApiFailure &&
          requestError.statusCode === 409 &&
          !freehandWriteDisabled
        ) {
          if (!markOwnerAnnotationConflict(metadata)) return;
          if (!isCurrentOwnerAnnotationIntent(metadata)) return;
          setConflictReloadedRequestId(null);
          setNotice(errorMessage(requestError));
          return;
        }
        if (!markOwnerAnnotationUncertain(metadata)) return;
        if (!isCurrentOwnerAnnotationIntent(metadata)) return;
        if (
          requestError instanceof ApiFailure &&
          (requestError.statusCode === 401 || requestError.statusCode === 403)
        ) {
          clearPrivateViewAfterDenial(
            requestError.statusCode === 401 ? 'unauthorized' : 'denied',
            owner,
            generation,
            errorMessage(requestError),
            metadata,
          );
          return;
        }
        setNotice(errorMessage(requestError));
        return;
      }

      if (!receipt || !currentItem) {
        if (!markOwnerAnnotationUncertain(metadata)) return;
        if (!isCurrentOwnerAnnotationIntent(metadata)) return;
        setNotice('目前標記尚未讀回確認；原操作已保留，請重試相同操作。');
        return;
      }
      if (
        !isCurrentOwnerAnnotationIntent(metadata) ||
        !sameView(generation, owner) ||
        !completeOwnerAnnotationIntent(metadata)
      )
        return;

      const latest = snapshotRef.current;
      writeSnapshot({
        ...latest,
        items: mergeItems(latest.items, [currentItem]),
      });
      if (currentItem.state === 'deleted') {
        setSelectedId((value) =>
          value === currentItem!.annotationId ||
          metadata.command.operation === 'create'
            ? null
            : value,
        );
        setDraft((value) =>
          value?.annotationId === currentItem!.annotationId ||
          metadata.command.operation === 'create'
            ? null
            : value,
        );
      } else if (metadata.command.operation === 'create') {
        setSelectedId(currentItem.annotationId);
        setDraft(null);
      } else if (metadata.command.operation === 'update') {
        setSelectedId(currentItem.annotationId);
        setDraft(null);
      }
      setConflictReloadedRequestId(null);
      setAbandonArmed(false);
      setNotice('標記已由目前 Owner 清單確認。');
    },
    [
      albumId,
      clearPrivateViewAfterDenial,
      inviteId,
      photoId,
      readCurrent,
      sameView,
      versionId,
      writeSnapshot,
    ],
  );

  const dispatchIntent = useCallback(
    async (metadata: OwnerAnnotationJournalMetadata) => {
      if (
        !ready ||
        !current.owner ||
        !current.featureEnabled ||
        metadata.ownerId !== current.owner.actor.id ||
        metadata.albumId !== albumId
      )
        return;
      const saved = saveOwnerAnnotationIntent(metadata);
      if (!saved.ok) {
        readOwnerAnnotationJournal(metadata.ownerId, albumId);
        setNotice(
          saved.reason === 'storage'
            ? '本機恢復記錄無法安全寫入；標記尚未送出。'
            : saved.reason === 'invalid'
              ? '標記操作內容無效；尚未送出。'
              : '已有一筆標記操作或恢復記錄；請先重試、重新載入或明確放棄。',
        );
        return;
      }
      const claim = claimOwnerAnnotationIntent(metadata);
      if (!claim) {
        setNotice('無法取得原標記操作的傳送鎖；操作仍保留。');
        return;
      }
      setNotice('正在傳送已記錄的 Owner 標記操作…');
      await sendClaim(metadata, claim, current.owner, current.generation);
    },
    [albumId, current, ready, sendClaim],
  );

  const saveDraft = useCallback(() => {
    const owner = current.owner;
    if (
      !ready ||
      !owner ||
      !draft ||
      !canDraw ||
      (!allowFreehand && draft.geometry.type === 'freehand') ||
      currentJournal.kind !== 'none' ||
      preparing
    )
      return;
    try {
      const requestId = crypto.randomUUID().toLowerCase();
      let command: OwnerAnnotationCommand;
      if (draft.annotationId === null) {
        command = ownerAnnotationCommandSchema.parse({
          requestId,
          expectedOwnerId: owner.actor.id,
          inviteId,
          photoId,
          versionId,
          operation: 'create',
          geometry: draft.geometry,
          style: { color: draft.color },
          commentId: null,
        });
      } else {
        const expected = draft.expectedCurrent;
        if (!expected) return;
        command = ownerAnnotationCommandSchema.parse({
          requestId,
          expectedOwnerId: owner.actor.id,
          inviteId,
          photoId,
          versionId,
          operation: 'update',
          annotationId: draft.annotationId,
          expectedRevision: expected.revision,
          geometry: draft.geometry,
          style: { color: draft.color },
          commentId: expected.commentId,
        });
      }
      const metadata = ownerAnnotationJournalMetadata({
        ownerId: owner.actor.id,
        albumId,
        inviteId,
        photoId,
        versionId,
        command,
        expectedCurrent: draft.expectedCurrent,
      });
      setPreparing(true);
      void dispatchIntent(metadata).finally(() => setPreparing(false));
    } catch {
      setNotice('無法建立安全的 Owner 標記操作識別碼；內容尚未送出。');
    }
  }, [
    albumId,
    allowFreehand,
    canDraw,
    current,
    currentJournal.kind,
    dispatchIntent,
    draft,
    inviteId,
    photoId,
    preparing,
    ready,
    versionId,
  ]);

  const runLifecycle = useCallback(
    (
      operation: 'delete' | 'resolve' | 'reopen',
      item: OwnerAuthoredAnnotationItem,
    ) => {
      const owner = current.owner;
      if (
        !ready ||
        !owner ||
        !item.canEdit ||
        item.authorType !== 'owner' ||
        item.inviteId !== inviteId ||
        item.photoId !== photoId ||
        item.versionId !== versionId ||
        item.state === 'deleted' ||
        currentJournal.kind !== 'none' ||
        preparing
      )
        return;
      const expectedCurrent = expectedCurrentFromItem(item);
      if (!expectedCurrent) return;
      try {
        const command = ownerAnnotationCommandSchema.parse({
          requestId: crypto.randomUUID().toLowerCase(),
          expectedOwnerId: owner.actor.id,
          inviteId,
          photoId,
          versionId,
          operation,
          annotationId: item.annotationId,
          expectedRevision: item.revision,
        });
        const metadata = ownerAnnotationJournalMetadata({
          ownerId: owner.actor.id,
          albumId,
          inviteId,
          photoId,
          versionId,
          command,
          expectedCurrent,
        });
        setPreparing(true);
        void dispatchIntent(metadata).finally(() => setPreparing(false));
      } catch {
        setNotice('無法建立安全的 Owner 標記操作識別碼；尚未送出。');
      }
    },
    [
      albumId,
      current,
      currentJournal.kind,
      dispatchIntent,
      inviteId,
      photoId,
      preparing,
      ready,
      versionId,
    ],
  );

  const retryOriginalIntent = useCallback(async () => {
    if (
      currentJournal.kind !== 'pending' ||
      currentJournal.sending ||
      !ready ||
      !current.owner ||
      !journalMatchesTarget ||
      (currentJournal.status === 'conflict' &&
        conflictReloadedRequestId !== currentJournal.command.requestId)
    )
      return;
    const claim = claimOwnerAnnotationIntent(currentJournal.metadata);
    if (!claim) {
      setNotice('本機恢復記錄已改變；沒有傳送其他標記操作。');
      return;
    }
    await sendClaim(
      currentJournal.metadata,
      claim,
      current.owner,
      current.generation,
    );
  }, [
    conflictReloadedRequestId,
    current,
    currentJournal,
    journalMatchesTarget,
    ready,
    sendClaim,
  ]);

  const abandonIntent = useCallback(() => {
    if (
      currentJournal.kind !== 'pending' ||
      currentJournal.sending ||
      !ready ||
      !current.owner ||
      currentJournal.metadata.ownerId !== current.owner.actor.id ||
      currentJournal.metadata.albumId !== albumId
    )
      return;
    if (!abandonArmed) {
      setAbandonArmed(true);
      return;
    }
    if (!abandonOwnerAnnotationIntent(currentJournal.metadata)) {
      readOwnerAnnotationJournal(current.owner.actor.id, albumId);
      setNotice('本機恢復記錄已改變；未清除任何其他標記操作。');
      return;
    }
    setDraft(null);
    setSelectedId(null);
    setAbandonArmed(false);
    setConflictReloadedRequestId(null);
    setNotice('已明確放棄原標記操作；沒有建立替代操作。');
  }, [abandonArmed, albumId, current.owner, currentJournal, ready]);

  const startEdit = useCallback(
    (item: OwnerAuthoredAnnotationItem) => {
      if (
        !ready ||
        !item.canEdit ||
        item.authorType !== 'owner' ||
        item.inviteId !== inviteId ||
        item.photoId !== photoId ||
        item.versionId !== versionId ||
        item.state !== 'open' ||
        item.geometry === null ||
        item.style === null ||
        currentJournal.kind !== 'none' ||
        !canDraw
      )
        return;
      const expectedCurrent = expectedCurrentFromItem(item);
      if (!expectedCurrent) return;
      setSelectedId(item.annotationId);
      setColor(item.style.color);
      setDraft({
        geometry: item.geometry,
        color: item.style.color,
        annotationId: item.annotationId,
        expectedCurrent,
      });
      setNotice(
        item.commentId === null
          ? '已載入 Owner 標記草稿；儲存前不會送出變更。'
          : '已載入 Owner 標記草稿；儲存時會保留原留言連結。',
      );
    },
    [canDraw, currentJournal.kind, inviteId, photoId, ready, versionId],
  );

  const currentJournalMessage =
    currentJournal.kind === 'blocked'
      ? currentJournal.reason === 'storage'
        ? '本機 Owner 標記恢復記錄目前無法安全讀取或寫入；新操作已暫停。'
        : '本機 Owner 標記恢復記錄無法驗證；未覆寫或清除任何操作。'
      : currentJournal.kind === 'pending' && !journalMatchesTarget
        ? '另一個邀請、照片或版本有尚未確認的 Owner 標記操作。請先返回原目標重試，或明確放棄。'
        : currentJournal.kind === 'pending' &&
            currentJournal.status === 'conflict'
          ? '原 Owner 標記操作遇到版本衝突並已保留。請明確重新載入目前標記，再重試或放棄。'
          : currentJournal.kind === 'pending'
            ? 'Owner 標記操作尚未確認；重試會使用原識別碼與完整指令。'
            : null;

  const currentImageAllowed = imageAllowed && current.status === 'ready';
  const adaptedItems = useMemo(
    () => canvasItems(current.items),
    [current.items],
  );
  if (current.key !== contextKey || current.status === 'loading') return null;
  if (current.status === 'disabled') return null;

  return (
    <section
      data-testid="owner-annotation-editor"
      aria-label={'Owner 照片標記：' + filename}
      className="space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-4 text-stone-900"
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold">Owner 標記</h3>
          {ready && (
            <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-800">
              Owner 帳號已確認
            </span>
          )}
        </div>
        <p className="text-xs text-stone-600">
          {filename} · 此標記屬於目前 Owner 帳號，並只套用到選取的邀請與版本。
        </p>
      </header>

      {(current.status === 'unauthorized' || current.status === 'denied') && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p>{notice ?? 'Owner 登入或權限已失效；標記資料已隱藏。'}</p>
          <button
            type="button"
            data-testid="owner-annotation-reload"
            onClick={() => void bootstrap(true)}
            className="min-h-10 rounded-md border border-amber-500 px-3 text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
          >
            重新確認 Owner 並載入標記
          </button>
        </div>
      )}
      {current.status === 'error' && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-900"
        >
          <p>{notice ?? '目前無法安全載入 Owner 標記。'}</p>
          <button
            type="button"
            data-testid="owner-annotation-reload"
            onClick={() => void bootstrap(true)}
            className="min-h-10 rounded-md border border-red-300 px-3 text-xs font-medium hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
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

          {currentJournalMessage && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
            >
              <p>{currentJournalMessage}</p>
              {currentJournal.kind === 'pending' && (
                <div className="flex flex-wrap gap-2">
                  {journalMatchesTarget && (
                    <>
                      <button
                        type="button"
                        data-testid="owner-annotation-retry"
                        disabled={
                          currentJournal.sending ||
                          (currentJournal.status === 'conflict' &&
                            conflictReloadedRequestId !==
                              currentJournal.command.requestId)
                        }
                        onClick={() => void retryOriginalIntent()}
                        className="min-h-10 rounded-md bg-amber-800 px-3 text-xs font-semibold text-white hover:bg-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:cursor-wait disabled:opacity-50"
                      >
                        {currentJournal.sending
                          ? '原操作傳送中…'
                          : '重試原標記操作'}
                      </button>
                      {currentJournal.status === 'conflict' && (
                        <button
                          type="button"
                          data-testid="owner-annotation-reload"
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
                    data-testid="owner-annotation-abandon"
                    disabled={currentJournal.sending}
                    onClick={abandonIntent}
                    className="min-h-10 rounded-md border border-amber-500 px-3 text-xs font-medium hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:opacity-50"
                  >
                    {abandonArmed ? '再次確認並放棄原操作' : '放棄原操作'}
                  </button>
                </div>
              )}
            </div>
          )}

          {safePreviewUrl === null && previewUrl !== null && (
            <p role="alert" className="text-xs text-red-700">
              預覽網址與目前 Owner 照片版本不符，已停用標記畫布。
            </p>
          )}

          <div className="grid grid-cols-1 gap-2 rounded-lg border border-stone-200 bg-white p-3 sm:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="owner-annotation-tool-point"
                aria-pressed={tool === 'point'}
                disabled={!currentImageAllowed || hasIntent || preparing}
                onClick={() => {
                  setFreehandMode(false);
                  setTool('point');
                }}
                className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50 aria-pressed:border-amber-700 aria-pressed:bg-amber-50"
              >
                點標記
              </button>
              <button
                type="button"
                data-testid="owner-annotation-tool-rectangle"
                aria-pressed={tool === 'rectangle'}
                disabled={!currentImageAllowed || hasIntent || preparing}
                onClick={() => {
                  setFreehandMode(false);
                  setTool('rectangle');
                }}
                className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50 aria-pressed:border-amber-700 aria-pressed:bg-amber-50"
              >
                矩形標記
              </button>
              {allowFreehand && (
                <button
                  type="button"
                  data-testid="owner-annotation-tool-freehand"
                  aria-pressed={freehandMode}
                  disabled={!currentImageAllowed || hasIntent || preparing}
                  onClick={() => setFreehandMode(true)}
                  className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50 aria-pressed:border-amber-700 aria-pressed:bg-amber-50"
                >
                  自由筆畫
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(['amber', 'red', 'blue'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={color === value}
                  aria-label={
                    value === 'amber'
                      ? '琥珀色標記'
                      : value === 'red'
                        ? '紅色標記'
                        : '藍色標記'
                  }
                  disabled={!currentImageAllowed || hasIntent || preparing}
                  onClick={() => {
                    setColor(value);
                    setDraft((existing) =>
                      existing ? { ...existing, color: value } : existing,
                    );
                  }}
                  className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50 aria-pressed:border-stone-900"
                >
                  <span
                    aria-hidden="true"
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: colors[value] }}
                  />
                  {value === 'amber'
                    ? '琥珀'
                    : value === 'red'
                      ? '紅色'
                      : '藍色'}
                </button>
              ))}
            </div>
            {draftAvailable && draft && (
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <button
                  type="button"
                  data-testid="owner-annotation-save"
                  disabled={!canDraw || hasIntent || preparing}
                  onClick={saveDraft}
                  className="min-h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {preparing ? '準備中…' : '儲存 Owner 標記'}
                </button>
                <button
                  type="button"
                  disabled={preparing}
                  onClick={() => {
                    setDraft(null);
                    setNotice(null);
                  }}
                  className="min-h-10 rounded-md border border-stone-300 px-3 text-sm hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                >
                  取消草稿
                </button>
                {draft.expectedCurrent?.commentId !== undefined &&
                  draft.expectedCurrent?.commentId !== null && (
                    <span className="text-xs text-stone-600">
                      儲存時會保留原留言連結。
                    </span>
                  )}
              </div>
            )}
          </div>

          {currentImageAllowed ? (
            <AnnotationCanvas
              key={contextKey}
              previewUrl={safePreviewUrl}
              filename={filename}
              annotations={adaptedItems}
              selectedAnnotationId={selectedId}
              draftGeometry={draftGeometry}
              tool={tool}
              color={canvasColor}
              canDraw={canDraw}
              onDraftGeometry={(geometry) => {
                if (geometry.type === 'freehand') return;
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
              onImageError={imageFailed}
              freehandMode={allowFreehand && freehandMode}
              freehandScopeKey={JSON.stringify([
                current.owner?.actor.id ?? '',
                current.owner?.sessionId ?? '',
                contextKey,
              ])}
              onDraftFreehand={(stroke: FreehandStroke) => {
                if (!allowFreehand || !canDraw) return;
                setNotice(null);
                setDraft((currentDraft) =>
                  currentDraft
                    ? {
                        ...currentDraft,
                        geometry: stroke.geometry,
                        color: stroke.style.color,
                      }
                    : {
                        geometry: stroke.geometry,
                        color: stroke.style.color,
                        annotationId: null,
                        expectedCurrent: null,
                      },
                );
              }}
            />
          ) : (
            <div
              data-testid="owner-annotation-canvas"
              className="flex min-h-32 items-center justify-center rounded-lg border border-stone-300 bg-stone-950 px-4 text-center text-sm text-white/70"
            >
              {previewUrl === null
                ? '目前沒有此照片版本的 Owner 預覽；仍可查看已儲存標記。'
                : previewFailed
                  ? 'Owner 預覽載入失敗；標記畫布已停用。'
                  : '正在確認 Owner 照片預覽…'}
            </div>
          )}

          <section
            aria-label="Owner 已建立標記清單"
            className="space-y-2 rounded-lg border border-stone-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold">Owner 已建立標記</h4>
                <p className="text-xs text-stone-600">
                  只顯示此邀請、照片與版本的 Owner 標記。
                </p>
              </div>
              <button
                type="button"
                data-testid="owner-annotation-reload"
                disabled={current.loadingMore || preparing}
                onClick={() => void bootstrap(true)}
                className="min-h-9 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
              >
                重新載入目前標記
              </button>
            </div>
            {current.items.length === 0 ? (
              <p className="rounded-md bg-stone-50 p-3 text-xs text-stone-600">
                這個邀請和版本目前沒有 Owner 標記。
              </p>
            ) : (
              <ul className="space-y-2">
                {current.items.map((item) => (
                  <li
                    key={item.annotationId}
                    data-testid={'owner-annotation-item-' + item.annotationId}
                    className={
                      selectedId === item.annotationId
                        ? 'rounded-lg border border-amber-600 bg-amber-50 p-3'
                        : 'rounded-lg border border-stone-200 bg-stone-50 p-3'
                    }
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
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
                        <span className="block text-sm font-medium">
                          {stateLabel(item.state)} · 修訂 {item.revision}
                        </span>
                        <span className="block text-xs text-stone-600">
                          {item.geometry === null
                            ? '標記幾何已刪除'
                            : item.geometry.type === 'point'
                              ? '點標記'
                              : item.geometry.type === 'freehand'
                                ? '自由筆畫'
                                : '矩形標記'}
                          {item.commentId !== null
                            ? ' · 已連結客戶留言（不載入留言內文）'
                            : ''}
                        </span>
                      </button>
                      {item.state !== 'deleted' && (
                        <div className="flex flex-wrap gap-2">
                          {item.state === 'open' && (
                            <>
                              <button
                                type="button"
                                data-testid="owner-annotation-edit"
                                disabled={
                                  !canDraw ||
                                  hasIntent ||
                                  preparing ||
                                  !item.canEdit
                                }
                                onClick={() => startEdit(item)}
                                className="min-h-9 rounded-md border border-stone-300 px-2.5 text-xs hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                              >
                                編輯標記
                              </button>
                              <button
                                type="button"
                                disabled={
                                  hasIntent || preparing || !item.canEdit
                                }
                                onClick={() => runLifecycle('resolve', item)}
                                className="min-h-9 rounded-md border border-emerald-700 px-2.5 text-xs text-emerald-900 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                              >
                                標記已處理
                              </button>
                            </>
                          )}
                          {item.state === 'resolved' && (
                            <button
                              type="button"
                              disabled={hasIntent || preparing || !item.canEdit}
                              onClick={() => runLifecycle('reopen', item)}
                              className="min-h-9 rounded-md border border-amber-700 px-2.5 text-xs text-amber-900 hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                            >
                              重新開啟
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={hasIntent || preparing || !item.canEdit}
                            onClick={() => runLifecycle('delete', item)}
                            className="min-h-9 rounded-md border border-red-300 px-2.5 text-xs text-red-800 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50"
                          >
                            刪除標記
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {current.moreError && (
              <p role="alert" className="text-xs text-red-700">
                無法載入更多 Owner 標記；已載入的列仍保留。請明確重新載入。
              </p>
            )}
            {current.nextCursor !== null && (
              <button
                type="button"
                data-testid="owner-annotation-load-more"
                disabled={current.loadingMore}
                onClick={() => void loadMore()}
                className="min-h-10 rounded-md border border-stone-300 px-3 text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-wait disabled:opacity-50"
              >
                {current.loadingMore ? '載入中…' : '載入更多 Owner 標記'}
              </button>
            )}
          </section>
        </>
      )}
    </section>
  );
}
