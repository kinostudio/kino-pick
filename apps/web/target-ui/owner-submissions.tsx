import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import {
  ownerRoundReopenResponseSchema,
  ownerSubmissionDetailResponseSchema,
  ownerSubmissionListResponseSchema,
  type OwnerSubmissionDetail,
  type OwnerSubmissionSummary,
} from '../../../packages/contracts/src/owner-selection';

const errorCode = z.object({ error: z.object({ code: z.string() }) });
type ReopenFocusTarget = { trigger: HTMLElement; fallback: HTMLElement };

function triggerDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function AlbumSubmissions({
  albumId,
  albumName,
}: {
  albumId: string;
  albumName: string;
}) {
  const [submissions, setSubmissions] = useState<OwnerSubmissionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [reopenTarget, setReopenTarget] =
    useState<OwnerSubmissionSummary | null>(null);
  const [reopenFocusTarget, setReopenFocusTarget] =
    useState<ReopenFocusTarget | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/v1/albums/${albumId}/submissions`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: abort.signal,
    })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (abort.signal.aborted) return;
        if (!res.ok) {
          const parsed = errorCode.safeParse(body);
          const code = parsed.success ? parsed.data.error.code : '';
          throw new Error(code || 'FAILED_TO_LOAD');
        }
        const data = ownerSubmissionListResponseSchema.parse(body);
        setSubmissions(data.submissions);
        setError('');
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : '';
        setError(
          msg === 'OWNER_REQUIRED'
            ? '登入已失效，請重新登入。'
            : msg === 'GUEST_SELECTION_DISABLED'
              ? '選片功能目前未啟用。'
              : '無法載入挑片紀錄，請稍後重試。',
        );
        setLoading(false);
      });
    return () => abort.abort();
  }, [albumId, refreshKey]);

  return (
    <section
      className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 sm:p-6"
      aria-labelledby="submissions-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
        <div>
          <h4
            id="submissions-heading"
            className="text-base font-semibold text-stone-900"
          >
            挑片審查與匯出 · {albumName}
          </h4>
          <p className="mt-1 text-xs text-stone-600">
            檢視訪客挑片提交快照、匯出選片檔名與授權重開挑片輪次。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="text-xs py-1 px-3"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          aria-label="重新整理挑片清單"
        >
          {loading ? '載入中…' : '重新整理'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {loading && !submissions.length && (
        <p className="mt-4 text-sm text-stone-500">載入挑片紀錄中…</p>
      )}

      {!loading && !error && submissions.length === 0 && (
        <p
          className="mt-4 text-sm text-stone-600"
          data-testid="empty-submissions"
        >
          目前尚無訪客提交挑片紀錄。
        </p>
      )}

      {submissions.length > 0 && (
        <ul className="mt-4 space-y-4" data-testid="submissions-list">
          {submissions.map((sub) => (
            <SubmissionCard
              key={sub.id}
              albumId={albumId}
              submission={sub}
              onOpenReopen={(trigger, fallback) => {
                setReopenFocusTarget({ trigger, fallback });
                setReopenTarget(sub);
              }}
            />
          ))}
        </ul>
      )}

      {reopenTarget && (
        <ReopenConfirmModal
          albumId={albumId}
          submission={reopenTarget}
          returnFocusTarget={reopenFocusTarget?.trigger ?? null}
          returnFocusFallback={reopenFocusTarget?.fallback ?? null}
          onClose={() => {
            setReopenTarget(null);
            setReopenFocusTarget(null);
          }}
          onSuccess={() => {
            setReopenTarget(null);
            setReopenFocusTarget(null);
            setRefreshKey((k) => k + 1);
            window.dispatchEvent(new Event('kino-pic:refresh'));
          }}
        />
      )}
    </section>
  );
}

function SubmissionCard({
  albumId,
  submission,
  onOpenReopen,
}: {
  albumId: string;
  submission: OwnerSubmissionSummary;
  onOpenReopen: (trigger: HTMLElement, fallback: HTMLElement) => void;
}) {
  const cardRef = useRef<HTMLLIElement>(null);
  const [detailOpened, setDetailOpened] = useState(false);
  const [detail, setDetail] = useState<OwnerSubmissionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const isReopened = submission.currentRoundNo > submission.roundNo;
  const canReopen =
    submission.roundStatus === 'submitted' &&
    submission.roundNo === submission.currentRoundNo;

  function toggleDetail() {
    if (detailOpened) {
      setDetailOpened(false);
      return;
    }
    setDetailOpened(true);
    if (!detail) {
      setDetailLoading(true);
      setDetailError('');
      fetch(`/api/v1/albums/${albumId}/submissions/${submission.id}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
        .then(async (res) => {
          const body: unknown = await res.json().catch(() => null);
          if (!res.ok) throw new Error('FAILED_TO_LOAD_DETAIL');
          const parsed = ownerSubmissionDetailResponseSchema.parse(body);
          setDetail(parsed.submission);
        })
        .catch(() => {
          setDetailError('無法載入明細');
        })
        .finally(() => {
          setDetailLoading(false);
        });
    }
  }

  return (
    <li
      ref={cardRef}
      tabIndex={-1}
      className="rounded-md border border-stone-200 bg-white p-4 text-sm shadow-sm"
      data-testid={`submission-card-${submission.guestId}-${submission.roundNo}`}
      data-submission-round={submission.roundNo}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-stone-900">
            第 {submission.roundNo} 輪挑片
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              canReopen
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}
          >
            {canReopen
              ? '已送出鎖定'
              : isReopened
                ? submission.roundStatus === 'submitted'
                  ? `已重開（第 ${submission.currentRoundNo} 輪已送出）`
                  : `已重開（進行中 第 ${submission.currentRoundNo} 輪）`
                : '進行中'}
          </span>
          {submission.sealed && (
            <span className="inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
              快照已封存
            </span>
          )}
        </div>
        <p className="text-xs text-stone-500">
          提交時間：{new Date(submission.submittedAt).toLocaleString()}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-stone-600">
        <div>
          <span>已選取 {submission.selectedCount} 張照片</span>
          <span className="mx-2">·</span>
          <span className="font-mono text-xs">
            訪客：{submission.guestId.slice(0, 8)}…
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
        <Button
          type="button"
          variant="outline"
          className="text-xs py-1 px-3"
          onClick={toggleDetail}
          aria-expanded={detailOpened}
          aria-label={`查看第 ${submission.roundNo} 輪挑片明細`}
        >
          {detailOpened ? '收起明細' : '查看明細'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-xs py-1 px-3"
          onClick={() =>
            triggerDownload(
              `/api/v1/albums/${albumId}/submissions/${submission.id}/export?format=csv`,
              `album-${albumId}-round-${submission.roundNo}.csv`,
            )
          }
          aria-label={`匯出第 ${submission.roundNo} 輪 CSV`}
        >
          匯出 CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-xs py-1 px-3"
          onClick={() =>
            triggerDownload(
              `/api/v1/albums/${albumId}/submissions/${submission.id}/export?format=txt`,
              `album-${albumId}-round-${submission.roundNo}-filenames.txt`,
            )
          }
          aria-label={`匯出第 ${submission.roundNo} 輪 Lightroom 檔名`}
        >
          匯出 Lightroom 檔名
        </Button>
        <Button
          type="button"
          variant="outline"
          className="text-xs py-1 px-3"
          onClick={() =>
            triggerDownload(
              `/api/v1/albums/${albumId}/submissions/${submission.id}/export?format=json`,
              `album-${albumId}-round-${submission.roundNo}.json`,
            )
          }
          aria-label={`匯出第 ${submission.roundNo} 輪 JSON`}
        >
          匯出 JSON
        </Button>
        {canReopen && (
          <Button
            type="button"
            variant="outline"
            onClick={(event) => {
              const fallback = cardRef.current;
              if (fallback) onOpenReopen(event.currentTarget, fallback);
            }}
            aria-label={`重開第 ${submission.roundNo} 輪挑片輪次`}
            className="text-xs py-1 px-3 border-amber-300 text-amber-900 hover:bg-amber-50"
          >
            重開挑片輪次
          </Button>
        )}
      </div>

      {detailOpened && (
        <div className="mt-3 border-t border-stone-100 pt-3 text-xs">
          {detailLoading && <p className="text-stone-500">載入挑片明細中…</p>}
          {detailError && <p className="text-red-700">{detailError}</p>}
          {detail && (
            <div className="space-y-2">
              <p className="font-semibold text-stone-700">選取照片清單：</p>
              <ul className="max-h-60 divide-y divide-stone-100 overflow-y-auto rounded border border-stone-200 bg-stone-50 p-2">
                {detail.items.map((item) => (
                  <li
                    key={item.photoId}
                    className="flex flex-wrap items-center justify-between gap-1 py-1 text-stone-700"
                  >
                    <span className="font-medium">{item.originalFilename}</span>
                    <span className="text-stone-400">
                      版本 v{item.versionNo} ·{' '}
                      {new Date(item.selectedAt).toLocaleTimeString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ReopenConfirmModal({
  albumId,
  submission,
  returnFocusTarget,
  returnFocusFallback,
  onClose,
  onSuccess,
}: {
  albumId: string;
  submission: OwnerSubmissionSummary;
  returnFocusTarget: HTMLElement | null;
  returnFocusFallback: HTMLElement | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(submitting);
  const onCloseRef = useRef(onClose);
  const completedRef = useRef(false);
  const requestIdRef = useRef(crypto.randomUUID());
  useEffect(() => {
    submittingRef.current = submitting;
    onCloseRef.current = onClose;
  }, [onClose, submitting]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter(
        (element) =>
          !element.hasAttribute('hidden') &&
          element.getAttribute('aria-hidden') !== 'true',
      );

    const firstFocusable = getFocusable()[0];
    if (firstFocusable) firstFocusable.focus();
    else dialog.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!submittingRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const activeIndex = focusable.indexOf(
        document.activeElement as HTMLElement,
      );
      const lastIndex = focusable.length - 1;
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        focusable[lastIndex]?.focus();
      } else if (
        !event.shiftKey &&
        (activeIndex < 0 || activeIndex === lastIndex)
      ) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const preferredTarget = completedRef.current
        ? returnFocusFallback
        : returnFocusTarget;
      const target =
        preferredTarget?.isConnected &&
        !preferredTarget.hasAttribute('disabled')
          ? preferredTarget
          : returnFocusFallback?.isConnected
            ? returnFocusFallback
            : null;
      target?.focus();
    };
  }, [returnFocusFallback, returnFocusTarget]);

  async function handleReopen() {
    if (submitting) return;
    setSubmitting(true);
    setError('');

    try {
      const response = await fetch(`/api/v1/albums/${albumId}/rounds/reopen`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: requestIdRef.current,
          inviteId: submission.inviteId,
          guestId: submission.guestId,
          expectedRoundNo: submission.currentRoundNo,
        }),
      });

      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsed = errorCode.safeParse(body);
        const code = parsed.success ? parsed.data.error.code : '';
        setError(
          code === 'ROUND_NOT_SUBMITTED'
            ? '此相簿挑片輪次尚未提交，無法重開。'
            : code === 'ROUND_CONFLICT'
              ? '輪次狀態已變更，請重新整理頁面。'
              : code === 'RESOURCE_NOT_EDITABLE'
                ? '相簿或專案已封存，無法重開輪次。'
                : '重開失敗，請重試。',
        );
        return;
      }

      ownerRoundReopenResponseSchema.parse(body);
      completedRef.current = true;
      onSuccess();
    } catch {
      setError('伺服器連線異常，請稍後重試。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reopen-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3
          id="reopen-modal-title"
          className="text-lg font-semibold text-stone-900"
        >
          確認重開挑片輪次？
        </h3>
        <p className="mt-3 text-sm text-stone-600">
          重開挑片後，將為此訪客建立第{' '}
          <strong className="text-stone-900">
            {submission.currentRoundNo + 1}
          </strong>{' '}
          輪挑片。訪客將可再次進入挑片畫面修改或追加照片。
        </p>
        <p className="mt-2 text-xs text-stone-500">
          第 {submission.roundNo} 輪的提交紀錄（{submission.selectedCount}{' '}
          張照片）與時間戳記將永久保留，不會被刪除或覆寫。
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            className="text-xs py-1.5 px-3"
            onClick={onClose}
            disabled={submitting}
            data-autofocus="true"
          >
            取消
          </Button>
          <Button
            type="button"
            className="text-xs py-1.5 px-3 bg-amber-600 text-white hover:bg-amber-700"
            onClick={() => void handleReopen()}
            disabled={submitting}
          >
            {submitting ? '重開中…' : '確認重開'}
          </Button>
        </div>
      </div>
    </div>
  );
}
