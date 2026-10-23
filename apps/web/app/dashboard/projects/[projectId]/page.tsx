import Link from 'next/link';
import { ArchiveContentForm } from './archive-form';
import { AlbumProtectionForm } from './album-protection';
import { z } from 'zod';
import { canManageContent } from '@kino-pic/contracts';
import { CreateContentForm, RenameContentForm } from './content-forms';
import {
  projectRepository,
  validPageId,
  contentReadError,
  ContentPagination,
  projectStatusLabels,
  albumStateLabels,
} from './page-support';
export const dynamic = 'force-dynamic';
export default async function ProjectAlbums({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const repo = await projectRepository();
  const projectId = validPageId((await params).projectId);
  const href = `/dashboard/projects/${projectId}`;
  let content: Awaited<ReturnType<typeof repo.listAlbums>>;
  let cursor: string | undefined;
  try {
    cursor = z
      .object({ cursor: z.string().optional() })
      .parse(await searchParams).cursor;
    content = await repo.listAlbums(projectId, cursor);
  } catch (error) {
    return contentReadError(error, href);
  }
  const { workspace, project, albums, nextCursor } = content;
  const canManage =
    canManageContent(workspace.role) && project.status !== 'archived';
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav
        aria-label="階層導覽"
        className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600"
      >
        <Link href="/dashboard" className="underline">
          攝影工作台
        </Link>
        <Link
          href={`/dashboard/workspaces/${workspace.id}`}
          className="min-w-0 break-words underline"
        >
          {workspace.name}
        </Link>
      </nav>
      <header className="mt-8">
        <p className="text-sm text-stone-600">
          專案 · {projectStatusLabels[project.status]}
        </p>
        <h1 className="mt-2 break-words text-3xl font-semibold">
          {project.name}
        </h1>
        {canManage && (
          <div className="mt-5 max-w-lg">
            <RenameContentForm
              kind="project"
              id={project.id}
              name={project.name}
              revision={project.revision}
            />
          </div>
        )}
        {workspace.role === 'workspace_owner' &&
          ['draft', 'delivered', 'archived'].includes(project.status) && (
            <div className="mt-4">
              <ArchiveContentForm
                kind="project"
                id={project.id}
                name={project.name}
                revision={project.revision}
                archived={project.status === 'archived'}
              />
            </div>
          )}
        {project.status === 'archived' && (
          <p className="mt-4 text-sm">
            專案已封存，還原後才能編輯內容。相簿保護設定仍可管理。
          </p>
        )}
        {!canManage && (
          <p className="mt-4 text-sm text-stone-600">
            你目前可查看此專案的相簿。
          </p>
        )}
      </header>
      <section aria-labelledby="albums-title" className="mt-10">
        <h2 id="albums-title" className="text-xl font-semibold">
          相簿
        </h2>
        {albums.length === 0 ? (
          <p className="mt-4 text-stone-600">
            {cursor
              ? '這一頁沒有相簿，請返回第一頁。'
              : canManage
                ? '尚無相簿，建立相簿來分類這次拍攝。'
                : '這個專案尚無相簿。'}
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {albums.map((album) => (
              <li
                key={album.id}
                className="min-w-0 rounded-lg border border-stone-200 bg-white p-6"
              >
                <h3 className="break-words text-lg font-semibold">
                  {album.name}
                </h3>
                <p className="mt-2 text-sm text-stone-600">
                  {albumStateLabels[album.state]}
                  {album.isPinned ? ' · 已釘選' : ''}
                  {album.legalHold ? ' · 保留保護' : ''}
                </p>
                {canManage &&
                  !['archived', 'deleting', 'deleted'].includes(
                    album.state,
                  ) && (
                    <div className="mt-5">
                      <RenameContentForm
                        kind="album"
                        id={album.id}
                        name={album.name}
                        revision={album.revision}
                      />
                    </div>
                  )}
                {workspace.role === 'workspace_owner' &&
                  !['deleting', 'deleted'].includes(album.state) && (
                    <div className="mt-4">
                      <AlbumProtectionForm album={album} />
                    </div>
                  )}
                {workspace.role === 'workspace_owner' &&
                  project.status !== 'archived' &&
                  ['draft', 'archived'].includes(album.state) && (
                    <div className="mt-4">
                      <ArchiveContentForm
                        kind="album"
                        id={album.id}
                        name={album.name}
                        revision={album.revision}
                        archived={album.state === 'archived'}
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
        kind="相簿"
      />
      {canManage && (
        <CreateContentForm
          kind="album"
          parentId={projectId}
          returnTo={cursor ? href : undefined}
        />
      )}
    </main>
  );
}
