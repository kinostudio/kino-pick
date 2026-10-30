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
import {
  annotationProcessingSnapshotSchema,
  ownerAnnotationProcessingCapabilitiesSchema,
  ownerAnnotationProcessingCommandSchema,
  ownerAnnotationProcessingResultSchema,
  type AnnotationProcessingState,
  type AnnotationProcessingSnapshot,
} from '../../../packages/contracts/src/annotation-processing.ts';
import {
  ownerAnnotationsPageSchema,
  type OwnerAnnotationItem,
} from '../../../packages/contracts/src/owner-annotations.ts';
import {
  OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE,
  isOwnerAnnotationUpgradeRequired,
  ownerAnnotationReadCapabilityHeaders,
} from './owner-annotation-read-support.ts';
import {
  abandonAnnotationProcessingIntent,
  annotationProcessingJournalMetadata,
  claimAnnotationProcessingIntent,
  completeAnnotationProcessingIntent,
  getAnnotationProcessingJournalSnapshot,
  isCurrentAnnotationProcessingIntent,
  markAnnotationProcessingConflict,
  markAnnotationProcessingUncertain,
  readAnnotationProcessingJournal,
  releaseAnnotationProcessingClaim,
  saveAnnotationProcessingIntent,
  subscribeAnnotationProcessingJournal,
  type AnnotationProcessingJournalClaim,
  type AnnotationProcessingJournalMetadata,
  type AnnotationProcessingJournalSnapshot,
} from './annotation-processing-journal.ts';

const meSchema = z
  .object({
    actor: z.object({ id: z.uuid() }).strict(),
    role: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();
type OwnerIdentity = {
  actor: { id: string };
  role: 'owner';
  sessionId: string;
};

type PanelStatus =
  'loading' | 'ready' | 'disabled' | 'unauthorized' | 'denied' | 'error';
type PanelSnapshot = {
  key: string;
  generation: number;
  status: PanelStatus;
  featureEnabled: boolean;
  owner: OwnerIdentity | null;
};
type Target = {
  ownerId: string;
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
};
type ReadTarget = Target & { annotationId: string };
type ProcessingScope = Pick<
  Target,
  'ownerId' | 'albumId' | 'inviteId' | 'photoId' | 'versionId'
>;

export type OwnerAnnotationProcessingPanelProps = {
  ownerId: string;
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
  items: OwnerAnnotationItem[];
  onReconcile: (
    items: OwnerAnnotationItem[],
    sourceScope: ProcessingScope,
  ) => void;
  onPendingChange?: (pending: boolean) => void;
  onUnauthorized?: ((status: 401 | 403) => void) | undefined;
  onUpgradeRequired?: (() => void) | undefined;
  freehandReadCapability?: boolean;
};

const emptyJournal: AnnotationProcessingJournalSnapshot = { kind: 'none' };
const stateLabel: Record<AnnotationProcessingState, string> = {
  open: '待處理',
  in_progress: '處理中',
  resolved: '已處理',
};
const stateOrder: AnnotationProcessingState[] = [
  'open',
  'in_progress',
  'resolved',
];

class ApiFailure extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string | null,
  ) {
    super(code ?? 'ANNOTATION_PROCESSING_REQUEST_FAILED');
  }
}

class ProtocolFailure extends Error {
  constructor() {
    super('Invalid annotation processing response');
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

function targetKey(target: Target) {
  return JSON.stringify([
    target.ownerId,
    target.albumId,
    target.inviteId,
    target.photoId,
    target.versionId,
  ]);
}

function metadataMatchesTarget(
  metadata: AnnotationProcessingJournalMetadata,
  target: Target,
) {
  return (
    metadata.ownerId === target.ownerId &&
    metadata.albumId === target.albumId &&
    metadata.inviteId === target.inviteId &&
    metadata.photoId === target.photoId &&
    metadata.versionId === target.versionId
  );
}

function emptyPanel(
  key: string,
  generation: number,
  status: PanelStatus,
  featureEnabled = false,
  owner: OwnerIdentity | null = null,
): PanelSnapshot {
  return { key, generation, status, featureEnabled, owner };
}

function sameIdentity(left: OwnerIdentity, right: OwnerIdentity) {
  return (
    left.actor.id === right.actor.id &&
    left.role === right.role &&
    left.sessionId === right.sessionId
  );
}

function ownerGuestAnnotationsPath(target: ReadTarget) {
  const query = new URLSearchParams({
    inviteId: target.inviteId,
    annotationId: target.annotationId,
  });
  return (
    '/api/v1/albums/' +
    encodeURIComponent(target.albumId) +
    '/photos/' +
    encodeURIComponent(target.photoId) +
    '/versions/' +
    encodeURIComponent(target.versionId) +
    '/annotations?' +
    query.toString()
  );
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function processingSnapshotMatches(
  left: AnnotationProcessingSnapshot,
  right: AnnotationProcessingSnapshot,
) {
  return sameJson(left, right);
}

function validateReceipt(
  result: z.infer<typeof ownerAnnotationProcessingResultSchema>,
  metadata: AnnotationProcessingJournalMetadata,
) {
  const { command } = metadata;
  if (
    result.ownerId !== metadata.ownerId ||
    result.requestId !== command.requestId ||
    result.operation !== command.operation ||
    result.inviteId !== metadata.inviteId ||
    result.photoId !== metadata.photoId ||
    result.versionId !== metadata.versionId ||
    result.annotationId !== command.annotationId ||
    result.processing.state !== command.state ||
    result.processing.revision !== command.expectedProcessingRevision + 1 ||
    result.processing.annotationRevision !==
      command.expectedAnnotationRevision ||
    result.processing.stale ||
    result.processing.updatedAt !== result.occurredAt
  )
    throw new ProtocolFailure();
}

function authorizationStatus(error: unknown): 401 | 403 | null {
  return error instanceof ApiFailure &&
    (error.statusCode === 401 || error.statusCode === 403)
    ? error.statusCode
    : null;
}

function displayFailure(error: unknown) {
  if (isOwnerAnnotationUpgradeRequired(error))
    return OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE;
  if (error instanceof ApiFailure) {
    if (error.statusCode === 409)
      return '標記或處理狀態已有新變更；原操作仍保留，請核對目前資料。';
    if (error.statusCode === 404)
      return '找不到原客戶標記；原操作仍保留，請先重新載入。';
    if (error.statusCode === 0)
      return '目前無法確認處理狀態；已保留原操作，可重試相同操作。';
  }
  return '目前無法確認處理狀態；已保留原操作，可重試相同操作。';
}

export function OwnerAnnotationProcessingPanel({
  ownerId,
  albumId,
  inviteId,
  photoId,
  versionId,
  items,
  onReconcile,
  onPendingChange,
  onUnauthorized,
  onUpgradeRequired,
  freehandReadCapability = true,
}: OwnerAnnotationProcessingPanelProps) {
  const target = useMemo(
    () => ({ ownerId, albumId, inviteId, photoId, versionId }),
    [ownerId, albumId, inviteId, photoId, versionId],
  );
  const key = targetKey(target);
  const [snapshot, setSnapshot] = useState<PanelSnapshot>(() =>
    emptyPanel(key, 0, 'loading'),
  );
  const snapshotRef = useRef(snapshot);
  const [journalScopeLoaded, setJournalScopeLoaded] = useState('');
  const [notice, setNotice] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [abandonArmed, setAbandonArmed] = useState(false);
  const generationRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeKeyRef = useRef(key);
  const latestKeyRef = useRef(key);
  const ownerRef = useRef<OwnerIdentity | null>(null);
  const lastOwnerRef = useRef<OwnerIdentity | null>(null);
  const mountedRef = useRef(false);
  const visibleRef = useRef(false);
  const controllersRef = useRef(new Set<AbortController>());
  const preparingRef = useRef(false);
  const pendingCallbackRef = useRef(onPendingChange);
  const unauthorizedCallbackRef = useRef(onUnauthorized);
  const reconcileCallbackRef = useRef(onReconcile);
  const upgradeRequiredCallbackRef = useRef(onUpgradeRequired);
  const lastPendingReportRef = useRef<boolean | null>(null);

  useLayoutEffect(() => {
    latestKeyRef.current = key;
    pendingCallbackRef.current = onPendingChange;
    unauthorizedCallbackRef.current = onUnauthorized;
    reconcileCallbackRef.current = onReconcile;
    upgradeRequiredCallbackRef.current = onUpgradeRequired;
  }, [key, onPendingChange, onReconcile, onUnauthorized, onUpgradeRequired]);

  const writeSnapshot = useCallback((next: PanelSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const current =
    snapshot.key === key ? snapshot : emptyPanel(key, 0, 'loading');
  const subscribeJournal = useCallback(
    (listener: () => void) =>
      ownerId && albumId
        ? subscribeAnnotationProcessingJournal(ownerId, albumId, listener)
        : () => undefined,
    [ownerId, albumId],
  );
  const getJournalSnapshot = useCallback(
    () =>
      ownerId && albumId
        ? getAnnotationProcessingJournalSnapshot(ownerId, albumId)
        : emptyJournal,
    [ownerId, albumId],
  );
  const journal = useSyncExternalStore(
    subscribeJournal,
    getJournalSnapshot,
    () => emptyJournal,
  );

  const generationIsCurrent = useCallback(
    (generation: number, expectedKey: string) =>
      mountedRef.current &&
      visibleRef.current &&
      document.visibilityState !== 'hidden' &&
      latestKeyRef.current === expectedKey &&
      activeKeyRef.current === expectedKey &&
      activeGenerationRef.current === generation &&
      snapshotRef.current.key === expectedKey &&
      snapshotRef.current.generation === generation,
    [],
  );

  const sameView = useCallback(
    (generation: number, expectedKey: string, owner: OwnerIdentity) =>
      generationIsCurrent(generation, expectedKey) &&
      snapshotRef.current.status === 'ready' &&
      snapshotRef.current.owner !== null &&
      sameIdentity(snapshotRef.current.owner, owner) &&
      ownerRef.current !== null &&
      sameIdentity(ownerRef.current, owner),
    [generationIsCurrent],
  );

  const abortReads = useCallback(() => {
    for (const controller of controllersRef.current) controller.abort();
    controllersRef.current.clear();
  }, []);

  const clearPrivateControls = useCallback(() => {
    ownerRef.current = null;
    setAbandonArmed(false);
    setPreparing(false);
    preparingRef.current = false;
  }, []);

  const readMe = useCallback(async (signal?: AbortSignal) => {
    return requestJson('/api/v1/me', meSchema, {
      ...(signal === undefined ? {} : { signal }),
    });
  }, []);

  const verifyOwner = useCallback(
    async (expected: OwnerIdentity, signal?: AbortSignal) => {
      const currentOwner = await readMe(signal);
      if (currentOwner.role !== 'owner')
        throw new ApiFailure(403, 'OWNER_REQUIRED');
      if (
        currentOwner.actor.id !== expected.actor.id ||
        currentOwner.sessionId !== expected.sessionId
      )
        throw new ApiFailure(401, 'OWNER_IDENTITY_CHANGED');
      return expected;
    },
    [readMe],
  );

  const readCurrentTarget = useCallback(
    async (
      readTarget: ReadTarget,
      owner: OwnerIdentity,
      signal: AbortSignal,
    ) => {
      await verifyOwner(owner, signal);
      const page = await requestJson(
        ownerGuestAnnotationsPath(readTarget),
        ownerAnnotationsPageSchema,
        {
          signal,
          headers: ownerAnnotationReadCapabilityHeaders(freehandReadCapability),
        },
      );
      await verifyOwner(owner, signal);
      if (
        page.inviteId !== readTarget.inviteId ||
        page.photoId !== readTarget.photoId ||
        page.versionId !== readTarget.versionId ||
        page.items.length !== 1 ||
        page.nextCursor !== null ||
        page.items[0]?.annotationId !== readTarget.annotationId
      )
        throw new ProtocolFailure();
      return page.items[0]!;
    },
    [freehandReadCapability, verifyOwner],
  );

  const notifyUnauthorized = useCallback(
    (
      statusCode: 401 | 403,
      generation: number,
      expectedKey: string,
      metadata?: AnnotationProcessingJournalMetadata,
    ) => {
      if (!generationIsCurrent(generation, expectedKey)) return false;
      if (
        metadata !== undefined &&
        !isCurrentAnnotationProcessingIntent(metadata)
      )
        return false;
      const status: PanelStatus =
        statusCode === 401 ? 'unauthorized' : 'denied';
      ownerRef.current = null;
      writeSnapshot(emptyPanel(expectedKey, generation, status, true));
      clearPrivateControls();
      setNotice(
        statusCode === 401
          ? '攝影師登入狀態已變更；處理控制已隱藏，保留原操作。'
          : '目前帳號無法讀取此客戶標記；處理控制已隱藏，保留原操作。',
      );
      unauthorizedCallbackRef.current?.(statusCode);
      return true;
    },
    [clearPrivateControls, generationIsCurrent, writeSnapshot],
  );

  const bootstrap = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeGenerationRef.current = generation;
    activeKeyRef.current = key;
    abortReads();
    ownerRef.current = null;
    writeSnapshot(emptyPanel(key, generation, 'loading'));
    setNotice('');
    clearPrivateControls();
    if (document.visibilityState === 'hidden') return;

    const controller = new AbortController();
    controllersRef.current.add(controller);
    const active = () =>
      !controller.signal.aborted && generationIsCurrent(generation, key);
    let capabilityEnabled = false;
    try {
      const capability = await requestJson(
        '/api/v1/annotation-processing/capabilities',
        ownerAnnotationProcessingCapabilitiesSchema,
        { signal: controller.signal },
      );
      if (!active()) return;
      if (!capability.enabled) {
        writeSnapshot(emptyPanel(key, generation, 'disabled'));
        setJournalScopeLoaded('');
        return;
      }
      capabilityEnabled = true;
      writeSnapshot(emptyPanel(key, generation, 'loading', true));
      const me = await readMe(controller.signal);
      if (!active()) return;
      if (me.role !== 'owner') throw new ApiFailure(403, 'OWNER_REQUIRED');
      const owner: OwnerIdentity = {
        actor: { id: me.actor.id },
        role: 'owner',
        sessionId: me.sessionId,
      };
      if (owner.actor.id !== ownerId)
        throw new ApiFailure(401, 'OWNER_IDENTITY_CHANGED');
      const previousOwner = lastOwnerRef.current;
      if (previousOwner && !sameIdentity(previousOwner, owner))
        throw new ApiFailure(401, 'OWNER_IDENTITY_CHANGED');
      lastOwnerRef.current = owner;
      ownerRef.current = owner;
      readAnnotationProcessingJournal(ownerId, albumId);
      setJournalScopeLoaded(JSON.stringify([ownerId, albumId]));
      if (!active()) return;
      writeSnapshot(emptyPanel(key, generation, 'ready', true, owner));
    } catch (error) {
      if (!active()) return;
      const authStatus = authorizationStatus(error);
      const status =
        authStatus === 401
          ? 'unauthorized'
          : authStatus === 403
            ? 'denied'
            : 'error';
      writeSnapshot(emptyPanel(key, generation, status, capabilityEnabled));
      clearPrivateControls();
      setJournalScopeLoaded('');
      setNotice(
        authStatus === 401
          ? '攝影師登入狀態已變更；處理控制已隱藏，保留原操作。'
          : authStatus === 403
            ? '目前帳號無法讀取客戶註記；處理控制已隱藏，保留原操作。'
            : '目前無法確認處理狀態權限，請重新載入。',
      );
      if (authStatus !== null) unauthorizedCallbackRef.current?.(authStatus);
    } finally {
      controllersRef.current.delete(controller);
    }
  }, [
    abortReads,
    albumId,
    clearPrivateControls,
    generationIsCurrent,
    key,
    ownerId,
    readMe,
    writeSnapshot,
  ]);

  const suspend = useCallback(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    activeGenerationRef.current = generation;
    activeKeyRef.current = key;
    abortReads();
    ownerRef.current = null;
    writeSnapshot(emptyPanel(key, generation, 'loading'));
    setJournalScopeLoaded('');
    setNotice('');
    clearPrivateControls();
  }, [abortReads, clearPrivateControls, key, writeSnapshot]);

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
      pendingCallbackRef.current?.(false);
    };
  }, [abortReads, bootstrap, suspend]);

  const journalPending =
    journal.kind === 'pending' || journal.kind === 'blocked';
  const journalScopeReady =
    current.owner !== null &&
    journalScopeLoaded === JSON.stringify([current.owner.actor.id, albumId]);
  const requiresJournalHydration =
    current.status !== 'unauthorized' && current.status !== 'denied';
  const pending =
    current.featureEnabled &&
    (preparing ||
      journalPending ||
      (requiresJournalHydration && !journalScopeReady));
  useEffect(() => {
    const reported = pending;
    if (lastPendingReportRef.current !== reported) {
      pendingCallbackRef.current?.(reported);
      lastPendingReportRef.current = reported;
    }
  }, [onPendingChange, pending]);

  const reportNotice = useCallback(
    (generation: number, expectedKey: string, message: string) => {
      if (generationIsCurrent(generation, expectedKey)) setNotice(message);
    },
    [generationIsCurrent],
  );

  const releaseOnce = useCallback(
    (claim: AnnotationProcessingJournalClaim, active: { current: boolean }) => {
      if (!active.current) return false;
      active.current = false;
      return releaseAnnotationProcessingClaim(claim);
    },
    [],
  );

  const executeIntent = useCallback(
    async (
      metadata: AnnotationProcessingJournalMetadata,
      owner: OwnerIdentity,
      generation: number,
      expectedKey: string,
    ) => {
      if (!generationIsCurrent(generation, expectedKey)) return;
      if (!isCurrentAnnotationProcessingIntent(metadata)) return;
      if (!metadataMatchesTarget(metadata, target)) {
        reportNotice(
          generation,
          expectedKey,
          '保留操作屬於其他邀請或版本，請切換回原範圍後重試。',
        );
        return;
      }
      const claim = claimAnnotationProcessingIntent(metadata);
      if (!claim) {
        reportNotice(
          generation,
          expectedKey,
          '此操作已由另一個畫面送出，請等待原結果。',
        );
        return;
      }
      const claimActive = { current: true };
      const controller = new AbortController();
      controllersRef.current.add(controller);
      let receipt: z.infer<typeof ownerAnnotationProcessingResultSchema>;
      try {
        await verifyOwner(owner, controller.signal);
        if (
          !generationIsCurrent(generation, expectedKey) ||
          !isCurrentAnnotationProcessingIntent(metadata)
        )
          return;
        receipt = await requestJson(
          '/api/v1/albums/' +
            encodeURIComponent(metadata.albumId) +
            '/annotation-processing/commands',
          ownerAnnotationProcessingResultSchema,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Kino-Expected-Actor': metadata.ownerId,
            },
            body: JSON.stringify(claim.command),
            signal: controller.signal,
          },
        );
        validateReceipt(receipt, metadata);
      } catch (error) {
        const released = releaseOnce(claim, claimActive);
        if (!released || !isCurrentAnnotationProcessingIntent(metadata)) return;
        const authStatus = authorizationStatus(error);
        const marked =
          error instanceof ApiFailure && error.statusCode === 409
            ? markAnnotationProcessingConflict(metadata)
            : markAnnotationProcessingUncertain(metadata);
        if (!marked) return;
        if (authStatus !== null) {
          notifyUnauthorized(authStatus, generation, expectedKey, metadata);
          return;
        }
        if (!generationIsCurrent(generation, expectedKey)) return;
        if (isOwnerAnnotationUpgradeRequired(error))
          upgradeRequiredCallbackRef.current?.();
        if (error instanceof ApiFailure && error.statusCode === 409)
          reportNotice(generation, expectedKey, displayFailure(error));
        else reportNotice(generation, expectedKey, displayFailure(error));
        return;
      } finally {
        controllersRef.current.delete(controller);
      }

      if (
        !claimActive.current ||
        !generationIsCurrent(generation, expectedKey) ||
        !sameView(generation, expectedKey, owner) ||
        !isCurrentAnnotationProcessingIntent(metadata)
      ) {
        releaseOnce(claim, claimActive);
        return;
      }

      const currentController = new AbortController();
      controllersRef.current.add(currentController);
      let currentItem: OwnerAnnotationItem;
      try {
        currentItem = await readCurrentTarget(
          {
            ownerId: metadata.ownerId,
            albumId: metadata.albumId,
            inviteId: metadata.inviteId,
            photoId: metadata.photoId,
            versionId: metadata.versionId,
            annotationId: claim.command.annotationId,
          },
          owner,
          currentController.signal,
        );
        const currentProcessing = annotationProcessingSnapshotSchema.parse(
          currentItem.processing,
        );
        if (
          currentItem.revision < claim.command.expectedAnnotationRevision ||
          currentProcessing.revision < receipt.processing.revision
        )
          throw new ProtocolFailure();
      } catch (error) {
        const released = releaseOnce(claim, claimActive);
        if (!released || !isCurrentAnnotationProcessingIntent(metadata)) return;
        const authStatus = authorizationStatus(error);
        const marked =
          error instanceof ApiFailure && error.statusCode === 409
            ? markAnnotationProcessingConflict(metadata)
            : markAnnotationProcessingUncertain(metadata);
        if (!marked) return;
        if (authStatus !== null) {
          notifyUnauthorized(authStatus, generation, expectedKey, metadata);
          return;
        }
        if (isOwnerAnnotationUpgradeRequired(error))
          upgradeRequiredCallbackRef.current?.();
        if (generationIsCurrent(generation, expectedKey))
          reportNotice(
            generation,
            expectedKey,
            isOwnerAnnotationUpgradeRequired(error)
              ? OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE
              : '收據已確認，但目前客戶標記尚未重新讀取；原操作仍保留。',
          );
        return;
      } finally {
        controllersRef.current.delete(currentController);
      }

      if (
        !generationIsCurrent(generation, expectedKey) ||
        !sameView(generation, expectedKey, owner) ||
        !isCurrentAnnotationProcessingIntent(metadata)
      ) {
        releaseOnce(claim, claimActive);
        return;
      }
      if (!completeAnnotationProcessingIntent(claim)) {
        const released = releaseOnce(claim, claimActive);
        if (released && isCurrentAnnotationProcessingIntent(metadata))
          markAnnotationProcessingUncertain(metadata);
        if (generationIsCurrent(generation, expectedKey))
          reportNotice(
            generation,
            expectedKey,
            '目前無法安全完成操作紀錄；原操作仍保留，請重新載入後重試。',
          );
        return;
      }
      claimActive.current = false;
      if (
        !generationIsCurrent(generation, expectedKey) ||
        !sameView(generation, expectedKey, owner)
      )
        return;
      reconcileCallbackRef.current?.([currentItem], {
        ownerId: metadata.ownerId,
        albumId: metadata.albumId,
        inviteId: metadata.inviteId,
        photoId: metadata.photoId,
        versionId: metadata.versionId,
      });
      setAbandonArmed(false);
      reportNotice(generation, expectedKey, '客戶標記處理狀態已更新。');
    },
    [
      generationIsCurrent,
      notifyUnauthorized,
      readCurrentTarget,
      releaseOnce,
      reportNotice,
      sameView,
      target,
      verifyOwner,
    ],
  );

  const prepareStateChange = useCallback(
    async (
      item: OwnerAnnotationItem,
      requestedState: AnnotationProcessingState,
      acknowledgeStale: boolean,
    ) => {
      const owner = ownerRef.current;
      const generation = activeGenerationRef.current;
      const expectedKey = latestKeyRef.current;
      if (
        !owner ||
        !sameView(generation, expectedKey, owner) ||
        item.state === 'deleted' ||
        preparingRef.current ||
        journal.kind !== 'none'
      )
        return;
      preparingRef.current = true;
      setPreparing(true);
      setNotice('');
      const controller = new AbortController();
      controllersRef.current.add(controller);
      try {
        const fresh = await readCurrentTarget(
          {
            ...target,
            annotationId: item.annotationId,
          },
          owner,
          controller.signal,
        );
        if (!sameView(generation, expectedKey, owner)) return;
        if (fresh.state === 'deleted') {
          reconcileCallbackRef.current?.([fresh], target);
          setNotice('客戶標記已刪除，無法更新處理狀態。');
          return;
        }
        const sourceChanged =
          fresh.revision !== item.revision ||
          !processingSnapshotMatches(fresh.processing, item.processing);
        if (sourceChanged) {
          reconcileCallbackRef.current?.([fresh], target);
          setNotice('客戶標記或處理狀態已有更新，已重新讀取；請核對後再選擇。');
          return;
        }
        if (fresh.processing.stale && !acknowledgeStale) {
          reconcileCallbackRef.current?.([fresh], target);
          setNotice('客戶標記已更新，請使用明確的重新確認操作。');
          return;
        }
        if (acknowledgeStale) {
          if (!fresh.processing.stale) {
            reconcileCallbackRef.current?.([fresh], target);
            setNotice('目前標記已重新確認，無須再次送出。');
            return;
          }
          if (requestedState !== fresh.processing.state) return;
        } else if (requestedState === fresh.processing.state) {
          return;
        }
        if (!sameView(generation, expectedKey, owner)) return;
        const command = ownerAnnotationProcessingCommandSchema.parse({
          requestId: crypto.randomUUID().toLowerCase(),
          expectedOwnerId: owner.actor.id,
          operation: 'set_processing_state',
          inviteId: target.inviteId,
          photoId: target.photoId,
          versionId: target.versionId,
          annotationId: fresh.annotationId,
          expectedAnnotationRevision: fresh.revision,
          expectedProcessingRevision: fresh.processing.revision,
          state: requestedState,
        });
        const metadata = annotationProcessingJournalMetadata({
          version: 1,
          ownerId: owner.actor.id,
          albumId: target.albumId,
          inviteId: target.inviteId,
          photoId: target.photoId,
          versionId: target.versionId,
          command,
          expectedProcessing: fresh.processing,
        });
        const saved = saveAnnotationProcessingIntent(metadata);
        if (!saved.ok) {
          setNotice(
            saved.reason === 'existing'
              ? '相簿已有一筆未確認處理操作，請先重試或放棄該操作。'
              : '無法安全保存處理操作；目前未送出變更。',
          );
          return;
        }
        if (!sameView(generation, expectedKey, owner)) return;
        void executeIntent(metadata, owner, generation, expectedKey);
      } catch (error) {
        if (!sameView(generation, expectedKey, owner)) return;
        const authStatus = authorizationStatus(error);
        if (authStatus !== null) {
          notifyUnauthorized(authStatus, generation, expectedKey);
          return;
        }
        if (isOwnerAnnotationUpgradeRequired(error))
          upgradeRequiredCallbackRef.current?.();
        setNotice(
          isOwnerAnnotationUpgradeRequired(error)
            ? OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE
            : error instanceof ApiFailure && error.statusCode === 409
              ? '客戶標記已有新變更，請重新載入後核對。'
              : '目前無法重新讀取客戶標記；尚未送出處理變更。',
        );
      } finally {
        controllersRef.current.delete(controller);
        preparingRef.current = false;
        if (generationIsCurrent(generation, expectedKey)) setPreparing(false);
      }
    },
    [
      executeIntent,
      generationIsCurrent,
      journal.kind,
      notifyUnauthorized,
      readCurrentTarget,
      sameView,
      target,
    ],
  );

  const retryIntent = useCallback(() => {
    const owner = ownerRef.current;
    const currentJournal = readAnnotationProcessingJournal(
      target.ownerId,
      target.albumId,
    );
    const generation = activeGenerationRef.current;
    const expectedKey = latestKeyRef.current;
    if (
      !owner ||
      !sameView(generation, expectedKey, owner) ||
      currentJournal.kind !== 'pending' ||
      currentJournal.sending ||
      !metadataMatchesTarget(currentJournal.metadata, target)
    )
      return;
    setNotice('');
    void executeIntent(currentJournal.metadata, owner, generation, expectedKey);
  }, [executeIntent, sameView, target]);

  const abandonIntent = useCallback(() => {
    if (journal.kind !== 'pending' || journal.sending) return;
    if (!abandonArmed) {
      setAbandonArmed(true);
      return;
    }
    if (!abandonAnnotationProcessingIntent(journal.metadata)) {
      setNotice('保留操作已變更，沒有清除任何資料；請重新載入。');
      setAbandonArmed(false);
      return;
    }
    setAbandonArmed(false);
    setNotice('已明確放棄保留的處理操作。');
  }, [abandonArmed, journal]);

  const reload = useCallback(() => {
    void bootstrap();
  }, [bootstrap]);

  const ready =
    current.key === key && current.status === 'ready' && current.owner !== null;
  const scopedItems = items.filter(
    (item) => item.photoId === photoId && item.versionId === versionId,
  );
  const journalScopeMatchesPanel =
    journal.kind === 'pending' &&
    metadataMatchesTarget(journal.metadata, target);

  if (current.status === 'disabled') return null;
  if (!ready) {
    const statusText =
      current.status === 'unauthorized'
        ? '攝影師登入已失效；處理控制已隱藏。'
        : current.status === 'denied'
          ? '目前帳號無法讀取客戶處理狀態；控制已隱藏。'
          : current.status === 'error'
            ? '目前無法確認處理狀態權限。'
            : '正在確認客戶處理狀態權限…';
    return (
      <section
        data-testid="annotation-processing-panel"
        aria-label="客戶標記處理狀態"
        className="min-w-0 rounded-xl bg-stone-50 p-3 text-stone-900"
      >
        <h3 className="font-semibold">客戶標記處理</h3>
        <p
          role={current.status === 'error' ? 'alert' : 'status'}
          className="mt-2 text-sm"
        >
          {notice || statusText}
        </p>
        {(current.status === 'error' ||
          current.status === 'unauthorized' ||
          current.status === 'denied') && (
          <button
            type="button"
            data-testid="annotation-processing-reload"
            className="mt-3 min-h-11 rounded border px-3"
            onClick={reload}
          >
            重新確認
          </button>
        )}
      </section>
    );
  }

  return (
    <section
      data-testid="annotation-processing-panel"
      aria-label="客戶標記處理狀態"
      className="min-w-0 rounded-xl bg-stone-50 p-3 text-stone-900"
    >
      <h3 className="font-semibold">客戶標記處理</h3>
      <p className="mt-1 text-xs text-stone-600">
        這些狀態獨立於客戶標記的待處理或解決狀態。
      </p>

      {journal.kind === 'blocked' && (
        <p
          role="alert"
          className="mt-3 rounded border border-amber-300 p-2 text-sm"
        >
          {journal.reason === 'storage'
            ? '無法安全讀取本機保留的操作；目前不接受新的處理變更。'
            : '保留的操作資料格式無法確認；目前不接受新的處理變更。'}
        </p>
      )}

      {journal.kind === 'pending' && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p role="status" className="text-sm">
            {journal.status === 'conflict'
              ? '原處理操作遇到版本衝突，已完整保留。'
              : journal.status === 'uncertain'
                ? '原處理操作結果尚未確認，已完整保留。'
                : '有一筆處理操作尚未完成確認。'}
            {!journalScopeMatchesPanel
              ? ' 請切換回原邀請與照片版本後再重試。'
              : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="annotation-processing-retry"
              disabled={journal.sending || !ready || !journalScopeMatchesPanel}
              className="min-h-11 rounded border px-3 disabled:opacity-50"
              onClick={retryIntent}
            >
              {journal.sending ? '正在確認…' : '重試保留的操作'}
            </button>
            <button
              type="button"
              data-testid="annotation-processing-abandon"
              disabled={journal.sending}
              className="min-h-11 rounded border px-3 disabled:opacity-50"
              onClick={abandonIntent}
            >
              {abandonArmed ? '確認放棄操作' : '放棄保留的操作'}
            </button>
            {abandonArmed && (
              <button
                type="button"
                data-testid="annotation-processing-abandon-cancel"
                className="min-h-11 rounded border px-3"
                onClick={() => setAbandonArmed(false)}
              >
                保留操作
              </button>
            )}
          </div>
        </div>
      )}

      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}

      {journal.kind !== 'none' &&
      !journalScopeMatchesPanel ? null : scopedItems.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">此版本沒有客戶標記。</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {scopedItems.map((item, index) => {
            const processing = item.processing;
            const disabled =
              journal.kind !== 'none' ||
              preparing ||
              item.state === 'deleted' ||
              processing.stale ||
              !ready;
            return (
              <li
                key={item.annotationId}
                data-testid={'annotation-processing-item-' + item.annotationId}
                className="min-w-0 rounded-lg border border-stone-200 bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">客戶標記 {index + 1}</span>
                  <span className="text-sm">
                    {item.state === 'deleted'
                      ? '客戶標記已刪除'
                      : '處理狀態：' + stateLabel[processing.state]}
                  </span>
                </div>
                {item.state === 'deleted' ? (
                  <p className="mt-2 text-sm text-stone-600">此標記為唯讀。</p>
                ) : processing.stale ? (
                  <div className="mt-2">
                    <p className="text-sm text-amber-800">
                      客戶已更新標記。重新確認前，處理狀態不代表最新內容。
                    </p>
                    <button
                      type="button"
                      data-testid={
                        'annotation-processing-reack-' + item.annotationId
                      }
                      disabled={journal.kind !== 'none' || preparing || !ready}
                      className="mt-2 min-h-11 rounded border border-amber-500 px-3 disabled:opacity-50"
                      onClick={() =>
                        void prepareStateChange(item, processing.state, true)
                      }
                    >
                      重新確認最新客戶標記
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {stateOrder.map((state) => (
                      <button
                        key={state}
                        type="button"
                        data-testid={
                          'annotation-processing-state-' +
                          state +
                          '-' +
                          item.annotationId
                        }
                        aria-pressed={processing.state === state}
                        disabled={disabled || processing.state === state}
                        className="min-h-11 rounded border px-3 aria-pressed:border-stone-700 aria-pressed:bg-stone-100 disabled:opacity-50"
                        onClick={() =>
                          void prepareStateChange(item, state, false)
                        }
                      >
                        {stateLabel[state]}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
