'use client';

import { Button } from '@kino-pic/ui';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  createVersionApprovalRequestSchema,
  guestVersionApprovalConfirmationResultSchema,
  guestVersionApprovalConfirmationSchema,
  guestVersionApprovalListSchema,
  ownerVersionApprovalListSchema,
  ownerVersionApprovalResultSchema,
  versionApprovalsCapabilitiesSchema,
  type CreateVersionApprovalRequest,
  type GuestVersionApprovalRequest,
  type OwnerVersionApprovalRead,
} from '../../../packages/contracts/src/version-approvals';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import {
  invitePageSchema,
  type InviteSummary,
} from '../../../packages/contracts/src/invites';
import { ownerPhotoVersionsPageSchema } from '../../../packages/contracts/src/photo-versions';
import { getUploadIdentity, type UploadIdentity } from './upload-client';
import { TrackedPhotoImage } from './human-photo-views';
import { OwnerApprovedDelivery } from './approved-deliveries';

const uuid = z.uuid();
const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
const ownerJournalSchema = z
  .object({
    version: z.literal(1),
    actorId: z.uuid(),
    sessionId: z.string().min(1).max(512),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
    bodyJson: z.string().min(1).max(8192),
  })
  .strict();
const guestJournalSchema = z
  .object({
    version: z.literal(1),
    guestId: z.uuid(),
    albumId: z.uuid(),
    photoId: z.uuid(),
    approvalId: z.uuid(),
    bodyJson: z.string().min(1).max(2048),
  })
  .strict();
type OwnerJournal = z.infer<typeof ownerJournalSchema>;
type GuestJournal = z.infer<typeof guestJournalSchema>;
type Journal<T> =
  | { status: 'none'; key: string }
  | { status: 'pending'; key: string; raw: string; value: T }
  | { status: 'blocked'; key: string };

class RequestFailure extends Error {
  constructor(
    readonly status: number | null,
    readonly code = '',
  ) {
    super(code || 'VERSION_APPROVAL_REQUEST_FAILED');
  }
}

async function requestJson<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorEnvelope.safeParse(body);
    throw new RequestFailure(
      response.status,
      error.success ? error.data.error.code : '',
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new RequestFailure(null, 'RESPONSE_INVALID');
  return parsed.data;
}

function segment(value: string) {
  return encodeURIComponent(uuid.parse(value));
}
function query(cursor: string | null) {
  return cursor === null ? '' : '?cursor=' + encodeURIComponent(cursor);
}
function ownerPath(albumId: string, photoId: string) {
  return (
    '/api/v1/albums/' +
    segment(albumId) +
    '/photos/' +
    segment(photoId) +
    '/version-approvals'
  );
}
function guestPath(albumId: string, photoId: string) {
  return (
    '/api/guest/albums/' +
    segment(albumId) +
    '/photos/' +
    segment(photoId) +
    '/version-approvals'
  );
}
function ownerHeadPath(photoId: string) {
  return '/api/v1/photos/' + segment(photoId) + '/versions';
}
function ownerPreview(photoId: string, versionId: string) {
  return (
    '/api/v1/photos/' +
    segment(photoId) +
    '/versions/' +
    segment(versionId) +
    '/assets/preview'
  );
}
function guestPreview(photoId: string, versionId: string) {
  return (
    '/api/guest/photos/' +
    segment(photoId) +
    '/versions/' +
    segment(versionId) +
    '/assets/preview'
  );
}
function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
function persist(key: string, value: object) {
  const local = browserStorage();
  if (!local) return null;
  try {
    const raw = JSON.stringify(value);
    local.setItem(key, raw);
    return local.getItem(key) === raw ? raw : null;
  } catch {
    return null;
  }
}
function removeExact(key: string, raw: string) {
  const local = browserStorage();
  if (!local) return false;
  try {
    if (local.getItem(key) !== raw) return false;
    local.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
function parseOwnerBody(bodyJson: string) {
  try {
    const result = createVersionApprovalRequestSchema.safeParse(
      JSON.parse(bodyJson),
    );
    return result.success && JSON.stringify(result.data) === bodyJson
      ? result.data
      : null;
  } catch {
    return null;
  }
}
function parseGuestBody(bodyJson: string) {
  try {
    const result = guestVersionApprovalConfirmationSchema.safeParse(
      JSON.parse(bodyJson),
    );
    return result.success && JSON.stringify(result.data) === bodyJson
      ? result.data
      : null;
  } catch {
    return null;
  }
}
type OwnerScope = {
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  filename: string;
};
function ownerIdentityKey(value: UploadIdentity) {
  return JSON.stringify([value.actorId, value.sessionId]);
}
function ownerJournalKey(scope: OwnerScope, identity: UploadIdentity) {
  return (
    'kino-pic:version-approvals:owner:v1:' +
    [
      scope.workspaceId,
      scope.projectId,
      scope.albumId,
      scope.photoId,
      identity.actorId,
      identity.sessionId,
    ]
      .map(encodeURIComponent)
      .join(':')
  );
}
function guestJournalKey(
  albumId: string,
  photoId: string,
  guestId: string,
  approvalId: string,
) {
  return (
    'kino-pic:version-approvals:guest:v1:' +
    [albumId, photoId, guestId, approvalId].map(encodeURIComponent).join(':')
  );
}
function readOwnerJournal(
  key: string,
  scope: OwnerScope,
  identity: UploadIdentity,
): Journal<OwnerJournal & { body: CreateVersionApprovalRequest }> {
  const local = browserStorage();
  if (!local) return { status: 'blocked', key };
  try {
    const raw = local.getItem(key);
    if (raw === null) return { status: 'none', key };
    const parsed = ownerJournalSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'blocked', key };
    const entry = parsed.data;
    const body = parseOwnerBody(entry.bodyJson);
    if (
      !body ||
      entry.actorId !== identity.actorId ||
      entry.sessionId !== identity.sessionId ||
      entry.workspaceId !== scope.workspaceId ||
      entry.projectId !== scope.projectId ||
      entry.albumId !== scope.albumId ||
      entry.photoId !== scope.photoId ||
      body.expectedOwnerId !== identity.actorId
    )
      return { status: 'blocked', key };
    return { status: 'pending', key, raw, value: { ...entry, body } };
  } catch {
    return { status: 'blocked', key };
  }
}
function readGuestJournal(
  key: string,
  albumId: string,
  photoId: string,
  guestId: string,
  approvalId: string,
): Journal<
  GuestJournal & {
    body: z.infer<typeof guestVersionApprovalConfirmationSchema>;
  }
> {
  const local = browserStorage();
  if (!local) return { status: 'blocked', key };
  try {
    const raw = local.getItem(key);
    if (raw === null) return { status: 'none', key };
    const parsed = guestJournalSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'blocked', key };
    const entry = parsed.data;
    const body = parseGuestBody(entry.bodyJson);
    if (
      !body ||
      entry.albumId !== albumId ||
      entry.photoId !== photoId ||
      entry.guestId !== guestId ||
      entry.approvalId !== approvalId ||
      body.expectedGuestId !== guestId
    )
      return { status: 'blocked', key };
    return { status: 'pending', key, raw, value: { ...entry, body } };
  } catch {
    return { status: 'blocked', key };
  }
}
function sameIds(left: readonly string[], right: readonly string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function inviteIsActive(invite: InviteSummary, scope: OwnerScope) {
  return (
    invite.workspaceId === scope.workspaceId &&
    invite.projectId === scope.projectId &&
    invite.permissions.can_view &&
    invite.sealed &&
    invite.revokedAt === null &&
    Date.parse(invite.expiresAt) > Date.now() &&
    invite.albums.some((album) => album.id === scope.albumId)
  );
}
function failureMessage(error: unknown) {
  if (error instanceof RequestFailure) {
    if ([401, 403, 404].includes(error.status ?? 0))
      return '登入或相簿權限已變更，私有確認資料已隱藏。';
    if (error.status === 409) {
      if (error.code === 'REQUEST_ID_CONFLICT')
        return '此確認請求已綁定原工作階段或原內容，無法用目前工作階段重試。請先重新載入核對確認紀錄；核對前請保留原操作，不要另建確認。';
      return '版本或邀請狀態已變更。請重新載入核對；未確認操作仍保留原內容。';
    }
    if (error.status === 503) return '版本確認服務暫時無法使用，請稍後重試。';
    if (error.status === null)
      return '伺服器回傳的確認資料無法核對；原操作已保留。';
  }
  return '目前無法確認操作結果。原請求已保留，可用相同內容重試。';
}
function shouldHide(error: unknown) {
  return (
    error instanceof RequestFailure &&
    [401, 403, 404].includes(error.status ?? 0)
  );
}
function ownerResultMatches(
  result: z.infer<typeof ownerVersionApprovalResultSchema>,
  scope: OwnerScope,
  body: CreateVersionApprovalRequest,
) {
  return (
    result.requestId === body.requestId &&
    result.request.workspaceId === scope.workspaceId &&
    result.request.projectId === scope.projectId &&
    result.request.albumId === scope.albumId &&
    result.request.photoId === scope.photoId &&
    result.request.versionId === body.expectedHead.versionId &&
    result.request.headRevision === body.expectedHead.revision &&
    sameIds(result.request.inviteIds, body.inviteIds)
  );
}
async function loadOwnerPanel(
  scope: OwnerScope,
  inviteCursor: string | null,
  approvalCursor: string | null,
  signal: AbortSignal,
) {
  const capability = await requestJson(
    '/api/v1/version-approvals/capabilities',
    versionApprovalsCapabilitiesSchema,
    { signal },
  );
  if (!capability.enabled) return { enabled: false as const };
  const identity = await getUploadIdentity(signal);
  const inviteQuery =
    inviteCursor === null ? '' : '?cursor=' + encodeURIComponent(inviteCursor);
  const [headPage, invitePage, approvalPage] = await Promise.all([
    requestJson(ownerHeadPath(scope.photoId), ownerPhotoVersionsPageSchema, {
      signal,
    }),
    requestJson(
      '/api/v1/projects/' + segment(scope.projectId) + '/invites' + inviteQuery,
      invitePageSchema,
      { signal },
    ),
    requestJson(
      ownerPath(scope.albumId, scope.photoId) + query(approvalCursor),
      ownerVersionApprovalListSchema,
      { signal },
    ),
  ]);
  const after = await getUploadIdentity(signal);
  if (ownerIdentityKey(identity) !== ownerIdentityKey(after))
    throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
  if (
    headPage.photoId !== scope.photoId ||
    invitePage.invites.some(
      (invite) =>
        invite.projectId !== scope.projectId ||
        invite.workspaceId !== scope.workspaceId,
    ) ||
    approvalPage.requests.some(
      (row) =>
        row.workspaceId !== scope.workspaceId ||
        row.projectId !== scope.projectId ||
        row.albumId !== scope.albumId ||
        row.photoId !== scope.photoId,
    ) ||
    (approvalCursor !== null && approvalPage.nextCursor === approvalCursor)
  ) {
    throw new RequestFailure(null, 'RESPONSE_SCOPE_MISMATCH');
  }
  const journal = readOwnerJournal(
    ownerJournalKey(scope, identity),
    scope,
    identity,
  );
  const currentVersion = headPage.versions.find(
    (version) => version.id === headPage.current.versionId,
  );
  return {
    enabled: true as const,
    identity,
    head: headPage.current,
    headVersionNo: currentVersion?.versionNo ?? null,
    invitePage,
    approvalPage,
    journal,
  };
}

type OwnerPanelState =
  | { status: 'loading' | 'disabled'; scopeKey: string; pageKey: string }
  | { status: 'error'; scopeKey: string; pageKey: string; message: string }
  | {
      status: 'ready';
      scopeKey: string;
      pageKey: string;
      identity: UploadIdentity;
      head: z.infer<typeof ownerPhotoVersionsPageSchema>['current'];
      headVersionNo: number | null;
      invitePage: z.infer<typeof invitePageSchema>;
      approvalPage: z.infer<typeof ownerVersionApprovalListSchema>;
      journal: Journal<OwnerJournal & { body: CreateVersionApprovalRequest }>;
    };

export type OwnerVersionApprovalsPanelProps = {
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  filename: string;
  onPendingChange?: (pending: boolean) => void;
};

export function OwnerVersionApprovalsPanel({
  workspaceId,
  projectId,
  albumId,
  photoId,
  filename,
  onPendingChange,
}: OwnerVersionApprovalsPanelProps) {
  const scope = useMemo<OwnerScope>(
    () => ({
      workspaceId: uuid.parse(workspaceId),
      projectId: uuid.parse(projectId),
      albumId: uuid.parse(albumId),
      photoId: uuid.parse(photoId),
      filename,
    }),
    [workspaceId, projectId, albumId, photoId, filename],
  );
  const scopeKey = JSON.stringify([
    scope.workspaceId,
    scope.projectId,
    scope.albumId,
    scope.photoId,
  ]);
  const [inviteStack, setInviteStack] = useState<(string | null)[]>([null]);
  const [approvalStack, setApprovalStack] = useState<(string | null)[]>([null]);
  const inviteCursor = inviteStack[inviteStack.length - 1] ?? null;
  const approvalCursor = approvalStack[approvalStack.length - 1] ?? null;
  const [refreshNo, setRefreshNo] = useState(0);
  const pageKey = JSON.stringify([inviteCursor, approvalCursor, refreshNo]);
  const [panel, setPanel] = useState<OwnerPanelState>({
    status: 'loading',
    scopeKey: '',
    pageKey: '',
  });
  const [selected, setSelected] = useState<{
    identityKey: string;
    invites: Map<string, InviteSummary>;
  } | null>(null);
  const [confirmedFingerprint, setConfirmedFingerprint] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [clearChecked, setClearChecked] = useState(false);
  const deliveryPendingIdsRef = useRef<ReadonlySet<string>>(new Set());
  const generationRef = useRef(0);
  const activeScopeRef = useRef(scopeKey);
  const lastIdentityRef = useRef('');
  const headingId = useId();
  useEffect(() => {
    activeScopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    void loadOwnerPanel(scope, inviteCursor, approvalCursor, controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          activeScopeRef.current !== scopeKey
        )
          return;
        if (!result.enabled) {
          setSelected(null);
          setConfirmedFingerprint('');
          setPanel({ status: 'disabled', scopeKey, pageKey });
          return;
        }
        const key = ownerIdentityKey(result.identity);
        if (lastIdentityRef.current && lastIdentityRef.current !== key) {
          setSelected(null);
          setConfirmedFingerprint('');
          setNotice('登入身分已變更，請重新檢查邀請與目前版本。');
        }
        lastIdentityRef.current = key;
        setPanel({
          status: 'ready',
          scopeKey,
          pageKey,
          identity: result.identity,
          head: result.head,
          headVersionNo: result.headVersionNo,
          invitePage: result.invitePage,
          approvalPage: result.approvalPage,
          journal: result.journal,
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          activeScopeRef.current !== scopeKey
        )
          return;
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: failureMessage(error),
        });
      });
    return () => {
      controller.abort();
      generationRef.current += 1;
    };
  }, [scope, scopeKey, inviteCursor, approvalCursor, pageKey]);

  const current =
    panel.scopeKey === scopeKey && panel.pageKey === pageKey ? panel : null;
  const ready = current?.status === 'ready' ? current : null;
  const identityKey = ready ? ownerIdentityKey(ready.identity) : '';
  const chosen =
    ready && selected?.identityKey === identityKey
      ? selected.invites
      : new Map<string, InviteSummary>();
  const selectable = ready
    ? ready.invitePage.invites.filter((invite) => inviteIsActive(invite, scope))
    : [];
  const fingerprint = ready
    ? JSON.stringify([
        identityKey,
        ready.head.versionId,
        ready.head.revision,
        [...chosen.keys()].sort(),
      ])
    : '';

  function updateReady(
    update: (
      value: Extract<OwnerPanelState, { status: 'ready' }>,
    ) => OwnerPanelState,
  ) {
    setPanel((value) =>
      value.status === 'ready' &&
      value.scopeKey === scopeKey &&
      value.pageKey === pageKey
        ? update(value)
        : value,
    );
  }
  function updateDeliveryPending(approvalId: string, pending: boolean) {
    const current = deliveryPendingIdsRef.current;
    if (current.has(approvalId) === pending) return;
    const next = new Set(current);
    if (pending) next.add(approvalId);
    else next.delete(approvalId);
    deliveryPendingIdsRef.current = next;
    onPendingChange?.(next.size > 0);
  }
  function toggleInvite(invite: InviteSummary) {
    if (!ready) return;
    const next =
      selected?.identityKey === identityKey
        ? new Map(selected.invites)
        : new Map<string, InviteSummary>();
    if (next.has(invite.id)) next.delete(invite.id);
    else {
      if (next.size >= 24) return;
      next.set(invite.id, invite);
    }
    setSelected({ identityKey, invites: next });
    setConfirmedFingerprint('');
    setNotice('');
  }
  function nextCursor(
    stack: (string | null)[],
    cursor: string | null,
    setter: (value: (string | null)[]) => void,
  ) {
    if (cursor === null || stack.includes(cursor)) {
      setNotice('分頁位置無法核對，請重新載入。');
      return;
    }
    setter([...stack.slice(-31), cursor]);
  }
  function previous(
    stack: (string | null)[],
    setter: (value: (string | null)[]) => void,
    first = false,
  ) {
    if (first) setter([null]);
    else if (stack.length > 1) setter(stack.slice(0, -1));
  }

  async function submitOwnerJournal(
    journal: Journal<OwnerJournal & { body: CreateVersionApprovalRequest }>,
    alreadyBusy = false,
  ) {
    if (
      journal.status !== 'pending' ||
      (!alreadyBusy && busy) ||
      activeScopeRef.current !== scopeKey
    )
      return;
    if (!alreadyBusy) setBusy(true);
    setNotice('');
    try {
      const before = await getUploadIdentity();
      if (
        before.actorId !== journal.value.actorId ||
        before.sessionId !== journal.value.sessionId
      ) {
        throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
      }
      const result = await requestJson(
        ownerPath(scope.albumId, scope.photoId),
        ownerVersionApprovalResultSchema,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kino-Expected-Actor': journal.value.actorId,
          },
          body: journal.value.bodyJson,
        },
      );
      const after = await getUploadIdentity();
      if (
        ownerIdentityKey(before) !== ownerIdentityKey(after) ||
        !ownerResultMatches(result, scope, journal.value.body)
      ) {
        throw new RequestFailure(null, 'RESULT_SCOPE_MISMATCH');
      }
      if (!removeExact(journal.key, journal.raw)) {
        setNotice('伺服器已回覆，但本機重試記錄無法核對；請保留原內容並重試。');
        return;
      }
      updateReady((value) => ({
        ...value,
        journal: { status: 'none', key: journal.key },
      }));
      setSelected(null);
      setConfirmedFingerprint('');
      setClearChecked(false);
      setNotice('確認請求已建立，等待受邀訪客查看並確認固定版本。');
      setRefreshNo((value) => value + 1);
    } catch (error) {
      setNotice(failureMessage(error));
      if (shouldHide(error))
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: failureMessage(error),
        });
      else if (error instanceof RequestFailure && error.status === 409) {
        setConfirmedFingerprint('');
        setRefreshNo((value) => value + 1);
      }
    } finally {
      if (activeScopeRef.current === scopeKey) setBusy(false);
    }
  }

  async function createOwnerJournal() {
    if (
      !ready ||
      busy ||
      ready.journal.status !== 'none' ||
      !chosen.size ||
      chosen.size > 24 ||
      confirmedFingerprint !== fingerprint ||
      !fingerprint
    )
      return;
    if ([...chosen.values()].some((invite) => !inviteIsActive(invite, scope))) {
      setNotice('所選邀請已失效或不再適用此相簿，請重新載入後選擇。');
      setConfirmedFingerprint('');
      setRefreshNo((value) => value + 1);
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const before = await getUploadIdentity();
      if (ownerIdentityKey(before) !== identityKey)
        throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
      const headPage = await requestJson(
        ownerHeadPath(scope.photoId),
        ownerPhotoVersionsPageSchema,
      );
      const afterRead = await getUploadIdentity();
      if (
        ownerIdentityKey(before) !== ownerIdentityKey(afterRead) ||
        headPage.photoId !== scope.photoId
      ) {
        throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
      }
      if (
        headPage.current.versionId !== ready.head.versionId ||
        headPage.current.revision !== ready.head.revision
      ) {
        setConfirmedFingerprint('');
        setNotice('目前版本剛有變更，已重新載入。請檢查新版本後再明確確認。');
        setRefreshNo((value) => value + 1);
        return;
      }
      const body = createVersionApprovalRequestSchema.parse({
        requestId: crypto.randomUUID(),
        expectedOwnerId: before.actorId,
        expectedHead: headPage.current,
        inviteIds: [...chosen.keys()],
        confirm: true,
      });
      const entry = ownerJournalSchema.parse({
        version: 1,
        actorId: before.actorId,
        sessionId: before.sessionId,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        albumId: scope.albumId,
        photoId: scope.photoId,
        bodyJson: JSON.stringify(body),
      });
      const key = ownerJournalKey(scope, before);
      if (persist(key, entry) === null) {
        setNotice('無法安全保存這次固定確認內容，尚未送出任何請求。');
        return;
      }
      const journal = readOwnerJournal(key, scope, before);
      if (journal.status !== 'pending') {
        setNotice('無法再次核對本機確認內容，尚未送出任何請求。');
        return;
      }
      updateReady((value) => ({ ...value, journal }));
      setClearChecked(false);
      await submitOwnerJournal(journal, true);
    } catch (error) {
      setNotice(failureMessage(error));
      if (shouldHide(error))
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: failureMessage(error),
        });
    } finally {
      if (activeScopeRef.current === scopeKey) setBusy(false);
    }
  }

  function clearOwnerJournal() {
    if (!ready || ready.journal.status !== 'pending' || !clearChecked) return;
    if (!removeExact(ready.journal.key, ready.journal.raw)) {
      setNotice('本機記錄已變更，沒有清除；請重新載入。');
      return;
    }
    updateReady((value) => ({
      ...value,
      journal: { status: 'none', key: ready.journal.key },
    }));
    setClearChecked(false);
    setNotice('已清除本機重試記錄；這不會撤回可能已送達的請求。');
  }

  if (!current || current.status === 'loading' || current.status === 'disabled')
    return null;
  if (current.status === 'error') {
    return (
      <section
        data-testid="version-approvals-owner"
        className="mt-4 min-w-0 rounded-lg border border-stone-200 bg-white p-4 text-stone-900"
        aria-labelledby={headingId}
      >
        <h3 id={headingId} className="text-base font-semibold">
          版本確認
        </h3>
        <p role="alert" className="mt-2 break-words text-sm text-red-700">
          {current.message}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => setRefreshNo((value) => value + 1)}
        >
          重新載入
        </Button>
      </section>
    );
  }
  if (!ready) return null;
  const journal = ready.journal;
  const pending = journal.status === 'pending';
  const blocked = journal.status === 'blocked';

  return (
    <section
      data-testid="version-approvals-owner"
      className="mt-4 min-w-0 space-y-4 rounded-lg border border-stone-200 bg-white p-4 text-stone-900"
      aria-labelledby={headingId}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold">
            版本確認
          </h3>
          <p className="mt-1 break-words text-sm text-stone-600">
            為「{scope.filename}」建立固定版本的確認請求；任一受邀訪客確認即可。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => setRefreshNo((value) => value + 1)}
        >
          重新載入
        </Button>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 rounded-md border border-stone-200 p-3">
          <p className="text-sm font-medium">本次固定版本</p>
          <p className="mt-1 text-sm text-stone-600">
            {ready.headVersionNo === null
              ? '目前採用版本'
              : '版本 ' + ready.headVersionNo}{' '}
            · 載入時為相片目前版本
          </p>
          <TrackedPhotoImage
            photoId={scope.photoId}
            versionId={ready.head.versionId}
            src={ownerPreview(scope.photoId, ready.head.versionId)}
            alt={scope.filename + '，目前固定版本'}
            className="mt-2 max-h-48 w-full rounded bg-stone-100 object-contain"
          />
          <p className="mt-2 break-words text-xs text-stone-500">
            版本更新後，原請求仍只對應這個固定版本。
          </p>
        </div>
        <div className="min-w-0 rounded-md border border-stone-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              選擇適用此相簿的有效邀請（1–24）
            </p>
            <span className="text-xs text-stone-600">
              已選 {chosen.size}/24
            </span>
          </div>
          {selectable.length === 0 ? (
            <p className="mt-3 text-sm text-stone-600">
              此頁沒有可用於此相簿的有效邀請。
            </p>
          ) : (
            <ul className="mt-2 max-h-56 min-w-0 space-y-2 overflow-y-auto">
              {selectable.map((invite) => (
                <li
                  key={invite.id}
                  className="min-w-0 rounded border border-stone-200 p-2"
                >
                  <label className="flex min-w-0 items-start gap-2 text-sm">
                    <input
                      data-testid="version-approvals-owner-invite"
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={chosen.has(invite.id)}
                      disabled={
                        busy ||
                        (!chosen.has(invite.id) && chosen.size >= 24) ||
                        pending ||
                        blocked
                      }
                      onChange={() => toggleInvite(invite)}
                    />
                    <span className="min-w-0 break-words">
                      邀請 {invite.id.slice(0, 8)}…{invite.id.slice(-4)} ·{' '}
                      {invite.accessMode === 'link_only'
                        ? '連結'
                        : invite.accessMode === 'generated_password'
                          ? '密碼'
                          : '自訂密碼'}{' '}
                      ·{' '}
                      {invite.permissions.can_compare_versions
                        ? '可查看舊版本'
                        : '僅能查看目前版本'}{' '}
                      · 到期{' '}
                      {new Intl.DateTimeFormat('zh-TW', {
                        dateStyle: 'medium',
                      }).format(new Date(invite.expiresAt))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {[...chosen.values()].some(
            (invite) => !invite.permissions.can_compare_versions,
          ) && (
            <p role="status" className="mt-3 text-sm text-amber-800">
              部分受邀客戶只能查看目前版本。若照片先更新，這些客戶將無法查看或確認原版本；請先等他們確認，或改選可查看舊版本的邀請。
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={inviteStack.length <= 1 || busy}
              onClick={() => previous(inviteStack, setInviteStack)}
            >
              上一頁邀請
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={inviteStack.length <= 1 || busy}
              onClick={() => previous(inviteStack, setInviteStack, true)}
            >
              第一頁邀請
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!ready.invitePage.nextCursor || busy}
              onClick={() =>
                nextCursor(
                  inviteStack,
                  ready.invitePage.nextCursor,
                  setInviteStack,
                )
              }
            >
              下一頁邀請
            </Button>
          </div>
        </div>
      </div>
      {blocked && (
        <p
          role="alert"
          className="break-words rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          本機重試記錄無法安全讀取；已停用建立與重試，請勿以新請求覆蓋。
        </p>
      )}
      {pending && journal.status === 'pending' && (
        <div className="min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p role="status" className="break-words text-sm">
            建立請求結果尚待核對。重試會使用原 requestId 與完全相同內容。
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={busy}
            onClick={() => void submitOwnerJournal(journal)}
          >
            用原內容重試
          </Button>
          <label className="mt-3 flex min-w-0 items-start gap-2 text-xs text-stone-700">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={clearChecked}
              disabled={busy}
              onChange={(event) => setClearChecked(event.target.checked)}
            />
            <span className="break-words">
              我已先核對伺服器狀態，並了解清除本機記錄不會撤回可能已送達的請求。
            </span>
          </label>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={busy || !clearChecked}
            onClick={clearOwnerJournal}
          >
            清除本機重試記錄
          </Button>
        </div>
      )}
      {!pending && !blocked && (
        <div className="min-w-0 rounded-md border border-stone-200 p-3">
          <label className="flex min-w-0 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={
                confirmedFingerprint === fingerprint && fingerprint !== ''
              }
              disabled={busy || chosen.size < 1 || chosen.size > 24}
              onChange={(event) =>
                setConfirmedFingerprint(event.target.checked ? fingerprint : '')
              }
            />
            <span className="break-words">
              我確認要為
              {ready.headVersionNo === null
                ? '目前版本'
                : '版本 ' + ready.headVersionNo}
              向已選邀請建立固定確認請求。
            </span>
          </label>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={
              busy ||
              chosen.size < 1 ||
              chosen.size > 24 ||
              confirmedFingerprint !== fingerprint ||
              journal.status !== 'none'
            }
            onClick={() => void createOwnerJournal()}
          >
            {busy ? '處理中…' : '建立確認請求'}
          </Button>
        </div>
      )}
      <div className="min-w-0">
        <h4 className="text-sm font-semibold">此照片的確認請求</h4>
        {ready.approvalPage.requests.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">目前沒有確認請求。</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {ready.approvalPage.requests.map(
              (request: OwnerVersionApprovalRead) => (
                <li
                  key={request.id}
                  className="min-w-0 rounded border border-stone-200 p-3 text-sm"
                >
                  <p className="break-words font-medium">
                    版本 {request.versionNo}
                    {request.isCurrent ? ' · 目前版本' : ' · 歷史版本'}
                  </p>
                  <p className="mt-1 break-words text-stone-600">
                    {request.status === 'confirmed'
                      ? '已有受邀訪客完成確認'
                      : '等待任一受邀訪客確認'}{' '}
                    · {request.inviteIds.length} 個固定邀請
                  </p>
                  {request.status === 'confirmed' && (
                    <OwnerApprovedDelivery
                      key={
                        request.id +
                        ':' +
                        ready.identity.actorId +
                        ':' +
                        ready.identity.sessionId
                      }
                      workspaceId={request.workspaceId}
                      projectId={request.projectId}
                      albumId={request.albumId}
                      photoId={request.photoId}
                      approvalId={request.id}
                      versionId={request.versionId}
                      versionNo={request.versionNo}
                      expectedOwnerId={ready.identity.actorId}
                      inviteIds={request.inviteIds}
                      onPendingChange={(pending) =>
                        updateDeliveryPending(request.id, pending)
                      }
                    />
                  )}
                </li>
              ),
            )}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={approvalStack.length <= 1 || busy}
            onClick={() => previous(approvalStack, setApprovalStack)}
          >
            上一頁
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={approvalStack.length <= 1 || busy}
            onClick={() => previous(approvalStack, setApprovalStack, true)}
          >
            第一頁
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!ready.approvalPage.nextCursor || busy}
            onClick={() =>
              nextCursor(
                approvalStack,
                ready.approvalPage.nextCursor,
                setApprovalStack,
              )
            }
          >
            下一頁
          </Button>
        </div>
      </div>
      {notice && (
        <p role="status" className="break-words text-sm text-stone-700">
          {notice}
        </p>
      )}
    </section>
  );
}

async function readGuestAccess(albumId: string, signal?: AbortSignal) {
  const result = await requestJson(
    '/api/guest/albums/' + segment(albumId) + '/access',
    z.object({ access: guestAlbumAccessSchema }).strict(),
    signal ? { signal } : {},
  );
  if (
    result.access.albumId !== albumId ||
    !result.access.permissions.can_view
  ) {
    throw new RequestFailure(403, 'GUEST_PHOTO_NOT_VIEWABLE');
  }
  return result.access;
}
function sameGuestAccess(
  left: Awaited<ReturnType<typeof readGuestAccess>>,
  right: Awaited<ReturnType<typeof readGuestAccess>>,
) {
  return (
    left.guestId === right.guestId &&
    left.inviteId === right.inviteId &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.albumId === right.albumId &&
    left.expiresAt === right.expiresAt &&
    JSON.stringify(left.permissions) === JSON.stringify(right.permissions)
  );
}
function guestIdentityKey(access: Awaited<ReturnType<typeof readGuestAccess>>) {
  return JSON.stringify([
    access.guestId,
    access.inviteId,
    access.workspaceId,
    access.projectId,
    access.albumId,
    access.expiresAt,
  ]);
}

type GuestPanelState =
  | { status: 'loading' | 'disabled'; scopeKey: string; pageKey: string }
  | { status: 'error'; scopeKey: string; pageKey: string; message: string }
  | {
      status: 'ready';
      scopeKey: string;
      pageKey: string;
      access: Awaited<ReturnType<typeof readGuestAccess>>;
      page: z.infer<typeof guestVersionApprovalListSchema>;
      journals: Map<
        string,
        Journal<
          GuestJournal & {
            body: z.infer<typeof guestVersionApprovalConfirmationSchema>;
          }
        >
      >;
    };

async function loadGuestPanel(
  albumId: string,
  photoId: string,
  cursor: string | null,
  signal: AbortSignal,
) {
  const capability = await requestJson(
    '/api/guest/version-approvals/capabilities',
    versionApprovalsCapabilitiesSchema,
    { signal },
  );
  if (!capability.enabled) return { enabled: false as const };
  const access = await readGuestAccess(albumId, signal);
  const page = await requestJson(
    guestPath(albumId, photoId) + query(cursor),
    guestVersionApprovalListSchema,
    { signal },
  );
  const after = await readGuestAccess(albumId, signal);
  if (
    !sameGuestAccess(access, after) ||
    page.requests.some((row) => row.photoId !== photoId) ||
    (cursor !== null && page.nextCursor === cursor)
  ) {
    throw new RequestFailure(null, 'RESPONSE_SCOPE_MISMATCH');
  }
  const journals = new Map<
    string,
    Journal<
      GuestJournal & {
        body: z.infer<typeof guestVersionApprovalConfirmationSchema>;
      }
    >
  >();
  for (const row of page.requests) {
    const key = guestJournalKey(albumId, photoId, access.guestId, row.id);
    journals.set(
      row.id,
      readGuestJournal(key, albumId, photoId, access.guestId, row.id),
    );
  }
  return { enabled: true as const, access, page, journals };
}

export type GuestVersionApprovalsPanelProps = {
  albumId: string;
  photoId: string;
  filename: string;
};

function guestFailureMessage(error: unknown) {
  if (
    error instanceof RequestFailure &&
    [401, 403, 404].includes(error.status ?? 0)
  ) {
    return '此連結目前無法使用，請聯絡攝影師。';
  }
  return failureMessage(error);
}

export function GuestVersionApprovalsPanel({
  albumId,
  photoId,
  filename,
}: GuestVersionApprovalsPanelProps) {
  const validAlbumId = uuid.parse(albumId);
  const validPhotoId = uuid.parse(photoId);
  const scopeKey = JSON.stringify([validAlbumId, validPhotoId]);
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const cursor = cursorStack[cursorStack.length - 1] ?? null;
  const [refreshNo, setRefreshNo] = useState(0);
  const pageKey = JSON.stringify([cursor, refreshNo]);
  const [panel, setPanel] = useState<GuestPanelState>({
    status: 'loading',
    scopeKey: '',
    pageKey: '',
  });
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [viewedIds, setViewedIds] = useState<Set<string>>(new Set());
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(
    new Set(),
  );
  const [failedPreviewIds, setFailedPreviewIds] = useState<Set<string>>(
    new Set(),
  );
  const [clearCheckedId, setClearCheckedId] = useState('');
  const generationRef = useRef(0);
  const activeScopeRef = useRef(scopeKey);
  const lastIdentityRef = useRef('');
  const headingId = useId();
  useEffect(() => {
    activeScopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    void loadGuestPanel(validAlbumId, validPhotoId, cursor, controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          activeScopeRef.current !== scopeKey
        )
          return;
        if (!result.enabled) {
          setViewedIds(new Set());
          setAcknowledgedIds(new Set());
          setPanel({ status: 'disabled', scopeKey, pageKey });
          return;
        }
        const key = guestIdentityKey(result.access);
        if (lastIdentityRef.current && lastIdentityRef.current !== key) {
          setViewedIds(new Set());
          setAcknowledgedIds(new Set());
          setFailedPreviewIds(new Set());
          setNotice('訪客身分或權限已變更，請重新檢查固定版本。');
        }
        lastIdentityRef.current = key;
        setPanel({
          status: 'ready',
          scopeKey,
          pageKey,
          access: result.access,
          page: result.page,
          journals: result.journals,
        });
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          activeScopeRef.current !== scopeKey
        )
          return;
        setViewedIds(new Set());
        setAcknowledgedIds(new Set());
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: guestFailureMessage(error),
        });
      });
    return () => {
      controller.abort();
      generationRef.current += 1;
    };
  }, [validAlbumId, validPhotoId, cursor, pageKey, scopeKey]);

  const current =
    panel.scopeKey === scopeKey && panel.pageKey === pageKey ? panel : null;
  const ready = current?.status === 'ready' ? current : null;

  async function postGuestJournal(
    request: GuestVersionApprovalRequest,
    journal: Journal<
      GuestJournal & {
        body: z.infer<typeof guestVersionApprovalConfirmationSchema>;
      }
    >,
  ) {
    if (!ready || journal.status !== 'pending') return;
    const identityKey = guestIdentityKey(ready.access);
    try {
      const before = await readGuestAccess(validAlbumId);
      if (!sameGuestAccess(ready.access, before))
        throw new RequestFailure(401, 'GUEST_IDENTITY_CHANGED');
      const path =
        guestPath(validAlbumId, validPhotoId) +
        '/' +
        segment(request.id) +
        '/confirm';
      const result = await requestJson(
        path,
        guestVersionApprovalConfirmationResultSchema,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: journal.value.bodyJson,
        },
      );
      const after = await readGuestAccess(validAlbumId);
      if (
        guestIdentityKey(after) !== identityKey ||
        result.requestId !== journal.value.body.requestId ||
        result.approvalRequestId !== request.id ||
        result.guestId !== ready.access.guestId ||
        result.photoId !== request.photoId ||
        result.versionId !== request.versionId ||
        result.versionNo !== request.versionNo ||
        result.headRevision !== request.headRevision
      ) {
        throw new RequestFailure(null, 'RESULT_SCOPE_MISMATCH');
      }
      if (!removeExact(journal.key, journal.raw)) {
        setNotice('伺服器已回覆，但本機重試記錄無法核對；請保留原內容並重試。');
        return;
      }
      setAcknowledgedIds((old) => {
        const next = new Set(old);
        next.delete(request.id);
        return next;
      });
      setClearCheckedId('');
      setNotice(
        result.recorded ? '固定版本的確認已記錄。' : '此固定版本已完成確認。',
      );
      setRefreshNo((value) => value + 1);
    } catch (error) {
      setNotice(guestFailureMessage(error));
      if (shouldHide(error)) {
        setViewedIds(new Set());
        setAcknowledgedIds(new Set());
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: guestFailureMessage(error),
        });
      } else if (error instanceof RequestFailure && error.status === 409) {
        setRefreshNo((value) => value + 1);
      }
    }
  }

  async function retryGuest(
    request: GuestVersionApprovalRequest,
    journal: Journal<
      GuestJournal & {
        body: z.infer<typeof guestVersionApprovalConfirmationSchema>;
      }
    >,
  ) {
    if (busyId || journal.status !== 'pending') return;
    setBusyId(request.id);
    setNotice('');
    try {
      await postGuestJournal(request, journal);
    } finally {
      if (activeScopeRef.current === scopeKey) setBusyId('');
    }
  }

  async function beginConfirmation(request: GuestVersionApprovalRequest) {
    if (!ready || busyId || request.status !== 'open') return;
    const old = ready.journals.get(request.id);
    if (old?.status === 'blocked') {
      setNotice('本機重試記錄無法安全讀取，請勿建立新的操作編號。');
      return;
    }
    if (old?.status === 'pending') {
      await retryGuest(request, old);
      return;
    }
    if (!viewedIds.has(request.id) || !acknowledgedIds.has(request.id)) return;
    setBusyId(request.id);
    setNotice('');
    try {
      const access = await readGuestAccess(validAlbumId);
      if (!sameGuestAccess(ready.access, access))
        throw new RequestFailure(401, 'GUEST_IDENTITY_CHANGED');
      const body = guestVersionApprovalConfirmationSchema.parse({
        requestId: crypto.randomUUID(),
        expectedGuestId: access.guestId,
        confirm: true,
      });
      const entry = guestJournalSchema.parse({
        version: 1,
        guestId: access.guestId,
        albumId: validAlbumId,
        photoId: validPhotoId,
        approvalId: request.id,
        bodyJson: JSON.stringify(body),
      });
      const key = guestJournalKey(
        validAlbumId,
        validPhotoId,
        access.guestId,
        request.id,
      );
      if (persist(key, entry) === null) {
        setNotice('無法安全保存這次固定確認內容，尚未送出任何請求。');
        return;
      }
      const journal = readGuestJournal(
        key,
        validAlbumId,
        validPhotoId,
        access.guestId,
        request.id,
      );
      if (journal.status !== 'pending') {
        setNotice('無法再次核對本機確認內容，尚未送出任何請求。');
        return;
      }
      setPanel((value) =>
        value.status === 'ready' &&
        value.scopeKey === scopeKey &&
        value.pageKey === pageKey
          ? {
              ...value,
              journals: new Map(value.journals).set(request.id, journal),
            }
          : value,
      );
      await postGuestJournal(request, journal);
    } catch (error) {
      setNotice(guestFailureMessage(error));
      if (shouldHide(error)) {
        setViewedIds(new Set());
        setAcknowledgedIds(new Set());
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: guestFailureMessage(error),
        });
      }
    } finally {
      if (activeScopeRef.current === scopeKey) setBusyId('');
    }
  }

  function clearGuestJournal(
    journal: Journal<
      GuestJournal & {
        body: z.infer<typeof guestVersionApprovalConfirmationSchema>;
      }
    >,
    requestId: string,
  ) {
    if (journal.status !== 'pending' || clearCheckedId !== requestId) return;
    if (!removeExact(journal.key, journal.raw)) {
      setNotice('本機記錄已變更，沒有清除；請重新載入。');
      return;
    }
    setPanel((value) => {
      if (
        value.status !== 'ready' ||
        value.scopeKey !== scopeKey ||
        value.pageKey !== pageKey
      )
        return value;
      const journals = new Map(value.journals);
      journals.set(requestId, { status: 'none', key: journal.key });
      return { ...value, journals };
    });
    setClearCheckedId('');
    setNotice('已清除本機重試記錄；這不會撤回可能已送達的確認。');
  }

  if (!current || current.status === 'loading' || current.status === 'disabled')
    return null;
  if (current.status === 'error') {
    return (
      <section
        data-testid="version-approvals-guest"
        className="min-w-0 rounded-lg border border-white/15 bg-stone-900 p-4 text-white"
        aria-labelledby={headingId}
      >
        <h3 id={headingId} className="text-base font-semibold">
          版本確認
        </h3>
        <p role="alert" className="mt-2 break-words text-sm text-amber-200">
          {current.message}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 bg-transparent text-white"
          onClick={() => setRefreshNo((value) => value + 1)}
        >
          重新載入
        </Button>
      </section>
    );
  }
  if (!ready || (ready.page.requests.length === 0 && ready.journals.size === 0))
    return null;
  return (
    <section
      data-testid="version-approvals-guest"
      className="min-w-0 space-y-3 rounded-lg border border-white/15 bg-stone-900 p-4 text-white"
      aria-labelledby={headingId}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-base font-semibold">
            版本確認
          </h3>
          <p className="mt-1 break-words text-sm text-white/70">
            只顯示目前邀請可確認的「{filename}
            」固定版本。請先打開並查看指定版本預覽。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="bg-transparent text-white"
          disabled={Boolean(busyId)}
          onClick={() => setRefreshNo((value) => value + 1)}
        >
          重新載入
        </Button>
      </div>
      {ready.page.requests.length === 0 ? (
        <p className="text-sm text-white/70">目前沒有可確認的版本。</p>
      ) : (
        <ul className="space-y-3">
          {ready.page.requests.map((request) => {
            const journal = ready.journals.get(request.id) ?? {
              status: 'none' as const,
              key: guestJournalKey(
                validAlbumId,
                validPhotoId,
                ready.access.guestId,
                request.id,
              ),
            };
            const pending = journal.status === 'pending';
            const blocked = journal.status === 'blocked';
            const viewed = viewedIds.has(request.id);
            const acknowledged = acknowledgedIds.has(request.id);
            const canStart =
              viewed && acknowledged && request.status === 'open';
            return (
              <li
                key={request.id}
                data-testid="version-approvals-guest-item"
                className="min-w-0 rounded-md border border-white/15 p-3"
              >
                <p className="break-words text-sm font-semibold">
                  版本 {request.versionNo}
                  {request.isCurrent ? ' · 目前版本' : ' · 歷史版本'}
                </p>
                {request.isCurrent ? (
                  <p className="mt-1 text-xs text-white/65">
                    確認只記錄在此版本，不會套用到之後的新版本。
                  </p>
                ) : (
                  <p className="mt-1 break-words text-xs text-amber-200">
                    照片已有更新版本；此項只對應當時的版本 {request.versionNo}。
                  </p>
                )}
                <details className="mt-3 rounded border border-white/10 p-2">
                  <summary className="cursor-pointer text-sm underline underline-offset-2">
                    查看指定版本預覽
                  </summary>
                  <div className="mt-2 min-w-0">
                    {failedPreviewIds.has(request.id) ? (
                      <p role="alert" className="text-sm text-amber-200">
                        目前無法載入這個版本，暫時不能確認。請重新載入或稍後重試。
                      </p>
                    ) : (
                      <TrackedPhotoImage
                        photoId={validPhotoId}
                        versionId={request.versionId}
                        src={guestPreview(validPhotoId, request.versionId)}
                        alt={filename + '，版本 ' + request.versionNo}
                        className="max-h-[45dvh] w-full rounded bg-black/30 object-contain"
                        onLoad={(event) => {
                          if (event.currentTarget.naturalWidth > 0)
                            setViewedIds((old) => new Set(old).add(request.id));
                        }}
                        onError={() => {
                          setViewedIds((old) => {
                            const next = new Set(old);
                            next.delete(request.id);
                            return next;
                          });
                          setAcknowledgedIds((old) => {
                            const next = new Set(old);
                            next.delete(request.id);
                            return next;
                          });
                          setFailedPreviewIds((old) =>
                            new Set(old).add(request.id),
                          );
                        }}
                      />
                    )}
                    {viewed && !failedPreviewIds.has(request.id) && (
                      <label className="mt-2 flex min-w-0 items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0"
                          checked={acknowledged}
                          disabled={
                            busyId === request.id ||
                            blocked ||
                            request.status !== 'open'
                          }
                          onChange={(event) =>
                            setAcknowledgedIds((old) => {
                              const next = new Set(old);
                              if (event.target.checked) next.add(request.id);
                              else next.delete(request.id);
                              return next;
                            })
                          }
                        />
                        <span className="break-words">
                          我已查看指定的第 {request.versionNo} 版。
                        </span>
                      </label>
                    )}
                  </div>
                </details>
                <p className="mt-2 text-sm text-white/80">
                  {request.status === 'confirmed'
                    ? '已有受邀訪客完成確認'
                    : '等待受邀訪客確認'}
                </p>
                {pending && journal.status === 'pending' ? (
                  <div className="mt-3 rounded border border-amber-300/40 bg-amber-300/10 p-3">
                    <p
                      role="status"
                      className="break-words text-sm text-amber-100"
                    >
                      確認結果尚待核對；重試會使用原 requestId 與相同內容。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 bg-transparent text-white"
                      disabled={Boolean(busyId)}
                      onClick={() => void retryGuest(request, journal)}
                    >
                      {busyId === request.id ? '確認中…' : '用原內容重試'}
                    </Button>
                    <label className="mt-3 flex min-w-0 items-start gap-2 text-xs text-white/70">
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={clearCheckedId === request.id}
                        disabled={Boolean(busyId)}
                        onChange={(event) =>
                          setClearCheckedId(
                            event.target.checked ? request.id : '',
                          )
                        }
                      />
                      <span className="break-words">
                        我已先核對確認狀態，並了解清除本機記錄不會撤回可能已送達的確認。
                      </span>
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2 bg-transparent text-white"
                      disabled={
                        Boolean(busyId) || clearCheckedId !== request.id
                      }
                      onClick={() => clearGuestJournal(journal, request.id)}
                    >
                      清除本機重試記錄
                    </Button>
                  </div>
                ) : blocked ? (
                  <p
                    role="alert"
                    className="mt-3 break-words text-sm text-amber-200"
                  >
                    本機重試記錄無法安全讀取；為避免重複操作，暫停此版本確認。
                  </p>
                ) : request.status === 'confirmed' ? (
                  <p className="mt-2 text-xs text-white/60">
                    此請求已完成，不代表目前訪客本人曾提交確認。
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 bg-transparent text-white"
                    disabled={Boolean(busyId) || !canStart || blocked}
                    onClick={() => void beginConfirmation(request)}
                  >
                    {busyId === request.id ? '確認中…' : '確認此固定版本'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="bg-transparent text-white"
          disabled={cursorStack.length <= 1 || Boolean(busyId)}
          onClick={() =>
            setCursorStack((stack) =>
              stack.length > 1 ? stack.slice(0, -1) : stack,
            )
          }
        >
          上一頁
        </Button>
        <Button
          type="button"
          variant="outline"
          className="bg-transparent text-white"
          disabled={cursorStack.length <= 1 || Boolean(busyId)}
          onClick={() => setCursorStack([null])}
        >
          第一頁
        </Button>
        <Button
          type="button"
          variant="outline"
          className="bg-transparent text-white"
          disabled={!ready.page.nextCursor || Boolean(busyId)}
          onClick={() => {
            const next = ready.page.nextCursor;
            if (!next) return;
            if (cursorStack.includes(next)) {
              setNotice('分頁位置無法核對，請重新載入。');
              return;
            }
            setCursorStack((stack) => [...stack.slice(-31), next]);
          }}
        >
          下一頁
        </Button>
      </div>
      {notice && (
        <p role="status" className="break-words text-sm text-amber-100">
          {notice}
        </p>
      )}
    </section>
  );
}
