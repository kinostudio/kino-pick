import Link from 'next/link';
import { redirect } from 'next/navigation';
import { WorkspaceRepository } from '@kino-pic/db';
import { Button } from '@kino-pic/ui';
import { authenticatedContext } from '@/lib/auth/server';
import { ApiError } from '@/lib/http';
import { WorkspacePanel } from './workspace-panel';
export const dynamic = 'force-dynamic';
export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  let context;
  try {
    context = await authenticatedContext();
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 503].includes(error.status))
      redirect('/login');
    throw error;
  }
  let workspaces;
  try {
    workspaces = await new WorkspaceRepository(
      context.client,
      context.actor,
    ).list((await searchParams).cursor);
  } catch {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="text-2xl font-semibold">工作空間暫時無法載入</h1>
        <p role="alert" className="mt-4">
          請稍後重新整理，未載入的資料不代表已被刪除。
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-stone-600">Kino Pick</p>
          <h1 className="mt-2 text-3xl font-semibold">攝影工作台</h1>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <Link href="/dashboard/account" className="text-sm underline">
            帳號與登入方式
          </Link>
          <form action="/auth/logout" method="post">
            <Button variant="outline" type="submit">
              登出
            </Button>
          </form>
        </div>
      </header>
      <WorkspacePanel
        workspaces={workspaces.workspaces}
        nextCursor={workspaces.nextCursor}
        hasCursor={!!(await searchParams).cursor}
      />
    </main>
  );
}
