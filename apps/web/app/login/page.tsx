import Link from 'next/link';
import { authConfigSchema } from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
export const dynamic = 'force-dynamic';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const config = authConfigSchema.safeParse(process.env);
  const available = config.success && config.data.AUTH_DRIVER === 'supabase';
  const failed = (await searchParams).error === 'auth_failed';
  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <Link href="/" className="text-sm text-stone-600">
        KINO Pic
      </Link>
      <h1 className="mt-8 text-3xl font-semibold">攝影師登入</h1>
      <p className="mt-4 leading-7 text-stone-600">
        使用 Google
        帳號管理你的工作空間。客戶可使用攝影師提供的邀請連結，無須建立平台帳號。
      </p>
      {failed && (
        <p role="alert" className="mt-6 rounded-md bg-red-50 p-4 text-red-800">
          登入未完成，請重新開始
        </p>
      )}
      {available ? (
        <form action="/auth/google" method="post" className="mt-8">
          <Button type="submit">使用 Google 登入</Button>
        </form>
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
