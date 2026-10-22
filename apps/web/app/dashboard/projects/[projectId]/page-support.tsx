import 'server-only';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { ProjectRepository, RepositoryError } from '@kino-pic/db';
import { authenticatedContext } from '@/lib/auth/server';
import { ApiError } from '@/lib/http';
export async function projectRepository() {
  try {
    const { client, actor } = await authenticatedContext();
    return new ProjectRepository(client, actor);
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 503].includes(error.status))
      redirect('/login');
    throw error;
  }
}
export function validPageId(value: string) {
  const id = z.uuid().safeParse(value);
  if (!id.success) notFound();
  return id.data;
}
export function contentReadError(error: unknown, href: string) {
  if (error instanceof RepositoryError && error.code === 'NOT_FOUND')
    notFound();
  const badCursor =
    error instanceof z.ZodError ||
    (error instanceof RepositoryError && error.code === 'INVALID_INPUT');
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-2xl font-semibold">
        {badCursor ? '分頁連結無效' : '資料暫時無法載入'}
      </h1>
      <p role="alert" className="mt-4 text-stone-600">
        {badCursor
          ? '請返回第一頁重新瀏覽。'
          : '請稍後再試；目前無法載入不代表資料已被刪除。'}
      </p>
      <Link href={href} className="mt-6 inline-block underline">
        返回列表
      </Link>
    </main>
  );
}
export function ContentPagination({
  href,
  hasCursor,
  nextCursor,
  kind,
}: {
  href: string;
  hasCursor: boolean;
  nextCursor: string | null;
  kind: '專案' | '相簿';
}) {
  return (
    <nav
      aria-label={`${kind}分頁`}
      className="mt-6 flex flex-wrap gap-6 text-sm"
    >
      {hasCursor && (
        <Link href={href} className="underline">
          返回第一頁
        </Link>
      )}
      {nextCursor && (
        <Link
          href={`${href}?cursor=${encodeURIComponent(nextCursor)}`}
          className="underline"
        >
          下一頁{kind}
        </Link>
      )}
    </nav>
  );
}
export const projectStatusLabels = {
  draft: '草稿',
  uploading: '上傳中',
  selecting: '挑片中',
  submitted: '已提交',
  retouching: '修圖中',
  reviewing: '審閱中',
  approved: '已核准',
  delivered: '已交付',
  archived: '已封存',
};
export const albumStateLabels = {
  draft: '草稿',
  active: '使用中',
  archived: '已封存',
  deleting: '清理中',
  deleted: '已刪除',
};
