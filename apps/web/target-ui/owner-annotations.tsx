'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  invitePageSchema,
  type InviteSummary,
} from '../../../packages/contracts/src/invites';
import {
  ownerPhotoVersionsPageSchema,
  type PhotoVersionItem,
} from '../../../packages/contracts/src/photo-versions';
import {
  ownerAnnotationsCapabilitiesSchema,
  ownerAnnotationsPageSchema,
  type OwnerAnnotationItem,
} from '../../../packages/contracts/src/owner-annotations';
import { ownerAnnotationAuthoringCapabilitiesSchema } from '../../../packages/contracts/src/owner-annotation-authoring.ts';
import { ownerAnnotationProcessingCapabilitiesSchema } from '../../../packages/contracts/src/annotation-processing.ts';
import { ANNOTATION_COORDINATE_SCALE } from '../../../packages/contracts/src/annotation-geometry';
import {
  getOwnerAnnotationJournalSnapshot,
  readOwnerAnnotationJournal,
  subscribeOwnerAnnotationJournal,
  type OwnerAnnotationJournalSnapshot,
} from './owner-annotation-journal.ts';
import { OwnerAnnotationEditor } from './owner-annotation-editor.tsx';
import { OwnerAnnotationProcessingPanel } from './owner-annotation-processing.tsx';
import {
  OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE,
  isOwnerAnnotationUpgradeRequired,
  ownerAnnotationReadCapabilityHeaders,
} from './owner-annotation-read-support.ts';
import {
  getAnnotationProcessingJournalSnapshot,
  readAnnotationProcessingJournal,
  subscribeAnnotationProcessingJournal,
  type AnnotationProcessingJournalSnapshot,
} from './annotation-processing-journal.ts';
const ownerSchema = z
  .object({
    actor: z.object({ id: z.uuid() }).strict(),
    role: z.literal('owner'),
    sessionId: z.string().min(1),
  })
  .strict();
class ReadFailure extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number | null = null,
  ) {
    super(code);
  }
}
async function readJson<T>(
  url: string,
  schema: { parse: (input: unknown) => T },
  signal: AbortSignal,
  additionalHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...additionalHeaders },
    signal,
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(value);
    throw new ReadFailure(
      error.success ? error.data.error.code : 'READ_UNAVAILABLE',
      response.status,
    );
  }
  return schema.parse(value);
}
const time = (value: string) =>
  new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
const status = (state: OwnerAnnotationItem['state']) =>
  state === 'deleted'
    ? '已刪除'
    : state === 'resolved'
      ? '客戶已標記解決'
      : '客戶待處理';
function authorizationFailureStatus(reason: unknown): 401 | 403 | null {
  return reason instanceof ReadFailure &&
    (reason.statusCode === 401 || reason.statusCode === 403)
    ? reason.statusCode
    : null;
}
const colors = { amber: '#d97706', red: '#dc2626', blue: '#2563eb' } as const;
function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function mergeGuestAnnotationItems(
  currentItems: OwnerAnnotationItem[],
  incomingItems: OwnerAnnotationItem[],
): OwnerAnnotationItem[] {
  const next = [...currentItems];
  for (const incoming of incomingItems) {
    const index = next.findIndex(
      (item) => item.annotationId === incoming.annotationId,
    );
    if (index < 0) {
      next.push(incoming);
      continue;
    }
    const current = next[index]!;
    if (
      incoming.revision > current.revision &&
      incoming.processing.revision < current.processing.revision
    )
      throw new ReadFailure('ANNOTATION_SNAPSHOT_REGRESSION');
    if (
      incoming.revision < current.revision &&
      incoming.processing.revision > current.processing.revision
    )
      throw new ReadFailure('ANNOTATION_SNAPSHOT_REGRESSION');
    if (incoming.revision < current.revision) continue;
    if (incoming.revision === current.revision) {
      const guestContentMatches =
        incoming.photoId === current.photoId &&
        incoming.versionId === current.versionId &&
        incoming.authorGuestId === current.authorGuestId &&
        incoming.state === current.state &&
        sameJson(incoming.geometry, current.geometry) &&
        sameJson(incoming.style, current.style) &&
        incoming.commentId === current.commentId &&
        incoming.authorLabel === current.authorLabel &&
        incoming.canEdit === current.canEdit &&
        incoming.createdAt === current.createdAt &&
        incoming.updatedAt === current.updatedAt;
      if (!guestContentMatches)
        throw new ReadFailure('ANNOTATION_SNAPSHOT_REGRESSION');
      if (incoming.processing.revision < current.processing.revision) continue;
      if (incoming.processing.revision === current.processing.revision) {
        if (!sameJson(incoming.processing, current.processing))
          throw new ReadFailure('ANNOTATION_SNAPSHOT_REGRESSION');
        continue;
      }
    }
    next[index] = incoming;
  }
  return next;
}
type Props = {
  albumId: string;
  projectId: string;
  photoId: string;
  currentVersionId: string;
  filename: string;
  freehandReadCapability?: boolean;
  canvasContainer?: HTMLElement | null | undefined;
  onCanvasPortalActiveChange?: ((active: boolean) => void) | undefined;
  onPendingChange?: (pending: boolean) => void;
  onUnauthorized?: (status: 401 | 403) => void;
};
export function OwnerAnnotationsPanel({
  albumId,
  projectId,
  photoId,
  currentVersionId,
  filename,
  freehandReadCapability = true,
  canvasContainer,
  onCanvasPortalActiveChange,
  onPendingChange,
  onUnauthorized,
}: Props) {
  const [phase, setPhase] = useState<
    'loading' | 'disabled' | 'ready' | 'error'
  >('loading');
  const [panelGeneration, setPanelGeneration] = useState(0);
  const [authoringCapability, setAuthoringCapability] = useState<
    'unknown' | 'enabled' | 'disabled' | 'error'
  >('unknown');
  const [processingCapability, setProcessingCapability] = useState<
    'unknown' | 'enabled' | 'disabled' | 'error'
  >('unknown');
  const [journalScopeLoaded, setJournalScopeLoaded] = useState('');
  const [annotationJournal, setAnnotationJournal] =
    useState<OwnerAnnotationJournalSnapshot>({ kind: 'none' });
  const [processingJournalScopeLoaded, setProcessingJournalScopeLoaded] =
    useState('');
  const [processingJournal, setProcessingJournal] =
    useState<AnnotationProcessingJournalSnapshot>({ kind: 'none' });
  const [editorPending, setEditorPending] = useState(false);
  const [processingPanelPending, setProcessingPanelPending] = useState(false);
  const [editorUnauthorized, setEditorUnauthorized] = useState(false);
  const [editorCanvasPortalActive, setEditorCanvasPortalActive] =
    useState(false);
  const [panelVisible, setPanelVisible] = useState(true);
  const [actor, setActor] = useState<string | null>(null);
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [inviteCursor, setInviteCursor] = useState<string | null>(null);
  const [versions, setVersions] = useState<PhotoVersionItem[]>([]);
  const [versionCursor, setVersionCursor] = useState<string | null>(null);
  const [head, setHead] = useState(currentVersionId);
  const [inviteId, setInviteId] = useState('');
  const [versionId, setVersionId] = useState(currentVersionId);
  const [items, setItems] = useState<OwnerAnnotationItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorReloadRequired, setCursorReloadRequired] = useState(false);
  const [readLoading, setReadLoading] = useState(false);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [error, setError] = useState('');
  const [optionError, setOptionError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState(0);
  const onEditorCanvasPortalActiveChange = useCallback(
    (active: boolean) => {
      setEditorCanvasPortalActive(active);
      onCanvasPortalActiveChange?.(active);
    },
    [onCanvasPortalActiveChange],
  );
  const [natural, setNatural] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const actorRef = useRef<string | null>(null);
  const inviteRef = useRef(inviteId),
    versionRef = useRef(versionId);
  const mounted = useRef(false),
    visible = useRef(true),
    generation = useRef(0),
    sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const rowsRef = useRef<OwnerAnnotationItem[]>([]);
  const cursorRef = useRef<string | null>(null);
  const lastActor = useRef<string | null>(null);
  const onPendingChangeRef = useRef(onPendingChange);
  const onUnauthorizedRef = useRef(onUnauthorized);
  const valid = useCallback(
    (owner: string, gen: number) =>
      mounted.current &&
      visible.current &&
      document.visibilityState !== 'hidden' &&
      generation.current === gen &&
      actorRef.current === owner,
    [],
  );
  const verify = useCallback(async (owner: string, signal: AbortSignal) => {
    const me = await readJson('/api/v1/me', ownerSchema, signal);
    if (me.actor.id !== owner) throw new ReadFailure('OWNER_CHANGED');
    return me;
  }, []);
  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
    onUnauthorizedRef.current = onUnauthorized;
  }, [onPendingChange, onUnauthorized]);
  useEffect(() => {
    if (!actor || authoringCapability !== 'enabled') return;
    const refreshJournal = () =>
      setAnnotationJournal(getOwnerAnnotationJournalSnapshot(actor, albumId));
    refreshJournal();
    return subscribeOwnerAnnotationJournal(actor, albumId, refreshJournal);
  }, [actor, albumId, authoringCapability]);
  useEffect(() => {
    if (!actor || processingCapability !== 'enabled') return;
    const refreshJournal = () =>
      setProcessingJournal(
        getAnnotationProcessingJournalSnapshot(actor, albumId),
      );
    const unsubscribe = subscribeAnnotationProcessingJournal(
      actor,
      albumId,
      refreshJournal,
    );
    void Promise.resolve().then(refreshJournal);
    return unsubscribe;
  }, [actor, albumId, processingCapability]);
  const onEditorPendingChange = useCallback(
    (pending: boolean) => {
      setEditorPending(pending);
      const owner = actorRef.current;
      if (owner)
        setAnnotationJournal(getOwnerAnnotationJournalSnapshot(owner, albumId));
    },
    [albumId],
  );
  const onProcessingPanelPendingChange = useCallback(
    (pending: boolean) => {
      setProcessingPanelPending(pending);
      const owner = actorRef.current;
      if (owner)
        setProcessingJournal(
          getAnnotationProcessingJournalSnapshot(owner, albumId),
        );
    },
    [albumId],
  );
  const invalidatePrivateOwnerView = useCallback(
    (expectedGeneration: number, authStatus: 401 | 403) => {
      if (
        !mounted.current ||
        !visible.current ||
        document.visibilityState === 'hidden' ||
        generation.current !== expectedGeneration
      )
        return;
      generation.current++;
      setPanelGeneration(generation.current);
      sequence.current++;
      controller.current?.abort();
      controller.current = null;
      actorRef.current = null;
      rowsRef.current = [];
      setActor(null);
      setItems([]);
      setCursor(null);
      setNatural(null);
      setPreviewFailed(false);
      setReadLoading(false);
      setOptionsBusy(false);
      setInvites([]);
      setVersions([]);
      setInviteCursor(null);
      setVersionCursor(null);
      cursorRef.current = null;
      setCursorReloadRequired(false);
      setInviteId('');
      inviteRef.current = '';
      setVersionId(currentVersionId);
      versionRef.current = currentVersionId;
      setError(
        authStatus === 401
          ? 'Owner 登入狀態已失效；目前註記與預覽已隱藏。'
          : 'Owner 權限已失效；目前註記與預覽已隱藏。',
      );
      setPhase('error');
      setEditorPending(false);
      setEditorUnauthorized(true);
      setProcessingPanelPending(false);
      onUnauthorizedRef.current?.(authStatus);
    },
    [currentVersionId],
  );
  const onEditorUnauthorized = useCallback(
    (
      selectedInviteId: string,
      selectedVersionId: string,
      authStatus: 401 | 403,
    ) => {
      if (
        inviteRef.current !== selectedInviteId ||
        versionRef.current !== selectedVersionId
      )
        return;
      invalidatePrivateOwnerView(generation.current, authStatus);
    },
    [invalidatePrivateOwnerView],
  );
  const reconcileProcessingItems = useCallback(
    (
      expectedGeneration: number,
      selectedInviteId: string,
      selectedVersionId: string,
      incoming: OwnerAnnotationItem[],
      sourceScope: {
        ownerId: string;
        albumId: string;
        inviteId: string;
        photoId: string;
        versionId: string;
      },
    ) => {
      const owner = actorRef.current;
      const gen = generation.current;
      if (
        !owner ||
        gen !== expectedGeneration ||
        !valid(owner, expectedGeneration) ||
        sourceScope.ownerId !== owner ||
        sourceScope.albumId !== albumId ||
        sourceScope.inviteId !== selectedInviteId ||
        sourceScope.photoId !== photoId ||
        sourceScope.versionId !== selectedVersionId ||
        inviteRef.current !== selectedInviteId ||
        versionRef.current !== selectedVersionId ||
        incoming.some(
          (item) =>
            item.photoId !== photoId || item.versionId !== selectedVersionId,
        )
      )
        return;
      let next: OwnerAnnotationItem[];
      try {
        next = mergeGuestAnnotationItems(rowsRef.current, incoming);
      } catch {
        setCursorReloadRequired(true);
        setError('註記與處理狀態的版本不一致，請重新載入第一頁後核對。');
        return;
      }
      rowsRef.current = next;
      setItems(next);
      if (cursorRef.current !== null) setCursorReloadRequired(true);
    },
    [albumId, photoId, valid],
  );
  const onProcessingUnauthorized = useCallback(
    (
      expectedGeneration: number,
      selectedInviteId: string,
      selectedVersionId: string,
      authStatus: 401 | 403,
    ) => {
      const owner = actorRef.current;
      const gen = generation.current;
      if (
        !owner ||
        gen !== expectedGeneration ||
        !valid(owner, expectedGeneration) ||
        inviteRef.current !== selectedInviteId ||
        versionRef.current !== selectedVersionId
      )
        return;
      invalidatePrivateOwnerView(gen, authStatus);
    },
    [invalidatePrivateOwnerView, valid],
  );
  // A read failure is not a write intent; known journals and live drafts still block navigation.
  const annotationPending =
    panelVisible &&
    phase !== 'disabled' &&
    ((editorPending && !editorUnauthorized) ||
      (authoringCapability === 'enabled' &&
        (annotationJournal.kind === 'pending' ||
          annotationJournal.kind === 'blocked' ||
          (phase === 'loading' &&
            !editorUnauthorized &&
            (!actor ||
              journalScopeLoaded !== JSON.stringify([actor, albumId]))))));
  const processingJournalPending =
    processingJournal.kind === 'pending' ||
    processingJournal.kind === 'blocked';
  const processingPending =
    panelVisible &&
    phase !== 'disabled' &&
    processingCapability === 'enabled' &&
    (processingPanelPending ||
      processingJournalPending ||
      (phase === 'loading' && processingJournalScopeLoaded === ''));
  const navigationPending = annotationPending || processingPending;
  const scopeSelectionLocked =
    editorPending && annotationJournal.kind === 'none';
  useEffect(() => {
    onPendingChangeRef.current?.(navigationPending);
  }, [navigationPending]);
  useEffect(() => {
    mounted.current = true;
    const clear = () => {
      generation.current++;
      setPanelGeneration(generation.current);
      sequence.current++;
      controller.current?.abort();
      actorRef.current = null;
      rowsRef.current = [];
      setActor(null);
      setItems([]);
      setCursor(null);
      cursorRef.current = null;
      setCursorReloadRequired(false);
      setNatural(null);
      setPreviewFailed(false);
      setReadLoading(false);
      setOptionsBusy(false);
      setInvites([]);
      setVersions([]);
      setInviteCursor(null);
      setVersionCursor(null);
      setError('');
      setOptionError('');
      setPhase('loading');
      setJournalScopeLoaded('');
      setAnnotationJournal({ kind: 'none' });
      setProcessingCapability('unknown');
      setProcessingJournalScopeLoaded('');
      setProcessingJournal({ kind: 'none' });
      setEditorPending(false);
      setProcessingPanelPending(false);
      setEditorUnauthorized(false);
    };
    const boot = async () => {
      clear();
      visible.current = document.visibilityState !== 'hidden';
      setPanelVisible(visible.current);
      if (!visible.current) return;
      const gen = generation.current,
        abort = new AbortController();
      controller.current = abort;
      try {
        const [cap, authoringCap, processingCap] = await Promise.all([
          readJson(
            '/api/v1/annotations/capabilities',
            ownerAnnotationsCapabilitiesSchema,
            abort.signal,
          ),
          readJson(
            '/api/v1/annotations/authoring/capabilities',
            ownerAnnotationAuthoringCapabilitiesSchema,
            abort.signal,
          ).catch((reason: unknown) => {
            if (authorizationFailureStatus(reason) !== null) throw reason;
            return null;
          }),
          readJson(
            '/api/v1/annotation-processing/capabilities',
            ownerAnnotationProcessingCapabilitiesSchema,
            abort.signal,
          ).catch((reason: unknown) => {
            if (authorizationFailureStatus(reason) !== null) throw reason;
            return null;
          }),
        ]);
        if (!mounted.current || gen !== generation.current || !visible.current)
          return;
        setProcessingCapability(
          processingCap === null
            ? 'error'
            : processingCap.enabled
              ? 'enabled'
              : 'disabled',
        );
        if (!cap.enabled) {
          setAuthoringCapability('disabled');
          setPhase('disabled');
          return;
        }
        if (authoringCap === null) {
          setAuthoringCapability('error');
        } else if (authoringCap.enabled) {
          setAuthoringCapability('enabled');
          setJournalScopeLoaded('');
        } else {
          setAuthoringCapability('disabled');
          setJournalScopeLoaded('');
          setAnnotationJournal({ kind: 'none' });
          setEditorPending(false);
        }
        const me = await readJson('/api/v1/me', ownerSchema, abort.signal);
        if (!mounted.current || gen !== generation.current || !visible.current)
          return;
        if (lastActor.current !== null && lastActor.current !== me.actor.id) {
          invalidatePrivateOwnerView(gen, 401);
          return;
        }
        lastActor.current = me.actor.id;
        actorRef.current = me.actor.id;
        setActor(me.actor.id);
        if (processingCap?.enabled) {
          setProcessingJournal(
            readAnnotationProcessingJournal(me.actor.id, albumId),
          );
          setProcessingJournalScopeLoaded(
            JSON.stringify([me.actor.id, albumId]),
          );
        } else {
          setProcessingJournal({ kind: 'none' });
          setProcessingJournalScopeLoaded('');
          setProcessingPanelPending(false);
        }
        if (authoringCap?.enabled) {
          setAnnotationJournal(
            readOwnerAnnotationJournal(me.actor.id, albumId),
          );
          setJournalScopeLoaded(JSON.stringify([me.actor.id, albumId]));
        }
        const [ip, vp] = await Promise.all([
          readJson(
            '/api/v1/projects/' + encodeURIComponent(projectId) + '/invites',
            invitePageSchema,
            abort.signal,
          ),
          readJson(
            '/api/v1/photos/' + encodeURIComponent(photoId) + '/versions',
            ownerPhotoVersionsPageSchema,
            abort.signal,
          ),
        ]);
        await verify(me.actor.id, abort.signal);
        if (!valid(me.actor.id, gen)) return;
        if (vp.photoId !== photoId) throw new ReadFailure('SCOPE_CHANGED');
        setInvites(
          ip.invites.filter(
            (inv) => inv.sealed && inv.albums.some((a) => a.id === albumId),
          ),
        );
        setInviteCursor(ip.nextCursor);
        setVersions(vp.versions);
        setVersionCursor(vp.nextCursor);
        setHead(vp.current.versionId);
        setCheckedAt(Date.now());
        setPhase('ready');
      } catch (reason) {
        if (mounted.current && gen === generation.current && visible.current) {
          const authStatus = authorizationFailureStatus(reason);
          if (authStatus !== null) {
            invalidatePrivateOwnerView(gen, authStatus);
            return;
          }
          actorRef.current = null;
          setActor(null);
          setItems([]);
          setPhase('error');
        }
      }
    };
    const hide = () => {
      visible.current = false;
      setPanelVisible(false);
      clear();
    };
    const show = () => {
      if (document.visibilityState !== 'hidden') void boot();
    };
    const visibility = () =>
      document.visibilityState === 'hidden' ? hide() : show();
    void boot();
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      hide();
      mounted.current = false;
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
      onPendingChangeRef.current?.(false);
    };
  }, [
    albumId,
    projectId,
    photoId,
    currentVersionId,
    refresh,
    valid,
    verify,
    invalidatePrivateOwnerView,
  ]);
  const selectedInvite = invites.find((inv) => inv.id === inviteId);
  const selectedVersion = versions.find((v) => v.id === versionId);
  const loadRows = useCallback(
    async (nextCursor?: string) => {
      const owner = actorRef.current,
        signal = controller.current?.signal,
        inv = inviteRef.current,
        ver = versionRef.current;
      if (
        !owner ||
        !signal ||
        signal.aborted ||
        !inv ||
        !ver ||
        !visible.current
      )
        return;
      const gen = generation.current,
        seq = ++sequence.current;
      const current = () =>
        valid(owner, gen) &&
        seq === sequence.current &&
        inviteRef.current === inv &&
        versionRef.current === ver;
      setReadLoading(true);
      setError('');
      if (!nextCursor) {
        rowsRef.current = [];
        setItems([]);
        cursorRef.current = null;
        setCursor(null);
      }
      try {
        await verify(owner, signal);
        const query = new URLSearchParams({ inviteId: inv });
        if (nextCursor) query.set('cursor', nextCursor);
        const page = await readJson(
          '/api/v1/albums/' +
            encodeURIComponent(albumId) +
            '/photos/' +
            encodeURIComponent(photoId) +
            '/versions/' +
            encodeURIComponent(ver) +
            '/annotations?' +
            query.toString(),
          ownerAnnotationsPageSchema,
          signal,
          ownerAnnotationReadCapabilityHeaders(freehandReadCapability),
        );
        await verify(owner, signal);
        if (!current()) return;
        if (
          page.inviteId !== inv ||
          page.photoId !== photoId ||
          page.versionId !== ver
        )
          throw new ReadFailure('SCOPE_CHANGED');
        const before = nextCursor ? rowsRef.current : [];
        const ids = new Set(before.map((item) => item.annotationId));
        if (page.items.some((item) => ids.has(item.annotationId)))
          throw new ReadFailure('OVERLAPPING_PAGE');
        const next = [...before, ...page.items];
        rowsRef.current = next;
        setItems(next);
        cursorRef.current = page.nextCursor;
        setCursor(page.nextCursor);
        if (!nextCursor) setCursorReloadRequired(false);
      } catch (reason) {
        if (current()) {
          const authStatus = authorizationFailureStatus(reason);
          if (authStatus !== null) {
            invalidatePrivateOwnerView(gen, authStatus);
            return;
          }
          rowsRef.current = [];
          setItems([]);
          setReadLoading(false);
          if (isOwnerAnnotationUpgradeRequired(reason)) {
            cursorRef.current = null;
            setCursor(null);
            setCursorReloadRequired(false);
          }
          if (
            nextCursor &&
            reason instanceof ReadFailure &&
            reason.code === 'ANNOTATION_HISTORY_CHANGED'
          ) {
            cursorRef.current = null;
            setCursor(null);
            setCursorReloadRequired(true);
          }
          if (!(
            reason instanceof ReadFailure &&
            reason.code === 'ANNOTATION_HISTORY_CHANGED'
          )) {
            actorRef.current = null;
            setActor(null);
            setNatural(null);
            setPhase('error');
          }
          setError(
            isOwnerAnnotationUpgradeRequired(reason)
              ? OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE
              : reason instanceof ReadFailure &&
                  reason.code === 'ANNOTATION_HISTORY_CHANGED'
                ? '註記已變更，請重新載入。'
                : '目前無法讀取此邀請與版本的註記，請重新確認權限後載入。',
          );
        }
      } finally {
        if (current()) setReadLoading(false);
      }
    },
    [
      albumId,
      freehandReadCapability,
      photoId,
      valid,
      verify,
      invalidatePrivateOwnerView,
    ],
  );
  useEffect(() => {
    // Reset the previous private scope before synchronizing the selected API page.
    sequence.current++;
    rowsRef.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- private scope must clear before its asynchronous read.
    setItems([]);
    setCursor(null);
    setReadLoading(false);
    setError('');
    // Scope-change handlers and bootstrap already clear image state before
    // commit. Do not erase a cached image's onLoad dimensions in this passive
    // effect: that event can arrive first and will not fire a second time.
    if (phase === 'ready' && selectedInvite && selectedVersion) void loadRows();
  }, [
    phase,
    actor,
    inviteId,
    versionId,
    selectedInvite,
    selectedVersion,
    loadRows,
  ]);
  const moreOptions = async (kind: 'invites' | 'versions') => {
    const owner = actorRef.current,
      signal = controller.current?.signal,
      next = kind === 'invites' ? inviteCursor : versionCursor;
    if (!owner || !signal || signal.aborted || !next || optionsBusy) return;
    const gen = generation.current;
    setOptionsBusy(true);
    setOptionError('');
    try {
      await verify(owner, signal);
      if (kind === 'invites') {
        const page = await readJson(
          '/api/v1/projects/' +
            encodeURIComponent(projectId) +
            '/invites?cursor=' +
            encodeURIComponent(next),
          invitePageSchema,
          signal,
        );
        await verify(owner, signal);
        if (!valid(owner, gen)) return;
        setInvites((old) => {
          const ids = new Set(old.map((i) => i.id));
          return [
            ...old,
            ...page.invites.filter(
              (inv) =>
                inv.sealed &&
                inv.albums.some((a) => a.id === albumId) &&
                !ids.has(inv.id),
            ),
          ];
        });
        setInviteCursor(page.nextCursor);
      } else {
        const page = await readJson(
          '/api/v1/photos/' +
            encodeURIComponent(photoId) +
            '/versions?cursor=' +
            encodeURIComponent(next),
          ownerPhotoVersionsPageSchema,
          signal,
        );
        await verify(owner, signal);
        if (!valid(owner, gen)) return;
        if (page.photoId !== photoId) throw new ReadFailure('SCOPE_CHANGED');
        setVersions((old) => {
          const ids = new Set(old.map((v) => v.id));
          return [...old, ...page.versions.filter((v) => !ids.has(v.id))];
        });
        setVersionCursor(page.nextCursor);
        setHead(page.current.versionId);
      }
    } catch (reason) {
      if (valid(owner, gen)) {
        const authStatus = authorizationFailureStatus(reason);
        if (authStatus !== null) {
          invalidatePrivateOwnerView(gen, authStatus);
          return;
        }
        // Failed fresh authorization must not leave the prior private page visible.
        sequence.current++;
        rowsRef.current = [];
        setItems([]);
        setCursor(null);
        setNatural(null);
        setOptionsBusy(false);
        actorRef.current = null;
        setActor(null);
        setPhase('error');
        setOptionError('清單載入失敗，請重新確認權限後載入。');
      }
    } finally {
      if (valid(owner, gen)) setOptionsBusy(false);
    }
  };

  const resetSelectedScope = () => {
    // Event-batched reset prevents the previous scope appearing under new selectors.
    sequence.current++;
    rowsRef.current = [];
    setItems([]);
    cursorRef.current = null;
    setCursor(null);
    setCursorReloadRequired(false);
    setNatural(null);
    setPreviewFailed(false);
    setReadLoading(false);
    setError('');
  };
  const reload = () => setRefresh((value) => value + 1);
  if (phase === 'disabled') return null;
  if (phase !== 'ready')
    return (
      <section
        data-testid="owner-annotations-panel"
        aria-label={'客戶註記檢視：' + filename}
        className="min-w-0 rounded-xl bg-stone-50 p-3 text-stone-900"
      >
        <h2 className="font-semibold">客戶註記（唯讀）</h2>
        <p
          role={phase === 'error' ? 'alert' : 'status'}
          className="mt-2 text-sm"
        >
          {phase === 'error'
            ? '目前無法確認註記檢視權限，請重新載入。'
            : '正在確認註記檢視權限…'}
        </p>
        {phase === 'error' && (
          <button
            type="button"
            data-testid="owner-annotation-reload"
            className="mt-3 min-h-11 rounded border px-3"
            onClick={reload}
          >
            重新載入註記
          </button>
        )}
      </section>
    );
  const liveShapes = items.filter(
    (item) => item.state !== 'deleted' && item.geometry !== null,
  );
  return (
    <section
      data-testid="owner-annotations-panel"
      aria-label={'客戶註記檢視：' + filename}
      className="min-w-0 rounded-xl bg-stone-50 p-3 text-stone-900 sm:p-4"
    >
      <h2 className="font-semibold">客戶註記（唯讀）</h2>
      <p className="mt-1 text-sm">請選擇客戶邀請與照片版本。</p>
      <p className="mt-1 break-words text-xs text-stone-600">{filename}</p>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label
          className="min-w-0 text-sm"
          htmlFor={'owner-annotation-invite-' + albumId}
        >
          客戶邀請
          <select
            id={'owner-annotation-invite-' + albumId}
            data-testid="owner-annotation-invite"
            value={inviteId}
            disabled={scopeSelectionLocked}
            className="mt-1 min-h-11 w-full min-w-0 rounded border bg-white p-2"
            onChange={(event) => {
              if (scopeSelectionLocked) return;
              if (event.currentTarget.value === inviteRef.current) return;
              resetSelectedScope();
              inviteRef.current = event.currentTarget.value;
              setInviteId(event.currentTarget.value);
            }}
          >
            <option value="">選擇邀請</option>
            {invites.map((inv, index) => (
              <option key={inv.id} value={inv.id}>
                {'邀請 ' +
                  (index + 1) +
                  ' · ' +
                  time(inv.createdAt) +
                  (inv.revokedAt
                    ? ' · 已撤銷'
                    : inv.expiryMode === 'inherit_album' ||
                        inv.expiresAt === null
                      ? ' · 依相簿規則'
                      : Date.parse(inv.expiresAt) <= checkedAt
                        ? ' · 已到期'
                        : ' · 使用中')}
              </option>
            ))}
          </select>
        </label>
        <label
          className="min-w-0 text-sm"
          htmlFor={'owner-annotation-version-' + albumId}
        >
          註記版本
          <select
            id={'owner-annotation-version-' + albumId}
            data-testid="owner-annotation-version"
            value={selectedVersion ? versionId : ''}
            disabled={scopeSelectionLocked}
            className="mt-1 min-h-11 w-full min-w-0 rounded border bg-white p-2"
            onChange={(event) => {
              if (scopeSelectionLocked) return;
              if (event.currentTarget.value === versionRef.current) return;
              resetSelectedScope();
              versionRef.current = event.currentTarget.value;
              setVersionId(event.currentTarget.value);
            }}
          >
            <option value="" disabled>
              選擇已處理版本
            </option>
            {versions
              .filter((v) => v.processing === 'succeeded')
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {'第 ' +
                    v.versionNo +
                    ' 版' +
                    (v.id === head ? ' · 目前版本' : '')}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {inviteCursor && (
          <button
            type="button"
            data-testid="owner-annotation-invites-more"
            disabled={optionsBusy}
            className="min-h-11 rounded border px-3"
            onClick={() => void moreOptions('invites')}
          >
            載入更多邀請
          </button>
        )}
        {versionCursor && (
          <button
            type="button"
            data-testid="owner-annotation-versions-more"
            disabled={optionsBusy}
            className="min-h-11 rounded border px-3"
            onClick={() => void moreOptions('versions')}
          >
            載入更多版本
          </button>
        )}
        <button
          type="button"
          data-testid="owner-annotation-reload"
          className="min-h-11 rounded border px-3"
          onClick={reload}
        >
          重新載入註記
        </button>
      </div>
      {optionError && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {optionError}
        </p>
      )}
      {!selectedInvite && (
        <p className="mt-3 text-sm text-stone-600">
          選擇邀請後載入該範圍的註記。
        </p>
      )}
      {selectedInvite && !selectedVersion && (
        <p className="mt-3 text-sm text-stone-600">
          請選擇版本；可載入更多版本尋找先前的照片。
        </p>
      )}
      {selectedInvite && selectedVersion && (
        <>
          <p className="mt-3 text-sm font-medium">
            第 {selectedVersion.versionNo} 版的客戶註記
          </p>
          {(selectedInvite.revokedAt ||
            (selectedInvite.expiryMode !== 'inherit_album' &&
              selectedInvite.expiresAt !== null &&
              Date.parse(selectedInvite.expiresAt) <= checkedAt)) && (
            <p className="mt-1 text-xs text-amber-800">
              邀請已停止客戶存取；此處保留攝影師檢視。
            </p>
          )}
          {selectedVersion.previewUrl &&
            !previewFailed &&
            !editorCanvasPortalActive && (
              <div
                className="relative mt-3 w-full overflow-hidden rounded border border-stone-300 bg-stone-100"
                style={
                  natural
                    ? {
                        aspectRatio:
                          String(natural.width) +
                          ' / ' +
                          String(natural.height),
                      }
                    : undefined
                }
              >
                <img
                  key={
                    String(actor) +
                    ':' +
                    inviteId +
                    ':' +
                    selectedVersion.id +
                    ':' +
                    selectedVersion.previewUrl
                  }
                  data-testid="owner-annotation-preview"
                  src={selectedVersion.previewUrl}
                  alt={
                    filename +
                    ' 第 ' +
                    selectedVersion.versionNo +
                    ' 版註記預覽'
                  }
                  className="block h-auto w-full"
                  onLoad={(event) => {
                    if (
                      inviteRef.current !== inviteId ||
                      versionRef.current !== selectedVersion.id ||
                      actorRef.current !== actor ||
                      !visible.current
                    )
                      return;
                    const image = event.currentTarget;
                    if (image.naturalWidth > 0 && image.naturalHeight > 0)
                      setNatural({
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      });
                    else setPreviewFailed(true);
                  }}
                  onError={() => {
                    if (
                      inviteRef.current !== inviteId ||
                      versionRef.current !== selectedVersion.id ||
                      actorRef.current !== actor ||
                      !visible.current
                    )
                      return;
                    setNatural(null);
                    setPreviewFailed(true);
                  }}
                />
                {natural && (
                  <svg
                    data-testid="owner-annotation-overlay"
                    role="img"
                    aria-label="客戶註記圖層（唯讀）"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox={
                      '0 0 ' +
                      ANNOTATION_COORDINATE_SCALE +
                      ' ' +
                      ANNOTATION_COORDINATE_SCALE
                    }
                    preserveAspectRatio="none"
                  >
                    {liveShapes.map((item, index) => {
                      const geometry = item.geometry;
                      if (!geometry || !item.style) return null;
                      const stroke = colors[item.style.color];
                      const title = item.authorLabel + ' · 註記 ' + (index + 1);
                      return geometry.type === 'point' ? (
                        <ellipse
                          key={item.annotationId}
                          data-testid={
                            'owner-annotation-shape-' + item.annotationId
                          }
                          cx={geometry.x}
                          cy={geometry.y}
                          rx={18000}
                          ry={(18000 * natural.width) / natural.height}
                          fill={stroke}
                          fillOpacity={0.25}
                          stroke={stroke}
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>{title}</title>
                        </ellipse>
                      ) : geometry.type === 'freehand' ? (
                        <polyline
                          key={item.annotationId}
                          data-testid={
                            'owner-annotation-shape-' + item.annotationId
                          }
                          points={geometry.points
                            .map((point) => `${point.x},${point.y}`)
                            .join(' ')}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>{title}</title>
                        </polyline>
                      ) : (
                        <rect
                          key={item.annotationId}
                          data-testid={
                            'owner-annotation-shape-' + item.annotationId
                          }
                          x={geometry.x}
                          y={geometry.y}
                          width={geometry.width}
                          height={geometry.height}
                          fill={stroke}
                          fillOpacity={0.12}
                          stroke={stroke}
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        >
                          <title>{title}</title>
                        </rect>
                      );
                    })}
                  </svg>
                )}
              </div>
            )}
          {(previewFailed || !selectedVersion.previewUrl) && (
            <p role="status" className="mt-3 text-sm text-stone-600">
              此版本的預覽目前無法取得，註記紀錄仍保留。
            </p>
          )}
          {readLoading && (
            <p role="status" className="mt-3 text-sm">
              正在讀取註記…
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {error}
            </p>
          )}
          {!readLoading && !error && items.length === 0 && (
            <p className="mt-3 text-sm text-stone-600">
              此邀請與版本目前沒有註記。
            </p>
          )}
          <ol className="mt-3 grid min-w-0 gap-2">
            {items.map((item, index) => (
              <li
                data-testid={'owner-annotation-item-' + item.annotationId}
                key={item.annotationId}
                className="min-w-0 rounded border border-stone-300 bg-white p-3 text-sm"
              >
                <p className="break-words font-medium">
                  {item.authorLabel} · 註記 {index + 1}
                </p>
                <p className="mt-1">
                  {item.geometry?.type === 'point'
                    ? '點註記'
                    : item.geometry?.type === 'rectangle'
                      ? '範圍註記'
                      : item.geometry?.type === 'freehand'
                        ? '自由筆畫'
                        : '已刪除註記'}{' '}
                  · {status(item.state)} · 第 {item.revision} 次修訂
                </p>
                <p className="mt-1 text-xs text-stone-600">
                  {time(item.updatedAt)}
                </p>
                {item.commentId && (
                  <p className="mt-1 text-xs text-stone-600">已連結客戶留言</p>
                )}
              </li>
            ))}
          </ol>
          {cursorReloadRequired && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
              <p role="status" className="text-sm">
                註記清單已有新變更。請重新載入第一頁後再載入更多。
              </p>
              <button
                type="button"
                data-testid="owner-annotation-history-reload"
                disabled={readLoading}
                className="mt-2 min-h-11 rounded border px-3 text-sm disabled:opacity-50"
                onClick={() => void loadRows()}
              >
                重新載入註記清單
              </button>
            </div>
          )}
          {cursor && !cursorReloadRequired && (
            <button
              type="button"
              data-testid="owner-annotation-more"
              disabled={readLoading}
              className="mt-3 min-h-11 rounded border px-3 text-sm"
              onClick={() => void loadRows(cursor)}
            >
              載入更多註記
            </button>
          )}
          {selectedInvite &&
            selectedVersion &&
            actor &&
            processingCapability === 'enabled' &&
            phase === 'ready' &&
            !editorUnauthorized && (
              <OwnerAnnotationProcessingPanel
                key={
                  'owner-annotation-processing:' +
                  albumId +
                  ':' +
                  selectedInvite.id +
                  ':' +
                  photoId +
                  ':' +
                  selectedVersion.id
                }
                ownerId={actor}
                albumId={albumId}
                inviteId={selectedInvite.id}
                photoId={photoId}
                versionId={selectedVersion.id}
                items={items}
                freehandReadCapability={freehandReadCapability}
                onUpgradeRequired={() => {
                  if (
                    actorRef.current !== actor ||
                    inviteRef.current !== selectedInvite.id ||
                    versionRef.current !== selectedVersion.id ||
                    !visible.current
                  )
                    return;
                  sequence.current++;
                  rowsRef.current = [];
                  cursorRef.current = null;
                  actorRef.current = null;
                  setActor(null);
                  setItems([]);
                  setCursor(null);
                  setCursorReloadRequired(false);
                  setReadLoading(false);
                  setNatural(null);
                  setError(OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE);
                  setPhase('error');
                }}
                onReconcile={(currentItems, sourceScope) =>
                  reconcileProcessingItems(
                    panelGeneration,
                    selectedInvite.id,
                    selectedVersion.id,
                    currentItems,
                    sourceScope,
                  )
                }
                onPendingChange={onProcessingPanelPendingChange}
                onUnauthorized={(authStatus) =>
                  onProcessingUnauthorized(
                    panelGeneration,
                    selectedInvite.id,
                    selectedVersion.id,
                    authStatus,
                  )
                }
              />
            )}
          {selectedInvite &&
            selectedVersion &&
            authoringCapability !== 'disabled' &&
            phase === 'ready' &&
            !editorUnauthorized && (
              <OwnerAnnotationEditor
                key={
                  'owner-annotation-editor:' +
                  albumId +
                  ':' +
                  selectedInvite.id +
                  ':' +
                  photoId +
                  ':' +
                  selectedVersion.id
                }
                albumId={albumId}
                inviteId={selectedInvite.id}
                photoId={photoId}
                versionId={selectedVersion.id}
                filename={filename}
                previewUrl={selectedVersion.previewUrl}
                canvasContainer={canvasContainer}
                onCanvasPortalActiveChange={onEditorCanvasPortalActiveChange}
                freehandReadCapability={freehandReadCapability}
                onPendingChange={onEditorPendingChange}
                onUnauthorized={(authStatus) =>
                  onEditorUnauthorized(
                    selectedInvite.id,
                    selectedVersion.id,
                    authStatus,
                  )
                }
              />
            )}
        </>
      )}
    </section>
  );
}
