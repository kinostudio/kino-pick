import Link from 'next/link';
import { authConfigSchema } from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
import { providerLabels } from '@/lib/auth/oauth';
export const dynamic = 'force-dynamic';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const config = authConfigSchema.safeParse(process.env);
  const available = config.success && config.data.AUTH_DRIVER === 'supabase';
  const providers = available ? config.data.AUTH_PROVIDERS : [];
  const failed = (await searchParams).error === 'auth_failed';
  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <Link href="/" className="text-sm text-stone-600">
        Kino Pick
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">攝影師登入</h1>
      <p className="mt-4 leading-7 text-stone-600">
        選擇登入方式，進入你的 Kino Pick
        工作空間。同一個帳號可使用一種，或同時綁定 Google 與 GitHub。
      </p>
      {failed && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 p-4 text-red-800">
          登入未完成，請重新開始
        </p>
      )}
      {available ? (
        <div className="mt-8 flex flex-wrap gap-3">
          {providers.map((provider) => (
            <form key={provider} action={`/auth/${provider}`} method="post">
              <Button type="submit">
                使用 {providerLabels[provider]} 登入
              </Button>
            </form>
          ))}
        </div>
      ) : (
        <p
          role="status"
          className="mt-8 rounded-lg border border-stone-200 bg-white p-6"
        >
          登入服務尚未設定，目前無法登入。請聯絡平台管理員。
        </p>
      )}
    </main>
  );
}
