'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { z } from 'zod';
import {
  albumOwnerFeedbackCommandSchema,
  albumOwnerFeedbackPageSchema,
  albumOwnerFeedbackResultSchema,
  type AlbumOwnerFeedbackCommand,
  type AlbumOwnerFeedbackItem,
  type AlbumOwnerFeedbackPage,
  type AlbumOwnerFeedbackResult,
} from '../../../packages/contracts/src/album-owner-feedback.ts';
import { guestCommentBodySchema } from '../../../packages/contracts/src/guest-comments.ts';
import type { AnnotationGeometry } from '../../../packages/contracts/src/annotation-geometry.ts';
import type { AnnotationStyle } from '../../../packages/contracts/src/annotation-style.ts';
import { freehandAnnotationWriteCapabilitiesSchema } from '../../../packages/contracts/src/freehand-annotation-capabilities.ts';
import {
  AnnotationCanvas,
  type AnnotationCanvasImageState,
  type AnnotationTool,
  type CanvasAnnotation,
} from './annotation-canvas.tsx';
import { StudioIcon } from './studio-icons';
import {
  clearAlbumOwnerFeedbackIntent,
  readAlbumOwnerFeedbackJournal,
  saveAlbumOwnerFeedbackIntent,
  sameAlbumOwnerFeedbackJournalMetadata,
  updateAlbumOwnerFeedbackJournalStatus,
  type AlbumOwnerFeedbackJournalMetadata,
  type AlbumOwnerFeedbackJournalSnapshot,
} from './album-owner-feedback-journal.ts';

const currentOwnerSchema = z
  .object({
    actor: z.object({ id: z.uuid() }).strict(),
    role: z.literal('owner'),
    sessionId: z.string().min(1),
  })
  .strict();

type Props = {
  albumId: string;
  photoId: string;
  versionId: string;
  filename: string;
  previewUrl: string | null;
  canvasSuppressed?: boolean | undefined;
  canvasContainer?: HTMLElement | null | undefined;
  onCanvasPortalActiveChange?: ((active: boolean) => void) | undefined;
  onPendingChange?: (pending: boolean) => void;
  onUnauthorized?: ((status: 401 | 403) => void) | undefined;
};

export type AlbumOwnerFeedbackProps = Props &
  (
    | { role: 'owner'; kind: 'comment' | 'annotation' }
    | { role: 'guest'; kind: 'all'; onPendingChange?: never }
  );

type ApiError = Error & { status: number; code: string | null };
const emptyJournal: AlbumOwnerFeedbackJournalSnapshot = { kind: 'none' };

function apiError(status: number, code: string | null): ApiError {
  return Object.assign(new Error(code ?? 'OWNER_FEEDBACK_REQUEST_FAILED'), {
    status,
    code,
  });
}

function responseErrorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return null;
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return null;
  return typeof error.code === 'string' ? error.code : null;
}

async function fetchJson<T>(
  url: string,
  schema: { parse: (value: unknown) => T },
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw apiError(response.status, responseErrorCode(body));
    try {
      return schema.parse(body);
    } catch {
      throw apiError(0, 'INVALID_RESPONSE');
    }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      'code' in error
    )
      throw error;
    throw apiError(0, 'NETWORK_UNKNOWN');
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}

function feedbackPath(
  role: 'owner' | 'guest',
  albumId: string,
  photoId: string,
  versionId: string,
  cursor: string | null,
) {
  const prefix = role === 'owner' ? '/api/v1/albums/' : '/api/guest/albums/';
  const path =
    prefix +
    encodeURIComponent(albumId) +
    '/photos/' +
    encodeURIComponent(photoId) +
    '/versions/' +
    encodeURIComponent(versionId) +
    '/owner-feedback';
  const url = new URL(path, window.location.origin);
  if (cursor !== null) url.searchParams.set('cursor', cursor);
  return url.pathname + url.search;
}

function safePreviewUrl(
  role: 'owner' | 'guest',
  input: string | null,
  photoId: string,
  versionId: string,
): string | null {
  if (input === null || typeof window === 'undefined') return null;
  try {
    const parsed = new URL(input, window.location.origin);
    const prefix = role === 'owner' ? '/api/v1/photos/' : '/api/guest/photos/';
    const expected =
      prefix +
      encodeURIComponent(photoId) +
      '/versions/' +
      encodeURIComponent(versionId) +
      '/assets/preview';
    return parsed.origin === window.location.origin &&
      parsed.pathname === expected &&
      parsed.search === '' &&
      parsed.hash === ''
      ? parsed.pathname
      : null;
  } catch {
    return null;
  }
}

function checkPageScope(
  page: AlbumOwnerFeedbackPage,
  target: Pick<Props, 'albumId' | 'photoId' | 'versionId'>,
) {
  if (
    page.albumId !== target.albumId ||
    page.photoId !== target.photoId ||
    page.versionId !== target.versionId
  )
    throw apiError(0, 'INVALID_RESPONSE');
}

function checkResultScope(
  result: AlbumOwnerFeedbackResult,
  command: AlbumOwnerFeedbackCommand,
  target: Pick<Props, 'albumId' | 'photoId' | 'versionId'>,
) {
  if (
    result.requestId !== command.requestId ||
    result.operation !== command.operation ||
    result.item.albumId !== target.albumId ||
    result.item.photoId !== target.photoId ||
    result.item.versionId !== target.versionId
  )
    throw apiError(0, 'INVALID_RESPONSE');
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function toCanvasAnnotation(
  item: Extract<AlbumOwnerFeedbackItem, { kind: 'annotation' }>,
): CanvasAnnotation | null {
  if (item.state !== 'open' || item.geometry === null || item.style === null)
    return null;
  return {
    annotationId: item.id,
    geometry: item.geometry,
    style: item.style,
    state: 'open',
  };
}

function sameScope(
  metadata: AlbumOwnerFeedbackJournalMetadata,
  target: Pick<Props, 'albumId' | 'photoId' | 'versionId'>,
  actorId: string,
  kind: 'comment' | 'annotation',
) {
  return (
    metadata.actorId === actorId &&
    metadata.albumId === target.albumId &&
    metadata.photoId === target.photoId &&
    metadata.versionId === target.versionId &&
    metadata.kind === kind
  );
}

export function AlbumOwnerFeedback(props: AlbumOwnerFeedbackProps) {
  const {
    role,
    kind,
    albumId,
    photoId,
    versionId,
    filename,
    previewUrl,
    canvasSuppressed = false,
    canvasContainer = null,
    onCanvasPortalActiveChange,
    onPendingChange,
    onUnauthorized,
  } = props;
  const rootRef = useRef<HTMLElement>(null);
  const contextKey = JSON.stringify([role, kind, albumId, photoId, versionId]);
  const [visible, setVisible] = useState(false);
  const [loadStatus, setLoadStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [items, setItems] = useState<AlbumOwnerFeedbackItem[]>([]);
  const itemsRef = useRef(items);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [reloadSequence, setReloadSequence] = useState(0);
  const [actorId, setActorId] = useState<string | null>(null);
  const actorIdRef = useRef<string | null>(null);
  const [journal, setJournal] =
    useState<AlbumOwnerFeedbackJournalSnapshot>(emptyJournal);
  const [requestPending, setRequestPending] = useState(false);
  const pendingRef = useRef(false);
  const [commentBody, setCommentBody] = useState('');
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [draftGeometry, setDraftGeometry] = useState<AnnotationGeometry | null>(
    null,
  );
  const [draftColor, setDraftColor] =
    useState<AnnotationStyle['color']>('amber');
  const [tool, setTool] = useState<AnnotationTool>('rectangle');
  const [freehandMode, setFreehandMode] = useState(false);
  const [freehandWriteEnabled, setFreehandWriteEnabled] = useState(false);
  const [imageState, setImageState] = useState<AnnotationCanvasImageState>({
    status: 'empty',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadGenerationRef = useRef(0);
  const readControllerRef = useRef<AbortController | null>(null);
  const latestContextRef = useRef(contextKey);
  const previousContextRef = useRef(contextKey);
  const mountedRef = useRef(false);
  const pendingCallbackRef = useRef(onPendingChange);
  const unauthorizedCallbackRef = useRef(onUnauthorized);
  const portalCallbackRef = useRef(onCanvasPortalActiveChange);
  const portalActiveRef = useRef(false);
  const id = useId();

  const beginLoad = useCallback(() => {
    setLoadStatus('loading');
    setError('');
    setNotice('');
    setMoreError(false);
    setLoadingMore(false);
    itemsRef.current = [];
    setItems([]);
    setNextCursor(null);
    setActorId(null);
    actorIdRef.current = null;
  }, []);

  const reportRequestPending = useCallback((value: boolean) => {
    if (pendingRef.current === value) return;
    pendingRef.current = value;
    setRequestPending(value);
  }, []);
  const setCanvasPortalActive = useCallback((value: boolean) => {
    if (portalActiveRef.current === value) return;
    portalActiveRef.current = value;
    portalCallbackRef.current?.(value);
  }, []);
  const writeJournal = useCallback(
    (value: AlbumOwnerFeedbackJournalSnapshot) => {
      setJournal(value);
      reportRequestPending(
        value.kind === 'pending' && value.status !== 'conflict',
      );
    },
    [reportRequestPending],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      readControllerRef.current?.abort();
      setCanvasPortalActive(false);
      pendingCallbackRef.current?.(false);
    };
  }, [setCanvasPortalActive]);

  useLayoutEffect(() => {
    pendingCallbackRef.current = onPendingChange;
    unauthorizedCallbackRef.current = onUnauthorized;
    portalCallbackRef.current = onCanvasPortalActiveChange;
    latestContextRef.current = contextKey;
    if (previousContextRef.current !== contextKey) {
      previousContextRef.current = contextKey;
      loadGenerationRef.current += 1;
      readControllerRef.current?.abort();
      actorIdRef.current = null;
      setActorId(null);
      itemsRef.current = [];
      setItems([]);
      setCommentBody('');
      setEditingComment(null);
      setDraftGeometry(null);
      setDraftColor('amber');
      setTool('rectangle');
      setFreehandMode(false);
      setFreehandWriteEnabled(false);
      setImageState({ status: 'empty' });
      setJournal(emptyJournal);
      setLoadStatus(visible ? 'loading' : 'idle');
      if (!pendingRef.current) reportRequestPending(false);
    }
  }, [
    contextKey,
    onCanvasPortalActiveChange,
    onPendingChange,
    onUnauthorized,
    reportRequestPending,
    visible,
  ]);

  const unsavedDraft =
    role === 'owner' &&
    ((kind === 'comment' && (commentBody !== '' || editingComment !== null)) ||
      (kind === 'annotation' && draftGeometry !== null));
  const reportedPending = requestPending || unsavedDraft;
  const canMutateItems =
    role === 'owner' &&
    actorId !== null &&
    loadStatus === 'ready' &&
    !requestPending &&
    journal.kind === 'none' &&
    !unsavedDraft;
  useEffect(() => {
    pendingCallbackRef.current?.(reportedPending);
  }, [onPendingChange, reportedPending]);

  useEffect(() => {
    const details = rootRef.current?.closest('details');
    if (!details) {
      setVisible(true);
      return;
    }
    setVisible(details.open);
    const onToggle = () => {
      if (details.open) beginLoad();
      setVisible(details.open);
    };
    details.addEventListener('toggle', onToggle);
    return () => details.removeEventListener('toggle', onToggle);
  }, [beginLoad]);

  const safePreview = safePreviewUrl(role, previewUrl, photoId, versionId);

  const resetForUnauthorized = useCallback(
    (status: 401 | 403) => {
      actorIdRef.current = null;
      setActorId(null);
      itemsRef.current = [];
      setItems([]);
      setNextCursor(null);
      setCommentBody('');
      setEditingComment(null);
      setDraftGeometry(null);
      setImageState({ status: 'empty' });
      setFreehandWriteEnabled(false);
      setError(
        role === 'guest'
          ? '連結目前無法使用，請重新開啟。'
          : status === 401
            ? '登入狀態已失效，請重新登入後再載入。'
            : '目前無法載入意見，請重新載入。',
      );
      setLoadStatus('error');
      writeJournal(emptyJournal);
      setCanvasPortalActive(false);
      unauthorizedCallbackRef.current?.(status);
    },
    [role, setCanvasPortalActive, writeJournal],
  );

  const readPage = useCallback(
    async (cursor: string | null, signal: AbortSignal) => {
      const page = await fetchJson(
        feedbackPath(role, albumId, photoId, versionId, cursor),
        albumOwnerFeedbackPageSchema,
        { signal },
      );
      checkPageScope(page, { albumId, photoId, versionId });
      return page;
    },
    [albumId, photoId, role, versionId],
  );

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    readControllerRef.current?.abort();
    readControllerRef.current = controller;
    const generation = ++loadGenerationRef.current;

    void (async () => {
      try {
        let currentActorId: string | null = null;
        if (role === 'owner') {
          const owner = await fetchJson('/api/v1/me', currentOwnerSchema, {
            signal: controller.signal,
          });
          currentActorId = owner.actor.id;
          actorIdRef.current = currentActorId;
          setActorId(currentActorId);
          if (kind === 'annotation') {
            let enabled = false;
            try {
              const capability = await fetchJson(
                '/api/v1/annotations/authoring/freehand-capabilities',
                freehandAnnotationWriteCapabilitiesSchema,
                { signal: controller.signal },
              );
              enabled = capability.enabled;
            } catch (reason) {
              const failure = reason as Partial<ApiError>;
              if (failure.status === 401 || failure.status === 403)
                throw reason;
            }
            if (controller.signal.aborted) return;
            setFreehandWriteEnabled(enabled);
            if (!enabled) setFreehandMode(false);
          }
          const currentJournal = readAlbumOwnerFeedbackJournal({
            actorId: currentActorId,
            albumId,
            photoId,
            versionId,
            kind,
          });
          let recoveredJournal = currentJournal;
          if (
            currentJournal.kind === 'pending' &&
            currentJournal.status === 'ready'
          ) {
            const updated = updateAlbumOwnerFeedbackJournalStatus(
              currentJournal.metadata,
              'uncertain',
            );
            recoveredJournal = {
              ...currentJournal,
              metadata: updated
                ? { ...currentJournal.metadata, status: 'uncertain' }
                : currentJournal.metadata,
              status: 'uncertain',
            };
          }
          writeJournal(recoveredJournal);
          if (recoveredJournal.kind === 'pending') {
            const command = recoveredJournal.command;
            if (command.operation === 'create_comment') {
              setCommentBody(command.body);
              setEditingComment(null);
            } else if (command.operation === 'update_comment') {
              setCommentBody(command.body);
              setEditingComment(command.feedbackId);
            }
            if (
              command.operation === 'create_annotation' ||
              command.operation === 'update_annotation'
            ) {
              setDraftGeometry(command.geometry);
              setDraftColor(command.style.color);
            }
            if (recoveredJournal.status === 'conflict')
              setError('意見內容已變更，請重新載入後再試。');
            else setError('結果尚未確認，草稿已保留。');
          }
        }

        const page = await readPage(null, controller.signal);
        if (
          controller.signal.aborted ||
          generation !== loadGenerationRef.current ||
          latestContextRef.current !== contextKey ||
          !mountedRef.current
        )
          return;
        itemsRef.current = page.items;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setLoadStatus('ready');
      } catch (reason) {
        if (
          controller.signal.aborted ||
          generation !== loadGenerationRef.current ||
          latestContextRef.current !== contextKey ||
          !mountedRef.current
        )
          return;
        const failure = reason as Partial<ApiError>;
        if (failure.status === 401 || failure.status === 403) {
          resetForUnauthorized(failure.status);
          return;
        }
        setLoadStatus('error');
        setError('目前無法載入意見，請重新載入。');
      }
    })();

    return () => {
      controller.abort();
      if (readControllerRef.current === controller)
        readControllerRef.current = null;
    };
  }, [
    albumId,
    kind,
    readPage,
    reloadSequence,
    resetForUnauthorized,
    photoId,
    role,
    versionId,
    visible,
    contextKey,
    writeJournal,
  ]);

  const loadMore = async () => {
    const cursor = nextCursor;
    const controller = readControllerRef.current;
    const requestContext = contextKey;
    if (!visible || !cursor || loadingMore || !controller) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await readPage(cursor, controller.signal);
      if (
        controller.signal.aborted ||
        !mountedRef.current ||
        latestContextRef.current !== requestContext
      )
        return;
      if (
        page.nextCursor === cursor ||
        page.items.some((item) =>
          itemsRef.current.some((current) => current.id === item.id),
        )
      )
        throw apiError(0, 'INVALID_RESPONSE');
      const next = [...itemsRef.current, ...page.items];
      itemsRef.current = next;
      setItems(next);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      if (
        controller.signal.aborted ||
        latestContextRef.current !== requestContext
      )
        return;
      const failure = reason as Partial<ApiError>;
      if (failure.status === 401 || failure.status === 403) {
        resetForUnauthorized(failure.status);
        return;
      }
      setMoreError(true);
    } finally {
      if (
        !controller.signal.aborted &&
        mountedRef.current &&
        latestContextRef.current === requestContext
      )
        setLoadingMore(false);
    }
  };

  const sendCommand = async (metadata: AlbumOwnerFeedbackJournalMetadata) => {
    const currentActorId = actorIdRef.current;
    if (
      role !== 'owner' ||
      currentActorId === null ||
      latestContextRef.current !== contextKey ||
      !sameScope(
        metadata,
        { albumId, photoId, versionId },
        currentActorId,
        kind,
      )
    )
      return;

    const activeJournal = readAlbumOwnerFeedbackJournal({
      actorId: currentActorId,
      albumId,
      photoId,
      versionId,
      kind,
    });
    if (
      activeJournal.kind !== 'pending' ||
      !sameAlbumOwnerFeedbackJournalMetadata(activeJournal.metadata, metadata)
    )
      return;
    if (
      (metadata.command.operation === 'create_annotation' ||
        metadata.command.operation === 'update_annotation') &&
      metadata.command.geometry.type === 'freehand' &&
      !freehandWriteEnabled
    ) {
      setError('手繪目前未開放，草稿已保留。');
      return;
    }

    const markedReady = updateAlbumOwnerFeedbackJournalStatus(
      metadata,
      'ready',
    );
    const readyMetadata = markedReady
      ? { ...metadata, status: 'ready' as const }
      : metadata;
    writeJournal({
      kind: 'pending',
      metadata: readyMetadata,
      command: readyMetadata.command,
      status: 'ready',
    });
    setError('');
    setNotice('');

    try {
      const result = await fetchJson(
        '/api/v1/albums/' +
          encodeURIComponent(albumId) +
          '/owner-feedback/commands',
        albumOwnerFeedbackResultSchema,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kino-Expected-Actor': currentActorId,
          },
          body: JSON.stringify(readyMetadata.command),
        },
      );
      checkResultScope(result, readyMetadata.command, {
        albumId,
        photoId,
        versionId,
      });
      if (!clearAlbumOwnerFeedbackIntent(readyMetadata)) {
        const markedUncertain = updateAlbumOwnerFeedbackJournalStatus(
          readyMetadata,
          'uncertain',
        );
        writeJournal({
          kind: 'pending',
          metadata: markedUncertain
            ? { ...readyMetadata, status: 'uncertain' }
            : readyMetadata,
          command: readyMetadata.command,
          status: 'uncertain',
        });
        setError('意見已送出，結果仍待確認。');
        return;
      }

      if (mountedRef.current && latestContextRef.current === contextKey) {
        const command = readyMetadata.command;
        let next: AlbumOwnerFeedbackItem[];
        if (
          command.operation === 'create_comment' ||
          command.operation === 'create_annotation'
        ) {
          next = [...itemsRef.current, result.item];
        } else {
          const index = itemsRef.current.findIndex(
            (item) => item.id === command.feedbackId,
          );
          next = [...itemsRef.current];
          if (index === -1) next.push(result.item);
          else {
            const current = next[index];
            next[index] =
              current && current.revision > result.item.revision
                ? current
                : result.item;
          }
        }
        itemsRef.current = next;
        setItems(next);
        if (command.operation.endsWith('_comment')) {
          setCommentBody('');
          setEditingComment(null);
        } else setDraftGeometry(null);
        setNotice(
          command.operation.startsWith('delete_')
            ? '已刪除。'
            : command.operation.startsWith('update_')
              ? '已更新。'
              : command.operation.endsWith('_comment')
                ? '已發表。'
                : '已儲存。',
        );
      }
      writeJournal(emptyJournal);
    } catch (reason) {
      const failure = reason as Partial<ApiError>;
      if (failure.status === 401 || failure.status === 403) {
        resetForUnauthorized(failure.status);
        return;
      }
      if (
        failure.status === 409 &&
        failure.code === 'FREEHAND_ANNOTATIONS_DISABLED'
      ) {
        setFreehandWriteEnabled(false);
        setFreehandMode(false);
        const markedUncertain = updateAlbumOwnerFeedbackJournalStatus(
          readyMetadata,
          'uncertain',
        );
        writeJournal({
          kind: 'pending',
          metadata: markedUncertain
            ? { ...readyMetadata, status: 'uncertain' }
            : readyMetadata,
          command: readyMetadata.command,
          status: 'uncertain',
        });
        setError('手繪目前未開放，草稿已保留。');
      } else if (failure.status === 409) {
        const markedConflict = updateAlbumOwnerFeedbackJournalStatus(
          readyMetadata,
          'conflict',
        );
        writeJournal({
          kind: 'pending',
          metadata: markedConflict
            ? { ...readyMetadata, status: 'conflict' }
            : readyMetadata,
          command: readyMetadata.command,
          status: 'conflict',
        });
        setError('意見內容已變更，請重新載入後再試。');
      } else if (
        failure.status === 0 ||
        (typeof failure.status === 'number' && failure.status >= 500)
      ) {
        const markedUncertain = updateAlbumOwnerFeedbackJournalStatus(
          readyMetadata,
          'uncertain',
        );
        writeJournal({
          kind: 'pending',
          metadata: markedUncertain
            ? { ...readyMetadata, status: 'uncertain' }
            : readyMetadata,
          command: readyMetadata.command,
          status: 'uncertain',
        });
        setError('結果尚未確認，草稿已保留。');
      } else {
        if (clearAlbumOwnerFeedbackIntent(readyMetadata))
          writeJournal(emptyJournal);
        else
          writeJournal({
            kind: 'pending',
            metadata: readyMetadata,
            command: readyMetadata.command,
            status: 'conflict',
          });
        setError('意見未能儲存，草稿已保留。');
      }
    }
  };

  const startCommand = (command: AlbumOwnerFeedbackCommand) => {
    if (role !== 'owner' || actorId === null || pendingRef.current) return;
    const metadata: AlbumOwnerFeedbackJournalMetadata = {
      version: 1,
      actorId,
      albumId,
      photoId,
      versionId,
      kind,
      status: 'ready',
      command: albumOwnerFeedbackCommandSchema.parse(command),
    };
    if (!saveAlbumOwnerFeedbackIntent(metadata)) {
      setError('目前無法安全保存操作，請稍後重試。');
      return;
    }
    writeJournal({
      kind: 'pending',
      metadata,
      command: metadata.command,
      status: 'ready',
    });
    void sendCommand(metadata);
  };

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = guestCommentBodySchema.safeParse(commentBody);
    if (!body.success) {
      setError('請輸入意見（最多 2000 字）。');
      return;
    }
    if (editingComment !== null) {
      const item = itemsRef.current.find(
        (candidate) =>
          candidate.id === editingComment &&
          candidate.kind === 'comment' &&
          candidate.state === 'open',
      );
      if (!item || item.kind !== 'comment') {
        setError('這則意見已變更，請重新載入。');
        return;
      }
      startCommand({
        requestId: crypto.randomUUID(),
        operation: 'update_comment',
        photoId,
        versionId,
        feedbackId: item.id,
        expectedRevision: item.revision,
        body: body.data,
      });
      return;
    }
    startCommand({
      requestId: crypto.randomUUID(),
      operation: 'create_comment',
      photoId,
      versionId,
      body: body.data,
    });
  };

  const beginCommentEdit = (
    item: Extract<AlbumOwnerFeedbackItem, { kind: 'comment' }>,
  ) => {
    if (!canMutateItems || item.body === null) return;
    setEditingComment(item.id);
    setCommentBody(item.body);
    setError('');
    setNotice('');
  };

  const cancelCommentDraft = () => {
    if (requestPending || journal.kind !== 'none') return;
    setCommentBody('');
    setEditingComment(null);
    setError('');
    setNotice('');
  };

  const deleteComment = (
    item: Extract<AlbumOwnerFeedbackItem, { kind: 'comment' }>,
  ) => {
    if (!canMutateItems) return;
    startCommand({
      requestId: crypto.randomUUID(),
      operation: 'delete_comment',
      photoId,
      versionId,
      feedbackId: item.id,
      expectedRevision: item.revision,
    });
  };

  const deleteAnnotation = (
    item: Extract<AlbumOwnerFeedbackItem, { kind: 'annotation' }>,
  ) => {
    if (!canMutateItems) return;
    startCommand({
      requestId: crypto.randomUUID(),
      operation: 'delete_annotation',
      photoId,
      versionId,
      feedbackId: item.id,
      expectedRevision: item.revision,
    });
  };

  const submitAnnotation = () => {
    if (
      !draftGeometry ||
      !canDraw ||
      imageState.status !== 'ready' ||
      (draftGeometry.type === 'freehand' && !freehandWriteEnabled)
    )
      return;
    startCommand({
      requestId: crypto.randomUUID(),
      operation: 'create_annotation',
      photoId,
      versionId,
      geometry: draftGeometry,
      style: { color: draftColor },
    });
  };

  const retryPending = () => {
    if (journal.kind === 'pending' && journal.status !== 'conflict')
      void sendCommand(journal.metadata);
  };

  const reloadAfterConflict = () => {
    if (
      role !== 'owner' ||
      actorId === null ||
      journal.kind !== 'pending' ||
      journal.status !== 'conflict'
    )
      return;
    if (!clearAlbumOwnerFeedbackIntent(journal.metadata)) {
      setError('草稿仍保留，請稍後重新載入。');
      return;
    }
    writeJournal(emptyJournal);
    beginLoad();
    setReloadSequence((value) => value + 1);
  };

  const liveComments = items.filter(
    (item): item is Extract<AlbumOwnerFeedbackItem, { kind: 'comment' }> =>
      item.kind === 'comment' && item.state === 'open' && item.body !== null,
  );
  const liveAnnotations = items.filter(
    (item): item is Extract<AlbumOwnerFeedbackItem, { kind: 'annotation' }> =>
      item.kind === 'annotation' &&
      item.state === 'open' &&
      item.geometry !== null &&
      item.style !== null,
  );
  const canvasAnnotations = liveAnnotations
    .map(toCanvasAnnotation)
    .filter((item): item is CanvasAnnotation => item !== null);
  const showCanvas =
    !canvasSuppressed &&
    safePreview !== null &&
    ((role === 'owner' && kind === 'annotation') ||
      (role === 'guest' && liveAnnotations.length > 0)) &&
    ((visible && loadStatus === 'ready') ||
      (requestPending && role === 'owner' && kind === 'annotation'));
  const canDraw =
    role === 'owner' &&
    kind === 'annotation' &&
    visible &&
    loadStatus === 'ready' &&
    imageState.status === 'ready' &&
    !requestPending &&
    journal.kind === 'none';

  useEffect(() => {
    setCanvasPortalActive(showCanvas && canvasContainer !== null);
    return () => setCanvasPortalActive(false);
  }, [canvasContainer, setCanvasPortalActive, showCanvas]);

  const showComments = kind === 'all' || kind === 'comment';
  const showAnnotations = kind === 'all' || kind === 'annotation';
  const journalPending = journal.kind === 'pending';
  const commentIntentPending =
    journalPending && journal.metadata.kind === 'comment';
  const annotationIntentPending =
    journalPending && journal.metadata.kind === 'annotation';
  const pendingFreehandDisabled =
    journalPending &&
    (journal.command.operation === 'create_annotation' ||
      journal.command.operation === 'update_annotation') &&
    journal.command.geometry.type === 'freehand' &&
    !freehandWriteEnabled;
  const ownerReady =
    role === 'guest' || (actorId !== null && loadStatus === 'ready');
  const loading =
    visible && (loadStatus === 'idle' || loadStatus === 'loading');

  return (
    <section
      ref={rootRef}
      className="space-y-3"
      aria-label={kind === 'annotation' ? '攝影師手繪意見' : '攝影師意見'}
    >
      {loading && (
        <p role="status" className="text-sm text-stone-600">
          正在載入意見…
        </p>
      )}
      {visible && loadStatus === 'error' && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-red-700">
            {error || '目前無法載入意見。'}
          </p>
          <button
            type="button"
            className="min-h-10 rounded-md border border-stone-300 px-3 text-sm"
            onClick={() => {
              beginLoad();
              setReloadSequence((value) => value + 1);
            }}
          >
            重新載入
          </button>
        </div>
      )}

      {visible && loadStatus === 'ready' && (
        <>
          {role === 'owner' && kind === 'comment' && (
            <form className="space-y-2" onSubmit={submitComment}>
              <label className="sr-only" htmlFor={id + '-comment'}>
                留下意見
              </label>
              <textarea
                id={id + '-comment'}
                value={commentBody}
                maxLength={2000}
                rows={3}
                placeholder="留下意見…"
                disabled={
                  !ownerReady || requestPending || journal.kind !== 'none'
                }
                onChange={(event) => setCommentBody(event.currentTarget.value)}
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-stone-100"
              />
              {commentIntentPending && journal.kind === 'pending' ? (
                journal.status === 'conflict' ? (
                  <button
                    type="button"
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-sm"
                    onClick={reloadAfterConflict}
                  >
                    重新載入
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={journal.status === 'ready'}
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-sm disabled:opacity-50"
                    onClick={retryPending}
                  >
                    {journal.status === 'ready'
                      ? journal.command.operation === 'delete_comment'
                        ? '刪除中…'
                        : journal.command.operation === 'update_comment'
                          ? '更新中…'
                          : '發表中…'
                      : '重試'}
                  </button>
                )
              ) : (
                <>
                  <button
                    type="submit"
                    disabled={
                      !ownerReady || requestPending || commentBody.trim() === ''
                    }
                    className="min-h-10 rounded-md bg-stone-800 px-4 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {editingComment === null ? '發表' : '更新'}
                  </button>
                  {(commentBody !== '' || editingComment !== null) && (
                    <button
                      type="button"
                      className="min-h-10 rounded-md border border-stone-300 px-3 text-sm"
                      onClick={cancelCommentDraft}
                    >
                      取消
                    </button>
                  )}
                </>
              )}
            </form>
          )}

          {role === 'owner' && kind === 'annotation' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={!freehandMode && tool === 'rectangle'}
                disabled={
                  !ownerReady || requestPending || journal.kind !== 'none'
                }
                className="min-h-10 rounded-md border border-stone-300 px-3 text-sm aria-pressed:bg-stone-100 disabled:opacity-50"
                onClick={() => {
                  setFreehandMode(false);
                  setTool('rectangle');
                }}
              >
                圈選
              </button>
              {freehandWriteEnabled && (
                <button
                  type="button"
                  aria-pressed={freehandMode}
                  disabled={
                    !ownerReady || requestPending || journal.kind !== 'none'
                  }
                  className="min-h-10 rounded-md border border-stone-300 px-3 text-sm aria-pressed:bg-stone-100 disabled:opacity-50"
                  onClick={() => setFreehandMode(true)}
                >
                  手繪
                </button>
              )}
              {annotationIntentPending && journal.kind === 'pending' ? (
                journal.status === 'conflict' ? (
                  <button
                    type="button"
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-sm"
                    onClick={reloadAfterConflict}
                  >
                    重新載入
                  </button>
                ) : pendingFreehandDisabled ? (
                  <button
                    type="button"
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-sm"
                    onClick={() => {
                      beginLoad();
                      setReloadSequence((value) => value + 1);
                    }}
                  >
                    重新載入
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={journal.status === 'ready'}
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-sm disabled:opacity-50"
                    onClick={retryPending}
                  >
                    {journal.status === 'ready'
                      ? journal.command.operation === 'delete_annotation'
                        ? '刪除中…'
                        : '儲存中…'
                      : '重試'}
                  </button>
                )
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!draftGeometry || !canDraw || requestPending}
                    className="min-h-10 rounded-md bg-stone-800 px-3 text-sm font-medium text-white disabled:opacity-50"
                    onClick={submitAnnotation}
                  >
                    儲存
                  </button>
                  <button
                    type="button"
                    disabled={!draftGeometry || requestPending}
                    className="min-h-10 rounded-md border border-stone-300 px-3 text-sm disabled:opacity-50"
                    onClick={() => {
                      setDraftGeometry(null);
                      setFreehandMode(false);
                    }}
                  >
                    取消
                  </button>
                </>
              )}
            </div>
          )}

          {showCanvas && (
            <AnnotationCanvas
              key={JSON.stringify([contextKey, safePreview])}
              previewUrl={safePreview}
              canvasContainer={canvasContainer}
              trackedPhoto={{ photoId, versionId }}
              filename={filename}
              annotations={canvasAnnotations}
              selectedAnnotationId={null}
              draftGeometry={draftGeometry}
              tool={tool}
              color={draftColor}
              canDraw={canDraw}
              onDraftGeometry={(geometry) => {
                if (!canDraw || geometry.type === 'freehand') return;
                setDraftGeometry(geometry);
                setError('');
              }}
              onImageState={setImageState}
              onImageError={() => setImageState({ status: 'error' })}
              freehandMode={freehandWriteEnabled && freehandMode && canDraw}
              freehandScopeKey={JSON.stringify([
                actorId ?? '',
                albumId,
                photoId,
                versionId,
                contextKey,
              ])}
              onDraftFreehand={(stroke) => {
                if (!canDraw || !freehandWriteEnabled) return;
                setDraftGeometry(stroke.geometry);
                setDraftColor(stroke.style.color);
                setError('');
              }}
            />
          )}

          {showComments && (
            <section aria-label="意見列表" className="space-y-2">
              {liveComments.length === 0 ? (
                role === 'owner' && (
                  <p className="text-sm text-stone-600">還沒有意見。</p>
                )
              ) : (
                <ul className="space-y-2">
                  {liveComments.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-md border border-stone-200 bg-white p-3"
                    >
                      <p className="whitespace-pre-wrap break-words text-sm text-stone-800">
                        {item.body}
                      </p>
                      <p className="mt-2 text-xs text-stone-500">
                        {item.authorLabel} · {timeLabel(item.createdAt)}
                      </p>
                      {role === 'owner' && (
                        <div className="mt-2 flex justify-end gap-1">
                          <button
                            type="button"
                            title="編輯意見"
                            aria-label="編輯這則意見"
                            disabled={!canMutateItems}
                            className="flex min-h-10 min-w-10 items-center justify-center rounded-md text-stone-600 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700 disabled:opacity-40"
                            onClick={() => beginCommentEdit(item)}
                          >
                            <StudioIcon
                              name="edit"
                              width={16}
                              height={16}
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            title="刪除意見"
                            aria-label="刪除這則意見"
                            disabled={!canMutateItems}
                            className="flex min-h-10 min-w-10 items-center justify-center rounded-md text-stone-600 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700 disabled:opacity-40"
                            onClick={() => deleteComment(item)}
                          >
                            <StudioIcon
                              name="trash"
                              width={16}
                              height={16}
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {showAnnotations && (
            <section aria-label="手繪意見列表" className="space-y-2">
              {liveAnnotations.length === 0 ? (
                role === 'owner' && (
                  <p className="text-sm text-stone-600">尚未有手繪標記。</p>
                )
              ) : (
                <ul className="space-y-2">
                  {liveAnnotations.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600"
                    >
                      手繪標記 · {item.authorLabel} ·{' '}
                      {timeLabel(item.createdAt)}
                      {role === 'owner' && (
                        <button
                          type="button"
                          title="刪除手繪標記"
                          aria-label="刪除這個手繪標記"
                          disabled={!canMutateItems}
                          className="ml-2 inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-stone-600 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700 disabled:opacity-40"
                          onClick={() => deleteAnnotation(item)}
                        >
                          <StudioIcon
                            name="trash"
                            width={16}
                            height={16}
                            aria-hidden="true"
                          />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {role === 'guest' &&
            liveComments.length === 0 &&
            liveAnnotations.length === 0 && (
              <p className="text-sm text-stone-600">目前沒有攝影師意見。</p>
            )}

          {nextCursor !== null && (
            <div className="flex flex-wrap items-center gap-2">
              {moreError && (
                <p role="alert" className="text-sm text-red-700">
                  無法載入更多意見。
                </p>
              )}
              <button
                type="button"
                disabled={loadingMore}
                className="min-h-10 rounded-md border border-stone-300 px-3 text-sm disabled:opacity-50"
                onClick={() => void loadMore()}
              >
                {loadingMore ? '載入中…' : moreError ? '重試' : '載入更多'}
              </button>
            </div>
          )}

          {journal.kind === 'blocked' && (
            <p role="alert" className="text-sm text-red-700">
              目前無法安全保存操作，請先重新載入。
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-emerald-800">
              {notice}
            </p>
          )}
        </>
      )}
    </section>
  );
}
