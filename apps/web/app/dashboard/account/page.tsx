import Link from 'next/link';
import { redirect } from 'next/navigation';
import { oauthProviderSchema } from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
import { authenticatedContext } from '@/lib/auth/server';
import { authConfig } from '@/lib/auth/config';
import { providerLabels } from '@/lib/auth/oauth';
import { ApiError } from '@/lib/http';
export const dynamic = 'force-dynamic';
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  let context;
  try {
    context = await authenticatedContext();
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 503].includes(error.status))
      redirect('/login');
    throw error;
  }
  const config = authConfig();
  const query = await searchParams;
  const linked = query.notice === 'linked';
  const failed = query.error === 'link_failed';
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/dashboard" className="text-sm text-stone-600 underline">
        攝影工作台
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">帳號與登入方式</h1>
      <p className="mt-4 leading-7 text-stone-600">
        綁定的登入方式共用同一個 Kino Pick
        帳號、工作空間與專案。你可以保留目前的登入方式，或再綁定另一種。
      </p>
      {linked && (
        <p role="status" className="mt-6 rounded-md bg-stone-100 p-4">
          登入方式已綁定，原有工作空間與專案會保留。
        </p>
      )}
      {failed && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 p-4 text-red-800">
          綁定未完成，請確認下方登入方式後重新操作。
        </p>
      )}
      <section aria-labelledby="identities-title" className="mt-8">
        <h2 id="identities-title" className="text-xl font-semibold">
          登入方式
        </h2>
        <ul className="mt-4 space-y-4">
          {oauthProviderSchema.options.map((provider) => {
            const bound = context.linkedProviders.includes(provider);
            const enabled = config.AUTH_PROVIDERS.includes(provider);
            return (
              <li
                key={provider}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white p-6"
              >
                <div>
                  <h3 className="text-lg font-semibold">
                    {providerLabels[provider]}
                  </h3>
                  <p className="mt-2 text-sm text-stone-600">
                    {bound
                      ? enabled
                        ? '已綁定'
                        : '已綁定，目前暫停使用此方式登入'
                      : enabled
                        ? '尚未綁定'
                        : '此登入方式尚未開放'}
                  </p>
                </div>
                {!bound && enabled && config.AUTH_MANUAL_LINKING_ENABLED && (
                  <form action={`/auth/link/${provider}`} method="post">
                    <Button type="submit">
                      綁定 {providerLabels[provider]}
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
        {!config.AUTH_MANUAL_LINKING_ENABLED && (
          <p role="status" className="mt-5 text-sm text-stone-600">
            目前尚未開放新增綁定，已綁定的登入方式仍可使用。
          </p>
        )}
      </section>
    </main>
  );
}
