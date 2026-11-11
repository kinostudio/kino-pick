import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { KinoLogo } from './kino-logo';

const providerSchema = z.enum(['google', 'github']);
const sessionSchema = z.object({
  user: z.object({ name: z.string(), email: z.string() }),
  session: z.object({ expiresAt: z.string() }),
});
const providerSnapshotSchema = z.object({
  providers: z.array(
    z.object({
      provider: providerSchema,
      configured: z.boolean(),
      linked: z.boolean(),
      canUnlink: z.boolean(),
    }),
  ),
  fresh: z.boolean(),
});
const linkResponseSchema = z.object({ url: z.string() });
const unlinkResponseSchema = z.object({ status: z.literal(true) });
const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });

type Provider = z.infer<typeof providerSchema>;
type ProviderStatus = z.infer<
  typeof providerSnapshotSchema
>['providers'][number];
type ProviderSnapshot = z.infer<typeof providerSnapshotSchema>;
type Account = {
  name: string;
  email: string;
  expiresAt: string;
} & ProviderSnapshot;

const providerNames: Record<Provider, string> = {
  google: 'Google',
  github: 'GitHub',
};
const apiErrorMessages: Record<string, string> = {
  AUTH_REQUIRED: '登入已失效，請重新登入。',
  OWNER_REQUIRED: '只有工作空間管理者可以管理登入來源。',
  SESSION_NOT_FRESH: '請先登出並重新登入，再管理登入來源。',
  LAST_LOGIN_PROVIDER: '至少要保留一種登入來源，無法解除這個來源。',
  PROVIDER_NOT_CONFIGURED: '這種登入來源目前尚未設定。',
  ACCOUNT_LINK_FAILED: '登入來源連結未完成，請稍後再試。',
};
const genericError = '目前無法完成操作，請重新讀取帳號後再試。';

async function readApiError(response: Response) {
  const parsed = apiErrorSchema.safeParse(
    await response.json().catch(() => null),
  );
  const code = parsed.success ? parsed.data.error.code : '';
  return {
    code,
    message: apiErrorMessages[code] ?? genericError,
  };
}

async function readProviderSnapshot(
  signal?: AbortSignal,
): Promise<ProviderSnapshot> {
  const response = await fetch('/api/v1/account/providers', {
    credentials: 'same-origin',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error((await readApiError(response)).message);
  const parsed = providerSnapshotSchema.safeParse(
    await response.json().catch(() => null),
  );
  if (!parsed.success) throw new Error(genericError);
  return parsed.data;
}

function safeOAuthUrl(value: string): string | null {
  try {
    const url = new URL(value, window.location.origin);
    const localHost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(
      window.location.hostname,
    );
    const localHttp =
      url.protocol === 'http:' &&
      url.origin === window.location.origin &&
      localHost;
    if (
      url.username ||
      url.password ||
      (url.protocol !== 'https:' && !localHttp)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

function ProviderIcon({ provider }: { provider: Provider }) {
  return provider === 'google' ? (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 48 48">
      <path
        fill="#4285F4"
        d="M43.6 24.5c0-1.4-.1-2.7-.4-4H24v7.6h11c-.5 2.5-1.9 4.7-4 6.2v5.1h6.5c3.8-3.5 6.1-9.1 6.1-14.9Z"
      />
      <path
        fill="#34A853"
        d="M24 44c5.4 0 10-1.8 13.4-4.8l-6.5-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.9v5.3C9.2 39.6 16 44 24 44Z"
      />
      <path
        fill="#FBBC05"
        d="M12.6 27.7c-.4-1.2-.7-2.4-.7-3.7s.2-2.6.7-3.7V15H5.9C4.7 17.7 4 20.8 4 24s.7 6.3 1.9 9l6.7-5.3Z"
      />
      <path
        fill="#EA4335"
        d="M24 11.9c2.9 0 5.5 1 7.6 3l5.7-5.7C33.9 6 29.4 4 24 4 16 4 9.2 8.4 5.9 15l6.7 5.3c1.6-4.8 6.1-8.4 11.4-8.4Z"
      />
    </svg>
  ) : (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.9 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.2 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1 .8 2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z"
      />
    </svg>
  );
}

export function StudioAccountPage() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; value: Account }
  >({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    const query = new URLSearchParams(window.location.search);
    const linkResult = query.get('link');
    if (
      linkResult === 'error' ||
      query.has('error') ||
      query.has('error_description')
    )
      return {
        kind: 'error',
        text: '登入來源連結未完成，請稍後再試。',
      };
    return linkResult === 'success'
      ? {
          kind: 'success',
          text: '登入來源已完成連結，請確認下方目前狀態。',
        }
      : null;
  });
  const actionInFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(window.location.search);
    if (
      query.has('link') ||
      query.has('error') ||
      query.has('error_description')
    ) {
      query.delete('link');
      query.delete('error');
      query.delete('error_description');
      const search = query.toString();
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
      );
    }

    void (async () => {
      try {
        const sessionResponse = await fetch('/api/auth/get-session', {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!sessionResponse.ok)
          throw new Error((await readApiError(sessionResponse)).message);
        const session = sessionSchema.safeParse(
          await sessionResponse.json().catch(() => null),
        );
        if (!session.success) throw new Error(genericError);
        const providers = await readProviderSnapshot(controller.signal);
        if (!controller.signal.aborted) {
          setState({
            status: 'ready',
            value: {
              name: session.data.user.name,
              email: session.data.user.email,
              expiresAt: session.data.session.expiresAt,
              ...providers,
            },
          });
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            status: 'error',
            message:
              error instanceof Error && error.name === 'Error'
                ? error.message
                : genericError,
          });
      }
    })();
    return () => controller.abort();
  }, [revision]);

  async function manageProvider(
    provider: ProviderStatus,
    action: 'link' | 'unlink' | 'reauth',
  ) {
    if (
      actionInFlight.current ||
      state.status !== 'ready' ||
      (action !== 'reauth' && !state.value.fresh) ||
      (action === 'link' && (provider.linked || !provider.configured)) ||
      (action === 'unlink' && (!provider.linked || !provider.canUnlink)) ||
      (action === 'reauth' &&
        (state.value.fresh || !provider.linked || !provider.configured))
    )
      return;
    if (
      action === 'unlink' &&
      !window.confirm(`確定解除 ${providerNames[provider.provider]} 登入來源？`)
    )
      return;

    actionInFlight.current = true;
    setBusyProvider(provider.provider);
    setNotice(null);
    let unlinkCompleted = false;
    try {
      const response = await fetch(
        action === 'reauth'
          ? '/api/auth/sign-in/social'
          : `/api/v1/account/providers/${provider.provider}/${action}`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            action === 'reauth'
              ? {
                  provider: provider.provider,
                  callbackURL: `${window.location.origin}/dashboard/account`,
                  disableRedirect: true,
                }
              : {},
          ),
        },
      );
      if (!response.ok) {
        const apiError = await readApiError(response);
        if (apiError.code === 'SESSION_NOT_FRESH')
          setState((current) =>
            current.status === 'ready'
              ? { ...current, value: { ...current.value, fresh: false } }
              : current,
          );
        throw new Error(apiError.message);
      }

      const body = await response.json().catch(() => null);
      if (action !== 'unlink') {
        const result = linkResponseSchema.safeParse(body);
        const url = result.success ? safeOAuthUrl(result.data.url) : null;
        if (!url)
          throw new Error(
            action === 'reauth'
              ? '重新驗證未完成，請稍後再試。'
              : '登入來源網址無效，請重新讀取帳號後再試。',
          );
        window.location.assign(url);
        return;
      }

      if (!unlinkResponseSchema.safeParse(body).success)
        throw new Error('解除登入來源未完成，請重新讀取帳號後再試。');
      unlinkCompleted = true;
      const providers = await readProviderSnapshot();
      setState((current) =>
        current.status === 'ready'
          ? { ...current, value: { ...current.value, ...providers } }
          : current,
      );
      setNotice({ kind: 'success', text: '登入來源已解除連結。' });
    } catch (error) {
      if (unlinkCompleted) {
        setState({
          status: 'error',
          message: '登入來源已解除連結，但無法讀取最新狀態，請重新讀取帳號。',
        });
      } else {
        setNotice({
          kind: 'error',
          text:
            error instanceof Error && error.name === 'Error'
              ? error.message
              : genericError,
        });
      }
    } finally {
      actionInFlight.current = false;
      setBusyProvider(null);
    }
  }

  return (
    <main className="studio-page mx-auto max-w-4xl px-6 py-12">
      <header>
        <p className="studio-eyebrow">ACCOUNT / IDENTITY</p>
        <h1>帳號與登入</h1>
        <p className="studio-lead">
          同一個 Kino Pick 身分，管理你的工作空間與專案。
        </p>
      </header>
      {notice && (
        <p
          className={`studio-account-notice is-${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      {state.status === 'loading' && <p role="status">正在讀取帳號…</p>}
      {state.status === 'error' && (
        <section className="studio-account-card">
          <p role="alert">{state.message}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' });
              setRevision((value) => value + 1);
            }}
          >
            重新讀取帳號
          </button>
        </section>
      )}
      {state.status === 'ready' && (
        <>
          <section className="studio-account-card">
            <div className="studio-account-identity">
              <KinoLogo />
              <div>
                <small>目前登入身分</small>
                <h2>
                  {state.value.name === 'Owner' ? '管理員' : state.value.name}
                </h2>
                <p>
                  {state.value.email.endsWith('@bootstrap.invalid')
                    ? '工作空間管理者'
                    : state.value.email}
                </p>
              </div>
            </div>
            <dl>
              <div>
                <dt>帳號權限</dt>
                <dd>管理者</dd>
              </div>
              <div>
                <dt>此登入有效期限</dt>
                <dd>
                  {Number.isNaN(Date.parse(state.value.expiresAt))
                    ? '無法顯示'
                    : new Date(state.value.expiresAt).toLocaleString('zh-TW')}
                </dd>
              </div>
            </dl>
          </section>
          <section className="studio-account-card">
            <h2>登入來源</h2>
            <p className="studio-lead">
              連結後可使用 Google 或 GitHub 登入同一個 Kino Pick 帳號。
            </p>
            {!state.value.fresh && (
              <p className="studio-account-freshness" role="status">
                請重新驗證身分，再管理登入來源；你也可以先登出再重新登入。
              </p>
            )}
            <ul className="studio-account-providers">
              {state.value.providers.map((provider) => (
                <li className="studio-account-provider" key={provider.provider}>
                  <div className="studio-account-provider-name">
                    <ProviderIcon provider={provider.provider} />
                    <span>{providerNames[provider.provider]}</span>
                  </div>
                  <div className="studio-account-provider-action">
                    <span
                      className={`studio-account-provider-status${provider.linked ? ' is-linked' : ''}`}
                    >
                      {provider.linked
                        ? '已連結'
                        : provider.configured
                          ? '可連結'
                          : '尚未設定'}
                    </span>
                    {!state.value.fresh &&
                    provider.linked &&
                    provider.configured ? (
                      <button
                        type="button"
                        className="studio-account-button is-secondary"
                        disabled={busyProvider !== null}
                        onClick={() => void manageProvider(provider, 'reauth')}
                      >
                        {busyProvider === provider.provider
                          ? '前往驗證…'
                          : '重新驗證身分'}
                      </button>
                    ) : provider.linked ? (
                      provider.canUnlink ? (
                        <button
                          type="button"
                          className="studio-account-button is-secondary"
                          disabled={busyProvider !== null || !state.value.fresh}
                          onClick={() =>
                            void manageProvider(provider, 'unlink')
                          }
                        >
                          {busyProvider === provider.provider
                            ? '處理中…'
                            : '解除連結'}
                        </button>
                      ) : (
                        <span className="studio-account-provider-hint">
                          請至少保留一種登入來源
                        </span>
                      )
                    ) : provider.configured ? (
                      <button
                        type="button"
                        className="studio-account-button"
                        disabled={busyProvider !== null || !state.value.fresh}
                        onClick={() => void manageProvider(provider, 'link')}
                      >
                        {busyProvider === provider.provider
                          ? '處理中…'
                          : '連結'}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {state.value.providers.length === 0 && (
              <p>目前沒有可管理的登入來源。</p>
            )}
            <p className="studio-account-note">
              解除連結前會再次確認；至少要保留一種登入來源才能繼續登入。
            </p>
          </section>
        </>
      )}
    </main>
  );
}
