'use client';

import { Button } from '@kino-pic/ui';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { z } from 'zod';
import {
  deliveryInviteIdsSchema,
  guestDeliveryReadSchema,
  ownerDeliveryManifestSchema,
  ownerDeliveryResultSchema,
  type GuestDeliveryRead,
  type OwnerDeliveryManifest,
} from '../../../packages/contracts/src/deliveries';
import { guestAlbumAccessSchema } from '../../../packages/contracts/src/guest-access';
import { getUploadIdentity, type UploadIdentity } from './upload-client';
import { StudioIcon } from './studio-icons';

const uuid = z.uuid();
const capabilitySchema = z.object({ enabled: z.boolean() }).strict();
const ownerDeliveryPageSchema = z
  .object({
    deliveries: z.array(ownerDeliveryManifestSchema).max(24),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
const guestDeliveryPageSchema = z
  .object({
    deliveries: z.array(guestDeliveryReadSchema).max(24),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
const publishBodySchema = z
  .object({
    requestId: z.uuid(),
    expectedOwnerId: z.uuid(),
    inviteIds: deliveryInviteIdsSchema,
    confirm: z.literal(true),
  })
  .strict();
const revokeBodySchema = z
  .object({
    requestId: z.uuid(),
    expectedOwnerId: z.uuid(),
    confirm: z.literal(true),
  })
  .strict();
const revokeResultSchema = z.object({ revoked: z.literal(true) }).strict();
const errorEnvelope = z.object({ error: z.object({ code: z.string() }) });
const ownerJournalSchema = z.discriminatedUnion('action', [
  z
    .object({
      version: z.literal(1),
      action: z.literal('publish'),
      actorId: z.uuid(),
      sessionId: z.string().min(1).max(512),
      albumId: z.uuid(),
      photoId: z.uuid(),
      approvalId: z.uuid(),
      versionId: z.uuid(),
      versionNo: z.number().int().positive().safe(),
      targetDeliveryId: z.null(),
      bodyJson: z.string().min(1).max(16_384),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      action: z.literal('revoke'),
      actorId: z.uuid(),
      sessionId: z.string().min(1).max(512),
      albumId: z.uuid(),
      photoId: z.uuid(),
      approvalId: z.uuid(),
      versionId: z.uuid(),
      versionNo: z.number().int().positive().safe(),
      targetDeliveryId: z.uuid(),
      bodyJson: z.string().min(1).max(16_384),
    })
    .strict(),
]);

type OwnerScope = {
  workspaceId: string;
  projectId: string;
  albumId: string;
  photoId: string;
  approvalId: string;
  versionId: string;
  versionNo: number;
  expectedOwnerId: string;
  inviteIds: string[];
};
type OwnerAction =
  | {
      kind: 'publish';
      body: z.infer<typeof publishBodySchema>;
    }
  | {
      kind: 'revoke';
      deliveryId: string;
      body: z.infer<typeof revokeBodySchema>;
    };
type OwnerJournalValue = {
  actorId: string;
  sessionId: string;
  action: OwnerAction;
};
type Journal<T> =
  | { status: 'none'; key: string }
  | { status: 'pending'; key: string; raw: string; value: T }
  | { status: 'blocked'; key: string };

class RequestFailure extends Error {
  constructor(
    readonly status: number | null,
    readonly code = '',
  ) {
    super(code || 'DELIVERY_REQUEST_FAILED');
  }
}

class OwnerPanelLoadFailure extends Error {
  constructor(
    readonly loadError: unknown,
    readonly journal: Journal<OwnerJournalValue>,
  ) {
    super('OWNER_DELIVERY_PANEL_LOAD_FAILED');
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
  return encodeURIComponent(uuid.parse(value).toLowerCase());
}

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function persist(key: string, value: object) {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    const raw = JSON.stringify(value);
    storage.setItem(key, raw);
    return storage.getItem(key) === raw ? raw : null;
  } catch {
    return null;
  }
}

function removeExact(key: string, raw: string) {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    if (storage.getItem(key) !== raw) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function ownerIdentityKey(identity: UploadIdentity) {
  return JSON.stringify([identity.actorId, identity.sessionId]);
}

function ownerJournalKey(scope: OwnerScope, identity: UploadIdentity) {
  return (
    'kino-pic:approved-deliveries:owner:v1:' +
    [
      scope.albumId,
      scope.photoId,
      scope.approvalId,
      scope.versionId,
      identity.actorId,
      identity.sessionId,
    ]
      .map(encodeURIComponent)
      .join(':')
  );
}

function readOwnerJournal(
  key: string,
  scope: OwnerScope,
  identity: UploadIdentity,
): Journal<OwnerJournalValue> {
  const storage = browserStorage();
  if (!storage) return { status: 'blocked', key };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { status: 'none', key };
    const parsed = ownerJournalSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { status: 'blocked', key };
    const entry = parsed.data;
    const scopeMatches =
      entry.actorId === identity.actorId &&
      entry.sessionId === identity.sessionId &&
      entry.albumId === scope.albumId &&
      entry.photoId === scope.photoId &&
      entry.approvalId === scope.approvalId &&
      entry.versionId === scope.versionId &&
      entry.versionNo === scope.versionNo;
    if (!scopeMatches) return { status: 'blocked', key };

    if (entry.action === 'publish') {
      const result = publishBodySchema.safeParse(JSON.parse(entry.bodyJson));
      if (
        !result.success ||
        JSON.stringify(result.data) !== entry.bodyJson ||
        result.data.expectedOwnerId !== identity.actorId ||
        result.data.inviteIds.some((id) => !scope.inviteIds.includes(id))
      ) {
        return { status: 'blocked', key };
      }
      return {
        status: 'pending',
        key,
        raw,
        value: {
          actorId: entry.actorId,
          sessionId: entry.sessionId,
          action: { kind: 'publish', body: result.data },
        },
      };
    }

    const result = revokeBodySchema.safeParse(JSON.parse(entry.bodyJson));
    if (
      !result.success ||
      JSON.stringify(result.data) !== entry.bodyJson ||
      result.data.expectedOwnerId !== identity.actorId
    ) {
      return { status: 'blocked', key };
    }
    return {
      status: 'pending',
      key,
      raw,
      value: {
        actorId: entry.actorId,
        sessionId: entry.sessionId,
        action: {
          kind: 'revoke',
          deliveryId: entry.targetDeliveryId,
          body: result.data,
        },
      },
    };
  } catch {
    return { status: 'blocked', key };
  }
}

function guestDownloadHref(
  albumId: string,
  deliveryId: string,
  assetId: string,
  requestId: string,
) {
  return (
    '/api/guest/albums/' +
    segment(albumId) +
    '/deliveries/' +
    segment(deliveryId) +
    '/assets/' +
    segment(assetId) +
    '/download?requestId=' +
    encodeURIComponent(uuid.parse(requestId))
  );
}

function sameGuestAccess(
  left: z.infer<typeof guestAlbumAccessSchema>,
  right: z.infer<typeof guestAlbumAccessSchema>,
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

function failureMessage(error: unknown) {
  if (error instanceof RequestFailure) {
    if ([401, 403, 404].includes(error.status ?? 0))
      return '登入身分或相簿權限已變更；私有交付內容已隱藏。';
    if (error.status === 409)
      return '交付或指定邀請狀態已變更。原 requestId 與原內容已保留，可用相同內容重試。';
    if (error.status === 503) return '交付服務暫時無法使用，請稍後重試。';
    if (error.status === null)
      return '伺服器回傳的交付資料無法核對；原操作已保留。';
  }
  return '目前無法核對交付操作結果。原操作已保留，可用相同內容重試。';
}

function shouldHide(error: unknown) {
  return (
    error instanceof RequestFailure &&
    [401, 403, 404].includes(error.status ?? 0)
  );
}

function sameIds(left: readonly string[], right: readonly string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function mergeOwnerDeliveries(
  current: OwnerDeliveryManifest[],
  incoming: OwnerDeliveryManifest[],
) {
  const merged = new Map(current.map((delivery) => [delivery.id, delivery]));
  for (const delivery of incoming) merged.set(delivery.id, delivery);
  return [...merged.values()];
}

function mergeGuestDeliveries(
  current: GuestDeliveryRead[],
  incoming: GuestDeliveryRead[],
) {
  const merged = new Map(
    current.map((read) => [read.delivery.id, read] as const),
  );
  for (const read of incoming) merged.set(read.delivery.id, read);
  return [...merged.values()];
}

function ownerDeliveryListPath(scope: OwnerScope, cursor: string | null) {
  const query = new URLSearchParams({ approvalId: scope.approvalId });
  if (cursor) query.set('cursor', cursor);
  return (
    '/api/v1/albums/' +
    segment(scope.albumId) +
    '/photos/' +
    segment(scope.photoId) +
    '/deliveries?' +
    query.toString()
  );
}

function guestDeliveryListPath(albumId: string, cursor: string | null) {
  return (
    '/api/guest/albums/' +
    segment(albumId) +
    '/deliveries' +
    (cursor ? '?cursor=' + segment(cursor) : '')
  );
}

function validateOwnerDeliveryPage(
  page: z.infer<typeof ownerDeliveryPageSchema>,
  scope: OwnerScope,
  cursor: string | null,
) {
  if (
    (cursor !== null && page.nextCursor === cursor) ||
    page.deliveries.some((delivery) => {
      const item = delivery.items[0];
      return (
        delivery.workspaceId !== scope.workspaceId ||
        delivery.projectId !== scope.projectId ||
        delivery.albumId !== scope.albumId ||
        delivery.inviteIds.some(
          (inviteId) => !scope.inviteIds.includes(inviteId),
        ) ||
        delivery.items.length !== 1 ||
        item?.photoId !== scope.photoId ||
        item?.versionId !== scope.versionId ||
        item?.versionNo !== scope.versionNo ||
        item?.approval?.requestId !== scope.approvalId
      );
    })
  ) {
    throw new RequestFailure(null, 'RESPONSE_SCOPE_MISMATCH');
  }
}

async function readOwnerDeliveryPage(
  scope: OwnerScope,
  identity: UploadIdentity,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const page = await requestJson(
    ownerDeliveryListPath(scope, cursor),
    ownerDeliveryPageSchema,
    signal ? { signal } : {},
  );
  const after = await getUploadIdentity(signal);
  if (ownerIdentityKey(identity) !== ownerIdentityKey(after))
    throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
  validateOwnerDeliveryPage(page, scope, cursor);
  return page;
}

async function loadOwnerPanel(
  scope: OwnerScope,
  signal: AbortSignal,
  cursor: string | null = null,
) {
  let journal: Journal<OwnerJournalValue> = { status: 'none', key: '' };
  try {
    const identity = await getUploadIdentity(signal);
    journal = readOwnerJournal(
      ownerJournalKey(scope, identity),
      scope,
      identity,
    );
    if (identity.actorId !== scope.expectedOwnerId)
      throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
    const capability = await requestJson(
      '/api/v1/deliveries/capabilities',
      capabilitySchema,
      { signal },
    );
    if (!capability.enabled)
      return { enabled: false as const, identity, journal };
    const page = await readOwnerDeliveryPage(scope, identity, cursor, signal);
    return {
      enabled: true as const,
      identity,
      journal,
      deliveries: page.deliveries,
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    throw new OwnerPanelLoadFailure(error, journal);
  }
}

type OwnerPanelState =
  | {
      status: 'loading' | 'disabled';
      scopeKey: string;
      pageKey: string;
      journal?: Journal<OwnerJournalValue>;
    }
  | {
      status: 'error';
      scopeKey: string;
      pageKey: string;
      message: string;
      journal: Journal<OwnerJournalValue>;
    }
  | {
      status: 'ready';
      scopeKey: string;
      pageKey: string;
      identity: UploadIdentity;
      journal: Journal<OwnerJournalValue>;
      deliveries: OwnerDeliveryManifest[];
      nextCursor: string | null;
    };

export type OwnerApprovedDeliveryProps = OwnerScope & {
  onPendingChange?: (pending: boolean) => void;
};

export function OwnerApprovedDelivery({
  workspaceId,
  projectId,
  albumId,
  photoId,
  approvalId,
  versionId,
  versionNo,
  expectedOwnerId,
  inviteIds,
  onPendingChange,
}: OwnerApprovedDeliveryProps) {
  const scope = useMemo<OwnerScope>(
    () => ({
      workspaceId: uuid.parse(workspaceId).toLowerCase(),
      projectId: uuid.parse(projectId).toLowerCase(),
      albumId: uuid.parse(albumId).toLowerCase(),
      photoId: uuid.parse(photoId).toLowerCase(),
      approvalId: uuid.parse(approvalId).toLowerCase(),
      versionId: uuid.parse(versionId).toLowerCase(),
      versionNo,
      expectedOwnerId: uuid.parse(expectedOwnerId).toLowerCase(),
      inviteIds: deliveryInviteIdsSchema.parse(inviteIds),
    }),
    [
      workspaceId,
      projectId,
      albumId,
      photoId,
      approvalId,
      versionId,
      versionNo,
      expectedOwnerId,
      inviteIds,
    ],
  );
  const scopeKey = JSON.stringify([
    scope.workspaceId,
    scope.projectId,
    scope.albumId,
    scope.photoId,
    scope.approvalId,
    scope.versionId,
    scope.versionNo,
    scope.expectedOwnerId,
    scope.inviteIds,
  ]);
  const [refreshNo, setRefreshNo] = useState(0);
  const pageKey = String(refreshNo);
  const [panel, setPanel] = useState<OwnerPanelState>({
    status: 'loading',
    scopeKey: '',
    pageKey: '',
  });
  const [selectedInvites, setSelectedInvites] = useState<{
    scopeKey: string;
    ids: Set<string>;
  }>({ scopeKey: '', ids: new Set(scope.inviteIds) });
  const [confirmed, setConfirmed] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [confirmRevokeId, setConfirmRevokeId] = useState('');
  const generationRef = useRef(0);
  const activeScopeRef = useRef(scopeKey);
  const headingId = useId();
  const pendingCallbackRef = useRef(onPendingChange);

  useEffect(() => {
    pendingCallbackRef.current = onPendingChange;
  }, [onPendingChange]);

  useEffect(() => {
    activeScopeRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    void loadOwnerPanel(scope, controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          activeScopeRef.current !== scopeKey
        )
          return;
        if (result.journal.status === 'pending') {
          setSelectedInvites({
            scopeKey,
            ids:
              result.journal.value.action.kind === 'publish'
                ? new Set(result.journal.value.action.body.inviteIds)
                : new Set(scope.inviteIds),
          });
        } else {
          setSelectedInvites({ scopeKey, ids: new Set(scope.inviteIds) });
        }
        setPanel(
          result.enabled
            ? {
                status: 'ready',
                scopeKey,
                pageKey,
                identity: result.identity,
                journal: result.journal,
                deliveries: result.deliveries,
                nextCursor: result.nextCursor,
              }
            : {
                status: 'disabled',
                scopeKey,
                pageKey,
                journal: result.journal,
              },
        );
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          generationRef.current !== generation ||
          activeScopeRef.current !== scopeKey
        )
          return;
        const failure = error instanceof OwnerPanelLoadFailure ? error : null;
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: shouldHide(failure?.loadError)
            ? failureMessage(failure?.loadError)
            : '目前無法載入交付狀態，請重新載入。',
          journal: failure?.journal ?? { status: 'none', key: '' },
        });
      });
    return () => {
      controller.abort();
      generationRef.current += 1;
    };
  }, [scope, scopeKey, pageKey]);

  const current =
    panel.scopeKey === scopeKey && panel.pageKey === pageKey ? panel : null;
  const ready = current?.status === 'ready' ? current : null;
  const journal =
    current?.journal ??
    (panel.scopeKey === scopeKey ? panel.journal : undefined);
  const journalBusy =
    journal?.status === 'pending' || journal?.status === 'blocked';
  const mutationPending = busy || journalBusy;

  useLayoutEffect(() => {
    pendingCallbackRef.current?.(mutationPending);
    return () => pendingCallbackRef.current?.(false);
  }, [mutationPending]);

  const selected =
    selectedInvites.scopeKey === scopeKey
      ? selectedInvites.ids
      : new Set(scope.inviteIds);
  const fingerprint = ready
    ? JSON.stringify([
        ownerIdentityKey(ready.identity),
        scope.approvalId,
        scope.versionId,
        scope.versionNo,
        [...selected].sort(),
      ])
    : '';
  const approvalDeliveries = ready
    ? ready.deliveries.filter(
        (delivery) =>
          delivery.items[0]?.approval?.requestId === scope.approvalId,
      )
    : [];

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

  async function loadMoreDeliveries() {
    if (
      !ready ||
      !ready.nextCursor ||
      loadingMore ||
      busyRef.current ||
      ready.journal.status !== 'none'
    )
      return;
    setLoadingMore(true);
    setNotice('');
    try {
      const before = await getUploadIdentity();
      if (ownerIdentityKey(before) !== ownerIdentityKey(ready.identity))
        throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
      const page = await readOwnerDeliveryPage(scope, before, ready.nextCursor);
      if (activeScopeRef.current !== scopeKey) return;
      updateReady((value) => ({
        ...value,
        deliveries: mergeOwnerDeliveries(value.deliveries, page.deliveries),
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (shouldHide(error)) {
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: failureMessage(error),
          journal: ready.journal,
        });
      } else {
        setNotice('無法載入更多交付紀錄；目前清單已保留。');
      }
    } finally {
      if (activeScopeRef.current === scopeKey) setLoadingMore(false);
    }
  }

  function setBusyState(value: boolean) {
    busyRef.current = value;
    setBusy(value);
  }

  async function clearRejectedJournal(
    currentJournal: Extract<Journal<OwnerJournalValue>, { status: 'pending' }>,
    reason: 'recipients' | 'already_revoked',
  ) {
    if (
      (reason === 'recipients' &&
        currentJournal.value.action.kind !== 'publish') ||
      (reason === 'already_revoked' &&
        currentJournal.value.action.kind !== 'revoke')
    )
      return false;
    const before = await getUploadIdentity();
    if (
      before.actorId !== currentJournal.value.actorId ||
      before.sessionId !== currentJournal.value.sessionId
    )
      return false;
    const page = await readOwnerDeliveryPage(scope, before, null);
    if (
      activeScopeRef.current !== scopeKey ||
      !removeExact(currentJournal.key, currentJournal.raw)
    )
      return false;
    updateReady((value) => ({
      ...value,
      journal: { status: 'none', key: currentJournal.key },
      deliveries: page.deliveries,
      nextCursor: page.nextCursor,
    }));
    setConfirmed('');
    setConfirmRevokeId('');
    setNotice(
      reason === 'recipients'
        ? '指定邀請已失效或不適用；原請求未成立，請取消無效邀請後重新確認。'
        : '此交付已由其他操作撤回，原操作已完成核對。',
    );
    return true;
  }

  async function submitJournal(
    currentJournal: Journal<OwnerJournalValue>,
    alreadyBusy = false,
  ) {
    if (
      currentJournal.status !== 'pending' ||
      (!alreadyBusy && busyRef.current) ||
      activeScopeRef.current !== scopeKey
    )
      return;
    if (!alreadyBusy) setBusyState(true);
    setNotice('');
    let completedMessage = '';
    try {
      const before = await getUploadIdentity();
      if (
        before.actorId !== currentJournal.value.actorId ||
        before.sessionId !== currentJournal.value.sessionId
      ) {
        throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
      }
      if (currentJournal.value.action.kind === 'publish') {
        const { body } = currentJournal.value.action;
        const result = await requestJson(
          '/api/v1/albums/' +
            segment(scope.albumId) +
            '/photos/' +
            segment(scope.photoId) +
            '/version-approvals/' +
            segment(scope.approvalId) +
            '/delivery',
          ownerDeliveryResultSchema,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        const delivery = result.delivery;
        const item = delivery.items[0];
        if (
          result.requestId !== body.requestId ||
          delivery.createdBy !== before.actorId ||
          delivery.albumId !== scope.albumId ||
          delivery.projectId !== scope.projectId ||
          delivery.workspaceId !== scope.workspaceId ||
          !sameIds(delivery.inviteIds, body.inviteIds) ||
          delivery.items.length !== 1 ||
          !item ||
          item.photoId !== scope.photoId ||
          item.versionId !== scope.versionId ||
          item.versionNo !== scope.versionNo ||
          item.approval?.requestId !== scope.approvalId
        ) {
          throw new RequestFailure(null, 'RESULT_SCOPE_MISMATCH');
        }
        completedMessage =
          delivery.status === 'published'
            ? '已交付固定確認版本。'
            : delivery.status === 'revoked'
              ? '此交付請求已完成，但交付目前已撤銷。'
              : '此交付請求已完成，但交付目前已到期。';
      } else {
        const { deliveryId, body } = currentJournal.value.action;
        const result = await requestJson(
          '/api/v1/albums/' +
            segment(scope.albumId) +
            '/deliveries/' +
            segment(deliveryId) +
            '/revoke',
          revokeResultSchema,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        if (!result.revoked) throw new RequestFailure(null, 'RESULT_INVALID');
        completedMessage = '已撤銷此成品交付。';
      }
      const after = await getUploadIdentity();
      if (ownerIdentityKey(before) !== ownerIdentityKey(after))
        throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
      if (!removeExact(currentJournal.key, currentJournal.raw)) {
        setNotice(
          '伺服器已回覆，但本機重試記錄無法核對；請保留原操作並重新載入。',
        );
        return;
      }
      updateReady((value) => ({
        ...value,
        journal: { status: 'none', key: currentJournal.key },
      }));
      setConfirmed('');
      setConfirmRevokeId('');
      setNotice(completedMessage);
      setRefreshNo((value) => value + 1);
    } catch (error) {
      if (
        error instanceof RequestFailure &&
        error.status === 409 &&
        error.code === 'INVALID_DELIVERY_RECIPIENTS' &&
        currentJournal.value.action.kind === 'publish'
      ) {
        try {
          if (await clearRejectedJournal(currentJournal, 'recipients')) return;
        } catch {
          // Keep the original journal if current identity or deliveries cannot be reconciled.
        }
        setNotice(
          '指定邀請已失效或不適用；目前無法核對交付紀錄，原操作已保留。',
        );
        return;
      }
      if (
        error instanceof RequestFailure &&
        error.status === 409 &&
        error.code === 'ALREADY_REVOKED' &&
        currentJournal.value.action.kind === 'revoke'
      ) {
        try {
          if (await clearRejectedJournal(currentJournal, 'already_revoked'))
            return;
        } catch {
          /* Preserve the intent unless current identity can be reconciled. */
        }
        setNotice('此交付已撤回；目前無法核對狀態，原操作已保留。');
        return;
      }
      setNotice(failureMessage(error));
      if (shouldHide(error)) {
        setPanel({
          status: 'error',
          scopeKey,
          pageKey,
          message: failureMessage(error),
          journal: currentJournal,
        });
      } else if (error instanceof RequestFailure && error.status === 409) {
        setRefreshNo((value) => value + 1);
      }
    } finally {
      if (activeScopeRef.current === scopeKey) setBusyState(false);
    }
  }

  async function saveJournal(action: OwnerAction) {
    if (!ready || busyRef.current || ready.journal.status !== 'none') return;
    setBusyState(true);
    setNotice('');
    try {
      const before = await getUploadIdentity();
      if (ownerIdentityKey(before) !== ownerIdentityKey(ready.identity))
        throw new RequestFailure(403, 'OWNER_IDENTITY_CHANGED');
      const bodyJson = JSON.stringify(action.body);
      const entry = ownerJournalSchema.parse({
        version: 1,
        action: action.kind,
        actorId: before.actorId,
        sessionId: before.sessionId,
        albumId: scope.albumId,
        photoId: scope.photoId,
        approvalId: scope.approvalId,
        versionId: scope.versionId,
        versionNo: scope.versionNo,
        targetDeliveryId: action.kind === 'revoke' ? action.deliveryId : null,
        bodyJson,
      });
      const key = ownerJournalKey(scope, before);
      if (persist(key, entry) === null) {
        setNotice('無法安全保存這次交付內容，尚未送出任何請求。');
        return;
      }
      const saved = readOwnerJournal(key, scope, before);
      if (saved.status !== 'pending') {
        setNotice('無法再次核對本機交付內容，尚未送出任何請求。');
        return;
      }
      updateReady((value) => ({ ...value, journal: saved }));
      setConfirmed('');
      setConfirmRevokeId('');
      await submitJournal(saved, true);
    } catch (error) {
      setNotice(failureMessage(error));
    } finally {
      if (activeScopeRef.current === scopeKey) setBusyState(false);
    }
  }

  function toggleInvite(inviteId: string) {
    if (!ready || ready.journal.status !== 'none' || busyRef.current) return;
    const next = new Set(selected);
    if (next.has(inviteId)) next.delete(inviteId);
    else next.add(inviteId);
    setSelectedInvites({ scopeKey, ids: next });
    setConfirmed('');
    setNotice('');
  }

  async function createDelivery() {
    if (
      !ready ||
      ready.journal.status !== 'none' ||
      busyRef.current ||
      selected.size < 1 ||
      confirmed !== fingerprint ||
      !fingerprint
    )
      return;
    await saveJournal({
      kind: 'publish',
      body: publishBodySchema.parse({
        requestId: crypto.randomUUID(),
        expectedOwnerId: ready.identity.actorId,
        inviteIds: [...selected].sort(),
        confirm: true,
      }),
    });
  }

  async function revokeDelivery(deliveryId: string) {
    if (!ready || ready.journal.status !== 'none' || busyRef.current) return;
    await saveJournal({
      kind: 'revoke',
      deliveryId,
      body: revokeBodySchema.parse({
        requestId: crypto.randomUUID(),
        expectedOwnerId: ready.identity.actorId,
        confirm: true,
      }),
    });
  }

  if (!current || current.status === 'loading') {
    return (
      <div
        className="mt-3 rounded border border-stone-200 p-3 text-sm text-stone-600"
        role="status"
      >
        載入成品交付狀態…
      </div>
    );
  }
  if (current.status === 'disabled') {
    if (!current.journal || current.journal.status === 'none') return null;
    return (
      <p
        className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        role="status"
      >
        成品交付功能目前暫停；仍有一筆未核對操作，原內容已保留。此功能停用期間不提供重試。
      </p>
    );
  }
  if (current.status === 'error') {
    return (
      <div className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p role="alert">{current.message}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          onClick={() => setRefreshNo((value) => value + 1)}
        >
          重新載入交付狀態
        </Button>
      </div>
    );
  }
  if (!ready) return null;

  const pending = ready.journal.status === 'pending';
  const blocked = ready.journal.status === 'blocked';
  const canPublish =
    !pending && !blocked && !busy && selected.size > 0 && selected.size <= 24;

  return (
    <section
      data-testid="approved-delivery-owner"
      className="mt-3 min-w-0 space-y-3 rounded-md border border-stone-200 bg-stone-50 p-3"
      aria-labelledby={headingId}
    >
      <div>
        <h4 id={headingId} className="text-sm font-semibold">
          已確認版本交付
        </h4>
        <p className="mt-1 break-words text-xs text-stone-600">
          僅交付已核准的版本 {scope.versionNo}；之後換版本不會改變交付檔案。
        </p>
      </div>
      {blocked && (
        <p
          className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"
          role="alert"
        >
          本機重試記錄無法安全讀取；已停用新交付與撤銷操作，請勿用新請求覆蓋。
        </p>
      )}
      {pending && ready.journal.status === 'pending' && (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
          <p role="status">
            上次操作還在確認中。重試會繼續同一次操作，不會重複建立。
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={busy}
            onClick={() => void submitJournal(ready.journal)}
          >
            用原內容重試
          </Button>
        </div>
      )}
      {approvalDeliveries.length > 0 && (
        <ul className="space-y-2">
          {approvalDeliveries.map((delivery) => {
            const item = delivery.items[0];
            if (!item) return null;
            return (
              <li
                key={delivery.id}
                className="rounded border border-stone-200 bg-white p-2 text-sm"
              >
                <p className="break-words font-medium">{item.asset.filename}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-stone-600">
                  <StudioIcon
                    name="check"
                    aria-hidden="true"
                    width={14}
                    height={14}
                  />
                  固定版本 {item.versionNo} · {delivery.inviteIds.length}{' '}
                  個受邀客戶 ·{' '}
                  {delivery.status === 'published'
                    ? '已交付'
                    : delivery.status === 'revoked'
                      ? '已撤銷'
                      : '已到期'}
                </p>
                {delivery.status === 'published' &&
                  !pending &&
                  !blocked &&
                  (confirmRevokeId === delivery.id ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-amber-900">
                        撤銷後，仍有效的受邀客戶也不能再下載此固定檔案。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void revokeDelivery(delivery.id)}
                        >
                          確認撤銷
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setConfirmRevokeId('')}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2"
                      disabled={busy}
                      onClick={() => setConfirmRevokeId(delivery.id)}
                    >
                      撤銷交付
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {ready.nextCursor && (
        <Button
          type="button"
          variant="outline"
          disabled={loadingMore || busy || pending || blocked}
          onClick={() => void loadMoreDeliveries()}
        >
          {loadingMore ? '載入中…' : '載入更多交付紀錄'}
        </Button>
      )}
      {approvalDeliveries.some(
        (delivery) => delivery.status === 'published',
      ) ? (
        <p className="text-xs text-stone-600">此確認版本已有成品交付。</p>
      ) : (
        !pending &&
        !blocked && (
          <div className="space-y-2 rounded border border-stone-200 bg-white p-2">
            <p className="text-xs font-medium">選擇本次可取得交付檔案的邀請</p>
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {scope.inviteIds.map((inviteId) => (
                <li key={inviteId}>
                  <label className="flex min-w-0 items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={selected.has(inviteId)}
                      disabled={busy}
                      onChange={() => toggleInvite(inviteId)}
                    />
                    <span className="break-all">
                      INV-{inviteId.slice(0, 8).toUpperCase()}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <label className="flex min-w-0 items-start gap-2 text-xs text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={confirmed === fingerprint && fingerprint !== ''}
                disabled={!canPublish}
                onChange={(event) =>
                  setConfirmed(event.target.checked ? fingerprint : '')
                }
              />
              <span className="break-words">
                將此已確認版本交付給本次指定客戶，之後換版本不會改變交付檔案。
              </span>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={
                !canPublish ||
                confirmed !== fingerprint ||
                ready.journal.status !== 'none'
              }
              onClick={() => void createDelivery()}
            >
              {busy ? '處理中…' : '交付已確認版本'}
            </Button>
          </div>
        )
      )}
      {notice && (
        <p className="break-words text-xs text-stone-700" role="status">
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
  if (result.access.albumId !== albumId)
    throw new RequestFailure(null, 'RESPONSE_SCOPE_MISMATCH');
  return result.access;
}

async function loadGuestPanel(albumId: string, signal: AbortSignal) {
  const capability = await requestJson(
    '/api/guest/deliveries/capabilities',
    capabilitySchema,
    { signal },
  );
  if (!capability.enabled) return { enabled: false as const };
  const access = await readGuestAccess(albumId, signal);
  if (!access.permissions.can_view && !access.permissions.can_download_original)
    return { enabled: false as const };
  const page = await requestJson(
    guestDeliveryListPath(albumId, null),
    guestDeliveryPageSchema,
    { signal },
  );
  const after = await readGuestAccess(albumId, signal);
  if (!sameGuestAccess(access, after))
    throw new RequestFailure(401, 'GUEST_IDENTITY_CHANGED');
  validateGuestDeliveryPage(page, albumId, access, null);
  return {
    enabled: true as const,
    access,
    deliveries: page.deliveries,
    nextCursor: page.nextCursor,
  };
}

function validateGuestDeliveryPage(
  page: z.infer<typeof guestDeliveryPageSchema>,
  albumId: string,
  access: z.infer<typeof guestAlbumAccessSchema>,
  cursor: string | null,
) {
  if (
    (cursor !== null && page.nextCursor === cursor) ||
    page.deliveries.some(
      (read) =>
        read.delivery.albumId !== albumId ||
        read.delivery.status !== 'published' ||
        read.access.inviteId !== access.inviteId ||
        (!read.access.permissions.can_view_delivery &&
          !read.access.permissions.can_download_delivery),
    )
  ) {
    throw new RequestFailure(null, 'RESPONSE_SCOPE_MISMATCH');
  }
}

async function readGuestDeliveryPage(
  albumId: string,
  expectedAccess: z.infer<typeof guestAlbumAccessSchema>,
  cursor: string,
  signal?: AbortSignal,
) {
  const before = await readGuestAccess(albumId, signal);
  if (!sameGuestAccess(expectedAccess, before))
    throw new RequestFailure(401, 'GUEST_IDENTITY_CHANGED');
  const page = await requestJson(
    guestDeliveryListPath(albumId, cursor),
    guestDeliveryPageSchema,
    signal ? { signal } : {},
  );
  const after = await readGuestAccess(albumId, signal);
  if (!sameGuestAccess(expectedAccess, after))
    throw new RequestFailure(401, 'GUEST_IDENTITY_CHANGED');
  validateGuestDeliveryPage(page, albumId, after, cursor);
  return page;
}

type GuestPanelState =
  | { status: 'loading' | 'disabled'; albumId: string; pageKey: number }
  | { status: 'error'; albumId: string; pageKey: number; message: string }
  | {
      status: 'ready';
      albumId: string;
      pageKey: number;
      access: z.infer<typeof guestAlbumAccessSchema>;
      deliveries: GuestDeliveryRead[];
      nextCursor: string | null;
    };

export function GuestDeliveryPanel({ albumId }: { albumId: string }) {
  const validAlbumId = uuid.parse(albumId).toLowerCase();
  const [refreshNo, setRefreshNo] = useState(0);
  const [panel, setPanel] = useState<GuestPanelState>({
    status: 'loading',
    albumId: '',
    pageKey: -1,
  });
  const [downloadRequestIds, setDownloadRequestIds] = useState<
    Map<string, string>
  >(() => new Map());
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const generationRef = useRef(0);
  const headingId = useId();

  useEffect(() => {
    const generation = ++generationRef.current;
    const controller = new AbortController();
    void loadGuestPanel(validAlbumId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || generationRef.current !== generation)
          return;
        if (!result.enabled) {
          setPanel({
            status: 'disabled',
            albumId: validAlbumId,
            pageKey: refreshNo,
          });
          return;
        }
        setDownloadRequestIds(
          new Map(
            result.deliveries.flatMap((read) =>
              read.delivery.items.map(
                (item) =>
                  [
                    read.delivery.id + ':' + item.asset.id,
                    crypto.randomUUID(),
                  ] as const,
              ),
            ),
          ),
        );
        setPanel({
          status: 'ready',
          albumId: validAlbumId,
          pageKey: refreshNo,
          access: result.access,
          deliveries: result.deliveries,
          nextCursor: result.nextCursor,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || generationRef.current !== generation)
          return;
        setDownloadRequestIds(new Map());
        setPanel(
          shouldHide(error)
            ? { status: 'disabled', albumId: validAlbumId, pageKey: refreshNo }
            : {
                status: 'error',
                albumId: validAlbumId,
                pageKey: refreshNo,
                message: '目前無法載入成品交付，請稍後重試。',
              },
        );
      });
    return () => {
      controller.abort();
      generationRef.current += 1;
    };
  }, [validAlbumId, refreshNo]);

  const current =
    panel.albumId === validAlbumId && panel.pageKey === refreshNo
      ? panel
      : null;
  const ready = current?.status === 'ready' ? current : null;

  async function loadMoreDeliveries() {
    if (!ready || !ready.nextCursor || loadingMore) return;
    const generation = generationRef.current;
    setLoadingMore(true);
    setMoreError('');
    try {
      const page = await readGuestDeliveryPage(
        validAlbumId,
        ready.access,
        ready.nextCursor,
      );
      if (generation !== generationRef.current) return;
      setDownloadRequestIds((old) => {
        const next = new Map(old);
        for (const read of page.deliveries) {
          for (const item of read.delivery.items) {
            next.set(
              read.delivery.id + ':' + item.asset.id,
              crypto.randomUUID(),
            );
          }
        }
        return next;
      });
      setPanel((value) =>
        value.status === 'ready' &&
        value.albumId === validAlbumId &&
        value.pageKey === refreshNo
          ? {
              ...value,
              deliveries: mergeGuestDeliveries(
                value.deliveries,
                page.deliveries,
              ),
              nextCursor: page.nextCursor,
            }
          : value,
      );
    } catch (error) {
      if (generation !== generationRef.current) return;
      if (shouldHide(error)) {
        setDownloadRequestIds(new Map());
        setPanel({
          status: 'disabled',
          albumId: validAlbumId,
          pageKey: refreshNo,
        });
      } else {
        setMoreError('無法載入更多交付紀錄；目前清單已保留。');
      }
    } finally {
      if (generation === generationRef.current) setLoadingMore(false);
    }
  }

  if (!current || current.status === 'loading' || current.status === 'disabled')
    return null;
  return (
    <section
      data-testid="approved-delivery-guest"
      className="min-w-0 rounded-lg border border-stone-300 bg-white p-4 text-stone-900"
      aria-labelledby={headingId}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-base font-semibold">
            成品交付
          </h3>
          <p className="mt-1 text-sm text-stone-600">
            此處只顯示為目前邀請固定的已確認版本。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setMoreError('');
            setLoadingMore(false);
            setRefreshNo((value) => value + 1);
          }}
        >
          重新載入
        </Button>
      </div>
      {current.status === 'error' ? (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {current.message}
        </p>
      ) : current.status !== 'ready' ? null : current.deliveries.length ===
        0 ? (
        <p className="mt-3 text-sm text-stone-600">
          目前沒有提供給此邀請的成品交付。
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {current.deliveries.map((read) => (
            <li
              key={read.delivery.id}
              className="min-w-0 rounded-md border border-stone-200 p-3"
            >
              <p className="text-sm font-medium">固定版本交付</p>
              <ul className="mt-2 space-y-2">
                {read.delivery.items.map((item) => {
                  const requestKey = read.delivery.id + ':' + item.asset.id;
                  const requestId = downloadRequestIds.get(requestKey);
                  if (!requestId) return null;
                  return (
                    <li
                      key={item.asset.id}
                      className="min-w-0 rounded border border-stone-200 bg-stone-50 p-2"
                    >
                      <p className="break-all text-sm font-medium">
                        {item.asset.filename}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-stone-600">
                        <StudioIcon
                          name="check"
                          aria-hidden="true"
                          width={14}
                          height={14}
                        />
                        固定版本 {item.versionNo}
                      </p>
                      {read.access.permissions.can_download_delivery && (
                        <a
                          className="mt-2 inline-flex min-h-10 items-center rounded-md border border-stone-400 px-3 text-sm underline underline-offset-2 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-700"
                          href={guestDownloadHref(
                            validAlbumId,
                            read.delivery.id,
                            item.asset.id,
                            requestId,
                          )}
                          onClick={(event) => {
                            const nextRequestId = crypto.randomUUID();
                            event.currentTarget.href = guestDownloadHref(
                              validAlbumId,
                              read.delivery.id,
                              item.asset.id,
                              nextRequestId,
                            );
                            setDownloadRequestIds((old) =>
                              new Map(old).set(requestKey, nextRequestId),
                            );
                          }}
                        >
                          下載成品
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {ready?.nextCursor && (
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          disabled={loadingMore}
          onClick={() => void loadMoreDeliveries()}
        >
          {loadingMore ? '載入中…' : '載入更多交付紀錄'}
        </Button>
      )}
      {moreError && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {moreError}
        </p>
      )}
    </section>
  );
}
