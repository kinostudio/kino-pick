import Link from 'next/link';
import { z } from 'zod';
import { canManageContent } from '@kino-pic/contracts';
import {
  CreateContentForm,
  RenameContentForm,
} from '@/app/dashboard/projects/[projectId]/content-forms';
import {
  projectRepository,
  validPageId,
  contentReadError,
  ContentPagination,
  projectStatusLabels,
} from '@/app/dashboard/projects/[projectId]/page-support';
export const dynamic = 'force-dynamic';
export default async function WorkspaceProjects({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const repo = await projectRepository();
  const workspaceId = validPageId((await params).workspaceId);
  const href = `/dashboard/workspaces/${workspaceId}`;
  let content: Awaited<ReturnType<typeof repo.list>>;
  let cursor: string | undefined;
  try {
    cursor = z
      .object({ cursor: z.string().optional() })
      .parse(await searchParams).cursor;
    content = await repo.list(workspaceId, cursor);
  } catch (error) {
    return contentReadError(error, href);
  }
  const { workspace, projects, nextCursor } = content;
  const canManage = canManageContent(workspace.role);
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav aria-label="階層導覽" className="text-sm text-stone-600">
        <Link href="/dashboard" className="underline">
          攝影工作台
        </Link>
      </nav>
      <header className="mt-8">
        <p className="text-sm text-stone-600">工作空間</p>
        <h1 className="mt-2 break-words text-3xl font-semibold">
          {workspace.name}
        </h1>
        <p className="mt-4 text-stone-600">
          以專案整理拍攝工作，再用相簿分類。
        </p>
        {!canManage && (
          <p className="mt-3 text-sm text-stone-600">
            你目前可查看此工作空間的專案與相簿。
          </p>
        )}
      </header>
      <section aria-labelledby="projects-title" className="mt-10">
        <h2 id="projects-title" className="text-xl font-semibold">
          專案
        </h2>
        {projects.length === 0 ? (
          <p className="mt-4 text-stone-600">
            {cursor
              ? '這一頁沒有專案，請返回第一頁。'
              : canManage
                ? '尚無專案，建立第一個專案開始整理拍攝工作。'
                : '這個工作空間尚無專案。'}
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <li
                key={project.id}
                className="min-w-0 rounded-lg border border-stone-200 bg-white p-6"
              >
                <h3 className="break-words text-lg font-semibold">
                  {project.name}
                </h3>
                <p className="mt-2 text-sm text-stone-600">
                  {projectStatusLabels[project.status]}
                </p>
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  aria-label={`開啟專案 ${project.name}`}
                  className="mt-5 inline-block text-sm underline"
                >
                  開啟專案
                </Link>
                {canManage && (
                  <div className="mt-4">
                    <RenameContentForm
                      kind="project"
                      id={project.id}
                      name={project.name}
                      revision={project.revision}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ContentPagination
        href={href}
        hasCursor={!!cursor}
        nextCursor={nextCursor}
        kind="專案"
      />
      {canManage && (
        <CreateContentForm
          kind="project"
          parentId={workspaceId}
          returnTo={cursor ? href : undefined}
        />
      )}
    </main>
  );
}
