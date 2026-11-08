'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { z } from 'zod';
import { guestCommentBodySchema } from '../../../packages/contracts/src/guest-comments';
import {
  invitePageSchema,
  type InviteSummary,
} from '../../../packages/contracts/src/invites';
import {
  ownerCommentCommandSchema,
  ownerCommentResultSchema,
  ownerCommentThreadPageSchema,
  ownerCommentsCapabilitiesSchema,
  type OwnerCommentThreadItem,
  type OwnerCommentThreadPage,
} from '../../../packages/contracts/src/owner-comments';
import {
  ownerCommentProcessingCapabilitiesSchema,
  ownerCommentProcessingCommandSchema,
  ownerCommentProcessingResultSchema,
  type CommentProcessingSnapshot,
  type OwnerCommentProcessingCommand,
} from '../../../packages/contracts/src/comment-processing';
import {
  ownerPhotoVersionsPageSchema,
  type PhotoVersionItem,
} from '../../../packages/contracts/src/photo-versions';
import {
  claimOwnerCommentIntent,
  demoteOwnerCommentIntent,
  discardOwnerCommentIntent,
  finishOwnerCommentIntent,
  readOwnerCommentJournal,
  saveOwnerCommentIntent,
  subscribeOwnerCommentJournal,
  updateOwnerCommentIntent,
  type OwnerCommentIntentCommand,
  type OwnerCommentJournalMetadata,
  type OwnerCommentJournalSnapshot,
} from './owner-comment-journal';

const currentOwnerSchema = z
  .object({
    actor: z.object({ id: z.uuid() }).strict(),
    role: z.literal('owner'),
    sessionId: z.string().min(1),
  })
  .strict();

type CurrentOwner = z.infer<typeof currentOwnerSchema>;
type Scope = {
  actorId: string;
  albumId: string;
  inviteId: string;
  photoId: string;
  versionId: string;
};
type VersionOption = Omit<PhotoVersionItem, 'versionNo' | 'createdAt'> & {
  versionNo: number | null;
  createdAt: string | null;
};
type Editor =
  | { kind: 'reply'; parentCommentId: string; expectedParentRevision: number }
  | { kind: 'edit_reply'; replyId: string; expectedRevision: number };

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code || 'OWNER_COMMENTS_REQUEST_FAILED');
  }
}

function readErrorCode(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return '';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}

async function fetchJson<T>(
  url: string,
  schema: { parse: (value: unknown) => T },
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...init.headers },
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiFailure(response.status, readErrorCode(body));
    try {
      return schema.parse(body);
    } catch {
      throw new ApiFailure(response.status, 'INVALID_RESPONSE');
    }
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw new ApiFailure(0, 'NETWORK_UNKNOWN');
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function selectableInvites(invites: InviteSummary[], albumId: string) {
  return invites.filter(
    (invite) =>
      invite.sealed && invite.albums.some((album) => album.id === albumId),
  );
}

function inviteStatus(invite: InviteSummary, now = Date.now()): string[] {
  const labels: string[] = [];
  if (invite.revokedAt !== null) labels.push('已撤銷');
  if (
    invite.expiryMode !== 'inherit_album' &&
    invite.expiresAt !== null &&
    Date.parse(invite.expiresAt) <= now
  )
    labels.push('已到期');
  return labels;
}

function inviteDisplayLabel(invite: InviteSummary, index: number): string {
  const statuses = inviteStatus(invite);
  const status = statuses.length
    ? statuses.join('、') +
      (invite.expiryMode === 'inherit_album' ? '、期限依相簿規則' : '')
    : invite.expiryMode === 'inherit_album'
      ? '期限依相簿規則'
      : '使用中';
  return (
    '邀請 ' +
    String(index + 1) +
    ' · 建立 ' +
    formatTime(invite.createdAt) +
    ' · ' +
    status +
    (invite.permissions.can_comment ? ' · 可留言' : ' · 不可留言')
  );
}

function processingLabel(value: PhotoVersionItem['processing']): string {
  if (value === 'succeeded') return '';
  const labels: Record<PhotoVersionItem['processing'], string> = {
    queued: '排隊處理中',
    running: '處理中',
    retryable: '等待重試',
    needs_review: '等待檢查',
    abandoned: '已停止處理',
    succeeded: '處理完成',
    unsupported: '格式暫不支援',
    unavailable: '目前無法使用',
  };
  return labels[value];
}

function threadPath(scope: Scope, cursor?: string, commentId?: string): string {
  const query = new URLSearchParams({ inviteId: scope.inviteId });
  if (cursor !== undefined) query.set('cursor', cursor);
  if (commentId !== undefined) query.set('commentId', commentId);
  return (
    '/api/v1/albums/' +
    encodeURIComponent(scope.albumId) +
    '/photos/' +
    encodeURIComponent(scope.photoId) +
    '/versions/' +
    encodeURIComponent(scope.versionId) +
    '/comment-threads?' +
    query.toString()
  );
}

function threadScopeMatches(
  page: OwnerCommentThreadPage,
  scope: Scope,
): boolean {
  return (
    page.inviteId === scope.inviteId &&
    page.photoId === scope.photoId &&
    page.versionId === scope.versionId
  );
}

function metadataFor(
  scope: Scope,
  command: OwnerCommentIntentCommand,
  bodySha256?: string,
): OwnerCommentJournalMetadata {
  switch (command.operation) {
    case 'reply':
      return {
        requestId: command.requestId,
        actorId: scope.actorId,
        albumId: scope.albumId,
        inviteId: command.inviteId,
        photoId: command.photoId,
        versionId: command.versionId,
        operation: command.operation,
        parentCommentId: command.parentCommentId,
        expectedParentRevision: command.expectedParentRevision,
        bodySha256: bodySha256 ?? '',
      };
    case 'edit_reply':
      return {
        requestId: command.requestId,
        actorId: scope.actorId,
        albumId: scope.albumId,
        inviteId: scope.inviteId,
        photoId: scope.photoId,
        versionId: scope.versionId,
        operation: command.operation,
        replyId: command.replyId,
        expectedRevision: command.expectedRevision,
        bodySha256: bodySha256 ?? '',
      };
    case 'delete_reply':
      return {
        requestId: command.requestId,
        actorId: scope.actorId,
        albumId: scope.albumId,
        inviteId: scope.inviteId,
        photoId: scope.photoId,
        versionId: scope.versionId,
        operation: command.operation,
        replyId: command.replyId,
        expectedRevision: command.expectedRevision,
      };
    case 'set_processing_state':
      return {
        requestId: command.requestId,
        actorId: scope.actorId,
        albumId: scope.albumId,
        inviteId: command.inviteId,
        photoId: command.photoId,
        versionId: command.versionId,
        operation: command.operation,
        commentId: command.commentId,
        expectedCommentRevision: command.expectedCommentRevision,
        expectedProcessingRevision: command.expectedProcessingRevision,
        state: command.state,
      };
  }
}

function commandFromMetadata(
  metadata: OwnerCommentJournalMetadata,
  body: string,
): OwnerCommentIntentCommand {
  switch (metadata.operation) {
    case 'reply':
      return ownerCommentCommandSchema.parse({
        requestId: metadata.requestId,
        operation: metadata.operation,
        inviteId: metadata.inviteId,
        photoId: metadata.photoId,
        versionId: metadata.versionId,
        parentCommentId: metadata.parentCommentId,
        expectedParentRevision: metadata.expectedParentRevision,
        body,
      });
    case 'edit_reply':
      return ownerCommentCommandSchema.parse({
        requestId: metadata.requestId,
        operation: metadata.operation,
        replyId: metadata.replyId,
        expectedRevision: metadata.expectedRevision,
        body,
      });
    case 'delete_reply':
      return ownerCommentCommandSchema.parse({
        requestId: metadata.requestId,
        operation: metadata.operation,
        replyId: metadata.replyId,
        expectedRevision: metadata.expectedRevision,
      });
    case 'set_processing_state':
      return ownerCommentProcessingCommandSchema.parse({
        requestId: metadata.requestId,
        operation: metadata.operation,
        inviteId: metadata.inviteId,
        photoId: metadata.photoId,
        versionId: metadata.versionId,
        commentId: metadata.commentId,
        expectedCommentRevision: metadata.expectedCommentRevision,
        expectedProcessingRevision: metadata.expectedProcessingRevision,
        state: metadata.state,
      });
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function sameScope(left: Scope, right: Scope): boolean {
  return (
    left.actorId === right.actorId &&
    left.albumId === right.albumId &&
    left.inviteId === right.inviteId &&
    left.photoId === right.photoId &&
    left.versionId === right.versionId
  );
}

function ownerItemLabel(item: OwnerCommentThreadItem): string {
  return item.authorType === 'guest' ? '訪客留言' : '攝影師回覆';
}

function itemStateLabel(item: OwnerCommentThreadItem): string {
  if (item.state === 'deleted')
    return item.authorType === 'guest' ? '客戶留言已刪除' : '回覆已刪除';
  if (item.authorType === 'guest')
    return item.state === 'resolved' ? '客戶已標記解決' : '客戶待處理';
  return '攝影師回覆';
}

function processingStateLabel(
  snapshot: CommentProcessingSnapshot | null,
): string {
  const state = snapshot?.state ?? 'open';
  if (state === 'in_progress') return '處理中';
  if (state === 'resolved') return '已處理';
  return '待處理';
}

function mergeProcessingSnapshots(
  left: CommentProcessingSnapshot | null,
  right: CommentProcessingSnapshot | null,
): CommentProcessingSnapshot | null {
  if (!left) return right;
  if (!right) return left;
  if (left.revision > right.revision) return left;
  if (right.revision > left.revision) return right;
  if (right.revision === 0) return right;
  if (left.stale === right.stale) return right;
  // Revision zero returns above; recorded snapshots permit either stale value.
  return { ...right, stale: true } as CommentProcessingSnapshot;
}

function mergeThreadItemMonotone(
  current: OwnerCommentThreadItem,
  incoming: OwnerCommentThreadItem,
): OwnerCommentThreadItem {
  const row = incoming.revision >= current.revision ? incoming : current;
  return {
    ...row,
    processing: mergeProcessingSnapshots(
      current.processing,
      incoming.processing,
    ),
  };
}

export type OwnerCommentsPanelProps = {
  albumId: string;
  projectId: string;
  photoId: string;
  currentVersionId: string;
  filename: string;
  onPendingChange?: (pending: boolean) => void;
};

export function OwnerCommentsPanel({
  albumId,
  projectId,
  photoId,
  currentVersionId,
  filename,
  onPendingChange,
}: OwnerCommentsPanelProps) {
  const [feature, setFeature] = useState<
    'loading' | 'disabled' | 'enabled' | 'error'
  >('loading');
  const [processingFeature, setProcessingFeature] = useState<
    'loading' | 'disabled' | 'enabled'
  >('loading');
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [owner, setOwner] = useState<CurrentOwner | null>(null);
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [inviteCursor, setInviteCursor] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [selectedInviteId, setSelectedInviteId] = useState('');
  const [versions, setVersions] = useState<PhotoVersionItem[]>([]);
  const [versionCursor, setVersionCursor] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionError, setVersionError] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [threadItems, setThreadItems] = useState<OwnerCommentThreadItem[]>([]);
  const [threadCursor, setThreadCursor] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [threadNeedsReload, setThreadNeedsReload] = useState(false);
  const [processingError, setProcessingError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorBody, setEditorBody] = useState('');
  const [editorError, setEditorError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [recoveryBody, setRecoveryBody] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [discardArmedFor, setDiscardArmedFor] = useState('');
  const [notice, setNotice] = useState('');
  const [visible, setVisible] = useState(false);
  const [journal, setJournal] = useState<OwnerCommentJournalSnapshot>({
    kind: 'none',
  });
  const [journalScopeLoaded, setJournalScopeLoaded] = useState('');

  const ownerRef = useRef<CurrentOwner | null>(null);
  const onPendingChangeRef = useRef(onPendingChange);
  const mountedRef = useRef(false);
  const visibleRef = useRef(false);
  const uiGeneration = useRef(0);
  const inviteSequence = useRef(0);
  const versionSequence = useRef(0);
  const threadSequence = useRef(0);
  const inviteItemsRef = useRef(invites);
  const versionItemsRef = useRef(versions);
  const threadItemsRef = useRef(threadItems);
  const inviteRef = useRef(selectedInviteId);
  const versionRef = useRef(selectedVersionId);

  useEffect(() => {
    onPendingChangeRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      visibleRef.current = false;
      uiGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    inviteRef.current = selectedInviteId;
    versionRef.current = selectedVersionId;
  }, [selectedInviteId, selectedVersionId]);

  useEffect(() => {
    inviteItemsRef.current = invites;
  }, [invites]);

  useEffect(() => {
    versionItemsRef.current = versions;
  }, [versions]);

  useEffect(() => {
    threadItemsRef.current = threadItems;
  }, [threadItems]);

  useEffect(() => {
    ownerRef.current = owner;
  }, [owner]);

  const checkOwner = useCallback(async (actorId: string) => {
    const current = await fetchJson('/api/v1/me', currentOwnerSchema);
    if (current.actor.id !== actorId || current.role !== 'owner')
      throw new ApiFailure(403, 'OWNER_CHANGED');
    ownerRef.current = current;
    if (mountedRef.current) setOwner(current);
    return current;
  }, []);

  const loadInvitePage = useCallback(
    async (cursor: string | null) => {
      const actorId = ownerRef.current?.actor.id;
      if (!actorId) return;
      const sequence = ++inviteSequence.current;
      const generation = uiGeneration.current;
      setInviteLoading(true);
      setInviteError('');
      try {
        await checkOwner(actorId);
        const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
        const page = await fetchJson(
          '/api/v1/projects/' +
            encodeURIComponent(projectId) +
            '/invites' +
            query,
          invitePageSchema,
        );
        await checkOwner(actorId);
        if (
          sequence !== inviteSequence.current ||
          generation !== uiGeneration.current ||
          !mountedRef.current ||
          !visibleRef.current
        )
          return;
        const existing = cursor ? inviteItemsRef.current : [];
        const ids = new Set(existing.map((invite) => invite.id));
        if (page.invites.some((invite) => ids.has(invite.id))) {
          setInviteError('邀請分頁範圍重疊，請重新載入邀請清單。');
          return;
        }
        const next = [...existing, ...page.invites];
        inviteItemsRef.current = next;
        setInvites(next);
        setInviteCursor(page.nextCursor);
      } catch (error) {
        if (
          sequence !== inviteSequence.current ||
          generation !== uiGeneration.current ||
          !mountedRef.current ||
          !visibleRef.current
        )
          return;
        setInviteError(
          error instanceof ApiFailure && error.status === 401
            ? '登入已失效，請重新登入後重試。'
            : '目前無法載入客戶邀請，請稍後重新載入。',
        );
      } finally {
        if (
          sequence === inviteSequence.current &&
          generation === uiGeneration.current &&
          mountedRef.current &&
          visibleRef.current
        )
          setInviteLoading(false);
      }
    },
    [checkOwner, projectId],
  );

  const loadVersionPage = useCallback(
    async (cursor: string | null, replace = false) => {
      const actorId = ownerRef.current?.actor.id;
      if (!actorId) return;
      const sequence = ++versionSequence.current;
      const generation = uiGeneration.current;
      setVersionLoading(true);
      setVersionError('');
      try {
        await checkOwner(actorId);
        const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
        const page = await fetchJson(
          '/api/v1/photos/' + encodeURIComponent(photoId) + '/versions' + query,
          ownerPhotoVersionsPageSchema,
        );
        await checkOwner(actorId);
        if (
          page.photoId !== photoId ||
          sequence !== versionSequence.current ||
          generation !== uiGeneration.current ||
          !mountedRef.current ||
          !visibleRef.current
        )
          return;
        const existing = replace || !cursor ? [] : versionItemsRef.current;
        const ids = new Set(existing.map((version) => version.id));
        if (page.versions.some((version) => ids.has(version.id))) {
          setVersionError('版本分頁範圍重疊，請重新載入版本清單。');
          return;
        }
        const next = [...existing, ...page.versions];
        versionItemsRef.current = next;
        setVersions(next);
        setVersionCursor(page.nextCursor);
      } catch (error) {
        if (
          sequence !== versionSequence.current ||
          generation !== uiGeneration.current ||
          !mountedRef.current ||
          !visibleRef.current
        )
          return;
        setVersionError(
          error instanceof ApiFailure && error.status === 401
            ? '登入已失效，請重新登入後重試。'
            : '目前無法載入照片版本，請稍後重新載入。',
        );
      } finally {
        if (
          sequence === versionSequence.current &&
          generation === uiGeneration.current &&
          mountedRef.current &&
          visibleRef.current
        )
          setVersionLoading(false);
      }
    },
    [checkOwner, photoId],
  );

  const readThreadPage = useCallback(
    async (scope: Scope, cursor?: string, commentId?: string) => {
      await checkOwner(scope.actorId);
      const page = await fetchJson(
        threadPath(scope, cursor, commentId),
        ownerCommentThreadPageSchema,
      );
      await checkOwner(scope.actorId);
      if (!threadScopeMatches(page, scope))
        throw new ApiFailure(200, 'RESPONSE_SCOPE_MISMATCH');
      if (
        commentId !== undefined &&
        (page.items.length !== 1 || page.items[0]?.commentId !== commentId)
      )
        throw new ApiFailure(200, 'RESPONSE_TARGET_MISMATCH');
      return page;
    },
    [checkOwner],
  );

  const loadProcessingCapability = useCallback(
    async (actorId: string, generation: number) => {
      const stillCurrent = () =>
        mountedRef.current &&
        visibleRef.current &&
        generation === uiGeneration.current &&
        ownerRef.current?.actor.id === actorId &&
        document.visibilityState !== 'hidden';
      try {
        const capability = await fetchJson(
          '/api/v1/comment-processing/capabilities',
          ownerCommentProcessingCapabilitiesSchema,
        );
        if (!stillCurrent()) return;
        const verifiedOwner = await fetchJson('/api/v1/me', currentOwnerSchema);
        if (!stillCurrent()) return;
        if (
          verifiedOwner.actor.id !== actorId ||
          verifiedOwner.role !== 'owner'
        ) {
          setProcessingFeature('disabled');
          return;
        }
        setProcessingFeature(capability.enabled ? 'enabled' : 'disabled');
      } catch {
        if (stillCurrent()) setProcessingFeature('disabled');
      }
    },
    [],
  );

  const loadThread = useCallback(
    async (cursor?: string) => {
      const activeOwner = ownerRef.current;
      const inviteId = inviteRef.current;
      const versionId = versionRef.current;
      if (!activeOwner || !inviteId || !versionId) return null;
      const scope: Scope = {
        actorId: activeOwner.actor.id,
        albumId,
        inviteId,
        photoId,
        versionId,
      };
      const sequence = ++threadSequence.current;
      const generation = uiGeneration.current;
      const currentView = () =>
        mountedRef.current &&
        visibleRef.current &&
        generation === uiGeneration.current &&
        ownerRef.current?.actor.id === scope.actorId &&
        inviteRef.current === scope.inviteId &&
        versionRef.current === scope.versionId;
      setThreadLoading(true);
      setThreadError('');
      try {
        const page = await readThreadPage(scope, cursor);
        if (sequence !== threadSequence.current || !currentView()) return null;
        const existing = cursor ? threadItemsRef.current : [];
        const ids = new Set(existing.map((item) => item.commentId));
        if (page.items.some((item) => ids.has(item.commentId))) {
          setThreadError('留言分頁範圍重疊，請重新載入留言串。');
          return null;
        }
        const next = [...existing, ...page.items];
        threadItemsRef.current = next;
        setThreadItems(next);
        setThreadCursor(page.nextCursor);
        setThreadNeedsReload(false);
        return page;
      } catch (error) {
        if (sequence !== threadSequence.current || !currentView()) return null;
        threadItemsRef.current = [];
        setThreadItems([]);
        setEditor(null);
        setEditorBody('');
        setConfirmDeleteId('');
        setThreadCursor(null);
        setThreadNeedsReload(false);
        setThreadError(
          error instanceof ApiFailure && error.status === 409
            ? '留言串已有新變更，舊資料已清除。請明確重新載入。'
            : error instanceof ApiFailure && error.status === 404
              ? '此版本沒有可讀取的已發佈留言串。'
              : error instanceof ApiFailure && error.status === 401
                ? '登入已失效，請重新登入後載入留言。'
                : '目前無法讀取留言串，請稍後重試。',
        );
        return null;
      } finally {
        if (sequence === threadSequence.current && currentView())
          setThreadLoading(false);
      }
    },
    [albumId, photoId, readThreadPage],
  );

  useEffect(() => {
    let active = true;
    uiGeneration.current += 1;
    const generation = uiGeneration.current;
    void Promise.resolve()
      .then(async () => {
        if (!active || generation !== uiGeneration.current) return;
        if (
          typeof document !== 'undefined' &&
          document.visibilityState === 'hidden'
        ) {
          visibleRef.current = false;
          setVisible(false);
          return;
        }
        visibleRef.current = true;
        setVisible(true);
        setFeature('loading');
        setProcessingFeature('loading');
        setOwner(null);
        ownerRef.current = null;
        inviteItemsRef.current = [];
        setInvites([]);
        setSelectedInviteId('');
        inviteRef.current = '';
        setVersions([]);
        versionItemsRef.current = [];
        setSelectedVersionId('');
        versionRef.current = '';
        setThreadItems([]);
        threadItemsRef.current = [];
        setThreadCursor(null);
        setThreadError('');
        setEditor(null);
        setEditorBody('');
        const capability = await fetchJson(
          '/api/v1/comments/capabilities',
          ownerCommentsCapabilitiesSchema,
        );
        if (!active || generation !== uiGeneration.current) return;
        if (!capability.enabled) {
          setProcessingFeature('disabled');
          setFeature('disabled');
          return;
        }
        const current = await fetchJson('/api/v1/me', currentOwnerSchema);
        if (!active || generation !== uiGeneration.current) return;
        setOwner(current);
        ownerRef.current = current;
        setJournal(readOwnerCommentJournal(current.actor.id, albumId));
        setJournalScopeLoaded(current.actor.id + ':' + albumId);
        setFeature('enabled');
        void loadInvitePage(null);
        void loadProcessingCapability(current.actor.id, generation);
      })
      .catch(() => {
        if (active && generation === uiGeneration.current) {
          setProcessingFeature('disabled');
          setFeature('error');
        }
      });
    return () => {
      active = false;
      inviteSequence.current += 1;
      versionSequence.current += 1;
      threadSequence.current += 1;
    };
  }, [
    albumId,
    bootstrapRevision,
    loadInvitePage,
    loadProcessingCapability,
    photoId,
    projectId,
  ]);

  useEffect(() => {
    if (!owner) return;
    const sync = () =>
      setJournal(readOwnerCommentJournal(owner.actor.id, albumId));
    const unsubscribe = subscribeOwnerCommentJournal(
      owner.actor.id,
      albumId,
      sync,
    );
    sync();
    return unsubscribe;
  }, [albumId, owner]);

  useEffect(() => {
    const pending =
      feature === 'enabled' &&
      (!owner ||
        journalScopeLoaded !== owner.actor.id + ':' + albumId ||
        journal.kind === 'pending' ||
        journal.kind === 'blocked');
    onPendingChangeRef.current?.(pending);
  }, [albumId, feature, journal, journalScopeLoaded, owner]);

  useEffect(() => {
    if (feature !== 'enabled' || !selectedInviteId) return;
    void Promise.resolve().then(() => {
      setVersions([]);
      setVersionCursor(null);
      setSelectedVersionId(currentVersionId);
      versionRef.current = currentVersionId;
      setThreadItems([]);
      setThreadCursor(null);
      setThreadError('');
      setThreadNeedsReload(false);
      setEditor(null);
      setEditorBody('');
      void loadVersionPage(null, true);
    });
  }, [currentVersionId, feature, loadVersionPage, selectedInviteId]);

  useEffect(() => {
    if (feature !== 'enabled' || !selectedInviteId || !selectedVersionId)
      return;
    void Promise.resolve().then(() => void loadThread());
  }, [feature, loadThread, selectedInviteId, selectedVersionId]);

  useEffect(() => {
    const demote = () => {
      uiGeneration.current += 1;
      visibleRef.current = false;
      const current = ownerRef.current;
      if (current) {
        demoteOwnerCommentIntent(current.actor.id, albumId);
        setJournal(readOwnerCommentJournal(current.actor.id, albumId));
      }
      threadItemsRef.current = [];
      setVisible(false);
      setThreadItems([]);
      setThreadCursor(null);
      setThreadLoading(false);
      setInviteLoading(false);
      setVersionLoading(false);
      setEditor(null);
      setEditorBody('');
      setRecoveryBody('');
      setConfirmDeleteId('');
      setDiscardArmedFor('');
    };
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      uiGeneration.current += 1;
      const generation = uiGeneration.current;
      visibleRef.current = true;
      setVisible(true);
      const current = ownerRef.current;
      if (!current || feature === 'loading' || feature === 'error') {
        setBootstrapRevision((revision) => revision + 1);
        return;
      }
      if (feature !== 'enabled') return;
      setProcessingFeature('loading');
      void fetchJson(
        '/api/v1/comments/capabilities',
        ownerCommentsCapabilitiesSchema,
      )
        .then(async (capability) => {
          if (generation !== uiGeneration.current) return;
          if (!capability.enabled) {
            setFeature('disabled');
            return;
          }
          await checkOwner(current.actor.id);
          if (generation !== uiGeneration.current) return;
          void loadProcessingCapability(current.actor.id, generation);
          if (inviteRef.current && versionRef.current) void loadThread();
        })
        .catch(() => {
          if (
            generation !== uiGeneration.current ||
            !mountedRef.current ||
            !visibleRef.current
          )
            return;
          threadItemsRef.current = [];
          setThreadItems([]);
          setThreadError('目前無法重新驗證登入與邀請存取，請重新載入。');
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') demote();
      else refresh();
    };
    window.addEventListener('blur', demote);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', demote);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', demote);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('pagehide', demote);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [albumId, checkOwner, feature, loadProcessingCapability, loadThread]);

  const activeJournal =
    owner && journal.kind !== 'none' ? journal : ({ kind: 'none' } as const);
  const discardTarget =
    activeJournal.kind === 'pending'
      ? activeJournal.metadata.requestId
      : activeJournal.kind === 'blocked'
        ? 'blocked'
        : '';
  const discardArmed =
    discardTarget !== '' && discardArmedFor === discardTarget;

  const chooseInvite = (inviteId: string) => {
    uiGeneration.current += 1;
    versionSequence.current += 1;
    threadSequence.current += 1;
    setSelectedInviteId(inviteId);
    inviteRef.current = inviteId;
    threadItemsRef.current = [];
    setThreadItems([]);
    setThreadCursor(null);
    setThreadLoading(false);
    setVersionLoading(false);
    setThreadError('');
    setProcessingError('');
    setThreadNeedsReload(false);
    setEditor(null);
    setEditorBody('');
    setConfirmDeleteId('');
    setSelectedVersionId(inviteId ? currentVersionId : '');
    versionRef.current = inviteId ? currentVersionId : '';
    versionItemsRef.current = [];
    setVersions([]);
    setVersionCursor(null);
  };

  const chooseVersion = (versionId: string) => {
    uiGeneration.current += 1;
    threadSequence.current += 1;
    setSelectedVersionId(versionId);
    versionRef.current = versionId;
    threadItemsRef.current = [];
    setThreadItems([]);
    setThreadCursor(null);
    setThreadLoading(false);
    setThreadError('');
    setProcessingError('');
    setThreadNeedsReload(false);
    setEditor(null);
    setEditorBody('');
    setConfirmDeleteId('');
  };

  const selectable = selectableInvites(invites, albumId);
  const selectedInvite = selectable.find(
    (invite) => invite.id === selectedInviteId,
  );
  const currentVersion = versions.find(
    (version) => version.id === currentVersionId,
  );
  const versionOptions: VersionOption[] = [
    ...(currentVersion
      ? []
      : [
          {
            id: currentVersionId,
            versionNo: null,
            createdAt: null,
            processing: 'unavailable' as const,
            thumbnailUrl: null,
            previewUrl: null,
            width: null,
            height: null,
          },
        ]),
    ...versions,
  ].filter(
    (version, index, all) =>
      all.findIndex((candidate) => candidate.id === version.id) === index,
  );
  const preparingRef = useRef(false);

  const selectedScope = useCallback((): Scope | null => {
    const activeOwner = ownerRef.current;
    if (
      !activeOwner ||
      !selectedInviteId ||
      !selectedVersionId ||
      !selectableInvites(inviteItemsRef.current, albumId).some(
        (invite) => invite.id === selectedInviteId,
      )
    )
      return null;
    return {
      actorId: activeOwner.actor.id,
      albumId,
      inviteId: selectedInviteId,
      photoId,
      versionId: selectedVersionId,
    };
  }, [albumId, photoId, selectedInviteId, selectedVersionId]);

  const sendIntent = useCallback(
    async (
      metadata: OwnerCommentJournalMetadata,
      command: OwnerCommentIntentCommand,
    ) => {
      const generation = uiGeneration.current;
      const intentScope: Scope = {
        actorId: metadata.actorId,
        albumId: metadata.albumId,
        inviteId: metadata.inviteId,
        photoId: metadata.photoId,
        versionId: metadata.versionId,
      };
      const currentUiScope = (): Scope | null => {
        const activeOwner = ownerRef.current;
        if (!activeOwner || !inviteRef.current || !versionRef.current)
          return null;
        return {
          actorId: activeOwner.actor.id,
          albumId,
          inviteId: inviteRef.current,
          photoId,
          versionId: versionRef.current,
        };
      };
      const uiStillCurrent = () => {
        const liveScope = currentUiScope();
        return (
          mountedRef.current &&
          visibleRef.current &&
          generation === uiGeneration.current &&
          liveScope !== null &&
          sameScope(liveScope, intentScope)
        );
      };
      const before = readOwnerCommentJournal(
        metadata.actorId,
        metadata.albumId,
      );
      if (
        before.kind !== 'pending' ||
        before.metadata.requestId !== metadata.requestId ||
        before.sending
      )
        return;

      if (
        inviteRef.current !== metadata.inviteId ||
        versionRef.current !== metadata.versionId
      ) {
        if (uiStillCurrent())
          setRecoveryError('請明確重新選取原邀請與版本，再重試保留的操作。');
        return;
      }
      if (
        !selectableInvites(inviteItemsRef.current, albumId).some(
          (invite) => invite.id === metadata.inviteId,
        )
      ) {
        if (uiStillCurrent())
          setRecoveryError(
            '原邀請目前不在此相簿的已封存邀請清單中，無法重試。',
          );
        return;
      }
      if (feature !== 'enabled') {
        if (uiStillCurrent())
          setRecoveryError('攝影師留言功能目前未開放，操作仍保留待確認。');
        return;
      }
      if (
        metadata.operation === 'set_processing_state' &&
        processingFeature !== 'enabled'
      ) {
        if (uiStillCurrent())
          setRecoveryError(
            '攝影師處理狀態目前未開放或無法確認；原操作仍保留待確認。',
          );
        return;
      }

      try {
        await checkOwner(metadata.actorId);
      } catch {
        const currentIntent = readOwnerCommentJournal(
          metadata.actorId,
          metadata.albumId,
        );
        if (
          currentIntent.kind === 'pending' &&
          currentIntent.metadata.requestId === metadata.requestId &&
          uiStillCurrent()
        )
          setRecoveryError(
            '目前無法確認相同攝影師帳號登入，保留原操作供稍後重試。',
          );
        return;
      }

      if (!uiStillCurrent()) return;
      if (
        !claimOwnerCommentIntent(
          metadata.actorId,
          metadata.albumId,
          metadata.requestId,
          command,
        )
      ) {
        const currentIntent = readOwnerCommentJournal(
          metadata.actorId,
          metadata.albumId,
        );
        if (
          currentIntent.kind === 'pending' &&
          currentIntent.metadata.requestId === metadata.requestId &&
          uiStillCurrent()
        )
          setRecoveryError('此操作已由另一個畫面送出，請等待原結果。');
        return;
      }
      const path =
        '/api/v1/albums/' +
        encodeURIComponent(metadata.albumId) +
        (metadata.operation === 'set_processing_state'
          ? '/comment-processing/commands'
          : '/comment-replies/commands');
      let targetCommentId = '';
      let confirmedProcessingRevision: number | null = null;
      try {
        const request = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kino-Expected-Actor': metadata.actorId,
          },
          body: JSON.stringify(command),
        } satisfies RequestInit;
        if (metadata.operation === 'set_processing_state') {
          if (command.operation !== 'set_processing_state')
            throw new ApiFailure(0, 'INTENT_OPERATION_MISMATCH');
          const result = await fetchJson(
            path,
            ownerCommentProcessingResultSchema,
            request,
          );
          if (
            result.requestId !== metadata.requestId ||
            result.operation !== metadata.operation ||
            result.commentId !== metadata.commentId ||
            result.photoId !== metadata.photoId ||
            result.versionId !== metadata.versionId ||
            result.processing.revision !==
              metadata.expectedProcessingRevision + 1 ||
            result.processing.commentRevision !==
              metadata.expectedCommentRevision ||
            result.processing.state !== metadata.state
          )
            throw new ApiFailure(200, 'RESPONSE_SCOPE_MISMATCH');
          targetCommentId = result.commentId;
          confirmedProcessingRevision = result.processing.revision;
        } else {
          if (command.operation === 'set_processing_state')
            throw new ApiFailure(0, 'INTENT_OPERATION_MISMATCH');
          const result = await fetchJson(
            path,
            ownerCommentResultSchema,
            request,
          );
          if (
            result.requestId !== metadata.requestId ||
            result.operation !== metadata.operation ||
            result.item.photoId !== metadata.photoId ||
            result.item.versionId !== metadata.versionId ||
            (metadata.operation === 'reply'
              ? result.item.parentCommentId !== metadata.parentCommentId
              : result.item.commentId !== metadata.replyId)
          )
            throw new ApiFailure(200, 'RESPONSE_SCOPE_MISMATCH');
          targetCommentId = result.item.commentId;
        }
      } catch (error) {
        const currentIntent = readOwnerCommentJournal(
          metadata.actorId,
          metadata.albumId,
        );
        if (
          currentIntent.kind !== 'pending' ||
          currentIntent.metadata.requestId !== metadata.requestId
        )
          return;
        updateOwnerCommentIntent(metadata.actorId, metadata.albumId, metadata, {
          sending: false,
        });
        if (mountedRef.current)
          setJournal(
            readOwnerCommentJournal(metadata.actorId, metadata.albumId),
          );
        if (!uiStillCurrent()) return;
        if (error instanceof ApiFailure && error.status === 409) {
          threadItemsRef.current = [];
          setThreadItems([]);
          setThreadCursor(null);
          setThreadNeedsReload(false);
          setEditor(null);
          setEditorBody('');
          setConfirmDeleteId('');
          setThreadError(
            '留言或攝影師處理狀態已有新變更，舊留言與編輯器已清除。請重新載入後核對。',
          );
        }
        setRecoveryError(
          error instanceof ApiFailure && error.status === 401
            ? '登入已失效；原操作仍保留，請重新登入後以相同操作重試。'
            : error instanceof ApiFailure &&
                error.code === 'COMMENT_PROCESSING_DISABLED'
              ? '攝影師處理狀態目前未開放；原操作仍保留。'
              : error instanceof ApiFailure &&
                  error.code === 'COMMENT_PROCESSING_OWNER_CHANGED'
                ? '攝影師帳號已變更；原操作仍保留，請確認正確帳號後重試。'
                : error instanceof ApiFailure && error.status === 409
                  ? '版本衝突；原操作仍保留。請明確重新載入核對後重試同一操作，或明確放棄原操作。'
                  : '尚無法確認操作結果；已保留相同操作編號與目標，請重試原操作。',
        );
        return;
      }

      let currentItem: OwnerCommentThreadItem | null = null;
      const beforeReconciliation = readOwnerCommentJournal(
        metadata.actorId,
        metadata.albumId,
      );
      if (
        beforeReconciliation.kind !== 'pending' ||
        beforeReconciliation.metadata.requestId !== metadata.requestId
      )
        return;
      try {
        if (!uiStillCurrent()) throw new ApiFailure(0, 'STALE_VIEW');
        const current = await fetchJson('/api/v1/me', currentOwnerSchema);
        if (current.actor.id !== metadata.actorId || current.role !== 'owner')
          throw new ApiFailure(403, 'OWNER_CHANGED');

        const page = await readThreadPage(
          intentScope,
          undefined,
          targetCommentId,
        );
        const readItem = page.items[0];
        if (!readItem || readItem.commentId !== targetCommentId)
          throw new ApiFailure(200, 'RESPONSE_TARGET_MISMATCH');
        if (
          metadata.operation === 'set_processing_state' &&
          (readItem.authorType !== 'guest' ||
            (readItem.processing?.revision ?? 0) <
              (confirmedProcessingRevision ?? 0))
        )
          throw new ApiFailure(200, 'RESPONSE_TARGET_MISMATCH');

        const after = await fetchJson('/api/v1/me', currentOwnerSchema);
        if (after.actor.id !== metadata.actorId || after.role !== 'owner')
          throw new ApiFailure(403, 'OWNER_CHANGED');
        if (!uiStillCurrent()) throw new ApiFailure(0, 'STALE_VIEW');
        currentItem = readItem;
      } catch {
        currentItem = null;
      }

      if (!currentItem) {
        updateOwnerCommentIntent(metadata.actorId, metadata.albumId, metadata, {
          sending: false,
        });
        if (mountedRef.current)
          setJournal(
            readOwnerCommentJournal(metadata.actorId, metadata.albumId),
          );
        if (uiStillCurrent()) {
          setRecoveryError(
            '操作已確認；目前留言狀態尚未重新讀取。原操作仍保留，請重新載入後重試相同操作或明確放棄。',
          );
          setNotice('操作收據已確認，尚未讀取目前留言狀態。');
        }
        return;
      }

      const finished = finishOwnerCommentIntent(
        metadata.actorId,
        metadata.albumId,
        metadata,
      );
      if (finished === 'stale') return;
      if (!mountedRef.current) return;
      setJournal(readOwnerCommentJournal(metadata.actorId, metadata.albumId));
      if (!uiStillCurrent()) return;

      setRecoveryBody('');
      setRecoveryError('');
      setDiscardArmedFor('');
      setEditor(null);
      setEditorBody('');
      setConfirmDeleteId('');
      const reconciledItem = currentItem;
      if (reconciledItem) {
        const existing = threadItemsRef.current;
        const found = existing.find(
          (item) => item.commentId === reconciledItem.commentId,
        );
        const replacement = found
          ? mergeThreadItemMonotone(found, reconciledItem)
          : reconciledItem;
        const next = found
          ? existing.map((item) =>
              item.commentId === reconciledItem.commentId ? replacement : item,
            )
          : [...existing, replacement].sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.commentId.localeCompare(right.commentId),
            );
        threadItemsRef.current = next;
        setThreadItems(next);
        setThreadCursor(null);
        setThreadNeedsReload(true);
        setThreadError('');
        setNotice(
          finished === 'cleanup-failed'
            ? '操作已確認。瀏覽器未能清除本機恢復資料；請勿建立重複留言，先重新載入確認。'
            : '操作已確認，顯示前已重新讀取目前留言狀態。',
        );
      } else {
        threadItemsRef.current = [];
        setThreadItems([]);
        setThreadCursor(null);
        setThreadNeedsReload(false);
        setNotice(
          finished === 'cleanup-failed'
            ? '操作已確認，但本機恢復資料清理或目前狀態讀取未完成。請重新載入核對。'
            : '操作已確認；目前狀態尚未讀取完成，請重新載入留言串。',
        );
      }
    },
    [albumId, checkOwner, feature, photoId, processingFeature, readThreadPage],
  );

  const prepareAndSend = useCallback(
    async (input: unknown) => {
      if (preparingRef.current) return;
      const generation = uiGeneration.current;
      const scope = selectedScope();
      if (!scope) {
        setEditorError('請先明確選擇客戶邀請與版本。');
        return;
      }
      if (journal.kind !== 'none' && journal.kind !== 'confirmed') {
        setEditorError('已有一筆操作待確認，請先重試或明確放棄該操作。');
        return;
      }
      const reply = ownerCommentCommandSchema.safeParse(input);
      const processing = ownerCommentProcessingCommandSchema.safeParse(input);
      if (!reply.success && !processing.success) {
        const isProcessingIntent =
          typeof input === 'object' &&
          input !== null &&
          'operation' in input &&
          input.operation === 'set_processing_state';
        const message = isProcessingIntent
          ? '無法驗證攝影師處理狀態；請重新載入留言串。'
          : '留言內容無效，請確認字數並移除隱藏控制字元。';
        if (isProcessingIntent) setProcessingError(message);
        else setEditorError(message);
        return;
      }
      let command: OwnerCommentIntentCommand;
      if (reply.success) command = reply.data;
      else if (processing.success) command = processing.data;
      else return;
      const isProcessingIntent = command.operation === 'set_processing_state';
      const reportError = (message: string) => {
        if (isProcessingIntent) setProcessingError(message);
        else setEditorError(message);
      };
      if (isProcessingIntent && processingFeature !== 'enabled') {
        setProcessingError(
          '攝影師處理狀態目前未開放或無法確認；操作尚未送出。',
        );
        return;
      }

      preparingRef.current = true;
      let ownsPreparation = true;
      const releasePreparation = () => {
        if (!ownsPreparation) return;
        ownsPreparation = false;
        preparingRef.current = false;
      };
      try {
        const body =
          command.operation === 'reply' || command.operation === 'edit_reply'
            ? command.body
            : undefined;
        const bodySha256 = body === undefined ? undefined : await sha256(body);
        if (
          generation !== uiGeneration.current ||
          !mountedRef.current ||
          !visibleRef.current ||
          inviteRef.current !== scope.inviteId ||
          versionRef.current !== scope.versionId ||
          ownerRef.current?.actor.id !== scope.actorId
        ) {
          if (
            mountedRef.current &&
            visibleRef.current &&
            generation === uiGeneration.current
          )
            reportError('操作目標已變更，請重新載入並核對留言。');
          return;
        }
        const metadata = metadataFor(scope, command, bodySha256);
        const saved = saveOwnerCommentIntent(metadata, command);
        if (!saved.ok) {
          setJournal(readOwnerCommentJournal(scope.actorId, scope.albumId));
          reportError(
            saved.reason === 'storage'
              ? '無法安全保存恢復資訊；尚未送出操作。請檢查瀏覽器工作階段儲存空間。'
              : '已有待確認操作或恢復資料無法驗證；尚未送出新操作。',
          );
          return;
        }
        setJournal(readOwnerCommentJournal(scope.actorId, scope.albumId));
        reportError('');
        setProcessingError('');
        setNotice('');
        releasePreparation();
        await sendIntent(metadata, command);
      } catch {
        if (
          mountedRef.current &&
          visibleRef.current &&
          generation === uiGeneration.current
        )
          reportError('無法準備安全的恢復資料；尚未送出操作。');
      } finally {
        releasePreparation();
      }
    },
    [journal, processingFeature, selectedScope, sendIntent],
  );

  const setProcessingState = (
    item: OwnerCommentThreadItem,
    state: OwnerCommentProcessingCommand['state'],
  ) => {
    if (
      processingFeature !== 'enabled' ||
      item.authorType !== 'guest' ||
      item.state === 'deleted' ||
      !selectedInviteId ||
      !selectedVersionId ||
      item.photoId !== photoId ||
      item.versionId !== selectedVersionId
    )
      return;
    setProcessingError('');
    const command = ownerCommentProcessingCommandSchema.safeParse({
      requestId: crypto.randomUUID(),
      operation: 'set_processing_state',
      inviteId: selectedInviteId,
      photoId: item.photoId,
      versionId: selectedVersionId,
      commentId: item.commentId,
      expectedCommentRevision: item.revision,
      expectedProcessingRevision: item.processing?.revision ?? 0,
      state,
    });
    if (!command.success) {
      setProcessingError('無法驗證攝影師處理狀態；請重新載入留言串。');
      return;
    }
    void prepareAndSend(command.data);
  };

  const submitEditor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || !owner || !selectedInviteId || !selectedVersionId) return;
    if (editor.kind === 'reply') {
      const parent = threadItems.find(
        (item) => item.commentId === editor.parentCommentId,
      );
      if (
        !parent ||
        parent.authorType !== 'guest' ||
        parent.state === 'deleted' ||
        parent.revision !== editor.expectedParentRevision
      ) {
        setThreadItems([]);
        setThreadCursor(null);
        setEditor(null);
        setEditorBody('');
        setThreadError('原留言已有變更，舊資料已清除。請重新載入後再回覆。');
        return;
      }
    } else {
      const reply = threadItems.find(
        (item) => item.commentId === editor.replyId,
      );
      if (
        !reply ||
        reply.authorType !== 'owner' ||
        !reply.canEdit ||
        reply.state !== 'open' ||
        reply.revision !== editor.expectedRevision
      ) {
        setThreadItems([]);
        setThreadCursor(null);
        setEditor(null);
        setEditorBody('');
        setThreadError('原回覆已有變更，舊資料已清除。請重新載入後再編輯。');
        return;
      }
    }

    const requestId = crypto.randomUUID();
    const rawCommand =
      editor.kind === 'reply'
        ? {
            requestId,
            operation: 'reply' as const,
            inviteId: selectedInviteId,
            photoId,
            versionId: selectedVersionId,
            parentCommentId: editor.parentCommentId,
            expectedParentRevision: editor.expectedParentRevision,
            body: editorBody,
          }
        : {
            requestId,
            operation: 'edit_reply' as const,
            replyId: editor.replyId,
            expectedRevision: editor.expectedRevision,
            body: editorBody,
          };
    const parsedBody = guestCommentBodySchema.safeParse(editorBody);
    if (!parsedBody.success) {
      setEditorError('留言需為 1–2,000 個字元，且不可含隱藏控制字元。');
      return;
    }
    void prepareAndSend({ ...rawCommand, body: parsedBody.data });
  };

  const deleteReply = (item: OwnerCommentThreadItem) => {
    if (
      item.authorType !== 'owner' ||
      !item.canEdit ||
      item.state !== 'open' ||
      !selectedInviteId ||
      !selectedVersionId
    )
      return;
    const command = ownerCommentCommandSchema.safeParse({
      requestId: crypto.randomUUID(),
      operation: 'delete_reply',
      replyId: item.commentId,
      expectedRevision: item.revision,
    });
    if (!command.success) {
      setEditorError('無法驗證刪除操作；請重新載入留言串。');
      return;
    }
    void prepareAndSend(command.data);
  };

  const retryPending = async () => {
    const activeOwner = ownerRef.current;
    if (!activeOwner) return;
    const currentIntent = readOwnerCommentJournal(
      activeOwner.actor.id,
      albumId,
    );
    if (currentIntent.kind !== 'pending') return;
    const metadata = currentIntent.metadata;
    const generation = uiGeneration.current;
    const intentStillCurrent = () => {
      const latest = readOwnerCommentJournal(
        metadata.actorId,
        metadata.albumId,
      );
      return (
        latest.kind === 'pending' &&
        latest.metadata.requestId === metadata.requestId
      );
    };
    const viewStillCurrent = () =>
      mountedRef.current &&
      visibleRef.current &&
      generation === uiGeneration.current &&
      ownerRef.current?.actor.id === metadata.actorId &&
      inviteRef.current === metadata.inviteId &&
      versionRef.current === metadata.versionId;
    if (
      inviteRef.current !== metadata.inviteId ||
      versionRef.current !== metadata.versionId
    ) {
      setRecoveryError('請先明確重新選取原邀請與版本，再重試保留的操作。');
      return;
    }
    let command = currentIntent.command;
    if (!command) {
      if (
        metadata.operation === 'delete_reply' ||
        metadata.operation === 'set_processing_state'
      ) {
        command = commandFromMetadata(metadata, '');
      } else {
        const parsedBody = guestCommentBodySchema.safeParse(recoveryBody);
        if (!parsedBody.success) {
          setRecoveryError('請重新輸入原留言文字。文字只會暫存在此頁面。');
          return;
        }
        try {
          const digest = await sha256(parsedBody.data);
          if (!intentStillCurrent() || !viewStillCurrent()) return;
          if (digest !== metadata.bodySha256) {
            setRecoveryError(
              '文字與原操作不相符；請輸入完全相同的正規化留言。',
            );
            return;
          }
          command = commandFromMetadata(metadata, parsedBody.data);
        } catch {
          if (intentStillCurrent() && viewStillCurrent())
            setRecoveryError('無法驗證恢復文字；原操作仍保留。');
          return;
        }
      }
      if (!command) {
        setRecoveryError('刪除操作恢復資料異常，請不要另建替代操作。');
        return;
      }
    }
    if (!intentStillCurrent() || !viewStillCurrent()) return;
    setRecoveryError('');
    await sendIntent(metadata, command);
  };

  const discardPending = () => {
    const activeOwner = ownerRef.current;
    if (!activeOwner) return;
    const latest = readOwnerCommentJournal(activeOwner.actor.id, albumId);
    if (latest.kind !== 'pending' && latest.kind !== 'blocked') return;
    const request = latest.kind === 'pending' ? latest.metadata : null;
    const requestId = request?.requestId ?? null;
    const target = requestId ?? 'blocked';
    if (discardArmedFor !== target) {
      setDiscardArmedFor(target);
      return;
    }
    const discarded = discardOwnerCommentIntent(
      activeOwner.actor.id,
      albumId,
      request,
    );
    if (!discarded) {
      const stillCurrent = readOwnerCommentJournal(
        activeOwner.actor.id,
        albumId,
      );
      if (
        (stillCurrent.kind === 'pending' &&
          stillCurrent.metadata.requestId === requestId) ||
        (requestId === null && stillCurrent.kind === 'blocked')
      )
        setRecoveryError('無法安全清除本機恢復資訊；沒有送出新操作。');
      return;
    }
    setJournal(readOwnerCommentJournal(activeOwner.actor.id, albumId));
    setRecoveryBody('');
    setRecoveryError('');
    setDiscardArmedFor('');
    setNotice('已明確放棄本機恢復操作；系統沒有自動建立新操作。');
  };

  const startReply = (item: OwnerCommentThreadItem) => {
    if (
      item.authorType !== 'guest' ||
      item.state === 'deleted' ||
      item.body === null
    )
      return;
    setEditor({
      kind: 'reply',
      parentCommentId: item.commentId,
      expectedParentRevision: item.revision,
    });
    setEditorBody('');
    setEditorError('');
    setConfirmDeleteId('');
  };

  const startEdit = (item: OwnerCommentThreadItem) => {
    if (
      item.authorType !== 'owner' ||
      !item.canEdit ||
      item.state !== 'open' ||
      item.body === null
    )
      return;
    setEditor({
      kind: 'edit_reply',
      replyId: item.commentId,
      expectedRevision: item.revision,
    });
    setEditorBody(item.body);
    setEditorError('');
    setConfirmDeleteId('');
  };

  const armDelete = (item: OwnerCommentThreadItem) => {
    setEditor(null);
    setEditorBody('');
    setConfirmDeleteId((current) =>
      current === item.commentId ? '' : item.commentId,
    );
  };

  const reloadThread = () => {
    threadItemsRef.current = [];
    setThreadItems([]);
    setThreadCursor(null);
    setThreadNeedsReload(false);
    setThreadError('');
    setProcessingError('');
    void loadThread();
  };

  const loadMoreThread = () => {
    if (threadCursor && !threadLoading) void loadThread(threadCursor);
  };

  const pendingLocked =
    activeJournal.kind === 'pending' || activeJournal.kind === 'blocked';
  const inviteOptions = selectable.map((invite, index) => ({
    invite,
    label: inviteDisplayLabel(invite, index),
  }));
  if (feature === 'disabled') return null;

  if (feature === 'loading' || feature === 'error') {
    return (
      <section
        aria-label="留言討論串"
        className="min-w-0 rounded-xl bg-stone-50 p-3 text-stone-900 shadow-sm sm:p-4"
      >
        <h2 className="text-base font-semibold">留言討論串</h2>
        <p
          className="mt-2 text-sm text-stone-700"
          role={feature === 'error' ? 'alert' : 'status'}
        >
          {feature === 'loading'
            ? '正在確認攝影師帳號與留言功能…'
            : '目前無法確認登入狀態或留言功能。'}
        </p>
        {feature === 'error' && (
          <button
            type="button"
            className="mt-3 min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700"
            onClick={() => window.location.reload()}
          >
            重新載入
          </button>
        )}
      </section>
    );
  }

  const writesLocked =
    pendingLocked ||
    !visible ||
    !owner ||
    !selectedInvite ||
    !selectedVersionId ||
    feature !== 'enabled';
  const retryScopeSelected =
    journal.kind === 'pending' &&
    selectedInviteId === journal.metadata.inviteId &&
    selectedVersionId === journal.metadata.versionId;
  const warningStatuses = selectedInvite ? inviteStatus(selectedInvite) : [];
  const currentVersionLabel = currentVersion
    ? '目前版本 · 第 ' + currentVersion.versionNo + ' 版'
    : '目前顯示版本 · 版本號待載入';

  return (
    <section
      aria-label={'照片留言討論串：' + filename}
      className="min-w-0 rounded-xl bg-stone-50 p-3 text-stone-900 shadow-sm sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">留言討論串</h2>
          <p className="mt-1 break-words text-sm text-stone-700">{filename}</p>
          <p className="mt-1 text-sm text-stone-600">
            請先選擇單一客戶邀請，再查看這張照片與版本的留言；回覆只會寫入該邀請。
          </p>
        </div>
        {owner && (
          <span className="shrink-0 rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-800">
            攝影師帳號已確認
          </span>
        )}
      </div>

      {activeJournal.kind === 'blocked' && (
        <div
          className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-red-950"
          role="alert"
        >
          <p className="text-sm font-semibold">
            本機恢復資料無法驗證，已停止新的留言操作。
          </p>
          <p className="mt-1 text-sm">
            {activeJournal.reason === 'corrupt'
              ? '恢復資料格式或範圍不符；遠端結果可能仍待確認。'
              : '瀏覽器工作階段儲存空間目前無法安全讀取。'}
          </p>
          <p className="mt-1 text-sm">
            若要清除此筆恢復資料，請明確完成兩步放棄確認。
          </p>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-md border border-red-700 px-3 py-2 text-sm font-semibold hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
            onClick={discardPending}
          >
            {discardArmed ? '再次確認並放棄恢復資料' : '開始放棄恢復資料'}
          </button>
        </div>
      )}

      {activeJournal.kind === 'pending' && (
        <div
          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-semibold">
            {activeJournal.sending
              ? '正在傳送原操作…'
              : '有一筆攝影師留言操作尚待確認'}
          </p>
          <p className="mt-1 text-sm">
            {activeJournal.metadata.operation === 'reply'
              ? '目標已固定為原邀請、版本與客戶留言。'
              : activeJournal.metadata.operation === 'set_processing_state'
                ? '目標已固定為原邀請、版本與客戶留言，處理狀態也已保存。'
                : '目標已固定為原邀請、版本與攝影師回覆。'}{' '}
            請重新選取原邀請與版本後，才能以相同操作編號重試。
          </p>
          {activeJournal.command === null &&
            (activeJournal.metadata.operation === 'reply' ||
              activeJournal.metadata.operation === 'edit_reply') && (
              <div className="mt-3">
                <label
                  htmlFor={'owner-comment-recovery-' + albumId}
                  className="block text-sm font-medium"
                >
                  重新輸入原留言文字
                </label>
                <textarea
                  id={'owner-comment-recovery-' + albumId}
                  value={recoveryBody}
                  onChange={(event) => setRecoveryBody(event.target.value)}
                  rows={3}
                  maxLength={8000}
                  disabled={activeJournal.sending || !visible}
                  className="mt-1 min-h-24 w-full rounded-md border border-amber-700 bg-white px-3 py-2 text-sm text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800 disabled:opacity-60"
                  placeholder="文字只會暫存在此頁面，送出前會比對原操作摘要。"
                />
              </div>
            )}
          {recoveryError && (
            <p className="mt-2 text-sm" role="alert">
              {recoveryError}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                activeJournal.sending ||
                !visible ||
                !retryScopeSelected ||
                (activeJournal.command === null && recoveryBody.length === 0)
              }
              onClick={() => void retryPending()}
              className="min-h-11 rounded-md border border-amber-800 bg-amber-100 px-3 py-2 text-sm font-semibold hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {activeJournal.sending ? '傳送中…' : '以相同操作重試'}
            </button>
            <button
              type="button"
              onClick={discardPending}
              className="min-h-11 rounded-md border border-amber-800 px-3 py-2 text-sm font-medium hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {discardArmed
                ? '再次確認放棄（不會撤回遠端操作）'
                : '開始放棄待確認操作'}
            </button>
          </div>
          {discardArmed && (
            <p className="mt-2 text-sm">
              遠端操作可能已完成。放棄只會清除本機恢復資料，不會自動建立新操作。
            </p>
          )}
        </div>
      )}

      {activeJournal.kind === 'confirmed' && (
        <div
          className="mt-3 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sky-950"
          role="status"
        >
          <p className="text-sm">
            前一筆操作已確認；本機恢復資料清理尚未成功。請先重新載入核對狀態。
          </p>
        </div>
      )}

      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label
            htmlFor={'owner-comment-invite-' + albumId}
            className="block text-sm font-medium"
          >
            客戶邀請
          </label>
          <select
            id={'owner-comment-invite-' + albumId}
            value={selectedInviteId}
            disabled={inviteLoading || inviteOptions.length === 0 || !visible}
            onChange={(event) => chooseInvite(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-stone-500 bg-white px-3 py-2 text-sm text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-60"
          >
            <option value="">請明確選擇客戶邀請</option>
            {inviteOptions.map(({ invite, label }) => (
              <option key={invite.id} value={invite.id}>
                {label}
              </option>
            ))}
          </select>
          {warningStatuses.length > 0 && (
            <p
              className="mt-2 rounded-md bg-amber-100 p-2 text-sm text-amber-950"
              role="status"
            >
              此邀請{warningStatuses.join('、')}
              ；訪客目前無法使用，但仍可查閱保留的留言。
            </p>
          )}
          {selectedInvite && !selectedInvite.permissions.can_comment && (
            <p className="mt-2 text-sm text-stone-700">
              此邀請未開放訪客留言；攝影師仍可查閱既有留言。
            </p>
          )}
          {inviteError && (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {inviteError}
            </p>
          )}
          {inviteCursor && (
            <button
              type="button"
              disabled={inviteLoading || !visible}
              onClick={() => void loadInvitePage(inviteCursor)}
              className="mt-2 min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-50"
            >
              {inviteLoading ? '載入中…' : '載入更多邀請'}
            </button>
          )}
          {invites.length === 0 && !inviteLoading && !inviteError && (
            <p className="mt-2 text-sm text-stone-600">
              此專案目前沒有已封存且授權此相簿的邀請。
            </p>
          )}
        </div>

        <div className="min-w-0">
          <label
            htmlFor={'owner-comment-version-' + albumId}
            className="block text-sm font-medium"
          >
            照片版本
          </label>
          <select
            id={'owner-comment-version-' + albumId}
            value={selectedVersionId}
            disabled={!selectedInviteId || versionLoading || !visible}
            onChange={(event) => chooseVersion(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-md border border-stone-500 bg-white px-3 py-2 text-sm text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-60"
          >
            <option value="">選擇要讀取的版本</option>
            {versionOptions.map((version) => {
              const label =
                version.id === currentVersionId
                  ? currentVersionLabel
                  : '第 ' +
                    String(version.versionNo) +
                    ' 版 · ' +
                    (version.createdAt
                      ? formatTime(version.createdAt)
                      : '建立日期未載入');
              const status = processingLabel(version.processing);
              return (
                <option key={version.id} value={version.id}>
                  {label}
                  {status ? ' · ' + status : ''}
                </option>
              );
            })}
          </select>
          {versionError && (
            <p className="mt-2 text-sm text-red-700" role="alert">
              {versionError}
            </p>
          )}
          {versionCursor && (
            <button
              type="button"
              disabled={versionLoading || !visible}
              onClick={() => void loadVersionPage(versionCursor)}
              className="mt-2 min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-50"
            >
              {versionLoading ? '載入中…' : '載入更多版本'}
            </button>
          )}
          {selectedInviteId &&
            versions.length === 0 &&
            !versionLoading &&
            !versionError && (
              <p className="mt-2 text-sm text-stone-600">
                目前沒有可讀取的版本資料。
              </p>
            )}
        </div>
      </div>

      {notice && (
        <p
          className="mt-3 rounded-md bg-sky-50 p-3 text-sm text-sky-950"
          role="status"
        >
          {notice}
        </p>
      )}

      {selectedInviteId && selectedVersionId && (
        <div className="mt-4 border-t border-stone-300 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">此邀請與版本的留言</h3>
              <p className="mt-1 text-sm text-stone-600">
                {filename} ·{' '}
                {versionOptions.find(
                  (version) => version.id === selectedVersionId,
                )
                  ? selectedVersionId === currentVersionId
                    ? currentVersionLabel
                    : '第 ' +
                      String(
                        versionOptions.find(
                          (version) => version.id === selectedVersionId,
                        )?.versionNo,
                      ) +
                      ' 版'
                  : '所選版本'}
              </p>
            </div>
            <button
              type="button"
              disabled={threadLoading || !visible}
              onClick={reloadThread}
              className="min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-50"
            >
              重新載入留言串
            </button>
          </div>

          {threadError && (
            <p
              className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
              role="alert"
            >
              {threadError}
            </p>
          )}
          {processingError && (
            <p
              className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-950"
              role="alert"
            >
              {processingError}
            </p>
          )}
          {threadLoading && (
            <p className="mt-3 text-sm text-stone-600" role="status">
              正在載入留言…
            </p>
          )}
          {!visible && (
            <p
              className="mt-3 rounded-md bg-stone-200 p-3 text-sm text-stone-800"
              role="status"
            >
              頁面失去焦點時已清除畫面上的留言與文字；重新聚焦後會重新驗證存取。
            </p>
          )}
          {visible &&
            !threadLoading &&
            !threadError &&
            threadItems.length === 0 && (
              <p className="mt-3 rounded-md bg-white p-3 text-sm text-stone-700">
                目前沒有可顯示的留言。
              </p>
            )}

          {visible && threadItems.length > 0 && (
            <ol className="mt-3 grid min-w-0 gap-3">
              {threadItems.map((item) => {
                const editActive =
                  editor?.kind === 'edit_reply' &&
                  editor.replyId === item.commentId;
                const replyActive =
                  editor?.kind === 'reply' &&
                  editor.parentCommentId === item.commentId;
                return (
                  <li
                    key={item.commentId}
                    className="min-w-0 rounded-lg border border-stone-300 bg-white p-3"
                  >
                    <article
                      aria-label={ownerItemLabel(item)}
                      className="min-w-0"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-semibold text-stone-800">
                            {ownerItemLabel(item)}
                          </span>
                          <span className="break-words text-sm font-medium">
                            {item.authorLabel}
                          </span>
                        </div>
                        <span className="text-xs text-stone-600">
                          第 {item.revision} 次修訂 · {itemStateLabel(item)} ·{' '}
                          {formatTime(item.updatedAt)}
                        </span>
                      </div>
                      {item.body !== null && (
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm text-stone-900">
                          {item.body}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-stone-500">
                        建立 {formatTime(item.createdAt)}
                      </p>
                      {item.authorType === 'guest' && (
                        <p className="mt-2 text-sm text-stone-700">
                          攝影師處理：{processingStateLabel(item.processing)}
                          {item.processing?.stale && (
                            <span className="mt-1 block text-amber-800">
                              留言有新的編輯，請攝影師重新確認
                            </span>
                          )}
                        </p>
                      )}
                    </article>

                    {item.authorType === 'guest' &&
                      item.state !== 'deleted' &&
                      processingFeature === 'enabled' && (
                        <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
                          <p className="text-sm font-medium text-stone-800">
                            更新攝影師處理狀態
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(
                              [
                                ['open', '標記待處理'],
                                ['in_progress', '標記處理中'],
                                ['resolved', '標記已處理'],
                              ] as const
                            ).map(([state, label]) => {
                              const isCurrent =
                                (item.processing?.state ?? 'open') === state;
                              return (
                                <button
                                  key={state}
                                  type="button"
                                  aria-pressed={isCurrent}
                                  disabled={
                                    writesLocked ||
                                    threadLoading ||
                                    (isCurrent && !item.processing?.stale)
                                  }
                                  onClick={() =>
                                    setProcessingState(item, state)
                                  }
                                  className="min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.authorType === 'guest' &&
                        item.state !== 'deleted' &&
                        item.body !== null && (
                          <button
                            type="button"
                            disabled={writesLocked || threadLoading}
                            onClick={() => startReply(item)}
                            className="min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            回覆此留言
                          </button>
                        )}
                      {item.authorType === 'owner' &&
                        item.canEdit &&
                        item.state === 'open' && (
                          <>
                            <button
                              type="button"
                              disabled={writesLocked || threadLoading}
                              onClick={() => startEdit(item)}
                              className="min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              編輯回覆
                            </button>
                            <button
                              type="button"
                              disabled={writesLocked || threadLoading}
                              onClick={() => armDelete(item)}
                              className="min-h-11 rounded-md border border-red-700 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              刪除回覆
                            </button>
                          </>
                        )}
                    </div>

                    {confirmDeleteId === item.commentId && (
                      <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-red-950">
                        <p className="text-sm">
                          確認刪除此攝影師回覆？留言會保留刪除紀錄，文字將改為空白。
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={writesLocked}
                            onClick={() => setConfirmDeleteId('')}
                            className="min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white disabled:opacity-50"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            disabled={writesLocked}
                            onClick={() => deleteReply(item)}
                            className="min-h-11 rounded-md border border-red-700 bg-red-100 px-3 py-2 text-sm font-semibold hover:bg-red-200 disabled:opacity-50"
                          >
                            確認刪除回覆
                          </button>
                        </div>
                      </div>
                    )}

                    {(replyActive || editActive) && (
                      <form
                        onSubmit={submitEditor}
                        className="mt-3 rounded-md bg-stone-100 p-3"
                      >
                        <label
                          htmlFor={'owner-comment-editor-' + albumId}
                          className="block text-sm font-medium"
                        >
                          {editor?.kind === 'reply'
                            ? '攝影師回覆'
                            : '編輯攝影師回覆'}
                        </label>
                        <textarea
                          id={'owner-comment-editor-' + albumId}
                          value={editorBody}
                          onChange={(event) =>
                            setEditorBody(event.target.value)
                          }
                          rows={4}
                          maxLength={8000}
                          disabled={writesLocked}
                          className="mt-1 min-h-28 w-full rounded-md border border-stone-500 bg-white px-3 py-2 text-sm text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-60"
                        />
                        {editorError && (
                          <p className="mt-2 text-sm text-red-700" role="alert">
                            {editorError}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="submit"
                            disabled={writesLocked || !editorBody.trim()}
                            className="min-h-11 rounded-md border border-stone-800 bg-stone-800 px-3 py-2 text-sm font-semibold text-white hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {editor?.kind === 'reply' ? '送出回覆' : '儲存回覆'}
                          </button>
                          <button
                            type="button"
                            disabled={pendingLocked}
                            onClick={() => {
                              setEditor(null);
                              setEditorBody('');
                              setEditorError('');
                            }}
                            className="min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white disabled:opacity-50"
                          >
                            取消編輯
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {threadNeedsReload && (
            <p
              className="mt-3 rounded-md bg-sky-50 p-3 text-sm text-sky-950"
              role="status"
            >
              操作後已用目前狀態核對回覆。若要繼續瀏覽完整留言串，請重新載入。
            </p>
          )}
          {threadCursor && !threadNeedsReload && (
            <button
              type="button"
              disabled={threadLoading || !visible}
              onClick={loadMoreThread}
              className="mt-3 min-h-11 rounded-md border border-stone-500 px-3 py-2 text-sm font-medium hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700 disabled:opacity-50"
            >
              {threadLoading ? '載入中…' : '載入更多留言'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
