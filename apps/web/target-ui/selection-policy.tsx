'use client';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ownerSelectionPolicyReadSchema,
  setSelectionPolicyResultSchema,
  type OwnerSelectionPolicyRead,
} from '../../../packages/contracts/src/selection-policy';

type PolicyRead =
  | {
      status: 'ready';
      albumId: string;
      sequence: number;
      value: OwnerSelectionPolicyRead;
    }
  | { status: 'disabled'; albumId: string; sequence: number }
  | { status: 'error'; albumId: string; sequence: number; message: string };

type Draft = { albumId: string; minimum: string; maximum: string };
type PreservedDraft = Draft | null;
type ReloadState = {
  sequence: number;
  preserve: PreservedDraft;
  notice: string;
};
type ConfirmSnapshot = {
  albumId: string;
  readSequence: number;
  expectedRevision: number;
  minimum: number;
  maximum: number | null;
};
type PolicyIntent = {
  albumId: string;
  requestId: string;
  body: string;
  minimum: number;
  maximum: number | null;
  expectedRevision: number;
};
type PolicyConflict = { albumId: string; message: string };

function integerValue(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 100000
    ? value
    : null;
}

function maximumValue(raw: string): number | null | 'invalid' {
  if (raw.trim() === '') return null;
  return integerValue(raw) ?? 'invalid';
}

function errorCode(value: unknown) {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return '';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}

function addUnresolvedBeforeUnload() {
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', warn);
  return () => window.removeEventListener('beforeunload', warn);
}

export function AlbumSelectionPolicy({ albumId }: { albumId: string }) {
  const [reload, setReload] = useState<ReloadState>({
    sequence: 0,
    preserve: null,
    notice: '',
  });
  const [read, setRead] = useState<PolicyRead | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [intent, setIntent] = useState<PolicyIntent | null>(null);
  const [intentError, setIntentError] = useState('');
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PolicyConflict | null>(null);
  const [confirmSnapshot, setConfirmSnapshot] =
    useState<ConfirmSnapshot | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const intentRef = useRef<PolicyIntent | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const requestedAlbumId = albumId;
    const requestedSequence = reload.sequence;
    const requestedReload = reload;

    void fetch(
      '/api/v1/albums/' +
        encodeURIComponent(requestedAlbumId) +
        '/selection-policy',
      {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!active || controller.signal.aborted) return;
        if (response.status === 503) {
          setRead({
            status: 'disabled',
            albumId: requestedAlbumId,
            sequence: requestedSequence,
          });
          return;
        }
        if (!response.ok) {
          const code = errorCode(body);
          const message =
            response.status === 401 || code === 'OWNER_REQUIRED'
              ? '登入已失效或目前帳號沒有管理權限，請重新登入後再載入。'
              : '目前無法載入相簿挑片政策，請稍後重新整理。';
          setRead({
            status: 'error',
            albumId: requestedAlbumId,
            sequence: requestedSequence,
            message,
          });
          return;
        }

        const parsed = ownerSelectionPolicyReadSchema.safeParse(body);
        if (
          !parsed.success ||
          parsed.data.policy.albumId !== requestedAlbumId
        ) {
          setRead({
            status: 'error',
            albumId: requestedAlbumId,
            sequence: requestedSequence,
            message: '伺服器回傳的挑片政策無法驗證，請重新整理。',
          });
          return;
        }

        const preserved = requestedReload.preserve;
        setDraft((current) => {
          if (preserved?.albumId === requestedAlbumId) return preserved;
          if (current?.albumId === requestedAlbumId) return current;
          return {
            albumId: requestedAlbumId,
            minimum: String(parsed.data.policy.minimum),
            maximum:
              parsed.data.policy.maximum === null
                ? ''
                : String(parsed.data.policy.maximum),
          };
        });
        setRead({
          status: 'ready',
          albumId: requestedAlbumId,
          sequence: requestedSequence,
          value: parsed.data,
        });
        if (requestedReload.notice) {
          setConflict(null);
          setIntentError('');
        }
      })
      .catch(() => {
        if (!active || controller.signal.aborted) return;
        setRead({
          status: 'error',
          albumId: requestedAlbumId,
          sequence: requestedSequence,
          message: '目前無法載入相簿挑片政策，請稍後重新整理。',
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [albumId, reload]);

  useEffect(() => {
    if (!intent) return;
    return addUnresolvedBeforeUnload();
  }, [intent]);

  useEffect(() => {
    if (!confirmOpen) return;
    cancelButtonRef.current?.focus();
    const dialog = dialogRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmOpen(false);
        setConfirmSnapshot(null);
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      confirmTriggerRef.current?.focus();
      confirmTriggerRef.current = null;
    };
  }, [confirmOpen]);

  const currentRead =
    read?.albumId === albumId && read.sequence === reload.sequence
      ? read
      : null;
  const currentDraft = draft?.albumId === albumId ? draft : null;
  const currentConflict = conflict?.albumId === albumId ? conflict : null;
  const currentIntent = intent?.albumId === albumId ? intent : null;
  const hasOtherAlbumIntent = Boolean(intent && intent.albumId !== albumId);
  const isSending = Boolean(intent && sendingId === intent.requestId);

  function changeDraft(field: 'minimum' | 'maximum', value: string) {
    if (!currentRead || currentRead.status !== 'ready') return;
    setDraft((previous) => {
      const base =
        previous?.albumId === albumId
          ? previous
          : {
              albumId,
              minimum: String(currentRead.value.policy.minimum),
              maximum:
                currentRead.value.policy.maximum === null
                  ? ''
                  : String(currentRead.value.policy.maximum),
            };
      return { ...base, [field]: value };
    });
  }

  function beginReload(notice: string) {
    const preserved = currentDraft
      ? { ...currentDraft }
      : currentRead?.status === 'ready'
        ? {
            albumId,
            minimum: String(currentRead.value.policy.minimum),
            maximum:
              currentRead.value.policy.maximum === null
                ? ''
                : String(currentRead.value.policy.maximum),
          }
        : null;
    setReload((previous) => ({
      sequence: previous.sequence + 1,
      preserve: preserved,
      notice,
    }));
  }

  function clearIntent(attempt: PolicyIntent) {
    if (intentRef.current?.requestId !== attempt.requestId) return;
    intentRef.current = null;
    setIntent(null);
    setIntentError('');
  }

  async function sendIntent(attempt: PolicyIntent) {
    if (
      intentRef.current?.requestId !== attempt.requestId ||
      inFlightRef.current !== null
    )
      return;
    inFlightRef.current = attempt.requestId;
    setSendingId(attempt.requestId);
    setIntentError('');
    try {
      const response = await fetch(
        '/api/v1/albums/' +
          encodeURIComponent(attempt.albumId) +
          '/selection-policy',
        {
          method: 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: attempt.body,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        clearIntent(attempt);
        setConflict({
          albumId: attempt.albumId,
          message:
            '政策版本或目前仍開放的 客戶草稿已變更。草稿內容已保留；請明確重新整理目前政策後再確認。',
        });
        return;
      }
      if (!response.ok) {
        const code = errorCode(body);
        setIntentError(
          response.status === 401 || code === 'OWNER_REQUIRED'
            ? '登入可能已失效；先前設定結果仍未確認。重新登入後請重試同一設定，系統會保留原操作編號與內容。'
            : '設定結果仍未確認。請明確重試同一設定；原操作編號與內容會保持不變。',
        );
        return;
      }

      const parsed = setSelectionPolicyResultSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.policy.albumId !== attempt.albumId ||
        parsed.data.policy.minimum !== attempt.minimum ||
        parsed.data.policy.maximum !== attempt.maximum ||
        parsed.data.policy.revision < attempt.expectedRevision
      ) {
        setIntentError(
          '伺服器回應無法與原設定核對；結果仍未確認，請重試同一設定。',
        );
        return;
      }

      clearIntent(attempt);
      setDraft(null);
      setConflict(null);
      setIntentError('');
      setReload((previous) => ({
        sequence: previous.sequence + 1,
        preserve: null,
        notice: '設定已確認；已重新取得目前政策，請檢查後再編輯。',
      }));
    } catch {
      setIntentError(
        '設定結果仍未確認。請明確重試同一設定；原操作編號與內容會保持不變。',
      );
    } finally {
      if (inFlightRef.current === attempt.requestId) {
        inFlightRef.current = null;
        setSendingId(null);
      }
    }
  }

  function openConfirm(event: MouseEvent<HTMLButtonElement>) {
    if (
      !currentRead ||
      currentRead.status !== 'ready' ||
      !currentDraft ||
      intentRef.current ||
      inFlightRef.current ||
      currentConflict
    )
      return;
    const minimum = integerValue(currentDraft.minimum);
    const maximum = maximumValue(currentDraft.maximum);
    if (
      minimum === null ||
      maximum === 'invalid' ||
      (maximum !== null && maximum < minimum) ||
      (maximum !== null && maximum < currentRead.value.maxOpenSelectedCount) ||
      (minimum === currentRead.value.policy.minimum &&
        maximum === currentRead.value.policy.maximum)
    )
      return;
    confirmTriggerRef.current = event.currentTarget;
    setConfirmSnapshot({
      albumId,
      readSequence: currentRead.sequence,
      expectedRevision: currentRead.value.policy.revision,
      minimum,
      maximum,
    });
    setConfirmOpen(true);
  }

  function confirmChange() {
    const snapshot = confirmSnapshot;
    if (
      !snapshot ||
      confirmOpen === false ||
      intentRef.current !== null ||
      inFlightRef.current !== null
    )
      return;
    if (snapshot.albumId !== albumId) {
      setConfirmOpen(false);
      setConfirmSnapshot(null);
      return;
    }
    if (
      !currentRead ||
      currentRead.status !== 'ready' ||
      currentRead.sequence !== snapshot.readSequence ||
      currentRead.value.policy.revision !== snapshot.expectedRevision
    ) {
      setConfirmOpen(false);
      setConfirmSnapshot(null);
      setConflict({
        albumId: snapshot.albumId,
        message: '政策畫面已更新。草稿內容已保留；請重新取得目前政策後再確認。',
      });
      beginReload('目前政策已重新取得；原草稿已保留，請檢查後再確認。');
      return;
    }
    const requestId = crypto.randomUUID();
    const requestBody = {
      requestId,
      expectedRevision: snapshot.expectedRevision,
      minimum: snapshot.minimum,
      maximum: snapshot.maximum,
      confirm: true as const,
    };
    const attempt: PolicyIntent = {
      albumId: snapshot.albumId,
      requestId,
      body: JSON.stringify(requestBody),
      minimum: snapshot.minimum,
      maximum: snapshot.maximum,
      expectedRevision: snapshot.expectedRevision,
    };
    intentRef.current = attempt;
    setIntent(attempt);
    setConfirmSnapshot(null);
    setConfirmOpen(false);
    void sendIntent(attempt);
  }

  function retryIntent() {
    const attempt = intentRef.current;
    if (attempt && inFlightRef.current === null) void sendIntent(attempt);
  }

  const minimumText = currentDraft?.minimum ?? '';
  const maximumText = currentDraft?.maximum ?? '';
  const parsedMinimum = integerValue(minimumText);
  const parsedMaximum = maximumValue(maximumText);
  const ready = currentRead?.status === 'ready' ? currentRead : null;
  const minimumError =
    minimumText === ''
      ? '請輸入最少張數。'
      : parsedMinimum === null
        ? '請輸入 1 到 100000 之間的整數。'
        : '';
  const maximumError =
    parsedMaximum === 'invalid'
      ? '最高張數請留空或輸入 1 到 100000 之間的整數。'
      : parsedMaximum !== null &&
          parsedMinimum !== null &&
          parsedMaximum < parsedMinimum
        ? '最高張數不可少於最少張數。'
        : parsedMaximum !== null &&
            ready &&
            parsedMaximum < ready.value.maxOpenSelectedCount
          ? '最高張數不可低於目前仍開放的 客戶草稿數量。'
          : '';
  const isNoop = Boolean(
    ready &&
    parsedMinimum === ready.value.policy.minimum &&
    parsedMaximum === ready.value.policy.maximum,
  );
  const saveDisabled = Boolean(
    !ready ||
    !currentDraft ||
    intent !== null ||
    sendingId ||
    currentConflict ||
    minimumError ||
    maximumError ||
    isNoop,
  );
  const formDisabled = Boolean(
    intent || sendingId || !ready || currentConflict,
  );

  return (
    <section
      className="mt-4 min-w-0 rounded-lg border border-stone-200 bg-white p-4 sm:p-5"
      aria-labelledby={`selection-policy-heading-${albumId}`}
      data-testid={`selection-policy-${albumId}`}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4">
        <div className="min-w-0">
          <h4
            id={`selection-policy-heading-${albumId}`}
            className="text-base font-semibold text-stone-900"
          >
            訪客挑片範圍
          </h4>
          <p className="mt-1 text-sm leading-6 text-stone-600">
            每位客戶 的挑片數分開計算；其他客戶
            的選片內容不會公開。共用挑片使用獨立審查與輪次設定。
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 shrink-0 rounded border border-stone-300 px-3 py-2 text-sm text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={
            !currentRead || currentRead.status === 'disabled' || Boolean(intent)
          }
          onClick={() =>
            beginReload('目前政策已重新取得；原草稿已保留，請檢查後再確認。')
          }
        >
          {currentRead === null ? '載入中…' : '重新整理政策'}
        </button>
      </div>

      {hasOtherAlbumIntent && intent && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <p>
            另一個相簿的政策設定結果尚未確認。為避免建立新操作，請先用原操作編號與內容重試。
          </p>
          {intentError && <p className="mt-2">{intentError}</p>}
          <button
            type="button"
            className="mt-3 min-h-11 rounded border border-amber-500 px-3 py-2 font-medium disabled:opacity-50"
            onClick={retryIntent}
            disabled={isSending}
          >
            {isSending ? '正在重試…' : '重試同一設定'}
          </button>
        </div>
      )}

      {!ready && (
        <div className="mt-4" role="status" aria-live="polite">
          {read?.albumId === albumId &&
          read.sequence === reload.sequence &&
          read.status === 'error' ? (
            <div role="alert" className="text-sm text-red-800">
              <p>{read.message}</p>
              <button
                type="button"
                className="mt-3 min-h-11 rounded border border-stone-300 px-3 py-2 text-sm"
                onClick={() => beginReload('')}
              >
                重新載入
              </button>
            </div>
          ) : read?.albumId === albumId &&
            read.sequence === reload.sequence &&
            read.status === 'disabled' ? (
            <div
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="selection-policy-unavailable"
            >
              相簿挑片政策目前無法使用。此功能尚未啟用，設定不會送出。
            </div>
          ) : (
            <p>載入挑片政策中…</p>
          )}
        </div>
      )}

      {ready && (
        <div className="mt-4 min-w-0 space-y-4">
          {reload.notice && (
            <p
              role="status"
              className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
            >
              {reload.notice}
            </p>
          )}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <p className="min-w-0 rounded-md bg-stone-50 p-3 text-sm text-stone-700">
              目前政策：最少 {ready.value.policy.minimum} 張，最高{' '}
              {ready.value.policy.maximum === null
                ? '不限'
                : `${ready.value.policy.maximum} 張`}
            </p>
            <p
              className="min-w-0 rounded-md bg-stone-50 p-3 text-sm text-stone-700"
              data-testid="selection-policy-open-draft-count"
            >
              目前仍開放的 客戶草稿最高選取數：
              {ready.value.maxOpenSelectedCount} 張
            </p>
          </div>

          {currentConflict && (
            <div
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <p>{currentConflict.message}</p>
              <button
                type="button"
                className="mt-3 min-h-11 rounded border border-amber-500 px-3 py-2 font-medium"
                onClick={() =>
                  beginReload(
                    '目前政策已重新取得；原草稿已保留，請檢查後再確認。',
                  )
                }
              >
                重新取得政策並保留草稿
              </button>
            </div>
          )}

          {currentIntent && (
            <div
              role="alert"
              className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
              data-testid="selection-policy-uncertain"
            >
              <p>
                {intentError ||
                  '設定結果尚未確認。請重試同一設定；原操作編號與內容會保持不變。'}
              </p>
              <button
                type="button"
                className="mt-3 min-h-11 rounded border border-amber-500 px-3 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                onClick={retryIntent}
                disabled={isSending}
              >
                {isSending ? '正在重試…' : '重試同一設定'}
              </button>
            </div>
          )}

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label
                htmlFor={`selection-policy-minimum-${albumId}`}
                className="block text-sm font-medium text-stone-800"
              >
                最少張數
              </label>
              <input
                id={`selection-policy-minimum-${albumId}`}
                data-testid="selection-policy-minimum"
                type="number"
                inputMode="numeric"
                min={1}
                max={100000}
                step={1}
                value={minimumText}
                disabled={formDisabled}
                aria-invalid={Boolean(minimumError)}
                aria-describedby={`selection-policy-minimum-help-${albumId}`}
                onChange={(event) => changeDraft('minimum', event.target.value)}
                className="mt-1 min-h-11 w-full min-w-0 rounded border border-stone-300 px-3 py-2 text-base disabled:bg-stone-100"
              />
              <p
                id={`selection-policy-minimum-help-${albumId}`}
                className="mt-1 text-xs text-stone-600"
              >
                請輸入 1 到 100000 張。
              </p>
              {minimumError && (
                <p className="mt-1 text-sm text-red-800">{minimumError}</p>
              )}
            </div>
            <div className="min-w-0">
              <label
                htmlFor={`selection-policy-maximum-${albumId}`}
                className="block text-sm font-medium text-stone-800"
              >
                最高張數（留空代表不限）
              </label>
              <input
                id={`selection-policy-maximum-${albumId}`}
                data-testid="selection-policy-maximum"
                type="number"
                inputMode="numeric"
                min={1}
                max={100000}
                step={1}
                value={maximumText}
                disabled={formDisabled}
                aria-invalid={Boolean(maximumError)}
                aria-describedby={`selection-policy-maximum-help-${albumId}`}
                onChange={(event) => changeDraft('maximum', event.target.value)}
                className="mt-1 min-h-11 w-full min-w-0 rounded border border-stone-300 px-3 py-2 text-base disabled:bg-stone-100"
              />
              <p
                id={`selection-policy-maximum-help-${albumId}`}
                className="mt-1 text-xs text-stone-600"
              >
                最高張數不得低於目前仍開放 Guest 草稿的最高選取數。
              </p>
              {maximumError && (
                <p className="mt-1 text-sm text-red-800">{maximumError}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
            <button
              type="button"
              className="min-h-11 rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={saveDisabled}
              onClick={openConfirm}
            >
              確認政策變更
            </button>
            {isNoop && !intent && !currentConflict && (
              <span className="text-sm text-stone-600">
                目前草稿與政策相同。
              </span>
            )}
          </div>
        </div>
      )}

      {confirmOpen && confirmSnapshot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`selection-policy-confirm-title-${albumId}`}
            className="my-auto w-full max-w-lg rounded-lg bg-white p-5 shadow-xl"
          >
            <h5
              id={`selection-policy-confirm-title-${albumId}`}
              className="text-lg font-semibold text-stone-900"
            >
              確認變更挑片政策？
            </h5>
            <p className="mt-3 text-sm leading-6 text-stone-700">
              此政策會分別套用在每位客戶 的私有挑片；不會公開或合併不同 Guest
              的選片。共用挑片使用獨立審查與輪次設定。
            </p>
            <p className="mt-3 rounded bg-stone-50 p-3 text-sm text-stone-800">
              最少 {confirmSnapshot.minimum} 張，最高{' '}
              {confirmSnapshot.maximum === null
                ? '不限'
                : `${confirmSnapshot.maximum} 張`}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                ref={cancelButtonRef}
                type="button"
                className="min-h-11 rounded border border-stone-300 px-4 py-2 text-sm"
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmSnapshot(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="min-h-11 rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white"
                onClick={confirmChange}
              >
                確認套用政策
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
