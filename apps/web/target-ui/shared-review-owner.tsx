'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import {
  createSharedReviewSchema,
  reopenSharedReviewSchema,
  ownerSharedReviewListSchema,
  sharedReviewCapabilitiesSchema,
  sharedReviewOwnerResultSchema,
  sharedReviewSubmissionDetailSchema,
  sharedReviewSubmissionPageSchema,
  type SharedReviewSubmission,
  type SharedReviewSummary,
} from '../../../packages/contracts/src/shared-review';
import {
  invitePageSchema,
  type InviteSummary,
} from '../../../packages/contracts/src/invites';

const errorEnvelope = z
  .object({ error: z.object({ code: z.string() }).passthrough() })
  .passthrough();
type FeatureState = 'loading' | 'enabled' | 'disabled' | 'error';
type Intent = {
  kind: 'create' | 'reopen';
  reviewId?: string;
  requestId: string;
  body: string;
};
type HistoryState = {
  submissions: SharedReviewSubmission[];
  nextBeforeRoundNo: number | null;
  loading: boolean;
  error: string;
};
type DetailState = {
  items: z.infer<typeof sharedReviewSubmissionDetailSchema>['items'];
  nextCursor: string | null;
  loading: boolean;
  error: string;
};
type Draft = {
  title: string;
  minimum: string;
  maximum: string;
  inviteIds: Set<string>;
};
type ReopenDraft = { reviewId: string; minimum: string; maximum: string };

function getErrorCode(value: unknown) {
  const parsed = errorEnvelope.safeParse(value);
  return parsed.success ? parsed.data.error.code : '';
}
function bound(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 100000
    ? number
    : null;
}
function inviteMode(mode: InviteSummary['accessMode']) {
  return mode === 'link_only'
    ? '免密連結'
    : mode === 'generated_password'
      ? '系統密碼'
      : '自訂密碼';
}
function eligible(invite: InviteSummary, albumId: string) {
  return (
    invite.sealed &&
    invite.revokedAt === null &&
    Date.parse(invite.expiresAt) > Date.now() &&
    invite.albums.some((item) => item.id === albumId)
  );
}
function inviteLabel(invite: InviteSummary) {
  const expiry = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(invite.expiresAt));
  return (
    '客戶邀請 · ' +
    inviteMode(invite.accessMode) +
    ' · 到期 ' +
    expiry +
    ' · ' +
    invite.id.slice(0, 8) +
    '… · ' +
    [
      invite.permissions.can_select ? '可挑片' : '不可挑片',
      invite.permissions.can_submit ? '可提交' : '不可提交',
      invite.permissions.can_view ? '可看照片' : '不可看照片',
    ].join('、')
  );
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
function limits(minimum: number, maximum: number | null) {
  return (
    '最少 ' +
    minimum +
    ' 張，最高 ' +
    (maximum === null ? '不限' : maximum + ' 張')
  );
}
function downloadAttachment(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function ConfirmDialog({
  testId,
  titleId,
  title,
  returnFocusRef,
  canDismiss,
  onCancel,
  children,
}: {
  testId: string;
  titleId: string;
  title: string;
  returnFocusRef: RefObject<HTMLElement | null>;
  canDismiss: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  const dismissRef = useRef(canDismiss);
  useEffect(() => {
    cancelRef.current = onCancel;
    dismissRef.current = canDismiss;
  }, [onCancel, canDismiss]);
  useEffect(() => {
    const returnFocusTarget = returnFocusRef.current;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const selector =
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[href],[tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(
        (node) =>
          !node.hasAttribute('hidden') &&
          node.getAttribute('aria-hidden') !== 'true',
      );
    (
      dialog.querySelector<HTMLElement>('[data-autofocus="true"]') ??
      focusable()[0] ??
      dialog
    ).focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dismissRef.current) cancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && (index < 0 || index === items.length - 1)) {
        event.preventDefault();
        items[0]?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const target = returnFocusTarget;
      if (target?.isConnected && !target.hasAttribute('disabled'))
        target.focus();
    };
  }, [returnFocusRef]);
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-stone-900/50 p-3 sm:p-6"
      data-testid={testId}
    >
      <div className="my-auto w-full max-w-lg rounded-xl bg-white p-4 shadow-xl sm:p-6">
        <h3 id={titleId} className="text-lg font-semibold text-stone-900">
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

export function AlbumSharedReviews({
  albumId,
  projectId,
}: {
  albumId: string;
  projectId: string;
}) {
  const [feature, setFeature] = useState<FeatureState>('loading');
  const [featureRetry, setFeatureRetry] = useState(0);
  const [reviews, setReviews] = useState<SharedReviewSummary[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);

  const [invitesById, setInvitesById] = useState<Record<string, InviteSummary>>(
    {},
  );
  const [visibleInvites, setVisibleInvites] = useState<InviteSummary[]>([]);
  const [inviteCursor, setInviteCursor] = useState<string | null>(null);
  const [inviteNext, setInviteNext] = useState<string | null>(null);
  const [inviteTrail, setInviteTrail] = useState<Array<string | null>>([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const [draft, setDraft] = useState<Draft>({
    title: '',
    minimum: '1',
    maximum: '',
    inviteIds: new Set(),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [reopenReview, setReopenReview] = useState<SharedReviewSummary | null>(
    null,
  );
  const [reopenDraft, setReopenDraft] = useState<ReopenDraft | null>(null);
  const [pending, setPending] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [mutationError, setMutationError] = useState('');

  const [history, setHistory] = useState<Record<string, HistoryState>>({});
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());

  const mutationLock = useRef(false);
  const pendingRef = useRef<Intent | null>(null);
  const refreshAfterMutation = useRef(false);
  const historyLocks = useRef(new Set<string>());
  const detailLocks = useRef(new Set<string>());
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const reviewReadSequence = useRef(0);
  const reviewsRef = useRef<SharedReviewSummary[]>([]);
  const historyEpochs = useRef(new Map<string, number>());
  const loadReviews = useCallback(async () => {
    const sequence = ++reviewReadSequence.current;
    setReviewLoading(true);
    try {
      const response = await fetch(
        '/api/v1/albums/' + encodeURIComponent(albumId) + '/shared-reviews',
        {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorCode(body) || 'FAILED');
      const nextReviews = ownerSharedReviewListSchema.parse(body).reviews;
      if (sequence !== reviewReadSequence.current) return false;
      const nextById = new Map(
        nextReviews.map((review) => [review.id, review]),
      );
      const stale = new Set(
        reviewsRef.current
          .filter((previous) => {
            const next = nextById.get(previous.id);
            return (
              !next ||
              next.roundNo !== previous.roundNo ||
              next.revision !== previous.revision ||
              next.status !== previous.status
            );
          })
          .map((review) => review.id),
      );
      for (const id of stale)
        historyEpochs.current.set(id, (historyEpochs.current.get(id) ?? 0) + 1);
      if (stale.size > 0)
        setHistory((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) => !stale.has(id)),
          ),
        );
      if (stale.size > 0)
        setHistoryOpen(
          (current) => new Set([...current].filter((id) => !stale.has(id))),
        );
      reviewsRef.current = nextReviews;
      setReviews(nextReviews);
      setReviewError('');
      setRefreshRequired(false);
      refreshAfterMutation.current = false;
      return true;
    } catch {
      if (sequence !== reviewReadSequence.current) return false;
      setReviewError('目前無法載入共用挑片審查，請重新整理。');
      if (refreshAfterMutation.current) setRefreshRequired(true);
      return false;
    } finally {
      if (sequence === reviewReadSequence.current) setReviewLoading(false);
    }
  }, [albumId]);

  const loadInvitePage = useCallback(
    async (cursor: string | null) => {
      setInviteLoading(true);
      setInviteError('');
      try {
        const query = cursor ? '?cursor=' + encodeURIComponent(cursor) : '';
        const response = await fetch(
          '/api/v1/projects/' +
            encodeURIComponent(projectId) +
            '/invites' +
            query,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          },
        );
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('FAILED');
        const page = invitePageSchema.parse(body);
        setInvitesById((old) => {
          const next = { ...old };
          for (const invite of page.invites) next[invite.id] = invite;
          return next;
        });
        setVisibleInvites(page.invites);
        setInviteCursor(cursor);
        setInviteNext(page.nextCursor);
        setInviteError('');
      } catch {
        setInviteError('目前無法載入客戶邀請，請確認登入狀態後重試。');
      } finally {
        setInviteLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/guest/shared-reviews/capabilities', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: abort.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('CAPABILITIES_UNAVAILABLE');
        const parsed = sharedReviewCapabilitiesSchema.parse(body);
        if (!abort.signal.aborted)
          setFeature(parsed.enabled ? 'enabled' : 'disabled');
      })
      .catch(() => {
        if (!abort.signal.aborted) setFeature('error');
      });
    return () => abort.abort();
  }, [featureRetry]);

  useEffect(() => {
    if (feature !== 'enabled') return;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        void loadReviews();
        void loadInvitePage(null);
      }
    });
    return () => {
      active = false;
    };
  }, [feature, loadInvitePage, loadReviews]);

  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);

  const selectedIds = Array.from(draft.inviteIds).sort();
  const selectedInvites = selectedIds
    .map((id) => invitesById[id])
    .filter((item): item is InviteSummary => Boolean(item));
  const invalidSelectedIds = selectedIds.filter(
    (id) => !invitesById[id] || !eligible(invitesById[id], albumId),
  );
  const minimum = bound(draft.minimum);
  const maximum = draft.maximum.trim() === '' ? null : bound(draft.maximum);

  const createProblem =
    draft.title.trim().length === 0
      ? '請輸入審查名稱。'
      : [...draft.title.trim()].length > 120
        ? '名稱最多 120 個字元。'
        : minimum === null
          ? '最少張數請輸入 1 到 100000 之間的整數。'
          : draft.maximum.trim() !== '' && maximum === null
            ? '最高張數請輸入 1 到 100000 之間的整數，或留白表示不限。'
            : maximum !== null && minimum > maximum
              ? '最高張數不可少於最少張數。'
              : selectedIds.length < 1 || selectedIds.length > 24
                ? '請選擇 1 到 24 個客戶邀請。'
                : invalidSelectedIds.length > 0
                  ? '有邀請已失效，請重新整理邀請後再建立。'
                  : null;

  const reopenMinimum = reopenDraft ? bound(reopenDraft.minimum) : null;
  const reopenMaximum =
    !reopenDraft || reopenDraft.maximum.trim() === ''
      ? null
      : bound(reopenDraft.maximum);
  const reopenProblem = !reopenDraft
    ? '請重新載入審查資料。'
    : reopenMinimum === null
      ? '最少張數請輸入 1 到 100000 之間的整數。'
      : reopenDraft.maximum.trim() !== '' && reopenMaximum === null
        ? '最高張數請輸入 1 到 100000 之間的整數，或留白表示不限。'
        : reopenMaximum !== null && reopenMinimum > reopenMaximum
          ? '最高張數不可少於最少張數。'
          : null;

  function rememberFocus(event: { currentTarget: HTMLElement }) {
    returnFocusRef.current = event.currentTarget;
  }
  function setPendingIntent(intent: Intent | null) {
    pendingRef.current = intent;
    setPending(intent);
  }

  function createIntent(): Intent | null {
    if (createProblem !== null || minimum === null) return null;
    const requestId = crypto.randomUUID();
    const parsed = createSharedReviewSchema.safeParse({
      requestId,
      title: draft.title.trim(),
      inviteIds: selectedIds,
      minimum,
      maximum,
      confirmShared: true,
    });
    return parsed.success
      ? { kind: 'create', requestId, body: JSON.stringify(parsed.data) }
      : null;
  }

  function reopenIntent(): Intent | null {
    if (!reopenReview || reopenProblem !== null || reopenMinimum === null)
      return null;
    const requestId = crypto.randomUUID();
    const parsed = reopenSharedReviewSchema.safeParse({
      requestId,
      expectedRoundNo: reopenReview.roundNo,
      minimum: reopenMinimum,
      maximum: reopenMaximum,
      confirmShared: true,
    });
    return parsed.success
      ? {
          kind: 'reopen',
          reviewId: reopenReview.id,
          requestId,
          body: JSON.stringify(parsed.data),
        }
      : null;
  }

  async function refreshCurrentList() {
    reviewAfterMutation();
    const ok = await loadReviews();
    if (ok) setNotice('');
  }
  function reviewAfterMutation() {
    refreshAfterMutation.current = true;
    setRefreshRequired(true);
  }

  async function sendIntent(intent: Intent) {
    if (mutationLock.current || refreshRequired) return;
    mutationLock.current = true;
    setBusy(true);
    setMutationError('');
    setNotice('');
    setPendingIntent(intent);
    try {
      const path =
        intent.kind === 'create'
          ? '/api/v1/albums/' + encodeURIComponent(albumId) + '/shared-reviews'
          : '/api/v1/albums/' +
            encodeURIComponent(albumId) +
            '/shared-reviews/' +
            encodeURIComponent(intent.reviewId ?? '') +
            '/reopen';
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: intent.body,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = getErrorCode(body);
        if (response.status === 409) {
          setPendingIntent(null);
          setCreateOpen(false);
          setReopenReview(null);
          setMutationError(
            '審查狀態已更新，清單已重新整理；原草稿已保留，請確認後再送出。',
          );
          reviewAfterMutation();
          await loadReviews();
          return;
        }
        if (
          response.status === 401 ||
          (response.status === 403 && code === 'OWNER_REQUIRED') ||
          response.status >= 500 ||
          response.status === 408 ||
          response.status === 429
        ) {
          setCreateOpen(false);
          setReopenReview(null);
          setNotice(
            code === 'OWNER_REQUIRED'
              ? '登入已失效。重新登入後，請重試同一筆操作。'
              : '操作結果尚未確認；請保留此頁並重試同一筆操作。',
          );
          return;
        }
        setPendingIntent(null);
        setCreateOpen(false);
        setReopenReview(null);
        setMutationError(
          response.status === 400
            ? '送出的資料未被接受，請檢查欄位後再確認。'
            : '目前無法完成操作，請重新整理後再試。',
        );
        return;
      }
      const result = sharedReviewOwnerResultSchema.parse(body);
      if (result.review.albumId !== albumId)
        throw new Error('INVALID_RESULT_SCOPE');
      setPendingIntent(null);
      setNotice('操作已確認，正在更新審查清單…');
      setCreateOpen(false);
      setReopenReview(null);
      reviewAfterMutation();
      if (intent.kind === 'create')
        setDraft({
          title: '',
          minimum: '1',
          maximum: '',
          inviteIds: new Set(),
        });
      else setReopenDraft(null);
      const refreshed = await loadReviews();
      if (refreshed) {
        setNotice('');
        setMutationError('');
      } else
        setNotice('操作已確認；目前清單尚未更新。請按「重新載入目前清單」。');
    } catch {
      setCreateOpen(false);
      setReopenReview(null);
      setNotice('操作結果尚未確認；請保留此頁並重試同一筆操作。');
    } finally {
      setBusy(false);
      mutationLock.current = false;
    }
  }

  async function confirmCreate() {
    if (mutationLock.current) return;
    const intent =
      pendingRef.current?.kind === 'create'
        ? pendingRef.current
        : createIntent();
    if (intent) await sendIntent(intent);
  }
  async function confirmReopen() {
    if (mutationLock.current) return;
    const intent =
      pendingRef.current?.kind === 'reopen'
        ? pendingRef.current
        : reopenIntent();
    if (intent) await sendIntent(intent);
  }

  function toggleInvite(invite: InviteSummary, checked: boolean) {
    if (!eligible(invite, albumId)) return;
    setDraft((current) => {
      const next = new Set(current.inviteIds);
      if (checked) next.add(invite.id);
      else next.delete(invite.id);
      return { ...current, inviteIds: next };
    });
  }
  function nextInvitePage() {
    if (!inviteNext || inviteLoading) return;
    setInviteTrail((trail) => [...trail, inviteCursor]);
    void loadInvitePage(inviteNext);
  }
  function previousInvitePage() {
    if (inviteTrail.length === 0 || inviteLoading) return;
    const cursor = inviteTrail[inviteTrail.length - 1] ?? null;
    setInviteTrail((trail) => trail.slice(0, -1));
    void loadInvitePage(cursor);
  }

  async function loadHistory(reviewId: string, before: number | null = null) {
    const epoch = historyEpochs.current.get(reviewId) ?? 0;
    const key = reviewId + ':' + epoch + ':' + (before ?? 'first');
    if (historyLocks.current.has(key)) return;
    historyLocks.current.add(key);
    setHistory((current) => ({
      ...current,
      [reviewId]: {
        submissions: current[reviewId]?.submissions ?? [],
        nextBeforeRoundNo: current[reviewId]?.nextBeforeRoundNo ?? null,
        loading: true,
        error: '',
      },
    }));
    try {
      const query =
        before === null
          ? ''
          : '?beforeRoundNo=' + encodeURIComponent(String(before));
      const response = await fetch(
        '/api/v1/albums/' +
          encodeURIComponent(albumId) +
          '/shared-reviews/' +
          encodeURIComponent(reviewId) +
          '/submissions' +
          query,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('FAILED');
      const page = sharedReviewSubmissionPageSchema.parse(body);
      if ((historyEpochs.current.get(reviewId) ?? 0) !== epoch) return;
      setHistory((current) => {
        const all = new Map(
          (current[reviewId]?.submissions ?? []).map(
            (item) => [item.id, item] as const,
          ),
        );
        for (const item of page.submissions) all.set(item.id, item);
        return {
          ...current,
          [reviewId]: {
            submissions: [...all.values()].sort(
              (a, b) => b.roundNo - a.roundNo,
            ),
            nextBeforeRoundNo: page.nextBeforeRoundNo,
            loading: false,
            error: '',
          },
        };
      });
    } catch {
      if ((historyEpochs.current.get(reviewId) ?? 0) !== epoch) return;
      setHistory((current) => ({
        ...current,
        [reviewId]: {
          submissions: current[reviewId]?.submissions ?? [],
          nextBeforeRoundNo: current[reviewId]?.nextBeforeRoundNo ?? null,
          loading: false,
          error: '無法載入歷史提交，請稍後重試。',
        },
      }));
    } finally {
      historyLocks.current.delete(key);
    }
  }

  async function loadDetail(
    reviewId: string,
    submission: SharedReviewSubmission,
    cursor: string | null = null,
  ) {
    const key = submission.id + ':' + (cursor ?? 'first');
    if (detailLocks.current.has(key)) return;
    detailLocks.current.add(key);
    setDetails((current) => ({
      ...current,
      [submission.id]: {
        items: current[submission.id]?.items ?? [],
        nextCursor: current[submission.id]?.nextCursor ?? null,
        loading: true,
        error: '',
      },
    }));
    try {
      const query =
        cursor === null ? '' : '?cursor=' + encodeURIComponent(cursor);
      const response = await fetch(
        '/api/v1/albums/' +
          encodeURIComponent(albumId) +
          '/shared-reviews/' +
          encodeURIComponent(reviewId) +
          '/submissions/' +
          encodeURIComponent(submission.id) +
          query,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('FAILED');
      const page = sharedReviewSubmissionDetailSchema.parse(body);
      setDetails((current) => {
        const all = new Map(
          (current[submission.id]?.items ?? []).map(
            (item) => [item.photoId, item] as const,
          ),
        );
        for (const item of page.items) all.set(item.photoId, item);
        return {
          ...current,
          [submission.id]: {
            items: [...all.values()],
            nextCursor: page.nextCursor,
            loading: false,
            error: '',
          },
        };
      });
    } catch {
      setDetails((current) => ({
        ...current,
        [submission.id]: {
          items: current[submission.id]?.items ?? [],
          nextCursor: current[submission.id]?.nextCursor ?? null,
          loading: false,
          error: '無法載入提交明細，請稍後重試。',
        },
      }));
    } finally {
      detailLocks.current.delete(key);
    }
  }

  function toggleHistory(review: SharedReviewSummary) {
    if (historyOpen.has(review.id)) {
      setHistoryOpen((current) => {
        const next = new Set(current);
        next.delete(review.id);
        return next;
      });
    } else {
      setHistoryOpen((current) => new Set(current).add(review.id));
      if (!history[review.id]) void loadHistory(review.id);
    }
  }
  function toggleDetail(reviewId: string, submission: SharedReviewSubmission) {
    if (detailOpen.has(submission.id)) {
      setDetailOpen((current) => {
        const next = new Set(current);
        next.delete(submission.id);
        return next;
      });
    } else {
      setDetailOpen((current) => new Set(current).add(submission.id));
      if (!details[submission.id]) void loadDetail(reviewId, submission);
    }
  }

  if (feature === 'loading') {
    return (
      <section
        className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-6"
        data-testid="shared-review-panel"
        aria-live="polite"
      >
        <p className="text-sm text-stone-600">載入共用挑片功能狀態中…</p>
      </section>
    );
  }
  if (feature === 'disabled') {
    return (
      <section
        className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-6"
        data-testid="shared-review-panel"
        aria-labelledby={'shared-review-heading-' + albumId}
      >
        <h4
          id={'shared-review-heading-' + albumId}
          className="text-base font-semibold text-stone-900"
        >
          共用挑片審查
        </h4>
        <p
          className="mt-3 rounded-md border border-stone-200 bg-white p-3 text-sm text-stone-600"
          data-testid="shared-review-unavailable"
        >
          共用挑片目前尚未啟用，暫時無法建立或檢視共用審查。
        </p>
      </section>
    );
  }
  if (feature === 'error') {
    return (
      <section
        className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-6"
        data-testid="shared-review-panel"
      >
        <p role="alert" className="text-sm text-red-700">
          目前無法確認共用挑片功能狀態。
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => {
            setFeature('loading');
            setFeatureRetry((n) => n + 1);
          }}
        >
          重新檢查
        </Button>
      </section>
    );
  }

  return (
    <section
      className="mt-6 min-w-0 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-6"
      data-testid="shared-review-panel"
      aria-labelledby={'shared-review-heading-' + albumId}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="min-w-0">
          <h4
            id={'shared-review-heading-' + albumId}
            className="break-words text-base font-semibold text-stone-900"
          >
            共用挑片審查
          </h4>
          <p className="mt-1 text-xs text-stone-600">
            所選客戶邀請的持有人會依各自權限共同參與；查看照片、挑片與提交權限分別驗證。私人挑片、星等與收藏不會匯入。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="px-3 py-1 text-xs"
            onClick={() => {
              refreshAfterMutation.current = refreshRequired;
              void loadReviews();
              setInviteTrail([]);
              void loadInvitePage(null);
            }}
            disabled={reviewLoading || inviteLoading || busy}
            aria-label="重新整理共用挑片審查"
          >
            {reviewLoading || inviteLoading ? '載入中…' : '重新整理'}
          </Button>
          {refreshRequired && (
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1 text-xs"
              onClick={() => void refreshCurrentList()}
              disabled={reviewLoading}
              data-testid="shared-review-refresh-current"
            >
              重新載入目前清單
            </Button>
          )}
        </div>
      </header>

      {mutationError && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {mutationError}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
          data-testid={
            pending ? 'shared-review-pending-status' : 'shared-review-status'
          }
        >
          {notice}
        </p>
      )}
      {pending && !busy && (
        <Button
          type="button"
          className="mt-3 px-3 py-1.5 text-sm"
          onClick={() => void sendIntent(pending)}
          data-testid="shared-review-retry-pending"
        >
          重試同一筆操作
        </Button>
      )}
      {reviewError && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {reviewError}
        </div>
      )}

      <div className="mt-5 rounded-md border border-stone-200 bg-white p-4">
        <h5 className="font-semibold text-stone-900">建立新的共用挑片審查</h5>
        <p className="mt-1 text-xs text-stone-600">
          這會建立空白共用挑片組，不會自動帶入私人挑片。
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="min-w-0 sm:col-span-3">
            <span className="block text-sm font-medium text-stone-700">
              審查名稱
            </span>
            <input
              data-testid="shared-review-title"
              className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm"
              value={draft.title}
              maxLength={120}
              onChange={(event) =>
                setDraft((old) => ({ ...old, title: event.target.value }))
              }
              disabled={Boolean(pending) || refreshRequired}
            />
          </label>
          <label className="min-w-0">
            <span className="block text-sm font-medium text-stone-700">
              本輪最少張數
            </span>
            <input
              data-testid="shared-review-minimum"
              className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm"
              inputMode="numeric"
              value={draft.minimum}
              onChange={(event) =>
                setDraft((old) => ({ ...old, minimum: event.target.value }))
              }
              disabled={Boolean(pending) || refreshRequired}
            />
          </label>
          <label className="min-w-0">
            <span className="block text-sm font-medium text-stone-700">
              本輪最高張數
            </span>
            <input
              data-testid="shared-review-maximum"
              className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm"
              inputMode="numeric"
              placeholder="留白表示不限"
              value={draft.maximum}
              onChange={(event) =>
                setDraft((old) => ({ ...old, maximum: event.target.value }))
              }
              disabled={Boolean(pending) || refreshRequired}
            />
          </label>
        </div>
        <div className="mt-5 border-t border-stone-100 pt-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h6 className="text-sm font-semibold text-stone-800">
                選擇客戶邀請
              </h6>
              <p className="mt-1 text-xs text-stone-500">
                只列出目前仍有效、已封存且包含此相簿的邀請。
              </p>
            </div>
            <span
              className="text-xs text-stone-600"
              data-testid="shared-review-invite-selected-count"
            >
              已選 {draft.inviteIds.size} 個
            </span>
          </div>
          {inviteLoading && (
            <p role="status" className="mt-3 text-sm text-stone-500">
              載入客戶邀請中…
            </p>
          )}
          {inviteError && (
            <div
              role="alert"
              className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {inviteError}
            </div>
          )}
          {!inviteLoading &&
            !inviteError &&
            visibleInvites.filter((invite) => eligible(invite, albumId))
              .length === 0 && (
              <p className="mt-3 text-sm text-stone-600">
                此頁沒有符合條件的客戶邀請。
              </p>
            )}
          <ul className="mt-3 space-y-2">
            {visibleInvites
              .filter((invite) => eligible(invite, albumId))
              .map((invite) => (
                <li
                  key={invite.id}
                  className="min-w-0 rounded border border-stone-200 p-3"
                >
                  <label className="flex min-w-0 items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      data-testid={'shared-review-invite-' + invite.id}
                      checked={draft.inviteIds.has(invite.id)}
                      disabled={Boolean(pending) || refreshRequired}
                      onChange={(event) =>
                        toggleInvite(invite, event.target.checked)
                      }
                    />
                    <span className="min-w-0 break-words text-sm text-stone-700">
                      {inviteLabel(invite)}
                    </span>
                  </label>
                </li>
              ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {inviteTrail.length > 0 && (
              <Button
                type="button"
                variant="outline"
                className="px-3 py-1 text-xs"
                onClick={previousInvitePage}
                disabled={inviteLoading}
              >
                上一頁邀請
              </Button>
            )}
            {inviteNext && (
              <Button
                type="button"
                variant="outline"
                className="px-3 py-1 text-xs"
                onClick={nextInvitePage}
                disabled={inviteLoading}
              >
                下一頁邀請
              </Button>
            )}
          </div>
        </div>
        {createProblem && (
          <p
            className="mt-3 text-xs text-amber-800"
            data-testid="shared-review-create-validation"
          >
            {createProblem}
          </p>
        )}
        {invalidSelectedIds.length > 0 && (
          <p role="alert" className="mt-2 text-xs text-red-700">
            有已選邀請不再符合條件；請重新整理邀請並更新選擇。
          </p>
        )}
        <div className="mt-4">
          <Button
            type="button"
            className="px-3 py-1.5 text-sm"
            onClick={(event) => {
              if (createProblem || pending || refreshRequired) return;
              rememberFocus(event);
              setCreateOpen(true);
              setMutationError('');
            }}
            disabled={
              Boolean(createProblem) ||
              Boolean(pending) ||
              refreshRequired ||
              busy
            }
            data-testid="shared-review-create"
          >
            建立共用挑片審查
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <h5 className="text-sm font-semibold text-stone-900">目前共用審查</h5>
        {reviewLoading && reviews.length === 0 && (
          <p role="status" className="mt-3 text-sm text-stone-500">
            載入審查清單中…
          </p>
        )}
        {!reviewLoading && !reviewError && reviews.length === 0 && (
          <p
            className="mt-3 text-sm text-stone-600"
            data-testid="shared-review-empty"
          >
            目前尚無共用挑片審查。
          </p>
        )}
        <ul className="mt-3 space-y-3">
          {reviews.map((review) => {
            const reviewHistory = history[review.id];
            return (
              <li
                key={review.id}
                className="min-w-0 rounded-md border border-stone-200 bg-white p-4"
                data-testid={'shared-review-' + review.id}
              >
                <article className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h6 className="break-words font-semibold text-stone-900">
                        {review.title}
                      </h6>
                      <p className="mt-1 text-xs text-stone-600">
                        第 {review.roundNo} 輪 ·{' '}
                        {review.status === 'open' ? '進行中' : '已提交'} ·{' '}
                        {limits(review.minimum, review.maximum)}
                      </p>
                      <p className="mt-1 break-words text-xs text-stone-500">
                        {review.inviteIds.length} 個客戶邀請 · 已選{' '}
                        {review.selectedCount} 張 · 修訂 {review.revision} ·
                        建立於 {dateLabel(review.createdAt)}
                      </p>
                      {review.submittedAt && (
                        <p className="mt-1 text-xs text-stone-500">
                          提交時間：{dateLabel(review.submittedAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="px-3 py-1 text-xs"
                        onClick={() => toggleHistory(review)}
                        aria-expanded={historyOpen.has(review.id)}
                        aria-label={
                          (historyOpen.has(review.id) ? '收起' : '查看') +
                          '共用挑片歷史 ' +
                          review.title
                        }
                        data-testid={
                          'shared-review-history-toggle-' + review.id
                        }
                      >
                        {historyOpen.has(review.id) ? '收起歷史' : '查看歷史'}
                      </Button>
                      {review.status === 'submitted' && (
                        <Button
                          type="button"
                          variant="outline"
                          className="border-amber-300 px-3 py-1 text-xs text-amber-900 hover:bg-amber-50"
                          onClick={(event) => {
                            rememberFocus(event);
                            setReopenReview(review);
                            setReopenDraft((old) =>
                              old?.reviewId === review.id
                                ? old
                                : {
                                    reviewId: review.id,
                                    minimum: String(review.minimum),
                                    maximum:
                                      review.maximum === null
                                        ? ''
                                        : String(review.maximum),
                                  },
                            );
                          }}
                          aria-label={'重開共用挑片 ' + review.title}
                          data-testid={'shared-review-reopen-' + review.id}
                          disabled={Boolean(pending) || refreshRequired || busy}
                        >
                          重開下一輪
                        </Button>
                      )}
                    </div>
                  </div>
                  {historyOpen.has(review.id) && (
                    <div
                      className="mt-4 border-t border-stone-100 pt-3"
                      data-testid={'shared-review-history-' + review.id}
                    >
                      {reviewHistory?.loading && (
                        <p role="status" className="text-sm text-stone-500">
                          載入歷史提交中…
                        </p>
                      )}
                      {reviewHistory?.error && (
                        <div role="alert" className="text-sm text-red-700">
                          {reviewHistory.error}
                          <Button
                            type="button"
                            variant="outline"
                            className="ml-2 px-2 py-1 text-xs"
                            onClick={() =>
                              void loadHistory(
                                review.id,
                                reviewHistory.nextBeforeRoundNo,
                              )
                            }
                          >
                            重試載入歷史
                          </Button>
                        </div>
                      )}
                      {!reviewHistory?.loading &&
                        !reviewHistory?.error &&
                        (reviewHistory?.submissions.length ?? 0) === 0 && (
                          <p className="text-sm text-stone-600">
                            目前尚無提交紀錄。
                          </p>
                        )}
                      <ul className="space-y-3">
                        {(reviewHistory?.submissions ?? []).map(
                          (submission) => {
                            const detail = details[submission.id];
                            return (
                              <li
                                key={submission.id}
                                className="min-w-0 rounded border border-stone-200 bg-stone-50 p-3"
                                data-testid={
                                  'shared-review-submission-' + submission.id
                                }
                              >
                                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="font-medium text-stone-800">
                                      第 {submission.roundNo} 輪提交 ·{' '}
                                      {submission.selectedCount} 張
                                    </p>
                                    <p className="mt-1 break-all font-mono text-[11px] text-stone-500">
                                      {submission.id.slice(0, 8)}… ·{' '}
                                      {dateLabel(submission.submittedAt)}
                                    </p>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="px-2 py-1 text-xs"
                                    onClick={() =>
                                      toggleDetail(review.id, submission)
                                    }
                                    aria-expanded={detailOpen.has(
                                      submission.id,
                                    )}
                                    aria-label={
                                      (detailOpen.has(submission.id)
                                        ? '收起'
                                        : '查看') +
                                      '第 ' +
                                      submission.roundNo +
                                      ' 輪共用挑片明細'
                                    }
                                    data-testid={
                                      'shared-review-detail-toggle-' +
                                      submission.id
                                    }
                                  >
                                    {detailOpen.has(submission.id)
                                      ? '收起明細'
                                      : '查看明細'}
                                  </Button>
                                </div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {(['csv', 'txt', 'json'] as const).map(
                                    (format) => (
                                      <Button
                                        key={format}
                                        type="button"
                                        variant="outline"
                                        className="px-2 py-1 text-xs"
                                        onClick={() =>
                                          downloadAttachment(
                                            '/api/v1/albums/' +
                                              encodeURIComponent(albumId) +
                                              '/shared-reviews/' +
                                              encodeURIComponent(review.id) +
                                              '/submissions/' +
                                              encodeURIComponent(
                                                submission.id,
                                              ) +
                                              '/download?format=' +
                                              format,
                                            'shared-review-' +
                                              submission.roundNo +
                                              '.' +
                                              format,
                                          )
                                        }
                                        aria-label={
                                          '匯出第 ' +
                                          submission.roundNo +
                                          ' 輪 ' +
                                          format.toUpperCase()
                                        }
                                        data-testid={
                                          'shared-review-export-' +
                                          format +
                                          '-' +
                                          submission.id
                                        }
                                      >
                                        匯出 {format.toUpperCase()}
                                      </Button>
                                    ),
                                  )}
                                </div>
                                {detailOpen.has(submission.id) && (
                                  <div
                                    className="mt-3 border-t border-stone-200 pt-3"
                                    data-testid={
                                      'shared-review-detail-' + submission.id
                                    }
                                  >
                                    {detail?.loading && (
                                      <p
                                        role="status"
                                        className="text-sm text-stone-500"
                                      >
                                        載入提交明細中…
                                      </p>
                                    )}
                                    {detail?.error && (
                                      <div
                                        role="alert"
                                        className="text-sm text-red-700"
                                      >
                                        {detail.error}
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="ml-2 px-2 py-1 text-xs"
                                          onClick={() =>
                                            void loadDetail(
                                              review.id,
                                              submission,
                                            )
                                          }
                                        >
                                          重試載入明細
                                        </Button>
                                      </div>
                                    )}
                                    <ul className="max-h-56 divide-y divide-stone-100 overflow-y-auto rounded border border-stone-200 bg-white p-2">
                                      {(detail?.items ?? []).map((item) => (
                                        <li
                                          key={item.photoId}
                                          className="flex min-w-0 flex-wrap items-start justify-between gap-2 py-2 text-xs text-stone-700"
                                        >
                                          <span className="min-w-0 break-words font-medium">
                                            {item.filename}
                                          </span>
                                          <span className="shrink-0 text-stone-500">
                                            版本 v{item.versionNo} ·{' '}
                                            {dateLabel(item.selectedAt)}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                    {detail?.nextCursor && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        className="mt-3 px-3 py-1 text-xs"
                                        onClick={() =>
                                          void loadDetail(
                                            review.id,
                                            submission,
                                            detail.nextCursor,
                                          )
                                        }
                                        disabled={detail.loading}
                                      >
                                        載入更多照片
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          },
                        )}
                      </ul>
                      {reviewHistory?.nextBeforeRoundNo && (
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-3 px-3 py-1 text-xs"
                          onClick={() =>
                            void loadHistory(
                              review.id,
                              reviewHistory.nextBeforeRoundNo,
                            )
                          }
                          disabled={reviewHistory.loading}
                        >
                          載入較舊提交
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      </div>

      {createOpen && (
        <ConfirmDialog
          testId="shared-review-create-dialog"
          titleId={'shared-review-create-dialog-title-' + albumId}
          title="確認建立共用挑片審查？"
          returnFocusRef={returnFocusRef}
          canDismiss={!pending && !busy}
          onCancel={() => setCreateOpen(false)}
        >
          <p className="mt-3 text-sm text-stone-700">
            所選客戶邀請只提供共用範圍；查看照片、挑片及提交仍依各自權限。這是新的空白挑片組，不會匯入私人挑片、星等或收藏。
          </p>
          <p className="mt-2 text-sm text-stone-700">
            審查名稱：<strong>{draft.title.trim()}</strong>；
            {limits(minimum ?? 1, maximum)}。
          </p>
          <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
            {selectedInvites.map((invite) => (
              <li key={invite.id} className="break-words">
                {inviteLabel(invite)}
              </li>
            ))}
          </ul>
          {pending?.kind === 'create' && (
            <p
              role="status"
              className="mt-3 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900"
              data-testid="shared-review-uncertain"
            >
              {notice || '操作結果尚未確認；請重試同一筆操作。'}
            </p>
          )}
          {mutationError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {mutationError}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-sm"
              onClick={() => setCreateOpen(false)}
              disabled={Boolean(pending) || busy}
              data-autofocus="true"
            >
              取消
            </Button>
            {pending?.kind === 'create' && !busy && (
              <Button
                type="button"
                className="px-3 py-1.5 text-sm"
                onClick={() => void confirmCreate()}
                data-testid="shared-review-retry-pending"
              >
                重試同一筆操作
              </Button>
            )}
            {!pending && (
              <Button
                type="button"
                className="px-3 py-1.5 text-sm"
                onClick={() => void confirmCreate()}
                disabled={busy || refreshRequired}
                data-testid="shared-review-confirm-create"
              >
                {busy ? '建立中…' : '確認建立'}
              </Button>
            )}
            {pending && busy && (
              <Button type="button" className="px-3 py-1.5 text-sm" disabled>
                處理中…
              </Button>
            )}
          </div>
        </ConfirmDialog>
      )}

      {reopenReview && reopenDraft?.reviewId === reopenReview.id && (
        <ConfirmDialog
          testId="shared-review-reopen-dialog"
          titleId={'shared-review-reopen-dialog-title-' + reopenReview.id}
          title="確認重開共用挑片？"
          returnFocusRef={returnFocusRef}
          canDismiss={!pending && !busy}
          onCancel={() => setReopenReview(null)}
        >
          <p className="mt-3 text-sm text-stone-700">
            重開後，具挑片權限的受邀客戶可共同修改選取內容；查看照片與提交仍依各自權限。已提交的歷史快照會保留不變。
          </p>
          <p className="mt-2 text-xs text-stone-600">
            第 {reopenReview.roundNo} 輪提交共 {reopenReview.selectedCount}{' '}
            張；下一輪會保留目前共用選取集合，並套用以下張數限制。
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="min-w-0">
              <span className="block text-sm font-medium text-stone-700">
                下一輪最少張數
              </span>
              <input
                data-testid="shared-review-reopen-minimum"
                className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm"
                inputMode="numeric"
                value={reopenDraft.minimum}
                onChange={(event) =>
                  setReopenDraft((old) =>
                    old ? { ...old, minimum: event.target.value } : old,
                  )
                }
                disabled={Boolean(pending) || busy}
              />
            </label>
            <label className="min-w-0">
              <span className="block text-sm font-medium text-stone-700">
                下一輪最高張數
              </span>
              <input
                data-testid="shared-review-reopen-maximum"
                className="mt-1 w-full min-w-0 rounded-md border border-stone-300 px-3 py-2 text-sm"
                inputMode="numeric"
                placeholder="留白表示不限"
                value={reopenDraft.maximum}
                onChange={(event) =>
                  setReopenDraft((old) =>
                    old ? { ...old, maximum: event.target.value } : old,
                  )
                }
                disabled={Boolean(pending) || busy}
              />
            </label>
          </div>
          {reopenProblem && (
            <p className="mt-3 text-xs text-amber-800">{reopenProblem}</p>
          )}
          {pending?.kind === 'reopen' && (
            <p
              role="status"
              className="mt-3 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900"
              data-testid="shared-review-uncertain"
            >
              {notice || '操作結果尚未確認；請重試同一筆操作。'}
            </p>
          )}
          {mutationError && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {mutationError}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="px-3 py-1.5 text-sm"
              onClick={() => setReopenReview(null)}
              disabled={Boolean(pending) || busy}
              data-autofocus="true"
            >
              取消
            </Button>
            {pending?.kind === 'reopen' && !busy && (
              <Button
                type="button"
                className="px-3 py-1.5 text-sm"
                onClick={() => void confirmReopen()}
                data-testid="shared-review-retry-pending"
              >
                重試同一筆操作
              </Button>
            )}
            {!pending && (
              <Button
                type="button"
                className="px-3 py-1.5 text-sm"
                onClick={() => void confirmReopen()}
                disabled={busy || reopenProblem !== null || refreshRequired}
                data-testid="shared-review-confirm-reopen"
              >
                {busy ? '重開中…' : '確認重開'}
              </Button>
            )}
            {pending && busy && (
              <Button type="button" className="px-3 py-1.5 text-sm" disabled>
                處理中…
              </Button>
            )}
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}
