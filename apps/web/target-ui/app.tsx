import { lastWorkspace, rememberWorkspace } from './workspace-switcher';
import { useContentCounts } from './content-counts';
import { ProjectMatchingRulesConfiguration } from './project-matching-rules';
import { ResolvedBatchAlbumUpload } from './resolved-batch-upload';
import { ProjectVersioningConfiguration } from './project-versioning';
import { GuestHistoryPage } from './guest-history';
import { GuestSharedReviewPage } from './shared-review-guest';
import { AlbumSharedReviews } from './shared-review-owner';
import {
  AlbumSelectionPolicyConfiguration,
  ProjectSelectionPolicyConfiguration,
} from './selection-policy-configuration';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  albumSchema,
  projectSchema,
  workspaceSchema,
  type Album,
  type Project,
} from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
import { useRouter } from 'next/navigation';
import { WorkspacePanel } from '../app/dashboard/workspace-panel';
import { RenameContentForm } from '../app/dashboard/projects/[projectId]/content-forms';
import { ArchiveContentForm } from '../app/dashboard/projects/[projectId]/archive-form';
import { DeleteContentForm } from '../app/dashboard/projects/[projectId]/delete-form';
import { DeleteAlbumForm } from '../app/dashboard/projects/[projectId]/delete-album-form';
import { AlbumProtectionForm } from '../app/dashboard/projects/[projectId]/album-protection';
import { AlbumActivation } from './album-activation';
import { AlbumUpload } from './album-upload';
import { UploadWindow, type UploadProgress } from './upload-window';
import { AlbumGallery } from './album-gallery';
import { AlbumSubmissions } from './owner-submissions';
import { ProjectInvites } from './project-invites';
import type { InviteShareRequest } from './invite-create';
import { GuestAlbumPage } from './guest-selection';
import { GuestEntryPage, type GuestEntryCredential } from './guest-entry';
import { StudioShell } from './studio-shell';
import { KinoLogo } from './kino-logo';
import { StudioAccountPage } from './studio-account';
import { StudioCreateDialog } from './studio-create-dialog';
import { StudioWorkspacePage } from './studio-pages';
import { AlbumCover, ProjectCover, ProjectCoverControl } from './album-cover';
import { AlbumTabs } from './album-tabs';
import { StudioIcon } from './studio-icons';
import { OwnerClientActivity } from './owner-client-activity';
import './style.css';
import './album-navigation.css';
import './album-workspace.css';
import './lightbox-workspace.css';
import './dashboard-home.css';
import './content-card.css';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; statusCode: number; code: string };

class ApiFailure extends Error {
  constructor(
    public statusCode: number,
    public code: string,
  ) {
    super(code);
  }
}

function useRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('kino-pic:refresh', refresh);
    return () => window.removeEventListener('kino-pic:refresh', refresh);
  }, []);
  return revision;
}

function useResource<T>(path: string, schema: z.ZodType<T>): LoadState<T> {
  const revision = useRevision();
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void fetch(path, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsed = z
            .object({ error: z.object({ code: z.string() }) })
            .safeParse(body);
          throw new ApiFailure(
            response.status,
            parsed.success ? parsed.data.error.code : 'SERVICE_UNAVAILABLE',
          );
        }
        setState({ status: 'ready', value: schema.parse(body) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          statusCode: error instanceof ApiFailure ? error.statusCode : 503,
          code:
            error instanceof ApiFailure ? error.code : 'SERVICE_UNAVAILABLE',
        });
      });
    return () => controller.abort();
  }, [path, schema, revision]);
  return state;
}

const oauthProviderCapabilitiesResponse = z
  .object({ providers: z.array(z.enum(['google', 'github'])) })
  .strict();
const meResponse = z.object({
  actor: z.object({ id: z.uuid() }),
  role: z.literal('owner'),
  sessionId: z.string().min(1),
});
const workspacesResponse = z.object({
  workspaces: z.array(workspaceSchema),
  nextCursor: z.string().nullable(),
});
const projectsResponse = z.object({
  workspace: workspaceSchema,
  projects: z.array(projectSchema),
  nextCursor: z.string().nullable(),
});
const albumsResponse = z.object({
  workspace: workspaceSchema,
  project: projectSchema,
  albums: z.array(albumSchema),
  nextCursor: z.string().nullable(),
});
// useResource keys effects by schema identity; keep the shell schema stable.
const ownerWorkspaceContextResponse = z.union([
  albumsResponse,
  projectsResponse,
  workspacesResponse,
]);

const projectStatusLabels: Record<Project['status'], string> = {
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
const albumStateLabels: Record<Album['state'], string> = {
  draft: '草稿',
  active: '使用中',
  archived: '已封存',
  deleting: '清理中',
  deleted: '已刪除',
};

function LoadError({ code }: { code: string }) {
  const message =
    code === 'NOT_FOUND'
      ? '找不到這項內容，請返回工作台重新選取。'
      : code === 'OWNER_REQUIRED'
        ? '此帳號尚未獲得 Kino Pick 管理者授權。'
        : '目前無法載入資料，請稍後重新整理。';
  return (
    <section
      role="alert"
      className="mx-auto mt-8 max-w-4xl rounded-lg border border-amber-300 bg-amber-50 p-5"
    >
      <h2 className="font-semibold">資料暫時無法載入</h2>
      <p className="mt-2 text-sm">{message}</p>
    </section>
  );
}

function PageLoading() {
  return (
    <main
      className="studio-page studio-workbench mx-auto max-w-4xl px-6 py-12"
      role="status"
    >
      載入中…
    </main>
  );
}

function LoginPanel() {
  const [provider, setProvider] = useState<'google' | 'github' | null>(null);
  const [error, setError] = useState('');
  const availability = useResource(
    '/api/oauth/providers',
    oauthProviderCapabilitiesResponse,
  );
  async function signIn(value: 'google' | 'github') {
    if (
      provider ||
      availability.status !== 'ready' ||
      !availability.value.providers.includes(value)
    )
      return;
    setProvider(value);
    setError('');
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: value,
          callbackURL: window.location.origin + '/dashboard',
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      const parsed = z.object({ url: z.url() }).safeParse(body);
      if (!response.ok || !parsed.success)
        throw new Error('SIGN_IN_UNAVAILABLE');
      window.location.assign(parsed.data.url);
    } catch {
      setProvider(null);
      setError('登入尚未完成。請確認此登入來源已由管理者設定並授權，再重試。');
    }
  }
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-sm text-stone-600">奇諾影像 Kino Pick</p>
      <KinoLogo className="studio-login-logo" />
      <h1 className="mt-3 text-3xl font-semibold">攝影工作台</h1>
      <p className="mt-4 text-stone-600">
        管理者可使用已設定並綁定的 Google 或 GitHub
        帳號登入。平台不開放公開註冊。
      </p>
      {availability.status === 'loading' && (
        <p role="status" className="mt-6 text-sm text-stone-600">
          正在載入可用的登入方式…
        </p>
      )}
      {availability.status === 'error' && (
        <p role="alert" className="mt-6 text-sm text-red-800">
          目前無法確認可用的登入方式，請稍後重新整理。
        </p>
      )}
      {availability.status === 'ready' &&
        availability.value.providers.length === 0 && (
          <p role="status" className="mt-6 text-sm text-stone-600">
            目前尚未設定可用的登入方式。
          </p>
        )}
      <div className="mt-8 flex flex-wrap gap-3">
        {availability.status === 'ready' &&
          availability.value.providers.includes('google') && (
            <Button
              type="button"
              disabled={provider !== null}
              onClick={() => void signIn('google')}
            >
              {provider === 'google' ? '前往 Google…' : '使用 Google 登入'}
            </Button>
          )}
        {availability.status === 'ready' &&
          availability.value.providers.includes('github') && (
            <Button
              type="button"
              variant="outline"
              disabled={provider !== null}
              onClick={() => void signIn('github')}
            >
              {provider === 'github' ? '前往 GitHub…' : '使用 GitHub 登入'}
            </Button>
          )}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-800">
          {error}
        </p>
      )}
    </main>
  );
}

function WorkspacesPage() {
  const cursor = new URLSearchParams(window.location.search).get('cursor');
  const path = cursor
    ? '/api/v1/workspaces?cursor=' + encodeURIComponent(cursor)
    : '/api/v1/workspaces';
  const resource = useResource(path, workspacesResponse);
  const showAll = new URLSearchParams(window.location.search).has('all');
  const remembered =
    resource.status === 'ready' && !cursor && !showAll
      ? resource.value.workspaces.find(
          (workspace) => workspace.id === lastWorkspace(),
        )
      : undefined;
  useEffect(() => {
    // Opening the app goes straight to the workspace used last time; the
    // switcher's "所有工作空間" link (?all=1) still shows this list.
    if (remembered)
      window.location.replace('/dashboard/workspaces/' + remembered.id);
  }, [remembered]);
  if (resource.status === 'loading' || remembered) return <PageLoading />;
  if (resource.status === 'error') return <LoadError code={resource.code} />;
  return (
    <main className="studio-page studio-workbench mx-auto max-w-4xl px-6 py-12">
      <header className="studio-workbench-heading">
        <div>
          <p className="studio-eyebrow">KINO PICK</p>
          <h1 className="mt-2 text-3xl font-semibold">攝影工作台</h1>
        </div>
      </header>
      <WorkspacePanel
        workspaces={resource.value.workspaces}
        nextCursor={resource.value.nextCursor}
        hasCursor={!!cursor}
        managementEnabled
      />
    </main>
  );
}

function ProjectsPage({ workspaceId }: { workspaceId: string }) {
  const parsedId = z.uuid().safeParse(workspaceId);
  const cursor = new URLSearchParams(window.location.search).get('cursor');
  const query = new URLSearchParams({ workspaceId });
  if (cursor) query.set('cursor', cursor);
  const resource = useResource(
    '/api/v1/projects?' + query.toString(),
    projectsResponse,
  );
  if (!parsedId.success) return <LoadError code="NOT_FOUND" />;
  if (resource.status === 'loading') return <PageLoading />;
  if (resource.status === 'error') return <LoadError code={resource.code} />;
  const { workspace, projects, nextCursor } = resource.value;
  return (
    <main className="studio-page mx-auto max-w-5xl px-6 py-12">
      <nav aria-label="階層導覽" className="text-sm text-stone-600">
        <a href="/dashboard?all=1" className="underline">
          所有工作空間
        </a>
      </nav>
      <header className="mt-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="studio-eyebrow">WORKSPACE / PROJECTS</p>
          <h1 className="mt-2 break-words text-3xl font-semibold">
            {workspace.name}
          </h1>
          <p className="mt-4 text-stone-600">
            以專案整理拍攝工作，再用相簿分類。
          </p>
        </div>
        <div className="kino-content-card-create">
          <StudioCreateDialog kind="project" parentId={workspace.id} />
        </div>
      </header>
      <section aria-labelledby="projects-title" className="mt-10">
        <h2 id="projects-title" className="text-xl font-semibold">
          專案
        </h2>
        {projects.length === 0 ? (
          <p className="mt-4 text-stone-600">
            {cursor
              ? '這一頁沒有專案，請返回第一頁。'
              : '尚無專案，建立第一個專案開始整理拍攝工作。'}
          </p>
        ) : (
          <ProjectCardGrid workspaceId={workspace.id} projects={projects} />
        )}
      </section>
      {nextCursor && (
        <nav aria-label="專案分頁" className="mt-6">
          <a
            className="underline"
            href={
              '/dashboard/workspaces/' +
              workspace.id +
              '?cursor=' +
              encodeURIComponent(nextCursor)
            }
          >
            下一頁專案
          </a>
        </nav>
      )}
    </main>
  );
}

function ProjectCardGrid({
  workspaceId,
  projects,
}: {
  workspaceId: string;
  projects: Project[];
}) {
  const counts = useContentCounts(
    '/api/v1/workspaces/' + encodeURIComponent(workspaceId) + '/project-counts',
    'albums',
  );
  return (
    <ul className="studio-content-card-grid mt-6 grid gap-4">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          albumCount={counts ? (counts.get(project.id) ?? 0) : null}
        />
      ))}
    </ul>
  );
}

function ProjectCard({
  project,
  albumCount,
}: {
  project: Project;
  albumCount: number | null;
}) {
  const href = '/dashboard/projects/' + project.id;
  return (
    <li className="studio-project-card kino-content-card">
      <div className="kino-content-card__cover-wrap">
        <a
          className="studio-project-cover kino-content-card__cover"
          href={href}
          aria-label={'瀏覽專案相簿 ' + project.name}
        >
          <ProjectCover projectId={project.id} name={project.name} />
          <span className="kino-content-card__chips">
            {albumCount !== null && (
              <span
                className="kino-content-card__chip"
                title={albumCount + ' 本相簿'}
                aria-label={albumCount + ' 本相簿'}
              >
                <StudioIcon name="album" />
                {albumCount} 本相簿
              </span>
            )}
            <span
              className={
                'kino-content-card__chip kino-content-card__status is-' +
                project.status
              }
            >
              {projectStatusLabels[project.status]}
            </span>
          </span>
        </a>
        <h3 className="kino-content-card__name" aria-label={project.name}>
          <a
            href={href}
            title={project.name}
            aria-label={'開啟專案 ' + project.name}
          >
            {project.name}
          </a>
        </h3>
      </div>
      <div className="kino-content-card__actions">
        {project.status !== 'archived' && (
          <RenameContentForm
            kind="project"
            id={project.id}
            name={project.name}
            revision={project.revision}
            icon={<StudioIcon name="edit" />}
          />
        )}
        {['draft', 'delivered', 'archived'].includes(project.status) && (
          <ArchiveContentForm
            kind="project"
            id={project.id}
            name={project.name}
            revision={project.revision}
            archived={project.status === 'archived'}
            icon={
              <StudioIcon
                name={project.status === 'archived' ? 'restore' : 'archive'}
              />
            }
          />
        )}
        <DeleteContentForm
          kind="project"
          id={project.id}
          name={project.name}
          revision={project.revision}
          icon={<StudioIcon name="trash" />}
        />
      </div>
    </li>
  );
}

function navigateAlbum(albumId: string | null) {
  const url = new URL(window.location.href);
  if (albumId) url.searchParams.set('albumId', albumId);
  else url.searchParams.delete('albumId');
  url.searchParams.delete('photoId');
  window.history.pushState({ kinoPickAlbum: albumId }, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

function ProjectPage({
  projectId,
  actorId,
}: {
  projectId: string;
  actorId: string;
}) {
  const [selectedAlbumId, setSelectedAlbumId] = useState(() =>
    new URLSearchParams(window.location.search).get('albumId'),
  );
  useEffect(() => {
    const sync = () =>
      setSelectedAlbumId(
        new URLSearchParams(window.location.search).get('albumId'),
      );
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const parsedId = z.uuid().safeParse(projectId);
  const resource = useResource(
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/albums',
    albumsResponse,
  );
  const [shareRequest, setShareRequest] = useState<InviteShareRequest | null>(
    null,
  );
  const [uploadAlbumId, setUploadAlbumId] = useState<string | null>(null);
  const [uploadExpanded, setUploadExpanded] = useState(true);
  const [directProgress, setDirectProgress] = useState<UploadProgress | null>(
    null,
  );
  const [versionProgress, setVersionProgress] = useState<UploadProgress | null>(
    null,
  );
  const uploadProgress =
    [directProgress, versionProgress].find((entry) => entry?.active) ??
    directProgress ??
    versionProgress;
  function refreshUploadedAlbum() {
    window.dispatchEvent(new Event('kino-pic:album-uploaded:' + uploadAlbumId));
  }
  if (!parsedId.success) return <LoadError code="NOT_FOUND" />;
  if (resource.status === 'loading') return <PageLoading />;
  if (resource.status === 'error') return <LoadError code={resource.code} />;
  const { workspace, project, albums, nextCursor } = resource.value;
  const responseScopeValid =
    project.id.toLowerCase() === parsedId.data.toLowerCase() &&
    project.workspaceId.toLowerCase() === workspace.id.toLowerCase() &&
    albums.every(
      (album) =>
        album.projectId.toLowerCase() === project.id.toLowerCase() &&
        album.workspaceId.toLowerCase() === workspace.id.toLowerCase(),
    );
  if (!responseScopeValid) return <LoadError code="ALBUM_SCOPE_MISMATCH" />;
  const uploadAlbum =
    project.status !== 'archived'
      ? albums.find(
          (album) =>
            album.id === uploadAlbumId &&
            ['draft', 'active'].includes(album.state),
        )
      : undefined;
  const selectedAlbum = albums.find((album) => album.id === selectedAlbumId);
  if (selectedAlbumId && !selectedAlbum) return <LoadError code="NOT_FOUND" />;

  function shareAlbum(album: Album) {
    setShareRequest((current) => ({
      sequence: (current?.sequence ?? 0) + 1,
      album: {
        id: album.id,
        name: album.name,
        projectId: album.projectId,
        workspaceId: album.workspaceId,
        state: album.state,
      },
    }));
  }
  return (
    <main
      className={
        'studio-page mx-auto max-w-5xl px-6 py-12' +
        (selectedAlbum ? ' studio-album-workspace' : '')
      }
    >
      <nav aria-label="階層導覽" className="text-sm text-stone-600">
        <a href={'/dashboard/workspaces/' + workspace.id} className="underline">
          {workspace.name} 專案
        </a>
      </nav>
      <header className="mt-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="studio-eyebrow">
            {selectedAlbum ? project.name : '專案相簿'}
          </p>
          <h1 className="mt-2 break-words text-3xl font-semibold">
            {selectedAlbum?.name ?? project.name}
          </h1>
          {!selectedAlbum && (
            <p className="mt-4 text-stone-600">
              點選相簿封面查看照片，或分享給客戶開始挑片。
            </p>
          )}
        </div>
        {!selectedAlbum && project.status !== 'archived' && (
          <div className="kino-content-card-create">
            <StudioCreateDialog kind="album" parentId={project.id} />
          </div>
        )}
      </header>
      <section aria-labelledby="albums-title" className="mt-10">
        <h2
          id="albums-title"
          className={selectedAlbum ? 'sr-only' : 'text-xl font-semibold'}
        >
          相簿
        </h2>
        {albums.length === 0 ? (
          <p className="mt-4 text-stone-600">
            {nextCursor
              ? '這一頁沒有相簿，請返回第一頁。'
              : '尚無相簿，建立第一個相簿開始整理照片。'}
          </p>
        ) : (
          <>
            {selectedAlbum && (
              <AlbumTabs
                albums={albums}
                selectedAlbumId={selectedAlbumId}
                onSelect={navigateAlbum}
              />
            )}
            <ul
              className={
                'mt-6 grid gap-4 ' +
                (selectedAlbumId
                  ? 'studio-album-selected'
                  : 'studio-content-card-grid')
              }
            >
              {albums
                .filter(
                  (album) => !selectedAlbumId || album.id === selectedAlbumId,
                )
                .map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    focused={Boolean(selectedAlbum)}
                    uploadDisabled={Boolean(
                      uploadAlbum && uploadAlbum.id !== album.id,
                    )}
                    onUpload={() => {
                      setUploadAlbumId(album.id);
                      setUploadExpanded(true);
                    }}
                    editable={project.status !== 'archived'}
                    shareEnabled={
                      !['archived', 'deleting', 'deleted'].includes(
                        project.status,
                      )
                    }
                    onShareAlbum={shareAlbum}
                    versioningMode={project.versioningMode}
                  />
                ))}
            </ul>
          </>
        )}
      </section>
      {nextCursor && (
        <nav aria-label="相簿分頁" className="mt-6">
          <a
            className="underline"
            href={
              '/dashboard/projects/' +
              project.id +
              '?cursor=' +
              encodeURIComponent(nextCursor)
            }
          >
            下一頁相簿
          </a>
        </nav>
      )}

      {uploadAlbum && (
        <UploadWindow
          key={uploadAlbum.id}
          albumName={uploadAlbum.name}
          expanded={uploadExpanded}
          progress={uploadProgress}
          onToggle={() => setUploadExpanded((expanded) => !expanded)}
          onClose={() => {
            setUploadAlbumId(null);
            setDirectProgress(null);
            setVersionProgress(null);
          }}
        >
          <ResolvedBatchAlbumUpload
            key={`resolved:${actorId}:${uploadAlbum.id}`}
            actorId={actorId}
            workspaceId={uploadAlbum.workspaceId}
            projectId={uploadAlbum.projectId}
            albumId={uploadAlbum.id}
            modeActive={
              project.versioningMode === 'auto_filename' ||
              project.versioningMode === 'assisted'
            }
            onChanged={refreshUploadedAlbum}
            onUploadProgress={setVersionProgress}
          />
          {project.versioningMode === 'auto_filename' ||
          project.versioningMode === 'assisted' ? (
            <details className="mt-4 rounded border border-stone-200 p-3">
              <summary className="cursor-pointer text-sm">
                直接上傳獨立照片（略過版本比對）
              </summary>
              <AlbumUpload
                key={`manual:${uploadAlbum.workspaceId}:${uploadAlbum.projectId}:${uploadAlbum.id}`}
                workspaceId={uploadAlbum.workspaceId}
                projectId={uploadAlbum.projectId}
                albumId={uploadAlbum.id}
                onCompleted={refreshUploadedAlbum}
                onUploadProgress={setDirectProgress}
              />
            </details>
          ) : (
            <AlbumUpload
              key={`${uploadAlbum.workspaceId}:${uploadAlbum.projectId}:${uploadAlbum.id}`}
              workspaceId={uploadAlbum.workspaceId}
              projectId={uploadAlbum.projectId}
              albumId={uploadAlbum.id}
              onCompleted={refreshUploadedAlbum}
              onUploadProgress={setDirectProgress}
            />
          )}
        </UploadWindow>
      )}
      <ProjectInvites
        key={'invites:' + project.id}
        projectId={project.id}
        shareRequest={shareRequest}
        compact={Boolean(selectedAlbum)}
      />
      {!selectedAlbum && (
        <>
          <details className="studio-project-settings mt-8">
            <summary>
              <StudioIcon name="settings" /> 專案進階設定
            </summary>
            {project.status !== 'archived' && (
              <ProjectVersioningConfiguration
                key={'versioning:' + project.id}
                projectId={project.id}
                onChanged={() => window.location.reload()}
              />
            )}
            {project.status !== 'archived' && (
              <ProjectMatchingRulesConfiguration
                key={'matching-rules:' + project.id}
                projectId={project.id}
                onChanged={() => window.location.reload()}
              />
            )}
            <ProjectSelectionPolicyConfiguration
              key={'selection-policy:' + project.id}
              projectId={project.id}
            />
          </details>
        </>
      )}
    </main>
  );
}

function AlbumCard({
  album,
  focused = false,
  uploadDisabled,
  onUpload,
  editable,
  shareEnabled,
  onShareAlbum,
  versioningMode,
}: {
  album: Album;
  focused?: boolean;
  uploadDisabled: boolean;
  onUpload: () => void;
  editable: boolean;
  shareEnabled: boolean;
  onShareAlbum: (album: Album) => void;
  versioningMode: Project['versioningMode'];
}) {
  // Album list cards use icon-only actions; the album page toolbar keeps text.
  const compact = !focused;
  const counts = useContentCounts(
    '/api/v1/projects/' + encodeURIComponent(album.projectId) + '/album-counts',
    'photos',
  );
  const photoCount = counts ? (counts.get(album.id) ?? 0) : null;
  const [galleryOpened, setGalleryOpened] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('albumId') === album.id;
  });
  const [submissionsOpened, setSubmissionsOpened] = useState(false);
  const [policyOpened, setPolicyOpened] = useState(false);
  useEffect(() => {
    const syncGalleryRoute = () => {
      const params = new URLSearchParams(window.location.search);
      setGalleryOpened(params.get('albumId') === album.id);
    };
    window.addEventListener('popstate', syncGalleryRoute);
    return () => window.removeEventListener('popstate', syncGalleryRoute);
  }, [album.id]);
  return (
    <li
      data-testid={'album-card-' + album.id}
      className={
        focused
          ? 'studio-album-card min-w-0 rounded-lg border border-stone-200 bg-white p-6'
          : 'studio-album-card kino-content-card'
      }
    >
      {!focused && !['deleting', 'deleted'].includes(album.state) ? (
        <div className="kino-content-card__cover-wrap">
          <button
            type="button"
            className="studio-album-open kino-content-card__cover"
            onClick={() => navigateAlbum(album.id)}
            aria-label={'開啟相簿 ' + album.name}
            aria-expanded={galleryOpened}
          >
            <AlbumCover albumId={album.id} name={album.name} />
            <span className="kino-content-card__chips">
              {photoCount !== null && (
                <span
                  className="kino-content-card__chip"
                  title={photoCount + ' 張照片'}
                  aria-label={photoCount + ' 張照片'}
                >
                  <StudioIcon name="image" />
                  {photoCount} 張照片
                </span>
              )}
              <span
                className={
                  'kino-content-card__chip kino-content-card__status is-' +
                  album.state
                }
              >
                {albumStateLabels[album.state]}
                {album.isPinned ? ' · 已釘選' : ''}
              </span>
              {album.legalHold && (
                <span className="kino-content-card__chip" title="保留保護">
                  <StudioIcon name="lock" />
                  <span className="sr-only">保留保護</span>
                </span>
              )}
            </span>
          </button>
          <h3 className="kino-content-card__name" title={album.name}>
            {album.name}
          </h3>
        </div>
      ) : !focused ? (
        <h3 className="kino-content-card__fallback-title">{album.name}</h3>
      ) : null}
      <div
        className={
          compact ? 'kino-content-card__actions' : 'mt-4 flex flex-wrap gap-3'
        }
      >
        <Button
          type="button"
          variant="outline"
          data-testid={'invite-from-album-' + album.id}
          aria-label={'分享相簿 ' + album.name}
          disabled={!shareEnabled || album.state !== 'active'}
          title={
            !shareEnabled || album.state !== 'active'
              ? '僅可分享未封存專案中的使用中相簿'
              : undefined
          }
          onClick={() => onShareAlbum(album)}
          className={compact ? 'kino-icon-button' : undefined}
        >
          <StudioIcon name="share" />
          {compact ? null : ' 分享相簿'}
        </Button>
        {!['deleting', 'deleted'].includes(album.state) && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setPolicyOpened(true);
              setSubmissionsOpened((value) => !value);
            }}
            aria-label={'審查挑片 ' + album.name}
            aria-expanded={submissionsOpened}
            title={compact ? '查看客戶挑片' : undefined}
            className={compact ? 'kino-icon-button' : undefined}
          >
            <StudioIcon name="check" />
            {compact
              ? null
              : submissionsOpened
                ? ' 收起挑片結果'
                : ' 查看客戶挑片'}
          </Button>
        )}
        {editable && ['draft', 'active'].includes(album.state) && (
          <Button
            type="button"
            variant="outline"
            onClick={onUpload}
            disabled={uploadDisabled}
            aria-label={'上傳照片 ' + album.name}
            title={
              uploadDisabled
                ? '請先關閉目前的上傳視窗'
                : compact
                  ? '上傳照片'
                  : undefined
            }
            className={compact ? 'kino-icon-button' : undefined}
          >
            <StudioIcon name="upload" />
            {compact ? null : ' 上傳照片'}
          </Button>
        )}
        {editable && (
          <details className="studio-album-settings">
            <summary
              title={compact ? '相簿設定' : undefined}
              className={compact ? 'kino-icon-button' : undefined}
            >
              <StudioIcon name="settings" />
              <span className={compact ? 'sr-only' : undefined}>相簿設定</span>
            </summary>
            <div className="mt-3 flex flex-wrap gap-3">
              {editable && album.state === 'draft' && (
                <AlbumActivation album={album} editable={editable} />
              )}
              {!['deleting', 'deleted'].includes(album.state) && (
                <ProjectCoverControl
                  projectId={album.projectId}
                  albumId={album.id}
                />
              )}
              {editable &&
                !['archived', 'deleting', 'deleted'].includes(album.state) && (
                  <RenameContentForm
                    kind="album"
                    id={album.id}
                    name={album.name}
                    revision={album.revision}
                  />
                )}
              {editable && !['deleting', 'deleted'].includes(album.state) && (
                <AlbumProtectionForm album={album} />
              )}
              {editable && ['draft', 'archived'].includes(album.state) && (
                <ArchiveContentForm
                  kind="album"
                  id={album.id}
                  name={album.name}
                  revision={album.revision}
                  archived={album.state === 'archived'}
                />
              )}
              {album.state !== 'deleted' && (
                <DeleteAlbumForm albumId={album.id} />
              )}
            </div>
          </details>
        )}
      </div>
      {galleryOpened && <OwnerClientActivity albumId={album.id} />}
      {galleryOpened && (
        <AlbumGallery
          key={album.id}
          albumId={album.id}
          albumName={album.name}
          {...(editable && ['draft', 'active'].includes(album.state)
            ? {
                uploadContext: {
                  workspaceId: album.workspaceId,
                  projectId: album.projectId,
                  versioningMode,
                },
              }
            : {})}
        />
      )}
      {policyOpened && editable && (
        <section hidden={!submissionsOpened}>
          <AlbumSelectionPolicyConfiguration
            key={album.id}
            albumId={album.id}
          />
          <AlbumSharedReviews
            key={'shared:' + album.id}
            albumId={album.id}
            projectId={album.projectId}
          />
        </section>
      )}
      {submissionsOpened && (
        <AlbumSubmissions albumId={album.id} albumName={album.name} />
      )}
    </li>
  );
}

function ContentRouter({
  guestEntryCredential = { token: null, invalid: false },
  actorId,
}: { guestEntryCredential?: GuestEntryCredential; actorId?: string } = {}) {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments[0] === 'guest') {
    if (segments[1] === 'history' && segments.length === 2) {
      return <GuestHistoryPage />;
    }
    if (
      segments[1] === 'albums' &&
      segments.length === 4 &&
      segments[3] === 'enter' &&
      z.uuid().safeParse(segments[2]).success
    ) {
      return (
        <GuestEntryPage
          albumId={segments[2] ?? ''}
          credential={guestEntryCredential}
        />
      );
    }
    if (
      segments[1] === 'albums' &&
      segments.length === 5 &&
      segments[3] === 'shared' &&
      z.uuid().safeParse(segments[2]).success &&
      z.uuid().safeParse(segments[4]).success
    ) {
      return (
        <GuestSharedReviewPage
          key={segments[2] + ':' + segments[4]}
          albumId={segments[2] ?? ''}
          reviewId={segments[4] ?? ''}
        />
      );
    }
    if (segments[1] === 'albums' && segments.length === 3) {
      return <GuestAlbumPage albumId={segments[2] ?? ''} />;
    }
    return <LoadError code="NOT_FOUND" />;
  }
  if (
    segments.length === 0 ||
    (segments.length === 1 && segments[0] === 'dashboard')
  ) {
    return <WorkspacesPage />;
  }
  if (segments[0] !== 'dashboard') return <LoadError code="NOT_FOUND" />;
  if (segments[1] === 'account' && segments.length === 2)
    return <StudioAccountPage />;
  if (segments[1] === 'workspaces' && segments.length === 4) {
    const section = segments[3];
    if (
      section === 'history' ||
      section === 'settings' ||
      section === 'invites'
    )
      return actorId ? (
        <StudioWorkspacePage
          key={segments[2] + ':' + section + ':' + actorId}
          workspaceId={segments[2] ?? ''}
          actorId={actorId}
          section={section}
        />
      ) : (
        <LoadError code="OWNER_REQUIRED" />
      );
  }

  if (segments[1] === 'workspaces' && segments.length === 3) {
    return actorId ? (
      <ProjectsPage workspaceId={segments[2] ?? ''} />
    ) : (
      <LoadError code="OWNER_REQUIRED" />
    );
  }
  if (segments[1] === 'projects' && segments.length === 3) {
    return actorId ? (
      <ProjectPage projectId={segments[2] ?? ''} actorId={actorId} />
    ) : (
      <LoadError code="OWNER_REQUIRED" />
    );
  }
  return <LoadError code="NOT_FOUND" />;
}

function OwnerWorkspaceShell({
  children,
  signingOut,
  onSignOut,
}: {
  children: React.ReactNode;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const projectId =
    segments[0] === 'dashboard' &&
    segments[1] === 'projects' &&
    segments.length === 3 &&
    z.uuid().safeParse(segments[2]).success
      ? segments[2]
      : null;
  const routeWorkspace =
    segments[1] === 'workspaces' && z.uuid().safeParse(segments[2]).success
      ? segments[2]
      : undefined;
  const context = useResource(
    projectId
      ? '/api/v1/projects/' + projectId + '/albums'
      : routeWorkspace
        ? '/api/v1/projects?workspaceId=' + encodeURIComponent(routeWorkspace)
        : '/api/v1/workspaces',
    ownerWorkspaceContextResponse,
  );
  // On the all-workspaces page the shell follows the workspace the Owner last
  // used (if still listed), otherwise the first one.
  const current =
    context.status === 'ready'
      ? 'workspace' in context.value
        ? context.value.workspace
        : (context.value.workspaces.find(
            (workspace) => workspace.id === lastWorkspace(),
          ) ?? context.value.workspaces[0])
      : undefined;
  const scoped = context.status === 'ready' && 'workspace' in context.value;
  useEffect(() => {
    if (scoped) rememberWorkspace(current?.id);
  }, [scoped, current?.id]);
  return (
    <StudioShell
      workspaceId={current?.id}
      workspaceName={current?.name}
      accountLabel="管理員"
      signingOut={signingOut}
      onSignOut={onSignOut}
    >
      {children}
    </StudioShell>
  );
}

function OwnerApp() {
  const router = useRouter();
  const me = useResource('/api/v1/me', meResponse);
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } finally {
      router.replace('/');
    }
  }
  if (me.status === 'loading') return <PageLoading />;
  if (me.status === 'error' && me.statusCode === 401) return <LoginPanel />;
  if (me.status === 'error') return <LoadError code={me.code} />;
  return (
    <OwnerWorkspaceShell
      signingOut={signingOut}
      onSignOut={() => void signOut()}
    >
      <ContentRouter actorId={me.value.actor.id} />
    </OwnerWorkspaceShell>
  );
}

export default function App({
  guestEntryCredential,
}: {
  guestEntryCredential: GuestEntryCredential;
}) {
  const isGuestRoute =
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith('/guest');
  if (isGuestRoute) {
    return <ContentRouter guestEntryCredential={guestEntryCredential} />;
  }
  return <OwnerApp />;
}
