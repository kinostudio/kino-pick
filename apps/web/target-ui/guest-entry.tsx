import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  guestAlbumAccessSchema,
  guestExchangeCapabilitiesSchema,
  guestExchangeRequestSchema,
  guestPasswordSchema,
} from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
import { z } from 'zod';
import { getGuestDownloadsPage } from './guest-downloads';

export type GuestEntryCredential = {
  token: string | null;
  invalid: boolean;
};

const guestExchangeResponseSchema = z
  .object({
    authenticated: z.literal(true),
    expiresAt: z.iso.datetime(),
  })
  .strict();
const guestDeniedResponseSchema = z
  .object({
    error: z.object({ code: z.literal('GUEST_ACCESS_REQUIRED') }).strict(),
  })
  .strict();

/**
 * Consume a bearer token only on the exact Guest entry route.
 *
 * main.tsx calls this once before rendering React. The fragment and any query
 * string are then removed from the address bar before the page can make API
 * requests or load further resources.
 */
export function consumeGuestEntryFragment(): GuestEntryCredential {
  if (typeof window === 'undefined') return { token: null, invalid: false };

  const isExactEntryRoute = /^\/guest\/albums\/[^/]+\/enter$/.test(
    window.location.pathname,
  );
  if (!isExactEntryRoute) return { token: null, invalid: false };

  const fragment = window.location.hash;
  const match = /^#token=([a-f0-9]{64})$/.exec(fragment);
  const token = match?.[1] ?? null;
  const credential: GuestEntryCredential =
    fragment.length === 0
      ? { token: null, invalid: false }
      : token
        ? { token, invalid: false }
        : { token: null, invalid: true };

  window.history.replaceState(null, '', window.location.pathname);
  return credential;
}

type CapabilityState = 'loading' | 'enabled' | 'disabled' | 'unavailable';
type AttemptState = 'idle' | 'pending' | 'unknown' | 'denied' | 'success';
type AccessCheckState = 'idle' | 'checking' | 'denied' | 'failed';

export function GuestEntryPage({
  albumId,
  credential,
}: {
  albumId: string;
  credential: GuestEntryCredential;
}) {
  const titleId = useId();
  const displayNameId = useId();
  const passwordId = useId();
  const albumIdIsValid = z.uuid().safeParse(albumId).success;
  const [capability, setCapability] = useState<CapabilityState>(
    albumIdIsValid ? 'loading' : 'unavailable',
  );
  const submitLock = useRef(false);
  const allowNavigation = useRef(false);
  const beforeUnloadHandler = useRef<
    ((event: BeforeUnloadEvent) => void) | null
  >(null);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [attemptState, setAttemptState] = useState<AttemptState>('idle');
  const [attemptMessage, setAttemptMessage] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [accessCheckState, setAccessCheckState] =
    useState<AccessCheckState>('idle');
  const [accessMessage, setAccessMessage] = useState('');

  useEffect(() => {
    if (!albumIdIsValid) return;

    const controller = new AbortController();
    void fetch('/api/guest/capabilities', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('CAPABILITIES_UNAVAILABLE');
        const body: unknown = await response.json();
        const parsed = guestExchangeCapabilitiesSchema.safeParse(body);
        if (!parsed.success) throw new Error('CAPABILITIES_UNAVAILABLE');
        if (controller.signal.aborted) return;
        setCapability(parsed.data.exchangeEnabled ? 'enabled' : 'disabled');
      })
      .catch(() => {
        if (!controller.signal.aborted) setCapability('unavailable');
      });
    return () => controller.abort();
  }, [albumIdIsValid]);

  useEffect(() => {
    if (attemptState !== 'pending' && attemptState !== 'unknown') return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (allowNavigation.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    beforeUnloadHandler.current = warnBeforeLeaving;
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      if (beforeUnloadHandler.current === warnBeforeLeaving)
        beforeUnloadHandler.current = null;
    };
  }, [attemptState]);

  function navigateToAuthorizedAlbum() {
    allowNavigation.current = true;
    const handler = beforeUnloadHandler.current;
    if (handler !== null) {
      window.removeEventListener('beforeunload', handler);
      beforeUnloadHandler.current = null;
    }
    window.location.replace('/guest/albums/' + encodeURIComponent(albumId));
  }

  async function submitExchange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !albumIdIsValid ||
      credential.invalid ||
      !credential.token ||
      capability !== 'enabled' ||
      attemptState === 'pending' ||
      attemptState === 'unknown' ||
      attemptState === 'success' ||
      submitLock.current
    ) {
      return;
    }

    setFormMessage('');
    setAttemptMessage('');
    if (
      password.length > 0 &&
      !guestPasswordSchema.safeParse(password).success
    ) {
      setFormMessage('密碼長度或格式不符合要求，請確認後再送出。');
      return;
    }

    let requestId: string;
    try {
      requestId = crypto.randomUUID();
    } catch {
      setFormMessage('目前無法建立安全的登入要求，請重新載入後再試。');
      return;
    }

    const candidate = {
      requestId,
      token: credential.token,
      displayName,
      ...(password.length > 0 ? { password } : {}),
    };
    const parsedRequest = guestExchangeRequestSchema.safeParse(candidate);
    if (!parsedRequest.success) {
      setFormMessage('請輸入有效的訪客名稱。');
      return;
    }

    submitLock.current = true;
    setAttemptState('pending');
    try {
      const response = await fetch('/api/guest/exchange', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsedRequest.data),
      });

      if (response.status === 401) {
        const body: unknown = await response.json().catch(() => null);
        if (guestDeniedResponseSchema.safeParse(body).success) {
          submitLock.current = false;
          setPassword('');
          setAttemptState('denied');
          setAttemptMessage(
            '無法驗證目前提供的資訊。請確認訪客名稱與密碼，再由您明確重新送出。',
          );
          return;
        }
        setAttemptState('unknown');
        setAttemptMessage(
          '這次嘗試的結果尚未確認。為避免重複建立授權，輸入內容已鎖定；請先檢查目前授權。',
        );
        return;
      }

      if (response.status >= 500) {
        setAttemptState('unknown');
        setAttemptMessage(
          '這次嘗試的結果尚未確認，可能已消耗邀請使用次數。為避免重複建立授權，輸入內容已鎖定；請先檢查目前授權。',
        );
        return;
      }

      if (response.status >= 400 && response.status < 500) {
        submitLock.current = false;
        setPassword('');
        setAttemptState('denied');
        setAttemptMessage(
          '無法驗證目前提供的資訊。請確認訪客名稱與密碼，再由您明確重新送出。',
        );
        return;
      }

      if (response.status !== 200) {
        setAttemptState('unknown');
        setAttemptMessage(
          '這次嘗試的結果尚未確認。為避免重複建立授權，輸入內容已鎖定；請先檢查目前授權。',
        );
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const parsedResponse = guestExchangeResponseSchema.safeParse(body);
      if (!parsedResponse.success) {
        setAttemptState('unknown');
        setAttemptMessage(
          '這次嘗試的結果尚未確認，可能已消耗邀請使用次數。為避免重複建立授權，輸入內容已鎖定；請先檢查目前授權。',
        );
        return;
      }

      setPassword('');
      setAttemptState('success');
      navigateToAuthorizedAlbum();
    } catch {
      setAttemptState('unknown');
      setAttemptMessage(
        '這次嘗試的結果尚未確認，可能已消耗邀請使用次數。為避免重複建立授權，輸入內容已鎖定；請先檢查目前授權。',
      );
    }
  }

  async function checkCurrentAccess() {
    if (
      !albumIdIsValid ||
      accessCheckState === 'checking' ||
      attemptState === 'success'
    ) {
      return;
    }
    setAccessCheckState('checking');
    setAccessMessage('');
    try {
      const response = await fetch(
        '/api/guest/albums/' + encodeURIComponent(albumId) + '/access',
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: { Accept: 'application/json' },
        },
      );
      if (response.status === 401) {
        try {
          const downloads = await getGuestDownloadsPage(albumId);
          const hasDownloadPermission =
            downloads.access.permissions.can_download_preview ||
            downloads.access.permissions.can_download_original;
          if (
            hasDownloadPermission &&
            Date.parse(downloads.access.expiresAt) > Date.now()
          ) {
            setPassword('');
            setAttemptState('success');
            navigateToAuthorizedAlbum();
            return;
          }
        } catch {
          // The download catalogue is an independent optional authorization path.
          // Keep the existing access-denied recovery when it is unavailable.
        }
        setAccessCheckState('denied');
        setAccessMessage(
          '目前瀏覽器沒有可用的訪客授權。請重新開啟攝影師提供的完整邀請連結；若仍無法進入，請聯絡攝影師。已清除的邀請憑證無法由此頁還原。',
        );
        return;
      }
      if (!response.ok) throw new Error('ACCESS_CHECK_UNAVAILABLE');

      const body: unknown = await response.json();
      const parsed = z
        .object({ access: guestAlbumAccessSchema })
        .strict()
        .safeParse(body);
      if (
        !parsed.success ||
        parsed.data.access.albumId !== albumId ||
        parsed.data.access.permissions.can_view !== true
      ) {
        throw new Error('ACCESS_CHECK_UNAVAILABLE');
      }

      setPassword('');
      setAttemptState('success');
      navigateToAuthorizedAlbum();
    } catch {
      setAccessCheckState('failed');
      setAccessMessage(
        '目前無法檢查授權。這項唯讀檢查不會送出新的登入要求，您可以明確重試。',
      );
    } finally {
      setAccessCheckState((current) =>
        current === 'checking' ? 'idle' : current,
      );
    }
  }

  const hasCredential = credential.token !== null && !credential.invalid;
  const canSubmit =
    albumIdIsValid &&
    hasCredential &&
    capability === 'enabled' &&
    attemptState !== 'pending' &&
    attemptState !== 'unknown' &&
    attemptState !== 'success';
  const showAccessCheck =
    !credential.token || credential.invalid || attemptState === 'unknown';

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-12">
      <section
        aria-labelledby={titleId}
        className="mx-auto w-full max-w-lg rounded-xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8"
      >
        <p className="text-sm text-stone-600">奇諾影像 Kino Pick</p>
        <h1
          id={titleId}
          className="mt-2 text-2xl font-semibold tracking-tight text-stone-900"
        >
          開啟受邀相簿
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          請使用攝影師提供的完整邀請連結，並輸入您的訪客名稱。
        </p>

        {!albumIdIsValid && (
          <p
            role="alert"
            className="mt-5 rounded-md bg-amber-50 p-3 text-sm text-amber-900"
          >
            找不到這個相簿入口。請重新開啟攝影師提供的連結。
          </p>
        )}

        {credential.invalid && (
          <p
            role="alert"
            className="mt-5 rounded-md bg-amber-50 p-3 text-sm text-amber-900"
          >
            邀請連結格式無法辨識。請重新開啟攝影師提供的完整邀請連結。
          </p>
        )}

        {!credential.token && !credential.invalid && (
          <p
            role="status"
            className="mt-5 rounded-md bg-stone-100 p-3 text-sm leading-6 text-stone-700"
          >
            這個網址沒有可用的邀請憑證。若您曾在此瀏覽器完成驗證，可以檢查目前授權；若尚未驗證，請重新開啟攝影師提供的完整邀請連結，或聯絡攝影師。
          </p>
        )}

        {hasCredential && capability === 'loading' && (
          <p role="status" className="mt-5 text-sm text-stone-600">
            正在確認訪客入口…
          </p>
        )}

        {capability === 'disabled' && (
          <p
            role="alert"
            className="mt-5 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-900"
          >
            訪客入口目前無法提供新的登入。請稍後重試或聯絡攝影師。
          </p>
        )}

        {capability === 'unavailable' && albumIdIsValid && (
          <p
            role="alert"
            className="mt-5 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-900"
          >
            目前無法確認訪客入口是否可用。請稍後重新開啟連結。
          </p>
        )}

        {hasCredential && capability === 'enabled' && (
          <form className="mt-6 space-y-4" onSubmit={submitExchange}>
            <div>
              <label
                htmlFor={displayNameId}
                className="mb-1.5 block text-sm font-medium text-stone-800"
              >
                訪客名稱
              </label>
              <input
                id={displayNameId}
                type="text"
                value={displayName}
                maxLength={160}
                autoComplete="name"
                required
                disabled={!canSubmit}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:bg-stone-100"
              />
              <p className="mt-1 text-xs leading-5 text-stone-500">
                名稱最多 80 個 Unicode 字元。
              </p>
            </div>

            <div>
              <label
                htmlFor={passwordId}
                className="mb-1.5 block text-sm font-medium text-stone-800"
              >
                邀請密碼（若有）
              </label>
              <input
                id={passwordId}
                type="password"
                value={password}
                autoComplete="off"
                disabled={!canSubmit}
                onChange={(event) => setPassword(event.currentTarget.value)}
                className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-amber-700 disabled:bg-stone-100"
                aria-describedby="guest-entry-password-help"
              />
              <p
                id="guest-entry-password-help"
                className="mt-1 text-xs leading-5 text-stone-500"
              >
                若邀請不需要密碼，請留空；需要密碼時請照原樣輸入。
              </p>
            </div>

            {formMessage && (
              <p role="alert" className="text-sm text-red-800">
                {formMessage}
              </p>
            )}

            {attemptMessage && (
              <p
                role="alert"
                className={
                  attemptState === 'unknown'
                    ? 'rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-950'
                    : 'rounded-md bg-red-50 p-3 text-sm leading-6 text-red-900'
                }
              >
                {attemptMessage}
              </p>
            )}

            <Button type="submit" disabled={!canSubmit} className="w-full">
              {attemptState === 'pending' ? '正在確認…' : '進入相簿'}
            </Button>

            {attemptState === 'unknown' && (
              <p className="text-sm leading-6 text-stone-700">
                請勿重新送出本次要求。邀請使用次數可能已被消耗；若目前瀏覽器沒有授權，請重新開啟完整邀請連結或聯絡攝影師。
              </p>
            )}
          </form>
        )}

        {attemptMessage && !hasCredential && (
          <p
            role="alert"
            className="mt-5 rounded-md bg-amber-50 p-3 text-sm leading-6 text-amber-950"
          >
            {attemptMessage}
          </p>
        )}

        {showAccessCheck && albumIdIsValid && (
          <div className="mt-6 border-t border-stone-200 pt-5">
            {accessMessage && (
              <p
                role={accessCheckState === 'denied' ? 'alert' : 'status'}
                className="mb-3 rounded-md bg-stone-100 p-3 text-sm leading-6 text-stone-700"
              >
                {accessMessage}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={accessCheckState === 'checking'}
              onClick={() => void checkCurrentAccess()}
            >
              {accessCheckState === 'checking' ? '正在檢查…' : '檢查目前授權'}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
