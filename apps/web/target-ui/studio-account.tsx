import { useEffect, useState } from 'react';
import { z } from 'zod';
import { KinoLogo } from './kino-logo';
const sessionSchema = z.object({
  user: z.object({ name: z.string(), email: z.string() }),
  session: z.object({ expiresAt: z.string() }),
});
const providersSchema = z.object({
  providers: z.array(z.enum(['google', 'github'])),
});
type Account = {
  name: string;
  email: string;
  expiresAt: string;
  providers: ('google' | 'github')[];
};
export function StudioAccountPage() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; value: Account }
  >({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch('/api/auth/get-session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      }),
      fetch('/api/oauth/providers', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      }),
    ])
      .then(async ([session, providers]) => {
        if (!session.ok || !providers.ok) throw new Error('unavailable');
        const [s, p] = await Promise.all([session.json(), providers.json()]);
        const account = sessionSchema.parse(s);
        const configured = providersSchema.parse(p);
        if (!controller.signal.aborted)
          setState({
            status: 'ready',
            value: {
              name: account.user.name,
              email: account.user.email,
              expiresAt: account.session.expiresAt,
              providers: configured.providers,
            },
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [revision]);
  return (
    <main className="studio-page mx-auto max-w-4xl px-6 py-12">
      <header>
        <p className="studio-eyebrow">ACCOUNT / IDENTITY</p>
        <h1>帳號與登入</h1>
        <p className="studio-lead">
          同一個 Kino Pick 身分，管理你的工作空間與專案。
        </p>
      </header>
      {state.status === 'loading' && <p role="status">正在讀取帳號…</p>}
      {state.status === 'error' && (
        <section className="studio-account-card">
          <p role="alert">
            目前無法讀取帳號，請重新整理；登入失效時請重新登入。
          </p>
          <button
            type="button"
            onClick={() => {
              setState({ status: 'loading' });
              setRevision((x) => x + 1);
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
                <h2>{state.value.name}</h2>
                <p>{state.value.email}</p>
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
            <h2>可用的登入來源</h2>
            <p className="studio-lead">僅顯示目前服務已設定的登入方式。</p>
            <ul>
              {state.value.providers.map((provider) => (
                <li key={provider}>
                  {provider === 'google' ? 'Google' : 'GitHub'}
                  <span>服務已設定</span>
                </li>
              ))}
            </ul>
            {state.value.providers.length === 0 && (
              <p>目前沒有已設定的登入來源。</p>
            )}
            <p className="studio-account-note">
              新增或解除帳號綁定尚未開放；這裡不會變更你的登入方式。
            </p>
          </section>
        </>
      )}
    </main>
  );
}
